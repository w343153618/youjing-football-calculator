import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  analyzeMatchMicroQuant,
  computeProOrderInsights,
  computeTruthReport,
  fetchOfficialMatchesServer,
  parseSportteryRawJson,
} from '../server/quantEngine.mjs';
import type { MatchItem, OddsOption, PoolCode, SelectedPick } from '../src/prototype/quantTypes.ts';

function makeExactCrsOptions(probByLabel: Record<string, number>): OddsOption[] {
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

describe('Spec 0007 Ticket 01: Live Sporttery Purity, CRS One-Goal Card-Pan & Strict Staggered Hedge', () => {
  it('Slice A: strips hardcoded fallback aiAlert when live matchNumStr collides (e.g. 周二002) and reports accurate 8-match fallback syncNote', async () => {
    const livePayload = {
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: 2059902,
                matchNumStr: '周二002',
                leagueAbbName: '欧冠',
                matchTime: '03:00:00',
                homeTeamAbbName: '阿森纳',
                awayTeamAbbName: '巴黎圣日耳曼',
                poolList: [
                  { poolCode: 'HAD', single: 1, cbtValue: 1 },
                  { poolCode: 'HHAD', single: 1, cbtValue: 1 },
                  { poolCode: 'CRS', single: 1, cbtValue: 1 },
                  { poolCode: 'TTG', single: 1, cbtValue: 1 },
                  { poolCode: 'HAFU', single: 1, cbtValue: 1 },
                ],
                had: { h: '1.92', d: '3.35', a: '3.40' },
                hhad: { goalLine: '-1', h: '3.65', d: '3.45', a: '1.76' },
                crs: { s01s00: '6.50', s02s01: '7.50', s00s00: '9.50', s01s01: '6.20', s00s01: '9.00' },
                ttg: { s0: '9.5', s1: '4.3', s2: '3.2', s3: '3.6', s4: '6.2', s5: '12', s6: '24', s7: '32' },
                hafu: { hh: '3.0', hd: '14', ha: '32', dh: '4.6', dd: '5.0', da: '7.8', ah: '26', ad: '14', aa: '5.8' },
              },
            ],
          },
        ],
      },
    };

    const parsed = parseSportteryRawJson(livePayload);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].matchNumStr, '周二002');
    assert.equal(parsed[0].aiAlert, undefined);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('simulated offline');
    }) as typeof fetch;
    try {
      const missingSnapshot = path.join(os.tmpdir(), `yj-missing-snap-${Date.now()}-${Math.random()}.json`);
      const res = await fetchOfficialMatchesServer(missingSnapshot);
      assert.equal(res.source, 'fallback');
      assert.equal(FALLBACK_MATCHES.length, 8);
      assert.equal(res.matches.length, 8);
      assert.ok(
        res.syncNote.includes(`${FALLBACK_MATCHES.length} 场`),
        `Expected syncNote to report "${FALLBACK_MATCHES.length} 场", got "${res.syncNote}"`
      );
      assert.equal(res.syncNote.includes('4 场'), false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('Slice B: computes exact CRS 1-goal share on non-±1 lines (-2/+2) or suspended HHAD, preserves ±1 HHAD ratio, and unifies 50% amber badge threshold', () => {
    const base = FALLBACK_MATCHES[0] as MatchItem;

    // 1. goalLine = -1 selling HHAD with 51% share -> keeps HHAD.hd ratio AND triggers amber badge at >= 50%
    const minusOne51: MatchItem = {
      ...base,
      id: 'b-minus1-51',
      home: '阿森纳',
      away: '富勒姆',
      pools: {
        ...base.pools,
        HAD: {
          ...base.pools.HAD,
          selling: true,
          options: [
            { key: 'h', label: '主胜', odds: 1.76, trend: 0, fairProb: 0.5 },
            { key: 'd', label: '平', odds: 3.52, trend: 0, fairProb: 0.25 },
            { key: 'a', label: '客胜', odds: 3.52, trend: 0, fairProb: 0.25 },
          ],
        },
        HHAD: {
          ...base.pools.HHAD,
          selling: true,
          goalLine: '-1',
          options: [
            { key: 'hh', label: '让胜', odds: 3.74, trend: 0, fairProb: 0.235 },
            { key: 'hd', label: '让平', odds: 3.45, trend: 0, fairProb: 0.255 },
            { key: 'ha', label: '让负', odds: 1.73, trend: 0, fairProb: 0.51 },
          ],
        },
      },
    };
    const mq51 = analyzeMatchMicroQuant(minusOne51);
    assert.ok(Math.abs(mq51.oneGoalProb - 0.255) < 1e-9);
    assert.ok(Math.abs(mq51.oneGoalShareOfWins - 0.51) < 1e-9);
    assert.equal(mq51.microBadges[1].tone, 'amber');
    assert.equal(mq51.microBadges[1].text, '防赢1球卡盘 51%');

    // 2. goalLine = -2 deep home favorite -> uses CRS (0.20 / 0.80 = 0.25), NOT HHAD(-2).hd (0.44 / 0.80 = 0.55)
    const homeMinusTwo: MatchItem = {
      ...base,
      id: 'b-home-minus2',
      home: '拜仁',
      away: '波鸿',
      pools: {
        ...base.pools,
        HAD: {
          ...base.pools.HAD,
          selling: true,
          options: [
            { key: 'h', label: '主胜', odds: 1.1, trend: 0, fairProb: 0.8 },
            { key: 'd', label: '平', odds: 7.3, trend: 0, fairProb: 0.12 },
            { key: 'a', label: '客胜', odds: 11.0, trend: 0, fairProb: 0.08 },
          ],
        },
        HHAD: {
          ...base.pools.HHAD,
          selling: true,
          goalLine: '-2',
          options: [
            { key: 'hh', label: '让胜', odds: 2.4, trend: 0, fairProb: 0.36 },
            { key: 'hd', label: '让平', odds: 2.0, trend: 0, fairProb: 0.44 },
            { key: 'ha', label: '让负', odds: 4.4, trend: 0, fairProb: 0.2 },
          ],
        },
        CRS: {
          ...base.pools.CRS,
          selling: true,
          options: makeExactCrsOptions({
            '1:0': 0.1,
            '2:1': 0.08,
            '3:2': 0.02,
            '2:0': 0.22,
            '3:0': 0.18,
            '3:1': 0.1,
            '4:0': 0.02,
            '4:1': 0.02,
            '4:2': 0.01,
            '5:0': 0.01,
            '5:1': 0.01,
            '5:2': 0.01,
            '胜其它': 0.02,
            '0:0': 0.04,
            '1:1': 0.05,
            '2:2': 0.02,
            '3:3': 0.005,
            '平其它': 0.005,
            '0:1': 0.03,
            '1:2': 0.02,
            '0:2': 0.01,
            '2:3': 0.004,
            '0:3': 0.002,
            '1:3': 0.002,
            '0:4': 0.002,
            '1:4': 0.002,
            '2:4': 0.002,
            '0:5': 0.002,
            '1:5': 0.001,
            '2:5': 0.001,
            '负其它': 0.002,
          }),
        },
      },
    };
    const mqMinusTwo = analyzeMatchMicroQuant(homeMinusTwo);
    assert.ok(Math.abs(mqMinusTwo.oneGoalShareOfWins - 0.25) < 1e-9);
    assert.ok(Math.abs(mqMinusTwo.oneGoalProb - 0.2) < 1e-9);
    assert.equal(mqMinusTwo.microBadges[1].tone, 'emerald');
    assert.equal(mqMinusTwo.microBadges[1].text, '穿盘率 75%');

    // 3. goalLine = +2 away favorite & suspended HHAD & suspended CRS zero-div safety
    const awayCrsOptions = makeExactCrsOptions({
      '0:1': 0.24,
      '1:2': 0.15,
      '2:3': 0.06,
      '0:2': 0.12,
      '0:3': 0.06,
      '1:3': 0.04,
      '0:4': 0.02,
      '1:4': 0.01,
      '2:4': 0.01,
      '0:5': 0.01,
      '1:5': 0.01,
      '2:5': 0.005,
      '负其它': 0.015,
      '0:0': 0.06,
      '1:1': 0.06,
      '2:2': 0.02,
      '3:3': 0.005,
      '平其它': 0.005,
      '1:0': 0.04,
      '2:1': 0.03,
      '2:0': 0.01,
      '3:2': 0.004,
      '3:0': 0.002,
      '3:1': 0.002,
      '4:0': 0.002,
      '4:1': 0.002,
      '4:2': 0.002,
      '5:0': 0.002,
      '5:1': 0.001,
      '5:2': 0.001,
      '胜其它': 0.002,
    });
    const awayPlusTwo: MatchItem = {
      ...base,
      id: 'b-away-plus2',
      home: '弱旅',
      away: '皇马',
      pools: {
        ...base.pools,
        HAD: {
          ...base.pools.HAD,
          selling: true,
          options: [
            { key: 'h', label: '主胜', odds: 8.8, trend: 0, fairProb: 0.1 },
            { key: 'd', label: '平', odds: 5.87, trend: 0, fairProb: 0.15 },
            { key: 'a', label: '客胜', odds: 1.17, trend: 0, fairProb: 0.75 },
          ],
        },
        HHAD: {
          ...base.pools.HHAD,
          selling: true,
          goalLine: '+2',
          options: [
            { key: 'hh', label: '让胜', odds: 2.2, trend: 0, fairProb: 0.4 },
            { key: 'hd', label: '让平', odds: 4.4, trend: 0, fairProb: 0.2 },
            { key: 'ha', label: '让负', odds: 2.2, trend: 0, fairProb: 0.4 },
          ],
        },
        CRS: {
          ...base.pools.CRS,
          selling: true,
          options: awayCrsOptions,
        },
      },
    };
    const mqPlusTwo = analyzeMatchMicroQuant(awayPlusTwo);
    assert.ok(Math.abs(mqPlusTwo.oneGoalShareOfWins - 0.6) < 1e-9);
    assert.ok(Math.abs(mqPlusTwo.oneGoalProb - 0.45) < 1e-9);
    assert.equal(mqPlusTwo.microBadges[1].tone, 'amber');
    assert.equal(mqPlusTwo.microBadges[1].text, '防赢1球卡盘 60%');

    const hhadSuspended: MatchItem = {
      ...awayPlusTwo,
      id: 'b-hhad-suspended',
      pools: {
        ...awayPlusTwo.pools,
        HHAD: { ...awayPlusTwo.pools.HHAD, selling: false, goalLine: '-1', options: [] },
      },
    };
    const mqHhadSusp = analyzeMatchMicroQuant(hhadSuspended);
    assert.ok(Math.abs(mqHhadSusp.oneGoalShareOfWins - 0.6) < 1e-9);
    assert.ok(Math.abs(mqHhadSusp.oneGoalProb - 0.45) < 1e-9);

    const bothSuspended: MatchItem = {
      ...hhadSuspended,
      id: 'b-both-suspended',
      pools: {
        ...hhadSuspended.pools,
        CRS: { ...hhadSuspended.pools.CRS, selling: false, options: [] },
      },
    };
    const mqBothSusp = analyzeMatchMicroQuant(bothSuspended);
    assert.equal(Number.isFinite(mqBothSusp.oneGoalShareOfWins), true);
    assert.equal(Number.isFinite(mqBothSusp.oneGoalProb), true);
    assert.ok(mqBothSusp.oneGoalShareOfWins > 0 && mqBothSusp.oneGoalShareOfWins <= 0.85);
  });

  it('Slice C: enforces checkout/parlay gate, penultimate-to-last >=110m gap (with YYYYMMDD ordering), and 100% complementary HAD/HHAD opposite resolution', () => {
    const pickOf = (m: MatchItem, poolCode: PoolCode, optionKey: string): SelectedPick => {
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
      id: 'c-early-2000',
      matchNumStr: '周二001',
      kickoff: '20:00',
    };
    const baseMidLate = {
      ...(FALLBACK_MATCHES[2] as MatchItem),
      id: 'c-mid-0330',
      matchNumStr: '周二004',
      kickoff: '03:30',
    };
    const baseLate = {
      ...(FALLBACK_MATCHES[3] as MatchItem),
      id: 'c-late-0345',
      matchNumStr: '周二007',
      kickoff: '03:45',
      pools: {
        ...(FALLBACK_MATCHES[3] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: 'h', label: '主胜', odds: 1.96, trend: 0, fairProb: 0.45 },
            { key: 'd', label: '平', odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: 'a', label: '客胜', odds: 3.6, trend: 0, fairProb: 0.29 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HHAD,
          single: true,
          selling: true,
          goalLine: '-1',
          name: '让球(-1)',
          options: [
            { key: 'hh', label: '让胜', odds: 3.6, trend: 0, fairProb: 0.24 },
            { key: 'hd', label: '让平', odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: 'ha', label: '让负', odds: 1.92, trend: 0, fairProb: 0.5 },
          ],
        },
      },
    };

    // 1. Pure single pass (passSizes: [1]) and blocked checkout (> ¥20,000) MUST NOT offer staggered hedge
    const twoSinglePicks = [pickOf(baseEarly, 'HAD', 'h'), pickOf(baseLate, 'HAD', 'h')];
    const repPureSingle = computeTruthReport(twoSinglePicks, 5, [baseEarly, baseLate], {
      mode: 'free',
      passSizes: [1],
    });
    const insPureSingle = computeProOrderInsights(twoSinglePicks, repPureSingle, [baseEarly, baseLate]);
    assert.equal(insPureSingle.hedge.available, false);
    assert.ok(insPureSingle.hedge.reason.includes('单关'));

    const repBlockedOver20k = { ...computeTruthReport(twoSinglePicks, 5, [baseEarly, baseLate]), canCheckout: false };
    const insBlocked = computeProOrderInsights(twoSinglePicks, repBlockedOver20k, [baseEarly, baseLate]);
    assert.equal(insBlocked.hedge.available, false);

    // 2. 3-match parlay 20:00 + 03:30 + 03:45 -> penultimate (03:30) to late (03:45) is only 15 mins (< 110) -> FALSE!
    const threeDualLatePicks = [
      pickOf(baseEarly, 'HAD', 'h'),
      pickOf(baseMidLate, 'HAD', 'h'),
      pickOf(baseLate, 'HAD', 'h'),
    ];
    const repDualLate = computeTruthReport(threeDualLatePicks, 5, [baseEarly, baseMidLate, baseLate]);
    const insDualLate = computeProOrderInsights(threeDualLatePicks, repDualLate, [
      baseEarly,
      baseMidLate,
      baseLate,
    ]);
    assert.equal(insDualLate.hedge.available, false);
    assert.equal(insDualLate.hedge.gapMinutes, 15);
    assert.ok(insDualLate.hedge.reason.includes('前序') || insDualLate.hedge.reason.includes('完场'));

    // Whereas 19:30 + 20:00 + 03:45 -> penultimate (20:00) to late (03:45) is 465 mins (>= 110) -> TRUE!
    const baseEarly1930 = { ...baseEarly, id: 'c-early-1930', matchNumStr: '周二000', kickoff: '19:30' };
    const threeValidPicks = [
      pickOf(baseEarly1930, 'HAD', 'h'),
      pickOf(baseEarly, 'HAD', 'h'),
      pickOf(baseLate, 'HAD', 'h'),
    ];
    const repThreeValid = computeTruthReport(threeValidPicks, 5, [baseEarly1930, baseEarly, baseLate]);
    const insThreeValid = computeProOrderInsights(threeValidPicks, repThreeValid, [
      baseEarly1930,
      baseEarly,
      baseLate,
    ]);
    assert.equal(insThreeValid.hedge.available, true);
    assert.equal(insThreeValid.hedge.gapMinutes, 465);

    // YYYYMMDD cross-date ordering: 20261117-005 (03:45) followed by 20261119-001 (01:00) -> 20261119-001 is late!
    const d1Match = FALLBACK_MATCHES[2] as MatchItem; // 20261117-005 (03:45)
    const d2Match = FALLBACK_MATCHES[4] as MatchItem; // 20261119-001 (01:00)
    const crossDatePicks = [pickOf(d2Match, 'HAD', 'h'), pickOf(d1Match, 'HAD', 'h')];
    const repCrossDate = computeTruthReport(crossDatePicks, 5, [d1Match, d2Match]);
    const insCrossDate = computeProOrderInsights(crossDatePicks, repCrossDate, [d1Match, d2Match]);
    assert.equal(insCrossDate.hedge.available, true);
    assert.equal(insCrossDate.hedge.lateKickoff, '01:00');
    assert.ok(insCrossDate.hedge.lateMatchTitle.includes('周四001'));

    // 3. Complementary opposite bet resolution across all HAD / HHAD / non-complementary cases:
    // (a) HAD h: HHAD(-1) ha @1.92 > HAD[d 3.4 + a 3.6] (@1.7486) -> picks 1.92
    const repHadH = computeTruthReport(twoSinglePicks, 10, [baseEarly, baseLate]);
    const insHadH = computeProOrderInsights(twoSinglePicks, repHadH, [baseEarly, baseLate]);
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
            { key: 'h', label: '主胜', odds: 3.8, trend: 0, fairProb: 0.23 },
            { key: 'd', label: '平', odds: 4.2, trend: 0, fairProb: 0.21 },
            { key: 'a', label: '客胜', odds: 1.68, trend: 0, fairProb: 0.56 },
          ],
        },
        HHAD: {
          ...baseLate.pools.HHAD,
          goalLine: '+1',
          name: '让球(+1)',
          options: [
            { key: 'hh', label: '让胜', odds: 1.82, trend: 0, fairProb: 0.48 },
            { key: 'hd', label: '让平', odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: 'ha', label: '让负', odds: 3.4, trend: 0, fairProb: 0.26 },
          ],
        },
      },
    };
    const picksHadA = [pickOf(baseEarly, 'HAD', 'h'), pickOf(latePlusOne, 'HAD', 'a')];
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
            { key: 'h', label: '主胜', odds: 2.2, trend: 0, fairProb: 0.4 },
            { key: 'd', label: '平', odds: 3.2, trend: 0, fairProb: 0.28 },
            { key: 'a', label: '客胜', odds: 2.8, trend: 0, fairProb: 0.32 },
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
            { key: 'h', label: '主胜', odds: 2.4, trend: 0, fairProb: 0.37 },
            { key: 'd', label: '平', odds: 3.1, trend: 0, fairProb: 0.29 },
            { key: 'a', label: '客胜', odds: 2.7, trend: 0, fairProb: 0.34 },
          ],
        },
      },
    };
    const picksHadD = [pickOf(early220, 'HAD', 'h'), pickOf(lateDraw, 'HAD', 'd')];
    const insHadD = computeProOrderInsights(
      picksHadD,
      computeTruthReport(picksHadD, 10, [early220, lateDraw]),
      [early220, lateDraw]
    );
    assert.equal(insHadD.hedge.available, true);
    const expectedHA = 1 / (1 / 2.4 + 1 / 2.7); // 6.48 / 5.10
    assert.ok(Math.abs(insHadD.hedge.oppositeOdds - expectedHA) < 1e-9);
    assert.equal(insHadD.hedge.hedgeCost, 108);
    assert.equal(insHadD.hedge.lockedNetProfit, 8.4);

    // (d) HAD double pick [h, d] -> uses remaining 3rd option HAD a (@3.60)
    const picksHadDouble = [
      pickOf(baseEarly, 'HAD', 'h'),
      pickOf(baseLate, 'HAD', 'h'),
      pickOf(baseLate, 'HAD', 'd'),
    ];
    const insHadDouble = computeProOrderInsights(
      picksHadDouble,
      computeTruthReport(picksHadDouble, 10, [baseEarly, baseLate]),
      [baseEarly, baseLate]
    );
    assert.equal(insHadDouble.hedge.available, true);
    assert.equal(insHadDouble.hedge.oppositeOdds, 3.6);

    // (e) HHAD(-1) ha single pick -> compares HAD h (@1.96) vs HHAD[hh 3.6 + hd 3.4] (@1.7486) -> picks 1.96
    const picksHhadMinus1Ha = [pickOf(baseEarly, 'HAD', 'h'), pickOf(baseLate, 'HHAD', 'ha')];
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
          goalLine: '-2',
          name: '让球(-2)',
          options: [
            { key: 'hh', label: '让胜', odds: 2.5, trend: 0, fairProb: 0.35 },
            { key: 'hd', label: '让平', odds: 3.6, trend: 0, fairProb: 0.25 },
            { key: 'ha', label: '让负', odds: 2.4, trend: 0, fairProb: 0.4 },
          ],
        },
      },
    };
    const picksHhadMinus2Hh = [pickOf(baseEarly, 'HAD', 'h'), pickOf(lateMinusTwo, 'HHAD', 'hh')];
    const insHhadMinus2Hh = computeProOrderInsights(
      picksHhadMinus2Hh,
      computeTruthReport(picksHhadMinus2Hh, 10, [baseEarly, lateMinusTwo]),
      [baseEarly, lateMinusTwo]
    );
    assert.equal(insHhadMinus2Hh.hedge.available, true);
    assert.ok(Math.abs(insHhadMinus2Hh.hedge.oppositeOdds - 1 / (1 / 3.6 + 1 / 2.4)) < 1e-9); // 1.44

    const picksHhadDouble = [
      pickOf(baseEarly, 'HAD', 'h'),
      pickOf(lateMinusTwo, 'HHAD', 'hh'),
      pickOf(lateMinusTwo, 'HHAD', 'hd'),
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
      ['TTG', 's2'],
      ['CRS', '1:0'],
      ['HAFU', 'hh'],
    ] as const) {
      const nonCompPicks = [pickOf(baseEarly, 'HAD', 'h'), pickOf(baseLate, poolCode, key)];
      const insNonComp = computeProOrderInsights(
        nonCompPicks,
        computeTruthReport(nonCompPicks, 10, [baseEarly, baseLate]),
        [baseEarly, baseLate]
      );
      assert.equal(insNonComp.hedge.available, false, `Expected ${poolCode} on late match to reject hedge`);
      assert.ok(insNonComp.hedge.reason.length >= 10);
    }
  });
});
