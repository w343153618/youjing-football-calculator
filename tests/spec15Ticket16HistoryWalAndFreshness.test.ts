import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import {
  fetchOfficialMatchResultsServer,
  fetchOfficialMatchesServer,
} from "../server/sportteryFeed.mjs";
import {
  createSportteryHistoryCoordinator,
  parseBeijingDateTimeMs,
} from "../server/history/historyCoordinator.mjs";
import { runHistoryCtlCli } from "../scripts/history-ctl.mjs";
import { buildMatchRadarBoardFreshnessBanner } from "../src/mobile/cabins/cabinViewModels.ts";
import { createWorkbenchController } from "../src/workspace/workbenchController.ts";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("Spec #15 · Ticket #16: Sporttery Single-Writer WAL History Collector, 4-Tier Backfill & Board Freshness", () => {
  it("Slice 1 (4-Endpoint Normalization, Official IDs, CRS Negative-Key Alias, wbsjStats Hard Block & matchDate+3d Embargo): preserves official IDs on live MatchItem, normalizes s-1sh/d/a CRS aliases, strips wbsjStats, keeps empty HAD unknown, and enforces matchDate+3d embargo", async () => {
    const tmpDir = makeTempDir("yj-spec15-t16-s1-");
    let nowMs = parseBeijingDateTimeMs("2026-11-23", "10:00:00")!;

    try {
      // 1. Live calculator parser preserves leagueId, homeTeamId, awayTeamId, kickoffDateTime
      const liveRaw = {
        value: {
          lastUpdateTime: "2026-11-23 09:58:00",
          matchInfoList: [
            {
              subMatchList: [
                {
                  matchId: 2050001,
                  matchNumStr: "周一001",
                  matchDate: "2026-11-23",
                  matchTime: "20:00:00",
                  businessDate: "2026-11-23",
                  leagueId: 88,
                  leagueAbbName: "亚冠精英",
                  homeTeamId: 10501,
                  homeTeamAbbName: "横滨水手",
                  awayTeamId: 10502,
                  awayTeamAbbName: "浦项制铁",
                  poolList: [
                    {
                      poolCode: "HAD",
                      poolStatus: "Selling",
                      bettingSingle: 1,
                      bettingAllup: 1,
                    },
                    {
                      poolCode: "HHAD",
                      poolStatus: "Selling",
                      bettingSingle: 0,
                      bettingAllup: 1,
                    },
                    {
                      poolCode: "TTG",
                      poolStatus: "Selling",
                      bettingSingle: 1,
                      bettingAllup: 1,
                    },
                    {
                      poolCode: "HAFU",
                      poolStatus: "Selling",
                      bettingSingle: 1,
                      bettingAllup: 1,
                    },
                    {
                      poolCode: "CRS",
                      poolStatus: "Selling",
                      bettingSingle: 1,
                      bettingAllup: 1,
                    },
                  ],
                  had: {
                    h: "1.82",
                    d: "3.55",
                    a: "3.45",
                    hf: "-1",
                    df: "0",
                    af: "1",
                    updateDate: "2026-11-23",
                    updateTime: "09:55:00",
                  },
                  hhad: {
                    goalLine: "-1",
                    h: "3.30",
                    d: "3.65",
                    a: "1.80",
                    updateDate: "2026-11-23",
                    updateTime: "09:55:00",
                  },
                  ttg: {
                    s0: "13.00",
                    s1: "5.20",
                    s2: "3.60",
                    s3: "3.55",
                    s4: "4.80",
                    s5: "8.20",
                    s6: "15.00",
                    s7: "22.00",
                    updateDate: "2026-11-23",
                    updateTime: "09:55:00",
                  },
                  hafu: {
                    hh: "2.75",
                    hd: "13.00",
                    ha: "28.00",
                    dh: "4.80",
                    dd: "5.80",
                    da: "8.20",
                    ah: "21.00",
                    ad: "13.00",
                    aa: "5.60",
                    updateDate: "2026-11-23",
                    updateTime: "09:55:00",
                  },
                  crs: {
                    s01s00: "7.50",
                    s02s01: "7.20",
                    s01s01: "6.80",
                    s00s01: "11.00",
                    s1sh: "18.00",
                    s1sd: "90.00",
                    s1sa: "45.00",
                    updateDate: "2026-11-23",
                    updateTime: "09:55:00",
                  },
                },
              ],
            },
          ],
        },
      };

      const parsedLive = parseSportteryRawJson(liveRaw);
      assert.equal(parsedLive.length, 1);
      assert.equal(parsedLive[0].id, "2050001");
      assert.equal(parsedLive[0].leagueId, "88");
      assert.equal(parsedLive[0].homeTeamId, "10501");
      assert.equal(parsedLive[0].awayTeamId, "10502");
      assert.equal(parsedLive[0].kickoffDateTime, "2026-11-23 20:00:00");

      // 2. Coordinator ingests FixedBonus (with s-1sh/d/a CRS aliases), MatchHead (with wbsjStats), and UniformMatchResult (valid h/d/a vs empty "", and matchDate+3d embargo)
      const fetchFn = async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
          const mid = u.searchParams.get("matchId");
          assert.equal(mid, "2050001");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                isCancel: 0,
                oddsHistory: {
                  matchId: 2050001,
                  leagueId: 88,
                  leagueAbbName: "亚冠精英",
                  homeTeamId: 10501,
                  homeTeamAbbName: "横滨水手",
                  awayTeamId: 10502,
                  awayTeamAbbName: "浦项制铁",
                  hadList: [
                    {
                      h: "1.95",
                      d: "3.45",
                      a: "3.20",
                      hf: "0",
                      df: "0",
                      af: "0",
                      updateDate: "2026-11-22",
                      updateTime: "14:00:00",
                    },
                  ],
                  crsList: [
                    {
                      s01s00: "8.00",
                      "s-1sh": "21.00",
                      "s-1shf": "-1",
                      "s-1sd": "100.00",
                      "s-1sdf": "0",
                      "s-1sa": "50.00",
                      "s-1saf": "1",
                      updateDate: "2026-11-22",
                      updateTime: "14:00:00",
                    },
                  ],
                },
              },
            }),
          };
        }
        if (u.pathname.endsWith("/getMatchHeadV1.qry")) {
          const smid = u.searchParams.get("sportteryMatchId");
          assert.equal(smid, "2050001");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                sportteryMatchId: 2050001,
                sportteryTournamentId: 88,
                sportteryHomeTeamId: 10501,
                sportteryAwayTeamId: 10502,
                // Non-sporttery vendor IDs must NEVER override sporttery* identity keys
                matchId: 9999999,
                homeTeamId: 777777,
                awayTeamId: 666666,
                matchDateTime: "2026-11-23 20:00:00",
                seasonId: "2026",
                seasonName: "2026/2027",
                phaseName: "联赛阶段",
                wbsjStats: {
                  homeGoalsAvg: 2.3,
                  awayGoalsAvg: 1.4,
                  futureLeakSecret: "MUST_NEVER_PERSIST",
                },
              },
            }),
          };
        }
        if (u.pathname.endsWith("/getUniformMatchResultV1.qry")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                total: 2,
                pages: 1,
                matchResult: [
                  {
                    matchId: 2049001,
                    matchNumStr: "周六001",
                    matchDate: "2026-11-21", // Only +2 days ago vs 2026-11-23 -> still inside matchDate + 3d embargo!
                    leagueId: 88,
                    leagueNameAbbr: "亚冠精英",
                    homeTeamId: 10501,
                    homeTeam: "横滨水手",
                    awayTeamId: 10509,
                    awayTeam: "川崎前锋",
                    h: "2.05",
                    d: "3.40",
                    a: "2.95",
                    goalLine: "-1",
                    matchResultStatus: "2",
                    poolStatus: "Payout",
                    sectionsNo1: "1:0",
                    sectionsNo999: "2:1",
                  },
                  {
                    matchId: 2048002,
                    matchNumStr: "周二005",
                    matchDate: "2026-11-18", // +5 days ago -> past matchDate + 3d embargo, but HAD h/d/a empty!
                    leagueId: 88,
                    leagueNameAbbr: "亚冠精英",
                    homeTeamId: 10502,
                    homeTeam: "浦项制铁",
                    awayTeamId: 10508,
                    awayTeam: "蔚山HD",
                    h: "",
                    d: "",
                    a: "",
                    goalLine: "+1",
                    matchResultStatus: "2",
                    poolStatus: "Payout",
                    sectionsNo1: "0:0",
                    sectionsNo999: "1:0",
                  },
                ],
              },
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const coordinator = createSportteryHistoryCoordinator({
        dataDir: tmpDir,
        enableCollector: true,
        autoPoll: false,
        fetchFn,
        nowFn: () => nowMs,
      });

      await coordinator.start();
      await coordinator.backfillResultsWindow({
        beginDate: "2026-11-15",
        endDate: "2026-11-22",
      });
      await coordinator.backfillMatchOpeningQuotes("2050001");
      await coordinator.backfillMatchHead("2050001");

      const snap = coordinator.getSnapshot();
      assert.ok(snap.seq >= 1);

      // CRS negative-key normalization check: s-1sh/s-1sd/s-1sa -> s1sh/s1sd/s1sa
      const crsSeg = snap.getPoolSegmentFrames("2050001", "CRS", "");
      assert.ok(crsSeg, "Expected CRS segment for 2050001");
      assert.equal(crsSeg.hasOfficialArchiveOpen, true);
      assert.equal(crsSeg.openFrame.options.s1sh.odds, 21.0);
      assert.equal(crsSeg.openFrame.options.s1sh.trend, -1);
      assert.equal(crsSeg.openFrame.options.s1sd.odds, 100.0);
      assert.equal(crsSeg.openFrame.options.s1sd.trend, 0);
      assert.equal(crsSeg.openFrame.options.s1sa.odds, 50.0);
      assert.equal(crsSeg.openFrame.options.s1sa.trend, 1);
      assert.equal("s-1sh" in crsSeg.openFrame.options, false);
      assert.equal("s-1sd" in crsSeg.openFrame.options, false);
      assert.equal("s-1sa" in crsSeg.openFrame.options, false);

      // Head metadata strictly uses sporttery* keys and strips wbsjStats
      const meta = snap.getMatchMeta("2050001");
      assert.ok(meta);
      assert.equal(meta.matchId, "2050001");
      assert.equal(meta.leagueId, "88");
      assert.equal(meta.homeTeamId, "10501");
      assert.equal(meta.awayTeamId, "10502");
      assert.equal(meta.kickoffDateTime, "2026-11-23 20:00:00");
      assert.equal(meta.seasonId, "2026");
      assert.equal(meta.seasonName, "2026/2027");
      assert.equal(meta.phaseName, "联赛阶段");
      assert.equal("wbsjStats" in meta, false);
      assert.equal(JSON.stringify(snap).includes("MUST_NEVER_PERSIST"), false);

      // Check on-disk files in tmpDir also contain zero wbsjStats leak
      await coordinator.dispose();
      const walkAllFiles = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
          const p = path.join(dir, ent.name);
          return ent.isDirectory() ? walkAllFiles(p) : [p];
        });
      for (const f of walkAllFiles(tmpDir)) {
        const rawBytes = fs.readFileSync(f);
        assert.equal(
          rawBytes.includes(Buffer.from("wbsjStats")),
          false,
          `wbsjStats must never be written to disk file ${f}`
        );
        assert.equal(
          rawBytes.includes(Buffer.from("MUST_NEVER_PERSIST")),
          false
        );
      }

      // Uniform results: closingHadProxy vs unknown empty "", plus matchDate + 3d embargo
      const resValidHad = snap.resultsRecordsById.get("2049001");
      const resEmptyHad = snap.resultsRecordsById.get("2048002");
      assert.ok(resValidHad);
      assert.deepEqual(resValidHad.closingHadProxy, {
        h: 2.05,
        d: 3.4,
        a: 2.95,
        isArchiveProxy: true,
      });
      assert.ok(resEmptyHad);
      assert.equal(
        resEmptyHad.closingHadProxy,
        null,
        "Empty h/d/a must remain unknown (null), never fabricated"
      );

      // Settlement Map remains 100% compatible with ledgerManager (immediate settlement ignores statistical embargo)
      assert.equal(snap.resultsById.get("2049001")?.settled, true);
      assert.equal(snap.resultsById.get("2049001")?.fullScore, "2:1");
      assert.equal(snap.resultsById.get("2048002")?.settled, true);
      assert.equal(snap.resultsById.get("2048002")?.fullScore, "1:0");

      // Statistical/calibration embargo (matchDate + 3 days when cold-start lacks publish timestamp):
      // At 2026-11-23 10:00, 2049001 (matchDate 2026-11-21 -> embargoUntil 2026-11-24 00:00) IS embargoed!
      assert.equal(
        snap.isResultStatisticallyUnembargoed("2049001", nowMs),
        false
      );
      // At 2026-11-24 00:01 (+3d passed), 2049001 becomes unembargoed!
      const after3dMs = parseBeijingDateTimeMs("2026-11-24", "00:01:00")!;
      assert.equal(
        snap.isResultStatisticallyUnembargoed("2049001", after3dMs),
        true
      );
      // 2048002 (matchDate 2026-11-18 -> +5d ago) is already unembargoed at nowMs,
      // BUT lacks pre-kickoff HAD quote so getTeamRecent90dLedger excludes incomplete-quote matches!
      assert.equal(
        snap.isResultStatisticallyUnembargoed("2048002", nowMs),
        true
      );
      assert.equal(
        snap.getTeamRecent90dLedger("10501", nowMs).length,
        0,
        "Embargoed match 2049001 must not enter 90d objective ledger before matchDate + 3d"
      );
      assert.equal(
        snap.getTeamRecent90dLedger("10501", after3dMs).length,
        1,
        "Once matchDate + 3d passes, 2049001 with valid HAD proxy enters 90d objective ledger"
      );
      assert.equal(
        snap.getTeamRecent90dLedger("10502", after3dMs).length,
        0,
        "Match 2048002 with missing HAD quotes must not enter 90d objective ledger"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 2 (<=60d Windowing, >3-Page Full Pagination, Partial-Page Retry Cursor & Non-Corrupting Results Cache): splits >60d ranges into <=60d windows, iterates 5 pages, keeps window partial on page-2 error or count mismatch, resumes cleanly, and prevents partial cache corruption in fetchOfficialMatchResultsServer", async () => {
    const tmpDir = makeTempDir("yj-spec15-t16-s2-");
    const nowMs = parseBeijingDateTimeMs("2026-11-23", "12:00:00")!;

    try {
      const observedWindows: Array<{
        begin: string;
        end: string;
        pageNo: number;
      }> = [];
      let failPage2Once = true;
      let injectCountMismatch = false;

      // Build 5 pages (2 items per page = 10 unique matches) for the first <=60d window, and 1 page (1 match) for subsequent windows
      const makeMatchRow = (idNum: number, dateStr: string) => ({
        matchId: idNum,
        matchNumStr: `周六${String(idNum).slice(-3)}`,
        matchDate: dateStr,
        leagueId: 91,
        leagueNameAbbr: "英超",
        homeTeamId: 2001,
        homeTeam: "阿森纳",
        awayTeamId: 2002,
        awayTeam: "切尔西",
        h: "1.90",
        d: "3.45",
        a: "3.30",
        goalLine: "-1",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "1:0",
        sectionsNo999: "2:0",
      });

      const fetchFn = async (url: string) => {
        const u = new URL(url);
        const begin = u.searchParams.get("matchBeginDate")!;
        const end = u.searchParams.get("matchEndDate")!;
        const pageNo = Number(u.searchParams.get("pageNo") || "1");
        observedWindows.push({ begin, end, pageNo });

        const beginMs = parseBeijingDateTimeMs(begin, "00:00:00")!;
        const endMs = parseBeijingDateTimeMs(end, "00:00:00")!;
        const inclusiveSpanDays =
          Math.round((endMs - beginMs) / 86_400_000) + 1;
        assert.ok(
          inclusiveSpanDays <= 60,
          `Query span ${begin}..${end} (${inclusiveSpanDays}d) exceeded 60 calendar days!`
        );

        // First window starts at 2026-07-01
        if (begin === "2026-07-01") {
          if (pageNo === 2 && failPage2Once) {
            failPage2Once = false;
            throw new Error("Simulated upstream gateway 504 timeout on page 2");
          }
          const baseId = 2100000 + (pageNo - 1) * 2;
          const rows = [
            makeMatchRow(baseId + 1, "2026-07-10"),
            // When injectCountMismatch=true on page 5, duplicate matchId so unique count = 9 !== total(10)
            makeMatchRow(
              injectCountMismatch && pageNo === 5 ? baseId + 1 : baseId + 2,
              "2026-07-11"
            ),
          ];
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                total: 10,
                pages: 5,
                matchResult: rows,
              },
            }),
          };
        }

        // Remaining windows: 1 page, 1 match
        const winSeed = Number(begin.replace(/-/g, ""));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: {
              total: 1,
              pages: 1,
              matchResult: [makeMatchRow(winSeed, begin)],
            },
          }),
        };
      };

      const coordinator = createSportteryHistoryCoordinator({
        dataDir: tmpDir,
        enableCollector: true,
        autoPoll: false,
        fetchFn,
        nowFn: () => nowMs,
      });
      await coordinator.start();

      // 1. Run 140-day range (splits into 3 windows <= 60d); page 2 fails on first window!
      const firstRun = await coordinator.backfillResultsRange({
        beginDate: "2026-07-01",
        endDate: "2026-11-17",
      });
      assert.equal(firstRun.allCompleted, false);

      let snap = coordinator.getSnapshot();
      const firstWinKey = Object.keys(snap.telemetry.cursors.windows).find(
        (k) => k.startsWith("2026-07-01..")
      )!;
      assert.ok(firstWinKey, "Expected first <=60d window cursor");
      const partialCursor = snap.telemetry.cursors.windows[firstWinKey];
      assert.equal(partialCursor.status, "partial");
      assert.deepEqual(partialCursor.verifiedPages, [1]);
      assert.equal(partialCursor.nextRetryPage, 2);
      // Page 1 matches are already persisted, page 5 match is not yet present
      assert.equal(snap.resultsById.has("2100001"), true);
      assert.equal(snap.resultsById.has("2100010"), false);

      // 2. Resume with count mismatch injected on page 5 -> still MUST NOT mark window completed!
      injectCountMismatch = true;
      const mismatchRun = await coordinator.backfillResultsRange({
        beginDate: "2026-07-01",
        endDate: "2026-11-17",
      });
      assert.equal(mismatchRun.allCompleted, false);
      snap = coordinator.getSnapshot();
      assert.equal(
        snap.telemetry.cursors.windows[firstWinKey].status,
        "partial",
        "Window must stay partial when unique matchId count (9) !== total (10)"
      );

      // 3. Clear mismatch and retry -> reconciles all 5 pages & 10 unique IDs and marks window completed!
      injectCountMismatch = false;
      const cleanRun = await coordinator.backfillResultsRange({
        beginDate: "2026-07-01",
        endDate: "2026-11-17",
      });
      assert.equal(cleanRun.allCompleted, true);
      snap = coordinator.getSnapshot();
      assert.equal(
        snap.telemetry.cursors.windows[firstWinKey].status,
        "completed"
      );
      assert.equal(
        snap.telemetry.cursors.windows[firstWinKey].uniqueMatchCount,
        10
      );
      // Page 5 match (2100010) is now present!
      assert.equal(snap.resultsById.get("2100010")?.settled, true);
      await coordinator.dispose();

      // 4. Direct fetchOfficialMatchResultsServer check:
      // (a) Pre-seed intact cache file with match "9900001"
      const resultsCacheFile = path.join(
        tmpDir,
        "sporttery-results-cache.json"
      );
      fs.writeFileSync(
        resultsCacheFile,
        JSON.stringify([
          {
            matchId: "9900001",
            matchNumStr: "周日099",
            home: "利物浦",
            away: "曼城",
            matchDate: "2026-11-20",
            settled: true,
            isVoid: false,
            halfScore: "1:1",
            fullScore: "2:1",
            h1: 1,
            a1: 1,
            h2: 2,
            a2: 1,
          },
        ]),
        "utf8"
      );

      // Simulate 5-page feed failing on page 2 -> MUST NOT overwrite resultsCacheFile with page-1-only partial rows!
      let feedFailPage2 = true;
      const feedFetch = async (url: string) => {
        const u = new URL(url);
        const pageNo = Number(u.searchParams.get("pageNo") || "1");
        if (pageNo === 2 && feedFailPage2) {
          return { ok: false, status: 502, json: async () => ({}) };
        }
        const baseId = 3200000 + (pageNo - 1) * 2;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: {
              total: 10,
              pages: 5,
              matchResult: [
                makeMatchRow(baseId + 1, "2026-11-20"),
                makeMatchRow(baseId + 2, "2026-11-20"),
              ],
            },
          }),
        };
      };

      const degradedMap = await fetchOfficialMatchResultsServer({
        nowMs,
        beginDate: "2026-11-10",
        endDate: "2026-11-22",
        forceRefresh: true,
        cacheFilePath: resultsCacheFile,
        fetchFn: feedFetch,
      });
      // Intact disk cache item 9900001 is preserved on disk and returned!
      const persistedOnFailure = JSON.parse(
        fs.readFileSync(resultsCacheFile, "utf8")
      );
      assert.equal(persistedOnFailure.length, 1);
      assert.equal(persistedOnFailure[0].matchId, "9900001");
      assert.equal(degradedMap.get("9900001")?.settled, true);

      // Now let all 5 pages succeed -> fetches beyond old 3-page limit (page 5 match 3200010)!
      feedFailPage2 = false;
      const fullMap = await fetchOfficialMatchResultsServer({
        nowMs: nowMs + 1000,
        beginDate: "2026-11-10",
        endDate: "2026-11-22",
        forceRefresh: true,
        cacheFilePath: resultsCacheFile,
        fetchFn: feedFetch,
      });
      assert.equal(fullMap.size, 10);
      assert.equal(
        fullMap.get("3200010")?.settled,
        true,
        "Page 5 match 3200010 must be fetched without 3-page truncation"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 3 (Dual Clocks Anti-Stale-Overwrite, Event-Only Dedup, Consecutive Valid Board Absence vs Fallback Isolation, 90-120d Priority Queue & On-Demand ID Tagging): deduplicates identical live polls, prevents stale async backfill from overwriting newer live frames, isolates empty/timeout fallback from pool absence events, and tags older on-demand lookups as backfilled", async () => {
    const tmpDir = makeTempDir("yj-spec15-t16-s3-");
    let nowMs = parseBeijingDateTimeMs("2026-11-23", "10:30:00")!;

    const buildLivePayload = (
      hadH: string,
      updateTime: string,
      crsSelling = 1
    ) => ({
      value: {
        lastUpdateTime: `2026-11-23 ${updateTime}`,
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: 2060001,
                matchNumStr: "周一006",
                matchDate: "2026-11-23",
                matchTime: "21:30:00",
                businessDate: "2026-11-23",
                leagueId: 91,
                leagueAbbName: "英超",
                homeTeamId: 3001,
                homeTeamAbbName: "曼联",
                awayTeamId: 3002,
                awayTeamAbbName: "热刺",
                poolList: [
                  {
                    poolCode: "HAD",
                    poolStatus: "Selling",
                    bettingSingle: 1,
                    bettingAllup: 1,
                  },
                  {
                    poolCode: "HHAD",
                    poolStatus: "Selling",
                    bettingSingle: 0,
                    bettingAllup: 1,
                  },
                  {
                    poolCode: "TTG",
                    poolStatus: "Selling",
                    bettingSingle: 1,
                    bettingAllup: 1,
                  },
                  {
                    poolCode: "HAFU",
                    poolStatus: "Selling",
                    bettingSingle: 1,
                    bettingAllup: 1,
                  },
                  {
                    poolCode: "CRS",
                    poolStatus: crsSelling ? "Selling" : "Close",
                    bettingSingle: crsSelling,
                    bettingAllup: crsSelling,
                  },
                ],
                had: {
                  h: hadH,
                  d: "3.50",
                  a: "3.60",
                  hf: "-1",
                  df: "0",
                  af: "1",
                  updateDate: "2026-11-23",
                  updateTime,
                },
                hhad: {
                  goalLine: "-1",
                  h: "3.15",
                  d: "3.60",
                  a: "1.85",
                  updateDate: "2026-11-23",
                  updateTime,
                },
                ttg: {
                  s0: "12.00",
                  s1: "5.00",
                  s2: "3.50",
                  s3: "3.60",
                  s4: "4.90",
                  s5: "8.50",
                  s6: "15.00",
                  s7: "22.00",
                  updateDate: "2026-11-23",
                  updateTime,
                },
                hafu: {
                  hh: "2.70",
                  hd: "13.00",
                  ha: "26.00",
                  dh: "4.70",
                  dd: "5.60",
                  da: "8.00",
                  ah: "21.00",
                  ad: "13.00",
                  aa: "5.80",
                  updateDate: "2026-11-23",
                  updateTime,
                },
                crs: {
                  s01s00: "7.20",
                  s02s01: "7.00",
                  s01s01: "6.60",
                  s1sh: "18.00",
                  s1sd: "85.00",
                  s1sa: "45.00",
                  updateDate: "2026-11-23",
                  updateTime,
                },
              },
            ],
          },
        ],
      },
    });

    try {
      const fetchFn = async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
          const mid = u.searchParams.get("matchId");
          if (mid === "2060001") {
            // Contains opening frame (2026-11-22 12:00, h=1.98) AND stale archive tail (2026-11-23 10:15, h=1.84)
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  oddsHistory: {
                    matchId: 2060001,
                    leagueId: 91,
                    homeTeamId: 3001,
                    awayTeamId: 3002,
                    hadList: [
                      {
                        h: "1.98",
                        d: "3.40",
                        a: "3.20",
                        hf: "0",
                        df: "0",
                        af: "0",
                        updateDate: "2026-11-22",
                        updateTime: "12:00:00",
                      },
                      {
                        h: "1.84",
                        d: "3.48",
                        a: "3.45",
                        hf: "-1",
                        df: "1",
                        af: "1",
                        updateDate: "2026-11-23",
                        updateTime: "10:15:00",
                      },
                    ],
                  },
                },
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                oddsHistory: {
                  matchId: Number(mid),
                  leagueId: 91,
                  homeTeamId: 3001,
                  awayTeamId: 3099,
                  hadList: [
                    {
                      h: "2.10",
                      d: "3.30",
                      a: "2.95",
                      updateDate: "2026-05-01",
                      updateTime: "15:00:00",
                    },
                  ],
                },
              },
            }),
          };
        }
        if (u.pathname.endsWith("/getMatchHeadV1.qry")) {
          const smid = u.searchParams.get("sportteryMatchId");
          const dt =
            smid === "2010099" ? "2026-05-02 19:30:00" : "2026-10-15 20:00:00";
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                sportteryMatchId: Number(smid),
                sportteryTournamentId: 91,
                sportteryHomeTeamId: 3001,
                sportteryAwayTeamId: 3099,
                matchDateTime: dt,
                seasonId: "2026",
                seasonName: "2026",
              },
            }),
          };
        }
        if (u.pathname.endsWith("/getUniformMatchResultV1.qry")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                total: 2,
                pages: 1,
                matchResult: [
                  {
                    // Within 90-120d priority queue (2026-10-15 vs 2026-11-23 = 39 days ago)
                    matchId: 2055010,
                    matchNumStr: "周四002",
                    matchDate: "2026-10-15",
                    leagueId: 91,
                    leagueNameAbbr: "英超",
                    homeTeamId: 3001,
                    homeTeam: "曼联",
                    awayTeamId: 3099,
                    awayTeam: "埃弗顿",
                    h: "1.85",
                    d: "3.45",
                    a: "3.50",
                    matchResultStatus: "2",
                    poolStatus: "Payout",
                    sectionsNo1: "1:0",
                    sectionsNo999: "2:0",
                  },
                  {
                    // Older than 120d (2026-05-02 vs 2026-11-23 = ~205 days ago -> NOT auto-queued in 90-120d priority queue!)
                    matchId: 2010099,
                    matchNumStr: "周六018",
                    matchDate: "2026-05-02",
                    leagueId: 91,
                    leagueNameAbbr: "英超",
                    homeTeamId: 3001,
                    homeTeam: "曼联",
                    awayTeamId: 3099,
                    awayTeam: "埃弗顿",
                    h: "2.10",
                    d: "3.30",
                    a: "2.95",
                    matchResultStatus: "2",
                    poolStatus: "Payout",
                    sectionsNo1: "0:0",
                    sectionsNo999: "1:1",
                  },
                ],
              },
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      };

      const coordinator = createSportteryHistoryCoordinator({
        dataDir: tmpDir,
        enableCollector: true,
        autoPoll: false,
        fetchFn,
        nowFn: () => nowMs,
      });
      await coordinator.start();

      // 1. Live poll #1 at 10:30 (HAD.h = 1.72, updateTime = 10:28:00)
      const live1Raw = buildLivePayload("1.72", "10:28:00", 1);
      const live1Matches = parseSportteryRawJson(live1Raw);
      await coordinator.ingestLiveBoard({
        matches: live1Matches,
        rawJson: live1Raw,
        boardMeta: {
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: nowMs,
          lastValidBoardClock: "11-23 10:30",
          isFallbackReadOnly: false,
          bannerText: null,
        },
      });

      // 2. Live poll #2 at 10:32 with IDENTICAL quote state -> must NOT duplicate event row, only update lastLocallySeenAt & sampling coverage!
      nowMs = parseBeijingDateTimeMs("2026-11-23", "10:32:00")!;
      await coordinator.ingestLiveBoard({
        matches: live1Matches,
        rawJson: live1Raw,
        boardMeta: {
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: nowMs,
          lastValidBoardClock: "11-23 10:32",
          isFallbackReadOnly: false,
          bannerText: null,
        },
      });

      let snap = coordinator.getSnapshot();
      const hadBeforeBackfill = snap.getPoolSegmentFrames("2060001", "HAD", "");
      assert.equal(
        hadBeforeBackfill.frameCount,
        1,
        "Identical repeat poll must NOT insert duplicate quote event"
      );
      assert.equal(hadBeforeBackfill.latestFrame.pollCount, 2);
      assert.equal(hadBeforeBackfill.latestFrame.lastLocallySeenAt, nowMs);
      assert.equal(snap.telemetry.samplingIntervals.length, 1);
      assert.equal(snap.telemetry.samplingIntervals[0].pollCount, 2);
      assert.ok(
        snap.telemetry.cursors.pendingOpenQuoteIds.includes("2060001"),
        "New live match 2060001 must be queued for async opening quote backfill"
      );

      // 3. Async opening-quote backfill runs at 10:35 -> inserts 12:00 opening (1.98) & 10:15 intermediate (1.84), while keeping 10:28 live (1.72) as latestFrame!
      nowMs = parseBeijingDateTimeMs("2026-11-23", "10:35:00")!;
      await coordinator.drainPendingOpenQuotes();
      snap = coordinator.getSnapshot();
      const hadAfterBackfill = snap.getPoolSegmentFrames("2060001", "HAD", "");
      assert.equal(hadAfterBackfill.hasOfficialArchiveOpen, true);
      assert.equal(hadAfterBackfill.frameCount, 3);
      assert.equal(hadAfterBackfill.openFrame.options.h.odds, 1.98);
      assert.equal(hadAfterBackfill.prevFrame.options.h.odds, 1.84);
      assert.equal(
        hadAfterBackfill.latestFrame.options.h.odds,
        1.72,
        "Stale async backfill frame (10:15, 1.84) must NEVER overwrite newer live frame (10:28, 1.72)"
      );
      assert.equal(hadAfterBackfill.latestFrame.frameOrigin, "live-poll");
      assert.equal(
        snap.getMatchMeta("2060001")?.observationOrigin,
        "live-observed",
        "Async opening quote backfill must preserve live-observed origin on live match"
      );

      // 4. Empty-board / timeout fallback at 10:38 -> MUST NOT generate pool absence intervals!
      nowMs = parseBeijingDateTimeMs("2026-11-23", "10:38:00")!;
      await coordinator.ingestLiveBoard({
        matches: live1Matches,
        boardMeta: {
          source: "cached-snapshot",
          boardState: "empty-board-fallback",
          lastValidBoardAt: parseBeijingDateTimeMs("2026-11-23", "10:32:00"),
          lastValidBoardClock: "11-23 10:32",
          isFallbackReadOnly: true,
          bannerText:
            "上次有效报价（采集于 11-23 10:32）· 官方盘面暂空/回退只读参考",
        },
      });
      snap = coordinator.getSnapshot();
      assert.equal(snap.boardMeta.boardState, "empty-board-fallback");
      assert.equal(snap.boardMeta.isFallbackReadOnly, true);
      assert.equal(
        snap.telemetry.naturalMissingPoolIntervals.length,
        0,
        "Empty-board fallback must NOT generate pool suspension/absence events"
      );

      // 5. Next verified fresh board at 10:42 where CRS is closed -> records (lastSeenSellingAt=10:32, firstAbsentAfterLastSeenAt=10:42]
      const prevValidAt = parseBeijingDateTimeMs("2026-11-23", "10:32:00")!;
      nowMs = parseBeijingDateTimeMs("2026-11-23", "10:42:00")!;
      const liveClosedCrsRaw = buildLivePayload("1.70", "10:41:00", 0);
      await coordinator.ingestLiveBoard({
        matches: parseSportteryRawJson(liveClosedCrsRaw),
        rawJson: liveClosedCrsRaw,
        boardMeta: {
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: nowMs,
          lastValidBoardClock: "11-23 10:42",
          isFallbackReadOnly: false,
          bannerText: null,
        },
      });
      snap = coordinator.getSnapshot();
      const crsAbsence = snap.telemetry.naturalMissingPoolIntervals.find(
        (x: any) => x.matchId === "2060001" && x.poolCode === "CRS"
      );
      assert.ok(
        crsAbsence,
        "Verified fresh board with closed CRS must record absence interval"
      );
      assert.equal(crsAbsence.lastSeenSellingAt, prevValidAt);
      assert.equal(crsAbsence.firstAbsentAfterLastSeenAt, nowMs);

      // 6. 90-120d priority detail queue vs >120d on-demand lookup tagging
      await coordinator.backfillResultsWindow({
        beginDate: "2026-10-01",
        endDate: "2026-11-22",
      });
      await coordinator.backfillResultsWindow({
        beginDate: "2026-04-15",
        endDate: "2026-05-15",
      });
      snap = coordinator.getSnapshot();
      assert.equal(
        snap.telemetry.cursors.pendingRecentDetailIds.includes("2055010"),
        true,
        "39-day-old match 2055010 must enter 90-120d priority detail queue"
      );
      assert.equal(
        snap.telemetry.cursors.pendingRecentDetailIds.includes("2010099"),
        false,
        "205-day-old match 2010099 must NOT auto-enter 90-120d priority detail queue"
      );

      await coordinator.drainPendingRecentDetails();
      snap = coordinator.getSnapshot();
      assert.equal(
        snap.getMatchMeta("2055010")?.kickoffDateTime,
        "2026-10-15 20:00:00"
      );
      assert.equal(snap.getMatchMeta("2010099")?.hasHeadDetail, false);

      // Explicit on-demand detail lookup for older match 2010099 marks observationOrigin = "on-demand-id" (isBackfilled = true)
      await coordinator.fetchMatchDetailOnDemand("2010099");
      snap = coordinator.getSnapshot();
      const olderMeta = snap.getMatchMeta("2010099");
      assert.equal(olderMeta?.kickoffDateTime, "2026-05-02 19:30:00");
      assert.equal(olderMeta?.observationOrigin, "on-demand-id");
      const kickoffs = snap.getTeamKickoffHistory("3001", nowMs);
      const olderRef = kickoffs.find((k: any) => k.matchId === "2010099");
      assert.ok(olderRef);
      assert.equal(olderRef.observationOrigin, "on-demand-id");
      assert.equal(olderRef.isBackfilled, true);

      await coordinator.dispose();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 4 (collectorWorker Thread, SQLite WAL vs JSONL Fallback Parity, Verified Atomic Snapshot Swap, Gunzip-Verified .jsonl.gz Cold Archive, Byte Stats, 0700/0600 Perms & Ledger Isolation): runs single-writer in worker_threads, matches SQLite WAL and JSONL snapshots, rejects tampered envelopes, aborts hot prune on gunzip fault, archives >18m/>24m shards safely, and never touches personal ledgers-db.json", async () => {
    const sqliteDir = makeTempDir("yj-spec15-t16-s4-sqlite-");
    const jsonlDir = makeTempDir("yj-spec15-t16-s4-jsonl-");
    const nowMs = parseBeijingDateTimeMs("2026-11-23", "15:00:00")!;

    // Seed a 4-year-old personal dual-track ledger in sqliteDir to prove physical isolation
    const personalLedgerPath = path.join(sqliteDir, "ledgers-db.json");
    const personalLedgerRaw = JSON.stringify({
      u1: {
        dailyLimit: 300,
        entries: [
          {
            id: "old-2022-ticket",
            kind: "live",
            cost: 20,
            createdAt: parseBeijingDateTimeMs("2022-05-01", "18:00:00"),
          },
        ],
      },
    });
    fs.writeFileSync(personalLedgerPath, personalLedgerRaw, { mode: 0o600 });

    const sharedFetchFn = async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
        const mid = u.searchParams.get("matchId");
        // 1900001 is 20 months old (>18m hot quote cutoff -> eligible for cold archive!)
        const isOld20m = mid === "1900001";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: {
              oddsHistory: {
                matchId: Number(mid),
                leagueId: 88,
                homeTeamId: 5001,
                awayTeamId: 5002,
                hadList: [
                  {
                    h: isOld20m ? "2.25" : "1.88",
                    d: "3.35",
                    a: isOld20m ? "2.75" : "3.45",
                    updateDate: isOld20m ? "2025-02-10" : "2026-11-20",
                    updateTime: "14:00:00",
                  },
                ],
              },
            },
          }),
        };
      }
      if (u.pathname.endsWith("/getUniformMatchResultV1.qry")) {
        const begin = u.searchParams.get("matchBeginDate");
        // 26-month-old result (>24m result index cutoff) vs recent result
        const isOld26m = begin?.startsWith("2024-");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: {
              total: 1,
              pages: 1,
              matchResult: [
                isOld26m
                  ? {
                      matchId: 1800001,
                      matchNumStr: "周六009",
                      matchDate: "2024-09-10",
                      leagueId: 88,
                      leagueNameAbbr: "日职",
                      homeTeamId: 5001,
                      homeTeam: "鹿岛鹿角",
                      awayTeamId: 5002,
                      awayTeam: "浦和红钻",
                      h: "2.15",
                      d: "3.30",
                      a: "2.90",
                      matchResultStatus: "2",
                      poolStatus: "Payout",
                      sectionsNo1: "1:0",
                      sectionsNo999: "2:1",
                    }
                  : {
                      matchId: 2070001,
                      matchNumStr: "周五002",
                      matchDate: "2026-11-20",
                      leagueId: 88,
                      leagueNameAbbr: "日职",
                      homeTeamId: 5001,
                      homeTeam: "鹿岛鹿角",
                      awayTeamId: 5002,
                      awayTeam: "浦和红钻",
                      h: "1.88",
                      d: "3.35",
                      a: "3.45",
                      matchResultStatus: "2",
                      poolStatus: "Payout",
                      sectionsNo1: "0:0",
                      sectionsNo999: "1:0",
                    },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    let sqliteCoord: any = null;
    let jsonlCoord: any = null;

    try {
      // 1. Run identical sequence on SQLite WAL worker AND JSONL fallback worker (simulating unavailable node:sqlite)
      sqliteCoord = createSportteryHistoryCoordinator({
        dataDir: sqliteDir,
        enableCollector: true,
        autoPoll: false,
        storageBackend: "auto",
        fetchFn: sharedFetchFn,
        nowFn: () => nowMs,
      });
      jsonlCoord = createSportteryHistoryCoordinator({
        dataDir: jsonlDir,
        enableCollector: true,
        autoPoll: false,
        storageBackend: "auto",
        simulateSqliteUnavailable: true,
        fetchFn: sharedFetchFn,
        nowFn: () => nowMs,
      });

      await sqliteCoord.start();
      await jsonlCoord.start();

      // Verify real worker_threads background worker ownership
      assert.equal(sqliteCoord.isWorkerRunning, true);
      assert.equal(jsonlCoord.isWorkerRunning, true);
      assert.equal(sqliteCoord.getSnapshot().storageBackend, "sqlite");
      assert.equal(jsonlCoord.getSnapshot().storageBackend, "jsonl");

      for (const coord of [sqliteCoord, jsonlCoord]) {
        await coord.backfillMatchOpeningQuotes("1900001");
        await coord.backfillMatchOpeningQuotes("2070001");
        await coord.backfillResultsWindow({
          beginDate: "2024-09-01",
          endDate: "2024-09-20",
        });
        await coord.backfillResultsWindow({
          beginDate: "2026-11-01",
          endDate: "2026-11-22",
        });
      }

      const sqSnap = sqliteCoord.getSnapshot();
      const jlSnap = jsonlCoord.getSnapshot();
      assert.deepEqual(
        sqSnap.getPoolSegmentFrames("2070001", "HAD", "").openFrame.options,
        jlSnap.getPoolSegmentFrames("2070001", "HAD", "").openFrame.options,
        "SQLite WAL and JSONL fallback must produce identical quote segment snapshots"
      );
      assert.deepEqual(
        sqSnap.resultsById.get("2070001"),
        jlSnap.resultsById.get("2070001"),
        "SQLite WAL and JSONL fallback must produce identical settlement result maps"
      );
      assert.ok(sqSnap.telemetry.storageBytes.hotDbBytes > 0);
      assert.ok(jlSnap.telemetry.storageBytes.hotDbBytes > 0);

      // 2. Verify directory 0700 and file 0600 permissions
      const histDirMode =
        fs.statSync(path.join(sqliteDir, "history")).mode & 0o777;
      const sqliteFileMode =
        fs.statSync(path.join(sqliteDir, "history", "sporttery-history.sqlite"))
          .mode & 0o777;
      assert.equal(histDirMode, 0o700);
      assert.equal(sqliteFileMode, 0o600);

      // 3. Atomic snapshot swap verification gate on main thread:
      // Tampered checksum, stale seq, or invalid schemaVersion MUST be rejected without mutating currentSnapshot
      const validSeq = sqSnap.seq;
      assert.equal(
        sqliteCoord.applySnapshotEnvelope({
          seq: validSeq + 10,
          schemaVersion: sqSnap.schemaVersion,
          generatedAt: nowMs,
          storageBackend: "sqlite",
          checksum: "0000badchecksum",
          payload: { boardMeta: sqSnap.boardMeta },
        }),
        false
      );
      assert.equal(
        sqliteCoord.applySnapshotEnvelope({
          seq: validSeq, // Not strictly greater than current seq!
          schemaVersion: sqSnap.schemaVersion,
          generatedAt: nowMs,
          storageBackend: "sqlite",
          checksum: sqSnap.checksum,
          payload: {},
        }),
        false
      );
      assert.equal(
        sqliteCoord.applySnapshotEnvelope({
          seq: validSeq + 10,
          schemaVersion: 999, // Wrong schema version!
          generatedAt: nowMs,
          storageBackend: "sqlite",
          checksum: sqSnap.checksum,
          payload: {},
        }),
        false
      );
      assert.equal(sqliteCoord.rejectedSwapCount, 3);
      assert.equal(sqliteCoord.getSnapshot().seq, validSeq);

      // 4. Cold archive (.jsonl.gz) gunzip line-by-line verification BEFORE hot prune:
      // (a) Seed a 30-month-old archive shard (< 36m minimum cold retention) to verify it is NEVER deleted
      const existing30mShard = path.join(
        sqliteDir,
        "history",
        "archive",
        "quotes-2024-05.jsonl.gz"
      );
      const zlibMod = await import("node:zlib");
      fs.writeFileSync(
        existing30mShard,
        zlibMod.gzipSync(
          Buffer.from(
            JSON.stringify({
              bucket: "quote_segments",
              key: "1700001|HAD|",
              record: { matchId: "1700001" },
            }) + "\n",
            "utf8"
          )
        ),
        { mode: 0o600 }
      );

      // (b) Inject archive verification failure -> MUST abort hot prune so 1900001 & 1800001 remain in hot DB!
      await assert.rejects(
        () =>
          sqliteCoord.archiveAndPruneHotStorage({
            simulateCorruptArchiveVerify: true,
          }),
        /archive_verify_failed|校验/i
      );
      assert.ok(
        sqliteCoord.getSnapshot().getPoolSegmentFrames("1900001", "HAD", ""),
        "20m-old quote 1900001 must remain in hot snapshot when gunzip verification fails!"
      );
      assert.ok(
        sqliteCoord.getSnapshot().resultsById.has("1800001"),
        "26m-old result 1800001 must remain in hot snapshot when gunzip verification fails!"
      );

      // (c) Run real archive & prune -> verifies .jsonl.gz line-by-line by gunzip, then prunes >18m quotes & >24m results while keeping <18m/<24m hot rows, keeping 30m cold shard (<36m), and leaving personal ledgers-db.json untouched!
      const archRes = await sqliteCoord.archiveAndPruneHotStorage();
      assert.equal(archRes.ok, true);
      assert.equal(archRes.prunedQuoteSegments, 1);
      assert.equal(archRes.prunedResultRecords, 1);

      const postArchSnap = sqliteCoord.getSnapshot();
      assert.equal(
        postArchSnap.getPoolSegmentFrames("1900001", "HAD", ""),
        null,
        ">18m quote segment 1900001 pruned from hot DB after verified cold archive"
      );
      assert.ok(
        postArchSnap.getPoolSegmentFrames("2070001", "HAD", ""),
        "<18m quote segment 2070001 retained in hot DB"
      );
      assert.equal(
        postArchSnap.resultsById.has("1800001"),
        false,
        ">24m result 1800001 pruned from hot result index after verified cold archive"
      );
      assert.equal(
        postArchSnap.resultsById.has("2070001"),
        true,
        "<24m result 2070001 retained in hot result index"
      );
      assert.equal(
        fs.existsSync(existing30mShard),
        true,
        "30-month cold archive shard (<36m) must be retained"
      );
      assert.ok(postArchSnap.telemetry.storageBytes.coldArchiveBytes > 0);

      // Verify all .jsonl.gz shards decompress cleanly line-by-line
      const verifyRes = await sqliteCoord.verifyColdArchives();
      assert.equal(verifyRes.ok, true);
      assert.ok(verifyRes.shardCount >= 3);
      assert.ok(verifyRes.totalVerifiedLines >= 3);

      // Personal dual-track ledger file is 100% untouched!
      assert.equal(
        fs.readFileSync(personalLedgerPath, "utf8"),
        personalLedgerRaw
      );

      await sqliteCoord.dispose();
      await jsonlCoord.dispose();
      assert.equal(sqliteCoord.isWorkerRunning, false);
      assert.equal(jsonlCoord.isWorkerRunning, false);
    } finally {
      await sqliteCoord?.dispose?.();
      await jsonlCoord?.dispose?.();
      fs.rmSync(sqliteDir, { recursive: true, force: true });
      fs.rmSync(jsonlDir, { recursive: true, force: true });
    }
  });

  it("Slice 5 (Runtime Collector Ownership Gate, history-ctl CLI & End-to-End boardMeta Last-Valid-Quote Read-Only Banner): defaults enableHistoryCollector=false, propagates boardMeta across /api/bootstrap, /api/auth/login & /api/quant/sync, drives WorkbenchController + MatchRadarCabin banner, and supports history-ctl CLI commands", async () => {
    const tmpDir = makeTempDir("yj-spec15-t16-s5-");
    let nowMs = parseBeijingDateTimeMs("2026-11-23", "08:30:00")!;
    let runtimeDefault: any = null;
    let runtimeActive: any = null;

    const browserHeaders: Record<string, string> = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept: "application/json,text/plain,*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      "sec-fetch-mode": "cors",
    };

    function makeHttpExchange(opts: {
      method?: string;
      url?: string;
      headers?: Record<string, string>;
      body?: unknown;
    }) {
      const req = new EventEmitter() as any;
      req.method = opts.method || "POST";
      req.url = opts.url || "/";
      req.headers = Object.fromEntries(
        Object.entries({ ...browserHeaders, ...(opts.headers || {}) }).map(
          ([k, v]) => [k.toLowerCase(), v]
        )
      );
      req.socket = { remoteAddress: "198.51.100.88" };
      req.destroy = () => {};
      let statusCode = 200;
      const respHeaders: Record<string, any> = {};
      let rawBody = "";
      const res = {
        get statusCode() {
          return statusCode;
        },
        set statusCode(v: number) {
          statusCode = v;
        },
        headersSent: false,
        setHeader(k: string, v: any) {
          respHeaders[k.toLowerCase()] = v;
        },
        end(chunk = "") {
          this.headersSent = true;
          rawBody += String(chunk);
        },
      };
      queueMicrotask(() => {
        if (opts.body !== undefined) {
          req.emit("data", Buffer.from(JSON.stringify(opts.body)));
        }
        req.emit("end");
      });
      return {
        req,
        res,
        read: () => ({ statusCode, respHeaders, body: rawBody }),
      };
    }

    try {
      // 1. Default createYouJingRuntime spawns ZERO background worker threads!
      runtimeDefault = createYouJingRuntime({
        dataDir: path.join(tmpDir, "default-no-worker"),
        nowFn: () => nowMs,
      });
      assert.equal(runtimeDefault.historyCoordinator.isWorkerRunning, false);
      await runtimeDefault.dispose();

      // 2. fetchOfficialMatchesServer distinguishes fresh live vs empty-board cached fallback vs builtin fallback
      const snapPath = path.join(tmpDir, "feed-snap.json");
      const liveBoardJson = {
        value: {
          lastUpdateTime: "2026-11-23 08:30:00",
          matchInfoList: [
            {
              subMatchList: [
                {
                  matchId: 2080001,
                  matchNumStr: "周一008",
                  matchDate: "2026-11-23",
                  matchTime: "20:00:00",
                  businessDate: "2026-11-23",
                  leagueId: 88,
                  leagueAbbName: "亚冠精英",
                  homeTeamId: 8001,
                  homeTeamAbbName: "神户胜利船",
                  awayTeamId: 8002,
                  awayTeamAbbName: "中央海岸水手",
                  had: {
                    h: "1.42",
                    d: "4.35",
                    a: "5.60",
                    updateDate: "2026-11-23",
                    updateTime: "08:29:00",
                  },
                  hhad: {
                    goalLine: "-1",
                    h: "2.18",
                    d: "3.55",
                    a: "2.62",
                    updateDate: "2026-11-23",
                    updateTime: "08:29:00",
                  },
                },
              ],
            },
          ],
        },
      };

      const freshFeedRes = await fetchOfficialMatchesServer(snapPath, {
        nowFn: () => nowMs,
        fetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => liveBoardJson,
        }),
      });
      assert.equal(freshFeedRes.boardMeta.boardState, "fresh");
      assert.equal(freshFeedRes.boardMeta.isFallbackReadOnly, false);
      assert.equal(freshFeedRes.boardMeta.bannerText, null);
      assert.equal(freshFeedRes.boardMeta.lastValidBoardClock, "11-23 08:30");

      // Advance clock to 08:45; upstream returns empty matchInfoList: [] -> falls back to disk snapshot captured at 08:30!
      const emptyBoardRes = await fetchOfficialMatchesServer(snapPath, {
        nowFn: () => nowMs + 15 * 60_000,
        fetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ value: { matchInfoList: [] } }),
        }),
      });
      assert.equal(emptyBoardRes.source, "cached-snapshot");
      assert.equal(emptyBoardRes.boardMeta.boardState, "empty-board-fallback");
      assert.equal(emptyBoardRes.boardMeta.isFallbackReadOnly, true);
      assert.equal(emptyBoardRes.boardMeta.lastValidBoardClock, "11-23 08:30");
      assert.ok(
        emptyBoardRes.boardMeta.bannerText.includes(
          "上次有效报价（采集于 11-23 08:30）"
        )
      );

      // 3. Full-stack createYouJingRuntime with enableHistoryCollector: true + encrypted gateway (/api/bootstrap, /api/auth/login, /api/quant/sync)
      let upstreamBoardMode: "fresh" | "empty" | "timeout" = "fresh";
      const activeDataDir = path.join(tmpDir, "active-runtime");
      const adminCredsFile = path.join(activeDataDir, "admin-credentials.txt");
      runtimeActive = createYouJingRuntime({
        dataDir: activeDataDir,
        adminCredsFile,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        nowFn: () => nowMs,
        fetchMatches: async (snapshotFile: string, callOpts: any) =>
          fetchOfficialMatchesServer(snapshotFile, {
            ...callOpts,
            nowFn: () => nowMs,
            fetchFn: async () => {
              if (upstreamBoardMode === "timeout") {
                throw new Error("Upstream gateway timeout");
              }
              if (upstreamBoardMode === "empty") {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({ value: { matchInfoList: [] } }),
                };
              }
              return {
                ok: true,
                status: 200,
                json: async () => liveBoardJson,
              };
            },
          }),
        historyFetchFn: async (url: string) => {
          const u = new URL(url);
          if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  oddsHistory: {
                    matchId: 2080001,
                    hadList: [
                      {
                        h: "1.48",
                        d: "4.20",
                        a: "5.20",
                        updateDate: "2026-11-22",
                        updateTime: "18:00:00",
                      },
                    ],
                  },
                },
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: { total: 0, pages: 0, matchResult: [] },
            }),
          };
        },
      });
      await runtimeActive.historyCoordinator.start();
      assert.equal(runtimeActive.historyCoordinator.isWorkerRunning, true);

      // Parse superadmin password generated in adminCredsFile
      const credsText = fs.readFileSync(adminCredsFile, "utf8");
      const adminUser = credsText.match(/ADMIN_USER=(\S+)/)?.[1] || "yjadmin";
      const adminPass = credsText.match(/ADMIN_INITIAL_PASSWORD=(\S+)/)?.[1]!;
      assert.ok(adminPass, "Expected generated admin password");

      // Handshake (/api/security/bootstrap)
      const hwFpHex = "a".repeat(64);
      const bootEx = makeHttpExchange({
        method: "POST",
        url: "/api/security/bootstrap",
        body: { v: 1, tz: "Asia/Shanghai", hwFp: hwFpHex },
      });
      await runtimeActive.gateway.handleRequest(
        bootEx.req,
        bootEx.res,
        "/api/security/bootstrap"
      );
      const bootJson = JSON.parse(bootEx.read().body);
      assert.equal(bootJson.ok, true);
      const { aesKey, hmacKey } = deriveSessionSubkeys(
        Buffer.from(bootJson.k, "base64")
      );

      let nonceCounter = 1;
      const callEncrypted = async (
        endpoint: string,
        payloadObj: unknown,
        authToken?: string
      ) => {
        const ts = String(nowMs);
        const nonce = nonceCounter.toString(16).padStart(32, "0");
        nonceCounter += 1;
        const envelope = encryptEnvelope(aesKey, payloadObj);
        const sig = computeEnvelopeHmacHex(
          hmacKey,
          bootJson.sid,
          endpoint,
          ts,
          nonce,
          envelope.iv,
          envelope.d
        );
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-yj-sid": bootJson.sid,
          "x-yj-ts": ts,
          "x-yj-nonce": nonce,
          "x-yj-sig": sig,
        };
        if (authToken) {
          headers["x-yj-auth"] = authToken;
        }
        const ex = makeHttpExchange({
          method: "POST",
          url: `/api/${endpoint}`,
          headers,
          body: envelope,
        });
        await runtimeActive.gateway.handleRequest(
          ex.req,
          ex.res,
          `/api/${endpoint}`
        );
        const out = JSON.parse(ex.read().body);
        assert.equal(
          out.ok,
          true,
          `Expected ok on ${endpoint}: ${ex.read().body}`
        );
        return decryptEnvelope(aesKey, out.payload.iv, out.payload.d);
      };

      // Login at 08:30 (fresh live board)
      const loginPayload = await callEncrypted("auth/login", {
        username: adminUser,
        password: adminPass,
        hwFp: hwFpHex,
        deviceLabel: "Test Mac",
      });
      assert.equal(loginPayload.boardMeta.boardState, "fresh");
      assert.equal(loginPayload.boardMeta.isFallbackReadOnly, false);
      assert.equal(loginPayload.boardMeta.bannerText, null);

      // Authenticated bootstrap also returns fresh boardMeta
      const authedBootEx = makeHttpExchange({
        method: "POST",
        url: "/api/security/bootstrap",
        headers: {
          "x-yj-auth": loginPayload.authToken,
        },
        body: { v: 1, tz: "Asia/Shanghai", hwFp: hwFpHex },
      });
      await runtimeActive.gateway.handleRequest(
        authedBootEx.req,
        authedBootEx.res,
        "/api/security/bootstrap"
      );
      const authedBootJson = JSON.parse(authedBootEx.read().body);
      const authedBootKeys = deriveSessionSubkeys(
        Buffer.from(authedBootJson.k, "base64")
      );
      const authedBootBundle = decryptEnvelope(
        authedBootKeys.aesKey,
        authedBootJson.payload.iv,
        authedBootJson.payload.d
      );
      assert.equal(authedBootBundle.boardMeta.boardState, "fresh");

      // Advance clock to 08:50 and flip upstream to empty board -> /api/quant/sync returns read-only fallback boardMeta with 11-23 08:30!
      nowMs = parseBeijingDateTimeMs("2026-11-23", "08:50:00")!;
      upstreamBoardMode = "empty";
      const syncEmptyPayload = await callEncrypted(
        "quant/sync",
        { workspaceParams: {} },
        loginPayload.authToken
      );
      assert.equal(
        syncEmptyPayload.boardMeta.boardState,
        "empty-board-fallback"
      );
      assert.equal(syncEmptyPayload.boardMeta.isFallbackReadOnly, true);
      assert.equal(
        syncEmptyPayload.boardMeta.lastValidBoardClock,
        "11-23 08:30"
      );
      assert.ok(
        syncEmptyPayload.boardMeta.bannerText.includes(
          "上次有效报价（采集于 11-23 08:30）"
        )
      );

      // Flip upstream to timeout -> /api/quant/sync returns timeout-fallback with same 11-23 08:30 lastValidBoardClock & ZERO pool absence events!
      nowMs = parseBeijingDateTimeMs("2026-11-23", "08:55:00")!;
      upstreamBoardMode = "timeout";
      const syncTimeoutPayload = await callEncrypted(
        "quant/sync",
        { workspaceParams: {} },
        loginPayload.authToken
      );
      assert.equal(syncTimeoutPayload.boardMeta.boardState, "timeout-fallback");
      assert.equal(syncTimeoutPayload.boardMeta.isFallbackReadOnly, true);
      assert.equal(
        syncTimeoutPayload.boardMeta.lastValidBoardClock,
        "11-23 08:30"
      );
      await new Promise((r) => setTimeout(r, 30));
      const intervalsAfterFallbacks =
        runtimeActive.historyCoordinator.getSnapshot().telemetry
          .naturalMissingPoolIntervals;
      assert.equal(
        intervalsAfterFallbacks.filter(
          (x: any) => x.kind === "pool-absent-after-selling"
        ).length,
        0,
        "Empty/timeout fallbacks via /api/quant/sync must never record pool suspension intervals for previously selling HAD/HHAD"
      );
      assert.equal(
        intervalsAfterFallbacks.every(
          (x: any) =>
            x.lastObservedAbsentAt ===
            parseBeijingDateTimeMs("2026-11-23", "08:30:00")
        ),
        true,
        "Empty/timeout fallbacks must not advance or create any pool interval timestamps"
      );

      await runtimeActive.dispose();
      assert.equal(runtimeActive.historyCoordinator.isWorkerRunning, false);

      // 4. Headless WorkbenchController + cabinViewModels banner verification
      let mockSyncBoardMeta = loginPayload.boardMeta;
      const wb = createWorkbenchController({
        debounceMs: 0,
        quantPort: {
          computeWorkspace: (params, matches) =>
            evaluateQuantWorkspace(params, matches),
          syncMatches: async (wp) => ({
            matches: FALLBACK_MATCHES,
            syncNote: mockSyncBoardMeta.bannerText || "已同步",
            boardMeta: mockSyncBoardMeta,
            workspace: evaluateQuantWorkspace(wp, FALLBACK_MATCHES),
          }),
        },
        authPort: {
          bootstrap: async () => ({
            authenticated: true,
            user: loginPayload.user,
            authToken: "tok-1",
            matches: FALLBACK_MATCHES,
            syncNote: "实盘同步正常",
            boardMeta: loginPayload.boardMeta,
            initialPicks: [],
            workspace: evaluateQuantWorkspace({}, FALLBACK_MATCHES),
          }),
        },
      });

      await wb.bootstrapHandshake();
      assert.equal(wb.getState().boardMeta?.boardState, "fresh");
      assert.equal(
        buildMatchRadarBoardFreshnessBanner(wb.getState().boardMeta),
        null,
        "Fresh live board must NOT show fallback read-only banner"
      );

      mockSyncBoardMeta = syncEmptyPayload.boardMeta;
      await wb.syncOfficialMatches();
      assert.equal(wb.getState().boardMeta?.boardState, "empty-board-fallback");
      const bannerVm = buildMatchRadarBoardFreshnessBanner(
        wb.getState().boardMeta
      );
      assert.ok(bannerVm, "Fallback board MUST render read-only banner");
      assert.equal(bannerVm.headline, "上次有效报价（采集于 11-23 08:30）");
      assert.equal(bannerVm.badgeText, "只读回退");
      assert.ok(bannerVm.detailText.includes("只读"));
      wb.dispose();

      // 5. CLI scripts/history-ctl.mjs verification (backfill -> status -> archive -> verify-archive)
      const cliDataDir = path.join(tmpDir, "cli-data");
      const cliFetchFn = async (url: string) => {
        const u = new URL(url);
        if (u.pathname.endsWith("/getUniformMatchResultV1.qry")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                total: 1,
                pages: 1,
                matchResult: [
                  {
                    matchId: 1799001,
                    matchNumStr: "周三001",
                    matchDate: "2024-08-15",
                    leagueId: 88,
                    leagueNameAbbr: "日职",
                    homeTeamId: 6001,
                    homeTeam: "东京FC",
                    awayTeamId: 6002,
                    awayTeam: "大阪钢巴",
                    h: "2.20",
                    d: "3.30",
                    a: "2.85",
                    matchResultStatus: "2",
                    poolStatus: "Payout",
                    sectionsNo1: "0:0",
                    sectionsNo999: "1:1",
                  },
                ],
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ value: {} }),
        };
      };

      const bfOut = await runHistoryCtlCli(
        ["backfill", "--begin", "2024-08-01", "--end", "2024-08-20"],
        {
          dataDir: cliDataDir,
          fetchFn: cliFetchFn,
          nowFn: () => nowMs,
          silent: true,
        }
      );
      assert.equal(bfOut.ok, true);
      assert.equal(bfOut.backfill.allCompleted, true);

      const stOut = await runHistoryCtlCli(["status"], {
        dataDir: cliDataDir,
        nowFn: () => nowMs,
        silent: true,
      });
      assert.equal(stOut.ok, true);
      assert.equal(stOut.cursors.completedWindows, 1);

      const arOut = await runHistoryCtlCli(["archive"], {
        dataDir: cliDataDir,
        nowFn: () => nowMs,
        silent: true,
      });
      assert.equal(arOut.ok, true);
      assert.equal(arOut.archive.prunedResultRecords, 1);

      const vfOut = await runHistoryCtlCli(["verify-archive"], {
        dataDir: cliDataDir,
        nowFn: () => nowMs,
        silent: true,
      });
      assert.equal(vfOut.ok, true);
      assert.equal(vfOut.verification.shardCount, 1);
      assert.equal(vfOut.verification.totalVerifiedLines, 1);
    } finally {
      await runtimeDefault?.dispose?.();
      await runtimeActive?.dispose?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 6 (Adaptive Single-Flight Live Polling Tiers, Exponential Backoff & All 4 Board Fallback View-Models): scales poll delay by nearest kickoff countdown, deduplicates concurrent polls via single-flight, backs off exponentially on 503/timeout, and maps all 4 fallback banner states", async () => {
    const tmpDir = makeTempDir("yj-spec15-t16-s6-");
    let nowMs = parseBeijingDateTimeMs("2026-11-23", "19:40:00")!; // 20 mins before 20:00 kickoff!
    let coord: any = null;
    let liveFetchCount = 0;
    let mode: "near-kickoff" | "far-kickoff" | "maint-503" = "near-kickoff";

    try {
      coord = createSportteryHistoryCoordinator({
        dataDir: tmpDir,
        enableCollector: true,
        autoPoll: false,
        nowFn: () => nowMs,
        fetchFn: async () => {
          liveFetchCount += 1;
          await new Promise((r) => setTimeout(r, 25));
          if (mode === "maint-503") {
            return { ok: false, status: 503, json: async () => ({}) };
          }
          const matchTime = mode === "near-kickoff" ? "20:00:00" : "23:55:00";
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                matchInfoList: [
                  {
                    subMatchList: [
                      {
                        matchId: 2090001,
                        matchNumStr: "周一009",
                        matchDate: "2026-11-23",
                        matchTime,
                        businessDate: "2026-11-23",
                        leagueId: 91,
                        leagueAbbName: "英超",
                        homeTeamId: 9001,
                        homeTeamAbbName: "纽卡斯尔",
                        awayTeamId: 9002,
                        awayTeamAbbName: "西汉姆联",
                        had: {
                          h: "1.65",
                          d: "3.75",
                          a: "4.10",
                          updateDate: "2026-11-23",
                          updateTime: "19:35:00",
                        },
                      },
                    ],
                  },
                ],
              },
            }),
          };
        },
      });
      await coord.start();

      // 1. Concurrent pollLiveBoardOnce calls share single-flight request (1 upstream fetch, not 2!)
      await Promise.all([coord.pollLiveBoardOnce(), coord.pollLiveBoardOnce()]);
      assert.equal(liveFetchCount, 1);

      // Kickoff is 20m away (<= 30m tier) -> poll delay in [30_000, 36_000]ms
      const nearDelay = await coord.computeNextLivePollDelayMs();
      assert.ok(nearDelay >= 30_000 && nearDelay < 36_000, `Got ${nearDelay}`);

      // 2. Far kickoff (> 120m away: 19:40 -> 23:55 = 255m) -> poll delay in [120_000, 135_000]ms
      mode = "far-kickoff";
      await coord.pollLiveBoardOnce();
      const farDelay = await coord.computeNextLivePollDelayMs();
      assert.ok(farDelay >= 120_000 && farDelay < 135_000, `Got ${farDelay}`);

      // 3. Consecutive HTTP 503 maintenance errors trigger exponential backoff & maintenance-fallback boardState
      mode = "maint-503";
      await coord.pollLiveBoardOnce();
      const backoff1 = await coord.computeNextLivePollDelayMs();
      await coord.pollLiveBoardOnce();
      const backoff2 = await coord.computeNextLivePollDelayMs();
      await coord.pollLiveBoardOnce();
      const backoff3 = await coord.computeNextLivePollDelayMs();
      assert.equal(
        coord.getSnapshot().boardMeta.boardState,
        "maintenance-fallback"
      );
      assert.ok(backoff1 >= 10_000 && backoff1 < 13_000);
      assert.ok(backoff2 >= 20_000 && backoff2 < 23_000);
      assert.ok(backoff3 >= 40_000 && backoff3 < 43_000);

      // 4. All 4 fallback view-model states produce non-null read-only banners with exact copy
      for (const state of [
        "empty-board-fallback",
        "timeout-fallback",
        "maintenance-fallback",
        "builtin-fallback",
      ] as const) {
        const vm = buildMatchRadarBoardFreshnessBanner({
          source: state === "builtin-fallback" ? "fallback" : "cached-snapshot",
          boardState: state,
          lastValidBoardAt: state === "builtin-fallback" ? null : nowMs,
          lastValidBoardClock:
            state === "builtin-fallback" ? null : "11-23 19:40",
          isFallbackReadOnly: true,
          bannerText: null,
        });
        assert.ok(vm);
        assert.equal(vm.badgeText, "只读回退");
        assert.ok(vm.headline.startsWith("上次有效报价（采集于 "));
      }
    } finally {
      await coord?.dispose?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
