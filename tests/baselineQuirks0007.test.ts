import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  analyzeMatchMicroQuant,
  archetypeToReport,
  calibrateMatchCoherentModel,
  computeProOrderInsights,
  computeTruthReport,
  evaluateQuantWorkspace,
  generateFiveArchetypes,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import { fetchOfficialMatchesServer } from "../server/sportteryFeed.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";
import type {
  ArchetypePlan,
  MatchItem,
  OddsOption,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

function makeExactCrsOptions(
  probByLabel: Record<string, number>
): OddsOption[] {
  return OFFICIAL_CRS_PAIRS.map(([, label]: [string, string]) => {
    const p = probByLabel[label] ?? 0.005;
    return {
      key: label,
      label,
      odds: Number((0.88 / p).toFixed(2)),
      trend: 0,
      fairProb: p,
    };
  });
}

describe("Spec 0007 Ticket 01: Live Sporttery Purity, CRS One-Goal Card-Pan & Strict Staggered Hedge", () => {
  it("Slice A: strips hardcoded fallback aiAlert when live matchNumStr collides (e.g. 周二002) and reports accurate 8-match fallback syncNote", async () => {
    const livePayload = {
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: 2059902,
                matchNumStr: "周二002",
                leagueAbbName: "欧冠",
                matchTime: "03:00:00",
                homeTeamAbbName: "阿森纳",
                awayTeamAbbName: "巴黎圣日耳曼",
                poolList: [
                  { poolCode: "HAD", single: 1, cbtValue: 1 },
                  { poolCode: "HHAD", single: 1, cbtValue: 1 },
                  { poolCode: "CRS", single: 1, cbtValue: 1 },
                  { poolCode: "TTG", single: 1, cbtValue: 1 },
                  { poolCode: "HAFU", single: 1, cbtValue: 1 },
                ],
                had: { h: "1.92", d: "3.35", a: "3.40" },
                hhad: { goalLine: "-1", h: "3.65", d: "3.45", a: "1.76" },
                crs: {
                  s01s00: "6.50",
                  s02s01: "7.50",
                  s00s00: "9.50",
                  s01s01: "6.20",
                  s00s01: "9.00",
                },
                ttg: {
                  s0: "9.5",
                  s1: "4.3",
                  s2: "3.2",
                  s3: "3.6",
                  s4: "6.2",
                  s5: "12",
                  s6: "24",
                  s7: "32",
                },
                hafu: {
                  hh: "3.0",
                  hd: "14",
                  ha: "32",
                  dh: "4.6",
                  dd: "5.0",
                  da: "7.8",
                  ah: "26",
                  ad: "14",
                  aa: "5.8",
                },
              },
            ],
          },
        ],
      },
    };

    const parsed = parseSportteryRawJson(livePayload);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].matchNumStr, "周二002");
    assert.equal(parsed[0].aiAlert, undefined);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("simulated offline");
    }) as typeof fetch;
    try {
      const missingSnapshot = path.join(
        os.tmpdir(),
        `yj-missing-snap-${Date.now()}-${Math.random()}.json`
      );
      const res = await fetchOfficialMatchesServer(missingSnapshot);
      assert.equal(res.source, "fallback");
      assert.equal(FALLBACK_MATCHES.length, 8);
      assert.equal(res.matches.length, 8);
      assert.ok(
        res.syncNote.includes(`${FALLBACK_MATCHES.length} 场`),
        `Expected syncNote to report "${FALLBACK_MATCHES.length} 场", got "${res.syncNote}"`
      );
      assert.equal(res.syncNote.includes("4 场"), false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("Slice B: computes coherent 1-goal share across ±1, non-±1 lines (-2/+2) & suspended HHAD (Spec 0008 superseding piecewise CRS stitch) and unifies 50% amber badge threshold", () => {
    const base = FALLBACK_MATCHES[0] as MatchItem;

    // 1. goalLine = -1 selling HHAD with >= 50% coherent 1-goal share -> matches coherent HHAD.hd / HAD.h AND triggers amber badge
    const minusOne51: MatchItem = {
      ...base,
      id: "b-minus1-51",
      home: "阿森纳",
      away: "富勒姆",
      pools: {
        ...base.pools,
        HAD: {
          ...base.pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.76, trend: 0, fairProb: 0.5 },
            { key: "d", label: "平", odds: 3.52, trend: 0, fairProb: 0.25 },
            { key: "a", label: "客胜", odds: 3.52, trend: 0, fairProb: 0.25 },
          ],
        },
        HHAD: {
          ...base.pools.HHAD,
          selling: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.74, trend: 0, fairProb: 0.235 },
            { key: "hd", label: "让平", odds: 3.45, trend: 0, fairProb: 0.255 },
            { key: "ha", label: "让负", odds: 1.73, trend: 0, fairProb: 0.51 },
          ],
        },
      },
    };
    const cal51 = calibrateMatchCoherentModel(minusOne51);
    const mq51 = analyzeMatchMicroQuant(minusOne51);
    assert.ok(Math.abs(mq51.oneGoalProb - cal51.poolProbs.HHAD.hd) < 1e-12);
    assert.ok(
      Math.abs(
        mq51.oneGoalShareOfWins -
          Math.min(0.85, cal51.poolProbs.HHAD.hd / cal51.poolProbs.HAD.h)
      ) < 1e-12
    );
    assert.ok(
      mq51.oneGoalShareOfWins >= 0.5,
      `Expected >= 50% card-pan share, got ${mq51.oneGoalShareOfWins}`
    );
    assert.equal(mq51.microBadges[1].tone, "amber");
    assert.equal(
      mq51.microBadges[1].text,
      `防赢1球卡盘 ${(mq51.oneGoalShareOfWins * 100).toFixed(0)}%`
    );

    // 2. goalLine = -2 deep home favorite (FALLBACK_MATCHES[5] 法国 vs 以色列 style) -> uses coherent P(X-Y=1)/P(X>Y) (< 50%), NOT HHAD(-2).hd!
    const homeMinusTwo: MatchItem = {
      ...(FALLBACK_MATCHES[5] as MatchItem),
      id: "b-home-minus2",
      home: "拜仁",
      away: "波鸿",
      pools: {
        ...(FALLBACK_MATCHES[5] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.1, trend: 0, fairProb: 0.8 },
            { key: "d", label: "平", odds: 7.3, trend: 0, fairProb: 0.12 },
            { key: "a", label: "客胜", odds: 11.0, trend: 0, fairProb: 0.08 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.HHAD,
          selling: true,
          goalLine: "-2",
          options: [
            { key: "hh", label: "让胜", odds: 2.1, trend: 0, fairProb: 0.42 },
            { key: "hd", label: "让平", odds: 3.6, trend: 0, fairProb: 0.24 },
            { key: "ha", label: "让负", odds: 2.6, trend: 0, fairProb: 0.34 },
          ],
        },
        CRS: {
          ...(FALLBACK_MATCHES[5] as MatchItem).pools.CRS,
          selling: true,
          options: makeExactCrsOptions({
            "1:0": 0.1,
            "2:1": 0.08,
            "3:2": 0.02,
            "2:0": 0.22,
            "3:0": 0.18,
            "3:1": 0.1,
            "4:0": 0.02,
            "4:1": 0.02,
            "4:2": 0.01,
            "5:0": 0.01,
            "5:1": 0.01,
            "5:2": 0.01,
            胜其它: 0.02,
            "0:0": 0.04,
            "1:1": 0.05,
            "2:2": 0.02,
            "3:3": 0.005,
            平其它: 0.005,
            "0:1": 0.03,
            "1:2": 0.02,
            "0:2": 0.01,
            "2:3": 0.004,
            "0:3": 0.002,
            "1:3": 0.002,
            "0:4": 0.002,
            "1:4": 0.002,
            "2:4": 0.002,
            "0:5": 0.002,
            "1:5": 0.001,
            "2:5": 0.001,
            负其它: 0.002,
          }),
        },
      },
    };
    const calMinusTwo = calibrateMatchCoherentModel(homeMinusTwo);
    const mqMinusTwo = analyzeMatchMicroQuant(homeMinusTwo);
    assert.ok(
      mqMinusTwo.oneGoalShareOfWins < 0.5,
      `Deep -2 favorite should have <50% 1-goal share, got ${mqMinusTwo.oneGoalShareOfWins}`
    );
    assert.ok(
      Math.abs(mqMinusTwo.oneGoalProb - calMinusTwo.poolProbs.HHAD.hd) > 0.01,
      "Must NOT confuse HHAD(-2).hd (2-goal win) with 1-goal win"
    );
    // ADR-0019: on deep -2 handicap, true cover (z > 2, i.e. win by >= 3 goals) excludes 2-goal push (让平)
    assert.ok(
      (mqMinusTwo.favoriteTrueCoverShareOfWins ?? 0) <
        1 - mqMinusTwo.oneGoalShareOfWins,
      "Deep -2 true cover share must exclude 2-goal exact push (z = 2)"
    );
    const expectedDeepTone =
      (mqMinusTwo.favoriteTrueCoverShareOfWins ?? 0) <= 0.5
        ? "amber"
        : "emerald";
    assert.equal(mqMinusTwo.microBadges[1].tone, expectedDeepTone);
    assert.ok(
      mqMinusTwo.microBadges[1].text.includes("让胜") &&
        mqMinusTwo.microBadges[1].text.includes(
          `${((mqMinusTwo.favoriteTrueCoverShareOfWins ?? 0) * 100).toFixed(0)}%`
        )
    );

    // 3. goalLine = +2 defensive away favorite & suspended HHAD (default '-1' trap) & suspended CRS zero-div safety
    const awayCrsOptions = makeExactCrsOptions({
      "0:1": 0.28,
      "1:2": 0.14,
      "2:3": 0.03,
      "0:2": 0.08,
      "0:3": 0.02,
      "1:3": 0.015,
      "0:4": 0.005,
      "1:4": 0.004,
      "2:4": 0.003,
      "0:5": 0.002,
      "1:5": 0.002,
      "2:5": 0.002,
      负其它: 0.002,
      "0:0": 0.14,
      "1:1": 0.11,
      "2:2": 0.02,
      "3:3": 0.003,
      平其它: 0.002,
      "1:0": 0.07,
      "2:1": 0.03,
      "2:0": 0.012,
      "3:2": 0.004,
      "3:0": 0.003,
      "3:1": 0.003,
      "4:0": 0.002,
      "4:1": 0.002,
      "4:2": 0.002,
      "5:0": 0.002,
      "5:1": 0.002,
      "5:2": 0.002,
      胜其它: 0.002,
    });
    const awayPlusTwo: MatchItem = {
      ...(FALLBACK_MATCHES[7] as MatchItem),
      id: "b-away-plus2",
      home: "弱旅",
      away: "皇马",
      pools: {
        ...(FALLBACK_MATCHES[7] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[7] as MatchItem).pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 5.4, trend: 0, fairProb: 0.16 },
            { key: "d", label: "平", odds: 3.35, trend: 0, fairProb: 0.26 },
            { key: "a", label: "客胜", odds: 1.54, trend: 0, fairProb: 0.58 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[7] as MatchItem).pools.HHAD,
          selling: true,
          goalLine: "+2",
          options: [
            { key: "hh", label: "让胜", odds: 1.18, trend: 0, fairProb: 0.74 },
            { key: "hd", label: "让平", odds: 4.5, trend: 0, fairProb: 0.19 },
            { key: "ha", label: "让负", odds: 11.5, trend: 0, fairProb: 0.07 },
          ],
        },
        TTG: {
          ...(FALLBACK_MATCHES[7] as MatchItem).pools.TTG,
          selling: true,
          options: [
            { key: "s0", label: "0球", odds: 4.8, trend: 0, fairProb: 0.18 },
            { key: "s1", label: "1球", odds: 2.85, trend: 0, fairProb: 0.3 },
            { key: "s2", label: "2球", odds: 3.2, trend: 0, fairProb: 0.27 },
            { key: "s3", label: "3球", odds: 5.2, trend: 0, fairProb: 0.15 },
            { key: "s4", label: "4球", odds: 11.5, trend: 0, fairProb: 0.06 },
            { key: "s5", label: "5球", odds: 25.0, trend: 0, fairProb: 0.024 },
            { key: "s6", label: "6球", odds: 50.0, trend: 0, fairProb: 0.01 },
            { key: "s7", label: "7+球", odds: 80.0, trend: 0, fairProb: 0.006 },
          ],
        },
        CRS: {
          ...(FALLBACK_MATCHES[7] as MatchItem).pools.CRS,
          selling: true,
          options: awayCrsOptions,
        },
      },
    };
    const mqPlusTwo = analyzeMatchMicroQuant(awayPlusTwo);
    assert.ok(
      mqPlusTwo.oneGoalShareOfWins >= 0.5,
      `Expected defensive away favorite on +2 to trigger >=50% card-pan, got ${mqPlusTwo.oneGoalShareOfWins}`
    );
    assert.equal(mqPlusTwo.microBadges[1].tone, "amber");
    assert.ok(mqPlusTwo.cardPanTip.includes("皇马"));

    const hhadSuspended: MatchItem = {
      ...awayPlusTwo,
      id: "b-hhad-suspended",
      pools: {
        ...awayPlusTwo.pools,
        HHAD: {
          ...awayPlusTwo.pools.HHAD,
          selling: false,
          goalLine: "-1",
          options: [],
        },
      },
    };
    const mqHhadSusp = analyzeMatchMicroQuant(hhadSuspended);
    assert.ok(mqHhadSusp.oneGoalShareOfWins >= 0.5);
    assert.ok(
      mqHhadSusp.cardPanTip.includes("皇马"),
      "Must still identify away favorite 皇马 when HHAD is suspended with default -1 goalLine"
    );

    const bothSuspended: MatchItem = {
      ...hhadSuspended,
      id: "b-both-suspended",
      pools: {
        ...hhadSuspended.pools,
        CRS: { ...hhadSuspended.pools.CRS, selling: false, options: [] },
      },
    };
    const mqBothSusp = analyzeMatchMicroQuant(bothSuspended);
    assert.equal(Number.isFinite(mqBothSusp.oneGoalShareOfWins), true);
    assert.equal(Number.isFinite(mqBothSusp.oneGoalProb), true);
    assert.ok(
      mqBothSusp.oneGoalShareOfWins > 0 && mqBothSusp.oneGoalShareOfWins <= 0.85
    );
  });

  it("Slice C: enforces checkout/parlay gate, penultimate-to-last >=110m gap (with YYYYMMDD ordering), and 100% complementary HAD/HHAD opposite resolution", () => {
    const pickOf = (
      m: MatchItem,
      poolCode: PoolCode,
      optionKey: string
    ): SelectedPick => {
      const pool = m.pools[poolCode];
      const opt = pool.options.find((o) => o.key === optionKey)!;
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
    };

    const baseEarly = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "c-early-2000",
      matchNumStr: "周六001",
      kickoff: "20:00",
    };
    const baseMidLate = {
      ...(FALLBACK_MATCHES[2] as MatchItem),
      id: "c-mid-0330",
      matchNumStr: "周六004",
      kickoff: "03:30",
    };
    const baseLate: MatchItem = {
      ...(FALLBACK_MATCHES[3] as MatchItem),
      id: "c-late-0345",
      matchNumStr: "周六007",
      kickoff: "03:45",
      pools: {
        ...(FALLBACK_MATCHES[3] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.96, trend: 0, fairProb: 0.45 },
            { key: "d", label: "平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "a", label: "客胜", odds: 3.6, trend: 0, fairProb: 0.29 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HHAD,
          single: true,
          selling: true,
          goalLine: "-1",
          name: "让球(-1)",
          options: [
            { key: "hh", label: "让胜", odds: 3.6, trend: 0, fairProb: 0.24 },
            { key: "hd", label: "让平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "ha", label: "让负", odds: 1.92, trend: 0, fairProb: 0.5 },
          ],
        },
      },
    };

    // 1. Pure single pass (passSizes: [1]) and blocked checkout (> ¥20,000) MUST NOT offer staggered hedge
    const twoSinglePicks = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(baseLate, "HAD", "h"),
    ];
    const repPureSingle = computeTruthReport(
      twoSinglePicks,
      5,
      [baseEarly, baseLate],
      {
        mode: "free",
        passSizes: [1],
      }
    );
    const insPureSingle = computeProOrderInsights(
      twoSinglePicks,
      repPureSingle,
      [baseEarly, baseLate]
    );
    assert.equal(insPureSingle.hedge.available, false);
    assert.ok(insPureSingle.hedge.reason.includes("单关"));

    const repBlockedOver20k = {
      ...computeTruthReport(twoSinglePicks, 5, [baseEarly, baseLate]),
      canCheckout: false,
    };
    const insBlocked = computeProOrderInsights(
      twoSinglePicks,
      repBlockedOver20k,
      [baseEarly, baseLate]
    );
    assert.equal(insBlocked.hedge.available, false);

    // 2. 3-match parlay 20:00 + 03:30 + 03:45 -> penultimate (03:30) to late (03:45) is only 15 mins (< 110) -> FALSE!
    const threeDualLatePicks = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(baseMidLate, "HAD", "h"),
      pickOf(baseLate, "HAD", "h"),
    ];
    const repDualLate = computeTruthReport(threeDualLatePicks, 5, [
      baseEarly,
      baseMidLate,
      baseLate,
    ]);
    const insDualLate = computeProOrderInsights(
      threeDualLatePicks,
      repDualLate,
      [baseEarly, baseMidLate, baseLate]
    );
    assert.equal(insDualLate.hedge.available, false);
    assert.equal(insDualLate.hedge.gapMinutes, 15);
    assert.ok(
      insDualLate.hedge.reason.includes("前序") ||
        insDualLate.hedge.reason.includes("完场")
    );

    // Whereas 19:30 + 20:00 + 03:45 -> penultimate (20:00) to late (03:45) is 465 mins (>= 110) -> TRUE!
    const baseEarly1930 = {
      ...baseEarly,
      id: "c-early-1930",
      matchNumStr: "周六000",
      kickoff: "19:30",
    };
    const threeValidPicks = [
      pickOf(baseEarly1930, "HAD", "h"),
      pickOf(baseEarly, "HAD", "h"),
      pickOf(baseLate, "HAD", "h"),
    ];
    const repThreeValid = computeTruthReport(threeValidPicks, 5, [
      baseEarly1930,
      baseEarly,
      baseLate,
    ]);
    const insThreeValid = computeProOrderInsights(
      threeValidPicks,
      repThreeValid,
      [baseEarly1930, baseEarly, baseLate]
    );
    assert.equal(insThreeValid.hedge.available, true);
    assert.equal(insThreeValid.hedge.gapMinutes, 465);

    // YYYYMMDD cross-date ordering: 20261117-005 (03:45) followed by 20261119-001 (01:00) -> 20261119-001 is late!
    const d1Match = FALLBACK_MATCHES[2] as MatchItem; // 20261117-005 (03:45)
    const d2Match = FALLBACK_MATCHES[4] as MatchItem; // 20261119-001 (01:00)
    const crossDatePicks = [
      pickOf(d2Match, "HAD", "h"),
      pickOf(d1Match, "HAD", "h"),
    ];
    const repCrossDate = computeTruthReport(crossDatePicks, 5, [
      d1Match,
      d2Match,
    ]);
    const insCrossDate = computeProOrderInsights(crossDatePicks, repCrossDate, [
      d1Match,
      d2Match,
    ]);
    assert.equal(insCrossDate.hedge.available, true);
    assert.equal(insCrossDate.hedge.lateKickoff, "01:00");
    assert.ok(insCrossDate.hedge.lateMatchTitle.includes("周四001"));

    // 3. Complementary opposite bet resolution across all HAD / HHAD / non-complementary cases:
    // (a) HAD h: HHAD(-1) ha @1.92 > HAD[d 3.4 + a 3.6] (@1.7486) -> picks 1.92
    const repHadH = computeTruthReport(twoSinglePicks, 10, [
      baseEarly,
      baseLate,
    ]);
    const insHadH = computeProOrderInsights(twoSinglePicks, repHadH, [
      baseEarly,
      baseLate,
    ]);
    assert.equal(insHadH.hedge.available, true);
    assert.equal(insHadH.hedge.oppositeOdds, 1.92);

    // (b) HAD a on +1 match: compares HHAD(+1) hh vs HAD[h+d] and picks higher
    const latePlusOne: MatchItem = {
      ...baseLate,
      pools: {
        ...baseLate.pools,
        HAD: {
          ...baseLate.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 3.8, trend: 0, fairProb: 0.23 },
            { key: "d", label: "平", odds: 4.2, trend: 0, fairProb: 0.21 },
            { key: "a", label: "客胜", odds: 1.68, trend: 0, fairProb: 0.56 },
          ],
        },
        HHAD: {
          ...baseLate.pools.HHAD,
          goalLine: "+1",
          name: "让球(+1)",
          options: [
            { key: "hh", label: "让胜", odds: 1.82, trend: 0, fairProb: 0.48 },
            { key: "hd", label: "让平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "ha", label: "让负", odds: 3.4, trend: 0, fairProb: 0.26 },
          ],
        },
      },
    };
    const picksHadA = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(latePlusOne, "HAD", "a"),
    ];
    const insHadA = computeProOrderInsights(
      picksHadA,
      computeTruthReport(picksHadA, 10, [baseEarly, latePlusOne]),
      [baseEarly, latePlusOne]
    );
    assert.equal(insHadA.hedge.available, true);
    const expectedHadHD = 1 / (1 / 3.8 + 1 / 4.2); // 1.995 > 1.82
    assert.ok(Math.abs(insHadA.hedge.oppositeOdds - expectedHadHD) < 1e-9);

    // (c) HAD d (draw): MUST use HAD[主胜+客胜] harmonic pair (no single HHAD covers {h, a}!)
    const early220: MatchItem = {
      ...baseEarly,
      pools: {
        ...baseEarly.pools,
        HAD: {
          ...baseEarly.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 2.2, trend: 0, fairProb: 0.4 },
            { key: "d", label: "平", odds: 3.2, trend: 0, fairProb: 0.28 },
            { key: "a", label: "客胜", odds: 2.8, trend: 0, fairProb: 0.32 },
          ],
        },
      },
    };
    const lateDraw: MatchItem = {
      ...baseLate,
      pools: {
        ...baseLate.pools,
        HAD: {
          ...baseLate.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 2.4, trend: 0, fairProb: 0.37 },
            { key: "d", label: "平", odds: 3.1, trend: 0, fairProb: 0.29 },
            { key: "a", label: "客胜", odds: 2.7, trend: 0, fairProb: 0.34 },
          ],
        },
      },
    };
    const picksHadD = [
      pickOf(early220, "HAD", "h"),
      pickOf(lateDraw, "HAD", "d"),
    ];
    const insHadD = computeProOrderInsights(
      picksHadD,
      computeTruthReport(picksHadD, 10, [early220, lateDraw]),
      [early220, lateDraw]
    );
    assert.equal(insHadD.hedge.available, true);
    const expectedHA = 1 / (1 / 2.4 + 1 / 2.7); // 6.48 / 5.10
    assert.ok(Math.abs(insHadD.hedge.oppositeOdds - expectedHA) < 1e-9);
    // Exact physical ¥2 integer pair split (Spec 0011): 28 notes on h@2.40 (¥56 -> ¥134.40) + 25 notes on a@2.70 (¥50 -> ¥135.00) = ¥106 hedgeCost, locking min(136.40, 134.40, 135.00) - 20 - 106 = +¥8.40
    assert.equal(insHadD.hedge.hedgeCost, 106);
    assert.equal(insHadD.hedge.lockedNetProfit, 8.4);

    // (d) HAD double pick [h, d] -> uses remaining 3rd option HAD a (@3.60)
    const picksHadDouble = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(baseLate, "HAD", "h"),
      pickOf(baseLate, "HAD", "d"),
    ];
    const insHadDouble = computeProOrderInsights(
      picksHadDouble,
      computeTruthReport(picksHadDouble, 10, [baseEarly, baseLate]),
      [baseEarly, baseLate]
    );
    assert.equal(insHadDouble.hedge.available, true);
    assert.equal(insHadDouble.hedge.oppositeOdds, 3.6);

    // (e) HHAD(-1) ha single pick -> compares HAD h (@1.96) vs HHAD[hh 3.6 + hd 3.4] (@1.7486) -> picks 1.96
    const picksHhadMinus1Ha = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(baseLate, "HHAD", "ha"),
    ];
    const insHhadMinus1Ha = computeProOrderInsights(
      picksHhadMinus1Ha,
      computeTruthReport(picksHhadMinus1Ha, 10, [baseEarly, baseLate]),
      [baseEarly, baseLate]
    );
    assert.equal(insHhadMinus1Ha.hedge.available, true);
    assert.equal(insHhadMinus1Ha.hedge.oppositeOdds, 1.96);

    // (f) HHAD(-2) hh single pick & HHAD(-2) [hh, hd] double pick
    const lateMinusTwo: MatchItem = {
      ...baseLate,
      pools: {
        ...baseLate.pools,
        HHAD: {
          ...baseLate.pools.HHAD,
          goalLine: "-2",
          name: "让球(-2)",
          options: [
            { key: "hh", label: "让胜", odds: 2.5, trend: 0, fairProb: 0.35 },
            { key: "hd", label: "让平", odds: 3.6, trend: 0, fairProb: 0.25 },
            { key: "ha", label: "让负", odds: 2.4, trend: 0, fairProb: 0.4 },
          ],
        },
      },
    };
    const picksHhadMinus2Hh = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(lateMinusTwo, "HHAD", "hh"),
    ];
    const insHhadMinus2Hh = computeProOrderInsights(
      picksHhadMinus2Hh,
      computeTruthReport(picksHhadMinus2Hh, 10, [baseEarly, lateMinusTwo]),
      [baseEarly, lateMinusTwo]
    );
    assert.equal(insHhadMinus2Hh.hedge.available, true);
    assert.ok(
      Math.abs(insHhadMinus2Hh.hedge.oppositeOdds - 1 / (1 / 3.6 + 1 / 2.4)) <
        1e-9
    ); // 1.44

    const picksHhadDouble = [
      pickOf(baseEarly, "HAD", "h"),
      pickOf(lateMinusTwo, "HHAD", "hh"),
      pickOf(lateMinusTwo, "HHAD", "hd"),
    ];
    const insHhadDouble = computeProOrderInsights(
      picksHhadDouble,
      computeTruthReport(picksHhadDouble, 10, [baseEarly, lateMinusTwo]),
      [baseEarly, lateMinusTwo]
    );
    assert.equal(insHhadDouble.hedge.available, true);
    assert.equal(insHhadDouble.hedge.oppositeOdds, 2.4);

    // (g) Late match picks TTG / CRS / HAFU -> available: false with clear Chinese reason
    for (const [poolCode, key] of [
      ["TTG", "s2"],
      ["CRS", "1:0"],
      ["HAFU", "hh"],
    ] as const) {
      const nonCompPicks = [
        pickOf(baseEarly, "HAD", "h"),
        pickOf(baseLate, poolCode, key),
      ];
      const insNonComp = computeProOrderInsights(
        nonCompPicks,
        computeTruthReport(nonCompPicks, 10, [baseEarly, baseLate]),
        [baseEarly, baseLate]
      );
      assert.equal(
        insNonComp.hedge.available,
        false,
        `Expected ${poolCode} on late match to reject hedge`
      );
      assert.ok(insNonComp.hedge.reason.length >= 10);
    }
  });
});

