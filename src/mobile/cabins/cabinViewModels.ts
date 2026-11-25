import { getPhysicalTicketBlockReason } from "../../workspace/ticketExport.ts";
import {
  SUBJECTIVE_DELTA_MAX,
  SUBJECTIVE_DELTA_MIN,
  type ActiveAuditedSlip,
  type ArchetypePlan,
  type BoardFreshnessMeta,
  type BridgeMatchCandidate,
  type BridgeMatchPreview,
  type ComboRow,
  type DistributionComputeStatus,
  type DualAxisOptionMovement,
  type LedgerSettlementDetail,
  type MatchItem,
  type MatchMicroQuant,
  type MatchPool,
  type OddsOption,
  type PartialCoveragePreview,
  type PlanTicketLine,
  type PoolCode,
  type PortfolioKey,
  type PortfolioRemediationAction,
  type ProOrderInsights,
  type SelectedPick,
  type SelectionLifecycleStatus,
  type StaggeredHedgePlan,
  type SyntheticSingleMode,
  type TruthReport,
} from "../../prototype/quantTypes.ts";
import type {
  LedgerEntry,
  UserLedgerSnapshot,
} from "../../security/secureClient.ts";
import {
  dedupeRepeatedDotTokens,
  resolveComboTicketBreakdown,
  type AttributedWinningTicket,
  type ComboSortMode,
  type ManualDraftState,
  type MatchMode,
} from "../../workspace/betSlipController.ts";

export type AppTab = "match" | "archetypes" | "audit" | "ledger";
export type QuickFilter = "all" | "single" | "low-vig" | "drop" | "arb";
export type BarPopoverKind = null | "pass" | "keypad" | "selected";
export type DesktopRightCabinTab = "audit" | "ledger" | "intel";
export type MobileTab4Cabin = "ledger" | "intel";

export type SheetState =
  | null
  | { type: "more"; matchId: string }
  | { type: "intel"; matchId: string }
  | { type: "poster" }
  | { type: "filter" }
  | { type: "tactile" };

export interface HandoffBannerState {
  title: string;
  cost: number;
  seq: number;
}

export function formatCandidateBudgetSwitchToast(
  action: Pick<PortfolioRemediationAction, "isExactMinimumBudget">,
  nextBudget: number
): string {
  return action.isExactMinimumBudget
    ? `已切换预览预算至最低可行门槛 ¥${nextBudget}`
    : `已切换至已验证的候选预算 ¥${nextBudget}`;
}

export interface SkinPresetDef {
  id: string;
  code: string;
  name: string;
  en: string;
  swatchBg: string;
  swatchDot: string;
}

export const STUDIO_SKIN_OPTIONS: SkinPresetDef[] = [
  {
    id: "air",
    code: "00",
    name: "素白",
    en: "Air",
    swatchBg: "#F2F4F7",
    swatchDot: "#0B0D12",
  },
  {
    id: "swiss",
    code: "05",
    name: "瑞士",
    en: "Swiss",
    swatchBg: "#FFFFFF",
    swatchDot: "#E30613",
  },
  {
    id: "studio",
    code: "06",
    name: "工坊",
    en: "Studio",
    swatchBg: "#E4E3DE",
    swatchDot: "#FF5A1F",
  },
  {
    id: "dot",
    code: "07",
    name: "点阵",
    en: "Dot",
    swatchBg: "#000000",
    swatchDot: "#FFFFFF",
  },
  {
    id: "sumi",
    code: "08",
    name: "水墨",
    en: "Sumi",
    swatchBg: "#F1ECE2",
    swatchDot: "#1A1A1A",
  },
  {
    id: "glass",
    code: "09",
    name: "琉璃",
    en: "Glass",
    swatchBg: "linear-gradient(135deg,#2B5D4F,#1B1F3B)",
    swatchDot: "rgba(255,255,255,.9)",
  },
  {
    id: "dial",
    code: "10",
    name: "表盘",
    en: "Dial",
    swatchBg: "#0E1729",
    swatchDot: "#CDB27A",
  },
  {
    id: "pitch",
    code: "11",
    name: "草坪",
    en: "Pitch",
    swatchBg: "#EAF0EA",
    swatchDot: "#0E5C3A",
  },
];

export const STUDIO_STAGE_ACTIONS: Array<{
  id: string;
  label: string;
  cmd: string;
  value: string | null;
}> = [
  { id: "match", label: "赛事", cmd: "setTab", value: "match" },
  { id: "more", label: "全玩法", cmd: "openMore", value: null },
  { id: "intel", label: "卡盘底牌", cmd: "openIntel", value: null },
  { id: "archetypes", label: "精算配单", cmd: "setTab", value: "archetypes" },
  { id: "audit", label: "审单锁利", cmd: "setTab", value: "audit" },
  { id: "poster", label: "打票海报", cmd: "openPoster", value: null },
  { id: "ledger", label: "账本皮肤", cmd: "setTab", value: "ledger" },
];

export const RADAR_MODE_OPTS: Array<[MatchMode, string]> = [
  ["mix", "混合"],
  ["spf", "胜平负"],
  ["bf", "比分"],
  ["zjq", "进球"],
  ["bqc", "半全场"],
  ["single", "单关"],
];

export const RADAR_QUICK_FILTERS: Array<[QuickFilter, string]> = [
  ["all", "全部"],
  ["low-vig", "浅抽水"],
  ["drop", "▼末跳降水"],
  ["arb", "省钱差价"],
];

export interface TrendArrowSpec {
  direction: -1 | 1;
  symbol: "▼" | "▲";
  className: "trd dn" | "trd up";
  title: "末跳水位下调" | "末跳水位上调";
}

export function buildTrendArrowSpec(
  trend?: -1 | 0 | 1,
  movement?: DualAxisOptionMovement | null
): TrendArrowSpec | null {
  const dir = movement?.lastHopDirection ?? trend ?? 0;
  if (dir === 1) {
    return {
      direction: 1,
      symbol: "▲",
      className: "trd up",
      title: "末跳水位上调",
    };
  }
  if (dir === -1) {
    return {
      direction: -1,
      symbol: "▼",
      className: "trd dn",
      title: "末跳水位下调",
    };
  }
  return null;
}

export interface CompactDeltaProbBadgeSpec {
  text: string;
  tone: "pos" | "neg";
  baselineSource: "official-archive-open" | "local-first-seen";
  hasLocalInitMarker: boolean;
  title: string;
}

export interface CompactOptionMovementViewModel {
  oddsText: string;
  fairProbText: string;
  trendArrow: TrendArrowSpec | null;
  deltaBadge: CompactDeltaProbBadgeSpec | null;
}

export function buildCompactOptionMovementViewModel(
  opt: Pick<OddsOption, "odds" | "fairProb" | "trend" | "movement">,
  probDecimals = 0
): CompactOptionMovementViewModel {
  const oddsText = Number(opt.odds || 0).toFixed(2);
  const fairProbText = `${(
    Math.max(0, Number(opt.fairProb) || 0) * 100
  ).toFixed(probDecimals)}%`;
  const trendArrow = buildTrendArrowSpec(opt.trend, opt.movement);

  const mov = opt.movement;
  let deltaBadge: CompactDeltaProbBadgeSpec | null = null;
  if (
    mov &&
    mov.frameCount >= 2 &&
    mov.baselineSource !== "single-frame" &&
    typeof mov.cumFairProbDeltaPp === "number" &&
    Number.isFinite(mov.cumFairProbDeltaPp) &&
    Math.abs(mov.cumFairProbDeltaPp) >= 0.1
  ) {
    const dp = mov.cumFairProbDeltaPp;
    const sign = dp > 0 ? "+" : "";
    const hasLocalInitMarker = mov.baselineSource === "local-first-seen";
    const srcText = hasLocalInitMarker ? "自本系统首次观测" : "自官方归档首报";
    deltaBadge = {
      text: `${sign}${dp.toFixed(1)}pp${hasLocalInitMarker ? "初" : ""}`,
      tone: dp > 0 ? "pos" : "neg",
      baselineSource: mov.baselineSource,
      hasLocalInitMarker,
      title: `${srcText}累计真实隐含概率净变化 ${sign}${dp.toFixed(2)}pp`,
    };
  }

  return {
    oddsText,
    fairProbText,
    trendArrow,
    deltaBadge,
  };
}

export interface DualAxisOptionRowViewModel {
  optionKey: string;
  optionLabel: string;
  fairProbText: string;
  axis1ValueText: string;
  axis1SubText: string;
  axis1Tone: "pos" | "neg" | "neutral";
  axis2ValueText: string;
  axis2TimeText: string;
  axis2Direction: -1 | 0 | 1;
  isSameDirectionAsFairProb: boolean;
}

export interface DualAxisPoolCardViewModel {
  poolCode: PoolCode;
  poolTitle: string;
  goalLine: string;
  goalLineSegmentLabel: string | null;
  baselineSource: "official-archive-open" | "local-first-seen" | "single-frame";
  baselineBadgeText:
    "自官方归档首报" | "自本系统首次观测" | "仅单帧观测·暂不判趋势";
  frameCount: number;
  hasSameDirectionWarning: boolean;
  sameDirectionWarningText: string | null;
  rows: DualAxisOptionRowViewModel[];
}

export interface MatchDualAxisDrawerViewModel {
  sectionTitle: "双维盘面走势";
  sectionSubtitle: string;
  axis1Header: string;
  axis2Header: string;
  pools: DualAxisPoolCardViewModel[];
}

function resolveBaselineBadgeText(
  src: DualAxisOptionMovement["baselineSource"]
): DualAxisPoolCardViewModel["baselineBadgeText"] {
  if (src === "official-archive-open") return "自官方归档首报";
  if (src === "local-first-seen") return "自本系统首次观测";
  return "仅单帧观测·暂不判趋势";
}

