import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import {
  computePoliteRandomIntervalMs,
  createPoliteMultisourceGateway,
} from "../server/politeScraperGateway.mjs";
import { detectSoftBlockResponse } from "../server/multisourceParsers.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeSafeLaunchJitterMs,
  runOfficialFeedPushOnce,
} from "../scripts/push-official-feed.mjs";

function makeOfficialCalcPayload({
  matchId = 2043004,
  matchNumStr = "周四001",
  home = "大阪钢巴",
  away = "曼谷港务",
  hadOdds = [1.18, 5.85, 8.25],
  hhadOdds = [2.78, 3.8, 1.94],
  goalLine = "-2",
  updateDate = "2026-11-26",
  updateTime = "14:10:00",
  offLineSaleStatus = 1,
} = {}) {
  return {
    errorCode: "0",
    success: true,
    value: {
      lastUpdateTime: `${updateDate} ${updateTime}`,
      vtoolsConfig: {
        offLineSaleStatus,
        offLineStopMessage: "抱歉，本彩种已停止销售",
        onLineSaleStatus: offLineSaleStatus,
      },
      matchInfoList: [
        {
          businessDate: updateDate,
          subMatchList: [
            {
              matchId,
              matchNumStr,
              leagueAbbName: "亚冠",
              matchDate: updateDate,
              matchTime: "18:00:00",
              businessDate: updateDate,
              homeTeamAbbName: home,
              awayTeamAbbName: away,
              poolList: [
                {
                  poolCode: "HAD",
                  poolStatus: "Selling",
                  bettingSingle: 1,
                  bettingAllup: 1,
                  cbtValue: 1,
                  single: 1,
                },
                {
                  poolCode: "HHAD",
                  poolStatus: "Selling",
                  bettingSingle: 0,
                  bettingAllup: 1,
                  cbtValue: 1,
                  single: 0,
                },
              ],
              had: {
                h: String(hadOdds[0]),
                d: String(hadOdds[1]),
                a: String(hadOdds[2]),
                updateDate,
                updateTime,
              },
              hhad: {
                goalLine,
                h: String(hhadOdds[0]),
                d: String(hhadOdds[1]),
                a: String(hhadOdds[2]),
                updateDate,
                updateTime,
              },
            },
          ],
        },
      ],
    },
  };
}

function make500HunheHtmlSample({
  matchId = "2043004",
  matchNumStr = "周四001",
  home = "大阪钢巴",
  away = "曼谷港务",
  hadOdds = [1.18, 5.85, 8.25],
  hhadOdds = [2.78, 3.8, 1.94],
  goalLine = "-2",
} = {}) {
  return (
    `<!doctype html><html><body><table><tbody>
    <tr class="bet-tb-tr" data-id="${matchId}" data-homesxname="${home}" data-awaysxname="${away}" data-matchdate="2026-11-26" data-matchtime="18:00" data-rangqiu="${goalLine}" data-simpleleague="亚冠" data-processdate="2026-11-26" data-subactive="bfdg:1,bfgg:1,bqdg:1,bqgg:1,jqdg:1,jqgg:1,nspfdg:1,nspfgg:1,spfdg:0,spfgg:1" data-matchnum="${matchNumStr}" data-isend="0">
      <td class="td td-no">${matchNumStr}</td>
      <td class="td td-betbtn">
        <p class="betbtn" data-type="nspf" data-value="3" data-sp="${hadOdds[0]}"></p>
        <p class="betbtn" data-type="nspf" data-value="1" data-sp="${hadOdds[1]}"></p>
        <p class="betbtn" data-type="nspf" data-value="0" data-sp="${hadOdds[2]}"></p>
        <p class="betbtn" data-type="spf" data-value="3" data-sp="${hhadOdds[0]}"></p>
        <p class="betbtn" data-type="spf" data-value="1" data-sp="${hhadOdds[1]}"></p>
        <p class="betbtn" data-type="spf" data-value="0" data-sp="${hhadOdds[2]}"></p>
      </td>
    </tr>
    <tr class="bet-more-wrap hide"><td colspan="8"><table><tbody>
      <tr><td><p class="sbetbtn" data-type="jqs" data-value="0" data-sp="12.00"></p><p class="sbetbtn" data-type="jqs" data-value="1" data-sp="5.20"></p><p class="sbetbtn" data-type="jqs" data-value="2" data-sp="3.80"></p><p class="sbetbtn" data-type="jqs" data-value="3" data-sp="3.90"></p><p class="sbetbtn" data-type="jqs" data-value="4" data-sp="5.50"></p><p class="sbetbtn" data-type="jqs" data-value="5" data-sp="9.50"></p><p class="sbetbtn" data-type="jqs" data-value="6" data-sp="18.00"></p><p class="sbetbtn" data-type="jqs" data-value="7" data-sp="26.00"></p></td></tr>
    </tbody></table></td></tr>
  </tbody></table>` +
    " ".repeat(600) +
    `</body></html>`
  );
}

