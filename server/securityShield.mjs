import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createAppRoutes } from "./appRoutes.mjs";

const AI_AND_SCRAPER_UA_RE =
  /Bytespider|Doubao|TikTokSpider|Baiduspider|Sogou[\s_-]*Spider|Sogou[\s]+web[\s]+spider|SogouInstSpider|YisouSpider|360Spider|Moonshot|Kimi|GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-Web|anthropic-ai|Perplexity|Cohere-ai|Google-Extended|Meta-ExternalAgent|FacebookExternalHit|Amazonbot|Applebot-Extended|Jina|r\.jina\.ai|Firecrawl|Crawl4AI|Diffbot|CCBot|PetalBot|SemrushBot|AhrefsBot|MJ12bot|DotBot|Scrapy|HTTrack|wget\/|curl\/|python-requests|python-httpx|aiohttp|Go-http-client|Java\/|okhttp|axios\/|node-fetch|undici|HeadlessChrome|PhantomJS|SlimerJS|Nightmare|CasperJS|Selenium/i;

const HONEYPOT_PATH_RE =
  /^\/(?:internal-export-trap|api\/v1\/export-strategy-dump|\.env(?:\.local)?|\.git\/config|wp-admin|source\.map)$/;
const LOOPBACK_RE = /^(?:127\.0\.0\.1|::1|::ffff:127\.0\.0\.1|localhost)$/;

const MAX_SESSIONS = 4000;
const MAX_FUSED_SIDS = 8000;
const MAX_FUSED_IPS = 10000;
const MAX_FUSED_HW = 8000;
export const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export const ROBOTS_TXT = [
  "# Anti-AI & Anti-Scraper Policy",
  ..."Bytespider,Doubao,GPTBot,ChatGPT-User,OAI-SearchBot,ClaudeBot,Claude-Web,anthropic-ai,PerplexityBot,Perplexity-User,Google-Extended,Meta-ExternalAgent,CCBot,Diffbot,Jina,Firecrawl,Scrapy,*"
    .split(",")
    .map((u) => `User-agent: ${u}`),
  "Disallow: /",
  "Disallow: /api/",
  "Disallow: /internal-export-trap",
  "",
].join("\n");

export const DECOY_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" /><title>公开足球联赛标准赛程时区换算与基础积分规则参考</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.7}h1{font-size:20px;border-bottom:1px solid #e2e8f0;padding-bottom:10px}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}th,td{border:1px solid #cbd5e1;padding:8px 12px;text-align:left}th{background:#f8fafc}</style></head><body><h1>公开足球联赛标准时区换算与 3/1/0 积分统计表</h1><p>本静态工具页仅用于日常国际联赛 UTC 标准时间与北京时间（UTC+8）换算，以及常规联赛积分榜（胜计 3 分、平计 1 分、负计 0 分）基础加总核对，不包含任何赔率测算或数据模型功能。</p><table><thead><tr><th>赛区标准时</th><th>夏令时换算（UTC+8）</th><th>冬令时换算（UTC+8）</th></tr></thead><tbody><tr><td>英国伦敦 (GMT/BST)</td><td>+7 小时</td><td>+8 小时</td></tr><tr><td>中欧时间 (CET/CEST)</td><td>+6 小时</td><td>+7 小时</td></tr><tr><td>南美巴西利亚 (BRT)</td><td>+11 小时</td><td>+11 小时</td></tr></tbody></table><p style="font-size:12px;color:#64748b;">静态参考文档 · 无交互式脚本与外部接口</p></body></html>`;

