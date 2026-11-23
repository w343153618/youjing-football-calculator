import {
  sanitizeAndDeduplicatePicks,
  settleTicketSnapshotWithOfficialResults,
} from "../quantEngine.mjs";
import {
  buildBoardFreshnessMeta,
  parseBeijingDateTimeMs,
} from "./sportteryHistoryNormalizers.mjs";

export const FROZEN_PRODUCTION_MODEL_VERSION =
  "coherent-shin-dc-pareto3p1-v2.8.0-frozen";

const ALL_POOLS = Object.freeze(["HAD", "HHAD", "TTG", "HAFU", "CRS"]);

const PORTFOLIO_SLOT_META = Object.freeze([
  { key: "max-profit-prob", label: "稳健保本" },
  { key: "max-ev-utility", label: "期望效用" },
  { key: "max-cvar-wheel", label: "容错缩水" },
  { key: "alpha-radar", label: "错价雷达" },
]);

const ENDPOINT_META = Object.freeze([
  { key: "liveCalculator", label: "在售计算器接口 (getMatchCalculatorV1)" },
  {
    key: "uniformMatchResult",
    label: "统一完场赛果接口 (getUniformMatchResultV1)",
  },
  { key: "fixedBonus", label: "单场固定奖金归档接口 (getFixedBonusV1)" },
  { key: "matchHead", label: "单场头部详情接口 (getMatchHeadV1)" },
]);

const MAX_CANONICAL_MATCHES = 4_096;
const MAX_CANONICAL_EVALUATIONS = 4_096;

function round6(val) {
  if (typeof val !== "number" || !Number.isFinite(val)) return null;
  const n = Number(val.toFixed(6));
  return Object.is(n, -0) ? 0 : n;
}

