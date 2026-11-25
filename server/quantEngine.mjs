// Pure in-process actuarial orchestration facade (zero filesystem or network I/O).
import { buildTicketLineReceipt } from "./ticketReceipt.mjs";
import { scanMatchAlphaCandidates } from "./quant/coherentCalibration.mjs";
import {
  getCachedWorkspaceFivePlans,
  serializePassSpecCacheKey,
} from "./quant/paretoPortfolio.mjs";
import {
  applyAutoSyntheticReportMeta,
  applySandboxToPlan,
  archetypeToReport,
  buildPortfolioQuoteInputSignature,
  buildSandboxAdjustedBundle,
  buildXiaoGaoWarnings,
  computeProOrderInsights,
  computeTruthReport,
  isValidPlanObject,
  normalizePortfolioKey,
  orchestrateSingleMatchSynthetic,
  resolveCachedBaselineArchetypePlan,
  resolveCachedBonusPlan,
  resolveCachedWorkspaceBaseline,
  sanitizeAndDeduplicatePicks,
  scaleArchetypePlan,
  settleTicketSnapshotOnResultsMap,
  validateAppliedArchetypeQuoteGate,
  validateBoundBonusSingleAuthGate,
} from "./quant/reportAndSettlement.mjs";
import {
  FALLBACK_MATCHES,
  parseSportteryResultsJson,
} from "./quant/sportteryParsers.mjs";

export {
  OFFICIAL_CRS_PAIRS,
  POOL_MAX_PASS,
  bankerRoundCents,
  bankerRoundParlayUnitPayout,
  consolidateTerminalPhysicalSlips,
  statutorySingleBetCap,
} from "./quant/statutoryRules.mjs";
export {
  analyzeMatchMicroQuant,
  calibrateMatchCoherentModel,
  devigPoolProbabilities,
} from "./quant/coherentCalibration.mjs";
export {
  generateFiveArchetypes,
  generateParetoPortfolio,
} from "./quant/paretoPortfolio.mjs";
export { optimizeBonusPlan } from "./quant/reportAndSettlement.mjs";
export { parseSportteryRawJson } from "./quant/sportteryParsers.mjs";
export {
  FALLBACK_MATCHES,
  archetypeToReport,
  buildXiaoGaoWarnings,
  computeProOrderInsights,
  computeTruthReport,
  parseSportteryResultsJson,
  sanitizeAndDeduplicatePicks,
};