describe("Spec 0021 (#21/#22): Daily Official Sync, Deadlock Fix & Steady 20m Cadence", () => {
  it("Cycle 1: clears inFlightBoardSync after zero-await all-cooldown fallback so subsequent syncLiveBoard fetches fresh matches", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-c1-"));
    try {
      // 14:00 BJ = 06:00 UTC (open hours)
      let nowMs = Date.parse("2026-11-26T06:00:00.000Z");
      let healthy = false;
      let outboundCount = 0;

      const gw = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban.json"),
        snapshotFilePath: path.join(tmpDir, "snap.json"),
        nowFn: () => nowMs,
        randomFn: () => 0.1,
        enforceMarketHours: true,
        fetchFn: async (url: string) => {
          outboundCount += 1;
          if (!healthy) {
            return {
              ok: false,
              status: url.includes("webapi.sporttery.cn") ? 567 : 503,
              headers: {},
              text: async () => "blocked",
            };
          }
          if (url.includes("webapi.sporttery.cn")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "application/json" },
              text: async () =>
                JSON.stringify(
                  makeOfficialCalcPayload({
                    matchId: 2099001,
                    matchNumStr: "周四009",
                    home: "神户胜利船",
                    away: "浦和红钻",
                  })
                ),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            text: async () =>
              make500HunheHtmlSample({
                matchId: "2099001",
                matchNumStr: "周四009",
                home: "神户胜利船",
                away: "浦和红钻",
              }),
          };
        },
      });

      // Round 1 & 2: maxAttempts=3 per syncLiveBoard; two syncs put all 5 sources into cooldown
      const r1 = await gw.syncLiveBoard({ isManualRefresh: true });
      assert.equal(r1.boardMeta.boardState, "builtin-fallback");
      nowMs += 6 * 60_000;
      const r2 = await gw.syncLiveBoard({ isManualRefresh: true });
      assert.equal(r2.boardMeta.boardState, "builtin-fallback");

      // Confirm all 5 sources are now in cooldown
      const snapCooling = gw.getAntiBanStatusSnapshot();
      assert.ok(
        snapCooling.sources.every(
          (s: { coolingRemainingSec: number }) => s.coolingRemainingSec > 0
        ),
        "All 5 sources must be in cooldown before zero-await path"
      );

      // Round 3: all 5 sources in cooldown -> hits zero-await fallback return path
      const countBeforeZeroAwait = outboundCount;
      nowMs += 6 * 60_000;
      const r3 = await gw.syncLiveBoard({ isManualRefresh: true });
      assert.equal(outboundCount, countBeforeZeroAwait);
      assert.equal(r3.boardMeta.boardState, "builtin-fallback");

      // Advance clock past max cooldown (+6h01m, still open hours at 20:13 BJ) with healthy sources
      nowMs += 6 * 3_600_000 + 60_000;
      healthy = true;

      const r4 = await gw.syncLiveBoard({ isManualRefresh: true });
      assert.ok(
        outboundCount > countBeforeZeroAwait,
        "syncLiveBoard must NOT stay stuck on zero-await inFlightBoardSync promise and must make an outbound request"
      );
      assert.equal(r4.matches.length, 1);
      assert.equal(r4.matches[0].id, "2099001");
      assert.equal(r4.matches[0].home, "神户胜利船");
      assert.notEqual(r4.boardMeta.boardState, "timeout-fallback");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Cycle 2: LOCAL_SLIDING_WINDOW_GUARD does not trigger source cooldown and concurrent syncMatchResults shares one in-flight promise", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-c2-"));
    try {
      // 14:00 BJ = 06:00 UTC
      let nowMs = Date.parse("2026-11-26T06:00:00.000Z");
      const requestedUrls: string[] = [];
      let allowOfficialResults = false;
      let allowTitanResults = true;
      let allowOkoooResults = false;
      let boardFetchMode: "500-ok" | "all-fail-except-500" | "okooo-ok" =
        "500-ok";

      const gw = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban.json"),
        snapshotFilePath: path.join(tmpDir, "snap.json"),
        nowFn: () => nowMs,
        randomFn: () => 0.55, // weights pick 500-hunhe or okooo-hunhe cleanly
        enforceMarketHours: true,
        perDomainMaxPerMinute: 1,
        manualRefreshMinIntervalMs: 0,
        fetchFn: async (url: string) => {
          requestedUrls.push(url);
          if (url.includes("getMatchCalculatorV1.qry")) {
            if (boardFetchMode === "500-ok" || boardFetchMode === "okooo-ok") {
              return {
                ok: true,
                status: 200,
                headers: { "content-type": "application/json" },
                text: async () => JSON.stringify(makeOfficialCalcPayload()),
              };
            }
            return {
              ok: false,
              status: 567,
              headers: {},
              text: async () => "567",
            };
          }
          if (url.includes("getUniformMatchResultV1.qry")) {
            if (!allowOfficialResults) {
              return {
                ok: false,
                status: 567,
                headers: {},
                text: async () => "567",
              };
            }
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "application/json" },
              text: async () =>
                JSON.stringify({
                  errorCode: "0",
                  success: true,
                  value: {
                    total: 1,
                    pages: 1,
                    matchResult: [
                      {
                        matchId: 2043004,
                        matchNumStr: "周四001",
                        homeTeamAbbName: "大阪钢巴",
                        awayTeamAbbName: "曼谷港务",
                        sectionsNo999: "2:0",
                        sectionsNo1: "1:0",
                        matchDate: "2026-11-26",
                        matchResultStatus: "2",
                      },
                    ],
                  },
                }),
            };
          }
          if (url.includes("trade.500.com/jczq/?date=")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () =>
                `<table><tr class="bet-tb-tr" data-id="2043004" data-matchnum="周四001" data-matchdate="2026-11-26" data-homesxname="大阪钢巴" data-awaysxname="曼谷港务"><td></td></tr></table>`,
            };
          }
          if (url.includes("trade.500.com/jczq/")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () => make500HunheHtmlSample(),
            };
          }
          if (url.includes("jc.titan007.com")) {
            if (!allowTitanResults) {
              return {
                ok: false,
                status: 503,
                headers: {},
                text: async () => "",
              };
            }
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/plain" },
              text: async () =>
                "var A=$1^2026,10,26,18,00,00^亚冠^-1^周四001^1^2^3^大阪钢巴,4^5^曼谷港务,6^2^0^1^0",
            };
          }
          if (url.includes("www.okooo.com/jingcai/kaijiang/")) {
            if (!allowOkoooResults) {
              return {
                ok: false,
                status: 503,
                headers: {},
                text: async () => "",
              };
            }
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () =>
                `<table><tr class="trClass"><td>周四001</td><td>亚冠</td><td>11-26 18:00</td><td>大阪钢巴</td><td>曼谷港务</td><td>1-0</td><td>2-0</td></tr></table>`,
            };
          }
          return { ok: false, status: 503, headers: {}, text: async () => "" };
        },
      });

      // 1) Seed lastKnownMatches via official board (1 hit on webapi.sporttery.cn), then within <60s call syncMatchResults
      //    sporttery-results hits LOCAL_SLIDING_WINDOW_GUARD on webapi.sporttery.cn;
      //    500-date-ids hits trade.500.com on date 1 and LOCAL_SLIDING_WINDOW_GUARD on date 2;
      //    titan007-results hits jc.titan007.com on date 1 and LOCAL_SLIDING_WINDOW_GUARD on date 2.
      await gw.syncLiveBoard({ isManualRefresh: true });
      nowMs += 5_000;
      allowOfficialResults = true;
      await gw.syncMatchResults({ forceRefresh: true });

      // Within the same 60s window, 500-hunhe tries trade.500.com -> hits LOCAL_SLIDING_WINDOW_GUARD!
      // Verify 500-hunhe failCount === 0 & coolingRemainingSec === 0.
      nowMs += 5_000;
      const gw500 = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban-500.json"),
        nowFn: () => nowMs,
        randomFn: () => 0.7, // picks 500-hunhe
        enforceMarketHours: true,
        perDomainMaxPerMinute: 1,
        manualRefreshMinIntervalMs: 0,
        fetchFn: async (url: string) => {
          if (url.includes("trade.500.com/jczq/?date=")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () =>
                `<table><tr class="bet-tb-tr" data-id="2043004" data-matchnum="周四001" data-matchdate="2026-11-26" data-homesxname="大阪钢巴" data-awaysxname="曼谷港务"><td></td></tr></table>`,
            };
          }
          if (url.includes("trade.500.com/jczq/")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () => make500HunheHtmlSample(),
            };
          }
          return {
            ok: false,
            status: 567,
            headers: {},
            text: async () => "567",
          };
        },
      });
      // Exhaust trade.500.com sliding window via syncMatchResults (500-date-ids)
      await gw500.syncMatchResults({ forceRefresh: true });
      nowMs += 5_000;
      // Now syncLiveBoard tries 500-hunhe -> hits LOCAL_SLIDING_WINDOW_GUARD
      await gw500.syncLiveBoard({ isManualRefresh: true });
      const status500 = gw500
        .getAntiBanStatusSnapshot()
        .sources.find((s: { id: string }) => s.id === "500-hunhe");
      assert.equal(
        status500?.failCount,
        0,
        "LOCAL_SLIDING_WINDOW_GUARD must NOT increment failCount on 500-hunhe"
      );
      assert.equal(
        status500?.coolingRemainingSec,
        0,
        "LOCAL_SLIDING_WINDOW_GUARD must NOT put 500-hunhe into cooldown"
      );

      // 2) Verify sporttery-results, 500-date-ids, titan007-results were NOT put into 30m cooldown on gw
      //    Advance clock +65s (sliding window cleared, far below 30m cooldown) and check they are still eligible
      nowMs += 65_000;
      const beforeResCount = requestedUrls.filter((u) =>
        u.includes("getUniformMatchResultV1.qry")
      ).length;
      const resAfterWindow = await gw.syncMatchResults({ forceRefresh: true });
      const afterResCount = requestedUrls.filter((u) =>
        u.includes("getUniformMatchResultV1.qry")
      ).length;
      assert.equal(
        afterResCount - beforeResCount,
        1,
        "sporttery-results must NOT enter 30m cooldown after LOCAL_SLIDING_WINDOW_GUARD"
      );
      assert.equal(resAfterWindow.get("2043004")?.fullScore, "2:0");

      // Also verify 500-date-ids & titan007-results did NOT enter cooldown when official fails
      nowMs += 65_000;
      allowOfficialResults = false;
      const before500Date = requestedUrls.filter((u) =>
        u.includes("trade.500.com/jczq/?date=")
      ).length;
      const beforeTitan = requestedUrls.filter((u) =>
        u.includes("jc.titan007.com")
      ).length;
      await gw.syncMatchResults({ forceRefresh: true });
      assert.ok(
        requestedUrls.filter((u) => u.includes("trade.500.com/jczq/?date="))
          .length > before500Date,
        "500-date-ids must NOT enter cooldown after LOCAL_SLIDING_WINDOW_GUARD"
      );
      assert.ok(
        requestedUrls.filter((u) => u.includes("jc.titan007.com")).length >
          beforeTitan,
        "titan007-results must NOT enter cooldown after LOCAL_SLIDING_WINDOW_GUARD"
      );

      // 3) Verify 4 concurrent syncMatchResults() without explicit beginDate/endDate/forceRefresh share 1 in-flight promise
      let concurrentFetchCalls = 0;
      const gwConcurrent = createPoliteMultisourceGateway({
        nowFn: () => nowMs,
        enforceMarketHours: true,
        perDomainMaxPerMinute: 10,
        fetchFn: async (url: string) => {
          concurrentFetchCalls += 1;
          await new Promise((r) => setTimeout(r, 15));
          if (url.includes("getUniformMatchResultV1.qry")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "application/json" },
              text: async () =>
                JSON.stringify({
                  errorCode: "0",
                  success: true,
                  value: {
                    total: 1,
                    pages: 1,
                    matchResult: [
                      {
                        matchId: 2043004,
                        matchNumStr: "周四001",
                        homeTeamAbbName: "大阪钢巴",
                        awayTeamAbbName: "曼谷港务",
                        sectionsNo999: "3:1",
                        sectionsNo1: "1:0",
                        matchDate: "2026-11-26",
                        matchResultStatus: "2",
                      },
                    ],
                  },
                }),
            };
          }
          return { ok: false, status: 503, headers: {}, text: async () => "" };
        },
      });

      const [m1, m2, m3, m4] = await Promise.all([
        gwConcurrent.syncMatchResults(),
        gwConcurrent.syncMatchResults(),
        gwConcurrent.syncMatchResults(),
        gwConcurrent.syncMatchResults(),
      ]);
      assert.equal(
        concurrentFetchCalls,
        1,
        "4 concurrent syncMatchResults() calls must coalesce into 1 outbound request"
      );
      assert.equal(m1.get("2043004")?.fullScore, "3:1");
      assert.equal(m4.get("2043004")?.fullScore, "3:1");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Cycle 3: detectSoftBlockResponse allows >10KB match pages with static gt.js script while blocking matchless WAF/geetest shells", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-c3-"));
    try {
      const realisticOkoooHtml =
        `<!doctype html><html><head>` +
        `<title>竞彩足球混合过关 - 澳客</title>` +
        `<script src='https://static.geetest.com/static/tools/gt.js' async="true" defer></script>` +
        `</head><body>` +
        `<div class="touzhu_1" data-end="0" data-ordercn="周四001" data-mid="99001" data-rq="-1" data-hname="大阪钢巴" data-aname="曼谷港务">` +
        `<span class="saiming" title="亚冠">亚冠</span>` +
        `<span>比赛时间:2026-11-26 18:00</span>` +
        `<a class="zhum" title="大阪钢巴">大阪钢巴</a><a class="zhum" title="曼谷港务">曼谷港务</a>` +
        `<span class="tz" data-wf="0" data-wz="0" data-sp="1.85" data-dg="1">1.85</span>` +
        `<span class="tz" data-wf="0" data-wz="1" data-sp="3.40" data-dg="1">3.40</span>` +
        `<span class="tz" data-wf="0" data-wz="2" data-sp="3.60" data-dg="1">3.60</span>` +
        `<span class="tz" data-wf="1" data-wz="0" data-sp="3.35" data-dg="0">3.35</span>` +
        `<span class="tz" data-wf="1" data-wz="1" data-sp="3.45" data-dg="0">3.45</span>` +
        `<span class="tz" data-wf="1" data-wz="2" data-sp="1.82" data-dg="0">1.82</span>` +
        `</div>` +
        `<div class="footer-pad">${"竞彩足球赛程数据".repeat(1600)}</div>` +
        `</body></html>`;

      assert.ok(Buffer.byteLength(realisticOkoooHtml, "utf8") > 10_240);

      // 1) Normal >10KB HTML with gt.js + match rows must NOT be flagged as soft-block
      const normalCheck = detectSoftBlockResponse(realisticOkoooHtml, 200, 512);
      assert.deepEqual(normalCheck, { blocked: false, reason: null });

      // 2) Small or matchless WAF shells must still be blocked
      const smallGeetestShell = `<html><head><script src="https://static.geetest.com/static/tools/gt.js"></script></head><body>请完成安全验证${"x".repeat(600)}</body></html>`;
      assert.equal(
        detectSoftBlockResponse(smallGeetestShell, 200, 512).blocked,
        true
      );

      const largeMatchlessGeetestShell = `<html><head><script src="https://static.geetest.com/static/tools/gt.js"></script></head><body><div>人机验证拦截</div>${"p".repeat(12_000)}</body></html>`;
      assert.equal(
        detectSoftBlockResponse(largeMatchlessGeetestShell, 200, 512).blocked,
        true
      );

      const acwWafShell = `<html><script>var acw_sc__v2='deadbeef';</script>${"x".repeat(12_000)}</html>`;
      assert.equal(
        detectSoftBlockResponse(acwWafShell, 200, 512).blocked,
        true
      );

      // 3) syncLiveBoard succeeds and parses matches from realisticOkoooHtml without marking okooo-hunhe failed
      const nowMs = Date.parse("2026-11-26T06:00:00.000Z"); // 14:00 BJ
      const gw = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban.json"),
        nowFn: () => nowMs,
        randomFn: () => 0.99, // picks okooo-hunhe
        enforceMarketHours: true,
        fetchFn: async (url: string) => {
          if (url.includes("www.okooo.com/jingcai/hunhe/")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () => realisticOkoooHtml,
            };
          }
          return {
            ok: false,
            status: 567,
            headers: {},
            text: async () => "567",
          };
        },
      });

      const boardRes = await gw.syncLiveBoard();
      assert.equal(boardRes.source, "multisource-backup");
      assert.equal(boardRes.providerId, "okooo-hunhe");
      assert.equal(boardRes.matches.length, 1);
      assert.equal(boardRes.matches[0].pools.HAD.options[0].odds, 1.85);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Cycle 4: maintains ~18-22m open-hours cadence regardless of idle time, preserves dormancy, drops detached recordUserActivity sync, and triggers startup load", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-c4-"));
    try {
      // (a) 300 samples of computePoliteRandomIntervalMs must be in [1_060_000, 1_340_000], non-integer minutes, >35s from quarter hours
      for (let i = 0; i < 300; i++) {
        const base = Date.parse("2026-11-26T04:00:00.000Z") + i * 11_731;
        const d = computePoliteRandomIntervalMs(base);
        assert.ok(
          d >= 1_060_000 && d <= 1_340_000,
          `Interval ${d}ms out of ~18-22m range [1_060_000, 1_340_000]`
        );
        assert.notEqual(
          d % 60_000,
          0,
          "Interval must not be exact whole minute"
        );
        const targetBj = base + d + 8 * 3_600_000;
        const secInHour =
          (((targetBj % 3_600_000) + 3_600_000) % 3_600_000) / 1000;
        const remQ = secInHour % 900;
        const distQ = Math.min(remQ, 900 - remQ);
        assert.ok(
          distQ > 35,
          `Target landed too close (${distQ}s) to quarter-hour mark`
        );
      }

      // (b) & (c) Gateway created at 11:30 BJ -> idle for 3 hours until 14:30 BJ
      let nowMs = Date.parse("2026-11-26T03:30:00.000Z"); // 11:30 BJ
      let outboundCount = 0;
      const gw = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban.json"),
        nowFn: () => nowMs,
        randomFn: () => 0.5,
        enforceMarketHours: true,
        fetchFn: async (url: string) => {
          outboundCount += 1;
          if (url.includes("webapi.sporttery.cn")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "application/json" },
              text: async () => JSON.stringify(makeOfficialCalcPayload()),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            text: async () => make500HunheHtmlSample(),
          };
        },
      });

      // Seed an outbound sync at 11:30 BJ
      await gw.syncLiveBoard();
      const countAfterSeed = outboundCount;
      assert.equal(countAfterSeed, 1);

      // Advance 3 hours to 14:30 BJ (idle > 60m)
      nowMs = Date.parse("2026-11-26T06:30:00.000Z"); // 14:30 BJ
      const openIdleDelay = gw.computeNextBackgroundDelayMs();
      assert.ok(
        openIdleDelay >= 1_060_000 && openIdleDelay <= 1_350_000,
        `Open-hours idle delay ${openIdleDelay}ms must stay in ~18-22m (no 47-64m slowdown)`
      );

      // recordUserActivity() after 3h idle must NOT fire a detached syncLiveBoard bypassing appRoutes
      gw.recordUserActivity();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(
        outboundCount,
        countAfterSeed,
        "recordUserActivity() must not fire a detached outbound syncLiveBoard()"
      );

      // Closed hours dormancy delays
      nowMs = Date.parse("2026-11-26T00:30:00.000Z"); // 08:30 BJ
      const morningClosedDelay = gw.computeNextBackgroundDelayMs();
      assert.ok(
        morningClosedDelay >= 2.5 * 3_600_000,
        `08:30 BJ must sleep until 11:00+wakeOffset, got ${morningClosedDelay}ms`
      );

      nowMs = Date.parse("2026-11-26T15:30:00.000Z"); // 23:30 BJ
      const nightClosedDelay = gw.computeNextBackgroundDelayMs();
      assert.ok(
        nightClosedDelay >= 11 * 3_600_000,
        `23:30 BJ must sleep until next 11:00+wakeOffset, got ${nightClosedDelay}ms`
      );

      // (d) createYouJingRuntime with enableHistoryCollector: true during open hours triggers initial ensureMatchesLoaded(false)
      let runtimeFetchCalls = 0;
      const runtimeNowMs = Date.parse("2026-11-26T06:30:00.000Z"); // 14:30 BJ
      const rtDir = path.join(tmpDir, "rt");
      const runtime = createYouJingRuntime({
        dataDir: rtDir,
        nowFn: () => runtimeNowMs,
        randomFn: () => 0.1,
        enforceMarketHours: true,
        enableHistoryCollector: true,
        historyAutoBackfill: false,
        fetchFn: async (url: string) => {
          runtimeFetchCalls += 1;
          if (url.includes("webapi.sporttery.cn")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "application/json" },
              text: async () =>
                JSON.stringify(
                  makeOfficialCalcPayload({
                    matchId: 2088001,
                    matchNumStr: "周四008",
                  })
                ),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            text: async () =>
              make500HunheHtmlSample({
                matchId: "2088001",
                matchNumStr: "周四008",
              }),
          };
        },
      });
      try {
        await new Promise((r) => setTimeout(r, 30));
        assert.ok(
          runtimeFetchCalls >= 1,
          "Runtime startup during open hours with enableHistoryCollector must trigger initial non-blocking board load"
        );
      } finally {
        await runtime.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Ticket 2 Cycle 1: securityShield passes signed /api/internal/feed-push, ingests calculator + 90m results for auto-settlement, rejects bad sig (401) and blocks non-browser /api/quant/sync (403)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-t2-c1-"));
    try {
      const nowMs = Date.parse("2026-11-26T06:00:00.000Z"); // 14:00 BJ
      const pushSecret = "m5_test_push_secret_2026_secure";

      async function invokeGatewayHttp(
        gateway: {
          handleRequest: (
            req: unknown,
            res: unknown,
            pathname: string
          ) => Promise<boolean>;
        },
        opts: {
          method: string;
          pathname: string;
          headers?: Record<string, string>;
          bodyText?: string;
        }
      ) {
        const chunks =
          opts.bodyText !== undefined
            ? [Buffer.from(opts.bodyText, "utf8")]
            : [];
        const req = Readable.from(chunks) as Readable & {
          method: string;
          url: string;
          headers: Record<string, string>;
          socket: { remoteAddress: string };
        };
        req.method = opts.method;
        req.url = opts.pathname;
        req.headers = Object.fromEntries(
          Object.entries(opts.headers || {}).map(([k, v]) => [
            k.toLowerCase(),
            v,
          ])
        );
        req.socket = { remoteAddress: "203.0.113.42" };

        let statusCode = 200;
        const respHeaders: Record<string, string> = {};
        let body = "";
        let headersSent = false;
        const res = {
          get statusCode() {
            return statusCode;
          },
          set statusCode(v: number) {
            statusCode = v;
          },
          get headersSent() {
            return headersSent;
          },
          setHeader(k: string, v: string) {
            respHeaders[k.toLowerCase()] = v;
          },
          end(chunk = "") {
            headersSent = true;
            body += String(chunk);
          },
        };
        const handled = await gateway.handleRequest(req, res, opts.pathname);
        return {
          handled,
          statusCode,
          respHeaders,
          body,
          json: body ? JSON.parse(body) : null,
        };
      }

      const runtime = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => nowMs,
        randomFn: () => 0.1,
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: async (url: string) => {
          if (url.includes("webapi.sporttery.cn")) {
            return {
              ok: false,
              status: 567,
              headers: {},
              text: async () => "<html>EdgeOne 567</html>",
            };
          }
          return {
            ok: false,
            status: 503,
            headers: {},
            text: async () => "",
          };
        },
      });

      try {
        const pushPayloadObj = {
          ...makeOfficialCalcPayload({
            matchId: 2043004,
            matchNumStr: "周四001",
            home: "大阪钢巴",
            away: "曼谷港务",
            hadOdds: [1.18, 5.85, 8.25],
          }),
          __officialResultsRaw: [
            {
              errorCode: "0",
              success: true,
              value: {
                total: 1,
                pages: 1,
                matchResult: [
                  {
                    matchId: 2043004,
                    matchNumStr: "周四001",
                    homeTeamAbbName: "大阪钢巴",
                    awayTeamAbbName: "曼谷港务",
                    sectionsNo999: "2:0",
                    sectionsNo1: "1:0",
                    matchDate: "2026-11-26",
                    matchResultStatus: "2",
                  },
                ],
              },
            },
          ],
        };
        const bodyText = JSON.stringify(pushPayloadObj);
        const nonce = "m5_nonce_0001_valid_abc";
        const sig = crypto
          .createHmac("sha256", pushSecret)
          .update(`${nowMs}.${nonce}.${bodyText}`)
          .digest("hex");

        const pushRes = await invokeGatewayHttp(runtime.gateway, {
          method: "POST",
          pathname: "/api/internal/feed-push",
          headers: {
            "user-agent": "YouJingM5Pusher/1.0",
            accept: "*/*",
            "content-type": "application/json",
            "x-yj-push-ts": String(nowMs),
            "x-yj-push-nonce": nonce,
            "x-yj-push-sig": sig,
          },
          bodyText,
        });
        assert.equal(pushRes.handled, true);
        assert.equal(pushRes.statusCode, 200);
        assert.equal(pushRes.json?.ok, true);
        assert.equal(pushRes.json?.matchesCount, 1);
        assert.equal(pushRes.json?.resultsCount, 1);

        const loaded = await runtime.appRoutes.ensureMatchesLoaded(false);
        assert.equal(loaded.boardMeta.source, "official-live");
        assert.equal(
          loaded.matches[0].pools.HAD.confirmedSaleRights.single,
          true
        );

        const syncedResults = await runtime.politeGateway!.syncMatchResults({
          forceRefresh: true,
        });
        assert.equal(syncedResults.get("2043004")?.fullScore, "2:0");
        assert.equal(syncedResults.get("2043004")?.settled, true);

        const userId = "u_push_auto_settle";
        const added = runtime.ledgerManager.mutateUserLedger(
          userId,
          {
            action: "add-entry",
            kind: "live",
            snapshot: {
              lines: [
                {
                  legs: [
                    {
                      matchId: "2043004",
                      poolCode: "HAD",
                      optionKey: "h",
                      odds: 1.18,
                    },
                  ],
                  multiple: 1,
                },
              ],
            },
            cost: 2,
          },
          {
            authoritativeMatches: loaded.matches,
            boardMeta: loaded.boardMeta,
          }
        );
        assert.equal(added.ok, true);

        const settled = await runtime.appRoutes.resolveSyncedUserLedger(
          userId,
          loaded.matches,
          true
        );
        assert.equal(settled.newlySettledCount, 1);
        assert.equal(settled.ledger?.entries[0]?.status, "won");

        // Invalid signature must return 401
        const badSigRes = await invokeGatewayHttp(runtime.gateway, {
          method: "POST",
          pathname: "/api/internal/feed-push",
          headers: {
            "user-agent": "YouJingM5Pusher/1.0",
            accept: "*/*",
            "content-type": "application/json",
            "x-yj-push-ts": String(nowMs),
            "x-yj-push-nonce": "m5_nonce_0002_invalid_sig",
            "x-yj-push-sig": "0".repeat(64),
          },
          bodyText,
        });
        assert.equal(badSigRes.statusCode, 401);

        // Non-browser POST /api/quant/sync without push endpoint/headers must still be blocked with 403
        const blockedSyncRes = await invokeGatewayHttp(runtime.gateway, {
          method: "POST",
          pathname: "/api/quant/sync",
          headers: {
            "user-agent": "YouJingM5Pusher/1.0",
            accept: "*/*",
            "content-type": "application/json",
          },
          bodyText: "{}",
        });
        assert.equal(blockedSyncRes.statusCode, 403);
        assert.equal(blockedSyncRes.json?.error, "Automated access denied");
      } finally {
        await runtime.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Ticket 2 Cycle 2: protects fresh official-live board from backup downgrade for 35m, falls back to multisource-backup at >=35m, and upgrades back on wake push", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-t2-c2-"));
    try {
      // Step A: 14:00 BJ = 06:00 UTC
      let nowMs = Date.parse("2026-11-26T06:00:00.000Z");
      const pushSecret = "m5_test_push_secret_35m_guard";
      let backupMatchId = "2043099";
      let backupHome = "横滨水手";
      let backupAway = "川崎前锋";

      const runtime = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => nowMs,
        randomFn: () => 0.6, // picks 500-hunhe when official returns 567
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: async (url: string) => {
          if (url.includes("webapi.sporttery.cn")) {
            return {
              ok: false,
              status: 567,
              headers: {},
              text: async () => "<html>EdgeOne 567</html>",
            };
          }
          if (url.includes("trade.500.com/jczq/")) {
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
              text: async () =>
                make500HunheHtmlSample({
                  matchId: backupMatchId,
                  matchNumStr: "周四002",
                  home: backupHome,
                  away: backupAway,
                  hadOdds: [2.05, 3.3, 3.1],
                }),
            };
          }
          return { ok: false, status: 503, headers: {}, text: async () => "" };
        },
      });

      try {
        // Helper to push via /api/internal/feed-push
        const sendSignedPush = async (payloadObj: unknown, nonce: string) => {
          const bodyText = JSON.stringify(payloadObj);
          const sig = crypto
            .createHmac("sha256", pushSecret)
            .update(`${nowMs}.${nonce}.${bodyText}`)
            .digest("hex");
          const req = Readable.from([
            Buffer.from(bodyText, "utf8"),
          ]) as Readable & {
            method: string;
            url: string;
            headers: Record<string, string>;
            socket: { remoteAddress: string };
          };
          req.method = "POST";
          req.url = "/api/internal/feed-push";
          req.headers = {
            "user-agent": "YouJingM5Pusher/1.0",
            accept: "*/*",
            "content-type": "application/json",
            "x-yj-push-ts": String(nowMs),
            "x-yj-push-nonce": nonce,
            "x-yj-push-sig": sig,
          };
          req.socket = { remoteAddress: "203.0.113.42" };
          let statusCode = 200;
          let body = "";
          const res = {
            get statusCode() {
              return statusCode;
            },
            set statusCode(v: number) {
              statusCode = v;
            },
            headersSent: false,
            setHeader() {},
            end(chunk = "") {
              this.headersSent = true;
              body += String(chunk);
            },
          };
          await runtime.gateway.handleRequest(
            req,
            res,
            "/api/internal/feed-push"
          );
          return { statusCode, json: body ? JSON.parse(body) : null };
        };

        // Step A (14:00 BJ): signed push delivers official-live board
        const pushA = await sendSignedPush(
          makeOfficialCalcPayload({
            matchId: 2043004,
            matchNumStr: "周四001",
            home: "大阪钢巴",
            away: "曼谷港务",
            hadOdds: [1.18, 5.85, 8.25],
            updateDate: "2026-11-26",
            updateTime: "14:00:00",
          }),
          "nonce_step_a_1400"
        );
        assert.equal(pushA.statusCode, 200);

        // Step B (14:15 BJ, 15m < 35m): official 567, 500-hunhe 200; manual sync must NOT downgrade!
        nowMs = Date.parse("2026-11-26T06:15:00.000Z"); // 14:15 BJ
        const stepB = await runtime.appRoutes.ensureMatchesLoaded(true);
        assert.equal(stepB.boardMeta.source, "official-live");
        assert.equal(stepB.boardMeta.boardState, "fresh");
        assert.equal(stepB.matches[0].id, "2043004");
        assert.equal(
          stepB.matches[0].pools.HAD.confirmedSaleRights.single,
          true
        );

        // Step C (14:36 BJ, 36m >= 35m): M5 asleep -> falls back seamlessly to multisource-backup (500-hunhe)
        nowMs = Date.parse("2026-11-26T06:36:00.000Z"); // 14:36 BJ
        const stepC = await runtime.appRoutes.ensureMatchesLoaded(true);
        assert.equal(stepC.boardMeta.source, "multisource-backup");
        assert.equal(stepC.boardMeta.boardState, "backup-live");
        assert.equal(stepC.matches[0].id, backupMatchId);
        assert.equal(stepC.matches[0].home, backupHome);

        // Step D (14:50 BJ): M5 wakes and pushes new official snapshot -> immediately upgrades back to official-live (fresh)
        nowMs = Date.parse("2026-11-26T06:50:00.000Z"); // 14:50 BJ
        const pushD = await sendSignedPush(
          makeOfficialCalcPayload({
            matchId: 2043105,
            matchNumStr: "周四005",
            home: "鹿岛鹿角",
            away: "广岛三箭",
            hadOdds: [1.92, 3.4, 3.3],
            updateDate: "2026-11-26",
            updateTime: "14:50:00",
          }),
          "nonce_step_d_1450"
        );
        assert.equal(pushD.statusCode, 200);
        const stepD = await runtime.appRoutes.ensureMatchesLoaded(false);
        assert.equal(stepD.boardMeta.source, "official-live");
        assert.equal(stepD.boardMeta.boardState, "fresh");
        assert.equal(stepD.matches[0].id, "2043105");
        assert.equal(
          stepD.matches[0].pools.HAD.confirmedSaleRights.single,
          true
        );
      } finally {
        await runtime.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Ticket 2 Cycle 3: standalone M5 pusher skips closed hours with 0 outbound calls and pushes calculator + 3-day official results in open hours", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-t2-c3-"));
    try {
      const pushSecret = "m5_cli_test_secret_2026";
      const targetUrl = "https://jisuanqi.yjty.io/api/internal/feed-push";

      // 1) Closed hours (08:00 BJ = 00:00 UTC) -> 0 outbound requests, skippedClosed: true
      let closedOutbound = 0;
      const closedNowMs = Date.parse("2026-11-26T00:00:00.000Z");
      const closedRes = await runOfficialFeedPushOnce({
        nowFn: () => closedNowMs,
        force: false,
        secret: pushSecret,
        targetUrl,
        fetchFn: async () => {
          closedOutbound += 1;
          throw new Error("Should not call fetchFn during closed hours");
        },
      });
      assert.equal(closedOutbound, 0);
      assert.equal(closedRes.ok, true);
      assert.equal(closedRes.skippedClosed, true);

      // 2) Open hours (14:00 BJ = 06:00 UTC) -> fetches calculator + 3-day official results, signs HMAC, POSTs into live runtime
      const openNowMs = Date.parse("2026-11-26T06:00:00.000Z");
      const runtime = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => openNowMs,
        randomFn: () => 0.1,
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: async (url: string) => {
          if (url.includes("webapi.sporttery.cn")) {
            return {
              ok: false,
              status: 567,
              headers: {},
              text: async () => "567",
            };
          }
          return { ok: false, status: 503, headers: {}, text: async () => "" };
        },
      });

      try {
        const fetchedUrls: string[] = [];
        const openRes = await runOfficialFeedPushOnce({
          nowFn: () => openNowMs,
          secret: pushSecret,
          targetUrl,
          fetchFn: async (
            url: string,
            init?: {
              method?: string;
              headers?: Record<string, string>;
              body?: string;
            }
          ) => {
            fetchedUrls.push(url);
            if (url.includes("getMatchCalculatorV1.qry")) {
              return {
                ok: true,
                status: 200,
                json: async () =>
                  makeOfficialCalcPayload({
                    matchId: 2043201,
                    matchNumStr: "周四006",
                    home: "神户胜利船",
                    away: "蔚山现代",
                  }),
              };
            }
            if (url.includes("getUniformMatchResultV1.qry")) {
              assert.match(url, /matchBeginDate=2026-11-24/);
              assert.match(url, /matchEndDate=2026-11-26/);
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  errorCode: "0",
                  success: true,
                  value: {
                    total: 1,
                    pages: 1,
                    matchResult: [
                      {
                        matchId: 2043200,
                        matchNumStr: "周三003",
                        homeTeamAbbName: "浦和红钻",
                        awayTeamAbbName: "横滨水手",
                        sectionsNo999: "1:0",
                        sectionsNo1: "0:0",
                        matchDate: "2026-11-25",
                        matchResultStatus: "2",
                      },
                    ],
                  },
                }),
              };
            }
            if (url === targetUrl) {
              const req = Readable.from([
                Buffer.from(String(init?.body || ""), "utf8"),
              ]) as Readable & {
                method: string;
                url: string;
                headers: Record<string, string>;
                socket: { remoteAddress: string };
              };
              req.method = init?.method || "POST";
              req.url = "/api/internal/feed-push";
              req.headers = Object.fromEntries(
                Object.entries(init?.headers || {}).map(([k, v]) => [
                  k.toLowerCase(),
                  v,
                ])
              );
              req.socket = { remoteAddress: "203.0.113.42" };
              let statusCode = 200;
              let body = "";
              const res = {
                get statusCode() {
                  return statusCode;
                },
                set statusCode(v: number) {
                  statusCode = v;
                },
                headersSent: false,
                setHeader() {},
                end(chunk = "") {
                  this.headersSent = true;
                  body += String(chunk);
                },
              };
              await runtime.gateway.handleRequest(
                req,
                res,
                "/api/internal/feed-push"
              );
              return {
                ok: statusCode >= 200 && statusCode < 300,
                status: statusCode,
                json: async () => JSON.parse(body),
                text: async () => body,
              };
            }
            return { ok: false, status: 404, json: async () => ({}) };
          },
        });

        assert.equal(openRes.ok, true);
        assert.equal(openRes.matchesCount, 1);
        assert.equal(openRes.resultsCount, 1);
        assert.ok(
          fetchedUrls.some((u) => u.includes("getMatchCalculatorV1.qry"))
        );
        assert.ok(
          fetchedUrls.some((u) => u.includes("getUniformMatchResultV1.qry"))
        );
        assert.ok(fetchedUrls.includes(targetUrl));

        const loaded = await runtime.appRoutes.ensureMatchesLoaded(false);
        assert.equal(loaded.boardMeta.source, "official-live");
        assert.equal(loaded.matches[0].id, "2043201");

        const resultsMap = await runtime.politeGateway!.syncMatchResults({
          forceRefresh: true,
        });
        assert.equal(resultsMap.get("2043200")?.fullScore, "1:0");
      } finally {
        await runtime.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Review Fix (a): securityShield rejects dummy non-hex/short push headers with 403 Automated access denied", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-rf-a-"));
    try {
      const nowMs = Date.parse("2026-11-26T06:00:00.000Z");
      const runtime = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => nowMs,
        enforceMarketHours: true,
        pushHmacSecret: "m5_test_push_secret_strict_headers",
      });

      const sendPushWithHeaders = async (headers: Record<string, string>) => {
        const req = Readable.from([Buffer.from("{}", "utf8")]) as Readable & {
          method: string;
          url: string;
          headers: Record<string, string>;
          socket: { remoteAddress: string };
        };
        req.method = "POST";
        req.url = "/api/internal/feed-push";
        req.headers = headers;
        req.socket = { remoteAddress: "203.0.113.42" };
        let statusCode = 200;
        let body = "";
        const res = {
          get statusCode() {
            return statusCode;
          },
          set statusCode(v: number) {
            statusCode = v;
          },
          headersSent: false,
          setHeader() {},
          end(chunk = "") {
            this.headersSent = true;
            body += String(chunk);
          },
        };
        await runtime.gateway.handleRequest(
          req,
          res,
          "/api/internal/feed-push"
        );
        return { statusCode, json: body ? JSON.parse(body) : null };
      };

      try {
        const badCases: Array<Record<string, string>> = [
          {
            "user-agent": "curl/8.4.0",
            accept: "*/*",
            "x-yj-push-ts": "not-a-timestamp",
            "x-yj-push-nonce": "valid_nonce_1234",
            "x-yj-push-sig": "a".repeat(64),
          },
          {
            "user-agent": "python-requests/2.31.0",
            accept: "*/*",
            "x-yj-push-ts": String(nowMs),
            "x-yj-push-nonce": "short",
            "x-yj-push-sig": "a".repeat(64),
          },
          {
            "user-agent": "YouJingM5Pusher/1.0",
            accept: "*/*",
            "x-yj-push-ts": String(nowMs),
            "x-yj-push-nonce": "valid_nonce_1234",
            "x-yj-push-sig": "dummy-non-hex-sig",
          },
        ];
        for (const hdrs of badCases) {
          const r = await sendPushWithHeaders(hdrs);
          assert.equal(r.statusCode, 403);
          assert.equal(r.json?.error, "Automated access denied");
        }
      } finally {
        await runtime.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Review Fix (b): persists nonces & 35m official-live guard across restart, survives intervening onlyOfficial/else fallbacks, syncs officialSaleOpen & drains open quotes", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-rf-b-"));
    try {
      let nowMs = Date.parse("2026-11-26T06:00:00.000Z"); // 14:00 BJ
      const pushSecret = "m5_test_push_secret_restart_guard";
      let drainCalls = 0;

      const makeSignedReq = (
        payloadObj: unknown,
        nonce: string,
        tsMs: number
      ) => {
        const bodyText = JSON.stringify(payloadObj);
        const sig = crypto
          .createHmac("sha256", pushSecret)
          .update(`${tsMs}.${nonce}.${bodyText}`)
          .digest("hex");
        const req = Readable.from([
          Buffer.from(bodyText, "utf8"),
        ]) as Readable & {
          method: string;
          url: string;
          headers: Record<string, string>;
          socket: { remoteAddress: string };
        };
        req.method = "POST";
        req.url = "/api/internal/feed-push";
        req.headers = {
          "user-agent": "YouJingM5Pusher/1.0",
          accept: "*/*",
          "content-type": "application/json",
          "x-yj-push-ts": String(tsMs),
          "x-yj-push-nonce": nonce,
          "x-yj-push-sig": sig,
        };
        req.socket = { remoteAddress: "203.0.113.42" };
        let statusCode = 200;
        let body = "";
        const res = {
          get statusCode() {
            return statusCode;
          },
          set statusCode(v: number) {
            statusCode = v;
          },
          headersSent: false,
          setHeader() {},
          end(chunk = "") {
            this.headersSent = true;
            body += String(chunk);
          },
        };
        return {
          req,
          res,
          parse: () => ({ statusCode, json: body ? JSON.parse(body) : null }),
        };
      };

      const fetchStub = async (url: string) => {
        if (url.includes("webapi.sporttery.cn")) {
          return {
            ok: false,
            status: 567,
            headers: {},
            text: async () => "567",
          };
        }
        if (url.includes("trade.500.com/jczq/")) {
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
            text: async () =>
              make500HunheHtmlSample({
                matchId: "2043999",
                matchNumStr: "周四099",
                home: "备份主队",
                away: "备份客队",
              }),
          };
        }
        return { ok: false, status: 503, headers: {}, text: async () => "" };
      };

      // Runtime #1: push signed snapshot with official payload
      const rt1 = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => nowMs,
        randomFn: () => 0.6, // picks 500-hunhe if not guarded
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: fetchStub,
      });
      const origDrain = rt1.historyCoordinator.drainPendingOpenQuotes.bind(
        rt1.historyCoordinator
      );
      rt1.historyCoordinator.drainPendingOpenQuotes = async (arg: unknown) => {
        drainCalls += 1;
        return origDrain(arg as never);
      };

      try {
        const pushPayload = makeOfficialCalcPayload({
          matchId: 2043301,
          matchNumStr: "周四007",
          home: "东京FC",
          away: "名古屋鲸八",
          updateDate: "2026-11-26",
          updateTime: "14:00:00",
        });
        const rPush = makeSignedReq(
          pushPayload,
          "nonce_persist_restart_001",
          nowMs
        );
        await rt1.gateway.handleRequest(
          rPush.req,
          rPush.res,
          "/api/internal/feed-push"
        );
        const pushOut = rPush.parse();
        assert.equal(pushOut.statusCode, 200);
        assert.ok(
          drainCalls >= 1,
          "/api/internal/feed-push must trigger drainPendingOpenQuotes during open hours"
        );
      } finally {
        await rt1.dispose();
      }

      // Runtime #2 on same dataDir after 2 minutes (14:02 BJ, inside 310s nonce window & <35m guard)
      nowMs = Date.parse("2026-11-26T06:02:00.000Z");
      const rt2 = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => nowMs,
        randomFn: () => 0.6,
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: fetchStub,
      });

      try {
        // 1) Replay exact same nonce after restart -> must be 409 NONCE_REPLAYED
        const replayPayload = makeOfficialCalcPayload({ matchId: 2043301 });
        const rReplay = makeSignedReq(
          replayPayload,
          "nonce_persist_restart_001",
          nowMs
        );
        await rt2.gateway.handleRequest(
          rReplay.req,
          rReplay.res,
          "/api/internal/feed-push"
        );
        assert.equal(rReplay.parse().statusCode, 409);
        assert.equal(rReplay.parse().json?.error, "NONCE_REPLAYED");

        // Advance to +10 minutes (14:10 BJ < 35m)
        nowMs = Date.parse("2026-11-26T06:10:00.000Z");

        // 2) Normal load after restart uses persisted 35m official-live guard (NOT 500-hunhe backup)
        const afterRestart = await rt2.appRoutes.ensureMatchesLoaded(true);
        assert.equal(afterRestart.boardMeta.source, "official-live");
        assert.equal(afterRestart.boardMeta.boardState, "fresh");
        assert.equal(afterRestart.matches[0].id, "2043301");

        // 3) Intervening onlyOfficial: true failure (external 567) must NOT invalidate 35m guard or downgrade cached board
        await rt2.appRoutes.ensureMatchesLoaded(true, { onlyOfficial: true });
        const cachedAfterOnlyOfficial =
          await rt2.appRoutes.ensureMatchesLoaded(false);
        assert.equal(cachedAfterOnlyOfficial.boardMeta.source, "official-live");
        assert.equal(cachedAfterOnlyOfficial.boardMeta.boardState, "fresh");
        assert.equal(cachedAfterOnlyOfficial.matches[0].id, "2043301");

        const forcedAfterOnlyOfficial =
          await rt2.appRoutes.ensureMatchesLoaded(true);
        assert.equal(forcedAfterOnlyOfficial.boardMeta.source, "official-live");
        assert.equal(forcedAfterOnlyOfficial.boardMeta.boardState, "fresh");
        assert.equal(forcedAfterOnlyOfficial.matches[0].id, "2043301");
      } finally {
        await rt2.dispose();
      }

      // Runtime #3: verify appRoutes else-fallback branch does NOT replace fresh official-live <35m
      // and verify ingestSignedPushSnapshot updates officialSaleOpen (closed-night at 21:30 BJ)
      const nightDir = path.join(tmpDir, "night");
      let nightNowMs = Date.parse("2026-11-26T13:30:00.000Z"); // 21:30 BJ
      const rtNight = createYouJingRuntime({
        dataDir: nightDir,
        nowFn: () => nightNowMs,
        randomFn: () => 0.1,
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: async () => ({
          ok: false,
          status: 503,
          headers: {},
          text: async () => "",
        }),
      });
      try {
        const closedSalePayload = makeOfficialCalcPayload({
          matchId: 2043302,
          offLineSaleStatus: 0,
          updateDate: "2026-11-26",
          updateTime: "21:30:00",
        });
        const rClosed = makeSignedReq(
          closedSalePayload,
          "nonce_night_closed_001",
          nightNowMs
        );
        await rtNight.gateway.handleRequest(
          rClosed.req,
          rClosed.res,
          "/api/internal/feed-push"
        );
        assert.equal(rClosed.parse().statusCode, 200);
        assert.equal(rtNight.politeGateway!.isMarketOpenNow(), false);

        // Even when all outbound sources fail (else branch) within 35m of push (using open time), official-live stays intact
        nightNowMs = Date.parse("2026-11-26T06:00:00.000Z"); // 14:00 BJ
        const openDayDir = path.join(tmpDir, "else-guard");
        const rtElse = createYouJingRuntime({
          dataDir: openDayDir,
          nowFn: () => nightNowMs,
          randomFn: () => 0.1,
          enforceMarketHours: true,
          pushHmacSecret: pushSecret,
          fetchFn: async () => ({
            ok: false,
            status: 503,
            headers: {},
            text: async () => "",
          }),
        });
        try {
          const openPayload = makeOfficialCalcPayload({ matchId: 2043303 });
          const rOpen = makeSignedReq(
            openPayload,
            "nonce_else_guard_001",
            nightNowMs
          );
          await rtElse.gateway.handleRequest(
            rOpen.req,
            rOpen.res,
            "/api/internal/feed-push"
          );
          assert.equal(rOpen.parse().statusCode, 200);

          nightNowMs += 10 * 60_000;
          // Exhaust/fail all sources -> would enter else fallback in appRoutes if not guarded
          const guardedElse = await rtElse.appRoutes.ensureMatchesLoaded(true);
          assert.equal(guardedElse.boardMeta.source, "official-live");
          assert.equal(guardedElse.boardMeta.boardState, "fresh");
          assert.equal(guardedElse.matches[0].id, "2043303");
        } finally {
          await rtElse.dispose();
        }
      } finally {
        await rtNight.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Review Fix (c): syncMatchResults skips 35m short-circuit on explicit beginDate/endDate and reads disk cache on closed-hours restart", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec21-rf-c-"));
    try {
      let nowMs = Date.parse("2026-11-26T06:00:00.000Z"); // 14:00 BJ
      const stateFilePath = path.join(tmpDir, "state.json");
      const snapshotFilePath = path.join(tmpDir, "snap.json");
      const resultsCacheFilePath = path.join(tmpDir, "results.json");
      const pushSecret = "m5_test_push_secret_results_c";
      const fetchedResultUrls: string[] = [];

      const makeGateway = () =>
        createPoliteMultisourceGateway({
          stateFilePath,
          snapshotFilePath,
          resultsCacheFilePath,
          pushHmacSecret: pushSecret,
          nowFn: () => nowMs,
          enforceMarketHours: true,
          fetchFn: async (url: string) => {
            if (url.includes("getUniformMatchResultV1.qry")) {
              fetchedResultUrls.push(url);
              return {
                ok: true,
                status: 200,
                headers: { "content-type": "application/json" },
                text: async () =>
                  JSON.stringify({
                    errorCode: "0",
                    success: true,
                    value: {
                      total: 1,
                      pages: 1,
                      matchResult: [
                        {
                          matchId: 2040001,
                          matchNumStr: "周二001",
                          homeTeamAbbName: "历史主",
                          awayTeamAbbName: "历史客",
                          sectionsNo999: "3:2",
                          sectionsNo1: "1:1",
                          matchDate: "2026-11-10",
                          matchResultStatus: "2",
                        },
                      ],
                    },
                  }),
              };
            }
            return {
              ok: false,
              status: 503,
              headers: {},
              text: async () => "",
            };
          },
        });

      const gw1 = makeGateway();
      const pushBody = JSON.stringify({
        ...makeOfficialCalcPayload({ matchId: 2043401 }),
        __officialResultsRaw: [
          {
            errorCode: "0",
            success: true,
            value: {
              total: 1,
              pages: 1,
              matchResult: [
                {
                  matchId: 2043401,
                  matchNumStr: "周四001",
                  homeTeamAbbName: "大阪钢巴",
                  awayTeamAbbName: "曼谷港务",
                  sectionsNo999: "1:0",
                  sectionsNo1: "0:0",
                  matchDate: "2026-11-26",
                  matchResultStatus: "2",
                },
              ],
            },
          },
        ],
      });
      const nonce1 = "nonce_results_cache_001";
      const sig1 = crypto
        .createHmac("sha256", pushSecret)
        .update(`${nowMs}.${nonce1}.${pushBody}`)
        .digest("hex");
      const ingest1 = await gw1.ingestSignedPushSnapshot({
        rawBodyText: pushBody,
        timestampHeader: String(nowMs),
        nonceHeader: nonce1,
        signatureHeader: sig1,
      });
      assert.equal(ingest1.ok, true);

      // 1) Default syncMatchResults (even with forceRefresh: true) short-circuits within 35m -> 0 outbound calls
      const shortCircuitRes = await gw1.syncMatchResults({
        forceRefresh: true,
      });
      assert.equal(shortCircuitRes.get("2043401")?.fullScore, "1:0");
      assert.equal(fetchedResultUrls.length, 0);

      // 2) Explicit beginDate/endDate MUST NOT short-circuit to 3-day pushed cache
      const backfillRes = await gw1.syncMatchResults({
        beginDate: "2026-11-10",
        endDate: "2026-11-12",
      });
      assert.equal(fetchedResultUrls.length, 1);
      assert.match(fetchedResultUrls[0], /matchBeginDate=2026-11-10/);
      assert.equal(backfillRes.get("2040001")?.fullScore, "3:2");
      assert.equal(backfillRes.get("2043401")?.fullScore, "1:0");

      // 3) Closed-hours restart (08:00 BJ = 00:00 UTC next day) reads disk results cache with 0 outbound calls
      nowMs = Date.parse("2026-11-27T00:00:00.000Z"); // 08:00 BJ
      const beforeClosedCount = fetchedResultUrls.length;
      const gw2 = makeGateway();
      const closedRes = await gw2.syncMatchResults();
      assert.equal(fetchedResultUrls.length, beforeClosedCount);
      assert.equal(closedRes.get("2043401")?.fullScore, "1:0");
      assert.equal(closedRes.get("2040001")?.fullScore, "3:2");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Review Fix (d): computeSafeLaunchJitterMs stays in [17_000, 163_000] and avoids quarter-hour ±35s and :00 minute marks", () => {
    const randCases = [0, 0.001, 0.25, 0.5, 0.75, 0.999];
    for (let i = 0; i < 120; i++) {
      // Sweep every 30s across a full 1-hour cycle including exact :00/:15/:30/:45 marks
      const nowMs = Date.parse("2026-11-26T06:00:00.000Z") + i * 30_000;
      for (const rv of randCases) {
        const jitterMs = computeSafeLaunchJitterMs(nowMs, () => rv);
        assert.ok(
          jitterMs >= 17_000 && jitterMs <= 163_000,
          `Jitter ${jitterMs}ms out of [17_000, 163_000]`
        );
        assert.notEqual(
          jitterMs % 60_000,
          0,
          `Jitter ${jitterMs}ms must not be exact whole minute`
        );
        const targetMs = nowMs + jitterMs;
        const secInHour =
          (((targetMs % 3_600_000) + 3_600_000) % 3_600_000) / 1000;
        const remQ = secInHour % 900;
        const distQ = Math.min(remQ, 900 - remQ);
        assert.ok(
          distQ > 35,
          `Target landed too close (${distQ}s) to quarter-hour mark`
        );
        const modMin = ((targetMs % 60_000) + 60_000) % 60_000;
        assert.ok(
          modMin >= 1_500 && modMin <= 58_500,
          `Target landed too close to :00 minute mark (modMin=${modMin}ms)`
        );
      }
    }
  });
});
