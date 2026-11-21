// Upstream China Sporttery live odds & 90-minute match result feed adapter with disk/memory cache.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { OFFICIAL_CRS_PAIRS } from "./quant/statutoryRules.mjs";
import {
  analyzeMatchMicroQuant,
  calibrateMatchCoherentModel,
} from "./quant/coherentCalibration.mjs";
import {
  buildPool,
  RAW_FALLBACK_MATCHES,
} from "./sportteryFallbackMatches.mjs";

function hydrateCalibratedMatches(matches) {
  return matches.map((m) => {
    const cal = calibrateMatchCoherentModel(m);
    const calibratedMatch = {
      ...m,
      pools: cal.pools,
    };
    return {
      ...calibratedMatch,
      microQuant: analyzeMatchMicroQuant(calibratedMatch, cal),
    };
  });
}

export const FALLBACK_MATCHES = hydrateCalibratedMatches(RAW_FALLBACK_MATCHES);

function parseTrend(v) {
  if (v === "1" || v === 1) return 1;
  if (v === "-1" || v === -1) return -1;
  return 0;
}

export function parseSportteryRawJson(json) {
  const groups = json?.value?.matchInfoList ?? [];
  const parsed = [];
  for (const g of groups) {
    for (const m of g.subMatchList ?? []) {
      const poolFlags = {};
      const poolSelling = {};
      const hasPoolList = Array.isArray(m.poolList) && m.poolList.length > 0;
      for (const p of m.poolList ?? []) {
        poolFlags[p.poolCode] =
          Number(p.bettingSingle) === 1 || Number(p.single) === 1;
        const statusOk =
          String(p.poolStatus ?? "Selling").toLowerCase() === "selling";
        const bettingOk =
          p.bettingAllup !== undefined || p.bettingSingle !== undefined
            ? Number(p.bettingAllup) === 1 || Number(p.bettingSingle) === 1
            : Number(p.cbtValue ?? 1) !== 2;
        poolSelling[p.poolCode] = statusOk && bettingOk;
      }
      const isSelling = (code) =>
        hasPoolList ? Boolean(poolSelling[code]) : true;
      const hadRaw = m.had ?? {};
      const hhadRaw = m.hhad ?? {};
      const hafuRaw = m.hafu ?? {};
      const ttgRaw = m.ttg ?? {};
      const crsRaw = m.crs ?? {};

      parsed.push({
        id: String(m.matchId),
        matchNumStr: m.matchNumStr,
        league: m.leagueAbbName,
        kickoff: (m.matchTime ?? "").slice(0, 5),
        businessDate: m.businessDate ? String(m.businessDate) : undefined,
        matchDate: m.matchDate ? String(m.matchDate) : undefined,
        home: m.homeTeamAbbName,
        away: m.awayTeamAbbName,
        homeRank: String(m.homeRank || "").replace(/\D+/g, "") || undefined,
        awayRank: String(m.awayRank || "").replace(/\D+/g, "") || undefined,
        isHot: Number(m.isHot) === 1,
        aiAlert: undefined,
        pools: {
          HAD: buildPool(
            "HAD",
            "胜平负",
            Boolean(poolFlags.HAD),
            [
              {
                key: "h",
                label: "主胜",
                odds: Number(hadRaw.h || 0),
                trend: parseTrend(hadRaw.hf),
              },
              {
                key: "d",
                label: "平",
                odds: Number(hadRaw.d || 0),
                trend: parseTrend(hadRaw.df),
              },
              {
                key: "a",
                label: "客胜",
                odds: Number(hadRaw.a || 0),
                trend: parseTrend(hadRaw.af),
              },
            ],
            hadRaw.updateTime || "实时",
            undefined,
            isSelling("HAD"),
            hadRaw.updateDate || undefined
          ),
          HHAD: buildPool(
            "HHAD",
            `让球(${hhadRaw.goalLine || "-1"})`,
            Boolean(poolFlags.HHAD),
            [
              {
                key: "hh",
                label: "让胜",
                odds: Number(hhadRaw.h || 0),
                trend: parseTrend(hhadRaw.hf),
              },
              {
                key: "hd",
                label: "让平",
                odds: Number(hhadRaw.d || 0),
                trend: parseTrend(hhadRaw.df),
              },
              {
                key: "ha",
                label: "让负",
                odds: Number(hhadRaw.a || 0),
                trend: parseTrend(hhadRaw.af),
              },
            ],
            hhadRaw.updateTime || "实时",
            hhadRaw.goalLine || "-1",
            isSelling("HHAD"),
            hhadRaw.updateDate || undefined
          ),
          HAFU: buildPool(
            "HAFU",
            "半全场",
            poolFlags.HAFU ?? true,
            [
              ["hh", "胜胜"],
              ["hd", "胜平"],
              ["ha", "胜负"],
              ["dh", "平胜"],
              ["dd", "平平"],
              ["da", "平负"],
              ["ah", "负胜"],
              ["ad", "负平"],
              ["aa", "负负"],
            ].map(([k, lbl]) => ({
              key: k,
              label: lbl,
              odds: Number(hafuRaw[k] || 0),
              trend: parseTrend(hafuRaw[`${k}f`]),
            })),
            hafuRaw.updateTime || "实时",
            undefined,
            isSelling("HAFU"),
            hafuRaw.updateDate || undefined
          ),
          TTG: buildPool(
            "TTG",
            "总进球",
            poolFlags.TTG ?? true,
            ["0", "1", "2", "3", "4", "5", "6", "7"].map((n) => ({
              key: `s${n}`,
              label: n === "7" ? "7+球" : `${n}球`,
              odds: Number(ttgRaw[`s${n}`] || 0),
              trend: parseTrend(ttgRaw[`s${n}f`]),
            })),
            ttgRaw.updateTime || "实时",
            undefined,
            isSelling("TTG"),
            ttgRaw.updateDate || undefined
          ),
          CRS: buildPool(
            "CRS",
            "比分",
            poolFlags.CRS ?? true,
            OFFICIAL_CRS_PAIRS.map(([k, lbl]) => ({
              key: lbl,
              label: lbl,
              odds: Number(crsRaw[k] || 0),
              trend: parseTrend(crsRaw[`${k}f`]),
            })),
            crsRaw.updateTime || "实时",
            undefined,
            isSelling("CRS"),
            crsRaw.updateDate || undefined
          ),
        },
      });
    }
  }
  return hydrateCalibratedMatches(parsed);
}

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

