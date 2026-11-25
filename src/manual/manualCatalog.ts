export type ManualSectionId =
  | "qa"
  | "quickstart"
  | "sandbox"
  | "optimizer"
  | "archetypes"
  | "glossary"
  | "hedge"
  | "xiaogao";

export type IllustratedManualSectionId = Exclude<ManualSectionId, "qa">;

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
    shortTitle: "快速上手&双维走势",
    badge: "01 · 1-2-3三步向导与双维盘面走势",
    title: "30 秒看懂「优竞体育内部专用」1-2-3 精算闭环与双维盘面走势",
    subtitle:
      "从①选球定方向、②精算配单、③审单锁利，看懂末跳红升▲绿降▼箭头与累计去水真率净变化",
    keywords: [
      "入门",
      "流程",
      "1-2-3",
      "三步",
      "向导",
      "同步",
      "双维盘面走势",
      "双维走势",
      "官方归档首报",
      "首次观测",
      "上次有效报价",
      "红绿箭头",
      "红箭头",
      "绿箭头",
      "单关",
      "混合过关",
      "意图保真",
      "三层选单隔离",
      "报价版本锁",
      "子玩法胶囊",
      "手选草稿",
      "3项无死角",
      "双向等价",
      "部分覆盖单关预览",
      "自动挂载",
      "核对合成票行",
      "合成单关",
      "顺滑切换",
      "撤销切换",
      "一键撤销",
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
      "手把手拆解整单归零率、客观严格净赚率、条件命中返奖区间、首场腰斩按 1.0 预演与六大核心指标",
    keywords: [
      "主观胜率",
      "信心微调",
      "沙盒",
      "往左拉",
      "往右拉",
      "EV",
      "期望",
      "整单归零率",
      "全部未中",
      "条件命中返奖区间",
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
      "8场",
      "多场",
      "稳健保本",
      "期望效用",
      "容错缩水",
      "旋转矩阵",
      "独立分块容错串",
      "同向低阶分块",
      "准入红线",
      "可验证处方",
      "差额重配",
      "报价版本锁",
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
      "双向等价",
      "部分覆盖单关预览",
      "3项无死角",
      "意图保真",
      "自动挂载",
      "核对合成票行",
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
    shortTitle: "小高双模&时序",
    badge: "07 · 单场点诊 + 双维协同会诊 + 消息与变价时序对照",
    title: "扫地僧小高单场点诊 vs 双维协同串关会诊 & 消息与变价时序对照图解",
    subtitle:
      "客观历史证据（休息间隔上界 + 近90天战绩账本 + 双维盘面走势）与消息-变价时序客观并列对照",
    keywords: [
      "扫地僧小高",
      "排雷",
      "联合会诊",
      "协同会诊",
      "双维",
      "多场诊断",
      "单场",
      "消息与变价时序对照",
      "时序对照",
      "休息间隔上界",
      "近90天",
      "客观战绩",
      "无可核验信息",
      "Price-In",
      "消化度",
      "消息入价",
      "模拟单",
      "止损",
    ],
  },
];

export const QUICK_QA_PILLS: string[] = [
  "套用方案会改掉赛事雷达手选草稿吗？什么是三层选单隔离？",
  "什么是整单归零率、全部未中首行和条件命中返奖区间？",
  "双向等价合成单关与部分覆盖单关预览有什么区别？",
  "为什么精算配单会触发准入红线并提供同向低阶分块？",
  "📌 设胆和胆拖过关怎么用？",
  "只选1场未开单关怎么用过桥配菜搭子凑2串1？",
  "严格净赚率和刚回本率有什么区别？",
  "一键加至最低保本门槛和智能合票减张有什么用？",
  "3+1 精算配单四档方案有什么区别？",
  "为什么错价雷达会显示空仓？",
  "什么是旋转矩阵缩水？",
  "什么是跨盘联合校准？",
  "10元预算怎么配单？",
  "看球直觉倾向偏主队改变了什么？",
  "联合会诊和精算配单怎么协同？",
  "精算配单里的「🎯 一键匹配赛事雷达已选球队」有什么用？",
  "同一场比赛切换不同玩法怎么顺滑直切与一键撤销？",
  "单选1场未开单关时，怎样确认「3项无死角合成单关」？",
  "底部常驻「过关选择」里的自由过关和 3串4/4串11 有什么区别？",
  "主观胜率信心微调滑块往左拉和往右拉分别代表什么？",
  "消息与变价时序对照是什么意思？",
  "双维盘面走势和红升绿降箭头怎么看？",
  "什么是假中奖倒贴？为什么中了还亏钱？",
  "平均优化、博热保本、博冷高弹三种优化该点哪个？",
  "一球小胜卡盘温度计超过 50% 该怎么防？",
  "早晚场时间差对冲锁利怎么操作？",
  "扫地僧小高怎么同时诊断我买的 3 场串关？",
];

