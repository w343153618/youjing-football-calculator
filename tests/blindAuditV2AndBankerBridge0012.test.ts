import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_MATCHES,
  calibrateMatchCoherentModel,
  computeProOrderInsights,
  computeTruthReport,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  optimizeBonusPlan,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import type {
  MatchItem,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

function makePick(
  m: MatchItem,
  poolCode: PoolCode,
  optionKeyOrLabel: string
): SelectedPick {
  const pool = m.pools[poolCode];
  const opt = pool.options.find(
    (o) => o.key === optionKeyOrLabel || o.label === optionKeyOrLabel
  )!;
  assert.ok(opt, `Option ${optionKeyOrLabel} missing on ${m.id}:${poolCode}`);
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: Boolean(pool.single),
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

const LIVE_FRI008_RAW = {
  matchId: 2042886,
  matchNumStr: "周五008",
  homeTeamAbbName: "毕尔巴鄂",
  awayTeamAbbName: "西班牙人",
  leagueAbbName: "西甲",
  matchTime: "04:00:00",
  poolList: [
    {
      poolCode: "HAD",
      bettingAllup: 1,
      bettingSingle: 0,
      poolStatus: "Selling",
    },
    {
      poolCode: "HHAD",
      bettingAllup: 1,
      bettingSingle: 0,
      poolStatus: "Selling",
    },
    {
      poolCode: "HAFU",
      bettingAllup: 1,
      bettingSingle: 1,
      poolStatus: "Selling",
    },
    {
      poolCode: "TTG",
      bettingAllup: 1,
      bettingSingle: 1,
      poolStatus: "Selling",
    },
    {
      poolCode: "CRS",
      bettingAllup: 1,
      bettingSingle: 1,
      poolStatus: "Selling",
    },
  ],
  had: {
    h: "1.26",
    d: "4.70",
    a: "7.50",
    hf: "0",
    df: "0",
    af: "0",
    updateDate: "2026-11-20",
    updateTime: "21:41:50",
  },
  hhad: {
    goalLine: "-1",
    h: "2.34",
    d: "2.70",
    a: "2.93",
    hf: "0",
    df: "0",
    af: "0",
    updateDate: "2026-11-20",
    updateTime: "21:41:55",
  },
  ttg: {
    s0: "16.00",
    s1: "6.10",
    s2: "3.10",
    s3: "3.30",
    s4: "5.00",
    s5: "9.50",
    s6: "17.00",
    s7: "26.00",
    updateDate: "2026-11-20",
    updateTime: "18:36:59",
  },
  hafu: {
    hh: "1.78",
    hd: "21.00",
    ha: "60.00",
    dh: "3.85",
    dd: "7.35",
    da: "15.00",
    ah: "26.00",
    ad: "21.00",
    aa: "12.50",
    updateDate: "2026-11-20",
    updateTime: "20:15:11",
  },
  crs: {
    s00s00: "16.00",
    s00s01: "20.00",
    s00s02: "42.00",
    s00s03: "100.0",
    s00s04: "400.0",
    s00s05: "800.0",
    s01s00: "6.25",
    s01s01: "7.50",
    s01s02: "19.00",
    s01s03: "75.00",
    s01s04: "250.0",
    s01s05: "600.0",
    s02s00: "6.00",
    s02s01: "6.00",
    s02s02: "16.00",
    s02s03: "55.00",
    s02s04: "250.0",
    s02s05: "600.0",
    s03s00: "8.75",
    s03s01: "9.25",
    s03s02: "21.00",
    s03s03: "70.00",
    s04s00: "17.00",
    s04s01: "18.00",
    s04s02: "41.00",
    s05s00: "42.00",
    s05s01: "45.00",
    s05s02: "80.00",
    s1sh: "28.00",
    s1sd: "350.0",
    s1sa: "250.0",
    updateDate: "2026-11-20",
    updateTime: "22:01:40",
  },
};

describe("Spec 0012 · Blind Audit V2 Actuarial Remediation, Banker Parlay, Bridge Finder & Honest UI", () => {
  it("Slice 01 · Seam 1: eliminates false Poisson +EV hallucination on live 周五008 via timestamp & cross-pool corroboration, reconciles deep integer handicaps (±2/±3), and flags <72% mixed-parlay vig", () => {
    // 1a. Live 周五008 (毕尔巴鄂 vs 西班牙人): CRS (22:01:40) is newer than HAD (21:41:50) & TTG (18:36:59)
    //     and prices 1:0@6.25 + 0:1@20.00 (~15.2% -> 6.10*0.152 = 0.927 < 1.00). Must NOT hallucinate +EV on TTG 1球@6.10!
    const [fri008] = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: [LIVE_FRI008_RAW] }] },
    }) as MatchItem[];
    assert.ok(
      !fri008.microQuant!.alphaScanSummary.includes("+EV") ||
        fri008.microQuant!.alphaScanSummary.includes("无跨盘错价洼地"),
      `Expected live 周五008 to NOT hallucinate +EV, got: ${fri008.microQuant!.alphaScanSummary}`
    );

    const wsFri008 = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [fri008.id, FALLBACK_MATCHES[1].id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [fri008, FALLBACK_MATCHES[1] as MatchItem]
    );
    const alphaSlotFri = wsFri008.portfolioPlans[3];
    assert.equal(alphaSlotFri.key, "alpha-radar");
    assert.equal(
      alphaSlotFri.available,
      false,
      `Expected Slot ④ alpha-radar empty on 周五008, got lines: ${JSON.stringify(alphaSlotFri.lines)}`
    );

    // 1b. Newer sub-pool drift (TTG updated at 22:30:00 AFTER HAD 21:00:00) must NOT be misclassified as stale lag
    const newerTtgDriftRaw = {
      ...LIVE_FRI008_RAW,
      matchId: 2042991,
      matchNumStr: "周五091",
      had: { ...LIVE_FRI008_RAW.had, updateTime: "21:00:00" },
      hhad: { ...LIVE_FRI008_RAW.hhad, updateTime: "21:00:05" },
      crs: {
        ...LIVE_FRI008_RAW.crs,
        s01s00: "4.60",
        s00s01: "14.00",
        updateTime: "21:00:10",
      },
      ttg: {
        ...LIVE_FRI008_RAW.ttg,
        s1: "6.40",
        updateTime: "22:30:00", // TTG moved 90 mins AFTER main & CRS!
      },
    };
    const [newerTtgDrift] = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: [newerTtgDriftRaw] }] },
    }) as MatchItem[];
    const wsNewerDrift = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [newerTtgDrift.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [newerTtgDrift]
    );
    assert.equal(
      wsNewerDrift.portfolioPlans[3].available,
      false,
      "Sub-pool updated 90 mins AFTER main pool is leading market movement, NOT stale lag"
    );

    // 1c. Genuine >=30m lag corroborated by newer HAD + CRS DOES trigger Slot ④ +EV!
    const genuineLagRaw = {
      ...LIVE_FRI008_RAW,
      matchId: 2042992,
      matchNumStr: "周五092",
      had: { ...LIVE_FRI008_RAW.had, updateTime: "22:10:00" },
      hhad: { ...LIVE_FRI008_RAW.hhad, updateTime: "22:10:05" },
      crs: {
        ...LIVE_FRI008_RAW.crs,
        s02s00: "4.20",
        s01s01: "5.20",
        s00s02: "18.00",
        updateTime: "22:10:15",
      },
      ttg: {
        ...LIVE_FRI008_RAW.ttg,
        s2: "5.10", // Stale TTG from 18:36:59 while HAD/CRS at 22:10 price 2球 at ~30%!
        updateTime: "18:36:59",
      },
    };
    const [genuineLag] = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: [genuineLagRaw] }] },
    }) as MatchItem[];
    const wsGenuineLag = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [genuineLag.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [genuineLag]
    );
    assert.equal(
      wsGenuineLag.portfolioPlans[3].available,
      true,
      "Genuine >=30m TTG lag corroborated by newer HAD & CRS must trigger +EV radar"
    );

    // 2. Deep integer handicaps (goalLine = -2, +2, -3): partition-consistent reconciliation & subset monotonicity
    // Construct contradictory raw HHAD(-2) where raw devigged (hh + hd) slightly exceeds raw HAD(h);
    // reconciled calibration must enforce exact subset identity P(hh) + P(hd) + P(diff === 1) === P(h)
    // and strictly pull P(hh)+P(hd) below standalone HHAD devigged sum!
    const deepContradictMinus2: MatchItem = {
      ...(FALLBACK_MATCHES[5] as MatchItem),
      id: "deep-gl-minus2",
      pools: {
        ...(FALLBACK_MATCHES[5] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.45, trend: 0, fairProb: 0.62 },
            { key: "d", label: "平", odds: 4.2, trend: 0, fairProb: 0.21 },
            { key: "a", label: "客胜", odds: 5.5, trend: 0, fairProb: 0.17 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HHAD,
          selling: true,
          goalLine: "-2",
          name: "让球(-2)",
          options: [
            { key: "hh", label: "让胜", odds: 2.1, trend: 0, fairProb: 0.43 },
            { key: "hd", label: "让平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "ha", label: "让负", odds: 2.9, trend: 0, fairProb: 0.31 },
          ],
        },
        HAFU: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HAFU,
          selling: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.TTG,
          selling: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.CRS,
          selling: false,
        },
      },
    };
    const calM2 = calibrateMatchCoherentModel(deepContradictMinus2);
    const gridDim = Math.round(Math.sqrt(calM2.scoreGrid.length));
    const sumDiff = (pred: (diff: number) => boolean) => {
      let s = 0;
      for (let x = 0; x < gridDim; x++) {
        for (let y = 0; y < gridDim; y++) {
          if (pred(x - y)) s += calM2.scoreGrid[x * gridDim + y];
        }
      }
      return s;
    };
    const pDiffEq1 = sumDiff((d) => d === 1);
    assert.ok(
      Math.abs(
        calM2.poolProbs.HHAD.hh +
          calM2.poolProbs.HHAD.hd +
          pDiffEq1 -
          calM2.poolProbs.HAD.h
      ) < 1e-12
    );
    // Without goalLine=-2 partition reconciliation, HHAD(hh+hd) (~0.69) + pDiffEq1 pulls HAD(h) above 0.74 (>12pp above HAD's 0.62)!
    // With partition reconciliation on goalLine=-2, HAD(h) must stay anchored near the reconciled consensus (< 0.70)!
    assert.ok(
      calM2.poolProbs.HAD.h < 0.7,
      `Expected goalLine=-2 partition reconciliation to prevent unanchored HHAD inflation of HAD.h, got ${calM2.poolProbs.HAD.h}`
    );

    const deepPlus2: MatchItem = {
      ...deepContradictMinus2,
      id: "deep-gl-plus2",
      pools: {
        ...deepContradictMinus2.pools,
        HAD: {
          ...deepContradictMinus2.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 5.5, trend: 0, fairProb: 0.17 },
            { key: "d", label: "平", odds: 4.2, trend: 0, fairProb: 0.21 },
            { key: "a", label: "客胜", odds: 1.45, trend: 0, fairProb: 0.62 },
          ],
        },
        HHAD: {
          ...deepContradictMinus2.pools.HHAD,
          goalLine: "+2",
          name: "让球(+2)",
          options: [
            { key: "hh", label: "让胜", odds: 2.9, trend: 0, fairProb: 0.31 },
            { key: "hd", label: "让平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "ha", label: "让负", odds: 2.1, trend: 0, fairProb: 0.43 },
          ],
        },
      },
    };
    const calP2 = calibrateMatchCoherentModel(deepPlus2);
    assert.ok(
      calP2.poolProbs.HAD.a < 0.7,
      `Expected goalLine=+2 symmetric partition reconciliation on HAD.a, got ${calP2.poolProbs.HAD.a}`
    );

    const deepMinus3: MatchItem = {
      ...deepContradictMinus2,
      id: "deep-gl-minus3",
      pools: {
        ...deepContradictMinus2.pools,
        HHAD: {
          ...deepContradictMinus2.pools.HHAD,
          goalLine: "-3",
          name: "让球(-3)",
        },
      },
    };
    const calM3 = calibrateMatchCoherentModel(deepMinus3);
    const pDiff1Or2 = sumDiff.call(null, (d) => d === 1 || d === 2);
    let m3Bridge = 0;
    for (let x = 0; x < gridDim; x++) {
      for (let y = 0; y < gridDim; y++) {
        if (x - y === 1 || x - y === 2) {
          m3Bridge += calM3.scoreGrid[x * gridDim + y];
        }
      }
    }
    void pDiff1Or2;
    assert.ok(
      Math.abs(
        calM3.poolProbs.HHAD.hh +
          calM3.poolProbs.HHAD.hd +
          m3Bridge -
          calM3.poolProbs.HAD.h
      ) < 1e-12
    );

    // 3. High-vig 2-leg mixed parlay (HAD ~0.88 x TTG ~0.80 -> avgPayoutRatio ~ 0.705 in [0.65, 0.72), avgPassLen = 2)
    //    MUST trigger "parlay-vig" warning (previously missed because old threshold was < 0.65), while 1-leg CRS single does NOT!
    const mA = FALLBACK_MATCHES[1] as MatchItem;
    const mB = FALLBACK_MATCHES[3] as MatchItem;
    const mixedHighVig2Parlay = computeTruthReport(
      [makePick(mA, "HAD", "h"), makePick(mB, "TTG", "s2")],
      5,
      [mA, mB]
    );
    assert.ok(
      mixedHighVig2Parlay.avgPayoutRatio >= 0.65 &&
        mixedHighVig2Parlay.avgPayoutRatio < 0.72,
      `Expected 2-leg HADxCRS avgPayoutRatio in [0.65, 0.72), got ${mixedHighVig2Parlay.avgPayoutRatio}`
    );
    assert.equal(
      mixedHighVig2Parlay.warnings.some((w) => w.id === "parlay-vig"),
      true,
      "2-leg mixed parlay with avgPayoutRatio < 0.72 must emit parlay-vig warning"
    );

    const singleCrsRep = computeTruthReport([makePick(mA, "CRS", "1:0")], 5, [
      mA,
    ]);
    assert.equal(
      singleCrsRep.warnings.some((w) => w.id === "parlay-vig"),
      false,
      "1-leg single CRS ticket must not emit parlay-vig warning"
    );
  });

  it("Slice 02 · Seam 1: enforces strict budget sovereignty on Three-Mode Bonus Optimization, unlocks 999x logical multiples without [99,99] truncation, supports explicit upgradeToBreakeven (<=512 bets), optimizes M串N joint floor, and consolidates shop tickets", () => {
    // 1. ¥1,000 (250x) 2-pick single slip [1.35, 4.75]: fixes [99, 99] truncation bug!
    const highBudgetMatch: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "s2-1000-single",
      pools: {
        ...(FALLBACK_MATCHES[1] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.35, trend: 0, fairProb: 0.66 },
            { key: "d", label: "平", odds: 4.75, trend: 0, fairProb: 0.19 },
            { key: "a", label: "客胜", odds: 6.8, trend: 0, fairProb: 0.15 },
          ],
        },
      },
    };
    const picks1000 = [
      makePick(highBudgetMatch, "HAD", "h"),
      makePick(highBudgetMatch, "HAD", "d"),
    ];
    const manual1000 = computeTruthReport(picks1000, 250, [highBudgetMatch]);
    assert.equal(manual1000.totalCost, 1000);
    const eq1000 = optimizeBonusPlan(manual1000, [highBudgetMatch], "equal")!;
    assert.equal(
      eq1000.totalCost,
      1000,
      `Expected exact ¥1,000 budget preserved, got ¥${eq1000.totalCost}`
    );
    assert.equal(
      eq1000.underwaterCount,
      0,
      `Expected 0 underwater on ¥1,000 [1.35, 4.75] Dutching, got ${eq1000.underwaterCount}`
    );
    const favLine1000 = eq1000.lines.find((l) => l.legs[0].optionKey === "h")!;
    assert.ok(
      favLine1000.multiple >= 371 && favLine1000.multiple <= 999,
      `Favorite @1.35 must receive >=371 logical multiples (not clamped at 99!), got ${favLine1000.multiple}`
    );
    const ws1000 = evaluateQuantWorkspace(
      {
        picks: picks1000,
        multiple: 250,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: [highBudgetMatch.id],
        budget: 1000,
        stance: "objective",
        unlockFullAgg: false,
      },
      [highBudgetMatch]
    );
    assert.ok(
      ws1000.effectiveReport.consolidatedTickets >= 6,
      `Expected 99x physical shop ticket split >= 6, got ${ws1000.effectiveReport.consolidatedTickets}`
    );

    // 2. 27-bet 3串1 HAD box at 1x (¥54):
    //    1/2.15 + 1/3.60 + 1/4.60 = 0.960 -> effOdds = 1.13 > 1.03, while 2.15^3 * 2 = ¥19.88 < ¥54 at 1x!
    const three27Feasible: MatchItem[] = [0, 1, 2].map((idx) => ({
      ...(FALLBACK_MATCHES[idx] as MatchItem),
      id: `s2-feas27-${idx}`,
      pools: {
        ...(FALLBACK_MATCHES[idx] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[idx] as MatchItem).pools.HAD,
          selling: true,
          single: false,
          options: [
            { key: "h", label: "主胜", odds: 2.15, trend: 0, fairProb: 0.43 },
            { key: "d", label: "平", odds: 3.6, trend: 0, fairProb: 0.29 },
            { key: "a", label: "客胜", odds: 4.6, trend: 0, fairProb: 0.28 },
          ],
        },
      },
    }));
    const feas27Picks = three27Feasible.flatMap((m) =>
      m.pools.HAD.options.map((o) => makePick(m, "HAD", o.key))
    );
    const manualFeas27 = computeTruthReport(feas27Picks, 1, three27Feasible, {
      mode: "free",
      passSizes: [3],
    });
    assert.equal(manualFeas27.betCount, 27);
    assert.equal(manualFeas27.totalCost, 54);
    assert.ok(
      typeof manualFeas27.breakevenUpgradeCost === "number" &&
        manualFeas27.breakevenUpgradeCost > 54 &&
        manualFeas27.breakevenUpgradeCost <= 500,
      `Expected exact breakevenUpgradeCost on 27-bet slip (>24 bets!), got ${manualFeas27.breakevenUpgradeCost}`
    );

    for (const mode of ["equal", "hot-first", "cold-first"] as const) {
      const wsLocked = evaluateQuantWorkspace(
        {
          picks: feas27Picks,
          multiple: 1,
          passSpec: { mode: "free", passSizes: [3] },
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: { kind: "bonus", optMode: mode, scaleMultiple: 1 },
          targetIds: three27Feasible.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        three27Feasible
      );
      assert.ok(
        wsLocked.effectiveReport.totalCost <= 54,
        `Mode ${mode} MUST strictly obey user's ¥54 budget by default, got ¥${wsLocked.effectiveReport.totalCost}`
      );
      assert.ok(wsLocked.effectiveReport.underwaterCount > 0);
      assert.ok(
        !wsLocked.appliedPlan!.title.includes("稳赚") &&
          !wsLocked.appliedPlan!.reasons.some((r) =>
            r.includes("彻底消灭假中奖倒贴")
          ),
        `Mode ${mode} must NOT claim 稳赚 / 彻底消灭假中奖倒贴 when underwaterCount > 0: title=${wsLocked.appliedPlan!.title}`
      );
    }

    const wsUpgraded = evaluateQuantWorkspace(
      {
        picks: feas27Picks,
        multiple: 1,
        passSpec: { mode: "free", passSizes: [3] },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode: "equal",
          scaleMultiple: 1,
          upgradeToBreakeven: true,
        } as any,
        targetIds: three27Feasible.map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      three27Feasible
    );
    assert.equal(
      wsUpgraded.effectiveReport.totalCost,
      manualFeas27.breakevenUpgradeCost
    );
    assert.equal(
      wsUpgraded.effectiveReport.underwaterCount,
      0,
      "Explicit upgradeToBreakeven: true must eliminate 100% of underwater outcomes"
    );

    // 3. Non-disjoint M串N (asymmetric 3串3 on [1.40, 1.80, 2.80] at 5x = ¥30):
    //    Equal 5x has [5,5,5] where 1.40*1.80*2*5 = ¥25.20 < ¥30 (1 underwater scenario);
    //    Joint-bucket optimizeBonusPlan(..., "equal") reallocates within exact ¥30 (e.g. [7,5,3]) -> 0 underwater!
    const asym3x3Matches: MatchItem[] = [
      [1.4, 4.1, 6.2, 0.64],
      [1.8, 3.4, 3.9, 0.49],
      [2.8, 3.1, 2.35, 0.32],
    ].map(([oh, od, oa, ph], idx) => ({
      ...(FALLBACK_MATCHES[idx] as MatchItem),
      id: `s2-asym3x3-${idx}`,
      pools: {
        ...(FALLBACK_MATCHES[idx] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[idx] as MatchItem).pools.HAD,
          selling: true,
          single: false,
          options: [
            { key: "h", label: "主胜", odds: oh, trend: 0, fairProb: ph },
            {
              key: "d",
              label: "平",
              odds: od,
              trend: 0,
              fairProb: (1 - ph) * 0.5,
            },
            {
              key: "a",
              label: "客胜",
              odds: oa,
              trend: 0,
              fairProb: (1 - ph) * 0.5,
            },
          ],
        },
      },
    }));
    const asym3x3Picks = asym3x3Matches.map((m) => makePick(m, "HAD", "h"));
    const manualAsym3x3 = computeTruthReport(asym3x3Picks, 5, asym3x3Matches, {
      mode: "combo",
      comboCode: "3x3",
    });
    assert.equal(manualAsym3x3.totalCost, 30);
    assert.equal(manualAsym3x3.underwaterCount, 1);

    const wsAsym3x3Opt = evaluateQuantWorkspace(
      {
        picks: asym3x3Picks,
        multiple: 5,
        passSpec: { mode: "combo", comboCode: "3x3" },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: asym3x3Matches.map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      asym3x3Matches
    );
    assert.equal(wsAsym3x3Opt.effectiveReport.totalCost, 30);
    assert.equal(
      wsAsym3x3Opt.effectiveReport.underwaterCount,
      0,
      `Joint-bucket 3串3 bonus optimization within ¥30 must lift worst miss-1 payout >= ¥30, got minPayout=${wsAsym3x3Opt.effectiveReport.minPayout}`
    );

    // 4. Smart ticket consolidation (consolidateTickets: true): clusters close-multiple lines into fewer batches while preserving exact totalCost & zero underwater
    const closeMultMatchA: MatchItem = {
      ...(FALLBACK_MATCHES[0] as MatchItem),
      id: "s2-cons-a",
      pools: {
        ...(FALLBACK_MATCHES[0] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.22, trend: 0, fairProb: 0.41 },
            { key: "d", label: "平", odds: 2.3, trend: 0, fairProb: 0.39 },
            { key: "a", label: "客胜", odds: 4.9, trend: 0, fairProb: 0.2 },
          ],
        },
      },
    };
    const closeMultMatchB: MatchItem = {
      ...(FALLBACK_MATCHES[2] as MatchItem),
      id: "s2-cons-b",
      pools: {
        ...(FALLBACK_MATCHES[2] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[2] as MatchItem).pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.25, trend: 0, fairProb: 0.4 },
            { key: "d", label: "平", odds: 2.32, trend: 0, fairProb: 0.38 },
            { key: "a", label: "客胜", odds: 4.8, trend: 0, fairProb: 0.22 },
          ],
        },
      },
    };
    const close4Picks = [
      makePick(closeMultMatchA, "HAD", "h"),
      makePick(closeMultMatchA, "HAD", "d"),
      makePick(closeMultMatchB, "HAD", "h"),
      makePick(closeMultMatchB, "HAD", "d"),
    ];
    const wsExact4 = evaluateQuantWorkspace(
      {
        picks: close4Picks,
        multiple: 25, // 4 bets * 25x = 100 notes = ¥200 ([26, 25, 25, 24] -> [25, 25, 25, 25], 2.47% <= 3% floor delta!)
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode: "equal",
          scaleMultiple: 1,
          consolidateTickets: false,
        } as any,
        targetIds: [closeMultMatchA.id, closeMultMatchB.id],
        budget: 200,
        stance: "objective",
        unlockFullAgg: false,
      },
      [closeMultMatchA, closeMultMatchB]
    );
    const wsCons4 = evaluateQuantWorkspace(
      {
        picks: close4Picks,
        multiple: 25,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode: "equal",
          scaleMultiple: 1,
          consolidateTickets: true,
        } as any,
        targetIds: [closeMultMatchA.id, closeMultMatchB.id],
        budget: 200,
        stance: "objective",
        unlockFullAgg: false,
      },
      [closeMultMatchA, closeMultMatchB]
    );
    assert.equal(wsCons4.effectiveReport.totalCost, 200);
    assert.equal(wsCons4.effectiveReport.underwaterCount, 0);
    const exactDistinctMults = new Set(
      wsExact4.appliedPlan!.lines.map((l) => l.multiple)
    ).size;
    const consDistinctMults = new Set(
      wsCons4.appliedPlan!.lines.map((l) => l.multiple)
    ).size;
    assert.ok(
      consDistinctMults < exactDistinctMults,
      `Expected consolidateTickets: true to merge close multiples into fewer batches (${consDistinctMults} < ${exactDistinctMults})`
    );
    assert.ok(
      wsCons4.effectiveReport.minPayout >=
        wsExact4.effectiveReport.minPayout * 0.97 - 1e-6,
      `Consolidated floor (${wsCons4.effectiveReport.minPayout}) must stay within <=3% of exact floor (${wsExact4.effectiveReport.minPayout})`
    );
    assert.equal(
      wsCons4.appliedPlan!.consolidatedLines?.length,
      1,
      "Four uniform-multiple 2x2 compound lines must merge into 1 single Sporttery compound slip in consolidatedLines"
    );
    assert.ok(
      wsCons4.effectiveReport.consolidatedTickets <
        wsExact4.effectiveReport.consolidatedTickets,
      `Expected consolidated shop ticket count (${wsCons4.effectiveReport.consolidatedTickets}) < unmerged (${wsExact4.effectiveReport.consolidatedTickets})`
    );
  });

  it("Slice 03 · Seam 1: enforces unanchored Slot ① full-slate retention across 2..8 matches with 1~2-match benchmark note, closes ¥5,000+ budget accounting, splits strictNetGainProb vs breakEvenProb, and locks objective* metrics under stance/slider beauty filters", () => {
    // 1. Unanchored Slot ① (max-profit-prob) MUST retain ALL M user-selected matches across M = 2..8 (never silently dropping M-1 matches to bet 1 single!)
    for (const mCount of [2, 3, 4, 6, 8]) {
      const sub = (FALLBACK_MATCHES as MatchItem[]).slice(0, mCount);
      const plans = generateParetoPortfolio(sub, 120, "objective", false, []);
      const slot1 = plans[0];
      assert.equal(slot1.key, "max-profit-prob");
      assert.equal(slot1.available, true);
      assert.equal(slot1.underwaterCount, 0);
      const distinctMatches = new Set(
        slot1.lines.flatMap((l: any) => l.legs.map((g: any) => g.matchId))
      );
      assert.equal(
        distinctMatches.size,
        mCount,
        `Unanchored Slot ① on M=${mCount} matches must retain all ${mCount} matches, got ${distinctMatches.size}`
      );
      if (mCount >= 3) {
        assert.ok(
          slot1.reasons.some(
            (r: string) => r.includes("精简") || r.includes("核心")
          ),
          `Expected Slot ① on M=${mCount} to append core 1~2-match higher-rate benchmark note in reasons`
        );
      }
    }

    // 2. ¥5,000 large budget closure: EVERY slot 0..3 must satisfy totalCost + savedCash === 5000 (zero unaccounted missing cash!),
    //    and Slot ① / ② / ③ must deploy full ¥5,000 (or up to statutory 999x per-line ceiling with exact savedCash) rather than capping at ¥1,000!
    const fourSlate = (FALLBACK_MATCHES as MatchItem[]).slice(0, 4);
    const plans5000 = generateParetoPortfolio(
      fourSlate,
      5000,
      "objective",
      false,
      []
    );
    for (const pl of plans5000) {
      assert.equal(
        pl.totalCost + pl.savedCash,
        5000,
        `Slot ${pl.key} violated budget conservation: totalCost(${pl.totalCost}) + savedCash(${pl.savedCash}) !== 5000`
      );
    }
    assert.ok(
      plans5000[0].totalCost >= 4500,
      `Expected Slot ① to scale cleanly to ~¥5,000 budget (not stuck at ¥1,000), got ¥${plans5000[0].totalCost}`
    );
    assert.ok(
      plans5000[2].totalCost >= 4500,
      `Expected Slot ③ wheel to scale cleanly to ~¥5,000 budget, got ¥${plans5000[2].totalCost}`
    );

    // 3. Exact strictNetGainProb (netProfit > 0) vs breakEvenProb (netProfit === 0) decomposition:
    //    1-match single with two @2.00 options (p=0.45, p=0.44) at ¥20 budget (5 notes + 5 notes -> each pays 5*4 = ¥20 -> netProfit === ¥0.00!)
    const breakEvenPairMatch: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "s3-be-split",
      pools: {
        ...(FALLBACK_MATCHES[1] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.0, trend: 0, fairProb: 0.45 },
            { key: "d", label: "平", odds: 2.0, trend: 0, fairProb: 0.44 },
            { key: "a", label: "客胜", odds: 7.5, trend: 0, fairProb: 0.11 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HHAD,
          selling: false,
        },
        HAFU: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAFU,
          selling: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.TTG,
          selling: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.CRS,
          selling: false,
        },
      },
    };
    const bePicks = [
      makePick(breakEvenPairMatch, "HAD", "h"),
      makePick(breakEvenPairMatch, "HAD", "d"),
    ];
    const beRep = computeTruthReport(bePicks, 5, [breakEvenPairMatch]) as any;
    assert.equal(beRep.totalCost, 20);
    assert.equal(beRep.underwaterCount, 0);
    assert.ok(
      beRep.breakEvenProb > 0.8 && Math.abs(beRep.strictNetGainProb) < 1e-12,
      `Pure refund slip (netProfit===0) must report strictNetGainProb=0 and breakEvenProb~0.89, got strict=${beRep.strictNetGainProb}, be=${beRep.breakEvenProb}`
    );
    assert.ok(
      Math.abs(
        beRep.strictNetGainProb + beRep.breakEvenProb - beRep.realProfitProb
      ) < 1e-12
    );

    const bePlans = generateParetoPortfolio(
      [breakEvenPairMatch],
      20,
      "objective",
      false,
      []
    ) as any[];
    for (const pl of bePlans.filter((p) => p.available)) {
      assert.equal(typeof pl.strictNetGainProb, "number");
      assert.equal(typeof pl.breakEvenProb, "number");
      assert.ok(
        Math.abs(pl.strictNetGainProb + pl.breakEvenProb - pl.profitProb) <
          1e-12,
        `Archetype ${pl.key} strictNetGainProb + breakEvenProb must equal profitProb`
      );
    }

    // 4. Objective Metric Lock ("No Beauty Filter" on primary KPIs):
    //    Changing subjectiveDeltaPct (+15%) or stance ("home-lean" / "upset-watch") MUST keep objectiveEVRate,
    //    objectiveProfitProb, and objectiveStrictNetGainProb invariant to baseline objective values, while populating subjectiveProjected*!
    const twoM = (FALLBACK_MATCHES as MatchItem[]).slice(0, 2);
    const twoPicks = [
      makePick(twoM[0], "HAD", "h"),
      makePick(twoM[1], "HAD", "h"),
    ];

    const wsObj0 = evaluateQuantWorkspace(
      {
        picks: twoPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          scaleMultiple: 1,
        },
        targetIds: twoM.map((m) => m.id),
        anchorToRadarPicks: true,
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      twoM
    ) as any;
    const wsTilted15 = evaluateQuantWorkspace(
      {
        picks: twoPicks,
        multiple: 5,
        subjectiveDeltaPct: 15,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          scaleMultiple: 1,
        },
        targetIds: twoM.map((m) => m.id),
        anchorToRadarPicks: true,
        budget: 100,
        stance: "home-lean",
        unlockFullAgg: false,
      },
      twoM
    ) as any;

    assert.equal(wsObj0.manualReport.subjectiveProjectedEVRate, null);
    assert.ok(
      Math.abs(
        wsTilted15.manualReport.objectiveEVRate -
          wsObj0.manualReport.objectiveEVRate
      ) < 1e-12,
      `manualReport.objectiveEVRate must stay locked at ${wsObj0.manualReport.objectiveEVRate} under +15% slider, got ${wsTilted15.manualReport.objectiveEVRate}`
    );
    assert.ok(
      Math.abs(
        wsTilted15.manualReport.objectiveStrictNetGainProb -
          wsObj0.manualReport.objectiveStrictNetGainProb
      ) < 1e-12
    );
    assert.ok(
      typeof wsTilted15.manualReport.subjectiveProjectedEVRate === "number" &&
        wsTilted15.manualReport.subjectiveProjectedEVRate >
          wsTilted15.manualReport.objectiveEVRate + 0.1,
      "subjectiveProjectedEVRate must capture the +15% personal projection separately"
    );

    // For anchored Slot ② (identical lines on [twoM[0]:h, twoM[1]:h] when single-anchored? Or check portfolioPlans[0]/[1] objectiveEVRate matches pure objective evaluation of those exact lines!)
    for (const pl of wsTilted15.portfolioPlans.filter(
      (p: any) => p.available
    )) {
      assert.equal(typeof pl.objectiveEVRate, "number");
      assert.equal(typeof pl.objectiveStrictNetGainProb, "number");
      assert.equal(typeof pl.subjectiveProjectedEVRate, "number");
      assert.ok(
        Math.abs(pl.subjectiveProjectedEVRate - pl.expectedValueRate) < 1e-12
      );
    }
    assert.ok(
      Math.abs(
        wsTilted15.effectiveReport.objectiveEVRate -
          wsObj0.effectiveReport.objectiveEVRate
      ) < 1e-9 || wsTilted15.effectiveReport.objectiveEVRate < 0,
      "effectiveReport.objectiveEVRate must remain anchored to objective probabilities (never turning -20% parlay positive via beauty filter)"
    );
    assert.ok(
      wsTilted15.effectiveReport.objectiveEVRate < 0 &&
        wsTilted15.effectiveReport.subjectiveProjectedEVRate >
          wsTilted15.effectiveReport.objectiveEVRate + 0.15,
      `Expected negative objectiveEVRate (${wsTilted15.effectiveReport.objectiveEVRate}) alongside higher subjectiveProjectedEVRate (${wsTilted15.effectiveReport.subjectiveProjectedEVRate})`
    );
  });

  it("Slice 04: supports native banker parlay (📌设胆), Top-2 bridge match finder (🌉过桥配菜搭子), shop anti-slippage (¥2 discrete swap check + 135m hedge window), and headless controller actions", async () => {
    const { createBetSlipController } =
      await import("../src/workspace/betSlipController.ts");

    // 1. Native Banker Parlay (📌设胆):
    //    4 matches: Match 0 single-pick banker (1), Matches 1..3 double-pick trailers (2, 2, 2) under 3串1:
    //    Without banker: C(3,2)*1*4 + 1*(2*2*2) = 12 + 8 = 20 bets (¥40 at 1x)
    //    With Match 0 as banker: must include Match 0 + any 2 of 3 trailers = 3 * (2*2) = 12 bets (¥24 at 1x)!
    const fourMatches = (FALLBACK_MATCHES as MatchItem[]).slice(0, 4);
    const bankerSlipPicks: SelectedPick[] = [
      makePick(fourMatches[0], "HAD", "h"),
      makePick(fourMatches[1], "HAD", "h"),
      makePick(fourMatches[1], "HAD", "d"),
      makePick(fourMatches[2], "HAD", "h"),
      makePick(fourMatches[2], "HAD", "d"),
      makePick(fourMatches[3], "HAD", "h"),
      makePick(fourMatches[3], "HAD", "d"),
    ];

    const repNoBanker = computeTruthReport(bankerSlipPicks, 1, fourMatches, {
      mode: "free",
      passSizes: [3],
    });
    assert.equal(repNoBanker.betCount, 20);
    assert.equal(repNoBanker.modeLabel, "3串1");

    const repWithBanker = computeTruthReport(bankerSlipPicks, 1, fourMatches, {
      mode: "free",
      passSizes: [3],
      bankerMatchIds: [fourMatches[0].id],
    } as any) as any;
    assert.equal(
      repWithBanker.betCount,
      12,
      `Expected 12 bets with 1 banker on 4-match 3串1, got ${repWithBanker.betCount}`
    );
    assert.equal(repWithBanker.totalCost, 24);
    assert.equal(repWithBanker.modeLabel, "3串1(1胆)");
    assert.deepEqual(repWithBanker.bankerMatchIds, [fourMatches[0].id]);
    assert.equal(repWithBanker.tickets.length, 12);
    for (const tk of repWithBanker.tickets) {
      assert.ok(
        tk.legs.some((lg: any) => lg.matchId === fourMatches[0].id),
        `Every expanded ticket must contain banker match ${fourMatches[0].id}, got ${tk.desc}`
      );
    }

    // Over-2048 banker pre-count still blocks explicitly without silent truncation
    const eightMatches = Array.from({ length: 8 }, (_, idx) => ({
      ...(FALLBACK_MATCHES[idx % FALLBACK_MATCHES.length] as MatchItem),
      id: `s4-8m-${idx}`,
      matchNumStr: `周六00${idx + 1}`,
    }));
    const massiveBankerPicks = eightMatches.flatMap((m, idx) =>
      idx === 0
        ? [makePick(m, "CRS", "1:0"), makePick(m, "CRS", "2:0")]
        : [
            makePick(m, "TTG", "s0"),
            makePick(m, "TTG", "s1"),
            makePick(m, "TTG", "s2"),
            makePick(m, "TTG", "s3"),
            makePick(m, "TTG", "s4"),
          ]
    );
    const repOver2048Banker = computeTruthReport(
      massiveBankerPicks,
      1,
      eightMatches,
      {
        mode: "free",
        passSizes: [4],
        bankerMatchIds: [eightMatches[0].id],
      } as any
    );
    // 2 * C(7, 3) * 5^3 = 2 * 35 * 125 = 8,750 > 2,048 -> must block explicitly!
    assert.equal(repOver2048Banker.canCheckout, false);
    assert.equal(repOver2048Banker.betCount, 8750);

    // 2. Minimum-Vig Bridge Match Finder (🌉过桥配菜搭子):
    //    Single non-single match picked -> insights.bridgeCandidates returns Top 2 distinct candidates
    //    (1: lowest-vig steady favorite >= 48%, 2: staggered-hedge >= 135m with single-open opposite pool)
    const bridgeSlate: MatchItem[] = [
      {
        ...(FALLBACK_MATCHES[0] as MatchItem),
        id: "20261121-001",
        matchNumStr: "周六001",
        kickoff: "19:35",
        pools: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools,
          HAD: {
            ...(FALLBACK_MATCHES[0] as MatchItem).pools.HAD,
            single: false,
            selling: true,
            options: [
              { key: "h", label: "主胜", odds: 2.05, trend: 0, fairProb: 0.44 },
              { key: "d", label: "平", odds: 3.35, trend: 0, fairProb: 0.27 },
              { key: "a", label: "客胜", odds: 3.15, trend: 0, fairProb: 0.29 },
            ],
          },
        },
      },
      {
        ...(FALLBACK_MATCHES[1] as MatchItem),
        id: "20261121-002",
        matchNumStr: "周六002",
        kickoff: "20:00", // Only 25m gap -> cannot hedge, but ultra-low vig steady favorite!
        pools: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools,
          HAD: {
            ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
            single: false,
            selling: true,
            options: [
              {
                key: "h",
                label: "主胜",
                odds: 1.48,
                trend: 0,
                fairProb: 0.625,
              }, // O*p = 0.925!
              { key: "d", label: "平", odds: 4.1, trend: 0, fairProb: 0.215 },
              { key: "a", label: "客胜", odds: 5.6, trend: 0, fairProb: 0.16 },
            ],
          },
        },
      },
      {
        ...(FALLBACK_MATCHES[2] as MatchItem),
        id: "20261121-003",
        matchNumStr: "周六003",
        kickoff: "23:00", // 205m gap (>= 135m!) AND HHAD(-1) single: true for complementary hedge!
        pools: {
          ...(FALLBACK_MATCHES[2] as MatchItem).pools,
          HAD: {
            ...(FALLBACK_MATCHES[2] as MatchItem).pools.HAD,
            single: false,
            selling: true,
            options: [
              { key: "h", label: "主胜", odds: 1.72, trend: 0, fairProb: 0.52 },
              { key: "d", label: "平", odds: 3.55, trend: 0, fairProb: 0.25 },
              { key: "a", label: "客胜", odds: 4.15, trend: 0, fairProb: 0.23 },
            ],
          },
          HHAD: {
            ...(FALLBACK_MATCHES[2] as MatchItem).pools.HHAD,
            single: true,
            selling: true,
            goalLine: "-1",
            name: "让球(-1)",
            options: [
              { key: "hh", label: "让胜", odds: 3.1, trend: 0, fairProb: 0.28 },
              {
                key: "hd",
                label: "让平",
                odds: 3.45,
                trend: 0,
                fairProb: 0.24,
              },
              {
                key: "ha",
                label: "让负",
                odds: 1.91,
                trend: 0,
                fairProb: 0.48,
              },
            ],
          },
        },
      },
    ];

    const singleBlockedPick = [makePick(bridgeSlate[0], "HAD", "h")];
    const wsBridgeBlocked = evaluateQuantWorkspace(
      {
        picks: singleBlockedPick,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [bridgeSlate[0].id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      bridgeSlate
    ) as any;
    assert.equal(wsBridgeBlocked.manualReport.canCheckout, false);
    const bridgeCands = wsBridgeBlocked.insights.bridgeCandidates;
    assert.ok(
      Array.isArray(bridgeCands) && bridgeCands.length === 2,
      `Expected Top 2 bridgeCandidates when 1 non-single match is blocked, got ${JSON.stringify(bridgeCands)}`
    );
    assert.equal(bridgeCands[0].kind, "lowest-vig");
    assert.equal(bridgeCands[0].matchId, "20261121-002");
    assert.equal(bridgeCands[1].kind, "staggered-hedge");
    assert.equal(bridgeCands[1].matchId, "20261121-003");
    assert.ok(bridgeCands[1].gapMinutes >= 135);

    // 3. Shop Anti-Slippage Suite:
    //    (a) Staggered hedge requires >= 135m safe window; 120m gap in [110, 135) warns about stoppage-time / early-close risk!
    const critical120Late: MatchItem = {
      ...bridgeSlate[2],
      id: "20261121-004",
      matchNumStr: "周六004",
      kickoff: "21:35", // Exactly 120m after 19:35 -> in [110, 135) danger zone!
    };
    const picks120 = [
      makePick(bridgeSlate[0], "HAD", "h"),
      makePick(critical120Late, "HAD", "h"),
    ];
    const rep120 = computeTruthReport(picks120, 5, [
      bridgeSlate[0],
      critical120Late,
    ]);
    const ins120 = computeProOrderInsights(picks120, rep120, [
      bridgeSlate[0],
      critical120Late,
    ]);
    assert.equal(
      ins120.hedge.available,
      false,
      "120m kickoff gap must NOT mark staggered hedge available (requires >= 135m safe window)"
    );
    assert.equal(ins120.hedge.gapMinutes, 120);
    assert.ok(
      ins120.hedge.reason.includes("135") &&
        (ins120.hedge.reason.includes("补时") ||
          ins120.hedge.reason.includes("停售")),
      `Expected stoppage-time/135m warning on 120m gap, got: ${ins120.hedge.reason}`
    );

    // 205m gap (>= 135m) on bridgeSlate[0] + bridgeSlate[2] MUST be available!
    const picks205 = [
      makePick(bridgeSlate[0], "HAD", "h"),
      makePick(bridgeSlate[2], "HAD", "h"),
    ];
    const rep205 = computeTruthReport(picks205, 5, [
      bridgeSlate[0],
      bridgeSlate[2],
    ]);
    const ins205 = computeProOrderInsights(picks205, rep205, [
      bridgeSlate[0],
      bridgeSlate[2],
    ]);
    assert.equal(ins205.hedge.available, true);
    assert.equal(ins205.hedge.gapMinutes, 205);

    //    (b) Discrete ¥2 integer-note check on activeSwapTip:
    //        HAD d@3.30 + a@2.85 (synDouble = 1.529) vs HHAD(-1) ha@1.49 (+2.6% continuous edge):
    //        For N <= 10 notes (<= ¥20), NO integer split beats ha@1.49 worst payout -> activeSwapTip MUST be null!
    //        At N = 12 notes (¥24, split 5+6=11 notes <= 12: min(5*6.60, 6*5.70)=33.00 > 11*2.98=32.78), activeSwapTip unlocks!
    const discreteTrapMatch: MatchItem = {
      ...bridgeSlate[2],
      id: "20261121-005",
      pools: {
        ...bridgeSlate[2].pools,
        HAD: {
          ...bridgeSlate[2].pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.35, trend: 0, fairProb: 0.39 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.28 },
            { key: "a", label: "客胜", odds: 2.85, trend: 0, fairProb: 0.33 },
          ],
        },
        HHAD: {
          ...bridgeSlate[2].pools.HHAD,
          single: true,
          selling: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 4.8, trend: 0, fairProb: 0.18 },
            { key: "hd", label: "让平", odds: 3.75, trend: 0, fairProb: 0.21 },
            { key: "ha", label: "让负", odds: 1.49, trend: 0, fairProb: 0.61 },
          ],
        },
      },
    };
    const trapPicks = [makePick(discreteTrapMatch, "HHAD", "ha")];
    const repSmall5 = computeTruthReport(trapPicks, 5, [discreteTrapMatch]); // ¥10 (5 notes)
    const insSmall5 = computeProOrderInsights(trapPicks, repSmall5, [
      discreteTrapMatch,
    ]);
    assert.equal(
      insSmall5.activeSwapTip,
      null,
      "At ¥10 (5 notes), discrete ¥2 rounding makes HAD[d+a] strictly worse than HHAD ha@1.49 -> must suppress activeSwapTip"
    );

    const repOdd11 = computeTruthReport(trapPicks, 11, [discreteTrapMatch]); // ¥22 (11 notes: 5+6 -> min(33.00, 34.20) = 33.00 > 32.78!)
    const insOdd11 = computeProOrderInsights(trapPicks, repOdd11, [
      discreteTrapMatch,
    ]);
    assert.ok(
      insOdd11.activeSwapTip !== null &&
        insOdd11.activeSwapTip.betterPicks.length === 2,
      "At ¥22 (11 notes), exact integer split (5,6) strictly dominates 11 notes of ha@1.49 -> activeSwapTip unlocks"
    );

    const repParity12 = computeTruthReport(trapPicks, 12, [discreteTrapMatch]); // ¥24 (12 notes: 6+6 -> 34.20 < 35.76 parity loss!)
    const insParity12 = computeProOrderInsights(trapPicks, repParity12, [
      discreteTrapMatch,
    ]);
    assert.equal(
      insParity12.activeSwapTip,
      null,
      "At ¥24 (12 notes), exact split (6,6) pays ¥34.20 < ¥35.76 -> must suppress parity-loss swap!"
    );

    const repOdd13 = computeTruthReport(trapPicks, 13, [discreteTrapMatch]); // ¥26 (13 notes: 6+7 -> 39.60 > 38.74!)
    const insOdd13 = computeProOrderInsights(trapPicks, repOdd13, [
      discreteTrapMatch,
    ]);
    assert.ok(insOdd13.activeSwapTip !== null);

    // 4. Headless BetSlipController (Seam 2):
    //    - applyBridgeCandidate turns 1-match blocked slip into legal 2串1
    //    - toggleBankerMatch auto-enables low free pass & cuts bets, and prunes cleanly on match removal
    //    - upgradeBonusToBreakeven & toggleTicketConsolidation work end-to-end
    const ctrl = createBetSlipController({
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
      debounceMs: 0,
    }) as any;
    ctrl.applyAuthenticatedBundle({
      matches: [...bridgeSlate, fourMatches[3]],
      initialPicks: singleBlockedPick,
      workspace: wsBridgeBlocked,
    });
    assert.equal(ctrl.getState().workspace.manualReport.canCheckout, false);

    const bridgeVerdict = ctrl.applyBridgeCandidate(bridgeCands[0]);
    assert.equal(bridgeVerdict.ok, true);
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.manualReport.canCheckout, true);
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, "2串1");
    assert.equal(ctrl.getState().workspace.insights.bridgeCandidates.length, 0);

    // Add 2 more matches (total 4 matches) with double-picks on trailers, then toggleBankerMatch on bridgeSlate[0]
    ctrl.togglePick(bridgeSlate[2], "HAD", "h");
    ctrl.togglePick(bridgeSlate[2], "HAD", "d");
    ctrl.togglePick(fourMatches[3], "HAD", "h");
    ctrl.togglePick(fourMatches[3], "HAD", "d");
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.manualReport.matchCount, 4);

    const bankerToggleOn = ctrl.toggleBankerMatch(bridgeSlate[0].id);
    assert.equal(bankerToggleOn.ok, true);
    assert.equal(bankerToggleOn.isBanker, true);
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, "3串1(1胆)");
    assert.deepEqual(ctrl.getState().workspace.manualReport.bankerMatchIds, [
      bridgeSlate[0].id,
    ]);

    // Removing the banker match from slip prunes bankerMatchIds cleanly
    ctrl.removeMatchFromSlip(bridgeSlate[0].id);
    await ctrl.flush();
    assert.deepEqual(
      ctrl.getState().workspace.manualReport.bankerMatchIds ?? [],
      []
    );

    // Test upgradeBonusToBreakeven & toggleTicketConsolidation on 27-bet feasible slip
    const three27: MatchItem[] = [0, 1, 2].map((idx) => ({
      ...(FALLBACK_MATCHES[idx] as MatchItem),
      id: `s4-feas27-${idx}`,
      pools: {
        ...(FALLBACK_MATCHES[idx] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[idx] as MatchItem).pools.HAD,
          selling: true,
          single: false,
          options: [
            { key: "h", label: "主胜", odds: 2.15, trend: 0, fairProb: 0.43 },
            { key: "d", label: "平", odds: 3.6, trend: 0, fairProb: 0.29 },
            { key: "a", label: "客胜", odds: 4.6, trend: 0, fairProb: 0.28 },
          ],
        },
      },
    }));
    const picks27 = three27.flatMap((m) =>
      m.pools.HAD.options.map((o) => makePick(m, "HAD", o.key))
    );
    ctrl.applyAuthenticatedBundle({
      matches: three27,
      initialPicks: picks27,
      workspace: evaluateQuantWorkspace(
        {
          picks: picks27,
          multiple: 1,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: three27.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        three27
      ),
    });
    ctrl.setDirectMultiple(1);
    await ctrl.flush();
    ctrl.applyBonusOptimization("equal");
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 54);
    assert.ok(ctrl.getState().workspace.effectiveReport.underwaterCount > 0);

    const upg = ctrl.upgradeBonusToBreakeven();
    assert.equal(upg.ok, true);
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.effectiveReport.underwaterCount, 0);
    assert.ok(ctrl.getState().workspace.effectiveReport.totalCost > 54);

    // Default consolidateTickets is ON; toggleTicketConsolidation flips OFF -> ON cleanly
    assert.equal(
      ctrl.getState().workspace.appliedPlan?.consolidateTickets,
      true
    );
    const consOff = ctrl.toggleTicketConsolidation();
    assert.equal(consOff.ok, true);
    assert.equal(consOff.consolidated, false);
    await ctrl.flush();
    assert.equal(
      ctrl.getState().workspace.appliedPlan?.consolidateTickets,
      false
    );
    const consOnAgain = ctrl.toggleTicketConsolidation();
    assert.equal(consOnAgain.ok, true);
    assert.equal(consOnAgain.consolidated, true);
    await ctrl.flush();
    assert.equal(
      ctrl.getState().workspace.appliedPlan?.consolidateTickets,
      true
    );
  });

  it("Slice 05 · Seam 3: syncs XiaoGao combo context (banker & budget-sovereign partial recovery), serves 0ms Iron-Cage Manual KB for banker/bridge/objective-split/ticket-consolidate/135m, and wires all 5 embedded UI contracts", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { buildComboDiagnosisContext } =
      await import("../server/xiaogaoCore.mjs");
    const { createManualQaEngine } =
      await import("../server/manualQaEngine.mjs");

    // 1. XiaoGao Combo Context recognizes native banker (📌【胆】) & budget-sovereign partial shield + objective EV
    const fourM = (FALLBACK_MATCHES as MatchItem[]).slice(0, 4);
    const bPicks: SelectedPick[] = [
      makePick(fourM[0], "HAD", "h"),
      makePick(fourM[1], "HAD", "h"),
      makePick(fourM[1], "HAD", "d"),
      makePick(fourM[2], "HAD", "h"),
      makePick(fourM[2], "HAD", "d"),
      makePick(fourM[3], "HAD", "h"),
      makePick(fourM[3], "HAD", "d"),
    ];
    const wsBanker = evaluateQuantWorkspace(
      {
        picks: bPicks,
        multiple: 1,
        passSpec: {
          mode: "free",
          passSizes: [3],
          bankerMatchIds: [fourM[0].id],
        },
        subjectiveDeltaPct: 12,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: fourM.map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      fourM
    );
    const comboCtx = buildComboDiagnosisContext({
      sourceMode: "picked",
      targetMatches: fourM,
      picks: bPicks,
      effectiveReport: wsBanker.effectiveReport,
      appliedPlan: wsBanker.appliedPlan,
      planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
      insights: wsBanker.insights,
      userNote: "",
    });
    assert.ok(
      comboCtx.actuaryContext.shieldSummary.includes("胆") &&
        comboCtx.matches[0].userPickedDesc.includes("【胆】"),
      `Expected XiaoGao combo context to annotate banker match 【胆】, got shieldSummary=${comboCtx.actuaryContext.shieldSummary}`
    );
    assert.ok(
      comboCtx.orderSummary.includes("客观EV"),
      `Expected XiaoGao orderSummary to expose 客观EV alongside subjective shift, got ${comboCtx.orderSummary}`
    );

    // 2. Iron-Cage Manual Q&A 0ms local-kb answers for all new Spec 0012 concepts + 135m safe hedge window
    const qaEngine = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => ({
          locked: false,
          strikeCount: 1,
          maxAllowed: 4,
        }),
        consumeDailyQaQuota: () => ({ ok: true, remaining: 19 }),
      },
      xiaogaoService: {
        invokeManualGrounded: async () => {
          throw new Error("Should hit 0ms local-kb without invoking LLM");
        },
      },
    });
    for (const [qText, mustContain] of [
      ["📌 设胆和胆拖过关怎么用？", "胆"],
      ["只选1场未开单关怎么用过桥配菜搭子凑2串1？", "2串1"],
      ["严格净赚率和刚回本率有什么区别？", "净赚"],
      ["一键加至最低保本门槛和智能合票减张有什么用？", "合票"],
      ["早晚场时间差对冲锁利怎么操作？", "135"],
    ] as const) {
      const res = await qaEngine.answerManualQuestion({
        userId: "u-test",
        question: qText,
        ip: "127.0.0.1",
      });
      assert.equal(
        res.source,
        "local-kb",
        `Question "${qText}" must resolve via 0ms local-kb, got ${res.source}`
      );
      assert.ok(
        res.answer.includes(mustContain),
        `Answer for "${qText}" must mention "${mustContain}", got: ${res.answer}`
      );
    }

    // 3. Behavioral 5-point Dual-Viewport UI & controller contracts
    const { createBetSlipController } =
      await import("../src/workspace/betSlipController.ts");
    const {
      buildAuditCockpitTiles,
      buildPortfolioKpiTiles,
      buildPosterSlipRows,
    } = await import("../src/mobile/cabins/cabinViewModels.ts");
    const { EMPTY_INSIGHTS, EMPTY_TRUTH_REPORT } =
      await import("../src/prototype/quantTypes.ts");

    const uiCtrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, ms) => evaluateQuantWorkspace(p, ms),
    });
    const mList = FALLBACK_MATCHES as MatchItem[];
    uiCtrl.initializeMatches(
      mList,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, mList)
    );
    uiCtrl.togglePick(mList[0], "HAD", "h");
    uiCtrl.togglePick(mList[1], "HAD", "h");
    uiCtrl.togglePick(mList[2], "HAD", "h");
    uiCtrl.toggleFreePassSize(2);
    await uiCtrl.flush();
    assert.deepEqual(uiCtrl.toggleBankerMatch(mList[0].id), {
      ok: true,
      isBanker: true,
    });
    await uiCtrl.flush();

    const posterRows = buildPosterSlipRows(
      uiCtrl.getState().workspace.effectiveReport,
      null,
      uiCtrl.getState().planSpec,
      uiCtrl.getState().picks,
      5,
      new Set(uiCtrl.getState().passSpec.bankerMatchIds ?? [])
    );
    assert.ok(
      posterRows.some((r) => r.left.includes("📌【胆】")),
      "Poster ticket rows must render 📌【胆】 badge on banker legs"
    );

    const auditTiles = buildAuditCockpitTiles(
      {
        ...EMPTY_TRUTH_REPORT,
        totalCost: 20,
        objectiveProfitProb: 0.45,
        objectiveStrictNetGainProb: 0.4,
        objectiveEVRate: -0.11,
      },
      EMPTY_INSIGHTS
    );
    assert.ok(
      auditTiles.tile2.value.startsWith("40.0%") &&
        auditTiles.tile2.subtitle.includes("刚回本"),
      "Audit primary KPIs must lock to objectiveStrictNetGainProb and disclose 刚回本"
    );
    const portTiles = buildPortfolioKpiTiles({
      ...uiCtrl.getState().workspace.portfolioPlans[0],
      objectiveProfitProb: 0.48,
      objectiveStrictNetGainProb: 0.42,
      objectiveEVRate: -0.1,
    });
    assert.equal(portTiles.tile1.value, "42.0%");
    assert.ok(portTiles.tile1.subtitle.includes("刚回本"));
    assert.equal(typeof uiCtrl.applyBridgeCandidate, "function");
    assert.equal(typeof uiCtrl.upgradeBonusToBreakeven, "function");
    assert.equal(typeof uiCtrl.toggleTicketConsolidation, "function");
  });

  it("Slice 06 · Two-Axis Code-Review Remediation Lock (Axis 1 Standards/Security & Axis 2 Spec Fidelity)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { bankerRoundParlayUnitPayout } =
      await import("../server/quantEngine.mjs");
    const { createBetSlipController } =
      await import("../src/workspace/betSlipController.ts");
    const { buildComboDiagnosisContext } =
      await import("../server/xiaogaoCore.mjs");

    // 1. Axis 1 #1 & #4:
    //    - bankerRoundParlayUnitPayout 2-leg fast path guards o >= 1 && o <= 100_000 (falls back to exact BigInt on [0.00006, 6e9])
    assert.equal(bankerRoundParlayUnitPayout([0.00006, 6e9]), 1200000);

    //    - Untrusted snapshotPlan + consolidateTickets: true MUST enforce authoritative matches odds,
    //      statutorySingleBetCap (never consolidating cap-clipped lines!), and [1, 999] multiple clamp!
    const highOddsMatch: MatchItem = {
      ...(FALLBACK_MATCHES[0] as MatchItem),
      id: "s6-cap-m",
      pools: {
        ...(FALLBACK_MATCHES[0] as MatchItem).pools,
        CRS: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.CRS,
          single: true,
          selling: true,
          options: [
            { key: "5:2", label: "5:2", odds: 250.0, trend: 0, fairProb: 0.01 },
            { key: "4:3", label: "4:3", odds: 80.0, trend: 0, fairProb: 0.01 },
          ],
        },
      },
    };
    // Authoritative 5:2 single has rawUnit = 500 > 100,000? Wait: 250 * 2 = 500, let's use odds 60000 (or 2-leg 350*350 = 122500 -> unit 245,000 > 200,000 cap!)
    const capLegM1: MatchItem = {
      ...highOddsMatch,
      id: "s6-cap-1",
      pools: {
        ...highOddsMatch.pools,
        CRS: {
          ...highOddsMatch.pools.CRS,
          options: [
            { key: "5:2", label: "5:2", odds: 350.0, trend: 0, fairProb: 0.01 },
          ],
        },
      },
    };
    const capLegM2: MatchItem = {
      ...highOddsMatch,
      id: "s6-cap-2",
      pools: {
        ...highOddsMatch.pools,
        CRS: {
          ...highOddsMatch.pools.CRS,
          options: [
            { key: "5:2", label: "5:2", odds: 350.0, trend: 0, fairProb: 0.01 },
            { key: "1:0", label: "1:0", odds: 6.5, trend: 0, fairProb: 0.15 },
          ],
        },
      },
    };
    // Line 1: 350 * 350 * 2 = ¥245,000 > ¥200,000 2-leg statutory cap! Client spoofs unitPayout=10, cappedClipped=0, multiple=12
    // Line 2: 350 * 6.5 * 2 = ¥4,550 (unclipped), client spoofs multiple=5000 (>999!)
    const forgedSnap: any = {
      key: "max-ev-utility",
      available: true,
      shortTab: "期望效用",
      badge: "测试",
      title: "测试",
      tagline: "测试",
      totalCost: 40,
      savedCash: 0,
      minReturn: 100,
      maxReturn: 200,
      winProb: 0.1,
      profitProb: 0.1,
      expectedValueRate: -0.1,
      underwaterCount: 0,
      missOneReturn: null,
      vigPct: 12,
      reasons: [],
      lines: [
        {
          id: "f1",
          roleLabel: "主攻",
          modeLabel: "2串1",
          multiple: 12,
          cost: 24,
          unitPayout: 10, // forged!
          cappedClipped: 0, // forged! authoritative is clipped by 200,000 cap!
          returnPayout: 120,
          netProfit: 80,
          prob: 0.0001,
          legs: [
            {
              matchId: "s6-cap-1",
              matchNumStr: "周六001",
              home: "甲",
              away: "乙",
              kickoff: "20:00",
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "5:2",
              optionLabel: "5:2",
              odds: 2.0, // forged!
              fairProb: 0.01,
            },
            {
              matchId: "s6-cap-2",
              matchNumStr: "周六002",
              home: "丙",
              away: "丁",
              kickoff: "22:00",
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "5:2",
              optionLabel: "5:2",
              odds: 2.5, // forged!
              fairProb: 0.01,
            },
          ],
        },
        {
          id: "f2",
          roleLabel: "护盾",
          modeLabel: "2串1",
          multiple: 5000, // >999!
          cost: 10000,
          unitPayout: 10,
          cappedClipped: 0,
          returnPayout: 50000,
          netProfit: 40000,
          prob: 0.0015,
          legs: [
            {
              matchId: "s6-cap-1",
              matchNumStr: "周六001",
              home: "甲",
              away: "乙",
              kickoff: "20:00",
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "5:2",
              optionLabel: "5:2",
              odds: 2.0,
              fairProb: 0.01,
            },
            {
              matchId: "s6-cap-2",
              matchNumStr: "周六002",
              home: "丙",
              away: "丁",
              kickoff: "22:00",
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "1:0",
              optionLabel: "1:0",
              odds: 2.5,
              fairProb: 0.15,
            },
          ],
        },
      ],
    };
    const wsForged = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          snapshotPlan: forgedSnap,
          scaleMultiple: 1,
          consolidateTickets: true,
        },
        targetIds: ["s6-cap-1", "s6-cap-2"],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [capLegM1, capLegM2]
    );
    assert.equal(
      wsForged.appliedPlan!.lines[0].multiple,
      12,
      "Cap-clipped line 1 MUST NOT be altered by consolidateTickets even if client spoofed cappedClipped=0"
    );
    assert.equal(
      wsForged.appliedPlan!.lines[1].multiple,
      999,
      "Over-999 multiple in untrusted snapshotPlan must be clamped to 999"
    );

    // 2. Axis 2 (c).3: breakevenUpgradeCost solves >64-step 27-bet 3串1 ([2.97, 3.01, 3.06] -> B* = ¥1,608)
    const tight27Matches: MatchItem[] = [0, 1, 2].map((idx) => ({
      ...(FALLBACK_MATCHES[idx] as MatchItem),
      id: `s6-tight27-${idx}`,
      pools: {
        ...(FALLBACK_MATCHES[idx] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[idx] as MatchItem).pools.HAD,
          selling: true,
          single: false,
          options: [
            { key: "h", label: "主胜", odds: 2.97, trend: 0, fairProb: 0.34 },
            { key: "d", label: "平", odds: 3.01, trend: 0, fairProb: 0.33 },
            { key: "a", label: "客胜", odds: 3.06, trend: 0, fairProb: 0.33 },
          ],
        },
      },
    }));
    const tight27Picks = tight27Matches.flatMap((m) =>
      m.pools.HAD.options.map((o) => makePick(m, "HAD", o.key))
    );
    const repTight27 = computeTruthReport(tight27Picks, 1, tight27Matches, {
      mode: "free",
      passSizes: [3],
    });
    assert.ok(
      typeof repTight27.breakevenUpgradeCost === "number" &&
        repTight27.breakevenUpgradeCost >= 1500 &&
        repTight27.breakevenUpgradeCost <= 1700,
      `Expected exact breakevenUpgradeCost (~¥1608) on tight 27-bet 3串1 without 64-step abort, got ${repTight27.breakevenUpgradeCost}`
    );

    // 3. Axis 2 (c).5 & (a).2:
    //    - Slot ③ (max-cvar-wheel) on M=2 at ¥20,000 clamps all line multiples <= 999 and closes totalCost + savedCash === 20,000
    //    - consolidatedLines view is populated on ArchetypePlan
    //    - recommendedBankrollPct stays anchored to objectiveEVRate even under +15% subjective slider
    const twoWheel = (FALLBACK_MATCHES as MatchItem[]).slice(0, 2);
    const plans20k = generateParetoPortfolio(
      twoWheel,
      20_000,
      "objective",
      false
    );
    for (const pl of plans20k.filter((p) => p.available)) {
      assert.equal(pl.totalCost + pl.savedCash, 20_000);
      assert.ok(
        Array.isArray((pl as any).consolidatedLines) &&
          (pl as any).consolidatedLines.length >= 1,
        `Slot ${pl.key} must expose consolidatedLines`
      );
      for (const ln of pl.lines) {
        assert.ok(
          ln.multiple >= 1 && ln.multiple <= 999,
          `Slot ${pl.key} line multiple must be <= 999 at ¥20,000, got ${ln.multiple}`
        );
      }
    }

    const negEvPicks = [
      makePick(twoWheel[0], "HAD", "h"),
      makePick(twoWheel[1], "HAD", "h"),
    ];
    const wsSubj15 = evaluateQuantWorkspace(
      {
        picks: negEvPicks,
        multiple: 5,
        subjectiveDeltaPct: 15,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: twoWheel.map((m) => m.id),
        budget: 100,
        stance: "home-lean",
        unlockFullAgg: false,
      },
      twoWheel
    );
    assert.ok(wsSubj15.effectiveReport.objectiveEVRate < 0);
    assert.ok(
      wsSubj15.insights.recommendedBankrollPct <= 2,
      `Negative objective EV must cap Kelly bankroll at <= 2% even under +15% slider, got ${wsSubj15.insights.recommendedBankrollPct}%`
    );

    // 4. Axis 2 (c).1: applyEquivalentSwap at odd multiple = 11 (¥22) preserves exact ¥22 budget & minPayout > ¥32.78!
    const oddSwapMatch: MatchItem = {
      ...twoWheel[0],
      id: "s6-odd-swap",
      pools: {
        ...twoWheel[0].pools,
        HAD: {
          ...twoWheel[0].pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.35, trend: 0, fairProb: 0.39 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.28 },
            { key: "a", label: "客胜", odds: 2.85, trend: 0, fairProb: 0.33 },
          ],
        },
        HHAD: {
          ...twoWheel[0].pools.HHAD,
          single: true,
          selling: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 4.8, trend: 0, fairProb: 0.18 },
            { key: "hd", label: "让平", odds: 3.75, trend: 0, fairProb: 0.21 },
            { key: "ha", label: "让负", odds: 1.49, trend: 0, fairProb: 0.61 },
          ],
        },
      },
    };
    const ctrlSwap = createBetSlipController({
      computeWorkspace: (p, ms) => evaluateQuantWorkspace(p, ms),
      debounceMs: 0,
    });
    const initOddPicks = [makePick(oddSwapMatch, "HHAD", "ha")];
    ctrlSwap.applyAuthenticatedBundle({
      matches: [oddSwapMatch],
      initialPicks: initOddPicks,
      workspace: evaluateQuantWorkspace(
        {
          picks: initOddPicks,
          multiple: 11,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [oddSwapMatch.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        [oddSwapMatch]
      ),
    });
    ctrlSwap.setDirectMultiple(11);
    await ctrlSwap.flush();
    const tip11 = ctrlSwap.getState().workspace.insights.activeSwapTip!;
    assert.ok(tip11, "Expected activeSwapTip at 11 notes (¥22)");
    assert.equal(ctrlSwap.applyEquivalentSwap(tip11), true);
    await ctrlSwap.flush();
    assert.equal(
      ctrlSwap.getState().workspace.effectiveReport.totalCost,
      22,
      "Swapping at 11x (¥22) must preserve exact ¥22 budget without flooring to ¥20"
    );
    assert.equal(
      ctrlSwap.getState().workspace.effectiveReport.minPayout,
      33,
      "Swapping at ¥22 must achieve (5,6) minPayout = ¥33.00 > ¥32.78"
    );

    // 5. Axis 2 (a).3, (b).1 & Axis 1 #2/#3: XiaoGao bridge synergy + UI/Manual hygiene
    const bridgeTwoM: MatchItem[] = [
      {
        ...twoWheel[0],
        id: "20261121-b1",
        matchNumStr: "周六001",
        kickoff: "19:35",
        pools: {
          ...twoWheel[0].pools,
          HAD: { ...twoWheel[0].pools.HAD, single: false, selling: true },
        },
      },
      {
        ...twoWheel[1],
        id: "20261121-b2",
        matchNumStr: "周六002",
        kickoff: "23:00",
        pools: {
          ...twoWheel[1].pools,
          HAD: {
            ...twoWheel[1].pools.HAD,
            single: false,
            selling: true,
            options: [
              { key: "h", label: "主胜", odds: 1.48, trend: 0, fairProb: 0.62 },
              { key: "d", label: "平", odds: 4.1, trend: 0, fairProb: 0.22 },
              { key: "a", label: "客胜", odds: 5.6, trend: 0, fairProb: 0.16 },
            ],
          },
        },
      },
    ];
    const brPicks = [
      makePick(bridgeTwoM[0], "HAD", "h"),
      makePick(bridgeTwoM[1], "HAD", "h"),
    ];
    const wsBr = evaluateQuantWorkspace(
      {
        picks: brPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: bridgeTwoM.map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      bridgeTwoM
    );
    const brComboCtx = buildComboDiagnosisContext({
      sourceMode: "picked",
      targetMatches: bridgeTwoM,
      picks: brPicks,
      effectiveReport: wsBr.effectiveReport,
      appliedPlan: null,
      planSpec: null,
      insights: wsBr.insights,
      userNote: "",
    });
    assert.ok(
      brComboCtx.actuaryContext.shieldSummary.includes("过桥") ||
        brComboCtx.actuaryContext.shieldSummary.includes("搭子"),
      `XiaoGao combo context must recognize 2串1 bridge-match structure, got: ${brComboCtx.actuaryContext.shieldSummary}`
    );

    const { resolveCompactAuditBarPrimaryAction } =
      await import("../src/mobile/cabins/cabinViewModels.ts");
    const ws1Bridge = evaluateQuantWorkspace(
      { picks: [brPicks[1]], multiple: 5, syntheticSingleMode: "off" },
      [bridgeTwoM[1], ...(FALLBACK_MATCHES as MatchItem[]).slice(1, 5)]
    );
    assert.ok((ws1Bridge.insights.bridgeCandidates?.length ?? 0) >= 1);
    const synFirst = resolveCompactAuditBarPrimaryAction(
      { canCheckout: false },
      { isSyntheticPlayable: true, showBridgeFinder: false },
      ws1Bridge.insights.bridgeCandidates ?? []
    );
    const bridgeWhenOff = resolveCompactAuditBarPrimaryAction(
      { canCheckout: false },
      { isSyntheticPlayable: false, showBridgeFinder: true },
      ws1Bridge.insights.bridgeCandidates ?? []
    );
    assert.equal(
      synFirst.label,
      "一键合成单关",
      "Compact bottom bar must prioritize 一键合成单关 when same-match HAFU rescue is playable"
    );
    assert.equal(
      bridgeWhenOff.label,
      "🌉一键凑2串1",
      "Compact bottom bar must surface 🌉一键凑2串1 when synthetic rescue is off/unplayable"
    );

    const { MANUAL_CHAPTER_SPECS } =
      await import("../src/manual/manualCatalog.ts");
    const manualModalSrc = JSON.stringify(MANUAL_CHAPTER_SPECS);
    assert.equal(
      manualModalSrc.includes("全稳赚"),
      false,
      "Structured manual chapters must remove legacy 全稳赚 label"
    );
    assert.ok(
      manualModalSrc.includes("过桥配菜") &&
        manualModalSrc.includes("智能合票减张"),
      "Structured manual chapters must include illustrated Spec 0012 entries"
    );
  });
});
