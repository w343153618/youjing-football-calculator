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
  type BoardFreshnessMeta,
  type BonusOptMode,
  type BridgeMatchCandidate,
  type BridgeMatchPreview,
  type BudgetMismatchMeta,
  type CapGuardAlternative,
  type ComboRow,
  type ConvertPlanToManualPreview,
  type EquivalentArbItem,
  type LedgerTicketSnapshot,
  type LivePortfolioQuoteState,
  type MatchItem,
  type PartialCoveragePreview,
  type PassIntentMode,
  type PassSelectionSpec,
  type PlanLeg,
  type PlanTicketLine,
  type PoolCode,
  type PortfolioKey,
  type PortfolioRemediationAction,
  type QuantWorkspaceParams,
  type QuantWorkspaceResponse,
  type SandboxSimSpec,
  type SelectedPick,
  type SingleAuthGrant,
  type SyntheticSingleMode,
  type TerminalPhysicalSlip,
  type TerminalPhysicalSlipLegGroup,
  type TruthReport,
  type UserStance,
  type XiaoGaoAlertBinding,
} from "../prototype/quantTypes.ts";
import {
  isFreshTicketBoard,
  isTicketLineSaleConfirmed,
} from "../../server/ticketSaleRights.mjs";
import { getPhysicalTicketBlockReason } from "./ticketExport.ts";
import {
  computeOrderedMatchIdentitySig,
  hashString32Base36,
  orderedMatchKey,
} from "../../server/matchIdentity.mjs";

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

export interface ManualDraftState {
  schemaVersion: 1;
  revision: number;
  picks: SelectedPick[];
  multiple: number;
  passSpec: PassSelectionSpec;
  budget: number;
  stance: UserStance;
  allowSaveCash: boolean;
  passRuleBlockReason: string | null;
}

export interface PortfolioQuoteState extends LivePortfolioQuoteState {
  plans: ArchetypePlan[];
  objectivePlans: ArchetypePlan[];
}

export interface ToggleBankerPreview {
  ok: boolean;
  canToggle: boolean;
  isBanker: boolean;
  passOrderChanged: boolean;
  requiresConfirm: boolean;
  beforeLabel: string;
  afterLabel: string;
  beforeBetCount: number;
  afterBetCount: number;
  beforeCost: number;
  afterCost: number;
  targetPassSpec: PassSelectionSpec;
  promptText: string;
  reason?: string;
}

export interface SwitchMainPoolDiffItem {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  fromPicks: SelectedPick[];
  toPicks: SelectedPick[];
  changed: boolean;
  isDirectionlessFallback: boolean;
  usedHandicapMapping: boolean;
  note: string;
}

export interface SwitchMainPoolPreview {
  canSwitch: boolean;
  changedMatchCount: number;
  hasDirectionlessFallback: boolean;
  items: SwitchMainPoolDiffItem[];
  nextPicks: SelectedPick[];
  beforePassLabel?: string;
  afterPassLabel?: string;
  beforeBetCount?: number;
  afterBetCount?: number;
  beforeTotalCost?: number;
  afterTotalCost?: number;
  summaryText: string;
}

export interface PortfolioRemediationPreview {
  kind: PortfolioRemediationAction["kind"];
  actionLabel: string;
  summaryText: string;
  isStrictAllLowerPass: boolean;
  currentPassLabel: string;
  targetPassSizes: number[];
  targetPassLabel: string;
  currentSlipCost: number;
  previewCost: number | null;
  canApplyPreviewPlanAtomically: boolean;
  switchMainPoolPreview: SwitchMainPoolPreview | null;
  keepCashHasActiveSlip: boolean;
}

export interface EquivalentSwapPreview {
  ok: boolean;
  blockedReason?: string;
  nextPicks: SelectedPick[];
  preservedOtherPicks: SelectedPick[];
  originalMultiple: number;
  targetBudgetCost: number;
}

export interface PlayabilityGates {
  shopkeeperBlockReason: string | null;
  isSingleNonSingleContext: boolean;
  isSyntheticPlayable: boolean;
  hasSyntheticInherentBlindSpot: boolean;
  canTrimSynthetic2Way: boolean;
  partialCoveragePreview: PartialCoveragePreview | null;
  manualBonusLineCount: number;
  activeBonusLineCount: number;
  isBonusOver512: boolean;
  isBonusOptDisabled: boolean;
  activeBankerSet: Set<string>;
  canToggleBanker: boolean;
  canToggleBankerMatch: (matchId: string) => boolean;
  passRuleBlockReason: string | null;
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

const CLIENT_STATUTORY_COMBO_PASS_SIZES: Record<string, number[]> = {
  "3x3": [2],
  "3x4": [2, 3],
  "4x4": [3],
  "4x5": [3, 4],
  "4x6": [2],
  "4x11": [2, 3, 4],
  "5x5": [4],
  "5x6": [4, 5],
  "5x10": [2],
  "5x16": [3, 4, 5],
  "5x20": [2, 3],
  "5x26": [2, 3, 4, 5],
  "6x6": [5],
  "6x7": [5, 6],
  "6x15": [2],
  "6x20": [3],
  "6x22": [4, 5, 6],
  "6x35": [2, 3],
  "6x42": [3, 4, 5, 6],
  "6x50": [2, 3, 4],
  "6x57": [2, 3, 4, 5, 6],
  "7x7": [6],
  "7x8": [6, 7],
  "7x21": [5],
  "7x35": [4],
  "7x120": [2, 3, 4, 5, 6, 7],
  "8x8": [7],
  "8x9": [7, 8],
  "8x28": [6],
  "8x56": [5],
  "8x70": [4],
  "8x247": [2, 3, 4, 5, 6, 7, 8],
};

function binomInt(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let c = 1;
  const kk = Math.min(k, n - k);
  for (let i = 1; i <= kk; i++) {
    c = Math.round((c * (n - kk + i)) / i);
  }
  return c;
}

export function isFollowMaxParlayMode(mode?: PassIntentMode | string): boolean {
  return !mode || mode === "auto" || mode === "follow-max-parlay";
}

function resolveComboRequiredMatchCount(
  comboCode?: string | null
): number | null {
  if (!comboCode) return null;
  const m = String(comboCode).match(/^(\d+)x\d+$/i);
  return m ? Number(m[1]) : null;
}

export function dedupeRepeatedDotTokens(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(/\s*\u00b7\s*/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.includes(p)) continue;
    const parenUpgradeIdx = out.findIndex(
      (prev) => p.startsWith(`${prev}(`) || p.startsWith(`${prev}\uff08`)
    );
    if (parenUpgradeIdx >= 0) {
      out[parenUpgradeIdx] = p;
      continue;
    }
    if (
      p.length >= 4 &&
      out.some((prev) => prev.length > p.length && prev.includes(p))
    ) {
      continue;
    }
    out.push(p);
  }
  return out.join(" \u00b7 ");
}

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

export function buildMatchIntelDigest(
  match: MatchItem,
  nowMs: number = Date.now()
): MatchIntelDigest {
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
  const gNum =
    typeof mq.handicapGoalLine === "number" &&
    Number.isFinite(mq.handicapGoalLine)
      ? mq.handicapGoalLine
      : Number(goalLine) || -1;
  const absG = Math.max(1, Math.abs(Math.round(gNum)) || 1);
  const favCoverLbl = mq.favoriteCoverLabel ?? (gNum < 0 ? "让胜" : "让负");
  const underdogHoldLbl = mq.underdogHoldLabel ?? (gNum < 0 ? "让负" : "让胜");
  const rawOneGoal = Number.isFinite(Number(mq.oneGoalShareOfWins))
    ? Number(mq.oneGoalShareOfWins)
    : 0;
  const sharePct = Math.round(rawOneGoal <= 1 ? rawOneGoal * 100 : rawOneGoal);
  const exactPushRaw =
    typeof mq.favoriteExactPushShareOfWins === "number" &&
    Number.isFinite(mq.favoriteExactPushShareOfWins)
      ? mq.favoriteExactPushShareOfWins
      : absG === 1
        ? rawOneGoal
        : null;
  const exactPushPct =
    exactPushRaw !== null
      ? Math.round(exactPushRaw <= 1 ? exactPushRaw * 100 : exactPushRaw)
      : null;
  const trueCoverRaw =
    typeof mq.favoriteTrueCoverShareOfWins === "number" &&
    Number.isFinite(mq.favoriteTrueCoverShareOfWins)
      ? mq.favoriteTrueCoverShareOfWins
      : absG === 1 && exactPushPct !== null
        ? Math.max(0, 1 - exactPushPct / 100)
        : null;
  const trueCoverPct =
    trueCoverRaw !== null
      ? Math.round(trueCoverRaw <= 1 ? trueCoverRaw * 100 : trueCoverRaw)
      : null;
  const hhadImpact =
    absG >= 2
      ? trueCoverPct !== null && exactPushPct !== null
        ? `让球[${goalLine}]深盘评估：热门方赢球条件下真穿盘${favCoverLbl}（净胜>${absG}球）占 ${trueCoverPct}%，恰好净胜${absG}球（让球平）占 ${exactPushPct}%，慎防把让球平混入穿盘`
        : `让球[${goalLine}]深盘评估：热门方赢球时仅净胜1球占 ${sharePct}%，追${favCoverLbl}须净胜>${absG}球，宜关注${underdogHoldLbl}受让防线`
      : sharePct >= 46
        ? `让球[${goalLine}]高危预警：热门方赢球时仅净胜1球（让球平）占比达 ${sharePct}%${
            trueCoverPct !== null
              ? `（真穿盘${favCoverLbl}仅 ${trueCoverPct}%）`
              : ""
          }，慎追${favCoverLbl}穿盘，宜防让球平或看${underdogHoldLbl}`
        : `让球[${goalLine}]盘口评估：热门方赢球时卡1球占比 ${sharePct}%${
            trueCoverPct !== null
              ? `（真穿盘${favCoverLbl} ${trueCoverPct}%）`
              : ""
          }，结合水位决定是否补防让球平`;
  const normalizedCardPanTip =
    gNum > 0 && typeof mq.cardPanTip === "string"
      ? mq.cardPanTip.split("慎追让胜穿盘").join("慎追让负穿盘")
      : mq.cardPanTip;

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
      tip: normalizedCardPanTip,
    },
    alphaSummary: mq.alphaScanSummary,
    poolImpacts: {
      had: hadImpact,
      hhad: hhadImpact,
      ttg: ttgImpact,
    },
    arbitrages: mq.arbitrages ?? [],
    aiAlert:
      match.aiAlert &&
      isClientMatchAlertBindingValid(match.aiAlert, match, nowMs)
        ? match.aiAlert
        : null,
  };
}

export interface PoolSwitchUndoSnapshot {
  picks: SelectedPick[];
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
  planBoard?: MatchItem[];
  planHoldRev?: number;
  backgroundEdit?: boolean;
  multiple?: number;
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  replacedPoolName: string;
  replacedCount: number;
  nextPoolName: string;
  nextOptionLabel: string;
}

export interface SyntheticChoiceQuote {
  referenceOnly: boolean;
  rows: Array<{
    matchId: string;
    matchNumStr: string;
    home: string;
    away: string;
    poolName: string;
    optionLabel: string;
    odds: number;
    multiple: number;
    cost: number;
  }>;
  coverageLabel: string;
  mode: SyntheticSingleMode;
  signature: string;
  label: string;
  cost: number;
}

interface SyntheticTicketApproval {
  referenceOnly?: boolean;
  signature: string;
  matchId: string;
  scope: string;
  mode: SyntheticSingleMode;
  grant?: SingleAuthGrant;
  plan?: Extract<NonNullable<AppliedPlanSpec>, { kind: "bonus" }>;
}

export interface BetSlipState {
  matches: MatchItem[];
  picks: SelectedPick[];
  manualDraftPicks: SelectedPick[];
  manualDraft: ManualDraftState;
  portfolioQuote: PortfolioQuoteState;
  activeSlip: ActiveAuditedSlip;
  sandboxSim: SandboxSimSpec;
  mode: MatchMode;
  multiple: number;
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
  appliedTicketSnapshot: AppliedTicketSnapshot | null;
  livePortfolioQuote: LivePortfolioQuoteState;
  activeAuditedSlip: ActiveAuditedSlip;
  syntheticSingleMode: SyntheticSingleMode;
  singleAuthGrant: SingleAuthGrant | null;
  lastPoolSwitchUndo: PoolSwitchUndoSnapshot | null;
  subjectiveDeltaPct: number;
  simVoidFirstMatch: boolean;
  voidMatchIds: string[];
  draftRestoredNotice: string | null;
  pendingRevokedPlanConfirm?: string | null;
  pendingSyntheticChoice?: { quote: SyntheticChoiceQuote | null } | null;
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

export const CLIENT_XIAOGAO_ALERT_TTL_MS = 30 * 60_000;

export function computeClientMatchAlertBinding(
  match: MatchItem,
  analyzedAt = Date.now()
): XiaoGaoAlertBinding {
  const poolOrder: PoolCode[] = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  const maskParts: string[] = [];
  const quoteParts: string[] = [];
  for (const code of poolOrder) {
    const pool = match.pools?.[code];
    const validOpts =
      pool && pool.selling !== false && Array.isArray(pool.options)
        ? pool.options.filter(
            (o) => Number.isFinite(Number(o.odds)) && Number(o.odds) > 1
          )
        : [];
    const isOpen = validOpts.length > 0;
    const canSingle = isOpen && Boolean(pool?.canSingle ?? pool?.single);
    const canAllUp = isOpen && pool?.canAllUp !== false;
    maskParts.push(
      isOpen ? `${code}:${canSingle ? 1 : 0}${canAllUp ? 1 : 0}` : `${code}:00`
    );
    if (!isOpen) {
      quoteParts.push(`${code}:-`);
      continue;
    }
    const gl = code === "HHAD" ? String(pool?.goalLine ?? "").trim() : "";
    const optsSig = validOpts
      .map((o) => `${String(o.key)}:${Number(o.odds).toFixed(4)}`)
      .sort()
      .join(",");
    quoteParts.push(`${code}[${gl}](${optsSig})`);
  }
  return {
    matchId: String(match.id ?? "").trim(),
    activePoolsMask: maskParts.join("|"),
    hhadGoalLine: String(match.pools?.HHAD?.goalLine ?? "").trim(),
    quoteVersionSig: quoteParts.join("|"),
    analyzedAt,
  };
}

export function isClientMatchAlertBindingValid(
  alert: MatchItem["aiAlert"] | undefined,
  match: MatchItem,
  nowMs = Date.now(),
  ttlMs = CLIENT_XIAOGAO_ALERT_TTL_MS
): boolean {
  if (!alert) return false;
  const b = alert.binding;
  if (!b) return true;
  if (String(b.matchId).trim() !== String(match.id ?? "").trim()) return false;
  if (
    typeof b.analyzedAt !== "number" ||
    !Number.isFinite(b.analyzedAt) ||
    nowMs - b.analyzedAt > ttlMs
  ) {
    return false;
  }
  const cur = computeClientMatchAlertBinding(match, nowMs);
  return (
    b.activePoolsMask === cur.activePoolsMask &&
    b.hhadGoalLine === cur.hhadGoalLine &&
    b.quoteVersionSig === cur.quoteVersionSig
  );
}

export interface BetSlipStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  getBackingTarget?(): object;
}

interface SharedAccountHoldRecord {
  holdRev: number;
  holdClearedRev: number;
  clearSeq: number;
  writeSeq: number;
  holdClearedDraftHash: string | null;
  lastHoldReason: string | null;
  pendingRevokedPlanConfirm: string | null;
}

const SHARED_ACCOUNT_HOLD_BUS = new WeakMap<
  object,
  Map<string, SharedAccountHoldRecord>
>();

function verifySavedPickMatchIdentity(
  fm: MatchItem | undefined,
  pk: {
    matchId: string;
    home?: string;
    away?: string;
    th?: string;
  }
): fm is MatchItem {
  if (!fm || fm.id !== pk.matchId) return false;
  const hasExplicitNames = Boolean(
    typeof pk.home === "string" &&
    pk.home.trim() &&
    typeof pk.away === "string" &&
    pk.away.trim()
  );
  const savedHash = typeof pk.th === "string" ? pk.th.trim() : "";
  if (!hasExplicitNames && !savedHash) return false;
  if (hasExplicitNames) {
    if (fm.home !== pk.home || fm.away !== pk.away) return false;
  }
  if (savedHash) {
    const useIds = savedHash.startsWith("i");
    if (savedHash !== computeOrderedMatchIdentitySig(fm, useIds)) {
      return false;
    }
  }
  return true;
}

function computeManualTicketDraftHash(
  picks: SelectedPick[],
  multiple: number,
  passSpec: PassSelectionSpec,
  matches: MatchItem[],
  syntheticSingleMode: SyntheticSingleMode = "full-3way"
): string {
  if (picks.length === 0) return "empty";
  const byId = new Map(matches.map((m) => [m.id, m]));
  const synSuffix = syntheticSingleMode === "off" ? "|sm=off" : "";
  const pickTokens = picks
    .map((pk) => {
      const fm = byId.get(pk.matchId);
      const gl =
        pk.poolCode === "HHAD"
          ? String(pk.goalLine ?? fm?.pools?.HHAD?.goalLine ?? "").trim()
          : "";
      const teamSig = computeOrderedMatchIdentitySig(
        fm ?? pk,
        Boolean(fm?.homeTeamId || fm?.awayTeamId)
      );
      return `${pk.matchId}:${teamSig}:${pk.poolCode}:${pk.optionKey}:${gl}`;
    })
    .sort()
    .join(",");
  const normPass = sanitizePassSpecForPicks(passSpec, picks);
  const passSig =
    normPass.mode === "combo"
      ? `c:${normPass.comboCode ?? ""}`
      : normPass.mode === "free"
        ? `f:${(normPass.passSizes ?? [])
            .slice()
            .sort((a, b) => a - b)
            .join(
              "."
            )}:b=${(normPass.bankerMatchIds ?? []).slice().sort().join(".")}`
        : normPass.mode;
  return hashString32Base36(
    `${pickTokens}|m=${multiple}|ps=${passSig}${synSuffix}`
  );
}

const CURRENT_DRAFT_SCHEMA = 4;
const LEGACY_SINGLE_CONFIRMATION =
  "检测到升级前保存的非单关单场草稿，请确认按合成单关核对或切换『搭1场过桥凑2串1』后再出票";

function isSupportedDraftSchema(version: number | undefined): boolean {
  return (
    version === 1 ||
    version === 2 ||
    version === 3 ||
    version === CURRENT_DRAFT_SCHEMA
  );
}

function draftNeedsSyntheticChoice(draft: {
  schemaVersion?: number;
  lu?: number | boolean;
  so?: number | boolean;
}): boolean {
  // Older writers could promote a draft after losing its off selection.
  // A hold acknowledgement, write counter or capture time is not a mode choice.
  if (draft.so) return false;
  if (draft.lu) return true;
  return draft.schemaVersion !== CURRENT_DRAFT_SCHEMA;
}

function readSyntheticApproval(
  version: number | undefined,
  value: unknown
): SyntheticTicketApproval | null {
  if (version !== CURRENT_DRAFT_SCHEMA || !value || typeof value !== "object")
    return null;
  const record = value as SyntheticTicketApproval;
  if (
    typeof record.signature !== "string" ||
    !record.signature ||
    typeof record.scope !== "string" ||
    typeof record.matchId !== "string" ||
    !["full-3way", "partial-cover", "trim-2way"].includes(record.mode)
  )
    return null;
  // Only an explicitly priced single may restore a quote instruction.
  if (
    record.plan &&
    (record.plan.kind !== "bonus" ||
      record.plan.baseSourceKind !== "auto-synthetic" ||
      !record.plan.boundSingleAuthId)
  )
    return null;
  if (
    record.grant &&
    (record.grant.matchId !== record.matchId ||
      record.grant.mode !== record.mode)
  )
    return null;
  return record;
}

function syntheticApprovalScope(
  s: BetSlipState,
  matchId: string
): string | null {
  const match = s.matches.find((item) => item.id === matchId);
  const selections = s.picks.filter((pick) => pick.matchId === matchId);
  if (!match || !selections.length) return null;
  const anchors = selections
    .map((p) => [p.poolCode, p.optionKey, p.goalLine ?? ""])
    .sort();
  return JSON.stringify([
    matchId,
    match.home,
    match.away,
    match.homeTeamId ?? "",
    match.awayTeamId ?? "",
    s.multiple,
    anchors,
    computeSingleMatchQuoteVersionSig(match),
  ]);
}

function singleRequiresSynthetic(picks: SelectedPick[]): boolean {
  return (
    picks.length > 0 &&
    picks.every((p) => p.matchId === picks[0].matchId) &&
    picks.some((p) => !p.canSingle)
  );
}

function computeStoredParsedDraftHash(parsed: {
  picks?: Array<{
    matchId?: string;
    home?: string;
    away?: string;
    th?: string;
    poolCode?: PoolCode;
    optionKey?: string;
    savedGoalLine?: string;
    goalLine?: string;
  }>;
  multiple?: number;
  passSpec?: PassSelectionSpec;
  so?: number | boolean;
}): string | null {
  if (!Array.isArray(parsed.picks)) return null;
  if (parsed.picks.length === 0) return "empty";
  const mult = Math.max(
    1,
    Math.min(999, Math.round(Number(parsed.multiple) || 5))
  );
  const rawPass: PassSelectionSpec = parsed.passSpec ?? {
    mode: "follow-max-parlay",
  };
  const synSuffix = parsed.so ? "|sm=off" : "";
  const pseudoPicks = parsed.picks.map((p) => ({
    matchId: String(p.matchId ?? ""),
    poolCode: (p.poolCode ?? "HAD") as PoolCode,
    optionKey: String(p.optionKey ?? ""),
  })) as SelectedPick[];
  const normPass = sanitizePassSpecForPicks(rawPass, pseudoPicks);
  const passSig =
    normPass.mode === "combo"
      ? `c:${normPass.comboCode ?? ""}`
      : normPass.mode === "free"
        ? `f:${(normPass.passSizes ?? [])
            .slice()
            .sort((a, b) => a - b)
            .join(
              "."
            )}:b=${(normPass.bankerMatchIds ?? []).slice().sort().join(".")}`
        : normPass.mode;
  const pickTokens = parsed.picks
    .map((pk) => {
      const gl =
        pk.poolCode === "HHAD"
          ? String(pk.savedGoalLine ?? pk.goalLine ?? "").trim()
          : "";
      const teamSig =
        typeof pk.th === "string" && pk.th.trim()
          ? pk.th.trim()
          : computeOrderedMatchIdentitySig(pk, false);
      return `${String(pk.matchId ?? "")}:${teamSig}:${String(pk.poolCode ?? "")}:${String(pk.optionKey ?? "")}:${gl}`;
    })
    .sort()
    .join(",");
  return hashString32Base36(
    `${pickTokens}|m=${mult}|ps=${passSig}${synSuffix}`
  );
}

function computeLegacyR10AutoDraftHash(parsed: {
  picks?: Array<{
    matchId?: string;
    home?: string;
    away?: string;
    th?: string;
    poolCode?: PoolCode;
    optionKey?: string;
    savedGoalLine?: string;
    goalLine?: string;
  }>;
  multiple?: number;
  passSpec?: PassSelectionSpec;
}): string | null {
  if (!Array.isArray(parsed.picks) || parsed.picks.length === 0) return null;
  const mult = Math.max(
    1,
    Math.min(999, Math.round(Number(parsed.multiple) || 5))
  );
  const rawPass: PassSelectionSpec = parsed.passSpec ?? {
    mode: "follow-max-parlay",
  };
  const pseudoPicks = parsed.picks.map((p) => ({
    matchId: String(p.matchId ?? ""),
    poolCode: (p.poolCode ?? "HAD") as PoolCode,
    optionKey: String(p.optionKey ?? ""),
  })) as SelectedPick[];
  const normPass = sanitizePassSpecForPicks(rawPass, pseudoPicks);
  const passSig =
    normPass.mode === "combo"
      ? `c:${normPass.comboCode ?? ""}`
      : normPass.mode === "free"
        ? `f:${(normPass.passSizes ?? [])
            .slice()
            .sort((a, b) => a - b)
            .join(
              "."
            )}:b=${(normPass.bankerMatchIds ?? []).slice().sort().join(".")}`
        : normPass.mode;
  const pickTokens = parsed.picks
    .map((pk) => {
      const gl =
        pk.poolCode === "HHAD"
          ? String(pk.savedGoalLine ?? pk.goalLine ?? "").trim()
          : "";
      const teamSig =
        typeof pk.th === "string" && pk.th.trim()
          ? pk.th.trim()
          : computeOrderedMatchIdentitySig(pk, false);
      return `${String(pk.matchId ?? "")}:${teamSig}:${String(pk.poolCode ?? "")}:${String(pk.optionKey ?? "")}:${gl}`;
    })
    .sort()
    .join(",");
  return hashString32Base36(`${pickTokens}|m=${mult}|ps=${passSig}|sm=auto`);
}

