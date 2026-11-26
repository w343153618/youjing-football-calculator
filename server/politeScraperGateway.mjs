// Unified polite anti-ban outbound gateway: Chrome TLS/HTTP2 stack, 30d per-domain identity/cookies,
// China Sporttery market-hours dormancy, non-grid continuous ms jitter, and 5-source 0-retry failover.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import path from "node:path";
import zlib from "node:zlib";
import {
  FALLBACK_MATCHES,
  parseSportteryRawJson,
  parseSportteryResultsJson,
} from "./quant/sportteryParsers.mjs";
import { analyzeMatchMicroQuant } from "./quant/coherentCalibration.mjs";
import {
  buildBoardFreshnessMeta,
  parseBeijingDateTimeMs,
  splitDateRangeIntoWindows,
} from "./history/sportteryHistoryNormalizers.mjs";
import {
  detectSoftBlockResponse,
  extractOfficialSaleStatus,
  mergePartialBackupSubPools,
  parse500HistoricalIdsHtml,
  parse500HunheHtml,
  parseOkoooHunheHtml,
  parseOkoooKaijiangHtml,
  parseTitanJcResultText,
  parseZgzcwJcHtml,
} from "./multisourceParsers.mjs";
import {
  enrichBoardQuoteMeta,
  reconcileMatchesPoolsNonRegressive,
} from "./sportteryFeed.mjs";

const BJ_OFFSET_MS = 8 * 3600_000;

// Chrome 131 / Edge 131 modern TLS 1.2 + 1.3 cipher & curve order
const BROWSER_TLS_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
].join(":");

const BROWSER_PROFILES_CN = Object.freeze([
  Object.freeze({
    id: "cn-win-chrome131",
    weight: 0.45,
    mobile: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa:
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
  }),
  Object.freeze({
    id: "cn-win-edge131",
    weight: 0.25,
    mobile: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    secChUa:
      '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
    acceptLanguage: "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
  }),
  Object.freeze({
    id: "cn-mac-chrome131",
    weight: 0.2,
    mobile: false,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa:
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"macOS"',
    secChUaMobile: "?0",
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
  }),
  Object.freeze({
    id: "cn-ios-safari17",
    weight: 0.1,
    mobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    secChUa: "",
    secChUaPlatform: "",
    secChUaMobile: "",
    acceptLanguage: "zh-CN,zh-Hans;q=0.9",
  }),
]);

export const LIVE_SPORTTERY_SOURCES = Object.freeze([
  Object.freeze({
    id: "sporttery-pc",
    label: "中国体彩官网通道A",
    tier: "official",
    domainKey: "webapi.sporttery.cn:pc",
    host: "webapi.sporttery.cn",
    url: "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c",
    referer: "https://www.sporttery.cn/",
    origin: "https://www.sporttery.cn",
    accept: "application/json, text/plain, */*",
    encoding: "utf-8",
    preferMobile: false,
    baseWeight: 1.35,
  }),
  Object.freeze({
    id: "sporttery-wap",
    label: "中国体彩触屏通道B",
    tier: "official",
    domainKey: "webapi.sporttery.cn:wap",
    host: "webapi.sporttery.cn",
    url: "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=3001",
    referer: "https://m.sporttery.cn/",
    origin: "https://m.sporttery.cn",
    accept: "application/json, text/plain, */*",
    encoding: "utf-8",
    preferMobile: true,
    baseWeight: 1.25,
  }),
  Object.freeze({
    id: "500-hunhe",
    label: "公开竞彩源·500混投",
    tier: "backup",
    domainKey: "trade.500.com",
    host: "trade.500.com",
    url: "https://trade.500.com/jczq/?playid=312",
    referer: "https://trade.500.com/jczq/",
    origin: null,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    encoding: "gb18030",
    preferMobile: false,
    baseWeight: 1.2,
  }),
  Object.freeze({
    id: "zgzcw-jc",
    label: "公开竞彩源·足彩网",
    tier: "backup",
    domainKey: "cp.zgzcw.com",
    host: "cp.zgzcw.com",
    url: "https://cp.zgzcw.com/lottery/jchtplayvsForJsp.action?lotteryId=47&type=jcmini",
    referer: "https://cp.zgzcw.com/",
    origin: null,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    encoding: "utf-8",
    preferMobile: false,
    baseWeight: 1.0,
  }),
  Object.freeze({
    id: "okooo-hunhe",
    label: "公开竞彩源·澳客混投",
    tier: "backup",
    domainKey: "www.okooo.com",
    host: "www.okooo.com",
    url: "https://www.okooo.com/jingcai/hunhe/",
    referer: "https://www.okooo.com/jingcai/",
    origin: null,
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    encoding: "gb18030",
    preferMobile: false,
    baseWeight: 1.0,
  }),
]);

export function getBeijingParts(epochMs) {
  const bj = new Date(epochMs + BJ_OFFSET_MS);
  const year = bj.getUTCFullYear();
  const month = bj.getUTCMonth() + 1;
  const day = bj.getUTCDate();
  const weekday = bj.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = bj.getUTCHours();
  const minute = bj.getUTCMinutes();
  const second = bj.getUTCSeconds();
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const dayStartUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - BJ_OFFSET_MS;
  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
    dateStr,
    dayStartEpochMs: dayStartUtcMs,
    msSinceMidnight: epochMs - dayStartUtcMs,
  };
}

function computeDailyMorningWakeOffsetMs(dateStr) {
  // Deterministic per-day jitter in [73_000ms, 530_000ms] (11:01:13 ~ 11:08:50 BJ) with odd milliseconds
  const hash = crypto.createHash("sha256").update(`wake:${dateStr}`).digest();
  const u = hash.readUInt32BE(0) / 0xffffffff;
  return 73_119 + Math.floor(u * 456_733);
}

/**
 * 生成无规律连续毫秒级同步间隔（约 18分 ~ 22分），并强制避开 :00/:15/:30/:45 ±35秒整刻钟栅格
 */
export function computePoliteRandomIntervalMs(
  nowMs = Date.now(),
  randomFn = Math.random
) {
  const u1 = Math.max(0, Math.min(1, Number(randomFn()) || 0));
  const u2 = Math.max(0, Math.min(1, Number(randomFn()) || 0));
  const u3 = Math.max(0, Math.min(1, Number(randomFn()) || 0));
  const smooth = 0.5 * (u1 + u2);
  const minMs = 1_080_137; // 18m 0.137s
  const maxMs = 1_319_893; // 21m 59.893s
  let delayMs =
    minMs + Math.floor(smooth * (maxMs - minMs)) + Math.floor(u3 * 991);

  // Never land on exact whole minute (divisible by 60_000 within ±1500ms)
  const modMin = delayMs % 60_000;
  if (modMin < 1_800 || modMin > 58_200) {
    const minShift = 13_427 + Math.floor((Number(randomFn()) || 0.37) * 19_311);
    delayMs = delayMs > 1_200_000 ? delayMs - minShift : delayMs + minShift;
  }

  // Anti-quarter-hour grid guard: forbidden zone [-35s, +35s] is 70s wide;
  // shifting by +- [81.2s, 128.8s] guarantees exiting the +-35s zone while staying in [1_060_000ms, 1_340_000ms]
  const targetBjMs = nowMs + delayMs + BJ_OFFSET_MS;
  const secInHour = (((targetBjMs % 3_600_000) + 3_600_000) % 3_600_000) / 1000;
  const remQuarter = secInHour % 900;
  const distToQuarterSec = Math.min(remQuarter, 900 - remQuarter);
  if (distToQuarterSec <= 35) {
    const shiftU = Math.max(0, Math.min(1, Number(randomFn()) || 0.53));
    const mag = 81_219 + Math.floor(shiftU * 47_641);
    delayMs = delayMs > 1_200_000 ? delayMs - mag : delayMs + mag;
  }

  // Ensure final delayMs is never an exact whole-minute multiple (tiny 1.7s nudge preserves >35s quarter clearance)
  if (delayMs % 60_000 === 0) {
    delayMs += 1_719;
  }
  return delayMs;
}

/**
 * 评估当前是否处于中国体彩「开休市静默门禁」允许采集窗口
 */
