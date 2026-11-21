import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  parseSportteryResultsJson,
  settleTicketSnapshotWithOfficialResults,
} from "../server/quantEngine.mjs";
import { createLedgerManager } from "../server/ledgerManager.mjs";
import { createAccountManager } from "../server/accountManager.mjs";
import { createManualQaEngine } from "../server/manualQaEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeSportteryCutoffStatus,
  createBetSlipController,
  filterAndGroupRadarMatches,
} from "../src/workspace/betSlipController.ts";
import type { MatchItem } from "../src/prototype/quantTypes.ts";

describe("Spec 0013 · Dual-Track Ledger Auto-Settlement & Sporttery Workflow Polish", () => {
  it("Slice 01 · Seam 1: parses official Sporttery results and settles 5-pool print-time snapshots, partial recovery, void cap step-down, early elimination, and live early-hit hedge", () => {
    const rawSportteryResultPayload = {
      errorCode: "0",
      value: {
        matchResult: [
          {
            matchId: 2042881,
            matchNumStr: "周五003",
            homeTeam: "鹿岛鹿角",
            awayTeam: "清水鼓动",
            matchDate: "2026-11-20",
            goalLine: "-1",
            h: "1.20",
            d: "3.90",
            a: "7.80",
            matchResultStatus: "2",
            poolStatus: "Payout",
            sectionsNo1: "0:0",
            sectionsNo999: "1:1",
          },
          {
            matchId: 2042882,
            matchNumStr: "周五004",
            homeTeam: "拜仁",
            awayTeam: "波鸿",
            matchDate: "2026-11-20",
            goalLine: "-2",
            matchResultStatus: "2",
            poolStatus: "Payout",
            sectionsNo1: "2:0",
            sectionsNo999: "6:1",
          },
          {
            matchId: 2042883,
            matchNumStr: "周五005",
            homeTeam: "尤文",
            awayTeam: "都灵",
            matchDate: "2026-11-20",
            goalLine: "-1",
            matchResultStatus: "2",
            poolStatus: "Payout",
            sectionsNo1: "0:0",
            sectionsNo999: "0:1",
          },
          {
            matchId: 2042884,
            matchNumStr: "周五006",
            homeTeam: "延期主队",
            awayTeam: "延期客队",
            matchDate: "2026-11-20",
            goalLine: "-1",
            matchResultStatus: "3",
            poolStatus: "Refund",
            sectionsNo1: "无效场次",
            sectionsNo999: "无效场次",
          },
          {
            matchId: 2042886,
            matchNumStr: "周五008",
            homeTeam: "毕尔巴鄂",
            awayTeam: "西班牙人",
            matchDate: "2026-11-21",
            goalLine: "-1",
            matchResultStatus: "1",
            poolStatus: "Close",
            sectionsNo1: "",
            sectionsNo999: "",
          },
        ],
      },
    };

    const resultsById = parseSportteryResultsJson(rawSportteryResultPayload);
    assert.equal(resultsById.get("2042881")?.settled, true);
    assert.equal(resultsById.get("2042881")?.fullScore, "1:1");
    assert.equal(resultsById.get("2042881")?.halfScore, "0:0");
    assert.equal(resultsById.get("2042884")?.isVoid, true);
    // Unfinished match (empty sectionsNo999) must NOT be marked settled
    assert.equal(Boolean(resultsById.get("2042886")?.settled), false);

    // 1. Print-time fixed odds (4.20 vs closing 3.90) + 5-pool CRS "胜其它" / TTG "s7" / HAFU "dd" / HHAD(-2)
    const wonSnap = {
      matches: [
        {
          matchId: "2042881",
          matchNumStr: "周五003",
          home: "鹿岛鹿角",
          away: "清水鼓动",
          kickoff: "18:00",
          goalLine: "-1",
          picks: [
            { poolCode: "HAD", optionKey: "d", optionLabel: "平", odds: 4.2 },
          ],
        },
        {
          matchId: "2042882",
          matchNumStr: "周五004",
          home: "拜仁",
          away: "波鸿",
          kickoff: "20:00",
          goalLine: "-2",
          picks: [
            {
              poolCode: "CRS",
              optionKey: "胜其它",
              optionLabel: "胜其它",
              odds: 12.5,
            },
          ],
        },
      ],
      lines: [
        {
          id: "t1",
          modeLabel: "2串1",
          multiple: 5,
          legs: [
            {
              matchId: "2042881",
              poolCode: "HAD",
              optionKey: "d",
              optionLabel: "平",
              odds: 4.2,
              goalLine: "-1",
            },
            {
              matchId: "2042882",
              poolCode: "CRS",
              optionKey: "胜其它",
              optionLabel: "胜其它",
              odds: 12.5,
              goalLine: "-2",
            },
          ],
        },
      ],
    };
    const wonRes = settleTicketSnapshotWithOfficialResults(
      wonSnap,
      resultsById,
      { stakeCost: 10 }
    );
    // 2 * 4.20 * 12.50 = 105.00 unit * 5 = 525.00 (closing 3.90 would give 487.50)
    assert.equal(wonRes.status, "won");
    assert.equal(wonRes.settledReturn, 525);
    assert.equal(wonRes.netProfit, 515);
    assert.equal(wonRes.hitTicketCount, 1);

    // 2. Partial-recovery underwater 3串4 (4 tickets x 5x = ¥40; only 2串1 of 2042881 x 2042882 hits)
    const partialSnap = {
      matches: [
        {
          matchId: "2042881",
          matchNumStr: "周五003",
          home: "鹿岛鹿角",
          away: "清水鼓动",
          kickoff: "18:00",
          goalLine: "-1",
          picks: [
            {
              poolCode: "HHAD",
              optionKey: "ha",
              optionLabel: "让负",
              odds: 1.65,
            },
          ],
        },
        {
          matchId: "2042882",
          matchNumStr: "周五004",
          home: "拜仁",
          away: "波鸿",
          kickoff: "20:00",
          goalLine: "-2",
          picks: [
            {
              poolCode: "HHAD",
              optionKey: "hh",
              optionLabel: "让胜",
              odds: 1.8,
            },
          ],
        },
        {
          matchId: "2042883",
          matchNumStr: "周五005",
          home: "尤文",
          away: "都灵",
          kickoff: "22:00",
          goalLine: "-1",
          picks: [
            { poolCode: "HAD", optionKey: "h", optionLabel: "主胜", odds: 2.1 },
          ],
        },
      ],
      lines: [
        {
          id: "ab",
          modeLabel: "2串1",
          multiple: 5,
          legs: [
            {
              matchId: "2042881",
              poolCode: "HHAD",
              optionKey: "ha",
              odds: 1.65,
              goalLine: "-1",
            },
            {
              matchId: "2042882",
              poolCode: "HHAD",
              optionKey: "hh",
              odds: 1.8,
              goalLine: "-2",
            },
          ],
        },
        {
          id: "ac",
          modeLabel: "2串1",
          multiple: 5,
          legs: [
            {
              matchId: "2042881",
              poolCode: "HHAD",
              optionKey: "ha",
              odds: 1.65,
              goalLine: "-1",
            },
            {
              matchId: "2042883",
              poolCode: "HAD",
              optionKey: "h",
              odds: 2.1,
              goalLine: "-1",
            },
          ],
        },
        {
          id: "bc",
          modeLabel: "2串1",
          multiple: 5,
          legs: [
            {
              matchId: "2042882",
              poolCode: "HHAD",
              optionKey: "hh",
              odds: 1.8,
              goalLine: "-2",
            },
            {
              matchId: "2042883",
              poolCode: "HAD",
              optionKey: "h",
              odds: 2.1,
              goalLine: "-1",
            },
          ],
        },
        {
          id: "abc",
          modeLabel: "3串1",
          multiple: 5,
          legs: [
            {
              matchId: "2042881",
              poolCode: "HHAD",
              optionKey: "ha",
              odds: 1.65,
              goalLine: "-1",
            },
            {
              matchId: "2042882",
              poolCode: "HHAD",
              optionKey: "hh",
              odds: 1.8,
              goalLine: "-2",
            },
            {
              matchId: "2042883",
              poolCode: "HAD",
              optionKey: "h",
              odds: 2.1,
              goalLine: "-1",
            },
          ],
        },
      ],
    };
    const partialRes = settleTicketSnapshotWithOfficialResults(
      partialSnap,
      resultsById,
      { stakeCost: 40 }
    );
    // 2 * 1.65 * 1.80 = 5.94 * 5 = 29.70 (< 40.00 cost -> partial underwater recovery)
    assert.equal(partialRes.status, "partial");
    assert.equal(partialRes.settledReturn, 29.7);
    assert.equal(partialRes.netProfit, -10.3);
    assert.equal(partialRes.hitTicketCount, 1);
    assert.equal(partialRes.totalTicketCount, 4);

    // 3. Void leg (1.0 multiplier) steps statutory cap tier down from 4-leg (500k) to 3-leg (200k)
    const extraResults = new Map(resultsById);
    extraResults.set("2042890", {
      matchId: "2042890",
      settled: true,
      isVoid: false,
      halfScore: "1:0",
      fullScore: "2:0",
      h1: 1,
      a1: 0,
      h2: 2,
      a2: 0,
    });
    const voidCapSnap = {
      matches: [],
      lines: [
        {
          id: "cap4",
          modeLabel: "4串1",
          multiple: 1,
          legs: [
            {
              matchId: "2042881",
              poolCode: "HAFU",
              optionKey: "dd",
              odds: 50,
            },
            {
              matchId: "2042882",
              poolCode: "TTG",
              optionKey: "s7",
              odds: 50,
            },
            {
              matchId: "2042890",
              poolCode: "CRS",
              optionKey: "2:0",
              odds: 50,
            },
            {
              matchId: "2042884",
              poolCode: "HAD",
              optionKey: "h",
              odds: 3.5,
            },
          ],
        },
      ],
    };
    const voidCapRes = settleTicketSnapshotWithOfficialResults(
      voidCapSnap,
      extraResults,
      { stakeCost: 2 }
    );
    // Raw unit = 2 * 50 * 50 * 50 * 1.0 = 250,000 -> effective non-void legs = 3 -> clipped to 200,000!
    assert.equal(voidCapRes.status, "won");
    assert.equal(voidCapRes.settledReturn, 200_000);

    // 4a. Early elimination: Match 2042883 missed (0:1, picked h), Match 2042886 pending -> order already dead!
    const earlyDeadSnap = {
      matches: [],
      lines: [
        {
          id: "dead",
          modeLabel: "2串1",
          multiple: 5,
          legs: [
            { matchId: "2042883", poolCode: "HAD", optionKey: "h", odds: 2.1 },
            { matchId: "2042886", poolCode: "HAD", optionKey: "h", odds: 1.9 },
          ],
        },
      ],
    };
    const earlyDeadRes = settleTicketSnapshotWithOfficialResults(
      earlyDeadSnap,
      resultsById,
      { stakeCost: 10 }
    );
    assert.equal(earlyDeadRes.status, "lost");
    assert.equal(earlyDeadRes.settledReturn, 0);
    assert.equal(earlyDeadRes.earlyEliminated, true);

    // 4b. Early-hit live staggered hedge: Match 2042881 hit (@2.20), Match 2042886 pending (@1.90, live HHAD(-1) ha @1.95 single=true)
    const liveMatchesById = new Map([
      [
        "2042886",
        {
          id: "2042886",
          matchNumStr: "周五008",
          home: "毕尔巴鄂",
          away: "西班牙人",
          kickoff: "03:45",
          pools: {
            HAD: {
              code: "HAD",
              name: "胜平负",
              single: false,
              selling: true,
              options: [
                { key: "h", label: "主胜", odds: 1.9 },
                { key: "d", label: "平", odds: 3.3 },
                { key: "a", label: "客胜", odds: 3.6 },
              ],
            },
            HHAD: {
              code: "HHAD",
              name: "让球(-1)",
              goalLine: "-1",
              single: true,
              selling: true,
              options: [
                { key: "hh", label: "让胜", odds: 3.7 },
                { key: "hd", label: "让平", odds: 3.45 },
                { key: "ha", label: "让负", odds: 1.95 },
              ],
            },
          },
        },
      ],
    ]);
    const earlyHitSnap = {
      matches: [
        {
          matchId: "2042881",
          matchNumStr: "周五003",
          home: "鹿岛鹿角",
          away: "清水鼓动",
          kickoff: "18:00",
          goalLine: "-1",
          picks: [
            { poolCode: "HAD", optionKey: "d", optionLabel: "平", odds: 2.2 },
          ],
        },
        {
          matchId: "2042886",
          matchNumStr: "周五008",
          home: "毕尔巴鄂",
          away: "西班牙人",
          kickoff: "03:45",
          goalLine: "-1",
          picks: [
            { poolCode: "HAD", optionKey: "h", optionLabel: "主胜", odds: 1.9 },
          ],
        },
      ],
      lines: [
        {
          id: "live2x1",
          modeLabel: "2串1",
          multiple: 10,
          legs: [
            { matchId: "2042881", poolCode: "HAD", optionKey: "d", odds: 2.2 },
            { matchId: "2042886", poolCode: "HAD", optionKey: "h", odds: 1.9 },
          ],
        },
      ],
    };
    const earlyHitRes = settleTicketSnapshotWithOfficialResults(
      earlyHitSnap,
      resultsById,
      { stakeCost: 20, liveMatchesById }
    );
    assert.equal(earlyHitRes.status, "pending");
    assert.ok(earlyHitRes.liveEarlyHedge?.available);
    assert.equal(earlyHitRes.liveEarlyHedge?.hedgeMode, "lock-profit");
    // 2*2.2*1.9*10 = 83.60; unit hedge @1.95 = 3.90; m=21 (cost 42) -> min(83.60, 81.90) - 20 - 42 = +19.90
    assert.equal(earlyHitRes.liveEarlyHedge?.hedgeCost, 42);
    assert.equal(earlyHitRes.liveEarlyHedge?.lockedNetProfit, 19.9);
  });

  it("Slice 02 · Seam 2: manages snapshot auto-settlement, honest partial/won/lost stats, manualOverride, undo restore, batch paper clear, and anti-tilt deleted-loss guardrail lock", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-ldg-0013-"));
    try {
      let nowMs = Date.parse("2026-11-20T12:00:00+08:00");
      const ledgerFile = path.join(tmpDir, "ledgers.json");
      const ldg = createLedgerManager({
        ledgerFile,
        nowFn: () => nowMs,
      });

      const uid = "u_member_1";
      ldg.mutateUserLedger(uid, { action: "set-daily-limit", dailyLimit: 200 });

      // Legacy shell entry without snapshot remains 100% compatible
      const legacyAdd = ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "paper",
        title: "旧版无快照单",
        modeLabel: "2串1",
        betCount: 1,
        cost: 0,
        paperRefCost: 10,
        minPayout: 15,
        maxPayout: 15,
      });
      assert.equal(legacyAdd.ok, true);

      const partial3x4Snap = {
        matches: [
          {
            matchId: "2042881",
            matchNumStr: "周五003",
            home: "鹿岛鹿角",
            away: "清水鼓动",
            kickoff: "18:00",
            goalLine: "-1",
            picks: [
              {
                poolCode: "HHAD",
                optionKey: "ha",
                optionLabel: "让负",
                odds: 1.65,
              },
            ],
          },
          {
            matchId: "2042882",
            matchNumStr: "周五004",
            home: "拜仁",
            away: "波鸿",
            kickoff: "20:00",
            goalLine: "-2",
            picks: [
              {
                poolCode: "HHAD",
                optionKey: "hh",
                optionLabel: "让胜",
                odds: 1.8,
              },
            ],
          },
          {
            matchId: "2042883",
            matchNumStr: "周五005",
            home: "尤文",
            away: "都灵",
            kickoff: "22:00",
            goalLine: "-1",
            picks: [
              {
                poolCode: "HAD",
                optionKey: "h",
                optionLabel: "主胜",
                odds: 2.1,
              },
            ],
          },
        ],
        lines: [
          {
            id: "ab",
            modeLabel: "2串1",
            multiple: 5,
            legs: [
              {
                matchId: "2042881",
                poolCode: "HHAD",
                optionKey: "ha",
                odds: 1.65,
                goalLine: "-1",
              },
              {
                matchId: "2042882",
                poolCode: "HHAD",
                optionKey: "hh",
                odds: 1.8,
                goalLine: "-2",
              },
            ],
          },
          {
            id: "ac",
            modeLabel: "2串1",
            multiple: 5,
            legs: [
              {
                matchId: "2042881",
                poolCode: "HHAD",
                optionKey: "ha",
                odds: 1.65,
                goalLine: "-1",
              },
              {
                matchId: "2042883",
                poolCode: "HAD",
                optionKey: "h",
                odds: 2.1,
                goalLine: "-1",
              },
            ],
          },
          {
            id: "bc",
            modeLabel: "2串1",
            multiple: 5,
            legs: [
              {
                matchId: "2042882",
                poolCode: "HHAD",
                optionKey: "hh",
                odds: 1.8,
                goalLine: "-2",
              },
              {
                matchId: "2042883",
                poolCode: "HAD",
                optionKey: "h",
                odds: 2.1,
                goalLine: "-1",
              },
            ],
          },
          {
            id: "abc",
            modeLabel: "3串1",
            multiple: 5,
            legs: [
              {
                matchId: "2042881",
                poolCode: "HHAD",
                optionKey: "ha",
                odds: 1.65,
                goalLine: "-1",
              },
              {
                matchId: "2042882",
                poolCode: "HHAD",
                optionKey: "hh",
                odds: 1.8,
                goalLine: "-2",
              },
              {
                matchId: "2042883",
                poolCode: "HAD",
                optionKey: "h",
                odds: 2.1,
                goalLine: "-1",
              },
            ],
          },
        ],
      };

      const won2x1Snap = {
        matches: [],
        lines: [
          {
            id: "w1",
            modeLabel: "2串1",
            multiple: 5,
            legs: [
              {
                matchId: "2042881",
                poolCode: "HAD",
                optionKey: "d",
                odds: 3.5,
              },
              {
                matchId: "2042882",
                poolCode: "HAD",
                optionKey: "h",
                odds: 1.5,
              },
            ],
          },
        ],
      };

      const lostSnap = {
        matches: [],
        lines: [
          {
            id: "l1",
            modeLabel: "单关",
            multiple: 10,
            legs: [
              {
                matchId: "2042883",
                poolCode: "HAD",
                optionKey: "h",
                odds: 2.1,
              },
            ],
          },
        ],
      };

      const lPartial = ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "live",
        title: "实买3串4容错",
        modeLabel: "3串4",
        betCount: 4,
        cost: 40,
        minPayout: 29.7,
        maxPayout: 140,
        snapshot: partial3x4Snap,
      });
      const lWon = ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "live",
        title: "实买2串1主攻",
        modeLabel: "2串1",
        betCount: 1,
        cost: 10,
        minPayout: 52.5,
        maxPayout: 52.5,
        snapshot: won2x1Snap,
      });
      ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "paper",
        title: "模拟3串4局部回血",
        modeLabel: "3串4",
        betCount: 4,
        cost: 0,
        paperRefCost: 40,
        minPayout: 29.7,
        maxPayout: 140,
        snapshot: partial3x4Snap,
      });
      ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "paper",
        title: "模拟单关黑单",
        modeLabel: "单关",
        betCount: 1,
        cost: 0,
        paperRefCost: 20,
        minPayout: 42,
        maxPayout: 42,
        snapshot: lostSnap,
      });

      assert.equal(ldg.hasPendingSnapshots(uid), true);

      const officialResults = parseSportteryResultsJson([
        {
          matchId: 2042881,
          matchNumStr: "周五003",
          matchResultStatus: "2",
          poolStatus: "Payout",
          sectionsNo1: "0:0",
          sectionsNo999: "1:1",
          goalLine: "-1",
        },
        {
          matchId: 2042882,
          matchNumStr: "周五004",
          matchResultStatus: "2",
          poolStatus: "Payout",
          sectionsNo1: "2:0",
          sectionsNo999: "6:1",
          goalLine: "-2",
        },
        {
          matchId: 2042883,
          matchNumStr: "周五005",
          matchResultStatus: "2",
          poolStatus: "Payout",
          sectionsNo1: "0:0",
          sectionsNo999: "0:1",
          goalLine: "-1",
        },
      ]);

      const settleRes = ldg.autoSettleUserLedger(uid, {
        resultsById: officialResults,
      });
      assert.equal(settleRes.newlySettledCount, 4);
      const st = settleRes.ledger.stats;
      assert.equal(st.liveSettledCount, 2);
      assert.equal(st.liveWonCount, 1);
      assert.equal(st.livePartialCount, 1);
      // Only strict non-losing won (1 of 2) counts toward liveWinRatePct = 50.0%
      assert.equal(st.liveWinRatePct, 50);
      // Net profit = (+42.50) + (-10.30) = +32.20
      assert.equal(st.liveNetProfit, 32.2);
      // Paper saved = (40 - 29.70) + 20 = 30.30
      assert.equal(st.paperSavedAmount, 30.3);
      assert.equal(st.paperPartialCount, 1);
      assert.equal(st.paperLostCount, 1);

      // Manual override protects settledReturn from being overwritten by subsequent auto-settle
      const lPartialId = lPartial.entry.id;
      ldg.mutateUserLedger(uid, {
        action: "settle-entry",
        entryId: lPartialId,
        status: "partial",
        settledReturn: 31,
      });
      const rerun = ldg.autoSettleUserLedger(uid, {
        resultsById: officialResults,
      });
      const afterManual = rerun.ledger.entries.find(
        (e: { id: string }) => e.id === lPartialId
      );
      assert.equal(afterManual.settledReturn, 31);
      assert.equal(afterManual.netProfit, -9);

      // Clear settled paper entries keeps pending legacy paper entry & all live entries, and supports undo!
      const clearPaper = ldg.mutateUserLedger(uid, {
        action: "clear-settled-paper",
      });
      assert.equal(clearPaper.clearedCount, 2);
      assert.equal(
        clearPaper.ledger.entries.filter(
          (e: { kind: string }) => e.kind === "paper"
        ).length,
        1
      );
      const undoClear = ldg.mutateUserLedger(uid, {
        action: "restore-entry",
        undoToken: clearPaper.undoToken,
      });
      assert.equal(
        undoClear.ledger.entries.filter(
          (e: { kind: string }) => e.kind === "paper"
        ).length,
        3
      );

      // Anti-tilt stop-loss guardrail lock vs pending refund
      // Current dailyLiveSpent = 40 (lPartial) + 10 (lWon) = 50; dailyRemaining = 150
      const pendingMistake = ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "live",
        title: "误记未出票单",
        modeLabel: "单关",
        betCount: 1,
        cost: 60,
        minPayout: 100,
        maxPayout: 100,
      });
      assert.equal(pendingMistake.ledger.dailyLiveSpent, 110);
      assert.equal(pendingMistake.ledger.dailyRemaining, 90);

      // Deleting a PENDING live ticket refunds its ¥60 quota immediately
      const delPending = ldg.mutateUserLedger(uid, {
        action: "delete-entry",
        entryId: pendingMistake.entry.id,
      });
      assert.equal(delPending.ledger.dailyLiveSpent, 50);
      assert.equal(delPending.ledger.dailyRemaining, 150);

      // Deleting a SETTLED LOSING/PARTIAL-UNDERWATER live ticket (lPartial, cost ¥40, net -¥9) MUST lock its ¥40 daily quota!
      const delLosing = ldg.mutateUserLedger(uid, {
        action: "delete-entry",
        entryId: lPartialId,
      });
      assert.equal(delLosing.ledger.dailyLiveSpent, 50);
      assert.equal(delLosing.ledger.dailyRemaining, 150);
      assert.equal(delLosing.lockedStopLossStake, 40);

      // Tilting user tries to add ¥160 live ticket -> still blocked by STOP_LOSS_EXCEEDED!
      const tiltAttempt = ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "live",
        title: "上头重注",
        modeLabel: "单关",
        betCount: 1,
        cost: 160,
        minPayout: 300,
        maxPayout: 300,
      });
      assert.equal(tiltAttempt.ok, false);
      assert.equal(tiltAttempt.code, "STOP_LOSS_EXCEEDED");
      assert.equal(tiltAttempt.overBy, 10);

      // 5-second undo restore brings lPartial back WITHOUT double-counting dailyLiveSpent (stays 50!)
      const restored = ldg.mutateUserLedger(uid, {
        action: "restore-entry",
        undoToken: delLosing.undoToken,
      });
      assert.equal(restored.ledger.dailyLiveSpent, 50);
      assert.ok(
        restored.ledger.entries.some((e: { id: string }) => e.id === lPartialId)
      );

      // Delete again and cross Beijing midnight -> dailyLiveSpent resets cleanly to 0!
      ldg.mutateUserLedger(uid, {
        action: "delete-entry",
        entryId: lPartialId,
      });
      nowMs = Date.parse("2026-11-21T00:05:00+08:00");
      const nextDaySnap = ldg.getUserLedger(uid);
      assert.equal(nextDaySnap.dailyLiveSpent, 0);
      assert.equal(nextDaySnap.dailyRemaining, 200);

      // Verify runtimeApp wiring passes fetchResults adapter cleanly
      const runtime = createYouJingRuntime({
        dataDir: path.join(tmpDir, "rt"),
        enableXiaoGaoProbe: false,
        nowFn: () => nowMs,
        fetchResults: async () => officialResults,
      });
      runtime.dispose();
      assert.ok(typeof lWon.entry.id === "string");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 03 · Seam 3: seals print-time banker/bonus snapshots, formats shopkeeper WeChat slips (incl. >99x terminal split), computes weekday/weekend cutoff windows, and searches/groups radar matches", async () => {
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: async (params) =>
        evaluateQuantWorkspace(params, FALLBACK_MATCHES),
    });
    ctrl.initializeMatches(
      FALLBACK_MATCHES,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 1 }, FALLBACK_MATCHES)
    );

    const [m1, m2, m3] = ctrl.getState().matches;
    ctrl.togglePick(m1, "HAD", "h");
    ctrl.togglePick(m2, "HHAD", "ha");
    ctrl.togglePick(m3, "HAD", "h");
    await ctrl.flush();

    // Mark m1 as 📌胆 on 3 matches -> auto-locks 2串1(1胆) with 2 tickets (m1×m2, m1×m3)
    const bkRes = ctrl.toggleBankerMatch(m1.id);
    assert.equal(bkRes.ok, true);
    ctrl.setDirectMultiple(120); // >99x triggers 99 + 21 physical terminal slip split in shopkeeper text!
    await ctrl.flush();

    const sealed = ctrl.buildSealedLedgerDraft();
    assert.ok(sealed);
    assert.equal(sealed.betCount, 2);
    assert.equal(sealed.cost, 480); // 2 bets * 2 yuan * 120x = 480
    assert.equal(sealed.snapshot?.matches.length, 3);
    assert.equal(
      sealed.snapshot?.matches.find((x) => x.matchId === m1.id)?.isBanker,
      true
    );
    assert.equal(sealed.snapshot?.lines.length, 2);
    const totalLineCost = (sealed.snapshot?.lines || []).reduce(
      (s, l) => s + l.multiple * 2,
      0
    );
    assert.equal(totalLineCost, 480);

    const wechatSlip = ctrl.formatShopkeeperWeChatSlip({
      useConsolidated: true,
    });
    assert.ok(wechatSlip.includes("【竞彩出票单"));
    assert.ok(wechatSlip.includes("合计 ¥480"));
    assert.ok(wechatSlip.includes("【胆】"));
    assert.ok(wechatSlip.includes("99倍"));
    assert.ok(wechatSlip.includes("21倍"));

    // Weekday 21:40 Beijing (Wed 2026-11-18) -> 20m before 22:00 urgent
    const wedUrgent = computeSportteryCutoffStatus(
      Date.parse("2026-11-18T21:40:00+08:00")
    );
    assert.equal(wedUrgent.cutoffLabel, "22:00");
    assert.equal(wedUrgent.remainingMinutes, 20);
    assert.equal(wedUrgent.level, "urgent");

    // Saturday 21:40 Beijing (Sat 2026-11-21) -> 80m before 23:00 weekend cutoff -> normal
    const satNormal = computeSportteryCutoffStatus(
      Date.parse("2026-11-21T21:40:00+08:00")
    );
    assert.equal(satNormal.cutoffLabel, "23:00");
    assert.equal(satNormal.remainingMinutes, 80);
    assert.equal(satNormal.level, "normal");

    // Saturday 22:42 Beijing -> 18m before 23:00 -> urgent
    const satUrgent = computeSportteryCutoffStatus(
      Date.parse("2026-11-21T22:42:00+08:00")
    );
    assert.equal(satUrgent.level, "urgent");
    assert.equal(satUrgent.remainingMinutes, 18);

    // Late night 23:15 Beijing -> closed
    const satClosed = computeSportteryCutoffStatus(
      Date.parse("2026-11-21T23:15:00+08:00")
    );
    assert.equal(satClosed.level, "closed");

    // Radar search & match-day grouping
    const sampleMatches = [
      {
        ...m1,
        matchNumStr: "周五008",
        home: "毕尔巴鄂",
        away: "西班牙人",
        businessDate: "2026-11-20",
      },
      {
        ...m2,
        matchNumStr: "周六001",
        home: "鹿岛鹿角",
        away: "清水鼓动",
        businessDate: "2026-11-21",
      },
      {
        ...m3,
        matchNumStr: "周六015",
        home: "皇家马德里",
        away: "奥萨苏纳",
        businessDate: "2026-11-21",
      },
    ];
    const search008 = filterAndGroupRadarMatches(sampleMatches, {
      searchQuery: "008",
    });
    assert.equal(search008.totalCount, 1);
    assert.equal(search008.groups[0]?.matches[0]?.home, "毕尔巴鄂");

    const searchNone = filterAndGroupRadarMatches(sampleMatches, {
      searchQuery: "不存在的球队XYZ",
    });
    assert.equal(searchNone.totalCount, 0);
    assert.equal(searchNone.groups.length, 0);

    const groupedAll = filterAndGroupRadarMatches(sampleMatches, {});
    assert.equal(groupedAll.totalCount, 3);
    assert.equal(groupedAll.groups.length, 2);
    assert.equal(groupedAll.groups[0]?.matches.length, 1);
    assert.equal(groupedAll.groups[1]?.matches.length, 2);
  });

  it("Slice 04 · Seam 4: serves 0ms Iron-Cage Manual KB answers for auto-settle, partial recovery, anti-tilt lock & WeChat slip, and enforces dual-cabin UI contracts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-qa-0013-"));
    try {
      const accountManager = createAccountManager({
        accountsFile: path.join(tmpDir, "accounts.json"),
        adminCredsFile: path.join(tmpDir, "admin.txt"),
      });
      const created = accountManager.createAccount({
        username: "member_qa_13",
        durationHours: 24,
        maxDevices: 2,
        aiEnabled: true,
        dailyAiLimit: 10,
      });
      const qa = createManualQaEngine({
        accountManager,
        xiaogaoService: null,
        getApiKey: () => "",
      });

      const q1 = await qa.answerManualQuestion({
        userId: created.user.id,
        question: "账本怎么自动开奖？局部回血单算进红单率吗？",
        ip: "127.0.0.1",
      });
      assert.equal(q1.ok, true);
      assert.equal(q1.source, "local-kb");
      assert.ok(q1.answer.includes("自动"));
      assert.ok(q1.answer.includes("局部回血"));

      const q2 = await qa.answerManualQuestion({
        userId: created.user.id,
        question: "怎么一键复制发体彩店主微信口令？体彩几点停售？",
        ip: "127.0.0.1",
      });
      assert.equal(q2.ok, true);
      assert.equal(q2.source, "local-kb");
      assert.ok(q2.answer.includes("微信口令") || q2.answer.includes("店主"));
      assert.ok(q2.answer.includes("22:00") || q2.answer.includes("23:00"));

      const q3 = await qa.answerManualQuestion({
        userId: created.user.id,
        question: "删掉当天亏钱的实买单会退回今日止损护栏额度吗？",
        ip: "127.0.0.1",
      });
      assert.equal(q3.ok, true);
      assert.equal(q3.source, "local-kb");
      assert.ok(q3.answer.includes("不退") || q3.answer.includes("锁死"));

      const appSrc = fs.readFileSync(
        path.join(process.cwd(), "src/mobile/SkinPhoneApp.tsx"),
        "utf8"
      );
      const cssSrc = fs.readFileSync(
        path.join(process.cwd(), "public/skins/core.css"),
        "utf8"
      );
      assert.ok(
        appSrc.includes("is-live") && appSrc.includes("is-paper"),
        "SkinPhoneApp must distinguish live vs paper ledger cards visually"
      );
      assert.ok(
        appSrc.includes("一键复制发店主微信口令"),
        "Poster sheet must include 1-tap WeChat shopkeeper slip copy button"
      );
      assert.ok(
        appSrc.includes("小高情报舱") && appSrc.includes("双轨账本"),
        "Tab 4 must split Dual-Track Ledger and XiaoGao Intel Cabin cleanly"
      );
      assert.ok(
        cssSrc.includes(".ledger-entry.is-live") &&
          cssSrc.includes(".ledger-entry.is-paper"),
        "core.css must style live solid-spine vs paper dashed-blueprint cards"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 05 · Two-Axis Review Remediation: enforces authoritative snapshot odds/caps, HHAD goalLine & kickoff hedge guards, strict official payout status, 2-click anti-tilt lock, paper partial->won transition, and raw odds sealing under sandbox void", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-rev-0013-"));
    try {
      // 1. Strict official settled gate: Close/Selling or missing half-time sectionsNo1 must NOT settle
      const incompleteRes = parseSportteryResultsJson([
        {
          matchId: 9001,
          matchResultStatus: "",
          poolStatus: "Close",
          sectionsNo1: "1:0",
          sectionsNo999: "2:0",
        },
        {
          matchId: 9002,
          matchResultStatus: "2",
          poolStatus: "Payout",
          sectionsNo1: "",
          sectionsNo999: "2:0",
        },
      ]);
      assert.equal(incompleteRes.get("9001")?.settled, false);
      assert.equal(incompleteRes.get("9002")?.settled, false);

      // 2. HHAD goalLine shift (-2 at print time vs -1 live) MUST block false lock-profit liveEarlyHedge
      const settledEarly = parseSportteryResultsJson([
        {
          matchId: 2042881,
          matchResultStatus: "2",
          poolStatus: "Payout",
          sectionsNo1: "0:0",
          sectionsNo999: "1:1",
          goalLine: "-1",
        },
      ]);
      const shiftedLiveMap = new Map([
        [
          "2042886",
          {
            id: "2042886",
            matchNumStr: "周五008",
            home: "毕尔巴鄂",
            away: "西班牙人",
            kickoff: "03:45",
            pools: {
              HAD: {
                code: "HAD",
                name: "胜平负",
                single: true,
                selling: true,
                options: [
                  { key: "h", label: "主胜", odds: 1.5 },
                  { key: "d", label: "平", odds: 3.8 },
                  { key: "a", label: "客胜", odds: 5.2 },
                ],
              },
              HHAD: {
                code: "HHAD",
                name: "让球(-1)",
                goalLine: "-1", // shifted from -2!
                single: true,
                selling: true,
                options: [
                  { key: "hh", label: "让胜", odds: 2.4 },
                  { key: "hd", label: "让平", odds: 3.35 },
                  { key: "ha", label: "让负", odds: 2.45 },
                ],
              },
            },
          },
        ],
      ]);
      const shiftedSnap = {
        matches: [],
        lines: [
          {
            id: "sh1",
            modeLabel: "2串1",
            multiple: 10,
            legs: [
              {
                matchId: "2042881",
                poolCode: "HAD",
                optionKey: "d",
                odds: 3.2,
              },
              {
                matchId: "2042886",
                poolCode: "HHAD",
                optionKey: "hh",
                odds: 4.5,
                goalLine: "-2",
              },
            ],
          },
        ],
      };
      const shiftedOut = settleTicketSnapshotWithOfficialResults(
        shiftedSnap,
        settledEarly,
        { stakeCost: 20, liveMatchesById: shiftedLiveMap }
      );
      assert.equal(shiftedOut.liveEarlyHedge, null);

      // 3. Untrusted snapshot validation: rejects >64 untrusted lines, rejects 5-leg CRS (>4 statutory cap), binds authoritative odds
      let nowMs = Date.parse("2026-11-20T15:00:00+08:00");
      const ldg = createLedgerManager({
        ledgerFile: path.join(tmpDir, "ldg.json"),
        nowFn: () => nowMs,
      });
      const uid = "u_sec_13";
      ldg.mutateUserLedger(uid, { action: "set-daily-limit", dailyLimit: 200 });

      // 65 untrusted lines without trustedServerSnapshot -> snapshot rejected
      const over64Snap = {
        matches: [{ matchId: FALLBACK_MATCHES[0].id, picks: [] }],
        lines: Array.from({ length: 65 }, (_, i) => ({
          id: `ln_${i}`,
          modeLabel: "单关",
          multiple: 1,
          legs: [
            {
              matchId: FALLBACK_MATCHES[0].id,
              poolCode: "CRS",
              optionKey: "1:0",
              odds: 6.5,
            },
          ],
        })),
      };
      assert.throws(() =>
        ldg.mutateUserLedger(uid, {
          action: "add-entry",
          kind: "paper",
          title: "超64行未受信快照",
          modeLabel: "单关",
          betCount: 65,
          cost: 0,
          paperRefCost: 130,
          minPayout: 10,
          maxPayout: 100,
          snapshot: over64Snap,
        })
      );

      // 5-leg CRS parlay violates statutory 4-leg CRS cap -> rejected
      const crs5LegSnap = {
        matches: FALLBACK_MATCHES.slice(0, 5).map((m) => ({
          matchId: m.id,
          picks: [{ poolCode: "CRS", optionKey: "1:0", odds: 7 }],
        })),
        lines: [
          {
            id: "bad_crs5",
            modeLabel: "5串1",
            multiple: 1,
            legs: FALLBACK_MATCHES.slice(0, 5).map((m) => ({
              matchId: m.id,
              poolCode: "CRS",
              optionKey: "1:0",
              odds: 7,
            })),
          },
        ],
      };
      assert.throws(() =>
        ldg.mutateUserLedger(uid, {
          action: "add-entry",
          kind: "paper",
          title: "非法比分5串1",
          modeLabel: "5串1",
          betCount: 1,
          cost: 0,
          paperRefCost: 2,
          minPayout: 10,
          maxPayout: 100,
          snapshot: crs5LegSnap,
        })
      );

      // Forged odds (9999) on known authoritative single-eligible match gets bound to authoritative match odds!
      const authMatch =
        FALLBACK_MATCHES.find((m: MatchItem) => m.pools.HAD.single) ||
        FALLBACK_MATCHES[0];
      const realHadHomeOdds = authMatch.pools.HAD.options[0].odds;
      const forgedAdd = ldg.mutateUserLedger(
        uid,
        {
          action: "add-entry",
          kind: "live",
          title: "防伪赔率测试",
          modeLabel: "单关",
          betCount: 1,
          cost: 50,
          minPayout: 60,
          maxPayout: 60,
          snapshot: {
            matches: [
              {
                matchId: authMatch.id,
                picks: [{ poolCode: "HAD", optionKey: "h", odds: 9999 }],
              },
            ],
            lines: [
              {
                id: "fg1",
                modeLabel: "单关",
                multiple: 25,
                legs: [
                  {
                    matchId: authMatch.id,
                    poolCode: "HAD",
                    optionKey: "h",
                    odds: 9999,
                  },
                ],
              },
            ],
          },
        },
        { authoritativeMatches: FALLBACK_MATCHES }
      );
      assert.equal(
        forgedAdd.entry.snapshot.lines[0].legs[0].odds,
        realHadHomeOdds
      );

      // 3b. Closed/unsold pool (selling: false / odds: 0), bogus optionKey, or non-single 1-leg line on authoritative match MUST be rejected (never fall back to client 1000x odds!)
      const closedHadAuthMatch: MatchItem = {
        ...authMatch,
        id: "auth_closed_had",
        pools: {
          ...authMatch.pools,
          HAD: {
            ...authMatch.pools.HAD,
            selling: false,
            single: false,
            options: authMatch.pools.HAD.options.map((o) => ({
              ...o,
              odds: 0,
            })),
          },
          HHAD: {
            ...authMatch.pools.HHAD,
            selling: true,
            single: false,
          },
        },
      };
      assert.throws(() =>
        ldg.mutateUserLedger(
          uid,
          {
            action: "add-entry",
            kind: "paper",
            title: "停售池伪造千倍赔率",
            modeLabel: "2串1",
            betCount: 1,
            cost: 0,
            paperRefCost: 2,
            minPayout: 1000,
            maxPayout: 1000,
            snapshot: {
              lines: [
                {
                  id: "closed_ln",
                  modeLabel: "2串1",
                  multiple: 1,
                  legs: [
                    {
                      matchId: "auth_closed_had",
                      poolCode: "HAD",
                      optionKey: "h",
                      odds: 1000,
                    },
                    {
                      matchId: authMatch.id,
                      poolCode: "HAD",
                      optionKey: "h",
                      odds: realHadHomeOdds,
                    },
                  ],
                },
              ],
            },
          },
          { authoritativeMatches: [closedHadAuthMatch, authMatch] }
        )
      );
      assert.throws(() =>
        ldg.mutateUserLedger(
          uid,
          {
            action: "add-entry",
            kind: "paper",
            title: "伪造非法选项键",
            modeLabel: "单关",
            betCount: 1,
            cost: 0,
            paperRefCost: 2,
            minPayout: 1000,
            maxPayout: 1000,
            snapshot: {
              lines: [
                {
                  id: "bogus_ln",
                  modeLabel: "单关",
                  multiple: 1,
                  legs: [
                    {
                      matchId: authMatch.id,
                      poolCode: "HAD",
                      optionKey: "bogus_opt",
                      odds: 1000,
                    },
                  ],
                },
              ],
            },
          },
          { authoritativeMatches: [authMatch] }
        )
      );
      assert.throws(() =>
        ldg.mutateUserLedger(
          uid,
          {
            action: "add-entry",
            kind: "paper",
            title: "未开单关伪造单关票",
            modeLabel: "单关",
            betCount: 1,
            cost: 0,
            paperRefCost: 2,
            minPayout: 10,
            maxPayout: 10,
            snapshot: {
              lines: [
                {
                  id: "nonsingle_ln",
                  modeLabel: "单关",
                  multiple: 1,
                  legs: [
                    {
                      matchId: "auth_closed_had",
                      poolCode: "HHAD",
                      optionKey: "h",
                      odds: 2.1,
                    },
                  ],
                },
              ],
            },
          },
          { authoritativeMatches: [closedHadAuthMatch] }
        )
      );

      // 4. 2-click anti-tilt bypass blocked: settle as lost -> reset to pending -> delete STILL locks daily quota!
      const lostEntryId = forgedAdd.entry.id;
      ldg.mutateUserLedger(uid, {
        action: "settle-entry",
        entryId: lostEntryId,
        status: "lost",
      });
      ldg.mutateUserLedger(uid, {
        action: "settle-entry",
        entryId: lostEntryId,
        status: "pending",
      });
      const delAfterReset = ldg.mutateUserLedger(uid, {
        action: "delete-entry",
        entryId: lostEntryId,
      });
      assert.equal(delAfterReset.lockedStopLossStake, 50);
      assert.equal(delAfterReset.ledger.dailyLiveSpent, 50);

      // 5. Paper partial -> manual "won" without settledReturn transitions cleanly to "won"
      const paperEntry = ldg.mutateUserLedger(uid, {
        action: "add-entry",
        kind: "paper",
        title: "模拟部分回血转命中",
        modeLabel: "2串1",
        betCount: 2,
        cost: 0,
        paperRefCost: 40,
        minPayout: 25,
        maxPayout: 80,
      });
      ldg.mutateUserLedger(uid, {
        action: "settle-entry",
        entryId: paperEntry.entry.id,
        status: "partial",
        settledReturn: 25,
      });
      const paperToWon = ldg.mutateUserLedger(uid, {
        action: "settle-entry",
        entryId: paperEntry.entry.id,
        status: "won",
      });
      assert.equal(paperToWon.entry.status, "won");

      // 6. simVoidFirstMatch: true in BetSlipController MUST still seal raw print-time odds (NOT 1.0!)
      const ctrl = createBetSlipController({
        debounceMs: 0,
        computeWorkspace: async (params) =>
          evaluateQuantWorkspace(params, FALLBACK_MATCHES),
      });
      ctrl.initializeMatches(
        FALLBACK_MATCHES,
        [],
        evaluateQuantWorkspace({ picks: [], multiple: 1 }, FALLBACK_MATCHES)
      );
      const [cm1, cm2] = ctrl.getState().matches;
      ctrl.togglePick(cm1, "HAD", "h");
      ctrl.togglePick(cm2, "HAD", "h");
      ctrl.setSimVoidFirstMatch(true);
      await ctrl.flush();
      const draftUnderVoidSim = ctrl.buildSealedLedgerDraft();
      assert.ok(draftUnderVoidSim?.snapshot);
      const sealedFirstLegOdds =
        draftUnderVoidSim?.snapshot?.lines[0]?.legs.find(
          (l) => l.matchId === cm1.id
        )?.odds;
      assert.equal(sealedFirstLegOdds, cm1.pools.HAD.options[0].odds);
      assert.notEqual(sealedFirstLegOdds, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
