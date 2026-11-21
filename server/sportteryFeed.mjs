// Upstream China Sporttery live odds & 90-minute match result feed adapter with disk/memory cache.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  FALLBACK_MATCHES,
  parseSportteryRawJson,
  parseSportteryResultsJson,
} from "./quant/sportteryParsers.mjs";

export { FALLBACK_MATCHES, parseSportteryRawJson, parseSportteryResultsJson };

/** 服务端体彩实盘同步（带内存热缓存与磁盘快照双通道） */
export async function fetchOfficialMatchesServer(snapshotFilePath) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(
        "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c",
        { signal: controller.signal }
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = parseSportteryRawJson(json);
        if (parsed.length > 0) {
          if (snapshotFilePath) {
            await fsp
              .mkdir(path.dirname(snapshotFilePath), { recursive: true })
              .catch(() => {});
            const tmpPath = `${snapshotFilePath}.tmp.${process.pid}.${Date.now()}`;
            await fsp
              .writeFile(tmpPath, JSON.stringify(json), "utf-8")
              .then(() => fsp.rename(tmpPath, snapshotFilePath))
              .catch(() => fsp.unlink(tmpPath).catch(() => {}));
          }
          const dropCount = parsed.filter((m) =>
            Object.values(m.pools).some((p) =>
              p.options.some((o) => o.trend === -1)
            )
          ).length;
          return {
            matches: parsed,
            source: "official-live",
            syncNote: `已从中国体彩官网同步 ${parsed.length} 场在售实盘赛事｜检测到 ${dropCount} 场存在官方降水异动`,
          };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // fallback to disk snapshot
  }

  if (snapshotFilePath && fs.existsSync(snapshotFilePath)) {
    try {
      const raw = await fsp.readFile(snapshotFilePath, "utf-8");
      const parsed = parseSportteryRawJson(JSON.parse(raw));
      if (parsed.length > 0) {
        const dropCount = parsed.filter((m) =>
          Object.values(m.pools).some((p) =>
            p.options.some((o) => o.trend === -1)
          )
        ).length;
        return {
          matches: parsed,
          source: "official-live",
          syncNote: `已载入体彩实盘快照 ${parsed.length} 场在售赛事｜检测到 ${dropCount} 场存在官方降水异动`,
        };
      }
    } catch {
      // fallback to built-in
    }
  }

  return {
    matches: FALLBACK_MATCHES,
    source: "fallback",
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
  const merged = new Map();

  try {
    for (let pageNo = 1; pageNo <= 3; pageNo++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      try {
        const url = `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${encodeURIComponent(
          beginDate
        )}&matchEndDate=${encodeURIComponent(
          endDate
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
        if (!res.ok) break;
        const json = await res.json();
        const pageMap = parseSportteryResultsJson(json);
        for (const [k, v] of pageMap.entries()) {
          merged.set(k, v);
        }
        const totalPages = Number(json?.value?.pages || 1);
        if (pageNo >= totalPages || pageMap.size === 0) break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (merged.size > 0) {
      OFFICIAL_RESULTS_MEM_CACHE = {
        key: cacheKey,
        fetchedAt: nowMs,
        resultsById: merged,
      };
      if (cacheFilePath) {
        const serializable = Array.from(merged.values());
        await fsp
          .mkdir(path.dirname(cacheFilePath), { recursive: true })
          .catch(() => {});
        const tmp = `${cacheFilePath}.tmp.${process.pid}.${Date.now()}`;
        await fsp
          .writeFile(tmp, JSON.stringify(serializable), "utf8")
          .then(() => fsp.rename(tmp, cacheFilePath))
          .catch(() => fsp.unlink(tmp).catch(() => {}));
      }
      return merged;
    }
  } catch {
    // fallback to disk cache below
  }

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
  return merged;
}