export function evaluateMarketHoursGate({
  nowMs = Date.now(),
  officialSaleOpen = null,
  officialSaleCheckedDate = null,
  matches = [],
} = {}) {
  const bj = getBeijingParts(nowMs);
  const morningWakeOffsetMs = computeDailyMorningWakeOffsetMs(bj.dateStr);
  const openStartMs = 11 * 3_600_000 + morningWakeOffsetMs;

  // 1) 每日 00:00 ~ 11:00(+随机苏醒偏移)：100% 早间静默休市（0 外网请求）
  if (bj.msSinceMidnight < openStartMs) {
    return {
      isOpen: false,
      phase: "closed-morning",
      nextWakeDelayMs: Math.max(5_000, openStartMs - bj.msSinceMidnight),
      reason: "每日 11:00 前竞彩休市静默保护中",
    };
  }

  // 2) 当天晚间若已明确观测到官方计算器停售标志 (offLineSaleStatus !== 1)
  if (
    officialSaleOpen === false &&
    officialSaleCheckedDate === bj.dateStr &&
    bj.hour >= 21
  ) {
    const tomorrowWakeOffset = computeDailyMorningWakeOffsetMs(
      getBeijingParts(bj.dayStartEpochMs + 86_400_000 + 3_600_000).dateStr
    );
    const nextOpenEpochMs =
      bj.dayStartEpochMs + 86_400_000 + 11 * 3_600_000 + tomorrowWakeOffset;
    return {
      isOpen: false,
      phase: "closed-night",
      nextWakeDelayMs: Math.max(60_000, nextOpenEpochMs - nowMs),
      reason: "官方计算器已进入夜间停售休市，暂停采集至次日 11:00 后",
    };
  }

  // 3) 夜间常规停售兜底（周中 22:10 / 周末 23:10 后，且当前盘面无当天剩余未开赛场次）
  const isWeekend = bj.weekday === 6 || bj.weekday === 0;
  const nightCutoffMs = (isWeekend ? 23 : 22) * 3_600_000 + 10 * 60_000;
  if (bj.msSinceMidnight >= nightCutoffMs) {
    const hasOpenTonightMatch =
      Array.isArray(matches) &&
      matches.some((m) => {
        if (!m?.kickoffDateTime && !(m?.matchDate && m?.kickoff)) return false;
        const kickMs = parseBeijingDateTimeMs(
          m.matchDate || String(m.kickoffDateTime).slice(0, 10),
          m.kickoff || String(m.kickoffDateTime).slice(11)
        );
        // 若当晚 23:00~24:00 仍有未开赛场次（如周末或大赛顺延），允许持续到开赛截止
        return (
          kickMs !== null &&
          kickMs > nowMs &&
          kickMs <= bj.dayStartEpochMs + 24 * 3_600_000
        );
      });
    if (!hasOpenTonightMatch) {
      const tomorrowWakeOffset = computeDailyMorningWakeOffsetMs(
        getBeijingParts(bj.dayStartEpochMs + 86_400_000 + 3_600_000).dateStr
      );
      const nextOpenEpochMs =
        bj.dayStartEpochMs + 86_400_000 + 11 * 3_600_000 + tomorrowWakeOffset;
      return {
        isOpen: false,
        phase: "closed-night",
        nextWakeDelayMs: Math.max(60_000, nextOpenEpochMs - nowMs),
        reason: "已过竞彩晚间停售红线，进入夜间静默保护至次日 11:00 后",
      };
    }
  }

  return {
    isOpen: true,
    phase: "open",
    nextWakeDelayMs: 0,
    reason: null,
  };
}

function decompressBuffer(buf, contentEncoding) {
  const enc = String(contentEncoding || "").toLowerCase();
  if (!buf || buf.length === 0) return buf;
  try {
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch {
    return buf;
  }
  return buf;
}

function singleHttp1Or2Request(urlStr, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }

    if (parsedUrl.protocol === "http:") {
      const req = http.request(
        parsedUrl,
        { method: "GET", headers, timeout: timeoutMs },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks);
            const respHeaders = {};
            for (const [k, v] of Object.entries(res.headers)) {
              respHeaders[k.toLowerCase()] = v;
            }
            resolve({
              status: res.statusCode || 0,
              headers: respHeaders,
              bodyBuffer: decompressBuffer(
                raw,
                respHeaders["content-encoding"]
              ),
            });
          });
        }
      );
      req.on("timeout", () => {
        req.destroy(new Error("HTTP_TIMEOUT"));
      });
      req.on("error", reject);
      req.end();
      return;
    }

    // HTTPS with Chrome TLS cipher order & HTTP/2 ALPN negotiation
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    let h2Client = null;
    let h1Req = null;
    const timer = setTimeout(() => {
      try {
        h2Client?.destroy();
        h1Req?.destroy();
      } catch {
        // ignore
      }
      finish(reject, new Error("TLS_TIMEOUT"));
    }, timeoutMs);

    const doHttps1Fallback = () => {
      h1Req = https.request(
        parsedUrl,
        {
          method: "GET",
          headers,
          ciphers: BROWSER_TLS_CIPHERS,
          ecdhCurve: "X25519:P-256:P-384",
          minVersion: "TLSv1.2",
          ALPNProtocols: ["http/1.1"],
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks);
            const respHeaders = {};
            for (const [k, v] of Object.entries(res.headers)) {
              respHeaders[k.toLowerCase()] = v;
            }
            finish(resolve, {
              status: res.statusCode || 0,
              headers: respHeaders,
              bodyBuffer: decompressBuffer(
                raw,
                respHeaders["content-encoding"]
              ),
            });
          });
        }
      );
      h1Req.on("error", (err) => finish(reject, err));
      h1Req.end();
    };

    try {
      h2Client = http2.connect(parsedUrl.origin, {
        ciphers: BROWSER_TLS_CIPHERS,
        ecdhCurve: "X25519:P-256:P-384",
        minVersion: "TLSv1.2",
        ALPNProtocols: ["h2", "http/1.1"],
        settings: {
          headerTableSize: 65536,
          enablePush: false,
          initialWindowSize: 6291456,
          maxHeaderListSize: 262144,
        },
      });
      h2Client.on("connect", (_session, socket) => {
        if (socket?.alpnProtocol && socket.alpnProtocol !== "h2") {
          try {
            h2Client.close();
          } catch {
            // ignore
          }
          doHttps1Fallback();
          return;
        }
        const h2Headers = {
          ":method": "GET",
          ":authority": parsedUrl.host,
          ":scheme": parsedUrl.protocol.replace(":", ""),
          ":path": `${parsedUrl.pathname}${parsedUrl.search}`,
        };
        for (const [k, v] of Object.entries(headers)) {
          const lk = k.toLowerCase();
          if (
            lk === "host" ||
            lk === "connection" ||
            (lk === "upgrade-insecure-requests" && v === undefined)
          ) {
            continue;
          }
          if (v !== undefined && v !== null && v !== "") {
            h2Headers[lk] = String(v);
          }
        }
        const req = h2Client.request(h2Headers);
        const respHeaders = {};
        let status = 0;
        const chunks = [];
        req.on("response", (hdrs) => {
          status = Number(hdrs[":status"] || 0);
          for (const [k, v] of Object.entries(hdrs)) {
            if (!k.startsWith(":")) respHeaders[k.toLowerCase()] = v;
          }
        });
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            h2Client.close();
          } catch {
            // ignore
          }
          const raw = Buffer.concat(chunks);
          finish(resolve, {
            status,
            headers: respHeaders,
            bodyBuffer: decompressBuffer(raw, respHeaders["content-encoding"]),
          });
        });
        req.on("error", () => {
          try {
            h2Client.close();
          } catch {
            // ignore
          }
          doHttps1Fallback();
        });
        req.end();
      });
      h2Client.on("error", () => {
        try {
          h2Client.destroy();
        } catch {
          // ignore
        }
        doHttps1Fallback();
      });
    } catch {
      doHttps1Fallback();
    }
  });
}

/**
 * 带最多 3 跳重定向与 Cookie 收集的浏览器级协议传输
 */
