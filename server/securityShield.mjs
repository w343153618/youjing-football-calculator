import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  fetchOfficialMatchesServer,
  makeUnderwaterDemoPicks,
} from './quantEngine.mjs';

const AI_AND_SCRAPER_UA_RE =
  /Bytespider|Doubao|TikTokSpider|Baiduspider|Sogou[\s_-]*Spider|Sogou[\s]+web[\s]+spider|SogouInstSpider|YisouSpider|360Spider|Moonshot|Kimi|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|Perplexity|Cohere-ai|Google-Extended|Meta-ExternalAgent|FacebookExternalHit|Amazonbot|Applebot-Extended|Jina|r\.jina\.ai|Firecrawl|Crawl4AI|Diffbot|CCBot|PetalBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|Scrapy|HTTrack|wget\/|curl\/|python-requests|python-httpx|aiohttp|Go-http-client|Java\/|okhttp|axios\/|node-fetch|undici|HeadlessChrome|PhantomJS|SlimerJS|Nightmare|CasperJS|Selenium/i;

const HONEYPOT_PATHS = new Set([
  '/internal-export-trap',
  '/api/v1/export-strategy-dump',
  '/.env',
  '/.env.local',
  '/.git/config',
  '/wp-admin',
  '/source.map',
]);

const MAX_SESSIONS = 4000;
const MAX_FUSED_SIDS = 8000;
const MAX_FUSED_IPS = 10000;
const MAX_FUSED_HW = 8000;
export const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export const ROBOTS_TXT = [
  '# Anti-AI & Anti-Scraper Policy',
  'User-agent: Bytespider',
  'User-agent: Doubao',
  'User-agent: GPTBot',
  'User-agent: ChatGPT-User',
  'User-agent: OAI-SearchBot',
  'User-agent: ClaudeBot',
  'User-agent: Claude-Web',
  'User-agent: anthropic-ai',
  'User-agent: PerplexityBot',
  'User-agent: Perplexity-User',
  'User-agent: Google-Extended',
  'User-agent: Meta-ExternalAgent',
  'User-agent: CCBot',
  'User-agent: Diffbot',
  'User-agent: Jina',
  'User-agent: Firecrawl',
  'User-agent: Scrapy',
  'User-agent: *',
  'Disallow: /',
  'Disallow: /api/',
  'Disallow: /internal-export-trap',
  '',
].join('\n');

export const DECOY_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />
  <title>公开足球联赛标准赛程时区换算与基础积分规则参考</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #1e293b; line-height: 1.7; }
    h1 { font-size: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>公开足球联赛标准时区换算与 3/1/0 积分统计表</h1>
  <p>本静态工具页仅用于日常国际联赛 UTC 标准时间与北京时间（UTC+8）换算，以及常规联赛积分榜（胜计 3 分、平计 1 分、负计 0 分）基础加总核对，不包含任何赔率测算或数据模型功能。</p>
  <table>
    <thead><tr><th>赛区标准时</th><th>夏令时换算（UTC+8）</th><th>冬令时换算（UTC+8）</th></tr></thead>
    <tbody>
      <tr><td>英国伦敦 (GMT/BST)</td><td>+7 小时</td><td>+8 小时</td></tr>
      <tr><td>中欧时间 (CET/CEST)</td><td>+6 小时</td><td>+7 小时</td></tr>
      <tr><td>南美巴西利亚 (BRT)</td><td>+11 小时</td><td>+11 小时</td></tr>
    </tbody>
  </table>
  <p style="font-size:12px;color:#64748b;">静态参考文档 · 无交互式脚本与外部接口</p>
</body>
</html>`;

export function renderFusedHtml(remainingMs = FORTY_EIGHT_HOURS_MS) {
  const safeRem = Math.max(60_000, remainingMs);
  const hrs = Math.floor(safeRem / 3_600_000);
  const mins = Math.ceil((safeRem % 3_600_000) / 60_000);
  const timeText = hrs > 0 ? `${hrs} 小时 ${mins % 60} 分钟` : `${mins} 分钟`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>访问阻断 · 熔断天平 48 小时整机锁定中</title>
  <style>
    body { background: #070a12; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; user-select: none; }
    .box { max-width: 450px; padding: 30px 26px; border-radius: 20px; background: rgba(15,23,42,0.88); border: 1px solid rgba(239,68,68,0.5); box-shadow: 0 28px 70px rgba(0,0,0,0.75); }
    .ico { font-size: 34px; margin-bottom: 10px; }
    h2 { margin: 0 0 10px; font-size: 18px; color: #f87171; letter-spacing: -0.01em; }
    .cd { display: inline-block; margin: 10px 0 12px; padding: 5px 14px; border-radius: 99px; background: rgba(239,68,68,0.16); color: #fca5a5; font-size: 12.5px; font-weight: 600; border: 1px solid rgba(239,68,68,0.32); }
    p { margin: 0; font-size: 12.5px; color: #94a3b8; line-height: 1.65; }
  </style>
</head>
<body>
  <div class="box">
    <div class="ico">⚖️</div>
    <h2>安全熔断天平已触发 · 整机全浏览器封禁 48 小时</h2>
    <div class="cd">剩余锁定时长：${timeText}</div>
    <p>系统检测到开发者调试工具探测、抓包重放或逆向抓取行为，已同步锁定当前硬件设备指纹、网络出口与全部浏览器会话，更换浏览器或无痕模式均无法解除。</p>
  </div>
</body>
</html>`;
}

