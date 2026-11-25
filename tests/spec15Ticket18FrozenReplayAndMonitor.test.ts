import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  evaluateQuantWorkspace,
  parseSportteryRawJson,
  settleTicketSnapshotWithOfficialResults,
} from "../server/quantEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import { parseBeijingDateTimeMs } from "../server/history/historyCoordinator.mjs";
import {
  ADMIN_HISTORY_MONITOR_TAB_LABEL,
  buildAdminConsoleTabSpecs,
  buildAdminHistoryMonitorViewModel,
  canAccessAdminConsole,
} from "../src/admin/adminHistoryMonitorViewModel.ts";
import type {
  MatchItem,
  QuantWorkspaceParams,
  QuantWorkspaceResponse,
} from "../src/prototype/quantTypes.ts";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const DEFAULT_BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  "accept-language": "zh-CN,zh;q=0.9",
  "sec-fetch-mode": "cors",
};

function makeHttpExchange({
  method = "POST",
  url = "/",
  headers = {},
  body = undefined,
  remoteAddress = "198.51.100.88",
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
    Object.entries({ ...DEFAULT_BROWSER_HEADERS, ...headers }).map(([k, v]) => [
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
    set statusCode(code: number) {
      statusCode = code;
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

function loadRealOosFixtureBundle() {
  const fixturePath = path.resolve(
    process.cwd(),
    "tests/fixtures/realSportteryOosMatches.json"
  );
  const rawJson = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const rawSubMatches: any[] = rawJson.matches.slice(0, 16);
  const parsedMatches = parseSportteryRawJson({
    value: { matchInfoList: [{ subMatchList: rawSubMatches }] },
  }) as MatchItem[];

  const officialResultsPayload = rawSubMatches.map((m) => {
    const out = m.outcome;
    const hafuKey = String(out.hafuKey || "dd");
    const htHome =
      hafuKey[0] === "h" ? Math.max(1, out.ftHome) : hafuKey[0] === "a" ? 0 : 0;
    const htAway =
      hafuKey[0] === "a" ? Math.max(1, out.ftAway) : hafuKey[0] === "h" ? 0 : 0;
    return {
      matchId: String(m.matchId),
      matchNumStr: m.matchNumStr,
      matchDate: m.matchDate,
      leagueId: 88,
      leagueNameAbbr: m.leagueAbbName,
      homeTeamId: `H_${m.matchId}`,
      homeTeam: m.homeTeamAbbName,
      awayTeamId: `A_${m.matchId}`,
      awayTeam: m.awayTeamAbbName,
      goalLine: m.hhad?.goalLine ?? "-1",
      h: m.had?.h ?? "",
      d: m.had?.d ?? "",
      a: m.had?.a ?? "",
      matchResultStatus: "2",
      poolStatus: "Payout",
      sectionsNo1: `${htHome}:${htAway}`,
      sectionsNo999: `${out.ftHome}:${out.ftAway}`,
    };
  });

  return { rawSubMatches, parsedMatches, officialResultsPayload };
}

function makePickFromMatch(
  m: MatchItem,
  poolCode: "HAD" | "HHAD" | "TTG" | "HAFU" | "CRS",
  optionKey?: string
) {
  const pool = m.pools[poolCode];
  const opt = optionKey
    ? pool.options.find((o) => o.key === optionKey) || pool.options[0]
    : pool.options[0];
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: Boolean(pool.single),
    canSingle: Boolean(pool.canSingle ?? pool.single),
    canAllUp: pool.canAllUp !== false,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

function projectDeterministicWorkspaceSummary(ws: QuantWorkspaceResponse) {
  return {
    quoteInputSig: ws.quoteInputSig,
    subjectiveEVPct: ws.subjectiveEVPct,
    effectiveReport: {
      canCheckout: ws.effectiveReport.canCheckout,
      ruleBlockReason: ws.effectiveReport.ruleBlockReason,
      betCount: ws.effectiveReport.betCount,
      totalCost: ws.effectiveReport.totalCost,
      minPayout: ws.effectiveReport.minPayout,
      maxPayout: ws.effectiveReport.maxPayout,
      expectedValueRate: ws.effectiveReport.expectedValueRate,
      objectiveEVRate: ws.effectiveReport.objectiveEVRate,
      zeroPayoutProb: ws.effectiveReport.zeroPayoutProb,
      partialLossProb: ws.effectiveReport.partialLossProb,
      breakEvenProb: ws.effectiveReport.breakEvenProb,
      strictNetGainProb: ws.effectiveReport.strictNetGainProb,
      tickets: (ws.effectiveReport.tickets || []).map((tk) => ({
        id: tk.id,
        unitPayout: tk.unitPayout,
        totalPayout: tk.totalPayout,
        cappedClipped: tk.cappedClipped,
        netProfit: tk.netProfit,
        prob: tk.prob,
      })),
    },
    slots: ws.portfolioPlans.map((s) => ({
      key: s.key,
      available: s.available,
      alphaKind: s.alphaKind ?? null,
      emptyReason: s.emptyReason ?? null,
      totalCost: s.totalCost,
      savedCash: s.savedCash,
      minReturn: s.minReturn,
      maxReturn: s.maxReturn,
      winProb: s.winProb,
      profitProb: s.profitProb,
      strictNetGainProb: s.strictNetGainProb ?? null,
      breakEvenProb: s.breakEvenProb ?? null,
      zeroPayoutProb: s.zeroPayoutProb ?? null,
      expectedValueRate: s.expectedValueRate,
      underwaterCount: s.underwaterCount,
      lines: s.lines.map((ln) => ({
        id: ln.id,
        modeLabel: ln.modeLabel,
        multiple: ln.multiple,
        cost: ln.cost,
        unitPayout: ln.unitPayout,
        returnPayout: ln.returnPayout,
        legs: ln.legs.map((lg) => ({
          matchId: lg.matchId,
          poolCode: lg.poolCode,
          optionKey: lg.optionKey,
          odds: lg.odds,
        })),
      })),
    })),
  };
}

async function bootAnonymousSession(
  runtime: any,
  nowFn: () => number,
  hwFpHex = "b".repeat(64),
  remoteAddress = "198.51.100.88"
) {
  const bootEx = makeHttpExchange({
    method: "POST",
    url: "/api/security/bootstrap",
    body: { v: 1, tz: "Asia/Shanghai", hwFp: hwFpHex },
    remoteAddress,
  });
  await runtime.gateway.handleRequest(
    bootEx.req,
    bootEx.res,
    "/api/security/bootstrap"
  );
  const bootJson = JSON.parse(bootEx.read().body);
  assert.equal(bootJson.ok, true);
  const { aesKey, hmacKey } = deriveSessionSubkeys(
    Buffer.from(bootJson.k, "base64")
  );

  let nonceSeq = 1;
  const callEncryptedRaw = async (
    endpoint: string,
    payloadObj: unknown,
    authToken?: string
  ) => {
    const ts = String(nowFn());
    const nonce = nonceSeq.toString(16).padStart(32, "0");
    nonceSeq += 1;
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
      "x-yj-hw": hwFpHex,
    };
    if (authToken) {
      headers["x-yj-auth"] = authToken;
    }
    const ex = makeHttpExchange({
      method: "POST",
      url: `/api/${endpoint}`,
      headers,
      body: envelope,
      remoteAddress,
    });
    await runtime.gateway.handleRequest(ex.req, ex.res, `/api/${endpoint}`);
    const resSnap = ex.read();
    const outJson = JSON.parse(resSnap.body);
    return {
      statusCode: resSnap.statusCode,
      outJson,
      decrypt: () =>
        outJson?.payload
          ? decryptEnvelope(aesKey, outJson.payload.iv, outJson.payload.d)
          : null,
    };
  };

  return { callEncryptedRaw };
}

async function bootAndLoginSuperAdmin(runtime: any, nowFn: () => number) {
  const credsPath = path.join(runtime.dataDir, "admin-credentials.txt");
  const credsText = fs.readFileSync(credsPath, "utf8");
  const adminUser = credsText.match(/ADMIN_USER=(\S+)/)?.[1] || "yjadmin";
  const adminPass = credsText.match(/ADMIN_INITIAL_PASSWORD=(\S+)/)?.[1]!;
  const hwFpHex = "b".repeat(64);
  const anon = await bootAnonymousSession(runtime, nowFn, hwFpHex);

  const loginRes = await anon.callEncryptedRaw("auth/login", {
    username: adminUser,
    password: adminPass,
    hwFp: hwFpHex,
    deviceLabel: "Spec15-T18-Mac",
  });
  assert.equal(loginRes.statusCode, 200);
  const loginBundle = loginRes.decrypt() as any;
  return {
    authToken: loginBundle.authToken as string,
    user: loginBundle.user,
    callEncryptedRaw: anon.callEncryptedRaw,
  };
}

describe("Spec #15 · Ticket #18: Frozen Kernel Replay Parity Lock, Read-Only Exposure/Calibration Monitor & Super-Admin Tab 3", () => {
  it("Slice 1 (A4 & Section 5 Frozen Kernel Deterministic Replay Parity): locks zero auto-retrain/promotion/fuse code and 100% identical 4-slot, 8x9, 8x247, 1.01 alpha gate, statutory payout & encrypted envelope outputs with vs without history coordinator", async () => {
    // 1. Static dependency & forbidden mechanism audit across server/
    const repoRoot = process.cwd();
    const quantFiles = [
      "server/quantEngine.mjs",
      ...fs
        .readdirSync(path.join(repoRoot, "server/quant"))
        .filter((f) => f.endsWith(".mjs"))
        .map((f) => `server/quant/${f}`),
    ];
    for (const rel of quantFiles) {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      assert.equal(
        /historyCoordinator|historyStorage|collectorWorker|exposureAndCalibrationMonitor/.test(
          src
        ),
        false,
        `Pure quant module ${rel} must never import history/monitor modules`
      );
      assert.equal(
        /onlineRetrain|autoPromote800|dualLineFuse|autoRetrainWorker/i.test(
          src
        ),
        false,
        `Pure quant module ${rel} must contain zero online auto-retrain / 800-match promotion / dual-line fuse`
      );
    }

    // 2. Build 1..8 match frozen scenarios (including 8x9, 8x247 + bonus opt, and 1.01 alpha threshold)
    const { rawSubMatches, parsedMatches, officialResultsPayload } =
      loadRealOosFixtureBundle();
    assert.equal(parsedMatches.length, 16);

    const eightMatches = parsedMatches.slice(0, 8);
    const eightHadPicks = eightMatches.map((m) => makePickFromMatch(m, "HAD"));

    // Construct a deterministic pre-parsed Sporttery raw match testing the exact 1.01 shrunk alpha gate:
    // - normal real OOS matches where shrunk EV < 1.01 -> Slot 4 abstains (available: false)
    // - genuine cross-pool lag where HAD updated at 21:18:50 toward away/draw while single-eligible HHAD(-1) ha lagged at 1.92 -> O * p_shrunk >= 1.01 -> Slot 4 activates!
    const rawAlphaPair = structuredClone(rawSubMatches.slice(0, 2));
    rawAlphaPair[0].had = {
      ...rawAlphaPair[0].had,
      h: "2.95",
      d: "3.20",
      a: "2.12",
      updateDate: "2026-09-16",
      updateTime: "21:18:50",
    };
    rawAlphaPair[0].hhad = {
      ...rawAlphaPair[0].hhad,
      goalLine: "-1",
      h: "5.20",
      d: "3.90",
      a: "1.92",
      updateDate: "2026-09-16",
      updateTime: "18:30:00",
    };
    for (const pl of rawAlphaPair[0].poolList) {
      if (pl.poolCode === "HHAD") {
        pl.single = 1;
        pl.bettingSingle = 1;
      }
    }
    const positiveAlphaMatches = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: rawAlphaPair }] },
    }) as MatchItem[];

    const scenarios: Array<{
      name: string;
      matches: MatchItem[];
      params: Partial<QuantWorkspaceParams>;
    }> = [
      {
        name: "1-match single-capable HAD & portfolio",
        matches: parsedMatches.slice(0, 4),
        params: {
          picks: [makePickFromMatch(parsedMatches[0], "HAD", "h")],
          multiple: 5,
          targetIds: [parsedMatches[0].id],
          budget: 100,
          stance: "objective",
        },
      },
      {
        name: "1-match non-single synthetic evaluation",
        matches: parsedMatches.slice(1, 5),
        params: {
          picks: [makePickFromMatch(parsedMatches[1], "HAD", "h")],
          multiple: 3,
          targetIds: [parsedMatches[1].id],
          budget: 60,
          stance: "objective",
        },
      },
      {
        name: "2-match parlay & 3+1 Pareto slots",
        matches: parsedMatches.slice(0, 6),
        params: {
          picks: [
            makePickFromMatch(parsedMatches[0], "HAD", "h"),
            makePickFromMatch(parsedMatches[1], "HHAD", "ha"),
          ],
          multiple: 10,
          targetIds: [parsedMatches[0].id, parsedMatches[1].id],
          budget: 100,
          stance: "objective",
        },
      },
      {
        name: "4-match HAFU/CRS statutory 4-pass cap",
        matches: parsedMatches.slice(0, 6),
        params: {
          picks: [
            makePickFromMatch(parsedMatches[0], "HAFU", "hh"),
            makePickFromMatch(parsedMatches[1], "CRS", "s01s01"),
            makePickFromMatch(parsedMatches[2], "HAD", "h"),
            makePickFromMatch(parsedMatches[3], "TTG", "s2"),
          ],
          multiple: 2,
          targetIds: parsedMatches.slice(0, 4).map((m) => m.id),
          budget: 200,
          stance: "objective",
        },
      },
      {
        name: "6-match covering wheel",
        matches: parsedMatches.slice(0, 8),
        params: {
          picks: parsedMatches
            .slice(0, 6)
            .map((m) => makePickFromMatch(m, "HAD")),
          multiple: 2,
          targetIds: parsedMatches.slice(0, 6).map((m) => m.id),
          budget: 300,
          stance: "objective",
        },
      },
      {
        name: "8-match 8x9 combo parlay",
        matches: eightMatches,
        params: {
          picks: eightHadPicks,
          multiple: 2,
          passSpec: { mode: "combo", comboCode: "8x9" },
          targetIds: eightMatches.map((m) => m.id),
          budget: 500,
          stance: "objective",
        },
      },
      {
        name: "8-match 8x247 full combo + equal bonus optimization",
        matches: eightMatches,
        params: {
          picks: eightHadPicks,
          multiple: 1,
          passSpec: { mode: "combo", comboCode: "8x247" },
          planSpec: {
            kind: "bonus",
            optMode: "equal",
            scaleMultiple: 1,
          },
          targetIds: eightMatches.map((m) => m.id),
          budget: 600,
          stance: "objective",
        },
      },
      {
        name: "positive cross-pool alpha >= 1.01 gate activation",
        matches: positiveAlphaMatches,
        params: {
          picks: [],
          multiple: 1,
          targetIds: positiveAlphaMatches.map((m) => m.id),
          budget: 100,
          stance: "objective",
          allowSaveCash: true,
        },
      },
    ];

    // Independent statutory checks on 8x9 & 8x247 & 1.01 alpha gate
    const ws8x9 = evaluateQuantWorkspace(
      scenarios[5].params,
      scenarios[5].matches
    );
    assert.equal(ws8x9.manualReport.betCount, 9);
    assert.equal(ws8x9.manualReport.totalCost, 9 * 2 * 2); // 9 base bets * ¥2 * 2x = ¥36

    const ws8x247 = evaluateQuantWorkspace(
      scenarios[6].params,
      scenarios[6].matches
    );
    assert.equal(ws8x247.manualReport.betCount, 247);
    assert.equal(ws8x247.manualReport.totalCost, 247 * 2); // 247 base bets * ¥2 = ¥494
    assert.equal(ws8x247.effectiveReport.canCheckout, true);
    assert.ok((ws8x247.appliedPlan?.lines.length ?? 0) === 247);

    const wsNormalAlpha = evaluateQuantWorkspace(
      scenarios[2].params,
      scenarios[2].matches
    );
    const slot4Normal = wsNormalAlpha.portfolioPlans.find(
      (p) => p.key === "alpha-radar"
    )!;
    assert.equal(
      slot4Normal.available,
      false,
      "Normal negative-EV slate must abstain on Slot 4 (1.01 alpha gate)"
    );

    const wsPosAlpha = evaluateQuantWorkspace(
      scenarios[7].params,
      scenarios[7].matches
    );
    const slot4Pos = wsPosAlpha.portfolioPlans.find(
      (p) => p.key === "alpha-radar"
    )!;
    assert.equal(
      slot4Pos.available,
      true,
      "Genuine O * p_shrunk >= 1.01 mispricing must activate Slot 4"
    );
    assert.equal(slot4Pos.alphaKind, "positive-ev");

    // 3. Full-stack encrypted gateway parity: Runtime A (collector OFF) vs Runtime B (collector ON + populated WAL)
    const tmpA = makeTempDir("yj-spec15-t18-replay-off-");
    const tmpB = makeTempDir("yj-spec15-t18-replay-on-");
    let nowMs = parseBeijingDateTimeMs("2026-09-16", "12:00:00")!;
    let currentBoardMatches: MatchItem[] = eightMatches;

    let runtimeOff: any = null;
    let runtimeOn: any = null;

    try {
      const makeFeedStub = async () => ({
        matches: structuredClone(currentBoardMatches),
        source: "official-live",
        syncNote: "实盘测试流",
        boardMeta: {
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: nowMs,
          lastValidBoardClock: "09-16 12:00",
          isFallbackReadOnly: false,
          bannerText: null,
        },
      });

      runtimeOff = createYouJingRuntime({
        dataDir: tmpA,
        enableHistoryCollector: false,
        nowFn: () => nowMs,
        fetchMatches: makeFeedStub,
      });

      runtimeOn = createYouJingRuntime({
        dataDir: tmpB,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        nowFn: () => nowMs,
        fetchMatches: makeFeedStub,
        historyFetchFn: async (url: string) => {
          const u = new URL(url);
          if (u.pathname.endsWith("/getMatchCalculatorV1.qry")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: { matchInfoList: [{ subMatchList: rawSubMatches }] },
              }),
            };
          }
          if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
            const mid = u.searchParams.get("matchId");
            const found = rawSubMatches.find(
              (x) => String(x.matchId) === String(mid)
            );
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  oddsHistory: {
                    matchId: mid,
                    hadList: found?.had ? [found.had] : [],
                    hhadList: found?.hhad ? [found.hhad] : [],
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
                  total: officialResultsPayload.length,
                  pages: 1,
                  matchResult: officialResultsPayload,
                },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ value: {} }) };
        },
      });

      await runtimeOn.historyCoordinator.start();
      await runtimeOn.historyCoordinator.pollLiveBoardOnce();
      await runtimeOn.historyCoordinator.drainPendingOpenQuotes({
        maxItems: 16,
      });
      await runtimeOn.historyCoordinator.backfillResultsWindow({
        beginDate: "2026-09-01",
        endDate: "2026-09-30",
      });
      assert.ok(runtimeOn.historyCoordinator.getSnapshot().seq >= 3);

      const sessOff = await bootAndLoginSuperAdmin(runtimeOff, () => nowMs);
      const sessOn = await bootAndLoginSuperAdmin(runtimeOn, () => nowMs);

      for (const sc of scenarios) {
        currentBoardMatches = sc.matches;
        // Force fresh board load for each scenario
        await runtimeOff.appRoutes.ensureMatchesLoaded(true);
        await runtimeOn.appRoutes.ensureMatchesLoaded(true);

        const resOff = await sessOff.callEncryptedRaw(
          "quant/compute",
          sc.params,
          sessOff.authToken
        );
        const resOn = await sessOn.callEncryptedRaw(
          "quant/compute",
          sc.params,
          sessOn.authToken
        );

        assert.equal(resOff.statusCode, 200, sc.name);
        assert.equal(resOn.statusCode, 200, sc.name);

        // Outer encrypted response envelope shape must remain 100% identical ({ ok: true, payload: { iv, d } })
        assert.deepEqual(Object.keys(resOff.outJson).sort(), ["ok", "payload"]);
        assert.deepEqual(Object.keys(resOn.outJson).sort(), ["ok", "payload"]);
        assert.deepEqual(Object.keys(resOff.outJson.payload).sort(), [
          "d",
          "iv",
        ]);
        assert.deepEqual(Object.keys(resOn.outJson.payload).sort(), [
          "d",
          "iv",
        ]);

        const decOff = resOff.decrypt() as QuantWorkspaceResponse;
        const decOn = resOn.decrypt() as QuantWorkspaceResponse;

        assert.deepEqual(
          projectDeterministicWorkspaceSummary(decOn),
          projectDeterministicWorkspaceSummary(decOff),
          `Scenario "${sc.name}" must produce 100% identical 4 slots, ticket lines, multipliers & payouts with vs without history coordinator`
        );

        // Verify statutory settlement parity on every admitted slot
        for (let i = 0; i < decOff.portfolioPlans.length; i += 1) {
          const slotOff = decOff.portfolioPlans[i];
          const slotOn = decOn.portfolioPlans[i];
          if (!slotOff.available || slotOff.lines.length === 0) continue;

          const settleOff = settleTicketSnapshotWithOfficialResults(
            { lines: slotOff.lines },
            officialResultsPayload,
            { stakeCost: slotOff.totalCost }
          );
          const settleOn = settleTicketSnapshotWithOfficialResults(
            { lines: slotOn.lines },
            runtimeOn.historyCoordinator.getSnapshot().resultsById,
            { stakeCost: slotOn.totalCost }
          );
          assert.equal(settleOn.status, settleOff.status, sc.name);
          assert.equal(
            settleOn.settledReturn,
            settleOff.settledReturn,
            sc.name
          );
          assert.equal(settleOn.netProfit, settleOff.netProfit, sc.name);
        }
      }
    } finally {
      await runtimeOff?.dispose?.();
      await runtimeOn?.dispose?.();
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    }
  });

  it("Slice 2 (Read-Only Exposure Separation, Non-Fallback Gate & WAL Persistence): separates natural missing-pool board intervals from real workbench exposures, ignores empty/timeout/maintenance/builtin fallbacks, binds matchId/decidedAt/poolStates/quotes/modelVersion, and persists across WAL restart", async () => {
    const tmpDir = makeTempDir("yj-spec15-t18-s2-");
    let nowMs = parseBeijingDateTimeMs("2026-11-20", "15:00:00")!;
    const { rawSubMatches } = loadRealOosFixtureBundle();

    // Build 3 live matches kicking off at 2026-11-20 22:00:00:
    // - 2051001: HAD naturally NOT selling (missing pool), HHAD/TTG/HAFU/CRS selling
    // - 2051002: all 5 pools selling
    // - 2051003: CRS naturally missing, never touched by workbench compute/sync targets
    const rawThree = structuredClone(rawSubMatches.slice(0, 3));
    rawThree[0].matchId = "2051001";
    rawThree[0].matchNumStr = "周五001";
    rawThree[0].matchDate = "2026-11-20";
    rawThree[0].matchTime = "22:00:00";
    rawThree[0].had = {};
    rawThree[0].poolList = rawThree[0].poolList.map((p: any) =>
      p.poolCode === "HAD" ? { ...p, poolStatus: "Close" } : p
    );

    rawThree[1].matchId = "2051002";
    rawThree[1].matchNumStr = "周五002";
    rawThree[1].matchDate = "2026-11-20";
    rawThree[1].matchTime = "22:00:00";

    rawThree[2].matchId = "2051003";
    rawThree[2].matchNumStr = "周五003";
    rawThree[2].matchDate = "2026-11-20";
    rawThree[2].matchTime = "22:00:00";
    rawThree[2].crs = {};
    rawThree[2].poolList = rawThree[2].poolList.map((p: any) =>
      p.poolCode === "CRS" ? { ...p, poolStatus: "Close" } : p
    );

    const parsedThree = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: rawThree }] },
    }) as MatchItem[];

    let boardMode: "fresh" | "empty" | "timeout" | "maint" | "builtin" =
      "builtin";
    let rt1: any = null;
    let rt2: any = null;

    try {
      const makeFeed = async () => {
        if (boardMode === "builtin") {
          return {
            matches: parsedThree,
            source: "fallback",
            boardMeta: {
              source: "fallback",
              boardState: "builtin-fallback",
              lastValidBoardAt: null,
              lastValidBoardClock: null,
              isFallbackReadOnly: true,
              bannerText: "内置回退",
            },
          };
        }
        if (boardMode === "empty") {
          return {
            matches: [],
            source: "cached-snapshot",
            boardMeta: {
              source: "cached-snapshot",
              boardState: "empty-board-fallback",
              lastValidBoardAt: nowMs - 60_000,
              lastValidBoardClock: "11-20 14:59",
              isFallbackReadOnly: true,
              bannerText: "空板回退",
            },
          };
        }
        if (boardMode === "timeout") {
          throw new Error("Gateway timeout");
        }
        if (boardMode === "maint") {
          return {
            matches: parsedThree,
            source: "cached-snapshot",
            boardMeta: {
              source: "cached-snapshot",
              boardState: "maintenance-fallback",
              lastValidBoardAt: nowMs - 60_000,
              lastValidBoardClock: "11-20 14:59",
              isFallbackReadOnly: true,
              bannerText: "维护回退",
            },
          };
        }
        return {
          matches: structuredClone(parsedThree),
          source: "official-live",
          boardMeta: {
            source: "official-live",
            boardState: "fresh",
            lastValidBoardAt: nowMs,
            lastValidBoardClock: "11-20 15:00",
            isFallbackReadOnly: false,
            bannerText: null,
          },
        };
      };

      rt1 = createYouJingRuntime({
        dataDir: tmpDir,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        nowFn: () => nowMs,
        fetchMatches: makeFeed,
        historyFetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ value: {} }),
        }),
      });
      await rt1.historyCoordinator.start();

      const admin1 = await bootAndLoginSuperAdmin(rt1, () => nowMs);

      // 1. Builtin fallback board: /api/quant/compute MUST NOT record workbench exposure
      await admin1.callEncryptedRaw(
        "quant/compute",
        {
          picks: [makePickFromMatch(parsedThree[1], "HAD", "h")],
          multiple: 2,
          targetIds: ["2051001", "2051002"],
          budget: 100,
        },
        admin1.authToken
      );

      // 2. Switch to fresh board on sync ONLY for board ingestion? First test fresh board passive ingest via coordinator without user compute:
      boardMode = "fresh";
      await rt1.historyCoordinator.ingestLiveBoard({
        matches: parsedThree,
        boardMeta: {
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: nowMs,
          lastValidBoardClock: "11-20 15:00",
          isFallbackReadOnly: false,
          bannerText: null,
        },
      });

      const ovPassiveRes = await admin1.callEncryptedRaw(
        "admin/overview",
        {},
        admin1.authToken
      );
      const ovPassive = ovPassiveRes.decrypt() as any;
      assert.ok(
        ovPassive.historyMonitor,
        "Expected historyMonitor in overview"
      );
      assert.equal(
        ovPassive.historyMonitor.naturalMissingPools.distinctMatchCount,
        2,
        "2051001 (missing HAD) and 2051003 (missing CRS) must be recorded as natural missing-pool intervals"
      );
      assert.equal(
        ovPassive.historyMonitor.naturalMissingPools.hadMissingIntervalCount,
        1
      );
      assert.equal(
        ovPassive.historyMonitor.workbenchExposures.rawEvaluationFrames,
        0,
        "Bootstrap/login and builtin-fallback compute must record 0 real workbench exposures"
      );
      assert.equal(
        ovPassive.historyMonitor.workbenchExposures.skippedFallbackEvaluations,
        1
      );

      // 3. Empty-board, timeout, and maintenance fallbacks during /api/quant/sync and /api/quant/compute MUST record 0 exposures & 0 new missing-pool intervals
      for (const fbMode of ["empty", "timeout", "maint"] as const) {
        nowMs += 60_000;
        boardMode = fbMode;
        await admin1.callEncryptedRaw(
          "quant/sync",
          {
            workspaceParams: {
              picks: [makePickFromMatch(parsedThree[1], "HAD", "h")],
              multiple: 2,
              targetIds: ["2051001", "2051002"],
              budget: 100,
            },
          },
          admin1.authToken
        );
        await admin1.callEncryptedRaw(
          "quant/compute",
          {
            picks: [makePickFromMatch(parsedThree[1], "HAD", "h")],
            multiple: 2,
            targetIds: ["2051001", "2051002"],
            budget: 100,
          },
          admin1.authToken
        );
      }

      const ovAfterFallbacks = (
        await admin1.callEncryptedRaw("admin/overview", {}, admin1.authToken)
      ).decrypt() as any;
      assert.equal(
        ovAfterFallbacks.historyMonitor.workbenchExposures.rawEvaluationFrames,
        0,
        "Empty/timeout/maintenance fallbacks must NEVER count as real workbench exposures"
      );
      assert.equal(
        ovAfterFallbacks.historyMonitor.workbenchExposures
          .skippedFallbackEvaluations,
        7
      );
      assert.equal(
        ovAfterFallbacks.historyMonitor.naturalMissingPools.totalIntervals,
        2,
        "Empty/timeout/maintenance fallbacks must NEVER fabricate extra missing-pool intervals"
      );

      // 4. Fresh verified live board: /api/quant/sync + /api/quant/compute on [2051001, 2051002]
      nowMs = parseBeijingDateTimeMs("2026-11-20", "16:00:00")!;
      boardMode = "fresh";
      await admin1.callEncryptedRaw(
        "quant/sync",
        {
          workspaceParams: {
            picks: [
              makePickFromMatch(parsedThree[0], "HHAD", "ha"),
              makePickFromMatch(parsedThree[1], "HAD", "h"),
            ],
            multiple: 5,
            targetIds: ["2051001", "2051002"],
            budget: 100,
            stance: "objective",
          },
        },
        admin1.authToken
      );

      const ovFresh = (
        await admin1.callEncryptedRaw("admin/overview", {}, admin1.authToken)
      ).decrypt() as any;
      const wbExp = ovFresh.historyMonitor.workbenchExposures;
      assert.equal(wbExp.rawEvaluationFrames, 1);
      assert.equal(wbExp.deduplicatedMatchCount, 2);
      assert.equal(
        wbExp.deduplicatedMissingPoolMatchCount,
        1,
        "Only 2051001 had a real workbench exposure with a missing pool (2051003 was never evaluated)"
      );

      const recMissing = wbExp.recentCanonicalMatches.find(
        (m: any) => m.matchId === "2051001"
      );
      assert.ok(recMissing);
      assert.equal(recMissing.decidedAt, nowMs);
      assert.equal(recMissing.hasMissingPool, true);
      assert.deepEqual(recMissing.missingPoolCodes, ["HAD"]);
      assert.equal(recMissing.poolStates.HAD.selling, false);
      assert.equal(recMissing.poolStates.HHAD.selling, true);
      assert.ok(
        typeof recMissing.modelVersion === "string" &&
          recMissing.modelVersion.length > 0
      );
      assert.ok(
        typeof recMissing.quoteInputSig === "string" &&
          recMissing.quoteInputSig.startsWith("v1|")
      );
      assert.ok(Number(recMissing.quotes.HHAD.ha) > 1);

      // Slot admissions recorded on live deduplicated sample
      const slotAdm = ovFresh.historyMonitor.slotAdmissions;
      assert.equal(slotAdm.liveDeduplicatedSampleCount, 1);
      for (const k of [
        "max-profit-prob",
        "max-ev-utility",
        "max-cvar-wheel",
        "alpha-radar",
      ]) {
        assert.equal(
          slotAdm.liveBySlot[k].admittedCount +
            slotAdm.liveBySlot[k].rejectedCount,
          1
        );
      }

      // Allow non-blocking worker RPC to flush to WAL before clean dispose & restart
      await rt1.historyCoordinator.flushPendingWork?.();
      await rt1.dispose();
      rt1 = null;

      // 5. Restart runtime against same dataDir and verify WAL persistence of exposures
      rt2 = createYouJingRuntime({
        dataDir: tmpDir,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        nowFn: () => nowMs,
        fetchMatches: makeFeed,
        historyFetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ value: {} }),
        }),
      });
      await rt2.historyCoordinator.start();
      const admin2 = await bootAndLoginSuperAdmin(rt2, () => nowMs);
      const ovRestart = (
        await admin2.callEncryptedRaw("admin/overview", {}, admin2.authToken)
      ).decrypt() as any;
      assert.equal(
        ovRestart.historyMonitor.workbenchExposures.deduplicatedMatchCount,
        2,
        "Canonical workbench match exposures must survive WAL restart"
      );
      assert.equal(
        ovRestart.historyMonitor.slotAdmissions.liveDeduplicatedSampleCount,
        1
      );
    } finally {
      await rt1?.dispose?.();
      await rt2?.dispose?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 3 (1-Sample-Per-Match Deduplication, matchDate+3d Embargo & Independent 4-Bucket Proper Scoring Oracle): deduplicates multi-frame & overlapping-match requests, blocks scoring until matchDate+3d, guards void-sim sandbox previews, and matches independent Brier/LogLoss across all 4 return buckets", async () => {
    const tmpDir = makeTempDir("yj-spec15-t18-s3-");
    let nowMs = parseBeijingDateTimeMs("2026-11-20", "14:00:00")!;
    const { rawSubMatches } = loadRealOosFixtureBundle();

    // Build 6 single-eligible live matches on 2026-11-20 kicking off at 22:00:00:
    // 2060001: HAD h=2.00, d=3.35, a=3.10 -> FT 2:0 (strictNetGain on single h)
    // 2060002: overlapping companion match
    // 2060003: HAD h=1.65, d=3.40, a=4.30 -> duplex (h+d, 1x, cost ¥4), FT 2:1 -> return ¥3.30 < ¥4 (underwater!)
    // 2060004: HAD h=2.00, d=3.10, a=3.35 -> duplex (h+d, 1x, cost ¥4), FT 1:0 -> return ¥4.00 == ¥4 (breakEven!)
    // 2060005: HAD h=2.10, d=3.30, a=2.90 -> single h (2x, cost ¥4), FT 0:2 -> return ¥0 (wipeout!)
    // 2060006: HAD h=2.00, d=3.30, a=3.10 -> evaluated ONLY with simVoidFirstMatch=true; FT 0:2 (must NOT score simulated void odds=1.0 refund as breakEven!)
    const mkRaw = (
      idx: number,
      id: string,
      numStr: string,
      hadOdds: [string, string, string]
    ) => {
      const base = structuredClone(rawSubMatches[idx % rawSubMatches.length]);
      base.matchId = id;
      base.matchNumStr = numStr;
      base.matchDate = "2026-11-20";
      base.matchTime = "22:00:00";
      base.had = {
        ...base.had,
        h: hadOdds[0],
        d: hadOdds[1],
        a: hadOdds[2],
        updateDate: "2026-11-20",
        updateTime: "13:50:00",
      };
      base.poolList = base.poolList.map((p: any) =>
        p.poolCode === "HAD" ? { ...p, single: 1, bettingSingle: 1 } : p
      );
      return base;
    };

    let rawSix = [
      mkRaw(0, "2060001", "周五101", ["2.00", "3.35", "3.10"]),
      mkRaw(1, "2060002", "周五102", ["1.90", "3.40", "3.30"]),
      mkRaw(2, "2060003", "周五103", ["1.65", "3.40", "4.30"]),
      mkRaw(3, "2060004", "周五104", ["2.00", "3.10", "3.35"]),
      mkRaw(4, "2060005", "周五105", ["2.10", "3.30", "2.90"]),
      mkRaw(5, "2060006", "周五106", ["2.00", "3.30", "3.10"]),
    ];

    const getParsedBoard = () =>
      parseSportteryRawJson({
        value: { matchInfoList: [{ subMatchList: rawSix }] },
      }) as MatchItem[];

    const settledResultsList = [
      {
        matchId: "2060001",
        matchNumStr: "周五101",
        matchDate: "2026-11-20",
        homeTeam: "主1",
        awayTeam: "客1",
        h: "2.00",
        d: "3.35",
        a: "3.10",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "1:0",
        sectionsNo999: "2:0",
      },
      {
        matchId: "2060002",
        matchNumStr: "周五102",
        matchDate: "2026-11-20",
        homeTeam: "主2",
        awayTeam: "客2",
        h: "1.90",
        d: "3.40",
        a: "3.30",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "0:0",
        sectionsNo999: "1:0",
      },
      {
        matchId: "2060003",
        matchNumStr: "周五103",
        matchDate: "2026-11-20",
        homeTeam: "主3",
        awayTeam: "客3",
        h: "1.65",
        d: "3.40",
        a: "4.30",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "1:1",
        sectionsNo999: "2:1",
      },
      {
        matchId: "2060004",
        matchNumStr: "周五104",
        matchDate: "2026-11-20",
        homeTeam: "主4",
        awayTeam: "客4",
        h: "2.00",
        d: "3.10",
        a: "3.35",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "1:0",
        sectionsNo999: "1:0",
      },
      {
        matchId: "2060005",
        matchNumStr: "周五105",
        matchDate: "2026-11-20",
        homeTeam: "主5",
        awayTeam: "客5",
        h: "2.10",
        d: "3.30",
        a: "2.90",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "0:1",
        sectionsNo999: "0:2",
      },
      {
        matchId: "2060006",
        matchNumStr: "周五106",
        matchDate: "2026-11-20",
        homeTeam: "主6",
        awayTeam: "客6",
        h: "2.00",
        d: "3.30",
        a: "3.10",
        matchResultStatus: "2",
        poolStatus: "Payout",
        sectionsNo1: "0:1",
        sectionsNo999: "0:2",
      },
    ];

    let rt: any = null;
    try {
      rt = createYouJingRuntime({
        dataDir: tmpDir,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        sessionTtlMs: 10 * 86_400_000,
        nowFn: () => nowMs,
        fetchMatches: async () => ({
          matches: getParsedBoard(),
          source: "official-live",
          boardMeta: {
            source: "official-live",
            boardState: "fresh",
            lastValidBoardAt: nowMs,
            lastValidBoardClock: "11-20 14:00",
            isFallbackReadOnly: false,
            bannerText: null,
          },
        }),
        historyFetchFn: async (url: string) => {
          const u = new URL(url);
          if (u.pathname.endsWith("/getUniformMatchResultV1.qry")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  total: settledResultsList.length,
                  pages: 1,
                  matchResult: settledResultsList,
                },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ value: {} }) };
        },
      });
      await rt.historyCoordinator.start();
      const admin = await bootAndLoginSuperAdmin(rt, () => nowMs);

      const board0 = getParsedBoard();

      // Sample 1 (strictNetGain): Frame 1 on 2060001 @ 14:00 (HAD h @ 2.00, 5x -> cost ¥10, FT 2:0 -> return ¥20 > ¥10)
      const ws1 = (
        await admin.callEncryptedRaw(
          "quant/compute",
          {
            picks: [makePickFromMatch(board0[0], "HAD", "h")],
            multiple: 5,
            targetIds: ["2060001"],
            budget: 100,
          },
          admin.authToken
        )
      ).decrypt() as QuantWorkspaceResponse;

      // Multi-frame duplicate requests on 2060001 as odds tick 4 more times (MUST deduplicate to Frame 1!)
      for (const nextH of ["1.95", "1.90", "1.86", "1.82"]) {
        nowMs += 5 * 60_000;
        rawSix[0].had.h = nextH;
        await admin.callEncryptedRaw(
          "quant/sync",
          {
            workspaceParams: {
              picks: [makePickFromMatch(getParsedBoard()[0], "HAD", "h")],
              multiple: 5,
              targetIds: ["2060001"],
              budget: 100,
            },
          },
          admin.authToken
        );
      }

      // Overlapping parlay [2060001, 2060002]: 2060001 was already claimed, so this parlay MUST NOT double-count 2060001 in calibration!
      const boardAfterTick = getParsedBoard();
      await admin.callEncryptedRaw(
        "quant/compute",
        {
          picks: [
            makePickFromMatch(boardAfterTick[0], "HAD", "h"),
            makePickFromMatch(boardAfterTick[1], "HAD", "h"),
          ],
          multiple: 2,
          targetIds: ["2060001", "2060002"],
          budget: 100,
        },
        admin.authToken
      );

      // Sample 2 (underwater): 2060003 duplex h@1.65 + d@3.40 (1x each, cost ¥4; FT 2:1 -> return ¥3.30 < ¥4)
      const ws2 = (
        await admin.callEncryptedRaw(
          "quant/compute",
          {
            picks: [
              makePickFromMatch(boardAfterTick[2], "HAD", "h"),
              makePickFromMatch(boardAfterTick[2], "HAD", "d"),
            ],
            multiple: 1,
            targetIds: ["2060003"],
            budget: 100,
          },
          admin.authToken
        )
      ).decrypt() as QuantWorkspaceResponse;

      // Sample 3 (breakEven): 2060004 duplex h@2.00 + d@3.10 (1x each, cost ¥4; FT 1:0 -> return ¥4.00 == ¥4)
      const ws3 = (
        await admin.callEncryptedRaw(
          "quant/compute",
          {
            picks: [
              makePickFromMatch(boardAfterTick[3], "HAD", "h"),
              makePickFromMatch(boardAfterTick[3], "HAD", "d"),
            ],
            multiple: 1,
            targetIds: ["2060004"],
            budget: 100,
          },
          admin.authToken
        )
      ).decrypt() as QuantWorkspaceResponse;

      // Sample 4 (wipeout): 2060005 single h@2.10 (2x, cost ¥4; FT 0:2 -> return ¥0)
      const ws4 = (
        await admin.callEncryptedRaw(
          "quant/compute",
          {
            picks: [makePickFromMatch(boardAfterTick[4], "HAD", "h")],
            multiple: 2,
            targetIds: ["2060005"],
            budget: 100,
          },
          admin.authToken
        )
      ).decrypt() as QuantWorkspaceResponse;

      // Void-match simulation preview on 2060006 (simVoidFirstMatch: true):
      // Even though eff.tickets has simulated void odds=1.0 (which would refund ¥4 == cost if mistakenly settled!),
      // monitor MUST ignore simulated void-preview eff.tickets and fall back to clean objective portfolio or skip void-sim!
      await admin.callEncryptedRaw(
        "quant/compute",
        {
          picks: [makePickFromMatch(boardAfterTick[5], "HAD", "h")],
          multiple: 2,
          simVoidFirstMatch: true,
          targetIds: ["2060006"],
          budget: 2, // too small for multi-note shield if needed, or clean objective slot on 2060006
        },
        admin.authToken
      );

      // Backfill official settled results on 2026-11-21 (without settlementPublishedAt -> embargo until 2026-11-23 00:00:00)
      nowMs = parseBeijingDateTimeMs("2026-11-21", "10:00:00")!;
      await rt.historyCoordinator.backfillResultsWindow({
        beginDate: "2026-11-01",
        endDate: "2026-11-21",
      });

      // Check 1 second BEFORE matchDate + 3d embargo expires (2026-11-22 23:59:59)
      nowMs = parseBeijingDateTimeMs("2026-11-22", "23:59:59")!;
      const ovBeforeEmbargo = (
        await admin.callEncryptedRaw("admin/overview", {}, admin.authToken)
      ).decrypt() as any;

      assert.equal(
        ovBeforeEmbargo.historyMonitor.workbenchExposures.rawEvaluationFrames,
        10
      );
      assert.equal(
        ovBeforeEmbargo.historyMonitor.workbenchExposures
          .deduplicatedMatchCount,
        6
      );
      // 2060001 had 6 raw frames (Frame 1 + 4 sync ticks + 1 overlapping parlay), canonical decidedAt stays 14:00!
      const m1Rec =
        ovBeforeEmbargo.historyMonitor.workbenchExposures.recentCanonicalMatches.find(
          (x: any) => x.matchId === "2060001"
        );
      assert.equal(m1Rec.rawFrameCount, 6);
      assert.equal(m1Rec.quotes.HAD.h, 2.0);
      assert.equal(
        ovBeforeEmbargo.historyMonitor.workbenchExposures
          .embargoedSettledMatchCount,
        6
      );
      assert.equal(
        ovBeforeEmbargo.historyMonitor.workbenchExposures
          .settledUnembargoedMatchCount,
        0
      );
      assert.equal(
        ovBeforeEmbargo.historyMonitor.fourBucketCalibration.sampleCount,
        0,
        "Zero settled samples may enter calibration scoring before matchDate + 3d embargo expires!"
      );
      assert.equal(
        ovBeforeEmbargo.historyMonitor.fourBucketCalibration.brierScore,
        null
      );
      assert.equal(
        ovBeforeEmbargo.historyMonitor.fourBucketCalibration.logLoss,
        null
      );
      assert.equal(
        ovBeforeEmbargo.historyMonitor.slotAdmissions
          .settledUnembargoedSampleCount,
        0
      );

      // Advance clock 1 second to 2026-11-23 00:00:00 (embargo lifted!)
      nowMs = parseBeijingDateTimeMs("2026-11-23", "00:00:00")!;
      const ovAfterEmbargo = (
        await admin.callEncryptedRaw("admin/overview", {}, admin.authToken)
      ).decrypt() as any;

      assert.equal(
        ovAfterEmbargo.historyMonitor.workbenchExposures
          .embargoedSettledMatchCount,
        0
      );
      assert.equal(
        ovAfterEmbargo.historyMonitor.workbenchExposures
          .settledUnembargoedMatchCount,
        6
      );

      const cal = ovAfterEmbargo.historyMonitor.fourBucketCalibration;
      // 4 genuine pre-kickoff samples (2060001, 2060003, 2060004, 2060005); simVoidFirstMatch=true preview on 2060006 must NOT enter calibration!
      assert.equal(cal.sampleCount, 4);
      assert.equal(cal.buckets.wipeout.empiricalCount, 1);
      assert.equal(cal.buckets.underwater.empiricalCount, 1);
      assert.equal(cal.buckets.breakEven.empiricalCount, 1);
      assert.equal(cal.buckets.strictNetGain.empiricalCount, 1);
      assert.equal(cal.buckets.wipeout.empiricalRate, 0.25);
      assert.equal(cal.buckets.underwater.empiricalRate, 0.25);
      assert.equal(cal.buckets.breakEven.empiricalRate, 0.25);
      assert.equal(cal.buckets.strictNetGain.empiricalRate, 0.25);

      // Independent hand-computed multi-class Brier & Log-Loss oracle from ws1..ws4 objective probabilities
      const vecOf = (ws: QuantWorkspaceResponse) => {
        const r = ws.effectiveReport;
        const v = [
          r.objectiveZeroPayoutProb ?? r.zeroPayoutProb,
          r.objectivePartialLossProb ?? r.partialLossProb,
          r.objectiveBreakEvenProb ?? r.breakEvenProb,
          r.objectiveStrictNetGainProb ?? r.strictNetGainProb,
        ];
        const s = v[0] + v[1] + v[2] + v[3];
        return v.map((x) => x / s);
      };
      // Realized buckets: ws1 -> 3 (strictNetGain), ws2 -> 1 (underwater), ws3 -> 2 (breakEven), ws4 -> 0 (wipeout)
      const oraclePairs: Array<[number[], number]> = [
        [vecOf(ws1), 3],
        [vecOf(ws2), 1],
        [vecOf(ws3), 2],
        [vecOf(ws4), 0],
      ];
      let expectedBrierSum = 0;
      let expectedLogLossSum = 0;
      for (const [pVec, winIdx] of oraclePairs) {
        for (let k = 0; k < 4; k += 1) {
          const y = k === winIdx ? 1 : 0;
          expectedBrierSum += (pVec[k] - y) ** 2;
        }
        expectedLogLossSum += -Math.log(Math.max(1e-12, pVec[winIdx]));
      }
      const expectedBrier = expectedBrierSum / 4;
      const expectedLogLoss = expectedLogLossSum / 4;

      assert.ok(
        Math.abs(cal.brierScore - expectedBrier) <= 1e-5,
        `Expected Brier ${expectedBrier}, got ${cal.brierScore}`
      );
      assert.ok(
        Math.abs(cal.logLoss - expectedLogLoss) <= 1e-5,
        `Expected LogLoss ${expectedLogLoss}, got ${cal.logLoss}`
      );

      // Per-slot settled unembargoed admission counts & per-slot calibration metrics
      const settledSlots = ovAfterEmbargo.historyMonitor.slotAdmissions;
      assert.equal(settledSlots.settledUnembargoedSampleCount, 4);
      assert.equal(
        typeof settledSlots.settledBySlot["max-ev-utility"]
          .calibratedSampleCount,
        "number"
      );
    } finally {
      await rt?.dispose?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 4 (Super-Admin RBAC Isolation, Zero Public Bare Routes & Tab 3 View-Model Mapping): rejects unauthenticated/member callers with 401/403, exposes zero public history routes, reports storageBytes/cursors/4-endpoints/calibration to superadmin, and maps Tab 3 view-model", async () => {
    const tmpDir = makeTempDir("yj-spec15-t18-s4-");
    let nowMs = parseBeijingDateTimeMs("2026-09-16", "15:00:00")!;
    const { rawSubMatches, parsedMatches } = loadRealOosFixtureBundle();
    let rt: any = null;

    try {
      rt = createYouJingRuntime({
        dataDir: tmpDir,
        enableHistoryCollector: true,
        historyAutoPoll: false,
        historyStorageBackend: "sqlite",
        sessionTtlMs: 90 * 86_400_000,
        nowFn: () => nowMs,
        fetchMatches: async () => ({
          matches: structuredClone(parsedMatches.slice(0, 3)),
          source: "official-live",
          boardMeta: {
            source: "official-live",
            boardState: "fresh",
            lastValidBoardAt: nowMs,
            lastValidBoardClock: "11-23 11:00",
            isFallbackReadOnly: false,
            bannerText: null,
          },
        }),
        historyFetchFn: async (url: string) => {
          const u = new URL(url);
          if (u.pathname.endsWith("/getMatchCalculatorV1.qry")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  matchInfoList: [{ subMatchList: rawSubMatches.slice(0, 2) }],
                },
              }),
            };
          }
          if (u.pathname.endsWith("/getFixedBonusV1.qry")) {
            const mid = u.searchParams.get("matchId");
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  oddsHistory: {
                    matchId: mid,
                    hadList: [rawSubMatches[0].had],
                  },
                },
              }),
            };
          }
          if (u.pathname.endsWith("/getMatchHeadV1.qry")) {
            // Simulate HTTP 503 backoff on matchHead endpoint
            return { ok: false, status: 503, json: async () => ({}) };
          }
          if (u.pathname.endsWith("/getUniformMatchResultV1.qry")) {
            const begin = u.searchParams.get("matchBeginDate") || "";
            const pageNo = Number(u.searchParams.get("pageNo") || "1");
            if (begin.startsWith("2024-")) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  value: {
                    total: 1,
                    pages: 1,
                    matchResult: [
                      {
                        matchId: "1800001",
                        matchNumStr: "周六001",
                        matchDate: "2024-06-10",
                        homeTeam: "旧主",
                        awayTeam: "旧客",
                        h: "1.90",
                        d: "3.30",
                        a: "3.40",
                        matchResultStatus: "2",
                        poolStatus: "Payout",
                        sectionsNo1: "1:0",
                        sectionsNo999: "2:0",
                      },
                    ],
                  },
                }),
              };
            }
            // 2026 window: 2 pages, page 2 fails -> partial cursor with nextRetryPage=2
            if (pageNo === 2) {
              return { ok: false, status: 502, json: async () => ({}) };
            }
            return {
              ok: true,
              status: 200,
              json: async () => ({
                value: {
                  total: 2,
                  pages: 2,
                  matchResult: [
                    {
                      matchId: parsedMatches[0].id,
                      matchNumStr: parsedMatches[0].matchNumStr,
                      matchDate: "2026-09-16",
                      homeTeam: parsedMatches[0].home,
                      awayTeam: parsedMatches[0].away,
                      h: "2.04",
                      d: "3.34",
                      a: "2.95",
                      matchResultStatus: "2",
                      poolStatus: "Payout",
                      sectionsNo1: "0:1",
                      sectionsNo999: "0:2",
                    },
                  ],
                },
              }),
            };
          }
          return { ok: true, status: 200, json: async () => ({ value: {} }) };
        },
      });
      await rt.historyCoordinator.start();

      // Exercise live & open-quote & head endpoints pre-kickoff on 2026-09-16 15:00
      await rt.historyCoordinator.pollLiveBoardOnce();
      await rt.historyCoordinator.drainPendingOpenQuotes({ maxItems: 2 });
      await rt.historyCoordinator
        .backfillMatchHead(parsedMatches[0].id)
        .catch(() => {});

      const superAdmin = await bootAndLoginSuperAdmin(rt, () => nowMs);

      // 1. Unauthenticated caller (fresh unauthenticated session) to /api/admin/overview MUST get 401
      const unauthSess = await bootAnonymousSession(
        rt,
        () => nowMs,
        "d".repeat(64),
        "198.51.100.91"
      );
      const unauthOv = await unauthSess.callEncryptedRaw("admin/overview", {});
      assert.equal(unauthOv.statusCode, 401);

      // 2. Create an ordinary member account and verify /api/admin/overview returns 403 & UI gate returns false
      const createdRes = await superAdmin.callEncryptedRaw(
        "admin/create-user",
        {
          username: "member01",
          password: "MemberPass123",
          note: "普通成员测试",
          durationHours: 24,
          maxDevices: 2,
          aiEnabled: true,
          dailyAiLimit: 10,
        },
        superAdmin.authToken
      );
      assert.equal(createdRes.statusCode, 200);
      const createdMember = createdRes.decrypt() as any;

      const memberSess = await bootAnonymousSession(
        rt,
        () => nowMs,
        "c".repeat(64),
        "198.51.100.92"
      );
      const memberLoginRes = await memberSess.callEncryptedRaw("auth/login", {
        username: "member01",
        password: createdMember.plainPassword,
        hwFp: "c".repeat(64),
        deviceLabel: "Member Phone",
      });
      assert.equal(memberLoginRes.statusCode, 200);
      const memberBundle = memberLoginRes.decrypt() as any;
      assert.equal(memberBundle.user.role, "member");
      assert.equal(canAccessAdminConsole(memberBundle.user), false);
      assert.equal(canAccessAdminConsole(superAdmin.user), true);

      const memberOvRes = await memberSess.callEncryptedRaw(
        "admin/overview",
        {},
        memberBundle.authToken
      );
      assert.equal(
        memberOvRes.statusCode,
        403,
        "Ordinary member MUST be blocked from /api/admin/overview with 403"
      );

      // 3. Zero new public or bare history endpoints exist
      for (const [method, badUrl, expectHandled404] of [
        ["GET", "/api/history/status", false],
        ["POST", "/api/history/overview", false],
        ["POST", "/api/admin/history-monitor", true],
      ] as const) {
        const probeEx = makeHttpExchange({
          method,
          url: badUrl,
          body: method === "POST" ? {} : undefined,
        });
        const handled = await rt.gateway.handleRequest(
          probeEx.req,
          probeEx.res,
          badUrl
        );
        if (expectHandled404) {
          assert.equal(handled, true);
          assert.equal(probeEx.read().statusCode, 404);
        } else {
          assert.equal(
            handled,
            false,
            `Public/bare route ${method} ${badUrl} must NOT be registered on gateway`
          );
          assert.equal(probeEx.read().body, "");
        }
      }

      // Member evaluates a real pre-kickoff workbench compute on fresh live board (2026-09-16 15:00 < 21:18 kickoff)
      await memberSess.callEncryptedRaw(
        "quant/compute",
        {
          picks: [makePickFromMatch(parsedMatches[0], "HAD", "a")],
          multiple: 2,
          targetIds: [parsedMatches[0].id],
          budget: 100,
        },
        memberBundle.authToken
      );

      // Advance clock to 2026-11-23 11:00:00 (past +3d embargo), backfill 2024-06 + archive to cold .jsonl.gz + backfill 2026-09
      nowMs = parseBeijingDateTimeMs("2026-11-23", "11:00:00")!;
      await rt.historyCoordinator.backfillResultsWindow({
        beginDate: "2024-06-01",
        endDate: "2024-06-30",
      });
      await rt.historyCoordinator.archiveAndPruneHotStorage();
      await rt.historyCoordinator.backfillResultsWindow({
        beginDate: "2026-09-01",
        endDate: "2026-09-30",
      });

      // 4. Super-Admin fetches /api/admin/overview and inspects full historyMonitor
      const adminOvRes = await superAdmin.callEncryptedRaw(
        "admin/overview",
        {},
        superAdmin.authToken
      );
      assert.equal(adminOvRes.statusCode, 200);
      const adminOv = adminOvRes.decrypt() as any;
      const hm = adminOv.historyMonitor;
      assert.ok(hm);
      assert.equal(hm.collector.isWorkerRunning, true);
      assert.equal(hm.collector.storageBackend, "sqlite");

      // 4 endpoints present with matchHead backoff recorded
      assert.ok(hm.endpoints.liveCalculator.lastSuccessAt > 0);
      assert.ok(hm.endpoints.fixedBonus.lastSuccessAt > 0);
      assert.equal(hm.endpoints.matchHead.lastError, "HTTP_503");
      assert.ok(hm.endpoints.matchHead.backoffMs >= 5000);

      // Cursors summary: 1 completed (2024-06) + 1 partial (2026-09 at retry page 2)
      assert.equal(hm.cursors.totalWindows, 2);
      assert.equal(hm.cursors.completedWindows, 1);
      assert.equal(hm.cursors.partialWindows, 1);
      assert.equal(
        hm.cursors.windows["2026-09-01..2026-09-30"].nextRetryPage,
        2
      );

      // Storage bytes (hotDbBytes, walBytes, coldArchiveBytes, backupBytes, totalBytes)
      assert.ok(hm.storageBytes.hotDbBytes > 0);
      assert.ok(hm.storageBytes.coldArchiveBytes > 0);
      assert.equal(
        hm.storageBytes.totalBytes,
        hm.storageBytes.hotDbBytes +
          hm.storageBytes.walBytes +
          hm.storageBytes.coldArchiveBytes +
          hm.storageBytes.backupBytes
      );

      // Settled calibration sample scored (2026-09-16 is well past +3d embargo on 2026-11-23)
      assert.equal(hm.fourBucketCalibration.sampleCount, 1);
      assert.equal(
        hm.fourBucketCalibration.buckets.strictNetGain.empiricalCount,
        1
      );

      // 5. Tab 3 pure view-model mapping verification
      const tabs = buildAdminConsoleTabSpecs(
        adminOv.accounts.length,
        adminOv.auditLogs.length
      );
      assert.deepEqual(tabs, [
        ["users", `👥 账号与权限总控 (${adminOv.accounts.length})`],
        ["audit", `🛡️ 风控与违规提问日志 (${adminOv.auditLogs.length})`],
        ["history", ADMIN_HISTORY_MONITOR_TAB_LABEL],
      ]);
      assert.equal(ADMIN_HISTORY_MONITOR_TAB_LABEL, "📊 历史库与校准监测");

      const emptyVm = buildAdminHistoryMonitorViewModel(null);
      assert.equal(emptyVm.isAvailable, false);

      const vm = buildAdminHistoryMonitorViewModel(hm);
      assert.equal(vm.isAvailable, true);
      assert.equal(vm.tabLabel, "📊 历史库与校准监测");
      assert.equal(vm.endpointRows.length, 4);
      const headRow = vm.endpointRows.find((r) => r.key === "matchHead")!;
      assert.equal(headRow.tone, "warn");
      assert.ok(headRow.detailText.includes("HTTP_503"));
      assert.ok(vm.cursorSummary.headline.includes("1/2"));
      assert.equal(vm.storageSummary.breakdownItems.length, 4);
      assert.equal(vm.slotAdmissionRows.length, 4);
      assert.equal(vm.calibrationCard.bucketRows.length, 4);
      assert.ok(vm.calibrationCard.brierText !== "待积累完场样本");
    } finally {
      await rt?.dispose?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
