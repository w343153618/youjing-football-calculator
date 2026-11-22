import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  optimizeBonusPlan,
} from "../server/quantEngine.mjs";
import { createAppRoutes } from "../server/appRoutes.mjs";
import { buildPortfolioQuoteInputSignature } from "../server/quant/reportAndSettlement.mjs";
import { sealAuthoritativePrintSnapshot } from "../server/ledgerManager.mjs";
import {
  computeClientPortfolioQuoteMeta,
  createBetSlipController,
} from "../src/workspace/betSlipController.ts";
import * as cabinViewModels from "../src/mobile/cabins/cabinViewModels.ts";
import { resolveCompactAuditBarPrimaryAction } from "../src/mobile/cabins/cabinViewModels.ts";
import type {
  ArchetypePlan,
  MatchItem,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

describe("Spec #10 · Two-Axis Code Review Remediation (Standards + Spec)", () => {
  it("Slice 1 (Axis 1 #1): solveFullSetZeroUnderwaterLines honors per-spec statutory parlay caps (2串1=20万, 4串1=50万) instead of clipping >10万 parlays at single-match 10万", () => {
    const base = FALLBACK_MATCHES as MatchItem[];
    const homeWinScores9 = [
      "1:0",
      "2:0",
      "2:1",
      "3:0",
      "3:1",
      "3:2",
      "4:0",
      "4:1",
      "4:2",
    ];
    const homeWinScores8 = homeWinScores9.slice(0, 8);

    const buildHighOddsCrsMatch = (
      tpl: MatchItem,
      id: string,
      pickedKeys: string[],
      firstOdds: number,
      restPickedOdds: number
    ): MatchItem => {
      const allHomeWinKeys = new Set([
        "1:0",
        "2:0",
        "2:1",
        "3:0",
        "3:1",
        "3:2",
        "4:0",
        "4:1",
        "4:2",
        "5:0",
        "5:1",
        "5:2",
        "胜其它",
      ]);
      const crsOpts = tpl.pools.CRS.options.map((opt) => {
        const idx = pickedKeys.indexOf(opt.key);
        const odds =
          idx === 0
            ? firstOdds
            : idx > 0
              ? restPickedOdds
              : allHomeWinKeys.has(opt.key)
                ? 1000
                : 17.5;
        return { ...opt, odds };
      });
      return {
        ...tpl,
        id,
        pools: {
          ...tpl.pools,
          HAD: {
            ...tpl.pools.HAD,
            selling: true,
            canAllUp: true,
            single: false,
            canSingle: false,
            options: [
              { key: "h", label: "主胜", odds: 1.05, fairProb: 0.9, trend: 0 },
              { key: "d", label: "平", odds: 15.0, fairProb: 0.06, trend: 0 },
              { key: "a", label: "客胜", odds: 28.0, fairProb: 0.04, trend: 0 },
            ],
          },
          HHAD: {
            ...tpl.pools.HHAD,
            selling: false,
            canAllUp: false,
            single: false,
            canSingle: false,
          },
          TTG: {
            ...tpl.pools.TTG,
            selling: false,
            canAllUp: false,
            single: false,
            canSingle: false,
          },
          HAFU: {
            ...tpl.pools.HAFU,
            selling: false,
            canAllUp: false,
            single: false,
            canSingle: false,
          },
          CRS: {
            ...tpl.pools.CRS,
            payoutRatio: 0.92,
            selling: true,
            canAllUp: true,
            single: true,
            canSingle: true,
            options: crsOpts,
          },
        },
      };
    };

    // 2串1: 9 * 8 = 72 > 64 lines -> forces solveFullSetZeroUnderwaterLines.
    // Match A has 1:0 @ 180 and 8 home-win scores @ 250; Match B has 1:0 @ 250 and 7 home-win scores @ 280.
    // 1:0 x 1:0 = 180 * 250 * 2 = 90,000 (<= 100,000);
    // 250 x 280 * 2 = 140,000 (> 100,000 single cap, <= 200,000 statutory 2串1 cap!).
    const mA = buildHighOddsCrsMatch(
      base[0],
      "rev-m1",
      homeWinScores9,
      180,
      250
    );
    const mB = buildHighOddsCrsMatch(
      base[1],
      "rev-m2",
      homeWinScores8,
      250,
      280
    );

    const picks2x1 = [
      ...homeWinScores9.map((key) => ({
        matchId: mA.id,
        poolCode: "CRS" as const,
        optionKey: key,
        optionLabel: key,
        odds: key === "1:0" ? 180 : 250,
      })),
      ...homeWinScores8.map((key) => ({
        matchId: mB.id,
        poolCode: "CRS" as const,
        optionKey: key,
        optionLabel: key,
        odds: key === "1:0" ? 250 : 280,
      })),
    ] as SelectedPick[];

    const plans2x1 = generateParetoPortfolio(
      [mA, mB],
      600,
      "objective",
      true,
      picks2x1,
      { passSpec: { mode: "free", passSizes: [2] } }
    ) as ArchetypePlan[];

    const slot1TwoLeg = plans2x1.find((p) => p.key === "max-profit-prob");
    assert.ok(
      slot1TwoLeg?.available,
      `Expected 2串1 full-set Slot 1 plan to be available (${slot1TwoLeg?.emptyReason})`
    );
    assert.equal(slot1TwoLeg!.lines.length, 72);

    const high2x1Lines = slot1TwoLeg!.lines.filter(
      (ln) => Math.abs(ln.unitPayout - 140_000) < 1e-6
    );
    assert.equal(high2x1Lines.length, 56);
    // At budget ¥600 (300 notes across 72 unclipped 2串1 lines), water-filling MUST allocate >= 3x
    // to 140,000 lines instead of falsely flagging >100,000 as cap-clipped and freezing them at 1x!
    for (const ln of high2x1Lines) {
      assert.equal(ln.cappedClipped, 0);
      assert.ok(
        ln.multiple >= 3,
        `Expected unclipped 140,000 2串1 line to water-fill >= 3x at ¥600 budget, got ${ln.multiple}x (returnPayout=${ln.returnPayout})`
      );
    }

    // 4串1: 3^4 = 81 > 64 HAD lines -> forces solveFullSetZeroUnderwaterLines with 100% coverage.
    // HAD odds: h=1.50, d=5.00, a=16.00 -> a*a*a*a unitPayout = 16^4 * 2 = 131,072 (> 100,000, <= 200,000, <= 500,000 4串1 cap!).
    const fourMatches: MatchItem[] = [0, 1, 2, 3].map((idx) => ({
      ...base[idx],
      id: `rev-4m-${idx + 1}`,
      pools: {
        ...base[idx].pools,
        HAD: {
          ...base[idx].pools.HAD,
          payoutRatio: 0.93,
          selling: true,
          canAllUp: true,
          single: false,
          canSingle: false,
          options: [
            { key: "h", label: "主胜", odds: 1.5, fairProb: 0.7, trend: 0 },
            { key: "d", label: "平", odds: 5.0, fairProb: 0.22, trend: 0 },
            { key: "a", label: "客胜", odds: 16.0, fairProb: 0.08, trend: 0 },
          ],
        },
      },
    }));
    const picks4x1 = fourMatches.flatMap((m) =>
      (["h", "d", "a"] as const).map((key) => ({
        matchId: m.id,
        poolCode: "HAD" as const,
        optionKey: key,
        optionLabel: key,
        odds: key === "h" ? 1.5 : key === "d" ? 5.0 : 16.0,
      }))
    ) as SelectedPick[];

    const plans4x1 = generateParetoPortfolio(
      fourMatches,
      2000,
      "objective",
      true,
      picks4x1,
      { passSpec: { mode: "free", passSizes: [4] } }
    ) as ArchetypePlan[];

    const slot1FourLeg = plans4x1.find((p) => p.key === "max-profit-prob");
    assert.ok(
      slot1FourLeg?.available,
      `Expected 4串1 full-set Slot 1 plan to be available (${slot1FourLeg?.emptyReason})`
    );
    assert.equal(slot1FourLeg!.lines.length, 81);

    const apex4x1Line = slot1FourLeg!.lines.find(
      (ln) => Math.abs(ln.unitPayout - 131_072) < 1e-6
    );
    assert.ok(
      apex4x1Line,
      "Expected 16^4 * 2 = 131,072 4串1 line to preserve full unclipped unitPayout (not clipped at 100,000)"
    );
    assert.equal(apex4x1Line!.cappedClipped, 0);
  });

  it("Slice 2 (Axis 1 #2): enforces uppercase poolCode quote-sig parity, populates expectedQuoteInputSig/appliedBudgetYuan on apply, and blocks untrusted budget smuggling & forged quote signatures", () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const [m0, m1] = matches;

    // 1. Client vs server poolCode case normalization parity
    const lowerPick = {
      matchId: m0.id,
      matchNumStr: m0.matchNumStr,
      home: m0.home,
      away: m0.away,
      poolCode: "had" as unknown as PoolCode,
      poolName: "胜平负",
      singleAllowed: m0.pools.HAD.single,
      optionKey: "h",
      optionLabel: "主胜",
      odds: m0.pools.HAD.options[0].odds,
      fairProb: m0.pools.HAD.options[0].fairProb,
    } satisfies SelectedPick;
    const clientSigMeta = computeClientPortfolioQuoteMeta({
      matches,
      picks: [lowerPick],
      budget: 50,
      targetIds: [m0.id, m1.id],
      anchorToRadarPicks: true,
      stance: "objective",
      subjectiveDeltaPct: 0,
      allowSaveCash: false,
      unlockFullAgg: false,
      passSpec: { mode: "auto" },
    });
    const serverSigMeta = buildPortfolioQuoteInputSignature({
      picks: [lowerPick],
      budget: 50,
      resolvedTargets: [m0, m1],
      anchorToRadarPicks: true,
      stance: "objective",
      subjectiveDeltaPct: 0,
      allowSaveCash: false,
      unlockFullAgg: false,
      passSpec: { mode: "auto" },
    });
    assert.equal(clientSigMeta.inputSig, serverSigMeta.inputSig);

    // 2. betSlipController populates expectedQuoteInputSig & appliedBudgetYuan and toggles allowBudgetMismatchReadOnly only across budget slider changes
    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (p, ms) => evaluateQuantWorkspace(p, ms),
    });
    ctrl.initializeMatches(
      matches,
      [],
      evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [m0.id, m1.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        matches
      )
    );
    const planAt100 = ctrl
      .getState()
      .workspace.portfolioPlans.find(
        (p) => p.key === "max-ev-utility" && p.available
      )!;
    assert.ok(planAt100 && planAt100.totalCost > 10);
    assert.equal(ctrl.applyArchetype(planAt100), true);

    const specAtApply = ctrl.getState().planSpec as any;
    assert.equal(specAtApply.kind, "archetype");
    assert.equal(specAtApply.appliedBudgetYuan, 100);
    assert.equal(specAtApply.planBudgetYuan, 100);
    assert.equal(
      specAtApply.expectedQuoteInputSig,
      ctrl.getState().livePortfolioQuote.inputSig
    );
    assert.equal(Boolean(specAtApply.allowBudgetMismatchReadOnly), false);

    ctrl.setBudget(20);
    const specAfterSlider = ctrl.getState().planSpec as any;
    assert.equal(specAfterSlider.allowBudgetMismatchReadOnly, true);
    assert.equal(
      ctrl.getState().workspace.effectiveReport.totalCost,
      planAt100.totalCost
    );

    // 3. Untrusted payload OMITTING planBudgetYuan / appliedBudgetYuan CANNOT smuggle ¥84+ plan under budget: 10
    const strippedPlan84 = { ...planAt100 };
    delete (strippedPlan84 as any).quoteInputSig;
    delete (strippedPlan84 as any).quoteBudgetYuan;

    const smuggleWs = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          snapshotPlan: strippedPlan84,
        },
        targetIds: [m0.id, m1.id],
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.equal(
      smuggleWs.appliedPlan,
      null,
      "Omitting planBudgetYuan/appliedBudgetYuan MUST NOT smuggle an ¥84+ plan under budget: 10"
    );
    assert.equal(smuggleWs.effectiveReport.canCheckout, false);

    // 4. Forged/stale quoteInputSig rejected when !allowBudgetMismatchReadOnly AND on sealAuthoritativePrintSnapshot even if allowBudgetMismatchReadOnly: true is spoofed
    const planAt10Ws = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m0.id, m1.id],
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    const valid10Plan = planAt10Ws.portfolioPlans.find(
      (p: ArchetypePlan) => p.key === "max-ev-utility" && p.available
    )!;
    const forgedSigWs = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          snapshotPlan: {
            ...valid10Plan,
            quoteInputSig: "v1|forged_stale_sig",
          },
          quoteInputSig: "v1|forged_stale_sig",
          planBudgetYuan: 10,
        } as any,
        targetIds: [m0.id, m1.id],
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.equal(forgedSigWs.appliedPlan, null);
    assert.equal(forgedSigWs.effectiveReport.canCheckout, false);

    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          workspaceParams: {
            picks: [],
            multiple: 5,
            subjectiveDeltaPct: 0,
            simVoidFirstMatch: false,
            planSpec: {
              kind: "archetype",
              key: "max-ev-utility",
              snapshotPlan: {
                ...valid10Plan,
                quoteInputSig: "v1|forged_stale_sig",
              },
              quoteInputSig: "v1|forged_stale_sig",
              expectedQuoteInputSig: "v1|forged_stale_sig",
              allowBudgetMismatchReadOnly: true,
              planBudgetYuan: 100,
              appliedBudgetYuan: 100,
            },
            targetIds: [m0.id, m1.id],
            budget: 10,
            stance: "objective",
            unlockFullAgg: false,
          },
          authoritativeMatches: matches,
        }),
      /报价|预算|出票/
    );
  });

  it("Slice 3 (Axis 1 #3): compact mobile audit bar never mislabels non-equivalent partial-coverage single as 一键合成单关 and requires 2-step preview -> confirm", () => {
    const base = FALLBACK_MATCHES as MatchItem[];
    // Construct Twente -3 让负 style match: HAD closed, HHAD(-3) non-single, CRS/HAFU/TTG single-open
    const twenteLike: MatchItem = {
      ...base[0],
      id: "twente-minus3",
      home: "特温特",
      away: "威廉二世",
      pools: {
        ...base[0].pools,
        HAD: {
          ...base[0].pools.HAD,
          selling: false,
          canAllUp: false,
          single: false,
          canSingle: false,
          options: [],
        },
        HHAD: {
          ...base[0].pools.HHAD,
          goalLine: "-1",
          name: "让球(-1)",
          selling: true,
          canAllUp: true,
          single: false,
          canSingle: false,
        },
        HAFU: {
          ...base[0].pools.HAFU,
          selling: true,
          canAllUp: true,
          single: true,
          canSingle: true,
        },
        TTG: {
          ...base[0].pools.TTG,
          selling: true,
          canAllUp: true,
          single: true,
          canSingle: true,
        },
        CRS: {
          ...base[0].pools.CRS,
          selling: true,
          canAllUp: true,
          single: true,
          canSingle: true,
        },
      },
    };

    const wsPartial = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: twenteLike.id,
            poolCode: "HHAD",
            optionKey: "hd",
            optionLabel: "让平",
            odds: twenteLike.pools.HHAD.options.find((o) => o.key === "hd")!
              .odds,
          },
        ],
        multiple: 5,
        syntheticSingleMode: "full-3way",
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [twenteLike.id, base[1].id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      [twenteLike, base[1]]
    );

    const eff = wsPartial.effectiveReport;
    assert.equal(eff.canCheckout, false);
    assert.ok(eff.partialCoveragePreview);
    assert.equal(eff.partialCoveragePreview!.isExactEquivalent, false);

    // Step 1: Must NOT say "一键合成单关" and must NOT be kind "synthetic" (which commits immediately);
    // must surface honest partial-coverage preview with ¥previewCost and blind-spot rate!
    const step1Action = resolveCompactAuditBarPrimaryAction(
      eff,
      { isSyntheticPlayable: true, showBridgeFinder: false },
      wsPartial.insights.bridgeCandidates
    );
    assert.notEqual(step1Action.label, "一键合成单关");
    assert.notEqual(step1Action.kind, "synthetic");
    assert.equal(step1Action.kind, "partial-preview");
    assert.ok(
      step1Action.label.includes("部分覆盖预览") &&
        step1Action.label.includes(
          `¥${eff.partialCoveragePreview!.previewCost}`
        ) &&
        step1Action.label.includes("漏"),
      `Expected honest partial-coverage preview label with cost and blind spot, got: ${step1Action.label}`
    );

    // Step 2 (after explicit preview expansion): exposes retained ratio, blind-spot rate, and ¥previewCost confirmation
    const step2Action = resolveCompactAuditBarPrimaryAction(
      eff,
      { isSyntheticPlayable: true, showBridgeFinder: false },
      wsPartial.insights.bridgeCandidates,
      { confirmingPartial: true }
    );
    assert.equal(step2Action.kind, "partial-confirm");
    assert.ok(
      step2Action.label.includes("确认") &&
        step2Action.label.includes(
          `¥${eff.partialCoveragePreview!.previewCost}`
        ),
      `Expected step-2 confirmation label with ¥cost, got: ${step2Action.label}`
    );
    assert.ok(
      step2Action.disclosureText?.includes("保") &&
        step2Action.disclosureText?.includes("漏") &&
        step2Action.disclosureText?.includes(
          `¥${eff.partialCoveragePreview!.previewCost}`
        )
    );

    // Exact 100% equivalent single when unmounted ("off" mode -> no requiresExplicitConfirm partial discrepancy) keeps "一键合成单关"
    const exactStep = resolveCompactAuditBarPrimaryAction(
      {
        canCheckout: false,
        isExactSyntheticEquivalent: true,
        partialCoveragePreview: null,
      },
      { isSyntheticPlayable: true, showBridgeFinder: false },
      []
    );
    assert.equal(exactStep.kind, "synthetic");
    assert.equal(exactStep.label, "一键合成单关");
  });

  it("Slice 4 (Axis 1 #4): /api/xiaogao/analyze-combo sanitizes, deduplicates & caps auditedLegs and picks at 512 items while preserving legSource", async () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const [m0, m1] = matches;
    let capturedCtxList: any[] = [];

    const appRoutes = createAppRoutes({
      getApiKey: () => "test-key",
      fetchMatches: async () => ({ matches, syncNote: "ok" }),
      fetchResults: async () => new Map(),
      accountManager: {
        consumeAiQuota: () => ({ ok: true, remaining: 8 }),
      } as any,
      ledgerManager: {} as any,
      manualQaEngine: {} as any,
      xiaogaoService: {
        analyzeComboMatches: async (_key: string, ctx: any) => {
          capturedCtxList.push(ctx);
          return {
            headline: "ok",
            summary: "ok",
            level: "low",
            source: "primary",
            perMatchAlerts: [],
            residualRisks: [],
          };
        },
      } as any,
    });

    const invokeComboRoute = async (dataPayload: Record<string, any>) => {
      let out: any = null;
      await appRoutes.handleDomainRoute(
        { method: "POST", headers: {} } as any,
        { setHeader() {} } as any,
        "/api/xiaogao/analyze-combo",
        {
          ip: "127.0.0.1",
          sendJson: (_res: any, code: number, body: any) => {
            throw new Error(`Unexpected HTTP ${code}: ${JSON.stringify(body)}`);
          },
          cookieSuffix: () => "",
          deriveFallbackClientFp: () => "fp",
          checkAndContagiousLockHwFp: () => null,
          tripFuse: () => 0,
          getBanStats: () => ({ fusedIpsCount: 0, fusedHwCount: 0 }),
          runEncryptedRoute: async (
            _req: any,
            _res: any,
            _ip: string,
            _cfg: any,
            handler: any
          ) => {
            out = await handler({
              sess: { aiAlerts: new Map() },
              data: dataPayload,
              user: { id: "u_san" },
            });
            return true;
          },
        }
      );
      return out;
    };

    // 1. 600 flooded duplicate auditedLegs + malformed entries -> deduplicated (no prompt inflation) & preserves valid legSource
    const floodedAuditedLegs = [
      null,
      { matchId: 123, poolCode: "HAD", optionKey: "h" },
      ...Array.from({ length: 300 }, () => ({
        matchId: m0.id,
        poolCode: "had",
        optionKey: "h",
        optionLabel: "主胜",
        odds: m0.pools.HAD.options[0].odds,
        legSource: "manual-anchor",
      })),
      ...Array.from({ length: 300 }, () => ({
        matchId: m1.id,
        poolCode: "HAD",
        optionKey: "h",
        optionLabel: "主胜",
        odds: m1.pools.HAD.options[0].odds,
        legSource: "bridge-mate",
      })),
    ];

    await invokeComboRoute({
      sourceMode: "picked",
      matchIds: [m0.id, m1.id],
      picks: [],
      auditedLegs: floodedAuditedLegs,
      multiple: 5,
      budget: 50,
    });
    assert.equal(capturedCtxList.length, 1);
    const ctx1 = capturedCtxList[0];
    const m0Desc =
      ctx1.matches.find((x: any) => x.matchId === m0.id)?.userPickedDesc ?? "";
    const m1Desc =
      ctx1.matches.find((x: any) => x.matchId === m1.id)?.userPickedDesc ?? "";
    // Must appear strictly once per unique leg, NOT 300 times!
    assert.equal(
      m0Desc.split("+").length,
      1,
      `Expected deduplicated m0 userPickedDesc without duplicate inflation, got: ${m0Desc}`
    );
    assert.equal(m1Desc.split("+").length, 1);
    assert.equal(ctx1.sanitizedPickCount, 2);
    assert.deepEqual(ctx1.auditedLegSources, [
      {
        matchId: m0.id,
        poolCode: "HAD",
        optionKey: "h",
        legSource: "manual-anchor",
      },
      {
        matchId: m1.id,
        poolCode: "HAD",
        optionKey: "h",
        legSource: "bridge-mate",
      },
    ]);

    // 2. > 512 distinct synthetic legs capped strictly at 512
    const over512Distinct = Array.from({ length: 620 }, (_, idx) => ({
      matchId: idx % 2 === 0 ? m0.id : m1.id,
      poolCode: "CRS",
      optionKey: `fake_${idx}`,
      optionLabel: `fake_${idx}`,
      odds: 8.0,
      legSource: "cross-pool-substitute",
    }));
    await invokeComboRoute({
      sourceMode: "picked",
      matchIds: [m0.id, m1.id],
      picks: over512Distinct,
      auditedLegs: [],
      multiple: 1,
      budget: 50,
    });
    assert.equal(capturedCtxList.length, 2);
    assert.equal(capturedCtxList[1].sanitizedPickCount, 512);
  });

  it("Slice 5 (Axis 1 #5 & Axis 2 #4): eliminates conditional 保底 mislabeling when zeroPayoutProb > 0 across synthetic single, bonus opt, sandbox, and PersistentBetBar view-model", () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const [m0, m1] = matches;
    const nonSingleM0: MatchItem = {
      ...m0,
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: false, canSingle: false },
      },
    };

    // 1. Auto-synthetic single on HAD:h (zeroPayoutProb = P(d) + P(a) > 0)
    const wsSyn = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: nonSingleM0.id,
            poolCode: "HAD",
            optionKey: "h",
            optionLabel: "主胜",
            odds: nonSingleM0.pools.HAD.options[0].odds,
          },
        ],
        multiple: 5,
        syntheticSingleMode: "full-3way",
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [nonSingleM0.id, m1.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      [nonSingleM0, m1]
    );
    assert.ok(wsSyn.appliedPlan);
    assert.equal(wsSyn.effectiveReport.isUnconditionalFloorGuaranteed, false);
    assert.ok(wsSyn.effectiveReport.zeroPayoutProb > 0);
    assert.equal(
      wsSyn.appliedPlan!.tagline.includes("保底"),
      false,
      `Expected conditional synthetic tagline without 保底, got: ${wsSyn.appliedPlan!.tagline}`
    );
    assert.ok(wsSyn.appliedPlan!.tagline.includes("命中返 ¥"));

    // 2. Bonus optimization & sandbox on 2串1 duplex with zeroPayoutProb > 0
    const wsBonus = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: m0.id,
            poolCode: "HAD",
            optionKey: "h",
            optionLabel: "主胜",
            odds: m0.pools.HAD.options[0].odds,
          },
          {
            matchId: m0.id,
            poolCode: "HAD",
            optionKey: "d",
            optionLabel: "平",
            odds: m0.pools.HAD.options[1].odds,
          },
          {
            matchId: m1.id,
            poolCode: "HAD",
            optionKey: "h",
            optionLabel: "主胜",
            odds: m1.pools.HAD.options[0].odds,
          },
        ],
        multiple: 5,
        subjectiveDeltaPct: 5,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode: "equal",
          scaleMultiple: 1,
          consolidateTickets: true,
        },
        targetIds: [m0.id, m1.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.ok(wsBonus.appliedPlan);
    assert.equal(wsBonus.effectiveReport.isUnconditionalFloorGuaranteed, false);
    assert.equal(wsBonus.appliedPlan!.tagline.includes("保底"), false);
    assert.ok(wsBonus.appliedPlan!.tagline.includes("命中返 ¥"));
    assert.equal(
      (wsBonus.effectiveReport.syntheticHint ?? "").includes("保底"),
      false
    );

    const directBonus = optimizeBonusPlan(
      wsBonus.manualReport,
      matches,
      "equal"
    );
    assert.equal(directBonus.tagline.includes("保底"), false);
    assert.ok(directBonus.tagline.includes("命中返 ¥"));

    // 3. PersistentBetBar payout summary helper reserves "真实保底" strictly for isUnconditionalFloorGuaranteed === true
    const formatBetBarSummary = (cabinViewModels as Record<string, any>)
      .formatBetBarPayoutSummary;
    assert.equal(
      typeof formatBetBarSummary,
      "function",
      "cabinViewModels must export formatBetBarPayoutSummary"
    );

    const condDesktop = formatBetBarSummary(wsBonus.effectiveReport, "desktop");
    const condMobile = formatBetBarSummary(wsBonus.effectiveReport, "mobile");
    assert.equal(condDesktop.includes("保底"), false);
    assert.ok(condDesktop.includes("命中最低 ¥"));
    assert.equal(condMobile.includes("保底"), false);
    assert.ok(condMobile.includes("命中最低¥"));

    // Unconditional 100% exhaustive zero-underwater floor (e.g. single-open match covering all 3 HAD outcomes with bonus equalizing)
    const singleOpenM: MatchItem = {
      ...m0,
      id: "uncond-single",
      pools: {
        ...m0.pools,
        HAD: {
          ...m0.pools.HAD,
          single: true,
          canSingle: true,
          options: [
            { key: "h", label: "主胜", odds: 3.1, fairProb: 0.34, trend: 0 },
            { key: "d", label: "平", odds: 3.2, fairProb: 0.33, trend: 0 },
            { key: "a", label: "客胜", odds: 3.2, fairProb: 0.33, trend: 0 },
          ],
        },
      },
    };
    const wsUncond = evaluateQuantWorkspace(
      {
        picks: (["h", "d", "a"] as const).map((k, idx) => ({
          matchId: singleOpenM.id,
          poolCode: "HAD" as const,
          optionKey: k,
          optionLabel: k,
          odds: singleOpenM.pools.HAD.options[idx].odds,
        })),
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [singleOpenM.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      [singleOpenM]
    );
    assert.equal(wsUncond.effectiveReport.isUnconditionalFloorGuaranteed, true);
    assert.ok(
      formatBetBarSummary(wsUncond.effectiveReport, "desktop").includes(
        "真实保底 ¥"
      )
    );
    assert.ok(
      formatBetBarSummary(wsUncond.effectiveReport, "mobile").includes(
        "真实保底¥"
      )
    );
  });

  it("Slice 6 (Axis 2 #1): desktop dock strip, mobile dock strip, and compact audit CTA surface exact previewBetCount + ¥previewTotalCost and require 2-step preview -> confirm before committing bridge match", () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const nonSingleM0: MatchItem = {
      ...matches[0],
      pools: {
        ...matches[0].pools,
        HAD: { ...matches[0].pools.HAD, single: false, canSingle: false },
      },
    };
    const poolMatches = [nonSingleM0, matches[1], matches[2]];
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, ms) => evaluateQuantWorkspace(p, ms),
    });
    ctrl.initializeMatches(
      poolMatches,
      [],
      evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [nonSingleM0.id, matches[1].id],
          budget: 50,
          stance: "objective",
          unlockFullAgg: false,
        },
        poolMatches
      )
    );
    // Pick 2 options on non-single m0 and turn synthetic single off -> 2 bets in 2串1 once bridged (@5x = ¥20)!
    ctrl.togglePick(nonSingleM0, "HAD", "h");
    ctrl.togglePick(nonSingleM0, "HAD", "d");
    ctrl.setSyntheticSingleMode("off");

    const st = ctrl.getState();
    const cand = st.workspace.insights.bridgeCandidates[0]!;
    assert.ok(cand, "Expected at least 1 bridge candidate");
    const preview = ctrl.previewBridgeCandidate(cand)!;
    assert.ok(preview);
    assert.equal(preview.previewBetCount, 2);
    assert.equal(preview.previewTotalCost, 20);

    // 1. Desktop & Mobile dock bridge strip spec builder: never says "一键搭上", shows exact 共2注 ¥20 on step 1, and transitions to step-2 confirm + cancel
    const buildBridgeItemSpec = (cabinViewModels as Record<string, any>)
      .buildDockBridgeStripItemSpec;
    assert.equal(
      typeof buildBridgeItemSpec,
      "function",
      "cabinViewModels must export buildDockBridgeStripItemSpec"
    );

    const dkStep1 = buildBridgeItemSpec(cand, preview, {
      variant: "desktop",
      confirmingKey: null,
    });
    assert.equal(dkStep1.isConfirming, false);
    assert.equal(dkStep1.step1Label.includes("一键搭上"), false);
    assert.ok(dkStep1.step1Label.includes("共2注 ¥20"));

    const mbStep1 = buildBridgeItemSpec(cand, preview, {
      variant: "mobile",
      confirmingKey: null,
    });
    assert.equal(mbStep1.isConfirming, false);
    assert.equal(mbStep1.step1Label.includes("一键搭上"), false);
    assert.ok(mbStep1.step1Label.includes("共2注 ¥20"));

    const dkStep2 = buildBridgeItemSpec(cand, preview, {
      variant: "desktop",
      confirmingKey: dkStep1.candKey,
    });
    assert.equal(dkStep2.isConfirming, true);
    assert.ok(
      dkStep2.confirmLabel.includes("确认加场") &&
        dkStep2.confirmLabel.includes("2注") &&
        dkStep2.confirmLabel.includes("¥20")
    );
    assert.equal(dkStep2.cancelLabel, "取消");

    // 2. Compact mobile audit CTA with bridgePreview: step 1 previews 2注·¥20 without blind commit; step 2 confirms ¥20
    const compactBridgeStep1 = resolveCompactAuditBarPrimaryAction(
      st.workspace.effectiveReport,
      { isSyntheticPlayable: false, showBridgeFinder: true },
      [cand],
      { bridgePreview: preview, confirmingBridge: false } as any
    );
    assert.equal(compactBridgeStep1.kind, "bridge-preview");
    assert.ok(
      compactBridgeStep1.label.includes("2注") &&
        compactBridgeStep1.label.includes("¥20"),
      `Expected compact bridge step-1 CTA to disclose 2注 and ¥20, got: ${compactBridgeStep1.label}`
    );

    const compactBridgeStep2 = resolveCompactAuditBarPrimaryAction(
      st.workspace.effectiveReport,
      { isSyntheticPlayable: false, showBridgeFinder: true },
      [cand],
      { bridgePreview: preview, confirmingBridge: true } as any
    );
    assert.equal(compactBridgeStep2.kind, "bridge-confirm");
    assert.ok(
      compactBridgeStep2.label.includes("确认") &&
        compactBridgeStep2.label.includes("¥20")
    );
  });

  it("Slice 7 (Axis 2 #2): Slot ② allowSaveCash computes expectedLossVsCashYuan and displays 实投, 留存, and 相对留现期望净损/期望净赚 side by side in plan copy & buildPortfolioKpiTiles", () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const plansSaveCash = generateParetoPortfolio(
      matches.slice(0, 2),
      100,
      "objective",
      false,
      [],
      { allowSaveCash: true }
    ) as ArchetypePlan[];

    const slot2 = plansSaveCash.find((p) => p.key === "max-ev-utility")!;
    assert.ok(slot2?.available);
    const expectedLoss = Number(
      (
        slot2.totalCost *
        Math.max(0, -(slot2.objectiveEVRate ?? slot2.expectedValueRate ?? 0))
      ).toFixed(2)
    );
    assert.equal((slot2 as any).expectedLossVsCashYuan, expectedLoss);
    assert.ok(slot2.tagline.includes(`实投 ¥${slot2.totalCost}`));
    assert.ok(slot2.tagline.includes(`留存 ¥${slot2.savedCash}`));
    assert.ok(
      slot2.tagline.includes(`相对留现期望净损 ¥${expectedLoss.toFixed(2)}`) ||
        slot2.tagline.includes("期望净赚 +¥"),
      `Expected Slot ② tagline to include relative-to-cash expected loss/gain, got: ${slot2.tagline}`
    );
    assert.ok(
      slot2.reasons.some(
        (r) =>
          r.includes(`实投 ¥${slot2.totalCost}`) &&
          r.includes(`留存 ¥${slot2.savedCash}`) &&
          (r.includes(`相对留现期望净损 ¥${expectedLoss.toFixed(2)}`) ||
            r.includes("期望净赚 +¥"))
      )
    );

    const kpiNeg = cabinViewModels.buildPortfolioKpiTiles(slot2, {
      allowSaveCash: true,
    } as any);
    assert.ok(kpiNeg.tile3.subtitle.includes(`实投 ¥${slot2.totalCost}`));
    assert.ok(kpiNeg.tile3.subtitle.includes(`留存 ¥${slot2.savedCash}`));
    assert.ok(
      kpiNeg.tile3.subtitle.includes(
        `相对留现期望净损 ¥${expectedLoss.toFixed(2)}`
      )
    );
    assert.ok(
      (kpiNeg as any).saveCashSummary?.includes(
        `相对留现期望净损 ¥${expectedLoss.toFixed(2)}`
      )
    );

    // Positive EV case displays 期望净赚 +¥Z
    const kpiPos = cabinViewModels.buildPortfolioKpiTiles(
      {
        ...slot2,
        totalCost: 20,
        savedCash: 80,
        expectedValueRate: 0.05,
        objectiveEVRate: 0.05,
        expectedLossVsCashYuan: 0,
        expectedNetVsCashYuan: 1.0,
      } as any,
      { allowSaveCash: true } as any
    );
    assert.ok(kpiPos.tile3.subtitle.includes("实投 ¥20"));
    assert.ok(kpiPos.tile3.subtitle.includes("留存 ¥80"));
    assert.ok(kpiPos.tile3.subtitle.includes("期望净赚 +¥1.00"));
  });

  it("Slice 8 (Axis 2 #3): Slot ④ alpha-radar empty state surfaces interactive remediationActions & accurate narrow-budget copy when +EV is gated by ¥2/¥4 36% floor", () => {
    const base = FALLBACK_MATCHES as MatchItem[];
    const m0 = base[0];
    const laggedAlphaMatch: MatchItem = {
      ...m0,
      id: "alpha-narrow-rev",
      pools: {
        ...m0.pools,
        HAD: {
          ...m0.pools.HAD,
          updateDate: "2026-11-21",
          updateTime: "21:30:00",
        },
        HHAD: {
          ...m0.pools.HHAD,
          updateDate: "2026-11-21",
          updateTime: "21:30:00",
        },
        TTG: {
          ...m0.pools.TTG,
          single: true,
          canSingle: true,
          updateDate: "2026-11-21",
          updateTime: "18:00:00",
          options: m0.pools.TTG.options.map((o) =>
            o.key === "s2" ? { ...o, odds: 5.2 } : o
          ),
        },
      },
    };

    const s4Narrow4 = generateParetoPortfolio(
      [laggedAlphaMatch],
      4,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(s4Narrow4.available, false);
    assert.ok(
      Array.isArray(s4Narrow4.remediationActions) &&
        s4Narrow4.remediationActions.length >= 2,
      "Expected narrow-budget +EV alpha-radar to include min-feasible-budget and keep-cash remediationActions"
    );
    assert.ok(
      s4Narrow4.remediationActions!.every(
        (act) => typeof act.id === "string" && act.id.length > 0
      ),
      "Every remediationAction must carry a non-empty stable id"
    );

    const buildAlphaEmptyVm = (cabinViewModels as Record<string, any>)
      .buildAlphaRadarEmptyStateViewModel;
    assert.equal(
      typeof buildAlphaEmptyVm,
      "function",
      "cabinViewModels must export buildAlphaRadarEmptyStateViewModel"
    );

    // 1. Narrow-budget +EV blocked by 36% < ¥2: surfaces interactive remediationActions and NEVER claims "当前无真错价洼地"
    const narrowVm = buildAlphaEmptyVm(s4Narrow4, 4);
    assert.equal(narrowVm.hasRemediationActions, true);
    assert.equal(narrowVm.isNarrowBudgetAlphaGated, true);
    assert.equal(narrowVm.showNoAlphaDisabledButton, false);
    assert.equal(String(narrowVm.noteTitle).includes("无真错价洼地"), false);
    assert.ok(
      narrowVm.remediationActions.some(
        (a: any) => a.kind === "min-feasible-budget"
      ) && narrowVm.remediationActions.some((a: any) => a.kind === "keep-cash")
    );

    // 2. Genuine zero-alpha slate: shows honest empty-discipline copy while still exposing keep-cash remediation if present
    const s4NoAlpha = generateParetoPortfolio(
      [base[0], base[1]],
      50,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    if (!s4NoAlpha.available) {
      const noAlphaVm = buildAlphaEmptyVm(s4NoAlpha, 50);
      assert.equal(noAlphaVm.isNarrowBudgetAlphaGated, false);
      assert.ok(String(noAlphaVm.noteTitle).includes("宁缺毋滥"));
    }
  });

  it("Slice 9 (Axis 2 #5): buildXiaoGaoWarnings in evaluateQuantWorkspace and /api/xiaogao/analyze-combo + isBridgePair2x1 consume activeAuditedSlip legs first", async () => {
    const base = FALLBACK_MATCHES as MatchItem[];
    const alertM0: MatchItem = {
      ...base[0],
      pools: {
        ...base[0].pools,
        HAD: { ...base[0].pools.HAD, single: false, canSingle: false },
      },
    };
    const alertM1: MatchItem = {
      ...base[1],
      aiAlert: {
        level: "high",
        tag: "主力中卫停赛",
        summary: "防线高空争顶能力骤降",
        priceInStatus: "尚未消化",
        source: "扫地僧小高 · 实时诊盘",
      },
    };
    const alertM2: MatchItem = {
      ...base[2],
      aiAlert: {
        level: "medium",
        tag: "体能轮换暗雷",
        summary: "一周双赛客场轮换",
        priceInStatus: "盘面逆向背离",
        source: "扫地僧小高 · 实时诊盘",
      },
    };
    const testSlate = [alertM0, alertM1, alertM2];

    // 1. 0-pick free-pool applied plan covering [alertM1, alertM2] MUST surface XiaoGao aiAlert warnings in workspace.allWarnings!
    const initFreeWs = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [alertM1.id, alertM2.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      testSlate
    );
    const freePlan = initFreeWs.portfolioPlans.find(
      (p: ArchetypePlan) => p.available
    )!;
    assert.ok(freePlan);

    const appliedFreeWs = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: freePlan.key,
          snapshotPlan: freePlan,
          appliedBudgetYuan: 50,
          planBudgetYuan: 50,
          quoteInputSig: initFreeWs.quoteInputSig,
          expectedQuoteInputSig: initFreeWs.quoteInputSig,
        },
        expectedQuoteInputSig: initFreeWs.quoteInputSig,
        targetIds: [alertM1.id, alertM2.id],
        budget: 50,
        stance: "objective",
        unlockFullAgg: false,
      },
      testSlate
    );
    assert.ok(
      appliedFreeWs.allWarnings.some((w) => w.id === `xiaogao-${alertM1.id}`),
      `Expected 0-pick free-pool applied plan to surface xiaogao-${alertM1.id} in allWarnings, got: ${JSON.stringify(appliedFreeWs.allWarnings.map((w) => w.id))}`
    );

    // 2. /api/xiaogao/analyze-combo prefers sanitized auditedLegs over non-empty manualDraftPicks (including bridge-mate 2串1 & applied free-pool plan)
    let capturedCtx: any = null;
    const appRoutes = createAppRoutes({
      getApiKey: () => "test-key",
      fetchMatches: async () => ({ matches: testSlate, syncNote: "ok" }),
      fetchResults: async () => new Map(),
      accountManager: {
        consumeAiQuota: () => ({ ok: true, remaining: 9 }),
      } as any,
      ledgerManager: {} as any,
      manualQaEngine: {} as any,
      xiaogaoService: {
        analyzeComboMatches: async (_k: string, ctx: any) => {
          capturedCtx = ctx;
          return {
            headline: "ok",
            summary: "ok",
            level: "medium",
            source: "primary",
            perMatchAlerts: [],
            residualRisks: [],
          };
        },
      } as any,
    });

    const callRoute = async (payload: Record<string, any>) => {
      await appRoutes.handleDomainRoute(
        { method: "POST", headers: {} } as any,
        { setHeader() {} } as any,
        "/api/xiaogao/analyze-combo",
        {
          ip: "127.0.0.1",
          sendJson: (_res: any, code: number, body: any) => {
            throw new Error(`Unexpected HTTP ${code}: ${JSON.stringify(body)}`);
          },
          cookieSuffix: () => "",
          deriveFallbackClientFp: () => "fp",
          checkAndContagiousLockHwFp: () => null,
          tripFuse: () => 0,
          getBanStats: () => ({ fusedIpsCount: 0, fusedHwCount: 0 }),
          runEncryptedRoute: async (
            _req: any,
            _res: any,
            _ip: string,
            _cfg: any,
            handler: any
          ) => {
            await handler({
              sess: { aiAlerts: new Map() },
              data: payload,
              user: { id: "u_aud" },
            });
            return true;
          },
        }
      );
    };

    // Case 2a: manualDraftPicks only has [alertM0:HAD:h], while activeAuditedSlip has [alertM0:HAD:h (manual-anchor), alertM1:HAD:a (bridge-mate, prob < 0.48!)]
    await callRoute({
      sourceMode: "picked",
      matchIds: [alertM0.id, alertM1.id],
      picks: [
        {
          matchId: alertM0.id,
          poolCode: "HAD",
          optionKey: "h",
          optionLabel: "主胜",
          odds: alertM0.pools.HAD.options[0].odds,
        },
      ],
      auditedLegs: [
        {
          matchId: alertM0.id,
          poolCode: "HAD",
          optionKey: "h",
          optionLabel: "主胜",
          odds: alertM0.pools.HAD.options[0].odds,
          legSource: "manual-anchor",
        },
        {
          matchId: alertM1.id,
          poolCode: "HAD",
          optionKey: "a",
          optionLabel: "客胜",
          odds: alertM1.pools.HAD.options[2].odds,
          legSource: "bridge-mate",
        },
      ],
      multiple: 5,
      budget: 50,
    });
    assert.ok(capturedCtx);
    const diagM1 = capturedCtx.matches.find(
      (x: any) => x.matchId === alertM1.id
    );
    assert.ok(
      diagM1?.userPickedDesc.includes("客胜"),
      `Expected audited bridge-mate leg on alertM1 to appear in userPickedDesc even when manualDraftPicks only had alertM0, got: ${diagM1?.userPickedDesc}`
    );
    assert.ok(
      capturedCtx.actuaryContext.shieldSummary.includes("过桥配菜搭子 2串1"),
      `Expected isBridgePair2x1 to recognize bridge-mate legSource, got: ${capturedCtx.actuaryContext.shieldSummary}`
    );
  });
});