export const FUSED_HTML = renderFusedHtml(FORTY_EIGHT_HOURS_MS);

export function deriveSessionSubkeys(masterKeyBuf) {
  const aesKey = crypto
    .createHash('sha256')
    .update(masterKeyBuf)
    .update(':aes-256-gcm')
    .digest();
  const hmacKey = crypto
    .createHash('sha256')
    .update(masterKeyBuf)
    .update(':hmac-sha256')
    .digest();
  return { aesKey, hmacKey };
}

export function encryptEnvelope(aesKeyBuf, payloadObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKeyBuf, iv);
  const plainBuf = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    d: Buffer.concat([enc, tag]).toString('base64'),
  };
}

export function decryptEnvelope(aesKeyBuf, ivB64, dB64) {
  try {
    const iv = Buffer.from(String(ivB64 || ''), 'base64');
    const raw = Buffer.from(String(dB64 || ''), 'base64');
    if (iv.length !== 12 || raw.length < 17) {
      throw new Error('Malformed encrypted envelope');
    }
    const enc = raw.subarray(0, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKeyBuf, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    const err = new Error('Envelope decryption failed');
    err.statusCode = 403;
    throw err;
  }
}

export function computeEnvelopeHmacHex(hmacKeyBuf, sid, endpoint, ts, nonce, ivB64, dB64) {
  return crypto
    .createHmac('sha256', hmacKeyBuf)
    .update(`${sid}.${endpoint}.${ts}.${nonce}.${ivB64}.${dB64}`)
    .digest('hex');
}

function isLoopbackAddr(addr) {
  const s = String(addr || '');
  return s === '127.0.0.1' || s === '::1' || s === '::ffff:127.0.0.1' || s === 'localhost';
}

function isDirectLoopback(req) {
  return (
    isLoopbackAddr(req.socket?.remoteAddress) &&
    !req.headers['x-real-ip'] &&
    !req.headers['x-forwarded-for']
  );
}

export function extractClientIp(req) {
  const sockIp = req.socket?.remoteAddress || '0.0.0.0';
  if (isLoopbackAddr(sockIp)) {
    const xReal = String(req.headers['x-real-ip'] || '').trim();
    if (xReal) return xReal;
    const xFwdParts = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (xFwdParts.length > 0) return xFwdParts[xFwdParts.length - 1];
  }
  return sockIp;
}

export function isAiReaderOrScraperRequest(req) {
  const ua = String(req.headers['user-agent'] || '').trim();
  if (!ua || ua.length < 12) return true;
  if (AI_AND_SCRAPER_UA_RE.test(ua)) return true;

  const secChUa = String(req.headers['sec-ch-ua'] || '');
  if (/Headless/i.test(secChUa)) return true;

  const headerKeys = Object.keys(req.headers);
  if (
    headerKeys.some(
      (k) =>
        k.startsWith('x-jina-') ||
        k.startsWith('x-firecrawl-') ||
        k.startsWith('x-crawler-') ||
        k === 'x-respond-with'
    )
  ) {
    return true;
  }

  const accept = String(req.headers['accept'] || '');
  const acceptLang = String(req.headers['accept-language'] || '');
  const secFetchMode = String(req.headers['sec-fetch-mode'] || '');
  if (!acceptLang && !secFetchMode && accept === '*/*') {
    return true;
  }

  return false;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const pair of String(cookieHeader).split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return out;
}

function readJsonBody(req, maxBytes = 600_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        settled = true;
        req.destroy?.();
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error('Malformed JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.end(html);
}

function setBoundedMap(map, key, val, maxCap) {
  if (!map.has(key) && map.size >= maxCap) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
  map.set(key, val);
}

/**
 * 创建统一四层安全护盾与服务端精算黑盒网关
 */
export function createSecurityAndQuantGateway(opts = {}) {
  const snapshotFile = opts.snapshotFile || null;
  const banStoreFile = opts.banStoreFile || null;
  const accountManager = opts.accountManager || null;
  const manualQaEngine = opts.manualQaEngine || null;
  const xiaogaoService = opts.xiaogaoService;
  const getApiKey = opts.getApiKey || (() => '');
  const nowFn = opts.nowFn || (() => Date.now());
  const fuseDurationMs = opts.fuseDurationMs ?? FORTY_EIGHT_HOURS_MS;
  const sessionTtlMs = opts.sessionTtlMs ?? 2 * 60 * 60 * 1000;
  const replayWindowMs = opts.replayWindowMs ?? 60_000;
  const fuseLoopback = Boolean(opts.fuseLoopback);

  const sessions = new Map();
  const fusedIps = new Map(); // ip -> expiresAtMs (48h whole-computer network ban)
  const fusedHwFps = new Map(); // hwFp -> expiresAtMs (48h cross-browser GPU/screen hardware ban)
  const fusedSids = new Map(); // sid -> expiresAtMs

  // Load persisted 48-hour bans across server restarts
  if (banStoreFile && fs.existsSync(banStoreFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(banStoreFile, 'utf8'));
      const bootNow = nowFn();
      for (const [k, exp] of saved.ips || []) {
        if (exp > bootNow) fusedIps.set(k, exp);
      }
      for (const [k, exp] of saved.hwFps || []) {
        if (exp > bootNow) fusedHwFps.set(k, exp);
      }
      for (const [k, exp] of saved.sids || []) {
        if (exp > bootNow) fusedSids.set(k, exp);
      }
    } catch {
      // ignore corrupted ban file
    }
  }

  let persistTimer = null;
  let banPersistSeq = 0;
  function schedulePersistBans() {
    if (!banStoreFile || persistTimer) return;
    const mySeq = ++banPersistSeq;
    persistTimer = setTimeout(async () => {
      try {
        if (mySeq !== banPersistSeq) return;
        await fsp.mkdir(path.dirname(banStoreFile), { recursive: true });
        const tmp = `${banStoreFile}.tmp.${process.pid}.${Date.now()}`;
        const data = JSON.stringify({
          ips: [...fusedIps.entries()],
          hwFps: [...fusedHwFps.entries()],
          sids: [...fusedSids.entries()],
        });
        await fsp.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
        await fsp.rename(tmp, banStoreFile);
      } catch {
        // ignore disk error
      } finally {
        persistTimer = null;
      }
    }, 150);
    persistTimer.unref?.();
  }

  const bootstrapRateMap = new Map();

  let cachedMatches = FALLBACK_MATCHES;
  let cachedSyncNote = '已连接体彩实盘快照 · 支持一键刷新官网水位';
  let lastMatchFetchAt = 0;
  let inFlightMatchLoad = null;
  let lastPruneAt = 0;

  async function ensureMatchesLoaded(force = false) {
    const now = nowFn();
    if (!force && lastMatchFetchAt > 0 && now - lastMatchFetchAt < 120_000) {
      return { matches: cachedMatches, syncNote: cachedSyncNote };
    }
    if (inFlightMatchLoad) return inFlightMatchLoad;

    inFlightMatchLoad = (async () => {
      try {
        const res = await fetchOfficialMatchesServer(snapshotFile);
        cachedMatches = res.matches.map((nm) => {
          const existing = cachedMatches.find(
            (em) => em.id === nm.id || em.matchNumStr === nm.matchNumStr
          );
          return existing?.aiAlert && !nm.aiAlert ? { ...nm, aiAlert: existing.aiAlert } : nm;
        });
        cachedSyncNote = res.syncNote;
        lastMatchFetchAt = nowFn();
        return { matches: cachedMatches, syncNote: cachedSyncNote };
      } finally {
        inFlightMatchLoad = null;
      }
    })();

    return inFlightMatchLoad;
  }

  function mergeSessionAlerts(baseMatches, sess) {
    if (!sess?.aiAlerts || sess.aiAlerts.size === 0) return baseMatches;
    return baseMatches.map((m) =>
      sess.aiAlerts.has(m.id) ? { ...m, aiAlert: sess.aiAlerts.get(m.id) } : m
    );
  }

  function pruneExpired(force = false) {
    const now = nowFn();
    if (!force && now - lastPruneAt < 10_000) return;
    lastPruneAt = now;

    for (const [ip, exp] of fusedIps) {
      if (now >= exp) fusedIps.delete(ip);
    }
    for (const [fp, exp] of fusedHwFps) {
      if (now >= exp) fusedHwFps.delete(fp);
    }
    for (const [sid, exp] of fusedSids) {
      if (now >= exp) fusedSids.delete(sid);
    }
    for (const [sid, sess] of sessions) {
      if (now - sess.createdAt > sessionTtlMs) sessions.delete(sid);
    }
    for (const [ip, entry] of bootstrapRateMap) {
      if (now - entry.windowStart > 60_000) bootstrapRateMap.delete(ip);
    }
  }

  function tripFuse(ip, sid, durationMs = fuseDurationMs, banIp = true, hwFp = null) {
    const exp = nowFn() + durationMs;
    const sess = sid ? sessions.get(sid) : null;
    const resolvedHwFp = sess?.hwFp || (typeof hwFp === 'string' && /^[0-9a-f]{32,64}$/i.test(hwFp) ? hwFp : null);

    if (sid && sess) {
      sessions.delete(sid);
      setBoundedMap(fusedSids, sid, exp, MAX_FUSED_SIDS);
    }
    if (resolvedHwFp) {
      setBoundedMap(fusedHwFps, resolvedHwFp, exp, MAX_FUSED_HW);
    }
    if (banIp && ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
      setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
    }
    schedulePersistBans();
    return exp;
  }

  function getFusedExpiry(req, ip) {
    pruneExpired(false);
    const now = nowFn();
    if (ip && fusedIps.has(ip)) {
      const exp = fusedIps.get(ip);
      if (exp > now) return exp;
      fusedIps.delete(ip);
    }
    const cookies = parseCookies(req.headers?.cookie);
    const sidHeader = String(req.headers?.['x-yj-sid'] || cookies.yj_sh_sid || '');
    if (sidHeader && fusedSids.has(sidHeader)) {
      const exp = fusedSids.get(sidHeader);
      if (exp > now) return exp;
      fusedSids.delete(sidHeader);
    }
    if (cookies.yj_sh_sid === 'fused') return now + fuseDurationMs;
    const hwHeader = String(req.headers?.['x-yj-hw'] || '').toLowerCase();
    if (hwHeader && fusedHwFps.has(hwHeader)) {
      const exp = fusedHwFps.get(hwHeader);
      if (exp <= now) {
        fusedHwFps.delete(hwHeader);
        return null;
      }
      // Contagious cross-network lock: if banned hardware switches IP/VPN, lock the new IP too!
      if (ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
        setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
        schedulePersistBans();
      }
      return exp;
    }
    return null;
  }

  function isRequestFused(req, ip) {
    return getFusedExpiry(req, ip) !== null;
  }

  function checkBootstrapRateLimit(ip) {
    if (!ip || (isLoopbackAddr(ip) && !fuseLoopback)) return true;
    const now = nowFn();
    const cur = bootstrapRateMap.get(ip);
    if (!cur || now - cur.windowStart > 60_000) {
      setBoundedMap(bootstrapRateMap, ip, { windowStart: now, count: 1 }, MAX_FUSED_IPS);
      return true;
    }
    cur.count += 1;
    return cur.count <= 80;
  }

  function verifyAndUnseal(req, body, ip, endpoint) {
    const sid = String(req.headers['x-yj-sid'] || '');
    const tsStr = String(req.headers['x-yj-ts'] || '');
    const nonce = String(req.headers['x-yj-nonce'] || '');
    const sig = String(req.headers['x-yj-sig'] || '');

    if (
      !/^[0-9a-f]{32}$/i.test(sid) ||
      !tsStr ||
      !/^[0-9a-f]{32}$/i.test(nonce) ||
      !/^[0-9a-f]{64}$/i.test(sig)
    ) {
      const err = new Error('Invalid cryptographic envelope headers');
      err.statusCode = 401;
      throw err;
    }

    const sess = sessions.get(sid);
    if (!sess) {
      const err = new Error('Session expired or invalid');
      err.statusCode = 401;
      err.sessionExpired = true;
      throw err;
    }

    const now = nowFn();
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > replayWindowMs) {
      const err = new Error('Envelope timestamp outside allowed window');
      err.statusCode = 403;
      throw err;
    }

    // Prune expired nonces older than 2 * replayWindowMs
    for (const [n, seenAt] of sess.seenNonces) {
      if (now - seenAt > replayWindowMs * 2) {
        sess.seenNonces.delete(n);
      } else {
        break;
      }
    }

    if (sess.seenNonces.has(nonce)) {
      tripFuse(ip, sid, fuseDurationMs, true);
      const err = new Error('Replay attack detected — session fused');
      err.statusCode = 403;
      err.fused = true;
      throw err;
    }

    const ivB64 = String(body?.iv || '');
    const dB64 = String(body?.d || '');
    const expectedSig = computeEnvelopeHmacHex(
      sess.hmacKey,
      sid,
      endpoint,
      tsStr,
      nonce,
      ivB64,
      dB64
    );

    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== 32 || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      tripFuse(ip, sid, fuseDurationMs, true);
      const err = new Error('Envelope signature mismatch — session fused');
      err.statusCode = 403;
      err.fused = true;
      throw err;
    }

    setBoundedMap(sess.seenNonces, nonce, now, 3000);
    const data = decryptEnvelope(sess.aesKey, ivB64, dB64);
    return { sess, data };
  }

  function cookieSuffix(req, maxAgeSec) {
    const isSecure =
      String(req.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https' ||
      Boolean(req.socket?.encrypted);
    return `; Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}; Max-Age=${maxAgeSec}`;
  }

  function deriveFallbackClientFp(req, ip) {
    return crypto
      .createHash('sha256')
      .update(`fb:${ip}:${String(req.headers?.['user-agent'] || '')}`)
      .digest('hex')
      .slice(0, 32);
  }

  function consumeUserAiQuota(user, res) {
    if (!accountManager || !user) return { ok: true, remaining: undefined };
    const quota = accountManager.consumeAiQuota(user.id);
    if (!quota.ok) {
      sendJson(res, quota.statusCode || 403, { ok: false, error: quota.error });
      return { ok: false, remaining: 0 };
    }
    return { ok: true, remaining: quota.remaining };
  }

  function extractAuthToken(req, sess) {
    const hdr = String(req.headers?.['x-yj-auth'] || '').trim();
    if (hdr) return hdr;
    const cookies = parseCookies(req.headers?.cookie);
    if (cookies.yj_auth_tok) return cookies.yj_auth_tok;
    return sess?.authToken || '';
  }

  function requireSessionAuth(req, sess, ip) {
    if (!accountManager) {
      return { user: null };
    }
    const rawToken = extractAuthToken(req, sess);
    const authRes = accountManager.verifyAuthTokenDetailed(rawToken, sess?.hwFp, ip);
    if (!authRes.ok) {
      const err = new Error(authRes.error || '请先登录授权账号');
      err.statusCode =
        authRes.code === 'AUTH_MISSING' || authRes.code === 'AUTH_REVOKED' ? 401 : 403;
      err.authRequired = true;
      err.authCode = authRes.code;
      err.authError = authRes.error;
      throw err;
    }
    sess.authToken = rawToken;
    return { user: authRes.user };
  }

  function sendGatewayCatchError(res, err, fallbackMsg = '加密信封校验失败或会话已过期') {
    if (err?.authRequired) {
      sendJson(res, err.statusCode || 401, {
        ok: false,
        authRequired: true,
        authCode: err.authCode || 'AUTH_REVOKED',
        error: err.authError || err.message || '登录已失效，请重新登录',
      });
      return;
    }
    sendJson(res, err?.statusCode || 403, {
      ok: false,
      fused: Boolean(err?.fused),
      sessionExpired: Boolean(err?.sessionExpired),
      error: fallbackMsg,
    });
  }

  function buildInitialWorkspaceBundle(matches, syncNote) {
    const initialPicks = makeUnderwaterDemoPicks(matches);
    const workspace = evaluateQuantWorkspace(
      {
        picks: initialPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: matches.slice(0, 2).map((m) => m.id),
        budget: 100,
        stance: 'objective',
        unlockFullAgg: false,
      },
      matches
    );
    return { matches, syncNote, initialPicks, workspace };
  }

  async function handleRequest(req, res, pathname) {
    pruneExpired(false);

    // 1. Redacted healthcheck + direct loopback deploy status check
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: '2.0.0',
        uptimeSec: Math.round(process.uptime()),
      });
      return true;
    }

    if (pathname === '/api/xiaogao/status' && req.method === 'GET' && isDirectLoopback(req)) {
      const apiKey = getApiKey();
      sendJson(
        res,
        200,
        xiaogaoService
          ? xiaogaoService.getPublicStatus(Boolean(apiKey))
          : { ok: true, configured: Boolean(apiKey), channel: 'primary', degraded: false }
      );
      return true;
    }

    // 2. Robots.txt anti-AI declaration
    if (pathname === '/robots.txt' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(ROBOTS_TXT);
      return true;
    }

    const ip = extractClientIp(req);

    // 3. Honeypot trap routes -> immediate 48-hour IP fuse!
    if (HONEYPOT_PATHS.has(pathname)) {
      tripFuse(ip, null, fuseDurationMs, true);
      sendHtml(res, 403, renderFusedHtml(fuseDurationMs));
      return true;
    }

    // 4. Fuse check (except fuse report endpoint itself)
    if (pathname !== '/api/security/fuse') {
      const fusedExp = getFusedExpiry(req, ip);
      if (fusedExp !== null) {
        const remMs = Math.max(60_000, fusedExp - nowFn());
        if (pathname.startsWith('/api/')) {
          sendJson(res, 403, {
            ok: false,
            fused: true,
            unlockAt: fusedExp,
            error: '熔断天平已触发：当前设备与网络已被锁定 48 小时',
          });
        } else {
          sendHtml(res, 403, renderFusedHtml(remMs));
        }
        return true;
      }
    }

    // 5. Anti-AI-Reader / Anti-Scraper Decoy & Asset Shield
    if (isAiReaderOrScraperRequest(req)) {
      if (pathname.startsWith('/api/')) {
        sendJson(res, 403, { ok: false, error: 'Automated access denied' });
        return true;
      }
      if (
        pathname.endsWith('.js') ||
        pathname.endsWith('.mjs') ||
        pathname.endsWith('.css') ||
        pathname.endsWith('.map')
      ) {
        res.statusCode = 403;
        res.end('Forbidden');
        return true;
      }
      sendHtml(res, 200, DECOY_HTML);
      return true;
    }

    // 6. High-Pressure 48-Hour Whole-Computer Fuse Endpoint (locks IP + Hardware GPU/Screen Fingerprint + Session + 48h Cookie!)
    if (pathname === '/api/security/fuse' && req.method === 'POST') {
      let fuseBody = {};
      try {
        fuseBody = await readJsonBody(req, 16_000);
      } catch {
        // ignore
      }
      const sid = String(req.headers['x-yj-sid'] || '');
      const sess = sid ? sessions.get(sid) : null;
      const isGenericMobileUa = /iPhone|iPad|Android/i.test(String(req.headers['user-agent'] || ''));
      // Prevent unauthenticated hwFp spoofing DoS: require matching session IP, and on generic mobile UA require authenticated session
      const canBanHwFp =
        sess &&
        sess.ip === ip &&
        (Boolean(sess.authToken) || !isGenericMobileUa);
      const verifiedHwFp = canBanHwFp
        ? sess.hwFp || (typeof fuseBody?.hwFp === 'string' ? fuseBody.hwFp.toLowerCase() : null)
        : null;
      const unlockAt = tripFuse(ip, sid || null, fuseDurationMs, true, verifiedHwFp);
      res.setHeader('Set-Cookie', `yj_sh_sid=fused${cookieSuffix(req, 172800)}`);
      sendJson(res, 200, { ok: true, fused: true, unlockAt });
      return true;
    }

    // 7. Browser-verified status endpoint
    if (pathname === '/api/xiaogao/status' && req.method === 'GET') {
      const apiKey = getApiKey();
      sendJson(
        res,
        200,
        xiaogaoService
          ? xiaogaoService.getPublicStatus(Boolean(apiKey))
          : { ok: true, configured: Boolean(apiKey), channel: 'primary', degraded: false }
      );
      return true;
    }

    // 8. Ephemeral Session Bootstrap + Initial Encrypted Workspace
    if (pathname === '/api/security/bootstrap' && req.method === 'POST') {
      if (!checkBootstrapRateLimit(ip)) {
        sendJson(res, 429, { ok: false, error: '请求过于频繁，请稍后再试' });
        return true;
      }
      let body;
      try {
        body = await readJsonBody(req, 32_000);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: 'Invalid request body' });
        return true;
      }
      if (!body || body.v !== 1 || typeof body.tz !== 'string') {
        sendJson(res, 400, { ok: false, error: 'Invalid client handshake' });
        return true;
      }

      const rawHwFp = typeof body.hwFp === 'string' && /^[0-9a-f]{32,64}$/i.test(body.hwFp) ? body.hwFp.toLowerCase() : null;
      if (rawHwFp && fusedHwFps.has(rawHwFp)) {
        const exp = fusedHwFps.get(rawHwFp);
        // Contagious cross-browser & cross-IP ban: lock new IP/profile too!
        if (ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
          setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
          schedulePersistBans();
        }
        res.setHeader('Set-Cookie', `yj_sh_sid=fused${cookieSuffix(req, 172800)}`);
        sendJson(res, 403, {
          ok: false,
          fused: true,
          unlockAt: exp,
          error: '熔断天平已触发：当前电脑硬件指纹处于 48 小时封禁期',
        });
        return true;
      }

      const sid = crypto.randomBytes(16).toString('hex');
      const masterKeyBuf = crypto.randomBytes(32);
      const { aesKey, hmacKey } = deriveSessionSubkeys(masterKeyBuf);
      const rawAuthToken = extractAuthToken(req, null);
      const deviceBindFp = rawHwFp || deriveFallbackClientFp(req, ip);
      const authRes = accountManager
        ? accountManager.verifyAuthTokenDetailed(rawAuthToken, deviceBindFp, ip)
        : { ok: true, user: null };

      setBoundedMap(
        sessions,
        sid,
        {
          sid,
          aesKey,
          hmacKey,
          createdAt: nowFn(),
          ip,
          hwFp: rawHwFp,
          deviceBindFp,
          authToken: authRes.ok && rawAuthToken ? rawAuthToken : null,
          seenNonces: new Map(),
          aiAlerts: new Map(),
        },
        MAX_SESSIONS
      );

      // Full-gate login mode: unauthenticated sessions receive ONLY handshake keys + authenticated:false (zero match/quant data!)
      if (accountManager && !authRes.ok) {
        const cookiesOut = [`yj_sh_sid=${sid}${cookieSuffix(req, 7200)}`];
        if (rawAuthToken) {
          cookiesOut.push(`yj_auth_tok=${cookieSuffix(req, 0)}`);
        }
        res.setHeader('Set-Cookie', cookiesOut);
        sendJson(res, 200, {
          ok: true,
          sid,
          k: masterKeyBuf.toString('base64'),
          payload: encryptEnvelope(aesKey, {
            authenticated: false,
            authCode: authRes.code,
            authError: rawAuthToken ? authRes.error : null,
          }),
        });
        return true;
      }

      const { matches, syncNote } = await ensureMatchesLoaded(false);
      const bundle = buildInitialWorkspaceBundle(matches, syncNote);
      const cookiesOut = [`yj_sh_sid=${sid}${cookieSuffix(req, 7200)}`];
      if (accountManager && rawAuthToken) {
        cookiesOut.push(`yj_auth_tok=${rawAuthToken}${cookieSuffix(req, 31536000)}`);
      }
      res.setHeader('Set-Cookie', cookiesOut);
      sendJson(res, 200, {
        ok: true,
        sid,
        k: masterKeyBuf.toString('base64'),
        payload: encryptEnvelope(
          aesKey,
          accountManager
            ? {
                authenticated: true,
                user: authRes.user,
                authToken: rawAuthToken,
                ...bundle,
              }
            : bundle
        ),
      });
      return true;
    }

    // 8b. Encrypted Member & Super-Admin Login (/api/auth/login)
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (!accountManager) {
        sendJson(res, 404, { ok: false, error: 'Auth service not enabled' });
        return true;
      }
      try {
        const body = await readJsonBody(req, 32_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'auth/login');
        const effectiveHwFp =
          sess.hwFp ||
          (typeof data?.hwFp === 'string' && /^[0-9a-f]{32,64}$/i.test(data.hwFp)
            ? data.hwFp.toLowerCase()
            : null);
        if (effectiveHwFp) sess.hwFp = effectiveHwFp;
        const bindFp = effectiveHwFp || sess.deviceBindFp || deriveFallbackClientFp(req, ip);
        sess.deviceBindFp = bindFp;

        if (effectiveHwFp && fusedHwFps.has(effectiveHwFp)) {
          const exp = fusedHwFps.get(effectiveHwFp);
          if (ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
            setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
            schedulePersistBans();
          }
          sendJson(res, 403, {
            ok: false,
            fused: true,
            unlockAt: exp,
            error: '熔断天平已触发：当前电脑硬件指纹处于 48 小时封禁期',
          });
          return true;
        }

        const loginRes = accountManager.authenticateLogin({
          username: data?.username,
          password: data?.password,
          hwFp: bindFp,
          deviceLabel: data?.deviceLabel,
          ip,
        });

        if (!loginRes.ok) {
          sendJson(res, loginRes.statusCode || 401, {
            ok: false,
            lockedRemainingSec: loginRes.lockedRemainingSec || 0,
            error: loginRes.error,
          });
          return true;
        }

        sess.authToken = loginRes.authToken;
        const { matches, syncNote } = await ensureMatchesLoaded(false);
        const sessionMatches = mergeSessionAlerts(matches, sess);
        const bundle = buildInitialWorkspaceBundle(sessionMatches, syncNote);

        res.setHeader(
          'Set-Cookie',
          `yj_auth_tok=${loginRes.authToken}${cookieSuffix(req, 31536000)}`
        );
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, {
            authenticated: true,
            user: loginRes.user,
            authToken: loginRes.authToken,
            ...bundle,
          }),
        });
      } catch (err) {
        sendGatewayCatchError(res, err, '登录安全校验失败，请刷新重试');
      }
      return true;
    }

    // 8c. Encrypted Explicit Logout (/api/auth/logout)
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 16_000);
        const { sess } = verifyAndUnseal(req, body, ip, 'auth/logout');
        sess.authToken = null;
        res.setHeader('Set-Cookie', `yj_auth_tok=${cookieSuffix(req, 0)}`);
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, { loggedOut: true }),
        });
      } catch (err) {
        sendGatewayCatchError(res, err, '退出操作异常');
      }
      return true;
    }

    // 8d. Encrypted Route-C Hybrid Iron-Cage Manual Q&A (/api/manual/ask)
    if (pathname === '/api/manual/ask' && req.method === 'POST') {
      if (!manualQaEngine || !accountManager) {
        sendJson(res, 404, { ok: false, error: 'Manual QA not enabled' });
        return true;
      }
      try {
        const body = await readJsonBody(req, 32_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'manual/ask');
        const { user } = requireSessionAuth(req, sess, ip);
        const qaRes = await manualQaEngine.answerManualQuestion({
          userId: user.id,
          question: data?.question,
          ip,
        });

        // >4 violations auto-locks account AND immediately triggers 48h whole-computer meltdown fuse!
        if (qaRes.accountLocked) {
          const unlockAt = tripFuse(ip, sess.sid, fuseDurationMs, true, sess.hwFp);
          res.setHeader('Set-Cookie', [
            'yj_auth_tok=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
            'yj_sh_sid=fused; Path=/; HttpOnly; SameSite=Lax; Max-Age=172800',
          ]);
          sendJson(res, 403, {
            ok: false,
            accountLocked: true,
            fused: true,
            unlockAt,
            error: qaRes.error,
          });
          return true;
        }

        if (!qaRes.ok) {
          sendJson(res, qaRes.statusCode || 400, {
            ok: false,
            error: qaRes.error,
          });
          return true;
        }

        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, qaRes),
        });
      } catch (err) {
        sendGatewayCatchError(res, err, '说明书助手繁忙，请稍后再试');
      }
      return true;
    }

    // 8e. Encrypted Hidden Super-Admin RBAC Console Endpoints (/api/admin/*)
    if (pathname.startsWith('/api/admin/') && req.method === 'POST') {
      if (!accountManager) {
        sendJson(res, 404, { ok: false, error: 'Admin service not enabled' });
        return true;
      }
      const subEndpoint = pathname.slice('/api/'.length);
      if (
        !['admin/overview', 'admin/create-user', 'admin/update-user', 'admin/delete-user'].includes(
          subEndpoint
        )
      ) {
        sendJson(res, 404, { ok: false, error: 'Admin endpoint not found' });
        return true;
      }
      try {
        const body = await readJsonBody(req, 64_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, subEndpoint);
        const { user } = requireSessionAuth(req, sess, ip);
        if (!user || user.role !== 'superadmin') {
          sendJson(res, 403, { ok: false, error: '无权访问该资源' });
          return true;
        }

        if (subEndpoint === 'admin/overview') {
          sendJson(res, 200, {
            ok: true,
            payload: encryptEnvelope(sess.aesKey, {
              accounts: accountManager.listAccounts(),
              auditLogs: accountManager.listAuditLogs(),
              fusedIpsCount: fusedIps.size,
              fusedHwCount: fusedHwFps.size,
            }),
          });
          return true;
        }

        if (subEndpoint === 'admin/create-user') {
          const created = accountManager.createAccount(data || {});
          sendJson(res, 200, {
            ok: true,
            payload: encryptEnvelope(sess.aesKey, created),
          });
          return true;
        }

        if (subEndpoint === 'admin/update-user') {
          const updated = accountManager.updateAccount(data?.userId, data || {});
          if (updated.freshAuthToken && data?.userId === user.id) {
            sess.authToken = updated.freshAuthToken;
            res.setHeader(
              'Set-Cookie',
              `yj_auth_tok=${updated.freshAuthToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
            );
          }
          sendJson(res, 200, {
            ok: true,
            payload: encryptEnvelope(sess.aesKey, {
              user: updated.user,
              newPassword: updated.newPassword,
              selfAuthToken: data?.userId === user.id ? updated.freshAuthToken : undefined,
            }),
          });
          return true;
        }

        if (subEndpoint === 'admin/delete-user') {
          const deleted = accountManager.deleteAccount(data?.userId);
          sendJson(res, 200, {
            ok: true,
            payload: encryptEnvelope(sess.aesKey, deleted),
          });
          return true;
        }
      } catch (err) {
        if (err?.authRequired || err?.fused || err?.sessionExpired) {
          sendGatewayCatchError(res, err, '管理操作鉴权失败');
        } else {
          sendJson(res, 400, { ok: false, error: err?.message || '管理操作失败' });
        }
      }
      return true;
    }

    // 9. Encrypted Black-Box Quant Workspace Compute
    if (pathname === '/api/quant/compute' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 400_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'quant/compute');
        requireSessionAuth(req, sess, ip);
        const { matches } = await ensureMatchesLoaded(false);
        const sessionMatches = mergeSessionAlerts(matches, sess);
        const workspace = evaluateQuantWorkspace(data, sessionMatches);
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, workspace),
        });
      } catch (err) {
        sendGatewayCatchError(res, err, '加密信封校验失败或会话已过期');
      }
      return true;
    }

    // 10. Encrypted Live Official Odds Sync
    if (pathname === '/api/quant/sync' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 400_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'quant/sync');
        requireSessionAuth(req, sess, ip);
        const { matches, syncNote } = await ensureMatchesLoaded(true);
        const sessionMatches = mergeSessionAlerts(matches, sess);
        const workspace = evaluateQuantWorkspace(data?.workspaceParams || {}, sessionMatches);
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, {
            matches: sessionMatches,
            syncNote,
            workspace,
          }),
        });
      } catch (err) {
        sendGatewayCatchError(res, err, '同步校验失败');
      }
      return true;
    }

    // 11. Encrypted Match Diagnosis (verify cryptographic envelope + auth + AI quota BEFORE calling API!)
    if (pathname === '/api/xiaogao/analyze' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 200_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'xiaogao/analyze');
        const { user } = requireSessionAuth(req, sess, ip);
        const qCheck = consumeUserAiQuota(user, res);
        if (!qCheck.ok) return true;
        const apiKey = getApiKey();
        if (!apiKey || !xiaogaoService) {
          sendJson(res, 500, { ok: false, error: '服务暂未就绪' });
          return true;
        }
        const alert = await xiaogaoService.analyzeMatch(apiKey, data);
        if (data?.matchId) {
          setBoundedMap(sess.aiAlerts, String(data.matchId), alert, 32);
        }
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, { alert, aiRemaining: qCheck.remaining }),
        });
      } catch (err) {
        if (err?.authRequired || err?.fused || err?.sessionExpired) {
          sendGatewayCatchError(res, err, '安全会话已失效');
        } else {
          sendJson(res, err.statusCode || 502, {
            ok: false,
            error: '服务繁忙，请稍后再试',
          });
        }
      }
      return true;
    }

    // 12. Encrypted Multi-Match Joint Parlay Diagnosis (/api/xiaogao/analyze-combo)
    if (pathname === '/api/xiaogao/analyze-combo' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 350_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'xiaogao/analyze-combo');
        const { user } = requireSessionAuth(req, sess, ip);
        const qCheck = consumeUserAiQuota(user, res);
        if (!qCheck.ok) return true;
        const apiKey = getApiKey();
        if (!apiKey || !xiaogaoService?.analyzeComboMatches) {
          sendJson(res, 500, { ok: false, error: '服务暂未就绪' });
          return true;
        }
        const comboReport = await xiaogaoService.analyzeComboMatches(apiKey, data);
        if (Array.isArray(comboReport?.perMatch)) {
          for (const pm of comboReport.perMatch) {
            const matchedCanonical = cachedMatches.find(
              (cm) =>
                cm.id === pm?.matchId ||
                cm.matchNumStr === pm?.matchId ||
                (pm?.matchTitle && pm.matchTitle.includes(cm.matchNumStr))
            );
            const canonicalId = matchedCanonical?.id || pm?.matchId;
            if (canonicalId) {
              setBoundedMap(
                sess.aiAlerts,
                String(canonicalId),
                {
                  level: comboReport.level === 'high' ? 'high' : 'medium',
                  tag: pm.tag,
                  summary: pm.note,
                  priceInStatus: pm.priceInStatus,
                  source: comboReport.source,
                },
                32
              );
            }
          }
        }
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, { comboReport, aiRemaining: qCheck.remaining }),
        });
      } catch (err) {
        if (err?.authRequired || err?.fused || err?.sessionExpired) {
          sendGatewayCatchError(res, err, '安全会话已失效');
        } else {
          sendJson(res, err.statusCode || 502, {
            ok: false,
            error: '服务繁忙，请稍后再试',
          });
        }
      }
      return true;
    }

    return false;
  }

  return {
    handleRequest,
    tripFuse,
    isRequestFused,
    ensureMatchesLoaded,
  };
}
