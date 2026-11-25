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
export type SyntheticSingleMode =
  "full-3way" | "partial-cover" | "trim-2way" | "off";

export const SUBJECTIVE_DELTA_MIN = -15;
export const SUBJECTIVE_DELTA_MAX = 15;

export interface DualAxisOptionMovement {
  baselineSource: "official-archive-open" | "local-first-seen" | "single-frame";
  frameCount: number;
  goalLine: string;
  cumFairProbDeltaPp: number | null;
  openOdds?: number | null;
  openAt?: string | null;
  prevOdds?: number | null;
  prevAt?: string | null;
  currentOdds?: number | null;
  currentAt?: string | null;
  lastHopDirection: -1 | 0 | 1;
}

export type BoardFreshnessSource =
  "official-live" | "cached-snapshot" | "fallback";

export type BoardFreshnessState =
  | "fresh"
  | "empty-board-fallback"
  | "timeout-fallback"
  | "maintenance-fallback"
  | "builtin-fallback";

export interface BoardFreshnessMeta {
  source: BoardFreshnessSource;
  boardState: BoardFreshnessState;
  lastValidBoardAt: number | null;
  lastValidBoardClock: string | null;
  isFallbackReadOnly: boolean;
  bannerText: string | null;
  quotedAt?: number | null;
  syncedAt?: number | null;
  quoteVersion?: string;
}

export interface OddsOption {
  key: string;
  label: string;
  odds: number;
  trend: -1 | 0 | 1;
  fairProb: number;
  shinProb?: number;
  movement?: DualAxisOptionMovement;
}

export interface MatchPool {
  confirmedSaleRights?: { single: boolean; allUp: boolean };
  code: PoolCode;
  name: string;
  single: boolean;
  canSingle?: boolean;
  canAllUp?: boolean;
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
  odds?: number;
  goalLine?: string;
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
  isExactEventEquivalent?: boolean;
  isStatewiseNonDecreasing?: boolean;
  minStateReturnDiff?: number;
  maxStateReturnDiff?: number;
  equalStakeCostYuan?: number;
  executableSwapCost?: number;
  executableSwapLines?: PlanTicketLine[];
  executableSwapMultiple?: number;
  sourcePicksSig?: string;
  sourceTotalCost?: number;
  sourceActivePassSig?: string;
  sourceBankerSig?: string;
  sourceComboCode?: string;
  sourceActualLinesSig?: string;
  sourceWorkspaceSig?: string;
}

export interface CapGuardAlternative {
  multiples: number[];
  originalMultiples?: number[];
  residualClippedMaxMultiple?: number;
  totalCost?: number;
  expectedValueRateDiff: number;
  partialLossShortfallDiff?: number;
  requiresExplicitConfirm: boolean;
  bindingSig?: string;
  summaryText?: string;
  sourceWorkspaceSig?: string;
}

export interface MatchMicroQuant {
  homeXG: number;
  awayXG: number;
  totalXG: number;
  oneGoalProb: number;
  oneGoalShareOfWins: number;
  cardPanTip: string;
  handicapGoalLine?: number;
  favoriteCoverLabel?: "让胜" | "让负" | null;
  underdogHoldLabel?: "让胜" | "让负" | null;
  favoriteTrueCoverShareOfWins?: number;
  favoriteExactPushShareOfWins?: number;
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

export interface XiaoGaoAlertBinding {
  matchId: string;
  activePoolsMask: string;
  hhadGoalLine: string;
  quoteVersionSig: string;
  analyzedAt: number;
}

export interface MatchItem {
  id: string;
  matchNumStr: string;
  league: string;
  leagueId?: string;
  kickoff: string;
  kickoffDateTime?: string;
  businessDate?: string;
  matchDate?: string;
  home: string;
  homeTeamId?: string;
  away: string;
  awayTeamId?: string;
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
    binding?: XiaoGaoAlertBinding;
  };
  pools: Record<PoolCode, MatchPool>;
  microQuant: MatchMicroQuant;
}

export interface SelectedPick {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  th?: string;
  poolCode: PoolCode;
  poolName: string;
  goalLine?: string;
  singleAllowed: boolean;
  canSingle?: boolean;
  canAllUp?: boolean;
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
  ticketNo?: number;
  multiple?: number;
  stakeCost?: number;
  matchPairKey?: string;
  matchPairLabel?: string;
  hitMatchCount?: number;
  hitTicketNos?: number[];
  hitTicketIds?: string[];
  isZeroPayoutSummary?: boolean;
  zeroHitProb?: number;
  subThresholdHitProb?: number;
  returnMultiple?: number;
}