export async function browserProtocolTransport(
  urlStr,
  { headers = {}, timeoutMs = 6_500 } = {}
) {
  let currentUrl = urlStr;
  const collectedSetCookies = [];
  for (let hop = 0; hop < 3; hop++) {
    const res = await singleHttp1Or2Request(currentUrl, headers, timeoutMs);
    const sc = res.headers["set-cookie"];
    if (Array.isArray(sc)) collectedSetCookies.push(...sc);
    else if (typeof sc === "string" && sc) collectedSetCookies.push(sc);

    if (
      (res.status === 301 ||
        res.status === 302 ||
        res.status === 303 ||
        res.status === 307 ||
        res.status === 308) &&
      res.headers.location
    ) {
      currentUrl = new URL(res.headers.location, currentUrl).toString();
      continue;
    }
    return {
      ...res,
      finalUrl: currentUrl,
      setCookies: collectedSetCookies,
    };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

function decodeBodyText(buf, encodingHint = "utf-8", contentType = "") {
  const useGb =
    encodingHint === "gb18030" || /gbk|gb2312|gb18030/i.test(contentType);
  const decoder = new TextDecoder(useGb ? "gb18030" : "utf-8", {
    fatal: false,
  });
  return decoder.decode(buf);
}

const COOLDOWN_LADDER_MS = [
  30 * 60_000, // 1st failure: 30m
  2 * 3_600_000, // 2nd failure: 2h
  6 * 3_600_000, // 3rd+ failure: 6h
];

/**
 * 创建统一防封多源同步网关（单实例持有 30 天同域名身份、Cookie 罐、滑动窗口硬限流、开休市静默与五源零重试轮转）
 */
export function createPoliteMultisourceGateway(opts = {}) {
  const nowFn =
    typeof opts.nowFn === "function" ? opts.nowFn : () => Date.now();
  const randomFn =
    typeof opts.randomFn === "function" ? opts.randomFn : Math.random;
  const hasCustomFetch = typeof opts.fetchFn === "function";
  const customFetchFn = hasCustomFetch ? opts.fetchFn : null;
  const stateFilePath = opts.stateFilePath || null;
  const snapshotFilePath = opts.snapshotFilePath || null;
  const resultsCacheFilePath = opts.resultsCacheFilePath || null;
  const pushHmacSecret = String(
    opts.pushHmacSecret ?? process.env.YOUJING_PUSH_HMAC_SECRET ?? ""
  ).trim();
  const enforceMarketHours = opts.enforceMarketHours !== false;
  const manualRefreshMinIntervalMs = Number.isFinite(
    Number(opts.manualRefreshMinIntervalMs)
  )
    ? Number(opts.manualRefreshMinIntervalMs)
    : 5 * 60_000;
  const idleThresholdMs = Number.isFinite(Number(opts.idleThresholdMs))
    ? Number(opts.idleThresholdMs)
    : 60 * 60_000;
  const perDomainMaxPerMinute = Number.isFinite(
    Number(opts.perDomainMaxPerMinute)
  )
    ? Number(opts.perDomainMaxPerMinute)
    : 4;
  const officialPushFreshTtlMs = Number.isFinite(
    Number(opts.officialPushFreshTtlMs)
  )
    ? Number(opts.officialPushFreshTtlMs)
    : 35 * 60_000;

  const state = {
    domainProfiles: {}, // domainKey -> { profileId, createdAt, lastUsedAt, successCount, blockCount, consecutiveBlocks, cookies: {}, etag: {}, lastModified: {} }
    sourceHealth: {}, // sourceId -> { successCount, failCount, consecutiveFailures, lastSuccessAt, lastErrorAt, lastError, cooldownUntil }
    officialSaleOpen: null,
    officialSaleCheckedDate: null,
    lastOutboundBoardSyncAt: 0,
    lastValidBoardAt: null,
    lastOfficialPushAt: null,
    lastOfficialResultsPushAt: null,
    lastUserActivityAt: nowFn(),
    idleEveningCheckedDate: null,
    usedPushNonces: {},
  };

  if (stateFilePath && fs.existsSync(stateFilePath)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
      if (loaded && typeof loaded === "object") {
        if (loaded.domainProfiles) state.domainProfiles = loaded.domainProfiles;
        if (loaded.sourceHealth) state.sourceHealth = loaded.sourceHealth;
        if (typeof loaded.officialSaleOpen === "boolean") {
          state.officialSaleOpen = loaded.officialSaleOpen;
          state.officialSaleCheckedDate =
            loaded.officialSaleCheckedDate || null;
        }
        if (typeof loaded.lastValidBoardAt === "number") {
          state.lastValidBoardAt = loaded.lastValidBoardAt;
        }
        if (typeof loaded.lastOfficialPushAt === "number") {
          state.lastOfficialPushAt = loaded.lastOfficialPushAt;
        }
        if (typeof loaded.lastOfficialResultsPushAt === "number") {
          state.lastOfficialResultsPushAt = loaded.lastOfficialResultsPushAt;
        }
        if (
          loaded.usedPushNonces &&
          typeof loaded.usedPushNonces === "object"
        ) {
          const bootNow = nowFn();
          for (const [k, exp] of Object.entries(loaded.usedPushNonces)) {
            if (
              typeof exp === "number" &&
              Number.isFinite(exp) &&
              exp >= bootNow
            ) {
              state.usedPushNonces[k] = exp;
            }
          }
        }
      }
    } catch {
      // ignore corrupted state file
    }
  }

  // Sliding-window timestamps per host: Map<host, number[]>
  const slidingWindows = new Map();
  const pushedResultsById = new Map();
  let outboundChain = Promise.resolve();
  let statePersistChain = Promise.resolve();
  let statePersistSeq = 0;
  let inFlightBoardSync = null;
  let inFlightResultsSync = null;
  let lastKnownMatches = null;

  function persistStateNonBlocking() {
    if (!stateFilePath) return Promise.resolve();
    const now = nowFn();
    const activeNonces = {};
    for (const [k, exp] of Object.entries(state.usedPushNonces)) {
      if (typeof exp === "number" && Number.isFinite(exp) && exp >= now) {
        activeNonces[k] = exp;
      } else {
        delete state.usedPushNonces[k];
      }
    }
    const payload = JSON.stringify(
      {
        domainProfiles: state.domainProfiles,
        sourceHealth: state.sourceHealth,
        officialSaleOpen: state.officialSaleOpen,
        officialSaleCheckedDate: state.officialSaleCheckedDate,
        lastValidBoardAt: state.lastValidBoardAt,
        lastOfficialPushAt: state.lastOfficialPushAt,
        lastOfficialResultsPushAt: state.lastOfficialResultsPushAt,
        usedPushNonces: activeNonces,
      },
      null,
      2
    );
    const dir = path.dirname(stateFilePath);
    const seq = ++statePersistSeq;
    const tmp = `${stateFilePath}.tmp.${process.pid}.${Date.now()}.${seq}`;
    const task = statePersistChain.then(() =>
      fsp
        .mkdir(dir, { recursive: true, mode: 0o700 })
        .then(() =>
          fsp.writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 })
        )
        .then(() => fsp.rename(tmp, stateFilePath))
        .catch(() => fsp.unlink(tmp).catch(() => {}))
    );
    statePersistChain = task.catch(() => {});
    return task;
  }

  function pickNewProfile(preferMobile = false, excludeId = "") {
    if (preferMobile) {
      return (
        BROWSER_PROFILES_CN.find((p) => p.mobile) || BROWSER_PROFILES_CN[0]
      );
    }
    const candidates = BROWSER_PROFILES_CN.filter(
      (p) => !p.mobile && p.id !== excludeId
    );
    const totalW = candidates.reduce((s, p) => s + p.weight, 0);
    let r = (Number(randomFn()) || 0) * totalW;
    for (const p of candidates) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return candidates[0] || BROWSER_PROFILES_CN[0];
  }

  function getOrCreateDomainProfile(domainKey, preferMobile = false) {
    const now = nowFn();
    let rec = state.domainProfiles[domainKey];
    const maxAgeMs = 30 * 86_400_000;
    const total = (rec?.successCount || 0) + (rec?.blockCount || 0);
    const blockRate = total >= 5 ? (rec?.blockCount || 0) / total : 0;
    const shouldRotate =
      !rec ||
      now - (rec.createdAt || 0) > maxAgeMs ||
      (rec.consecutiveBlocks || 0) >= 5 ||
      blockRate > 0.3;

    if (shouldRotate) {
      const chosen = pickNewProfile(preferMobile, rec?.profileId || "");
      rec = {
        profileId: chosen.id,
        createdAt: now,
        lastUsedAt: now,
        successCount: 0,
        blockCount: 0,
        consecutiveBlocks: 0,
        cookies: rec?.cookies && !rec.consecutiveBlocks ? rec.cookies : {},
        etag: {},
        lastModified: {},
      };
      state.domainProfiles[domainKey] = rec;
    }
    const spec =
      BROWSER_PROFILES_CN.find((p) => p.id === rec.profileId) ||
      BROWSER_PROFILES_CN[0];
    return { rec, spec };
  }

  function checkAndRecordHostSlidingWindow(host) {
    const now = nowFn();
    const cutoff = now - 60_000;
    const arr = (slidingWindows.get(host) || []).filter((t) => t > cutoff);
    if (arr.length >= perDomainMaxPerMinute) {
      slidingWindows.set(host, arr);
      return false;
    }
    arr.push(now);
    slidingWindows.set(host, arr);
    return true;
  }

  function buildCoherentRequestHeaders(source, profileRec, profileSpec, url) {
    const isApi = source.accept.includes("application/json");
    const hdrs = {
      "User-Agent": profileSpec.userAgent,
      Accept: source.accept,
      "Accept-Language": profileSpec.acceptLanguage,
      "Accept-Encoding": "gzip, deflate, br",
      Referer: source.referer,
      ...(source.origin ? { Origin: source.origin } : {}),
      ...(profileSpec.secChUa
        ? {
            "Sec-Ch-Ua": profileSpec.secChUa,
            "Sec-Ch-Ua-Mobile": profileSpec.secChUaMobile,
            "Sec-Ch-Ua-Platform": profileSpec.secChUaPlatform,
          }
        : {}),
      "Sec-Fetch-Dest": isApi ? "empty" : "document",
      "Sec-Fetch-Mode": isApi ? "cors" : "navigate",
      "Sec-Fetch-Site": isApi ? "same-site" : "same-origin",
      ...(!isApi ? { "Upgrade-Insecure-Requests": "1" } : {}),
    };
    const cookiePairs = Object.entries(profileRec.cookies || {})
      .filter(([k, v]) => k && v)
      .map(([k, v]) => `${k}=${v}`);
    if (cookiePairs.length > 0) {
      hdrs.Cookie = cookiePairs.join("; ");
    }
    if (profileRec.etag?.[url]) {
      hdrs["If-None-Match"] = profileRec.etag[url];
    }
    if (profileRec.lastModified?.[url]) {
      hdrs["If-Modified-Since"] = profileRec.lastModified[url];
    }
    return hdrs;
  }

  function absorbResponseCookiesAndCache(profileRec, url, headers, setCookies) {
    if (Array.isArray(setCookies)) {
      for (const raw of setCookies) {
        const first = String(raw || "").split(";")[0];
        const eq = first.indexOf("=");
        if (eq > 0) {
          const k = first.slice(0, eq).trim();
          const v = first.slice(eq + 1).trim();
          if (k && v && k.length <= 64 && v.length <= 512) {
            profileRec.cookies[k] = v;
          }
        }
      }
    }
    const etag = headers?.etag;
    if (typeof etag === "string" && etag) {
      profileRec.etag = profileRec.etag || {};
      profileRec.etag[url] = etag;
    }
    const lm = headers?.["last-modified"];
    if (typeof lm === "string" && lm) {
      profileRec.lastModified = profileRec.lastModified || {};
      profileRec.lastModified[url] = lm;
    }
  }

  /**
   * 全局串行并发 = 1 的受控请求执行器
   */
  function runSerializedOutbound(taskFn) {
    const next = outboundChain.then(taskFn, taskFn);
    outboundChain = next.catch(() => {});
    return next;
  }

  async function executePoliteGet(
    source,
    urlOverride = null,
    timeoutMs = 6_500
  ) {
    const url = urlOverride || source.url;
    return runSerializedOutbound(async () => {
      if (!checkAndRecordHostSlidingWindow(source.host)) {
        return {
          ok: false,
          status: 429,
          reason: "LOCAL_SLIDING_WINDOW_GUARD",
          bodyText: "",
        };
      }
      const { rec, spec } = getOrCreateDomainProfile(
        source.domainKey,
        source.preferMobile
      );
      rec.lastUsedAt = nowFn();
      const headers = buildCoherentRequestHeaders(source, rec, spec, url);

      try {
        if (customFetchFn) {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), timeoutMs);
          try {
            const res = await customFetchFn(url, {
              headers,
              signal: ac.signal,
            });
            const status = Number(res?.status ?? (res?.ok ? 200 : 0));
            const respHeaders = {};
            if (res?.headers && typeof res.headers.forEach === "function") {
              res.headers.forEach((v, k) => {
                respHeaders[String(k).toLowerCase()] = v;
              });
            } else if (res?.headers && typeof res.headers === "object") {
              for (const [k, v] of Object.entries(res.headers)) {
                respHeaders[k.toLowerCase()] = v;
              }
            }
            const rawSetCookie =
              typeof res?.headers?.getSetCookie === "function"
                ? res.headers.getSetCookie()
                : respHeaders["set-cookie"]
                  ? [respHeaders["set-cookie"]].flat()
                  : [];
            absorbResponseCookiesAndCache(rec, url, respHeaders, rawSetCookie);
            if (status === 304) {
              rec.successCount += 1;
              rec.consecutiveBlocks = 0;
              return {
                ok: true,
                notModified: true,
                status: 304,
                bodyText: "",
                profileId: spec.id,
                headersSent: headers,
              };
            }
            let bodyText = "";
            if (typeof res?.arrayBuffer === "function") {
              const buf = new Uint8Array(await res.arrayBuffer());
              bodyText = decodeBodyText(
                buf,
                source.encoding,
                respHeaders["content-type"] || ""
              );
            } else if (typeof res?.text === "function") {
              bodyText = await res.text();
            } else if (typeof res?.json === "function") {
              bodyText = JSON.stringify(await res.json());
            }
            return {
              ok: status >= 200 && status < 300,
              status,
              bodyText,
              profileId: spec.id,
              headersSent: headers,
            };
          } finally {
            clearTimeout(t);
          }
        }

        const res = await browserProtocolTransport(url, { headers, timeoutMs });
        absorbResponseCookiesAndCache(rec, url, res.headers, res.setCookies);
        if (res.status === 304) {
          rec.successCount += 1;
          rec.consecutiveBlocks = 0;
          return {
            ok: true,
            notModified: true,
            status: 304,
            bodyText: "",
            profileId: spec.id,
            headersSent: headers,
          };
        }
        const bodyText = decodeBodyText(
          res.bodyBuffer,
          source.encoding,
          String(res.headers["content-type"] || "")
        );
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          bodyText,
          profileId: spec.id,
          headersSent: headers,
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          reason: err?.message || "NETWORK_ERROR",
          bodyText: "",
          profileId: spec.id,
          headersSent: headers,
        };
      }
    });
  }

  function markSourceSuccess(sourceId, domainKey, nowMs = nowFn()) {
    const prev = state.sourceHealth[sourceId] || {
      successCount: 0,
      failCount: 0,
      consecutiveFailures: 0,
    };
    state.sourceHealth[sourceId] = {
      ...prev,
      successCount: (prev.successCount || 0) + 1,
      consecutiveFailures: 0,
      lastSuccessAt: nowMs,
      lastError: null,
      cooldownUntil: 0,
    };
    const prof = state.domainProfiles[domainKey];
    if (prof) {
      prof.successCount = (prof.successCount || 0) + 1;
      prof.consecutiveBlocks = 0;
    }
    persistStateNonBlocking();
  }

  function markSourceFailure(
    sourceId,
    domainKey,
    reason,
    isBlock = false,
    nowMs = nowFn()
  ) {
    const prev = state.sourceHealth[sourceId] || {
      successCount: 0,
      failCount: 0,
      consecutiveFailures: 0,
    };
    const nextConsec = (prev.consecutiveFailures || 0) + 1;
    const cooldownMs =
      COOLDOWN_LADDER_MS[
        Math.min(COOLDOWN_LADDER_MS.length - 1, nextConsec - 1)
      ];
    state.sourceHealth[sourceId] = {
      ...prev,
      failCount: (prev.failCount || 0) + 1,
      consecutiveFailures: nextConsec,
      lastErrorAt: nowMs,
      lastError: reason,
      cooldownUntil: nowMs + cooldownMs,
    };
    const prof = state.domainProfiles[domainKey];
    if (prof && isBlock) {
      prof.blockCount = (prof.blockCount || 0) + 1;
      prof.consecutiveBlocks = (prof.consecutiveBlocks || 0) + 1;
    }
    persistStateNonBlocking();
  }

  function selectWeightedRandomCandidates(candidates) {
    const pool = [...candidates];
    const ordered = [];
    while (pool.length > 0) {
      const weights = pool.map((src) => {
        const h = state.sourceHealth[src.id];
        const s = h?.successCount || 0;
        const f = h?.failCount || 0;
        const reliability = (s + 2) / (s + f + 3);
        return Math.max(0.1, src.baseWeight * reliability);
      });
      const total = weights.reduce((a, b) => a + b, 0);
      let r = (Number(randomFn()) || 0) * total;
      let pickedIdx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          pickedIdx = i;
          break;
        }
      }
      ordered.push(pool[pickedIdx]);
      pool.splice(pickedIdx, 1);
    }
    return ordered;
  }

  async function loadDiskSnapshotFallback(fallbackState = "timeout-fallback") {
    const now = nowFn();
    if (lastKnownMatches && lastKnownMatches.length > 0) {
      const boardMeta = enrichBoardQuoteMeta(
        buildBoardFreshnessMeta({
          source: "cached-snapshot",
          boardState: fallbackState,
          lastValidBoardAt: state.lastValidBoardAt,
        }),
        lastKnownMatches,
        now
      );
      return {
        matches: lastKnownMatches,
        source: "cached-snapshot",
        boardMeta,
        syncNote:
          fallbackState === "market-closed"
            ? `竞彩休市静默保护中（0 外网请求）· 展示休市前最后有效盘面（${lastKnownMatches.length} 场）`
            : boardMeta.bannerText ||
              `已载入本地缓存快照 ${lastKnownMatches.length} 场赛事（只读参考）`,
      };
    }

    if (snapshotFilePath && fs.existsSync(snapshotFilePath)) {
      try {
        const raw = JSON.parse(await fsp.readFile(snapshotFilePath, "utf8"));
        const parsed = Array.isArray(raw?.__normalizedMatches)
          ? raw.__normalizedMatches
          : parseSportteryRawJson(raw);
        if (parsed.length > 0) {
          const snapAt =
            (typeof raw?.__capturedAt === "number" ? raw.__capturedAt : null) ??
            parseBeijingDateTimeMs(raw?.value?.lastUpdateTime) ??
            state.lastValidBoardAt;
          lastKnownMatches = parsed;
          if (snapAt && !state.lastValidBoardAt)
            state.lastValidBoardAt = snapAt;
          const boardMeta = enrichBoardQuoteMeta(
            buildBoardFreshnessMeta({
              source: "cached-snapshot",
              boardState: fallbackState,
              lastValidBoardAt: snapAt,
            }),
            parsed,
            now
          );
          return {
            matches: parsed,
            source: "cached-snapshot",
            boardMeta,
            syncNote:
              fallbackState === "market-closed"
                ? `竞彩休市静默保护中（0 外网请求）· 展示休市前最后有效盘面（${parsed.length} 场）`
                : boardMeta.bannerText ||
                  `已载入体彩本地缓存快照 ${parsed.length} 场赛事（只读参考）`,
          };
        }
      } catch {
        // ignore
      }
    }

    const builtinState =
      fallbackState === "market-closed"
        ? "market-closed"
        : state.lastValidBoardAt !== null
          ? fallbackState
          : "builtin-fallback";
    const boardMeta = enrichBoardQuoteMeta(
      buildBoardFreshnessMeta({
        source: "fallback",
        boardState: builtinState,
        lastValidBoardAt: state.lastValidBoardAt,
      }),
      FALLBACK_MATCHES,
      now
    );
    return {
      matches: FALLBACK_MATCHES,
      source: "fallback",
      boardMeta,
      syncNote:
        fallbackState === "market-closed"
          ? `竞彩休市静默保护中（0 外网请求）· 每日 11:00 开市后自动恢复多源同步`
          : `使用内置实盘快照（共 ${FALLBACK_MATCHES.length} 场精选赛事）`,
    };
  }

  async function persistBoardSnapshotToDisk(payloadObj) {
    if (!snapshotFilePath) return;
    try {
      await fsp.mkdir(path.dirname(snapshotFilePath), {
        recursive: true,
        mode: 0o700,
      });
      const tmp = `${snapshotFilePath}.tmp.${process.pid}.${Date.now()}`;
      await fsp.writeFile(tmp, JSON.stringify(payloadObj), {
        encoding: "utf8",
        mode: 0o600,
      });
      await fsp.rename(tmp, snapshotFilePath);
    } catch {
      // ignore disk errors
    }
  }

  async function trySyncFromSingleSource(src) {
    const res = await executePoliteGet(src);
    const now = nowFn();

    if (res.notModified && lastKnownMatches && lastKnownMatches.length > 0) {
      markSourceSuccess(src.id, src.domainKey, now);
      state.lastOutboundBoardSyncAt = now;
      state.lastValidBoardAt = now;
      const isOff = src.tier === "official";
      const boardMeta = enrichBoardQuoteMeta(
        buildBoardFreshnessMeta({
          source: isOff ? "official-live" : "multisource-backup",
          boardState: isOff ? "fresh" : "backup-live",
          lastValidBoardAt: now,
        }),
        lastKnownMatches,
        now
      );
      return {
        ok: true,
        result: {
          matches: lastKnownMatches,
          source: isOff ? "official-live" : "multisource-backup",
          providerId: src.id,
          boardMeta,
          syncNote: isOff
            ? `已核验${src.label}盘面无变动（${lastKnownMatches.length} 场在售）`
            : `已从${src.label}核验 ${lastKnownMatches.length} 场在售赛事（多源备份同步盘）`,
        },
      };
    }

    if (!res.ok) {
      const reason = res.reason || `HTTP_${res.status}`;
      if (reason !== "LOCAL_SLIDING_WINDOW_GUARD") {
        const isBlk =
          res.status === 403 || res.status === 429 || res.status === 567;
        markSourceFailure(src.id, src.domainKey, reason, isBlk, now);
      }
      return { ok: false, reason };
    }

    const soft = detectSoftBlockResponse(
      res.bodyText,
      res.status,
      src.tier === "official" ? 64 : 512
    );
    if (soft.blocked) {
      markSourceFailure(src.id, src.domainKey, soft.reason, true, now);
      return { ok: false, reason: soft.reason };
    }

    if (src.tier === "official") {
      let json;
      try {
        json = JSON.parse(res.bodyText);
      } catch {
        markSourceFailure(src.id, src.domainKey, "INVALID_JSON", true, now);
        return { ok: false, reason: "INVALID_JSON" };
      }
      const saleStatus = extractOfficialSaleStatus(json);
      if (saleStatus.known) {
        state.officialSaleOpen = saleStatus.isOpen;
        state.officialSaleCheckedDate = getBeijingParts(now).dateStr;
      }
      const parsed = parseSportteryRawJson(json);
      if (parsed.length === 0) {
        markSourceSuccess(src.id, src.domainKey, now);
        if (saleStatus.known && !saleStatus.isOpen) {
          return {
            ok: true,
            marketClosedByOfficial: true,
            result: await loadDiskSnapshotFallback("market-closed"),
          };
        }
        return {
          ok: true,
          emptyOfficial: true,
          result: await loadDiskSnapshotFallback("empty-board-fallback"),
        };
      }
      const merged = reconcileMatchesPoolsNonRegressive(
        lastKnownMatches,
        parsed,
        analyzeMatchMicroQuant
      );
      lastKnownMatches = merged;
      state.lastOutboundBoardSyncAt = now;
      state.lastValidBoardAt = now;
      markSourceSuccess(src.id, src.domainKey, now);
      await persistBoardSnapshotToDisk({ ...json, __capturedAt: now });

      const dropCount = merged.filter((m) =>
        Object.values(m.pools).some((p) =>
          p.options.some((o) => o.trend === -1)
        )
      ).length;
      const boardMeta = enrichBoardQuoteMeta(
        buildBoardFreshnessMeta({
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: now,
        }),
        merged,
        now
      );
      return {
        ok: true,
        result: {
          matches: merged,
          rawJson: json,
          source: "official-live",
          providerId: src.id,
          boardMeta,
          syncNote: `已从${src.label}同步 ${merged.length} 场在售实盘赛事｜检测到 ${dropCount} 场存在官方降水异动`,
        },
      };
    }

    // Backup public site parsing
    let parsedBackup = [];
    if (src.id === "500-hunhe") {
      parsedBackup = parse500HunheHtml(res.bodyText, now);
    } else if (src.id === "zgzcw-jc") {
      parsedBackup = parseZgzcwJcHtml(res.bodyText, now);
    } else if (src.id === "okooo-hunhe") {
      parsedBackup = parseOkoooHunheHtml(
        res.bodyText,
        now,
        lastKnownMatches || []
      );
    }

    if (parsedBackup.length === 0) {
      markSourceFailure(
        src.id,
        src.domainKey,
        "EMPTY_OR_SCHEMA_CHANGED",
        false,
        now
      );
      return { ok: false, reason: "EMPTY_OR_SCHEMA_CHANGED" };
    }

    const withInheritedSubs = mergePartialBackupSubPools(
      lastKnownMatches,
      parsedBackup
    );
    const merged = reconcileMatchesPoolsNonRegressive(
      lastKnownMatches,
      withInheritedSubs,
      analyzeMatchMicroQuant
    );
    lastKnownMatches = merged;
    state.lastOutboundBoardSyncAt = now;
    state.lastValidBoardAt = now;
    markSourceSuccess(src.id, src.domainKey, now);
    await persistBoardSnapshotToDisk({
      __capturedAt: now,
      __providerId: src.id,
      __normalizedMatches: merged,
    });

    const boardMeta = enrichBoardQuoteMeta(
      buildBoardFreshnessMeta({
        source: "multisource-backup",
        boardState: "backup-live",
        lastValidBoardAt: now,
      }),
      merged,
      now
    );
    return {
      ok: true,
      result: {
        matches: merged,
        source: "multisource-backup",
        providerId: src.id,
        boardMeta,
        syncNote: `已通过${src.label}轮转同步 ${merged.length} 场在售赛事（多源备份同步盘 · 支持看盘精算与模拟观察单）`,
      },
    };
  }

  /**
   * 常规/手动盘面同步入口（严格遵守开休市静默门禁、手动 5 分钟防抖、五源随机抽签与 0 重试故障秒切）
   */
  async function syncLiveBoard({
    isManualRefresh = false,
    onlyOfficial = false,
  } = {}) {
    const now = nowFn();
    if (enforceMarketHours) {
      const gate = evaluateMarketHoursGate({
        nowMs: now,
        officialSaleOpen: state.officialSaleOpen,
        officialSaleCheckedDate: state.officialSaleCheckedDate,
        matches: lastKnownMatches || [],
      });
      if (!gate.isOpen) {
        return loadDiskSnapshotFallback("market-closed");
      }
    }

    const isFreshPush =
      !onlyOfficial &&
      state.lastOfficialPushAt &&
      now >= state.lastOfficialPushAt &&
      now - state.lastOfficialPushAt < officialPushFreshTtlMs;
    if (isFreshPush && (!lastKnownMatches || lastKnownMatches.length === 0)) {
      await loadDiskSnapshotFallback("fresh");
    }
    if (isFreshPush && lastKnownMatches && lastKnownMatches.length > 0) {
      const boardMeta = enrichBoardQuoteMeta(
        buildBoardFreshnessMeta({
          source: "official-live",
          boardState: "fresh",
          lastValidBoardAt: state.lastOfficialPushAt,
        }),
        lastKnownMatches,
        now
      );
      return {
        matches: lastKnownMatches,
        source: "official-live",
        providerId: "signed-push",
        boardMeta,
        syncNote: `已锁定本机官方权威盘（35 分钟鲜活护栏生效中 · ${lastKnownMatches.length} 场在售实盘）`,
      };
    }

    if (
      isManualRefresh &&
      !onlyOfficial &&
      state.lastOutboundBoardSyncAt > 0 &&
      now - state.lastOutboundBoardSyncAt < manualRefreshMinIntervalMs &&
      lastKnownMatches &&
      lastKnownMatches.length > 0
    ) {
      const remainSec = Math.ceil(
        (manualRefreshMinIntervalMs - (now - state.lastOutboundBoardSyncAt)) /
          1000
      );
      const isOff = lastKnownMatches.some((m) =>
        Object.values(m.pools || {}).some(
          (p) => p?.confirmedSaleRights?.single || p?.confirmedSaleRights?.allUp
        )
      );
      const boardMeta = enrichBoardQuoteMeta(
        buildBoardFreshnessMeta({
          source: isOff ? "official-live" : "multisource-backup",
          boardState: isOff ? "fresh" : "backup-live",
          lastValidBoardAt: state.lastValidBoardAt ?? now,
        }),
        lastKnownMatches,
        now
      );
      return {
        matches: lastKnownMatches,
        source: boardMeta.source,
        boardMeta,
        debounced: true,
        syncNote: `防封限流保护中（距上次同步不足 5 分钟，约 ${remainSec} 秒后可再次外网拉取）· 当前已展示最新盘面`,
      };
    }

    if (inFlightBoardSync && !onlyOfficial) return inFlightBoardSync;

    const runSync = (async () => {
      const curNow = nowFn();
      const eligible = LIVE_SPORTTERY_SOURCES.filter((s) => {
        if (onlyOfficial && s.tier !== "official") return false;
        const h = state.sourceHealth[s.id];
        return !h?.cooldownUntil || curNow >= h.cooldownUntil;
      });

      const ordered = selectWeightedRandomCandidates(eligible);
      const maxAttempts = onlyOfficial ? 2 : 3;
      let tried = 0;
      for (const src of ordered) {
        if (tried >= maxAttempts) break;
        tried += 1;
        const attempt = await trySyncFromSingleSource(src);
        if (attempt.ok) {
          return attempt.result;
        }
        // 0 retries on failed source — immediately try next distinct source in pool
      }
      return await loadDiskSnapshotFallback("timeout-fallback");
    })();

    if (!onlyOfficial) {
      inFlightBoardSync = runSync;
      void runSync
        .finally(() => {
          if (inFlightBoardSync === runSync) {
            inFlightBoardSync = null;
          }
        })
        .catch(() => {});
    }
    return runSync;
  }

  /**
   * 实票导出/记实买前轻量官方核对（若当前为多源备份同步盘且官方源未在冷却中，尝试单次升级至权威盘）
   */
  async function verifyOfficialBoardForRealTicket() {
    return syncLiveBoard({ isManualRefresh: false, onlyOfficial: true });
  }

  async function loadDiskResultsCacheInto(targetMap) {
    if (!resultsCacheFilePath || !fs.existsSync(resultsCacheFilePath)) return;
    try {
      const raw = JSON.parse(await fsp.readFile(resultsCacheFilePath, "utf8"));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item?.matchId) targetMap.set(String(item.matchId), item);
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * 多源完场 90 分钟赛果同步（官方主源 + 500/澳客/球探多源自动兜底，同样遵守休市与滑动窗口限流）
   */
  async function syncMatchResults({
    beginDate,
    endDate,
    historyResultsById = null,
    forceRefresh = false,
    hasPendingSettlement = true,
  } = {}) {
    const now = nowFn();
    const bj = getBeijingParts(now);
    const buildClosedFallbackMap = async () => {
      const out = new Map();
      await loadDiskResultsCacheInto(out);
      if (historyResultsById instanceof Map) {
        for (const [k, v] of historyResultsById.entries()) out.set(k, v);
      }
      for (const [k, v] of pushedResultsById.entries()) out.set(k, v);
      return out;
    };
    if (enforceMarketHours) {
      // 01:30 ~ 11:00 彻底休眠不拉赛果；无待结订单时夜间休市也不拉赛果
      const morningWake =
        11 * 3_600_000 + computeDailyMorningWakeOffsetMs(bj.dateStr);
      if (
        bj.msSinceMidnight >= 90 * 60_000 &&
        bj.msSinceMidnight < morningWake
      ) {
        return await buildClosedFallbackMap();
      }
      if (!hasPendingSettlement) {
        const gate = evaluateMarketHoursGate({
          nowMs: now,
          officialSaleOpen: state.officialSaleOpen,
          officialSaleCheckedDate: state.officialSaleCheckedDate,
          matches: lastKnownMatches || [],
        });
        if (!gate.isOpen) {
          return await buildClosedFallbackMap();
        }
      }
    }

    const canCoalesce = !beginDate && !endDate && !forceRefresh;
    if (canCoalesce && inFlightResultsSync) return inFlightResultsSync;

    const runResultsSync = (async () => {
      const toBjDate = (ms) =>
        new Date(ms + BJ_OFFSET_MS).toISOString().slice(0, 10);
      const resolvedEnd = endDate || toBjDate(now + 86_400_000);
      const resolvedBegin = beginDate || toBjDate(now - 14 * 86_400_000);
      const merged = new Map();
      await loadDiskResultsCacheInto(merged);
      if (historyResultsById instanceof Map) {
        for (const [k, v] of historyResultsById.entries()) merged.set(k, v);
      }
      for (const [k, v] of pushedResultsById.entries()) merged.set(k, v);

      if (
        !beginDate &&
        !endDate &&
        (pushedResultsById.size > 0 || merged.size > 0) &&
        state.lastOfficialResultsPushAt &&
        now >= state.lastOfficialResultsPushAt &&
        now - state.lastOfficialResultsPushAt < officialPushFreshTtlMs
      ) {
        return merged;
      }

      // 1) Try Official UniformMatchResult if not cooling down
      const offSrc = {
        id: "sporttery-results",
        label: "体彩官方赛果",
        tier: "official",
        domainKey: "webapi.sporttery.cn:results",
        host: "webapi.sporttery.cn",
        referer: "https://www.sporttery.cn/",
        origin: "https://www.sporttery.cn",
        accept: "application/json, text/plain, */*",
        encoding: "utf-8",
        preferMobile: false,
      };
      const offHealth = state.sourceHealth[offSrc.id];
      if (!offHealth?.cooldownUntil || now >= offHealth.cooldownUntil) {
        const windows = splitDateRangeIntoWindows(
          resolvedBegin,
          resolvedEnd,
          60
        );
        let okAll = windows.length > 0;
        const fresh = new Map();
        for (const win of windows) {
          let expectedPages = 1;
          let expectedTotal = null;
          const uniq = new Set();
          let verified = 0;
          for (let pageNo = 1; pageNo <= expectedPages; pageNo++) {
            const url = `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${encodeURIComponent(
              win.beginDate
            )}&matchEndDate=${encodeURIComponent(
              win.endDate
            )}&leagueId=&pageSize=100&pageNo=${pageNo}&isFix=0&matchPage=1&pcOrWap=1`;
            const r = await executePoliteGet(offSrc, url, 5_500);
            if (!r.ok) {
              if (r.reason !== "LOCAL_SLIDING_WINDOW_GUARD") {
                markSourceFailure(
                  offSrc.id,
                  offSrc.domainKey,
                  r.reason || `HTTP_${r.status}`,
                  r.status === 403 || r.status === 429 || r.status === 567,
                  nowFn()
                );
              }
              okAll = false;
              break;
            }
            try {
              const j = JSON.parse(r.bodyText);
              if (j?.value?.total !== undefined && j?.value?.total !== null) {
                expectedTotal = Number(j.value.total);
              }
              const repPages = Number(j?.value?.pages ?? 1);
              expectedPages =
                expectedTotal === 0
                  ? 0
                  : Math.max(1, Number.isFinite(repPages) ? repPages : 1);
              const pm = parseSportteryResultsJson(j);
              for (const [k, v] of pm.entries()) {
                fresh.set(k, v);
                uniq.add(k);
              }
              if (expectedPages > 0) verified += 1;
              if (expectedPages === 0 || pageNo >= expectedPages) break;
            } catch {
              markSourceFailure(
                offSrc.id,
                offSrc.domainKey,
                "INVALID_JSON",
                true,
                nowFn()
              );
              okAll = false;
              break;
            }
          }
          if (!okAll) break;
          const pagesOk =
            expectedPages === 0 ? true : verified === expectedPages;
          const totalOk =
            expectedTotal === null ? true : uniq.size === expectedTotal;
          if (!pagesOk || !totalOk) {
            okAll = false;
            break;
          }
        }
        if (okAll && fresh.size > 0) {
          markSourceSuccess(offSrc.id, offSrc.domainKey, nowFn());
          for (const [k, v] of fresh.entries()) merged.set(k, v);
          await persistResultsCache(merged);
          return merged;
        }
      }

      // 2) Backup multi-source result resolution (500 canonical ID map + Titan007 / Okooo half+full scores)
      const idLookup = new Map();
      for (const m of lastKnownMatches || []) {
        if (m?.id && m?.matchNumStr) {
          idLookup.set(String(m.matchNumStr), String(m.id));
          if (m.matchDate) {
            idLookup.set(`${m.matchDate}|${m.matchNumStr}`, String(m.id));
            idLookup.set(
              `${m.matchDate.slice(5, 10)}|${m.matchNumStr}`,
              String(m.id)
            );
          }
        }
      }

      const recentDates = [
        toBjDate(now),
        toBjDate(now - 86_400_000),
        toBjDate(now - 2 * 86_400_000),
      ];
      const src500Date = {
        id: "500-date-ids",
        domainKey: "trade.500.com",
        host: "trade.500.com",
        referer: "https://trade.500.com/jczq/",
        accept: "text/html,*/*;q=0.8",
        encoding: "gb18030",
        preferMobile: false,
      };
      const h500 = state.sourceHealth[src500Date.id];
      if (!h500?.cooldownUntil || now >= h500.cooldownUntil) {
        for (const d of recentDates.slice(0, 2)) {
          const r = await executePoliteGet(
            src500Date,
            `https://trade.500.com/jczq/?date=${d}`,
            5_500
          );
          if (r.ok && r.bodyText) {
            const { lookup } = parse500HistoricalIdsHtml(r.bodyText);
            for (const [k, v] of lookup.entries()) idLookup.set(k, v);
            markSourceSuccess(src500Date.id, src500Date.domainKey, nowFn());
          } else {
            if (r.reason !== "LOCAL_SLIDING_WINDOW_GUARD") {
              markSourceFailure(
                src500Date.id,
                src500Date.domainKey,
                r.reason || `HTTP_${r.status}`,
                false,
                nowFn()
              );
            }
            break;
          }
        }
      }

      // Try Titan007 JcResult (fast 3KB half+full score) or Okooo Kaijiang
      const srcTitan = {
        id: "titan007-results",
        domainKey: "jc.titan007.com",
        host: "jc.titan007.com",
        referer: "https://jc.titan007.com/",
        accept: "text/plain, */*;q=0.8",
        encoding: "utf-8",
        preferMobile: false,
      };
      const hTitan = state.sourceHealth[srcTitan.id];
      if (
        (!hTitan?.cooldownUntil || now >= hTitan.cooldownUntil) &&
        idLookup.size > 0
      ) {
        for (const d of recentDates.slice(0, 2)) {
          const r = await executePoliteGet(
            srcTitan,
            `https://jc.titan007.com/handle/JcResult.aspx?d=${d}`,
            5_000
          );
          if (r.ok && r.bodyText) {
            const parsedMap = parseTitanJcResultText(r.bodyText, idLookup);
            for (const [k, v] of parsedMap.entries()) merged.set(k, v);
            markSourceSuccess(srcTitan.id, srcTitan.domainKey, nowFn());
          } else {
            if (r.reason !== "LOCAL_SLIDING_WINDOW_GUARD") {
              markSourceFailure(
                srcTitan.id,
                srcTitan.domainKey,
                r.reason || `HTTP_${r.status}`,
                false,
                nowFn()
              );
            }
            break;
          }
        }
      }

      if (merged.size === 0 && idLookup.size > 0) {
        const srcOkoKj = {
          id: "okooo-results",
          domainKey: "www.okooo.com",
          host: "www.okooo.com",
          referer: "https://www.okooo.com/jingcai/",
          accept: "text/html,*/*;q=0.8",
          encoding: "gb18030",
          preferMobile: false,
        };
        const hOko = state.sourceHealth[srcOkoKj.id];
        if (!hOko?.cooldownUntil || now >= hOko.cooldownUntil) {
          const r = await executePoliteGet(
            srcOkoKj,
            "https://www.okooo.com/jingcai/kaijiang/",
            6_000
          );
          if (r.ok && r.bodyText) {
            const pm = parseOkoooKaijiangHtml(r.bodyText, idLookup);
            for (const [k, v] of pm.entries()) merged.set(k, v);
            markSourceSuccess(srcOkoKj.id, srcOkoKj.domainKey, nowFn());
          } else if (r.reason !== "LOCAL_SLIDING_WINDOW_GUARD") {
            markSourceFailure(
              srcOkoKj.id,
              srcOkoKj.domainKey,
              r.reason || `HTTP_${r.status}`,
              false,
              nowFn()
            );
          }
        }
      }

      for (const [k, v] of pushedResultsById.entries()) merged.set(k, v);
      if (merged.size > 0) {
        await persistResultsCache(merged);
        return merged;
      }

      return merged;
    })();

    if (canCoalesce) {
      inFlightResultsSync = runResultsSync;
      void runResultsSync
        .finally(() => {
          if (inFlightResultsSync === runResultsSync) {
            inFlightResultsSync = null;
          }
        })
        .catch(() => {});
    }
    return runResultsSync;
  }

  async function persistResultsCache(resultsMap) {
    if (
      !resultsCacheFilePath ||
      !(resultsMap instanceof Map) ||
      resultsMap.size === 0
    ) {
      return;
    }
    try {
      await fsp.mkdir(path.dirname(resultsCacheFilePath), {
        recursive: true,
        mode: 0o700,
      });
      const tmp = `${resultsCacheFilePath}.tmp.${process.pid}.${Date.now()}`;
      await fsp.writeFile(
        tmp,
        JSON.stringify(Array.from(resultsMap.values())),
        { encoding: "utf8", mode: 0o600 }
      );
      await fsp.rename(tmp, resultsCacheFilePath);
    } catch {
      // ignore
    }
  }

  /**
   * 计算下一次后台自动同步等待毫秒数（整合休市睡眠与开市全时段 ~18-22m 无规律反整刻钟随机间隔）
   */
  function computeNextBackgroundDelayMs() {
    const now = nowFn();
    if (enforceMarketHours) {
      const gate = evaluateMarketHoursGate({
        nowMs: now,
        officialSaleOpen: state.officialSaleOpen,
        officialSaleCheckedDate: state.officialSaleCheckedDate,
        matches: lastKnownMatches || [],
      });
      if (!gate.isOpen) {
        return gate.nextWakeDelayMs;
      }
    }
    return computePoliteRandomIntervalMs(now, randomFn);
  }

  /**
   * 记录真实用户会话访问时间戳（刷新逻辑统一收口至 appRoutes.ensureMatchesLoaded）
   */
  function recordUserActivity() {
    state.lastUserActivityAt = nowFn();
  }

  /**
   * 国内轻节点 HMAC-SHA256 验签快照接收口（防重放 ±300s + nonce 去重）
   */
  async function ingestSignedPushSnapshot({
    rawBodyText,
    timestampHeader,
    nonceHeader,
    signatureHeader,
  }) {
    if (!pushHmacSecret) {
      return { ok: false, status: 404, error: "PUSH_DISABLED" };
    }
    const now = nowFn();
    const ts = Number(timestampHeader);
    const nonce = String(nonceHeader || "").trim();
    const sig = String(signatureHeader || "")
      .trim()
      .toLowerCase();
    if (
      !Number.isFinite(ts) ||
      Math.abs(now - ts) > 300_000 ||
      nonce.length < 8 ||
      nonce.length > 128 ||
      !/^[0-9a-f]{64}$/.test(sig)
    ) {
      return { ok: false, status: 401, error: "INVALID_PUSH_AUTH" };
    }
    // Prune expired nonces
    for (const [k, exp] of Object.entries(state.usedPushNonces)) {
      if (exp < now) delete state.usedPushNonces[k];
    }
    if (state.usedPushNonces[nonce]) {
      return { ok: false, status: 409, error: "NONCE_REPLAYED" };
    }
    const expected = crypto
      .createHmac("sha256", pushHmacSecret)
      .update(`${ts}.${nonce}.${rawBodyText}`)
      .digest("hex");
    const okSig = crypto.timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(expected, "hex")
    );
    if (!okSig) {
      return { ok: false, status: 401, error: "BAD_SIGNATURE" };
    }
    state.usedPushNonces[nonce] = now + 310_000;

    let json;
    try {
      json = JSON.parse(rawBodyText);
    } catch {
      return { ok: false, status: 400, error: "INVALID_JSON" };
    }
    const calcPayload =
      json &&
      typeof json === "object" &&
      json.calculatorRaw &&
      typeof json.calculatorRaw === "object"
        ? json.calculatorRaw
        : json;
    const parsed = parseSportteryRawJson(calcPayload);
    if (parsed.length === 0) {
      return { ok: false, status: 422, error: "EMPTY_MATCHES" };
    }

    const saleStatus = extractOfficialSaleStatus(calcPayload);
    if (saleStatus.known) {
      state.officialSaleOpen = saleStatus.isOpen;
      state.officialSaleCheckedDate = getBeijingParts(now).dateStr;
    }

    const rawResultsList = Array.isArray(json?.__officialResultsRaw)
      ? json.__officialResultsRaw
      : Array.isArray(json?.resultsRawList)
        ? json.resultsRawList
        : [];
    const batchResults = new Map();
    for (const rawResItem of rawResultsList) {
      if (!rawResItem || typeof rawResItem !== "object") continue;
      const parsedResMap = parseSportteryResultsJson(rawResItem);
      for (const [k, v] of parsedResMap.entries()) {
        batchResults.set(k, v);
        pushedResultsById.set(k, v);
      }
    }

    const merged = reconcileMatchesPoolsNonRegressive(
      lastKnownMatches,
      parsed,
      analyzeMatchMicroQuant
    );
    lastKnownMatches = merged;
    state.lastOutboundBoardSyncAt = now;
    state.lastValidBoardAt = now;
    state.lastOfficialPushAt = now;
    if (batchResults.size > 0) {
      state.lastOfficialResultsPushAt = now;
    }

    if (batchResults.size > 0) {
      const diskMerged = new Map();
      await loadDiskResultsCacheInto(diskMerged);
      for (const [k, v] of pushedResultsById.entries()) diskMerged.set(k, v);
      await persistResultsCache(diskMerged);
    }
    await persistStateNonBlocking();
    await persistBoardSnapshotToDisk({ ...calcPayload, __capturedAt: now });
    const boardMeta = enrichBoardQuoteMeta(
      buildBoardFreshnessMeta({
        source: "official-live",
        boardState: "fresh",
        lastValidBoardAt: now,
      }),
      merged,
      now
    );
    return {
      ok: true,
      status: 200,
      matchesCount: merged.length,
      resultsCount: batchResults.size,
      boardMeta,
      matches: merged,
    };
  }

  function getAntiBanStatusSnapshot() {
    const now = nowFn();
    const gate = evaluateMarketHoursGate({
      nowMs: now,
      officialSaleOpen: state.officialSaleOpen,
      officialSaleCheckedDate: state.officialSaleCheckedDate,
      matches: lastKnownMatches || [],
    });
    return {
      marketGate: gate,
      isUserActive: now - (state.lastUserActivityAt || 0) <= idleThresholdMs,
      lastOutboundBoardSyncAt: state.lastOutboundBoardSyncAt || null,
      lastValidBoardAt: state.lastValidBoardAt,
      sources: LIVE_SPORTTERY_SOURCES.map((s) => {
        const h = state.sourceHealth[s.id] || {};
        const coolingMs =
          h.cooldownUntil && h.cooldownUntil > now ? h.cooldownUntil - now : 0;
        return {
          id: s.id,
          label: s.label,
          tier: s.tier,
          successCount: h.successCount || 0,
          failCount: h.failCount || 0,
          consecutiveFailures: h.consecutiveFailures || 0,
          coolingRemainingSec: Math.ceil(coolingMs / 1000),
          lastError: h.lastError || null,
          profileId: state.domainProfiles[s.domainKey]?.profileId || null,
        };
      }),
    };
  }

  return {
    syncLiveBoard,
    verifyOfficialBoardForRealTicket,
    syncMatchResults,
    computeNextBackgroundDelayMs,
    recordUserActivity,
    ingestSignedPushSnapshot,
    getAntiBanStatusSnapshot,
    isMarketOpenNow: () =>
      !enforceMarketHours ||
      evaluateMarketHoursGate({
        nowMs: nowFn(),
        officialSaleOpen: state.officialSaleOpen,
        officialSaleCheckedDate: state.officialSaleCheckedDate,
        matches: lastKnownMatches || [],
      }).isOpen,
  };
}
