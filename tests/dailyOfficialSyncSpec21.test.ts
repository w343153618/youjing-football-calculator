import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  computePoliteRandomIntervalMs,
  createPoliteMultisourceGateway,
} from "../server/politeScraperGateway.mjs";
import { detectSoftBlockResponse } from "../server/multisourceParsers.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";

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
});