export interface RadarWarning {
  id: string;
  severity: "danger" | "warn" | "tip";
  title: string;
  detail: string;
}

export type PassIntentMode = "follow-max-parlay" | "free" | "combo" | "auto";

export type PassSelectionSpec = {
  mode: PassIntentMode;
  passSizes?: number[];
  comboCode?: string;
  bankerMatchIds?: string[];
};

export type SelectionLifecycleStatus =
  "empty" | "pending-single-auth" | "rule-blocked" | "ready";

export type DistributionComputeStatus =
  "none" | "computed" | "uncomputed-over-cap";

export interface TerminalPhysicalSlipLegGroup {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  isBanker?: boolean;
  poolCode: PoolCode;
  poolName: string;
  goalLine?: string;
  options: Array<{
    optionKey: string;
    optionLabel: string;
    odds: number;
  }>;
}

export interface TerminalPhysicalSlip {
  slipNo: number;
  slipId: string;
  modeLabel: string;
  comboCode?: string | null;
  passSizes: number[];
  multiple: number;
  basicUnitsPerSlip: number;
  stakeUnits2Yuan: number;
  costYuan: number;
  matchIds: string[];
  legsByMatch: TerminalPhysicalSlipLegGroup[];
  sourceBasicLineIds: string[];
  lineSignature: string;
  ruleVersion: string;
}

export type BreakevenFeasibilityState =
  "certified-feasible" | "certified-infeasible" | "unknown";

export interface BreakevenCertificate {
  minFeasibleBudget: number | null;
  isCurrentFeasible: BreakevenFeasibilityState;
  nextFeasibleBudget: number | null;
  proofStatus: "certified" | "lp-infeasible" | "time-budget-unproved";
  conditionalFloorAtCurrent?: number | null;
  zeroPayoutProb?: number;
}

export interface SingleAuthGrant {
  authId: string;
  matchId: string;
  goalLine?: string;
  picksSig: string;
  targetMaskSig: string;
  coveredMaskSig: string;
  lineAndMultipleSig: string;
  draftRevision: number;
  quoteVersionSig: string;
  ruleVersion: string;
  approvedCost: number;
  exactCost?: number;
  mode: SyntheticSingleMode;
}

export interface SandboxSimSpec {
  baseRevision: number;
  voidMatchIds: string[];
  subjectiveDeltaPct: number;
}

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

export interface UnconditionalQuantiles {
  p20: number;
  p50: number;
  p80: number;
  p99: number;
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
  isEmptySlip: boolean;
  totalCost: number;
  minPayout: number;
  maxPayout: number;
  conditionalMinHitPayout: number;
  conditionalMaxHitPayout: number;
  isUnconditionalFloorGuaranteed: boolean;
  unconditionalQuantiles: UnconditionalQuantiles;
  objectiveUnconditionalQuantiles?: UnconditionalQuantiles;
  likelyRange: [number, number];
  anyWinProb: number;
  zeroPayoutProb: number;
  partialLossProb: number;
  realProfitProb: number;
  strictNetGainProb: number;
  breakEvenProb: number;
  objectiveZeroPayoutProb?: number;
  objectivePartialLossProb?: number;
  objectiveBreakEvenProb?: number;
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
  selectionStatus?: SelectionLifecycleStatus;
  distributionStatus?: DistributionComputeStatus;
  basicExpandedCount?: number;
  logicalLineCount?: number;
  stakeUnitsCount?: number;
  physicalSlipCount?: number;
  betCountUnit?: "logical-lines" | "stake-units";
  estimatedOverCapCost?: number;
  physicalSlips?: TerminalPhysicalSlip[];
  zeroPayoutZeroHitProb?: number;
  zeroPayoutSubThresholdProb?: number;
  partialLossShortfall?: number;
  totalCapitalShortfallD?: number;
  breakevenCert?: BreakevenCertificate | null;
  singlePoolAlternatives?: Array<{
    poolCode: PoolCode;
    poolName: string;
    optionCount: number;
    minOdds: number;
    maxOdds: number;
  }>;
  crossPoolSingleAlternatives?: PartialCoveragePreview[];
  consolidatedTickets: number;
  syntheticHint: string | null;
  syntheticRescuePicks?: SelectedPick[] | null;
  syntheticAutoMounted?: boolean;
  syntheticModeUsed?: SyntheticSingleMode;
  syntheticEffectiveOdds?: number;
  syntheticBlindSpotProb?: number;
  syntheticBlindSpotLabel?: string | null;
  isExactSyntheticEquivalent?: boolean;
  syntheticOverCoverProb?: number;
  syntheticRetainedDirectionRatio?: number;
  partialCoveragePreview?: PartialCoveragePreview | null;
  trim2WayPreview?: PartialCoveragePreview | null;
  tickets?: ComboRow[];
  combos: ComboRow[];
  warnings: RadarWarning[];
}

