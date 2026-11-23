import { devigPoolProbabilities } from "../quant/coherentCalibration.mjs";
import {
  formatBaselineSourceLabel,
  hydrateMatchesWithDualAxisMovement,
  summarizeMatchDualAxisMovements,
} from "./dualAxisMovement.mjs";
import { parseBeijingDateTimeMs } from "./sportteryHistoryNormalizers.mjs";

const ON_DEMAND_HEAD_COOLDOWN_MS = 10 * 60_000;
const MAX_COOLDOWN_ENTRIES = 512;
const headLookupCooldownByKey = new Map();

const POISSON_MAX_GOALS = 14;
const FACTORIALS = (() => {
  const arr = new Float64Array(POISSON_MAX_GOALS + 1);
  arr[0] = 1;
  for (let i = 1; i <= POISSON_MAX_GOALS; i += 1) {
    arr[i] = arr[i - 1] * i;
  }
  return arr;
})();

function evalIndependentPoissonWinDraw(lam1, lam2) {
  const p1 = new Float64Array(POISSON_MAX_GOALS + 1);
  const p2 = new Float64Array(POISSON_MAX_GOALS + 1);
  const e1 = Math.exp(-lam1);
  const e2 = Math.exp(-lam2);
  let pow1 = 1;
  let pow2 = 1;
  for (let k = 0; k <= POISSON_MAX_GOALS; k += 1) {
    p1[k] = (e1 * pow1) / FACTORIALS[k];
    p2[k] = (e2 * pow2) / FACTORIALS[k];
    pow1 *= lam1;
    pow2 *= lam2;
  }
  let pWin = 0;
  let pDraw = 0;
  for (let i = 0; i <= POISSON_MAX_GOALS; i += 1) {
    pDraw += p1[i] * p2[i];
    for (let j = 0; j < i; j += 1) {
      pWin += p1[i] * p2[j];
    }
  }
  return { pWin, pDraw };
}

/**
 * 由同期胜平负 Shin 去水概率 [pH, pD, pA] 经独立双泊松反推隐含净胜球期望 E[G_home - G_away] = λ_home - λ_away
 * （纯数学零 I/O 反推标尺，严禁冒充射门 xG）
 */
export function invertIndependentPoissonGoalDiffFromHadProbs(hadProbs) {
  const pH = Math.max(0.01, Math.min(0.96, Number(hadProbs?.[0] ?? 1 / 3)));
  const pD = Math.max(0.02, Math.min(0.9, Number(hadProbs?.[1] ?? 1 / 3)));
  const pA = Math.max(0.01, Math.min(0.96, Number(hadProbs?.[2] ?? 1 / 3)));
  if (Math.abs(pH - pA) < 1e-7) return 0;

  const clampLam = (x) => Math.max(0.12, Math.min(4.6, x));
  const initTot = Math.max(
    0.5,
    Math.min(4.2, -2.15 * Math.log(Math.max(0.06, Math.min(0.45, pD))))
  );
  const logSkew = Math.log((pH + 0.25 * pD) / (pA + 0.25 * pD));
  const initDiff = initTot * Math.tanh(0.42 * logSkew);
  let lamH = clampLam(0.5 * (initTot + initDiff));
  let lamA = clampLam(0.5 * (initTot - initDiff));

  const eps = 1e-4;
  for (let iter = 0; iter < 10; iter += 1) {
    const cur = evalIndependentPoissonWinDraw(lamH, lamA);
    const r1 = cur.pWin - pH;
    const r2 = cur.pDraw - pD;
    if (Math.abs(r1) + Math.abs(r2) < 1e-6) break;

    const dH = evalIndependentPoissonWinDraw(clampLam(lamH + eps), lamA);
    const dA = evalIndependentPoissonWinDraw(lamH, clampLam(lamA + eps));
    const j11 = (dH.pWin - cur.pWin) / eps;
    const j21 = (dH.pDraw - cur.pDraw) / eps;
    const j12 = (dA.pWin - cur.pWin) / eps;
    const j22 = (dA.pDraw - cur.pDraw) / eps;
    const det = j11 * j22 - j12 * j21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-8) break;

    const stepH = -(j22 * r1 - j12 * r2) / det;
    const stepA = -(-j21 * r1 + j11 * r2) / det;
    lamH = clampLam(lamH + 0.75 * Math.max(-0.8, Math.min(0.8, stepH)));
    lamA = clampLam(lamA + 0.75 * Math.max(-0.8, Math.min(0.8, stepA)));
  }

  return Number((lamH - lamA).toFixed(4));
}

