import {
  devigPoolProbabilities,
  formatDualAxisSteamSignal,
} from "../quant/coherentCalibration.mjs";
import {
  CRS_CANONICAL_KEY_TO_LABEL,
  CRS_LABEL_TO_CANONICAL_KEY,
  formatBeijingMonthDayHM,
  isValidSellingQuoteFrame,
  parseBeijingDateTimeMs,
} from "./sportteryHistoryNormalizers.mjs";

export const DUAL_AXIS_POOL_ORDER = Object.freeze([
  "HAD",
  "HHAD",
  "TTG",
  "HAFU",
  "CRS",
]);

const CRS_ALIAS_KEY_MAP = Object.freeze({
  "s-1sh": "s1sh",
  "s-1sd": "s1sd",
  "s-1sa": "s1sa",
});

function normalizeTrend(v) {
  if (v === 1 || v === "1") return 1;
  if (v === -1 || v === "-1") return -1;
  return 0;
}

export function resolveCanonicalOptionKey(poolCode, opt) {
  const rawKey = String(opt?.key ?? "").trim();
  const rawLabel = String(opt?.label ?? "").trim();
  if (poolCode === "CRS") {
    return (
      CRS_LABEL_TO_CANONICAL_KEY[rawKey] ||
      CRS_LABEL_TO_CANONICAL_KEY[rawLabel] ||
      CRS_ALIAS_KEY_MAP[rawKey] ||
      rawKey
    );
  }
  return rawKey;
}

function computePureOddsSig(optionsMap) {
  if (!optionsMap || typeof optionsMap !== "object") return "";
  const entries = [];
  for (const k of Object.keys(optionsMap).sort()) {
    const odds = Number(optionsMap[k]?.odds ?? optionsMap[k] ?? 0);
    if (Number.isFinite(odds) && odds > 1) {
      entries.push(`${k}:${odds.toFixed(4)}`);
    }
  }
  return entries.join("|");
}

function formatFrameClock(frame) {
  if (!frame || typeof frame !== "object") return null;
  if (
    typeof frame.sourcePublishedAt === "number" &&
    Number.isFinite(frame.sourcePublishedAt)
  ) {
    return formatBeijingMonthDayHM(frame.sourcePublishedAt);
  }
  if (
    typeof frame.sourcePublishedText === "string" &&
    frame.sourcePublishedText.trim()
  ) {
    const parsed = parseBeijingDateTimeMs(frame.sourcePublishedText.trim());
    if (parsed !== null) return formatBeijingMonthDayHM(parsed);
  }
  if (
    typeof frame.firstLocallySeenAt === "number" &&
    Number.isFinite(frame.firstLocallySeenAt)
  ) {
    return formatBeijingMonthDayHM(frame.firstLocallySeenAt);
  }
  return null;
}

function buildVirtualLiveFrame(poolCode, normGoalLine, pool, matchDate, nowMs) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options)) {
    return null;
  }
  const options = {};
  let validCount = 0;
  for (const opt of pool.options) {
    const odds = Number(opt?.odds || 0);
    if (!Number.isFinite(odds) || odds <= 1) continue;
    const canonicalKey = resolveCanonicalOptionKey(poolCode, opt);
    if (!canonicalKey) continue;
    options[canonicalKey] = {
      odds,
      trend: normalizeTrend(opt?.trend),
    };
    validCount += 1;
  }
  if (validCount === 0) return null;

  const updateDate = String(pool.updateDate || matchDate || "").trim();
  const updateTime =
    pool.updateTime && pool.updateTime !== "实时"
      ? String(pool.updateTime).trim()
      : "";
  const sourcePublishedAt =
    updateDate && updateTime
      ? parseBeijingDateTimeMs(updateDate, updateTime)
      : null;
  const sourcePublishedText =
    updateDate && updateTime ? `${updateDate} ${updateTime}` : null;

  return {
    poolCode,
    goalLine: normGoalLine,
    frameOrigin: "live-poll",
    isBackfilled: false,
    selling: true,
    options,
    sourcePublishedAt,
    sourcePublishedText,
    firstLocallySeenAt: nowMs,
    lastLocallySeenAt: nowMs,
  };
}

