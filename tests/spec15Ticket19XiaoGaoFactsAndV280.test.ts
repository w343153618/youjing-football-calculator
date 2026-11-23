import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  FALLBACK_MATCHES,
  buildXiaoGaoWarnings,
  devigPoolProbabilities,
  evaluateQuantWorkspace,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import { reconcileComboAlertsToMatchMap } from "../server/appRoutes.mjs";
import {
  APP_GROUND_TRUTH_MANUAL_SPEC,
  LOCAL_CURATED_QA,
  createManualQaEngine,
} from "../server/manualQaEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  createSecurityShield,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import { FROZEN_PRODUCTION_MODEL_VERSION } from "../server/history/exposureAndCalibrationMonitor.mjs";
import { runRepositoryGuardrails } from "../scripts/check-guardrails.mjs";
import {
  createSportteryHistoryCoordinator,
  parseBeijingDateTimeMs,
} from "../server/history/historyCoordinator.mjs";
import { hydrateMatchesWithDualAxisMovement } from "../server/history/dualAxisMovement.mjs";
import {
  buildComboDiagnosisContext,
  buildSingleMatchDiagnosisContext,
  createXiaoGaoService,
  matchesCanonicalSportteryItem,
} from "../server/xiaogaoCore.mjs";
import {
  MANUAL_CHAPTER_SPECS,
  MANUAL_TOPICS,
  QUICK_QA_PILLS,
  matchManualTopics,
} from "../src/manual/manualCatalog.ts";
import { createWorkbenchController } from "../src/workspace/workbenchController.ts";
import type { MatchItem, SelectedPick } from "../src/prototype/quantTypes.ts";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const REAL_BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  "sec-fetch-mode": "cors",
};

function makeExchange({
  method = "POST",
  url = "/",
  headers = {},
  body = undefined,
  remoteAddress = "198.51.100.66",
}: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  remoteAddress?: string;
}) {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries({ ...REAL_BROWSER_HEADERS, ...headers }).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ])
  );
  req.socket = { remoteAddress };
  req.destroy = () => {};

  let statusCode = 200;
  const outHeaders: Record<string, unknown> = {};
  const chunks: Buffer[] = [];
  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(v: number) {
      statusCode = v;
    },
    setHeader(k: string, v: unknown) {
      outHeaders[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return outHeaders[k.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, unknown>) {
      statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          outHeaders[k.toLowerCase()] = v;
        }
      }
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        );
      }
    },
  } as any;

  queueMicrotask(() => {
    if (body !== undefined) {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      req.emit("data", Buffer.from(raw, "utf8"));
    }
    req.emit("end");
  });

  return {
    req,
    res,
    read() {
      return {
        statusCode,
        headers: outHeaders,
        body: Buffer.concat(chunks).toString("utf8"),
      };
    },
  };
}

async function sendSignedRuntimeCall(
  gateway: any,
  sess: {
    sid: string;
    aesKey: Buffer;
    hmacKey: Buffer;
    authToken?: string;
  },
  endpoint: string,
  payload: unknown,
  nowMs: number,
  nonceNum: number
) {
  const ts = String(nowMs);
  const nonce = nonceNum.toString(16).padStart(32, "0");
  const env = encryptEnvelope(sess.aesKey, payload);
  const sig = computeEnvelopeHmacHex(
    sess.hmacKey,
    sess.sid,
    endpoint,
    ts,
    nonce,
    env.iv,
    env.d
  );
  const cookieParts = [`yj_sh_sid=${sess.sid}`];
  if (sess.authToken) cookieParts.push(`yj_auth_tok=${sess.authToken}`);
  const ex = makeExchange({
    method: "POST",
    url: `/api/${endpoint}`,
    headers: {
      "content-type": "application/json",
      cookie: cookieParts.join("; "),
      "x-yj-sid": sess.sid,
      "x-yj-ts": ts,
      "x-yj-nonce": nonce,
      "x-yj-sig": sig,
    },
    body: env,
  });
  await gateway.handleRequest(ex.req, ex.res, `/api/${endpoint}`);
  const r = ex.read();
  if (r.statusCode !== 200) {
    return { statusCode: r.statusCode, rawBody: r.body, decrypted: null };
  }
  const parsed = JSON.parse(r.body);
  return {
    statusCode: r.statusCode,
    rawBody: r.body,
    decrypted: decryptEnvelope(
      sess.aesKey,
      parsed.payload.iv,
      parsed.payload.d
    ),
  };
}

function buildSubMatchRaw({
  matchId,
  matchNumStr,
  matchDate,
  matchTime,
  leagueId = 88,
  leagueAbbName = "英超",
  homeTeamId,
  homeTeamAbbName,
  awayTeamId,
  awayTeamAbbName,
  had = { h: "1.82", d: "3.35", a: "3.80", hf: "-1", df: "0", af: "1" },
  hhad = {
    goalLine: "-1",
    h: "3.45",
    d: "3.40",
    a: "1.82",
    hf: "0",
    df: "0",
    af: "0",
  },
}: {
  matchId: string;
  matchNumStr: string;
  matchDate: string;
  matchTime: string;
  leagueId?: number | string;
  leagueAbbName?: string;
  homeTeamId: number | string;
  homeTeamAbbName: string;
  awayTeamId: number | string;
  awayTeamAbbName: string;
  had?: Record<string, string>;
  hhad?: Record<string, string>;
}) {
  return {
    matchId,
    matchNumStr,
    matchDate,
    matchTime,
    businessDate: matchDate,
    leagueId,
    leagueAbbName,
    homeTeamId,
    homeTeamAbbName,
    awayTeamId,
    awayTeamAbbName,
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
        bettingSingle: 1,
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
      updateDate: matchDate,
      updateTime: "16:20:00",
      ...had,
    },
    hhad: {
      updateDate: matchDate,
      updateTime: "16:20:00",
      ...hhad,
    },
    ttg: {
      updateDate: matchDate,
      updateTime: "16:00:00",
      s0: "9.50",
      s1: "4.20",
      s2: "3.15",
      s3: "3.60",
      s4: "6.20",
      s5: "12.50",
      s6: "25.00",
      s7: "34.00",
    },
    hafu: {
      updateDate: matchDate,
      updateTime: "16:00:00",
      hh: "2.85",
      hd: "14.50",
      ha: "32.00",
      dh: "4.40",
      dd: "4.90",
      da: "7.80",
      ah: "26.00",
      ad: "14.50",
      aa: "6.10",
    },
    crs: {
      updateDate: matchDate,
      updateTime: "16:00:00",
      s01s00: "6.00",
      s02s00: "7.80",
      s02s01: "7.50",
      s00s00: "9.50",
      s01s01: "6.20",
      s00s01: "9.80",
      s01s02: "11.50",
      s1sh: "35.00",
      s1sd: "65.00",
      s1sa: "45.00",
    },
  };
}

function makePick(
  m: MatchItem,
  poolCode: "HAD" | "HHAD",
  optionKey: string
): SelectedPick {
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
}