export function renderFusedHtml(remainingMs = FORTY_EIGHT_HOURS_MS) {
  const safeRem = Math.max(60_000, remainingMs);
  const hrs = Math.floor(safeRem / 3_600_000);
  const mins = Math.ceil((safeRem % 3_600_000) / 60_000);
  const timeText = hrs > 0 ? `${hrs} 小时 ${mins % 60} 分钟` : `${mins} 分钟`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>访问阻断 · 熔断天平 48 小时整机锁定中</title><style>body{background:#070a12;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center;user-select:none}.box{max-width:450px;padding:30px 26px;border-radius:20px;background:rgba(15,23,42,0.88);border:1px solid rgba(239,68,68,0.5);box-shadow:0 28px 70px rgba(0,0,0,0.75)}.ico{font-size:34px;margin-bottom:10px}h2{margin:0 0 10px;font-size:18px;color:#f87171;letter-spacing:-0.01em}.cd{display:inline-block;margin:10px 0 12px;padding:5px 14px;border-radius:99px;background:rgba(239,68,68,0.16);color:#fca5a5;font-size:12.5px;font-weight:600;border:1px solid rgba(239,68,68,0.32)}p{margin:0;font-size:12.5px;color:#94a3b8;line-height:1.65}</style></head><body><div class="box"><div class="ico">⚖️</div><h2>安全熔断天平已触发 · 整机全浏览器封禁 48 小时</h2><div class="cd">剩余锁定时长：${timeText}</div><p>系统检测到开发者调试工具探测、抓包重放或逆向抓取行为，已同步锁定当前硬件设备指纹、网络出口与全部浏览器会话，更换浏览器或无痕模式均无法解除。</p></div></body></html>`;
}

export const FUSED_HTML = renderFusedHtml(FORTY_EIGHT_HOURS_MS);

function httpErr(message, statusCode, extra) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function normalizeHwFp(val) {
  return typeof val === "string" && /^[0-9a-f]{32,64}$/i.test(val)
    ? val.toLowerCase()
    : null;
}

export function deriveSessionSubkeys(masterKeyBuf) {
  const derive = (tag) =>
    crypto.createHash("sha256").update(masterKeyBuf).update(tag).digest();
  return { aesKey: derive(":aes-256-gcm"), hmacKey: derive(":hmac-sha256") };
}

export function encryptEnvelope(aesKeyBuf, payloadObj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKeyBuf, iv);
  const plainBuf = Buffer.from(JSON.stringify(payloadObj), "utf8");
  const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    d: Buffer.concat([enc, cipher.getAuthTag()]).toString("base64"),
  };
}

export function decryptEnvelope(aesKeyBuf, ivB64, dB64) {
  try {
    const iv = Buffer.from(String(ivB64 || ""), "base64");
    const raw = Buffer.from(String(dB64 || ""), "base64");
    if (iv.length !== 12 || raw.length < 17) throw new Error("Bad envelope");
    const decipher = crypto.createDecipheriv("aes-256-gcm", aesKeyBuf, iv, {
      authTagLength: 16,
    });
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const dec = Buffer.concat([
      decipher.update(raw.subarray(0, raw.length - 16)),
      decipher.final(),
    ]);
    return JSON.parse(dec.toString("utf8"));
  } catch {
    throw httpErr("Envelope decryption failed", 403);
  }
}

export function computeEnvelopeHmacHex(hmacKeyBuf, ...parts) {
  return crypto
    .createHmac("sha256", hmacKeyBuf)
    .update(parts.join("."))
    .digest("hex");
}

function isLoopbackAddr(addr) {
  return LOOPBACK_RE.test(String(addr || ""));
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
  if (!ua || ua.length < 12 || AI_AND_SCRAPER_UA_RE.test(ua)) return true;
  if (/Headless/i.test(String(req.headers["sec-ch-ua"] || ""))) return true;
  if (
    Object.keys(req.headers).some((k) =>
      /^(?:x-jina-|x-firecrawl-|x-crawler-|x-respond-with$)/.test(k)
    )
  ) {
    return true;
  }
  const isOfficialAndroidShell =
    String(req.headers["x-requested-with"] || "") === "io.yjty.jisuanqi" &&
    /Android.*AppleWebKit.*YouJingAndroid\//i.test(ua);
  return (
    !isOfficialAndroidShell &&
    !req.headers["accept-language"] &&
    !req.headers["sec-fetch-mode"] &&
    String(req.headers["accept"] || "") === "*/*"
  );
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const pair of String(cookieHeader).split(";")) {
    const idx = pair.indexOf("=");
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
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
        reject(httpErr("Payload too large", 413));
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
        reject(httpErr("Malformed JSON payload", 400));
      }
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function sendBody(res, statusCode, contentType, body) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  sendBody(
    res,
    statusCode,
    "application/json; charset=utf-8",
    JSON.stringify(payload)
  );
}

