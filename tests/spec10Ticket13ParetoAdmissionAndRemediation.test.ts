import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import * as cabinViewModels from "../src/mobile/cabins/cabinViewModels.ts";
import type {
  ArchetypePlan,
  MatchItem,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";

/**
 * Frozen real Sporttery V1 snapshot slice (周日001 金泉尚武, 周日002 光州FC, 周日003 特温特 -3)
 * capturing live poolList flags (bettingAllup / bettingSingle / single:0 / cbtValue:2) and HAD:{} closed main pool.
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
              updateDate: "2026-11-20",
              updateTime: "09:58:45",
            },
            hhad: {
              goalLine: "-1",
              h: "5.65",
              d: "3.95",
              a: "1.41",
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
    singleAllowed: pool.single,
    canSingle: pool.canSingle,
    canAllUp: pool.canAllUp,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

describe("Spec #10 · Ticket #13: 3+1 Pareto Same-Direction Sub-Pass Competition, OOS Admission Red-Lines & Solver-Verified Remediation", () => {
  it("Slice A (AC 1 & AC 2): abolishes CRS/TTG/HAFU 2nd-leg auto-expansion, prevents silent passCap tail truncation, and competes same-direction 2串1/单关 full-match partitions when pass order is unlocked (36.12% vs 18.90% on live-sg-snapshot)", () => {
    const live3 = parseSportteryRawJson(LIVE_SG_THREE_MATCH_RAW) as MatchItem[];
    assert.equal(live3.length, 3);
    const [m001, m002, m003] = live3;

    // 1. Sub-pool single-pick anchors (CRS 1:1, TTG 2球, HAFU 平平) MUST NEVER auto-append a 2nd leg (0:0, 3球, 胜平)
    const sub3Anchors: SelectedPick[] = [
      makePick(m001, "CRS", "1:1"),
      makePick(m002, "TTG", "s2"),
      makePick(m003, "HAFU", "dd"),
    ];
    const allowedSub3Keys = new Set([
      `${m001.id}:CRS:1:1`,
      `${m002.id}:TTG:s2`,
      `${m003.id}:HAFU:dd`,
    ]);
    for (const opts of [
      undefined,
      { passSpec: { mode: "free" as const, passSizes: [3] } },
    ]) {
      const plansSub3 = generateParetoPortfolio(
        live3,
        10,
        "objective",
        false,
        sub3Anchors,
        opts
      ) as ArchetypePlan[];
      for (const plan of plansSub3.slice(0, 3)) {
        for (const ln of plan.lines) {
          for (const lg of ln.legs) {
            const sig = `${lg.matchId}:${lg.poolCode}:${lg.poolCode === "CRS" ? lg.optionLabel || lg.optionKey : lg.optionKey}`;
            assert.equal(
              allowedSub3Keys.has(sig),
              true,
              `Slot ${plan.key} silently appended unchosen sub-pool leg ${sig}`
            );
          }
        }
      }
    }

    // 2. Zero silent passCap tail truncation: 5 matches where match 1 is anchored on CRS (POOL_MAX_PASS = 4)
    const fiveSlate: MatchItem[] = [
      m001,
      m002,
      ...(FALLBACK_MATCHES.slice(0, 3) as MatchItem[]),
    ];
    const fiveWithCrsAnchors: SelectedPick[] = [
      makePick(fiveSlate[0], "CRS", "1:1"),
      makePick(fiveSlate[1], "HAD", "h"),
      makePick(fiveSlate[2], "HAD", "h"),
      makePick(fiveSlate[3], "HAD", "a"),
      makePick(fiveSlate[4], "HAD", "h"),
    ];

    // (2a) When explicit passSpec locks 5串1 (> passCap 4), mark Slot ① & Slot ② available:false with statutory pass-limit gap reason!
    const locked5Plans = generateParetoPortfolio(
      fiveSlate,
      50,
      "objective",
      false,
      fiveWithCrsAnchors,
      { passSpec: { mode: "free", passSizes: [5] } }
    ) as ArchetypePlan[];
    for (const p of [locked5Plans[0], locked5Plans[1]]) {
      assert.equal(
        p.available,
        false,
        `Locked 5串1 exceeding CRS 4-pass statutory limit must mark ${p.key} available:false`
      );
      assert.ok(
        p.emptyReason &&
          (p.emptyReason.includes("4") || p.emptyReason.includes("上限")),
        `Expected statutory pass-limit gap reason on ${p.key}, got: ${p.emptyReason}`
      );
    }

    // (2b) When pass order is unlocked (auto), partition into <= 4-leg blocks covering 100% of ALL 5 selected matches (never dropping match #5!)
    const auto5Plans = generateParetoPortfolio(
      fiveSlate,
      50,
      "objective",
      false,
      fiveWithCrsAnchors
    ) as ArchetypePlan[];
    for (const p of [auto5Plans[0], auto5Plans[1], auto5Plans[2]]) {
      if (!p.available) continue;
      assert.equal(
        p.lines.every((l) => l.legs.length <= 4),
        true,
        `${p.key} must respect <= 4 passCap on every line`
      );
      const coveredMids = new Set(
        p.lines.flatMap((l) => l.legs.map((g) => g.matchId))
      );
      assert.equal(
        coveredMids.size,
        5,
        `${p.key} must cover 100% of all 5 selected matches without tail truncation (got ${coveredMids.size}/5)`
      );
    }

    // 3. Anchored same-direction sub-pass competition on live-sg-snapshot (001 主胜 + 002 主胜 + 003 -3 让负 @ ¥10):
    //    Slot ① achieves >= 36.12% via 同向 2串1 分块 (instead of 18.90% 3串1) with 0 underwater, full 3-match coverage, and permutation invariance!
    const main3Anchors: SelectedPick[] = [
      makePick(m001, "HAD", "h"),
      makePick(m002, "HAD", "h"),
      makePick(m003, "HHAD", "ha"),
    ];
    const main3AutoPlans = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      main3Anchors
    ) as ArchetypePlan[];
    const s1Main3 = main3AutoPlans[0];
    assert.equal(s1Main3.available, true);
    assert.equal(s1Main3.totalCost, 10);
    assert.equal(s1Main3.underwaterCount, 0);
    assert.ok(
      (s1Main3.strictNetGainProb ?? 0) >= 0.3612,
      `Expected Slot ① strictNetGainProb >= 36.12% via 同向 2串1 分块, got ${((s1Main3.strictNetGainProb ?? 0) * 100).toFixed(2)}%`
    );
    assert.equal(
      s1Main3.lines.every((l) => l.legs.length === 2),
      true,
      "Expected all lines in winning Slot ① candidate to be 2串1 pairs"
    );
    const coveredMain3 = new Set(
      s1Main3.lines.flatMap((l) => l.legs.map((g) => g.matchId))
    );
    assert.equal(coveredMain3.size, 3, "Must cover all 3 anchored matches");
    const s1Text = `${s1Main3.badge} ${s1Main3.title} ${s1Main3.tagline}`;
    assert.ok(
      s1Text.includes("2串1"),
      `Expected prominent 2串1 structure badge/copy on Slot ①, got: ${s1Text}`
    );

    // Slot ② also competes same-direction 2串1 blocks against 3串1 when pass is unlocked
    const s2Main3 = main3AutoPlans[1];
    assert.equal(s2Main3.available, true);
    assert.equal(s2Main3.underwaterCount, 0);
    assert.ok(
      (s2Main3.strictNetGainProb ?? 0) > 0.25 &&
        s2Main3.expectedValueRate > -0.26,
      `Expected Slot ② to beat 3串1 (-32.8% EV / 11.6% net gain) via 2串1 block competition, got strict=${s2Main3.strictNetGainProb}, ev=${s2Main3.expectedValueRate}`
    );

    // Match & anchor permutation invariance across all 6 permutations of live3
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const normPlan = (pl: ArchetypePlan) => ({
      key: pl.key,
      available: pl.available,
      totalCost: pl.totalCost,
      strict: Number((pl.strictNetGainProb ?? 0).toFixed(10)),
      ev: Number((pl.expectedValueRate ?? 0).toFixed(10)),
      lines: pl.lines
        .map(
          (l) =>
            `${l.multiple}:${l.legs
              .map((g) => `${g.matchId}.${g.poolCode}.${g.optionKey}`)
              .sort()
              .join("+")}`
        )
        .sort(),
    });
    const refNorm = main3AutoPlans.map(normPlan);
    for (const perm of perms.slice(1)) {
      const pMatches = perm.map((i) => live3[i]);
      const pAnchors = [...perm].reverse().map((i) => main3Anchors[i]);
      const pOut = (
        generateParetoPortfolio(
          pMatches,
          10,
          "objective",
          false,
          pAnchors
        ) as ArchetypePlan[]
      ).map(normPlan);
      assert.deepEqual(
        pOut,
        refNorm,
        `Anchored Pareto 3+1 must be permutation-invariant under ${JSON.stringify(perm)}`
      );
    }

    // Verify evaluateQuantWorkspace forwards explicit passSpec=[3] so locked 3串1 does NOT silently auto-downgrade primary slot to 2串1
    const wsLocked3 = evaluateQuantWorkspace(
      {
        picks: main3Anchors,
        multiple: 1,
        passSpec: { mode: "free", passSizes: [3] },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: live3.map((m) => m.id),
        anchorToRadarPicks: true,
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      live3
    );
    const lockedS1 = wsLocked3.portfolioPlans[0];
    if (lockedS1.available) {
      assert.equal(
        lockedS1.lines.every((l: any) => l.legs.length === 3),
        true,
        "Explicitly locked 3串1 must NOT silently replace primary Slot ① with 2串1"
      );
    }
  });

  it("Slice B (AC 3): enforces OOS admission red-lines across all 4 slots, surfaces prominent wipeout badge (<0.1% 2-decimal precision), wires allowSaveCash toggle, removes M=1 miss-1 copy + M=8 high-wipeout 6串1 hijack, and caps narrow-budget alpha-radar light stake", async () => {
    const live3 = parseSportteryRawJson(LIVE_SG_THREE_MATCH_RAW) as MatchItem[];
    const [m001, m002, m003] = live3;

    // 1. Frozen 6-item sub-pool replay at ¥10: Slot ① (0.32%), Slot ② (0.19%) & Slot ③ (95.79% wipeout) ALL honestly reject!
    const sub6Anchors: SelectedPick[] = [
      makePick(m001, "CRS", "1:1"),
      makePick(m001, "CRS", "0:0"),
      makePick(m002, "TTG", "s2"),
      makePick(m002, "TTG", "s3"),
      makePick(m003, "HAFU", "dd"),
      makePick(m003, "HAFU", "hd"),
    ];
    const sub6Plans = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      sub6Anchors
    ) as ArchetypePlan[];
    assert.equal(
      sub6Plans[0].available,
      false,
      "Slot ① (0.32% strict net gain, 99.68% wipeout, 56.4% vig) MUST reject on 6 sub-pool anchors @ ¥10"
    );
    assert.equal(
      sub6Plans[1].available,
      false,
      "Slot ② (0.19% strict net gain, -62.9% EV) MUST reject on 6 sub-pool anchors @ ¥10"
    );
    assert.equal(
      sub6Plans[2].available,
      false,
      "Slot ③ (95.79% > 90% wipeout) MUST reject on 6 sub-pool anchors @ ¥10"
    );
    assert.equal(sub6Plans[3].available, false);
    for (const p of sub6Plans) {
      assert.equal(p.totalCost, 0);
      assert.equal(p.savedCash, 10);
      assert.equal(p.lines.length, 0);
    }

    // 2. Slot ① keeps title/tab 稳健保本, prominently surfaces 整单归零率 XX.X% & 覆盖范围内不倒贴, and formats <0.1% non-zero probs to 2 decimals
    const main3Anchors: SelectedPick[] = [
      makePick(m001, "HAD", "h"),
      makePick(m002, "HAD", "h"),
      makePick(m003, "HHAD", "ha"),
    ];
    const main3Plans = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      main3Anchors
    ) as ArchetypePlan[];
    const s1Avail = main3Plans[0];
    assert.equal(s1Avail.available, true);
    assert.equal(s1Avail.shortTab, "🛡️ 稳健保本");
    assert.equal(
      cabinViewModels.buildPortfolioSlotOptions(main3Plans)[0][1],
      "稳健保本"
    );
    assert.ok(
      s1Avail.tagline.includes("整单归零率") &&
        s1Avail.tagline.includes("覆盖范围内不倒贴"),
      `Slot ① tagline must prominently surface 整单归零率 & 覆盖范围内不倒贴, got: ${s1Avail.tagline}`
    );
    assert.ok(
      s1Avail.reasons.some((r) => r.includes("整单归零率")),
      `Slot ① reasons must surface 整单归零率, got: ${JSON.stringify(s1Avail.reasons)}`
    );
    const kpiMain3 = cabinViewModels.buildPortfolioKpiTiles(s1Avail);
    assert.ok(
      kpiMain3.tile1.subtitle.includes("整单归零率") &&
        kpiMain3.tile1.subtitle.includes("覆盖范围内不倒贴"),
      `KPI tile1 subtitle must surface 整单归零率 & 覆盖范围内不倒贴, got: ${kpiMain3.tile1.subtitle}`
    );

    // Small non-zero probability (< 0.1%) formatted to 2 decimals (e.g. 0.04% instead of 0.0%)
    const tinyProbKpi = cabinViewModels.buildPortfolioKpiTiles({
      ...s1Avail,
      strictNetGainProb: 0.000438,
      objectiveStrictNetGainProb: 0.000438,
      profitProb: 0.000438,
      objectiveProfitProb: 0.000438,
      winProb: 0.999562,
      zeroPayoutProb: 0.000438,
    });
    assert.equal(
      tinyProbKpi.tile1.value,
      "0.04%",
      `Expected <0.1% strictNetGainProb 0.000438 to format as 0.04%, got ${tinyProbKpi.tile1.value}`
    );
    assert.ok(
      tinyProbKpi.tile1.subtitle.includes("整单归零率 0.04%"),
      `Expected <0.1% zeroPayoutProb 0.000438 to format as 0.04%, got ${tinyProbKpi.tile1.subtitle}`
    );

    // 3. Slot ② allowSaveCash toggle (default false = full budget; true = log-wealth utility with savedCash + 实投/留存 disclosure)
    const s2Default = generateParetoPortfolio(
      live3,
      100,
      "objective",
      false,
      main3Anchors
    )[1] as ArchetypePlan;
    assert.equal(s2Default.available, true);
    assert.equal(s2Default.totalCost, 100);
    assert.equal(s2Default.savedCash, 0);

    const s2SaveCash = generateParetoPortfolio(
      live3,
      100,
      "objective",
      false,
      main3Anchors,
      { allowSaveCash: true }
    )[1] as ArchetypePlan;
    assert.equal(s2SaveCash.available, true);
    assert.ok(
      s2SaveCash.totalCost > 0 && s2SaveCash.totalCost < 100,
      `Expected allowSaveCash=true on negative-EV slate at ¥100 to save cash (totalCost < 100), got ¥${s2SaveCash.totalCost}`
    );
    assert.equal(s2SaveCash.totalCost + s2SaveCash.savedCash, 100);
    const s2SaveCopy = `${s2SaveCash.tagline} ${s2SaveCash.reasons.join(" ")}`;
    assert.ok(
      s2SaveCopy.includes(`实投 ¥${s2SaveCash.totalCost}`) &&
        s2SaveCopy.includes(`留存 ¥${s2SaveCash.savedCash}`),
      `Expected allowSaveCash copy to disclose 实投 ¥X · 留存 ¥Y, got: ${s2SaveCopy}`
    );

    // End-to-end BetSlipController.setAllowSaveCash wiring
    const betCtrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    const initBundle = {
      matches: live3,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: live3.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        live3
      ),
    };
    betCtrl.applyAuthenticatedBundle(initBundle);
    betCtrl.togglePick(m001, "HAD", "h");
    betCtrl.togglePick(m002, "HAD", "h");
    betCtrl.togglePick(m003, "HHAD", "ha");
    assert.equal(betCtrl.getState().workspace.portfolioPlans[1].totalCost, 100);
    betCtrl.setAllowSaveCash(true);
    assert.equal(betCtrl.getState().allowSaveCash, true);
    assert.ok(
      betCtrl.getState().workspace.portfolioPlans[1].savedCash > 0,
      "Expected BetSlipController.setAllowSaveCash(true) to activate cash-saving Slot ②"
    );

    // 4. Slot ③ M=1 single-match NEVER outputs cross-match 错一场 / 错1场 / 黑掉1场 copy;
    //    M=8 normal @2.10 slate selects low-wipeout 2串1 blocks instead of 94.46% wipeout 6串1, while 8×@1.26 heavy favorites keep 4×6串1!
    for (const mSingle of [FALLBACK_MATCHES[1] as MatchItem, m001]) {
      const s3Single = generateParetoPortfolio(
        [mSingle],
        20,
        "objective",
        false,
        []
      )[2] as ArchetypePlan;
      assert.equal(s3Single.available, true);
      const kpiS3Single = cabinViewModels.buildPortfolioKpiTiles(s3Single);
      const allSingleCopy = [
        s3Single.title,
        s3Single.tagline,
        ...s3Single.reasons,
        kpiS3Single.tile2.label,
        kpiS3Single.tile2.value,
        kpiS3Single.tile2.subtitle,
      ].join(" | ");
      for (const forbidden of ["错一场", "错1场", "错 1 场", "黑掉1场"]) {
        assert.equal(
          allSingleCopy.includes(forbidden),
          false,
          `Single-match Slot ③ MUST NOT contain cross-match "${forbidden}" copy: ${allSingleCopy}`
        );
      }
    }

    const eightNormal210: MatchItem[] = FALLBACK_MATCHES.slice(0, 8).map(
      (fm, idx) => ({
        ...(fm as MatchItem),
        id: `norm-8m-210-${idx}`,
        matchNumStr: `周日40${idx + 1}`,
        pools: {
          ...(fm as MatchItem).pools,
          HHAD: { ...(fm as MatchItem).pools.HHAD, selling: false },
          HAFU: { ...(fm as MatchItem).pools.HAFU, selling: false },
          TTG: { ...(fm as MatchItem).pools.TTG, selling: false },
          CRS: { ...(fm as MatchItem).pools.CRS, selling: false },
          HAD: {
            ...(fm as MatchItem).pools.HAD,
            selling: true,
            single: false,
            canSingle: false,
            canAllUp: true,
            payoutRatio: 0.88,
            vig: 0.12,
            options: [
              {
                key: "h",
                label: "主胜",
                odds: 2.1,
                trend: 0,
                fairProb: 0.422,
                shinProb: 0.422,
              },
              {
                key: "d",
                label: "平",
                odds: 3.25,
                trend: 0,
                fairProb: 0.264,
                shinProb: 0.264,
              },
              {
                key: "a",
                label: "客胜",
                odds: 2.82,
                trend: 0,
                fairProb: 0.314,
                shinProb: 0.314,
              },
            ],
          },
        },
      })
    );
    for (const b of [8, 10]) {
      const s3Norm8 = generateParetoPortfolio(
        eightNormal210,
        b,
        "objective",
        false,
        []
      )[2] as ArchetypePlan;
      assert.equal(s3Norm8.available, true);
      assert.equal(
        s3Norm8.lines.some((l) => l.legs.length === 6),
        false,
        `Normal @2.10 8-match slate at ¥${b} MUST NOT pick 94.46% wipeout 6串1: ${s3Norm8.title}`
      );
      assert.equal(
        s3Norm8.lines.every((l) => l.legs.length === 2),
        true,
        `Expected normal @2.10 8-match slate at ¥${b} to pick 2串1 blocks, got ${s3Norm8.lines.map((l) => l.legs.length)}`
      );
      assert.ok((s3Norm8.zeroPayoutProb ?? 1) <= 0.85);
    }

    const eightHeavyFav136: MatchItem[] = FALLBACK_MATCHES.slice(0, 8).map(
      (fm, idx) => ({
        ...(fm as MatchItem),
        id: `fav-8m-136-${idx}`,
        matchNumStr: `周六30${idx + 1}`,
        pools: {
          ...(fm as MatchItem).pools,
          HHAD: { ...(fm as MatchItem).pools.HHAD, selling: false },
          HAFU: { ...(fm as MatchItem).pools.HAFU, selling: false },
          TTG: { ...(fm as MatchItem).pools.TTG, selling: false },
          CRS: { ...(fm as MatchItem).pools.CRS, selling: false },
          HAD: {
            ...(fm as MatchItem).pools.HAD,
            selling: true,
            single: false,
            canSingle: false,
            canAllUp: true,
            payoutRatio: 0.89,
            vig: 0.11,
            options: [
              {
                key: "h",
                label: "主胜",
                odds: 1.36,
                trend: 0,
                fairProb: 0.659,
                shinProb: 0.659,
              },
              {
                key: "d",
                label: "平",
                odds: 4.5,
                trend: 0,
                fairProb: 0.188,
                shinProb: 0.188,
              },
              {
                key: "a",
                label: "客胜",
                odds: 6.0,
                trend: 0,
                fairProb: 0.153,
                shinProb: 0.153,
              },
            ],
          },
        },
      })
    );
    const s3Fav8 = generateParetoPortfolio(
      eightHeavyFav136,
      8,
      "objective",
      false,
      []
    )[2] as ArchetypePlan;
    assert.equal(s3Fav8.available, true);
    assert.equal(
      s3Fav8.lines.every((l) => l.legs.length === 6),
      true,
      `8×@1.36 heavy-favorite slate (zeroPayoutProb <= 85%) must STILL select 4×6串1 独立分块容错串, got: ${s3Fav8.title}`
    );
    assert.ok(s3Fav8.title.includes("独立分块容错串"));

    // 5. Slot ④ narrow-budget alpha-radar light stake cap: floor((cleanBudget * 0.36) / 2) * 2 (¥10 -> ¥2, ¥4 -> ¥0 unless unlocked)
    const laggedAlphaMatch: MatchItem = {
      ...m001,
      id: "alpha-narrow-10",
      pools: {
        ...m001.pools,
        HAD: {
          ...m001.pools.HAD,
          updateDate: "2026-11-21",
          updateTime: "21:30:00",
        },
        HHAD: {
          ...m001.pools.HHAD,
          updateDate: "2026-11-21",
          updateTime: "21:30:00",
        },
        TTG: {
          ...m001.pools.TTG,
          single: true,
          canSingle: true,
          updateDate: "2026-11-21",
          updateTime: "18:00:00",
          options: m001.pools.TTG.options.map((o) =>
            o.key === "s2" ? { ...o, odds: 5.2 } : o
          ),
        },
      },
    };
    const s4At10Light = generateParetoPortfolio(
      [laggedAlphaMatch],
      10,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(s4At10Light.available, true);
    assert.equal(
      s4At10Light.totalCost,
      2,
      `¥10 * 36% = ¥3.60 -> must floor to ¥2 (NEVER ¥10/¥10!), got ¥${s4At10Light.totalCost}`
    );
    assert.equal(s4At10Light.savedCash, 8);

    const s4At10Full = generateParetoPortfolio(
      [laggedAlphaMatch],
      10,
      "objective",
      true,
      []
    )[3] as ArchetypePlan;
    assert.equal(s4At10Full.available, true);
    assert.equal(s4At10Full.totalCost, 10);

    const s4At4Light = generateParetoPortfolio(
      [laggedAlphaMatch],
      4,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(
      s4At4Light.available,
      false,
      "¥4 * 36% = ¥1.44 < ¥2 -> light-stake alpha-radar must stay empty ¥0 unless unlocked"
    );
    assert.equal(s4At4Light.totalCost, 0);
    assert.equal(s4At4Light.savedCash, 4);

    const s4At4Full = generateParetoPortfolio(
      [laggedAlphaMatch],
      4,
      "objective",
      true,
      []
    )[3] as ArchetypePlan;
    assert.equal(s4At4Full.available, true);
    assert.equal(s4At4Full.totalCost, 4);
  });

  it("Slice C (AC 4): attaches solver-verified remediationActions (lower-pass-preview ¥6 36.36% singles, min-feasible-budget ¥14 [3,2,2] with zero 真保本 wording, and upper-bound-blocked 0.395% / 11.64% ceilings omitting add-budget)", () => {
    const live3 = parseSportteryRawJson(LIVE_SG_THREE_MATCH_RAW) as MatchItem[];
    const [m001, m002, m003] = live3;

    // 1. lower-pass-preview:
    // (1a) Sub 3 (001 1:1 + 002 2球 + 003 平平) locked to 3串1 @ ¥10 -> verified 3 singles for ¥6 achieving ~36.36% strict net gain!
    const sub3Anchors: SelectedPick[] = [
      makePick(m001, "CRS", "1:1"),
      makePick(m002, "TTG", "s2"),
      makePick(m003, "HAFU", "dd"),
    ];
    const sub3LockedPlans = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      sub3Anchors,
      { passSpec: { mode: "free", passSizes: [3] } }
    ) as ArchetypePlan[];
    const s1Sub3Locked = sub3LockedPlans[0];
    assert.equal(s1Sub3Locked.available, false);
    const sub3LowerAct = s1Sub3Locked.remediationActions?.find(
      (a) => a.kind === "lower-pass-preview"
    );
    assert.ok(
      sub3LowerAct,
      `Expected solver-verified lower-pass-preview on locked 3串1 sub3Anchors, got: ${JSON.stringify(s1Sub3Locked.remediationActions)}`
    );
    assert.equal(sub3LowerAct.previewCost, 6);
    assert.ok(
      (sub3LowerAct.strictNetGainProb ?? 0) >= 0.3635 &&
        (sub3LowerAct.strictNetGainProb ?? 0) <= 0.364,
      `Expected 3-single lower-pass-preview strictNetGainProb ~36.36%, got ${sub3LowerAct.strictNetGainProb}`
    );
    assert.equal(sub3LowerAct.previewLines?.length, 3);
    assert.equal(
      sub3LowerAct.previewLines?.every(
        (l) => l.legs.length === 1 && l.cost === 2
      ),
      true
    );

    // (1b) Main 3 (001 主胜 + 002 主胜 + 003 -3 让负) locked to 3串1 @ ¥10 -> verified 同向 2串1 分块 for ¥10 achieving >= 36.12%!
    const main3Anchors: SelectedPick[] = [
      makePick(m001, "HAD", "h"),
      makePick(m002, "HAD", "h"),
      makePick(m003, "HHAD", "ha"),
    ];
    const main3LockedPlans = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      main3Anchors,
      { passSpec: { mode: "free", passSizes: [3] } }
    ) as ArchetypePlan[];
    const s1Main3Locked = main3LockedPlans[0];
    assert.equal(s1Main3Locked.available, false);
    const main3LowerAct = s1Main3Locked.remediationActions?.find(
      (a) => a.kind === "lower-pass-preview"
    );
    assert.ok(
      main3LowerAct,
      "Expected lower-pass-preview on locked 3串1 main3Anchors"
    );
    assert.equal(main3LowerAct.previewCost, 10);
    assert.ok(main3LowerAct.structureLabel?.includes("2串1"));
    assert.ok((main3LowerAct.strictNetGainProb ?? 0) >= 0.3612);

    // 2. min-feasible-budget:
    // 001 让负 × 002 胜平负全包 infeasible at <= ¥12, first solver-verified feasible budget is exact ¥14 ([3, 2, 2]) with ZERO "真保本" wording!
    const discreteAnchors: SelectedPick[] = [
      makePick(m001, "HHAD", "ha"),
      makePick(m002, "HAD", "h"),
      makePick(m002, "HAD", "d"),
      makePick(m002, "HAD", "a"),
    ];
    for (const narrowB of [8, 10, 12]) {
      const discretePlans = generateParetoPortfolio(
        [m001, m002],
        narrowB,
        "objective",
        false,
        discreteAnchors
      ) as ArchetypePlan[];
      const s1Disc = discretePlans[0];
      assert.equal(
        s1Disc.available,
        false,
        `001 让负 × 002 胜平负全包 must be infeasible at ¥${narrowB}`
      );
      const minBAct = s1Disc.remediationActions?.find(
        (a) => a.kind === "min-feasible-budget"
      );
      assert.ok(
        minBAct,
        `Expected solver-verified min-feasible-budget action at ¥${narrowB}, got: ${JSON.stringify(s1Disc.remediationActions)}`
      );
      assert.equal(
        minBAct.minFeasibleBudgetYuan,
        14,
        `Expected exact first feasible budget ¥14 ([3, 2, 2]), got ¥${minBAct.minFeasibleBudgetYuan}`
      );
      assert.equal(minBAct.previewCost, 14);
      assert.ok((minBAct.strictNetGainProb ?? 0) >= 0.63);
      assert.equal(minBAct.previewLines?.length, 3);
      assert.deepEqual(
        [...(minBAct.previewLines ?? []).map((l) => l.multiple)].sort(
          (a, b) => b - a
        ),
        [3, 2, 2]
      );
      const serializedDisc = JSON.stringify(s1Disc);
      assert.equal(
        serializedDisc.includes("真保本"),
        false,
        `Remediation copy MUST contain ZERO "真保本" wording: ${serializedDisc}`
      );
    }

    // End-to-end BetSlipController execution of min-feasible-budget & lower-pass-preview & switch-main-pool
    const betCtrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    betCtrl.applyAuthenticatedBundle({
      matches: live3,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 1,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [m001.id, m002.id],
          budget: 10,
          stance: "objective",
          unlockFullAgg: false,
        },
        live3
      ),
    });
    betCtrl.setBudget(10);
    betCtrl.togglePick(m001, "HHAD", "ha");
    betCtrl.togglePick(m002, "HAD", "h");
    betCtrl.togglePick(m002, "HAD", "d");
    betCtrl.togglePick(m002, "HAD", "a");
    assert.equal(
      betCtrl.getState().workspace.portfolioPlans[0].available,
      false
    );
    const liveMinBAct = betCtrl
      .getState()
      .workspace.portfolioPlans[0].remediationActions?.find(
        (a) => a.kind === "min-feasible-budget"
      )!;
    assert.ok(liveMinBAct);
    betCtrl.applyPortfolioRemediationAction(liveMinBAct);
    assert.equal(betCtrl.getState().budget, 14);
    assert.equal(
      betCtrl.getState().workspace.portfolioPlans[0].available,
      true
    );
    assert.equal(betCtrl.getState().workspace.portfolioPlans[0].totalCost, 14);

    // 3. upper-bound-blocked:
    // 6 sub-pool anchors locked to parlays: 3串1 ceiling ~0.395% (< 20%) & 2串1+ ceiling ~11.64% (< 20%)
    const sub6Anchors: SelectedPick[] = [
      makePick(m001, "CRS", "1:1"),
      makePick(m001, "CRS", "0:0"),
      makePick(m002, "TTG", "s2"),
      makePick(m002, "TTG", "s3"),
      makePick(m003, "HAFU", "dd"),
      makePick(m003, "HAFU", "hd"),
    ];

    const sub6Locked3 = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      sub6Anchors,
      { passSpec: { mode: "free", passSizes: [3] } }
    )[0] as ArchetypePlan;
    assert.equal(sub6Locked3.available, false);
    assert.equal(sub6Locked3.upperBoundBlocked, true);
    assert.ok(
      Math.abs((sub6Locked3.theoreticalStrictNetGainCeiling ?? 0) - 0.003947) <
        0.0005,
      `Expected 3串1 theoretical ceiling ~0.395%, got ${sub6Locked3.theoreticalStrictNetGainCeiling}`
    );
    assert.equal(
      sub6Locked3.remediationActions?.some(
        (a) => a.kind === "min-feasible-budget"
      ),
      false,
      "upperBoundBlocked MUST omit all add-budget actions!"
    );
    for (const reqKind of [
      "keep-cash",
      "go-manual",
      "switch-main-pool",
    ] as const) {
      assert.equal(
        sub6Locked3.remediationActions?.some((a) => a.kind === reqKind),
        true,
        `Expected ${reqKind} remediation action on upperBoundBlocked sub6Locked3`
      );
    }

    const sub6Locked2Plus = generateParetoPortfolio(
      live3,
      10,
      "objective",
      false,
      sub6Anchors,
      { passSpec: { mode: "free", passSizes: [2, 3] } }
    )[0] as ArchetypePlan;
    assert.equal(sub6Locked2Plus.available, false);
    assert.equal(sub6Locked2Plus.upperBoundBlocked, true);
    assert.ok(
      Math.abs(
        (sub6Locked2Plus.theoreticalStrictNetGainCeiling ?? 0) - 0.11638
      ) < 0.002,
      `Expected 2串1+ theoretical ceiling ~11.64%, got ${sub6Locked2Plus.theoreticalStrictNetGainCeiling}`
    );
    assert.equal(
      sub6Locked2Plus.remediationActions?.some(
        (a) => a.kind === "min-feasible-budget"
      ),
      false,
      "2串1+ ceiling 11.64% < 20% MUST omit all add-budget actions!"
    );
    for (const reqKind of [
      "keep-cash",
      "go-manual",
      "switch-main-pool",
    ] as const) {
      assert.equal(
        sub6Locked2Plus.remediationActions?.some((a) => a.kind === reqKind),
        true,
        `Expected ${reqKind} remediation action on upperBoundBlocked sub6Locked2Plus`
      );
    }

    // Verify lower-pass-preview & switch-main-pool actions in BetSlipController
    betCtrl.clearPicks();
    betCtrl.setBudget(10);
    for (const pk of main3Anchors) {
      betCtrl.togglePick(
        live3.find((m) => m.id === pk.matchId)!,
        pk.poolCode,
        pk.optionKey
      );
    }
    betCtrl.toggleFreePassSize(2);
    betCtrl.toggleFreePassSize(2);
    assert.deepEqual(betCtrl.getState().passSpec.passSizes, [3]);
    assert.equal(
      betCtrl.getState().workspace.portfolioPlans[0].available,
      false
    );
    const liveLowerPassAct = betCtrl
      .getState()
      .workspace.portfolioPlans[0].remediationActions?.find(
        (a) => a.kind === "lower-pass-preview"
      )!;
    assert.ok(liveLowerPassAct);
    betCtrl.applyPortfolioRemediationAction(liveLowerPassAct);
    assert.equal(
      betCtrl.getState().workspace.portfolioPlans[0].available,
      true
    );
    assert.ok(
      (betCtrl.getState().workspace.portfolioPlans[0].strictNetGainProb ?? 0) >=
        0.3612
    );

    betCtrl.clearPicks();
    for (const pk of sub6Anchors) {
      betCtrl.togglePick(
        live3.find((m) => m.id === pk.matchId)!,
        pk.poolCode,
        pk.optionKey
      );
    }
    betCtrl.toggleFreePassSize(2);
    betCtrl.toggleFreePassSize(2);
    const switchAct = betCtrl
      .getState()
      .workspace.portfolioPlans[0].remediationActions?.find(
        (a) => a.kind === "switch-main-pool"
      )!;
    assert.ok(switchAct);
    betCtrl.applyPortfolioRemediationAction(switchAct);
    assert.equal(
      betCtrl
        .getState()
        .picks.every((p) => p.poolCode === "HAD" || p.poolCode === "HHAD"),
      true
    );
    assert.equal(
      betCtrl.getState().workspace.portfolioPlans[0].available,
      true
    );
  });
});
