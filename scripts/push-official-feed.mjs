#!/usr/bin/env node
// Standalone local workstation (M5) official China Sporttery feed pusher.
// Fetches official calculator odds & recent 3-day 90m results directly from domestic IP,
// signs with HMAC-SHA256 (anti-replay ts + nonce), and pushes to /api/internal/feed-push.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateMarketHoursGate,
  getBeijingParts,
} from "../server/politeScraperGateway.mjs";
import { splitDateRangeIntoWindows } from "../server/history/sportteryHistoryNormalizers.mjs";
import {
  parseSportteryRawJson,
  parseSportteryResultsJson,
} from "../server/quant/sportteryParsers.mjs";

const SPORTTERY_CALC_URL =
  "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c";

const DEFAULT_BROWSER_HEADERS = Object.freeze({
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: "https://www.sporttery.cn/",
  Origin: "https://www.sporttery.cn",
});

function parseEnvFile(filePath) {
  const out = {};
  if (!filePath || !fs.existsSync(filePath)) return out;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/**
 * 加载本机工作站推送配置（优先读取环境变量，其次读取 ~/.config/youjing-calculator/pusher.env）
 */
export function loadPusherConfig(opts = {}) {
  const env = opts.env || process.env;
  const envFilePath =
    opts.envFilePath ||
    path.join(os.homedir(), ".config", "youjing-calculator", "pusher.env");
  const fileEnv = parseEnvFile(envFilePath);
  const secret = String(
    opts.secret ??
      env.YOUJING_PUSH_HMAC_SECRET ??
      fileEnv.YOUJING_PUSH_HMAC_SECRET ??
      ""
  ).trim();
  const targetUrl = String(
    opts.targetUrl ??
      env.YOUJING_PUSH_TARGET_URL ??
      fileEnv.YOUJING_PUSH_TARGET_URL ??
      ""
  ).trim();
  return { secret, targetUrl, envFilePath };
}

function resolvePushEndpointUrl(targetUrl) {
  const clean = String(targetUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!clean) return "";
  return clean.endsWith("/api/internal/feed-push")
    ? clean
    : `${clean}/api/internal/feed-push`;
}

async function fetchJsonWithTimeout(
  fetchFn,
  url,
  init = {},
  timeoutMs = 8_000
) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: ac.signal });
    if (!res.ok) {
      return { ok: false, status: res.status || 0, data: null };
    }
    const data =
      typeof res.json === "function"
        ? await res.json()
        : JSON.parse(await res.text());
    return { ok: true, status: res.status || 200, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 单次执行体彩官网在售盘口与近 3 日 90 分钟赛果直采及签名推送
 */
export async function runOfficialFeedPushOnce(opts = {}) {
  const nowFn =
    typeof opts.nowFn === "function" ? opts.nowFn : () => Date.now();
  const fetchFn = opts.fetchFn || globalThis.fetch;
  const force = Boolean(opts.force);
  const dryRun = Boolean(opts.dryRun);
  const lookbackDays = Number.isFinite(Number(opts.lookbackDays))
    ? Math.max(0, Math.floor(Number(opts.lookbackDays)))
    : 2;

  const now = nowFn();
  if (!force) {
    const gate = evaluateMarketHoursGate({ nowMs: now });
    if (!gate.isOpen) {
      return {
        ok: true,
        skippedClosed: true,
        phase: gate.phase,
        reason: gate.reason,
      };
    }
  }

  const cfg = loadPusherConfig(opts);
  const endpointUrl = resolvePushEndpointUrl(cfg.targetUrl);
  if (!dryRun && (!cfg.secret || !endpointUrl)) {
    return {
      ok: false,
      error: "MISSING_PUSHER_CONFIG",
      message:
        "Missing YOUJING_PUSH_HMAC_SECRET or YOUJING_PUSH_TARGET_URL in env or pusher.env",
    };
  }

  const calcRes = await fetchJsonWithTimeout(
    fetchFn,
    SPORTTERY_CALC_URL,
    { method: "GET", headers: DEFAULT_BROWSER_HEADERS },
    10_000
  );
  if (!calcRes.ok || !calcRes.data) {
    return {
      ok: false,
      status: calcRes.status,
      error: "OFFICIAL_CALC_FETCH_FAILED",
    };
  }

  const parsedMatches = parseSportteryRawJson(calcRes.data);
  if (parsedMatches.length === 0) {
    return {
      ok: true,
      skippedEmpty: true,
      matchesCount: 0,
      resultsCount: 0,
    };
  }

  const beginDate = getBeijingParts(now - lookbackDays * 86_400_000).dateStr;
  const endDate = getBeijingParts(now).dateStr;
  const windows = splitDateRangeIntoWindows(beginDate, endDate, 60);
  const officialResultsRaw = [];
  const parsedResultsMap = new Map();

  for (const win of windows) {
    let expectedPages = 1;
    for (let pageNo = 1; pageNo <= expectedPages && pageNo <= 5; pageNo++) {
      const resUrl = `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${encodeURIComponent(
        win.beginDate
      )}&matchEndDate=${encodeURIComponent(
        win.endDate
      )}&leagueId=&pageSize=100&pageNo=${pageNo}&isFix=0&matchPage=1&pcOrWap=1`;
      const r = await fetchJsonWithTimeout(
        fetchFn,
        resUrl,
        { method: "GET", headers: DEFAULT_BROWSER_HEADERS },
        10_000
      ).catch(() => ({ ok: false, status: 0, data: null }));
      if (!r.ok || !r.data) break;
      officialResultsRaw.push(r.data);
      const pageMap = parseSportteryResultsJson(r.data);
      for (const [k, v] of pageMap.entries()) parsedResultsMap.set(k, v);
      const repPages = Number(r.data?.value?.pages ?? 1);
      expectedPages = Number.isFinite(repPages) ? Math.max(1, repPages) : 1;
    }
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      matchesCount: parsedMatches.length,
      resultsCount: parsedResultsMap.size,
    };
  }

  const payload = {
    ...calcRes.data,
    __officialResultsRaw: officialResultsRaw,
  };
  const bodyText = JSON.stringify(payload);
  const ts = String(nowFn());
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = crypto
    .createHmac("sha256", cfg.secret)
    .update(`${ts}.${nonce}.${bodyText}`)
    .digest("hex");

  const pushRes = await fetchJsonWithTimeout(
    fetchFn,
    endpointUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "YouJingM5Pusher/1.0",
        Accept: "*/*",
        "x-yj-push-ts": ts,
        "x-yj-push-nonce": nonce,
        "x-yj-push-sig": sig,
      },
      body: bodyText,
    },
    12_000
  );

  if (!pushRes.ok) {
    return {
      ok: false,
      status: pushRes.status,
      error: "PUSH_TARGET_REJECTED",
    };
  }

  return {
    ok: true,
    matchesCount: pushRes.data?.matchesCount ?? parsedMatches.length,
    resultsCount: pushRes.data?.resultsCount ?? parsedResultsMap.size,
    quoteVersion: pushRes.data?.quoteVersion ?? null,
  };
}

