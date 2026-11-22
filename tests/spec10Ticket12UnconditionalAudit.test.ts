import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  archetypeToReport,
  bankerRoundParlayUnitPayout,
  computeTruthReport,
  evaluateQuantWorkspace,
  optimizeBonusPlan,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import {
  EMPTY_INSIGHTS,
  EMPTY_TRUTH_REPORT,
  type ArchetypePlan,
  type MatchItem,
  type PlanLeg,
  type PlanTicketLine,
  type PoolCode,
  type SelectedPick,
} from "../src/prototype/quantTypes.ts";
import * as cabinViewModels from "../src/mobile/cabins/cabinViewModels.ts";

/**
 * Frozen real Sporttery V1 snapshot slice (周日001 金泉尚武, 周日002 光州FC, 周日003 特温特 -3)
 * identical to live-sg-snapshot.json incident data.
 */
const LIVE_SG_THREE_MATCH_RAW = {
  errorCode: "0",
  value: {
    matchInfoList: [
      {
        businessDate: "2026-11-22",
        subMatchList: [
          {
            matchId: 2042924,
            matchNumStr: "周日001",
            businessDate: "2026-11-22",
            matchDate: "2026-11-22",
            matchTime: "13:00:00",
            leagueAbbName: "韩职",
            homeTeamAbbName: "金泉尚武",
            awayTeamAbbName: "济州SK",
            had: {
              h: "2.43",
              d: "3.05",
              a: "2.50",
              hf: "0",
              df: "0",
              af: "0",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            hhad: {
              goalLine: "-1",
              h: "5.65",
              d: "3.95",
              a: "1.41",
              hf: "0",
              df: "0",
              af: "0",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            hafu: {
              hh: "4.10",
              hd: "14.50",
              ha: "24.00",
              dh: "5.75",
              dd: "4.75",
              da: "5.85",
              ah: "22.00",
              ad: "14.50",
              aa: "4.35",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            ttg: {
              s0: "12.00",
              s1: "4.60",
              s2: "3.30",
              s3: "3.60",
              s4: "5.55",
              s5: "10.00",
              s6: "17.50",
              s7: "28.00",
              updateDate: "2026-11-20",
              updateTime: "09:58:44",
            },
            crs: {
              s01s00: "7.50",
              s02s00: "10.50",
              s02s01: "7.25",
              s03s00: "26.00",
              s03s01: "19.00",
              s03s02: "25.00",
              s04s00: "70.00",
              s04s01: "50.00",
              s04s02: "80.00",
              s05s00: "250.0",
              s05s01: "175.0",
              s05s02: "300.0",
              s1sh: "90.00",
              s00s00: "12.00",
              s01s01: "5.75",
              s02s02: "12.00",
              s03s03: "55.00",
              s1sd: "400.0",
              s00s01: "8.00",
              s00s02: "11.50",
              s01s02: "7.50",
              s00s03: "27.00",
              s01s03: "21.00",
              s02s03: "27.00",
              s00s04: "75.00",
              s01s04: "60.00",
              s02s04: "90.00",
              s00s05: "300.0",
              s01s05: "200.0",
              s02s05: "325.0",
              s1sa: "100.0",
              updateDate: "2026-11-20",
              updateTime: "09:58:44",
            },
            poolList: [
              {
                poolCode: "HAD",
                bettingAllup: 1,
                bettingSingle: 0,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "HHAD",
                bettingAllup: 1,
                bettingSingle: 0,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "HAFU",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "CRS",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "TTG",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
            ],
          },
          {
            matchId: 2042925,
            matchNumStr: "周日002",
            businessDate: "2026-11-22",
            matchDate: "2026-11-22",
            matchTime: "13:00:00",
            leagueAbbName: "韩职",
            homeTeamAbbName: "光州FC",
            awayTeamAbbName: "富川FC",
            had: {
              h: "2.10",
              d: "3.25",
              a: "2.82",
              updateDate: "2026-11-21",
              updateTime: "20:37:47",
            },
            hhad: {
              goalLine: "-1",
              h: "4.56",
              d: "3.75",
              a: "1.53",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            hafu: {
              hh: "3.70",
              hd: "13.00",
              ha: "25.00",
              dh: "5.20",
              dd: "5.20",
              da: "6.50",
              ah: "22.00",
              ad: "13.00",
              aa: "4.85",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            ttg: {
              s0: "13.00",
              s1: "5.15",
              s2: "3.60",
              s3: "3.55",
              s4: "5.00",
              s5: "8.50",
              s6: "16.00",
              s7: "23.00",
              updateDate: "2026-11-20",
              updateTime: "09:58:44",
            },
            crs: {
              s01s00: "7.50",
              s02s00: "10.50",
              s02s01: "7.00",
              s03s00: "19.00",
              s03s01: "16.00",
              s03s02: "22.00",
              s04s00: "55.00",
              s04s01: "50.00",
              s04s02: "60.00",
              s05s00: "150.0",
              s05s01: "120.0",
              s05s02: "175.0",
              s1sh: "65.00",
              s00s00: "13.00",
              s01s01: "5.60",
              s02s02: "11.50",
              s03s03: "55.00",
              s1sd: "350.0",
              s00s01: "9.00",
              s00s02: "14.50",
              s01s02: "8.50",
              s00s03: "30.00",
              s01s03: "22.00",
              s02s03: "26.00",
              s00s04: "100.0",
              s01s04: "65.00",
              s02s04: "85.00",
              s00s05: "350.0",
              s01s05: "275.0",
              s02s05: "350.0",
              s1sa: "90.00",
              updateDate: "2026-11-20",
              updateTime: "09:58:44",
            },
            poolList: [
              {
                poolCode: "HAD",
                bettingAllup: 1,
                bettingSingle: 0,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "HHAD",
                bettingAllup: 1,
                bettingSingle: 0,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "HAFU",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "CRS",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "TTG",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
            ],
          },
          {
            matchId: 2042926,
            matchNumStr: "周日003",
            businessDate: "2026-11-22",
            matchDate: "2026-11-22",
            matchTime: "19:15:00",
            leagueAbbName: "荷甲",
            homeTeamAbbName: "特温特",
            awayTeamAbbName: "威廉二世",
            had: {},
            hhad: {
              goalLine: "-3",
              h: "2.36",
              d: "4.65",
              a: "2.00",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            hafu: {
              hh: "1.19",
              hd: "38.00",
              ha: "150.0",
              dh: "4.60",
              dd: "19.00",
              da: "50.00",
              ah: "25.00",
              ad: "38.00",
              aa: "42.00",
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            ttg: {
              s0: "55.00",
              s1: "13.00",
              s2: "6.80",
              s3: "4.40",
              s4: "4.20",
              s5: "4.80",
              s6: "6.50",
              s7: "5.40",
              updateDate: "2026-11-20",
              updateTime: "09:58:44",
            },
            crs: {
              s01s00: "14.00",
              s02s00: "8.00",
              s02s01: "10.00",
              s03s00: "7.00",
              s03s01: "9.50",
              s03s02: "23.00",
              s04s00: "7.25",
              s04s01: "10.50",
              s04s02: "29.00",
              s05s00: "10.00",
              s05s01: "14.00",
              s05s02: "45.00",
              s1sh: "4.25",
              s00s00: "55.00",
              s01s01: "20.00",
              s02s02: "30.00",
              s03s03: "100.0",
              s1sd: "550.0",
              s00s01: "70.00",
              s00s02: "200.0",
              s01s02: "60.00",
              s00s03: "550.0",
              s01s03: "200.0",
              s02s03: "120.0",
              s00s04: "1000",
              s01s04: "650.0",
              s02s04: "550.0",
              s00s05: "1000",
              s01s05: "1000",
              s02s05: "1000",
              s1sa: "400.0",
              updateDate: "2026-11-20",
              updateTime: "09:58:44",
            },
            poolList: [
              {
                poolCode: "HHAD",
                bettingAllup: 1,
                bettingSingle: 0,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "HAFU",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "CRS",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
              {
                poolCode: "TTG",
                bettingAllup: 1,
                bettingSingle: 1,
                single: 0,
                cbtValue: 2,
                poolStatus: "Selling",
              },
            ],
          },
        ],
      },
    ],
  },
};

function makePick(
  m: MatchItem,
  poolCode: PoolCode,
  optKey: string
): SelectedPick {
  const pool = m.pools[poolCode];
  const opt = pool.options.find((o) => o.key === optKey || o.label === optKey)!;
  assert.ok(opt, `Missing option ${poolCode}:${optKey} on ${m.matchNumStr}`);
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: Boolean(pool.canSingle ?? pool.single),
    canSingle: pool.canSingle,
    canAllUp: pool.canAllUp,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

function makePlanLeg(
  m: MatchItem,
  poolCode: PoolCode,
  optKey: string
): PlanLeg {
  const pk = makePick(m, poolCode, optKey);
  return {
    matchId: pk.matchId,
    matchNumStr: pk.matchNumStr,
    home: pk.home,
    away: pk.away,
    kickoff: m.kickoff,
    poolCode: pk.poolCode,
    poolName: pk.poolName,
    optionKey: pk.optionKey,
    optionLabel: pk.optionLabel,
    odds: pk.odds,
    fairProb: pk.fairProb,
  };
}

function buildFiveTicketIncidentPlan(live3: MatchItem[]): ArchetypePlan {
  const [m1, m2, m3] = live3;
  const specs: Array<[string, string, string]> = [
    ["1:1", "s2", "dd"],
    ["1:1", "s3", "dd"],
    ["0:0", "s2", "dd"],
    ["0:0", "s3", "dd"],
    ["1:1", "s2", "hd"],
  ];
  const totalCost = specs.length * 2;
  const lines: PlanTicketLine[] = specs.map(([c1, t2, h3], idx) => {
    const legs = [
      makePlanLeg(m1, "CRS", c1),
      makePlanLeg(m2, "TTG", t2),
      makePlanLeg(m3, "HAFU", h3),
    ];
    const unitPayout = bankerRoundParlayUnitPayout(legs.map((g) => g.odds));
    const prob = legs.reduce((acc, g) => acc * g.fairProb, 1);
    return {
      id: `inc-line-${idx + 1}`,
      roleLabel: `组合#${idx + 1}`,
      legs,
      modeLabel: "3串1",
      multiple: 1,
      cost: 2,
      unitPayout,
      returnPayout: unitPayout,
      netProfit: Number((unitPayout - totalCost).toFixed(2)),
      prob,
    };
  });
  return {
    key: "max-profit-prob",
    available: true,
    shortTab: "稳健保本",
    badge: "🛡️ 稳健保本",
    title: "原图5注3串1复现",
    tagline: "¥10 共5注",
    totalCost,
    savedCash: 0,
    minReturn: 775.68,
    maxReturn: 1641.6,
    winProb: 0.00316565,
    profitProb: 0.00316565,
    expectedValueRate: -0.6463,
    underwaterCount: 0,
    missOneReturn: null,
    vigPct: 56.4,
    reasons: ["复现测试"],
    lines,
  };
}

function assertClosedFourBuckets(rep: any, label: string) {
  assert.equal(rep.isEmptySlip, false, `${label}: expected non-empty slip`);
  for (const field of [
    "zeroPayoutProb",
    "partialLossProb",
    "breakEvenProb",
    "strictNetGainProb",
  ]) {
    assert.equal(
      typeof rep[field],
      "number",
      `${label}: missing numeric ${field}`
    );
    assert.ok(
      rep[field] >= 0 && rep[field] <= 1,
      `${label}: ${field}=${rep[field]} out of [0,1]`
    );
  }
  const sum =
    rep.zeroPayoutProb +
    rep.partialLossProb +
    rep.breakEvenProb +
    rep.strictNetGainProb;
  assert.ok(
    Math.abs(sum - 1) < 1e-9,
    `${label}: 4-bucket sum must equal 1 within 1e-9, got ${sum}`
  );
  assert.ok(
    rep.unconditionalQuantiles &&
      typeof rep.unconditionalQuantiles.p20 === "number" &&
      typeof rep.unconditionalQuantiles.p50 === "number" &&
      typeof rep.unconditionalQuantiles.p80 === "number" &&
      typeof rep.unconditionalQuantiles.p99 === "number",
    `${label}: missing unconditionalQuantiles`
  );
  const q = rep.unconditionalQuantiles;
  assert.ok(
    q.p20 >= 0 && q.p20 <= q.p50 && q.p50 <= q.p80 && q.p80 <= q.p99,
    `${label}: unconditionalQuantiles must be monotonic non-negative, got ${JSON.stringify(q)}`
  );
}

describe("Spec #10 · Ticket #12: Unconditional 4-Bucket Distribution, Unified Dynamic Danger & Honest Audit Cockpit", () => {
  it("Slice A: exports closed 4-bucket unconditional distribution and probability-mass quantiles across all evaluation engines while keeping ¥0 empty slips at zeroPayoutProb = 0", () => {
    const live3 = parseSportteryRawJson(LIVE_SG_THREE_MATCH_RAW) as MatchItem[];
    assert.equal(live3.length, 3);
    const [, m002] = live3;

    // 1. 5-ticket screenshot slip (¥10): zeroPayoutProb ≈ 0.996834, strictNetGainProb ≈ 0.003166, p20=p50=p80=p99=0
    const incidentPlan = buildFiveTicketIncidentPlan(live3);
    const wsIncident = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          snapshotPlan: incidentPlan,
        },
        targetIds: live3.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    const incRep = wsIncident.effectiveReport as any;
    assertClosedFourBuckets(incRep, "5-ticket incident slip");
    assert.ok(
      Math.abs(incRep.zeroPayoutProb - 0.996834) < 5e-5,
      `Expected zeroPayoutProb ≈ 0.996834, got ${incRep.zeroPayoutProb}`
    );
    assert.equal(incRep.partialLossProb, 0);
    assert.equal(incRep.breakEvenProb, 0);
    assert.ok(
      Math.abs(incRep.strictNetGainProb - 0.003166) < 5e-5,
      `Expected strictNetGainProb ≈ 0.003166, got ${incRep.strictNetGainProb}`
    );
    assert.deepEqual(incRep.unconditionalQuantiles, {
      p20: 0,
      p50: 0,
      p80: 0,
      p99: 0,
    });
    assert.equal(incRep.conditionalMinHitPayout, 775.68);
    assert.equal(incRep.conditionalMaxHitPayout, 1641.6);
    assert.equal(incRep.isUnconditionalFloorGuaranteed, false);

    // 2. Full 8-option TTG cover on 周日002 光州FC (¥16): zeroPayoutProb = 0, partialLossProb ≈ 0.7968, strictNetGainProb ≈ 0.2032
    const allTtgPicks = m002.pools.TTG.options.map((o) =>
      makePick(m002, "TTG", o.key)
    );
    assert.equal(allTtgPicks.length, 8);
    const ttgFullRep = computeTruthReport(allTtgPicks, 1, live3, {
      mode: "auto",
    }) as any;
    assertClosedFourBuckets(ttgFullRep, "8-option TTG full cover");
    assert.equal(ttgFullRep.totalCost, 16);
    assert.equal(ttgFullRep.zeroPayoutProb, 0);
    assert.ok(
      Math.abs(ttgFullRep.partialLossProb - 0.7968) < 0.005,
      `Expected partialLossProb ≈ 0.7968, got ${ttgFullRep.partialLossProb}`
    );
    assert.equal(ttgFullRep.breakEvenProb, 0);
    assert.ok(
      Math.abs(ttgFullRep.strictNetGainProb - 0.2032) < 0.005,
      `Expected strictNetGainProb ≈ 0.2032, got ${ttgFullRep.strictNetGainProb}`
    );
    assert.equal(ttgFullRep.conditionalMinHitPayout, 7.1);
    assert.equal(ttgFullRep.conditionalMaxHitPayout, 46);
    assert.equal(
      ttgFullRep.isUnconditionalFloorGuaranteed,
      false,
      "0% wipeout slip with 79.68% partial loss must NOT claim unconditional floor guarantee"
    );
    assert.ok(
      ttgFullRep.unconditionalQuantiles.p20 >= 7.1 &&
        ttgFullRep.unconditionalQuantiles.p50 < 16 &&
        ttgFullRep.unconditionalQuantiles.p80 >= 17
    );

    // 3. Exact hit-matrix path (optimizeBonusPlan), Bilinear MITM (>131,072 states), 1D single DP (9 single matches), synthetic single, and genuine unconditional floor guarantee
    const twoWayBase = computeTruthReport(
      [makePick(m002, "TTG", "s2"), makePick(m002, "TTG", "s3")],
      3,
      live3,
      { mode: "auto" }
    );
    const bonusPlan = optimizeBonusPlan(twoWayBase, live3, "equal")!;
    const bonusRep = archetypeToReport(bonusPlan, twoWayBase, live3) as any;
    assertClosedFourBuckets(bonusRep, "hit-matrix bonus plan");

    // 5 matches × 8 TTG options in 2串1 -> 8^5 = 32,768 or 6 matches × 8 TTG = 262,144 (>131,072 -> Bilinear MITM!)
    const mitmSlate = FALLBACK_MATCHES.slice(0, 6) as MatchItem[];
    const mitmPicks = mitmSlate.flatMap((m) =>
      m.pools.TTG.options.map((o) => makePick(m, "TTG", o.key))
    );
    const mitmRep = computeTruthReport(mitmPicks, 1, mitmSlate, {
      mode: "free",
      passSizes: [2],
    }) as any;
    assertClosedFourBuckets(mitmRep, "Bilinear MITM 6x8 TTG 2串1");

    // 9 single-eligible matches -> 1D single-pass cent DP
    const nineSingles = Array.from({ length: 9 }, (_, idx) => {
      const base = FALLBACK_MATCHES[idx % FALLBACK_MATCHES.length] as MatchItem;
      return {
        ...base,
        id: `sgl9-${idx}`,
        matchNumStr: `周六0${10 + idx}`,
      };
    });
    const nineSinglePicks = nineSingles.map((m) => makePick(m, "CRS", "1:1"));
    const sglDpRep = computeTruthReport(nineSinglePicks, 1, nineSingles, {
      mode: "free",
      passSizes: [1],
    }) as any;
    assertClosedFourBuckets(sglDpRep, "1D single-pass cent DP (9 matches)");

    // Auto-mounted exact synthetic single (周日001 HAD 主胜 -> 3-way HAFU dutching)
    const wsAutoSyn = evaluateQuantWorkspace(
      {
        picks: [makePick(live3[0], "HAD", "h")],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [live3[0].id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    assertClosedFourBuckets(
      wsAutoSyn.effectiveReport,
      "auto-mounted synthetic single"
    );
    assert.equal(
      wsAutoSyn.effectiveReport.isUnconditionalFloorGuaranteed,
      false
    );

    // Sandbox full 3-way cover at @3.00/@3.00/@3.00 (exact break-even floor) & @3.10/@3.10/@3.10 (strict net-gain floor)
    const makeSandboxFull3 = (odds: number): SelectedPick[] =>
      (["h", "d", "a"] as const).map((k, idx) => ({
        matchId: `sbx-floor-${odds}`,
        matchNumStr: "周日999",
        home: "甲队",
        away: "乙队",
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: true,
        canSingle: true,
        canAllUp: true,
        optionKey: k,
        optionLabel: ["主胜", "平", "客胜"][idx],
        odds,
        fairProb: 1 / 3,
      }));
    const exactBeFloorRep = computeTruthReport(makeSandboxFull3(3.0), 1, [], {
      mode: "auto",
    }) as any;
    assertClosedFourBuckets(exactBeFloorRep, "sandbox exact break-even cover");
    assert.equal(exactBeFloorRep.zeroPayoutProb, 0);
    assert.equal(exactBeFloorRep.partialLossProb, 0);
    assert.ok(Math.abs(exactBeFloorRep.breakEvenProb - 1) < 1e-9);
    assert.equal(exactBeFloorRep.strictNetGainProb, 0);
    assert.equal(exactBeFloorRep.isUnconditionalFloorGuaranteed, true);

    const strictFloorRep = computeTruthReport(makeSandboxFull3(3.1), 1, [], {
      mode: "auto",
    }) as any;
    assertClosedFourBuckets(strictFloorRep, "sandbox strict net-gain cover");
    assert.equal(strictFloorRep.zeroPayoutProb, 0);
    assert.equal(strictFloorRep.partialLossProb, 0);
    assert.equal(strictFloorRep.breakEvenProb, 0);
    assert.ok(Math.abs(strictFloorRep.strictNetGainProb - 1) < 1e-9);
    assert.equal(strictFloorRep.isUnconditionalFloorGuaranteed, true);

    // 4. Empty / unbet slips (totalCost === 0): isEmptySlip = true, zeroPayoutProb = 0 (never 100% wipeout!)
    const emptyRep = computeTruthReport([], 5, live3, { mode: "auto" }) as any;
    assert.equal(emptyRep.totalCost, 0);
    assert.equal(emptyRep.isEmptySlip, true);
    assert.equal(emptyRep.zeroPayoutProb, 0);
    assert.equal(emptyRep.partialLossProb, 0);
    assert.equal(emptyRep.breakEvenProb, 0);
    assert.equal(emptyRep.strictNetGainProb, 0);
    assert.equal(emptyRep.isUnconditionalFloorGuaranteed, false);

    assert.equal((EMPTY_TRUTH_REPORT as any).isEmptySlip, true);
    assert.equal((EMPTY_TRUTH_REPORT as any).zeroPayoutProb, 0);

    // Unconfirmed non-equivalent single (周日003 特温特 -3 让负 pending at ¥0) must also be marked empty/unbet, NOT 100% wipeout
    const wsPendingSingle = evaluateQuantWorkspace(
      {
        picks: [makePick(live3[2], "HHAD", "ha")],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [live3[2].id],
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    assert.equal(wsPendingSingle.effectiveReport.totalCost, 0);
    assert.equal((wsPendingSingle.effectiveReport as any).isEmptySlip, true);
    assert.equal((wsPendingSingle.effectiveReport as any).zeroPayoutProb, 0);
  });

  it("Slice B: computes byte-for-byte identical dynamic dangerScore and unsuppressed warnings across manual/applied/radar entries and removes the 3% floor clamp on fiveLossStreakProb", () => {
    const live3 = parseSportteryRawJson(LIVE_SG_THREE_MATCH_RAW) as MatchItem[];
    const [m1, m2, m3] = live3;

    // 1. Exact same ¥2 3串1 ticket: 周日001 1:1 @5.75 × 周日002 2球 @3.60 × 周日003 平平 @19.00
    const threePicks: SelectedPick[] = [
      makePick(m1, "CRS", "1:1"),
      makePick(m2, "TTG", "s2"),
      makePick(m3, "HAFU", "dd"),
    ];
    const planLegs: PlanLeg[] = [
      makePlanLeg(m1, "CRS", "1:1"),
      makePlanLeg(m2, "TTG", "s2"),
      makePlanLeg(m3, "HAFU", "dd"),
    ];
    const unitPay = bankerRoundParlayUnitPayout(planLegs.map((g) => g.odds));
    const singleLine: PlanTicketLine = {
      id: "same-ticket-1",
      roleLabel: "主攻#1",
      legs: planLegs,
      modeLabel: "3串1",
      multiple: 1,
      cost: 2,
      unitPayout: unitPay,
      returnPayout: unitPay,
      netProfit: Number((unitPay - 2).toFixed(2)),
      prob: planLegs.reduce((a, g) => a * g.fairProb, 1),
    };
    const makeAppliedVariant = (
      key: ArchetypePlan["key"],
      shortTab: string
    ): ArchetypePlan => ({
      key,
      available: true,
      shortTab,
      badge: shortTab,
      title: "同票跨入口一致性校验",
      tagline: "¥2 单注3串1",
      totalCost: 2,
      savedCash: 0,
      minReturn: unitPay,
      maxReturn: unitPay,
      winProb: singleLine.prob,
      profitProb: singleLine.prob,
      expectedValueRate: -0.63,
      underwaterCount: 0,
      missOneReturn: null,
      vigPct: 56.4,
      reasons: ["校验"],
      lines: [singleLine],
    });

    const manualRep = computeTruthReport(threePicks, 1, live3, {
      mode: "auto",
    });
    const slot1Rep = archetypeToReport(
      makeAppliedVariant("max-profit-prob", "稳健保本"),
      manualRep,
      live3
    );
    const alphaRep = archetypeToReport(
      makeAppliedVariant("alpha-radar", "错价雷达"),
      manualRep,
      live3
    );

    assert.ok(
      manualRep.dangerScore >= 75,
      `Expected high dynamic dangerScore >= 75 on 99.9% wipeout 3串1, got ${manualRep.dangerScore}`
    );
    assert.notEqual(slot1Rep.dangerScore, 26);
    assert.notEqual(alphaRep.dangerScore, 58);
    assert.equal(slot1Rep.dangerScore, manualRep.dangerScore);
    assert.equal(alphaRep.dangerScore, manualRep.dangerScore);
    assert.deepEqual(slot1Rep.warnings, manualRep.warnings);
    assert.deepEqual(alphaRep.warnings, manualRep.warnings);

    // Must emit BOTH high-wipeout-lottery danger red-card AND parlay-vig avalanche danger warning
    const wipeoutWarn = slot1Rep.warnings.find(
      (w: any) => w.id === "high-wipeout-lottery"
    );
    assert.ok(
      wipeoutWarn,
      "Expected high-wipeout-lottery warning when zeroPayoutProb > 0.80"
    );
    assert.equal(wipeoutWarn.severity, "danger");
    assert.match(wipeoutWarn.detail, /10\s*次约有\s*[\d.]+\s*次整单归零/);

    const vigWarn = slot1Rep.warnings.find((w: any) => w.id === "parlay-vig");
    assert.ok(
      vigWarn,
      "Applied parlay slip with compound vig avalanche must NOT suppress parlay-vig warning"
    );
    assert.equal(vigWarn.severity, "danger");

    // End-to-end workspace parity: manual vs applied snapshotPlan
    const wsManual = evaluateQuantWorkspace(
      {
        picks: threePicks,
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: live3.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    const wsApplied = evaluateQuantWorkspace(
      {
        picks: threePicks,
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          snapshotPlan: makeAppliedVariant("max-profit-prob", "稳健保本"),
        },
        targetIds: live3.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    assert.equal(
      wsApplied.effectiveReport.dangerScore,
      wsManual.effectiveReport.dangerScore
    );
    assert.deepEqual(
      wsApplied.effectiveReport.warnings,
      wsManual.effectiveReport.warnings
    );

    // 2. 0% wipeout / partial-loss slip (8-option TTG cover) has 0 high-wipeout-lottery warning and distinct lower dangerScore than 99.9% wipeout lottery
    const allTtgPicks = m2.pools.TTG.options.map((o) =>
      makePick(m2, "TTG", o.key)
    );
    const ttgFullRep = computeTruthReport(allTtgPicks, 1, live3, {
      mode: "auto",
    });
    assert.equal(
      ttgFullRep.warnings.some((w: any) => w.id === "high-wipeout-lottery"),
      false,
      "0% wipeout full TTG cover must NOT emit high-wipeout-lottery warning"
    );
    assert.ok(
      ttgFullRep.dangerScore < manualRep.dangerScore &&
        ttgFullRep.dangerScore >= 35,
      `Expected partial-loss TTG cover dangerScore (${ttgFullRep.dangerScore}) in [35, ${manualRep.dangerScore})`
    );

    // 3. Unclamped 5-loss streak on 5-ticket incident slip: (1 - 0.00316565)^5 ≈ 0.9843 (98.4%), NOT 0.8587 (86%)!
    const incidentPlan = buildFiveTicketIncidentPlan(live3);
    const wsIncident = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          snapshotPlan: incidentPlan,
        },
        targetIds: live3.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    const expectedStreak = Math.pow(
      1 - wsIncident.effectiveReport.objectiveProfitProb,
      5
    );
    assert.ok(
      Math.abs(wsIncident.insights.fiveLossStreakProb - expectedStreak) <
        1e-9 && wsIncident.insights.fiveLossStreakProb > 0.98,
      `Expected unclamped fiveLossStreakProb ≈ 0.9843, got ${wsIncident.insights.fiveLossStreakProb}`
    );

    // Empty slip has fiveLossStreakProb = 0
    const wsEmpty = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: live3.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    assert.equal(wsEmpty.insights.fiveLossStreakProb, 0);
  });

  it("Slice C: builds honest 2x2 Audit Cockpit front tiles, flip unconditional quantiles, non-expandable 全部未中 top scenario row across sort modes, small-prob precision, and zero exaggerated break-even copy", () => {
    const {
      buildAuditCockpitTiles,
      buildAuditScenarioRows,
      formatAuditProbabilityPct,
    } = cabinViewModels as any;

    assert.equal(typeof formatAuditProbabilityPct, "function");
    assert.equal(typeof buildAuditScenarioRows, "function");

    // 1. Small-probability formatter (< 0.1% renders 2 decimal places like 0.04% instead of 0.0%)
    assert.equal(formatAuditProbabilityPct(0), "0.0%");
    assert.equal(formatAuditProbabilityPct(0.00043799), "0.04%");
    assert.equal(formatAuditProbabilityPct(0.0009476), "0.09%");
    assert.equal(formatAuditProbabilityPct(0.425), "42.5%");
    assert.equal(formatAuditProbabilityPct(0.9990524), "99.91%");
    assert.equal(formatAuditProbabilityPct(1), "100.0%");

    // 2. 5-ticket incident slip (¥10, zeroPayoutProb ≈ 99.6834%): honest 2x2 front tiles, danger header badge, and flip quantiles (P20/P50/P80 = ¥0)
    const live3 = parseSportteryRawJson(LIVE_SG_THREE_MATCH_RAW) as MatchItem[];
    const incidentPlan = buildFiveTicketIncidentPlan(live3);
    const wsIncident = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          snapshotPlan: incidentPlan,
        },
        targetIds: live3.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    const incTiles = buildAuditCockpitTiles(
      wsIncident.effectiveReport,
      wsIncident.insights
    );

    // Header danger badge wired to .danger when dangerScore >= 70
    assert.equal(incTiles.headerBadge.isDanger, true);
    assert.ok(incTiles.headerBadge.dangerScore >= 75);
    assert.match(incTiles.headerBadge.text, /危险分\s*\d+\s*·\s*高危/);

    // Tile 1: 整单归零率 + 本金损失 ¥10 (isDanger when zeroPayoutProb > 0.80, never struck through!)
    assert.equal(incTiles.tile1.label, "整单归零率");
    assert.equal(incTiles.tile1.value, "99.7%");
    assert.ok(incTiles.tile1.subtitle.includes("本金损失 ¥10"));
    assert.equal(incTiles.tile1.isDanger, true);
    assert.notEqual(incTiles.tile1.strikeSubtitle, true);

    // Tile 2: 严格净赚率 + 平手保本率 (0.3%, isDanger on tiny strict net gain, never "命中任一组均盈利")
    assert.equal(incTiles.tile2.label, "严格净赚率");
    assert.equal(incTiles.tile2.value, "0.3%");
    assert.equal(incTiles.tile2.isDanger, true);
    assert.equal(incTiles.tile2.subtitle.includes("命中任一组均盈利"), false);

    // Tile 3: Conditional hit-payout range (never "真实保底奖金"!)
    assert.equal(incTiles.tile3.label, "命中后最低/最高返奖");
    assert.equal(incTiles.tile3.label.includes("保底"), false);
    assert.match(incTiles.tile3.value, /¥776～¥1642/);
    assert.ok(incTiles.tile3.subtitle.includes("未中返 ¥0"));
    assert.equal(incTiles.tile3.subtitle.includes("命中任一组均盈利"), false);

    // Tile 4: Expected net loss & expected return + unclamped 98.4% 5-loss streak
    assert.equal(incTiles.tile4.label, "期望净亏 · 期望返奖");
    assert.match(incTiles.tile4.value, /^-¥6\.\d{2}\s*\(-64\.\d%\)$/);
    assert.ok(
      incTiles.tile4.subtitle.includes("期返¥3.") &&
        incTiles.tile4.subtitle.includes("连黑5次 98.4%") &&
        incTiles.tile4.subtitle.includes("凯利0%·娱乐≤"),
      `Unexpected tile4 subtitle: ${incTiles.tile4.subtitle}`
    );
    assert.equal(incTiles.tile4.isDanger, true);

    // Flip back: unconditional probability-mass quantiles (P20/P50/P80 = ¥0 / ¥0 / ¥0, median P50=¥0)
    assert.ok(incTiles.flipBack.quantileTile.label.includes("P20/P50/P80"));
    assert.equal(incTiles.flipBack.quantileTile.value, "¥0 / ¥0 / ¥0");
    assert.ok(incTiles.flipBack.quantileTile.subtitle.includes("中位数P50=¥0"));
    assert.equal(incTiles.flipBack.quantileTile.isDanger, true);

    // 3. Scenario rows: non-expandable 全部未中 row at top in BOTH loss-first and prob-first, and at bottom in profit-first; <0.1% rows show 0.04% / 0.09%
    const rowsByLoss = buildAuditScenarioRows(
      wsIncident.effectiveReport,
      "loss-first",
      {
        matchCount: wsIncident.effectiveReport.matchCount,
        defaultMultiple: 1,
        appliedLines: wsIncident.appliedPlan?.lines,
      }
    );
    const rowsByProb = buildAuditScenarioRows(
      wsIncident.effectiveReport,
      "prob-first",
      {
        matchCount: wsIncident.effectiveReport.matchCount,
        defaultMultiple: 1,
        appliedLines: wsIncident.appliedPlan?.lines,
      }
    );
    const rowsByProfit = buildAuditScenarioRows(
      wsIncident.effectiveReport,
      "profit-first",
      {
        matchCount: wsIncident.effectiveReport.matchCount,
        defaultMultiple: 1,
        appliedLines: wsIncident.appliedPlan?.lines,
      }
    );

    assert.equal(rowsByLoss.length, 6);
    assert.equal(rowsByLoss[0].isZeroWipeoutRow, true);
    assert.equal(rowsByLoss[0].expandable, false);
    assert.equal(rowsByLoss[0].winningTicketCount, 0);
    assert.deepEqual(rowsByLoss[0].winningTickets, []);
    assert.equal(rowsByLoss[0].scenarioLabel, "全部未中");
    assert.equal(rowsByLoss[0].totalPayout, 0);
    assert.equal(rowsByLoss[0].netProfit, -10);

    assert.equal(rowsByProb[0].isZeroWipeoutRow, true);
    assert.equal(rowsByProfit[rowsByProfit.length - 1].isZeroWipeoutRow, true);
    assert.ok(
      rowsByProb.some((r: any) => r.probText === "0.04%"),
      `Expected 0.04% small-prob row in ${JSON.stringify(rowsByProb.map((r: any) => r.probText))}`
    );
    assert.ok(
      rowsByProb.some((r: any) => r.probText === "0.09%"),
      `Expected 0.09% small-prob row in ${JSON.stringify(rowsByProb.map((r: any) => r.probText))}`
    );

    // 4. Full 8-option TTG cover (zeroPayoutProb = 0): NO fake 全部未中 row, Tile 1 shows 0.0% + partial-loss note!
    const allTtgPicks = live3[1].pools.TTG.options.map((o) =>
      makePick(live3[1], "TTG", o.key)
    );
    const ttgFullRep = computeTruthReport(allTtgPicks, 1, live3, {
      mode: "auto",
    });
    const ttgRows = buildAuditScenarioRows(ttgFullRep, "loss-first");
    assert.equal(
      ttgRows.some((r: any) => r.isZeroWipeoutRow),
      false,
      "0% wipeout slip must NOT prepend a 全部未中 row"
    );
    const ttgTiles = buildAuditCockpitTiles(ttgFullRep, EMPTY_INSIGHTS);
    assert.equal(ttgTiles.tile1.value, "0.0%");
    assert.equal(ttgTiles.tile1.isDanger, false);
    assert.ok(ttgTiles.tile1.subtitle.includes("零归零"));

    // 5. Break-even > 0 slip & empty ¥0 slip: zero "命中任一组均盈利" copy, unconditional floor title only when truly guaranteed
    const makeSandboxFull3 = (odds: number): SelectedPick[] =>
      (["h", "d", "a"] as const).map((k, idx) => ({
        matchId: `sbx-c-${odds}`,
        matchNumStr: "周日998",
        home: "甲队",
        away: "乙队",
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: true,
        canSingle: true,
        canAllUp: true,
        optionKey: k,
        optionLabel: ["主胜", "平", "客胜"][idx],
        odds,
        fairProb: 1 / 3,
      }));
    const exactBeRep = computeTruthReport(makeSandboxFull3(3.0), 1, [], {
      mode: "auto",
    });
    const exactBeTiles = buildAuditCockpitTiles(exactBeRep, EMPTY_INSIGHTS);
    assert.equal(exactBeTiles.tile3.label, "无条件保底～最高返奖");
    const serializedBeTiles = JSON.stringify(exactBeTiles);
    assert.equal(serializedBeTiles.includes("命中任一组均盈利"), false);
    assert.ok(exactBeTiles.tile2.subtitle.includes("刚回本"));

    const emptyTiles = buildAuditCockpitTiles(
      EMPTY_TRUTH_REPORT,
      EMPTY_INSIGHTS
    );
    assert.equal(emptyTiles.tile1.value, "0.0%");
    assert.equal(emptyTiles.tile1.isDanger, false);
    assert.equal(
      buildAuditScenarioRows(EMPTY_TRUTH_REPORT, "loss-first").length,
      0
    );
  });
});
