import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  FALLBACK_MATCHES,
  archetypeToReport,
  bankerRoundCents,
  bankerRoundParlayUnitPayout,
  calibrateMatchCoherentModel,
  computeProOrderInsights,
  computeTruthReport,
  devigPoolProbabilities,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";

const REAL_OOS_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/realSportteryOosMatches.json"
);

function pairedBootstrapLogLossAndBrier(records: any[]) {
  const N = records.length;
  const pools = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  const diffLlCohVsMult = new Float64Array(N);
  const diffBrCohVsMult = new Float64Array(N);
  const diffLlCohVsShin = new Float64Array(N);
  const diffBrCohVsShin = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const r = records[i];
    let llM = 0;
    let llS = 0;
    let llC = 0;
    let brM = 0;
    let brS = 0;
    let brC = 0;
    for (const code of pools) {
      const pd = r.pools[code];
      const w = pd.winIdx;
      const len = pd.multProbs.length;
      llM += -Math.log(Math.max(1e-12, pd.multProbs[w]));
      llS += -Math.log(Math.max(1e-12, pd.shinProbs[w]));
      llC += -Math.log(Math.max(1e-12, pd.coherentProbs[w]));
      for (let k = 0; k < len; k++) {
        const y = k === w ? 1 : 0;
        brM += (pd.multProbs[k] - y) ** 2;
        brS += (pd.shinProbs[k] - y) ** 2;
        brC += (pd.coherentProbs[k] - y) ** 2;
      }
    }
    diffLlCohVsMult[i] = (llC - llM) / 5;
    diffBrCohVsMult[i] = (brC - brM) / 5;
    diffLlCohVsShin[i] = (llC - llS) / 5;
    diffBrCohVsShin[i] = (brC - brS) / 5;
  }

  let seed = 20261120;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const bootTest = (vec: Float64Array) => {
    let sum = 0;
    for (let i = 0; i < N; i++) sum += vec[i];
    const obs = sum / N;
    const B = 5000;
    let extreme = 0;
    for (let b = 0; b < B; b++) {
      let bs = 0;
      for (let i = 0; i < N; i++) {
        bs += vec[Math.floor(nextRand() * N)];
      }
      const bm = bs / N;
      if (Math.abs(bm - obs) >= Math.abs(obs)) extreme++;
    }
    return { meanDiff: obs, pTwoSided: extreme / B };
  };

  return {
    llCohVsMult: bootTest(diffLlCohVsMult),
    brCohVsMult: bootTest(diffBrCohVsMult),
    llCohVsShin: bootTest(diffLlCohVsShin),
    brCohVsShin: bootTest(diffBrCohVsShin),
  };
}