function triggerLowFreqMatchHeadLookup(coordinator, matchId, nowMs) {
  if (
    !coordinator ||
    (typeof coordinator.notifyMatchHeadNonBlocking !== "function" &&
      typeof coordinator.backfillMatchHead !== "function") ||
    !matchId
  ) {
    return false;
  }
  const mid = String(matchId).trim();
  if (!mid) return false;
  const scopeId =
    typeof coordinator.getSnapshot === "function"
      ? String(coordinator.isWorkerRunning ? "worker" : "mem")
      : "coord";
  const cacheKey = `${scopeId}:${mid}`;
  const prevAt = headLookupCooldownByKey.get(cacheKey);
  if (
    typeof prevAt === "number" &&
    nowMs - prevAt < ON_DEMAND_HEAD_COOLDOWN_MS
  ) {
    return false;
  }
  if (headLookupCooldownByKey.size >= MAX_COOLDOWN_ENTRIES) {
    const oldest = headLookupCooldownByKey.keys().next().value;
    if (oldest !== undefined) headLookupCooldownByKey.delete(oldest);
  }
  headLookupCooldownByKey.set(cacheKey, nowMs);
  if (typeof coordinator.notifyMatchHeadNonBlocking === "function") {
    coordinator.notifyMatchHeadNonBlocking(mid, {
      observationOrigin: "on-demand-id",
    });
  } else {
    void Promise.resolve(
      coordinator.backfillMatchHead(mid, { observationOrigin: "on-demand-id" })
    ).catch(() => {});
  }
  return true;
}

function resolveCanonicalMatchKickoffMs(match, meta) {
  if (match?.kickoffDateTime) {
    const parsed = parseBeijingDateTimeMs(match.kickoffDateTime);
    if (parsed !== null) return parsed;
  }
  if (match?.matchDate && match?.kickoff) {
    const parsed = parseBeijingDateTimeMs(match.matchDate, match.kickoff);
    if (parsed !== null) return parsed;
  }
  if (
    typeof meta?.kickoffEpochMs === "number" &&
    Number.isFinite(meta.kickoffEpochMs)
  ) {
    return meta.kickoffEpochMs;
  }
  if (meta?.kickoffDateTime) {
    return parseBeijingDateTimeMs(meta.kickoffDateTime);
  }
  return null;
}

function resolveTeamIds(match, meta) {
  const rawHome = match?.homeTeamId ?? meta?.homeTeamId ?? null;
  const rawAway = match?.awayTeamId ?? meta?.awayTeamId ?? null;
  return {
    homeTeamId:
      rawHome !== null && rawHome !== undefined && String(rawHome).trim() !== ""
        ? String(rawHome).trim()
        : null,
    awayTeamId:
      rawAway !== null && rawAway !== undefined && String(rawAway).trim() !== ""
        ? String(rawAway).trim()
        : null,
  };
}

