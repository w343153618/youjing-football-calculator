import {
  EMPTY_WORKSPACE_RESPONSE,
  SUBJECTIVE_DELTA_MAX,
  SUBJECTIVE_DELTA_MIN,
  type ActiveAuditedSlip,
  type AppliedPlanSpec,
  type AppliedTicketSnapshot,
  type ArchetypeKey,
  type ArchetypePlan,
  type AuditedLegSource,
  type AuditedMatchPoolGroup,
  type AuditedSlipLeg,
  type AuditedSlipMatchEntry,
  type BonusOptMode,
  type BridgeMatchCandidate,
  type BridgeMatchPreview,
  type BudgetMismatchMeta,
  type ComboRow,
  type ConvertPlanToManualPreview,
  type EquivalentArbItem,
  type LedgerTicketSnapshot,
  type LivePortfolioQuoteState,
  type MatchItem,
  type PartialCoveragePreview,
  type PassSelectionSpec,
  type PlanLeg,
  type PlanTicketLine,
  type PoolCode,
  type PortfolioKey,
  type PortfolioRemediationAction,
  type QuantWorkspaceParams,
  type QuantWorkspaceResponse,
  type SelectedPick,
  type SyntheticSingleMode,
  type UserStance,
} from "../prototype/quantTypes.ts";

export type MatchMode = "mix" | "spf" | "bf" | "zjq" | "bqc" | "single";
export type PresetScenarioKind =
  "underwater" | "synthetic" | "parlay4" | "hedge2";

export {
  MANUAL_TOPICS,
  extractSearchBigrams,
  matchManualTopics,
  resolveManualNavigation,
  type ManualNavigationAction,
  type ManualNavigationState,
  type ManualSectionId,
  type ManualTopic,
} from "../manual/manualCatalog.ts";

export interface StanceDeltaSummary {
  stance: UserStance;
  hasBaseline: boolean;
  ruleNote: string;
  instantRecalcNote: string;
  anchorLockNote: string | null;
  deltaProfitProbPct: number;
  deltaEvPct: number;
  ticketsChanged: boolean;
}

export interface PlayabilityGates {
  isSingleNonSingleContext: boolean;
  isSyntheticPlayable: boolean;
  hasSyntheticInherentBlindSpot: boolean;
  canTrimSynthetic2Way: boolean;
  partialCoveragePreview: PartialCoveragePreview | null;
  manualBonusLineCount: number;
  isBonusOver512: boolean;
  isBonusOptDisabled: boolean;
  activeBankerSet: Set<string>;
  canToggleBanker: boolean;
  canToggleBankerMatch: (matchId: string) => boolean;
  breakevenTargetCost: number | null;
  budgetMismatchMeta: BudgetMismatchMeta | null;
  appliedPlan: ArchetypePlan | null;
  effectiveAppliedPlan: ArchetypePlan | null;
  portfolioPlans: ArchetypePlan[];
  currentArch: ArchetypePlan | null;
  fallbackValidArch: ArchetypePlan | null;
  showBridgeFinder: boolean;
  hasSuboptimalManual: boolean;
}

const CLIENT_STATUTORY_POOL_MAX_PASS: Record<PoolCode, number> = {
  HAD: 8,
  HHAD: 8,
  TTG: 6,
  HAFU: 4,
  CRS: 4,
};

function computeElementaryBetCount(
  perMatchCounts: number[],
  passSizes: number[],
  bankerIndices: number[] = []
): number {
  const n = perMatchCounts.length;
  if (n === 0 || passSizes.length === 0) return 0;
  const maxS = Math.min(n, Math.max(0, ...passSizes));
  if (maxS <= 0) return 0;
  if (bankerIndices.length === 0) {
    const dp = new Float64Array(maxS + 1);
    dp[0] = 1;
    for (const c of perMatchCounts) {
      for (let s = maxS; s >= 1; s--) {
        dp[s] += dp[s - 1] * c;
      }
    }
    return passSizes.reduce(
      (sum, s) => sum + (s >= 1 && s <= maxS ? Math.round(dp[s]) : 0),
      0
    );
  }
  const bankerSet = new Set(bankerIndices);
  let bankerProd = 1;
  const nonBankerCounts: number[] = [];
  for (let i = 0; i < n; i++) {
    if (bankerSet.has(i)) bankerProd *= perMatchCounts[i];
    else nonBankerCounts.push(perMatchCounts[i]);
  }
  const bCount = bankerSet.size;
  const maxRem = Math.max(0, maxS - bCount);
  const dp = new Float64Array(maxRem + 1);
  dp[0] = 1;
  for (const c of nonBankerCounts) {
    for (let s = maxRem; s >= 1; s--) {
      dp[s] += dp[s - 1] * c;
    }
  }
  return passSizes.reduce((sum, s) => {
    const rem = s - bCount;
    if (rem < 0 || rem > nonBankerCounts.length) return sum;
    return sum + Math.round(bankerProd * dp[rem]);
  }, 0);
}

export function normalizeBudgetYuan(rawBudget: number): number {
  const num = Number(rawBudget);
  if (!Number.isFinite(num) || num <= 0) return 10;
  return Math.max(2, Math.min(20000, Math.floor(num / 2) * 2));
}

function buildPlanTicketSignature(plan?: ArchetypePlan | null): string {
  if (!plan || plan.available === false || !Array.isArray(plan.lines))
    return "";
  return plan.lines
    .map(
      (l) =>
        `${l.modeLabel}:${l.multiple}:${l.legs
          .map((lg) => `${lg.matchId}.${lg.poolCode}.${lg.optionKey}`)
          .sort()
          .join("+")}`
    )
    .sort()
    .join(";");
}

export type ComboSortMode = "loss-first" | "prob-first" | "profit-first";

export interface AttributedWinningTicket extends ComboRow {
  ticketNo: number;
  multiple: number;
}

export interface ComboTicketBreakdown {
  isAggregateRange: boolean;
  scenarioLabel: string;
  legs: SelectedPick[];
  winningTickets: AttributedWinningTicket[];
  winningTicketCount: number;
  roiMultiple: number;
  barTone: "loss" | "breakeven" | "gain";
  barFillPct: number;
}

export function resolveComboTicketBreakdown(
  combo: ComboRow,
  tickets: ComboRow[] | undefined,
  totalCost: number,
  options?: {
    matchCount?: number;
    defaultMultiple?: number;
    appliedLines?: PlanTicketLine[];
  }
): ComboTicketBreakdown {
  const legs = Array.isArray(combo.legs) ? combo.legs : [];
  const isAggregateRange =
    combo.desc.startsWith("派奖区间") || legs.length === 0;
  const legKeySet = new Set(
    legs.map((lg) => `${lg.matchId}:${lg.poolCode}:${lg.optionKey}`)
  );
  const totalM = options?.matchCount ?? legs.length;
  const scenarioLabel = isAggregateRange
    ? combo.desc
    : totalM > 0 && legs.length >= totalM
      ? `全中 (${legs.length}场)`
      : `命中 ${legs.length}/${Math.max(legs.length, totalM)} 场`;

  const defaultMult = Math.max(1, options?.defaultMultiple ?? 1);
  const appliedLines = options?.appliedLines;

  const winningTickets: AttributedWinningTicket[] =
    !isAggregateRange && Array.isArray(tickets)
      ? tickets.flatMap((tk, idx) => {
          const tLegs = Array.isArray(tk.legs) ? tk.legs : [];
          if (tLegs.length === 0) return [];
          const hit = tLegs.every((tl) =>
            legKeySet.has(`${tl.matchId}:${tl.poolCode}:${tl.optionKey}`)
          );
          if (!hit) return [];
          const matchedLine = appliedLines?.[idx];
          const resolvedMult =
            matchedLine?.multiple ??
            (tk.unitPayout > 0
              ? Math.max(1, Math.round(tk.totalPayout / tk.unitPayout))
              : defaultMult);
          return [
            {
              ...tk,
              ticketNo: idx + 1,
              multiple: resolvedMult,
            },
          ];
        })
      : [];

  const safeCost = Math.max(1, Number(totalCost) || 1);
  const roiMultiple =
    totalCost > 0 ? Number((combo.totalPayout / safeCost).toFixed(2)) : 0;
  const barTone: "loss" | "breakeven" | "gain" =
    combo.isUnderwater || combo.netProfit < 0
      ? "loss"
      : combo.netProfit === 0
        ? "breakeven"
        : "gain";
  const rawPct = Math.round((Math.abs(combo.netProfit) / safeCost) * 100);
  const barFillPct = Math.max(8, Math.min(100, rawPct));

  return {
    isAggregateRange,
    scenarioLabel,
    legs,
    winningTickets,
    winningTicketCount: winningTickets.length,
    roiMultiple,
    barTone,
    barFillPct,
  };
}

export function sortComboRows(
  combos: ComboRow[],
  sortMode: ComboSortMode
): ComboRow[] {
  const copy = [...combos];
  if (sortMode === "loss-first") {
    copy.sort((a, b) => {
      if (a.isUnderwater !== b.isUnderwater) {
        return a.isUnderwater ? -1 : 1;
      }
      if (a.netProfit !== b.netProfit) {
        return a.netProfit - b.netProfit;
      }
      return b.prob - a.prob;
    });
    return copy;
  }
  if (sortMode === "prob-first") {
    copy.sort((a, b) => {
      if (b.prob !== a.prob) return b.prob - a.prob;
      return b.netProfit - a.netProfit;
    });
    return copy;
  }
  copy.sort((a, b) => {
    if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
    return b.prob - a.prob;
  });
  return copy;
}

export interface MatchTrendMovement {
  poolCode: PoolCode;
  poolName: string;
  optionLabel: string;
  odds: number;
  trend: -1 | 1;
  interpretation: string;
}

export interface MatchIntelDigest {
  matchId: string;
  matchTitle: string;
  kickoffLeague: string;
  steamSignal: string;
  trendMovements: MatchTrendMovement[];
  xgSummary: string;
  cardPanAlert: {
    sharePct: number;
    level: "high" | "warn" | "safe";
    tip: string;
  };
  alphaSummary: string;
  poolImpacts: {
    had: string;
    hhad: string;
    ttg: string;
  };
  arbitrages: EquivalentArbItem[];
  aiAlert: MatchItem["aiAlert"] | null;
}

export function buildMatchIntelDigest(match: MatchItem): MatchIntelDigest {
  const mq = match.microQuant;
  const trendMovements: MatchTrendMovement[] = [];
  const poolOrder: PoolCode[] = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];

  for (const pCode of poolOrder) {
    const pool = match.pools[pCode];
    if (!pool || !Array.isArray(pool.options)) continue;
    for (const opt of pool.options) {
      const effectiveDir = opt.movement?.lastHopDirection ?? opt.trend;
      if (effectiveDir === -1 || effectiveDir === 1) {
        const mov = opt.movement;
        const hasMultiFrame =
          mov &&
          mov.frameCount >= 2 &&
          mov.baselineSource !== "single-frame" &&
          typeof mov.cumFairProbDeltaPp === "number" &&
          Number.isFinite(mov.cumFairProbDeltaPp);
        const hopPrefix =
          effectiveDir === -1 ? "▼末跳水位下调" : "▲末跳水位上调";
        const interpretation = hasMultiFrame
          ? `${hopPrefix} · ${
              mov.baselineSource === "official-archive-open"
                ? "自官方归档首报"
                : "自本系统首次观测"
            }累计真率 ${mov.cumFairProbDeltaPp! > 0 ? "+" : ""}${mov.cumFairProbDeltaPp!.toFixed(2)}pp`
          : `${hopPrefix} · 仅单帧观测暂不判累计趋势`;
        trendMovements.push({
          poolCode: pCode,
          poolName: pool.name,
          optionLabel: opt.label,
          odds: opt.odds,
          trend: effectiveDir,
          interpretation,
        });
      }
    }
  }

  const hadOpts = [...(match.pools.HAD?.options ?? [])].sort(
    (a, b) => b.fairProb - a.fairProb
  );
  const topHad = hadOpts[0];
  const topHadMov = topHad?.movement;
  const topHadDir = topHadMov?.lastHopDirection ?? topHad?.trend ?? 0;
  const hadTrendTag =
    topHadMov &&
    topHadMov.frameCount >= 2 &&
    topHadMov.baselineSource !== "single-frame" &&
    typeof topHadMov.cumFairProbDeltaPp === "number" &&
    Math.abs(topHadMov.cumFairProbDeltaPp) >= 0.1
      ? `（累计真率 ${topHadMov.cumFairProbDeltaPp > 0 ? "+" : ""}${topHadMov.cumFairProbDeltaPp.toFixed(1)}pp${
          topHadMov.baselineSource === "local-first-seen" ? "初" : ""
        }）`
      : topHadDir === 1
        ? "（末跳水位▲上调）"
        : topHadDir === -1
          ? "（末跳水位▼下调）"
          : "";
  const hadImpact = topHad
    ? `胜平负首推关注「${topHad.label} @${topHad.odds.toFixed(2)}」（五池去水真率 ${(topHad.fairProb * 100).toFixed(0)}%）${hadTrendTag}`
    : "胜平负暂未开售单关/串关固定奖池";

  const goalLine = match.pools.HHAD?.goalLine || "-1";
  const rawOneGoal = Number(mq.oneGoalShareOfWins) || 0;
  const sharePct = Math.round(rawOneGoal <= 1 ? rawOneGoal * 100 : rawOneGoal);
  const hhadImpact =
    sharePct >= 46
      ? `让球[${goalLine}]高危预警：强队赢球时卡1球占比达 ${sharePct}%，直搏让胜极易卡盘，宜防让球平或改走胜平负`
      : `让球[${goalLine}]盘口评估：赢球时卡1球占比 ${sharePct}%，结合受让方赔付水位决定是否补防让球平`;

  const [rawG1, rawG2, rawTop2Sum] = mq.topTwoGoals ?? ["2", "3", 0.45];
  const g1 = String(rawG1).replace(/^s/i, "");
  const g2 = String(rawG2).replace(/^s/i, "");
  const top2Pct = Math.round(rawTop2Sum <= 1 ? rawTop2Sum * 100 : rawTop2Sum);
  const ttgImpact = `总进球黄金区间落在 ${g1}球 / ${g2}球（合计真率 ${top2Pct}% · ${mq.paceLabel}）`;

  const cardLevel: "high" | "warn" | "safe" =
    sharePct >= 48 ? "high" : sharePct >= 38 ? "warn" : "safe";

  return {
    matchId: match.id,
    matchTitle: `${match.matchNumStr} ${match.home} vs ${match.away}`,
    kickoffLeague: `${match.league} · ${match.kickoff}`,
    steamSignal: mq.steamSignal,
    trendMovements: trendMovements.slice(0, 6),
    xgSummary: `五池反推 xG 主 ${mq.homeXG.toFixed(2)} : 客 ${mq.awayXG.toFixed(2)}（总预期 ${mq.totalXG.toFixed(2)} 球 · ${mq.paceLabel}）`,
    cardPanAlert: {
      sharePct,
      level: cardLevel,
      tip: mq.cardPanTip,
    },
    alphaSummary: mq.alphaScanSummary,
    poolImpacts: {
      had: hadImpact,
      hhad: hhadImpact,
      ttg: ttgImpact,
    },
    arbitrages: mq.arbitrages ?? [],
    aiAlert: match.aiAlert ?? null,
  };
}

export interface PoolSwitchUndoSnapshot {
  picks: SelectedPick[];
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  replacedPoolName: string;
  replacedCount: number;
  nextPoolName: string;
  nextOptionLabel: string;
}

export interface BetSlipState {
  matches: MatchItem[];
  picks: SelectedPick[];
  manualDraftPicks: SelectedPick[];
  mode: MatchMode;
  multiple: number;
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
  appliedTicketSnapshot: AppliedTicketSnapshot | null;
  livePortfolioQuote: LivePortfolioQuoteState;
  activeAuditedSlip: ActiveAuditedSlip;
  syntheticSingleMode: SyntheticSingleMode;
  lastPoolSwitchUndo: PoolSwitchUndoSnapshot | null;
  subjectiveDeltaPct: number;
  simVoidFirstMatch: boolean;
  targetIds: string[];
  anchorToRadarPicks: boolean;
  manualPoolOverride: boolean;
  syncedRadarSig: string;
  budget: number;
  stance: UserStance;
  unlockFullAgg: boolean;
  allowSaveCash: boolean;
  workspace: QuantWorkspaceResponse;
  objectivePortfolioPlans: ArchetypePlan[];
}

