import crypto from 'node:crypto';
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

export const FUSED_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>访问受限 · 安全熔断保护中</title>
  <style>
    body { background: #090d16; color: #e2e8f0; font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .box { max-width: 420px; padding: 28px; border-radius: 18px; background: rgba(30,41,59,0.75); border: 1px solid rgba(239,68,68,0.4); }
    h2 { margin: 0 0 10px; font-size: 18px; color: #f87171; }
    p { margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="box">
    <h2>⚠️ 安全防护已触发 · 当前会话熔断锁定</h2>
    <p>系统检测到调试器开启、抓包重放或异常自动化抓取特征，已自动清空工作台并临时封禁当前访问通道（15 分钟后自动解除）。</p>
  </div>
</body>
</html>`;

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
  const xiaogaoService = opts.xiaogaoService;
  const getApiKey = opts.getApiKey || (() => '');
  const nowFn = opts.nowFn || (() => Date.now());
  const fuseDurationMs = opts.fuseDurationMs ?? 15 * 60 * 1000;
  const sessionTtlMs = opts.sessionTtlMs ?? 2 * 60 * 60 * 1000;
  const replayWindowMs = opts.replayWindowMs ?? 60_000;
  const fuseLoopback = Boolean(opts.fuseLoopback);

  const sessions = new Map();
  const fusedIps = new Map(); // ip -> expiresAtMs
  const fusedSids = new Map(); // sid -> expiresAtMs
  const bootstrapRateMap = new Map(); // ip -> { windowStart, count }

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

  function tripFuse(ip, sid, durationMs = fuseDurationMs, banIp = true) {
    const exp = nowFn() + durationMs;
    if (sid && sessions.has(sid)) {
      sessions.delete(sid);
      setBoundedMap(fusedSids, sid, exp, MAX_FUSED_SIDS);
    }
    if (banIp && ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
      setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
    }
  }

  function isRequestFused(req, ip) {
    pruneExpired(true);
    if (ip && fusedIps.has(ip)) return true;
    const cookies = parseCookies(req.headers?.cookie);
    if (cookies.yj_sh_sid === 'fused') return true;
    const sidHeader = String(req.headers?.['x-yj-sid'] || cookies.yj_sh_sid || '');
    if (sidHeader && fusedSids.has(sidHeader)) return true;
    return false;
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

  async function handleRequest(req, res, pathname) {
    pruneExpired(false);

    // 1. Redacted healthcheck + direct loopback deploy status check
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version: '1.2.0',
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

    // 3. Honeypot trap routes -> immediate 30-minute IP fuse!
    if (HONEYPOT_PATHS.has(pathname)) {
      tripFuse(ip, null, 30 * 60 * 1000, true);
      sendHtml(res, 403, FUSED_HTML);
      return true;
    }

    // 4. Fuse check (except fuse report endpoint itself)
    if (pathname !== '/api/security/fuse' && isRequestFused(req, ip)) {
      if (pathname.startsWith('/api/')) {
        sendJson(res, 403, { ok: false, fused: true, error: '当前会话已触发安全熔断保护' });
      } else {
        sendHtml(res, 403, FUSED_HTML);
      }
      return true;
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

    // 6. Client Security Fuse Endpoint (session + cookie fuse only to protect shared office/5G NAT)
    if (pathname === '/api/security/fuse' && req.method === 'POST') {
      const sid = String(req.headers['x-yj-sid'] || '');
      tripFuse(ip, sid || null, fuseDurationMs, false);
      res.setHeader(
        'Set-Cookie',
        'yj_sh_sid=fused; Path=/; HttpOnly; SameSite=Lax; Max-Age=900'
      );
      sendJson(res, 200, { ok: true, fused: true });
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

      const sid = crypto.randomBytes(16).toString('hex');
      const masterKeyBuf = crypto.randomBytes(32);
      const { aesKey, hmacKey } = deriveSessionSubkeys(masterKeyBuf);

      setBoundedMap(
        sessions,
        sid,
        {
          sid,
          aesKey,
          hmacKey,
          createdAt: nowFn(),
          ip,
          seenNonces: new Map(),
          aiAlerts: new Map(),
        },
        MAX_SESSIONS
      );

      const { matches, syncNote } = await ensureMatchesLoaded(false);
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

      res.setHeader(
        'Set-Cookie',
        `yj_sh_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200`
      );
      sendJson(res, 200, {
        ok: true,
        sid,
        k: masterKeyBuf.toString('base64'),
        payload: encryptEnvelope(aesKey, {
          matches,
          syncNote,
          initialPicks,
          workspace,
        }),
      });
      return true;
    }

    // 9. Encrypted Black-Box Quant Workspace Compute
    if (pathname === '/api/quant/compute' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 400_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'quant/compute');
        const { matches } = await ensureMatchesLoaded(false);
        const sessionMatches = mergeSessionAlerts(matches, sess);
        const workspace = evaluateQuantWorkspace(data, sessionMatches);
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, workspace),
        });
      } catch (err) {
        sendJson(res, err.statusCode || 403, {
          ok: false,
          fused: Boolean(err.fused),
          error: '加密信封校验失败或会话已过期',
        });
      }
      return true;
    }

    // 10. Encrypted Live Official Odds Sync
    if (pathname === '/api/quant/sync' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 400_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'quant/sync');
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
        sendJson(res, err.statusCode || 403, {
          ok: false,
          fused: Boolean(err.fused),
          error: '同步校验失败',
        });
      }
      return true;
    }

    // 11. Encrypted Match Diagnosis (verify cryptographic envelope BEFORE checking apiKey!)
    if (pathname === '/api/xiaogao/analyze' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req, 200_000);
        const { sess, data } = verifyAndUnseal(req, body, ip, 'xiaogao/analyze');
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
          payload: encryptEnvelope(sess.aesKey, { alert }),
        });
      } catch (err) {
        sendJson(res, err.statusCode || 502, {
          ok: false,
          fused: Boolean(err.fused),
          error:
            err.statusCode === 401 || err.statusCode === 403
              ? '安全会话已失效'
              : '服务繁忙，请稍后再试',
        });
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