export function extractSearchBigrams(text: string): string[] {
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

export interface ManualCalloutSpec {
  tone: "good" | "warn";
  title: string;
  body: string;
}

export interface ManualCardSpec {
  tag?: { tone: "blue" | "green" | "amber"; text: string };
  title: string;
  paragraphs?: string[];
  subTitle?: string;
  bullets?: Array<{ lead?: string; text: string }>;
  oddsKeyDemo?: {
    odds: string;
    arrow: string;
    fairPct: string;
    lines: Array<{ lead: string; text: string }>;
  };
}

export interface ManualChapterSpec {
  id: IllustratedManualSectionId;
  diagramTitle: string;
  diagramPosition?: "top" | "after-callouts";
  callouts?: ManualCalloutSpec[];
  presetScenarios?: Array<{
    kind: "underwater" | "synthetic" | "parlay4" | "hedge2";
    label: string;
  }>;
  cardGroups: Array<{
    columns: 2 | 3;
    cards: ManualCardSpec[];
  }>;
}

export const MANUAL_CHAPTER_SPECS: Record<
  IllustratedManualSectionId,
  ManualChapterSpec
> = {
  quickstart: {
    id: "quickstart",
    diagramTitle:
      "📊 图解：从看盘选球到体彩店打票的「五步精算防坑闭环」（含 3+1 精算配单 · 3大极值+错价雷达）",
    presetScenarios: [
      { kind: "underwater", label: "⚠️ 演练：等倍复式「假中奖倒贴」陷阱" },
      { kind: "hedge2", label: "⏰ 演练：早晚场时间差对冲锁利" },
      { kind: "parlay4", label: "📉 演练：4串1连乘抽水雪崩效应" },
    ],
    cardGroups: [
      {
        columns: 2,
        cards: [
          {
            title: "🔍 水位按钮上的「双维盘面走势 + 红升绿降箭头」怎么看？",
            oddsKeyDemo: {
              odds: "1.73",
              arrow: "▼",
              fairPct: "51% +1.4p",
              lines: [
                {
                  lead: "上方 1.73 + 末跳箭头 ▲/▼",
                  text: "体彩当前固定返奖水位与较上一报的升降方向（▲ 较上一报上调、▼ 较上一报下调）；注意体彩整池同步调整返还率时，单项水位与去水概率可能同向变化，切勿把末跳箭头直接等同于防冷方向！",
                },
                {
                  lead: "下方 51% + 累计 Δp 百分点",
                  text: "五池联合校准真实隐含概率，以及同让球线、同有效选项集下自官方归档首报（缺首报标「初」代表自本系统首次观测，不足两帧暂不判趋势）至今的去水真率净变化百分点。",
                },
                {
                  lead: "点开全玩法或底牌抽屉",
                  text: "完整并列查看「首报→当前累计真率变化」与「上一报→当前报水位、时间与方向」双维盘面走势；遇官网空板或回退快照时顶部醒目标明只读「上次有效报价」采集时刻。",
                },
              ],
            },
          },
          {
            title: "📱 赛事卡片上的一排小标签分别代表什么？",
            bullets: [
              {
                lead: "单 vs 仅半/比单关",
                text: "绿色「单」表示胜平负可直接单买。「仅半/比单关」表示胜平负未开单关。只选这一场时应付 ¥0，若有可用的合成报价，核对票行与总额后可确认。",
              },
              {
                lead: "xG 1.68:0.84",
                text: "由 31 个比分赔率反推的双方预期进球数，一眼识别大球对攻局还是闷战局。",
              },
              {
                lead: "赢1球卡盘 52%",
                text: "强队赢球时有 52% 概率只净胜 1 球（1:0 或 2:1），切忌无脑单冲让胜(-1)！",
              },
              {
                lead: "省+8.5%",
                text: "系统抓到了预算内离散凑整后依然严格占优的同义买法差价，点开底牌可一键切换。",
              },
              {
                lead: "📌 设胆 与 🌉 过桥配菜搭子",
                text: "选满 ≥3 场自由低关可点亮必出稳胆一键砍掉无胆废票；只看准 1 场非单关赛事时，底栏与审单区自动精选全盘最低抽水稳胆与 ≥135 分钟时间差单关锁利过桥配菜搭子，点「一键搭上」秒凑合法 2串1。",
              },
            ],
          },
        ],
      },
      {
        columns: 2,
        cards: [
          {
            title: "⚡ 意图保真无锁选号：同场顺滑直切 & 4/6/8 关上限",
            bullets: [
              {
                lead: "同场全玩法直点顺滑切换 + 一键撤销",
                text: "同一场比赛在同一玩法内可复式多选（如同时点 [0] 胜 + 平）；串关同场仅容单一玩法，所有已开售玩法格始终开放直点切换——点选同场新玩法时自动顺滑替换本场旧玩法并弹出「↩ 撤销切换」缓冲。仅在非混串且全单所有已选项均开放单关时，同场胜平负与让球可并存并自动锁定【单关】计奖。",
              },
              {
                lead: "各玩法最高过关上限",
                text: "胜平负/让球最高 8 关，总进球最高 6 关，比分/半全场最高 4 关（31 项全比分含胜其它/平其它/负其它）。若选 6 场含 1 场比分，过关面板自动锁止 5关/6关，最高按 4关拆票。",
              },
              {
                lead: "三层选单隔离 + 报价版本锁 + 子玩法胶囊条",
                text: "系统将赛事雷达手选草稿、实时报价版本锁与已套用方案快照三层物理隔离——套用任何智能方案绝不反向污染你的雷达手选草稿（继续加选新比赛时仅锚定亲手点选方向，已选比分/总进球/半全场在混合视图卡片底部常驻胶囊条一键清除）；切预算重算期间报价版本锁自动阻断旧高额报价误套，套用后再改预算则保留旧票只读核对并弹出差额重配提示条。",
              },
            ],
          },
          {
            title: "🎛️ 全局常驻「过关选择 + 倍数九宫格」总控底栏",
            bullets: [
              {
                lead: "全页面常驻不丢失",
                text: "无论上下滑动多少场比赛或切到任何页签，底部始终锁定显示过关选择与投倍键盘。",
              },
              {
                lead: "自由过关 vs M串N 多串容错",
                text: "自由过关支持多选叠加（如 3 场同时勾 2关+3关 拆成 4 注）；多串容错提供官方标准 3串3 / 3串4 / 4串6 / 4串11 / 5串26 快选，黑 1~2 场照样拿回血奖金。",
              },
              {
                lead: "九宫格倍数与智能分倍双态",
                text: "点击 N倍 ⌨️ 可呼出 1~999 倍数字键盘（超体彩单票 99 倍上限自动计算拆票张数）；启用三模奖金优化或 3+1 精算配单后自动切换为 ⚖️ 智能分倍模式，支持一键扩倍或还原等倍。",
              },
            ],
          },
        ],
      },
    ],
  },
  sandbox: {
    id: "sandbox",
    diagramTitle:
      "🎚️ 重点图解：「主观胜率信心微调沙盒 (-15% ～ +15%)」到底该往左拉还是往右拉？",
    cardGroups: [
      {
        columns: 2,
        cards: [
          {
            title: "🎛️ 推演沙盒另外两个开关怎么用？",
            bullets: [
              {
                lead: "什么是右上角的「期望 EV」？",
                text: "EV = 长期每买 100 元平均净赚或净亏百分比。在 0% 默认档下因体彩抽水 11%~22%，常规注单客观 EV 为负数；只有手握硬核临场信息往右拉滑块看到 EV 变成绿色正数（+X%），才代表认知优势足以覆盖抽水。",
              },
              {
                lead: "「模拟首场延期/腰斩 (按水位 1.0 算)」",
                text: "万一第一场因暴雨意外中断超 36 小时未重赛，中国体彩不退票而是将该场赔率强制按 1.00 计奖！打开此开关即可提前检查剩余场次单算时能否保住总本金。",
              },
              {
                lead: "「统配倍数 (- / +)」",
                text: "未开启不等倍优化时每按 + 号全单统一加 1 倍（每注 +2 元）；开启平均/博热/博冷优化后自动按每注最优独立倍数配平。",
              },
            ],
          },
          {
            title: "🛡️ 三层审单工作台与四桶客观盈亏分布逐块白话解读",
            bullets: [
              {
                lead: "① 当前核对实票 + 整单归零率（全部未中与未达串关置顶首行）",
                text: "第一层直报基本票数、2元注份数与预计纸票张数；第二层全赛果无条件四桶（归零 P(R=0) + 局部回血 P(0<R<C) + 平手返本 P(R=C) + 严格净赚 P(R>C) = 100%）首块直报整单归零率，第三层首行永久置顶「全部未中 + 命中部分场次但未达过关/胆码条件 -> 实派 ¥0.00 / -¥本金」，绝不隐藏黑单颗粒无收概率！",
              },
              {
                lead: "② 严格净赚率 vs 平手返本率",
                text: "主看板恒锁定客观严格净赚率（派奖严格大于总本金），将净赚 ¥0.00 的刚回本率单独拆分披露，绝不把平手混充赚钱。",
              },
              {
                lead: "③ 局部回血倒贴率与独立推演沙盒隔离",
                text: "直接揪出“命中部分子票却低于总本金”的局部回血概率与水下情景数；下方推演沙盒支持按场次多选腰斩退算与主观胜率拉杆，仅在沙盒内展示「实盘基准 vs 沙盒假设」对照，绝不篡改上方核对实票与打票单。",
              },
              {
                lead: "④ 条件命中返奖区间（区分真保底与命中最低返奖）",
                text: "仅当整单归零率为 0% 时才标无条件保底；只要存在黑单归零可能，诚实改标「条件命中返奖区间」（至少命中 1 张票时的最低～最高派彩），背面翻转同步展示无条件分位数 P20/P50/P80/P99。",
              },
              {
                lead: "⑤ 综合暗扣抽水与合成等效水位",
                text: "显示每 100 元被暗扣的水分及复式折算等效水位（若 ≤1.00 属必亏盘直接诚实拦截）。",
              },
              {
                lead: "⑥ 双口径连续 5 单风险提示与动态危险分（0~100）",
                text: "并列披露「连续 5 单全归零概率 p₀⁵」与「连续 5 单未净赚概率 (1-p₊)⁵」，配合 0~100 统一危险分严防盲目重仓。",
              },
            ],
          },
        ],
      },
    ],
  },
  optimizer: {
    id: "optimizer",
    diagramTitle:
      "📈 图解：同样约 ¥100 预算，默认等倍 vs 三种智能奖金优化的实际到手奖金天平对比",
    diagramPosition: "after-callouts",
    callouts: [
      {
        tone: "good",
        title: "🔒 严守预算主权 · ⚡ 一键加至最低保本门槛 · 🔗 智能合票减张",
        body: "点击三模奖金优化默认严格锁定你当前设定的总本金（绝不暗自涨价，最高支持 999 倍逻辑分倍并按 99 倍自动算拆票）；若原预算在数学上不足以清零假中奖，系统诚实展示局部回血组数并提供「⚡ 一键加至最低保本门槛 ¥X」显式授权按钮；在「🧾 防错打票单」默认开启「🔗 智能合票减张」，将相近倍数与同关复式聚类合并（保底偏离 ≤3%），防止体彩店拒打或中途降赔滑点。",
      },
      {
        tone: "warn",
        title: "⚠️ 真实算账：为什么官方默认「等倍复式」是彩民头号隐形杀手？",
        body: "假设花 ¥100 买 3 个组合：正路A（2.10）、次选防平B（3.80）、防冷门C（6.50）。若按终端默认每注等买 16 倍（共 ¥96）：一旦踢出最容易出的正路A（单注 4.20 元 × 16 倍 = ¥67.20），明明精准猜中赛果，到手却净亏 ¥28.80！这就是「假中奖倒贴」。",
      },
    ],
    cardGroups: [
      {
        columns: 3,
        cards: [
          {
            tag: { tone: "blue", text: "① 平均优化（均衡派奖）" },
            title: "怎么分倍数的？",
            paragraphs: [
              "按每注赔率的反比例精密计算整数倍（如 2.10 买 27 倍、3.80 买 15 倍、6.50 买 9 倍），让每组中奖派彩几乎拉平。",
            ],
            subTitle: "什么时候点它？",
            bullets: [
              {
                lead: "零假中奖",
                text: "无论开出你防的哪一个结果，到手净赚都差不多；适合主胜和平局拿不准、求稳拿均利。",
              },
            ],
          },
          {
            tag: { tone: "green", text: "② 博热保本（主攻+护盾）" },
            title: "怎么分倍数的？",
            paragraphs: [
              "先给防平B、防冷C分配刚好够拿回 100 元本金的最小整数倍，省下的全部火力重砸向第一主攻方向A！",
            ],
            subTitle: "什么时候点它？",
            bullets: [
              {
                lead: "主攻多赚 35%~65%",
                text: "防平打出全身而退不亏一分钱，主攻打出吃大肉；适合非常看好强队赢、顺手防一脚 1:1 或让球平卡盘。",
              },
            ],
          },
          {
            tag: { tone: "amber", text: "③ 博冷高弹（正路免单+暴击）" },
            title: "怎么分倍数的？",
            paragraphs: [
              "把大概率正路A配到刚好保本回血（正路出了相当于免费看球不亏钱），把多余筹码全部押在高赔冷门C上！",
            ],
            subTitle: "什么时候点它？",
            bullets: [
              {
                lead: "免单搏冷门",
                text: "豪门大热升水 ▲ 怀疑有冷意、又不敢裸买冷门时最实用！",
              },
            ],
          },
        ],
      },
    ],
  },
  archetypes: {
    id: "archetypes",
    diagramTitle:
      "🧭 图解：3+1 精算配单「三大正交帕累托极值 + 宁缺毋滥·无洼地空仓错价雷达」定位矩阵",
    diagramPosition: "after-callouts",
    callouts: [
      {
        tone: "good",
        title:
          "🎯 目标对决池支持「1 ～ 8 场」自由点选 +「🎯 一键匹配赛事雷达已选球队」！",
        body: "你可以直接在对决池点选 1 ～ 8 场比赛，或先在【赛事雷达】选好心仪球队再点「🎯 一键匹配赛事雷达已选球队」开启雷达选队同步锚定，让稳健保本、期望效用、容错缩水、错价雷达四档方案严格围绕你亲手选的球队方向做精算配单。",
      },
    ],
    cardGroups: [
      {
        columns: 2,
        cards: [
          {
            title: "🛡️ ① 稳健保本 & ⚖️ ② 期望效用（默认主选）",
            bullets: [
              {
                lead: "① 稳健保本（Tier-1A 零局部回血优先 · Tier-1B 透明降级）",
                text: "优先基于精确整数规划求解覆盖范围内 100% 零假中奖组合（Tier-1A，单场未开单关时自动遴选双向等价合成单关）；当窄预算离散注数下数学无零回血解时，诚实标明「允许局部回血 · 非保本」（Tier-1B）并披露局部回血率与缺口，绝不伪称保本，严格按准入红线择优放行。",
              },
              {
                lead: "② 期望效用 & 同向低阶分块竞争",
                text: "在同预算满配与单行 ≤ 999 倍约束下联立寻优无倒贴整数倍保本护盾以最大化对数财富效用；未手动锁死高关时自动把你所锁场次的同向低阶分块（2串1 / 3串1 / 单关组合）纳入统一寻优，纯客观下自动剔除高抽水拖累腿；未过准入红线时诚实输出降阶、最低可行预算或空仓等可验证处方！",
              },
            ],
          },
          {
            title:
              "🧩 ③ 容错缩水（严格区分旋转矩阵缩水与独立分块容错串 · 披露错≥2场击穿率）",
            bullets: [
              {
                text: "传统 6 场、8 场全包多串动辄几十注导致本金严重摊薄；直接裸买长串又极易错 1 场颗粒无收。",
              },
              {
                lead: "旋转矩阵缩水 vs 独立分块容错串",
                text: "在单方案不超过 10 组逻辑组合（单组超 99 倍时自动按 99 倍终端上限拆算纸质实票张数）前提下，仅目标容错阶零漏网的标准覆盖设计 C(v,k,t) 冠名旋转矩阵缩水，而 8场四组6串1对偶补集或分块短串诚实标为独立分块容错串，同步披露局部回血组数与错 ≥ 2 场击穿率！",
              },
            ],
          },
          {
            title:
              "⚡ ④ 错价雷达（101.0% 纯正期望硬门禁 · 宁缺毋滥·无洼地空仓）",
            bullets: [
              {
                lead: "纯 +EV 才出手",
                text: "对细分盘执行经验贝叶斯收缩校准，仅在单腿校准期望返还达到 ≥ 101.0%（纯正期望 ≥ +1.0% +EV）且成单净期望 EV > 0% 时才激活，默认开启 36% 自动轻仓护本垫（负期望注单遵循凯利 0%，娱乐仓位 ≤ 2%）。",
              },
              {
                lead: "常态空仓与上限透明披露",
                text: "竞彩严密盘下无真 +EV 洼地导致空仓属正常理性结果；空仓态（应付 ¥0、锁止套用按钮）会实时透出当前所选场次的最高校准单腿返还率及距 101.0% 门槛的差值！",
              },
            ],
          },
          {
            title: "🎚️ 看球直觉倾向三档（1-RTT 全空间概率守恒对照）",
            bullets: [
              {
                lead: "纯客观 / 偏主队 / 防爆冷",
                text: "切换倾向后单次往返（1-RTT）同步返回主观推演配单与客观基准对照 Δ 差值，底层联合赛果空间严格重归一化至 100%。",
              },
              {
                lead: "水位刷新抚平预警",
                text: "套用错价雷达后点击「同步水位」若官方降赔抹平了原洼地，审单台自动保留当前实票重算并置顶弹出抚平预警。",
              },
            ],
          },
        ],
      },
    ],
  },
  glossary: {
    id: "glossary",
    diagramTitle:
      "💸 图解：体彩五大玩法「暗扣抽水率 (Vig)」真实差距（每买 ¥100 被暗扣多少钱）",
    cardGroups: [
      {
        columns: 2,
        cards: [
          {
            title: "1️⃣ 返还率、暗扣抽水 (Vig) 与串关抽水雪崩",
            paragraphs: [
              "硬币正反面公平赔率应为 2.00 对 2.00（返还率 100%）；体彩开 1.76 对 1.76 相当于每投 100 元先抽走 12 元水分，返还率 88%。",
              "为什么长串容易亏？单场返还率 88%，2串1 变 0.88×0.88=77.4%，4串1 只剩 59.9%（未开踢先折损 40% 数学期望），超过 3 场宜配合容错缩水或真实跨盘洼地。",
            ],
          },
          {
            title: "2️⃣ Shin 非线性去水 + 五池联合校准（xG、卡盘率与比赛节奏）",
            paragraphs: [
              "Shin + 五池联合校准：先用 Shin 非线性去水挤干高抽水比分/半全场冷门的长尾保护性水分，再以低抽水主盘为锚点统一反推半全场×全场比分联合分布，使五大玩法同义赛果概率 100% 闭合自洽（胜胜+平胜+负胜 = 主胜、0球 = 0:0），导出预期进球 xG 与比赛节奏相关性（防守死锁 / 均衡节奏 / 开放对攻）。",
              "一球卡盘率：同源算出热门方赢球时恰好只净胜 1 球的比重，一旦 ≥ 50%，单买让胜(-1)极易卡盘，务必补防让球平！",
            ],
          },
          {
            title: "3️⃣ 同义错价替换（被动省钱平替利器）",
            paragraphs: [
              "体彩五大奖池独立调水，常出现表达相同赛果但返奖一高一低：",
            ],
            bullets: [
              {
                text: "买「总进球·0球」与买「比分·0:0」完全同义，哪个返奖高买哪个！",
              },
              {
                text: "买「让球(-1)让负」与买「胜平负·平+负」反比例配平同样同义，审单台检出离散凑整严格占优入口时会弹出「💰 一键替换」。",
              },
            ],
          },
          {
            title: "4️⃣ 合成单关、漏网死角、四舍六入五成双与封顶",
            bullets: [
              {
                lead: "100% 双向等价合成单关 vs 部分覆盖单关预览",
                text: "单选未开单关的方向时，系统先算报价。例如主胜可由半全场 胜胜 + 平胜 + 负胜 3项全包无死角覆盖，按赔率反比例分配倍数。首次使用须核对票行、倍数及总金额，明确确认后才计入应付。选择「2项省本搏常规」会漏掉逆转，部分覆盖须核对保留率与漏网死角。另选 1 场可改走原盘串关，退回 1 场时，只有仍有效的同一份已确认报价才可复用。",
              },
              {
                lead: "四舍六入五成双与法定封顶",
                text: "中国体彩按单注 2 元基础票面四舍六入五成双保留到分后再乘倍数；法定单注封顶：单关 10万、2/3关 20万、4/5关 50万、6~8关 100万。",
              },
            ],
          },
        ],
      },
    ],
  },
  hedge: {
    id: "hedge",
    diagramTitle: "⏱️ 图解：早晚场时间差「锁定确定性正净利润」实战四步时间轴",
    cardGroups: [
      {
        columns: 2,
        cards: [
          {
            title: "⚡ 具体算账例子：怎么做到无论凌晨谁赢都锁定正净利？",
            paragraphs: [
              "假设花 ¥100 买 20:00 早场主胜(1.85) × 03:00 晚场主胜(1.95)（50 倍，潜在派奖 ¥360.75）。",
              "22:00 早场顺利红单后，03:00 晚场反向项让球(+1)客胜（平或负）开放单关且赔率 1.92。按计算器提示去店里补买 ¥188 反向单（命中拿回 188 × 1.92 = ¥360.96）。",
              "最终总成本 100 + 188 = ¥288，无论晚场踢出胜、平、负任何赛果必定拿回约 ¥361，锁死 +¥73 确定性净利润（若双盘抽水导致补单后微亏，系统会诚实标为早场红单减损补单橙色预警）！",
            ],
          },
          {
            title: "💣 串关“拖油瓶”与高抽水拖累腿体检",
            paragraphs: [
              "很多人买 3串1 喜欢硬塞一场隐含抽水高达 15% 的高抽水拖累腿凑单。串关连乘抽水会呈指数侵蚀数学期望，同时多串一场冷平风险往往把整单真赚钱率拉低十几个百分点！",
              "审单台会自动逐场试算剔除后的胜率跃升幅度，弹出「一键砍掉此场」助你瘦身提纯。",
            ],
          },
        ],
      },
    ],
  },
  xiaogao: {
    id: "xiaogao",
    diagramTitle: "📊 图解：什么是「消息与变价时序对照」与客观历史证据三标尺？",
    cardGroups: [
      {
        columns: 2,
        cards: [
          {
            title: "🧹 双模客观排雷：单场独立点诊 + 多场联合串关会诊",
            bullets: [
              {
                lead: "模式 A · 单场独立点诊（同证据纯客观事实）",
                text: "点击任意比赛卡片看「底牌」或在「小高排雷舱」直接点单场点诊，注入主客队已观测竞彩休息间隔上界（一方<84h且差≥48h触发筛选提示）、近90天最多12场客观战绩账本（满8场对照同期去水预期）、双维盘面走势与消息与变价时序对照（无核验外部消息统一标「无可核验信息」，未开售玩法标「该玩法无有效报价」）。",
              },
              {
                lead: "模式 B · 双维协同串关会诊（严格唯一 matchId 绑定）",
                text: "选满 ≥2 场或自由勾选多场点击联合会诊，小高基于完全相同的客观历史证据识别已构筑的精算防线与残余实战暗雷；单场告警与缓存 100% 绑定官方唯一比赛标识、开售池、让球线、报价版本与 30 分钟时效，变盘或超 30 分钟自动撤回旧结论。",
              },
            ],
          },
          {
            title: "📒 单向只读隔离 & 双轨止损账本",
            paragraphs: [
              "底层校准概率与精算配单权重永远保持 100% 出厂客观纯净，扫地僧小高严守单向只读隔离（绝不臆断消息消化比例，也不篡改真实隐含概率或配单倍数）。",
              "双轨止损账本：实买单（朱砂红金实线章）与 0 成本模拟观察单（冷青虚线水印章）物理分轨并支持四态秒筛；记账由服务端权威封存出票固定水位与实票明细，完场后对接 24 个月全页核齐赛果库按 90 分钟常规时间自动对奖；支持 5 秒防手滑软撤销，且当日已结亏损实买单删除后锁死已耗止损额度防上头！",
            ],
          },
        ],
      },
    ],
  },
};
