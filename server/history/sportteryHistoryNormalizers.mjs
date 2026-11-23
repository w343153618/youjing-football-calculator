import crypto from "node:crypto";
import { parseSportteryResultsJson } from "../quant/sportteryParsers.mjs";
import { OFFICIAL_CRS_PAIRS } from "../quant/statutoryRules.mjs";

export const HISTORY_SNAPSHOT_SCHEMA_VERSION = 1;

export const SPORTTERY_ENDPOINTS = Object.freeze({
  liveCalculator:
    "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c",
  uniformMatchResult:
    "https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry",
  fixedBonus:
    "https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry",
  matchHead:
    "https://webapi.sporttery.cn/gateway/uniform/football/getMatchHeadV1.qry",
});

export function buildUniformMatchResultUrl({
  beginDate,
  endDate,
  pageNo = 1,
  pageSize = 100,
}) {
  return `${SPORTTERY_ENDPOINTS.uniformMatchResult}?matchBeginDate=${encodeURIComponent(
    beginDate
  )}&matchEndDate=${encodeURIComponent(
    endDate
  )}&leagueId=&pageSize=${pageSize}&pageNo=${pageNo}&isFix=0&matchPage=1&pcOrWap=1`;
}

export function buildFixedBonusUrl(matchId) {
  return `${SPORTTERY_ENDPOINTS.fixedBonus}?clientCode=3001&matchId=${encodeURIComponent(
    String(matchId)
  )}`;
}

export function buildMatchHeadUrl(sportteryMatchId) {
  return `${SPORTTERY_ENDPOINTS.matchHead}?source=web&sportteryMatchId=${encodeURIComponent(
    String(sportteryMatchId)
  )}`;
}

const BJ_OFFSET_MS = 8 * 3600_000;

export function parseBeijingDateTimeMs(dateStr, timeStr = null) {
  const rawDate = String(dateStr ?? "").trim();
  if (!rawDate) return null;

  let combined = rawDate;
  if (timeStr !== null && timeStr !== undefined && String(timeStr).trim()) {
    const cleanTime = String(timeStr).trim();
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(cleanTime)) {
      combined = `${rawDate.slice(0, 10)} ${
        cleanTime.length === 5 ? `${cleanTime}:00` : cleanTime
      }`;
    }
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(combined)) {
    combined = `${combined} 00:00:00`;
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(combined)) {
    combined = `${combined}:00`;
  }

  const m = combined.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(utcMs)) return null;
  return utcMs - BJ_OFFSET_MS;
}

