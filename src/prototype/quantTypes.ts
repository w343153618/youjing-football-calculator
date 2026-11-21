export type PoolCode = "HAD" | "HHAD" | "HAFU" | "TTG" | "CRS";
export type UserStance = "objective" | "home-lean" | "upset-watch";
export type PortfolioKey =
  "max-profit-prob" | "max-ev-utility" | "max-cvar-wheel" | "alpha-radar";
export type LegacyArchetypeKey =
  | "iron-shield"
  | "spear-shield"
  | "fault-tolerant"
  | "goal-structure"
  | "value-assassin";
export type ArchetypeKey = PortfolioKey | LegacyArchetypeKey;
export type BonusOptMode = "equal" | "hot-first" | "cold-first";

export const SUBJECTIVE_DELTA_MIN = -15;
export const SUBJECTIVE_DELTA_MAX = 15;

export interface OddsOption {
  key: string;
  label: string;
  odds: number;
  trend: -1 | 0 | 1;
  fairProb: number;
  shinProb?: number;
}

export interface MatchPool {
  code: PoolCode;
  name: string;
  single: boolean;
  selling?: boolean;
  goalLine?: string;
  payoutRatio: number;
  vig: number;
  updateTime: string;
  updateDate?: string;
  options: OddsOption[];
}

export interface MicroBadge {
  text: string;
  tone: "emerald" | "amber" | "rose" | "sky" | "purple";
}

export interface EquivalentArbPickRef {
  poolCode: PoolCode;
  optionKey: string;
}

export interface EquivalentArbItem {
  matchId: string;
  title: string;
  betterChoice: string;
  worseChoice: string;
  edgePct: number;
  detail: string;
  betterPicks: EquivalentArbPickRef[];
  worsePicks: EquivalentArbPickRef[];
  poolCode: PoolCode;
  optionKey: string;
}

export interface MatchMicroQuant {
  homeXG: number;
  awayXG: number;
  totalXG: number;
  oneGoalProb: number;
  oneGoalShareOfWins: number;
  cardPanTip: string;
  topTwoGoals: [string, string, number];
  halfDrawProb: number;
  arbitrages: EquivalentArbItem[];
  steamSignal: string;
  microBadges: MicroBadge[];
  /** Dixon-Coles {0:0, 1:0, 0:1, 1:1} 低比分联动修正系数 ρ（非全场进球 Pearson 相关系数） */
  paceCorrelation: number;
  paceLabel: "防守死锁" | "均衡节奏" | "开放对攻";
  alphaScanSummary: string;
}

export interface MatchItem {
  id: string;
  matchNumStr: string;
  league: string;
  kickoff: string;
  businessDate?: string;
  matchDate?: string;
  home: string;
  away: string;
  homeRank?: string;
  awayRank?: string;
  isHot?: boolean;
  aiAlert?: {
    level: "high" | "medium";
    tag: string;
    summary: string;
    priceInStatus: string;
    source: string;
    suggestedDelta?: string;
  };
  pools: Record<PoolCode, MatchPool>;
  microQuant: MatchMicroQuant;
}

export interface SelectedPick {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  poolCode: PoolCode;
  poolName: string;
  singleAllowed: boolean;
  optionKey: string;
  optionLabel: string;
  odds: number;
  fairProb: number;
}

export interface ComboRow {
  id: string;
  desc: string;
  legs?: SelectedPick[];
  prob: number;
  unitPayout: number;
  totalPayout: number;
  cappedClipped: number;
  netProfit: number;
  isUnderwater: boolean;
}

export interface RadarWarning {
  id: string;
  severity: "danger" | "warn" | "tip";
  title: string;
  detail: string;
}

export type PassSelectionSpec = {
  mode: "auto" | "free" | "combo";
  passSizes?: number[];
  comboCode?: string;
  bankerMatchIds?: string[];
};

export interface FreePassOption {
  size: number;
  label: string;
  enabled: boolean;
  active: boolean;
  disabledReason: string | null;
}

export interface ComboPassOption {
  code: string;
  label: string;
  sizes: number[];
  baseBets: number;
  actualBets?: number;
  desc: string;
  enabled: boolean;
  active: boolean;
  disabledReason: string | null;
}