export type EvaluatedTruthReport = TruthReport;

export type AuditedLegSource =
  | "manual-anchor"
  | "same-match-shield"
  | "cross-pool-substitute"
  | "bridge-mate";

export interface PlanLeg {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  poolCode: PoolCode;
  poolName: string;
  goalLine?: string;
  optionKey: string;
  optionLabel: string;
  odds: number;
  fairProb: number;
  legSource?: AuditedLegSource;
}

export interface PlanTicketLine {
  id: string;
  roleLabel: string;
  legs: PlanLeg[];
  modeLabel: string;
  multiple: number;
  cost: number;
  unitPayout: number;
  cappedClipped?: number;
  returnPayout: number;
  netProfit: number;
  prob: number;
}

export interface PartialCoveragePreview {
  poolCode: PoolCode;
  poolName: string;
  poolCodes?: PoolCode[];
  isCrossPoolMixed?: boolean;
  keptLegCount?: number;
  isExactEquivalent: boolean;
  requiresExplicitConfirm: boolean;
  confirmReason?: "partial-subset" | "over-budget-cap" | "partial-and-over-cap";
  authorizedCostCap?: number;
  retainedDirectionRatio: number;
  withinDirectionMissRatio: number;
  blindSpotProb: number;
  overCoverProb: number;
  blindSpotLabel: string | null;
  syntheticEffectiveOdds?: number;
  previewCost: number;
  previewBetCount: number;
  previewTicketCount: number;
  previewMinPayout: number;
  previewMaxPayout: number;
  previewLines: PlanTicketLine[];
  trim2WayLegCount?: number;
  trim2WayCost?: number;
  trim2WayRetainedDirectionRatio?: number;
  trim2WayWithinDirectionMissRatio?: number;
  trim2WayBlindSpotProb?: number;
  trim2WayLines?: PlanTicketLine[];
}

export type PortfolioRemediationActionKind =
  | "lower-pass-preview"
  | "min-feasible-budget"
  | "keep-cash"
  | "go-manual"
  | "switch-main-pool"
  | "save-cash-preview";

export interface PortfolioRemediationAction {
  id?: string;
  kind: PortfolioRemediationActionKind;
  slotKey?: ArchetypeKey;
  requiresSaveCashConfirm?: boolean;
  label: string;
  detail: string;
  structureLabel?: string;
  sourcePassSizes?: number[];
  targetPassSizes?: number[];
  isStrictAllLowerPass?: boolean;
  minFeasibleBudgetYuan?: number;
  isExactMinimumBudget?: boolean;
  previewCost?: number;
  savedCash?: number;
  strictNetGainProb?: number;
  zeroPayoutProb?: number;
  previewEvRate?: number;
  vigPct?: number;
  previewLines?: PlanTicketLine[];
  sourceQuoteInputSig?: string;
  sourceWorkspaceSig?: string;
  sourceBudgetYuan?: number;
  isExpandedShieldPreview?: boolean;
}

