// Pure TruthReport evaluation, auto-mounted synthetic single, Three-Mode Bonus Optimization,
// sandbox simulation, staggered kickoff hedge / bridge finder, and official 90m snapshot settlement (zero I/O).
import {
  OFFICIAL_COMBO_PASS_TABLE,
  OFFICIAL_CRS_PAIRS,
  POOL_MAX_PASS,
  TRUSTED_SERVER_BONUS_PLANS,
  allocateInverseOddsDutching,
  attachLazyConsolidatedLines,
  bankerRoundParlayUnitPayout,
  combinationsOfIndices,
  computeBreakevenUpgradeCost,
  computeLineStatutoryPayout,
  consolidateCloseMultiples,
  countPhysical99xSlips,
  effectiveNonVoidLegCount,
  isPoolAllUpEligible,
  isPoolSingleEligible,
  shallowClonePlanWithoutConsolidated,
  statutorySingleBetCap,
  waterFillInverseOddsNotes,
} from "./statutoryRules.mjs";
import {
  ATOMIC_TEMPLATES,
  CRS_INDEX_BY_KEY,
  canDiscreteSplitBeatSingleAtExactNotes,
  computeCapitalWeightedVig,
  computeEquivalentArbitrages,
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
  totalCost = 0,
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
  syntheticHint,
  syntheticRescuePicks,
  warnings,
}) {
  return {
    matchCount,
    betCount,
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
    totalCost,
    minPayout: 0,
    maxPayout: 0,
    likelyRange: [0, 0],
    anyWinProb: 0,
    realProfitProb: 0,
    strictNetGainProb: 0,
    breakEvenProb: 0,
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
    consolidatedTickets: 0,
    syntheticHint: syntheticHint ?? null,
    syntheticRescuePicks: syntheticRescuePicks ?? null,
    tickets: [],
    combos: [],
    warnings: warnings ?? [],
  };
}

