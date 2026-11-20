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
  type MatchItem,
  type PassSelectionSpec,
  type PlanTicketLine,
  type PoolCode,
  type PortfolioKey,
  type QuantWorkspaceParams,
  type QuantWorkspaceResponse,
  type SelectedPick,
  type UserStance,
} from "../prototype/quantTypes.ts";

export type MatchMode = "mix" | "spf" | "bf" | "zjq" | "bqc" | "single";
export type PresetScenarioKind =
  "underwater" | "synthetic" | "parlay4" | "hedge2";

export type ManualSectionId =
  | "qa"
  | "quickstart"
  | "sandbox"
  | "optimizer"
  | "archetypes"
  | "glossary"
  | "hedge"
  | "xiaogao";

export interface ManualTopic {
  id: ManualSectionId;
  shortTitle: string;
  badge: string;
  title: string;
  subtitle: string;
  keywords: string[];
}

export const MANUAL_TOPICS: ManualTopic[] = [
  {
    id: "qa",
    shortTitle: "💬 智能提问",
    badge: "00 · 说明书专属问答助手",
    title: "看不懂某个按钮或名词？直接点选或输入提问",
    subtitle:
      "100% 基于本计算器真实功能通俗举例作答（仅限说明书范畴，严禁探底与无关闲聊）",
    keywords: ["提问", "问答", "不懂", "怎么用", "什么意思", "助手"],
  },
  {
    id: "quickstart",
    shortTitle: "快速上手&箭头",
    badge: "01 · 1-2-3三步向导与盘面符号",
    title: "30 秒看懂「优竞体育内部专用」1-2-3 精算闭环与红绿箭头",
    subtitle:
      "从①选球定方向、②精算配单、③审单锁利，看懂红升 ▲ 绿降 ▼ 箭头与去水真率",
    keywords: [
      "入门",
      "流程",
      "1-2-3",
      "三步",
      "向导",
      "同步",
      "红绿箭头",
      "红箭头",
      "绿箭头",
      "单关",
      "混合过关",
      "卡盘",
      "设胆",
      "胆拖",
      "过桥",
      "配菜",
    ],
  },
  {
    id: "sandbox",
    shortTitle: "滑块沙盒&6仪表",
    badge: "02 · 每一个滑块与数字逐个拆解",
    title: "主观胜率滑块往左拉还是往右拉？五维透视舱 6 块仪表怎么读？",
    subtitle:
      "手把手拆解客观严格净赚率、刚回本率、个人推演对照、首场腰斩按 1.0 预演与六大核心指标",
    keywords: [
      "主观胜率",
      "信心微调",
      "沙盒",
      "往左拉",
      "往右拉",
      "EV",
      "期望",
      "严格净赚率",
      "刚回本",
      "客观真账",
      "腰斩",
      "延期",
      "1.0",
      "五维",
      "危险分",
      "保底奖金",
      "一球",
      "小胜",
    ],
  },
  {
    id: "optimizer",
    shortTitle: "三种奖金优化",
    badge: "03 · 核心分倍引擎详解",
    title: "平均优化 / 博热保本 / 博冷高弹到底怎么分钱？我该选哪个？",
    subtitle:
      "严守预算主权不暗涨本金 · 最低保本门槛一键升级 · 智能合票减张防店面拒打滑点",
    keywords: [
      "平均优化",
      "博热保本",
      "博冷高弹",
      "奖金优化",
      "分倍",
      "等倍",
      "假中奖",
      "保本",
      "最低保本门槛",
      "合票减张",
    ],
  },
  {
    id: "archetypes",
    shortTitle: "3+1精算配单",
    badge: "04 · 帕累托精算配单矩阵",
    title: "自由圈定 1～8 场心仪比赛后，3+1 精算配单四档方案分别适合什么战况？",
    subtitle:
      "稳健保本 · 期望效用 · 容错缩水（旋转矩阵） · 错价雷达（宁缺毋滥·无洼地空仓）",
    keywords: [
      "精算配单",
      "3+1",
      "五流派",
      "8场",
      "多场",
      "稳健保本",
      "期望效用",
      "容错缩水",
      "旋转矩阵",
      "错价雷达",
      "空仓",
      "36%",
      "轻仓",
      "10元",
      "预算",
      "直觉倾向",
      "偏主队",
      "防爆冷",
    ],
  },
  {
    id: "glossary",
    shortTitle: "精算名词词典",
    badge: "05 · 专有名词大白话图解",
    title:
      "Shin+五池联合校准、返还率、泊松xG、一球卡盘、同义差价、合成单关全解",
    subtitle: "把跨盘联合校准与体彩精算数学翻译成菜市场算账一样直白的图文案例",
    keywords: [
      "Shin",
      "五池联合校准",
      "跨盘联合校准",
      "比赛节奏",
      "返还率",
      "抽水",
      "去水",
      "真率",
      "xG",
      "预期进球",
      "卡盘",
      "一球",
      "一球卡盘",
      "一球小胜卡盘",
      "小胜卡盘",
      "同义",
      "差价",
      "合成单关",
      "四舍六入五成双",
      "封顶",
    ],
  },
  {
    id: "hedge",
    shortTitle: "早晚场锁利",
    badge: "06 · 实战进阶稳赚武器",
    title: "早晚场时间差锁利对冲四步法 & 串关“拖油瓶”剔除体检",
    subtitle:
      "利用 ≥135 分钟实战安全时间差在末场前补买单关反向盘锁利，一键砍掉高抽水拖累腿场次",
    keywords: ["对冲", "时间差", "早晚场", "锁利", "补单", "拖油瓶", "砍掉"],
  },
  {
    id: "xiaogao",
    shortTitle: "小高双模&消化度",
    badge: "07 · 单场点诊 + 双维协同会诊 + Price-In",
    title: "扫地僧小高单场点诊 vs 双维协同串关会诊 & 消息入价消化度图解",
    subtitle:
      "深度盘面情报流展开 + 精算防线与残余暗雷双维客观会诊，三秒识破“已消化接盘旧闻”",
    keywords: [
      "扫地僧小高",
      "排雷",
      "联合会诊",
      "协同会诊",
      "双维",
      "多场诊断",
      "单场",
      "Price-In",
      "消化度",
      "消息入价",
      "模拟单",
      "止损",
    ],
  },
];