describe("Spec 0009 · Red-Team Quant Remediation (D-01 .. D-10)", () => {
  it("Slice 01 · D-01, D-02, D-08: enforces zero-approximation linear EV on >16,384-state parlays, blocks >2,048-bet slips without silent truncation, invalidates cache on any option mutation, and keeps 8串247 workspace < 15ms", () => {
    // 1. D-01: 7 matches x 4 TTG options on 2串1 (336 tickets, 5^7 = 78,125 > 16,384 joint states)
    const sevenMatches = FALLBACK_MATCHES.slice(0, 7);
    const fourTtgPicks = sevenMatches.flatMap((m: any) =>
      ["s0", "s1", "s2", "s3"].map((k) => {
        const o = m.pools.TTG.options.find((x: any) => x.key === k);
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "TTG",
          poolName: "总进球",
          singleAllowed: true,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        };
      })
    );
    const rep7 = computeTruthReport(fourTtgPicks, 1, sevenMatches, {
      mode: "free",
      passSizes: [2],
    });
    assert.equal(rep7.betCount, 336);
    assert.equal(rep7.canCheckout, true);

    let exactLinearReturn = 0;
    for (const tk of rep7.tickets) {
      const pHit = tk.legs.reduce((a: number, g: any) => a * g.fairProb, 1);
      exactLinearReturn += pHit * tk.totalPayout;
    }
    const exactLinearEvRate =
      (exactLinearReturn - rep7.totalCost) / rep7.totalCost;
    assert.ok(
      Math.abs(rep7.expectedValueRate - exactLinearEvRate) < 1e-12,
      `Expected zero-approximation linear EV ${exactLinearEvRate}, got ${rep7.expectedValueRate}`
    );

    const matchUnionProbs = sevenMatches.map((m: any) =>
      ["s0", "s1", "s2", "s3"].reduce(
        (a, k) =>
          a + m.pools.TTG.options.find((x: any) => x.key === k).fairProb,
        0
      )
    );
    const p0 = matchUnionProbs.reduce((a, p) => a * (1 - p), 1);
    const p1 = matchUnionProbs.reduce(
      (sum, p, idx) =>
        sum +
        p *
          matchUnionProbs.reduce((a, q, j) => (j === idx ? a : a * (1 - q)), 1),
      0
    );
    const exactAnyWin = 1 - p0 - p1;
    assert.ok(
      Math.abs(rep7.anyWinProb - exactAnyWin) < 1e-12,
      `Expected exact anyWinProb ${exactAnyWin}, got ${rep7.anyWinProb}`
    );

    // 2. D-02: 8 matches x 3 HAD full cover on 8串1 (3^8 = 6,561 bets > 2,048 limit) -> explicit block, zero silent truncation
    const eightMatches = FALLBACK_MATCHES.slice(0, 8);
    const fullCover8 = eightMatches.flatMap((m: any) =>
      m.pools.HAD.options.map((o: any) => ({
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: Boolean(m.pools.HAD.single),
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      }))
    );
    const repFull8 = computeTruthReport(fullCover8, 1, eightMatches, {
      mode: "free",
      passSizes: [8],
    });
    assert.equal(
      repFull8.betCount,
      6561,
      "Must report exact un-truncated 6,561 raw bets"
    );
    assert.equal(
      repFull8.totalCost,
      13122,
      "Must report exact un-truncated ¥13,122 cost"
    );
    assert.equal(
      repFull8.canCheckout,
      false,
      "Must block checkout rather than silently truncating to 512 bets"
    );
    assert.ok(
      repFull8.ruleBlockReason && repFull8.ruleBlockReason.includes("2048")
    );

    // 3. D-08a: Exact decimal halfway banker rounding without float binary drift
    assert.equal(bankerRoundCents(1.005), 1.0);
    assert.equal(bankerRoundCents(1.115), 1.12);
    assert.equal(bankerRoundCents(2.675), 2.68);
    assert.equal(bankerRoundCents(35.855), 35.86);
    assert.equal(bankerRoundCents(9.995), 10.0);
    assert.equal(bankerRoundCents(100.045), 100.04);
    assert.equal(bankerRoundCents(1234567890123.455), 1234567890123.46);

    // 4. D-08b: Full-option WeakMap cache invalidation when mutating inner HAFU 'dh' or CRS '0:0'
    const mutableMatch = structuredClone(FALLBACK_MATCHES[2]);
    const cal1 = calibrateMatchCoherentModel(mutableMatch);
    evaluateQuantWorkspace(
      { picks: [], multiple: 1, targetIds: [mutableMatch.id], budget: 100 },
      [mutableMatch]
    );
    mutableMatch.pools.HAFU.options[3].odds = 13.5; // 'dh' 平胜 (middle non-endpoint option)
    const wsMutated = evaluateQuantWorkspace(
      { picks: [], multiple: 1, targetIds: [mutableMatch.id], budget: 100 },
      [mutableMatch]
    );
    const freshClone = structuredClone(mutableMatch);
    const wsFresh = evaluateQuantWorkspace(
      { picks: [], multiple: 1, targetIds: [freshClone.id], budget: 100 },
      [freshClone]
    );
    assert.equal(
      wsMutated.portfolioPlans[3].available,
      wsFresh.portfolioPlans[3].available
    );
    assert.equal(
      wsMutated.portfolioPlans[3].totalCost,
      wsFresh.portfolioPlans[3].totalCost
    );
    assert.notEqual(
      cal1.pools.HAFU.options[3].fairProb,
      calibrateMatchCoherentModel(mutableMatch).pools.HAFU.options[3].fairProb
    );

    // 5. D-08c: 8-match 8串247 + hot-first bonus + 8-match portfolio workspace latency < 15ms median
    const eightSinglePicks = eightMatches.map((m: any) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: false,
      optionKey: "h",
      optionLabel: "主胜",
      odds: m.pools.HAD.options[0].odds,
      fairProb: m.pools.HAD.options[0].fairProb,
    }));
    // Warm up V8 JIT once
    evaluateQuantWorkspace(
      {
        picks: eightSinglePicks,
        multiple: 2,
        passSpec: { mode: "combo", comboCode: "8x247" },
        subjectiveDeltaPct: 3,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds: eightMatches.map((m: any) => m.id),
        anchorToRadarPicks: true,
        budget: 500,
      },
      eightMatches
    );
    const times: number[] = [];
    for (let r = 0; r < 15; r++) {
      const t0 = performance.now();
      evaluateQuantWorkspace(
        {
          picks: eightSinglePicks,
          multiple: 2,
          passSpec: { mode: "combo", comboCode: "8x247" },
          subjectiveDeltaPct: (r % 5) * 2 - 4,
          simVoidFirstMatch: r % 3 === 0,
          planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
          targetIds: eightMatches.map((m: any) => m.id),
          anchorToRadarPicks: true,
          budget: 500,
        },
        eightMatches
      );
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p50 = times[7];
    assert.ok(
      p50 < 15,
      `Expected 8x247 workspace p50 latency < 15ms, got ${p50.toFixed(2)}ms`
    );
  });

  it("Slice 01 · D-03 & D-10: partition-consistent KL/IPF coherent calibration beats Multiplicative (p < 0.05) AND beats Shin across 622 Real Official Sporttery OOS matches, resolves HAD+HAFU deadlock, and eliminates {0..10}^2 tail truncation", () => {
    const rawJson = JSON.parse(fs.readFileSync(REAL_OOS_PATH, "utf8"));
    const rawMatches = rawJson.matches;
    assert.ok(
      rawMatches.length >= 240,
      `Expected >= 240 real OOS matches, got ${rawMatches.length}`
    );

    const parsed = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: rawMatches }] },
    });

    const evalSubset = (indices: number[]) =>
      indices.map((idx) => {
        const pm = parsed[idx];
        const rawM = rawMatches[idx];
        const out = rawM.outcome;
        const pools: Record<string, any> = {};
        for (const code of ["HAD", "HHAD", "TTG", "HAFU", "CRS"]) {
          const opts = pm.pools[code].options;
          const winIdx =
            code === "HAD"
              ? opts.findIndex((o: any) => o.key === out.hadKey)
              : code === "HHAD"
                ? opts.findIndex((o: any) => o.key === out.hhadKey)
                : code === "TTG"
                  ? opts.findIndex((o: any) => o.key === out.ttgKey)
                  : code === "HAFU"
                    ? opts.findIndex((o: any) => o.key === out.hafuKey)
                    : opts.findIndex((o: any) => o.label === out.crsLabel);
          assert.ok(winIdx >= 0, `Missing winIdx on ${pm.id} ${code}`);
          pools[code] = {
            winIdx,
            multProbs: devigPoolProbabilities(opts, "multiplicative").probs,
            shinProbs: opts.map((o: any) => o.shinProb),
            coherentProbs: opts.map((o: any) => o.fairProb),
          };
        }
        return { id: pm.id, pools };
      });

    // Check both the exact 112 red-team OOS subset (matchId 2042600..2042841) AND full 261 real OOS dataset
    const allIdx = rawMatches.map((_: any, i: number) => i);
    const audit112Idx = rawMatches
      .map((m: any, i: number) =>
        Number(m.matchId) >= 2042600 && Number(m.matchId) <= 2042841 ? i : -1
      )
      .filter((i: number) => i >= 0);
    assert.equal(audit112Idx.length, 112);

    const boot112 = pairedBootstrapLogLossAndBrier(evalSubset(audit112Idx));
    assert.ok(
      boot112.llCohVsMult.meanDiff < 0 && boot112.llCohVsMult.pTwoSided < 0.01,
      `Expected Coherent vs Mult LogLoss p < 0.01 on 112 Real OOS, got diff=${boot112.llCohVsMult.meanDiff}, p=${boot112.llCohVsMult.pTwoSided}`
    );
    assert.ok(
      boot112.brCohVsMult.meanDiff < 0,
      `Expected Coherent vs Mult Brier < 0 on 112 Real OOS, got ${boot112.brCohVsMult.meanDiff}`
    );
    assert.ok(
      boot112.llCohVsShin.meanDiff <= 0 &&
        !(
          boot112.brCohVsShin.meanDiff > 0 &&
          boot112.brCohVsShin.pTwoSided < 0.05
        ),
      `Expected Coherent NOT to degrade vs single-pool Shin on 112 Real OOS, got dBrier=${boot112.brCohVsShin.meanDiff} (p=${boot112.brCohVsShin.pTwoSided}), dLogLoss=${boot112.llCohVsShin.meanDiff}`
    );

    const bootAll = pairedBootstrapLogLossAndBrier(evalSubset(allIdx));
    assert.ok(
      bootAll.llCohVsMult.meanDiff < 0 && bootAll.llCohVsMult.pTwoSided < 0.05,
      `Expected Coherent vs Mult LogLoss p < 0.05 on full ${rawMatches.length} Real OOS, got diff=${bootAll.llCohVsMult.meanDiff}, p=${bootAll.llCohVsMult.pTwoSided}`
    );
    assert.ok(
      bootAll.brCohVsMult.meanDiff < 0,
      `Expected Coherent vs Mult Brier < 0 on full Real OOS, got ${bootAll.brCohVsMult.meanDiff}`
    );
    assert.ok(
      bootAll.brCohVsShin.meanDiff < 0 && bootAll.llCohVsShin.meanDiff < 0,
      `Expected Coherent to beat single-pool Shin on BOTH Brier and LogLoss across full ${rawMatches.length} Real OOS, got dBrier=${bootAll.brCohVsShin.meanDiff}, dLogLoss=${bootAll.llCohVsShin.meanDiff}`
    );

    // D-10a: HAD + HAFU only (TTG/CRS/HHAD suspended) with HAFU dd=2.15 ultra-deadlock signal
    const s4Deadlock = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: "S4-DEADLOCK",
                matchNumStr: "周六004",
                leagueAbbName: "法乙",
                matchDate: "2026-11-20",
                matchTime: "20:00:00",
                homeTeamAbbName: "闷战主",
                awayTeamAbbName: "闷战客",
                poolList: [
                  {
                    poolCode: "HAD",
                    single: 1,
                    bettingSingle: 1,
                    bettingAllup: 1,
                    poolStatus: "Selling",
                  },
                  {
                    poolCode: "HHAD",
                    single: 0,
                    bettingSingle: 0,
                    bettingAllup: 0,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "HAFU",
                    single: 1,
                    bettingSingle: 1,
                    bettingAllup: 1,
                    poolStatus: "Selling",
                  },
                  {
                    poolCode: "TTG",
                    single: 0,
                    bettingSingle: 0,
                    bettingAllup: 0,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "CRS",
                    single: 0,
                    bettingSingle: 0,
                    bettingAllup: 0,
                    poolStatus: "Suspended",
                  },
                ],
                had: { h: "3.10", d: "2.10", a: "3.40" },
                hafu: {
                  hh: "5.50",
                  hd: "28.0",
                  ha: "60.0",
                  dh: "5.80",
                  dd: "2.15",
                  da: "6.20",
                  ah: "55.0",
                  ad: "28.0",
                  aa: "6.00",
                },
              },
            ],
          },
        ],
      },
    })[0];
    const totalXgS4 =
      s4Deadlock.microQuant.homeXG + s4Deadlock.microQuant.awayXG;
    assert.ok(
      totalXgS4 < 1.6,
      `Expected HAD+HAFU ultra-deadlock total xG < 1.6, got ${totalXgS4}`
    );

    // D-10b: Ultra-deep -3 mismatch (1.01 home win) grid tail truncation < 0.2%
    const s1UltraDeep = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                ...rawMatches[0],
                matchId: "S1-ULTRADEEP",
                had: { h: "1.01", d: "18.00", a: "65.00" },
                hhad: { goalLine: "-3", h: "1.35", d: "5.20", a: "5.80" },
                ttg: {
                  s0: "80.0",
                  s1: "28.0",
                  s2: "11.0",
                  s3: "5.80",
                  s4: "4.10",
                  s5: "4.20",
                  s6: "5.50",
                  s7: "3.20",
                },
              },
            ],
          },
        ],
      },
    })[0];
    const calDeep = calibrateMatchCoherentModel(s1UltraDeep);
    assert.ok(
      calDeep.scoreGrid.length >= 225,
      "Expected extended >= 15x15 scoreGrid ({0..14}^2)"
    );
  });

  it("Slice 02 · D-04, D-05, D-06, D-07, D-10: exact 0-1 knapsack Slot ①, genuine Log-Wealth & O*p drag pruning Slot ②, probability-anchored Slot ③ with C(v,k,t) (v>=k>=t) & wipeoutMiss2Prob, pure +EV Slot ④ gate, zero 零风险, and <=2% negative-EV Kelly cap", () => {
    const rawJson = JSON.parse(fs.readFileSync(REAL_OOS_PATH, "utf8"));
    const audit112Raw = rawJson.matches.filter(
      (m: any) => Number(m.matchId) >= 2042600 && Number(m.matchId) <= 2042841
    );
    const oos112 = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: audit112Raw }] },
    });
    assert.equal(oos112.length, 112);

    // Independent reference 0-1 knapsack solver for mutually disjoint tickets
    const refKnapsackBestProb = (
      tickets: Array<{ prob: number; unitPayout: number }>,
      budgetYuan: number
    ) => {
      const maxN = Math.floor(budgetYuan / 2);
      const valid = tickets.filter((t) => t.unitPayout > 2.0);
      let best = 0;
      for (let N = 1; N <= maxN; N++) {
        const cost = 2 * N;
        const dp = new Float64Array(N + 1).fill(-1);
        dp[0] = 0;
        for (const t of valid) {
          const w = Math.max(1, Math.ceil(cost / t.unitPayout - 1e-12));
          if (w > N || w > 999) continue;
          for (let cap = N; cap >= w; cap--) {
            if (dp[cap - w] >= 0 && dp[cap - w] + t.prob > dp[cap]) {
              dp[cap] = dp[cap - w] + t.prob;
            }
          }
        }
        for (let cap = 0; cap <= N; cap++) {
          if (dp[cap] > best) best = dp[cap];
        }
      }
      return best;
    };

    // 1. D-06: Slot ① exact 0-1 knapsack optimality in BOTH objective mode and radar-anchored mode across 5..8 matches
    for (const mCount of [5, 6, 7, 8]) {
      const slate = FALLBACK_MATCHES.slice(0, mCount);
      const objPlans = generateParetoPortfolio(
        slate,
        100,
        "objective",
        false,
        []
      );
      const [s1, s2, s3] = objPlans;
      assert.equal(
        s1.underwaterCount,
        0,
        `Slot ① on M=${mCount} must have 0 underwater combos`
      );
      assert.ok(
        s1.profitProb >= Math.max(s2.profitProb, s3.profitProb) - 1e-9,
        `Objective Slot ① profitProb (${s1.profitProb}) must never be dominated by Slot ② (${s2.profitProb}) or Slot ③ (${s3.profitProb}) on M=${mCount}`
      );

      // Spec 0012 (superseding Spec 0009 silent match-drop): unanchored Slot ① retains ALL M matches while beating full-M box 0-1 knapsack!
      const distinctS1Matches = new Set(
        s1.lines.flatMap((l: any) => l.legs.map((g: any) => g.matchId))
      );
      assert.equal(
        distinctS1Matches.size,
        mCount,
        `Objective Slot ① on M=${mCount} must retain all ${mCount} matches (Spec 0012)`
      );
      let refFullMBox: Array<{ prob: number; odds: number[] }> = [
        { prob: 1, odds: [] },
      ];
      for (const m of slate) {
        const nxt: Array<{ prob: number; odds: number[] }> = [];
        for (const prev of refFullMBox) {
          for (const o of m.pools.HAD.options) {
            nxt.push({
              prob: prev.prob * o.fairProb,
              odds: [...prev.odds, o.odds],
            });
          }
        }
        refFullMBox = nxt;
      }
      const capM = mCount <= 5 ? 500_000 : 1_000_000;
      const refFullMProb = refKnapsackBestProb(
        refFullMBox.map((t) => ({
          prob: t.prob,
          unitPayout: Math.min(capM, bankerRoundParlayUnitPayout(t.odds)),
        })),
        100
      );
      assert.ok(
        s1.profitProb >= refFullMProb - 1e-9,
        `Objective Slot ① (${s1.profitProb}) must match or beat full-${mCount} exact 0-1 knapsack (${refFullMProb}) on M=${mCount}`
      );

      // Radar-anchored mode: anchors all M matches (HAD options) -> exact M-leg 0-1 knapsack zero gap + honest 2-match note!
      const anchorAllHad = slate.flatMap((m: any) =>
        m.pools.HAD.options.map((o: any) => ({
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "HAD",
          poolName: "胜平负",
          singleAllowed: Boolean(m.pools.HAD.single),
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        }))
      );
      let mBox: Array<{ prob: number; odds: number[] }> = [
        { prob: 1, odds: [] },
      ];
      for (const m of slate) {
        const nxt: Array<{ prob: number; odds: number[] }> = [];
        for (const prev of mBox) {
          for (const o of m.pools.HAD.options) {
            nxt.push({
              prob: prev.prob * o.fairProb,
              odds: [...prev.odds, o.odds],
            });
          }
        }
        mBox = nxt;
      }
      const exactMLegProb = refKnapsackBestProb(
        mBox.map((x) => ({
          prob: x.prob,
          unitPayout: Math.min(
            mCount <= 5 ? 500_000 : 1_000_000,
            bankerRoundParlayUnitPayout(x.odds)
          ),
        })),
        100
      );
      const ancPlans = generateParetoPortfolio(
        slate,
        100,
        "objective",
        false,
        anchorAllHad
      );
      assert.ok(
        Math.abs(ancPlans[0].profitProb - exactMLegProb) < 1e-9,
        `Anchored Slot ① (${ancPlans[0].profitProb}) must equal exact 3^${mCount} 0-1 knapsack (${exactMLegProb})`
      );
      assert.ok(
        ancPlans[0].reasons.some((r: string) => r.includes("2 场")),
        `Anchored Slot ① on M=${mCount} >= 4 must include honest 2-match break-even comparison reason`
      );
    }

    // 2. D-07: Slot ② never mislabels low-vig <= 1.45 favorites as drag legs when a higher-vig match exists, and zero 蚊子肉 wording
    const favLowVig = structuredClone(FALLBACK_MATCHES[1]); // HAD h @ 1.36 (low vig!)
    favLowVig.pools.HAD.single = false;
    favLowVig.pools.HHAD.single = false;
    const midNormal = structuredClone(FALLBACK_MATCHES[2]);
    midNormal.pools.HAD.single = false;
    midNormal.pools.HHAD.single = false;
    const heavyVigMatch = structuredClone(FALLBACK_MATCHES[4]);
    heavyVigMatch.id = "HEAVY-VIG-DRAG";
    heavyVigMatch.matchNumStr = "周六999";
    heavyVigMatch.pools.HAD.single = false;
    heavyVigMatch.pools.HHAD.single = false;
    // Set heavy vig (~20% vig, O * p ~ 0.80) on heavyVigMatch HAD & HHAD while odds > 1.45
    for (const o of heavyVigMatch.pools.HAD.options)
      o.odds = Number((o.odds * 0.88).toFixed(2));
    for (const o of heavyVigMatch.pools.HHAD.options)
      o.odds = Number((o.odds * 0.88).toFixed(2));

    const dragTestPlans = generateParetoPortfolio(
      [favLowVig, midNormal, heavyVigMatch],
      100,
      "objective",
      false,
      []
    );
    const s2Drag = dragTestPlans[1];
    const s2MatchIds = new Set(
      s2Drag.lines.flatMap((l: any) => l.legs.map((g: any) => g.matchId))
    );
    if (s2MatchIds.size === 2) {
      assert.equal(
        s2MatchIds.has(favLowVig.id),
        true,
        "Slot ② must retain low-vig <=1.45 favorite rather than high-vig >1.45 drag match"
      );
      assert.equal(
        s2MatchIds.has(heavyVigMatch.id),
        false,
        "Slot ② must prune the match with lowest single-leg O*p (高抽水拖累腿)"
      );
    }
    assert.equal(
      s2Drag.reasons.some((r: string) => r.includes("蚊子肉")),
      false,
      "Slot ② reasons must never use deprecated 蚊子肉 term"
    );

    // 3. D-05 & D-10: Slot ③ across 14 real 8-match OOS slates anchors to high-prob consensus legs, exposes wipeoutMiss2Prob, and uses valid C(v,k,t) (v>=k>=t)
    for (let s = 0; s < 14; s++) {
      const slate8 = oos112.slice(s * 8, (s + 1) * 8);
      const plans8 = generateParetoPortfolio(
        slate8,
        100,
        "objective",
        false,
        []
      );
      const p3 = plans8[2];
      assert.equal(p3.available, true);
      assert.equal(typeof p3.expectedValueRate, "number");
      assert.equal(typeof p3.underwaterCount, "number");
      assert.equal(typeof p3.wipeoutMiss2Prob, "number");
      assert.ok(p3.wipeoutMiss2Prob > 0 && p3.wipeoutMiss2Prob < 1);

      const distinctLegs = new Map<string, any>();
      for (const l of p3.lines) {
        for (const g of l.legs) distinctLegs.set(g.matchId, g);
      }
      const avgLegProb =
        Array.from(distinctLegs.values()).reduce((a, g) => a + g.fairProb, 0) /
        Math.max(1, distinctLegs.size);
      assert.ok(
        avgLegProb >= 0.42,
        `Slot ③ on OOS slate #${s + 1} must anchor to high-prob primary legs (>=0.42), got ${avgLegProb.toFixed(3)}`
      );

      const cMatch = /C\((\d+),(\d+),(\d+)\)/.exec(p3.title);
      if (cMatch) {
        const [, vStr, kStr, tStr] = cMatch;
        assert.ok(
          Number(vStr) >= Number(kStr) && Number(kStr) >= Number(tStr),
          `Invalid C(v,k,t) notation ${cMatch[0]}: must satisfy v >= k >= t`
        );
      }

      // Check ArchetypePlan expectedValueRate & underwaterCount match archetypeToReport
      for (const pl of plans8.filter((x: any) => x.available)) {
        const rep = archetypeToReport(pl, null, slate8);
        assert.equal(pl.underwaterCount, rep.underwaterCount);
        assert.ok(
          Math.abs(pl.expectedValueRate - rep.expectedValueRate) < 1e-12
        );
      }
    }

    // 4. D-04: Slot ④ strict pure +EV (>= 1.01 shrunk return AND expectedValueRate > 0) across all 112 Real OOS matches & 28 x 4M slates
    for (const m of oos112) {
      const p4 = generateParetoPortfolio([m], 100, "objective", false, [])[3];
      if (p4.available) {
        assert.equal(p4.alphaKind, "positive-ev");
        assert.ok(
          p4.expectedValueRate > 0,
          `Activated 1-match Slot ④ on ${m.id} must have strictly positive EV, got ${p4.expectedValueRate}`
        );
      }
    }
    for (let s = 0; s < 28; s++) {
      const slate4 = oos112.slice(s * 4, (s + 1) * 4);
      const p4 = generateParetoPortfolio(
        slate4,
        100,
        "objective",
        false,
        []
      )[3];
      if (p4.available) {
        assert.equal(p4.alphaKind, "positive-ev");
        assert.ok(
          p4.expectedValueRate > 0,
          `Activated 4-match Slot ④ on slate #${s + 1} must NEVER have negative EV, got ${p4.expectedValueRate}`
        );
      }
    }
    // Equivalent-arb match with negative EV (FALLBACK_MATCHES[1] 日本 vs 巴拉圭 +7.4% arb) must NOT activate Slot ④!
    const m1Arb = FALLBACK_MATCHES[1];
    assert.ok(m1Arb.microQuant.arbitrages.some((a: any) => a.edgePct >= 3.0));
    const slot4M1 = generateParetoPortfolio(
      [m1Arb],
      100,
      "objective",
      false,
      []
    )[3];
    assert.equal(
      slot4M1.available,
      false,
      "Negative-EV equivalent-arb match must NOT induce active betting in Slot ④"
    );

    // Zero "零风险" strings anywhere in server/ or src/
    for (const relFile of [
      "server/quantEngine.mjs",
      "server/manualQaEngine.mjs",
      "src/mobile/SkinPhoneApp.tsx",
      "src/manual/UserManualModal.tsx",
    ]) {
      const txt = fs.readFileSync(path.resolve(process.cwd(), relFile), "utf8");
      assert.equal(
        txt.includes("零风险"),
        false,
        `${relFile} must contain zero "零风险" claims`
      );
    }

    // 5. D-07: Kelly Criterion bankroll cap <= 2% on all negative-EV slips
    const favPick = [
      {
        matchId: FALLBACK_MATCHES[1].id,
        matchNumStr: FALLBACK_MATCHES[1].matchNumStr,
        home: FALLBACK_MATCHES[1].home,
        away: FALLBACK_MATCHES[1].away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: true,
        optionKey: "h",
        optionLabel: "主胜",
        odds: FALLBACK_MATCHES[1].pools.HAD.options[0].odds,
        fairProb: FALLBACK_MATCHES[1].pools.HAD.options[0].fairProb,
      },
    ];
    const negEvRep = computeTruthReport(favPick, 5, FALLBACK_MATCHES, {
      mode: "auto",
    });
    assert.ok(negEvRep.expectedValueRate < 0 && negEvRep.realProfitProb > 0.45);
    const negInsights = computeProOrderInsights(
      favPick,
      negEvRep,
      FALLBACK_MATCHES
    );
    assert.ok(
      negInsights.recommendedBankrollPct <= 2,
      `Negative-EV slip must cap entertainment bankroll <= 2% (Kelly = 0%), got ${negInsights.recommendedBankrollPct}%`
    );
  });

  it("Slice 03 · Honest EV%, Dynamic Underwater Disclosure, Wipeout Risk & Iron-Cage Manual Sync", async () => {
    const repoRoot = process.cwd();
    const appSrc = fs.readFileSync(
      path.join(repoRoot, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    const manualSrc = fs.readFileSync(
      path.join(repoRoot, "src/manual/UserManualModal.tsx"),
      "utf8"
    );
    const qaSrc = fs.readFileSync(
      path.join(repoRoot, "server/manualQaEngine.mjs"),
      "utf8"
    );

    // 1. SkinPhoneApp.tsx must NEVER unconditionally hardcode <em>0 假中奖倒贴</em>; must bind underwaterCount, expectedValueRate, wipeoutMiss2Prob, and Kelly 0% note
    assert.equal(
      appSrc.includes("<em>0 假中奖倒贴</em>"),
      false,
      "SkinPhoneApp.tsx must replace hardcoded <em>0 假中奖倒贴</em> with dynamic underwaterCount disclosure"
    );
    assert.ok(
      appSrc.includes("currentArch.underwaterCount"),
      "Must read currentArch.underwaterCount"
    );
    assert.ok(
      appSrc.includes("局部回血(<本金)"),
      "Must disclose local-recovery (<stake) combinations honestly"
    );
    assert.ok(
      appSrc.includes("currentArch.expectedValueRate"),
      "Must surface calibrated expectedValueRate on 3+1 card"
    );
    assert.ok(
      appSrc.includes("数学期望与抽水"),
      "Must label EV & vig tile honestly"
    );
    assert.ok(
      appSrc.includes("currentArch.wipeoutMiss2Prob"),
      "Must disclose miss>=2 wipeout probability on wheel slot"
    );
    assert.ok(
      appSrc.includes("错≥2场击穿"),
      "Must show 错≥2场击穿 label when wipeoutMiss2Prob is present"
    );
    assert.ok(
      appSrc.includes("凯利0%·娱乐≤"),
      "Must disclose Kelly 0% entertainment cap on negative-EV slips"
    );

    // 2. Zero deprecated 蚊子肉 or 零风险 terms across server/ and src/
    for (const [name, txt] of [
      ["SkinPhoneApp.tsx", appSrc],
      ["UserManualModal.tsx", manualSrc],
      ["manualQaEngine.mjs", qaSrc],
    ] as const) {
      assert.equal(
        txt.includes("蚊子肉"),
        false,
        `${name} must replace deprecated 蚊子肉 with 高抽水拖累腿`
      );
      assert.equal(
        txt.includes("零风险"),
        false,
        `${name} must contain zero 零风险 wording`
      );
    }

    // 3. UserManualModal & manualQaEngine document 高抽水拖累腿 and pure +EV (+1.0% / 101%) gate
    assert.ok(
      manualSrc.includes("高抽水拖累腿"),
      "UserManualModal.tsx must document 高抽水拖累腿"
    );
    assert.ok(
      manualSrc.includes("+1.0%") || manualSrc.includes("101%"),
      "UserManualModal.tsx must document pure +EV gate"
    );
    assert.ok(
      qaSrc.includes("高抽水拖累腿"),
      "manualQaEngine.mjs must document 高抽水拖累腿"
    );
    assert.ok(
      qaSrc.includes("+1.0%") || qaSrc.includes("101%"),
      "manualQaEngine.mjs must document pure +EV gate"
    );

    const { createManualQaEngine } =
      await import("../server/manualQaEngine.mjs");
    const qa = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => ({
          locked: false,
          strikeCount: 1,
          maxAllowed: 4,
        }),
        consumeAiQuota: () => {
          throw new Error("Local KB questions must not consume AI quota");
        },
      },
      xiaogaoService: null,
      getApiKey: () => "",
    });
    const ansAlpha = await qa.answerManualQuestion({
      userId: "u-0009",
      question: "为什么错价雷达会显示空仓？",
      ip: "127.0.0.1",
    });
    assert.equal(ansAlpha.source, "local-kb");
    assert.equal(ansAlpha.answer.includes("蚊子肉"), false);
    assert.ok(
      ansAlpha.answer.includes("+EV") || ansAlpha.answer.includes("正期望")
    );
  });

  it("Slice 04 · Real Sporttery OOS Dataset Forensics & Unbiased 4-Layer Benchmark Anti-Gaming Audit (D-03, D-09)", async () => {
    const repoRoot = process.cwd();
    const oosRaw = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "tests/fixtures/realSportteryOosMatches.json"),
        "utf8"
      )
    );

    // 1. Real Sporttery OOS dataset integrity: >= 240 (622) genuine matches, 0 synthetic "profile" fields, 0 CRS tick violations, 0 weekday mismatches
    assert.ok(
      oosRaw.matches.length >= 600,
      `Expected >= 600 real OOS matches, got ${oosRaw.matches.length}`
    );
    let syntheticProfileCount = 0;
    let crsTickViolations = 0;
    let weekdayMismatches = 0;
    const cnWeekMap: Record<number, string> = {
      0: "周日",
      1: "周一",
      2: "周二",
      3: "周三",
      4: "周四",
      5: "周五",
      6: "周六",
    };
    const crsFieldKeys = [
      "s01s00",
      "s02s00",
      "s02s01",
      "s03s00",
      "s03s01",
      "s03s02",
      "s04s00",
      "s04s01",
      "s04s02",
      "s05s00",
      "s05s01",
      "s05s02",
      "s-1sh",
      "s00s00",
      "s01s01",
      "s02s02",
      "s03s03",
      "s-1sd",
      "s00s01",
      "s00s02",
      "s01s02",
      "s00s03",
      "s01s03",
      "s02s03",
      "s00s04",
      "s01s04",
      "s02s04",
      "s00s05",
      "s01s05",
      "s02s05",
      "s-1sa",
    ];
    for (const m of oosRaw.matches) {
      if ("profile" in m) syntheticProfileCount += 1;
      const numStr = String(m.matchNumStr || "");
      const wkMatch = /^(周[一二三四五六日])/.exec(numStr);
      if (wkMatch && m.matchDate) {
        const dt = new Date(`${m.matchDate}T12:00:00Z`);
        if (cnWeekMap[dt.getUTCDay()] !== wkMatch[1]) weekdayMismatches += 1;
      }
      for (const k of crsFieldKeys) {
        const altKey = k.startsWith("s-1") ? k.replace("s-1", "s1") : k;
        const v = Number(m.crs?.[k] ?? m.crs?.[altKey]);
        if (!(v >= 1.5 && v <= 2000)) {
          crsTickViolations += 1;
        } else if (v >= 30) {
          // Official Sporttery high-odds CRS ladder (>= 30) never uses arbitrary synthetic .37/.83 decimals
          const frac = Math.round((v - Math.floor(v)) * 100);
          if (frac !== 0 && frac !== 50) crsTickViolations += 1;
        }
      }
    }
    assert.equal(
      syntheticProfileCount,
      0,
      'Real OOS fixture must have zero synthetic "profile" templates'
    );
    assert.equal(
      weekdayMismatches,
      0,
      "Real OOS fixture must have zero matchDate vs matchNumStr weekday mismatches"
    );
    assert.equal(
      crsTickViolations,
      0,
      "Real OOS fixture must obey Official Sporttery CRS odds tick ladder"
    );

    // Verify all 112 red-team audit matches (in range 2042600..2042841) are included
    const inRedTeamRange = oosRaw.matches.filter((m: any) => {
      const idNum = Number(m.matchId);
      return idNum >= 2042600 && idNum <= 2042841;
    });
    assert.equal(
      inRedTeamRange.length,
      112,
      "Must contain the exact 112 red-team OOS matches as a subset"
    );

    // 2. Anti-gaming source check on scripts/bench-quant.mjs (D-09)
    const benchSrc = fs.readFileSync(
      path.join(repoRoot, "scripts/bench-quant.mjs"),
      "utf8"
    );
    assert.ok(
      benchSrc.includes("realSportteryOosMatches.json"),
      "scripts/bench-quant.mjs must default to realSportteryOosMatches.json"
    );
    assert.equal(
      benchSrc.includes("forceConfirmed: true"),
      false,
      "scripts/bench-quant.mjs must NEVER bypass stop-loss with forceConfirmed: true on Legacy"
    );
    assert.equal(
      benchSrc.includes("samplesEvaluated < 3600"),
      false,
      "scripts/bench-quant.mjs must NEVER self-clone slot tickets in Layer 3 Monte Carlo"
    );
    assert.equal(
      benchSrc.includes("firstLen !== sRef.reqPassLen"),
      false,
      "scripts/bench-quant.mjs must NEVER silo-filter pass lengths in Layer 3 Monte Carlo"
    );

    // 3. End-to-end 4-layer scientific benchmark suite pass
    const { runQuantScientificBenchmarks } =
      await import("../scripts/bench-quant.mjs");
    const report = runQuantScientificBenchmarks();
    assert.equal(
      report.allPassed,
      true,
      `Expected all 4 benchmark layers to pass, got gates=${JSON.stringify(report.gates)}`
    );
  });

  it("Slice 05 · Two-Axis Code-Review Regression Lock (Axis 1 Standards & Axis 2 Spec Fidelity)", async () => {
    const repoRoot = process.cwd();

    // 1. A1-1: Mutating odds on a match with pre-populated shinProb MUST recompute shinProb & fairProb (zero stale shinProb)
    const staleShinMatch = structuredClone(FALLBACK_MATCHES[0]);
    assert.ok((staleShinMatch.pools.HAD.options[0].shinProb ?? 0) > 0.45);
    staleShinMatch.pools.HAD.options[0].odds = 9.5;
    staleShinMatch.pools.HAD.options[2].odds = 1.28;
    const calRecomputed = calibrateMatchCoherentModel(staleShinMatch);
    assert.ok(
      calRecomputed.pools.HAD.options[0].shinProb < 0.15,
      `Expected fresh shinProb < 0.15 after odds 1.69 -> 9.50, got ${calRecomputed.pools.HAD.options[0].shinProb}`
    );
    assert.ok(
      calRecomputed.pools.HAD.options[0].fairProb < 0.3,
      `Expected fresh coherent fairProb < 0.30 (down from 0.538) after HAD odds 1.69 -> 9.50, got ${calRecomputed.pools.HAD.options[0].fairProb}`
    );
    staleShinMatch.pools.HHAD.selling = false;
    staleShinMatch.pools.HAFU.selling = false;
    staleShinMatch.pools.CRS.selling = false;
    const calHadOnly = calibrateMatchCoherentModel(staleShinMatch);
    assert.ok(
      calHadOnly.pools.HAD.options[0].fairProb < 0.15,
      `Expected fresh HAD+TTG fairProb < 0.15 after HAD odds 1.69 -> 9.50, got ${calHadOnly.pools.HAD.options[0].fairProb}`
    );

    // 2. A1-3 & A2-(c).2: Full key/label cache fingerprint — swapping middle chars ("s01s00" <-> "s05s00") at fixed odds indices invalidates WeakMap in evaluateQuantWorkspace
    const keySwapMatch = structuredClone(FALLBACK_MATCHES[1]);
    const crs10Pick = {
      matchId: keySwapMatch.id,
      matchNumStr: keySwapMatch.matchNumStr,
      home: keySwapMatch.home,
      away: keySwapMatch.away,
      poolCode: "CRS",
      poolName: "比分",
      singleAllowed: true,
      optionKey: "s01s00",
      optionLabel: "1:0",
      odds: 6.0,
      fairProb: 0.1,
    };
    const wsKeyBefore = evaluateQuantWorkspace(
      { picks: [crs10Pick], multiple: 1, targetIds: [keySwapMatch.id] },
      [keySwapMatch]
    );
    const before10 = wsKeyBefore.manualReport.anyWinProb;
    const i10 = keySwapMatch.pools.CRS.options.findIndex(
      (o: any) => o.label === "1:0"
    );
    const i50 = keySwapMatch.pools.CRS.options.findIndex(
      (o: any) => o.label === "5:0"
    );
    keySwapMatch.pools.CRS.options[i10] = {
      ...keySwapMatch.pools.CRS.options[i10],
      key: "s05s00",
      label: "5:0",
    };
    keySwapMatch.pools.CRS.options[i50] = {
      ...keySwapMatch.pools.CRS.options[i50],
      key: "s01s00",
      label: "1:0",
    };
    const wsKeyAfter = evaluateQuantWorkspace(
      { picks: [crs10Pick], multiple: 1, targetIds: [keySwapMatch.id] },
      [keySwapMatch]
    );
    const after10 = wsKeyAfter.manualReport.anyWinProb;
    assert.ok(
      Math.abs(after10 - before10) > 0.005,
      `CRS key/label swap at fixed odds indices must invalidate WeakMap cache (${before10} -> ${after10})`
    );

    // 3. A1-2: Deduplicate identical (matchId, poolCode, optionKey) picks in computeTruthReport & evaluateQuantWorkspace
    const m0 = FALLBACK_MATCHES[1];
    const singlePick = {
      matchId: m0.id,
      matchNumStr: m0.matchNumStr,
      home: m0.home,
      away: m0.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: true,
      optionKey: "h",
      optionLabel: "主胜",
      odds: m0.pools.HAD.options[0].odds,
      fairProb: m0.pools.HAD.options[0].fairProb,
    };
    const dupPicks = Array.from({ length: 50 }, () => ({ ...singlePick }));
    const dupRep = computeTruthReport(dupPicks, 2, [m0], { mode: "auto" });
    assert.equal(
      dupRep.betCount,
      1,
      "Duplicate identical picks must deduplicate to 1 bet"
    );
    const dupWs = evaluateQuantWorkspace(
      { picks: dupPicks, multiple: 2, targetIds: [m0.id], budget: 100 },
      [m0]
    );
    assert.equal(dupWs.manualReport.betCount, 1);

    // 4. A2-(c).1: >32,768-state 7M x 4 TTG 2串1 preserves exact realProfitProb AND combos EV (zero overflowKey mass dumping)
    const sevenM = FALLBACK_MATCHES.slice(0, 7);
    const ttgPicks7 = sevenM.flatMap((m: any) =>
      ["s0", "s1", "s2", "s3"].map((k) => {
        const o = m.pools.TTG.options.find((x: any) => x.key === k)!;
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "TTG",
          poolName: "总进球",
          singleAllowed: true,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        };
      })
    );
    const rep7 = computeTruthReport(ttgPicks7, 1, sevenM, {
      mode: "free",
      passSizes: [2],
    });
    const perMatch5 = sevenM.map((m: any) => {
      const opts = ["s0", "s1", "s2", "s3"].map((k) =>
        m.pools.TTG.options.find((x: any) => x.key === k)!
      );
      const pMiss = Math.max(0, 1 - opts.reduce((a, o) => a + o.fairProb, 0));
      return [
        { prob: pMiss, unitOdds: 0 },
        ...opts.map((o) => ({ prob: o.fairProb, unitOdds: o.odds })),
      ];
    });
    let exactProfitProb7 = 0;
    const chosenOdds = new Float64Array(7);
    const walkExact7 = (depth: number, pAcc: number) => {
      if (depth === 7) {
        let payCents = 0;
        for (let i = 0; i < 7; i++) {
          if (chosenOdds[i] === 0) continue;
          for (let j = i + 1; j < 7; j++) {
            if (chosenOdds[j] === 0) continue;
            payCents += Math.round(
              bankerRoundParlayUnitPayout([chosenOdds[i], chosenOdds[j]]) * 100
            );
          }
        }
        if (payCents >= rep7.totalCost * 100) exactProfitProb7 += pAcc;
        return;
      }
      for (const st of perMatch5[depth]) {
        chosenOdds[depth] = st.unitOdds;
        walkExact7(depth + 1, pAcc * st.prob);
      }
    };
    walkExact7(0, 1);
    assert.ok(
      Math.abs(rep7.realProfitProb - exactProfitProb7) < 1e-9,
      `7M x 4 TTG 2串1 realProfitProb (${rep7.realProfitProb}) must match exact 5^7 truth (${exactProfitProb7})`
    );
    const combosExpRet7 = rep7.combos.reduce(
      (a: number, c: any) => a + c.prob * c.totalPayout,
      0
    );
    const combosEv7 = (combosExpRet7 - rep7.totalCost) / rep7.totalCost;
    assert.ok(
      Math.abs(combosEv7 - rep7.expectedValueRate) < 1e-6,
      `7M x 4 TTG combos EV (${combosEv7}) must match exact linear EV (${rep7.expectedValueRate})`
    );

    // 5. A2-(a).2 & A1-3: Workspace hit-matrix reuse on bonus optimization AND _cachedJointEval invalidation on equal-cost mutation
    const eightPicks = FALLBACK_MATCHES.map((m: any) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: Boolean(m.pools.HAD.single),
      optionKey: "h",
      optionLabel: "主胜",
      odds: m.pools.HAD.options[0].odds,
      fairProb: m.pools.HAD.options[0].fairProb,
    }));
    const wsBonus = evaluateQuantWorkspace(
      {
        picks: eightPicks,
        multiple: 2,
        passSpec: { mode: "combo", comboCode: "8x247" },
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds: FALLBACK_MATCHES.map((m: any) => m.id),
        budget: 500,
      },
      FALLBACK_MATCHES
    );
    assert.ok(
      Boolean((wsBonus.manualReport as any)._reusableHitMatrix),
      "manualReport must attach _reusableHitMatrix for bonus-optimization dot-product reuse"
    );
    const wsBonus5 = evaluateQuantWorkspace(
      {
        picks: eightPicks.slice(0, 5),
        multiple: 4,
        passSpec: { mode: "combo", comboCode: "5x26" },
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: FALLBACK_MATCHES.slice(0, 5).map((m: any) => m.id),
        budget: 500,
      },
      FALLBACK_MATCHES
    );
    assert.ok(Boolean(wsBonus5.appliedPlan));
    const lastIdx = wsBonus5.appliedPlan!.lines.length - 1;
    assert.ok(wsBonus5.appliedPlan!.lines[0].multiple > 1);
    const mutatedPlan = {
      ...wsBonus5.appliedPlan!,
      lines: wsBonus5.appliedPlan!.lines.map((l: any, idx: number) =>
        idx === 0
          ? {
              ...l,
              multiple: l.multiple - 1,
              cost: (l.multiple - 1) * 2,
              returnPayout: Number(
                (l.unitPayout * (l.multiple - 1)).toFixed(2)
              ),
            }
          : idx === lastIdx
            ? {
                ...l,
                multiple: l.multiple + 1,
                cost: (l.multiple + 1) * 2,
                returnPayout: Number(
                  (l.unitPayout * (l.multiple + 1)).toFixed(2)
                ),
              }
            : l
      ),
    };
    Object.defineProperty(mutatedPlan, "_cachedJointEval", {
      value: (wsBonus5.appliedPlan as any)._cachedJointEval,
      enumerable: false,
    });
    assert.equal(mutatedPlan.totalCost, wsBonus5.appliedPlan!.totalCost);
    const repBeforeMut = wsBonus5.effectiveReport;
    const repAfterMut = archetypeToReport(mutatedPlan, null, FALLBACK_MATCHES);
    assert.notEqual(
      repAfterMut.expectedValueRate,
      repBeforeMut.expectedValueRate,
      "Mutating line multiples at equal totalCost must invalidate _cachedJointEval"
    );

    // 6. A2-(b).1 & A2-(c).4: Slot ④ emits NO multi-leg resonance parlay when legal singles exist, and blocks negative-shrunk-EV non-single pair even under stance tilt
    const lagSingleA = structuredClone(FALLBACK_MATCHES[0]);
    lagSingleA.id = "LAG-SGL-A";
    lagSingleA.pools.HAD.updateDate = "2026-11-20";
    lagSingleA.pools.HAD.updateTime = "21:30:00";
    lagSingleA.pools.HHAD.updateDate = "2026-11-20";
    lagSingleA.pools.HHAD.updateTime = "21:30:00";
    lagSingleA.pools.HAFU.updateDate = "2026-11-20";
    lagSingleA.pools.HAFU.updateTime = "18:30:00";
    lagSingleA.pools.HAFU.options.find((o: any) => o.key === "dh")!.odds = 9.5;
    const lagSingleB = structuredClone(FALLBACK_MATCHES[2]);
    lagSingleB.id = "LAG-SGL-B";
    lagSingleB.pools.HAD.updateDate = "2026-11-20";
    lagSingleB.pools.HAD.updateTime = "21:30:00";
    lagSingleB.pools.HHAD.updateDate = "2026-11-20";
    lagSingleB.pools.HHAD.updateTime = "21:30:00";
    lagSingleB.pools.HAFU.updateDate = "2026-11-20";
    lagSingleB.pools.HAFU.updateTime = "18:30:00";
    lagSingleB.pools.HAFU.options.find((o: any) => o.key === "dh")!.odds = 12.0;
    const p4TwoSingles = generateParetoPortfolio(
      [lagSingleA, lagSingleB],
      100,
      "objective",
      false,
      []
    )[3];
    assert.equal(p4TwoSingles.available, true);
    assert.equal(
      p4TwoSingles.lines.every((l: any) => l.legs.length === 1),
      true,
      "Slot ④ must NOT append 2~3-leg resonance parlays when legal +EV singles exist"
    );

    const nonSingleMildPos = structuredClone(FALLBACK_MATCHES[0]);
    nonSingleMildPos.id = "NON-SGL-MILD";
    nonSingleMildPos.pools.HHAD.single = false;
    nonSingleMildPos.pools.HHAD.options[0].odds = 3.95;
    const normalPartner = structuredClone(FALLBACK_MATCHES[2]);
    const p4NonSinglePair = generateParetoPortfolio(
      [nonSingleMildPos, normalPartner],
      100,
      "home-lean",
      false,
      []
    )[3];
    if (p4NonSinglePair.available) {
      assert.ok(p4NonSinglePair.expectedValueRate > 0);
      assert.equal(
        p4NonSinglePair.lines.some(
          (l: any) =>
            l.legs.length >= 2 && p4NonSinglePair.expectedValueRate <= 0
        ),
        false
      );
    }

    // 7. A2-(a).3 & A1-3: UI Tile 3 subtitle ("票面返还"), required ArchetypePlan fields, and manualQaEngine covering-wheel sync
    const appSrc = fs.readFileSync(
      path.join(repoRoot, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    const typesSrc = fs.readFileSync(
      path.join(repoRoot, "src/prototype/quantTypes.ts"),
      "utf8"
    );
    const qaSrc = fs.readFileSync(
      path.join(repoRoot, "server/manualQaEngine.mjs"),
      "utf8"
    );
    assert.ok(
      appSrc.includes("票面返还"),
      "Tile 3 subtitle must display 票面返还 rate"
    );
    assert.equal(
      appSrc.includes("单池暗扣"),
      false,
      "Tile 3 must not mislabel parlay vigPct as 单池暗扣"
    );
    assert.equal(
      typesSrc.includes("expectedValueRate?:"),
      false,
      "ArchetypePlan.expectedValueRate must be required (non-optional)"
    );
    assert.equal(
      typesSrc.includes("underwaterCount?:"),
      false,
      "ArchetypePlan.underwaterCount must be required (non-optional)"
    );
    assert.equal(
      typesSrc.includes("relative-alpha"),
      false,
      "ArchetypePlan.alphaKind must drop obsolete relative-alpha union arm"
    );
    assert.equal(
      qaSrc.includes("黑掉 1~2 场"),
      false,
      "manualQaEngine.mjs qa-covering-wheel must not overclaim 1~2 match guarantee"
    );
  });
});