export interface TruthReport {
  matchCount: number;
  betCount: number;
  comboCount: number;
  multiple: number;
  modeLabel: string;
  canSingle: boolean;
  canCheckout: boolean;
  ruleBlockReason: string | null;
  poolCap: number;
  activePassSizes: number[];
  activeComboCode: string | null;
  bankerMatchIds?: string[];
  availableFreePasses: FreePassOption[];
  availableComboPasses: ComboPassOption[];
  hasSameMatchCrossPoolConflict: boolean;
  totalCost: number;
  minPayout: number;
  maxPayout: number;
  likelyRange: [number, number];
  anyWinProb: number;
  realProfitProb: number;
  strictNetGainProb: number;
  breakEvenProb: number;
  underwaterCount: number;
  underwaterShareOfWins: number;
  avgPayoutRatio: number;
  avgVigLossPer100: number;
  expectedValueRate: number;
  objectiveEVRate: number;
  objectiveProfitProb: number;
  objectiveStrictNetGainProb: number;
  subjectiveProjectedEVRate?: number | null;
  subjectiveProjectedProfitProb?: number | null;
  dangerScore: number;
  effectiveOdds: number;
  breakevenUpgradeCost: number | null;
  consolidatedTickets: number;
  syntheticHint: string | null;
  syntheticRescuePicks?: SelectedPick[] | null;
  tickets?: ComboRow[];
  combos: ComboRow[];
  warnings: RadarWarning[];
}

export interface PlanLeg {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  poolCode: PoolCode;
  poolName: string;
  optionKey: string;
  optionLabel: string;
  odds: number;
  fairProb: number;
}

export interface PlanTicketLine {
  id: string;
  roleLabel: string;
  legs: PlanLeg[];
  modeLabel: string;
  multiple: number;
  cost: number;
  unitPayout: number;
  returnPayout: number;
  netProfit: number;
  prob: number;
}

export interface ArchetypePlan {
  key: ArchetypeKey;
  available: boolean;
  alphaKind?: "positive-ev" | "none";
  emptyReason?: string | null;
  shortTab: string;
  badge: string;
  title: string;
  tagline: string;
  totalCost: number;
  savedCash: number;
  minReturn: number;
  maxReturn: number;
  winProb: number;
  profitProb: number;
  strictNetGainProb?: number;
  breakEvenProb?: number;
  expectedValueRate: number;
  objectiveEVRate?: number;
  objectiveProfitProb?: number;
  objectiveStrictNetGainProb?: number;
  subjectiveProjectedEVRate?: number | null;
  subjectiveProjectedProfitProb?: number | null;
  underwaterCount: number;
  zeroPayoutProb?: number | null;
  wipeoutMiss2Prob?: number | null;
  missOneReturn: number | null;
  breakevenUpgradeCost?: number | null;
  consolidateTickets?: boolean;
  consolidatedLines?: PlanTicketLine[];
  vigPct: number;
  reasons: string[];
  lines: PlanTicketLine[];
}

export interface StaggeredHedgePlan {
  available: boolean;
  hedgeMode?: "lock-profit" | "break-even" | "reduce-loss" | "unavailable";
  gapMinutes: number;
  gapText: string;
  earlyMatchTitle: string;
  lateMatchTitle: string;
  earlyKickoff: string;
  lateKickoff: string;
  oppositeLabel: string;
  oppositeOdds: number;
  hedgeCost: number;
  lockedNetProfit: number;
  reason: string;
}

export interface WeakestLinkTip {
  matchId: string;
  matchTitle: string;
  currentProfitProb: number;
  afterRemoveProfitProb: number;
  message: string;
}

export interface BridgeMatchCandidate {
  kind: "lowest-vig" | "staggered-hedge";
  badge: string;
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  poolCode: PoolCode;
  poolName: string;
  optionKey: string;
  optionLabel: string;
  odds: number;
  fairProb: number;
  singleLegReturnRate: number;
  gapMinutes: number | null;
  reason: string;
}

export interface ProOrderInsights {
  hedge: StaggeredHedgePlan;
  weakestLink: WeakestLinkTip | null;
  fiveLossStreakProb: number;
  recommendedBankrollPct: number;
  activeSwapTip: EquivalentArbItem | null;
  bridgeCandidates: BridgeMatchCandidate[];
}

export type AppliedPlanSpec =
  | null
  | {
      kind: "bonus";
      optMode: BonusOptMode;
      scaleMultiple?: number;
      upgradeToBreakeven?: boolean;
      consolidateTickets?: boolean;
      targetBudgetCost?: number;
    }
  | {
      kind: "archetype";
      key: ArchetypeKey;
      snapshotPlan?: ArchetypePlan;
      scaleMultiple?: number;
      consolidateTickets?: boolean;
    };

export interface QuantWorkspaceParams {
  picks: SelectedPick[];
  multiple: number;
  passSpec?: PassSelectionSpec;
  subjectiveDeltaPct: number;
  simVoidFirstMatch: boolean;
  planSpec: AppliedPlanSpec;
  targetIds: string[];
  anchorToRadarPicks?: boolean;
  budget: number;
  stance: UserStance;
  unlockFullAgg: boolean;
  clientAlerts?: Record<string, NonNullable<MatchItem["aiAlert"]>>;
}

