import {
  EMPTY_WORKSPACE_RESPONSE,
  SUBJECTIVE_DELTA_MAX,
  SUBJECTIVE_DELTA_MIN,
  type AppliedPlanSpec,
  type ArchetypePlan,
  type BonusOptMode,
  type BridgeMatchCandidate,
  type ComboRow,
  type EquivalentArbItem,
  type LedgerSnapshotLine,
  type LedgerSnapshotMatch,
  type LedgerTicketSnapshot,
  type MatchItem,
  type PassSelectionSpec,
  type PlanTicketLine,
  type PoolCode,
  type PortfolioKey,
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
  manualBonusLineCount: number;
  isBonusOver512: boolean;
  isBonusOptDisabled: boolean;
  activeBankerSet: Set<string>;
  canToggleBanker: boolean;
  canToggleBankerMatch: (matchId: string) => boolean;
  breakevenTargetCost: number | null;
  appliedPlan: ArchetypePlan | null;
  effectiveAppliedPlan: ArchetypePlan | null;
  portfolioPlans: ArchetypePlan[];
  currentArch: ArchetypePlan | null;
  fallbackValidArch: ArchetypePlan | null;
  showBridgeFinder: boolean;
  hasSuboptimalManual: boolean;
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
      if (opt.trend === -1 || opt.trend === 1) {
        trendMovements.push({
          poolCode: pCode,
          poolName: pool.name,
          optionLabel: opt.label,
          odds: opt.odds,
          trend: opt.trend,
          interpretation:
            opt.trend === -1
              ? "绿降▼ 机构下调赔付设防"
              : "红升▲ 抬高赔付散热预警",
        });
      }
    }
  }

  const hadOpts = [...(match.pools.HAD?.options ?? [])].sort(
    (a, b) => b.fairProb - a.fairProb
  );
  const topHad = hadOpts[0];
  const hadTrendTag =
    topHad?.trend === 1
      ? "（热门红升▲散热，慎做裸胆）"
      : topHad?.trend === -1
        ? "（绿降▼设防加固）"
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
  mode: MatchMode;
  multiple: number;
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
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