function resolveEffectivePoolFrames(
  matchId,
  poolCode,
  normGoalLine,
  pool,
  historySnapshot,
  {
    isFallbackReadOnly = false,
    nowMs = Date.now(),
    decisionEpochMs = null,
    matchDate = null,
  } = {}
) {
  const seg =
    historySnapshot?.getPoolSegmentFrames?.(matchId, poolCode, normGoalLine) ??
    null;
  const effectiveNowMs =
    typeof decisionEpochMs === "number" && Number.isFinite(decisionEpochMs)
      ? decisionEpochMs
      : nowMs;
  const liveFrame = buildVirtualLiveFrame(
    poolCode,
    normGoalLine,
    pool,
    matchDate,
    effectiveNowMs
  );

  const hasExplicitDecisionCutoff =
    typeof decisionEpochMs === "number" && Number.isFinite(decisionEpochMs);
  const rawSegFrames = Array.isArray(seg?.frames)
    ? seg.frames.filter(isValidSellingQuoteFrame)
    : [];
  const candidateFrames = hasExplicitDecisionCutoff
    ? rawSegFrames.filter((f) => {
        const ts = f?.sourcePublishedAt ?? f?.firstLocallySeenAt ?? null;
        return ts === null || ts <= decisionEpochMs;
      })
    : [...rawSegFrames];
  if (candidateFrames.length === 0) {
    if (liveFrame) candidateFrames.push(liveFrame);
  } else if (!isFallbackReadOnly && liveFrame) {
    const tail = candidateFrames[candidateFrames.length - 1];
    const liveSig = computePureOddsSig(liveFrame.options);
    const tailSig = computePureOddsSig(tail?.options);
    if (liveSig && liveSig !== tailSig) {
      const liveTs =
        liveFrame.sourcePublishedAt ?? liveFrame.firstLocallySeenAt ?? null;
      const tailTs =
        tail?.sourcePublishedAt ?? tail?.firstLocallySeenAt ?? null;
      if (liveTs === null || tailTs === null || liveTs >= tailTs) {
        candidateFrames.push(liveFrame);
      }
    }
  }

  const collapsed = [];
  for (const f of candidateFrames) {
    const sig = computePureOddsSig(f?.options);
    if (!sig) continue;
    const prev = collapsed.length > 0 ? collapsed[collapsed.length - 1] : null;
    if (prev && prev._pureSig === sig) {
      if (f.frameOrigin === "official-archive-open") {
        prev.frameOrigin = "official-archive-open";
      }
      if (prev.sourcePublishedAt == null && f.sourcePublishedAt != null) {
        prev.sourcePublishedAt = f.sourcePublishedAt;
        prev.sourcePublishedText = f.sourcePublishedText;
      }
      prev.lastLocallySeenAt = Math.max(
        prev.lastLocallySeenAt ?? 0,
        f.lastLocallySeenAt ?? f.firstLocallySeenAt ?? 0
      );
      continue;
    }
    collapsed.push({
      ...f,
      _pureSig: sig,
    });
  }

  const frameCount = collapsed.length;
  const openFrame = collapsed[0] || null;
  const latestFrame = frameCount > 0 ? collapsed[frameCount - 1] : null;
  const prevFrame = frameCount >= 2 ? collapsed[frameCount - 2] : null;
  const hasOfficialArchiveOpen = Boolean(
    seg?.hasOfficialArchiveOpen ||
    collapsed.some((f) => f.frameOrigin === "official-archive-open")
  );

  return {
    hasOfficialArchiveOpen,
    frameCount,
    openFrame,
    prevFrame,
    latestFrame,
  };
}

export function formatBaselineSourceLabel(baselineSource) {
  if (baselineSource === "official-archive-open") return "自官方归档首报";
  if (baselineSource === "local-first-seen") return "自本系统首次观测";
  return "仅单帧观测·暂不判趋势";
}

/**
 * 计算单个玩法在指定 (matchId, poolCode, goalLine) 分段上的双维盘面走势：
 * - 维度①：在 openFrame 与 latestFrame 的相同有效选项集（odds > 1）上使用统一 devigPoolProbabilities("shin") 实算 100 * (p_now - p_open)；
 * - 维度②：由 prevFrame -> latestFrame 实算末跳水位、时间与升降方向（单帧时保留实盘末跳箭头，绝不反转箭头冒充真率趋势）。
 */