export interface QuantWorkspaceResponse {
  manualReport: TruthReport;
  effectiveReport: TruthReport;
  appliedPlan: ArchetypePlan | null;
  insights: ProOrderInsights;
  portfolioPlans: ArchetypePlan[];
  fivePlans: ArchetypePlan[];
  subjectiveEVPct: number;
  allWarnings: RadarWarning[];
}

export const EMPTY_TRUTH_REPORT: TruthReport = {
  matchCount: 0,
  betCount: 0,
  comboCount: 0,
  multiple: 5,
  modeLabel: "过关选择",
  canSingle: false,
  canCheckout: false,
  ruleBlockReason: null,
  poolCap: 8,
  activePassSizes: [],
  activeComboCode: null,
  bankerMatchIds: [],
  availableFreePasses: [],
  availableComboPasses: [],
  hasSameMatchCrossPoolConflict: false,
  totalCost: 0,
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
  dangerScore: 0,
  effectiveOdds: 0,
  breakevenUpgradeCost: null,
  consolidatedTickets: 0,
  syntheticHint: null,
  tickets: [],
  combos: [],
  warnings: [],
};

export const EMPTY_INSIGHTS: ProOrderInsights = {
  hedge: {
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
    reason: "需至少选择 2 场且开球时间间隔 ≥ 135 分钟",
  },
  weakestLink: null,
  fiveLossStreakProb: 0,
  recommendedBankrollPct: 5,
  activeSwapTip: null,
  bridgeCandidates: [],
};

export const EMPTY_WORKSPACE_RESPONSE: QuantWorkspaceResponse = {
  manualReport: EMPTY_TRUTH_REPORT,
  effectiveReport: EMPTY_TRUTH_REPORT,
  appliedPlan: null,
  insights: EMPTY_INSIGHTS,
  portfolioPlans: [],
  fivePlans: [],
  subjectiveEVPct: 0,
  allWarnings: [],
};

// ==================== Spec 0013 · Sealed Print-Time Ledger Snapshot & Auto-Settlement Types ====================

export type LedgerOutcomeStatus = "pending" | "won" | "partial" | "lost";

export interface LedgerSnapshotPick {
  poolCode: PoolCode;
  optionKey: string;
  optionLabel: string;
  odds: number;
  goalLine?: string;
}

export interface LedgerSnapshotMatch {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  businessDate?: string;
  goalLine?: string;
  isBanker?: boolean;
  picks: LedgerSnapshotPick[];
}

export interface LedgerSnapshotLeg {
  matchId: string;
  matchNumStr?: string;
  home?: string;
  away?: string;
  kickoff?: string;
  poolCode: PoolCode;
  optionKey: string;
  optionLabel?: string;
  odds: number;
  goalLine?: string;
}

export interface LedgerSnapshotLine {
  id: string;
  modeLabel: string;
  multiple: number;
  legs: LedgerSnapshotLeg[];
}

export interface LedgerTicketSnapshot {
  matches: LedgerSnapshotMatch[];
  lines: LedgerSnapshotLine[];
}

export interface LedgerMatchOutcome {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  goalLine?: string;
  isBanker: boolean;
  state: "pending" | "hit" | "miss" | "void";
  halfScore: string;
  fullScore: string;
  picks: Array<{
    poolCode: PoolCode;
    optionKey: string;
    optionLabel: string;
    odds: number;
    state: "pending" | "hit" | "miss" | "void";
  }>;
}

export interface LedgerTicketOutcome {
  id: string;
  modeLabel: string;
  multiple: number;
  cost: number;
  status: "pending" | "won" | "lost" | "void-refund";
  payout: number;
  potentialPayout?: number;
  legs: Array<{
    matchId: string;
    matchNumStr: string;
    home: string;
    away: string;
    poolCode: PoolCode;
    optionKey: string;
    optionLabel: string;
    odds: number;
    state: "pending" | "hit" | "miss" | "void";
  }>;
}

export interface LedgerLiveEarlyHedge {
  available: boolean;
  lateMatchId: string;
  lateMatchTitle: string;
  lateKickoff: string;
  survivingTargetReturn: number;
  hedgeCost: number;
  lockedNetProfit: number;
  oppositeLabel: string;
  oppositeOdds: number;
  hedgeMode: "lock-profit" | "break-even" | "reduce-loss";
}

export interface LedgerSettlementDetail {
  status: LedgerOutcomeStatus;
  settledReturn: number;
  netProfit: number;
  hitTicketCount: number;
  totalTicketCount: number;
  hitMatchCount: number;
  settledMatchCount: number;
  totalMatchCount: number;
  earlyEliminated: boolean;
  lockedFloorReturn: number;
  progressSummary: string;
  liveEarlyHedge: LedgerLiveEarlyHedge | null;
  matches: LedgerMatchOutcome[];
  tickets: LedgerTicketOutcome[];
}