export function buildMatchRestIntervalEvidence(
  match,
  {
    historySnapshot = null,
    historyCoordinator = null,
    decisionEpochMs = Date.now(),
  } = {}
) {
  const mid = String(match?.id ?? "").trim();
  const meta = mid ? (historySnapshot?.getMatchMeta?.(mid) ?? null) : null;
  const { homeTeamId, awayTeamId } = resolveTeamIds(match, meta);
  const matchKickoffMs = resolveCanonicalMatchKickoffMs(match, meta);

  if ((!homeTeamId || !awayTeamId || matchKickoffMs === null) && mid) {
    triggerLowFreqMatchHeadLookup(historyCoordinator, mid, decisionEpochMs);
  }

  const resolveSide = (teamId) => {
    if (
      !teamId ||
      matchKickoffMs === null ||
      typeof historySnapshot?.getTeamKickoffHistory !== "function"
    ) {
      return { hoursUpperBound: null, prevMatchId: null };
    }
    const list = historySnapshot.getTeamKickoffHistory(teamId, matchKickoffMs);
    const prev = Array.isArray(list)
      ? list.find((it) => it && String(it.matchId) !== mid)
      : null;
    if (!prev) {
      return { hoursUpperBound: null, prevMatchId: null };
    }
    if (
      !prev.hasExactKickoff ||
      typeof prev.kickoffEpochMs !== "number" ||
      !(matchKickoffMs > prev.kickoffEpochMs)
    ) {
      triggerLowFreqMatchHeadLookup(
        historyCoordinator,
        prev.matchId,
        decisionEpochMs
      );
      return { hoursUpperBound: null, prevMatchId: String(prev.matchId) };
    }
    const hours = Number(
      ((matchKickoffMs - prev.kickoffEpochMs) / 3_600_000).toFixed(1)
    );
    return {
      hoursUpperBound: hours,
      prevMatchId: String(prev.matchId),
    };
  };

  const homeSide = resolveSide(homeTeamId);
  const awaySide = resolveSide(awayTeamId);
  const hHours = homeSide.hoursUpperBound;
  const aHours = awaySide.hoursUpperBound;

  if (hHours !== null && aHours !== null) {
    const observedDiffHours = Number(Math.abs(hHours - aHours).toFixed(1));
    const meetsDisplayFilter =
      Math.min(hHours, aHours) < 84 && observedDiffHours >= 48;
    const filterNote = meetsDisplayFilter
      ? "【触发密集赛程筛选：一方<84h且已观测差≥48h，仅作展示筛选条件】"
      : "（未触发一方<84h且已观测差≥48h展示筛选条件）";
    return {
      homeHoursUpperBound: hHours,
      awayHoursUpperBound: aHours,
      observedDiffHours,
      meetsDisplayFilter,
      summary: `主队${match?.home || ""}距上一场已观测竞彩开球 ${hHours.toFixed(
        1
      )}h（真实休息间隔上界）｜客队${match?.away || ""} ${aHours.toFixed(
        1
      )}h（真实休息间隔上界）；两队观测值均为真实休息间隔上界，两上界之差（${observedDiffHours.toFixed(
        1
      )}h）对真实间隔差无上下界保证${filterNote}`,
    };
  }

  if (hHours !== null) {
    return {
      homeHoursUpperBound: hHours,
      awayHoursUpperBound: null,
      observedDiffHours: null,
      meetsDisplayFilter: false,
      summary: `主队${match?.home || ""}距上一场已观测竞彩开球 ${hHours.toFixed(
        1
      )}h（真实休息间隔上界，对真实间隔差无上下界保证）｜客队${
        match?.away || ""
      }：无可核验信息`,
    };
  }

  if (aHours !== null) {
    return {
      homeHoursUpperBound: null,
      awayHoursUpperBound: aHours,
      observedDiffHours: null,
      meetsDisplayFilter: false,
      summary: `主队${match?.home || ""}：无可核验信息｜客队${
        match?.away || ""
      }距上一场已观测竞彩开球 ${aHours.toFixed(
        1
      )}h（真实休息间隔上界，对真实间隔差无上下界保证）`,
    };
  }

  return {
    homeHoursUpperBound: null,
    awayHoursUpperBound: null,
    observedDiffHours: null,
    meetsDisplayFilter: false,
    summary: "无可核验信息",
  };
}

