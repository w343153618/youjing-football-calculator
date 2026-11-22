// Pure in-process actuarial orchestration facade (zero filesystem or network I/O).
import {
  OFFICIAL_CRS_PAIRS,
  POOL_MAX_PASS,
  bankerRoundCents,
  bankerRoundParlayUnitPayout,
  statutorySingleBetCap,
} from "./quant/statutoryRules.mjs";
import {
  analyzeMatchMicroQuant,
  calibrateMatchCoherentModel,
  computeMatchPoolsFingerprint,
  devigPoolProbabilities,
  scanMatchAlphaCandidates,
} from "./quant/coherentCalibration.mjs";
import {
  generateFiveArchetypes,
  generateParetoPortfolio,
} from "./quant/paretoPortfolio.mjs";
import {
  applyAutoSyntheticReportMeta,
  applySandboxToPlan,
  archetypeToReport,
  buildSandboxAdjustedBundle,
  buildXiaoGaoWarnings,
  computeProOrderInsights,
  computeTruthReport,
  isValidPlanObject,
  normalizePortfolioKey,
  optimizeBonusPlan,
  orchestrateSingleMatchSynthetic,
  sanitizeAndDeduplicatePicks,
  scaleArchetypePlan,
  settleTicketSnapshotOnResultsMap,
} from "./quant/reportAndSettlement.mjs";
import {
  FALLBACK_MATCHES,
  parseSportteryRawJson,
  parseSportteryResultsJson,
} from "./quant/sportteryParsers.mjs";

export {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  POOL_MAX_PASS,
  analyzeMatchMicroQuant,
  archetypeToReport,
  bankerRoundCents,
  bankerRoundParlayUnitPayout,
  buildXiaoGaoWarnings,
  calibrateMatchCoherentModel,
  computeProOrderInsights,
  computeTruthReport,
  devigPoolProbabilities,
  generateFiveArchetypes,
  generateParetoPortfolio,
  optimizeBonusPlan,
  parseSportteryRawJson,
  parseSportteryResultsJson,
  statutorySingleBetCap,
};

const WORKSPACE_PARETO_CACHE = new Map();

function serializePassSpecCacheKey(passSpec) {
  if (!passSpec || passSpec.mode === "auto") return "auto";
  if (passSpec.mode === "combo" && passSpec.comboCode) {
    return `c:${passSpec.comboCode}`;
  }
  if (passSpec.mode === "free" && Array.isArray(passSpec.passSizes)) {
    return `f:${[...passSpec.passSizes].sort((a, b) => a - b).join(",")}`;
  }
  return "auto";
}

function getCachedWorkspaceFivePlans(
  resolvedTargets,
  budget,
  stance,
  unlockFullAgg,
  anchorPicks,
  portfolioOptions = {}
) {
  const acceptPartialSingleCoverage = Boolean(
    portfolioOptions?.acceptPartialSingleCoverage
  );
  const allowSaveCash = Boolean(portfolioOptions?.allowSaveCash);
  const passKey = serializePassSpecCacheKey(portfolioOptions?.passSpec);
  let key = `${budget}|${stance}|${unlockFullAgg ? 1 : 0}|p=${acceptPartialSingleCoverage ? 1 : 0}|sc=${allowSaveCash ? 1 : 0}|ps=${passKey}|t=${resolvedTargets.length}`;
  for (let i = 0; i < resolvedTargets.length; i++) {
    const m = resolvedTargets[i];
    const fp = computeMatchPoolsFingerprint(m);
    key += `;${m.id}:${fp.h1.toString(36)}:${fp.h2.toString(36)}:${fp.len}`;
  }
  if (Array.isArray(anchorPicks) && anchorPicks.length > 0) {
    key += `|a=${anchorPicks.length}`;
    for (let i = 0; i < anchorPicks.length; i++) {
      const p = anchorPicks[i];
      key += `;${p.matchId}:${p.poolCode}:${p.optionKey}:${Number(p.odds).toFixed(4)}`;
    }
  }
  const hit = WORKSPACE_PARETO_CACHE.get(key);
  if (hit) {
    WORKSPACE_PARETO_CACHE.delete(key);
    WORKSPACE_PARETO_CACHE.set(key, hit);
    return hit;
  }
  const plans = generateFiveArchetypes(
    resolvedTargets,
    budget,
    stance,
    unlockFullAgg,
    anchorPicks,
    {
      acceptPartialSingleCoverage,
      allowSaveCash,
      passSpec: portfolioOptions?.passSpec ?? { mode: "auto" },
    }
  );
  if (WORKSPACE_PARETO_CACHE.size >= 32) {
    const oldestKey = WORKSPACE_PARETO_CACHE.keys().next().value;
    if (oldestKey !== undefined) WORKSPACE_PARETO_CACHE.delete(oldestKey);
  }
  WORKSPACE_PARETO_CACHE.set(key, plans);
  return plans;
}