export function computePoolDualAxisMovements(
  matchId,
  pool,
  historySnapshot,
  opts = {}
) {
  const poolCode = String(pool?.code || opts.poolCode || "HAD");
  const normGoalLine =
    poolCode === "HHAD" ? String(pool?.goalLine ?? "").trim() : "";
  const {
    hasOfficialArchiveOpen,
    frameCount,
    openFrame,
    prevFrame,
    latestFrame,
  } = resolveEffectivePoolFrames(
    matchId,
    poolCode,
    normGoalLine,
    pool,
    historySnapshot,
    opts
  );

  const baselineSource =
    frameCount < 2
      ? "single-frame"
      : hasOfficialArchiveOpen
        ? "official-archive-open"
        : "local-first-seen";

  const deltaByKey = new Map();
  if (frameCount >= 2 && openFrame?.options && latestFrame?.options) {
    const sharedKeys = Object.keys(latestFrame.options)
      .filter((k) => {
        const oOpen = Number(openFrame.options?.[k]?.odds || 0);
        const oNow = Number(latestFrame.options?.[k]?.odds || 0);
        return (
          Number.isFinite(oOpen) &&
          oOpen > 1 &&
          Number.isFinite(oNow) &&
          oNow > 1
        );
      })
      .sort();

    if (sharedKeys.length >= 2) {
      const openProbs = devigPoolProbabilities(
        sharedKeys.map((k) => openFrame.options[k].odds),
        "shin"
      ).probs;
      const nowProbs = devigPoolProbabilities(
        sharedKeys.map((k) => latestFrame.options[k].odds),
        "shin"
      ).probs;
      for (let i = 0; i < sharedKeys.length; i += 1) {
        const rawPp = 100 * ((nowProbs[i] ?? 0) - (openProbs[i] ?? 0));
        const roundedPp = Number(rawPp.toFixed(2));
        deltaByKey.set(sharedKeys[i], Object.is(roundedPp, -0) ? 0 : roundedPp);
      }
    }
  }

  const openAt = formatFrameClock(openFrame);
  const prevAt = formatFrameClock(prevFrame);
  const currentAt = formatFrameClock(latestFrame);

  const byOptionKey = new Map();
  for (const opt of pool?.options || []) {
    const canonicalKey = resolveCanonicalOptionKey(poolCode, opt);
    const liveOdds =
      Number.isFinite(Number(opt?.odds)) && Number(opt.odds) > 1
        ? Number(opt.odds)
        : null;

    if (frameCount >= 2) {
      const openOdds = openFrame?.options?.[canonicalKey]?.odds ?? null;
      const prevOdds = prevFrame?.options?.[canonicalKey]?.odds ?? null;
      const currentOdds =
        latestFrame?.options?.[canonicalKey]?.odds ?? liveOdds;
      const lastHopDirection =
        prevOdds !== null && currentOdds !== null
          ? currentOdds > prevOdds + 1e-6
            ? 1
            : currentOdds < prevOdds - 1e-6
              ? -1
              : 0
          : normalizeTrend(opt?.trend);

      const movement = Object.freeze({
        baselineSource,
        frameCount,
        goalLine: normGoalLine,
        cumFairProbDeltaPp: deltaByKey.has(canonicalKey)
          ? deltaByKey.get(canonicalKey)
          : null,
        openOdds,
        openAt,
        prevOdds,
        prevAt,
        currentOdds,
        currentAt,
        lastHopDirection,
      });
      byOptionKey.set(opt.key, movement);
      if (canonicalKey !== opt.key) byOptionKey.set(canonicalKey, movement);
    } else {
      const openOdds = openFrame?.options?.[canonicalKey]?.odds ?? liveOdds;
      const currentOdds =
        latestFrame?.options?.[canonicalKey]?.odds ?? liveOdds;
      const lastHopDirection = normalizeTrend(opt?.trend);
      const movement = Object.freeze({
        baselineSource: "single-frame",
        frameCount,
        goalLine: normGoalLine,
        cumFairProbDeltaPp: null,
        openOdds,
        openAt,
        prevOdds: null,
        prevAt: null,
        currentOdds,
        currentAt,
        lastHopDirection,
      });
      byOptionKey.set(opt.key, movement);
      if (canonicalKey !== opt.key) byOptionKey.set(canonicalKey, movement);
    }
  }

  return {
    poolCode,
    goalLine: normGoalLine,
    baselineSource,
    frameCount,
    openAt,
    prevAt,
    currentAt,
    byOptionKey,
  };
}

