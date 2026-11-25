import {
  freshOfficialBoard,
  withConfirmedSaleRights,
} from "./fixtures/officialSaleBoard.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  APP_GROUND_TRUTH_MANUAL_SPEC,
  LOCAL_CURATED_QA,
  createManualQaEngine,
} from "../server/manualQaEngine.mjs";
import { sealAuthoritativePrintSnapshot } from "../server/ledgerManager.mjs";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
} from "../server/quantEngine.mjs";
import {
  MANUAL_CHAPTER_SPECS,
  MANUAL_TOPICS,
  QUICK_QA_PILLS,
  extractSearchBigrams,
  matchManualTopics,
  resolveManualNavigation,
} from "../src/manual/manualCatalog.ts";
import type {
  MatchItem,
  QuantWorkspaceParams,
} from "../src/prototype/quantTypes.ts";
import type {
  LedgerEntry,
  LedgerMutatePayload,
  LedgerMutateResponse,
  PublicAccountUser,
  UserLedgerSnapshot,
} from "../src/security/secureClient.ts";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";
import { createWorkbenchController } from "../src/workspace/workbenchController.ts";

const REPO_ROOT = process.cwd();

describe("Spec #5 · Ticket #8: Client 1-RTT BetSlip Gates, Composed Headless Workbench & Data-Driven Manual", () => {
  it("Slice 1 (Manual Catalog Relocation & Data-Driven Slimming): relocates search catalog to src/manual/, aligns QUICK_QA_PILLS with ADR-0015 at 100% local-kb hit rate, and slims UserManualModal.tsx <= 350 lines", async () => {
    // 1. Catalog & search pure functions live in src/manual/manualCatalog.ts
    assert.equal(MANUAL_TOPICS.length, 8);
    assert.ok(extractSearchBigrams("一球小胜卡盘").includes("卡盘"));
    const matched = matchManualTopics("一球小胜卡盘");
    assert.ok(matched.some((t) => t.id === "glossary"));
    for (const adr0015Kw of [
      "意图保真",
      "3项无死角",
      "自动挂载",
      "顺滑切换",
      "一键撤销",
    ]) {
      const kwHits = matchManualTopics(adr0015Kw);
      assert.ok(
        kwHits.length > 0,
        `matchManualTopics("${adr0015Kw}") must return non-empty ADR-0015 manual topics`
      );
    }

    const nav = resolveManualNavigation(
      {
        activeSec: "qa",
        query: "不存在的词xyz",
        scrollSeq: 0,
        highlightSec: null,
      },
      { type: "jump", targetSec: "glossary" }
    );
    assert.equal(nav.activeSec, "glossary");
    assert.equal(nav.query, "");
    assert.equal(nav.highlightSec, "glossary");

    // 2. Zero stale mutex-block quick pills; ADR-0015 smooth pool switch + undo is represented
    assert.ok(QUICK_QA_PILLS.length >= 20);
    for (const pill of QUICK_QA_PILLS) {
      assert.equal(
        pill.includes("不能再点") || pill.includes("不能选让"),
        false,
        `Stale mutex-block pill must be retired: ${pill}`
      );
    }
    assert.ok(
      QUICK_QA_PILLS.some(
        (pill) => pill.includes("同一场比赛") && pill.includes("撤销")
      ),
      "QUICK_QA_PILLS must include ADR-0015 smooth same-match pool switch & undo question"
    );
    const synPill = QUICK_QA_PILLS.find((pill) =>
      pill.includes("3项无死角合成单关")
    );
    assert.ok(
      synPill,
      "QUICK_QA_PILLS must include a '3项无死角合成单关' pill"
    );
    const mutexTopic = LOCAL_CURATED_QA.find(
      (item: any) => item.id === "qa-same-match-mutex"
    );
    assert.equal(
      mutexTopic?.question,
      "同一场比赛选了「胜平负」后，再点「让球平」或其他玩法会怎样？"
    );
    assert.equal(
      APP_GROUND_TRUTH_MANUAL_SPEC.includes("不能再点「让球平」"),
      false
    );

    // 3. 100% of QUICK_QA_PILLS hit local-kb in 0ms without consuming AI quota
    const qaEngine = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => ({
          locked: false,
          strikeCount: 1,
          maxAllowed: 4,
        }),
        consumeAiQuota: () => {
          throw new Error("QUICK_QA_PILLS must NEVER consume AI quota");
        },
      },
      xiaogaoService: null,
      getApiKey: () => "",
    });

    for (const pill of QUICK_QA_PILLS) {
      const res = await qaEngine.answerManualQuestion({
        userId: "u-manual-check",
        question: pill,
        ip: "127.0.0.1",
      });
      assert.equal(res.ok, true, `Quick pill "${pill}" must return ok=true`);
      assert.equal(
        res.source,
        "local-kb",
        `Quick pill "${pill}" must hit local-kb in 0ms, got ${res.source}`
      );
      if (pill === synPill) {
        const synEntry = LOCAL_CURATED_QA.find(
          (x: any) => x.id === "qa-synthetic-single"
        );
        assert.equal(res.matchedTitle, synEntry?.question);
      }
    }
    const legacyMutexHit = await qaEngine.answerManualQuestion({
      userId: "u-manual-check",
      question: "为什么同一场比赛选了胜平负后，不能再点让球平？",
      ip: "127.0.0.1",
    });
    assert.equal(legacyMutexHit.source, "local-kb");
    assert.equal(
      legacyMutexHit.matchedTitle,
      "同一场比赛选了「胜平负」后，再点「让球平」或其他玩法会怎样？"
    );

    // 4. Structured 7 illustrated chapters cover all non-qa sections and preserve ADR-0015 & scientific honesty copy
    const expectedChapterIds = [
      "quickstart",
      "sandbox",
      "optimizer",
      "archetypes",
      "glossary",
      "hedge",
      "xiaogao",
    ] as const;
    for (const id of expectedChapterIds) {
      assert.ok(
        MANUAL_CHAPTER_SPECS[id],
        `Missing structured manual chapter spec for "${id}"`
      );
    }
    const serializedChapters = JSON.stringify(MANUAL_CHAPTER_SPECS);
    for (const token of [
      "3+1 精算配单",
      "旋转矩阵缩水",
      "独立分块容错串",
      "高抽水拖累腿",
      "101.0%",
      "最高校准单腿返还率",
      "胜胜 + 平胜 + 负胜",
      "2项省本搏常规",
      "过桥配菜",
      "智能合票减张",
    ]) {
      assert.ok(
        serializedChapters.includes(token),
        `Structured manual chapters must preserve "${token}"`
      );
    }

    // 5. UserManualModal.tsx is slimmed to <= 350 lines, and betSlipController.ts no longer embeds MANUAL_TOPICS array literal
    const modalLines = fs
      .readFileSync(
        path.join(REPO_ROOT, "src/manual/UserManualModal.tsx"),
        "utf8"
      )
      .split("\n").length;
    assert.ok(
      modalLines <= 350,
      `Expected UserManualModal.tsx <= 350 lines, got ${modalLines}`
    );

    const betCtrlSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/workspace/betSlipController.ts"),
      "utf8"
    );
    assert.equal(
      betCtrlSrc.includes("export const MANUAL_TOPICS: ManualTopic[] = ["),
      false,
      "betSlipController.ts must not inline the 327-line manual catalog"
    );
  });

  it("Slice 2 (1-RTT Objective Stance Sync & Dead Stub Removal): invokes computeWorkspace strictly once on non-objective stance & subjectiveDeltaPct updates while populating getStanceDeltaSummary, and removes dead isPoolMutexLocked", async () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const observedCalls: QuantWorkspaceParams[] = [];

    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: async (params, ms) => {
        observedCalls.push(params);
        return evaluateQuantWorkspace(params, ms);
      },
    });

    assert.equal(
      "isPoolMutexLocked" in ctrl,
      false,
      "Dead isPoolMutexLocked stub must be removed from BetSlipController"
    );

    ctrl.initializeMatches(
      matches,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, matches)
    );

    ctrl.togglePick(matches[0], "HAD", "h");
    await ctrl.flush();
    ctrl.togglePick(matches[1], "HAD", "h");
    await ctrl.flush();

    // 1. Switching to non-objective stance ("home-lean") + budget change triggers strictly 1-RTT
    observedCalls.length = 0;
    ctrl.setStance("home-lean");
    await ctrl.flush();
    assert.equal(
      observedCalls.length,
      1,
      `Expected strictly 1-RTT compute call on stance switch, got ${observedCalls.length}`
    );
    assert.equal(observedCalls[0].stance, "home-lean");

    const deltaHome = ctrl.getStanceDeltaSummary("max-ev-utility");
    assert.equal(deltaHome.stance, "home-lean");
    assert.equal(deltaHome.hasBaseline, true);
    assert.equal(ctrl.getState().objectivePortfolioPlans.length, 4);

    // 2. Updating budget while already in non-objective stance ("upset-watch") also stays 1-RTT and refreshes objective baseline
    observedCalls.length = 0;
    ctrl.setStance("upset-watch");
    await ctrl.flush();
    assert.equal(observedCalls.length, 1);

    observedCalls.length = 0;
    ctrl.setBudget(200);
    await ctrl.flush();
    assert.equal(
      observedCalls.length,
      1,
      `Expected strictly 1-RTT compute call when changing budget under 'upset-watch', got ${observedCalls.length}`
    );
    assert.ok(
      ctrl.getState().objectivePortfolioPlans.every((p) => p.totalCost <= 200)
    );

    // 3. Adjusting subjectiveDeltaPct (+8%) invokes computeWorkspace strictly once while keeping stance delta summary populated
    observedCalls.length = 0;
    ctrl.setSubjectiveDeltaPct(8);
    await ctrl.flush();
    assert.equal(observedCalls.length, 1);
    assert.equal(observedCalls[0].subjectiveDeltaPct, 8);
    const deltaUpset = ctrl.getStanceDeltaSummary("max-ev-utility");
    assert.equal(deltaUpset.stance, "upset-watch");
    assert.equal(deltaUpset.hasBaseline, true);
  });

  it("Slice 3 (Unified Derived Playability Gates & Lightweight Sealed Draft): computes synthetic single playability/blind-spot/2-way trim, >512 bonus cap, banker eligibility, breakevenTargetCost, and currentArch", async () => {
    const baseMatches = FALLBACK_MATCHES as MatchItem[];
    // m0 in FALLBACK_MATCHES has HAD.single=false, HHAD.single=false, HAFU.single=true, CRS.single=true
    const m0 = baseMatches[0];
    const m1 = baseMatches[1];
    const m2 = baseMatches[2];
    const m3 = baseMatches[3];

    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (params, ms) => evaluateQuantWorkspace(params, ms),
    });
    ctrl.initializeMatches(
      baseMatches,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, baseMatches)
    );

    // 1. 1-match non-single HAD:h -> playable 3-way HAFU synthetic (0% blind spot, canTrimSynthetic2Way = true)
    ctrl.togglePick(m0, "HAD", "h");
    await ctrl.flush();
    const gPlayableSyn = ctrl.getPlayabilityGates("max-ev-utility");
    assert.equal(gPlayableSyn.isSingleNonSingleContext, true);
    assert.equal(gPlayableSyn.isSyntheticPlayable, true);
    assert.equal(gPlayableSyn.hasSyntheticInherentBlindSpot, false);
    assert.equal(gPlayableSyn.canTrimSynthetic2Way, true);
    assert.ok(gPlayableSyn.currentArch !== null);

    // 2. 1-match non-single HHAD[-1]:hd (win by 1 goal) -> CRS synthetic with inherent catch-all blind spot
    ctrl.clearPicks();
    const hhadDrawOpt =
      m0.pools.HHAD.options.find((o) => o.key === "hd") ??
      m0.pools.HHAD.options[1];
    ctrl.togglePick(m0, "HHAD", hhadDrawOpt.key);
    await ctrl.flush();
    const gCrsBlindSpot = ctrl.getPlayabilityGates();
    assert.equal(gCrsBlindSpot.isSingleNonSingleContext, true);
    assert.equal(gCrsBlindSpot.hasSyntheticInherentBlindSpot, true);

    // 3. 1-match non-single with crushed HAFU odds (synEff <= 1.00) -> isSyntheticPlayable = false & canTrimSynthetic2Way = false
    const crushedMatch: MatchItem = {
      ...m0,
      id: "m-crushed-syn",
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: false },
        HAFU: {
          ...m0.pools.HAFU,
          single: true,
          options: m0.pools.HAFU.options.map((o) =>
            o.key === "hh" || o.key === "dh" || o.key === "ah"
              ? { ...o, odds: 2.4 }
              : o
          ),
        },
      },
    };
    const crushedList = [crushedMatch, m1, m2, m3];
    ctrl.initializeMatches(
      crushedList,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, crushedList)
    );
    ctrl.togglePick(crushedMatch, "HAD", "h");
    await ctrl.flush();
    const gUnplayableSyn = ctrl.getPlayabilityGates();
    assert.equal(gUnplayableSyn.isSingleNonSingleContext, true);
    assert.equal(gUnplayableSyn.isSyntheticPlayable, false);
    assert.equal(gUnplayableSyn.canTrimSynthetic2Way, false);

    // 4. >512 bonus optimization line cap (e.g. 4 matches * 4 TTG picks = 256, 5 matches * 4 TTG picks = 1,024 > 512)
    ctrl.initializeMatches(
      baseMatches,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 1 }, baseMatches)
    );
    for (const m of baseMatches.slice(0, 5)) {
      for (const opt of m.pools.TTG.options.slice(0, 4)) {
        ctrl.togglePick(m, "TTG", opt.key);
      }
    }
    await ctrl.flush();
    const gOver512 = ctrl.getPlayabilityGates();
    assert.ok(
      gOver512.manualBonusLineCount > 512,
      `Expected >512 lines, got ${gOver512.manualBonusLineCount}`
    );
    assert.equal(gOver512.isBonusOver512, true);
    assert.equal(gOver512.isBonusOptDisabled, true);

    // 5. Banker eligibility across M=2 vs M=3 free parlay (bankerCount < minK - 1) + breakevenTargetCost + sealed draft
    ctrl.clearPicks();
    ctrl.togglePick(m0, "HAD", "h");
    ctrl.togglePick(m1, "HAD", "h");
    await ctrl.flush();
    const gTwoMatch = ctrl.getPlayabilityGates();
    assert.equal(gTwoMatch.canToggleBanker, false);
    assert.equal(gTwoMatch.canToggleBankerMatch(m0.id), false);

    ctrl.togglePick(m2, "HAD", "h");
    ctrl.togglePick(m2, "HAD", "d");
    await ctrl.flush();
    const gThreeMatch = ctrl.getPlayabilityGates();
    assert.equal(gThreeMatch.canToggleBanker, true);
    assert.equal(gThreeMatch.canToggleBankerMatch(m0.id), true);
    assert.equal(gThreeMatch.canToggleBankerMatch(m1.id), true);
    assert.equal(gThreeMatch.canToggleBankerMatch("non-existent-id"), false);

    // Toggle m0 as banker on 3 matches -> auto-locks 2串1 (minK = 2, maxBankers = minK - 1 = 1)
    assert.equal(ctrl.toggleBankerMatch(m0.id).ok, true);
    await ctrl.flush();
    const gAfterOneBanker = ctrl.getPlayabilityGates();
    assert.equal(gAfterOneBanker.activeBankerSet.has(m0.id), true);
    assert.equal(
      gAfterOneBanker.canToggleBankerMatch(m0.id),
      true,
      "Existing banker must remain toggleable so user can unpin it"
    );
    assert.equal(
      gAfterOneBanker.canToggleBankerMatch(m1.id),
      false,
      "2nd banker must be gated when bankerCount === minK - 1 (1 === 2 - 1)"
    );

    const sealed = ctrl.buildSealedLedgerDraft();
    assert.ok(sealed);
    assert.ok(sealed.workspaceParams);
    assert.equal(sealed.snapshot, undefined);
    assert.deepEqual(sealed.workspaceParams.passSpec?.bankerMatchIds, [m0.id]);
    const serverSealed = sealAuthoritativePrintSnapshot({
      workspaceParams: sealed.workspaceParams,
      authoritativeMatches: FALLBACK_MATCHES,
    });
    assert.equal(
      serverSealed.snapshot?.matches.find((x: any) => x.matchId === m0.id)
        ?.isBanker,
      true
    );
  });

  it("Slice 4 (Composed Headless Workbench · Dual-Track Ledger, Stop-Loss Guardrail, 5s Soft Undo & 45s Auto-Settle Throttle): manages full ledger lifecycle in memory with zero DOM", async () => {
    const matches = withConfirmedSaleRights(FALLBACK_MATCHES as MatchItem[]);
    let nowMs = Date.parse("2026-11-21T20:00:00+08:00");
    let nextTimerId = 1;
    const timers = new Map<number, { dueAt: number; fn: () => void }>();

    const clockPort = {
      now: () => nowMs,
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextTimerId++;
        timers.set(id, { dueAt: nowMs + ms, fn });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        timers.delete(handle as number);
      },
    };
    const advanceClock = (deltaMs: number) => {
      nowMs += deltaMs;
      for (const [id, item] of Array.from(timers.entries())) {
        if (item.dueAt <= nowMs) {
          timers.delete(id);
          item.fn();
        }
      }
    };

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

    const demoUser: PublicAccountUser = {
      id: "u-wb-1",
      username: "member01",
      note: "测试成员",
      role: "member",
      status: "active",
      lockedReason: null,
      createdAt: nowMs - 86400_000,
      durationHours: 720,
      firstLoginAt: nowMs - 3600_000,
      expiresAt: nowMs + 700 * 3600_000,
      remainingMs: 700 * 3600_000,
      maxDevices: 2,
      boundDevicesCount: 1,
      boundDevices: [],
      aiEnabled: true,
      dailyAiLimit: 20,
      aiUsedToday: 3,
      violationCount: 0,
      failedLoginCount: 0,
      loginLockedUntil: null,
    };

    // Deterministic in-memory dual-track ledger adapter
    let dailyLimit = 100;
    let lockedLoss = 0;
    let entries: LedgerEntry[] = [];
    let undoStash: {
      token: string;
      items: LedgerEntry[];
      lockedDelta: number;
    } | null = null;
    const ledgerCalls: LedgerMutatePayload[] = [];

    const buildSnapshot = (): UserLedgerSnapshot => {
      const liveSpent =
        entries
          .filter((e) => e.kind === "live")
          .reduce((s, e) => s + e.cost, 0) + lockedLoss;
      const liveSettled = entries.filter(
        (e) => e.kind === "live" && e.status !== "pending"
      );
      const liveWon = liveSettled.filter((e) => e.status === "won");
      const liveNetProfit = liveSettled.reduce((s, e) => s + e.netProfit, 0);
      const paperSettled = entries.filter(
        (e) => e.kind === "paper" && e.status !== "pending"
      );
      const paperLost = paperSettled.filter((e) => e.status === "lost");
      return {
        dailyLimit,
        usageDate: "2026-11-21",
        dailyLiveSpent: liveSpent,
        dailyLockedLossSpent: lockedLoss,
        dailyRemaining: Math.max(0, dailyLimit - liveSpent),
        entries: [...entries],
        stats: {
          liveSettledCount: liveSettled.length,
          liveWonCount: liveWon.length,
          liveWinRatePct:
            liveSettled.length > 0
              ? (liveWon.length / liveSettled.length) * 100
              : 0,
          liveTotalStaked: liveSettled.reduce((s, e) => s + e.cost, 0),
          liveNetProfit,
          liveRoiPct: 0,
          paperCount: entries.filter((e) => e.kind === "paper").length,
          paperLostCount: paperLost.length,
          paperWonCount: paperSettled.filter((e) => e.status === "won").length,
          paperSavedAmount: paperLost.reduce((s, e) => s + e.paperRefCost, 0),
        },
      };
    };

    const ledgerPort = {
      mutate: async (
        payload: LedgerMutatePayload
      ): Promise<LedgerMutateResponse> => {
        ledgerCalls.push(payload);
        if (payload.action === "set-daily-limit") {
          dailyLimit = payload.dailyLimit;
          return { ok: true, ledger: buildSnapshot() };
        }
        if (payload.action === "add-entry") {
          const cur = buildSnapshot();
          if (
            payload.kind === "live" &&
            !payload.forceConfirmed &&
            payload.cost > cur.dailyRemaining
          ) {
            return {
              ok: false,
              code: "STOP_LOSS_EXCEEDED",
              dailyLimit,
              dailyRemaining: cur.dailyRemaining,
              overBy: payload.cost - cur.dailyRemaining,
              ledger: cur,
            };
          }
          const entry: LedgerEntry = {
            id: `e_${entries.length + 1}_${nowMs}`,
            kind: payload.kind,
            title: payload.title,
            modeLabel: payload.modeLabel,
            betCount: payload.betCount,
            cost: payload.kind === "live" ? payload.cost : 0,
            paperRefCost: payload.paperRefCost ?? payload.cost,
            minPayout: payload.minPayout,
            maxPayout: payload.maxPayout,
            status: "pending",
            settledReturn: 0,
            netProfit: 0,
            snapshot: payload.snapshot,
            createdAt: nowMs,
            settledAt: null,
          };
          entries = [entry, ...entries];
          return { ok: true, entry, ledger: buildSnapshot() };
        }
        if (payload.action === "settle-entry") {
          let updated: LedgerEntry | undefined;
          entries = entries.map((e) => {
            if (e.id !== payload.entryId) return e;
            const ret =
              payload.status === "won"
                ? (payload.settledReturn ?? e.minPayout)
                : 0;
            updated = {
              ...e,
              status: payload.status,
              settledReturn: ret,
              netProfit: e.kind === "live" ? ret - e.cost : 0,
              manualOverride: payload.status !== "pending",
              settledAt: payload.status === "pending" ? null : nowMs,
            };
            return updated;
          });
          return { ok: true, entry: updated, ledger: buildSnapshot() };
        }
        if (payload.action === "delete-entry") {
          const target = entries.find((e) => e.id === payload.entryId);
          entries = entries.filter((e) => e.id !== payload.entryId);
          let lockedDelta = 0;
          if (
            target &&
            target.kind === "live" &&
            target.status !== "pending" &&
            target.netProfit < 0
          ) {
            lockedDelta = target.cost;
            lockedLoss += lockedDelta;
          }
          const token = `undo_${nowMs}`;
          undoStash = target ? { token, items: [target], lockedDelta } : null;
          return {
            ok: true,
            deletedId: payload.entryId,
            undoToken: token,
            lockedStopLossStake: lockedDelta,
            ledger: buildSnapshot(),
          };
        }
        if (payload.action === "restore-entry") {
          if (undoStash && undoStash.token === payload.undoToken) {
            entries = [...undoStash.items, ...entries];
            lockedLoss = Math.max(0, lockedLoss - undoStash.lockedDelta);
            const count = undoStash.items.length;
            undoStash = null;
            return { ok: true, restoredCount: count, ledger: buildSnapshot() };
          }
          throw new Error("撤销窗口已过期");
        }
        if (payload.action === "clear-settled-paper") {
          const settledPapers = entries.filter(
            (e) => e.kind === "paper" && e.status !== "pending"
          );
          entries = entries.filter(
            (e) => !(e.kind === "paper" && e.status !== "pending")
          );
          const token = `undo_paper_${nowMs}`;
          undoStash = { token, items: settledPapers, lockedDelta: 0 };
          return {
            ok: true,
            clearedCount: settledPapers.length,
            undoToken: settledPapers.length > 0 ? token : undefined,
            ledger: buildSnapshot(),
          };
        }
        // auto-settle
        return { ok: true, newlySettledCount: 1, ledger: buildSnapshot() };
      },
    };

    const wb = createWorkbenchController({
      debounceMs: 0,
      autoSyncRadar: true,
      clockPort,
      storagePort,
      quantPort: {
        computeWorkspace: (params, ms) => ({
          ...evaluateQuantWorkspace(params, ms),
          boardMeta: freshOfficialBoard,
        }),
      },
      ledgerPort,
      authPort: {
        bootstrap: async () => ({
          authenticated: true,
          user: demoUser,
          authToken: "tok_demo_1",
          matches,
          syncNote: "已同步官网在售赛事",
          boardMeta: freshOfficialBoard,
          initialPicks: [],
          workspace: evaluateQuantWorkspace(
            { picks: [], multiple: 5 },
            matches
          ),
          ledger: buildSnapshot(),
        }),
      },
    });

    await wb.bootstrapHandshake();
    wb.betSlip.togglePick(matches[0], "HAD", "h");
    wb.betSlip.togglePick(matches[1], "HAD", "h");
    wb.betSlip.setDirectMultiple(30); // 1 bet * 2 yuan * 30 = ¥60
    await wb.betSlip.flush();

    // 1. Record ¥60 live ticket (within ¥100 daily limit -> remaining ¥40)
    const liveRes1 = await wb.recordToLedger("live");
    assert.equal(liveRes1.ok, true);
    assert.equal(wb.getState().ledger.dailyRemaining, 40);
    assert.equal(wb.getState().liveEntriesCount, 1);
    assert.equal(wb.getState().paperEntriesCount, 0);
    assert.equal(wb.getState().pendingEntriesCount, 1);

    // 2. Record another ¥60 live ticket -> exceeds remaining ¥40 by ¥20 -> populates stopLossPrompt!
    const liveRes2 = await wb.recordToLedger("live");
    assert.equal(liveRes2.ok, false);
    const prompt = wb.getState().stopLossPrompt;
    assert.ok(prompt, "Expected stopLossPrompt when exceeding dailyRemaining");
    assert.equal(prompt.dailyLimit, 100);
    assert.equal(prompt.dailyRemaining, 40);
    assert.equal(prompt.overBy, 20);
    assert.equal(prompt.draft.cost, 60);

    // 1-click convert intercepted slip to 0-cost paper ticket
    const convRes = await wb.confirmConvertStopLossToPaper();
    assert.equal(convRes.ok, true);
    assert.equal(wb.getState().stopLossPrompt, null);
    assert.equal(wb.getState().liveEntriesCount, 1);
    assert.equal(wb.getState().paperEntriesCount, 1);
    assert.equal(wb.getState().pendingEntriesCount, 2);

    // Verify 4-state ledgerFilter ("all" | "live" | "paper" | "pending")
    wb.setLedgerFilter("live");
    assert.equal(wb.getState().filteredLedgerEntries.length, 1);
    assert.equal(wb.getState().filteredLedgerEntries[0].kind, "live");
    wb.setLedgerFilter("paper");
    assert.equal(wb.getState().filteredLedgerEntries.length, 1);
    assert.equal(wb.getState().filteredLedgerEntries[0].kind, "paper");

    // Settle paper entry as lost -> settledPaperCount becomes 1, pendingEntriesCount becomes 1
    const paperEntryId = wb.getState().filteredLedgerEntries[0].id;
    await wb.settleEntryManual(paperEntryId, "lost");
    assert.equal(wb.getState().settledPaperCount, 1);
    assert.equal(wb.getState().pendingEntriesCount, 1);

    // 3. Delete live entry -> populates 5s undoBanner -> undo before 5s restores -> delete again & advance 5,000ms expires banner
    const liveEntryId = wb
      .getState()
      .ledger.entries.find((e) => e.kind === "live")!.id;
    await wb.deleteEntry(liveEntryId);
    assert.equal(wb.getState().liveEntriesCount, 0);
    assert.ok(wb.getState().undoBanner !== null);

    advanceClock(3_000);
    assert.ok(
      wb.getState().undoBanner !== null,
      "Undo banner must still be active at 3s"
    );
    const undoRes = await wb.undoDeleteEntry();
    assert.equal(undoRes.ok, true);
    assert.equal(wb.getState().undoBanner, null);
    assert.equal(wb.getState().liveEntriesCount, 1);

    await wb.deleteEntry(liveEntryId);
    assert.ok(wb.getState().undoBanner !== null);
    advanceClock(5_000);
    assert.equal(
      wb.getState().undoBanner,
      null,
      "Undo banner must auto-expire after 5,000ms"
    );

    // Clear settled paper entries also triggers 5s undo banner
    await wb.clearSettledPaper();
    assert.equal(wb.getState().paperEntriesCount, 0);
    assert.ok(wb.getState().undoBanner !== null);
    advanceClock(5_000);
    assert.equal(wb.getState().undoBanner, null);

    // Update daily stop-loss limit
    const limitRes = await wb.saveDailyLimit(500);
    assert.equal(limitRes.ok, true);
    assert.equal(wb.getState().ledger.dailyLimit, 500);

    // Verify offline ledger cache written to storagePort
    const cachedRaw = storagePort.getItem(`yj_ledger_cache_v1_${demoUser.id}`);
    assert.ok(cachedRaw && JSON.parse(cachedRaw).dailyLimit === 500);

    // 4. 45,000ms auto-settle throttle (unless force: true)
    const autoCallsBefore = ledgerCalls.filter(
      (c) => c.action === "auto-settle"
    ).length;
    const auto1 = await wb.refreshLedgerAutoSettle();
    assert.equal(auto1.throttled, false);
    assert.equal(
      ledgerCalls.filter((c) => c.action === "auto-settle").length,
      autoCallsBefore + 1
    );

    advanceClock(20_000);
    const auto2Throttled = await wb.refreshLedgerAutoSettle();
    assert.equal(auto2Throttled.throttled, true);
    assert.equal(
      ledgerCalls.filter((c) => c.action === "auto-settle").length,
      autoCallsBefore + 1,
      "Auto-settle within 45,000ms must be throttled without hitting ledgerPort"
    );

    const auto3Forced = await wb.refreshLedgerAutoSettle({ force: true });
    assert.equal(auto3Forced.throttled, false);
    assert.equal(
      ledgerCalls.filter((c) => c.action === "auto-settle").length,
      autoCallsBefore + 2,
      "force: true must bypass the 45,000ms throttle"
    );

    advanceClock(45_000);
    const auto4AfterWindow = await wb.refreshLedgerAutoSettle();
    assert.equal(auto4AfterWindow.throttled, false);
    assert.equal(
      ledgerCalls.filter((c) => c.action === "auto-settle").length,
      autoCallsBefore + 3
    );

    wb.dispose();
  });

  it("Slice 5 (Composed Headless Workbench · XiaoGao Single/Combo Diagnosis + ADR-0003 Offline Continuity vs 401 Logout): reconciles matchId/matchNumStr alerts, syncs quota, preserves cached session offline, and clears on 401", async () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const m0 = matches[0];
    const m1 = matches[1];
    let nowMs = Date.parse("2026-11-21T21:10:00+08:00");

    const clockPort = {
      now: () => nowMs,
      setTimeout: (fn: () => void) => {
        fn();
        return 1;
      },
      clearTimeout: () => {},
    };
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

    const demoUser: PublicAccountUser = {
      id: "u-wb-2",
      username: "member02",
      note: "情报与离线测试成员",
      role: "member",
      status: "active",
      lockedReason: null,
      createdAt: nowMs - 86400_000,
      durationHours: 720,
      firstLoginAt: nowMs - 3600_000,
      expiresAt: nowMs + 700 * 3600_000,
      remainingMs: 700 * 3600_000,
      maxDevices: 2,
      boundDevicesCount: 1,
      boundDevices: [],
      aiEnabled: true,
      dailyAiLimit: 15,
      aiUsedToday: 2,
      violationCount: 0,
      failedLoginCount: 0,
      loginLockedUntil: null,
    };

    let observedInFlightSingleId: string | null = null;
    let observedInFlightCombo = false;
    let revokedHandler: ((reason: string) => void) | null = null;
    let bootMode: "authenticated" | "network-fail" | "unauthorized-401" =
      "authenticated";

    const wb = createWorkbenchController({
      debounceMs: 0,
      autoSyncRadar: true,
      clockPort,
      storagePort,
      quantPort: {
        computeWorkspace: (params, ms) => evaluateQuantWorkspace(params, ms),
        syncMatches: async (wp) => ({
          matches,
          syncNote: "官方盘口已刷新",
          workspace: evaluateQuantWorkspace(wp, matches),
          newlySettledCount: 2,
        }),
      },
      xiaogaoPort: {
        diagnoseMatch: async (matchId) => {
          observedInFlightSingleId = wb.getState().diagnosingMatchId;
          return {
            alert: {
              level: "high",
              tag: `${matchId} 热门升水预警`,
              summary: "主力后腰轮休且主胜水位红升散热",
              priceInStatus: "盘面逆向背离",
              source: "扫地僧小高实时诊盘 · 21:15",
            },
            aiRemaining: 12,
          };
        },
        diagnoseCombo: async () => {
          observedInFlightCombo = wb.getState().diagnosingCombo;
          return {
            comboReport: {
              level: "high",
              comboTag: "2串1双维协同会诊",
              summary: "首关稳健，次关存在一球卡盘暗雷",
              actuarySynergy: "已识别当前2串1分倍防线",
              weakestLeg: `${m1.matchNumStr} ${m1.home}`,
              structureAdvice: "次关建议补防让球平",
              priceInVerdict: "部分消息尚未充分入价",
              matchCount: 2,
              source: "扫地僧小高 2场协同会诊 · 21:20",
              perMatch: [
                {
                  matchId: m0.id,
                  matchTitle: `${m0.matchNumStr} ${m0.home} vs ${m0.away}`,
                  tag: "首关盘口稳固",
                  note: "绿降设防合理",
                  priceInStatus: "尚未消化",
                },
                {
                  matchId: m1.id,
                  matchTitle: `${m1.matchNumStr} ${m1.home} vs ${m1.away}`,
                  tag: "次关卡盘高危",
                  note: "强队净胜1球占比偏高",
                  priceInStatus: "已充分消化",
                },
              ],
            },
            aiRemaining: 11,
          };
        },
      },
      authPort: {
        bootstrap: async () => {
          if (bootMode === "network-fail") {
            throw new TypeError("Failed to fetch");
          }
          if (bootMode === "unauthorized-401") {
            throw Object.assign(new Error("登录凭证已失效"), {
              statusCode: 401,
            });
          }
          return {
            authenticated: true,
            user: demoUser,
            authToken: "tok_persist_wb2",
            matches,
            syncNote: "首次加密握手成功",
            initialPicks: [],
            workspace: evaluateQuantWorkspace(
              { picks: [], multiple: 5 },
              matches
            ),
          };
        },
        registerRevokedHandler: (fn) => {
          revokedHandler = fn;
        },
      },
    });

    assert.equal(wb.hasPersistedSession(), false);
    assert.equal(typeof revokedHandler, "function");

    // 1. Authenticated bootstrap caches token + user in storagePort & initializes remainingAiQuota = 13 (15 - 2)
    const boot1 = await wb.bootstrapHandshake();
    assert.equal(boot1.ok, true);
    assert.equal(wb.hasPersistedSession(), true);
    assert.equal(wb.getState().authUser?.username, "member02");
    assert.equal(wb.getState().remainingAiQuota, 13);
    assert.ok(storagePort.getItem("yj_wechat_auth_v1") !== null);

    // 2. Single-match XiaoGao diagnosis updates diagnosingMatchId, quota -> 12, and matchAiAlerts
    const singleRes = await wb.diagnoseSingleMatch(m0.id, "关注客队伤病");
    assert.equal(singleRes.ok, true);
    assert.equal(observedInFlightSingleId, m0.id);
    assert.equal(wb.getState().diagnosingMatchId, null);
    assert.equal(wb.getState().remainingAiQuota, 12);
    assert.equal(wb.getState().authUser?.aiUsedToday, 3);
    assert.equal(
      wb.getState().matchAiAlerts[m0.id]?.priceInStatus,
      "盘面逆向背离"
    );

    // 3. Combo diagnosis guards <2 matches, then reconciles both matchId (m0) and matchNumStr (m1) alerts
    wb.betSlip.togglePick(m0, "HAD", "h");
    const blockedCombo = await wb.diagnoseComboSlip({ sourceMode: "picked" });
    assert.equal(blockedCombo.ok, false);

    wb.betSlip.togglePick(m1, "HAD", "h");
    await wb.betSlip.flush();
    const comboRes = await wb.diagnoseComboSlip({ sourceMode: "picked" });
    assert.equal(comboRes.ok, true);
    assert.equal(observedInFlightCombo, true);
    assert.equal(wb.getState().diagnosingCombo, false);
    assert.equal(wb.getState().remainingAiQuota, 11);
    assert.equal(wb.getState().comboReport?.comboTag, "2串1双维协同会诊");
    assert.equal(wb.getState().matchAiAlerts[m0.id]?.tag, "首关盘口稳固");
    assert.equal(
      wb.getState().matchAiAlerts[m1.id]?.tag,
      "次关卡盘高危",
      "Combo diagnosis must reconcile matchNumStr onto canonical match.id"
    );

    // 4. ADR-0003 Offline Continuity: transient network failure preserves authUser, token & in-progress picks
    bootMode = "network-fail";
    const bootOffline = await wb.bootstrapHandshake({ maxAttempts: 2 });
    assert.equal(bootOffline.ok, false);
    assert.equal(bootOffline.authenticated, true);
    assert.equal(bootOffline.offline, true);
    assert.equal(wb.getState().offlineMode, true);
    assert.equal(wb.getState().authUser?.id, demoUser.id);
    assert.ok(
      storagePort.getItem("yj_wechat_auth_v1") !== null,
      "Network failure must NEVER wipe persisted WeChat session token"
    );
    assert.equal(wb.betSlip.getState().picks.length, 2);

    // Seamless reconnect clears offlineMode while keeping user's 2 in-progress picks intact
    bootMode = "authenticated";
    const bootReconn = await wb.bootstrapHandshake({ isReconnect: true });
    assert.equal(bootReconn.ok, true);
    assert.equal(wb.getState().offlineMode, false);
    assert.equal(wb.betSlip.getState().picks.length, 2);

    // Official match sync updates syncSummary and preserves live "扫地僧小高..." alerts over static nm.aiAlert (e.g. m0!)
    assert.ok(
      Boolean(m0.aiAlert),
      "Sanity check: m0 carries a static fallback aiAlert that must NOT overwrite live XiaoGao diagnosis"
    );
    const syncRes = await wb.syncOfficialMatches();
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.newlySettledCount, 2);
    assert.equal(wb.getState().syncSummary, "官方盘口已刷新");
    assert.equal(
      wb.getState().matchAiAlerts[m0.id]?.tag,
      "首关盘口稳固",
      "Live '扫地僧小高 N场协同会诊 · HH:MM' alert on m0 must survive sync even when incoming m0 has static aiAlert"
    );
    assert.equal(wb.getState().matchAiAlerts[m1.id]?.tag, "次关卡盘高危");

    // Client applyComboAiReport maps strictly by canonical matchId without heuristic matchTitle substring guessing
    const m2 = matches[2];
    const prevM2Alert = wb.getState().matchAiAlerts[m2.id];
    await wb.betSlip.applyComboAiReport({
      level: "medium",
      source: "fallback",
      perMatch: [
        {
          matchId: "unreconciled-raw-id",
          matchTitle: `${m2.matchNumStr} ${m2.home} vs ${m2.away}`,
          tag: "不应由前端猜测匹配",
          note: "服务端负责唯一规范ID对齐",
          priceInStatus: "已消化",
        },
      ],
    });
    assert.deepEqual(wb.getState().matchAiAlerts[m2.id], prevM2Alert);

    // 5. Explicit 401 invalidation clears authUser, quota & persisted storage token
    bootMode = "unauthorized-401";
    const boot401 = await wb.bootstrapHandshake();
    assert.equal(boot401.ok, false);
    assert.equal(boot401.authenticated, false);
    assert.equal(boot401.offline, false);
    assert.equal(wb.getState().authUser, null);
    assert.equal(wb.getState().remainingAiQuota, null);
    assert.equal(storagePort.getItem("yj_wechat_auth_v1"), null);
    assert.equal(wb.hasPersistedSession(), false);

    wb.dispose();
    assert.equal(revokedHandler, null);
  });
});