function summarizeSingleTeam90dLedger(
  rolePrefix,
  teamName,
  teamId,
  currentMatchId,
  historySnapshot,
  decisionEpochMs
) {
  if (
    !teamId ||
    typeof historySnapshot?.getTeamRecent90dLedger !== "function"
  ) {
    return {
      count: 0,
      text: `${rolePrefix}${teamName}：无可核验信息`,
    };
  }

  const rawList = historySnapshot.getTeamRecent90dLedger(
    teamId,
    decisionEpochMs,
    13
  );
  const entries = (Array.isArray(rawList) ? rawList : [])
    .filter((e) => {
      if (!e || String(e.matchId) === currentMatchId) return false;
      const h = Number(e.hadQuote?.h);
      const d = Number(e.hadQuote?.d);
      const a = Number(e.hadQuote?.a);
      return (
        Number.isFinite(h) &&
        h > 1 &&
        Number.isFinite(d) &&
        d > 1 &&
        Number.isFinite(a) &&
        a > 1
      );
    })
    .slice(0, 12);

  const count = entries.length;
  if (count === 0) {
    return {
      count: 0,
      text: `${rolePrefix}${teamName}：无可核验信息`,
    };
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gf = 0;
  let ga = 0;
  let expPts = 0;
  let expGd = 0;

  for (const e of entries) {
    const teamGoals = e.isHome ? Number(e.h2 || 0) : Number(e.a2 || 0);
    const oppGoals = e.isHome ? Number(e.a2 || 0) : Number(e.h2 || 0);
    gf += teamGoals;
    ga += oppGoals;
    if (teamGoals > oppGoals) wins += 1;
    else if (teamGoals === oppGoals) draws += 1;
    else losses += 1;

    if (count >= 8) {
      const probs = devigPoolProbabilities(
        [e.hadQuote.h, e.hadQuote.d, e.hadQuote.a],
        "shin"
      ).probs;
      const pWin = e.isHome ? probs[0] : probs[2];
      const pDraw = probs[1];
      expPts += 3 * pWin + pDraw;
      const homeGdExp = invertIndependentPoissonGoalDiffFromHadProbs(probs);
      expGd += e.isHome ? homeGdExp : -homeGdExp;
    }
  }

  const actualPts = 3 * wins + draws;
  const actualGd = gf - ga;
  const actualGdStr = `${actualGd >= 0 ? "+" : ""}${actualGd}`;

  if (count < 8) {
    return {
      count,
      text: `${rolePrefix}${teamName}近90天已核验竞彩 ${count} 场（不足8场仅列已观测事实）：${wins}胜${draws}平${losses}负，实得${actualPts}分，进${gf}失${ga}（净胜${actualGdStr}球）`,
    };
  }

  const ptsDiff = actualPts - expPts;
  const gdDiff = actualGd - expGd;
  return {
    count,
    text: `${rolePrefix}${teamName}近90天已核验竞彩 ${count} 场：${wins}胜${draws}平${losses}负，实得 ${actualPts} 分 vs 同期市场预期 ${expPts.toFixed(
      1
    )} 分（差值 ${ptsDiff >= 0 ? "+" : ""}${ptsDiff.toFixed(
      1
    )} 分），实际净胜 ${actualGdStr} 球 vs 同期独立泊松预期净胜 ${
      expGd >= 0 ? "+" : ""
    }${expGd.toFixed(1)} 球（差值 ${gdDiff >= 0 ? "+" : ""}${gdDiff.toFixed(
      1
    )} 球；估计口径：预期积分=同期胜平负Shin去水 3×p胜+p平，预期净胜球=同期胜平负去水独立泊松反推[非射门xG]，仅列历史客观对照，不作下场均值折返推演）`,
  };
}

export function buildMatchRecent90dLedgerEvidence(
  match,
  { historySnapshot = null, decisionEpochMs = Date.now() } = {}
) {
  const mid = String(match?.id ?? "").trim();
  const meta = mid ? (historySnapshot?.getMatchMeta?.(mid) ?? null) : null;
  const { homeTeamId, awayTeamId } = resolveTeamIds(match, meta);

  const homeRes = summarizeSingleTeam90dLedger(
    "主队",
    match?.home || "",
    homeTeamId,
    mid,
    historySnapshot,
    decisionEpochMs
  );
  const awayRes = summarizeSingleTeam90dLedger(
    "客队",
    match?.away || "",
    awayTeamId,
    mid,
    historySnapshot,
    decisionEpochMs
  );

  if (homeRes.count === 0 && awayRes.count === 0) {
    return {
      homeCount: 0,
      awayCount: 0,
      summary: "无可核验信息",
    };
  }

  return {
    homeCount: homeRes.count,
    awayCount: awayRes.count,
    summary: `${homeRes.text} ｜ ${awayRes.text}`,
  };
}

function collectVisibleQuoteTimestamps(match, dualSummary) {
  const stamps = [];
  const pushUnique = (lbl) => {
    if (lbl && !stamps.includes(lbl)) stamps.push(lbl);
  };

  for (const code of ["HAD", "HHAD", "TTG", "HAFU", "CRS"]) {
    const pSum = dualSummary?.pools?.[code];
    const pool = match?.pools?.[code];
    if (!pool || pool.selling === false || !(pool.options?.length > 0))
      continue;
    if (pSum?.currentAt) {
      pushUnique(`${pool.name || code}@${pSum.currentAt}`);
    } else if (pool.updateTime && pool.updateTime !== "实时") {
      const prefix = pool.updateDate ? `${pool.updateDate.slice(5)} ` : "";
      pushUnique(
        `${pool.name || code}@${prefix}${pool.updateTime.slice(0, 5)}`
      );
    }
  }
  return stamps;
}

export function buildMatchDualAxisEvidence(
  match,
  { historySnapshot = null, decisionEpochMs = null } = {}
) {
  if (!match || typeof match !== "object") {
    return {
      summary: "无可核验信息",
      visibleQuoteTimestamps: [],
      raw: null,
    };
  }

  let effectiveMatch = match;
  if (
    historySnapshot ||
    (typeof decisionEpochMs === "number" && Number.isFinite(decisionEpochMs))
  ) {
    const [rehydrated] = hydrateMatchesWithDualAxisMovement(
      [match],
      historySnapshot,
      {
        nowMs:
          typeof decisionEpochMs === "number" &&
          Number.isFinite(decisionEpochMs)
            ? decisionEpochMs
            : Date.now(),
        decisionEpochMs,
      }
    );
    if (rehydrated) effectiveMatch = rehydrated;
  }

  const dualSummary = summarizeMatchDualAxisMovements(effectiveMatch);
  const visibleQuoteTimestamps = collectVisibleQuoteTimestamps(
    effectiveMatch,
    dualSummary
  );

  const detailItems = (dualSummary.notableMovements || [])
    .slice(0, 3)
    .map((x) => {
      const srcLbl = formatBaselineSourceLabel(x.baselineSource);
      const glTag = x.goalLine ? `[${x.goalLine}]` : "";
      const dpPart =
        x.frameCount >= 2 && x.cumFairProbDeltaPp !== null
          ? `${srcLbl}累计真率${x.cumFairProbDeltaPp > 0 ? "+" : ""}${x.cumFairProbDeltaPp.toFixed(
              2
            )}pp`
          : "仅单帧观测暂不判趋势";
      const hopDir =
        x.lastHopDirection === 1
          ? "▲上调"
          : x.lastHopDirection === -1
            ? "▼下调"
            : "→持平";
      const hopPart =
        x.prevOdds !== null && x.currentOdds !== null
          ? `末跳${x.prevOdds.toFixed(2)}→${x.currentOdds.toFixed(2)}(${hopDir}${
              x.currentAt ? ` @${x.currentAt}` : ""
            })`
          : `当前@${(x.currentOdds ?? 0).toFixed(2)}(${hopDir})`;
      return `${x.poolName}${glTag}·${x.label}：${dpPart}，${hopPart}`;
    });

  const summary =
    detailItems.length > 0
      ? `${dualSummary.steamSignal}；明细：${detailItems.join(" ｜ ")}`
      : dualSummary.steamSignal || "无可核验信息";

  return {
    summary,
    visibleQuoteTimestamps,
    raw: dualSummary,
  };
}

const SOURCE_ATTR_RE =
  /(?:官网|官方|公告|发布会|赛前名单|首发名单|伤停名单|日报|体育报|日刊|天空体育|队报|欧足联|亚足联|国际足联|足协|俱乐部|记者\S{1,8}|来源\s*[:：]|据\s*\S{2,12}(?:官方|媒体|报道))/i;

const PUBLISH_TIME_RE =
  /(?:\b\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b|\b\d{1,3}\s*(?:分钟|小时)前\b|\b\d{1,2}月\d{1,2}日\s*(?:\d{1,2}[点时:]\d{0,2})?)/i;

export function extractVerifiedExternalNews(
  userNote = "",
  explicitNews = null
) {
  const verified = [];
  if (Array.isArray(explicitNews)) {
    for (const item of explicitNews) {
      const src = String(item?.source ?? "").trim();
      const pub = String(item?.publishedAt ?? "").trim();
      const text = String(item?.summary ?? item?.title ?? "").trim();
      if (src && pub) {
        verified.push({
          source: src.slice(0, 48),
          publishedAt: pub.slice(0, 32),
          summary: text.slice(0, 120),
        });
      }
    }
  }

  const cleanNote = String(userNote || "").trim();
  if (cleanNote && verified.length === 0) {
    const srcMatch = cleanNote.match(SOURCE_ATTR_RE);
    const timeMatch = cleanNote.match(PUBLISH_TIME_RE);
    if (srcMatch && timeMatch) {
      verified.push({
        source: srcMatch[0].replace(/^来源\s*[:：]\s*/, "").trim(),
        publishedAt: timeMatch[0].trim(),
        summary: cleanNote.slice(0, 140),
      });
    }
  }

  return verified;
}

export function buildNewsOddsTimelineAlignment({
  userNote = "",
  verifiedNews = null,
  visibleQuoteTimestamps = [],
} = {}) {
  const items = extractVerifiedExternalNews(userNote, verifiedNews);
  if (items.length === 0) {
    return {
      hasVerifiedNews: false,
      summary: "无可核验信息",
    };
  }

  const newsDesc = items
    .map((n) => `${n.source} 发布于 ${n.publishedAt}`)
    .join("；");
  const quotesDesc =
    Array.isArray(visibleQuoteTimestamps) && visibleQuoteTimestamps.length > 0
      ? visibleQuoteTimestamps.slice(0, 4).join("、")
      : "暂无可核验变价时刻";

  return {
    hasVerifiedNews: true,
    summary: `消息发布时刻【${newsDesc}】｜盘面可见变价时刻【${quotesDesc}】（仅并列陈述时序事实，不推断消息消化比例）`,
  };
}

export function buildMatchObjectiveFactsBundle(match, opts = {}) {
  const decisionEpochMs =
    typeof opts.decisionEpochMs === "number" &&
    Number.isFinite(opts.decisionEpochMs)
      ? opts.decisionEpochMs
      : Date.now();
  const historySnapshot =
    opts.historySnapshot ?? opts.historyCoordinator?.getSnapshot?.() ?? null;
  const historyCoordinator = opts.historyCoordinator ?? null;

  const restInterval = buildMatchRestIntervalEvidence(match, {
    historySnapshot,
    historyCoordinator,
    decisionEpochMs,
  });
  const recentLedger = buildMatchRecent90dLedgerEvidence(match, {
    historySnapshot,
    decisionEpochMs,
  });
  const dualAxis = buildMatchDualAxisEvidence(match, {
    historySnapshot,
    decisionEpochMs,
  });
  const newsTimeline = buildNewsOddsTimelineAlignment({
    userNote: opts.userNote,
    verifiedNews: opts.verifiedNews,
    visibleQuoteTimestamps: dualAxis.visibleQuoteTimestamps,
  });

  return {
    decisionEpochMs,
    restIntervalSummary: restInterval.summary,
    recentLedgerSummary: recentLedger.summary,
    dualAxisSummary: dualAxis.summary,
    newsTimelineSummary: newsTimeline.summary,
    hasVerifiedNews: newsTimeline.hasVerifiedNews,
    visibleQuoteTimestamps: dualAxis.visibleQuoteTimestamps,
  };
}