function parseScorePair(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
    return null;
  }
  return [h, a];
}

function isVoidSportteryResultItem(r) {
  const statusStr = String(r?.matchResultStatus ?? "").trim();
  const poolStatus = String(r?.poolStatus ?? "")
    .trim()
    .toLowerCase();
  const resStatus = String(r?.resultStatus ?? "").trim();
  const s999 = String(r?.sectionsNo999 ?? "").trim();
  const s1 = String(r?.sectionsNo1 ?? "").trim();
  if (statusStr === "3" || poolStatus === "refund" || poolStatus === "cancel") {
    return true;
  }
  const combined = `${resStatus}|${s999}|${s1}`;
  return /无效|取消|腰斩|退票|中断/.test(combined);
}

/**
 * 解析中国体彩官方完场赛果 JSON（getUniformMatchResultV1.qry）
 * 返回 Map<matchId, OfficialMatchResult>
 */
export function parseSportteryResultsJson(rawJson) {
  const list = Array.isArray(rawJson)
    ? rawJson
    : Array.isArray(rawJson?.value?.matchResult)
      ? rawJson.value.matchResult
      : [];
  const map = new Map();
  for (const r of list) {
    if (!r || r.matchId === undefined || r.matchId === null) continue;
    const matchId = String(r.matchId).trim();
    if (!matchId) continue;
    const matchNumStr = String(r.matchNumStr || "").trim();
    const home = String(r.homeTeam || r.allHomeTeam || "").trim();
    const away = String(r.awayTeam || r.allAwayTeam || "").trim();
    const matchDate = String(r.matchDate || "").trim();
    const goalLine = r.goalLine !== undefined ? String(r.goalLine) : undefined;

    if (isVoidSportteryResultItem(r)) {
      map.set(matchId, {
        matchId,
        matchNumStr,
        home,
        away,
        matchDate,
        goalLine,
        settled: true,
        isVoid: true,
        halfScore: "无效场次",
        fullScore: "无效场次",
        h1: null,
        a1: null,
        h2: null,
        a2: null,
      });
      continue;
    }

    const statusStr = String(r.matchResultStatus ?? "").trim();
    const poolStatus = String(r.poolStatus ?? "")
      .trim()
      .toLowerCase();
    const fullPair = parseScorePair(r.sectionsNo999);
    const halfPair = parseScorePair(r.sectionsNo1);
    const isOfficiallyFinished =
      Boolean(fullPair) &&
      Boolean(halfPair) &&
      statusStr !== "1" &&
      (statusStr === "2" || poolStatus === "payout");

    if (!isOfficiallyFinished || !fullPair) {
      map.set(matchId, {
        matchId,
        matchNumStr,
        home,
        away,
        matchDate,
        goalLine,
        settled: false,
        isVoid: false,
        halfScore: halfPair ? `${halfPair[0]}:${halfPair[1]}` : "",
        fullScore: "",
        h1: null,
        a1: null,
        h2: null,
        a2: null,
      });
      continue;
    }

    map.set(matchId, {
      matchId,
      matchNumStr,
      home,
      away,
      matchDate,
      goalLine,
      settled: true,
      isVoid: false,
      halfScore: halfPair ? `${halfPair[0]}:${halfPair[1]}` : "",
      fullScore: `${fullPair[0]}:${fullPair[1]}`,
      h1: halfPair ? halfPair[0] : null,
      a1: halfPair ? halfPair[1] : null,
      h2: fullPair[0],
      a2: fullPair[1],
    });
  }
  return map;
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
