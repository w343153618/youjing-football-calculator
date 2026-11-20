import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_MATCHES,
  calibrateMatchCoherentModel,
  computeTruthReport,
  evaluateQuantWorkspace,
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
});