describe("Spec #15 · Ticket #19: A3 XiaoGao Objective Historical Facts, 3 Live Seam Fixes, Manual KB Alignment & v2.8.0 Seal", () => {
  it("Slice 1 (A3 Dual-Link Objective Historical Facts & Read-Only Kernel Isolation): injects identical rest-interval upper bounds, 90d point-in-time objective ledger (N>=8 vs 0<N<8 vs 0), dual-axis movement, and news-odds timeline alignment across single & combo prompts, caches, and empty-response fallbacks while preserving 100% frozen quant output", async () => {
    const tmpDir = makeTempDir("yj-spec15-t19-slice1-");
    const decisionEpochMs = parseBeijingDateTimeMs("2026-11-20", "17:00:00")!;
    let clock = decisionEpochMs;
    let nonceSeq = 1;

    // Build historical fixtures:
    // - Team 101 (阿森纳):
    //   * Last match kickoff: 2026-11-18 10:00:00 vs target kickoff 2026-11-20 22:00:00 -> 60.0h (< 84h!)
    //   * Plus 10 settled unembargoed matches in past 90d (8 wins, 1 draw, 1 loss = 25 pts; +1 future/embargoed match that MUST be excluded!)
    // - Team 202 (纽卡斯尔):
    //   * Last match kickoff: 2026-11-15 22:00:00 vs target kickoff 2026-11-20 22:00:00 -> 120.0h (observed diff = 60.0h >= 48h -> triggers display filter!)
    //   * Only 5 settled matches in past 90d (0 < count < 8 -> raw facts ONLY, NO market expectation residual!)
    // - Team 303 (利物浦):
    //   * Last match kickoff: 2026-11-16 20:00:00 vs target kickoff 2026-11-20 23:00:00 -> 99.0h (known side)
    //   * 0 settled matches in past 90d -> 无可核验信息
    // - Team 404 (布莱顿):
    //   * Has 1 past match in uniformMatchResult ("hist-404-nohead") on 2026-10-25 WITHOUT matchHead exact kickoff -> triggers low-frequency non-blocking matchHead fetch & reports known side (利物浦) + 布莱顿 无可核验信息!
    const team101Dates = [
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
      "2026-10-06",
      "2026-10-13",
      "2026-10-20",
      "2026-10-27",
      "2026-11-05",
    ];
    const resultRows: any[] = [];
    let expectedOraclePts = 0;
    for (let i = 0; i < team101Dates.length; i += 1) {
      const hOdds = 1.65;
      const dOdds = 3.55;
      const aOdds = 4.55;
      const devig = devigPoolProbabilities([hOdds, dOdds, aOdds], "shin").probs;
      expectedOraclePts += 3 * devig[0] + devig[1];
      const score = i < 8 ? "2:0" : i === 8 ? "1:1" : "0:1";
      resultRows.push({
        matchId: `hist-101-${i + 1}`,
        matchNum: `周六00${(i % 9) + 1}`,
        matchNumStr: `周六00${(i % 9) + 1}`,
        matchDate: team101Dates[i],
        leagueId: 88,
        leagueNameAbbr: "英超",
        homeTeamId: 101,
        homeTeam: "阿森纳",
        awayTeamId: 900 + i,
        awayTeam: `对手${i + 1}`,
        h: String(hOdds),
        d: String(dOdds),
        a: String(aOdds),
        goalLine: "-1",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "1:0",
        sectionsNo999: score,
      });
    }
    // Add 1 embargoed match on 2026-11-18 (matchDate + 3d = 2026-11-21 > decisionEpochMs 2026-11-20 17:00!)
    // Its kickoff (from matchHead) is 2026-11-18 10:00:00 (used for kickoff rest interval!),
    // while its result is still under 3-day backfill embargo so it MUST NOT enter 90d ledger!
    resultRows.push({
      matchId: "hist-101-recent-kickoff",
      matchNum: "周三001",
      matchNumStr: "周三001",
      matchDate: "2026-11-18",
      leagueId: 88,
      leagueNameAbbr: "英超",
      homeTeamId: 101,
      homeTeam: "阿森纳",
      awayTeamId: 950,
      awayTeam: "狼队",
      h: "1.50",
      d: "3.90",
      a: "5.40",
      goalLine: "-1",
      matchResultStatus: "2",
      poolStatus: "Payout",
      sectionsNo1: "1:0",
      sectionsNo999: "3:0",
    });

    // Team 202: 5 settled matches (3W 1D 1L) + 2026-11-15 kickoff head
    const team202Dates = [
      "2026-09-12",
      "2026-09-26",
      "2026-10-10",
      "2026-10-24",
      "2026-11-15",
    ];
    for (let i = 0; i < team202Dates.length; i += 1) {
      const score = i < 3 ? "1:0" : i === 3 ? "1:1" : "0:2";
      resultRows.push({
        matchId: `hist-202-${i + 1}`,
        matchNum: `周日00${i + 1}`,
        matchNumStr: `周日00${i + 1}`,
        matchDate: team202Dates[i],
        leagueId: 88,
        leagueNameAbbr: "英超",
        homeTeamId: 202,
        homeTeam: "纽卡斯尔",
        awayTeamId: 800 + i,
        awayTeam: `客队${i + 1}`,
        h: "2.05",
        d: "3.25",
        a: "3.20",
        goalLine: "-1",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "0:0",
        sectionsNo999: score,
      });
    }

    // Team 404: 1 settled match on 2026-10-25 WITHOUT head detail initially
    resultRows.push({
      matchId: "hist-404-nohead",
      matchNum: "周日018",
      matchNumStr: "周日018",
      matchDate: "2026-10-25",
      leagueId: 88,
      leagueNameAbbr: "英超",
      homeTeamId: 404,
      homeTeam: "布莱顿",
      awayTeamId: 880,
      awayTeam: "富勒姆",
      h: "1.90",
      d: "3.40",
      a: "3.50",
      goalLine: "-1",
      matchResultStatus: "2",
      poolStatus: "Payout",
      sectionsNo1: "1:0",
      sectionsNo999: "2:1",
    });

    const onDemandHeadCalls: string[] = [];
    let serve404Head = false;

    const historyFetchFn = async (url: string) => {
      if (url.includes("getUniformMatchResultV1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            value: {
              total: resultRows.length,
              pages: 1,
              matchResult: resultRows,
            },
          }),
        };
      }
      if (url.includes("getMatchHeadV1")) {
        const u = new URL(url);
        const mid = u.searchParams.get("sportteryMatchId") || "";
        onDemandHeadCalls.push(mid);
        if (mid === "hist-101-recent-kickoff") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                sportteryMatchId: mid,
                sportteryTournamentId: 88,
                sportteryHomeTeamId: 101,
                sportteryAwayTeamId: 950,
                matchDateTime: "2026-11-18 10:00:00",
                seasonId: "2026",
                seasonName: "26/27",
              },
            }),
          };
        }
        if (mid === "hist-202-5") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                sportteryMatchId: mid,
                sportteryTournamentId: 88,
                sportteryHomeTeamId: 202,
                sportteryAwayTeamId: 804,
                matchDateTime: "2026-11-15 22:00:00",
                seasonId: "2026",
                seasonName: "26/27",
              },
            }),
          };
        }
        if (mid === "hist-303-prev") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                sportteryMatchId: mid,
                sportteryTournamentId: 88,
                sportteryHomeTeamId: 303,
                sportteryAwayTeamId: 899,
                matchDateTime: "2026-11-16 20:00:00",
                seasonId: "2026",
                seasonName: "26/27",
              },
            }),
          };
        }
        if (mid === "hist-404-nohead" && serve404Head) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                sportteryMatchId: mid,
                sportteryTournamentId: 88,
                sportteryHomeTeamId: 404,
                sportteryAwayTeamId: 880,
                matchDateTime: "2026-10-25 21:00:00",
                seasonId: "2026",
                seasonName: "26/27",
              },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes("getFixedBonusV1")) {
        const u = new URL(url);
        const mid = u.searchParams.get("matchId") || "";
        if (mid === "live-m1") {
          // Include:
          // [0] official archive open @ 2026-11-20 09:00:00 (2.10 / 3.25 / 3.10)
          // [1] early quote @ 2026-11-20 16:20:00 (1.82 / 3.35 / 3.80)
          // [2] future closing quote @ 2026-11-20 21:55:00 (1.42 / 4.10 / 6.20) -> MUST be excluded at decisionEpochMs 17:00:00!
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: {
                oddsHistory: {
                  matchId: "live-m1",
                  leagueId: 88,
                  leagueAbbName: "英超",
                  homeTeamId: 101,
                  homeTeamAbbName: "阿森纳",
                  awayTeamId: 202,
                  awayTeamAbbName: "纽卡斯尔",
                  singleList: [{ poolCode: "HAD" }, { poolCode: "HHAD" }],
                  hadList: [
                    {
                      updateDate: "2026-11-20",
                      updateTime: "09:00:00",
                      h: "2.10",
                      d: "3.25",
                      a: "3.10",
                      hf: "0",
                      df: "0",
                      af: "0",
                    },
                    {
                      updateDate: "2026-11-20",
                      updateTime: "16:20:00",
                      h: "1.82",
                      d: "3.35",
                      a: "3.80",
                      hf: "-1",
                      df: "0",
                      af: "1",
                    },
                    {
                      updateDate: "2026-11-20",
                      updateTime: "21:55:00",
                      h: "1.42",
                      d: "4.10",
                      a: "6.20",
                      hf: "-1",
                      df: "1",
                      af: "1",
                    },
                  ],
                },
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ value: {} }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const coordinator = createSportteryHistoryCoordinator({
      dataDir: tmpDir,
      enableCollector: true,
      autoPoll: false,
      fetchFn: historyFetchFn,
      nowFn: () => clock,
    });
    await coordinator.start();

    try {
      await coordinator.backfillResultsWindow({
        beginDate: "2026-09-01",
        endDate: "2026-10-29",
      });
      await coordinator.backfillResultsWindow({
        beginDate: "2026-10-30",
        endDate: "2026-11-20",
      });
      await coordinator.backfillMatchHead("hist-101-recent-kickoff");
      await coordinator.backfillMatchHead("hist-202-5");
      await coordinator.backfillMatchHead("hist-303-prev");
      await coordinator.backfillMatchOpeningQuotes("live-m1");
      onDemandHeadCalls.length = 0;

      const rawLiveMatches = parseSportteryRawJson({
        value: {
          matchInfoList: [
            {
              subMatchList: [
                buildSubMatchRaw({
                  matchId: "live-m1",
                  matchNumStr: "周五001",
                  matchDate: "2026-11-20",
                  matchTime: "22:00:00",
                  homeTeamId: 101,
                  homeTeamAbbName: "阿森纳",
                  awayTeamId: 202,
                  awayTeamAbbName: "纽卡斯尔",
                }),
                buildSubMatchRaw({
                  matchId: "live-m2",
                  matchNumStr: "周五002",
                  matchDate: "2026-11-20",
                  matchTime: "23:00:00",
                  homeTeamId: 303,
                  homeTeamAbbName: "利物浦",
                  awayTeamId: 404,
                  awayTeamAbbName: "布莱顿",
                }),
              ],
            },
          ],
        },
      }) as MatchItem[];

      const snap = coordinator.getSnapshot();
      const hydratedMatches = hydrateMatchesWithDualAxisMovement(
        rawLiveMatches,
        snap,
        {
          nowMs: decisionEpochMs,
          decisionEpochMs,
        }
      ) as MatchItem[];
      const [m1, m2] = hydratedMatches;

      // 1. Verify early-market replay point-in-time gate on m1 dual-axis movement:
      // Future closing quote 1.42 @ 21:55:00 MUST NOT leak at decisionEpochMs 17:00:00!
      const m1HadHMov = m1.pools.HAD.options.find(
        (o) => o.key === "h"
      )?.movement;
      assert.ok(m1HadHMov);
      assert.equal(m1HadHMov.currentOdds, 1.82);
      assert.equal(m1HadHMov.openOdds, 2.1);

      // 2. Build single-match & combo contexts for m1 + m2 (no external news) -> IDENTICAL objective facts!
      const singleCtx1 = buildSingleMatchDiagnosisContext(m1, "", {
        historySnapshot: snap,
        historyCoordinator: coordinator,
        decisionEpochMs,
      });
      const singleCtx2 = buildSingleMatchDiagnosisContext(m2, "主队状态不错", {
        historySnapshot: snap,
        historyCoordinator: coordinator,
        decisionEpochMs,
      });
      const comboCtx = buildComboDiagnosisContext({
        sourceMode: "picked",
        targetMatches: [m1, m2],
        picks: [makePick(m1, "HAD", "h"), makePick(m2, "HAD", "h")],
        userNote: "主队状态不错",
        historySnapshot: snap,
        historyCoordinator: coordinator,
        decisionEpochMs,
      });

      assert.equal(comboCtx.matches.length, 2);
      // Identical objective evidence between single and combo for BOTH m1 and m2:
      assert.equal(
        singleCtx1.restIntervalSummary,
        comboCtx.matches[0].restIntervalSummary,
        "Single and combo contexts MUST share identical restIntervalSummary"
      );
      assert.equal(
        singleCtx1.recentLedgerSummary,
        comboCtx.matches[0].recentLedgerSummary,
        "Single and combo contexts MUST share identical recentLedgerSummary"
      );
      assert.equal(
        singleCtx1.dualAxisSummary,
        comboCtx.matches[0].dualAxisSummary,
        "Single and combo contexts MUST share identical dualAxisSummary"
      );
      assert.equal(
        singleCtx2.restIntervalSummary,
        comboCtx.matches[1].restIntervalSummary
      );
      assert.equal(
        singleCtx2.recentLedgerSummary,
        comboCtx.matches[1].recentLedgerSummary
      );

      // Pillar 1 assertions on m1: 60.0h vs 120.0h, upper-bound caveat,無界 diff caveat, <84h & >=48h filter hit!
      assert.ok(singleCtx1.restIntervalSummary.includes("60.0"));
      assert.ok(singleCtx1.restIntervalSummary.includes("120.0"));
      assert.ok(
        singleCtx1.restIntervalSummary.includes("上界"),
        `Must state upper bound property: ${singleCtx1.restIntervalSummary}`
      );
      assert.ok(
        singleCtx1.restIntervalSummary.includes("无上下界") ||
          singleCtx1.restIntervalSummary.includes("无界"),
        `Must state difference of two upper bounds has no bound on real diff: ${singleCtx1.restIntervalSummary}`
      );
      assert.ok(
        singleCtx1.restIntervalSummary.includes("84") &&
          singleCtx1.restIntervalSummary.includes("48"),
        `Must mark <84h & >=48h display filter condition: ${singleCtx1.restIntervalSummary}`
      );

      // Pillar 1 assertions on m2: 利物浦 known (99.0h upper bound), 布莱顿 missing exact kickoff -> 无可核验信息 + low-frequency non-blocking lookup triggered!
      assert.ok(singleCtx2.restIntervalSummary.includes("99.0"));
      assert.ok(singleCtx2.restIntervalSummary.includes("无可核验信息"));
      await coordinator.flushPendingWork();
      assert.ok(
        onDemandHeadCalls.includes("hist-404-nohead"),
        "Missing previous exact kickoff must trigger low-frequency non-blocking matchHead lookup by matchId"
      );
      const headCallCountBeforeRepeat = onDemandHeadCalls.filter(
        (id) => id === "hist-404-nohead"
      ).length;
      // Immediate second call within low-frequency cooldown must NOT re-spam upstream!
      buildSingleMatchDiagnosisContext(m2, "", {
        historySnapshot: snap,
        historyCoordinator: coordinator,
        decisionEpochMs,
      });
      await coordinator.flushPendingWork();
      assert.equal(
        onDemandHeadCalls.filter((id) => id === "hist-404-nohead").length,
        headCallCountBeforeRepeat,
        "Low-frequency non-blocking head lookup must respect per-match cooldown"
      );

      // Pillar 2 assertions:
      // - 阿森纳 (10 settled unembargoed matches >= 8, 2026-11-18 embargoed match excluded!):
      //   8W 1D 1L = 25 pts vs expectedOraclePts, explicitly stating Shin + independent Poisson [非射门xG]
      assert.ok(
        singleCtx1.recentLedgerSummary.includes("10场") ||
          singleCtx1.recentLedgerSummary.includes("10 场"),
        `Expected 10 unembargoed matches (excluding 2026-11-18 embargoed match), got: ${singleCtx1.recentLedgerSummary}`
      );
      assert.ok(singleCtx1.recentLedgerSummary.includes("25"));
      assert.ok(
        singleCtx1.recentLedgerSummary.includes(expectedOraclePts.toFixed(1)),
        `Expected oracle market points ${expectedOraclePts.toFixed(1)}, got: ${singleCtx1.recentLedgerSummary}`
      );
      assert.ok(
        singleCtx1.recentLedgerSummary.includes("非射门xG") ||
          singleCtx1.recentLedgerSummary.includes("独立泊松"),
        `Must explicitly state goal-diff expectation estimation method: ${singleCtx1.recentLedgerSummary}`
      );
      assert.equal(
        /必然回归|市场追热/.test(singleCtx1.recentLedgerSummary),
        false
      );

      // - 纽卡斯尔 (5 matches, 0 < count < 8): raw W-D-L / goals facts ONLY, NO market expectation comparison for 纽卡斯尔!
      const awayLedgerPart =
        singleCtx1.recentLedgerSummary.split("客队")[1] || "";
      assert.ok(
        awayLedgerPart.includes("5场") || awayLedgerPart.includes("5 场"),
        `Expected 5 observed matches for away team, got: ${awayLedgerPart}`
      );
      assert.ok(awayLedgerPart.includes("3胜1平1负"));
      assert.equal(
        awayLedgerPart.includes("同期市场预期"),
        false,
        `0 < count < 8 must NOT compare against market expectation: ${awayLedgerPart}`
      );

      // - 利物浦 (0 matches): 无可核验信息
      assert.ok(singleCtx2.recentLedgerSummary.includes("无可核验信息"));

      // Pillar 3 assertions: dual-axis movement injected, NO future 1.42 quote!
      assert.ok(singleCtx1.dualAxisSummary.includes("自官方归档首报"));
      assert.equal(singleCtx1.dualAxisSummary.includes("1.42"), false);

      // Pillar 4 assertions:
      // - Without verifiable news (empty or unattributed opinion "主队状态不错") -> 无可核验信息!
      assert.equal(singleCtx1.newsTimelineSummary, "无可核验信息");
      assert.equal(singleCtx2.newsTimelineSummary, "无可核验信息");
      assert.equal(comboCtx.newsTimelineSummary, "无可核验信息");

      // - With explicit verifiable news (source + publish timestamp) -> side-by-side timeline without digested percentage!
      const withVerifiedNewsCtx = buildSingleMatchDiagnosisContext(
        m1,
        "【英超官网 15:40】纽卡斯尔主力门将赛前热身拉伤缺席",
        {
          historySnapshot: snap,
          decisionEpochMs,
        }
      );
      assert.ok(withVerifiedNewsCtx.newsTimelineSummary.includes("15:40"));
      assert.ok(withVerifiedNewsCtx.newsTimelineSummary.includes("16:20"));
      assert.equal(
        /消化\s*\d+%/.test(withVerifiedNewsCtx.newsTimelineSummary),
        false
      );

      // 3. Empty/malformed LLM response fallback & full-stack runtime parity + ADR-0002 read-only isolation:
      const capturedPrompts: string[] = [];
      const fallbackSvc = createXiaoGaoService({
        enableProbe: false,
        nowFn: () => clock,
        transport: async (
          _apiKey: string,
          _model: string,
          messages: Array<{ role: string; content: string }>
        ) => {
          const uMsg = messages.find((x) => x.role === "user")?.content || "";
          capturedPrompts.push(uMsg);
          return "{}"; // Empty JSON -> exercises deterministic fallback outputs!
        },
      });

      const fallbackSingle = await fallbackSvc.analyzeMatch(
        "test-key",
        singleCtx1
      );
      const fallbackCombo = await fallbackSvc.analyzeComboMatches(
        "test-key",
        comboCtx
      );

      // Both prompts contain identical objective facts for m1!
      assert.ok(capturedPrompts[0].includes(singleCtx1.restIntervalSummary));
      assert.ok(capturedPrompts[1].includes(singleCtx1.restIntervalSummary));
      assert.ok(capturedPrompts[0].includes(singleCtx1.recentLedgerSummary));
      assert.ok(capturedPrompts[1].includes(singleCtx1.recentLedgerSummary));
      assert.ok(capturedPrompts[0].includes(singleCtx1.dualAxisSummary));
      assert.ok(capturedPrompts[1].includes(singleCtx1.dualAxisSummary));

      // Empty-response fallback NEVER outputs retired default heat/digested claims!
      const forbiddenDefaultRe =
        /已部分反映市场热度|已部分消化市场一致预期|提前下调消化利好/;
      assert.equal(fallbackSingle.priceInStatus, "无可核验信息");
      assert.equal(fallbackCombo.priceInVerdict, "无可核验信息");
      assert.equal(fallbackCombo.perMatch[0].priceInStatus, "无可核验信息");
      assert.equal(fallbackCombo.perMatch[1].priceInStatus, "无可核验信息");
      assert.equal(
        forbiddenDefaultRe.test(JSON.stringify(fallbackSingle)),
        false
      );
      assert.equal(
        forbiddenDefaultRe.test(JSON.stringify(fallbackCombo)),
        false
      );

      // Full-stack runtime check + ADR-0002 strict read-only isolation (quant outputs 100% unchanged before vs after XiaoGao!)
      const wsBefore = evaluateQuantWorkspace(
        {
          picks: [makePick(m1, "HAD", "h"), makePick(m2, "HAD", "h")],
          multiple: 5,
          targetIds: [m1.id, m2.id],
          budget: 100,
          stance: "objective",
        },
        hydratedMatches
      );

      const runtimeDir = path.join(tmpDir, "rt");
      fs.mkdirSync(runtimeDir, { recursive: true });
      const runtime = createYouJingRuntime({
        dataDir: runtimeDir,
        historyCoordinator: coordinator,
        nowFn: () => clock,
        enableXiaoGaoProbe: false,
        getApiKey: () => "rt-key",
        fetchMatches: async () => ({
          matches: rawLiveMatches,
          syncNote: "官方实盘",
        }),
        xiaogaoTransport: async () =>
          JSON.stringify({
            level: "high",
            tag: "赛程密集观察",
            comboTag: "双关客观核验",
            summary: "主队赛程间隔较短，关注体能分配。",
            priceInStatus: "体彩实盘水位已部分反映市场热度",
            priceInVerdict: "热门场次胜平负水位多已提前下调消化利好",
          }),
      });

      try {
        const created = runtime.accountManager.createAccount({
          username: "t19_member",
          password: "Pass#T19",
          durationHours: 24,
          maxDevices: 2,
          aiEnabled: true,
          dailyAiLimit: 10,
        });
        const bootEx = makeExchange({
          method: "POST",
          url: "/api/security/bootstrap",
          headers: {
            "content-type": "application/json",
            "x-yj-hw": "3".repeat(32),
          },
          body: { v: 1, tz: "Asia/Shanghai", hwFp: "3".repeat(32) },
        });
        await runtime.gateway.handleRequest(
          bootEx.req,
          bootEx.res,
          "/api/security/bootstrap"
        );
        const bootJson = JSON.parse(bootEx.read().body);
        const keys = deriveSessionSubkeys(Buffer.from(bootJson.k, "base64"));
        const sess = { sid: bootJson.sid, ...keys, authToken: "" };
        const loginRes = await sendSignedRuntimeCall(
          runtime.gateway,
          sess,
          "auth/login",
          {
            username: created.user.username,
            password: "Pass#T19",
            hwFp: "3".repeat(32),
          },
          clock,
          nonceSeq++
        );
        sess.authToken = loginRes.decrypted.authToken;

        const rtSingle = await sendSignedRuntimeCall(
          runtime.gateway,
          sess,
          "xiaogao/analyze",
          { matchId: m1.id },
          clock,
          nonceSeq++
        );
        assert.equal(rtSingle.statusCode, 200);
        // Even if LLM tried to hallucinate "已部分反映市场热度" with zero verified news, server enforces 无可核验信息!
        assert.equal(rtSingle.decrypted.alert.priceInStatus, "无可核验信息");

        const rtCombo = await sendSignedRuntimeCall(
          runtime.gateway,
          sess,
          "xiaogao/analyze-combo",
          {
            sourceMode: "picked",
            matchIds: [m1.id, m2.id],
            picks: [makePick(m1, "HAD", "h"), makePick(m2, "HAD", "h")],
            multiple: 5,
          },
          clock,
          nonceSeq++
        );
        assert.equal(rtCombo.statusCode, 200);
        assert.equal(
          rtCombo.decrypted.comboReport.priceInVerdict,
          "无可核验信息"
        );

        const rtComputeAfter = await sendSignedRuntimeCall(
          runtime.gateway,
          sess,
          "quant/compute",
          {
            picks: [makePick(m1, "HAD", "h"), makePick(m2, "HAD", "h")],
            multiple: 5,
            targetIds: [m1.id, m2.id],
            budget: 100,
            stance: "objective",
          },
          clock,
          nonceSeq++
        );
        assert.equal(rtComputeAfter.statusCode, 200);
        // ADR-0002 read-only isolation: portfolioPlans, lines, multiples, fairProb, and payouts are 100% identical!
        assert.deepEqual(
          rtComputeAfter.decrypted.portfolioPlans,
          wsBefore.portfolioPlans
        );
        assert.deepEqual(
          rtComputeAfter.decrypted.effectiveReport.tickets,
          wsBefore.effectiveReport.tickets
        );
        assert.equal(
          rtComputeAfter.decrypted.effectiveReport.expectedValueRate,
          wsBefore.effectiveReport.expectedValueRate
        );
      } finally {
        await runtime.dispose();
      }
    } finally {
      await coordinator.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 2 (Fix All 3 Live XiaoGao Seam Defects): outputs 该玩法无有效报价 on missing/unsold pools (zero fake 12.0% vig), preserves valid 0 (0% oneGoalShareOfWins), enforces 100% strict canonical matchId alignment, and auto-withdraws cached/session/client alerts on pool-mask, goalLine, quote-version or >30m expiry", async () => {
    // 1. Defect 1 & Defect 2: Missing Pool Vig (该玩法无有效报价, never 12.0%) + Preserve Valid 0 (0% card-pan, never 45%)
    const missingPoolAndZeroMatch = structuredClone(
      FALLBACK_MATCHES[0]
    ) as MatchItem;
    // Simulate unsold HAD (buildPool sets vig = 0.12 when unsold!) + invalid HAFU options (odds <= 1) + 0 oneGoalShareOfWins + missing xG
    missingPoolAndZeroMatch.pools.HAD = {
      ...missingPoolAndZeroMatch.pools.HAD,
      selling: false,
      canSingle: false,
      canAllUp: false,
      vig: 0.12,
      payoutRatio: 0.88,
      options: [],
    };
    missingPoolAndZeroMatch.pools.HAFU = {
      ...missingPoolAndZeroMatch.pools.HAFU,
      selling: true,
      vig: 0.12,
      payoutRatio: 0.88,
      options: [
        {
          key: "hh",
          label: "胜胜",
          odds: 0.98,
          trend: 0,
          shinProb: 0,
          fairProb: 0,
        },
      ],
    };
    missingPoolAndZeroMatch.microQuant = {
      ...missingPoolAndZeroMatch.microQuant,
      homeXG: undefined as any,
      awayXG: undefined as any,
      totalXG: undefined as any,
      oneGoalShareOfWins: 0,
    };

    const partnerZeroMatch = structuredClone(FALLBACK_MATCHES[1]) as MatchItem;
    partnerZeroMatch.microQuant = {
      ...partnerZeroMatch.microQuant,
      oneGoalShareOfWins: 0,
    };

    const singleMissingCtx = buildSingleMatchDiagnosisContext(
      missingPoolAndZeroMatch,
      ""
    );
    assert.equal(singleMissingCtx.hadOdds, "该玩法无有效报价");
    assert.ok(
      singleMissingCtx.vigSummary.includes("胜平负：该玩法无有效报价"),
      `Expected HAD missing vig message, got: ${singleMissingCtx.vigSummary}`
    );
    assert.ok(
      singleMissingCtx.vigSummary.includes("半全场：该玩法无有效报价"),
      `Expected HAFU invalid-odds vig message, got: ${singleMissingCtx.vigSummary}`
    );
    assert.equal(
      singleMissingCtx.vigSummary.includes("12.0%"),
      false,
      `Must NEVER output fake 12.0% vig on unsold/empty pool: ${singleMissingCtx.vigSummary}`
    );
    assert.equal(singleMissingCtx.xgSummary, "无可核验信息");
    assert.equal(
      singleMissingCtx.oneGoalSharePct,
      0,
      "oneGoalShareOfWins === 0 must stay strictly 0, never overwritten by 45"
    );

    const comboZeroCtx = buildComboDiagnosisContext({
      sourceMode: "custom",
      targetMatches: [missingPoolAndZeroMatch, partnerZeroMatch],
      picks: [],
      userNote: "",
    });
    assert.equal(comboZeroCtx.matches[0].hadOdds, "该玩法无有效报价");
    assert.equal(comboZeroCtx.matches[0].oneGoalSharePct, 0);
    assert.equal(comboZeroCtx.matches[1].oneGoalSharePct, 0);

    const capturedDefectPrompts: string[] = [];
    const zeroVerifySvc = createXiaoGaoService({
      enableProbe: false,
      transport: async (
        _k: string,
        _m: string,
        msgs: Array<{ role: string; content: string }>
      ) => {
        capturedDefectPrompts.push(
          msgs.find((x) => x.role === "user")?.content || ""
        );
        return "{}";
      },
    });

    const singleZeroFallback = await zeroVerifySvc.analyzeMatch(
      "k",
      singleMissingCtx
    );
    const comboZeroFallback = await zeroVerifySvc.analyzeComboMatches(
      "k",
      comboZeroCtx
    );

    assert.ok(capturedDefectPrompts[0].includes("0%"));
    assert.equal(capturedDefectPrompts[0].includes("45%"), false);
    assert.ok(capturedDefectPrompts[1].includes("0%"));
    assert.equal(capturedDefectPrompts[1].includes("45%"), false);
    assert.ok(singleZeroFallback.summary.includes("0%"));
    assert.ok(
      comboZeroFallback.perMatch[0].poolImpact.includes(
        "胜平负：该玩法无有效报价"
      ),
      `Expected fallback poolImpact to report 该玩法无有效报价 for unsold HAD, got: ${comboZeroFallback.perMatch[0].poolImpact}`
    );
    assert.ok(
      comboZeroFallback.perMatch[0].poolImpact.includes("一球卡盘率0%"),
      `Expected fallback poolImpact to preserve 0% card-pan, got: ${comboZeroFallback.perMatch[0].poolImpact}`
    );

    // 2. Defect 3A: Strict canonical matchId ONLY (zero matchNumStr, matchTitle substring, or positional fallback!)
    const [satWeek1, satWeek2, satOther] = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              buildSubMatchRaw({
                matchId: "20261114-001",
                matchNumStr: "周六001",
                matchDate: "2026-11-14",
                matchTime: "20:00:00",
                homeTeamId: 501,
                homeTeamAbbName: "切尔西",
                awayTeamId: 502,
                awayTeamAbbName: "埃弗顿",
              }),
              buildSubMatchRaw({
                matchId: "20261121-001",
                matchNumStr: "周六001",
                matchDate: "2026-11-21",
                matchTime: "20:00:00",
                homeTeamId: 601,
                homeTeamAbbName: "热刺",
                awayTeamId: 602,
                awayTeamAbbName: "维拉",
              }),
              buildSubMatchRaw({
                matchId: "20261121-002",
                matchNumStr: "周六002",
                matchDate: "2026-11-21",
                matchTime: "22:30:00",
                homeTeamId: 603,
                homeTeamAbbName: "曼城",
                awayTeamId: 604,
                awayTeamAbbName: "西汉姆",
              }),
            ],
          },
        ],
      },
    }) as MatchItem[];

    assert.equal(
      matchesCanonicalSportteryItem(
        { matchId: "周六001", matchTitle: "周六001 热刺vs维拉" },
        satWeek2
      ),
      false,
      "matchesCanonicalSportteryItem MUST reject matchNumStr & matchTitle heuristics"
    );
    assert.equal(
      matchesCanonicalSportteryItem({ matchId: "20261114-001" }, satWeek2),
      false,
      "Same matchNumStr across weeks MUST NOT match different canonical matchId"
    );
    assert.equal(
      matchesCanonicalSportteryItem({ matchId: "20261121-001" }, satWeek2),
      true
    );

    // LLM returns non-matching matchId ("周六001" at idx 0, "20261114-001" at idx 1) -> neither positional nor matchNumStr may contaminate!
    const misMatchedComboSvc = createXiaoGaoService({
      enableProbe: false,
      transport: async () =>
        JSON.stringify({
          level: "high",
          comboTag: "错返标识防串台测试",
          perMatch: [
            {
              matchId: "周六001",
              matchTitle: "周六001 热刺vs维拉",
              tag: "错用展示编号污染",
              note: "绝不能被采纳",
            },
            {
              matchId: satWeek1.id,
              matchTitle: "周六002 曼城vs西汉姆",
              tag: "错用下标位置污染",
              note: "绝不能按数组下标[1]落到曼城身上",
            },
          ],
        }),
    });

    const strictComboCtx = buildComboDiagnosisContext({
      sourceMode: "picked",
      targetMatches: [satWeek2, satOther],
      picks: [makePick(satWeek2, "HAD", "h"), makePick(satOther, "HAD", "h")],
    });
    const strictComboRep = await misMatchedComboSvc.analyzeComboMatches(
      "k",
      strictComboCtx
    );
    assert.equal(strictComboRep.perMatch[0].matchId, satWeek2.id);
    assert.notEqual(strictComboRep.perMatch[0].tag, "错用展示编号污染");
    assert.equal(strictComboRep.perMatch[1].matchId, satOther.id);
    assert.notEqual(strictComboRep.perMatch[1].tag, "错用下标位置污染");

    const alertMap = reconcileComboAlertsToMatchMap(
      {
        level: "high",
        source: "扫地僧小高 2场协同会诊 · 19:00",
        perMatch: [
          {
            matchId: "周六001",
            matchTitle: "周六001 热刺vs维拉",
            tag: "编号伪造",
            note: "不应入库",
            priceInStatus: "无可核验信息",
          },
          {
            matchId: satWeek1.id,
            matchTitle: "周六001 切尔西vs埃弗顿",
            tag: "上周周六001旧单",
            note: "不应串台至本周周六001",
            priceInStatus: "无可核验信息",
          },
        ],
      },
      [satWeek2, satOther]
    );
    assert.equal(alertMap.size, 0);

    // 3. Defect 3B: Full-stack + Client Workbench { matchId, activePoolsMask, hhadGoalLine, quoteVersionSig, analyzedAt } + 30m auto-withdrawal
    const tmpDir = makeTempDir("yj-spec15-t19-slice2-");
    let clock = parseBeijingDateTimeMs("2026-11-21", "16:00:00")!;
    let nonceSeq = 1;
    let transportCallCount = 0;
    let liveBoardMatches: MatchItem[] = [
      structuredClone(satWeek2),
      structuredClone(satOther),
    ];

    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      nowFn: () => clock,
      enableXiaoGaoProbe: false,
      getApiKey: () => "slice2-key",
      fetchMatches: async () => ({
        matches: liveBoardMatches,
        syncNote: "官方实盘刷新",
      }),
      xiaogaoTransport: async () => {
        transportCallCount += 1;
        return JSON.stringify({
          level: "high",
          tag: `单场排雷#${transportCallCount}`,
          summary: `第${transportCallCount}次实盘排雷结论`,
          priceInStatus: "无可核验信息",
        });
      },
    });

    try {
      const created = runtime.accountManager.createAccount({
        username: "t19_binding_user",
        password: "Bind#User19",
        durationHours: 24,
        maxDevices: 2,
        aiEnabled: true,
        dailyAiLimit: 20,
      });
      const bootEx = makeExchange({
        method: "POST",
        url: "/api/security/bootstrap",
        headers: {
          "content-type": "application/json",
          "x-yj-hw": "4".repeat(32),
        },
        body: { v: 1, tz: "Asia/Shanghai", hwFp: "4".repeat(32) },
      });
      await runtime.gateway.handleRequest(
        bootEx.req,
        bootEx.res,
        "/api/security/bootstrap"
      );
      const bootJson = JSON.parse(bootEx.read().body);
      const keys = deriveSessionSubkeys(Buffer.from(bootJson.k, "base64"));
      const sess = { sid: bootJson.sid, ...keys, authToken: "" };
      const loginRes = await sendSignedRuntimeCall(
        runtime.gateway,
        sess,
        "auth/login",
        {
          username: created.user.username,
          password: "Bind#User19",
          hwFp: "4".repeat(32),
        },
        clock,
        nonceSeq++
      );
      sess.authToken = loginRes.decrypted.authToken;

      const wb = createWorkbenchController({
        debounceMs: 0,
        clockPort: {
          now: () => clock,
          setTimeout: (fn) => setTimeout(fn, 0),
          clearTimeout: (h) => clearTimeout(h as any),
        },
        quantPort: {
          computeWorkspace: async (params) => {
            const r = await sendSignedRuntimeCall(
              runtime.gateway,
              sess,
              "quant/compute",
              params,
              clock,
              nonceSeq++
            );
            return r.decrypted;
          },
          syncMatches: async (workspaceParams) => {
            const r = await sendSignedRuntimeCall(
              runtime.gateway,
              sess,
              "quant/sync",
              { workspaceParams },
              clock,
              nonceSeq++
            );
            return r.decrypted;
          },
        },
        xiaogaoPort: {
          diagnoseMatch: async (matchId, userNote) => {
            const r = await sendSignedRuntimeCall(
              runtime.gateway,
              sess,
              "xiaogao/analyze",
              { matchId, userNote },
              clock,
              nonceSeq++
            );
            return r.decrypted;
          },
          diagnoseCombo: async (params) => {
            const r = await sendSignedRuntimeCall(
              runtime.gateway,
              sess,
              "xiaogao/analyze-combo",
              params,
              clock,
              nonceSeq++
            );
            return r.decrypted;
          },
        },
        authPort: {
          bootstrap: async () => ({
            authenticated: true,
            user: loginRes.decrypted.user,
            authToken: sess.authToken,
            matches: loginRes.decrypted.matches,
            syncNote: loginRes.decrypted.syncNote,
            boardMeta: loginRes.decrypted.boardMeta,
            initialPicks: [],
            workspace: loginRes.decrypted.workspace,
          }),
        },
      });

      await wb.bootstrapHandshake();

      // Step A: Diagnose satWeek2 at T0 -> transportCallCount === 1; repeat within 5m with unchanged quote hits cache!
      const d1 = await wb.diagnoseSingleMatch(satWeek2.id);
      assert.equal(d1.ok, true);
      assert.equal(transportCallCount, 1);
      assert.equal(wb.getState().matchAiAlerts[satWeek2.id]?.tag, "单场排雷#1");

      clock += 5 * 60_000;
      const d1Cached = await wb.diagnoseSingleMatch(satWeek2.id);
      assert.equal(d1Cached.ok, true);
      assert.equal(
        transportCallCount,
        1,
        "Unchanged {matchId, activePoolsMask, hhadGoalLine, quoteVersionSig} within 30m must hit cache"
      );
      await wb.syncOfficialMatches();
      assert.equal(
        wb.getState().matchAiAlerts[satWeek2.id]?.tag,
        "单场排雷#1",
        "Unchanged board within 30m preserves valid alert across sync"
      );

      // Step B: Relevant odds change (HAD h: 1.82 -> 1.74) -> sync immediately withdraws stale alert on BOTH server & client!
      const oddsChangedWeek2 = structuredClone(liveBoardMatches[0]);
      oddsChangedWeek2.pools.HAD.options[0].odds = 1.74;
      liveBoardMatches = [oddsChangedWeek2, structuredClone(satOther)];
      clock += 60_000;
      await wb.syncOfficialMatches();
      assert.equal(
        wb.getState().matchAiAlerts[satWeek2.id],
        undefined,
        "Odds change (quoteVersionSig mismatch) must immediately withdraw stale XiaoGao alert on sync"
      );

      // Re-diagnosing on new odds misses old cache -> transportCallCount === 2!
      const d2 = await wb.diagnoseSingleMatch(satWeek2.id);
      assert.equal(d2.ok, true);
      assert.equal(transportCallCount, 2);
      assert.equal(wb.getState().matchAiAlerts[satWeek2.id]?.tag, "单场排雷#2");

      // Step C: HHAD goalLine change ("-1" -> "-2") -> sync immediately withdraws stale alert!
      const goalLineChangedWeek2 = structuredClone(liveBoardMatches[0]);
      goalLineChangedWeek2.pools.HHAD = {
        ...goalLineChangedWeek2.pools.HHAD,
        goalLine: "-2",
        name: "让球(-2)",
      };
      liveBoardMatches = [goalLineChangedWeek2, structuredClone(satOther)];
      clock += 60_000;
      await wb.syncOfficialMatches();
      assert.equal(
        wb.getState().matchAiAlerts[satWeek2.id],
        undefined,
        "HHAD goalLine change must immediately withdraw stale XiaoGao alert"
      );

      // Step D: Open pools mask change (CRS closes selling: false) -> sync immediately withdraws stale alert!
      const d3 = await wb.diagnoseSingleMatch(satWeek2.id);
      assert.equal(d3.ok, true);
      assert.equal(transportCallCount, 3);
      assert.equal(wb.getState().matchAiAlerts[satWeek2.id]?.tag, "单场排雷#3");

      const poolMaskChangedWeek2 = structuredClone(liveBoardMatches[0]);
      poolMaskChangedWeek2.pools.CRS = {
        ...poolMaskChangedWeek2.pools.CRS,
        selling: false,
        canSingle: false,
        canAllUp: false,
        options: [],
      };
      liveBoardMatches = [poolMaskChangedWeek2, structuredClone(satOther)];
      clock += 60_000;
      await wb.syncOfficialMatches();
      assert.equal(
        wb.getState().matchAiAlerts[satWeek2.id],
        undefined,
        "Open pools mask change must immediately withdraw stale XiaoGao alert"
      );

      // Step E: > 30 minutes TTL expiry even when board is 100% unchanged!
      const d4 = await wb.diagnoseSingleMatch(satWeek2.id);
      assert.equal(d4.ok, true);
      assert.equal(transportCallCount, 4);
      assert.equal(wb.getState().matchAiAlerts[satWeek2.id]?.tag, "单场排雷#4");

      clock += 30 * 60_000 + 1_000; // 30m + 1s!
      await wb.syncOfficialMatches();
      assert.equal(
        wb.getState().matchAiAlerts[satWeek2.id],
        undefined,
        "XiaoGao alert older than 30 minutes must automatically expire and withdraw"
      );

      // Subsequent diagnose after >30m expiry invokes fresh upstream transport -> transportCallCount === 5!
      const d5 = await wb.diagnoseSingleMatch(satWeek2.id);
      assert.equal(d5.ok, true);
      assert.equal(transportCallCount, 5);

      wb.dispose();
    } finally {
      await runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 3 (UI Copy, Illustrated Manual & Iron-Cage Manual Q&A Alignment): renames subjective 消息入价消化度 to objective 消息与变价时序对照, aligns 双维盘面走势 & 红升绿降箭头 with GLOSSARY, and preserves 0ms local-KB compatibility for legacy 消化度 / Price-In queries", async () => {
    // 1. Illustrated manual catalog & chapters cover 消息与变价时序对照 + 双维盘面走势 with zero retired subjective copy
    const xiaogaoTopic = MANUAL_TOPICS.find((t) => t.id === "xiaogao")!;
    assert.ok(xiaogaoTopic);
    assert.equal(xiaogaoTopic.title.includes("消息入价消化度"), false);
    assert.ok(xiaogaoTopic.title.includes("消息与变价时序对照"));

    const chaptersJson = JSON.stringify(MANUAL_CHAPTER_SPECS);
    assert.ok(chaptersJson.includes("消息与变价时序对照"));
    assert.ok(chaptersJson.includes("双维盘面走势"));
    assert.ok(chaptersJson.includes("官方归档首报"));
    assert.equal(chaptersJson.includes("消息入价消化度"), false);
    assert.equal(chaptersJson.includes("真防冷急降"), false);

    // Search topic hits for both canonical new terms & legacy member terms
    assert.equal(matchManualTopics("消息与变价时序对照")[0]?.id, "xiaogao");
    assert.ok(matchManualTopics("双维盘面走势").length > 0);
    assert.ok(matchManualTopics("消化度").some((t) => t.id === "xiaogao"));
    assert.ok(matchManualTopics("Price-In").some((t) => t.id === "xiaogao"));

    // 2. Iron-Cage Manual Q&A 0ms local-KB hits for both new & legacy queries + QUICK_QA_PILLS <= 42 chars
    const qaEngine = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => ({
          locked: false,
          strikeCount: 1,
          maxAllowed: 4,
        }),
        consumeAiQuota: () => {
          throw new Error("0ms local-kb must NOT consume AI quota");
        },
      },
      xiaogaoService: null,
      getApiKey: () => "",
    });

    for (const pill of QUICK_QA_PILLS) {
      assert.ok(
        pill.length <= 42,
        `QUICK_QA_PILLS "${pill}" exceeds 42 chars (${pill.length})`
      );
      assert.equal(pill.includes("消息入价消化度"), false);
      const r = await qaEngine.answerManualQuestion({
        userId: "u-manual",
        question: pill,
        ip: "127.0.0.1",
      });
      assert.equal(r.ok, true);
      assert.equal(r.source, "local-kb");
    }

    for (const legacyOrNewTimelineQ of [
      "消息与变价时序对照是什么意思？",
      "消息入价消化度是什么意思？",
      "Price-In 消化度怎么看？",
    ]) {
      const ans = await qaEngine.answerManualQuestion({
        userId: "u-manual",
        question: legacyOrNewTimelineQ,
        ip: "127.0.0.1",
      });
      assert.equal(ans.ok, true);
      assert.equal(ans.source, "local-kb");
      assert.ok(ans.answer.includes("消息与变价时序对照"));
      assert.ok(ans.answer.includes("无可核验信息"));
      assert.equal(ans.answer.includes("接盘警告"), false);
    }

    for (const dualAxisQ of [
      "双维盘面走势怎么看？",
      "赔率旁边的红箭头 ▲ 和绿箭头 ▼ 怎么看？",
    ]) {
      const ans = await qaEngine.answerManualQuestion({
        userId: "u-manual",
        question: dualAxisQ,
        ip: "127.0.0.1",
      });
      assert.equal(ans.ok, true);
      assert.equal(ans.source, "local-kb");
      assert.ok(
        ans.answer.includes("双维盘面走势") ||
          ans.answer.includes("真实隐含概率")
      );
      assert.ok(
        ans.answer.includes("同向") || ans.answer.includes("返还率"),
        `Expected dual-axis arrow explanation to mention whole-pool payout ratio / same-direction shift: ${ans.answer}`
      );
    }

    assert.ok(APP_GROUND_TRUTH_MANUAL_SPEC.includes("消息与变价时序对照"));
    assert.equal(
      LOCAL_CURATED_QA.some((it: any) =>
        String(it.question).includes("消息入价消化度")
      ),
      false
    );

    // 3. buildXiaoGaoWarnings uses objective 消息与变价时序对照 label
    const m0 = structuredClone(FALLBACK_MATCHES[0]) as MatchItem;
    m0.aiAlert = {
      level: "high",
      tag: "密集赛程观察",
      summary: "主队距上一场竞彩开球 60.0h（上界）",
      priceInStatus: "无可核验信息",
      source: "扫地僧小高实时诊盘 · 18:00",
    };
    const warnings = buildXiaoGaoWarnings([makePick(m0, "HAD", "h")], [m0]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].detail.includes("消息与变价时序对照：无可核验信息"));
    assert.equal(warnings[0].detail.includes("Price-In 消化度"), false);
  });

  it("Slice 4 (Static Guardrails, domain.md Anchors & 4-Way v2.8.0 Release Seal): blocks sqlite/worker_threads/zlib/history imports inside pure quant graph, blocks retired 真防冷急降 & 消息入价消化度 phrases, registers history module anchors in domain.md, and seals v2.8.0 (versionCode=280) across all 4 surfaces", async () => {
    const repoRoot = process.cwd();

    // 1. Live repository passes all guardrails at version 2.8.0
    const liveRes = runRepositoryGuardrails({ rootDir: repoRoot });
    assert.deepEqual(liveRes.errors, []);
    assert.equal(liveRes.ok, true);
    assert.equal(liveRes.version, "2.8.0");
    assert.ok(FROZEN_PRODUCTION_MODEL_VERSION.includes("2.8.0"));

    // 2. /api/health reports 2.8.0
    const healthTmp = makeTempDir("yj-t19-v280-health-");
    try {
      const shield = createSecurityShield({
        banStoreFile: path.join(healthTmp, "bans.json"),
      });
      const ex = makeExchange({ method: "GET", url: "/api/health" });
      const handled = await shield.handleRequest(ex.req, ex.res, "/api/health");
      assert.equal(handled, true);
      const body = JSON.parse(ex.read().body);
      assert.equal(body.ok, true);
      assert.equal(body.version, "2.8.0");
    } finally {
      fs.rmSync(healthTmp, { recursive: true, force: true });
    }

    // 3. Synthetic fixture verification: guardrails MUST catch sqlite, worker_threads, zlib, history/ imports in quantEngine graph, AND 真防冷急降 / 消息入价消化度 in src/ or server/!
    const fixtureRoot = makeTempDir("yj-t19-guardrail-fixture-");
    try {
      fs.mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(fixtureRoot, "server", "quant"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(fixtureRoot, "server", "history"), {
        recursive: true,
      });
      fs.mkdirSync(
        path.join(fixtureRoot, "android/app/src/main/kotlin/io/yjty/jisuanqi"),
        { recursive: true }
      );

      fs.writeFileSync(
        path.join(fixtureRoot, "package.json"),
        JSON.stringify({ version: "2.8.0" })
      );
      fs.writeFileSync(
        path.join(fixtureRoot, "android/app/build.gradle.kts"),
        'versionCode = 280\nversionName = "2.8.0"\n'
      );
      fs.writeFileSync(
        path.join(fixtureRoot, "server/securityShield.mjs"),
        'export const h = { version: "2.8.0" };\n'
      );
      fs.writeFileSync(
        path.join(
          fixtureRoot,
          "android/app/src/main/kotlin/io/yjty/jisuanqi/MainActivity.kt"
        ),
        'val ua = "YouJingAndroid/2.8.0"\n'
      );
      fs.writeFileSync(
        path.join(fixtureRoot, "server/history/helper.mjs"),
        "export const x = 1;\n"
      );

      for (const badQuantCode of [
        'import { DatabaseSync } from "node:sqlite";\nexport const q = 1;\n',
        'import { Worker } from "node:worker_threads";\nexport const q = 1;\n',
        'import zlib from "node:zlib";\nexport const q = 1;\n',
        'import { x } from "./history/helper.mjs";\nexport const q = x;\n',
      ]) {
        fs.writeFileSync(
          path.join(fixtureRoot, "server/quantEngine.mjs"),
          badQuantCode
        );
        fs.writeFileSync(
          path.join(fixtureRoot, "src/clean.ts"),
          "export const ok = true;\n"
        );
        const check = runRepositoryGuardrails({ rootDir: fixtureRoot });
        assert.equal(
          check.ok,
          false,
          `Guardrail must block pure-quant violation: ${badQuantCode.trim()}`
        );
        assert.ok(
          check.errors.some((e) => e.includes("[pure-quant-io]")),
          `Expected [pure-quant-io] error for ${badQuantCode.trim()}, got: ${check.errors.join("; ")}`
        );
      }

      // Restore clean quantEngine, inject retired honesty phrases in src/
      fs.writeFileSync(
        path.join(fixtureRoot, "server/quantEngine.mjs"),
        "export const q = 1;\n"
      );
      for (const retiredPhrase of ["真防冷急降", "消息入价消化度"]) {
        fs.writeFileSync(
          path.join(fixtureRoot, "src/clean.ts"),
          `export const label = "${retiredPhrase}";\n`
        );
        const check = runRepositoryGuardrails({ rootDir: fixtureRoot });
        assert.equal(check.ok, false);
        assert.ok(
          check.errors.some((e) => e.includes("[honesty-guardrail]")),
          `Expected [honesty-guardrail] error for "${retiredPhrase}", got: ${check.errors.join("; ")}`
        );
      }
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }

    // 4. Verify docs/agents/domain.md registers new Spec #15 history module anchors and all exist on disk
    const domainDoc = fs.readFileSync(
      path.join(repoRoot, "docs/agents/domain.md"),
      "utf8"
    );
    for (const requiredAnchorModule of [
      "server/history/historyCoordinator.mjs",
      "server/history/dualAxisMovement.mjs",
      "server/history/exposureAndCalibrationMonitor.mjs",
      "server/history/xiaogaoObjectiveFacts.mjs",
      "server/xiaogaoCore.mjs",
    ]) {
      assert.ok(
        domainDoc.includes(requiredAnchorModule),
        `docs/agents/domain.md must register symbol anchors for ${requiredAnchorModule}`
      );
    }
  });
});