function sendHtml(res, statusCode, html) {
  sendBody(res, statusCode, "text/html; charset=utf-8", html);
}

function setBoundedMap(map, key, val, maxCap) {
  if (!map.has(key) && map.size >= maxCap) map.delete(map.keys().next().value);
  map.set(key, val);
}

/**
 * 传输安全网关深模块（专注反爬诱捕、48 小时整机熔断天平、AES-256-GCM + HMAC 信封管线、会话角色守卫与健康检查版本门禁）
 */
export function createSecurityShield(opts = {}) {
  const banStoreFile = opts.banStoreFile || null;
  const persistDelayMs = opts.persistDelayMs ?? 150;
  const fspImpl = opts.fspImpl || fsp;
  const accountManager = opts.accountManager || null;
  const appRoutes = opts.appRoutes || null;
  const nowFn = opts.nowFn || (() => Date.now());
  const fuseDurationMs = opts.fuseDurationMs ?? FORTY_EIGHT_HOURS_MS;
  const sessionTtlMs = opts.sessionTtlMs ?? 2 * 60 * 60 * 1000;
  const replayWindowMs = opts.replayWindowMs ?? 60_000;
  const fuseLoopback = Boolean(opts.fuseLoopback);

  const sessions = new Map();
  const fusedIps = new Map();
  const fusedHwFps = new Map();
  const fusedSids = new Map();
  const bootstrapRateMap = new Map();
  let lastPruneAt = 0;

  if (banStoreFile && fs.existsSync(banStoreFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(banStoreFile, "utf8"));
      const bootNow = nowFn();
      for (const [map, list] of [
        [fusedIps, saved.ips],
        [fusedHwFps, saved.hwFps],
        [fusedSids, saved.sids],
      ]) {
        for (const [k, exp] of list || []) if (exp > bootNow) map.set(k, exp);
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
    if (persistTimer) clearTimeout(persistTimer);
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
        if (tmp) await fspImpl.unlink?.(tmp).catch(() => {});
      }
    }, persistDelayMs);
    persistTimer.unref?.();
  }

  function pruneExpired(force = false) {
    const now = nowFn();
    if (!force && now - lastPruneAt < 10_000) return;
    lastPruneAt = now;
    for (const map of [fusedIps, fusedHwFps, fusedSids]) {
      for (const [k, exp] of map) if (now >= exp) map.delete(k);
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
    const resolvedHwFp = sess?.hwFp || normalizeHwFp(hwFp);
    if (sid && sess) {
      sessions.delete(sid);
      setBoundedMap(fusedSids, sid, exp, MAX_FUSED_SIDS);
    }
    if (resolvedHwFp)
      setBoundedMap(fusedHwFps, resolvedHwFp, exp, MAX_FUSED_HW);
    if (banIp && ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
      setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
    }
    schedulePersistBans();
    return exp;
  }

  function checkAndContagiousLockHwFp(hwFp, ip) {
    if (!hwFp || !fusedHwFps.has(hwFp)) return null;
    const exp = fusedHwFps.get(hwFp);
    if (exp <= nowFn()) {
      fusedHwFps.delete(hwFp);
      return null;
    }
    if (ip && (!isLoopbackAddr(ip) || fuseLoopback)) {
      setBoundedMap(fusedIps, ip, exp, MAX_FUSED_IPS);
      schedulePersistBans();
    }
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
    return checkAndContagiousLockHwFp(hwHeader, ip);
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
    return ++cur.count <= 80;
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
      throw httpErr("Invalid cryptographic envelope headers", 401);
    }
    const sess = sessions.get(sid);
    if (!sess) {
      throw httpErr("Session expired or invalid", 401, {
        sessionExpired: true,
      });
    }
    const now = nowFn();
    const ts = Number(tsStr);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > replayWindowMs) {
      throw httpErr("Envelope timestamp outside allowed window", 403);
    }
    for (const [n, seenAt] of sess.seenNonces) {
      if (now - seenAt > replayWindowMs * 2) sess.seenNonces.delete(n);
      else break;
    }
    if (sess.seenNonces.has(nonce)) {
      tripFuse(ip, sid, fuseDurationMs, true);
      throw httpErr("Replay attack detected — session fused", 403, {
        fused: true,
      });
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
      throw httpErr("Envelope signature mismatch — session fused", 403, {
        fused: true,
      });
    }
    setBoundedMap(sess.seenNonces, nonce, now, 3000);
    return { sess, data: decryptEnvelope(sess.aesKey, ivB64, dB64) };
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

  function extractAuthToken(req, sess) {
    const hdr = String(req.headers?.["x-yj-auth"] || "").trim();
    if (hdr) return hdr;
    return (
      parseCookies(req.headers?.cookie).yj_auth_tok || sess?.authToken || ""
    );
  }

  function requireSessionAuth(req, sess, ip) {
    if (!accountManager) return { user: null };
    const rawToken = extractAuthToken(req, sess);
    const authRes = accountManager.verifyAuthTokenDetailed(
      rawToken,
      sess?.hwFp,
      ip
    );
    if (!authRes.ok) {
      const code = authRes.code;
      throw httpErr(
        authRes.error || "请先登录授权账号",
        code === "AUTH_MISSING" || code === "AUTH_REVOKED" ? 401 : 403,
        { authRequired: true, authCode: code, authError: authRes.error }
      );
    }
    sess.authToken = rawToken;
    return { user: authRes.user };
  }

  function sendGatewayCatchError(res, err, fallbackMsg) {
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

  async function runEncryptedRoute(req, res, ip, routeOpts, handler) {
    const {
      endpoint,
      maxBodyBytes = 64_000,
      requireAuth = false,
      requireSuperAdmin = false,
      fallbackError = "加密信封校验失败或会话已过期",
      onDomainError = null,
    } = routeOpts;
    let sess;
    let data;
    let authCtx;
    try {
      const body = await readJsonBody(req, maxBodyBytes);
      ({ sess, data } = verifyAndUnseal(req, body, ip, endpoint));
      authCtx =
        requireAuth || requireSuperAdmin
          ? requireSessionAuth(req, sess, ip)
          : { user: null };
      if (requireSuperAdmin && authCtx.user?.role !== "superadmin") {
        sendJson(res, 403, { ok: false, error: "无权访问该资源" });
        return true;
      }
    } catch (err) {
      sendGatewayCatchError(res, err, fallbackError);
      return true;
    }

    try {
      const outcome = await handler({ sess, data, user: authCtx.user });
      if (!outcome?.__handled) {
        sendJson(res, 200, {
          ok: true,
          payload: encryptEnvelope(sess.aesKey, outcome),
        });
      }
    } catch (err) {
      if (onDomainError) onDomainError(err);
      else sendGatewayCatchError(res, err, fallbackError);
    }
    return true;
  }

  async function handleRequest(req, res, pathname) {
    pruneExpired(false);

    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        version: "2.7.1",
        uptimeSec: Math.round(process.uptime()),
      });
      return true;
    }

    if (
      isDirectLoopback(req) &&
      appRoutes?.handlePublicStatus?.(req, res, pathname, sendJson)
    ) {
      return true;
    }

    if (pathname === "/robots.txt" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(ROBOTS_TXT);
      return true;
    }

    const ip = extractClientIp(req);

    if (HONEYPOT_PATH_RE.test(pathname)) {
      tripFuse(ip, null, fuseDurationMs, true);
      sendHtml(res, 403, renderFusedHtml(fuseDurationMs));
      return true;
    }

    if (pathname !== "/api/security/fuse") {
      const fusedExp = getFusedExpiry(req, ip);
      if (fusedExp !== null) {
        if (pathname.startsWith("/api/")) {
          sendJson(res, 403, {
            ok: false,
            fused: true,
            unlockAt: fusedExp,
            error: "熔断天平已触发：当前设备与网络已被锁定 48 小时",
          });
        } else {
          sendHtml(
            res,
            403,
            renderFusedHtml(Math.max(60_000, fusedExp - nowFn()))
          );
        }
        return true;
      }
    }

    if (isAiReaderOrScraperRequest(req)) {
      if (pathname.startsWith("/api/")) {
        sendJson(res, 403, { ok: false, error: "Automated access denied" });
      } else if (/\.(?:m?js|css|map)$/.test(pathname)) {
        res.statusCode = 403;
        res.end("Forbidden");
      } else {
        sendHtml(res, 200, DECOY_HTML);
      }
      return true;
    }

    if (pathname === "/api/security/fuse" && req.method === "POST") {
      const fuseBody = await readJsonBody(req, 16_000).catch(() => ({}));
      const sid = String(req.headers["x-yj-sid"] || "");
      const sess = sid ? sessions.get(sid) : null;
      const isMobileUa = /iPhone|iPad|Android/i.test(
        String(req.headers["user-agent"] || "")
      );
      const canBanHwFp =
        sess && sess.ip === ip && (Boolean(sess.authToken) || !isMobileUa);
      const verifiedHwFp = canBanHwFp
        ? sess.hwFp || normalizeHwFp(fuseBody?.hwFp)
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

    if (appRoutes?.handlePublicStatus?.(req, res, pathname, sendJson)) {
      return true;
    }

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

      const rawHwFp = normalizeHwFp(body.hwFp);
      const hwFusedExp = checkAndContagiousLockHwFp(rawHwFp, ip);
      if (hwFusedExp !== null) {
        res.setHeader(
          "Set-Cookie",
          `yj_sh_sid=fused${cookieSuffix(req, 172800)}`
        );
        sendJson(res, 403, {
          ok: false,
          fused: true,
          unlockAt: hwFusedExp,
          error: "熔断天平已触发：当前电脑硬件指纹处于 48 小时封禁期",
        });
        return true;
      }

      const sid = crypto.randomBytes(16).toString("hex");
      const masterKeyBuf = crypto.randomBytes(32);
      const { aesKey, hmacKey } = deriveSessionSubkeys(masterKeyBuf);
      const rawAuthToken = extractAuthToken(req, null);
      const deviceBindFp = rawHwFp || deriveFallbackClientFp(req, ip);
      const bootRes = appRoutes
        ? await appRoutes.resolveBootstrapSession({
            req,
            ip,
            sid,
            rawAuthToken,
            deviceBindFp,
            cookieSuffix,
          })
        : {
            authToken: null,
            cookiesOut: [`yj_sh_sid=${sid}${cookieSuffix(req, 7200)}`],
            payload: { authenticated: Boolean(accountManager) },
          };

      const sessObj = {
        sid,
        aesKey,
        hmacKey,
        createdAt: nowFn(),
        ip,
        hwFp: rawHwFp,
        deviceBindFp,
        authToken: bootRes.authToken,
        seenNonces: new Map(),
        aiAlerts: new Map(),
      };
      setBoundedMap(sessions, sid, sessObj, MAX_SESSIONS);
      res.setHeader("Set-Cookie", bootRes.cookiesOut);
      sendJson(res, 200, {
        ok: true,
        sid,
        k: masterKeyBuf.toString("base64"),
        payload: encryptEnvelope(aesKey, bootRes.payload),
      });
      return true;
    }

    if (!appRoutes) return false;
    const getBanStats = () => ({
      fusedIpsCount: fusedIps.size,
      fusedHwCount: fusedHwFps.size,
    });
    return appRoutes.handleDomainRoute(req, res, pathname, {
      ip,
      runEncryptedRoute,
      sendJson,
      cookieSuffix,
      deriveFallbackClientFp,
      checkAndContagiousLockHwFp,
      tripFuse,
      getBanStats,
    });
  }

  return { handleRequest, tripFuse, isRequestFused };
}

export function createSecurityAndQuantGateway(opts = {}) {
  const appRoutes = opts.appRoutes || createAppRoutes(opts);
  const shield = createSecurityShield({ ...opts, appRoutes });
  return { ...shield, ensureMatchesLoaded: appRoutes.ensureMatchesLoaded };
}
