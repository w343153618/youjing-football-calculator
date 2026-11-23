// Upstream China Sporttery live odds & 90-minute match result feed adapter with disk/memory cache.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  FALLBACK_MATCHES,
  parseSportteryRawJson,
  parseSportteryResultsJson,
} from "./quant/sportteryParsers.mjs";
import {
  buildBoardFreshnessMeta,
  parseBeijingDateTimeMs,
  splitDateRangeIntoWindows,
} from "./history/sportteryHistoryNormalizers.mjs";

export { FALLBACK_MATCHES, parseSportteryRawJson, parseSportteryResultsJson };

/** 服务端体彩实盘同步（带内存热缓存、磁盘快照与板级时效元数据透传） */
export async function fetchOfficialMatchesServer(snapshotFilePath, opts = {}) {
  const fetchImpl = opts.fetchFn || globalThis.fetch;
  const nowFn =
    typeof opts.nowFn === "function" ? opts.nowFn : () => Date.now();
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs))
    ? Number(opts.timeoutMs)
    : 4500;
  const fallbackValidAt =
    typeof opts.lastValidBoardAt === "number" &&
    Number.isFinite(opts.lastValidBoardAt)
      ? opts.lastValidBoardAt
      : null;

  let failureBoardState = "timeout-fallback";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(
        "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c",
        { signal: controller.signal }
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = parseSportteryRawJson(json);
        if (parsed.length > 0) {
          const capturedAt = nowFn();
          if (snapshotFilePath) {
            await fsp
              .mkdir(path.dirname(snapshotFilePath), {
                recursive: true,
                mode: 0o700,
              })
              .catch(() => {});
            const tmpPath = `${snapshotFilePath}.tmp.${process.pid}.${Date.now()}`;
            await fsp
              .writeFile(
                tmpPath,
                JSON.stringify({ ...json, __capturedAt: capturedAt }),
                { encoding: "utf-8", mode: 0o600 }
              )
              .then(() => fsp.rename(tmpPath, snapshotFilePath))
              .catch(() => fsp.unlink(tmpPath).catch(() => {}));
          }
          const dropCount = parsed.filter((m) =>
            Object.values(m.pools).some((p) =>
              p.options.some((o) => o.trend === -1)
            )
          ).length;
          const boardMeta = buildBoardFreshnessMeta({
            source: "official-live",
            boardState: "fresh",
            lastValidBoardAt: capturedAt,
          });
          return {
            matches: parsed,
            rawJson: json,
            source: "official-live",
            boardMeta,
            syncNote: `已从中国体彩官网同步 ${parsed.length} 场在售实盘赛事｜检测到 ${dropCount} 场存在官方降水异动`,
          };
        }
        failureBoardState = "empty-board-fallback";
      } else if (Number(res.status) >= 500) {
        failureBoardState = "maintenance-fallback";
      } else {
        failureBoardState = "timeout-fallback";
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    failureBoardState = "timeout-fallback";
  }

  if (snapshotFilePath && fs.existsSync(snapshotFilePath)) {
    try {
      const raw = await fsp.readFile(snapshotFilePath, "utf-8");
      const snapJson = JSON.parse(raw);
      const parsed = parseSportteryRawJson(snapJson);
      if (parsed.length > 0) {
        const snapCapturedAt =
          (typeof snapJson?.__capturedAt === "number" &&
          Number.isFinite(snapJson.__capturedAt)
            ? snapJson.__capturedAt
            : null) ??
          parseBeijingDateTimeMs(snapJson?.value?.lastUpdateTime) ??
          (() => {
            try {
              return fs.statSync(snapshotFilePath).mtimeMs;
            } catch {
              return null;
            }
          })() ??
          fallbackValidAt;

        const boardMeta = buildBoardFreshnessMeta({
          source: "cached-snapshot",
          boardState: failureBoardState,
          lastValidBoardAt: snapCapturedAt,
        });
        return {
          matches: parsed,
          source: "cached-snapshot",
          boardMeta,
          syncNote:
            boardMeta.bannerText ||
            `已载入体彩本地缓存快照 ${parsed.length} 场赛事（只读参考）`,
        };
      }
    } catch {
      // fallback to built-in
    }
  }

  const builtinState =
    failureBoardState === "empty-board-fallback"
      ? "empty-board-fallback"
      : fallbackValidAt !== null
        ? failureBoardState
        : "builtin-fallback";
  const boardMeta = buildBoardFreshnessMeta({
    source: "fallback",
    boardState: builtinState,
    lastValidBoardAt: fallbackValidAt,
  });

  return {
    matches: FALLBACK_MATCHES,
    source: "fallback",
    boardMeta,
    syncNote: `使用内置实盘快照（共 ${FALLBACK_MATCHES.length} 场精选赛事）`,
  };
}

let OFFICIAL_RESULTS_MEM_CACHE = {
  key: "",
  fetchedAt: 0,
  resultsById: new Map(),
};

/**
 * 服务端拉取中国体彩官方完场赛果（带 180 秒内存热缓存与磁盘快照回退）
 */