export function formatBeijingDate(epochMs) {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return "";
  return new Date(epochMs + BJ_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatBeijingMonthDayHM(epochMs) {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return "";
  const iso = new Date(epochMs + BJ_OFFSET_MS).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

export function subtractCalendarMonthsMs(epochMs, months) {
  const bjDate = new Date(epochMs + BJ_OFFSET_MS);
  const year = bjDate.getUTCFullYear();
  const monthIdx = bjDate.getUTCMonth();
  const day = bjDate.getUTCDate();
  const hour = bjDate.getUTCHours();
  const min = bjDate.getUTCMinutes();
  const sec = bjDate.getUTCSeconds();

  const targetTotalMonths = year * 12 + monthIdx - months;
  const targetYear = Math.floor(targetTotalMonths / 12);
  const targetMonthIdx = ((targetTotalMonths % 12) + 12) % 12;
  const maxDayInTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIdx + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(day, maxDayInTargetMonth);
  return (
    Date.UTC(targetYear, targetMonthIdx, clampedDay, hour, min, sec) -
    BJ_OFFSET_MS
  );
}

/**
 * 将任意日期区间拆分为每段 <= maxInclusiveDays（默认 60）自然日的闭合子窗口
 */
export function splitDateRangeIntoWindows(
  beginDate,
  endDate,
  maxInclusiveDays = 60
) {
  const safeCap = Math.max(1, Math.min(60, Math.floor(maxInclusiveDays)));
  const startMs = parseBeijingDateTimeMs(beginDate, "00:00:00");
  const finishMs = parseBeijingDateTimeMs(endDate, "00:00:00");
  if (startMs === null || finishMs === null || startMs > finishMs) {
    return [];
  }
  const windows = [];
  let cursorMs = startMs;
  const stepMs = (safeCap - 1) * 86_400_000;
  while (cursorMs <= finishMs) {
    const winEndMs = Math.min(finishMs, cursorMs + stepMs);
    const bStr = formatBeijingDate(cursorMs);
    const eStr = formatBeijingDate(winEndMs);
    windows.push({
      key: `${bStr}..${eStr}`,
      beginDate: bStr,
      endDate: eStr,
    });
    cursorMs = winEndMs + 86_400_000;
  }
  return windows;
}

export function buildBoardFreshnessMeta({
  source = "official-live",
  boardState = "fresh",
  lastValidBoardAt = null,
} = {}) {
  const validAt =
    typeof lastValidBoardAt === "number" && Number.isFinite(lastValidBoardAt)
      ? lastValidBoardAt
      : null;
  const clock = validAt !== null ? formatBeijingMonthDayHM(validAt) : null;
  const isFallbackReadOnly = boardState !== "fresh";
  const bannerText = isFallbackReadOnly
    ? `上次有效报价（采集于 ${clock || "内置基准快照"}）· 官方盘面暂空/回退只读参考`
    : null;
  return Object.freeze({
    source,
    boardState,
    lastValidBoardAt: validAt,
    lastValidBoardClock: clock,
    isFallbackReadOnly,
    bannerText,
  });
}

function parseTrendValue(v) {
  if (v === "1" || v === 1) return 1;
  if (v === "-1" || v === -1) return -1;
  return 0;
}

const CRS_NEGATIVE_KEY_MAP = Object.freeze({
  "s-1sh": "s1sh",
  "s-1sd": "s1sd",
  "s-1sa": "s1sa",
  "s-1shf": "s1shf",
  "s-1sdf": "s1sdf",
  "s-1saf": "s1saf",
});

export const CRS_LABEL_TO_CANONICAL_KEY = Object.freeze(
  Object.fromEntries(OFFICIAL_CRS_PAIRS.map(([rawKey, lbl]) => [lbl, rawKey]))
);

export const CRS_CANONICAL_KEY_TO_LABEL = Object.freeze(
  Object.fromEntries(OFFICIAL_CRS_PAIRS.map(([rawKey, lbl]) => [rawKey, lbl]))
);

export function normalizeCrsRawFrameKeys(rawFrame = {}) {
  const out = {};
  for (const [k, v] of Object.entries(rawFrame || {})) {
    const mappedKey = CRS_NEGATIVE_KEY_MAP[k] || k;
    if (mappedKey in out && k.startsWith("s-1s")) {
      continue;
    }
    out[mappedKey] = v;
  }
  return out;
}

const POOL_OPTION_SPECS = Object.freeze({
  HAD: [
    ["h", "h", "hf"],
    ["d", "d", "df"],
    ["a", "a", "af"],
  ],
  HHAD: [
    ["hh", "h", "hf"],
    ["hd", "d", "df"],
    ["ha", "a", "af"],
  ],
  HAFU: [
    ["hh", "hh", "hhf"],
    ["hd", "hd", "hdf"],
    ["ha", "ha", "haf"],
    ["dh", "dh", "dhf"],
    ["dd", "dd", "ddf"],
    ["da", "da", "daf"],
    ["ah", "ah", "ahf"],
    ["ad", "ad", "adf"],
    ["aa", "aa", "aaf"],
  ],
  TTG: ["0", "1", "2", "3", "4", "5", "6", "7"].map((n) => [
    `s${n}`,
    `s${n}`,
    `s${n}f`,
  ]),
  CRS: OFFICIAL_CRS_PAIRS.map(([rawKey]) => [rawKey, rawKey, `${rawKey}f`]),
});

export function computeOptionsStateSig({
  goalLine = "",
  selling = true,
  canSingle = false,
  canAllUp = true,
  options = {},
}) {
  const sortedOpts = Object.keys(options)
    .sort()
    .map((k) => `${k}:${Number(options[k]?.odds || 0).toFixed(4)}`)
    .join("|");
  return `${goalLine}#${selling ? 1 : 0}${canSingle ? 1 : 0}${canAllUp ? 1 : 0}#${sortedOpts}`;
}

function extractArchivePoolList(
  poolCode,
  rawList,
  nowMs,
  singleFlags = {},
  isBackfilled = true
) {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];
  const specs = POOL_OPTION_SPECS[poolCode];
  if (!specs) return [];

  const seenGoalLines = new Set();
  const events = [];
  for (const rawItem of rawList) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const src =
      poolCode === "CRS" ? normalizeCrsRawFrameKeys(rawItem) : rawItem;
    const goalLine =
      poolCode === "HHAD" ? String(src.goalLine ?? "").trim() : "";
    const options = {};
    let validCount = 0;
    for (const [optKey, oddsField, trendField] of specs) {
      const oddsNum = Number(src[oddsField] || 0);
      if (Number.isFinite(oddsNum) && oddsNum > 1) {
        options[optKey] = {
          odds: oddsNum,
          trend: parseTrendValue(src[trendField]),
        };
        validCount += 1;
      }
    }
    if (validCount === 0) continue;

    const isFirstForSegment = !seenGoalLines.has(goalLine);
    seenGoalLines.add(goalLine);
    const updateDate = src.updateDate ? String(src.updateDate).trim() : "";
    const updateTime = src.updateTime ? String(src.updateTime).trim() : "";
    const sourcePublishedAt = parseBeijingDateTimeMs(updateDate, updateTime);
    const sourcePublishedText =
      updateDate && updateTime ? `${updateDate} ${updateTime}` : null;
    const canSingle = Boolean(singleFlags[poolCode]);
    const stateSig = computeOptionsStateSig({
      goalLine,
      selling: true,
      canSingle,
      canAllUp: true,
      options,
    });

    events.push({
      poolCode,
      goalLine,
      frameOrigin: isFirstForSegment
        ? "official-archive-open"
        : "official-archive-seq",
      isBackfilled: Boolean(isBackfilled),
      selling: true,
      canSingle,
      canAllUp: true,
      options,
      stateSig,
      sourcePublishedAt,
      sourcePublishedText,
      firstLocallySeenAt: nowMs,
      lastLocallySeenAt: nowMs,
    });
  }
  return events;
}

export function normalizeFixedBonusPayload(
  rawJson,
  { nowMs = Date.now(), observationOrigin = "live-open-backfill" } = {}
) {
  const val = rawJson?.value;
  const hist = val?.oddsHistory || val || {};
  const matchId = String(hist.matchId ?? val?.matchId ?? "").trim();
  if (!matchId) return null;

  const singleFlags = {};
  if (Array.isArray(hist.singleList)) {
    for (const item of hist.singleList) {
      const code = String(item?.poolCode ?? item ?? "")
        .trim()
        .toUpperCase();
      if (code) singleFlags[code] = true;
    }
  }

  const isBackfilled = observationOrigin !== "live-observed";
  const poolLists = [
    ["HAD", hist.hadList],
    ["HHAD", hist.hhadList],
    ["TTG", hist.ttgList],
    ["HAFU", hist.hafuList],
    ["CRS", hist.crsList],
  ];
  const quoteEvents = [];
  for (const [poolCode, rawList] of poolLists) {
    quoteEvents.push(
      ...extractArchivePoolList(
        poolCode,
        rawList,
        nowMs,
        singleFlags,
        isBackfilled
      )
    );
  }

  return {
    matchMeta: {
      matchId,
      leagueId:
        hist.leagueId != null && String(hist.leagueId).trim()
          ? String(hist.leagueId).trim()
          : null,
      leagueName: hist.leagueAbbName ? String(hist.leagueAbbName).trim() : null,
      homeTeamId:
        hist.homeTeamId != null && String(hist.homeTeamId).trim()
          ? String(hist.homeTeamId).trim()
          : null,
      homeName: hist.homeTeamAbbName
        ? String(hist.homeTeamAbbName).trim()
        : null,
      awayTeamId:
        hist.awayTeamId != null && String(hist.awayTeamId).trim()
          ? String(hist.awayTeamId).trim()
          : null,
      awayName: hist.awayTeamAbbName
        ? String(hist.awayTeamAbbName).trim()
        : null,
      hasFixedBonusOpen: quoteEvents.some(
        (e) => e.frameOrigin === "official-archive-open"
      ),
      observationOrigin,
    },
    quoteEvents,
  };
}

export function extractLiveBoardEvents(matches = [], nowMs = Date.now()) {
  const matchMetas = [];
  const matchQuoteEvents = [];

  for (const m of matches || []) {
    if (!m?.id) continue;
    const matchId = String(m.id);
    const kickoffDateTime =
      m.kickoffDateTime ||
      (m.matchDate && m.kickoff ? `${m.matchDate} ${m.kickoff}:00` : null);
    const kickoffEpochMs = kickoffDateTime
      ? parseBeijingDateTimeMs(kickoffDateTime)
      : null;

    matchMetas.push({
      matchId,
      matchNumStr: m.matchNumStr || null,
      matchDate: m.matchDate || null,
      businessDate: m.businessDate || null,
      kickoffDateTime,
      kickoffEpochMs,
      leagueId: m.leagueId != null ? String(m.leagueId) : null,
      leagueName: m.league || null,
      homeTeamId: m.homeTeamId != null ? String(m.homeTeamId) : null,
      homeName: m.home || null,
      awayTeamId: m.awayTeamId != null ? String(m.awayTeamId) : null,
      awayName: m.away || null,
      observationOrigin: "live-observed",
    });

    for (const poolCode of ["HAD", "HHAD", "TTG", "HAFU", "CRS"]) {
      const p = m.pools?.[poolCode];
      if (!p) continue;
      const selling = p.selling !== false;
      const canSingle = Boolean(p.canSingle ?? p.single);
      const canAllUp = p.canAllUp !== false && selling;
      const goalLine =
        poolCode === "HHAD" ? String(p.goalLine ?? "").trim() : "";

      const options = {};
      let validCount = 0;
      for (const opt of p.options || []) {
        const oddsNum = Number(opt?.odds || 0);
        if (!Number.isFinite(oddsNum) || oddsNum <= 1) continue;
        const canonicalKey =
          poolCode === "CRS"
            ? CRS_LABEL_TO_CANONICAL_KEY[opt.key] ||
              CRS_NEGATIVE_KEY_MAP[opt.key] ||
              opt.key
            : opt.key;
        options[canonicalKey] = {
          odds: oddsNum,
          trend: parseTrendValue(opt.trend),
        };
        validCount += 1;
      }
      if (!selling || validCount === 0) continue;

      const updateDate = p.updateDate || m.matchDate || "";
      const updateTime =
        p.updateTime && p.updateTime !== "实时" ? p.updateTime : "";
      const sourcePublishedAt =
        updateDate && updateTime
          ? parseBeijingDateTimeMs(updateDate, updateTime)
          : null;
      const sourcePublishedText =
        updateDate && updateTime ? `${updateDate} ${updateTime}` : null;
      const stateSig = computeOptionsStateSig({
        goalLine,
        selling,
        canSingle,
        canAllUp,
        options,
      });

      matchQuoteEvents.push({
        matchId,
        event: {
          poolCode,
          goalLine,
          frameOrigin: "live-poll",
          isBackfilled: false,
          selling,
          canSingle,
          canAllUp,
          options,
          stateSig,
          sourcePublishedAt,
          sourcePublishedText,
          firstLocallySeenAt: nowMs,
          lastLocallySeenAt: nowMs,
        },
      });
    }
  }

  return { matchMetas, matchQuoteEvents };
}

/**
 * 清洗 getMatchHeadV1.qry：
 * 1) 强制使用 4 个 sporttery* 前缀身份键对齐，忽略非体彩第三方 ID；
 * 2) 硬性剥离 wbsjStats（严禁入库、入快照或传入排雷）。
 */
export function sanitizeMatchHeadPayload(
  rawJson,
  { observationOrigin = "recent-detail-backfill" } = {}
) {
  const val = rawJson?.value ?? rawJson;
  if (!val || typeof val !== "object") return null;
  const matchId = String(val.sportteryMatchId ?? "").trim();
  if (!matchId) return null;

  const kickoffDateTime = val.matchDateTime
    ? String(val.matchDateTime).trim()
    : null;
  const kickoffEpochMs = kickoffDateTime
    ? parseBeijingDateTimeMs(kickoffDateTime)
    : null;

  return {
    matchId,
    leagueId:
      val.sportteryTournamentId != null &&
      String(val.sportteryTournamentId).trim() !== ""
        ? String(val.sportteryTournamentId).trim()
        : null,
    homeTeamId:
      val.sportteryHomeTeamId != null &&
      String(val.sportteryHomeTeamId).trim() !== ""
        ? String(val.sportteryHomeTeamId).trim()
        : null,
    awayTeamId:
      val.sportteryAwayTeamId != null &&
      String(val.sportteryAwayTeamId).trim() !== ""
        ? String(val.sportteryAwayTeamId).trim()
        : null,
    kickoffDateTime,
    kickoffEpochMs,
    matchDate: kickoffDateTime ? kickoffDateTime.slice(0, 10) : null,
    seasonId:
      val.seasonId != null && String(val.seasonId).trim() !== ""
        ? String(val.seasonId).trim()
        : null,
    seasonName:
      val.seasonName != null && String(val.seasonName).trim() !== ""
        ? String(val.seasonName).trim()
        : null,
    phaseName:
      val.phaseName != null && String(val.phaseName).trim() !== ""
        ? String(val.phaseName).trim()
        : null,
    hasHeadDetail: true,
    observationOrigin,
  };
}

export function computeSettlementEmbargoUntilMs({
  matchDate,
  settlementPublishedAt = null,
}) {
  if (
    typeof settlementPublishedAt === "number" &&
    Number.isFinite(settlementPublishedAt)
  ) {
    return settlementPublishedAt;
  }
  const baseDateMs = parseBeijingDateTimeMs(matchDate, "00:00:00");
  if (baseDateMs === null) return 0;
  return baseDateMs + 3 * 86_400_000;
}

export function normalizeUniformMatchResultPayload(
  rawJson,
  {
    nowMs = Date.now(),
    observationOrigin = "result-index-backfill",
    settlementPublishedAt = null,
  } = {}
) {
  const val = rawJson?.value ?? {};
  const list = Array.isArray(rawJson)
    ? rawJson
    : Array.isArray(val.matchResult)
      ? val.matchResult
      : [];
  const total = Number.isFinite(Number(val.total))
    ? Number(val.total)
    : list.length;
  const pages = Number.isFinite(Number(val.pages))
    ? Number(val.pages)
    : list.length > 0
      ? 1
      : 0;

  const compatMap = parseSportteryResultsJson(list);
  const records = [];
  for (const r of list) {
    if (!r || r.matchId === undefined || r.matchId === null) continue;
    const matchId = String(r.matchId).trim();
    if (!matchId) continue;
    const compat = compatMap.get(matchId);
    if (!compat) continue;

    const hOdds = Number(r.h);
    const dOdds = Number(r.d);
    const aOdds = Number(r.a);
    const hasValidHad =
      String(r.h ?? "").trim() !== "" &&
      String(r.d ?? "").trim() !== "" &&
      String(r.a ?? "").trim() !== "" &&
      Number.isFinite(hOdds) &&
      hOdds > 1 &&
      Number.isFinite(dOdds) &&
      dOdds > 1 &&
      Number.isFinite(aOdds) &&
      aOdds > 1;

    const closingHadProxy = hasValidHad
      ? { h: hOdds, d: dOdds, a: aOdds, isArchiveProxy: true }
      : null;

    const effectivePubAt =
      settlementPublishedAt !== null
        ? settlementPublishedAt
        : observationOrigin === "live-observed" && compat.settled
          ? nowMs
          : null;
    const embargoUntilMs = computeSettlementEmbargoUntilMs({
      matchDate: compat.matchDate,
      settlementPublishedAt: effectivePubAt,
    });

    records.push({
      ...compat,
      leagueId:
        r.leagueId != null && String(r.leagueId).trim() !== ""
          ? String(r.leagueId).trim()
          : null,
      leagueName: String(r.leagueNameAbbr || r.leagueName || "").trim() || null,
      homeTeamId:
        r.homeTeamId != null && String(r.homeTeamId).trim() !== ""
          ? String(r.homeTeamId).trim()
          : null,
      awayTeamId:
        r.awayTeamId != null && String(r.awayTeamId).trim() !== ""
          ? String(r.awayTeamId).trim()
          : null,
      sectionsNo1: String(r.sectionsNo1 ?? "").trim(),
      sectionsNo999: String(r.sectionsNo999 ?? "").trim(),
      matchResultStatus: String(r.matchResultStatus ?? "").trim(),
      poolStatus: String(r.poolStatus ?? "").trim(),
      winFlag: r.winFlag != null ? String(r.winFlag).trim() : null,
      closingHadProxy,
      observationOrigin,
      firstLocallySeenAt: nowMs,
      settlementPublishedAt: effectivePubAt,
      embargoUntilMs,
    });
  }

  return {
    total,
    pages,
    rawCount: list.length,
    records,
  };
}

export function computeSnapshotChecksum(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function deepFreezeShallowGraph(obj) {
  if (!obj || typeof obj !== "object" || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) deepFreezeShallowGraph(item);
  } else if (!(obj instanceof Map) && !(obj instanceof Set)) {
    for (const v of Object.values(obj)) deepFreezeShallowGraph(v);
  }
  return obj;
}

export function buildEmptySnapshotPayload() {
  return {
    boardMeta: buildBoardFreshnessMeta({
      source: "official-live",
      boardState: "fresh",
      lastValidBoardAt: null,
    }),
    matchesMeta: {},
    quoteSegments: {},
    resultRecords: {},
    naturalMissingPoolIntervals: [],
    samplingIntervals: [],
    cursors: {
      windows: {},
      pendingOpenQuoteIds: [],
      pendingRecentDetailIds: [],
    },
    endpoints: {},
    storageBytes: {
      hotDbBytes: 0,
      walBytes: 0,
      coldArchiveBytes: 0,
      backupBytes: 0,
      totalHistoryBytes: 0,
      coldShardCount: 0,
    },
  };
}

export function hydrateImmutableHistorySnapshot(envelope) {
  const payload = structuredClone(
    envelope?.payload || buildEmptySnapshotPayload()
  );
  const matchesMetaObj = payload.matchesMeta || {};
  const quoteSegmentsObj = payload.quoteSegments || {};
  const resultRecordsObj = payload.resultRecords || {};

  const resultsById = new Map();
  const resultsRecordsById = new Map();
  const matchesByTeamId = new Map();

  const pushTeamMatchRef = (teamId, ref) => {
    if (!teamId) return;
    const tid = String(teamId);
    let arr = matchesByTeamId.get(tid);
    if (!arr) {
      arr = [];
      matchesByTeamId.set(tid, arr);
    }
    arr.push(ref);
  };

  for (const [matchId, rec] of Object.entries(resultRecordsObj)) {
    const frozenRec = deepFreezeShallowGraph({ ...rec });
    resultsRecordsById.set(matchId, frozenRec);
    resultsById.set(
      matchId,
      Object.freeze({
        matchId: rec.matchId,
        matchNumStr: rec.matchNumStr,
        home: rec.home,
        away: rec.away,
        matchDate: rec.matchDate,
        goalLine: rec.goalLine,
        settled: rec.settled,
        isVoid: rec.isVoid,
        halfScore: rec.halfScore,
        fullScore: rec.fullScore,
        h1: rec.h1,
        a1: rec.a1,
        h2: rec.h2,
        a2: rec.a2,
      })
    );
  }

  // Merge match metadata + result records per matchId for team kickoff & 90d ledger queries
  const allMatchIds = new Set([
    ...Object.keys(matchesMetaObj),
    ...Object.keys(resultRecordsObj),
  ]);
  for (const matchId of allMatchIds) {
    const meta = matchesMetaObj[matchId] || null;
    const resRec = resultRecordsObj[matchId] || null;
    const homeTeamId = meta?.homeTeamId || resRec?.homeTeamId || null;
    const awayTeamId = meta?.awayTeamId || resRec?.awayTeamId || null;
    const matchDate = meta?.matchDate || resRec?.matchDate || null;
    const kickoffEpochMs =
      typeof meta?.kickoffEpochMs === "number"
        ? meta.kickoffEpochMs
        : meta?.kickoffDateTime
          ? parseBeijingDateTimeMs(meta.kickoffDateTime)
          : matchDate
            ? parseBeijingDateTimeMs(matchDate, "12:00:00")
            : null;
    const ref = Object.freeze({
      matchId,
      matchDate,
      kickoffDateTime: meta?.kickoffDateTime || null,
      kickoffEpochMs,
      hasExactKickoff: Boolean(
        meta?.kickoffDateTime || typeof meta?.kickoffEpochMs === "number"
      ),
      leagueId: meta?.leagueId || resRec?.leagueId || null,
      leagueName: meta?.leagueName || resRec?.leagueName || null,
      homeTeamId,
      homeName: meta?.homeName || resRec?.home || null,
      awayTeamId,
      awayName: meta?.awayName || resRec?.away || null,
      observationOrigin:
        meta?.observationOrigin || resRec?.observationOrigin || "unknown",
      isBackfilled:
        (meta?.observationOrigin || resRec?.observationOrigin) !==
        "live-observed",
      resultRecord: resRec ? resultsRecordsById.get(matchId) : null,
    });
    if (homeTeamId) pushTeamMatchRef(homeTeamId, ref);
    if (awayTeamId && awayTeamId !== homeTeamId)
      pushTeamMatchRef(awayTeamId, ref);
  }

  for (const arr of matchesByTeamId.values()) {
    arr.sort((a, b) => (b.kickoffEpochMs ?? 0) - (a.kickoffEpochMs ?? 0));
    Object.freeze(arr);
  }

  deepFreezeShallowGraph(matchesMetaObj);
  deepFreezeShallowGraph(quoteSegmentsObj);

  function getPoolSegmentFrames(matchId, poolCode, goalLine = "") {
    const normLine = poolCode === "HHAD" ? String(goalLine ?? "").trim() : "";
    const segKey = `${String(matchId)}|${String(poolCode)}|${normLine}`;
    return quoteSegmentsObj[segKey] || null;
  }

  function getMatchMeta(matchId) {
    return matchesMetaObj[String(matchId)] || null;
  }

  function isResultStatisticallyUnembargoed(matchId, atEpochMs = Date.now()) {
    const rec = resultsRecordsById.get(String(matchId));
    if (!rec || !rec.settled || rec.isVoid) return false;
    return atEpochMs >= (rec.embargoUntilMs ?? 0);
  }

  function getTeamKickoffHistory(sportteryTeamId, beforeEpochMs = Infinity) {
    const arr = matchesByTeamId.get(String(sportteryTeamId)) || [];
    return arr.filter(
      (item) =>
        typeof item.kickoffEpochMs === "number" &&
        item.kickoffEpochMs < beforeEpochMs
    );
  }

  function resolvePreKickoffHadQuote(matchId, kickoffEpochMs, decisionEpochMs) {
    const seg = getPoolSegmentFrames(matchId, "HAD", "");
    if (seg && Array.isArray(seg.frames) && seg.frames.length > 0) {
      const upperBound =
        typeof kickoffEpochMs === "number"
          ? Math.min(kickoffEpochMs, decisionEpochMs)
          : decisionEpochMs;
      let chosen = null;
      for (const f of seg.frames) {
        const frameTs = f.sourcePublishedAt ?? f.firstLocallySeenAt ?? 0;
        if (frameTs <= upperBound) {
          chosen = f;
        }
      }
      if (
        chosen?.options?.h?.odds > 1 &&
        chosen?.options?.d?.odds > 1 &&
        chosen?.options?.a?.odds > 1
      ) {
        return {
          h: chosen.options.h.odds,
          d: chosen.options.d.odds,
          a: chosen.options.a.odds,
          source: chosen.frameOrigin,
        };
      }
    }
    const resRec = resultsRecordsById.get(String(matchId));
    if (resRec?.closingHadProxy) {
      return {
        h: resRec.closingHadProxy.h,
        d: resRec.closingHadProxy.d,
        a: resRec.closingHadProxy.a,
        source: "result-closing-proxy",
      };
    }
    return null;
  }

  function getTeamRecent90dLedger(
    sportteryTeamId,
    decisionEpochMs = Date.now(),
    limit = 12
  ) {
    const arr = matchesByTeamId.get(String(sportteryTeamId)) || [];
    const windowStartMs = decisionEpochMs - 90 * 86_400_000;
    const out = [];
    for (const item of arr) {
      if (out.length >= limit) break;
      const rec = item.resultRecord;
      if (!rec || !rec.settled || rec.isVoid) continue;
      if (decisionEpochMs < (rec.embargoUntilMs ?? 0)) continue;
      const matchMs =
        item.kickoffEpochMs ??
        parseBeijingDateTimeMs(rec.matchDate, "12:00:00");
      if (
        typeof matchMs !== "number" ||
        matchMs < windowStartMs ||
        matchMs >= decisionEpochMs
      ) {
        continue;
      }
      const hadQuote = resolvePreKickoffHadQuote(
        item.matchId,
        item.kickoffEpochMs,
        decisionEpochMs
      );
      if (!hadQuote) continue;
      out.push(
        Object.freeze({
          matchId: item.matchId,
          matchDate: rec.matchDate,
          kickoffDateTime: item.kickoffDateTime,
          leagueId: item.leagueId,
          leagueName: item.leagueName,
          isHome: String(item.homeTeamId) === String(sportteryTeamId),
          homeTeamId: item.homeTeamId,
          awayTeamId: item.awayTeamId,
          home: rec.home,
          away: rec.away,
          halfScore: rec.halfScore,
          fullScore: rec.fullScore,
          h2: rec.h2,
          a2: rec.a2,
          hadQuote,
          observationOrigin: item.observationOrigin,
          isBackfilled: item.isBackfilled,
        })
      );
    }
    return Object.freeze(out);
  }

  return Object.freeze({
    seq: Number(envelope?.seq ?? 0),
    schemaVersion: Number(
      envelope?.schemaVersion ?? HISTORY_SNAPSHOT_SCHEMA_VERSION
    ),
    generatedAt: Number(envelope?.generatedAt ?? 0),
    storageBackend: envelope?.storageBackend || "memory",
    checksum: String(envelope?.checksum || ""),
    boardMeta: payload.boardMeta,
    resultsById,
    resultsRecordsById,
    quoteSegments: quoteSegmentsObj,
    matchesMeta: matchesMetaObj,
    telemetry: Object.freeze({
      endpoints: deepFreezeShallowGraph(payload.endpoints || {}),
      cursors: deepFreezeShallowGraph(payload.cursors || {}),
      coverage: deepFreezeShallowGraph(payload.coverage || {}),
      samplingIntervals: deepFreezeShallowGraph(
        payload.samplingIntervals || []
      ),
      naturalMissingPoolIntervals: deepFreezeShallowGraph(
        payload.naturalMissingPoolIntervals || []
      ),
      storageBytes: deepFreezeShallowGraph(payload.storageBytes || {}),
    }),
    getPoolSegmentFrames,
    getMatchMeta,
    isResultStatisticallyUnembargoed,
    getTeamKickoffHistory,
    getTeamRecent90dLedger,
  });
}
