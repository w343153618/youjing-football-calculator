// Pure TruthReport evaluation, auto-mounted synthetic single, Three-Mode Bonus Optimization,
// sandbox simulation, staggered kickoff hedge / bridge finder, and official 90m snapshot settlement (zero I/O).
import { orderedMatchKey } from "../matchIdentity.mjs";
import {
  OFFICIAL_COMBO_PASS_TABLE,
  OFFICIAL_CRS_PAIRS,
  POOL_MAX_PASS,
  TRUSTED_SERVER_BONUS_PLANS,
  allocateInverseOddsDutching,
  attachLazyConsolidatedLines,
  bankerRoundParlayUnitPayout,
  certifyAndSolveJointBreakeven,
  combinationsOfIndices,
  computeBreakevenUpgradeCost,
  computeLineStatutoryPayout,
  consolidateCloseMultiples,
  consolidateTerminalPhysicalSlips,
  countActiveNonVoidLegs,
  countPhysical99xSlips,
  effectiveNonVoidLegCount,
  isPoolAllUpEligible,
  isPoolSingleEligible,
  shallowClonePlanWithoutConsolidated,
  statutorySingleBetCap,
  verifyBreakevenWitness,
  waterFillInverseOddsNotes,
} from "./statutoryRules.mjs";
import {
  ATOMIC_TEMPLATES,
  CRS_INDEX_BY_KEY,
  canDiscreteSplitBeatSingleAtExactNotes,
  computeCapitalWeightedVig,
  computeEquivalentArbitrages,
  computeMatchPoolsFingerprint,
  doesOptionHitAtomicTemplate,
  evaluatePickSetEquivalence,
  getMatchBaseAtomicProbs,
  resolveGoalLineNum,
  resolveMatchAtomicContexts,
  resolvePureSingleSubsetPoolCandidates,
  sumOptionProbOnAtomic,
} from "./coherentCalibration.mjs";
import {
  canonicalTicketLegSig,
  evaluateTicketsOnQuotientSpace,
} from "./quotientStateSpace.mjs";
import { computeSurvivingMissOneFloor } from "./paretoPortfolio.mjs";

function buildFreePassMetadata(
  matchCount,
  poolCap,
  isAllSingle,
  forceSingleOnly,
  activePassSizes,
  hasSingleOnlyPick = false
) {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((size) => {
    const label = size === 1 ? "单关" : `${size}关`;
    let enabled = false;
    let disabledReason = null;
    if (matchCount === 0) {
      disabledReason = "请先选比赛";
    } else if (size === 1) {
      enabled = isAllSingle;
      if (!enabled) disabledReason = "所选含未开单关玩法";
    } else if (forceSingleOnly) {
      disabledReason = "当前选单仅限单关";
    } else if (hasSingleOnlyPick) {
      disabledReason = "含仅单关玩法禁串";
    } else if (size > matchCount) {
      disabledReason = `需选满${size}场`;
    } else if (size > poolCap) {
      disabledReason = poolCap <= 4 ? "含比分/半全场限4关" : "含总进球限6关";
    } else {
      enabled = true;
    }
    return {
      size,
      label,
      enabled,
      active: activePassSizes.includes(size),
      disabledReason,
    };
  });
}

function buildComboPassMetadata(
  matchCount,
  poolCap,
  forceSingleOnly,
  activeComboCode,
  mTupleCount = 1,
  hasSingleOnlyPick = false
) {
  const presets = OFFICIAL_COMBO_PASS_TABLE[matchCount] ?? [];
  return presets.map((pr) => {
    const enabled =
      !forceSingleOnly &&
      !hasSingleOnlyPick &&
      pr.sizes.every((s) => s <= poolCap);
    return {
      code: pr.code,
      label: pr.label,
      sizes: pr.sizes,
      baseBets: pr.baseBets,
      actualBets: pr.baseBets * Math.max(1, mTupleCount),
      desc: pr.desc,
      enabled,
      active: activeComboCode === pr.code,
      disabledReason: forceSingleOnly
        ? "当前选单仅限单关"
        : hasSingleOnlyPick
          ? "含仅单关玩法禁串"
          : !enabled
            ? poolCap <= 4
              ? "含比分/半全场限4关"
              : "含总进球限6关"
            : null,
    };
  });
}

function buildBlockedTruthReport({
  matchCount,
  betCount = 0,
  betCountUnit = "logical-lines",
  totalCost = 0,
  estimatedOverCapCost = null,
  multiple,
  modeLabel,
  canSingle,
  ruleBlockReason,
  poolCap,
  activePassSizes = [],
  activeComboCode = null,
  bankerMatchIds = [],
  availableFreePasses,
  availableComboPasses,
  hasSameMatchCrossPoolConflict,
  dangerScore,
  selectionStatus,
  distributionStatus = "none",
  basicExpandedCount = 0,
  logicalLineCount = 0,
  stakeUnitsCount = 0,
  singlePoolAlternatives,
  crossPoolSingleAlternatives,
  syntheticHint,
  syntheticRescuePicks,
  warnings,
}) {
  const resolvedSelectionStatus =
    selectionStatus ?? (matchCount === 0 ? "empty" : "rule-blocked");
  return {
    matchCount,
    betCount,
    betCountUnit,
    comboCount: 0,
    multiple,
    modeLabel,
    canSingle,
    canCheckout: false,
    ruleBlockReason,
    poolCap,
    activePassSizes,
    activeComboCode,
    bankerMatchIds,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    isEmptySlip: true,
    totalCost,
    ...(estimatedOverCapCost !== null && estimatedOverCapCost !== undefined
      ? { estimatedOverCapCost }
      : {}),
    minPayout: 0,
    maxPayout: 0,
    conditionalMinHitPayout: 0,
    conditionalMaxHitPayout: 0,
    isUnconditionalFloorGuaranteed: false,
    unconditionalQuantiles: { p20: 0, p50: 0, p80: 0, p99: 0 },
    objectiveUnconditionalQuantiles: { p20: 0, p50: 0, p80: 0, p99: 0 },
    likelyRange: [0, 0],
    anyWinProb: 0,
    zeroPayoutProb: 0,
    partialLossProb: 0,
    realProfitProb: 0,
    strictNetGainProb: 0,
    breakEvenProb: 0,
    objectiveZeroPayoutProb: 0,
    objectivePartialLossProb: 0,
    objectiveBreakEvenProb: 0,
    underwaterCount: 0,
    underwaterShareOfWins: 0,
    avgPayoutRatio: 0,
    avgVigLossPer100: 0,
    expectedValueRate: 0,
    objectiveEVRate: 0,
    objectiveProfitProb: 0,
    objectiveStrictNetGainProb: 0,
    subjectiveProjectedEVRate: null,
    subjectiveProjectedProfitProb: null,
    dangerScore: dangerScore ?? (matchCount > 0 ? 45 : 0),
    effectiveOdds: 0,
    breakevenUpgradeCost: null,
    selectionStatus: resolvedSelectionStatus,
    distributionStatus,
    basicExpandedCount,
    logicalLineCount,
    stakeUnitsCount,
    physicalSlipCount: 0,
    physicalSlips: [],
    zeroPayoutZeroHitProb: 0,
    zeroPayoutSubThresholdProb: 0,
    partialLossShortfall: 0,
    totalCapitalShortfallD: 0,
    breakevenCert: null,
    ...(singlePoolAlternatives !== undefined ? { singlePoolAlternatives } : {}),
    ...(crossPoolSingleAlternatives !== undefined
      ? { crossPoolSingleAlternatives }
      : {}),
    consolidatedTickets: 0,
    syntheticHint: syntheticHint ?? null,
    syntheticRescuePicks: syntheticRescuePicks ?? null,
    tickets: [],
    combos: [],
    warnings: warnings ?? [],
  };
}

const VALID_AUDITED_LEG_SOURCES = new Set([
  "manual-anchor",
  "same-match-shield",
  "cross-pool-substitute",
  "bridge-mate",
]);

export function sanitizeAndDeduplicatePicks(rawPicksInput, maxLen = 512) {
  if (!Array.isArray(rawPicksInput) || rawPicksInput.length === 0) return [];
  const out = [];
  const indexBySig = new Map();
  const scanCap = Math.min(rawPicksInput.length, 4096);
  for (let i = 0; i < scanCap; i++) {
    const p = rawPicksInput[i];
    if (
      !p ||
      typeof p !== "object" ||
      typeof p.matchId !== "string" ||
      typeof p.poolCode !== "string" ||
      typeof p.optionKey !== "string"
    ) {
      continue;
    }
    const matchId = p.matchId.trim();
    const poolCode = p.poolCode.trim().toUpperCase();
    const optionKey = p.optionKey.trim();
    if (!matchId || !poolCode || !optionKey) continue;
    const validLegSource =
      typeof p.legSource === "string" &&
      VALID_AUDITED_LEG_SOURCES.has(p.legSource)
        ? p.legSource
        : undefined;
    const sig = `${matchId}\0${poolCode}\0${optionKey}`;
    const existingIdx = indexBySig.get(sig);
    if (existingIdx !== undefined) {
      if (validLegSource && !out[existingIdx].legSource) {
        out[existingIdx] = { ...out[existingIdx], legSource: validLegSource };
      }
      continue;
    }
    if (out.length >= maxLen) continue;
    const cleaned = {
      ...p,
      matchId,
      poolCode,
      optionKey,
    };
    if (validLegSource) {
      cleaned.legSource = validLegSource;
    } else if ("legSource" in cleaned) {
      delete cleaned.legSource;
    }
    indexBySig.set(sig, out.length);
    out.push(cleaned);
  }
  return out;
}

const HAFU_KEYS_BY_FT = {
  h: ["hh", "dh", "ah"],
  d: ["dd", "hd", "ad"],
  a: ["aa", "da", "ha"],
};

export function formatSyntheticBlindSpotPct(prob) {
  const pct = Math.max(0, Number(prob || 0)) * 100;
  if (pct <= 0) return "0.0";
  if (pct >= 0.1) return pct.toFixed(1);
  if (pct >= 0.01) return pct.toFixed(2);
  return "<0.01";
}

function computeSyntheticUncoveredStats(
  targetMask,
  atomicProbs,
  chosenPicks,
  gl
) {
  const coveredMask = new Uint8Array(ATOMIC_TEMPLATES.length);
  for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
    const tpl = ATOMIC_TEMPLATES[t];
    if (
      chosenPicks.some((p) =>
        doesOptionHitAtomicTemplate(
          p.poolCode,
          p.optionKey,
          p.optionLabel,
          gl,
          tpl
        )
      )
    ) {
      coveredMask[t] = 1;
    }
  }
  let uncoveredProb = 0;
  const missedCrsLabels = new Set();
  const missedCatchAllScores = [];
  for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
    if (targetMask[t] && !coveredMask[t]) {
      uncoveredProb += atomicProbs[t] || 0;
      const tpl = ATOMIC_TEMPLATES[t];
      if (tpl.crsKey) missedCrsLabels.add(tpl.crsKey);
      const exactLbl = `${tpl.homeGoals}:${tpl.awayGoals}`;
      if (
        !CRS_INDEX_BY_KEY.has(exactLbl) &&
        !missedCatchAllScores.includes(exactLbl)
      ) {
        missedCatchAllScores.push(exactLbl);
      }
    }
  }
  return {
    uncoveredProb: uncoveredProb <= 1e-12 ? 0 : uncoveredProb,
    coveredMask,
    missedCrsLabels: Array.from(missedCrsLabels),
    missedCatchAllScores,
  };
}

function candidateToBundleObject(m, matchPicks, best, mode = "full-3way") {
  const fullPicks = best.fullPicks;
  let activePicks = fullPicks;
  let modeUsed = mode === "partial-cover" ? "partial-cover" : "full-3way";
  let activeEq = best;
  let customBlindSpotLabel = null;

  if (mode === "trim-2way") {
    const hafuPicks = fullPicks.filter((p) => p.poolCode === "HAFU");
    const otherPicks = fullPicks.filter((p) => p.poolCode !== "HAFU");
    if (hafuPicks.length >= 3) {
      const ftIncluded = ["h", "d", "a"].filter((ftKey) =>
        hafuPicks.some((p) => HAFU_KEYS_BY_FT[ftKey].includes(p.optionKey))
      );
      const droppedPicks = [];
      const keptHafu = [];
      for (const ftKey of ftIncluded) {
        const grp = hafuPicks.filter((p) =>
          HAFU_KEYS_BY_FT[ftKey].includes(p.optionKey)
        );
        if (ftKey === "h") {
          for (const p of grp) {
            if (p.optionKey === "ah") droppedPicks.push(p);
            else keptHafu.push(p);
          }
        } else if (ftKey === "a") {
          for (const p of grp) {
            if (p.optionKey === "ha") droppedPicks.push(p);
            else keptHafu.push(p);
          }
        } else {
          const leadDraws = grp
            .filter((p) => p.optionKey !== "dd")
            .sort((a, b) => a.fairProb - b.fairProb);
          const dropDraw = leadDraws[0];
          for (const p of grp) {
            if (dropDraw && p.optionKey === dropDraw.optionKey) {
              droppedPicks.push(p);
            } else {
              keptHafu.push(p);
            }
          }
        }
      }
      let keptOther = otherPicks;
      if (otherPicks.length >= 3) {
        const sortedOther = [...otherPicks].sort(
          (a, b) => b.fairProb - a.fairProb
        );
        const keepCount = Math.max(2, otherPicks.length - 1);
        const keepKeys = new Set(
          sortedOther
            .slice(0, keepCount)
            .map((p) => `${p.poolCode}:${p.optionKey}`)
        );
        for (const op of otherPicks) {
          if (!keepKeys.has(`${op.poolCode}:${op.optionKey}`)) {
            droppedPicks.push(op);
          }
        }
        keptOther = otherPicks.filter((op) =>
          keepKeys.has(`${op.poolCode}:${op.optionKey}`)
        );
      }
      const keptPicks = [...keptHafu, ...keptOther];
      if (keptPicks.length >= 2 && droppedPicks.length > 0) {
        activePicks = keptPicks;
        modeUsed = "trim-2way";
        activeEq = evaluatePickSetEquivalence(
          m,
          matchPicks,
          activePicks,
          best.atomicProbs
        );
        customBlindSpotLabel = droppedPicks
          .map((p) =>
            p.poolCode === "HAFU" && p.optionKey === "ah"
              ? `半场落后逆转（${p.optionLabel}）`
              : p.poolCode === "HAFU" && p.optionKey === "ha"
                ? `半场领先被逆转（${p.optionLabel}）`
                : p.poolCode === "HAFU"
                  ? `半场分胜负下半场扳平（${p.optionLabel}）`
                  : `长尾比分（${p.optionLabel}）`
          )
          .join("、");
      }
    } else if (fullPicks.length >= 3) {
      const sortedByProb = [...fullPicks].sort(
        (a, b) => b.fairProb - a.fairProb
      );
      const keepCount = Math.min(
        fullPicks.length - 1,
        Math.max(2, Math.ceil(fullPicks.length * 0.65))
      );
      const keepSet = new Set(
        sortedByProb
          .slice(0, keepCount)
          .map((p) => `${p.poolCode}:${p.optionKey}`)
      );
      const dropped = fullPicks.filter(
        (p) => !keepSet.has(`${p.poolCode}:${p.optionKey}`)
      );
      const kept = fullPicks.filter((p) =>
        keepSet.has(`${p.poolCode}:${p.optionKey}`)
      );
      if (kept.length >= 2 && dropped.length > 0) {
        activePicks = kept;
        modeUsed = "trim-2way";
        activeEq = evaluatePickSetEquivalence(
          m,
          matchPicks,
          activePicks,
          best.atomicProbs
        );
      }
    }
  }

  const activePoolCodes = [...new Set(activePicks.map((p) => p.poolCode))];
  const fullPoolCodes = best.poolCodes ?? [
    ...new Set(fullPicks.map((p) => p.poolCode)),
  ];
  const isCrossPoolMixed = activePoolCodes.length > 1;
  const fullIsCrossPoolMixed = fullPoolCodes.length > 1;
  const poolName = isCrossPoolMixed
    ? activePoolCodes.map((c) => m.pools[c]?.name || c).join("+")
    : m.pools[activePoolCodes[0] || best.poolCode]?.name || best.poolCode;
  const fullPoolName =
    best.poolName ??
    (fullIsCrossPoolMixed
      ? fullPoolCodes.map((c) => m.pools[c]?.name || c).join("+")
      : m.pools[best.poolCode]?.name || best.poolCode);

  const invActive = activePicks.reduce(
    (acc, p) => acc + 2 / Math.max(0.5, bankerRoundParlayUnitPayout([p.odds])),
    0
  );
  const synEff =
    modeUsed !== "trim-2way" && best.hasOverlap
      ? best.synEff
      : invActive > 0
        ? 1 / invActive
        : 0;

  return {
    poolCode: activePoolCodes[0] || best.poolCode,
    poolCodes: activePoolCodes,
    fullPoolCodes,
    isCrossPoolMixed,
    fullIsCrossPoolMixed,
    poolName,
    fullPoolName,
    keptLegCount: activePicks.length,
    fullKeptLegCount: fullPicks.length,
    hasOverlap: Boolean(best.hasOverlap),
    fullPicks,
    activePicks,
    modeUsed,
    synEff,
    fullSynEff: best.synEff,
    isExactEquivalent: activeEq.isExactEquivalent,
    fullIsExactEquivalent: best.isExactEquivalent,
    isPureSubset: activeEq.isPureSubset,
    blindSpotProb: activeEq.blindSpotProb,
    fullBlindSpotProb: best.blindSpotProb,
    overCoverProb: activeEq.overCoverProb,
    fullOverCoverProb: best.overCoverProb,
    retainedDirectionRatio: activeEq.retainedDirectionRatio,
    fullRetainedDirectionRatio: best.retainedDirectionRatio,
    withinDirectionMissRatio: activeEq.withinDirectionMissRatio,
    fullWithinDirectionMissRatio: best.withinDirectionMissRatio,
    targetProb: activeEq.targetProb,
    coveredInTargetProb: activeEq.coveredInTargetProb,
    blindSpotLabel: customBlindSpotLabel ?? activeEq.blindSpotLabel,
    fullBlindSpotLabel: best.blindSpotLabel,
    missedScores: activeEq.missedScores,
    fullMissedScores: best.missedScores,
    targetMask: best.targetMask,
    atomicProbs: best.atomicProbs,
    gl: best.gl,
  };
}

export function resolveSyntheticSingleBundle(
  m,
  matchPicks,
  mode = "full-3way",
  atomicOverride = null
) {
  if (!m || !m.pools || !Array.isArray(matchPicks) || matchPicks.length === 0) {
    return null;
  }
  const candidates = resolvePureSingleSubsetPoolCandidates(
    m,
    matchPicks,
    atomicOverride
  );
  if (candidates.length === 0) return null;
  return candidateToBundleObject(m, matchPicks, candidates[0], mode);
}

export function buildAutoSyntheticSinglePlan(
  m,
  bundle,
  rawMultiple,
  rawPickCount,
  options = null
) {
  if (
    !bundle ||
    !Array.isArray(bundle.activePicks) ||
    bundle.activePicks.length === 0
  ) {
    return { playable: false, synEff: bundle?.synEff ?? 0, plan: null };
  }
  const activePicks = bundle.activePicks;
  const K = activePicks.length;
  const singleCap = statutorySingleBetCap(1);
  const rawUnits = activePicks.map((p) =>
    bankerRoundParlayUnitPayout([p.odds])
  );
  const cappedUnits = rawUnits.map((u) => Math.min(singleCap, u));
  const invSum = cappedUnits.reduce((acc, u) => acc + 2 / Math.max(0.5, u), 0);
  const synEff = bundle.hasOverlap
    ? Number(bundle.synEff) || (invSum > 0 ? 1 / invSum : 0)
    : invSum > 0
      ? 1 / invSum
      : 0;

  // Profitability hard gate: synEff <= 1.00 guarantees zero net profit or guaranteed loss!
  if (!(synEff > 1.0 + 1e-9)) {
    return { playable: false, synEff, plan: null };
  }

  const mult = Math.max(1, Math.min(999, Math.round(Number(rawMultiple) || 1)));
  const baseNotes = Math.min(
    10_000,
    Math.max(K, mult * Math.max(1, rawPickCount))
  );
  const maxTotalNotes = Math.min(10_000, 999 * K);
  const rawMaxAutoCost = Number(options?.maxAutoCost) || 0;
  const maxAutoCost =
    rawMaxAutoCost > 0 && rawMaxAutoCost <= 20_000 ? rawMaxAutoCost : 0;
  const maxAutoNotes = maxAutoCost > 0 ? Math.floor(maxAutoCost / 2) : 0;
  const rawStrictMaxCost = Number(options?.strictMaxCost) || 0;
  const strictMaxCost =
    rawStrictMaxCost > 0 && rawStrictMaxCost <= 20_000 ? rawStrictMaxCost : 0;

  let bestAlloc = null;
  let minFeasibleAlloc = null;

  if (bundle.hasOverlap) {
    const gl = bundle.gl ?? resolveGoalLineNum(m);
    const stateBuckets = [];
    for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
      const tpl = ATOMIC_TEMPLATES[t];
      const row = new Float64Array(K);
      let any = false;
      for (let j = 0; j < K; j++) {
        const p = activePicks[j];
        if (
          doesOptionHitAtomicTemplate(
            p.poolCode,
            p.optionKey,
            p.optionLabel,
            gl,
            tpl
          )
        ) {
          row[j] = Math.round(cappedUnits[j] * 100);
          any = true;
        }
      }
      if (any) stateBuckets.push(row);
    }
    const certRes = certifyAndSolveJointBreakeven(stateBuckets, K, baseNotes, {
      timeBudgetMs: 8,
      maxScanNotes: maxTotalNotes,
    });
    const chosenMults =
      certRes.feasibleMultsAtCurrent ??
      certRes.nextFeasibleMults ??
      certRes.minFeasibleMults;
    const minMults = certRes.minFeasibleMults ?? chosenMults;
    if (chosenMults && minMults) {
      const evalOverlapAlloc = (mVec) => {
        const notes = mVec.reduce((a, b) => a + b, 0);
        const totalCost = notes * 2;
        let minP = Infinity;
        let maxP = -Infinity;
        for (let s = 0; s < stateBuckets.length; s++) {
          let payC = 0;
          for (let j = 0; j < K; j++) payC += stateBuckets[s][j] * mVec[j];
          const payY = payC / 100;
          if (payY < minP) minP = payY;
          if (payY > maxP) maxP = payY;
        }
        return {
          mults: mVec,
          notes,
          totalCost,
          minPayout: minP === Infinity ? 0 : minP,
          maxPayout: maxP === -Infinity ? 0 : maxP,
        };
      };
      minFeasibleAlloc = evalOverlapAlloc(minMults);
      bestAlloc = evalOverlapAlloc(chosenMults);
      if (
        maxAutoCost > 0 &&
        bestAlloc.totalCost > maxAutoCost &&
        minFeasibleAlloc.totalCost <= maxAutoCost
      ) {
        bestAlloc = minFeasibleAlloc;
      }
    }
  } else {
    const dutchItems = activePicks.map((p, idx) => ({
      unitPayout: cappedUnits[idx],
      prob: p.fairProb,
      isCapClipped: rawUnits[idx] > singleCap,
    }));

    let lastFeasibleBeforeBase = null;
    let lastFeasibleWithinAutoCap = null;
    for (let N = K; N <= maxTotalNotes; N++) {
      const cand = allocateInverseOddsDutching(dutchItems, N, {
        requireStrictNetGain: true,
      });
      if (!cand) continue;
      if (!minFeasibleAlloc) minFeasibleAlloc = cand;
      if (maxAutoNotes > 0 && N <= maxAutoNotes) {
        lastFeasibleWithinAutoCap = cand;
      }
      if (N >= baseNotes) {
        bestAlloc = cand;
        break;
      }
      lastFeasibleBeforeBase = cand;
    }
    if (!bestAlloc) {
      bestAlloc = lastFeasibleBeforeBase ?? minFeasibleAlloc;
    }
    if (
      maxAutoCost > 0 &&
      bestAlloc &&
      bestAlloc.totalCost > maxAutoCost &&
      lastFeasibleWithinAutoCap
    ) {
      bestAlloc = lastFeasibleWithinAutoCap;
    }
  }

  if (!bestAlloc || !minFeasibleAlloc) {
    return { playable: false, synEff, plan: null };
  }
  if (strictMaxCost > 0 && bestAlloc.totalCost > strictMaxCost + 1e-6) {
    return {
      playable: false,
      overApprovedCap: true,
      requiredMinCost: minFeasibleAlloc.totalCost,
      synEff,
      plan: null,
    };
  }

  const {
    mults,
    totalCost: actualCost,
    minPayout: minPay,
    maxPayout: maxPay,
  } = bestAlloc;
  const lines = activePicks.map((p, idx) => {
    const lineMult = mults[idx];
    const unit = cappedUnits[idx];
    const rawBeforeCap = rawUnits[idx];
    const cappedClipped = Math.max(
      0,
      Number(((rawBeforeCap - unit) * lineMult).toFixed(2))
    );
    const returnPayout = Number((unit * lineMult).toFixed(2));
    return {
      id: `syn-${bundle.modeUsed}-${p.poolCode}-${p.optionKey}`,
      roleLabel: `合成配平#${idx + 1}`,
      legs: [
        {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          kickoff: m.kickoff ?? "21:00",
          poolCode: p.poolCode,
          poolName: p.poolName,
          ...(p.poolCode === "HHAD" ? { goalLine: m.pools.HHAD.goalLine } : {}),
          optionKey: p.optionKey,
          optionLabel: p.optionLabel,
          odds: p.odds,
          fairProb: p.fairProb,
        },
      ],
      modeLabel: "单关",
      multiple: lineMult,
      cost: lineMult * 2,
      unitPayout: unit,
      cappedClipped,
      returnPayout,
      netProfit: Number((returnPayout - actualCost).toFixed(2)),
      prob: p.fairProb,
    };
  });

  const exactBlindSpotProb = Number(bundle.blindSpotProb ?? 0);
  const hasBlindSpot =
    bundle.isExactEquivalent === false || exactBlindSpotProb > 1e-9;
  const bsPctStr = formatSyntheticBlindSpotPct(exactBlindSpotProb);
  const isTrim2 = bundle.modeUsed === "trim-2way";
  const shortTab = isTrim2
    ? `合成单关·${K}项省本`
    : hasBlindSpot
      ? `合成单关·${K}项配平`
      : "合成单关·无死角";
  const badge = isTrim2
    ? `⚡ 合成单关（${K}项省本搏常规）`
    : hasBlindSpot
      ? `🛡️ 合成单关（${K}项覆盖配平）`
      : `🛡️ 合成单关（${K}项全包无死角配平）`;
  const synWinProb = Math.min(
    1,
    Number(
      bundle.coveredInTargetProb ??
        activePicks.reduce((a, p) => a + p.fairProb, 0)
    )
  );
  const isUncondSynFloor =
    actualCost > 0 &&
    Math.max(0, 1 - synWinProb) <= 1e-12 &&
    minPay >= actualCost - 1e-6;
  const physicalSlips = consolidateTerminalPhysicalSlips(lines);
  const outPlan = {
    key: "max-profit-prob",
    available: true,
    shortTab,
    badge,
    title: isTrim2
      ? `精简保留 ${K} 项核心分支 · 抬升常规命中返奖乘数`
      : hasBlindSpot
        ? "覆盖目标方向纯子集 · 反比例整数配平 0 假中奖"
        : "100% 等价覆盖原方向 · 反比例整数配平 0 假中奖",
    tagline: `总投入 ¥${actualCost} · 等效@${synEff.toFixed(2)} · ${
      isUncondSynFloor ? "保底返" : "命中返"
    } ¥${minPay.toFixed(1)} ~ 最高 ¥${maxPay.toFixed(1)}`,
    totalCost: actualCost,
    savedCash: 0,
    stakeUnitsCount: Math.round(actualCost / 2),
    minReturn: minPay,
    maxReturn: maxPay,
    winProb: synWinProb,
    profitProb: synWinProb,
    strictNetGainProb: lines
      .filter((l) => l.returnPayout > actualCost + 1e-6)
      .reduce((a, l) => a + l.prob, 0),
    breakEvenProb: lines
      .filter((l) => Math.abs(l.returnPayout - actualCost) <= 1e-6)
      .reduce((a, l) => a + l.prob, 0),
    expectedValueRate:
      actualCost > 0
        ? lines.reduce((a, l) => a + l.prob * l.returnPayout, 0) / actualCost -
          1
        : 0,
    underwaterCount: 0,
    logicalGroupCount: lines.length,
    physicalTicketCount: physicalSlips.length,
    physicalSlips,
    breakevenUpgradeCost: null,
    consolidateTickets: false,
    missOneReturn: null,
    vigPct: 0,
    reasons: [
      isTrim2 && bundle.blindSpotLabel
        ? `保留 ${K} 项核心分支、省去「${bundle.blindSpotLabel}」（${formatPairedSubsetCoverage(bundle.retainedDirectionRatio, exactBlindSpotProb)}），合成等效水位提升至 @${synEff.toFixed(2)}`
        : hasBlindSpot
          ? `跨池/单池精选 ${K} 项纯子集（${bundle.poolName || bundle.poolCode}）反比例精密配平（等效水位 @${synEff.toFixed(2)}）；诚实披露：未含${bundle.blindSpotLabel || "跨界其它比分"}（${formatPairedSubsetCoverage(bundle.retainedDirectionRatio, exactBlindSpotProb)}）`
          : `100% 等价覆盖原选赛果（${K} 项 · 0% 漏网死角），按水位反比例精密配平整数倍，等效水位 @${synEff.toFixed(2)}`,
    ],
    lines,
  };
  attachLazyConsolidatedLines(outPlan, lines, false);
  TRUSTED_SERVER_BONUS_PLANS.add(outPlan);
  return {
    playable: true,
    synEff,
    minBalancedCost: minFeasibleAlloc.totalCost,
    plan: outPlan,
  };
}

export function canonicalSyntheticLinesSig(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return lines
    .map((ln) => {
      const mult = Math.max(1, Math.round(Number(ln?.multiple) || 1));
      const legSig = (Array.isArray(ln?.legs) ? ln.legs : [])
        .map(
          (lg) =>
            `${String(lg?.poolCode || "").toUpperCase()}:${String(
              lg?.optionKey || ""
            )}@${(Number(lg?.odds) || 0).toFixed(2)}`
        )
        .sort()
        .join("+");
      return `${legSig}×${mult}`;
    })
    .sort()
    .join(";");
}

function normalizeSyntheticGrantLineSig(rawSig) {
  const s = String(rawSig || "").trim();
  if (!s || !s.includes("@")) return s;
  return s
    .split(";")
    .map((part) => {
      const m = /^(.*?)[×x*](\d+)$/.exec(part.trim());
      const body = m ? m[1] : part.trim();
      const mult = m ? Math.max(1, Number(m[2]) || 1) : 1;
      const normLegs = body
        .split("+")
        .filter(Boolean)
        .map((tok) => {
          const atIdx = tok.lastIndexOf("@");
          if (atIdx < 0) return tok;
          const head = tok.slice(0, atIdx);
          const oddNum = Number(tok.slice(atIdx + 1));
          const colonIdx = head.indexOf(":");
          const normHead =
            colonIdx >= 0
              ? `${head.slice(0, colonIdx).toUpperCase()}:${head.slice(colonIdx + 1)}`
              : head;
          return `${normHead}@${(Number.isFinite(oddNum) ? oddNum : 0).toFixed(2)}`;
        })
        .sort()
        .join("+");
      return `${normLegs}×${mult}`;
    })
    .filter(Boolean)
    .sort()
    .join(";");
}

function buildCoveredMaskSigFromLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return "";
  return lines
    .map((ln) =>
      (Array.isArray(ln?.legs) ? ln.legs : [])
        .map((lg) => `${lg.poolCode}:${lg.optionKey}`)
        .sort()
        .join("+")
    )
    .sort()
    .join(";");
}

function computeServerSingleMatchQuoteVersionSig(match) {
  const poolOrder = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  const quoteParts = [orderedMatchKey(match ?? {})];
  for (let i = 0; i < poolOrder.length; i++) {
    const code = poolOrder[i];
    const pool = match?.pools?.[code];
    const validOpts =
      pool && pool.selling !== false && Array.isArray(pool.options)
        ? pool.options.filter(
            (o) => Number.isFinite(Number(o.odds)) && Number(o.odds) > 1
          )
        : [];
    if (validOpts.length === 0) {
      quoteParts.push(`${code}:-`);
      continue;
    }
    const gl = code === "HHAD" ? String(pool?.goalLine ?? "").trim() : "";
    const sFlag = `${pool?.single ? 1 : 0},${pool?.canSingle === false ? 0 : 1},${pool?.canAllUp === false ? 0 : 1}`;
    const optsSig = validOpts
      .map((o) => `${String(o.key)}:${Number(o.odds).toFixed(4)}`)
      .sort()
      .join(",");
    quoteParts.push(`${code}[${gl};${sFlag}](${optsSig})`);
  }
  return quoteParts.join("|");
}

function formatPairedSubsetCoverage(retainedRatioRaw, blindSpotProbRaw) {
  const retRatio = Math.max(0, Math.min(1, Number(retainedRatioRaw) || 0));
  const condMissRatio = Math.max(0, 1 - retRatio);
  const retPct = (retRatio * 100).toFixed(1);
  const condMissPct = (condMissRatio * 100).toFixed(1);
  const globalPct = formatSyntheticBlindSpotPct(blindSpotProbRaw);
  return `同向保 ${retPct}% · 同向漏 ${condMissPct}%（占全场 ${globalPct}%）`;
}

function buildPartialPreviewFromBundle(
  singleMatch,
  bundle,
  builtPlanRes,
  authCap,
  matchPicks = null,
  multiple = 1,
  atomicOverride = null
) {
  const previewPlan = builtPlanRes.plan;
  const poolName =
    bundle.fullPoolName ||
    singleMatch.pools[bundle.poolCode]?.name ||
    bundle.poolCode;
  const requiresConfirm =
    !bundle.fullIsExactEquivalent || previewPlan.totalCost > authCap;
  const confirmReason = !requiresConfirm
    ? undefined
    : !bundle.fullIsExactEquivalent && previewPlan.totalCost > authCap
      ? "partial-and-over-cap"
      : !bundle.fullIsExactEquivalent
        ? "partial-subset"
        : "over-budget-cap";

  let trimFields = {};
  if (Array.isArray(matchPicks) && matchPicks.length > 0) {
    const trimBundle = resolveSyntheticSingleBundle(
      singleMatch,
      matchPicks,
      "trim-2way",
      atomicOverride
    );
    if (trimBundle && trimBundle.modeUsed === "trim-2way") {
      const trimBuilt = buildAutoSyntheticSinglePlan(
        singleMatch,
        trimBundle,
        multiple,
        matchPicks.length
      );
      if (trimBuilt.playable && trimBuilt.plan) {
        trimFields = {
          trim2WayLegCount: trimBundle.activePicks.length,
          trim2WayCost: trimBuilt.plan.totalCost,
          trim2WayRetainedDirectionRatio: Number(
            (trimBundle.retainedDirectionRatio ?? 0).toFixed(8)
          ),
          trim2WayWithinDirectionMissRatio: Number(
            (trimBundle.withinDirectionMissRatio ?? 0).toFixed(8)
          ),
          trim2WayBlindSpotProb: Number(
            (trimBundle.blindSpotProb ?? 0).toFixed(8)
          ),
          trim2WayBlindSpotLabel: trimBundle.blindSpotLabel ?? null,
          trim2WayLines: trimBuilt.plan.lines,
          trim2WayLineAndMultipleSig: canonicalSyntheticLinesSig(
            trimBuilt.plan.lines
          ),
        };
      }
    }
  }

  return {
    poolCode: bundle.poolCode,
    poolName,
    poolCodes: bundle.fullPoolCodes ?? [bundle.poolCode],
    isCrossPoolMixed: Boolean(bundle.fullIsCrossPoolMixed),
    keptLegCount: bundle.fullPicks.length,
    isExactEquivalent: Boolean(bundle.fullIsExactEquivalent),
    requiresExplicitConfirm: requiresConfirm,
    ...(confirmReason ? { confirmReason } : {}),
    authorizedCostCap: authCap,
    retainedDirectionRatio: Number(
      (bundle.fullRetainedDirectionRatio ?? 0).toFixed(8)
    ),
    withinDirectionMissRatio: Number(
      (bundle.fullWithinDirectionMissRatio ?? 0).toFixed(8)
    ),
    blindSpotProb: bundle.fullIsExactEquivalent
      ? 0
      : Number((bundle.fullBlindSpotProb ?? 0).toFixed(8)),
    overCoverProb: Number((bundle.fullOverCoverProb ?? 0).toFixed(8)),
    blindSpotLabel: bundle.fullBlindSpotLabel ?? null,
    syntheticEffectiveOdds: Number(builtPlanRes.synEff.toFixed(4)),
    previewCost: previewPlan.totalCost,
    previewBetCount: previewPlan.lines.reduce((s, l) => s + l.multiple, 0),
    previewTicketCount: previewPlan.lines.length,
    previewMinPayout: previewPlan.minReturn,
    previewMaxPayout: previewPlan.maxReturn,
    previewLines: previewPlan.lines,
    lineAndMultipleSig: canonicalSyntheticLinesSig(previewPlan.lines),
    ...trimFields,
  };
}

export function buildSingleMatchAlternatives(
  singleMatch,
  matchPicks,
  multiple = 1,
  atomicOverride = null
) {
  if (!singleMatch || !singleMatch.pools) {
    return { singlePoolAlternatives: [], crossPoolSingleAlternatives: [] };
  }
  const singlePoolAlternatives = [];
  for (const poolCode of ["HAD", "HHAD", "TTG", "HAFU", "CRS"]) {
    const pool = singleMatch.pools[poolCode];
    if (!isPoolSingleEligible(pool)) continue;
    const odds = pool.options
      .map((o) => Number(o.odds))
      .filter((x) => Number.isFinite(x) && x > 0);
    if (odds.length === 0) continue;
    singlePoolAlternatives.push({
      poolCode,
      poolName: pool.name || poolCode,
      optionCount: odds.length,
      minOdds: Math.min(...odds),
      maxOdds: Math.max(...odds),
    });
  }

  const crossPoolSingleAlternatives = [];
  if (Array.isArray(matchPicks) && matchPicks.length > 0) {
    const authCap = Math.max(12, matchPicks.length * 2 * Math.max(1, multiple));
    const cands = resolvePureSingleSubsetPoolCandidates(
      singleMatch,
      matchPicks,
      atomicOverride
    );
    for (
      let i = 0;
      i < cands.length && crossPoolSingleAlternatives.length < 4;
      i++
    ) {
      const bObj = candidateToBundleObject(
        singleMatch,
        matchPicks,
        cands[i],
        "partial-cover"
      );
      const built = buildAutoSyntheticSinglePlan(
        singleMatch,
        bObj,
        multiple,
        matchPicks.length
      );
      if (built.playable && built.plan) {
        crossPoolSingleAlternatives.push(
          buildPartialPreviewFromBundle(
            singleMatch,
            bObj,
            built,
            authCap,
            matchPicks,
            multiple,
            atomicOverride
          )
        );
      }
    }
  }
  return { singlePoolAlternatives, crossPoolSingleAlternatives };
}

function attachSyntheticUnplayableWarning(manualReport, unplayableEffRaw) {
  const unplayableEff = Number((unplayableEffRaw || 0).toFixed(4));
  manualReport.syntheticEffectiveOdds = unplayableEff;
  manualReport.selectionStatus = "rule-blocked";
  manualReport.distributionStatus = "none";
  if (!manualReport.warnings.some((w) => w.id === "synthetic-unplayable")) {
    manualReport.ruleBlockReason = `该方向借道单关池合成等效水位仅 ${unplayableEff.toFixed(2)}（≤ 1.00 或受整数倍限制无法盈利），已诚实拦截废票，请搭 1 场过桥配菜场凑 2串1`;
    manualReport.warnings = [
      {
        id: "synthetic-unplayable",
        severity: "danger",
        title: `合成等效水位 ${unplayableEff.toFixed(2)} 无法盈利（已诚实拦截亏本单关）`,
        detail:
          "本场热门水位极低，借道半全场/比分单关池分倍后无法实现正净利；强烈建议选用下方「🌉 过桥配菜场凑 2串1」！",
      },
    ];
  }
}

export function orchestrateSingleMatchSynthetic({
  singleMatch,
  matchPicks,
  matches,
  picks,
  multiple,
  syntheticSingleMode,
  singleAuthGrant = undefined,
  simVoidFirstMatch,
  voidMatchIds = [],
  subjectiveDeltaPct,
  hasSubjectiveShift,
  sandboxAtomicMap,
  stance,
  manualReport,
}) {
  if (!singleMatch || !Array.isArray(matchPicks) || matchPicks.length === 0) {
    return { appliedPlan: null, autoSyntheticMeta: null };
  }
  const { singlePoolAlternatives, crossPoolSingleAlternatives } =
    buildSingleMatchAlternatives(singleMatch, matchPicks, multiple);
  manualReport.singlePoolAlternatives = singlePoolAlternatives;
  manualReport.crossPoolSingleAlternatives = crossPoolSingleAlternatives;

  const fullBundle = resolveSyntheticSingleBundle(
    singleMatch,
    matchPicks,
    "partial-cover"
  );
  if (!fullBundle) {
    return { appliedPlan: null, autoSyntheticMeta: null };
  }
  const fullBuilt = buildAutoSyntheticSinglePlan(
    singleMatch,
    fullBundle,
    multiple,
    matchPicks.length
  );
  if (!fullBuilt.playable || !fullBuilt.plan) {
    attachSyntheticUnplayableWarning(
      manualReport,
      fullBuilt.synEff || fullBundle.synEff || 0
    );
    return { appliedPlan: null, autoSyntheticMeta: null };
  }

  const authCap = Math.max(12, matchPicks.length * 2 * multiple);
  const minBalancedCost = Number(
    fullBuilt.minBalancedCost ?? fullBuilt.plan.totalCost
  );
  const requiresConfirm =
    !fullBundle.fullIsExactEquivalent || minBalancedCost > authCap;
  const poolName =
    fullBundle.fullPoolName ||
    singleMatch.pools[fullBundle.poolCode]?.name ||
    fullBundle.poolCode;

  let partialCoveragePreview = buildPartialPreviewFromBundle(
    singleMatch,
    fullBundle,
    fullBuilt,
    authCap,
    matchPicks,
    multiple
  );
  if (requiresConfirm) {
    manualReport.partialCoveragePreview = partialCoveragePreview;
  } else if (partialCoveragePreview.trim2WayLines) {
    manualReport.trim2WayPreview = partialCoveragePreview;
  }

  if (syntheticSingleMode === "off") {
    manualReport.selectionStatus = "pending-single-auth";
    manualReport.distributionStatus = "none";
    return { appliedPlan: null, autoSyntheticMeta: null };
  }

  if (syntheticSingleMode === "full-3way" && requiresConfirm) {
    manualReport.syntheticAutoMounted = false;
    manualReport.syntheticModeUsed = "full-3way";
    manualReport.selectionStatus = "pending-single-auth";
    manualReport.distributionStatus = "none";
    manualReport.modeLabel = "未开单关·待配";
    if (!fullBundle.fullIsExactEquivalent) {
      const pairedText = formatPairedSubsetCoverage(
        partialCoveragePreview.retainedDirectionRatio,
        partialCoveragePreview.blindSpotProb
      );
      manualReport.ruleBlockReason = `该方向无 100% 等价单关（纯子集${poolName} ${pairedText} · 配平 ¥${partialCoveragePreview.previewCost}，未确认前暂不满足合法出票条件），请确认部分覆盖或搭 1 场凑 2串1`;
    } else {
      manualReport.ruleBlockReason = `该方向等价${poolName}单关最少需 ¥${partialCoveragePreview.previewCost}（超出默认单场授权上限 ¥${authCap}，未确认前暂不满足合法出票条件），请确认超额配平或搭 1 场凑 2串1`;
    }
    return { appliedPlan: null, autoSyntheticMeta: null };
  }

  const rejectStaleGrant = (reason) => {
    partialCoveragePreview.requiresExplicitConfirm = true;
    manualReport.partialCoveragePreview = partialCoveragePreview;
    manualReport.syntheticAutoMounted = false;
    manualReport.selectionStatus = "pending-single-auth";
    manualReport.distributionStatus = "none";
    manualReport.modeLabel = "未开单关·待配";
    manualReport.ruleBlockReason = reason;
    return {
      appliedPlan: null,
      autoSyntheticMeta: null,
      quoteRejectedReason: reason,
    };
  };

  let grantStrictMaxCost = 0;
  if (singleAuthGrant !== undefined && singleAuthGrant !== null) {
    const rawApproved = Number(
      singleAuthGrant.exactCost ?? singleAuthGrant.approvedCost
    );
    if (
      singleAuthGrant.matchId !== singleMatch.id ||
      singleAuthGrant.mode !== syntheticSingleMode ||
      !(Number.isFinite(rawApproved) && rawApproved > 0)
    ) {
      return rejectStaleGrant(
        `单场合成授权与当前场次（${singleMatch.matchNumStr}）或模式不匹配，请重新确认后再出票`
      );
    }
    if (rawApproved <= 20_000) {
      grantStrictMaxCost = rawApproved;
    }
  }

  const objBundle =
    syntheticSingleMode === "partial-cover"
      ? fullBundle
      : resolveSyntheticSingleBundle(
          singleMatch,
          matchPicks,
          syntheticSingleMode
        );
  if (!objBundle) {
    return { appliedPlan: null, autoSyntheticMeta: null };
  }
  const builtSyn =
    syntheticSingleMode === "partial-cover" && !(grantStrictMaxCost > 0)
      ? fullBuilt
      : buildAutoSyntheticSinglePlan(
          singleMatch,
          objBundle,
          multiple,
          matchPicks.length,
          grantStrictMaxCost > 0
            ? {
                maxAutoCost: grantStrictMaxCost,
                strictMaxCost: grantStrictMaxCost,
              }
            : syntheticSingleMode === "full-3way"
              ? { maxAutoCost: authCap }
              : null
        );
  if (builtSyn.overApprovedCap) {
    const freshPreview = buildPartialPreviewFromBundle(
      singleMatch,
      fullBundle,
      fullBuilt,
      grantStrictMaxCost || authCap,
      matchPicks,
      multiple
    );
    freshPreview.requiresExplicitConfirm = true;
    freshPreview.confirmReason = "over-budget-cap";
    manualReport.partialCoveragePreview = freshPreview;
    manualReport.selectionStatus = "pending-single-auth";
    manualReport.distributionStatus = "none";
    manualReport.modeLabel = "未开单关·待配";
    manualReport.ruleBlockReason = `盘面赔率更新后配平最少需 ¥${builtSyn.requiredMinCost ?? freshPreview.previewCost}（超出已授权金额 ¥${grantStrictMaxCost}），请重新确认授权金额`;
    return { appliedPlan: null, autoSyntheticMeta: null };
  }
  if (!builtSyn.playable || !builtSyn.plan) {
    attachSyntheticUnplayableWarning(
      manualReport,
      builtSyn.synEff || objBundle.synEff || 0
    );
    return { appliedPlan: null, autoSyntheticMeta: null };
  }

  // Enforce full tamper-proof `singleAuthGrant` verification against built candidate lines & live match quote (`ADR-0019`)
  if (singleAuthGrant !== undefined && singleAuthGrant !== null) {
    const expectedPicksSig = matchPicks
      .map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`)
      .sort()
      .join("|");
    const hhadGl = String(singleMatch.pools?.HHAD?.goalLine ?? "").trim();
    const pickedHasHhad = matchPicks.some((p) => p.poolCode === "HHAD");
    const expectedGoalLine = pickedHasHhad ? hhadGl : "";

    const modeMatches =
      singleAuthGrant.mode === syntheticSingleMode &&
      singleAuthGrant.mode === objBundle.modeUsed;
    const picksMatches =
      singleAuthGrant.picksSig === undefined ||
      String(singleAuthGrant.picksSig) === expectedPicksSig;
    const goalLineMatches = (() => {
      if (singleAuthGrant.goalLine === undefined) return true;
      const gGl = String(singleAuthGrant.goalLine ?? "").trim();
      if (pickedHasHhad) return gGl === expectedGoalLine;
      return gGl === "" || gGl === hhadGl;
    })();
    const candidateTotalCost = builtSyn.plan.totalCost;
    const costMatches =
      singleAuthGrant.exactCost !== undefined &&
      singleAuthGrant.exactCost !== null
        ? Number(singleAuthGrant.exactCost) === candidateTotalCost
        : Number(singleAuthGrant.approvedCost) === candidateTotalCost;

    const liveMatchQuoteSig =
      computeServerSingleMatchQuoteVersionSig(singleMatch);
    const quoteVersionMatches =
      !singleAuthGrant.quoteVersionSig ||
      String(singleAuthGrant.quoteVersionSig) === liveMatchQuoteSig;

    const candidateCanonicalSig = canonicalSyntheticLinesSig(
      builtSyn.plan.lines
    );
    const rawLineSig = String(singleAuthGrant.lineAndMultipleSig ?? "").trim();
    const lineSigMatches = (() => {
      if (!rawLineSig) return false;
      if (rawLineSig.includes("@")) {
        return (
          normalizeSyntheticGrantLineSig(rawLineSig) === candidateCanonicalSig
        );
      }
      if (rawLineSig.startsWith("m=")) {
        const expectedLegacyMask = `m=${Math.max(1, Math.round(Number(multiple) || 1))}|${buildCoveredMaskSigFromLines(builtSyn.plan.lines)}`;
        return (
          rawLineSig === expectedLegacyMask &&
          Boolean(singleAuthGrant.quoteVersionSig) &&
          quoteVersionMatches
        );
      }
      return false;
    })();

    if (
      !modeMatches ||
      !picksMatches ||
      !goalLineMatches ||
      !costMatches ||
      !quoteVersionMatches ||
      !lineSigMatches
    ) {
      return rejectStaleGrant(
        `盘面赔率、让球线或分倍报价已变更（${singleMatch.matchNumStr}），原单关授权已失效，请重新确认最新 ¥${candidateTotalCost} 报价后再出票`
      );
    }
  }

  const appliedPlan = applySandboxToPlan(
    builtSyn.plan,
    matches,
    picks,
    simVoidFirstMatch,
    subjectiveDeltaPct,
    {
      isArchetype: false,
      consolidateTickets: true,
      stance,
      manualReport,
      voidMatchIds,
    }
  );
  const shiftedBundle = hasSubjectiveShift
    ? resolveSyntheticSingleBundle(
        singleMatch,
        matchPicks,
        syntheticSingleMode,
        sandboxAtomicMap ?? null
      )
    : objBundle;
  const rawSynBlindSpotProb =
    shiftedBundle?.blindSpotProb ?? objBundle.blindSpotProb ?? 0;
  const activeIsExact = Boolean(
    shiftedBundle?.isExactEquivalent ?? objBundle.isExactEquivalent
  );
  const autoSyntheticMeta = {
    modeUsed: objBundle.modeUsed,
    synEff: Number(builtSyn.synEff.toFixed(4)),
    isExactEquivalent: activeIsExact,
    overCoverProb: Number(
      (shiftedBundle?.overCoverProb ?? objBundle.overCoverProb ?? 0).toFixed(8)
    ),
    retainedDirectionRatio: Number(
      (
        shiftedBundle?.retainedDirectionRatio ??
        objBundle.retainedDirectionRatio ??
        (activeIsExact ? 1 : 0)
      ).toFixed(8)
    ),
    blindSpotProb:
      activeIsExact && rawSynBlindSpotProb <= 1e-9
        ? 0
        : Number(rawSynBlindSpotProb.toFixed(8)),
    blindSpotLabel:
      shiftedBundle?.blindSpotLabel ?? objBundle.blindSpotLabel ?? null,
    poolName:
      objBundle.poolName ||
      singleMatch.pools[objBundle.poolCode]?.name ||
      objBundle.poolCode,
    activeLabels: objBundle.activePicks.map((p) => p.optionLabel),
    keptLegCount: objBundle.activePicks.length,
    matchNumStr: singleMatch.matchNumStr,
    partialCoveragePreview: requiresConfirm ? partialCoveragePreview : null,
    trim2WayPreview:
      !requiresConfirm && partialCoveragePreview.trim2WayLines
        ? partialCoveragePreview
        : null,
  };
  return { appliedPlan, autoSyntheticMeta };
}

export function applyAutoSyntheticReportMeta(
  effectiveReport,
  manualReport,
  autoSyntheticMeta,
  syntheticSingleMode
) {
  if (autoSyntheticMeta && effectiveReport !== manualReport) {
    const keptCount =
      autoSyntheticMeta.keptLegCount ?? autoSyntheticMeta.activeLabels.length;
    const labelStr =
      autoSyntheticMeta.activeLabels.length <= 4
        ? autoSyntheticMeta.activeLabels.join("+")
        : `${autoSyntheticMeta.activeLabels.slice(0, 3).join("+")}等${autoSyntheticMeta.activeLabels.length}项`;
    const hasSynBlindSpot =
      !autoSyntheticMeta.isExactEquivalent ||
      autoSyntheticMeta.blindSpotProb > 1e-9;
    effectiveReport.modeLabel =
      autoSyntheticMeta.modeUsed === "trim-2way"
        ? `合成单关·${keptCount}项省本`
        : hasSynBlindSpot
          ? `合成单关·${keptCount}项部分覆盖`
          : `合成单关·${keptCount}项无死角`;
    effectiveReport.syntheticAutoMounted = true;
    effectiveReport.syntheticModeUsed = autoSyntheticMeta.modeUsed;
    effectiveReport.syntheticEffectiveOdds = autoSyntheticMeta.synEff;
    effectiveReport.syntheticBlindSpotProb = autoSyntheticMeta.blindSpotProb;
    effectiveReport.syntheticBlindSpotLabel = autoSyntheticMeta.blindSpotLabel;
    effectiveReport.isExactSyntheticEquivalent =
      autoSyntheticMeta.isExactEquivalent;
    effectiveReport.syntheticOverCoverProb = autoSyntheticMeta.overCoverProb;
    effectiveReport.syntheticRetainedDirectionRatio =
      autoSyntheticMeta.retainedDirectionRatio;
    effectiveReport.syntheticRescuePicks = manualReport.syntheticRescuePicks;
    if (manualReport.singlePoolAlternatives) {
      effectiveReport.singlePoolAlternatives =
        manualReport.singlePoolAlternatives;
    }
    if (manualReport.crossPoolSingleAlternatives) {
      effectiveReport.crossPoolSingleAlternatives =
        manualReport.crossPoolSingleAlternatives;
    }
    if (autoSyntheticMeta.partialCoveragePreview) {
      effectiveReport.partialCoveragePreview =
        autoSyntheticMeta.partialCoveragePreview;
    }
    if (autoSyntheticMeta.trim2WayPreview) {
      effectiveReport.trim2WayPreview = autoSyntheticMeta.trim2WayPreview;
    }
    if (hasSynBlindSpot) {
      const bsPct = formatSyntheticBlindSpotPct(
        autoSyntheticMeta.blindSpotProb
      );
      const pairedText = formatPairedSubsetCoverage(
        autoSyntheticMeta.retainedDirectionRatio ?? 0,
        autoSyntheticMeta.blindSpotProb
      );
      const bsDesc = autoSyntheticMeta.blindSpotLabel || "极端长尾比分";
      if (autoSyntheticMeta.modeUsed === "trim-2way") {
        effectiveReport.syntheticHint = `${autoSyntheticMeta.matchNumStr} 已挂载【${keptCount}项省本搏常规】${autoSyntheticMeta.poolName}单关「${labelStr}」（${pairedText} · 等效水位 @${autoSyntheticMeta.synEff.toFixed(2)} · 实投 ¥${effectiveReport.totalCost}）；⚠️ 注意省去了「${bsDesc}」。`;
        effectiveReport.warnings = [
          {
            id: "synthetic-blind-spot",
            severity: "warn",
            title: `⚠️ ${keptCount}项省本模式（${pairedText}）`,
            detail: `当前保留 ${keptCount} 项、省去了「${bsDesc}」（${pairedText}）；若想完整覆盖常规分支，请切回全包档或搭 1 场凑 2串1。`,
          },
          ...effectiveReport.warnings.filter(
            (w) => w.id !== "synthetic-blind-spot"
          ),
        ];
      } else {
        effectiveReport.syntheticHint = `${autoSyntheticMeta.matchNumStr} 已按确认挂载${autoSyntheticMeta.poolName}纯子集单关「${labelStr}」反比例配平（${pairedText} · 等效水位 @${autoSyntheticMeta.synEff.toFixed(2)} · 实投 ¥${effectiveReport.totalCost}）；⚠️ 因体彩「其它」项跨界混含非目标分差已严格剔除，未含${bsDesc}！选满第 2 场将自动恢复原盘串关。`;
        effectiveReport.warnings = [
          {
            id: "synthetic-blind-spot",
            severity: "warn",
            title: `⚠️ 部分覆盖合成单关（${keptCount}项 · ${pairedText}）`,
            detail: `体彩比分池「胜其它/平其它/负其它」同时混杂其他分差，当前纯子集「${labelStr}」未含${bsDesc}（全场发生率 ${bsPct}%）；若需锁定原盘方向零漏网，可搭 1 场过桥配菜凑 2串1。`,
          },
          ...effectiveReport.warnings.filter(
            (w) => w.id !== "synthetic-blind-spot"
          ),
        ];
      }
    } else {
      effectiveReport.syntheticHint = `${autoSyntheticMeta.matchNumStr} 原选玩法未开单关，已挂载 100% 等价无死角${autoSyntheticMeta.poolName}单关「${labelStr}」反比例配平（等效水位 @${autoSyntheticMeta.synEff.toFixed(2)} · 实投 ¥${effectiveReport.totalCost} · 0% 漏网死角）！继续选第 2 场将自动恢复低抽水原盘串关。`;
    }
  } else if (
    syntheticSingleMode === "off" &&
    manualReport.matchCount === 1 &&
    !manualReport.canCheckout
  ) {
    effectiveReport.syntheticModeUsed = "off";
  }
}

function gcdPositiveInt(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y > 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

export function certifyFixedUniformComboBreakeven(
  bucketsCents,
  k,
  totalNotes,
  { zeroPayoutProb = 0, unitMultiplicityVec = null, baseMultiples = null } = {}
) {
  const rawVec =
    Array.isArray(unitMultiplicityVec) && unitMultiplicityVec.length === k
      ? unitMultiplicityVec
      : Array.isArray(baseMultiples) && baseMultiples.length === k
        ? baseMultiples
        : new Array(k).fill(1);
  const cleanRaw = rawVec.map((x) =>
    Math.max(1, Math.min(999, Math.round(Number(x) || 1)))
  );
  let g = cleanRaw[0] ?? 1;
  for (let i = 1; i < cleanRaw.length; i++) g = gcdPositiveInt(g, cleanRaw[i]);
  const v = cleanRaw.map((x) => Math.max(1, Math.round(x / g)));
  const U = v.reduce((acc, vi) => acc + vi, 0);
  const S = Array.isArray(bucketsCents) ? bucketsCents.length : 0;

  let minUnitBundlePayCents = S > 0 ? Infinity : 0;
  for (let s = 0; s < S; s++) {
    const row = bucketsCents[s];
    let acc = 0;
    for (let i = 0; i < k; i++) acc += (Number(row[i]) || 0) * v[i];
    if (acc < minUnitBundlePayCents) minUnitBundlePayCents = acc;
  }
  if (!Number.isFinite(minUnitBundlePayCents)) minUnitBundlePayCents = 0;

  const mCur =
    Number.isInteger(totalNotes) &&
    U >= 1 &&
    totalNotes >= U &&
    totalNotes % U === 0
      ? Math.round(totalNotes / U)
      : null;
  const conditionalFloorAtCurrent =
    mCur !== null && S > 0
      ? Number(((minUnitBundlePayCents * mCur) / 100).toFixed(2))
      : null;
  const maxM =
    U >= 1
      ? Math.min(
          999,
          Math.floor(10_000 / U),
          ...v.map((vi) => Math.floor(999 / vi))
        )
      : 0;

  let minFeasibleBudget = null;
  let isCurrentFeasible = "certified-infeasible";
  let nextFeasibleBudget = null;
  if (S > 0 && U >= 1 && maxM >= 1 && minUnitBundlePayCents >= 200 * U) {
    minFeasibleBudget = 2 * U;
    const currentOk =
      mCur !== null && mCur >= 1 && mCur <= maxM && totalNotes <= 10_000;
    if (currentOk) {
      isCurrentFeasible = "certified-feasible";
      nextFeasibleBudget = null;
    } else {
      const mNext = totalNotes < U ? 1 : Math.floor(totalNotes / U) + 1;
      nextFeasibleBudget =
        mNext >= 1 && mNext <= maxM && mNext * U <= 10_000
          ? 2 * U * mNext
          : null;
      isCurrentFeasible = "certified-infeasible";
    }
  }

  return {
    cert: {
      minFeasibleBudget,
      isCurrentFeasible,
      nextFeasibleBudget,
      proofStatus: "certified",
      conditionalFloorAtCurrent,
      zeroPayoutProb,
    },
    feasibleMultsAtCurrent:
      isCurrentFeasible === "certified-feasible" && mCur !== null
        ? v.map((vi) => vi * mCur)
        : null,
    minFeasibleMults: minFeasibleBudget !== null ? [...v] : null,
    nextFeasibleMults:
      nextFeasibleBudget !== null
        ? v.map((vi) => vi * Math.round(nextFeasibleBudget / (2 * U)))
        : null,
  };
}

export function validateBoundBonusSingleAuthGate({
  planSpec,
  singleAuthGrant,
  picks,
  matches,
}) {
  if (!planSpec || planSpec.kind !== "bonus") {
    return { ok: true };
  }
  if (
    Array.isArray(planSpec.baseLines) &&
    planSpec.baseLines.length > 0 &&
    Array.isArray(matches) &&
    matches.length > 0
  ) {
    const mById = new Map(matches.map((m) => [String(m?.id || ""), m]));
    for (const ln of planSpec.baseLines) {
      const legs = Array.isArray(ln?.legs) ? ln.legs : [];
      if (legs.length === 0) {
        return {
          ok: false,
          reason: "锁定分倍方案包含无效空票行，请重新确认方案",
        };
      }
      const isSingleLine = legs.length === 1;
      const isStrictBound = Boolean(
        planSpec.boundSingleAuthId ||
        planSpec.boundLineAndMultipleSig ||
        planSpec.baseSourceKind === "auto-synthetic"
      );
      for (const lg of legs) {
        const lm = mById.get(String(lg?.matchId || ""));
        if (!lm) {
          if (isStrictBound) {
            return {
              ok: false,
              reason: "锁定分倍方案所涉赛事已下架，请重新核对最新盘口",
            };
          }
          continue;
        }
        const lp = lm.pools?.[lg?.poolCode];
        const lo = lp?.options?.find(
          (o) => String(o.key) === String(lg?.optionKey)
        );
        if (
          !lp ||
          lp.selling === false ||
          !lo ||
          (isSingleLine
            ? !isPoolSingleEligible(lp)
            : !isPoolAllUpEligible(lp)) ||
          (lg?.poolCode === "HHAD" &&
            lg.goalLine !== undefined &&
            String(lp.goalLine ?? "").trim() !==
              String(lg.goalLine ?? "").trim())
        ) {
          return {
            ok: false,
            reason:
              "锁定分倍方案所涉场次单关/串关开售权限或让球线已变更，请重新核对最新盘口",
          };
        }
      }
    }
  }
  if (
    !planSpec.boundSingleAuthId &&
    !planSpec.boundLineAndMultipleSig &&
    planSpec.baseSourceKind !== "auto-synthetic"
  ) {
    return { ok: true };
  }
  const fail = () => ({
    ok: false,
    reason: "单关替代授权已因盘口水位或选项变更失效，请重新确认方案",
  });
  if (
    !singleAuthGrant ||
    typeof singleAuthGrant !== "object" ||
    typeof singleAuthGrant.lineAndMultipleSig !== "string" ||
    singleAuthGrant.lineAndMultipleSig.trim().length === 0
  ) {
    return fail();
  }
  if (
    planSpec.boundSingleAuthId &&
    String(singleAuthGrant.authId || "") !== String(planSpec.boundSingleAuthId)
  ) {
    return fail();
  }
  if (
    planSpec.boundLineAndMultipleSig &&
    String(singleAuthGrant.lineAndMultipleSig) !==
      String(planSpec.boundLineAndMultipleSig)
  ) {
    return fail();
  }
  const cleanPicks = Array.isArray(picks) ? picks : [];
  const distinctMids = Array.from(
    new Set(cleanPicks.map((p) => String(p?.matchId || "")).filter(Boolean))
  );
  if (
    distinctMids.length !== 1 ||
    distinctMids[0] !== String(singleAuthGrant.matchId || "")
  ) {
    return fail();
  }
  const mid = distinctMids[0];
  const fm = Array.isArray(matches)
    ? matches.find((m) => String(m?.id || "") === mid)
    : null;
  if (!fm) return fail();

  const liveHhadGl = String(fm.pools?.HHAD?.goalLine ?? "").trim();
  const hasHhadPick = cleanPicks.some(
    (p) => String(p?.poolCode || "").toUpperCase() === "HHAD"
  );
  if (hasHhadPick) {
    if (
      singleAuthGrant.goalLine !== undefined &&
      String(singleAuthGrant.goalLine ?? "").trim() !== liveHhadGl
    ) {
      return fail();
    }
    for (const pk of cleanPicks) {
      if (
        String(pk?.poolCode || "").toUpperCase() === "HHAD" &&
        pk.goalLine !== undefined &&
        String(pk.goalLine ?? "").trim() !== liveHhadGl
      ) {
        return fail();
      }
    }
  }

  const lineParts = singleAuthGrant.lineAndMultipleSig
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lineParts.length === 0) return fail();
  for (const lp of lineParts) {
    const xIdx = Math.max(lp.lastIndexOf("\u00d7"), lp.lastIndexOf("x"));
    const legsPart = xIdx > 0 ? lp.slice(0, xIdx) : lp;
    const legTokens = legsPart.split("+").filter(Boolean);
    if (legTokens.length === 0) return fail();
    for (const legTok of legTokens) {
      const colIdx = legTok.indexOf(":");
      const atIdx = legTok.indexOf("@");
      if (colIdx <= 0 || atIdx <= colIdx) return fail();
      const poolCode = legTok.slice(0, colIdx).toUpperCase();
      const optKey = legTok.slice(colIdx + 1, atIdx);
      const expectedOddsStr = legTok.slice(atIdx + 1);
      const pool = fm.pools?.[poolCode];
      if (!pool || pool.selling === false || !isPoolSingleEligible(pool)) {
        return fail();
      }
      const opt = pool.options?.find((o) => String(o.key) === optKey);
      const expectedOdds = Number(expectedOddsStr);
      if (
        !opt ||
        !Number.isFinite(expectedOdds) ||
        Math.abs(Number(opt.odds) - expectedOdds) > 1e-6
      ) {
        return fail();
      }
    }
  }

  if (!Array.isArray(planSpec.baseLines) || planSpec.baseLines.length === 0) {
    return fail();
  }
  for (const ln of planSpec.baseLines) {
    const legs = Array.isArray(ln?.legs) ? ln.legs : [];
    if (legs.length === 0) return fail();
    for (const lg of legs) {
      if (String(lg?.matchId || mid) !== mid) return fail();
      const poolCode = String(lg?.poolCode || "").toUpperCase();
      const pool = fm.pools?.[poolCode];
      if (!pool || pool.selling === false || !isPoolSingleEligible(pool)) {
        return fail();
      }
      if (
        poolCode === "HHAD" &&
        lg.goalLine !== undefined &&
        String(lg.goalLine ?? "").trim() !== liveHhadGl
      ) {
        return fail();
      }
      const opt = pool.options?.find(
        (o) => String(o.key) === String(lg?.optionKey)
      );
      if (
        !opt ||
        !(Number(opt.odds) > 0) ||
        (lg.odds !== undefined &&
          Math.abs(Number(opt.odds) - Number(lg.odds)) > 1e-6)
      ) {
        return fail();
      }
    }
  }

  return { ok: true };
}

/** 计算五维真相看板、体彩法定过关矩阵与 6 大防坑雷达（纯数学黑盒，遵循 ADR-0002 & ADR-0007） */
export function computeTruthReport(
  rawPicksInput,
  rawMultiple,
  matches,
  passSpec,
  matchAtomicMap = null,
  options = null
) {
  const multiple = Math.max(
    1,
    Math.min(999, Math.round(Number(rawMultiple) || 1))
  );
  const picks = sanitizeAndDeduplicatePicks(rawPicksInput, 512);

  const byMatch = new Map();
  for (const p of picks) {
    const arr = byMatch.get(p.matchId) ?? [];
    arr.push(p);
    byMatch.set(p.matchId, arr);
  }

  const matchGroups = Array.from(byMatch.values());
  const matchCount = matchGroups.length;

  if (matchCount === 0) {
    return buildBlockedTruthReport({
      matchCount: 0,
      multiple,
      modeLabel: "过关选择",
      canSingle: false,
      ruleBlockReason: null,
      poolCap: 8,
      availableFreePasses: buildFreePassMetadata(0, 8, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: false,
      syntheticHint: null,
      syntheticRescuePicks: null,
      warnings: [],
    });
  }

  const matchIdsInOrder = matchGroups.map((grp) => grp[0].matchId);
  const missingBankerIds = Array.isArray(passSpec?.bankerMatchIds)
    ? passSpec.bankerMatchIds.filter(
        (id) =>
          typeof id === "string" &&
          id.trim().length > 0 &&
          !matchIdsInOrder.includes(id.trim())
      )
    : [];
  const hasOrphanedBanker = missingBankerIds.length > 0;
  const orphanedBankerReason =
    "已移除设胆场次，原胆拖约束已失效；请确认解除胆码改用普通自由过关或重新设胆";

  // 校验未开售盘口与异常赔率
  for (const p of picks) {
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === p.matchId)
      : null;
    const pool = fm?.pools?.[p.poolCode];
    if (
      pool &&
      (pool.selling === false ||
        !Array.isArray(pool.options) ||
        pool.options.length === 0)
    ) {
      return buildBlockedTruthReport({
        matchCount,
        multiple,
        modeLabel: "含停售盘口",
        canSingle: false,
        ruleBlockReason: `${fm.matchNumStr || ""}【${pool.name || p.poolCode}】当前未开售或已暂停销售`,
        poolCap: 8,
        availableFreePasses: buildFreePassMetadata(
          matchCount,
          8,
          false,
          false,
          []
        ),
        availableComboPasses: [],
        hasSameMatchCrossPoolConflict: false,
        syntheticHint: null,
        syntheticRescuePicks: null,
        warnings: [],
      });
    }
    if (!(Number(p.odds) > 0)) {
      return buildBlockedTruthReport({
        matchCount,
        multiple,
        modeLabel: "无效赔率",
        canSingle: false,
        ruleBlockReason: "选单包含未开售或无效赔率选项",
        poolCap: 8,
        availableFreePasses: buildFreePassMetadata(
          matchCount,
          8,
          false,
          false,
          []
        ),
        availableComboPasses: [],
        hasSameMatchCrossPoolConflict: false,
        syntheticHint: null,
        syntheticRescuePicks: null,
        warnings: [buildInvalidOddsStatutoryWarning(false)],
      });
    }
  }

  let hasSameMatchCrossPoolConflict = false;
  let hasIllegalCrossPoolPair = false;
  for (const grp of matchGroups) {
    const pools = Array.from(new Set(grp.map((g) => g.poolCode)));
    if (pools.length > 1) {
      hasSameMatchCrossPoolConflict = true;
      if (pools.some((c) => c !== "HAD" && c !== "HHAD")) {
        hasIllegalCrossPoolPair = true;
      }
    }
  }

  const isPickSingleAllowed = (pk) => {
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === pk.matchId)
      : null;
    const pool = fm?.pools?.[pk.poolCode];
    if (pool) {
      if (!isPoolSingleEligible(pool)) return false;
      if (pk.singleAllowed === false && pk.canSingle === undefined)
        return false;
      return true;
    }
    return Boolean(pk.canSingle ?? pk.singleAllowed);
  };
  const isPickAllUpAllowed = (pk) => {
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === pk.matchId)
      : null;
    const pool = fm?.pools?.[pk.poolCode];
    if (pool) {
      return isPoolAllUpEligible(pool) && pk.canAllUp !== false;
    }
    return pk.canAllUp !== false;
  };
  const isAllSingle = picks.length > 0 && picks.every(isPickSingleAllowed);
  const hasSingleOnlyPick = picks.some((pk) => !isPickAllUpAllowed(pk));
  const canSingle = matchCount === 1 && isAllSingle && !hasIllegalCrossPoolPair;
  const poolCap = Math.min(...picks.map((p) => POOL_MAX_PASS[p.poolCode] ?? 8));

  let syntheticHint = null;
  let syntheticRescuePicks = null;
  let syntheticEffectiveOdds = undefined;
  let syntheticBlindSpotProb = undefined;
  let syntheticBlindSpotLabel = undefined;
  let isExactSyntheticEquivalent = undefined;
  let syntheticOverCoverProb = undefined;
  let syntheticRetainedDirectionRatio = undefined;
  if (matchCount === 1 && !hasSameMatchCrossPoolConflict) {
    const m = Array.isArray(matches)
      ? matches.find((x) => x.id === matchGroups[0][0].matchId)
      : null;
    if (m && !canSingle) {
      const bundle = resolveSyntheticSingleBundle(
        m,
        matchGroups[0],
        "full-3way",
        matchAtomicMap?.get(m.id) ?? null
      );
      if (bundle && bundle.fullPicks.length >= 1) {
        const synEff = bundle.fullSynEff ?? bundle.synEff;
        syntheticEffectiveOdds = Number(synEff.toFixed(4));
        syntheticRescuePicks = bundle.fullPicks;
        const fullBsProb = Number(
          bundle.fullBlindSpotProb ?? bundle.blindSpotProb ?? 0
        );
        const fullOverProb = Number(
          bundle.fullOverCoverProb ?? bundle.overCoverProb ?? 0
        );
        const fullIsExact = Boolean(
          bundle.fullIsExactEquivalent ?? bundle.isExactEquivalent
        );
        const fullRetained = Number(
          bundle.fullRetainedDirectionRatio ??
            bundle.retainedDirectionRatio ??
            (fullIsExact ? 1 : 0)
        );
        isExactSyntheticEquivalent = fullIsExact;
        syntheticBlindSpotProb =
          fullIsExact && fullBsProb <= 1e-9 ? 0 : Number(fullBsProb.toFixed(8));
        syntheticOverCoverProb =
          fullOverProb <= 1e-12 ? 0 : Number(fullOverProb.toFixed(8));
        syntheticRetainedDirectionRatio = Number(fullRetained.toFixed(8));
        syntheticBlindSpotLabel =
          bundle.fullBlindSpotLabel ?? bundle.blindSpotLabel ?? null;
        const labelList =
          bundle.fullPicks.length <= 4
            ? bundle.fullPicks.map((p) => p.optionLabel).join("+")
            : `${bundle.fullPicks
                .slice(0, 3)
                .map((p) => p.optionLabel)
                .join("+")}等${bundle.fullPicks.length}项`;
        const poolTitle = m.pools[bundle.poolCode]?.name || bundle.poolCode;
        syntheticHint =
          synEff > 1.0 + 1e-9
            ? !fullIsExact || fullBsProb > 1e-9
              ? `${m.matchNumStr} 当前所选玩法未开单关；可借道${poolTitle}单关纯子集「${labelList}」反比例配平（${formatPairedSubsetCoverage(fullRetained, fullBsProb)} · 等效水位 @${synEff.toFixed(2)}；⚠️ 未含${syntheticBlindSpotLabel || "跨界其它比分"}），确认后可单场出票或加选第 2 场凑串！`
              : `${m.matchNumStr} 当前所选玩法未开单关；借道${poolTitle}单关全包「${labelList}」反比例配平后合成等效水位达 ${synEff.toFixed(2)}（0% 漏网死角），支持直接单场出票或加选第 2 场凑串！`
            : `${m.matchNumStr} 当前所选玩法未开单关，且借道${poolTitle}覆盖「${labelList}」合成等效水位仅 ${synEff.toFixed(2)}（≤ 1.00 必亏盘），已拦截单场亏本废票，强烈建议搭 1 场过桥配菜场凑 2串1！`;
      }
    }
  }

  if (
    hasIllegalCrossPoolPair ||
    (hasSameMatchCrossPoolConflict && !isAllSingle)
  ) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: "同场跨玩法禁串",
      canSingle: false,
      ruleBlockReason:
        "同一场比赛不能同时选择多种玩法进行串关，请取消同场跨玩法选项",
      poolCap,
      availableFreePasses: buildFreePassMetadata(
        matchCount,
        poolCap,
        false,
        false,
        []
      ),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: true,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "cross-pool-same-match",
          severity: "danger",
          title: "同场跨玩法违规（体彩严禁同一场不同玩法互串）",
          detail:
            "你在同一场比赛勾选了两种不同玩法且不满足双单关条件，体彩终端无法出票；请只保留一种玩法。",
        },
      ],
    });
  }

  if (matchCount > 15) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: "超15场上限",
      canSingle: false,
      ruleBlockReason: "中国体彩单次选单最多不超过 15 场赛事",
      poolCap,
      availableFreePasses: buildFreePassMetadata(
        matchCount,
        poolCap,
        false,
        false,
        []
      ),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "over-15-matches",
          severity: "danger",
          title: "超出 15 场单次选单上限",
          detail: "请精简场次至 15 场以内（串关最多 8 场）。",
        },
      ],
    });
  }

  if (matchCount > 8 && !isAllSingle) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: "超8场串关上限",
      canSingle: false,
      ruleBlockReason: "中国体彩串关最多不能超过 8 场赛事",
      poolCap,
      availableFreePasses: buildFreePassMetadata(
        matchCount,
        poolCap,
        false,
        false,
        []
      ),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "over-8-matches",
          severity: "danger",
          title: "超出 8 场串关法定上限",
          detail: "竞彩足球串关最多允许选择 8 场比赛，请精简场次后再计算。",
        },
      ],
    });
  }

  if (matchCount === 1 && !canSingle) {
    const singleMatchObj = Array.isArray(matches)
      ? matches.find((x) => x.id === matchGroups[0][0].matchId)
      : null;
    const isUnplayableSyn =
      syntheticEffectiveOdds !== undefined &&
      syntheticEffectiveOdds <= 1.0 + 1e-9;
    const altMeta = singleMatchObj
      ? buildSingleMatchAlternatives(
          singleMatchObj,
          matchGroups[0],
          multiple,
          matchAtomicMap?.get(singleMatchObj.id) ?? null
        )
      : { singlePoolAlternatives: [], crossPoolSingleAlternatives: [] };
    const blockedOne = buildBlockedTruthReport({
      matchCount: 1,
      multiple,
      modeLabel: "还差1场凑2串1",
      canSingle: false,
      selectionStatus:
        hasOrphanedBanker || isUnplayableSyn
          ? "rule-blocked"
          : "pending-single-auth",
      distributionStatus: "none",
      singlePoolAlternatives: altMeta.singlePoolAlternatives,
      crossPoolSingleAlternatives: altMeta.crossPoolSingleAlternatives,
      ruleBlockReason: hasOrphanedBanker
        ? orphanedBankerReason
        : isUnplayableSyn
          ? `该方向借道单关池合成等效水位仅 ${syntheticEffectiveOdds.toFixed(2)}（≤ 1.00 必亏盘），已拦截亏本单关，请搭 1 场过桥配菜场凑 2串1`
          : "该玩法未开放单关，需再选至少 1 场比赛凑 2串1，或改选半全场/比分/总进球单关",
      poolCap,
      availableFreePasses: buildFreePassMetadata(1, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: false,
      syntheticHint,
      syntheticRescuePicks,
      warnings: isUnplayableSyn
        ? [
            {
              id: "synthetic-unplayable",
              severity: "danger",
              title: `合成等效水位 ${syntheticEffectiveOdds.toFixed(2)} ≤ 1.00（必亏废票已诚实阻断）`,
              detail:
                "本场热门水位极低，叠加半全场/比分单关池抽水后无论踢出哪个分支均倒亏本金；请直接选用下方「🌉 过桥配菜场凑 2串1」！",
            },
          ]
        : [
            {
              id: "no-single",
              severity: "warn",
              title: "该玩法未开单关（当前无法单独出票，需再选 1 场）",
              detail:
                "体彩本场胜平负/让球未开放单关，需再串 1 场或直接改用「半全场 / 比分 / 总进球」合成单关。",
            },
          ],
    });
    if (syntheticEffectiveOdds !== undefined) {
      blockedOne.syntheticEffectiveOdds = syntheticEffectiveOdds;
    }
    if (syntheticBlindSpotProb !== undefined) {
      blockedOne.syntheticBlindSpotProb = syntheticBlindSpotProb;
    }
    if (syntheticBlindSpotLabel !== undefined) {
      blockedOne.syntheticBlindSpotLabel = syntheticBlindSpotLabel;
    }
    if (isExactSyntheticEquivalent !== undefined) {
      blockedOne.isExactSyntheticEquivalent = isExactSyntheticEquivalent;
    }
    if (syntheticOverCoverProb !== undefined) {
      blockedOne.syntheticOverCoverProb = syntheticOverCoverProb;
    }
    if (syntheticRetainedDirectionRatio !== undefined) {
      blockedOne.syntheticRetainedDirectionRatio =
        syntheticRetainedDirectionRatio;
    }
    return blockedOne;
  }

  const forceSingleOnly = hasSameMatchCrossPoolConflict || matchCount > 8;
  const effectiveMaxPass = forceSingleOnly ? 1 : Math.min(matchCount, poolCap);
  const exactMTupleCount = matchGroups.reduce(
    (acc, grp) => Math.min(Number.MAX_SAFE_INTEGER, acc * grp.length),
    1
  );

  if (matchCount >= 2 && hasSingleOnlyPick && !forceSingleOnly) {
    const explicitSingleOnlyReq =
      isAllSingle &&
      passSpec?.mode === "free" &&
      Array.isArray(passSpec.passSizes) &&
      passSpec.passSizes.length > 0 &&
      passSpec.passSizes.every((x) => Number(x) === 1);
    if (!explicitSingleOnlyReq) {
      return buildBlockedTruthReport({
        matchCount,
        multiple,
        modeLabel: "含仅单关禁串玩法",
        canSingle: false,
        ruleBlockReason: isAllSingle
          ? "所选含仅单关专售玩法（禁止参与2关及以上串关），请切为【单关】或改选可过关玩法"
          : "所选同时包含仅单关专售玩法与未开单关玩法，既无法串关也无法全单关出票",
        poolCap,
        availableFreePasses: buildFreePassMetadata(
          matchCount,
          poolCap,
          isAllSingle,
          false,
          [],
          true
        ),
        availableComboPasses: buildComboPassMetadata(
          matchCount,
          poolCap,
          false,
          null,
          exactMTupleCount,
          true
        ),
        hasSameMatchCrossPoolConflict,
        syntheticHint,
        syntheticRescuePicks,
        warnings: [
          {
            id: "single-only-no-parlay",
            severity: "danger",
            title: "所选包含仅单关专售玩法（禁止参与2关及以上过关）",
            detail: isAllSingle
              ? "体彩该玩法当前仅开放单关销售、未开放串关过关；请在过关选择中切为【单关】独立出票，或改选支持过关的玩法。"
              : "同一选单内混有仅单关专售玩法与仅串关玩法，无法生成合法实票；请移除冲突项。",
          },
        ],
      });
    }
  }

  let activePassSizes = [];
  let activeComboCode = null;
  let modeLabel = "";

  if (forceSingleOnly || matchCount === 1) {
    activePassSizes = [1];
    modeLabel = "单关";
  } else if (
    !hasSingleOnlyPick &&
    passSpec?.mode === "combo" &&
    passSpec.comboCode
  ) {
    const presets = OFFICIAL_COMBO_PASS_TABLE[matchCount] ?? [];
    const matched = presets.find(
      (pr) =>
        pr.code === passSpec.comboCode &&
        pr.sizes.every((s) => s <= effectiveMaxPass)
    );
    if (matched) {
      activePassSizes = [...matched.sizes];
      activeComboCode = matched.code;
      modeLabel = matched.label;
    }
  } else if (passSpec?.mode === "free" && Array.isArray(passSpec.passSizes)) {
    const valid = Array.from(new Set(passSpec.passSizes.map((x) => Number(x))))
      .filter((k) =>
        k === 1
          ? isAllSingle
          : !hasSingleOnlyPick && k >= 2 && k <= effectiveMaxPass
      )
      .sort((a, b) => a - b);
    if (valid.length > 0) {
      activePassSizes = valid;
      modeLabel = valid.map((k) => (k === 1 ? "单关" : `${k}串1`)).join("+");
    }
  }

  if (activePassSizes.length === 0) {
    activePassSizes = [effectiveMaxPass];
    modeLabel = effectiveMaxPass === 1 ? "单关" : `${effectiveMaxPass}串1`;
  }

  let bankerMatchIds = [];
  if (
    matchCount >= 3 &&
    !forceSingleOnly &&
    !activeComboCode &&
    Array.isArray(passSpec?.bankerMatchIds) &&
    passSpec.bankerMatchIds.length > 0
  ) {
    const minActivePass = Math.min(...activePassSizes);
    const maxBankers =
      minActivePass >= 2 ? Math.min(matchCount - 1, minActivePass - 1) : 0;
    if (maxBankers > 0) {
      const requestedSet = new Set(
        passSpec.bankerMatchIds
          .slice(0, 16)
          .filter((id) => typeof id === "string")
      );
      bankerMatchIds = matchIdsInOrder
        .filter((id) => requestedSet.has(id))
        .slice(0, maxBankers);
    }
  }
  if (bankerMatchIds.length > 0) {
    modeLabel = `${modeLabel}(${bankerMatchIds.length}胆)`;
  }

  const availableFreePasses = buildFreePassMetadata(
    matchCount,
    poolCap,
    isAllSingle,
    forceSingleOnly,
    activeComboCode ? [] : activePassSizes,
    hasSingleOnlyPick
  );
  const availableComboPasses = buildComboPassMetadata(
    matchCount,
    poolCap,
    forceSingleOnly,
    activeComboCode,
    exactMTupleCount,
    hasSingleOnlyPick
  );

  // Exact O(M^2) combinatorial pre-count before ticket expansion: zero silent truncation
  let totalRawBetCount = 0;
  if (activeComboCode) {
    let baseSubsets = 0;
    for (const k of activePassSizes) {
      baseSubsets += combinationsOfIndices(matchCount, k).length;
    }
    totalRawBetCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      exactMTupleCount * baseSubsets
    );
  } else if (forceSingleOnly && hasSameMatchCrossPoolConflict) {
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      totalRawBetCount += matchGroups[mIdx].length;
    }
  } else if (bankerMatchIds.length > 0) {
    const bankerSet = new Set(bankerMatchIds);
    let bankerTupleCount = 1;
    const trailerSizes = [];
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      const sz = matchGroups[mIdx].length;
      if (bankerSet.has(matchIdsInOrder[mIdx])) {
        bankerTupleCount = Math.min(
          Number.MAX_SAFE_INTEGER,
          bankerTupleCount * sz
        );
      } else {
        trailerSizes.push(sz);
      }
    }
    const tLen = trailerSizes.length;
    const elemSymTrailer = new Float64Array(tLen + 1);
    elemSymTrailer[0] = 1;
    for (let tIdx = 0; tIdx < tLen; tIdx++) {
      const sz = trailerSizes[tIdx];
      for (let k = tIdx + 1; k >= 1; k--) {
        elemSymTrailer[k] += elemSymTrailer[k - 1] * sz;
      }
    }
    const bCount = bankerMatchIds.length;
    for (const k of activePassSizes) {
      const needTrailer = k - bCount;
      if (needTrailer >= 0 && needTrailer <= tLen) {
        totalRawBetCount += Math.round(
          bankerTupleCount * (elemSymTrailer[needTrailer] ?? 0)
        );
      }
    }
  } else {
    const elemSym = new Float64Array(matchCount + 1);
    elemSym[0] = 1;
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      const sz = matchGroups[mIdx].length;
      for (let k = mIdx + 1; k >= 1; k--) {
        elemSym[k] += elemSym[k - 1] * sz;
      }
    }
    for (const k of activePassSizes) {
      totalRawBetCount += Math.round(elemSym[k] ?? 0);
    }
  }

  const MAX_EXACT_SLIP_BETS = 2048;
  if (totalRawBetCount > MAX_EXACT_SLIP_BETS) {
    const trueTotalCost = totalRawBetCount * 2 * multiple;
    const over20k = trueTotalCost > 20_000;
    const blockWarnings = [
      {
        id: "over-2048-bets",
        severity: "danger",
        title: `🚨 复式组合爆炸拦截：当前共 ${totalRawBetCount} 注（超出实时精算 2,048 注上限）`,
        detail:
          "大面积全包复式不仅触发指数级连乘抽水雪崩，也超出单次实时穷举上限。系统严禁静默砍单，请精简低概率包号、下调过关阶数，或直接使用【3+1精算配单】智能缩水。",
      },
    ];
    if (over20k) {
      blockWarnings.push({
        id: "order-limit-20k",
        severity: "danger",
        title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${trueTotalCost}）`,
        detail:
          "中国体彩规定单次订单投注金额不得超过 20,000 元，请精简包号或分批打票。",
      });
    }
    return buildBlockedTruthReport({
      matchCount,
      betCount: totalRawBetCount,
      totalCost: trueTotalCost,
      estimatedOverCapCost: trueTotalCost,
      multiple,
      modeLabel,
      canSingle,
      selectionStatus: "rule-blocked",
      distributionStatus: "uncomputed-over-cap",
      basicExpandedCount: totalRawBetCount,
      logicalLineCount: 0,
      stakeUnitsCount: totalRawBetCount * multiple,
      ruleBlockReason: over20k
        ? `当前复式共 ${totalRawBetCount} 注（总金额 ¥${trueTotalCost}），超出单次 2,048（${MAX_EXACT_SLIP_BETS}）注及体彩 ¥20,000 硬上限，请精简包号`
        : `当前复式共 ${totalRawBetCount} 注（总金额 ¥${trueTotalCost}），超出实时精算 2,048（${MAX_EXACT_SLIP_BETS}）注上限，请精简包号或改用【3+1精算配单】`,
      poolCap,
      activePassSizes,
      activeComboCode,
      bankerMatchIds,
      availableFreePasses,
      availableComboPasses,
      hasSameMatchCrossPoolConflict,
      dangerScore: 96,
      syntheticHint,
      syntheticRescuePicks,
      warnings: blockWarnings,
    });
  }

  const rawTickets = [];
  const comboMTupleRecords = [];
  if (activeComboCode) {
    // 官方 M串N 多串过关复式规则：先对 M 场比赛取单场各1项笛卡尔积（共 exactMTupleCount 组 M串N 票），再逐组展开子串关
    let mTuples = [[]];
    for (const grp of matchGroups) {
      const next = [];
      for (const prev of mTuples) {
        for (const item of grp) {
          next.push([...prev, item]);
        }
      }
      mTuples = next;
    }
    for (let tIdx = 0; tIdx < mTuples.length; tIdx++) {
      const tuple = mTuples[tIdx];
      const startIdx = rawTickets.length;
      for (const k of activePassSizes) {
        const indexSubsets = combinationsOfIndices(matchCount, k);
        for (const subset of indexSubsets) {
          rawTickets.push({
            legs: subset.map((i) => tuple[i]),
            matchIndices: subset,
          });
        }
      }
      const subTicketIds = [];
      for (let q = startIdx; q < rawTickets.length; q++) {
        subTicketIds.push(`tk-${q + 1}`);
      }
      comboMTupleRecords.push({
        id: `combo-${activeComboCode}-${tIdx + 1}`,
        tuple,
        sourceBasicLineIds: subTicketIds,
      });
    }
  } else if (forceSingleOnly && hasSameMatchCrossPoolConflict) {
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      for (const p of matchGroups[mIdx]) {
        rawTickets.push({ legs: [p], matchIndices: [mIdx] });
      }
    }
  } else {
    const bankerSet =
      bankerMatchIds.length > 0 ? new Set(bankerMatchIds) : null;
    const bankerIndices = bankerSet
      ? matchIdsInOrder
          .map((id, idx) => (bankerSet.has(id) ? idx : -1))
          .filter((idx) => idx >= 0)
      : [];
    const trailerIndices = bankerSet
      ? matchIdsInOrder
          .map((id, idx) => (!bankerSet.has(id) ? idx : -1))
          .filter((idx) => idx >= 0)
      : [];
    for (const k of activePassSizes) {
      if (k === 1) {
        for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
          for (const p of matchGroups[mIdx]) {
            rawTickets.push({ legs: [p], matchIndices: [mIdx] });
          }
        }
      } else {
        const indexSubsets = bankerSet
          ? combinationsOfIndices(
              trailerIndices.length,
              k - bankerIndices.length
            ).map((tSub) =>
              [...bankerIndices, ...tSub.map((ti) => trailerIndices[ti])].sort(
                (a, b) => a - b
              )
            )
          : combinationsOfIndices(matchCount, k);
        for (const subset of indexSubsets) {
          let tupleCartesian = [[]];
          for (const mIdx of subset) {
            const next = [];
            for (const prev of tupleCartesian) {
              for (const item of matchGroups[mIdx]) {
                next.push([...prev, item]);
              }
            }
            tupleCartesian = next;
          }
          for (const legs of tupleCartesian) {
            rawTickets.push({ legs, matchIndices: subset });
          }
        }
      }
    }
  }

  const betCount = rawTickets.length;
  const totalCost = betCount * 2 * multiple;
  const voidMatchSet =
    options?.voidMatchSet instanceof Set && options.voidMatchSet.size > 0
      ? options.voidMatchSet
      : null;
  const bankerSetForSlip =
    bankerMatchIds.length > 0 ? new Set(bankerMatchIds) : null;
  const matchKickoffMap = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      if (matches[i]?.id) matchKickoffMap.set(matches[i].id, matches[i]);
    }
  }

  const pickDescByRef = new Map();
  for (let i = 0; i < picks.length; i++) {
    const pk = picks[i];
    pickDescByRef.set(
      pk,
      `${pk.matchNumStr}[${pk.optionLabel}@${pk.odds.toFixed(2)}]`
    );
  }
  const ticketRows = rawTickets.map((t, idx) => {
    const lgs = t.legs;
    let prob = 1;
    for (let j = 0; j < lgs.length; j++) {
      const it = lgs[j];
      const isVoidLeg =
        it.isVoid === true ||
        Boolean(voidMatchSet && voidMatchSet.has(String(it.matchId)));
      if (!isVoidLeg) prob *= it.fairProb;
    }
    const stPay = computeLineStatutoryPayout(lgs, multiple, voidMatchSet);
    const unitCapped = stPay.unitPayout;
    const cappedClipped = stPay.cappedClipped;
    const totalPayout = stPay.returnPayout;
    const netProfit = Math.round((totalPayout - totalCost) * 100) / 100;
    const desc =
      lgs.length === 2
        ? `${pickDescByRef.get(lgs[0])} × ${pickDescByRef.get(lgs[1])}`
        : lgs.length === 1
          ? pickDescByRef.get(lgs[0])
          : lgs.map((i) => pickDescByRef.get(i)).join(" × ");
    const matchPairKey = lgs.map((g) => g.matchId).join("__");
    const matchPairLabel =
      lgs.length === 1
        ? `单关 · ${lgs[0].matchNumStr}`
        : lgs.map((g) => g.matchNumStr).join(" × ");
    return {
      id: `tk-${idx}`,
      ticketNo: idx + 1,
      desc,
      legs: lgs,
      matchIndices: t.matchIndices,
      multiple,
      cost: multiple * 2,
      stakeCost: multiple * 2,
      matchPairKey,
      matchPairLabel,
      prob,
      unitPayout: unitCapped,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater: netProfit < 0,
      returnMultiple:
        totalCost > 0 ? Number((totalPayout / totalCost).toFixed(4)) : 0,
    };
  });

  const precomputedObjRep =
    !voidMatchSet && options?.precomputedObjectiveEval
      ? options.precomputedObjectiveEval
      : null;
  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRows,
    totalCost,
    matches,
    matchAtomicMap,
    options
      ? {
          captureHitMatrix: true,
          reusableHitMatrix: precomputedObjRep?._reusableHitMatrix ?? null,
          ...options,
        }
      : { captureHitMatrix: true }
  );
  const { combos, minPayout, maxPayout, underwaterCount } = jointEval;
  const comboCount = combos.length;
  const hasSubjectiveShift = Boolean(options?.hasSubjectiveShift);
  const objEvalForManual =
    hasSubjectiveShift && options?.precomputedObjectiveEval
      ? options.precomputedObjectiveEval
      : hasSubjectiveShift && options?.objectiveAtomicMap
        ? evaluateTicketsOnQuotientSpace(
            ticketRows,
            totalCost,
            matches,
            options.objectiveAtomicMap,
            {
              metricsOnly: true,
              voidMatchSet,
              reusableHitMatrix: !voidMatchSet
                ? (options?.objectiveHitMatrix ?? null)
                : null,
            }
          )
        : jointEval;

  const { avgPayoutRatio, vigPct: avgVigLossPer100 } =
    computeCapitalWeightedVig(ticketRows, matches);

  const invTicketOddsSum = ticketRows.reduce(
    (acc, c) => acc + 2 / Math.max(0.01, c.unitPayout),
    0
  );
  const effectiveOdds = invTicketOddsSum > 0 ? 1 / invTicketOddsSum : 0;

  let breakevenCert = precomputedObjRep?.breakevenCert ?? null;
  let breakevenUpgradeCost = precomputedObjRep?.breakevenUpgradeCost ?? null;
  if (!precomputedObjRep && ticketRows.length > 0 && ticketRows.length <= 512) {
    const K = ticketRows.length;
    const hm = objEvalForManual.hitMatrix ?? jointEval.hitMatrix ?? null;
    const bucketsCents = [];
    if (hm && Array.isArray(hm.bucketHits) && hm.bucketHits.length > 0) {
      for (let b = 0; b < hm.bucketHits.length; b++) {
        const hits = hm.bucketHits[b];
        const row = new Float64Array(K);
        for (let j = 0; j < hits.length; j++) {
          const kIdx = hits[j];
          row[kIdx] = Math.round(ticketRows[kIdx].unitPayout * 100);
        }
        bucketsCents.push(row);
      }
    } else {
      for (let i = 0; i < K; i++) {
        const row = new Float64Array(K);
        row[i] = Math.round(ticketRows[i].unitPayout * 100);
        bucketsCents.push(row);
      }
    }
    const certZeroProb =
      objEvalForManual.zeroPayoutProb ?? jointEval.zeroPayoutProb ?? 0;
    const certBaseMults = ticketRows.map((t) => t.multiple);
    const certRes = activeComboCode
      ? certifyFixedUniformComboBreakeven(
          bucketsCents,
          K,
          betCount * multiple,
          {
            zeroPayoutProb: certZeroProb,
            baseMultiples: certBaseMults,
          }
        )
      : certifyAndSolveJointBreakeven(bucketsCents, K, betCount * multiple, {
          timeBudgetMs: 12,
          maxScanNotes: 10_000,
          zeroPayoutProb: certZeroProb,
          baseMultiples: certBaseMults,
        });
    breakevenCert = certRes.cert;
    if (
      underwaterCount > 0 &&
      breakevenCert.isCurrentFeasible !== "certified-feasible" &&
      typeof breakevenCert.nextFeasibleBudget === "number"
    ) {
      breakevenUpgradeCost = certRes.cert.nextFeasibleBudget;
    }
  }

  const physicalSlips = Array.isArray(precomputedObjRep?.physicalSlips)
    ? precomputedObjRep.physicalSlips
    : consolidateTerminalPhysicalSlips(
        activeComboCode
          ? comboMTupleRecords.map((rec) => ({
              id: rec.id,
              comboCode: activeComboCode,
              modeLabel,
              passSizes: activePassSizes,
              multiple,
              sourceBasicLineIds: rec.sourceBasicLineIds,
              legs: rec.tuple.map((it) => {
                const fm = matchKickoffMap.get(it.matchId);
                return {
                  matchId: it.matchId,
                  matchNumStr: it.matchNumStr,
                  home: it.home,
                  away: it.away,
                  kickoff: fm?.kickoff ?? "21:00",
                  poolCode: it.poolCode,
                  poolName: it.poolName,
                  goalLine: fm?.pools?.[it.poolCode]?.goalLine,
                  optionKey: it.optionKey,
                  optionLabel: it.optionLabel,
                  odds: it.odds,
                  isBanker: false,
                };
              }),
            }))
          : ticketRows.map((tk) => ({
              id: tk.id,
              modeLabel:
                tk.legs.length === 1
                  ? "单关"
                  : `${tk.legs.length}串1${bankerSetForSlip ? `(${bankerMatchIds.length}胆)` : ""}`,
              passSizes: [tk.legs.length],
              multiple: tk.multiple,
              legs: tk.legs.map((it) => {
                const fm = matchKickoffMap.get(it.matchId);
                return {
                  matchId: it.matchId,
                  matchNumStr: it.matchNumStr,
                  home: it.home,
                  away: it.away,
                  kickoff: fm?.kickoff ?? "21:00",
                  poolCode: it.poolCode,
                  poolName: it.poolName,
                  goalLine: fm?.pools?.[it.poolCode]?.goalLine,
                  optionKey: it.optionKey,
                  optionLabel: it.optionLabel,
                  odds: it.odds,
                  isBanker: bankerSetForSlip
                    ? bankerSetForSlip.has(it.matchId)
                    : false,
                };
              }),
            }))
      );
  const consolidatedTickets = physicalSlips.length;

  const overOrder20k = totalCost > 20_000;
  const { dangerScore, warnings } = computeUnifiedSlipDangerAndWarnings({
    tickets: ticketRows,
    totalCost,
    minPayout,
    maxPayout,
    comboCount,
    underwaterCount,
    breakevenUpgradeCost,
    effectiveOdds,
    matchCount,
    poolCap,
    forceSingleOnly,
    activePassSizes,
    hasSameMatchCrossPoolConflict,
    avgPayoutRatio,
    avgVigLossPer100,
    objEval: objEvalForManual,
    hasInvalidOdds: false,
    physicalSlipCount: physicalSlips.length,
  });

  const outReport = assembleEvaluatedTruthReport({
    matchCount,
    betCount,
    betCountUnit: "logical-lines",
    comboCount,
    multiple,
    modeLabel,
    canSingle,
    canCheckout: !overOrder20k && !hasOrphanedBanker,
    ruleBlockReason: hasOrphanedBanker
      ? orphanedBankerReason
      : overOrder20k
        ? `单次订单金额 ¥${totalCost} 超出体彩 ¥20,000 硬上限，请调低倍数或分单`
        : null,
    selectionStatus:
      hasOrphanedBanker || overOrder20k ? "rule-blocked" : "ready",
    distributionStatus: "computed",
    basicExpandedCount: betCount,
    logicalLineCount: betCount,
    stakeUnitsCount: betCount * multiple,
    physicalSlips,
    breakevenCert,
    poolCap,
    activePassSizes,
    activeComboCode,
    bankerMatchIds,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    totalCost,
    jointEval,
    objEval: objEvalForManual,
    hasSubjectiveShift,
    avgPayoutRatio,
    avgVigLossPer100,
    dangerScore,
    effectiveOdds,
    breakevenUpgradeCost,
    consolidatedTickets,
    syntheticHint,
    syntheticRescuePicks,
    tickets: ticketRows,
    warnings,
  });
  if (jointEval.hitMatrix) {
    Object.defineProperty(outReport, "_reusableHitMatrix", {
      value: jointEval.hitMatrix,
      enumerable: false,
      configurable: true,
    });
  }
  return outReport;
}

function parseRawHhMm(hhmm) {
  const [hStr, mStr] = String(hhmm || "20:00").split(":");
  const h = Math.max(0, Math.min(23, Number(hStr) || 0));
  const min = Math.max(0, Math.min(59, Number(mStr) || 0));
  return { h, min };
}

function parseKickoffMinutes(hhmm) {
  const { h, min } = parseRawHhMm(hhmm);
  const normalizedH = h < 12 ? h + 24 : h;
  return normalizedH * 60 + min;
}

function parseMatchDatePrefixMinutes(matchId) {
  const m =
    /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[-_]\d+|\d{3})?$/.exec(
      String(matchId || "")
    );
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dy = Number(m[3]);
  const ts = Date.UTC(yr, mo, dy);
  return Number.isFinite(ts) ? Math.round(ts / 60_000) : null;
}

function parseIsoCalendarDateMinutes(dateStr) {
  if (typeof dateStr !== "string" || !dateStr.trim()) return null;
  const m = /^(20\d{2})[-/]?(\d{1,2})[-/]?(\d{1,2})/.exec(dateStr.trim());
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dy = Number(m[3]);
  const ts = Date.UTC(yr, mo, dy);
  return Number.isFinite(ts) ? Math.round(ts / 60_000) : null;
}

const WEEKDAY_INDEX_MAP = {
  周一: 0,
  周二: 1,
  周三: 2,
  周四: 3,
  周五: 4,
  周六: 5,
  周日: 6,
};

/**
 * Resolve Beijing (`UTC+8`) timeline minutes for cross-day kickoff gap & earliest-match void ordering:
 * 1) `m.kickoffDateTime` (exact `YYYY-MM-DD HH:MM[:SS]` in Beijing time; respects overridden `m.kickoff` on clones),
 * 2) `m.matchDate` + `m.kickoff` (exact calendar date + HH:MM),
 * 3) `m.businessDate` + Sporttery rollover `parseKickoffMinutes(m.kickoff)` (`00:00..11:59` -> next calendar morning),
 * 4) `YYYYMMDD` prefix on `m.id` + `parseKickoffMinutes(m.kickoff)` (when all compared matches share ID date prefixes),
 * 5) `周一..周日` weekday prefix on `m.matchNumStr` + `parseKickoffMinutes(m.kickoff)`.
 */
export function buildMatchTimelineResolver(matchList) {
  const list = Array.isArray(matchList) ? matchList.filter(Boolean) : [];
  const exactEpochMap = new Map();
  let allHaveExactEpoch = list.length > 0;

  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    let epochMin = null;
    if (typeof m.kickoffDateTime === "string" && m.kickoffDateTime.trim()) {
      const dtm =
        /^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(
          m.kickoffDateTime.trim()
        );
      if (dtm) {
        const yr = Number(dtm[1]);
        const mo = Number(dtm[2]) - 1;
        const dy = Number(dtm[3]);
        const dtH = Number(dtm[4]);
        const dtM = Number(dtm[5]);
        const ko = m.kickoff ? parseRawHhMm(m.kickoff) : { h: dtH, min: dtM };
        if (!m.kickoff || (dtH === ko.h && dtM === ko.min)) {
          const ts = Date.UTC(yr, mo, dy, dtH - 8, dtM);
          if (Number.isFinite(ts)) epochMin = Math.round(ts / 60_000);
        }
      }
    }
    if (epochMin === null && m.matchDate) {
      const calMin = parseIsoCalendarDateMinutes(m.matchDate);
      if (calMin !== null) {
        const { h, min } = parseRawHhMm(m.kickoff);
        epochMin = calMin + h * 60 + min - 480;
      }
    }
    if (epochMin === null && m.businessDate) {
      const bizMin = parseIsoCalendarDateMinutes(m.businessDate);
      if (bizMin !== null) {
        epochMin = bizMin + parseKickoffMinutes(m.kickoff) - 480;
      }
    }
    if (epochMin !== null) {
      exactEpochMap.set(m.id, epochMin);
    } else {
      allHaveExactEpoch = false;
    }
  }

  if (allHaveExactEpoch) {
    return (m) => exactEpochMap.get(m.id) ?? parseKickoffMinutes(m?.kickoff);
  }

  const allHaveIdDate =
    list.length > 0 &&
    list.every((m) => parseMatchDatePrefixMinutes(m.id) !== null);
  if (allHaveIdDate) {
    return (m) =>
      (parseMatchDatePrefixMinutes(m.id) ?? 0) + parseKickoffMinutes(m.kickoff);
  }

  // Hybrid or weekday fallback (`周一001` vs `周二004` with numeric Sporttery IDs)
  const weekdays = list
    .map((m) => {
      const wm = /^(周[一二三四五六日])/.exec(String(m?.matchNumStr || ""));
      return wm ? WEEKDAY_INDEX_MAP[wm[1]] : null;
    })
    .filter((w) => w !== null);

  if (weekdays.length === list.length && list.length > 0) {
    // Anchor cyclic week so max forward distance from anchor <= 6 days (handles 周日 -> 周一 rollover)
    let anchorW = weekdays[0];
    for (let cand = 0; cand < 7; cand++) {
      if (
        weekdays.every((w) => (w - cand + 7) % 7 <= 5) &&
        weekdays.includes(cand)
      ) {
        anchorW = cand;
        break;
      }
    }
    return (m) => {
      if (exactEpochMap.has(m.id)) return exactEpochMap.get(m.id);
      const wm = /^(周[一二三四五六日])/.exec(String(m?.matchNumStr || ""));
      const wIdx = wm ? WEEKDAY_INDEX_MAP[wm[1]] : anchorW;
      const dayDiff = (wIdx - anchorW + 7) % 7;
      return dayDiff * 1440 + parseKickoffMinutes(m.kickoff);
    };
  }

  return (m) => {
    if (exactEpochMap.has(m?.id)) return exactEpochMap.get(m.id);
    return parseKickoffMinutes(m?.kickoff);
  };
}

export function resolveVoidMatchSet({
  matches = [],
  candidateMatchIds = [],
  picks = [],
  simVoidFirstMatch = false,
  voidMatchIds = null,
}) {
  if (Array.isArray(voidMatchIds) && voidMatchIds.length > 0) {
    const cleaned = voidMatchIds
      .map((id) => String(id || "").trim())
      .filter(Boolean);
    if (cleaned.length > 0) return new Set(cleaned);
  }
  if (!simVoidFirstMatch) return new Set();

  const distinctIds = [
    ...new Set(
      (candidateMatchIds.length > 0
        ? candidateMatchIds
        : (picks || []).map((p) => p?.matchId)
      )
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ];
  if (distinctIds.length === 0) return new Set();
  if (distinctIds.length === 1) return new Set([distinctIds[0]]);

  const matchById = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      const fm = matches[i];
      if (fm?.id) matchById.set(String(fm.id), fm);
    }
  }
  const pickMetaById = new Map();
  if (Array.isArray(picks)) {
    for (let i = 0; i < picks.length; i++) {
      const pk = picks[i];
      if (pk?.matchId && !pickMetaById.has(String(pk.matchId))) {
        pickMetaById.set(String(pk.matchId), pk);
      }
    }
  }

  const pseudoMatches = distinctIds.map((id) => {
    const fm = matchById.get(id);
    if (fm) return fm;
    const pk = pickMetaById.get(id);
    return {
      id,
      matchNumStr: pk?.matchNumStr || "",
      kickoff: pk?.kickoff || "20:00",
    };
  });
  const hasRealMatchTiming = pseudoMatches.some((pm) => matchById.has(pm.id));
  const timeOf = buildMatchTimelineResolver(pseudoMatches);

  const sorted = [...pseudoMatches].sort((a, b) => {
    if (hasRealMatchTiming) {
      const dt = timeOf(a) - timeOf(b);
      if (dt !== 0) return dt;
    }
    return String(a.id).localeCompare(String(b.id));
  });
  return new Set([String(sorted[0].id)]);
}

function getSellingPoolOption(pool, key, requireSingle = false) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options))
    return null;
  if (requireSingle && !isPoolSingleEligible(pool)) return null;
  const found = pool.options.find((o) => o.key === key && Number(o.odds) > 0);
  return found ?? null;
}

function resolveComplementaryLateHedge(late, latePicks) {
  if (!Array.isArray(latePicks) || latePicks.length === 0) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr || ""} 未包含有效选号，无法构建互补反向对冲`,
    };
  }

  const latePools = Array.from(new Set(latePicks.map((p) => p.poolCode)));
  const nonCompPool = latePools.find(
    (c) => c === "TTG" || c === "CRS" || c === "HAFU"
  );
  if (nonCompPool) {
    const poolTitle =
      nonCompPool === "TTG"
        ? "总进球"
        : nonCompPool === "CRS"
          ? "比分"
          : "半全场";
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 所选为【${poolTitle}】玩法，属局部赛果分支，无法通过胜平负或让球盘构成 100% 无死角互补对冲`,
    };
  }

  if (
    latePools.length !== 1 ||
    (latePools[0] !== "HAD" && latePools[0] !== "HHAD")
  ) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 含跨玩法混合选项，无法构建 100% 无死角互补反向盘`,
    };
  }

  const poolCode = latePools[0];
  const pickedKeys = new Set(latePicks.map((p) => p.optionKey));
  const hadPool = late.pools?.HAD;
  const hhadPool = late.pools?.HHAD;
  const goalLineNum = Number(hhadPool?.goalLine ?? "-1");
  const goalLineStr =
    hhadPool?.goalLine ??
    (goalLineNum > 0 ? `+${goalLineNum}` : String(goalLineNum));

  const pickBest = (candidates) => {
    const valid = candidates.filter(
      (c) => c && Number.isFinite(c.odds) && c.odds > 0
    );
    if (valid.length === 0) return null;
    valid.sort(
      (a, b) => b.odds - a.odds || Number(a.isPair) - Number(b.isPair)
    );
    return valid[0];
  };

  const makeSingleCand = (opt, poolTag) =>
    opt
      ? {
          label: `${late.home} 反向【${poolTag}·${opt.label}】`,
          odds: opt.odds,
          isPair: false,
        }
      : null;

  const makePairCand = (opt1, opt2, poolTag) =>
    opt1 && opt2
      ? {
          label: `${late.home} 反向【${poolTag}·${opt1.label}+${opt2.label}配平】`,
          poolTag,
          opt1Label: opt1.label,
          opt2Label: opt2.label,
          odds1: opt1.odds,
          odds2: opt2.odds,
          odds: 1 / (1 / opt1.odds + 1 / opt2.odds),
          isPair: true,
        }
      : null;

  const evalForSingleRequirement = (requireSingle) => {
    if (poolCode === "HAD") {
      const validHadKeys = ["h", "d", "a"].filter((k) => pickedKeys.has(k));
      if (
        validHadKeys.length !== pickedKeys.size ||
        validHadKeys.length === 0
      ) {
        return {
          ok: false,
          reason: `末场 ${late.matchNumStr} 胜平负选项异常，无法构成完备互补对冲`,
        };
      }
      if (validHadKeys.length >= 3) {
        return {
          ok: false,
          reason: `末场 ${late.matchNumStr} 已全包胜平负全部赛果，无需额外补买反向对冲`,
        };
      }
      if (validHadKeys.length === 2) {
        const remKey = ["h", "d", "a"].find((k) => !pickedKeys.has(k));
        const remOpt = getSellingPoolOption(hadPool, remKey, requireSingle);
        const best = makeSingleCand(remOpt, "胜平负");
        return best
          ? { ok: true, candidate: best }
          : {
              ok: false,
              reason: `末场 ${late.matchNumStr} 缺少在售的胜平负互补第 3 项，无法无死角锁利`,
            };
      }

      const singleKey = validHadKeys[0];
      const hadH = getSellingPoolOption(hadPool, "h", requireSingle);
      const hadD = getSellingPoolOption(hadPool, "d", requireSingle);
      const hadA = getSellingPoolOption(hadPool, "a", requireSingle);
      let best = null;
      if (singleKey === "h") {
        const hhadHa =
          goalLineNum === -1
            ? getSellingPoolOption(hhadPool, "ha", requireSingle)
            : null;
        best = pickBest([
          makeSingleCand(hhadHa, "让球(-1)"),
          makePairCand(hadD, hadA, "胜平负"),
        ]);
      } else if (singleKey === "a") {
        const hhadHh =
          goalLineNum === 1
            ? getSellingPoolOption(hhadPool, "hh", requireSingle)
            : null;
        best = pickBest([
          makeSingleCand(hhadHh, "让球(+1)"),
          makePairCand(hadH, hadD, "胜平负"),
        ]);
      } else if (singleKey === "d") {
        best = makePairCand(hadH, hadA, "胜平负");
      }

      return best
        ? { ok: true, candidate: best }
        : {
            ok: false,
            reason: `末场 ${late.matchNumStr} 缺少在售的 100% 互补反向盘口，无法无死角对冲`,
          };
    }

    const validHhadKeys = ["hh", "hd", "ha"].filter((k) => pickedKeys.has(k));
    if (
      !Number.isFinite(goalLineNum) ||
      goalLineNum === 0 ||
      validHhadKeys.length !== pickedKeys.size ||
      validHhadKeys.length === 0
    ) {
      return {
        ok: false,
        reason: `末场 ${late.matchNumStr} 让球盘选项异常，无法构成完备互补对冲`,
      };
    }
    if (validHhadKeys.length >= 3) {
      return {
        ok: false,
        reason: `末场 ${late.matchNumStr} 已全包让球胜平负全部赛果，无需额外补买反向对冲`,
      };
    }
    const poolTag = `让球(${goalLineStr})`;
    if (validHhadKeys.length === 2) {
      const remKey = ["hh", "hd", "ha"].find((k) => !pickedKeys.has(k));
      const remOpt = getSellingPoolOption(hhadPool, remKey, requireSingle);
      const best = makeSingleCand(remOpt, poolTag);
      return best
        ? { ok: true, candidate: best }
        : {
            ok: false,
            reason: `末场 ${late.matchNumStr} 缺少在售的${poolTag}互补第 3 项，无法无死角锁利`,
          };
    }

    const singleKey = validHhadKeys[0];
    const otherKeys = ["hh", "hd", "ha"].filter((k) => k !== singleKey);
    const opt1 = getSellingPoolOption(hhadPool, otherKeys[0], requireSingle);
    const opt2 = getSellingPoolOption(hhadPool, otherKeys[1], requireSingle);
    let crossSingle = null;
    if (goalLineNum === -1 && singleKey === "ha") {
      crossSingle = makeSingleCand(
        getSellingPoolOption(hadPool, "h", requireSingle),
        "胜平负"
      );
    } else if (goalLineNum === 1 && singleKey === "hh") {
      crossSingle = makeSingleCand(
        getSellingPoolOption(hadPool, "a", requireSingle),
        "胜平负"
      );
    }
    const best = pickBest([crossSingle, makePairCand(opt1, opt2, poolTag)]);
    return best
      ? { ok: true, candidate: best }
      : {
          ok: false,
          reason: `末场 ${late.matchNumStr} 缺少在售的 100% 互补反向盘口，无法无死角对冲`,
        };
  };

  const strictSingleRes = evalForSingleRequirement(true);
  if (strictSingleRes.ok) return strictSingleRes;
  const sellingOnlyRes = evalForSingleRequirement(false);
  if (sellingOnlyRes.ok) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 互补胜平负/让球盘未开单关，体彩店无法单独补买反向盘对冲`,
    };
  }
  return strictSingleRes;
}

function extractPlanEffectivePicks(appliedPlan) {
  if (!Array.isArray(appliedPlan?.lines) || appliedPlan.lines.length === 0)
    return null;
  const byKey = new Map();
  for (const l of appliedPlan.lines) {
    for (const lg of l.legs || []) {
      const k = `${lg.matchId}-${lg.poolCode}-${lg.optionKey}`;
      if (!byKey.has(k)) {
        byKey.set(k, {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          singleAllowed: true,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

function validatePlanLateHedgeConsistency(appliedPlan, late) {
  if (!Array.isArray(appliedPlan?.lines) || appliedPlan.lines.length === 0) {
    return { ok: true, latePicks: null };
  }
  const lateLines = appliedPlan.lines.filter(
    (l) => Array.isArray(l.legs) && l.legs.some((g) => g.matchId === late.id)
  );
  if (lateLines.length === 0) {
    return {
      ok: false,
      reason: `当前分倍方案未包含末场 ${late.matchNumStr} 串关实票，无法执行末场补单锁利`,
    };
  }
  const latePoolSet = new Set();
  const latePickMap = new Map();
  const earlySigToLateOpts = new Map();

  for (const l of lateLines) {
    const earlySig = l.legs
      .filter((g) => g.matchId !== late.id)
      .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
      .sort()
      .join("|");
    const lateLegs = l.legs.filter((g) => g.matchId === late.id);
    if (!earlySigToLateOpts.has(earlySig)) {
      earlySigToLateOpts.set(earlySig, new Set());
    }
    const optSet = earlySigToLateOpts.get(earlySig);
    for (const lg of lateLegs) {
      latePoolSet.add(lg.poolCode);
      optSet.add(`${lg.poolCode}:${lg.optionKey}`);
      const pkKey = `${lg.poolCode}:${lg.optionKey}`;
      if (!latePickMap.has(pkKey)) {
        latePickMap.set(pkKey, {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          singleAllowed: true,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
        });
      }
    }
  }

  if (latePoolSet.size > 1) {
    return {
      ok: false,
      reason: `当前分倍方案在末场 ${late.matchNumStr} 混合了跨玩法盘口，无法通过单一反向单 100% 无死角锁利`,
    };
  }

  const canonicalOptionSets = Array.from(earlySigToLateOpts.values()).map((s) =>
    Array.from(s).sort().join(",")
  );
  if (new Set(canonicalOptionSets).size > 1) {
    return {
      ok: false,
      reason: `当前分倍方案各注前序赛果对应的末场 ${late.matchNumStr} 持仓不一致，需前序完场确认存活实票后再定向补单`,
    };
  }

  return { ok: true, latePicks: Array.from(latePickMap.values()) };
}

function formatClockFromMinOfDay(minOfDay) {
  const norm = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(norm / 60)).padStart(2, "0");
  const mm = String(norm % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function computeOpenSportterySellingMinutes(
  startBjTotalMin,
  endBjTotalMin,
  dowBaseOffset = 3
) {
  if (endBjTotalMin <= startBjTotalMin) {
    return Math.round(endBjTotalMin - startBjTotalMin);
  }
  const startDay = Math.floor(startBjTotalMin / 1440);
  const endDay = Math.floor(endBjTotalMin / 1440);
  let openTotal = 0;
  for (let d = startDay; d <= endDay; d++) {
    const bjDow = (((d + dowBaseOffset) % 7) + 7) % 7; // 0 = Mon .. 6 = Sun
    const openStart = d * 1440 + 11 * 60;
    const openEnd = d * 1440 + (bjDow >= 5 ? 23 * 60 : 22 * 60);
    const segLo = Math.max(startBjTotalMin, openStart);
    const segHi = Math.min(endBjTotalMin, openEnd);
    if (segHi > segLo) openTotal += segHi - segLo;
  }
  return Math.round(openTotal);
}

/**
 * Compute statutory Sporttery sales cutoff window `W = t_cut - t_done` (`t_done = t_early + 115m`)
 * in the exact coordinate system of `buildMatchTimelineResolver(matchList)`:
 * - Mon–Fri: 11:00–22:00 Beijing time; Sat–Sun: 11:00–23:00 Beijing time.
 * - If `late` kicks off during overnight closed hours (`00:00..10:59`), `t_cut` is the preceding
 *   evening's closing time (`22:00` or `23:00`), NEVER `late`'s kickoff!
 */
export function resolveStaggeredHedgeCutoffWindow(
  matchList,
  early,
  late,
  timeMinutesOf
) {
  const earlyMin = timeMinutesOf(early);
  const lateMin = timeMinutesOf(late);
  const kickoffGapMinutes = Math.max(0, lateMin - earlyMin);
  const estimatedFinishMin = earlyMin + 115;

  const list = Array.isArray(matchList) ? matchList.filter(Boolean) : [];
  const hasExactDate = (m) =>
    Boolean(
      (typeof m?.kickoffDateTime === "string" &&
        /^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})[T\s]+(\d{1,2}):(\d{1,2})/.test(
          m.kickoffDateTime.trim()
        )) ||
      (m?.matchDate && parseIsoCalendarDateMinutes(m.matchDate) !== null) ||
      (m?.businessDate && parseIsoCalendarDateMinutes(m.businessDate) !== null)
    );

  const allExact = list.length > 0 && list.every(hasExactDate);
  if (allExact) {
    const bjTotalMin = lateMin + 480;
    const bjDay = Math.floor(bjTotalMin / 1440);
    const bjMinOfDay = ((bjTotalMin % 1440) + 1440) % 1440;
    const bjDow = (((bjDay + 3) % 7) + 7) % 7; // 0 = Mon .. 6 = Sun
    const closeToday = bjDow >= 5 ? 23 * 60 : 22 * 60;

    let cutoffBjTotalMin;
    let lateCutoffClock;
    if (bjMinOfDay < 11 * 60) {
      const prevDow = (bjDow + 6) % 7;
      const prevClose = prevDow >= 5 ? 23 * 60 : 22 * 60;
      cutoffBjTotalMin = (bjDay - 1) * 1440 + prevClose;
      lateCutoffClock = formatClockFromMinOfDay(prevClose);
    } else if (bjMinOfDay <= closeToday) {
      cutoffBjTotalMin = bjTotalMin;
      lateCutoffClock = formatClockFromMinOfDay(bjMinOfDay);
    } else {
      cutoffBjTotalMin = bjDay * 1440 + closeToday;
      lateCutoffClock = formatClockFromMinOfDay(closeToday);
    }
    const cutoffMin = cutoffBjTotalMin - 480;
    const doneBjTotalMin = estimatedFinishMin + 480;
    const wallPostFinishMinutes = Math.round(cutoffMin - estimatedFinishMin);
    return {
      kickoffGapMinutes,
      postFinishWindowMinutes: computeOpenSportterySellingMinutes(
        doneBjTotalMin,
        cutoffBjTotalMin,
        3
      ),
      wallPostFinishMinutes,
      earlyEstimatedFinishText: formatClockFromMinOfDay(doneBjTotalMin),
      lateCutoffText: lateCutoffClock,
    };
  }

  const allIdDate =
    list.length > 0 &&
    list.every((m) => parseMatchDatePrefixMinutes(m?.id) !== null);
  if (allIdDate) {
    const calMin = parseMatchDatePrefixMinutes(late.id);
    const bizDay = Math.round(calMin / 1440);
    const bizDow = (((bizDay + 3) % 7) + 7) % 7;
    const closeBiz = bizDow >= 5 ? 23 * 60 : 22 * 60;
    const koMin = parseKickoffMinutes(late.kickoff);
    const cutoffMin =
      koMin <= closeBiz || koMin >= 1440 + 11 * 60
        ? calMin + koMin
        : calMin + closeBiz;
    const cutoffClock =
      koMin <= closeBiz || koMin >= 1440 + 11 * 60
        ? formatClockFromMinOfDay(koMin)
        : formatClockFromMinOfDay(closeBiz);
    const earlyKoMin = parseKickoffMinutes(early.kickoff) + 115;
    const wallPostFinishMinutes = Math.round(cutoffMin - estimatedFinishMin);
    return {
      kickoffGapMinutes,
      postFinishWindowMinutes: computeOpenSportterySellingMinutes(
        estimatedFinishMin,
        cutoffMin,
        3
      ),
      wallPostFinishMinutes,
      earlyEstimatedFinishText: formatClockFromMinOfDay(earlyKoMin),
      lateCutoffText: cutoffClock,
    };
  }

  const wmLate = /^(周[一二三四五六日])/.exec(String(late?.matchNumStr || ""));
  const wmEarly = /^(周[一二三四五六日])/.exec(
    String(early?.matchNumStr || "")
  );
  if (wmLate && wmEarly) {
    const wIdx = WEEKDAY_INDEX_MAP[wmLate[1]];
    const closeBiz = wIdx >= 5 ? 23 * 60 : 22 * 60;
    const koMin = parseKickoffMinutes(late.kickoff);
    const dayBaseMin = lateMin - koMin;
    const cutoffMin =
      koMin <= closeBiz || koMin >= 1440 + 11 * 60
        ? lateMin
        : dayBaseMin + closeBiz;
    const cutoffClock =
      koMin <= closeBiz || koMin >= 1440 + 11 * 60
        ? formatClockFromMinOfDay(koMin)
        : formatClockFromMinOfDay(closeBiz);
    const earlyKoMin = parseKickoffMinutes(early.kickoff) + 115;
    const lateDayIdx = Math.round(dayBaseMin / 1440);
    const dowOffset = (((wIdx - lateDayIdx) % 7) + 7) % 7;
    const wallPostFinishMinutes = Math.round(cutoffMin - estimatedFinishMin);
    return {
      kickoffGapMinutes,
      postFinishWindowMinutes: computeOpenSportterySellingMinutes(
        estimatedFinishMin,
        cutoffMin,
        dowOffset
      ),
      wallPostFinishMinutes,
      earlyEstimatedFinishText: formatClockFromMinOfDay(earlyKoMin),
      lateCutoffText: cutoffClock,
    };
  }

  return {
    kickoffGapMinutes,
    postFinishWindowMinutes: null,
    wallPostFinishMinutes: null,
    earlyEstimatedFinishText: "",
    lateCutoffText: "",
  };
}

function encodeExecSwapLinesCanonicalSig(lines) {
  return (lines || [])
    .map((ln) => {
      const m = Math.max(1, Math.round(Number(ln?.multiple) || 1));
      const lp = (ln?.legs || [])
        .map(
          (g) =>
            `${String(g.matchId)}:${String(g.poolCode)}:${String(g.optionKey)}@${Number(g.odds).toFixed(4)}`
        )
        .sort()
        .join("+");
      return `${lp}*${m}`;
    })
    .sort()
    .join("||");
}

function computeExactWholeSlipSwapDiffRange(origLines, allExecLines, matches) {
  const matchById = new Map(
    (Array.isArray(matches) ? matches : []).map((m) => [String(m?.id ?? ""), m])
  );
  const matchIds = [];
  const seenMid = new Set();
  const collectMid = (lines) => {
    for (let i = 0; i < lines.length; i++) {
      const legs = lines[i]?.legs || [];
      for (let j = 0; j < legs.length; j++) {
        const mid = String(legs[j]?.matchId ?? "");
        if (mid && !seenMid.has(mid)) {
          seenMid.add(mid);
          matchIds.push(mid);
        }
      }
    }
  };
  collectMid(origLines);
  collectMid(allExecLines);
  if (matchIds.length === 0) {
    return { ok: true, exactRangeKnown: false, minDiff: null, maxDiff: null };
  }

  const origCount = origLines.length;
  const totalCount = origCount + allExecLines.length;
  const lineCents = new BigInt64Array(totalCount);
  const lineLegCounts = new Int32Array(totalCount);
  for (let i = 0; i < origCount; i++) {
    const ln = origLines[i];
    lineCents[i] = BigInt(
      Math.round(
        computeLineStatutoryPayout(ln.legs, ln.multiple).returnPayout * 100
      )
    );
    lineLegCounts[i] = (ln.legs || []).length;
  }
  for (let i = 0; i < allExecLines.length; i++) {
    const ln = allExecLines[i];
    lineCents[origCount + i] = BigInt(
      Math.round(Number(ln.returnPayout) * 100)
    );
    lineLegCounts[origCount + i] = (ln.legs || []).length;
  }

  // Partition ATOMIC_TEMPLATES per match by exact distinct-leg hit signature
  const matchClasses = [];
  let jointClassProduct = 1;
  for (let q = 0; q < matchIds.length; q++) {
    const mid = matchIds[q];
    const mObj = matchById.get(mid) || null;
    const fallbackGl = mObj ? resolveGoalLineNum(mObj) : -1;
    const legKeyToIdx = new Map();
    const distinctLegs = [];
    const lineIdxsPerLeg = [];

    const scanLinesForMatch = (lines, baseIdx) => {
      for (let i = 0; i < lines.length; i++) {
        const legs = lines[i]?.legs || [];
        for (let j = 0; j < legs.length; j++) {
          const g = legs[j];
          if (String(g?.matchId ?? "") !== mid) continue;
          const glNum =
            g.goalLine !== undefined && g.goalLine !== null && g.goalLine !== ""
              ? Number(g.goalLine)
              : fallbackGl;
          const lk = `${g.poolCode}:${g.optionKey}:${Number.isFinite(glNum) ? glNum : fallbackGl}`;
          let dIdx = legKeyToIdx.get(lk);
          if (dIdx === undefined) {
            dIdx = distinctLegs.length;
            legKeyToIdx.set(lk, dIdx);
            distinctLegs.push({
              poolCode: g.poolCode,
              optionKey: g.optionKey,
              optionLabel: g.optionLabel,
              gl: Number.isFinite(glNum) ? glNum : fallbackGl,
            });
            lineIdxsPerLeg.push([]);
          }
          lineIdxsPerLeg[dIdx].push(baseIdx + i);
        }
      }
    };
    scanLinesForMatch(origLines, 0);
    scanLinesForMatch(allExecLines, origCount);

    const classMap = new Map();
    for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
      const tpl = ATOMIC_TEMPLATES[t];
      const hitLegIndices = [];
      let sig = "";
      for (let d = 0; d < distinctLegs.length; d++) {
        const dl = distinctLegs[d];
        const hit = doesOptionHitAtomicTemplate(
          dl.poolCode,
          dl.optionKey,
          dl.optionLabel,
          dl.gl,
          tpl
        );
        sig += hit ? "1" : "0";
        if (hit) hitLegIndices.push(d);
      }
      if (!classMap.has(sig)) {
        const lineHitSet = [];
        for (let h = 0; h < hitLegIndices.length; h++) {
          const arr = lineIdxsPerLeg[hitLegIndices[h]];
          for (let a = 0; a < arr.length; a++) lineHitSet.push(arr[a]);
        }
        classMap.set(sig, Int32Array.from(lineHitSet));
      }
    }
    const classesForQ = Array.from(classMap.values());
    jointClassProduct *= classesForQ.length;
    if (jointClassProduct > 100_000) {
      return { ok: true, exactRangeKnown: false, minDiff: null, maxDiff: null };
    }
    matchClasses.push(classesForQ);
  }

  const remLegs = Int32Array.from(lineLegCounts);
  let curOrigCents = 0n;
  let curNewCents = 0n;
  let minDiffCents = null;
  let maxDiffCents = null;
  let anyStrictPos = false;
  let aborted = false;

  const dfs = (q) => {
    if (aborted) return;
    if (q === matchClasses.length) {
      if (
        curOrigCents > 0n !== curNewCents > 0n ||
        curNewCents < curOrigCents
      ) {
        aborted = true;
        return;
      }
      const d = curNewCents - curOrigCents;
      if (d > 0n) anyStrictPos = true;
      if (minDiffCents === null || d < minDiffCents) minDiffCents = d;
      if (maxDiffCents === null || d > maxDiffCents) maxDiffCents = d;
      return;
    }
    const clsList = matchClasses[q];
    for (let c = 0; c < clsList.length; c++) {
      const hitLines = clsList[c];
      for (let u = 0; u < hitLines.length; u++) {
        const li = hitLines[u];
        const nextRem = remLegs[li] - 1;
        remLegs[li] = nextRem;
        if (nextRem === 0) {
          if (li < origCount) curOrigCents += lineCents[li];
          else curNewCents += lineCents[li];
        }
      }
      dfs(q + 1);
      for (let u = 0; u < hitLines.length; u++) {
        const li = hitLines[u];
        if (remLegs[li] === 0) {
          if (li < origCount) curOrigCents -= lineCents[li];
          else curNewCents -= lineCents[li];
        }
        remLegs[li] += 1;
      }
      if (aborted) return;
    }
  };
  dfs(0);

  if (
    aborted ||
    !anyStrictPos ||
    minDiffCents === null ||
    maxDiffCents === null
  ) {
    return { ok: false, exactRangeKnown: true, minDiff: null, maxDiff: null };
  }
  return {
    ok: true,
    exactRangeKnown: true,
    minDiff: Number(minDiffCents) / 100,
    maxDiff: Number(maxDiffCents) / 100,
  };
}

function evaluateExecutableEqualStakeSwapOnSlip({
  match,
  arb,
  mpicks,
  isSingleMatchSlip,
  report,
  appliedPlan,
  matches,
}) {
  if (!arb || arb.isExactEventEquivalent !== true) {
    return { ok: false };
  }
  const worseList = Array.isArray(arb.worsePicks) ? arb.worsePicks : [];
  const betterList = Array.isArray(arb.betterPicks) ? arb.betterPicks : [];
  if (worseList.length === 0 || betterList.length === 0) {
    return { ok: false };
  }

  let origLines = [];
  if (Array.isArray(appliedPlan?.lines) && appliedPlan.lines.length > 0) {
    origLines = appliedPlan.lines.map((ln, idx) => ({
      id: ln.id || `orig-${idx + 1}`,
      modeLabel: ln.modeLabel,
      multiple: Math.max(1, Math.round(Number(ln.multiple) || 1)),
      legs: ln.legs || [],
    }));
  } else if (
    report?.canCheckout === true &&
    Array.isArray(report?.tickets) &&
    report.tickets.length > 0
  ) {
    origLines = report.tickets.map((tk, idx) => ({
      id: tk.id || `tk-${idx + 1}`,
      modeLabel: (tk.legs?.length || 1) === 1 ? "单关" : `${tk.legs.length}串1`,
      multiple: Math.max(
        1,
        Math.round(Number(tk.multiple ?? report.multiple) || 1)
      ),
      legs: tk.legs || [],
    }));
  } else if (
    isSingleMatchSlip &&
    mpicks.length > 0 &&
    !(Number(report?.totalCost) > 0)
  ) {
    const fallbackMult = Math.max(
      1,
      Math.min(999, Math.round(Number(report?.multiple) || 1))
    );
    origLines = mpicks.map((pk, idx) => ({
      id: `rescue-orig-${idx + 1}`,
      modeLabel: "单关",
      multiple: fallbackMult,
      legs: [pk],
    }));
  } else {
    return { ok: false };
  }

  if (origLines.length === 0 || origLines.length > 512) {
    return { ok: false };
  }

  const touchingLines = origLines.filter(
    (ln) =>
      Array.isArray(ln.legs) && ln.legs.some((g) => g.matchId === match.id)
  );
  if (touchingLines.length === 0) {
    return { ok: false };
  }
  const needsSingleSale = touchingLines.some((ln) => ln.legs.length === 1);
  const needsAllUpSale = touchingLines.some((ln) => ln.legs.length >= 2);

  // Resolve full option specs for betterPicks on `match` using per-line sale eligibility
  const betterFullOpts = [];
  for (let i = 0; i < betterList.length; i++) {
    const bp = betterList[i];
    const pool = match.pools?.[bp.poolCode];
    if (!pool || pool.selling === false || !Array.isArray(pool.options)) {
      return { ok: false };
    }
    if (needsSingleSale && !isPoolSingleEligible(pool)) {
      return { ok: false };
    }
    if (needsAllUpSale && !isPoolAllUpEligible(pool)) {
      return { ok: false };
    }
    const opt = pool.options.find((o) => o.key === bp.optionKey);
    if (!opt || !(Number(opt.odds) > 1)) return { ok: false };
    betterFullOpts.push({
      matchId: match.id,
      matchNumStr: match.matchNumStr,
      home: match.home,
      away: match.away,
      kickoff: match.kickoff ?? "21:00",
      poolCode: bp.poolCode,
      poolName: pool.name || bp.poolCode,
      goalLine: pool.goalLine,
      optionKey: opt.key,
      optionLabel: opt.label,
      odds: Number(opt.odds),
      fairProb: Number(opt.fairProb) || 0.25,
    });
  }

  const worseKeySet = new Set(
    worseList.map((wp) => `${wp.poolCode}:${wp.optionKey}`)
  );
  const remPicksOnMatch = mpicks.filter(
    (p) => !worseKeySet.has(`${p.poolCode}:${p.optionKey}`)
  );
  if (needsAllUpSale) {
    const postPools = new Set([
      ...remPicksOnMatch.map((p) => p.poolCode),
      ...betterFullOpts.map((p) => p.poolCode),
    ]);
    if (postPools.size > 1) return { ok: false };
  } else if (needsSingleSale && remPicksOnMatch.length > 0) {
    if (
      remPicksOnMatch.some(
        (p) => !isPoolSingleEligible(match.pools?.[p.poolCode])
      )
    ) {
      return { ok: false };
    }
  }

  const unchangedLines = [];
  const partnerGroups = new Map();
  const partnerOrder = [];

  for (let i = 0; i < origLines.length; i++) {
    const ln = origLines[i];
    const mLegIdx = ln.legs.findIndex((g) => g.matchId === match.id);
    if (mLegIdx < 0) {
      unchangedLines.push(ln);
      continue;
    }
    const mLeg = ln.legs[mLegIdx];
    const mKey = `${mLeg.poolCode}:${mLeg.optionKey}`;
    if (!worseKeySet.has(mKey)) {
      unchangedLines.push(ln);
      continue;
    }
    const partnerLegs = ln.legs.filter((_, idx) => idx !== mLegIdx);
    const partnerSig = partnerLegs
      .map(
        (g) =>
          `${g.matchId}:${g.poolCode}:${g.optionKey}@${Number(g.odds).toFixed(4)}`
      )
      .sort()
      .join("|");
    let grp = partnerGroups.get(partnerSig);
    if (!grp) {
      grp = {
        partnerLegs,
        modeLabel: ln.modeLabel,
        mLegIdx,
        byWorseKey: new Map(),
        lines: [],
        groupNotes: 0,
      };
      partnerGroups.set(partnerSig, grp);
      partnerOrder.push(partnerSig);
    }
    grp.byWorseKey.set(mKey, (grp.byWorseKey.get(mKey) || 0) + ln.multiple);
    grp.lines.push(ln);
    grp.groupNotes += ln.multiple;
  }

  if (
    partnerOrder.length === 0 ||
    unchangedLines.length + partnerOrder.length * betterFullOpts.length > 512
  ) {
    return { ok: false };
  }

  const gl = resolveGoalLineNum(match);
  const replacedLines = [];
  let globalMinDiff = Infinity;
  let globalMaxDiff = -Infinity;
  let anyStrictPositive = false;

  for (let gIdx = 0; gIdx < partnerOrder.length; gIdx++) {
    const grp = partnerGroups.get(partnerOrder[gIdx]);
    if (grp.byWorseKey.size !== worseList.length) {
      return { ok: false };
    }
    const N = grp.groupNotes;
    const r = betterFullOpts.length;
    if (N < r || N > 999 * r) return { ok: false };

    const origTplPay = new Float64Array(ATOMIC_TEMPLATES.length);
    for (let u = 0; u < grp.lines.length; u++) {
      const ln = grp.lines[u];
      const stOrig = computeLineStatutoryPayout(ln.legs, ln.multiple);
      const mLeg = ln.legs.find((g) => g.matchId === match.id);
      for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
        if (
          doesOptionHitAtomicTemplate(
            mLeg.poolCode,
            mLeg.optionKey,
            mLeg.optionLabel,
            gl,
            ATOMIC_TEMPLATES[t]
          )
        ) {
          origTplPay[t] += stOrig.returnPayout;
        }
      }
    }

    const candUnitPayouts = betterFullOpts.map((bo) => {
      const fullLegs = [...grp.partnerLegs];
      fullLegs.splice(Math.min(grp.mLegIdx, fullLegs.length), 0, bo);
      return {
        fullLegs,
        unitPayout: computeLineStatutoryPayout(fullLegs, 1).unitPayout,
        bo,
      };
    });

    let chosenMults = null;
    if (r === 1) {
      if (N > 999) return { ok: false };
      chosenMults = [N];
    } else if (r === 2) {
      let bestMinD = -Infinity;
      let bestMaxD = -Infinity;
      for (let m1 = 1; m1 <= Math.min(999, N - 1); m1++) {
        const m2 = N - m1;
        if (m2 < 1 || m2 > 999) continue;
        const p1 = Number((candUnitPayouts[0].unitPayout * m1).toFixed(2));
        const p2 = Number((candUnitPayouts[1].unitPayout * m2).toFixed(2));
        let minD = Infinity;
        let maxD = -Infinity;
        let mismatchOutside = false;
        for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
          const h1 = doesOptionHitAtomicTemplate(
            betterFullOpts[0].poolCode,
            betterFullOpts[0].optionKey,
            betterFullOpts[0].optionLabel,
            gl,
            ATOMIC_TEMPLATES[t]
          );
          const h2 = doesOptionHitAtomicTemplate(
            betterFullOpts[1].poolCode,
            betterFullOpts[1].optionKey,
            betterFullOpts[1].optionLabel,
            gl,
            ATOMIC_TEMPLATES[t]
          );
          const cp = (h1 ? p1 : 0) + (h2 ? p2 : 0);
          const op = origTplPay[t];
          if (!h1 && !h2 && op === 0) continue;
          if ((!h1 && !h2 && op > 0) || ((h1 || h2) && op === 0)) {
            mismatchOutside = true;
            break;
          }
          const d = cp - op;
          if (d < minD) minD = d;
          if (d > maxD) maxD = d;
        }
        if (mismatchOutside) return { ok: false };
        if (
          minD > bestMinD + 1e-9 ||
          (Math.abs(minD - bestMinD) <= 1e-9 && maxD > bestMaxD)
        ) {
          bestMinD = minD;
          bestMaxD = maxD;
          chosenMults = [m1, m2];
        }
      }
    } else {
      const dutchItems = candUnitPayouts.map((cu) => ({
        unitPayout: cu.unitPayout,
        prob: cu.bo.fairProb,
        isCapClipped: false,
      }));
      const alloc = allocateInverseOddsDutching(dutchItems, N, {
        validateAllNonLoss: false,
        stage2Mode: "water-fill",
      });
      if (alloc && Array.isArray(alloc.mults)) {
        chosenMults = alloc.mults;
      }
    }

    if (!chosenMults) return { ok: false };

    const builtGroupLines = candUnitPayouts.map((cu, idx) => {
      const mult = chosenMults[idx];
      const st = computeLineStatutoryPayout(cu.fullLegs, mult);
      return {
        id: `swap-ln-${gIdx + 1}-${idx + 1}`,
        roleLabel: `同义省水#${idx + 1}`,
        legs: cu.fullLegs,
        modeLabel:
          cu.fullLegs.length === 1 ? "单关" : `${cu.fullLegs.length}串1`,
        multiple: mult,
        cost: mult * 2,
        unitPayout: st.unitPayout,
        cappedClipped: st.cappedClipped,
        returnPayout: st.returnPayout,
        netProfit: 0,
        prob: cu.fullLegs.reduce(
          (acc, g) => acc * (Number(g.fairProb) || 0.25),
          1
        ),
      };
    });

    for (let t = 0; t < ATOMIC_TEMPLATES.length; t++) {
      let cp = 0;
      let anyHit = false;
      for (let idx = 0; idx < builtGroupLines.length; idx++) {
        const bo = betterFullOpts[idx];
        if (
          doesOptionHitAtomicTemplate(
            bo.poolCode,
            bo.optionKey,
            bo.optionLabel,
            gl,
            ATOMIC_TEMPLATES[t]
          )
        ) {
          anyHit = true;
          cp += builtGroupLines[idx].returnPayout;
        }
      }
      const op = origTplPay[t];
      if (!anyHit && op === 0) continue;
      if ((!anyHit && op > 0) || (anyHit && op === 0)) {
        return { ok: false };
      }
      const diff = Number((cp - op).toFixed(2));
      if (diff < -1e-6) {
        return { ok: false };
      }
      if (diff > 1e-6) anyStrictPositive = true;
      if (diff < globalMinDiff) globalMinDiff = diff;
      if (diff > globalMaxDiff) globalMaxDiff = diff;
    }

    for (let idx = 0; idx < builtGroupLines.length; idx++) {
      replacedLines.push(builtGroupLines[idx]);
    }
  }

  if (!anyStrictPositive || globalMinDiff === Infinity) {
    return { ok: false };
  }

  const unchangedPlanLines = unchangedLines.map((ln, idx) => {
    const st = computeLineStatutoryPayout(ln.legs, ln.multiple);
    const fullLegs = ln.legs.map((p) => {
      const fm = Array.isArray(matches)
        ? matches.find((x) => x.id === p.matchId)
        : null;
      return {
        matchId: p.matchId,
        matchNumStr: p.matchNumStr,
        home: p.home,
        away: p.away,
        kickoff: fm?.kickoff ?? p.kickoff ?? "21:00",
        poolCode: p.poolCode,
        poolName: p.poolName,
        goalLine: fm?.pools?.[p.poolCode]?.goalLine ?? p.goalLine,
        optionKey: p.optionKey,
        optionLabel: p.optionLabel,
        odds: Number(p.odds),
        fairProb: Number(p.fairProb) || 0.25,
      };
    });
    return {
      id: ln.id || `keep-ln-${idx + 1}`,
      roleLabel: `原单保留#${idx + 1}`,
      legs: fullLegs,
      modeLabel:
        fullLegs.length === 1
          ? "单关"
          : ln.modeLabel || `${fullLegs.length}串1`,
      multiple: ln.multiple,
      cost: ln.multiple * 2,
      unitPayout: st.unitPayout,
      cappedClipped: st.cappedClipped,
      returnPayout: st.returnPayout,
      netProfit: 0,
      prob: fullLegs.reduce((acc, g) => acc * (Number(g.fairProb) || 0.25), 1),
    };
  });

  const allExecLines = [...unchangedPlanLines, ...replacedLines];
  const totalSwapCost = allExecLines.reduce((s, l) => s + l.cost, 0);
  const origTotalCost = origLines.reduce((s, l) => s + l.multiple * 2, 0);
  const reportTotalCost = Number(report?.totalCost) || 0;
  if (
    totalSwapCost !== origTotalCost ||
    (reportTotalCost > 0 && Math.abs(totalSwapCost - reportTotalCost) > 1e-6) ||
    encodeExecSwapLinesCanonicalSig(allExecLines) ===
      encodeExecSwapLinesCanonicalSig(origLines)
  ) {
    return { ok: false };
  }
  for (let i = 0; i < allExecLines.length; i++) {
    allExecLines[i].netProfit = Number(
      (allExecLines[i].returnPayout - totalSwapCost).toFixed(2)
    );
  }

  const uniqueMults = new Set(allExecLines.map((l) => l.multiple));
  const executableSwapMultiple =
    uniqueMults.size === 1 ? allExecLines[0].multiple : null;

  const replacedOrigLines = [];
  for (let gIdx = 0; gIdx < partnerOrder.length; gIdx++) {
    const grp = partnerGroups.get(partnerOrder[gIdx]);
    for (let u = 0; u < grp.lines.length; u++) {
      replacedOrigLines.push(grp.lines[u]);
    }
  }
  const exactDiff = computeExactWholeSlipSwapDiffRange(
    replacedOrigLines,
    replacedLines,
    matches
  );
  if (!exactDiff.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    equalStakeCostYuan: totalSwapCost,
    executableSwapMultiple,
    executableSwapLines: allExecLines,
    exactRangeKnown: exactDiff.exactRangeKnown,
    minStateReturnDiff:
      exactDiff.exactRangeKnown && typeof exactDiff.minDiff === "number"
        ? Number(exactDiff.minDiff.toFixed(2))
        : undefined,
    maxStateReturnDiff:
      exactDiff.exactRangeKnown && typeof exactDiff.maxDiff === "number"
        ? Number(exactDiff.maxDiff.toFixed(2))
        : undefined,
  };
}

function computeBridgeCandidates(anchorMatch, anchorPicks, matches) {
  if (!anchorMatch || !Array.isArray(matches) || matches.length < 2) {
    return [];
  }
  if (
    Array.isArray(anchorPicks) &&
    anchorPicks.some(
      (ap) => !isPoolAllUpEligible(anchorMatch.pools?.[ap.poolCode])
    )
  ) {
    return [];
  }
  const others = matches.filter((m) => m && m.id !== anchorMatch.id);
  if (others.length === 0) return [];

  const timeOf = buildMatchTimelineResolver([anchorMatch, ...others]);
  const anchorMinutes = timeOf(anchorMatch);
  const anchorOpposite = resolveComplementaryLateHedge(
    anchorMatch,
    anchorPicks
  );

  const rawOptions = [];
  for (const m of others) {
    const mMinutes = timeOf(m);
    const diff = mMinutes - anchorMinutes;
    const absGap = Math.abs(diff);
    for (const poolCode of ["HAD", "HHAD"]) {
      const pool = m.pools?.[poolCode];
      if (!isPoolAllUpEligible(pool)) {
        continue;
      }
      for (const opt of pool.options) {
        const odds = Number(opt.odds);
        const fairProb = Number(opt.fairProb);
        if (!(odds > 1.01 && fairProb > 0.05)) continue;
        const singleLegReturnRate = Number((odds * fairProb).toFixed(4));
        const pseudoPick = {
          matchId: m.id,
          poolCode,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds,
          fairProb,
        };
        let canHedge = false;
        let hedgeOppositeDesc = "";
        if (absGap >= 135) {
          if (diff >= 135) {
            const winCheck = resolveStaggeredHedgeCutoffWindow(
              [anchorMatch, m],
              anchorMatch,
              m,
              timeOf
            );
            const lateRes = resolveComplementaryLateHedge(m, [pseudoPick]);
            if (
              lateRes.ok &&
              winCheck.postFinishWindowMinutes !== null &&
              winCheck.postFinishWindowMinutes >= 15
            ) {
              canHedge = true;
              hedgeOppositeDesc = lateRes.candidate.label;
            }
          } else if (diff <= -135 && anchorOpposite.ok) {
            const winCheck = resolveStaggeredHedgeCutoffWindow(
              [m, anchorMatch],
              m,
              anchorMatch,
              timeOf
            );
            if (
              winCheck.postFinishWindowMinutes !== null &&
              winCheck.postFinishWindowMinutes >= 15
            ) {
              canHedge = true;
              hedgeOppositeDesc = anchorOpposite.candidate.label;
            }
          }
        }
        rawOptions.push({
          match: m,
          poolCode,
          poolName: pool.name || (poolCode === "HAD" ? "胜平负" : "让球"),
          opt,
          odds,
          fairProb,
          singleLegReturnRate,
          absGap,
          diff,
          canHedge,
          hedgeOppositeDesc,
        });
      }
    }
  }

  if (rawOptions.length === 0) return [];

  const steadyPool = rawOptions.filter((c) => c.fairProb >= 0.48);
  const fallbackPool =
    steadyPool.length > 0
      ? steadyPool
      : rawOptions.filter((c) => c.fairProb >= 0.36);
  const vigCandidates = (
    fallbackPool.length > 0 ? fallbackPool : rawOptions
  ).sort(
    (a, b) =>
      b.singleLegReturnRate - a.singleLegReturnRate || b.fairProb - a.fairProb
  );

  const out = [];
  const topVig = vigCandidates[0];
  if (topVig) {
    const vigPct = Math.max(
      0,
      Number(((1 - topVig.singleLegReturnRate) * 100).toFixed(1))
    );
    out.push({
      kind: "lowest-vig",
      badge: "🛡️ 全盘最低抽水稳胆搭子",
      matchId: topVig.match.id,
      matchNumStr: topVig.match.matchNumStr,
      home: topVig.match.home,
      away: topVig.match.away,
      kickoff: topVig.match.kickoff,
      poolCode: topVig.poolCode,
      poolName: topVig.poolName,
      optionKey: topVig.opt.key,
      optionLabel: topVig.opt.label,
      odds: topVig.odds,
      fairProb: topVig.fairProb,
      singleLegReturnRate: topVig.singleLegReturnRate,
      gapMinutes: topVig.absGap > 0 ? topVig.absGap : null,
      reason: `单腿客观期望返还 ${(topVig.singleLegReturnRate * 100).toFixed(1)}%（过桥暗耗仅 ${vigPct}%），正路真率 ${(topVig.fairProb * 100).toFixed(0)}%，适合低损耗凑成合法 2串1`,
    });
  }

  const hedgePoolAll = rawOptions.filter((c) => c.canHedge);
  const hedgeSteady = hedgePoolAll.filter((c) => c.fairProb >= 0.4);
  const hedgeSorted = (
    hedgeSteady.length > 0 ? hedgeSteady : hedgePoolAll
  ).sort((a, b) => {
    const aDiffMatch = topVig && a.match.id !== topVig.match.id ? 1 : 0;
    const bDiffMatch = topVig && b.match.id !== topVig.match.id ? 1 : 0;
    if (bDiffMatch !== aDiffMatch) return bDiffMatch - aDiffMatch;
    const aLate = a.diff >= 135 ? 1 : 0;
    const bLate = b.diff >= 135 ? 1 : 0;
    if (bLate !== aLate) return bLate - aLate;
    return (
      b.singleLegReturnRate - a.singleLegReturnRate || b.fairProb - a.fairProb
    );
  });

  const topHedge = hedgeSorted.find(
    (c) =>
      !topVig ||
      c.match.id !== topVig.match.id ||
      c.poolCode !== topVig.poolCode ||
      c.opt.key !== topVig.opt.key
  );
  if (topHedge) {
    const hrs = Math.floor(topHedge.absGap / 60);
    const mins = topHedge.absGap % 60;
    const gapLabel =
      hrs > 0 ? `${hrs}小时${mins > 0 ? `${mins}分` : ""}` : `${mins}分钟`;
    out.push({
      kind: "staggered-hedge",
      badge: "⏰ 时间差单关锁利搭子",
      matchId: topHedge.match.id,
      matchNumStr: topHedge.match.matchNumStr,
      home: topHedge.match.home,
      away: topHedge.match.away,
      kickoff: topHedge.match.kickoff,
      poolCode: topHedge.poolCode,
      poolName: topHedge.poolName,
      optionKey: topHedge.opt.key,
      optionLabel: topHedge.opt.label,
      odds: topHedge.odds,
      fairProb: topHedge.fairProb,
      singleLegReturnRate: topHedge.singleLegReturnRate,
      gapMinutes: topHedge.absGap,
      reason:
        topHedge.diff >= 135
          ? `与主看场开球间隔 ${gapLabel}（≥135分钟安全线）且反向盘开放单关；首关红单后可单关补买反向盘提前锁利`
          : `早于主看场 ${gapLabel} 开球且主看场反向盘开放单关；早场红单后可在主看场开球前单关补单锁利`,
    });
  }

  return out;
}

/** 3. 审单细节小 Tips：早晚场时间差对冲锁利 + 串关拖油瓶体检 + 同义省钱替换 + 过桥配菜寻优 + 连黑预警 */
export function computeProOrderInsights(
  picks,
  report,
  matches,
  appliedPlan = null
) {
  const planPicks = extractPlanEffectivePicks(appliedPlan);
  const effectivePicks = planPicks && planPicks.length > 0 ? planPicks : picks;
  const matchIds = Array.from(new Set(effectivePicks.map((p) => p.matchId)));
  const pickedMatches = matchIds
    .map((id) => matches.find((m) => m.id === id))
    .filter(Boolean);

  let hedge = {
    available: false,
    hedgeMode: "unavailable",
    gapMinutes: 0,
    gapText: "同时间段开球",
    earlyMatchTitle: "",
    lateMatchTitle: "",
    earlyKickoff: "",
    lateKickoff: "",
    oppositeLabel: "",
    oppositeOdds: 1.85,
    hedgeCost: 0,
    lockedNetProfit: 0,
    reason: "需至少选择 2 场且开球时间间隔 ≥ 135 分钟（前场完场后可补单锁利）",
  };

  if (pickedMatches.length >= 2) {
    const isPureSinglePass =
      !Array.isArray(report?.activePassSizes) ||
      report.activePassSizes.length === 0 ||
      report.activePassSizes.every((s) => s === 1);

    if (report?.canCheckout !== true) {
      hedge.reason =
        report?.ruleBlockReason ||
        "当前选单不满足合法出票条件，暂无法启用早晚场时间差对冲锁利";
    } else if (isPureSinglePass) {
      hedge.reason =
        "当前为纯单关独立计奖模式，各场互不串连，无需早晚场补单对冲锁利";
    } else {
      const timeMinutesOf = buildMatchTimelineResolver(pickedMatches);

      const sortedByTime = [...pickedMatches].sort(
        (a, b) => timeMinutesOf(a) - timeMinutesOf(b)
      );
      const penultimate = sortedByTime[sortedByTime.length - 2];
      const late = sortedByTime[sortedByTime.length - 1];
      const cutoffWin = resolveStaggeredHedgeCutoffWindow(
        pickedMatches,
        penultimate,
        late,
        timeMinutesOf
      );
      const gap = cutoffWin.kickoffGapMinutes;
      const postFinishWindowMinutes = cutoffWin.postFinishWindowMinutes;
      const hrs = Math.floor(gap / 60);
      const mins = gap % 60;
      const gapText =
        gap <= 0
          ? "同时间段开球"
          : hrs > 0
            ? `${hrs}小时${mins > 0 ? `${mins}分` : ""}`
            : `${mins}分`;
      const formatWinLabel = (wMin) => {
        if (wMin === null || wMin === undefined) return "未知";
        if (wMin <= 0) return `${wMin}分钟`;
        const wh = Math.floor(wMin / 60);
        const wm = wMin % 60;
        return wh > 0 ? `${wh}小时${wm > 0 ? `${wm}分` : ""}` : `${wm}分钟`;
      };
      const postWinText = formatWinLabel(postFinishWindowMinutes);
      const earlyMatchTitle = `${penultimate.matchNumStr} ${penultimate.home}vs${penultimate.away}`;
      const lateMatchTitle = `${late.matchNumStr} ${late.home}vs${late.away}`;
      const windowMeta = {
        kickoffGapMinutes: gap,
        postFinishWindowMinutes,
        wallPostFinishMinutes:
          cutoffWin.wallPostFinishMinutes ?? postFinishWindowMinutes,
        earlyEstimatedFinishText: cutoffWin.earlyEstimatedFinishText,
        lateCutoffText: cutoffWin.lateCutoffText,
      };

      if (gap < 110) {
        hedge = {
          ...hedge,
          ...windowMeta,
          available: false,
          hedgeMode: "unavailable",
          gapMinutes: gap,
          gapText,
          earlyMatchTitle,
          lateMatchTitle,
          earlyKickoff: penultimate.kickoff,
          lateKickoff: late.kickoff,
          reason:
            sortedByTime.length >= 3
              ? `前序最晚场次 ${penultimate.matchNumStr}(${penultimate.kickoff}) 与末场 ${late.matchNumStr}(${late.kickoff}) 开球仅差 ${gap} 分钟（需 ≥ 135 分钟），前序场次未在末场开球前完场，无法单场锁利`
              : `两场开球仅间隔 ${gap} 分钟（需 ≥ 135 分钟），前场尚未完场，暂无法执行早晚场补单锁利`,
        };
      } else if (gap < 135) {
        hedge = {
          ...hedge,
          ...windowMeta,
          available: false,
          hedgeMode: "unavailable",
          gapMinutes: gap,
          gapText,
          earlyMatchTitle,
          lateMatchTitle,
          earlyKickoff: penultimate.kickoff,
          lateKickoff: late.kickoff,
          reason: `两场开球间隔 ${gap} 分钟处于临界区（实战安全间隔建议 ≥ 135 分钟），存在现代足球超长伤停补时与体彩店提前停售踏空风险，暂不建议裸奔等补单`,
        };
      } else {
        const planConsistency = validatePlanLateHedgeConsistency(
          appliedPlan,
          late
        );
        const latePicks =
          planConsistency.ok && planConsistency.latePicks
            ? planConsistency.latePicks
            : effectivePicks.filter((p) => p.matchId === late.id);
        const resolved = planConsistency.ok
          ? resolveComplementaryLateHedge(late, latePicks)
          : { ok: false, reason: planConsistency.reason };

        if (!resolved.ok) {
          hedge = {
            ...hedge,
            ...windowMeta,
            available: false,
            hedgeMode: "unavailable",
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            reason: resolved.reason,
          };
        } else if (postFinishWindowMinutes === null) {
          hedge = {
            ...hedge,
            ...windowMeta,
            available: false,
            hedgeMode: "unavailable",
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            reason: `两场开球间隔 ${gapText}，但缺少末场真实赛日/停售截止信息（可操作窗口未知），暂不放行早晚场补单锁利`,
          };
        } else if (postFinishWindowMinutes < 15) {
          const wallGap =
            cutoffWin.wallPostFinishMinutes ?? postFinishWindowMinutes;
          const crossedOvernightClosure =
            typeof wallGap === "number" && wallGap > postFinishWindowMinutes;
          hedge = {
            ...hedge,
            ...windowMeta,
            available: false,
            hedgeMode: "unavailable",
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            reason:
              postFinishWindowMinutes <= 0
                ? `两场开球间隔 ${gapText}，但早场(${penultimate.kickoff})预计 ${cutoffWin.earlyEstimatedFinishText} 完场，晚于末场前体彩法定停售截止 ${cutoffWin.lateCutoffText}（预计完场后可售窗口 ${postFinishWindowMinutes} 分钟 ≤ 0），体彩已休市无法赛后补单锁利`
                : crossedOvernightClosure
                  ? `两场开球间隔 ${gapText}，但早场(${penultimate.kickoff})预计 ${cutoffWin.earlyEstimatedFinishText} 完场后跨越夜间体彩休市（22:00/23:00 至次日 11:00），距末场停售截止 ${cutoffWin.lateCutoffText} 实际可售窗口仅剩 ${postFinishWindowMinutes} 分钟（需 ≥ 15 分钟安全操作窗），极易踏空停售`
                  : `两场开球间隔 ${gapText}，但早场(${penultimate.kickoff})预计 ${cutoffWin.earlyEstimatedFinishText} 完场距体彩停售截止 ${cutoffWin.lateCutoffText} 仅剩 ${postFinishWindowMinutes} 分钟（需 ≥ 15 分钟安全操作窗），伤停补时极易导致踏空停售`,
          };
        } else {
          const bestCand = resolved.candidate;
          const oppOdds = bestCand.odds;
          const allHitCombos = Array.isArray(report.combos)
            ? report.combos.filter(
                (c) =>
                  Array.isArray(c.legs) &&
                  new Set(c.legs.map((g) => g.matchId)).size ===
                    pickedMatches.length
              )
            : [];
          const minAllHitPayout =
            allHitCombos.length > 0
              ? Math.min(...allHitCombos.map((c) => c.totalPayout))
              : 0;
          const targetReturn =
            minAllHitPayout > 0
              ? minAllHitPayout
              : Math.max(report.minPayout, report.likelyRange?.[0] ?? 0);
          const split = solveDiscreteHedgeSplit(
            report.totalCost,
            targetReturn,
            late.home,
            bestCand,
            0
          );
          const { hedgeCost, lockedNetProfit, oppositeLabel, hedgeMode } =
            split;
          const lockedReturn = Number(
            (report.totalCost + hedgeCost + lockedNetProfit).toFixed(2)
          );
          const hedgeReason =
            hedgeMode === "lock-profit"
              ? sortedByTime.length >= 3
                ? `前 ${sortedByTime.length - 1} 场最晚(${penultimate.kickoff})与末场(${late.kickoff})开球间隔 ${gapText}，预计 ${cutoffWin.earlyEstimatedFinishText} 完场后距停售(${cutoffWin.lateCutoffText})仍有 ${postWinText} 可操作窗口！若前序 ${sortedByTime.length - 1} 关全红，单关补买 ¥${hedgeCost} 互补反向盘即可稳赚锁利 +¥${lockedNetProfit.toFixed(2)}！`
                : `两场开球间隔 ${gapText}，早场(${penultimate.kickoff})预计 ${cutoffWin.earlyEstimatedFinishText} 完场后距停售(${cutoffWin.lateCutoffText})有 ${postWinText} 可操作窗口！若第一关顺利红单，单关补买 ¥${hedgeCost} 互补反向盘即可稳赚锁利 +¥${lockedNetProfit.toFixed(2)}！`
              : hedgeMode === "break-even"
                ? `开球间隔 ${gapText}，预计完场后距停售(${cutoffWin.lateCutoffText})有 ${postWinText} 可操作窗口；单关补买 ¥${hedgeCost} 互补反向盘可零损拿回全部成本 ¥${lockedReturn.toFixed(2)}。`
                : `受两元偶数凑整与双盘抽水影响（开球间隔 ${gapText} · 完场后可操作窗 ${postWinText}），前序红单后单关补买 ¥${hedgeCost} 互补反向盘仅属减损止血：锁死少亏 -¥${Math.abs(lockedNetProfit).toFixed(2)}（拿回 ¥${lockedReturn.toFixed(2)}），无法正收益，请谨慎评估。`;

          hedge = {
            available: true,
            ...windowMeta,
            hedgeMode,
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            oppositeLabel,
            oppositeOdds: oppOdds,
            hedgeCost,
            lockedNetProfit,
            reason: hedgeReason,
          };
        }
      }
    }
  }

  let weakestLink = null;
  const rawPicksList = Array.isArray(picks) ? picks : [];
  const rawPickedMatchIds = Array.from(
    new Set(rawPicksList.map((p) => p.matchId))
  );
  if (!appliedPlan && rawPickedMatchIds.length >= 2 && report?.canCheckout) {
    const rawPickedMatches = rawPickedMatchIds
      .map((id) => matches.find((m) => m.id === id))
      .filter(Boolean);
    if (rawPickedMatches.length >= 2) {
      const perMatchProb = rawPickedMatches.map((m) => {
        const mp = rawPicksList.filter((p) => p.matchId === m.id);
        const sumP = Math.min(
          0.98,
          mp.reduce((a, x) => a + x.fairProb, 0)
        );
        return { m, sumP };
      });
      perMatchProb.sort((a, b) => a.sumP - b.sumP);
      const worst = perMatchProb[0];
      if (worst) {
        const remainingPicks = rawPicksList.filter(
          (p) => p.matchId !== worst.m.id
        );
        const nextPassSpec = report.activeComboCode
          ? { mode: "combo", comboCode: report.activeComboCode }
          : Array.isArray(report.activePassSizes) &&
              report.activePassSizes.length > 0
            ? { mode: "free", passSizes: report.activePassSizes }
            : { mode: "auto" };
        const afterRep = computeTruthReport(
          remainingPicks,
          report.multiple || 1,
          matches,
          nextPassSpec
        );
        if (
          afterRep.canCheckout === true &&
          afterRep.realProfitProb - report.realProfitProb >= 0.14
        ) {
          weakestLink = {
            matchId: worst.m.id,
            matchTitle: `${worst.m.matchNumStr} ${worst.m.home}vs${worst.m.away}`,
            currentProfitProb: report.realProfitProb,
            afterRemoveProfitProb: afterRep.realProfitProb,
            message: `【${worst.m.home}vs${worst.m.away}】单场命中率仅 ${(worst.sumP * 100).toFixed(0)}%，是拉低整单真赚钱率的最大瓶颈；砍掉它后真赚钱率立升至 ${(afterRep.realProfitProb * 100).toFixed(1)}%！`,
          };
        }
      }
    }
  }

  let activeSwapTip = null;
  const wholeSlipEquivalentSwaps = [];
  const isAutoSynthetic = Boolean(report?.syntheticAutoMounted);
  const swapSourcePicks = isAutoSynthetic ? rawPicksList : effectivePicks;
  const swapSourcePicksSig = swapSourcePicks
    .map(
      (p) =>
        `${String(p.matchId)}:${String(p.poolCode)}:${String(p.optionKey)}:${Number(p.odds).toFixed(4)}`
    )
    .sort()
    .join("|");
  const swapSourceTotalCost = Number(report?.totalCost) || 0;
  const swapSourceActivePassSig = Array.isArray(report?.activePassSizes)
    ? report.activePassSizes.join(",")
    : "";
  const swapSourceBankerSig = Array.isArray(report?.bankerMatchIds)
    ? [...report.bankerMatchIds].map(String).sort().join(",")
    : "";
  const swapSourceComboCode = String(report?.activeComboCode ?? "");
  const swapSourceActualLines =
    Array.isArray(appliedPlan?.lines) && appliedPlan.lines.length > 0
      ? appliedPlan.lines
      : Array.isArray(report?.tickets)
        ? report.tickets
        : [];
  const swapSourceActualLinesSig =
    "al1|" +
    swapSourceActualLines
      .map((ln) => {
        const lp = (ln.legs ?? [])
          .map(
            (g) =>
              `${String(g.matchId)}:${String(g.poolCode)}:${String(g.optionKey)}:${Number(g.odds).toFixed(4)}`
          )
          .sort()
          .join("+");
        const m = Math.max(
          1,
          Math.round(Number(ln.multiple ?? report?.multiple) || 1)
        );
        return `${lp}@${m}`;
      })
      .sort()
      .join("||");
  for (const m of pickedMatches) {
    const mpicks = swapSourcePicks.filter((p) => p.matchId === m.id);
    const isSingleMatchSlip =
      pickedMatches.length === 1 || Number(report?.matchCount) === 1;
    const arbitrages = computeEquivalentArbitrages(m, {
      includeCoarseOverSubPoolVigGap: true,
    });
    for (let aIdx = 0; aIdx < arbitrages.length; aIdx++) {
      const arb = arbitrages[aIdx];
      const hasAllWorse =
        arb.worsePicks.length > 0 &&
        arb.worsePicks.every((wp) =>
          mpicks.some(
            (p) => p.poolCode === wp.poolCode && p.optionKey === wp.optionKey
          )
        );
      const hasAllBetter =
        arb.betterPicks.length > 0 &&
        arb.betterPicks.every((bp) =>
          mpicks.some(
            (p) => p.poolCode === bp.poolCode && p.optionKey === bp.optionKey
          )
        );
      if (!hasAllWorse || hasAllBetter) continue;

      const execSwap = evaluateExecutableEqualStakeSwapOnSlip({
        match: m,
        arb,
        mpicks,
        isSingleMatchSlip,
        report,
        appliedPlan,
        matches,
      });
      if (!execSwap.ok) continue;

      const rangeSuffix =
        execSwap.exactRangeKnown &&
        typeof execSwap.minStateReturnDiff === "number" &&
        typeof execSwap.maxStateReturnDiff === "number"
          ? `（状态差 +${execSwap.minStateReturnDiff.toFixed(2)}~+${execSwap.maxStateReturnDiff.toFixed(2)} 元）`
          : "（已逐组核验全赛果逐态返奖不降）";
      const {
        minStateReturnDiff: _rawArbMinDiff,
        maxStateReturnDiff: _rawArbMaxDiff,
        ...cleanBaseArb
      } = arb;
      const verifiedSwapItem = {
        ...cleanBaseArb,
        isStatewiseNonDecreasing: true,
        equalStakeCostYuan: execSwap.equalStakeCostYuan,
        executableSwapCost: execSwap.equalStakeCostYuan,
        executableSwapMultiple: execSwap.executableSwapMultiple,
        executableSwapLines: execSwap.executableSwapLines,
        ...(execSwap.exactRangeKnown &&
        typeof execSwap.minStateReturnDiff === "number"
          ? { minStateReturnDiff: execSwap.minStateReturnDiff }
          : {}),
        ...(execSwap.exactRangeKnown &&
        typeof execSwap.maxStateReturnDiff === "number"
          ? { maxStateReturnDiff: execSwap.maxStateReturnDiff }
          : {}),
        sourcePicksSig: swapSourcePicksSig,
        sourceTotalCost: swapSourceTotalCost,
        sourceActivePassSig: swapSourceActivePassSig,
        sourceBankerSig: swapSourceBankerSig,
        sourceComboCode: swapSourceComboCode,
        sourceActualLinesSig: swapSourceActualLinesSig,
        detail: `100%事件同义！选【${arb.betterChoice}】替换【${arb.worseChoice}】，¥${execSwap.equalStakeCostYuan} 同本金配平下全赛果返奖不降${rangeSuffix}。`,
      };
      wholeSlipEquivalentSwaps.push(verifiedSwapItem);
      if (!activeSwapTip) {
        activeSwapTip = verifiedSwapItem;
      }
    }
  }

  const bridgeCandidates =
    pickedMatches.length === 1 &&
    (report?.canCheckout === false || isAutoSynthetic) &&
    !report?.hasSameMatchCrossPoolConflict
      ? computeBridgeCandidates(
          pickedMatches[0],
          (isAutoSynthetic ? rawPicksList : effectivePicks).filter(
            (p) => p.matchId === pickedMatches[0].id
          ),
          matches
        )
      : [];

  const isEmptyReport =
    Boolean(report?.isEmptySlip) || !(Number(report?.totalCost) > 0);
  const nonLossProb = isEmptyReport
    ? 0
    : Math.min(
        1,
        Math.max(
          0,
          Number(report.objectiveProfitProb ?? report.realProfitProb ?? 0) || 0
        )
      );
  const fiveLossStreakProb = isEmptyReport ? 0 : Math.pow(1 - nonLossProb, 5);
  const evRate =
    Number(report.objectiveEVRate ?? report.expectedValueRate) || 0;
  // Kelly Criterion discipline (ADR-0010 / Spec 0009): negative-EV bets have optimal Kelly f* = 0%;
  // cap recreational budget exposure strictly at <= 2% so high-hit-rate favorites never induce ruinous 12% stakes.
  const recommendedBankrollPct =
    evRate <= 0
      ? nonLossProb >= 0.4
        ? 2
        : 1
      : Math.min(
          5,
          Math.max(
            1,
            Math.round(
              0.25 *
                (evRate /
                  Math.max(0.25, (Number(report.effectiveOdds) || 2) - 1)) *
                100
            )
          )
        );

  return {
    hedge,
    weakestLink,
    fiveLossStreakProb,
    recommendedBankrollPct,
    activeSwapTip,
    wholeSlipEquivalentSwaps,
    bridgeCandidates,
  };
}

/** 4. 三模智能奖金优化深模块（绑定在审票 baseLines + 完整分位向量等价类 + 非单调保本整数证书 + 精确三模目标） */
export function optimizeBonusPlan(
  manualReport,
  matches,
  optMode,
  options = {}
) {
  const cleanOptMode =
    optMode === "hot-first" || optMode === "cold-first" ? optMode : "equal";
  const upgradeToBreakeven = Boolean(options?.upgradeToBreakeven);
  const consolidateTickets = options?.consolidateTickets !== false;
  const allowPeakTradeoff = Boolean(options?.allowPeakTradeoff);
  const allowCapEvTradeoff = Boolean(options?.allowCapEvTradeoff);

  const matchMap = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m?.id) matchMap.set(m.id, m);
    }
  }

  const hasExplicitBaseLines =
    Array.isArray(options?.baseLines) &&
    options.baseLines.length > 0 &&
    options.baseLines.length <= 2048 &&
    options.baseLines.every(
      (ln) => ln && Array.isArray(ln.legs) && ln.legs.length >= 1
    );

  let sorted;
  let baseInitMults;
  let strictBaseCost;

  if (hasExplicitBaseLines) {
    sorted = options.baseLines.map((ln, idx) => {
      const m0 = Math.max(
        1,
        Math.min(999, Math.round(Number(ln.multiple) || 1))
      );
      const reLegs = ln.legs.map((lg) => {
        const fm = matchMap.get(lg.matchId);
        const pool = fm?.pools?.[lg.poolCode];
        const authOpt = pool?.options?.find(
          (o) => o.key === lg.optionKey || o.label === lg.optionLabel
        );
        const odds =
          lg.isVoid === true || Math.abs(Number(lg.odds) - 1.0) <= 1e-9
            ? 1.0
            : authOpt && Number(authOpt.odds) > 0
              ? Number(authOpt.odds)
              : clampSandboxCustomOdds(lg.odds);
        const fairProb =
          authOpt && Number(authOpt.fairProb) > 0
            ? Number(authOpt.fairProb)
            : Number(lg.fairProb) || 0.25;
        return {
          ...lg,
          kickoff: fm?.kickoff ?? lg.kickoff ?? "21:00",
          poolName: pool?.name ?? lg.poolName ?? lg.poolCode,
          odds,
          fairProb,
        };
      });
      const st = computeLineStatutoryPayout(reLegs, m0);
      const prob = reLegs.reduce(
        (acc, g) =>
          acc * (Math.abs(Number(g.odds) - 1.0) <= 1e-9 ? 1 : g.fairProb),
        1
      );
      return {
        id: ln.id || `base-${idx}`,
        legs: reLegs,
        multiple: m0,
        unitPayout: st.unitPayout,
        cappedClipped: st.cappedClipped,
        prob,
      };
    });
    baseInitMults = sorted.map((r) => r.multiple);
    const sumInitCost = baseInitMults.reduce((a, m) => a + m * 2, 0);
    strictBaseCost = Math.max(sorted.length * 2, sumInitCost);
  } else {
    const baseRows =
      Array.isArray(manualReport?.tickets) && manualReport.tickets.length > 0
        ? manualReport.tickets
        : (manualReport?.combos ?? []);
    if (!manualReport || baseRows.length === 0 || baseRows.length > 2048) {
      return null;
    }
    sorted = [...baseRows].sort((a, b) => b.prob - a.prob);
    const fallbackM = Math.max(
      1,
      Math.min(999, Math.round(Number(manualReport.multiple) || 1))
    );
    baseInitMults = sorted.map((r) =>
      Math.max(1, Math.min(999, Math.round(Number(r.multiple) || fallbackM)))
    );
    strictBaseCost = Math.max(
      sorted.length * 2,
      Math.round((Number(manualReport.totalCost) || sorted.length * 2) / 2) * 2
    );
  }

  const k = sorted.length;
  if (k === 0 || k > 2048) return null;

  const rawUnits = sorted.map((c) =>
    bankerRoundParlayUnitPayout((c.legs ?? []).map((p) => Number(p.odds)))
  );
  const cappedUnits = sorted.map((c, idx) => {
    const legOdds = (c.legs ?? []).map((p) => Number(p.odds));
    const cap = statutorySingleBetCap(
      legOdds.length > 0
        ? effectiveNonVoidLegCount(legOdds)
        : (manualReport?.matchCount ?? 1)
    );
    const raw = rawUnits[idx] > 0 ? rawUnits[idx] : Number(c.unitPayout) || 2;
    return Math.min(cap, raw);
  });
  const unitCentsArr = Float64Array.from(cappedUnits, (u) =>
    Math.max(0, Math.round(u * 100))
  );
  const isCapClipped = sorted.map((c, idx) => {
    const legOdds = (c.legs ?? []).map((p) => Number(p.odds));
    const effLegs =
      legOdds.length > 0
        ? effectiveNonVoidLegCount(legOdds)
        : (manualReport?.matchCount ?? 1);
    return rawUnits[idx] > statutorySingleBetCap(effLegs);
  });
  const hasUnclippedLine = isCapClipped.some((clipped) => !clipped);

  // Build objective hit-matrix & complete unit cent-payout vector buckets s ∈ S_+
  const { atomicMap: evalAtomicMap, objectiveAtomicMap } =
    resolveMatchAtomicContexts(
      sorted.flatMap((r) => r.legs ?? []),
      matches,
      { mode: "plan-legs" }
    );

  const skipFullBucketMatrix = k > 512 && !upgradeToBreakeven;
  let objHitMatrix = null;
  if (
    !hasExplicitBaseLines &&
    manualReport?._reusableHitMatrix?.isBaselineAtomic &&
    manualReport._reusableHitMatrix.K === k
  ) {
    objHitMatrix = manualReport._reusableHitMatrix;
  } else if (k <= 512 && !skipFullBucketMatrix) {
    const probeRows = sorted.map((r, idx) => ({
      id: `probe-${idx}`,
      desc: "",
      legs: r.legs,
      multiple: 1,
      cost: 2,
      unitPayout: cappedUnits[idx],
      totalPayout: cappedUnits[idx],
      cappedClipped: 0,
    }));
    const probeEval = evaluateTicketsOnQuotientSpace(
      probeRows,
      k * 2,
      matches,
      objectiveAtomicMap,
      {
        metricsOnly: true,
        captureHitMatrix: true,
        maxCaptureLines: 512,
        isBaselineAtomic: true,
      }
    );
    objHitMatrix = probeEval.hitMatrix ?? null;
  }

  // Map raw hitMatrix indices to `sorted` indices & fold identical complete cent-vectors `a_{s,·}`
  const bucketsCents = [];
  const bucketProbs = [];
  let objZeroProb = Number(manualReport?.zeroPayoutProb ?? 0);

  let builtFromHitMatrix = false;
  if (
    !skipFullBucketMatrix &&
    objHitMatrix &&
    Array.isArray(objHitMatrix.bucketHits) &&
    objHitMatrix.bucketHits.length > 0
  ) {
    const origToSorted = new Int16Array(k).fill(-1);
    let validMap = true;
    const cursorBySig = new Map();
    for (let idx = 0; idx < k; idx++) {
      const sig = canonicalTicketLegSig(sorted[idx].legs);
      if (objHitMatrix.sigToOrigIndices instanceof Map) {
        const arr = objHitMatrix.sigToOrigIndices.get(sig);
        const cur = cursorBySig.get(sig) ?? 0;
        if (!arr || cur >= arr.length || origToSorted[arr[cur]] !== -1) {
          validMap = false;
          break;
        }
        cursorBySig.set(sig, cur + 1);
        origToSorted[arr[cur]] = idx;
      } else {
        const origK = objHitMatrix.sigToOrigIdx?.get(sig);
        if (origK === undefined || origToSorted[origK] !== -1) {
          validMap = false;
          break;
        }
        origToSorted[origK] = idx;
      }
    }
    if (validMap) {
      const vecMap = new Map();
      for (let b = 0; b < objHitMatrix.bucketHits.length; b++) {
        const p = Number(objHitMatrix.bucketProbs[b]) || 0;
        if (!(p > 0)) continue;
        const hits = objHitMatrix.bucketHits[b];
        const row = new Float64Array(k);
        for (let j = 0; j < hits.length; j++) {
          const sIdx = origToSorted[hits[j]];
          if (sIdx >= 0) row[sIdx] = unitCentsArr[sIdx];
        }
        const sig = k <= 64 ? Array.from(row).join(",") : `b_${b}`;
        const prev = vecMap.get(sig);
        if (prev) {
          prev.prob += p;
        } else {
          vecMap.set(sig, { row, prob: p });
        }
      }
      for (const item of vecMap.values()) {
        bucketsCents.push(item.row);
        bucketProbs.push(item.prob);
      }
      objZeroProb = Math.max(
        0,
        Number(
          objHitMatrix.zeroPayoutProb ??
            1 - bucketProbs.reduce((a, b) => a + b, 0)
        )
      );
      builtFromHitMatrix = bucketsCents.length > 0;
    }
  }

  if (!builtFromHitMatrix && !skipFullBucketMatrix) {
    let sumP = 0;
    for (let i = 0; i < k; i++) {
      const row = new Float64Array(k);
      row[i] = unitCentsArr[i];
      const p = Math.max(1e-9, Number(sorted[i].prob) || 1 / k);
      bucketsCents.push(row);
      bucketProbs.push(p);
      sumP += p;
    }
    if (sumP > 1) {
      for (let i = 0; i < bucketProbs.length; i++) bucketProbs[i] /= sumP;
      objZeroProb = 0;
    } else {
      objZeroProb = Math.max(0, 1 - sumP);
    }
  }

  const sourceComboCode =
    options?.activeComboCode !== undefined
      ? options.activeComboCode
      : (manualReport?.activeComboCode ?? null);
  const allowUnbundleCombo = Boolean(options?.allowUnbundleCombo);
  const lockedFixedCombo = Boolean(sourceComboCode) && !allowUnbundleCombo;
  const preserveExactBaseMultiples =
    Boolean(options?.preserveExactBaseMultiples) &&
    hasExplicitBaseLines &&
    sorted.length > 0;

  // Initial requested stake before optional breakeven upgrade
  const requestedCost = preserveExactBaseMultiples
    ? strictBaseCost
    : typeof options?.targetBudgetCost === "number" &&
        Number.isFinite(options.targetBudgetCost) &&
        options.targetBudgetCost >= k * 2 &&
        options.targetBudgetCost <= 20_000
      ? Math.max(k * 2, Math.round(options.targetBudgetCost / 2) * 2)
      : strictBaseCost;
  let totalTickets = preserveExactBaseMultiples
    ? baseInitMults.reduce((a, b) => a + b, 0)
    : Math.min(10_000, Math.max(k, Math.floor(requestedCost / 2)));

  // Scale reference baseline m^0 to match totalTickets if needed
  const buildRefMultsAtN = (targetN) => {
    const sum0 = baseInitMults.reduce((a, b) => a + b, 0);
    if (sum0 === targetN) return [...baseInitMults];
    const scaled = baseInitMults.map((m, idx) =>
      isCapClipped[idx] && hasUnclippedLine
        ? 1
        : Math.max(
            1,
            Math.min(999, Math.floor((m * targetN) / Math.max(1, sum0)))
          )
    );
    let curS = scaled.reduce((a, b) => a + b, 0);
    while (curS < targetN) {
      let pick = -1;
      for (let i = 0; i < k; i++) {
        if (scaled[i] >= 999) continue;
        if (isCapClipped[i] && hasUnclippedLine) continue;
        pick = i;
        break;
      }
      if (pick < 0) pick = scaled.findIndex((x) => x < 999);
      if (pick < 0) break;
      scaled[pick] += 1;
      curS += 1;
    }
    while (curS > targetN) {
      let pick = -1;
      for (let i = k - 1; i >= 0; i--) {
        if (scaled[i] > 1) {
          pick = i;
          break;
        }
      }
      if (pick < 0) break;
      scaled[pick] -= 1;
      curS -= 1;
    }
    return scaled;
  };

  let mRef = preserveExactBaseMultiples
    ? [...baseInitMults]
    : buildRefMultsAtN(totalTickets);
  const certTimeBudgetMs = k > 64 ? 6 : 12;
  let certRes =
    k <= 512 && !skipFullBucketMatrix
      ? lockedFixedCombo
        ? certifyFixedUniformComboBreakeven(bucketsCents, k, totalTickets, {
            zeroPayoutProb: objZeroProb,
            baseMultiples: baseInitMults,
          })
        : certifyAndSolveJointBreakeven(bucketsCents, k, totalTickets, {
            timeBudgetMs: certTimeBudgetMs,
            maxScanNotes: k > 64 ? 2000 : 10_000,
            zeroPayoutProb: objZeroProb,
            baseMultiples: mRef,
          })
      : {
          cert: {
            minFeasibleBudget: null,
            isCurrentFeasible: "unknown",
            nextFeasibleBudget: null,
            proofStatus: "time-budget-unproved",
            conditionalFloorAtCurrent: null,
            zeroPayoutProb: objZeroProb,
          },
          feasibleMultsAtCurrent: null,
          minFeasibleMults: null,
          nextFeasibleMults: null,
        };

  if (upgradeToBreakeven && !lockedFixedCombo && !preserveExactBaseMultiples) {
    const upgBudget =
      certRes.cert.isCurrentFeasible === "certified-feasible"
        ? totalTickets * 2
        : typeof certRes.cert.nextFeasibleBudget === "number" &&
            certRes.cert.nextFeasibleBudget > totalTickets * 2
          ? Math.min(20_000, certRes.cert.nextFeasibleBudget)
          : typeof manualReport?.breakevenUpgradeCost === "number" &&
              manualReport.breakevenUpgradeCost > totalTickets * 2
            ? Math.min(20_000, manualReport.breakevenUpgradeCost)
            : totalTickets * 2;
    const nextNotes = Math.max(k, Math.floor(upgBudget / 2));
    if (nextNotes !== totalTickets) {
      totalTickets = nextNotes;
      mRef = buildRefMultsAtN(totalTickets);
      if (k <= 512) {
        certRes = certifyAndSolveJointBreakeven(bucketsCents, k, totalTickets, {
          timeBudgetMs: certTimeBudgetMs,
          maxScanNotes: k > 64 ? 2000 : 10_000,
          zeroPayoutProb: objZeroProb,
          baseMultiples: mRef,
        });
      }
    }
  }

  let targetStake = totalTickets * 2;
  let targetStakeCents = targetStake * 100;
  const S = bucketsCents.length;
  const winProbSum = Math.max(
    1e-12,
    bucketProbs.reduce((a, b) => a + b, 0)
  );

  const computePayVec = (mVec) => {
    const pay = new Float64Array(S);
    for (let s = 0; s < S; s++) {
      const row = bucketsCents[s];
      let acc = 0;
      for (let i = 0; i < k; i++) acc += row[i] * mVec[i];
      pay[s] = acc;
    }
    return pay;
  };

  const computeL1Dist = (mVec) => {
    let d = 0;
    for (let i = 0; i < k; i++) d += Math.abs(mVec[i] - mRef[i]);
    return d;
  };

  const refPayCents = computePayVec(mRef);
  let refExpR = 0;
  let refLPart = 0;
  for (let s = 0; s < S; s++) {
    const r = refPayCents[s] / targetStakeCents;
    refExpR += bucketProbs[s] * r;
    if (refPayCents[s] < targetStakeCents) {
      refLPart += bucketProbs[s] * Math.max(0, 1 - r);
    }
  }

  let mults = new Array(k).fill(1);
  let bonusNoOpReason = null;
  let isExactOptimal = false;
  let coldPeakTradeoffNoted = false;
  let coldCredibleZoneEmpty = false;
  let coldCapGuardApplied = false;
  let coldCapGuardBlockedByEv = false;
  let coldCapCapacityFull = false;
  let coldCapResidualMaxMult = 1;
  let capGuardAlternative = null;
  let requiresComboUnbundleConfirm = false;

  if (lockedFixedCombo) {
    requiresComboUnbundleConfirm = true;
    const baseUniformM = Math.max(
      1,
      Math.min(999, Math.round(Number(baseInitMults[0]) || 1))
    );
    const exactScaledM =
      totalTickets >= k && totalTickets % k === 0
        ? Math.max(1, Math.min(999, Math.floor(totalTickets / k)))
        : baseUniformM;
    mults = new Array(k).fill(exactScaledM);
    totalTickets = k * exactScaledM;
    targetStake = totalTickets * 2;
    targetStakeCents = targetStake * 100;
    certRes =
      k <= 512 && !skipFullBucketMatrix
        ? certifyFixedUniformComboBreakeven(bucketsCents, k, totalTickets, {
            zeroPayoutProb: objZeroProb,
            baseMultiples: new Array(k).fill(1),
          })
        : !hasExplicitBaseLines &&
            manualReport?.breakevenCert?.proofStatus === "certified" &&
            exactScaledM ===
              Math.max(1, Math.round(Number(manualReport.multiple) || 1))
          ? {
              ...certRes,
              cert: { ...manualReport.breakevenCert },
            }
          : certRes;
    bonusNoOpReason =
      "当前为官方固定多串组合（内部子注等倍联动）；如需拆解为独立自由串关逐注分倍，请确认解绑为自由过关";
  } else if (preserveExactBaseMultiples) {
    mults = [...baseInitMults];
    totalTickets = mults.reduce((a, b) => a + b, 0);
    targetStake = totalTickets * 2;
    targetStakeCents = targetStake * 100;
    bonusNoOpReason = "已严格锁定原子替代与授权实票原始倍数，未重排各注权重。";
  } else if (k === 1) {
    mults = [Math.max(1, Math.min(999, totalTickets))];
    if (totalTickets === 1) {
      bonusNoOpReason = "当前仅 1 注单挑且为 1 倍（¥2），无分倍调整空间。";
    }
  } else if (totalTickets === k) {
    mults = new Array(k).fill(1);
    bonusNoOpReason = `当前总投入 ¥${targetStake} 恰好对应 ${k} 注 × 1倍（0 元机动余量，每注最低 1 倍不可再拆），需上调倍数或预算后方可重配各注权重。`;
  } else if (skipFullBucketMatrix || S === 0) {
    const dutchItems = cappedUnits.map((u, idx) => ({
      unitPayout: u,
      prob: sorted[idx].prob || 0,
      isCapClipped: isCapClipped[idx],
    }));
    const fullAlloc = allocateInverseOddsDutching(dutchItems, totalTickets, {
      validateAllNonLoss: false,
      stage2Mode:
        cleanOptMode === "hot-first"
          ? "hot-first"
          : cleanOptMode === "cold-first"
            ? "cold-first"
            : "water-fill",
    });
    if (fullAlloc) {
      mults = fullAlloc.mults;
    } else {
      mults = new Array(k).fill(1);
      waterFillInverseOddsNotes(mults, dutchItems, totalTickets - k);
    }
  } else {
    const confirmedCapGuardSig =
      typeof options?.confirmedCapGuardSig === "string"
        ? options.confirmedCapGuardSig.trim()
        : "";
    const buildCapGuardBindingSig = (
      origM,
      altM,
      evDiffVal = 0,
      lpDiffVal = 0
    ) => {
      const parts = sorted.map((r, idx) => {
        const legSig = (r.legs ?? [])
          .map(
            (g) =>
              `${String(g.matchId)}:${String(g.poolCode)}:${String(g.optionKey)}@${Number(g.odds).toFixed(4)}:${g.poolCode === "HHAD" ? String(g.goalLine ?? "") : ""}`
          )
          .sort()
          .join("&");
        return `${legSig}#${origM[idx]}->${altM[idx]}`;
      });
      return `cg1|c=${targetStake},evd=${Number(evDiffVal).toFixed(6)},lpd=${Number(lpDiffVal).toFixed(6)}|${parts.join(";")}`;
    };

    const isFeasibleFN =
      certRes.cert.isCurrentFeasible === "certified-feasible" &&
      Array.isArray(certRes.feasibleMultsAtCurrent);

    const colBuckets = Array.from({ length: k }, () => []);
    const colCents = Array.from({ length: k }, () => []);
    for (let s = 0; s < S; s++) {
      const row = bucketsCents[s];
      for (let i = 0; i < k; i++) {
        const v = row[i];
        if (v > 0) {
          colBuckets[i].push(s);
          colCents[i].push(v);
        }
      }
    }
    const applyColDelta = (payVec, colIdx, signedDelta) => {
      const bArr = colBuckets[colIdx];
      const cArr = colCents[colIdx];
      for (let u = 0; u < bArr.length; u++) {
        payVec[bArr[u]] += signedDelta * cArr[u];
      }
    };

    const dutchItems = cappedUnits.map((u, idx) => ({
      unitPayout: u,
      prob: sorted[idx].prob || 0,
      isCapClipped: isCapClipped[idx],
    }));
    const warmDutch = allocateInverseOddsDutching(dutchItems, totalTickets, {
      validateAllNonLoss: false,
      stage2Mode: "water-fill",
    });
    let warmEqual = isFeasibleFN
      ? [...certRes.feasibleMultsAtCurrent]
      : warmDutch
        ? [...warmDutch.mults]
        : (() => {
            const arr = new Array(k).fill(1);
            waterFillInverseOddsNotes(arr, dutchItems, totalTickets - k);
            return arr;
          })();
    if (hasUnclippedLine) {
      let stripped = 0;
      for (let i = 0; i < k; i++) {
        if (isCapClipped[i] && warmEqual[i] > 1) {
          stripped += warmEqual[i] - 1;
          warmEqual[i] = 1;
        }
      }
      if (stripped > 0) {
        waterFillInverseOddsNotes(warmEqual, dutchItems, stripped);
      }
    }

    const compareLexTuple = (a, b) => {
      if (!a && !b) return 0;
      if (!a) return -1;
      if (!b) return 1;
      for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        if (Math.abs(diff) > 1e-11) return diff > 0 ? 1 : -1;
      }
      return 0;
    };

    const countNonNegCompositions = (sumVal, parts, limit = 30_000) => {
      if (sumVal < 0) return limit + 1;
      if (parts <= 1) return sumVal === 0 ? 1 : limit + 1;
      const total = sumVal + parts - 1;
      const r = Math.min(parts - 1, sumVal);
      let c = 1;
      for (let i = 1; i <= r; i++) {
        c = Math.floor((c * (total - r + i)) / i);
        if (c > limit) return limit + 1;
      }
      return c;
    };
    const boundedCompositionsUpperBound =
      totalTickets < k || totalTickets > 999 * k
        ? 30_001
        : k <= 1
          ? 1
          : Math.min(
              countNonNegCompositions(totalTickets - k, k, 30_000),
              countNonNegCompositions(999 * k - totalTickets, k, 30_000)
            );
    const canEnumerateExact = boundedCompositionsUpperBound <= 30_000;

    const enumerateExactCompositions = (scoreFn) => {
      const workM = new Array(k).fill(1);
      const workPay = computePayVec(workM);
      let bestM = [...mRef];
      let bestPay = computePayVec(bestM);
      let bestScore = scoreFn(bestPay, bestM);
      const visit = (idx, remExtra) => {
        if (idx === k - 1) {
          if (remExtra > 998) return;
          if (remExtra > 0) {
            workM[idx] = 1 + remExtra;
            applyColDelta(workPay, idx, remExtra);
          }
          const sc = scoreFn(workPay, workM);
          if (sc !== null && compareLexTuple(sc, bestScore) > 0) {
            bestScore = sc;
            bestM = [...workM];
            bestPay = Float64Array.from(workPay);
          }
          if (remExtra > 0) {
            applyColDelta(workPay, idx, -remExtra);
            workM[idx] = 1;
          }
          return;
        }
        const remPartsAfter = k - 1 - idx;
        const minExtraHere = Math.max(0, remExtra - 998 * remPartsAfter);
        const maxExtraHere = Math.min(998, remExtra);
        if (minExtraHere > maxExtraHere) return;
        if (minExtraHere > 0) {
          workM[idx] = 1 + minExtraHere;
          applyColDelta(workPay, idx, minExtraHere);
        }
        for (let ex = minExtraHere; ex <= maxExtraHere; ex++) {
          visit(idx + 1, remExtra - ex);
          if (ex < maxExtraHere) {
            workM[idx] += 1;
            applyColDelta(workPay, idx, 1);
          }
        }
        if (maxExtraHere > 0) {
          applyColDelta(workPay, idx, -maxExtraHere);
          workM[idx] = 1;
        }
      };
      visit(0, totalTickets - k);
      return { mults: bestM, score: bestScore, pay: bestPay };
    };

    const runPairwiseAscent = (initM, scoreFn) => {
      const curM = [...initM];
      const curPay = computePayVec(curM);
      let curScore = scoreFn(curPay, curM);
      const steps = totalTickets - k >= 24 ? [8, 4, 2, 1] : [2, 1];
      const maxPasses = k > 128 ? 16 : 40;

      for (let sIdx = 0; sIdx < steps.length; sIdx++) {
        const delta = steps[sIdx];
        for (let pass = 0; pass < maxPasses; pass++) {
          let bestAdd = -1;
          let bestSub = -1;
          let bestNextScore = curScore;

          for (let add = 0; add < k; add++) {
            if (curM[add] + delta > 999) continue;
            if (isCapClipped[add] && hasUnclippedLine) continue;
            for (let sub = 0; sub < k; sub++) {
              if (add === sub || curM[sub] - delta < 1) continue;
              curM[add] += delta;
              curM[sub] -= delta;
              applyColDelta(curPay, add, delta);
              applyColDelta(curPay, sub, -delta);
              const candScore = scoreFn(curPay, curM);
              if (
                candScore !== null &&
                compareLexTuple(candScore, bestNextScore) > 0
              ) {
                bestNextScore = candScore;
                bestAdd = add;
                bestSub = sub;
              }
              applyColDelta(curPay, add, -delta);
              applyColDelta(curPay, sub, delta);
              curM[add] -= delta;
              curM[sub] += delta;
            }
          }

          if (bestAdd >= 0 && bestSub >= 0) {
            curM[bestAdd] += delta;
            curM[bestSub] -= delta;
            applyColDelta(curPay, bestAdd, delta);
            applyColDelta(curPay, bestSub, -delta);
            curScore = bestNextScore;
          } else {
            break;
          }
        }
      }
      return { mults: curM, score: curScore, pay: curPay };
    };

    const evalEqualScore = (payVec, mVec) => {
      let minC = Infinity;
      let maxC = 0;
      let condMin1Acc = 0;
      let strictProbAcc = 0;
      for (let s = 0; s < S; s++) {
        const pc = payVec[s];
        if (pc < minC) minC = pc;
        if (pc > maxC) maxC = pc;
        const r = pc / targetStakeCents;
        condMin1Acc += bucketProbs[s] * Math.min(1, r);
        if (pc > targetStakeCents) strictProbAcc += bucketProbs[s];
      }
      return [
        minC / targetStakeCents,
        condMin1Acc / winProbSum,
        strictProbAcc,
        -(maxC - minC) / targetStakeCents,
        -computeL1Dist(mVec),
      ];
    };

    const equalBest = (() => {
      if (canEnumerateExact) {
        return enumerateExactCompositions(evalEqualScore);
      }
      const r1 = runPairwiseAscent(warmEqual, evalEqualScore);
      const r2 = runPairwiseAscent(mRef, evalEqualScore);
      return compareLexTuple(r2.score, r1.score) > 0 ? r2 : r1;
    })();

    const certifiedFeasibleSeed = equalBest.pay.every(
      (pc) => pc >= targetStakeCents
    )
      ? equalBest.mults
      : isFeasibleFN
        ? certRes.feasibleMultsAtCurrent
        : null;
    const hasFeasibleDomain = Array.isArray(certifiedFeasibleSeed);

    if (cleanOptMode === "equal") {
      mults = equalBest.mults;
      isExactOptimal = canEnumerateExact;
    } else if (cleanOptMode === "hot-first") {
      const rankedProbs = [...bucketProbs].sort((a, b) => b - a);
      const cutProb =
        rankedProbs.length >= 2 ? rankedProbs[1] : (rankedProbs[0] ?? 0);
      const hotBucketIndices = [];
      for (let s = 0; s < S; s++) {
        if (bucketProbs[s] >= cutProb - 1e-12) hotBucketIndices.push(s);
      }

      if (hasFeasibleDomain) {
        const evalHotFeasible = (payVec, mVec) => {
          for (let s = 0; s < S; s++) {
            if (payVec[s] < targetStakeCents) return null;
          }
          let hotGain = 0;
          for (let h = 0; h < hotBucketIndices.length; h++) {
            const s = hotBucketIndices[h];
            hotGain += bucketProbs[s] * (payVec[s] / targetStakeCents - 1);
          }
          let pPlus = 0;
          for (let s = 0; s < S; s++) {
            if (payVec[s] > targetStakeCents) pPlus += bucketProbs[s];
          }
          return [hotGain, pPlus, -computeL1Dist(mVec)];
        };
        if (canEnumerateExact) {
          mults = enumerateExactCompositions(evalHotFeasible).mults;
          isExactOptimal = true;
        } else {
          mults = runPairwiseAscent(
            certifiedFeasibleSeed,
            evalHotFeasible
          ).mults;
        }
      } else {
        const maxAllowedLPart = refLPart + 0.02 + 1e-9;
        const evalHotInfeasible = (payVec, mVec) => {
          let lPart = 0;
          let pPlus = 0;
          let pGe80 = 0;
          let expCap3 = 0;
          for (let s = 0; s < S; s++) {
            const pc = payVec[s];
            const ps = bucketProbs[s];
            const r = pc / targetStakeCents;
            if (pc < targetStakeCents) lPart += ps * Math.max(0, 1 - r);
            if (pc > targetStakeCents) pPlus += ps;
            if (r >= 0.8 - 1e-9) pGe80 += ps;
            expCap3 += ps * Math.min(r, 3.0);
          }
          if (lPart > maxAllowedLPart) return null;
          const jVal = 0.6 * pPlus + 0.25 * pGe80 + 0.15 * expCap3;
          return [jVal, -computeL1Dist(mVec)];
        };

        if (canEnumerateExact) {
          const exHot = enumerateExactCompositions(evalHotInfeasible);
          mults = exHot.score !== null ? exHot.mults : equalBest.mults;
          isExactOptimal = exHot.score !== null;
        } else {
          const hotSeed = new Array(k).fill(1);
          let remSeed = totalTickets - k;
          const hotTicketOrder = Array.from(
            { length: k },
            (_, idx) => idx
          ).sort((a, b) => (sorted[b].prob || 0) - (sorted[a].prob || 0));
          for (let oi = 0; oi < hotTicketOrder.length && remSeed > 0; oi++) {
            const tIdx = hotTicketOrder[oi];
            if (isCapClipped[tIdx] && hasUnclippedLine) continue;
            const req = Math.max(
              1,
              Math.ceil(
                (targetStakeCents + 1) / Math.max(50, unitCentsArr[tIdx])
              )
            );
            const need = req - hotSeed[tIdx];
            if (need > 0 && need <= remSeed && hotSeed[tIdx] + need <= 999) {
              hotSeed[tIdx] += need;
              remSeed -= need;
            }
          }
          if (remSeed > 0 && hotTicketOrder.length > 0) {
            const topIdx = hotTicketOrder[0];
            const add = Math.min(remSeed, 999 - hotSeed[topIdx]);
            hotSeed[topIdx] += add;
            remSeed -= add;
          }
          if (remSeed > 0)
            waterFillInverseOddsNotes(hotSeed, dutchItems, remSeed);

          const cands = [mRef, equalBest.mults, hotSeed];
          let bestHotRes = null;
          for (let ci = 0; ci < cands.length; ci++) {
            const r = runPairwiseAscent(cands[ci], evalHotInfeasible);
            if (
              r.score !== null &&
              (!bestHotRes || compareLexTuple(r.score, bestHotRes.score) > 0)
            ) {
              bestHotRes = r;
            }
          }
          mults = bestHotRes ? bestHotRes.mults : equalBest.mults;
        }
      }
    } else {
      let pMax = 0;
      for (let s = 0; s < S; s++) {
        if (bucketProbs[s] > pMax) pMax = bucketProbs[s];
      }
      const pCut = Math.max(0.015, 0.2 * pMax);
      const eligibleCold = [];
      for (let s = 0; s < S; s++) {
        if (bucketProbs[s] >= pCut - 1e-12) {
          eligibleCold.push({ s, p: bucketProbs[s], basePay: refPayCents[s] });
        }
      }
      let coldBucketIndices = [];
      if (eligibleCold.length > 0) {
        eligibleCold.sort((a, b) => a.basePay - b.basePay);
        const eligMass = eligibleCold.reduce((acc, x) => acc + x.p, 0);
        let cumM = 0;
        let q75Pay = eligibleCold[eligibleCold.length - 1].basePay;
        for (let i = 0; i < eligibleCold.length; i++) {
          cumM += eligibleCold[i].p;
          if (cumM >= 0.75 * eligMass - 1e-12) {
            q75Pay = eligibleCold[i].basePay;
            break;
          }
        }
        coldBucketIndices = eligibleCold
          .filter((x) => x.basePay >= q75Pay - 1e-9)
          .map((x) => x.s);
      }

      const coldCapSafeRef = [...mRef];
      let hadClippedAboveOne = false;
      if (hasUnclippedLine) {
        let strippedCold = 0;
        for (let i = 0; i < k; i++) {
          if (isCapClipped[i] && coldCapSafeRef[i] > 1) {
            strippedCold += coldCapSafeRef[i] - 1;
            coldCapSafeRef[i] = 1;
            hadClippedAboveOne = true;
          }
        }
        if (strippedCold > 0) {
          waterFillInverseOddsNotes(coldCapSafeRef, dutchItems, strippedCold);
        }
      }
      const movedCapNotes =
        coldCapSafeRef.reduce((acc, v, i) => acc + Math.abs(v - mRef[i]), 0) /
        2;
      const residualClippedMaxMult = coldCapSafeRef.reduce(
        (mx, v, i) => (isCapClipped[i] ? Math.max(mx, v) : mx),
        0
      );
      const hadCapClippedWaste = movedCapNotes > 0;
      if (hadClippedAboveOne && movedCapNotes === 0) {
        coldCapCapacityFull = true;
      }

      const minAllowedExpR = refExpR - 0.03 - 1e-9;
      const maxAllowedLPart = refLPart + 0.02 + 1e-9;
      const evalGuardrailStats = (payVec) => {
        let expR = 0;
        let lPart = 0;
        let inFN = true;
        for (let s = 0; s < S; s++) {
          const pc = payVec[s];
          const ps = bucketProbs[s];
          const r = pc / targetStakeCents;
          expR += ps * r;
          if (pc < targetStakeCents) {
            inFN = false;
            lPart += ps * Math.max(0, 1 - r);
          }
        }
        return { expR, lPart, inFN };
      };
      const computeClippedExcess = (mVec) => {
        if (!hasUnclippedLine) return 0;
        let ex = 0;
        for (let i = 0; i < k; i++) {
          if (isCapClipped[i] && mVec[i] > 1) ex += mVec[i] - 1;
        }
        return ex;
      };
      const buildDirectMinMoveFeasibleSeed = () => {
        if (!hasFeasibleDomain) return null;
        const cand = [...mRef];
        const candPay = computePayVec(cand);
        if (hasUnclippedLine) {
          for (let i = 0; i < k; i++) {
            if (isCapClipped[i] && cand[i] > 1) {
              const drop = cand[i] - 1;
              cand[i] = 1;
              applyColDelta(candPay, i, -drop);
            }
          }
        }
        for (let pass = 0; pass < S * 2; pass++) {
          let worstS = -1;
          let worstDeficit = 0;
          for (let s = 0; s < S; s++) {
            const def = targetStakeCents - candPay[s];
            if (def > worstDeficit) {
              worstDeficit = def;
              worstS = s;
            }
          }
          if (worstS < 0) break;
          let bestCol = -1;
          let bestSc = -1;
          for (let i = 0; i < k; i++) {
            const u = bucketsCents[worstS][i];
            if (!(u > 0) || cand[i] >= 999) continue;
            if (isCapClipped[i] && hasUnclippedLine) continue;
            const sc = u * Math.max(1e-12, sorted[i].prob || 0);
            if (sc > bestSc) {
              bestSc = sc;
              bestCol = i;
            }
          }
          if (bestCol < 0) break;
          const stepAdd = Math.min(
            999 - cand[bestCol],
            Math.max(1, Math.ceil(worstDeficit / bucketsCents[worstS][bestCol]))
          );
          cand[bestCol] += stepAdd;
          applyColDelta(candPay, bestCol, stepAdd);
        }
        let curSum = cand.reduce((a, b) => a + b, 0);
        while (curSum > totalTickets) {
          let bestD = -1;
          let bestTier = 99;
          let bestEvLoss = Infinity;
          for (let d = 0; d < k; d++) {
            if (cand[d] <= 1) continue;
            const bArr = colBuckets[d];
            const cArr = colCents[d];
            let ok = true;
            for (let u = 0; u < bArr.length; u++) {
              if (candPay[bArr[u]] - cArr[u] < targetStakeCents) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            const tier =
              cand[d] > mRef[d]
                ? 0
                : isCapClipped[d] && hasUnclippedLine
                  ? 1
                  : 2;
            const evLoss = cappedUnits[d] * (sorted[d].prob || 0);
            if (tier < bestTier || (tier === bestTier && evLoss < bestEvLoss)) {
              bestTier = tier;
              bestEvLoss = evLoss;
              bestD = d;
            }
          }
          if (bestD < 0) return null;
          cand[bestD] -= 1;
          curSum -= 1;
          applyColDelta(candPay, bestD, -1);
        }
        while (curSum < totalTickets) {
          let bestR = -1;
          let bestTier = 99;
          let bestEvGain = -1;
          for (let r = 0; r < k; r++) {
            if (cand[r] >= 999) continue;
            const clipped = isCapClipped[r] && hasUnclippedLine;
            const tier = !clipped && cand[r] < mRef[r] ? 0 : !clipped ? 1 : 2;
            const evGain = cappedUnits[r] * (sorted[r].prob || 0);
            if (tier < bestTier || (tier === bestTier && evGain > bestEvGain)) {
              bestTier = tier;
              bestEvGain = evGain;
              bestR = r;
            }
          }
          if (bestR < 0) return null;
          cand[bestR] += 1;
          curSum += 1;
          applyColDelta(candPay, bestR, 1);
        }
        return candPay.every((pc) => pc >= targetStakeCents) ? cand : null;
      };
      const buildCapPeeledFeasibleSeed = (baseFeasible) => {
        if (!hasUnclippedLine || !Array.isArray(baseFeasible)) return null;
        const cand = [...baseFeasible];
        const candPay = computePayVec(cand);
        let peeled = 0;
        for (let i = 0; i < k; i++) {
          if (!isCapClipped[i] || cand[i] <= 1) continue;
          const drop = cand[i] - 1;
          let canDrop = true;
          const bArr = colBuckets[i];
          const cArr = colCents[i];
          for (let u = 0; u < bArr.length; u++) {
            if (candPay[bArr[u]] - drop * cArr[u] < targetStakeCents) {
              canDrop = false;
              break;
            }
          }
          if (canDrop) {
            cand[i] = 1;
            peeled += drop;
            applyColDelta(candPay, i, -drop);
          }
        }
        if (peeled > 0) {
          waterFillInverseOddsNotes(cand, dutchItems, peeled);
        }
        return peeled > 0 ? cand : null;
      };

      const refInFN = refPayCents.every((pc) => pc >= targetStakeCents);
      if (coldBucketIndices.length === 0) {
        coldCredibleZoneEmpty = true;
        if (refInFN || !hasFeasibleDomain) {
          if (hadCapClippedWaste) {
            const capStats = evalGuardrailStats(computePayVec(coldCapSafeRef));
            const capPassesGuardrails =
              capStats.expR >= minAllowedExpR &&
              capStats.lPart <= maxAllowedLPart &&
              (!hasFeasibleDomain || capStats.inFN);
            const peelDesc =
              residualClippedMaxMult <= 1
                ? "压至 1 倍"
                : `受未封顶项 999 倍上限约束最低压至 ${residualClippedMaxMult} 倍`;
            const evDiffFixed = Number((capStats.expR - refExpR).toFixed(6));
            const lpDiffFixed = Number((capStats.lPart - refLPart).toFixed(6));
            const curCapBindingSig = buildCapGuardBindingSig(
              mRef,
              coldCapSafeRef,
              evDiffFixed,
              lpDiffFixed
            );
            const isBoundCapConfirmed = Boolean(
              confirmedCapGuardSig && confirmedCapGuardSig === curCapBindingSig
            );
            if (capPassesGuardrails || isBoundCapConfirmed) {
              mults = coldCapSafeRef;
              coldCapGuardApplied = true;
              coldCapResidualMaxMult = residualClippedMaxMult;
              bonusNoOpReason =
                isBoundCapConfirmed && !capPassesGuardrails
                  ? `已按您的显式确认将超 20 万封顶项${peelDesc}并回填至未封顶组合（客观期望变动 ${((capStats.expR - refExpR) * 100).toFixed(2)}%）`
                  : `当前全部命中态单态概率均低于 1.5% 可信冷区下限，未集中博冷；已将超 20 万封顶项${peelDesc}并回填至未封顶组合`;
            } else {
              mults = [...mRef];
              coldCapGuardBlockedByEv = true;
              const evDropPct = Math.max(0, (refExpR - capStats.expR) * 100);
              capGuardAlternative = {
                multiples: [...coldCapSafeRef],
                originalMultiples: [...mRef],
                residualClippedMaxMultiple: residualClippedMaxMult,
                totalCost: targetStake,
                expectedValueRateDiff: evDiffFixed,
                partialLossShortfallDiff: lpDiffFixed,
                requiresExplicitConfirm: true,
                bindingSig: curCapBindingSig,
                summaryText: `将超 20 万封顶项${peelDesc}（分倍 [${mRef.join(", ")}] → [${coldCapSafeRef.join(", ")}]，总投入仍为 ¥${targetStake}，客观期望变动 -${evDropPct.toFixed(2)}%）`,
              };
              bonusNoOpReason = `当前全部命中态单态概率均低于 1.5% 可信冷区下限；若将超 20 万封顶项${peelDesc}会使客观期望回报下降 ${evDropPct.toFixed(2)}%（超出 3.00% 期望护栏），因此保留当前原配比（可在审单台显式确认切换封顶减倍方案）`;
            }
          } else if (coldCapCapacityFull) {
            mults = [...mRef];
            bonusNoOpReason =
              "当前未封顶组合均已达单票 999 倍法定上限，同本金下无法继续移出超 20 万封顶项倍数，维持当前原配比";
          } else {
            mults = [...mRef];
            bonusNoOpReason =
              "当前全部命中态单态概率均低于 1.5% 可信冷区下限，未向极低概率尾态集中加倍，维持原稳健配比";
          }
        } else {
          const minMoveEval = (payVec, mVec) => {
            const st = evalGuardrailStats(payVec);
            if (!st.inFN) return null;
            const guardOk =
              st.expR >= minAllowedExpR && st.lPart <= maxAllowedLPart ? 1 : 0;
            const guardSlack = guardOk
              ? 0
              : st.expR -
                minAllowedExpR -
                Math.max(0, st.lPart - maxAllowedLPart);
            return [
              guardOk,
              guardSlack,
              -computeClippedExcess(mVec),
              -computeL1Dist(mVec),
            ];
          };
          let bestEmptyRes = null;
          if (canEnumerateExact) {
            bestEmptyRes = enumerateExactCompositions(minMoveEval);
            isExactOptimal = true;
          } else {
            const directMinSeed = buildDirectMinMoveFeasibleSeed();
            const peeledSeed = buildCapPeeledFeasibleSeed(
              certifiedFeasibleSeed
            );
            const emptyColdSeeds = [
              ...(directMinSeed ? [directMinSeed] : []),
              ...(peeledSeed ? [peeledSeed] : []),
              certifiedFeasibleSeed,
            ];
            for (let si = 0; si < emptyColdSeeds.length; si++) {
              const r = runPairwiseAscent(emptyColdSeeds[si], minMoveEval);
              if (
                r.score !== null &&
                (!bestEmptyRes ||
                  compareLexTuple(r.score, bestEmptyRes.score) > 0)
              ) {
                bestEmptyRes = r;
              }
            }
          }
          if (bestEmptyRes && bestEmptyRes.score[0] === 1) {
            mults = bestEmptyRes.mults;
            bonusNoOpReason =
              "当前全部命中态单态概率均低于 1.5% 可信冷区下限，仅做最小分倍调整守住有票命中保本线，未向极低概率尾态集中加倍";
          } else {
            mults = [...mRef];
            coldCapGuardBlockedByEv = true;
            bonusNoOpReason =
              "当前全部命中态单态概率均低于 1.5% 可信冷区下限，且强行改倍将跌破 3.00% 期望护栏，保留当前原配比";
          }
        }
      } else {
        const directMinFeasible = buildDirectMinMoveFeasibleSeed();
        const effectiveBaseFeasible =
          directMinFeasible || certifiedFeasibleSeed;
        const certPayVec = hasFeasibleDomain
          ? computePayVec(effectiveBaseFeasible)
          : refPayCents;
        let certSeedColdPeak = 0;
        let rawRefColdPeak = 0;
        for (let c = 0; c < coldBucketIndices.length; c++) {
          const s = coldBucketIndices[c];
          if (certPayVec[s] > certSeedColdPeak) {
            certSeedColdPeak = certPayVec[s];
          }
          if (refPayCents[s] > rawRefColdPeak) {
            rawRefColdPeak = refPayCents[s];
          }
        }

        const coldBucketSet = new Set(coldBucketIndices);
        const touchesColdLine = Array.from({ length: k }, (_, i) =>
          colBuckets[i].some((s) => coldBucketSet.has(s))
        );

        const buildTwoStageColdLexSeed = (baseVec, targetRatio) => {
          const cand = [...baseVec];
          const candPay = computePayVec(cand);
          const stage1Cents = targetRatio * targetStakeCents;
          const stage2CapCents = 5 * targetStakeCents;

          const selectBestDonor = (recvCol) => {
            let bestD = -1;
            let bestCapFlag = 99;
            let bestDeltaLP = Infinity;
            let bestEvCost = Infinity;
            const curSt = evalGuardrailStats(candPay);
            for (let d = 0; d < k; d++) {
              if (d === recvCol || touchesColdLine[d] || cand[d] <= 1) continue;
              if (hasFeasibleDomain) {
                let breaksFN = false;
                const bArr = colBuckets[d];
                const cArr = colCents[d];
                for (let u = 0; u < bArr.length; u++) {
                  if (candPay[bArr[u]] - cArr[u] < targetStakeCents) {
                    breaksFN = true;
                    break;
                  }
                }
                if (breaksFN) continue;
              }
              applyColDelta(candPay, d, -1);
              applyColDelta(candPay, recvCol, 1);
              const nextSt = evalGuardrailStats(candPay);
              applyColDelta(candPay, recvCol, -1);
              applyColDelta(candPay, d, 1);
              if (
                nextSt.expR < minAllowedExpR ||
                nextSt.lPart > maxAllowedLPart
              ) {
                continue;
              }
              const capFlag = isCapClipped[d] && hasUnclippedLine ? 0 : 1;
              const dLP = Math.max(0, nextSt.lPart - curSt.lPart);
              const evCost = cappedUnits[d] * (sorted[d].prob || 0);
              if (
                capFlag < bestCapFlag ||
                (capFlag === bestCapFlag && dLP < bestDeltaLP - 1e-12) ||
                (capFlag === bestCapFlag &&
                  Math.abs(dLP - bestDeltaLP) <= 1e-12 &&
                  evCost < bestEvCost)
              ) {
                bestCapFlag = capFlag;
                bestDeltaLP = dLP;
                bestEvCost = evCost;
                bestD = d;
              }
            }
            return bestD;
          };

          const orderedCold = [...coldBucketIndices].sort((sa, sb) => {
            let bestUnitA = 1;
            let bestUnitB = 1;
            for (let i = 0; i < k; i++) {
              if (bucketsCents[sa][i] > bestUnitA)
                bestUnitA = bucketsCents[sa][i];
              if (bucketsCents[sb][i] > bestUnitB)
                bestUnitB = bucketsCents[sb][i];
            }
            const needA = Math.max(
              1,
              Math.ceil(Math.max(0, stage1Cents - candPay[sa]) / bestUnitA)
            );
            const needB = Math.max(
              1,
              Math.ceil(Math.max(0, stage1Cents - candPay[sb]) / bestUnitB)
            );
            return bucketProbs[sb] / needB - bucketProbs[sa] / needA;
          });

          // Stage 1: Lift maximum cold probability mass to targetRatio (2.5x)
          for (let ci = 0; ci < orderedCold.length; ci++) {
            const s = orderedCold[ci];
            if (candPay[s] >= stage1Cents - 1e-6) continue;
            let bestT = -1;
            let bestMarginal = -1;
            for (let i = 0; i < k; i++) {
              const u = bucketsCents[s][i];
              if (!(u > 0) || cand[i] >= 999) continue;
              if (isCapClipped[i] && hasUnclippedLine) continue;
              const mg = u * Math.max(1e-9, sorted[i].prob || 0);
              if (mg > bestMarginal) {
                bestMarginal = mg;
                bestT = i;
              }
            }
            if (bestT < 0) continue;
            while (candPay[s] < stage1Cents - 1e-6 && cand[bestT] < 999) {
              const d = selectBestDonor(bestT);
              if (d < 0) break;
              cand[d] -= 1;
              cand[bestT] += 1;
              applyColDelta(candPay, d, -1);
              applyColDelta(candPay, bestT, 1);
            }
          }

          // Stage 2: Maximize cappedExcess up to 5.0x saturation while preserving Stage 1
          if (targetRatio >= 2.4) {
            for (let step = 0; step < totalTickets; step++) {
              let bestRecv = -1;
              let bestGain = 1e-12;
              for (let i = 0; i < k; i++) {
                if (!touchesColdLine[i] || cand[i] >= 999) continue;
                if (isCapClipped[i] && hasUnclippedLine) continue;
                let gain = 0;
                const bArr = colBuckets[i];
                const cArr = colCents[i];
                for (let u = 0; u < bArr.length; u++) {
                  const s = bArr[u];
                  if (!coldBucketSet.has(s)) continue;
                  const curP = candPay[s];
                  if (curP >= stage2CapCents) continue;
                  const nextP = curP + cArr[u];
                  const curEx =
                    curP > targetStakeCents
                      ? Math.min(
                          (curP - targetStakeCents) / targetStakeCents,
                          4
                        )
                      : 0;
                  const nextEx =
                    nextP > targetStakeCents
                      ? Math.min(
                          (nextP - targetStakeCents) / targetStakeCents,
                          4
                        )
                      : 0;
                  gain += bucketProbs[s] * (nextEx - curEx);
                }
                if (gain > bestGain) {
                  bestGain = gain;
                  bestRecv = i;
                }
              }
              if (bestRecv < 0) break;
              const d = selectBestDonor(bestRecv);
              if (d < 0) break;
              cand[d] -= 1;
              cand[bestRecv] += 1;
              applyColDelta(candPay, d, -1);
              applyColDelta(candPay, bestRecv, 1);
            }
          }
          return cand;
        };

        const makeColdEvaluator = (targetPeakCents) => (payVec, mVec) => {
          if (hasFeasibleDomain) {
            for (let s = 0; s < S; s++) {
              if (payVec[s] < targetStakeCents) return null;
            }
          }
          let expR = 0;
          let lPart = 0;
          for (let s = 0; s < S; s++) {
            const pc = payVec[s];
            const ps = bucketProbs[s];
            const r = pc / targetStakeCents;
            expR += ps * r;
            if (pc < targetStakeCents) lPart += ps * Math.max(0, 1 - r);
          }
          const guardOk =
            expR >= minAllowedExpR && lPart <= maxAllowedLPart ? 1 : 0;
          const guardSlack = guardOk
            ? 0
            : expR - minAllowedExpR - Math.max(0, lPart - maxAllowedLPart);

          let curPeak = 0;
          let massGe25 = 0;
          let cappedExcess = 0;
          for (let c = 0; c < coldBucketIndices.length; c++) {
            const s = coldBucketIndices[c];
            const pc = payVec[s];
            const ps = bucketProbs[s];
            if (pc > curPeak) curPeak = pc;
            const r = pc / targetStakeCents;
            if (pc * 2 >= 5 * targetStakeCents) massGe25 += ps;
            if (r > 1) cappedExcess += ps * Math.min(r - 1, 4.0);
          }
          const peakOk =
            allowPeakTradeoff ||
            targetPeakCents <= 0 ||
            curPeak >= targetPeakCents
              ? 1
              : 0;
          const peakSlack = peakOk
            ? 0
            : (curPeak - targetPeakCents) / Math.max(100, targetStakeCents);
          return [
            guardOk,
            guardSlack,
            peakOk,
            peakSlack,
            -computeClippedExcess(mVec),
            massGe25,
            cappedExcess,
            -computeL1Dist(mVec),
          ];
        };

        const startSeed = hasFeasibleDomain
          ? effectiveBaseFeasible
          : coldCapSafeRef;
        const peeledStartSeed = hasFeasibleDomain
          ? buildCapPeeledFeasibleSeed(effectiveBaseFeasible)
          : null;
        const coldCandSeeds = canEnumerateExact
          ? []
          : hasFeasibleDomain
            ? [
                ...(peeledStartSeed ? [peeledStartSeed] : []),
                startSeed,
                ...(refInFN ? [mRef, coldCapSafeRef] : []),
                buildTwoStageColdLexSeed(peeledStartSeed || startSeed, 2.5),
                buildTwoStageColdLexSeed(peeledStartSeed || startSeed, 1.0001),
              ]
            : [
                coldCapSafeRef,
                mRef,
                equalBest.mults,
                buildTwoStageColdLexSeed(coldCapSafeRef, 2.5),
                buildTwoStageColdLexSeed(coldCapSafeRef, 1.0001),
              ];

        const evalAcrossSeeds = (targetPeakCents) => {
          const evFn = makeColdEvaluator(targetPeakCents);
          if (canEnumerateExact) {
            return enumerateExactCompositions(evFn);
          }
          let best = null;
          const seenSeedSigs = new Set();
          for (let si = 0; si < coldCandSeeds.length; si++) {
            const sd = coldCandSeeds[si];
            if (!Array.isArray(sd)) continue;
            const sig = sd.join(",");
            if (seenSeedSigs.has(sig)) continue;
            seenSeedSigs.add(sig);
            const r = runPairwiseAscent(sd, evFn);
            if (
              r.score !== null &&
              (!best || compareLexTuple(r.score, best.score) > 0)
            ) {
              best = r;
            }
          }
          return best;
        };

        let coldRes = evalAcrossSeeds(rawRefColdPeak);
        if (!coldRes || coldRes.score[0] !== 1 || coldRes.score[2] !== 1) {
          if (hasFeasibleDomain && certSeedColdPeak < rawRefColdPeak - 1e-6) {
            const fbPeakRes = evalAcrossSeeds(certSeedColdPeak);
            if (
              fbPeakRes &&
              fbPeakRes.score[0] === 1 &&
              fbPeakRes.score[2] === 1
            ) {
              coldRes = fbPeakRes;
            }
          }
        }
        if (!coldRes || coldRes.score[0] !== 1 || coldRes.score[2] !== 1) {
          const relaxedRes = evalAcrossSeeds(0);
          if (relaxedRes && relaxedRes.score[0] === 1) {
            coldRes = relaxedRes;
          }
        }
        mults =
          coldRes && coldRes.score !== null && coldRes.score[0] === 1
            ? coldRes.mults
            : [...mRef];
        isExactOptimal =
          canEnumerateExact &&
          Boolean(coldRes && coldRes.score !== null && coldRes.score[0] === 1);

        const finalColdPay = computePayVec(mults);
        let finalColdPeak = 0;
        for (let c = 0; c < coldBucketIndices.length; c++) {
          const s = coldBucketIndices[c];
          if (finalColdPay[s] > finalColdPeak) finalColdPeak = finalColdPay[s];
        }
        if (
          hasFeasibleDomain &&
          !refInFN &&
          finalColdPeak < rawRefColdPeak - 1
        ) {
          coldPeakTradeoffNoted = true;
        }
      }
    }
  }

  // Re-certify with candidateMults so any feasible witness found by ascent is 100% certified
  if (
    !lockedFixedCombo &&
    k <= 512 &&
    !skipFullBucketMatrix &&
    certRes.cert.isCurrentFeasible !== "certified-feasible" &&
    verifyBreakevenWitness(bucketsCents, k, totalTickets, mults)
  ) {
    certRes = certifyAndSolveJointBreakeven(bucketsCents, k, totalTickets, {
      timeBudgetMs: certTimeBudgetMs,
      maxScanNotes: k > 64 ? 2000 : 10_000,
      zeroPayoutProb: objZeroProb,
      baseMultiples: mRef,
      candidateMults: mults,
    });
  }

  if (
    !bonusNoOpReason &&
    !upgradeToBreakeven &&
    totalTickets > k &&
    mults.every((m, idx) => m === mRef[idx])
  ) {
    bonusNoOpReason =
      certRes.cert.isCurrentFeasible === "certified-infeasible" &&
      certRes.cert.nextFeasibleBudget
        ? isExactOptimal
          ? `当前总投入 ¥${targetStake} 下经精确核验原配比已达该模式受限全局最优（条件保本至少需 ¥${certRes.cert.nextFeasibleBudget}），各注倍数未发生变动。`
          : `当前总投入 ¥${targetStake} 下在期望与回血护栏内未检出更优整数配比（条件保本至少需 ¥${certRes.cert.nextFeasibleBudget}），保留当前原倍数。`
        : isExactOptimal
          ? `当前总投入 ¥${targetStake} 下经精确核验原配比已达该模式全局最优，无需改动倍数。`
          : `当前总投入 ¥${targetStake} 下在期望与保本护栏内未检出更优整数配比，保留当前原倍数。`;
  }

  const lines = sorted.map((c, idx) => {
    const mult = mults[idx];
    const unit = cappedUnits[idx];
    const role =
      cleanOptMode === "equal"
        ? `均衡分倍#${idx + 1}`
        : cleanOptMode === "hot-first"
          ? idx === 0
            ? "🔥主攻重锤"
            : `🛡️次选回本盾#${idx}`
          : idx === k - 1
            ? "⚡博冷高弹箭"
            : `🛡️正路免单盾#${idx + 1}`;

    const fullLegs = (c.legs ?? []).map((p) => {
      const fm = matchMap.get(p.matchId);
      return {
        matchId: p.matchId,
        matchNumStr: p.matchNumStr,
        home: p.home,
        away: p.away,
        kickoff: fm?.kickoff ?? p.kickoff ?? "21:00",
        poolCode: p.poolCode,
        poolName: p.poolName,
        ...(p.poolCode === "HHAD"
          ? {
              goalLine: hasExplicitBaseLines
                ? p.goalLine
                : (p.goalLine ?? fm?.pools?.HHAD?.goalLine),
            }
          : {}),
        optionKey: p.optionKey,
        optionLabel: p.optionLabel,
        odds: p.odds,
        fairProb: p.fairProb,
      };
    });

    const perLineMode =
      fullLegs.length === 1
        ? "单关"
        : fullLegs.length > 1
          ? `${fullLegs.length}串1`
          : (manualReport?.modeLabel ?? "单关");

    const rawBeforeCap = rawUnits[idx] > 0 ? rawUnits[idx] : unit;
    const cappedClipped = Math.max(
      0,
      Number(((rawBeforeCap - unit) * mult).toFixed(2))
    );

    return {
      id: `opt-${cleanOptMode}-${idx}`,
      roleLabel: role,
      legs: fullLegs,
      modeLabel: perLineMode,
      multiple: mult,
      cost: mult * 2,
      unitPayout: unit,
      cappedClipped,
      returnPayout: Number((unit * mult).toFixed(2)),
      netProfit: 0,
      prob: c.prob,
    };
  });

  const actualTotal = lines.reduce((a, l) => a + l.cost, 0);
  lines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - actualTotal).toFixed(2));
  });

  const ticketRowsForEval = lines.map((l, idx) => ({
    id: l.id,
    ticketNo: idx + 1,
    desc: "",
    legs: l.legs,
    multiple: l.multiple,
    cost: l.cost,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: l.cappedClipped ?? 0,
  }));
  const hasManualSubjectiveShift = Boolean(
    manualReport?.subjectiveProjectedEVRate != null
  );
  const reusableBaselineMatrix =
    !hasExplicitBaseLines &&
    !hasManualSubjectiveShift &&
    manualReport?._reusableHitMatrix?.isBaselineAtomic
      ? manualReport._reusableHitMatrix
      : null;
  let jointEval;
  let objEval;
  if (reusableBaselineMatrix) {
    jointEval = evaluateTicketsOnQuotientSpace(
      ticketRowsForEval,
      actualTotal,
      matches,
      null,
      {
        metricsOnly: true,
        reusableHitMatrix: reusableBaselineMatrix,
      }
    );
    objEval = jointEval;
  } else {
    jointEval = evaluateTicketsOnQuotientSpace(
      ticketRowsForEval,
      actualTotal,
      matches,
      evalAtomicMap
    );
    objEval =
      Array.isArray(matches) && matches.length > 0
        ? evaluateTicketsOnQuotientSpace(
            ticketRowsForEval,
            actualTotal,
            matches,
            objectiveAtomicMap,
            { metricsOnly: true }
          )
        : jointEval;
  }
  const { vigPct } = computeCapitalWeightedVig(lines, matches);

  const uwCount = jointEval.underwaterCount;
  const totalScenarios = Math.max(
    1,
    jointEval.tiers?.length ?? jointEval.combos?.length ?? k
  );
  const finalZeroProb =
    objEval.zeroPayoutProb ?? Math.max(0, 1 - jointEval.anyWinProb);
  const finalCert = {
    ...certRes.cert,
    ...(uwCount === 0
      ? {
          isCurrentFeasible: "certified-feasible",
          nextFeasibleBudget: null,
          proofStatus: "certified",
        }
      : {}),
    conditionalFloorAtCurrent: jointEval.minPayout,
    zeroPayoutProb: finalZeroProb,
  };
  const isUnprovedBreakeven =
    uwCount > 0 &&
    (skipFullBucketMatrix ||
      finalCert.isCurrentFeasible === "unknown" ||
      finalCert.proofStatus === "time-budget-unproved");
  const rawUpgradeCost =
    uwCount > 0 &&
    typeof finalCert.nextFeasibleBudget === "number" &&
    finalCert.nextFeasibleBudget > actualTotal
      ? finalCert.nextFeasibleBudget
      : null;

  const p0PctText = `${(finalZeroProb * 100).toFixed(1)}%`;
  const metaMap = {
    equal: {
      shortTab: "平均优化",
      badge:
        uwCount > 0
          ? "⚖️ 平均优化 · 非保本减损"
          : `⚖️ 有票命中时保本 · 平均优化（未中率 ${p0PctText}）`,
      title:
        uwCount > 0
          ? "严守当前预算 · 抬高最弱命中态返奖下界"
          : "有票命中时 100% 返本或净赚 · 反比例均衡派奖",
      reason:
        uwCount > 0
          ? isUnprovedBreakeven
            ? `当前组合规模较大，时限内未完成全态保本穷举证明（整单未中归零率 ${p0PctText}），按本金 ¥${actualTotal} 反比例配平后仍有 ${uwCount}/${totalScenarios} 种命中场景属局部回血`
            : `严守当前本金 ¥${actualTotal}（整单未中归零率 ${p0PctText}），受整数倍限制仍有 ${uwCount}/${totalScenarios} 种命中场景属局部回血`
          : `有票命中时全部场景 ≥ 本金 ¥${actualTotal}（整单未中归零率 ${p0PctText} 保持不变），按完整状态向量最大化最低返奖率`,
    },
    "hot-first": {
      shortTab: uwCount > 0 ? "博热争净赚" : "博热保本",
      badge:
        uwCount > 0
          ? "🔥 博热争净赚 · 非保本"
          : `🔥 有票命中时保本 · 博热优化（未中率 ${p0PctText}）`,
      title:
        uwCount > 0
          ? "严守当前预算 · 聚焦高概率正路争净赚（非保本）"
          : "守住有票命中保底线 · 前二高概率正路利润最大化",
      reason:
        uwCount > 0
          ? isUnprovedBreakeven
            ? `当前组合规模较大，时限内未完成全态保本穷举证明（整单未中率 ${p0PctText}），在严控局部回血折损下优先抬升严格净赚率与 ≥0.8x 回血率（仍有 ${uwCount}/${totalScenarios} 态局部回血）`
            : `当前金额已证无法全态保本（整单未中率 ${p0PctText}），在严控局部回血折损下优先抬升严格净赚率与 ≥0.8x 回血率（仍有 ${uwCount}/${totalScenarios} 态局部回血）`
          : `在守住全部命中态 ≥ ¥${actualTotal} 前提下（整单未中率 ${p0PctText}），将机动倍数集中倾斜至前 2 高概率中奖桶`,
    },
    "cold-first": {
      shortTab: "博冷高弹",
      badge:
        uwCount > 0
          ? "⚡ 博冷高弹 · 非保本减损"
          : `⚡ 有票命中时保本 · 博冷高弹（未中率 ${p0PctText}）`,
      title: coldCredibleZoneEmpty
        ? coldCapGuardApplied
          ? coldCapResidualMaxMult <= 1
            ? "全态低于 1.5% 可信冷区 · 已剥离超 20 万封顶废倍"
            : `全态低于 1.5% 可信冷区 · 封顶项已减至 ${coldCapResidualMaxMult} 倍（999倍容量边界）`
          : coldCapCapacityFull
            ? "全态低于 1.5% 可信冷区 · 未封顶项已满 999 倍上限（维持原配比）"
            : coldCapGuardBlockedByEv
              ? "全态低于 1.5% 可信冷区 · 严守 3% 期望护栏（保留原配比）"
              : uwCount > 0
                ? "严守当前预算 · 全态低于 1.5% 可信冷区（维持原配比）"
                : "守住有票命中保本线 · 全态低于 1.5% 可信冷区（未集中博冷）"
        : uwCount > 0
          ? "严守当前预算 · 可信冷区高倍弹性优化"
          : "正路命中保本托底 · 可信冷区 ≥2.5x 高弹放大",
      reason: coldCredibleZoneEmpty
        ? coldCapGuardApplied
          ? bonusNoOpReason ||
            `当前全部命中态单态概率均低于 1.5% 可信冷区下限（整单未中率 ${p0PctText}），未向极低概率尾态集中加倍；已将超 20 万封顶废倍限为 ${coldCapResidualMaxMult} 倍并回填至未封顶组合`
          : coldCapCapacityFull || coldCapGuardBlockedByEv
            ? bonusNoOpReason
            : uwCount > 0
              ? `当前全部命中态单态概率均低于 1.5% 可信冷区下限（整单未中率 ${p0PctText}），未向极低概率尾态集中加倍，维持原稳健配比`
              : `有票命中时全部场景 ≥ 本金 ¥${actualTotal}（整单未中率 ${p0PctText}），因全部命中态概率均低于 1.5% 可信冷区下限，维持原稳健配比未额外集中博冷`
        : uwCount > 0
          ? isUnprovedBreakeven
            ? `当前组合规模较大，时限内未完成全态保本穷举证明（整单未中率 ${p0PctText}），严守本金 ¥${actualTotal} 兼顾期望护栏与可信冷区爆发力（仍有 ${uwCount}/${totalScenarios} 种场景属局部回血）`
            : `严守当前本金 ¥${actualTotal} 兼顾期望护栏与可信冷区爆发力，仍有 ${uwCount}/${totalScenarios} 种场景属局部回血`
          : `正路方向守住有票命中保本线（整单未中率 ${p0PctText}），余量精准倾斜可信高赔冷区冲刺 ≥2.5x 回报`,
    },
  }[cleanOptMode];

  const bonusReasons = [metaMap.reason];
  if (coldPeakTradeoffNoted) {
    bonusReasons.push(
      "提示：为守住有票命中时全态保本底线，部分倍数已由最高赔冷门移作正路护盾（峰值与保底存在天然取舍）。"
    );
  }
  if (bonusNoOpReason && bonusNoOpReason !== metaMap.reason) {
    bonusReasons.push(bonusNoOpReason);
  }
  if (uwCount > 0 && rawUpgradeCost) {
    bonusReasons.push(
      `若需实现有票命中时 100% 返本，可显式授权加至下一可行门槛 ¥${rawUpgradeCost}${
        finalCert.minFeasibleBudget &&
        finalCert.minFeasibleBudget < rawUpgradeCost
          ? `（全局最低可行额 ¥${finalCert.minFeasibleBudget}）`
          : ""
      }`
    );
  }

  const physicalSlips =
    lockedFixedCombo &&
    consolidateTickets &&
    Array.isArray(manualReport?.physicalSlips) &&
    manualReport.physicalSlips.length > 0 &&
    actualTotal === Number(manualReport.totalCost)
      ? manualReport.physicalSlips
      : consolidateTerminalPhysicalSlips(lines, {
          consolidate: consolidateTickets,
        });
  const isUncondBonusFloor =
    actualTotal > 0 &&
    Math.max(0, 1 - jointEval.anyWinProb) <= 1e-12 &&
    uwCount === 0;
  const outBonusPlan = {
    key: "max-profit-prob",
    available: true,
    shortTab: options?.baseTitle
      ? `${metaMap.shortTab}·${options.baseTitle}`
      : metaMap.shortTab,
    badge: metaMap.badge,
    title: metaMap.title,
    tagline: `总投入 ¥${actualTotal} · ${
      isUncondBonusFloor ? "保底返" : "命中返"
    } ¥${jointEval.minPayout.toFixed(1)} ~ 最高 ¥${jointEval.maxPayout.toFixed(1)}`,
    totalCost: actualTotal,
    savedCash: 0,
    stakeUnitsCount: Math.round(actualTotal / 2),
    minReturn: jointEval.minPayout,
    maxReturn: jointEval.maxPayout,
    winProb: jointEval.anyWinProb,
    profitProb: jointEval.realProfitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
    partialLossProb: jointEval.partialLossProb,
    partialLossShortfall: objEval.partialLossShortfall,
    totalCapitalShortfallD: objEval.totalCapitalShortfallD,
    expectedValueRate: jointEval.expectedValueRate,
    objectiveEVRate: objEval.expectedValueRate,
    objectiveProfitProb: objEval.realProfitProb,
    objectiveStrictNetGainProb: objEval.strictNetGainProb,
    subjectiveProjectedEVRate: hasManualSubjectiveShift
      ? jointEval.expectedValueRate
      : null,
    subjectiveProjectedProfitProb: hasManualSubjectiveShift
      ? jointEval.realProfitProb
      : null,
    underwaterCount: uwCount,
    logicalGroupCount: lines.length,
    physicalTicketCount: physicalSlips.length,
    physicalSlips,
    zeroPayoutProb: finalZeroProb,
    breakevenUpgradeCost: uwCount > 0 ? rawUpgradeCost : null,
    breakevenCert: finalCert,
    bonusNoOpReason,
    isExactOptimal,
    ...(capGuardAlternative ? { capGuardAlternative } : {}),
    ...(requiresComboUnbundleConfirm
      ? {
          requiresComboUnbundleConfirm: true,
          lockedComboCode: sourceComboCode,
        }
      : {}),
    consolidateTickets,
    missOneReturn: null,
    vigPct,
    reasons: bonusReasons,
    lines,
  };
  attachLazyConsolidatedLines(outBonusPlan, lines, true);
  TRUSTED_SERVER_BONUS_PLANS.add(outBonusPlan);
  if (Array.isArray(jointEval.combos) && jointEval.combos.length > 0) {
    attachCachedJointEval(outBonusPlan, {
      matchesRef: matches,
      totalCost: actualTotal,
      lines,
      jointEval,
      objEval,
      hasSubjectiveFilter: hasManualSubjectiveShift,
    });
  }
  return outBonusPlan;
}

export function isValidPlanObject(plan) {
  const maxLines = plan && TRUSTED_SERVER_BONUS_PLANS.has(plan) ? 2048 : 64;
  if (
    !plan ||
    typeof plan !== "object" ||
    !Array.isArray(plan.lines) ||
    plan.lines.length < 1 ||
    plan.lines.length > maxLines
  ) {
    return false;
  }

  const allDistinctMatches = new Set();
  let hasParlayLine = false;

  for (const l of plan.lines) {
    if (
      !l ||
      typeof l !== "object" ||
      !Array.isArray(l.legs) ||
      l.legs.length < 1 ||
      !Number.isFinite(Number(l.multiple)) ||
      !Number.isFinite(Number(l.unitPayout))
    ) {
      return false;
    }
    const maxPass = Math.min(
      ...l.legs.map((g) => POOL_MAX_PASS[g?.poolCode] ?? 8)
    );
    if (l.legs.length > maxPass) return false;
    if (l.legs.length >= 2) hasParlayLine = true;

    const lineMatches = new Set();
    for (const g of l.legs) {
      if (typeof g?.matchId !== "string" || g.matchId.trim().length === 0) {
        return false;
      }
      if (lineMatches.has(g.matchId)) return false;
      lineMatches.add(g.matchId);
      allDistinctMatches.add(g.matchId);
    }
  }

  const maxDistinctMatches = hasParlayLine ? 8 : 15;
  return (
    allDistinctMatches.size >= 1 &&
    allDistinctMatches.size <= maxDistinctMatches
  );
}

export function clampSandboxCustomOdds(rawOdds) {
  const n = Number(rawOdds);
  if (n === Number.POSITIVE_INFINITY) return 1000;
  if (!Number.isFinite(n) || n < 1.01) return 1.01;
  return Math.min(1000, n);
}

export function scaleArchetypePlan(plan, rawScale) {
  if (!isValidPlanObject(plan)) return null;
  const isTrusted = TRUSTED_SERVER_BONUS_PLANS.has(plan);
  const requestedScale = Math.max(
    1,
    Math.min(50, Math.round(Number(rawScale) || 1))
  );
  if (requestedScale <= 1) return plan;
  const maxBaseMult = Math.max(
    1,
    ...plan.lines.map((l) => Number(l.multiple) || 1)
  );
  const scale = Math.max(
    1,
    Math.min(requestedScale, Math.floor(999 / maxBaseMult))
  );
  if (scale <= 1) return plan;
  const scaledLines = plan.lines.map((l) => {
    const mult = Math.max(
      1,
      Math.min(999, Math.round((Number(l.multiple) || 1) * scale))
    );
    const cost = mult * 2;
    const legOdds = l.legs.map((g) =>
      isTrusted ? Number(g.odds) : clampSandboxCustomOdds(g.odds)
    );
    const cap = statutorySingleBetCap(effectiveNonVoidLegCount(legOdds));
    const unitBeforeCap = bankerRoundParlayUnitPayout(legOdds);
    const effectiveUnit = Math.min(cap, Number(l.unitPayout));
    const cappedClipped =
      unitBeforeCap > cap
        ? Math.max(
            0,
            Number(((unitBeforeCap - effectiveUnit) * mult).toFixed(2))
          )
        : 0;
    const returnPayout = Number((effectiveUnit * mult).toFixed(2));
    return {
      ...l,
      multiple: mult,
      cost,
      unitPayout: effectiveUnit,
      cappedClipped,
      returnPayout,
      netProfit: 0,
    };
  });
  const totalCost = scaledLines.reduce((a, l) => a + l.cost, 0);
  scaledLines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - totalCost).toFixed(2));
  });
  const returns = scaledLines.map((l) => l.returnPayout);
  const minReturn = returns.length ? Math.min(...returns) : 0;
  const hasMissOne =
    typeof plan.missOneReturn === "number" &&
    Number.isFinite(plan.missOneReturn);
  const scaledMax = hasMissOne
    ? Number((Number(plan.maxReturn || 0) * scale).toFixed(2))
    : returns.length
      ? Math.max(...returns)
      : 0;
  const scaledOut = {
    ...shallowClonePlanWithoutConsolidated(plan),
    totalCost,
    minReturn,
    maxReturn: Math.max(minReturn, scaledMax),
    missOneReturn: hasMissOne
      ? Number((plan.missOneReturn * scale).toFixed(2))
      : null,
    lines: scaledLines,
  };
  attachLazyConsolidatedLines(
    scaledOut,
    scaledLines,
    Boolean(plan.consolidateTickets)
  );
  if (TRUSTED_SERVER_BONUS_PLANS.has(plan)) {
    TRUSTED_SERVER_BONUS_PLANS.add(scaledOut);
  }
  return scaledOut;
}

function buildInvalidOddsStatutoryWarning() {
  return {
    id: "invalid-odds",
    severity: "danger",
    title: "选单包含未开售或无效赔率选项，已拦截出票",
    detail:
      "部分所选选项在当前官方盘面未开售或赔率异常，请重新核对并勾选有效选项。",
  };
}

export function computeUnifiedSlipDangerAndWarnings({
  tickets = [],
  totalCost = 0,
  minPayout = 0,
  maxPayout = 0,
  comboCount = 0,
  underwaterCount = 0,
  breakevenUpgradeCost = null,
  effectiveOdds = 0,
  matchCount = 0,
  poolCap = 8,
  forceSingleOnly = false,
  activePassSizes = [],
  hasSameMatchCrossPoolConflict = false,
  avgPayoutRatio = 0.88,
  avgVigLossPer100 = 12,
  objEval = null,
  hasInvalidOdds = false,
  physicalSlipCount: explicitPhysicalSlipCount = null,
}) {
  let weightedLegSum = 0;
  let totalTicketWeight = 0;
  let maxMultiple = 1;
  for (let i = 0; i < tickets.length; i++) {
    const tk = tickets[i];
    const mult = Math.max(1, Number(tk.multiple) || 1);
    if (mult > maxMultiple) maxMultiple = mult;
    const w = Math.max(0, Number(tk.cost ?? mult * 2));
    const effLegs =
      Array.isArray(tk.legs) && tk.legs.length > 0
        ? Math.max(1, effectiveNonVoidLegCount(tk.legs))
        : 1;
    weightedLegSum += w * effLegs;
    totalTicketWeight += w;
  }
  const avgPassLen =
    totalTicketWeight > 0
      ? weightedLegSum / totalTicketWeight
      : activePassSizes.length > 0
        ? activePassSizes.reduce((a, b) => a + b, 0) / activePassSizes.length
        : 1;
  const physicalSlipCount =
    explicitPhysicalSlipCount != null && explicitPhysicalSlipCount > 0
      ? explicitPhysicalSlipCount
      : tickets.length > 0
        ? consolidateTerminalPhysicalSlips(tickets).length ||
          countPhysical99xSlips(tickets)
        : 1;

  const objZeroProb =
    totalCost > 0
      ? Math.min(
          1,
          Math.max(
            0,
            Number(
              objEval?.zeroPayoutProb ??
                (objEval?.anyWinProb != null ? 1 - objEval.anyWinProb : 0)
            )
          )
        )
      : 0;
  const objPartialProb =
    totalCost > 0
      ? Math.min(1, Math.max(0, Number(objEval?.partialLossProb ?? 0)))
      : 0;
  const objBreakEvenProb =
    totalCost > 0
      ? Math.min(1, Math.max(0, Number(objEval?.breakEvenProb ?? 0)))
      : 0;
  const isGuaranteedLossSlip =
    effectiveOdds > 0 &&
    effectiveOdds <= 1.0 &&
    activePassSizes.length === 1 &&
    activePassSizes[0] === matchCount;

  const rawDanger =
    objZeroProb * 52 +
    objPartialProb * 32 +
    objBreakEvenProb * 8 +
    Math.max(0, Number(avgVigLossPer100 || 0) - 10) * 0.45 +
    Math.max(0, avgPassLen - 1) * 7 +
    (isGuaranteedLossSlip ? 25 : 0);
  const dangerScore = !(totalCost > 0)
    ? 0
    : Math.min(99, Math.max(8, Math.round(rawDanger)));

  const warnings = [];
  if (matchCount > poolCap && !forceSingleOnly) {
    warnings.push({
      id: "pool-pass-cap",
      severity: "tip",
      title: `玩法最高过关自动限流（已按最高 ${poolCap} 关拆票）`,
      detail:
        poolCap <= 4
          ? "所选包含「比分 / 半全场」玩法，按中国体彩规则单注最高仅限 4 关，已自动禁用 5~8 关。"
          : "所选包含「总进球」玩法，按中国体彩规则单注最高仅限 6 关，已自动禁用 7~8 关。",
    });
  }

  if (totalCost > 0 && objZeroProb > 0.8) {
    const tenCountText = Number((objZeroProb * 10).toFixed(1)).toString();
    const isPureSingleSlip =
      (tickets.length > 0 &&
        tickets.every(
          (tk) => Array.isArray(tk.legs) && tk.legs.length === 1
        )) ||
      (activePassSizes.length === 1 && activePassSizes[0] === 1);
    warnings.push({
      id: "high-wipeout-lottery",
      severity: "danger",
      title: `高归零彩票化红牌：整单归零率高达 ${(objZeroProb * 100).toFixed(1)}%`,
      detail: isPureSingleSlip
        ? `按客观去水分布测算，投 10 次约有 ${tenCountText} 次整单归零（派奖 ¥0，损失全部 ¥${totalCost} 本金）；高赔单关搏冷命中率偏低、资金波动较大，请严控娱乐轻仓或补充同场次选护盾。`
        : `按客观去水分布测算，投 10 次约有 ${tenCountText} 次整单归零（派奖 ¥0，损失全部 ¥${totalCost} 本金）；高赔串关极易沦为低命中彩票，请下调过关阶数或严控娱乐轻仓。`,
    });
  }

  if (isGuaranteedLossSlip) {
    warnings.push({
      id: "guaranteed-loss",
      severity: "danger",
      title: `必亏盘红灯拦截（合成等效水位仅 ${effectiveOdds.toFixed(2)}）`,
      detail:
        "同场包号过多，无论如何分配倍数都注定亏本或大面积倒贴！请至少砍掉 1~2 个高赔低概率鸡肋项。",
    });
  } else if (underwaterCount > 0) {
    warnings.push({
      id: "underwater",
      severity: "danger",
      title: `假中奖警报：${underwaterCount}/${comboCount} 种命中场景实际倒贴钱！`,
      detail: `最高派奖 ${maxPayout.toFixed(2)} 元，但低赔或局部命中时最低仅返 ${minPayout.toFixed(2)} 元（净亏 ${(totalCost - minPayout).toFixed(2)} 元）。${
        breakevenUpgradeCost
          ? `✨ 开启奖金优化并将总本金调至 ${breakevenUpgradeCost} 元即可实现 100% 组合零亏损保本！`
          : "建议使用「三模奖金优化」重新分配各注倍数。"
      }`,
    });
  }

  if (hasSameMatchCrossPoolConflict) {
    warnings.push({
      id: "cross-pool-same-match",
      severity: "warn",
      title: "同场双单关独立计奖提醒（已强制锁定单关）",
      detail:
        "同一场比赛勾选了两个已开单关玩法，按中国体彩规则仅支持【单关】独立计奖，不可参与串关。",
    });
  }

  if (avgPassLen >= 2 && (avgPassLen >= 4 || avgPayoutRatio < 0.72)) {
    const passSummaryLabel =
      activePassSizes.length > 0
        ? activePassSizes.map((k) => (k === 1 ? "单关" : `${k}串1`)).join("+")
        : `${Math.round(avgPassLen)}串1`;
    warnings.push({
      id: "parlay-vig",
      severity: "danger",
      title: `串关连乘抽水雪崩：体彩已暗扣 ${avgVigLossPer100}% 数学期望`,
      detail: `当前 ${passSummaryLabel} 综合返还率跌至 ${(avgPayoutRatio * 100).toFixed(1)}%；建议下调至 2关/单关 或改选低抽水主盘防黑单场。`,
    });
  }

  const fallbackMaxPass =
    activePassSizes.length > 0 ? Math.max(...activePassSizes) : 1;
  const maxClippedPassSize = tickets
    .filter((c) => c.cappedClipped > 0)
    .reduce(
      (mx, c) => Math.max(mx, effectiveNonVoidLegCount(c.legs ?? [])),
      fallbackMaxPass
    );
  const maxTierCap = statutorySingleBetCap(maxClippedPassSize);
  const totalClipped = tickets.reduce((a, c) => a + (c.cappedClipped || 0), 0);
  if (totalClipped > 0 || maxMultiple > 99) {
    warnings.push({
      id: "cap-clip",
      severity: totalClipped > 0 ? "danger" : "warn",
      title:
        totalClipped > 0
          ? `封顶截断警告：有 ${totalClipped.toFixed(0)} 元超额奖金将被体彩无偿没收！`
          : `超出单张实票 99 倍上限（体彩店需拆成 ${physicalSlipCount} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${maxTierCap / 10000} 万元法定单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : "终端机单张实票最高 99 倍，已按 99 倍上限自动核算店面拆票张数。",
    });
  }

  if (hasInvalidOdds) {
    warnings.push(buildInvalidOddsStatutoryWarning());
  }

  if (totalCost > 20_000) {
    warnings.push({
      id: "order-limit-20k",
      severity: "danger",
      title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${totalCost}）`,
      detail:
        "中国体彩规定单次订单投注金额不得超过 20,000 元，请调低倍数或分批打票。",
    });
  } else if (totalCost > 6_000) {
    warnings.push({
      id: "rational-6k",
      severity: "warn",
      title: `大额投注风控提醒（当前总投入 ¥${totalCost} 已超 ¥6,000）`,
      detail: "触发体彩官方大额理性购彩阈值，请严格核对今日止损护栏额度。",
    });
  }

  return { dangerScore, warnings };
}

function assembleEvaluatedTruthReport({
  matchCount,
  betCount,
  betCountUnit = "logical-lines",
  comboCount,
  multiple,
  modeLabel,
  canSingle,
  canCheckout,
  ruleBlockReason,
  selectionStatus,
  distributionStatus,
  basicExpandedCount,
  logicalLineCount,
  stakeUnitsCount,
  physicalSlips,
  breakevenCert,
  singlePoolAlternatives,
  crossPoolSingleAlternatives,
  poolCap,
  activePassSizes,
  activeComboCode,
  bankerMatchIds,
  availableFreePasses,
  availableComboPasses,
  hasSameMatchCrossPoolConflict,
  totalCost,
  jointEval,
  objEval,
  hasSubjectiveShift,
  avgPayoutRatio,
  avgVigLossPer100,
  dangerScore,
  effectiveOdds,
  breakevenUpgradeCost,
  consolidatedTickets,
  syntheticHint,
  syntheticRescuePicks,
  tickets,
  warnings,
}) {
  const resolvedPhysicalSlips = Array.isArray(physicalSlips)
    ? physicalSlips
    : [];
  const resolvedPhysicalSlipCount =
    resolvedPhysicalSlips.length > 0
      ? resolvedPhysicalSlips.length
      : consolidatedTickets;
  return {
    matchCount,
    betCount,
    betCountUnit,
    comboCount,
    multiple,
    modeLabel,
    canSingle,
    canCheckout,
    ruleBlockReason,
    selectionStatus:
      selectionStatus ??
      (!(totalCost > 0) ? "empty" : canCheckout ? "ready" : "rule-blocked"),
    distributionStatus:
      distributionStatus ?? (!(totalCost > 0) ? "none" : "computed"),
    basicExpandedCount:
      basicExpandedCount ??
      (Array.isArray(tickets) ? tickets.length : betCount),
    logicalLineCount:
      logicalLineCount ?? (Array.isArray(tickets) ? tickets.length : betCount),
    stakeUnitsCount:
      stakeUnitsCount ?? Math.max(0, Math.round((Number(totalCost) || 0) / 2)),
    physicalSlipCount: resolvedPhysicalSlipCount,
    physicalSlips: resolvedPhysicalSlips,
    poolCap,
    activePassSizes,
    activeComboCode,
    bankerMatchIds,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    isEmptySlip: Boolean(jointEval.isEmptySlip ?? !(totalCost > 0)),
    totalCost,
    minPayout: jointEval.minPayout,
    maxPayout: jointEval.maxPayout,
    conditionalMinHitPayout:
      jointEval.conditionalMinHitPayout ?? jointEval.minPayout,
    conditionalMaxHitPayout:
      jointEval.conditionalMaxHitPayout ?? jointEval.maxPayout,
    isUnconditionalFloorGuaranteed: Boolean(
      jointEval.isUnconditionalFloorGuaranteed ??
      (totalCost > 0 &&
        (jointEval.zeroPayoutProb ?? 1) <= 1e-12 &&
        (jointEval.partialLossProb ?? 0) <= 1e-12)
    ),
    unconditionalQuantiles: jointEval.unconditionalQuantiles ?? {
      p20: 0,
      p50: 0,
      p80: 0,
      p99: 0,
    },
    objectiveUnconditionalQuantiles: objEval.unconditionalQuantiles ??
      jointEval.unconditionalQuantiles ?? {
        p20: 0,
        p50: 0,
        p80: 0,
        p99: 0,
      },
    likelyRange: jointEval.likelyRange,
    anyWinProb: jointEval.anyWinProb,
    zeroPayoutProb: jointEval.zeroPayoutProb ?? 0,
    zeroPayoutZeroHitProb: jointEval.zeroPayoutZeroHitProb ?? 0,
    zeroPayoutSubThresholdProb: jointEval.zeroPayoutSubThresholdProb ?? 0,
    ...(totalCost > 0 && (jointEval.zeroPayoutProb ?? 0) > 1e-12
      ? {
          zeroPayoutSummaryRow: {
            id: "miss-all",
            desc: "整单无中奖票（返奖 ¥0）",
            legs: [],
            prob: jointEval.zeroPayoutProb ?? 0,
            unitPayout: 0,
            totalPayout: 0,
            returnMultiple: 0,
            hitMatchCount: 0,
            hitTicketNos: [],
            hitTicketIds: [],
            isZeroPayoutSummary: true,
            zeroHitProb: jointEval.zeroPayoutZeroHitProb ?? 0,
            subThresholdHitProb: jointEval.zeroPayoutSubThresholdProb ?? 0,
            cappedClipped: 0,
            netProfit: -Number(totalCost.toFixed(2)),
            isUnderwater: false,
          },
        }
      : {}),
    partialLossProb: jointEval.partialLossProb ?? 0,
    partialLossShortfall:
      objEval.partialLossShortfall ?? jointEval.partialLossShortfall ?? 0,
    totalCapitalShortfallD:
      objEval.totalCapitalShortfallD ?? jointEval.totalCapitalShortfallD ?? 0,
    realProfitProb: jointEval.realProfitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
    objectiveZeroPayoutProb:
      objEval.zeroPayoutProb ?? jointEval.zeroPayoutProb ?? 0,
    objectivePartialLossProb:
      objEval.partialLossProb ?? jointEval.partialLossProb ?? 0,
    objectiveBreakEvenProb: objEval.breakEvenProb ?? jointEval.breakEvenProb,
    underwaterCount: jointEval.underwaterCount,
    underwaterShareOfWins: jointEval.underwaterShareOfWins,
    avgPayoutRatio,
    avgVigLossPer100,
    expectedValueRate: jointEval.expectedValueRate,
    objectiveEVRate: objEval.expectedValueRate,
    objectiveProfitProb: objEval.realProfitProb,
    objectiveStrictNetGainProb: objEval.strictNetGainProb,
    subjectiveProjectedEVRate: hasSubjectiveShift
      ? jointEval.expectedValueRate
      : null,
    subjectiveProjectedProfitProb: hasSubjectiveShift
      ? jointEval.realProfitProb
      : null,
    dangerScore,
    effectiveOdds,
    breakevenUpgradeCost,
    breakevenCert: breakevenCert ?? null,
    consolidatedTickets: resolvedPhysicalSlipCount,
    syntheticHint,
    syntheticRescuePicks,
    ...(singlePoolAlternatives ? { singlePoolAlternatives } : {}),
    ...(crossPoolSingleAlternatives ? { crossPoolSingleAlternatives } : {}),
    tickets,
    combos: jointEval.combos,
    warnings,
  };
}

function attachCachedJointEval(
  targetPlan,
  { matchesRef, totalCost, lines, jointEval, objEval, hasSubjectiveFilter }
) {
  Object.defineProperty(targetPlan, "_cachedJointEval", {
    value: {
      matchesRef,
      totalCost,
      linesSig: computePlanLinesEvalSig(lines),
      jointEval,
      objEval,
      hasSubjectiveFilter,
    },
    enumerable: false,
    configurable: true,
  });
}

export function buildSandboxAdjustedBundle(
  picks,
  matches,
  simVoidFirstMatch,
  subjectiveDeltaPct,
  voidMatchIdsOrOpts = null
) {
  const voidMatchIds = Array.isArray(voidMatchIdsOrOpts)
    ? voidMatchIdsOrOpts
    : (voidMatchIdsOrOpts?.voidMatchIds ?? null);
  const voidMatchSet = resolveVoidMatchSet({
    matches,
    picks,
    simVoidFirstMatch,
    voidMatchIds,
  });
  const { contexts, atomicMap } = resolveMatchAtomicContexts(picks, matches, {
    mode: "workspace-picks",
    subjectiveDeltaPct,
  });

  const adjustedPicks = picks.map((pk) => {
    const { isVoid: _prevVoid, ...cleanPk } = pk;
    const ctx = contexts.get(pk.matchId);
    const fm = ctx?.fm ?? null;
    const pool = fm?.pools?.[pk.poolCode];
    const authOpt = pool?.options?.find(
      (o) => o.key === pk.optionKey || o.label === pk.optionLabel
    );
    const baseOdds =
      pool?.selling === false
        ? 0
        : authOpt
          ? authOpt.odds
          : fm
            ? 0
            : clampSandboxCustomOdds(pk.odds);
    const isVoid = voidMatchSet.has(String(pk.matchId)) && baseOdds > 0;
    const odds = isVoid ? 1.0 : baseOdds;
    const prob = ctx
      ? sumOptionProbOnAtomic(
          ctx.shifted,
          pk.poolCode,
          pk.optionKey,
          pk.optionLabel,
          ctx.gl
        )
      : Number(pk.fairProb) || 0.25;
    return {
      ...cleanPk,
      singleAllowed: pool
        ? isPoolSingleEligible(pool)
        : Boolean(pk.canSingle ?? pk.singleAllowed),
      canSingle: pool
        ? isPoolSingleEligible(pool)
        : Boolean(pk.canSingle ?? pk.singleAllowed),
      canAllUp: pool ? isPoolAllUpEligible(pool) : pk.canAllUp !== false,
      odds,
      ...(isVoid ? { isVoid: true } : {}),
      fairProb: prob > 0 ? prob : Number(pk.fairProb) || 0.02,
    };
  });

  return { picks: adjustedPicks, atomicMap, voidMatchSet };
}

export function applySandboxToPlan(
  basePlan,
  matches,
  picks,
  simVoidFirstMatch,
  subjectiveDeltaPct,
  {
    isArchetype = false,
    hasFrozenSnapshot = false,
    consolidateTickets = undefined,
    stance = "objective",
    objectiveHitMatrix = null,
    targetFirstMid = null,
    voidMatchIds = null,
  } = {}
) {
  if (!isValidPlanObject(basePlan)) return null;
  const planMatchIds = new Set();
  const rawPlanLegs = [];
  for (const l of basePlan.lines) {
    for (const lg of l.legs) {
      if (lg?.matchId) {
        planMatchIds.add(lg.matchId);
        rawPlanLegs.push(lg);
      }
    }
  }
  const hasExplicitVoidList =
    Array.isArray(voidMatchIds) && voidMatchIds.length > 0;
  const voidMatchSet = hasExplicitVoidList
    ? resolveVoidMatchSet({
        matches,
        candidateMatchIds: Array.from(planMatchIds),
        picks,
        simVoidFirstMatch: false,
        voidMatchIds,
      })
    : simVoidFirstMatch &&
        targetFirstMid &&
        planMatchIds.has(String(targetFirstMid))
      ? new Set([String(targetFirstMid)])
      : resolveVoidMatchSet({
          matches,
          candidateMatchIds: Array.from(planMatchIds),
          picks,
          simVoidFirstMatch,
          voidMatchIds: null,
        });

  const {
    contexts: planAtomicByMatch,
    atomicMap: atomicMapForEval,
    objectiveAtomicMap: objAtomicByMatch,
  } = resolveMatchAtomicContexts(rawPlanLegs, matches, {
    mode: "sandbox-plan",
    isArchetype,
    hasFrozenSnapshot,
    stance,
    subjectiveDeltaPct,
  });

  const manualPicksByMatch = new Map();
  if (Array.isArray(picks)) {
    for (const pk of picks) {
      if (!pk?.matchId) continue;
      const arr = manualPicksByMatch.get(pk.matchId) || [];
      arr.push(pk);
      manualPicksByMatch.set(pk.matchId, arr);
    }
  }
  const hasManualPicks = manualPicksByMatch.size > 0;
  const freePrimaryLegByMatch = new Map();
  const resolveAppliedLegSource = (lg) => {
    if (
      lg.legSource === "manual-anchor" ||
      lg.legSource === "same-match-shield" ||
      lg.legSource === "cross-pool-substitute" ||
      lg.legSource === "bridge-mate"
    ) {
      return lg.legSource;
    }
    if (hasManualPicks) {
      const mPicks = manualPicksByMatch.get(lg.matchId);
      if (!mPicks || mPicks.length === 0) return "bridge-mate";
      if (
        mPicks.some(
          (p) => p.poolCode === lg.poolCode && p.optionKey === lg.optionKey
        )
      ) {
        return "manual-anchor";
      }
      if (mPicks.some((p) => p.poolCode === lg.poolCode)) {
        return "same-match-shield";
      }
      return "cross-pool-substitute";
    }
    const curSig = `${lg.poolCode}:${lg.optionKey}`;
    const firstSig = freePrimaryLegByMatch.get(lg.matchId);
    if (!firstSig) {
      freePrimaryLegByMatch.set(lg.matchId, curSig);
      return "bridge-mate";
    }
    if (firstSig === curSig) return "bridge-mate";
    return lg.poolCode === firstSig.split(":")[0]
      ? "same-match-shield"
      : "cross-pool-substitute";
  };

  const resolvedLegCache = new Map();
  const lines = basePlan.lines.map((l) => {
    const legs = l.legs.map((lg) => {
      const { isVoid: _prevVoid, ...cleanLg } = lg;
      const cacheKey = `${lg.matchId}:${lg.poolCode}:${lg.optionKey}:${lg.optionLabel}`;
      let hit = resolvedLegCache.get(cacheKey);
      if (!hit) {
        const ctx = planAtomicByMatch.get(lg.matchId);
        const fm = ctx?.fm ?? null;
        const pool = fm?.pools?.[lg.poolCode];
        const authOpt = pool?.options?.find(
          (o) => o.key === lg.optionKey || o.label === lg.optionLabel
        );
        const baseOdds =
          pool?.selling === false
            ? 0
            : authOpt
              ? authOpt.odds
              : fm
                ? 0
                : clampSandboxCustomOdds(lg.odds);
        const isVoid = voidMatchSet.has(String(lg.matchId)) && baseOdds > 0;
        const odds = isVoid ? 1.0 : baseOdds;
        const fairProb = ctx
          ? sumOptionProbOnAtomic(
              ctx.shifted,
              lg.poolCode,
              lg.optionKey,
              lg.optionLabel,
              ctx.gl
            )
          : Number(lg.fairProb) || 0.25;
        hit = {
          odds,
          isVoid,
          fairProb: fairProb > 0 ? fairProb : Number(lg.fairProb) || 0.02,
        };
        resolvedLegCache.set(cacheKey, hit);
      }
      return {
        ...cleanLg,
        odds: hit.odds,
        ...(hit.isVoid ? { isVoid: true } : {}),
        fairProb: hit.fairProb,
        legSource: resolveAppliedLegSource(lg),
      };
    });
    const prob = legs.reduce(
      (acc, it) => acc * (it.isVoid ? 1 : it.fairProb),
      1
    );
    const { mult, cost, unitPayout, cappedClipped, returnPayout } =
      computeLineStatutoryPayout(legs, l.multiple, voidMatchSet);
    return {
      ...l,
      legs,
      multiple: mult,
      cost,
      unitPayout,
      cappedClipped,
      returnPayout,
      netProfit: 0,
      prob,
    };
  });

  let totalCost = lines.reduce((a, l) => a + l.cost, 0);
  if (
    isArchetype &&
    consolidateTickets &&
    lines.length >= 2 &&
    voidMatchSet.size === 0 &&
    Math.min(...lines.map((l) => l.multiple)) >= 15
  ) {
    const cMults = consolidateCloseMultiples(
      lines.map((l) => l.multiple),
      lines.map((l) => l.unitPayout),
      lines.map((l) => (l.cappedClipped ?? 0) > 0),
      lines.map((l) => (l.legs ?? []).length || 1),
      totalCost
    );
    for (let idx = 0; idx < lines.length; idx++) {
      const m = cMults[idx];
      if (m !== lines[idx].multiple) {
        const st = computeLineStatutoryPayout(lines[idx].legs, m, voidMatchSet);
        lines[idx] = {
          ...lines[idx],
          multiple: st.mult,
          cost: st.cost,
          unitPayout: st.unitPayout,
          cappedClipped: st.cappedClipped,
          returnPayout: st.returnPayout,
        };
      }
    }
    totalCost = lines.reduce((a, l) => a + l.cost, 0);
  }
  lines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - totalCost).toFixed(2));
  });

  const ticketRowsForEval = lines.map((l, idx) => ({
    id: l.id,
    ticketNo: idx + 1,
    desc: `${l.roleLabel}(${l.multiple}倍) · ${l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join("×")}`,
    legs: l.legs,
    multiple: l.multiple,
    cost: l.cost,
    stakeCost: l.cost,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: l.cappedClipped ?? 0,
  }));
  const evalVoidOpts = voidMatchSet.size > 0 ? { voidMatchSet } : {};
  const hasSubjectiveFilter =
    (Number(subjectiveDeltaPct) || 0) !== 0 ||
    (isArchetype && stance !== "objective");
  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRowsForEval,
    totalCost,
    matches,
    atomicMapForEval,
    {
      ...evalVoidOpts,
      reusableHitMatrix:
        !hasSubjectiveFilter && voidMatchSet.size === 0 && objectiveHitMatrix
          ? objectiveHitMatrix
          : null,
    }
  );
  const objEval =
    hasSubjectiveFilter || hasFrozenSnapshot
      ? evaluateTicketsOnQuotientSpace(
          ticketRowsForEval,
          totalCost,
          matches,
          objAtomicByMatch,
          {
            metricsOnly: true,
            reusableHitMatrix:
              voidMatchSet.size === 0 && objectiveHitMatrix
                ? objectiveHitMatrix
                : null,
            ...evalVoidOpts,
          }
        )
      : jointEval;
  const { vigPct } = computeCapitalWeightedVig(lines, matches);

  const hasMissOne =
    typeof basePlan.missOneReturn === "number" &&
    Number.isFinite(basePlan.missOneReturn);

  let missOneReturn = null;
  if (hasMissOne) {
    const distinctMids = Array.from(planMatchIds);
    if (distinctMids.length >= 2) {
      const hasSubMatchTicket = lines.some((l) =>
        distinctMids.some((mid) => !l.legs.some((g) => g.matchId === mid))
      );
      missOneReturn = hasSubMatchTicket
        ? computeSurvivingMissOneFloor(lines, distinctMids)
        : jointEval.minPayout;
    } else {
      missOneReturn = jointEval.minPayout;
    }
  }

  const minReturn = jointEval.minPayout;
  const maxReturn = jointEval.maxPayout;
  const winProb = jointEval.anyWinProb;
  const profitProb = jointEval.realProfitProb;

  const isUncondSandboxFloor =
    totalCost > 0 &&
    (jointEval.zeroPayoutProb ?? Math.max(0, 1 - winProb)) <= 1e-12 &&
    jointEval.underwaterCount === 0;
  const nextTagline = !isArchetype
    ? `总投入 ¥${totalCost} · ${
        isUncondSandboxFloor ? "保底返" : "命中返"
      } ¥${minReturn.toFixed(1)} ~ 最高 ¥${maxReturn.toFixed(1)}`
    : basePlan.tagline;

  const effectiveConsolidate =
    consolidateTickets !== undefined
      ? Boolean(consolidateTickets)
      : basePlan.consolidateTickets !== false;
  const canReuseBaseSlips =
    Array.isArray(basePlan.physicalSlips) &&
    basePlan.physicalSlips.length > 0 &&
    (basePlan.consolidateTickets !== false) === effectiveConsolidate &&
    voidMatchSet.size === 0 &&
    lines.length === basePlan.lines.length &&
    lines.every((ln, idx) => ln.multiple === basePlan.lines[idx]?.multiple);
  const physicalSlips = canReuseBaseSlips
    ? basePlan.physicalSlips
    : consolidateTerminalPhysicalSlips(lines, {
        consolidate: effectiveConsolidate,
      });
  const stakeUnitsCount = Math.max(lines.length, Math.round(totalCost / 2));
  const outPlan = {
    ...shallowClonePlanWithoutConsolidated(basePlan),
    tagline: nextTagline,
    totalCost,
    minReturn,
    maxReturn,
    winProb,
    profitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
    expectedValueRate: jointEval.expectedValueRate,
    objectiveEVRate: objEval.expectedValueRate,
    objectiveProfitProb: objEval.realProfitProb,
    objectiveStrictNetGainProb: objEval.strictNetGainProb,
    subjectiveProjectedEVRate: hasSubjectiveFilter
      ? jointEval.expectedValueRate
      : null,
    subjectiveProjectedProfitProb: hasSubjectiveFilter
      ? jointEval.realProfitProb
      : null,
    underwaterCount: jointEval.underwaterCount,
    stakeUnitsCount,
    logicalGroupCount: lines.length,
    physicalTicketCount: physicalSlips.length,
    physicalSlips,
    zeroPayoutProb: jointEval.zeroPayoutProb ?? Math.max(0, 1 - winProb),
    missOneReturn,
    consolidateTickets: effectiveConsolidate,
    vigPct,
    reasons: basePlan.reasons,
    lines,
  };
  attachLazyConsolidatedLines(
    outPlan,
    lines,
    Boolean(isArchetype && consolidateTickets) ||
      Boolean(basePlan.consolidateTickets)
  );
  if (TRUSTED_SERVER_BONUS_PLANS.has(basePlan)) {
    TRUSTED_SERVER_BONUS_PLANS.add(outPlan);
  }
  attachCachedJointEval(outPlan, {
    matchesRef: matches,
    totalCost,
    lines,
    jointEval,
    objEval,
    hasSubjectiveFilter,
  });
  return outPlan;
}

function computePlanLinesEvalSig(lines) {
  if (!Array.isArray(lines)) return "";
  let sig = `${lines.length}`;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    sig += `|${l.multiple}:${l.unitPayout}:${l.returnPayout ?? ""}:`;
    const legs = l.legs || [];
    for (let j = 0; j < legs.length; j++) {
      const g = legs[j];
      sig += `${j > 0 ? "," : ""}${g.matchId}/${g.poolCode}/${g.optionKey}@${g.odds}${g.isVoid ? "!V" : ""}~${Number(g.fairProb ?? 0).toFixed(8)}`;
    }
  }
  return sig;
}

export function archetypeToReport(plan, fallbackManual, matches = null) {
  if (!isValidPlanObject(plan)) {
    if (
      fallbackManual == null &&
      plan &&
      typeof plan === "object" &&
      Array.isArray(plan.lines) &&
      plan.lines.length === 0
    ) {
      return buildBlockedTruthReport({
        matchCount: 0,
        multiple: 1,
        modeLabel: `${plan.shortTab || "精算配单"}·空仓`,
        canSingle: false,
        ruleBlockReason: plan.emptyReason || "未达准入红线",
        selectionStatus: "empty",
        distributionStatus: "none",
      });
    }
    return fallbackManual;
  }
  const matchSet = new Set();
  const sizeSet = new Set();
  const planVoidSet = new Set();
  plan.lines.forEach((l) => {
    sizeSet.add(l.legs.length);
    l.legs.forEach((lg) => {
      matchSet.add(lg.matchId);
      if (lg?.isVoid) planVoidSet.add(String(lg.matchId));
    });
  });
  const hasVoidLegs = planVoidSet.size > 0;
  const physicalTickets = plan.lines.map((l, idx) => {
    const {
      mult,
      cap,
      unitBeforeCap,
      unitPayout: statutoryUnit,
    } = computeLineStatutoryPayout(
      l.legs,
      l.multiple,
      hasVoidLegs ? planVoidSet : null
    );
    const effectiveUnit = hasVoidLegs
      ? statutoryUnit
      : Math.min(cap, Number(l.unitPayout));
    const derivedClip =
      unitBeforeCap > cap
        ? Math.max(
            0,
            Number(((unitBeforeCap - effectiveUnit) * mult).toFixed(2))
          )
        : 0;
    const lineClipped =
      typeof l.cappedClipped === "number" &&
      Number.isFinite(l.cappedClipped) &&
      l.cappedClipped > 0
        ? Math.max(l.cappedClipped, derivedClip)
        : derivedClip;
    const returnPayout = Number(
      l.returnPayout ?? (effectiveUnit * mult).toFixed(2)
    );
    const netProfit = Number((returnPayout - plan.totalCost).toFixed(2));
    return {
      id: l.id,
      ticketNo: idx + 1,
      desc:
        `${l.roleLabel}(${l.multiple}倍) · ` +
        l.legs
          .map(
            (g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`
          )
          .join("×"),
      legs: l.legs,
      multiple: mult,
      cost: mult * 2,
      stakeCost: mult * 2,
      matchPairKey: l.legs.map((g) => String(g.matchId || "")).join("×"),
      matchPairLabel: l.legs
        .map((g) => String(g.matchNumStr || g.home || g.matchId || ""))
        .join(" × "),
      prob: l.prob,
      unitPayout: effectiveUnit,
      totalPayout: returnPayout,
      returnMultiple:
        plan.totalCost > 0
          ? Number((returnPayout / plan.totalCost).toFixed(4))
          : 0,
      cappedClipped: lineClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  });

  let jointEval = null;
  let objEval = null;
  let hasSubjectiveFilter = Boolean(plan.subjectiveProjectedEVRate != null);
  if (
    plan._cachedJointEval &&
    plan._cachedJointEval.matchesRef === matches &&
    plan._cachedJointEval.totalCost === plan.totalCost &&
    Array.isArray(plan._cachedJointEval.jointEval?.combos) &&
    plan._cachedJointEval.jointEval.combos.length > 0 &&
    plan._cachedJointEval.linesSig === computePlanLinesEvalSig(plan.lines)
  ) {
    jointEval = plan._cachedJointEval.jointEval;
    objEval = plan._cachedJointEval.objEval ?? jointEval;
    hasSubjectiveFilter = Boolean(plan._cachedJointEval.hasSubjectiveFilter);
  } else {
    const { atomicMap, objectiveAtomicMap } = resolveMatchAtomicContexts(
      plan.lines.flatMap((l) => l.legs),
      matches,
      { mode: "plan-legs" }
    );
    const evalVoidOpts = hasVoidLegs ? { voidMatchSet: planVoidSet } : {};
    jointEval = evaluateTicketsOnQuotientSpace(
      physicalTickets,
      plan.totalCost,
      matches,
      atomicMap,
      evalVoidOpts
    );
    objEval =
      Array.isArray(matches) && matches.length > 0
        ? evaluateTicketsOnQuotientSpace(
            physicalTickets,
            plan.totalCost,
            matches,
            objectiveAtomicMap,
            { metricsOnly: true, ...evalVoidOpts }
          )
        : jointEval;
  }

  const invUnitSum = physicalTickets.reduce(
    (a, c) => a + 2 / Math.max(0.01, c.unitPayout),
    0
  );
  const harmonicEffOdds = invUnitSum > 0 ? 1 / invUnitSum : 0;
  const activeSizes = Array.from(sizeSet)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b);

  const shouldConsolidate = plan.consolidateTickets !== false;
  const physicalSlips =
    Array.isArray(plan.physicalSlips) &&
    plan.physicalSlips.length > 0 &&
    !hasVoidLegs &&
    (shouldConsolidate || plan.physicalSlips.length >= plan.lines.length)
      ? plan.physicalSlips
      : consolidateTerminalPhysicalSlips(plan.lines, {
          consolidate: shouldConsolidate,
        });
  const consolidatedTickets = physicalSlips.length;

  const hasInvalidOdds = plan.lines.some((l) =>
    l.legs.some((g) => !(Number(g.odds) > 0))
  );
  const over20k = plan.totalCost > 20_000;
  const canCheckout = plan.lines.length > 0 && !over20k && !hasInvalidOdds;
  const stakeUnits = Math.max(
    plan.lines.length,
    Math.round((Number(plan.totalCost) || 0) / 2)
  );
  const resolvedBreakevenUpgradeCost =
    jointEval.underwaterCount > 0
      ? (plan.breakevenUpgradeCost ??
        (fallbackManual?.breakevenUpgradeCost &&
        fallbackManual.breakevenUpgradeCost > plan.totalCost
          ? fallbackManual.breakevenUpgradeCost
          : null))
      : null;

  const hasExplicitMatches = Array.isArray(matches) && matches.length > 0;
  const computedVig = computeCapitalWeightedVig(physicalTickets, matches);
  const useComputedVig = hasExplicitMatches || !(Number(plan.vigPct) > 0);
  const effectiveVigPct = useComputedVig
    ? computedVig.vigPct
    : Number(plan.vigPct);
  const avgPayoutRatio = useComputedVig
    ? computedVig.avgPayoutRatio
    : Math.max(0, Math.min(1, (100 - effectiveVigPct) / 100));

  const { dangerScore: planDangerScore, warnings: planWarnings } =
    computeUnifiedSlipDangerAndWarnings({
      tickets: physicalTickets,
      totalCost: plan.totalCost,
      minPayout: jointEval.minPayout,
      maxPayout: jointEval.maxPayout,
      comboCount: jointEval.combos.length,
      underwaterCount: jointEval.underwaterCount,
      breakevenUpgradeCost: resolvedBreakevenUpgradeCost,
      effectiveOdds: harmonicEffOdds,
      matchCount: matchSet.size,
      poolCap: fallbackManual?.poolCap ?? 8,
      activePassSizes: activeSizes,
      avgPayoutRatio,
      avgVigLossPer100: effectiveVigPct,
      objEval,
      hasInvalidOdds,
      physicalSlipCount: consolidatedTickets,
    });

  return assembleEvaluatedTruthReport({
    matchCount: matchSet.size,
    betCount: stakeUnits,
    betCountUnit: "stake-units",
    comboCount: jointEval.combos.length,
    multiple: 1,
    modeLabel: `${plan.shortTab}·分倍精算`,
    canSingle: matchSet.size === 1,
    canCheckout,
    ruleBlockReason: hasInvalidOdds
      ? "选单包含未开售或无效赔率选项"
      : over20k
        ? `单次订单金额 ¥${plan.totalCost} 超出体彩 ¥20,000 硬上限，请调低仓位或分单`
        : null,
    selectionStatus:
      plan.lines.length === 0
        ? "empty"
        : canCheckout
          ? "ready"
          : "rule-blocked",
    distributionStatus: physicalTickets.length > 0 ? "computed" : "none",
    basicExpandedCount: plan.lines.length,
    logicalLineCount: plan.lines.length,
    stakeUnitsCount: stakeUnits,
    physicalSlips,
    breakevenCert: plan.breakevenCert ?? null,
    poolCap: fallbackManual?.poolCap ?? 8,
    activePassSizes: activeSizes,
    activeComboCode: null,
    bankerMatchIds: Array.isArray(fallbackManual?.bankerMatchIds)
      ? fallbackManual.bankerMatchIds.filter(
          (id) =>
            matchSet.has(id) &&
            plan.lines.every((l) => l.legs.some((lg) => lg.matchId === id))
        )
      : [],
    availableFreePasses:
      fallbackManual?.availableFreePasses ??
      buildFreePassMetadata(
        matchSet.size,
        8,
        matchSet.size === 1,
        false,
        activeSizes
      ),
    availableComboPasses: fallbackManual?.availableComboPasses ?? [],
    hasSameMatchCrossPoolConflict: false,
    totalCost: plan.totalCost,
    jointEval,
    objEval,
    hasSubjectiveShift: hasSubjectiveFilter,
    avgPayoutRatio,
    avgVigLossPer100: effectiveVigPct,
    dangerScore: planDangerScore,
    effectiveOdds: harmonicEffOdds,
    breakevenUpgradeCost: resolvedBreakevenUpgradeCost,
    consolidatedTickets,
    syntheticHint: `已启用【${plan.badge}】：${
      plan.totalCost > 0 &&
      (jointEval.zeroPayoutProb ?? Math.max(0, 1 - jointEval.anyWinProb)) <=
        1e-12 &&
      jointEval.underwaterCount === 0
        ? plan.tagline
        : String(plan.tagline || "").replace(/保底返\s*¥/g, "命中返 ¥")
    }`,
    syntheticRescuePicks: null,
    tickets: physicalTickets,
    warnings: planWarnings,
  });
}

export function normalizePortfolioKey(rawKey) {
  if (rawKey === "iron-shield") return "max-profit-prob";
  if (rawKey === "spear-shield") return "max-ev-utility";
  if (rawKey === "fault-tolerant") return "max-cvar-wheel";
  if (rawKey === "value-assassin") return "alpha-radar";
  if (rawKey === "goal-structure") return "max-ev-utility";
  if (
    rawKey === "max-profit-prob" ||
    rawKey === "max-ev-utility" ||
    rawKey === "max-cvar-wheel" ||
    rawKey === "alpha-radar"
  ) {
    return rawKey;
  }
  return "max-ev-utility";
}

export function buildXiaoGaoWarnings(picks, matches) {
  const matchIds = Array.from(new Set(picks.map((p) => p.matchId)));
  const out = [];
  for (const mid of matchIds) {
    const m = matches.find((x) => x.id === mid);
    if (!m?.aiAlert) continue;
    out.push({
      id: `xiaogao-${m.id}`,
      severity: m.aiAlert.level === "high" ? "danger" : "warn",
      title: `🧹 扫地僧小高靶向排雷 · ${m.matchNumStr} ${m.aiAlert.tag}`,
      detail: `${m.aiAlert.summary}（消息与变价时序对照：${m.aiAlert.priceInStatus}${
        m.aiAlert.suggestedDelta ? ` · ${m.aiAlert.suggestedDelta}` : ""
      }）`,
    });
  }
  return out;
}

// ==================== Spec 0013 · Official Sporttery Result Auto-Settlement ====================

const EXPLICIT_OFFICIAL_CRS_SCORES = new Set(
  OFFICIAL_CRS_PAIRS.map(([, lbl]) => lbl).filter((lbl) =>
    /^\d+:\d+$/.test(lbl)
  )
);

function resolveOfficialCrsKey(h2, a2) {
  const exact = `${h2}:${a2}`;
  if (EXPLICIT_OFFICIAL_CRS_SCORES.has(exact)) return exact;
  if (h2 > a2) return "胜其它";
  if (h2 === a2) return "平其它";
  return "负其它";
}

function evaluateSportteryPickOutcome(
  poolCode,
  optionKey,
  res,
  sealedGoalLine
) {
  if (!res || !res.settled) return "pending";
  if (res.isVoid) return "void";
  const h2 = res.h2;
  const a2 = res.a2;
  if (!Number.isInteger(h2) || !Number.isInteger(a2)) return "pending";
  const code = String(poolCode || "").toUpperCase();
  const key = String(optionKey || "").trim();

  if (code === "HAD") {
    const actual = h2 > a2 ? "h" : h2 === a2 ? "d" : "a";
    return key === actual ? "hit" : "miss";
  }
  if (code === "HHAD") {
    const rawGl = Number(sealedGoalLine ?? res.goalLine ?? -1);
    const gl = Number.isFinite(rawGl) && rawGl !== 0 ? rawGl : -1;
    const diff = h2 + gl - a2;
    const actual = diff > 0 ? "hh" : diff === 0 ? "hd" : "ha";
    return key === actual ? "hit" : "miss";
  }
  if (code === "TTG") {
    const tot = h2 + a2;
    const actual = tot >= 7 ? "s7" : `s${tot}`;
    return key === actual ? "hit" : "miss";
  }
  if (code === "HAFU") {
    if (!Number.isInteger(res.h1) || !Number.isInteger(res.a1)) {
      return "pending";
    }
    const c1 = res.h1 > res.a1 ? "h" : res.h1 === res.a1 ? "d" : "a";
    const c2 = h2 > a2 ? "h" : h2 === a2 ? "d" : "a";
    return key === `${c1}${c2}` ? "hit" : "miss";
  }
  if (code === "CRS") {
    const actual = resolveOfficialCrsKey(h2, a2);
    return key === actual ? "hit" : "miss";
  }
  return "pending";
}

function computeCappedTicketLinePayout(legOdds, nonVoidCount, multiple) {
  const cleanMult = Math.max(1, Math.round(Number(multiple) || 1));
  if (nonVoidCount <= 0) {
    return Number((2 * cleanMult).toFixed(2));
  }
  const rawUnit = bankerRoundParlayUnitPayout(legOdds);
  const cap = statutorySingleBetCap(nonVoidCount);
  const cappedUnit = Math.min(rawUnit, cap);
  return Number((cappedUnit * cleanMult).toFixed(2));
}

function solveDiscreteHedgeSplit(
  totalCost,
  targetReturn,
  lateHome,
  bestCand,
  baseGuaranteedReturn = 0
) {
  let hedgeCost = 2;
  let lockedNetProfit = -totalCost;
  let oppositeLabel = bestCand.label;
  const incrementalTarget = Math.max(2, targetReturn - baseGuaranteedReturn);

  if (
    bestCand.isPair &&
    Number(bestCand.odds1) > 0 &&
    Number(bestCand.odds2) > 0
  ) {
    const u1 = bankerRoundParlayUnitPayout([bestCand.odds1]);
    const u2 = bankerRoundParlayUnitPayout([bestCand.odds2]);
    const m1Mid = Math.max(1, Math.round(incrementalTarget / u1));
    const m2Mid = Math.max(1, Math.round(incrementalTarget / u2));
    let bestNet = -Infinity;
    let bestM1 = m1Mid;
    let bestM2 = m2Mid;
    for (let m1 = Math.max(1, m1Mid - 3); m1 <= m1Mid + 3; m1++) {
      for (let m2 = Math.max(1, m2Mid - 3); m2 <= m2Mid + 3; m2++) {
        const cHedge = 2 * (m1 + m2);
        const worstPay = Math.min(
          targetReturn,
          baseGuaranteedReturn + m1 * u1,
          baseGuaranteedReturn + m2 * u2
        );
        const net = worstPay - totalCost - cHedge;
        if (
          net > bestNet + 1e-9 ||
          (Math.abs(net - bestNet) <= 1e-9 && cHedge < 2 * (bestM1 + bestM2))
        ) {
          bestNet = net;
          bestM1 = m1;
          bestM2 = m2;
        }
      }
    }
    hedgeCost = 2 * (bestM1 + bestM2);
    lockedNetProfit = Number(bestNet.toFixed(2));
    oppositeLabel = `${lateHome} 反向【${bestCand.poolTag}·${bestCand.opt1Label}¥${2 * bestM1}+${bestCand.opt2Label}¥${2 * bestM2}】`;
  } else {
    const uSingle = bankerRoundParlayUnitPayout([bestCand.odds]);
    const mMid = Math.max(1, Math.round(incrementalTarget / uSingle));
    let bestNet = -Infinity;
    let bestM = mMid;
    for (let m = Math.max(1, mMid - 2); m <= mMid + 2; m++) {
      const cHedge = 2 * m;
      const worstPay = Math.min(
        targetReturn,
        baseGuaranteedReturn + m * uSingle
      );
      const net = worstPay - totalCost - cHedge;
      if (
        net > bestNet + 1e-9 ||
        (Math.abs(net - bestNet) <= 1e-9 && cHedge < 2 * bestM)
      ) {
        bestNet = net;
        bestM = m;
      }
    }
    hedgeCost = 2 * bestM;
    lockedNetProfit = Number(bestNet.toFixed(2));
  }

  const hedgeMode =
    lockedNetProfit > 0
      ? "lock-profit"
      : lockedNetProfit === 0
        ? "break-even"
        : "reduce-loss";
  return {
    hedgeCost,
    lockedNetProfit,
    oppositeLabel,
    oppositeOdds: Number(bestCand.odds) || 0,
    hedgeMode,
  };
}

/**
 * 基于封存的出票快照与中国体彩官方完场赛果执行五池精确算奖、局部回血定性与早场红单实时补单测算
 */
export function settleTicketSnapshotOnResultsMap(
  snapshot,
  resultsByIdInput,
  opts = {}
) {
  const resultsById =
    resultsByIdInput instanceof Map ? resultsByIdInput : new Map();
  const liveInput = opts.liveMatchesById ?? null;
  const liveById =
    liveInput instanceof Map
      ? liveInput
      : Array.isArray(liveInput)
        ? new Map(liveInput.filter(Boolean).map((m) => [String(m.id), m]))
        : new Map();

  const stakeCost = Math.max(0, Number(opts.stakeCost) || 0);
  const paperRefCost = Math.max(0, Number(opts.paperRefCost) || 0);
  const refStake = stakeCost > 0 ? stakeCost : paperRefCost;

  const rawMatches = Array.isArray(snapshot?.matches) ? snapshot.matches : [];
  const rawLines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];

  const matchMetaById = new Map();
  for (const m of rawMatches) {
    if (!m || !m.matchId) continue;
    matchMetaById.set(String(m.matchId), m);
  }
  // Ensure matches referenced only in lines also appear in per-match breakdown
  for (const ln of rawLines) {
    for (const lg of ln?.legs || []) {
      const mid = String(lg?.matchId || "");
      if (!mid) continue;
      if (!matchMetaById.has(mid)) {
        const r = resultsById.get(mid);
        matchMetaById.set(mid, {
          matchId: mid,
          matchNumStr: lg.matchNumStr || r?.matchNumStr || mid,
          home: lg.home || r?.home || "主队",
          away: lg.away || r?.away || "客队",
          kickoff: lg.kickoff || "",
          goalLine: lg.goalLine ?? r?.goalLine ?? "-1",
          isBanker: false,
          picks: [],
        });
      }
      const meta = matchMetaById.get(mid);
      const exists = (meta.picks || []).some(
        (p) => p.poolCode === lg.poolCode && p.optionKey === lg.optionKey
      );
      if (!exists) {
        meta.picks = [
          ...(meta.picks || []),
          {
            poolCode: lg.poolCode,
            optionKey: lg.optionKey,
            optionLabel: lg.optionLabel || lg.optionKey,
            odds: Number(lg.odds) || 1,
          },
        ];
      }
    }
  }

  const matchOutcomes = [];
  let anyMatchPending = false;
  let hitMatchCount = 0;
  let settledMatchCount = 0;

  for (const [mid, meta] of matchMetaById.entries()) {
    const res = resultsById.get(mid);
    const picksOut = (meta.picks || []).map((pk) => {
      const state = evaluateSportteryPickOutcome(
        pk.poolCode,
        pk.optionKey,
        res,
        pk.goalLine ?? meta.goalLine
      );
      return {
        poolCode: pk.poolCode,
        optionKey: pk.optionKey,
        optionLabel: pk.optionLabel || pk.optionKey,
        odds: Number(pk.odds) || 1,
        state,
      };
    });
    const anyHit = picksOut.some((p) => p.state === "hit");
    const allVoid =
      picksOut.length > 0 && picksOut.every((p) => p.state === "void");
    const anyPending =
      !res || !res.settled || picksOut.some((p) => p.state === "pending");
    const matchState = anyPending
      ? "pending"
      : allVoid
        ? "void"
        : anyHit
          ? "hit"
          : "miss";
    if (matchState === "pending") {
      anyMatchPending = true;
    } else {
      settledMatchCount += 1;
      if (matchState === "hit") hitMatchCount += 1;
    }
    matchOutcomes.push({
      matchId: mid,
      matchNumStr: meta.matchNumStr || res?.matchNumStr || mid,
      home: meta.home || res?.home || "",
      away: meta.away || res?.away || "",
      kickoff: meta.kickoff || "",
      goalLine: meta.goalLine ?? res?.goalLine ?? undefined,
      isBanker: Boolean(meta.isBanker),
      state: matchState,
      halfScore: res?.settled ? res.halfScore : "",
      fullScore: res?.settled ? res.fullScore : "",
      picks: picksOut,
    });
  }

  const ticketOutcomes = [];
  let settledReturnSum = 0;
  let hitTicketCount = 0;
  const survivingPendingTickets = [];

  for (let idx = 0; idx < rawLines.length; idx++) {
    const ln = rawLines[idx];
    const mult = Math.max(1, Math.round(Number(ln?.multiple) || 1));
    const legs = Array.isArray(ln?.legs) ? ln.legs : [];
    if (legs.length === 0) continue;

    const legStates = legs.map((lg) => {
      const mid = String(lg.matchId || "");
      const meta = matchMetaById.get(mid);
      const res = resultsById.get(mid);
      const state = evaluateSportteryPickOutcome(
        lg.poolCode,
        lg.optionKey,
        res,
        lg.goalLine ?? meta?.goalLine
      );
      return {
        matchId: mid,
        matchNumStr: lg.matchNumStr || meta?.matchNumStr || mid,
        home: lg.home || meta?.home || "",
        away: lg.away || meta?.away || "",
        poolCode: lg.poolCode,
        optionKey: lg.optionKey,
        optionLabel: lg.optionLabel || lg.optionKey,
        odds: Number(lg.odds) || 1,
        goalLine: lg.goalLine ?? meta?.goalLine,
        state,
      };
    });

    const hasMiss = legStates.some((l) => l.state === "miss");
    const hasPending = legStates.some((l) => l.state === "pending");
    const modeLabel =
      ln.modeLabel || (legs.length === 1 ? "单关" : `${legs.length}串1`);
    const lineCost = 2 * mult;

    if (hasMiss) {
      ticketOutcomes.push({
        id: String(ln.id || `line_${idx + 1}`),
        modeLabel,
        multiple: mult,
        cost: lineCost,
        status: "lost",
        payout: 0,
        legs: legStates,
      });
    } else if (hasPending) {
      const potentialOdds = legStates.map((l) =>
        l.state === "void" ? 1.0 : l.odds
      );
      const potentialNonVoid = legStates.filter(
        (l) => l.state !== "void"
      ).length;
      const potentialPayout = computeCappedTicketLinePayout(
        potentialOdds,
        potentialNonVoid,
        mult
      );
      const item = {
        id: String(ln.id || `line_${idx + 1}`),
        modeLabel,
        multiple: mult,
        cost: lineCost,
        status: "pending",
        payout: 0,
        potentialPayout,
        legs: legStates,
      };
      ticketOutcomes.push(item);
      survivingPendingTickets.push(item);
    } else {
      const effectiveOdds = legStates.map((l) =>
        l.state === "void" ? 1.0 : l.odds
      );
      const nonVoidCount = legStates.filter((l) => l.state === "hit").length;
      const payout = computeCappedTicketLinePayout(
        effectiveOdds,
        nonVoidCount,
        mult
      );
      settledReturnSum += payout;
      hitTicketCount += 1;
      ticketOutcomes.push({
        id: String(ln.id || `line_${idx + 1}`),
        modeLabel,
        multiple: mult,
        cost: lineCost,
        status: nonVoidCount === 0 ? "void-refund" : "won",
        payout,
        legs: legStates,
      });
    }
  }

  const settledReturn = Number(settledReturnSum.toFixed(2));
  const totalTicketCount = ticketOutcomes.length;

  if (totalTicketCount === 0) {
    return {
      status: "pending",
      settledReturn: 0,
      netProfit: 0,
      hitTicketCount: 0,
      totalTicketCount: 0,
      hitMatchCount,
      settledMatchCount,
      totalMatchCount: matchOutcomes.length,
      earlyEliminated: false,
      lockedFloorReturn: 0,
      progressSummary: "暂无实票快照",
      liveEarlyHedge: null,
      matches: matchOutcomes,
      tickets: ticketOutcomes,
    };
  }

  if (survivingPendingTickets.length === 0) {
    const earlyEliminated = anyMatchPending && settledReturn === 0;
    let status = "lost";
    if (settledReturn > 0) {
      status =
        refStake > 0 && settledReturn + 1e-9 < refStake ? "partial" : "won";
    }
    const netProfit =
      stakeCost > 0 ? Number((settledReturn - stakeCost).toFixed(2)) : 0;
    const progressSummary =
      status === "won"
        ? `已完场兑奖 · 命中 ${hitTicketCount}/${totalTicketCount} 张实票`
        : status === "partial"
          ? `局部命中 ${hitTicketCount}/${totalTicketCount} 张 · 挽回 ¥${settledReturn.toFixed(2)}`
          : earlyEliminated
            ? "前序关键场次已失手 · 全单已提前黑单"
            : "已完场开奖 · 未命中派奖组合";
    return {
      status,
      settledReturn,
      netProfit,
      hitTicketCount,
      totalTicketCount,
      hitMatchCount,
      settledMatchCount,
      totalMatchCount: matchOutcomes.length,
      earlyEliminated,
      lockedFloorReturn: settledReturn,
      progressSummary,
      liveEarlyHedge: null,
      matches: matchOutcomes,
      tickets: ticketOutcomes,
    };
  }

  // Still pending: check if all earlier legs hit and ONLY 1 pending match remains for live hedge!
  let liveEarlyHedge = null;
  const pendingMatchIds = new Set();
  let anyEarlierHitOnSurviving = false;
  for (const tk of survivingPendingTickets) {
    for (const lg of tk.legs) {
      if (lg.state === "pending") pendingMatchIds.add(lg.matchId);
      if (lg.state === "hit") anyEarlierHitOnSurviving = true;
    }
  }

  if (anyEarlierHitOnSurviving && pendingMatchIds.size === 1 && refStake > 0) {
    const [lateId] = Array.from(pendingMatchIds);
    const liveLate = liveById.get(lateId);
    const stillSelling =
      liveLate &&
      (liveLate.pools?.HAD?.selling !== false ||
        liveLate.pools?.HHAD?.selling !== false);
    const nowCheckMs = Number(opts.nowMs);
    const dateStr = liveLate?.matchDate || liveLate?.businessDate || "";
    const kickoffEpoch =
      dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && liveLate?.kickoff
        ? Date.parse(`${dateStr}T${liveLate.kickoff}:00+08:00`)
        : NaN;
    const notYetKickedOff =
      !Number.isFinite(nowCheckMs) ||
      !Number.isFinite(kickoffEpoch) ||
      kickoffEpoch > nowCheckMs;

    if (liveLate && stillSelling && notYetKickedOff) {
      const latePickMap = new Map();
      const latePools = new Set();
      let uniformAcrossSurviving = true;
      let hhadGoalLineAligned = true;
      const liveHhadGl = Number(liveLate.pools?.HHAD?.goalLine ?? -1);

      for (const tk of survivingPendingTickets) {
        const lateLegs = tk.legs.filter((l) => l.matchId === lateId);
        if (lateLegs.length !== 1) {
          uniformAcrossSurviving = false;
          break;
        }
        const lg = lateLegs[0];
        latePools.add(lg.poolCode);
        if (lg.poolCode === "HHAD") {
          const sealedGl = Number(
            lg.goalLine ?? matchMetaById.get(lateId)?.goalLine ?? -1
          );
          if (
            !Number.isFinite(sealedGl) ||
            !Number.isFinite(liveHhadGl) ||
            sealedGl !== liveHhadGl
          ) {
            hhadGoalLineAligned = false;
            break;
          }
        }
        const pkKey = `${lg.poolCode}:${lg.optionKey}`;
        if (!latePickMap.has(pkKey)) {
          latePickMap.set(pkKey, {
            matchId: lateId,
            matchNumStr: lg.matchNumStr,
            home: liveLate.home || lg.home,
            away: liveLate.away || lg.away,
            poolCode: lg.poolCode,
            optionKey: lg.optionKey,
            optionLabel: lg.optionLabel,
            odds: lg.odds,
          });
        }
      }

      if (
        uniformAcrossSurviving &&
        hhadGoalLineAligned &&
        latePools.size === 1
      ) {
        const latePicks = Array.from(latePickMap.values());
        const resolved = resolveComplementaryLateHedge(liveLate, latePicks);
        if (resolved.ok && resolved.candidate) {
          // Minimum total payout across picked options if late match lands in latePicks
          const optionPayouts = latePicks.map((pk) => {
            const addPay = survivingPendingTickets
              .filter((tk) =>
                tk.legs.some(
                  (l) =>
                    l.matchId === lateId &&
                    l.poolCode === pk.poolCode &&
                    l.optionKey === pk.optionKey
                )
              )
              .reduce((acc, tk) => acc + tk.potentialPayout, 0);
            return Number((settledReturn + addPay).toFixed(2));
          });
          const survivingTargetReturn = Math.min(...optionPayouts);
          if (survivingTargetReturn > settledReturn) {
            const split = solveDiscreteHedgeSplit(
              refStake,
              survivingTargetReturn,
              liveLate.home || latePicks[0]?.home || "末场",
              resolved.candidate,
              settledReturn
            );
            const unhedgedWorstNet = Number(
              (settledReturn - refStake).toFixed(2)
            );
            if (split.lockedNetProfit > unhedgedWorstNet + 1e-9) {
              liveEarlyHedge = {
                available: true,
                lateMatchId: lateId,
                lateMatchTitle:
                  `${liveLate.matchNumStr || ""} ${liveLate.home || ""}vs${liveLate.away || ""}`.trim(),
                lateKickoff: liveLate.kickoff || "",
                survivingTargetReturn,
                ...split,
              };
            }
          }
        }
      }
    }
  }

  const progressSummary =
    settledMatchCount > 0
      ? `进行中 · 已红 ${hitMatchCount}/${matchOutcomes.length} 场${
          settledReturn > 0 ? `（已锁回血 ¥${settledReturn.toFixed(2)}）` : ""
        }`
      : `待开赛 · 共 ${matchOutcomes.length} 场 / ${totalTicketCount} 张实票`;

  return {
    status: "pending",
    settledReturn: 0,
    netProfit: 0,
    hitTicketCount,
    totalTicketCount,
    hitMatchCount,
    settledMatchCount,
    totalMatchCount: matchOutcomes.length,
    earlyEliminated: false,
    lockedFloorReturn: settledReturn,
    progressSummary,
    liveEarlyHedge,
    matches: matchOutcomes,
    tickets: ticketOutcomes,
  };
}

export function buildPortfolioQuoteInputSignature({
  picks = [],
  budget = 100,
  resolvedTargets = [],
  anchorToRadarPicks = false,
  stance = "objective",
  subjectiveDeltaPct = 0,
  allowSaveCash = false,
  unlockFullAgg = false,
  passSpec = null,
} = {}) {
  const numB = Number(budget);
  const cleanBudget =
    Number.isFinite(numB) && numB > 0
      ? Math.max(2, Math.min(20_000, Math.floor(numB / 2) * 2))
      : 100;
  const cleanStance =
    stance === "home-lean" || stance === "upset-watch" ? stance : "objective";
  const cleanSubj = Math.max(
    -15,
    Math.min(15, Math.round(Number(subjectiveDeltaPct) || 0))
  );
  const passSig = (() => {
    if (
      !passSpec ||
      passSpec.mode === "auto" ||
      passSpec.mode === "follow-max-parlay"
    ) {
      return "auto";
    }
    if (passSpec.mode === "combo" && passSpec.comboCode) {
      return `c:${passSpec.comboCode}`;
    }
    if (
      passSpec.mode === "free" &&
      Array.isArray(passSpec.passSizes) &&
      passSpec.passSizes.length > 0
    ) {
      const sz = [...passSpec.passSizes]
        .map((x) => Number(x))
        .sort((a, b) => a - b)
        .join(",");
      const bk = Array.isArray(passSpec.bankerMatchIds)
        ? [...passSpec.bankerMatchIds].map(String).sort().join(",")
        : "";
      return `f:${sz}:b=${bk}`;
    }
    return "auto";
  })();

  const targetList = Array.isArray(resolvedTargets) ? resolvedTargets : [];
  const targetIdsSig = targetList.map((m) => String(m?.id ?? "")).join(",");
  const picksSig =
    !Array.isArray(picks) || picks.length === 0
      ? ""
      : Array.from(
          new Set(
            picks
              .filter((p) => p && p.matchId && p.poolCode && p.optionKey)
              .map(
                (p) =>
                  `${p.matchId}:${String(p.poolCode).toUpperCase()}:${p.optionKey}`
              )
          )
        )
          .sort()
          .join("|");

  const poolOrder = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let tokCount = 0;
  const mixInt = (val) => {
    const v = val | 0;
    h1 = Math.imul((h1 ^ v) >>> 0, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ (v + (tokCount & 255))) >>> 0, 0x85ebca6b) >>> 0;
    tokCount += 1;
  };
  const mixStr = (str) => {
    for (let c = 0; c < str.length; c++) {
      mixInt(str.charCodeAt(c));
    }
    mixInt(124);
  };
  for (let i = 0; i < targetList.length; i++) {
    const m = targetList[i];
    if (!m) continue;
    mixStr(String(m.id ?? ""));
    for (let j = 0; j < poolOrder.length; j++) {
      const pc = poolOrder[j];
      const pl = m.pools?.[pc];
      if (
        !pl ||
        pl.selling === false ||
        !Array.isArray(pl.options) ||
        pl.options.length === 0
      ) {
        mixInt(45);
        continue;
      }
      const flags =
        (pl.single ? 4 : 0) |
        (pl.canSingle === false ? 0 : 2) |
        (pl.canAllUp === false ? 0 : 1);
      mixInt(flags);
      mixStr(String(pl.goalLine ?? ""));
      for (let k = 0; k < pl.options.length; k++) {
        const o = pl.options[k];
        mixStr(String(o.key ?? ""));
        mixInt(Math.round((Number(o.odds) || 0) * 100));
      }
      mixInt(59);
    }
  }
  const oddsSnapshotSig = `${h1.toString(36)}_${h2.toString(36)}_${tokCount}`;
  const inputSig = `v1|b=${cleanBudget}|st=${cleanStance}|sd=${cleanSubj}|sc=${allowSaveCash ? 1 : 0}|ua=${unlockFullAgg ? 1 : 0}|ar=${anchorToRadarPicks ? 1 : 0}|ps=${passSig}|t=${targetIdsSig}|pk=${picksSig}|od=${oddsSnapshotSig}`;
  return {
    inputSig,
    picksSig,
    budget: cleanBudget,
    poolMatchIdsSig: targetIdsSig,
    passSpecSig: passSig,
    oddsSnapshotSig,
  };
}

const VALID_QUOTE_SIG_PREFIX_RE =
  /^(v1\|b=\d+\|st=[^|]+\|sd=-?\d+\|sc=[01]\|ua=[01]\|ar=[01]\|ps=[^|]*\|t=[^|]*\|pk=.*)\|od=[0-9a-z]+_[0-9a-z]+_\d+$/;

function extractValidQuoteInputPrefix(sig) {
  if (typeof sig !== "string" || sig.length === 0) return null;
  const m = VALID_QUOTE_SIG_PREFIX_RE.exec(sig);
  return m ? m[1] : null;
}

export function validateAppliedArchetypeQuoteGate({
  params,
  planSpec,
  validSnap,
  currentQuoteInputSig,
  matches,
}) {
  if (!planSpec || planSpec.kind !== "archetype") {
    return { ok: true };
  }
  const enforceStrictFullSig = Boolean(params?.enforceFreshQuoteSignature);
  const isReadOnlyDraftDetached = Boolean(planSpec.allowBudgetMismatchReadOnly);

  const expectedSig =
    typeof params?.expectedQuoteInputSig === "string" &&
    params.expectedQuoteInputSig.length > 0
      ? params.expectedQuoteInputSig
      : typeof planSpec.expectedQuoteInputSig === "string" &&
          planSpec.expectedQuoteInputSig.length > 0
        ? planSpec.expectedQuoteInputSig
        : "";
  const snapSig = String(
    planSpec.quoteInputSig || validSnap?.quoteInputSig || ""
  );

  if (isReadOnlyDraftDetached) {
    // Locked archetype while user edited manual draft or candidate budget:
    // 1. Snapshot signature MUST be structurally authentic (`VALID_QUOTE_SIG_PREFIX_RE`), rejecting forged signatures.
    // 2. If `enforceStrictFullSig` and caller passed `expectedSig`, `expectedSig` must match live `currentQuoteInputSig` (or `snapSig`).
    // 3. Every leg in `validSnap.lines` MUST still match live `matches` (`selling !== false`, `HHAD` `goalLine` exact, `odds` within `1e-6`).
    if (!snapSig || extractValidQuoteInputPrefix(snapSig) === null) {
      return {
        ok: false,
        code: "STALE_QUOTE_SIGNATURE",
        reason: "锁定方案缺少有效原始报价签名，已拦截过期或伪造快照",
      };
    }
    if (
      enforceStrictFullSig &&
      expectedSig &&
      expectedSig !== currentQuoteInputSig &&
      expectedSig !== snapSig
    ) {
      return {
        ok: false,
        code: "STALE_QUOTE_SIGNATURE",
        reason:
          "报价版本已过期（预算或选单输入已变更），请等待新报价返回后重新套用",
      };
    }
    if (
      Array.isArray(matches) &&
      matches.length > 0 &&
      Array.isArray(validSnap?.lines) &&
      validSnap.lines.length > 0
    ) {
      const mById = new Map(matches.map((m) => [String(m.id), m]));
      for (const ln of validSnap.lines) {
        const legs = Array.isArray(ln?.legs) ? ln.legs : [];
        const isSingleLine = legs.length === 1;
        for (const lg of legs) {
          const lm = mById.get(String(lg.matchId));
          const lp = lm?.pools?.[lg.poolCode];
          const lo = lp?.options?.find(
            (o) => String(o.key) === String(lg.optionKey)
          );
          if (
            !lm ||
            !lp ||
            lp.selling === false ||
            !lo ||
            (isSingleLine
              ? !isPoolSingleEligible(lp)
              : !isPoolAllUpEligible(lp)) ||
            Math.abs(Number(lo.odds) - Number(lg.odds)) > 1e-6 ||
            (lg.poolCode === "HHAD" &&
              lg.goalLine !== undefined &&
              String(lp.goalLine ?? "").trim() !==
                String(lg.goalLine ?? "").trim())
          ) {
            return {
              ok: false,
              code: "STALE_QUOTE_SIGNATURE",
              reason:
                "锁定方案所涉场次赔率、让球线或单串开售权限已发生变动，请确认最新盘口后重新套用",
            };
          }
        }
      }
    }
  } else if (expectedSig || snapSig) {
    const sigToVerify = expectedSig || snapSig;
    const verifyPrefix = extractValidQuoteInputPrefix(sigToVerify);
    const curPrefix = extractValidQuoteInputPrefix(currentQuoteInputSig);
    const matchesCurrent = enforceStrictFullSig
      ? sigToVerify === currentQuoteInputSig
      : sigToVerify === currentQuoteInputSig ||
        (verifyPrefix !== null && verifyPrefix === curPrefix);
    if (!matchesCurrent) {
      return {
        ok: false,
        code: "STALE_QUOTE_SIGNATURE",
        reason:
          "报价版本已过期（预算或选单输入已变更），请等待新报价返回后重新套用",
      };
    }
    if (expectedSig && snapSig && snapSig !== expectedSig) {
      return {
        ok: false,
        code: "STALE_QUOTE_SIGNATURE",
        reason: "所选方案快照属于过期报价版本，已拦截旧高额报价冻结",
      };
    }
  }

  if (
    validSnap &&
    Array.isArray(matches) &&
    matches.length > 0 &&
    Array.isArray(validSnap.lines) &&
    validSnap.lines.length > 0
  ) {
    const mById = new Map(matches.map((m) => [String(m.id), m]));
    const hasBoardQuoteSig = Boolean(
      isReadOnlyDraftDetached || expectedSig || snapSig
    );
    for (const ln of validSnap.lines) {
      const legs = Array.isArray(ln?.legs) ? ln.legs : [];
      const isSingleLine = legs.length === 1;
      for (const lg of legs) {
        const lm = mById.get(String(lg.matchId));
        if (!lm) {
          if (hasBoardQuoteSig) {
            return {
              ok: false,
              code: "STALE_QUOTE_SIGNATURE",
              reason: "所选方案涉及赛事已下架，请重新核对最新盘口",
            };
          }
          continue;
        }
        const lp = lm.pools?.[lg.poolCode];
        if (
          !lp ||
          lp.selling === false ||
          (isSingleLine ? !isPoolSingleEligible(lp) : !isPoolAllUpEligible(lp))
        ) {
          return {
            ok: false,
            code: "STALE_QUOTE_SIGNATURE",
            reason:
              "所选方案涉及场次单关/串关开售权限已变更，请重新核对最新盘口",
          };
        }
      }
    }
  }

  if (validSnap) {
    const rawParamB = Number(params?.budget);
    const paramsCleanBudget =
      Number.isFinite(rawParamB) && rawParamB > 0
        ? Math.max(2, Math.min(20_000, Math.floor(rawParamB / 2) * 2))
        : 100;
    const hasExplicitLockedBudget =
      planSpec.planBudgetYuan !== undefined ||
      planSpec.appliedBudgetYuan !== undefined;
    const rawLocked = hasExplicitLockedBudget
      ? Number(planSpec.planBudgetYuan ?? planSpec.appliedBudgetYuan)
      : paramsCleanBudget;
    const explicitBudget =
      Number.isFinite(rawLocked) && rawLocked > 0
        ? Math.max(2, Math.min(20_000, Math.floor(rawLocked / 2) * 2))
        : paramsCleanBudget;
    const lockedBudget = isReadOnlyDraftDetached
      ? explicitBudget
      : Math.min(explicitBudget, paramsCleanBudget);

    const hasLines =
      Array.isArray(validSnap.lines) && validSnap.lines.length > 0;
    const sumLineBaseCost = hasLines
      ? validSnap.lines.reduce((sum, ln) => {
          const mult = Math.max(
            1,
            Math.min(999, Math.round(Number(ln?.multiple) || 1))
          );
          return sum + mult * 2;
        }, 0)
      : 0;
    const snapBaseCost = hasLines
      ? sumLineBaseCost
      : Number(validSnap.totalCost) || 0;
    if (
      snapBaseCost > lockedBudget + 1e-6 ||
      (hasExplicitLockedBudget &&
        typeof validSnap.quoteBudgetYuan === "number" &&
        validSnap.quoteBudgetYuan > lockedBudget)
    ) {
      return {
        ok: false,
        code: "PLAN_EXCEEDS_LOCKED_BUDGET",
        reason: `方案实投金额 ¥${snapBaseCost} 超出套用锁定预算 ¥${lockedBudget}，已拦截旧高额报价`,
      };
    }
  }
  return { ok: true };
}

const WORKSPACE_BASELINE_CACHE = new Map();

export function resolveCachedWorkspaceBaseline({
  hasSandboxShift,
  clientAlerts,
  baselinePicks,
  multiple,
  passKey,
  matches,
  passSpec,
  atomicMap,
}) {
  if (!hasSandboxShift) return { precomputedBaselineManual: null, entry: null };
  if (
    clientAlerts ||
    !Array.isArray(baselinePicks) ||
    baselinePicks.length === 0
  ) {
    return {
      precomputedBaselineManual: computeTruthReport(
        baselinePicks,
        multiple,
        matches,
        passSpec,
        atomicMap,
        { captureHitMatrix: true, isBaselineAtomic: true }
      ),
      entry: null,
    };
  }
  let bKey = `${multiple}|${passKey}|p=${baselinePicks.length}`;
  for (let i = 0; i < baselinePicks.length; i++) {
    const p = baselinePicks[i];
    bKey += `;${p.matchId}:${p.poolCode}:${p.optionKey}:${Number(p.odds).toFixed(4)}`;
  }
  const pickedIds = new Set(baselinePicks.map((p) => p.matchId));
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (pickedIds.has(m.id)) {
      const fp = computeMatchPoolsFingerprint(m);
      bKey += `|${m.id}:${fp.h1.toString(36)}:${fp.h2.toString(36)}:${fp.len}`;
    }
  }
  let entry = WORKSPACE_BASELINE_CACHE.get(bKey) ?? null;
  if (!entry) {
    const rep = computeTruthReport(
      baselinePicks,
      multiple,
      matches,
      passSpec,
      atomicMap,
      { captureHitMatrix: true, isBaselineAtomic: true }
    );
    entry = { rep, bonusMap: new Map(), archMap: new WeakMap() };
    if (WORKSPACE_BASELINE_CACHE.size >= 16) {
      const oldest = WORKSPACE_BASELINE_CACHE.keys().next().value;
      if (oldest !== undefined) WORKSPACE_BASELINE_CACHE.delete(oldest);
    }
    WORKSPACE_BASELINE_CACHE.set(bKey, entry);
  }
  return { precomputedBaselineManual: entry.rep, entry };
}

export function resolveCachedBaselineArchetypePlan(
  scaledBasePlan,
  rawLiveRef,
  matches,
  picks,
  {
    hasFrozenSnapshot = false,
    scaleMultiple = 1,
    consolidateTickets = false,
    stance = "objective",
    baselineManualReport = null,
  } = {},
  cacheEntry = null
) {
  if (!scaledBasePlan) return null;
  const canCache =
    Boolean(cacheEntry?.archMap) &&
    !hasFrozenSnapshot &&
    rawLiveRef &&
    typeof rawLiveRef === "object";
  const subKey = `${Number(scaleMultiple) || 1}|${Boolean(consolidateTickets)}|${stance}`;
  if (canCache) {
    const byOpts = cacheEntry.archMap.get(rawLiveRef);
    if (byOpts?.has(subKey)) return byOpts.get(subKey);
  }
  const built = applySandboxToPlan(scaledBasePlan, matches, picks, false, 0, {
    isArchetype: true,
    hasFrozenSnapshot,
    consolidateTickets,
    stance,
    manualReport: baselineManualReport,
    voidMatchIds: [],
  });
  if (canCache && built) {
    let byOpts = cacheEntry.archMap.get(rawLiveRef);
    if (!byOpts) {
      byOpts = new Map();
      cacheEntry.archMap.set(rawLiveRef, byOpts);
    }
    byOpts.set(subKey, built);
  }
  return built;
}

export function resolveCachedBonusPlan(
  baselineManualReport,
  matches,
  mode,
  planSpec,
  cacheEntry = null
) {
  const shouldCons = planSpec?.consolidateTickets !== false;
  const canCache = Boolean(cacheEntry) && !Array.isArray(planSpec?.baseLines);
  const confirmedCapSig =
    typeof planSpec?.confirmedCapGuardSig === "string"
      ? planSpec.confirmedCapGuardSig
      : "";
  const bKey = `${mode}|${Boolean(planSpec?.upgradeToBreakeven)}|${shouldCons}|${planSpec?.targetBudgetCost ?? ""}|${Boolean(planSpec?.allowPeakTradeoff)}|${confirmedCapSig}|${Boolean(planSpec?.allowUnbundleCombo)}`;
  if (canCache && cacheEntry.bonusMap.has(bKey)) {
    return scaleArchetypePlan(
      cacheEntry.bonusMap.get(bKey),
      planSpec?.scaleMultiple
    );
  }
  const raw = optimizeBonusPlan(baselineManualReport, matches, mode, {
    upgradeToBreakeven: Boolean(planSpec?.upgradeToBreakeven),
    consolidateTickets: shouldCons,
    preserveExactBaseMultiples: Boolean(planSpec?.preserveExactBaseMultiples),
    targetBudgetCost: planSpec?.targetBudgetCost,
    baseLines: planSpec?.baseLines,
    baseTitle: planSpec?.baseTitle,
    allowPeakTradeoff: Boolean(planSpec?.allowPeakTradeoff),
    confirmedCapGuardSig: confirmedCapSig,
    allowUnbundleCombo: Boolean(planSpec?.allowUnbundleCombo),
    activeComboCode: planSpec?.activeComboCode,
  });
  if (canCache && raw) {
    cacheEntry.bonusMap.set(bKey, raw);
  }
  return scaleArchetypePlan(raw, planSpec?.scaleMultiple);
}