const BJ_OFFSET_MS = 8 * 3600_000;

/**
 * 计算避开 :00/:15/:30/:45 ±35 秒与整分钟 :00 栅格的安全启动抖动（[17_000, 163_000]ms）
 */
export function computeSafeLaunchJitterMs(
  nowMs = Date.now(),
  randomFn = Math.random
) {
  const minMs = 17_000;
  const maxMs = 163_000;
  const u1 = Math.max(0, Math.min(0.999999, Number(randomFn()) || 0));
  const u2 = Math.max(0, Math.min(0.999999, Number(randomFn()) || 0));
  const isSafe = (candMs) => {
    if (candMs < minMs || candMs > maxMs || candMs % 60_000 === 0) return false;
    const targetBjMs = nowMs + candMs + BJ_OFFSET_MS;
    const secInHour =
      (((targetBjMs % 3_600_000) + 3_600_000) % 3_600_000) / 1000;
    const remQ = secInHour % 900;
    if (Math.min(remQ, 900 - remQ) <= 35) return false;
    const modMin = ((targetBjMs % 60_000) + 60_000) % 60_000;
    return modMin >= 1_500 && modMin <= 58_500;
  };
  const safeSlots = [];
  const baseSub = Math.floor(u2 * 997);
  for (let k = 0; k <= 145; k++) {
    const subMs = ((baseSub + k * 271) % 991) + 1;
    const cand = minMs + k * 1000 + subMs;
    if (isSafe(cand)) safeSlots.push(cand);
  }
  if (safeSlots.length > 0) {
    return safeSlots[
      Math.min(safeSlots.length - 1, Math.floor(u1 * safeSlots.length))
    ];
  }
  return minMs + Math.floor(u1 * (maxMs - minMs));
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const args = new Set(process.argv.slice(2));
  const force = args.has("--force");
  const noJitter = args.has("--no-jitter");
  const dryRun = args.has("--dry-run");

  (async () => {
    if (!force && !noJitter) {
      const gate = evaluateMarketHoursGate({ nowMs: Date.now() });
      if (!gate.isOpen) {
        console.log(
          JSON.stringify({
            ok: true,
            skippedClosed: true,
            phase: gate.phase,
            reason: gate.reason,
          })
        );
        return;
      }
      const jitterMs = computeSafeLaunchJitterMs(Date.now());
      await new Promise((r) => setTimeout(r, jitterMs));
    }
    const result = await runOfficialFeedPushOnce({ force, dryRun });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  })().catch((err) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: err?.message || "UNEXPECTED_PUSHER_ERROR",
      })
    );
    process.exit(1);
  });
}
