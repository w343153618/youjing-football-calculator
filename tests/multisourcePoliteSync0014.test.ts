import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computePoliteRandomIntervalMs,
  createPoliteMultisourceGateway,
  evaluateMarketHoursGate,
} from "../server/politeScraperGateway.mjs";
import { getPhysicalTicketBlockReason } from "../src/workspace/ticketExport.ts";
import { evaluateQuantWorkspace } from "../server/quantEngine.mjs";

function makeOfficialCalcPayload({
  matchId = 2043004,
  matchNumStr = "周三001",
  home = "大阪钢巴",
  away = "曼谷港务",
  hadOdds = [1.18, 5.85, 8.25],
  hhadOdds = [2.78, 3.8, 1.94],
  goalLine = "-2",
  updateDate = "2026-11-25",
  updateTime = "14:10:00",
  offLineSaleStatus = 1,
  singleOpen = 1,
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
                  bettingSingle: singleOpen,
                  bettingAllup: 1,
                  cbtValue: 1,
                  single: singleOpen,
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
  matchNumStr = "周三001",
  home = "大阪钢巴",
  away = "曼谷港务",
  hadOdds = [1.18, 5.85, 8.25],
  hhadOdds = [2.78, 3.8, 1.94],
  goalLine = "-2",
} = {}) {
  return (
    `<!doctype html><html><body><table><tbody>
    <tr class="bet-tb-tr" data-id="${matchId}" data-homesxname="${home}" data-awaysxname="${away}" data-matchdate="2026-11-25" data-matchtime="18:00" data-rangqiu="${goalLine}" data-simpleleague="亚冠" data-processdate="2026-11-25" data-subactive="bfdg:1,bfgg:1,bqdg:1,bqgg:1,jqdg:1,jqgg:1,nspfdg:1,nspfgg:1,spfdg:0,spfgg:1" data-matchnum="${matchNumStr}" data-isend="0">
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

describe("Spec 0014 (#20): Market-Hours Dormancy, Non-Grid Jitter, Persistent Identity & 5-Source Failover", () => {
  it("Slice 1: enforces 0 outbound requests before 11:00 BJ and after official night close, and guarantees non-integer anti-quarter-hour jitter", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-polite-s1-"));
    try {
      // 08:30 Beijing Time = 00:30 UTC -> strictly closed
      let nowMs = Date.parse("2026-11-25T00:30:00.000Z");
      let outboundCount = 0;
      const gw = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban.json"),
        snapshotFilePath: path.join(tmpDir, "snap.json"),
        nowFn: () => nowMs,
        randomFn: () => 0.05,
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

      const morningRes = await gw.syncLiveBoard({ isManualRefresh: true });
      assert.equal(
        outboundCount,
        0,
        "08:30 BJ must make 0 outbound requests even on manual refresh"
      );
      assert.equal(morningRes.boardMeta.boardState, "market-closed");
      assert.equal(morningRes.boardMeta.isFallbackReadOnly, true);

      // Advance to 14:20 Beijing Time (06:20 UTC) -> open market hours
      nowMs = Date.parse("2026-11-25T06:20:00.000Z");
      const openRes = await gw.syncLiveBoard({ isManualRefresh: false });
      assert.equal(outboundCount, 1);
      assert.equal(openRes.matches.length, 1);

      // Manual refresh within < 5 minutes makes 0 outbound requests (debounce guard)
      nowMs += 90_000;
      const debouncedRes = await gw.syncLiveBoard({ isManualRefresh: true });
      assert.equal(outboundCount, 1, "<5m manual refresh must be debounced");
      assert.equal(debouncedRes.debounced, true);

      // Night official stop-sale (offLineSaleStatus = 0 at 21:30 BJ) locks night dormancy
      nowMs = Date.parse("2026-11-25T13:30:00.000Z"); // 21:30 BJ
      const nightGw = createPoliteMultisourceGateway({
        nowFn: () => nowMs,
        enforceMarketHours: true,
        randomFn: () => 0.05, // pick official first
        fetchFn: async () => {
          outboundCount += 1;
          return {
            ok: true,
            status: 200,
            headers: { "content-type": "application/json" },
            text: async () =>
              JSON.stringify(makeOfficialCalcPayload({ offLineSaleStatus: 0 })),
          };
        },
      });
      await nightGw.syncLiveBoard();
      const countAfterStopNotice = outboundCount;
      nowMs += 20 * 60_000;
      await nightGw.syncLiveBoard({ isManualRefresh: true });
      assert.equal(
        outboundCount,
        countAfterStopNotice,
        "Once official offLineSaleStatus=0 is observed at night, subsequent polls must make 0 requests"
      );

      // Verify 300 jitter samples: never exact whole minute, never within +-35s of :00/:15/:30/:45
      for (let i = 0; i < 300; i++) {
        const base = Date.parse("2026-11-25T04:00:00.000Z") + i * 11_731;
        const d = computePoliteRandomIntervalMs(base);
        assert.ok(d >= 853_137 && d <= 1_450_000, `Unexpected delay ${d}`);
        assert.notEqual(
          d % 60_000,
          0,
          "Delay must never be exact integer minutes"
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
      assert.equal(
        evaluateMarketHoursGate({ nowMs: Date.parse("2026-11-25T02:59:00Z") })
          .isOpen,
        false
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 2: persists 30-day per-domain browser identity & cookies, detects Soft-Block 200s, fails over in 0 retries with 30m->2h->6h cooldown, and prevents stale backup price regression", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-polite-s2-"));
    try {
      let nowMs = Date.parse("2026-11-25T06:30:00.000Z"); // 14:30 BJ
      const calls: Array<{ url: string; ua: string; cookie: string }> = [];
      let mode: "overseas-567-and-softblock" | "cookie-check" | "stale-backup" =
        "overseas-567-and-softblock";

      // Deterministic random sequence so order is predictable
      let randSeq = 0.01;
      const gw = createPoliteMultisourceGateway({
        stateFilePath: path.join(tmpDir, "anti-ban.json"),
        snapshotFilePath: path.join(tmpDir, "snap.json"),
        nowFn: () => nowMs,
        randomFn: () => randSeq,
        enforceMarketHours: true,
        fetchFn: async (
          url: string,
          init?: { headers?: Record<string, string> }
        ) => {
          const hdrs = init?.headers || {};
          calls.push({
            url,
            ua: hdrs["User-Agent"] || "",
            cookie: hdrs.Cookie || "",
          });
          if (url.includes("webapi.sporttery.cn")) {
            if (mode === "stale-backup") {
              return {
                ok: true,
                status: 200,
                headers: { "content-type": "application/json" },
                text: async () =>
                  JSON.stringify(
                    makeOfficialCalcPayload({
                      hadOdds: [1.15, 6.1, 8.6],
                      updateDate: "2026-11-25",
                      updateTime: "15:00:00",
                    })
                  ),
              };
            }
            // Simulate Singapore TencentEdgeOne HTTP 567 block
            return {
              ok: false,
              status: 567,
              headers: { "content-type": "text/html" },
              text: async () => "<html>TencentEdgeOne 567</html>",
            };
          }
          if (url.includes("cp.zgzcw.com")) {
            // Simulate fake HTTP 200 WAF JS shell (Soft-Block!)
            return {
              ok: true,
              status: 200,
              headers: { "content-type": "text/html" },
              text: async () =>
                "<html><script>var acw_sc__v2='deadbeef';</script>" +
                "x".repeat(700) +
                "</html>",
            };
          }
          if (url.includes("trade.500.com")) {
            return {
              ok: true,
              status: 200,
              headers: {
                "content-type": "text/html; charset=utf-8",
                "set-cookie": "visit_id=v500_persisted; Path=/",
              },
              text: async () =>
                make500HunheHtmlSample({
                  hadOdds:
                    mode === "stale-backup"
                      ? [1.22, 5.5, 7.9]
                      : [1.18, 5.85, 8.25],
                }),
            };
          }
          return { ok: false, status: 503, headers: {}, text: async () => "" };
        },
      });

      // Round 1: sporttery-pc fails with 567 (0 retries!) -> sporttery-wap fails with 567 (0 retries!) -> 500-hunhe succeeds!
      const r1 = await gw.syncLiveBoard();
      assert.equal(r1.source, "multisource-backup");
      assert.equal(r1.providerId, "500-hunhe");
      assert.equal(r1.matches.length, 1);
      assert.equal(r1.matches[0].id, "2043004");
      assert.equal(r1.matches[0].pools.HAD.confirmedSaleRights.single, false);

      // Verify 0 retries on sporttery-pc & sporttery-wap (each called at most once!) and 30m cooldown applied
      const pcCallsR1 = calls.filter((c) => c.url.includes("channel=c")).length;
      assert.equal(pcCallsR1, 1, "Failed source must have 0 immediate retries");
      const snapStatus = gw.getAntiBanStatusSnapshot();
      const pcHealth = snapStatus.sources.find(
        (s: { id: string }) => s.id === "sporttery-pc"
      );
      assert.ok(
        (pcHealth?.coolingRemainingSec ?? 0) >= 1790,
        "1st failure must enter ~30m cooldown"
      );

      // Round 2 (20m later: sporttery-pc & wap still in 30m cooldown!):
      // Verify 500-hunhe reuses the EXACT SAME User-Agent AND sends back persisted Cookie!
      const first500Call = calls.find((c) => c.url.includes("trade.500.com"))!;
      nowMs += 20 * 60_000;
      mode = "cookie-check";
      await gw.syncLiveBoard();
      const all500Calls = calls.filter((c) => c.url.includes("trade.500.com"));
      assert.equal(all500Calls.length, 2);
      assert.equal(
        all500Calls[1].ua,
        first500Call.ua,
        "Per-domain browser User-Agent must stay 100% consistent across polls"
      );
      assert.match(
        all500Calls[1].cookie,
        /visit_id=v500_persisted/,
        "Persisted visitor cookie must be re-sent on subsequent requests"
      );

      // Round 3: Test non-regressive timestamp protection (official 15:00 quote 1.15 must NOT be overwritten by older backup timestamp)
      nowMs = Date.parse("2026-11-25T07:05:00.000Z"); // 15:05 BJ (>30m cooldown expired)
      mode = "stale-backup";
      randSeq = 0.01; // hit official 15:00 quote (1.15)
      const offFresh = await gw.syncLiveBoard();
      assert.equal(offFresh.source, "official-live");
      assert.equal(offFresh.matches[0].pools.HAD.options[0].odds, 1.15);

      // Suppose a backup board carrying an older timestamp (14:55 BJ, odds 1.22) arrives -> 1.15 is preserved!
      const olderMs = Date.parse("2026-11-25T06:55:00.000Z");
      nowMs = olderMs;
      randSeq = 0.65; // pick 500-hunhe
      const mergedAfterLag = await gw.syncLiveBoard();
      assert.equal(
        mergedAfterLag.matches[0].pools.HAD.options[0].odds,
        1.15,
        "Older backup quote must never regress newer official pool quote"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 3: integrates full runtime backup-board simulation, pre-print official verification, HMAC push receiver & 0ms Iron-Cage Manual Q&A", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-polite-s3-"));
    try {
      const nowMs = Date.parse("2026-11-25T06:30:00.000Z"); // 14:30 BJ
      let officialReachable = false;
      const pushSecret = "test_hmac_push_secret_2026_secure";

      const runtime = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => nowMs,
        randomFn: () => 0.55,
        enforceMarketHours: true,
        pushHmacSecret: pushSecret,
        fetchFn: async (url: string) => {
          if (url.includes("webapi.sporttery.cn")) {
            if (!officialReachable) {
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

      try {
        // 1) Initial load uses backup board seamlessly when official returns 567
        const loaded = await runtime.appRoutes.ensureMatchesLoaded(false);
        assert.equal(loaded.boardMeta.source, "multisource-backup");
        assert.equal(loaded.boardMeta.boardState, "backup-live");
        assert.equal(loaded.boardMeta.isFallbackReadOnly, false);
        assert.equal(loaded.matches.length, 1);

        // 2) Quant workspace (3+1 portfolio & audit) works 100% on backup board, while physical shopkeeper print is gated
        const ws = evaluateQuantWorkspace(
          {
            picks: [
              {
                matchId: "2043004",
                matchNumStr: "周三001",
                poolCode: "HAD",
                optionKey: "h",
                label: "主胜",
                odds: 1.18,
                canSingle: true,
                canAllUp: true,
              },
            ],
            multiple: 1,
            passSpec: { mode: "free", passSizes: [1] },
          },
          loaded.matches
        );
        const blockMsg = getPhysicalTicketBlockReason(
          loaded.matches,
          loaded.boardMeta,
          ws.manualReport,
          ws.manualReport.terminalPhysicalSlips ?? []
        );
        assert.match(String(blockMsg), /多源备份同步盘/);

        // 3) Domestic light-node HMAC-SHA256 signed push upgrades board to official-live and rejects replay
        const bodyStr = JSON.stringify(makeOfficialCalcPayload());
        const nonce = "nonce_unique_12345678";
        const sig = crypto
          .createHmac("sha256", pushSecret)
          .update(`${nowMs}.${nonce}.${bodyStr}`)
          .digest("hex");
        const pushOk = await runtime.politeGateway.ingestSignedPushSnapshot({
          rawBodyText: bodyStr,
          timestampHeader: String(nowMs),
          nonceHeader: nonce,
          signatureHeader: sig,
        });
        assert.equal(pushOk.ok, true);
        assert.equal(pushOk.boardMeta.source, "official-live");

        const replayAttempt =
          await runtime.politeGateway.ingestSignedPushSnapshot({
            rawBodyText: bodyStr,
            timestampHeader: String(nowMs),
            nonceHeader: nonce,
            signatureHeader: sig,
          });
        assert.equal(replayAttempt.ok, false);
        assert.equal(replayAttempt.status, 409);

        // 4) Iron-Cage Manual Q&A serves 0ms local KB answers for both new terms
        const adminBoot = runtime.accountManager.listAccounts()[0];
        const qaDormancy = await runtime.manualQaEngine.answerManualQuestion({
          userId: adminBoot.id,
          question: "为什么早上11点前休市不刷新？什么是开休市静默门禁？",
          ip: "127.0.0.1",
        });
        assert.equal(qaDormancy.ok, true);
        assert.equal(qaDormancy.source, "local-kb");
        assert.match(qaDormancy.answer, /开休市静默门禁/);

        const qaBackup = await runtime.manualQaEngine.answerManualQuestion({
          userId: adminBoot.id,
          question: "什么是多源备份同步盘？",
          ip: "127.0.0.1",
        });
        assert.equal(qaBackup.ok, true);
        assert.equal(qaBackup.source, "local-kb");
        assert.match(qaBackup.answer, /多源备份同步盘/);
      } finally {
        await runtime.dispose();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