export function buildMatchDualAxisDrawerViewModel(
  match: Pick<MatchItem, "id" | "pools">,
  options?: {
    poolCodes?: PoolCode[];
    maxSubPoolRows?: number;
  }
): MatchDualAxisDrawerViewModel {
  const poolCodes: PoolCode[] = options?.poolCodes ?? [
    "HAD",
    "HHAD",
    "TTG",
    "HAFU",
    "CRS",
  ];
  const maxSubPoolRows = Math.max(2, options?.maxSubPoolRows ?? 4);
  const poolCards: DualAxisPoolCardViewModel[] = [];

  for (const code of poolCodes) {
    const pool = match.pools?.[code];
    if (
      !pool ||
      pool.selling === false ||
      !Array.isArray(pool.options) ||
      pool.options.length === 0
    ) {
      continue;
    }

    const goalLine =
      code === "HHAD" ? String(pool.goalLine ?? "-1").trim() : "";
    const goalLineSegmentLabel =
      code === "HHAD" ? `当前让球分段 ${goalLine}（换线独立起算）` : null;
    const poolTitle =
      code === "HHAD"
        ? `让球胜平负(${goalLine})`
        : POOL_SHORT_SINGLE_NAMES[code] || pool.name;

    const firstMov = pool.options[0]?.movement;
    const baselineSource: DualAxisPoolCardViewModel["baselineSource"] =
      firstMov &&
      firstMov.frameCount >= 2 &&
      firstMov.baselineSource !== "single-frame"
        ? firstMov.baselineSource
        : "single-frame";
    const baselineBadgeText = resolveBaselineBadgeText(baselineSource);
    const frameCount = Math.max(1, Number(firstMov?.frameCount ?? 1));

    let chosenOptions = pool.options;
    if (code !== "HAD" && code !== "HHAD") {
      const moved = pool.options
        .filter((o) => {
          const m = o.movement;
          const dir = m?.lastHopDirection ?? o.trend ?? 0;
          const dp =
            typeof m?.cumFairProbDeltaPp === "number"
              ? Math.abs(m.cumFairProbDeltaPp)
              : 0;
          return dp >= 0.1 || dir !== 0;
        })
        .sort((a, b) => {
          const ad = Math.abs(a.movement?.cumFairProbDeltaPp ?? 0);
          const bd = Math.abs(b.movement?.cumFairProbDeltaPp ?? 0);
          if (Math.abs(bd - ad) > 1e-6) return bd - ad;
          return (
            Math.abs(b.movement?.lastHopDirection ?? b.trend ?? 0) -
            Math.abs(a.movement?.lastHopDirection ?? a.trend ?? 0)
          );
        });
      chosenOptions =
        moved.length > 0
          ? moved.slice(0, maxSubPoolRows)
          : [...pool.options]
              .sort((a, b) => b.fairProb - a.fairProb)
              .slice(0, Math.min(3, maxSubPoolRows));
    }

    const rows: DualAxisOptionRowViewModel[] = chosenOptions.map((opt) => {
      const mov = opt.movement;
      const optFrames = Number(mov?.frameCount ?? 1);
      const hasMulti =
        Boolean(mov) &&
        optFrames >= 2 &&
        mov!.baselineSource !== "single-frame" &&
        typeof mov!.cumFairProbDeltaPp === "number" &&
        Number.isFinite(mov!.cumFairProbDeltaPp);
      const dp = hasMulti ? mov!.cumFairProbDeltaPp! : null;
      const dir: -1 | 0 | 1 = mov?.lastHopDirection ?? opt.trend ?? 0;
      const curOdds = Number(mov?.currentOdds ?? opt.odds ?? 0);

      let axis1ValueText = "仅单帧观测·暂不判趋势";
      let axis1SubText = mov?.openAt
        ? `首见于 ${mov.openAt} · 待满两帧实算`
        : "当前仅单帧报价 · 不判累计趋势";
      let axis1Tone: "pos" | "neg" | "neutral" = "neutral";

      if (dp !== null && mov) {
        const sign = dp > 0 ? "+" : "";
        axis1ValueText = `${sign}${dp.toFixed(2)}pp`;
        const openTxt =
          typeof mov.openOdds === "number" && mov.openOdds > 1
            ? ` · 首@${mov.openOdds.toFixed(2)}`
            : "";
        const atTxt = mov.openAt ? ` (${mov.openAt})` : "";
        axis1SubText = `${resolveBaselineBadgeText(mov.baselineSource)}${openTxt}${atTxt}`;
        axis1Tone = dp > 0.05 ? "pos" : dp < -0.05 ? "neg" : "neutral";
      }

      let axis2ValueText: string;
      let axis2TimeText: string;
      if (
        mov &&
        optFrames >= 2 &&
        typeof mov.prevOdds === "number" &&
        mov.prevOdds > 1
      ) {
        const dirWord = dir === 1 ? "▲升" : dir === -1 ? "▼降" : "→平";
        axis2ValueText = `${mov.prevOdds.toFixed(2)} → ${curOdds.toFixed(2)} ${dirWord}`;
        axis2TimeText =
          mov.prevAt && mov.currentAt
            ? `${mov.prevAt} → ${mov.currentAt}`
            : mov.currentAt || "最新快照";
      } else {
        const dirWord =
          dir === 1 ? "▲末跳升" : dir === -1 ? "▼末跳降" : "→无升降";
        axis2ValueText = `当前 @${curOdds.toFixed(2)} ${dirWord}`;
        axis2TimeText = mov?.currentAt ? `观测于 ${mov.currentAt}` : "实时单帧";
      }

      const isSameDirectionAsFairProb = Boolean(
        dp !== null && ((dir === -1 && dp < -0.05) || (dir === 1 && dp > 0.05))
      );

      return {
        optionKey: opt.key,
        optionLabel: opt.label,
        fairProbText: `${(Math.max(0, Number(opt.fairProb) || 0) * 100).toFixed(
          code === "HAD" || code === "HHAD" ? 1 : 1
        )}%`,
        axis1ValueText,
        axis1SubText,
        axis1Tone,
        axis2ValueText,
        axis2TimeText,
        axis2Direction: dir,
        isSameDirectionAsFairProb,
      };
    });

    const hasSameDirectionWarning = rows.some(
      (r) => r.isSameDirectionAsFairProb
    );
    poolCards.push({
      poolCode: code,
      poolTitle,
      goalLine,
      goalLineSegmentLabel,
      baselineSource,
      baselineBadgeText,
      frameCount,
      hasSameDirectionWarning,
      sameDirectionWarningText: hasSameDirectionWarning
        ? "⚠️ 整池返还率同步调整：单项水位与去水真率同向变化，切勿反转箭头充趋势"
        : null,
      rows,
    });
  }

  return {
    sectionTitle: "双维盘面走势",
    sectionSubtitle:
      "① 累计去水真率净变化 ∥ ② 末跳水位变动（整池调返还率时可同向变化）",
    axis1Header: "① 累计去水真率净变化",
    axis2Header: "② 末跳水位变动",
    pools: poolCards,
  };
}

export interface MatchRadarBoardFreshnessBannerViewModel {
  headline: string;
  badgeText: string;
  detailText: string;
  fullBannerText: string;
  boardState: BoardFreshnessMeta["boardState"];
}