describe("Spec 0007 Ticket 02: Sandbox Simulation on Non-Equal Bonus & Archetype Plans", () => {
  it("Slice A: archetypeToReport computes exact linear expectedValueRate (replacing hardcoded -vigPct/100) and preserves statutory cappedClipped with danger cap-clip warning", () => {
    // 1. Mutually exclusive 2-line unequal plan with exact hand-calculated linear EV:
    // Line 1: prob = 0.2025, totalPayout = 64 -> E1 = 12.96
    // Line 2: prob = 0.099,  totalPayout = 32 -> E2 = 3.168
    // Total expected return = 16.128, totalCost = 20 -> exact EV = (16.128 - 20) / 20 = -0.1936 (NOT -vigPct/100 = -0.125!)
    const unequalPlan: ArchetypePlan = {
      key: "iron-shield",
      available: true,
      shortTab: "博热保本",
      badge: "🔥 博热保本优化",
      title: "次选回本护盾 + 第一主攻利润最大化",
      tagline: "总投入 ¥20 · 保底返 ¥32.0 ~ 最高 ¥64.0",
      totalCost: 20,
      savedCash: 0,
      minReturn: 32,
      maxReturn: 64,
      winProb: 0.3015,
      profitProb: 0.3015,
      expectedValueRate: -0.1936,
      underwaterCount: 0,
      missOneReturn: null,
      vigPct: 12.5,
      reasons: ["手算真值校验"],
      lines: [
        {
          id: "l1",
          roleLabel: "🔥主攻重锤",
          legs: [
            {
              matchId: "t2-m1",
              matchNumStr: "周二001",
              home: "阿森纳",
              away: "富勒姆",
              kickoff: "20:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 2.0,
              fairProb: 0.45,
            },
            {
              matchId: "t2-m2",
              matchNumStr: "周二002",
              home: "拜仁",
              away: "波鸿",
              kickoff: "22:30",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 2.0,
              fairProb: 0.45,
            },
          ],
          modeLabel: "2串1",
          multiple: 8,
          cost: 16,
          unitPayout: 8.0,
          returnPayout: 64.0,
          netProfit: 44.0,
          prob: 0.2025,
        },
        {
          id: "l2",
          roleLabel: "🛡️次选回本盾#1",
          legs: [
            {
              matchId: "t2-m1",
              matchNumStr: "周二001",
              home: "阿森纳",
              away: "富勒姆",
              kickoff: "20:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "d",
              optionLabel: "平",
              odds: 4.0,
              fairProb: 0.22,
            },
            {
              matchId: "t2-m2",
              matchNumStr: "周二002",
              home: "拜仁",
              away: "波鸿",
              kickoff: "22:30",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 2.0,
              fairProb: 0.45,
            },
          ],
          modeLabel: "2串1",
          multiple: 2,
          cost: 4,
          unitPayout: 16.0,
          returnPayout: 32.0,
          netProfit: 12.0,
          prob: 0.099,
        },
      ],
    };

    const repUnequal = archetypeToReport(unequalPlan, null);
    assert.equal(repUnequal.modeLabel, "博热保本·分倍精算");
    assert.ok(
      Math.abs(repUnequal.expectedValueRate - -0.1936) < 1e-9,
      `Expected exact linear EV -0.1936, got ${repUnequal.expectedValueRate}`
    );
    assert.equal(repUnequal.combos[0].cappedClipped, 0);
    assert.equal(
      repUnequal.warnings.some((w: { id: string }) => w.id === "cap-clip"),
      false
    );

    // 2. Statutory 2-leg cap (200,000) clipping: 400 * 400 * 2 = 320,000 -> clipped 120,000 per unit * 3x = 360,000!
    // Plus overlapping 2串1 fault-tolerant linearity check:
    // Line A: prob = 0.001, totalPayout = 600,000 -> E_A = 600
    // Line B: prob = 0.25,  totalPayout = 36      -> E_B = 9
    // TotalCost = 10 -> exact linear EV = (609 - 10) / 10 = 59.9
    const cappedFaultPlan: ArchetypePlan = {
      key: "fault-tolerant",
      available: true,
      shortTab: "🧩 容错防爆",
      badge: "🧩 容错防爆流",
      title: "M串N 防黑一场回血网",
      tagline: "封顶截断与线性期望校验",
      totalCost: 10,
      savedCash: 0,
      minReturn: 36,
      maxReturn: 600_036,
      winProb: 0.251,
      profitProb: 0.251,
      expectedValueRate: 59.9,
      underwaterCount: 0,
      missOneReturn: 36,
      vigPct: 22.0,
      reasons: ["测试封顶截断"],
      lines: [
        {
          id: "cap-1",
          roleLabel: "高倍冷箭(2串1)",
          legs: [
            {
              matchId: "t2-c1",
              matchNumStr: "周二003",
              home: "甲队",
              away: "乙队",
              kickoff: "20:00",
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "3:2",
              optionLabel: "3:2",
              odds: 400,
              fairProb: 0.02,
            },
            {
              matchId: "t2-c2",
              matchNumStr: "周二004",
              home: "丙队",
              away: "丁队",
              kickoff: "22:00",
              poolCode: "CRS",
              poolName: "比分",
              optionKey: "3:2",
              optionLabel: "3:2",
              odds: 400,
              fairProb: 0.05,
            },
          ],
          modeLabel: "2串1",
          multiple: 3,
          cost: 6,
          unitPayout: 200_000,
          returnPayout: 600_000,
          netProfit: 599_990,
          prob: 0.001,
        },
        {
          id: "cap-2",
          roleLabel: "容错回血垫(2串1)",
          legs: [
            {
              matchId: "t2-c1",
              matchNumStr: "周二003",
              home: "甲队",
              away: "乙队",
              kickoff: "20:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 3.0,
              fairProb: 0.5,
            },
            {
              matchId: "t2-c3",
              matchNumStr: "周二005",
              home: "戊队",
              away: "己队",
              kickoff: "23:30",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 3.0,
              fairProb: 0.5,
            },
          ],
          modeLabel: "2串1",
          multiple: 2,
          cost: 4,
          unitPayout: 18,
          returnPayout: 36,
          netProfit: 26,
          prob: 0.25,
        },
      ],
    };

    const repCapped = archetypeToReport(cappedFaultPlan, null);
    assert.equal(repCapped.tickets![0].cappedClipped, 360_000);
    assert.equal(repCapped.tickets![1].cappedClipped, 0);
    assert.ok(
      repCapped.combos.some(
        (c: { cappedClipped: number }) => c.cappedClipped === 360_000
      )
    );
    assert.ok(Math.abs(repCapped.expectedValueRate - 59.9) < 1e-9);
    const capWarn = repCapped.warnings.find(
      (w: { id: string }) => w.id === "cap-clip"
    );
    assert.ok(
      capWarn,
      "Expected cap-clip danger warning when statutory cap clips payout"
    );
    assert.equal(capWarn.severity, "danger");
    assert.ok(capWarn.title.includes("360000"));
    assert.ok(capWarn.detail.includes("20 万元"));
  });

  it("Slice B: evaluateQuantWorkspace locks baseline unequal multiples on Three-Mode Bonus Optimization and applies subjectiveDeltaPct, simVoidFirstMatch, [0.02,0.96] clamping & statutory cap clipping", () => {
    const baseTpl = FALLBACK_MATCHES[0] as MatchItem;
    const sbM1: MatchItem = {
      ...baseTpl,
      id: "t2-sb-m1",
      matchNumStr: "周二001",
      home: "曼城",
      away: "布莱顿",
      kickoff: "20:00",
      aiAlert: undefined,
      pools: {
        ...baseTpl.pools,
        HAD: {
          ...baseTpl.pools.HAD,
          single: false,
          selling: true,
          payoutRatio: 0.88,
          vig: 0.12,
          options: [
            { key: "h", label: "主胜", odds: 2.0, trend: 0, fairProb: 0.44 },
            { key: "d", label: "平", odds: 3.5, trend: 0, fairProb: 0.25 },
            { key: "a", label: "客胜", odds: 2.84, trend: 0, fairProb: 0.31 },
          ],
        },
      },
    };
    const sbM2: MatchItem = {
      ...baseTpl,
      id: "t2-sb-m2",
      matchNumStr: "周二002",
      home: "皇马",
      away: "赫塔费",
      kickoff: "23:00",
      aiAlert: undefined,
      pools: {
        ...baseTpl.pools,
        HAD: {
          ...baseTpl.pools.HAD,
          single: false,
          selling: true,
          payoutRatio: 0.88,
          vig: 0.12,
          options: [
            { key: "h", label: "主胜", odds: 1.8, trend: 0, fairProb: 0.5 },
            { key: "d", label: "平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "a", label: "客胜", odds: 3.65, trend: 0, fairProb: 0.24 },
          ],
        },
      },
    };
    const matches = [sbM1, sbM2];
    const picks: SelectedPick[] = [
      {
        matchId: sbM1.id,
        matchNumStr: sbM1.matchNumStr,
        home: sbM1.home,
        away: sbM1.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 2.0,
        fairProb: 0.44,
      },
      {
        matchId: sbM1.id,
        matchNumStr: sbM1.matchNumStr,
        home: sbM1.home,
        away: sbM1.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "d",
        optionLabel: "平",
        odds: 3.5,
        fairProb: 0.25,
      },
      {
        matchId: sbM2.id,
        matchNumStr: sbM2.matchNumStr,
        home: sbM2.home,
        away: sbM2.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 1.8,
        fairProb: 0.5,
      },
    ];

    // 1. Baseline (0% delta, void = false): multiples = [8, 2], totalCost = 20, exact EV = -20.89%
    const wsBase = evaluateQuantWorkspace(
      {
        picks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds: [sbM1.id, sbM2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.equal(wsBase.effectiveReport.modeLabel, "博热保本·分倍精算");
    assert.deepEqual(
      wsBase.appliedPlan!.lines.map((l: { multiple: number }) => l.multiple),
      [8, 2]
    );
    assert.equal(wsBase.effectiveReport.totalCost, 20);
    assert.ok(
      Math.abs(wsBase.effectiveReport.expectedValueRate - -0.2089) < 1e-9
    );
    assert.ok(Math.abs(wsBase.subjectiveEVPct - -20.89) < 1e-9);

    // 2. Drag confidence slider to +15%: keeps [8, 2] & modeLabel '博热保本·分倍精算', EV jumps to +4.622975%!
    const wsPlus15 = evaluateQuantWorkspace(
      {
        picks,
        multiple: 5,
        subjectiveDeltaPct: 15,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds: [sbM1.id, sbM2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.equal(wsPlus15.effectiveReport.modeLabel, "博热保本·分倍精算");
    assert.deepEqual(
      wsPlus15.appliedPlan!.lines.map((l: { multiple: number }) => l.multiple),
      [8, 2]
    );
    assert.equal(wsPlus15.effectiveReport.totalCost, 20);
    assert.ok(Math.abs(wsPlus15.appliedPlan!.lines[0].prob - 0.29095) < 1e-9);
    assert.ok(Math.abs(wsPlus15.appliedPlan!.lines[1].prob - 0.1653125) < 1e-9);
    assert.ok(
      Math.abs(wsPlus15.effectiveReport.expectedValueRate - 0.04622975) < 1e-9
    );
    assert.ok(Math.abs(wsPlus15.subjectiveEVPct - 4.622975) < 1e-7);

    // 3. Enable simVoidFirstMatch (first match odds -> 1.0): keeps [8, 2] & cost 20 (does NOT re-optimize!),
    //    recomputes payouts [28.80, 7.20], flags shield line underwater (7.20 < 20), EV = -63.82%
    const wsVoid = evaluateQuantWorkspace(
      {
        picks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: true,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds: [sbM1.id, sbM2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.equal(wsVoid.effectiveReport.modeLabel, "博热保本·分倍精算");
    assert.deepEqual(
      wsVoid.appliedPlan!.lines.map((l: { multiple: number }) => l.multiple),
      [8, 2]
    );
    assert.deepEqual(
      wsVoid.appliedPlan!.lines.map((l: { cost: number }) => l.cost),
      [16, 4]
    );
    assert.equal(wsVoid.effectiveReport.totalCost, 20);
    assert.equal(wsVoid.appliedPlan!.lines[0].legs[0].odds, 1.0);
    assert.equal(wsVoid.appliedPlan!.lines[0].legs[1].odds, 1.8);
    assert.equal(wsVoid.appliedPlan!.lines[0].unitPayout, 3.6);
    assert.equal(wsVoid.appliedPlan!.lines[0].returnPayout, 28.8);
    assert.equal(wsVoid.appliedPlan!.lines[1].returnPayout, 7.2);
    // ADR-0019 §4: when sbM1 is void, sbM1 is removed from the hit condition of BOTH lines,
    // so both lines reduce to {sbM2:h} and co-hit together paying 28.8 + 7.2 = 36.0 whenever sbM2=h!
    assert.equal(wsVoid.effectiveReport.minPayout, 36);
    assert.equal(wsVoid.effectiveReport.maxPayout, 36);
    assert.equal(wsVoid.effectiveReport.underwaterCount, 0);
    assert.ok(
      Math.abs(
        wsVoid.effectiveReport.realProfitProb -
          wsVoid.effectiveReport.anyWinProb
      ) < 1e-9 && wsVoid.effectiveReport.realProfitProb > 0.4
    );
    assert.ok(
      Math.abs(
        wsVoid.effectiveReport.expectedValueRate -
          (36 * wsVoid.effectiveReport.anyWinProb - 20) / 20
      ) < 1e-9
    );

    // 4. Combined simVoidFirstMatch + subjectiveDeltaPct (+15%) + scaleMultiple (2x -> [16, 4], cost 40)
    const wsVoidScaled = evaluateQuantWorkspace(
      {
        picks,
        multiple: 5,
        subjectiveDeltaPct: 15,
        simVoidFirstMatch: true,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 2 },
        targetIds: [sbM1.id, sbM2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    assert.deepEqual(
      wsVoidScaled.appliedPlan!.lines.map(
        (l: { multiple: number }) => l.multiple
      ),
      [16, 4]
    );
    assert.equal(wsVoidScaled.effectiveReport.totalCost, 40);
    assert.equal(wsVoidScaled.effectiveReport.minPayout, 72);
    assert.equal(wsVoidScaled.effectiveReport.maxPayout, 72);
    assert.ok(
      wsVoidScaled.effectiveReport.expectedValueRate >
        wsVoid.effectiveReport.expectedValueRate
    );

    // 5. Probability [0.02, 0.96] clamping + statutory 200,000 cap clipping & void cap relief
    const capM1: MatchItem = {
      ...sbM1,
      id: "t2-cap-m1",
      pools: {
        ...sbM1.pools,
        CRS: {
          ...sbM1.pools.CRS,
          single: true,
          selling: true,
          options: [
            { key: "1:0", label: "1:0", odds: 5.0, trend: 0, fairProb: 0.85 },
            { key: "3:2", label: "3:2", odds: 400.0, trend: 0, fairProb: 0.01 },
          ],
        },
      },
    };
    const capM2: MatchItem = {
      ...sbM2,
      id: "t2-cap-m2",
      pools: {
        ...sbM2.pools,
        CRS: {
          ...sbM2.pools.CRS,
          single: true,
          selling: true,
          options: [
            { key: "3:2", label: "3:2", odds: 400.0, trend: 0, fairProb: 0.05 },
          ],
        },
      },
    };
    const capPicks: SelectedPick[] = [
      {
        matchId: capM1.id,
        matchNumStr: capM1.matchNumStr,
        home: capM1.home,
        away: capM1.away,
        poolCode: "CRS",
        poolName: "比分",
        singleAllowed: true,
        optionKey: "1:0",
        optionLabel: "1:0",
        odds: 5.0,
        fairProb: 0.85,
      },
      {
        matchId: capM1.id,
        matchNumStr: capM1.matchNumStr,
        home: capM1.home,
        away: capM1.away,
        poolCode: "CRS",
        poolName: "比分",
        singleAllowed: true,
        optionKey: "3:2",
        optionLabel: "3:2",
        odds: 400.0,
        fairProb: 0.01,
      },
      {
        matchId: capM2.id,
        matchNumStr: capM2.matchNumStr,
        home: capM2.home,
        away: capM2.away,
        poolCode: "CRS",
        poolName: "比分",
        singleAllowed: true,
        optionKey: "3:2",
        optionLabel: "3:2",
        odds: 400.0,
        fairProb: 0.05,
      },
    ];
    const wsCapPlus20 = evaluateQuantWorkspace(
      {
        picks: capPicks,
        multiple: 2,
        subjectiveDeltaPct: 20,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "cold-first", scaleMultiple: 1 },
        targetIds: [capM1.id, capM2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [capM1, capM2]
    );
    // Spec 0008 union [0.02, 0.98] probability-conserving scaling: (0.85 + 0.01) * 1.20 = 1.032 -> clamped to 0.98, preserving 85:1 ratio!
    const hotLine = wsCapPlus20.appliedPlan!.lines.find(
      (l: { legs: Array<{ optionKey: string }> }) =>
        l.legs[0].optionKey === "1:0"
    )!;
    const coldLine = wsCapPlus20.appliedPlan!.lines.find(
      (l: { legs: Array<{ optionKey: string }> }) =>
        l.legs[0].optionKey === "3:2"
    )!;
    assert.ok(
      Math.abs(hotLine.legs[0].fairProb + coldLine.legs[0].fairProb - 0.98) <
        1e-12
    );
    assert.ok(
      Math.abs(hotLine.legs[0].fairProb / coldLine.legs[0].fairProb - 85) < 1e-9
    );
    assert.equal(coldLine.unitPayout, 200_000);
    const coldCombo = wsCapPlus20.effectiveReport.combos.find(
      (c: { id: string }) => c.id === coldLine.id
    )!;
    assert.equal(coldCombo.cappedClipped, 120_000 * coldLine.multiple);
    assert.equal(
      wsCapPlus20.allWarnings.some(
        (w: { id: string; severity: string }) =>
          w.id === "cap-clip" && w.severity === "danger"
      ),
      true
    );

    // Voiding capM1 drops 400 * 400 -> 1.0 * 400 (unitPayout 800), eliminating cap clipping!
    const wsCapVoid = evaluateQuantWorkspace(
      {
        picks: capPicks,
        multiple: 2,
        subjectiveDeltaPct: 20,
        simVoidFirstMatch: true,
        planSpec: { kind: "bonus", optMode: "cold-first", scaleMultiple: 1 },
        targetIds: [capM1.id, capM2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [capM1, capM2]
    );
    const coldTicketVoid = wsCapVoid.effectiveReport.tickets!.find(
      (c: { id: string }) => c.id === coldLine.id
    )!;
    assert.equal(coldTicketVoid.unitPayout, 800);
    assert.equal(coldTicketVoid.cappedClipped, 0);
    assert.equal(wsCapVoid.effectiveReport.combos[0].cappedClipped, 0);
    assert.equal(
      wsCapVoid.allWarnings.some(
        (w: { id: string; severity: string }) =>
          w.id === "cap-clip" && w.severity === "danger"
      ),
      false
    );
  });

  it("Slice C: evaluateQuantWorkspace applies sandbox to Five Archetypes (spear-shield, fault-tolerant missOneReturn/maxReturn, and GB/T 8170 half-even rounding on voided snapshotPlan)", () => {
    const m1 = FALLBACK_MATCHES[0] as MatchItem;
    const m2 = FALLBACK_MATCHES[1] as MatchItem;

    // 1. Five Archetypes spear-shield: keeps modeLabel & unequal multiples across +15% slider and first-match void
    const wsSpearBase = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "archetype", key: "spear-shield", scaleMultiple: 2 },
        targetIds: [m1.id, m2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(wsSpearBase.effectiveReport.modeLabel, "⚖️ 期望效用·分倍精算");
    const spearBaseMults = wsSpearBase.appliedPlan!.lines.map(
      (l: { multiple: number }) => l.multiple
    );
    const spearBaseCost = wsSpearBase.appliedPlan!.totalCost;
    assert.ok(spearBaseMults.length >= 1);

    const wsSpearPlus15 = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 15,
        simVoidFirstMatch: false,
        planSpec: { kind: "archetype", key: "spear-shield", scaleMultiple: 2 },
        targetIds: [m1.id, m2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(
      wsSpearPlus15.effectiveReport.modeLabel,
      "⚖️ 期望效用·分倍精算"
    );
    assert.deepEqual(
      wsSpearPlus15.appliedPlan!.lines.map(
        (l: { multiple: number }) => l.multiple
      ),
      spearBaseMults
    );
    assert.equal(wsSpearPlus15.effectiveReport.totalCost, spearBaseCost);
    assert.ok(wsSpearPlus15.subjectiveEVPct > wsSpearBase.subjectiveEVPct + 15);
    assert.ok(
      Math.abs(
        wsSpearPlus15.subjectiveEVPct -
          wsSpearPlus15.effectiveReport.expectedValueRate * 100
      ) < 1e-9
    );

    const wsSpearVoid = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: true,
        planSpec: { kind: "archetype", key: "spear-shield", scaleMultiple: 2 },
        targetIds: [m1.id, m2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(wsSpearVoid.effectiveReport.modeLabel, "⚖️ 期望效用·分倍精算");
    assert.deepEqual(
      wsSpearVoid.appliedPlan!.lines.map(
        (l: { multiple: number }) => l.multiple
      ),
      spearBaseMults
    );
    for (const line of wsSpearVoid.appliedPlan!.lines) {
      for (const leg of line.legs) {
        if (leg.matchId === m1.id) {
          assert.equal(leg.odds, 1.0, "First match m1 must be voided to 1.0");
        } else if (leg.matchId === m2.id) {
          assert.notEqual(
            leg.odds,
            1.0,
            "Second match m2 must retain real odds"
          );
        }
      }
    }
    assert.ok(
      wsSpearVoid.effectiveReport.maxPayout <
        wsSpearBase.effectiveReport.maxPayout
    );

    // 2. 5-match fault-tolerant archetype: updates missOneReturn (from 2串1 pairs), stacked maxReturn, and ensures likelyRange[0] >= minPayout
    const fiveTargets = [0, 1, 2, 3, 4].map((idx) => {
      const tpl = FALLBACK_MATCHES[idx] as MatchItem;
      const favOdds = idx === 0 ? 8.0 : 1.25;
      const favProb = idx === 0 ? 0.4 : 0.65;
      return {
        ...tpl,
        id: `t2-ft5-${idx}`,
        matchNumStr: `周三00${idx + 1}`,
        pools: {
          ...tpl.pools,
          HAD: {
            ...tpl.pools.HAD,
            selling: true,
            single: true,
            options: [
              {
                key: "h",
                label: "主胜",
                odds: favOdds,
                trend: 0,
                fairProb: favProb,
              },
              {
                key: "d",
                label: "平",
                odds: 3.6,
                trend: 0,
                fairProb: (1 - favProb) / 2,
              },
              {
                key: "a",
                label: "客胜",
                odds: 4.2,
                trend: 0,
                fairProb: (1 - favProb) / 2,
              },
            ],
          },
        },
      } as MatchItem;
    });

    const wsFault5Void = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: fiveTargets[0].id,
            matchNumStr: fiveTargets[0].matchNumStr,
            home: fiveTargets[0].home,
            away: fiveTargets[0].away,
            poolCode: "HAD",
            poolName: "胜平负",
            singleAllowed: true,
            optionKey: "h",
            optionLabel: "主胜",
            odds: 8.0,
            fairProb: 0.4,
          },
        ],
        multiple: 5,
        subjectiveDeltaPct: 10,
        simVoidFirstMatch: true,
        planSpec: {
          kind: "archetype",
          key: "fault-tolerant",
          scaleMultiple: 1,
        },
        targetIds: fiveTargets.map((x) => x.id),
        budget: 30,
        stance: "objective",
        unlockFullAgg: false,
      },
      fiveTargets
    );
    assert.equal(
      wsFault5Void.effectiveReport.modeLabel,
      "🧩 容错缩水·分倍精算"
    );
    const subLines = wsFault5Void.appliedPlan!.lines.filter(
      (l: { legs: unknown[] }) => l.legs.length < 5
    );
    assert.ok(
      subLines.length >= 3 && wsFault5Void.appliedPlan!.lines.length <= 10
    );
    const expectedMissOne = Math.min(
      ...fiveTargets.map((ft) =>
        Number(
          wsFault5Void
            .appliedPlan!.lines.filter(
              (l: { legs: Array<{ matchId: string }> }) =>
                !l.legs.some((g) => g.matchId === ft.id)
            )
            .reduce(
              (a: number, l: { returnPayout: number }) => a + l.returnPayout,
              0
            )
            .toFixed(2)
        )
      )
    );
    assert.equal(wsFault5Void.appliedPlan!.missOneReturn, expectedMissOne);
    const expectedStackedMax = Number(
      wsFault5Void
        .appliedPlan!.lines.reduce(
          (a: number, l: { returnPayout: number }) => a + l.returnPayout,
          0
        )
        .toFixed(2)
    );
    assert.equal(wsFault5Void.appliedPlan!.maxReturn, expectedStackedMax);
    assert.ok(wsFault5Void.effectiveReport.minPayout > 0);
    assert.equal(wsFault5Void.effectiveReport.maxPayout, expectedStackedMax);
    assert.ok(
      wsFault5Void.effectiveReport.likelyRange[0] >=
        wsFault5Void.effectiveReport.minPayout,
      `Expected likelyRange[0] (${wsFault5Void.effectiveReport.likelyRange[0]}) >= minPayout (${wsFault5Void.effectiveReport.minPayout})`
    );

    // 3. Custom snapshotPlan with exact GB/T 8170 half-even rounding on voided first match:
    //    Line 1: [1.75, 1.15, 1.75] -> void first -> [1.0, 1.15, 1.75] * 2 = 4.025 (2 is EVEN -> 4.02!) * 10x = 40.20
    //    Line 2: [1.75, 1.35, 1.25] -> void first -> [1.0, 1.35, 1.25] * 2 = 3.375 (7 is ODD  -> 3.38!) * 10x = 33.80
    const halfEvenSnap: ArchetypePlan = {
      key: "spear-shield",
      available: true,
      shortTab: "🎯 博胆护盾",
      badge: "🎯 博胆护盾流",
      title: "银行家舍入腰斩测试",
      tagline: "四舍六入五成双校验",
      totalCost: 40,
      savedCash: 0,
      minReturn: 59.1,
      maxReturn: 70.4,
      winProb: 0.3,
      profitProb: 0.3,
      expectedValueRate: 0,
      underwaterCount: 0,
      missOneReturn: null,
      vigPct: 12,
      reasons: ["GB/T 8170"],
      lines: [
        {
          id: "he-even",
          roleLabel: "偶分位舍去",
          legs: [
            {
              matchId: "he-m1",
              matchNumStr: "周四001",
              home: "甲",
              away: "乙",
              kickoff: "20:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 1.75,
              fairProb: 0.5,
            },
            {
              matchId: "he-m2",
              matchNumStr: "周四002",
              home: "丙",
              away: "丁",
              kickoff: "21:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 1.15,
              fairProb: 0.7,
            },
            {
              matchId: "he-m3",
              matchNumStr: "周四003",
              home: "戊",
              away: "己",
              kickoff: "22:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 1.75,
              fairProb: 0.5,
            },
          ],
          modeLabel: "3串1",
          multiple: 10,
          cost: 20,
          unitPayout: 7.04,
          returnPayout: 70.4,
          netProfit: 30.4,
          prob: 0.175,
        },
        {
          id: "he-odd",
          roleLabel: "奇分位进一",
          legs: [
            {
              matchId: "he-m1",
              matchNumStr: "周四001",
              home: "甲",
              away: "乙",
              kickoff: "20:00",
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 1.75,
              fairProb: 0.5,
            },
            {
              matchId: "he-m2",
              matchNumStr: "周四002",
              home: "丙",
              away: "丁",
              kickoff: "21:00",
              poolCode: "HHAD",
              poolName: "让球(-1)",
              optionKey: "hh",
              optionLabel: "让胜",
              odds: 1.35,
              fairProb: 0.5,
            },
            {
              matchId: "he-m3",
              matchNumStr: "周四003",
              home: "戊",
              away: "己",
              kickoff: "22:00",
              poolCode: "HHAD",
              poolName: "让球(-1)",
              optionKey: "ha",
              optionLabel: "让负",
              odds: 1.25,
              fairProb: 0.5,
            },
          ],
          modeLabel: "3串1",
          multiple: 10,
          cost: 20,
          unitPayout: 5.91,
          returnPayout: 59.1,
          netProfit: 19.1,
          prob: 0.125,
        },
      ],
    };

    const wsHalfEvenVoid = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: true,
        planSpec: {
          kind: "archetype",
          key: "spear-shield",
          snapshotPlan: halfEvenSnap,
          scaleMultiple: 1,
        },
        targetIds: [],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(wsHalfEvenVoid.appliedPlan!.lines[0].unitPayout, 4.02);
    assert.equal(wsHalfEvenVoid.appliedPlan!.lines[0].returnPayout, 40.2);
    assert.equal(wsHalfEvenVoid.appliedPlan!.lines[1].unitPayout, 3.38);
    assert.equal(wsHalfEvenVoid.appliedPlan!.lines[1].returnPayout, 33.8);
    assert.equal(wsHalfEvenVoid.effectiveReport.underwaterCount, 1); // 33.8 < 40, 40.2 >= 40
  });

  it("Cross-cutting regressions: securityShield live aiAlert purity, first-match void order, snapshotPlan stance lock, and asymmetric appliedPlan hedge guard", async () => {
    // 1. securityShield ensureMatchesLoaded must NOT graft FALLBACK_MATCHES demo aiAlert onto live 周二002
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-0007-shield-"));
    const liveMatchCollision = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: 2059988,
                matchNumStr: "周二002",
                matchDate: "2026-05-12",
                matchTime: "21:00:00",
                leagueAbbName: "英冠",
                homeTeamAbbName: "利兹联",
                awayTeamAbbName: "伯恩利",
                had: {
                  h: "2.10",
                  d: "3.20",
                  a: "3.05",
                  single: 1,
                  poolStatus: "Selling",
                },
                hhad: {
                  h: "4.35",
                  d: "3.65",
                  a: "1.58",
                  goalLine: "-1",
                  single: 0,
                  poolStatus: "Selling",
                },
              },
            ],
          },
        ],
      },
    })[0];
    assert.equal(liveMatchCollision.aiAlert, undefined);

    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: [liveMatchCollision],
        source: "sporttery-live",
        syncNote: "已同步中国体彩官网实盘（共 1 场在售竞彩足球）",
      }),
    });
    const prevStorageDesc = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );
    const prevFetch = globalThis.fetch;
    const memStore = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
        setItem: (k: string, v: string) => {
          memStore.set(k, String(v));
        },
        removeItem: (k: string) => {
          memStore.delete(k);
        },
        clear: () => memStore.clear(),
      },
    });
    try {
      const u = runtime.accountManager.createAccount({
        username: "livepure1",
        password: "User@2026",
        durationHours: 48,
        maxDevices: 2,
      });
      assert.ok(u.user.id);
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        const uStr =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.pathname
              : input.url;
        const urlPath = uStr.startsWith("http") ? new URL(uStr).pathname : uStr;
        const hdrs: Record<string, string> = {
          host: "localhost:5188",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          accept: "application/json",
        };
        if (init?.headers) {
          for (const [k, v] of Object.entries(
            init.headers as Record<string, string>
          )) {
            hdrs[k.toLowerCase()] = String(v);
          }
        }
        const bodyBuf = init?.body
          ? Buffer.from(String(init.body), "utf8")
          : Buffer.alloc(0);
        let code = 200;
        let respBody = "";
        const fakeReq = Object.assign(
          Readable.from(bodyBuf.length > 0 ? [bodyBuf] : []),
          {
            method: init?.method || "GET",
            url: urlPath,
            headers: hdrs,
            socket: { remoteAddress: "198.51.100.77" },
          }
        );
        const fakeRes = {
          statusCode: 200,
          setHeader() {},
          end(c?: string) {
            code = this.statusCode;
            respBody = c || "";
          },
        };
        await runtime.gateway.handleRequest(
          fakeReq as never,
          fakeRes as never,
          urlPath
        );
        return new Response(respBody, {
          status: code,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      const clientMod = (await import(
        `../src/security/secureClient.ts?purity=${Date.now()}`
      )) as Record<string, any>;
      await clientMod.bootstrapSecureWorkspace(true);
      const loginRes = await clientMod.loginWithPassword(
        "livepure1",
        "User@2026"
      );
      assert.equal(loginRes.matches.length, 1);
      assert.equal(loginRes.matches[0].matchNumStr, "周二002");
      assert.equal(
        loginRes.matches[0].aiAlert,
        undefined,
        "Gateway must NOT graft FALLBACK_MATCHES Dortmund aiAlert onto live 周二002"
      );
    } finally {
      globalThis.fetch = prevFetch;
      if (prevStorageDesc) {
        Object.defineProperty(globalThis, "localStorage", prevStorageDesc);
      } else {
        delete (globalThis as Record<string, unknown>).localStorage;
      }
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 2. betSlipController.applyArchetype & all 5 archetypes void m1 (1st match), NOT m2
    const m1 = FALLBACK_MATCHES[0] as MatchItem;
    const m2 = FALLBACK_MATCHES[1] as MatchItem;
    const fivePlans = generateFiveArchetypes(
      [m1, m2],
      100,
      "objective",
      false,
      []
    );
    for (const plan of fivePlans.filter(
      (p: { available: boolean }) => p.available
    )) {
      const wsVoid = evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: true,
          planSpec: {
            kind: "archetype",
            key: plan.key,
            snapshotPlan: plan,
            scaleMultiple: 1,
          },
          targetIds: [m1.id, m2.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        FALLBACK_MATCHES
      );
      for (const line of wsVoid.appliedPlan!.lines) {
        for (const leg of line.legs) {
          if (leg.matchId === m1.id) {
            assert.equal(leg.odds, 1.0, `Archetype ${plan.key} must void m1`);
          } else if (leg.matchId === m2.id) {
            assert.notEqual(
              leg.odds,
              1.0,
              `Archetype ${plan.key} must NOT void m2`
            );
          }
        }
      }
    }

    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      [m1, m2],
      [],
      evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [m1.id, m2.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        [m1, m2]
      )
    );
    const spearPlan = fivePlans.find(
      (p: { key: string }) => p.key === "max-ev-utility"
    )!;
    ctrl.applyArchetype(spearPlan);
    assert.equal(ctrl.getState().picks.length, 0);
    assert.equal(ctrl.getState().activeAuditedSlip.matches[0].matchId, m1.id);

    // 3. Frozen snapshotPlan preserves leg fairProb even when preview stance changes later
    const wsObjSnap = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "spear-shield",
          snapshotPlan: spearPlan,
          scaleMultiple: 1,
        },
        targetIds: [m1.id, m2.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    const wsColdStanceWithObjSnap = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "spear-shield",
          snapshotPlan: spearPlan,
          scaleMultiple: 1,
        },
        targetIds: [m1.id, m2.id],
        budget: 100,
        stance: "cold",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.deepEqual(
      wsColdStanceWithObjSnap.appliedPlan!.lines.map(
        (l: { prob: number }) => l.prob
      ),
      wsObjSnap.appliedPlan!.lines.map((l: { prob: number }) => l.prob),
      "Frozen snapshotPlan must not drift when preview stance changes"
    );

    // 4. Staggered hedge on appliedPlan: works when picks=[] on consistent late pool, blocks cross-pool / asymmetric early legs
    const earlyM: MatchItem = {
      ...(FALLBACK_MATCHES[0] as MatchItem),
      id: "20260512-101",
      matchNumStr: "周二101",
      kickoff: "18:00",
    };
    const lateM: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "20260512-102",
      matchNumStr: "周二102",
      kickoff: "22:00",
    };
    const crossPoolSnap: ArchetypePlan = {
      ...spearPlan,
      lines: [
        {
          id: "cp-1",
          roleLabel: "主攻",
          modeLabel: "2串1",
          multiple: 5,
          cost: 10,
          unitPayout: 6.0,
          returnPayout: 30,
          netProfit: 10,
          prob: 0.25,
          legs: [
            {
              matchId: earlyM.id,
              matchNumStr: earlyM.matchNumStr,
              home: earlyM.home,
              away: earlyM.away,
              kickoff: earlyM.kickoff,
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 1.5,
              fairProb: 0.6,
            },
            {
              matchId: lateM.id,
              matchNumStr: lateM.matchNumStr,
              home: lateM.home,
              away: lateM.away,
              kickoff: lateM.kickoff,
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 2.0,
              fairProb: 0.45,
            },
          ],
        },
        {
          id: "cp-2",
          roleLabel: "副攻跨池",
          modeLabel: "2串1",
          multiple: 5,
          cost: 10,
          unitPayout: 9.0,
          returnPayout: 45,
          netProfit: 25,
          prob: 0.15,
          legs: [
            {
              matchId: earlyM.id,
              matchNumStr: earlyM.matchNumStr,
              home: earlyM.home,
              away: earlyM.away,
              kickoff: earlyM.kickoff,
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "h",
              optionLabel: "主胜",
              odds: 1.5,
              fairProb: 0.6,
            },
            {
              matchId: lateM.id,
              matchNumStr: lateM.matchNumStr,
              home: lateM.home,
              away: lateM.away,
              kickoff: lateM.kickoff,
              poolCode: "HHAD",
              poolName: "让球(-1)",
              optionKey: "hd",
              optionLabel: "让平",
              odds: 3.4,
              fairProb: 0.25,
            },
          ],
        },
      ],
    };
    const wsCrossPoolHedge = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "spear-shield",
          snapshotPlan: crossPoolSnap,
          scaleMultiple: 1,
        },
        targetIds: [earlyM.id, lateM.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      [earlyM, lateM]
    );
    assert.equal(
      wsCrossPoolHedge.insights.hedge.available,
      false,
      "Cross-pool late legs in appliedPlan must NOT claim zero-blind-spot hedge"
    );

    const symSnap: ArchetypePlan = {
      ...crossPoolSnap,
      lines: [
        crossPoolSnap.lines[0],
        {
          ...crossPoolSnap.lines[1],
          legs: [
            crossPoolSnap.lines[1].legs[0],
            {
              matchId: lateM.id,
              matchNumStr: lateM.matchNumStr,
              home: lateM.home,
              away: lateM.away,
              kickoff: lateM.kickoff,
              poolCode: "HAD",
              poolName: "胜平负",
              optionKey: "d",
              optionLabel: "平",
              odds: 3.3,
              fairProb: 0.27,
            },
          ],
        },
      ],
    };
    const wsSymHedge = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "spear-shield",
          snapshotPlan: symSnap,
          scaleMultiple: 1,
        },
        targetIds: [earlyM.id, lateM.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      [earlyM, lateM]
    );
    assert.equal(
      wsSymHedge.insights.hedge.available,
      true,
      "Consistent single-pool late legs sharing early anchor must enable hedge even when picks=[]"
    );
  });
});
