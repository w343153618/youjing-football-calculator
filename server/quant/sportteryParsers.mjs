// Pure zero-I/O Sporttery live odds & 90-minute match result JSON parsers + calibrated fallback fixture.
import { OFFICIAL_CRS_PAIRS } from "./statutoryRules.mjs";
import {
  analyzeMatchMicroQuant,
  calibrateMatchCoherentModel,
} from "./coherentCalibration.mjs";
import {
  RAW_FALLBACK_MATCHES,
  buildPool,
} from "../sportteryFallbackMatches.mjs";

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