export async function fetchOfficialMatchResultsServer(opts = {}) {
  const nowMs = Number.isFinite(Number(opts.nowMs))
    ? Number(opts.nowMs)
    : Date.now();
  const toBjDate = (ms) =>
    new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
  const endDate = opts.endDate || toBjDate(nowMs + 86_400_000);
  const beginDate = opts.beginDate || toBjDate(nowMs - 14 * 86_400_000);
  const cacheKey = `${beginDate}..${endDate}`;
  const ttlMs = Number.isFinite(Number(opts.ttlMs))
    ? Number(opts.ttlMs)
    : 180_000;

  if (
    !opts.forceRefresh &&
    OFFICIAL_RESULTS_MEM_CACHE.key === cacheKey &&
    nowMs - OFFICIAL_RESULTS_MEM_CACHE.fetchedAt < ttlMs &&
    OFFICIAL_RESULTS_MEM_CACHE.resultsById.size > 0
  ) {
    return OFFICIAL_RESULTS_MEM_CACHE.resultsById;
  }

  const fetchImpl = opts.fetchFn || globalThis.fetch;
  const cacheFilePath = opts.cacheFilePath || null;
  const historyResultsMap =
    opts.historyResultsById instanceof Map ? opts.historyResultsById : null;
  const merged = new Map();
  if (historyResultsMap) {
    for (const [k, v] of historyResultsMap.entries()) {
      merged.set(k, v);
    }
  }

  const windows = splitDateRangeIntoWindows(beginDate, endDate, 60);
  let allWindowsComplete = windows.length > 0;
  const freshWindowResults = new Map();

  try {
    for (const win of windows) {
      let expectedPages = 1;
      let expectedTotal = null;
      const winUniqueIds = new Set();
      let winVerifiedPages = 0;

      for (let pageNo = 1; pageNo <= expectedPages; pageNo++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        try {
          const url = `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${encodeURIComponent(
            win.beginDate
          )}&matchEndDate=${encodeURIComponent(
            win.endDate
          )}&leagueId=&pageSize=100&pageNo=${pageNo}&isFix=0&matchPage=1&pcOrWap=1`;
          const res = await fetchImpl(url, {
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
              Referer: "https://www.sporttery.cn/",
              Accept: "application/json",
            },
          });
          if (!res.ok) {
            allWindowsComplete = false;
            break;
          }
          const json = await res.json();
          if (
            json?.value?.total !== undefined &&
            json?.value?.total !== null &&
            Number.isFinite(Number(json.value.total))
          ) {
            expectedTotal = Number(json.value.total);
          }
          const reportedPages = Number(json?.value?.pages ?? 1);
          expectedPages =
            expectedTotal === 0
              ? 0
              : Math.max(1, Number.isFinite(reportedPages) ? reportedPages : 1);

          const pageMap = parseSportteryResultsJson(json);
          for (const [k, v] of pageMap.entries()) {
            freshWindowResults.set(k, v);
            winUniqueIds.add(k);
          }
          if (expectedPages > 0) {
            winVerifiedPages += 1;
          }
          if (expectedPages === 0 || pageNo >= expectedPages) break;
        } finally {
          clearTimeout(timer);
        }
      }

      const pagesOk =
        expectedPages === 0 ? true : winVerifiedPages === expectedPages;
      const totalOk =
        expectedTotal === null ? true : winUniqueIds.size === expectedTotal;
      if (!pagesOk || !totalOk) {
        allWindowsComplete = false;
        break;
      }
    }

    if (allWindowsComplete && freshWindowResults.size > 0) {
      for (const [k, v] of freshWindowResults.entries()) {
        merged.set(k, v);
      }
      OFFICIAL_RESULTS_MEM_CACHE = {
        key: cacheKey,
        fetchedAt: nowMs,
        resultsById: new Map(merged),
      };
      if (cacheFilePath) {
        const serializable = Array.from(merged.values());
        await fsp
          .mkdir(path.dirname(cacheFilePath), { recursive: true, mode: 0o700 })
          .catch(() => {});
        const tmp = `${cacheFilePath}.tmp.${process.pid}.${Date.now()}`;
        await fsp
          .writeFile(tmp, JSON.stringify(serializable), {
            encoding: "utf8",
            mode: 0o600,
          })
          .then(() => fsp.rename(tmp, cacheFilePath))
          .catch(() => fsp.unlink(tmp).catch(() => {}));
      }
      return merged;
    }
  } catch {
    allWindowsComplete = false;
  }

  // When pagination fails mid-window or count fails to reconcile, NEVER overwrite cacheFilePath with partial pages;
  // merge intact disk cache + verified in-flight rows for read-only best effort.
  if (cacheFilePath && fs.existsSync(cacheFilePath)) {
    try {
      const raw = JSON.parse(await fsp.readFile(cacheFilePath, "utf8"));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && item.matchId) {
            merged.set(String(item.matchId), item);
          }
        }
      }
    } catch {
      // ignore corrupted cache
    }
  }
  for (const [k, v] of freshWindowResults.entries()) {
    merged.set(k, v);
  }
  return merged;
}
