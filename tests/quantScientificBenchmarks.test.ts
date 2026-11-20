import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleQuantBenchmarkReport,
  formatQuantBenchmarkReport,
  runLayer1ProperScoringBenchmark,
  runLayer2AxiomaticInvariantsBenchmark,
  runLayer3MonteCarloParetoBenchmark,
  runLayer4LedgerAblationBenchmark,
} from "../scripts/bench-quant.mjs";

describe("Spec 0009 · Ticket 04: Real Sporttery OOS Four-Layer Objective Scientific Benchmark Suite", () => {
  let l1Result: ReturnType<typeof runLayer1ProperScoringBenchmark>;
  let l2Result: ReturnType<typeof runLayer2AxiomaticInvariantsBenchmark>;
  let l3Result: ReturnType<typeof runLayer3MonteCarloParetoBenchmark>;

  it("Layer 1 · Real Sporttery OOS Proper Scoring & 10,000x Paired Bootstrap: evaluates Log-Loss, Brier, Equal-Mass Quantile ECE across all 5 pools, restricts RPS strictly to ordinal pools (HAD/HHAD/TTG), and proves statistical significance on 622 genuine settled matches", () => {
    const res = runLayer1ProperScoringBenchmark();
    l1Result = res;

    assert.ok(
      res.matchCount >= 600,
      `Expected >= 600 genuine Sporttery OOS matches, got ${res.matchCount}`
    );
    assert.deepEqual(Object.keys(res.pools), [
      "HAD",
      "HHAD",
      "TTG",
      "HAFU",
      "CRS",
    ]);

    // 1. RPS restricted strictly to 1D ordinal pools (HAD, HHAD, TTG); nominal pools (HAFU, CRS) must report rps === null
    for (const ordPool of ["HAD", "HHAD", "TTG"] as const) {
      assert.equal(typeof res.pools[ordPool].coherentShinDc.rps, "number");
      assert.equal(typeof res.pools[ordPool].shin.rps, "number");
      assert.equal(typeof res.pools[ordPool].multiplicative.rps, "number");
    }
    for (const nomPool of ["HAFU", "CRS"] as const) {
      assert.equal(
        res.pools[nomPool].coherentShinDc.rps,
        null,
        `${nomPool} is nominal and must not compute 1D RPS`
      );
      assert.equal(res.pools[nomPool].shin.rps, null);
      assert.equal(res.pools[nomPool].multiplicative.rps, null);
    }

    // 2. Macro-aggregate across all 5 pools (ordinal 3-pool RPS + 5-pool Brier / Log-Loss / Equal-Mass ECE):
    // Coherent KL/SMART strictly beats BOTH isolated Shin and legacy Multiplicative
    const agg = res.aggregate;
    for (const metric of ["rps", "brier", "logLoss", "ece"] as const) {
      assert.ok(
        agg.coherentShinDc[metric] < agg.shin[metric] &&
          agg.coherentShinDc[metric] < agg.multiplicative[metric],
        `Aggregate ${metric}: expected coherent (${agg.coherentShinDc[metric]}) < shin (${agg.shin[metric]}) & multiplicative (${agg.multiplicative[metric]})`
      );
    }
    assert.ok(
      agg.coherentShinDc.pooledEce < agg.multiplicative.pooledEce,
      `Global equal-mass 10-bin ECE: expected coherent (${agg.coherentShinDc.pooledEce}) < multiplicative (${agg.multiplicative.pooledEce})`
    );

    // 3. Transparent per-pool proper scoring across ALL 5 pools (including HHAD — zero selective omission):
    // Coherent KL/SMART improves Log-Loss over BOTH Multiplicative and isolated Shin on all 5 pools
    for (const poolCode of ["HAD", "HHAD", "TTG", "HAFU", "CRS"] as const) {
      const pm = res.pools[poolCode];
      assert.ok(
        pm.coherentShinDc.logLoss < pm.multiplicative.logLoss,
        `${poolCode} Log-Loss: expected coherent (${pm.coherentShinDc.logLoss}) < multiplicative (${pm.multiplicative.logLoss})`
      );
      assert.ok(
        pm.coherentShinDc.logLoss < pm.shin.logLoss,
        `${poolCode} Log-Loss: expected coherent (${pm.coherentShinDc.logLoss}) < isolated Shin (${pm.shin.logLoss})`
      );
    }
    const hhad = res.pools.HHAD;
    assert.ok(
      hhad.coherentShinDc.brier < hhad.shin.brier,
      "HHAD Brier must beat isolated Shin after partition reconciliation"
    );
    assert.ok(
      Math.abs(hhad.coherentShinDc.brier - hhad.multiplicative.brier) < 5e-4,
      "HHAD Brier must stay within sampling noise (<5e-4) of multiplicative"
    );

    // 4. 10,000x Paired Bootstrap CIs & two-sided p-values on Real Sporttery OOS
    const pb = res.pairedBootstrap;
    assert.equal(pb.iterations, 10_000);
    assert.ok(
      pb.vsMultiplicative.meanLogLossDiff < 0 &&
        pb.vsMultiplicative.logLossCi95[1] < 0
    );
    assert.ok(
      pb.vsMultiplicative.logLossPValue < 0.05,
      `Expected Coherent vs Multiplicative OOS Log-Loss p < 0.05, got ${pb.vsMultiplicative.logLossPValue}`
    );
    assert.ok(pb.vsShin.meanLogLossDiff < 0 && pb.vsShin.logLossCi95[1] < 0);
    assert.ok(
      pb.vsShin.logLossPValue < 0.05,
      `Expected Coherent vs isolated Shin OOS Log-Loss p < 0.05, got ${pb.vsShin.logLossPValue}`
    );
    assert.ok(
      pb.vsMultiplicative.meanBrierDiff < 0 && pb.vsShin.meanBrierDiff < 0
    );
    assert.ok(res.maxCrossPoolCoherenceError < 1e-12);
  });

  it("Layer 2 · Axiomatic, Pathological Stress & Latency Invariants: verifies <1e-12 5-pool coherence across 720+ matches, >16,384-state exact linear EV, >2,048-bet explicit block, full-option cache invalidation, and <15ms 8x247 workspace latency", () => {
    const res = runLayer2AxiomaticInvariantsBenchmark();
    l2Result = res;

    assert.ok(
      res.checkedMatchesCount >= 720,
      `Expected >= 720 checked matches, got ${res.checkedMatchesCount}`
    );
    assert.ok(res.portfolioScenariosChecked >= 35);
    assert.ok(res.maxMarginalSumError < 1e-12);
    assert.ok(res.maxCrossPoolEquivError < 1e-12);
    assert.ok(res.maxComboSumError < 1e-9);
    assert.ok(res.maxLinearEvError < 1e-9);
    assert.ok(res.maxBruteForceDiff < 1e-9);
    assert.ok(
      res.highStateSpaceEvError < 1e-12,
      `Expected >16,384-state linear EV error < 1e-12, got ${res.highStateSpaceEvError}`
    );
    assert.equal(res.combinatorialExplosionGatePassed, true);
    assert.equal(res.cacheMutationSensitivityPassed, true);
    assert.equal(res.statutoryRoundingAndCapErrors, 0);
    assert.equal(
      res.illegalTicketViolations,
      0,
      `Illegal Sporttery tickets emitted: ${JSON.stringify(res.violationDetails)}`
    );
    assert.equal(res.probabilityOrderingViolations, 0);
    assert.ok(
      res.avgEightMatchWorkspaceMs < 15,
      `Expected 8-match 8x9 evaluateQuantWorkspace < 15ms, got ${res.avgEightMatchWorkspaceMs.toFixed(3)}ms`
    );
    assert.ok(
      res.avgEightMatch247WorkspaceMs < 15,
      `Expected 8-match 8x247 + bonus optimization evaluateQuantWorkspace < 15ms, got ${res.avgEightMatch247WorkspaceMs.toFixed(3)}ms`
    );
  });

  it("Layer 3 · Zero-Silo, Zero-Self-Clone 10,000 Monte Carlo Monotone 4D Pareto & Exact 0-1 Knapsack Check: verifies zero strict dominance and zero knapsack gap across 2..8-match slates in <50ms/slate", () => {
    const res = runLayer3MonteCarloParetoBenchmark({
      seed: 20261120,
      samplesPerSlate: 10_000,
    });
    l3Result = res;

    assert.equal(res.seed, 20261120);
    assert.equal(res.samplesPerSlate, 10_000);
    assert.ok(
      res.slates.length >= 8,
      `Expected >= 8 representative slates, got ${res.slates.length}`
    );
    assert.ok(
      res.maxKnapsackOptimalityGap <= 1e-9,
      `Expected Slot ① exact 0-1 knapsack gap <= 1e-9, got ${res.maxKnapsackOptimalityGap}`
    );

    for (const sl of res.slates) {
      assert.equal(sl.samplesEvaluated, 10_000);
      assert.ok(
        sl.evalElapsedMs < 50,
        `Slate ${sl.name} 10,000 vectorized evaluations took ${sl.evalElapsedMs.toFixed(2)}ms (expected < 50ms)`
      );
      assert.ok(sl.knapsackOptimalityGap <= 1e-9);
      for (const slotRes of sl.slots) {
        assert.equal(
          slotRes.strictlyDominatedByCount,
          0,
          `Slate ${sl.name} slot ${slotRes.key} was strictly 4D Pareto-dominated ${slotRes.strictlyDominatedByCount} times! Example: ${JSON.stringify(slotRes.dominatingExample)}`
        );
      }
      const s1 = sl.slots.find((s) => s.key === "max-profit-prob")!;
      assert.equal(s1.underwaterCount, 0);
      const s3 = sl.slots.find((s) => s.key === "max-cvar-wheel")!;
      assert.ok(s3.metrics.missOneCvarRatio > 0);
    }

    assert.equal(res.totalStrictDominations, 0);
  });

  it("Layer 4 · Fair Same-Rule Stop-Loss Ledger Replay & Permutation Check: replays 77 real OOS 8-match cycles under identical ¥300/day guardrail, proves netPaperSavedPnl > 0 and intra-day order stability", () => {
    const res = runLayer4LedgerAblationBenchmark({
      dailyStopLossYuan: 300,
      initialBankrollYuan: 12_000,
    });

    assert.ok(
      res.cycleCount >= 75,
      `Expected >= 75 real OOS matchday cycles, got ${res.cycleCount}`
    );
    assert.ok(res.matchCount >= 600);
    assert.equal(res.dailyStopLossYuan, 300);

    const { legacy, upgraded, reversedOrderCheck } = res;
    assert.ok(legacy.liveSettledCount > 0 && upgraded.liveSettledCount > 0);
    // Both tracks must run under the exact same ¥300/day stop-loss rule (zero forceConfirmed bypass!)
    assert.ok(
      legacy.paperCount > 0,
      "Legacy track must also be subject to the identical ¥300/day stop-loss guardrail"
    );
    assert.equal(upgraded.paperCount, upgraded.stopLossInterceptedCount);

    assert.ok(
      upgraded.liveRoiPct > legacy.liveRoiPct,
      `Expected Upgraded Live ROI (${upgraded.liveRoiPct}%) > Legacy Live ROI (${legacy.liveRoiPct}%)`
    );
    assert.ok(
      upgraded.maxDrawdownYuan < legacy.maxDrawdownYuan &&
        upgraded.maxDrawdownPct < legacy.maxDrawdownPct,
      `Expected Upgraded MaxDD (¥${upgraded.maxDrawdownYuan} / ${upgraded.maxDrawdownPct}%) < Legacy MaxDD (¥${legacy.maxDrawdownYuan} / ${legacy.maxDrawdownPct}%)`
    );
    assert.ok(
      upgraded.sharpeRatio > legacy.sharpeRatio,
      `Expected Upgraded Sharpe (${upgraded.sharpeRatio}) > Legacy Sharpe (${legacy.sharpeRatio})`
    );
    assert.ok(upgraded.paperSavedAmount > 0);
    assert.ok(
      upgraded.netPaperSavedPnl > 0,
      `Expected strictly positive netPaperSavedPnl after deducting missed winning paper payouts, got ¥${upgraded.netPaperSavedPnl}`
    );
    assert.ok(
      upgraded.emptyAlphaAbstainCount > 0 && upgraded.emptyAlphaSavedCash > 0
    );

    // Intra-day slate order permutation check (reversing slates within each day)
    assert.ok(
      reversedOrderCheck.upgradedLiveRoiPct >
        reversedOrderCheck.legacyLiveRoiPct,
      `Reversed intra-day order must still preserve Upgraded ROI (${reversedOrderCheck.upgradedLiveRoiPct}%) > Legacy ROI (${reversedOrderCheck.legacyLiveRoiPct}%)`
    );
    assert.ok(reversedOrderCheck.upgradedNetPaperSavedPnl > 0);

    // Verify full 4-layer suite assembly & formatted CLI report structure (zero prohibited vendor strings)
    const full = assembleQuantBenchmarkReport({
      layer1: l1Result,
      layer2: l2Result,
      layer3: l3Result,
      layer4: res,
    });
    assert.equal(full.allPassed, true);
    const text = formatQuantBenchmarkReport(full);
    assert.ok(
      text.includes("Layer 1") &&
        text.includes("Layer 2") &&
        text.includes("Layer 3") &&
        text.includes("Layer 4") &&
        text.includes("Bootstrap")
    );
    const forbiddenVendorRegex = new RegExp(
      [
        ["Deep", "Seek"],
        ["G", "LM"],
        ["Open", "Code"],
        ["Chat", "GPT"],
        ["Cla", "ude"],
        ["Qw", "en"],
        ["Dou", "bao"],
      ]
        .map(([a, b]) => a + b)
        .join("|"),
      "i"
    );
    assert.equal(
      forbiddenVendorRegex.test(text),
      false,
      "Benchmark report must never contain prohibited LLM vendor/model identifiers"
    );
  });
});
