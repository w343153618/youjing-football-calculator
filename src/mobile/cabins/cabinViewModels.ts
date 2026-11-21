import {
  SUBJECTIVE_DELTA_MAX,
  SUBJECTIVE_DELTA_MIN,
  type AppliedPlanSpec,
  type ArchetypePlan,
  type BridgeMatchCandidate,
  type LedgerSettlementDetail,
  type MatchMicroQuant,
  type PortfolioKey,
  type ProOrderInsights,
  type SelectedPick,
  type StaggeredHedgePlan,
  type SyntheticSingleMode,
  type TruthReport,
} from "../../prototype/quantTypes.ts";
import type {
  LedgerEntry,
  UserLedgerSnapshot,
} from "../../security/secureClient.ts";
import {
  splitTerminalPosterSlips,
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
  ["drop", "🔻急降水"],
  ["arb", "省钱差价"],
];

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

export function buildPortfolioKpiTiles(plan: ArchetypePlan): {
  groupTicket: PortfolioGroupTicketMetric;
  tile1: KpiTileModel;
  tile2: KpiTileModel;
  tile3: KpiTileModel;
  tile4: KpiTileModel;
} {
  const objStrictPct =
    (plan.objectiveStrictNetGainProb ??
      plan.strictNetGainProb ??
      plan.profitProb) * 100;
  const objProfitPct = (plan.objectiveProfitProb ?? plan.profitProb) * 100;
  const archObjBreakEvenPct = Math.max(0, objProfitPct - objStrictPct);
  const archSubjProfitPct =
    plan.subjectiveProjectedProfitProb != null
      ? plan.subjectiveProjectedProfitProb * 100
      : null;
  const subParts: string[] = [];
  if (archObjBreakEvenPct >= 0.05) {
    subParts.push(`另含 ${archObjBreakEvenPct.toFixed(1)}% 刚回本`);
  }
  if (archSubjProfitPct !== null) {
    subParts.push(`个人推演 ${archSubjProfitPct.toFixed(1)}%`);
  }
  subParts.push(`命中 ${(plan.winProb * 100).toFixed(1)}%`);

  const uwCount = plan.underwaterCount ?? 0;
  const archObjEvPct = (plan.objectiveEVRate ?? plan.expectedValueRate) * 100;
  const archSubjEvPct =
    plan.subjectiveProjectedEVRate != null
      ? plan.subjectiveProjectedEVRate * 100
      : null;
  const payoutReturnPct = Math.max(0, 100 - plan.vigPct).toFixed(1);
  const groupTicket = formatPortfolioGroupAndTicketMetric(plan);

  return {
    groupTicket,
    tile1: {
      label: "严格净赚率",
      value: `${objStrictPct.toFixed(1)}%`,
      subtitle: subParts.join(" · "),
    },
    tile2: {
      label: plan.missOneReturn !== null ? "错1场保命回血" : "命中返奖区间",
      value:
        plan.missOneReturn !== null
          ? `¥${plan.missOneReturn.toFixed(0)} (全中¥${plan.maxReturn.toFixed(0)})`
          : `¥${plan.minReturn.toFixed(0)}~${plan.maxReturn.toFixed(0)}`,
      subtitle:
        uwCount > 0 ? `⚠️ 含 ${uwCount} 组局部回血(<本金)` : "0 假中奖倒贴",
      isDanger: uwCount > 0,
    },
    tile3: {
      label: "客观数学期望与抽水",
      value: `${archObjEvPct >= 0 ? "+" : ""}${archObjEvPct.toFixed(1)}%`,
      subtitle:
        archSubjEvPct !== null
          ? `个人推演 ${archSubjEvPct >= 0 ? "+" : ""}${archSubjEvPct.toFixed(1)}% · 返${payoutReturnPct}%`
          : `票面返还 ${payoutReturnPct}%`,
    },
    tile4: {
      label: groupTicket.tileLabel,
      value: groupTicket.summary,
      subtitle: groupTicket.subtitle,
    },
  };
}

