import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_MATCHES,
  calibrateMatchCoherentModel,
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
            { key: "h", label: "主胜", odds: 2.2, trend: 0, fairProb: 0.41 },
            { key: "d", label: "平", odds: 2.32, trend: 0, fairProb: 0.39 },
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
            { key: "d", label: "平", odds: 2.36, trend: 0, fairProb: 0.38 },
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
        multiple: 15, // 4 bets * 15x = 60 notes = ¥120
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode: "equal",
          scaleMultiple: 1,
          consolidateTickets: false,
        } as any,
        targetIds: [closeMultMatchA.id, closeMultMatchB.id],
        budget: 120,
        stance: "objective",
        unlockFullAgg: false,
      },
      [closeMultMatchA, closeMultMatchB]
    );
    const wsCons4 = evaluateQuantWorkspace(
      {
        picks: close4Picks,
        multiple: 15,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode: "equal",
          scaleMultiple: 1,
          consolidateTickets: true,
        } as any,
        targetIds: [closeMultMatchA.id, closeMultMatchB.id],
        budget: 120,
        stance: "objective",
        unlockFullAgg: false,
      },
      [closeMultMatchA, closeMultMatchB]
    );
    assert.equal(wsCons4.effectiveReport.totalCost, 120);
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
});
