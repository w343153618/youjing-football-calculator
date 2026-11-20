import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  archetypeToReport,
  calibrateMatchCoherentModel,
  computeTruthReport,
  evaluateQuantWorkspace,
  optimizeBonusPlan,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import * as quantModule from "../server/quantEngine.mjs";
import type {
  ArchetypePlan,
  MatchItem,
  SelectedPick,
  UserStance,
} from "../src/prototype/quantTypes.ts";

function makePick(
  m: MatchItem,
  poolCode: "HAD" | "HHAD" | "HAFU" | "TTG" | "CRS",
  optionKey: string
): SelectedPick {
  const pool = m.pools[poolCode];
  const opt = pool.options.find(
    (o) => o.key === optionKey || o.label === optionKey
  )!;
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: pool.single,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

describe("Spec 0008 · Seam B: Quotient State-Space Evaluator, Conserving Sandbox & 3+1 Pareto Portfolio", () => {
  it("Slice 1: enforces full-space probability conservation (sum = 1.000000) across stance tilts (home-lean / upset-watch on home & away favorites) and subjectiveDeltaPct multi-pick slider", () => {
    const generateParetoPortfolio = (quantModule as Record<string, any>)
      .generateParetoPortfolio;
    assert.equal(
      typeof generateParetoPortfolio,
      "function",
      "Expected generateParetoPortfolio export at Seam B"
    );

    // 1. Stance probability conservation & directionality on home-favorite (m0: 中国 vs 巴林) and away-favorite (m3: 威尔士 vs 葡萄牙)
    const homeFav = FALLBACK_MATCHES[0] as MatchItem; // 中国 HAD h @1.69 (fav) vs 巴林 a @4.18 (underdog)
    const awayFav = FALLBACK_MATCHES[3] as MatchItem; // 威尔士 HAD h @4.50 (underdog) vs 葡萄牙 a @1.66 (fav)

    const getStanceLegProb = (
      m: MatchItem,
      optKey: "h" | "d" | "a",
      stance: UserStance
    ) => {
      const plans = generateParetoPortfolio(
        [m, FALLBACK_MATCHES[2]],
        100,
        stance,
        false,
        [
          makePick(m, "HAD", optKey),
          makePick(FALLBACK_MATCHES[2] as MatchItem, "HAD", "h"),
        ]
      );
      const p0 = plans[0];
      const leg = p0.lines[0].legs.find(
        (g: { matchId: string }) => g.matchId === m.id
      )!;
      return leg.fairProb as number;
    };

    for (const m of [homeFav, awayFav]) {
      for (const stance of ["objective", "home-lean", "upset-watch"] as const) {
        const pH = getStanceLegProb(m, "h", stance);
        const pD = getStanceLegProb(m, "d", stance);
        const pA = getStanceLegProb(m, "a", stance);
        assert.ok(pH > 0 && pD > 0 && pA > 0);
        assert.ok(
          Math.abs(pH + pD + pA - 1) < 1e-12,
          `Stance ${stance} on ${m.id} must conserve total probability 1.0, got ${pH + pD + pA}`
        );
      }
    }

    // home-lean boosts home win and reduces draw & away win
    assert.ok(
      getStanceLegProb(homeFav, "h", "home-lean") >
        getStanceLegProb(homeFav, "h", "objective")
    );
    assert.ok(
      getStanceLegProb(homeFav, "d", "home-lean") <
        getStanceLegProb(homeFav, "d", "objective")
    );
    assert.ok(
      getStanceLegProb(homeFav, "a", "home-lean") <
        getStanceLegProb(homeFav, "a", "objective")
    );

    // upset-watch on home-favorite boosts draw & away underdog, reducing home favorite
    assert.ok(
      getStanceLegProb(homeFav, "d", "upset-watch") >
        getStanceLegProb(homeFav, "d", "objective")
    );
    assert.ok(
      getStanceLegProb(homeFav, "a", "upset-watch") >
        getStanceLegProb(homeFav, "a", "objective")
    );
    assert.ok(
      getStanceLegProb(homeFav, "h", "upset-watch") <
        getStanceLegProb(homeFav, "h", "objective")
    );

    // upset-watch on away-favorite (葡萄牙 fav) MUST boost draw & HOME underdog (威尔士), reducing away favorite!
    assert.ok(
      getStanceLegProb(awayFav, "d", "upset-watch") >
        getStanceLegProb(awayFav, "d", "objective")
    );
    assert.ok(
      getStanceLegProb(awayFav, "h", "upset-watch") >
        getStanceLegProb(awayFav, "h", "objective")
    );
    assert.ok(
      getStanceLegProb(awayFav, "a", "upset-watch") <
        getStanceLegProb(awayFav, "a", "objective")
    );

    // 2. subjectiveDeltaPct union scaling: preserves conditional proportions & clamps union to [0.02, 0.98]
    const baseM1 = FALLBACK_MATCHES[1] as MatchItem;
    const highUnionMatch: MatchItem = {
      ...baseM1,
      id: "s1-high-union",
      pools: {
        ...baseM1.pools,
        HAD: {
          ...baseM1.pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.08, trend: 0, fairProb: 0.85 },
            { key: "d", label: "平", odds: 8.8, trend: 0, fairProb: 0.1 },
            { key: "a", label: "客胜", odds: 17.6, trend: 0, fairProb: 0.05 },
          ],
        },
      },
    };
    const multiHighPicks: SelectedPick[] = [
      makePick(highUnionMatch, "HAD", "h"),
      makePick(highUnionMatch, "HAD", "d"),
    ];
    // Baseline P_S = 0.85 + 0.10 = 0.95; at +20%, 0.95 * 1.20 = 1.14 -> clamped to 0.98!
    const wsClampHi = evaluateQuantWorkspace(
      {
        picks: multiHighPicks,
        multiple: 5,
        subjectiveDeltaPct: 20,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: [highUnionMatch.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [highUnionMatch]
    );
    assert.ok(
      Math.abs(wsClampHi.manualReport.anyWinProb - 0.98) < 1e-12,
      `Expected union win prob clamped at 0.98, got ${wsClampHi.manualReport.anyWinProb}`
    );
    const lineH = wsClampHi.appliedPlan!.lines.find(
      (l) => l.legs[0].optionKey === "h"
    )!;
    const lineD = wsClampHi.appliedPlan!.lines.find(
      (l) => l.legs[0].optionKey === "d"
    )!;
    assert.ok(Math.abs(lineH.prob + lineD.prob - 0.98) < 1e-12);
    // Relative conditional proportion 0.85 / 0.10 = 8.5 MUST be preserved!
    assert.ok(
      Math.abs(lineH.prob / lineD.prob - 8.5) < 1e-9,
      `Expected conditional ratio 8.5 preserved, got ${lineH.prob / lineD.prob}`
    );

    // Full cover (P_S = 1.0 >= 0.999) stays 1.000000 under both +20% and -15% without overflowing or artificial 0.995 cap
    const fullCoverPicks: SelectedPick[] = [
      makePick(highUnionMatch, "HAD", "h"),
      makePick(highUnionMatch, "HAD", "d"),
      makePick(highUnionMatch, "HAD", "a"),
    ];
    for (const delta of [-15, 0, 20]) {
      const wsFull = evaluateQuantWorkspace(
        {
          picks: fullCoverPicks,
          multiple: 5,
          subjectiveDeltaPct: delta,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [highUnionMatch.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        [highUnionMatch]
      );
      assert.ok(
        Math.abs(wsFull.manualReport.anyWinProb - 1.0) < 1e-12,
        `Full 3-way HAD cover must have exact anyWinProb = 1.0 at delta=${delta}, got ${wsFull.manualReport.anyWinProb}`
      );
    }
  });

  it("Slice 2: evaluates quotient joint state space Ω̃ with dual-layer tickets/combos, exact M串N overlap, dynamic HAD+HHAD dual-single, capital-weighted vig, and cap-clipping bonus guard", () => {
    // 1. Overlapping cross-pool single-match tickets: HAFU 平胜(dh) + HHAD(-1) 让平(hd) + CRS 1:0
    // On HT 0:0 -> FT 1:0, ALL THREE tickets hit simultaneously!
    const m = FALLBACK_MATCHES[1] as MatchItem; // 日本 vs 巴拉圭 (single open on all pools)
    const dhOpt = m.pools.HAFU.options.find((o) => o.key === "dh")!;
    const hdOpt = m.pools.HHAD.options.find((o) => o.key === "hd")!;
    const crs10Opt = m.pools.CRS.options.find((o) => o.label === "1:0")!;

    const overlapPlan: ArchetypePlan = {
      key: "max-cvar-wheel",
      available: true,
      shortTab: "🧩 容错缩水",
      badge: "🧩 容错缩水极值",
      title: "跨盘重叠验证",
      tagline: "验证物理实票与互斥赛果解耦",
      totalCost: 20,
      savedCash: 0,
      minReturn: Number((hdOpt.odds * 2 * 4).toFixed(2)),
      maxReturn: 0,
      winProb: 0,
      profitProb: 0,
      missOneReturn: null,
      vigPct: 18,
      reasons: ["重叠测试"],
      lines: [
        {
          id: "ov-dh",
          roleLabel: "半平主胜",
          legs: [
            {
              matchId: m.id,
              matchNumStr: m.matchNumStr,
              home: m.home,
              away: m.away,
              kickoff: m.kickoff,
              poolCode: "HAFU",
              poolName: "半全场",
              optionKey: "dh",
              optionLabel: "平胜",
              odds: dhOpt.odds,
              fairProb: dhOpt.fairProb,
            },
          ],
          modeLabel: "单关",
          multiple: 4,
          cost: 8,
          unitPayout: Number((dhOpt.odds * 2).toFixed(2)),
          returnPayout: Number((dhOpt.odds * 8).toFixed(2)),
          netProfit: 0,
          prob: dhOpt.fairProb,
        },
        {
          id: "ov-hd",
          roleLabel: "一球让平",
          legs: [
            {
              matchId: m.id,
              matchNumStr: m.matchNumStr,
              home: m.home,
              away: m.away,
              kickoff: m.kickoff,
              poolCode: "HHAD",
              poolName: "让球(-1)",
              optionKey: "hd",
              optionLabel: "让平",
              odds: hdOpt.odds,
              fairProb: hdOpt.fairProb,
            },
          ],
          modeLabel: "单关",
          multiple: 4,
          cost: 8,
          unitPayout: Number((hdOpt.odds * 2).toFixed(2)),
          returnPayout: Number((hdOpt.odds * 8).toFixed(2)),
          netProfit: 0,
          prob: hdOpt.fairProb,
        },
        {
          id: "ov-10",
          roleLabel: "比分1:0",
          legs: [
            {
              matchId: m.id,
              matchNumStr: m.matchNumStr,
              home: m.home,
              away: m.away,
              kickoff: m.kickoff,
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "1:0",
              optionLabel: "1:0",
              odds: crs10Opt.odds,
              fairProb: crs10Opt.fairProb,
            },
          ],
          modeLabel: "单关",
          multiple: 2,
          cost: 4,
          unitPayout: Number((crs10Opt.odds * 2).toFixed(2)),
          returnPayout: Number((crs10Opt.odds * 4).toFixed(2)),
          netProfit: 0,
          prob: crs10Opt.fairProb,
        },
      ],
    };

    const wsOverlap = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-cvar-wheel",
          snapshotPlan: overlapPlan,
          scaleMultiple: 1,
        },
        targetIds: [m.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    const repOv = wsOverlap.effectiveReport;
    assert.equal(
      repOv.tickets!.length,
      3,
      "tickets must preserve the 3 physical shop tickets"
    );
    const sumComboProb = repOv.combos.reduce((a, c) => a + c.prob, 0);
    assert.ok(
      Math.abs(sumComboProb - repOv.anyWinProb) < 1e-12,
      "combos must sum exactly to anyWinProb"
    );
    assert.ok(
      repOv.realProfitProb >= 0 &&
        repOv.realProfitProb <= repOv.anyWinProb &&
        repOv.anyWinProb <= 1
    );
    const rawLineProbSum = dhOpt.fairProb + hdOpt.fairProb + crs10Opt.fairProb;
    assert.ok(
      repOv.anyWinProb < rawLineProbSum - 0.05,
      "Union win prob must be strictly less than sum of overlapping ticket probs"
    );
    const expectedStackedMax = Number(
      (dhOpt.odds * 8 + hdOpt.odds * 8 + crs10Opt.odds * 4).toFixed(2)
    );
    assert.equal(
      repOv.maxPayout,
      expectedStackedMax,
      "maxPayout must capture simultaneous 3-ticket hit on HT 0:0 -> FT 1:0"
    );
    const expectedLinearReturn =
      dhOpt.fairProb * (dhOpt.odds * 8) +
      hdOpt.fairProb * (hdOpt.odds * 8) +
      crs10Opt.fairProb * (crs10Opt.odds * 4);
    assert.ok(
      Math.abs(repOv.expectedValueRate - (expectedLinearReturn - 20) / 20) <
        1e-9,
      "Linearity of expectation must hold to machine precision on overlapping cross-pool tickets"
    );

    // 2. 3串3 overlapping sub-parlays on three 60%-prob legs: exact anyWinProb = 0.648 (NOT capped 0.92!)
    const three60Matches: MatchItem[] = [0, 1, 2].map((idx) => {
      const base = FALLBACK_MATCHES[idx] as MatchItem;
      return {
        ...base,
        id: `s2-m60-${idx}`,
        matchNumStr: `周六00${idx + 1}`,
        pools: {
          ...base.pools,
          HAD: {
            ...base.pools.HAD,
            selling: true,
            single: false,
            payoutRatio: 0.88,
            vig: 0.12,
            options: [
              { key: "h", label: "主胜", odds: 1.5, trend: 0, fairProb: 0.6 },
              { key: "d", label: "平", odds: 3.8, trend: 0, fairProb: 0.22 },
              { key: "a", label: "客胜", odds: 4.9, trend: 0, fairProb: 0.18 },
            ],
          },
        },
      };
    });
    const picks3x3 = three60Matches.map((tm) => makePick(tm, "HAD", "h"));
    const ws3x3Bonus = evaluateQuantWorkspace(
      {
        picks: picks3x3,
        multiple: 5,
        passSpec: { mode: "combo", comboCode: "3x3" },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: three60Matches.map((x) => x.id),
        budget: 60,
        stance: "objective",
        unlockFullAgg: false,
      },
      three60Matches
    );
    assert.ok(
      Math.abs(ws3x3Bonus.appliedPlan!.winProb - 0.648) < 1e-9,
      `3串3 bonus plan winProb must be exact 0.648 (not 0.92), got ${ws3x3Bonus.appliedPlan!.winProb}`
    );
    assert.ok(Math.abs(ws3x3Bonus.effectiveReport.anyWinProb - 0.648) < 1e-9);
    assert.equal(
      ws3x3Bonus.effectiveReport.tickets!.length,
      3,
      "3串3 has 3 physical 2串1 tickets"
    );
    assert.equal(
      ws3x3Bonus.effectiveReport.combos.length,
      4,
      "3串3 has 4 mutually-exclusive winning scenarios (3 two-hit + 1 all-three-hit)"
    );
    const stackedAllThree = Number(
      ws3x3Bonus
        .appliedPlan!.lines.reduce((a, l) => a + l.returnPayout, 0)
        .toFixed(2)
    );
    assert.equal(ws3x3Bonus.effectiveReport.maxPayout, stackedAllThree);

    // 3. Dynamic HAD + HHAD dual-single on computeTruthReport (replaces hardcoded diffWeights [0.03..0.09])
    const heavyFavDual: MatchItem = {
      ...(FALLBACK_MATCHES[5] as MatchItem), // 法国 vs 以色列 (heavy home fav ~1.18)
      id: "s2-dual-heavy",
      pools: {
        ...(FALLBACK_MATCHES[5] as MatchItem).pools,
        HAD: { ...(FALLBACK_MATCHES[5] as MatchItem).pools.HAD, single: true },
        HHAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HHAD,
          single: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 1.55, trend: 0, fairProb: 0.57 },
            { key: "hd", label: "让平", odds: 3.75, trend: 0, fairProb: 0.23 },
            { key: "ha", label: "让负", odds: 4.4, trend: 0, fairProb: 0.2 },
          ],
        },
      },
    };
    const underdogDual: MatchItem = {
      ...(FALLBACK_MATCHES[3] as MatchItem), // 威尔士 vs 葡萄牙 (home underdog @4.50)
      id: "s2-dual-dog",
      pools: {
        ...(FALLBACK_MATCHES[3] as MatchItem).pools,
        HAD: { ...(FALLBACK_MATCHES[3] as MatchItem).pools.HAD, single: true },
        HHAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HHAD,
          single: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 10.5, trend: 0, fairProb: 0.08 },
            { key: "hd", label: "让平", odds: 5.8, trend: 0, fairProb: 0.13 },
            { key: "ha", label: "让负", odds: 1.12, trend: 0, fairProb: 0.79 },
          ],
        },
      },
    };
    const repHeavy = computeTruthReport(
      [
        makePick(heavyFavDual, "HAD", "h"),
        makePick(heavyFavDual, "HHAD", "hh"),
      ],
      2,
      [heavyFavDual]
    );
    const repDog = computeTruthReport(
      [
        makePick(underdogDual, "HAD", "h"),
        makePick(underdogDual, "HHAD", "hh"),
      ],
      2,
      [underdogDual]
    );
    const calHeavy = calibrateMatchCoherentModel(heavyFavDual);
    assert.ok(
      Math.abs(repHeavy.anyWinProb - calHeavy.poolProbs.HAD.h) < 1e-6,
      `Heavy fav HAD(h)+HHAD(-1,hh) union win prob must equal coherent P(h)=${calHeavy.poolProbs.HAD.h}, got ${repHeavy.anyWinProb}`
    );
    assert.ok(
      repHeavy.anyWinProb > repDog.anyWinProb + 0.4,
      `Dual-single win prob must reflect real match odds (${repHeavy.anyWinProb} vs ${repDog.anyWinProb}), not hardcoded 0.46`
    );

    // 4. Capital-weighted vigPct & optimizeBonusPlan statutory cap-clipping guard
    const lowVigMatch = FALLBACK_MATCHES[1] as MatchItem; // HAD vig ~12%, CRS vig ~26%
    const makeWeightedPlan = (
      hadMult: number,
      crsMult: number
    ): ArchetypePlan => ({
      key: "max-profit-prob",
      available: true,
      shortTab: "🛡️ 稳健保本",
      badge: "🛡️ 稳健保本极值",
      title: "资金加权抽水校验",
      tagline: "测试",
      totalCost: (hadMult + crsMult) * 2,
      savedCash: 0,
      minReturn: 20,
      maxReturn: 200,
      winProb: 0.5,
      profitProb: 0.5,
      missOneReturn: null,
      vigPct: 0,
      reasons: [],
      lines: [
        {
          id: "w-had",
          roleLabel: "主盘",
          legs: [
            {
              matchId: lowVigMatch.id,
              matchNumStr: lowVigMatch.matchNumStr,
              home: lowVigMatch.home,
              away: lowVigMatch.away,
              kickoff: lowVigMatch.kickoff,
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: lowVigMatch.pools.HAD.options[0].odds,
              fairProb: lowVigMatch.pools.HAD.options[0].fairProb,
            },
          ],
          modeLabel: "单关",
          multiple: hadMult,
          cost: hadMult * 2,
          unitPayout: Number(
            (lowVigMatch.pools.HAD.options[0].odds * 2).toFixed(2)
          ),
          returnPayout: Number(
            (lowVigMatch.pools.HAD.options[0].odds * 2 * hadMult).toFixed(2)
          ),
          netProfit: 0,
          prob: lowVigMatch.pools.HAD.options[0].fairProb,
        },
        {
          id: "w-crs",
          roleLabel: "比分",
          legs: [
            {
              matchId: lowVigMatch.id,
              matchNumStr: lowVigMatch.matchNumStr,
              home: lowVigMatch.home,
              away: lowVigMatch.away,
              kickoff: lowVigMatch.kickoff,
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "0:0",
              optionLabel: "0:0",
              odds: lowVigMatch.pools.CRS.options.find(
                (o) => o.label === "0:0"
              )!.odds,
              fairProb: lowVigMatch.pools.CRS.options.find(
                (o) => o.label === "0:0"
              )!.fairProb,
            },
          ],
          modeLabel: "单关",
          multiple: crsMult,
          cost: crsMult * 2,
          unitPayout: 22,
          returnPayout: 22 * crsMult,
          netProfit: 0,
          prob: lowVigMatch.pools.CRS.options.find((o) => o.label === "0:0")!
            .fairProb,
        },
      ],
    });
    const repHadHeavy = archetypeToReport(
      makeWeightedPlan(45, 5),
      null,
      FALLBACK_MATCHES
    );
    const repCrsHeavy = archetypeToReport(
      makeWeightedPlan(5, 45),
      null,
      FALLBACK_MATCHES
    );
    assert.ok(
      repCrsHeavy.avgVigLossPer100 > repHadHeavy.avgVigLossPer100 + 8,
      `Expected CRS-heavy vig (${repCrsHeavy.avgVigLossPer100}%) > HAD-heavy vig (${repHadHeavy.avgVigLossPer100}%) + 8%`
    );

    // optimizeBonusPlan cap-clipping guard: cold-first does not waste >1 multiple on a 2-leg ticket already exceeding 200,000 cap
    const capGuardM1: MatchItem = {
      ...lowVigMatch,
      id: "s2-cap-1",
      pools: {
        ...lowVigMatch.pools,
        CRS: {
          ...lowVigMatch.pools.CRS,
          single: true,
          selling: true,
          options: [
            { key: "1:0", label: "1:0", odds: 4.5, trend: 0, fairProb: 0.22 },
            { key: "3:3", label: "3:3", odds: 450, trend: 0, fairProb: 0.002 },
          ],
        },
      },
    };
    const capGuardM2: MatchItem = {
      ...lowVigMatch,
      id: "s2-cap-2",
      pools: {
        ...lowVigMatch.pools,
        CRS: {
          ...lowVigMatch.pools.CRS,
          single: true,
          selling: true,
          options: [
            { key: "3:3", label: "3:3", odds: 450, trend: 0, fairProb: 0.002 },
          ],
        },
      },
    };
    const capManual = computeTruthReport(
      [
        makePick(capGuardM1, "CRS", "1:0"),
        makePick(capGuardM1, "CRS", "3:3"),
        makePick(capGuardM2, "CRS", "3:3"),
      ],
      10,
      [capGuardM1, capGuardM2]
    );
    const coldOpt = optimizeBonusPlan(
      capManual,
      [capGuardM1, capGuardM2],
      "cold-first"
    )!;
    const clippedColdLine = coldOpt.lines.find(
      (l) => l.legs[0].optionKey === "3:3"
    )!;
    assert.equal(
      clippedColdLine.multiple,
      1,
      `Cap-clipped 3:3×3:3 ticket (raw 405,000 > 200,000 cap) must be guarded at multiple=1, got ${clippedColdLine.multiple}`
    );
  });

  it("Slice 3: delivers 4-slot Pareto contract, legacy key mapping, Slot ① zero-underwater Dutching, and Slot ② exact integer shield + <=1.45 drag-leg pruning/warning + cap guard", () => {
    const generateParetoPortfolio = (quantModule as Record<string, any>)
      .generateParetoPortfolio;

    // 1. 4-slot contract & backward-compatible workspace fields
    const ws4 = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: FALLBACK_MATCHES.slice(0, 3).map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(ws4.portfolioPlans.length, 4);
    assert.equal(ws4.fivePlans.length, 4);
    assert.equal(
      ws4.portfolioPlans,
      ws4.fivePlans,
      "fivePlans must reference exact same 4-slot array"
    );
    assert.deepEqual(
      ws4.portfolioPlans.map((p) => p.key),
      ["max-profit-prob", "max-ev-utility", "max-cvar-wheel", "alpha-radar"]
    );

    // 2. Legacy key mapping in evaluateQuantWorkspace
    for (const [legacyKey, expectedShortTab] of [
      ["iron-shield", "🛡️ 稳健保本"],
      ["spear-shield", "⚖️ 期望效用"],
      ["fault-tolerant", "🧩 容错缩水"],
      ["goal-structure", "⚖️ 期望效用"],
    ] as const) {
      const wsLeg = evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: { kind: "archetype", key: legacyKey },
          targetIds: FALLBACK_MATCHES.slice(0, 2).map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        FALLBACK_MATCHES
      );
      assert.equal(
        wsLeg.appliedPlan?.shortTab,
        expectedShortTab,
        `Legacy ${legacyKey} must map to ${expectedShortTab}`
      );
    }

    // goal-structure WITH valid snapshotPlan evaluates snapshotPlan instead of remapping
    const customGoalSnap: ArchetypePlan = {
      key: "goal-structure",
      available: true,
      shortTab: "🔬 进球结构",
      badge: "🔬 进球结构流",
      title: "历史快照兼容验证",
      tagline: "保留历史挂载单",
      totalCost: 20,
      savedCash: 0,
      minReturn: 29,
      maxReturn: 36,
      winProb: 0.4,
      profitProb: 0.4,
      missOneReturn: null,
      vigPct: 18,
      reasons: ["快照测试"],
      lines: [
        {
          id: "gs-snap-1",
          roleLabel: "快照进球",
          legs: [
            {
              matchId: FALLBACK_MATCHES[0].id,
              matchNumStr: FALLBACK_MATCHES[0].matchNumStr,
              home: FALLBACK_MATCHES[0].home,
              away: FALLBACK_MATCHES[0].away,
              kickoff: FALLBACK_MATCHES[0].kickoff,
              poolCode: "TTG",
              poolName: "总进球",
              optionKey: "s2",
              optionLabel: "2球",
              odds: FALLBACK_MATCHES[0].pools.TTG.options.find(
                (o) => o.key === "s2"
              )!.odds,
              fairProb: FALLBACK_MATCHES[0].pools.TTG.options.find(
                (o) => o.key === "s2"
              )!.fairProb,
            },
          ],
          modeLabel: "单关",
          multiple: 10,
          cost: 20,
          unitPayout: 5.8,
          returnPayout: 58,
          netProfit: 38,
          prob: 0.27,
        },
      ],
    };
    const wsGoalSnap = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "goal-structure",
          snapshotPlan: customGoalSnap,
        },
        targetIds: [FALLBACK_MATCHES[0].id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(wsGoalSnap.appliedPlan?.shortTab, "🔬 进球结构");

    // 3. Slot ① max-profit-prob: 100% zero-underwater across 1~8 matches + non-single synthetic single + wide-cover tail pruning
    for (const count of [1, 2, 4, 6, 8]) {
      const subset = FALLBACK_MATCHES.slice(0, count);
      const plans = generateParetoPortfolio(
        subset,
        100,
        "objective",
        false,
        []
      );
      const slot1 = plans[0] as ArchetypePlan;
      assert.equal(slot1.key, "max-profit-prob");
      assert.equal(slot1.available, true);
      assert.equal(slot1.shortTab, "🛡️ 稳健保本");
      const rep1 = archetypeToReport(slot1, null, subset);
      assert.equal(
        rep1.underwaterCount,
        0,
        `Slot ① must have 0 underwater states for ${count} matches`
      );
      assert.ok(
        Math.abs(slot1.profitProb - slot1.winProb) < 1e-12,
        "100% of winning states in Slot ① must be profitable"
      );
      if (count === 1) {
        // FALLBACK_MATCHES[0] has HAD.single=false & HHAD.single=false -> Slot ① must use single-capable pool!
        assert.ok(
          slot1.lines.every((l) =>
            l.legs.every((g) => subset[0].pools[g.poolCode].single === true)
          ),
          "Single non-single match must automatically construct synthetic single on single-capable pool"
        );
      }
    }

    // Wide-cover anchor with harmonic effectiveOdds <= 1.02 (all 3 HAD options on a ~12% vig pool -> effOdds ~ 0.88 <= 1.02)
    // Slot ① must prune tail leg(s) until 100% zero-underwater holds!
    const mSingleOpen = FALLBACK_MATCHES[1] as MatchItem;
    const allThreeAnchors: SelectedPick[] = ["h", "d", "a"].map((k) =>
      makePick(mSingleOpen, "HAD", k)
    );
    const prunedPlans = generateParetoPortfolio(
      [mSingleOpen],
      40,
      "objective",
      false,
      allThreeAnchors
    );
    const prunedSlot1 = prunedPlans[0] as ArchetypePlan;
    const repPruned1 = archetypeToReport(prunedSlot1, null, [mSingleOpen]);
    assert.equal(
      repPruned1.underwaterCount,
      0,
      "Slot ① must prune <=1.02 effOdds wide cover to maintain zero underwater"
    );
    assert.ok(
      prunedSlot1.lines.length < 3,
      "Must drop at least 1 tail option from 3-way negative-margin full cover"
    );

    // 4. Slot ② max-ev-utility: exact minimum integer breakeven shield (zero 4~6 match shield inversion!)
    for (const count of [4, 5, 6]) {
      const cleanMatches: MatchItem[] = FALLBACK_MATCHES.slice(0, count).map(
        (fm, idx) => ({
          ...(fm as MatchItem),
          id: `s3-clean-${count}-${idx}`,
          matchNumStr: `周六00${idx + 1}`,
          pools: {
            ...(fm as MatchItem).pools,
            HAD: {
              ...(fm as MatchItem).pools.HAD,
              selling: true,
              single: true,
              payoutRatio: 0.885,
              vig: 0.115,
              options: [
                {
                  key: "h",
                  label: "主胜",
                  odds: 1.85,
                  trend: 0,
                  fairProb: 0.48,
                },
                { key: "d", label: "平", odds: 3.35, trend: 0, fairProb: 0.27 },
                {
                  key: "a",
                  label: "客胜",
                  odds: 3.55,
                  trend: 0,
                  fairProb: 0.25,
                },
              ],
            },
          },
        })
      );
      const plans = generateParetoPortfolio(
        cleanMatches,
        100,
        "objective",
        false,
        []
      );
      const slot2 = plans[1] as ArchetypePlan;
      assert.equal(slot2.key, "max-ev-utility");
      assert.equal(slot2.available, true);
      const shieldLine = slot2.lines.find((l) => l.roleLabel.includes("盾"));
      const attackCost = slot2.lines
        .filter((l) => !l.roleLabel.includes("盾"))
        .reduce((a, l) => a + l.cost, 0);
      if (shieldLine) {
        const expectedMinMult = Math.ceil(
          slot2.totalCost / shieldLine.unitPayout
        );
        assert.equal(
          shieldLine.multiple,
          expectedMinMult,
          `Shield multiple on ${count}-match parlay must equal exact ceil(C / u_shield) = ${expectedMinMult}, got ${shieldLine.multiple}`
        );
        assert.ok(
          shieldLine.cost < attackCost,
          `Zero shield inversion on ${count} matches: shield cost (${shieldLine.cost}) must be strictly less than attack cost (${attackCost})`
        );
      }
    }

    // 5. Slot ② High-Vig Drag-Leg (高抽水拖累腿, single-leg O*p < 0.875) pruning (objective) vs retention + warning at reasons[0] (anchored)
    const baseClean = FALLBACK_MATCHES[2] as MatchItem; // 波兰 vs 瑞典 HAD 2.38
    const cleanA: MatchItem = {
      ...baseClean,
      id: "s3-dr-cleanA",
      matchNumStr: "周日001",
      home: "纽卡斯尔",
      away: "维拉",
    };
    const cleanB: MatchItem = {
      ...(FALLBACK_MATCHES[4] as MatchItem),
      id: "s3-dr-cleanB",
      matchNumStr: "周日002",
      home: "比利时",
      away: "意大利",
    };
    const dragMosquito: MatchItem = {
      ...(FALLBACK_MATCHES[5] as MatchItem),
      id: "s3-dr-mosquito",
      matchNumStr: "周日003",
      home: "凯尔特人",
      away: "圣约翰",
      pools: {
        ...(FALLBACK_MATCHES[5] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HAD,
          selling: true,
          single: false,
          payoutRatio: 0.84,
          vig: 0.16,
          options: [
            { key: "h", label: "主胜", odds: 1.18, trend: 0, fairProb: 0.7 },
            { key: "d", label: "平", odds: 4.8, trend: 0, fairProb: 0.16 },
            { key: "a", label: "客胜", odds: 7.8, trend: 0, fairProb: 0.14 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HHAD,
          selling: true,
          single: false,
          goalLine: "+1",
          payoutRatio: 0.84,
          vig: 0.16,
          options: [
            { key: "hh", label: "让胜", odds: 1.03, trend: 0, fairProb: 0.81 },
            { key: "hd", label: "让平", odds: 6.8, trend: 0, fairProb: 0.11 },
            { key: "ha", label: "让负", odds: 11.0, trend: 0, fairProb: 0.08 },
          ],
        },
      },
    };

    // Pure objective -> prunes 凯尔特人 (@1.22 <= 1.45) and names it in reasons
    const objPlans = generateParetoPortfolio(
      [cleanA, cleanB, dragMosquito],
      100,
      "objective",
      false,
      []
    );
    const objSlot2 = objPlans[1] as ArchetypePlan;
    const objMatchIds = new Set(
      objSlot2.lines.flatMap((l) => l.legs.map((g) => g.matchId))
    );
    assert.equal(
      objMatchIds.has(dragMosquito.id),
      false,
      "Objective Slot ② must prune <= 1.45 mosquito drag match"
    );
    assert.equal(objMatchIds.has(cleanA.id), true);
    assert.equal(objMatchIds.has(cleanB.id), true);
    assert.ok(
      objSlot2.reasons.some(
        (r) => r.includes("凯尔特人") || r.includes("周日003")
      ),
      `Reasons must name pruned drag match, got: ${JSON.stringify(objSlot2.reasons)}`
    );

    // All matches <= 1.45 -> retains 1~2 best legs (never empty!) and names pruned matches
    const fourMosquitoes: MatchItem[] = [0, 1, 2, 3].map((idx) => ({
      ...dragMosquito,
      id: `s3-all-drag-${idx}`,
      matchNumStr: `周日10${idx + 1}`,
      home: `低赔队${idx + 1}`,
    }));
    const allDragSlot2 = generateParetoPortfolio(
      fourMosquitoes,
      100,
      "objective",
      false,
      []
    )[1] as ArchetypePlan;
    assert.ok(
      allDragSlot2.lines.length >= 1 && allDragSlot2.totalCost > 0,
      "Must retain 1-2 legs when all matches <= 1.45"
    );
    const retainedIds = new Set(
      allDragSlot2.lines.flatMap((l) => l.legs.map((g) => g.matchId))
    );
    assert.ok(
      retainedIds.size <= 2,
      `Should condense 4 mosquito matches to 1~2 legs, got ${retainedIds.size}`
    );

    // Anchored mode -> retains 凯尔特人 and puts ⚠️ drag-leg warning at reasons[0]!
    const anchoredSlot2 = generateParetoPortfolio(
      [cleanA, cleanB, dragMosquito],
      100,
      "objective",
      false,
      [
        makePick(cleanA, "HAD", "h"),
        makePick(cleanB, "HAD", "h"),
        makePick(dragMosquito, "HAD", "h"),
      ]
    )[1] as ArchetypePlan;
    const ancMatchIds = new Set(
      anchoredSlot2.lines.flatMap((l) => l.legs.map((g) => g.matchId))
    );
    assert.equal(
      ancMatchIds.has(dragMosquito.id),
      true,
      "Anchored Slot ② must NEVER drop user-anchored match"
    );
    assert.ok(
      anchoredSlot2.reasons[0]?.startsWith("⚠️"),
      `Anchored Slot ② must put ⚠️ drag warning at reasons[0], got: ${anchoredSlot2.reasons[0]}`
    );

    // 6. Slot ② statutory cap-clipping guard: splits 4-match high-odds parlay (> 500,000 cap) to shorter passes with 0 clipping
    const highFour: MatchItem[] = [0, 1, 2, 3].map((idx) => ({
      ...(FALLBACK_MATCHES[idx] as MatchItem),
      id: `s3-high4-${idx}`,
      matchNumStr: `周日20${idx + 1}`,
    }));
    const highCrsAnchors: SelectedPick[] = highFour.map((hm) => {
      const opt40 = hm.pools.CRS.options.find((o) => o.odds >= 35)!;
      return {
        matchId: hm.id,
        matchNumStr: hm.matchNumStr,
        home: hm.home,
        away: hm.away,
        poolCode: "CRS",
        poolName: "比分",
        singleAllowed: true,
        optionKey: opt40.key,
        optionLabel: opt40.label,
        odds: opt40.odds,
        fairProb: opt40.fairProb,
      };
    });
    const capSafeSlot2 = generateParetoPortfolio(
      highFour,
      100,
      "objective",
      false,
      highCrsAnchors
    )[1] as ArchetypePlan;
    const repCapSafe2 = archetypeToReport(capSafeSlot2, null, highFour);
    assert.equal(
      repCapSafe2.combos.every((c) => c.cappedClipped === 0),
      true,
      "Slot ② must split down pass sizes so zero payout is donated to statutory cap clipping"
    );
  });

  it("Slice 4: delivers Slot ③ Covering Designs C(v,k,t) (<=10 lines, 100% miss-1 guarantee) and Slot ④ Empirical-Bayes alpha-radar (honest ¥0 empty state, 36% guardrail, checkout legality & post-sync smoothed warning)", () => {
    const generateParetoPortfolio = (quantModule as Record<string, any>)
      .generateParetoPortfolio;

    // Helper to synthesize exact coherent 5-pool Sporttery match with optional lag
    const buildCoherentMatch = (
      id: string,
      numStr: string,
      lamH: number,
      lamA: number,
      opts?: {
        hadSingle?: boolean;
        hhadSingle?: boolean;
        lag?: {
          poolCode: "HHAD" | "TTG" | "HAFU" | "CRS";
          key: string;
          mult: number;
        };
      }
    ): MatchItem => {
      const pX = Array.from({ length: 11 }, (_, k) => {
        let f = 1;
        for (let i = 2; i <= k; i++) f *= i;
        return (Math.exp(-lamH) * Math.pow(lamH, k)) / f;
      });
      const pY = Array.from({ length: 11 }, (_, k) => {
        let f = 1;
        for (let i = 2; i <= k; i++) f *= i;
        return (Math.exp(-lamA) * Math.pow(lamA, k)) / f;
      });
      let h = 0,
        d = 0,
        a = 0,
        hh = 0,
        hd = 0,
        ha = 0;
      const ttg = Array(8).fill(0);
      const crsMap: Record<string, number> = {};
      for (const [, lbl] of OFFICIAL_CRS_PAIRS) crsMap[lbl] = 0;
      const explicitSet = new Set(
        OFFICIAL_CRS_PAIRS.map(([, l]: [string, string]) => l)
      );
      for (let x = 0; x <= 10; x++) {
        for (let y = 0; y <= 10; y++) {
          const p = pX[x] * pY[y];
          if (x > y) h += p;
          else if (x === y) d += p;
          else a += p;
          if (x - 1 > y) hh += p;
          else if (x - 1 === y) hd += p;
          else ha += p;
          ttg[Math.min(7, x + y)] += p;
          const lbl = `${x}:${y}`;
          if (explicitSet.has(lbl)) crsMap[lbl] += p;
          else if (x > y) crsMap["胜其它"] += p;
          else if (x === y) crsMap["平其它"] += p;
          else crsMap["负其它"] += p;
        }
      }
      const toOdds = (p: number, R: number, z: number) => {
        const V = 1 / R;
        const q = Math.sqrt(
          V * Math.max(1e-6, p) * ((1 - z) * Math.max(1e-6, p) + z)
        );
        return Number(Math.max(1.06, 1 / q).toFixed(2));
      };
      const raw: Record<string, any> = {
        matchId: id,
        matchNumStr: numStr,
        leagueAbbName: "精算联赛",
        matchTime: "21:00:00",
        homeTeamAbbName: `主${numStr}`,
        awayTeamAbbName: `客${numStr}`,
        poolList: [
          {
            poolCode: "HAD",
            single: opts?.hadSingle === false ? 0 : 1,
            cbtValue: 1,
          },
          {
            poolCode: "HHAD",
            single: opts?.hhadSingle === false ? 0 : 1,
            cbtValue: 1,
          },
          { poolCode: "TTG", single: 1, cbtValue: 1 },
          { poolCode: "HAFU", single: 0, cbtValue: 2, poolStatus: "Suspended" },
          { poolCode: "CRS", single: 1, cbtValue: 1 },
        ],
        had: {
          h: String(toOdds(h, 0.88, 0.05)),
          d: String(toOdds(d, 0.88, 0.05)),
          a: String(toOdds(a, 0.88, 0.05)),
        },
        hhad: {
          goalLine: "-1",
          h: String(toOdds(hh, 0.88, 0.05)),
          d: String(toOdds(hd, 0.88, 0.05)),
          a: String(toOdds(ha, 0.88, 0.05)),
        },
        ttg: Object.fromEntries(
          ttg.map((p, idx) => [`s${idx}`, String(toOdds(p, 0.8, 0.06))])
        ),
        crs: Object.fromEntries(
          OFFICIAL_CRS_PAIRS.map(([rawK, lbl]: [string, string]) => [
            rawK,
            String(toOdds(crsMap[lbl], 0.75, 0.08)),
          ])
        ),
      };
      // Align equivalent 0:0 & -1 handicap synthetic on baseline tight matches (< 3.0% arb) unless explicitly lagged
      raw.crs.s00s00 = raw.ttg.s0;
      const synDa = 1 / (1 / Number(raw.had.d) + 1 / Number(raw.had.a));
      const invHa = 1 / synDa;
      const remInv = Math.max(0.12, 1 / 0.88 - invHa);
      const rawInvHh = 1 / Number(raw.hhad.h);
      const rawInvHd = 1 / Number(raw.hhad.d);
      const scaleHd = remInv / (rawInvHh + rawInvHd);
      raw.hhad.a = synDa.toFixed(2);
      raw.hhad.h = Math.max(1.06, 1 / (rawInvHh * scaleHd)).toFixed(2);
      raw.hhad.d = Math.max(1.06, 1 / (rawInvHd * scaleHd)).toFixed(2);
      if (opts?.lag) {
        if (opts.lag.poolCode === "TTG") {
          raw.ttg[opts.lag.key] = String(
            Number((Number(raw.ttg[opts.lag.key]) * opts.lag.mult).toFixed(2))
          );
        } else if (opts.lag.poolCode === "HHAD") {
          raw.hhad[opts.lag.key] = String(
            Number((Number(raw.hhad[opts.lag.key]) * opts.lag.mult).toFixed(2))
          );
        } else if (opts.lag.poolCode === "CRS") {
          const pair = OFFICIAL_CRS_PAIRS.find(
            ([, l]: [string, string]) => l === opts.lag!.key
          )!;
          raw.crs[pair[0]] = String(
            Number((Number(raw.crs[pair[0]]) * opts.lag.mult).toFixed(2))
          );
        }
      }
      return parseSportteryRawJson({
        value: { matchInfoList: [{ subMatchList: [raw] }] },
      })[0];
    };

    // 1. Slot ③ max-cvar-wheel across 1 ~ 8 matches: <= 10 lines, all matches covered, 100% miss-1 positive payout!
    for (const v of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const subset = FALLBACK_MATCHES.slice(0, v) as MatchItem[];
      const slot3 = generateParetoPortfolio(
        subset,
        100,
        "objective",
        false,
        []
      )[2] as ArchetypePlan;
      assert.equal(slot3.key, "max-cvar-wheel");
      assert.equal(slot3.available, true);
      assert.ok(
        slot3.lines.length >= 2 && slot3.lines.length <= 10,
        `v=${v} wheel must have 2..10 lines, got ${slot3.lines.length}`
      );
      assert.ok(
        typeof slot3.missOneReturn === "number" && slot3.missOneReturn > 0,
        `v=${v} missOneReturn must be > 0`
      );

      if (v >= 2) {
        // Excluding any full-v kicker, covering blocks MUST cover every selected match AND survive missing ANY 1 match!
        const nonFullLines = slot3.lines.filter((l) => l.legs.length < v);
        assert.ok(
          nonFullLines.length >= 1,
          `v=${v} wheel must include shorter sub-parlay/single cushion blocks`
        );
        const coveredSet = new Set(
          nonFullLines.flatMap((l) => l.legs.map((g) => g.matchId))
        );
        for (const m of subset) {
          assert.equal(
            coveredSet.has(m.id),
            true,
            `v=${v} wheel blocks must cover match ${m.id}`
          );
          const payoutWhenMissed = Number(
            slot3.lines
              .filter((l) => !l.legs.some((g) => g.matchId === m.id))
              .reduce((a, l) => a + l.returnPayout, 0)
              .toFixed(2)
          );
          assert.ok(
            payoutWhenMissed > 0,
            `v=${v} wheel must yield > 0 return when match ${m.id} misses (got ${payoutWhenMissed})`
          );
        }
        const exactMinMissOne = Math.min(
          ...subset.map((m) =>
            Number(
              slot3.lines
                .filter((l) => !l.legs.some((g) => g.matchId === m.id))
                .reduce((a, l) => a + l.returnPayout, 0)
                .toFixed(2)
            )
          )
        );
        assert.equal(
          slot3.missOneReturn,
          exactMinMissOne,
          `v=${v} missOneReturn must equal exact min miss-1 payout`
        );
      }
    }

    // 6-match CRS-anchored wheel respects POOL_MAX_PASS (<= 4 legs) while still covering all 6 matches in <= 10 lines
    const sixMatches = FALLBACK_MATCHES.slice(0, 6) as MatchItem[];
    const sixCrsAnchors = sixMatches.map((m) => makePick(m, "CRS", "1:0"));
    const crsWheel = generateParetoPortfolio(
      sixMatches,
      100,
      "objective",
      false,
      sixCrsAnchors
    )[2] as ArchetypePlan;
    assert.ok(crsWheel.lines.length <= 10);
    assert.ok(
      crsWheel.lines.every((l) => l.legs.length <= 4),
      "CRS wheel lines must never exceed 4 legs"
    );
    const crsCovered = new Set(
      crsWheel.lines.flatMap((l) => l.legs.map((g) => g.matchId))
    );
    assert.equal(
      crsCovered.size,
      6,
      "6-match CRS wheel must cover all 6 matches"
    );
    assert.ok(crsWheel.missOneReturn! > 0);

    // 2. Slot ④ alpha-radar: Honest Empty State on tightly priced slate
    const tightA = buildCoherentMatch("s4-tight-a", "周六101", 1.45, 1.15);
    const tightB = buildCoherentMatch("s4-tight-b", "周六102", 1.25, 1.3);
    const tightSlot4 = generateParetoPortfolio(
      [tightA, tightB],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(tightSlot4.key, "alpha-radar");
    assert.equal(tightSlot4.available, false);
    assert.equal(tightSlot4.alphaKind, "none");
    assert.equal(tightSlot4.lines.length, 0);
    assert.equal(tightSlot4.totalCost, 0);
    assert.equal(tightSlot4.savedCash, 100);
    assert.equal(tightSlot4.winProb, 0);
    assert.equal(tightSlot4.profitProb, 0);
    assert.ok(
      tightSlot4.emptyReason?.includes("无跨盘错价洼地") &&
        tightSlot4.emptyReason?.includes("¥100")
    );

    // Extreme longshot Winner's Curse guard: inflating CRS 2:5 (@180 -> @250) must NOT hallucinate alpha!
    const longshotTrap = buildCoherentMatch(
      "s4-longshot",
      "周六103",
      1.45,
      1.15,
      {
        lag: { poolCode: "CRS", key: "2:5", mult: 1.5 },
      }
    );
    const trapSlot4 = generateParetoPortfolio(
      [longshotTrap, tightB],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(
      trapSlot4.available,
      false,
      "Winner-curse shrinkage cap must block extreme longshot tail artifact"
    );

    // Single-match non-single checkout legality gate: HHAD +EV lag on single=false alone CANNOT check out!
    const nonSingleAlphaAlone = buildCoherentMatch(
      "s4-nonsingle",
      "周六104",
      1.45,
      1.15,
      {
        hadSingle: false,
        hhadSingle: false,
        lag: { poolCode: "HHAD", key: "a", mult: 1.48 },
      }
    );
    const blockedSingleAlpha = generateParetoPortfolio(
      [nonSingleAlphaAlone],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(
      blockedSingleAlpha.available,
      false,
      "Single-match non-single pool alpha candidate cannot check out alone at Sporttery shop"
    );
    const pairedNonSingleAlpha = generateParetoPortfolio(
      [nonSingleAlphaAlone, tightB],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(
      pairedNonSingleAlpha.available,
      true,
      "Same non-single HHAD +EV lag candidate becomes checkout-legal when paired into a +EV 2串1 with a 2nd match"
    );
    assert.ok((pairedNonSingleAlpha.expectedValueRate ?? 0) > 0);

    // 3. Sub-pool lag below pure +EV gate (mult=1.24 -> O*p < 1.01) stays honestly empty (Spec 0009 D-04 remediation)
    const relAlphaMatch = buildCoherentMatch(
      "s4-rel-alpha",
      "周六105",
      1.5,
      1.1,
      {
        lag: { poolCode: "TTG", key: "s2", mult: 1.24 },
      }
    );
    const subThresholdSlot4 = generateParetoPortfolio(
      [relAlphaMatch, tightB],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(subThresholdSlot4.available, false);

    // 4. Slot ④ positive-ev (O*p_shrunk >= 1.01 & expectedValueRate > 0) + 36% light-position guardrail vs unlockFullAgg
    const posEvMatch = buildCoherentMatch("s4-posev", "周六106", 1.5, 1.1, {
      lag: { poolCode: "TTG", key: "s2", mult: 1.62 },
    });
    const posEvSlot4Guarded = generateParetoPortfolio(
      [posEvMatch, tightB],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(posEvSlot4Guarded.available, true);
    assert.equal(posEvSlot4Guarded.alphaKind, "positive-ev");
    assert.ok(posEvSlot4Guarded.badge.includes("+EV"));
    assert.ok(
      posEvSlot4Guarded.totalCost > 0 && posEvSlot4Guarded.totalCost <= 44,
      `Expected <=44 guarded cost, got ${posEvSlot4Guarded.totalCost}`
    );
    assert.equal(
      posEvSlot4Guarded.savedCash,
      100 - posEvSlot4Guarded.totalCost
    );

    const posEvSlot4Unlocked = generateParetoPortfolio(
      [posEvMatch, tightB],
      100,
      "objective",
      true,
      []
    )[3] as ArchetypePlan;
    assert.equal(posEvSlot4Unlocked.available, true);
    assert.ok(
      posEvSlot4Unlocked.totalCost >= 88,
      `Unlocked alpha-radar should deploy full budget, got ${posEvSlot4Unlocked.totalCost}`
    );

    // 5. Post-Sync Smoothed-Alpha Degradation in evaluateQuantWorkspace
    // (a) With snapshotPlan after sync smooths out the lag -> keeps tickets at live odds AND prepends 'alpha-smoothed' warning!
    const syncedTightPosEv = buildCoherentMatch(
      "s4-posev",
      "周六106",
      1.5,
      1.1
    ); // lag smoothed!
    const wsAfterSync = evaluateQuantWorkspace(
      {
        picks: [makePick(syncedTightPosEv, "TTG", "s2")],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "alpha-radar",
          snapshotPlan: posEvSlot4Guarded,
          scaleMultiple: 1,
        },
        targetIds: [syncedTightPosEv.id, tightB.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [syncedTightPosEv, tightB]
    );
    assert.ok(
      wsAfterSync.appliedPlan,
      "Must preserve frozen snapshotPlan tickets after odds sync"
    );
    assert.equal(wsAfterSync.effectiveReport.warnings[0]?.id, "alpha-smoothed");
    assert.equal(
      wsAfterSync.effectiveReport.warnings[0]?.title,
      "⚠️ 原跨盘错价洼地已被官方最新调水抚平，建议还原等倍或改选前 3 档主方案"
    );
    assert.ok(wsAfterSync.allWarnings.some((w) => w.id === "alpha-smoothed"));
    assert.ok(
      wsAfterSync.effectiveReport.maxPayout < posEvSlot4Guarded.maxReturn,
      "Live payout after lag smoothing must reflect lowered official odds"
    );

    // (b) Without snapshotPlan when live alpha-radar is unavailable -> appliedPlan MUST be null & fall back to manualReport!
    const manualPicksOnTight = [
      makePick(tightA, "HAD", "h"),
      makePick(tightB, "HAD", "h"),
    ];
    const wsEmptyAlphaFallback = evaluateQuantWorkspace(
      {
        picks: manualPicksOnTight,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "archetype", key: "alpha-radar" },
        targetIds: [tightA.id, tightB.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [tightA, tightB]
    );
    assert.equal(wsEmptyAlphaFallback.appliedPlan, null);
    assert.equal(
      wsEmptyAlphaFallback.effectiveReport,
      wsEmptyAlphaFallback.manualReport
    );
  });

  it("Slice 5: completes full 8-match workspace evaluation (manual multi-pass + 3+1 Pareto portfolio + applied plan sandbox + staggered hedge) in < 15ms", () => {
    const eightMatches = FALLBACK_MATCHES as MatchItem[];
    assert.equal(eightMatches.length, 8);
    const eightPicks: SelectedPick[] = eightMatches.map((m) =>
      makePick(m, "HAD", "h")
    );
    const allTargetIds = eightMatches.map((m) => m.id);

    // Warm up V8 JIT
    for (let w = 0; w < 5; w++) {
      evaluateQuantWorkspace(
        {
          picks: eightPicks,
          multiple: 5,
          passSpec: { mode: "combo", comboCode: "8x9" },
          subjectiveDeltaPct: 8,
          simVoidFirstMatch: false,
          planSpec: {
            kind: "archetype",
            key: "max-cvar-wheel",
            scaleMultiple: 1,
          },
          targetIds: allTargetIds,
          anchorToRadarPicks: true,
          budget: 120,
          stance: "home-lean",
          unlockFullAgg: false,
        },
        eightMatches
      );
    }

    const runs = 40;
    const t0 = performance.now();
    let lastWs = null;
    for (let i = 0; i < runs; i++) {
      lastWs = evaluateQuantWorkspace(
        {
          picks: eightPicks,
          multiple: 5,
          passSpec: { mode: "combo", comboCode: "8x9" },
          subjectiveDeltaPct: (i % 5) * 4 - 8,
          simVoidFirstMatch: i % 2 === 1,
          planSpec: {
            kind: "archetype",
            key: "max-cvar-wheel",
            scaleMultiple: 1,
          },
          targetIds: allTargetIds,
          anchorToRadarPicks: true,
          budget: 120,
          stance:
            i % 3 === 0
              ? "objective"
              : i % 3 === 1
                ? "home-lean"
                : "upset-watch",
          unlockFullAgg: false,
        },
        eightMatches
      );
    }
    const avgMs = (performance.now() - t0) / runs;
    assert.ok(lastWs);
    assert.equal(lastWs.portfolioPlans.length, 4);
    assert.ok(
      avgMs < 15,
      `Expected 8-match evaluateQuantWorkspace < 15ms, got ${avgMs.toFixed(3)}ms`
    );
  });
});
