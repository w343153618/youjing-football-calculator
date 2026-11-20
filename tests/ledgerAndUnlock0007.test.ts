import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import { FALLBACK_MATCHES } from "../server/quantEngine.mjs";

const REAL_BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "sec-fetch-mode": "cors",
};

function makeHttpExchange(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
  body?: unknown;
}) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
    socket: { remoteAddress: string };
    destroy?: () => void;
  };
  req.method = opts.method || "POST";
  req.url = opts.url || "/";
  req.headers = Object.fromEntries(
    Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );
  req.socket = { remoteAddress: opts.remoteAddress || "198.51.100.88" };
  req.destroy = () => {};

  let statusCode = 200;
  const respHeaders: Record<string, string | string[]> = {};
  let rawOut = "";
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
    setHeader(k: string, v: string | string[]) {
      respHeaders[k.toLowerCase()] = v;
    },
    end(chunk = "") {
      headersSent = true;
      rawOut += String(chunk);
    },
  };

  queueMicrotask(() => {
    if (opts.body !== undefined) {
      req.emit("data", Buffer.from(JSON.stringify(opts.body), "utf8"));
    }
    req.emit("end");
  });

  return {
    req,
    res,
    getResult: () => ({ statusCode, respHeaders, body: rawOut }),
  };
}

describe("Spec 0007 Ticket 03 · Slice A: Scoped Super-Admin unlock-login IP Brute-Force Isolation", () => {
  it("clears brute-force cooldown ONLY for target account associated IPs while keeping unrelated attacking IPs in 429 cooldown and preserving 48h security-bans.json", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-0007-unlock-"));
    let clock = 1_760_000_000_000;

    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      nowFn: () => clock,
      fuseLoopback: true,
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: FALLBACK_MATCHES,
        syncNote: "测试快照",
      }),
    });

    try {
      const am = runtime.accountManager;
      const userA = am.createAccount({
        username: "member_alpha",
        password: "Alpha#123",
        durationHours: 24,
        maxDevices: 2,
      });
      const userB = am.createAccount({
        username: "member_bravo",
        password: "Bravo#123",
        durationHours: 24,
        maxDevices: 2,
      });
      const userC = am.createAccount({
        username: "member_charlie",
        password: "Charlie#123",
        durationHours: 24,
        maxDevices: 2,
      });

      const ipA = "198.51.100.101";
      const ipB = "203.0.113.202";
      const fusedIp = "203.0.113.250";
      const fusedHw = "deadbeef".repeat(8);

      // Trigger a 48h hardware + IP fuse and verify it is active
      runtime.gateway.tripFuse(fusedIp, null, undefined, true, fusedHw);
      assert.equal(
        runtime.gateway.isRequestFused(
          { headers: { "x-yj-hw": fusedHw } },
          fusedIp
        ),
        true
      );

      // IP-A triggers both IP-level cooldown (7 wrong tries) and Account-A lock (5th wrong try on member_alpha)
      for (let i = 0; i < 2; i++) {
        am.authenticateLogin({
          username: "typo_alpha",
          password: "bad",
          ip: ipA,
        });
      }
      for (let i = 0; i < 5; i++) {
        const resA = am.authenticateLogin({
          username: "member_alpha",
          password: "wrong_password",
          ip: ipA,
        });
        if (i === 4) assert.equal(resA.statusCode, 429);
      }

      // IP-B simultaneously sprays and locks both IP-B (7 wrong tries) and Account-B (5th wrong try on member_bravo)
      for (let i = 0; i < 2; i++) {
        am.authenticateLogin({
          username: "spray_probe",
          password: "bad",
          ip: ipB,
        });
      }
      for (let i = 0; i < 5; i++) {
        const resB = am.authenticateLogin({
          username: "member_bravo",
          password: "wrong_password",
          ip: ipB,
        });
        if (i === 4) assert.equal(resB.statusCode, 429);
      }

      // Confirm IP-B is IP-rate-limited even when trying clean Account-C with valid password
      const preUnlockSprayC = am.authenticateLogin({
        username: userC.user.username,
        password: "Charlie#123",
        ip: ipB,
      });
      assert.equal(preUnlockSprayC.ok, false);
      assert.equal(preUnlockSprayC.statusCode, 429);

      // Super-admin unlocks ONLY Account-A
      am.updateAccount(userA.user.id, { action: "unlock-login" });

      // 1. Account-A on IP-A can immediately log in with valid password
      const loginAAfterUnlock = am.authenticateLogin({
        username: "member_alpha",
        password: "Alpha#123",
        hwFp: "aaaa1111".repeat(4),
        ip: ipA,
      });
      assert.equal(loginAAfterUnlock.ok, true);

      // 2. IP-B MUST still be blocked with 429 (both against Account-B and against clean Account-C!)
      const postUnlockB = am.authenticateLogin({
        username: userB.user.username,
        password: "Bravo#123",
        ip: ipB,
      });
      assert.equal(postUnlockB.ok, false);
      assert.equal(postUnlockB.statusCode, 429);

      const postUnlockSprayC = am.authenticateLogin({
        username: userC.user.username,
        password: "Charlie#123",
        ip: ipB,
      });
      assert.equal(postUnlockSprayC.ok, false);
      assert.equal(postUnlockSprayC.statusCode, 429);

      // 3. Also verify boundDevices.lastIp & lastLoginIp cleanup when an already-bound user gets locked on a bound IP
      const boundIpA2 = "198.51.100.102";
      assert.equal(
        am.authenticateLogin({
          username: "member_alpha",
          password: "Alpha#123",
          hwFp: "bbbb2222".repeat(4),
          ip: boundIpA2,
        }).ok,
        true
      );
      // Lock boundIpA2 via spray typos, then lock member_alpha on ipA, and verify unlock-login clears boundIpA2 too
      for (let i = 0; i < 7; i++) {
        am.authenticateLogin({
          username: "typo_user",
          password: "bad",
          ip: boundIpA2,
        });
      }
      assert.equal(
        am.authenticateLogin({
          username: "member_alpha",
          password: "Alpha#123",
          ip: boundIpA2,
        }).statusCode,
        429
      );
      am.updateAccount(userA.user.id, { action: "unlock-login" });
      assert.equal(
        am.authenticateLogin({
          username: "member_alpha",
          password: "Alpha#123",
          hwFp: "bbbb2222".repeat(4),
          ip: boundIpA2,
        }).ok,
        true
      );
      // While IP-B is STILL 429!
      assert.equal(
        am.authenticateLogin({
          username: userC.user.username,
          password: "Charlie#123",
          ip: ipB,
        }).statusCode,
        429
      );

      // 4. 48-hour hardware/IP fuse remains 100% intact
      assert.equal(
        runtime.gateway.isRequestFused(
          { headers: { "x-yj-hw": fusedHw } },
          fusedIp
        ),
        true
      );
    } finally {
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Spec 0007 Ticket 03 · Slice B: Encrypted Dual-Track Stop-Loss Ledger Deep Module & Runtime Seam", () => {
  it("persists per-member live/paper ledger across restarts, enforces Beijing 00:00 reset, STOP_LOSS_EXCEEDED guardrail, settlement stats, user isolation, and admin delete cleanup", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-0007-ledger-"));
    // 2026-05-10 23:30:00 Beijing Time (UTC+8) => 2026-05-10T15:30:00Z
    let clock = Date.parse("2026-05-10T15:30:00.000Z");
    let nonceSeq = 1;

    let runtime = createYouJingRuntime({
      dataDir: tmpDir,
      nowFn: () => clock,
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: FALLBACK_MATCHES,
        syncNote: "测试快照",
      }),
    });

    const bootstrapClient = async (
      hwFp: string,
      authToken = "",
      ip = "198.51.100.88"
    ) => {
      const headers: Record<string, string> = {
        ...REAL_BROWSER_HEADERS,
        "content-type": "application/json",
        "x-yj-hw": hwFp,
      };
      if (authToken) headers["x-yj-auth"] = authToken;
      const ex = makeHttpExchange({
        method: "POST",
        url: "/api/security/bootstrap",
        remoteAddress: ip,
        headers,
        body: { v: 1, tz: "Asia/Shanghai", hwFp },
      });
      await runtime.gateway.handleRequest(
        ex.req,
        ex.res,
        "/api/security/bootstrap"
      );
      const r = ex.getResult();
      assert.equal(r.statusCode, 200);
      const json = JSON.parse(r.body);
      const { aesKey, hmacKey } = deriveSessionSubkeys(
        Buffer.from(json.k, "base64")
      );
      const decrypted = decryptEnvelope(
        aesKey,
        json.payload.iv,
        json.payload.d
      );
      return {
        sid: json.sid as string,
        aesKey,
        hmacKey,
        authToken,
        decrypted,
      };
    };

    const callEncrypted = async (
      sess: {
        sid: string;
        aesKey: Buffer;
        hmacKey: Buffer;
        authToken?: string;
      },
      endpoint: string,
      payloadObj: unknown,
      ip = "198.51.100.88"
    ) => {
      const env = encryptEnvelope(sess.aesKey, payloadObj);
      const ts = String(clock);
      const nonce = (nonceSeq++).toString(16).padStart(32, "0");
      const sig = computeEnvelopeHmacHex(
        sess.hmacKey,
        sess.sid,
        endpoint,
        ts,
        nonce,
        env.iv,
        env.d
      );
      const headers: Record<string, string> = {
        ...REAL_BROWSER_HEADERS,
        "content-type": "application/json",
        "x-yj-sid": sess.sid,
        "x-yj-ts": ts,
        "x-yj-nonce": nonce,
        "x-yj-sig": sig,
      };
      if (sess.authToken) headers["x-yj-auth"] = sess.authToken;
      const ex = makeHttpExchange({
        method: "POST",
        url: `/api/${endpoint}`,
        remoteAddress: ip,
        headers,
        body: env,
      });
      await runtime.gateway.handleRequest(ex.req, ex.res, `/api/${endpoint}`);
      const r = ex.getResult();
      const json = JSON.parse(r.body);
      return {
        statusCode: r.statusCode,
        json,
        decrypted: json?.payload
          ? decryptEnvelope(sess.aesKey, json.payload.iv, json.payload.d)
          : null,
      };
    };

    try {
      const user1 = runtime.accountManager.createAccount({
        username: "trader_one",
        password: "One#Pass1",
        durationHours: 72,
        maxDevices: 2,
      });
      const user2 = runtime.accountManager.createAccount({
        username: "trader_two",
        password: "Two#Pass2",
        durationHours: 72,
        maxDevices: 2,
      });

      // Unauthenticated call to /api/ledger/mutate MUST fail with 401
      const unauthBoot = await bootstrapClient("1111aaaa".repeat(8));
      const unauthMut = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "set-daily-limit",
        dailyLimit: 500,
      });
      assert.equal(unauthMut.statusCode, 401);

      // Login as trader_one -> bundle MUST contain clean empty initial ledger (zero fake items!)
      const login1 = await callEncrypted(unauthBoot, "auth/login", {
        username: "trader_one",
        password: "One#Pass1",
        hwFp: "1111aaaa".repeat(8),
        deviceLabel: "MacStudio",
      });
      assert.equal(login1.statusCode, 200);
      unauthBoot.authToken = login1.decrypted.authToken;

      const initLedger = login1.decrypted.ledger;
      assert.ok(
        initLedger,
        "Login bundle must include initial ledger snapshot"
      );
      assert.equal(initLedger.dailyLimit, 300);
      assert.equal(initLedger.usageDate, "2026-05-10");
      assert.equal(initLedger.dailyLiveSpent, 0);
      assert.equal(initLedger.dailyRemaining, 300);
      assert.deepEqual(initLedger.entries, []);
      assert.deepEqual(initLedger.stats, {
        liveSettledCount: 0,
        liveWonCount: 0,
        liveWinRatePct: 0,
        liveTotalStaked: 0,
        liveNetProfit: 0,
        liveRoiPct: 0,
        paperCount: 0,
        paperLostCount: 0,
        paperWonCount: 0,
        paperSavedAmount: 0,
      });

      // 1. Update daily stop-loss limit (clamping check + valid update to ¥250)
      const clampLow = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "set-daily-limit",
        dailyLimit: 5,
      });
      assert.equal(clampLow.statusCode, 200);
      assert.equal(clampLow.decrypted.ok, true);
      assert.equal(clampLow.decrypted.ledger.dailyLimit, 20);

      const set250 = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "set-daily-limit",
        dailyLimit: 250,
      });
      assert.equal(set250.decrypted.ledger.dailyLimit, 250);
      assert.equal(set250.decrypted.ledger.dailyRemaining, 250);

      // 2. Add first live ticket (cost = ¥150 <= ¥250 remaining)
      const addLive1 = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "add-entry",
        kind: "live",
        title: "2串1 · 博胆护盾 3注方案",
        modeLabel: "2串1",
        betCount: 3,
        cost: 150,
        minPayout: 218.4,
        maxPayout: 312.6,
      });
      assert.equal(addLive1.decrypted.ok, true);
      assert.equal(addLive1.decrypted.entry.kind, "live");
      assert.equal(addLive1.decrypted.entry.status, "pending");
      assert.equal(addLive1.decrypted.ledger.dailyLiveSpent, 150);
      assert.equal(addLive1.decrypted.ledger.dailyRemaining, 100);

      // 3. Attempt second live ticket (cost = ¥160 > ¥100 remaining) WITHOUT forceConfirmed -> STOP_LOSS_EXCEEDED!
      const blockedOver = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "add-entry",
        kind: "live",
        title: "3串1 · 冲动追单",
        modeLabel: "3串1",
        betCount: 1,
        cost: 160,
        minPayout: 520,
        maxPayout: 520,
      });
      assert.equal(blockedOver.statusCode, 200);
      assert.equal(blockedOver.decrypted.ok, false);
      assert.equal(blockedOver.decrypted.code, "STOP_LOSS_EXCEEDED");
      assert.equal(blockedOver.decrypted.dailyLimit, 250);
      assert.equal(blockedOver.decrypted.dailyRemaining, 100);
      assert.equal(blockedOver.decrypted.overBy, 60);
      assert.equal(
        blockedOver.decrypted.ledger.entries.length,
        1,
        "Blocked live ticket must NOT be saved"
      );

      // 4. User converts that ¥160 ticket into a 0-cost paper observation ticket!
      const addPaper1 = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "add-entry",
        kind: "paper",
        title: "3串1 · 冲动追单",
        modeLabel: "3串1",
        betCount: 1,
        cost: 160,
        paperRefCost: 160,
        minPayout: 520,
        maxPayout: 520,
      });
      assert.equal(addPaper1.decrypted.ok, true);
      assert.equal(
        addPaper1.decrypted.entry.cost,
        0,
        "Paper ticket real cost must be forced to 0"
      );
      assert.equal(addPaper1.decrypted.entry.paperRefCost, 160);
      assert.equal(
        addPaper1.decrypted.ledger.dailyLiveSpent,
        150,
        "Paper ticket must NOT consume guardrail"
      );
      assert.equal(addPaper1.decrypted.ledger.dailyRemaining, 100);

      // 5. User force-confirms a ¥120 live ticket (forceConfirmed: true)
      const forceLive2 = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "add-entry",
        kind: "live",
        title: "单关 · 精选主胜",
        modeLabel: "单关",
        betCount: 1,
        cost: 120,
        minPayout: 210,
        maxPayout: 210,
        forceConfirmed: true,
      });
      assert.equal(forceLive2.decrypted.ok, true);
      assert.equal(forceLive2.decrypted.ledger.dailyLiveSpent, 270);
      assert.equal(forceLive2.decrypted.ledger.dailyRemaining, 0);

      // 6. Settle entries:
      // - live1 won (default fallback to minPayout = 218.4 -> netProfit = 218.4 - 150 = +68.4)
      const settleLive1Default = await callEncrypted(
        unauthBoot,
        "ledger/mutate",
        {
          action: "settle-entry",
          entryId: addLive1.decrypted.entry.id,
          status: "won",
        }
      );
      assert.equal(settleLive1Default.decrypted.entry.settledReturn, 218.4);
      assert.equal(settleLive1Default.decrypted.entry.netProfit, 68.4);

      // - update live1 won with custom actual payout ¥260.5 -> netProfit = +110.5
      const settleLive1Custom = await callEncrypted(
        unauthBoot,
        "ledger/mutate",
        {
          action: "settle-entry",
          entryId: addLive1.decrypted.entry.id,
          status: "won",
          settledReturn: 260.5,
        }
      );
      assert.equal(settleLive1Custom.decrypted.entry.settledReturn, 260.5);
      assert.equal(settleLive1Custom.decrypted.entry.netProfit, 110.5);

      // - live2 lost -> settledReturn = 0, netProfit = -120
      const settleLive2Lost = await callEncrypted(unauthBoot, "ledger/mutate", {
        action: "settle-entry",
        entryId: forceLive2.decrypted.entry.id,
        status: "lost",
      });
      assert.equal(settleLive2Lost.decrypted.entry.settledReturn, 0);
      assert.equal(settleLive2Lost.decrypted.entry.netProfit, -120);

      // - paper1 lost -> real money saved = ¥160!
      const settlePaper1Lost = await callEncrypted(
        unauthBoot,
        "ledger/mutate",
        {
          action: "settle-entry",
          entryId: addPaper1.decrypted.entry.id,
          status: "lost",
        }
      );
      assert.equal(settlePaper1Lost.decrypted.entry.netProfit, 0);
      assert.deepEqual(settlePaper1Lost.decrypted.ledger.stats, {
        liveSettledCount: 2,
        liveWonCount: 1,
        liveWinRatePct: 50,
        liveTotalStaked: 270,
        liveNetProfit: -9.5,
        liveRoiPct: -3.52,
        paperCount: 1,
        paperLostCount: 1,
        paperWonCount: 0,
        paperSavedAmount: 160,
      });

      // 7. Advance clock 45 minutes across Beijing 00:00 midnight (to 2026-05-11 00:15 Beijing Time)
      clock += 45 * 60_000;

      // Simulate server restart on same dataDir + authenticated bootstrap on second device (phone)
      runtime.dispose();
      runtime = createYouJingRuntime({
        dataDir: tmpDir,
        nowFn: () => clock,
        enableXiaoGaoProbe: false,
        fetchMatches: async () => ({
          matches: FALLBACK_MATCHES,
          syncNote: "测试快照",
        }),
      });

      const phoneBoot = await bootstrapClient(
        "2222bbbb".repeat(8),
        unauthBoot.authToken
      );
      assert.equal(phoneBoot.decrypted.authenticated, true);
      assert.equal(phoneBoot.decrypted.ledger.usageDate, "2026-05-11");
      assert.equal(
        phoneBoot.decrypted.ledger.dailyLiveSpent,
        0,
        "Crossing Beijing 00:00 must reset dailyLiveSpent to 0"
      );
      assert.equal(phoneBoot.decrypted.ledger.dailyRemaining, 250);
      assert.equal(
        phoneBoot.decrypted.ledger.entries.length,
        3,
        "Historical entries persist across restarts"
      );
      assert.equal(phoneBoot.decrypted.ledger.stats.paperSavedAmount, 160);

      // 8. Delete an entry & reset an entry back to pending
      const addToday = await callEncrypted(phoneBoot, "ledger/mutate", {
        action: "add-entry",
        kind: "live",
        title: "今日误触单",
        modeLabel: "2串1",
        betCount: 1,
        cost: 80,
        minPayout: 150,
        maxPayout: 150,
      });
      assert.equal(addToday.decrypted.ledger.dailyLiveSpent, 80);
      assert.equal(addToday.decrypted.ledger.dailyRemaining, 170);

      const delToday = await callEncrypted(phoneBoot, "ledger/mutate", {
        action: "delete-entry",
        entryId: addToday.decrypted.entry.id,
      });
      assert.equal(
        delToday.decrypted.ledger.dailyLiveSpent,
        0,
        "Deleting today live entry refunds daily guardrail"
      );
      assert.equal(delToday.decrypted.ledger.dailyRemaining, 250);

      const resetPending = await callEncrypted(phoneBoot, "ledger/mutate", {
        action: "settle-entry",
        entryId: forceLive2.decrypted.entry.id,
        status: "pending",
      });
      assert.equal(resetPending.decrypted.entry.status, "pending");
      assert.equal(resetPending.decrypted.entry.netProfit, 0);
      assert.equal(resetPending.decrypted.entry.settledAt, null);
      assert.equal(resetPending.decrypted.ledger.stats.liveSettledCount, 1);
      assert.equal(resetPending.decrypted.ledger.stats.liveNetProfit, 110.5);

      // 9. Strict cross-account isolation: trader_two sees empty ledger even if trying to delete trader_one's entry
      const boot2 = await bootstrapClient("3333cccc".repeat(8));
      const login2 = await callEncrypted(boot2, "auth/login", {
        username: user2.user.username,
        password: "Two#Pass2",
        hwFp: "3333cccc".repeat(8),
      });
      boot2.authToken = login2.decrypted.authToken;
      assert.equal(login2.decrypted.ledger.entries.length, 0);
      const crossDelete = await callEncrypted(boot2, "ledger/mutate", {
        action: "delete-entry",
        entryId: addLive1.decrypted.entry.id,
      });
      assert.equal(crossDelete.statusCode, 400);
      assert.equal(
        runtime.ledgerManager.getUserLedger(user1.user.id).entries.length,
        3
      );

      // 10. Superadmin deleting trader_one via /api/admin/delete-user cleans up trader_one's ledger!
      const adminCredsRaw = fs.readFileSync(
        path.join(tmpDir, "admin-credentials.txt"),
        "utf8"
      );
      const adminUser =
        /ADMIN_USER=(.+)/.exec(adminCredsRaw)?.[1]?.trim() || "yjadmin";
      const adminPass =
        /ADMIN_INITIAL_PASSWORD=(.+)/.exec(adminCredsRaw)?.[1]?.trim() || "";
      const adminBoot = await bootstrapClient("9999ffff".repeat(8));
      const adminLogin = await callEncrypted(adminBoot, "auth/login", {
        username: adminUser,
        password: adminPass,
        hwFp: "9999ffff".repeat(8),
      });
      adminBoot.authToken = adminLogin.decrypted.authToken;

      const delUserRes = await callEncrypted(adminBoot, "admin/delete-user", {
        userId: user1.user.id,
      });
      assert.equal(delUserRes.statusCode, 200);
      assert.equal(
        runtime.ledgerManager.getUserLedger(user1.user.id).entries.length,
        0
      );
      assert.equal(
        runtime.ledgerManager.getUserLedger(user1.user.id).dailyLimit,
        300
      );
    } finally {
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Spec 0007 Ticket 03 · Slice C: Frontend Encrypted Ledger Client, Per-User Offline Cache & Zero Hardcoded Ledger Placeholders", () => {
  it("mirrors authenticated ledger to yj_ledger_cache_v1_${userId}, executes encrypted mutateServerLedger lifecycle, isolates per-user cache, and caps 200 entries with 0o600 file permissions", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-0007-client-"));

    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      nowFn: () => Date.now(),
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: FALLBACK_MATCHES,
        syncNote: "测试快照",
      }),
    });

    // Install in-memory localStorage & fetch adapter over runtime.gateway
    const memStore = new Map<string, string>();
    const prevStorageDesc = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );
    const prevFetch = globalThis.fetch;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
        setItem: (k: string, v: string) => {
          memStore.set(k, String(v));
        },
        removeItem: (k: string) => {
          memStore.delete(k);
        },
        clear: () => memStore.clear(),
      },
    });

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const urlStr = String(input);
      const u = new URL(urlStr, "http://localhost");
      const hdrs: Record<string, string> = {
        ...REAL_BROWSER_HEADERS,
      };
      if (init?.headers) {
        for (const [k, v] of Object.entries(
          init.headers as Record<string, string>
        )) {
          hdrs[k.toLowerCase()] = String(v);
        }
      }
      const parsedBody =
        typeof init?.body === "string" && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined;
      const ex = makeHttpExchange({
        method: init?.method || "GET",
        url: u.pathname,
        headers: hdrs,
        remoteAddress: "198.51.100.55",
        body: parsedBody,
      });
      await runtime.gateway.handleRequest(ex.req, ex.res, u.pathname);
      const res = ex.getResult();
      return new Response(res.body, {
        status: res.statusCode,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const clientMod =
        (await import("../src/security/secureClient.ts")) as Record<
          string,
          any
        >;
      assert.equal(typeof clientMod.mutateServerLedger, "function");
      assert.equal(typeof clientMod.readCachedUserLedger, "function");
      assert.equal(typeof clientMod.writeCachedUserLedger, "function");

      const u1 = runtime.accountManager.createAccount({
        username: "desk_member",
        password: "Desk#888",
        durationHours: 48,
        maxDevices: 2,
      });
      const u2 = runtime.accountManager.createAccount({
        username: "phone_member",
        password: "Phone#888",
        durationHours: 48,
        maxDevices: 2,
      });

      await clientMod.bootstrapSecureWorkspace(true);
      const bundle1 = await clientMod.loginWithPassword(
        "desk_member",
        "Desk#888"
      );
      assert.ok(bundle1.ledger);
      assert.equal(bundle1.ledger.entries.length, 0);

      // Verify exact localStorage cache key yj_ledger_cache_v1_${userId}
      const cacheKey1 = `yj_ledger_cache_v1_${u1.user.id}`;
      assert.equal(
        memStore.has(cacheKey1),
        true,
        "Must persist ledger cache under yj_ledger_cache_v1_${userId}"
      );

      // Mutate via secureClient.mutateServerLedger -> STOP_LOSS_EXCEEDED -> convert to paper -> settle lost
      const overRes = await clientMod.mutateServerLedger({
        action: "add-entry",
        kind: "live",
        title: "4串1 · 超限测试单",
        modeLabel: "4串1",
        betCount: 1,
        cost: 360,
        minPayout: 1280,
        maxPayout: 1280,
      });
      assert.equal(overRes.ok, false);
      assert.equal(overRes.code, "STOP_LOSS_EXCEEDED");
      assert.equal(overRes.overBy, 60);

      const paperRes = await clientMod.mutateServerLedger({
        action: "add-entry",
        kind: "paper",
        title: "4串1 · 超限转模拟单",
        modeLabel: "4串1",
        betCount: 1,
        cost: 0,
        paperRefCost: 360,
        minPayout: 1280,
        maxPayout: 1280,
      });
      assert.equal(paperRes.ok, true);

      const settleRes = await clientMod.mutateServerLedger({
        action: "settle-entry",
        entryId: paperRes.entry.id,
        status: "lost",
      });
      assert.equal(settleRes.ok, true);
      assert.equal(settleRes.ledger.stats.paperSavedAmount, 360);

      // Offline cache read for u1 returns latest settled snapshot, while u2 cache is null
      const cachedU1 = clientMod.readCachedUserLedger(u1.user.id);
      assert.equal(cachedU1.stats.paperSavedAmount, 360);
      assert.equal(clientMod.readCachedUserLedger(u2.user.id), null);

      // Verify 200-entry max retention cap & 0o600 permissions on ledgers-db.json
      for (let i = 0; i < 205; i++) {
        runtime.ledgerManager.mutateUserLedger(u2.user.id, {
          action: "add-entry",
          kind: "paper",
          title: `模拟单 #${i + 1}`,
          modeLabel: "2串1",
          betCount: 1,
          paperRefCost: 20,
          minPayout: 50,
          maxPayout: 50,
        });
      }
      const u2Snap = runtime.ledgerManager.getUserLedger(u2.user.id);
      assert.equal(u2Snap.entries.length, 200);
      assert.equal(u2Snap.entries[0].title, "模拟单 #205");

      const ledgerDbStat = fs.statSync(path.join(tmpDir, "ledgers-db.json"));
      assert.equal(ledgerDbStat.mode & 0o777, 0o600);

      // Tampered numeric overflow inputs (e.g. 1e400 -> Infinity) must be clamped to finite bounds
      const overflowRes = runtime.ledgerManager.mutateUserLedger(u2.user.id, {
        action: "add-entry",
        kind: "paper",
        title: "极端数值篡改测试",
        modeLabel: "2串1",
        betCount: 1e400,
        paperRefCost: 1e400,
        minPayout: 1e400,
        maxPayout: 1e400,
      });
      assert.equal(overflowRes.ok, true);
      assert.equal(Number.isFinite(overflowRes.entry.paperRefCost), true);
      assert.ok(overflowRes.entry.paperRefCost <= 1_000_000);
      assert.equal(Number.isFinite(overflowRes.entry.minPayout), true);
      assert.ok(overflowRes.entry.minPayout <= 10_000_000);
      assert.equal(Number.isFinite(overflowRes.entry.maxPayout), true);
      assert.ok(overflowRes.entry.maxPayout <= 10_000_000);
      const reparsed = JSON.parse(JSON.stringify(overflowRes.entry));
      assert.equal(reparsed.paperRefCost, 1_000_000);
      assert.equal(reparsed.minPayout, 10_000_000);
      assert.equal(reparsed.maxPayout, 10_000_000);
      assert.equal(reparsed.betCount, 100_000);

      // Verify SkinPhoneApp.tsx has removed hardcoded fake ledger items, static percentages & stale pre-midnight guard
      const skinAppSrc = fs.readFileSync(
        path.resolve(process.cwd(), "src/mobile/SkinPhoneApp.tsx"),
        "utf8"
      );
      assert.equal(
        skinAppSrc.includes("+19.4%"),
        false,
        "Hardcoded +19.4% stat must be removed"
      );
      assert.equal(
        skinAppSrc.includes("-62.0%"),
        false,
        "Hardcoded -62.0% stat must be removed"
      );
      assert.equal(
        skinAppSrc.includes("高危转0成本模拟单"),
        false,
        "Hardcoded fake ledger item l2 must be removed"
      );
      assert.equal(
        skinAppSrc.includes("draft.cost > ledger.dailyRemaining"),
        false,
        "recordToLedger must delegate directly to server mutate endpoint so Beijing 00:00 reset is never short-circuited"
      );
    } finally {
      globalThis.fetch = prevFetch;
      if (prevStorageDesc) {
        Object.defineProperty(globalThis, "localStorage", prevStorageDesc);
      } else {
        delete (globalThis as Record<string, unknown>).localStorage;
      }
      runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
