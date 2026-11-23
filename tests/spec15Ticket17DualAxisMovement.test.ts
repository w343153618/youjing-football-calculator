import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseBeijingDateTimeMs } from "../server/history/historyCoordinator.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  "sec-fetch-mode": "cors",
};

function makeHttpExchange({
  method = "POST",
  url = "/api/security/bootstrap",
  headers = {},
  body = null,
}: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const req = new EventEmitter() as any;
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries({ ...BROWSER_HEADERS, ...headers }).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ])
  );
  req.socket = { remoteAddress: "198.51.100.77" };
  req.destroy = () => {};

  let statusCode = 200;
  const resHeaders: Record<string, unknown> = {};
  let resBody = "";
  const res = {
    set statusCode(v: number) {
      statusCode = v;
    },
    get statusCode() {
      return statusCode;
    },
    setHeader(k: string, v: unknown) {
      resHeaders[k.toLowerCase()] = v;
    },
    getHeader(k: string) {
      return resHeaders[k.toLowerCase()];
    },
    writeHead(code: number, hdrs?: Record<string, unknown>) {
      statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          resHeaders[k.toLowerCase()] = v;
        }
      }
    },
    end(chunk?: string) {
      if (chunk) resBody += String(chunk);
    },
  };

  queueMicrotask(() => {
    if (body !== null && body !== undefined) {
      const payloadStr = typeof body === "string" ? body : JSON.stringify(body);
      req.emit("data", Buffer.from(payloadStr, "utf8"));
    }
    req.emit("end");
  });

  return {
    req,
    res,
    read: () => ({ statusCode, headers: resHeaders, body: resBody }),
  };
}

/**
 * Independent first-principles Shin (1993) bisection oracle (never calls server devigPoolProbabilities)
 * Solves sum_i [ (sqrt(z^2 + 4*(1-z)*q_i^2 / V) - z) / (2*(1-z)) ] = 1 for z in (0, 1).
 */
function independentShinOracle(oddsList: number[]): number[] {
  const q = oddsList.map((o) => 1 / o);
  const V = q.reduce((s, x) => s + x, 0);
  let lo = 1e-12;
  let hi = 1 - 1e-12;
  for (let it = 0; it < 80; it += 1) {
    const mid = 0.5 * (lo + hi);
    let sum = 0;
    for (const qi of q) {
      const num = Math.sqrt(mid * mid + (4 * (1 - mid) * qi * qi) / V) - mid;
      sum += num / (2 * (1 - mid));
    }
    if (sum > 1) lo = mid;
    else hi = mid;
  }
  const z = 0.5 * (lo + hi);
  const raw = q.map(
    (qi) => (Math.sqrt(z * z + (4 * (1 - z) * qi * qi) / V) - z) / (2 * (1 - z))
  );
  const total = raw.reduce((s, x) => s + x, 0);
  return raw.map((x) => x / total);
}