/**
 * 统一服务端黑盒精算调度器（单次密文往返完成全部五维审单、三模分倍、精算配单与对冲计算）
 */
export function evaluateQuantWorkspace(params, matchesInput) {
  const baseMatches =
    matchesInput && matchesInput.length > 0 ? matchesInput : FALLBACK_MATCHES;
  const clientAlerts =
    params?.clientAlerts && typeof params.clientAlerts === "object"
      ? params.clientAlerts
      : null;
  const matches = clientAlerts
    ? baseMatches.map((m) =>
        clientAlerts[m.id] ? { ...m, aiAlert: clientAlerts[m.id] } : m
      )
    : baseMatches;
  const picks = sanitizeAndDeduplicatePicks(params?.picks, 512);
  const multiple = Math.max(
    1,
    Math.min(999, Math.round(Number(params?.multiple) || 5))
  );
  const passSpec = params?.passSpec ?? { mode: "auto" };
  const syntheticSingleMode =
    params?.syntheticSingleMode === "partial-cover" ||
    params?.syntheticSingleMode === "trim-2way" ||
    params?.syntheticSingleMode === "off"
      ? params.syntheticSingleMode
      : "full-3way";
  const subjectiveDeltaPct = Math.max(
    -15,
    Math.min(15, Number(params?.subjectiveDeltaPct) || 0)
  );
  const simVoidFirstMatch = Boolean(params?.simVoidFirstMatch);
  const planSpec = params?.planSpec ?? null;
  const targetIds = Array.isArray(params?.targetIds) ? params.targetIds : [];
  const anchorToRadarPicks = Boolean(params?.anchorToRadarPicks);
  const rawBudgetInput = Number(params?.budget);
  const budget =
    Number.isFinite(rawBudgetInput) && rawBudgetInput > 0
      ? Math.max(2, Math.min(20_000, rawBudgetInput))
      : 100;
  const stance =
    params?.stance === "home-lean" || params?.stance === "upset-watch"
      ? params.stance
      : "objective";
  const unlockFullAgg = Boolean(params?.unlockFullAgg);

  const sandboxBundle = buildSandboxAdjustedBundle(
    picks,
    matches,
    simVoidFirstMatch,
    subjectiveDeltaPct
  );
  const sandboxAdjustedPicks = sandboxBundle.picks;
  const hasSubjectiveShift = subjectiveDeltaPct !== 0;
  const hasSandboxShift = simVoidFirstMatch || hasSubjectiveShift;
  const baselineBundle = hasSandboxShift
    ? buildSandboxAdjustedBundle(picks, matches, false, 0)
    : sandboxBundle;
  const baselinePicks = baselineBundle.picks;
  const objectiveVoidBundle =
    hasSubjectiveShift && simVoidFirstMatch
      ? buildSandboxAdjustedBundle(picks, matches, true, 0)
      : baselineBundle;

  const precomputedBaselineManual =
    hasSandboxShift && (hasSubjectiveShift || planSpec?.kind === "bonus")
      ? computeTruthReport(
          baselinePicks,
          multiple,
          matches,
          passSpec,
          baselineBundle.atomicMap,
          {
            metricsOnly: true,
            captureHitMatrix: true,
            isBaselineAtomic: true,
          }
        )
      : null;

  const manualReport = computeTruthReport(
    sandboxAdjustedPicks,
    multiple,
    matches,
    passSpec,
    sandboxBundle.atomicMap,
    {
      captureHitMatrix: true,
      isBaselineAtomic: !hasSandboxShift,
      hasSubjectiveShift,
      objectiveAtomicMap: objectiveVoidBundle.atomicMap,
      precomputedObjectiveEval:
        hasSubjectiveShift && !simVoidFirstMatch && precomputedBaselineManual
          ? precomputedBaselineManual
          : null,
    }
  );

  const foundTargets = matches.filter((m) => targetIds.includes(m.id));
  const resolvedTargets =
    foundTargets.length > 0 ? foundTargets : matches.slice(0, 2);
  const anchorPicks = anchorToRadarPicks ? baselinePicks : [];
  const acceptPartialSingleCoverage =
    syntheticSingleMode === "partial-cover" ||
    syntheticSingleMode === "trim-2way";
  const allowSaveCash = Boolean(params?.allowSaveCash);
  const portfolioOpts = {
    acceptPartialSingleCoverage,
    allowSaveCash,
    passSpec: anchorToRadarPicks ? passSpec : { mode: "auto" },
  };
  const fivePlans = getCachedWorkspaceFivePlans(
    resolvedTargets,
    budget,
    stance,
    unlockFullAgg,
    anchorPicks,
    portfolioOpts
  );
  const objectivePortfolioPlans =
    stance !== "objective"
      ? getCachedWorkspaceFivePlans(
          resolvedTargets,
          budget,
          "objective",
          unlockFullAgg,
          anchorPicks,
          portfolioOpts
        )
      : undefined;

  let appliedPlan = null;
  let alphaSmoothedAfterSync = false;
  if (planSpec?.kind === "bonus") {
    const mode =
      planSpec.optMode === "hot-first" || planSpec.optMode === "cold-first"
        ? planSpec.optMode
        : "equal";
    const baselineManualForOpt = precomputedBaselineManual ?? manualReport;
    const baseAppliedPlan = scaleArchetypePlan(
      optimizeBonusPlan(baselineManualForOpt, matches, mode, {
        upgradeToBreakeven: Boolean(planSpec.upgradeToBreakeven),
        consolidateTickets: Boolean(planSpec.consolidateTickets),
        targetBudgetCost: planSpec.targetBudgetCost,
      }),
      planSpec.scaleMultiple
    );
    appliedPlan = applySandboxToPlan(
      baseAppliedPlan,
      matches,
      picks,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      {
        isArchetype: false,
        consolidateTickets: Boolean(planSpec.consolidateTickets),
        stance,
        manualReport,
        objectiveHitMatrix: baselineManualForOpt?._reusableHitMatrix ?? null,
      }
    );
  } else if (planSpec?.kind === "archetype") {
    const normalizedKey = normalizePortfolioKey(planSpec.key);
    const validSnap = isValidPlanObject(planSpec.snapshotPlan)
      ? planSpec.snapshotPlan
      : null;
    const liveCandidate =
      fivePlans.find((p) => p.key === normalizedKey) ?? null;
    const usableLive =
      liveCandidate &&
      liveCandidate.available !== false &&
      liveCandidate.lines.length > 0
        ? liveCandidate
        : null;
    const basePlan = validSnap ?? usableLive;
    const scaledBasePlan = scaleArchetypePlan(basePlan, planSpec.scaleMultiple);
    appliedPlan = applySandboxToPlan(
      scaledBasePlan,
      matches,
      picks,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      {
        isArchetype: true,
        hasFrozenSnapshot: Boolean(validSnap),
        consolidateTickets: Boolean(planSpec.consolidateTickets),
        stance,
        manualReport,
        targetFirstMid: foundTargets[0]?.id ?? null,
      }
    );

    if (normalizedKey === "alpha-radar" && validSnap && appliedPlan) {
      // Check if live alpha-radar is now empty OR none of validSnap's legs still clear >= +3% alpha on live matches
      let anySnapLegStillAlpha = false;
      for (const l of validSnap.lines) {
        for (const lg of l.legs) {
          const fm = matches.find((m) => m.id === lg.matchId);
          if (!fm) continue;
          const scan = scanMatchAlphaCandidates(fm, null);
          if (
            scan.candidates.some((c) =>
              Array.isArray(c.betterPicks)
                ? c.betterPicks.some(
                    (bp) =>
                      bp.poolCode === lg.poolCode &&
                      bp.optionKey === lg.optionKey
                  )
                : c.poolCode === lg.poolCode && c.optionKey === lg.optionKey
            )
          ) {
            anySnapLegStillAlpha = true;
            break;
          }
        }
        if (anySnapLegStillAlpha) break;
      }
      if (!usableLive || !anySnapLegStillAlpha) {
        alphaSmoothedAfterSync = true;
      }
    }
  }

  let autoSyntheticMeta = null;
  if (
    !planSpec &&
    !appliedPlan &&
    manualReport.matchCount === 1 &&
    !manualReport.canCheckout &&
    !manualReport.hasSameMatchCrossPoolConflict
  ) {
    const singleMid = picks[0]?.matchId;
    const singleMatch = singleMid
      ? matches.find((m) => m.id === singleMid)
      : null;
    const matchPicks = singleMatch
      ? picks.filter((p) => p.matchId === singleMatch.id)
      : [];
    const synRes = orchestrateSingleMatchSynthetic({
      singleMatch,
      matchPicks,
      matches,
      picks,
      multiple,
      syntheticSingleMode,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      hasSubjectiveShift,
      sandboxAtomicMap: singleMatch
        ? (sandboxBundle.atomicMap?.get(singleMatch.id) ?? null)
        : null,
      stance,
      manualReport,
    });
    appliedPlan = synRes.appliedPlan;
    autoSyntheticMeta = synRes.autoSyntheticMeta;
  }

  const effectiveReport = appliedPlan
    ? archetypeToReport(appliedPlan, manualReport, matches)
    : manualReport;

  applyAutoSyntheticReportMeta(
    effectiveReport,
    manualReport,
    autoSyntheticMeta,
    syntheticSingleMode
  );

  if (
    alphaSmoothedAfterSync &&
    effectiveReport &&
    Array.isArray(effectiveReport.warnings)
  ) {
    effectiveReport.warnings = [
      {
        id: "alpha-smoothed",
        severity: "warn",
        title:
          "⚠️ 原跨盘错价洼地已被官方最新调水抚平，建议还原等倍或改选前 3 档主方案",
        detail:
          "最新同步水位已消化原跨盘超额红利，当前实票结构已按最新实盘水位保留重算派奖与 EV。",
      },
      ...effectiveReport.warnings.filter((w) => w.id !== "alpha-smoothed"),
    ];
  }

  const insights = computeProOrderInsights(
    sandboxAdjustedPicks,
    effectiveReport,
    matches,
    appliedPlan
  );

  const subjectiveEVPct =
    effectiveReport.totalCost > 0 ? effectiveReport.expectedValueRate * 100 : 0;

  const allWarnings = [
    ...effectiveReport.warnings,
    ...buildXiaoGaoWarnings(picks, matches),
  ];

  return {
    manualReport,
    effectiveReport,
    appliedPlan,
    insights,
    portfolioPlans: fivePlans,
    ...(objectivePortfolioPlans ? { objectivePortfolioPlans } : {}),
    fivePlans,
    subjectiveEVPct,
    allWarnings,
  };
}

/**
 * 基于封存的出票快照与中国体彩官方完场赛果执行五池精确算奖、局部回血定性与早场红单实时补单测算
 */
export function settleTicketSnapshotWithOfficialResults(
  snapshot,
  resultsInput,
  opts = {}
) {
  const resultsById =
    resultsInput instanceof Map
      ? resultsInput
      : parseSportteryResultsJson(resultsInput);
  return settleTicketSnapshotOnResultsMap(snapshot, resultsById, opts);
}