export interface ArchetypePlan {
  key: ArchetypeKey;
  available: boolean;
  slotTier?: "tier-1a" | "tier-1b" | "standard" | "alpha";
  optimalityStatus?:
    "domain-certified" | "library-certified" | "time-budget-best";
  coOptimalWithSlots?: PortfolioKey[];
  stanceOrderBadge?: string | null;
  alphaKind?: "positive-ev" | "none";
  emptyReason?: string | null;
  partialCoveragePreview?: PartialCoveragePreview | null;
  trim2WayPreview?: PartialCoveragePreview | null;
  structureBadge?: string | null;
  upperBoundBlocked?: boolean;
  theoreticalStrictNetGainCeiling?: number | null;
  remediationActions?: PortfolioRemediationAction[];
  shortTab: string;
  badge: string;
  title: string;
  tagline: string;
  totalCost: number;
  savedCash: number;
  stakeUnitsCount?: number;
  expectedLossVsCashYuan?: number;
  expectedNetVsCashYuan?: number;
  allowSaveCashEnabled?: boolean;
  minReturn: number;
  maxReturn: number;
  conditionalMinHitReturn?: number;
  winProb: number;
  profitProb: number;
  strictNetGainProb?: number;
  breakEvenProb?: number;
  partialLossProb?: number;
  partialLossShortfall?: number;
  totalCapitalShortfallD?: number;
  deepLossBelow50Prob?: number;
  sub80ReturnProb?: number;
  goldenBandProb?: number;
  verifiedSurviveMissCount?: number;
  expectedValueRate: number;
  objectiveEVRate?: number;
  objectiveProfitProb?: number;
  objectiveStrictNetGainProb?: number;
  subjectiveProjectedEVRate?: number | null;
  subjectiveProjectedProfitProb?: number | null;
  underwaterCount: number;
  logicalGroupCount?: number;
  physicalTicketCount?: number;
  physicalSlips?: TerminalPhysicalSlip[];
  bestObservedReturnPct?: number | null;
  alphaThresholdGapPct?: number | null;
  zeroPayoutProb?: number | null;
  wipeoutMiss2Prob?: number | null;
  missOneReturn: number | null;
  breakevenUpgradeCost?: number | null;
  breakevenCert?: BreakevenCertificate | null;
  bonusNoOpReason?: string | null;
  isExactOptimal?: boolean;
  capGuardAlternative?: CapGuardAlternative | null;
  requiresComboUnbundleConfirm?: boolean;
  consolidateTickets?: boolean;
  consolidatedLines?: PlanTicketLine[];
  quoteInputSig?: string;
  quoteBudgetYuan?: number;
  vigPct: number;
  reasons: string[];
  lines: PlanTicketLine[];
}

export interface AuditedSlipLeg extends SelectedPick {
  legSource: AuditedLegSource;
  legSourceLabel: string;
}

export interface AuditedMatchPoolGroup {
  poolCode: PoolCode;
  poolName: string;
  goalLine?: string;
  legs: AuditedSlipLeg[];
}

export interface AuditedSlipMatchEntry {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  kickoff: string;
  isManualPickedMatch: boolean;
  isBanker: boolean;
  pools: AuditedMatchPoolGroup[];
  legs: AuditedSlipLeg[];
}

export interface BudgetMismatchMeta {
  appliedBudgetYuan: number;
  currentBudgetYuan: number;
  bannerText: string;
}

export interface LivePortfolioQuoteState {
  quoteVersion: number;
  inputSig: string;
  computedInputSig: string;
  picksSig: string;
  budget: number;
  poolMatchIdsSig: string;
  anchorToRadarPicks: boolean;
  stance: UserStance;
  subjectiveDeltaPct: number;
  allowSaveCash: boolean;
  unlockFullAgg: boolean;
  passSpecSig: string;
  oddsSnapshotSig: string;
  isStale: boolean;
  canApplyLiveQuote: boolean;
}

export interface AppliedTicketSnapshot {
  key: ArchetypeKey;
  shortTab: string;
  appliedBudgetYuan: number;
  quoteInputSig: string;
  radarPickedMatchCount: number;
  radarPickedLegCount: number;
  manualAnchorLegCount: number;
  systemExpandedLegCount: number;
  legs: AuditedSlipLeg[];
  lines: PlanTicketLine[];
}

export interface ActiveAuditedSlip {
  revision?: number;
  sourceKind: "empty" | "manual" | "auto-synthetic" | "bonus-opt" | "archetype";
  isAppliedPlan: boolean;
  isArchetypePlan: boolean;
  isAutoSynthetic: boolean;
  matchIds: string[];
  matchCount: number;
  radarPickedMatchCount: number;
  radarPickedLegCount: number;
  manualAnchorLegCount: number;
  systemExpandedLegCount: number;
  totalLegCount: number;
  drawerTitle: string;
  revertActionLabel: string;
  matches: AuditedSlipMatchEntry[];
  legs: AuditedSlipLeg[];
  lines: PlanTicketLine[];
  physicalSlips?: TerminalPhysicalSlip[];
  budgetMismatchMeta: BudgetMismatchMeta | null;
}

export interface BridgeMatchPreview {
  matchId: string;
  matchNumStr: string;
  matchTitle: string;
  poolCode: PoolCode;
  poolName: string;
  optionKey: string;
  optionLabel: string;
  odds: number;
  addedMatchCount: number;
  addedLegCount: number;
  previewMatchCount: number;
  previewBetCount: number;
  multiple: number;
  previewTotalCost: number;
  summaryText: string;
}