export function computeMatchDualAxisMovements(
  match,
  historySnapshot,
  opts = {}
) {
  const out = {};
  if (!match?.id || !match?.pools) return out;
  for (const poolCode of DUAL_AXIS_POOL_ORDER) {
    const pool = match.pools[poolCode];
    if (!pool) continue;
    out[poolCode] = computePoolDualAxisMovements(
      String(match.id),
      pool,
      historySnapshot,
      {
        ...opts,
        poolCode,
        matchDate: opts.matchDate ?? match.matchDate ?? null,
      }
    );
  }
  return out;
}

/**
 * 统一单场双维盘面走势客观摘要器（供 microQuant.steamSignal 与 Ticket #19 扫地僧小高双链路共享事实）
 */
export function summarizeMatchDualAxisMovements(match) {
  const poolsSummary = {};
  const notableMovements = [];
  let hasMultiFrameTrend = false;
  let latestChangeAt = null;

  for (const poolCode of DUAL_AXIS_POOL_ORDER) {
    const pool = match?.pools?.[poolCode];
    if (!pool) continue;
    const selling =
      pool.selling !== false &&
      Array.isArray(pool.options) &&
      pool.options.length > 0;
    const goalLine =
      poolCode === "HHAD" ? String(pool.goalLine ?? "").trim() : "";
    const firstMov = pool.options?.[0]?.movement || null;
    const baselineSource = firstMov?.baselineSource || "single-frame";
    const frameCount = Number(firstMov?.frameCount ?? (selling ? 1 : 0));
    if (selling && frameCount >= 2) {
      hasMultiFrameTrend = true;
    }

    const optionItems = [];
    for (const opt of pool.options || []) {
      const mov = opt?.movement || null;
      const canonicalKey = resolveCanonicalOptionKey(poolCode, opt);
      const label =
        opt?.label ||
        (poolCode === "CRS"
          ? CRS_CANONICAL_KEY_TO_LABEL[canonicalKey] || canonicalKey
          : canonicalKey);
      const lastHopDirection = normalizeTrend(
        mov?.lastHopDirection ?? opt?.trend
      );
      const cumFairProbDeltaPp =
        typeof mov?.cumFairProbDeltaPp === "number" &&
        Number.isFinite(mov.cumFairProbDeltaPp)
          ? mov.cumFairProbDeltaPp
          : null;
      const isSameDirectionShift = Boolean(
        cumFairProbDeltaPp !== null &&
        ((lastHopDirection === -1 && cumFairProbDeltaPp < -0.05) ||
          (lastHopDirection === 1 && cumFairProbDeltaPp > 0.05))
      );

      if (
        mov?.currentAt &&
        (!latestChangeAt || mov.currentAt > latestChangeAt)
      ) {
        latestChangeAt = mov.currentAt;
      }

      const item = Object.freeze({
        poolCode,
        poolName: pool.name || poolCode,
        goalLine,
        key: opt.key,
        canonicalKey,
        label,
        currentOdds: Number(mov?.currentOdds ?? opt?.odds ?? 0) || null,
        fairProb: Number(opt?.fairProb ?? 0),
        baselineSource: mov?.baselineSource || "single-frame",
        frameCount: Number(mov?.frameCount ?? (selling ? 1 : 0)),
        cumFairProbDeltaPp,
        openOdds: mov?.openOdds ?? null,
        openAt: mov?.openAt ?? null,
        prevOdds: mov?.prevOdds ?? null,
        prevAt: mov?.prevAt ?? null,
        currentAt: mov?.currentAt ?? null,
        lastHopDirection,
        isSameDirectionShift,
      });
      optionItems.push(item);

      if (
        selling &&
        ((cumFairProbDeltaPp !== null && Math.abs(cumFairProbDeltaPp) >= 0.1) ||
          lastHopDirection !== 0)
      ) {
        notableMovements.push(item);
      }
    }

    poolsSummary[poolCode] = Object.freeze({
      poolCode,
      poolName: pool.name || poolCode,
      selling,
      goalLine,
      baselineSource,
      baselineLabel: formatBaselineSourceLabel(baselineSource),
      frameCount,
      openAt: firstMov?.openAt ?? null,
      prevAt: firstMov?.prevAt ?? null,
      currentAt: firstMov?.currentAt ?? null,
      options: Object.freeze(optionItems),
    });
  }

  // Prioritize HAD / HHAD same-direction shifts and largest |Δp| movements for concise summary
  const mainFirstRank = (pCode) =>
    pCode === "HAD" ? 0 : pCode === "HHAD" ? 1 : 2;
  notableMovements.sort((a, b) => {
    const aMain = mainFirstRank(a.poolCode);
    const bMain = mainFirstRank(b.poolCode);
    if (a.isSameDirectionShift !== b.isSameDirectionShift) {
      return a.isSameDirectionShift ? -1 : 1;
    }
    if (aMain !== bMain) return aMain - bMain;
    const aDp = Math.abs(a.cumFairProbDeltaPp ?? 0);
    const bDp = Math.abs(b.cumFairProbDeltaPp ?? 0);
    if (Math.abs(bDp - aDp) > 1e-6) return bDp - aDp;
    return Math.abs(b.lastHopDirection) - Math.abs(a.lastHopDirection);
  });

  const multiItems = notableMovements.filter((x) => x.frameCount >= 2);
  const topMulti = multiItems[0] || null;
  const primaryBaselineLabel =
    poolsSummary.HAD?.frameCount >= 2
      ? poolsSummary.HAD.baselineLabel
      : poolsSummary.HHAD?.frameCount >= 2
        ? poolsSummary.HHAD.baselineLabel
        : "多帧观测";
  const steamSignal = formatDualAxisSteamSignal({
    hasMultiFrameTrend,
    primaryBaselineLabel,
    topMultiItem: topMulti
      ? {
          ...topMulti,
          srcLabel: formatBaselineSourceLabel(topMulti.baselineSource),
        }
      : null,
    singleHopItems: notableMovements.filter((x) => x.lastHopDirection !== 0),
  });

  return Object.freeze({
    matchId: match?.id ? String(match.id) : "",
    hasMultiFrameTrend,
    latestChangeAt,
    notableMovements: Object.freeze(notableMovements),
    pools: Object.freeze(poolsSummary),
    steamSignal,
  });
}

