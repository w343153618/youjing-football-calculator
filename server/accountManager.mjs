import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(crypto.scryptSync(String(password), salt, 64).toString('hex'), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function beijingDateStr(nowMs) {
  const d = new Date(nowMs + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function generateReadablePassword(len = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * 独立会员授权、设备指纹限绑、首次登录激活倒计时、AI 配额与违规封号总控引擎
 */
export function createAccountManager(opts = {}) {
  const accountsFile = opts.accountsFile || null;
  const adminCredsFile = opts.adminCredsFile || null;
  const nowFn = opts.nowFn || (() => Date.now());
  const violationWindowMs = opts.violationWindowMs ?? 2 * 3600_000; // 2 hours sliding window
  const maxAllowedWarnings = opts.maxAllowedWarnings ?? 4; // > 4 (i.e. 5th violation) locks account!
  const ipBruteMap = new Map(); // ip -> { fails, lockedUntil }

  function calcProgressiveLockMs(failCount) {
    // Apple ID / Router progressive exponential cooldown
    if (failCount < 5) return 0;
    if (failCount === 5) return 60_000; // 1 minute
    if (failCount === 6) return 5 * 60_000; // 5 minutes
    if (failCount === 7) return 15 * 60_000; // 15 minutes
    if (failCount === 8) return 60 * 60_000; // 1 hour
    return 24 * 60 * 60_000; // 24 hours
  }

  function formatLockWait(remMs) {
    const sec = Math.max(1, Math.ceil(remMs / 1000));
    if (sec < 60) return `${sec} 秒`;
    const mins = Math.ceil(sec / 60);
    if (mins < 60) return `${mins} 分钟`;
    const hrs = Math.floor(mins / 60);
    const remM = mins % 60;
    return remM > 0 ? `${hrs} 小时 ${remM} 分钟` : `${hrs} 小时`;
  }

  let db = {
    tokenSecret: crypto.randomBytes(32).toString('hex'),
    accounts: [],
    auditLogs: [],
  };

  if (accountsFile && fs.existsSync(accountsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      if (parsed && Array.isArray(parsed.accounts)) {
        db = {
          tokenSecret: parsed.tokenSecret || db.tokenSecret,
          accounts: parsed.accounts,
          auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        };
      }
    } catch {
      // ignore corrupted file
    }
  }

  let saveTimer = null;
  let persistSeq = 0;

  function persistNowSync() {
    persistSeq += 1;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!accountsFile) return;
    try {
      fs.mkdirSync(path.dirname(accountsFile), { recursive: true });
      const tmp = `${accountsFile}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, accountsFile);
    } catch {
      // ignore
    }
  }

  function schedulePersist() {
    if (!accountsFile || saveTimer) return;
    const mySeq = ++persistSeq;
    saveTimer = setTimeout(async () => {
      try {
        if (mySeq !== persistSeq) return;
        await fsp.mkdir(path.dirname(accountsFile), { recursive: true });
        if (mySeq !== persistSeq) return;
        const tmp = `${accountsFile}.tmp.${process.pid}.${Date.now()}`;
        await fsp.writeFile(tmp, JSON.stringify(db, null, 2), { encoding: 'utf8', mode: 0o600 });
        if (mySeq !== persistSeq) {
          await fsp.unlink(tmp).catch(() => {});
          return;
        }
        await fsp.rename(tmp, accountsFile);
      } catch {
        // ignore
      } finally {
        saveTimer = null;
      }
    }, 80);
    saveTimer.unref?.();
  }

  // Seed Super-Admin on first boot if none exists
  if (!db.accounts.some((a) => a.role === 'superadmin')) {
    const initAdminUser = String(opts.initAdminUser || process.env.YJ_ADMIN_USER || 'yjadmin')
      .trim()
      .toLowerCase();
    const initAdminPass =
      String(opts.initAdminPass || process.env.YJ_ADMIN_PASS || '').trim() ||
      `YJ@${generateReadablePassword(10)}`;
    const { salt, hash } = hashPassword(initAdminPass);
    db.accounts.push({
      id: 'usr_superadmin',
      username: initAdminUser,
      note: '超级管理员（总控台）',
      role: 'superadmin',
      passwordSalt: salt,
      passwordHash: hash,
      status: 'active',
      lockedReason: null,
      createdAt: nowFn(),
      durationHours: null,
      firstLoginAt: nowFn(),
      expiresAt: null,
      maxDevices: 99,
      boundDevices: [],
      aiEnabled: true,
      dailyAiLimit: 9999,
      aiUsageDate: beijingDateStr(nowFn()),
      aiUsedToday: 0,
      violationStrikes: [],
    });
    persistNowSync();
    if (adminCredsFile) {
      try {
        fs.mkdirSync(path.dirname(adminCredsFile), { recursive: true });
        fs.writeFileSync(
          adminCredsFile,
          `ADMIN_USER=${initAdminUser}\nADMIN_INITIAL_PASSWORD=${initAdminPass}\nCREATED_AT=${new Date(
            nowFn()
          ).toISOString()}\n`,
          { encoding: 'utf8', mode: 0o600 }
        );
      } catch {
        // ignore
      }
    }
  }

  function recordAuditEvent(event) {
    db.auditLogs.unshift({
      id: `log_${nowFn()}_${crypto.randomBytes(3).toString('hex')}`,
      ts: nowFn(),
      ...event,
    });
    if (db.auditLogs.length > 400) {
      db.auditLogs.length = 400;
    }
    schedulePersist();
  }

  function signAuthToken(userId, tokenVersion = 1) {
    const issuedAt = nowFn();
    const payload = `${userId}.${tokenVersion}.${issuedAt}`;
    const sig = crypto
      .createHmac('sha256', db.tokenSecret)
      .update(payload)
      .digest('hex');
    return `${payload}.${sig}`;
  }

  function refreshDailyCounter(acc) {
    const today = beijingDateStr(nowFn());
    if (acc.aiUsageDate !== today) {
      acc.aiUsageDate = today;
      acc.aiUsedToday = 0;
    }
  }

  function toPublicUser(acc) {
    refreshDailyCounter(acc);
    const now = nowFn();
    const isExpired = acc.expiresAt !== null && now >= acc.expiresAt;
    return {
      id: acc.id,
      username: acc.username,
      note: acc.note || '',
      role: acc.role,
      status: isExpired && acc.status === 'active' ? 'expired' : acc.status,
      lockedReason: acc.lockedReason || null,
      createdAt: acc.createdAt,
      durationHours: acc.durationHours,
      firstLoginAt: acc.firstLoginAt,
      expiresAt: acc.expiresAt,
      remainingMs:
        acc.expiresAt !== null
          ? Math.max(0, acc.expiresAt - now)
          : acc.durationHours !== null && acc.firstLoginAt === null
            ? acc.durationHours * 3600_000
            : null,
      maxDevices: acc.maxDevices,
      boundDevicesCount: acc.boundDevices.length,
      boundDevices: acc.boundDevices,
      aiEnabled: Boolean(acc.aiEnabled),
      dailyAiLimit: acc.dailyAiLimit,
      aiUsedToday: acc.aiUsedToday,
      violationCount: (acc.violationStrikes || []).length,
      failedLoginCount: acc.failedLoginCount || 0,
      loginLockedUntil: acc.loginLockedUntil && acc.loginLockedUntil > now ? acc.loginLockedUntil : null,
    };
  }

  function checkAndBindDevice(acc, hwFp, deviceLabel, ip) {
    if (acc.role === 'superadmin' || acc.maxDevices >= 99) return { ok: true };
    const resolvedFp = String(hwFp || `fb_${ip || 'unknown'}`).trim().toLowerCase();
    const now = nowFn();
    const existing = acc.boundDevices.find((d) => d.hwFp === resolvedFp);
    if (existing) {
      existing.lastSeenAt = now;
      existing.lastIp = ip || existing.lastIp;
      return { ok: true };
    }
    if (acc.boundDevices.length >= acc.maxDevices) {
      recordAuditEvent({
        type: 'DEVICE_LIMIT_BLOCKED',
        username: acc.username,
        note: acc.note,
        ip,
        detail: `账号已绑满 ${acc.maxDevices} 台设备，拦截新设备登录请求`,
      });
      return {
        ok: false,
        error: `该账号最多允许绑定 ${acc.maxDevices} 台常用设备，当前已满额（防多人转发共用）。如需换机请联系管理员一键解绑。`,
      };
    }
    acc.boundDevices.push({
      hwFp: resolvedFp,
      label: String(deviceLabel || '终端设备').slice(0, 40),
      boundAt: now,
      lastSeenAt: now,
      lastIp: ip || '',
    });
    schedulePersist();
    return { ok: true };
  }

  function authenticateLogin({ username, password, hwFp, deviceLabel, ip }) {
    const now = nowFn();
    const cleanUser = String(username || '').trim().toLowerCase();

    // 1. Check per-IP brute-force cooldown (stops username spraying)
    if (ip) {
      const ipRec = ipBruteMap.get(ip);
      if (ipRec && ipRec.lockedUntil > now) {
        const remMs = ipRec.lockedUntil - now;
        return {
          ok: false,
          statusCode: 429,
          lockedRemainingSec: Math.ceil(remMs / 1000),
          error: `密码连续输错次数过多，当前网络已进入安全冷却保护，请 ${formatLockWait(remMs)} 后再试`,
        };
      }
    }

    const acc = db.accounts.find((a) => a.username === cleanUser);

    // 2. Check per-account progressive lockout
    if (acc && acc.loginLockedUntil && acc.loginLockedUntil > now) {
      const remMs = acc.loginLockedUntil - now;
      return {
        ok: false,
        statusCode: 429,
        lockedRemainingSec: Math.ceil(remMs / 1000),
        error: `该账号因密码连续输错已临时锁定，请等待 ${formatLockWait(remMs)} 后再试（或联系管理员解除冷却）`,
      };
    }

    // 3. Verify password; on failure, increment Apple ID-style progressive lock!
    if (!acc || !verifyPassword(password, acc.passwordSalt, acc.passwordHash)) {
      let lockWaitMs = 0;
      let nextFailCount = 1;

      if (ip) {
        const prevIp = ipBruteMap.get(ip) || { fails: 0, lockedUntil: 0 };
        const ipFails = prevIp.fails + 1;
        // Per-account locks on 5th wrong try; shared-IP multi-account spray locks on 7th+ wrong try
        const ipLock = calcProgressiveLockMs(Math.max(0, ipFails - 2));
        ipBruteMap.set(ip, { fails: ipFails, lockedUntil: ipLock > 0 ? now + ipLock : 0 });
        if (ipBruteMap.size > 5000) {
          ipBruteMap.delete(ipBruteMap.keys().next().value);
        }
      }

      if (acc) {
        acc.failedLoginCount = (acc.failedLoginCount || 0) + 1;
        nextFailCount = acc.failedLoginCount;
        lockWaitMs = calcProgressiveLockMs(nextFailCount);
        if (lockWaitMs > 0) {
          acc.loginLockedUntil = now + lockWaitMs;
          recordAuditEvent({
            type: 'BRUTEFORCE_COOLDOWN',
            username: acc.username,
            note: acc.note,
            ip: ip || '',
            detail: `密码连续输错第 ${nextFailCount} 次，触发阶梯冷却锁定 ${formatLockWait(lockWaitMs)}`,
          });
        }
        schedulePersist();
      }

      if (lockWaitMs > 0) {
        return {
          ok: false,
          statusCode: 429,
          lockedRemainingSec: Math.ceil(lockWaitMs / 1000),
          error: `密码已连续输错 ${nextFailCount} 次，账号进入安全保护冷却，请 ${formatLockWait(lockWaitMs)} 后重试`,
        };
      }

      const leftBeforeLock = Math.max(1, 5 - nextFailCount);
      return {
        ok: false,
        statusCode: 401,
        error: acc
          ? `密码不正确（再连续输错 ${leftBeforeLock} 次将触发安全冷却锁定）`
          : '账号或密码不正确',
      };
    }

    // Password matched! Reset account brute-force counter
    acc.failedLoginCount = 0;
    acc.loginLockedUntil = 0;

    if (acc.status === 'locked_violation') {
      return {
        ok: false,
        statusCode: 403,
        error: `该账号因违规刺探或超纲操作已被系统自动锁死（${acc.lockedReason || '安全风控'}）`,
      };
    }
    if (acc.status !== 'active') {
      return { ok: false, statusCode: 403, error: '该账号已被管理员停用，请联系管理员开启' };
    }

    // Activate countdown timer ONLY on very first successful login!
    if (acc.firstLoginAt === null && acc.durationHours !== null) {
      acc.firstLoginAt = now;
      acc.expiresAt = now + acc.durationHours * 3600_000;
    }

    if (acc.expiresAt !== null && now >= acc.expiresAt) {
      return { ok: false, statusCode: 403, error: '该账号授权使用时长已到期，请联系管理员续期' };
    }

    const devCheck = checkAndBindDevice(acc, hwFp, deviceLabel, ip);
    if (!devCheck.ok) {
      return { ok: false, statusCode: 403, error: devCheck.error };
    }

    if (ip) ipBruteMap.delete(ip);

    acc.lastLoginAt = now;
    acc.lastLoginIp = ip || '';
    schedulePersist();

    const authToken = signAuthToken(acc.id, acc.tokenVersion || 1);
    return {
      ok: true,
      user: toPublicUser(acc),
      authToken,
    };
  }

  function verifyAuthTokenDetailed(rawToken, hwFp, ip) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { ok: false, code: 'AUTH_MISSING', error: '请先登录内部授权账号' };
    }
    const parts = rawToken.split('.');
    if (parts.length !== 4) {
      return { ok: false, code: 'AUTH_REVOKED', error: '登录凭证格式无效，请重新登录' };
    }
    const [userId, verStr, issuedStr, sigHex] = parts;
    const payload = `${userId}.${verStr}.${issuedStr}`;
    const expectedSig = crypto
      .createHmac('sha256', db.tokenSecret)
      .update(payload)
      .digest('hex');

    if (!/^[0-9a-f]{64}$/i.test(sigHex)) {
      return { ok: false, code: 'AUTH_REVOKED', error: '登录凭证校验失败' };
    }
    const sigBuf = Buffer.from(sigHex, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== 32 || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { ok: false, code: 'AUTH_REVOKED', error: '登录凭证已失效，请重新登录' };
    }

    const acc = db.accounts.find((a) => a.id === userId);
    if (!acc) {
      return { ok: false, code: 'AUTH_REVOKED', error: '该账号已不存在' };
    }
    if (Number(verStr) !== (acc.tokenVersion || 1)) {
      return { ok: false, code: 'AUTH_REVOKED', error: '账号权限或密码已变更，请重新登录' };
    }
    if (acc.status === 'locked_violation') {
      return {
        ok: false,
        code: 'ACCOUNT_LOCKED',
        error: `账号因违规已被锁死（${acc.lockedReason || '安全风控'}）`,
      };
    }
    if (acc.status !== 'active') {
      return { ok: false, code: 'ACCOUNT_DISABLED', error: '该账号已被管理员停用' };
    }

    const now = nowFn();
    if (acc.expiresAt !== null && now >= acc.expiresAt) {
      return { ok: false, code: 'ACCOUNT_EXPIRED', error: '该账号授权时长已到期，请联系管理员续期' };
    }

    if (acc.role !== 'superadmin' && acc.maxDevices < 99) {
      const resolvedFp = String(hwFp || `fb_${ip || 'unknown'}`).trim().toLowerCase();
      const bound = acc.boundDevices.find((d) => d.hwFp === resolvedFp);
      if (!bound) {
        if (acc.boundDevices.length >= acc.maxDevices) {
          return {
            ok: false,
            code: 'DEVICE_LIMIT',
            error: `该账号已绑满 ${acc.maxDevices} 台常用设备，禁止多人共用`,
          };
        }
        acc.boundDevices.push({
          hwFp: resolvedFp,
          label: '已登录终端',
          boundAt: now,
          lastSeenAt: now,
          lastIp: ip || '',
        });
        schedulePersist();
      } else {
        bound.lastSeenAt = now;
      }
    }

    return { ok: true, user: toPublicUser(acc) };
  }

  function verifyAuthToken(rawToken, hwFp, ip) {
    const r = verifyAuthTokenDetailed(rawToken, hwFp, ip);
    return r.ok ? r.user : null;
  }

  function consumeAiQuota(userId) {
    const acc = db.accounts.find((a) => a.id === userId);
    if (!acc || acc.status !== 'active') {
      return { ok: false, statusCode: 403, error: '账号未授权或已停用' };
    }
    if (!acc.aiEnabled) {
      return {
        ok: false,
        statusCode: 403,
        error: '当前账号未开通「扫地僧小高诊盘 / 智能问答」权限，如需开通请联系管理员',
      };
    }
    refreshDailyCounter(acc);
    if (acc.aiUsedToday >= acc.dailyAiLimit) {
      return {
        ok: false,
        statusCode: 429,
        error: `今日智能诊盘/问答次数已达上限（${acc.dailyAiLimit}/${acc.dailyAiLimit} 次），明日 00:00 自动重置或联系管理员提额`,
      };
    }
    acc.aiUsedToday += 1;
    schedulePersist();
    return {
      ok: true,
      remaining: Math.max(0, acc.dailyAiLimit - acc.aiUsedToday),
    };
  }

  function recordQaViolation(userId, question, reason, ip) {
    const acc = db.accounts.find((a) => a.id === userId);
    const now = nowFn();
    const cleanQ = String(question || '').slice(0, 240);

    if (!acc) {
      recordAuditEvent({
        type: 'QA_VIOLATION',
        username: 'unknown',
        note: '',
        ip,
        detail: `[${reason}] 提问内容：「${cleanQ}」`,
      });
      return { locked: false, strikeCount: 1, maxAllowed: maxAllowedWarnings };
    }

    acc.violationStrikes = (acc.violationStrikes || []).filter(
      (s) => now - s.ts <= violationWindowMs
    );
    acc.violationStrikes.push({ ts: now, question: cleanQ, reason, ip: ip || '' });
    const strikeCount = acc.violationStrikes.length;

    // Superadmin never locks itself out accidentally during testing, though audit logs still record
    if (acc.role !== 'superadmin' && strikeCount > maxAllowedWarnings) {
      acc.status = 'locked_violation';
      acc.lockedReason = `连续超纲/探底提问 ${strikeCount} 次（超过 ${maxAllowedWarnings} 次红线）自动锁死`;
      acc.tokenVersion = (acc.tokenVersion || 1) + 1;
      recordAuditEvent({
        type: 'ACCOUNT_AUTO_LOCKED',
        username: acc.username,
        note: acc.note,
        ip,
        detail: `🚨 触发 >${maxAllowedWarnings} 次探底自动封号！最近第 ${strikeCount} 次提问：「${cleanQ}」`,
      });
      persistNowSync();
      return { locked: true, strikeCount, maxAllowed: maxAllowedWarnings };
    }

    recordAuditEvent({
      type: 'QA_VIOLATION',
      username: acc.username,
      note: acc.note,
      ip,
      detail: `警告 (${strikeCount}/${maxAllowedWarnings}) [${reason}] 提问：「${cleanQ}」`,
    });
    schedulePersist();
    return { locked: false, strikeCount, maxAllowed: maxAllowedWarnings };
  }

  /* ---------- Admin Management Operations ---------- */
  function listAccounts() {
    return db.accounts.map(toPublicUser);
  }

  function createAccount(params) {
    const cleanUser = String(params.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(cleanUser)) {
      throw new Error('账号名需为 3~32 位字母、数字、下划线或横线');
    }
    if (db.accounts.some((a) => a.username === cleanUser)) {
      throw new Error(`账号「${cleanUser}」已存在`);
    }
    const rawPass = String(params.password || '').trim() || generateReadablePassword(8);
    if (rawPass.length < 4) {
      throw new Error('密码长度至少 4 位');
    }

    const durationHours =
      params.durationHours === null || params.durationHours === undefined || params.durationHours === ''
        ? null
        : Math.max(0.5, Number(params.durationHours));
    const maxDevices = Math.max(1, Math.min(99, Number(params.maxDevices) || 2));
    const aiEnabled = params.aiEnabled !== false;
    const dailyAiLimit = Math.max(0, Math.min(9999, Number(params.dailyAiLimit ?? 20)));

    const { salt, hash } = hashPassword(rawPass);
    const acc = {
      id: `usr_${nowFn()}_${crypto.randomBytes(3).toString('hex')}`,
      username: cleanUser,
      note: String(params.note || '').trim().slice(0, 60),
      role: 'member',
      passwordSalt: salt,
      passwordHash: hash,
      tokenVersion: 1,
      status: 'active',
      lockedReason: null,
      createdAt: nowFn(),
      durationHours,
      firstLoginAt: null, // Activated on user's first login!
      expiresAt: null,
      maxDevices,
      boundDevices: [],
      aiEnabled,
      dailyAiLimit,
      aiUsageDate: beijingDateStr(nowFn()),
      aiUsedToday: 0,
      violationStrikes: [],
    };
    db.accounts.unshift(acc);
    recordAuditEvent({
      type: 'ADMIN_CREATE_USER',
      username: cleanUser,
      note: acc.note,
      ip: 'admin',
      detail: `创建账号（时长：${durationHours ? `${durationHours}h 首次登录激活` : '永久'}，设备上限：${maxDevices}台，AI上限：${aiEnabled ? `${dailyAiLimit}次/日` : '关闭'}）`,
    });
    persistNowSync();
    return { user: toPublicUser(acc), plainPassword: rawPass };
  }

  function updateAccount(userId, actionPayload) {
    const acc = db.accounts.find((a) => a.id === userId);
    if (!acc) throw new Error('账号不存在');
    const now = nowFn();
    const act = actionPayload?.action;

    if (act === 'toggle-status') {
      if (acc.role === 'superadmin') throw new Error('不能停用超级管理员账号');
      if (acc.status === 'active') {
        acc.status = 'disabled';
        acc.tokenVersion = (acc.tokenVersion || 1) + 1;
      } else {
        acc.status = 'active';
        acc.lockedReason = null;
        acc.violationStrikes = [];
        // If already expired, give 24h fresh window so re-enabling works immediately
        if (acc.expiresAt !== null && acc.expiresAt <= now) {
          acc.expiresAt = now + 24 * 3600_000;
        }
      }
    } else if (act === 'add-hours') {
      const hrs = Number(actionPayload.hours) || 24;
      if (acc.firstLoginAt === null) {
        acc.durationHours = (acc.durationHours || 0) + hrs;
      } else {
        const base = acc.expiresAt && acc.expiresAt > now ? acc.expiresAt : now;
        acc.expiresAt = base + hrs * 3600_000;
      }
      if (acc.status === 'disabled') acc.status = 'active';
    } else if (act === 'set-permanent') {
      acc.durationHours = null;
      acc.expiresAt = null;
    } else if (act === 'set-duration-hours') {
      const hrs = Math.max(0.5, Number(actionPayload.hours) || 24);
      acc.durationHours = hrs;
      if (acc.firstLoginAt !== null) {
        acc.expiresAt = now + hrs * 3600_000;
      }
    } else if (act === 'clear-devices') {
      acc.boundDevices = [];
      acc.tokenVersion = (acc.tokenVersion || 1) + 1;
    } else if (act === 'update-perms') {
      if (actionPayload.maxDevices !== undefined) {
        acc.maxDevices = Math.max(1, Math.min(99, Number(actionPayload.maxDevices) || 2));
      }
      if (actionPayload.aiEnabled !== undefined) {
        acc.aiEnabled = Boolean(actionPayload.aiEnabled);
      }
      if (actionPayload.dailyAiLimit !== undefined) {
        acc.dailyAiLimit = Math.max(0, Math.min(9999, Number(actionPayload.dailyAiLimit)));
      }
      if (actionPayload.note !== undefined) {
        acc.note = String(actionPayload.note).trim().slice(0, 60);
      }
    } else if (act === 'unlock-login') {
      acc.failedLoginCount = 0;
      acc.loginLockedUntil = 0;
      ipBruteMap.clear();
      if (acc.status === 'locked_violation') {
        acc.status = 'active';
        acc.lockedReason = null;
        acc.violationStrikes = [];
      }
    } else if (act === 'reset-password') {
      const newPass = String(actionPayload.newPassword || '').trim() || generateReadablePassword(8);
      const { salt, hash } = hashPassword(newPass);
      acc.passwordSalt = salt;
      acc.passwordHash = hash;
      acc.failedLoginCount = 0;
      acc.loginLockedUntil = 0;
      acc.tokenVersion = (acc.tokenVersion || 1) + 1;
      persistNowSync();
      return {
        user: toPublicUser(acc),
        newPassword: newPass,
        freshAuthToken: signAuthToken(acc.id, acc.tokenVersion),
      };
    }

    persistNowSync();
    return { user: toPublicUser(acc) };
  }

  function deleteAccount(userId) {
    const idx = db.accounts.findIndex((a) => a.id === userId);
    if (idx === -1) throw new Error('账号不存在');
    if (db.accounts[idx].role === 'superadmin') throw new Error('不能删除超级管理员');
    const removed = db.accounts.splice(idx, 1)[0];
    recordAuditEvent({
      type: 'ADMIN_DELETE_USER',
      username: removed.username,
      note: removed.note,
      ip: 'admin',
      detail: '管理员删除了该账号',
    });
    persistNowSync();
    return { ok: true };
  }

  function listAuditLogs() {
    return db.auditLogs.slice(0, 150);
  }

  return {
    authenticateLogin,
    verifyAuthToken,
    verifyAuthTokenDetailed,
    consumeAiQuota,
    recordQaViolation,
    recordAuditEvent,
    listAccounts,
    createAccount,
    updateAccount,
    deleteAccount,
    listAuditLogs,
  };
}
