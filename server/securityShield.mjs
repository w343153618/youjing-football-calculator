import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
  fetchOfficialMatchResultsServer,
  fetchOfficialMatchesServer,
} from "./quantEngine.mjs";
import {
  buildComboDiagnosisContext,
  buildSingleMatchDiagnosisContext,
} from "./xiaogaoCore.mjs";

const AI_AND_SCRAPER_UA_RE =
  /Bytespider|Doubao|TikTokSpider|Baiduspider|Sogou[\s_-]*Spider|Sogou[\s]+web[\s]+spider|SogouInstSpider|YisouSpider|360Spider|Moonshot|Kimi|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|Perplexity|Cohere-ai|Google-Extended|Meta-ExternalAgent|FacebookExternalHit|Amazonbot|Applebot-Extended|Jina|r\.jina\.ai|Firecrawl|Crawl4AI|Diffbot|CCBot|PetalBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|Scrapy|HTTrack|wget\/|curl\/|python-requests|python-httpx|aiohttp|Go-http-client|Java\/|okhttp|axios\/|node-fetch|undici|HeadlessChrome|PhantomJS|SlimerJS|Nightmare|CasperJS|Selenium/i;

const HONEYPOT_PATHS = new Set([
  "/internal-export-trap",
  "/api/v1/export-strategy-dump",
  "/.env",
  "/.env.local",
  "/.git/config",
  "/wp-admin",
  "/source.map",
]);

const MAX_SESSIONS = 4000;
const MAX_FUSED_SIDS = 8000;
const MAX_FUSED_IPS = 10000;
const MAX_FUSED_HW = 8000;
export const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export const ROBOTS_TXT = [
  "# Anti-AI & Anti-Scraper Policy",
  "User-agent: Bytespider",
  "User-agent: Doubao",
  "User-agent: GPTBot",
  "User-agent: ChatGPT-User",
  "User-agent: OAI-SearchBot",
  "User-agent: ClaudeBot",
  "User-agent: Claude-Web",
  "User-agent: anthropic-ai",
  "User-agent: PerplexityBot",
  "User-agent: Perplexity-User",
  "User-agent: Google-Extended",
  "User-agent: Meta-ExternalAgent",
  "User-agent: CCBot",
  "User-agent: Diffbot",
  "User-agent: Jina",
  "User-agent: Firecrawl",
  "User-agent: Scrapy",
  "User-agent: *",
  "Disallow: /",
  "Disallow: /api/",
  "Disallow: /internal-export-trap",
  "",
].join("\n");

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
    .createHash("sha256")
    .update(masterKeyBuf)
    .update(":aes-256-gcm")
    .digest();
  const hmacKey = crypto
    .createHash("sha256")
    .update(masterKeyBuf)
    .update(":hmac-sha256")
    .digest();
  return { aesKey, hmacKey };
}

export function encryptEnvelope(aesKeyBuf, payloadObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKeyBuf, iv);
  const plainBuf = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    d: Buffer.concat([enc, tag]).toString("base64"),
  };
}

export function decryptEnvelope(aesKeyBuf, ivB64, dB64) {
  try {
    const iv = Buffer.from(String(ivB64 || ""), "base64");
    const raw = Buffer.from(String(dB64 || ""), "base64");
    if (iv.length !== 12 || raw.length < 17) {
      throw new Error("Malformed encrypted envelope");
    }
    const enc = raw.subarray(0, raw.length - 16);
    const tag = raw.subarray(raw.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKeyBuf, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString("utf8"));
  } catch {
    const err = new Error("Envelope decryption failed");
    err.statusCode = 403;
    throw err;
  }
}

export function computeEnvelopeHmacHex(
  hmacKeyBuf,
  sid,
  endpoint,
  ts,
  nonce,
  ivB64,
  dB64
) {
  return crypto
    .createHmac("sha256", hmacKeyBuf)
    .update(`${sid}.${endpoint}.${ts}.${nonce}.${ivB64}.${dB64}`)
    .digest("hex");
}

function isLoopbackAddr(addr) {
  const s = String(addr || "");
  return (
    s === "127.0.0.1" ||
    s === "::1" ||
    s === "::ffff:127.0.0.1" ||
    s === "localhost"
  );
}

function isDirectLoopback(req) {
  return (
    isLoopbackAddr(req.socket?.remoteAddress) &&
    !req.headers["x-real-ip"] &&
    !req.headers["x-forwarded-for"]
  );
}

export function extractClientIp(req) {
  const sockIp = req.socket?.remoteAddress || "0.0.0.0";
  if (isLoopbackAddr(sockIp)) {
    const xReal = String(req.headers["x-real-ip"] || "").trim();
    if (xReal) return xReal;
    const xFwdParts = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (xFwdParts.length > 0) return xFwdParts[xFwdParts.length - 1];
  }
  return sockIp;
}