function normalizeFourBucketProbs(rawVec) {
  const cleaned = [0, 1, 2, 3].map((i) => {
    const v = Number(rawVec?.[i] ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const sum = cleaned[0] + cleaned[1] + cleaned[2] + cleaned[3];
  if (!(sum > 0)) {
    return [1, 0, 0, 0];
  }
  return cleaned.map((v) => v / sum);
}

function extractSlotFourBucketProbs(slotPlan) {
  const wipeout = Math.max(
    0,
    Number(slotPlan?.zeroPayoutProb ?? 1 - Number(slotPlan?.winProb ?? 0))
  );
  const strictGain = Math.max(
    0,
    Number(
      slotPlan?.objectiveStrictNetGainProb ??
        slotPlan?.strictNetGainProb ??
        slotPlan?.objectiveProfitProb ??
        slotPlan?.profitProb ??
        0
    )
  );
  const profit = Math.max(
    strictGain,
    Number(slotPlan?.objectiveProfitProb ?? slotPlan?.profitProb ?? strictGain)
  );
  const breakEven = Math.max(
    0,
    Number(slotPlan?.breakEvenProb ?? Math.max(0, profit - strictGain))
  );
  const underwater = Math.max(0, 1 - wipeout - breakEven - strictGain);
  return normalizeFourBucketProbs([wipeout, underwater, breakEven, strictGain]);
}

function extractReportFourBucketProbs(report) {
  const wipeout = Math.max(
    0,
    Number(
      report?.objectiveZeroPayoutProb ??
        report?.zeroPayoutProb ??
        1 - Number(report?.anyWinProb ?? 0)
    )
  );
  const underwater = Math.max(
    0,
    Number(report?.objectivePartialLossProb ?? report?.partialLossProb ?? 0)
  );
  const breakEven = Math.max(
    0,
    Number(report?.objectiveBreakEvenProb ?? report?.breakEvenProb ?? 0)
  );
  const strictGain = Math.max(
    0,
    Number(report?.objectiveStrictNetGainProb ?? report?.strictNetGainProb ?? 0)
  );
  return normalizeFourBucketProbs([wipeout, underwater, breakEven, strictGain]);
}

function buildCompactTicketSnapshot(lines, matchById) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const matchSet = new Set();
  const compactLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    if (!ln || !Array.isArray(ln.legs) || ln.legs.length === 0) continue;
    const multiple = Math.max(1, Math.round(Number(ln.multiple) || 1));
    const legs = ln.legs.map((lg) => {
      const mid = String(lg.matchId);
      matchSet.add(mid);
      const authMatch = matchById.get(mid);
      return {
        matchId: mid,
        matchNumStr: lg.matchNumStr || authMatch?.matchNumStr || mid,
        home: lg.home || authMatch?.home || "",
        away: lg.away || authMatch?.away || "",
        poolCode: String(lg.poolCode || "HAD").toUpperCase(),
        optionKey: String(lg.optionKey || ""),
        optionLabel: String(lg.optionLabel || lg.optionKey || ""),
        odds: Number(lg.odds) || 1,
        goalLine: lg.goalLine ?? authMatch?.pools?.HHAD?.goalLine ?? "-1",
      };
    });
    compactLines.push({
      id: String(ln.id || `line_${i + 1}`),
      modeLabel:
        ln.modeLabel || (legs.length === 1 ? "单关" : `${legs.length}串1`),
      multiple,
      legs,
    });
  }
  if (compactLines.length === 0) return null;
  const matches = Array.from(matchSet).map((mid) => {
    const m = matchById.get(mid);
    return {
      matchId: mid,
      matchNumStr: m?.matchNumStr || mid,
      home: m?.home || "",
      away: m?.away || "",
      kickoff: m?.kickoff || "",
      goalLine: m?.pools?.HHAD?.goalLine ?? "-1",
    };
  });
  return {
    matchIds: Array.from(matchSet),
    snapshot: { matches, lines: compactLines },
  };
}

function classifySettledOutcomeBucket(settledReturn, totalCost) {
  const ret = Number(settledReturn) || 0;
  const cost = Number(totalCost) || 0;
  if (ret <= 1e-9) return 0; // wipeout: 整单归零
  if (ret + 1e-9 < cost) return 1; // underwater: 局部回血倒贴
  if (Math.abs(ret - cost) <= 1e-9) return 2; // breakEven: 平手保本
  return 3; // strictNetGain: 严格净赚
}

function resolveMatchKickoffMs(m) {
  if (!m) return null;
  if (m.kickoffDateTime) {
    return parseBeijingDateTimeMs(m.kickoffDateTime);
  }
  if (m.matchDate && m.kickoff) {
    return parseBeijingDateTimeMs(m.matchDate, m.kickoff);
  }
  return null;
}

function snapshotMatchPoolStatesAndQuotes(match) {
  const poolStates = {};
  const quotes = {};
  const missingPoolCodes = [];
  let sellingCount = 0;

  for (const code of ALL_POOLS) {
    const p = match?.pools?.[code];
    const validOpts = Array.isArray(p?.options)
      ? p.options.filter(
          (o) => Number.isFinite(Number(o?.odds)) && Number(o.odds) > 1
        )
      : [];
    const selling = Boolean(p) && p.selling !== false && validOpts.length > 0;
    const goalLine = code === "HHAD" ? String(p?.goalLine ?? "").trim() : "";
    poolStates[code] = {
      selling,
      canSingle: selling && Boolean(p?.canSingle ?? p?.single),
      canAllUp: selling && p?.canAllUp !== false,
      goalLine,
      optionCount: validOpts.length,
    };
    if (selling) {
      sellingCount += 1;
      const qObj = {};
      if (goalLine) qObj.goalLine = goalLine;
      for (const opt of validOpts) {
        qObj[String(opt.key)] = Number(opt.odds);
      }
      quotes[code] = qObj;
    } else {
      missingPoolCodes.push(code);
    }
  }

  return {
    poolStates,
    quotes,
    hasMissingPool: sellingCount > 0 && missingPoolCodes.length > 0,
    missingPoolCodes: sellingCount > 0 ? missingPoolCodes : [],
  };
}

export function createEmptyWorkbenchExposureState() {
  return {
    rawEvaluationFrames: 0,
    rawMatchExposureFrames: 0,
    skippedFallbackEvaluations: 0,
    canonicalMatches: {},
    canonicalEvaluations: [],
  };
}

/**
 * A4 只读暴露与四回报桶校准监测器（HTTP 主线程 100% 零磁盘/网络 I/O）：
 * - 严格隔离：① 开售有效板自然缺池观测（来自 historyCoordinator.telemetry.naturalMissingPoolIntervals）
 *           ② 真实工作台评估请求暴露（仅在 boardState === "fresh" 实盘有效板上记录，空板/超时/维护/旧缓存回退绝不计入）
 * - 同一比赛多帧工作台暴露按 matchId 归并为最多 1 个同域完场样本（保留最早赛前暴露，零事后挑选偏差）
 * - 结算评分强制执行 snapshot.isResultStatisticallyUnembargoed(matchId, nowMs)（缺公告时刻按 matchDate + 3d 禁运）
 */
export function createExposureAndCalibrationMonitor(opts = {}) {
  const modelVersion = String(
    opts.modelVersion || FROZEN_PRODUCTION_MODEL_VERSION
  );
  const nowFn =
    typeof opts.nowFn === "function" ? opts.nowFn : () => Date.now();
  const onSyncExposureState =
    typeof opts.onSyncExposureState === "function"
      ? opts.onSyncExposureState
      : null;

  let rawEvaluationFrames = 0;
  let rawMatchExposureFrames = 0;
  let skippedFallbackEvaluations = 0;
  const canonicalMatches = new Map();
  const canonicalEvaluations = [];
  const evalIds = new Set();
  const claimedCalibrationMatchIds = new Set();
  let hydratedSnapshotSeq = 0;
  let nextLocalEvalSeq = 1;

  function hydrateFromSnapshotState(persistedState, seq = 0) {
    if (!persistedState || typeof persistedState !== "object") return;
    if (seq > 0 && seq <= hydratedSnapshotSeq) return;
    if (seq > 0) hydratedSnapshotSeq = seq;

    let mergedDirty = false;
    const persistedMatches = persistedState.canonicalMatches || {};
    for (const [mid, rec] of Object.entries(persistedMatches)) {
      if (!rec || typeof rec !== "object") continue;
      const existing = canonicalMatches.get(mid);
      if (!existing) {
        canonicalMatches.set(mid, structuredClone(rec));
      } else if (Number(rec.decidedAt) < Number(existing.decidedAt)) {
        canonicalMatches.set(mid, {
          ...structuredClone(rec),
          rawFrameCount:
            Number(rec.rawFrameCount || 1) +
            Number(existing.rawFrameCount || 0),
        });
        mergedDirty = true;
      } else if (
        Number(rec.rawFrameCount || 0) > Number(existing.rawFrameCount || 0)
      ) {
        existing.rawFrameCount = Number(rec.rawFrameCount);
      }
    }

    const persistedEvals = Array.isArray(persistedState.canonicalEvaluations)
      ? persistedState.canonicalEvaluations
      : [];
    if (persistedEvals.length > 0) {
      // Rebuild canonical evaluations in strict chronological order so persisted earliest claims win
      const combined = [...persistedEvals, ...canonicalEvaluations];
      combined.sort(
        (a, b) => Number(a.decidedAt || 0) - Number(b.decidedAt || 0)
      );
      canonicalEvaluations.length = 0;
      evalIds.clear();
      claimedCalibrationMatchIds.clear();
      for (const ev of combined) {
        if (!ev || !ev.evalId || evalIds.has(ev.evalId)) continue;
        const mids = Array.isArray(ev.matchIds) ? ev.matchIds.map(String) : [];
        if (mids.length === 0) continue;
        if (mids.some((m) => claimedCalibrationMatchIds.has(m))) {
          mergedDirty = true;
          continue;
        }
        for (const m of mids) claimedCalibrationMatchIds.add(m);
        evalIds.add(ev.evalId);
        if (canonicalEvaluations.length < MAX_CANONICAL_EVALUATIONS) {
          canonicalEvaluations.push(structuredClone(ev));
        }
      }
    }

    rawEvaluationFrames = Math.max(
      rawEvaluationFrames,
      Number(persistedState.rawEvaluationFrames || 0)
    );
    rawMatchExposureFrames = Math.max(
      rawMatchExposureFrames,
      Number(persistedState.rawMatchExposureFrames || 0)
    );
    skippedFallbackEvaluations = Math.max(
      skippedFallbackEvaluations,
      Number(persistedState.skippedFallbackEvaluations || 0)
    );

    if (mergedDirty && onSyncExposureState) {
      onSyncExposureState(exportPersistedState());
    }
  }

  function exportPersistedState() {
    return {
      rawEvaluationFrames,
      rawMatchExposureFrames,
      skippedFallbackEvaluations,
      canonicalMatches: Object.fromEntries(canonicalMatches.entries()),
      canonicalEvaluations: canonicalEvaluations.slice(
        -MAX_CANONICAL_EVALUATIONS
      ),
    };
  }

  function recordWorkbenchEvaluation({
    endpoint = "quant/compute",
    params = {},
    matches = [],
    boardMeta = null,
    workspace = null,
    coordinator = null,
  } = {}) {
    if (coordinator?.getSnapshot) {
      const snap = coordinator.getSnapshot();
      hydrateFromSnapshotState(snap?.workbenchExposureState, snap?.seq || 0);
    }

    const isFreshLiveBoard =
      Boolean(boardMeta) &&
      boardMeta.boardState === "fresh" &&
      boardMeta.isFallbackReadOnly === false &&
      boardMeta.source === "official-live" &&
      Array.isArray(matches) &&
      matches.length > 0;

    if (!isFreshLiveBoard || !workspace) {
      skippedFallbackEvaluations += 1;
      onSyncExposureState?.(exportPersistedState());
      return { recorded: false, reason: "fallback-or-empty-board" };
    }

    const decidedAt = nowFn();
    const matchById = new Map();
    for (const m of matches) {
      if (m?.id !== undefined && m?.id !== null) {
        matchById.set(String(m.id), m);
      }
    }

    const cleanPicks = sanitizeAndDeduplicatePicks(params?.picks, 512);
    const targetIds = Array.isArray(params?.targetIds)
      ? params.targetIds.map(String)
      : [];
    const foundTargets = matches.filter((m) =>
      targetIds.includes(String(m.id))
    );
    const resolvedTargets =
      foundTargets.length > 0 ? foundTargets : matches.slice(0, 2);

    const exposedIdSet = new Set();
    for (const p of cleanPicks) {
      if (matchById.has(String(p.matchId))) exposedIdSet.add(String(p.matchId));
    }
    for (const t of resolvedTargets) {
      if (t?.id) exposedIdSet.add(String(t.id));
    }

    // Filter to pre-kickoff authoritative matches on the fresh live board
    const preKickoffMatchIds = [];
    for (const mid of exposedIdSet) {
      const m = matchById.get(mid);
      if (!m) continue;
      const koMs = resolveMatchKickoffMs(m);
      if (koMs !== null && decidedAt >= koMs) continue;
      preKickoffMatchIds.push(mid);
    }

    if (preKickoffMatchIds.length === 0) {
      return { recorded: false, reason: "no-prekickoff-matches" };
    }

    rawEvaluationFrames += 1;
    rawMatchExposureFrames += preKickoffMatchIds.length;

    const quoteInputSig = String(workspace.quoteInputSig || "");
    const cleanEndpoint =
      endpoint === "quant/sync" ? "quant/sync" : "quant/compute";

    for (const mid of preKickoffMatchIds) {
      const m = matchById.get(mid);
      const existing = canonicalMatches.get(mid);
      if (existing) {
        existing.rawFrameCount = Number(existing.rawFrameCount || 1) + 1;
        continue;
      }
      if (canonicalMatches.size >= MAX_CANONICAL_MATCHES) {
        const oldestKey = canonicalMatches.keys().next().value;
        if (oldestKey !== undefined) canonicalMatches.delete(oldestKey);
      }
      const snapPools = snapshotMatchPoolStatesAndQuotes(m);
      canonicalMatches.set(mid, {
        matchId: mid,
        matchNumStr: m.matchNumStr || null,
        decidedAt,
        endpoint: cleanEndpoint,
        modelVersion,
        quoteInputSig,
        hasMissingPool: snapPools.hasMissingPool,
        missingPoolCodes: snapPools.missingPoolCodes,
        poolStates: snapPools.poolStates,
        quotes: snapPools.quotes,
        rawFrameCount: 1,
      });
    }

    // Void-match simulation previews (simVoidFirstMatch === true) mutate ticket odds to 1.0 for sandbox stress-testing;
    // never let hypothetical void-preview slips enter pre-match calibration samples or claim calibration matchIds!
    if (Boolean(params?.simVoidFirstMatch)) {
      onSyncExposureState?.(exportPersistedState());
      return {
        recorded: true,
        deduplicatedAdded: false,
        exposedMatchIds: preKickoffMatchIds,
      };
    }

    // Build objective 4-slot snapshot & primary scored plan for canonical 1-sample-per-match evaluation
    const objPlans = Array.isArray(workspace.objectivePortfolioPlans)
      ? workspace.objectivePortfolioPlans
      : Array.isArray(workspace.portfolioPlans)
        ? workspace.portfolioPlans
        : [];

    const slotDecisions = {};
    for (const meta of PORTFOLIO_SLOT_META) {
      const sp = objPlans.find((p) => p?.key === meta.key) || null;
      const available = Boolean(
        sp &&
        sp.available &&
        Array.isArray(sp.lines) &&
        sp.lines.length > 0 &&
        sp.totalCost > 0
      );
      const builtSnap = available
        ? buildCompactTicketSnapshot(sp.lines, matchById)
        : null;
      slotDecisions[meta.key] = {
        key: meta.key,
        available: Boolean(available && builtSnap),
        emptyReason: sp?.emptyReason ?? null,
        totalCost: available ? Number(sp.totalCost) : 0,
        predictedProbs: available ? extractSlotFourBucketProbs(sp) : null,
        ticketSnapshot: builtSnap?.snapshot ?? null,
        matchIds: builtSnap?.matchIds ?? [],
      };
    }

    // Choose primary plan to score in 4-bucket calibration:
    // 1) Active checkout-ready report tickets if user evaluated concrete picks/appliedPlan
    // 2) Otherwise primary admitted objective portfolio slot (max-ev-utility -> max-profit-prob -> max-cvar-wheel -> alpha-radar)
    let primaryPlan = null;
    const eff = workspace.effectiveReport;
    if (
      eff &&
      eff.canCheckout === true &&
      Number(eff.totalCost) > 0 &&
      Array.isArray(eff.tickets) &&
      eff.tickets.length > 0
    ) {
      const builtActive = buildCompactTicketSnapshot(eff.tickets, matchById);
      if (
        builtActive &&
        builtActive.matchIds.every((mid) => preKickoffMatchIds.includes(mid))
      ) {
        primaryPlan = {
          source: workspace.appliedPlan
            ? `applied:${workspace.appliedPlan.key || "bonus"}`
            : "manual-slip",
          totalCost: Number(eff.totalCost),
          predictedProbs: extractReportFourBucketProbs(eff),
          ticketSnapshot: builtActive.snapshot,
          matchIds: builtActive.matchIds,
        };
      }
    }

    if (!primaryPlan) {
      for (const prefKey of [
        "max-ev-utility",
        "max-profit-prob",
        "max-cvar-wheel",
        "alpha-radar",
      ]) {
        const sd = slotDecisions[prefKey];
        if (
          sd?.available &&
          sd.ticketSnapshot &&
          sd.matchIds.length > 0 &&
          sd.matchIds.every((mid) => preKickoffMatchIds.includes(mid))
        ) {
          primaryPlan = {
            source: `portfolio:${prefKey}`,
            totalCost: sd.totalCost,
            predictedProbs: sd.predictedProbs,
            ticketSnapshot: sd.ticketSnapshot,
            matchIds: sd.matchIds,
          };
          break;
        }
      }
    }

    const evalMatchIds =
      primaryPlan && primaryPlan.matchIds.length > 0
        ? primaryPlan.matchIds
        : preKickoffMatchIds;

    // Enforce strict 1-sample-per-match deduplication: if any match in evalMatchIds was already claimed by an earlier pre-kickoff evaluation, do NOT add a duplicate calibration sample!
    let deduplicatedAdded = false;
    if (
      evalMatchIds.length > 0 &&
      !evalMatchIds.some((mid) => claimedCalibrationMatchIds.has(mid))
    ) {
      for (const mid of evalMatchIds) {
        claimedCalibrationMatchIds.add(mid);
      }
      const evalId = `ev_${decidedAt}_${nextLocalEvalSeq++}`;
      evalIds.add(evalId);
      if (canonicalEvaluations.length >= MAX_CANONICAL_EVALUATIONS) {
        canonicalEvaluations.shift();
      }
      canonicalEvaluations.push({
        evalId,
        decidedAt,
        endpoint: cleanEndpoint,
        modelVersion,
        quoteInputSig,
        matchIds: evalMatchIds,
        slotDecisions,
        primaryPlan,
      });
      deduplicatedAdded = true;
    }

    onSyncExposureState?.(exportPersistedState());
    return {
      recorded: true,
      deduplicatedAdded,
      exposedMatchIds: preKickoffMatchIds,
    };
  }

  function buildHistoryMonitorOverview({
    coordinator = null,
    boardMeta: routeBoardMeta = null,
    nowMs = nowFn(),
  } = {}) {
    const snap = coordinator?.getSnapshot?.() || null;
    if (snap) {
      hydrateFromSnapshotState(snap.workbenchExposureState, snap.seq || 0);
    }

    const telemetry = snap?.telemetry || {};
    const endpointsRaw = telemetry.endpoints || {};
    const endpoints = {};
    for (const ep of ENDPOINT_META) {
      const src = endpointsRaw[ep.key] || {};
      endpoints[ep.key] = {
        endpointKey: ep.key,
        label: ep.label,
        lastSuccessAt:
          typeof src.lastSuccessAt === "number" ? src.lastSuccessAt : null,
        lastErrorAt:
          typeof src.lastErrorAt === "number" ? src.lastErrorAt : null,
        lastError: src.lastError ? String(src.lastError) : null,
        consecutiveFailures: Number(src.consecutiveFailures || 0),
        backoffMs: Number(src.backoffMs || 0),
      };
    }

    const windowsRaw = telemetry.cursors?.windows || {};
    const windowSummaryMap = {};
    let completedWindows = 0;
    let partialWindows = 0;
    let verifiedUniqueMatches = 0;
    for (const [winKey, w] of Object.entries(windowsRaw)) {
      const isCompleted = w?.status === "completed";
      if (isCompleted) {
        completedWindows += 1;
        verifiedUniqueMatches += Number(w?.uniqueMatchCount || 0);
      } else {
        partialWindows += 1;
      }
      windowSummaryMap[winKey] = {
        key: String(w?.key || winKey),
        beginDate: String(w?.beginDate || ""),
        endDate: String(w?.endDate || ""),
        status: isCompleted ? "completed" : "partial",
        expectedPages:
          typeof w?.expectedPages === "number" ? w.expectedPages : null,
        expectedTotal:
          typeof w?.expectedTotal === "number" ? w.expectedTotal : null,
        verifiedPagesCount: Array.isArray(w?.verifiedPages)
          ? w.verifiedPages.length
          : 0,
        uniqueMatchCount: Number(w?.uniqueMatchCount || 0),
        nextRetryPage: Number(w?.nextRetryPage || 1),
        lastError: w?.lastError ? String(w.lastError) : null,
        updatedAt: Number(w?.updatedAt || 0),
      };
    }

    const cursors = {
      totalWindows: Object.keys(windowSummaryMap).length,
      completedWindows,
      partialWindows,
      verifiedUniqueMatches,
      pendingOpenQuoteCount: Array.isArray(
        telemetry.cursors?.pendingOpenQuoteIds
      )
        ? telemetry.cursors.pendingOpenQuoteIds.length
        : 0,
      pendingRecentDetailCount: Array.isArray(
        telemetry.cursors?.pendingRecentDetailIds
      )
        ? telemetry.cursors.pendingRecentDetailIds.length
        : 0,
      windows: windowSummaryMap,
    };

    const covRaw = telemetry.coverage || {};
    const coverage = {
      earliestQuoteAt:
        typeof covRaw.earliestQuoteAt === "number"
          ? covRaw.earliestQuoteAt
          : null,
      latestQuoteAt:
        typeof covRaw.latestQuoteAt === "number" ? covRaw.latestQuoteAt : null,
      earliestResultDate: covRaw.earliestResultDate || null,
      latestResultDate: covRaw.latestResultDate || null,
      settledResultRecordCount:
        snap?.resultsRecordsById instanceof Map
          ? snap.resultsRecordsById.size
          : 0,
      quoteSegmentCount: snap?.quoteSegments
        ? Object.keys(snap.quoteSegments).length
        : 0,
      coldArchiveShards: Array.isArray(covRaw.coldArchiveShards)
        ? [...covRaw.coldArchiveShards]
        : [],
      coverageBoundaryNote:
        covRaw.coverageBoundaryNote ||
        "未即刻全量回补过去 18 个月逐帧明细（近 90～120 天优先详情回补，更早场次按 ID 点补并显式打标）",
    };

    const sbRaw = telemetry.storageBytes || {};
    const hotDbBytes = Number(sbRaw.hotDbBytes || 0);
    const walBytes = Number(sbRaw.walBytes || 0);
    const coldArchiveBytes = Number(sbRaw.coldArchiveBytes || 0);
    const backupBytes = Number(sbRaw.backupBytes || 0);
    const totalBytes =
      typeof sbRaw.totalHistoryBytes === "number"
        ? sbRaw.totalHistoryBytes
        : hotDbBytes + walBytes + coldArchiveBytes + backupBytes;
    const storageBytes = {
      hotDbBytes,
      walBytes,
      coldArchiveBytes,
      backupBytes,
      totalBytes,
      totalHistoryBytes: totalBytes,
      coldShardCount: Number(sbRaw.coldShardCount || 0),
    };

    // 1. Natural missing-pool board observations (from fresh verified live boards ONLY)
    const intervalsRaw = Array.isArray(telemetry.naturalMissingPoolIntervals)
      ? telemetry.naturalMissingPoolIntervals
      : [];
    const byPool = { HAD: 0, HHAD: 0, TTG: 0, HAFU: 0, CRS: 0 };
    const missingMatchSet = new Set();
    let activeOpenIntervals = 0;
    let hadMissingIntervalCount = 0;
    for (const it of intervalsRaw) {
      if (!it) continue;
      if (it.matchId) missingMatchSet.add(String(it.matchId));
      if (it.resumedAt === null || it.resumedAt === undefined) {
        activeOpenIntervals += 1;
      }
      const code = String(it.poolCode || "").toUpperCase();
      if (code in byPool) {
        byPool[code] += 1;
      }
      if (code === "HAD") {
        hadMissingIntervalCount += 1;
      }
    }
    const naturalMissingPools = {
      totalIntervals: intervalsRaw.length,
      activeOpenIntervals,
      distinctMatchCount: missingMatchSet.size,
      hadMissingIntervalCount,
      byPool,
      recentIntervals: intervalsRaw.slice(-25).reverse(),
    };

    // 2. Canonical match exposures & settlement embargo classification
    const resultsRecordsById =
      snap?.resultsRecordsById instanceof Map
        ? snap.resultsRecordsById
        : new Map();
    const resultsById =
      snap?.resultsById instanceof Map ? snap.resultsById : new Map();
    const isUnembargoedFn = (mid) => {
      if (typeof snap?.isResultStatisticallyUnembargoed === "function") {
        return Boolean(snap.isResultStatisticallyUnembargoed(mid, nowMs));
      }
      const rec = resultsRecordsById.get(String(mid));
      if (!rec || !rec.settled || rec.isVoid) return false;
      return nowMs >= Number(rec.embargoUntilMs ?? 0);
    };

    let deduplicatedMissingPoolMatchCount = 0;
    let pendingMatchCount = 0;
    let embargoedSettledMatchCount = 0;
    let settledUnembargoedMatchCount = 0;
    let voidMatchCount = 0;

    const allCanonicalMatches = Array.from(canonicalMatches.values());
    for (const mRec of allCanonicalMatches) {
      if (mRec.hasMissingPool) deduplicatedMissingPoolMatchCount += 1;
      const r = resultsRecordsById.get(String(mRec.matchId));
      if (!r || !r.settled) {
        pendingMatchCount += 1;
      } else if (r.isVoid) {
        voidMatchCount += 1;
      } else if (isUnembargoedFn(mRec.matchId)) {
        settledUnembargoedMatchCount += 1;
      } else {
        embargoedSettledMatchCount += 1;
      }
    }

    const workbenchExposures = {
      modelVersion,
      rawEvaluationFrames,
      rawMatchExposureFrames,
      skippedFallbackEvaluations,
      deduplicatedMatchCount: canonicalMatches.size,
      deduplicatedMissingPoolMatchCount,
      deduplicatedEvaluationCount: canonicalEvaluations.length,
      pendingMatchCount,
      embargoedSettledMatchCount,
      settledUnembargoedMatchCount,
      voidMatchCount,
      recentCanonicalMatches: allCanonicalMatches.slice(-25).reverse(),
    };

    // 3. Slot admission/rejection counts & unconditional 4-bucket calibration on unembargoed settled samples
    const initSlotAcc = () =>
      Object.fromEntries(
        PORTFOLIO_SLOT_META.map((m) => [
          m.key,
          {
            key: m.key,
            label: m.label,
            admittedCount: 0,
            rejectedCount: 0,
            admissionRate: null,
            calibratedSampleCount: 0,
            brierScore: null,
            logLoss: null,
          },
        ])
      );

    const liveBySlot = initSlotAcc();
    const settledBySlot = initSlotAcc();
    const slotCalibSums = Object.fromEntries(
      PORTFOLIO_SLOT_META.map((m) => [
        m.key,
        { count: 0, brierSum: 0, logLossSum: 0 },
      ])
    );
    let settledSlotSampleCount = 0;

    let calibSampleCount = 0;
    let embargoHeldEvaluationCount = 0;
    let pendingEvaluationCount = 0;
    let sumBrier = 0;
    let sumLogLoss = 0;
    const empCounts = [0, 0, 0, 0];
    const sumPredProbs = [0, 0, 0, 0];

    for (const ev of canonicalEvaluations) {
      for (const meta of PORTFOLIO_SLOT_META) {
        const sd = ev.slotDecisions?.[meta.key];
        if (sd?.available) liveBySlot[meta.key].admittedCount += 1;
        else liveBySlot[meta.key].rejectedCount += 1;
      }

      const mids = Array.isArray(ev.matchIds) ? ev.matchIds : [];
      if (mids.length === 0) continue;

      let anyVoid = false;
      let anyPending = false;
      let anyEmbargoHeld = false;
      for (const mid of mids) {
        const r = resultsRecordsById.get(String(mid));
        if (!r || !r.settled) {
          anyPending = true;
        } else if (r.isVoid) {
          anyVoid = true;
        } else if (!isUnembargoedFn(mid)) {
          anyEmbargoHeld = true;
        }
      }

      if (anyVoid) continue;
      if (anyPending) {
        pendingEvaluationCount += 1;
        continue;
      }
      if (anyEmbargoHeld) {
        embargoHeldEvaluationCount += 1;
        continue;
      }

      // All matches in this deduplicated sample are settled, non-void, and past settlement embargo!
      settledSlotSampleCount += 1;
      for (const meta of PORTFOLIO_SLOT_META) {
        const sd = ev.slotDecisions?.[meta.key];
        if (sd?.available) {
          settledBySlot[meta.key].admittedCount += 1;
          if (
            sd.ticketSnapshot &&
            Number(sd.totalCost) > 0 &&
            Array.isArray(sd.matchIds) &&
            sd.matchIds.length > 0 &&
            sd.matchIds.every((mid) => isUnembargoedFn(mid))
          ) {
            const slotSettled = settleTicketSnapshotWithOfficialResults(
              sd.ticketSnapshot,
              resultsById,
              { stakeCost: Number(sd.totalCost) }
            );
            if (slotSettled.status !== "pending") {
              const sProbs = normalizeFourBucketProbs(sd.predictedProbs);
              const sIdx = classifySettledOutcomeBucket(
                slotSettled.settledReturn,
                sd.totalCost
              );
              let sBrier = 0;
              for (let k = 0; k < 4; k += 1) {
                const y = k === sIdx ? 1 : 0;
                sBrier += (sProbs[k] - y) ** 2;
              }
              slotCalibSums[meta.key].count += 1;
              slotCalibSums[meta.key].brierSum += sBrier;
              slotCalibSums[meta.key].logLossSum += -Math.log(
                Math.max(1e-12, sProbs[sIdx])
              );
            }
          }
        } else {
          settledBySlot[meta.key].rejectedCount += 1;
        }
      }

      const plan = ev.primaryPlan;
      if (!plan || !plan.ticketSnapshot || !(Number(plan.totalCost) > 0)) {
        continue;
      }

      const settled = settleTicketSnapshotWithOfficialResults(
        plan.ticketSnapshot,
        resultsById,
        { stakeCost: Number(plan.totalCost) }
      );
      if (settled.status === "pending") {
        pendingEvaluationCount += 1;
        continue;
      }

      const probs = normalizeFourBucketProbs(plan.predictedProbs);
      const bucketIdx = classifySettledOutcomeBucket(
        settled.settledReturn,
        plan.totalCost
      );

      let sampleBrier = 0;
      for (let k = 0; k < 4; k += 1) {
        const y = k === bucketIdx ? 1 : 0;
        const diff = probs[k] - y;
        sampleBrier += diff * diff;
        sumPredProbs[k] += probs[k];
      }
      const sampleLogLoss = -Math.log(Math.max(1e-12, probs[bucketIdx]));

      empCounts[bucketIdx] += 1;
      sumBrier += sampleBrier;
      sumLogLoss += sampleLogLoss;
      calibSampleCount += 1;
    }

    for (const meta of PORTFOLIO_SLOT_META) {
      const l = liveBySlot[meta.key];
      const lTot = l.admittedCount + l.rejectedCount;
      l.admissionRate = lTot > 0 ? round6(l.admittedCount / lTot) : null;

      const s = settledBySlot[meta.key];
      const sTot = s.admittedCount + s.rejectedCount;
      s.admissionRate = sTot > 0 ? round6(s.admittedCount / sTot) : null;
      const sc = slotCalibSums[meta.key];
      s.calibratedSampleCount = sc.count;
      s.brierScore = sc.count > 0 ? round6(sc.brierSum / sc.count) : null;
      s.logLoss = sc.count > 0 ? round6(sc.logLossSum / sc.count) : null;
    }

    const buildBucketMetric = (idx, key, label) => {
      if (calibSampleCount === 0) {
        return {
          key,
          label,
          empiricalCount: 0,
          empiricalRate: null,
          meanPredictedProb: null,
          calibrationGap: null,
        };
      }
      const empRate = empCounts[idx] / calibSampleCount;
      const meanPred = sumPredProbs[idx] / calibSampleCount;
      return {
        key,
        label,
        empiricalCount: empCounts[idx],
        empiricalRate: round6(empRate),
        meanPredictedProb: round6(meanPred),
        calibrationGap: round6(empRate - meanPred),
      };
    };

    const fourBucketCalibration = {
      modelVersion,
      sampleCount: calibSampleCount,
      embargoHeldEvaluationCount,
      pendingEvaluationCount,
      brierScore:
        calibSampleCount > 0 ? round6(sumBrier / calibSampleCount) : null,
      logLoss:
        calibSampleCount > 0 ? round6(sumLogLoss / calibSampleCount) : null,
      buckets: {
        wipeout: buildBucketMetric(0, "wipeout", "整单归零"),
        underwater: buildBucketMetric(1, "underwater", "局部回血倒贴"),
        breakEven: buildBucketMetric(2, "breakEven", "平手保本"),
        strictNetGain: buildBucketMetric(3, "strictNetGain", "严格净赚"),
      },
    };

    const resolvedBoardMeta =
      routeBoardMeta ||
      snap?.boardMeta ||
      buildBoardFreshnessMeta({
        source: "fallback",
        boardState: "builtin-fallback",
        lastValidBoardAt: null,
      });

    return {
      generatedAt: nowMs,
      modelVersion,
      collector: {
        isStarted: Boolean(coordinator?.isStarted),
        isWorkerRunning: Boolean(coordinator?.isWorkerRunning),
        storageBackend: String(snap?.storageBackend || "memory"),
        snapshotSeq: Number(snap?.seq ?? 0),
        rejectedSwapCount: Number(coordinator?.rejectedSwapCount ?? 0),
        boardMeta: resolvedBoardMeta,
      },
      endpoints,
      cursors,
      coverage,
      storageBytes,
      naturalMissingPools,
      workbenchExposures,
      slotAdmissions: {
        liveDeduplicatedSampleCount: canonicalEvaluations.length,
        settledUnembargoedSampleCount: settledSlotSampleCount,
        liveBySlot,
        settledBySlot,
      },
      fourBucketCalibration,
    };
  }

  return {
    modelVersion,
    recordWorkbenchEvaluation,
    buildHistoryMonitorOverview,
    exportPersistedState,
    hydrateFromSnapshotState,
  };
}