export interface BetSlipControllerOptions {
  computeWorkspace: (
    params: QuantWorkspaceParams,
    matches: MatchItem[]
  ) => QuantWorkspaceResponse | Promise<QuantWorkspaceResponse>;
  debounceMs?: number;
  autoSyncRadar?: boolean;
  nowFn?: () => number;
  storagePort?: BetSlipStoragePort;
  getAccountId?: () => string | null;
  isOffline?: () => boolean;
  onOfflineNetworkError?: () => void;
  onComputeSuccess?: (ws: QuantWorkspaceResponse) => void;
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

function resolveOptionalGoalLine(
  poolCode: PoolCode,
  pool?: MatchItem["pools"][PoolCode],
  fallbackGoalLine?: string
): { goalLine?: string } {
  if (poolCode !== "HHAD") {
    return {};
  }
  if (pool?.goalLine !== undefined && String(pool.goalLine).trim() !== "") {
    return { goalLine: String(pool.goalLine).trim() };
  }
  if (
    fallbackGoalLine !== undefined &&
    String(fallbackGoalLine).trim() !== ""
  ) {
    return { goalLine: String(fallbackGoalLine).trim() };
  }
  if (pool?.goalLine !== undefined) {
    return { goalLine: String(pool.goalLine).trim() };
  }
  return {};
}

function enrichPicksWithBoardGoalLine(
  picks: SelectedPick[],
  matches: MatchItem[]
): SelectedPick[] {
  if (!Array.isArray(picks) || picks.length === 0) return [];
  const byId = new Map(matches.map((m) => [m.id, m]));
  return picks.map((pk) => {
    const fm = byId.get(pk.matchId);
    const th =
      typeof pk.th === "string" && pk.th.trim()
        ? pk.th.trim()
        : fm
          ? computeOrderedMatchIdentitySig(
              fm,
              Boolean(fm.homeTeamId || fm.awayTeamId)
            )
          : undefined;
    const pool = fm?.pools?.[pk.poolCode];
    const gl =
      pk.goalLine !== undefined
        ? {}
        : resolveOptionalGoalLine(pk.poolCode, pool);
    return {
      ...pk,
      ...(th ? { th } : {}),
      ...gl,
    };
  });
}

function isStrictSameMatchIdentity(
  fm: MatchItem | undefined,
  pk: { matchId: string; home?: string; away?: string; th?: string },
  prevBoardMatch?: MatchItem
): fm is MatchItem {
  if (!fm || fm.id !== pk.matchId) return false;
  if (pk.home && fm.home && fm.home !== pk.home) return false;
  if (pk.away && fm.away && fm.away !== pk.away) return false;
  const savedHash =
    (typeof pk.th === "string" && pk.th.trim() ? pk.th.trim() : "") ||
    (prevBoardMatch
      ? computeOrderedMatchIdentitySig(
          prevBoardMatch,
          Boolean(prevBoardMatch.homeTeamId || prevBoardMatch.awayTeamId)
        )
      : "");
  if (savedHash) {
    const useIds = savedHash.startsWith("i");
    if (savedHash !== computeOrderedMatchIdentitySig(fm, useIds)) {
      return false;
    }
  }
  return true;
}

function sanitizePassSpecForPicks(
  passSpec: PassSelectionSpec,
  nextPicks: SelectedPick[]
): PassSelectionSpec {
  const distinctIds = Array.from(new Set(nextPicks.map((p) => p.matchId)));
  if (distinctIds.length === 0) {
    return { mode: "follow-max-parlay" };
  }
  if (!passSpec) {
    return { mode: "follow-max-parlay" };
  }
  if (passSpec.mode === "combo") {
    return { mode: "combo", comboCode: passSpec.comboCode };
  }
  const rawBankers = Array.isArray(passSpec.bankerMatchIds)
    ? Array.from(
        new Set(
          passSpec.bankerMatchIds.filter(
            (id) => typeof id === "string" && id.length > 0
          )
        )
      )
    : [];
  if (isFollowMaxParlayMode(passSpec.mode)) {
    return rawBankers.length > 0
      ? {
          mode: "free",
          passSizes: [Math.max(2, Math.min(8, distinctIds.length - 1))],
          bankerMatchIds: rawBankers,
        }
      : { mode: "follow-max-parlay" };
  }
  const hasNonSinglePick = nextPicks.some(
    (p) => !(p.canSingle ?? p.singleAllowed)
  );
  if (
    rawBankers.length === 0 &&
    passSpec.mode === "free" &&
    Array.isArray(passSpec.passSizes) &&
    passSpec.passSizes.length === 1 &&
    passSpec.passSizes[0] === 1 &&
    distinctIds.length >= 2 &&
    hasNonSinglePick
  ) {
    return { mode: "follow-max-parlay" };
  }
  const cleanSizes = Array.from(
    new Set(
      (passSpec.passSizes ?? [])
        .map(Number)
        .filter((s) => Number.isFinite(s) && s >= 1 && s <= 8)
    )
  ).sort((a, b) => a - b);
  if (cleanSizes.length === 0 && rawBankers.length === 0) {
    return { mode: "follow-max-parlay" };
  }
  return {
    mode: "free",
    passSizes:
      cleanSizes.length > 0
        ? cleanSizes
        : [Math.max(2, Math.min(8, distinctIds.length))],
    ...(rawBankers.length > 0 ? { bankerMatchIds: rawBankers } : {}),
  };
}

function computePassRuleBlockReason(
  passSpec: PassSelectionSpec,
  picks: SelectedPick[]
): string | null {
  const distinctIds = Array.from(new Set(picks.map((p) => p.matchId)));
  if (distinctIds.length === 0 || !passSpec) return null;
  if (
    Array.isArray(passSpec.bankerMatchIds) &&
    passSpec.bankerMatchIds.length > 0 &&
    distinctIds.length >= 1
  ) {
    const missingBankers = passSpec.bankerMatchIds.filter(
      (id) => !distinctIds.includes(id)
    );
    if (missingBankers.length > 0) {
      return "已移除设胆场次，原胆拖约束已失效；请确认解除胆码改用普通自由过关或重新设胆";
    }
  }
  if (passSpec.mode === "combo" && passSpec.comboCode) {
    const reqM = resolveComboRequiredMatchCount(passSpec.comboCode);
    if (reqM !== null && distinctIds.length !== reqM) {
      return `显式锁定的【${passSpec.comboCode.replace("x", "串")}】仅适用于 ${reqM} 场对阵，当前已选 ${distinctIds.length} 场（请调整场数或一键切换过关）`;
    }
  }
  if (
    passSpec.mode === "free" &&
    Array.isArray(passSpec.passSizes) &&
    passSpec.passSizes.length > 0
  ) {
    let minPoolCap = 8;
    for (const p of picks) {
      minPoolCap = Math.min(
        minPoolCap,
        CLIENT_STATUTORY_POOL_MAX_PASS[p.poolCode] ?? 8
      );
    }
    const maxCap = Math.min(8, minPoolCap, distinctIds.length);
    const valid = passSpec.passSizes.filter((s) => s >= 1 && s <= maxCap);
    if (valid.length === 0) {
      return `当前显式锁定的过关阶数（${passSpec.passSizes.join("/")}关）超出已选 ${distinctIds.length} 场或玩法最高 ${minPoolCap} 关上限`;
    }
  }
  return null;
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
    if (!ps || isFollowMaxParlayMode(ps.mode)) return "auto";
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

  const targetIdList = Array.isArray(s.targetIds) ? s.targetIds : [];
  const foundTargets = s.matches.filter((m) => targetIdList.includes(m.id));
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
      const match = matchMap.get(lg.matchId);
      return {
        ...lg,
        ...(match ? { th: computeOrderedMatchIdentitySig(match) } : {}),
        legSource,
      };
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

function stripSubjectiveDeltaFromQuoteSig(sig?: string | null): string {
  if (!sig) return "";
  return sig.replace(/\|sd=-?\d+\|/g, "|");
}

export function consolidateTerminalPhysicalSlips(
  report: TruthReport,
  appliedPlan: ArchetypePlan | null | undefined,
  matches: MatchItem[],
  defaultMultiple: number,
  bankerSet: Set<string> = new Set(),
  options?: { consolidate?: boolean }
): TerminalPhysicalSlip[] {
  const shouldConsolidate = options?.consolidate !== false;
  if (
    shouldConsolidate &&
    Array.isArray(report.physicalSlips) &&
    report.physicalSlips.length > 0
  ) {
    return report.physicalSlips;
  }
  if (
    shouldConsolidate &&
    appliedPlan &&
    Array.isArray(appliedPlan.physicalSlips) &&
    appliedPlan.physicalSlips.length > 0
  ) {
    return appliedPlan.physicalSlips;
  }
  const matchMap = new Map(matches.map((m) => [m.id, m]));
  const boardIndex = new Map(matches.map((m, idx) => [m.id, idx]));

  interface BasicChunkLine {
    id: string;
    modeLabel: string;
    passSize: number;
    multiple: number;
    legs: Array<{
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
    }>;
  }

  const rawLines: Array<{
    id: string;
    modeLabel: string;
    multiple: number;
    legs: BasicChunkLine["legs"];
  }> = [];

  if (
    appliedPlan &&
    Array.isArray(appliedPlan.lines) &&
    appliedPlan.lines.length > 0
  ) {
    for (let i = 0; i < appliedPlan.lines.length; i++) {
      const ln = appliedPlan.lines[i];
      const legs = (ln.legs ?? [])
        .map((lg) => {
          const fm = matchMap.get(lg.matchId);
          return {
            matchId: lg.matchId,
            matchNumStr: fm?.matchNumStr || lg.matchNumStr,
            home: fm?.home || lg.home,
            away: fm?.away || lg.away,
            kickoff: fm?.kickoff || lg.kickoff || "",
            poolCode: lg.poolCode,
            poolName: fm?.pools?.[lg.poolCode]?.name || lg.poolName,
            goalLine: lg.poolCode === "HHAD" ? lg.goalLine : undefined,
            optionKey: lg.optionKey,
            optionLabel: lg.optionLabel,
            odds: lg.odds,
          };
        })
        .sort(
          (a, b) =>
            (boardIndex.get(a.matchId) ?? 9999) -
            (boardIndex.get(b.matchId) ?? 9999)
        );
      if (legs.length === 0) continue;
      rawLines.push({
        id: ln.id || `ln_${i + 1}`,
        modeLabel:
          ln.modeLabel || (legs.length === 1 ? "单关" : `${legs.length}串1`),
        multiple: Math.max(1, Math.round(ln.multiple || 1)),
        legs,
      });
    }
  } else if (Array.isArray(report.tickets) && report.tickets.length > 0) {
    const fallbackMult = Math.max(
      1,
      Math.round(defaultMultiple || report.multiple || 1)
    );
    for (let i = 0; i < report.tickets.length; i++) {
      const tk = report.tickets[i];
      const legs: BasicChunkLine["legs"] = (tk.legs ?? [])
        .map((lg: SelectedPick) => {
          const fm = matchMap.get(lg.matchId);
          return {
            matchId: lg.matchId,
            matchNumStr: fm?.matchNumStr || lg.matchNumStr,
            home: fm?.home || lg.home,
            away: fm?.away || lg.away,
            kickoff: fm?.kickoff || "",
            poolCode: lg.poolCode,
            poolName: fm?.pools?.[lg.poolCode]?.name || lg.poolName,
            goalLine: lg.poolCode === "HHAD" ? lg.goalLine : undefined,
            optionKey: lg.optionKey,
            optionLabel: lg.optionLabel,
            odds: lg.odds,
          };
        })
        .sort(
          (a: { matchId: string }, b: { matchId: string }) =>
            (boardIndex.get(a.matchId) ?? 9999) -
            (boardIndex.get(b.matchId) ?? 9999)
        );
      if (legs.length === 0) continue;
      rawLines.push({
        id: tk.id || `tk_${i + 1}`,
        modeLabel: legs.length === 1 ? "单关" : `${legs.length}串1`,
        multiple: Math.max(1, Math.round(tk.multiple ?? fallbackMult)),
        legs,
      });
    }
  }

  const chunked: BasicChunkLine[] = [];
  for (const rl of rawLines) {
    let rem = rl.multiple;
    let part = 1;
    while (rem > 0) {
      const m = Math.min(99, rem);
      chunked.push({
        id: rl.multiple > 99 ? `${rl.id}#${part}` : rl.id,
        modeLabel: rl.modeLabel,
        passSize: rl.legs.length,
        multiple: m,
        legs: rl.legs,
      });
      rem -= m;
      part += 1;
    }
  }

  // Group by (passSize, multiple, exact match+pool sequence) and merge iff lossless Cartesian product
  const buckets = new Map<string, BasicChunkLine[]>();
  for (const cl of chunked) {
    const distinctMatches = new Set(cl.legs.map((l) => l.matchId));
    if (distinctMatches.size !== cl.legs.length) {
      buckets.set(`raw:${cl.id}`, [cl]);
      continue;
    }
    const bucketKey = `${cl.passSize}|${cl.multiple}|${cl.legs
      .map((l) => `${l.matchId}:${l.poolCode}`)
      .join(">")}`;
    const arr = buckets.get(bucketKey) ?? [];
    arr.push(cl);
    buckets.set(bucketKey, arr);
  }

  const physical: TerminalPhysicalSlip[] = [];
  let slipNo = 0;

  const emitSingleBasicSlip = (cl: BasicChunkLine) => {
    slipNo += 1;
    const legsByMatch: TerminalPhysicalSlipLegGroup[] = cl.legs.map((lg) => ({
      matchId: lg.matchId,
      matchNumStr: lg.matchNumStr,
      home: lg.home,
      away: lg.away,
      kickoff: lg.kickoff,
      ...(bankerSet.has(lg.matchId) ? { isBanker: true } : {}),
      poolCode: lg.poolCode,
      poolName: lg.poolName,
      ...(lg.goalLine ? { goalLine: lg.goalLine } : {}),
      options: [
        {
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
        },
      ],
    }));
    const lineSignature = `${cl.modeLabel}|${legsByMatch
      .map(
        (g) =>
          `${g.matchId}:${g.poolCode}:${g.options.map((o) => `${o.optionKey}@${o.odds.toFixed(2)}`).join(",")}`
      )
      .join("+")}`;
    physical.push({
      slipNo,
      slipId: `ps_${slipNo}`,
      modeLabel: cl.modeLabel,
      passSizes: [cl.passSize],
      multiple: cl.multiple,
      basicUnitsPerSlip: 1,
      stakeUnits2Yuan: cl.multiple,
      costYuan: cl.multiple * 2,
      matchIds: cl.legs.map((l) => l.matchId),
      legsByMatch,
      sourceBasicLineIds: [cl.id],
      lineSignature,
      ruleVersion: "sporttery-2026-v1",
    });
  };

  if (!shouldConsolidate) {
    for (const cl of chunked) {
      emitSingleBasicSlip(cl);
    }
    return physical;
  }

  for (const grp of buckets.values()) {
    if (grp.length === 1) {
      emitSingleBasicSlip(grp[0]);
      continue;
    }
    const k = grp[0].legs.length;
    const optMaps: Array<
      Map<string, { optionKey: string; optionLabel: string; odds: number }>
    > = Array.from({ length: k }, () => new Map());
    const tupleSet = new Set<string>();
    let duplicateTuple = false;
    for (const cl of grp) {
      const tupleSig = cl.legs.map((l) => l.optionKey).join("|");
      if (tupleSet.has(tupleSig)) {
        duplicateTuple = true;
        break;
      }
      tupleSet.add(tupleSig);
      for (let i = 0; i < k; i++) {
        const lg = cl.legs[i];
        optMaps[i].set(lg.optionKey, {
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
        });
      }
    }
    const cartesianSize = optMaps.reduce((acc, mp) => acc * mp.size, 1);
    const mergedCost = cartesianSize * grp[0].multiple * 2;
    if (
      !duplicateTuple &&
      cartesianSize === grp.length &&
      mergedCost <= 20_000
    ) {
      slipNo += 1;
      const head = grp[0];
      const legsByMatch: TerminalPhysicalSlipLegGroup[] = head.legs.map(
        (lg, i) => ({
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          kickoff: lg.kickoff,
          ...(bankerSet.has(lg.matchId) ? { isBanker: true } : {}),
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          ...(lg.goalLine ? { goalLine: lg.goalLine } : {}),
          options: Array.from(optMaps[i].values()),
        })
      );
      const lineSignature = `${head.modeLabel}|${legsByMatch
        .map(
          (g) =>
            `${g.matchId}:${g.poolCode}:${g.options
              .map((o) => `${o.optionKey}@${o.odds.toFixed(2)}`)
              .sort()
              .join(",")}`
        )
        .join("+")}`;
      physical.push({
        slipNo,
        slipId: `ps_${slipNo}`,
        modeLabel: head.modeLabel,
        passSizes: [head.passSize],
        multiple: head.multiple,
        basicUnitsPerSlip: cartesianSize,
        stakeUnits2Yuan: cartesianSize * head.multiple,
        costYuan: mergedCost,
        matchIds: head.legs.map((l) => l.matchId),
        legsByMatch,
        sourceBasicLineIds: grp.map((x) => x.id),
        lineSignature,
        ruleVersion: "sporttery-2026-v1",
      });
    } else {
      for (const cl of grp) emitSingleBasicSlip(cl);
    }
  }

  return physical;
}

function buildActiveAuditedSlip(
  s: Omit<
    BetSlipState,
    | "activeAuditedSlip"
    | "activeSlip"
    | "manualDraft"
    | "portfolioQuote"
    | "sandboxSim"
  >,
  revision = 0
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
    const appliedBudgetYuan =
      typeof rawLocked === "number" && rawLocked > 0
        ? normalizeBudgetYuan(rawLocked)
        : normalizeBudgetYuan(s.budget);
    const currentBudgetYuan = normalizeBudgetYuan(s.budget);
    if (appliedBudgetYuan !== currentBudgetYuan) {
      budgetMismatchMeta = {
        appliedBudgetYuan,
        currentBudgetYuan,
        bannerText: `已套 ¥${appliedBudgetYuan} / 当前新预算 ¥${currentBudgetYuan}（点此重配）`,
      };
    } else {
      const lockedSig = stripSubjectiveDeltaFromQuoteSig(
        s.planSpec.quoteInputSig ?? s.appliedTicketSnapshot?.quoteInputSig
      );
      const curSig = stripSubjectiveDeltaFromQuoteSig(
        s.livePortfolioQuote?.inputSig
      );
      if (lockedSig && curSig && lockedSig !== curSig) {
        budgetMismatchMeta = {
          appliedBudgetYuan,
          currentBudgetYuan,
          bannerText:
            "中栏倾向/留现参数已变更，当前核对仍锁定原已套用方案（点此按新参数重配）",
        };
      }
    }
  }

  const effectiveReport =
    s.workspace.baselineReport ?? s.workspace.effectiveReport;
  const manualReport =
    s.workspace.baselineManualReport ?? s.workspace.manualReport;
  const baselinePlan =
    s.workspace.baselineAppliedPlan !== undefined
      ? s.workspace.baselineAppliedPlan
      : s.workspace.appliedPlan;
  if (
    !budgetMismatchMeta &&
    s.planSpec?.kind === "bonus" &&
    s.planSpec.preserveExactBaseMultiples &&
    (s.planSpec.baseSourceKind ?? "manual") === "manual" &&
    Array.isArray(s.planSpec.baseLines) &&
    s.planSpec.baseLines.length > 0
  ) {
    const planLegSig = Array.from(
      new Set(
        s.planSpec.baseLines.flatMap((ln) =>
          (ln.legs ?? []).map(
            (lg) => `${lg.matchId}:${lg.poolCode}:${lg.optionKey}`
          )
        )
      )
    )
      .sort()
      .join("|");
    const draftLegSig = Array.from(
      new Set(
        manualDraftPicks.map(
          (pk) => `${pk.matchId}:${pk.poolCode}:${pk.optionKey}`
        )
      )
    )
      .sort()
      .join("|");
    if (planLegSig !== draftLegSig) {
      budgetMismatchMeta = {
        appliedBudgetYuan: effectiveReport.totalCost,
        currentBudgetYuan: manualReport.totalCost,
        bannerText:
          "手选草稿已更新，当前核对仍锁定原已审分倍单（点「回到我的手选」切换）",
      };
    }
  }
  const isAutoSynthetic = Boolean(
    !s.planSpec && effectiveReport.syntheticAutoMounted && baselinePlan
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

  const resolvedPlan =
    baselinePlan ??
    (s.planSpec?.kind === "archetype"
      ? (s.planSpec.snapshotPlan ?? null)
      : null);

  let sourceLines: PlanTicketLine[] = [];
  const distinctLegsMap = new Map<string, AuditedSlipLeg>();
  const freePrimaryByMatch = new Map<string, string>();

  if (
    sourceKind === "archetype" ||
    sourceKind === "bonus-opt" ||
    sourceKind === "auto-synthetic"
  ) {
    sourceLines =
      resolvedPlan?.lines ??
      (sourceKind === "archetype"
        ? (s.appliedTicketSnapshot?.lines ?? [])
        : sourceKind === "bonus-opt" && s.planSpec?.kind === "bonus"
          ? (s.planSpec.baseLines ?? [])
          : []);

    for (const ln of sourceLines) {
      for (const lg of ln.legs ?? []) {
        const key = `${lg.matchId}:${lg.poolCode}:${lg.optionKey}`;
        if (distinctLegsMap.has(key)) continue;
        const fm = matchMap.get(lg.matchId);
        const pool = fm?.pools?.[lg.poolCode];
        const liveOpt = pool?.options?.find((o) => o.key === lg.optionKey);
        const legSource: AuditedLegSource =
          sourceKind === "bonus-opt" &&
          !(
            s.planSpec?.kind === "bonus" &&
            s.planSpec.baseSourceKind &&
            s.planSpec.baseSourceKind !== "manual"
          )
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

  const manualPassBlocked =
    !isAppliedPlan &&
    Boolean(computePassRuleBlockReason(s.passSpec, manualDraftPicks));
  const preferConsolidated = s.planSpec
    ? s.planSpec.consolidateTickets !== false
    : true;
  const planMatchesConsolidation = Boolean(
    resolvedPlan &&
    (resolvedPlan.consolidateTickets !== false) === preferConsolidated
  );
  const physicalSlips =
    !manualPassBlocked &&
    effectiveReport.canCheckout &&
    effectiveReport.totalCost > 0
      ? preferConsolidated &&
        Array.isArray(effectiveReport.physicalSlips) &&
        effectiveReport.physicalSlips.length > 0
        ? effectiveReport.physicalSlips
        : planMatchesConsolidation &&
            Array.isArray(resolvedPlan?.physicalSlips) &&
            resolvedPlan.physicalSlips.length > 0
          ? resolvedPlan.physicalSlips
          : consolidateTerminalPhysicalSlips(
              effectiveReport,
              sourceKind !== "manual" && sourceKind !== "empty"
                ? resolvedPlan
                : null,
              s.matches,
              s.multiple,
              bankerSet,
              { consolidate: preferConsolidated }
            )
      : [];

  return {
    revision,
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
    physicalSlips,
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
    passSpec: { mode: "follow-max-parlay" } as PassSelectionSpec,
    planSpec: null as AppliedPlanSpec,
    appliedTicketSnapshot: null as AppliedTicketSnapshot | null,
    syntheticSingleMode: "full-3way" as SyntheticSingleMode,
    singleAuthGrant: null as SingleAuthGrant | null,
    lastPoolSwitchUndo: null as PoolSwitchUndoSnapshot | null,
    subjectiveDeltaPct: 0,
    simVoidFirstMatch: false,
    voidMatchIds: [] as string[],
    draftRestoredNotice: null as string | null,
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
  const livePortfolioQuote: LivePortfolioQuoteState = {
    quoteVersion: 0,
    ...qMeta,
    computedInputSig: qMeta.inputSig,
    isStale: false,
    canApplyLiveQuote: true,
  };
  const withQuote = {
    ...base,
    livePortfolioQuote,
  };
  const activeSlip = buildActiveAuditedSlip(withQuote, 0);
  return {
    ...withQuote,
    manualDraft: {
      schemaVersion: 1,
      revision: 0,
      picks: [],
      multiple: 5,
      passSpec: base.passSpec,
      budget: 100,
      stance: "objective",
      allowSaveCash: false,
      passRuleBlockReason: null,
    },
    portfolioQuote: {
      ...livePortfolioQuote,
      plans: [],
      objectivePlans: [],
    },
    activeSlip,
    activeAuditedSlip: activeSlip,
    sandboxSim: {
      baseRevision: 0,
      voidMatchIds: [],
      subjectiveDeltaPct: 0,
    },
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
  const earlyDatePrefix = mEarly?.id.includes("-")
    ? mEarly.id.split("-")[0]
    : "";
  const isLateNightKickoff = (ko: string) =>
    ko.startsWith("01:") ||
    ko.startsWith("03:") ||
    ko.startsWith("05:") ||
    ko.startsWith("07:");
  const mLate =
    (earlyDatePrefix
      ? (matches.find(
          (x) =>
            x.id !== mEarly?.id &&
            x.id.split("-")[0] > earlyDatePrefix &&
            (x.kickoff.startsWith("03:") ||
              x.kickoff.startsWith("07:") ||
              x.kickoff.startsWith("05:")) &&
            (x.pools.HAD.single || x.pools.HHAD.single)
        ) ??
        matches.find(
          (x) =>
            x.id !== mEarly?.id &&
            x.id.split("-")[0] > earlyDatePrefix &&
            isLateNightKickoff(x.kickoff) &&
            (x.pools.HAD.single || x.pools.HHAD.single)
        ))
      : undefined) ??
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
        ...resolveOptionalGoalLine(pCode, m.pools[pCode]),
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      };
    })
    .filter((x): x is SelectedPick => x !== null);
  return { multiple: 15, picks };
}

function serializePlanSpecForExecSig(ps: AppliedPlanSpec): string {
  if (!ps) return "none";
  if (ps.kind === "archetype") {
    return `arch:${ps.key}:${ps.quoteInputSig ?? ""}:${ps.appliedBudgetYuan ?? 0}:${ps.scaleMultiple ?? 1}:${ps.consolidateTickets !== false ? 1 : 0}:${ps.allowBudgetMismatchReadOnly ? 1 : 0}`;
  }
  const blSig = (ps.baseLines ?? [])
    .map(
      (ln) =>
        `${(ln.legs ?? [])
          .map(
            (g) =>
              `${g.matchId}:${g.poolCode}:${g.optionKey}@${Number(g.odds).toFixed(4)}`
          )
          .sort()
          .join("+")}*${ln.multiple ?? 1}`
    )
    .join(";");
  return `bonus:${ps.optMode}:${blSig}:${ps.preserveExactBaseMultiples ? 1 : 0}:${ps.boundSingleAuthId ?? ""}:${ps.boundLineAndMultipleSig ?? ""}:${ps.targetBudgetCost ?? ""}:${ps.scaleMultiple ?? 1}:${ps.upgradeToBreakeven ? 1 : 0}:${ps.consolidateTickets !== false ? 1 : 0}:${ps.allowUnbundleCombo ? 1 : 0}:${ps.confirmedCapGuardSig ?? ""}`;
}

function isSingleAuthBoundBonusPlan(ps: AppliedPlanSpec): boolean {
  return Boolean(
    ps &&
    ps.kind === "bonus" &&
    (ps.boundSingleAuthId || ps.baseSourceKind === "auto-synthetic")
  );
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
  if (typeof pool.canSingle === "boolean" && typeof pool.single === "boolean") {
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

function computeWorkspaceExecutionSig(
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
    | "multiple"
    | "syntheticSingleMode"
    | "singleAuthGrant"
    | "planSpec"
  >,
  qInputSig?: string
): string {
  const baseSig = qInputSig ?? computeClientPortfolioQuoteMeta(s).inputSig;
  return `${baseSig}|m=${s.multiple}|syn=${s.syntheticSingleMode}|ga=${s.singleAuthGrant?.authId ?? ""}|pl=${serializePlanSpecForExecSig(s.planSpec)}`;
}

function computeSingleMatchQuoteVersionSig(
  match: MatchItem | undefined
): string {
  const poolOrder: PoolCode[] = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  const quoteParts: string[] = [orderedMatchKey(match ?? {})];
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

function encodeSyntheticLinesSig(
  lines: PlanTicketLine[] | undefined,
  fallbackMultiple: number,
  fallbackPicks?: SelectedPick[]
): string {
  if (Array.isArray(lines) && lines.length > 0) {
    return lines
      .map((ln) => {
        const m = Math.max(1, Math.round(ln.multiple || fallbackMultiple || 1));
        const legsSig = (ln.legs ?? [])
          .map(
            (lg) =>
              `${String(lg.poolCode).toUpperCase()}:${lg.optionKey}@${Number(lg.odds).toFixed(4)}`
          )
          .sort()
          .join("+");
        return `${legsSig}\u00d7${m}`;
      })
      .sort()
      .join(";");
  }
  if (Array.isArray(fallbackPicks) && fallbackPicks.length > 0) {
    const m = Math.max(1, Math.round(fallbackMultiple || 1));
    return fallbackPicks
      .map(
        (pk) =>
          `${String(pk.poolCode).toUpperCase()}:${pk.optionKey}@${Number(pk.odds).toFixed(4)}\u00d7${m}`
      )
      .sort()
      .join(";");
  }
  return "";
}

function buildSinglePreviewLineSig(
  pv: PartialCoveragePreview | null | undefined,
  fallbackMultiple = 1
): string {
  if (!pv || !Array.isArray(pv.previewLines) || pv.previewLines.length === 0) {
    return "";
  }
  return encodeSyntheticLinesSig(pv.previewLines, fallbackMultiple);
}

function isGrantLineSigValidAgainstMatch(
  lineSig: string | undefined,
  fm: MatchItem | undefined
): boolean {
  if (!fm) return false;
  if (!lineSig || lineSig.startsWith("m=")) return true;
  const lineParts = lineSig.split(";").filter(Boolean);
  if (lineParts.length === 0) return true;
  for (const lp of lineParts) {
    const xIdx = Math.max(lp.lastIndexOf("\u00d7"), lp.lastIndexOf("x"));
    const legsPart = xIdx > 0 ? lp.slice(0, xIdx) : lp;
    for (const legTok of legsPart.split("+").filter(Boolean)) {
      const colIdx = legTok.indexOf(":");
      const atIdx = legTok.indexOf("@");
      if (colIdx <= 0 || atIdx <= colIdx) continue;
      const poolCode = legTok.slice(0, colIdx).toUpperCase() as PoolCode;
      const optKey = legTok.slice(colIdx + 1, atIdx);
      const expectedOdds = Number(legTok.slice(atIdx + 1));
      const pool = fm.pools?.[poolCode];
      if (!pool || pool.selling === false || !resolvePoolCanSingle(pool)) {
        return false;
      }
      const opt = pool.options?.find((o) => o.key === optKey);
      if (
        !opt ||
        !Number.isFinite(expectedOdds) ||
        Math.abs(Number(opt.odds) - expectedOdds) > 1e-6
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasPlanSpecBoardInvalidation(
  planSpec: AppliedPlanSpec,
  prevMatchMap: Map<string, MatchItem>,
  nextMatchMap: Map<string, MatchItem>
): boolean {
  if (!planSpec) return false;
  const boundSingleAuth = isSingleAuthBoundBonusPlan(planSpec);
  const sourceLines =
    planSpec.kind === "archetype"
      ? (planSpec.snapshotPlan?.lines ??
        planSpec.appliedTicketSnapshot?.lines ??
        [])
      : (planSpec.baseLines ?? []);
  if (sourceLines.length === 0) return boundSingleAuth;
  for (const ln of sourceLines) {
    const legs = ln.legs ?? [];
    if (legs.length === 0) return true;
    const isSingleLine = legs.length === 1;
    for (const lg of legs) {
      const nextM = nextMatchMap.get(lg.matchId);
      if (!isStrictSameMatchIdentity(nextM, lg, prevMatchMap.get(lg.matchId))) {
        return true;
      }
      const nextPool = nextM.pools?.[lg.poolCode];
      if (!nextPool || nextPool.selling === false) return true;
      if (
        isSingleLine
          ? !resolvePoolCanSingle(nextPool)
          : !resolvePoolCanAllUp(nextPool)
      ) {
        return true;
      }
      const nextOpt = nextPool.options?.find((o) => o.key === lg.optionKey);
      if (!nextOpt || nextOpt.odds < 1.01) return true;
      if (boundSingleAuth && planSpec.kind === "bonus") {
        if (!resolvePoolCanSingle(nextPool)) return true;
        if (Math.abs(Number(nextOpt.odds) - Number(lg.odds)) > 1e-6)
          return true;
        if (
          planSpec.boundQuoteVersionSig &&
          computeSingleMatchQuoteVersionSig(nextM) !==
            planSpec.boundQuoteVersionSig
        ) {
          return true;
        }
      }
      if (lg.poolCode === "HHAD") {
        const prevM = prevMatchMap.get(lg.matchId);
        const prevGl = String(prevM?.pools?.HHAD?.goalLine ?? "").trim();
        const nextGl = String(nextPool.goalLine ?? "").trim();
        if (prevGl && nextGl !== prevGl) return true;
      }
    }
  }
  return false;
}

function isCapGuardBindingValidAgainstBoard(
  sig: string | undefined,
  boardMap: Map<string, MatchItem>
): boolean {
  if (!sig || !sig.startsWith("cg1|")) return false;
  const pipeParts = sig.split("|");
  if (pipeParts.length < 3) return false;
  const rowsPart = pipeParts.slice(2).join("|");
  const rowTokens = rowsPart.split(";").filter(Boolean);
  if (rowTokens.length === 0) return false;
  for (const rowTok of rowTokens) {
    const hashIdx = rowTok.lastIndexOf("#");
    const legsPart = hashIdx > 0 ? rowTok.slice(0, hashIdx) : rowTok;
    const legTokens = legsPart.split("&").filter(Boolean);
    if (legTokens.length === 0) return false;
    const isSingleLine = legTokens.length === 1;
    for (const lt of legTokens) {
      const atIdx = lt.indexOf("@");
      if (atIdx <= 0) return false;
      const head = lt.slice(0, atIdx);
      const tail = lt.slice(atIdx + 1);
      const headCols = head.split(":");
      if (headCols.length < 3) return false;
      const matchId = headCols[0];
      const poolCode = headCols[1] as PoolCode;
      const optionKey = headCols.slice(2).join(":");
      const tailSep = tail.indexOf(":");
      const oddsStr = tailSep >= 0 ? tail.slice(0, tailSep) : tail;
      const expectedGl = tailSep >= 0 ? tail.slice(tailSep + 1) : "";
      const expectedOdds = Number(oddsStr);
      const fm = boardMap.get(matchId);
      const pool = fm?.pools?.[poolCode];
      const opt = pool?.options?.find((o) => o.key === optionKey);
      if (
        !fm ||
        !pool ||
        pool.selling === false ||
        !opt ||
        !Number.isFinite(expectedOdds) ||
        Math.abs(Number(opt.odds) - expectedOdds) > 1e-6 ||
        (isSingleLine
          ? !resolvePoolCanSingle(pool)
          : !resolvePoolCanAllUp(pool)) ||
        (poolCode === "HHAD" &&
          String(pool.goalLine ?? "").trim() !== expectedGl.trim())
      ) {
        return false;
      }
    }
  }
  return true;
}

function extractBoardCapturedAt(meta?: BoardFreshnessMeta | null): number {
  if (!meta || typeof meta !== "object") return 0;
  const t = Number(meta.lastValidBoardAt ?? meta.quotedAt ?? 0);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function pickNewerWsBoardMeta(
  cur?: BoardFreshnessMeta | null,
  inc?: BoardFreshnessMeta | null
): BoardFreshnessMeta | undefined {
  if (!inc) return cur ?? undefined;
  if (!cur) return inc;
  const curT = Number(
    cur.syncedAt ?? cur.quotedAt ?? cur.lastValidBoardAt ?? 0
  );
  const incT = Number(
    inc.syncedAt ?? inc.quotedAt ?? inc.lastValidBoardAt ?? 0
  );
  if (curT > 0 && incT > 0 && incT < curT) return cur;
  return inc;
}

/**
 * 选单工作区深模块（仅负责前端交互状态机与体彩选号互斥门禁；所有算奖、去水概率、优化与精算配单（3+1 帕累托体系）公式 100% 委托注入的工作区计算适配器执行）
 */
export function createBetSlipController(options: BetSlipControllerOptions) {
  const debounceMs = options.debounceMs ?? 18;
  const autoSyncRadar = options.autoSyncRadar ?? false;
  const nowFn = options.nowFn ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let bootstrapped = false;
  let computeSeq = 0;
  let boardEpoch = 0;
  let latestBoardCapturedAt = 0;
  let deferredDraftBoardAt = 0;
  let lastPoolMergeRetriedInputSig = "";
  let revokedPlanHold: { reason: string; rev: number } | null = null;
  let localHoldRev = 0;
  let clearedHoldRev = 0;
  let myAckedHoldRev = 0;
  let localClearSeq = 0;
  let knownStorageWriteSeq = 0;
  let lastManualTicketHash = "empty";
  let confirmedClearDraftHash: string | null = null;
  let pendingExplicitUserClear = false;
  let pendingExplicitTicketPersist = false;
  let pendingPreviewKnobPersist: "budget" | "stance" | "allowSaveCash" | null =
    null;
  let hadObservedPersistedDraft = false;
  let hasUnresolvedSyntheticChoice = false;
  let syntheticApproval: SyntheticTicketApproval | null = null;
  let storageListenerRegistered = false;
  let broadcastChannelRegistered = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolvers: Array<() => void> = [];
  let inFlightPromise: Promise<void> | null = null;

  const ALL_POOL_CODES: PoolCode[] = ["HAD", "HHAD", "CRS", "TTG", "HAFU"];
  function normalizePoolQuoteStamp(
    pool?: MatchItem["pools"][PoolCode]
  ): string {
    const ut = String(pool?.updateTime ?? "").trim();
    if (!ut) return "";
    const ud = String(pool?.updateDate ?? "").trim();
    return ud ? `${ud} ${ut}` : ut;
  }
  function isIncomingMatchStrictlyNewer(
    prev: MatchItem,
    incoming: MatchItem
  ): boolean {
    let anyNewer = false;
    for (const pc of ALL_POOL_CODES) {
      const pStamp = normalizePoolQuoteStamp(prev.pools?.[pc]);
      const nStamp = normalizePoolQuoteStamp(incoming.pools?.[pc]);
      if (pStamp && nStamp && nStamp < pStamp) return false;
      if (pStamp && !nStamp) return false;
      if (nStamp && (!pStamp || nStamp > pStamp)) anyNewer = true;
    }
    return anyNewer;
  }
  function mergeMatchPoolsNonRegressive(
    prev: MatchItem | undefined,
    incoming: MatchItem
  ): MatchItem {
    if (!prev || orderedMatchKey(prev) !== orderedMatchKey(incoming))
      return incoming;
    let patchedPools: MatchItem["pools"] | null = null;
    for (const pc of ALL_POOL_CODES) {
      const prevPool = prev.pools?.[pc];
      const nextPool = incoming.pools?.[pc];
      if (!prevPool || !nextPool) continue;
      const pStamp = normalizePoolQuoteStamp(prevPool);
      const nStamp = normalizePoolQuoteStamp(nextPool);
      if (pStamp && (!nStamp || nStamp < pStamp)) {
        if (!patchedPools) patchedPools = { ...incoming.pools };
        patchedPools[pc] = {
          ...prevPool,
          confirmedSaleRights: nextPool.confirmedSaleRights,
          selling: nextPool.selling,
          single: nextPool.single,
          ...(nextPool.canSingle !== undefined
            ? { canSingle: nextPool.canSingle }
            : {}),
          ...(nextPool.canAllUp !== undefined
            ? { canAllUp: nextPool.canAllUp }
            : {}),
        };
      }
    }
    return patchedPools ? { ...incoming, pools: patchedPools } : incoming;
  }
  function stampPlansRemediationSig(
    plans: ArchetypePlan[] | undefined,
    wsSig: string
  ): ArchetypePlan[] {
    if (!Array.isArray(plans) || plans.length === 0) return plans ?? [];
    return plans.map((pl) =>
      Array.isArray(pl.remediationActions) && pl.remediationActions.length > 0
        ? {
            ...pl,
            remediationActions: pl.remediationActions.map((act) => ({
              ...act,
              sourceWorkspaceSig: wsSig,
            })),
          }
        : pl
    );
  }
  function stampWorkspaceRemediationMeta(
    ws: QuantWorkspaceResponse,
    wsSig: string
  ): QuantWorkspaceResponse {
    if (!wsSig) return ws;
    const stampedActiveTip = ws.insights?.activeSwapTip
      ? { ...ws.insights.activeSwapTip, sourceWorkspaceSig: wsSig }
      : null;
    const stampedSwaps = Array.isArray(ws.insights?.wholeSlipEquivalentSwaps)
      ? ws.insights.wholeSlipEquivalentSwaps.map((sw) => ({
          ...sw,
          sourceWorkspaceSig: wsSig,
        }))
      : ws.insights?.wholeSlipEquivalentSwaps;
    const stampPlanCapAlt = (
      pl: ArchetypePlan | null | undefined
    ): ArchetypePlan | null | undefined => {
      if (!pl || !pl.capGuardAlternative) return pl;
      return {
        ...pl,
        capGuardAlternative: {
          ...pl.capGuardAlternative,
          sourceWorkspaceSig: wsSig,
        },
      };
    };
    return {
      ...ws,
      portfolioPlans: stampPlansRemediationSig(ws.portfolioPlans, wsSig),
      fivePlans: stampPlansRemediationSig(ws.fivePlans, wsSig),
      appliedPlan: stampPlanCapAlt(ws.appliedPlan) ?? null,
      ...(ws.baselineAppliedPlan !== undefined
        ? {
            baselineAppliedPlan:
              stampPlanCapAlt(ws.baselineAppliedPlan) ?? null,
          }
        : {}),
      insights: ws.insights
        ? {
            ...ws.insights,
            activeSwapTip: stampedActiveTip,
            ...(stampedSwaps !== undefined
              ? { wholeSlipEquivalentSwaps: stampedSwaps }
              : {}),
          }
        : ws.insights,
    };
  }
  function buildCurrentSwapPicksSig(picks: SelectedPick[]): string {
    return picks
      .map(
        (p) =>
          `${String(p.matchId)}:${String(p.poolCode)}:${String(p.optionKey)}:${Number(p.odds).toFixed(4)}`
      )
      .sort()
      .join("|");
  }
  function buildCurrentSwapActualLinesSig(cur: BetSlipState): string {
    const baseRep =
      cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
    const baseApplied =
      cur.workspace.baselineAppliedPlan !== undefined
        ? cur.workspace.baselineAppliedPlan
        : cur.workspace.appliedPlan;
    const rawLines =
      Array.isArray(baseApplied?.lines) && baseApplied.lines.length > 0
        ? baseApplied.lines
        : (baseRep.tickets ?? []);
    return (
      "al1|" +
      rawLines
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
            Math.round(
              Number(
                (ln as { multiple?: number }).multiple ?? baseRep.multiple
              ) || 1
            )
          );
          return `${lp}@${m}`;
        })
        .sort()
        .join("||")
    );
  }
  function sameSwapPickRefSet(
    a: Array<{ poolCode: PoolCode; optionKey: string }>,
    b: Array<{ poolCode: PoolCode; optionKey: string }>
  ): boolean {
    if (a.length !== b.length) return false;
    const sa = a
      .map((x) => `${x.poolCode}:${x.optionKey}`)
      .sort()
      .join("|");
    const sb = b
      .map((x) => `${x.poolCode}:${x.optionKey}`)
      .sort()
      .join("|");
    return sa === sb;
  }
  function resolveLiveWholeSlipSwap(
    cur: BetSlipState,
    arb: EquivalentArbItem
  ): EquivalentArbItem | null {
    const curInputSig = computeClientPortfolioQuoteMeta(cur).inputSig;
    const curExecSig = computeWorkspaceExecutionSig(cur, curInputSig);
    if (cur.livePortfolioQuote.isStale || computedWorkspaceSig !== curExecSig) {
      return null;
    }
    const baseRep =
      cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
    const curPicksSig = buildCurrentSwapPicksSig(cur.picks);
    const curCost = Number(baseRep.totalCost) || 0;
    const curPassSig = (baseRep.activePassSizes ?? []).join(",");
    const curBankerSig = [...(baseRep.bankerMatchIds ?? [])]
      .map(String)
      .sort()
      .join(",");
    const curComboCode = String(baseRep.activeComboCode ?? "");
    const curActualLinesSig = buildCurrentSwapActualLinesSig(cur);

    const validateBoundArb = (cand: EquivalentArbItem): boolean => {
      if (
        !Array.isArray(cand.executableSwapLines) ||
        cand.executableSwapLines.length === 0
      ) {
        return false;
      }
      if (cand.sourceWorkspaceSig && cand.sourceWorkspaceSig !== curExecSig) {
        return false;
      }
      if (cand.sourcePicksSig !== curPicksSig) return false;
      const execSumCost = cand.executableSwapLines.reduce(
        (sum, ln) => sum + (Number(ln.cost) || (Number(ln.multiple) || 1) * 2),
        0
      );
      if (curCost > 0 && Math.abs(execSumCost - curCost) > 1e-6) {
        return false;
      }
      if (
        typeof cand.sourceTotalCost === "number" &&
        Math.abs(cand.sourceTotalCost - curCost) > 1e-6
      ) {
        return false;
      }
      if (
        typeof cand.sourceActivePassSig === "string" &&
        cand.sourceActivePassSig !== curPassSig
      ) {
        return false;
      }
      if (
        typeof cand.sourceBankerSig === "string" &&
        cand.sourceBankerSig !== curBankerSig
      ) {
        return false;
      }
      if (
        typeof cand.sourceComboCode === "string" &&
        cand.sourceComboCode !== curComboCode
      ) {
        return false;
      }
      if (
        typeof cand.sourceActualLinesSig === "string" &&
        cand.sourceActualLinesSig !== curActualLinesSig
      ) {
        return false;
      }
      const byId = new Map(cur.matches.map((m) => [m.id, m]));
      for (const ln of cand.executableSwapLines) {
        const legs = ln.legs ?? [];
        if (legs.length === 0) return false;
        const isSingleLine = legs.length === 1;
        for (const lg of legs) {
          const lm = byId.get(lg.matchId);
          const lp = lm?.pools?.[lg.poolCode];
          const lo = lp?.options?.find((o) => o.key === lg.optionKey);
          if (
            !lm ||
            !lp ||
            lp.selling === false ||
            !lo ||
            (isSingleLine
              ? !resolvePoolCanSingle(lp)
              : !resolvePoolCanAllUp(lp)) ||
            Math.abs(Number(lo.odds) - Number(lg.odds)) > 1e-6
          ) {
            return false;
          }
          const legGl = (lg as { goalLine?: string }).goalLine;
          if (
            lg.poolCode === "HHAD" &&
            legGl !== undefined &&
            String(lp.goalLine ?? "").trim() !== String(legGl).trim()
          ) {
            return false;
          }
        }
      }
      return true;
    };

    const list =
      cur.workspace.insights.wholeSlipEquivalentSwaps ??
      (cur.workspace.insights.activeSwapTip
        ? [cur.workspace.insights.activeSwapTip]
        : []);
    const isBoundInput =
      (Array.isArray(arb.executableSwapLines) &&
        arb.executableSwapLines.length > 0) ||
      arb.sourcePicksSig !== undefined;
    if (isBoundInput) {
      if (!validateBoundArb(arb)) return null;
      const liveMatched = list.find(
        (cand) =>
          cand.matchId === arb.matchId &&
          sameSwapPickRefSet(cand.worsePicks, arb.worsePicks) &&
          sameSwapPickRefSet(cand.betterPicks, arb.betterPicks) &&
          validateBoundArb(cand)
      );
      return liveMatched ?? null;
    }

    const matched = list.find(
      (cand) =>
        cand.matchId === arb.matchId &&
        sameSwapPickRefSet(cand.worsePicks, arb.worsePicks) &&
        sameSwapPickRefSet(cand.betterPicks, arb.betterPicks) &&
        validateBoundArb(cand)
    );
    return matched ?? null;
  }

  let state: BetSlipState = buildInitialState();
  let quoteVersion = 0;
  let draftRevision = 0;
  let activeSlipRevision = 0;
  let authGrantSeq = 0;
  let lastDraftSig = "";
  let lastPersistedDraftJson = "";
  let lastPersistedSourceJson = "";
  let lastActiveSlipSig = "";
  let lastKnownInputSig = state.livePortfolioQuote.inputSig;
  let computedInputSig = state.livePortfolioQuote.inputSig;
  let computedWorkspaceSig = computeWorkspaceExecutionSig(
    state,
    computedInputSig
  );
  let lastReconciledRef: BetSlipState | null = state;
  let lastReconciledOffline = false;
  let maskedSyntheticWorkspace: QuantWorkspaceResponse | null = null;
  let originalSyntheticWorkspace: QuantWorkspaceResponse | null = null;
  let pendingRequote: {
    slotKey: ArchetypeKey;
    expectedInputSig: string;
    allowSlotFallback: boolean;
  } | null = null;

  function resolveStorage(): BetSlipStoragePort | null {
    if (options.storagePort) return options.storagePort;
    if (!options.getAccountId) return null;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const domStore = window.localStorage;
        return {
          getItem: (k) => domStore.getItem(k),
          setItem: (k, v) => domStore.setItem(k, v),
          removeItem: (k) => domStore.removeItem(k),
          getBackingTarget: () => domStore as unknown as object,
        };
      }
    } catch {
      // ignore sandboxed storage error
    }
    return null;
  }

  function resolveDraftStorageKey(): string | null {
    const accId =
      options.getAccountId?.() ?? (options.storagePort ? "default" : null);
    return accId ? `yj_manual_draft_v1:${accId}` : null;
  }

  function getSharedBusMap(
    storage: BetSlipStoragePort | null
  ): Map<string, SharedAccountHoldRecord> | null {
    if (!storage) return null;
    const backing = storage.getBackingTarget?.() ?? (storage as object);
    let map = SHARED_ACCOUNT_HOLD_BUS.get(backing);
    if (!map) {
      map = new Map<string, SharedAccountHoldRecord>();
      SHARED_ACCOUNT_HOLD_BUS.set(backing, map);
    }
    return map;
  }

  let browserHoldChannel: BroadcastChannel | null = null;
  function ensureBrowserHoldChannel() {
    if (broadcastChannelRegistered) return;
    if (
      typeof window === "undefined" ||
      typeof (window as Window & { document?: unknown }).document ===
        "undefined" ||
      typeof BroadcastChannel !== "function"
    ) {
      return;
    }
    broadcastChannelRegistered = true;
    try {
      browserHoldChannel = new BroadcastChannel("yj_shared_hold_v1");
      browserHoldChannel.onmessage = (ev) => {
        const data = ev?.data as
          ({ key?: string } & Partial<SharedAccountHoldRecord>) | null;
        const expectedKey = resolveDraftStorageKey();
        if (!data || !expectedKey || data.key !== expectedKey) return;
        const busMap = getSharedBusMap(resolveStorage());
        if (busMap) {
          const prev = busMap.get(expectedKey);
          const incHold = Math.max(0, Math.floor(Number(data.holdRev) || 0));
          const incClear = Math.max(
            0,
            Math.floor(Number(data.holdClearedRev) || 0)
          );
          const incClearSeq = Math.max(
            0,
            Math.floor(Number(data.clearSeq) || 0)
          );
          const incWriteSeq = Math.max(
            0,
            Math.floor(Number(data.writeSeq) || 0)
          );
          const mergedHold = Math.max(prev?.holdRev ?? 0, incHold);
          const mergedClear = Math.max(prev?.holdClearedRev ?? 0, incClear);
          const mergedClearSeq = Math.max(prev?.clearSeq ?? 0, incClearSeq);
          const useIncomingHash =
            incClearSeq > (prev?.clearSeq ?? 0) ||
            (incClearSeq === (prev?.clearSeq ?? 0) &&
              incClear >= (prev?.holdClearedRev ?? 0));
          const mergedLastReason =
            incHold >= (prev?.holdRev ?? 0)
              ? (data.lastHoldReason ??
                data.pendingRevokedPlanConfirm ??
                prev?.lastHoldReason ??
                null)
              : (prev?.lastHoldReason ??
                data.lastHoldReason ??
                data.pendingRevokedPlanConfirm ??
                null);
          busMap.set(expectedKey, {
            holdRev: mergedHold,
            holdClearedRev: mergedClear,
            clearSeq: mergedClearSeq,
            writeSeq: Math.max(prev?.writeSeq ?? 0, incWriteSeq),
            holdClearedDraftHash: useIncomingHash
              ? (data.holdClearedDraftHash ??
                prev?.holdClearedDraftHash ??
                null)
              : (prev?.holdClearedDraftHash ?? null),
            lastHoldReason: mergedLastReason,
            pendingRevokedPlanConfirm:
              mergedHold > mergedClear ? mergedLastReason : null,
          });
        }
        const hadHoldBefore = Boolean(revokedPlanHold);
        if (syncSharedHoldFromStorage()) {
          emit();
          if (hadHoldBefore && !revokedPlanHold) {
            void scheduleRefresh();
          }
        }
      };
    } catch {
      browserHoldChannel = null;
    }
  }

  function publishSharedHoldMeta(record: SharedAccountHoldRecord) {
    const storage = resolveStorage();
    const key = resolveDraftStorageKey();
    if (!storage || !key) return;
    const busMap = getSharedBusMap(storage);
    if (busMap) {
      const prev = busMap.get(key);
      const mergedHold = Math.max(prev?.holdRev ?? 0, record.holdRev);
      const mergedClear = Math.max(
        prev?.holdClearedRev ?? 0,
        record.holdClearedRev
      );
      const mergedClearSeq = Math.max(prev?.clearSeq ?? 0, record.clearSeq);
      const useIncomingHash =
        record.clearSeq > (prev?.clearSeq ?? 0) ||
        (record.clearSeq === (prev?.clearSeq ?? 0) &&
          record.holdClearedRev >= (prev?.holdClearedRev ?? 0));
      const mergedLastReason =
        record.holdRev >= (prev?.holdRev ?? 0)
          ? (record.lastHoldReason ??
            record.pendingRevokedPlanConfirm ??
            prev?.lastHoldReason ??
            null)
          : (prev?.lastHoldReason ??
            record.lastHoldReason ??
            record.pendingRevokedPlanConfirm ??
            null);
      busMap.set(key, {
        holdRev: mergedHold,
        holdClearedRev: mergedClear,
        clearSeq: mergedClearSeq,
        writeSeq: Math.max(prev?.writeSeq ?? 0, record.writeSeq),
        holdClearedDraftHash: useIncomingHash
          ? (record.holdClearedDraftHash ?? prev?.holdClearedDraftHash ?? null)
          : (prev?.holdClearedDraftHash ?? null),
        lastHoldReason: mergedLastReason,
        pendingRevokedPlanConfirm:
          mergedHold > mergedClear ? mergedLastReason : null,
      });
    }
    try {
      browserHoldChannel?.postMessage({ key, ...record });
    } catch {
      // ignore channel post error
    }
  }

  function readCurrentDraftBytes(): string | null {
    const key = resolveDraftStorageKey();
    try {
      return key ? (resolveStorage()?.getItem(key) ?? null) : null;
    } catch {
      return null;
    }
  }

  // The smallest on-disk representation abbreviates only its schema key.
  function parseStoredDraft(raw: string) {
    const record = JSON.parse(raw);
    if (record?.v !== undefined && record.schemaVersion === undefined) {
      record.schemaVersion = record.v;
    }
    return record;
  }

  function readStoredHoldMeta(): SharedAccountHoldRecord & {
    rawPresent: boolean;
    diskHoldRev: number;
    diskHasPendingHold: boolean;
    boardCapturedAt: number;
    storedDraftHash: string | null;
  } {
    const storage = resolveStorage();
    const key = resolveDraftStorageKey();
    if (!storage || !key) {
      return {
        holdRev: 0,
        holdClearedRev: 0,
        clearSeq: 0,
        writeSeq: 0,
        holdClearedDraftHash: null,
        lastHoldReason: null,
        pendingRevokedPlanConfirm: null,
        rawPresent: false,
        diskHoldRev: 0,
        diskHasPendingHold: false,
        boardCapturedAt: 0,
        storedDraftHash: null,
      };
    }
    const busRec = getSharedBusMap(storage)?.get(key) ?? null;
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) {
      return {
        holdRev: busRec?.holdRev ?? 0,
        holdClearedRev: busRec?.holdClearedRev ?? 0,
        clearSeq: busRec?.clearSeq ?? 0,
        writeSeq: busRec?.writeSeq ?? 0,
        holdClearedDraftHash: busRec?.holdClearedDraftHash ?? null,
        lastHoldReason: busRec?.lastHoldReason ?? null,
        pendingRevokedPlanConfirm: busRec?.pendingRevokedPlanConfirm ?? null,
        rawPresent: false,
        diskHoldRev: 0,
        diskHasPendingHold: false,
        boardCapturedAt: 0,
        storedDraftHash: null,
      };
    }
    try {
      const parsed = parseStoredDraft(raw) as {
        picks?: Array<{
          matchId?: string;
          home?: string;
          away?: string;
          th?: string;
          poolCode?: PoolCode;
          optionKey?: string;
          savedGoalLine?: string;
          goalLine?: string;
        }>;
        multiple?: number;
        passSpec?: PassSelectionSpec;
        so?: number | boolean;
        qa?: number;
        w?: number;
        holdRev?: number;
        holdClearedRev?: number;
        clearSeq?: number;
        cs?: string | null;
        hr?: string | null;
        pendingRevokedPlanConfirm?: string | null;
      };
      const reason =
        typeof parsed?.pendingRevokedPlanConfirm === "string" &&
        parsed.pendingRevokedPlanConfirm.trim().length > 0
          ? parsed.pendingRevokedPlanConfirm.trim()
          : null;
      const rawHr =
        typeof parsed?.hr === "string" && parsed.hr.trim().length > 0
          ? parsed.hr.trim()
          : null;
      const rawHoldRev = Math.max(0, Math.floor(Number(parsed?.holdRev) || 0));
      const rawClearedRev = Math.max(
        0,
        Math.floor(Number(parsed?.holdClearedRev) || 0)
      );
      const rawClearSeq = Math.max(
        0,
        Math.floor(Number(parsed?.clearSeq) || 0)
      );
      const rawWriteSeq = Math.max(0, Math.floor(Number(parsed?.w) || 0));
      const rawCs =
        typeof parsed?.cs === "string" && parsed.cs.trim().length > 0
          ? parsed.cs.trim()
          : null;
      const storedDraftHash = computeStoredParsedDraftHash(parsed);
      const storedHoldRev = reason && rawHoldRev === 0 ? 1 : rawHoldRev;
      const holdRev = Math.max(storedHoldRev, busRec?.holdRev ?? 0);
      const holdClearedRev = Math.max(
        rawClearedRev,
        busRec?.holdClearedRev ?? 0
      );
      const clearSeq = Math.max(rawClearSeq, busRec?.clearSeq ?? 0);
      const writeSeq = Math.max(rawWriteSeq, busRec?.writeSeq ?? 0);
      const useStoredHash =
        rawClearSeq > (busRec?.clearSeq ?? 0) ||
        (rawClearSeq === (busRec?.clearSeq ?? 0) &&
          rawClearedRev >= (busRec?.holdClearedRev ?? 0));
      const holdClearedDraftHash = useStoredHash
        ? (rawCs ?? busRec?.holdClearedDraftHash ?? null)
        : (busRec?.holdClearedDraftHash ?? rawCs ?? null);
      const lastHoldReason = reason ?? rawHr ?? busRec?.lastHoldReason ?? null;
      const pendingRevokedPlanConfirm =
        holdRev > holdClearedRev
          ? (reason ??
            lastHoldReason ??
            busRec?.pendingRevokedPlanConfirm ??
            null)
          : null;
      return {
        holdRev,
        holdClearedRev,
        clearSeq,
        writeSeq,
        holdClearedDraftHash,
        lastHoldReason,
        pendingRevokedPlanConfirm,
        rawPresent: true,
        diskHoldRev: storedHoldRev,
        diskHasPendingHold: Boolean(reason),
        boardCapturedAt: Math.max(0, Number(parsed.qa) || 0),
        storedDraftHash,
      };
    } catch {
      return {
        holdRev: busRec?.holdRev ?? 0,
        holdClearedRev: busRec?.holdClearedRev ?? 0,
        clearSeq: busRec?.clearSeq ?? 0,
        writeSeq: busRec?.writeSeq ?? 0,
        holdClearedDraftHash: busRec?.holdClearedDraftHash ?? null,
        lastHoldReason: busRec?.lastHoldReason ?? null,
        pendingRevokedPlanConfirm: busRec?.pendingRevokedPlanConfirm ?? null,
        rawPresent: true,
        diskHoldRev: 0,
        diskHasPendingHold: false,
        boardCapturedAt: 0,
        storedDraftHash: null,
      };
    }
  }

  function armRevokedPlanHold(reason: string) {
    const meta = readStoredHoldMeta();
    const nextRev =
      Math.max(
        localHoldRev,
        clearedHoldRev,
        meta.holdRev,
        meta.holdClearedRev,
        revokedPlanHold?.rev ?? 0
      ) + 1;
    localHoldRev = nextRev;
    myAckedHoldRev = nextRev;
    pendingExplicitUserClear = false;
    revokedPlanHold = { reason, rev: nextRev };
    publishSharedHoldMeta({
      holdRev: nextRev,
      holdClearedRev: Math.max(clearedHoldRev, meta.holdClearedRev),
      clearSeq: Math.max(localClearSeq, meta.clearSeq),
      writeSeq: Math.max(knownStorageWriteSeq, meta.writeSeq),
      holdClearedDraftHash:
        confirmedClearDraftHash ?? meta.holdClearedDraftHash,
      lastHoldReason: reason,
      pendingRevokedPlanConfirm: reason,
    });
  }

  function clearRevokedPlanHoldOnUserAction() {
    revokedPlanHold = null;
    pendingExplicitUserClear = true;
    lastReconciledRef = null;
  }

  function commitPendingExplicitClearIfNeeded() {
    if (!pendingExplicitUserClear) return;
    pendingExplicitUserClear = false;
    if (deferredDraftBoardAt) {
      if (state.picks.length === 0) return;
      // A new explicit selection supersedes the waiting disk ticket.
      deferredDraftBoardAt = 0;
    }
    const meta = readStoredHoldMeta();
    const maxKnownRev = Math.max(
      localHoldRev,
      clearedHoldRev,
      meta.holdRev,
      meta.holdClearedRev,
      revokedPlanHold?.rev ?? 0
    );
    const curTicketHash = computeManualTicketDraftHash(
      state.picks,
      state.multiple,
      state.passSpec,
      state.matches,
      state.syntheticSingleMode
    );
    const ticketEdited = curTicketHash !== lastManualTicketHash;
    lastManualTicketHash = curTicketHash;
    revokedPlanHold = null;
    if (state.picks.length === 0 || state.syntheticSingleMode === "off") {
      hasUnresolvedSyntheticChoice = false;
    } else if (
      hasUnresolvedSyntheticChoice &&
      !state.planSpec &&
      !state.singleAuthGrant &&
      singleRequiresSynthetic(state.picks)
    ) {
      // An ordinary edit may remove the bridge. It does not authorize replacing
      // the remaining leg with a synthetic ticket.
      armRevokedPlanHold(LEGACY_SINGLE_CONFIRMATION);
      pendingExplicitTicketPersist = true;
      return;
    }
    if (state.planSpec === null && state.singleAuthGrant === null) {
      clearedHoldRev = maxKnownRev;
      localHoldRev = Math.max(localHoldRev, clearedHoldRev);
      myAckedHoldRev = localHoldRev;
      if (maxKnownRev > 0 || meta.clearSeq > 0) {
        localClearSeq = Math.max(localClearSeq, meta.clearSeq) + 1;
        confirmedClearDraftHash = curTicketHash;
      }
      pendingExplicitTicketPersist = true;
      publishSharedHoldMeta({
        holdRev: localHoldRev,
        holdClearedRev: clearedHoldRev,
        clearSeq: localClearSeq,
        writeSeq: Math.max(knownStorageWriteSeq, meta.writeSeq),
        holdClearedDraftHash: confirmedClearDraftHash,
        lastHoldReason: meta.lastHoldReason,
        pendingRevokedPlanConfirm: null,
      });
    } else {
      localHoldRev = Math.max(localHoldRev, maxKnownRev);
      if (ticketEdited && maxKnownRev === 0 && meta.clearSeq === 0) {
        pendingExplicitTicketPersist = true;
      }
    }
    lastReconciledRef = null;
  }

  function syncSharedHoldFromStorage(): boolean {
    if (!bootstrapped) return false;
    const meta = readStoredHoldMeta();
    let changed = false;
    const defaultHoldFallbackMsg =
      "原已套用方案涉及场次盘口或单串开售权限已变动，原方案锁定已失效；请确认改按当前手选草稿核对或重新配单后再出票";
    if (
      hadObservedPersistedDraft &&
      !meta.rawPresent &&
      state.picks.length > 0 &&
      state.planSpec === null &&
      state.singleAuthGrant === null &&
      !revokedPlanHold
    ) {
      hadObservedPersistedDraft = false;
      const fallbackReason =
        meta.pendingRevokedPlanConfirm ??
        meta.lastHoldReason ??
        defaultHoldFallbackMsg;
      const nextRev = Math.max(
        1,
        meta.holdRev > Math.max(clearedHoldRev, meta.holdClearedRev)
          ? meta.holdRev
          : Math.max(localHoldRev, clearedHoldRev, meta.holdClearedRev) + 1
      );
      localHoldRev = Math.max(localHoldRev, nextRev);
      myAckedHoldRev = localHoldRev;
      revokedPlanHold = { reason: fallbackReason, rev: nextRev };
      publishSharedHoldMeta({
        holdRev: localHoldRev,
        holdClearedRev: Math.max(clearedHoldRev, meta.holdClearedRev),
        clearSeq: Math.max(localClearSeq, meta.clearSeq),
        writeSeq: Math.max(knownStorageWriteSeq, meta.writeSeq),
        holdClearedDraftHash:
          confirmedClearDraftHash ?? meta.holdClearedDraftHash,
        lastHoldReason: fallbackReason,
        pendingRevokedPlanConfirm: fallbackReason,
      });
      lastReconciledRef = null;
      return true;
    }
    if (meta.rawPresent) {
      hadObservedPersistedDraft = true;
    }
    const myDraftHash = computeManualTicketDraftHash(
      state.picks,
      state.multiple,
      state.passSpec,
      state.matches,
      state.syntheticSingleMode
    );
    const clearMatchesMyDraft = Boolean(
      meta.holdClearedDraftHash && meta.holdClearedDraftHash === myDraftHash
    );

    // 1. If a shared revocation (meta.holdRev > myAckedHoldRev) occurred that this tab has not yet acked:
    if (meta.holdRev > myAckedHoldRev) {
      localHoldRev = Math.max(localHoldRev, meta.holdRev);
      if (meta.holdClearedRev >= meta.holdRev && clearMatchesMyDraft) {
        // Another tab ALREADY confirmed the exact same draft at holdClearedRev >= meta.holdRev
        myAckedHoldRev = meta.holdRev;
        clearedHoldRev = Math.max(clearedHoldRev, meta.holdClearedRev);
        localClearSeq = Math.max(localClearSeq, meta.clearSeq);
        confirmedClearDraftHash = meta.holdClearedDraftHash;
        if (revokedPlanHold && revokedPlanHold.rev <= clearedHoldRev) {
          revokedPlanHold = null;
          computedWorkspaceSig = "";
          changed = true;
        }
      } else if (state.planSpec === null && state.singleAuthGrant === null) {
        // Either nobody confirmed yet OR another tab confirmed a DIFFERENT draft -> this tab's manual draft MUST enter hold!
        myAckedHoldRev = meta.holdRev;
        if (
          state.picks.length > 0 &&
          (!revokedPlanHold || revokedPlanHold.rev < meta.holdRev)
        ) {
          revokedPlanHold = {
            reason:
              meta.pendingRevokedPlanConfirm ??
              meta.lastHoldReason ??
              defaultHoldFallbackMsg,
            rev: meta.holdRev,
          };
          changed = true;
        }
      }
      // Note: if state.planSpec !== null || state.singleAuthGrant !== null, keep myAckedHoldRev un-advanced so dropping to manual later would still hold!
    }

    // 2. Adopt newer clear if it matches this tab's exact manual draft
    if (
      (meta.holdClearedRev > clearedHoldRev || meta.clearSeq > localClearSeq) &&
      clearMatchesMyDraft
    ) {
      clearedHoldRev = Math.max(clearedHoldRev, meta.holdClearedRev);
      localClearSeq = Math.max(localClearSeq, meta.clearSeq);
      localHoldRev = Math.max(localHoldRev, clearedHoldRev);
      myAckedHoldRev = Math.max(myAckedHoldRev, clearedHoldRev);
      confirmedClearDraftHash = meta.holdClearedDraftHash;
      if (revokedPlanHold && revokedPlanHold.rev <= clearedHoldRev) {
        revokedPlanHold = null;
        computedWorkspaceSig = "";
        changed = true;
      }
    }

    // 3. Adopt active shared hold if holdRev > max clearedRev
    if (
      meta.pendingRevokedPlanConfirm &&
      meta.holdRev > Math.max(clearedHoldRev, meta.holdClearedRev)
    ) {
      localHoldRev = Math.max(localHoldRev, meta.holdRev);
      if (
        (!revokedPlanHold || revokedPlanHold.rev < meta.holdRev) &&
        state.planSpec === null &&
        state.singleAuthGrant === null &&
        state.picks.length > 0
      ) {
        myAckedHoldRev = Math.max(myAckedHoldRev, meta.holdRev);
        revokedPlanHold = {
          reason: meta.pendingRevokedPlanConfirm,
          rev: meta.holdRev,
        };
        changed = true;
      }
    }

    if (changed) {
      lastReconciledRef = null;
    }
    return changed;
  }

  function persistManualDraftIfNeeded(s: BetSlipState) {
    if (!bootstrapped) return;
    if (deferredDraftBoardAt) return;
    const explicitTicketWrite = pendingExplicitTicketPersist;
    const previewKnobWrite = pendingPreviewKnobPersist;
    pendingExplicitTicketPersist = false;
    pendingPreviewKnobPersist = null;

    const storage = resolveStorage();
    const key = resolveDraftStorageKey();
    if (!storage || !key) return;
    const meta = readStoredHoldMeta();
    const myDraftHash = computeManualTicketDraftHash(
      s.picks,
      s.multiple,
      s.passSpec,
      s.matches,
      s.syntheticSingleMode
    );
    if (previewKnobWrite && !explicitTicketWrite && meta.rawPresent) {
      // A preview updates one preference on the current shared record. Reading
      // from this tab's projection could replace someone else's legs or permit.
      try {
        const raw = storage.getItem(key);
        if (!raw) return;
        const draft = JSON.parse(raw);
        if (!isSupportedDraftSchema(draft.schemaVersion ?? draft.v)) return;
        if (draft[previewKnobWrite] === s[previewKnobWrite]) return;
        const merged = JSON.stringify({
          ...draft,
          [previewKnobWrite]: s[previewKnobWrite],
          w: Math.max(Number(draft.w) || 0, meta.writeSeq) + 1,
        });
        if (storage.getItem(key) === raw) storage.setItem(key, merged);
      } catch {
        // A full quota must leave the existing ticket intact.
      }
      return;
    }
    const effectiveHoldRev = Math.max(localHoldRev, meta.holdRev);
    const sharedIsUnconfirmedHold = effectiveHoldRev > meta.holdClearedRev;
    const canAdoptMetaClear = Boolean(
      meta.holdClearedDraftHash && meta.holdClearedDraftHash === myDraftHash
    );
    const effectiveClearedRev = canAdoptMetaClear
      ? Math.max(clearedHoldRev, meta.holdClearedRev)
      : clearedHoldRev;
    const effectiveClearSeq =
      (explicitTicketWrite &&
        s.planSpec === null &&
        s.singleAuthGrant === null) ||
      canAdoptMetaClear
        ? Math.max(localClearSeq, meta.clearSeq)
        : localClearSeq;
    const effectiveLastHoldReason =
      revokedPlanHold?.reason ?? meta.lastHoldReason ?? null;
    const effectiveHoldReason =
      sharedIsUnconfirmedHold || explicitTicketWrite
        ? (revokedPlanHold?.reason ??
          (sharedIsUnconfirmedHold && effectiveHoldRev > effectiveClearedRev
            ? (meta.pendingRevokedPlanConfirm ?? meta.lastHoldReason ?? null)
            : null))
        : null;
    const isArmingOrRecoveringSharedHold = Boolean(
      sharedIsUnconfirmedHold &&
      effectiveHoldReason &&
      (effectiveHoldRev > meta.diskHoldRev ||
        !meta.rawPresent ||
        !meta.diskHasPendingHold)
    );

    if (revokedPlanHold && !isArmingOrRecoveringSharedHold) {
      if (
        !sharedIsUnconfirmedHold ||
        (meta.rawPresent &&
          meta.storedDraftHash &&
          meta.storedDraftHash !== myDraftHash)
      ) {
        return;
      }
    }

    if (!explicitTicketWrite && !isArmingOrRecoveringSharedHold) {
      if (previewKnobWrite) {
        if (
          (!sharedIsUnconfirmedHold &&
            (revokedPlanHold || meta.clearSeq > localClearSeq)) ||
          (meta.rawPresent &&
            meta.storedDraftHash &&
            meta.storedDraftHash !== myDraftHash)
        ) {
          return;
        }
      } else {
        // Passive path: never overwrite another tab's newer writeSeq, newer clearSeq, or while locally held
        if (
          revokedPlanHold ||
          !meta.rawPresent ||
          meta.writeSeq !== knownStorageWriteSeq ||
          meta.boardCapturedAt > latestBoardCapturedAt ||
          meta.clearSeq > localClearSeq ||
          (meta.storedDraftHash && meta.storedDraftHash !== myDraftHash)
        ) {
          return;
        }
      }
    }

    const effectiveClearedHash =
      effectiveClearedRev > 0 || effectiveClearSeq > 0
        ? (confirmedClearDraftHash ??
          (canAdoptMetaClear ? meta.holdClearedDraftHash : null) ??
          (s.planSpec === null && s.singleAuthGrant === null
            ? myDraftHash
            : null))
        : null;
    const matchMap = new Map(s.matches.map((m) => [m.id, m]));
    const fullPicks = s.picks.map((pk) => {
      const fm = matchMap.get(pk.matchId);
      const boardGl = String(
        pk.goalLine ?? fm?.pools?.[pk.poolCode]?.goalLine ?? ""
      ).trim();
      const th = computeOrderedMatchIdentitySig(
        fm ?? pk,
        Boolean(fm?.homeTeamId || fm?.awayTeamId)
      );
      return {
        ...pk,
        th,
        ...(boardGl ? { goalLine: boardGl } : {}),
        ...(pk.poolCode === "HHAD" ? { savedGoalLine: boardGl } : {}),
      };
    });
    const cleanBudget = normalizeBudgetYuan(s.budget);
    const cleanAllowSaveCash = Boolean(s.allowSaveCash);
    const persistSynOff = s.picks.length > 0 && s.syntheticSingleMode === "off";
    const persistLegacyUnresolved =
      hasUnresolvedSyntheticChoice && s.picks.length > 0 && !persistSynOff;
    const persistBoardQa = Math.max(
      latestBoardCapturedAt,
      meta.storedDraftHash === myDraftHash ? meta.boardCapturedAt : 0
    );

    const nextWriteSeq =
      explicitTicketWrite || isArmingOrRecoveringSharedHold || previewKnobWrite
        ? Math.max(knownStorageWriteSeq, meta.writeSeq) + 1
        : Math.max(1, knownStorageWriteSeq, meta.writeSeq);

    const holdFields =
      effectiveHoldRev > 0
        ? {
            holdRev: effectiveHoldRev,
            ...(effectiveClearedRev > 0
              ? { holdClearedRev: effectiveClearedRev }
              : {}),
            ...(effectiveClearSeq > 0 ? { clearSeq: effectiveClearSeq } : {}),
            ...(effectiveClearedHash ? { cs: effectiveClearedHash } : {}),
            ...(effectiveHoldReason
              ? { pendingRevokedPlanConfirm: effectiveHoldReason }
              : effectiveLastHoldReason
                ? { hr: effectiveLastHoldReason }
                : {}),
          }
        : {};
    const synField = {
      ...(persistSynOff ? { so: 1 as const } : {}),
      ...(persistLegacyUnresolved ? { lu: 1 as const } : {}),
      ...(!persistSynOff && syntheticApproval ? { sc: syntheticApproval } : {}),
    };
    const qaField = persistBoardQa > 0 ? { qa: persistBoardQa } : {};
    const sourceCompareObj = {
      picks: fullPicks,
      multiple: s.multiple,
      passSpec: s.passSpec,
      budget: cleanBudget,
      stance: s.stance,
      allowSaveCash: cleanAllowSaveCash,
      ...synField,
      ...qaField,
      ...holdFields,
    };
    const sourceSigJson = JSON.stringify(sourceCompareObj);
    if (
      !explicitTicketWrite &&
      !isArmingOrRecoveringSharedHold &&
      sourceSigJson === lastPersistedSourceJson &&
      lastPersistedDraftJson
    ) {
      try {
        if (storage.getItem(key) === lastPersistedDraftJson) return;
      } catch {
        // rewrite below
      }
    }
    const payload = {
      schemaVersion: CURRENT_DRAFT_SCHEMA,
      ...sourceCompareObj,
      w: nextWriteSeq,
    };
    const json = JSON.stringify(payload);
    const onWriteSuccess = (written: string) => {
      knownStorageWriteSeq = nextWriteSeq;
      lastPersistedSourceJson = sourceSigJson;
      lastPersistedDraftJson = written;
      publishSharedHoldMeta({
        holdRev: effectiveHoldRev,
        holdClearedRev: effectiveClearedRev,
        clearSeq: effectiveClearSeq,
        writeSeq: nextWriteSeq,
        holdClearedDraftHash: effectiveClearedHash,
        lastHoldReason: effectiveLastHoldReason,
        pendingRevokedPlanConfirm: effectiveHoldReason,
      });
    };
    const tryWrite = (candidate: string): boolean => {
      try {
        storage.setItem(key, candidate);
        if (storage.getItem(key) === candidate) {
          hadObservedPersistedDraft = true;
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    if (tryWrite(json)) {
      onWriteSuccess(json);
      return;
    }
    const compactPicks = fullPicks.map((pk) => ({
      matchId: pk.matchId,
      home: pk.home,
      away: pk.away,
      th: pk.th,
      poolCode: pk.poolCode,
      optionKey: pk.optionKey,
      ...(pk.poolCode === "HHAD" && pk.savedGoalLine
        ? { savedGoalLine: pk.savedGoalLine }
        : {}),
    }));
    const compactJson = JSON.stringify({
      schemaVersion: CURRENT_DRAFT_SCHEMA,
      picks: compactPicks,
      multiple: s.multiple,
      passSpec: s.passSpec,
      ...(cleanBudget !== 100 ? { budget: cleanBudget } : {}),
      ...(s.stance !== "objective" ? { stance: s.stance } : {}),
      ...(cleanAllowSaveCash ? { allowSaveCash: true } : {}),
      ...synField,
      ...qaField,
      ...holdFields,
      w: nextWriteSeq,
    });
    if (tryWrite(compactJson)) {
      onWriteSuccess(compactJson);
      return;
    }
    const isDefaultPass = s.passSpec.mode === "follow-max-parlay";
    const minimalBase = {
      schemaVersion: CURRENT_DRAFT_SCHEMA,
      picks: compactPicks.map((pk) => ({
        matchId: pk.matchId,
        poolCode: pk.poolCode,
        optionKey: pk.optionKey,
        th: pk.th,
        ...(pk.savedGoalLine ? { savedGoalLine: pk.savedGoalLine } : {}),
      })),
      ...(s.multiple !== 5 ? { multiple: s.multiple } : {}),
      ...(!isDefaultPass ? { passSpec: s.passSpec } : {}),
      ...synField,
      ...holdFields,
    };
    const minimalJson = JSON.stringify({
      ...minimalBase,
      ...qaField,
      w: nextWriteSeq,
    });
    if (tryWrite(minimalJson)) {
      onWriteSuccess(minimalJson);
      return;
    }
    const { schemaVersion, ...minimalFields } = minimalBase;
    const shortestJson = JSON.stringify({
      v: schemaVersion,
      ...minimalFields,
      ...qaField,
      w: nextWriteSeq,
    });
    if (tryWrite(shortestJson)) {
      onWriteSuccess(shortestJson);
      return;
    }
    // A quota may fit the selections without their confirmation evidence.
    // The cold reader will quote the ticket again and require confirmation.
    if (syntheticApproval) {
      const withoutApproval = JSON.stringify({
        v: schemaVersion,
        ...minimalFields,
        sc: undefined,
        ...qaField,
        w: nextWriteSeq,
      });
      if (tryWrite(withoutApproval)) {
        onWriteSuccess(withoutApproval);
        return;
      }
    }
    if (!explicitTicketWrite && !isArmingOrRecoveringSharedHold) return;
    if (effectiveHoldReason || meta.rawPresent) {
      hadObservedPersistedDraft = false;
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
      lastPersistedSourceJson = "";
      lastPersistedDraftJson = "";
    }
  }

  function pruneInvalidatedStoredDraftAgainstBoard(
    boardMatches: MatchItem[],
    preDropLocalDraftHash?: string,
    boardCapturedAt?: number,
    verifiedDraftRaw?: string
  ) {
    const storage = resolveStorage();
    const key = resolveDraftStorageKey();
    if (!storage || !key) return;
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) return;
    let parsed: {
      schemaVersion?: number;
      picks?: Array<SelectedPick & { savedGoalLine?: string; th?: string }>;
      multiple?: number;
      passSpec?: PassSelectionSpec;
      so?: number | boolean;
      lu?: number | boolean;
      sc?: unknown;
      qa?: number;
      w?: number;
      budget?: number;
      stance?: UserStance;
      allowSaveCash?: boolean;
      pendingRevokedPlanConfirm?: string | null;
      hr?: string | null;
      holdRev?: number;
      holdClearedRev?: number;
      clearSeq?: number;
      cs?: string | null;
    };
    try {
      parsed = parseStoredDraft(raw);
    } catch {
      return;
    }
    if (
      !parsed ||
      !isSupportedDraftSchema(parsed.schemaVersion) ||
      !Array.isArray(parsed.picks) ||
      parsed.picks.length === 0
    ) {
      return;
    }
    const storedQa = Math.max(0, Math.floor(Number(parsed.qa) || 0));
    const incomingQa = Math.max(0, Math.floor(Number(boardCapturedAt) || 0));
    // Missing or equal capture times cannot resolve a content conflict. Only a
    // live acquisition started for this unchanged revision can retire its legs.
    const coveredByCapture = storedQa > 0 && incomingQa > storedQa;
    if (
      incomingQa < storedQa ||
      (!coveredByCapture && raw !== verifiedDraftRaw)
    ) {
      return;
    }
    const byId = new Map(boardMatches.map((m) => [m.id, m]));
    const keptPicks: Array<
      SelectedPick & { savedGoalLine?: string; th?: string }
    > = [];
    for (const pk of parsed.picks) {
      const fm = byId.get(pk.matchId);
      if (!verifySavedPickMatchIdentity(fm, pk)) continue;
      const pool = fm.pools?.[pk.poolCode];
      const canSingle = resolvePoolCanSingle(pool);
      const canAllUp = resolvePoolCanAllUp(pool);
      if (!pool || pool.selling === false || (!canSingle && !canAllUp)) {
        continue;
      }
      const savedGl = String(pk.savedGoalLine ?? pk.goalLine ?? "").trim();
      const curGl = String(pool.goalLine ?? "").trim();
      if (pk.poolCode === "HHAD" && savedGl && curGl !== savedGl) {
        continue;
      }
      const opt = pool.options?.find((o) => o.key === pk.optionKey);
      if (
        !opt ||
        !Number.isFinite(Number(opt.odds)) ||
        Number(opt.odds) < 1.01
      ) {
        continue;
      }
      const th = computeOrderedMatchIdentitySig(
        fm,
        Boolean(fm.homeTeamId || fm.awayTeamId)
      );
      keptPicks.push({
        ...pk,
        matchId: fm.id,
        matchNumStr: fm.matchNumStr,
        home: fm.home,
        away: fm.away,
        th,
        poolName: pool.name,
        singleAllowed: canSingle,
        canSingle,
        canAllUp,
        ...resolveOptionalGoalLine(pk.poolCode, pool, savedGl),
        ...(pk.poolCode === "HHAD" && curGl ? { savedGoalLine: curGl } : {}),
        optionKey: opt.key,
        optionLabel: opt.label,
        odds: opt.odds,
        fairProb: opt.fairProb,
      });
    }
    if (keptPicks.length === parsed.picks.length) return;

    const meta = readStoredHoldMeta();
    const prePruneHash = computeStoredParsedDraftHash(parsed);
    const legacyR10PreHash =
      parsed.schemaVersion === 1 && !parsed.so
        ? computeLegacyR10AutoDraftHash(parsed)
        : null;
    const rawMult = Math.max(
      1,
      Math.min(999, Math.round(Number(parsed.multiple) || 5))
    );
    const cleanBudget = normalizeBudgetYuan(Number(parsed.budget) || 100);
    const cleanStance: UserStance =
      parsed.stance === "home-lean" || parsed.stance === "upset-watch"
        ? parsed.stance
        : "objective";
    const cleanAllowSaveCash = Boolean(parsed.allowSaveCash);
    const prunedPass = sanitizePassSpecForPicks(
      parsed.passSpec ?? { mode: "follow-max-parlay" },
      keptPicks
    );
    const keepSynOff = keptPicks.length > 0 && Boolean(parsed.so);
    const savedApproval = readSyntheticApproval(
      parsed.schemaVersion,
      parsed.sc
    );
    const keepLegacyUnresolved =
      keptPicks.length > 0 && !keepSynOff && draftNeedsSyntheticChoice(parsed);
    const postPruneHash =
      keptPicks.length === 0
        ? "empty"
        : computeStoredParsedDraftHash({
            picks: keptPicks,
            multiple: rawMult,
            passSpec: prunedPass,
            ...(keepSynOff ? { so: 1 } : {}),
          });

    const diskHoldRev = Math.max(
      0,
      Math.floor(Number(parsed.holdRev) || 0),
      parsed.pendingRevokedPlanConfirm ? 1 : 0
    );
    const diskClearedRev = Math.max(
      0,
      Math.floor(Number(parsed.holdClearedRev) || 0)
    );
    const diskClearSeq = Math.max(0, Math.floor(Number(parsed.clearSeq) || 0));
    const diskCs =
      typeof parsed.cs === "string" && parsed.cs.trim()
        ? parsed.cs.trim()
        : null;
    const effHoldRev = Math.max(localHoldRev, meta.holdRev, diskHoldRev);
    const diskMatchesPrePrune = Boolean(
      diskCs &&
      (diskCs === prePruneHash ||
        (legacyR10PreHash !== null && diskCs === legacyR10PreHash))
    );
    const busMatchesPrePrune = Boolean(
      meta.holdClearedDraftHash &&
      (meta.holdClearedDraftHash === prePruneHash ||
        (legacyR10PreHash !== null &&
          meta.holdClearedDraftHash === legacyR10PreHash))
    );
    const effClearedBefore = Math.max(
      !parsed.pendingRevokedPlanConfirm && diskMatchesPrePrune
        ? diskClearedRev
        : 0,
      busMatchesPrePrune ? meta.holdClearedRev : 0
    );
    const wasConfirmedAtEffRev =
      !parsed.pendingRevokedPlanConfirm &&
      effHoldRev > 0 &&
      effClearedBefore >= effHoldRev;

    const prunedClearedRev = wasConfirmedAtEffRev
      ? effClearedBefore
      : diskClearedRev;
    const prunedClearSeq = wasConfirmedAtEffRev
      ? Math.max(diskClearSeq, meta.clearSeq)
      : diskClearSeq;
    const prunedCs = wasConfirmedAtEffRev ? postPruneHash : diskCs;
    const prunedLastReason =
      revokedPlanHold?.reason ??
      (typeof parsed.pendingRevokedPlanConfirm === "string" &&
      parsed.pendingRevokedPlanConfirm.trim()
        ? parsed.pendingRevokedPlanConfirm.trim()
        : null) ??
      (typeof parsed.hr === "string" && parsed.hr.trim()
        ? parsed.hr.trim()
        : null) ??
      meta.lastHoldReason ??
      null;
    const prunedPendingHold =
      effHoldRev > prunedClearedRev && keptPicks.length > 0
        ? prunedLastReason
        : null;
    const nextQa = Math.max(storedQa, incomingQa);
    const nextW =
      Math.max(
        knownStorageWriteSeq,
        Math.floor(Number(parsed.w) || 0),
        meta.writeSeq
      ) + 1;

    const holdFields =
      effHoldRev > 0
        ? {
            holdRev: effHoldRev,
            ...(prunedClearedRev > 0
              ? { holdClearedRev: prunedClearedRev }
              : {}),
            ...(prunedClearSeq > 0 ? { clearSeq: prunedClearSeq } : {}),
            ...(prunedCs ? { cs: prunedCs } : {}),
            ...(prunedPendingHold
              ? { pendingRevokedPlanConfirm: prunedPendingHold }
              : prunedLastReason
                ? { hr: prunedLastReason }
                : {}),
          }
        : {};
    const synField = {
      ...(keepSynOff ? { so: 1 as const } : {}),
      ...(keepLegacyUnresolved ? { lu: 1 as const } : {}),
      ...(!keepSynOff &&
      savedApproval &&
      keptPicks.some((pick) => pick.matchId === savedApproval.matchId)
        ? { sc: savedApproval }
        : {}),
    };
    const qaField = nextQa > 0 ? { qa: nextQa } : {};
    const tryWrite = (candidate: string): boolean => {
      try {
        storage.setItem(key, candidate);
        if (storage.getItem(key) === candidate) {
          hadObservedPersistedDraft = true;
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };
    const fullCandidate = JSON.stringify({
      schemaVersion: CURRENT_DRAFT_SCHEMA,
      picks: keptPicks,
      multiple: rawMult,
      passSpec: prunedPass,
      budget: cleanBudget,
      stance: cleanStance,
      allowSaveCash: cleanAllowSaveCash,
      ...synField,
      ...qaField,
      ...holdFields,
      w: nextW,
    });
    const compactPicks = keptPicks.map((pk) => ({
      matchId: pk.matchId,
      home: pk.home,
      away: pk.away,
      th: pk.th,
      poolCode: pk.poolCode,
      optionKey: pk.optionKey,
      ...(pk.poolCode === "HHAD" && pk.savedGoalLine
        ? { savedGoalLine: pk.savedGoalLine }
        : {}),
    }));
    const compactCandidate = JSON.stringify({
      schemaVersion: CURRENT_DRAFT_SCHEMA,
      picks: compactPicks,
      multiple: rawMult,
      passSpec: prunedPass,
      ...(cleanBudget !== 100 ? { budget: cleanBudget } : {}),
      ...(cleanStance !== "objective" ? { stance: cleanStance } : {}),
      ...(cleanAllowSaveCash ? { allowSaveCash: true } : {}),
      ...synField,
      ...qaField,
      ...holdFields,
      w: nextW,
    });
    const isDefaultPass = prunedPass.mode === "follow-max-parlay";
    const minimalBase = {
      schemaVersion: CURRENT_DRAFT_SCHEMA,
      picks: compactPicks.map((pk) => ({
        matchId: pk.matchId,
        poolCode: pk.poolCode,
        optionKey: pk.optionKey,
        th: pk.th,
        ...(pk.savedGoalLine ? { savedGoalLine: pk.savedGoalLine } : {}),
      })),
      ...(rawMult !== 5 ? { multiple: rawMult } : {}),
      ...(!isDefaultPass ? { passSpec: prunedPass } : {}),
      ...synField,
      ...holdFields,
    };
    const minimalCandidate = JSON.stringify({
      ...minimalBase,
      ...qaField,
      w: nextW,
    });
    const { schemaVersion, ...minimalFields } = minimalBase;
    const shortestCandidate = JSON.stringify({
      v: schemaVersion,
      ...minimalFields,
      ...qaField,
      w: nextW,
    });
    if (resolveDraftStorageKey() !== key || readCurrentDraftBytes() !== raw)
      return;
    let written: string | null = null;
    if (tryWrite(fullCandidate)) written = fullCandidate;
    else if (tryWrite(compactCandidate)) written = compactCandidate;
    else if (tryWrite(minimalCandidate)) written = minimalCandidate;
    else if (tryWrite(shortestCandidate)) written = shortestCandidate;
    else if (savedApproval) {
      const withoutApproval = JSON.stringify({
        v: schemaVersion,
        ...minimalFields,
        sc: undefined,
        ...qaField,
        w: nextW,
      });
      if (tryWrite(withoutApproval)) written = withoutApproval;
    }
    if (!written) {
      hadObservedPersistedDraft = false;
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
      lastPersistedSourceJson = "";
      lastPersistedDraftJson = "";
      if (preDropLocalDraftHash && preDropLocalDraftHash === prePruneHash) {
        knownStorageWriteSeq = nextW;
        lastManualTicketHash = postPruneHash ?? "empty";
        if (confirmedClearDraftHash === prePruneHash) {
          confirmedClearDraftHash = postPruneHash ?? "empty";
        }
      }
      // Another open tab may still display the pre-stop ticket. Notify it even
      // when this was the first revocation and the quota cannot store a marker.
      const evictionRev = Math.max(effHoldRev, prunedClearedRev + 1);
      const evictionReason =
        prunedPendingHold ?? "草稿所选场次或玩法已停售，请核对后重新选赛";
      publishSharedHoldMeta({
        holdRev: evictionRev,
        holdClearedRev: prunedClearedRev,
        clearSeq: prunedClearSeq,
        writeSeq: nextW,
        holdClearedDraftHash: prunedCs,
        lastHoldReason: evictionReason,
        pendingRevokedPlanConfirm: evictionReason,
      });
      return;
    }

    if (preDropLocalDraftHash && preDropLocalDraftHash === prePruneHash) {
      knownStorageWriteSeq = nextW;
      lastManualTicketHash = postPruneHash ?? "empty";
      lastPersistedDraftJson = written;
      lastPersistedSourceJson = "";
      if (confirmedClearDraftHash === prePruneHash) {
        confirmedClearDraftHash = postPruneHash ?? "empty";
      }
    }
    if (effHoldRev > 0) {
      publishSharedHoldMeta({
        holdRev: effHoldRev,
        holdClearedRev: prunedClearedRev,
        clearSeq: prunedClearSeq,
        writeSeq: nextW,
        holdClearedDraftHash: prunedCs,
        lastHoldReason: prunedLastReason,
        pendingRevokedPlanConfirm: prunedPendingHold,
      });
    }
  }

  function restoreSavedDraftAgainstMatches(
    cleanMatches: MatchItem[],
    boardMeta?: BoardFreshnessMeta | null,
    verifiedDraftRaw?: string
  ): {
    restored: boolean;
    picks: SelectedPick[];
    multiple: number;
    passSpec: PassSelectionSpec;
    syntheticSingleMode: SyntheticSingleMode;
    budget: number;
    stance: UserStance;
    allowSaveCash: boolean;
    notice: string | null;
    pendingRevokedPlanConfirm: string | null;
    holdRev: number;
    holdClearedRev: number;
    clearSeq: number;
    writeSeq: number;
    holdClearedDraftHash: string | null;
    droppedCount: number;
    legacyNeedsFutureSynGuard: boolean;
    approval: SyntheticTicketApproval | null;
    waitForBoardAt: number;
  } | null {
    const storage = resolveStorage();
    const key = resolveDraftStorageKey();
    if (!storage || !key) return null;
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      raw = null;
    }
    if (!raw) return null;
    hadObservedPersistedDraft = true;
    try {
      const parsed = parseStoredDraft(raw) as {
        schemaVersion?: number;
        picks?: Array<SelectedPick & { savedGoalLine?: string; th?: string }>;
        multiple?: number;
        passSpec?: PassSelectionSpec;
        so?: number | boolean;
        lu?: number | boolean;
        sc?: unknown;
        qa?: number;
        w?: number;
        budget?: number;
        stance?: UserStance;
        allowSaveCash?: boolean;
        pendingRevokedPlanConfirm?: string | null;
        hr?: string | null;
        holdRev?: number;
        holdClearedRev?: number;
        clearSeq?: number;
        cs?: string | null;
      };
      if (!parsed || !isSupportedDraftSchema(parsed.schemaVersion)) {
        return null;
      }
      const savedPicks = Array.isArray(parsed.picks) ? parsed.picks : [];
      const byId = new Map(cleanMatches.map((m) => [m.id, m]));
      const validPicks: SelectedPick[] = [];
      let droppedCount = 0;
      let goalLineShiftedCount = 0;
      for (const pk of savedPicks) {
        const fm = byId.get(pk.matchId);
        if (!verifySavedPickMatchIdentity(fm, pk)) {
          droppedCount += 1;
          continue;
        }
        const pool = fm.pools?.[pk.poolCode];
        const canSingle = resolvePoolCanSingle(pool);
        const canAllUp = resolvePoolCanAllUp(pool);
        if (!pool || pool.selling === false || (!canSingle && !canAllUp)) {
          droppedCount += 1;
          continue;
        }
        const savedGl = String(pk.savedGoalLine ?? pk.goalLine ?? "").trim();
        const curGl = String(pool.goalLine ?? "").trim();
        if (pk.poolCode === "HHAD" && savedGl && curGl !== savedGl) {
          droppedCount += 1;
          goalLineShiftedCount += 1;
          continue;
        }
        const opt = pool.options?.find((o) => o.key === pk.optionKey);
        if (
          !opt ||
          !Number.isFinite(Number(opt.odds)) ||
          Number(opt.odds) < 1.01
        ) {
          droppedCount += 1;
          continue;
        }
        const th = computeOrderedMatchIdentitySig(
          fm,
          Boolean(fm.homeTeamId || fm.awayTeamId)
        );
        validPicks.push({
          matchId: fm.id,
          matchNumStr: fm.matchNumStr,
          home: fm.home,
          away: fm.away,
          th,
          poolCode: pk.poolCode,
          poolName: pool.name,
          singleAllowed: canSingle,
          canSingle,
          canAllUp,
          ...resolveOptionalGoalLine(pk.poolCode, pool, savedGl),
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        });
      }
      const nextMultiple = Math.max(
        1,
        Math.min(999, Math.round(Number(parsed.multiple) || 5))
      );
      const nextBudget = normalizeBudgetYuan(Number(parsed.budget) || 100);
      const nextStance: UserStance =
        parsed.stance === "home-lean" || parsed.stance === "upset-watch"
          ? parsed.stance
          : "objective";
      const nextAllowSaveCash = Boolean(parsed.allowSaveCash);
      const rawPass: PassSelectionSpec = parsed.passSpec ?? {
        mode: "follow-max-parlay",
      };
      const nextPassSpec = sanitizePassSpecForPicks(rawPass, validPicks);
      const nextSynMode: SyntheticSingleMode =
        validPicks.length > 0 && parsed.so ? "off" : "full-3way";
      const notice =
        goalLineShiftedCount > 0
          ? `已校验上次选单草稿，自动剔除 ${droppedCount} 项过期或让球变盘选项，请按最新让球线重新核对`
          : droppedCount > 0
            ? `已校验上次选单草稿，自动剔除 ${droppedCount} 项已停售或跨期下架的选项`
            : null;
      const meta = readStoredHoldMeta();
      const preDropStoredHash = computeStoredParsedDraftHash(parsed);
      const legacyR10AutoHash =
        parsed.schemaVersion === 1 && !parsed.so
          ? computeLegacyR10AutoDraftHash(parsed)
          : null;
      const restoredDraftHash = computeManualTicketDraftHash(
        validPicks,
        nextMultiple,
        nextPassSpec,
        cleanMatches,
        nextSynMode
      );
      const diskHoldRev = Math.floor(Number(parsed.holdRev) || 0);
      const diskClearedRev = Math.floor(Number(parsed.holdClearedRev) || 0);
      const diskCs =
        typeof parsed.cs === "string" && parsed.cs.trim().length > 0
          ? parsed.cs.trim()
          : null;
      const diskClearApplies =
        !parsed.pendingRevokedPlanConfirm &&
        Boolean(
          diskCs &&
          (diskCs === preDropStoredHash ||
            diskCs === restoredDraftHash ||
            (legacyR10AutoHash !== null && diskCs === legacyR10AutoHash))
        );
      const busClearApplies = Boolean(
        meta.holdClearedDraftHash &&
        (meta.holdClearedDraftHash === preDropStoredHash ||
          meta.holdClearedDraftHash === restoredDraftHash ||
          (legacyR10AutoHash !== null &&
            meta.holdClearedDraftHash === legacyR10AutoHash))
      );

      let effectiveHoldRev = Math.max(
        meta.holdRev,
        diskHoldRev,
        parsed.pendingRevokedPlanConfirm ? 1 : 0
      );
      const effectiveClearedRev = Math.max(
        diskClearApplies ? diskClearedRev : 0,
        busClearApplies ? meta.holdClearedRev : 0
      );
      const rawClearSeq = Math.max(
        busClearApplies ? meta.clearSeq : 0,
        diskClearApplies ? Math.floor(Number(parsed.clearSeq) || 0) : 0
      );
      const rawWriteSeq = Math.max(
        meta.writeSeq,
        Math.floor(Number(parsed.w) || 0)
      );
      const rawReason =
        (typeof parsed.pendingRevokedPlanConfirm === "string" &&
        parsed.pendingRevokedPlanConfirm.trim().length > 0
          ? parsed.pendingRevokedPlanConfirm.trim()
          : null) ??
        (typeof parsed.hr === "string" && parsed.hr.trim().length > 0
          ? parsed.hr.trim()
          : null) ??
        meta.pendingRevokedPlanConfirm ??
        meta.lastHoldReason;

      const legacyNeedsFutureSynGuard =
        validPicks.length > 0 && draftNeedsSyntheticChoice(parsed);
      const isLegacyAmbiguousSingle =
        legacyNeedsFutureSynGuard && singleRequiresSynthetic(validPicks);

      if (isLegacyAmbiguousSingle) {
        effectiveHoldRev = Math.max(
          1,
          effectiveHoldRev,
          effectiveClearedRev + 1
        );
      }

      const defaultHoldMsg =
        "原已套用方案涉及场次盘口或单串开售权限已变动，原方案锁定已失效；请确认改按当前手选草稿核对或重新配单后再出票";
      const savedHoldReason =
        validPicks.length > 0 && effectiveHoldRev > effectiveClearedRev
          ? isLegacyAmbiguousSingle
            ? (rawReason ?? LEGACY_SINGLE_CONFIRMATION)
            : (rawReason ?? defaultHoldMsg)
          : null;
      const effectiveCs =
        savedHoldReason === null &&
        effectiveHoldRev > 0 &&
        validPicks.length > 0
          ? restoredDraftHash
          : ((diskClearApplies ? diskCs : null) ??
            (busClearApplies ? meta.holdClearedDraftHash : null));
      const storedAt = Number(parsed.qa) || 0;
      const boardAt = extractBoardCapturedAt(boardMeta);
      const fullQuoteMatches = validPicks.every((pick, i) => {
        const saved = savedPicks[i];
        return (
          pick.odds === saved.odds &&
          pick.canSingle === saved.canSingle &&
          pick.canAllUp === saved.canAllUp
        );
      });
      const hasKnownConflict =
        droppedCount > 0 ||
        validPicks.some((pick, i) => {
          const saved = savedPicks[i];
          return (
            (saved.odds !== undefined && pick.odds !== saved.odds) ||
            (saved.canSingle !== undefined &&
              pick.canSingle !== saved.canSingle) ||
            (saved.canAllUp !== undefined && pick.canAllUp !== saved.canAllUp)
          );
        });
      const sameCapture =
        storedAt > 0 && boardAt === storedAt && !hasKnownConflict;
      const newerCapture = storedAt > 0 && boardAt > storedAt;
      const freshForThisRevision =
        raw === verifiedDraftRaw && boardAt >= storedAt;
      const exactTicketOrPendingChoice =
        !droppedCount &&
        fullQuoteMatches &&
        (!singleRequiresSynthetic(validPicks) ||
          isLegacyAmbiguousSingle ||
          Boolean(parsed.so));
      const approval =
        nextSynMode === "off"
          ? null
          : readSyntheticApproval(parsed.schemaVersion, parsed.sc);
      const sameReferenceDraft =
        boardMeta?.isFallbackReadOnly &&
        approval?.referenceOnly === true &&
        !savedHoldReason &&
        !droppedCount &&
        fullQuoteMatches &&
        (sameCapture || newerCapture);
      const canRestore =
        sameReferenceDraft ||
        (!boardMeta?.isFallbackReadOnly &&
          (sameCapture ||
            newerCapture ||
            freshForThisRevision ||
            exactTicketOrPendingChoice));
      // -1 denotes an unknown original capture. A forced live acquisition
      // after reading the same bytes can resolve that case.
      const waitForBoardAt =
        savedPicks.length && !canRestore ? storedAt || -1 : 0;
      return {
        restored:
          validPicks.length > 0 ||
          droppedCount > 0 ||
          savedHoldReason !== null ||
          nextSynMode === "off" ||
          nextMultiple !== 5 ||
          nextBudget !== 100 ||
          nextStance !== "objective" ||
          nextAllowSaveCash !== false,
        picks: validPicks,
        multiple: nextMultiple,
        passSpec: nextPassSpec,
        syntheticSingleMode: nextSynMode,
        budget: nextBudget,
        stance: nextStance,
        allowSaveCash: nextAllowSaveCash,
        notice,
        pendingRevokedPlanConfirm: savedHoldReason,
        holdRev: effectiveHoldRev,
        holdClearedRev: effectiveClearedRev,
        clearSeq: rawClearSeq,
        writeSeq: rawWriteSeq,
        holdClearedDraftHash: effectiveCs,
        droppedCount,
        waitForBoardAt,
        legacyNeedsFutureSynGuard,
        approval,
      };
    } catch {
      return null;
    }
  }

  function mintSingleAuthGrant(
    s: BetSlipState,
    mode: SyntheticSingleMode,
    explicitPreview?: PartialCoveragePreview | null,
    approvedBaseLines?: PlanTicketLine[]
  ): SingleAuthGrant | null {
    if (mode === "off") return null;
    const distinctIds = Array.from(new Set(s.picks.map((p) => p.matchId)));
    if (distinctIds.length !== 1) return null;
    const matchId = distinctIds[0];
    if (!matchId) return null;
    const preview =
      explicitPreview ??
      s.workspace.effectiveReport.partialCoveragePreview ??
      s.workspace.manualReport.partialCoveragePreview ??
      s.workspace.effectiveReport.trim2WayPreview ??
      s.workspace.manualReport.trim2WayPreview ??
      null;
    if (
      mode === "full-3way" &&
      !explicitPreview &&
      !approvedBaseLines?.length &&
      !preview?.requiresExplicitConfirm
    ) {
      return null;
    }
    const picksSig = buildRadarSignature(s.picks);
    const fm = s.matches.find((m) => m.id === matchId);
    const pickedHasHhad = s.picks.some((p) => p.poolCode === "HHAD");
    const hhadPick = s.picks.find((p) => p.poolCode === "HHAD");
    const goalLine = pickedHasHhad
      ? String(fm?.pools?.HHAD?.goalLine ?? hhadPick?.goalLine ?? "").trim()
      : "";
    const quoteVersionSig = computeSingleMatchQuoteVersionSig(fm);
    const modeLines =
      approvedBaseLines ??
      (mode === "trim-2way" ? preview?.trim2WayLines : preview?.previewLines);
    const exactCost = approvedBaseLines
      ? approvedBaseLines.reduce((sum, line) => sum + line.cost, 0)
      : mode === "trim-2way"
        ? typeof preview?.trim2WayCost === "number" && preview.trim2WayCost > 0
          ? preview.trim2WayCost
          : undefined
        : typeof preview?.previewCost === "number" && preview.previewCost > 0
          ? preview.previewCost
          : undefined;
    const coveredMaskSig =
      modeLines && modeLines.length > 0
        ? modeLines
            .map((ln) =>
              ln.legs
                .map((lg) => `${lg.poolCode}:${lg.optionKey}`)
                .sort()
                .join("+")
            )
            .sort()
            .join(";")
        : (s.workspace.manualReport.syntheticRescuePicks ?? [])
            .map((pk) => `${pk.poolCode}:${pk.optionKey}`)
            .sort()
            .join("|");
    const extPreview = preview as
      | (PartialCoveragePreview & {
          lineAndMultipleSig?: string;
          trim2WayLineAndMultipleSig?: string;
        })
      | null;
    const precomputedModeLineSig =
      mode === "trim-2way"
        ? extPreview?.trim2WayLineAndMultipleSig
        : extPreview?.lineAndMultipleSig;
    const lineAndMultipleSig =
      modeLines && modeLines.length > 0
        ? encodeSyntheticLinesSig(modeLines, s.multiple)
        : precomputedModeLineSig && precomputedModeLineSig.length > 0
          ? precomputedModeLineSig
          : `m=${s.multiple}|${coveredMaskSig}`;
    const effRep = s.workspace.baselineReport ?? s.workspace.effectiveReport;
    const approvedCost =
      exactCost ??
      (mode !== "trim-2way"
        ? (preview?.authorizedCostCap ??
          (effRep.canCheckout && effRep.totalCost > 0
            ? effRep.totalCost
            : Number.MAX_SAFE_INTEGER))
        : Number.MAX_SAFE_INTEGER);
    authGrantSeq += 1;
    return {
      authId: `sa_${authGrantSeq}_${nowFn()}`,
      matchId,
      picksSig,
      goalLine,
      targetMaskSig: picksSig,
      coveredMaskSig,
      lineAndMultipleSig,
      draftRevision,
      quoteVersionSig,
      ruleVersion: "sporttery-2026-v1",
      approvedCost,
      ...(exactCost !== undefined ? { exactCost } : {}),
      mode,
    };
  }

  function freezeArchetypeIfQuoteDrifted(
    prevPlanSpec: AppliedPlanSpec,
    nextDraft: Pick<
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
  ): AppliedPlanSpec {
    if (prevPlanSpec?.kind !== "archetype") return prevPlanSpec;
    const nextSig = computeClientPortfolioQuoteMeta(nextDraft).inputSig;
    const lockedSig = prevPlanSpec.quoteInputSig ?? "";
    return {
      ...prevPlanSpec,
      allowBudgetMismatchReadOnly: Boolean(lockedSig && nextSig !== lockedSig),
    };
  }

  function scrubStateInvalidAlerts(
    s: BetSlipState,
    nowMs: number
  ): BetSlipState {
    let matchesChanged = false;
    const validAlertIds = new Set<string>();
    const nextMatches = s.matches.map((m) => {
      if (!m.aiAlert) return m;
      if (isClientMatchAlertBindingValid(m.aiAlert, m, nowMs)) {
        validAlertIds.add(m.id);
        return m;
      }
      matchesChanged = true;
      return { ...m, aiAlert: undefined };
    });

    const curWarnings = s.workspace?.allWarnings;
    let nextWorkspace = s.workspace;
    if (Array.isArray(curWarnings) && curWarnings.length > 0) {
      const filteredWarnings = curWarnings.filter((w) => {
        if (!w.id.startsWith("xiaogao-")) return true;
        const mid = w.id.slice("xiaogao-".length);
        return validAlertIds.has(mid);
      });
      if (filteredWarnings.length !== curWarnings.length) {
        nextWorkspace = {
          ...s.workspace,
          allWarnings: filteredWarnings,
        };
      }
    }

    if (!matchesChanged && nextWorkspace === s.workspace) {
      return s;
    }
    return {
      ...s,
      matches: matchesChanged ? nextMatches : s.matches,
      workspace: nextWorkspace,
    };
  }

  function syntheticConfirmation(
    current: BetSlipState,
    scope: string | null,
    lines: PlanTicketLine[],
    cost: number,
    lineSig: string
  ) {
    const board = new Map(current.matches.map((match) => [match.id, match]));
    const referenceOnly =
      Boolean(options.isOffline?.()) ||
      !isFreshTicketBoard(current.workspace.boardMeta) ||
      !lines.every((line) => isTicketLineSaleConfirmed(line.legs, board));
    const parts = [scope, current.syntheticSingleMode, cost, lineSig];
    if (referenceOnly) parts.push("paper");
    return { referenceOnly, signature: JSON.stringify(parts) };
  }

  function reconcileState(): BetSlipState {
    commitPendingExplicitClearIfNeeded();
    syncSharedHoldFromStorage();
    const scrubbed = scrubStateInvalidAlerts(state, nowFn());
    if (scrubbed !== state) {
      state = scrubbed;
      lastReconciledRef = null;
    }
    const offline = Boolean(options.isOffline?.());
    if (lastReconciledRef === state && lastReconciledOffline === offline)
      return state;
    lastReconciledOffline = offline;
    if (syntheticApproval) {
      if (
        state.syntheticSingleMode === "off" ||
        syntheticApprovalScope(state, syntheticApproval.matchId) !==
          syntheticApproval.scope
      ) {
        syntheticApproval = null;
      } else if (
        singleRequiresSynthetic(state.picks) &&
        !state.planSpec &&
        !state.singleAuthGrant &&
        syntheticApproval.grant
      ) {
        // A bridge temporarily makes this ticket playable as an ordinary parlay.
        // Restore the approved instruction only on the same single & board.
        state = {
          ...state,
          syntheticSingleMode: syntheticApproval.mode,
          singleAuthGrant: syntheticApproval.grant,
          planSpec: syntheticApproval.plan ?? null,
        };
      }
    }
    const qMeta = computeClientPortfolioQuoteMeta(state);
    if (qMeta.inputSig !== lastKnownInputSig) {
      quoteVersion += 1;
      lastKnownInputSig = qMeta.inputSig;
    }
    const curDraftSig = `${qMeta.picksSig}|m=${state.multiple}|ps=${qMeta.passSpecSig}|b=${qMeta.budget}|st=${qMeta.stance}|sc=${qMeta.allowSaveCash ? 1 : 0}`;
    if (curDraftSig !== lastDraftSig) {
      if (lastDraftSig !== "") draftRevision += 1;
      lastDraftSig = curDraftSig;
    }
    const isStale = bootstrapped
      ? qMeta.inputSig !== computedInputSig ||
        computeWorkspaceExecutionSig(state, qMeta.inputSig) !==
          computedWorkspaceSig ||
        pendingTimer !== null ||
        inFlightPromise !== null
      : false;
    const appliedTicketSnapshot =
      state.planSpec?.kind === "archetype"
        ? (state.planSpec.appliedTicketSnapshot ?? null)
        : null;
    const livePortfolioQuote: LivePortfolioQuoteState = {
      quoteVersion,
      ...qMeta,
      computedInputSig,
      isStale,
      canApplyLiveQuote: !isStale && !deferredDraftBoardAt,
    };
    if (
      revokedPlanHold &&
      (state.planSpec !== null || state.singleAuthGrant !== null)
    ) {
      localHoldRev = Math.max(localHoldRev, revokedPlanHold.rev);
      revokedPlanHold = null;
    }
    const passRuleBlockReason = computePassRuleBlockReason(
      state.passSpec,
      state.picks
    );
    // Keep the proposed server ticket separate from the non-payable view.
    const rawWorkspace =
      state.workspace === maskedSyntheticWorkspace && originalSyntheticWorkspace
        ? originalSyntheticWorkspace
        : state.workspace;
    const rawReport =
      rawWorkspace.baselineReport ?? rawWorkspace.effectiveReport;
    const proposedPlan =
      rawWorkspace.baselineAppliedPlan ?? rawWorkspace.appliedPlan;
    const mayConvertSingle =
      !deferredDraftBoardAt &&
      state.syntheticSingleMode !== "off" &&
      singleRequiresSynthetic(state.picks) &&
      (!state.planSpec ||
        (state.planSpec.kind === "bonus" &&
          state.planSpec.baseSourceKind === "auto-synthetic"));
    let proposedQuote: SyntheticChoiceQuote | null = null;
    if (
      mayConvertSingle &&
      rawReport.canCheckout &&
      rawReport.totalCost > 0 &&
      (rawReport.syntheticAutoMounted ||
        isSingleAuthBoundBonusPlan(state.planSpec)) &&
      proposedPlan?.lines?.length
    ) {
      const rows = proposedPlan.lines.flatMap((line) =>
        line.legs.map((leg) => ({
          matchId: leg.matchId,
          matchNumStr: leg.matchNumStr,
          home: leg.home,
          away: leg.away,
          poolName: leg.poolName,
          optionLabel: leg.optionLabel,
          odds: leg.odds,
          multiple: line.multiple,
          cost: line.cost,
        }))
      );
      const scope = syntheticApprovalScope(state, state.picks[0].matchId);
      if (
        scope &&
        rows.length === proposedPlan.lines.length &&
        rows.every((r) => r.matchId === state.picks[0].matchId)
      ) {
        const manual =
          rawWorkspace.baselineManualReport ?? rawWorkspace.manualReport;
        const lineSig = encodeSyntheticLinesSig(
          proposedPlan.lines,
          state.multiple
        );
        const coverage = manual.crossPoolSingleAlternatives?.find(
          (a) =>
            encodeSyntheticLinesSig(a.previewLines, state.multiple) ===
              lineSig ||
            (a.trim2WayLines?.length &&
              encodeSyntheticLinesSig(a.trim2WayLines, state.multiple) ===
                lineSig)
        );
        const trimmed = state.syntheticSingleMode === "trim-2way";
        const exact =
          !trimmed &&
          (coverage?.isExactEquivalent ?? rawReport.isExactSyntheticEquivalent);
        const trimLabel =
          coverage &&
          "trim2WayBlindSpotLabel" in coverage &&
          typeof coverage.trim2WayBlindSpotLabel === "string"
            ? coverage.trim2WayBlindSpotLabel
            : null;
        const blindSpot =
          (trimmed ? trimLabel : coverage?.blindSpotLabel) ??
          rawReport.syntheticBlindSpotLabel;
        const poolNames = [...new Set(rows.map((row) => row.poolName))].join(
          "＋"
        );
        proposedQuote = {
          rows,
          mode: state.syntheticSingleMode,
          coverageLabel: exact
            ? "与原方向完全等价"
            : `部分覆盖${blindSpot ? " · 漏网：" + blindSpot : " · 部分原方向赛果不返奖"}`,
          ...syntheticConfirmation(
            state,
            scope,
            proposedPlan.lines,
            rawReport.totalCost,
            lineSig
          ),
          label: `${poolNames}合成单关（${rows.map((row) => row.optionLabel).join("＋")}）`,
          cost: rawReport.totalCost,
        };
      }
    }
    const isProposedConversion =
      Boolean(proposedQuote) ||
      Boolean(mayConvertSingle && (isStale || rawReport.syntheticAutoMounted));
    const needsSyntheticConfirmation =
      isProposedConversion &&
      (isStale ||
        !proposedQuote ||
        proposedQuote.signature !== syntheticApproval?.signature);
    const pendingSyntheticChoice = needsSyntheticConfirmation
      ? { quote: isStale ? null : proposedQuote }
      : null;
    // Pending partial/over-budget offers already prohibit payment. Keep their
    // itemized choices accessible when migrating an old manual draft.
    const showPendingSingleOptions =
      mayConvertSingle &&
      !needsSyntheticConfirmation &&
      !rawReport.canCheckout &&
      rawReport.selectionStatus === "pending-single-auth" &&
      revokedPlanHold?.reason === LEGACY_SINGLE_CONFIRMATION;
    const activeRevokedHoldReason = deferredDraftBoardAt
      ? "正在核对完整选单。可同步水位重试，或清空后重新选赛"
      : needsSyntheticConfirmation
        ? "合成单关改变了实际票行，请核对票行及金额后确认"
        : state.picks.length > 0 && !showPendingSingleOptions
          ? (revokedPlanHold?.reason ?? null)
          : null;
    const effectiveBlockReason =
      activeRevokedHoldReason ?? (!state.planSpec ? passRuleBlockReason : null);
    const shouldEnforceManualPassBlock = Boolean(effectiveBlockReason);
    const effectiveWorkspace: QuantWorkspaceResponse =
      shouldEnforceManualPassBlock &&
      (Boolean(activeRevokedHoldReason) ||
        rawWorkspace.effectiveReport.canCheckout ||
        rawWorkspace.baselineReport?.canCheckout)
        ? {
            ...rawWorkspace,
            ...(activeRevokedHoldReason
              ? { appliedPlan: null, baselineAppliedPlan: null }
              : {}),
            effectiveReport: {
              ...rawWorkspace.effectiveReport,
              canCheckout: false,
              ...(activeRevokedHoldReason
                ? {
                    totalCost: 0,
                    betCount: 0,
                    stakeUnitsCount: 0,
                    logicalLineCount: 0,
                    physicalSlipCount: 0,
                    syntheticAutoMounted: false,
                    tickets: [],
                    physicalSlips: [],
                  }
                : {}),
              selectionStatus: "rule-blocked",
              ruleBlockReason: effectiveBlockReason!,
            },
            ...(rawWorkspace.baselineReport
              ? {
                  baselineReport: {
                    ...rawWorkspace.baselineReport,
                    canCheckout: false,
                    ...(activeRevokedHoldReason
                      ? {
                          totalCost: 0,
                          betCount: 0,
                          stakeUnitsCount: 0,
                          logicalLineCount: 0,
                          physicalSlipCount: 0,
                          syntheticAutoMounted: false,
                          tickets: [],
                          physicalSlips: [],
                        }
                      : {}),
                    selectionStatus: "rule-blocked",
                    ruleBlockReason: effectiveBlockReason!,
                  },
                }
              : {}),
          }
        : rawWorkspace;
    maskedSyntheticWorkspace = needsSyntheticConfirmation
      ? effectiveWorkspace
      : null;
    originalSyntheticWorkspace = needsSyntheticConfirmation
      ? rawWorkspace
      : null;
    const nextCore = {
      ...state,
      pendingSyntheticChoice,
      pendingRevokedPlanConfirm: activeRevokedHoldReason,
      workspace: effectiveWorkspace,
      manualDraftPicks: state.picks,
      appliedTicketSnapshot,
      livePortfolioQuote,
    };
    const provisionalSlip = buildActiveAuditedSlip(
      nextCore,
      activeSlipRevision
    );
    const baseRep =
      effectiveWorkspace.baselineReport ?? effectiveWorkspace.effectiveReport;
    const curSlipSig = `${provisionalSlip.sourceKind}|${baseRep.modeLabel}|${baseRep.totalCost}|${provisionalSlip.legs
      .map((l) => `${l.matchId}:${l.poolCode}:${l.optionKey}@${l.odds}`)
      .join(",")}|${provisionalSlip.lines
      .map((ln) => `${ln.id}:${ln.multiple}:${ln.cost}`)
      .join(",")}`;
    if (curSlipSig !== lastActiveSlipSig) {
      if (lastActiveSlipSig !== "") activeSlipRevision += 1;
      lastActiveSlipSig = curSlipSig;
    }
    const activeSlip =
      provisionalSlip.revision === activeSlipRevision
        ? provisionalSlip
        : { ...provisionalSlip, revision: activeSlipRevision };
    const resolvedVoidIds =
      state.voidMatchIds.length > 0
        ? state.voidMatchIds.filter((id) => activeSlip.matchIds.includes(id))
        : state.simVoidFirstMatch && activeSlip.matchIds[0]
          ? [activeSlip.matchIds[0]]
          : [];

    state = {
      ...nextCore,
      manualDraft: {
        schemaVersion: 1,
        revision: draftRevision,
        picks: state.picks,
        multiple: state.multiple,
        passSpec: state.passSpec,
        budget: qMeta.budget,
        stance: qMeta.stance,
        allowSaveCash: qMeta.allowSaveCash,
        passRuleBlockReason,
      },
      portfolioQuote: {
        ...livePortfolioQuote,
        plans: state.workspace.portfolioPlans ?? [],
        objectivePlans: state.objectivePortfolioPlans,
      },
      activeSlip,
      activeAuditedSlip: activeSlip,
      sandboxSim: {
        baseRevision: activeSlipRevision,
        voidMatchIds: resolvedVoidIds,
        subjectiveDeltaPct: state.subjectiveDeltaPct,
      },
    };
    persistManualDraftIfNeeded(state);
    lastReconciledRef = state;
    return state;
  }

  function emit() {
    reconcileState();
    for (const fn of listeners) fn();
  }

  function applyMultiple(next: number): number {
    if (next === state.multiple) {
      void scheduleRefresh();
      return next;
    }
    clearRevokedPlanHoldOnUserAction();
    state = {
      ...state,
      planSpec: null,
      ...(state.singleAuthGrant
        ? {
            singleAuthGrant: null,
            syntheticSingleMode:
              state.syntheticSingleMode === "partial-cover" ||
              state.syntheticSingleMode === "trim-2way"
                ? "full-3way"
                : state.syntheticSingleMode,
          }
        : {}),
      multiple: next,
    };
    emit();
    void scheduleRefresh();
    return next;
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
    computeSeq += 1;
    lastReconciledRef = null;
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    settlePendingResolvers();
  }

  function buildWorkspaceParams(s: BetSlipState = state): QuantWorkspaceParams {
    const nowMs = nowFn();
    const clientAlerts: Record<string, NonNullable<MatchItem["aiAlert"]>> = {};
    for (const m of s.matches) {
      if (m.aiAlert && isClientMatchAlertBindingValid(m.aiAlert, m, nowMs)) {
        clientAlerts[m.id] = m.aiAlert;
      }
    }
    const qMeta = computeClientPortfolioQuoteMeta(s);
    return {
      picks: s.picks,
      multiple: s.multiple,
      passSpec: s.passSpec,
      syntheticSingleMode: s.syntheticSingleMode,
      ...(s.singleAuthGrant ? { singleAuthGrant: s.singleAuthGrant } : {}),
      subjectiveDeltaPct: s.subjectiveDeltaPct,
      simVoidFirstMatch: s.simVoidFirstMatch,
      ...(s.voidMatchIds.length > 0 ? { voidMatchIds: s.voidMatchIds } : {}),
      planSpec: s.planSpec,
      targetIds: s.targetIds,
      anchorToRadarPicks: s.anchorToRadarPicks,
      budget: s.budget,
      stance: s.stance,
      unlockFullAgg: s.unlockFullAgg,
      allowSaveCash: s.allowSaveCash,
      quoteInputSig: qMeta.inputSig,
      ...(s.workspace?.boardMeta?.quoteVersion
        ? { clientBoardQuoteVersion: s.workspace.boardMeta.quoteVersion }
        : {}),
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
      voidMatchIds: [],
    };
    return true;
  }

  function verifyOrTightenSingleAuthGrantOnWs(
    ws: QuantWorkspaceResponse
  ): boolean {
    const authRevokedMsg =
      "原已确认单关授权涉及场次盘口或单关开售权限已变动，原实票已失效；请重新选择单关方案或按手选核对后再出票";
    const armSingleAuthRevokedHold = () => {
      if (state.picks.length > 0 && !revokedPlanHold) {
        armRevokedPlanHold(authRevokedMsg);
      }
    };
    const grant = state.singleAuthGrant;
    const boundBonus =
      state.planSpec?.kind === "bonus" &&
      isSingleAuthBoundBonusPlan(state.planSpec)
        ? state.planSpec
        : null;
    if (!grant) {
      if (boundBonus) {
        armSingleAuthRevokedHold();
        state = {
          ...state,
          planSpec: null,
          appliedTicketSnapshot: null,
          syntheticSingleMode: "full-3way",
        };
        return true;
      }
      return false;
    }
    const distinctIds = Array.from(new Set(state.picks.map((p) => p.matchId)));
    const curPicksSig = buildRadarSignature(state.picks);
    const fm = state.matches.find((m) => m.id === grant.matchId);
    const pickedHasHhad = state.picks.some((p) => p.poolCode === "HHAD");
    const hhadPick = state.picks.find((p) => p.poolCode === "HHAD");
    const curGoalLine = pickedHasHhad
      ? String(fm?.pools?.HHAD?.goalLine ?? hhadPick?.goalLine ?? "").trim()
      : "";
    const curMatchQuoteSig = computeSingleMatchQuoteVersionSig(fm);
    const boundMismatch = Boolean(
      boundBonus &&
      ((boundBonus.boundSingleAuthId &&
        boundBonus.boundSingleAuthId !== grant.authId) ||
        (boundBonus.boundQuoteVersionSig &&
          boundBonus.boundQuoteVersionSig !== curMatchQuoteSig) ||
        (boundBonus.boundLineAndMultipleSig &&
          boundBonus.boundLineAndMultipleSig !== grant.lineAndMultipleSig))
    );
    if (
      distinctIds.length !== 1 ||
      distinctIds[0] !== grant.matchId ||
      curPicksSig !== grant.picksSig ||
      (grant.goalLine !== undefined && curGoalLine !== grant.goalLine) ||
      (grant.quoteVersionSig !== undefined &&
        grant.quoteVersionSig.length > 0 &&
        curMatchQuoteSig !== grant.quoteVersionSig) ||
      !isGrantLineSigValidAgainstMatch(grant.lineAndMultipleSig, fm) ||
      boundMismatch
    ) {
      armSingleAuthRevokedHold();
      state = {
        ...state,
        ...(boundBonus ? { planSpec: null, appliedTicketSnapshot: null } : {}),
        singleAuthGrant: null,
        syntheticSingleMode: "full-3way",
      };
      return true;
    }
    const baseRep = ws.baselineReport ?? ws.effectiveReport;
    const basePlan =
      ws.baselineAppliedPlan !== undefined
        ? ws.baselineAppliedPlan
        : ws.appliedPlan;
    if (
      (grant.approvedCost === Number.MAX_SAFE_INTEGER ||
        grant.exactCost === undefined) &&
      baseRep.canCheckout &&
      baseRep.totalCost > 0
    ) {
      const tightenedLineSig =
        basePlan?.lines && basePlan.lines.length > 0
          ? encodeSyntheticLinesSig(basePlan.lines, state.multiple)
          : grant.lineAndMultipleSig;
      state = {
        ...state,
        singleAuthGrant: {
          ...grant,
          approvedCost: baseRep.totalCost,
          exactCost: baseRep.totalCost,
          lineAndMultipleSig: tightenedLineSig,
          quoteVersionSig: curMatchQuoteSig,
        },
      };
      return false;
    }
    if (
      baseRep.totalCost > grant.approvedCost + 1e-6 ||
      (grant.exactCost !== undefined &&
        Math.abs(baseRep.totalCost - grant.exactCost) > 1e-6)
    ) {
      armSingleAuthRevokedHold();
      state = {
        ...state,
        ...(boundBonus ? { planSpec: null, appliedTicketSnapshot: null } : {}),
        singleAuthGrant: null,
        syntheticSingleMode: "full-3way",
      };
      return true;
    }
    return false;
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
              if (
                deferredDraftBoardAt &&
                ws.refreshedMatches &&
                !ws.boardMeta?.isFallbackReadOnly &&
                extractBoardCapturedAt(ws.boardMeta) >= deferredDraftBoardAt
              ) {
                applyAuthenticatedBundle({
                  matches: ws.refreshedMatches,
                  initialPicks: [],
                  workspace: ws,
                  boardMeta: ws.boardMeta,
                });
                return;
              }
              const prevMatchMap = new Map(state.matches.map((m) => [m.id, m]));
              let nextMatches = state.matches;
              let nextPicks = state.picks;
              let nextPassSpec = state.passSpec;
              let nextPlanSpec = state.planSpec;
              let nextAppliedSnap = state.appliedTicketSnapshot;
              let nextNotice = state.draftRestoredNotice;
              let boardInvalidated = false;
              let capBindingStripped = false;
              const wsCapturedAt = extractBoardCapturedAt(ws.boardMeta);
              const isOutOfOrderComputeBoard = Boolean(
                latestBoardCapturedAt > 0 &&
                wsCapturedAt > 0 &&
                wsCapturedAt < latestBoardCapturedAt
              );
              const isOlderFallbackRoster = Boolean(
                ws.boardMeta?.isFallbackReadOnly &&
                latestBoardCapturedAt > 0 &&
                (wsCapturedAt === 0 || wsCapturedAt < latestBoardCapturedAt)
              );
              if (
                Array.isArray(ws.refreshedMatches) &&
                ws.refreshedMatches.length > 0 &&
                !isOlderFallbackRoster &&
                !isOutOfOrderComputeBoard
              ) {
                const preDropComputeHash = computeManualTicketDraftHash(
                  state.picks,
                  state.multiple,
                  state.passSpec,
                  state.matches,
                  state.syntheticSingleMode
                );
                boardEpoch += 1;
                if (wsCapturedAt > latestBoardCapturedAt) {
                  latestBoardCapturedAt = wsCapturedAt;
                }
                nextMatches = ws.refreshedMatches.map((nm) =>
                  mergeMatchPoolsNonRegressive(prevMatchMap.get(nm.id), nm)
                );
                const byId = new Map(nextMatches.map((m) => [m.id, m]));
                let droppedCount = 0;
                let goalLineShifted = 0;
                nextPicks = state.picks
                  .map((pk): SelectedPick | null => {
                    const fm = byId.get(pk.matchId);
                    if (
                      !isStrictSameMatchIdentity(
                        fm,
                        pk,
                        prevMatchMap.get(pk.matchId)
                      )
                    ) {
                      droppedCount += 1;
                      return null;
                    }
                    const uPool = fm.pools?.[pk.poolCode];
                    const nextSingle = resolvePoolCanSingle(uPool);
                    const nextAllUp = resolvePoolCanAllUp(uPool);
                    const opt = uPool?.options?.find(
                      (o) => o.key === pk.optionKey
                    );
                    if (
                      !uPool ||
                      uPool.selling === false ||
                      (!nextSingle && !nextAllUp) ||
                      !opt ||
                      opt.odds < 1.01
                    ) {
                      droppedCount += 1;
                      return null;
                    }
                    const prevGl = String(
                      pk.goalLine ??
                        prevMatchMap.get(pk.matchId)?.pools?.HHAD?.goalLine ??
                        ""
                    ).trim();
                    const nextGl = String(uPool.goalLine ?? "").trim();
                    if (pk.poolCode === "HHAD" && prevGl && nextGl !== prevGl) {
                      droppedCount += 1;
                      goalLineShifted += 1;
                      return null;
                    }
                    return {
                      ...pk,
                      th: computeOrderedMatchIdentitySig(
                        fm,
                        Boolean(fm.homeTeamId || fm.awayTeamId)
                      ),
                      odds: opt.odds,
                      fairProb: opt.fairProb,
                      singleAllowed: nextSingle,
                      canSingle: nextSingle,
                      canAllUp: nextAllUp,
                      ...resolveOptionalGoalLine(pk.poolCode, uPool, prevGl),
                    };
                  })
                  .filter((x): x is SelectedPick => x !== null);
                if (droppedCount > 0) {
                  boardInvalidated = true;
                  nextPassSpec = sanitizePassSpecForPicks(
                    state.passSpec,
                    nextPicks
                  );
                  nextNotice =
                    goalLineShifted > 0
                      ? "官方让球线已发生变盘，已自动剔除失效旧让球选项，请按最新盘口重新核对选择"
                      : `部分已选场次已停售或跨期下架，已自动剔除 ${droppedCount} 项失效选项`;
                  if (
                    state.singleAuthGrant &&
                    nextPicks.length > 0 &&
                    !revokedPlanHold
                  ) {
                    armRevokedPlanHold(
                      "原已确认单关授权涉及场次盘口或单关开售权限已变动，原实票已失效；请重新选择单关方案或按手选核对后再出票"
                    );
                  }
                }
                if (
                  nextPlanSpec?.kind === "bonus" &&
                  (nextPlanSpec.confirmedCapGuardSig ||
                    nextPlanSpec.allowCapEvTradeoff) &&
                  (droppedCount > 0 ||
                    !isCapGuardBindingValidAgainstBoard(
                      nextPlanSpec.confirmedCapGuardSig,
                      byId
                    ))
                ) {
                  nextPlanSpec = {
                    ...nextPlanSpec,
                    confirmedCapGuardSig: undefined,
                    allowCapEvTradeoff: false,
                  };
                  capBindingStripped = true;
                }
                if (
                  nextPlanSpec &&
                  (hasPlanSpecBoardInvalidation(
                    nextPlanSpec,
                    prevMatchMap,
                    byId
                  ) ||
                    (droppedCount > 0 &&
                      nextPlanSpec.kind === "bonus" &&
                      !nextPlanSpec.baseLines?.length))
                ) {
                  const holdMsg =
                    "原已套用方案涉及场次盘口或单串开售权限已变动，原方案锁定已失效；请确认改按当前手选草稿核对或重新配单后再出票";
                  nextPlanSpec = null;
                  nextAppliedSnap = null;
                  boardInvalidated = true;
                  if (nextPicks.length > 0) {
                    armRevokedPlanHold(holdMsg);
                  }
                  if (!nextNotice) {
                    nextNotice = holdMsg;
                  }
                }
                if (hasUnresolvedSyntheticChoice) {
                  const effCompSynMode =
                    nextPicks.length === 0 ||
                    state.syntheticSingleMode === "partial-cover" ||
                    state.syntheticSingleMode === "trim-2way"
                      ? "full-3way"
                      : state.syntheticSingleMode;
                  if (nextPicks.length === 0) {
                    hasUnresolvedSyntheticChoice = false;
                  } else if (
                    singleRequiresSynthetic(nextPicks) &&
                    effCompSynMode !== "off" &&
                    !nextPlanSpec &&
                    !(boardInvalidated ? null : state.singleAuthGrant) &&
                    !revokedPlanHold
                  ) {
                    armRevokedPlanHold(LEGACY_SINGLE_CONFIRMATION);
                    boardInvalidated = true;
                    if (!nextNotice) nextNotice = LEGACY_SINGLE_CONFIRMATION;
                  }
                }
                if (!ws.boardMeta?.isFallbackReadOnly) {
                  pruneInvalidatedStoredDraftAgainstBoard(
                    nextMatches,
                    preDropComputeHash,
                    wsCapturedAt
                  );
                }
              }
              const computedBoardMeta = ws.boardMeta
                ? pickNewerWsBoardMeta(state.workspace.boardMeta, ws.boardMeta)
                : undefined;
              const effectiveWsForState: QuantWorkspaceResponse =
                isOlderFallbackRoster &&
                Array.isArray(ws.refreshedMatches) &&
                ws.refreshedMatches.length > 0
                  ? {
                      ...state.workspace,
                      boardMeta: computedBoardMeta,
                    }
                  : { ...ws, boardMeta: computedBoardMeta };
              const resolvedAppliedForCap =
                effectiveWsForState.baselineAppliedPlan !== undefined
                  ? effectiveWsForState.baselineAppliedPlan
                  : effectiveWsForState.appliedPlan;
              if (
                nextPlanSpec?.kind === "bonus" &&
                (nextPlanSpec.confirmedCapGuardSig ||
                  nextPlanSpec.allowCapEvTradeoff) &&
                resolvedAppliedForCap?.capGuardAlternative
              ) {
                nextPlanSpec = {
                  ...nextPlanSpec,
                  confirmedCapGuardSig: undefined,
                  allowCapEvTradeoff: false,
                };
              }
              state = {
                ...state,
                matches: nextMatches,
                picks: nextPicks,
                manualDraftPicks: nextPicks,
                passSpec: nextPassSpec,
                planSpec: nextPlanSpec,
                appliedTicketSnapshot: nextAppliedSnap,
                draftRestoredNotice: nextNotice,
                ...(boardInvalidated || nextPicks.length === 0
                  ? {
                      ...(boardInvalidated ? { singleAuthGrant: null } : {}),
                      syntheticSingleMode: (nextPicks.length === 0 ||
                      state.syntheticSingleMode === "partial-cover" ||
                      state.syntheticSingleMode === "trim-2way"
                        ? "full-3way"
                        : state.syntheticSingleMode) as SyntheticSingleMode,
                    }
                  : {}),
                workspace: effectiveWsForState,
                objectivePortfolioPlans: resolveObjectivePortfolioPlans(
                  paramsSnapshot.stance,
                  effectiveWsForState,
                  state.objectivePortfolioPlans
                ),
              };
              const authInvalidated =
                verifyOrTightenSingleAuthGrantOnWs(effectiveWsForState);
              const curActualSig =
                computeClientPortfolioQuoteMeta(state).inputSig;
              const mergedQuoteMismatch = Boolean(
                ws.quoteInputSig && ws.quoteInputSig !== curActualSig
              );
              const resolvedSig = ws.quoteInputSig || curActualSig;
              const reapplied = !mergedQuoteMismatch
                ? maybeConsumePendingRequote(ws, resolvedSig)
                : false;
              computedInputSig = mergedQuoteMismatch
                ? ws.quoteInputSig || ""
                : curActualSig;
              computedWorkspaceSig = mergedQuoteMismatch
                ? ""
                : computeWorkspaceExecutionSig(state, computedInputSig);
              const stampedAsyncWs = computedWorkspaceSig
                ? stampWorkspaceRemediationMeta(
                    state.workspace,
                    computedWorkspaceSig
                  )
                : state.workspace;
              state = {
                ...state,
                workspace: stampedAsyncWs,
                objectivePortfolioPlans: resolveObjectivePortfolioPlans(
                  paramsSnapshot.stance,
                  stampedAsyncWs,
                  state.objectivePortfolioPlans
                ),
              };
              options.onComputeSuccess?.(stampedAsyncWs);
              const shouldRetryMergedPools =
                mergedQuoteMismatch &&
                lastPoolMergeRetriedInputSig !== curActualSig;
              if (shouldRetryMergedPools) {
                lastPoolMergeRetriedInputSig = curActualSig;
              } else if (!mergedQuoteMismatch) {
                lastPoolMergeRetriedInputSig = "";
              }
              if (
                reapplied ||
                authInvalidated ||
                boardInvalidated ||
                capBindingStripped ||
                shouldRetryMergedPools
              ) {
                emit();
                await executeComputeNow();
              } else {
                if (inFlightPromise === p) {
                  inFlightPromise = null;
                }
                lastReconciledRef = null;
                emit();
              }
            }
          })
          .catch((err) => {
            if (err instanceof TypeError) {
              options.onOfflineNetworkError?.();
            }
          })
          .finally(() => {
            if (inFlightPromise === p) {
              inFlightPromise = null;
              lastReconciledRef = null;
              emit();
            }
          });
        inFlightPromise = p;
        lastReconciledRef = null;
        return p;
      }

      if (seq === computeSeq) {
        const computed = maybeMain as QuantWorkspaceResponse;
        const ws = computed.boardMeta
          ? {
              ...computed,
              boardMeta: pickNewerWsBoardMeta(
                state.workspace.boardMeta,
                computed.boardMeta
              ),
            }
          : computed;
        const resolvedSig = ws.quoteInputSig || requestInputSig;
        const syncAppliedForCap =
          ws.baselineAppliedPlan !== undefined
            ? ws.baselineAppliedPlan
            : ws.appliedPlan;
        const nextSyncPlanSpec =
          state.planSpec?.kind === "bonus" &&
          (state.planSpec.confirmedCapGuardSig ||
            state.planSpec.allowCapEvTradeoff) &&
          syncAppliedForCap?.capGuardAlternative
            ? {
                ...state.planSpec,
                confirmedCapGuardSig: undefined,
                allowCapEvTradeoff: false,
              }
            : state.planSpec;
        state = {
          ...state,
          planSpec: nextSyncPlanSpec,
          workspace: ws,
          objectivePortfolioPlans: resolveObjectivePortfolioPlans(
            paramsSnapshot.stance,
            ws,
            state.objectivePortfolioPlans
          ),
        };
        const authInvalidated = verifyOrTightenSingleAuthGrantOnWs(ws);
        const reapplied = maybeConsumePendingRequote(ws, resolvedSig);
        computedInputSig = computeClientPortfolioQuoteMeta(state).inputSig;
        computedWorkspaceSig = computeWorkspaceExecutionSig(
          state,
          computedInputSig
        );
        const stampedSyncWs = stampWorkspaceRemediationMeta(
          state.workspace,
          computedWorkspaceSig
        );
        state = {
          ...state,
          workspace: stampedSyncWs,
          objectivePortfolioPlans: resolveObjectivePortfolioPlans(
            paramsSnapshot.stance,
            stampedSyncWs,
            state.objectivePortfolioPlans
          ),
        };
        options.onComputeSuccess?.(stampedSyncWs);
        emit();
        if (reapplied || authInvalidated) {
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
      lastReconciledRef = null;
    });
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

  function applyAuthenticatedBundle(
    bundle: {
      matches: MatchItem[];
      initialPicks: SelectedPick[];
      workspace: QuantWorkspaceResponse;
      boardMeta?: BoardFreshnessMeta | null;
    },
    verifiedDraftRaw?: string
  ) {
    cancelPendingTimer();
    bootstrapped = true;
    computeSeq += 1;
    boardEpoch += 1;
    revokedPlanHold = null;
    localHoldRev = 0;
    clearedHoldRev = 0;
    myAckedHoldRev = 0;
    localClearSeq = 0;
    knownStorageWriteSeq = 0;
    lastManualTicketHash = "empty";
    confirmedClearDraftHash = null;
    pendingExplicitUserClear = false;
    pendingExplicitTicketPersist = false;
    pendingPreviewKnobPersist = null;
    hadObservedPersistedDraft = false;
    hasUnresolvedSyntheticChoice = false;
    syntheticApproval = null;
    maskedSyntheticWorkspace = null;
    originalSyntheticWorkspace = null;
    lastPoolMergeRetriedInputSig = "";
    const bundleBoardMeta =
      bundle.boardMeta ?? bundle.workspace?.boardMeta ?? null;
    latestBoardCapturedAt = extractBoardCapturedAt(bundleBoardMeta);
    deferredDraftBoardAt = 0;
    lastPersistedDraftJson = "";
    lastPersistedSourceJson = "";
    ensureBrowserHoldChannel();
    if (
      !storageListenerRegistered &&
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      storageListenerRegistered = true;
      window.addEventListener("storage", (ev) => {
        const expectedKey = resolveDraftStorageKey();
        if (!expectedKey || (ev.key !== null && ev.key !== expectedKey)) return;
        const hadHoldBefore = Boolean(revokedPlanHold);
        if (syncSharedHoldFromStorage()) {
          emit();
          if (hadHoldBefore && !revokedPlanHold) {
            void scheduleRefresh();
          }
        }
      });
    }
    const nowMs = nowFn();
    const cleanMatches = bundle.matches.map((m) =>
      m.aiAlert && !isClientMatchAlertBindingValid(m.aiAlert, m, nowMs)
        ? { ...m, aiAlert: undefined }
        : m
    );
    const baseState = buildInitialState();
    const savedDraft =
      bundle.initialPicks.length === 0
        ? restoreSavedDraftAgainstMatches(
            cleanMatches,
            bundleBoardMeta,
            verifiedDraftRaw
          )
        : null;
    deferredDraftBoardAt = savedDraft?.waitForBoardAt ?? 0;
    const restoredDraft = deferredDraftBoardAt ? null : savedDraft;
    if (bundle.initialPicks.length > 0) {
      clearRevokedPlanHoldOnUserAction();
    } else if (restoredDraft?.restored) {
      localHoldRev = restoredDraft.holdRev;
      clearedHoldRev = restoredDraft.holdClearedRev;
      myAckedHoldRev = restoredDraft.holdRev;
      localClearSeq = restoredDraft.clearSeq;
      knownStorageWriteSeq = restoredDraft.writeSeq;
      confirmedClearDraftHash = restoredDraft.holdClearedDraftHash;
      hasUnresolvedSyntheticChoice = restoredDraft.legacyNeedsFutureSynGuard;
      syntheticApproval = restoredDraft.approval;
    } else {
      const initMeta = readStoredHoldMeta();
      localHoldRev = initMeta.holdRev;
      clearedHoldRev = initMeta.holdClearedRev;
      myAckedHoldRev = initMeta.holdRev;
      localClearSeq = initMeta.clearSeq;
      knownStorageWriteSeq = initMeta.writeSeq;
      confirmedClearDraftHash = initMeta.holdClearedDraftHash;
    }
    const effectiveInitialPicks = enrichPicksWithBoardGoalLine(
      restoredDraft && restoredDraft.restored
        ? restoredDraft.picks
        : bundle.initialPicks,
      cleanMatches
    );
    revokedPlanHold =
      restoredDraft?.restored &&
      restoredDraft.pendingRevokedPlanConfirm &&
      effectiveInitialPicks.length > 0
        ? {
            reason: restoredDraft.pendingRevokedPlanConfirm,
            rev: Math.max(1, restoredDraft.holdRev),
          }
        : null;
    const radarSync = syncAutoRadarFields(effectiveInitialPicks, cleanMatches, {
      ...baseState,
      targetIds: cleanMatches.slice(0, 2).map((m) => m.id),
    });
    const nextState: BetSlipState = {
      ...baseState,
      matches: cleanMatches,
      picks: effectiveInitialPicks,
      manualDraftPicks: effectiveInitialPicks,
      ...(restoredDraft && restoredDraft.restored
        ? {
            multiple: restoredDraft.multiple,
            passSpec: restoredDraft.passSpec,
            syntheticSingleMode: restoredDraft.syntheticSingleMode,
            budget: restoredDraft.budget,
            stance: restoredDraft.stance,
            allowSaveCash: restoredDraft.allowSaveCash,
            draftRestoredNotice: restoredDraft.notice,
          }
        : {}),
      singleAuthGrant: null,
      ...radarSync,
      workspace: bundleBoardMeta
        ? { ...bundle.workspace, boardMeta: bundleBoardMeta }
        : bundle.workspace,
      objectivePortfolioPlans: bundle.workspace.portfolioPlans ?? [],
    };
    lastManualTicketHash = computeManualTicketDraftHash(
      nextState.picks,
      nextState.multiple,
      nextState.passSpec,
      cleanMatches,
      nextState.syntheticSingleMode
    );
    if (
      restoredDraft &&
      restoredDraft.droppedCount > 0 &&
      !bundleBoardMeta?.isFallbackReadOnly
    ) {
      pruneInvalidatedStoredDraftAgainstBoard(
        cleanMatches,
        undefined,
        latestBoardCapturedAt,
        verifiedDraftRaw
      );
      knownStorageWriteSeq = Math.max(
        knownStorageWriteSeq,
        readStoredHoldMeta().writeSeq
      );
    }
    const initSig = computeClientPortfolioQuoteMeta(nextState).inputSig;
    lastKnownInputSig = initSig;
    const needsPostRestoreCompute = Boolean(
      restoredDraft &&
      restoredDraft.restored &&
      (restoredDraft.picks.length > 0 ||
        restoredDraft.syntheticSingleMode === "off" ||
        restoredDraft.pendingRevokedPlanConfirm !== null ||
        restoredDraft.budget !== 100 ||
        restoredDraft.stance !== "objective" ||
        restoredDraft.allowSaveCash !== false)
    );
    computedInputSig = needsPostRestoreCompute ? "" : initSig;
    computedWorkspaceSig = needsPostRestoreCompute
      ? ""
      : computeWorkspaceExecutionSig(nextState, initSig);
    const stampedInitWs = computedWorkspaceSig
      ? stampWorkspaceRemediationMeta(nextState.workspace, computedWorkspaceSig)
      : nextState.workspace;
    state = {
      ...nextState,
      workspace: stampedInitWs,
      objectivePortfolioPlans: stampedInitWs.portfolioPlans ?? [],
    };
    emit();
    if (needsPostRestoreCompute) {
      void executeComputeNow();
    }
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

  function getShopkeeperBlockReason(
    current = reconcileState(),
    slips = current.activeAuditedSlip.physicalSlips ?? []
  ): string | null {
    const report =
      current.workspace.baselineReport ?? current.workspace.effectiveReport;
    if (options.isOffline?.()) {
      return "当前为参考盘口，需同步官方在售数据后才能出票";
    }
    if (
      current.livePortfolioQuote.isStale ||
      !report.canCheckout ||
      report.totalCost <= 0
    ) {
      return "当前选单尚未形成可出票的最新报价";
    }
    return getPhysicalTicketBlockReason(
      current.matches,
      current.workspace.boardMeta,
      report,
      slips
    );
  }

  function getPlayabilityGates(
    archKey: PortfolioKey = "max-ev-utility"
  ): PlayabilityGates {
    const reconciled = reconcileState();
    const curSlip = reconciled.activeAuditedSlip;
    const manualReport =
      reconciled.workspace.baselineManualReport ??
      reconciled.workspace.manualReport;
    const effectiveReport =
      reconciled.workspace.baselineReport ??
      reconciled.workspace.effectiveReport;
    const manualBonusLineCount = Math.max(
      manualReport.tickets?.length ?? 0,
      manualReport.betCount
    );
    const activeBonusLineCount =
      curSlip.lines.length > 0
        ? curSlip.lines.length
        : Math.max(
            effectiveReport.tickets?.length ?? 0,
            effectiveReport.betCount
          );
    const passRuleBlockReason = reconciled.manualDraft.passRuleBlockReason;
    const canCheckoutForBonus =
      curSlip.sourceKind !== "manual" && curSlip.sourceKind !== "empty"
        ? effectiveReport.canCheckout
        : manualReport.canCheckout && !passRuleBlockReason;
    const isBonusOver512 =
      (curSlip.sourceKind !== "manual" && curSlip.sourceKind !== "empty"
        ? activeBonusLineCount
        : manualBonusLineCount) > 512;
    const isBonusOptDisabled = !canCheckoutForBonus || isBonusOver512;
    const baseAppliedPlan =
      reconciled.workspace.baselineAppliedPlan !== undefined
        ? reconciled.workspace.baselineAppliedPlan
        : reconciled.workspace.appliedPlan;
    const appliedPlan = state.planSpec ? baseAppliedPlan : null;
    const effectiveAppliedPlan =
      state.planSpec || effectiveReport.syntheticAutoMounted
        ? baseAppliedPlan
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
      effectiveReport.trim2WayPreview ??
      manualReport.trim2WayPreview ??
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
    const budgetMismatchMeta = curSlip.budgetMismatchMeta;

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
      shopkeeperBlockReason: getShopkeeperBlockReason(reconciled),
      isSingleNonSingleContext,
      isSyntheticPlayable,
      hasSyntheticInherentBlindSpot,
      canTrimSynthetic2Way,
      partialCoveragePreview,
      manualBonusLineCount,
      activeBonusLineCount,
      isBonusOver512,
      isBonusOptDisabled,
      activeBankerSet,
      canToggleBanker,
      canToggleBankerMatch,
      passRuleBlockReason,
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

  function preserveAppliedPlanAcrossDraftEdit(curState: BetSlipState): {
    planSpec: AppliedPlanSpec;
    appliedTicketSnapshot: AppliedTicketSnapshot | null;
  } {
    if (!curState.planSpec) {
      return { planSpec: null, appliedTicketSnapshot: null };
    }
    if (curState.planSpec.kind === "bonus") {
      if (isSingleAuthBoundBonusPlan(curState.planSpec)) {
        return { planSpec: null, appliedTicketSnapshot: null };
      }
      const basePlan =
        curState.workspace.baselineAppliedPlan !== undefined
          ? curState.workspace.baselineAppliedPlan
          : curState.workspace.appliedPlan;
      const baseLines = basePlan?.lines ?? curState.planSpec.baseLines ?? [];
      if (!Array.isArray(baseLines) || baseLines.length === 0) {
        return { planSpec: null, appliedTicketSnapshot: null };
      }
      const baseRep =
        curState.workspace.baselineReport ?? curState.workspace.effectiveReport;
      return {
        planSpec: {
          ...curState.planSpec,
          baseLines,
          preserveExactBaseMultiples: true,
          baseSourceKind: curState.planSpec.baseSourceKind ?? "manual",
          targetBudgetCost:
            curState.planSpec.targetBudgetCost ?? baseRep.totalCost,
        },
        appliedTicketSnapshot: curState.appliedTicketSnapshot,
      };
    }
    return {
      planSpec: {
        ...curState.planSpec,
        allowBudgetMismatchReadOnly: true,
      },
      appliedTicketSnapshot: curState.appliedTicketSnapshot,
    };
  }

  return {
    getState: () => reconcileState(),
    getActiveAuditedSlip: () => reconcileState().activeAuditedSlip,
    getAuditedMatchIds: () => reconcileState().activeAuditedSlip.matchIds,
    getStanceDeltaSummary,
    getPlayabilityGates,
    getShopkeeperBlockReason: () => getShopkeeperBlockReason(),
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

    isDraftWaitingForBoard: () => Boolean(deferredDraftBoardAt),
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

    dismissDraftRestoredNotice() {
      if (!state.draftRestoredNotice) return;
      state = { ...state, draftRestoredNotice: null };
      emit();
    },

    captureSyncRequestContext(): {
      requestInputSig: string;
      requestWorkspaceSig: string;
      requestBoardEpoch: number;
      requestDraftRaw: string | null;
      requestDraftKey: string | null;
    } {
      const requestInputSig = computeClientPortfolioQuoteMeta(state).inputSig;
      return {
        requestInputSig,
        requestWorkspaceSig: computeWorkspaceExecutionSig(
          state,
          requestInputSig
        ),
        requestBoardEpoch: boardEpoch,
        requestDraftRaw: readCurrentDraftBytes(),
        requestDraftKey: resolveDraftStorageKey(),
      };
    },

    applyMatchesSync(
      res: {
        freshBoardForRequest?: boolean;
        matches: MatchItem[];
        workspace: QuantWorkspaceResponse;
        boardMeta?: BoardFreshnessMeta | null;
      },
      syncReqCtx?: {
        requestInputSig: string;
        requestWorkspaceSig: string;
        requestBoardEpoch?: number;
        requestDraftRaw?: string | null;
        requestDraftKey?: string | null;
      }
    ): boolean {
      const prevBoardById = new Map(state.matches.map((m) => [m.id, m]));
      const incomingById = new Map(res.matches.map((m) => [m.id, m]));
      const incBoardMeta = res.boardMeta ?? res.workspace?.boardMeta ?? null;
      const incCapturedAt = extractBoardCapturedAt(incBoardMeta);
      if (
        syncReqCtx?.requestDraftKey !== undefined &&
        syncReqCtx.requestDraftKey !== resolveDraftStorageKey()
      )
        return false;
      const verifiedDraftRaw =
        res.freshBoardForRequest &&
        incBoardMeta?.boardState === "fresh" &&
        !incBoardMeta.isFallbackReadOnly
          ? (syncReqCtx?.requestDraftRaw ?? undefined)
          : undefined;
      if (
        deferredDraftBoardAt &&
        incCapturedAt > 0 &&
        !incBoardMeta?.isFallbackReadOnly &&
        incCapturedAt >= deferredDraftBoardAt
      ) {
        applyAuthenticatedBundle(
          { ...res, initialPicks: [], boardMeta: incBoardMeta },
          verifiedDraftRaw
        );
        return !deferredDraftBoardAt;
      }
      const epochBehind = Boolean(
        syncReqCtx &&
        typeof syncReqCtx.requestBoardEpoch === "number" &&
        syncReqCtx.requestBoardEpoch < boardEpoch
      );
      const isOutOfOrderEpoch =
        incCapturedAt > 0 && latestBoardCapturedAt > 0
          ? incCapturedAt < latestBoardCapturedAt ||
            (incCapturedAt === latestBoardCapturedAt && epochBehind)
          : epochBehind;
      const isOlderFallbackSync = Boolean(
        incBoardMeta?.isFallbackReadOnly &&
        latestBoardCapturedAt > 0 &&
        (incCapturedAt === 0 || incCapturedAt < latestBoardCapturedAt)
      );
      if (isOlderFallbackSync) {
        const nextWsMeta = pickNewerWsBoardMeta(
          state.workspace.boardMeta,
          incBoardMeta
        );
        if (nextWsMeta !== state.workspace.boardMeta) {
          state = {
            ...state,
            workspace: { ...state.workspace, boardMeta: nextWsMeta },
          };
          emit();
        }
        return false;
      }
      if (isOutOfOrderEpoch) {
        let anySurvivingPoolAdvanced = false;
        for (const curM of state.matches) {
          const incM = incomingById.get(curM.id);
          if (!incM) continue;
          for (const pc of ALL_POOL_CODES) {
            const pStamp = normalizePoolQuoteStamp(curM.pools?.[pc]);
            const nStamp = normalizePoolQuoteStamp(incM.pools?.[pc]);
            if (nStamp && (!pStamp || nStamp > pStamp)) {
              anySurvivingPoolAdvanced = true;
              break;
            }
          }
          if (anySurvivingPoolAdvanced) break;
        }
        if (!anySurvivingPoolAdvanced) {
          const nextWsMeta = pickNewerWsBoardMeta(
            state.workspace.boardMeta,
            incBoardMeta
          );
          if (nextWsMeta !== state.workspace.boardMeta) {
            state = {
              ...state,
              workspace: { ...state.workspace, boardMeta: nextWsMeta },
            };
            emit();
          }
          return false;
        }
      } else if (incCapturedAt > latestBoardCapturedAt) {
        latestBoardCapturedAt = incCapturedAt;
      }
      const hadPendingTimer = pendingTimer !== null;
      const curInputSigBeforeMerge =
        computeClientPortfolioQuoteMeta(state).inputSig;
      const curWsSigBeforeMerge = computeWorkspaceExecutionSig(
        state,
        curInputSigBeforeMerge
      );
      const draftEditedDuringSync = Boolean(
        syncReqCtx && syncReqCtx.requestWorkspaceSig !== curWsSigBeforeMerge
      );
      bootstrapped = true;
      boardEpoch += 1;

      const nowMs = nowFn();
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
      const baseRosterSource = isOutOfOrderEpoch ? state.matches : res.matches;
      const mergedMatches = baseRosterSource.map((rosterItem) => {
        const prev = prevBoardById.get(rosterItem.id);
        const rawNm = isOutOfOrderEpoch
          ? (incomingById.get(rosterItem.id) ?? rosterItem)
          : rosterItem;
        let nm: MatchItem;
        if (isOutOfOrderEpoch && prev) {
          if (orderedMatchKey(prev) !== orderedMatchKey(rawNm)) return prev;
          let patchedPools: MatchItem["pools"] | null = null;
          for (const pc of ALL_POOL_CODES) {
            const prevPool = prev.pools?.[pc];
            const incPool = rawNm.pools?.[pc];
            if (!incPool) continue;
            const pStamp = normalizePoolQuoteStamp(prevPool);
            const nStamp = normalizePoolQuoteStamp(incPool);
            if (nStamp && (!pStamp || nStamp > pStamp)) {
              if (!patchedPools) patchedPools = { ...prev.pools };
              // An older board may advance an individual price, never revive a withdrawn permission.
              patchedPools[pc] = {
                ...incPool,
                confirmedSaleRights: prevPool?.confirmedSaleRights,
              };
            }
          }
          nm = patchedPools ? { ...prev, pools: patchedPools } : prev;
        } else {
          nm = mergeMatchPoolsNonRegressive(prev, rawNm);
        }
        if (isLiveXiaoGaoAlert(nm.aiAlert)) {
          return isClientMatchAlertBindingValid(nm.aiAlert, nm, nowMs)
            ? nm
            : { ...nm, aiAlert: undefined };
        }
        if (isLiveXiaoGaoAlert(prev?.aiAlert)) {
          return isClientMatchAlertBindingValid(prev!.aiAlert, nm, nowMs)
            ? { ...nm, aiAlert: prev!.aiAlert }
            : { ...nm, aiAlert: undefined };
        }
        if (nm.aiAlert) {
          return isClientMatchAlertBindingValid(nm.aiAlert, nm, nowMs)
            ? nm
            : { ...nm, aiAlert: undefined };
        }
        return prev?.aiAlert &&
          isClientMatchAlertBindingValid(prev.aiAlert, nm, nowMs)
          ? { ...nm, aiAlert: prev.aiAlert }
          : nm;
      });

      const validTargets = mergedMatches
        .filter((m) => state.targetIds.includes(m.id))
        .map((m) => m.id);
      const nextTargets =
        validTargets.length >= 1
          ? validTargets
          : mergedMatches.slice(0, 2).map((m) => m.id);

      const prevMatchMap = new Map(state.matches.map((m) => [m.id, m]));
      const mergedMap = new Map(mergedMatches.map((m) => [m.id, m]));
      const preDropLocalDraftHash = computeManualTicketDraftHash(
        state.picks,
        state.multiple,
        state.passSpec,
        state.matches,
        state.syntheticSingleMode
      );
      let picksRemapped = false;
      let droppedCount = 0;
      let goalLineShiftedCount = 0;
      const syncedPicks: SelectedPick[] = state.picks
        .map((pk): SelectedPick | null => {
          const um = mergedMap.get(pk.matchId);
          if (
            !isStrictSameMatchIdentity(um, pk, prevMatchMap.get(pk.matchId))
          ) {
            picksRemapped = true;
            droppedCount += 1;
            return null;
          }
          const uPool = um.pools[pk.poolCode];
          const nextSingle = resolvePoolCanSingle(uPool);
          const nextAllUp = resolvePoolCanAllUp(uPool);
          const uo = uPool?.options.find((o) => o.key === pk.optionKey);
          if (
            !uPool ||
            uPool.selling === false ||
            (!nextSingle && !nextAllUp) ||
            !uo ||
            uo.odds < 1.01
          ) {
            picksRemapped = true;
            droppedCount += 1;
            return null;
          }
          const prevGl = String(
            pk.goalLine ??
              prevMatchMap.get(pk.matchId)?.pools?.HHAD?.goalLine ??
              ""
          ).trim();
          const nextGl = String(uPool.goalLine ?? "").trim();
          if (pk.poolCode === "HHAD" && prevGl && nextGl !== prevGl) {
            picksRemapped = true;
            droppedCount += 1;
            goalLineShiftedCount += 1;
            return null;
          }
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
            th: computeOrderedMatchIdentitySig(
              um,
              Boolean(um.homeTeamId || um.awayTeamId)
            ),
            odds: uo.odds,
            fairProb: uo.fairProb,
            singleAllowed: nextSingle,
            canSingle: nextSingle,
            canAllUp: nextAllUp,
            ...resolveOptionalGoalLine(pk.poolCode, uPool, prevGl),
          };
        })
        .filter((x): x is SelectedPick => x !== null);

      const nextPassSpec =
        droppedCount > 0
          ? sanitizePassSpecForPicks(state.passSpec, syncedPicks)
          : state.passSpec;
      let nextPlanSpec = state.planSpec;
      let nextAppliedSnap = state.appliedTicketSnapshot;
      let nextNotice = state.draftRestoredNotice;
      if (droppedCount > 0) {
        nextNotice =
          goalLineShiftedCount > 0
            ? "官方让球线已发生变盘，已自动剔除失效旧让球选项，请按最新盘口重新核对选择"
            : `部分已选场次已停售或跨期下架，已自动剔除 ${droppedCount} 项失效选项`;
      }
      const incAppliedForCap =
        res.workspace?.baselineAppliedPlan !== undefined
          ? res.workspace.baselineAppliedPlan
          : res.workspace?.appliedPlan;
      if (
        nextPlanSpec?.kind === "bonus" &&
        (nextPlanSpec.confirmedCapGuardSig ||
          nextPlanSpec.allowCapEvTradeoff) &&
        (droppedCount > 0 ||
          !isCapGuardBindingValidAgainstBoard(
            nextPlanSpec.confirmedCapGuardSig,
            mergedMap
          ) ||
          Boolean(
            incAppliedForCap?.capGuardAlternative &&
            incAppliedForCap.capGuardAlternative.bindingSig !==
              nextPlanSpec.confirmedCapGuardSig
          ))
      ) {
        nextPlanSpec = {
          ...nextPlanSpec,
          confirmedCapGuardSig: undefined,
          allowCapEvTradeoff: false,
        };
        picksRemapped = true;
      }
      if (
        nextPlanSpec &&
        (hasPlanSpecBoardInvalidation(nextPlanSpec, prevMatchMap, mergedMap) ||
          (droppedCount > 0 &&
            nextPlanSpec.kind === "bonus" &&
            !nextPlanSpec.baseLines?.length))
      ) {
        const holdMsg =
          "原已套用方案涉及场次盘口或单串开售权限已变动，原方案锁定已失效；请确认改按当前手选草稿核对或重新配单后再出票";
        nextPlanSpec = null;
        nextAppliedSnap = null;
        picksRemapped = true;
        if (syncedPicks.length > 0) {
          armRevokedPlanHold(holdMsg);
        }
        if (!nextNotice) {
          nextNotice = holdMsg;
        }
      }

      const targetsChanged =
        nextTargets.length !== state.targetIds.length ||
        nextTargets.some((id, idx) => id !== state.targetIds[idx]);

      let authGrantInvalidated = false;
      let nextGrant = state.singleAuthGrant;
      let nextSynMode = state.syntheticSingleMode;
      if (nextGrant) {
        const syncedPicksSig = buildRadarSignature(syncedPicks);
        const effCost =
          (res.workspace.baselineReport ?? res.workspace.effectiveReport)
            .totalCost ?? 0;
        const grantMatch = mergedMap.get(nextGrant.matchId);
        const pickedHasHhad = syncedPicks.some((p) => p.poolCode === "HHAD");
        const hhadPick = syncedPicks.find((p) => p.poolCode === "HHAD");
        const curGl = pickedHasHhad
          ? String(
              grantMatch?.pools?.HHAD?.goalLine ?? hhadPick?.goalLine ?? ""
            ).trim()
          : "";
        const curMatchQuoteSig = computeSingleMatchQuoteVersionSig(grantMatch);
        if (
          droppedCount > 0 ||
          syncedPicks.length === 0 ||
          new Set(syncedPicks.map((p) => p.matchId)).size !== 1 ||
          syncedPicks[0].matchId !== nextGrant.matchId ||
          syncedPicksSig !== nextGrant.picksSig ||
          (nextGrant.goalLine !== undefined && curGl !== nextGrant.goalLine) ||
          (nextGrant.quoteVersionSig !== undefined &&
            nextGrant.quoteVersionSig.length > 0 &&
            curMatchQuoteSig !== nextGrant.quoteVersionSig) ||
          !isGrantLineSigValidAgainstMatch(
            nextGrant.lineAndMultipleSig,
            grantMatch
          ) ||
          (!draftEditedDuringSync &&
            (effCost > nextGrant.approvedCost + 1e-6 ||
              (nextGrant.exactCost !== undefined &&
                effCost > 0 &&
                Math.abs(effCost - nextGrant.exactCost) > 1e-6)))
        ) {
          nextGrant = null;
          nextSynMode = "full-3way";
          authGrantInvalidated = true;
        }
      }
      if (
        nextPlanSpec?.kind === "bonus" &&
        isSingleAuthBoundBonusPlan(nextPlanSpec) &&
        (authGrantInvalidated ||
          !nextGrant ||
          (nextPlanSpec.boundSingleAuthId &&
            nextPlanSpec.boundSingleAuthId !== nextGrant.authId) ||
          (nextPlanSpec.boundLineAndMultipleSig &&
            nextPlanSpec.boundLineAndMultipleSig !==
              nextGrant.lineAndMultipleSig))
      ) {
        nextPlanSpec = null;
        nextAppliedSnap = null;
        authGrantInvalidated = true;
      }

      if (syncedPicks.length === 0 && nextSynMode !== "full-3way") {
        nextSynMode = "full-3way";
        picksRemapped = true;
      }

      if (hasUnresolvedSyntheticChoice) {
        if (syncedPicks.length === 0) {
          hasUnresolvedSyntheticChoice = false;
        } else if (
          singleRequiresSynthetic(syncedPicks) &&
          nextSynMode !== "off" &&
          !nextPlanSpec &&
          !nextGrant &&
          !revokedPlanHold
        ) {
          armRevokedPlanHold(LEGACY_SINGLE_CONFIRMATION);
          picksRemapped = true;
          if (!nextNotice) nextNotice = LEGACY_SINGLE_CONFIRMATION;
        }
      }

      if (!incBoardMeta?.isFallbackReadOnly && !isOutOfOrderEpoch) {
        pruneInvalidatedStoredDraftAgainstBoard(
          mergedMatches,
          preDropLocalDraftHash,
          incCapturedAt,
          verifiedDraftRaw
        );
      }

      const postMergeBaseState: BetSlipState = {
        ...state,
        matches: mergedMatches,
        targetIds: nextTargets,
        picks: syncedPicks,
        manualDraftPicks: syncedPicks,
        passSpec: nextPassSpec,
        planSpec: nextPlanSpec,
        appliedTicketSnapshot: nextAppliedSnap,
        draftRestoredNotice: nextNotice,
        singleAuthGrant: nextGrant,
        syntheticSingleMode: nextSynMode,
      };
      const postMergeInputSig =
        computeClientPortfolioQuoteMeta(postMergeBaseState).inputSig;
      const postMergeWsSig = computeWorkspaceExecutionSig(
        postMergeBaseState,
        postMergeInputSig
      );
      const canAcceptSyncedWorkspace =
        !isOutOfOrderEpoch &&
        !draftEditedDuringSync &&
        !hadPendingTimer &&
        inFlightPromise === null &&
        !picksRemapped &&
        !targetsChanged &&
        !authGrantInvalidated &&
        (!res.workspace.quoteInputSig ||
          res.workspace.quoteInputSig === postMergeInputSig);

      const reconciledWsBoardMeta = isOutOfOrderEpoch
        ? state.workspace.boardMeta
        : incBoardMeta
          ? pickNewerWsBoardMeta(state.workspace.boardMeta, incBoardMeta)
          : undefined;

      if (canAcceptSyncedWorkspace) {
        cancelPendingTimer();
        computeSeq += 1;
        const syncedWorkspaceWithMeta = {
          ...res.workspace,
          boardMeta: reconciledWsBoardMeta,
        };
        const nextSyncedState: BetSlipState = {
          ...postMergeBaseState,
          workspace: syncedWorkspaceWithMeta,
          objectivePortfolioPlans: resolveObjectivePortfolioPlans(
            state.stance,
            syncedWorkspaceWithMeta,
            state.objectivePortfolioPlans
          ),
        };
        computedInputSig = postMergeInputSig;
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
        computedWorkspaceSig = computeWorkspaceExecutionSig(
          nextSyncedState,
          computedInputSig
        );
        const stampedSyncedWs = stampWorkspaceRemediationMeta(
          nextSyncedState.workspace,
          computedWorkspaceSig
        );
        state = {
          ...nextSyncedState,
          workspace: stampedSyncedWs,
          objectivePortfolioPlans: resolveObjectivePortfolioPlans(
            state.stance,
            stampedSyncedWs,
            state.objectivePortfolioPlans
          ),
        };
        emit();
        return true;
      }

      const planWasRevoked = Boolean(
        authGrantInvalidated || (state.planSpec && !nextPlanSpec)
      );
      if (planWasRevoked && syncedPicks.length > 0 && !revokedPlanHold) {
        armRevokedPlanHold(
          authGrantInvalidated
            ? "原已确认单关授权涉及场次盘口或单关开售权限已变动，原实票已失效；请重新选择单关方案或按手选核对后再出票"
            : "原已套用方案涉及场次盘口或单串开售权限已变动，原方案锁定已失效；请确认改按当前手选草稿核对或重新配单后再出票"
        );
      }
      const baseRetainedWs: QuantWorkspaceResponse =
        reconciledWsBoardMeta !== state.workspace.boardMeta
          ? { ...state.workspace, boardMeta: reconciledWsBoardMeta }
          : state.workspace;
      const safeRetainedWorkspace: QuantWorkspaceResponse = planWasRevoked
        ? {
            ...baseRetainedWs,
            appliedPlan: null,
            baselineAppliedPlan: null,
            effectiveReport: {
              ...baseRetainedWs.effectiveReport,
              canCheckout: false,
              totalCost: 0,
              selectionStatus:
                syncedPicks.length === 1
                  ? "pending-single-auth"
                  : "rule-blocked",
            },
            ...(baseRetainedWs.baselineReport
              ? {
                  baselineReport: {
                    ...baseRetainedWs.baselineReport,
                    canCheckout: false,
                    totalCost: 0,
                    selectionStatus:
                      syncedPicks.length === 1
                        ? "pending-single-auth"
                        : "rule-blocked",
                  },
                }
              : {}),
          }
        : baseRetainedWs;
      const currentWsAlreadyFresh =
        !hadPendingTimer &&
        inFlightPromise === null &&
        !picksRemapped &&
        !targetsChanged &&
        !authGrantInvalidated &&
        !planWasRevoked &&
        postMergeInputSig === computedInputSig &&
        postMergeWsSig === computedWorkspaceSig;

      state = {
        ...postMergeBaseState,
        workspace: safeRetainedWorkspace,
      };
      if (currentWsAlreadyFresh && !isOutOfOrderEpoch) {
        emit();
        return !isOutOfOrderEpoch;
      }
      computedWorkspaceSig = "";
      emit();
      void scheduleRefresh();
      return !isOutOfOrderEpoch;
    },

    async applyMatchAiAlert(
      matchId: string,
      alert: NonNullable<MatchItem["aiAlert"]>
    ) {
      const nowMs = nowFn();
      state = {
        ...state,
        matches: state.matches.map((item) => {
          if (item.id !== matchId) return item;
          const stampedAlert = alert.binding
            ? alert
            : {
                ...alert,
                binding: computeClientMatchAlertBinding(item, nowMs),
              };
          return { ...item, aiAlert: stampedAlert };
        }),
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
        binding?: XiaoGaoAlertBinding;
      }>;
    }) {
      if (!Array.isArray(rep?.perMatch) || rep.perMatch.length === 0) return;
      const nowMs = nowFn();
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
              binding:
                pm.binding ?? computeClientMatchAlertBinding(item, nowMs),
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
      const resetSynMode: SyntheticSingleMode =
        state.syntheticSingleMode === "partial-cover" ||
        state.syntheticSingleMode === "trim-2way"
          ? "full-3way"
          : state.syntheticSingleMode;
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
        clearRevokedPlanHoldOnUserAction();
        state = {
          ...state,
          ...preserveAppliedPlanAcrossDraftEdit(state),
          singleAuthGrant: null,
          syntheticSingleMode:
            nextPicks.length === 0 ? "full-3way" : resetSynMode,
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

      if (state.mode === "single" && !poolSingleOk) {
        return {
          ok: false,
          blockedReason: "当前处于【单关】筛选，该玩法仅支持串关（未开单关）",
        };
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
            backgroundEdit: Boolean(state.planSpec || revokedPlanHold),
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
            th: computeOrderedMatchIdentitySig(
              m,
              Boolean(m.homeTeamId || m.awayTeamId)
            ),
            poolCode,
            poolName: pool.name,
            singleAllowed: poolSingleOk,
            canSingle: poolSingleOk,
            canAllUp: poolAllUpOk,
            ...resolveOptionalGoalLine(poolCode, pool),
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
            ? { mode: "follow-max-parlay" as const }
            : state.passSpec;
          clearRevokedPlanHoldOnUserAction();
          state = {
            ...state,
            ...preserveAppliedPlanAcrossDraftEdit(state),
            singleAuthGrant: null,
            syntheticSingleMode: resetSynMode,
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
            th: computeOrderedMatchIdentitySig(
              m,
              Boolean(m.homeTeamId || m.awayTeamId)
            ),
            poolCode,
            poolName: pool.name,
            singleAllowed: poolSingleOk,
            canSingle: poolSingleOk,
            canAllUp: poolAllUpOk,
            ...resolveOptionalGoalLine(poolCode, pool),
            optionKey: opt.key,
            optionLabel: opt.label,
            odds: opt.odds,
            fairProb: opt.fairProb,
          },
        ];
        clearRevokedPlanHoldOnUserAction();
        state = {
          ...state,
          ...preserveAppliedPlanAcrossDraftEdit(state),
          singleAuthGrant: null,
          syntheticSingleMode: resetSynMode,
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
      if (
        state.mode === "single" &&
        poolSingleOk &&
        (state.picks.length === 0 ||
          (state.passSpec.mode === "free" &&
            state.passSpec.passSizes?.length === 1 &&
            state.passSpec.passSizes[0] === 1))
      ) {
        nextPassSpec = { mode: "free", passSizes: [1] };
      }
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
          th: computeOrderedMatchIdentitySig(
            m,
            Boolean(m.homeTeamId || m.awayTeamId)
          ),
          poolCode,
          poolName: pool.name,
          singleAllowed: poolSingleOk,
          canSingle: poolSingleOk,
          canAllUp: poolAllUpOk,
          ...resolveOptionalGoalLine(poolCode, pool),
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        },
      ];
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        ...preserveAppliedPlanAcrossDraftEdit(state),
        singleAuthGrant: null,
        syntheticSingleMode: resetSynMode,
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
      syncSharedHoldFromStorage();
      const snap = state.lastPoolSwitchUndo;
      if (!snap) return false;
      const curById = new Map(state.matches.map((m) => [m.id, m]));
      const changedIndex = state.picks.findIndex(
        (p) => p.matchId === snap.matchId
      );
      if (changedIndex < 0) {
        state = { ...state, lastPoolSwitchUndo: null };
        emit();
        return false;
      }
      const match = curById.get(snap.matchId);
      const restored = snap.picks.flatMap((pk) => {
        if (
          pk.matchId !== snap.matchId ||
          !isStrictSameMatchIdentity(match, pk)
        )
          return [];
        const pool = match.pools?.[pk.poolCode];
        const option = pool?.options?.find((o) => o.key === pk.optionKey);
        if (
          !option ||
          pool.selling === false ||
          (pk.poolCode === "HHAD" &&
            String(pk.goalLine ?? "") !== String(pool.goalLine ?? ""))
        )
          return [];
        return [
          {
            ...pk,
            odds: option.odds,
            fairProb: option.fairProb,
            canSingle: resolvePoolCanSingle(pool),
            canAllUp: resolvePoolCanAllUp(pool),
            singleAllowed: resolvePoolCanSingle(pool),
          },
        ];
      });
      const validUndoPicks = state.picks.filter(
        (p) => p.matchId !== snap.matchId
      );
      const originalIndex = snap.picks.findIndex(
        (p) => p.matchId === snap.matchId
      );
      const followingMatches = new Set(
        snap.picks.slice(originalIndex + 1).map((p) => p.matchId)
      );
      const nextIndex = validUndoPicks.findIndex((p) =>
        followingMatches.has(p.matchId)
      );
      validUndoPicks.splice(
        nextIndex < 0 ? validUndoPicks.length : nextIndex,
        0,
        ...restored
      );
      const preserveCurrentTicket = Boolean(
        snap.backgroundEdit || state.planSpec || revokedPlanHold
      );
      const invalidPlan =
        !preserveCurrentTicket &&
        snap.planSpec &&
        (snap.planHoldRev !== localHoldRev ||
          hasPlanSpecBoardInvalidation(
            snap.planSpec,
            new Map(snap.planBoard?.map((m) => [m.id, m])),
            curById
          ));
      if (invalidPlan && !revokedPlanHold) {
        armRevokedPlanHold(
          "原方案的比赛身份或开售资格已变动，请重新核对后再出票"
        );
      }
      state = {
        ...state,
        picks: validUndoPicks,
        ...(state.planSpec && !isSingleAuthBoundBonusPlan(state.planSpec)
          ? preserveAppliedPlanAcrossDraftEdit(state)
          : {}),
        ...(!preserveCurrentTicket
          ? {
              ...(typeof snap.multiple === "number"
                ? { multiple: snap.multiple }
                : {}),
              passSpec: sanitizePassSpecForPicks(snap.passSpec, validUndoPicks),
              planSpec: invalidPlan ? null : snap.planSpec,
              ...(invalidPlan ? { appliedTicketSnapshot: null } : {}),
            }
          : {}),
        lastPoolSwitchUndo: null,
        ...syncAutoRadarFields(validUndoPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    setMode(nextMode: MatchMode): { trimmed: boolean } {
      syncSharedHoldFromStorage();
      let nextPicks = state.picks;
      let nextPassSpec = state.passSpec;
      let trimmed = false;

      if (nextMode !== "spf" && nextMode !== "single") {
        const res = trimToSinglePoolPerMatch(state.picks);
        nextPicks = res.cleaned;
        trimmed = res.trimmed;
        if (trimmed) {
          nextPassSpec = { mode: "follow-max-parlay" };
        }
      }

      if (trimmed) {
        const meta = readStoredHoldMeta();
        if (
          !revokedPlanHold &&
          state.planSpec === null &&
          state.singleAuthGrant === null &&
          meta.clearSeq <= localClearSeq &&
          meta.holdRev <= clearedHoldRev
        ) {
          clearRevokedPlanHoldOnUserAction();
        }
      }
      state = {
        ...state,
        mode: nextMode,
        picks: nextPicks,
        passSpec: nextPassSpec,
        ...(trimmed
          ? {
              singleAuthGrant: null,
              ...(nextPicks.length === 0
                ? { syntheticSingleMode: "full-3way" as SyntheticSingleMode }
                : {}),
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
      deferredDraftBoardAt = 0;
      clearRevokedPlanHoldOnUserAction();
      const resetOverrideState = { ...state, manualPoolOverride: false };
      state = {
        ...resetOverrideState,
        picks: [],
        planSpec: null,
        appliedTicketSnapshot: null,
        singleAuthGrant: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        simVoidFirstMatch: false,
        voidMatchIds: [],
        passSpec: { mode: "follow-max-parlay" },
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
      if (normalized !== state.syntheticSingleMode) syntheticApproval = null;
      const nextGrant = mintSingleAuthGrant(state, normalized);
      if (
        state.syntheticSingleMode === normalized &&
        state.singleAuthGrant?.mode === nextGrant?.mode &&
        state.singleAuthGrant?.exactCost === nextGrant?.exactCost &&
        state.singleAuthGrant?.lineAndMultipleSig ===
          nextGrant?.lineAndMultipleSig &&
        Boolean(state.singleAuthGrant) === Boolean(nextGrant) &&
        !revokedPlanHold &&
        !hasUnresolvedSyntheticChoice
      ) {
        return;
      }
      hasUnresolvedSyntheticChoice = false;
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        planSpec: null,
        syntheticSingleMode: normalized,
        singleAuthGrant: nextGrant,
      };
      emit();
      void scheduleRefresh();
    },

    confirmPartialCoverageSingle(
      explicitPreview?: PartialCoveragePreview | null
    ): { ok: boolean; grant: SingleAuthGrant | null } {
      const defaultPreview =
        state.workspace.effectiveReport.partialCoveragePreview ??
        state.workspace.manualReport.partialCoveragePreview ??
        null;
      const targetPreview = explicitPreview ?? defaultPreview;
      if (!targetPreview || state.picks.length === 0) {
        return { ok: false, grant: null };
      }
      const candidates = [
        defaultPreview,
        ...(state.workspace.manualReport.crossPoolSingleAlternatives ?? []),
      ].filter((candidate) => candidate != null);
      const displayedSig = buildSinglePreviewLineSig(
        targetPreview,
        state.multiple
      );
      if (
        state.livePortfolioQuote.isStale ||
        !candidates.some(
          (candidate) =>
            candidate.previewCost === targetPreview.previewCost &&
            buildSinglePreviewLineSig(candidate, state.multiple) ===
              displayedSig
        )
      ) {
        return { ok: false, grant: null };
      }
      syntheticApproval = null;
      const grant = mintSingleAuthGrant(state, "partial-cover", targetPreview);
      if (!grant) {
        return { ok: false, grant: null };
      }
      hasUnresolvedSyntheticChoice = false;
      clearRevokedPlanHoldOnUserAction();
      const targetSig = buildSinglePreviewLineSig(
        targetPreview,
        state.multiple
      );
      const defaultSig = buildSinglePreviewLineSig(
        defaultPreview,
        state.multiple
      );
      const isSecondaryCrossPoolAlt =
        Boolean(explicitPreview) &&
        Array.isArray(targetPreview.previewLines) &&
        targetPreview.previewLines.length > 0 &&
        targetSig !== defaultSig;
      state = {
        ...state,
        syntheticSingleMode: "partial-cover",
        singleAuthGrant: grant,
        planSpec: isSecondaryCrossPoolAlt
          ? {
              kind: "bonus",
              optMode: "equal",
              baseLines: targetPreview.previewLines,
              preserveExactBaseMultiples: true,
              baseSourceKind: "auto-synthetic",
              baseTitle: targetPreview.poolName,
              targetBudgetCost: targetPreview.previewCost,
              boundSingleAuthId: grant.authId,
              boundQuoteVersionSig: grant.quoteVersionSig,
              boundLineAndMultipleSig: grant.lineAndMultipleSig,
              scaleMultiple: 1,
              consolidateTickets: true,
            }
          : null,
      };
      emit();
      void scheduleRefresh();
      return { ok: true, grant };
    },

    removeMatchFromSlip(matchId: string) {
      clearRevokedPlanHoldOnUserAction();
      const nextPicks = state.picks.filter((p) => p.matchId !== matchId);
      state = {
        ...state,
        ...preserveAppliedPlanAcrossDraftEdit(state),
        singleAuthGrant: null,
        syntheticSingleMode:
          nextPicks.length === 0 ||
          state.syntheticSingleMode === "partial-cover" ||
          state.syntheticSingleMode === "trim-2way"
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
      const retainsOldSelection = nextPicks.some((next) =>
        state.picks.some(
          (p) =>
            p.matchId === next.matchId &&
            p.poolCode === next.poolCode &&
            p.optionKey === next.optionKey
        )
      );
      if (!retainsOldSelection) hasUnresolvedSyntheticChoice = false;
      clearRevokedPlanHoldOnUserAction();
      const enriched = enrichPicksWithBoardGoalLine(nextPicks, state.matches);
      state = {
        ...state,
        planSpec: null,
        singleAuthGrant: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        passSpec: { mode: "follow-max-parlay" },
        picks: enriched,
        ...syncAutoRadarFields(enriched, state.matches, state),
      };
      emit();
      void scheduleRefresh();
    },

    clearOrphanedBankers(): { ok: boolean } {
      const distinctIds = Array.from(
        new Set(state.picks.map((p) => p.matchId))
      );
      const remainingBankers = (state.passSpec.bankerMatchIds ?? []).filter(
        (id) => distinctIds.includes(id)
      );
      const rawSizes = Array.isArray(state.passSpec.passSizes)
        ? Array.from(
            new Set(state.passSpec.passSizes.filter((s) => s >= 1 && s <= 8))
          ).sort((a, b) => a - b)
        : [];
      const hasCurrentlyPlayableSize = rawSizes.some(
        (s) => s >= 1 && s <= distinctIds.length
      );
      const nextPassSpec: PassSelectionSpec =
        distinctIds.length <= 1 &&
        remainingBankers.length === 0 &&
        !hasCurrentlyPlayableSize
          ? { mode: "follow-max-parlay" }
          : rawSizes.length > 0 && hasCurrentlyPlayableSize
            ? {
                mode: "free",
                passSizes: rawSizes,
                ...(remainingBankers.length > 0
                  ? { bankerMatchIds: remainingBankers }
                  : {}),
              }
            : remainingBankers.length > 0
              ? {
                  mode: "free",
                  passSizes: [Math.max(2, Math.min(8, distinctIds.length - 1))],
                  bankerMatchIds: remainingBankers,
                }
              : { mode: "follow-max-parlay" };
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        planSpec: null,
        passSpec: sanitizePassSpecForPicks(nextPassSpec, state.picks),
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    resetPassAuto() {
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        planSpec: null,
        passSpec: { mode: "follow-max-parlay" },
      };
      emit();
      void scheduleRefresh();
    },

    setDirectMultiple(nextRaw: number): number {
      return applyMultiple(
        Math.max(1, Math.min(999, Math.round(nextRaw) || 1))
      );
    },

    stepMultiple(delta: number): number {
      return applyMultiple(Math.max(1, Math.min(999, state.multiple + delta)));
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
      const currentActive =
        !state.planSpec &&
        state.passSpec.mode === "free" &&
        Array.isArray(state.passSpec.passSizes) &&
        state.passSpec.passSizes.length > 0
          ? state.passSpec.passSizes.filter((sz) =>
              manualReport.availableFreePasses.some(
                (f) => f.size === sz && f.enabled
              )
            )
          : manualReport.activeComboCode
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
      clearRevokedPlanHoldOnUserAction();
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
          ? { mode: "follow-max-parlay" }
          : { mode: "combo", comboCode: code };
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        planSpec: null,
        passSpec: nextSpec,
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    applyBonusOptimization(
      optMode: BonusOptMode,
      opts?: {
        allowUnbundleCombo?: boolean;
        requireComboConfirm?: boolean;
        allowCapEvTradeoff?: boolean;
      }
    ): {
      ok: boolean;
      modeTitle?: string;
      awaitingSyntheticQuote?: boolean;
      blockedReason?: string;
      noOpReason?: string | null;
      unchanged?: boolean;
      requiresComboUnbundleConfirm?: boolean;
      comboCode?: string;
      comboLabel?: string;
      capGuardAlternative?: CapGuardAlternative | null;
    } {
      const cur = reconcileState();
      if (cur.pendingSyntheticChoice) {
        return {
          ok: false,
          blockedReason: "请先确认合成单关的实际票行及金额，再进行分倍",
        };
      }
      const curSlip = cur.activeAuditedSlip;
      const effRep =
        cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
      const manualRep =
        cur.workspace.baselineManualReport ?? cur.workspace.manualReport;
      const useActiveBase =
        curSlip.sourceKind === "archetype" ||
        curSlip.sourceKind === "auto-synthetic" ||
        curSlip.sourceKind === "bonus-opt";
      const originalBaseLines =
        useActiveBase &&
        cur.planSpec?.kind === "bonus" &&
        Array.isArray(cur.planSpec.baseLines) &&
        cur.planSpec.baseLines.length > 0
          ? cur.planSpec.baseLines
          : useActiveBase && curSlip.lines.length > 0
            ? curSlip.lines
            : undefined;
      const baseSourceKind:
        "manual" | "auto-synthetic" | "bonus-opt" | "archetype" | undefined =
        useActiveBase &&
        cur.planSpec?.kind === "bonus" &&
        cur.planSpec.baseSourceKind
          ? cur.planSpec.baseSourceKind
          : useActiveBase && curSlip.sourceKind !== "empty"
            ? curSlip.sourceKind
            : undefined;
      const isSyntheticBase = baseSourceKind === "auto-synthetic";
      const baseLines = isSyntheticBase ? curSlip.lines : originalBaseLines;
      const curBasePlan =
        cur.workspace.baselineAppliedPlan !== undefined
          ? cur.workspace.baselineAppliedPlan
          : cur.workspace.appliedPlan;
      const baseTitle =
        useActiveBase &&
        cur.planSpec?.kind === "bonus" &&
        cur.planSpec.baseTitle
          ? cur.planSpec.baseTitle
          : useActiveBase
            ? curBasePlan?.shortTab || curBasePlan?.title
            : undefined;

      const targetRep = useActiveBase ? effRep : manualRep;
      if (
        !baseLines?.length &&
        targetRep.combos.length === 0 &&
        targetRep.betCount === 0
      ) {
        return { ok: false };
      }
      const lineCount = baseLines?.length
        ? baseLines.length
        : Math.max(targetRep.tickets?.length ?? 0, targetRep.betCount);
      if (lineCount > 512) {
        return {
          ok: false,
          blockedReason:
            "当前复式超出 512 注线下逐票分倍上限，请精简包号或改用【3+1 精算配单】",
        };
      }
      const passRuleErr = !useActiveBase
        ? cur.manualDraft.passRuleBlockReason
        : null;
      if (!targetRep.canCheckout || passRuleErr) {
        return {
          ok: false,
          blockedReason:
            passRuleErr ||
            targetRep.ruleBlockReason ||
            "当前选单暂不满足合法出票条件",
        };
      }
      if (
        !useActiveBase &&
        manualRep.activeComboCode &&
        !opts?.allowUnbundleCombo &&
        opts?.requireComboConfirm
      ) {
        return {
          ok: false,
          requiresComboUnbundleConfirm: true,
          comboCode: manualRep.activeComboCode,
          comboLabel: manualRep.modeLabel,
          blockedReason: `当前固定多串【${manualRep.modeLabel}】需先确认将固定多串解绑为独立自由串关以启用不等倍分倍`,
        };
      }

      const priorLinesSig = curSlip.lines.length
        ? curSlip.lines
            .map(
              (ln) =>
                `${ln.legs
                  .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
                  .sort()
                  .join("+")}@${ln.multiple}`
            )
            .sort()
            .join(";")
        : (manualRep.tickets ?? [])
            .map(
              (tk) =>
                `${(tk.legs ?? [])
                  .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
                  .sort()
                  .join("+")}@${tk.multiple ?? cur.multiple}`
            )
            .sort()
            .join(";");

      const zeroSpareUnits = baseLines?.length
        ? baseLines.every((ln) => (ln.multiple ?? 1) <= 1) &&
          targetRep.totalCost <= baseLines.length * 2 + 1e-6
        : cur.multiple <= 1 && lineCount >= 1;

      let syntheticGrant: SingleAuthGrant | null = null;
      if (isSyntheticBase) {
        const scope = syntheticApprovalScope(cur, cur.picks[0]?.matchId);
        const baseQuote = syntheticConfirmation(
          cur,
          scope,
          baseLines ?? [],
          targetRep.totalCost,
          encodeSyntheticLinesSig(baseLines, cur.multiple)
        );
        if (
          cur.livePortfolioQuote.isStale ||
          !baseLines?.length ||
          syntheticApproval?.signature !== baseQuote.signature
        ) {
          return {
            ok: false,
            blockedReason: "请先核对当前合成单关的票行及金额",
          };
        }
        syntheticGrant = mintSingleAuthGrant(
          cur,
          cur.syntheticSingleMode,
          null,
          baseLines
        );
        if (!syntheticGrant) {
          return {
            ok: false,
            blockedReason: "原合成单关的报价已变，请重新核对",
          };
        }
      }
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        ...(syntheticGrant ? { singleAuthGrant: syntheticGrant } : {}),
        planSpec: {
          kind: "bonus",
          optMode,
          ...(syntheticGrant
            ? {
                boundSingleAuthId: syntheticGrant.authId,
                boundQuoteVersionSig: syntheticGrant.quoteVersionSig,
                boundLineAndMultipleSig: syntheticGrant.lineAndMultipleSig,
              }
            : {}),
          ...(opts?.allowUnbundleCombo ? { allowUnbundleCombo: true } : {}),
          ...(opts?.allowCapEvTradeoff ? { allowCapEvTradeoff: true } : {}),
          ...(baseLines
            ? {
                baseLines,
                baseSourceKind,
                baseTitle,
                targetBudgetCost: targetRep.totalCost,
              }
            : {}),
          scaleMultiple: 1,
          consolidateTickets: true,
        },
      };
      emit();
      void scheduleRefresh();

      const afterSlip = reconcileState().activeAuditedSlip;
      const afterLinesSig = afterSlip.lines.length
        ? afterSlip.lines
            .map(
              (ln) =>
                `${ln.legs
                  .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
                  .sort()
                  .join("+")}@${ln.multiple}`
            )
            .sort()
            .join(";")
        : "";
      const afterPlan =
        state.workspace.baselineAppliedPlan !== undefined
          ? state.workspace.baselineAppliedPlan
          : state.workspace.appliedPlan;
      const serverNoOp = afterPlan?.bonusNoOpReason ?? null;
      const isIdenticalSync =
        debounceMs <= 0 &&
        !inFlightPromise &&
        priorLinesSig.length > 0 &&
        afterLinesSig === priorLinesSig;
      const noOpReason =
        serverNoOp ||
        (zeroSpareUnits
          ? "当前每票均为 1 倍无机动余量，需增加预算或倍数后方可重分配"
          : isIdenticalSync
            ? "当前赔率结构下分倍结果与原方案每票倍数完全一致，未产生注数变动"
            : null);

      const modeTitle =
        optMode === "equal"
          ? "平均优化"
          : optMode === "hot-first"
            ? "博热保本"
            : "博冷高弹";
      const awaitingSyntheticQuote =
        isSyntheticBase &&
        Boolean(
          pendingTimer || inFlightPromise || state.pendingSyntheticChoice
        );
      return {
        ok: !awaitingSyntheticQuote,
        modeTitle,
        awaitingSyntheticQuote,
        noOpReason,
        unchanged: Boolean(noOpReason),
        capGuardAlternative: afterPlan?.capGuardAlternative ?? null,
        ...(afterPlan?.requiresComboUnbundleConfirm
          ? {
              requiresComboUnbundleConfirm: true,
              comboCode: manualRep.activeComboCode || undefined,
              comboLabel: manualRep.modeLabel,
            }
          : {}),
      };
    },

    confirmBonusCapGuardAlternative(alt?: CapGuardAlternative | null): {
      ok: boolean;
      blockedReason?: string;
    } {
      const cur = reconcileState();
      if (cur.livePortfolioQuote.isStale) {
        return {
          ok: false,
          blockedReason: "当前选单重算未完成，请稍候核对最新报价",
        };
      }
      if (!cur.planSpec || cur.planSpec.kind !== "bonus") {
        return {
          ok: false,
          blockedReason: "当前未处于奖金分倍模式，无法应用封顶减倍备选",
        };
      }
      const curExecSig = computeWorkspaceExecutionSig(
        cur,
        cur.livePortfolioQuote.inputSig
      );
      const curApplied =
        cur.workspace.baselineAppliedPlan !== undefined
          ? cur.workspace.baselineAppliedPlan
          : cur.workspace.appliedPlan;
      const liveAlt = curApplied?.capGuardAlternative ?? null;
      if (
        !liveAlt ||
        !Array.isArray(liveAlt.multiples) ||
        !liveAlt.multiples.length ||
        typeof liveAlt.bindingSig !== "string" ||
        !liveAlt.bindingSig.startsWith("cg1|")
      ) {
        return {
          ok: false,
          blockedReason: "当前报价下不存在待确认的封顶减倍备选方案",
        };
      }
      if (alt?.sourceWorkspaceSig && alt.sourceWorkspaceSig !== curExecSig) {
        return {
          ok: false,
          blockedReason: "原封顶减倍备选对应的选单或报价已变更，请重新核对",
        };
      }
      if (alt?.bindingSig && alt.bindingSig !== liveAlt.bindingSig) {
        return {
          ok: false,
          blockedReason: "原封顶减倍备选绑定的逐腿赔率或分倍已变更，请重新核对",
        };
      }
      if (
        liveAlt.sourceWorkspaceSig &&
        liveAlt.sourceWorkspaceSig !== curExecSig
      ) {
        return {
          ok: false,
          blockedReason: "原封顶减倍备选对应的选单或报价已变更，请重新核对",
        };
      }
      if (
        alt &&
        Array.isArray(alt.multiples) &&
        alt.multiples.join(",") !== liveAlt.multiples.join(",")
      ) {
        return {
          ok: false,
          blockedReason: "备选分倍结构已发生变更，请重新确认最新方案",
        };
      }
      state = {
        ...cur,
        planSpec: {
          ...cur.planSpec,
          allowCapEvTradeoff: true,
          confirmedCapGuardSig: liveAlt.bindingSig,
        },
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
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

      clearRevokedPlanHoldOnUserAction();
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
        voidMatchIds: [],
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    confirmSyntheticChoiceQuote(signature: string) {
      const current = reconcileState();
      if (
        !signature ||
        current.livePortfolioQuote.isStale ||
        current.pendingSyntheticChoice?.quote?.signature !== signature
      ) {
        return false;
      }
      const matchId = current.picks[0]?.matchId;
      const scope = matchId && syntheticApprovalScope(current, matchId);
      if (!scope) return false;
      syntheticApproval = {
        signature,
        matchId,
        scope,
        mode: current.syntheticSingleMode,
        ...(current.pendingSyntheticChoice.quote.referenceOnly
          ? { referenceOnly: true }
          : {}),
        ...(current.singleAuthGrant ? { grant: current.singleAuthGrant } : {}),
        ...(current.planSpec?.kind === "bonus" &&
        isSingleAuthBoundBonusPlan(current.planSpec)
          ? { plan: current.planSpec }
          : {}),
      };
      hasUnresolvedSyntheticChoice = false;
      clearRevokedPlanHoldOnUserAction();
      pendingExplicitTicketPersist = true;
      emit();
      return true;
    },

    restoreEqualMultiple() {
      this.revertToManualDraft(false);
    },

    revertToManualDraft(_confirmSyntheticChoice?: boolean) {
      pendingRequote = null;
      if (syntheticApproval?.mode !== "full-3way") syntheticApproval = null;
      clearRevokedPlanHoldOnUserAction();
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
        singleAuthGrant: null,
        syntheticSingleMode: safeSynMode,
        simVoidFirstMatch: false,
        voidMatchIds: [],
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

    previewEquivalentSwap(arb: EquivalentArbItem): EquivalentSwapPreview {
      const cur = reconcileState();
      const fm = cur.matches.find((x) => x.id === arb?.matchId);
      const baseRep =
        cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
      const manRep =
        cur.workspace.baselineManualReport ?? cur.workspace.manualReport;
      const prevTotalCost =
        baseRep.totalCost > 0
          ? baseRep.totalCost
          : manRep.totalCost > 0
            ? manRep.totalCost
            : Math.max(1, cur.picks.length) * cur.multiple * 2;
      if (cur.livePortfolioQuote.isStale) {
        return {
          ok: false,
          blockedReason: "当前选单重算未完成，请稍候核对最新报价",
          nextPicks: cur.picks,
          preservedOtherPicks: [],
          originalMultiple: cur.multiple,
          targetBudgetCost: prevTotalCost,
        };
      }
      if (!fm) {
        return {
          ok: false,
          blockedReason: "未找到对应赛事盘口",
          nextPicks: cur.picks,
          preservedOtherPicks: [],
          originalMultiple: cur.multiple,
          targetBudgetCost: prevTotalCost,
        };
      }
      const matchPicks = cur.picks.filter((p) => p.matchId === fm.id);
      const hasAllWorsePicks =
        arb.worsePicks.length > 0 &&
        arb.worsePicks.every((wp) => {
          const picked = matchPicks.find(
            (p) => p.poolCode === wp.poolCode && p.optionKey === wp.optionKey
          );
          if (!picked) return false;
          const livePool = fm.pools[wp.poolCode];
          const liveOpt = livePool?.options.find((o) => o.key === wp.optionKey);
          if (!livePool || livePool.selling === false || !liveOpt) return false;
          if (Math.abs(Number(picked.odds) - Number(liveOpt.odds)) > 1e-6) {
            return false;
          }
          if (
            typeof wp.odds === "number" &&
            Math.abs(Number(picked.odds) - Number(wp.odds)) > 1e-6
          ) {
            return false;
          }
          if (wp.poolCode === "HHAD") {
            const liveGl = String(livePool.goalLine ?? "").trim();
            const pickedGl = String(picked.goalLine ?? "").trim();
            if (pickedGl && pickedGl !== liveGl) return false;
            if (
              wp.goalLine !== undefined &&
              String(wp.goalLine).trim() !== liveGl
            ) {
              return false;
            }
          }
          return true;
        });
      if (!hasAllWorsePicks) {
        return {
          ok: false,
          blockedReason: "当前选单不包含待置换的原选项集合或赔率已变更",
          nextPicks: cur.picks,
          preservedOtherPicks: [],
          originalMultiple: cur.multiple,
          targetBudgetCost: prevTotalCost,
        };
      }
      const preservedOtherPicks = matchPicks.filter(
        (p) =>
          !arb.worsePicks.some(
            (wp) => wp.poolCode === p.poolCode && wp.optionKey === p.optionKey
          )
      );
      const cleaned = cur.picks.filter(
        (p) =>
          !(
            p.matchId === fm.id &&
            arb.worsePicks.some(
              (wp) => wp.poolCode === p.poolCode && wp.optionKey === p.optionKey
            )
          )
      );
      const additions: SelectedPick[] = [];
      for (const bp of arb.betterPicks) {
        const pool = fm.pools[bp.poolCode];
        const opt = pool?.options.find((o) => o.key === bp.optionKey);
        if (
          !pool ||
          pool.selling === false ||
          !opt ||
          opt.odds < 1.01 ||
          (typeof bp.odds === "number" &&
            Math.abs(Number(opt.odds) - Number(bp.odds)) > 1e-6)
        ) {
          return {
            ok: false,
            blockedReason: "目标等价玩法当前暂未开售或赔率已更新",
            nextPicks: cur.picks,
            preservedOtherPicks,
            originalMultiple: cur.multiple,
            targetBudgetCost: prevTotalCost,
          };
        }
        const already = cleaned.some(
          (p) =>
            p.matchId === fm.id &&
            p.poolCode === bp.poolCode &&
            p.optionKey === bp.optionKey
        );
        if (already) continue;
        const canSingle = resolvePoolCanSingle(pool);
        const canAllUp = resolvePoolCanAllUp(pool);
        additions.push({
          matchId: fm.id,
          matchNumStr: fm.matchNumStr,
          home: fm.home,
          away: fm.away,
          poolCode: bp.poolCode,
          poolName: pool.name,
          singleAllowed: canSingle,
          canSingle,
          canAllUp,
          ...resolveOptionalGoalLine(bp.poolCode, pool),
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        });
      }
      if (
        Array.isArray(arb.executableSwapLines) &&
        arb.executableSwapLines.length > 0
      ) {
        const byId = new Map(cur.matches.map((m) => [m.id, m]));
        for (const ln of arb.executableSwapLines) {
          for (const lg of ln.legs ?? []) {
            const lm = byId.get(lg.matchId);
            const lp = lm?.pools?.[lg.poolCode];
            const lo = lp?.options?.find((o) => o.key === lg.optionKey);
            if (
              !lm ||
              !lp ||
              lp.selling === false ||
              !lo ||
              Math.abs(Number(lo.odds) - Number(lg.odds)) > 1e-6
            ) {
              return {
                ok: false,
                blockedReason: "替换报价所涉盘口赔率已更新，请重新核对最新提示",
                nextPicks: cur.picks,
                preservedOtherPicks,
                originalMultiple: cur.multiple,
                targetBudgetCost: prevTotalCost,
              };
            }
          }
        }
      }
      const nextPicks = [...cleaned, ...additions];
      const prevMatchSet = new Set(state.picks.map((p) => p.matchId));
      const nextMatchSet = new Set(nextPicks.map((p) => p.matchId));
      if (
        prevMatchSet.size === 1 &&
        nextMatchSet.size === 1 &&
        preservedOtherPicks.length === 0 &&
        arb.betterPicks.length === 1 &&
        arb.worsePicks.length >= 2 &&
        nextPicks.every(isAuthoritativePickSingle)
      ) {
        const scaledMult = state.multiple * arb.worsePicks.length;
        if (scaledMult > 999) {
          return {
            ok: false,
            blockedReason: "等本金替换后倍数超出单单 999 倍上限",
            nextPicks: state.picks,
            preservedOtherPicks,
            originalMultiple: state.multiple,
            targetBudgetCost: prevTotalCost,
          };
        }
        const sameWorsePool =
          new Set(arb.worsePicks.map((wp) => wp.poolCode)).size === 1;
        if (sameWorsePool) {
          const worseMatched = matchPicks.filter((p) =>
            arb.worsePicks.some(
              (wp) => wp.poolCode === p.poolCode && wp.optionKey === p.optionKey
            )
          );
          const maxWorseOdds = worseMatched.reduce(
            (mx, p) => Math.max(mx, p.odds),
            0
          );
          const targetOptOdds = nextPicks[0]?.odds ?? 0;
          if (targetOptOdds * arb.worsePicks.length + 1e-6 < maxWorseOdds) {
            return {
              ok: false,
              blockedReason:
                "等本金替换后返奖低于原选项峰值返奖，已拦截非逐态占优替换",
              nextPicks: state.picks,
              preservedOtherPicks,
              originalMultiple: state.multiple,
              targetBudgetCost: prevTotalCost,
            };
          }
        }
      }
      const isBoundWholeSlipArb =
        (Array.isArray(arb.executableSwapLines) &&
          arb.executableSwapLines.length > 0) ||
        arb.sourcePicksSig !== undefined;
      const resolvedLiveSwap = resolveLiveWholeSlipSwap(cur, arb);
      const liveExecLines = resolvedLiveSwap?.executableSwapLines;
      const isPureSingleSlipAfter =
        Array.isArray(liveExecLines) && liveExecLines.length > 0
          ? liveExecLines.every((ln) => (ln.legs?.length ?? 0) === 1)
          : cur.mode === "single" ||
            (cur.passSpec.mode === "free" &&
              Array.isArray(cur.passSpec.passSizes) &&
              cur.passSpec.passSizes.length > 0 &&
              cur.passSpec.passSizes.every((s) => s === 1));
      const sameMatchPoolsAfter = new Set(
        nextPicks.filter((p) => p.matchId === fm.id).map((p) => p.poolCode)
      );
      if (sameMatchPoolsAfter.size > 1) {
        if (!isPureSingleSlipAfter && nextMatchSet.size >= 2) {
          return {
            ok: false,
            blockedReason:
              "保留本场其余已选项将形成同场跨玩法串关冲突，系统拒绝静默删改您的其余方向",
            nextPicks: state.picks,
            preservedOtherPicks,
            originalMultiple: state.multiple,
            targetBudgetCost: prevTotalCost,
          };
        }
        if (nextPicks.some((p) => !isAuthoritativePickSingle(p))) {
          return {
            ok: false,
            blockedReason:
              "同场混合多玩法要求涉及奖池均支持单关，当前无法在不删改其余选项下置换",
            nextPicks: state.picks,
            preservedOtherPicks,
            originalMultiple: state.multiple,
            targetBudgetCost: prevTotalCost,
          };
        }
      }
      if (
        prevMatchSet.size === 1 &&
        nextMatchSet.size === 1 &&
        state.picks.length > 0 &&
        state.picks.every(isAuthoritativePickSingle) &&
        nextPicks.some((p) => !isAuthoritativePickSingle(p))
      ) {
        return {
          ok: false,
          blockedReason: "纯单关选单不可降级置换为未开单关玩法",
          nextPicks: state.picks,
          preservedOtherPicks,
          originalMultiple: state.multiple,
          targetBudgetCost: prevTotalCost,
        };
      }
      const isSingleMatchWithNonSinglePick =
        prevMatchSet.size === 1 &&
        nextMatchSet.size === 1 &&
        nextPicks.some((p) => !isAuthoritativePickSingle(p));
      if (isBoundWholeSlipArb && !resolvedLiveSwap) {
        return {
          ok: false,
          blockedReason:
            "原同义替换建议对应的选单、串关或盘口已变更，请按最新选单重新核对",
          nextPicks: state.picks,
          preservedOtherPicks,
          originalMultiple: state.multiple,
          targetBudgetCost: prevTotalCost,
        };
      }
      const hasActivePlayableOrLockedTicket =
        baseRep.canCheckout ||
        baseRep.totalCost > 0 ||
        cur.planSpec !== null ||
        cur.singleAuthGrant !== null;
      const canEditUnplayableSingleDraft =
        !hasActivePlayableOrLockedTicket && isSingleMatchWithNonSinglePick;
      if (!resolvedLiveSwap && !canEditUnplayableSingleDraft) {
        return {
          ok: false,
          blockedReason:
            "当前在审实票下该跨盘替换无等本金逐态不降可执行票行（仅作单场参考）",
          nextPicks: state.picks,
          preservedOtherPicks,
          originalMultiple: state.multiple,
          targetBudgetCost: prevTotalCost,
        };
      }
      const effectiveCost =
        resolvedLiveSwap?.equalStakeCostYuan ?? prevTotalCost;
      return {
        ok: true,
        nextPicks,
        preservedOtherPicks,
        originalMultiple: state.multiple,
        targetBudgetCost: effectiveCost,
      };
    },

    applyEquivalentSwap(arb: EquivalentArbItem): boolean {
      const preview = this.previewEquivalentSwap(arb);
      if (!preview.ok) return false;
      const cur = reconcileState();
      const resolvedSwap = resolveLiveWholeSlipSwap(cur, arb);
      const nextPicks = preview.nextPicks;
      const nextMatchSet = new Set(nextPicks.map((p) => p.matchId));
      const isSingleMatchWithNonSinglePick =
        nextMatchSet.size === 1 &&
        nextPicks.some((p) => !isAuthoritativePickSingle(p));
      const sameMatchPoolsOnTarget = new Set(
        nextPicks
          .filter((p) => p.matchId === arb.matchId)
          .map((p) => p.poolCode)
      );
      const execLines = resolvedSwap?.executableSwapLines;
      const hasExecLines = Array.isArray(execLines) && execLines.length > 0;
      const execIsPureSingle =
        hasExecLines && execLines!.every((ln) => (ln.legs?.length ?? 0) === 1);
      const nextPassSpec: PassSelectionSpec =
        sameMatchPoolsOnTarget.size > 1 &&
        !isSingleMatchWithNonSinglePick &&
        (execIsPureSingle ||
          (nextMatchSet.size === 1 &&
            isFollowMaxParlayMode(state.passSpec.mode)))
          ? { mode: "free", passSizes: [1] }
          : state.passSpec;
      let nextMultiple = state.multiple;
      let nextPlanSpec: AppliedPlanSpec = null;
      let swapUndo: PoolSwitchUndoSnapshot | null = null;

      const execMatchSet = new Set(
        hasExecLines
          ? execLines!.flatMap((ln) => (ln.legs ?? []).map((lg) => lg.matchId))
          : []
      );
      const execMatchesExactNextMatchSet =
        hasExecLines &&
        execMatchSet.size === nextMatchSet.size &&
        Array.from(execMatchSet).every((id) => nextMatchSet.has(id));
      const execHasNonSingleSingleLeg =
        hasExecLines &&
        execLines!.some((ln) => {
          if ((ln.legs?.length ?? 0) !== 1) return false;
          const lg = ln.legs[0];
          const lm = state.matches.find((m) => m.id === lg.matchId);
          return !resolvePoolCanSingle(lm?.pools?.[lg.poolCode]);
        });

      if (
        hasExecLines &&
        execMatchesExactNextMatchSet &&
        !execHasNonSingleSingleLeg
      ) {
        const rawExecCost = execLines!.reduce(
          (sum, ln) => sum + (ln.cost || (ln.multiple || 1) * 2),
          0
        );
        if (!(
          rawExecCost > 0 &&
          preview.targetBudgetCost >= rawExecCost &&
          preview.targetBudgetCost % rawExecCost === 0
        )) {
          return false;
        }
        const scaleFactor = Math.round(preview.targetBudgetCost / rawExecCost);
        if (
          !execLines!.every(
            (ln) => Math.round((ln.multiple || 1) * scaleFactor) <= 999
          )
        ) {
          return false;
        }
        const scaledLines: PlanTicketLine[] = execLines!.map((ln) => {
          const m = Math.max(1, Math.round((ln.multiple || 1) * scaleFactor));
          const baseM = Math.max(1, Math.round(ln.multiple || 1));
          const unitPay =
            typeof ln.unitPayout === "number" && ln.unitPayout > 0
              ? ln.unitPayout
              : typeof ln.returnPayout === "number" && ln.returnPayout > 0
                ? ln.returnPayout / baseM
                : 0;
          const retPay = Number((unitPay * m).toFixed(2));
          return {
            ...ln,
            multiple: m,
            cost: m * 2,
            returnPayout: retPay,
            netProfit: Number((retPay - m * 2).toFixed(2)),
          };
        });
        if (
          scaledLines.length === 1 &&
          nextMatchSet.size === 1 &&
          nextPicks.length === 1 &&
          !isSingleMatchWithNonSinglePick
        ) {
          nextMultiple = Math.max(1, Math.min(999, scaledLines[0].multiple));
          nextPlanSpec = null;
          const fm = state.matches.find((m) => m.id === arb.matchId);
          if (fm && nextMultiple !== state.multiple) {
            swapUndo = {
              picks: [...state.picks],
              passSpec: state.passSpec,
              planSpec: state.planSpec,
              ...(state.planSpec
                ? { planBoard: state.matches, planHoldRev: localHoldRev }
                : {}),
              multiple: state.multiple,
              matchId: fm.id,
              matchNumStr: fm.matchNumStr,
              home: fm.home,
              away: fm.away,
              replacedPoolName: arb.worseChoice,
              replacedCount: arb.worsePicks.length,
              nextPoolName: nextPicks[0].poolName,
              nextOptionLabel: nextPicks[0].optionLabel,
            };
          }
        } else {
          nextPlanSpec = {
            kind: "bonus",
            optMode: "equal",
            baseLines: scaledLines,
            preserveExactBaseMultiples: true,
            baseSourceKind: "manual",
            targetBudgetCost: preview.targetBudgetCost,
            scaleMultiple: 1,
            consolidateTickets: true,
          };
        }
      } else if (isSingleMatchWithNonSinglePick) {
        nextPlanSpec = null;
      } else {
        return false;
      }

      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        multiple: nextMultiple,
        passSpec: nextPassSpec,
        planSpec: nextPlanSpec,
        appliedTicketSnapshot: null,
        singleAuthGrant: null,
        syntheticSingleMode:
          nextPicks.length === 0 ||
          state.syntheticSingleMode === "partial-cover" ||
          state.syntheticSingleMode === "trim-2way"
            ? "full-3way"
            : state.syntheticSingleMode,
        lastPoolSwitchUndo: swapUndo,
        picks: nextPicks,
        ...syncAutoRadarFields(nextPicks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    previewToggleBankerMatch(matchId: string): ToggleBankerPreview {
      const manualRep =
        state.workspace.baselineManualReport ?? state.workspace.manualReport;
      const mult = Math.max(1, Math.round(state.multiple) || 1);
      const fail = (reason: string): ToggleBankerPreview => ({
        ok: false,
        canToggle: false,
        isBanker: false,
        passOrderChanged: false,
        requiresConfirm: false,
        beforeLabel: manualRep.modeLabel,
        afterLabel: manualRep.modeLabel,
        beforeBetCount: manualRep.betCount,
        afterBetCount: manualRep.betCount,
        beforeCost: manualRep.totalCost,
        afterCost: manualRep.totalCost,
        targetPassSpec: state.passSpec,
        promptText: reason,
        reason,
      });

      if (state.planSpec) {
        return fail(
          "已套用智能配单方案中不支持直接改胆，请先回到手选或排除场次重配"
        );
      }
      const distinctIds: string[] = [];
      const countsByMatch = new Map<string, number>();
      for (const p of state.picks) {
        if (!countsByMatch.has(p.matchId)) distinctIds.push(p.matchId);
        countsByMatch.set(p.matchId, (countsByMatch.get(p.matchId) ?? 0) + 1);
      }
      if (!distinctIds.includes(matchId)) {
        return fail("该场次不在当前选单中");
      }
      if (distinctIds.length < 3) {
        return fail("至少选择 3 场比赛才可设胆");
      }
      if (manualRep.hasSameMatchCrossPoolConflict || distinctIds.length > 8) {
        return fail("纯单关模式不支持设胆");
      }
      const curBankers = (
        state.passSpec.bankerMatchIds ??
        manualRep.bankerMatchIds ??
        []
      ).filter((id) => distinctIds.includes(id));
      const countArr = distinctIds.map((id) => countsByMatch.get(id) ?? 1);
      const curActiveSizes =
        manualRep.activePassSizes.length > 0
          ? manualRep.activePassSizes
          : [Math.min(8, distinctIds.length)];
      const beforeBetCount = Math.max(
        1,
        manualRep.betCount ||
          computeElementaryBetCount(
            countArr,
            curActiveSizes,
            curBankers
              .map((id) => distinctIds.indexOf(id))
              .filter((i) => i >= 0)
          )
      );
      const beforeCost =
        manualRep.totalCost > 0
          ? manualRep.totalCost
          : beforeBetCount * mult * 2;
      const beforeLabel = manualRep.modeLabel;

      if (curBankers.includes(matchId)) {
        const nextBankers = curBankers.filter((id) => id !== matchId);
        const curFreeSizes =
          state.passSpec.mode === "free" &&
          Array.isArray(state.passSpec.passSizes)
            ? state.passSpec.passSizes.filter((s) => s >= 2)
            : curActiveSizes.filter((s) => s >= 2);
        const targetPassSpec: PassSelectionSpec =
          curFreeSizes.length > 0
            ? {
                mode: "free",
                passSizes: curFreeSizes,
                ...(nextBankers.length > 0
                  ? { bankerMatchIds: nextBankers }
                  : {}),
              }
            : { mode: "follow-max-parlay" };
        const nextSizes =
          curFreeSizes.length > 0
            ? curFreeSizes
            : [Math.min(8, distinctIds.length)];
        const afterBetCount = Math.max(
          1,
          computeElementaryBetCount(
            countArr,
            nextSizes,
            nextBankers
              .map((id) => distinctIds.indexOf(id))
              .filter((i) => i >= 0)
          )
        );
        const afterCost = afterBetCount * mult * 2;
        const afterBaseLbl = nextSizes.map((s) => `${s}串1`).join("+");
        const afterLabel =
          nextBankers.length > 0
            ? `${afterBaseLbl}(${nextBankers.length}胆)`
            : afterBaseLbl;
        const passOrderChanged =
          nextSizes.join(",") !== curActiveSizes.join(",");
        return {
          ok: true,
          canToggle: true,
          isBanker: false,
          passOrderChanged,
          requiresConfirm: false,
          beforeLabel,
          afterLabel,
          beforeBetCount,
          afterBetCount,
          beforeCost,
          afterCost,
          targetPassSpec,
          promptText: `取消胆码后过关为【${afterLabel} · ¥${afterCost}】`,
        };
      }

      const bankerWindow = resolveBankerPassWindow(distinctIds);
      if (!bankerWindow || bankerWindow.maxBankers <= 0) {
        return fail("当前最小过关数不支持设胆（2串1最多设1胆，3串1最多设2胆）");
      }
      if (curBankers.length >= bankerWindow.maxBankers) {
        return fail(
          `当前最低 ${bankerWindow.minPass}串1 最多可设 ${bankerWindow.maxBankers} 场胆码`
        );
      }

      const nextBankers = [...curBankers, matchId];
      const nextSizes = bankerWindow.nextPassSizes;
      const targetPassSpec: PassSelectionSpec = {
        mode: "free",
        passSizes: nextSizes,
        bankerMatchIds: nextBankers,
      };
      const afterBetCount = Math.max(
        1,
        computeElementaryBetCount(
          countArr,
          nextSizes,
          nextBankers.map((id) => distinctIds.indexOf(id)).filter((i) => i >= 0)
        )
      );
      const afterCost = afterBetCount * mult * 2;
      const afterBaseLbl = nextSizes.map((s) => `${s}串1`).join("+");
      const afterLabel = `${afterBaseLbl}(${nextBankers.length}胆)`;
      const passOrderChanged =
        Boolean(manualRep.activeComboCode) ||
        isFollowMaxParlayMode(state.passSpec.mode) ||
        nextSizes.join(",") !== curActiveSizes.join(",");
      const requiresConfirm = passOrderChanged || afterCost > beforeCost;
      return {
        ok: true,
        canToggle: true,
        isBanker: true,
        passOrderChanged,
        requiresConfirm,
        beforeLabel,
        afterLabel,
        beforeBetCount,
        afterBetCount,
        beforeCost,
        afterCost,
        targetPassSpec,
        promptText: `设胆需将过关从【${beforeLabel} · ¥${beforeCost}】改为【${afterLabel} · ¥${afterCost}】，是否确认切换？`,
      };
    },

    toggleBankerMatch(
      matchId: string,
      opts?: { confirmed?: boolean; requireConfirmOnPassChange?: boolean }
    ): {
      ok: boolean;
      isBanker?: boolean;
      requiresConfirm?: boolean;
      preview?: ToggleBankerPreview;
      reason?: string;
    } {
      const preview = this.previewToggleBankerMatch(matchId);
      if (!preview.ok) {
        return { ok: false, reason: preview.reason };
      }
      if (
        opts?.requireConfirmOnPassChange &&
        preview.requiresConfirm &&
        !opts?.confirmed
      ) {
        return {
          ok: false,
          requiresConfirm: true,
          preview,
          reason: preview.promptText,
        };
      }
      clearRevokedPlanHoldOnUserAction();
      state = {
        ...state,
        planSpec: null,
        passSpec: preview.targetPassSpec,
      };
      emit();
      void scheduleRefresh();
      return { ok: true, isBanker: preview.isBanker };
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
        ...resolveOptionalGoalLine(cand.poolCode, pool),
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
      const nextMode: MatchMode = state.mode === "single" ? "mix" : state.mode;
      const nextPass: PassSelectionSpec =
        state.passSpec.mode === "free" &&
        state.passSpec.passSizes?.length === 1 &&
        state.passSpec.passSizes[0] === 1
          ? { mode: "follow-max-parlay" }
          : state.passSpec;
      state = {
        ...state,
        mode: nextMode,
        passSpec: nextPass,
        singleAuthGrant: null,
        syntheticSingleMode: "full-3way",
      };
      return this.togglePick(m, cand.poolCode, cand.optionKey);
    },

    previewConvertAppliedPlanToManual(): ConvertPlanToManualPreview {
      const cur = reconcileState();
      const audited = cur.activeAuditedSlip;
      const currentAppliedCost = (
        cur.workspace.baselineReport ?? cur.workspace.effectiveReport
      ).totalCost;
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
      clearRevokedPlanHoldOnUserAction();
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
            : { mode: "follow-max-parlay" };
      state = {
        ...state,
        mode: "mix",
        planSpec: null,
        appliedTicketSnapshot: null,
        singleAuthGrant: null,
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
      const cur = reconcileState();
      const curSlip = cur.activeAuditedSlip;
      const effRep =
        cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
      const manualRep =
        cur.workspace.baselineManualReport ?? cur.workspace.manualReport;
      const breakevenCost =
        cur.workspace.appliedPlan?.breakevenUpgradeCost ??
        effRep.breakevenUpgradeCost ??
        manualRep.breakevenUpgradeCost;
      if (
        (!manualRep.canCheckout && !effRep.canCheckout) ||
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
      const keepBaseLines =
        curSlip.sourceKind === "archetype" ||
        curSlip.sourceKind === "auto-synthetic"
          ? curSlip.lines
          : state.planSpec?.kind === "bonus"
            ? state.planSpec.baseLines
            : undefined;
      state = {
        ...state,
        planSpec: {
          kind: "bonus",
          optMode,
          ...(keepBaseLines?.length
            ? {
                baseLines: keepBaseLines,
                baseSourceKind:
                  state.planSpec?.kind === "bonus"
                    ? state.planSpec.baseSourceKind
                    : curSlip.sourceKind !== "empty"
                      ? curSlip.sourceKind
                      : undefined,
              }
            : {}),
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
      const nextDraft = {
        ...state,
        targetIds: syncedIds,
        anchorToRadarPicks: true,
        manualPoolOverride: false,
        syncedRadarSig: buildRadarSignature(state.picks),
      };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
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
      const nextDraft = {
        ...state,
        anchorToRadarPicks: false,
        manualPoolOverride: true,
        targetIds: nextTargets,
      };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    selectTargetSlice(count: number) {
      const nextDraft = {
        ...state,
        anchorToRadarPicks: false,
        manualPoolOverride: true,
        targetIds: state.matches
          .slice(0, Math.max(1, Math.min(8, count)))
          .map((x) => x.id),
      };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
    },

    setAnchorToRadarPicks(val: boolean) {
      const pickedIds = Array.from(
        new Set(state.picks.map((p) => p.matchId))
      ).slice(0, 8);
      const nextDraft = {
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
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
    },

    setBudget(nextBudget: number): number {
      const normalized = normalizeBudgetYuan(nextBudget);
      pendingPreviewKnobPersist = "budget";
      const nextDraft = { ...state, budget: normalized };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
      return normalized;
    },

    setStance(nextStance: UserStance) {
      pendingPreviewKnobPersist = "stance";
      const nextDraft = { ...state, stance: nextStance };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
    },

    setUnlockFullAgg(val: boolean) {
      const nextDraft = { ...state, unlockFullAgg: val };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
    },

    setAllowSaveCash(val: boolean) {
      const next = Boolean(val);
      if (state.allowSaveCash === next) return;
      pendingPreviewKnobPersist = "allowSaveCash";
      const nextDraft = { ...state, allowSaveCash: next };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
    },

    previewSwitchMainPool(): SwitchMainPoolPreview {
      const matchMap = new Map(state.matches.map((m) => [m.id, m]));
      const orderedMatchIds: string[] = [];
      for (const p of state.picks) {
        if (!orderedMatchIds.includes(p.matchId)) {
          orderedMatchIds.push(p.matchId);
        }
      }
      const items: SwitchMainPoolDiffItem[] = [];
      const nextPicks: SelectedPick[] = [];
      let changedMatchCount = 0;
      let hasDirectionlessFallback = false;

      for (const mid of orderedMatchIds) {
        const matchPicks = state.picks.filter((p) => p.matchId === mid);
        const existingMain = matchPicks.filter(
          (p) => p.poolCode === "HAD" || p.poolCode === "HHAD"
        );
        const fm = matchMap.get(mid);
        if (existingMain.length > 0 || !fm) {
          nextPicks.push(...existingMain);
          if (fm && existingMain.length > 0) {
            items.push({
              matchId: fm.id,
              matchNumStr: fm.matchNumStr,
              home: fm.home,
              away: fm.away,
              fromPicks: matchPicks,
              toPicks: existingMain,
              changed: false,
              isDirectionlessFallback: false,
              usedHandicapMapping: false,
              note: "已为主玩法，保持原选不变",
            });
          }
          continue;
        }

        const hadOpen =
          fm.pools.HAD?.selling !== false &&
          (fm.pools.HAD?.options?.length ?? 0) > 0;
        const hhadOpen =
          fm.pools.HHAD?.selling !== false &&
          (fm.pools.HHAD?.options?.length ?? 0) > 0;
        const targetPoolCode: PoolCode | null = hadOpen
          ? "HAD"
          : hhadOpen
            ? "HHAD"
            : null;
        if (!targetPoolCode) continue;
        const pool = fm.pools[targetPoolCode];
        const gLine = Number(fm.pools.HHAD?.goalLine) || -1;

        const targetKeys = new Set<string>();
        let hasDirectionalSource = false;
        let usedHandicapMapping = targetPoolCode === "HHAD";

        for (const pk of matchPicks) {
          if (pk.poolCode === "CRS") {
            hasDirectionalSource = true;
            if (pk.optionKey === "wins_other") {
              targetKeys.add(targetPoolCode === "HAD" ? "h" : "hh");
            } else if (pk.optionKey === "draws_other") {
              targetKeys.add(
                targetPoolCode === "HAD" ? "d" : gLine > 0 ? "hh" : "ha"
              );
            } else if (pk.optionKey === "losses_other") {
              targetKeys.add(targetPoolCode === "HAD" ? "a" : "ha");
            } else {
              const parts = pk.optionKey.split(":");
              if (parts.length === 2) {
                const hG = Number(parts[0]);
                const aG = Number(parts[1]);
                if (Number.isFinite(hG) && Number.isFinite(aG)) {
                  const diff = hG - aG;
                  if (targetPoolCode === "HAD") {
                    targetKeys.add(diff > 0 ? "h" : diff === 0 ? "d" : "a");
                  } else {
                    const hDiff = diff + gLine;
                    targetKeys.add(
                      hDiff > 0 ? "hh" : hDiff === 0 ? "hd" : "ha"
                    );
                  }
                }
              }
            }
          } else if (pk.poolCode === "HAFU") {
            hasDirectionalSource = true;
            const ft = pk.optionKey.slice(-1);
            if (ft === "h") {
              targetKeys.add(targetPoolCode === "HAD" ? "h" : "hh");
            } else if (ft === "d") {
              targetKeys.add(
                targetPoolCode === "HAD" ? "d" : gLine > 0 ? "hh" : "ha"
              );
            } else if (ft === "a") {
              targetKeys.add(targetPoolCode === "HAD" ? "a" : "ha");
            }
          }
        }

        let isDirectionless = false;
        const resolvedOpts: typeof pool.options = [];
        if (hasDirectionalSource && targetKeys.size > 0) {
          for (const o of pool.options) {
            if (targetKeys.has(o.key)) resolvedOpts.push(o);
          }
        }
        if (resolvedOpts.length === 0) {
          isDirectionless = true;
          hasDirectionlessFallback = true;
          usedHandicapMapping = false;
          const topOpt = [...pool.options].sort(
            (a, b) => b.fairProb - a.fairProb || a.odds - b.odds
          )[0];
          if (topOpt) resolvedOpts.push(topOpt);
        }

        const mappedPicks: SelectedPick[] = resolvedOpts.map((opt) => ({
          matchId: fm.id,
          matchNumStr: fm.matchNumStr,
          home: fm.home,
          away: fm.away,
          poolCode: targetPoolCode,
          poolName: pool.name,
          singleAllowed: resolvePoolCanSingle(pool),
          canSingle: resolvePoolCanSingle(pool),
          canAllUp: resolvePoolCanAllUp(pool),
          ...resolveOptionalGoalLine(targetPoolCode, pool),
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        }));
        if (mappedPicks.length > 0) {
          changedMatchCount += 1;
          nextPicks.push(...mappedPicks);
          items.push({
            matchId: fm.id,
            matchNumStr: fm.matchNumStr,
            home: fm.home,
            away: fm.away,
            fromPicks: matchPicks,
            toPicks: mappedPicks,
            changed: true,
            isDirectionlessFallback: isDirectionless,
            usedHandicapMapping,
            note: isDirectionless
              ? "总进球无主客胜负方向，暂按主玩法最高真率项预填（请确认）"
              : usedHandicapMapping
                ? `按让球[${fm.pools.HHAD?.goalLine || "-1"}]同向映射`
                : "严格保留原胜平负方向",
          });
        }
      }

      const manRep =
        state.workspace.baselineManualReport ?? state.workspace.manualReport;
      const mult = Math.max(1, Math.round(state.multiple) || 1);
      const beforePassLabel = manRep.modeLabel;
      const beforeBetCount = manRep.betCount;
      const beforeTotalCost = manRep.totalCost;

      const preservedPass = sanitizePassSpecForPicks(state.passSpec, nextPicks);
      const afterOrder: string[] = [];
      const afterCounts = new Map<string, number>();
      let afterMinPoolCap = 8;
      for (const pk of nextPicks) {
        if (!afterCounts.has(pk.matchId)) afterOrder.push(pk.matchId);
        afterCounts.set(pk.matchId, (afterCounts.get(pk.matchId) ?? 0) + 1);
        afterMinPoolCap = Math.min(
          afterMinPoolCap,
          CLIENT_STATUTORY_POOL_MAX_PASS[pk.poolCode] ?? 8
        );
      }
      const afterMaxCap = Math.max(
        1,
        Math.min(8, afterMinPoolCap, afterOrder.length || 1)
      );
      const comboReqM =
        preservedPass.mode === "combo" && preservedPass.comboCode
          ? resolveComboRequiredMatchCount(preservedPass.comboCode)
          : null;
      const comboSubSizes =
        preservedPass.mode === "combo" && preservedPass.comboCode
          ? CLIENT_STATUTORY_COMBO_PASS_SIZES[preservedPass.comboCode]
          : undefined;
      const isValidFixedComboAfter = Boolean(
        comboReqM !== null &&
        comboSubSizes &&
        afterOrder.length === comboReqM &&
        comboSubSizes.every((k) => k <= afterMaxCap)
      );
      const afterSizes =
        preservedPass.mode === "free" &&
        Array.isArray(preservedPass.passSizes) &&
        preservedPass.passSizes.length > 0
          ? preservedPass.passSizes.filter((s) => s >= 1 && s <= afterMaxCap)
          : [afterMaxCap];
      const effAfterSizes = afterSizes.length > 0 ? afterSizes : [afterMaxCap];
      const afterBankerIdx =
        !isValidFixedComboAfter && afterOrder.length >= 3
          ? (preservedPass.bankerMatchIds ?? [])
              .map((id) => afterOrder.indexOf(id))
              .filter((i) => i >= 0)
              .slice(
                0,
                Math.max(
                  0,
                  Math.min(
                    afterOrder.length - 1,
                    Math.min(...effAfterSizes) - 1
                  )
                )
              )
          : [];
      const exactMTupleCount = afterOrder.reduce(
        (prod, id) => prod * (afterCounts.get(id) ?? 1),
        1
      );
      const afterBetCount =
        nextPicks.length > 0
          ? isValidFixedComboAfter && comboReqM !== null && comboSubSizes
            ? Math.max(
                1,
                exactMTupleCount *
                  comboSubSizes.reduce((s, k) => s + binomInt(comboReqM, k), 0)
              )
            : Math.max(
                1,
                computeElementaryBetCount(
                  afterOrder.map((id) => afterCounts.get(id) ?? 1),
                  effAfterSizes,
                  afterBankerIdx
                )
              )
          : 0;
      const afterTotalCost = afterBetCount * mult * 2;
      const afterBaseLbl = effAfterSizes
        .map((s) => (s === 1 ? "单关" : `${s}串1`))
        .join("+");
      const afterPassLabel =
        isValidFixedComboAfter && preservedPass.comboCode
          ? preservedPass.comboCode.replace("x", "串")
          : afterBankerIdx.length > 0
            ? `${afterBaseLbl}(${afterBankerIdx.length}胆)`
            : afterBaseLbl;

      return {
        canSwitch: changedMatchCount > 0 && nextPicks.length > 0,
        changedMatchCount,
        hasDirectionlessFallback,
        items,
        nextPicks,
        beforePassLabel,
        afterPassLabel,
        beforeBetCount,
        afterBetCount,
        beforeTotalCost,
        afterTotalCost,
        summaryText:
          changedMatchCount > 0
            ? `共转换 ${changedMatchCount} 场高水子玩法至低抽水主盘 · 保持【${afterPassLabel} · ${mult}倍 · 应付 ¥${afterTotalCost}】${
                hasDirectionlessFallback
                  ? "（含无方向总进球兜底项，请核对）"
                  : "（100% 保留原胜负方向与过关）"
              }`
            : "当前选单均已为主玩法，无需切换",
      };
    },

    previewPortfolioRemediationAction(
      action: PortfolioRemediationAction
    ): PortfolioRemediationPreview {
      const cur = reconcileState();
      const baseRep =
        cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
      const manRep =
        cur.workspace.baselineManualReport ?? cur.workspace.manualReport;
      const distinctCount = new Set(cur.picks.map((p) => p.matchId)).size;
      let minPoolCap = 8;
      for (const p of cur.picks) {
        minPoolCap = Math.min(
          minPoolCap,
          CLIENT_STATUTORY_POOL_MAX_PASS[p.poolCode] ?? 8
        );
      }
      const maxCap = Math.max(1, Math.min(8, minPoolCap, distinctCount || 1));

      let resolvedTargetSizes: number[] = [];
      if (action.kind === "lower-pass-preview") {
        const fromAction = Array.isArray(action.targetPassSizes)
          ? action.targetPassSizes.filter((s) => s >= 1 && s <= maxCap)
          : [];
        const fromLines = Array.isArray(action.previewLines)
          ? Array.from(
              new Set(
                action.previewLines
                  .map((ln) => ln.legs?.length ?? 0)
                  .filter((s) => s >= 1 && s <= maxCap)
              )
            ).sort((a, b) => a - b)
          : [];
        if (fromAction.length > 0) {
          resolvedTargetSizes = fromAction;
        } else if (fromLines.length > 0) {
          resolvedTargetSizes = fromLines;
        } else {
          const curSizes =
            manRep.activePassSizes.length > 0
              ? manRep.activePassSizes
              : [maxCap];
          const minCur = Math.min(...curSizes);
          if (minCur > 2) {
            resolvedTargetSizes = [minCur - 1];
          } else if (minCur === 2 && manRep.canSingle) {
            resolvedTargetSizes = [1];
          } else {
            resolvedTargetSizes = [Math.min(2, maxCap)];
          }
        }
      }

      const curSizes =
        manRep.activePassSizes.length > 0 ? manRep.activePassSizes : [maxCap];
      const isStrictLower =
        action.isStrictAllLowerPass ??
        (resolvedTargetSizes.length > 0 &&
          Math.max(...resolvedTargetSizes) < Math.max(...curSizes));
      const targetPassLabel =
        resolvedTargetSizes.length > 0
          ? resolvedTargetSizes
              .map((s) => (s === 1 ? "单关" : `${s}串1`))
              .join("+")
          : manRep.modeLabel;
      const switchPreview =
        action.kind === "switch-main-pool"
          ? this.previewSwitchMainPool()
          : null;
      const currentSlipCost = baseRep.canCheckout ? baseRep.totalCost : 0;

      const summaryText =
        action.kind === "lower-pass-preview"
          ? `${isStrictLower ? "严格降阶" : "同向分块"}至【${targetPassLabel}】${
              typeof action.previewCost === "number"
                ? ` · 预览实投 ¥${action.previewCost}`
                : ""
            }`
          : action.kind === "min-feasible-budget"
            ? `将配单预算上调至下一可行门槛 ¥${action.minFeasibleBudgetYuan ?? cur.budget}`
            : action.kind === "save-cash-preview"
              ? action.detail ||
                `确认省钱留现：实投 ¥${action.previewCost ?? 0} · 留存 ¥${action.savedCash ?? 0}`
              : action.kind === "keep-cash"
                ? currentSlipCost > 0
                  ? `当前核对台仍有 ¥${currentSlipCost} 待出票方案，请选择「暂不套用推荐」或「清空核对单护本（¥0）」`
                  : "当前核对台为空（¥0），保持空仓观察"
                : action.kind === "switch-main-pool"
                  ? (switchPreview?.summaryText ?? action.detail)
                  : "解除智能配单锁定，切换至审单台手选微调";

      return {
        kind: action.kind,
        actionLabel: action.label,
        summaryText,
        isStrictAllLowerPass: Boolean(isStrictLower),
        currentPassLabel: manRep.modeLabel,
        targetPassSizes: resolvedTargetSizes,
        targetPassLabel,
        currentSlipCost,
        previewCost:
          typeof action.previewCost === "number" ? action.previewCost : null,
        canApplyPreviewPlanAtomically: Boolean(
          action.previewLines && action.previewLines.length > 0
        ),
        switchMainPoolPreview: switchPreview,
        keepCashHasActiveSlip:
          Boolean(cur.planSpec) || cur.picks.length > 0 || currentSlipCost > 0,
      };
    },

    applyPortfolioRemediationAction(
      action: PortfolioRemediationAction,
      opts?: {
        applyPreviewPlan?: boolean;
        clearManualPicks?: boolean;
        onNavigateToAudit?: () => void;
      }
    ): {
      ok: boolean;
      kind?: PortfolioRemediationAction["kind"];
      nextBudget?: number;
      clearedToZero?: boolean;
      remainingSlipCost?: number;
      targetPassLabel?: string;
    } {
      if (!action || !action.kind) return { ok: false };
      if (action.kind === "lower-pass-preview") {
        const cur = reconcileState();
        if (
          cur.livePortfolioQuote.isStale ||
          !cur.livePortfolioQuote.canApplyLiveQuote
        ) {
          return { ok: false };
        }
        const cleanBudget = normalizeBudgetYuan(cur.budget);
        const activeQuoteSig = cur.livePortfolioQuote.inputSig;
        const curExecSig = computeWorkspaceExecutionSig(cur, activeQuoteSig);
        if (
          action.sourceQuoteInputSig &&
          action.sourceQuoteInputSig !== activeQuoteSig
        ) {
          return { ok: false };
        }
        if (
          action.sourceWorkspaceSig &&
          action.sourceWorkspaceSig !== curExecSig
        ) {
          return { ok: false };
        }
        if (
          typeof action.sourceBudgetYuan === "number" &&
          action.sourceBudgetYuan > 0 &&
          normalizeBudgetYuan(action.sourceBudgetYuan) !== cleanBudget
        ) {
          return { ok: false };
        }
        if (
          Array.isArray(action.previewLines) &&
          action.previewLines.length > 0
        ) {
          const byId = new Map(cur.matches.map((m) => [m.id, m]));
          const pickedMatchSet = new Set(cur.picks.map((p) => p.matchId));
          for (const ln of action.previewLines) {
            for (const lg of ln.legs ?? []) {
              const fm = byId.get(lg.matchId);
              if (!isStrictSameMatchIdentity(fm, lg)) return { ok: false };
              const pool = fm.pools?.[lg.poolCode];
              if (!pool || pool.selling === false) return { ok: false };
              const opt = pool.options?.find((o) => o.key === lg.optionKey);
              if (!opt || Math.abs(Number(opt.odds) - Number(lg.odds)) > 1e-6) {
                return { ok: false };
              }
              const legGl = (lg as { goalLine?: string }).goalLine;
              if (
                lg.poolCode === "HHAD" &&
                legGl !== undefined &&
                String(pool.goalLine ?? "").trim() !== String(legGl).trim()
              ) {
                return { ok: false };
              }
              if (
                cur.anchorToRadarPicks &&
                cur.picks.length > 0 &&
                !action.isExpandedShieldPreview &&
                pickedMatchSet.has(lg.matchId) &&
                !cur.picks.some(
                  (p) =>
                    p.matchId === lg.matchId &&
                    p.poolCode === lg.poolCode &&
                    p.optionKey === lg.optionKey
                )
              ) {
                return { ok: false };
              }
            }
          }
        }
        const preview = this.previewPortfolioRemediationAction(action);
        if (opts?.applyPreviewPlan) {
          if (
            !Array.isArray(action.previewLines) ||
            action.previewLines.length === 0
          ) {
            return { ok: false };
          }
          const lineCostSum = action.previewLines.reduce(
            (sum, ln) => sum + (ln.cost || (ln.multiple || 1) * 2),
            0
          );
          const planTotalCost =
            typeof action.previewCost === "number" && action.previewCost > 0
              ? action.previewCost
              : lineCostSum;
          const previewPlan: ArchetypePlan = {
            key: "max-ev-utility",
            available: true,
            shortTab: preview.targetPassLabel || "低阶分块",
            badge: preview.targetPassLabel || "低阶分块",
            title:
              action.structureLabel || `${preview.targetPassLabel}低阶分块方案`,
            tagline: action.detail || preview.summaryText,
            totalCost: planTotalCost,
            savedCash:
              action.savedCash ?? Math.max(0, cleanBudget - planTotalCost),
            minReturn: 0,
            maxReturn: 0,
            winProb: action.strictNetGainProb ?? 0,
            profitProb: action.strictNetGainProb ?? 0,
            strictNetGainProb: action.strictNetGainProb ?? 0,
            expectedValueRate: action.previewEvRate ?? 0,
            underwaterCount: 0,
            zeroPayoutProb: action.zeroPayoutProb ?? null,
            missOneReturn: null,
            vigPct: action.vigPct ?? 0,
            reasons: action.detail ? [action.detail] : [],
            lines: action.previewLines,
            quoteInputSig: activeQuoteSig,
            quoteBudgetYuan: cleanBudget,
          };
          const { taggedPlan, snapshot } = buildAppliedTicketSnapshotForPlan(
            previewPlan,
            cur.picks,
            cur.matches,
            cleanBudget,
            activeQuoteSig
          );
          clearRevokedPlanHoldOnUserAction();
          state = {
            ...cur,
            planSpec: {
              kind: "archetype",
              key: "max-ev-utility",
              snapshotPlan: taggedPlan,
              appliedBudgetYuan: cleanBudget,
              planBudgetYuan: cleanBudget,
              quoteInputSig: activeQuoteSig,
              expectedQuoteInputSig: activeQuoteSig,
              appliedSubjectiveDeltaPct:
                cur.livePortfolioQuote.subjectiveDeltaPct,
              allowBudgetMismatchReadOnly: false,
              appliedTicketSnapshot: snapshot,
              scaleMultiple: 1,
              consolidateTickets: true,
            },
            appliedTicketSnapshot: snapshot,
            simVoidFirstMatch: false,
            voidMatchIds: [],
          };
          emit();
          void scheduleRefresh();
          return {
            ok: true,
            kind: action.kind,
            targetPassLabel: preview.targetPassLabel,
          };
        }
        const nextPassSpec = sanitizePassSpecForPicks(
          {
            mode: "free",
            passSizes: preview.targetPassSizes,
            bankerMatchIds: cur.passSpec.bankerMatchIds,
          },
          cur.picks
        );
        const preserved = preserveAppliedPlanAcrossDraftEdit(cur);
        clearRevokedPlanHoldOnUserAction();
        state = {
          ...cur,
          planSpec: preserved.planSpec,
          appliedTicketSnapshot: preserved.appliedTicketSnapshot,
          passSpec: nextPassSpec,
        };
        emit();
        void scheduleRefresh();
        return {
          ok: true,
          kind: action.kind,
          targetPassLabel: preview.targetPassLabel,
        };
      }
      if (
        action.kind === "min-feasible-budget" &&
        typeof action.minFeasibleBudgetYuan === "number" &&
        action.minFeasibleBudgetYuan > 0
      ) {
        const nextBudget = normalizeBudgetYuan(action.minFeasibleBudgetYuan);
        const nextDraft = { ...state, budget: nextBudget };
        state = {
          ...nextDraft,
          planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
        };
        emit();
        void scheduleRefresh();
        return { ok: true, kind: action.kind, nextBudget };
      }
      if (action.kind === "save-cash-preview") {
        const cur = reconcileState();
        if (
          cur.livePortfolioQuote.isStale ||
          !cur.livePortfolioQuote.canApplyLiveQuote
        ) {
          return { ok: false };
        }
        const cleanBudget = normalizeBudgetYuan(cur.budget);
        const activeQuoteSig = cur.livePortfolioQuote.inputSig;
        const curExecSig = computeWorkspaceExecutionSig(cur, activeQuoteSig);
        if (
          action.sourceQuoteInputSig &&
          action.sourceQuoteInputSig !== activeQuoteSig
        ) {
          return { ok: false };
        }
        if (
          action.sourceWorkspaceSig &&
          action.sourceWorkspaceSig !== curExecSig
        ) {
          return { ok: false };
        }
        if (
          typeof action.sourceBudgetYuan === "number" &&
          action.sourceBudgetYuan > 0 &&
          normalizeBudgetYuan(action.sourceBudgetYuan) !== cleanBudget
        ) {
          return { ok: false };
        }
        if (opts?.applyPreviewPlan) {
          if (
            !Array.isArray(action.previewLines) ||
            action.previewLines.length === 0
          ) {
            return { ok: false };
          }
          const byId = new Map(cur.matches.map((m) => [m.id, m]));
          const pickedMatchSet = new Set(cur.picks.map((p) => p.matchId));
          for (const ln of action.previewLines) {
            for (const lg of ln.legs ?? []) {
              const fm = byId.get(lg.matchId);
              if (!isStrictSameMatchIdentity(fm, lg)) return { ok: false };
              const pool = fm.pools?.[lg.poolCode];
              if (!pool || pool.selling === false) return { ok: false };
              const opt = pool.options?.find((o) => o.key === lg.optionKey);
              if (!opt || Math.abs(Number(opt.odds) - Number(lg.odds)) > 1e-6) {
                return { ok: false };
              }
              const legGl = (lg as { goalLine?: string }).goalLine;
              if (
                lg.poolCode === "HHAD" &&
                legGl !== undefined &&
                String(pool.goalLine ?? "").trim() !== String(legGl).trim()
              ) {
                return { ok: false };
              }
              if (
                cur.anchorToRadarPicks &&
                cur.picks.length > 0 &&
                !action.isExpandedShieldPreview &&
                pickedMatchSet.has(lg.matchId) &&
                !cur.picks.some(
                  (p) =>
                    p.matchId === lg.matchId &&
                    p.poolCode === lg.poolCode &&
                    p.optionKey === lg.optionKey
                )
              ) {
                return { ok: false };
              }
            }
          }
          const nextDraft = { ...cur, allowSaveCash: true };
          const nextActiveQuoteSig =
            computeClientPortfolioQuoteMeta(nextDraft).inputSig;
          const lineCostSum = action.previewLines.reduce(
            (sum, ln) => sum + (ln.cost || (ln.multiple || 1) * 2),
            0
          );
          const planTotalCost =
            typeof action.previewCost === "number" && action.previewCost > 0
              ? action.previewCost
              : lineCostSum;
          const targetSlotKey: ArchetypeKey =
            action.slotKey ?? "max-ev-utility";
          const previewPlan: ArchetypePlan = {
            key: targetSlotKey,
            available: true,
            shortTab: action.structureLabel || "省本方案",
            badge: action.structureLabel || "省本方案",
            title: action.structureLabel || `实投 ¥${planTotalCost} 省本方案`,
            tagline: action.detail || action.label,
            totalCost: planTotalCost,
            savedCash:
              action.savedCash ?? Math.max(0, cleanBudget - planTotalCost),
            minReturn: 0,
            maxReturn: 0,
            winProb: action.strictNetGainProb ?? 0,
            profitProb: action.strictNetGainProb ?? 0,
            strictNetGainProb: action.strictNetGainProb ?? 0,
            expectedValueRate: action.previewEvRate ?? 0,
            underwaterCount: 0,
            zeroPayoutProb: action.zeroPayoutProb ?? null,
            missOneReturn: null,
            vigPct: action.vigPct ?? 0,
            reasons: action.detail ? [action.detail] : [],
            lines: action.previewLines,
            quoteInputSig: nextActiveQuoteSig,
            quoteBudgetYuan: cleanBudget,
          };
          const { taggedPlan, snapshot } = buildAppliedTicketSnapshotForPlan(
            previewPlan,
            cur.picks,
            cur.matches,
            cleanBudget,
            nextActiveQuoteSig
          );
          clearRevokedPlanHoldOnUserAction();
          state = {
            ...nextDraft,
            planSpec: {
              kind: "archetype",
              key: targetSlotKey,
              snapshotPlan: taggedPlan,
              appliedBudgetYuan: cleanBudget,
              planBudgetYuan: cleanBudget,
              quoteInputSig: nextActiveQuoteSig,
              expectedQuoteInputSig: nextActiveQuoteSig,
              appliedSubjectiveDeltaPct:
                cur.livePortfolioQuote.subjectiveDeltaPct,
              allowBudgetMismatchReadOnly: false,
              appliedTicketSnapshot: snapshot,
              scaleMultiple: 1,
              consolidateTickets: true,
            },
            appliedTicketSnapshot: snapshot,
            simVoidFirstMatch: false,
            voidMatchIds: [],
          };
          emit();
          void scheduleRefresh();
          return { ok: true, kind: action.kind };
        }
        const nextDraft = { ...state, allowSaveCash: true };
        state = {
          ...nextDraft,
          planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
        };
        emit();
        void scheduleRefresh();
        return { ok: true, kind: action.kind };
      }
      if (action.kind === "keep-cash") {
        if (opts?.clearManualPicks) {
          this.clearPicks();
          return {
            ok: true,
            kind: action.kind,
            clearedToZero: true,
            remainingSlipCost: 0,
          };
        }
        const cur = reconcileState();
        const baseRep =
          cur.workspace.baselineReport ?? cur.workspace.effectiveReport;
        const remainingSlipCost = baseRep.canCheckout ? baseRep.totalCost : 0;
        return {
          ok: true,
          kind: action.kind,
          clearedToZero: remainingSlipCost === 0,
          remainingSlipCost,
        };
      }
      if (action.kind === "go-manual") {
        clearRevokedPlanHoldOnUserAction();
        state = {
          ...state,
          planSpec: null,
          appliedTicketSnapshot: null,
        };
        emit();
        void scheduleRefresh();
        opts?.onNavigateToAudit?.();
        return { ok: true, kind: action.kind };
      }
      if (action.kind === "switch-main-pool") {
        const swPreview = this.previewSwitchMainPool();
        if (!swPreview.canSwitch) {
          return { ok: false, kind: action.kind };
        }
        clearRevokedPlanHoldOnUserAction();
        state = {
          ...state,
          mode: "mix",
          planSpec: null,
          appliedTicketSnapshot: null,
          singleAuthGrant: null,
          syntheticSingleMode: "full-3way",
          passSpec: sanitizePassSpecForPicks(
            state.passSpec,
            swPreview.nextPicks
          ),
          picks: swPreview.nextPicks,
          ...syncAutoRadarFields(swPreview.nextPicks, state.matches, state),
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
      const nextDraft = { ...state, subjectiveDeltaPct: clamped };
      state = {
        ...nextDraft,
        planSpec: freezeArchetypeIfQuoteDrifted(state.planSpec, nextDraft),
      };
      emit();
      void scheduleRefresh();
    },

    setSimVoidFirstMatch(val: boolean) {
      const flag = Boolean(val);
      const curSlip = reconcileState().activeAuditedSlip;
      const firstMatchId = curSlip.matchIds[0] ?? state.picks[0]?.matchId ?? "";
      const nextVoidIds = flag && firstMatchId ? [firstMatchId] : [];
      state = {
        ...state,
        simVoidFirstMatch: flag,
        voidMatchIds: nextVoidIds,
      };
      emit();
      void scheduleRefresh();
    },

    toggleVoidMatchId(matchId: string) {
      const curSlip = reconcileState().activeAuditedSlip;
      if (!curSlip.matchIds.includes(matchId)) return;
      const curIds =
        state.voidMatchIds.length > 0
          ? state.voidMatchIds.filter((id) => curSlip.matchIds.includes(id))
          : state.simVoidFirstMatch && curSlip.matchIds[0]
            ? [curSlip.matchIds[0]]
            : [];
      const nextIds = curIds.includes(matchId)
        ? curIds.filter((id) => id !== matchId)
        : [...curIds, matchId];
      const firstId = curSlip.matchIds[0] ?? "";
      state = {
        ...state,
        voidMatchIds: nextIds,
        simVoidFirstMatch: nextIds.length > 0 && nextIds[0] === firstId,
      };
      emit();
      void scheduleRefresh();
    },

    setVoidMatchIds(ids: string[]) {
      const curSlip = reconcileState().activeAuditedSlip;
      const validSet = new Set(curSlip.matchIds);
      const nextIds = Array.from(new Set(ids)).filter((id) => validSet.has(id));
      const firstId = curSlip.matchIds[0] ?? "";
      state = {
        ...state,
        voidMatchIds: nextIds,
        simVoidFirstMatch: nextIds.length > 0 && nextIds[0] === firstId,
      };
      emit();
      void scheduleRefresh();
    },

    loadPresetScenario(kind: PresetScenarioKind) {
      clearRevokedPlanHoldOnUserAction();
      const built = buildPresetPicks(state.matches, kind);
      state = {
        ...state,
        planSpec: null,
        appliedTicketSnapshot: null,
        singleAuthGrant: null,
        syntheticSingleMode: "full-3way",
        lastPoolSwitchUndo: null,
        passSpec: { mode: "follow-max-parlay" },
        simVoidFirstMatch: false,
        voidMatchIds: [],
        subjectiveDeltaPct: 0,
        multiple: built.multiple,
        picks: built.picks,
        ...syncAutoRadarFields(built.picks, state.matches, state),
      };
      emit();
      void scheduleRefresh();
    },

    buildSealedLedgerDraft(): SealedLedgerDraft | null {
      const reconciled = reconcileState();
      if (reconciled.livePortfolioQuote.isStale) {
        return null;
      }
      const effectiveReport =
        reconciled.workspace.baselineReport ??
        reconciled.workspace.effectiveReport;
      const baseAppliedPlan =
        reconciled.workspace.baselineAppliedPlan !== undefined
          ? reconciled.workspace.baselineAppliedPlan
          : reconciled.workspace.appliedPlan;
      const appliedPlan =
        reconciled.planSpec || effectiveReport.syntheticAutoMounted
          ? baseAppliedPlan
          : null;
      const passRuleErr = !reconciled.planSpec
        ? reconciled.manualDraft.passRuleBlockReason
        : null;
      if (
        effectiveReport.matchCount === 0 ||
        !effectiveReport.canCheckout ||
        effectiveReport.totalCost <= 0 ||
        passRuleErr
      ) {
        return null;
      }

      const logicalLineCount = appliedPlan
        ? Math.max(1, appliedPlan.lines.length)
        : Math.max(
            1,
            effectiveReport.logicalLineCount ??
              Math.max(
                effectiveReport.tickets?.length ?? 0,
                effectiveReport.betCount
              )
          );
      const stakeUnitsCount = Math.max(
        1,
        effectiveReport.stakeUnitsCount ??
          Math.round(effectiveReport.totalCost / 2)
      );
      const audSlips = reconciled.activeAuditedSlip.physicalSlips;
      const physicalSlipCount =
        audSlips && audSlips.length > 0 ? audSlips.length : logicalLineCount;
      const manualMult = Math.max(1, Math.round(reconciled.multiple || 1));

      const rawTitle = appliedPlan
        ? `${effectiveReport.modeLabel} · ${appliedPlan.shortTab}(${logicalLineCount}种·共${stakeUnitsCount}注)`
        : manualMult > 1
          ? `${effectiveReport.modeLabel} · ${logicalLineCount}种×${manualMult}倍（共${stakeUnitsCount}注）`
          : `${effectiveReport.modeLabel} · ${stakeUnitsCount}注方案`;
      const title = dedupeRepeatedDotTokens(rawTitle);
      const baseWsParams = buildWorkspaceParams(state);
      const expectedSlipLineSig = reconciled.workspace.baselineSlipLineSig;
      if (!expectedSlipLineSig) return null;

      return {
        title,
        passLabel: effectiveReport.modeLabel,
        modeLabel: effectiveReport.modeLabel,
        betCount: Math.max(1, effectiveReport.betCount),
        betCountUnit: appliedPlan ? "stake-units" : "logical-lines",
        logicalLineCount,
        stakeUnitsCount,
        physicalSlipCount,
        cost: effectiveReport.totalCost,
        paperRefCost: effectiveReport.totalCost,
        minPayout: effectiveReport.minPayout,
        maxPayout: effectiveReport.maxPayout,
        workspaceParams: {
          ...baseWsParams,
          quoteInputSig: computedInputSig,
          expectedQuoteInputSig: computedInputSig,
          expectedTotalCost: effectiveReport.totalCost,
          expectedSlipLineSig,
          enforceFreshQuoteSignature: true,
        },
      };
    },

    async exportWechatText(opts?: {
      useConsolidated?: boolean;
    }): Promise<string> {
      await this.flush();
      return this.formatShopkeeperWeChatSlip(opts);
    },

    formatShopkeeperWeChatSlip(opts?: { useConsolidated?: boolean }): string {
      const reconciled = reconcileState();
      if (getShopkeeperBlockReason(reconciled)) return "";
      const effectiveReport =
        reconciled.workspace.baselineReport ??
        reconciled.workspace.effectiveReport;
      const manualReport =
        reconciled.workspace.baselineManualReport ??
        reconciled.workspace.manualReport;
      const basePlan =
        reconciled.workspace.baselineAppliedPlan !== undefined
          ? reconciled.workspace.baselineAppliedPlan
          : reconciled.workspace.appliedPlan;
      const appliedPlan =
        reconciled.planSpec || effectiveReport.syntheticAutoMounted
          ? basePlan
          : null;

      const bankerSet = new Set(
        effectiveReport.bankerMatchIds ??
          manualReport.bankerMatchIds ??
          state.passSpec.bankerMatchIds ??
          []
      );
      const preferConsolidated = state.planSpec
        ? state.planSpec.consolidateTickets !== false
        : true;
      const useConsolidated = opts?.useConsolidated ?? preferConsolidated;

      const auditedPhysicalSlips =
        reconciled.activeAuditedSlip.physicalSlips ?? [];
      const resolvedPhysicalSlips =
        opts?.useConsolidated === undefined ||
        opts.useConsolidated === preferConsolidated
          ? auditedPhysicalSlips
          : consolidateTerminalPhysicalSlips(
              effectiveReport,
              appliedPlan,
              reconciled.matches,
              reconciled.multiple,
              bankerSet,
              { consolidate: useConsolidated }
            );
      if (
        resolvedPhysicalSlips !== auditedPhysicalSlips &&
        getShopkeeperBlockReason(reconciled, resolvedPhysicalSlips)
      )
        return "";
      const slipRows = resolvedPhysicalSlips.map((ps, index) => {
        const legsDesc = ps.legsByMatch
          .map((g) => {
            const optsTxt = g.options.map((o) => o.optionLabel).join("/");
            return `${g.isBanker || bankerSet.has(g.matchId) ? "📌【胆】" : ""}${g.matchNumStr}${g.home}(${g.poolName}·${optsTxt})`;
          })
          .join(" + ");
        const unitsSuffix =
          ps.basicUnitsPerSlip > 1 ? `(${ps.basicUnitsPerSlip}注)` : "";
        return `票${index + 1}：${legsDesc} ｜ ${ps.modeLabel}${unitsSuffix} × ${ps.multiple}倍 = ¥${ps.costYuan}`;
      });
      const header = `【竞彩出票单 · 共${slipRows.length}张实票 · 合计 ¥${effectiveReport.totalCost}】`;
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
  betCountUnit?: "logical-lines" | "stake-units";
  logicalLineCount?: number;
  stakeUnitsCount?: number;
  physicalSlipCount?: number;
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

export function isMatchAnyPoolSingleEligible(m: MatchItem): boolean {
  if (!m?.pools) return false;
  const codes: PoolCode[] = ["HAD", "HHAD", "CRS", "TTG", "HAFU"];
  for (const code of codes) {
    const p = m.pools[code];
    if (
      p &&
      p.selling !== false &&
      Boolean(p.canSingle ?? p.single) &&
      Array.isArray(p.options) &&
      p.options.some(
        (o) => Number.isFinite(Number(o.odds)) && Number(o.odds) >= 1.01
      )
    ) {
      return true;
    }
  }
  return false;
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
    list = list.filter((m) => isMatchAnyPoolSingleEligible(m));
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

  const weekdayChars = "一二三四五六日";
  const groupMap = new Map<string, RadarMatchDayGroup>();
  for (const m of list) {
    const numStr = String(m.matchNumStr || "");
    const weekdayPrefix =
      numStr.length >= 2 &&
      numStr.startsWith("周") &&
      weekdayChars.includes(numStr[1])
        ? numStr.slice(0, 2)
        : "当期";
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