export function isAiReaderOrScraperRequest(req) {
  const ua = String(req.headers["user-agent"] || "").trim();
  if (!ua || ua.length < 12) return true;
  if (AI_AND_SCRAPER_UA_RE.test(ua)) return true;

  const secChUa = String(req.headers["sec-ch-ua"] || "");
  if (/Headless/i.test(secChUa)) return true;

  const headerKeys = Object.keys(req.headers);
  if (
    headerKeys.some(
      (k) =>
        k.startsWith("x-jina-") ||
        k.startsWith("x-firecrawl-") ||
        k.startsWith("x-crawler-") ||
        k === "x-respond-with"
    )
  ) {
    return true;
  }

  const accept = String(req.headers["accept"] || "");
  const acceptLang = String(req.headers["accept-language"] || "");
  const secFetchMode = String(req.headers["sec-fetch-mode"] || "");
  const xReqWith = String(req.headers["x-requested-with"] || "");
  const isOfficialAndroidShell =
    xReqWith === "io.yjty.jisuanqi" &&
    /Android.*AppleWebKit.*YouJingAndroid\//i.test(ua);
  if (
    !isOfficialAndroidShell &&
    !acceptLang &&
    !secFetchMode &&
    accept === "*/*"
  ) {
    return true;
  }

  return false;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const pair of String(cookieHeader).split(";")) {
    const idx = pair.indexOf("=");
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
    req.on("data", (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        settled = true;
        req.destroy?.();
        const err = new Error("Payload too large");
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const raw =
          chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : "";
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error("Malformed JSON payload");
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
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
  const resultsCacheFile = opts.resultsCacheFile || null;
  const banStoreFile = opts.banStoreFile || null;
  const persistDelayMs = opts.persistDelayMs ?? 150;
  const fspImpl = opts.fspImpl || fsp;
  const accountManager = opts.accountManager || null;
  const ledgerManager = opts.ledgerManager || null;
  const manualQaEngine = opts.manualQaEngine || null;
  const xiaogaoService = opts.xiaogaoService;
  const getApiKey = opts.getApiKey || (() => "");
  const nowFn = opts.nowFn || (() => Date.now());
  const fuseDurationMs = opts.fuseDurationMs ?? FORTY_EIGHT_HOURS_MS;
  const sessionTtlMs = opts.sessionTtlMs ?? 2 * 60 * 60 * 1000;
  const replayWindowMs = opts.replayWindowMs ?? 60_000;
  const fuseLoopback = Boolean(opts.fuseLoopback);
  const fetchMatchesFn = opts.fetchMatches || fetchOfficialMatchesServer;
  const fetchResultsFn =
    opts.fetchResults ||
    ((forceRefresh = false) =>
      fetchOfficialMatchResultsServer({
        nowMs: nowFn(),
        cacheFilePath: resultsCacheFile,
        forceRefresh,
      }));

  async function resolveSyncedUserLedger(
    userId,
    liveMatches,
    forceRefresh = false
  ) {
    if (!ledgerManager || !userId) {
      return {
        ledger: undefined,
        newlySettledCount: 0,
        newlySettledTitles: [],
      };
    }
    if (!forceRefresh && !ledgerManager.hasPendingSnapshots?.(userId)) {
      return {
        ledger: ledgerManager.getUserLedger(userId),
        newlySettledCount: 0,
        newlySettledTitles: [],
      };
    }
    try {
      const resultsById = await fetchResultsFn(forceRefresh);
      const settled = ledgerManager.autoSettleUserLedger(userId, {
        resultsById,
        liveMatchesById: liveMatches,
      });
      return {
        ledger: settled.ledger,
        newlySettledCount: settled.newlySettledCount || 0,
        newlySettledTitles: settled.newlySettledTitles || [],
      };
    } catch {
      return {
        ledger: ledgerManager.getUserLedger(userId),
        newlySettledCount: 0,
        newlySettledTitles: [],
      };
    }
  }

  const sessions = new Map();
  const fusedIps = new Map(); // ip -> expiresAtMs (48h whole-computer network ban)
  const fusedHwFps = new Map(); // hwFp -> expiresAtMs (48h cross-browser GPU/screen hardware ban)
  const fusedSids = new Map(); // sid -> expiresAtMs

  // Load persisted 48-hour bans across server restarts
  if (banStoreFile && fs.existsSync(banStoreFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(banStoreFile, "utf8"));
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
    if (!banStoreFile) return;
    const mySeq = ++banPersistSeq;
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      let tmp = null;
      try {
        if (mySeq !== banPersistSeq) return;
        await fspImpl.mkdir(path.dirname(banStoreFile), { recursive: true });
        if (mySeq !== banPersistSeq) return;
        tmp = `${banStoreFile}.tmp.${process.pid}.${Date.now()}.${mySeq}`;
        const data = JSON.stringify({
          ips: [...fusedIps.entries()],
          hwFps: [...fusedHwFps.entries()],
          sids: [...fusedSids.entries()],
        });
        await fspImpl.writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
        if (mySeq !== banPersistSeq) {
          await fspImpl.unlink?.(tmp).catch(() => {});
          return;
        }
        await fspImpl.rename(tmp, banStoreFile);
      } catch {
        if (tmp) {
          await fspImpl.unlink?.(tmp).catch(() => {});
        }
      }
    }, persistDelayMs);
    persistTimer.unref?.();
  }

  const bootstrapRateMap = new Map();

  let cachedMatches = FALLBACK_MATCHES;
  let cachedSyncNote = "已连接体彩实盘快照 · 支持一键刷新官网水位";
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
        const res = await fetchMatchesFn(snapshotFile);
        cachedMatches = res.matches;
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

  function tripFuse(
    ip,
    sid,
    durationMs = fuseDurationMs,
    banIp = true,
    hwFp = null
  ) {
    const exp = nowFn() + durationMs;
    const sess = sid ? sessions.get(sid) : null;
    const resolvedHwFp =
      sess?.hwFp ||
      (typeof hwFp === "string" && /^[0-9a-f]{32,64}$/i.test(hwFp)
        ? hwFp
        : null);

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
    const sidHeader = String(
      req.headers?.["x-yj-sid"] || cookies.yj_sh_sid || ""
    );
    if (sidHeader && fusedSids.has(sidHeader)) {
      const exp = fusedSids.get(sidHeader);
      if (exp > now) return exp;
      fusedSids.delete(sidHeader);
    }
    if (cookies.yj_sh_sid === "fused") return now + fuseDurationMs;
    const hwHeader = String(req.headers?.["x-yj-hw"] || "").toLowerCase();
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
      setBoundedMap(
        bootstrapRateMap,
        ip,
        { windowStart: now, count: 1 },
        MAX_FUSED_IPS
      );
      return true;
    }
    cur.count += 1;
    return cur.count <= 80;
  }

  function verifyAndUnseal(req, body, ip, endpoint) {
    const sid = String(req.headers["x-yj-sid"] || "");
    const tsStr = String(req.headers["x-yj-ts"] || "");
    const nonce = String(req.headers["x-yj-nonce"] || "");
    const sig = String(req.headers["x-yj-sig"] || "");

    if (
      !/^[0-9a-f]{32}$/i.test(sid) ||
      !tsStr ||
      !/^[0-9a-f]{32}$/i.test(nonce) ||
      !/^[0-9a-f]{64}$/i.test(sig)
    ) {
      const err = new Error("Invalid cryptographic envelope headers");
      err.statusCode = 401;
      throw err;
    }

    const sess = sessions.get(sid);
    if (!sess) {
      const err = new Error("Session expired or invalid");
      err.statusCode = 401;
      err.sessionExpired = true;
      throw err;
    }

    const now = nowFn();
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > replayWindowMs) {
      const err = new Error("Envelope timestamp outside allowed window");
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
      const err = new Error("Replay attack detected — session fused");
      err.statusCode = 403;
      err.fused = true;
      throw err;
    }

    const ivB64 = String(body?.iv || "");
    const dB64 = String(body?.d || "");
    const expectedSig = computeEnvelopeHmacHex(
      sess.hmacKey,
      sid,
      endpoint,
      tsStr,
      nonce,
      ivB64,
      dB64
    );

    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== 32 || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      tripFuse(ip, sid, fuseDurationMs, true);
      const err = new Error("Envelope signature mismatch — session fused");
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
      String(req.headers?.["x-forwarded-proto"] || "").toLowerCase() ===
        "https" || Boolean(req.socket?.encrypted);
    return `; Path=/; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}; Max-Age=${maxAgeSec}`;
  }

  function deriveFallbackClientFp(req, ip) {
    return crypto
      .createHash("sha256")
      .update(`fb:${ip}:${String(req.headers?.["user-agent"] || "")}`)
      .digest("hex")
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
    const hdr = String(req.headers?.["x-yj-auth"] || "").trim();
    if (hdr) return hdr;
    const cookies = parseCookies(req.headers?.cookie);
    if (cookies.yj_auth_tok) return cookies.yj_auth_tok;
    return sess?.authToken || "";
  }

  function requireSessionAuth(req, sess, ip) {
    if (!accountManager) {
      return { user: null };
    }
    const rawToken = extractAuthToken(req, sess);
    const authRes = accountManager.verifyAuthTokenDetailed(
      rawToken,
      sess?.hwFp,
      ip
    );
    if (!authRes.ok) {
      const err = new Error(authRes.error || "请先登录授权账号");
      err.statusCode =
        authRes.code === "AUTH_MISSING" || authRes.code === "AUTH_REVOKED"
          ? 401
          : 403;
      err.authRequired = true;
      err.authCode = authRes.code;
      err.authError = authRes.error;
      throw err;
    }
    sess.authToken = rawToken;
    return { user: authRes.user };
  }

  function sendGatewayCatchError(
    res,
    err,
    fallbackMsg = "加密信封校验失败或会话已过期"
  ) {
    if (err?.authRequired) {
      sendJson(res, err.statusCode || 401, {
        ok: false,
        authRequired: true,
        authCode: err.authCode || "AUTH_REVOKED",
        error: err.authError || err.message || "登录已失效，请重新登录",
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
    const initialPicks = [];
    const workspace = evaluateQuantWorkspace(
      {
        picks: initialPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: matches.slice(0, 2).map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    );
    return { matches, syncNote, initialPicks, workspace };
  }

  /**
   * 统一加密信封路由管线（集中收拢：大小限制读取 -> AES-GCM/HMAC 防重放验签拆封 -> 会话/角色鉴权 -> 自动加密回封 -> 统一异常映射）
   */
  async function runEncryptedRoute(
    req,
    res,
    ip,
    {
      endpoint,
      maxBodyBytes = 64_000,
      requireAuth = false,
      requireSuperAdmin = false,
      fallbackError = "加密信封校验失败或会话已过期",
      onDomainError = null,
    },
    handler
  ) {
    let sess;
    let data;
    let authCtx;
    try {
      const body = await readJsonBody(req, maxBodyBytes);
      const unsealed = verifyAndUnseal(req, body, ip, endpoint);
      sess = unsealed.sess;
      data = unsealed.data;
      authCtx =
        requireAuth || requireSuperAdmin
          ? requireSessionAuth(req, sess, ip)
          : { user: null };
      if (
        requireSuperAdmin &&
        (!authCtx.user || authCtx.user.role !== "superadmin")
      ) {
        sendJson(res, 403, { ok: false, error: "无权访问该资源" });
        return true;
      }
    } catch (err) {
      sendGatewayCatchError(res, err, fallbackError);
      return true;
    }

    try {
      const outcome = await handler({ sess, data, user: authCtx.user });
      if (outcome && outcome.__handled) {
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        payload: encryptEnvelope(sess.aesKey, outcome),
      });
    } catch (err) {
      if (onDomainError) {
        onDomainError(err);
      } else {
        sendGatewayCatchError(res, err, fallbackError);
      }
    }
    return true;
  }

  async function handleRequest(req, res, pathname) {
    pruneExpired(false);

    // 1. Redacted healthcheck + direct loopback deploy status check
    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        version: "2.6.0",
        uptimeSec: Math.round(process.uptime()),
      });
      return true;
    }

    if (
      pathname === "/api/xiaogao/status" &&
      req.method === "GET" &&
      isDirectLoopback(req)
    ) {
      const apiKey = getApiKey();
      sendJson(
        res,
        200,
        xiaogaoService
          ? xiaogaoService.getPublicStatus(Boolean(apiKey))
          : {
              ok: true,
              configured: Boolean(apiKey),
              channel: "primary",
              degraded: false,
            }
      );
      return true;
    }

    // 2. Robots.txt anti-AI declaration
    if (pathname === "/robots.txt" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
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
    if (pathname !== "/api/security/fuse") {
      const fusedExp = getFusedExpiry(req, ip);
      if (fusedExp !== null) {
        const remMs = Math.max(60_000, fusedExp - nowFn());
        if (pathname.startsWith("/api/")) {
          sendJson(res, 403, {
            ok: false,
            fused: true,
            unlockAt: fusedExp,
            error: "熔断天平已触发：当前设备与网络已被锁定 48 小时",
          });
        } else {
          sendHtml(res, 403, renderFusedHtml(remMs));
        }
        return true;
      }
    }

    // 5. Anti-AI-Reader / Anti-Scraper Decoy & Asset Shield
    if (isAiReaderOrScraperRequest(req)) {
      if (pathname.startsWith("/api/")) {
        sendJson(res, 403, { ok: false, error: "Automated access denied" });
        return true;
      }
      if (
        pathname.endsWith(".js") ||
        pathname.endsWith(".mjs") ||
        pathname.endsWith(".css") ||
        pathname.endsWith(".map")
      ) {
        res.statusCode = 403;
        res.end("Forbidden");
        return true;
      }
      sendHtml(res, 200, DECOY_HTML);
      return true;
    }

    // 6. High-Pressure 48-Hour Whole-Computer Fuse Endpoint (locks IP + Hardware GPU/Screen Fingerprint + Session + 48h Cookie!)
    if (pathname === "/api/security/fuse" && req.method === "POST") {
      let fuseBody = {};
      try {
        fuseBody = await readJsonBody(req, 16_000);
      } catch {
        // ignore
      }
      const sid = String(req.headers["x-yj-sid"] || "");
      const sess = sid ? sessions.get(sid) : null;
      const isGenericMobileUa = /iPhone|iPad|Android/i.test(
        String(req.headers["user-agent"] || "")
      );
      // Prevent unauthenticated hwFp spoofing DoS: require matching session IP, and on generic mobile UA require authenticated session
      const canBanHwFp =
        sess &&
        sess.ip === ip &&
        (Boolean(sess.authToken) || !isGenericMobileUa);
      const verifiedHwFp = canBanHwFp
        ? sess.hwFp ||
          (typeof fuseBody?.hwFp === "string"
            ? fuseBody.hwFp.toLowerCase()
            : null)
        : null;
      const unlockAt = tripFuse(
        ip,
        sid || null,
        fuseDurationMs,
        true,
        verifiedHwFp
      );
      res.setHeader(
        "Set-Cookie",
        `yj_sh_sid=fused${cookieSuffix(req, 172800)}`
      );
      sendJson(res, 200, { ok: true, fused: true, unlockAt });
      return true;
    }

    // 7. Browser-verified status endpoint
    if (pathname === "/api/xiaogao/status" && req.method === "GET") {
      const apiKey = getApiKey();
      sendJson(
        res,
        200,
        xiaogaoService
          ? xiaogaoService.getPublicStatus(Boolean(apiKey))
          : {
              ok: true,
              configured: Boolean(apiKey),
              channel: "primary",
              degraded: false,
            }
      );
      return true;
    }

    // 8. Ephemeral Session Bootstrap + Initial Encrypted Workspace
    if (pathname === "/api/security/bootstrap" && req.method === "POST") {
      if (!checkBootstrapRateLimit(ip)) {
        sendJson(res, 429, { ok: false, error: "请求过于频繁，请稍后再试" });
        return true;
      }
      let body;
      try {
        body = await readJsonBody(req, 32_000);
      } catch (err) {
        sendJson(res, err.statusCode || 400, {
          ok: false,
          error: "Invalid request body",
        });
        return true;
      }
      if (!body || body.v !== 1 || typeof body.tz !== "string") {
        sendJson(res, 400, { ok: false, error: "Invalid client handshake" });
        return true;
      }

      const rawHwFp =
        typeof body.hwFp === "string" && /^[0-9a-f]{32,64}$/i.test(body.hwFp)
          ? body.hwFp.toLowerCase()
          : null;
      if (rawHwFp && fusedHwFps.has(rawHwFp)) {
        const exp = fusedHwFps.get(rawHwFp);
        // Contagious cross-browser & cross-IP ban: lock new IP/profile too!
        if (ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
          setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
          schedulePersistBans();
        }
        res.setHeader(
          "Set-Cookie",
          `yj_sh_sid=fused${cookieSuffix(req, 172800)}`
        );
        sendJson(res, 403, {
          ok: false,
          fused: true,
          unlockAt: exp,
          error: "熔断天平已触发：当前电脑硬件指纹处于 48 小时封禁期",
        });
        return true;
      }

      const sid = crypto.randomBytes(16).toString("hex");
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
        res.setHeader("Set-Cookie", cookiesOut);
        sendJson(res, 200, {
          ok: true,
          sid,
          k: masterKeyBuf.toString("base64"),
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
        cookiesOut.push(
          `yj_auth_tok=${rawAuthToken}${cookieSuffix(req, 31536000)}`
        );
      }
      res.setHeader("Set-Cookie", cookiesOut);
      const syncedBootstrapLedger =
        accountManager && authRes.user?.id
          ? await resolveSyncedUserLedger(authRes.user.id, matches, false)
          : { ledger: undefined, newlySettledCount: 0, newlySettledTitles: [] };

      sendJson(res, 200, {
        ok: true,
        sid,
        k: masterKeyBuf.toString("base64"),
        payload: encryptEnvelope(
          aesKey,
          accountManager
            ? {
                authenticated: true,
                user: authRes.user,
                authToken: rawAuthToken,
                ledger: syncedBootstrapLedger.ledger,
                newlySettledCount: syncedBootstrapLedger.newlySettledCount,
                ...bundle,
              }
            : bundle
        ),
      });
      return true;
    }

    // 8b. Encrypted Member & Super-Admin Login (/api/auth/login)
    if (pathname === "/api/auth/login" && req.method === "POST") {
      if (!accountManager) {
        sendJson(res, 404, { ok: false, error: "Auth service not enabled" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "auth/login",
          maxBodyBytes: 32_000,
          fallbackError: "登录安全校验失败，请刷新重试",
        },
        async ({ sess, data }) => {
          const effectiveHwFp =
            sess.hwFp ||
            (typeof data?.hwFp === "string" &&
            /^[0-9a-f]{32,64}$/i.test(data.hwFp)
              ? data.hwFp.toLowerCase()
              : null);
          if (effectiveHwFp) sess.hwFp = effectiveHwFp;
          const bindFp =
            effectiveHwFp ||
            sess.deviceBindFp ||
            deriveFallbackClientFp(req, ip);
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
              error: "熔断天平已触发：当前电脑硬件指纹处于 48 小时封禁期",
            });
            return { __handled: true };
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
            return { __handled: true };
          }

          sess.authToken = loginRes.authToken;
          const { matches, syncNote } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          const bundle = buildInitialWorkspaceBundle(sessionMatches, syncNote);

          const syncedLoginLedger = loginRes.user?.id
            ? await resolveSyncedUserLedger(
                loginRes.user.id,
                sessionMatches,
                false
              )
            : { ledger: undefined, newlySettledCount: 0 };

          res.setHeader(
            "Set-Cookie",
            `yj_auth_tok=${loginRes.authToken}${cookieSuffix(req, 31536000)}`
          );
          return {
            authenticated: true,
            user: loginRes.user,
            authToken: loginRes.authToken,
            ledger: syncedLoginLedger.ledger,
            newlySettledCount: syncedLoginLedger.newlySettledCount,
            ...bundle,
          };
        }
      );
    }

    // 8c. Encrypted Explicit Logout (/api/auth/logout)
    if (pathname === "/api/auth/logout" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "auth/logout",
          maxBodyBytes: 16_000,
          fallbackError: "退出操作异常",
        },
        async ({ sess }) => {
          sess.authToken = null;
          res.setHeader("Set-Cookie", `yj_auth_tok=${cookieSuffix(req, 0)}`);
          return { loggedOut: true };
        }
      );
    }

    // 8d. Encrypted Route-C Hybrid Iron-Cage Manual Q&A (/api/manual/ask)
    if (pathname === "/api/manual/ask" && req.method === "POST") {
      if (!manualQaEngine || !accountManager) {
        sendJson(res, 404, { ok: false, error: "Manual QA not enabled" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "manual/ask",
          maxBodyBytes: 32_000,
          requireAuth: true,
          fallbackError: "说明书助手繁忙，请稍后再试",
        },
        async ({ sess, data, user }) => {
          const qaRes = await manualQaEngine.answerManualQuestion({
            userId: user.id,
            question: data?.question,
            ip,
          });

          if (qaRes.accountLocked) {
            const unlockAt = tripFuse(
              ip,
              sess.sid,
              fuseDurationMs,
              true,
              sess.hwFp
            );
            res.setHeader("Set-Cookie", [
              "yj_auth_tok=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
              "yj_sh_sid=fused; Path=/; HttpOnly; SameSite=Lax; Max-Age=172800",
            ]);
            sendJson(res, 403, {
              ok: false,
              accountLocked: true,
              fused: true,
              unlockAt,
              error: qaRes.error,
            });
            return { __handled: true };
          }

          if (!qaRes.ok) {
            sendJson(res, qaRes.statusCode || 400, {
              ok: false,
              error: qaRes.error,
            });
            return { __handled: true };
          }

          return qaRes;
        }
      );
    }

    // 8e. Encrypted Hidden Super-Admin RBAC Console Endpoints (/api/admin/*)
    if (pathname.startsWith("/api/admin/") && req.method === "POST") {
      if (!accountManager) {
        sendJson(res, 404, { ok: false, error: "Admin service not enabled" });
        return true;
      }
      const subEndpoint = pathname.slice("/api/".length);
      if (
        ![
          "admin/overview",
          "admin/create-user",
          "admin/update-user",
          "admin/delete-user",
        ].includes(subEndpoint)
      ) {
        sendJson(res, 404, { ok: false, error: "Admin endpoint not found" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: subEndpoint,
          maxBodyBytes: 64_000,
          requireSuperAdmin: true,
          fallbackError: "管理操作鉴权失败",
          onDomainError: (err) => {
            const msg = String(err?.message || "");
            const safeMsg = /[\u4e00-\u9fff]/.test(msg) ? msg : "管理操作失败";
            sendJson(res, 400, { ok: false, error: safeMsg });
          },
        },
        async ({ sess, data, user }) => {
          if (subEndpoint === "admin/overview") {
            return {
              accounts: accountManager.listAccounts(),
              auditLogs: accountManager.listAuditLogs(),
              fusedIpsCount: fusedIps.size,
              fusedHwCount: fusedHwFps.size,
            };
          }
          if (subEndpoint === "admin/create-user") {
            return accountManager.createAccount(data || {});
          }
          if (subEndpoint === "admin/update-user") {
            const updated = accountManager.updateAccount(
              data?.userId,
              data || {}
            );
            if (updated.freshAuthToken && data?.userId === user.id) {
              sess.authToken = updated.freshAuthToken;
              res.setHeader(
                "Set-Cookie",
                `yj_auth_tok=${updated.freshAuthToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`
              );
            }
            return {
              user: updated.user,
              newPassword: updated.newPassword,
              selfAuthToken:
                data?.userId === user.id ? updated.freshAuthToken : undefined,
            };
          }
          const delRes = accountManager.deleteAccount(data?.userId);
          if (delRes?.ok && ledgerManager && data?.userId) {
            ledgerManager.deleteUserLedger(String(data.userId));
          }
          return delRes;
        }
      );
    }

    // 8f. Encrypted Personal Dual-Track Stop-Loss Ledger (/api/ledger/mutate)
    if (pathname === "/api/ledger/mutate" && req.method === "POST") {
      if (!ledgerManager || !accountManager) {
        sendJson(res, 404, { ok: false, error: "账本服务暂未启用" });
        return true;
      }
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "ledger/mutate",
          maxBodyBytes: 256_000,
          requireAuth: true,
          fallbackError: "账本安全校验失败或会话已过期",
          onDomainError: (err) => {
            const msg = String(err?.message || "");
            const safeMsg = /[\u4e00-\u9fff]/.test(msg)
              ? msg
              : "账本操作参数无效";
            sendJson(res, 400, { ok: false, error: safeMsg });
          },
        },
        async ({ sess, data, user }) => {
          const act = String(data?.action || "");
          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);

          if (act === "auto-settle") {
            const synced = await resolveSyncedUserLedger(
              user.id,
              sessionMatches,
              Boolean(data?.forceRefresh)
            );
            return {
              ok: true,
              newlySettledCount: synced.newlySettledCount,
              newlySettledTitles: synced.newlySettledTitles,
              ledger: synced.ledger,
            };
          }

          let payloadToMutate = data || {};
          let trustedServerSnapshot = false;

          if (act === "add-entry" && data?.workspaceParams) {
            const cleanWsParams = {
              ...data.workspaceParams,
              simVoidFirstMatch: false,
              subjectiveDeltaPct: 0,
            };
            const ws = evaluateQuantWorkspace(cleanWsParams, sessionMatches);
            const effRep = ws.effectiveReport;
            const appPlan =
              cleanWsParams.planSpec || effRep.syntheticAutoMounted
                ? ws.appliedPlan
                : null;
            if (effRep.canCheckout && effRep.totalCost > 0) {
              const bankerSet = new Set(
                effRep.bankerMatchIds ??
                  ws.manualReport.bankerMatchIds ??
                  cleanWsParams.passSpec?.bankerMatchIds ??
                  []
              );
              const matchById = new Map(sessionMatches.map((m) => [m.id, m]));
              const builtLines =
                effRep.betCount <= 512
                  ? appPlan
                    ? appPlan.lines.map((ln, idx) => ({
                        id: ln.id || `ap_${idx + 1}`,
                        modeLabel: ln.modeLabel,
                        multiple: Math.max(1, Math.round(ln.multiple || 1)),
                        legs: ln.legs.map((lg) => {
                          const m = matchById.get(lg.matchId);
                          const opt = m?.pools?.[lg.poolCode]?.options?.find(
                            (o) => o.key === lg.optionKey
                          );
                          return {
                            matchId: lg.matchId,
                            matchNumStr: lg.matchNumStr || m?.matchNumStr,
                            home: lg.home || m?.home,
                            away: lg.away || m?.away,
                            kickoff: lg.kickoff || m?.kickoff,
                            poolCode: lg.poolCode,
                            optionKey: lg.optionKey,
                            optionLabel: opt?.label || lg.optionLabel,
                            odds: opt?.odds ?? lg.odds,
                            goalLine: m?.pools?.HHAD?.goalLine ?? "-1",
                          };
                        }),
                      }))
                    : (effRep.tickets || []).map((tk, idx) => {
                        const legs = tk.legs || [];
                        const passTxt =
                          legs.length === 1
                            ? "单关"
                            : `${legs.length}串1${
                                bankerSet.size > 0
                                  ? `(${bankerSet.size}胆)`
                                  : ""
                              }`;
                        return {
                          id: tk.id || `tk_${idx + 1}`,
                          modeLabel: passTxt,
                          multiple: Math.max(
                            1,
                            Math.round(
                              Number(tk.multiple ?? cleanWsParams.multiple) || 1
                            )
                          ),
                          legs: legs.map((lg) => {
                            const m = matchById.get(lg.matchId);
                            const opt = m?.pools?.[lg.poolCode]?.options?.find(
                              (o) => o.key === lg.optionKey
                            );
                            return {
                              matchId: lg.matchId,
                              matchNumStr: lg.matchNumStr || m?.matchNumStr,
                              home: lg.home || m?.home,
                              away: lg.away || m?.away,
                              kickoff: m?.kickoff,
                              poolCode: lg.poolCode,
                              optionKey: lg.optionKey,
                              optionLabel: opt?.label || lg.optionLabel,
                              odds: opt?.odds ?? lg.odds,
                              goalLine: m?.pools?.HHAD?.goalLine ?? "-1",
                            };
                          }),
                        };
                      })
                  : [];

              payloadToMutate = {
                ...payloadToMutate,
                betCount: Math.max(1, effRep.betCount),
                cost: payloadToMutate.kind === "live" ? effRep.totalCost : 0,
                paperRefCost:
                  payloadToMutate.kind === "paper"
                    ? effRep.totalCost
                    : undefined,
                minPayout: effRep.minPayout,
                maxPayout: effRep.maxPayout,
                snapshot:
                  builtLines.length > 0 && builtLines.length <= 512
                    ? {
                        matches: (data.snapshot?.matches || []).map((sm) => ({
                          ...sm,
                          isBanker: bankerSet.has(String(sm?.matchId || "")),
                        })),
                        lines: builtLines,
                      }
                    : undefined,
              };
              trustedServerSnapshot = builtLines.length > 0;
            }
          }

          const mutated = ledgerManager.mutateUserLedger(
            user.id,
            payloadToMutate,
            {
              authoritativeMatches: sessionMatches,
              trustedServerSnapshot,
            }
          );

          const shouldAutoSyncNow =
            mutated.ok &&
            (act === "add-entry" ||
              (act === "settle-entry" && data?.status === "pending")) &&
            ledgerManager.hasPendingSnapshots?.(user.id);

          if (shouldAutoSyncNow) {
            const synced = await resolveSyncedUserLedger(
              user.id,
              sessionMatches,
              false
            );
            return {
              ...mutated,
              ledger: synced.ledger,
              newlySettledCount: synced.newlySettledCount,
            };
          }
          return mutated;
        }
      );
    }

    // 9. Encrypted Black-Box Quant Workspace Compute
    if (pathname === "/api/quant/compute" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "quant/compute",
          maxBodyBytes: 400_000,
          requireAuth: true,
          fallbackError: "加密信封校验失败或会话已过期",
        },
        async ({ sess, data }) => {
          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          return evaluateQuantWorkspace(data, sessionMatches);
        }
      );
    }

    // 10. Encrypted Live Official Odds Sync
    if (pathname === "/api/quant/sync" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "quant/sync",
          maxBodyBytes: 400_000,
          requireAuth: true,
          fallbackError: "同步校验失败",
        },
        async ({ sess, data, user }) => {
          const { matches, syncNote } = await ensureMatchesLoaded(true);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          const workspace = evaluateQuantWorkspace(
            data?.workspaceParams || {},
            sessionMatches
          );
          const syncedLedger = user?.id
            ? await resolveSyncedUserLedger(user.id, sessionMatches, true)
            : { ledger: undefined, newlySettledCount: 0 };
          return {
            matches: sessionMatches,
            syncNote,
            workspace,
            ledger: syncedLedger.ledger,
            newlySettledCount: syncedLedger.newlySettledCount,
          };
        }
      );
    }

    // 11. Encrypted Match Diagnosis (server builds authoritative odds/vig/xG context from matchId)
    if (pathname === "/api/xiaogao/analyze" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "xiaogao/analyze",
          maxBodyBytes: 200_000,
          requireAuth: true,
          fallbackError: "安全会话已失效",
          onDomainError: (err) => {
            sendJson(res, err?.statusCode || 502, {
              ok: false,
              error: "服务繁忙，请稍后再试",
            });
          },
        },
        async ({ sess, data, user }) => {
          const apiKey = getApiKey();
          if (!apiKey || !xiaogaoService) {
            sendJson(res, 500, { ok: false, error: "服务暂未就绪" });
            return { __handled: true };
          }

          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);
          const targetMatch = sessionMatches.find(
            (m) => m.id === String(data?.matchId || "")
          );
          if (!targetMatch) {
            sendJson(res, 400, { ok: false, error: "未找到指定赛事盘口" });
            return { __handled: true };
          }
          const reqCtx = buildSingleMatchDiagnosisContext(
            targetMatch,
            data?.userNote
          );

          const qCheck = consumeUserAiQuota(user, res);
          if (!qCheck.ok) return { __handled: true };

          const alert = await xiaogaoService.analyzeMatch(apiKey, reqCtx);
          setBoundedMap(sess.aiAlerts, String(targetMatch.id), alert, 32);
          return { alert, aiRemaining: qCheck.remaining };
        }
      );
    }

    // 12. Encrypted Multi-Match Joint Parlay Diagnosis (server resolves matches & parlay report)
    if (pathname === "/api/xiaogao/analyze-combo" && req.method === "POST") {
      return runEncryptedRoute(
        req,
        res,
        ip,
        {
          endpoint: "xiaogao/analyze-combo",
          maxBodyBytes: 350_000,
          requireAuth: true,
          fallbackError: "安全会话已失效",
          onDomainError: (err) => {
            sendJson(res, err?.statusCode || 502, {
              ok: false,
              error: "服务繁忙，请稍后再试",
            });
          },
        },
        async ({ sess, data, user }) => {
          const apiKey = getApiKey();
          if (!apiKey || !xiaogaoService?.analyzeComboMatches) {
            sendJson(res, 500, { ok: false, error: "服务暂未就绪" });
            return { __handled: true };
          }

          const { matches } = await ensureMatchesLoaded(false);
          const sessionMatches = mergeSessionAlerts(matches, sess);

          const rawIds = Array.isArray(data?.matchIds) ? data.matchIds : [];
          const idSet = new Set(rawIds.filter(Boolean).map((x) => String(x)));
          const targetMatches = sessionMatches
            .filter((m) => idSet.has(m.id))
            .slice(0, 8);
          if (targetMatches.length < 2) {
            sendJson(res, 400, {
              ok: false,
              error: "请至少选择 2 场比赛再发起多场联合会诊",
            });
            return { __handled: true };
          }
          const sourceMode =
            data?.sourceMode === "custom" ? "custom" : "picked";
          const ws =
            sourceMode === "picked"
              ? evaluateQuantWorkspace(
                  {
                    picks: Array.isArray(data?.picks) ? data.picks : [],
                    multiple: data?.multiple ?? 5,
                    passSpec: data?.passSpec ?? { mode: "auto" },
                    syntheticSingleMode: data?.syntheticSingleMode,
                    planSpec: data?.planSpec ?? null,
                    subjectiveDeltaPct: Number(data?.subjectiveDeltaPct) || 0,
                    simVoidFirstMatch: Boolean(data?.simVoidFirstMatch),
                    targetIds: targetMatches.map((m) => m.id),
                    anchorToRadarPicks: Boolean(data?.anchorToRadarPicks),
                    budget: Number(data?.budget) || 100,
                    stance:
                      data?.stance === "home-lean" ||
                      data?.stance === "upset-watch"
                        ? data.stance
                        : "objective",
                    unlockFullAgg: Boolean(data?.unlockFullAgg),
                  },
                  sessionMatches
                )
              : null;
          const comboCtx = buildComboDiagnosisContext({
            sourceMode,
            targetMatches,
            picks: Array.isArray(data?.picks) ? data.picks : [],
            effectiveReport: ws?.effectiveReport ?? null,
            appliedPlan: ws?.appliedPlan ?? null,
            planSpec: data?.planSpec ?? null,
            insights: ws?.insights ?? null,
            userNote: data?.userNote,
          });

          const qCheck = consumeUserAiQuota(user, res);
          if (!qCheck.ok) return { __handled: true };

          const comboReport = await xiaogaoService.analyzeComboMatches(
            apiKey,
            comboCtx
          );
          if (Array.isArray(comboReport?.perMatch)) {
            for (const pm of comboReport.perMatch) {
              const matchedCanonical = sessionMatches.find(
                (cm) =>
                  cm.id === pm?.matchId ||
                  (Boolean(cm.matchNumStr) && cm.matchNumStr === pm?.matchId) ||
                  Boolean(
                    cm.matchNumStr &&
                    pm?.matchTitle &&
                    pm.matchTitle.includes(cm.matchNumStr)
                  )
              );
              const canonicalId = matchedCanonical?.id || pm?.matchId;
              if (canonicalId) {
                setBoundedMap(
                  sess.aiAlerts,
                  String(canonicalId),
                  {
                    level: comboReport.level === "high" ? "high" : "medium",
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
          return { comboReport, aiRemaining: qCheck.remaining };
        }
      );
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
