import {
  freshOfficialBoard,
  withConfirmedSaleRights,
} from "./fixtures/officialSaleBoard.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  FALLBACK_MATCHES as referencePrices,
  analyzeMatchMicroQuant,
  archetypeToReport,
  computeProOrderInsights,
  computeTruthReport,
  consolidateTerminalPhysicalSlips,
  evaluateQuantWorkspace as calculateWorkspace,
  generateParetoPortfolio,
  optimizeBonusPlan,
  settleTicketSnapshotWithOfficialResults,
} from "../server/quantEngine.mjs";
import {
  certifyAndSolveJointBreakeven,
  expandTerminalPhysicalSlipMultiset,
  verifyBreakevenWitness,
} from "../server/quant/statutoryRules.mjs";
import {
  computeEquivalentArbitrages,
  resolvePureSingleSubsetPoolCandidates,
} from "../server/quant/coherentCalibration.mjs";
import {
  createLedgerManager,
  sealAuthoritativePrintSnapshot,
} from "../server/ledgerManager.mjs";
import { createAppRoutes } from "../server/appRoutes.mjs";
import {
  enrichBoardQuoteMeta,
  fetchOfficialMatchesServer,
  reconcileMatchesPoolsNonRegressive,
} from "../server/sportteryFeed.mjs";
import { recalibrateMergedMatch } from "../server/quant/sportteryParsers.mjs";
import {
  buildMatchIntelDigest,
  computeClientPortfolioQuoteMeta,
  createBetSlipController,
} from "../src/workspace/betSlipController.ts";
import { createWorkbenchController } from "../src/workspace/workbenchController.ts";
import {
  buildAuditThreeLayerViewModel,
  buildBoardHeaderStatusText,
  buildMatchRadarBoardFreshnessBanner,
  buildPendingSingleCrossPoolCards,
  buildPosterSlipRows,
  dedupePlanTitle,
  formatCandidateBudgetSwitchToast,
  resolveAuditCabinLifecycleState,
} from "../src/mobile/cabins/cabinViewModels.ts";
import type {
  ArchetypePlan,
  BoardFreshnessMeta,
  MatchItem,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

// The audit exercises a simulated official trading board with the fixture prices.
const officialFixtureMatches = withConfirmedSaleRights(referencePrices);
function evaluateQuantWorkspace(
  ...args: Parameters<typeof calculateWorkspace>
) {
  return { ...calculateWorkspace(...args), boardMeta: freshOfficialBoard };
}

function makePick(
  m: MatchItem,
  poolCode: PoolCode,
  optKey: string
): SelectedPick {
  const pool = m.pools[poolCode];
  const opt = pool.options.find((o) => o.key === optKey || o.label === optKey);
  assert.ok(opt, `Missing option ${poolCode}:${optKey} on ${m.matchNumStr}`);
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: Boolean(pool.single),
    canSingle: pool.canSingle ?? Boolean(pool.single),
    canAllUp: pool.canAllUp ?? true,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

async function confirmDisplayedSyntheticTicket(
  controller: ReturnType<typeof createBetSlipController>,
  expectedCost: number
) {
  const state = controller.getState();
  assert.equal(state.workspace.effectiveReport.totalCost, 0);
  assert.equal(state.workspace.effectiveReport.canCheckout, false);
  assert.equal(controller.formatShopkeeperWeChatSlip(), "");
  assert.equal(controller.buildSealedLedgerDraft(), null);
  const quote = state.pendingSyntheticChoice?.quote;
  assert.ok(
    quote,
    "The selected match must disclose its current synthetic ticket"
  );
  assert.equal(quote.cost, expectedCost);
  assert.ok(quote.label && quote.signature);
  assert.ok(quote.rows.length > 0);
  for (const row of quote.rows) {
    assert.equal(row.matchId, state.picks[0].matchId);
    assert.ok(row.home && row.away && row.poolName && row.optionLabel);
    assert.ok(
      row.odds >= 1.01 && Number.isInteger(row.multiple) && row.multiple > 0
    );
    assert.equal(row.cost, 2 * row.multiple);
  }
  assert.equal(
    quote.rows.reduce((cost, row) => cost + row.cost, 0),
    expectedCost
  );
  assert.equal(controller.confirmSyntheticChoiceQuote(quote.signature), true);
  await controller.flush();
  assert.equal(
    controller.getState().workspace.effectiveReport.totalCost,
    expectedCost
  );
}

function makeLiveMatch(
  base: MatchItem,
  spec: {
    id: string;
    matchNumStr: string;
    home: string;
    away: string;
    had?: [number, number, number] | null;
    goalLine: string;
    hhad: [number, number, number];
  }
): MatchItem {
  const mkOpts = (
    keys: [string, string, string],
    labels: [string, string, string],
    odds: [number, number, number]
  ) => {
    const inv = odds.reduce((a, x) => a + 1 / x, 0);
    return odds.map((o, i) => ({
      key: keys[i],
      label: labels[i],
      odds: o,
      trend: 0 as const,
      fairProb: Number((1 / o / inv).toFixed(6)),
    }));
  };
  return {
    ...base,
    id: spec.id,
    matchNumStr: spec.matchNumStr,
    home: spec.home,
    away: spec.away,
    pools: {
      ...base.pools,
      HAD: spec.had
        ? {
            ...base.pools.HAD,
            selling: true,
            single: false,
            canSingle: false,
            canAllUp: true,
            options: mkOpts(["h", "d", "a"], ["主胜", "平", "客胜"], spec.had),
          }
        : {
            ...base.pools.HAD,
            selling: false,
            single: false,
            canSingle: false,
            options: [],
          },
      HHAD: {
        ...base.pools.HHAD,
        selling: true,
        single: false,
        canSingle: false,
        canAllUp: true,
        goalLine: spec.goalLine,
        options: mkOpts(
          ["hh", "hd", "ha"],
          ["让胜", "让平", "让负"],
          spec.hhad
        ),
      },
      HAFU: {
        ...base.pools.HAFU,
        selling: true,
        single: true,
        canSingle: true,
      },
      TTG: { ...base.pools.TTG, selling: true, single: true, canSingle: true },
      CRS: { ...base.pools.CRS, selling: true, single: true, canSingle: true },
    },
  };
}

function buildLiveNov23Slate(): MatchItem[] {
  const fb = officialFixtureMatches as MatchItem[];
  const raw = [
    makeLiveMatch(fb[0], {
      id: "2042942",
      matchNumStr: "周一001",
      home: "厄格里特",
      away: "卡尔马",
      had: [3.38, 3.4, 1.82],
      goalLine: "+1",
      hhad: [1.72, 3.45, 3.74],
    }),
    makeLiveMatch(fb[1], {
      id: "2042943",
      matchNumStr: "周一002",
      home: "哈马比",
      away: "哥德堡",
      had: null,
      goalLine: "-2",
      hhad: [2.25, 3.8, 2.32],
    }),
    makeLiveMatch(fb[2], {
      id: "2042944",
      matchNumStr: "周一003",
      home: "蒙扎",
      away: "佛罗伦萨",
      had: [3.65, 3.85, 1.65],
      goalLine: "+1",
      hhad: [1.9, 3.4, 3.14],
    }),
    makeLiveMatch(fb[3], {
      id: "2042945",
      matchNumStr: "周一004",
      home: "索肖",
      away: "敦刻尔克",
      had: [2.22, 2.9, 2.91],
      goalLine: "-1",
      hhad: [4.8, 3.85, 1.49],
    }),
    makeLiveMatch(fb[4], {
      id: "2042946",
      matchNumStr: "周一005",
      home: "布伦特",
      away: "埃弗顿",
      had: [2.22, 3.15, 2.69],
      goalLine: "-1",
      hhad: [4.52, 4.05, 1.49],
    }),
    makeLiveMatch(fb[5], {
      id: "2042947",
      matchNumStr: "周一006",
      home: "莱万特",
      away: "埃尔切",
      had: [1.83, 3.3, 3.45],
      goalLine: "-1",
      hhad: [3.8, 3.32, 1.74],
    }),
    makeLiveMatch(fb[6], {
      id: "2042948",
      matchNumStr: "周一007",
      home: "博塔弗戈",
      away: "圣保罗",
      had: [1.97, 2.95, 3.41],
      goalLine: "-1",
      hhad: [4.35, 3.38, 1.63],
    }),
    makeLiveMatch(fb[7], {
      id: "2042949",
      matchNumStr: "周一008",
      home: "圣路易城",
      away: "洛杉矶FC",
      had: [2.25, 3.18, 2.63],
      goalLine: "-1",
      hhad: [4.95, 4.05, 1.45],
    }),
  ];
  return withConfirmedSaleRights(raw).map((m) => ({
    ...m,
    microQuant: analyzeMatchMicroQuant(m),
  }));
}

// Each published board has a distinct acquisition time. A shorter cached
// login response alone cannot establish that a previously saved match stopped.
const liveBoard = (revision: number): BoardFreshnessMeta => ({
  source: "official-live",
  boardState: "fresh",
  lastValidBoardAt: 1_795_492_850_000 + revision * 1000,
  quotedAt: 1_795_492_850_000 + revision * 1000,
  lastValidBoardClock: null,
  isFallbackReadOnly: false,
  bannerText: null,
});

describe("Joint Audit v1.0 · Zero-Disagreement Full-Stack & Mathematical Regression Lock (ADR-0019)", () => {
  it("Slice 1 (P0-1..P0-7 Stop-Bleeding): locks Option B2 pass/banker inheritance, activeSlip bonus-opt sovereignty, event-safe swap, singleAuthGrant invalidation, stance freeze & 729-line ledger sealing", async () => {
    const matches = officialFixtureMatches as MatchItem[];
    const [m001, m002, m003, m004, m005, m006] = matches;

    const storageMap = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storageMap.set(k, v);
      },
      removeItem: (k: string) => {
        storageMap.delete(k);
      },
    };

    let navigatedToAudit = 0;
    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      storagePort: mockStorage,
      getAccountId: () => "u-audit-v1",
      computeWorkspace: (params, ms) => evaluateQuantWorkspace(params, ms),
    });
    const setExactMultiple = (target: number) => {
      ctrl.stepMultiple(target - ctrl.getState().multiple);
    };
    ctrl.applyAuthenticatedBundle({
      matches,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, matches),
    });

    // P0-1 & Option B2: locking 2串1 across 4 matches NEVER clobbers passSpec to "auto" or 4串1!
    ctrl.setBudget(50);
    setExactMultiple(1);
    for (const m of [m001, m002, m003, m004]) {
      ctrl.togglePick(m, "HAD", "h");
      ctrl.togglePick(m, "HAD", "d");
    }
    ctrl.toggleFreePassSize(2); // [2, 4] -> toggle 4 off so explicit [2]
    if (ctrl.getState().passSpec.passSizes?.includes(4)) {
      ctrl.toggleFreePassSize(4);
    }
    await ctrl.flush();
    assert.deepEqual(ctrl.getState().passSpec.passSizes, [2]);
    assert.equal(ctrl.getState().workspace.effectiveReport.modeLabel, "2串1");
    assert.equal(ctrl.getState().workspace.effectiveReport.betCount, 24);
    assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 48);

    // Adding a 5th match preserves explicit [2] pass intent (Option B2!)
    ctrl.togglePick(m005, "HAD", "h");
    await ctrl.flush();
    assert.deepEqual(ctrl.getState().passSpec.passSizes, [2]);
    assert.equal(ctrl.getState().workspace.effectiveReport.modeLabel, "2串1");
    ctrl.togglePick(m005, "HAD", "h"); // remove 5th match back to 4 matches
    await ctrl.flush();

    // Even if a synthetic remediation action with targetPassSizes=[2] is applied, passSpec NEVER resets to "auto" or 4串1
    ctrl.applyPortfolioRemediationAction({
      kind: "lower-pass-preview",
      label: "测试低阶预览",
      detail: "测试",
      sourcePassSizes: [4],
      targetPassSizes: [2],
      isStrictAllLowerPass: true,
    });
    await ctrl.flush();
    assert.notEqual(ctrl.getState().passSpec.mode, "auto");
    assert.deepEqual(ctrl.getState().passSpec.passSizes, [2]);
    assert.equal(ctrl.getState().workspace.effectiveReport.modeLabel, "2串1");

    // P0-2 (Part A): 24注 × 1倍 = ¥48 has 0 spare units -> applyBonusOptimization reports honest unchanged/noOpReason!
    const zeroSlackOpt = ctrl.applyBonusOptimization("equal") as any;
    await ctrl.flush();
    assert.equal(
      Boolean(
        zeroSlackOpt?.unchanged ||
        ctrl.getState().workspace.appliedPlan?.bonusNoOpReason
      ),
      true,
      "0-spare-unit 24×1x slip must disclose no-op reason instead of fake optimization"
    );

    // P0-2 (Part B): Apply a middle-column ¥10 plan, then run 3-mode bonus optimization -> MUST stay on applied plan lines & ¥10!
    ctrl.clearPicks();
    ctrl.setBudget(10);
    setExactMultiple(2);
    ctrl.togglePick(m003, "HAD", "h");
    ctrl.togglePick(m003, "HAD", "d");
    ctrl.togglePick(m004, "HAD", "a");
    ctrl.togglePick(m004, "HAD", "d");
    await ctrl.flush();
    // Manual draft is 4 bets × 2x = ¥16
    assert.equal(ctrl.getState().workspace.manualReport.totalCost, 16);
    const slot2At10 = ctrl
      .getState()
      .workspace.portfolioPlans.find((p) => p.available && p.totalCost === 10);
    if (slot2At10) {
      ctrl.applyArchetype(slot2At10);
      await ctrl.flush();
      assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 10);

      // P0-6: Changing stance while archetype is locked MUST keep activeSlip frozen on ¥10 (never jump to manual ¥16!)
      ctrl.setStance("home-lean");
      await ctrl.flush();
      assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 10);
      assert.ok(
        ctrl.getState().activeAuditedSlip.budgetMismatchMeta,
        "Expected parameter/quote drift banner while archetype remains frozen at ¥10"
      );
      ctrl.setStance("objective");
      await ctrl.flush();

      // Now run right-cabin bonus optimization on the locked ¥10 activeSlip -> MUST optimize the ¥10 slip, NOT manual ¥16!
      ctrl.applyBonusOptimization("hot-first");
      await ctrl.flush();
      assert.equal(
        ctrl.getState().workspace.effectiveReport.totalCost,
        10,
        "Bonus optimization must bind to activeSlip (¥10), NEVER reverting to manualDraft (¥16)!"
      );
    }

    // P0-3: Full HAD [h, d, a] on +1 match + [a] on m003 -> equivalent swap [h, d] -> HHAD(+1):hh MUST NOT delete HAD:a or mutate multiple!
    const swapM2to1: MatchItem = {
      ...structuredClone(m001),
      id: "p03-plus1-2to1",
      pools: {
        ...structuredClone(m001.pools),
        HAD: {
          ...structuredClone(m001.pools.HAD),
          options: [
            { key: "h", label: "主胜", odds: 2.85, trend: 0, fairProb: 0.31 },
            { key: "d", label: "平", odds: 3.15, trend: 0, fairProb: 0.28 },
            { key: "a", label: "客胜", odds: 2.15, trend: 0, fairProb: 0.41 },
          ],
        },
        HHAD: {
          ...structuredClone(m001.pools.HHAD),
          goalLine: "+1",
          options: [
            { key: "hh", label: "让胜", odds: 1.8, trend: 0, fairProb: 0.59 },
            { key: "hd", label: "让平", odds: 3.55, trend: 0, fairProb: 0.22 },
            { key: "ha", label: "让负", odds: 3.85, trend: 0, fairProb: 0.19 },
          ],
        },
      },
    };
    ctrl.applyAuthenticatedBundle({
      matches: [swapM2to1, m003],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 4 }, [
        swapM2to1,
        m003,
      ]),
    });
    setExactMultiple(4);
    ctrl.togglePick(swapM2to1, "HAD", "h");
    ctrl.togglePick(swapM2to1, "HAD", "d");
    ctrl.togglePick(swapM2to1, "HAD", "a");
    ctrl.togglePick(m003, "HAD", "a");
    await ctrl.flush();
    const unsafeSwap = {
      matchId: swapM2to1.id,
      title: "不败同义替换",
      betterChoice: "让球[+1让胜]",
      worseChoice: "胜平负[主胜+平]",
      edgePct: 5.2,
      detail: "测试",
      betterPicks: [{ poolCode: "HHAD" as const, optionKey: "hh" }],
      worsePicks: [
        { poolCode: "HAD" as const, optionKey: "h" },
        { poolCode: "HAD" as const, optionKey: "d" },
      ],
      poolCode: "HHAD" as const,
      optionKey: "hh",
    };
    const swapBlocked = ctrl.applyEquivalentSwap(unsafeSwap);
    assert.equal(
      swapBlocked,
      false,
      "Must block swap that would either create cross-pool parlay conflict or delete unrelated HAD:a"
    );
    assert.equal(
      ctrl
        .getState()
        .picks.some(
          (p) =>
            p.matchId === swapM2to1.id &&
            p.poolCode === "HAD" &&
            p.optionKey === "a"
        ),
      true,
      "Unrelated HAD:a pick on swapM2to1 must remain 100% intact!"
    );
    // Now remove swapM2to1:a so [h, d] <-> [+1 hh] is exact; verify both 2->1 and 1->2 verified swaps preserve exact stake and NEVER mutate state.multiple (4) in place!
    ctrl.togglePick(swapM2to1, "HAD", "a");
    await ctrl.flush();
    assert.equal(ctrl.applyEquivalentSwap(unsafeSwap), true);
    await ctrl.flush();
    const swapM1to2: MatchItem = {
      ...swapM2to1,
      id: "p03-plus1-1to2",
      pools: {
        ...swapM2to1.pools,
        HAD: {
          ...swapM2to1.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 3.0, trend: 0, fairProb: 0.3 },
            { key: "d", label: "平", odds: 3.2, trend: 0, fairProb: 0.28 },
            { key: "a", label: "客胜", odds: 2.1, trend: 0, fairProb: 0.42 },
          ],
        },
        HHAD: {
          ...swapM2to1.pools.HHAD,
          goalLine: "+1",
          options: [
            { key: "hh", label: "让胜", odds: 1.35, trend: 0, fairProb: 0.58 },
            { key: "hd", label: "让平", odds: 3.8, trend: 0, fairProb: 0.22 },
            { key: "ha", label: "让负", odds: 4.5, trend: 0, fairProb: 0.2 },
          ],
        },
      },
    };
    ctrl.applyAuthenticatedBundle({
      matches: [swapM1to2, m003],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 4 }, [
        swapM1to2,
        m003,
      ]),
    });
    setExactMultiple(4);
    ctrl.togglePick(swapM1to2, "HHAD", "hh");
    ctrl.togglePick(m003, "HAD", "a");
    await ctrl.flush();
    const reverseSwap = {
      matchId: swapM1to2.id,
      title: "不败拆分同义替换",
      betterChoice: "胜平负[主胜+平]",
      worseChoice: "让球[+1让胜]",
      edgePct: 9.8,
      detail: "测试",
      betterPicks: unsafeSwap.worsePicks,
      worsePicks: unsafeSwap.betterPicks,
      poolCode: "HAD" as const,
      optionKey: "h",
    };
    assert.equal(ctrl.applyEquivalentSwap(reverseSwap), true);
    await ctrl.flush();
    assert.equal(
      ctrl.getState().multiple,
      4,
      "applyEquivalentSwap must NEVER halve state.multiple in place"
    );

    // P0-4: SingleAuthGrant on live001 (+1让胜) trim-2way NEVER leaks across match change to live002 (-2让负)!
    const liveSlate = buildLiveNov23Slate();
    const [live001, live002] = liveSlate;
    ctrl.applyAuthenticatedBundle({
      matches: liveSlate,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, liveSlate),
    });
    setExactMultiple(1);
    ctrl.togglePick(live001, "HHAD", "hh");
    await ctrl.flush();
    ctrl.setSyntheticSingleMode("trim-2way");
    await ctrl.flush();
    await confirmDisplayedSyntheticTicket(ctrl, 22);
    assert.equal(ctrl.getState().syntheticSingleMode, "trim-2way");
    // Uncheck live001 via togglePick, then pick live002 (-2让负)
    ctrl.togglePick(live001, "HHAD", "hh");
    ctrl.togglePick(live002, "HHAD", "ha");
    await ctrl.flush();
    assert.equal(
      ctrl.getState().syntheticSingleMode,
      "full-3way",
      "Unchecking match 1 and picking match 2 must reset trim-2way grant back to full-3way"
    );
    assert.equal(
      ctrl.getState().workspace.effectiveReport.canCheckout,
      false,
      "live002 (-2让负) must enter pending-single-auth (¥0), NEVER silently mounting 14 CRS scores!"
    );
    assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 0);
    assert.equal(
      ctrl.getState().workspace.effectiveReport.selectionStatus,
      "pending-single-auth"
    );

    // Restore matches for P0-5: toggleBankerMatch with requireConfirmOnPassChange on 4串1 returns confirmation prompt before changing ¥32 -> ¥48!
    ctrl.applyAuthenticatedBundle({
      matches,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, matches),
    });
    setExactMultiple(1);
    for (const m of [m001, m002, m003, m004]) {
      ctrl.togglePick(m, "HAD", "h");
      ctrl.togglePick(m, "HAD", "d");
    }
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.effectiveReport.modeLabel, "4串1");
    assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 32);
    const bankerGuard = ctrl.toggleBankerMatch(m001.id, {
      requireConfirmOnPassChange: true,
    });
    assert.equal(bankerGuard.ok, false);
    assert.equal(bankerGuard.requiresConfirm, true);
    assert.equal(bankerGuard.preview?.beforeCost, 32);
    assert.equal(bankerGuard.preview?.afterCost, 48);
    assert.equal(
      ctrl.getState().workspace.effectiveReport.totalCost,
      32,
      "Unconfirmed banker click must NOT silently mutate 4串1 ¥32 to 3串1(1胆) ¥48"
    );

    // go-manual remediation invokes mobile navigation callback
    ctrl.applyPortfolioRemediationAction(
      {
        kind: "go-manual",
        label: "切换审单台",
        detail: "测试",
      },
      {
        onNavigateToAudit: () => {
          navigatedToAudit += 1;
        },
      }
    );
    assert.ok(navigatedToAudit >= 1);

    // P0-7: 6-match all-HAD 6串1 (3^6 = 729 lines, ¥1,458 <= 2,048 cap) seals full replayable snapshot & auto-settles!
    const sixMatches = matches.slice(0, 6);
    const picks729 = sixMatches.flatMap((m) =>
      (["h", "d", "a"] as const).map((k) => makePick(m, "HAD", k))
    );
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-audit-729-"));
    try {
      const sealed729 = sealAuthoritativePrintSnapshot({
        workspaceParams: {
          picks: picks729,
          multiple: 1,
          passSpec: { mode: "free", passSizes: [6] },
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: sixMatches.map((m) => m.id),
          budget: 1500,
          stance: "objective",
          unlockFullAgg: false,
        },
        authoritativeMatches: sixMatches,
      });
      assert.equal(sealed729.sealedFromWorkspace, true);
      assert.ok(sealed729.snapshot);
      assert.equal(sealed729.snapshot.lines.length, 729);
      assert.equal(sealed729.totalCost, 1458);

      const lm = createLedgerManager({ dataDir: tmpDir });
      lm.mutateUserLedger("u-729", {
        action: "set-daily-limit",
        dailyLimit: 5000,
      });
      const added = lm.mutateUserLedger(
        "u-729",
        {
          action: "add-entry",
          kind: "live",
          title: "6场全包测试",
          cost: sealed729.totalCost,
          betCount: 729,
          snapshot: sealed729.snapshot,
        },
        {
          authoritativeMatches: sixMatches,
          boardMeta: freshOfficialBoard,
          trustedServerSnapshot: true,
        }
      );
      assert.equal(added.ok, true);

      const resMap = new Map(
        sixMatches.map((m) => [
          m.id,
          {
            matchId: m.id,
            settled: true,
            h1: 1,
            a1: 0,
            h2: 2,
            a2: 0,
            halfScore: "1:0",
            fullScore: "2:0",
            isVoid: false,
          },
        ])
      );
      const settled729 = settleTicketSnapshotWithOfficialResults(
        sealed729.snapshot,
        resMap,
        { stakeCost: 1458 }
      );
      assert.equal(settled729.hitTicketCount, 1);
      assert.ok(settled729.settledReturn > 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 2 (Multiset Bijection & 3-Layer View-Model): enforces consolidateTerminalPhysicalSlips bijection, fixes unequal betCount=Σm, eliminates '共 73 组' & pins zero-payout split", () => {
    const matches = officialFixtureMatches as MatchItem[];
    const [m1, m2, m3, m4] = matches;

    // 1. HH + DD diagonal lines MUST NOT merge into [H,D]×[H,D]!
    const diagSlips = consolidateTerminalPhysicalSlips([
      {
        id: "diag-1",
        modeLabel: "2串1",
        multiple: 2,
        legs: [makePick(m1, "HAD", "h"), makePick(m2, "HAD", "h")],
      },
      {
        id: "diag-2",
        modeLabel: "2串1",
        multiple: 2,
        legs: [makePick(m1, "HAD", "d"), makePick(m2, "HAD", "d")],
      },
    ]);
    assert.equal(diagSlips.length, 2);
    assert.equal(
      diagSlips.reduce((acc: number, s: any) => acc + s.stakeUnits2Yuan, 0),
      4
    );

    // 2. Unequal ArchetypePlan (47 ¥2-units across 8 logical lines = ¥94) MUST report betCount = 47, logicalLineCount = 8!
    const mults8 = [12, 8, 7, 6, 5, 4, 3, 2]; // sum = 47 -> ¥94
    const plan94: ArchetypePlan = {
      key: "max-ev-utility",
      available: true,
      shortTab: "⚖️ 期望效用",
      badge: "期望效用",
      title: "不等倍测试方案",
      tagline: "测试",
      totalCost: 94,
      savedCash: 6,
      minReturn: 96,
      maxReturn: 220,
      winProb: 0.55,
      profitProb: 0.55,
      strictNetGainProb: 0.55,
      expectedValueRate: -0.15,
      underwaterCount: 0,
      vigPct: 12,
      missOneReturn: null,
      reasons: [],
      lines: mults8.map((mult, idx) => ({
        id: `ln-${idx + 1}`,
        roleLabel: `分块#${idx + 1}`,
        legs: [
          {
            ...makePick(matches[idx % 4], "HAD", idx % 2 === 0 ? "h" : "d"),
            kickoff: matches[idx % 4].kickoff,
          },
          {
            ...makePick(matches[(idx + 1) % 4], "HAD", idx < 4 ? "h" : "a"),
            kickoff: matches[(idx + 1) % 4].kickoff,
          },
        ],
        modeLabel: "2串1",
        multiple: mult,
        cost: mult * 2,
        unitPayout: 8.5,
        returnPayout: Number((8.5 * mult).toFixed(2)),
        netProfit: Number((8.5 * mult - 94).toFixed(2)),
        prob: 0.18,
      })),
    };
    const rep94 = archetypeToReport(plan94, matches);
    assert.equal(
      rep94.betCount,
      47,
      `¥94 plan with 8 logical lines MUST report betCount=47 (never 8!), got ${rep94.betCount}`
    );
    assert.equal(rep94.logicalLineCount, 8);
    assert.equal(rep94.stakeUnitsCount, 47);

    // 3. Problem 2 exact reproduction: 4 matches [H, D] in 2串1 (24 bets = ¥48, 6 physical slips, 72 winning scenarios + 1 zero summary)
    const picks24 = [m1, m2, m3, m4].flatMap((m) => [
      makePick(m, "HAD", "h"),
      makePick(m, "HAD", "d"),
    ]);
    const ws24 = evaluateQuantWorkspace(
      {
        picks: picks24,
        multiple: 1,
        passSpec: { mode: "free", passSizes: [2] },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m1.id, m2.id, m3.id, m4.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    const eff24 = ws24.effectiveReport;
    assert.equal(eff24.betCount, 24);
    assert.equal(eff24.totalCost, 48);
    assert.equal(eff24.physicalSlipCount, 6);
    assert.equal(eff24.consolidatedTickets, 6);

    const activeManualSlip = {
      sourceKind: "manual" as const,
      isAppliedPlan: false,
      isArchetypePlan: false,
      isAutoSynthetic: false,
      matchIds: [m1.id, m2.id, m3.id, m4.id],
      matchCount: 4,
      radarPickedMatchCount: 4,
      radarPickedLegCount: 8,
      manualAnchorLegCount: 8,
      systemExpandedLegCount: 0,
      totalLegCount: 8,
      drawerTitle: "我的手选",
      revertActionLabel: "",
      matches: [],
      legs: [],
      lines: [],
      budgetMismatchMeta: null,
    };
    const vm24 = buildAuditThreeLayerViewModel(
      eff24,
      activeManualSlip,
      null,
      1,
      "prob-first"
    );
    assert.equal(vm24.layer1.stakeUnitsCount, 24);
    assert.equal(vm24.layer1.totalCost, 48);
    assert.equal(vm24.layer1.physicalSlipCount, 6);
    assert.equal(vm24.layer3.headerCountText.includes("共 73 组"), false);
    assert.ok(vm24.layer3.headerCountText.includes("72 种中奖赛果情景"));
    assert.ok(vm24.layer3.pinnedZeroSummary.title.includes("整单无中奖票"));
    // Even under profit-first sort, pinnedZeroSummary stays separate & first winning scenario is sorted properly
    const vmProfitSort = buildAuditThreeLayerViewModel(
      eff24,
      activeManualSlip,
      null,
      1,
      "profit-first"
    );
    assert.equal(
      vmProfitSort.layer3.pinnedZeroSummary.title,
      vm24.layer3.pinnedZeroSummary.title
    );
    // Default prob-first puts highest-probability scenario first (NOT 0.4% 4-hit extreme!)
    assert.ok(
      vm24.layer3.scenarios[0].prob >=
        vm24.layer3.scenarios[vm24.layer3.scenarios.length - 1].prob
    );

    // 4. Pending-single-auth & >2,048 over-cap lifecycle separation
    const pendingPicks = [makePick(m1, "HHAD", "ha")];
    const pendingWs = evaluateQuantWorkspace(
      {
        picks: pendingPicks,
        multiple: 1,
        syntheticSingleMode: "off",
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m1.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.equal(
      resolveAuditCabinLifecycleState(
        { picks: pendingPicks, passRuleBlockReason: null },
        pendingWs.effectiveReport,
        { ...activeManualSlip, matchIds: [m1.id], matchCount: 1 }
      ).selectionStatus,
      "pending-single-auth"
    );
    const overCapPicks = [m1, m2, m3, m4].flatMap((m) =>
      m.pools.HAFU.options.map((o) => makePick(m, "HAFU", o.key))
    );
    const overCapRep = computeTruthReport(overCapPicks, 1, [m1, m2, m3, m4], {
      mode: "free",
      passSizes: [4],
    });
    assert.equal(overCapRep.basicExpandedCount, 6561);
    assert.equal(overCapRep.distributionStatus, "uncomputed-over-cap");
    assert.equal(overCapRep.zeroPayoutProb, 0);
    assert.equal(
      resolveAuditCabinLifecycleState(
        { picks: overCapPicks, passRuleBlockReason: null },
        overCapRep,
        activeManualSlip
      ).distributionStatus,
      "uncomputed-over-cap"
    );

    // 5. Title deduplication, board freshness header & checkoff signature binding
    assert.equal(
      dedupePlanTitle("期望效用 · 同向 2串1 分块 · 同向 2串1 分块"),
      "期望效用 · 同向 2串1 分块"
    );
    const fbMeta: BoardFreshnessMeta = {
      source: "cached-snapshot",
      boardState: "empty-board-fallback",
      lastValidBoardAt: 1700000000000,
      lastValidBoardClock: "11-23 12:15",
      isFallbackReadOnly: true,
      bannerText: "只读回退",
    };
    const fbHdr = buildBoardHeaderStatusText(8, fbMeta);
    assert.equal(fbHdr.text.includes("实盘 8 场"), false);
    assert.ok(fbHdr.text.includes("回退快照"));

    const eff24At2x = computeTruthReport(picks24, 2, matches, {
      mode: "free",
      passSizes: [2],
    });
    const poster1 = buildPosterSlipRows(
      eff24,
      withConfirmedSaleRights(matches),
      freshOfficialBoard,
      new Set(),
      "qv-1"
    );
    const poster2 = buildPosterSlipRows(
      eff24At2x,
      withConfirmedSaleRights(matches),
      freshOfficialBoard,
      new Set(),
      "qv-1"
    );
    assert.notEqual(
      poster1[0].checkKey,
      poster2[0].checkKey,
      "Poster checkKey must bind multiple + quoteVersion + lineSignature (never bare tk-0)"
    );
  });

  it("Slice 3 (Non-Monotone Breakeven Certificate, FOSD 3+1 Solver, HAFU+CRS Mixed Single, Void Removal, 1425m Cross-Day Hedge & +1 Away Card-Pan)", () => {
    const matches = buildLiveNov23Slate();
    const [m001, m002, m003, m004, , m006, m007, m008] = matches;

    // 1. Round 2 Discrete Non-Monotone Breakeven Counterexample (exact 12:15 production snapshot):
    //    周一001 [3.63, 3.50, 1.73] + 周一003 [主胜 3.76] + 周一004 [主胜 2.30] in 2串1 (7 tickets):
    //    ¥26 feasible, ¥38 feasible, ¥40 INFEASIBLE, ¥42 (3x) FEASIBLE (floor >= ¥47.76 > ¥42)!
    const snap001 = makeLiveMatch(m001, {
      id: "snap-001",
      matchNumStr: "周一001",
      home: "厄格里特",
      away: "卡尔马",
      had: [3.63, 3.5, 1.73],
      goalLine: "+1",
      hhad: [1.72, 3.45, 3.74],
    });
    const snap003 = makeLiveMatch(m003, {
      id: "snap-003",
      matchNumStr: "周一003",
      home: "蒙扎",
      away: "佛罗伦萨",
      had: [3.76, 3.8, 1.65],
      goalLine: "+1",
      hhad: [1.9, 3.4, 3.14],
    });
    const snap004 = makeLiveMatch(m004, {
      id: "snap-004",
      matchNumStr: "周一004",
      home: "索肖",
      away: "敦刻尔克",
      had: [2.3, 2.88, 2.85],
      goalLine: "-1",
      hhad: [4.8, 3.85, 1.49],
    });
    const sevenPicks = [
      makePick(snap001, "HAD", "h"),
      makePick(snap001, "HAD", "d"),
      makePick(snap001, "HAD", "a"),
      makePick(snap003, "HAD", "h"),
      makePick(snap004, "HAD", "h"),
    ];
    const sub3 = [snap001, snap003, snap004];
    const repAt38 = computeTruthReport(sevenPicks, 1, sub3, {
      mode: "free",
      passSizes: [2],
    });
    const optAt38 = optimizeBonusPlan(repAt38, sub3, "equal", {
      targetBudgetCost: 38,
    });
    const optAt40 = optimizeBonusPlan(repAt38, sub3, "equal", {
      targetBudgetCost: 40,
    });
    const repAt42 = computeTruthReport(sevenPicks, 3, sub3, {
      mode: "free",
      passSizes: [2],
    });
    const optAt42 = optimizeBonusPlan(repAt42, sub3, "equal", {
      targetBudgetCost: 42,
    });
    assert.equal(optAt38.breakevenCert.minFeasibleBudget, 26);
    assert.equal(optAt38.breakevenCert.isCurrentFeasible, "certified-feasible");
    assert.equal(optAt38.underwaterCount, 0);

    assert.equal(
      optAt40.breakevenCert.isCurrentFeasible,
      "certified-infeasible",
      "¥40 (N=20) on 7-ticket overlapping 2串1 is integer-infeasible despite ¥38 being feasible!"
    );
    assert.equal(optAt40.breakevenCert.nextFeasibleBudget, 42);

    assert.equal(
      optAt42.breakevenCert.isCurrentFeasible,
      "certified-feasible",
      "¥42 (N=21) MUST be certified-feasible without asking user to upgrade to ¥46!"
    );
    assert.equal(optAt42.underwaterCount, 0);
    assert.ok(
      optAt42.minReturn >= 47.75,
      `Expected ¥42 optimal conditional floor >= ¥47.76, got ¥${optAt42.minReturn}`
    );

    // 2. Problem 5 Core Case: 周一003/006/007/008 double-select [主胜+平] at ¥50:
    //    Eliminates 3.8% 4串1 lottery ticket; preserves all 8 user picks; activates Tier-1B & high-hit 2串1!
    const fourMatches = [m003, m006, m007, m008];
    const picks8 = fourMatches.flatMap((m) => [
      makePick(m, "HAD", "h"),
      makePick(m, "HAD", "d"),
    ]);
    const plans50 = generateParetoPortfolio(
      fourMatches,
      50,
      "objective",
      false,
      picks8
    ) as ArchetypePlan[];
    const [slot1, slot2, slot3] = plans50;
    assert.equal(slot1.available, true);
    assert.equal(slot1.slotTier, "tier-1b");
    assert.ok(
      slot1.badge.includes("允许局部回血") && slot1.badge.includes("非保本"),
      `Tier-1B Slot ① must badge 允许局部回血 · 非保本, got: ${slot1.badge}`
    );
    for (const activeSlot of [slot1, slot2, slot3]) {
      assert.equal(activeSlot.available, true);
      assert.ok(
        (activeSlot.objectiveStrictNetGainProb ??
          activeSlot.strictNetGainProb ??
          0) >= 0.25,
        `Slot ${activeSlot.key} must achieve >=25% objective strict net gain (never 3.8%!), got ${activeSlot.strictNetGainProb}`
      );
      assert.ok(
        (activeSlot.zeroPayoutProb ?? 1 - activeSlot.winProb) <= 0.5,
        `Slot ${activeSlot.key} wipeout prob must drop below 50% (vs old 96.2%), got ${activeSlot.zeroPayoutProb}`
      );
      // Verify 100% of all 8 user options (including secondary draw picks) are preserved!
      const coveredOptSigs = new Set(
        activeSlot.lines.flatMap((l) =>
          l.legs.map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
        )
      );
      assert.equal(
        coveredOptSigs.size,
        8,
        `Slot ${activeSlot.key} must preserve all 8 user-selected options without silent secondary-pick deletion`
      );
    }

    // Verify objective hard gates cannot be bypassed by subjective stance!
    const plansUpset = generateParetoPortfolio(
      fourMatches,
      50,
      "upset-watch",
      false,
      picks8
    ) as ArchetypePlan[];
    for (const p of plansUpset.slice(0, 3)) {
      if (!p.available) continue;
      assert.ok((p.objectiveStrictNetGainProb ?? 0) >= 0.12 - 1e-9);
    }

    // 3. Problem 1.2 Cross-Pool Independent Single: 周一002 (-2让负) discovers 9-leg (6 HAFU + 3 CRS) <= ¥24 vs 21-leg CRS >= ¥60!
    const m002SingleSub: MatchItem = {
      ...m002,
      pools: {
        ...m002.pools,
        HAD: { ...m002.pools.HAD, single: false },
        HHAD: { ...m002.pools.HHAD, single: false, goalLine: "-2" },
        HAFU: { ...m002.pools.HAFU, selling: true, single: true },
        CRS: { ...m002.pools.CRS, selling: true, single: true },
      },
    };
    const candsMinus2 = resolvePureSingleSubsetPoolCandidates(m002SingleSub, [
      makePick(m002SingleSub, "HHAD", "ha"),
    ]);
    assert.ok(candsMinus2.length >= 1);
    const bestMinus2 = candsMinus2[0];
    const singleCrs21 = candsMinus2.find(
      (c) => !c.isCrossPoolMixed && c.poolCode === "CRS"
    );
    assert.equal(bestMinus2.isCrossPoolMixed, true);
    assert.equal(bestMinus2.keptLegCount, 9);
    assert.ok(
      bestMinus2.minBalancedCost <= 36 &&
        (!singleCrs21 ||
          bestMinus2.minBalancedCost < singleCrs21.minBalancedCost * 0.6),
      `Expected 9-leg HAFU+CRS mixed single cost (${bestMinus2.minBalancedCost}) < 60% of 21-leg CRS (${singleCrs21?.minBalancedCost})`
    );
    const wsPendingM002 = evaluateQuantWorkspace(
      {
        picks: [makePick(m002SingleSub, "HHAD", "ha")],
        multiple: 1,
        syntheticSingleMode: "full-3way",
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m002SingleSub.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      [m002SingleSub, m003]
    );
    const pendingCards = buildPendingSingleCrossPoolCards(
      wsPendingM002.manualReport,
      wsPendingM002.effectiveReport
    );
    assert.ok(
      pendingCards.some(
        (c) => c.legCountBadge.includes("9") && c.costYuan <= 36
      ),
      "Pending-single guidance must surface the 9-leg HAFU+CRS low-cost mixed single option"
    );

    // 4. Expanded computeEquivalentArbitrages: detects TTG <-> CRS exact scoreline partition
    const ttgLagMatch: MatchItem = JSON.parse(JSON.stringify(m002));
    const s2Opt = ttgLagMatch.pools.TTG.options.find((o) => o.key === "s2")!;
    s2Opt.odds = 1.9;
    const eqArbs = computeEquivalentArbitrages(ttgLagMatch);
    assert.ok(
      eqArbs.some(
        (a: any) => a.isExactEventEquivalent && a.title.includes("2球")
      ),
      "computeEquivalentArbitrages must detect TTG 2球 <-> CRS {2:0,1:1,0:2} arbitrage"
    );

    // 5. Single-match void = 100% refund (P(R=C)=1.0, never 65% wipeout!) & Cross-day 1,425m hedge on numeric IDs
    const mMon: MatchItem = {
      ...m001,
      id: "2042942",
      matchNumStr: "周一001",
      kickoff: "02:00",
      kickoffDateTime: "2026-11-24 02:00:00",
      pools: {
        ...m001.pools,
        HAD: { ...m001.pools.HAD, single: true, canSingle: true },
      },
    };
    const mTue: MatchItem = {
      ...m004,
      id: "2042988",
      matchNumStr: "周二004",
      kickoff: "01:45",
      kickoffDateTime: "2026-11-25 01:45:00",
      pools: {
        ...m004.pools,
        HAD: { ...m004.pools.HAD, single: true, canSingle: true },
        HHAD: { ...m004.pools.HHAD, single: true, canSingle: true },
      },
    };
    const wsSingleVoid = evaluateQuantWorkspace(
      {
        picks: [makePick(mMon, "HAD", "h")],
        multiple: 5,
        voidMatchIds: [mMon.id],
        simVoidFirstMatch: false,
        subjectiveDeltaPct: 0,
        planSpec: null,
        targetIds: [mMon.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      [mMon, mTue]
    );
    assert.equal(wsSingleVoid.effectiveReport.totalCost, 10);
    assert.equal(wsSingleVoid.effectiveReport.minPayout, 10);
    assert.equal(wsSingleVoid.effectiveReport.breakEvenProb, 1);
    assert.equal(wsSingleVoid.effectiveReport.zeroPayoutProb, 0);
    assert.ok(wsSingleVoid.baselineReport!.zeroPayoutProb > 0.3);

    const repCross = computeTruthReport(
      [makePick(mMon, "HAD", "a"), makePick(mTue, "HAD", "h")],
      5,
      [mMon, mTue]
    );
    const insCross = computeProOrderInsights(
      [makePick(mMon, "HAD", "a"), makePick(mTue, "HAD", "h")],
      repCross,
      [mMon, mTue]
    );
    assert.equal(insCross.hedge.available, true);
    assert.equal(
      insCross.hedge.gapMinutes,
      1425,
      `Expected cross-day 23h45m = 1425 minutes on numeric Sporttery IDs, got ${insCross.hedge.gapMinutes}`
    );

    // 6. +1 Away-Favorite Card-Pan Direction: 周一001 (+1) warns against chasing 让负 (NEVER 让胜!)
    const mq001 = analyzeMatchMicroQuant(m001);
    assert.equal(mq001.handicapGoalLine, 1);
    assert.equal(mq001.favoriteCoverLabel, "让负");
    assert.equal(mq001.underdogHoldLabel, "让胜");
    assert.equal(
      mq001.cardPanTip.includes("慎追「让胜」") ||
        mq001.cardPanTip.includes("慎追让胜"),
      false,
      `+1 away-favorite cardPanTip must NEVER warn against 让胜: ${mq001.cardPanTip}`
    );
    const digest001 = buildMatchIntelDigest({ ...m001, microQuant: mq001 });
    assert.equal(
      digest001.cardPanAlert.tip.includes("慎追让胜") ||
        digest001.cardPanAlert.tip.includes("慎追「让胜」"),
      false,
      `buildMatchIntelDigest on +1 away favorite must NEVER say 慎追让胜: ${digest001.cardPanAlert.tip}`
    );
  });

  it("Slice 4 (Codex Ultra Red-Team Counterexample & Full-Chain Bijection Lock): locks 4x11/4x6 physical slips, 2.27M-iter breakeven witness, C===B & Objective Slot 4 gates, equal-stake swap, SingleAuthGrant SP-tick lock, strict match/goalLine/async race & QUOTE_DRIFTED seal", async () => {
    const slate = buildLiveNov23Slate();
    const [m001, m002, m003, m004, m005, m006, m007, m008] = slate;
    const m4 = [m001, m003, m004, m006];

    // 1. Authentic 4串11×1 (¥22) physical slip bijection (1 slip ¥22, NEVER 11 fake "4串11 ¥2" slips!)
    const picks4Single = m4.map((m) => makePick(m, "HAD", "h"));
    const rep4x11 = computeTruthReport(picks4Single, 1, m4, {
      mode: "combo",
      comboCode: "4x11",
    });
    assert.equal(rep4x11.betCount, 11);
    assert.equal(rep4x11.totalCost, 22);
    assert.equal(
      rep4x11.physicalSlips?.length,
      1,
      `4串11×1 MUST consolidate into 1 authentic physical slip of ¥22, got ${rep4x11.physicalSlips?.length}`
    );
    assert.equal(rep4x11.physicalSlips![0].modeLabel, "4串11");
    assert.equal(rep4x11.physicalSlips![0].comboCode, "4x11");
    assert.equal(rep4x11.physicalSlips![0].costYuan, 22);
    assert.equal(rep4x11.physicalSlips![0].stakeUnits2Yuan, 11);
    const expanded4x11 = expandTerminalPhysicalSlipMultiset(
      rep4x11.physicalSlips![0]
    );
    assert.equal(expanded4x11.size, 11);
    assert.equal(
      (Array.from(expanded4x11.values()) as number[]).reduce(
        (a, b) => a + b,
        0
      ),
      11
    );

    // 2. Unified physicalSlips across WeChat, Poster & Ledger Title + Per-Pair 2×2 Cartesian Completeness
    const picks4Double = m4.flatMap((m) => [
      makePick(m, "HAD", "h"),
      makePick(m, "HAD", "d"),
    ]);
    const ctrl24 = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
    });
    ctrl24.applyAuthenticatedBundle({
      matches: m4,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, m4),
    });
    for (const pk of picks4Double) {
      ctrl24.togglePick(
        m4.find((m) => m.id === pk.matchId)!,
        pk.poolCode,
        pk.optionKey
      );
    }
    ctrl24.toggleFreePassSize(2);
    if (ctrl24.getState().passSpec.passSizes?.includes(4)) {
      ctrl24.toggleFreePassSize(4);
    }
    await ctrl24.flush();
    const wechat24 = ctrl24.formatShopkeeperWeChatSlip();
    const wechatTicketRows = wechat24
      .split("\n")
      .filter((x) => /^票\d+/.test(x));
    const poster24 = buildPosterSlipRows(
      ctrl24.getState().workspace.effectiveReport,
      ctrl24.getState().matches,
      ctrl24.getState().workspace.boardMeta,
      new Set()
    );
    assert.equal(
      ctrl24.getState().workspace.effectiveReport.physicalSlips?.length,
      6
    );
    assert.equal(
      wechatTicketRows.length,
      6,
      "WeChat slip export MUST read physicalSlips (6 slips, never 票1..票24!)"
    );
    assert.equal(
      poster24.length,
      6,
      "Poster slip rows MUST read physicalSlips (6 rows, never 24!)"
    );

    // Per-pair 2×2 Cartesian completeness check (distinguishes [H,D]×[H,D] 4 bets from diagonal [HH, DD] 2 bets!)
    const portPlans50 = generateParetoPortfolio(
      [m003, m006, m007, m008],
      50,
      "objective",
      false,
      [m003, m006, m007, m008].flatMap((m) => [
        makePick(m, "HAD", "h"),
        makePick(m, "HAD", "d"),
      ])
    ) as ArchetypePlan[];
    for (const pl of portPlans50.slice(0, 3)) {
      assert.equal(pl.available, true);
      const combosByMatchTuple = new Map<string, Set<string>>();
      for (const ln of pl.lines) {
        const sortedLegs = [...ln.legs].sort((a, b) =>
          a.matchId.localeCompare(b.matchId)
        );
        const tupleKey = sortedLegs.map((g) => g.matchId).join("|");
        const optKey = sortedLegs
          .map((g) => `${g.poolCode}:${g.optionKey}`)
          .join("×");
        if (!combosByMatchTuple.has(tupleKey)) {
          combosByMatchTuple.set(tupleKey, new Set());
        }
        combosByMatchTuple.get(tupleKey)!.add(optKey);
      }
      for (const [tupleKey, optSet] of combosByMatchTuple.entries()) {
        const kOrder = tupleKey.split("|").length;
        assert.equal(
          optSet.size,
          2 ** kOrder,
          `Retained match subset ${tupleKey} in ${pl.key} MUST cover full 2^${kOrder}=${2 ** kOrder} Cartesian product, got ${optSet.size}`
        );
      }
    }

    // 4-match 2串1×5 (¥60): logicalLineCount=6, stakeUnitsCount=30, sealed title MUST say 6种×5倍（共30注） (never "6注方案"!)
    const sealed6x5 = sealAuthoritativePrintSnapshot({
      workspaceParams: {
        picks: picks4Single,
        multiple: 5,
        passSpec: { mode: "free", passSizes: [2] },
      },
      authoritativeMatches: m4,
      entryKind: "paper",
    });
    assert.equal(sealed6x5.logicalLineCount, 6);
    assert.equal(sealed6x5.stakeUnitsCount, 30);
    assert.equal(sealed6x5.physicalSlipCount, 6);
    assert.equal(sealed6x5.title.includes("6注方案"), false);
    assert.ok(sealed6x5.title.includes("共30注"));

    // 3. Fixed 4串6×5 (¥60) uniform linkage lock + lossless consolidateTickets (0.00 floor loss)
    const rep4x6 = computeTruthReport(picks4Single, 5, m4, {
      mode: "combo",
      comboCode: "4x6",
    });
    const opt4x6Locked = optimizeBonusPlan(rep4x6, m4, "hot-first", {
      consolidateTickets: true,
    });
    assert.deepEqual(
      opt4x6Locked.lines.map((l: any) => l.multiple),
      [5, 5, 5, 5, 5, 5],
      "Fixed 4串6 without allowUnbundleCombo MUST preserve uniform linkage [5,5,5,5,5,5]"
    );
    assert.equal(opt4x6Locked.requiresComboUnbundleConfirm, true);
    assert.equal(opt4x6Locked.lockedComboCode, "4x6");
    const opt4x6Unbundled = optimizeBonusPlan(rep4x6, m4, "hot-first", {
      allowUnbundleCombo: true,
      consolidateTickets: true,
    });
    assert.equal(Boolean(opt4x6Unbundled.requiresComboUnbundleConfirm), false);
    assert.equal(
      opt4x6Unbundled.lines.every((l: any) => l.modeLabel === "2串1"),
      true
    );

    const picks3Double = [m001, m003, m004].flatMap((m) => [
      makePick(m, "HAD", "h"),
      makePick(m, "HAD", "d"),
    ]);
    const rep3At100x = computeTruthReport(
      picks3Double,
      100,
      [m001, m003, m004],
      {
        mode: "free",
        passSizes: [2],
      }
    );
    const optRaw = optimizeBonusPlan(rep3At100x, [m001, m003, m004], "equal", {
      consolidateTickets: false,
    });
    const optCons = optimizeBonusPlan(rep3At100x, [m001, m003, m004], "equal", {
      consolidateTickets: true,
    });
    assert.ok(
      Math.abs(optCons.minReturn - optRaw.minReturn) < 1e-6,
      `consolidateTickets MUST preserve minReturn without 3% loss: raw=${optRaw.minReturn}, cons=${optCons.minReturn}`
    );

    // 4. Codex 2.27M-iteration 8-ticket market witness ([2,6,2,2,2,2,2,2] @ ¥40 -> floor ¥43.24) + boundaries + brute-force parity + timeout copy
    const toyOdds = [
      [4.03, 2.69, 4.5],
      [3.18, 2.2, 3.63],
    ];
    const toyMatches: MatchItem[] = [m001, m003].map((base, idx) => ({
      ...structuredClone(base),
      id: `codex-market-toy-${idx}`,
      pools: {
        ...structuredClone(base.pools),
        HAD: {
          ...base.pools.HAD,
          single: true,
          canSingle: true,
          selling: true,
          canAllUp: true,
          options: (["h", "d", "a"] as const).map((k, j) => ({
            ...base.pools.HAD.options.find((o) => o.key === k)!,
            odds: toyOdds[idx][j],
          })),
        },
      },
    }));
    const toyLineSpecs = [
      [1, 1],
      [-1, 2],
      [2, 1],
      [-1, 1],
      [1, -1],
      [1, 0],
      [0, 1],
      [0, 0],
    ];
    const toyWitness = [2, 6, 2, 2, 2, 2, 2, 2];
    const toyBaseLines = toyLineSpecs.map((spec, li) => ({
      id: `toy-ln-${li}`,
      multiple: toyWitness[li],
      legs: spec.flatMap((optIdx, mi) => {
        if (optIdx < 0) return [];
        const optKey = (["h", "d", "a"] as const)[optIdx];
        return [makePick(toyMatches[mi], "HAD", optKey)];
      }),
    }));
    const toyOpt = optimizeBonusPlan(null, toyMatches, "equal", {
      baseLines: toyBaseLines,
    });
    assert.equal(
      toyOpt.breakevenCert.isCurrentFeasible,
      "certified-feasible",
      "Codex [2,6,2,2,2,2,2,2] ¥40 -> ¥43.24 witness MUST be certified-feasible!"
    );
    assert.ok(toyOpt.minReturn >= 43.239);

    // Boundary checks (K=2, N=1) & (K=11, N=10001) + verifyBreakevenWitness
    const diag2 = [
      [400, 0],
      [0, 400],
    ];
    const certK2N1 = certifyAndSolveJointBreakeven(diag2, 2, 1);
    assert.equal(certK2N1.cert.isCurrentFeasible, "certified-infeasible");
    assert.equal(certK2N1.cert.minFeasibleBudget, 4);
    assert.equal(certK2N1.cert.nextFeasibleBudget, 4);
    assert.equal(verifyBreakevenWitness(diag2, 2, 1, [1, 1]), false);
    assert.equal(verifyBreakevenWitness(diag2, 2, 2, [1, 1]), true);

    const diag11 = Array.from({ length: 11 }, (_, i) =>
      Array.from({ length: 11 }, (__, j) => (i === j ? 3000 : 0))
    );
    const certK11Over = certifyAndSolveJointBreakeven(diag11, 11, 10001);
    assert.equal(certK11Over.cert.isCurrentFeasible, "certified-infeasible");
    assert.equal(certK11Over.cert.minFeasibleBudget, 22);

    // Brute-force oracle parity on asymmetric 4-ticket overlapping matrix across N = 4..12
    const asymRows = [
      [520, 0, 310, 0],
      [0, 480, 310, 0],
      [0, 0, 0, 790],
      [520, 480, 0, 0],
    ];
    for (let nTest = 4; nTest <= 12; nTest++) {
      let bruteFeasible = false;
      for (let a = 1; a <= nTest - 3; a++) {
        for (let b = 1; b <= nTest - a - 2; b++) {
          for (let c = 1; c <= nTest - a - b - 1; c++) {
            const d = nTest - a - b - c;
            if (verifyBreakevenWitness(asymRows, 4, nTest, [a, b, c, d])) {
              bruteFeasible = true;
            }
          }
        }
      }
      const solvedN = certifyAndSolveJointBreakeven(asymRows, 4, nTest);
      assert.equal(
        solvedN.cert.isCurrentFeasible,
        bruteFeasible ? "certified-feasible" : "certified-infeasible",
        `Brute-force parity mismatch at N=${nTest}`
      );
    }

    // 5-match double-select 2+3关 (120 lines, ¥480): unknown proofStatus MUST NEVER emit "已证无法全态保本"
    const m5 = [m001, m003, m004, m005, m006];
    const picks5Double = m5.flatMap((m) => [
      makePick(m, "HAD", "h"),
      makePick(m, "HAD", "d"),
    ]);
    const rep120 = computeTruthReport(picks5Double, 2, m5, {
      mode: "free",
      passSizes: [2, 3],
    });
    const opt120 = optimizeBonusPlan(rep120, m5, "hot-first", {
      timeBudgetMs: 5,
    });
    if (opt120.breakevenCert.isCurrentFeasible === "unknown") {
      assert.equal(
        opt120.reasons.join(" ").includes("已证无法全态保本"),
        false,
        "time-budget-unproved result must NEVER claim 已证无法全态保本"
      );
    }

    // 5. Unified Final Gate (C===B, unanchored 4m @ ¥10, single CRS 1:0 @ ¥20, same-budget Tier-1B @ ¥20, objective-only Slot ④)
    const free4At10 = generateParetoPortfolio(
      m4,
      10,
      "objective",
      false,
      []
    ) as ArchetypePlan[];
    for (const [idx, p] of free4At10.slice(0, 3).entries()) {
      assert.equal(p.available, true);
      assert.equal(p.totalCost, 10);
      assert.ok((p.zeroPayoutProb ?? 1) <= (idx === 1 ? 0.8 : 0.75) + 1e-9);
      assert.ok((p.strictNetGainProb ?? 0) >= 0.12 - 1e-9);
      assert.ok((p.objectiveEVRate ?? -1) >= -0.4 - 1e-9);
    }
    const crsSingle20 = generateParetoPortfolio(
      [m001],
      20,
      "objective",
      false,
      [makePick(m001, "CRS", "1:0")]
    ) as ArchetypePlan[];
    assert.equal(
      crsSingle20[2].available,
      false,
      "Single-match CRS 1:0 (~94% wipeout) MUST be blocked by Slot ③ final gate"
    );

    const stripSubPools = (m: MatchItem): MatchItem => ({
      ...m,
      pools: {
        ...m.pools,
        HAFU: { ...m.pools.HAFU, selling: false, options: [] },
        TTG: { ...m.pools.TTG, selling: false, options: [] },
        CRS: { ...m.pools.CRS, selling: false, options: [] },
      },
    });
    const f004 = stripSubPools(
      makeLiveMatch(m004, {
        id: "frontier-004",
        matchNumStr: "周一004",
        home: "索肖",
        away: "敦刻尔克",
        had: [2.3, 2.77, 2.91],
        goalLine: "-1",
        hhad: [5.25, 3.85, 1.45],
      })
    );
    const f008 = stripSubPools(
      makeLiveMatch(m008, {
        id: "frontier-008",
        matchNumStr: "周一008",
        home: "波尔图B",
        away: "费伦斯",
        had: [2.25, 3.18, 2.63],
        goalLine: "-1",
        hhad: [4.95, 4.05, 1.45],
      })
    );
    const f005 = stripSubPools(
      makeLiveMatch(m005, {
        id: "frontier-005",
        matchNumStr: "周一005",
        home: "亚眠",
        away: "红星",
        had: [2.22, 3.15, 2.69],
        goalLine: "-1",
        hhad: [4.72, 4.05, 1.47],
      })
    );
    const fTue004 = stripSubPools(
      makeLiveMatch(m006, {
        id: "frontier-tue004",
        matchNumStr: "周二004",
        home: "阿贾克斯青年",
        away: "格拉夫夏普",
        had: [2.52, 3.75, 2.1],
        goalLine: "+1",
        hhad: [1.53, 4.25, 4.0],
      })
    );
    const tier1b20 = generateParetoPortfolio(
      [f004, f008, f005, fTue004],
      20,
      "objective",
      false,
      [
        makePick(f004, "HAD", "h"),
        makePick(f004, "HAD", "d"),
        makePick(f008, "HAD", "h"),
        makePick(f008, "HAD", "d"),
        makePick(f005, "HAD", "h"),
        makePick(f005, "HAD", "d"),
        makePick(fTue004, "HAD", "a"),
        makePick(fTue004, "HAD", "d"),
      ]
    ) as ArchetypePlan[];
    assert.equal(
      tier1b20[0].available,
      true,
      "Same-budget Tier-1B at ¥20 MUST NOT be suppressed by higher-budget Tier-1A probe"
    );
    assert.equal(tier1b20[0].slotTier, "tier-1b");
    assert.equal(tier1b20[0].totalCost, 20);

    // Controlled lagged HAFU positive-EV fixture stays available across all 3 stances
    const alphaFixture: MatchItem = structuredClone(m001);
    alphaFixture.id = "codex-alpha-stance-fixture";
    for (const pc of ["HAD", "HHAD", "HAFU"] as const) {
      alphaFixture.pools[pc].updateDate = "2026-11-23";
      alphaFixture.pools[pc].updateTime =
        pc === "HAFU" ? "18:00:00" : "21:30:00";
    }
    alphaFixture.pools.HAFU.single = true;
    alphaFixture.pools.HAFU.canSingle = true;
    const aaOpt = alphaFixture.pools.HAFU.options.find((o) => o.key === "aa")!;
    aaOpt.odds = Number((aaOpt.odds * 1.45).toFixed(2));
    for (const st of ["objective", "home-lean", "upset-watch"] as const) {
      const s4BlockedNoSave = generateParetoPortfolio(
        [alphaFixture],
        100,
        st,
        false,
        [],
        { allowSaveCash: false }
      )[3] as ArchetypePlan;
      assert.equal(
        s4BlockedNoSave.available,
        false,
        `ADR-0019 C===B: Slot ④ 36% light-stake (¥36 < ¥100) must require save-cash confirmation when allowSaveCash=false (stance=${st})`
      );
      assert.ok(
        s4BlockedNoSave.remediationActions?.some(
          (a) => a.kind === "save-cash-preview" && a.previewCost === 36
        )
      );

      const s4 = generateParetoPortfolio([alphaFixture], 100, st, false, [], {
        allowSaveCash: true,
      })[3] as ArchetypePlan;
      assert.equal(
        s4.available,
        true,
        `Objective +EV Slot ④ must remain available under stance=${st} when allowSaveCash=true`
      );
      assert.equal(s4.totalCost, 36);
      assert.ok((s4.objectiveEVRate ?? 0) > 0);
    }

    // 6. Equal-stake statewise-non-decreasing equivalent swap (CRS 1:0 + 0:1 ¥4 -> TTG:s1 × 2 ¥4, never ¥2!)
    const mSwap: MatchItem = structuredClone(m001);
    mSwap.pools.CRS.single = true;
    mSwap.pools.CRS.canSingle = true;
    mSwap.pools.TTG.single = true;
    mSwap.pools.TTG.canSingle = true;
    mSwap.pools.TTG.options.find((o) => o.key === "s1")!.odds = 11.0;
    const swaps = computeEquivalentArbitrages(mSwap, {
      includeCoarseOverSubPoolVigGap: true,
    });
    const ttg1Swap = swaps.find(
      (x: any) =>
        x.betterPicks.length === 1 &&
        x.betterPicks[0].poolCode === "TTG" &&
        x.betterPicks[0].optionKey === "s1"
    );
    assert.ok(ttg1Swap, "Expected CRS {1:0,0:1} -> TTG 1球 equivalent swap");
    const ctrlSwap = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
    });
    ctrlSwap.applyAuthenticatedBundle({
      matches: [mSwap],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, [mSwap]),
    });
    ctrlSwap.setDirectMultiple(1);
    for (const wp of ttg1Swap.worsePicks) {
      ctrlSwap.togglePick(mSwap, wp.poolCode, wp.optionKey);
    }
    await ctrlSwap.flush();
    const beforeSwapRep = ctrlSwap.getState().workspace.effectiveReport;
    assert.equal(beforeSwapRep.totalCost, 4);
    const swapApplied = ctrlSwap.applyEquivalentSwap(ttg1Swap);
    assert.equal(swapApplied, true);
    await ctrlSwap.flush();
    const afterSwapRep = ctrlSwap.getState().workspace.effectiveReport;
    assert.equal(
      afterSwapRep.totalCost,
      4,
      "Equivalent swap MUST preserve ¥4 stake via executableSwapMultiple=2 (never drop to ¥2!)"
    );
    assert.ok(
      afterSwapRep.minPayout >=
        Math.max(...(beforeSwapRep.tickets ?? []).map((t) => t.totalPayout)) -
          1e-6
    );

    // 7. Each coverage mode needs its own accepted quote. A price tick revokes it.
    const mAuth: MatchItem = {
      ...structuredClone(m001),
      pools: {
        ...structuredClone(m001.pools),
        HAD: { ...m001.pools.HAD, single: false, canSingle: false },
        HHAD: {
          ...m001.pools.HHAD,
          single: false,
          canSingle: false,
          goalLine: "+1",
        },
        HAFU: { ...m001.pools.HAFU, single: true, canSingle: true },
      },
    };
    const ctrlAuth = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
    });
    ctrlAuth.applyAuthenticatedBundle({
      matches: [mAuth],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, [mAuth]),
    });
    ctrlAuth.setDirectMultiple(1);
    ctrlAuth.togglePick(mAuth, "HHAD", "hh");
    await ctrlAuth.flush();
    assert.equal(
      ctrlAuth.getState().workspace.effectiveReport.canCheckout,
      false
    );
    const fullPreview =
      ctrlAuth.getState().workspace.effectiveReport.partialCoveragePreview;
    assert.ok(fullPreview);
    assert.ok(ctrlAuth.confirmPartialCoverageSingle(fullPreview).ok);
    await ctrlAuth.flush();
    await confirmDisplayedSyntheticTicket(ctrlAuth, fullPreview.previewCost);
    assert.equal(
      ctrlAuth.getState().workspace.effectiveReport.canCheckout,
      true
    );
    const fullCost = ctrlAuth.getState().workspace.effectiveReport.totalCost;
    const grantFull = ctrlAuth.getState().singleAuthGrant!;
    assert.equal(grantFull.mode, "partial-cover");
    assert.equal(grantFull.exactCost, fullCost);

    ctrlAuth.setSyntheticSingleMode("trim-2way");
    await ctrlAuth.flush();
    await confirmDisplayedSyntheticTicket(ctrlAuth, 22);
    assert.equal(
      ctrlAuth.getState().workspace.effectiveReport.canCheckout,
      true
    );
    const trimCost = ctrlAuth.getState().workspace.effectiveReport.totalCost;
    const grantTrim = ctrlAuth.getState().singleAuthGrant!;
    assert.ok(trimCost < fullCost);
    assert.equal(grantTrim.mode, "trim-2way");
    assert.equal(grantTrim.exactCost, trimCost);
    assert.notEqual(
      grantTrim.coveredMaskSig,
      grantFull.coveredMaskSig,
      "The trimmed grant must bind its own coverage and accepted total"
    );

    // +0.01 SP tick on one covered HAFU leg MUST invalidate singleAuthGrant
    const tickedMatch: MatchItem = structuredClone(mAuth);
    const activeLegKey =
      ctrlAuth.getState().workspace.appliedPlan?.lines?.[0]?.legs?.[0]
        ?.optionKey ?? "hh";
    const tickedOpt = tickedMatch.pools.HAFU.options.find(
      (o) => o.key === activeLegKey
    )!;
    tickedOpt.odds = Number((tickedOpt.odds + 0.01).toFixed(2));
    ctrlAuth.applyMatchesSync({
      matches: [tickedMatch],
      workspace: evaluateQuantWorkspace(ctrlAuth.buildWorkspaceParams(), [
        tickedMatch,
      ]),
    });
    await ctrlAuth.flush();
    assert.equal(
      ctrlAuth.getState().workspace.effectiveReport.canCheckout,
      false,
      "+0.01 SP tick MUST invalidate SingleAuthGrant until user re-confirms"
    );

    // 8. Cross-week matchNumStr collision rejection, goalLine -1 -> +1 signature/pick invalidation, async stale response & QUOTE_DRIFTED seal guard
    const memStore = (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
          map.set(k, v);
        },
        removeItem: (k: string) => {
          map.delete(k);
        },
      };
    })();
    const ctrlWeek1 = createBetSlipController({
      debounceMs: 0,
      storagePort: memStore,
      getAccountId: () => "u-week-lock",
      computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
    });
    ctrlWeek1.applyAuthenticatedBundle({
      matches: [m001, m003],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, [
        m001,
        m003,
      ]),
    });
    ctrlWeek1.togglePick(m001, "HAD", "h");
    ctrlWeek1.togglePick(m003, "HAD", "h");
    await ctrlWeek1.flush();

    const nextWeekMatches: MatchItem[] = [m001, m003].map((m, idx) => ({
      ...structuredClone(m),
      id: `next-week-${idx + 900}`,
      home: `下周新主队${idx}`,
      away: `下周新客队${idx}`,
    }));
    const ctrlWeek2 = createBetSlipController({
      debounceMs: 0,
      storagePort: memStore,
      getAccountId: () => "u-week-lock",
      computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
    });
    ctrlWeek2.applyAuthenticatedBundle({
      matches: nextWeekMatches,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        { picks: [], multiple: 1 },
        nextWeekMatches
      ),
    });
    await ctrlWeek2.flush();
    assert.equal(
      ctrlWeek2.getState().picks.length,
      0,
      "Cross-week matches sharing matchNumStr MUST NOT inherit last week's draft!"
    );

    // Signed goalLine flip (+1 -> -1) with identical SP changes both client & server signatures and invalidates HHAD pick
    const flippedGoalMatch: MatchItem = {
      ...structuredClone(m001),
      pools: {
        ...structuredClone(m001.pools),
        HHAD: { ...m001.pools.HHAD, goalLine: "-1" },
      },
    };
    const sigBeforeFlip = computeClientPortfolioQuoteMeta({
      matches: [m001, m003],
      targetIds: [m001.id, m003.id],
      picks: [makePick(m001, "HHAD", "hh"), makePick(m003, "HAD", "h")],
      budget: 20,
      stance: "objective",
      allowSaveCash: false,
      passSpec: { mode: "follow-max-parlay" },
      unlockFullAgg: false,
    } as any).inputSig;
    const sigAfterFlip = computeClientPortfolioQuoteMeta({
      matches: [flippedGoalMatch, m003],
      targetIds: [m001.id, m003.id],
      picks: [makePick(m001, "HHAD", "hh"), makePick(m003, "HAD", "h")],
      budget: 20,
      stance: "objective",
      allowSaveCash: false,
      passSpec: { mode: "follow-max-parlay" },
      unlockFullAgg: false,
    } as any).inputSig;
    assert.notEqual(
      sigBeforeFlip,
      sigAfterFlip,
      "Signed goalLine flip (+1 -> -1) MUST alter quoteInputSig even when SP values are unchanged"
    );

    // Universal QUOTE_DRIFTED guard on sealAuthoritativePrintSnapshot (@3.63 -> @3.54) + fallback paper provenance persistence
    const reviewedDraft = ctrl24.buildSealedLedgerDraft()!;
    assert.ok(reviewedDraft);
    const driftedMatches = structuredClone(m4);
    driftedMatches[0].pools.HAD.options[0].odds = Number(
      (driftedMatches[0].pools.HAD.options[0].odds - 0.09).toFixed(2)
    );
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          workspaceParams: reviewedDraft.workspaceParams,
          authoritativeMatches: driftedMatches,
          entryKind: "paper",
        }),
      (err: any) => err?.code === "QUOTE_DRIFTED",
      "sealAuthoritativePrintSnapshot MUST reject @3.63 -> @3.54 odds drift with QUOTE_DRIFTED"
    );

    const tmpProv = fs.mkdtempSync(path.join(os.tmpdir(), "yj-prov-"));
    try {
      const lmProv = createLedgerManager({ dataDir: tmpProv });
      const paperRes = lmProv.mutateUserLedger(
        "u-prov",
        {
          action: "add-entry",
          kind: "paper",
          workspaceParams: reviewedDraft.workspaceParams,
        },
        {
          authoritativeMatches: m4,
          boardMeta: {
            quoteVersion: "qv-nov24",
            quotedAt: 1700001234000,
            syncedAt: 1700001235000,
            boardState: "timeout-fallback",
            source: "archived-snapshot",
            isFallbackReadOnly: true,
          },
        }
      );
      assert.equal(paperRes.ok, true);
      const savedEntry = lmProv.getUserLedger("u-prov").entries[0];
      assert.equal(savedEntry.quoteVersion, "qv-nov24");
      assert.equal(savedEntry.quotedAt, 1700001234000);
      assert.equal(savedEntry.boardState, "timeout-fallback");
      assert.equal(savedEntry.boardSource, "archived-snapshot");
    } finally {
      fs.rmSync(tmpProv, { recursive: true, force: true });
    }

    // 9. Post-finish cutoff hedge window (Tue 21:30 -> Wed 00:15: kickoffGap=165m, postFinishWindow=-85m <= 0 -> available:false!)
    //    & 2,560-line over-cap estimatedOverCapCost = ¥5,120
    const mTue2130: MatchItem = {
      ...structuredClone(m001),
      id: "hedge-2130",
      kickoff: "21:30",
      kickoffDateTime: "2026-11-24 21:30:00",
      pools: {
        ...m001.pools,
        HAD: { ...m001.pools.HAD, single: true, canSingle: true },
      },
    };
    const mWed0015: MatchItem = {
      ...structuredClone(m003),
      id: "hedge-0015",
      kickoff: "00:15",
      kickoffDateTime: "2026-11-25 00:15:00",
      pools: {
        ...m003.pools,
        HAD: { ...m003.pools.HAD, single: true, canSingle: true },
        HHAD: { ...m003.pools.HHAD, single: true, canSingle: true },
      },
    };
    const rep2130 = computeTruthReport(
      [makePick(mTue2130, "HAD", "a"), makePick(mWed0015, "HAD", "h")],
      10,
      [mTue2130, mWed0015]
    );
    const ins2130 = computeProOrderInsights(
      [makePick(mTue2130, "HAD", "a"), makePick(mWed0015, "HAD", "h")],
      rep2130,
      [mTue2130, mWed0015]
    );
    assert.equal(ins2130.hedge.kickoffGapMinutes, 165);
    assert.ok((ins2130.hedge.postFinishWindowMinutes ?? 0) < 0);
    assert.equal(
      ins2130.hedge.available,
      false,
      "Tue 21:30 finishes ~23:25 after 22:00 weekday cutoff -> post-finish hedge window MUST be unavailable!"
    );

    const picks2560 = m4.flatMap((m, idx) =>
      m.pools.TTG.options
        .slice(0, idx === 3 ? 5 : 8)
        .map((o) => makePick(m, "TTG", o.key))
    );
    const rep2560 = computeTruthReport(picks2560, 1, m4, {
      mode: "free",
      passSizes: [4],
    });
    assert.equal(rep2560.basicExpandedCount, 2560);
    assert.equal(rep2560.distributionStatus, "uncomputed-over-cap");
    assert.equal(rep2560.estimatedOverCapCost, 5120);

    // 10. Async stale-response rejection (in-flight multiple=4 must NEVER overwrite subsequent multiple=5 edit),
    //     sandbox void isolation on applied bonus plan, orphaned-banker block & non-destructive keep-cash
    let holdDeferred: { resolve?: () => void } | null = null;
    const ctrlAsync = createBetSlipController({
      debounceMs: 18,
      computeWorkspace: (p, list) => {
        const ws = evaluateQuantWorkspace(p, list);
        if (holdDeferred) {
          return new Promise((resolve) => {
            holdDeferred!.resolve = () => resolve(ws);
          });
        }
        return Promise.resolve(ws);
      },
    });
    ctrlAsync.applyAuthenticatedBundle({
      matches: [m001, m003],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, [
        m001,
        m003,
      ]),
    });
    ctrlAsync.setDirectMultiple(2);
    ctrlAsync.togglePick(m001, "HAD", "h");
    ctrlAsync.togglePick(m003, "HAD", "h");
    await ctrlAsync.flush();

    ctrlAsync.setDirectMultiple(4);
    holdDeferred = {};
    const staleInflight = ctrlAsync.flush();
    ctrlAsync.setDirectMultiple(5);
    assert.equal(
      ctrlAsync.buildSealedLedgerDraft(),
      null,
      "Stale workspace before flush MUST block buildSealedLedgerDraft()"
    );
    assert.equal(
      ctrlAsync.formatShopkeeperWeChatSlip(),
      "",
      "Stale workspace before flush MUST block WeChat slip export"
    );
    holdDeferred.resolve!();
    await staleInflight;
    assert.notEqual(
      ctrlAsync.getState().workspace.effectiveReport.totalCost,
      8,
      "Stale multiple=4 response (¥8) MUST NOT overwrite newer multiple=5 edit!"
    );
    holdDeferred = null;
    let lastSubscriberStale = true;
    const unsubStale = ctrlAsync.subscribe(() => {
      lastSubscriberStale = ctrlAsync.getState().livePortfolioQuote.isStale;
    });
    await ctrlAsync.flush();
    unsubStale();
    assert.equal(ctrlAsync.getState().workspace.effectiveReport.totalCost, 10);
    assert.equal(
      lastSubscriberStale,
      false,
      "Final subscribe() notification after async compute MUST observe isStale === false (never stuck on ⏳ 重算中…!)"
    );

    // Sandbox toggleVoidMatchId MUST NOT mutate activeSlip lines or revision, and keep-cash decline MUST preserve activeSlip
    ctrlAsync.togglePick(m001, "HAD", "d");
    ctrlAsync.setDirectMultiple(4);
    await ctrlAsync.flush();
    ctrlAsync.applyBonusOptimization("equal");
    await ctrlAsync.flush();
    const beforeVoidSnap = ctrlAsync.getState();
    const beforeActiveMults = beforeVoidSnap.activeSlip.lines.map(
      (l) => l.multiple
    );
    const beforeActivePayouts = beforeVoidSnap.activeSlip.lines.map(
      (l) => l.returnPayout
    );
    ctrlAsync.toggleVoidMatchId(m001.id);
    await ctrlAsync.flush();
    const afterVoidSnap = ctrlAsync.getState();
    assert.deepEqual(
      afterVoidSnap.activeSlip.lines.map((l) => l.returnPayout),
      beforeActivePayouts,
      "Sandbox void simulation MUST NOT mutate activeSlip line payouts!"
    );
    assert.equal(
      afterVoidSnap.activeSlip.revision,
      beforeVoidSnap.activeSlip.revision
    );
    ctrlAsync.toggleVoidMatchId(m001.id);
    await ctrlAsync.flush();

    ctrlAsync.applyPortfolioRemediationAction(
      { kind: "keep-cash", label: "暂不套用推荐", detail: "保留现有单" },
      { clearManualPicks: false }
    );
    await ctrlAsync.flush();
    assert.equal(ctrlAsync.getState().activeSlip.sourceKind, "bonus-opt");
    assert.deepEqual(
      ctrlAsync.getState().activeSlip.lines.map((l) => l.multiple),
      beforeActiveMults,
      "Declining recommendation via keep-cash MUST NOT wipe active bonus-optimized slip!"
    );

    // Deleting sole banker match from 2串1(1胆) MUST enter rule-blocked state rather than silently changing to free 2串1
    const ctrlBankerDel = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
    });
    ctrlBankerDel.applyAuthenticatedBundle({
      matches: m4,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, m4),
    });
    ctrlBankerDel.setDirectMultiple(1);
    for (const m of m4) ctrlBankerDel.togglePick(m, "HAD", "h");
    await ctrlBankerDel.flush();
    ctrlBankerDel.toggleFreePassSize(2);
    if (ctrlBankerDel.getState().passSpec.passSizes?.includes(4)) {
      ctrlBankerDel.toggleFreePassSize(4);
    }
    await ctrlBankerDel.flush();
    ctrlBankerDel.toggleBankerMatch(m4[0].id, { confirmed: true });
    await ctrlBankerDel.flush();
    assert.equal(
      ctrlBankerDel.getState().workspace.effectiveReport.totalCost,
      6
    );
    ctrlBankerDel.togglePick(m4[0], "HAD", "h");
    await ctrlBankerDel.flush();
    assert.equal(
      ctrlBankerDel.getState().workspace.effectiveReport.canCheckout,
      false,
      "Removing sole banker match MUST block checkout until user explicitly confirms dropping banker constraint!"
    );
    assert.ok(ctrlBankerDel.getState().manualDraft.passRuleBlockReason);
  });

  it("Slice 5 (Codex Ultra Round-2 Second-Order Counterexamples & Full-Stack Atomicity Lock): locks atomic multi-match/unrelated swaps, bound secondary single-auth revocation & same-poolCode identity, syncOfficialMatches revision isolation & expectedSlipLineSig, stale lower-pass-preview & 4x11 switch-main-pool preview, non-destructive pass/banker intent & radar activeSlip lock, unconsolidated 24-slip 3-channel parity, 4x6 1D uniform breakeven cert, <1.5% empty cold-zone L1=0, and Tue 21:30->Wed 11:10 overnight shop closure hedge", async () => {
    const m4 = (officialFixtureMatches as MatchItem[]).slice(0, 4);
    const [m0, m1, m2, m3] = m4;

    // 1. Atomic Equivalent Swap on 2-match parlay ([CRS 1:0, 0:1] × [HAD h, a] 2串1×3 = ¥24 -> exact [6, 6] without re-dutching!)
    //    AND 1-match with unrelated single-eligible pick ([CRS 1:0, 0:1, 2:0] = ¥6 -> [CRS:2:0 @ 1, TTG:s1 @ 2] playable ¥6!)
    const swapM0: MatchItem = structuredClone(m0);
    swapM0.pools.CRS.single = true;
    swapM0.pools.CRS.canSingle = true;
    swapM0.pools.TTG.single = true;
    swapM0.pools.TTG.canSingle = true;
    swapM0.pools.CRS.options = swapM0.pools.CRS.options.map((o) =>
      o.key === "1:0"
        ? { ...o, odds: 10.5 }
        : o.key === "0:1"
          ? { ...o, odds: 7.25 }
          : o.key === "2:0"
            ? { ...o, odds: 17.0 }
            : o
    );
    swapM0.pools.TTG.options = swapM0.pools.TTG.options.map((o) =>
      o.key === "s1" ? { ...o, odds: 5.5 } : o
    );
    const swapM1: MatchItem = structuredClone(m1);
    swapM1.pools.HAD.options = swapM1.pools.HAD.options.map((o) =>
      o.key === "h"
        ? { ...o, odds: 3.76 }
        : o.key === "a"
          ? { ...o, odds: 1.62 }
          : o
    );

    const makeSwapCtrl = (list: MatchItem[]) => {
      const c = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: (p, ml) => evaluateQuantWorkspace(p, ml),
      });
      c.applyAuthenticatedBundle({
        matches: list,
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, list),
      });
      c.setDirectMultiple(1);
      return c;
    };

    const cUnrelated = makeSwapCtrl([swapM0]);
    cUnrelated.togglePick(swapM0, "CRS", "1:0");
    cUnrelated.togglePick(swapM0, "CRS", "0:1");
    cUnrelated.togglePick(swapM0, "CRS", "2:0");
    await cUnrelated.flush();
    const tipUnrelated =
      cUnrelated.getState().workspace.insights.activeSwapTip!;
    assert.ok(tipUnrelated, "Expected activeSwapTip on [1:0, 0:1, 2:0]");
    assert.equal(cUnrelated.applyEquivalentSwap(tipUnrelated), true);
    await cUnrelated.flush();
    const repUnrelated = cUnrelated.getState().workspace.effectiveReport;
    assert.equal(repUnrelated.canCheckout, true);
    assert.equal(repUnrelated.totalCost, 6);
    assert.deepEqual(
      (repUnrelated.tickets ?? [])
        .map(
          (t) => `${t.legs![0].poolCode}:${t.legs![0].optionKey}@${t.multiple}`
        )
        .sort(),
      ["CRS:2:0@1", "TTG:s1@2"]
    );

    const cParlaySwap = makeSwapCtrl([swapM0, swapM1]);
    cParlaySwap.togglePick(swapM0, "CRS", "1:0");
    cParlaySwap.togglePick(swapM0, "CRS", "0:1");
    cParlaySwap.togglePick(swapM1, "HAD", "h");
    cParlaySwap.togglePick(swapM1, "HAD", "a");
    cParlaySwap.setDirectMultiple(3);
    await cParlaySwap.flush();
    const tipParlay = cParlaySwap.getState().workspace.insights.activeSwapTip!;
    assert.ok(tipParlay, "Expected activeSwapTip on 2-match parlay");
    assert.equal(cParlaySwap.applyEquivalentSwap(tipParlay), true);
    await cParlaySwap.flush();
    const repParlayAfter = cParlaySwap.getState().workspace.effectiveReport;
    assert.equal(repParlayAfter.canCheckout, true);
    assert.equal(repParlayAfter.totalCost, 24);
    assert.deepEqual(
      (repParlayAfter.tickets ?? []).map((t) => [t.multiple, t.totalPayout]),
      [
        [6, 248.16],
        [6, 106.92],
      ],
      "2-match equivalent swap MUST preserve exact verified [6, 6] multiples paying ¥248.16 (never re-dutching to [4, 8] ¥165.44!)"
    );

    // 2. Secondary Synthetic Single Auth Transaction & Same-poolCode Identity (-2让负 mixed CRS+HAFU vs pure CRS + +0.01 SP revocation)
    const deepMinus2: MatchItem = structuredClone(m0);
    deepMinus2.pools.HAD.single = false;
    deepMinus2.pools.HAD.canSingle = false;
    deepMinus2.pools.HHAD.single = false;
    deepMinus2.pools.HHAD.canSingle = false;
    deepMinus2.pools.HHAD.goalLine = "-2";
    deepMinus2.pools.HAFU.single = true;
    deepMinus2.pools.HAFU.canSingle = true;
    deepMinus2.pools.CRS.single = true;
    deepMinus2.pools.CRS.canSingle = true;
    deepMinus2.pools.TTG.single = true;
    deepMinus2.pools.TTG.canSingle = true;

    const cSingleAlt = makeSwapCtrl([deepMinus2]);
    cSingleAlt.togglePick(deepMinus2, "HHAD", "ha");
    await cSingleAlt.flush();
    const altCards = buildPendingSingleCrossPoolCards(
      cSingleAlt.getState().workspace.manualReport,
      cSingleAlt.getState().workspace.effectiveReport
    );
    assert.ok(
      altCards.length >= 2,
      "Expected >=2 single cross-pool cards on -2让负"
    );
    const secondaryCard = altCards[1];
    const confRes = cSingleAlt.confirmPartialCoverageSingle(
      secondaryCard.preview
    );
    await cSingleAlt.flush();
    assert.equal(confRes.ok, true);
    await confirmDisplayedSyntheticTicket(
      cSingleAlt,
      secondaryCard.preview.previewCost
    );
    assert.equal(
      cSingleAlt.getState().workspace.effectiveReport.canCheckout,
      true,
      "Same-poolCode secondary pure-CRS card MUST mount and check out cleanly!"
    );
    assert.equal(
      cSingleAlt.getState().workspace.effectiveReport.totalCost,
      secondaryCard.preview.previewCost
    );
    const draftBeforeTick = cSingleAlt.buildSealedLedgerDraft()!;
    assert.ok(draftBeforeTick);

    // Mutate one covered leg's SP by +0.01 -> MUST revoke grant AND clear planSpec AND block WeChat & authoritative seal!
    const coveredLeg = secondaryCard.preview.previewLines![0].legs[0];
    const tickedMatch: MatchItem = structuredClone(deepMinus2);
    const tickedOpt = tickedMatch.pools[coveredLeg.poolCode].options.find(
      (o) => o.key === coveredLeg.optionKey
    )!;
    tickedOpt.odds = Number((tickedOpt.odds + 0.01).toFixed(2));
    cSingleAlt.applyMatchesSync({
      matches: [tickedMatch],
      workspace: evaluateQuantWorkspace(cSingleAlt.buildWorkspaceParams(), [
        tickedMatch,
      ]),
    });
    await cSingleAlt.flush();
    assert.equal(cSingleAlt.getState().singleAuthGrant, null);
    assert.equal(cSingleAlt.getState().planSpec, null);
    assert.equal(
      cSingleAlt.getState().workspace.effectiveReport.canCheckout,
      false
    );
    assert.equal(cSingleAlt.getState().workspace.effectiveReport.totalCost, 0);
    assert.equal(cSingleAlt.formatShopkeeperWeChatSlip(), "");
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          workspaceParams: draftBeforeTick.workspaceParams,
          authoritativeMatches: [tickedMatch],
        }),
      (err: any) => err?.code === "QUOTE_DRIFTED"
    );

    // 3. Official Sync (syncOfficialMatches) concurrent edit isolation & expectedSlipLineSig same-cost guard
    let resolveDelayedSync!: () => void;
    const memStore = (() => {
      const mp = new Map<string, string>();
      return {
        getItem: (k: string) => mp.get(k) ?? null,
        setItem: (k: string, v: string) => mp.set(k, v),
        removeItem: (k: string) => mp.delete(k),
      };
    })();
    const wbSync = createWorkbenchController({
      debounceMs: 0,
      storagePort: memStore,
      quantPort: {
        computeWorkspace: (p, ml) => evaluateQuantWorkspace(p, ml),
        syncMatches: (params) => {
          const stalePacket = {
            workspace: evaluateQuantWorkspace(params, m4),
            matches: m4,
            syncNote: "delayed-sync",
          };
          return new Promise((resolve) => {
            resolveDelayedSync = () => resolve(stalePacket);
          });
        },
      },
    });
    wbSync.betSlip.applyAuthenticatedBundle({
      matches: m4,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, m4),
    });
    wbSync.betSlip.setDirectMultiple(2);
    wbSync.betSlip.togglePick(m0, "HAD", "h");
    wbSync.betSlip.togglePick(m1, "HAD", "h");
    await wbSync.betSlip.flush();
    const staleDraftBeforeEdit = wbSync.betSlip.buildSealedLedgerDraft()!;

    // Start official sync on [中国主胜 + 日本主胜] @ 2x = ¥4, then edit to [中国主胜 + 日本平] @ 2x = ¥4 BEFORE sync resolves
    const inFlightSync = wbSync.syncOfficialMatches();
    wbSync.betSlip.togglePick(m1, "HAD", "h");
    wbSync.betSlip.togglePick(m1, "HAD", "d");
    await wbSync.betSlip.flush();
    resolveDelayedSync();
    await inFlightSync;
    await wbSync.betSlip.flush();

    const wcAfterSync = wbSync.betSlip.formatShopkeeperWeChatSlip();
    assert.ok(
      wcAfterSync.includes("日本(胜平负·平)") &&
        !wcAfterSync.includes("日本(胜平负·主胜)"),
      `Stale syncOfficialMatches response MUST NOT overwrite WeChat slip back to 日本主胜: got ${wcAfterSync}`
    );
    const freshDraftAfterSync = wbSync.betSlip.buildSealedLedgerDraft()!;
    const sealedFresh = sealAuthoritativePrintSnapshot({
      workspaceParams: freshDraftAfterSync.workspaceParams,
      authoritativeMatches: m4,
    });
    assert.deepEqual(
      sealedFresh.snapshot.lines[0].legs.map((g: any) => g.optionKey),
      ["h", "d"]
    );
    // Forging same-cost ¥4 picks ([h, d]) with stale expectedSlipLineSig ([h, h]) MUST throw QUOTE_DRIFTED!
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          workspaceParams: {
            ...freshDraftAfterSync.workspaceParams,
            expectedSlipLineSig:
              staleDraftBeforeEdit.workspaceParams!.expectedSlipLineSig,
          },
          authoritativeMatches: m4,
        }),
      (err: any) => err?.code === "QUOTE_DRIFTED"
    );

    // 4. Stale lower-pass-preview rejection after pick edit + exact 4串11×3 = ¥66 switch-main-pool preview
    const cStaleRem = makeSwapCtrl(m4);
    cStaleRem.setBudget(20);
    for (const m of m4) cStaleRem.togglePick(m, "HAD", "h");
    await cStaleRem.flush();
    cStaleRem.toggleFreePassSize(4);
    if (cStaleRem.getState().passSpec.passSizes?.includes(2)) {
      cStaleRem.toggleFreePassSize(2);
    }
    await cStaleRem.flush();
    const lowerAct = cStaleRem
      .getState()
      .workspace.portfolioPlans.flatMap((p) => p.remediationActions ?? [])
      .find((x) => x.kind === "lower-pass-preview");
    if (lowerAct) {
      cStaleRem.togglePick(m0, "HAD", "h");
      cStaleRem.togglePick(m0, "HAD", "a");
      await cStaleRem.flush();
      const staleApplyRes = cStaleRem.applyPortfolioRemediationAction(
        lowerAct,
        {
          applyPreviewPlan: true,
        }
      );
      assert.equal(
        staleApplyRes.ok,
        false,
        "Applying stale lower-pass-preview after changing m0 pick h -> a MUST fail!"
      );
      assert.equal(cStaleRem.getState().activeSlip.sourceKind, "manual");
    }

    const cSwitch4x11 = makeSwapCtrl(m4);
    cSwitch4x11.setDirectMultiple(3);
    for (const m of m4) cSwitch4x11.togglePick(m, "TTG", "s0");
    await cSwitch4x11.flush();
    cSwitch4x11.selectComboPass("4x11");
    await cSwitch4x11.flush();
    const swPv = cSwitch4x11.previewSwitchMainPool();
    assert.equal(swPv.beforeBetCount, 11);
    assert.equal(swPv.afterBetCount, 11);
    assert.equal(swPv.beforeTotalCost, 66);
    assert.equal(swPv.afterTotalCost, 66);

    // 5. Non-destructive [2, 4] passSpec round-trip, surviving banker 4->2->3 round-trip, orphaned banker 4->3->1 block, & radar activeSlip protection
    const cPassRt = makeSwapCtrl(m4);
    for (const m of m4) cPassRt.togglePick(m, "HAD", "h");
    await cPassRt.flush();
    cPassRt.toggleFreePassSize(2);
    if (!cPassRt.getState().passSpec.passSizes?.includes(4)) {
      cPassRt.toggleFreePassSize(4);
    }
    await cPassRt.flush();
    assert.equal(cPassRt.getState().workspace.effectiveReport.totalCost, 14);
    cPassRt.togglePick(m3, "HAD", "h");
    await cPassRt.flush();
    assert.equal(cPassRt.getState().workspace.effectiveReport.totalCost, 6);
    cPassRt.togglePick(m3, "HAD", "h");
    await cPassRt.flush();
    assert.equal(
      cPassRt.getState().workspace.effectiveReport.totalCost,
      14,
      "Explicit [2, 4] passSpec MUST restore ¥14 when 4th match returns!"
    );

    const cBankerSurvive = makeSwapCtrl(m4);
    for (const m of m4) cBankerSurvive.togglePick(m, "HAD", "h");
    await cBankerSurvive.flush();
    cBankerSurvive.toggleFreePassSize(2);
    if (cBankerSurvive.getState().passSpec.passSizes?.includes(4)) {
      cBankerSurvive.toggleFreePassSize(4);
    }
    await cBankerSurvive.flush();
    cBankerSurvive.toggleBankerMatch(m0.id, { confirmed: true });
    await cBankerSurvive.flush();
    assert.equal(
      cBankerSurvive.getState().workspace.effectiveReport.totalCost,
      6
    );
    cBankerSurvive.togglePick(m3, "HAD", "h");
    cBankerSurvive.togglePick(m2, "HAD", "h");
    await cBankerSurvive.flush();
    assert.equal(
      cBankerSurvive.getState().workspace.effectiveReport.totalCost,
      2
    );
    cBankerSurvive.togglePick(m2, "HAD", "h");
    await cBankerSurvive.flush();
    assert.equal(
      cBankerSurvive.getState().workspace.effectiveReport.totalCost,
      4,
      "Surviving banker m0 MUST remain banker (2串1(1胆) = ¥4, not ¥6!) when 3rd match returns!"
    );

    // Orphaned banker reduced further to 1 match MUST remain blocked until clearOrphanedBankers()
    cBankerSurvive.togglePick(m0, "HAD", "h");
    await cBankerSurvive.flush();
    assert.equal(
      cBankerSurvive.getState().workspace.effectiveReport.canCheckout,
      false
    );
    cBankerSurvive.togglePick(m2, "HAD", "h");
    await cBankerSurvive.flush();
    assert.equal(cBankerSurvive.getState().picks.length, 1);
    assert.equal(
      cBankerSurvive.getState().workspace.effectiveReport.canCheckout,
      false,
      "Orphaned banker slip reduced to 1 match MUST stay blocked until explicit clearOrphanedBankers()!"
    );
    assert.equal(cBankerSurvive.formatShopkeeperWeChatSlip(), "");
    assert.equal(cBankerSurvive.buildSealedLedgerDraft(), null);
    cBankerSurvive.clearOrphanedBankers();
    await cBankerSurvive.flush();
    assert.equal(
      cBankerSurvive.getState().workspace.effectiveReport.canCheckout,
      true
    );

    // Radar togglePick while bonus [5, 3] ¥16 is active MUST NOT overwrite activeSlip
    const cRadarProtect = makeSwapCtrl(m4);
    cRadarProtect.setDirectMultiple(4);
    cRadarProtect.togglePick(m0, "HAD", "h");
    cRadarProtect.togglePick(m0, "HAD", "d");
    cRadarProtect.togglePick(m1, "HAD", "h");
    await cRadarProtect.flush();
    cRadarProtect.applyBonusOptimization("equal");
    await cRadarProtect.flush();
    const revLocked = cRadarProtect.getState().activeSlip.revision;
    const multsLocked = cRadarProtect
      .getState()
      .activeSlip.lines.map((l) => l.multiple);
    cRadarProtect.togglePick(m2, "HAD", "h");
    await cRadarProtect.flush();
    assert.equal(cRadarProtect.getState().activeSlip.sourceKind, "bonus-opt");
    assert.equal(cRadarProtect.getState().activeSlip.revision, revLocked);
    assert.deepEqual(
      cRadarProtect.getState().activeSlip.lines.map((l) => l.multiple),
      multsLocked
    );

    // 6. Unconsolidated physicalSlips 3-channel parity (24 === 24 === 24)
    const cUncons = makeSwapCtrl(m4);
    for (const m of m4) {
      cUncons.togglePick(m, "HAD", "h");
      cUncons.togglePick(m, "HAD", "d");
    }
    cUncons.toggleFreePassSize(2);
    if (cUncons.getState().passSpec.passSizes?.includes(4)) {
      cUncons.toggleFreePassSize(4);
    }
    cUncons.setDirectMultiple(2);
    await cUncons.flush();
    cUncons.applyBonusOptimization("equal");
    await cUncons.flush();
    assert.equal(cUncons.toggleTicketConsolidation().consolidated, false);
    await cUncons.flush();
    const stUncons = cUncons.getState();
    assert.equal(stUncons.activeAuditedSlip.physicalSlips!.length, 24);
    assert.ok(
      cUncons.formatShopkeeperWeChatSlip().includes("共24张实票 · 合计 ¥96")
    );
    const posterUncons = buildPosterSlipRows(
      stUncons.workspace.effectiveReport,
      stUncons.matches,
      stUncons.workspace.boardMeta,
      new Set(),
      "audit-user",
      stUncons.activeAuditedSlip.physicalSlips
    );
    assert.equal(posterUncons.length, 24);

    // 7. Fixed 4串6×5 1D uniform breakeven cert, <1.5% empty cold-zone L1=0, and Tue 21:30 -> Wed 11:10 overnight shop closure hedge
    const fixedOdds = [3.63, 3.76, 2.3, 2.22];
    const fixedM4 = m4.map((m, idx) => {
      const cl = structuredClone(m);
      cl.pools.HAD.options = cl.pools.HAD.options.map((o) =>
        o.key === "h" ? { ...o, odds: fixedOdds[idx] } : o
      );
      return cl;
    });
    const fixedPicks: SelectedPick[] = fixedM4.map((m) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: m.pools.HAD.single,
      optionKey: "h",
      optionLabel: "主胜",
      odds: m.pools.HAD.options.find((o) => o.key === "h")!.odds,
      fairProb: m.pools.HAD.options.find((o) => o.key === "h")!.fairProb,
    }));
    const rep4x6 = computeTruthReport(fixedPicks, 5, fixedM4, {
      mode: "combo",
      comboCode: "4x6",
    });
    assert.equal(rep4x6.betCountUnit, "logical-lines");
    assert.equal(
      rep4x6.breakevenCert?.isCurrentFeasible,
      "certified-infeasible"
    );
    assert.equal(rep4x6.breakevenCert?.minFeasibleBudget, null);
    assert.equal(rep4x6.breakevenCert?.conditionalFloorAtCurrent, 51.05);
    const opt4x6Locked = optimizeBonusPlan(rep4x6, fixedM4, "hot-first")!;
    assert.equal(
      opt4x6Locked.breakevenCert?.isCurrentFeasible,
      "certified-infeasible"
    );
    assert.equal(opt4x6Locked.breakevenCert?.minFeasibleBudget, null);
    const opt4x6Unbundled = optimizeBonusPlan(rep4x6, fixedM4, "hot-first", {
      allowUnbundleCombo: true,
    })!;
    assert.equal(
      opt4x6Unbundled.breakevenCert?.isCurrentFeasible,
      "certified-feasible"
    );
    assert.ok(opt4x6Unbundled.minReturn >= 60);

    // < 1.5% empty credible cold zone preserves mRef [2,2,...,2] (L1 = 0)
    const crsPicks12: SelectedPick[] = [
      ...["2:0", "2:1", "3:1", "3:2"].map((k) => {
        const o = m0.pools.CRS.options.find((x) => x.key === k)!;
        return {
          matchId: m0.id,
          matchNumStr: m0.matchNumStr,
          home: m0.home,
          away: m0.away,
          poolCode: "CRS" as const,
          poolName: "比分",
          singleAllowed: true,
          optionKey: k,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        };
      }),
      ...["1:1", "2:1", "3:1"].map((k) => {
        const o = m1.pools.CRS.options.find((x) => x.key === k)!;
        return {
          matchId: m1.id,
          matchNumStr: m1.matchNumStr,
          home: m1.home,
          away: m1.away,
          poolCode: "CRS" as const,
          poolName: "比分",
          singleAllowed: true,
          optionKey: k,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        };
      }),
    ];
    const repCrs12 = computeTruthReport(crsPicks12, 2, [m0, m1], {
      mode: "free",
      passSizes: [2],
    });
    assert.ok(
      repCrs12.combos.every((c) => c.prob < 0.015),
      "All 12 CRS parlay hit states must be < 1.5% so credible cold zone is empty"
    );
    const coldCrs12 = optimizeBonusPlan(repCrs12, [m0, m1], "cold-first")!;
    assert.deepEqual(
      coldCrs12.lines.map((l) => l.multiple),
      new Array(12).fill(2),
      "Empty credible cold zone (<1.5% across all states) MUST keep mRef [2,...,2] unchanged (L1=0)!"
    );

    // Tue 21:30 -> Wed 11:10 crosses overnight shop closure (22:00..11:00), leaving only 10 open selling minutes (<15m) -> available: false!
    const earlyTue: MatchItem = {
      ...m0,
      id: "30001",
      kickoff: "21:30",
      kickoffDateTime: "2026-11-24 21:30:00",
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: true, canSingle: true },
      },
    };
    const lateWed1110: MatchItem = {
      ...m1,
      id: "30002",
      kickoff: "11:10",
      kickoffDateTime: "2026-11-25 11:10:00",
      pools: {
        ...m1.pools,
        HAD: { ...m1.pools.HAD, single: true, canSingle: true },
        HHAD: {
          ...m1.pools.HHAD,
          single: true,
          canSingle: true,
          goalLine: "+1",
        },
      },
    };
    const cOvernightHedge = makeSwapCtrl([earlyTue, lateWed1110]);
    cOvernightHedge.setDirectMultiple(10);
    cOvernightHedge.togglePick(earlyTue, "HAD", "a");
    cOvernightHedge.togglePick(lateWed1110, "HAD", "h");
    await cOvernightHedge.flush();
    const hOvernight = cOvernightHedge.getState().workspace.insights.hedge!;
    assert.equal(hOvernight.available, false);
    assert.equal(hOvernight.postFinishWindowMinutes, 10);
  });

  it("Slice 6 (Codex R3 11-Item Zero-Disagreement Convergence): locks Intel Sheet whole-slip swap parity, stale swap rejection, monotonic out-of-order market sync, locked archetype seal & lower-only draft preservation, duplicate 3串3 hitMatrix cert, single-match 37-atom T Δ S = ∅, empty-cold cap EV guardrail, and default single-auth QUOTE_DRIFTED", async () => {
    const base = officialFixtureMatches as MatchItem[];
    const ms4 = base.slice(0, 4);
    const makeStore = () => {
      const mp = new Map<string, string>();
      return {
        getItem: (k: string) => mp.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mp.set(k, v);
        },
        removeItem: (k: string) => {
          mp.delete(k);
        },
      };
    };
    const makeCtrl = (board: MatchItem[] = ms4) => {
      const c = createBetSlipController({
        debounceMs: 0,
        autoSyncRadar: true,
        storagePort: makeStore(),
        computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
      });
      c.applyAuthenticatedBundle({
        matches: board,
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, board),
      });
      c.setDirectMultiple(1);
      return c;
    };

    // 1. P0-1 & P0-2: Intel Sheet bare `microQuant.arbitrages` resolves exact whole-slip `[6, 6]` lines (identical to Right Cabin) when statewise non-decreasing, blocks state-decreasing swaps, and rejects stale `activeSwapTip` across direction/match edits!
    const m006Like: MatchItem = {
      ...structuredClone(ms4[0]),
      id: "r4-006",
      matchNumStr: "周一006",
      pools: {
        ...structuredClone(ms4[0].pools),
        HAD: {
          ...structuredClone(ms4[0].pools.HAD),
          selling: true,
          canAllUp: true,
          options: [
            { key: "h", label: "主胜", odds: 1.98, trend: 0, fairProb: 0.45 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.27 },
            { key: "a", label: "客胜", odds: 3.45, trend: 0, fairProb: 0.28 },
          ],
        },
        HHAD: {
          ...structuredClone(ms4[0].pools.HHAD),
          selling: true,
          canAllUp: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.9, trend: 0, fairProb: 0.22 },
            { key: "hd", label: "让平", odds: 3.55, trend: 0, fairProb: 0.25 },
            { key: "ha", label: "让负", odds: 1.74, trend: 0, fairProb: 0.53 },
          ],
        },
      },
    };
    m006Like.microQuant = analyzeMatchMicroQuant(m006Like);
    const m001Like: MatchItem = {
      ...structuredClone(ms4[1]),
      id: "r4-001",
      matchNumStr: "周一001",
      pools: {
        ...structuredClone(ms4[1].pools),
        HAD: {
          ...structuredClone(ms4[1].pools.HAD),
          selling: true,
          canAllUp: true,
          options: [
            { key: "h", label: "主胜", odds: 3.63, trend: 0, fairProb: 0.25 },
            { key: "d", label: "平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "a", label: "客胜", odds: 1.73, trend: 0, fairProb: 0.49 },
          ],
        },
      },
    };
    const cSheet = makeCtrl([m006Like, m001Like]);
    cSheet.togglePick(m006Like, "HAD", "d");
    cSheet.togglePick(m006Like, "HAD", "a");
    cSheet.togglePick(m001Like, "HAD", "h");
    cSheet.togglePick(m001Like, "HAD", "a");
    cSheet.setDirectMultiple(3);
    await cSheet.flush();
    const bareSheetArb = m006Like.microQuant.arbitrages.find(
      (a) => a.poolCode === "HHAD" && a.optionKey === "ha"
    )!;
    assert.ok(bareSheetArb && !bareSheetArb.executableSwapLines);
    const savedStaleTip = cSheet.getState().workspace.insights.activeSwapTip!;
    assert.ok(savedStaleTip?.executableSwapLines);
    assert.equal(cSheet.previewEquivalentSwap(bareSheetArb).ok, true);
    assert.equal(cSheet.applyEquivalentSwap(bareSheetArb), true);
    await cSheet.flush();
    const sheetTickets =
      cSheet.getState().workspace.effectiveReport.tickets ?? [];
    assert.deepEqual(
      sheetTickets.map((t) => t.multiple),
      [6, 6],
      "Intel Sheet bare arb must mount verified [6, 6] whole-slip multiples (paying ¥75.78 >= ¥75.15, NEVER [4, 8] ¥50.52!)"
    );

    // P0-2: Stale saved tip rejected after changing second match direction [h,a] -> [h,d]
    const cStaleSwap = makeCtrl([m006Like, m001Like]);
    cStaleSwap.togglePick(m006Like, "HAD", "d");
    cStaleSwap.togglePick(m006Like, "HAD", "a");
    cStaleSwap.togglePick(m001Like, "HAD", "h");
    cStaleSwap.togglePick(m001Like, "HAD", "a");
    cStaleSwap.setDirectMultiple(3);
    await cStaleSwap.flush();
    const tipBeforeEdit =
      cStaleSwap.getState().workspace.insights.activeSwapTip!;
    cStaleSwap.togglePick(m001Like, "HAD", "a");
    cStaleSwap.togglePick(m001Like, "HAD", "d");
    await cStaleSwap.flush();
    assert.equal(cStaleSwap.previewEquivalentSwap(tipBeforeEdit).ok, false);
    assert.equal(
      cStaleSwap.applyEquivalentSwap(tipBeforeEdit),
      false,
      "Stale activeSwapTip must never reinstate canceled 001:a!"
    );

    // 2. P0-3: Out-of-order delayed `-1` sync packet NEVER overwrites newer `+1` board or deletes user's fresh `+1` pick!
    const authBoard = structuredClone(ms4);
    let resolveDelayedOldSync!: () => void;
    const wb = createWorkbenchController({
      debounceMs: 0,
      storagePort: makeStore(),
      quantPort: {
        syncMatches(p) {
          const oldSnap = structuredClone(authBoard);
          const packet = {
            matches: oldSnap,
            workspace: evaluateQuantWorkspace(p, oldSnap),
            syncNote: "delayed -1 board",
          };
          return new Promise((res) => {
            resolveDelayedOldSync = () => res(packet);
          });
        },
        computeWorkspace(p) {
          const w = evaluateQuantWorkspace(p, authBoard);
          const oldOd = p.quoteInputSig?.split("|od=")[1];
          const newOd = w.quoteInputSig?.split("|od=")[1];
          return Promise.resolve(
            oldOd !== newOd ? { ...w, refreshedMatches: authBoard } : w
          );
        },
      },
    });
    wb.betSlip.applyAuthenticatedBundle({
      matches: ms4,
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, ms4),
    });
    wb.betSlip.setDirectMultiple(2);
    wb.betSlip.togglePick(ms4[0], "HHAD", "hh");
    wb.betSlip.togglePick(ms4[1], "HAD", "h");
    await wb.betSlip.flush();
    const inflightOldSync = wb.syncOfficialMatches();
    Object.assign(authBoard[0].pools.HHAD, {
      goalLine: "+1",
      name: "让球(+1)",
      updateTime: "17:46:21",
    });
    wb.betSlip.setDirectMultiple(5);
    await wb.betSlip.flush();
    const freshM0 = wb.betSlip.getState().matches[0];
    assert.equal(freshM0.pools.HHAD.goalLine, "+1");
    wb.betSlip.togglePick(freshM0, "HHAD", "hh");
    await wb.betSlip.flush();
    assert.equal(wb.betSlip.getState().workspace.effectiveReport.totalCost, 10);
    resolveDelayedOldSync();
    await inflightOldSync;
    await wb.betSlip.flush();
    assert.equal(wb.betSlip.getState().matches[0].pools.HHAD.goalLine, "+1");
    assert.equal(
      wb.betSlip.getState().workspace.effectiveReport.totalCost,
      10,
      "Delayed older -1 sync packet must NEVER regress +1 board or delete fresh +1 pick!"
    );

    // 3. P0-4, P1-1 & P1-2: Locked archetype seals cleanly across radar edits, `"仅改手选过关"` preserves locked archetype, and cross-revision remediation is rejected!
    const cLock = makeCtrl(ms4);
    cLock.setDirectMultiple(1);
    cLock.setBudget(20);
    for (const m of ms4) cLock.togglePick(m, "HAD", "h");
    await cLock.flush();
    cLock.toggleFreePassSize(2);
    await cLock.flush();
    if (cLock.getState().passSpec.passSizes?.includes(2)) {
      cLock.toggleFreePassSize(2);
      await cLock.flush();
    }
    const lowerAct0 = cLock
      .getState()
      .workspace.portfolioPlans.flatMap((v) => v.remediationActions ?? [])
      .find((v) => v.kind === "lower-pass-preview")!;
    assert.ok(lowerAct0);
    cLock.setDirectMultiple(5);
    await cLock.flush();
    assert.equal(
      cLock.applyPortfolioRemediationAction(lowerAct0, {
        applyPreviewPlan: true,
      }).ok,
      false,
      "Remediation captured at revision/multiple=1 must be rejected after changing multiple to 5!"
    );

    const freshLower = cLock
      .getState()
      .workspace.portfolioPlans.flatMap((v) => v.remediationActions ?? [])
      .find((v) => v.kind === "lower-pass-preview")!;
    assert.equal(
      cLock.applyPortfolioRemediationAction(freshLower, {
        applyPreviewPlan: true,
      }).ok,
      true
    );
    await cLock.flush();
    assert.equal(cLock.getState().activeSlip.sourceKind, "archetype");
    assert.equal(cLock.getState().workspace.effectiveReport.totalCost, 20);

    // `"仅改手选过关"` updates manualDraft.passSpec while keeping locked archetype ¥20 intact
    const whileLockedAct = cLock
      .getState()
      .workspace.portfolioPlans.flatMap((v) => v.remediationActions ?? [])
      .find((v) => v.kind === "lower-pass-preview")!;
    assert.equal(
      cLock.applyPortfolioRemediationAction(whileLockedAct).ok,
      true
    );
    await cLock.flush();
    assert.equal(cLock.getState().activeSlip.sourceKind, "archetype");
    assert.equal(cLock.getState().workspace.effectiveReport.totalCost, 20);
    assert.deepEqual(cLock.getState().passSpec.passSizes, [2]);

    // Editing radar draft while archetype is locked still seals the locked ¥20 archetype cleanly
    cLock.togglePick(ms4[0], "HAD", "d");
    await cLock.flush();
    const draftAfterRadarEdit = cLock.buildSealedLedgerDraft();
    assert.ok(draftAfterRadarEdit);
    const sealedLocked = sealAuthoritativePrintSnapshot({
      workspaceParams: draftAfterRadarEdit.workspaceParams,
      authoritativeMatches: ms4,
    });
    assert.equal(sealedLocked.totalCost, 20);

    // 4. P1-3: Duplicate sub-bet leg signatures in `3串3` with duplex match preserve full joint hitMatrix (minPayout ¥15.55 >= ¥12 -> certified-feasible)!
    const mDup0: MatchItem = {
      ...m001Like,
      id: "dup-0",
      pools: {
        ...m001Like.pools,
        HAD: {
          ...m001Like.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 3.63, trend: 0, fairProb: 0.25 },
            { key: "d", label: "平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "a", label: "客胜", odds: 1.73, trend: 0, fairProb: 0.49 },
          ],
        },
      },
    };
    const mDup1: MatchItem = {
      ...structuredClone(ms4[2]),
      id: "dup-1",
      pools: {
        ...structuredClone(ms4[2].pools),
        HAD: {
          ...structuredClone(ms4[2].pools.HAD),
          options: [
            { key: "h", label: "主胜", odds: 4.5, trend: 0, fairProb: 0.2 },
            { key: "d", label: "平", odds: 3.6, trend: 0, fairProb: 0.24 },
            { key: "a", label: "客胜", odds: 1.62, trend: 0, fairProb: 0.56 },
          ],
        },
      },
    };
    const mDup2: MatchItem = {
      ...structuredClone(ms4[3]),
      id: "dup-2",
      pools: {
        ...structuredClone(ms4[3].pools),
        HAD: {
          ...structuredClone(ms4[3].pools.HAD),
          options: [
            { key: "h", label: "主胜", odds: 1.42, trend: 0, fairProb: 0.62 },
            { key: "d", label: "平", odds: 4.8, trend: 0, fairProb: 0.19 },
            { key: "a", label: "客胜", odds: 4.98, trend: 0, fairProb: 0.19 },
          ],
        },
      },
    };
    const dupPicks = [
      {
        matchId: mDup0.id,
        matchNumStr: mDup0.matchNumStr,
        home: mDup0.home,
        away: mDup0.away,
        poolCode: "HAD" as const,
        poolName: "胜平负",
        optionKey: "h",
        optionLabel: "主胜",
        odds: 3.63,
        fairProb: 0.25,
        singleAllowed: false,
        canAllUp: true,
      },
      {
        matchId: mDup1.id,
        matchNumStr: mDup1.matchNumStr,
        home: mDup1.home,
        away: mDup1.away,
        poolCode: "HAD" as const,
        poolName: "胜平负",
        optionKey: "a",
        optionLabel: "客胜",
        odds: 1.62,
        fairProb: 0.56,
        singleAllowed: false,
        canAllUp: true,
      },
      {
        matchId: mDup2.id,
        matchNumStr: mDup2.matchNumStr,
        home: mDup2.home,
        away: mDup2.away,
        poolCode: "HAD" as const,
        poolName: "胜平负",
        optionKey: "d",
        optionLabel: "平",
        odds: 4.8,
        fairProb: 0.19,
        singleAllowed: false,
        canAllUp: true,
      },
      {
        matchId: mDup2.id,
        matchNumStr: mDup2.matchNumStr,
        home: mDup2.home,
        away: mDup2.away,
        poolCode: "HAD" as const,
        poolName: "胜平负",
        optionKey: "a",
        optionLabel: "客胜",
        odds: 4.98,
        fairProb: 0.19,
        singleAllowed: false,
        canAllUp: true,
      },
    ];
    const dupRep = computeTruthReport(dupPicks, 1, [mDup0, mDup1, mDup2], {
      mode: "combo",
      comboCode: "3x3",
    });
    const dupBonus = optimizeBonusPlan(dupRep, [mDup0, mDup1, mDup2], "equal")!;
    assert.equal(dupRep.breakevenCert?.isCurrentFeasible, "certified-feasible");
    assert.equal(dupRep.breakevenCert?.minFeasibleBudget, 12);
    assert.equal(
      dupBonus.breakevenCert?.isCurrentFeasible,
      "certified-feasible"
    );
    assert.equal(dupBonus.breakevenCert?.minFeasibleBudget, 12);

    // 5. P1-4: Single-match non-single anchor with blind spot (-2 让胜) NEVER auto-releases on Slot ③ when !acceptPartialSingleCoverage!
    const mMinus2: MatchItem = {
      ...structuredClone(ms4[0]),
      id: "sgl-minus2",
      pools: {
        ...structuredClone(ms4[0].pools),
        HAD: {
          ...structuredClone(ms4[0].pools.HAD),
          single: false,
          canSingle: false,
        },
        HHAD: {
          ...structuredClone(ms4[0].pools.HHAD),
          single: false,
          canSingle: false,
          goalLine: "-2",
        },
        CRS: {
          ...structuredClone(ms4[0].pools.CRS),
          single: true,
          canSingle: true,
        },
        TTG: {
          ...structuredClone(ms4[0].pools.TTG),
          single: true,
          canSingle: true,
        },
        HAFU: {
          ...structuredClone(ms4[0].pools.HAFU),
          single: true,
          canSingle: true,
        },
      },
    };
    const minus2Pick = {
      matchId: mMinus2.id,
      matchNumStr: mMinus2.matchNumStr,
      home: mMinus2.home,
      away: mMinus2.away,
      poolCode: "HHAD" as const,
      poolName: "让球(-2)",
      optionKey: "hh",
      optionLabel: "让胜",
      odds: mMinus2.pools.HHAD.options[0].odds,
      fairProb: mMinus2.pools.HHAD.options[0].fairProb,
      singleAllowed: false,
      canAllUp: true,
    };
    const sglPlans = generateParetoPortfolio(
      [mMinus2],
      50,
      "objective",
      false,
      [minus2Pick],
      { allowSaveCash: false }
    );
    assert.equal(sglPlans[0].available, false);
    assert.equal(sglPlans[1].available, false);
    assert.equal(
      sglPlans[2].available,
      false,
      "Single-match -2 让胜 has no exact single-pool equivalent on TTG/HAFU and must not auto-release on Slot ③ without explicit partial-coverage confirmation!"
    );

    // 6. P1-5: Empty credible cold zone (<1.5%) + cap-clipped line (`0:5×5:0` raw 210,000 > 200,000 cap) respects -3pp EV guardrail!
    const mCap0 = structuredClone(ms4[0]);
    const mCap1 = structuredClone(ms4[1]);
    mCap0.id = "cap-ev-0";
    mCap1.id = "cap-ev-1";
    const crs05 = mCap0.pools.CRS.options.find((o) => o.label === "0:5")!;
    const crsDrawOth = mCap0.pools.CRS.options.find(
      (o) => o.label === "平其它"
    )!;
    const crs50 = mCap1.pools.CRS.options.find((o) => o.label === "5:0")!;
    crs05.odds = 350;
    crsDrawOth.odds = 200;
    crs50.odds = 300;
    const capPicks = [
      {
        matchId: mCap0.id,
        matchNumStr: mCap0.matchNumStr,
        home: mCap0.home,
        away: mCap0.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: crs05.key,
        optionLabel: crs05.label,
        odds: 350,
        fairProb: 0.001,
        singleAllowed: true,
        canAllUp: true,
      },
      {
        matchId: mCap0.id,
        matchNumStr: mCap0.matchNumStr,
        home: mCap0.home,
        away: mCap0.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: crsDrawOth.key,
        optionLabel: crsDrawOth.label,
        odds: 200,
        fairProb: 0.0012,
        singleAllowed: true,
        canAllUp: true,
      },
      {
        matchId: mCap1.id,
        matchNumStr: mCap1.matchNumStr,
        home: mCap1.home,
        away: mCap1.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: crs50.key,
        optionLabel: crs50.label,
        odds: 300,
        fairProb: 0.001,
        singleAllowed: true,
        canAllUp: true,
      },
    ];
    const capRep = computeTruthReport(capPicks, 10, [mCap0, mCap1], {
      mode: "free",
      passSizes: [2],
    });
    const capCold = optimizeBonusPlan(capRep, [mCap0, mCap1], "cold-first")!;
    assert.ok(
      (capRep.objectiveEVRate ?? capRep.expectedValueRate) -
        (capCold.objectiveEVRate ?? capCold.expectedValueRate) <=
        0.03 + 1e-6,
      "Empty credible cold zone must never violate the -3pp objective EV guardrail when clamping a cap-clipped line!"
    );

    // 7. P2-1: Default partial-coverage single-auth card throws `QUOTE_DRIFTED` when covered leg SP drifts +0.01!
    const cDefCard = makeCtrl([mMinus2]);
    const hhNeg2Key = mMinus2.pools.HHAD.options.find((o) => o.key === "ha")!;
    cDefCard.togglePick(mMinus2, "HHAD", hhNeg2Key.key);
    await cDefCard.flush();
    const cardsNeg2 = buildPendingSingleCrossPoolCards(
      cDefCard.getState().workspace.manualReport,
      cDefCard.getState().workspace.effectiveReport
    );
    assert.ok(cardsNeg2.length >= 1);
    assert.equal(
      cDefCard.confirmPartialCoverageSingle(cardsNeg2[0].preview).ok,
      true
    );
    await cDefCard.flush();
    await confirmDisplayedSyntheticTicket(
      cDefCard,
      cardsNeg2[0].preview.previewCost
    );
    const defDraft = cDefCard.buildSealedLedgerDraft()!;
    assert.ok(defDraft);
    const firstCoveredLeg = cardsNeg2[0].preview.previewLines![0].legs[0];
    const driftedMinus2 = structuredClone(mMinus2);
    const driftedOpt = driftedMinus2.pools[
      firstCoveredLeg.poolCode
    ].options.find((o) => o.key === firstCoveredLeg.optionKey)!;
    driftedOpt.odds = Number((driftedOpt.odds + 0.01).toFixed(2));
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          workspaceParams: defDraft.workspaceParams,
          authoritativeMatches: [driftedMinus2],
        }),
      (err: unknown) => (err as { code?: string })?.code === "QUOTE_DRIFTED"
    );
  });

  it("Slice 7 (Codex R4 12-Item Fourth-Order Convergence): locks playable single-match swap protection, banker/bonus swap binding, roster-vs-pool sync monotonicity, unchanged-sync HAD goalLine purity, locked canAllUp revocation, computeWorkspace provenance sync, >96-line cold/fixed invariants, joint whole-slip diff range, capGuardAlternative confirm & 999x capacity, and non-exact candidate budget copy", async () => {
    const base = officialFixtureMatches as MatchItem[];
    const ms4 = base.slice(0, 4);
    const makeStore = () => {
      const mp = new Map<string, string>();
      return {
        getItem: (k: string) => mp.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mp.set(k, v);
        },
        removeItem: (k: string) => {
          mp.delete(k);
        },
      };
    };
    const makeCtrl = (board: MatchItem[] = ms4) => {
      const c = createBetSlipController({
        debounceMs: 0,
        autoSyncRadar: true,
        storagePort: makeStore(),
        computeWorkspace: (p, list) => evaluateQuantWorkspace(p, list),
      });
      c.applyAuthenticatedBundle({
        matches: board,
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, board),
      });
      c.setDirectMultiple(1);
      return c;
    };

    // 1. P0-1: Single-match playable auto-synthetic (¥20) and authorized single (¥18) reject unquoted bare Intel Sheet swaps without altering stake or revoking grant!
    const mAutoSingle: MatchItem = {
      ...structuredClone(ms4[0]),
      id: "r5-single-auto",
      pools: {
        ...structuredClone(ms4[0].pools),
        HAD: {
          ...structuredClone(ms4[0].pools.HAD),
          single: false,
          canSingle: false,
          canAllUp: true,
          options: [
            { key: "h", label: "主胜", odds: 4.5, trend: 0, fairProb: 0.2 },
            { key: "d", label: "平", odds: 4.0, trend: 0, fairProb: 0.22 },
            { key: "a", label: "客胜", odds: 1.52, trend: 0, fairProb: 0.58 },
          ],
        },
        HHAD: {
          ...structuredClone(ms4[0].pools.HHAD),
          single: false,
          canSingle: false,
          canAllUp: true,
          goalLine: "+1",
          options: [
            { key: "hh", label: "让胜", odds: 2.35, trend: 0, fairProb: 0.42 },
            { key: "hd", label: "让平", odds: 3.5, trend: 0, fairProb: 0.25 },
            { key: "ha", label: "让负", odds: 2.38, trend: 0, fairProb: 0.33 },
          ],
        },
        HAFU: {
          ...structuredClone(ms4[0].pools.HAFU),
          single: true,
          canSingle: true,
          options: [
            { key: "hh", label: "胜胜", odds: 7.5, trend: 0, fairProb: 0.11 },
            { key: "dh", label: "平胜", odds: 9.8, trend: 0, fairProb: 0.08 },
            { key: "ah", label: "负胜", odds: 34, trend: 0, fairProb: 0.02 },
            { key: "hd", label: "胜平", odds: 15, trend: 0, fairProb: 0.05 },
            { key: "dd", label: "平平", odds: 6.4, trend: 0, fairProb: 0.13 },
            { key: "ad", label: "负平", odds: 15, trend: 0, fairProb: 0.05 },
            { key: "ha", label: "胜负", odds: 24, trend: 0, fairProb: 0.03 },
            { key: "da", label: "平负", odds: 4.5, trend: 0, fairProb: 0.18 },
            { key: "aa", label: "负负", odds: 2.35, trend: 0, fairProb: 0.35 },
          ],
        },
      },
    };
    mAutoSingle.microQuant = analyzeMatchMicroQuant(mAutoSingle);
    const cAutoSgl = makeCtrl([mAutoSingle]);
    cAutoSgl.setDirectMultiple(5);
    cAutoSgl.togglePick(mAutoSingle, "HAD", "h");
    cAutoSgl.togglePick(mAutoSingle, "HAD", "d");
    await cAutoSgl.flush();
    await confirmDisplayedSyntheticTicket(cAutoSgl, 20);
    const bareSglArb = mAutoSingle.microQuant.arbitrages.find(
      (a) => a.poolCode === "HHAD" && a.optionKey === "hh"
    )!;
    assert.ok(bareSglArb);
    assert.equal(cAutoSgl.previewEquivalentSwap(bareSglArb).ok, false);
    assert.equal(cAutoSgl.applyEquivalentSwap(bareSglArb), false);
    assert.equal(
      cAutoSgl.getState().workspace.effectiveReport.totalCost,
      20,
      "Playable ¥20 auto-synthetic single must never drop to ¥12 via unquoted bare swap!"
    );

    // P0-1b: Explicitly authorized single-match card (grant + locked cost) must ALSO reject unquoted bare Intel Sheet swap and preserve grant, lines, WeChat & exact cost!
    const mGrantSgl: MatchItem = {
      ...structuredClone(mAutoSingle),
      id: "r5-grant-single",
      pools: {
        ...structuredClone(mAutoSingle.pools),
        TTG: {
          ...structuredClone(mAutoSingle.pools.TTG),
          single: false,
          canSingle: false,
        },
        HAFU: {
          ...structuredClone(mAutoSingle.pools.HAFU),
          single: true,
          canSingle: true,
        },
        CRS: {
          ...structuredClone(mAutoSingle.pools.CRS),
          single: true,
          canSingle: true,
        },
      },
    };
    mGrantSgl.microQuant = analyzeMatchMicroQuant(mGrantSgl);
    const cGrantSgl = makeCtrl([mGrantSgl]);
    cGrantSgl.setDirectMultiple(6);
    cGrantSgl.togglePick(mGrantSgl, "HAD", "h");
    cGrantSgl.togglePick(mGrantSgl, "HAD", "d");
    await cGrantSgl.flush();
    const repGrantInit = cGrantSgl.getState().workspace.effectiveReport;
    const pvGrant =
      repGrantInit.partialCoveragePreview ??
      repGrantInit.crossPoolSingleAlternatives?.[0] ??
      null;
    assert.ok(pvGrant);
    const grantRes = cGrantSgl.confirmPartialCoverageSingle(pvGrant);
    assert.equal(grantRes.ok, true);
    await cGrantSgl.flush();
    await confirmDisplayedSyntheticTicket(cGrantSgl, pvGrant.previewCost);
    const grantCostBefore =
      cGrantSgl.getState().workspace.effectiveReport.totalCost;
    const grantBefore = cGrantSgl.getState().singleAuthGrant;
    const grantWxBefore = cGrantSgl.formatShopkeeperWeChatSlip();
    assert.ok(
      grantCostBefore > 0 && grantBefore !== null && grantWxBefore.length > 0
    );
    const bareGrantArb = mGrantSgl.microQuant.arbitrages.find(
      (a) => a.poolCode === "HHAD" && a.optionKey === "hh"
    )!;
    assert.equal(cGrantSgl.previewEquivalentSwap(bareGrantArb).ok, false);
    assert.equal(cGrantSgl.applyEquivalentSwap(bareGrantArb), false);
    await cGrantSgl.flush();
    assert.equal(
      cGrantSgl.getState().singleAuthGrant?.authId,
      grantBefore.authId
    );
    assert.equal(
      cGrantSgl.getState().workspace.effectiveReport.totalCost,
      grantCostBefore
    );
    assert.equal(cGrantSgl.formatShopkeeperWeChatSlip(), grantWxBefore);

    // 2. P0-2 & P2-1: Stale swap tip rejected across same-cost banker switch & bonus-opt reweighting; joint whole-slip state diff reports exact +0.00~+max!
    const mCrsSwap: MatchItem = {
      ...structuredClone(ms4[0]),
      id: "r5-crs-001",
      matchNumStr: "周一001",
      pools: {
        ...structuredClone(ms4[0].pools),
        TTG: {
          ...structuredClone(ms4[0].pools.TTG),
          selling: true,
          canAllUp: true,
          options: structuredClone(ms4[0].pools.TTG.options).map((o) =>
            o.key === "s1" ? { ...o, odds: 5.5 } : o
          ),
        },
        CRS: {
          ...structuredClone(ms4[0].pools.CRS),
          selling: true,
          canAllUp: true,
          options: structuredClone(ms4[0].pools.CRS.options).map((o) =>
            o.label === "1:0"
              ? { ...o, odds: 10.5 }
              : o.label === "0:1"
                ? { ...o, odds: 7.25 }
                : o
          ),
        },
      },
    };
    const mB1: MatchItem = {
      ...structuredClone(ms4[1]),
      id: "r5-b-003",
      matchNumStr: "周一003",
      pools: {
        ...structuredClone(ms4[1].pools),
        HAD: {
          ...structuredClone(ms4[1].pools.HAD),
          options: [
            { key: "h", label: "主胜", odds: 3.76, trend: 0, fairProb: 0.25 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.27 },
            { key: "a", label: "客胜", odds: 1.82, trend: 0, fairProb: 0.48 },
          ],
        },
      },
    };
    const mB2: MatchItem = {
      ...structuredClone(ms4[2]),
      id: "r5-b-004",
      matchNumStr: "周一004",
      pools: {
        ...structuredClone(ms4[2].pools),
        HAD: {
          ...structuredClone(ms4[2].pools.HAD),
          options: [
            { key: "h", label: "主胜", odds: 2.3, trend: 0, fairProb: 0.39 },
            { key: "d", label: "平", odds: 3.2, trend: 0, fairProb: 0.29 },
            { key: "a", label: "客胜", odds: 2.75, trend: 0, fairProb: 0.32 },
          ],
        },
      },
    };
    const cBankerSwap = makeCtrl([mCrsSwap, mB1, mB2]);
    const crs10Key = mCrsSwap.pools.CRS.options.find(
      (o) => o.label === "1:0"
    )!.key;
    const crs01Key = mCrsSwap.pools.CRS.options.find(
      (o) => o.label === "0:1"
    )!.key;
    cBankerSwap.togglePick(mCrsSwap, "CRS", crs10Key);
    cBankerSwap.togglePick(mCrsSwap, "CRS", crs01Key);
    cBankerSwap.togglePick(mB1, "HAD", "h");
    cBankerSwap.togglePick(mB2, "HAD", "h");
    cBankerSwap.toggleFreePassSize(2);
    if (cBankerSwap.getState().passSpec.passSizes?.includes(3)) {
      cBankerSwap.toggleFreePassSize(3);
    }
    await cBankerSwap.flush();
    // P2-1: Without banker, 5 lines (¥10) -> joint state diff is +0.00 ~ +45.45!
    const jointTip = cBankerSwap.getState().workspace.insights.activeSwapTip!;
    assert.equal(jointTip.minStateReturnDiff, 0);
    assert.equal(jointTip.maxStateReturnDiff, 45.45);

    // P0-2a: Lock banker on mB1 (¥6), capture tip, switch banker to mB2 (still ¥6) -> old tip rejected!
    cBankerSwap.toggleBankerMatch(mB1.id, { confirmed: true });
    await cBankerSwap.flush();
    const tipBanker1 = cBankerSwap.getState().workspace.insights.activeSwapTip!;
    assert.equal(cBankerSwap.getState().workspace.effectiveReport.totalCost, 6);
    cBankerSwap.toggleBankerMatch(mB1.id);
    cBankerSwap.toggleBankerMatch(mB2.id, { confirmed: true });
    await cBankerSwap.flush();
    assert.equal(cBankerSwap.getState().workspace.effectiveReport.totalCost, 6);
    assert.equal(cBankerSwap.previewEquivalentSwap(tipBanker1).ok, false);
    assert.equal(cBankerSwap.applyEquivalentSwap(tipBanker1), false);

    // P0-2b: Capture manual ¥24 tip, apply equal / hot-first / cold-first bonus opt (all ¥24) -> old manual tip rejected in all 3 modes!
    for (const bonusMode of ["equal", "hot-first", "cold-first"] as const) {
      const cBonusSwap = makeCtrl([mCrsSwap, mB1]);
      cBonusSwap.setDirectMultiple(3);
      cBonusSwap.togglePick(mCrsSwap, "CRS", crs10Key);
      cBonusSwap.togglePick(mCrsSwap, "CRS", crs01Key);
      cBonusSwap.togglePick(mB1, "HAD", "h");
      cBonusSwap.togglePick(mB1, "HAD", "a");
      await cBonusSwap.flush();
      const tipPreBonus =
        cBonusSwap.getState().workspace.insights.activeSwapTip!;
      assert.ok(tipPreBonus);
      cBonusSwap.applyBonusOptimization(bonusMode);
      await cBonusSwap.flush();
      assert.equal(
        cBonusSwap.previewEquivalentSwap(tipPreBonus).ok,
        false,
        `Stale manual tip must be rejected after ${bonusMode} reweighting`
      );
      assert.equal(cBonusSwap.applyEquivalentSwap(tipPreBonus), false);
    }

    // 3. P1-1: Identical full sync does NOT stamp HHAD goalLine onto HAD picks and preserves live swap usability!
    const mSync0: MatchItem = {
      ...structuredClone(ms4[0]),
      id: "r5-sync-0",
      pools: {
        ...structuredClone(ms4[0].pools),
        HAD: {
          ...structuredClone(ms4[0].pools.HAD),
          options: [
            { key: "h", label: "主胜", odds: 1.98, trend: 0, fairProb: 0.45 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.27 },
            { key: "a", label: "客胜", odds: 3.45, trend: 0, fairProb: 0.28 },
          ],
        },
        HHAD: {
          ...structuredClone(ms4[0].pools.HHAD),
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.9, trend: 0, fairProb: 0.22 },
            { key: "hd", label: "让平", odds: 3.55, trend: 0, fairProb: 0.25 },
            { key: "ha", label: "让负", odds: 1.74, trend: 0, fairProb: 0.53 },
          ],
        },
      },
    };
    const wbUnchanged = createWorkbenchController({
      debounceMs: 0,
      storagePort: makeStore(),
      quantPort: {
        syncMatches(p) {
          const clone = structuredClone([mSync0, mB1]);
          return Promise.resolve({
            matches: clone,
            workspace: evaluateQuantWorkspace(p, clone),
            syncNote: "identical sync",
          });
        },
        computeWorkspace(p, list) {
          return evaluateQuantWorkspace(p, list);
        },
      },
    });
    wbUnchanged.betSlip.applyAuthenticatedBundle({
      matches: [mSync0, mB1],
      initialPicks: [],
      workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, [
        mSync0,
        mB1,
      ]),
    });
    wbUnchanged.betSlip.setDirectMultiple(3);
    wbUnchanged.betSlip.togglePick(mSync0, "HAD", "d");
    wbUnchanged.betSlip.togglePick(mSync0, "HAD", "a");
    wbUnchanged.betSlip.togglePick(mB1, "HAD", "h");
    wbUnchanged.betSlip.togglePick(mB1, "HAD", "a");
    await wbUnchanged.betSlip.flush();
    await wbUnchanged.syncOfficialMatches();
    const postSyncTip =
      wbUnchanged.betSlip.getState().workspace.insights.activeSwapTip!;
    assert.ok(postSyncTip);
    assert.equal(
      wbUnchanged.betSlip
        .getState()
        .picks.every((p) => p.goalLine === undefined),
      true
    );
    assert.equal(
      wbUnchanged.betSlip.previewEquivalentSwap(postSyncTip).ok,
      true
    );
    assert.equal(wbUnchanged.betSlip.applyEquivalentSwap(postSyncTip), true);

    // 4. P0-3, P1-2 & P1-4: Roster-vs-pool monotonicity (delisted match never resurrected; interleaved per-pool timestamps merged) + computeWorkspace boardMeta provenance sync!
    let liveRoster = structuredClone([ms4[0], ms4[1], ms4[2]]);
    let nextBoardMeta = {
      source: "official-live" as const,
      boardState: "fresh" as const,
      isFallbackReadOnly: false,
      bannerText: null as string | null,
      lastValidBoardAt: 1795490000000,
      lastValidBoardClock: "11-24 11:13",
      quotedAt: 1795490000000,
      syncedAt: 1795490000000,
      quoteVersion: "qv1-3-test",
    };
    let deliverDelayedRoster!: () => void;
    const wbRoster = createWorkbenchController({
      debounceMs: 0,
      storagePort: makeStore(),
      quantPort: {
        syncMatches(p) {
          const oldSnap = structuredClone(liveRoster);
          const packet = {
            matches: oldSnap,
            workspace: {
              ...evaluateQuantWorkspace(p, oldSnap),
              boardMeta: structuredClone(nextBoardMeta),
            },
            boardMeta: structuredClone(nextBoardMeta),
            syncNote: "delayed [0,1,2] roster",
          };
          return new Promise((res) => {
            deliverDelayedRoster = () => res(packet);
          });
        },
        computeWorkspace(p) {
          const w = evaluateQuantWorkspace(p, liveRoster);
          return Promise.resolve({
            ...w,
            boardMeta: structuredClone(nextBoardMeta),
            refreshedMatches: structuredClone(liveRoster),
          });
        },
      },
    });
    wbRoster.betSlip.applyAuthenticatedBundle({
      matches: structuredClone(liveRoster),
      initialPicks: [],
      workspace: {
        ...evaluateQuantWorkspace({ picks: [], multiple: 1 }, liveRoster),
        boardMeta: structuredClone(nextBoardMeta),
      },
    });
    wbRoster.betSlip.togglePick(ms4[0], "HAD", "h");
    wbRoster.betSlip.togglePick(ms4[1], "HAD", "h");
    await wbRoster.betSlip.flush();
    const delayedSyncPromise = wbRoster.syncOfficialMatches();

    // Delist ms4[2], list ms4[3], and flip boardMeta to cached-snapshot read-only on ordinary computeWorkspace!
    liveRoster = structuredClone([ms4[0], ms4[1], ms4[3]]);
    nextBoardMeta = {
      ...nextBoardMeta,
      source: "cached-snapshot" as any,
      boardState: "timeout-fallback" as any,
      isFallbackReadOnly: true,
      bannerText: "官方接口响应超时，已回退最近一次有效缓存。",
    };
    wbRoster.betSlip.setDirectMultiple(5);
    await wbRoster.betSlip.flush();
    assert.equal(wbRoster.getState().boardMeta?.isFallbackReadOnly, true);
    const fallbackHdr = buildBoardHeaderStatusText(
      wbRoster.getState().betSlipState.matches.length,
      wbRoster.getState().boardMeta,
      false
    );
    assert.equal(fallbackHdr.isFallbackReadOnly, true);
    assert.equal(fallbackHdr.tone, "fallback");
    assert.equal(fallbackHdr.text.includes("只读参考"), true);

    wbRoster.betSlip.togglePick(ms4[3], "HAD", "h");
    await wbRoster.betSlip.flush();
    deliverDelayedRoster();
    await delayedSyncPromise;
    await wbRoster.betSlip.flush();
    assert.deepEqual(
      wbRoster.betSlip.getState().matches.map((m) => m.id),
      [ms4[0].id, ms4[1].id, ms4[3].id],
      "Delayed older sync must NEVER resurrect delisted ms4[2] or drop newly picked ms4[3]!"
    );
    assert.equal(
      wbRoster.betSlip.getState().workspace.effectiveReport.modeLabel,
      "3串1"
    );

    // P1-2 explicit mixedPoolTimes interleaving: out-of-order sync brings newer HAD (18:02 @1.99) + older HHAD (18:00 -1) against current HAD (18:00 @1.69) + newer HHAD (18:03 +1) -> merges HAD=1.99 & HHAD=+1 and seals ¥10!
    const mMixBase = structuredClone([ms4[0], ms4[1]]);
    Object.assign(mMixBase[0].pools.HAD, {
      updateDate: "2026-11-24",
      updateTime: "18:00:00",
    });
    mMixBase[0].pools.HAD.options[0].odds = 1.69;
    Object.assign(mMixBase[0].pools.HHAD, {
      updateDate: "2026-11-24",
      updateTime: "18:03:00",
      goalLine: "+1",
    });
    const cMix = makeCtrl(mMixBase);
    cMix.setDirectMultiple(5);
    cMix.togglePick(mMixBase[0], "HAD", "h");
    cMix.togglePick(mMixBase[1], "HAD", "h");
    await cMix.flush();
    const staleSyncCtx = cMix.captureSyncRequestContext();
    // Advance local boardEpoch via refreshedMatches while keeping 18:03 HHAD
    const interimMix = structuredClone(mMixBase);
    cMix.applyMatchesSync(
      {
        matches: interimMix,
        workspace: evaluateQuantWorkspace(
          cMix.buildWorkspaceParams(),
          interimMix
        ),
      },
      cMix.captureSyncRequestContext()
    );
    await cMix.flush();
    // Late packet started at staleSyncCtx has newer HAD (18:02 @1.99) but older HHAD (18:00 -1)
    const lateInterleaved = structuredClone(mMixBase);
    Object.assign(lateInterleaved[0].pools.HAD, {
      updateDate: "2026-11-24",
      updateTime: "18:02:00",
    });
    lateInterleaved[0].pools.HAD.options[0].odds = 1.99;
    Object.assign(lateInterleaved[0].pools.HHAD, {
      updateDate: "2026-11-24",
      updateTime: "18:00:00",
      goalLine: "-1",
    });
    const mixRosterAdopted = cMix.applyMatchesSync(
      {
        matches: lateInterleaved,
        workspace: evaluateQuantWorkspace(
          cMix.buildWorkspaceParams(),
          lateInterleaved
        ),
      },
      staleSyncCtx
    );
    await cMix.flush();
    assert.equal(mixRosterAdopted, false);
    assert.equal(cMix.getState().matches[0].pools.HAD.options[0].odds, 1.99);
    assert.equal(cMix.getState().matches[0].pools.HHAD.goalLine, "+1");
    // Also verify in-order interleaved sync adopts roster (true) while preserving newer HHAD (+1)
    const inOrderInterleaved = structuredClone(lateInterleaved);
    inOrderInterleaved[0].pools.HAD.updateTime = "18:04:00";
    inOrderInterleaved[0].pools.HAD.options[0].odds = 2.02;
    assert.equal(
      cMix.applyMatchesSync(
        {
          matches: inOrderInterleaved,
          workspace: evaluateQuantWorkspace(
            cMix.buildWorkspaceParams(),
            inOrderInterleaved
          ),
        },
        cMix.captureSyncRequestContext()
      ),
      true
    );
    await cMix.flush();
    assert.equal(cMix.getState().matches[0].pools.HAD.options[0].odds, 2.02);
    assert.equal(cMix.getState().matches[0].pools.HHAD.goalLine, "+1");
    const expectedMergedMix = structuredClone(mMixBase);
    expectedMergedMix[0].pools.HAD = structuredClone(
      inOrderInterleaved[0].pools.HAD
    );
    const sealedMix = sealAuthoritativePrintSnapshot({
      workspaceParams: cMix.buildSealedLedgerDraft()!.workspaceParams,
      authoritativeMatches: expectedMergedMix,
    });
    assert.equal(sealedMix.totalCost, 10);
    assert.equal(sealedMix.snapshot.lines[0].legs[0].odds, 2.02);

    // 5. P1-3: Locked 2串1 archetype revokes WeChat & checkout when a parlay leg flips to `canAllUp: false` (single-only)!
    const cAllUpOff = makeCtrl(ms4);
    cAllUpOff.setBudget(20);
    for (const m of ms4.slice(0, 2)) {
      cAllUpOff.togglePick(m, "HAD", "h");
      cAllUpOff.togglePick(m, "HAD", "d");
    }
    await cAllUpOff.flush();
    const arch2m = cAllUpOff
      .getState()
      .workspace.portfolioPlans.find((p) => p.available && p.lines?.length)!;
    assert.equal(cAllUpOff.applyArchetype(arch2m), true);
    await cAllUpOff.flush();
    cAllUpOff.togglePick(ms4[2], "HAD", "h");
    await cAllUpOff.flush();
    const nextSingleOnlyBoard = structuredClone(ms4);
    Object.assign(nextSingleOnlyBoard[1].pools.HAD, {
      canAllUp: false,
      single: true,
      canSingle: true,
    });
    cAllUpOff.applyMatchesSync({
      matches: nextSingleOnlyBoard,
      workspace: evaluateQuantWorkspace(
        cAllUpOff.buildWorkspaceParams(),
        nextSingleOnlyBoard
      ),
    });
    await cAllUpOff.flush();
    assert.equal(
      cAllUpOff.getState().workspace.effectiveReport.canCheckout,
      false
    );
    assert.equal(cAllUpOff.formatShopkeeperWeChatSlip(), "");

    // 6. P1-5 & P1-6: 98-line empty cold zone keeps L1=0 & 0pp EV drop; 99-line fixed 4x11 preserves minFeasibleBudget=198!
    const m98a = structuredClone(ms4[0]);
    const m98b = structuredClone(ms4[1]);
    m98a.id = "r5-98-a";
    m98b.id = "r5-98-b";
    const crsA7 = m98a.pools.CRS.options
      .filter((o) => o.odds >= 12)
      .slice(0, 7);
    const crsB14 = m98b.pools.CRS.options
      .filter((o) => o.odds >= 12)
      .slice(0, 14);
    const picks98 = [
      ...crsA7.map((o) => ({
        matchId: m98a.id,
        matchNumStr: m98a.matchNumStr,
        home: m98a.home,
        away: m98a.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: Math.max(15, o.odds),
        fairProb: 0.015,
        singleAllowed: true,
        canAllUp: true,
      })),
      ...crsB14.map((o) => ({
        matchId: m98b.id,
        matchNumStr: m98b.matchNumStr,
        home: m98b.home,
        away: m98b.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: Math.max(15, o.odds),
        fairProb: 0.015,
        singleAllowed: true,
        canAllUp: true,
      })),
    ];
    const rep98 = computeTruthReport(picks98, 2, [m98a, m98b], {
      mode: "free",
      passSizes: [2],
    });
    assert.equal(rep98.tickets?.length, 98);
    const cold98 = optimizeBonusPlan(rep98, [m98a, m98b], "cold-first")!;
    assert.deepEqual(
      cold98.lines.map((l) => l.multiple),
      new Array(98).fill(2),
      "98-line empty cold zone (<1.5%) MUST preserve mRef [2,...,2] (L1=0)!"
    );

    const picks99Fixed = [
      ...ms4[0].pools.CRS.options.slice(-3).map((o) => ({
        matchId: ms4[0].id,
        matchNumStr: ms4[0].matchNumStr,
        home: ms4[0].home,
        away: ms4[0].away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: Math.max(20, o.odds),
        fairProb: 0.01,
        singleAllowed: true,
        canAllUp: true,
      })),
      ...ms4[1].pools.CRS.options.slice(-3).map((o) => ({
        matchId: ms4[1].id,
        matchNumStr: ms4[1].matchNumStr,
        home: ms4[1].home,
        away: ms4[1].away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: Math.max(20, o.odds),
        fairProb: 0.01,
        singleAllowed: true,
        canAllUp: true,
      })),
      ...[ms4[2], ms4[3]].map((m) => {
        const o = m.pools.CRS.options[m.pools.CRS.options.length - 1];
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "CRS" as const,
          poolName: "比分",
          optionKey: o.key,
          optionLabel: o.label,
          odds: Math.max(20, o.odds),
          fairProb: 0.01,
          singleAllowed: true,
          canAllUp: true,
        };
      }),
    ];
    const rep99 = computeTruthReport(picks99Fixed, 1, ms4, {
      mode: "combo",
      comboCode: "4x11",
    });
    assert.equal(rep99.tickets?.length, 99);
    const opt99 = optimizeBonusPlan(rep99, ms4, "hot-first")!;
    assert.equal(rep99.breakevenCert?.minFeasibleBudget, 198);
    assert.equal(opt99.breakevenCert?.minFeasibleBudget, 198);

    // 7. P2-2, P2-3 & R3#11 Coverage: `confirmBonusCapGuardAlternative` switches [10,10] -> [19,1] & seals cleanly; [501,501] -> [999,3] & [999,999] capacity honesty; non-exact candidate budget flag!
    const mCapA = structuredClone(ms4[0]);
    const mCapB = structuredClone(ms4[1]);
    mCapA.id = "r5-cap-a";
    mCapB.id = "r5-cap-b";
    const opt05 = mCapA.pools.CRS.options.find((o) => o.label === "0:5")!;
    const optDO = mCapA.pools.CRS.options.find((o) => o.label === "平其它")!;
    const opt50 = mCapB.pools.CRS.options.find((o) => o.label === "5:0")!;
    opt05.odds = 350;
    optDO.odds = 200;
    opt50.odds = 300;
    const cCap = makeCtrl([mCapA, mCapB]);
    cCap.setDirectMultiple(10);
    cCap.togglePick(mCapA, "CRS", opt05.key);
    cCap.togglePick(mCapA, "CRS", optDO.key);
    cCap.togglePick(mCapB, "CRS", opt50.key);
    await cCap.flush();
    const resCold10 = cCap.applyBonusOptimization("cold-first");
    await cCap.flush();
    const alt10 =
      cCap.getState().workspace.appliedPlan?.capGuardAlternative ??
      resCold10.capGuardAlternative;
    assert.ok(alt10);
    assert.deepEqual(alt10.multiples, [19, 1]);
    assert.deepEqual(
      cCap.getState().workspace.appliedPlan?.lines.map((l) => l.multiple),
      [10, 10]
    );
    assert.equal(cCap.confirmBonusCapGuardAlternative(alt10).ok, true);
    await cCap.flush();
    assert.deepEqual(
      cCap.getState().workspace.appliedPlan?.lines.map((l) => l.multiple),
      [19, 1]
    );
    assert.equal(
      cCap.getState().workspace.appliedPlan?.capGuardAlternative,
      undefined
    );
    const sealedCap19 = sealAuthoritativePrintSnapshot({
      workspaceParams: cCap.buildSealedLedgerDraft()!.workspaceParams,
      authoritativeMatches: [mCapA, mCapB],
    });
    assert.equal(sealedCap19.totalCost, 40);

    // 501x -> [999, 3] residual multiple 3; 999x -> capacity full (no false "限为 1 倍")
    const cCap501 = makeCtrl([mCapA, mCapB]);
    cCap501.setDirectMultiple(501);
    cCap501.togglePick(mCapA, "CRS", opt05.key);
    cCap501.togglePick(mCapA, "CRS", optDO.key);
    cCap501.togglePick(mCapB, "CRS", opt50.key);
    await cCap501.flush();
    cCap501.applyBonusOptimization("cold-first");
    await cCap501.flush();
    assert.deepEqual(
      cCap501.getState().workspace.appliedPlan?.capGuardAlternative?.multiples,
      [999, 3]
    );
    assert.equal(
      cCap501.getState().workspace.appliedPlan?.capGuardAlternative
        ?.residualClippedMaxMultiple,
      3
    );

    const cCap999 = makeCtrl([mCapA, mCapB]);
    cCap999.setDirectMultiple(999);
    cCap999.togglePick(mCapA, "CRS", opt05.key);
    cCap999.togglePick(mCapA, "CRS", optDO.key);
    cCap999.togglePick(mCapB, "CRS", opt50.key);
    await cCap999.flush();
    cCap999.applyBonusOptimization("cold-first");
    await cCap999.flush();
    assert.equal(
      cCap999.getState().workspace.appliedPlan?.capGuardAlternative,
      undefined
    );
    assert.equal(
      cCap999
        .getState()
        .workspace.appliedPlan?.reasons.some((r) =>
          r.includes("999 倍法定上限")
        ),
      true
    );
    assert.equal(
      cCap999
        .getState()
        .workspace.appliedPlan?.reasons.some((r) => r.includes("限为 1 倍")),
      false
    );

    // R3#11 explicit candidate budget toast contract when `isExactMinimumBudget === false`
    const nonExactBudgetAction = {
      kind: "min-feasible-budget" as const,
      label: "尝试候选预算 ¥16",
      detail: "已验证候选预算",
      minFeasibleBudgetYuan: 16,
      isExactMinimumBudget: false,
    };
    const cBud = makeCtrl(ms4);
    cBud.setBudget(12);
    await cBud.flush();
    const budRes = cBud.applyPortfolioRemediationAction(nonExactBudgetAction);
    assert.equal(budRes.ok, true);
    assert.equal(budRes.nextBudget, 16);
    const renderedCandidateToast = formatCandidateBudgetSwitchToast(
      nonExactBudgetAction,
      budRes.nextBudget!
    );
    assert.equal(renderedCandidateToast, "已切换至已验证的候选预算 ¥16");
    assert.equal(
      formatCandidateBudgetSwitchToast({ isExactMinimumBudget: true }, 198),
      "已切换预览预算至最低可行门槛 ¥198"
    );
  });

  it("Slice 8 (Round 6 Closure): closes all 11 fifth-order audit items across auto-synthetic swap pricing, per-line sale flags, exact quotient diff ranges, cap-guard binding & races, revoked-plan hold, and unified k<=512 cold solver", async () => {
    const makeStore = () => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => m.set(k, v),
        removeItem: (k: string) => m.delete(k),
      };
    };
    const makeCtrl = (matches: MatchItem[], autoSyncRadar = false) => {
      const c = createBetSlipController({
        debounceMs: 0,
        autoSyncRadar,
        storagePort: makeStore(),
        computeWorkspace: evaluateQuantWorkspace,
      });
      c.applyAuthenticatedBundle({
        matches,
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, matches),
      });
      c.setDirectMultiple(1);
      return c;
    };
    const ms4 = structuredClone(officialFixtureMatches.slice(0, 4));

    // 1. R5 #1 (P0): Auto-synthetic single with playable HHAD substitute (¥20 at multiple=5) NEVER shrinks to ¥4!
    const mAuto20: MatchItem = {
      ...structuredClone(ms4[0]),
      id: "r6-auto-20",
      matchNumStr: "周一006",
      pools: {
        ...structuredClone(ms4[0].pools),
        HAD: {
          ...structuredClone(ms4[0].pools.HAD),
          single: false,
          canSingle: false,
          options: [
            { key: "h", label: "主胜", odds: 1.98, trend: 0, fairProb: 0.45 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.27 },
            { key: "a", label: "客胜", odds: 3.45, trend: 0, fairProb: 0.28 },
          ],
        },
        HHAD: {
          ...structuredClone(ms4[0].pools.HHAD),
          single: true,
          canSingle: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.9, trend: 0, fairProb: 0.22 },
            { key: "hd", label: "让平", odds: 3.55, trend: 0, fairProb: 0.25 },
            { key: "ha", label: "让负", odds: 1.74, trend: 0, fairProb: 0.53 },
          ],
        },
      },
    };
    mAuto20.microQuant = analyzeMatchMicroQuant(mAuto20);
    const cAuto20 = makeCtrl([mAuto20]);
    cAuto20.togglePick(mAuto20, "HAD", "d");
    cAuto20.togglePick(mAuto20, "HAD", "a");
    cAuto20.setDirectMultiple(5);
    await cAuto20.flush();
    await confirmDisplayedSyntheticTicket(cAuto20, 20);
    assert.equal(cAuto20.getState().workspace.insights.activeSwapTip, null);
    const rawArb20 = computeEquivalentArbitrages(mAuto20, {
      includeCoarseOverSubPoolVigGap: true,
    }).find((a) => a.betterPicks[0]?.poolCode === "HHAD")!;
    assert.equal(cAuto20.previewEquivalentSwap(rawArb20).ok, false);
    assert.equal(cAuto20.applyEquivalentSwap(rawArb20), false);
    assert.equal(
      sealAuthoritativePrintSnapshot({
        workspaceParams: cAuto20.buildSealedLedgerDraft()!.workspaceParams,
        authoritativeMatches: [mAuto20],
      }).totalCost,
      20
    );

    // 2. R5 #8 (P1) & #11 (P2): Multi-match independent singles check per-line canSingle/canAllUp; 1-match CRS 1:0+0:1 -> TTG s1 reports exact +0.00~+max!
    for (const [canSingle, canAllUp] of [
      [true, true],
      [true, false],
      [false, true],
    ] as const) {
      const b2 = [structuredClone(ms4[0]), structuredClone(ms4[1])];
      b2[0].pools.CRS = {
        ...b2[0].pools.CRS,
        selling: true,
        single: true,
        canSingle: true,
        canAllUp: true,
        options: b2[0].pools.CRS.options.map((o) =>
          o.label === "1:0"
            ? { ...o, odds: 7.0 }
            : o.label === "0:1"
              ? { ...o, odds: 10.25 }
              : o
        ),
      };
      b2[0].pools.TTG = {
        ...b2[0].pools.TTG,
        selling: true,
        single: canSingle,
        canSingle,
        canAllUp,
        options: b2[0].pools.TTG.options.map((o) =>
          o.key === "s1" ? { ...o, odds: 5.5 } : o
        ),
      };
      b2[1].pools.CRS = {
        ...b2[1].pools.CRS,
        selling: true,
        single: true,
        canSingle: true,
      };
      const c2 = makeCtrl(b2);
      c2.setMode("single");
      const k10 = b2[0].pools.CRS.options.find((o) => o.label === "1:0")!.key;
      const k01 = b2[0].pools.CRS.options.find((o) => o.label === "0:1")!.key;
      const k20 = b2[1].pools.CRS.options.find((o) => o.label === "2:0")!.key;
      c2.togglePick(b2[0], "CRS", k10);
      c2.togglePick(b2[0], "CRS", k01);
      c2.togglePick(b2[1], "CRS", k20);
      await c2.flush();
      const sw = c2
        .getState()
        .workspace.insights.wholeSlipEquivalentSwaps?.find(
          (a) =>
            a.betterPicks[0]?.poolCode === "TTG" &&
            a.betterPicks[0]?.optionKey === "s1"
        );
      const bareTtg = computeEquivalentArbitrages(b2[0], {
        includeCoarseOverSubPoolVigGap: true,
      }).find(
        (a) =>
          a.betterPicks[0]?.poolCode === "TTG" &&
          a.betterPicks[0]?.optionKey === "s1"
      )!;
      if (canSingle) {
        assert.ok(sw);
        assert.equal(sw.minStateReturnDiff, 0);
        assert.equal(sw.maxStateReturnDiff, 8);
        assert.equal(c2.previewEquivalentSwap(sw).ok, true);
        assert.equal(c2.applyEquivalentSwap(sw), true);
        await c2.flush();
        assert.equal(
          sealAuthoritativePrintSnapshot({
            workspaceParams: c2.buildSealedLedgerDraft()!.workspaceParams,
            authoritativeMatches: b2,
          }).totalCost,
          6
        );
      } else {
        assert.equal(sw, undefined);
        assert.equal(c2.previewEquivalentSwap(bareTtg).ok, false);
        assert.equal(c2.applyEquivalentSwap(bareTtg), false);
      }
    }

    // 3. R5 #2 (P0): Locked archetype leg losing `canAllUp` holds checkout/WeChat/seal until explicit user confirmation (`revertToManualDraft`)!
    const board4 = structuredClone(ms4);
    board4[1].pools.HAD.single = true;
    board4[1].pools.HAD.canSingle = true;
    const cHold = makeCtrl(board4, true);
    cHold.setBudget(20);
    cHold.setDirectMultiple(2);
    for (const m of board4.slice(0, 2)) {
      cHold.togglePick(m, "HAD", "h");
      cHold.togglePick(m, "HAD", "d");
    }
    await cHold.flush();
    const lockPlan = cHold
      .getState()
      .workspace.portfolioPlans.find((p) => p.available && p.lines?.length)!;
    assert.equal(cHold.applyArchetype(lockPlan), true);
    await cHold.flush();
    // Edit detached Radar draft to board4[0] + board4[2] (would be ¥8 if manual were active)
    cHold.togglePick(board4[1], "HAD", "h");
    cHold.togglePick(board4[1], "HAD", "d");
    cHold.togglePick(board4[2], "HAD", "h");
    await cHold.flush();
    assert.equal(cHold.getState().workspace.effectiveReport.totalCost, 20);
    const boardNoAllUp = structuredClone(board4);
    boardNoAllUp[1].pools.HAD.canAllUp = false;
    cHold.applyMatchesSync(
      {
        matches: boardNoAllUp,
        workspace: evaluateQuantWorkspace(
          cHold.buildWorkspaceParams(),
          boardNoAllUp
        ),
      },
      cHold.captureSyncRequestContext()
    );
    await cHold.flush();
    assert.equal(cHold.getState().workspace.effectiveReport.canCheckout, false);
    assert.equal(cHold.getState().workspace.effectiveReport.totalCost, 0);
    assert.equal(cHold.formatShopkeeperWeChatSlip(), "");
    assert.equal(cHold.buildSealedLedgerDraft(), null);
    assert.ok(cHold.getState().pendingRevokedPlanConfirm);
    cHold.revertToManualDraft();
    await cHold.flush();
    assert.equal(cHold.getState().pendingRevokedPlanConfirm, null);
    assert.equal(cHold.getState().workspace.effectiveReport.canCheckout, true);
    assert.equal(cHold.getState().workspace.effectiveReport.totalCost, 8);

    // 4. R5 #3 (P0) & #4 (P0): Bound `confirmedCapGuardSig` neither leaks across swapped/ticked odds nor reverts on earlier-started same-board sync!
    const mCap0 = structuredClone(ms4[0]);
    const mCap1 = structuredClone(ms4[1]);
    mCap0.id = "r6-cap-0";
    mCap1.id = "r6-cap-1";
    const o05 = mCap0.pools.CRS.options.find((o) => o.label === "0:5")!;
    const oDO = mCap0.pools.CRS.options.find((o) => o.label === "平其它")!;
    const o50 = mCap1.pools.CRS.options.find((o) => o.label === "5:0")!;
    o05.odds = 350;
    oDO.odds = 200;
    o50.odds = 300;
    const cCapBind = makeCtrl([mCap0, mCap1], true);
    cCapBind.setDirectMultiple(10);
    cCapBind.togglePick(mCap0, "CRS", o05.key);
    cCapBind.togglePick(mCap0, "CRS", oDO.key);
    cCapBind.togglePick(mCap1, "CRS", o50.key);
    await cCapBind.flush();
    cCapBind.applyBonusOptimization("cold-first");
    await cCapBind.flush();
    const altCap =
      cCapBind.getState().workspace.appliedPlan?.capGuardAlternative;
    assert.ok(altCap?.bindingSig);
    const preConfirmSyncCtx = cCapBind.captureSyncRequestContext();
    const staleSameBoardPacket = {
      matches: structuredClone([mCap0, mCap1]),
      workspace: evaluateQuantWorkspace(cCapBind.buildWorkspaceParams(), [
        mCap0,
        mCap1,
      ]),
    };
    assert.equal(cCapBind.confirmBonusCapGuardAlternative(altCap).ok, true);
    await cCapBind.flush();
    const postConfirmSyncCtx = cCapBind.captureSyncRequestContext();
    assert.notEqual(
      preConfirmSyncCtx.requestWorkspaceSig,
      postConfirmSyncCtx.requestWorkspaceSig
    );
    // Late same-board packet MUST NOT revert [19, 1] back to [10, 10]!
    cCapBind.applyMatchesSync(staleSameBoardPacket, preConfirmSyncCtx);
    await cCapBind.flush();
    assert.deepEqual(
      cCapBind.getState().activeSlip.lines.map((l) => l.multiple),
      [19, 1]
    );
    assert.equal(
      sealAuthoritativePrintSnapshot({
        workspaceParams: cCapBind.buildSealedLedgerDraft()!.workspaceParams,
        authoritativeMatches: [mCap0, mCap1],
      }).totalCost,
      40
    );
    // Swapping 350 <-> 200 MUST NOT inherit old confirmation ([1, 19]), resetting to [10, 10] + fresh alt!
    const swappedCapBoard = structuredClone([mCap0, mCap1]);
    swappedCapBoard[0].pools.CRS.options.find((o) => o.label === "0:5")!.odds =
      200;
    swappedCapBoard[0].pools.CRS.options.find(
      (o) => o.label === "平其它"
    )!.odds = 350;
    cCapBind.applyMatchesSync(
      {
        matches: swappedCapBoard,
        workspace: evaluateQuantWorkspace(
          cCapBind.buildWorkspaceParams(),
          swappedCapBoard
        ),
      },
      cCapBind.captureSyncRequestContext()
    );
    await cCapBind.flush();
    assert.deepEqual(
      cCapBind.getState().activeSlip.lines.map((l) => l.multiple),
      [10, 10]
    );
    assert.ok(cCapBind.getState().workspace.appliedPlan?.capGuardAlternative);

    // 5. R5 #5, #6, #7 (P1): Real `createAppRoutes` ordering — newer server-captured roster adopted on first sync, interleaved pool quotes reconciled, and timeout-fallback provenance surfaced!
    const tBase = Date.parse("2026-11-24T12:00:00+08:00");
    let nowClock = tBase;
    let routeMatches = structuredClone([ms4[0], ms4[1], ms4[3]]);
    let pauseFetch = false;
    let failFetch = false;
    let releaseFetch!: () => void;
    const routes = createAppRoutes({
      nowFn: () => nowClock,
      fetchMatches: async () => {
        const buildRes = () => {
          if (failFetch) throw new TypeError("upstream timeout");
          const info = {
            source: "official-live" as const,
            boardState: "fresh" as const,
            lastValidBoardAt: nowClock,
            isFallbackReadOnly: false,
            bannerText: null,
          };
          return {
            matches: structuredClone(routeMatches),
            source: "official-live",
            boardMeta: enrichBoardQuoteMeta(info, routeMatches, nowClock),
            syncNote: "ok",
          };
        };
        if (!pauseFetch) return buildRes();
        return new Promise((res, rej) => {
          releaseFetch = () => {
            try {
              res(buildRes());
            } catch (e) {
              rej(e);
            }
          };
        });
      },
    });
    const sess = { aiAlerts: new Map() };
    const callRoute = async (ep: string, data: unknown) => {
      let out: any;
      await routes.handleDomainRoute(
        { method: "POST" },
        {},
        `/api/quant/${ep}`,
        {
          runEncryptedRoute: async (
            _rq: any,
            _rs: any,
            _ip: any,
            _op: any,
            fn: any
          ) => {
            out = await fn({ sess, data });
            return true;
          },
        }
      );
      return out;
    };
    const wbRoute = createWorkbenchController({
      storagePort: makeStore(),
      debounceMs: 0,
      quantPort: {
        computeWorkspace: (p) => callRoute("compute", p),
        syncMatches: (p) => callRoute("sync", { workspaceParams: p }),
      },
    });
    const initLoaded = await routes.ensureMatchesLoaded(true);
    wbRoute.betSlip.applyAuthenticatedBundle({
      matches: initLoaded.matches,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        { picks: [], multiple: 1 },
        initLoaded.matches
      ),
      boardMeta: initLoaded.boardMeta,
    });
    for (const m of [ms4[0], ms4[1], ms4[3]]) {
      wbRoute.betSlip.togglePick(m, "HAD", "h");
    }
    wbRoute.betSlip.setDirectMultiple(2);
    await wbRoute.betSlip.flush();
    // Warm 12:00:30 cache, start sync at :31, compute at :31.5, finish sync at :32 with [0, 1, 2]
    nowClock = tBase + 30_000;
    await routes.ensureMatchesLoaded(true);
    nowClock = tBase + 31_000;
    pauseFetch = true;
    const pSync = wbRoute.syncOfficialMatches();
    nowClock = tBase + 31_500;
    wbRoute.betSlip.setDirectMultiple(5);
    await wbRoute.betSlip.flush();
    nowClock = tBase + 32_000;
    routeMatches = structuredClone([ms4[0], ms4[1], ms4[2]]);
    releaseFetch();
    const syncOut = await pSync;
    await wbRoute.betSlip.flush();
    assert.equal(syncOut.ok, true);
    assert.equal(syncOut.matchCount, 3);
    assert.deepEqual(
      wbRoute.betSlip.getState().matches.map((m) => m.id),
      [ms4[0].id, ms4[1].id, ms4[2].id]
    );
    // Concurrent hot-cache compute (:33.2) vs timeout-fallback sync (:35.0)
    nowClock = tBase + 33_000;
    pauseFetch = true;
    const pFallbackSync = wbRoute.syncOfficialMatches();
    nowClock = tBase + 33_200;
    wbRoute.betSlip.setDirectMultiple(4);
    await wbRoute.betSlip.flush();
    nowClock = tBase + 35_000;
    failFetch = true;
    releaseFetch();
    await pFallbackSync;
    await wbRoute.betSlip.flush();
    assert.equal(wbRoute.getState().boardMeta?.boardState, "timeout-fallback");
    assert.ok(
      buildMatchRadarBoardFreshnessBanner(wbRoute.getState().boardMeta)
    );

    // 6. R5 #9 & #10 (P1): Unified k<=512 cold-first solver finds F(N) witness on 98-line empty cold zone AND crosses 2.5x plateau on 98-line non-empty cold zone!
    const m98x = structuredClone(ms4[0]);
    const m98y = structuredClone(ms4[1]);
    m98x.id = "r6-98-x";
    m98y.id = "r6-98-y";
    // #9: 98 lines (7 x 14), max state prob < 1.5% (empty cold zone), 1 line has unit=220 (< ¥392 at 2x, needs 2x -> 2x=440 >= 392? Use unit=130 -> 2x=260 < 392, 3x=390 < 392, 4x=520 >= 392!), rest have unit >= 450!
    const picks98Feas: SelectedPick[] = [
      ...m98x.pools.CRS.options.slice(0, 7).map((o, idx) => ({
        matchId: m98x.id,
        matchNumStr: m98x.matchNumStr,
        home: m98x.home,
        away: m98x.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: idx === 0 ? 8.0 : 18.0,
        fairProb: 0.08,
        singleAllowed: true,
        canAllUp: true,
      })),
      ...m98y.pools.CRS.options.slice(0, 14).map((o, idx) => ({
        matchId: m98y.id,
        matchNumStr: m98y.matchNumStr,
        home: m98y.home,
        away: m98y.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: idx === 0 ? 8.0 : 18.0,
        fairProb: 0.05,
        singleAllowed: true,
        canAllUp: true,
      })),
    ];
    // Sync match pool odds so coherent model & statutory units match
    for (const pk of picks98Feas) {
      const targetM = pk.matchId === m98x.id ? m98x : m98y;
      const opt = targetM.pools.CRS.options.find(
        (o) => o.key === pk.optionKey
      )!;
      opt.odds = pk.odds;
    }
    const rep98Feas = computeTruthReport(picks98Feas, 2, [m98x, m98y], {
      mode: "free",
      passSizes: [2],
    });
    assert.equal(rep98Feas.tickets?.length, 98);
    assert.equal(rep98Feas.totalCost, 392);
    assert.ok(rep98Feas.conditionalMinHitPayout < 392);
    const cold98Feas = optimizeBonusPlan(
      rep98Feas,
      [m98x, m98y],
      "cold-first"
    )!;
    assert.ok(
      cold98Feas.minReturn >= 392,
      `98-line empty-cold F(N)-feasible slip must achieve minReturn >= 392 (got ${cold98Feas.minReturn})`
    );

    // #10: 98-line non-empty cold zone where F(N)=∅ lifts cold-zone rows >= 2.5x stake (¥980) within EV & L_part guardrails!
    const m98ncA = structuredClone(ms4[2]);
    const m98ncB = structuredClone(ms4[3]);
    m98ncA.id = "r6-98-nca";
    m98ncB.id = "r6-98-ncb";
    const picks98NonEmpty: SelectedPick[] = [
      ...m98ncA.pools.CRS.options.slice(0, 7).map((o, idx) => ({
        matchId: m98ncA.id,
        matchNumStr: m98ncA.matchNumStr,
        home: m98ncA.home,
        away: m98ncA.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: idx === 0 ? 6.0 : 12.5,
        fairProb: idx === 0 ? 0.16 : 0.04,
        singleAllowed: true,
        canAllUp: true,
      })),
      ...m98ncB.pools.CRS.options.slice(0, 14).map((o, idx) => ({
        matchId: m98ncB.id,
        matchNumStr: m98ncB.matchNumStr,
        home: m98ncB.home,
        away: m98ncB.away,
        poolCode: "CRS" as const,
        poolName: "比分",
        optionKey: o.key,
        optionLabel: o.label,
        odds: idx < 2 ? 6.3 : 13.5,
        fairProb: idx < 2 ? 0.15 : 0.03,
        singleAllowed: true,
        canAllUp: true,
      })),
    ];
    for (const pk of picks98NonEmpty) {
      const targetM = pk.matchId === m98ncA.id ? m98ncA : m98ncB;
      targetM.pools.CRS.options.find((o) => o.key === pk.optionKey)!.odds =
        pk.odds;
    }
    const rep98NC = computeTruthReport(picks98NonEmpty, 2, [m98ncA, m98ncB], {
      mode: "free",
      passSizes: [2],
    });
    assert.equal(rep98NC.tickets?.length, 98);
    assert.equal(rep98NC.totalCost, 392);
    assert.equal(
      rep98NC.breakevenCert?.isCurrentFeasible,
      "certified-infeasible"
    );
    const cold98NC = optimizeBonusPlan(
      rep98NC,
      [m98ncA, m98ncB],
      "cold-first"
    )!;
    assert.ok(
      cold98NC.lines.some(
        (l) => l.unitPayout < 100 && l.returnPayout >= 2.5 * 392
      ),
      "98-line non-empty cold zone must lift credible cold rows across the 2.5x stake threshold (¥980)!"
    );
  });

  it("Slice 9 · R6 12-item closure (#1~#12): single-grant hold, sale-flag vs price merge + 5-pool closure, persistent hold across delist/reopen, cap-guard EV-diff binding, fallback provenance & roster guard, 64-bit swap cents, multi-match pure-single swap, exact small-k & L1=6 cold solver", async () => {
    // 1. #1 P0: Authorized single grant invalidated on ordinary compute enters hold (never auto-mounts ¥4 HHAD)
    {
      const mSingle = structuredClone(
        officialFixtureMatches.find(
          (m) =>
            !m.pools.HAD.single &&
            !m.pools.HHAD.single &&
            String(m.pools.HHAD.goalLine) === "-1" &&
            m.pools.HAFU.single
        ) ?? officialFixtureMatches[0]
      ) as MatchItem;
      mSingle.pools.HAD.single = false;
      mSingle.pools.HAD.canSingle = false;
      mSingle.pools.HHAD.goalLine = "-1";
      mSingle.pools.HHAD.single = false;
      mSingle.pools.HHAD.canSingle = false;
      mSingle.pools.HAFU.single = true;
      mSingle.pools.HAFU.canSingle = true;

      let nowT = 1_795_492_800_000;
      let remoteM = structuredClone(mSingle);
      const sess = { aiAlerts: new Map() };
      const routes = createAppRoutes({
        nowFn: () => nowT,
        fetchMatches: async () => ({
          matches: [structuredClone(remoteM)],
          source: "official-live",
          syncNote: "实盘",
          boardMeta: {
            ...freshOfficialBoard,
            lastValidBoardAt: nowT,
          },
        }),
      });
      await routes.ensureMatchesLoaded(true);
      const callRoute = async (ep: "compute" | "sync", data: unknown) => {
        let out: unknown = null;
        await routes.handleDomainRoute(
          { method: "POST" },
          {},
          `/api/quant/${ep}`,
          {
            runEncryptedRoute: async (
              _r: unknown,
              _s: unknown,
              _ip: unknown,
              _o: unknown,
              fn: (ctx: { data: unknown; sess: unknown }) => Promise<unknown>
            ) => {
              out = await fn({ data, sess });
              return true;
            },
          }
        );
        return out as ReturnType<typeof evaluateQuantWorkspace>;
      };
      const wb = createWorkbenchController({
        debounceMs: 0,
        quantPort: {
          computeWorkspace: (p) => callRoute("compute", p),
          syncMatches: (p) =>
            callRoute("sync", { workspaceParams: p }) as unknown as ReturnType<
              NonNullable<
                Parameters<typeof createWorkbenchController>[0]
              >["quantPort"] extends infer Q
                ? Q extends { syncMatches?: infer S }
                  ? NonNullable<S>
                  : never
                : never
            >,
        },
      });
      const initLoaded = await routes.ensureMatchesLoaded(false);
      wb.applyLoginBundle({
        authenticated: true,
        user: {
          id: "u-r6",
          username: "r6",
          note: "R6",
          role: "member",
          status: "active",
          lockedReason: null,
          createdAt: nowT,
          durationHours: null,
          firstLoginAt: nowT,
          expiresAt: null,
          remainingMs: null,
          maxDevices: 3,
          boundDevicesCount: 1,
          boundDevices: [],
          aiEnabled: true,
          dailyAiLimit: 10,
          aiUsedToday: 0,
          violationCount: 0,
          failedLoginCount: 0,
          loginLockedUntil: null,
        },
        authToken: "tok-r6",
        syncNote: "实盘",
        matches: initLoaded.matches,
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          initLoaded.matches
        ),
        boardMeta: initLoaded.boardMeta,
      });
      const c = wb.betSlip;
      c.setDirectMultiple(1);
      c.togglePick(remoteM, "HAD", "d");
      c.togglePick(remoteM, "HAD", "a");
      await c.flush();
      const s0 = c.getState();
      const cards = buildPendingSingleCrossPoolCards(
        s0.workspace.manualReport,
        s0.workspace.effectiveReport
      );
      const hafuCard =
        cards.find((cd) => cd.preview.poolCode === "HAFU") ?? cards[0];
      assert.ok(hafuCard, "Must have pending single card");
      assert.equal(c.confirmPartialCoverageSingle(hafuCard.preview).ok, true);
      await c.flush();
      await confirmDisplayedSyntheticTicket(c, hafuCard.preview.previewCost);
      const beforeCost = c.getState().workspace.effectiveReport.totalCost;
      assert.ok(beforeCost > 0);

      // Positive control: budget preview change alone without board mutation keeps confirmed grant & cost
      c.setBudget(98);
      await c.flush();
      assert.equal(c.getState().pendingRevokedPlanConfirm, null);
      assert.equal(
        c.getState().workspace.effectiveReport.totalCost,
        beforeCost
      );

      // Failing case: HHAD newly opens single on server; user changes budget -> must enter hold, NEVER auto-mount ¥4 HHAD!
      nowT += 1000;
      remoteM.pools.HHAD.single = true;
      remoteM.pools.HHAD.canSingle = true;
      await routes.ensureMatchesLoaded(true);
      c.setBudget(96);
      await c.flush();
      const heldSt = c.getState();
      assert.ok(heldSt.pendingRevokedPlanConfirm);
      assert.equal(heldSt.singleAuthGrant, null);
      assert.equal(heldSt.workspace.effectiveReport.canCheckout, false);
      assert.equal(heldSt.workspace.effectiveReport.totalCost, 0);
      assert.equal(c.formatShopkeeperWeChatSlip(), "");
      assert.equal(c.buildSealedLedgerDraft(), null);
    }

    // 2. #2 P0, #7 P1 & R6 Note #3: Sale-flag authority + 5-pool coherent recalibration + real /api/quant/compute interleaved pool payout
    {
      const mBase = structuredClone(
        officialFixtureMatches.find(
          (m) => String(m.pools.HHAD.goalLine) === "+1"
        ) ?? officialFixtureMatches[0]
      ) as MatchItem;
      mBase.pools.HHAD.goalLine = "+1";
      mBase.pools.HAD.updateDate = "2026-11-24";
      mBase.pools.HAD.updateTime = "13:34:25";
      mBase.pools.HAD.canAllUp = true;
      mBase.pools.HAD.canSingle = true;
      mBase.pools.HAD.single = true;
      mBase.pools.HHAD.updateDate = "2026-11-24";
      mBase.pools.HHAD.updateTime = "13:00:00";

      const mInc = structuredClone(mBase);
      // Regressed price timestamp on HAD (13:30:00 < 13:34:25) with revoked canAllUp = false, and newer HHAD (13:35:00)
      mInc.pools.HAD.updateTime = "13:30:00";
      mInc.pools.HAD.options[0].odds = Number(
        (mBase.pools.HAD.options[0].odds + 0.35).toFixed(2)
      );
      mInc.pools.HAD.canAllUp = false;
      mInc.pools.HHAD.updateTime = "13:35:00";
      mInc.pools.HHAD.options[0].odds = Number(
        (mBase.pools.HHAD.options[0].odds + 0.18).toFixed(2)
      );

      const merged = reconcileMatchesPoolsNonRegressive(
        [mBase],
        [mInc],
        analyzeMatchMicroQuant
      )[0] as MatchItem;
      assert.equal(
        merged.pools.HAD.options[0].odds,
        mBase.pools.HAD.options[0].odds,
        "Newer 13:34:25 HAD price must be preserved"
      );
      assert.equal(
        merged.pools.HAD.canAllUp,
        false,
        "Revoked live canAllUp=false must NEVER be resurrected by older price timestamp"
      );
      const pHome =
        merged.pools.HAD.options.find((o) => o.key === "h")?.fairProb ?? 0;
      const pDraw =
        merged.pools.HAD.options.find((o) => o.key === "d")?.fairProb ?? 0;
      const pPlusOneWin =
        merged.pools.HHAD.options.find((o) => o.key === "hh")?.fairProb ?? 0;
      assert.ok(
        Math.abs(pHome + pDraw - pPlusOneWin) < 1e-12,
        `Merged pools must maintain exact 5-pool coherent closure: ${pHome + pDraw} vs ${pPlusOneWin}`
      );

      // Real /api/quant/compute route interleaved pool test (HAD 12:00:50 @1.69 + HHAD 12:01:05 @3.76 -> 1.69 * 1.36 * 2 * 5 = ¥23.00)
      const rm0 = structuredClone(officialFixtureMatches[0]) as MatchItem;
      const rm1 = structuredClone(officialFixtureMatches[1]) as MatchItem;
      rm0.pools.HAD.options[0].odds = 1.69;
      rm0.pools.HAD.updateDate = "2026-11-24";
      rm0.pools.HAD.updateTime = "12:00:50";
      rm0.pools.HHAD.updateDate = "2026-11-24";
      rm0.pools.HHAD.updateTime = "12:00:10";
      rm1.pools.HAD.options[0].odds = 1.36;
      rm1.pools.HAD.updateDate = "2026-11-24";
      rm1.pools.HAD.updateTime = "12:00:50";

      let curBoard = [structuredClone(rm0), structuredClone(rm1)];
      let rtNow = 1_795_492_850_000;
      const routes6 = createAppRoutes({
        nowFn: () => rtNow,
        fetchMatches: async () => ({
          matches: structuredClone(curBoard),
          source: "official-live",
          syncNote: "实盘",
          boardMeta: {
            ...freshOfficialBoard,
            lastValidBoardAt: rtNow,
          },
        }),
      });
      await routes6.ensureMatchesLoaded(true);
      const sess6 = { aiAlerts: new Map() };
      const callCompute6 = async (data: unknown) => {
        let out: unknown = null;
        await routes6.handleDomainRoute(
          { method: "POST" },
          {},
          "/api/quant/compute",
          {
            runEncryptedRoute: async (
              _r: unknown,
              _s: unknown,
              _ip: unknown,
              _o: unknown,
              fn: (ctx: { data: unknown; sess: unknown }) => Promise<unknown>
            ) => {
              out = await fn({ data, sess: sess6 });
              return true;
            },
          }
        );
        return out as ReturnType<typeof evaluateQuantWorkspace>;
      };
      const init6 = await routes6.ensureMatchesLoaded(false);
      const ctrl6 = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: (params) => callCompute6(params),
      });
      ctrl6.applyAuthenticatedBundle({
        matches: init6.matches,
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          init6.matches
        ),
        boardMeta: init6.boardMeta,
      });
      ctrl6.togglePick(init6.matches[0], "HAD", "h");
      ctrl6.togglePick(init6.matches[1], "HAD", "h");
      ctrl6.setDirectMultiple(5);
      await ctrl6.flush();
      assert.equal(ctrl6.getState().workspace.effectiveReport.minPayout, 23);

      // Interleaved update: HAD regresses to 12:00:20 @1.79 while HHAD advances to 12:01:05 @3.76
      rtNow += 15_000;
      const nextRm0 = structuredClone(rm0);
      nextRm0.pools.HAD.options[0].odds = 1.79;
      nextRm0.pools.HAD.updateTime = "12:00:20";
      nextRm0.pools.HHAD.options[0].odds = 3.76;
      nextRm0.pools.HHAD.updateTime = "12:01:05";
      curBoard = [nextRm0, structuredClone(rm1)];
      await routes6.ensureMatchesLoaded(true);

      ctrl6.setBudget(120);
      await ctrl6.flush();
      assert.equal(ctrl6.getState().workspace.effectiveReport.minPayout, 23);
      const draft6 = ctrl6.buildSealedLedgerDraft();
      assert.ok(draft6);
      const auth6 = await routes6.ensureMatchesLoaded(false);
      const sealed6 = sealAuthoritativePrintSnapshot({
        workspaceParams: draft6.workspaceParams,
        authoritativeMatches: auth6.matches,
        boardMeta: auth6.boardMeta,
        entryKind: "live",
      });
      assert.equal(sealed6.totalCost, 10);
      assert.equal(sealed6.snapshot.lines[0].legs[0].odds, 1.69);
    }

    // 3. #3 P0 & #12 P2: Revoked plan hold survives market auto-delisting & session reload, zeros dock stakeUnitsCount, and clears on explicit user action
    {
      const memStore = new Map<string, string>();
      const storagePort = {
        getItem: (k: string) => memStore.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memStore.set(k, v);
        },
        removeItem: (k: string) => {
          memStore.delete(k);
        },
      };
      const b4 = structuredClone(
        officialFixtureMatches.slice(0, 4)
      ) as MatchItem[];
      const makeHoldCtrl = () =>
        createBetSlipController({
          debounceMs: 0,
          autoSyncRadar: true,
          storagePort,
          getAccountId: () => "acc-hold-r6",
          computeWorkspace: evaluateQuantWorkspace,
        });
      const c1 = makeHoldCtrl();
      c1.applyAuthenticatedBundle({
        matches: b4,
        boardMeta: liveBoard(1),
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          b4
        ),
      });
      c1.setBudget(20);
      c1.setDirectMultiple(2);
      for (const m of b4.slice(0, 2)) {
        c1.togglePick(m, "HAD", "h");
        c1.togglePick(m, "HAD", "d");
      }
      await c1.flush();
      const arch = c1
        .getState()
        .workspace.portfolioPlans.find((p) => p.available && p.lines?.length);
      assert.ok(arch);
      assert.equal(c1.applyArchetype(arch), true);
      await c1.flush();
      // Leave 3-match draft (b4[0], b4[2], b4[3]) while plan locks b4[0]+b4[1]
      c1.togglePick(b4[1], "HAD", "h");
      c1.togglePick(b4[1], "HAD", "d");
      c1.togglePick(b4[2], "HAD", "h");
      c1.togglePick(b4[3], "HAD", "h");
      await c1.flush();

      // Revoke b4[1] HAD all-up -> triggers revokedPlanHold
      const bRevoked = structuredClone(b4);
      bRevoked[1].pools.HAD.canAllUp = false;
      c1.applyMatchesSync({
        matches: bRevoked,
        boardMeta: liveBoard(2),
        workspace: evaluateQuantWorkspace(c1.buildWorkspaceParams(), bRevoked),
      });
      await c1.flush();
      const held1 = c1.getState();
      assert.ok(held1.pendingRevokedPlanConfirm);
      assert.equal(held1.workspace.effectiveReport.totalCost, 0);
      assert.equal(held1.workspace.effectiveReport.betCount, 0);
      assert.equal(held1.workspace.effectiveReport.stakeUnitsCount, 0);
      assert.equal(c1.buildSealedLedgerDraft(), null);

      // Market automatically delists 4th match (bRevoked[3]) -> hold MUST remain active!
      const bDelisted = bRevoked.slice(0, 3);
      c1.applyMatchesSync({
        matches: bDelisted,
        boardMeta: liveBoard(3),
        workspace: evaluateQuantWorkspace(c1.buildWorkspaceParams(), bDelisted),
      });
      await c1.flush();
      assert.ok(c1.getState().pendingRevokedPlanConfirm);
      assert.equal(c1.formatShopkeeperWeChatSlip(), "");
      assert.equal(c1.buildSealedLedgerDraft(), null);

      // Reopen workbench on same storagePort -> hold MUST be restored from persisted draft!
      const c2 = makeHoldCtrl();
      c2.applyAuthenticatedBundle({
        matches: bDelisted,
        boardMeta: liveBoard(3),
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          bDelisted
        ),
      });
      await c2.flush();
      assert.ok(c2.getState().pendingRevokedPlanConfirm);
      assert.equal(c2.getState().workspace.effectiveReport.totalCost, 0);
      assert.equal(c2.buildSealedLedgerDraft(), null);

      // Explicit user confirmation clears hold and restores ¥8 playable slip (4 stake units)
      c2.revertToManualDraft();
      await c2.flush();
      assert.equal(c2.getState().pendingRevokedPlanConfirm, null);
      assert.equal(c2.getState().workspace.effectiveReport.totalCost, 8);
      assert.equal(c2.getState().workspace.effectiveReport.stakeUnitsCount, 4);
      assert.ok(c2.buildSealedLedgerDraft());
    }

    // 4. #4 P0: Cap-guard confirmation bound to disclosed EV/shortfall tradeoff
    {
      const rawCm0 = structuredClone(officialFixtureMatches[0]) as MatchItem;
      const rawCm1 = structuredClone(officialFixtureMatches[1]) as MatchItem;
      rawCm0.pools.CRS.options[0].odds = 12;
      rawCm0.pools.CRS.options[1].odds = 250;
      rawCm1.pools.CRS.options[0].odds = 500;
      const cm0 = recalibrateMergedMatch(rawCm0) as MatchItem;
      const cm1 = recalibrateMergedMatch(rawCm1) as MatchItem;
      const cCap = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: evaluateQuantWorkspace,
      });
      cCap.applyAuthenticatedBundle({
        matches: [cm0, cm1],
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 } as never, [
          cm0,
          cm1,
        ]),
      });
      cCap.setDirectMultiple(10);
      cCap.togglePick(cm0, "CRS", cm0.pools.CRS.options[0].key);
      cCap.togglePick(cm0, "CRS", cm0.pools.CRS.options[1].key);
      cCap.togglePick(cm1, "CRS", cm1.pools.CRS.options[0].key);
      await cCap.flush();
      cCap.applyBonusOptimization("cold-first");
      await cCap.flush();
      const alt0 = cCap.getState().workspace.appliedPlan?.capGuardAlternative;
      assert.ok(alt0);
      assert.equal(cCap.confirmBonusCapGuardAlternative(alt0).ok, true);
      await cCap.flush();
      assert.deepEqual(
        cCap.getState().activeSlip.lines.map((l) => l.multiple),
        [19, 1]
      );

      // Requote an UNSELECTED CRS option on cm0 (leaving all 3 selected leg SPs untouched) and recalibrate!
      const rawShifted = structuredClone(rawCm0);
      const unselOpt = rawShifted.pools.CRS.options[5];
      unselOpt.odds = Number(Math.max(1.8, unselOpt.odds * 0.45).toFixed(2));
      const cm0Shifted = recalibrateMergedMatch(rawShifted) as MatchItem;
      cCap.applyMatchesSync(
        {
          matches: [cm0Shifted, cm1],
          workspace: evaluateQuantWorkspace(cCap.buildWorkspaceParams(), [
            cm0Shifted,
            cm1,
          ]),
        },
        cCap.captureSyncRequestContext()
      );
      await cCap.flush();
      const postShift = cCap.getState();
      assert.equal(
        postShift.planSpec?.kind === "bonus"
          ? Boolean(postShift.planSpec.allowCapEvTradeoff)
          : false,
        false
      );
      assert.deepEqual(
        postShift.activeSlip.lines.map((l) => l.multiple),
        [10, 10]
      );
      assert.ok(postShift.workspace.appliedPlan?.capGuardAlternative);
    }

    // 5. #5 P1 & #6 P1: Fallback provenance after hot-cache quote update + memory roster preferred over older disk snapshot
    {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slice9-disk-"));
      const snapFile = path.join(tmpDir, "snap.json");
      try {
        let clock = 1_795_492_800_000;
        let failFetch = false;
        let liveSet = structuredClone(
          officialFixtureMatches.slice(0, 3)
        ) as MatchItem[];
        fs.writeFileSync(
          snapFile,
          JSON.stringify({
            __capturedAt: clock,
            value: { matchInfoList: [] },
          })
        );
        const routesDisk = createAppRoutes({
          nowFn: () => clock,
          fetchMatches: async (
            _f: string,
            opts: { lastValidBoardAt?: number | null }
          ) => {
            if (failFetch) {
              return {
                matches: structuredClone(officialFixtureMatches.slice(0, 2)),
                source: "cached-snapshot",
                syncNote: "旧磁盘回退",
                boardMeta: {
                  source: "cached-snapshot",
                  boardState: "timeout-fallback",
                  isFallbackReadOnly: true,
                  lastValidBoardAt: 1_795_492_800_000,
                },
              };
            }
            return {
              matches: structuredClone(liveSet),
              source: "official-live",
              syncNote: "实盘",
              boardMeta: {
                ...freshOfficialBoard,
                lastValidBoardAt: clock,
              },
              _prevValid: opts?.lastValidBoardAt,
            };
          },
        });
        await routesDisk.ensureMatchesLoaded(true);
        clock += 10_000;
        liveSet = [
          structuredClone(officialFixtureMatches[0]),
          structuredClone(officialFixtureMatches[1]),
          structuredClone(officialFixtureMatches[3]),
        ] as MatchItem[];
        const newerLive = await routesDisk.ensureMatchesLoaded(true);
        assert.equal(newerLive.matches[2].id, officialFixtureMatches[3].id);

        // Upstream fails and adapter returns older :00 disk snapshot -> routesDisk MUST preserve :10 live roster!
        clock += 1000;
        failFetch = true;
        const fbLoaded = await routesDisk.ensureMatchesLoaded(true);
        assert.equal(fbLoaded.boardMeta.boardState, "timeout-fallback");
        assert.equal(fbLoaded.boardMeta.isFallbackReadOnly, true);
        assert.equal(fbLoaded.matches[2].id, officialFixtureMatches[3].id);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      // Keep unused import check satisfied
      assert.equal(typeof fetchOfficialMatchesServer, "function");
    }

    // 6. #8 P1, #9 P1, #10 P1 & #11 P2: >2^31 cent swap diff, multi-match pure single swap, exact small-k cold solver
    {
      const sm0 = structuredClone(officialFixtureMatches[0]) as MatchItem;
      const sm1 = structuredClone(officialFixtureMatches[1]) as MatchItem;
      const sm2 = structuredClone(officialFixtureMatches[2]) as MatchItem;
      // Ensure CRS 1:0 + 0:1 is strictly dominated by TTG s1 on sm0
      sm0.pools.CRS.single = true;
      sm0.pools.CRS.canSingle = true;
      sm0.pools.TTG.single = true;
      sm0.pools.TTG.canSingle = true;
      sm1.pools.CRS.single = true;
      sm1.pools.CRS.canSingle = true;
      const c10 = sm0.pools.CRS.options.find((o) => o.key === "1:0")!;
      const c01 = sm0.pools.CRS.options.find((o) => o.key === "0:1")!;
      const ts1 = sm0.pools.TTG.options.find((o) => o.key === "s1")!;
      c10.odds = 6.5;
      c01.odds = 7.5;
      ts1.odds = 4.2;
      sm1.pools.CRS.options[0].odds = 300;
      sm2.pools.CRS.options[0].odds = 300;

      // #8: 215x capped 3-leg parlay -> exact ¥43,000,000 maxStateReturnDiff without Int32 overflow!
      const cBig = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: evaluateQuantWorkspace,
      });
      cBig.applyAuthenticatedBundle({
        matches: [sm0, sm1, sm2],
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 } as never, [
          sm0,
          sm1,
          sm2,
        ]),
      });
      cBig.togglePick(sm0, "CRS", "1:0");
      cBig.togglePick(sm0, "CRS", "0:1");
      cBig.togglePick(sm1, "CRS", sm1.pools.CRS.options[0].key);
      cBig.togglePick(sm2, "CRS", sm2.pools.CRS.options[0].key);
      cBig.setDirectMultiple(215);
      await cBig.flush();
      const bigTip = cBig
        .getState()
        .workspace.insights.wholeSlipEquivalentSwaps?.find(
          (t) =>
            t.matchId === sm0.id &&
            t.betterPicks[0]?.poolCode === "TTG" &&
            t.betterPicks[0]?.optionKey === "s1"
        );
      assert.ok(bigTip);
      assert.equal(bigTip.minStateReturnDiff, 0);
      assert.equal(bigTip.maxStateReturnDiff, 43_000_000);

      // #9: Multi-match pure single slip with extra same-match CRS pick allows preview, apply & seal!
      const cPure = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: evaluateQuantWorkspace,
      });
      cPure.applyAuthenticatedBundle({
        matches: [sm0, sm1],
        initialPicks: [],
        workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 } as never, [
          sm0,
          sm1,
        ]),
      });
      cPure.setDirectMultiple(1);
      cPure.setMode("single");
      cPure.togglePick(sm0, "CRS", "1:0");
      cPure.togglePick(sm0, "CRS", "0:1");
      cPure.togglePick(sm0, "CRS", "2:0");
      cPure.togglePick(sm1, "CRS", "2:0");
      await cPure.flush();
      const pureTip = cPure
        .getState()
        .workspace.insights.wholeSlipEquivalentSwaps?.find(
          (t) =>
            t.matchId === sm0.id &&
            t.betterPicks[0]?.poolCode === "TTG" &&
            t.betterPicks[0]?.optionKey === "s1"
        );
      assert.ok(pureTip);
      assert.equal(cPure.previewEquivalentSwap(pureTip).ok, true);
      assert.equal(cPure.applyEquivalentSwap(pureTip), true);
      await cPure.flush();
      const pureDraft = cPure.buildSealedLedgerDraft();
      assert.ok(pureDraft);
      const pureSealed = sealAuthoritativePrintSnapshot({
        workspaceParams: pureDraft.workspaceParams,
        authoritativeMatches: [sm0, sm1],
      });
      assert.equal(pureSealed.totalCost, 8);
      assert.equal(pureSealed.snapshot.lines.length, 3);

      // #10: Exact small-k composition enumeration provably matches 91-vector exhaustive optimum & lifts s5 >= 2.5x stake (¥75)
      const rawTtg = structuredClone(officialFixtureMatches[0]) as MatchItem;
      rawTtg.pools.TTG.single = true;
      rawTtg.pools.TTG.canSingle = true;
      rawTtg.pools.TTG.options.find((o) => o.key === "s3")!.odds = 3.7;
      rawTtg.pools.TTG.options.find((o) => o.key === "s5")!.odds = 5.55;
      rawTtg.pools.TTG.options.find((o) => o.key === "s6")!.odds = 8.75;
      const mTtg = recalibrateMergedMatch(rawTtg) as MatchItem;
      const repTtg = computeTruthReport(
        [
          makePick(mTtg, "TTG", "s3"),
          makePick(mTtg, "TTG", "s5"),
          makePick(mTtg, "TTG", "s6"),
        ],
        5,
        [mTtg],
        { mode: "free", passSizes: [1] }
      );
      const planTtg = optimizeBonusPlan(repTtg, [mTtg], "cold-first")!;
      assert.equal(
        planTtg.lines.reduce((s, l) => s + l.multiple, 0),
        15
      );
      assert.equal(planTtg.isExactOptimal, true);
      assert.ok(
        planTtg.lines.every((l) => l.returnPayout >= 30),
        "All 3 TTG lines must preserve F(N) >= ¥30"
      );
      const s5Line = planTtg.lines.find((l) => l.legs[0]?.optionKey === "s5")!;
      assert.ok(
        s5Line.returnPayout >= 75,
        `s5 line must lift across 2.5x stake (¥75), got ¥${s5Line.returnPayout}`
      );

      // #10 near-999 dual composition exactness ([998, 998, 998] -> 10 valid vectors <= 30,000)
      const repNear999 = computeTruthReport(
        [
          makePick(mTtg, "TTG", "s3"),
          makePick(mTtg, "TTG", "s5"),
          makePick(mTtg, "TTG", "s6"),
        ],
        998,
        [mTtg],
        { mode: "free", passSizes: [1] }
      );
      const planNear999 = optimizeBonusPlan(repNear999, [mTtg], "cold-first")!;
      assert.equal(planNear999.isExactOptimal, true);
      assert.equal(
        planNear999.lines.reduce((s, l) => s + l.multiple, 0),
        2994
      );
    }

    // 7. #10 P2 & #11 P2: 98-line cap-containing empty-cold L1===6 + non-empty cold secondary upper bound, and 11-match single [0,45] / >100k coupled omission
    {
      // 14 × 7 = 98 disjoint 2串1 CRS lines at 2x (C = ¥392):
      // Empty-cold (<1.5% per joint state) with 3 tail cap-clipped lines -> deterministic minimal L1 === 6!
      const cm0 = structuredClone(officialFixtureMatches[0]) as MatchItem;
      const cm1 = structuredClone(officialFixtureMatches[1]) as MatchItem;
      cm0.pools.CRS.canAllUp = true;
      cm1.pools.CRS.canAllUp = true;
      const tail0 = cm0.pools.CRS.options.slice(-14);
      const tail1 = cm1.pools.CRS.options.slice(-7);
      for (let i = 0; i < tail0.length; i++) {
        tail0[i].odds = i >= 11 ? 400 : 15 + i;
      }
      for (let j = 0; j < tail1.length; j++) {
        tail1[j].odds = j === 6 ? 350 : 16 + j;
      }
      const calCm0 = recalibrateMergedMatch(cm0) as MatchItem;
      const calCm1 = recalibrateMergedMatch(cm1) as MatchItem;
      const picks98Empty: SelectedPick[] = [
        ...calCm0.pools.CRS.options
          .slice(-14)
          .map((o) => makePick(calCm0, "CRS", o.key)),
        ...calCm1.pools.CRS.options
          .slice(-7)
          .map((o) => makePick(calCm1, "CRS", o.key)),
      ];
      const rep98Empty = computeTruthReport(picks98Empty, 2, [calCm0, calCm1], {
        mode: "free",
        passSizes: [2],
      });
      assert.equal(rep98Empty.tickets?.length, 98);
      const plan98Empty = optimizeBonusPlan(
        rep98Empty,
        [calCm0, calCm1],
        "cold-first"
      )!;
      assert.equal(plan98Empty.isExactOptimal, false);
      assert.ok(
        !plan98Empty.reasons.some((r) => r.includes("全局最优")),
        "Non-enumerated 98-line slip must not claim global optimality"
      );
      const l1Empty = plan98Empty.lines.reduce(
        (s, l) => s + Math.abs(l.multiple - 2),
        0
      );
      assert.equal(
        l1Empty,
        6,
        "3 cap-clipped lines stripped 2->1 -> exact minimal L1 = 2 * 3 = 6"
      );

      // Non-empty cold on 98 lines (boost 2:1 & 1:0 probabilities so >=1.5% cold cells exist): hits 5x saturation (4 * coldMass)!
      const hotCm0 = structuredClone(cm0);
      const hotCm1 = structuredClone(cm1);
      hotCm0.pools.CRS.options[3].odds = 4.5;
      hotCm0.pools.CRS.options[4].odds = 5.2;
      hotCm1.pools.CRS.options[1].odds = 4.6;
      hotCm1.pools.CRS.options[2].odds = 5.5;
      const calHot0 = recalibrateMergedMatch(hotCm0) as MatchItem;
      const calHot1 = recalibrateMergedMatch(hotCm1) as MatchItem;
      const picks98Cold: SelectedPick[] = [
        ...calHot0.pools.CRS.options
          .slice(0, 14)
          .map((o) => makePick(calHot0, "CRS", o.key)),
        ...calHot1.pools.CRS.options
          .slice(0, 7)
          .map((o) => makePick(calHot1, "CRS", o.key)),
      ];
      const rep98Cold = computeTruthReport(picks98Cold, 2, [calHot0, calHot1], {
        mode: "free",
        passSizes: [2],
      });
      assert.equal(rep98Cold.tickets?.length, 98);
      const plan98Cold = optimizeBonusPlan(
        rep98Cold,
        [calHot0, calHot1],
        "cold-first"
      )!;
      const pMaxCold = Math.max(...plan98Cold.lines.map((l) => l.prob));
      const pThreshCold = Math.max(0.015, 0.2 * pMaxCold) - 1e-12;
      const eligCold = plan98Cold.lines
        .filter((l) => l.prob >= pThreshCold)
        .sort((a, b) => a.unitPayout - b.unitPayout);
      const eligMass = eligCold.reduce((s, l) => s + l.prob, 0);
      let accMass = 0;
      let uFloor = Infinity;
      for (const l of eligCold) {
        accMass += l.prob;
        if (accMass >= 0.75 * eligMass - 1e-12) {
          uFloor = l.unitPayout;
          break;
        }
      }
      const credibleColdLines = eligCold.filter((l) => l.unitPayout >= uFloor);
      assert.ok(
        credibleColdLines.length >= 2,
        "Expected >= 2 credible cold lines on 98-line test"
      );
      const baselineColdExcess = credibleColdLines.reduce(
        (s, l) =>
          s +
          l.prob *
            Math.min(
              4,
              Math.max(0, (l.unitPayout * 2) / rep98Cold.totalCost - 1)
            ),
        0
      );
      assert.equal(
        baselineColdExcess,
        0,
        "Baseline 2x must have 0 credible cold excess so test cannot pass trivially"
      );
      const coldMass = credibleColdLines.reduce((s, l) => s + l.prob, 0);
      const optColdExcess = credibleColdLines.reduce(
        (s, l) =>
          s +
          l.prob *
            Math.min(4, Math.max(0, l.returnPayout / rep98Cold.totalCost - 1)),
        0
      );
      assert.ok(
        Math.abs(optColdExcess - 4 * coldMass) < 1e-12,
        `98-line credible cold secondary objective must hit exact 4*coldMass upper bound (${4 * coldMass}), got ${optColdExcess}`
      );

      // #11: 11-match pure single swap cancels 10 unchanged lines -> exact [0, 15], while 8-match coupled 2串1 (>100k states) omits min/maxStateReturnDiff
      const elevenMatches = Array.from({ length: 11 }, (_, idx) => {
        const clone = structuredClone(
          officialFixtureMatches[idx % officialFixtureMatches.length]
        ) as MatchItem;
        clone.id = `r8-m11-${idx + 1}`;
        clone.matchNumStr = `周四${String(idx + 1).padStart(3, "0")}`;
        clone.pools.CRS.single = true;
        clone.pools.CRS.canSingle = true;
        clone.pools.TTG.single = true;
        clone.pools.TTG.canSingle = true;
        clone.pools.HAD.single = true;
        clone.pools.HAD.canSingle = true;
        return clone;
      });
      elevenMatches[0].pools.CRS.options.find((o) => o.key === "1:0")!.odds =
        6.5;
      elevenMatches[0].pools.CRS.options.find((o) => o.key === "0:1")!.odds =
        7.5;
      elevenMatches[0].pools.TTG.options.find((o) => o.key === "s1")!.odds =
        4.2;
      const picks11: SelectedPick[] = [
        makePick(elevenMatches[0], "CRS", "1:0"),
        makePick(elevenMatches[0], "CRS", "0:1"),
        ...elevenMatches.slice(1).map((m) => makePick(m, "HAD", "h")),
      ];
      const ws11 = evaluateQuantWorkspace(
        {
          picks: picks11,
          multiple: 15,
          passSpec: { mode: "free", passSizes: [1] },
        } as never,
        elevenMatches
      );
      const tip11 = ws11.insights.wholeSlipEquivalentSwaps?.find(
        (t) =>
          t.matchId === elevenMatches[0].id &&
          t.betterPicks[0]?.poolCode === "TTG" &&
          t.betterPicks[0]?.optionKey === "s1"
      );
      assert.ok(tip11);
      assert.equal(tip11.minStateReturnDiff, 0);
      assert.equal(tip11.maxStateReturnDiff, 57);

      const eightCoupled = elevenMatches.slice(0, 8);
      const picks8Coupled: SelectedPick[] = [
        makePick(eightCoupled[0], "CRS", "1:0"),
        makePick(eightCoupled[0], "CRS", "0:1"),
        ...eightCoupled
          .slice(1)
          .flatMap((m) =>
            m.pools.CRS.options
              .slice(0, 4)
              .map((o) => makePick(m, "CRS", o.key))
          ),
      ];
      const ws8Coupled = evaluateQuantWorkspace(
        {
          picks: picks8Coupled,
          multiple: 1,
          passSpec: { mode: "free", passSizes: [2] },
        } as never,
        eightCoupled
      );
      const tip8Coupled = ws8Coupled.insights.wholeSlipEquivalentSwaps?.find(
        (t) =>
          t.matchId === eightCoupled[0].id &&
          t.betterPicks[0]?.poolCode === "TTG" &&
          t.betterPicks[0]?.optionKey === "s1"
      );
      assert.ok(tip8Coupled);
      assert.equal(Object.hasOwn(tip8Coupled, "minStateReturnDiff"), false);
      assert.equal(Object.hasOwn(tip8Coupled, "maxStateReturnDiff"), false);
    }

    // 8. R7-B2 P0: Positive HHAD goalLine ("+1" & "+2") capGuard confirmation survives same-board sync & seals [19, 1]
    for (const gl of ["+1", "+2", "-1"]) {
      const hm0 = structuredClone(officialFixtureMatches[0]) as MatchItem;
      const hm1 = structuredClone(officialFixtureMatches[1]) as MatchItem;
      const hm2 = structuredClone(officialFixtureMatches[2]) as MatchItem;
      hm0.pools.CRS.options[0].odds = 500;
      hm0.pools.CRS.options[1].odds = 120;
      hm1.pools.CRS.options[0].odds = 210;
      hm2.pools.HHAD.goalLine = gl;
      hm2.pools.HHAD.canAllUp = true;
      hm2.pools.HHAD.options.find((o) => o.key === "ha")!.odds = 3.6;
      const boardGl = [hm0, hm1, hm2].map(
        (m) => recalibrateMergedMatch(m) as MatchItem
      );

      const cPosGl = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: evaluateQuantWorkspace,
      });
      cPosGl.applyAuthenticatedBundle({
        matches: boardGl,
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          boardGl
        ),
      });
      cPosGl.setDirectMultiple(10);
      cPosGl.togglePick(boardGl[0], "CRS", boardGl[0].pools.CRS.options[0].key);
      cPosGl.togglePick(boardGl[0], "CRS", boardGl[0].pools.CRS.options[1].key);
      cPosGl.togglePick(boardGl[1], "CRS", boardGl[1].pools.CRS.options[0].key);
      cPosGl.togglePick(boardGl[2], "HHAD", "ha");
      await cPosGl.flush();
      cPosGl.applyBonusOptimization("cold-first");
      await cPosGl.flush();
      const altGl =
        cPosGl.getState().workspace.appliedPlan?.capGuardAlternative;
      assert.ok(altGl, `Expected capGuardAlternative for goalLine ${gl}`);
      assert.equal(cPosGl.confirmBonusCapGuardAlternative(altGl).ok, true);
      await cPosGl.flush();
      const multsBefore = cPosGl
        .getState()
        .activeSlip.lines.map((l) => l.multiple)
        .sort((a, b) => a - b);
      assert.deepEqual(multsBefore, [1, 19]);

      const syncCtx = cPosGl.captureSyncRequestContext();
      const sameClone = structuredClone(boardGl);
      cPosGl.applyMatchesSync(
        {
          matches: sameClone,
          workspace: evaluateQuantWorkspace(
            cPosGl.buildWorkspaceParams(),
            sameClone
          ),
        },
        syncCtx
      );
      await cPosGl.flush();
      assert.deepEqual(
        cPosGl
          .getState()
          .activeSlip.lines.map((l) => l.multiple)
          .sort((a, b) => a - b),
        [1, 19],
        `Same-board sync with HHAD goalLine ${gl} must preserve confirmed [1, 19]`
      );
      const sealedPos = sealAuthoritativePrintSnapshot({
        workspaceParams: cPosGl.buildSealedLedgerDraft()!.workspaceParams,
        authoritativeMatches: sameClone,
      });
      assert.deepEqual(
        sealedPos.snapshot.lines.map((l) => l.multiple).sort((a, b) => a - b),
        [1, 19]
      );
    }

    // 9. R7-B1 P0: Same-account cross-tab shared draft (setBudget & lateTick) + QuotaExceededError compact hold persistence
    {
      const mem = new Map<string, string>();
      let maxOriginUnits = Infinity;
      const quotaStorage = {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          const next = new Map(mem);
          next.set(k, v);
          const units = [...next].reduce(
            (sum, [kk, vv]) => sum + kk.length + vv.length,
            0
          );
          if (units > maxOriginUnits) {
            throw new DOMException(
              "Storage quota reached",
              "QuotaExceededError"
            );
          }
          mem.set(k, v);
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      };

      const remoteBoard = structuredClone(
        officialFixtureMatches.slice(0, 3)
      ) as MatchItem[];
      let boardRevision = 1;
      const makeTab = () => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: quotaStorage,
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? remoteBoard),
            syncMatches: async (wp) => ({
              matches: structuredClone(remoteBoard),
              syncNote: "实盘",
              freshBoardForRequest: true,
              boardMeta: liveBoard(++boardRevision),
              workspace: evaluateQuantWorkspace(wp, remoteBoard),
            }),
          },
        });
        wb.betSlip.applyAuthenticatedBundle({
          matches: structuredClone(remoteBoard),
          initialPicks: [],
          boardMeta: liveBoard(boardRevision),
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            remoteBoard
          ),
        });
        return wb;
      };

      const tabA = makeTab();
      tabA.betSlip.setDirectMultiple(2);
      tabA.betSlip.togglePick(remoteBoard[0], "HAD", "h");
      tabA.betSlip.togglePick(remoteBoard[0], "HAD", "d");
      tabA.betSlip.togglePick(remoteBoard[1], "HAD", "h");
      tabA.betSlip.setBudget(20);
      await tabA.betSlip.flush();
      const archPlan = tabA.betSlip
        .getState()
        .workspace.portfolioPlans.find((p) => p.available !== false)!;
      assert.equal(tabA.betSlip.applyArchetype(archPlan), true);
      await tabA.betSlip.flush();

      // Open Tab B on same account before revocation
      const tabB = makeTab();
      await tabB.betSlip.flush();
      assert.equal(
        tabB.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );

      // Lock quota to exact pre-hold origin capacity (0 extra code units!)
      const draftKey = "yj_manual_draft_v1:default";
      const originUnitsBeforeHold = [...mem].reduce(
        (s, [k, v]) => s + k.length + v.length,
        0
      );
      maxOriginUnits = originUnitsBeforeHold;

      // Revoke canAllUp on remoteBoard[1] and sync Tab A -> compact hold must persist within 0 extra capacity!
      remoteBoard[1].pools.HAD.canAllUp = false;
      await tabA.syncOfficialMatches();
      await tabA.betSlip.flush();
      assert.ok(tabA.betSlip.getState().pendingRevokedPlanConfirm);
      assert.ok(
        JSON.parse(mem.get(draftKey)!).pendingRevokedPlanConfirm,
        "Compact hold must persist even when localStorage has 0 spare code units"
      );

      // Tab B edits budget (setBudget(50)) -> must adopt hold and preserve pendingRevokedPlanConfirm in shared storage!
      maxOriginUnits = Infinity;
      tabB.betSlip.setBudget(50);
      await tabB.betSlip.flush();
      assert.ok(tabB.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(
        tabB.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.ok(JSON.parse(mem.get(draftKey)!).pendingRevokedPlanConfirm);

      // Reloaded tab must still be held (cost=0, wx="", sealed=null)!
      const tabReloaded = makeTab();
      await tabReloaded.betSlip.flush();
      assert.ok(tabReloaded.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(
        tabReloaded.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.equal(tabReloaded.betSlip.formatShopkeeperWeChatSlip(), "");
      assert.equal(tabReloaded.betSlip.buildSealedLedgerDraft(), null);

      // Explicit user action (revertToManualDraft) releases hold cleanly across reload!
      remoteBoard[1].pools.HAD.canAllUp = true;
      await tabReloaded.syncOfficialMatches();
      await tabReloaded.betSlip.flush();
      assert.ok(tabReloaded.betSlip.getState().pendingRevokedPlanConfirm);
      tabReloaded.betSlip.revertToManualDraft();
      await tabReloaded.betSlip.flush();
      assert.equal(
        tabReloaded.betSlip.getState().pendingRevokedPlanConfirm,
        null
      );
      assert.equal(
        tabReloaded.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );
    }

    // 10. R8-B1..B4 P0: Passive empty delist on Tab B, distinct 2x vs 3x draft confirm, zero-capacity open-tab eviction, and minimalJson team-swap rejection
    {
      // R8-B1: Market delisting Tab B's sole draft match MUST NOT clear hold on Tab A's 2-match ¥8 slip!
      const b1Mem = new Map<string, string>();
      const b1Store = {
        getItem: (k: string) => b1Mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          b1Mem.set(k, v);
        },
        removeItem: (k: string) => {
          b1Mem.delete(k);
        },
      };
      let b1Board = structuredClone(
        officialFixtureMatches.slice(0, 4)
      ) as MatchItem[];
      const makeB1Tab = () => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: b1Store,
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? b1Board),
            syncMatches: async (wp) => ({
              matches: structuredClone(b1Board),
              syncNote: "实盘",
              workspace: evaluateQuantWorkspace(wp, b1Board),
            }),
          },
        });
        wb.betSlip.applyAuthenticatedBundle({
          matches: structuredClone(b1Board),
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            b1Board
          ),
        });
        return wb;
      };
      const tA1 = makeB1Tab();
      tA1.betSlip.setDirectMultiple(2);
      tA1.betSlip.togglePick(b1Board[0], "HAD", "h");
      tA1.betSlip.togglePick(b1Board[0], "HAD", "d");
      tA1.betSlip.togglePick(b1Board[1], "HAD", "h");
      tA1.betSlip.setBudget(20);
      await tA1.betSlip.flush();
      assert.equal(
        tA1.betSlip.applyArchetype(
          tA1.betSlip
            .getState()
            .workspace.portfolioPlans.find((p) => p.available !== false)!
        ),
        true
      );
      await tA1.betSlip.flush();
      tA1.betSlip.togglePick(b1Board[1], "HAD", "h");
      tA1.betSlip.togglePick(b1Board[2], "HAD", "h");
      await tA1.betSlip.flush();

      const tB1 = makeB1Tab();
      tB1.betSlip.clearPicks();
      tB1.betSlip.togglePick(b1Board[3], "HAD", "h");
      await tB1.betSlip.flush();

      // Revoke canAllUp on locked plan match b1Board[1] -> both A and B enter hold
      b1Board[1].pools.HAD.canAllUp = false;
      await tA1.syncOfficialMatches();
      await tA1.betSlip.flush();
      assert.ok(tA1.betSlip.getState().pendingRevokedPlanConfirm);
      assert.ok(tB1.betSlip.getState().pendingRevokedPlanConfirm);

      // Market delists b1Board[3] (Tab B's ONLY match) and Tab B syncs -> Tab A MUST remain held at ¥0!
      b1Board = b1Board.slice(0, 3);
      await tB1.syncOfficialMatches();
      await tB1.betSlip.flush();
      await tA1.syncOfficialMatches();
      await tA1.betSlip.flush();
      assert.ok(tA1.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(
        tA1.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.equal(tA1.betSlip.formatShopkeeperWeChatSlip(), "");
      assert.equal(tA1.betSlip.buildSealedLedgerDraft(), null);

      // R8-B2: Confirming 2x (¥8) in Tab A MUST NOT be overwritten to 3x (¥12) by Tab B's different unconfirmed draft!
      const b2Mem = new Map<string, string>();
      const b2Store = {
        getItem: (k: string) => b2Mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          b2Mem.set(k, v);
        },
        removeItem: (k: string) => {
          b2Mem.delete(k);
        },
      };
      const b2Board = structuredClone(
        officialFixtureMatches.slice(0, 3)
      ) as MatchItem[];
      const makeB2Tab = () => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: b2Store,
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? b2Board),
            syncMatches: async (wp) => ({
              matches: structuredClone(b2Board),
              syncNote: "实盘",
              workspace: evaluateQuantWorkspace(wp, b2Board),
            }),
          },
        });
        wb.betSlip.applyAuthenticatedBundle({
          matches: structuredClone(b2Board),
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            b2Board
          ),
        });
        return wb;
      };
      const tA2 = makeB2Tab();
      tA2.betSlip.setDirectMultiple(2);
      tA2.betSlip.togglePick(b2Board[0], "HAD", "h");
      tA2.betSlip.togglePick(b2Board[0], "HAD", "d");
      tA2.betSlip.togglePick(b2Board[1], "HAD", "h");
      tA2.betSlip.setBudget(20);
      await tA2.betSlip.flush();
      assert.equal(
        tA2.betSlip.applyArchetype(
          tA2.betSlip
            .getState()
            .workspace.portfolioPlans.find((p) => p.available !== false)!
        ),
        true
      );
      await tA2.betSlip.flush();
      tA2.betSlip.togglePick(b2Board[1], "HAD", "h");
      tA2.betSlip.togglePick(b2Board[2], "HAD", "h");
      await tA2.betSlip.flush();

      const tB2 = makeB2Tab();
      tB2.betSlip.setDirectMultiple(3);
      await tB2.betSlip.flush();

      b2Board[1].pools.HAD.canAllUp = false;
      await tA2.syncOfficialMatches();
      await tA2.betSlip.flush();
      assert.ok(tA2.betSlip.getState().pendingRevokedPlanConfirm);
      assert.ok(tB2.betSlip.getState().pendingRevokedPlanConfirm);

      // Only Tab A confirms its 2x (¥8) draft; Tab B (3x = ¥12) runs passive sync & budget edit -> Tab B stays held and reload keeps ¥8!
      tA2.betSlip.revertToManualDraft();
      await tA2.betSlip.flush();
      assert.equal(
        tA2.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );
      await tB2.syncOfficialMatches();
      tB2.betSlip.setBudget(50);
      await tB2.betSlip.flush();
      assert.ok(tB2.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(
        tB2.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      const tA2Reload = makeB2Tab();
      await tA2Reload.betSlip.flush();
      assert.equal(
        tA2Reload.betSlip.getState().workspace.effectiveReport.totalCost,
        8,
        "Reload after confirming 2x (¥8) in Tab A must seal ¥8, never Tab B's unconfirmed 3x (¥12)"
      );

      // R8-B3: Zero-capacity eviction while Tab B is already open puts Tab B into hold AND re-persists hold when capacity returns!
      const b3Mem = new Map<string, string>();
      let b3Limit = Infinity;
      const b3Store = {
        getItem: (k: string) => b3Mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (k.length + v.length > b3Limit) {
            throw new DOMException(
              "Storage quota reached",
              "QuotaExceededError"
            );
          }
          b3Mem.set(k, v);
        },
        removeItem: (k: string) => {
          b3Mem.delete(k);
        },
      };
      const b3Board = structuredClone(
        officialFixtureMatches.slice(0, 3)
      ) as MatchItem[];
      const makeB3Tab = () => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: b3Store,
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? b3Board),
            syncMatches: async (wp) => ({
              matches: structuredClone(b3Board),
              syncNote: "实盘",
              workspace: evaluateQuantWorkspace(wp, b3Board),
            }),
          },
        });
        wb.betSlip.applyAuthenticatedBundle({
          matches: structuredClone(b3Board),
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            b3Board
          ),
        });
        return wb;
      };
      const tA3 = makeB3Tab();
      tA3.betSlip.setDirectMultiple(2);
      tA3.betSlip.togglePick(b3Board[0], "HAD", "h");
      tA3.betSlip.togglePick(b3Board[0], "HAD", "d");
      tA3.betSlip.togglePick(b3Board[1], "HAD", "h");
      tA3.betSlip.setBudget(20);
      await tA3.betSlip.flush();
      assert.equal(
        tA3.betSlip.applyArchetype(
          tA3.betSlip
            .getState()
            .workspace.portfolioPlans.find((p) => p.available !== false)!
        ),
        true
      );
      await tA3.betSlip.flush();
      tA3.betSlip.togglePick(b3Board[1], "HAD", "h");
      tA3.betSlip.togglePick(b3Board[2], "HAD", "h");
      await tA3.betSlip.flush();

      const tB3 = makeB3Tab();
      await tB3.betSlip.flush();
      assert.equal(
        tB3.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );

      b3Limit = 0;
      b3Board[1].pools.HAD.canAllUp = false;
      await tA3.syncOfficialMatches();
      await tA3.betSlip.flush();
      assert.equal(b3Mem.get("yj_manual_draft_v1:default") ?? null, null);
      assert.ok(tB3.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(tB3.betSlip.formatShopkeeperWeChatSlip(), "");
      assert.equal(tB3.betSlip.buildSealedLedgerDraft(), null);

      b3Limit = Infinity;
      tB3.betSlip.setBudget(48);
      await tB3.betSlip.flush();
      const tA3Reopen = makeB3Tab();
      await tA3Reopen.betSlip.flush();
      assert.ok(tA3Reopen.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(tA3Reopen.betSlip.buildSealedLedgerDraft(), null);

      // R8-B4: Minimal compact draft preserves ordered team/teamId identity and drops leg when home/away swap under same matchId!
      const b4Mem = new Map<string, string>();
      let b4Quota = Infinity;
      const b4Store = {
        getItem: (k: string) => b4Mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (v.length > b4Quota) {
            throw new DOMException("No room", "QuotaExceededError");
          }
          b4Mem.set(k, v);
        },
        removeItem: (k: string) => {
          b4Mem.delete(k);
        },
      };
      const b4Board = structuredClone(
        officialFixtureMatches.slice(0, 2)
      ) as MatchItem[];
      b4Board[0].homeTeamId = "1001";
      b4Board[0].awayTeamId = "1002";
      const cB4 = createBetSlipController({
        debounceMs: 0,
        storagePort: b4Store,
        computeWorkspace: evaluateQuantWorkspace,
      });
      cB4.applyAuthenticatedBundle({
        matches: structuredClone(b4Board),
        boardMeta: liveBoard(1),
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          b4Board
        ),
      });
      cB4.togglePick(b4Board[0], "HAD", "h");
      cB4.togglePick(b4Board[1], "HAD", "h");
      cB4.setDirectMultiple(2);
      await cB4.flush();
      const bareLen = JSON.stringify({
        schemaVersion: 1,
        picks: b4Board.map((m) => ({
          matchId: m.id,
          poolCode: "HAD",
          optionKey: "h",
        })),
        multiple: 3,
        passSpec: { mode: "follow-max-parlay" },
      }).length;
      b4Quota = bareLen + 7;
      cB4.setDirectMultiple(3);
      await cB4.flush();
      const savedB4 = JSON.parse(b4Mem.get("yj_manual_draft_v1:default")!);
      assert.equal(savedB4.multiple, 3);
      assert.ok(
        savedB4.picks[0].th,
        "Minimal tier must store ordered team hash"
      );

      // Swap home & away on b4Board[0] under the SAME matchId -> reopened controller MUST drop b4Board[0]!
      const swappedBoard = structuredClone(b4Board);
      [swappedBoard[0].home, swappedBoard[0].away] = [
        swappedBoard[0].away,
        swappedBoard[0].home,
      ];
      [swappedBoard[0].homeTeamId, swappedBoard[0].awayTeamId] = [
        swappedBoard[0].awayTeamId,
        swappedBoard[0].homeTeamId,
      ];
      const cB4Reopen = createBetSlipController({
        debounceMs: 0,
        storagePort: b4Store,
        computeWorkspace: evaluateQuantWorkspace,
      });
      cB4Reopen.applyAuthenticatedBundle({
        matches: swappedBoard,
        boardMeta: liveBoard(2),
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          swappedBoard
        ),
      });
      await cB4Reopen.flush();
      assert.equal(
        cB4Reopen
          .getState()
          .picks.some((p) => p.matchId === swappedBoard[0].id),
        false,
        "Minimal compact draft must reject swapped home/away under same matchId"
      );
      assert.deepEqual(
        cB4Reopen.getState().picks.map((p) => [p.matchId, p.home]),
        [[b4Board[1].id, b4Board[1].home]]
      );
    }

    // 11. R9-B1..B3 P0: Independent-plan / sleeping-tab write guard, monotonic clearSeq across sequential confirms, and syntheticSingleMode='off' bridge confirm
    {
      // R9-B1a & R9-B1b: Sleeping Tab B (3x) waking after A revokes & confirms 2x enters hold & cannot overwrite ¥8; Tab C with valid bonus plan syncing cannot overwrite ¥8!
      const r9Mem = new Map<string, string>();
      const mkIsolatedStore = () => ({
        getItem: (k: string) => r9Mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          r9Mem.set(k, v);
        },
        removeItem: (k: string) => {
          r9Mem.delete(k);
        },
      });
      const r9Board = structuredClone(
        officialFixtureMatches.slice(0, 3)
      ) as MatchItem[];
      const makeR9Tab = (deferGate?: { wait: () => Promise<void> }) => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: mkIsolatedStore(),
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? r9Board),
            syncMatches: async (wp) => {
              if (deferGate) await deferGate.wait();
              return {
                matches: structuredClone(r9Board),
                syncNote: "实盘",
                workspace: evaluateQuantWorkspace(wp, r9Board),
              };
            },
          },
        });
        wb.betSlip.applyAuthenticatedBundle({
          matches: structuredClone(r9Board),
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            r9Board
          ),
        });
        return wb;
      };

      let releaseA: (() => void) | null = null;
      const aGate = {
        wait: () =>
          releaseA
            ? new Promise<void>((res) => {
                const prev = releaseA!;
                releaseA = () => {
                  prev();
                  res();
                };
              })
            : Promise.resolve(),
      };
      // Sleeping Tab B (3x manual) + Tab C (3x with independent equal bonus plan)
      const tabSleepB = makeR9Tab();
      tabSleepB.betSlip.setDirectMultiple(3);
      tabSleepB.betSlip.togglePick(r9Board[0], "HAD", "h");
      tabSleepB.betSlip.togglePick(r9Board[0], "HAD", "d");
      tabSleepB.betSlip.togglePick(r9Board[2], "HAD", "h");
      await tabSleepB.betSlip.flush();
      const tabBonusC = makeR9Tab();
      await tabBonusC.betSlip.flush();
      assert.equal(tabBonusC.betSlip.applyBonusOptimization("equal").ok, true);
      await tabBonusC.betSlip.flush();

      // Tab A locks an archetype on [001, 002], then shifts its manual draft to [001, 003] at 2x
      const tabA9 = makeR9Tab(aGate);
      tabA9.betSlip.setDirectMultiple(2);
      tabA9.betSlip.togglePick(r9Board[2], "HAD", "h");
      tabA9.betSlip.togglePick(r9Board[1], "HAD", "h");
      tabA9.betSlip.setBudget(20);
      await tabA9.betSlip.flush();
      assert.equal(
        tabA9.betSlip.applyArchetype(
          tabA9.betSlip
            .getState()
            .workspace.portfolioPlans.find((p) => p.available !== false)!
        ),
        true
      );
      await tabA9.betSlip.flush();
      tabA9.betSlip.togglePick(r9Board[1], "HAD", "h");
      tabA9.betSlip.togglePick(r9Board[2], "HAD", "h");
      await tabA9.betSlip.flush();

      // Revoke r9Board[1] AND immediately confirm 2x (¥8) in Tab A BEFORE tabSleepB or tabBonusC wake up!
      r9Board[1].pools.HAD.canAllUp = false;
      await tabA9.syncOfficialMatches();
      await tabA9.betSlip.flush();
      assert.ok(tabA9.betSlip.getState().pendingRevokedPlanConfirm);
      tabA9.betSlip.revertToManualDraft();
      await tabA9.betSlip.flush();
      assert.equal(
        tabA9.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );

      // Wake tabSleepB -> MUST enter hold (null seal) and setBudget(48) MUST NOT overwrite ¥8!
      assert.ok(tabSleepB.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(tabSleepB.betSlip.buildSealedLedgerDraft(), null);
      tabSleepB.betSlip.setBudget(48);
      await tabSleepB.betSlip.flush();

      // Sync tabBonusC -> keeps its own ¥12 bonus plan locally, MUST NOT overwrite Tab A's confirmed ¥8 in storage!
      await tabBonusC.syncOfficialMatches();
      await tabBonusC.betSlip.flush();
      assert.equal(
        tabBonusC.betSlip.getState().workspace.effectiveReport.totalCost,
        12
      );
      const reloadAfterR9B1 = makeR9Tab();
      await reloadAfterR9B1.betSlip.flush();
      assert.equal(
        reloadAfterR9B1.betSlip.getState().workspace.effectiveReport.totalCost,
        8,
        "Confirmed ¥8 must survive both sleeping-tab budget edit and independent-plan sync"
      );

      // R9-B2: Tab A starts deferred sync at clearSeq=1 (¥8), then Tab B explicitly confirms 3x (¥12, clearSeq=2) -> late A reply MUST NOT revert ¥12 to ¥8!
      releaseA = () => {};
      const delayedSyncA = tabA9.syncOfficialMatches();
      tabSleepB.betSlip.revertToManualDraft();
      await tabSleepB.betSlip.flush();
      assert.equal(
        tabSleepB.betSlip.getState().workspace.effectiveReport.totalCost,
        12
      );
      const goA = releaseA;
      releaseA = null;
      goA();
      await delayedSyncA;
      await tabA9.betSlip.flush();
      const reloadAfterR9B2 = makeR9Tab();
      await reloadAfterR9B2.betSlip.flush();
      assert.equal(
        reloadAfterR9B2.betSlip.getState().workspace.effectiveReport.totalCost,
        12,
        "Later explicit 3x (¥12) confirmation must survive earlier tab's delayed sync"
      );

      // R9-B3: Tab B chooses to wait for a bridge. Tab A needs explicit consent to its ¥10 synthetic ticket.
      const b3OffMem = new Map<string, string>();
      const b3OffStore = {
        getItem: (k: string) => b3OffMem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          b3OffMem.set(k, v);
        },
        removeItem: (k: string) => {
          b3OffMem.delete(k);
        },
      };
      const offBoard = structuredClone(
        officialFixtureMatches.slice(0, 2)
      ) as MatchItem[];
      offBoard[0].pools.HAD.single = false;
      offBoard[0].pools.HAD.canSingle = false;
      offBoard[0].pools.HAFU.single = true;
      offBoard[0].pools.HAFU.canSingle = true;
      let offBoardRevision = 1;
      const makeOffTab = () => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: b3OffStore,
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? offBoard),
            syncMatches: async (wp) => ({
              matches: structuredClone(offBoard),
              boardMeta: liveBoard(++offBoardRevision),
              syncNote: "实盘",
              workspace: evaluateQuantWorkspace(wp, offBoard),
            }),
          },
        });
        wb.betSlip.applyAuthenticatedBundle({
          matches: structuredClone(offBoard),
          boardMeta: liveBoard(offBoardRevision),
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            offBoard
          ),
        });
        return wb;
      };
      const offTabA = makeOffTab();
      offTabA.betSlip.setDirectMultiple(1);
      offTabA.betSlip.togglePick(offBoard[0], "HAD", "h");
      offTabA.betSlip.togglePick(offBoard[1], "HAD", "h");
      offTabA.betSlip.setBudget(20);
      await offTabA.betSlip.flush();
      assert.equal(
        offTabA.betSlip.applyArchetype(
          offTabA.betSlip
            .getState()
            .workspace.portfolioPlans.find((p) => p.available !== false)!
        ),
        true
      );
      await offTabA.betSlip.flush();
      offTabA.betSlip.togglePick(offBoard[1], "HAD", "h");
      await offTabA.betSlip.flush();

      const offTabB = makeOffTab();
      await offTabB.betSlip.flush();
      assert.equal(
        offTabB.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.equal(
        offTabB.betSlip.getState().pendingSyntheticChoice?.quote?.cost,
        10
      );
      assert.equal(offTabB.betSlip.buildSealedLedgerDraft(), null);
      offTabB.betSlip.setSyntheticSingleMode("off");
      await offTabB.betSlip.flush();
      assert.equal(
        offTabB.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );

      offBoard[1].pools.HAD.canAllUp = false;
      await offTabA.syncOfficialMatches();
      await offTabA.betSlip.flush();
      assert.ok(offTabA.betSlip.getState().pendingRevokedPlanConfirm);
      assert.ok(offTabB.betSlip.getState().pendingRevokedPlanConfirm);

      // Confirm ONLY on offTabB (¥0 awaiting-bridge) -> offTabA (full-3way) MUST stay held, and reload MUST stay ¥0 (mode='off')!
      offTabB.betSlip.revertToManualDraft();
      await offTabB.betSlip.flush();
      assert.equal(
        offTabB.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.ok(
        offTabA.betSlip.getState().pendingRevokedPlanConfirm,
        "Confirming ¥0 bridge-waiting on Tab B must NOT release ¥10 synthetic single on Tab A"
      );
      assert.equal(offTabA.betSlip.buildSealedLedgerDraft(), null);

      const offReloaded = makeOffTab();
      await offReloaded.betSlip.flush();
      assert.equal(offReloaded.betSlip.getState().syntheticSingleMode, "off");
      assert.equal(
        offReloaded.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.equal(offReloaded.betSlip.buildSealedLedgerDraft(), null);

      // Returning to manual exposes the current ticket. Its displayed ¥10 quote authorizes the purchase.
      offTabA.betSlip.revertToManualDraft();
      await offTabA.betSlip.flush();
      await confirmDisplayedSyntheticTicket(offTabA.betSlip, 10);
      const autoReloaded = makeOffTab();
      await autoReloaded.betSlip.flush();
      assert.equal(
        autoReloaded.betSlip.getState().workspace.effectiveReport.totalCost,
        10
      );
    }

    // =========================================================================
    // 12. R10-B1 ~ R10-B4: Passive-Drop Storage Pruning, 1->2->1 Bridge Off
    //     Preservation, Held Filter-Trim & Re-login Hash Ownership, and R9 v1 Upgrade
    // =========================================================================
    {
      const r10Mem = new Map<string, string>();
      const r10Store = {
        getItem: (k: string) => r10Mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          r10Mem.set(k, v);
        },
        removeItem: (k: string) => {
          r10Mem.delete(k);
        },
      };
      let r10Board = structuredClone(
        officialFixtureMatches.slice(0, 3)
      ) as MatchItem[];
      r10Board[1].pools.HAD.single = true;
      r10Board[1].pools.HAD.canSingle = true;
      r10Board[1].pools.HHAD.single = true;
      r10Board[1].pools.HHAD.canSingle = true;
      r10Board[0].pools.HAD.single = false;
      r10Board[0].pools.HAD.canSingle = false;
      r10Board[0].pools.HAFU.single = true;
      r10Board[0].pools.HAFU.canSingle = true;

      let r10BoardRevision = 1;
      const makeR10Tab = () => {
        const wb = createWorkbenchController({
          debounceMs: 0,
          storagePort: r10Store,
          authPort: {
            bootstrap: async () => ({ authenticated: false }),
            login: async () => ({
              authenticated: true,
              user: {
                id: "default",
                username: "yjadmin",
                role: "admin",
              } as never,
              authToken: "tok",
              syncNote: "实盘",
              matches: structuredClone(r10Board),
              boardMeta: liveBoard(r10BoardRevision),
              initialPicks: [],
              workspace: evaluateQuantWorkspace(
                { picks: [], multiple: 1 } as never,
                r10Board
              ),
            }),
            logout: async () => {},
          },
          quantPort: {
            computeWorkspace: (params, ml) =>
              evaluateQuantWorkspace(params, ml ?? r10Board),
            syncMatches: async (wp) => ({
              matches: structuredClone(r10Board),
              boardMeta: liveBoard(++r10BoardRevision),
              syncNote: "实盘",
              workspace: evaluateQuantWorkspace(wp, r10Board),
            }),
          },
        });
        wb.applyLoginBundle({
          authenticated: true,
          user: { id: "default", username: "yjadmin", role: "admin" } as never,
          authToken: "tok",
          syncNote: "实盘",
          matches: structuredClone(r10Board),
          boardMeta: liveBoard(r10BoardRevision),
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 1 } as never,
            r10Board
          ),
        });
        return wb;
      };

      // R10-B1: GoalLine shift (-1 -> orig) prunes invalidated leg from storage so reload stays ¥4, NOT ¥8!
      const tB1 = makeR10Tab();
      tB1.betSlip.setDirectMultiple(2);
      tB1.betSlip.togglePick(r10Board[1], "HAD", "h");
      const origGl = r10Board[0].pools.HHAD.goalLine;
      tB1.betSlip.togglePick(r10Board[0], "HHAD", "hh");
      tB1.betSlip.togglePick(r10Board[0], "HHAD", "hd");
      await tB1.betSlip.flush();
      assert.equal(
        tB1.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );
      r10Board[0].pools.HHAD.goalLine = origGl === "-1" ? "+1" : "-1";
      r10Board[0].pools.HHAD.updateTime = "23:58:00";
      await tB1.syncOfficialMatches();
      await tB1.betSlip.flush();
      assert.equal(
        tB1.betSlip.getState().workspace.effectiveReport.totalCost,
        4
      );
      r10Board[0].pools.HHAD.goalLine = origGl;
      r10Board[0].pools.HHAD.updateTime = "23:59:00";
      await tB1.syncOfficialMatches();
      await tB1.betSlip.flush();
      const reloadB1 = makeR10Tab();
      await reloadB1.betSlip.flush();
      assert.equal(
        reloadB1.betSlip.getState().workspace.effectiveReport.totalCost,
        4,
        "R10-B1: Dropped handicap leg must NOT resurrect when goalLine returns"
      );

      // R10-B2: 1-match off (¥0) -> +bridge (2串1 ¥4) -> bridge delists -> reload MUST stay off (¥0)!
      r10Mem.clear();
      const fullR10Board = structuredClone(r10Board);
      const tB2 = makeR10Tab();
      tB2.betSlip.setDirectMultiple(2);
      tB2.betSlip.togglePick(r10Board[0], "HAD", "h");
      await tB2.betSlip.flush();
      tB2.betSlip.setSyntheticSingleMode("off");
      await tB2.betSlip.flush();
      assert.equal(
        tB2.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      tB2.betSlip.togglePick(r10Board[1], "HAD", "h");
      await tB2.betSlip.flush();
      assert.equal(
        tB2.betSlip.getState().workspace.effectiveReport.totalCost,
        4
      );
      const midReloadB2 = makeR10Tab();
      await midReloadB2.betSlip.flush();
      assert.equal(
        midReloadB2.betSlip.getState().workspace.effectiveReport.totalCost,
        4
      );
      r10Board = [r10Board[0], r10Board[2]];
      await midReloadB2.syncOfficialMatches();
      await midReloadB2.betSlip.flush();
      assert.equal(
        midReloadB2.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      const afterDropReloadB2 = makeR10Tab();
      await afterDropReloadB2.betSlip.flush();
      assert.equal(
        afterDropReloadB2.betSlip.getState().syntheticSingleMode,
        "off"
      );
      assert.equal(
        afterDropReloadB2.betSlip.getState().workspace.effectiveReport
          .totalCost,
        0,
        "R10-B2: Delisting bridge match must preserve syntheticSingleMode='off' across reloads"
      );
      assert.equal(afterDropReloadB2.betSlip.buildSealedLedgerDraft(), null);

      // R10-B3: Held Tab B switching setMode('mix') trims local picks ONLY and NEVER overwrites Tab A's confirmed ¥8 on re-login!
      r10Board = structuredClone(fullR10Board);
      r10Mem.clear();
      const tB3B = makeR10Tab();
      await tB3B.betSlip.flush();
      tB3B.betSlip.clearPicks();
      tB3B.betSlip.setMode("spf");
      tB3B.betSlip.setDirectMultiple(3);
      assert.equal(tB3B.betSlip.togglePick(r10Board[1], "HAD", "h").ok, true);
      assert.equal(tB3B.betSlip.togglePick(r10Board[1], "HHAD", "hh").ok, true);
      await tB3B.betSlip.flush();

      const tB3A = makeR10Tab();
      await tB3A.betSlip.flush();
      tB3A.betSlip.clearPicks();
      tB3A.betSlip.setDirectMultiple(2);
      tB3A.betSlip.togglePick(r10Board[0], "HAD", "h");
      tB3A.betSlip.togglePick(r10Board[0], "HAD", "d");
      tB3A.betSlip.togglePick(r10Board[1], "HAD", "h");
      tB3A.betSlip.setBudget(20);
      await tB3A.betSlip.flush();
      assert.equal(
        tB3A.betSlip.applyArchetype(
          tB3A.betSlip
            .getState()
            .workspace.portfolioPlans.find((p) => p.available !== false)!
        ),
        true
      );
      await tB3A.betSlip.flush();
      tB3A.betSlip.togglePick(r10Board[1], "HAD", "h");
      tB3A.betSlip.togglePick(r10Board[2], "HAD", "h");
      await tB3A.betSlip.flush();

      r10Board[1].pools.HAD.canAllUp = false;
      await tB3A.syncOfficialMatches();
      await tB3A.betSlip.flush();
      await tB3B.syncOfficialMatches();
      await tB3B.betSlip.flush();
      assert.ok(tB3A.betSlip.getState().pendingRevokedPlanConfirm);
      assert.ok(tB3B.betSlip.getState().pendingRevokedPlanConfirm);

      tB3A.betSlip.revertToManualDraft();
      await tB3A.betSlip.flush();
      assert.equal(
        tB3A.betSlip.getState().workspace.effectiveReport.totalCost,
        8
      );
      assert.equal(tB3B.betSlip.setMode("mix").trimmed, true);
      await tB3B.betSlip.flush();
      assert.ok(tB3B.betSlip.getState().pendingRevokedPlanConfirm);
      assert.equal(tB3B.betSlip.buildSealedLedgerDraft(), null);

      await tB3A.logout();
      await tB3A.login("yjadmin", "pw");
      await tB3A.betSlip.flush();
      assert.equal(
        tB3A.betSlip.getState().workspace.effectiveReport.totalCost,
        8,
        "R10-B3: Same-page re-login on Tab A must keep confirmed ¥8, NOT held Tab B's trimmed ¥6"
      );

      // R10-B4: Legacy schemaVersion=1 non-single 1-match draft without `so` MUST enter hold on upgrade!
      const r9LegacyMem = new Map<string, string>([
        [
          "yj_manual_draft_v1:default",
          JSON.stringify({
            schemaVersion: 1,
            picks: [
              {
                matchId: r10Board[0].id,
                home: r10Board[0].home,
                away: r10Board[0].away,
                poolCode: "HAD",
                optionKey: "h",
              },
            ],
            multiple: 2,
            passSpec: { mode: "follow-max-parlay" },
            holdRev: 1,
            holdClearedRev: 1,
          }),
        ],
      ]);
      const legacyWb = createWorkbenchController({
        debounceMs: 0,
        storagePort: {
          getItem: (k) => r9LegacyMem.get(k) ?? null,
          setItem: (k, v) => {
            r9LegacyMem.set(k, v);
          },
          removeItem: (k) => {
            r9LegacyMem.delete(k);
          },
        },
        quantPort: {
          computeWorkspace: (params, ml) =>
            evaluateQuantWorkspace(params, ml ?? r10Board),
          syncMatches: async (wp) => ({
            matches: structuredClone(r10Board),
            boardMeta: liveBoard(++r10BoardRevision),
            freshBoardForRequest: true,
            syncNote: "实盘",
            workspace: evaluateQuantWorkspace(wp, r10Board),
          }),
        },
      });
      legacyWb.applyLoginBundle({
        authenticated: true,
        user: { id: "default", username: "yjadmin", role: "admin" } as never,
        authToken: "tok",
        syncNote: "实盘",
        matches: structuredClone(r10Board),
        boardMeta: liveBoard(r10BoardRevision),
        initialPicks: [],
        workspace: evaluateQuantWorkspace(
          { picks: [], multiple: 1 } as never,
          r10Board
        ),
      });
      if (legacyWb.getState().syncing) {
        await new Promise<void>((resolve) => {
          const unsubscribe = legacyWb.subscribe(() => {
            if (legacyWb.getState().syncing) return;
            unsubscribe();
            resolve();
          });
        });
      }
      await legacyWb.betSlip.flush();
      assert.equal(legacyWb.betSlip.isDraftWaitingForBoard(), false);
      assert.equal(legacyWb.betSlip.getState().picks.length, 1);
      assert.ok(
        legacyWb.betSlip.getState().pendingRevokedPlanConfirm,
        "R10-B4: Ambiguous legacy schemaVersion=1 non-single draft must require confirmation on upgrade"
      );
      assert.equal(
        legacyWb.betSlip.getState().workspace.effectiveReport.totalCost,
        0
      );
      assert.equal(legacyWb.betSlip.buildSealedLedgerDraft(), null);

      // R11-B1~B7 + P1/P2: Compute-path refreshedMatches pruning & off preservation, stale-peer qa guard,
      // cleared-empty non-wildcard cs='empty', locked-plan draft separation, persisted lu=1, and ordered teamId live drop
      {
        const r11Mem = new Map<string, string>();
        let r11Cap = 100000;
        const r11Store = {
          getItem: (k: string) => r11Mem.get(k) ?? null,
          setItem: (k: string, v: string) => {
            if (v.length > r11Cap) throw new Error("QuotaExceededError");
            r11Mem.set(k, v);
          },
          removeItem: (k: string) => {
            r11Mem.delete(k);
          },
        };
        let r11Clock = 1_795_492_800_000;
        let r11Board = structuredClone(
          officialFixtureMatches.slice(0, 3)
        ) as MatchItem[];
        r11Board[0].homeTeamId = "101";
        r11Board[0].awayTeamId = "102";
        r11Board[1].homeTeamId = "201";
        r11Board[1].awayTeamId = "202";
        r11Board[1].pools.HAD.single = true;
        r11Board[1].pools.HAD.canSingle = true;
        r11Board[0].pools.HAD.single = false;
        r11Board[0].pools.HAD.canSingle = false;
        r11Board[0].pools.HAFU.single = true;
        r11Board[0].pools.HAFU.canSingle = true;

        const makeR11Tab = (
          customBoardFn?: () => { board: MatchItem[]; at: number }
        ) => {
          const wb = createWorkbenchController({
            debounceMs: 0,
            storagePort: r11Store,
            quantPort: {
              computeWorkspace: async (params) => {
                const snap = customBoardFn
                  ? customBoardFn()
                  : { board: structuredClone(r11Board), at: r11Clock };
                const ws = evaluateQuantWorkspace(params, snap.board);
                return {
                  ...ws,
                  refreshedMatches: structuredClone(snap.board),
                  boardMeta: {
                    source: "official-live",
                    boardState: "fresh",
                    isFallbackReadOnly: false,
                    lastValidBoardAt: snap.at,
                    lastValidBoardClock: "12:00",
                    bannerText: null,
                    quotedAt: snap.at,
                    syncedAt: snap.at,
                  },
                };
              },
              syncMatches: async (wp) => {
                const snap = customBoardFn
                  ? customBoardFn()
                  : { board: structuredClone(r11Board), at: r11Clock };
                return {
                  matches: structuredClone(snap.board),
                  syncNote: "实盘",
                  boardMeta: {
                    source: "official-live",
                    boardState: "fresh",
                    isFallbackReadOnly: false,
                    lastValidBoardAt: snap.at,
                    lastValidBoardClock: "12:00",
                    bannerText: null,
                    quotedAt: snap.at,
                    syncedAt: snap.at,
                  },
                  workspace: evaluateQuantWorkspace(wp, snap.board),
                };
              },
            },
          });
          wb.applyLoginBundle({
            authenticated: true,
            user: {
              id: "default",
              username: "yjadmin",
              role: "admin",
            } as never,
            authToken: "tok",
            syncNote: "实盘",
            matches: structuredClone(r11Board),
            initialPicks: [],
            boardMeta: {
              source: "official-live",
              boardState: "fresh",
              isFallbackReadOnly: false,
              lastValidBoardAt: r11Clock,
              lastValidBoardClock: "12:00",
              bannerText: null,
              quotedAt: r11Clock,
              syncedAt: r11Clock,
            },
            workspace: evaluateQuantWorkspace(
              { picks: [], multiple: 1 } as never,
              r11Board
            ),
          });
          return wb;
        };

        // R11-B1 + B2: Ordinary compute (setBudget) prunes stopped pick AND preserves syntheticSingleMode='off'!
        const tComp = makeR11Tab();
        tComp.betSlip.setDirectMultiple(2);
        tComp.betSlip.togglePick(r11Board[0], "HAD", "h");
        await tComp.betSlip.flush();
        tComp.betSlip.setSyntheticSingleMode("off");
        await tComp.betSlip.flush();
        tComp.betSlip.togglePick(r11Board[1], "HAD", "h");
        await tComp.betSlip.flush();
        assert.equal(
          tComp.betSlip.getState().workspace.effectiveReport.totalCost,
          4
        );
        const savedMatch1 = structuredClone(r11Board[1]);
        r11Board = [r11Board[0], r11Board[2]];
        r11Clock += 60_000;
        tComp.betSlip.setBudget(120);
        await tComp.betSlip.flush();
        assert.equal(tComp.betSlip.getState().syntheticSingleMode, "off");
        assert.equal(
          tComp.betSlip.getState().workspace.effectiveReport.totalCost,
          0,
          "R11-B2: Ordinary compute after bridge delist must preserve off mode (¥0)"
        );
        r11Board = [r11Board[0], savedMatch1, r11Board[1]];
        r11Clock += 60_000;
        await tComp.syncOfficialMatches();
        await tComp.betSlip.flush();
        const tCompReload = makeR11Tab();
        await tCompReload.betSlip.flush();
        assert.equal(
          tCompReload.betSlip.getState().picks.length,
          1,
          "R11-B1: Dropped bridge pick must NOT resurrect after ordinary-compute prune"
        );

        // R11-B3: Older board sync on peer tab MUST NOT prune newer pick saved at newer qa!
        const staleSnapBoard = structuredClone(r11Board);
        const staleAt = r11Clock - 30_000;
        r11Clock += 60_000;
        r11Board[0].pools.HHAD.goalLine = "-1";
        const tNew = makeR11Tab();
        await tNew.betSlip.flush();
        tNew.betSlip.clearPicks();
        tNew.betSlip.setDirectMultiple(2);
        tNew.betSlip.togglePick(r11Board[1], "HAD", "h");
        tNew.betSlip.togglePick(r11Board[0], "HHAD", "hh");
        await tNew.betSlip.flush();
        assert.equal(
          tNew.betSlip.getState().workspace.effectiveReport.totalCost,
          4
        );
        const tStalePeer = makeR11Tab(() => ({
          board: staleSnapBoard,
          at: staleAt,
        }));
        await tStalePeer.syncOfficialMatches();
        await tStalePeer.betSlip.flush();
        const tAfterStaleReload = makeR11Tab();
        await tAfterStaleReload.betSlip.flush();
        assert.equal(
          tAfterStaleReload.betSlip.getState().workspace.effectiveReport
            .totalCost,
          4,
          "R11-B3: Stale peer board must NOT prune newer -1 handicap pick"
        );

        // R11-B7: Ordered teamId swap on same matchId drops pick on LIVE page as well as reload!
        r11Mem.clear();
        const tIdSwap = makeR11Tab();
        tIdSwap.betSlip.setDirectMultiple(2);
        tIdSwap.betSlip.togglePick(r11Board[1], "HAD", "h");
        await tIdSwap.betSlip.flush();
        assert.equal(
          tIdSwap.betSlip.getState().workspace.effectiveReport.totalCost,
          4
        );
        [r11Board[1].homeTeamId, r11Board[1].awayTeamId] = [
          r11Board[1].awayTeamId,
          r11Board[1].homeTeamId,
        ];
        r11Clock += 60_000;
        await tIdSwap.syncOfficialMatches();
        await tIdSwap.betSlip.flush();
        assert.equal(
          tIdSwap.betSlip.getState().workspace.effectiveReport.totalCost,
          0,
          "R11-B7: Swapped team IDs under same matchId must drop live pick immediately"
        );
        assert.equal(tIdSwap.betSlip.buildSealedLedgerDraft(), null);
        void r11Cap;
      }
    }
  });
});
