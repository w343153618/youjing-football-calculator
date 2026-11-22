import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  computeTruthReport,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  parseSportteryRawJson,
  parseSportteryResultsJson,
  settleTicketSnapshotWithOfficialResults,
} from "../server/quantEngine.mjs";
import { createLedgerManager } from "../server/ledgerManager.mjs";
import * as cabinViewModels from "../src/mobile/cabins/cabinViewModels.ts";
import type {
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
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

describe("Spec #10 · Ticket #11: Sales Eligibility Split, Exact Set Equivalence & Partial-Coverage Single Gate", () => {
  it("Slice A: splits canSingle vs canAllUp across parsers & fallback, rejects single-only pools from parlays, and computes dynamic single-open badges", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");

    // 1. FALLBACK_MATCHES exposes explicit boolean canSingle & canAllUp
    for (const fm of FALLBACK_MATCHES as MatchItem[]) {
      for (const code of ["HAD", "HHAD", "HAFU", "TTG", "CRS"] as PoolCode[]) {
        const pool = fm.pools[code];
        assert.equal(
          typeof pool.canSingle,
          "boolean",
          `Missing canSingle on ${fm.id}:${code}`
        );
        assert.equal(
          typeof pool.canAllUp,
          "boolean",
          `Missing canAllUp on ${fm.id}:${code}`
        );
        assert.equal(pool.selling, Boolean(pool.canSingle || pool.canAllUp));
        assert.equal(pool.single, pool.canSingle);
      }
    }

    // 2. parseSportteryRawJson distinguishes all-up-only, single-only, dual-open, and closed pools
    const customRaw = JSON.parse(JSON.stringify(LIVE_SG_THREE_MATCH_RAW));
    // Make 周日001 TTG single-only (bettingSingle=1, bettingAllup=0) and CRS suspended
    customRaw.value.matchInfoList[0].subMatchList[0].poolList = [
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
        poolCode: "TTG",
        bettingAllup: 0,
        bettingSingle: 1,
        single: 0,
        cbtValue: 1,
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
        poolStatus: "Suspended",
      },
    ];
    const parsed = parseSportteryRawJson(customRaw) as MatchItem[];
    const [m1, m2, m3] = parsed;

    // m1: HAD/HHAD allUp-only; TTG single-only; HAFU dual-open; CRS suspended
    assert.deepEqual(
      {
        canSingle: m1.pools.HAD.canSingle,
        canAllUp: m1.pools.HAD.canAllUp,
        selling: m1.pools.HAD.selling,
      },
      { canSingle: false, canAllUp: true, selling: true }
    );
    assert.deepEqual(
      {
        canSingle: m1.pools.TTG.canSingle,
        canAllUp: m1.pools.TTG.canAllUp,
        selling: m1.pools.TTG.selling,
      },
      { canSingle: true, canAllUp: false, selling: true }
    );
    assert.deepEqual(
      {
        canSingle: m1.pools.HAFU.canSingle,
        canAllUp: m1.pools.HAFU.canAllUp,
        selling: m1.pools.HAFU.selling,
      },
      { canSingle: true, canAllUp: true, selling: true }
    );
    assert.deepEqual(
      {
        canSingle: m1.pools.CRS.canSingle,
        canAllUp: m1.pools.CRS.canAllUp,
        selling: m1.pools.CRS.selling,
      },
      { canSingle: false, canAllUp: false, selling: false }
    );
    // m3 (特温特 -3): HAD has empty options -> canSingle=false, canAllUp=false, selling=false
    assert.deepEqual(
      {
        canSingle: m3.pools.HAD.canSingle,
        canAllUp: m3.pools.HAD.canAllUp,
        selling: m3.pools.HAD.selling,
      },
      { canSingle: false, canAllUp: false, selling: false }
    );

    // 3. Single-only pool (m1.TTG: canSingle=true, canAllUp=false) allows 1串1 single but REJECTS 2串1+ parlays
    const singleOnlyPick = makePick(m1, "TTG", "s2");
    const repSingleOnly1M = computeTruthReport([singleOnlyPick], 5, [m1, m2]);
    assert.equal(repSingleOnly1M.canSingle, true);
    assert.equal(repSingleOnly1M.canCheckout, true);
    assert.equal(repSingleOnly1M.modeLabel, "单关");

    const partnerHadPick = makePick(m2, "HAD", "h"); // canSingle=false, canAllUp=true
    const repParlayBlocked = computeTruthReport(
      [singleOnlyPick, partnerHadPick],
      5,
      [m1, m2]
    );
    assert.equal(
      repParlayBlocked.canCheckout,
      false,
      "Single-only pool (canAllUp=false) MUST be rejected from 2串1 parlay"
    );
    const pass2Meta = repParlayBlocked.availableFreePasses.find(
      (f) => f.size === 2
    );
    assert.equal(pass2Meta?.enabled, false);

    // BetSlipController also rejects toggling 2关 when a single-only pool is in the slip
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      [m1, m2],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, [m1, m2])
    );
    ctrl.togglePick(m1, "TTG", "s2");
    ctrl.togglePick(m2, "HAFU", "hh"); // m2 HAFU is dual-open (canSingle=true, canAllUp=true)
    // Default 2-match auto parlay is blocked because m1.TTG has canAllUp=false, while explicit 单关 (passSizes=[1]) works!
    assert.equal(ctrl.getState().workspace.manualReport.canCheckout, false);
    assert.equal(ctrl.toggleFreePassSize(2).ok, false);
    assert.equal(ctrl.toggleFreePassSize(1).ok, true);
    assert.equal(ctrl.getState().workspace.manualReport.canCheckout, true);
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, "单关");

    // Pareto portfolio never puts a canAllUp=false leg into any k>=2 parlay line
    const pareto2M = generateParetoPortfolio([m1, m2], 20, "objective", false, [
      singleOnlyPick,
      partnerHadPick,
    ]);
    for (const plan of pareto2M) {
      for (const ln of plan.lines) {
        if (ln.legs.length >= 2) {
          for (const lg of ln.legs) {
            const srcMatch = [m1, m2].find((x) => x.id === lg.matchId)!;
            assert.equal(
              srcMatch.pools[lg.poolCode].canAllUp,
              true,
              `Parlay line ${ln.id} in ${plan.key} included single-only pool ${lg.matchId}:${lg.poolCode}`
            );
          }
        }
        if (ln.legs.length === 1) {
          const lg = ln.legs[0];
          const srcMatch = [m1, m2].find((x) => x.id === lg.matchId)!;
          assert.equal(srcMatch.pools[lg.poolCode].canSingle, true);
        }
      }
    }

    // Authoritative ledger snapshot sealer also rejects forged 2串1 containing single-only pool
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-sgl-only-"));
    try {
      const lm = createLedgerManager({ dataDir: tmpDir });
      assert.throws(
        () =>
          lm.mutateUserLedger(
            "u-sgl-1",
            {
              action: "add-entry",
              kind: "live",
              title: "伪造串关",
              cost: 2,
              snapshot: {
                matches: [],
                lines: [
                  {
                    id: "L1",
                    modeLabel: "2串1",
                    multiple: 1,
                    legs: [
                      {
                        matchId: m1.id,
                        poolCode: "TTG",
                        optionKey: "s2",
                        odds: m1.pools.TTG.options[2].odds,
                      },
                      {
                        matchId: m2.id,
                        poolCode: "HAD",
                        optionKey: "h",
                        odds: m2.pools.HAD.options[0].odds,
                      },
                    ],
                  },
                ],
              },
            },
            { authoritativeMatches: [m1, m2], strictValidate: true }
          ),
        /仅限单关/
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 4. Dynamic Match Radar Single Badge via pure view-model helper
    const buildBadge = (cabinViewModels as Record<string, any>)
      .buildMatchRadarSingleBadge;
    assert.equal(
      typeof buildBadge,
      "function",
      "Expected buildMatchRadarSingleBadge in cabinViewModels.ts"
    );

    const liveStandard = parseSportteryRawJson(
      LIVE_SG_THREE_MATCH_RAW
    ) as MatchItem[];
    const badgeStandard = buildBadge(liveStandard[0]); // TTG, HAFU, CRS all canSingle=true; HAD & HHAD canSingle=false
    assert.equal(badgeStandard.isMainSingle, false);
    assert.ok(
      badgeStandard.text.includes("总进球") &&
        badgeStandard.text.includes("半全场") &&
        badgeStandard.text.includes("比分"),
      `Expected dynamic badge to include 总进球, 半全场, 比分; got: ${badgeStandard.text}`
    );

    const badgeNoCrs = buildBadge(m1); // TTG & HAFU canSingle=true, CRS suspended
    assert.equal(badgeNoCrs.isMainSingle, false);
    assert.ok(
      badgeNoCrs.text.includes("总进球") && badgeNoCrs.text.includes("半全场")
    );
    assert.equal(badgeNoCrs.text.includes("比分"), false);

    const badgeHadSingle = buildBadge(
      (FALLBACK_MATCHES as MatchItem[]).find((x) => x.pools.HAD.single)!
    );
    assert.equal(badgeHadSingle.isMainSingle, true);
    assert.equal(badgeHadSingle.text, "单");
  });

  it("Slice B: enforces exact bidirectional set equivalence (blindSpotProb, overCoverProb, retainedDirectionRatio), excludes straddling catch-all CRS buckets, and abolishes 0球+2球 / coarse direction substitutes", () => {
    const [m1, , m3] = parseSportteryRawJson(
      LIVE_SG_THREE_MATCH_RAW
    ) as MatchItem[];

    // 1. 周日001 金泉尚武 HAD:d (平) at ¥10: NEVER substitutes TTG 0球+2球; uses exact 3-way HAFU ["dd","hd","ad"]
    const drawPick001 = makePick(m1, "HAD", "d");
    const repDraw001 = computeTruthReport([drawPick001], 5, [m1]) as any;
    assert.equal(repDraw001.isExactSyntheticEquivalent, true);
    assert.equal(repDraw001.syntheticBlindSpotProb, 0);
    assert.equal(repDraw001.syntheticOverCoverProb, 0);
    assert.equal(repDraw001.syntheticRetainedDirectionRatio, 1);
    assert.deepEqual(
      repDraw001.syntheticRescuePicks?.map(
        (p: SelectedPick) => `${p.poolCode}:${p.optionKey}`
      ),
      ["HAFU:dd", "HAFU:hd", "HAFU:ad"]
    );

    const drawPlans001 = generateParetoPortfolio([m1], 10, "objective", false, [
      drawPick001,
    ]);
    for (const p of drawPlans001.slice(0, 3)) {
      for (const ln of p.lines) {
        for (const lg of ln.legs) {
          assert.notEqual(
            lg.poolCode,
            "TTG",
            `Draw anchor on 周日001 MUST NEVER substitute TTG ${lg.optionKey} (${lg.optionLabel}) in ${p.key}`
          );
          assert.equal(
            lg.poolCode === "HAFU" && ["dd", "hd", "ad"].includes(lg.optionKey),
            true,
            `Expected pure draw HAFU leg in ${p.key}, got ${lg.poolCode}:${lg.optionKey}`
          );
        }
      }
    }

    // 2. 周日003 特温特 HHAD(-3):hh (-3 让胜, x - y >= 4): 胜其它 (@4.25) has >50% mass on >=4 wins,
    //    yet contains 4:3, 5:3, 5:4, 6:3 (diff <= 3) -> MUST be excluded from pure subset!
    const twenteHhPick = makePick(m3, "HHAD", "hh");
    const repTwenteHh = computeTruthReport([twenteHhPick], 5, [m3]) as any;
    const hhLabels =
      repTwenteHh.syntheticRescuePicks?.map(
        (p: SelectedPick) => p.optionLabel
      ) ?? [];
    assert.deepEqual(
      hhLabels,
      ["4:0", "5:0", "5:1"],
      `HHAD(-3) 让胜 pure CRS subset must be exact 3 explicit >=4-goal scores excluding 胜其它, got: ${hhLabels.join(",")}`
    );
    assert.equal(repTwenteHh.isExactSyntheticEquivalent, false);
    assert.equal(repTwenteHh.syntheticOverCoverProb, 0);
    const explicit4PlusProb = ["4:0", "5:0", "5:1"].reduce(
      (s, lbl) =>
        s + (m3.pools.CRS.options.find((o) => o.label === lbl)?.fairProb ?? 0),
      0
    );
    const expectedHhMiss = twenteHhPick.fairProb - explicit4PlusProb;
    assert.ok(
      expectedHhMiss > 0.01,
      `Expected significant >=4-goal mass inside 胜其它, got ${expectedHhMiss}`
    );
    assert.ok(
      Math.abs(repTwenteHh.syntheticBlindSpotProb - expectedHhMiss) < 1e-6
    );
    assert.ok(
      Math.abs(
        repTwenteHh.syntheticRetainedDirectionRatio -
          explicit4PlusProb / twenteHhPick.fairProb
      ) < 1e-6
    );
    assert.equal(
      (repTwenteHh.syntheticHint ?? "").includes("无死角") ||
        (repTwenteHh.syntheticHint ?? "").includes("100% 等价") ||
        (repTwenteHh.syntheticHint ?? "").includes("0% 漏网死角"),
      false,
      `Non-equivalent bundle must NEVER claim 无死角 / 100% 等价: ${repTwenteHh.syntheticHint}`
    );

    // 3. 周日003 特温特 HHAD(-3):ha (-3 让负, x - y <= 2):
    //    Includes 平其它 & 负其它 (100% diff <= 0 <= 2) + 6 home 1..2-goal wins (1:0,2:0,2:1,3:1,3:2,4:2),
    //    EXCLUDES 胜其它 (contains 6:0 with diff=6 > 2), total = 24 CRS options; NEVER maps to away HAFU!
    const twenteHaPick = makePick(m3, "HHAD", "ha");
    const repTwenteHa = computeTruthReport([twenteHaPick], 5, [m3]) as any;
    const haLabels =
      repTwenteHa.syntheticRescuePicks?.map(
        (p: SelectedPick) => p.optionLabel
      ) ?? [];
    assert.equal(haLabels.length, 24);
    assert.equal(haLabels.includes("胜其它"), false);
    assert.equal(haLabels.includes("平其它"), true);
    assert.equal(haLabels.includes("负其它"), true);
    assert.equal(repTwenteHa.isExactSyntheticEquivalent, false);
    assert.equal(repTwenteHa.syntheticOverCoverProb, 0);
    assert.ok(repTwenteHa.syntheticBlindSpotProb > 1e-6);
    assert.ok(
      repTwenteHa.syntheticRetainedDirectionRatio > 0.85 &&
        repTwenteHa.syntheticRetainedDirectionRatio < 1,
      `Expected high but <1 retainedDirectionRatio on -3 让负, got ${repTwenteHa.syntheticRetainedDirectionRatio}`
    );

    // 4. 周日003 特温特 HHAD(-3):hd (-3 让平, x - y === 3): pure CRS subset is ["3:0","4:1","5:2"] (excludes 6:3 inside 胜其它),
    //    and generateParetoPortfolio NEVER maps -3 让平 to home HAFU ["hh","dh","dd"]!
    const twenteHdPick = makePick(m3, "HHAD", "hd");
    const repTwenteHd = computeTruthReport([twenteHdPick], 5, [m3]) as any;
    assert.deepEqual(
      repTwenteHd.syntheticRescuePicks?.map((p: SelectedPick) => p.optionLabel),
      ["3:0", "4:1", "5:2"]
    );
    assert.equal(repTwenteHd.isExactSyntheticEquivalent, false);
    assert.equal(repTwenteHd.syntheticOverCoverProb, 0);

    for (const deepPick of [twenteHaPick, twenteHdPick]) {
      const deepPlans = generateParetoPortfolio([m3], 10, "objective", false, [
        deepPick,
      ]);
      for (const p of deepPlans) {
        for (const ln of p.lines) {
          for (const lg of ln.legs) {
            assert.notEqual(
              lg.poolCode,
              "HAFU",
              `Deep handicap ${deepPick.optionLabel} on 周日003 MUST NEVER map to coarse HAFU ${lg.optionKey} in ${p.key}`
            );
          }
        }
      }
    }
  });

  it("Slice C: auto-mounts default synthetic single ONLY when exact-equivalent & within authorized cap, blocks silent ¥90 / non-equivalent mounts with partialCoveragePreview + bridgeCandidates, and unlocks on explicit partial-cover opt-in", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const liveMatches = parseSportteryRawJson(
      LIVE_SG_THREE_MATCH_RAW
    ) as MatchItem[];
    const [m1, m2, m3] = liveMatches;

    // 1. Ordinary HAD exact-equivalent within authorized cap (<= max(12, 1*2*5) = ¥12) auto-mounts seamlessly!
    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      liveMatches,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, liveMatches)
    );
    ctrl.togglePick(m1, "HAD", "h");
    await ctrl.flush();

    const stExact = ctrl.getState();
    assert.equal(stExact.syntheticSingleMode, "full-3way");
    assert.equal(stExact.workspace.effectiveReport.canCheckout, true);
    assert.equal(stExact.workspace.effectiveReport.syntheticAutoMounted, true);
    assert.equal(stExact.workspace.effectiveReport.syntheticBlindSpotProb, 0);
    assert.ok(
      stExact.workspace.effectiveReport.totalCost <= 12,
      `Exact 3-way HAFU at 5x must auto-mount within ¥12 cap, got ¥${stExact.workspace.effectiveReport.totalCost}`
    );
    assert.equal(
      stExact.workspace.effectiveReport.partialCoveragePreview ?? null,
      null
    );
    const slipExact = ctrl.formatShopkeeperWeChatSlip();
    assert.ok(
      slipExact.includes("胜胜") &&
        slipExact.includes("平胜") &&
        slipExact.includes("负胜")
    );
    const draftExact = ctrl.buildSealedLedgerDraft()!;
    assert.ok(draftExact);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-t11-slicec-"));
    try {
      const lm = createLedgerManager({ dataDir: tmpDir });
      const addExact = lm.mutateUserLedger(
        "u-t11-exact",
        { action: "add-entry", kind: "live", ...draftExact },
        { authoritativeMatches: liveMatches, trustedServerSnapshot: true }
      );
      assert.equal(addExact.ok, true);
      const comebackRes = parseSportteryResultsJson({
        errorCode: "0",
        value: {
          matchResult: [
            {
              matchId: m1.id,
              matchNumStr: m1.matchNumStr,
              homeTeam: m1.home,
              awayTeam: m1.away,
              matchResultStatus: "2",
              poolStatus: "Payout",
              sectionsNo1: "0:1",
              sectionsNo999: "2:1",
            },
          ],
        },
      });
      const settled = settleTicketSnapshotWithOfficialResults(
        addExact.ledger.entries[0].snapshot,
        comebackRes,
        { stakeCost: addExact.ledger.entries[0].cost }
      );
      assert.equal(settled.status, "won");

      // 2. 周日003 特温特 HHAD(-3):ha (-3 让负) at multiple=5 (¥10):
      //    NEVER silently auto-mounts ¥90 24-bet partial CRS in default "full-3way"!
      ctrl.clearPicks();
      ctrl.setBudget(10);
      ctrl.togglePick(m3, "HHAD", "ha");
      await ctrl.flush();

      const stPending = ctrl.getState();
      const effPending = stPending.workspace.effectiveReport;
      assert.equal(
        effPending.canCheckout,
        false,
        "Default unconfirmed mode MUST NOT auto-mount non-equivalent / ¥90 CRS!"
      );
      assert.equal(Boolean(effPending.syntheticAutoMounted), false);
      assert.equal(effPending.totalCost, 0);
      assert.equal(ctrl.formatShopkeeperWeChatSlip(), "");

      const preview = effPending.partialCoveragePreview!;
      assert.ok(
        preview,
        "Must expose partialCoveragePreview on unconfirmed non-equivalent single"
      );
      assert.equal(preview.poolCode, "CRS");
      assert.equal(preview.isExactEquivalent, false);
      assert.equal(preview.requiresExplicitConfirm, true);
      assert.equal(preview.overCoverProb, 0);
      assert.equal(preview.previewLines.length, 24);
      assert.ok(
        preview.previewCost >= 48,
        `24-bet CRS balanced previewCost must be >= ¥48 (e.g. ¥90), got ¥${preview.previewCost}`
      );
      assert.ok(
        preview.retainedDirectionRatio > 0.85 &&
          preview.retainedDirectionRatio < 1
      );
      assert.ok(preview.blindSpotProb > 1e-6);
      assert.ok(
        Math.abs(
          preview.retainedDirectionRatio + preview.withinDirectionMissRatio - 1
        ) < 1e-6
      );
      assert.ok(
        preview.blindSpotLabel?.includes("胜其它") &&
          preview.blindSpotLabel?.includes("4:3"),
        `Expected blindSpotLabel mentioning 胜其它 & 4:3, got ${preview.blindSpotLabel}`
      );
      assert.ok(
        stPending.workspace.insights.bridgeCandidates.length >= 1,
        "Unconfirmed single must immediately expose bridgeCandidates for 2串1"
      );
      const gatesPending = ctrl.getPlayabilityGates();
      assert.equal(gatesPending.isSyntheticPlayable, true);
      assert.equal(gatesPending.showBridgeFinder, true);
      assert.ok(gatesPending.partialCoveragePreview?.requiresExplicitConfirm);

      // Single-match Pareto Slot ① & ② ALSO refuse silent non-equivalent substitution unless confirmed
      for (const slotKey of ["max-profit-prob", "max-ev-utility"] as const) {
        const slotPlan = stPending.workspace.portfolioPlans.find(
          (p) => p.key === slotKey
        )!;
        assert.equal(
          slotPlan.available,
          false,
          `Pareto ${slotKey} on non-equivalent single 周日003 -3 让负 must stay available=false before explicit confirmation`
        );
        assert.ok((slotPlan as any).partialCoveragePreview);
      }

      // 3. Explicit opt-in via setSyntheticSingleMode("partial-cover") mounts the 24-bet CRS plan with synthetic-blind-spot warning!
      ctrl.setSyntheticSingleMode("partial-cover" as any);
      await ctrl.flush();

      const stConfirmed = ctrl.getState();
      const effConfirmed = stConfirmed.workspace.effectiveReport;
      assert.equal(stConfirmed.syntheticSingleMode, "partial-cover");
      assert.equal(effConfirmed.canCheckout, true);
      assert.equal(effConfirmed.syntheticAutoMounted, true);
      assert.equal(effConfirmed.syntheticModeUsed, "partial-cover");
      assert.equal(effConfirmed.totalCost, preview.previewCost);
      assert.equal(effConfirmed.tickets?.length, 24);
      assert.ok(
        effConfirmed.warnings.some((w) => w.id === "synthetic-blind-spot")
      );
      assert.equal(
        (effConfirmed.syntheticHint ?? "").includes("无死角") ||
          (effConfirmed.syntheticHint ?? "").includes("100% 等价") ||
          (effConfirmed.syntheticHint ?? "").includes("0% 漏网死角"),
        false
      );

      // Sealing explicitly confirmed partial-cover ticket into authoritative ledger works cleanly
      const draftPartial = ctrl.buildSealedLedgerDraft()!;
      assert.ok(draftPartial);
      const addPartial = lm.mutateUserLedger(
        "u-t11-partial",
        { action: "add-entry", kind: "paper", ...draftPartial },
        { authoritativeMatches: liveMatches, trustedServerSnapshot: true }
      );
      assert.equal(addPartial.ok, true);
      assert.equal(addPartial.ledger.entries[0].snapshot.lines.length, 24);

      // Switching/adding match resets partial-cover authorization so it never leaks across matches!
      ctrl.togglePick(m2, "HAD", "a");
      await ctrl.flush();
      assert.equal(ctrl.getState().syntheticSingleMode, "full-3way");
      assert.equal(ctrl.getState().workspace.effectiveReport.modeLabel, "2串1");
      assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 10);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 4. Exact-equivalent yet over authorized budget cap (HAD:h when HAFU is closed -> 13-bet CRS = ¥26+ > ¥12 cap):
    //    Stays pending in default "full-3way" with confirmReason="over-budget-cap", mounts cleanly on "partial-cover"!
    const crsOnlyExactMatch: MatchItem = {
      ...m1,
      id: "t11-crs-only-exact",
      pools: {
        ...m1.pools,
        HAD: {
          ...m1.pools.HAD,
          canSingle: false,
          single: false,
          canAllUp: true,
          selling: true,
        },
        HAFU: {
          ...m1.pools.HAFU,
          canSingle: false,
          single: false,
          canAllUp: true,
          selling: true,
        },
        CRS: {
          ...m1.pools.CRS,
          canSingle: true,
          single: true,
          canAllUp: true,
          selling: true,
        },
      },
    };
    const overCapPick: SelectedPick = {
      matchId: crsOnlyExactMatch.id,
      matchNumStr: crsOnlyExactMatch.matchNumStr,
      home: crsOnlyExactMatch.home,
      away: crsOnlyExactMatch.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: false,
      canSingle: false,
      canAllUp: true,
      optionKey: "h",
      optionLabel: "主胜",
      odds: crsOnlyExactMatch.pools.HAD.options[0].odds,
      fairProb: crsOnlyExactMatch.pools.HAD.options[0].fairProb,
    };
    const wsOverCapDefault = evaluateQuantWorkspace(
      { picks: [overCapPick], multiple: 5, syntheticSingleMode: "full-3way" },
      [crsOnlyExactMatch, m2]
    );
    assert.equal(wsOverCapDefault.effectiveReport.canCheckout, false);
    assert.equal(
      Boolean(wsOverCapDefault.effectiveReport.syntheticAutoMounted),
      false
    );
    assert.equal(
      wsOverCapDefault.effectiveReport.partialCoveragePreview
        ?.isExactEquivalent,
      true
    );
    assert.equal(
      wsOverCapDefault.effectiveReport.partialCoveragePreview?.confirmReason,
      "over-budget-cap"
    );
    assert.ok(
      (wsOverCapDefault.effectiveReport.partialCoveragePreview?.previewCost ??
        0) >= 26
    );

    const wsOverCapConfirmed = evaluateQuantWorkspace(
      {
        picks: [overCapPick],
        multiple: 5,
        syntheticSingleMode: "partial-cover" as any,
      },
      [crsOnlyExactMatch, m2]
    );
    assert.equal(wsOverCapConfirmed.effectiveReport.canCheckout, true);
    assert.equal(wsOverCapConfirmed.effectiveReport.syntheticAutoMounted, true);
    assert.equal(wsOverCapConfirmed.effectiveReport.syntheticBlindSpotProb, 0);
    assert.equal(wsOverCapConfirmed.effectiveReport.tickets?.length, 13);

    // 5. buildSyntheticModePillSpecs 4th optional arg renders explicit partial-cover confirmation pill while keeping 3-arg legacy contract intact
    const legacy3Arg = cabinViewModels.buildSyntheticModePillSpecs(
      true,
      false,
      false
    );
    assert.deepEqual(
      legacy3Arg.map((p) => p.label),
      ["🛡️ 3项全包无死角", "⚡ 2项省本搏常规", "🌉 搭1场过桥凑2串1"]
    );
    const partialPills = (cabinViewModels.buildSyntheticModePillSpecs as any)(
      true,
      true,
      false,
      {
        poolCode: "CRS",
        poolName: "比分",
        isExactEquivalent: false,
        requiresExplicitConfirm: true,
        confirmReason: "partial-and-over-cap",
        authorizedCostCap: 12,
        retainedDirectionRatio: 0.962,
        withinDirectionMissRatio: 0.038,
        blindSpotProb: 0.0152,
        overCoverProb: 0,
        blindSpotLabel: "体彩「胜其它」跨界混杂项内原目标比分（如 4:3、5:3）",
        syntheticEffectiveOdds: 1.48,
        previewCost: 90,
        previewBetCount: 45,
        previewTicketCount: 24,
        previewMinPayout: 92,
        previewMaxPayout: 150,
        previewLines: [],
      }
    );
    assert.equal(partialPills[0].mode, "partial-cover");
    assert.ok(
      partialPills[0].label.includes("96.2%") &&
        partialPills[0].label.includes("¥90"),
      `Expected partial-cover pill to display retained % and ¥90 previewCost, got: ${partialPills[0].label}`
    );
    assert.equal(partialPills[0].label.includes("无死角"), false);
  });
});
