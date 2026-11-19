import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleQuantBenchmarkReport,
  formatQuantBenchmarkReport,
  runLayer1ProperScoringBenchmark,
  runLayer2AxiomaticInvariantsBenchmark,
  runLayer3MonteCarloParetoBenchmark,
  runLayer4LedgerAblationBenchmark,
} from '../scripts/bench-quant.mjs';

describe('Spec 0008 · Ticket 04: Four-Layer Objective Scientific Benchmark Suite', () => {
  let l1Result: ReturnType<typeof runLayer1ProperScoringBenchmark>;
  let l2Result: ReturnType<typeof runLayer2AxiomaticInvariantsBenchmark>;
  let l3Result: ReturnType<typeof runLayer3MonteCarloParetoBenchmark>;

  it('Layer 1 · Proper Scoring Rules: evaluates RPS, Brier Score, Log-Loss, and 10-bin ECE across all 5 pools (HAD, HHAD, TTG, HAFU, CRS) on 96 settled matches and proves Shin + Coherent Dixon-Coles superiority', () => {
    const res = runLayer1ProperScoringBenchmark();
    l1Result = res;

    assert.equal(res.matchCount, 96);
    assert.equal(res.cycleCount, 12);
    assert.deepEqual(Object.keys(res.pools), ['HAD', 'HHAD', 'TTG', 'HAFU', 'CRS']);

    // 1. Macro-aggregate across all 5 pools: Shin + Coherent DC < single-pool Shin < legacy Multiplicative on ALL 4 metrics
    const agg = res.aggregate;
    for (const metric of ['rps', 'brier', 'logLoss', 'ece'] as const) {
      assert.ok(
        agg.coherentShinDc[metric] < agg.shin[metric] &&
          agg.shin[metric] < agg.multiplicative[metric],
        `5-pool aggregate ${metric}: expected coherent (${agg.coherentShinDc[metric]}) < shin (${agg.shin[metric]}) < multiplicative (${agg.multiplicative[metric]})`
      );
    }
    assert.ok(
      agg.coherentShinDc.pooledEce < agg.multiplicative.pooledEce,
      `Global pooled 10-bin ECE: expected coherent (${agg.coherentShinDc.pooledEce}) < multiplicative (${agg.multiplicative.pooledEce})`
    );

    // 2. Across HAD, TTG, HAFU, and CRS, Shin + Coherent DC strictly beats legacy Multiplicative on ALL 4 proper scoring metrics
    for (const poolCode of ['HAD', 'TTG', 'HAFU', 'CRS'] as const) {
      const pm = res.pools[poolCode];
      for (const metric of ['rps', 'brier', 'logLoss', 'ece'] as const) {
        assert.ok(
          pm.coherentShinDc[metric] < pm.multiplicative[metric],
          `${poolCode} ${metric}: expected coherent (${pm.coherentShinDc[metric]}) < multiplicative (${pm.multiplicative[metric]})`
        );
      }
    }

    // 3. On high-vig multi-outcome HAFU (9-way) & CRS (31-way), Coherent DC also strictly beats isolated single-pool Shin on ALL 4 metrics
    for (const highVigPool of ['HAFU', 'CRS'] as const) {
      const pm = res.pools[highVigPool];
      for (const metric of ['rps', 'brier', 'logLoss', 'ece'] as const) {
        assert.ok(
          pm.coherentShinDc[metric] < pm.shin[metric],
          `${highVigPool} ${metric}: expected coherent (${pm.coherentShinDc[metric]}) < isolated Shin (${pm.shin[metric]})`
        );
      }
    }

    // 4. On handicap-equalized HHAD (3-way), Coherent DC improves Log-Loss over Multiplicative while preserving <1e-12 cross-pool coherence
    const hhad = res.pools.HHAD;
    assert.ok(hhad.coherentShinDc.logLoss < hhad.multiplicative.logLoss);
    assert.ok(Math.abs(hhad.coherentShinDc.rps - hhad.multiplicative.rps) < 1e-3);
    assert.ok(res.maxCrossPoolCoherenceError < 1e-12);
  });

  it('Layer 2 · Axiomatic & Joint Distribution Zero-Error Invariants: verifies <1e-12 5-pool coherence, <1e-9 joint state-space & brute-force (ht,ft) invariants across 1..8 matches, 0 statutory rounding/cap/legality errors, and <15ms 8-match workspace latency', () => {
    const res = runLayer2AxiomaticInvariantsBenchmark();
    l2Result = res;

    assert.equal(res.checkedMatchesCount, 104);
    assert.ok(res.portfolioScenariosChecked >= 30);
    assert.ok(
      res.maxMarginalSumError < 1e-12,
      `Expected marginal sum error < 1e-12, got ${res.maxMarginalSumError}`
    );
    assert.ok(
      res.maxCrossPoolEquivError < 1e-12,
      `Expected cross-pool equivalence error < 1e-12, got ${res.maxCrossPoolEquivError}`
    );
    assert.ok(
      res.maxComboSumError < 1e-9,
      `Expected sum(combos.prob) === anyWinProb error < 1e-9, got ${res.maxComboSumError}`
    );
    assert.ok(
      res.maxLinearEvError < 1e-9,
      `Expected expectedValueRate === (E[R]-C)/C error < 1e-9, got ${res.maxLinearEvError}`
    );
    assert.ok(
      res.maxBruteForceDiff < 1e-9,
      `Expected independent (ht,ft) brute-force diff < 1e-9, got ${res.maxBruteForceDiff}`
    );
    assert.equal(res.statutoryRoundingAndCapErrors, 0);
    assert.equal(res.illegalTicketViolations, 0, `Illegal Sporttery tickets emitted: ${JSON.stringify(res.violationDetails)}`);
    assert.equal(res.probabilityOrderingViolations, 0);
    assert.ok(
      res.avgEightMatchWorkspaceMs < 15,
      `Expected 8-match evaluateQuantWorkspace < 15ms, got ${res.avgEightMatchWorkspaceMs.toFixed(3)}ms`
    );
  });

  it('Layer 3 · 10,000 Monte Carlo 4D Unit-Stake Pareto Dominance Check: verifies zero strict dominance across 2/3/4/6-match slates and ¥100/¥200 budgets with deterministic seed 20261119 in <50ms/slate', () => {
    const res = runLayer3MonteCarloParetoBenchmark({ seed: 20261119, samplesPerSlate: 10_000 });
    l3Result = res;

    assert.equal(res.seed, 20261119);
    assert.equal(res.samplesPerSlate, 10_000);
    assert.ok(res.slates.length >= 8, `Expected >= 8 representative slates, got ${res.slates.length}`);

    for (const sl of res.slates) {
      assert.equal(sl.samplesEvaluated, 10_000);
      assert.ok(
        sl.evalElapsedMs < 50,
        `Slate ${sl.name} 10,000 vectorized evaluations took ${sl.evalElapsedMs.toFixed(2)}ms (expected < 50ms)`
      );
      for (const slotRes of sl.slots) {
        assert.equal(
          slotRes.strictlyDominatedByCount,
          0,
          `Slate ${sl.name} slot ${slotRes.key} was strictly 4D Pareto-dominated ${slotRes.strictlyDominatedByCount} times! Example: ${JSON.stringify(slotRes.dominatingExample)}`
        );
      }
      // Slot ① (max-profit-prob) must satisfy coveredFloorRatio >= 0 (100% zero-underwater)
      const s1 = sl.slots.find((s) => s.key === 'max-profit-prob')!;
      assert.ok(s1.metrics.coveredFloorRatio >= -1e-9);
      // Slot ③ (max-cvar-wheel) must achieve strictly positive missOneCvarRatio > 0
      const s3 = sl.slots.find((s) => s.key === 'max-cvar-wheel')!;
      assert.ok(s3.metrics.missOneCvarRatio > 0);
    }

    assert.equal(res.totalStrictDominations, 0);
  });

  it('Layer 4 · Dual-Track Stop-Loss Ledger Paired Ablation Replay & CLI Report: replays 12 settled matchday cycles (96 matches) via createLedgerManager (¥300/day guardrail) and proves ROI, Max Drawdown, Sharpe, and paperSavedAmount gains', () => {
    const res = runLayer4LedgerAblationBenchmark({ dailyStopLossYuan: 300, initialBankrollYuan: 5000 });

    assert.equal(res.cycleCount, 12);
    assert.equal(res.matchCount, 96);
    assert.equal(res.dailyStopLossYuan, 300);

    const { legacy, upgraded } = res;
    assert.ok(legacy.liveSettledCount > 0 && upgraded.liveSettledCount > 0);
    assert.equal(legacy.paperSavedAmount, 0);

    // Strict improvements across all 4 required portfolio & risk-control dimensions
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
    assert.ok(
      upgraded.paperSavedAmount > 0,
      `Expected positive paperSavedAmount from ¥300/day stop-loss & danger routing, got ¥${upgraded.paperSavedAmount}`
    );
    assert.ok(
      upgraded.emptyAlphaAbstainCount > 0 && upgraded.emptyAlphaSavedCash > 0,
      `Expected honest ¥0 empty alpha-radar abstentions on tight-vig slates, got count=${upgraded.emptyAlphaAbstainCount}`
    );

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
      text.includes('Layer 1') &&
        text.includes('Layer 2') &&
        text.includes('Layer 3') &&
        text.includes('Layer 4')
    );
    const forbiddenVendorRegex = new RegExp(
      [
        ['Deep', 'Seek'],
        ['G', 'LM'],
        ['Open', 'Code'],
        ['Chat', 'GPT'],
        ['Cla', 'ude'],
        ['Qw', 'en'],
        ['Dou', 'bao'],
      ]
        .map(([a, b]) => a + b)
        .join('|'),
      'i'
    );
    assert.equal(
      forbiddenVendorRegex.test(text),
      false,
      'Benchmark report must never contain prohibited LLM vendor/model identifiers'
    );
  });
});