function formatBeijingClockFromEpoch(epochMs: number): string {
  const iso = new Date(epochMs + 8 * 3600_000).toISOString();
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

export function buildMatchRadarBoardFreshnessBanner(
  boardMeta?: BoardFreshnessMeta | null
): MatchRadarBoardFreshnessBannerViewModel | null {
  if (
    !boardMeta ||
    !boardMeta.isFallbackReadOnly ||
    boardMeta.boardState === "fresh"
  ) {
    return null;
  }
  const clockLabel =
    boardMeta.lastValidBoardClock ||
    (typeof boardMeta.lastValidBoardAt === "number" &&
    Number.isFinite(boardMeta.lastValidBoardAt)
      ? formatBeijingClockFromEpoch(boardMeta.lastValidBoardAt)
      : "内置基准快照");

  const headline = `上次有效报价（采集于 ${clockLabel}）`;
  const detailText =
    boardMeta.boardState === "empty-board-fallback"
      ? "官方在售盘面当前暂空，以下展示最近一次成功采集快照（只读参考，不计停售异动）"
      : boardMeta.boardState === "maintenance-fallback"
        ? "官方接口维护中，以下展示最近一次成功采集快照（只读参考，不计停售异动）"
        : boardMeta.boardState === "timeout-fallback"
          ? "官方接口响应超时，已回退最近一次成功采集快照（只读参考，不计停售异动）"
          : "官方接口暂不可达，当前展示内置基准快照（仅供只读推演参考）";

  return {
    headline,
    badgeText: "只读回退",
    detailText,
    fullBannerText:
      boardMeta.bannerText || `${headline} · 官方盘面暂空/回退只读参考`,
    boardState: boardMeta.boardState,
  };
}

export function buildBoardHeaderStatusText(
  matchCount: number,
  boardMeta?: BoardFreshnessMeta | null,
  offlineMode = false
): {
  text: string;
  isFallbackReadOnly: boolean;
  tone: "live" | "fallback" | "offline";
} {
  if (offlineMode) {
    return {
      text: `⚡ 离线缓存 ${matchCount} 场`,
      isFallbackReadOnly: true,
      tone: "offline",
    };
  }
  if (
    boardMeta &&
    boardMeta.isFallbackReadOnly &&
    boardMeta.boardState !== "fresh"
  ) {
    const clock =
      boardMeta.lastValidBoardClock ||
      (typeof boardMeta.lastValidBoardAt === "number" &&
      Number.isFinite(boardMeta.lastValidBoardAt)
        ? formatBeijingClockFromEpoch(boardMeta.lastValidBoardAt)
        : "内置快照");
    return {
      text: `回退快照 ${matchCount} 场（采集于 ${clock} · 只读参考）`,
      isFallbackReadOnly: true,
      tone: "fallback",
    };
  }
  return {
    text: `实盘 ${matchCount} 场`,
    isFallbackReadOnly: false,
    tone: "live",
  };
}

export function dedupePlanTitle(raw?: string | null): string {
  return dedupeRepeatedDotTokens(String(raw ?? ""));
}

export const PORTFOLIO_BUDGET_PRESETS = [10, 20, 50, 100];
export const PORTFOLIO_CUSTOM_BUDGET_LIMITS = {
  min: 2,
  max: 20000,
  step: 2,
};

export const KEYPAD_MULTIPLIER_PRESETS = [1, 2, 3, 4, 5, 10];
export const SUBJECTIVE_SLIDER_BOUNDS = {
  min: SUBJECTIVE_DELTA_MIN,
  max: SUBJECTIVE_DELTA_MAX,
  step: 1,
};

export const DESKTOP_WORKBENCH_COLUMNS = [
  "① 📡 赛事雷达 · 全盘矩阵",
  "② 🎯 3+1 精算配单",
  "③ 🛡️ 五维审单锁利",
];

export const DESKTOP_RIGHT_CABIN_TABS: Array<[DesktopRightCabinTab, string]> = [
  ["audit", "③ 🛡️ 五维审单锁利"],
  ["ledger", "📒 双轨账本"],
  ["intel", "🧹 小高情报舱"],
];

export function buildMobileTab4CabinOptions(
  ledgerCount: number,
  matchCount: number
): Array<[MobileTab4Cabin, string]> {
  return [
    ["ledger", `📒 双轨账本(${ledgerCount})`],
    ["intel", `🧹 小高情报舱(${matchCount})`],
  ];
}

export function buildPortfolioSlotOptions(
  portfolioPlans: ArchetypePlan[]
): Array<[PortfolioKey, string]> {
  const alphaPlan = portfolioPlans.find(
    (p) => p.key === "alpha-radar" || p.key === "value-assassin"
  );
  return [
    ["max-profit-prob", "稳健保本"],
    ["max-ev-utility", "期望效用"],
    ["max-cvar-wheel", "容错缩水"],
    [
      "alpha-radar",
      alphaPlan?.available === false ? "错价雷达·空仓" : "错价雷达",
    ],
  ];
}

export interface PortfolioGroupTicketMetric {
  tileLabel: string;
  logicalGroupCount: number;
  physicalTicketCount: number;
  has99xSplit: boolean;
  summary: string;
  subtitle: string;
  flipToBackLabel: string;
}

export function formatPortfolioGroupAndTicketMetric(
  plan: ArchetypePlan
): PortfolioGroupTicketMetric {
  const logicalGroupCount = plan.logicalGroupCount ?? plan.lines.length;
  const physicalTicketCount =
    plan.physicalTicketCount ??
    plan.lines.reduce(
      (sum, ln) => sum + Math.max(1, Math.ceil((ln.multiple || 1) / 99)),
      0
    );
  const has99xSplit = physicalTicketCount > logicalGroupCount;
  const summary = has99xSplit
    ? `${logicalGroupCount} 组 · ${physicalTicketCount} 张票`
    : `${logicalGroupCount} 组（${physicalTicketCount} 张实票）`;
  const subtitle =
    typeof plan.wipeoutMiss2Prob === "number"
      ? `错≥2场击穿 ${(plan.wipeoutMiss2Prob * 100).toFixed(1)}%`
      : has99xSplit
        ? "含>99倍按终端上限自动拆票"
        : "点右上翻转看实票拆解";
  return {
    tileLabel: "店面逻辑组与实票",
    logicalGroupCount,
    physicalTicketCount,
    has99xSplit,
    summary,
    subtitle,
    flipToBackLabel: `🔄 翻转看 ${summary}与依据 ›`,
  };
}

export interface KpiTileModel {
  label: string;
  value: string;
  subtitle: string;
  isDanger?: boolean;
  strikeSubtitle?: boolean;
}

export function formatPortfolioProbPct(prob: number): string {
  const pct = Math.max(0, Number(prob) || 0) * 100;
  if (pct <= 1e-9) return "0.0%";
  if (pct < 0.1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

export interface PortfolioPlanGovernanceBadges {
  isTier1B: boolean;
  tier1bBadge: string | null;
  tier1bMetricsText: string | null;
  coOptimalBadge: string | null;
  optimalityBadge: string | null;
}

export function buildPortfolioPlanGovernanceBadges(
  plan: ArchetypePlan
): PortfolioPlanGovernanceBadges {
  const isTier1B = plan.slotTier === "tier-1b";
  const pLoss = Number(plan.partialLossProb) || 0;
  const shortfall = Number(plan.partialLossShortfall) || 0;
  const tier1bBadge = isTier1B ? "允许局部回血 · 非保本" : null;
  const tier1bMetricsText = isTier1B
    ? `局部回血率 ${formatPortfolioProbPct(pLoss)}${
        shortfall > 0 ? ` · 期望回血缺口 ¥${shortfall.toFixed(2)}` : ""
      }`
    : null;
  const coOptimalBadge =
    Array.isArray(plan.coOptimalWithSlots) && plan.coOptimalWithSlots.length > 1
      ? "双目标共选最优"
      : null;
  const optimalityBadge =
    plan.optimalityStatus === "domain-certified"
      ? "精确全局最优"
      : plan.optimalityStatus === "library-certified"
        ? "候选库最优"
        : plan.optimalityStatus === "time-budget-best"
          ? "时限内最优"
          : null;
  return {
    isTier1B,
    tier1bBadge,
    tier1bMetricsText,
    coOptimalBadge,
    optimalityBadge,
  };
}

export function buildPortfolioKpiTiles(
  plan: ArchetypePlan,
  options?: { allowSaveCash?: boolean }
): {
  groupTicket: PortfolioGroupTicketMetric;
  saveCashSummary: string | null;
  tile1: KpiTileModel;
  tile2: KpiTileModel;
  tile3: KpiTileModel;
  tile4: KpiTileModel;
} {
  const objStrictProb =
    plan.objectiveStrictNetGainProb ??
    plan.strictNetGainProb ??
    plan.profitProb;
  const objProfitProb = plan.objectiveProfitProb ?? plan.profitProb;
  const archObjBreakEvenProb = Math.max(0, objProfitProb - objStrictProb);
  const zeroProb =
    typeof plan.zeroPayoutProb === "number" &&
    (typeof plan.winProb !== "number" ||
      Math.abs(plan.zeroPayoutProb - (1 - plan.winProb)) < 1e-4)
      ? Math.max(0, plan.zeroPayoutProb)
      : Math.max(0, 1 - (plan.winProb ?? 0));

  const subParts: string[] = [`整单归零率 ${formatPortfolioProbPct(zeroProb)}`];
  if (plan.slotTier === "tier-1b") {
    subParts.push("允许局部回血 · 非保本");
  } else if (
    (plan.key === "max-profit-prob" || plan.key === "iron-shield") &&
    (plan.underwaterCount ?? 0) === 0
  ) {
    subParts.push("覆盖范围内不倒贴");
  }
  if (archObjBreakEvenProb * 100 >= 0.05) {
    subParts.push(
      `另含 ${formatPortfolioProbPct(archObjBreakEvenProb)} 刚回本`
    );
  }
  if (plan.subjectiveProjectedProfitProb != null) {
    subParts.push(
      `个人推演 ${formatPortfolioProbPct(plan.subjectiveProjectedProfitProb)}`
    );
  }

  const uwCount = plan.underwaterCount ?? 0;
  const distinctMatchCount = new Set(
    (plan.lines ?? []).flatMap((l) => (l.legs ?? []).map((g) => g.matchId))
  ).size;
  const showCrossMatchMissOne =
    plan.missOneReturn !== null && distinctMatchCount >= 2;
  const isSingleMatchCushion =
    plan.missOneReturn !== null && distinctMatchCount === 1;

  const archObjEvRate = plan.objectiveEVRate ?? plan.expectedValueRate ?? 0;
  const archObjEvPct = archObjEvRate * 100;
  const archSubjEvPct =
    plan.subjectiveProjectedEVRate != null
      ? plan.subjectiveProjectedEVRate * 100
      : null;
  const payoutReturnPct = Math.max(0, 100 - plan.vigPct).toFixed(1);
  const groupTicket = formatPortfolioGroupAndTicketMetric(plan);

  const showSaveCashTriad =
    Boolean(options?.allowSaveCash || plan.allowSaveCashEnabled) &&
    (plan.key === "max-ev-utility" || plan.key === "spear-shield");
  const netVsCash =
    plan.expectedNetVsCashYuan ??
    Number((plan.totalCost * archObjEvRate).toFixed(2));
  const lossVsCash =
    plan.expectedLossVsCashYuan ??
    Number((plan.totalCost * Math.max(0, -archObjEvRate)).toFixed(2));
  const vsCashPhrase =
    netVsCash > 1e-6
      ? `期望净赚 +¥${netVsCash.toFixed(2)}`
      : `相对留现期望净损 ¥${lossVsCash.toFixed(2)}`;
  const saveCashSummary = showSaveCashTriad
    ? `实投 ¥${plan.totalCost} · 留存 ¥${plan.savedCash} · ${vsCashPhrase}`
    : null;

  const baseTile3Subtitle =
    archSubjEvPct !== null
      ? `个人推演 ${archSubjEvPct >= 0 ? "+" : ""}${archSubjEvPct.toFixed(1)}% · 返${payoutReturnPct}%`
      : `票面返还 ${payoutReturnPct}%`;

  const partialLossText =
    plan.slotTier === "tier-1b" && typeof plan.partialLossProb === "number"
      ? `⚠️ 允许局部回血 ${formatPortfolioProbPct(plan.partialLossProb)}${
          typeof plan.partialLossShortfall === "number" &&
          plan.partialLossShortfall > 0
            ? `（期望缺口¥${plan.partialLossShortfall.toFixed(2)}）`
            : `（${uwCount}项<本金）`
        }`
      : uwCount > 0
        ? `⚠️ 含 ${uwCount} 组局部回血(<本金)`
        : "0 假中奖倒贴";

  return {
    groupTicket,
    saveCashSummary,
    tile1: {
      label: "严格净赚率",
      value: formatPortfolioProbPct(objStrictProb),
      subtitle: subParts.join(" · "),
      isDanger: zeroProb > 0.8,
    },
    tile2: {
      label: showCrossMatchMissOne
        ? "错1场保命回血"
        : isSingleMatchCushion
          ? "单场缓冲返奖"
          : "命中返奖区间",
      value: showCrossMatchMissOne
        ? `¥${plan.missOneReturn!.toFixed(0)} (全中¥${plan.maxReturn.toFixed(0)})`
        : `¥${plan.minReturn.toFixed(0)}~${plan.maxReturn.toFixed(0)}`,
      subtitle: partialLossText,
      isDanger: uwCount > 0 || plan.slotTier === "tier-1b",
    },
    tile3: {
      label: "客观数学期望与抽水",
      value: `${archObjEvPct >= 0 ? "+" : ""}${archObjEvPct.toFixed(1)}%`,
      subtitle: saveCashSummary
        ? `${saveCashSummary} · ${baseTile3Subtitle}`
        : baseTile3Subtitle,
    },
    tile4: {
      label: groupTicket.tileLabel,
      value: groupTicket.summary,
      subtitle: groupTicket.subtitle,
    },
  };
}

export interface AlphaRadarEmptyStateViewModel {
  hasRemediationActions: boolean;
  isNarrowBudgetAlphaGated: boolean;
  noteTitle: string;
  noteLead: string;
  showNoAlphaDisabledButton: boolean;
  disabledButtonText: string;
  remediationActions: PortfolioRemediationAction[];
}

export function buildAlphaRadarEmptyStateViewModel(
  plan: ArchetypePlan,
  budget: number
): AlphaRadarEmptyStateViewModel {
  const remediationActions = Array.isArray(plan.remediationActions)
    ? plan.remediationActions
    : [];
  const hasRemediationActions = remediationActions.length > 0;
  const isNarrowBudgetAlphaGated = remediationActions.some(
    (act) => act.kind === "min-feasible-budget"
  );
  const saved = plan.savedCash || budget;
  return {
    hasRemediationActions,
    isNarrowBudgetAlphaGated,
    noteTitle: isNarrowBudgetAlphaGated
      ? "⚡ 检出真错价洼地 · 当前窄预算受 36% 轻仓整注护栏保护："
      : "🛡️ 宁缺毋滥 · 诚实空仓省钱纪律：",
    noteLead:
      plan.emptyReason ||
      (isNarrowBudgetAlphaGated
        ? `当前预算 ¥${budget} 的 36% 轻仓上限不足 1 注（¥2），可一键切换至最低可行预算或保留本金空仓。`
        : `当前盘面定价严密，无跨盘错价洼地 · 建议空仓省下 ¥${saved}，绝不硬凑高抽水废单。`),
    showNoAlphaDisabledButton: !hasRemediationActions,
    disabledButtonText: `当前无真错价洼地（建议空仓省下 ¥${saved}）`,
    remediationActions,
  };
}

export function formatAuditProbabilityPct(prob: number): string {
  const p = Number(prob) || 0;
  if (!(p > 1e-12)) return "0.0%";
  const pct = Math.min(100, p * 100);
  if (pct < 0.1) {
    if (pct >= 0.01) return `${pct.toFixed(2)}%`;
    if (pct >= 0.0001) return `${Number(pct.toPrecision(2))}%`;
    return "<0.0001%";
  }
  if (pct > 99.9 && pct < 100 - 1e-9) {
    return `${pct.toFixed(2)}%`;
  }
  return `${pct.toFixed(1)}%`;
}

function formatQuantileAmount(val: number): string {
  const n = Math.max(0, Number(val) || 0);
  if (n <= 1e-9) return "0";
  if (n >= 100 || Math.abs(n - Math.round(n)) < 0.005) {
    return n.toFixed(0);
  }
  return n.toFixed(2);
}

function resolveReportUnconditionalProbs(effectiveReport: TruthReport): {
  isEmpty: boolean;
  wipeoutProb: number;
  partialLossProb: number;
  breakEvenProb: number;
  strictGainProb: number;
  anyWinProb: number;
} {
  const totalCost = Number(effectiveReport.totalCost) || 0;
  if (!(totalCost > 0)) {
    return {
      isEmpty: true,
      wipeoutProb: 0,
      partialLossProb: 0,
      breakEvenProb: 0,
      strictGainProb: 0,
      anyWinProb: 0,
    };
  }
  const bucketSum =
    (effectiveReport.zeroPayoutProb ?? 0) +
    (effectiveReport.partialLossProb ?? 0) +
    (effectiveReport.breakEvenProb ?? 0) +
    (effectiveReport.strictNetGainProb ?? 0);
  const hasExplicitFourBuckets = Math.abs(bucketSum - 1) < 1e-6;
  const strictGainProb = Math.max(
    0,
    effectiveReport.objectiveStrictNetGainProb ??
      effectiveReport.strictNetGainProb ??
      0
  );
  const objProfitProb = Math.max(
    strictGainProb,
    effectiveReport.objectiveProfitProb ?? 0
  );
  const breakEvenProb = hasExplicitFourBuckets
    ? Math.max(
        0,
        effectiveReport.objectiveBreakEvenProb ?? objProfitProb - strictGainProb
      )
    : Math.max(0, objProfitProb - strictGainProb);
  const partialLossProb = hasExplicitFourBuckets
    ? Math.max(
        0,
        effectiveReport.objectivePartialLossProb ??
          effectiveReport.partialLossProb ??
          0
      )
    : Math.max(0, (effectiveReport.anyWinProb ?? 0) - objProfitProb);
  const wipeoutProb = hasExplicitFourBuckets
    ? Math.max(
        0,
        effectiveReport.objectiveZeroPayoutProb ??
          effectiveReport.zeroPayoutProb ??
          0
      )
    : Math.max(0, 1 - (effectiveReport.anyWinProb ?? 0));
  const anyWinProb = Math.min(1, Math.max(0, 1 - wipeoutProb));
  return {
    isEmpty: false,
    wipeoutProb,
    partialLossProb,
    breakEvenProb,
    strictGainProb,
    anyWinProb,
  };
}

export interface AuditCockpitHeaderBadge {
  text: string;
  dangerScore: number;
  levelLabel: "高危" | "中高危" | "中危" | "稳健" | "待选";
  isDanger: boolean;
  isWarn: boolean;
}

export interface AuditCockpitFlipModel {
  quantileTile: KpiTileModel;
  vigTile: KpiTileModel;
}

export function buildAuditCockpitTiles(
  effectiveReport: TruthReport,
  insights: ProOrderInsights
): {
  headerBadge: AuditCockpitHeaderBadge;
  flipBack: AuditCockpitFlipModel;
  tile1: KpiTileModel;
  tile2: KpiTileModel;
  tile3: KpiTileModel;
  tile4: KpiTileModel;
} {
  const totalCost = Number(effectiveReport.totalCost) || 0;
  const {
    isEmpty,
    wipeoutProb,
    partialLossProb,
    breakEvenProb,
    strictGainProb,
    anyWinProb,
  } = resolveReportUnconditionalProbs(effectiveReport);

  const dangerScore = isEmpty ? 0 : Number(effectiveReport.dangerScore) || 0;
  const levelLabel: AuditCockpitHeaderBadge["levelLabel"] = isEmpty
    ? "待选"
    : dangerScore >= 70
      ? "高危"
      : dangerScore >= 50
        ? "中高危"
        : dangerScore >= 35
          ? "中危"
          : "稳健";
  const headerBadge: AuditCockpitHeaderBadge = {
    text: isEmpty ? "待选号" : `危险分 ${dangerScore} · ${levelLabel}`,
    dangerScore,
    levelLabel,
    isDanger: !isEmpty && dangerScore >= 70,
    isWarn: !isEmpty && dangerScore >= 50 && dangerScore < 70,
  };

  const tile1Sub = isEmpty
    ? "未投入本金 ¥0"
    : wipeoutProb <= 1e-12
      ? partialLossProb > 1e-12
        ? `全包零归零 · ${formatAuditProbabilityPct(partialLossProb)}倒贴`
        : "全赛果零归零 · 本金无损"
      : partialLossProb > 1e-6
        ? `本金损失 ¥${totalCost} · 另${formatAuditProbabilityPct(partialLossProb)}倒贴`
        : `本金损失 ¥${totalCost}`;

  const tile2Parts: string[] = [];
  if (breakEvenProb >= 1e-5) {
    tile2Parts.push(`另含 ${formatAuditProbabilityPct(breakEvenProb)} 刚回本`);
  } else if (!isEmpty) {
    tile2Parts.push("平手保本 0.0%");
  }
  if (effectiveReport.subjectiveProjectedProfitProb != null) {
    tile2Parts.push(
      `个人推演 ${formatAuditProbabilityPct(effectiveReport.subjectiveProjectedProfitProb)}`
    );
  } else if (!isEmpty && breakEvenProb < 1e-5) {
    tile2Parts.push(`命中 ${formatAuditProbabilityPct(anyWinProb)}`);
  }

  const minHit =
    effectiveReport.conditionalMinHitPayout ?? effectiveReport.minPayout ?? 0;
  const maxHit =
    effectiveReport.conditionalMaxHitPayout ?? effectiveReport.maxPayout ?? 0;
  const isFloorGuaranteed =
    !isEmpty &&
    (effectiveReport.isUnconditionalFloorGuaranteed === true ||
      (wipeoutProb <= 1e-12 &&
        partialLossProb <= 1e-12 &&
        minHit >= totalCost));

  const hitRangeVal = isEmpty
    ? "¥0.00"
    : Math.abs(minHit - maxHit) < 0.005
      ? `¥${minHit.toFixed(2)}`
      : maxHit >= 1000
        ? `¥${minHit < 100 ? minHit.toFixed(2) : minHit.toFixed(0)}～¥${maxHit.toFixed(0)}`
        : `¥${minHit.toFixed(2)}～¥${maxHit.toFixed(2)}`;
  const tile3Sub = isEmpty
    ? "待选号评估"
    : effectiveReport.underwaterCount > 0
      ? `⚠️ 含 ${effectiveReport.underwaterCount}/${effectiveReport.comboCount} 组倒贴(<¥${totalCost})`
      : !isFloorGuaranteed && wipeoutProb > 1e-9
        ? "仅限命中前提 · 未中返 ¥0"
        : !isFloorGuaranteed
          ? `最低返奖低于本金 ¥${totalCost}`
          : breakEvenProb >= 1e-5
            ? "全赛果≥本金（含平手保本）"
            : "全赛果无条件保底净赚";

  const objEvRate = Number(effectiveReport.objectiveEVRate) || 0;
  const expectedReturn = isEmpty ? 0 : Math.max(0, totalCost * (1 + objEvRate));
  const expectedNet = isEmpty ? 0 : expectedReturn - totalCost;
  const kellyNote =
    objEvRate <= 0
      ? `凯利0%·娱乐≤${insights.recommendedBankrollPct}%`
      : `凯利仓≤${insights.recommendedBankrollPct}%`;
  const streakProb = Number(insights.fiveLossStreakProb) || 0;
  const streakPctText =
    streakProb >= 0.95
      ? `${(streakProb * 100).toFixed(1)}%`
      : streakProb > 0 && streakProb < 0.01
        ? formatAuditProbabilityPct(streakProb)
        : `${Math.round(streakProb * 100)}%`;
  const streakOrSubj =
    effectiveReport.subjectiveProjectedEVRate != null
      ? `个人推演EV ${effectiveReport.subjectiveProjectedEVRate >= 0 ? "+" : ""}${(effectiveReport.subjectiveProjectedEVRate * 100).toFixed(1)}% · `
      : `连黑5次 ${streakPctText} · `;

  const q = effectiveReport.objectiveUnconditionalQuantiles ??
    effectiveReport.unconditionalQuantiles ?? {
      p20: 0,
      p50: 0,
      p80: 0,
      p99: 0,
    };

  return {
    headerBadge,
    flipBack: {
      quantileTile: {
        label: "无条件返奖分位数 (P20/P50/P80)",
        value: `¥${formatQuantileAmount(q.p20)} / ¥${formatQuantileAmount(q.p50)} / ¥${formatQuantileAmount(q.p80)}`,
        subtitle: !isEmpty
          ? `含零返奖全概率质量 · 中位数P50=¥${formatQuantileAmount(q.p50)} (P99=¥${formatQuantileAmount(q.p99)})`
          : "按全体赛果累计概率质量计算",
        isDanger: !isEmpty && q.p80 <= 0,
      },
      vigTile: {
        label: "暗扣抽水与等效水位",
        value: `-${effectiveReport.avgVigLossPer100}%`,
        subtitle: `返${(effectiveReport.avgPayoutRatio * 100).toFixed(1)}% · 等效@${effectiveReport.effectiveOdds.toFixed(2)}`,
        isDanger: !isEmpty && effectiveReport.avgPayoutRatio < 0.72,
      },
    },
    tile1: {
      label: "整单归零率",
      value: isEmpty ? "0.0%" : formatAuditProbabilityPct(wipeoutProb),
      subtitle: tile1Sub,
      isDanger: !isEmpty && wipeoutProb > 0.8,
      strikeSubtitle: false,
    },
    tile2: {
      label: "严格净赚率",
      value: formatAuditProbabilityPct(strictGainProb),
      subtitle:
        tile2Parts.length > 0 ? tile2Parts.join(" · ") : "客观净利>0 才算真赚",
      isDanger: !isEmpty && strictGainProb < 0.05,
    },
    tile3: {
      label: isFloorGuaranteed ? "无条件保底～最高返奖" : "命中后最低/最高返奖",
      value: hitRangeVal,
      subtitle: tile3Sub,
      isDanger:
        !isEmpty && (effectiveReport.underwaterCount > 0 || minHit < totalCost),
    },
    tile4: {
      label: isEmpty
        ? "期望净损益 · 期望返奖"
        : expectedNet < -0.005
          ? "期望净亏 · 期望返奖"
          : expectedNet > 0.005
            ? "期望净赚 · 期望返奖"
            : "期望保本 · 期望返奖",
      value: isEmpty
        ? "¥0.00 (0.0%)"
        : `${expectedNet >= 0 ? "+" : "-"}¥${Math.abs(expectedNet).toFixed(2)} (${objEvRate >= 0 ? "+" : ""}${(objEvRate * 100).toFixed(1)}%)`,
      subtitle: isEmpty
        ? "待选号评估"
        : `期返¥${expectedReturn.toFixed(2)} · ${streakOrSubj}${kellyNote}`,
      isDanger: !isEmpty && (objEvRate <= -0.25 || dangerScore >= 70),
    },
  };
}

export interface AuditScenarioRow extends ComboRow {
  isZeroWipeoutRow: boolean;
  expandable: boolean;
  probText: string;
  payout: number;
  scenarioLabel: string;
  statusBadgeText: string;
  winningTicketCount: number;
  winningTickets: AttributedWinningTicket[];
  roiMultiple: number;
  barTone: "loss" | "breakeven" | "gain";
  barFillPct: number;
}

export function buildAuditScenarioRows(
  effectiveReport: Pick<
    TruthReport,
    | "totalCost"
    | "zeroPayoutProb"
    | "partialLossProb"
    | "breakEvenProb"
    | "strictNetGainProb"
    | "anyWinProb"
    | "combos"
    | "tickets"
    | "matchCount"
  >,
  sortMode: ComboSortMode,
  options?: {
    matchCount?: number;
    defaultMultiple?: number;
    appliedLines?: PlanTicketLine[];
    pinZeroPayoutTop?: boolean;
  }
): AuditScenarioRow[] {
  const totalCost = Number(effectiveReport.totalCost) || 0;
  if (!(totalCost > 0)) return [];

  const rows: AuditScenarioRow[] = [];
  let pinnedZeroRow: AuditScenarioRow | null = null;
  const bucketSum =
    (effectiveReport.zeroPayoutProb ?? 0) +
    (effectiveReport.partialLossProb ?? 0) +
    (effectiveReport.breakEvenProb ?? 0) +
    (effectiveReport.strictNetGainProb ?? 0);
  const zeroProb =
    Math.abs(bucketSum - 1) < 1e-6
      ? Math.max(0, Number(effectiveReport.zeroPayoutProb) || 0)
      : Math.max(0, 1 - (Number(effectiveReport.anyWinProb) || 0));

  if (zeroProb > 1e-9) {
    const wipeoutNet = -Number(totalCost.toFixed(2));
    const zeroRow: AuditScenarioRow = {
      id: "__zero_payout_wipeout__",
      desc: options?.pinZeroPayoutTop
        ? `整单无中奖票（返奖 ¥0 · 损失本金 ¥${totalCost}）`
        : `全部未中（返奖 ¥0.00 · 损失全部本金 ¥${totalCost}）`,
      legs: [],
      prob: zeroProb,
      probText: formatAuditProbabilityPct(zeroProb),
      unitPayout: 0,
      totalPayout: 0,
      payout: 0,
      cappedClipped: 0,
      netProfit: wipeoutNet,
      isUnderwater: false,
      isZeroWipeoutRow: true,
      isZeroPayoutSummary: true,
      expandable: false,
      scenarioLabel: options?.pinZeroPayoutTop
        ? "整单无中奖票（返奖 ¥0）"
        : "全部未中",
      statusBadgeText: "整单归零(返奖¥0)",
      winningTicketCount: 0,
      winningTickets: [],
      roiMultiple: 0,
      barTone: "loss",
      barFillPct: 100,
    };
    if (options?.pinZeroPayoutTop) {
      pinnedZeroRow = zeroRow;
    } else {
      rows.push(zeroRow);
    }
  }

  const combos = Array.isArray(effectiveReport.combos)
    ? effectiveReport.combos.filter((c) => !c.isZeroPayoutSummary)
    : [];
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const bd = resolveComboTicketBreakdown(
      c,
      effectiveReport.tickets,
      totalCost,
      {
        matchCount: options?.matchCount ?? effectiveReport.matchCount,
        defaultMultiple: options?.defaultMultiple,
        appliedLines: options?.appliedLines,
      }
    );
    const statusBadgeText = c.isUnderwater
      ? "局部回血(<本金)"
      : Math.round(c.netProfit * 100) === 0
        ? "刚好保本"
        : `返奖 ${bd.roiMultiple}倍`;
    rows.push({
      ...c,
      isZeroWipeoutRow: false,
      expandable: bd.winningTicketCount > 0,
      probText: formatAuditProbabilityPct(c.prob),
      payout: c.totalPayout,
      scenarioLabel: bd.scenarioLabel,
      statusBadgeText,
      winningTicketCount: bd.winningTicketCount,
      winningTickets: bd.winningTickets,
      roiMultiple: bd.roiMultiple,
      barTone: bd.barTone,
      barFillPct: bd.barFillPct,
    });
  }

  if (sortMode === "loss-first") {
    rows.sort((a, b) => {
      const aLoss = a.isZeroWipeoutRow || a.isUnderwater || a.netProfit < 0;
      const bLoss = b.isZeroWipeoutRow || b.isUnderwater || b.netProfit < 0;
      if (aLoss !== bLoss) return aLoss ? -1 : 1;
      if (a.netProfit !== b.netProfit) return a.netProfit - b.netProfit;
      return b.prob - a.prob;
    });
    return pinnedZeroRow ? [pinnedZeroRow, ...rows] : rows;
  }
  if (sortMode === "prob-first") {
    rows.sort((a, b) => {
      if (b.prob !== a.prob) return b.prob - a.prob;
      return b.netProfit - a.netProfit;
    });
    return pinnedZeroRow ? [pinnedZeroRow, ...rows] : rows;
  }
  rows.sort((a, b) => {
    if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
    return b.prob - a.prob;
  });
  return pinnedZeroRow ? [pinnedZeroRow, ...rows] : rows;
}

export interface AuditCabinLifecycleState {
  selectionStatus: SelectionLifecycleStatus;
  distributionStatus: DistributionComputeStatus;
  ruleBlockReason: string | null;
}

export function resolveAuditCabinLifecycleState(
  manualDraft: Pick<ManualDraftState, "picks" | "passRuleBlockReason">,
  effectiveReport: TruthReport,
  activeSlip: ActiveAuditedSlip
): AuditCabinLifecycleState {
  const passRuleErr =
    !activeSlip.isAppliedPlan && !activeSlip.isAutoSynthetic
      ? manualDraft.passRuleBlockReason
      : null;
  if (
    effectiveReport.matchCount === 0 &&
    (effectiveReport.selectionStatus === "empty" ||
      (!effectiveReport.selectionStatus && manualDraft.picks.length === 0)) &&
    !passRuleErr
  ) {
    return {
      selectionStatus: "empty",
      distributionStatus: "none",
      ruleBlockReason: null,
    };
  }
  const overCap =
    effectiveReport.distributionStatus === "uncomputed-over-cap" ||
    (effectiveReport.basicExpandedCount ?? effectiveReport.betCount) > 2048;
  if (passRuleErr) {
    return {
      selectionStatus: "rule-blocked",
      distributionStatus: overCap ? "uncomputed-over-cap" : "none",
      ruleBlockReason: passRuleErr,
    };
  }
  if (
    effectiveReport.selectionStatus &&
    effectiveReport.selectionStatus !== "empty"
  ) {
    const dist: DistributionComputeStatus = overCap
      ? "uncomputed-over-cap"
      : effectiveReport.selectionStatus !== "ready"
        ? "none"
        : effectiveReport.distributionStatus &&
            effectiveReport.distributionStatus !== "none"
          ? effectiveReport.distributionStatus
          : "computed";
    return {
      selectionStatus: effectiveReport.selectionStatus,
      distributionStatus: dist,
      ruleBlockReason: effectiveReport.ruleBlockReason,
    };
  }
  if (!effectiveReport.canCheckout) {
    if (
      effectiveReport.matchCount === 1 &&
      !effectiveReport.hasSameMatchCrossPoolConflict
    ) {
      return {
        selectionStatus: "pending-single-auth",
        distributionStatus: overCap ? "uncomputed-over-cap" : "none",
        ruleBlockReason: effectiveReport.ruleBlockReason,
      };
    }
    return {
      selectionStatus: "rule-blocked",
      distributionStatus: overCap ? "uncomputed-over-cap" : "none",
      ruleBlockReason: effectiveReport.ruleBlockReason,
    };
  }
  return {
    selectionStatus: "ready",
    distributionStatus: overCap ? "uncomputed-over-cap" : "computed",
    ruleBlockReason: null,
  };
}

export interface AuditLayer1TicketItem {
  ticketNo: number;
  id: string;
  modeLabel: string;
  legsText: string;
  oddsProductText: string;
  multiple: number;
  stakeCost: number;
  singleHitPayout: number;
  matchPairKey: string;
  matchPairLabel: string;
}

export interface AuditLayer1TicketGroup {
  matchPairKey: string;
  matchPairLabel: string;
  ticketCount: number;
  subTotalCost: number;
  tickets: AuditLayer1TicketItem[];
}

export interface AuditLayer2BucketItem {
  key: "zero" | "partial" | "breakeven" | "gain";
  label: string;
  formulaLabel: string;
  prob: number;
  probText: string;
  widthPct: number;
  tone: "loss" | "warn" | "neutral" | "gain";
}

export interface AuditLayer3ZeroSummary {
  title: string;
  prob: number;
  probText: string;
  netLossYuan: number;
  splitSubline: string;
}

export interface AuditLayer3WinningScenario {
  id: string;
  desc: string;
  prob: number;
  probText: string;
  hitMatchCount: number;
  bucketKey: string;
  bucketLabel: string;
  hitTicketBadgesText: string;
  winningTickets: AttributedWinningTicket[];
  payout: number;
  netProfit: number;
  roiMultiple: number;
  returnSummaryText: string;
  statusBadgeText: string;
  barTone: "loss" | "breakeven" | "gain";
  barFillPct: number;
}

export interface AuditThreeLayerViewModel {
  layer1: {
    sourceBadge: string;
    equationText: string;
    matchCount: number;
    modeLabel: string;
    logicalLineCount: number;
    stakeUnitsCount: number;
    totalCost: number;
    physicalSlipCount: number;
    groups: AuditLayer1TicketGroup[];
    totalTicketCount: number;
  };
  layer2: {
    titleText: string;
    buckets: AuditLayer2BucketItem[];
    conditionalRangeText: string;
    objectiveEvPctText: string;
    expectedNetText: string;
    fiveZeroStreakText: string;
    fiveNoGainStreakText: string;
    avgVigLossPct: number;
    avgPayoutPctText: string;
  };
  layer3: {
    headerCountText: string;
    winningScenarioCount: number;
    pinnedZeroSummary: AuditLayer3ZeroSummary;
    scenarios: AuditLayer3WinningScenario[];
    hitBuckets: Array<{
      bucketKey: string;
      bucketLabel: string;
      count: number;
    }>;
  };
}

export function buildAuditThreeLayerViewModel(
  effectiveReport: TruthReport,
  activeSlip: ActiveAuditedSlip,
  appliedPlan: ArchetypePlan | null,
  defaultMultiple: number,
  sortMode: ComboSortMode = "prob-first"
): AuditThreeLayerViewModel {
  const totalCost = Math.max(0, Number(effectiveReport.totalCost) || 0);
  const sourceBadge =
    activeSlip.sourceKind === "archetype"
      ? `精算配单·${appliedPlan?.shortTab || "推荐"}`
      : activeSlip.sourceKind === "bonus-opt"
        ? "分倍优化"
        : activeSlip.sourceKind === "auto-synthetic"
          ? "跨池等价单关"
          : "我的手选";

  const ticketItems: AuditLayer1TicketItem[] = [];
  if (
    appliedPlan &&
    Array.isArray(appliedPlan.lines) &&
    appliedPlan.lines.length > 0
  ) {
    for (let i = 0; i < appliedPlan.lines.length; i++) {
      const ln = appliedPlan.lines[i];
      const legs = ln.legs ?? [];
      const pairKey = legs.map((g) => g.matchId).join("__") || `ln_${i + 1}`;
      const pairLabel =
        legs.length === 1
          ? `单关 · ${legs[0].matchNumStr} ${legs[0].home}`
          : legs.map((g) => `${g.matchNumStr} ${g.home}`).join(" × ");
      const legsText = legs
        .map(
          (g) =>
            `${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`
        )
        .join(" × ");
      const oddsProd = legs.reduce((p, g) => p * (Number(g.odds) || 1), 1);
      ticketItems.push({
        ticketNo: i + 1,
        id: ln.id || `tk_${i + 1}`,
        modeLabel:
          ln.modeLabel || (legs.length === 1 ? "单关" : `${legs.length}串1`),
        legsText,
        oddsProductText: `@${oddsProd.toFixed(2)}`,
        multiple: Math.max(1, Math.round(ln.multiple || 1)),
        stakeCost: ln.cost || Math.max(1, Math.round(ln.multiple || 1)) * 2,
        singleHitPayout: ln.returnPayout,
        matchPairKey: pairKey,
        matchPairLabel: pairLabel,
      });
    }
  } else if (
    Array.isArray(effectiveReport.tickets) &&
    effectiveReport.tickets.length > 0
  ) {
    const fallbackMult = Math.max(
      1,
      Math.round(defaultMultiple || effectiveReport.multiple || 1)
    );
    for (let i = 0; i < effectiveReport.tickets.length; i++) {
      const tk = effectiveReport.tickets[i];
      const legs = tk.legs ?? [];
      const pairKey =
        tk.matchPairKey ||
        legs.map((g) => g.matchId).join("__") ||
        `tk_${i + 1}`;
      const pairLabel =
        tk.matchPairLabel ||
        (legs.length === 1
          ? `单关 · ${legs[0].matchNumStr} ${legs[0].home}`
          : legs.map((g) => `${g.matchNumStr} ${g.home}`).join(" × "));
      const legsText =
        legs.length > 0
          ? legs
              .map(
                (g) =>
                  `${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`
              )
              .join(" × ")
          : tk.desc;
      const oddsProd =
        legs.length > 0
          ? legs.reduce((p, g) => p * (Number(g.odds) || 1), 1)
          : Math.max(1, tk.unitPayout / 2);
      const mult = Math.max(1, Math.round(tk.multiple ?? fallbackMult));
      ticketItems.push({
        ticketNo: tk.ticketNo ?? i + 1,
        id: tk.id || `tk_${i + 1}`,
        modeLabel: legs.length === 1 ? "单关" : `${legs.length}串1`,
        legsText,
        oddsProductText: `@${oddsProd.toFixed(2)}`,
        multiple: mult,
        stakeCost: tk.stakeCost ?? mult * 2,
        singleHitPayout: tk.totalPayout,
        matchPairKey: pairKey,
        matchPairLabel: pairLabel,
      });
    }
  }

  const groupMap = new Map<string, AuditLayer1TicketGroup>();
  for (const item of ticketItems) {
    let grp = groupMap.get(item.matchPairKey);
    if (!grp) {
      grp = {
        matchPairKey: item.matchPairKey,
        matchPairLabel: item.matchPairLabel,
        ticketCount: 0,
        subTotalCost: 0,
        tickets: [],
      };
      groupMap.set(item.matchPairKey, grp);
    }
    grp.ticketCount += 1;
    grp.subTotalCost += item.stakeCost;
    grp.tickets.push(item);
  }

  const logicalLineCount =
    effectiveReport.logicalLineCount ??
    (ticketItems.length > 0
      ? ticketItems.length
      : Math.max(1, effectiveReport.betCount));
  const stakeUnitsCount =
    effectiveReport.stakeUnitsCount ?? Math.max(1, Math.round(totalCost / 2));
  const physicalSlipCount =
    effectiveReport.physicalSlipCount ??
    (activeSlip.physicalSlips && activeSlip.physicalSlips.length > 0
      ? activeSlip.physicalSlips.length
      : Math.max(1, effectiveReport.consolidatedTickets || logicalLineCount));
  const equationText = `${effectiveReport.matchCount}场 · ${effectiveReport.modeLabel} · ${logicalLineCount}种基本票 · 共 ${stakeUnitsCount} 份2元注 = 应付 ¥${totalCost}（预计终端纸票 ${physicalSlipCount} 张）`;

  const { wipeoutProb, partialLossProb, breakEvenProb, strictGainProb } =
    resolveReportUnconditionalProbs(effectiveReport);

  const buckets: AuditLayer2BucketItem[] = [
    {
      key: "zero",
      label: "零返奖",
      formulaLabel: "P(R=0)",
      prob: wipeoutProb,
      probText: formatAuditProbabilityPct(wipeoutProb),
      widthPct: Math.max(0, Math.min(100, wipeoutProb * 100)),
      tone: "loss",
    },
    {
      key: "partial",
      label: "局部回血",
      formulaLabel: "P(0<R<C)",
      prob: partialLossProb,
      probText: formatAuditProbabilityPct(partialLossProb),
      widthPct: Math.max(0, Math.min(100, partialLossProb * 100)),
      tone: "warn",
    },
    {
      key: "breakeven",
      label: "平手返本",
      formulaLabel: "P(R=C)",
      prob: breakEvenProb,
      probText: formatAuditProbabilityPct(breakEvenProb),
      widthPct: Math.max(0, Math.min(100, breakEvenProb * 100)),
      tone: "neutral",
    },
    {
      key: "gain",
      label: "严格净赚",
      formulaLabel: "P(R>C)",
      prob: strictGainProb,
      probText: formatAuditProbabilityPct(strictGainProb),
      widthPct: Math.max(0, Math.min(100, strictGainProb * 100)),
      tone: "gain",
    },
  ];

  const minHit =
    effectiveReport.conditionalMinHitPayout ?? effectiveReport.minPayout ?? 0;
  const maxHit =
    effectiveReport.conditionalMaxHitPayout ?? effectiveReport.maxPayout ?? 0;
  const conditionalRangeText =
    Math.abs(minHit - maxHit) < 0.005
      ? `有票命中时返 ¥${minHit.toFixed(2)}`
      : `有票命中时返 ¥${minHit.toFixed(2)} ~ ¥${maxHit.toFixed(2)}`;
  const objEvRate = Number(effectiveReport.objectiveEVRate) || 0;
  const expectedNet = totalCost * objEvRate;
  const objectiveEvPctText = `${objEvRate >= 0 ? "+" : ""}${(objEvRate * 100).toFixed(1)}%`;
  const expectedNetText = `${expectedNet >= 0 ? "+" : "-"}¥${Math.abs(expectedNet).toFixed(2)}`;
  const fiveZeroProb = Math.pow(Math.max(0, Math.min(1, wipeoutProb)), 5);
  const fiveNoGainProb = Math.pow(
    Math.max(0, Math.min(1, 1 - strictGainProb)),
    5
  );

  const zeroHitRaw =
    typeof effectiveReport.zeroPayoutZeroHitProb === "number"
      ? effectiveReport.zeroPayoutZeroHitProb
      : effectiveReport.activePassSizes?.length === 1 &&
          effectiveReport.activePassSizes[0] === 1
        ? wipeoutProb
        : null;
  const subThreshRaw =
    typeof effectiveReport.zeroPayoutSubThresholdProb === "number"
      ? effectiveReport.zeroPayoutSubThresholdProb
      : zeroHitRaw !== null
        ? Math.max(0, wipeoutProb - zeroHitRaw)
        : null;
  const splitSubline =
    zeroHitRaw !== null && subThreshRaw !== null
      ? `全未中 ${formatAuditProbabilityPct(zeroHitRaw)} + 命中部分场次但未达过关/胆码条件 ${formatAuditProbabilityPct(subThreshRaw)}`
      : `全未中或部分命中未达【${effectiveReport.modeLabel}】过关/胆码门槛（合计 ${formatAuditProbabilityPct(wipeoutProb)}）`;

  const rawCombos = Array.isArray(effectiveReport.combos)
    ? effectiveReport.combos.filter((c) => !c.isZeroPayoutSummary)
    : [];
  const builtScenarios: AuditLayer3WinningScenario[] = rawCombos.map((c) => {
    const bd = resolveComboTicketBreakdown(
      c,
      effectiveReport.tickets,
      totalCost,
      {
        matchCount: effectiveReport.matchCount,
        defaultMultiple,
        appliedLines: appliedPlan?.lines,
      }
    );
    const hitM =
      typeof c.hitMatchCount === "number" && c.hitMatchCount > 0
        ? c.hitMatchCount
        : bd.legs.length;
    const totalM = Math.max(hitM, effectiveReport.matchCount || 1);
    const bucketKey = bd.isAggregateRange
      ? "agg"
      : hitM >= totalM
        ? `hit_${totalM}`
        : `hit_${hitM}`;
    const bucketLabel = bd.isAggregateRange
      ? "区间聚合"
      : hitM >= totalM
        ? `全中 (${totalM}场)`
        : `命中 ${hitM}/${totalM} 场`;
    const ticketNos =
      Array.isArray(c.hitTicketNos) && c.hitTicketNos.length > 0
        ? c.hitTicketNos
        : bd.winningTickets.map((wt) => wt.ticketNo);
    const hitTicketBadgesText =
      ticketNos.length > 0
        ? `命中实票 ${ticketNos
            .slice(0, 6)
            .map((n) => `#${n}`)
            .join(", ")}${
            ticketNos.length > 6 ? ` 等${ticketNos.length}张` : ""
          }`
        : bd.isAggregateRange
          ? "聚合派奖分位段"
          : "命中票归因";
    const netSign = c.netProfit >= 0 ? "+" : "-";
    const returnSummaryText = `返奖 ${bd.roiMultiple.toFixed(2)}倍 · 净利 ${netSign}¥${Math.abs(c.netProfit).toFixed(2)}`;
    const statusBadgeText = c.isUnderwater
      ? "局部回血(<本金)"
      : Math.round(c.netProfit * 100) === 0
        ? "平手返本"
        : `返奖 ${bd.roiMultiple.toFixed(2)}倍`;
    return {
      id: c.id,
      desc: c.desc,
      prob: c.prob,
      probText: formatAuditProbabilityPct(c.prob),
      hitMatchCount: hitM,
      bucketKey,
      bucketLabel,
      hitTicketBadgesText,
      winningTickets: bd.winningTickets,
      payout: c.totalPayout,
      netProfit: c.netProfit,
      roiMultiple: bd.roiMultiple,
      returnSummaryText,
      statusBadgeText,
      barTone: bd.barTone,
      barFillPct: bd.barFillPct,
    };
  });

  if (sortMode === "loss-first") {
    builtScenarios.sort((a, b) => {
      if (a.netProfit !== b.netProfit) return a.netProfit - b.netProfit;
      return b.prob - a.prob;
    });
  } else if (sortMode === "profit-first") {
    builtScenarios.sort((a, b) => {
      if (b.netProfit !== a.netProfit) return b.netProfit - a.netProfit;
      return b.prob - a.prob;
    });
  } else {
    builtScenarios.sort((a, b) => {
      if (b.prob !== a.prob) return b.prob - a.prob;
      return b.netProfit - a.netProfit;
    });
  }

  const bucketCountMap = new Map<
    string,
    { bucketLabel: string; count: number }
  >();
  for (const sc of builtScenarios) {
    const prev = bucketCountMap.get(sc.bucketKey);
    if (prev) prev.count += 1;
    else
      bucketCountMap.set(sc.bucketKey, {
        bucketLabel: sc.bucketLabel,
        count: 1,
      });
  }
  const hitBuckets = Array.from(bucketCountMap.entries()).map(
    ([bucketKey, val]) => ({
      bucketKey,
      bucketLabel: val.bucketLabel,
      count: val.count,
    })
  );

  const winningScenarioCount = Math.max(
    effectiveReport.comboCount || 0,
    builtScenarios.length
  );

  return {
    layer1: {
      sourceBadge,
      equationText,
      matchCount: effectiveReport.matchCount,
      modeLabel: effectiveReport.modeLabel,
      logicalLineCount,
      stakeUnitsCount,
      totalCost,
      physicalSlipCount,
      groups: Array.from(groupMap.values()),
      totalTicketCount: ticketItems.length,
    },
    layer2: {
      titleText: `📊 ② 四桶客观盈亏概率分布 · ¥${totalCost} 会发生什么`,
      buckets,
      conditionalRangeText,
      objectiveEvPctText,
      expectedNetText,
      fiveZeroStreakText: `连续 5 单全归零概率 p₀⁵ = ${formatAuditProbabilityPct(fiveZeroProb)}`,
      fiveNoGainStreakText: `连续 5 单未净赚概率 (1-p₊)⁵ = ${formatAuditProbabilityPct(fiveNoGainProb)}`,
      avgVigLossPct: effectiveReport.avgVigLossPer100,
      avgPayoutPctText: `${(effectiveReport.avgPayoutRatio * 100).toFixed(1)}%`,
    },
    layer3: {
      headerCountText: `${winningScenarioCount} 种中奖赛果情景 + 1 条零返奖汇总`,
      winningScenarioCount,
      pinnedZeroSummary: {
        title: "整单无中奖票（返奖 ¥0）",
        prob: wipeoutProb,
        probText: formatAuditProbabilityPct(wipeoutProb),
        netLossYuan: totalCost,
        splitSubline,
      },
      scenarios: builtScenarios,
      hitBuckets,
    },
  };
}

export interface PendingSingleCrossPoolCardSpec {
  key: string;
  preview: PartialCoveragePreview;
  poolTitle: string;
  legCount: number;
  legCountBadge: string;
  coverageBadge: string;
  isExactEquivalent: boolean;
  costYuan: number;
  payoutRangeText: string;
}

export function buildPendingSingleCrossPoolCards(
  manualReport: TruthReport,
  effectiveReport: TruthReport
): PendingSingleCrossPoolCardSpec[] {
  const rawList: PartialCoveragePreview[] = [];
  const primary =
    effectiveReport.partialCoveragePreview ??
    manualReport.partialCoveragePreview ??
    null;
  if (primary) rawList.push(primary);
  const extras =
    effectiveReport.crossPoolSingleAlternatives ??
    manualReport.crossPoolSingleAlternatives ??
    [];
  for (const ex of extras) {
    if (ex) rawList.push(ex);
  }
  const seen = new Set<string>();
  const out: PendingSingleCrossPoolCardSpec[] = [];
  for (const pv of rawList) {
    const legCount =
      pv.keptLegCount ??
      (Array.isArray(pv.previewLines) && pv.previewLines.length > 0
        ? pv.previewLines.length
        : pv.previewBetCount || 1);
    const sig = `${pv.poolCode}|${pv.isCrossPoolMixed ? "mix" : "pure"}|${legCount}|${pv.previewCost}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const retPct = (Math.max(0, pv.retainedDirectionRatio) * 100).toFixed(1);
    const withinMissRaw =
      typeof pv.withinDirectionMissRatio === "number"
        ? pv.withinDirectionMissRatio
        : Math.max(0, 1 - pv.retainedDirectionRatio);
    const withinMissPct = (Math.max(0, withinMissRaw) * 100).toFixed(1);
    const boardMissPct = formatAuditProbabilityPct(pv.blindSpotProb);
    const coverageBadge = pv.isExactEquivalent
      ? "100% 等价零死角"
      : `保 ${retPct}% · 同向漏 ${withinMissPct}%（占全场 ${boardMissPct}）`;
    const poolTitle = pv.isCrossPoolMixed
      ? `混合单关（${pv.poolName || "半全场+比分"}）`
      : `${pv.poolName || POOL_SHORT_SINGLE_NAMES[pv.poolCode]}替代`;
    out.push({
      key: sig,
      preview: pv,
      poolTitle,
      legCount,
      legCountBadge: `${legCount}项单关`,
      coverageBadge,
      isExactEquivalent: pv.isExactEquivalent,
      costYuan: pv.previewCost,
      payoutRangeText: `命中返 ¥${pv.previewMinPayout.toFixed(2)} ~ ¥${pv.previewMaxPayout.toFixed(2)}`,
    });
  }
  return out;
}

export interface HedgeDrawerCopy {
  drawerTitle: string;
  drawerSummary: string;
  badgeText: "仅减损" | "可对冲" | "沙盒";
  badgeTone: "warn" | "hi" | "neutral";
  rowHeader: string;
  lockedOutcomeText: string;
  lockedOutcomeColor: string;
}

export function formatHedgeDrawerCopy(
  hedge: StaggeredHedgePlan,
  totalCost: number
): HedgeDrawerCopy {
  const isReduceLoss = hedge.available && hedge.hedgeMode === "reduce-loss";
  const isBreakEven = hedge.available && hedge.hedgeMode === "break-even";

  const drawerTitle = isReduceLoss
    ? "⚠️ 早场红单减损补单 & 主观信心/腰斩沙盒"
    : isBreakEven
      ? "⚖️ 早晚场零损锁回本金 & 主观信心/腰斩沙盒"
      : "⏰ 早晚场对冲锁利 & 主观信心/腰斩沙盒";

  const drawerSummary = hedge.available
    ? isReduceLoss
      ? `早场红单减损补单：锁死少亏 -¥${Math.abs(hedge.lockedNetProfit).toFixed(2)}（间隔 ${hedge.gapText}）`
      : isBreakEven
        ? `零损锁回本金！${hedge.earlyKickoff} 串 ${hedge.lateKickoff}（间隔 ${hedge.gapText}）`
        : `可锁利 +¥${hedge.lockedNetProfit.toFixed(2)}！${hedge.earlyKickoff} 串 ${hedge.lateKickoff}（间隔 ${hedge.gapText}）`
    : `${hedge.reason} · 点此微调主观胜率或预演首场腰斩`;

  const rowHeader = isReduceLoss
    ? "⚠️ 早场红单减损补单（非正收益）"
    : isBreakEven
      ? "⚖️ 早晚场零损锁回本金"
      : "⏰ 早晚场时间差对冲锁利";

  const lockedOutcomeText =
    hedge.lockedNetProfit > 0
      ? `稳赚净利 +¥${hedge.lockedNetProfit.toFixed(2)}`
      : hedge.lockedNetProfit === 0
        ? `零损锁回本金 ¥${(totalCost + hedge.hedgeCost).toFixed(2)}`
        : `锁死少亏 -¥${Math.abs(hedge.lockedNetProfit).toFixed(2)}（拿回 ¥${(totalCost + hedge.hedgeCost + hedge.lockedNetProfit).toFixed(2)}）`;

  const lockedOutcomeColor =
    hedge.lockedNetProfit > 0
      ? "var(--good)"
      : hedge.lockedNetProfit === 0
        ? "var(--text)"
        : "var(--warn)";

  return {
    drawerTitle,
    drawerSummary,
    badgeText: hedge.available ? (isReduceLoss ? "仅减损" : "可对冲") : "沙盒",
    badgeTone: hedge.available ? (isReduceLoss ? "warn" : "hi") : "neutral",
    rowHeader,
    lockedOutcomeText,
    lockedOutcomeColor,
  };
}

export interface MatchRadarSingleBadgeSpec {
  isMainSingle: boolean;
  text: string;
  title: string;
  singlePoolCodes: PoolCode[];
}

function isViewModelPoolSingleOpen(pool?: MatchPool): boolean {
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

const POOL_SHORT_SINGLE_NAMES: Record<PoolCode, string> = {
  HAD: "胜平负",
  HHAD: "让球",
  TTG: "总进球",
  HAFU: "半全场",
  CRS: "比分",
};

export function buildMatchRadarSingleBadge(
  match: Pick<MatchItem, "pools">
): MatchRadarSingleBadgeSpec {
  const ordered: PoolCode[] = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
  const singlePoolCodes = ordered.filter((code) =>
    isViewModelPoolSingleOpen(match.pools?.[code])
  );
  const names = singlePoolCodes.map((c) => POOL_SHORT_SINGLE_NAMES[c]);
  if (singlePoolCodes.includes("HAD")) {
    return {
      isMainSingle: true,
      text: "单",
      title: `胜平负已开单关（可单关：${names.join("/")}）`,
      singlePoolCodes,
    };
  }
  if (singlePoolCodes.includes("HHAD")) {
    return {
      isMainSingle: true,
      text: "让单",
      title: `让球已开单关（可单关：${names.join("/")}）`,
      singlePoolCodes,
    };
  }
  if (singlePoolCodes.length > 0) {
    return {
      isMainSingle: false,
      text: `仅${names.join("/")}单关`,
      title: `可单关玩法：${names.join("/")}`,
      singlePoolCodes,
    };
  }
  return {
    isMainSingle: false,
    text: "仅限串关",
    title: "本场全部玩法均未开放单关",
    singlePoolCodes,
  };
}

export interface MatchRadarSubPoolPill {
  key: string;
  matchId: string;
  poolCode: "CRS" | "TTG" | "HAFU";
  poolShortName: string;
  optionKey: string;
  optionLabel: string;
  odds: number;
  text: string;
  clearAriaLabel: string;
}

export function buildMatchRadarSelectedSubPoolPills(
  match: Pick<MatchItem, "id" | "pools">,
  manualDraftPicks: SelectedPick[]
): MatchRadarSubPoolPill[] {
  if (
    !match ||
    !Array.isArray(manualDraftPicks) ||
    manualDraftPicks.length === 0
  ) {
    return [];
  }
  const pills: MatchRadarSubPoolPill[] = [];
  for (const pk of manualDraftPicks) {
    if (!pk || pk.matchId !== match.id) continue;
    if (
      pk.poolCode !== "CRS" &&
      pk.poolCode !== "TTG" &&
      pk.poolCode !== "HAFU"
    ) {
      continue;
    }
    const liveOpt = match.pools?.[pk.poolCode]?.options?.find(
      (o) => o.key === pk.optionKey
    );
    const odds = Number(liveOpt?.odds ?? pk.odds) || 0;
    const optionLabel = liveOpt?.label || pk.optionLabel || pk.optionKey;
    const poolShortName = POOL_SHORT_SINGLE_NAMES[pk.poolCode] || pk.poolName;
    pills.push({
      key: `${pk.matchId}:${pk.poolCode}:${pk.optionKey}`,
      matchId: pk.matchId,
      poolCode: pk.poolCode,
      poolShortName,
      optionKey: pk.optionKey,
      optionLabel,
      odds,
      text: `${poolShortName}·${optionLabel} @${odds.toFixed(2)}`,
      clearAriaLabel: `清除本场已选${poolShortName} ${optionLabel}`,
    });
  }
  return pills;
}

export function isPoolSingleOpenForRadar(pool?: MatchPool): boolean {
  if (!isViewModelPoolSingleOpen(pool)) return false;
  return Boolean(
    pool?.options?.some(
      (o) => Number.isFinite(Number(o.odds)) && Number(o.odds) >= 1.01
    )
  );
}

export interface MatchSingleSubPoolEntryPill {
  poolCode: "CRS" | "TTG" | "HAFU";
  label: string;
  minOddsText: string;
}

export function buildMatchSingleSubPoolEntryPills(
  match: Pick<MatchItem, "pools">
): MatchSingleSubPoolEntryPill[] {
  const defs: Array<{ code: "CRS" | "TTG" | "HAFU"; label: string }> = [
    { code: "CRS", label: "比分单关" },
    { code: "TTG", label: "总进球单关" },
    { code: "HAFU", label: "半全场单关" },
  ];
  const out: MatchSingleSubPoolEntryPill[] = [];
  for (const d of defs) {
    const pool = match.pools?.[d.code];
    if (!isPoolSingleOpenForRadar(pool)) continue;
    const validOdds = (pool?.options ?? [])
      .map((o) => Number(o.odds))
      .filter((n) => Number.isFinite(n) && n >= 1.01);
    if (validOdds.length === 0) continue;
    const minOdds = Math.min(...validOdds);
    out.push({
      poolCode: d.code,
      label: d.label,
      minOddsText: `@${minOdds.toFixed(2)}起`,
    });
  }
  return out;
}

export interface SyntheticModePillSpec {
  mode: SyntheticSingleMode;
  label: string;
}

export function buildSyntheticModePillSpecs(
  canTrim2Way: boolean,
  hasInherentBlindSpot = false,
  compactMobile = false,
  partialPreview?: PartialCoveragePreview | null,
  trimLegCount?: number
): SyntheticModePillSpec[] {
  const sp = compactMobile ? "" : " ";
  const trimCount =
    partialPreview?.trim2WayLegCount ??
    (typeof trimLegCount === "number" && trimLegCount > 0 ? trimLegCount : 2);
  const trimCostSuffix =
    typeof partialPreview?.trim2WayCost === "number" &&
    partialPreview.trim2WayCost > 0
      ? compactMobile
        ? `(¥${partialPreview.trim2WayCost})`
        : ` (¥${partialPreview.trim2WayCost})`
      : "";
  if (partialPreview?.requiresExplicitConfirm) {
    const retPct = (partialPreview.retainedDirectionRatio * 100).toFixed(1);
    const withinMissRaw =
      typeof partialPreview.withinDirectionMissRatio === "number"
        ? partialPreview.withinDirectionMissRatio
        : Math.max(0, 1 - partialPreview.retainedDirectionRatio);
    const withinMissPct = (withinMissRaw * 100).toFixed(1);
    const boardMissPct = formatAuditProbabilityPct(
      partialPreview.blindSpotProb
    );
    const legCnt =
      partialPreview.keptLegCount ??
      (partialPreview.previewLines?.length ||
        partialPreview.previewBetCount ||
        1);
    const previewLabel = partialPreview.isExactEquivalent
      ? compactMobile
        ? `⚠️核对${legCnt}项等价单关(¥${partialPreview.previewCost})`
        : `⚠️ 核对${legCnt}项等价单关（¥${partialPreview.previewCost} · 100%等价零死角）`
      : compactMobile
        ? `⚠️核对${legCnt}项(保${retPct}%·同向漏${withinMissPct}%·¥${partialPreview.previewCost})`
        : `⚠️ 核对${legCnt}项覆盖（保${retPct}%·同向漏${withinMissPct}%[全场${boardMissPct}]·¥${partialPreview.previewCost}）`;
    const list: SyntheticModePillSpec[] = [
      {
        mode: "partial-cover",
        label: previewLabel,
      },
    ];
    if (canTrim2Way) {
      list.push({
        mode: "trim-2way",
        label: `⚡${sp}${trimCount}项省本搏常规${trimCostSuffix}`,
      });
    }
    list.push({ mode: "off", label: `🌉${sp}搭1场过桥凑2串1` });
    return list;
  }
  const list: SyntheticModePillSpec[] = [
    {
      mode: "full-3way",
      label: hasInherentBlindSpot
        ? `🛡️${sp}常规比分覆盖`
        : `🛡️${sp}3项全包无死角`,
    },
  ];
  if (canTrim2Way) {
    list.push({
      mode: "trim-2way",
      label: `⚡${sp}${trimCount}项省本搏常规${trimCostSuffix}`,
    });
  }
  list.push({ mode: "off", label: `🌉${sp}搭1场过桥凑2串1` });
  return list;
}

export function formatBetBarPayoutSummary(
  effectiveReport: Pick<
    TruthReport,
    | "matchCount"
    | "canCheckout"
    | "ruleBlockReason"
    | "underwaterCount"
    | "minPayout"
    | "maxPayout"
    | "objectiveStrictNetGainProb"
    | "isUnconditionalFloorGuaranteed"
  >,
  variant: "desktop" | "mobile"
): string {
  const isUncond = Boolean(effectiveReport.isUnconditionalFloorGuaranteed);
  if (variant === "desktop") {
    if (effectiveReport.matchCount === 0) {
      return "在左栏【赛事雷达】点选赔率，随时调整过关方式与倍数";
    }
    if (!effectiveReport.canCheckout) {
      return effectiveReport.ruleBlockReason || "未开单关 · 还差 1 场凑 2串1";
    }
    if (effectiveReport.underwaterCount > 0) {
      return `命中最低 ¥${effectiveReport.minPayout.toFixed(2)} ~ 最高 ¥${effectiveReport.maxPayout.toFixed(2)} · ⚠️ ${effectiveReport.underwaterCount}组局部回血 · 净赚率 ${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(1)}%`;
    }
    const prefix = isUncond ? "真实保底" : "命中最低";
    return `${prefix} ¥${effectiveReport.minPayout.toFixed(2)} ~ 最高 ¥${effectiveReport.maxPayout.toFixed(2)} · 严格净赚 ${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(1)}%`;
  }

  if (effectiveReport.matchCount === 0) {
    return "第一步：点选心仪球队赔率定方向";
  }
  if (!effectiveReport.canCheckout) {
    return effectiveReport.ruleBlockReason || "未开单关·还差1场凑2串1";
  }
  if (effectiveReport.underwaterCount > 0) {
    return `⚠️${effectiveReport.underwaterCount}注局部回血 · 建议去②配单消坑`;
  }
  const mobilePrefix = isUncond ? "真实保底" : "命中最低";
  return `${mobilePrefix}¥${effectiveReport.minPayout.toFixed(0)}~${effectiveReport.maxPayout.toFixed(0)} · 净赚${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(0)}%`;
}

export interface DockBridgeStripItemSpec {
  candKey: string;
  isConfirming: boolean;
  step1Label: string;
  confirmLabel: string;
  cancelLabel: string;
}

export function buildDockBridgeStripItemSpec(
  cand: BridgeMatchCandidate,
  preview: BridgeMatchPreview | null,
  opts: {
    variant: "desktop" | "mobile";
    confirmingKey: string | null;
  }
): DockBridgeStripItemSpec {
  const candKey = `${cand.kind}-${cand.matchId}-${cand.poolCode}-${cand.optionKey}`;
  const isConfirming = opts.confirmingKey === candKey;
  const costSuffix = preview
    ? opts.variant === "desktop"
      ? ` · 共${preview.previewBetCount}注 ¥${preview.previewTotalCost}`
      : `·共${preview.previewBetCount}注 ¥${preview.previewTotalCost}`
    : opts.variant === "desktop"
      ? " · 预览凑2串1"
      : "·预览凑2串1";
  const step1Label =
    opts.variant === "desktop"
      ? `${cand.kind === "lowest-vig" ? "🛡️最低抽水" : "⏰时间差锁利"} · ${cand.matchNumStr.slice(-3)}${cand.home}[${cand.optionLabel}@${cand.odds.toFixed(2)}]${costSuffix}`
      : `${cand.kind === "lowest-vig" ? "🛡️低抽水" : "⏰时间差"}·${cand.matchNumStr.slice(-3)}${cand.home}[${cand.optionLabel}@${cand.odds.toFixed(2)}]${costSuffix}`;
  const confirmLabel = preview
    ? `确认加场 (共${preview.previewBetCount}注·¥${preview.previewTotalCost})`
    : "确认加场";
  return {
    candKey,
    isConfirming,
    step1Label,
    confirmLabel,
    cancelLabel: "取消",
  };
}

export function resolveCompactAuditBarPrimaryAction(
  effectiveReport: Pick<TruthReport, "canCheckout"> &
    Partial<
      Pick<TruthReport, "partialCoveragePreview" | "isExactSyntheticEquivalent">
    >,
  gates: {
    isSyntheticPlayable: boolean;
    showBridgeFinder: boolean;
    partialCoveragePreview?: PartialCoveragePreview | null;
  },
  bridgeCandidates: BridgeMatchCandidate[],
  options?: {
    confirmingPartial?: boolean;
    bridgePreview?: BridgeMatchPreview | null;
    confirmingBridge?: boolean;
  }
): {
  kind:
    | "poster"
    | "synthetic"
    | "partial-preview"
    | "partial-confirm"
    | "bridge"
    | "bridge-preview"
    | "bridge-confirm"
    | "go-match";
  label: string;
  disclosureText?: string;
} {
  if (effectiveReport.canCheckout) {
    return { kind: "poster", label: "打票核对" };
  }
  if (gates.isSyntheticPlayable && !gates.showBridgeFinder) {
    const preview =
      gates.partialCoveragePreview ??
      effectiveReport.partialCoveragePreview ??
      null;
    if (
      preview &&
      (preview.requiresExplicitConfirm ||
        !preview.isExactEquivalent ||
        effectiveReport.isExactSyntheticEquivalent === false)
    ) {
      const retPct = (preview.retainedDirectionRatio * 100).toFixed(1);
      const withinMissRaw =
        typeof preview.withinDirectionMissRatio === "number"
          ? preview.withinDirectionMissRatio
          : Math.max(0, 1 - preview.retainedDirectionRatio);
      const withinMissPct = (withinMissRaw * 100).toFixed(1);
      const boardMissPct =
        preview.blindSpotProb >= 0.01
          ? `${(preview.blindSpotProb * 100).toFixed(1)}%`
          : `${(preview.blindSpotProb * 100).toFixed(2)}%`;
      const disclosureText = preview.isExactEquivalent
        ? `等价0%漏·实投¥${preview.previewCost}`
        : `保${retPct}%·同向漏${withinMissPct}%(全场${boardMissPct})·¥${preview.previewCost}`;
      if (options?.confirmingPartial) {
        return {
          kind: "partial-confirm",
          label: preview.isExactEquivalent
            ? `核对超额票行 ¥${preview.previewCost}`
            : `核对部分覆盖票行 ¥${preview.previewCost}`,
          disclosureText,
        };
      }
      return {
        kind: "partial-preview",
        label: preview.isExactEquivalent
          ? `超额等价预览 ¥${preview.previewCost}`
          : `部分覆盖预览 ¥${preview.previewCost}·同向漏${withinMissPct}%(全场${boardMissPct})`,
        disclosureText,
      };
    }
    return { kind: "synthetic", label: "核对合成票行" };
  }
  if (gates.showBridgeFinder && bridgeCandidates[0]) {
    const bp = options?.bridgePreview ?? null;
    if (bp) {
      const disclosureText = `${bp.matchNumStr.slice(-3)}${bp.optionLabel}@${bp.odds.toFixed(2)} · 共${bp.previewBetCount}注 ¥${bp.previewTotalCost}`;
      if (options?.confirmingBridge) {
        return {
          kind: "bridge-confirm",
          label: `确认凑2串1 ¥${bp.previewTotalCost}`,
          disclosureText,
        };
      }
      return {
        kind: "bridge-preview",
        label: `🌉凑2串1(${bp.previewBetCount}注·¥${bp.previewTotalCost})`,
        disclosureText,
      };
    }
    return { kind: "bridge", label: "🌉一键凑2串1" };
  }
  return { kind: "go-match", label: "去凑场次" };
}

export function formatPaceCorrelationTileLabel(mq: MatchMicroQuant): string {
  const sign = mq.paceCorrelation >= 0 ? "+" : "";
  return `比赛节奏相关性 · ${mq.paceLabel}（低比分联动修正系数 ρ=${sign}${mq.paceCorrelation.toFixed(2)}）`;
}

export function normalizeComboResidualRisks(
  residualRisks?: string[] | string | null
): string[] {
  if (Array.isArray(residualRisks)) return residualRisks;
  if (residualRisks) return [residualRisks];
  return [];
}

export interface LedgerEntryPresentation {
  isLive: boolean;
  cardToneClass: "is-live" | "is-paper";
  stampLabel: string;
  badgeText: string;
  badgeCls: string;
  defaultWinReturn: number;
  resolvedDetail: LedgerSettlementDetail | null;
}

export function buildLedgerEntryPresentation(
  it: LedgerEntry
): LedgerEntryPresentation {
  const isLive = it.kind === "live";
  const detail = it.settlementDetail;
  const resolvedDetail: LedgerSettlementDetail | null =
    detail ??
    (it.snapshot?.lines?.length
      ? {
          status: it.status,
          settledReturn: it.settledReturn,
          netProfit: it.netProfit,
          hitTicketCount: 0,
          totalTicketCount: it.snapshot.lines.length,
          hitMatchCount: 0,
          settledMatchCount: 0,
          totalMatchCount: it.snapshot.matches.length,
          earlyEliminated: false,
          lockedFloorReturn: 0,
          progressSummary: `已封存 ${it.snapshot.matches.length} 场 / ${it.snapshot.lines.length} 张实票`,
          liveEarlyHedge: null,
          matches: it.snapshot.matches.map((sm) => ({
            matchId: sm.matchId,
            matchNumStr: sm.matchNumStr,
            home: sm.home,
            away: sm.away,
            kickoff: sm.kickoff,
            goalLine: sm.goalLine,
            isBanker: Boolean(sm.isBanker),
            state: "pending" as const,
            halfScore: "",
            fullScore: "",
            picks: sm.picks.map((pk) => ({
              poolCode: pk.poolCode,
              optionKey: pk.optionKey,
              optionLabel: pk.optionLabel,
              odds: pk.odds,
              state: "pending" as const,
            })),
          })),
          tickets: it.snapshot.lines.map((ln) => ({
            id: ln.id,
            modeLabel: ln.modeLabel,
            multiple: ln.multiple,
            cost: ln.multiple * 2,
            status: "pending" as const,
            payout: 0,
            legs: ln.legs.map((lg) => ({
              matchId: lg.matchId,
              matchNumStr: lg.matchNumStr || lg.matchId,
              home: lg.home || "",
              away: lg.away || "",
              poolCode: lg.poolCode,
              optionKey: lg.optionKey,
              optionLabel: lg.optionLabel || lg.optionKey,
              odds: lg.odds,
              state: "pending" as const,
            })),
          })),
        }
      : null);

  const defaultWinReturn =
    it.settledReturn > 0
      ? it.settledReturn
      : it.minPayout > 0
        ? it.minPayout
        : it.maxPayout > 0
          ? it.maxPayout
          : it.cost;

  let badgeText =
    detail?.settledMatchCount && it.status === "pending"
      ? `⚡已红${detail.hitMatchCount}/${detail.totalMatchCount}场`
      : "⏳待开奖";
  let badgeCls = "ledger-badge num";
  if (it.status === "won") {
    if (isLive) {
      badgeText =
        it.netProfit > 0
          ? `🔴红单 +¥${it.netProfit.toFixed(2)}`
          : "⚖️刚回本 ¥0.00";
      badgeCls = "ledger-badge num won";
    } else {
      badgeText =
        it.settledReturn > 0
          ? `🎯模拟命中 (拟派¥${it.settledReturn.toFixed(2)})`
          : "🎯模拟命中(未实买)";
      badgeCls = "ledger-badge num won";
    }
  } else if (it.status === "partial") {
    if (isLive) {
      badgeText = `⚠️局部回血 -¥${Math.abs(it.netProfit).toFixed(2)} (派¥${it.settledReturn.toFixed(2)})`;
      badgeCls = "ledger-badge num partial";
    } else {
      const savedNet = Math.max(0, it.paperRefCost - it.settledReturn);
      badgeText = `🛡️模拟局部回血 · 少亏¥${savedNet.toFixed(0)}`;
      badgeCls = "ledger-badge num partial";
    }
  } else if (it.status === "lost") {
    if (isLive) {
      badgeText = `⚫黑单 -¥${it.cost.toFixed(2)}`;
      badgeCls = "ledger-badge num lost";
    } else {
      badgeText = `🛡️未中免损 ¥${it.paperRefCost.toFixed(0)}`;
      badgeCls = "ledger-badge num saved";
    }
  }

  return {
    isLive,
    cardToneClass: isLive ? "is-live" : "is-paper",
    stampLabel: isLive ? "💰 实买出票" : "🧪 模拟未买",
    badgeText,
    badgeCls,
    defaultWinReturn,
    resolvedDetail,
  };
}

export function formatLedgerStatsSummary(stats: UserLedgerSnapshot["stats"]): {
  netProfitText: string;
  netProfitColor?: string;
  winRateText: string;
  winRateSub: string;
  paperSavedText: string;
  paperSavedColor?: string;
  paperSavedSub: string;
} {
  const netProfitText =
    stats.liveNetProfit > 0
      ? `+¥${stats.liveNetProfit.toFixed(2)}`
      : stats.liveNetProfit < 0
        ? `-¥${Math.abs(stats.liveNetProfit).toFixed(2)}`
        : "¥0.00";
  const netProfitColor =
    stats.liveNetProfit > 0
      ? "var(--good)"
      : stats.liveNetProfit < 0
        ? "var(--live)"
        : undefined;
  const partialSuffix =
    (stats.livePartialCount ?? 0) > 0
      ? ` · 另${stats.livePartialCount}回血`
      : "";
  const paperLossTotal =
    (stats.paperLostCount ?? 0) + (stats.paperPartialCount ?? 0);

  return {
    netProfitText,
    netProfitColor,
    winRateText: `${stats.liveWinRatePct.toFixed(1)}%`,
    winRateSub: `真红单率 (${stats.liveWonCount}/${stats.liveSettledCount}${partialSuffix})`,
    paperSavedText: `¥${stats.paperSavedAmount.toFixed(0)}`,
    paperSavedColor: stats.paperSavedAmount > 0 ? "var(--good)" : undefined,
    paperSavedSub: `模拟免损 (${paperLossTotal}亏/${stats.paperWonCount ?? 0}中)`,
  };
}

export interface PosterSlipRowSpec {
  key: string;
  checkKey: string;
  left: string;
  right: string;
}

export function buildPosterSlipRows(
  report: TruthReport,
  matches: MatchItem[],
  boardMeta: BoardFreshnessMeta | null | undefined,
  activeBankerSet: Set<string>,
  quoteVersionSig = "v1",
  physicalSlips = report.physicalSlips ?? []
): PosterSlipRowSpec[] {
  if (getPhysicalTicketBlockReason(matches, boardMeta, report, physicalSlips))
    return [];
  return physicalSlips.map((ps) => {
    const left = ps.legsByMatch
      .map((g) => {
        const optsTxt = g.options.map((o) => o.optionLabel).join("/");
        return `${g.isBanker || activeBankerSet.has(g.matchId) ? "📌【胆】" : ""}${g.matchNumStr.slice(-3)}${g.home}[${optsTxt}]`;
      })
      .join("×");
    const unitsSuffix =
      ps.basicUnitsPerSlip > 1 ? `(${ps.basicUnitsPerSlip}注)` : "";
    const right = `${ps.modeLabel}${unitsSuffix} · ${ps.multiple}倍 (¥${ps.costYuan})`;
    return {
      key: ps.slipId,
      checkKey: `${quoteVersionSig}:${ps.lineSignature}:${ps.slipId}:${ps.multiple}:${ps.costYuan}`,
      left,
      right,
    };
  });
}