export interface TogglePickVerdict {
  ok: boolean;
  action?: "added" | "removed" | "switched-pool";
  optionLabel?: string;
  odds?: number;
  replacedPoolName?: string;
  replacedCount?: number;
  canUndoPoolSwitch?: boolean;
  autoLockedSingleReason?: "dual-single" | "over-8-matches";
  blockedReason?: string;
}

export interface BetSlipControllerOptions {
  computeWorkspace: (
    params: QuantWorkspaceParams,
    matches: MatchItem[]
  ) => QuantWorkspaceResponse | Promise<QuantWorkspaceResponse>;
  debounceMs?: number;
  autoSyncRadar?: boolean;
  onOfflineNetworkError?: () => void;
  onComputeSuccess?: () => void;
}

export function buildRadarSignature(picks: SelectedPick[]): string {
  return picks
    .map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`)
    .sort()
    .join("|");
}

function trimToSinglePoolPerMatch(picks: SelectedPick[]): {
  cleaned: SelectedPick[];
  trimmed: boolean;
} {
  const poolByMatch = new Map<string, PoolCode>();
  let trimmed = false;
  const cleaned = picks.filter((p) => {
    const firstPool = poolByMatch.get(p.matchId) ?? p.poolCode;
    poolByMatch.set(p.matchId, firstPool);
    if (p.poolCode !== firstPool) {
      trimmed = true;
      return false;
    }
    return true;
  });
  return { cleaned, trimmed };
}

function sanitizePassSpecForPicks(
  passSpec: PassSelectionSpec,
  nextPicks: SelectedPick[]
): PassSelectionSpec {
  if (!passSpec || passSpec.mode === "combo") {
    return passSpec?.bankerMatchIds
      ? { mode: passSpec.mode, comboCode: passSpec.comboCode }
      : passSpec;
  }
  const distinctIds = Array.from(new Set(nextPicks.map((p) => p.matchId)));
  if (distinctIds.length < 3) {
    if (!passSpec.bankerMatchIds && passSpec.mode === "auto") return passSpec;
    const validSizes = Array.isArray(passSpec.passSizes)
      ? passSpec.passSizes.filter((s) => s >= 1 && s <= distinctIds.length)
      : [];
    return validSizes.length > 0 && passSpec.mode === "free"
      ? { mode: "free", passSizes: validSizes }
      : { mode: "auto" };
  }
  const curBankers = Array.isArray(passSpec.bankerMatchIds)
    ? passSpec.bankerMatchIds.filter((id) => distinctIds.includes(id))
    : [];
  const validSizes = Array.isArray(passSpec.passSizes)
    ? passSpec.passSizes.filter((s) => s >= 1 && s <= distinctIds.length)
    : [];
  if (passSpec.mode === "free" && validSizes.length > 0) {
    const minPass = Math.min(...validSizes);
    const maxBankers =
      minPass >= 2 ? Math.min(distinctIds.length - 1, minPass - 1) : 0;
    const trimmedBankers = curBankers.slice(0, maxBankers);
    return trimmedBankers.length > 0
      ? { mode: "free", passSizes: validSizes, bankerMatchIds: trimmedBankers }
      : { mode: "free", passSizes: validSizes };
  }
  return curBankers.length > 0
    ? {
        mode: "free",
        passSizes: [Math.max(2, distinctIds.length - 1)],
        bankerMatchIds: curBankers.slice(
          0,
          Math.max(1, distinctIds.length - 2)
        ),
      }
    : { mode: "auto" };
}

export function computeClientPortfolioQuoteMeta(
  s: Pick<
    BetSlipState,
    | "matches"
    | "picks"
    | "budget"
    | "targetIds"
    | "anchorToRadarPicks"
    | "stance"
    | "subjectiveDeltaPct"
    | "allowSaveCash"
    | "unlockFullAgg"
    | "passSpec"
  >
): Omit<
  LivePortfolioQuoteState,
  "quoteVersion" | "computedInputSig" | "isStale" | "canApplyLiveQuote"
> {
  const cleanBudget = normalizeBudgetYuan(s.budget);
  const cleanStance: UserStance =
    s.stance === "home-lean" || s.stance === "upset-watch"
      ? s.stance
      : "objective";
  const cleanSubj = Math.max(
    SUBJECTIVE_DELTA_MIN,
    Math.min(
      SUBJECTIVE_DELTA_MAX,
      Math.round(Number(s.subjectiveDeltaPct) || 0)
    )
  );
  const passSpecSig = (() => {
    const ps = s.passSpec;
    if (!ps || ps.mode === "auto") return "auto";
    if (ps.mode === "combo" && ps.comboCode) return `c:${ps.comboCode}`;
    if (
      ps.mode === "free" &&
      Array.isArray(ps.passSizes) &&
      ps.passSizes.length > 0
    ) {
      const sz = [...ps.passSizes]
        .map(Number)
        .sort((a, b) => a - b)
        .join(",");
      const bk = Array.isArray(ps.bankerMatchIds)
        ? [...ps.bankerMatchIds].map(String).sort().join(",")
        : "";
      return `f:${sz}:b=${bk}`;
    }
    return "auto";
  })();

  const foundTargets = s.matches.filter((m) => s.targetIds.includes(m.id));
  const resolvedTargets =
    foundTargets.length > 0 ? foundTargets : s.matches.slice(0, 2);
  const poolMatchIdsSig = resolvedTargets.map((m) => m.id).join(",");
  const rawPicks = s.picks ?? [];
  const picksSig =
    rawPicks.length === 0
      ? ""
      : Array.from(
          new Set(
            rawPicks
              .filter((p) => Boolean(p?.matchId && p?.poolCode && p?.optionKey))
              .map(
                (p) =>
                  `${p.matchId}:${String(p.poolCode).toUpperCase()}:${p.optionKey}`
              )
          )
        )
          .sort()
          .join("|");

  const poolOrder: PoolCode[] = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let tokCount = 0;
  const mixInt = (val: number) => {
    const v = val | 0;
    h1 = Math.imul((h1 ^ v) >>> 0, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ (v + (tokCount & 255))) >>> 0, 0x85ebca6b) >>> 0;
    tokCount += 1;
  };
  const mixStr = (str: string) => {
    for (let c = 0; c < str.length; c++) {
      mixInt(str.charCodeAt(c));
    }
    mixInt(124);
  };
  for (let i = 0; i < resolvedTargets.length; i++) {
    const m = resolvedTargets[i];
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
      for (let k = 0; k < pl.options.length; k++) {
        const o = pl.options[k];
        mixStr(String(o.key ?? ""));
        mixInt(Math.round((Number(o.odds) || 0) * 100));
      }
      mixInt(59);
    }
  }
  const oddsSnapshotSig = `${h1.toString(36)}_${h2.toString(36)}_${tokCount}`;
  const inputSig = `v1|b=${cleanBudget}|st=${cleanStance}|sd=${cleanSubj}|sc=${s.allowSaveCash ? 1 : 0}|ua=${s.unlockFullAgg ? 1 : 0}|ar=${s.anchorToRadarPicks ? 1 : 0}|ps=${passSpecSig}|t=${poolMatchIdsSig}|pk=${picksSig}|od=${oddsSnapshotSig}`;
  return {
    inputSig,
    picksSig,
    budget: cleanBudget,
    poolMatchIdsSig,
    anchorToRadarPicks: Boolean(s.anchorToRadarPicks),
    stance: cleanStance,
    subjectiveDeltaPct: cleanSubj,
    allowSaveCash: Boolean(s.allowSaveCash),
    unlockFullAgg: Boolean(s.unlockFullAgg),
    passSpecSig,
    oddsSnapshotSig,
  };
}

export function formatAuditedLegSourceLabel(
  legSource: AuditedLegSource,
  hasManualAnchors: boolean
): string {
  if (legSource === "manual-anchor") return "🎯 用户亲选";
  if (legSource === "same-match-shield") return "🛡️ 同场护盾扩选";
  if (legSource === "cross-pool-substitute") return "🔄 跨玩法替代";
  return hasManualAnchors ? "🌉 过桥配菜场" : "🤖 自由池推荐";
}

function classifyPlanLegSourceAgainstManual(
  lg: Pick<PlanLeg, "matchId" | "poolCode" | "optionKey" | "legSource">,
  manualByMatch: Map<string, SelectedPick[]>,
  hasManualAnchors: boolean,
  freePrimaryByMatch: Map<string, string>
): AuditedLegSource {
  if (hasManualAnchors) {
    const mPicks = manualByMatch.get(lg.matchId);
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
  if (
    lg.legSource === "same-match-shield" ||
    lg.legSource === "cross-pool-substitute" ||
    lg.legSource === "bridge-mate"
  ) {
    return lg.legSource;
  }
  const curSig = `${lg.poolCode}:${lg.optionKey}`;
  const firstSig = freePrimaryByMatch.get(lg.matchId);
  if (!firstSig) {
    freePrimaryByMatch.set(lg.matchId, curSig);
    return "bridge-mate";
  }
  if (firstSig === curSig) return "bridge-mate";
  return lg.poolCode === firstSig.split(":")[0]
    ? "same-match-shield"
    : "cross-pool-substitute";
}

function buildAppliedTicketSnapshotForPlan(
  plan: ArchetypePlan,
  manualDraftPicks: SelectedPick[],
  matches: MatchItem[],
  appliedBudgetYuan: number,
  quoteInputSig: string
): {
  taggedPlan: ArchetypePlan;
  snapshot: AppliedTicketSnapshot;
} {
  const manualByMatch = new Map<string, SelectedPick[]>();
  for (const pk of manualDraftPicks) {
    const arr = manualByMatch.get(pk.matchId) ?? [];
    arr.push(pk);
    manualByMatch.set(pk.matchId, arr);
  }
  const hasManualAnchors = manualDraftPicks.length > 0;
  const freePrimaryByMatch = new Map<string, string>();
  const matchMap = new Map(matches.map((m) => [m.id, m]));
  const boardIndex = new Map(matches.map((m, idx) => [m.id, idx]));

  const taggedLines: PlanTicketLine[] = plan.lines.map((ln) => ({
    ...ln,
    legs: ln.legs.map((lg) => {
      const legSource = classifyPlanLegSourceAgainstManual(
        lg,
        manualByMatch,
        hasManualAnchors,
        freePrimaryByMatch
      );
      return { ...lg, legSource };
    }),
  }));

  const distinctLegsMap = new Map<string, AuditedSlipLeg>();
  for (const ln of taggedLines) {
    for (const lg of ln.legs) {
      const key = `${lg.matchId}:${lg.poolCode}:${lg.optionKey}`;
      if (distinctLegsMap.has(key)) continue;
      const fm = matchMap.get(lg.matchId);
      const pool = fm?.pools?.[lg.poolCode];
      const legSource = lg.legSource ?? "bridge-mate";
      distinctLegsMap.set(key, {
        matchId: lg.matchId,
        matchNumStr: fm?.matchNumStr || lg.matchNumStr,
        home: fm?.home || lg.home,
        away: fm?.away || lg.away,
        poolCode: lg.poolCode,
        poolName: pool?.name || lg.poolName,
        singleAllowed: Boolean(pool?.single),
        canSingle: pool?.canSingle ?? Boolean(pool?.single),
        canAllUp: pool?.canAllUp ?? pool?.selling !== false,
        optionKey: lg.optionKey,
        optionLabel: lg.optionLabel,
        odds: lg.odds,
        fairProb: lg.fairProb,
        legSource,
        legSourceLabel: formatAuditedLegSourceLabel(
          legSource,
          hasManualAnchors
        ),
      });
    }
  }

  const orderedLegs = Array.from(distinctLegsMap.values()).sort((a, b) => {
    const ia = boardIndex.get(a.matchId) ?? Number.MAX_SAFE_INTEGER;
    const ib = boardIndex.get(b.matchId) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });

  const manualAnchorLegCount = orderedLegs.filter(
    (l) => l.legSource === "manual-anchor"
  ).length;
  const systemExpandedLegCount = orderedLegs.length - manualAnchorLegCount;

  const taggedPlan: ArchetypePlan = {
    ...plan,
    quoteInputSig,
    quoteBudgetYuan: appliedBudgetYuan,
    lines: taggedLines,
  };

  return {
    taggedPlan,
    snapshot: {
      key: plan.key,
      shortTab: plan.shortTab,
      appliedBudgetYuan,
      quoteInputSig,
      radarPickedMatchCount: manualByMatch.size,
      radarPickedLegCount: manualDraftPicks.length,
      manualAnchorLegCount,
      systemExpandedLegCount,
      legs: orderedLegs,
      lines: taggedLines,
    },
  };
}

function buildActiveAuditedSlip(
  s: Omit<BetSlipState, "activeAuditedSlip">
): ActiveAuditedSlip {
  const manualDraftPicks = s.picks ?? [];
  const manualByMatch = new Map<string, SelectedPick[]>();
  for (const pk of manualDraftPicks) {
    const arr = manualByMatch.get(pk.matchId) ?? [];
    arr.push(pk);
    manualByMatch.set(pk.matchId, arr);
  }
  const radarPickedMatchCount = manualByMatch.size;
  const radarPickedLegCount = manualDraftPicks.length;
  const hasManualAnchors = radarPickedLegCount > 0;
  const revertActionLabel = hasManualAnchors ? "回到我的手选" : "撤销方案";

  let budgetMismatchMeta: BudgetMismatchMeta | null = null;
  if (s.planSpec?.kind === "archetype") {
    const rawLocked =
      s.appliedTicketSnapshot?.appliedBudgetYuan ??
      s.planSpec.appliedBudgetYuan ??
      s.planSpec.planBudgetYuan;
    if (typeof rawLocked === "number" && rawLocked > 0) {
      const appliedBudgetYuan = normalizeBudgetYuan(rawLocked);
      const currentBudgetYuan = normalizeBudgetYuan(s.budget);
      if (appliedBudgetYuan !== currentBudgetYuan) {
        budgetMismatchMeta = {
          appliedBudgetYuan,
          currentBudgetYuan,
          bannerText: `已套 ¥${appliedBudgetYuan} / 当前新预算 ¥${currentBudgetYuan}（点此重配）`,
        };
      }
    }
  }

  const effectiveReport = s.workspace.effectiveReport;
  const manualReport = s.workspace.manualReport;
  const isAutoSynthetic = Boolean(
    !s.planSpec &&
    effectiveReport.syntheticAutoMounted &&
    s.workspace.appliedPlan
  );
  const sourceKind: ActiveAuditedSlip["sourceKind"] =
    s.planSpec?.kind === "archetype"
      ? "archetype"
      : s.planSpec?.kind === "bonus"
        ? "bonus-opt"
        : isAutoSynthetic
          ? "auto-synthetic"
          : manualDraftPicks.length > 0
            ? "manual"
            : "empty";
  const isAppliedPlan =
    sourceKind === "archetype" || sourceKind === "bonus-opt";
  const isArchetypePlan = sourceKind === "archetype";

  const matchMap = new Map(s.matches.map((m) => [m.id, m]));
  const boardIndex = new Map(s.matches.map((m, idx) => [m.id, idx]));
  const bankerSet = new Set(
    effectiveReport.bankerMatchIds ??
      manualReport.bankerMatchIds ??
      s.passSpec.bankerMatchIds ??
      []
  );

  let sourceLines: PlanTicketLine[] = [];
  const distinctLegsMap = new Map<string, AuditedSlipLeg>();
  const freePrimaryByMatch = new Map<string, string>();

  if (
    sourceKind === "archetype" ||
    sourceKind === "bonus-opt" ||
    sourceKind === "auto-synthetic"
  ) {
    const resolvedPlan =
      s.workspace.appliedPlan ??
      (s.planSpec?.kind === "archetype"
        ? (s.planSpec.snapshotPlan ?? null)
        : null);
    sourceLines =
      resolvedPlan?.lines ??
      (sourceKind === "archetype"
        ? (s.appliedTicketSnapshot?.lines ?? [])
        : []);

    for (const ln of sourceLines) {
      for (const lg of ln.legs ?? []) {
        const key = `${lg.matchId}:${lg.poolCode}:${lg.optionKey}`;
        if (distinctLegsMap.has(key)) continue;
        const fm = matchMap.get(lg.matchId);
        const pool = fm?.pools?.[lg.poolCode];
        const liveOpt = pool?.options?.find((o) => o.key === lg.optionKey);
        const legSource: AuditedLegSource =
          sourceKind === "bonus-opt"
            ? "manual-anchor"
            : classifyPlanLegSourceAgainstManual(
                lg,
                manualByMatch,
                hasManualAnchors,
                freePrimaryByMatch
              );
        distinctLegsMap.set(key, {
          matchId: lg.matchId,
          matchNumStr: fm?.matchNumStr || lg.matchNumStr,
          home: fm?.home || lg.home,
          away: fm?.away || lg.away,
          poolCode: lg.poolCode,
          poolName: pool?.name || lg.poolName,
          singleAllowed: Boolean(pool?.single),
          canSingle: pool?.canSingle ?? Boolean(pool?.single),
          canAllUp: pool?.canAllUp ?? pool?.selling !== false,
          optionKey: lg.optionKey,
          optionLabel: liveOpt?.label || lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
          legSource,
          legSourceLabel: formatAuditedLegSourceLabel(
            legSource,
            hasManualAnchors
          ),
        });
      }
    }
  } else if (sourceKind === "manual") {
    for (const pk of manualDraftPicks) {
      const key = `${pk.matchId}:${pk.poolCode}:${pk.optionKey}`;
      if (distinctLegsMap.has(key)) continue;
      const fm = matchMap.get(pk.matchId);
      const pool = fm?.pools?.[pk.poolCode];
      distinctLegsMap.set(key, {
        ...pk,
        matchNumStr: fm?.matchNumStr || pk.matchNumStr,
        home: fm?.home || pk.home,
        away: fm?.away || pk.away,
        poolName: pool?.name || pk.poolName,
        legSource: "manual-anchor",
        legSourceLabel: formatAuditedLegSourceLabel("manual-anchor", true),
      });
    }
  }

  const orderedLegs = Array.from(distinctLegsMap.values()).sort((a, b) => {
    const ia = boardIndex.get(a.matchId) ?? Number.MAX_SAFE_INTEGER;
    const ib = boardIndex.get(b.matchId) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib;
  });

  const matchEntriesMap = new Map<string, AuditedSlipMatchEntry>();
  for (const lg of orderedLegs) {
    const fm = matchMap.get(lg.matchId);
    let entry = matchEntriesMap.get(lg.matchId);
    if (!entry) {
      entry = {
        matchId: lg.matchId,
        matchNumStr: fm?.matchNumStr || lg.matchNumStr,
        home: fm?.home || lg.home,
        away: fm?.away || lg.away,
        kickoff: fm?.kickoff || "",
        isManualPickedMatch: manualByMatch.has(lg.matchId),
        isBanker: bankerSet.has(lg.matchId),
        pools: [],
        legs: [],
      };
      matchEntriesMap.set(lg.matchId, entry);
    }
    entry.legs.push(lg);
    let poolGroup = entry.pools.find((pg) => pg.poolCode === lg.poolCode);
    if (!poolGroup) {
      poolGroup = {
        poolCode: lg.poolCode,
        poolName: fm?.pools?.[lg.poolCode]?.name || lg.poolName,
        ...(lg.poolCode === "HHAD" && fm?.pools?.HHAD?.goalLine
          ? { goalLine: fm.pools.HHAD.goalLine }
          : {}),
        legs: [],
      };
      entry.pools.push(poolGroup);
    }
    poolGroup.legs.push(lg);
  }

  const matchEntries = Array.from(matchEntriesMap.values());
  const matchIds = matchEntries.map((m) => m.matchId);
  const manualAnchorLegCount = orderedLegs.filter(
    (l) => l.legSource === "manual-anchor"
  ).length;
  const systemExpandedLegCount = orderedLegs.length - manualAnchorLegCount;
  const drawerTitle =
    isAppliedPlan || isAutoSynthetic
      ? `📋 方案涉及 ${matchEntries.length} 场 · 雷达亲选 ${radarPickedMatchCount} 场`
      : `📋 已选对阵与实时水位 (${matchEntries.length} 场)`;

  return {
    sourceKind,
    isAppliedPlan,
    isArchetypePlan,
    isAutoSynthetic,
    matchIds,
    matchCount: matchEntries.length,
    radarPickedMatchCount,
    radarPickedLegCount,
    manualAnchorLegCount,
    systemExpandedLegCount,
    totalLegCount: orderedLegs.length,
    drawerTitle,
    revertActionLabel,
    matches: matchEntries,
    legs: orderedLegs,
    lines: sourceLines,
    budgetMismatchMeta,
  };
}

function buildInitialState(): BetSlipState {
  const base = {
    matches: [] as MatchItem[],
    picks: [] as SelectedPick[],
    manualDraftPicks: [] as SelectedPick[],
    mode: "mix" as MatchMode,
    multiple: 5,
    passSpec: { mode: "auto" } as PassSelectionSpec,
    planSpec: null as AppliedPlanSpec,
    appliedTicketSnapshot: null as AppliedTicketSnapshot | null,
    syntheticSingleMode: "full-3way" as SyntheticSingleMode,
    lastPoolSwitchUndo: null as PoolSwitchUndoSnapshot | null,
    subjectiveDeltaPct: 0,
    simVoidFirstMatch: false,
    targetIds: [] as string[],
    anchorToRadarPicks: false,
    manualPoolOverride: false,
    syncedRadarSig: "",
    budget: 100,
    stance: "objective" as UserStance,
    unlockFullAgg: false,
    allowSaveCash: false,
    workspace: EMPTY_WORKSPACE_RESPONSE,
    objectivePortfolioPlans: [] as ArchetypePlan[],
  };
  const qMeta = computeClientPortfolioQuoteMeta(base);
  const withQuote = {
    ...base,
    livePortfolioQuote: {
      quoteVersion: 0,
      ...qMeta,
      computedInputSig: qMeta.inputSig,
      isStale: false,
      canApplyLiveQuote: true,
    },
  };
  return {
    ...withQuote,
    activeAuditedSlip: buildActiveAuditedSlip(withQuote),
  };
}

function buildPresetPicks(
  matches: MatchItem[],
  kind: PresetScenarioKind
): {
  multiple: number;
  picks: SelectedPick[];
} {
  if (kind === "underwater") {
    const m1 = matches[0];
    const m2 = matches.find((x) => x.kickoff.startsWith("03:")) ?? matches[1];
    const out: SelectedPick[] = [];
    if (m1) {
      for (const k of ["hh", "dh", "dd", "ah"]) {
        const o = m1.pools.HAFU.options.find((x) => x.key === k);
        if (o) {
          out.push({
            matchId: m1.id,
            matchNumStr: m1.matchNumStr,
            home: m1.home,
            away: m1.away,
            poolCode: "HAFU",
            poolName: m1.pools.HAFU.name,
            singleAllowed: true,
            optionKey: o.key,
            optionLabel: o.label,
            odds: o.odds,
            fairProb: o.fairProb,
          });
        }
      }
    }
    if (m2 && out.length === 0) {
      const o = m2.pools.HAD.options[0];
      if (o) {
        out.push({
          matchId: m2.id,
          matchNumStr: m2.matchNumStr,
          home: m2.home,
          away: m2.away,
          poolCode: "HAD",
          poolName: m2.pools.HAD.name,
          singleAllowed: m2.pools.HAD.single,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        });
      }
    }
    return { multiple: 5, picks: out };
  }

  if (kind === "synthetic") {
    const m = matches.find((x) => !x.pools.HAD.single) ?? matches[0];
    if (!m) return { multiple: 5, picks: [] };
    const o = m.pools.HAD.options[0];
    if (!o) return { multiple: 5, picks: [] };
    return {
      multiple: 5,
      picks: [
        {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "HAD",
          poolName: m.pools.HAD.name,
          singleAllowed: m.pools.HAD.single,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        },
      ],
    };
  }

  if (kind === "parlay4") {
    const picks = matches
      .slice(0, 4)
      .map((m) => {
        const o = m.pools.HAD.options[0];
        if (!o) return null;
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "HAD" as PoolCode,
          poolName: m.pools.HAD.name,
          singleAllowed: m.pools.HAD.single,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        };
      })
      .filter((x): x is SelectedPick => x !== null);
    return { multiple: 3, picks };
  }

  const mEarly = matches[0];
  const mLate =
    matches.find(
      (x) =>
        x.id !== mEarly?.id &&
        (x.kickoff.startsWith("03:") || x.kickoff.startsWith("07:")) &&
        (x.pools.HAD.single || x.pools.HHAD.single)
    ) ??
    matches.find(
      (x) => x.id !== mEarly?.id && (x.pools.HAD.single || x.pools.HHAD.single)
    ) ??
    matches.find(
      (x) => x.kickoff.startsWith("03:") || x.kickoff.startsWith("07:")
    ) ??
    matches[matches.length - 1];
  if (!mEarly || !mLate) return { multiple: 15, picks: [] };
  const picks = [mEarly, mLate]
    .map((m, idx): SelectedPick | null => {
      const pCode: PoolCode =
        idx === 1
          ? m.pools.HAD.single && m.pools.HAD.options.length > 0
            ? "HAD"
            : m.pools.HHAD.single && m.pools.HHAD.options.length > 0
              ? "HHAD"
              : m.pools.HAD.options.length > 0
                ? "HAD"
                : "HHAD"
          : m.pools.HAD.options.length > 0
            ? "HAD"
            : "HHAD";
      const opts = m.pools[pCode].options;
      const o =
        idx === 1 && opts.length > 1
          ? opts.reduce((best, cur) => (cur.odds < best.odds ? cur : best))
          : opts[0];
      if (!o) return null;
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: pCode,
        poolName: m.pools[pCode].name,
        singleAllowed: m.pools[pCode].single,
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      };
    })
    .filter((x): x is SelectedPick => x !== null);
  return { multiple: 15, picks };
}

/**
 * 选单工作区深模块（仅负责前端交互状态机与体彩选号互斥门禁；所有算奖、去水概率、优化与精算配单（3+1 帕累托体系）公式 100% 委托注入的工作区计算适配器执行）
 */
export function createBetSlipController(options: BetSlipControllerOptions) {
  const debounceMs = options.debounceMs ?? 18;
  const autoSyncRadar = options.autoSyncRadar ?? false;
  const listeners = new Set<() => void>();
  let bootstrapped = false;
  let computeSeq = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolvers: Array<() => void> = [];
  let inFlightPromise: Promise<void> | null = null;

  let state: BetSlipState = buildInitialState();
  let quoteVersion = 0;
  let lastKnownInputSig = state.livePortfolioQuote.inputSig;
  let computedInputSig = state.livePortfolioQuote.inputSig;
  let lastReconciledRef: BetSlipState | null = state;
  let pendingRequote: {
    slotKey: ArchetypeKey;
    expectedInputSig: string;
    allowSlotFallback: boolean;
  } | null = null;

  function reconcileState(): BetSlipState {
    if (lastReconciledRef === state) return state;
    const qMeta = computeClientPortfolioQuoteMeta(state);
    if (qMeta.inputSig !== lastKnownInputSig) {
      quoteVersion += 1;
      lastKnownInputSig = qMeta.inputSig;
    }
    const isStale = bootstrapped ? qMeta.inputSig !== computedInputSig : false;
    const appliedTicketSnapshot =
      state.planSpec?.kind === "archetype"
        ? (state.planSpec.appliedTicketSnapshot ?? null)
        : null;
    const nextCore = {
      ...state,
      manualDraftPicks: state.picks,
      appliedTicketSnapshot,
      livePortfolioQuote: {
        quoteVersion,
        ...qMeta,
        computedInputSig,
        isStale,
        canApplyLiveQuote: !isStale,
      },
    };
    state = {
      ...nextCore,
      activeAuditedSlip: buildActiveAuditedSlip(nextCore),
    };
    lastReconciledRef = state;
    return state;
  }

  function emit() {
    reconcileState();
    for (const fn of listeners) fn();
  }

  function resolveObjectivePortfolioPlans(
    stance: UserStance,
    ws: QuantWorkspaceResponse,
    prevObjective: ArchetypePlan[]
  ): ArchetypePlan[] {
    if (stance === "objective") {
      return ws.portfolioPlans ?? [];
    }
    if (Array.isArray(ws.objectivePortfolioPlans)) {
      return ws.objectivePortfolioPlans;
    }
    return prevObjective;
  }

  function syncAutoRadarFields(
    nextPicks: SelectedPick[],
    currentMatches: MatchItem[],
    prevState: BetSlipState
  ): Pick<BetSlipState, "targetIds" | "anchorToRadarPicks" | "syncedRadarSig"> {
    if (!autoSyncRadar || prevState.manualPoolOverride) {
      return {
        targetIds: prevState.targetIds,
        anchorToRadarPicks: prevState.anchorToRadarPicks,
        syncedRadarSig: prevState.syncedRadarSig,
      };
    }
    if (nextPicks.length > 0) {
      const pickedIds = Array.from(
        new Set(nextPicks.map((p) => p.matchId))
      ).slice(0, 8);
      return {
        targetIds: pickedIds,
        anchorToRadarPicks: true,
        syncedRadarSig: buildRadarSignature(nextPicks),
      };
    }
    return {
      targetIds: currentMatches.slice(0, 2).map((m) => m.id),
      anchorToRadarPicks: false,
      syncedRadarSig: "",
    };
  }

  function settlePendingResolvers() {
    if (pendingResolvers.length === 0) return;
    const list = pendingResolvers;
    pendingResolvers = [];
    for (const resolve of list) resolve();
  }

  function cancelPendingTimer() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    settlePendingResolvers();
  }

  function buildWorkspaceParams(s: BetSlipState = state): QuantWorkspaceParams {
    const clientAlerts: Record<string, NonNullable<MatchItem["aiAlert"]>> = {};
    for (const m of s.matches) {
      if (m.aiAlert) clientAlerts[m.id] = m.aiAlert;
    }
    const qMeta = computeClientPortfolioQuoteMeta(s);
    return {
      picks: s.picks,
      multiple: s.multiple,
      passSpec: s.passSpec,
      syntheticSingleMode: s.syntheticSingleMode,
      subjectiveDeltaPct: s.subjectiveDeltaPct,
      simVoidFirstMatch: s.simVoidFirstMatch,
      planSpec: s.planSpec,
      targetIds: s.targetIds,
      anchorToRadarPicks: s.anchorToRadarPicks,
      budget: s.budget,
      stance: s.stance,
      unlockFullAgg: s.unlockFullAgg,
      allowSaveCash: s.allowSaveCash,
      quoteInputSig: qMeta.inputSig,
      ...(s.planSpec?.kind === "archetype" &&
      !s.planSpec.allowBudgetMismatchReadOnly &&
      s.planSpec.expectedQuoteInputSig
        ? { expectedQuoteInputSig: s.planSpec.expectedQuoteInputSig }
        : {}),
      clientAlerts,
    };
  }

  function maybeConsumePendingRequote(
    ws: QuantWorkspaceResponse,
    resolvedSig: string
  ): boolean {
    if (!pendingRequote) return false;
    const curSig = computeClientPortfolioQuoteMeta(state).inputSig;
    if (
      pendingRequote.expectedInputSig !== resolvedSig ||
      curSig !== resolvedSig
    ) {
      pendingRequote = null;
      return false;
    }
    const req = pendingRequote;
    pendingRequote = null;
    const plans = ws.portfolioPlans ?? [];
    const cand =
      plans.find(
        (p) =>
          p.key === req.slotKey &&
          p.available !== false &&
          Array.isArray(p.lines) &&
          p.lines.length > 0
      ) ??
      (req.allowSlotFallback
        ? plans.find(
            (p) =>
              p.available !== false &&
              Array.isArray(p.lines) &&
              p.lines.length > 0
          )
        : null);
    if (!cand) return false;
    const cleanBudget = normalizeBudgetYuan(state.budget);
    if (cand.totalCost > cleanBudget + 1e-6) return false;
    const { taggedPlan, snapshot } = buildAppliedTicketSnapshotForPlan(
      cand,
      state.picks,
      state.matches,
      cleanBudget,
      resolvedSig
    );
    state = {
      ...state,
      planSpec: {
        kind: "archetype",
        key: cand.key,
        snapshotPlan: taggedPlan,
        appliedBudgetYuan: cleanBudget,
        planBudgetYuan: cleanBudget,
        quoteInputSig: resolvedSig,
        expectedQuoteInputSig: resolvedSig,
        appliedSubjectiveDeltaPct:
          computeClientPortfolioQuoteMeta(state).subjectiveDeltaPct,
        allowBudgetMismatchReadOnly: false,
        appliedTicketSnapshot: snapshot,
        scaleMultiple: 1,
        consolidateTickets: true,
      },
      appliedTicketSnapshot: snapshot,
      simVoidFirstMatch: false,
    };
    return true;
  }

  function executeComputeNow(): Promise<void> {
    const seq = ++computeSeq;
    const paramsSnapshot = buildWorkspaceParams(state);
    const requestInputSig =
      paramsSnapshot.quoteInputSig ??
      computeClientPortfolioQuoteMeta(state).inputSig;
    const matchesSnapshot = state.matches;

    try {
      const maybeMain = options.computeWorkspace(
        paramsSnapshot,
        matchesSnapshot
      );

      const isAsync =
        maybeMain &&
        typeof (maybeMain as Promise<QuantWorkspaceResponse>).then ===
          "function";

      if (isAsync) {
        const p = Promise.resolve(maybeMain)
          .then(async (ws) => {
            if (seq === computeSeq) {
              const resolvedSig = ws.quoteInputSig || requestInputSig;
              computedInputSig = resolvedSig;
              state = {
                ...state,
                workspace: ws,
                objectivePortfolioPlans: resolveObjectivePortfolioPlans(
                  paramsSnapshot.stance,
                  ws,
                  state.objectivePortfolioPlans
                ),
              };
              const reapplied = maybeConsumePendingRequote(ws, resolvedSig);
              options.onComputeSuccess?.();
              emit();
              if (reapplied) {
                await executeComputeNow();
              }
            }
          })
          .catch((err) => {
            if (err instanceof TypeError) {
              options.onOfflineNetworkError?.();
            }
          })
          .finally(() => {
            if (inFlightPromise === p) inFlightPromise = null;
          });
        inFlightPromise = p;
        return p;
      }

      if (seq === computeSeq) {
        const ws = maybeMain as QuantWorkspaceResponse;
        const resolvedSig = ws.quoteInputSig || requestInputSig;
        computedInputSig = resolvedSig;
        state = {
          ...state,
          workspace: ws,
          objectivePortfolioPlans: resolveObjectivePortfolioPlans(
            paramsSnapshot.stance,
            ws,
            state.objectivePortfolioPlans
          ),
        };
        const reapplied = maybeConsumePendingRequote(ws, resolvedSig);
        options.onComputeSuccess?.();
        emit();
        if (reapplied) {
          return executeComputeNow();
        }
      }
      return Promise.resolve();
    } catch (err) {
      if (err instanceof TypeError) {
        options.onOfflineNetworkError?.();
      }
      return Promise.resolve();
    }
  }

  function scheduleRefresh(): Promise<void> {
    if (!bootstrapped) return Promise.resolve();
    cancelPendingTimer();
    if (debounceMs <= 0) {
      return executeComputeNow();
    }
    return new Promise((resolve) => {
      pendingResolvers.push(resolve);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        void executeComputeNow().finally(() => {
          settlePendingResolvers();
        });
      }, debounceMs);
    });
  }

  function resolvePoolCanSingle(pool?: MatchItem["pools"][PoolCode]): boolean {
    if (
      !pool ||
      pool.selling === false ||
      !Array.isArray(pool.options) ||
      pool.options.length === 0
    ) {
      return false;
    }
    const baseSym = Symbol.for("yj.basePoolSingle");
    const baseS = (pool as unknown as Record<symbol, unknown>)[baseSym];
    if (typeof baseS === "boolean") {
      if (typeof pool.canSingle === "boolean" && pool.canSingle !== baseS) {
        return pool.canSingle;
      }
      if (typeof pool.single === "boolean" && pool.single !== baseS) {
        return pool.single;
      }
      return baseS;
    }
    if (
      typeof pool.canSingle === "boolean" &&
      typeof pool.single === "boolean"
    ) {
      return pool.canSingle && pool.single;
    }
    if (typeof pool.canSingle === "boolean") return pool.canSingle;
    return Boolean(pool.single);
  }

  function resolvePoolCanAllUp(pool?: MatchItem["pools"][PoolCode]): boolean {
    if (
      !pool ||
      pool.selling === false ||
      !Array.isArray(pool.options) ||
      pool.options.length === 0
    ) {
      return false;
    }
    const baseSym = Symbol.for("yj.basePoolAllUp");
    const baseA = (pool as unknown as Record<symbol, unknown>)[baseSym];
    if (typeof baseA === "boolean") {
      if (typeof pool.canAllUp === "boolean" && pool.canAllUp !== baseA) {
        return pool.canAllUp;
      }
      return baseA;
    }
    if (typeof pool.canAllUp === "boolean") return pool.canAllUp;
    return true;
  }

  function isAuthoritativePickSingle(pk: SelectedPick): boolean {
    const fm = state.matches.find((x) => x.id === pk.matchId);
    const pool = fm?.pools[pk.poolCode];
    return pool
      ? resolvePoolCanSingle(pool)
      : Boolean(pk.canSingle ?? pk.singleAllowed);
  }

  function isPicked(
    matchId: string,
    poolCode: PoolCode,
    optKey: string
  ): boolean {
    return state.picks.some(
      (p) =>
        p.matchId === matchId &&
        p.poolCode === poolCode &&
        p.optionKey === optKey
    );
  }

  function applyAuthenticatedBundle(bundle: {
    matches: MatchItem[];
    initialPicks: SelectedPick[];
    workspace: QuantWorkspaceResponse;
  }) {
    cancelPendingTimer();
    bootstrapped = true;
    computeSeq += 1;
    const baseState = buildInitialState();
    const radarSync = syncAutoRadarFields(bundle.initialPicks, bundle.matches, {
      ...baseState,
      targetIds: bundle.matches.slice(0, 2).map((m) => m.id),
    });
    const nextState: BetSlipState = {
      ...baseState,
      matches: bundle.matches,
      picks: bundle.initialPicks,
      manualDraftPicks: bundle.initialPicks,
      ...radarSync,
      workspace: bundle.workspace,
      objectivePortfolioPlans: bundle.workspace.portfolioPlans ?? [],
    };
    const initSig = computeClientPortfolioQuoteMeta(nextState).inputSig;
    lastKnownInputSig = initSig;
    computedInputSig = initSig;
    state = nextState;
    emit();
  }

  function getStanceDeltaSummary(slotKey: PortfolioKey): StanceDeltaSummary {
    const activePlan =
      state.workspace.portfolioPlans.find((p) => p.key === slotKey) ??
      state.workspace.portfolioPlans[0];
    const basePlan =
      state.objectivePortfolioPlans.find((p) => p.key === slotKey) ??
      state.objectivePortfolioPlans[0];

    const ruleNote =
      state.stance === "home-lean"
        ? "偏主队倾向：在不违背已选方向前提下温和上调主场胜率权重，纯盘面自由选池下优先向主场优势倾斜配单。"
        : state.stance === "upset-watch"
          ? "防爆冷倾向：温和下调大热正路权重并抬升受让/冷平防线权重，辅助识别大热暗雷与防冷分倍。"
          : "纯客观基准：100% 采用五池联合校准去水真率评估，不叠加主观冷热倾向。";

    const instantRecalcNote =
      "点选即实时重算下方四档方案，无需额外组合其他按钮。";
    const anchorLockNote = state.anchorToRadarPicks
      ? "当前球队方向已由赛事雷达选单锚定锁定；切换倾向不会强改已选球队，主要微调真赚钱率评估与分倍权重。"
      : null;

    const hasBaseline = Boolean(
      activePlan &&
      basePlan &&
      activePlan.available !== false &&
      basePlan.available !== false
    );

    const deltaProfitProbPct =
      hasBaseline && state.stance !== "objective"
        ? Number(
            (
              ((activePlan!.profitProb ?? 0) - (basePlan!.profitProb ?? 0)) *
              100
            ).toFixed(1)
          )
        : 0;
    const deltaEvPct =
      hasBaseline && state.stance !== "objective"
        ? Number(
            (
              ((activePlan!.expectedValueRate ?? 0) -
                (basePlan!.expectedValueRate ?? 0)) *
              100
            ).toFixed(1)
          )
        : 0;
    const ticketsChanged =
      hasBaseline && state.stance !== "objective"
        ? buildPlanTicketSignature(activePlan) !==
          buildPlanTicketSignature(basePlan)
        : false;

    return {
      stance: state.stance,
      hasBaseline,
      ruleNote,
      instantRecalcNote,
      anchorLockNote,
      deltaProfitProbPct,
      deltaEvPct,
      ticketsChanged,
    };
  }

  function resolveBankerPassWindow(
    distinctIds: string[]
  ): { nextPassSizes: number[]; minPass: number; maxBankers: number } | null {
    const manualRep = state.workspace.manualReport;
    if (
      distinctIds.length < 3 ||
      distinctIds.length > 8 ||
      manualRep.hasSameMatchCrossPoolConflict
    ) {
      return null;
    }
    const poolCap = Math.min(8, manualRep.poolCap || 8, distinctIds.length);
    let nextPassSizes: number[] = [];
    if (
      state.passSpec.mode === "free" &&
      Array.isArray(state.passSpec.passSizes)
    ) {
      const multiOnly = state.passSpec.passSizes.filter(
        (s) => s >= 2 && s <= poolCap
      );
      if (
        multiOnly.length > 0 &&
        !(multiOnly.length === 1 && multiOnly[0] === distinctIds.length)
      ) {
        nextPassSizes = multiOnly;
      } else if (
        state.passSpec.passSizes.length > 0 &&
        state.passSpec.passSizes.every((s) => s === 1)
      ) {
        return { nextPassSizes: [], minPass: 1, maxBankers: 0 };
      }
    }
    if (nextPassSizes.length === 0) {
      const defaultLowPass = Math.max(
        2,
        Math.min(poolCap, distinctIds.length - 1)
      );
      nextPassSizes = [defaultLowPass];
    }
    const minPass = Math.min(...nextPassSizes);
    const maxBankers =
      minPass >= 2 ? Math.min(distinctIds.length - 1, minPass - 1) : 0;
    return { nextPassSizes, minPass, maxBankers };
  }

  function getPlayabilityGates(
    archKey: PortfolioKey = "max-ev-utility"
  ): PlayabilityGates {
    const manualReport = state.workspace.manualReport;
    const effectiveReport = state.workspace.effectiveReport;
    const manualBonusLineCount = Math.max(
      manualReport.tickets?.length ?? 0,
      manualReport.betCount
    );
    const isBonusOver512 = manualBonusLineCount > 512;
    const isBonusOptDisabled = !manualReport.canCheckout || isBonusOver512;
    const appliedPlan = state.planSpec ? state.workspace.appliedPlan : null;
    const effectiveAppliedPlan =
      state.planSpec || effectiveReport.syntheticAutoMounted
        ? state.workspace.appliedPlan
        : null;
    const isSingleNonSingleContext =
      !state.planSpec &&
      manualReport.matchCount === 1 &&
      !manualReport.canCheckout &&
      !manualReport.hasSameMatchCrossPoolConflict &&
      Boolean(
        manualReport.syntheticRescuePicks &&
        manualReport.syntheticRescuePicks.length > 0
      );
    const isSyntheticPlayable =
      isSingleNonSingleContext &&
      (manualReport.syntheticEffectiveOdds ?? 1.05) > 1.0 &&
      !manualReport.warnings.some((w) => w.id === "synthetic-unplayable");
    const hasSyntheticInherentBlindSpot =
      (manualReport.syntheticBlindSpotProb ?? 0) > 1e-9;
    const canTrimSynthetic2Way =
      isSyntheticPlayable &&
      (manualReport.syntheticRescuePicks?.length ?? 0) >= 3;
    const partialCoveragePreview =
      effectiveReport.partialCoveragePreview ??
      manualReport.partialCoveragePreview ??
      null;

    const distinctIds = Array.from(new Set(state.picks.map((p) => p.matchId)));
    const curBankers = (
      state.passSpec.bankerMatchIds ??
      manualReport.bankerMatchIds ??
      []
    ).filter((id) => distinctIds.includes(id));
    const activeBankerSet = new Set(
      effectiveReport.bankerMatchIds ??
        manualReport.bankerMatchIds ??
        state.passSpec.bankerMatchIds ??
        []
    );
    const canToggleBanker =
      !state.planSpec &&
      manualReport.matchCount >= 3 &&
      manualReport.matchCount <= 8 &&
      !manualReport.hasSameMatchCrossPoolConflict;
    const bankerWindow = resolveBankerPassWindow(distinctIds);

    const canToggleBankerMatch = (matchId: string): boolean => {
      if (state.planSpec || !distinctIds.includes(matchId) || !bankerWindow) {
        return false;
      }
      if (curBankers.includes(matchId)) return true;
      return (
        bankerWindow.maxBankers > 0 &&
        curBankers.length < bankerWindow.maxBankers
      );
    };

    const breakevenTargetCost =
      appliedPlan?.breakevenUpgradeCost ??
      effectiveReport.breakevenUpgradeCost ??
      manualReport.breakevenUpgradeCost ??
      null;
    const budgetMismatchMeta =
      reconcileState().activeAuditedSlip.budgetMismatchMeta;

    const portfolioPlans = state.workspace.portfolioPlans?.length
      ? state.workspace.portfolioPlans
      : state.workspace.fivePlans;
    const currentArch =
      portfolioPlans.find((p) => p.key === archKey) ??
      portfolioPlans[0] ??
      null;
    const fallbackValidArch =
      currentArch && currentArch.available !== false
        ? currentArch
        : (portfolioPlans.find((p) => p.available !== false) ?? null);
    const fallbackStrictGain = fallbackValidArch
      ? (fallbackValidArch.objectiveStrictNetGainProb ??
        fallbackValidArch.strictNetGainProb ??
        fallbackValidArch.profitProb ??
        0)
      : 0;
    const manualStrictGain =
      manualReport.objectiveStrictNetGainProb ??
      manualReport.strictNetGainProb ??
      manualReport.realProfitProb ??
      0;

    const showBridgeFinder =
      effectiveReport.matchCount === 1 &&
      !effectiveReport.canCheckout &&
      (state.workspace.insights.bridgeCandidates?.length ?? 0) > 0;
    const hasSuboptimalManual =
      !appliedPlan &&
      fallbackValidArch !== null &&
      manualReport.matchCount > 0 &&
      (manualReport.underwaterCount > 0 ||
        manualReport.avgVigLossPer100 > 19) &&
      (fallbackStrictGain > manualStrictGain + 1e-6 ||
        (manualReport.underwaterCount > 0 &&
          (fallbackValidArch.underwaterCount ?? 0) === 0 &&
          fallbackStrictGain >= manualStrictGain - 1e-6));

    return {
      isSingleNonSingleContext,
      isSyntheticPlayable,
      hasSyntheticInherentBlindSpot,
      canTrimSynthetic2Way,
      partialCoveragePreview,
      manualBonusLineCount,
      isBonusOver512,
      isBonusOptDisabled,
      activeBankerSet,
      canToggleBanker,
      canToggleBankerMatch,
      breakevenTargetCost,
      budgetMismatchMeta,
      appliedPlan,
      effectiveAppliedPlan,
      portfolioPlans,
      currentArch,
      fallbackValidArch,
      showBridgeFinder,
      hasSuboptimalManual,
    };
  }

  return {
    getState: () => reconcileState(),
    getActiveAuditedSlip: () => reconcileState().activeAuditedSlip,
    getAuditedMatchIds: () => reconcileState().activeAuditedSlip.matchIds,
    getStanceDeltaSummary,
    getPlayabilityGates,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async flush(): Promise<void> {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        await executeComputeNow();
        settlePendingResolvers();
        return;
      }
      if (inFlightPromise) {
        await inFlightPromise;
      }
    },
    buildWorkspaceParams: () => buildWorkspaceParams(state),
    isPicked,
    getPickedMatchIds(): string[] {
      return Array.from(new Set(state.picks.map((p) => p.matchId)));
    },
    isRadarSyncCurrent(): boolean {
      const sig = buildRadarSignature(state.picks);
      return (
        state.anchorToRadarPicks &&
        sig.length > 0 &&
        state.syncedRadarSig === sig
      );
    },

    applyAuthenticatedBundle,
    initializeMatches(
      matches: MatchItem[],
      initialPicks: SelectedPick[],
      workspace: QuantWorkspaceResponse
    ) {
      applyAuthenticatedBundle({ matches, initialPicks, workspace });
    },

    setBootstrapped(val: boolean) {
      bootstrapped = val;
      if (!val) {
        cancelPendingTimer();
        computeSeq += 1;
      }
    },

    applyMatchesSync(res: {
      matches: MatchItem[];
      workspace: QuantWorkspaceResponse;
    }) {
      cancelPendingTimer();
      bootstrapped = true;
      computeSeq += 1;

      const isLiveXiaoGaoAlert = (a?: MatchItem["aiAlert"]) => {
        if (!a?.source) return false;
        return (
          a.source === "primary" ||
          a.source === "fallback" ||
          a.source.includes("扫地僧小高") ||
          a.source.includes("实时诊盘") ||
          a.source.includes("协同会诊")
        );
      };
      const mergedMatches = res.matches.map((nm) => {
        if (isLiveXiaoGaoAlert(nm.aiAlert)) return nm;
        const prev = state.matches.find(
          (em) =>
            em.id === nm.id ||
            (Boolean(em.matchNumStr) && em.matchNumStr === nm.matchNumStr)
        );
        if (isLiveXiaoGaoAlert(prev?.aiAlert)) {
          return { ...nm, aiAlert: prev!.aiAlert };
        }
        if (nm.aiAlert) return nm;
        return prev?.aiAlert ? { ...nm, aiAlert: prev.aiAlert } : nm;
      });

      const validTargets = mergedMatches
        .filter((m) => state.targetIds.includes(m.id))
        .map((m) => m.id);
      const nextTargets =
        validTargets.length >= 1
          ? validTargets
          : mergedMatches.slice(0, 2).map((m) => m.id);

      let picksRemapped = false;
      const syncedPicks = state.picks
        .map((pk) => {
          const um = mergedMatches.find(
            (m) =>
              m.id === pk.matchId ||
              (Boolean(m.matchNumStr) && m.matchNumStr === pk.matchNumStr)
          );
          const uo = um?.pools[pk.poolCode]?.options.find(
            (o) => o.key === pk.optionKey
          );
          if (!um || !uo) {
            picksRemapped = true;
            return null;
          }
          const nextSingle = um.pools[pk.poolCode].single;
          if (
            um.id !== pk.matchId ||
            uo.odds !== pk.odds ||
            nextSingle !== pk.singleAllowed
          ) {
            picksRemapped = true;
          }
          return {
            ...pk,
            matchId: um.id,
            odds: uo.odds,
            fairProb: uo.fairProb,
            singleAllowed: nextSingle,
          };
        })
        .filter((x): x is SelectedPick => x !== null);

      const targetsChanged =
        nextTargets.length !== state.targetIds.length ||
        nextTargets.some((id, idx) => id !== state.targetIds[idx]);

      const nextSyncedState: BetSlipState = {
        ...state,
        matches: mergedMatches,
        targetIds: nextTargets,
        picks: syncedPicks,
        manualDraftPicks: syncedPicks,
        workspace: res.workspace,
        objectivePortfolioPlans: resolveObjectivePortfolioPlans(
          state.stance,
          res.workspace,
          state.objectivePortfolioPlans
        ),
      };
      if (!picksRemapped && !targetsChanged) {
        computedInputSig =
          res.workspace.quoteInputSig ||
          computeClientPortfolioQuoteMeta(nextSyncedState).inputSig;
        if (
          nextSyncedState.planSpec?.kind === "archetype" &&
          !nextSyncedState.planSpec.allowBudgetMismatchReadOnly
        ) {
          nextSyncedState.planSpec = {
            ...nextSyncedState.planSpec,
            quoteInputSig: computedInputSig,
            expectedQuoteInputSig: computedInputSig,
            ...(nextSyncedState.planSpec.snapshotPlan
              ? {
                  snapshotPlan: {
                    ...nextSyncedState.planSpec.snapshotPlan,
                    quoteInputSig: computedInputSig,
                  },
                }
              : {}),
          };
        }
      }
      state = nextSyncedState;
      emit();

      if (picksRemapped || targetsChanged) {
        void scheduleRefresh();
      }
    },

    async applyMatchAiAlert(
      matchId: string,
      alert: NonNullable<MatchItem["aiAlert"]>
    ) {
      state = {
        ...state,
        matches: state.matches.map((item) =>
          item.id === matchId ||
          (Boolean(item.matchNumStr) && item.matchNumStr === matchId)
            ? { ...item, aiAlert: alert }
            : item
        ),
      };
      emit();
      await scheduleRefresh();
    },

    async applyComboAiReport(rep: {
      level: "high" | "medium" | "low";
      source: string;
      perMatch: Array<{
        matchId: string;
        matchTitle: string;
        tag: string;
        note: string;
        priceInStatus: string;
      }>;
    }) {
      if (!Array.isArray(rep?.perMatch) || rep.perMatch.length === 0) return;
      const byMatchId = new Map(
        rep.perMatch
          .filter((x) => Boolean(x?.matchId))
          .map((x) => [x.matchId, x])
      );
      state = {
        ...state,
        matches: state.matches.map((item) => {
          const pm = byMatchId.get(item.id);
          if (!pm) return item;
          return {
            ...item,
            aiAlert: {
              level: rep.level === "high" ? "high" : "medium",
              tag: pm.tag,
              summary: pm.note,
              priceInStatus: pm.priceInStatus,
              source: rep.source,
            },
          };
        }),
      };
      emit();
      await scheduleRefresh();
    },

    togglePick(
      m: MatchItem,
      poolCode: PoolCode,
      optKey: string
    ): TogglePickVerdict {
      const currentlyOn = isPicked(m.id, poolCode, optKey);
      if (currentlyOn) {
        const prevPick = state.picks.find(
          (p) =>
            p.matchId === m.id &&
            p.poolCode === poolCode &&
            p.optionKey === optKey
        );
        const nextPicks = state.picks.filter(
          (p) =>
            !(
              p.matchId === m.id &&
              p.poolCode === poolCode &&
              p.optionKey === optKey
            )
        );
        state = {
          ...state,
          planSpec: null,
          syntheticSingleMode:
            state.syntheticSingleMode === "partial-cover"
              ? "full-3way"
              : state.syntheticSingleMode,
          lastPoolSwitchUndo: null,
          passSpec: sanitizePassSpecForPicks(state.passSpec, nextPicks),
          picks: nextPicks,
          ...syncAutoRadarFields(nextPicks, state.matches, state),
        };
        emit();
        void scheduleRefresh();
        return {
          ok: true,
          action: "removed",
          optionLabel: prevPick?.optionLabel,
          odds: prevPick?.odds,
        };
      }

      const pool = m.pools[poolCode];
      const opt = pool?.options.find((o) => o.key === optKey);
      const poolSingleOk = resolvePoolCanSingle(pool);
      const poolAllUpOk = resolvePoolCanAllUp(pool);
      if (
        !pool ||
        pool.selling === false ||
        (!poolSingleOk && !poolAllUpOk) ||
        pool.options.length === 0 ||
        !opt ||
        opt.odds <= 0
      ) {
        return { ok: false, blockedReason: "该玩法或选项当前暂未开售" };
      }

      const byMatchPools = new Map<string, Set<PoolCode>>();
      const otherByMatchPools = new Map<string, Set<PoolCode>>();
      for (const p of state.picks) {
        const s = byMatchPools.get(p.matchId) ?? new Set<PoolCode>();
        s.add(p.poolCode);
        byMatchPools.set(p.matchId, s);
        if (p.matchId !== m.id) {
          const os = otherByMatchPools.get(p.matchId) ?? new Set<PoolCode>();
          os.add(p.poolCode);
          otherByMatchPools.set(p.matchId, os);
        }
      }
      const existingHasCrossPool = Array.from(byMatchPools.values()).some(
        (s) => s.size > 1
      );
      const otherHasCrossPool = Array.from(otherByMatchPools.values()).some(
        (s) => s.size > 1
      );
      const existingDistinctCount = byMatchPools.size;
      const otherDistinctCount = otherByMatchPools.size;
      const allSingleWithCand =
        state.picks.every(isAuthoritativePickSingle) && poolSingleOk;

      const sameMatchOther = state.picks.filter(
        (p) => p.matchId === m.id && p.poolCode !== poolCode
      );
      if (sameMatchOther.length > 0) {
        if (
          (otherHasCrossPool || otherDistinctCount + 1 > 8) &&
          !poolSingleOk
        ) {
          return {
            ok: false,
            blockedReason:
              "当前选单已锁定【单关】模式，无法混入未开单关的选项！",
          };
        }
        const isSpfDualSinglePair =
          (state.mode === "spf" ||
            state.mode === "single" ||
            (state.passSpec.mode === "free" &&
              state.passSpec.passSizes?.length === 1 &&
              state.passSpec.passSizes[0] === 1)) &&
          allSingleWithCand &&
          (poolCode === "HAD" || poolCode === "HHAD") &&
          sameMatchOther.every(
            (p) => p.poolCode === "HAD" || p.poolCode === "HHAD"
          );

        if (!isSpfDualSinglePair) {
          const replacedPoolName = Array.from(
            new Set(sameMatchOther.map((p) => p.poolName))
          ).join("+");
          const undoSnapshot: PoolSwitchUndoSnapshot = {
            picks: [...state.picks],
            passSpec: state.passSpec,
            planSpec: state.planSpec,
            matchId: m.id,
            matchNumStr: m.matchNumStr,
            home: m.home,
            away: m.away,
            replacedPoolName,
            replacedCount: sameMatchOther.length,
            nextPoolName: pool.name,
            nextOptionLabel: opt.label,
          };
          const newPick: SelectedPick = {
            matchId: m.id,
            matchNumStr: m.matchNumStr,
            home: m.home,
            away: m.away,
            poolCode,
            poolName: pool.name,
            singleAllowed: poolSingleOk,
            canSingle: poolSingleOk,
            canAllUp: poolAllUpOk,
            optionKey: opt.key,
            optionLabel: opt.label,
            odds: opt.odds,
            fairProb: opt.fairProb,
          };
          const nextPicks = [
            ...state.picks.filter(
              (p) => !(p.matchId === m.id && p.poolCode !== poolCode)
            ),
            newPick,
          ];
          const wasOnlyMatchCrossPool =
            existingHasCrossPool &&
            !otherHasCrossPool &&
            otherDistinctCount + 1 <= 8 &&
            state.mode !== "single" &&
            state.passSpec.mode === "free" &&
            state.passSpec.passSizes?.length === 1 &&
            state.passSpec.passSizes[0] === 1;
          const switchedPassSpec = wasOnlyMatchCrossPool
            ? { mode: "auto" as const }
            : state.passSpec;
          state = {
            ...state,
            planSpec: null,
            syntheticSingleMode:
              state.syntheticSingleMode === "partial-cover"
                ? "full-3way"
                : state.syntheticSingleMode,
            lastPoolSwitchUndo: undoSnapshot,
            passSpec: sanitizePassSpecForPicks(switchedPassSpec, nextPicks),
            picks: nextPicks,
            ...syncAutoRadarFields(nextPicks, state.matches, state),
          };
          emit();
          void scheduleRefresh();
          return {
            ok: true,
            action: "switched-pool",
            optionLabel: opt.label,
            odds: opt.odds,
            replacedPoolName,
            replacedCount: sameMatchOther.length,
            canUndoPoolSwitch: true,
          };
        }

        const nextPassSpec: PassSelectionSpec = {
          mode: "free",
          passSizes: [1],
        };
        const nextPicks: SelectedPick[] = [
          ...state.picks,
          {
            matchId: m.id,
            matchNumStr: m.matchNumStr,
            home: m.home,
            away: m.away,
            poolCode,
            poolName: pool.name,
            singleAllowed: poolSingleOk,
            canSingle: poolSingleOk,
            canAllUp: poolAllUpOk,
            optionKey: opt.key,
            optionLabel: opt.label,
            odds: opt.odds,
            fairProb: opt.fairProb,
          },
        ];
        state = {
          ...state,
          planSpec: null,
          syntheticSingleMode:
            state.syntheticSingleMode === "partial-cover"
              ? "full-3way"
              : state.syntheticSingleMode,
          lastPoolSwitchUndo: null,
          passSpec: sanitizePassSpecForPicks(nextPassSpec, nextPicks),
          picks: nextPicks,
          ...syncAutoRadarFields(nextPicks, state.matches, state),
        };
        emit();
        void scheduleRefresh();
        return {
          ok: true,
          action: "added",
          optionLabel: opt.label,
          odds: opt.odds,
          autoLockedSingleReason: "dual-single",
        };
      }

      if (
        (existingHasCrossPool || existingDistinctCount > 8) &&
        !poolSingleOk
      ) {
        return {
          ok: false,
          blockedReason: "当前选单已锁定【单关】模式，无法混入未开单关的选项！",
        };
      }

      let nextPassSpec = state.passSpec;
      let autoLockedSingleReason: TogglePickVerdict["autoLockedSingleReason"];

      if (!byMatchPools.has(m.id) && existingDistinctCount >= 15) {
        return { ok: false, blockedReason: "单次选单最多不能超过 15 场赛事" };
      } else if (!byMatchPools.has(m.id) && existingDistinctCount >= 8) {
        if (
          (state.mode !== "spf" && state.mode !== "single") ||
          !allSingleWithCand
        ) {
          return { ok: false, blockedReason: "过关数量不能超过 8 场赛事" };
        }
        nextPassSpec = { mode: "free", passSizes: [1] };
        autoLockedSingleReason = "over-8-matches";
      }

      const nextPicks: SelectedPick[] = [
        ...state.picks,
        {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode,
          poolName: pool.name,
          singleAllowed: poolSingleOk,
          canSingle: poolSingleOk,
          canAllUp: poolAllUpOk,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        },
      ];
      state = {
        ...state,
        planSpec: null,
        syntheticSingleMode:
          state.syntheticSingleMode === "partial-cover"
            ? "full-3way"
            : state.syntheticSingleMode,
        lastPoolSwitchUndo: null,
        passSpec: sanitizePassSpecForPicks(nextPassSpec, nextPicks),
        picks: nextPicks,
        ...syncAutoRadarFields(nextPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
      return {
        ok: true,
        action: "added",
        optionLabel: opt.label,
        odds: opt.odds,
        autoLockedSingleReason,
      };
    },

    undoLastPoolSwitch(): boolean {
      const snap = state.lastPoolSwitchUndo;
      if (!snap) return false;
      state = {
        ...state,
        picks: snap.picks,
        passSpec: sanitizePassSpecForPicks(snap.passSpec, snap.picks),
        planSpec: snap.planSpec,
        lastPoolSwitchUndo: null,
        ...syncAutoRadarFields(snap.picks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    setMode(nextMode: MatchMode): { trimmed: boolean } {
      let nextPicks = state.picks;
      let nextPassSpec = state.passSpec;
      let trimmed = false;

      if (nextMode !== "spf" && nextMode !== "single") {
        const res = trimToSinglePoolPerMatch(state.picks);
        nextPicks = res.cleaned;
        trimmed = res.trimmed;
        if (trimmed) {
          nextPassSpec = { mode: "auto" };
        }
      }

      state = {
        ...state,
        mode: nextMode,
        picks: nextPicks,
        passSpec: nextPassSpec,
        ...(trimmed
          ? {
              lastPoolSwitchUndo: null,
              ...syncAutoRadarFields(nextPicks, state.matches, state),
            }
          : {}),
      };
      emit();
      if (trimmed) void scheduleRefresh();
      return { trimmed };
    },

    clearPicks() {
      const resetOverrideState = { ...state, manualPoolOverride: false };
      state = {
        ...resetOverrideState,
        picks: [],
        planSpec: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        passSpec: { mode: "auto" },
        ...(autoSyncRadar
          ? syncAutoRadarFields([], state.matches, resetOverrideState)
          : {}),
      };
      emit();
      void scheduleRefresh();
    },

    setSyntheticSingleMode(nextMode: SyntheticSingleMode) {
      const normalized: SyntheticSingleMode =
        nextMode === "partial-cover" ||
        nextMode === "trim-2way" ||
        nextMode === "off"
          ? nextMode
          : "full-3way";
      if (state.syntheticSingleMode === normalized) return;
      state = {
        ...state,
        syntheticSingleMode: normalized,
      };
      emit();
      void scheduleRefresh();
    },

    removeMatchFromSlip(matchId: string) {
      const nextPicks = state.picks.filter((p) => p.matchId !== matchId);
      state = {
        ...state,
        planSpec: null,
        syntheticSingleMode:
          state.syntheticSingleMode === "partial-cover"
            ? "full-3way"
            : state.syntheticSingleMode,
        lastPoolSwitchUndo: null,
        passSpec: sanitizePassSpecForPicks(state.passSpec, nextPicks),
        picks: nextPicks,
        ...syncAutoRadarFields(nextPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
    },

    replacePicks(nextPicks: SelectedPick[]) {
      state = {
        ...state,
        planSpec: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        passSpec: { mode: "auto" },
        picks: nextPicks,
        ...syncAutoRadarFields(nextPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
    },

    resetPassAuto() {
      state = {
        ...state,
        planSpec: null,
        passSpec: { mode: "auto" },
      };
      emit();
      void scheduleRefresh();
    },

    setDirectMultiple(nextRaw: number): number {
      const clamped = Math.max(1, Math.min(999, Math.round(nextRaw) || 1));
      state = { ...state, planSpec: null, multiple: clamped };
      emit();
      void scheduleRefresh();
      return clamped;
    },

    stepMultiple(delta: number): number {
      const next = Math.max(1, Math.min(999, state.multiple + delta));
      state = { ...state, planSpec: null, multiple: next };
      emit();
      void scheduleRefresh();
      return next;
    },

    toggleFreePassSize(size: number): { ok: boolean; reason?: string } {
      const manualReport = state.workspace.manualReport;
      const opt = manualReport.availableFreePasses.find((f) => f.size === size);
      if (!opt || !opt.enabled) {
        return {
          ok: false,
          reason: opt?.disabledReason || "当前选单不满足该过关条件",
        };
      }
      const currentActive = manualReport.activeComboCode
        ? []
        : manualReport.availableFreePasses
            .filter((f) => f.active)
            .map((f) => f.size);
      const exists = currentActive.includes(size);
      if (exists && currentActive.length <= 1) {
        return { ok: false, reason: "至少需保留一种过关方式" };
      }
      const nextSizes = exists
        ? currentActive.filter((s) => s !== size)
        : [...currentActive, size].sort((a, b) => a - b);
      state = {
        ...state,
        planSpec: null,
        passSpec: sanitizePassSpecForPicks(
          {
            mode: "free",
            passSizes: nextSizes,
            bankerMatchIds: state.passSpec.bankerMatchIds,
          },
          state.picks
        ),
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    selectComboPass(code: string): { ok: boolean; reason?: string } {
      const manualReport = state.workspace.manualReport;
      const opt = manualReport.availableComboPasses.find(
        (c) => c.code === code
      );
      if (!opt || !opt.enabled) {
        return {
          ok: false,
          reason: opt?.disabledReason || "当前选单不可选该多串组合",
        };
      }
      const nextSpec: PassSelectionSpec =
        manualReport.activeComboCode === code
          ? { mode: "auto" }
          : { mode: "combo", comboCode: code };
      state = {
        ...state,
        planSpec: null,
        passSpec: nextSpec,
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    applyBonusOptimization(optMode: BonusOptMode): {
      ok: boolean;
      modeTitle?: string;
      blockedReason?: string;
    } {
      const manualRep = state.workspace.manualReport;
      if (manualRep.combos.length === 0 && manualRep.betCount === 0) {
        return { ok: false };
      }
      const lineCount = Math.max(
        manualRep.tickets?.length ?? 0,
        manualRep.betCount
      );
      if (lineCount > 512) {
        return {
          ok: false,
          blockedReason:
            "当前复式超出 512 注线下逐票分倍上限，请精简包号或改用【3+1 精算配单】",
        };
      }
      if (!manualRep.canCheckout) {
        return {
          ok: false,
          blockedReason:
            manualRep.ruleBlockReason || "当前选单暂不满足合法出票条件",
        };
      }
      state = {
        ...state,
        planSpec: {
          kind: "bonus",
          optMode,
          scaleMultiple: 1,
          consolidateTickets: true,
        },
      };
      emit();
      void scheduleRefresh();
      const modeTitle =
        optMode === "equal"
          ? "平均优化"
          : optMode === "hot-first"
            ? "博热保本"
            : "博冷高弹";
      return { ok: true, modeTitle };
    },

    applyArchetype(plan: ArchetypePlan): boolean {
      const cur = reconcileState();
      if (
        !plan ||
        plan.available === false ||
        !Array.isArray(plan.lines) ||
        plan.lines.length === 0
      ) {
        return false;
      }
      if (
        cur.livePortfolioQuote.isStale ||
        !cur.livePortfolioQuote.canApplyLiveQuote
      ) {
        return false;
      }
      const cleanBudget = normalizeBudgetYuan(cur.budget);
      if (
        plan.quoteInputSig &&
        plan.quoteInputSig !== cur.livePortfolioQuote.inputSig
      ) {
        return false;
      }
      if (
        typeof plan.quoteBudgetYuan === "number" &&
        normalizeBudgetYuan(plan.quoteBudgetYuan) !== cleanBudget
      ) {
        return false;
      }
      if (plan.totalCost > cleanBudget + 1e-6) {
        return false;
      }

      const activeQuoteSig =
        plan.quoteInputSig || cur.livePortfolioQuote.inputSig;
      const { taggedPlan, snapshot } = buildAppliedTicketSnapshotForPlan(
        plan,
        cur.picks,
        cur.matches,
        cleanBudget,
        activeQuoteSig
      );

      state = {
        ...cur,
        planSpec: {
          kind: "archetype",
          key: plan.key,
          snapshotPlan: taggedPlan,
          appliedBudgetYuan: cleanBudget,
          planBudgetYuan: cleanBudget,
          quoteInputSig: activeQuoteSig,
          expectedQuoteInputSig: activeQuoteSig,
          appliedSubjectiveDeltaPct: cur.livePortfolioQuote.subjectiveDeltaPct,
          allowBudgetMismatchReadOnly: false,
          appliedTicketSnapshot: snapshot,
          scaleMultiple: 1,
          consolidateTickets: true,
        },
        appliedTicketSnapshot: snapshot,
        simVoidFirstMatch: false,
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    restoreEqualMultiple() {
      this.revertToManualDraft();
    },

    revertToManualDraft() {
      pendingRequote = null;
      const nextPicks =
        state.mode !== "spf" && state.mode !== "single"
          ? trimToSinglePoolPerMatch(state.picks).cleaned
          : state.picks;
      const safeSynMode: SyntheticSingleMode =
        state.syntheticSingleMode === "off" ? "off" : "full-3way";
      state = {
        ...state,
        planSpec: null,
        appliedTicketSnapshot: null,
        syntheticSingleMode: safeSynMode,
        passSpec: sanitizePassSpecForPicks(state.passSpec, nextPicks),
        picks: nextPicks,
      };
      emit();
      void scheduleRefresh();
    },

    excludeMatchAndRequote(matchId: string): {
      ok: boolean;
      excludedMatchId?: string;
      nextTargetIds?: string[];
      reason?: string;
    } {
      const cur = reconcileState();
      const prevSlotKey: ArchetypeKey =
        cur.planSpec?.kind === "archetype"
          ? cur.planSpec.key
          : "max-ev-utility";
      const curFound = cur.matches
        .filter((m) => cur.targetIds.includes(m.id))
        .map((m) => m.id);
      const basePoolIds =
        curFound.length > 0
          ? curFound
          : cur.matches.slice(0, 2).map((m) => m.id);
      const unionIds = Array.from(
        new Set([...basePoolIds, ...cur.activeAuditedSlip.matchIds])
      );
      let nextTargets = unionIds.filter((id) => id !== matchId);
      if (nextTargets.length === 0) {
        nextTargets = cur.matches
          .filter((m) => m.id !== matchId)
          .slice(0, 2)
          .map((m) => m.id);
      }
      if (nextTargets.length === 0) {
        return { ok: false, reason: "至少保留 1 场候选赛事用于重配" };
      }
      const hasRemainingManualAnchor =
        cur.anchorToRadarPicks &&
        nextTargets.some((id) => cur.picks.some((p) => p.matchId === id));
      const nextStateDraft: BetSlipState = {
        ...cur,
        planSpec: null,
        appliedTicketSnapshot: null,
        targetIds: nextTargets,
        anchorToRadarPicks: hasRemainingManualAnchor,
        manualPoolOverride: true,
        simVoidFirstMatch: false,
      };
      if (cur.planSpec?.kind === "archetype") {
        const nextInputSig =
          computeClientPortfolioQuoteMeta(nextStateDraft).inputSig;
        pendingRequote = {
          slotKey: prevSlotKey,
          expectedInputSig: nextInputSig,
          allowSlotFallback: true,
        };
      }
      state = nextStateDraft;
      emit();
      void scheduleRefresh();
      return {
        ok: true,
        excludedMatchId: matchId,
        nextTargetIds: nextTargets,
      };
    },

    requoteAppliedPlanAtCurrentBudget(): boolean {
      const cur = reconcileState();
      if (cur.planSpec?.kind !== "archetype") return false;
      const slotKey = cur.planSpec.key;
      if (!cur.livePortfolioQuote.isStale) {
        const fresh = cur.workspace.portfolioPlans.find(
          (p) =>
            p.key === slotKey &&
            p.available !== false &&
            Array.isArray(p.lines) &&
            p.lines.length > 0
        );
        if (fresh && this.applyArchetype(fresh)) {
          return true;
        }
        state = {
          ...cur,
          planSpec: null,
          appliedTicketSnapshot: null,
        };
        emit();
        void scheduleRefresh();
        return false;
      }
      const nextDraft: BetSlipState = {
        ...cur,
        planSpec: null,
        appliedTicketSnapshot: null,
      };
      const expectedSig = computeClientPortfolioQuoteMeta(nextDraft).inputSig;
      pendingRequote = {
        slotKey,
        expectedInputSig: expectedSig,
        allowSlotFallback: false,
      };
      state = nextDraft;
      emit();
      void scheduleRefresh();
      return true;
    },

    scaleAppliedPlanBy(factor: number) {
      if (!state.planSpec) return;
      const nextScale = Math.max(
        1,
        Math.min(50, Math.round((state.planSpec.scaleMultiple ?? 1) * factor))
      );
      state = {
        ...state,
        planSpec: { ...state.planSpec, scaleMultiple: nextScale },
      };
      emit();
      void scheduleRefresh();
    },

    applyEquivalentSwap(arb: EquivalentArbItem): boolean {
      const fm = state.matches.find((x) => x.id === arb.matchId);
      if (!fm) return false;
      const targetPools = new Set(arb.betterPicks.map((bp) => bp.poolCode));
      const cleaned = state.picks.filter(
        (p) =>
          !(
            p.matchId === fm.id &&
            (!targetPools.has(p.poolCode) ||
              arb.worsePicks.some(
                (wp) =>
                  wp.poolCode === p.poolCode && wp.optionKey === p.optionKey
              ))
          )
      );
      const additions: SelectedPick[] = [];
      for (const bp of arb.betterPicks) {
        const already = cleaned.some(
          (p) =>
            p.matchId === fm.id &&
            p.poolCode === bp.poolCode &&
            p.optionKey === bp.optionKey
        );
        if (already) continue;
        const pool = fm.pools[bp.poolCode];
        const opt = pool?.options.find((o) => o.key === bp.optionKey);
        if (!pool || !opt) continue;
        additions.push({
          matchId: fm.id,
          matchNumStr: fm.matchNumStr,
          home: fm.home,
          away: fm.away,
          poolCode: bp.poolCode,
          poolName: pool.name,
          singleAllowed: pool.single,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        });
      }
      const nextPicks = [...cleaned, ...additions];
      const prevMatchSet = new Set(state.picks.map((p) => p.matchId));
      const nextMatchSet = new Set(nextPicks.map((p) => p.matchId));
      if (
        prevMatchSet.size === 1 &&
        nextMatchSet.size === 1 &&
        state.picks.length > 0 &&
        state.picks.every(isAuthoritativePickSingle) &&
        nextPicks.some((p) => !isAuthoritativePickSingle(p))
      ) {
        return false;
      }
      const perMatchCounts = new Map<string, number>();
      for (const pk of nextPicks) {
        perMatchCounts.set(
          pk.matchId,
          (perMatchCounts.get(pk.matchId) ?? 0) + 1
        );
      }
      const countArr = Array.from(perMatchCounts.values());
      const activeSizes =
        state.workspace.manualReport.activePassSizes.length > 0
          ? state.workspace.manualReport.activePassSizes
          : [Math.min(8, countArr.length)];
      const maxPassSize = Math.min(
        countArr.length,
        Math.max(0, ...activeSizes)
      );
      const elemDp = new Float64Array(maxPassSize + 1);
      elemDp[0] = 1;
      for (const c of countArr) {
        for (let s = maxPassSize; s >= 1; s--) {
          elemDp[s] += elemDp[s - 1] * c;
        }
      }
      const estBetCount = activeSizes.reduce(
        (sum, s) => sum + (s <= maxPassSize ? elemDp[s] : 0),
        0
      );
      const prevTotalCost =
        state.workspace.effectiveReport.totalCost > 0
          ? state.workspace.effectiveReport.totalCost
          : state.workspace.manualReport.totalCost > 0
            ? state.workspace.manualReport.totalCost
            : Math.max(1, Math.floor(estBetCount / 2)) * state.multiple * 2;
      const isOneToTwoSplit =
        arb.betterPicks.length >= 2 && arb.worsePicks.length === 1;
      const nextMultiple =
        isOneToTwoSplit && state.multiple >= 2
          ? Math.max(1, Math.ceil(state.multiple / 2))
          : state.multiple;
      const isSingleMatchWithNonSinglePick =
        nextMatchSet.size === 1 &&
        nextPicks.some((p) => !isAuthoritativePickSingle(p));
      const nextPlanSpec: AppliedPlanSpec =
        arb.betterPicks.length >= 2 &&
        estBetCount > 0 &&
        estBetCount <= 512 &&
        !isSingleMatchWithNonSinglePick
          ? {
              kind: "bonus",
              optMode: "equal",
              scaleMultiple: 1,
              consolidateTickets: true,
              ...(isOneToTwoSplit ? { targetBudgetCost: prevTotalCost } : {}),
            }
          : null;
      state = {
        ...state,
        multiple: nextMultiple,
        planSpec: nextPlanSpec,
        lastPoolSwitchUndo: null,
        picks: nextPicks,
        ...syncAutoRadarFields(nextPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    toggleBankerMatch(matchId: string): {
      ok: boolean;
      isBanker?: boolean;
      reason?: string;
    } {
      if (state.planSpec) {
        return {
          ok: false,
          reason:
            "已套用智能配单方案中不支持直接改胆，请先回到手选或排除场次重配",
        };
      }
      const distinctIds = Array.from(
        new Set(state.picks.map((p) => p.matchId))
      );
      if (!distinctIds.includes(matchId)) {
        return { ok: false, reason: "该场次不在当前选单中" };
      }
      if (distinctIds.length < 3) {
        return { ok: false, reason: "至少选择 3 场比赛才可设胆" };
      }
      const manualRep = state.workspace.manualReport;
      if (manualRep.hasSameMatchCrossPoolConflict || distinctIds.length > 8) {
        return { ok: false, reason: "纯单关模式不支持设胆" };
      }
      const curBankers = (
        state.passSpec.bankerMatchIds ??
        manualRep.bankerMatchIds ??
        []
      ).filter((id) => distinctIds.includes(id));

      if (curBankers.includes(matchId)) {
        const nextBankers = curBankers.filter((id) => id !== matchId);
        const curFreeSizes =
          state.passSpec.mode === "free" &&
          Array.isArray(state.passSpec.passSizes)
            ? state.passSpec.passSizes.filter((s) => s >= 2)
            : manualRep.activePassSizes.filter((s) => s >= 2);
        state = {
          ...state,
          planSpec: null,
          passSpec:
            curFreeSizes.length > 0
              ? {
                  mode: "free",
                  passSizes: curFreeSizes,
                  ...(nextBankers.length > 0
                    ? { bankerMatchIds: nextBankers }
                    : {}),
                }
              : { mode: "auto" },
        };
        emit();
        void scheduleRefresh();
        return { ok: true, isBanker: false };
      }

      const bankerWindow = resolveBankerPassWindow(distinctIds);
      if (!bankerWindow || bankerWindow.maxBankers <= 0) {
        return {
          ok: false,
          reason: "当前最小过关数不支持设胆（2串1最多设1胆，3串1最多设2胆）",
        };
      }
      if (curBankers.length >= bankerWindow.maxBankers) {
        return {
          ok: false,
          reason: `当前最低 ${bankerWindow.minPass}串1 最多可设 ${bankerWindow.maxBankers} 场胆码`,
        };
      }

      const nextBankers = [...curBankers, matchId];
      state = {
        ...state,
        planSpec: null,
        passSpec: {
          mode: "free",
          passSizes: bankerWindow.nextPassSizes,
          bankerMatchIds: nextBankers,
        },
      };
      emit();
      void scheduleRefresh();
      return { ok: true, isBanker: true };
    },

    previewBridgeCandidate(
      cand: BridgeMatchCandidate
    ): BridgeMatchPreview | null {
      const m = state.matches.find((x) => x.id === cand?.matchId);
      const pool = m?.pools?.[cand?.poolCode];
      const opt = pool?.options?.find((o) => o.key === cand?.optionKey);
      if (!m || !pool || !opt) return null;

      const alreadyPicked = isPicked(
        cand.matchId,
        cand.poolCode,
        cand.optionKey
      );
      const baseFiltered = state.picks.filter(
        (p) => !(p.matchId === m.id && p.poolCode !== cand.poolCode)
      );
      const newPick: SelectedPick = {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: cand.poolCode,
        poolName: pool.name,
        singleAllowed: resolvePoolCanSingle(pool),
        canSingle: resolvePoolCanSingle(pool),
        canAllUp: resolvePoolCanAllUp(pool),
        optionKey: opt.key,
        optionLabel: opt.label,
        odds: opt.odds,
        fairProb: opt.fairProb,
      };
      const nextPicks = alreadyPicked
        ? state.picks
        : [...baseFiltered, newPick];
      const prevMatchSet = new Set(state.picks.map((p) => p.matchId));
      const matchOrder: string[] = [];
      const countsByMatch = new Map<string, number>();
      let minPoolCap = 8;
      for (const pk of nextPicks) {
        if (!countsByMatch.has(pk.matchId)) matchOrder.push(pk.matchId);
        countsByMatch.set(pk.matchId, (countsByMatch.get(pk.matchId) ?? 0) + 1);
        minPoolCap = Math.min(
          minPoolCap,
          CLIENT_STATUTORY_POOL_MAX_PASS[pk.poolCode] ?? 8
        );
      }
      const previewMatchCount = matchOrder.length;
      const sanitizedPass = sanitizePassSpecForPicks(state.passSpec, nextPicks);
      const passSizes =
        sanitizedPass.mode === "free" &&
        Array.isArray(sanitizedPass.passSizes) &&
        sanitizedPass.passSizes.length > 0 &&
        !(
          sanitizedPass.passSizes.length === 1 &&
          sanitizedPass.passSizes[0] === 1 &&
          previewMatchCount >= 2
        )
          ? sanitizedPass.passSizes.filter((s) => s <= minPoolCap)
          : [Math.min(8, minPoolCap, previewMatchCount)];
      const bankerIndices = (sanitizedPass.bankerMatchIds ?? [])
        .map((id) => matchOrder.indexOf(id))
        .filter((idx) => idx >= 0);
      const previewBetCount = Math.max(
        1,
        computeElementaryBetCount(
          matchOrder.map((id) => countsByMatch.get(id) ?? 1),
          passSizes,
          bankerIndices
        )
      );
      const mult = Math.max(1, Math.round(state.multiple) || 1);
      const previewTotalCost = previewBetCount * mult * 2;
      const addedMatchCount = prevMatchSet.has(m.id) ? 0 : 1;
      const addedLegCount = alreadyPicked ? 0 : 1;
      const passDesc =
        passSizes.length === 1 && passSizes[0] === 1
          ? "单关"
          : passSizes.map((s) => `${s}串1`).join("+");
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        matchTitle: `${m.matchNumStr} ${m.home} vs ${m.away}`,
        poolCode: cand.poolCode,
        poolName: pool.name,
        optionKey: opt.key,
        optionLabel: opt.label,
        odds: opt.odds,
        addedMatchCount,
        addedLegCount,
        previewMatchCount,
        previewBetCount,
        multiple: mult,
        previewTotalCost,
        summaryText: `搭上 ${m.matchNumStr} ${m.home}[${opt.label}@${opt.odds.toFixed(2)}] → ${passDesc} · ${previewBetCount}注 × ${mult}倍 = 新总额 ¥${previewTotalCost}`,
      };
    },

    acceptBridgeMatch(cand: BridgeMatchCandidate): TogglePickVerdict {
      return this.applyBridgeCandidate(cand);
    },

    applyBridgeCandidate(cand: BridgeMatchCandidate): TogglePickVerdict {
      const m = state.matches.find((x) => x.id === cand.matchId);
      if (!m) {
        return { ok: false, blockedReason: "未找到该配菜赛事" };
      }
      if (isPicked(cand.matchId, cand.poolCode, cand.optionKey)) {
        return {
          ok: true,
          action: "added",
          optionLabel: cand.optionLabel,
          odds: cand.odds,
        };
      }
      if (
        state.syntheticSingleMode === "off" ||
        state.syntheticSingleMode === "partial-cover"
      ) {
        state = { ...state, syntheticSingleMode: "full-3way" };
      }
      return this.togglePick(m, cand.poolCode, cand.optionKey);
    },

    previewConvertAppliedPlanToManual(): ConvertPlanToManualPreview {
      const cur = reconcileState();
      const audited = cur.activeAuditedSlip;
      const currentAppliedCost = cur.workspace.effectiveReport.totalCost;
      const mult = Math.max(1, Math.round(cur.multiple) || 1);

      if (!cur.planSpec || audited.legs.length === 0) {
        return {
          canConvert: false,
          blockedReason: "当前没有可转换的已套用智能方案",
          currentAppliedCost,
          previewMultiple: mult,
          previewPassLabel: "",
          previewBetCount: 0,
          previewTotalCost: 0,
          addedLegs: [],
          trimmedCrossPoolLegs: [],
          previewPicks: [],
          summaryText: "当前没有可转换的已套用智能方案",
        };
      }

      // Prefer parlay-line pool per match when a match has multiple pools across lines
      const parlayPoolByMatch = new Map<string, PoolCode>();
      for (const ln of audited.lines) {
        if ((ln.legs?.length ?? 0) >= 2) {
          for (const lg of ln.legs) {
            if (!parlayPoolByMatch.has(lg.matchId)) {
              parlayPoolByMatch.set(lg.matchId, lg.poolCode);
            }
          }
        }
      }

      const chosenPoolByMatch = new Map<string, PoolCode>();
      const previewPicks: SelectedPick[] = [];
      const trimmedCrossPoolLegs: SelectedPick[] = [];
      for (const lg of audited.legs) {
        const preferred =
          parlayPoolByMatch.get(lg.matchId) ??
          chosenPoolByMatch.get(lg.matchId) ??
          lg.poolCode;
        chosenPoolByMatch.set(lg.matchId, preferred);
        const plainPick: SelectedPick = {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          singleAllowed: lg.singleAllowed,
          canSingle: lg.canSingle,
          canAllUp: lg.canAllUp,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
        };
        if (lg.poolCode === preferred) {
          previewPicks.push(plainPick);
        } else {
          trimmedCrossPoolLegs.push(plainPick);
        }
      }

      const matchOrder: string[] = [];
      const countsByMatch = new Map<string, number>();
      let minPoolCap = 8;
      for (const pk of previewPicks) {
        if (!countsByMatch.has(pk.matchId)) matchOrder.push(pk.matchId);
        countsByMatch.set(pk.matchId, (countsByMatch.get(pk.matchId) ?? 0) + 1);
        minPoolCap = Math.min(
          minPoolCap,
          CLIENT_STATUTORY_POOL_MAX_PASS[pk.poolCode] ?? 8
        );
      }
      const mCount = matchOrder.length;
      const allSingleOk =
        previewPicks.length > 0 &&
        previewPicks.every(isAuthoritativePickSingle);

      let passSizes: number[];
      if (mCount === 1) {
        if (!allSingleOk) {
          return {
            canConvert: false,
            blockedReason:
              "单场非单关方案无法直接转为等倍手动复式，请搭 1 场凑 2串1",
            currentAppliedCost,
            previewMultiple: mult,
            previewPassLabel: "未开单关",
            previewBetCount: 0,
            previewTotalCost: 0,
            addedLegs: [],
            trimmedCrossPoolLegs,
            previewPicks,
            summaryText: "单场非单关方案无法直接转为等倍手动复式",
          };
        }
        passSizes = [1];
      } else {
        const lineSizes = Array.from(
          new Set(
            audited.lines
              .map((ln) => ln.legs?.length ?? 0)
              .filter((sz) => sz >= 2 && sz <= Math.min(8, minPoolCap, mCount))
          )
        ).sort((a, b) => a - b);
        passSizes =
          lineSizes.length > 0 ? lineSizes : [Math.min(8, minPoolCap, mCount)];
      }

      const previewBetCount = Math.max(
        1,
        computeElementaryBetCount(
          matchOrder.map((id) => countsByMatch.get(id) ?? 1),
          passSizes
        )
      );
      const previewTotalCost = previewBetCount * mult * 2;
      if (previewTotalCost > 20_000) {
        return {
          canConvert: false,
          blockedReason: `转为手动复式后总额 ¥${previewTotalCost} 超出中国体彩单单 ¥20,000 法定上限`,
          currentAppliedCost,
          previewMultiple: mult,
          previewPassLabel: passSizes
            .map((s) => (s === 1 ? "单关" : `${s}串1`))
            .join("+"),
          previewBetCount,
          previewTotalCost,
          addedLegs: [],
          trimmedCrossPoolLegs,
          previewPicks,
          summaryText: `总额 ¥${previewTotalCost} 超出 ¥20,000 法定上限`,
        };
      }

      const existingSigSet = new Set(
        cur.picks.map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`)
      );
      const addedLegs = previewPicks.filter(
        (p) => !existingSigSet.has(`${p.matchId}:${p.poolCode}:${p.optionKey}`)
      );
      const previewPassLabel = passSizes
        .map((s) => (s === 1 ? "单关" : `${s}串1`))
        .join("+");
      const trimNote =
        trimmedCrossPoolLegs.length > 0
          ? `（已按同场单玩法规则剥离 ${trimmedCrossPoolLegs.length} 项跨池单关垫）`
          : "";

      return {
        canConvert: true,
        currentAppliedCost,
        previewMultiple: mult,
        previewPassLabel,
        previewBetCount,
        previewTotalCost,
        addedLegs,
        trimmedCrossPoolLegs,
        previewPicks,
        summaryText: `转为手动复式（${previewPassLabel} · ${previewBetCount}注 × ${mult}倍）→ 新总金额 ¥${previewTotalCost}（新增写入手选 ${addedLegs.length} 项）${trimNote}`,
      };
    },

    convertAppliedPlanToManual(): {
      ok: boolean;
      reason?: string;
      preview: ConvertPlanToManualPreview;
    } {
      const preview = this.previewConvertAppliedPlanToManual();
      if (!preview.canConvert) {
        return {
          ok: false,
          reason: preview.blockedReason || "当前方案暂无法转为手动复式",
          preview,
        };
      }
      pendingRequote = null;
      const matchCount = new Set(preview.previewPicks.map((p) => p.matchId))
        .size;
      const passSizes = preview.previewPassLabel
        .split("+")
        .map((seg) => (seg === "单关" ? 1 : Number(seg.replace("串1", ""))))
        .filter((n) => Number.isFinite(n) && n >= 1);
      const nextPassSpec: PassSelectionSpec =
        passSizes.length > 0
          ? { mode: "free", passSizes }
          : matchCount === 1
            ? { mode: "free", passSizes: [1] }
            : { mode: "auto" };
      state = {
        ...state,
        mode: "mix",
        planSpec: null,
        appliedTicketSnapshot: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        passSpec: sanitizePassSpecForPicks(nextPassSpec, preview.previewPicks),
        picks: preview.previewPicks,
        ...syncAutoRadarFields(preview.previewPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
      return { ok: true, preview };
    },

    upgradeBonusToBreakeven(): {
      ok: boolean;
      upgradedCost?: number;
      reason?: string;
    } {
      const manualRep = state.workspace.manualReport;
      const breakevenCost =
        state.workspace.appliedPlan?.breakevenUpgradeCost ??
        manualRep.breakevenUpgradeCost;
      if (
        !manualRep.canCheckout ||
        typeof breakevenCost !== "number" ||
        breakevenCost <= 0
      ) {
        return { ok: false, reason: "当前选单暂无可用的保本升级门槛" };
      }
      const optMode: BonusOptMode =
        state.planSpec?.kind === "bonus" ? state.planSpec.optMode : "equal";
      const prevConsolidate =
        state.planSpec?.kind === "bonus"
          ? state.planSpec.consolidateTickets
          : undefined;
      state = {
        ...state,
        planSpec: {
          kind: "bonus",
          optMode,
          scaleMultiple: 1,
          upgradeToBreakeven: true,
          consolidateTickets: prevConsolidate ?? true,
        },
      };
      emit();
      void scheduleRefresh();
      return { ok: true, upgradedCost: breakevenCost };
    },

    toggleTicketConsolidation(force?: boolean): {
      ok: boolean;
      consolidated: boolean;
    } {
      if (!state.planSpec) {
        return { ok: false, consolidated: false };
      }
      const nextVal =
        typeof force === "boolean"
          ? force
          : !Boolean(state.planSpec.consolidateTickets);
      state = {
        ...state,
        planSpec: {
          ...state.planSpec,
          consolidateTickets: nextVal,
        },
      };
      emit();
      void scheduleRefresh();
      return { ok: true, consolidated: nextVal };
    },

    syncRadarPicksToArchetypes(): { ok: boolean; syncedCount: number } {
      const pickedIds = Array.from(new Set(state.picks.map((p) => p.matchId)));
      if (pickedIds.length === 0) return { ok: false, syncedCount: 0 };
      const syncedIds = pickedIds.slice(0, 8);
      state = {
        ...state,
        targetIds: syncedIds,
        anchorToRadarPicks: true,
        manualPoolOverride: false,
        syncedRadarSig: buildRadarSignature(state.picks),
      };
      emit();
      void scheduleRefresh();
      return { ok: true, syncedCount: syncedIds.length };
    },

    toggleTargetMatch(matchId: string): { ok: boolean; reason?: string } {
      const valid = state.matches
        .filter((x) => state.targetIds.includes(x.id))
        .map((x) => x.id);
      let nextTargets: string[];
      if (valid.includes(matchId)) {
        if (valid.length <= 1) {
          return { ok: false, reason: "至少保留 1 场目标比赛" };
        }
        nextTargets = valid.filter((k) => k !== matchId);
      } else {
        nextTargets =
          valid.length >= 8
            ? [...valid.slice(1), matchId]
            : [...valid, matchId];
      }
      state = {
        ...state,
        anchorToRadarPicks: false,
        manualPoolOverride: true,
        targetIds: nextTargets,
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    selectTargetSlice(count: number) {
      state = {
        ...state,
        anchorToRadarPicks: false,
        manualPoolOverride: true,
        targetIds: state.matches
          .slice(0, Math.max(1, Math.min(8, count)))
          .map((x) => x.id),
      };
      emit();
      void scheduleRefresh();
    },

    setAnchorToRadarPicks(val: boolean) {
      const pickedIds = Array.from(
        new Set(state.picks.map((p) => p.matchId))
      ).slice(0, 8);
      state = {
        ...state,
        anchorToRadarPicks: val,
        manualPoolOverride: !val,
        ...(val && pickedIds.length > 0
          ? {
              targetIds: pickedIds,
              syncedRadarSig: buildRadarSignature(state.picks),
            }
          : {}),
      };
      emit();
      void scheduleRefresh();
    },

    setBudget(nextBudget: number): number {
      const normalized = normalizeBudgetYuan(nextBudget);
      const nextPlanSpec: AppliedPlanSpec =
        state.planSpec?.kind === "archetype"
          ? {
              ...state.planSpec,
              allowBudgetMismatchReadOnly:
                normalized !==
                normalizeBudgetYuan(
                  state.planSpec.appliedBudgetYuan ??
                    state.planSpec.planBudgetYuan ??
                    normalized
                ),
            }
          : state.planSpec;
      state = { ...state, budget: normalized, planSpec: nextPlanSpec };
      emit();
      void scheduleRefresh();
      return normalized;
    },

    setStance(nextStance: UserStance) {
      state = { ...state, stance: nextStance };
      emit();
      void scheduleRefresh();
    },

    setUnlockFullAgg(val: boolean) {
      state = { ...state, unlockFullAgg: val };
      emit();
      void scheduleRefresh();
    },

    setAllowSaveCash(val: boolean) {
      const next = Boolean(val);
      if (state.allowSaveCash === next) return;
      state = { ...state, allowSaveCash: next };
      emit();
      void scheduleRefresh();
    },

    applyPortfolioRemediationAction(action: PortfolioRemediationAction): {
      ok: boolean;
      kind?: PortfolioRemediationAction["kind"];
      nextBudget?: number;
    } {
      if (!action || !action.kind) return { ok: false };
      if (action.kind === "lower-pass-preview") {
        state = {
          ...state,
          planSpec: null,
          passSpec: { mode: "auto" },
        };
        emit();
        void scheduleRefresh();
        return { ok: true, kind: action.kind };
      }
      if (
        action.kind === "min-feasible-budget" &&
        typeof action.minFeasibleBudgetYuan === "number" &&
        action.minFeasibleBudgetYuan > 0
      ) {
        const nextBudget = normalizeBudgetYuan(action.minFeasibleBudgetYuan);
        const nextPlanSpec: AppliedPlanSpec =
          state.planSpec?.kind === "archetype"
            ? {
                ...state.planSpec,
                allowBudgetMismatchReadOnly:
                  nextBudget !==
                  normalizeBudgetYuan(
                    state.planSpec.appliedBudgetYuan ??
                      state.planSpec.planBudgetYuan ??
                      nextBudget
                  ),
              }
            : state.planSpec;
        state = {
          ...state,
          budget: nextBudget,
          planSpec: nextPlanSpec,
        };
        emit();
        void scheduleRefresh();
        return { ok: true, kind: action.kind, nextBudget };
      }
      if (action.kind === "keep-cash") {
        if (state.planSpec) {
          state = { ...state, planSpec: null };
          emit();
          void scheduleRefresh();
        }
        return { ok: true, kind: action.kind };
      }
      if (action.kind === "go-manual") {
        state = { ...state, planSpec: null };
        emit();
        void scheduleRefresh();
        return { ok: true, kind: action.kind };
      }
      if (action.kind === "switch-main-pool") {
        const matchMap = new Map(state.matches.map((m) => [m.id, m]));
        const orderedMatchIds: string[] = [];
        for (const p of state.picks) {
          if (!orderedMatchIds.includes(p.matchId)) {
            orderedMatchIds.push(p.matchId);
          }
        }
        const nextPicks: SelectedPick[] = [];
        for (const mid of orderedMatchIds) {
          const existingMain = state.picks.filter(
            (p) =>
              p.matchId === mid &&
              (p.poolCode === "HAD" || p.poolCode === "HHAD")
          );
          if (existingMain.length > 0) {
            nextPicks.push(...existingMain);
            continue;
          }
          const fm = matchMap.get(mid);
          if (!fm) continue;
          const targetPoolCode: PoolCode | null =
            fm.pools.HAD?.selling !== false &&
            (fm.pools.HAD?.options?.length ?? 0) > 0
              ? "HAD"
              : fm.pools.HHAD?.selling !== false &&
                  (fm.pools.HHAD?.options?.length ?? 0) > 0
                ? "HHAD"
                : null;
          if (!targetPoolCode) continue;
          const pool = fm.pools[targetPoolCode];
          const topOpt = [...pool.options].sort(
            (a, b) => b.fairProb - a.fairProb || a.odds - b.odds
          )[0];
          if (!topOpt) continue;
          nextPicks.push({
            matchId: fm.id,
            matchNumStr: fm.matchNumStr,
            home: fm.home,
            away: fm.away,
            poolCode: targetPoolCode,
            poolName: pool.name,
            singleAllowed: resolvePoolCanSingle(pool),
            canSingle: resolvePoolCanSingle(pool),
            canAllUp: resolvePoolCanAllUp(pool),
            optionKey: topOpt.key,
            optionLabel: topOpt.label,
            odds: topOpt.odds,
            fairProb: topOpt.fairProb,
          });
        }
        state = {
          ...state,
          mode: "mix",
          planSpec: null,
          passSpec: { mode: "auto" },
          picks: nextPicks,
          ...syncAutoRadarFields(nextPicks, state.matches, state),
        };
        emit();
        void scheduleRefresh();
        return { ok: true, kind: action.kind };
      }
      return { ok: false };
    },

    setSubjectiveDeltaPct(val: number) {
      const clamped = Math.max(
        SUBJECTIVE_DELTA_MIN,
        Math.min(SUBJECTIVE_DELTA_MAX, Math.round(Number(val) || 0))
      );
      state = { ...state, subjectiveDeltaPct: clamped };
      emit();
      void scheduleRefresh();
    },

    setSimVoidFirstMatch(val: boolean) {
      state = { ...state, simVoidFirstMatch: val };
      emit();
      void scheduleRefresh();
    },

    loadPresetScenario(kind: PresetScenarioKind) {
      const built = buildPresetPicks(state.matches, kind);
      state = {
        ...state,
        planSpec: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        passSpec: { mode: "auto" },
        simVoidFirstMatch: false,
        subjectiveDeltaPct: 0,
        multiple: built.multiple,
        picks: built.picks,
        ...syncAutoRadarFields(built.picks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
    },

    buildSealedLedgerDraft(): SealedLedgerDraft | null {
      const { effectiveReport } = state.workspace;
      const appliedPlan =
        state.planSpec || effectiveReport.syntheticAutoMounted
          ? state.workspace.appliedPlan
          : null;
      if (
        effectiveReport.matchCount === 0 ||
        !effectiveReport.canCheckout ||
        effectiveReport.totalCost <= 0
      ) {
        return null;
      }

      const title = appliedPlan
        ? `${effectiveReport.modeLabel} · ${appliedPlan.shortTab}(${appliedPlan.lines.length}张)`
        : `${effectiveReport.modeLabel} · ${effectiveReport.betCount}注方案`;

      return {
        title,
        passLabel: effectiveReport.modeLabel,
        modeLabel: effectiveReport.modeLabel,
        betCount: Math.max(1, effectiveReport.betCount),
        cost: effectiveReport.totalCost,
        paperRefCost: effectiveReport.totalCost,
        minPayout: effectiveReport.minPayout,
        maxPayout: effectiveReport.maxPayout,
        workspaceParams: buildWorkspaceParams(state),
      };
    },

    formatShopkeeperWeChatSlip(opts?: { useConsolidated?: boolean }): string {
      const effectiveReport = state.workspace.effectiveReport;
      const manualReport = state.workspace.manualReport;
      const appliedPlan =
        state.planSpec || effectiveReport.syntheticAutoMounted
          ? state.workspace.appliedPlan
          : null;
      if (!effectiveReport.canCheckout || effectiveReport.totalCost <= 0) {
        return "";
      }

      const bankerSet = new Set(
        effectiveReport.bankerMatchIds ??
          manualReport.bankerMatchIds ??
          state.passSpec.bankerMatchIds ??
          []
      );
      const useConsolidated =
        opts?.useConsolidated ?? Boolean(state.planSpec?.consolidateTickets);

      const slipRows: string[] = [];
      let physicalSlipSeq = 0;

      const pushSplitSlips = (
        legsDesc: string,
        modeLabel: string,
        totalMult: number,
        totalLineCost?: number
      ) => {
        for (const sl of splitTerminalPosterSlips(
          "wc",
          legsDesc,
          modeLabel,
          totalMult,
          totalLineCost,
          true
        )) {
          physicalSlipSeq += 1;
          slipRows.push(
            `票${physicalSlipSeq}${sl.partTag}：${legsDesc} ｜ ${sl.right}`
          );
        }
      };

      if (appliedPlan) {
        const sourceLines =
          useConsolidated &&
          Array.isArray(appliedPlan.consolidatedLines) &&
          appliedPlan.consolidatedLines.length > 0
            ? appliedPlan.consolidatedLines
            : appliedPlan.lines;
        for (const ln of sourceLines) {
          const legsDesc = ln.legs
            .map(
              (g) =>
                `${bankerSet.has(g.matchId) ? "📌【胆】" : ""}${g.matchNumStr}${g.home}(${g.poolName}·${g.optionLabel})`
            )
            .join(" + ");
          pushSplitSlips(legsDesc, ln.modeLabel, ln.multiple, ln.cost);
        }
      } else if (
        Array.isArray(effectiveReport.tickets) &&
        effectiveReport.tickets.length > 0
      ) {
        for (const tk of effectiveReport.tickets) {
          const legs = tk.legs ?? [];
          const legsDesc = legs
            .map(
              (g) =>
                `${bankerSet.has(g.matchId) ? "📌【胆】" : ""}${g.matchNumStr}${g.home}(${g.poolName}·${g.optionLabel})`
            )
            .join(" + ");
          const passTxt =
            legs.length === 1
              ? "单关"
              : `${legs.length}串1${
                  bankerSet.size > 0 ? `(${bankerSet.size}胆)` : ""
                }`;
          const lineMult = Math.max(
            1,
            Math.round(
              (tk as ComboRow & { multiple?: number }).multiple ??
                state.multiple ??
                1
            )
          );
          pushSplitSlips(legsDesc, passTxt, lineMult);
        }
      }

      const header = `【竞彩出票单 · 共${physicalSlipSeq}张实票 · 合计 ¥${effectiveReport.totalCost}】`;
      const footer = "请核对票面固定赔率后出票拍照，谢谢！";
      return [header, ...slipRows, footer].join("\n");
    },
  };
}

export interface SealedLedgerDraft {
  title: string;
  passLabel?: string;
  modeLabel: string;
  betCount: number;
  cost: number;
  paperRefCost: number;
  minPayout: number;
  maxPayout: number;
  workspaceParams?: QuantWorkspaceParams;
  snapshot?: LedgerTicketSnapshot;
}

export interface SportteryCutoffStatus {
  level: "normal" | "urgent" | "closed";
  cutoffLabel: "22:00" | "23:00";
  remainingMinutes: number;
  badgeText: string;
}

export function splitTerminalPosterSlips(
  id: string,
  left: string,
  modeLabel: string,
  rawMultiple: number,
  singleSlipCost?: number,
  wechatStyle = false
): Array<{ key: string; left: string; right: string; partTag: string }> {
  const totalMult = Math.max(1, Math.round(rawMultiple || 1));
  const unitSlipCost =
    typeof singleSlipCost === "number" && singleSlipCost > 0 && totalMult > 0
      ? Math.max(2, Math.round(singleSlipCost / totalMult))
      : 2;
  if (totalMult <= 99) {
    const cost = singleSlipCost ?? totalMult * unitSlipCost;
    return [
      {
        key: id,
        left,
        partTag: "",
        right: wechatStyle
          ? `${modeLabel} × ${totalMult}倍 = ¥${cost}`
          : `${modeLabel} · ${totalMult}倍 (¥${cost})`,
      },
    ];
  }
  const slips: Array<{
    key: string;
    left: string;
    right: string;
    partTag: string;
  }> = [];
  let rem = totalMult;
  let idx = 1;
  const slipCount = Math.ceil(totalMult / 99);
  while (rem > 0) {
    const chunk = Math.min(99, rem);
    const chunkCost = chunk * unitSlipCost;
    slips.push({
      key: `${id}-p${idx}`,
      left: `${left} [第${idx}/${slipCount}张]`,
      partTag: `[分票${idx}/${slipCount}]`,
      right: wechatStyle
        ? `${modeLabel} × ${chunk}倍 = ¥${chunkCost}`
        : `${modeLabel} · ${chunk}倍 (¥${chunkCost})`,
    });
    rem -= chunk;
    idx += 1;
  }
  return slips;
}

/**
 * 计算中国体彩竞彩足球线下终端每日官方停售红线倒计时（北京时间：工作日 11:00-22:00，周末 11:00-23:00）
 */
export function computeSportteryCutoffStatus(
  nowMs: number = Date.now(),
  matches?: MatchItem[]
): SportteryCutoffStatus {
  if (Array.isArray(matches) && matches.length === 0) {
    return {
      level: "closed",
      cutoffLabel: "22:00",
      remainingMinutes: 0,
      badgeText: "当前暂无在售竞彩赛事",
    };
  }
  const bj = new Date(nowMs + 8 * 3600_000);
  const dow = bj.getUTCDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dow === 0 || dow === 6;
  const cutoffLabel: "22:00" | "23:00" = isWeekend ? "23:00" : "22:00";
  const cutoffMinutes = isWeekend ? 23 * 60 : 22 * 60;
  const openMinutes = 11 * 60;
  const curMinutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();

  if (curMinutes < openMinutes || curMinutes >= cutoffMinutes) {
    return {
      level: "closed",
      cutoffLabel,
      remainingMinutes: 0,
      badgeText: `休市 · 11:00-${cutoffLabel}出票`,
    };
  }

  const remainingMinutes = cutoffMinutes - curMinutes;
  const hrs = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;
  const remText = hrs > 0 ? `${hrs}h${mins}m` : `${mins}m`;
  if (remainingMinutes <= 30) {
    return {
      level: "urgent",
      cutoffLabel,
      remainingMinutes,
      badgeText: `⚠️ 距${cutoffLabel}停售 ${remText}`,
    };
  }
  return {
    level: "normal",
    cutoffLabel,
    remainingMinutes,
    badgeText: `⏰ 距${cutoffLabel}停售 ${remText}`,
  };
}

export interface RadarMatchDayGroup {
  dayKey: string;
  dayLabel: string;
  matches: MatchItem[];
}

/**
 * 赛事雷达编号/队名/联赛即时过滤与按比赛日分组（搜不到时诚实返回空列表，绝不静默回退全盘）
 */
export function filterAndGroupRadarMatches(
  matches: MatchItem[],
  opts: {
    searchQuery?: string;
    mode?: MatchMode;
    qFilter?: string;
    activeLeagues?: string[];
  } = {}
): {
  totalCount: number;
  filteredMatches: MatchItem[];
  groups: RadarMatchDayGroup[];
} {
  let list = Array.isArray(matches) ? matches : [];
  const activeLeagues = opts.activeLeagues ?? [];
  if (activeLeagues.length > 0) {
    list = list.filter((m) => activeLeagues.includes(m.league));
  }
  if (opts.mode === "single" || opts.qFilter === "single") {
    const sub = list.filter((m) => m.pools.HAD.single || m.pools.HHAD.single);
    if (sub.length > 0 || opts.searchQuery?.trim()) list = sub;
  } else if (opts.qFilter === "low-vig") {
    const sub = list.filter((m) => m.pools.HAD.vig < 0.1228);
    if (sub.length > 0 || opts.searchQuery?.trim()) list = sub;
  } else if (opts.qFilter === "drop") {
    const sub = list.filter((m) =>
      Object.values(m.pools).some((p) =>
        p.options.some((o) => (o.movement?.lastHopDirection ?? o.trend) === -1)
      )
    );
    if (sub.length > 0 || opts.searchQuery?.trim()) list = sub;
  } else if (opts.qFilter === "arb") {
    const sub = list.filter((m) => (m.microQuant?.arbitrages?.length ?? 0) > 0);
    if (sub.length > 0 || opts.searchQuery?.trim()) list = sub;
  }

  const q = String(opts.searchQuery || "")
    .trim()
    .toLowerCase();
  if (q) {
    list = list.filter((m) => {
      const hay =
        `${m.matchNumStr} ${m.home} ${m.away} ${m.league}`.toLowerCase();
      return hay.includes(q);
    });
  }

  const weekdayRe = new RegExp("^(周[一二三四五六日])");
  const groupMap = new Map<string, RadarMatchDayGroup>();
  for (const m of list) {
    const weekdayPrefix = m.matchNumStr?.match(weekdayRe)?.[1] || "当期";
    const datePart = m.businessDate || m.matchDate || "";
    const dayKey = datePart ? `${datePart}_${weekdayPrefix}` : weekdayPrefix;
    const dayLabel = datePart
      ? `${weekdayPrefix} · ${datePart.slice(5)}`
      : `${weekdayPrefix}赛事`;
    let grp = groupMap.get(dayKey);
    if (!grp) {
      grp = { dayKey, dayLabel, matches: [] };
      groupMap.set(dayKey, grp);
    }
    grp.matches.push(m);
  }

  return {
    totalCount: list.length,
    filteredMatches: list,
    groups: Array.from(groupMap.values()),
  };
}