export function sanitizeAndDeduplicatePicks(rawPicksInput, maxLen = 512) {
  if (!Array.isArray(rawPicksInput) || rawPicksInput.length === 0) return [];
  const out = [];
  const seen = new Set();
  const scanCap = Math.min(rawPicksInput.length, 4096);
  for (let i = 0; i < scanCap && out.length < maxLen; i++) {
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
    const sig = `${p.matchId}\0${p.poolCode}\0${p.optionKey}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(p);
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

  const best = candidates[0];
  const fullPicks = best.fullPicks;
  let activePicks = fullPicks;
  let modeUsed = mode === "partial-cover" ? "partial-cover" : "full-3way";
  let activeEq = best;
  let customBlindSpotLabel = null;

  if (mode === "trim-2way") {
    if (best.poolCode === "HAFU" && fullPicks.length >= 3) {
      const ftIncluded = ["h", "d", "a"].filter((ftKey) =>
        fullPicks.some((p) => HAFU_KEYS_BY_FT[ftKey].includes(p.optionKey))
      );
      const droppedPicks = [];
      const keptPicks = [];
      for (const ftKey of ftIncluded) {
        const grp = fullPicks.filter((p) =>
          HAFU_KEYS_BY_FT[ftKey].includes(p.optionKey)
        );
        if (ftKey === "h") {
          for (const p of grp) {
            if (p.optionKey === "ah") droppedPicks.push(p);
            else keptPicks.push(p);
          }
        } else if (ftKey === "a") {
          for (const p of grp) {
            if (p.optionKey === "ha") droppedPicks.push(p);
            else keptPicks.push(p);
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
              keptPicks.push(p);
            }
          }
        }
      }
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
            p.optionKey === "ah"
              ? `半场落后逆转（${p.optionLabel}）`
              : p.optionKey === "ha"
                ? `半场领先被逆转（${p.optionLabel}）`
                : `半场分胜负下半场扳平（${p.optionLabel}）`
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
        sortedByProb.slice(0, keepCount).map((p) => p.optionKey)
      );
      const dropped = fullPicks.filter((p) => !keepSet.has(p.optionKey));
      const kept = fullPicks.filter((p) => keepSet.has(p.optionKey));
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

  const invActive = activePicks.reduce(
    (acc, p) => acc + 2 / Math.max(0.5, bankerRoundParlayUnitPayout([p.odds])),
    0
  );
  const synEff = invActive > 0 ? 1 / invActive : 0;

  return {
    poolCode: best.poolCode,
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
  const synEff = invSum > 0 ? 1 / invSum : 0;

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
  const maxAutoCost = Number(options?.maxAutoCost) || 0;
  const maxAutoNotes = maxAutoCost > 0 ? Math.floor(maxAutoCost / 2) : 0;

  const dutchItems = activePicks.map((p, idx) => ({
    unitPayout: cappedUnits[idx],
    prob: p.fairProb,
    isCapClipped: rawUnits[idx] > singleCap,
  }));

  let bestAlloc = null;
  let minFeasibleAlloc = null;
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
  if (!bestAlloc || !minFeasibleAlloc) {
    return { playable: false, synEff, plan: null };
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
    ? "合成单关·2项省本"
    : hasBlindSpot
      ? "合成单关·比分配平"
      : "合成单关·无死角";
  const badge = isTrim2
    ? "⚡ 合成单关（2项省本搏常规）"
    : hasBlindSpot
      ? "🛡️ 合成单关（常规比分覆盖配平）"
      : "🛡️ 合成单关（全包无死角配平）";
  const outPlan = {
    key: "max-profit-prob",
    available: true,
    shortTab,
    badge,
    title: isTrim2
      ? "省去半场落后逆转分支 · 抬升常规命中返奖乘数"
      : hasBlindSpot
        ? "覆盖目标方向纯子集比分 · 反比例整数配平 0 假中奖"
        : "100% 等价覆盖原方向 · 反比例整数配平 0 假中奖",
    tagline: `总投入 ¥${actualCost} · 等效@${synEff.toFixed(2)} · 保底返 ¥${minPay.toFixed(1)} ~ 最高 ¥${maxPay.toFixed(1)}`,
    totalCost: actualCost,
    savedCash: 0,
    minReturn: minPay,
    maxReturn: maxPay,
    winProb: activePicks.reduce((a, p) => a + p.fairProb, 0),
    profitProb: activePicks.reduce((a, p) => a + p.fairProb, 0),
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
    breakevenUpgradeCost: null,
    consolidateTickets: false,
    missOneReturn: null,
    vigPct: 0,
    reasons: [
      isTrim2 && bundle.blindSpotLabel
        ? `省去「${bundle.blindSpotLabel}」（漏网风险 ${bsPctStr}%），合成等效水位提升至 @${synEff.toFixed(2)}`
        : hasBlindSpot
          ? `覆盖目标纯子集比分并按水位反比例精密配平（等效水位 @${synEff.toFixed(2)}）；诚实披露：未含${bundle.blindSpotLabel || "跨界其它比分"}（存在 ${bsPctStr}% 漏网死角）`
          : `100% 等价覆盖原选赛果（0% 漏网死角），按水位反比例精密配平整数倍，等效水位 @${synEff.toFixed(2)}`,
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

function attachSyntheticUnplayableWarning(manualReport, unplayableEffRaw) {
  const unplayableEff = Number((unplayableEffRaw || 0).toFixed(4));
  manualReport.syntheticEffectiveOdds = unplayableEff;
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
  simVoidFirstMatch,
  subjectiveDeltaPct,
  hasSubjectiveShift,
  sandboxAtomicMap,
  stance,
  manualReport,
}) {
  if (!singleMatch || !Array.isArray(matchPicks) || matchPicks.length === 0) {
    return { appliedPlan: null, autoSyntheticMeta: null };
  }
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
    singleMatch.pools[fullBundle.poolCode]?.name || fullBundle.poolCode;

  let partialCoveragePreview = null;
  if (requiresConfirm) {
    const previewPlan = fullBuilt.plan;
    const confirmReason =
      !fullBundle.fullIsExactEquivalent && previewPlan.totalCost > authCap
        ? "partial-and-over-cap"
        : !fullBundle.fullIsExactEquivalent
          ? "partial-subset"
          : "over-budget-cap";
    partialCoveragePreview = {
      poolCode: fullBundle.poolCode,
      poolName,
      isExactEquivalent: Boolean(fullBundle.fullIsExactEquivalent),
      requiresExplicitConfirm: true,
      confirmReason,
      authorizedCostCap: authCap,
      retainedDirectionRatio: Number(
        (fullBundle.fullRetainedDirectionRatio ?? 0).toFixed(8)
      ),
      withinDirectionMissRatio: Number(
        (fullBundle.fullWithinDirectionMissRatio ?? 0).toFixed(8)
      ),
      blindSpotProb: fullBundle.fullIsExactEquivalent
        ? 0
        : Number((fullBundle.fullBlindSpotProb ?? 0).toFixed(8)),
      overCoverProb: Number((fullBundle.fullOverCoverProb ?? 0).toFixed(8)),
      blindSpotLabel: fullBundle.fullBlindSpotLabel ?? null,
      syntheticEffectiveOdds: Number(fullBuilt.synEff.toFixed(4)),
      previewCost: previewPlan.totalCost,
      previewBetCount: previewPlan.lines.reduce((s, l) => s + l.multiple, 0),
      previewTicketCount: previewPlan.lines.length,
      previewMinPayout: previewPlan.minReturn,
      previewMaxPayout: previewPlan.maxReturn,
      previewLines: previewPlan.lines,
    };
    manualReport.partialCoveragePreview = partialCoveragePreview;
  }

  if (syntheticSingleMode === "off") {
    return { appliedPlan: null, autoSyntheticMeta: null };
  }

  if (syntheticSingleMode === "full-3way" && requiresConfirm) {
    manualReport.syntheticAutoMounted = false;
    manualReport.syntheticModeUsed = "full-3way";
    manualReport.modeLabel = "未开单关·待配";
    if (!fullBundle.fullIsExactEquivalent) {
      const retPct = (
        partialCoveragePreview.retainedDirectionRatio * 100
      ).toFixed(1);
      const bsPct = formatSyntheticBlindSpotPct(
        partialCoveragePreview.blindSpotProb
      );
      manualReport.ruleBlockReason = `该方向无 100% 等价单关（纯子集${poolName}保 ${retPct}%·漏 ${bsPct}%·配平 ¥${partialCoveragePreview.previewCost}），请确认部分覆盖或搭 1 场凑 2串1`;
    } else {
      manualReport.ruleBlockReason = `该方向等价${poolName}单关最少需 ¥${partialCoveragePreview.previewCost}（超出默认单场授权上限 ¥${authCap}），请确认超额配平或搭 1 场凑 2串1`;
    }
    return { appliedPlan: null, autoSyntheticMeta: null };
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
    syntheticSingleMode === "partial-cover"
      ? fullBuilt
      : buildAutoSyntheticSinglePlan(
          singleMatch,
          objBundle,
          multiple,
          matchPicks.length,
          syntheticSingleMode === "full-3way" ? { maxAutoCost: authCap } : null
        );
  if (!builtSyn.playable || !builtSyn.plan) {
    attachSyntheticUnplayableWarning(
      manualReport,
      builtSyn.synEff || objBundle.synEff || 0
    );
    return { appliedPlan: null, autoSyntheticMeta: null };
  }

  const appliedPlan = applySandboxToPlan(
    builtSyn.plan,
    matches,
    picks,
    simVoidFirstMatch,
    subjectiveDeltaPct,
    {
      isArchetype: false,
      consolidateTickets: false,
      stance,
      manualReport,
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
    poolName: singleMatch.pools[objBundle.poolCode]?.name || objBundle.poolCode,
    activeLabels: objBundle.activePicks.map((p) => p.optionLabel),
    matchNumStr: singleMatch.matchNumStr,
    partialCoveragePreview,
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
    const labelStr =
      autoSyntheticMeta.activeLabels.length <= 4
        ? autoSyntheticMeta.activeLabels.join("+")
        : `${autoSyntheticMeta.activeLabels.slice(0, 3).join("+")}等${autoSyntheticMeta.activeLabels.length}项`;
    const hasSynBlindSpot =
      !autoSyntheticMeta.isExactEquivalent ||
      autoSyntheticMeta.blindSpotProb > 1e-9;
    effectiveReport.modeLabel =
      autoSyntheticMeta.modeUsed === "trim-2way"
        ? "合成单关·2项省本"
        : hasSynBlindSpot
          ? "合成单关·部分覆盖"
          : autoSyntheticMeta.activeLabels.length === 3
            ? "合成单关·3项无死角"
            : "合成单关·无死角";
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
    if (autoSyntheticMeta.partialCoveragePreview) {
      effectiveReport.partialCoveragePreview =
        autoSyntheticMeta.partialCoveragePreview;
    }
    if (hasSynBlindSpot) {
      const bsPct = formatSyntheticBlindSpotPct(
        autoSyntheticMeta.blindSpotProb
      );
      const retPct = (
        (autoSyntheticMeta.retainedDirectionRatio ?? 0) * 100
      ).toFixed(1);
      const bsDesc = autoSyntheticMeta.blindSpotLabel || "极端长尾比分";
      if (autoSyntheticMeta.modeUsed === "trim-2way") {
        effectiveReport.syntheticHint = `${autoSyntheticMeta.matchNumStr} 已挂载【2项省本搏常规】${autoSyntheticMeta.poolName}单关「${labelStr}」（等效水位 @${autoSyntheticMeta.synEff.toFixed(2)} · 实投 ¥${effectiveReport.totalCost}）；⚠️ 注意省去了「${bsDesc}」（存在 ${bsPct}% 逆转漏网死角）。`;
        effectiveReport.warnings = [
          {
            id: "synthetic-blind-spot",
            severity: "warn",
            title: `⚠️ 2项省本模式存在 ${bsPct}% 逆转漏网风险`,
            detail: `当前省去了「${bsDesc}」（校准发生率 ${bsPct}%）；若想完整覆盖常规分支，请切回全包档或搭 1 场凑 2串1。`,
          },
          ...effectiveReport.warnings.filter(
            (w) => w.id !== "synthetic-blind-spot"
          ),
        ];
      } else {
        effectiveReport.syntheticHint = `${autoSyntheticMeta.matchNumStr} 已按确认挂载${autoSyntheticMeta.poolName}纯子集单关「${labelStr}」反比例配平（保住原方向 ${retPct}% · 等效水位 @${autoSyntheticMeta.synEff.toFixed(2)} · 实投 ¥${effectiveReport.totalCost}）；⚠️ 因体彩「其它」项跨界混含非目标分差已严格剔除，存在 ${bsPct}% 漏网死角（${bsDesc}）！选满第 2 场将自动恢复原盘串关。`;
        effectiveReport.warnings = [
          {
            id: "synthetic-blind-spot",
            severity: "warn",
            title: `⚠️ 部分覆盖合成单关存在 ${bsPct}% 漏网死角`,
            detail: `体彩比分池「胜其它/平其它/负其它」同时混杂其他分差，当前纯子集「${labelStr}」未含${bsDesc}（校准发生率 ${bsPct}%）；若需锁定原盘方向零漏网，可搭 1 场过桥配菜凑 2串1。`,
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
              ? `${m.matchNumStr} 当前所选玩法未开单关；可借道${poolTitle}单关纯子集「${labelList}」反比例配平（保住原方向 ${(fullRetained * 100).toFixed(1)}% · 等效水位 @${synEff.toFixed(2)}；⚠️ 未含${syntheticBlindSpotLabel || "跨界其它比分"}，存在 ${formatSyntheticBlindSpotPct(fullBsProb)}% 漏网死角），确认后可单场出票或加选第 2 场凑串！`
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
    const blockedOne = buildBlockedTruthReport({
      matchCount: 1,
      multiple,
      modeLabel: "还差1场凑2串1",
      canSingle: false,
      ruleBlockReason:
        syntheticEffectiveOdds !== undefined &&
        syntheticEffectiveOdds <= 1.0 + 1e-9
          ? `该方向借道单关池合成等效水位仅 ${syntheticEffectiveOdds.toFixed(2)}（≤ 1.00 必亏盘），已拦截亏本单关，请搭 1 场过桥配菜场凑 2串1`
          : "该玩法未开放单关，需再选至少 1 场比赛凑 2串1，或改选半全场/比分/总进球单关",
      poolCap,
      availableFreePasses: buildFreePassMetadata(1, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: false,
      syntheticHint,
      syntheticRescuePicks,
      warnings:
        syntheticEffectiveOdds !== undefined &&
        syntheticEffectiveOdds <= 1.0 + 1e-9
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

  const matchIdsInOrder = matchGroups.map((grp) => grp[0].matchId);
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
        title: `🚨 复式组合爆炸拦截：当前共 ${totalRawBetCount} 注（超出实时精算 ${MAX_EXACT_SLIP_BETS} 注上限）`,
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
      multiple,
      modeLabel,
      canSingle,
      ruleBlockReason: over20k
        ? `当前复式共 ${totalRawBetCount} 注（总金额 ¥${trueTotalCost}），超出单次 ${MAX_EXACT_SLIP_BETS} 注及体彩 ¥20,000 硬上限，请精简包号`
        : `当前复式共 ${totalRawBetCount} 注（总金额 ¥${trueTotalCost}），超出实时精算 ${MAX_EXACT_SLIP_BETS} 注上限，请精简包号或改用【3+1精算配单】`,
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
    for (const tuple of mTuples) {
      for (const k of activePassSizes) {
        const indexSubsets = combinationsOfIndices(matchCount, k);
        for (const subset of indexSubsets) {
          rawTickets.push({
            legs: subset.map((i) => tuple[i]),
            matchIndices: subset,
          });
        }
      }
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
    let nonVoid = 0;
    const legOdds = new Array(lgs.length);
    for (let j = 0; j < lgs.length; j++) {
      const it = lgs[j];
      legOdds[j] = it.odds;
      prob *= it.fairProb;
      if (Math.abs(Number(it.odds) - 1.0) > 1e-9) nonVoid++;
    }
    const cap = statutorySingleBetCap(Math.max(1, nonVoid));
    const unitBeforeCap = bankerRoundParlayUnitPayout(legOdds);
    const unitCapped = Math.min(cap, unitBeforeCap);
    const cappedClipped = Math.max(0, (unitBeforeCap - unitCapped) * multiple);
    const totalPayout = Math.round(unitCapped * multiple * 100) / 100;
    const netProfit = Math.round((totalPayout - totalCost) * 100) / 100;
    const desc =
      lgs.length === 2
        ? `${pickDescByRef.get(lgs[0])} × ${pickDescByRef.get(lgs[1])}`
        : lgs.length === 1
          ? pickDescByRef.get(lgs[0])
          : lgs.map((i) => pickDescByRef.get(i)).join(" × ");
    return {
      id: `tk-${idx}`,
      desc,
      legs: lgs,
      matchIndices: t.matchIndices,
      multiple,
      cost: multiple * 2,
      prob,
      unitPayout: unitCapped,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  });

  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRows,
    totalCost,
    matches,
    matchAtomicMap,
    options
      ? { captureHitMatrix: true, ...options }
      : { captureHitMatrix: true }
  );
  const {
    combos,
    anyWinProb,
    realProfitProb,
    strictNetGainProb,
    breakEvenProb,
    minPayout,
    maxPayout,
    expectedValueRate,
    underwaterCount,
    underwaterShareOfWins,
    likelyRange: [likelyMin, likelyMax],
  } = jointEval;
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
              reusableHitMatrix: options?.objectiveHitMatrix ?? null,
            }
          )
        : jointEval;

  const avgPassLen =
    activePassSizes.reduce((a, b) => a + b, 0) /
    Math.max(1, activePassSizes.length);
  const { avgPayoutRatio, vigPct: avgVigLossPer100 } =
    computeCapitalWeightedVig(ticketRows, matches);

  const invTicketOddsSum = ticketRows.reduce(
    (acc, c) => acc + 2 / Math.max(0.01, c.unitPayout),
    0
  );
  const effectiveOdds = invTicketOddsSum > 0 ? 1 / invTicketOddsSum : 0;

  let breakevenUpgradeCost = null;
  if (
    underwaterCount > 0 &&
    !activeComboCode &&
    activePassSizes.length === 1 &&
    effectiveOdds > 1.0 &&
    ticketRows.length <= 512
  ) {
    breakevenUpgradeCost = computeBreakevenUpgradeCost(
      ticketRows.map((t) => t.unitPayout),
      Math.max(betCount, betCount * multiple)
    );
  }

  const rawDanger =
    (1 - realProfitProb) * 58 +
    Math.max(0, avgPassLen - 1) * 9 +
    underwaterShareOfWins * 22;
  const dangerScore = Math.min(99, Math.max(8, Math.round(rawDanger)));
  const consolidatedTickets = Math.max(
    1,
    Math.min(24, Math.ceil(betCount / 3) * Math.ceil(multiple / 99))
  );
  const overOrder20k = totalCost > 20_000;
  const warnings = buildStatutorySlipWarnings({
    isManualSlip: true,
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
    avgPassLen,
    avgPayoutRatio,
    avgVigLossPer100,
    modeLabel,
    maxMultiple: multiple,
    physicalSlipCount: Math.ceil(multiple / 99),
    hasInvalidOdds: false,
  });

  const outReport = assembleEvaluatedTruthReport({
    matchCount,
    betCount,
    comboCount,
    multiple,
    modeLabel,
    canSingle,
    canCheckout: !overOrder20k,
    ruleBlockReason: overOrder20k
      ? `单次订单金额 ¥${totalCost} 超出体彩 ¥20,000 硬上限，请调低倍数或分单`
      : null,
    poolCap,
    activePassSizes,
    activeComboCode,
    bankerMatchIds,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    totalCost,
    jointEval: {
      minPayout,
      maxPayout,
      likelyRange: [likelyMin, likelyMax],
      anyWinProb,
      realProfitProb,
      strictNetGainProb,
      breakEvenProb,
      underwaterCount,
      underwaterShareOfWins,
      expectedValueRate,
      combos,
    },
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

function parseKickoffMinutes(hhmm) {
  const [hStr, mStr] = String(hhmm || "20:00").split(":");
  const h = Number(hStr) || 0;
  const min = Number(mStr) || 0;
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

  const allSameDateFmt = [anchorMatch, ...others].every(
    (m) => parseMatchDatePrefixMinutes(m.id) !== null
  );
  const timeOf = (m) =>
    (allSameDateFmt ? (parseMatchDatePrefixMinutes(m.id) ?? 0) : 0) +
    parseKickoffMinutes(m.kickoff);
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
            const lateRes = resolveComplementaryLateHedge(m, [pseudoPick]);
            if (lateRes.ok) {
              canHedge = true;
              hedgeOppositeDesc = lateRes.candidate.label;
            }
          } else if (diff <= -135 && anchorOpposite.ok) {
            canHedge = true;
            hedgeOppositeDesc = anchorOpposite.candidate.label;
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
      const useDatePrefix = pickedMatches.every(
        (m) => parseMatchDatePrefixMinutes(m.id) !== null
      );
      const timeMinutesOf = (m) =>
        (useDatePrefix ? (parseMatchDatePrefixMinutes(m.id) ?? 0) : 0) +
        parseKickoffMinutes(m.kickoff);

      const sortedByTime = [...pickedMatches].sort(
        (a, b) => timeMinutesOf(a) - timeMinutesOf(b)
      );
      const penultimate = sortedByTime[sortedByTime.length - 2];
      const late = sortedByTime[sortedByTime.length - 1];
      const gap = Math.max(0, timeMinutesOf(late) - timeMinutesOf(penultimate));
      const hrs = Math.floor(gap / 60);
      const mins = gap % 60;
      const gapText =
        gap <= 0
          ? "同时间段开球"
          : hrs > 0
            ? `${hrs}小时${mins > 0 ? `${mins}分` : ""}`
            : `${mins}分`;
      const earlyMatchTitle = `${penultimate.matchNumStr} ${penultimate.home}vs${penultimate.away}`;
      const lateMatchTitle = `${late.matchNumStr} ${late.home}vs${late.away}`;

      if (gap < 110) {
        hedge = {
          ...hedge,
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
                ? `前 ${sortedByTime.length - 1} 场最晚(${penultimate.kickoff})完场后距末场(${late.kickoff})仍有 ${gapText} 窗口！若前序 ${sortedByTime.length - 1} 关全红，单关补买 ¥${hedgeCost} 互补反向盘即可稳赚锁利 +¥${lockedNetProfit.toFixed(2)}！`
                : `早场(${penultimate.kickoff})完场后距晚场(${late.kickoff})间隔 ${gapText}！若第一关顺利红单，单关补买 ¥${hedgeCost} 互补反向盘即可稳赚锁利 +¥${lockedNetProfit.toFixed(2)}！`
              : hedgeMode === "break-even"
                ? `前序红单后距末场(${late.kickoff})间隔 ${gapText}；单关补买 ¥${hedgeCost} 互补反向盘可零损拿回全部成本 ¥${lockedReturn.toFixed(2)}。`
                : `受两元偶数凑整与双盘抽水影响，前序红单后单关补买 ¥${hedgeCost} 互补反向盘仅属减损止血：锁死少亏 -¥${Math.abs(lockedNetProfit).toFixed(2)}（拿回 ¥${lockedReturn.toFixed(2)}），无法正收益，请谨慎评估。`;

          hedge = {
            available: true,
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
  const availComboNotes = Math.max(
    1,
    report?.totalCost > 0 && report?.betCount > 0
      ? Math.floor(
          Number(report.totalCost) / Math.max(2, Number(report.betCount) * 2)
        )
      : Math.round(Number(report?.multiple) || 1)
  );
  const isAutoSynthetic = Boolean(report?.syntheticAutoMounted);
  const swapSourcePicks = isAutoSynthetic ? rawPicksList : effectivePicks;
  for (const m of pickedMatches) {
    const mpicks = swapSourcePicks.filter((p) => p.matchId === m.id);
    const arbitrages = computeEquivalentArbitrages(m);
    const matchedArb = arbitrages.find((arb) => {
      const isSingleMatchSlip =
        pickedMatches.length === 1 || Number(report?.matchCount) === 1;
      if (
        isSingleMatchSlip &&
        !arb.betterPicks.every((bp) =>
          isPoolSingleEligible(m.pools?.[bp.poolCode])
        )
      ) {
        return false;
      }
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
      if (!hasAllWorse || hasAllBetter) return false;

      if (arb.betterPicks.length === 2 && arb.worsePicks.length === 1) {
        const bp1 = m.pools?.[arb.betterPicks[0].poolCode]?.options?.find(
          (o) => o.key === arb.betterPicks[0].optionKey
        );
        const bp2 = m.pools?.[arb.betterPicks[1].poolCode]?.options?.find(
          (o) => o.key === arb.betterPicks[1].optionKey
        );
        const wp0 = m.pools?.[arb.worsePicks[0].poolCode]?.options?.find(
          (o) => o.key === arb.worsePicks[0].optionKey
        );
        if (
          bp1 &&
          bp2 &&
          wp0 &&
          !canDiscreteSplitBeatSingleAtExactNotes(
            bp1.odds,
            bp2.odds,
            wp0.odds,
            availComboNotes
          )
        ) {
          return false;
        }
      }
      return true;
    });
    if (matchedArb) {
      activeSwapTip = matchedArb;
      break;
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

  const p = Math.max(
    0.03,
    Number(report.objectiveProfitProb ?? report.realProfitProb) || 0.03
  );
  const fiveLossStreakProb = Math.pow(1 - p, 5);
  const evRate =
    Number(report.objectiveEVRate ?? report.expectedValueRate) || 0;
  // Kelly Criterion discipline (ADR-0010 / Spec 0009): negative-EV bets have optimal Kelly f* = 0%;
  // cap recreational budget exposure strictly at <= 2% so high-hit-rate favorites never induce ruinous 12% stakes.
  const recommendedBankrollPct =
    evRate <= 0
      ? p >= 0.4
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
    bridgeCandidates,
  };
}

/** 4. 三模智能奖金优化深模块（严格预算主权守恒 + 999倍逻辑分倍 + M串N联合状态保底 + 显式保本门槛升级 + 合票压缩） */
export function optimizeBonusPlan(
  manualReport,
  matches,
  optMode,
  options = {}
) {
  const baseRows =
    Array.isArray(manualReport?.tickets) && manualReport.tickets.length > 0
      ? manualReport.tickets
      : (manualReport?.combos ?? []);
  if (!manualReport || baseRows.length === 0 || baseRows.length > 512)
    return null;

  const upgradeToBreakeven = Boolean(options?.upgradeToBreakeven);
  const consolidateTickets = Boolean(options?.consolidateTickets);

  const sorted = [...baseRows].sort((a, b) => b.prob - a.prob);
  const k = sorted.length;
  const strictBaseCost = Math.max(
    k * 2,
    Math.round((Number(manualReport.totalCost) || k * 2) / 2) * 2
  );
  const targetBudgetCost =
    upgradeToBreakeven &&
    typeof manualReport.breakevenUpgradeCost === "number" &&
    manualReport.breakevenUpgradeCost > strictBaseCost
      ? Math.min(20_000, manualReport.breakevenUpgradeCost)
      : typeof options?.targetBudgetCost === "number" &&
          Number.isFinite(options.targetBudgetCost) &&
          options.targetBudgetCost >= k * 2 &&
          options.targetBudgetCost <= strictBaseCost
        ? Math.max(k * 2, Math.round(options.targetBudgetCost / 2) * 2)
        : strictBaseCost;
  const totalTickets = Math.max(k, Math.floor(targetBudgetCost / 2));
  const targetStake = totalTickets * 2;

  const matchMap = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m?.id) matchMap.set(m.id, m);
    }
  }
  const rawUnits = sorted.map((c) => {
    if (
      typeof c.unitPayout === "number" &&
      c.unitPayout > 0 &&
      typeof c.cappedClipped === "number" &&
      c.cappedClipped === 0
    ) {
      return c.unitPayout;
    }
    return bankerRoundParlayUnitPayout(
      (c.legs ?? []).map((p) => Number(p.odds))
    );
  });
  const cappedUnits = sorted.map((c, idx) => {
    const legOdds = (c.legs ?? []).map((p) => Number(p.odds));
    const cap = statutorySingleBetCap(
      legOdds.length > 0
        ? effectiveNonVoidLegCount(legOdds)
        : manualReport.matchCount
    );
    const raw = rawUnits[idx] > 0 ? rawUnits[idx] : c.unitPayout;
    return Math.min(cap, raw);
  });
  const isCapClipped = sorted.map((c, idx) => {
    const legOdds = (c.legs ?? []).map((p) => Number(p.odds));
    const effLegs =
      legOdds.length > 0
        ? effectiveNonVoidLegCount(legOdds)
        : manualReport.matchCount;
    return rawUnits[idx] > statutorySingleBetCap(effLegs);
  });
  const hasUnclippedLine = isCapClipped.some((clipped) => !clipped);

  const reusableHitMatrix = manualReport?._reusableHitMatrix?.isBaselineAtomic
    ? manualReport._reusableHitMatrix
    : (manualReport?._reusableHitMatrix ?? null);
  const isMultiPassOverlap =
    Boolean(reusableHitMatrix) &&
    reusableHitMatrix.K === k &&
    (Boolean(manualReport.activeComboCode) ||
      (Array.isArray(manualReport.activePassSizes) &&
        manualReport.activePassSizes.length > 1));

  let mults = new Array(k).fill(1);

  if (isMultiPassOverlap && k >= 2) {
    // Non-disjoint M串N / multi-pass joint hit-bucket optimizer (strictly <= totalTickets)
    const origToSorted = new Int16Array(k).fill(-1);
    let mappingValid = true;
    for (let idx = 0; idx < k; idx++) {
      const sig = canonicalTicketLegSig(sorted[idx].legs);
      const origK = reusableHitMatrix.sigToOrigIdx.get(sig);
      if (origK === undefined || origToSorted[origK] !== -1) {
        mappingValid = false;
        break;
      }
      origToSorted[origK] = idx;
    }

    if (mappingValid && reusableHitMatrix.bucketHits.length > 0) {
      const B = reusableHitMatrix.bucketHits.length;
      const bucketSortedHits = new Array(B);
      const lineDeg = new Int32Array(k);
      const bucketPay = new Float64Array(B);
      let totalEdges = 0;
      for (let b = 0; b < B; b++) {
        const rawHits = reusableHitMatrix.bucketHits[b];
        const mapped = new Int16Array(rawHits.length);
        let sumU = 0;
        for (let j = 0; j < rawHits.length; j++) {
          const sIdx = origToSorted[rawHits[j]];
          mapped[j] = sIdx;
          lineDeg[sIdx] += 1;
          sumU += cappedUnits[sIdx];
        }
        totalEdges += rawHits.length;
        bucketSortedHits[b] = mapped;
        bucketPay[b] = sumU;
      }
      const lineStart = new Int32Array(k + 1);
      for (let i = 0; i < k; i++) lineStart[i + 1] = lineStart[i] + lineDeg[i];
      const lineCur = Int32Array.from(lineStart);
      const lineBucketsFlat = new Int16Array(Math.max(1, totalEdges));
      for (let b = 0; b < B; b++) {
        const mapped = bucketSortedHits[b];
        for (let j = 0; j < mapped.length; j++) {
          const sIdx = mapped[j];
          lineBucketsFlat[lineCur[sIdx]++] = b;
        }
      }

      let rem = totalTickets - k;
      while (rem > 0) {
        let bMin = 0;
        for (let b = 1; b < B; b++) {
          if (bucketPay[b] < bucketPay[bMin]) bMin = b;
        }
        const allCleared = bucketPay[bMin] >= targetStake - 1e-9;
        if (allCleared && optMode !== "equal") {
          const prefIdx =
            optMode === "hot-first"
              ? isCapClipped.findIndex((cl) => !cl)
              : (() => {
                  for (let r = k - 1; r >= 0; r--) {
                    if (!isCapClipped[r]) return r;
                  }
                  return 0;
                })();
          const tgt = prefIdx >= 0 && mults[prefIdx] < 999 ? prefIdx : -1;
          if (tgt >= 0) {
            const add = Math.min(rem, 999 - mults[tgt]);
            mults[tgt] += add;
            const deltaPay = add * cappedUnits[tgt];
            const st = lineStart[tgt];
            const en = lineStart[tgt + 1];
            for (let q = st; q < en; q++) {
              bucketPay[lineBucketsFlat[q]] += deltaPay;
            }
            rem -= add;
            continue;
          }
        }

        const candLines = bucketSortedHits[bMin];
        let bestIdx = -1;
        let bestU = -Infinity;
        let bestEv = -Infinity;
        for (let j = 0; j < candLines.length; j++) {
          const sIdx = candLines[j];
          if (mults[sIdx] >= 999) continue;
          if (isCapClipped[sIdx] && hasUnclippedLine) continue;
          const u = cappedUnits[sIdx];
          const ev = (sorted[sIdx].prob || 0) * u;
          if (
            u > bestU + 1e-9 ||
            (Math.abs(u - bestU) <= 1e-9 && ev > bestEv)
          ) {
            bestU = u;
            bestEv = ev;
            bestIdx = sIdx;
          }
        }
        if (bestIdx === -1) {
          bestIdx = mults.findIndex(
            (m, i) => m < 999 && (!isCapClipped[i] || !hasUnclippedLine)
          );
          if (bestIdx === -1) break;
        }
        const step = Math.min(
          rem,
          999 - mults[bestIdx],
          rem > 24 ? Math.max(2, Math.floor(rem / 16)) : 1
        );
        mults[bestIdx] += step;
        const deltaPay = step * cappedUnits[bestIdx];
        const st = lineStart[bestIdx];
        const en = lineStart[bestIdx + 1];
        for (let q = st; q < en; q++) {
          bucketPay[lineBucketsFlat[q]] += deltaPay;
        }
        rem -= step;
      }
    }
  } else if (k === 1) {
    mults = [
      isCapClipped[0] && hasUnclippedLine
        ? 1
        : Math.max(1, Math.min(999, totalTickets)),
    ];
  } else {
    const dutchItems = cappedUnits.map((u, idx) => ({
      unitPayout: u,
      prob: sorted[idx].prob || 0,
      isCapClipped: isCapClipped[idx],
    }));
    const fullAlloc = allocateInverseOddsDutching(dutchItems, totalTickets, {
      validateAllNonLoss: false,
      stage2Mode:
        optMode === "hot-first"
          ? "hot-first"
          : optMode === "cold-first"
            ? "cold-first"
            : "water-fill",
    });

    if (fullAlloc) {
      mults = fullAlloc.mults;
    } else {
      // Strict Budget Sovereignty: totalTickets < sumReq -> never inflate user stake!
      const reqMult = cappedUnits.map((u, idx) =>
        isCapClipped[idx] && hasUnclippedLine
          ? 1
          : Math.min(
              999,
              Math.max(1, Math.ceil((targetStake - 1e-9) / Math.max(0.5, u)))
            )
      );
      mults = new Array(k).fill(1);
      let rem = Math.max(0, totalTickets - k);
      if (optMode === "equal") {
        waterFillInverseOddsNotes(mults, dutchItems, rem);
      } else if (optMode === "hot-first") {
        for (let i = 0; i < k && rem > 0; i++) {
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const need = Math.max(0, reqMult[i] - 1);
          if (need > 0 && need <= rem) {
            mults[i] += need;
            rem -= need;
          }
        }
        for (let i = 0; i < k && rem > 0; i++) {
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const add = Math.min(rem, 999 - mults[i]);
          mults[i] += add;
          rem -= add;
        }
      } else {
        const coldIdx = (() => {
          for (let r = k - 1; r >= 0; r--) {
            if (!(isCapClipped[r] && hasUnclippedLine)) return r;
          }
          return k - 1;
        })();
        const reserveCold = rem >= 2 ? 1 : 0;
        let shieldBudget = Math.max(0, rem - reserveCold);
        for (let i = 0; i < k && shieldBudget > 0; i++) {
          if (i === coldIdx) continue;
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const need = Math.max(0, reqMult[i] - 1);
          if (need > 0 && need <= shieldBudget) {
            mults[i] += need;
            shieldBudget -= need;
            rem -= need;
          }
        }
        if (rem > 0 && mults[coldIdx] < 999) {
          const add = Math.min(rem, 999 - mults[coldIdx]);
          mults[coldIdx] += add;
          rem -= add;
        }
        if (rem > 0) waterFillInverseOddsNotes(mults, dutchItems, rem);
      }
    }
  }

  if (hasUnclippedLine) {
    mults = mults.map((m, idx) => (isCapClipped[idx] ? 1 : m));
  }

  if (consolidateTickets && k >= 2) {
    const preCost = mults.reduce((a, m) => a + m * 2, 0);
    mults = consolidateCloseMultiples(
      mults,
      cappedUnits,
      isCapClipped,
      sorted.map((c) => (c.legs ?? []).length || 1),
      preCost
    );
  }

  const lines = sorted.map((c, idx) => {
    const mult = mults[idx];
    const unit = cappedUnits[idx];
    const role =
      optMode === "equal"
        ? `均衡分倍#${idx + 1}`
        : optMode === "hot-first"
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
        kickoff: fm?.kickoff ?? "21:00",
        poolCode: p.poolCode,
        poolName: p.poolName,
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
          : manualReport.modeLabel;

    const rawBeforeCap = rawUnits[idx] > 0 ? rawUnits[idx] : unit;
    const cappedClipped = Math.max(
      0,
      Number(((rawBeforeCap - unit) * mult).toFixed(2))
    );

    return {
      id: `opt-${optMode}-${idx}`,
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

  const ticketRowsForEval = lines.map((l) => ({
    id: l.id,
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
    const { atomicMap, objectiveAtomicMap } = resolveMatchAtomicContexts(
      lines.flatMap((l) => l.legs),
      matches,
      { mode: "plan-legs" }
    );
    jointEval = evaluateTicketsOnQuotientSpace(
      ticketRowsForEval,
      actualTotal,
      matches,
      atomicMap
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
  const rawUpgradeCost =
    typeof manualReport.breakevenUpgradeCost === "number" &&
    manualReport.breakevenUpgradeCost > actualTotal
      ? manualReport.breakevenUpgradeCost
      : null;

  const metaMap = {
    equal: {
      shortTab: "平均优化",
      badge:
        uwCount > 0 ? "⚖️ 平均优化（预算内减损）" : "⚖️ 平均优化（均衡派奖）",
      title:
        uwCount > 0
          ? "严守当前预算 · 最优均衡减损配比"
          : "反比例均注 · 全选项均衡稳赚",
      reason:
        uwCount > 0
          ? `严守当前本金上限 ¥${actualTotal}（绝不暗自加注），受离散凑整限制仍有 ${uwCount}/${totalScenarios} 种命中场景属局部回血`
          : "按每注返奖额反比例精密分配整数倍，彻底消灭假中奖倒贴",
    },
    "hot-first": {
      shortTab: "博热保本",
      badge: uwCount > 0 ? "🔥 博热减损（主攻倾斜）" : "🔥 博热保本优化",
      title:
        uwCount > 0
          ? "严守当前预算 · 主攻优先减损配比"
          : "次选回本护盾 + 第一主攻利润最大化",
      reason:
        uwCount > 0
          ? `严守当前本金上限 ¥${actualTotal} 优先抬高高概率正路回血，仍有 ${uwCount}/${totalScenarios} 种场景属局部回血`
          : "防冷次选仅配保本倍数，省下筹码集中放大最高概率主方向收益",
    },
    "cold-first": {
      shortTab: "博冷高弹",
      badge: uwCount > 0 ? "⚡ 博冷减损（冷门倾斜）" : "⚡ 博冷高弹优化",
      title:
        uwCount > 0
          ? "严守当前预算 · 博冷倾斜减损配比"
          : "正路免单兜底 + 高赔冷门暴击放大",
      reason:
        uwCount > 0
          ? `严守当前本金上限 ¥${actualTotal} 兼顾正路缓冲与高赔冷门弹性，仍有 ${uwCount}/${totalScenarios} 种场景属局部回血`
          : "大热方向锁住保本回血线，溢价倍数倾斜博取高赔冷门超额回报",
    },
  }[optMode];

  const bonusReasons = [metaMap.reason];
  if (uwCount > 0 && rawUpgradeCost) {
    bonusReasons.push(
      `若需 100% 清零假中奖倒贴，可点击「一键加至最低保本门槛 ¥${rawUpgradeCost}」显式授权扩充本金`
    );
  }

  const outBonusPlan = {
    key: "max-profit-prob",
    available: true,
    shortTab: metaMap.shortTab,
    badge: metaMap.badge,
    title: metaMap.title,
    tagline: `总投入 ¥${actualTotal} · 保底返 ¥${jointEval.minPayout.toFixed(1)} ~ 最高 ¥${jointEval.maxPayout.toFixed(1)}`,
    totalCost: actualTotal,
    savedCash: 0,
    minReturn: jointEval.minPayout,
    maxReturn: jointEval.maxPayout,
    winProb: jointEval.anyWinProb,
    profitProb: jointEval.realProfitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
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
    physicalTicketCount: countPhysical99xSlips(lines),
    zeroPayoutProb: Math.max(0, 1 - jointEval.anyWinProb),
    breakevenUpgradeCost: uwCount > 0 ? rawUpgradeCost : null,
    consolidateTickets,
    missOneReturn: null,
    vigPct,
    reasons: bonusReasons,
    lines,
  };
  attachLazyConsolidatedLines(outBonusPlan, lines, consolidateTickets);
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
  const maxLines = plan && TRUSTED_SERVER_BONUS_PLANS.has(plan) ? 512 : 64;
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

function buildInvalidOddsStatutoryWarning(isPlan = false) {
  return {
    id: "invalid-odds",
    severity: "danger",
    title: "选单包含未开售或无效赔率选项，已拦截出票",
    detail: isPlan
      ? "部分实票选项在当前官方盘面未开售或不存在，请还原等倍后重新选号。"
      : "部分所选选项在当前官方盘面未开售或赔率异常，请重新勾选有效选项。",
  };
}

function buildStatutorySlipWarnings({
  isManualSlip = true,
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
  avgPassLen = 1,
  avgPayoutRatio = 0.88,
  avgVigLossPer100 = 12,
  modeLabel = "",
  maxMultiple = 1,
  physicalSlipCount = 1,
  hasInvalidOdds = false,
}) {
  const warnings = [];
  if (isManualSlip && matchCount > poolCap && !forceSingleOnly) {
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

  if (
    isManualSlip &&
    effectiveOdds > 0 &&
    effectiveOdds <= 1.0 &&
    activePassSizes.length === 1 &&
    activePassSizes[0] === matchCount
  ) {
    warnings.push({
      id: "guaranteed-loss",
      severity: "danger",
      title: `必亏盘红灯拦截（合成等效水位仅 ${effectiveOdds.toFixed(2)}）`,
      detail:
        "同场包号过多，无论如何分配倍数都注定亏本或大面积倒贴！请至少砍掉 1~2 个高赔低概率鸡肋项。",
    });
  } else if (isManualSlip && underwaterCount > 0) {
    warnings.push({
      id: "underwater",
      severity: "danger",
      title: `假中奖警报：${underwaterCount}/${comboCount} 种命中场景实际倒贴钱！`,
      detail: `官网只给你看最高 ${maxPayout.toFixed(2)} 元，但低赔或局部命中时最低仅拿 ${minPayout.toFixed(2)} 元（净亏 ${(totalCost - minPayout).toFixed(2)} 元）。${
        breakevenUpgradeCost
          ? `✨ 开启奖金优化并将总本金调至 ${breakevenUpgradeCost} 元即可实现 100% 组合零亏损保本！`
          : "建议使用「三模奖金优化」重新分配各注倍数。"
      }`,
    });
  }

  if (isManualSlip && hasSameMatchCrossPoolConflict) {
    warnings.push({
      id: "cross-pool-same-match",
      severity: "warn",
      title: "同场双单关独立计奖提醒（已强制锁定单关）",
      detail:
        "同一场比赛勾选了两个已开单关玩法，按中国体彩规则仅支持【单关】独立计奖，不可参与串关。",
    });
  }

  if (
    isManualSlip &&
    avgPassLen >= 2 &&
    (avgPassLen >= 4 || avgPayoutRatio < 0.72)
  ) {
    warnings.push({
      id: "parlay-vig",
      severity: "danger",
      title: `串关连乘抽水雪崩：体彩已暗扣 ${avgVigLossPer100}% 数学期望`,
      detail: `当前 ${modeLabel} 综合返还率跌至 ${(avgPayoutRatio * 100).toFixed(1)}%；建议在底栏「过关选择」改选 2关/3关 或 M串N 容错防黑单场。`,
    });
  }

  const fallbackMaxPass =
    activePassSizes.length > 0 ? Math.max(...activePassSizes) : 1;
  const maxClippedPassSize = tickets
    .filter((c) => c.cappedClipped > 0)
    .reduce(
      (mx, c) =>
        Math.max(
          mx,
          effectiveNonVoidLegCount((c.legs ?? []).map((g) => g.odds))
        ),
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
          : isManualSlip
            ? `超出单张实票 99 倍上限（体彩店需拆成 ${physicalSlipCount} 张实票打印）`
            : `分倍含超 99 倍单注（体彩店需拆成 ${physicalSlipCount} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${maxTierCap / 10000} 万元法定单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : isManualSlip
            ? "终端机单张实票最高 99 倍，已自动为你按 99 倍上限核算店面拆票张数。"
            : "终端机单张实票最高 99 倍，已按 99 倍上限自动核算店面拆票张数。",
    });
  }

  if (hasInvalidOdds) {
    warnings.push(buildInvalidOddsStatutoryWarning(!isManualSlip));
  }

  if (totalCost > 20_000) {
    warnings.push({
      id: "order-limit-20k",
      severity: "danger",
      title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${totalCost}）`,
      detail: isManualSlip
        ? "中国体彩规定单次订单投注金额不得超过 20,000 元，已拦截出票，请下调倍数或分批打票。"
        : "中国体彩规定单次订单投注金额不得超过 20,000 元，请还原等倍或分批打票。",
    });
  } else if (totalCost > 6_000) {
    warnings.push({
      id: "rational-6k",
      severity: "warn",
      title: `大额投注风控提醒（当前总投入 ¥${totalCost} 已超 ¥6,000）`,
      detail: "触发体彩官方大额理性购彩阈值，请严格核对今日止损护栏额度。",
    });
  }

  if (!isManualSlip && underwaterCount > 0) {
    warnings.push({
      id: "underwater",
      severity: "warn",
      title: `存在 ${underwaterCount}/${comboCount} 种局部回血场景低于总本金`,
      detail: `最低回血 ¥${minPayout.toFixed(2)}（本金 ¥${totalCost}），属容错回血垫或腰斩折算场景。${
        breakevenUpgradeCost
          ? `✨ 若需 100% 清零假中奖倒贴，可将总本金调至 ${breakevenUpgradeCost} 元！`
          : ""
      }`,
    });
  }

  return warnings;
}

function assembleEvaluatedTruthReport({
  matchCount,
  betCount,
  comboCount,
  multiple,
  modeLabel,
  canSingle,
  canCheckout,
  ruleBlockReason,
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
  return {
    matchCount,
    betCount,
    comboCount,
    multiple,
    modeLabel,
    canSingle,
    canCheckout,
    ruleBlockReason,
    poolCap,
    activePassSizes,
    activeComboCode,
    bankerMatchIds,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    totalCost,
    minPayout: jointEval.minPayout,
    maxPayout: jointEval.maxPayout,
    likelyRange: jointEval.likelyRange,
    anyWinProb: jointEval.anyWinProb,
    realProfitProb: jointEval.realProfitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
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
    consolidatedTickets,
    syntheticHint,
    syntheticRescuePicks,
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
  subjectiveDeltaPct
) {
  const firstMid = picks[0]?.matchId;
  const { contexts, atomicMap } = resolveMatchAtomicContexts(picks, matches, {
    mode: "workspace-picks",
    subjectiveDeltaPct,
  });

  const adjustedPicks = picks.map((pk) => {
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
    const odds =
      simVoidFirstMatch && pk.matchId === firstMid && baseOdds > 0
        ? 1.0
        : baseOdds;
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
      ...pk,
      singleAllowed: pool
        ? isPoolSingleEligible(pool)
        : Boolean(pk.canSingle ?? pk.singleAllowed),
      canSingle: pool
        ? isPoolSingleEligible(pool)
        : Boolean(pk.canSingle ?? pk.singleAllowed),
      canAllUp: pool ? isPoolAllUpEligible(pool) : pk.canAllUp !== false,
      odds,
      fairProb: prob > 0 ? prob : Number(pk.fairProb) || 0.02,
    };
  });

  return { picks: adjustedPicks, atomicMap };
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
    consolidateTickets = false,
    stance = "objective",
    objectiveHitMatrix = null,
    targetFirstMid = null,
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
  const boardFirstMid = Array.isArray(matches)
    ? matches.find((m) => planMatchIds.has(m.id))?.id
    : undefined;
  const firstMid =
    targetFirstMid ??
    boardFirstMid ??
    (picks[0]?.matchId && planMatchIds.has(picks[0].matchId)
      ? picks[0].matchId
      : basePlan.lines[0]?.legs[0]?.matchId);

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

  const resolvedLegCache = new Map();
  const lines = basePlan.lines.map((l) => {
    const legs = l.legs.map((lg) => {
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
        const odds =
          simVoidFirstMatch && lg.matchId === firstMid && baseOdds > 0
            ? 1.0
            : baseOdds;
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
          fairProb: fairProb > 0 ? fairProb : Number(lg.fairProb) || 0.02,
        };
        resolvedLegCache.set(cacheKey, hit);
      }
      return {
        ...lg,
        odds: hit.odds,
        fairProb: hit.fairProb,
      };
    });
    const prob = legs.reduce((acc, it) => acc * it.fairProb, 1);
    const { mult, cost, unitPayout, cappedClipped, returnPayout } =
      computeLineStatutoryPayout(
        legs.map((it) => it.odds),
        l.multiple
      );
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
  if (isArchetype && consolidateTickets && lines.length >= 2) {
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
        const st = computeLineStatutoryPayout(
          lines[idx].legs.map((it) => it.odds),
          m
        );
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

  const ticketRowsForEval = lines.map((l) => ({
    id: l.id,
    desc: `${l.roleLabel}(${l.multiple}倍) · ${l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join("×")}`,
    legs: l.legs,
    multiple: l.multiple,
    cost: l.cost,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: l.cappedClipped ?? 0,
  }));
  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRowsForEval,
    totalCost,
    matches,
    atomicMapForEval
  );
  const hasSubjectiveFilter =
    (Number(subjectiveDeltaPct) || 0) !== 0 ||
    (isArchetype && stance !== "objective");
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
              !simVoidFirstMatch && objectiveHitMatrix
                ? objectiveHitMatrix
                : null,
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

  const nextTagline = !isArchetype
    ? `总投入 ¥${totalCost} · 保底返 ¥${minReturn.toFixed(1)} ~ 最高 ¥${maxReturn.toFixed(1)}`
    : basePlan.tagline;

  const effectiveConsolidate = Boolean(
    consolidateTickets || basePlan.consolidateTickets
  );
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
    logicalGroupCount: lines.length,
    physicalTicketCount: countPhysical99xSlips(lines),
    zeroPayoutProb: Math.max(0, 1 - winProb),
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
      sig += `${j > 0 ? "," : ""}${g.matchId}/${g.poolCode}/${g.optionKey}@${g.odds}~${Number(g.fairProb ?? 0).toFixed(8)}`;
    }
  }
  return sig;
}

export function archetypeToReport(plan, fallbackManual, matches = null) {
  if (!isValidPlanObject(plan)) return fallbackManual;
  const matchSet = new Set();
  const sizeSet = new Set();
  plan.lines.forEach((l) => {
    sizeSet.add(l.legs.length);
    l.legs.forEach((lg) => matchSet.add(lg.matchId));
  });
  const physicalTickets = plan.lines.map((l) => {
    const { mult, cap, unitBeforeCap } = computeLineStatutoryPayout(
      l.legs.map((g) => Number(g.odds)),
      l.multiple
    );
    const effectiveUnit = Math.min(cap, Number(l.unitPayout));
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
      prob: l.prob,
      unitPayout: effectiveUnit,
      totalPayout: returnPayout,
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
    jointEval = evaluateTicketsOnQuotientSpace(
      physicalTickets,
      plan.totalCost,
      matches,
      atomicMap
    );
    objEval =
      Array.isArray(matches) && matches.length > 0
        ? evaluateTicketsOnQuotientSpace(
            physicalTickets,
            plan.totalCost,
            matches,
            objectiveAtomicMap,
            { metricsOnly: true }
          )
        : jointEval;
  }

  const invUnitSum = physicalTickets.reduce(
    (a, c) => a + 2 / Math.max(0.5, c.unitPayout),
    0
  );
  const harmonicEffOdds = invUnitSum > 0 ? 1 / invUnitSum : 1.5;
  const activeSizes = Array.from(sizeSet)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b);

  const maxLineMult = Math.max(
    ...plan.lines.map((l) => Number(l.multiple) || 1)
  );
  const consolidatedTickets = plan.consolidateTickets
    ? (() => {
        const batchCounts = new Map();
        for (const l of plan.lines) {
          const m = Math.max(1, Number(l.multiple) || 1);
          const bk = `${(l.legs ?? []).length}:${m}`;
          batchCounts.set(bk, (batchCounts.get(bk) ?? 0) + 1);
        }
        let sumSheets = 0;
        for (const [bk, cnt] of batchCounts.entries()) {
          const m = Number(bk.split(":")[1]) || 1;
          sumSheets += Math.ceil(cnt / 4) * Math.max(1, Math.ceil(m / 99));
        }
        return Math.max(1, sumSheets);
      })()
    : countPhysical99xSlips(plan.lines);

  const hasInvalidOdds = plan.lines.some((l) =>
    l.legs.some((g) => !(Number(g.odds) > 0))
  );
  const over20k = plan.totalCost > 20_000;
  const resolvedBreakevenUpgradeCost =
    jointEval.underwaterCount > 0
      ? (plan.breakevenUpgradeCost ??
        (fallbackManual?.breakevenUpgradeCost &&
        fallbackManual.breakevenUpgradeCost > plan.totalCost
          ? fallbackManual.breakevenUpgradeCost
          : null))
      : null;

  const hasExplicitMatches = Array.isArray(matches) && matches.length > 0;
  const computedVig = computeCapitalWeightedVig(plan.lines, matches);
  const effectiveVigPct =
    hasExplicitMatches || !(Number(plan.vigPct) > 0)
      ? computedVig.vigPct
      : Number(plan.vigPct);
  const avgPayoutRatio = Math.max(
    0,
    Math.min(1, (100 - effectiveVigPct) / 100)
  );

  const planWarnings = buildStatutorySlipWarnings({
    isManualSlip: false,
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
    modeLabel: `${plan.shortTab}·分倍精算`,
    maxMultiple: maxLineMult,
    physicalSlipCount: consolidatedTickets,
    hasInvalidOdds,
  });

  return assembleEvaluatedTruthReport({
    matchCount: matchSet.size,
    betCount: plan.lines.length,
    comboCount: jointEval.combos.length,
    multiple: 1,
    modeLabel: `${plan.shortTab}·分倍精算`,
    canSingle: matchSet.size === 1,
    canCheckout: plan.lines.length > 0 && !over20k && !hasInvalidOdds,
    ruleBlockReason: hasInvalidOdds
      ? "选单包含未开售或无效赔率选项"
      : over20k
        ? `单次订单金额 ¥${plan.totalCost} 超出体彩 ¥20,000 硬上限，请调低仓位或分单`
        : null,
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
    dangerScore:
      plan.key === "alpha-radar" || plan.key === "value-assassin"
        ? 58
        : jointEval.underwaterCount > 0
          ? 44
          : 26,
    effectiveOdds: harmonicEffOdds,
    breakevenUpgradeCost: resolvedBreakevenUpgradeCost,
    consolidatedTickets,
    syntheticHint: `已启用【${plan.badge}】：${plan.tagline}`,
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
      detail: `${m.aiAlert.summary}（Price-In 消化度：${m.aiAlert.priceInStatus}${
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