/**
 * 为在售赛事列表注入不可变双维盘面走势（100% 保持 fairProb / odds / payoutRatio / vig 出厂零改动）
 */
export function hydrateMatchesWithDualAxisMovement(
  matches,
  historySnapshot,
  opts = {}
) {
  if (!Array.isArray(matches) || matches.length === 0) return [];
  const isFallbackReadOnly = Boolean(opts.boardMeta?.isFallbackReadOnly);
  const decisionEpochMs =
    typeof opts.decisionEpochMs === "number" &&
    Number.isFinite(opts.decisionEpochMs)
      ? opts.decisionEpochMs
      : null;
  const nowMs =
    typeof opts.nowMs === "number"
      ? opts.nowMs
      : decisionEpochMs !== null
        ? decisionEpochMs
        : Date.now();

  return matches.map((m) => {
    if (!m || typeof m !== "object" || !m.pools) return m;
    const poolMovements = computeMatchDualAxisMovements(m, historySnapshot, {
      isFallbackReadOnly,
      nowMs,
      decisionEpochMs,
      matchDate: m.matchDate ?? null,
    });

    const nextPools = {};
    for (const [poolCode, pool] of Object.entries(m.pools)) {
      const pm = poolMovements[poolCode];
      if (!pool || !pm || !Array.isArray(pool.options)) {
        nextPools[poolCode] = pool;
        continue;
      }
      nextPools[poolCode] = {
        ...pool,
        options: pool.options.map((opt) => {
          const movement = pm.byOptionKey.get(opt.key);
          if (!movement) return opt;
          return {
            ...opt,
            trend: movement.lastHopDirection,
            movement,
          };
        }),
      };
    }

    const hydratedMatch = {
      ...m,
      pools: nextPools,
    };
    const summary = summarizeMatchDualAxisMovements(hydratedMatch);
    if (hydratedMatch.microQuant) {
      hydratedMatch.microQuant = {
        ...hydratedMatch.microQuant,
        steamSignal: summary.steamSignal,
        microBadges: Array.isArray(hydratedMatch.microQuant.microBadges)
          ? hydratedMatch.microQuant.microBadges.filter(
              (b) =>
                !(
                  b?.tone === "purple" && String(b?.text || "").includes("降水")
                )
            )
          : [],
      };
    }
    return hydratedMatch;
  });
}