describe("Spec #15 · Ticket #17: Dual-Axis Market Movement & 390px Clean-Front / Rich-Back UI", () => {
  it("Slice 1 (Runtime Dual-Axis Calculation, Same-Direction Payout Shift, CRS s-1sh Alignment & HHAD GoalLine Segmentation): computes cumulative fairProb delta pp on identical valid option set without inverting SP arrow, isolates HHAD goalLine segments, and labels official-archive-open vs local-first-seen vs single-frame", async () => {
    const tmpDir = makeTempDir("yj-spec15-t17-s1-");
    let nowMs = parseBeijingDateTimeMs("2026-11-23", "10:00:00")!;
    let stage: "t1-initial" | "t2-second-hop" | "t3-hhad-line2-second" =
      "t1-initial";
    let allowFixedBonusFor3010001 = false;
    let runtime: any = null;

    const buildLiveCalculatorRaw = () => {
      const m1Had =
        stage === "t1-initial"
          ? {
              h: "1.63",
              d: "3.30",
              a: "4.05",
              hf: "-1",
              df: "-1",
              af: "-1",
              updateDate: "2026-11-23",
              updateTime: "10:00:00",
            }
          : {
              h: "1.63",
              d: "3.30",
              a: "4.05",
              hf: "-1",
              df: "-1",
              af: "-1",
              updateDate: "2026-11-23",
              updateTime: "10:00:00",
            };

      const m1Hhad =
        stage === "t1-initial"
          ? {
              goalLine: "-1",
              h: "2.95",
              d: "3.35",
              a: "2.02",
              hf: "1",
              df: "0",
              af: "-1",
              updateDate: "2026-11-23",
              updateTime: "10:00:00",
            }
          : stage === "t2-second-hop"
            ? {
                goalLine: "-2",
                h: "5.80",
                d: "4.40",
                a: "1.36",
                hf: "0",
                df: "0",
                af: "0",
                updateDate: "2026-11-23",
                updateTime: "10:30:00",
              }
            : {
                goalLine: "-2",
                h: "5.20",
                d: "4.30",
                a: "1.42",
                hf: "-1",
                df: "-1",
                af: "1",
                updateDate: "2026-11-23",
                updateTime: "11:00:00",
              };

      const m2Had =
        stage === "t1-initial"
          ? {
              h: "1.60",
              d: "3.35",
              a: "4.10",
              hf: "0",
              df: "0",
              af: "0",
              updateDate: "2026-11-23",
              updateTime: "09:50:00",
            }
          : {
              // Higher payout ratio in frame 2: h odds goes UP (1.60 -> 1.62) AND h fairProb ALSO goes UP!
              h: "1.62",
              d: "3.70",
              a: "4.75",
              hf: "1",
              df: "1",
              af: "1",
              updateDate: "2026-11-23",
              updateTime: "10:30:00",
            };

      return {
        value: {
          lastUpdateTime: "2026-11-23 10:00:00",
          matchInfoList: [
            {
              subMatchList: [
                {
                  matchId: 3010001,
                  matchNumStr: "周一001",
                  matchDate: "2026-11-23",
                  matchTime: "20:00:00",
                  businessDate: "2026-11-23",
                  leagueId: 88,
                  leagueAbbName: "亚冠精英",
                  homeTeamId: 1001,
                  homeTeamAbbName: "山东泰山",
                  awayTeamId: 1002,
                  awayTeamAbbName: "柔佛新山",
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
                      poolCode: "CRS",
                      poolStatus: "Selling",
                      bettingSingle: 1,
                      bettingAllup: 1,
                    },
                  ],
                  had: m1Had,
                  hhad: m1Hhad,
                  crs: {
                    s01s00: "6.50",
                    s02s00: "7.20",
                    s02s01: "7.50",
                    s01s01: "6.80",
                    s00s00: "10.50",
                    s00s01: "12.00",
                    s1sh: "16.00",
                    s1shf: "-1",
                    s1sd: "80.00",
                    s1sa: "60.00",
                    updateDate: "2026-11-23",
                    updateTime: "10:00:00",
                  },
                },
                {
                  matchId: 3010002,
                  matchNumStr: "周一002",
                  matchDate: "2026-11-23",
                  matchTime: "22:00:00",
                  businessDate: "2026-11-23",
                  leagueId: 91,
                  leagueAbbName: "英超",
                  homeTeamId: 2001,
                  homeTeamAbbName: "阿森纳",
                  awayTeamId: 2002,
                  awayTeamAbbName: "布伦特",
                  poolList: [
                    {
                      poolCode: "HAD",
                      poolStatus: "Selling",
                      bettingSingle: 1,
                      bettingAllup: 1,
                    },
                  ],
                  had: m2Had,
                },
              ],
            },
          ],
        },
      };
    };

    try {
      const { parseSportteryRawJson } =
        await import("../server/quantEngine.mjs");

      runtime = createYouJingRuntime({
        dataDir: tmpDir,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        nowFn: () => nowMs,
        fetchMatches: async () => ({
          matches: parseSportteryRawJson(buildLiveCalculatorRaw()),
          source: "official-live",
          syncNote: "官方实盘正常",
        }),
        historyFetchFn: async (url: string) => {
          const u = new URL(url);
          if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
            const mid = u.searchParams.get("matchId");
            if (mid === "3010001" && allowFixedBonusFor3010001) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  value: {
                    isCancel: 0,
                    oddsHistory: {
                      matchId: 3010001,
                      singleList: ["HAD", "CRS"],
                      hadList: [
                        {
                          // High payout ratio (~90.61%) opening quote!
                          h: "1.65",
                          d: "3.60",
                          a: "4.55",
                          hf: "0",
                          df: "0",
                          af: "0",
                          updateDate: "2026-11-22",
                          updateTime: "14:00:00",
                        },
                        {
                          // Intermediate quote before 10:00
                          h: "1.66",
                          d: "3.45",
                          a: "4.25",
                          hf: "1",
                          df: "-1",
                          af: "-1",
                          updateDate: "2026-11-23",
                          updateTime: "08:00:00",
                        },
                      ],
                      hhadList: [
                        {
                          goalLine: "-1",
                          h: "2.75",
                          d: "3.40",
                          a: "2.15",
                          updateDate: "2026-11-22",
                          updateTime: "14:00:00",
                        },
                      ],
                      crsList: [
                        {
                          s01s00: "6.50",
                          s02s00: "7.20",
                          s02s01: "7.50",
                          s01s01: "6.80",
                          s00s00: "10.50",
                          s00s01: "12.00",
                          "s-1sh": "24.00",
                          "s-1sd": "80.00",
                          "s-1sa": "60.00",
                          updateDate: "2026-11-22",
                          updateTime: "14:00:00",
                        },
                      ],
                    },
                  },
                }),
              };
            }
            // Match 3010002 has NO official archive open!
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: { isCancel: 0, oddsHistory: { matchId: Number(mid) } },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ value: {} }) };
        },
      });

      await runtime.historyCoordinator.start();

      const credsText = fs.readFileSync(
        path.join(tmpDir, "admin-credentials.txt"),
        "utf8"
      );
      const adminUser = credsText.match(/ADMIN_USER=(\S+)/)?.[1] || "yjadmin";
      const adminPass =
        credsText.match(/ADMIN_INITIAL_PASSWORD=(\S+)/)?.[1] || "";
      assert.ok(adminPass, "Expected generated admin password");
      const hwFpHex = "a".repeat(64);

      const bootEx = makeHttpExchange({
        method: "POST",
        url: "/api/security/bootstrap",
        body: { v: 1, tz: "Asia/Shanghai", hwFp: hwFpHex },
      });
      await runtime.gateway.handleRequest(
        bootEx.req,
        bootEx.res,
        "/api/security/bootstrap"
      );
      const bootJson = JSON.parse(bootEx.read().body);
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
        if (authToken) headers["x-yj-auth"] = authToken;
        const ex = makeHttpExchange({
          method: "POST",
          url: `/api/${endpoint}`,
          headers,
          body: envelope,
        });
        await runtime.gateway.handleRequest(ex.req, ex.res, `/api/${endpoint}`);
        const out = JSON.parse(ex.read().body);
        assert.equal(out.ok, true, ex.read().body);
        return decryptEnvelope(aesKey, out.payload.iv, out.payload.d);
      };

      // Step A: Login at T1 before FixedBonus open backfill -> both matches have only 1 frame ("single-frame")
      const loginBundle = await callEncrypted("auth/login", {
        username: adminUser,
        password: adminPass,
        hwFp: hwFpHex,
        deviceLabel: "Spec15-T17",
      });
      const m1Single = loginBundle.matches.find((m: any) => m.id === "3010001");
      assert.ok(m1Single);
      const m1SingleHome = m1Single.pools.HAD.options.find(
        (o: any) => o.key === "h"
      );
      assert.ok(
        m1SingleHome?.movement,
        "OddsOption.movement must be populated by runtime hydration"
      );
      assert.equal(m1SingleHome.movement.baselineSource, "single-frame");
      assert.equal(m1SingleHome.movement.frameCount, 1);
      assert.equal(
        m1SingleHome.movement.cumFairProbDeltaPp,
        null,
        "Single-frame observation (<2 frames) must NEVER output cumulative trend delta"
      );
      assert.equal(
        m1SingleHome.movement.lastHopDirection,
        -1,
        "Single-frame observation preserves live last-hop arrow direction"
      );

      // Ensure live board T1 is flushed into coordinator, then backfill FixedBonus opening quotes for 3010001
      await runtime.historyCoordinator.ingestLiveBoard({
        matches: loginBundle.matches,
        boardMeta: loginBundle.boardMeta,
      });
      allowFixedBonusFor3010001 = true;
      await runtime.historyCoordinator.backfillMatchOpeningQuotes("3010001");
      await runtime.historyCoordinator.backfillMatchOpeningQuotes("3010002");

      // Step B: Advance to T2 (10:30):
      // - 3010001 HAD stays at 1.63/3.30/4.05 (3 frames: 14:00 open -> 08:00 prev -> 10:00 latest)
      //   Whole-pool payout ratio dropped from ~90.61% to ~85.95%: h odds dropped (1.66 -> 1.63, lastHopDirection = -1) AND h fairProb ALSO dropped!
      // - 3010001 HHAD switches goalLine from "-1" to "-2" -> new "-2" segment has only 1 frame (single-frame, cumFairProbDeltaPp = null)!
      // - 3010002 HAD moves from 1.60/3.35/4.10 -> 1.62/3.70/4.75 (missing FixedBonus open -> "local-first-seen", h odds UP +1 AND h fairProb UP!)
      nowMs = parseBeijingDateTimeMs("2026-11-23", "10:30:00")!;
      stage = "t2-second-hop";
      const syncT2 = await callEncrypted(
        "quant/sync",
        { workspaceParams: {} },
        loginBundle.authToken
      );

      const m1T2 = syncT2.matches.find((m: any) => m.id === "3010001");
      const m1HadH = m1T2.pools.HAD.options.find((o: any) => o.key === "h");
      assert.equal(m1HadH.movement.baselineSource, "official-archive-open");
      assert.equal(m1HadH.movement.frameCount, 3);
      assert.equal(m1HadH.movement.openOdds, 1.65);
      assert.equal(m1HadH.movement.openAt, "11-22 14:00");
      assert.equal(m1HadH.movement.prevOdds, 1.66);
      assert.equal(m1HadH.movement.prevAt, "11-23 08:00");
      assert.equal(m1HadH.movement.currentOdds, 1.63);
      assert.equal(m1HadH.movement.currentAt, "11-23 10:00");
      assert.equal(
        m1HadH.movement.lastHopDirection,
        -1,
        "Last hop 1.66 -> 1.63 must report downward odds (-1)"
      );

      // Verify against independent Shin oracle (non-tautological!)
      const oracleOpenM1 = independentShinOracle([1.65, 3.6, 4.55]);
      const oracleNowM1 = independentShinOracle([1.63, 3.3, 4.05]);
      const expectedM1HomeDeltaPp = Number(
        (100 * (oracleNowM1[0] - oracleOpenM1[0])).toFixed(2)
      );
      assert.ok(
        expectedM1HomeDeltaPp < -1.5,
        `Oracle sanity check: expected negative fairProb delta, got ${expectedM1HomeDeltaPp}`
      );
      assert.equal(m1HadH.movement.cumFairProbDeltaPp, expectedM1HomeDeltaPp);

      // Verify CRS s-1sh ("胜其它") alignment across FixedBonus alias -> live label
      const m1CrsWinOther = m1T2.pools.CRS.options.find(
        (o: any) => o.label === "胜其它"
      );
      assert.ok(m1CrsWinOther?.movement);
      assert.equal(
        m1CrsWinOther.movement.baselineSource,
        "official-archive-open"
      );
      assert.equal(m1CrsWinOther.movement.frameCount, 2);
      assert.equal(m1CrsWinOther.movement.openOdds, 24);
      assert.equal(m1CrsWinOther.movement.prevOdds, 24);
      assert.equal(m1CrsWinOther.movement.currentOdds, 16);
      assert.equal(m1CrsWinOther.movement.lastHopDirection, -1);
      assert.ok(
        m1CrsWinOther.movement.cumFairProbDeltaPp > 1.0,
        `Expected CRS 胜其它 (24 -> 16 on identical valid option set) to gain >1.0pp, got ${m1CrsWinOther.movement.cumFairProbDeltaPp}`
      );

      // Verify HHAD goalLine switch "-1" -> "-2" isolated segment reset!
      const m1HhadT2 = m1T2.pools.HHAD.options.find((o: any) => o.key === "hh");
      assert.equal(m1HhadT2.movement.goalLine, "-2");
      assert.equal(m1HhadT2.movement.frameCount, 1);
      assert.equal(m1HhadT2.movement.baselineSource, "single-frame");
      assert.equal(
        m1HhadT2.movement.cumFairProbDeltaPp,
        null,
        "Switching HHAD goalLine from -1 to -2 must start a fresh segment and NEVER mix -1 frames"
      );

      // Verify 3010002 ("local-first-seen" + upward odds AND upward fairProb!)
      const m2T2 = syncT2.matches.find((m: any) => m.id === "3010002");
      const m2HadH = m2T2.pools.HAD.options.find((o: any) => o.key === "h");
      assert.equal(m2HadH.movement.baselineSource, "local-first-seen");
      assert.equal(m2HadH.movement.frameCount, 2);
      assert.equal(m2HadH.movement.prevOdds, 1.6);
      assert.equal(m2HadH.movement.currentOdds, 1.62);
      assert.equal(m2HadH.movement.lastHopDirection, 1);
      const oracleOpenM2 = independentShinOracle([1.6, 3.35, 4.1]);
      const oracleNowM2 = independentShinOracle([1.62, 3.7, 4.75]);
      const expectedM2HomeDeltaPp = Number(
        (100 * (oracleNowM2[0] - oracleOpenM2[0])).toFixed(2)
      );
      assert.ok(
        expectedM2HomeDeltaPp > 1.5,
        `Oracle sanity check: expected positive fairProb delta when payout ratio rises, got ${expectedM2HomeDeltaPp}`
      );
      assert.equal(m2HadH.movement.cumFairProbDeltaPp, expectedM2HomeDeltaPp);

      // Flush T2 into coordinator so HHAD("-2") first frame is persisted, then advance to T3 (11:00) for 2nd frame on HHAD("-2")!
      await runtime.historyCoordinator.ingestLiveBoard({
        matches: syncT2.matches,
        boardMeta: syncT2.boardMeta,
      });
      nowMs = parseBeijingDateTimeMs("2026-11-23", "11:00:00")!;
      stage = "t3-hhad-line2-second";
      const syncT3 = await callEncrypted(
        "quant/sync",
        { workspaceParams: {} },
        loginBundle.authToken
      );
      const m1T3 = syncT3.matches.find((m: any) => m.id === "3010001");
      const m1HhadT3 = m1T3.pools.HHAD.options.find((o: any) => o.key === "hh");
      assert.equal(m1HhadT3.movement.goalLine, "-2");
      assert.equal(m1HhadT3.movement.frameCount, 2);
      assert.equal(m1HhadT3.movement.baselineSource, "local-first-seen");
      assert.equal(m1HhadT3.movement.prevOdds, 5.8);
      assert.equal(m1HhadT3.movement.currentOdds, 5.2);
      assert.equal(m1HhadT3.movement.lastHopDirection, -1);
      const oracleLine2Open = independentShinOracle([5.8, 4.4, 1.36]);
      const oracleLine2Now = independentShinOracle([5.2, 4.3, 1.42]);
      assert.equal(
        m1HhadT3.movement.cumFairProbDeltaPp,
        Number((100 * (oracleLine2Now[0] - oracleLine2Open[0])).toFixed(2))
      );
    } finally {
      await runtime?.dispose?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 2 (Retire Misleading Single-Hop 真防冷急降 & Purple 降水 Badge Across Pure Quant & Match Summary): removes single-hop anti-upset verdict and purple drop badge from analyzeMatchMicroQuant, FALLBACK_MATCHES, summarizeMatchDualAxisMovements, and buildMatchIntelDigest while keeping pure quant 100% zero-I/O", async () => {
    const {
      FALLBACK_MATCHES,
      analyzeMatchMicroQuant,
      calibrateMatchCoherentModel,
    } = await import("../server/quantEngine.mjs");
    const {
      hydrateMatchesWithDualAxisMovement,
      summarizeMatchDualAxisMovements,
    } = await import("../server/history/dualAxisMovement.mjs");
    const { buildMatchIntelDigest } =
      await import("../src/workspace/betSlipController.ts");
    const { runRepositoryGuardrails } =
      await import("../scripts/check-guardrails.mjs");

    // 1. FALLBACK_MATCHES and direct analyzeMatchMicroQuant on trend === -1 match NEVER emit 真防冷急降 or purple 降水 badge
    for (const fm of FALLBACK_MATCHES) {
      assert.equal(
        fm.microQuant.steamSignal.includes("真防冷急降"),
        false,
        `FALLBACK_MATCHES[${fm.id}] must not contain retired 真防冷急降: ${fm.microQuant.steamSignal}`
      );
      assert.equal(
        fm.microQuant.microBadges.some(
          (b: any) => b.tone === "purple" || String(b.text).includes("降水")
        ),
        false,
        `FALLBACK_MATCHES[${fm.id}] must not emit retired purple 降水 badge`
      );
    }

    const baseSample = structuredClone(FALLBACK_MATCHES[0]);
    baseSample.pools.HAD.options[0].trend = -1;
    baseSample.pools.HHAD.options[0].trend = -1;
    const cal = calibrateMatchCoherentModel(baseSample);
    const mqSingle = analyzeMatchMicroQuant(
      { ...baseSample, pools: cal.pools },
      cal
    );
    assert.equal(mqSingle.steamSignal.includes("真防冷急降"), false);
    assert.equal(mqSingle.steamSignal.includes("诱盘"), false);
    assert.ok(
      mqSingle.steamSignal.includes("仅单帧观测") &&
        mqSingle.steamSignal.includes("末跳水位"),
      `Expected objective single-frame water-level copy, got: ${mqSingle.steamSignal}`
    );
    assert.equal(
      mqSingle.microBadges.some(
        (b: any) => b.tone === "purple" || String(b.text).includes("降水")
      ),
      false
    );

    // 2. Multi-frame same-direction payout shift (odds DOWN + fairProb DOWN) surfaces honest dual-axis summary in both summarizeMatchDualAxisMovements and analyzeMatchMicroQuant
    const mockSnapshot = {
      seq: 7,
      getPoolSegmentFrames(
        matchId: string,
        poolCode: string,
        goalLine: string
      ) {
        if (
          matchId === baseSample.id &&
          poolCode === "HAD" &&
          goalLine === ""
        ) {
          return {
            matchId,
            poolCode: "HAD",
            goalLine: "",
            hasOfficialArchiveOpen: true,
            frameCount: 2,
            frames: [
              {
                poolCode: "HAD",
                goalLine: "",
                frameOrigin: "official-archive-open",
                isBackfilled: true,
                options: {
                  h: { odds: 1.65, trend: 0 },
                  d: { odds: 3.6, trend: 0 },
                  a: { odds: 4.55, trend: 0 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-22",
                  "14:00:00"
                ),
              },
              {
                poolCode: "HAD",
                goalLine: "",
                frameOrigin: "live-poll",
                isBackfilled: false,
                options: {
                  h: { odds: 1.63, trend: -1 },
                  d: { odds: 3.3, trend: -1 },
                  a: { odds: 4.05, trend: -1 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-23",
                  "10:00:00"
                ),
              },
            ],
          };
        }
        return null;
      },
    };

    const sameDirSample = structuredClone(baseSample);
    sameDirSample.pools.HAD.options[0].odds = 1.63;
    sameDirSample.pools.HAD.options[0].trend = -1;
    sameDirSample.pools.HAD.options[1].odds = 3.3;
    sameDirSample.pools.HAD.options[1].trend = -1;
    sameDirSample.pools.HAD.options[2].odds = 4.05;
    sameDirSample.pools.HAD.options[2].trend = -1;
    sameDirSample.pools.HAD.updateDate = "2026-11-23";
    sameDirSample.pools.HAD.updateTime = "10:00:00";

    const [hydrated] = hydrateMatchesWithDualAxisMovement(
      [sameDirSample],
      mockSnapshot,
      { nowMs: parseBeijingDateTimeMs("2026-11-23", "10:00:00") }
    );
    const summary = summarizeMatchDualAxisMovements(hydrated);
    assert.equal(summary.hasMultiFrameTrend, true);
    assert.equal(summary.pools.HAD.baselineSource, "official-archive-open");
    assert.equal(summary.pools.HAD.baselineLabel, "自官方归档首报");
    assert.equal(summary.notableMovements[0].isSameDirectionShift, true);
    assert.ok(hydrated.microQuant.steamSignal.includes("自官方归档首报"));
    assert.ok(hydrated.microQuant.steamSignal.includes("同向变化"));
    assert.equal(hydrated.microQuant.steamSignal.includes("真防冷急降"), false);

    // Direct analyzeMatchMicroQuant on already-hydrated match ALSO preserves objective dual-axis steamSignal
    const mqHydrated = analyzeMatchMicroQuant(hydrated);
    assert.equal(mqHydrated.steamSignal.includes("真防冷急降"), false);
    assert.ok(mqHydrated.steamSignal.includes("自官方归档首报"));

    // 3. Client buildMatchIntelDigest never claims 设防 / 散热 on last-hop arrows
    const digest = buildMatchIntelDigest(hydrated);
    assert.equal(digest.steamSignal.includes("真防冷急降"), false);
    for (const tm of digest.trendMovements) {
      assert.equal(
        tm.interpretation.includes("设防") ||
          tm.interpretation.includes("散热"),
        false,
        `Trend movement interpretation must state objective movement, got: ${tm.interpretation}`
      );
    }

    // 4. Repository guardrails verify pure quant graph stays 100% zero-I/O
    const guardrails = runRepositoryGuardrails();
    assert.equal(guardrails.ok, true, guardrails.errors.join("; "));
  });

  it("Slice 3 (Headless WorkbenchController + 390px Compact Odds View-Models + Drawer Dual-Axis Fact Cards): renders last-hop water-level titles without anti-upset claims, gates compact Δp badges on >=2 frames and |Δp|>=0.1pp with 初 marker for local-first-seen, and builds side-by-side drawer cards with goalLine segments and same-direction alerts", async () => {
    const { FALLBACK_MATCHES, evaluateQuantWorkspace } =
      await import("../server/quantEngine.mjs");
    const { hydrateMatchesWithDualAxisMovement } =
      await import("../server/history/dualAxisMovement.mjs");
    const { createWorkbenchController } =
      await import("../src/workspace/workbenchController.ts");
    const cabinVm =
      (await import("../src/mobile/cabins/cabinViewModels.ts")) as any;

    assert.equal(typeof cabinVm.buildTrendArrowSpec, "function");
    assert.equal(
      typeof cabinVm.buildCompactOptionMovementViewModel,
      "function"
    );
    assert.equal(typeof cabinVm.buildMatchDualAxisDrawerViewModel, "function");

    const sampleMatch = structuredClone(FALLBACK_MATCHES[0]);
    sampleMatch.id = "3030001";
    sampleMatch.pools.HAD.options[0].odds = 1.63;
    sampleMatch.pools.HAD.options[0].trend = -1;
    sampleMatch.pools.HAD.options[1].odds = 3.3;
    sampleMatch.pools.HAD.options[1].trend = -1;
    sampleMatch.pools.HAD.options[2].odds = 4.05;
    sampleMatch.pools.HAD.options[2].trend = -1;
    sampleMatch.pools.HHAD.goalLine = "-2";
    sampleMatch.pools.HHAD.name = "让球(-2)";
    sampleMatch.pools.HHAD.options[0].odds = 5.2;
    sampleMatch.pools.HHAD.options[1].odds = 4.3;
    sampleMatch.pools.HHAD.options[2].odds = 1.42;
    sampleMatch.pools.TTG.options[0].odds = 11.5;
    sampleMatch.pools.TTG.options[0].trend = 1;

    const mockSnapshot = {
      seq: 11,
      getPoolSegmentFrames(
        matchId: string,
        poolCode: string,
        goalLine: string
      ) {
        if (matchId !== "3030001") return null;
        if (poolCode === "HAD" && goalLine === "") {
          // Official archive open: whole-pool payout ratio shift -> h odds DOWN (1.65->1.63) & fairProb DOWN (-1.82pp), tiny move on d (<0.1pp test checked separately)
          return {
            matchId,
            poolCode: "HAD",
            goalLine: "",
            hasOfficialArchiveOpen: true,
            frameCount: 2,
            frames: [
              {
                poolCode: "HAD",
                goalLine: "",
                frameOrigin: "official-archive-open",
                isBackfilled: true,
                options: {
                  h: { odds: 1.65, trend: 0 },
                  d: { odds: 3.6, trend: 0 },
                  a: { odds: 4.55, trend: 0 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-22",
                  "14:00:00"
                ),
              },
              {
                poolCode: "HAD",
                goalLine: "",
                frameOrigin: "live-poll",
                isBackfilled: false,
                options: {
                  h: { odds: 1.63, trend: -1 },
                  d: { odds: 3.3, trend: -1 },
                  a: { odds: 4.05, trend: -1 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-23",
                  "10:00:00"
                ),
              },
            ],
          };
        }
        if (poolCode === "HHAD" && goalLine === "-2") {
          // Local first seen (missing official archive open): 2 frames on -2 segment
          return {
            matchId,
            poolCode: "HHAD",
            goalLine: "-2",
            hasOfficialArchiveOpen: false,
            frameCount: 2,
            frames: [
              {
                poolCode: "HHAD",
                goalLine: "-2",
                frameOrigin: "live-poll",
                isBackfilled: false,
                options: {
                  hh: { odds: 5.8, trend: 0 },
                  hd: { odds: 4.4, trend: 0 },
                  ha: { odds: 1.36, trend: 0 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-23",
                  "10:30:00"
                ),
              },
              {
                poolCode: "HHAD",
                goalLine: "-2",
                frameOrigin: "live-poll",
                isBackfilled: false,
                options: {
                  hh: { odds: 5.2, trend: -1 },
                  hd: { odds: 4.3, trend: -1 },
                  ha: { odds: 1.42, trend: 1 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-23",
                  "11:00:00"
                ),
              },
            ],
          };
        }
        // TTG has null -> single-frame!
        return null;
      },
    };

    const hydratedList = hydrateMatchesWithDualAxisMovement(
      [sampleMatch],
      mockSnapshot,
      { nowMs: parseBeijingDateTimeMs("2026-11-23", "11:00:00") }
    );

    const wb = createWorkbenchController({
      debounceMs: 0,
      quantPort: {
        computeWorkspace: (p, ms) => evaluateQuantWorkspace(p, ms),
      },
      authPort: {
        bootstrap: async () => ({
          authenticated: true,
          user: {
            id: "u-admin",
            username: "yjadmin",
            displayName: "超管",
            role: "superadmin",
            aiQuotaRemaining: 50,
            expiresAt: null,
          } as any,
          authToken: "tok-t17",
          matches: hydratedList,
          syncNote: "实盘正常",
          initialPicks: [],
          workspace: evaluateQuantWorkspace({}, hydratedList),
        }),
      },
    });

    try {
      await wb.bootstrapHandshake();
      const m = wb.getState().betSlipState.matches[0];
      assert.equal(m.id, "3030001");

      // 1. Trend arrow title strictly states last-hop water-level movement (never anti-upset!)
      const upArrowSpec = cabinVm.buildTrendArrowSpec(1);
      const dnArrowSpec = cabinVm.buildTrendArrowSpec(-1);
      assert.equal(upArrowSpec?.title, "末跳水位上调");
      assert.equal(upArrowSpec?.symbol, "▲");
      assert.equal(dnArrowSpec?.title, "末跳水位下调");
      assert.equal(dnArrowSpec?.symbol, "▼");
      assert.equal(cabinVm.buildTrendArrowSpec(0), null);

      // 2. Front compact badges:
      // - HAD h (official-archive-open, cumFairProbDeltaPp < -1.5): shows "-X.Xpp" (NO 初) AND downward trend arrow!
      const vmHadH = cabinVm.buildCompactOptionMovementViewModel(
        m.pools.HAD.options[0],
        0
      );
      assert.equal(vmHadH.trendArrow?.direction, -1);
      assert.equal(vmHadH.trendArrow?.title, "末跳水位下调");
      assert.ok(vmHadH.deltaBadge);
      assert.equal(vmHadH.deltaBadge.tone, "neg");
      assert.equal(vmHadH.deltaBadge.hasLocalInitMarker, false);
      assert.match(vmHadH.deltaBadge.text, /^-\d+\.\dpp$/);

      // - HHAD hh (local-first-seen, cumFairProbDeltaPp > +1.0): appends 初 as "+X.Xpp初"!
      const vmHhadHh = cabinVm.buildCompactOptionMovementViewModel(
        m.pools.HHAD.options[0],
        0
      );
      assert.ok(vmHhadHh.deltaBadge);
      assert.equal(vmHhadHh.deltaBadge.tone, "pos");
      assert.equal(vmHhadHh.deltaBadge.hasLocalInitMarker, true);
      assert.match(vmHhadHh.deltaBadge.text, /^\+\d+\.\dpp初$/);

      // - TTG s0 (single-frame, frameCount = 1): hides deltaBadge (null), preserves live last-hop arrow (+1)
      const vmTtgSingle = cabinVm.buildCompactOptionMovementViewModel(
        m.pools.TTG.options[0],
        0
      );
      assert.equal(
        vmTtgSingle.deltaBadge,
        null,
        "Single-frame option (<2 frames) must NEVER display Δp badge on front button"
      );
      assert.equal(vmTtgSingle.trendArrow?.direction, 1);

      // - Sub-threshold |Δp| < 0.1pp (e.g. +0.04pp on 2 frames): hides deltaBadge on front button to keep 390px clean!
      const vmTiny = cabinVm.buildCompactOptionMovementViewModel(
        {
          odds: 3.3,
          fairProb: 0.26,
          trend: 0,
          movement: {
            baselineSource: "official-archive-open",
            frameCount: 2,
            goalLine: "",
            cumFairProbDeltaPp: 0.04,
            openOdds: 3.3,
            openAt: "11-22 14:00",
            prevOdds: 3.3,
            prevAt: "11-22 14:00",
            currentOdds: 3.3,
            currentAt: "11-23 10:00",
            lastHopDirection: 0,
          },
        },
        0
      );
      assert.equal(vmTiny.deltaBadge, null);

      // 3. Drawer Dual-Axis View-Model (powers both more & intel sheets):
      const drawerVm = cabinVm.buildMatchDualAxisDrawerViewModel(m);
      assert.equal(drawerVm.sectionTitle, "双维盘面走势");
      assert.ok(drawerVm.axis1Header.includes("累计去水真率净变化"));
      assert.ok(drawerVm.axis2Header.includes("末跳水位变动"));

      const hadCard = drawerVm.pools.find((p: any) => p.poolCode === "HAD");
      assert.ok(hadCard);
      assert.equal(hadCard.baselineBadgeText, "自官方归档首报");
      assert.equal(hadCard.hasSameDirectionWarning, true);
      assert.ok(hadCard.sameDirectionWarningText?.includes("同向"));
      const hadRowH = hadCard.rows.find((r: any) => r.optionKey === "h");
      assert.ok(hadRowH);
      assert.match(hadRowH.axis1ValueText, /^-\d+\.\d{2}pp$/);
      assert.ok(hadRowH.axis2ValueText.includes("1.65 → 1.63 ▼降"));
      assert.equal(hadRowH.axis2TimeText, "11-22 14:00 → 11-23 10:00");
      assert.equal(hadRowH.isSameDirectionAsFairProb, true);

      const hhadCard = drawerVm.pools.find((p: any) => p.poolCode === "HHAD");
      assert.ok(hhadCard);
      assert.equal(hhadCard.baselineBadgeText, "自本系统首次观测");
      assert.equal(hhadCard.goalLine, "-2");
      assert.ok(
        hhadCard.goalLineSegmentLabel?.includes("-2"),
        `Expected HHAD segment label to disclose current goalLine -2, got: ${hhadCard.goalLineSegmentLabel}`
      );

      const ttgCard = drawerVm.pools.find((p: any) => p.poolCode === "TTG");
      assert.ok(ttgCard);
      assert.equal(ttgCard.baselineBadgeText, "仅单帧观测·暂不判趋势");
      assert.equal(ttgCard.rows[0].axis1ValueText, "仅单帧观测·暂不判趋势");
      assert.ok(ttgCard.rows[0].axis2ValueText.includes("11.50"));
    } finally {
      wb.dispose();
    }
  });

  it("Slice 4 (Identical Valid Option-Set Intersection, Read-Only Fallback Non-Pollution, Drop Filter Alignment & 100% Quant Formula Invariance): devigs strictly on shared valid options (odds > 1 in both open and latest), never appends phantom frames during fallback boards, and preserves 100% identical calibrated fairProb/portfolio outputs", async () => {
    const { FALLBACK_MATCHES, evaluateQuantWorkspace } =
      await import("../server/quantEngine.mjs");
    const { hydrateMatchesWithDualAxisMovement } =
      await import("../server/history/dualAxisMovement.mjs");
    const { filterAndGroupRadarMatches } =
      await import("../src/workspace/betSlipController.ts");

    // 1. Identical valid option-set intersection: TTG openFrame had s0..s6 valid (s7 missing), latestFrame has s0..s7 valid
    const m = structuredClone(FALLBACK_MATCHES[0]);
    m.id = "3040001";
    const latestTtgOdds = [11.0, 4.6, 3.45, 3.65, 5.1, 8.8, 16.0, 24.0];
    m.pools.TTG.options.forEach((opt: any, idx: number) => {
      opt.odds = latestTtgOdds[idx];
      opt.trend = 0; // raw flag 0, while actual prev->latest dropped on s0 (12.5 -> 11.0)
    });

    const openTtgOdds7 = [12.5, 4.8, 3.4, 3.6, 5.0, 8.5, 15.5]; // s7 absent in openFrame!
    const partialSnap = {
      seq: 21,
      getPoolSegmentFrames(
        matchId: string,
        poolCode: string,
        goalLine: string
      ) {
        if (matchId === "3040001" && poolCode === "TTG" && goalLine === "") {
          return {
            matchId,
            poolCode: "TTG",
            goalLine: "",
            hasOfficialArchiveOpen: true,
            frameCount: 2,
            frames: [
              {
                poolCode: "TTG",
                goalLine: "",
                frameOrigin: "official-archive-open",
                isBackfilled: true,
                options: {
                  s0: { odds: 12.5, trend: 0 },
                  s1: { odds: 4.8, trend: 0 },
                  s2: { odds: 3.4, trend: 0 },
                  s3: { odds: 3.6, trend: 0 },
                  s4: { odds: 5.0, trend: 0 },
                  s5: { odds: 8.5, trend: 0 },
                  s6: { odds: 15.5, trend: 0 },
                  // s7 intentionally absent in openFrame!
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-22",
                  "12:00:00"
                ),
              },
              {
                poolCode: "TTG",
                goalLine: "",
                frameOrigin: "live-poll",
                isBackfilled: false,
                options: {
                  s0: { odds: 11.0, trend: 0 },
                  s1: { odds: 4.6, trend: 0 },
                  s2: { odds: 3.45, trend: 0 },
                  s3: { odds: 3.65, trend: 0 },
                  s4: { odds: 5.1, trend: 0 },
                  s5: { odds: 8.8, trend: 0 },
                  s6: { odds: 16.0, trend: 0 },
                  s7: { odds: 24.0, trend: 0 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-23",
                  "11:00:00"
                ),
              },
            ],
          };
        }
        return null;
      },
    };

    const [hydrated] = hydrateMatchesWithDualAxisMovement([m], partialSnap, {
      nowMs: parseBeijingDateTimeMs("2026-11-23", "11:00:00"),
    });

    const oracleOpen7 = independentShinOracle(openTtgOdds7);
    const oracleNow7 = independentShinOracle(latestTtgOdds.slice(0, 7));
    for (let i = 0; i < 7; i += 1) {
      const expectedPp = Number(
        (100 * (oracleNow7[i] - oracleOpen7[i])).toFixed(2)
      );
      assert.equal(
        hydrated.pools.TTG.options[i].movement.cumFairProbDeltaPp,
        expectedPp,
        `s${i} must be devigged strictly on the shared 7-option subset`
      );
    }
    assert.equal(
      hydrated.pools.TTG.options[7].movement.cumFairProbDeltaPp,
      null,
      "s7 lacked a valid opening quote in openFrame and must report cumFairProbDeltaPp: null"
    );
    assert.equal(
      hydrated.pools.TTG.options[0].movement.lastHopDirection,
      -1,
      "s0 dropped 12.50 -> 11.00 so computed lastHopDirection must be -1 even if raw *f was 0"
    );

    // 2. Radar qFilter="drop" matches computed downward lastHopDirection
    const dropFiltered = filterAndGroupRadarMatches([hydrated], {
      qFilter: "drop",
    });
    assert.equal(dropFiltered.filteredMatches.length, 1);

    // 3. Read-only fallback board (isFallbackReadOnly: true) NEVER appends a virtual frame to single-frame snapshot
    const fallbackDifferingMatch = structuredClone(m);
    fallbackDifferingMatch.pools.HAD.options[0].odds = 1.99;
    const singleHadSnap = {
      seq: 22,
      getPoolSegmentFrames(
        matchId: string,
        poolCode: string,
        goalLine: string
      ) {
        if (matchId === "3040001" && poolCode === "HAD" && goalLine === "") {
          return {
            matchId,
            poolCode: "HAD",
            goalLine: "",
            hasOfficialArchiveOpen: true,
            frameCount: 1,
            frames: [
              {
                poolCode: "HAD",
                goalLine: "",
                frameOrigin: "official-archive-open",
                isBackfilled: true,
                options: {
                  h: { odds: 1.75, trend: 0 },
                  d: { odds: 3.5, trend: 0 },
                  a: { odds: 3.8, trend: 0 },
                },
                sourcePublishedAt: parseBeijingDateTimeMs(
                  "2026-11-22",
                  "12:00:00"
                ),
              },
            ],
          };
        }
        return null;
      },
    };
    const [fallbackHydrated] = hydrateMatchesWithDualAxisMovement(
      [fallbackDifferingMatch],
      singleHadSnap,
      {
        boardMeta: {
          source: "cached-snapshot",
          boardState: "empty-board-fallback",
          lastValidBoardAt: parseBeijingDateTimeMs("2026-11-22", "12:00:00"),
          lastValidBoardClock: "11-22 12:00",
          isFallbackReadOnly: true,
          bannerText: "上次有效报价",
        },
        nowMs: parseBeijingDateTimeMs("2026-11-23", "11:30:00"),
      }
    );
    assert.equal(
      fallbackHydrated.pools.HAD.options[0].movement.frameCount,
      1,
      "Read-only fallback board must NOT append a phantom second frame"
    );
    assert.equal(
      fallbackHydrated.pools.HAD.options[0].movement.cumFairProbDeltaPp,
      null
    );

    // 4. 100% Frozen Quant Parity: hydrating dual-axis movement never alters fairProb, odds, payoutRatio, vig, portfolioPlans, or statutory payouts
    const rawPair = FALLBACK_MATCHES.slice(0, 2);
    const hydratedPair = hydrateMatchesWithDualAxisMovement(
      rawPair,
      partialSnap,
      { nowMs: parseBeijingDateTimeMs("2026-11-23", "11:00:00") }
    );
    const params = {
      picks: [
        {
          matchId: rawPair[0].id,
          matchNumStr: rawPair[0].matchNumStr,
          home: rawPair[0].home,
          away: rawPair[0].away,
          poolCode: "HAD" as const,
          poolName: "胜平负",
          singleAllowed: rawPair[0].pools.HAD.single,
          optionKey: "h",
          optionLabel: "主胜",
          odds: rawPair[0].pools.HAD.options[0].odds,
          fairProb: rawPair[0].pools.HAD.options[0].fairProb,
        },
        {
          matchId: rawPair[1].id,
          matchNumStr: rawPair[1].matchNumStr,
          home: rawPair[1].home,
          away: rawPair[1].away,
          poolCode: "HAD" as const,
          poolName: "胜平负",
          singleAllowed: rawPair[1].pools.HAD.single,
          optionKey: "h",
          optionLabel: "主胜",
          odds: rawPair[1].pools.HAD.options[0].odds,
          fairProb: rawPair[1].pools.HAD.options[0].fairProb,
        },
      ],
      multiple: 5,
      subjectiveDeltaPct: 0,
      simVoidFirstMatch: false,
      planSpec: null,
      targetIds: [rawPair[0].id, rawPair[1].id],
      budget: 100,
      stance: "objective" as const,
      unlockFullAgg: false,
    };
    const wsBefore = evaluateQuantWorkspace(params, rawPair);
    const wsAfter = evaluateQuantWorkspace(params, hydratedPair);
    assert.deepEqual(wsAfter.portfolioPlans, wsBefore.portfolioPlans);
    assert.deepEqual(wsAfter.effectiveReport, wsBefore.effectiveReport);
  });
});
