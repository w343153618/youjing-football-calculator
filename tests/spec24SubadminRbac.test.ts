import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createAccountManager } from "../server/accountManager.mjs";
import { FALLBACK_MATCHES } from "../server/quantEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import {
  ADMIN_HISTORY_MONITOR_TAB_LABEL,
  buildAdminConsoleTabSpecs,
  canAccessAdminConsole,
} from "../src/admin/adminHistoryMonitorViewModel.ts";

const BROWSER_HEADERS: Record<string, string> = {
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
    Object.entries({ ...BROWSER_HEADERS, ...headers }).map(([k, v]) => [
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
      req.emit("data", Buffer.from(JSON.stringify(body), "utf8"));
    }
    req.emit("end");
  });

  return {
    req,
    res,
    read: () => ({
      statusCode,
      headers: outHeaders,
      body: Buffer.concat(chunks).toString("utf8"),
    }),
  };
}

async function bootSession(
  runtime: any,
  nowFn: () => number,
  hwFpHex: string,
  remoteAddress: string
) {
  const bootEx = makeExchange({
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
  return {
    async call(endpoint: string, payloadObj: unknown, authToken?: string) {
      const ts = String(nowFn());
      const nonce = nonceSeq.toString(16).padStart(32, "0");
      nonceSeq += 1;
      const env = encryptEnvelope(aesKey, payloadObj);
      const sig = computeEnvelopeHmacHex(
        hmacKey,
        bootJson.sid,
        endpoint,
        ts,
        nonce,
        env.iv,
        env.d
      );
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-yj-sid": bootJson.sid,
        "x-yj-ts": ts,
        "x-yj-nonce": nonce,
        "x-yj-sig": sig,
        "x-yj-hw": hwFpHex,
      };
      if (authToken) headers["x-yj-auth"] = authToken;
      const ex = makeExchange({
        method: "POST",
        url: `/api/${endpoint}`,
        headers,
        body: env,
        remoteAddress,
      });
      await runtime.gateway.handleRequest(ex.req, ex.res, `/api/${endpoint}`);
      const snap = ex.read();
      const json = JSON.parse(snap.body);
      return {
        statusCode: snap.statusCode,
        json,
        decrypt: () =>
          json?.payload
            ? decryptEnvelope(aesKey, json.payload.iv, json.payload.d)
            : null,
      };
    },
  };
}

describe("Spec #24 · Ticket #25: Scoped Sub-Admin RBAC & Owner Isolation", () => {
  it("Seam 1 (createAccountManager): superadmin promotes/demotes subadmin without token revocation, enforces createdBy isolation, quota caps <=5 / <=100, self-action limits, and QA violation protection", () => {
    let clock = 1_760_000_000_000;
    const am = createAccountManager({
      nowFn: () => clock,
      initAdminUser: "wyw",
      initAdminPass: "SuperPass#2026",
    });

    const superLogin = am.authenticateLogin({
      username: "wyw",
      password: "SuperPass#2026",
      hwFp: "a".repeat(32),
      ip: "198.51.100.10",
    });
    assert.equal(superLogin.ok, true);
    const superActor = superLogin.user;
    assert.equal(superActor.role, "superadmin");

    // Create two subadmin candidates and an unowned member as superadmin
    const liuCreated = am.createAccount(
      {
        username: "liufeng",
        password: "LiuPass#123",
        note: "协管刘峰",
        durationHours: null,
        maxDevices: 5,
        aiEnabled: true,
        dailyAiLimit: 100,
      },
      superActor
    );
    assert.equal(liuCreated.user.role, "member");
    assert.deepEqual(liuCreated.user.createdBy, {
      id: superActor.id,
      username: "wyw",
    });

    const otherSubCreated = am.createAccount(
      {
        username: "othersub",
        password: "OtherSub#123",
        durationHours: null,
        maxDevices: 3,
        dailyAiLimit: 50,
      },
      superActor
    );
    const superOwnedMember = am.createAccount(
      {
        username: "boss_vip",
        password: "BossVip#123",
        durationHours: 24,
        maxDevices: 2,
        dailyAiLimit: 20,
      },
      superActor
    );

    // Subadmin candidate logs in BEFORE promotion
    const liuLogin = am.authenticateLogin({
      username: "liufeng",
      password: "LiuPass#123",
      hwFp: "b".repeat(32),
      ip: "198.51.100.20",
    });
    assert.equal(liuLogin.ok, true);
    assert.equal(liuLogin.user.role, "member");

    // 1. Superadmin promotes liufeng to subadmin WITHOUT invalidating existing auth token
    const promoted = am.updateAccount(
      liuCreated.user.id,
      { action: "set-role", role: "subadmin" },
      superActor
    );
    assert.equal(promoted.user.role, "subadmin");

    const verifiedAfterPromote = am.verifyAuthTokenDetailed(
      liuLogin.authToken,
      "b".repeat(32),
      "198.51.100.20"
    );
    assert.equal(verifiedAfterPromote.ok, true);
    assert.equal(verifiedAfterPromote.user.role, "subadmin");

    const subActor = verifiedAfterPromote.user;

    // Promote second subadmin for cross-subadmin isolation tests
    const otherSubPromoted = am.updateAccount(
      otherSubCreated.user.id,
      { action: "set-role", role: "subadmin" },
      superActor
    );
    const otherSubActor = otherSubPromoted.user;

    // Cannot promote anyone to superadmin or demote superadmin
    assert.throws(
      () =>
        am.updateAccount(
          superOwnedMember.user.id,
          { action: "set-role", role: "superadmin" },
          superActor
        ),
      /超级管理员/
    );
    assert.throws(
      () =>
        am.updateAccount(
          superActor.id,
          { action: "set-role", role: "member" },
          superActor
        ),
      /超级管理员/
    );

    // 2. Subadmin creates member -> stamps createdBy, forces role: member, enforces maxDevices <= 5 & dailyAiLimit <= 100
    assert.throws(
      () =>
        am.createAccount(
          {
            username: "bad_sub_1",
            password: "Pass1234",
            role: "subadmin",
            durationHours: 24,
            maxDevices: 2,
            dailyAiLimit: 20,
          },
          subActor
        ),
      /无权|普通成员/
    );
    assert.throws(
      () =>
        am.createAccount(
          {
            username: "bad_sub_2",
            password: "Pass1234",
            role: "superadmin",
            durationHours: 24,
            maxDevices: 2,
            dailyAiLimit: 20,
          },
          subActor
        ),
      /无权|普通成员/
    );
    assert.throws(
      () =>
        am.createAccount(
          {
            username: "too_many_dev",
            password: "Pass1234",
            durationHours: 24,
            maxDevices: 6,
            dailyAiLimit: 20,
          },
          subActor
        ),
      /5/
    );
    assert.throws(
      () =>
        am.createAccount(
          {
            username: "too_many_ai",
            password: "Pass1234",
            durationHours: 24,
            maxDevices: 2,
            dailyAiLimit: 101,
          },
          subActor
        ),
      /100/
    );

    const subOwned = am.createAccount(
      {
        username: "liu_client_1",
        password: "Client1#Pass",
        note: "刘峰客户1",
        durationHours: 72,
        maxDevices: 5,
        aiEnabled: true,
        dailyAiLimit: 100,
      },
      subActor
    );
    assert.equal(subOwned.user.role, "member");
    assert.deepEqual(subOwned.user.createdBy, {
      id: subActor.id,
      username: "liufeng",
    });

    const otherSubOwned = am.createAccount(
      {
        username: "other_client_1",
        password: "Client2#Pass",
        durationHours: 24,
        maxDevices: 2,
        dailyAiLimit: 20,
      },
      otherSubActor
    );

    // 3. listAccounts(subActor) returns ONLY [subadminSelf, ...ownedMembers]
    const subVisible = am.listAccounts(subActor);
    assert.deepEqual(
      subVisible.map((u: any) => u.username),
      ["liufeng", "liu_client_1"]
    );
    assert.equal(
      subVisible.some((u: any) => u.role === "superadmin"),
      false
    );

    // Backward compatibility: listAccounts() with actor === undefined returns all accounts
    const legacyAll = am.listAccounts();
    assert.ok(legacyAll.length >= 6);

    // 4. Subadmin attempting updateAccount or deleteAccount on superadmin, unowned member, or another subadmin throws /^无权/ and leaves target untouched
    for (const forbiddenTarget of [
      superActor.id,
      superOwnedMember.user.id,
      otherSubActor.id,
      otherSubOwned.user.id,
    ]) {
      assert.throws(
        () =>
          am.updateAccount(
            forbiddenTarget,
            { action: "reset-password", newPassword: "Hacked#999" },
            subActor
          ),
        /^Error: 无权|^无权/
      );
      assert.throws(
        () => am.deleteAccount(forbiddenTarget, subActor),
        /^Error: 无权|^无权/
      );
    }
    // Confirm superadmin password was NOT altered
    const superStillValid = am.authenticateLogin({
      username: "wyw",
      password: "SuperPass#2026",
      hwFp: "a".repeat(32),
      ip: "198.51.100.10",
    });
    assert.equal(superStillValid.ok, true);

    // 5. Subadmin updating own account allows ONLY reset-password and clear-devices, rejects others & self-deletion
    for (const forbiddenSelfAct of [
      { action: "update-perms", maxDevices: 99 },
      { action: "add-hours", hours: 24 },
      { action: "set-permanent" },
      { action: "set-duration-hours", hours: 72 },
      { action: "toggle-status" },
      { action: "unlock-login" },
      { action: "set-role", role: "superadmin" },
    ]) {
      assert.throws(
        () => am.updateAccount(subActor.id, forbiddenSelfAct, subActor),
        /无权/
      );
    }
    assert.throws(() => am.deleteAccount(subActor.id, subActor), /无权/);

    const selfReset = am.updateAccount(
      subActor.id,
      { action: "reset-password", newPassword: "LiuNewPass#456" },
      subActor
    );
    assert.ok(selfReset.freshAuthToken);
    const selfClearDev = am.updateAccount(
      subActor.id,
      { action: "clear-devices" },
      subActor
    );
    assert.equal(selfClearDev.user.boundDevicesCount, 0);

    // 6. Subadmin updating owned member rejects set-role and rejects maxDevices > 5 or dailyAiLimit > 100
    assert.throws(
      () =>
        am.updateAccount(
          subOwned.user.id,
          { action: "set-role", role: "subadmin" },
          subActor
        ),
      /无权/
    );
    assert.throws(
      () =>
        am.updateAccount(
          subOwned.user.id,
          { action: "update-perms", maxDevices: 6 },
          subActor
        ),
      /5/
    );
    assert.throws(
      () =>
        am.updateAccount(
          subOwned.user.id,
          { action: "update-perms", dailyAiLimit: 101 },
          subActor
        ),
      /100/
    );

    const updatedOwned = am.updateAccount(
      subOwned.user.id,
      { action: "update-perms", maxDevices: 4, dailyAiLimit: 80 },
      subActor
    );
    assert.equal(updatedOwned.user.maxDevices, 4);
    assert.equal(updatedOwned.user.dailyAiLimit, 80);

    // 7. recordQaViolation does not auto-lock subadmin (same protection as superadmin) while still recording audit log
    for (let i = 1; i <= 6; i++) {
      const qaRes = am.recordQaViolation(
        subActor.id,
        `探底测试 #${i}`,
        "SCOPE",
        "198.51.100.20"
      );
      assert.equal(qaRes.locked, false);
    }
    const subAfterQa = am.listAccounts().find((u: any) => u.id === subActor.id);
    assert.equal(subAfterQa.status, "active");
    assert.ok(
      am
        .listAuditLogs()
        .some(
          (l: any) =>
            l.username === "liufeng" && l.detail.includes("探底测试 #6")
        )
    );

    // 8. Superadmin can demote subadmin back to member without invalidating existing token
    const reLoginSub = am.authenticateLogin({
      username: "liufeng",
      password: "LiuNewPass#456",
      hwFp: "b".repeat(32),
      ip: "198.51.100.20",
    });
    assert.equal(reLoginSub.ok, true);
    const demoted = am.updateAccount(
      subActor.id,
      { action: "set-role", role: "member" },
      superActor
    );
    assert.equal(demoted.user.role, "member");
    const verifiedAfterDemote = am.verifyAuthTokenDetailed(
      reLoginSub.authToken,
      "b".repeat(32),
      "198.51.100.20"
    );
    assert.equal(verifiedAfterDemote.ok, true);
    assert.equal(verifiedAfterDemote.user.role, "member");
  });

  it("Seam 2 (createYouJingRuntime encrypted /api/admin/*): member gets 403, subadmin gets scoped overview with redacted logs/monitors and succeeds on owned members while 403-blocked on usr_superadmin", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-spec24-s2-"));
    const clock = 1_760_100_000_000;
    const runtime = createYouJingRuntime({
      dataDir: tmpDir,
      nowFn: () => clock,
      enableHistoryCollector: false,
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: FALLBACK_MATCHES,
        syncNote: "测试固定快照",
      }),
    });

    try {
      const credsText = fs.readFileSync(
        path.join(tmpDir, "admin-credentials.txt"),
        "utf8"
      );
      const superUser = credsText.match(/ADMIN_USER=(\S+)/)?.[1] || "yjadmin";
      const superPass = credsText.match(/ADMIN_INITIAL_PASSWORD=(\S+)/)?.[1]!;

      const superSess = await bootSession(
        runtime,
        () => clock,
        "1".repeat(64),
        "198.51.100.10"
      );
      const superLogin = await superSess.call("auth/login", {
        username: superUser,
        password: superPass,
        hwFp: "1".repeat(64),
      });
      assert.equal(superLogin.statusCode, 200);
      const superTok = superLogin.decrypt().authToken as string;

      // Create ordinary member and subadmin candidate
      const memCreate = await superSess.call(
        "admin/create-user",
        {
          username: "plain_member",
          password: "Member#123",
          durationHours: 24,
          maxDevices: 2,
          aiEnabled: true,
          dailyAiLimit: 10,
        },
        superTok
      );
      assert.equal(memCreate.statusCode, 200);

      const subCreate = await superSess.call(
        "admin/create-user",
        {
          username: "liufeng",
          password: "LiuPass#123",
          durationHours: null,
          maxDevices: 5,
          aiEnabled: true,
          dailyAiLimit: 100,
        },
        superTok
      );
      assert.equal(subCreate.statusCode, 200);
      const subId = subCreate.decrypt().user.id as string;

      const promoteRes = await superSess.call(
        "admin/update-user",
        { userId: subId, action: "set-role", role: "subadmin" },
        superTok
      );
      assert.equal(promoteRes.statusCode, 200);
      assert.equal(promoteRes.decrypt().user.role, "subadmin");

      // 1. Member gets HTTP 403 on /api/admin/overview and /api/admin/create-user
      const memSess = await bootSession(
        runtime,
        () => clock,
        "2".repeat(64),
        "198.51.100.20"
      );
      const memLogin = await memSess.call("auth/login", {
        username: "plain_member",
        password: "Member#123",
        hwFp: "2".repeat(64),
      });
      assert.equal(memLogin.statusCode, 200);
      const memTok = memLogin.decrypt().authToken as string;

      const memOv = await memSess.call("admin/overview", {}, memTok);
      assert.equal(memOv.statusCode, 403);
      const memCreateTry = await memSess.call(
        "admin/create-user",
        {
          username: "sneaky_acc",
          password: "Pass1234",
          durationHours: 24,
          maxDevices: 2,
          aiEnabled: true,
          dailyAiLimit: 10,
        },
        memTok
      );
      assert.equal(memCreateTry.statusCode, 403);

      // 2. Subadmin logs in and creates/updates/deletes an owned member
      const subSess = await bootSession(
        runtime,
        () => clock,
        "3".repeat(64),
        "198.51.100.30"
      );
      const subLogin = await subSess.call("auth/login", {
        username: "liufeng",
        password: "LiuPass#123",
        hwFp: "3".repeat(64),
      });
      assert.equal(subLogin.statusCode, 200);
      assert.equal(subLogin.decrypt().user.role, "subadmin");
      const subTok = subLogin.decrypt().authToken as string;

      const subCreateOwned = await subSess.call(
        "admin/create-user",
        {
          username: "liu_vip_01",
          password: "Vip01#Pass",
          note: "子管名下客户",
          durationHours: 48,
          maxDevices: 3,
          aiEnabled: true,
          dailyAiLimit: 50,
        },
        subTok
      );
      assert.equal(subCreateOwned.statusCode, 200);
      const ownedId = subCreateOwned.decrypt().user.id as string;

      // Subadmin overview is scoped & redacted
      const subOv = await subSess.call("admin/overview", {}, subTok);
      assert.equal(subOv.statusCode, 200);
      const ov = subOv.decrypt();
      assert.deepEqual(
        ov.accounts.map((a: any) => a.username),
        ["liufeng", "liu_vip_01"]
      );
      assert.deepEqual(ov.auditLogs, []);
      assert.equal(ov.fusedIpsCount, 0);
      assert.equal(ov.fusedHwCount, 0);
      assert.equal(ov.historyMonitor, undefined);
      assert.equal(ov.scraperMonitor, undefined);

      // Subadmin updates owned member
      const subUpdOwned = await subSess.call(
        "admin/update-user",
        {
          userId: ownedId,
          action: "update-perms",
          maxDevices: 5,
          dailyAiLimit: 100,
        },
        subTok
      );
      assert.equal(subUpdOwned.statusCode, 200);
      assert.equal(subUpdOwned.decrypt().user.maxDevices, 5);
      assert.equal(subUpdOwned.decrypt().user.dailyAiLimit, 100);

      // Subadmin attempting to tamper with usr_superadmin gets 403 with 无权 error and leaves superadmin untouched
      const tamperPass = await subSess.call(
        "admin/update-user",
        {
          userId: "usr_superadmin",
          action: "reset-password",
          newPassword: "Pwned#999",
        },
        subTok
      );
      assert.equal(tamperPass.statusCode, 403);
      assert.match(tamperPass.json.error, /^无权/);

      const tamperDel = await subSess.call(
        "admin/delete-user",
        { userId: "usr_superadmin" },
        subTok
      );
      assert.equal(tamperDel.statusCode, 403);
      assert.match(tamperDel.json.error, /^无权/);

      // Verify superadmin login still works with original password & active status
      const verifySuper = await superSess.call("auth/login", {
        username: superUser,
        password: superPass,
        hwFp: "1".repeat(64),
      });
      assert.equal(verifySuper.statusCode, 200);
      assert.equal(verifySuper.decrypt().user.status, "active");

      // Subadmin deletes owned member successfully
      const subDelOwned = await subSess.call(
        "admin/delete-user",
        { userId: ownedId },
        subTok
      );
      assert.equal(subDelOwned.statusCode, 200);
      assert.equal(subDelOwned.decrypt().ok, true);
    } finally {
      await runtime.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Seam 3 (canAccessAdminConsole & buildAdminConsoleTabSpecs): allows superadmin and subadmin, denies member/null, and trims tabs to users-only for subadmin", () => {
    assert.equal(canAccessAdminConsole({ role: "superadmin" }), true);
    assert.equal(canAccessAdminConsole({ role: "subadmin" }), true);
    assert.equal(canAccessAdminConsole({ role: "member" }), false);
    assert.equal(canAccessAdminConsole(null), false);
    assert.equal(canAccessAdminConsole(undefined), false);

    assert.deepEqual(buildAdminConsoleTabSpecs(6, 12), [
      ["users", "👥 账号与权限总控 (6)"],
      ["audit", "🛡️ 风控与违规提问日志 (12)"],
      ["history", ADMIN_HISTORY_MONITOR_TAB_LABEL],
    ]);
    assert.deepEqual(buildAdminConsoleTabSpecs(3, 0, "subadmin"), [
      ["users", "👥 账号与权限总控 (3)"],
    ]);
  });
});