export interface ConvertPlanToManualPreview {
  canConvert: boolean;
  blockedReason?: string;
  currentAppliedCost: number;
  previewMultiple: number;
  previewPassLabel: string;
  previewBetCount: number;
  previewTotalCost: number;
  addedLegs: SelectedPick[];
  trimmedCrossPoolLegs: SelectedPick[];
  previewPicks: SelectedPick[];
  summaryText: string;
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
  kickoffGapMinutes?: number;
  postFinishWindowMinutes?: number;
  hedgeCutoffText?: string;
  earlyEstimatedFinishText?: string;
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
  wholeSlipEquivalentSwaps?: EquivalentArbItem[];
  bridgeCandidates: BridgeMatchCandidate[];
}

export type AppliedPlanSpec =
  | null
  | {
      kind: "bonus";
      optMode: BonusOptMode;
      baseLines?: PlanTicketLine[];
      preserveExactBaseMultiples?: boolean;
      baseSourceKind?: "manual" | "auto-synthetic" | "bonus-opt" | "archetype";
      baseTitle?: string;
      boundSingleAuthId?: string;
      boundQuoteVersionSig?: string;
      boundLineAndMultipleSig?: string;
      allowPeakTradeoff?: boolean;
      allowCapEvTradeoff?: boolean;
      confirmedCapGuardSig?: string;
      scaleMultiple?: number;
      upgradeToBreakeven?: boolean;
      consolidateTickets?: boolean;
      targetBudgetCost?: number;
      allowUnbundleCombo?: boolean;
    }
  | {
      kind: "archetype";
      key: ArchetypeKey;
      snapshotPlan?: ArchetypePlan;
      appliedBudgetYuan?: number;
      planBudgetYuan?: number;
      quoteInputSig?: string;
      expectedQuoteInputSig?: string;
      appliedSubjectiveDeltaPct?: number;
      allowBudgetMismatchReadOnly?: boolean;
      appliedTicketSnapshot?: AppliedTicketSnapshot | null;
      scaleMultiple?: number;
      consolidateTickets?: boolean;
    };

export interface QuantWorkspaceParams {
  picks: SelectedPick[];
  multiple: number;
  passSpec?: PassSelectionSpec;
  syntheticSingleMode?: SyntheticSingleMode;
  singleAuthGrant?: SingleAuthGrant | null;
  subjectiveDeltaPct: number;
  simVoidFirstMatch: boolean;
  voidMatchIds?: string[];
  planSpec: AppliedPlanSpec;
  targetIds: string[];
  anchorToRadarPicks?: boolean;
  budget: number;
  stance: UserStance;
  unlockFullAgg: boolean;
  allowSaveCash?: boolean;
  quoteInputSig?: string;
  expectedQuoteInputSig?: string;
  expectedTotalCost?: number;
  expectedSlipLineSig?: string;
  enforceFreshQuoteSignature?: boolean;
  clientBoardQuoteVersion?: string;
  boardMeta?: BoardFreshnessMeta;
  clientAlerts?: Record<string, NonNullable<MatchItem["aiAlert"]>>;
}

export interface QuantWorkspaceResponse {
  baselineSlipLineSig?: string | null;
  manualReport: TruthReport;
  effectiveReport: TruthReport;
  baselineManualReport?: TruthReport;
  baselineReport?: TruthReport;
  baselineAppliedPlan?: ArchetypePlan | null;
  appliedPlan: ArchetypePlan | null;
  insights: ProOrderInsights;
  portfolioPlans: ArchetypePlan[];
  objectivePortfolioPlans?: ArchetypePlan[];
  fivePlans: ArchetypePlan[];
  subjectiveEVPct: number;
  allWarnings: RadarWarning[];
  quoteInputSig?: string;
  quoteRejectedReason?: string | null;
  boardMeta?: BoardFreshnessMeta;
  refreshedMatches?: MatchItem[];
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
  isEmptySlip: true,
  totalCost: 0,
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
  dangerScore: 0,
  effectiveOdds: 0,
  breakevenUpgradeCost: null,
  selectionStatus: "empty",
  distributionStatus: "none",
  basicExpandedCount: 0,
  logicalLineCount: 0,
  stakeUnitsCount: 0,
  physicalSlipCount: 0,
  physicalSlips: [],
  zeroPayoutZeroHitProb: 0,
  zeroPayoutSubThresholdProb: 0,
  partialLossShortfall: 0,
  totalCapitalShortfallD: 0,
  breakevenCert: null,
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