function extractSearchBigrams(text: string): string[] {
  const cjk = text.replace(/[^\u4e00-\u9fa5]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < cjk.length - 1; i++) {
    out.add(cjk.slice(i, i + 2));
  }
  return Array.from(out);
}

export function matchManualTopics(
  rawQuery: string,
  topics: ManualTopic[] = MANUAL_TOPICS
): ManualTopic[] {
  const trimmed = String(rawQuery || "")
    .trim()
    .toLowerCase();
  if (!trimmed) return topics;

  const tokens = trimmed
    .split(/[\s,，、/·?？!！:：]+/)
    .filter((tk) => tk.length > 0);
  const bigrams = extractSearchBigrams(trimmed);

  const scored: Array<{ topic: ManualTopic; score: number }> = [];
  for (const t of topics) {
    const titleLo = t.title.toLowerCase();
    const subLo = t.subtitle.toLowerCase();
    const shortLo = t.shortTitle.toLowerCase();
    const haystack = `${shortLo} ${titleLo} ${subLo} ${t.keywords.join(" ").toLowerCase()}`;

    let score = 0;
    if (titleLo.includes(trimmed) || shortLo.includes(trimmed)) score += 14;
    if (subLo.includes(trimmed)) score += 9;

    for (const kw of t.keywords) {
      const kwLo = kw.toLowerCase();
      if (kwLo === trimmed) score += 16;
      else if (kwLo.includes(trimmed)) score += 10;
      else if (kwLo.length >= 2 && trimmed.includes(kwLo)) {
        score += kwLo.length >= 4 ? 7 : 3;
      }
    }

    for (const tk of tokens) {
      if (tk.length >= 2 && haystack.includes(tk)) {
        score += 4;
      }
    }

    if (bigrams.length >= 2) {
      let bigramHits = 0;
      for (const bg of bigrams) {
        if (haystack.includes(bg)) bigramHits += 1;
      }
      if (bigramHits >= 2) {
        score += bigramHits * 2;
      }
    }

    if (score > 0) {
      scored.push({ topic: t, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.topic);
}

export interface ManualNavigationState {
  activeSec: ManualSectionId;
  query: string;
  scrollSeq: number;
  highlightSec: ManualSectionId | null;
}

export type ManualNavigationAction =
  | { type: "search"; query: string }
  | { type: "clear-search" }
  | { type: "jump"; targetSec: ManualSectionId }
  | { type: "select-tab"; targetSec: ManualSectionId };

export function resolveManualNavigation(
  prev: ManualNavigationState,
  action: ManualNavigationAction,
  topics: ManualTopic[] = MANUAL_TOPICS
): ManualNavigationState & {
  matchedTopics: ManualTopic[];
  currentTopic: ManualTopic;
} {
  let nextActive = prev.activeSec;
  let nextQuery = prev.query;
  let nextScrollSeq = prev.scrollSeq;
  let nextHighlight: ManualSectionId | null = prev.highlightSec;

  if (action.type === "clear-search") {
    nextQuery = "";
    nextHighlight = null;
  } else if (action.type === "search") {
    nextQuery = action.query;
    const hits = matchManualTopics(nextQuery, topics);
    if (nextQuery.trim().length > 0 && hits.length > 0) {
      if (!hits.some((h) => h.id === prev.activeSec)) {
        nextActive = hits[0].id;
        nextScrollSeq += 1;
      }
    }
    nextHighlight = null;
  } else {
    nextActive = action.targetSec;
    const currentHits = matchManualTopics(prev.query, topics);
    if (
      prev.query.trim().length > 0 &&
      !currentHits.some((h) => h.id === nextActive)
    ) {
      nextQuery = "";
    }
    nextScrollSeq += 1;
    nextHighlight = action.type === "jump" ? nextActive : null;
  }

  const matchedTopics = matchManualTopics(nextQuery, topics);
  const currentTopic = topics.find((t) => t.id === nextActive) ?? topics[0];

  return {
    activeSec: nextActive,
    query: nextQuery,
    scrollSeq: nextScrollSeq,
    highlightSec: nextHighlight,
    matchedTopics,
    currentTopic,
  };
}

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

export function normalizeBudgetYuan(rawBudget: number): number {
  const num = Number(rawBudget);
  if (!Number.isFinite(num)) return 10;
  const clamped = Math.max(10, Math.min(20000, num));
  return Math.max(10, Math.min(20000, Math.round(clamped / 2) * 2));
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

export interface BetSlipState {
  matches: MatchItem[];
  picks: SelectedPick[];
  mode: MatchMode;
  multiple: number;
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
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
  action?: "added" | "removed";
  optionLabel?: string;
  odds?: number;
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
    if (!m) return { multiple: 10, picks: [] };
    const picks = ["hh", "dh"]
      .map((k) => {
        const o = m.pools.HAFU.options.find((x) => x.key === k);
        if (!o) return null;
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "HAFU" as PoolCode,
          poolName: m.pools.HAFU.name,
          singleAllowed: true,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        };
      })
      .filter((x): x is SelectedPick => x !== null);
    return { multiple: 10, picks };
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
  let baselineCacheKey = "";
  let baselineCachePlans: ArchetypePlan[] = [];

  let state: BetSlipState = buildInitialState();

  function emit() {
    for (const fn of listeners) fn();
  }

  function makeBaselineKey(p: QuantWorkspaceParams): string {
    return `${p.targetIds.join(",")}|${p.anchorToRadarPicks ? "1" : "0"}|${p.budget}|${p.unlockFullAgg ? "1" : "0"}|${p.anchorToRadarPicks ? buildRadarSignature(p.picks) : ""}`;
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
    const bKey = makeBaselineKey(paramsSnapshot);
    const needsObjectiveFetch =
      paramsSnapshot.stance !== "objective" &&
      (baselineCacheKey !== bKey || baselineCachePlans.length === 0);

    try {
      const maybeMain = options.computeWorkspace(
        paramsSnapshot,
        matchesSnapshot
      );
      const maybeObj = needsObjectiveFetch
        ? options.computeWorkspace(
            { ...paramsSnapshot, stance: "objective" },
            matchesSnapshot
          )
        : null;

      const isAsync =
        (maybeMain &&
          typeof (maybeMain as Promise<QuantWorkspaceResponse>).then ===
            "function") ||
        (maybeObj &&
          typeof (maybeObj as Promise<QuantWorkspaceResponse>).then ===
            "function");

      if (isAsync) {
        const p = Promise.all([
          Promise.resolve(maybeMain),
          maybeObj ? Promise.resolve(maybeObj) : Promise.resolve(null),
        ])
          .then(([ws, objWs]) => {
            if (seq === computeSeq) {
              if (paramsSnapshot.stance === "objective") {
                baselineCacheKey = bKey;
                baselineCachePlans = ws.portfolioPlans;
              } else if (objWs) {
                baselineCacheKey = bKey;
                baselineCachePlans = objWs.portfolioPlans;
              }
              state = {
                ...state,
                workspace: ws,
                objectivePortfolioPlans: baselineCachePlans,
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
        const objWs = maybeObj as QuantWorkspaceResponse | null;
        if (paramsSnapshot.stance === "objective") {
          baselineCacheKey = bKey;
          baselineCachePlans = ws.portfolioPlans;
        } else if (objWs) {
          baselineCacheKey = bKey;
          baselineCachePlans = objWs.portfolioPlans;
        }
        state = {
          ...state,
          workspace: ws,
          objectivePortfolioPlans: baselineCachePlans,
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

  function isPoolMutexLocked(m: MatchItem, poolCode: PoolCode): boolean {
    const sameMatch = state.picks.filter((p) => p.matchId === m.id);
    if (sameMatch.length === 0) return false;
    const otherPools = sameMatch.filter((p) => p.poolCode !== poolCode);
    if (otherPools.length === 0) return false;
    if (state.mode !== "spf" && state.mode !== "single") return true;
    if (poolCode !== "HAD" && poolCode !== "HHAD") return true;
    if (otherPools.some((p) => p.poolCode !== "HAD" && p.poolCode !== "HHAD"))
      return true;
    const candPool = m.pools[poolCode];
    if (!candPool?.single) return true;
    return !state.picks.every(isAuthoritativePickSingle);
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
    baselineCacheKey = makeBaselineKey(buildWorkspaceParams(state));
    baselineCachePlans = bundle.workspace.portfolioPlans ?? [];
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

  return {
    getState: () => state,
    getStanceDeltaSummary,
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
    isPoolMutexLocked,
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

      const mergedMatches = res.matches.map((nm) => {
        if (nm.aiAlert) return nm;
        const prev = state.matches.find(
          (em) =>
            em.id === nm.id ||
            (Boolean(em.matchNumStr) && em.matchNumStr === nm.matchNumStr)
        );
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
          item.id === matchId ? { ...item, aiAlert: alert } : item
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
      for (const p of state.picks) {
        const s = byMatchPools.get(p.matchId) ?? new Set<PoolCode>();
        s.add(p.poolCode);
        byMatchPools.set(p.matchId, s);
      }
      const existingHasCrossPool = Array.from(byMatchPools.values()).some(
        (s) => s.size > 1
      );
      const existingDistinctCount = byMatchPools.size;
      const allSingleWithCand =
        state.picks.every(isAuthoritativePickSingle) && Boolean(pool.single);

      if ((existingHasCrossPool || existingDistinctCount > 8) && !pool.single) {
        return {
          ok: false,
          blockedReason: "当前选单已锁定【单关】模式，无法混入未开单关的选项！",
        };
      }

      let nextPassSpec = state.passSpec;
      let autoLockedSingleReason: TogglePickVerdict["autoLockedSingleReason"];

      const sameMatchOther = state.picks.filter(
        (p) => p.matchId === m.id && p.poolCode !== poolCode
      );
      if (sameMatchOther.length > 0) {
        const isSpfDualSinglePair =
          (state.mode === "spf" || state.mode === "single") &&
          allSingleWithCand &&
          (poolCode === "HAD" || poolCode === "HHAD") &&
          sameMatchOther.every(
            (p) => p.poolCode === "HAD" || p.poolCode === "HHAD"
          );

        if (!isSpfDualSinglePair) {
          return {
            ok: false,
            blockedReason:
              "同一场比赛只能选择一种玩法进行串关计算；如需改选其他玩法，请先取消本场已选项",
          };
        }
        nextPassSpec = { mode: "free", passSizes: [1] };
        autoLockedSingleReason = "dual-single";
      } else if (!byMatchPools.has(m.id) && existingDistinctCount >= 15) {
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
          ? syncAutoRadarFields(nextPicks, state.matches, state)
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
        passSpec: { mode: "auto" },
        ...(autoSyncRadar
          ? syncAutoRadarFields([], state.matches, resetOverrideState)
          : {}),
      };
      emit();
      void scheduleRefresh();
    },

    removeMatchFromSlip(matchId: string) {
      const nextPicks = state.picks.filter((p) => p.matchId !== matchId);
      state = {
        ...state,
        planSpec: null,
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
        state.picks.every((p) => p.singleAllowed) &&
        nextPicks.some((p) => !p.singleAllowed)
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
      const nextPlanSpec: AppliedPlanSpec =
        arb.betterPicks.length >= 2 && estBetCount > 0 && estBetCount <= 512
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
      if (maxBankers <= 0) {
        return {
          ok: false,
          reason: "当前最小过关数不支持设胆（2串1最多设1胆，3串1最多设2胆）",
        };
      }
      if (curBankers.length >= maxBankers) {
        return {
          ok: false,
          reason: `当前最低 ${minPass}串1 最多可设 ${maxBankers} 场胆码`,
        };
      }

      const nextBankers = [...curBankers, matchId];
      state = {
        ...state,
        planSpec: null,
        passSpec: {
          mode: "free",
          passSizes: nextPassSizes,
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
  };
}