export function buildAuditCockpitTiles(
  effectiveReport: TruthReport,
  insights: ProOrderInsights
): {
  tile1: KpiTileModel;
  tile2: KpiTileModel;
  tile3: KpiTileModel;
  tile4: KpiTileModel;
} {
  const objBePct = Math.max(
    0,
    (effectiveReport.objectiveProfitProb -
      effectiveReport.objectiveStrictNetGainProb) *
      100
  );
  const parts: string[] = [];
  if (objBePct >= 0.05) {
    parts.push(`另含 ${objBePct.toFixed(1)}% 刚回本`);
  }
  if (effectiveReport.subjectiveProjectedProfitProb != null) {
    parts.push(
      `个人推演 ${(effectiveReport.subjectiveProjectedProfitProb * 100).toFixed(1)}%`
    );
  }

  const kellyNote =
    effectiveReport.objectiveEVRate <= 0
      ? `凯利0%·娱乐≤${insights.recommendedBankrollPct}%`
      : `凯利仓≤${insights.recommendedBankrollPct}%`;
  const streakOrSubj =
    effectiveReport.subjectiveProjectedEVRate != null
      ? `个人推演EV ${effectiveReport.subjectiveProjectedEVRate >= 0 ? "+" : ""}${(effectiveReport.subjectiveProjectedEVRate * 100).toFixed(1)}% · `
      : `连黑5次 ${(insights.fiveLossStreakProb * 100).toFixed(0)}% · `;

  return {
    tile1: {
      label: "真实保底奖金",
      value: `¥${effectiveReport.minPayout.toFixed(2)}`,
      subtitle: `官网虚高 ¥${effectiveReport.maxPayout.toFixed(2)}`,
      isDanger: effectiveReport.minPayout < effectiveReport.totalCost,
      strikeSubtitle: true,
    },
    tile2: {
      label: "严格净赚率 vs 命中率",
      value: `${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(1)}% / ${(effectiveReport.anyWinProb * 100).toFixed(1)}%`,
      subtitle: parts.length > 0 ? parts.join(" · ") : "客观净利>0 才算真赚",
    },
    tile3: {
      label: "假中奖倒贴检测",
      value:
        effectiveReport.underwaterCount > 0
          ? `${effectiveReport.underwaterCount}/${effectiveReport.comboCount} 组亏钱`
          : "0 假中奖",
      subtitle:
        effectiveReport.underwaterCount > 0
          ? `占中奖率 ${(effectiveReport.underwaterShareOfWins * 100).toFixed(0)}%`
          : "命中任一组均盈利",
      isDanger: effectiveReport.underwaterCount > 0,
    },
    tile4: {
      label: "危险分与客观期望",
      value: `${effectiveReport.dangerScore}分 · ${effectiveReport.objectiveEVRate >= 0 ? "+" : ""}${(effectiveReport.objectiveEVRate * 100).toFixed(1)}%`,
      subtitle: `${streakOrSubj}${kellyNote}`,
    },
  };
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

export interface SyntheticModePillSpec {
  mode: SyntheticSingleMode;
  label: string;
}

export function buildSyntheticModePillSpecs(
  canTrim2Way: boolean,
  hasInherentBlindSpot = false,
  compactMobile = false
): SyntheticModePillSpec[] {
  const sp = compactMobile ? "" : " ";
  const list: SyntheticModePillSpec[] = [
    {
      mode: "full-3way",
      label: hasInherentBlindSpot
        ? `🛡️${sp}常规比分覆盖`
        : `🛡️${sp}3项全包无死角`,
    },
  ];
  if (canTrim2Way) {
    list.push({ mode: "trim-2way", label: `⚡${sp}2项省本搏常规` });
  }
  list.push({ mode: "off", label: `🌉${sp}搭1场过桥凑2串1` });
  return list;
}

export function resolveCompactAuditBarPrimaryAction(
  effectiveReport: Pick<TruthReport, "canCheckout">,
  gates: { isSyntheticPlayable: boolean; showBridgeFinder: boolean },
  bridgeCandidates: BridgeMatchCandidate[]
): {
  kind: "poster" | "synthetic" | "bridge" | "go-match";
  label: string;
} {
  if (effectiveReport.canCheckout) {
    return { kind: "poster", label: "打票核对" };
  }
  if (gates.isSyntheticPlayable && !gates.showBridgeFinder) {
    return { kind: "synthetic", label: "一键合成单关" };
  }
  if (gates.showBridgeFinder && bridgeCandidates[0]) {
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

export function buildPosterSlipRows(
  effectiveReport: TruthReport,
  effectiveAppliedPlan: ArchetypePlan | null,
  planSpec: AppliedPlanSpec,
  picks: SelectedPick[],
  multiple: number,
  activeBankerSet: Set<string>
): Array<{ key: string; left: string; right: string }> {
  if (effectiveAppliedPlan) {
    const sourceLines =
      planSpec?.consolidateTickets &&
      Array.isArray(effectiveAppliedPlan.consolidatedLines) &&
      effectiveAppliedPlan.consolidatedLines.length > 0
        ? effectiveAppliedPlan.consolidatedLines
        : effectiveAppliedPlan.lines;
    return sourceLines.flatMap((l) => {
      const left = l.legs
        .map(
          (g) =>
            `${activeBankerSet.has(g.matchId) ? "📌【胆】" : ""}${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}]`
        )
        .join("×");
      return splitTerminalPosterSlips(
        l.id,
        left,
        l.modeLabel,
        l.multiple,
        l.cost
      );
    });
  }
  if (effectiveReport.tickets && effectiveReport.tickets.length > 0) {
    return effectiveReport.tickets.flatMap((tk) => {
      const left = (tk.legs ?? [])
        .map(
          (g) =>
            `${activeBankerSet.has(g.matchId) ? "📌【胆】" : ""}${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}]`
        )
        .join("×");
      const passTxt =
        (tk.legs?.length ?? 1) === 1
          ? "单关"
          : `${tk.legs?.length}串1${activeBankerSet.size > 0 ? `(${activeBankerSet.size}胆)` : ""}`;
      return splitTerminalPosterSlips(tk.id, left, passTxt, multiple);
    });
  }
  return picks.map((p) => ({
    key: `${p.matchId}-${p.poolCode}-${p.optionKey}`,
    left: `${activeBankerSet.has(p.matchId) ? "📌【胆】" : ""}${p.matchNumStr} ${p.home}vs${p.away}`,
    right: `${p.poolName}[${p.optionLabel}] × ${multiple}倍`,
  }));
}