const WORKSPACE_PARETO_CACHE = new Map();

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
  const voidMatchIds = Array.isArray(params?.voidMatchIds)
    ? params.voidMatchIds.map(String).filter(Boolean).slice(0, 16)
    : [];
  const hasVoidSim = simVoidFirstMatch || voidMatchIds.length > 0;
  const singleAuthGrant =
    params?.singleAuthGrant && typeof params.singleAuthGrant === "object"
      ? params.singleAuthGrant
      : undefined;
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
    subjectiveDeltaPct,
    { voidMatchIds }
  );
  const sandboxAdjustedPicks = sandboxBundle.picks;
  const hasSubjectiveShift = subjectiveDeltaPct !== 0;
  const hasSandboxShift = hasVoidSim || hasSubjectiveShift;
  const baselineBundle = hasSandboxShift
    ? buildSandboxAdjustedBundle(picks, matches, false, 0)
    : sandboxBundle;
  const baselinePicks = baselineBundle.picks;
  const objectiveVoidBundle =
    hasSubjectiveShift && hasVoidSim
      ? buildSandboxAdjustedBundle(picks, matches, simVoidFirstMatch, 0, {
          voidMatchIds,
        })
      : baselineBundle;

  const { precomputedBaselineManual, entry: baseCacheEntry } =
    resolveCachedWorkspaceBaseline({
      hasSandboxShift,
      clientAlerts,
      baselinePicks,
      multiple,
      passKey: serializePassSpecCacheKey(passSpec),
      matches,
      passSpec,
      atomicMap: baselineBundle.atomicMap,
    });

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
        hasSubjectiveShift && !hasVoidSim && precomputedBaselineManual
          ? precomputedBaselineManual
          : null,
    }
  );
  const baselineManualReport = precomputedBaselineManual ?? manualReport;

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
  const quoteSigMeta = buildPortfolioQuoteInputSignature({
    picks: baselinePicks,
    budget,
    resolvedTargets,
    anchorToRadarPicks,
    stance,
    subjectiveDeltaPct:
      params?.quoteCheckSubjectiveDeltaPct !== undefined
        ? params.quoteCheckSubjectiveDeltaPct
        : subjectiveDeltaPct,
    allowSaveCash,
    unlockFullAgg,
    passSpec,
  });
  const currentQuoteInputSig = quoteSigMeta.inputSig;
  const gateQuoteInputSig =
    params?.quoteCheckSubjectiveDeltaPct === undefined &&
    planSpec?.kind === "archetype" &&
    planSpec.appliedSubjectiveDeltaPct !== undefined &&
    Number(planSpec.appliedSubjectiveDeltaPct) !== Number(subjectiveDeltaPct)
      ? buildPortfolioQuoteInputSignature({
          picks: baselinePicks,
          budget,
          resolvedTargets,
          anchorToRadarPicks,
          stance,
          subjectiveDeltaPct: planSpec.appliedSubjectiveDeltaPct,
          allowSaveCash,
          unlockFullAgg,
          passSpec,
        }).inputSig
      : currentQuoteInputSig;

  const rawFivePlans = getCachedWorkspaceFivePlans(
    WORKSPACE_PARETO_CACHE,
    resolvedTargets,
    budget,
    stance,
    unlockFullAgg,
    anchorPicks,
    portfolioOpts
  );
  const stampPortfolioPlan = (p, sig) => ({
    ...p,
    ...(sig ? { quoteInputSig: sig } : {}),
    quoteBudgetYuan: budget,
    ...(Array.isArray(p.remediationActions) && p.remediationActions.length > 0
      ? {
          remediationActions: p.remediationActions.map((a) => ({
            ...a,
            sourceQuoteInputSig: currentQuoteInputSig,
            sourceBudgetYuan: budget,
          })),
        }
      : {}),
  });
  const fivePlans = rawFivePlans.map((p) =>
    stampPortfolioPlan(p, currentQuoteInputSig)
  );
  const rawObjectivePlans =
    stance !== "objective"
      ? getCachedWorkspaceFivePlans(
          WORKSPACE_PARETO_CACHE,
          resolvedTargets,
          budget,
          "objective",
          unlockFullAgg,
          anchorPicks,
          portfolioOpts
        )
      : undefined;
  const objectivePortfolioPlans = rawObjectivePlans
    ? rawObjectivePlans.map((p) => stampPortfolioPlan(p, null))
    : undefined;

  let appliedPlan = null;
  let baselineAppliedPlan = null;
  let alphaSmoothedAfterSync = false;
  let quoteRejectedReason = null;
  if (planSpec?.kind === "bonus") {
    const bonusGate = validateBoundBonusSingleAuthGate({
      planSpec,
      singleAuthGrant,
      picks: baselinePicks,
      matches,
    });
    if (!bonusGate.ok) {
      quoteRejectedReason = bonusGate.reason;
    } else {
      const mode =
        planSpec.optMode === "hot-first" || planSpec.optMode === "cold-first"
          ? planSpec.optMode
          : "equal";
      const baseAppliedPlan = resolveCachedBonusPlan(
        baselineManualReport,
        matches,
        mode,
        planSpec,
        baseCacheEntry
      );
      baselineAppliedPlan = hasSandboxShift ? baseAppliedPlan : null;
      appliedPlan = applySandboxToPlan(
        baseAppliedPlan,
        matches,
        picks,
        simVoidFirstMatch,
        subjectiveDeltaPct,
        {
          isArchetype: false,
          consolidateTickets: planSpec.consolidateTickets !== false,
          stance,
          manualReport,
          objectiveHitMatrix: baselineManualReport?._reusableHitMatrix ?? null,
          voidMatchIds,
        }
      );
    }
  } else if (planSpec?.kind === "archetype") {
    const normalizedKey = normalizePortfolioKey(planSpec.key);
    const validSnap = isValidPlanObject(planSpec.snapshotPlan)
      ? planSpec.snapshotPlan
      : null;
    const quoteGate = validateAppliedArchetypeQuoteGate({
      params,
      planSpec,
      validSnap,
      currentQuoteInputSig: gateQuoteInputSig,
      matches,
    });
    if (!quoteGate.ok) {
      quoteRejectedReason = quoteGate.reason;
    } else {
      const rawLiveRef =
        rawFivePlans.find((p) => p.key === normalizedKey) ?? null;
      const liveCandidate =
        fivePlans.find((p) => p.key === normalizedKey) ?? null;
      const usableLive =
        liveCandidate &&
        liveCandidate.available !== false &&
        liveCandidate.lines.length > 0
          ? liveCandidate
          : null;
      const basePlan = validSnap ?? usableLive;
      const scaledBasePlan = scaleArchetypePlan(
        basePlan,
        planSpec.scaleMultiple
      );
      baselineAppliedPlan = hasSandboxShift
        ? resolveCachedBaselineArchetypePlan(
            scaledBasePlan,
            usableLive ? rawLiveRef : null,
            matches,
            picks,
            {
              hasFrozenSnapshot: Boolean(validSnap),
              scaleMultiple: planSpec.scaleMultiple,
              consolidateTickets: planSpec.consolidateTickets !== false,
              stance,
              baselineManualReport,
            },
            baseCacheEntry
          )
        : null;
      appliedPlan = applySandboxToPlan(
        scaledBasePlan,
        matches,
        picks,
        simVoidFirstMatch,
        subjectiveDeltaPct,
        {
          isArchetype: true,
          hasFrozenSnapshot: Boolean(validSnap),
          consolidateTickets: planSpec.consolidateTickets !== false,
          stance,
          manualReport,
          voidMatchIds,
        }
      );

      if (normalizedKey === "alpha-radar" && validSnap && appliedPlan) {
        const anyStillAlpha = validSnap.lines.some((l) =>
          l.legs.some((lg) => {
            const fm = matches.find((m) => m.id === lg.matchId);
            if (!fm) return false;
            return scanMatchAlphaCandidates(fm, null).candidates.some((c) =>
              Array.isArray(c.betterPicks)
                ? c.betterPicks.some(
                    (bp) =>
                      bp.poolCode === lg.poolCode &&
                      bp.optionKey === lg.optionKey
                  )
                : c.poolCode === lg.poolCode && c.optionKey === lg.optionKey
            );
          })
        );
        alphaSmoothedAfterSync = !usableLive || !anyStillAlpha;
      }
    }
  }

  let autoSyntheticMeta = null;
  let baselineAutoSyntheticMeta = null;
  if (
    (!planSpec || quoteRejectedReason) &&
    !appliedPlan &&
    manualReport.matchCount === 1 &&
    !manualReport.canCheckout &&
    !manualReport.canSingle &&
    manualReport.selectionStatus !== "rule-blocked" &&
    !manualReport.hasSameMatchCrossPoolConflict
  ) {
    const singleMid = picks[0]?.matchId;
    const singleMatch = singleMid
      ? matches.find((m) => m.id === singleMid)
      : null;
    const matchPicks = singleMatch
      ? picks.filter((p) => p.matchId === singleMatch.id)
      : [];
    const baseSynArgs = {
      singleMatch,
      matchPicks,
      matches,
      picks,
      multiple,
      syntheticSingleMode: quoteRejectedReason ? "off" : syntheticSingleMode,
      singleAuthGrant: quoteRejectedReason ? undefined : singleAuthGrant,
      stance,
    };
    const synRes = orchestrateSingleMatchSynthetic({
      ...baseSynArgs,
      simVoidFirstMatch,
      voidMatchIds,
      subjectiveDeltaPct,
      hasSubjectiveShift,
      sandboxAtomicMap: singleMatch
        ? (sandboxBundle.atomicMap?.get(singleMatch.id) ?? null)
        : null,
      manualReport,
    });
    appliedPlan = synRes.appliedPlan;
    autoSyntheticMeta = synRes.autoSyntheticMeta;
    if (synRes.quoteRejectedReason && !quoteRejectedReason) {
      quoteRejectedReason = synRes.quoteRejectedReason;
    }
    if (hasSandboxShift && appliedPlan) {
      const baseSynRes = orchestrateSingleMatchSynthetic({
        ...baseSynArgs,
        simVoidFirstMatch: false,
        voidMatchIds: [],
        subjectiveDeltaPct: 0,
        hasSubjectiveShift: false,
        sandboxAtomicMap: singleMatch
          ? (baselineBundle.atomicMap?.get(singleMatch.id) ?? null)
          : null,
        manualReport: baselineManualReport,
      });
      baselineAppliedPlan = baseSynRes.appliedPlan;
      baselineAutoSyntheticMeta = baseSynRes.autoSyntheticMeta;
    }
  }

  const buildEffReport = (appPlan, manRep, synMeta) => {
    const rep = appPlan
      ? archetypeToReport(appPlan, manRep, matches)
      : quoteRejectedReason
        ? {
            ...manRep,
            canCheckout: false,
            ruleBlockReason: quoteRejectedReason,
          }
        : manRep;
    applyAutoSyntheticReportMeta(rep, manRep, synMeta, syntheticSingleMode);
    return rep;
  };
  const effectiveReport = buildEffReport(
    appliedPlan,
    manualReport,
    autoSyntheticMeta
  );
  const baselineReport = hasSandboxShift
    ? buildEffReport(
        baselineAppliedPlan,
        baselineManualReport,
        baselineAutoSyntheticMeta ?? autoSyntheticMeta
      )
    : effectiveReport;

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

  const auditedWarningLegs =
    appliedPlan &&
    Array.isArray(appliedPlan.lines) &&
    appliedPlan.lines.length > 0
      ? appliedPlan.lines.flatMap((ln) => ln?.legs || [])
      : Array.isArray(effectiveReport?.tickets) &&
          effectiveReport.tickets.length > 0
        ? [...effectiveReport.tickets.flatMap((tk) => tk?.legs || []), ...picks]
        : picks;

  const allWarnings = [
    ...effectiveReport.warnings,
    ...buildXiaoGaoWarnings(auditedWarningLegs, matches),
  ];

  const quotedPlan = hasSandboxShift ? baselineAppliedPlan : appliedPlan;
  const quotedLines =
    (planSpec || baselineReport.syntheticAutoMounted) && quotedPlan
      ? quotedPlan.lines
      : baselineReport.tickets;
  return {
    manualReport,
    baselineSlipLineSig: buildTicketLineReceipt(quotedLines, multiple, matches),
    effectiveReport,
    baselineManualReport,
    baselineReport,
    appliedPlan,
    baselineAppliedPlan: hasSandboxShift ? baselineAppliedPlan : appliedPlan,
    insights,
    portfolioPlans: fivePlans,
    ...(objectivePortfolioPlans ? { objectivePortfolioPlans } : {}),
    fivePlans,
    subjectiveEVPct,
    allWarnings,
    quoteInputSig: currentQuoteInputSig,
    ...(quoteRejectedReason ? { quoteRejectedReason } : {}),
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