function buildInitialState(): BetSlipState {
  return {
    matches: [],
    picks: [],
    mode: "mix",
    multiple: 5,
    passSpec: { mode: "auto" },
    planSpec: null,
    syntheticSingleMode: "full-3way",
    lastPoolSwitchUndo: null,
    subjectiveDeltaPct: 0,
    simVoidFirstMatch: false,
    targetIds: [],
    anchorToRadarPicks: false,
    manualPoolOverride: false,
    syncedRadarSig: "",
    budget: 100,
    stance: "objective",
    unlockFullAgg: false,
    workspace: EMPTY_WORKSPACE_RESPONSE,
    objectivePortfolioPlans: [],
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

  function emit() {
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
      clientAlerts,
    };
  }

  function executeComputeNow(): Promise<void> {
    const seq = ++computeSeq;
    const paramsSnapshot = buildWorkspaceParams(state);
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
          .then((ws) => {
            if (seq === computeSeq) {
              state = {
                ...state,
                workspace: ws,
                objectivePortfolioPlans: resolveObjectivePortfolioPlans(
                  paramsSnapshot.stance,
                  ws,
                  state.objectivePortfolioPlans
                ),
              };
              options.onComputeSuccess?.();
              emit();
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
        state = {
          ...state,
          workspace: ws,
          objectivePortfolioPlans: resolveObjectivePortfolioPlans(
            paramsSnapshot.stance,
            ws,
            state.objectivePortfolioPlans
          ),
        };
        options.onComputeSuccess?.();
        emit();
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

  function isAuthoritativePickSingle(pk: SelectedPick): boolean {
    const fm = state.matches.find((x) => x.id === pk.matchId);
    const pool = fm?.pools[pk.poolCode];
    return pool
      ? Boolean(pk.singleAllowed) && Boolean(pool.single)
      : Boolean(pk.singleAllowed);
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
    state = {
      ...baseState,
      matches: bundle.matches,
      picks: bundle.initialPicks,
      ...radarSync,
      workspace: bundle.workspace,
      objectivePortfolioPlans: bundle.workspace.portfolioPlans ?? [],
    };
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
      manualReport.matchCount >= 3 &&
      manualReport.matchCount <= 8 &&
      !manualReport.hasSameMatchCrossPoolConflict;
    const bankerWindow = resolveBankerPassWindow(distinctIds);

    const canToggleBankerMatch = (matchId: string): boolean => {
      if (!distinctIds.includes(matchId) || !bankerWindow) return false;
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
        : (portfolioPlans.find((p) => p.available !== false) ??
          portfolioPlans[0] ??
          null);

    const showBridgeFinder =
      effectiveReport.matchCount === 1 &&
      !effectiveReport.canCheckout &&
      (state.workspace.insights.bridgeCandidates?.length ?? 0) > 0;
    const hasSuboptimalManual =
      !appliedPlan &&
      manualReport.matchCount > 0 &&
      (manualReport.underwaterCount > 0 || manualReport.avgVigLossPer100 > 19);

    return {
      isSingleNonSingleContext,
      isSyntheticPlayable,
      hasSyntheticInherentBlindSpot,
      canTrimSynthetic2Way,
      manualBonusLineCount,
      isBonusOver512,
      isBonusOptDisabled,
      activeBankerSet,
      canToggleBanker,
      canToggleBankerMatch,
      breakevenTargetCost,
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
    getState: () => state,
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

      const isLiveXiaoGaoAlert = (a?: MatchItem["aiAlert"]) =>
        Boolean(a && (a.source === "primary" || a.source === "fallback"));
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

      state = {
        ...state,
        matches: mergedMatches,
        targetIds: nextTargets,
        picks: syncedPicks,
        workspace: res.workspace,
        objectivePortfolioPlans: resolveObjectivePortfolioPlans(
          state.stance,
          res.workspace,
          state.objectivePortfolioPlans
        ),
      };
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
      state = {
        ...state,
        matches: state.matches.map((item) => {
          const pm = rep.perMatch.find(
            (x) =>
              x.matchId === item.id ||
              (Boolean(item.matchNumStr) && x.matchId === item.matchNumStr) ||
              Boolean(
                item.matchNumStr &&
                x.matchTitle &&
                x.matchTitle.includes(item.matchNumStr)
              )
          );
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
      if (
        !pool ||
        pool.selling === false ||
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
        state.picks.every(isAuthoritativePickSingle) && Boolean(pool.single);

      const sameMatchOther = state.picks.filter(
        (p) => p.matchId === m.id && p.poolCode !== poolCode
      );
      if (sameMatchOther.length > 0) {
        if ((otherHasCrossPool || otherDistinctCount + 1 > 8) && !pool.single) {
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
            singleAllowed: pool.single,
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
            singleAllowed: pool.single,
            optionKey: opt.key,
            optionLabel: opt.label,
            odds: opt.odds,
            fairProb: opt.fairProb,
          },
        ];
        state = {
          ...state,
          planSpec: null,
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

      if ((existingHasCrossPool || existingDistinctCount > 8) && !pool.single) {
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
          singleAllowed: pool.single,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        },
      ];
      state = {
        ...state,
        planSpec: null,
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
        nextMode === "trim-2way" || nextMode === "off" ? nextMode : "full-3way";
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
      if (
        !plan ||
        plan.available === false ||
        !Array.isArray(plan.lines) ||
        plan.lines.length === 0
      ) {
        return false;
      }
      const primaryPoolByMatch = new Map<string, PoolCode>();
      const map = new Map<string, SelectedPick>();
      plan.lines.forEach((l) =>
        l.legs.forEach((lg) => {
          const chosenPool = primaryPoolByMatch.get(lg.matchId) ?? lg.poolCode;
          primaryPoolByMatch.set(lg.matchId, chosenPool);
          if (lg.poolCode !== chosenPool) return;
          const fm = state.matches.find((x) => x.id === lg.matchId);
          map.set(`${lg.matchId}-${lg.poolCode}-${lg.optionKey}`, {
            matchId: lg.matchId,
            matchNumStr: lg.matchNumStr,
            home: lg.home,
            away: lg.away,
            poolCode: lg.poolCode,
            poolName: lg.poolName,
            singleAllowed: fm?.pools[lg.poolCode]?.single ?? true,
            optionKey: lg.optionKey,
            optionLabel: lg.optionLabel,
            odds: lg.odds,
            fairProb: lg.fairProb,
          });
        })
      );
      const boardIndex = new Map<string, number>();
      state.matches.forEach((m, idx) => boardIndex.set(m.id, idx));
      const orderedPicks = Array.from(map.values()).sort((a, b) => {
        const ia = boardIndex.get(a.matchId) ?? Number.MAX_SAFE_INTEGER;
        const ib = boardIndex.get(b.matchId) ?? Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
      state = {
        ...state,
        planSpec: {
          kind: "archetype",
          key: plan.key,
          snapshotPlan: plan,
          scaleMultiple: 1,
          consolidateTickets: true,
        },
        simVoidFirstMatch: false,
        subjectiveDeltaPct: 0,
        picks: orderedPicks,
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    restoreEqualMultiple() {
      const { cleaned } = trimToSinglePoolPerMatch(state.picks);
      state = { ...state, planSpec: null, picks: cleaned };
      emit();
      void scheduleRefresh();
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
      if (state.syntheticSingleMode === "off") {
        state = { ...state, syntheticSingleMode: "full-3way" };
      }
      return this.togglePick(m, cand.poolCode, cand.optionKey);
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
      state = { ...state, budget: normalized };
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
      const { effectiveReport, manualReport } = state.workspace;
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

      const bankerSet = new Set(
        effectiveReport.bankerMatchIds ??
          manualReport.bankerMatchIds ??
          state.passSpec.bankerMatchIds ??
          []
      );
      const matchById = new Map(state.matches.map((m) => [m.id, m]));
      const mapLeg = (lg: {
        matchId: string;
        matchNumStr?: string;
        home?: string;
        away?: string;
        kickoff?: string;
        poolCode: PoolCode;
        optionKey: string;
        optionLabel?: string;
        odds: number;
      }) => {
        const m = matchById.get(lg.matchId);
        const opt = m?.pools?.[lg.poolCode]?.options?.find(
          (o) => o.key === lg.optionKey
        );
        return {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr || m?.matchNumStr,
          home: lg.home || m?.home,
          away: lg.away || m?.away,
          kickoff: lg.kickoff || m?.kickoff,
          poolCode: lg.poolCode,
          optionKey: lg.optionKey,
          optionLabel:
            (opt && opt.odds > 1 ? opt.label : undefined) || lg.optionLabel,
          odds: opt && opt.odds > 1 ? opt.odds : lg.odds,
          goalLine: m?.pools?.HHAD?.goalLine ?? "-1",
        };
      };

      const rawLines =
        effectiveReport.betCount > 512
          ? []
          : appliedPlan
            ? appliedPlan.lines.map((ln, idx) => ({
                id: ln.id || `ap_${idx + 1}`,
                modeLabel: ln.modeLabel,
                multiple: Math.max(1, Math.round(ln.multiple || 1)),
                legs: ln.legs.map(mapLeg),
              }))
            : (effectiveReport.tickets ?? []).map((tk, idx) => {
                const legs = tk.legs ?? [];
                const passTxt =
                  legs.length === 1
                    ? "单关"
                    : `${legs.length}串1${bankerSet.size > 0 ? `(${bankerSet.size}胆)` : ""}`;
                return {
                  id: tk.id || `tk_${idx + 1}`,
                  modeLabel: passTxt,
                  multiple: Math.max(
                    1,
                    Math.round(
                      (tk as ComboRow & { multiple?: number }).multiple ??
                        state.multiple ??
                        1
                    )
                  ),
                  legs: legs.map(mapLeg),
                };
              });

      const matchMap = new Map<string, LedgerSnapshotMatch>();
      for (const ln of rawLines) {
        for (const lg of ln.legs) {
          const m = matchById.get(lg.matchId);
          let entry = matchMap.get(lg.matchId);
          if (!entry) {
            entry = {
              matchId: lg.matchId,
              matchNumStr: lg.matchNumStr || m?.matchNumStr || lg.matchId,
              home: lg.home || m?.home || "",
              away: lg.away || m?.away || "",
              kickoff: lg.kickoff || m?.kickoff || "",
              businessDate: m?.businessDate,
              goalLine: lg.goalLine ?? m?.pools?.HHAD?.goalLine ?? "-1",
              isBanker: bankerSet.has(lg.matchId),
              picks: [],
            };
            matchMap.set(lg.matchId, entry);
          }
          if (
            !entry.picks.some(
              (p) => p.poolCode === lg.poolCode && p.optionKey === lg.optionKey
            )
          ) {
            entry.picks.push({
              poolCode: lg.poolCode,
              optionKey: lg.optionKey,
              optionLabel: lg.optionLabel || lg.optionKey,
              odds: lg.odds,
              goalLine: entry.goalLine,
            });
          }
        }
      }

      const title = appliedPlan
        ? `${effectiveReport.modeLabel} · ${appliedPlan.shortTab}(${appliedPlan.lines.length}张)`
        : `${effectiveReport.modeLabel} · ${effectiveReport.betCount}注方案`;

      return {
        title,
        modeLabel: effectiveReport.modeLabel,
        betCount: Math.max(1, effectiveReport.betCount),
        cost: effectiveReport.totalCost,
        paperRefCost: effectiveReport.totalCost,
        minPayout: effectiveReport.minPayout,
        maxPayout: effectiveReport.maxPayout,
        workspaceParams: buildWorkspaceParams(state),
        snapshot:
          rawLines.length > 0
            ? { matches: Array.from(matchMap.values()), lines: rawLines }
            : undefined,
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
      Object.values(m.pools).some((p) => p.options.some((o) => o.trend === -1))
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
