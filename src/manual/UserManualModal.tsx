import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  askManualAssistant,
  type ManualAskResponse,
} from "../security/secureClient";
import { playTactileCue } from "../spring/tactileSymphony";
import {
  MANUAL_TOPICS,
  matchManualTopics,
  resolveManualNavigation,
  type ManualNavigationState,
  type ManualSectionId,
  type PresetScenarioKind,
} from "../workspace/betSlipController";

export { MANUAL_TOPICS, type ManualSectionId };

const MANUAL_TAB_META: Partial<
  Record<ManualSectionId, { shortTitle: string }>
> = {
  archetypes: { shortTitle: "3+1精算配单" },
};

const QUICK_QA_PILLS = [
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
  "为什么同一场比赛选了胜平负后，不能再点让球平？",
  "底部常驻「过关选择」里的自由过关和 3串4/4串11 有什么区别？",
  "主观胜率信心微调滑块往左拉和往右拉分别代表什么？",
  "Price-In 消息入价消化度是什么意思？",
  "赔率旁边的红箭头 ▲ 和绿箭头 ▼ 怎么看？",
  "什么是假中奖倒贴？为什么中了还亏钱？",
  "平均优化、博热保本、博冷高弹三种优化该点哪个？",
  "一球小胜卡盘温度计超过 50% 该怎么防？",
  "早晚场时间差对冲锁利怎么操作？",
  "扫地僧小高怎么同时诊断我买的 3 场串关？",
];

export function UserManualModal({
  open,
  initialSection = "sandbox",
  onClose,
  onQuotaUpdate,
  onLoadPresetScenario,
}: {
  open: boolean;
  initialSection?: ManualSectionId;
  onClose: () => void;
  onQuotaUpdate?: (remaining?: number) => void;
  onLoadPresetScenario?: (kind: PresetScenarioKind) => void;
}) {
  const [navState, setNavState] = useState<ManualNavigationState>({
    activeSec: initialSection,
    query: "",
    scrollSeq: 0,
    highlightSec: null,
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  // Manual Q&A state
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<
    Array<{ id: string; q: string; res: ManualAskResponse }>
  >([]);
  const [qaError, setQaError] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialSection) {
      setNavState((prev) => ({
        ...prev,
        activeSec: initialSection,
        scrollSeq: prev.scrollSeq + 1,
        highlightSec: null,
      }));
    }
  }, [open, initialSection]);

  useEffect(() => {
    if (!open || !bodyRef.current) return;
    bodyRef.current.scrollTo({ top: 0, behavior: "smooth" });
  }, [open, navState.scrollSeq]);

  useEffect(() => {
    if (!navState.highlightSec) return;
    const timer = window.setTimeout(() => {
      setNavState((prev) => ({ ...prev, highlightSec: null }));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [navState.highlightSec, navState.scrollSeq]);

  if (!open) return null;

  const matchedTopics = matchManualTopics(navState.query, MANUAL_TOPICS);
  const currentTopic =
    MANUAL_TOPICS.find((t) => t.id === navState.activeSec) ?? MANUAL_TOPICS[0];

  const handleJumpSection = (
    targetSec: ManualSectionId,
    fromJumpBtn = false
  ) => {
    playTactileCue("tap-on");
    setNavState((prev) =>
      resolveManualNavigation(prev, {
        type: fromJumpBtn ? "jump" : "select-tab",
        targetSec,
      })
    );
  };

  const submitManualQuestion = async (rawQ: string) => {
    const clean = rawQ.trim();
    if (!clean || asking) return;
    setAsking(true);
    setQaError(null);
    setNavState((prev) =>
      resolveManualNavigation(prev, { type: "select-tab", targetSec: "qa" })
    );
    playTactileCue("radar-ping");
    try {
      const res = await askManualAssistant(clean);
      onQuotaUpdate?.(res.remainingQuota);
      setQaHistory((prev) => [
        { id: `qa_${Date.now()}`, q: clean, res },
        ...prev.slice(0, 14),
      ]);
      setAskInput("");
      playTactileCue(res.warningStrike ? "tap-off" : "radar-lock");
    } catch (err) {
      playTactileCue("tap-off");
      setQaError((err as Error)?.message || "说明书问答繁忙，请稍后重试");
    } finally {
      setAsking(false);
    }
  };

  const handleQaForm = (e: FormEvent) => {
    e.preventDefault();
    void submitManualQuestion(askInput);
  };

  return (
    <div className="manual-backdrop" onClick={onClose}>
      <div
        className="manual-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="优竞体育内部专用 百科级图文精算说明书"
      >
        {/* Top Sticky Header */}
        <div className="manual-head">
          <div className="manual-head-title">
            <span className="manual-pill">📘 百科图文手册 + 智能问答</span>
            <div>
              <h2>优竞体育内部专用 · 实战百科说明书</h2>
              <p>
                每个滑块怎么拉、每个百分比什么含义、每种买法怎么算账 —— 图文案例
                + 实时提问
              </p>
            </div>
          </div>
          <button
            type="button"
            className="round-key"
            onClick={onClose}
            title="关闭说明书"
          >
            ✕
          </button>
        </div>

        {/* Search + Chapter Tabs */}
        <div className="manual-toolbar">
          <div className="manual-search-wrap">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.2" y2="16.2" />
            </svg>
            <input
              type="text"
              value={navState.query}
              onChange={(e) => {
                const nextQuery = e.target.value;
                setNavState((prev) =>
                  resolveManualNavigation(prev, {
                    type: "search",
                    query: nextQuery,
                  })
                );
              }}
              placeholder="快速搜章节：一球小胜卡盘、3+1精算配单、旋转矩阵、错价雷达空仓、10元预算..."
            />
            {navState.query && (
              <button
                type="button"
                className="manual-clear"
                onClick={() =>
                  setNavState((prev) =>
                    resolveManualNavigation(prev, {
                      type: "clear-search",
                    })
                  )
                }
              >
                清空
              </button>
            )}
          </div>

          <div className="manual-tabs">
            {MANUAL_TOPICS.map((t) => {
              const isHit = matchedTopics.some((m) => m.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleJumpSection(t.id, false)}
                  className={`manual-tab ${currentTopic.id === t.id ? "on" : ""} ${!isHit ? "dim" : ""}`}
                >
                  {MANUAL_TAB_META[t.id]?.shortTitle ?? t.shortTitle}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rich Illustrated Content Body */}
        <div className="manual-body" ref={bodyRef}>
          <div
            className={`manual-hero-banner ${
              navState.highlightSec === currentTopic.id
                ? "jump-focus-pulse"
                : ""
            }`}
          >
            <span className="manual-sec-badge">{currentTopic.badge}</span>
            <h3>{currentTopic.title}</h3>
            <p>{currentTopic.subtitle}</p>
          </div>

          {/* ==================== SECTION 0: 💬 说明书智能提问 (Route C Hybrid Iron-Cage) ==================== */}
          {currentTopic.id === "qa" && (
            <div className="manual-section">
              <div className="manual-card" style={{ marginBottom: 14 }}>
                <h4 style={{ marginTop: 0 }}>
                  💬 向「内部说明书助手」直接提问（严格锚定本 APP 真实功能）
                </h4>
                <form
                  onSubmit={handleQaForm}
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="text"
                    value={askInput}
                    disabled={asking}
                    onChange={(e) => setAskInput(e.target.value)}
                    placeholder="例如：主观胜率微调滑块往左拉和往右拉是什么意思？Price-In 消化度怎么看？"
                    style={{
                      flex: 1,
                      minWidth: 220,
                      height: 40,
                      padding: "0 12px",
                      borderRadius: 10,
                      border: "1px solid #cbd5e1",
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="submit"
                    disabled={asking}
                    className="key dark sm"
                  >
                    {asking ? "正在结合本APP功能解答..." : "立即提问解答"}
                  </button>
                </form>

                <div
                  style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}
                >
                  🔥 一键点选高频疑问（0毫秒秒回）：
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_QA_PILLS.map((qText) => (
                    <button
                      key={qText}
                      type="button"
                      disabled={asking}
                      onClick={() => void submitManualQuestion(qText)}
                      className="key mini"
                      style={{
                        textAlign: "left",
                        height: "auto",
                        padding: "5px 9px",
                      }}
                    >
                      {qText}
                    </button>
                  ))}
                </div>
              </div>

              {qaError && (
                <div
                  className="manual-callout warn"
                  style={{ marginBottom: 12 }}
                >
                  <b>{qaError}</b>
                </div>
              )}

              {qaHistory.map((item) => (
                <div
                  key={item.id}
                  className={`manual-callout ${item.res.warningStrike ? "warn" : "good"}`}
                  style={{ marginBottom: 12 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 6,
                    }}
                  >
                    <b>🙋 你的提问：{item.q}</b>
                    <span className="manual-tag blue" style={{ margin: 0 }}>
                      {item.res.source === "local-kb"
                        ? "⚡ 官方精修词库秒回"
                        : item.res.source === "iron-cage-guard"
                          ? `🛡️ 说明书边界拦截 (${item.res.warningStrike}/${item.res.maxStrikes})`
                          : "📘 说明书场景精解"}
                    </span>
                  </div>
                  <p
                    style={{
                      whiteSpace: "pre-line",
                      margin: 0,
                      lineHeight: 1.7,
                    }}
                  >
                    {item.res.answer}
                  </p>
                  {item.res.jumpSection && item.res.jumpSection !== "qa" && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="key mini dark"
                        onClick={() =>
                          handleJumpSection(item.res.jumpSection!, true)
                        }
                      >
                        📖 跳转查看该功能完整矢量图解 ›
                      </button>
                    </div>
                  )}
                </div>
              ))}

              <div className="manual-callout warn">
                <b>🔒 说明书专属安全边界说明（防同行探底保护）</b>
                <p>
                  本问答功能
                  <b>
                    仅限于解释「优竞体育内部专用」计算器内的实际按钮、滑块、图表与竞彩精算名词
                  </b>
                  。对于超出本说明书范畴的闲聊，或试探系统内部实现细节的提问，系统将自动拦截不予作答；
                  <b>连续违规提问超过 4 次将触发风控红线自动锁死账号</b>。
                </p>
              </div>
            </div>
          )}

          {/* ==================== SECTION 1: 快速上手 & 红绿箭头 ==================== */}
          {currentTopic.id === "quickstart" && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  📊 图解：从看盘选球到体彩店打票的「五步精算防坑闭环」
                </div>
                <svg viewBox="0 0 760 156" className="manual-svg">
                  <defs>
                    <linearGradient id="stepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e293b" />
                      <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                    <marker
                      id="arrow"
                      markerWidth="6"
                      markerHeight="6"
                      refX="5"
                      refY="3"
                      orient="auto"
                    >
                      <path d="M0,0 L6,3 L0,6 Z" fill="#64748b" />
                    </marker>
                  </defs>
                  {[
                    {
                      x: 12,
                      num: "STEP 1",
                      t: "同步实盘水位",
                      d: "拉取体彩5大玩法",
                      d2: "看红▲涨/绿▼降箭头",
                      c: "#2563eb",
                    },
                    {
                      x: 162,
                      num: "STEP 2",
                      t: "查底牌&请小高",
                      d: "看五池xG与卡1球率",
                      d2: "单场或串关联合排雷",
                      c: "#7c3aed",
                    },
                    {
                      x: 312,
                      num: "STEP 3",
                      t: "3+1 精算配单",
                      d: "点选1~8场心仪对阵",
                      d2: "3大极值+错价雷达",
                      c: "#0d9488",
                    },
                    {
                      x: 462,
                      num: "STEP 4",
                      t: "三模奖金优化",
                      d: "平均/博热/博冷分倍",
                      d2: "彻底消灭假中奖亏钱",
                      c: "#d97706",
                    },
                    {
                      x: 612,
                      num: "STEP 5",
                      t: "防错实票核对",
                      d: "展开大字打票清单",
                      d2: "店里逐行打钩+记账",
                      c: "#16a34a",
                    },
                  ].map((s, idx) => (
                    <g key={s.num}>
                      <rect
                        x={s.x}
                        y="16"
                        width="136"
                        height="122"
                        rx="14"
                        fill="url(#stepGrad)"
                      />
                      <rect
                        x={s.x}
                        y="16"
                        width="136"
                        height="28"
                        rx="14"
                        fill={s.c}
                      />
                      <text
                        x={s.x + 68}
                        y="35"
                        textAnchor="middle"
                        fill="#fff"
                        fontSize="11"
                        fontWeight="700"
                      >
                        {s.num}
                      </text>
                      <text
                        x={s.x + 68}
                        y="68"
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize="13.5"
                        fontWeight="700"
                      >
                        {s.t}
                      </text>
                      <text
                        x={s.x + 68}
                        y="94"
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="11"
                      >
                        {s.d}
                      </text>
                      <text
                        x={s.x + 68}
                        y="114"
                        textAnchor="middle"
                        fill="#94a3b8"
                        fontSize="10.5"
                      >
                        {s.d2}
                      </text>
                      {idx < 4 && (
                        <path
                          d={`M ${s.x + 140} 77 L ${s.x + 158} 77`}
                          stroke="#64748b"
                          strokeWidth="2"
                          markerEnd="url(#arrow)"
                        />
                      )}
                    </g>
                  ))}
                </svg>
              </div>

              {onLoadPresetScenario && (
                <div className="manual-card" style={{ marginBottom: 12 }}>
                  <h4 style={{ marginTop: 0 }}>
                    🎬 经典精算教学牌例（一键载入到③审单台实操体验）
                  </h4>
                  <p style={{ marginBottom: 10 }}>
                    把首屏空间留给真实选球，教学演示统一收纳于此；点任一牌例立即载入对应典型对阵并进入审单锁利：
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      type="button"
                      className="key sm"
                      onClick={() => {
                        onLoadPresetScenario("underwater");
                        onClose();
                      }}
                    >
                      ⚠️ 演练：等倍复式「假中奖倒贴」陷阱
                    </button>
                    <button
                      type="button"
                      className="key sm"
                      onClick={() => {
                        onLoadPresetScenario("hedge2");
                        onClose();
                      }}
                    >
                      ⏰ 演练：早晚场时间差对冲锁利
                    </button>
                    <button
                      type="button"
                      className="key sm"
                      onClick={() => {
                        onLoadPresetScenario("parlay4");
                        onClose();
                      }}
                    >
                      📉 演练：4串1连乘抽水雪崩效应
                    </button>
                  </div>
                </div>
              )}

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>🔍 赔率按钮上的「两行数字 + 红绿小箭头」怎么看？</h4>
                  <div className="manual-mini-demo">
                    <div className="manual-demo-key">
                      <b>
                        1.73 <span style={{ color: "#10b981" }}>▼</span>
                      </b>
                      <small>51%</small>
                    </div>
                    <div className="manual-demo-explain">
                      <p>
                        <b>上方 `1.73`</b>：体彩官方固定返奖倍数（买 100
                        元中了拿回 173 元）。
                      </p>
                      <p>
                        <b>绿降箭头 `▼` / 红升箭头 `▲`</b>：
                        <span style={{ color: "#059669", fontWeight: 700 }}>
                          ▼ 绿降
                        </span>
                        代表官方正在紧急下调该项赔付（防范打出多赔钱）；
                        <span style={{ color: "#e11d48", fontWeight: 700 }}>
                          ▲ 红升
                        </span>
                        代表官方正在抬高赔付（若大热强队一直亮红 ▲
                        升水，说明机构根本不怕它赢，极易爆冷！）。
                      </p>
                      <p>
                        <b>下方 `51%`</b>：挤干体彩 12.2% 暗扣水分后的
                        <b>去水真实胜率</b>！别被表面 `1÷1.73=57.8%`
                        骗了，庄家眼里它只有 51% 胜率。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="manual-card">
                  <h4>📱 赛事卡片上的一排小标签分别代表什么？</h4>
                  <ul>
                    <li>
                      <b>`单` vs `仅半/比单关`</b>：带绿色 `单`
                      字说明胜平负可以直接单买 1 场；写着 `仅半/比单关`
                      说明胜平负必须至少
                      2串1，但如果只想买这一场，可借道半全场/总进球做
                      <b>合成单关</b>！
                    </li>
                    <li>
                      <b>`xG 1.68:0.84`</b>：由 31
                      个比分赔率反推的双方预期进球数，一眼看出是“大球对攻局”还是“0:0
                      / 1:0 闷战局”。
                    </li>
                    <li>
                      <b>`赢1球卡盘 52%`</b>：强队赢球时有 52% 概率只净胜 1
                      球（1:0 或 2:1），提醒你千万别无脑单冲 `让胜(-1)`！
                    </li>
                    <li>
                      <b>`省+8.5%`</b>
                      ：系统抓到了预算内离散凑整后依然严格占优的同义买法差价（例如买比分
                      `0:0` 比买总进球 `0球` 多赚 8.5%），点开底牌可一键切换。
                    </li>
                    <li>
                      <b>`📌 设胆` 与 `🌉 过桥配菜搭子`</b>：选满 ≥3
                      场自由低关可点亮必出稳胆一键砍掉无胆废票；只看准 1
                      场非单关赛事时，底栏与审单区自动精选全盘最低抽水稳胆搭子与
                      ≥135 分钟时间差单关锁利搭子，点击「一键搭上」秒凑合法
                      2串1。
                    </li>
                  </ul>
                </div>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>
                    🚫 中国体彩法定选号铁律：同场单一玩法互斥 & 4/6/8 关上限
                  </h4>
                  <ul>
                    <li>
                      <b>同场单一玩法互斥</b>：同一场比赛在
                      <b>同一玩法内可复式多选</b>（如同时点 `[0] 胜 +
                      平`）；但在串关或混合过关模式下，
                      <b>
                        绝不能把同一场的两个不同玩法（如选了 `[0] 胜` 又去点
                        `[+1] 让平`）串进同一张票
                      </b>
                      ！未选玩法会自动亮起「互斥」保护标并拦截提示。仅在非混串且全单所有比赛都开了单关时，才允许同场双单关并强制锁定【单关】计奖。
                    </li>
                    <li>
                      <b>各玩法最高过关上限</b>：`胜平负/让球` 最高 <b>8 关</b>
                      ，`总进球` 最高 <b>6 关</b>，`比分/半全场` 最高{" "}
                      <b>4 关</b>（31 项全比分含
                      `胜其它/平其它/负其它`）。若选了 6 场但含 1
                      场比分，过关面板会自动锁止 5关/6关，最高允许按
                      4关自由过关拆票。
                    </li>
                  </ul>
                </div>

                <div className="manual-card">
                  <h4>🎛️ 全局常驻「过关选择 + 倍数九宫格」总控底栏</h4>
                  <ul>
                    <li>
                      <b>全页面常驻不丢失</b>
                      ：无论上下滑动多少场比赛或切到任何页签，底部始终锁定显示
                      <b>过关选择</b>与<b>投倍键盘</b>。
                    </li>
                    <li>
                      <b>自由过关 vs M串N 多串容错</b>：自由过关支持
                      <b>多选叠加</b>（如 3 场同时勾 `2关+3关` 拆成 4
                      注）；多串容错提供官方标准 `3串3 / 3串4 / 4串6 / 4串11 /
                      5串26` 快选，黑 1~2 场照样拿回血奖金。
                    </li>
                    <li>
                      <b>九宫格倍数与智能分倍双态</b>：点击 `N倍 ⌨️` 可呼出
                      `1~999` 倍数字键盘（超体彩单票 99
                      倍上限自动计算拆票张数）；启用三模奖金优化或 3+1
                      精算配单后自动切换为 `⚖️ 智能分倍` 模式，支持一键 `×2扩倍`
                      或 `还原等倍`。
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 2: 推演沙盒与五维透视舱 6 块仪表详解 ==================== */}
          {currentTopic.id === "sandbox" && (
            <div className="manual-section">
              {/* Dedicated Illustrated Diagram for Subjective Confidence Slider */}
              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  🎚️ 重点图解：「主观胜率信心微调沙盒 (-15% ～
                  +15%)」到底该往左拉还是往右拉？
                </div>
                <svg viewBox="0 0 760 198" className="manual-svg">
                  {/* Track */}
                  <rect
                    x="44"
                    y="84"
                    width="290"
                    height="14"
                    rx="7"
                    fill="#fecdd3"
                  />
                  <rect
                    x="334"
                    y="84"
                    width="382"
                    height="14"
                    rx="7"
                    fill="#bbf7d0"
                  />
                  {/* Left & Right Boxes */}
                  <rect
                    x="36"
                    y="16"
                    width="235"
                    height="54"
                    rx="10"
                    fill="#fff1f2"
                    stroke="#fda4af"
                  />
                  <text
                    x="153"
                    y="37"
                    textAnchor="middle"
                    fill="#be123c"
                    fontSize="12.5"
                    fontWeight="700"
                  >
                    ⬅️ 往左拉（-1% ～ -15%）：悲观抗压测试
                  </text>
                  <text
                    x="153"
                    y="56"
                    textAnchor="middle"
                    fill="#475569"
                    fontSize="10.8"
                  >
                    “怕自己盲目乐观，调低胜率看最坏亏多少”
                  </text>

                  <rect
                    x="284"
                    y="16"
                    width="144"
                    height="54"
                    rx="10"
                    fill="#f8fafc"
                    stroke="#94a3b8"
                  />
                  <text
                    x="356"
                    y="37"
                    textAnchor="middle"
                    fill="#0f172a"
                    fontSize="12"
                    fontWeight="700"
                  >
                    ⏺ 中间 0%（默认）
                  </text>
                  <text
                    x="356"
                    y="56"
                    textAnchor="middle"
                    fill="#475569"
                    fontSize="10.5"
                  >
                    100%按体彩去水客观真率
                  </text>

                  <rect
                    x="442"
                    y="16"
                    width="282"
                    height="54"
                    rx="10"
                    fill="#ecfdf5"
                    stroke="#6ee7b7"
                  />
                  <text
                    x="583"
                    y="37"
                    textAnchor="middle"
                    fill="#047857"
                    fontSize="12.5"
                    fontWeight="700"
                  >
                    往右拉（+1% ～ +15%）：额外利好看好加码 ➡️
                  </text>
                  <text
                    x="583"
                    y="56"
                    textAnchor="middle"
                    fill="#475569"
                    fontSize="10.8"
                  >
                    “手握未调水突发利好，调高胜率测算能不能转正盈利”
                  </text>

                  {/* Center Knob & Right Knob Demo */}
                  <circle
                    cx="356"
                    cy="91"
                    r="10"
                    fill="#64748b"
                    stroke="#fff"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="545"
                    cy="91"
                    r="12"
                    fill="#10b981"
                    stroke="#fff"
                    strokeWidth="3"
                  />
                  <text
                    x="545"
                    y="122"
                    textAnchor="middle"
                    fill="#059669"
                    fontSize="11.5"
                    fontWeight="700"
                  >
                    例：往右拉到 +12%
                  </text>

                  {/* Bottom Concrete Math Walkthrough */}
                  <rect
                    x="36"
                    y="134"
                    width="688"
                    height="52"
                    rx="10"
                    fill="#0f172a"
                  />
                  <text
                    x="50"
                    y="155"
                    fill="#f8fafc"
                    fontSize="10.6"
                    fontWeight="700"
                  >
                    💡 算账实例：某场主胜赔率 1.85（客观去水真率 48%）。默认 0%
                    时因体彩抽水 11%，右上角【期望 EV = -11.2%】（长期必亏）。
                  </text>
                  <text
                    x="50"
                    y="175"
                    fill="#6ee7b7"
                    fontSize="10.6"
                    fontWeight="600"
                  >
                    👉 若得知对手门将热身拉伤且赔率未降，往右拉到 +15%（胜率变
                    55.2%），【期望 EV 跳成 +2.1% 绿色】——值得出手！
                  </text>
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>🎛️ 推演沙盒另外两个开关怎么用？</h4>
                  <ul>
                    <li>
                      <b>什么是右上角的「期望 EV」？</b>：EV = 长期每买 100
                      元平均净赚或净亏多少百分比。只要在 `0%`
                      默认档下，因为体彩抽水 11%~22%，任何单子的客观 EV
                      都是负数（如 `-12%`）。当你有硬核临场信息往右拉滑块，
                      <b>看到 EV 变成绿色正数（`+X%`）</b>
                      ，才代表你的认知优势足以打赢体彩抽水！
                    </li>
                    <li>
                      <b>「模拟首场延期/腰斩 (按水位 1.0 算)」</b>：假设你花
                      ¥100 买了两场 2串1（第一场 1.80 × 第二场
                      1.90）。万一第一场踢到半场大暴雨腰斩且 36
                      小时内没重赛，体彩规则<b>不退票</b>
                      ，而是把第一场赔率强制当成
                      `1.00`！打开此开关即可提前看：只剩第二场 1.90
                      单算时能不能保住本金。
                    </li>
                    <li>
                      <b>「统配倍数 (- / +)」</b>
                      ：当你没开启不等倍奖金优化时，每按一下 `+`
                      号，所有组合统一加 1 倍（每注 +2
                      元）。一旦你点了「平均/博热/博冷优化」，系统按每注最优独立倍数配平，此步进器会自动隐藏防止误乱配比。
                    </li>
                  </ul>
                </div>

                <div className="manual-card">
                  <h4>🛡️ 五维真相透视舱「6 块仪表」逐块白话解读</h4>
                  <ul>
                    <li>
                      <b>① 真实保底奖金（划掉官网虚高最高奖）</b>
                      ：体彩店机器总爱用“最高可中
                      ¥2800”诱惑你，其实那是全爆冷才有的幻觉！这里直接告诉你
                      <b>命中最低赔那一组时最少能拿回多少钱</b>
                      ——若低于总本金就会标红报警！
                    </li>
                    <li>
                      <b>② 大概率到手落点（60%高概率命中带）</b>
                      ：中奖时有六成以上概率实际拿到的奖金区间，帮你建立最真实的心理预期。
                    </li>
                    <li>
                      <b>③ 真赚钱率 vs 命中率</b>：<b>最核心指标！</b>比如你包了
                      4 个半全场，命中率有 68%，但其中 2 个低赔中了倒亏钱，
                      <b>真正净利润 &gt; 0 的概率可能只有 29%</b>
                      ！永远只看前面的「真赚钱率」。
                    </li>
                    <li>
                      <b>④ 假中奖倒贴检测</b>
                      ：直接揪出几组“猜中比赛却亏本金”的水下组合，点下方「平均优化」可一键清零。
                    </li>
                    <li>
                      <b>⑤ 暗扣抽水与合成等效水位</b>：显示这张单子每 100
                      元被体彩暗扣多少元水分；多选一比赛时算出折合单买一个选项的等效赔率（若
                      `≤1.05` 纯属给体彩打工）。
                    </li>
                    <li>
                      <b>⑥ 危险分、连黑5次概率与仓位上限</b>：危险分
                      `0~100`（超过 65
                      分属高危长串或深抽水），并根据凯利公式建议本单最多动用总资金的百分之几（如
                      `仓位≤4%`），严防一把梭哈。
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 3: 奖金优化图解 ==================== */}
          {currentTopic.id === "optimizer" && (
            <div className="manual-section">
              <div className="manual-callout good" style={{ marginBottom: 12 }}>
                <b>
                  🔒 严守预算主权 · ⚡ 一键加至最低保本门槛 · 🔗 智能合票减张
                </b>
                <p style={{ margin: "4px 0 0", lineHeight: 1.65 }}>
                  点击三模奖金优化默认严格锁定你当前设定的总本金（绝不暗自涨价，最高支持
                  999 倍逻辑分倍并按 99
                  倍自动算拆票）；若原预算在数学上不足以清零假中奖，系统诚实展示局部回血组数并提供「⚡
                  一键加至最低保本门槛 ¥X」显式授权按钮；在「🧾
                  防错打票单」默认开启「🔗
                  智能合票减张」，将相近倍数与同关复式聚类合并（保底偏离
                  ≤3%），防止体彩店拒打或中途降赔滑点。
                </p>
              </div>
              <div className="manual-callout warn">
                <b>
                  ⚠️ 真实算账：为什么官方默认「等倍复式」是彩民头号隐形杀手？
                </b>
                <p>
                  假设你准备花 <b>¥100</b> 买 3 个过关组合：正路组合A（水位{" "}
                  <b>2.10</b>）、次选防平B（水位 <b>3.80</b>）、防冷门C（水位{" "}
                  <b>6.50</b>）。如果你偷懒按体彩终端默认
                  <b>每注等买 16 倍（共 ¥96）</b>：一旦踢出最容易出的正路A（单注
                  4.20 元 × 16 倍 = <b>¥67.20</b>），你明明
                  <b>精准猜中了赛果，到手却净亏 ¥28.80</b>
                  ！这就是「假中奖倒贴」。
                </p>
              </div>

              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  📈 图解：同样约 ¥100 预算，默认等倍 vs
                  三种智能奖金优化的实际到手奖金天平对比
                </div>
                <svg viewBox="0 0 760 235" className="manual-svg">
                  <line
                    x1="48"
                    y1="135"
                    x2="735"
                    y2="135"
                    stroke="#ef4444"
                    strokeDasharray="5 4"
                    strokeWidth="1.8"
                  />
                  <text
                    x="732"
                    y="18"
                    textAnchor="end"
                    fill="#ef4444"
                    fontSize="10.5"
                    fontWeight="700"
                  >
                    --- 红色虚线 = 本金回本线 ¥100（柱子低于红线 =
                    中奖反而亏钱！）
                  </text>

                  <g transform="translate(55, 0)">
                    <rect
                      x="0"
                      y="158"
                      width="36"
                      height="44"
                      rx="5"
                      fill="#ef4444"
                    />
                    <text
                      x="18"
                      y="152"
                      textAnchor="middle"
                      fill="#ef4444"
                      fontSize="10"
                      fontWeight="700"
                    >
                      ¥67亏
                    </text>
                    <rect
                      x="42"
                      y="102"
                      width="36"
                      height="100"
                      rx="5"
                      fill="#64748b"
                    />
                    <text
                      x="60"
                      y="96"
                      textAnchor="middle"
                      fill="#334155"
                      fontSize="10"
                      fontWeight="600"
                    >
                      ¥122
                    </text>
                    <rect
                      x="84"
                      y="52"
                      width="36"
                      height="150"
                      rx="5"
                      fill="#64748b"
                    />
                    <text
                      x="102"
                      y="46"
                      textAnchor="middle"
                      fill="#334155"
                      fontSize="10"
                      fontWeight="600"
                    >
                      ¥208
                    </text>
                    <text
                      x="60"
                      y="222"
                      textAnchor="middle"
                      fill="#0f172a"
                      fontSize="12"
                      fontWeight="700"
                    >
                      ❌ 默认等倍复式
                    </text>
                  </g>

                  <g transform="translate(230, 0)">
                    <rect
                      x="0"
                      y="114"
                      width="36"
                      height="88"
                      rx="5"
                      fill="#0ea5e9"
                    />
                    <text
                      x="18"
                      y="108"
                      textAnchor="middle"
                      fill="#0284c7"
                      fontSize="10"
                      fontWeight="700"
                    >
                      ¥113
                    </text>
                    <rect
                      x="42"
                      y="112"
                      width="36"
                      height="90"
                      rx="5"
                      fill="#0ea5e9"
                    />
                    <text
                      x="60"
                      y="106"
                      textAnchor="middle"
                      fill="#0284c7"
                      fontSize="10"
                      fontWeight="700"
                    >
                      ¥114
                    </text>
                    <rect
                      x="84"
                      y="110"
                      width="36"
                      height="92"
                      rx="5"
                      fill="#0ea5e9"
                    />
                    <text
                      x="102"
                      y="104"
                      textAnchor="middle"
                      fill="#0284c7"
                      fontSize="10"
                      fontWeight="700"
                    >
                      ¥117
                    </text>
                    <text
                      x="60"
                      y="222"
                      textAnchor="middle"
                      fill="#0284c7"
                      fontSize="12"
                      fontWeight="700"
                    >
                      ① 平均优化 (严守预算配平)
                    </text>
                  </g>

                  <g transform="translate(405, 0)">
                    <rect
                      x="0"
                      y="84"
                      width="36"
                      height="118"
                      rx="5"
                      fill="#10b981"
                    />
                    <text
                      x="18"
                      y="78"
                      textAnchor="middle"
                      fill="#059669"
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      ¥138赚
                    </text>
                    <rect
                      x="42"
                      y="132"
                      width="36"
                      height="70"
                      rx="5"
                      fill="#94a3b8"
                    />
                    <text
                      x="60"
                      y="126"
                      textAnchor="middle"
                      fill="#475569"
                      fontSize="10"
                      fontWeight="600"
                    >
                      ¥102保
                    </text>
                    <rect
                      x="84"
                      y="131"
                      width="36"
                      height="71"
                      rx="5"
                      fill="#94a3b8"
                    />
                    <text
                      x="102"
                      y="125"
                      textAnchor="middle"
                      fill="#475569"
                      fontSize="10"
                      fontWeight="600"
                    >
                      ¥104保
                    </text>
                    <text
                      x="60"
                      y="222"
                      textAnchor="middle"
                      fill="#059669"
                      fontSize="12"
                      fontWeight="700"
                    >
                      ② 博热保本 (主攻吃肉)
                    </text>
                  </g>

                  <g transform="translate(580, 0)">
                    <rect
                      x="0"
                      y="132"
                      width="36"
                      height="70"
                      rx="5"
                      fill="#94a3b8"
                    />
                    <text
                      x="18"
                      y="126"
                      textAnchor="middle"
                      fill="#475569"
                      fontSize="10"
                      fontWeight="600"
                    >
                      ¥101保
                    </text>
                    <rect
                      x="42"
                      y="131"
                      width="36"
                      height="71"
                      rx="5"
                      fill="#94a3b8"
                    />
                    <text
                      x="60"
                      y="125"
                      textAnchor="middle"
                      fill="#475569"
                      fontSize="10"
                      fontWeight="600"
                    >
                      ¥103保
                    </text>
                    <rect
                      x="84"
                      y="34"
                      width="36"
                      height="168"
                      rx="5"
                      fill="#f59e0b"
                    />
                    <text
                      x="102"
                      y="26"
                      textAnchor="middle"
                      fill="#d97706"
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      ¥247暴
                    </text>
                    <text
                      x="60"
                      y="222"
                      textAnchor="middle"
                      fill="#d97706"
                      fontSize="12"
                      fontWeight="700"
                    >
                      ③ 博冷高弹 (兜底暴击)
                    </text>
                  </g>

                  <text x="55" y="18" fill="#64748b" fontSize="10.5">
                    每组左柱=命中热门A(2.10) · 中柱=命中次选B(3.80) ·
                    右柱=命中冷门C(6.50)
                  </text>
                </svg>
              </div>

              <div className="manual-grid-3">
                <div className="manual-card">
                  <span className="manual-tag blue">
                    ① 平均优化（均衡派奖）
                  </span>
                  <h4>怎么分倍数的？</h4>
                  <p>
                    按每注赔率的<b>反比例</b>精密计算整数倍（如 2.10 买 27
                    倍、3.80 买 15 倍、6.50 买 9 倍），让每组中奖派彩几乎拉平。
                  </p>
                  <h4>什么时候点它？</h4>
                  <ul>
                    <li>
                      <b>零假中奖</b>
                      ：无论开出你防的哪一个结果，到手净赚都差不多。
                    </li>
                    <li>适合：主胜和平局拿不准，想稳稳当当无差别拿利润。</li>
                  </ul>
                </div>

                <div className="manual-card">
                  <span className="manual-tag green">
                    ② 博热保本（主攻+护盾）
                  </span>
                  <h4>怎么分倍数的？</h4>
                  <p>
                    先给防平B、防冷C分配<b>刚好够拿回 100 元本金</b>
                    的最小整数倍，省下的全部火力重砸向第一主攻方向A！
                  </p>
                  <h4>什么时候点它？</h4>
                  <ul>
                    <li>
                      <b>主攻多赚 35%~65%</b>
                      ：防平打出全身而退不亏一分钱，主攻打出吃大肉！
                    </li>
                    <li>
                      适合：非常看好强队赢，只想顺手防一脚 1:1 或让球平卡盘。
                    </li>
                  </ul>
                </div>

                <div className="manual-card">
                  <span className="manual-tag amber">
                    ③ 博冷高弹（正路免单+暴击）
                  </span>
                  <h4>怎么分倍数的？</h4>
                  <p>
                    把大概率正路A配到<b>刚好保本回血</b>
                    （正路出了相当于免费看球不亏钱），把多余筹码全部押在高赔冷门C上！
                  </p>
                  <h4>什么时候点它？</h4>
                  <ul>
                    <li>
                      <b>白嫖搏冷门</b>：豪门大热升水 ▲
                      怀疑有冷意，又不敢裸买冷门时最神！
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 4: 1~8 场 3+1 帕累托精算配单 ==================== */}
          {currentTopic.id === "archetypes" && (
            <div className="manual-section">
              <div className="manual-callout good" style={{ marginBottom: 12 }}>
                <b>
                  🎯 目标对决池支持「1 ～ 8 场」自由点选
                  +「一键匹配赛事雷达已选球队」！
                </b>
                <p>
                  你可以直接在对决池点选 <b>1 ～ 8 场</b>
                  比赛，也可以先在最左栏【赛事雷达】选好心仪球队，再点顶部的{" "}
                  <b>「🎯 一键匹配赛事雷达已选球队」</b>{" "}
                  按钮：系统会立即同步你选的场次并开启<b>雷达选队同步锚定</b>
                  ，让<b>稳健保本、期望效用、容错缩水、错价雷达</b>
                  四档方案严格围绕你亲手选的球队方向做精算配单，绝不违背你的看球意向！
                </p>
              </div>

              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  🧭 图解：3+1 精算配单「三大正交帕累托极值 +
                  宁缺毋滥错价雷达」定位矩阵
                </div>
                <svg viewBox="0 0 760 192" className="manual-svg">
                  <rect
                    x="32"
                    y="16"
                    width="696"
                    height="152"
                    rx="12"
                    fill="#f8fafc"
                    stroke="#cbd5e1"
                  />
                  <line
                    x1="380"
                    y1="16"
                    x2="380"
                    y2="168"
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1="32"
                    y1="92"
                    x2="728"
                    y2="92"
                    stroke="#cbd5e1"
                    strokeDasharray="4 4"
                  />
                  <text
                    x="46"
                    y="34"
                    fill="#64748b"
                    fontSize="10.5"
                    fontWeight="600"
                  >
                    高真赚钱率稳健区 →
                  </text>
                  <text
                    x="580"
                    y="160"
                    fill="#64748b"
                    fontSize="10.5"
                    fontWeight="600"
                  >
                    ← 跨盘α偏离轻仓区
                  </text>

                  {[
                    {
                      x: 130,
                      y: 58,
                      c: "#0284c7",
                      t: "① 稳健保本",
                      s: "0-1背包0假中奖 · 最大化真赚钱率",
                    },
                    {
                      x: 300,
                      y: 62,
                      c: "#059669",
                      t: "② 期望效用",
                      s: "对数财富效用 · 裁高抽水拖累腿",
                    },
                    {
                      x: 470,
                      y: 118,
                      c: "#7c3aed",
                      t: "③ 容错缩水 (矩阵/独立分块)",
                      s: "≤10组逻辑组合 · 披露错≥2场击穿",
                    },
                    {
                      x: 635,
                      y: 118,
                      c: "#e11d48",
                      t: "④ 错价雷达 (宁缺毋滥·无洼地空仓)",
                      s: "纯+EV≥101%轻仓 · 透出最高返还率",
                    },
                  ].map((n) => (
                    <g key={n.t}>
                      <circle cx={n.x} cy={n.y} r="8" fill={n.c} />
                      <text
                        x={n.x}
                        y={n.y - 14}
                        textAnchor="middle"
                        fill="#0f172a"
                        fontSize="11.5"
                        fontWeight="700"
                      >
                        {n.t}
                      </text>
                      <text
                        x={n.x}
                        y={n.y + 22}
                        textAnchor="middle"
                        fill="#475569"
                        fontSize="9.8"
                      >
                        {n.s}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>🛡️ ① 稳健保本 & ⚖️ ② 期望效用（默认主选）</h4>
                  <ul>
                    <li>
                      <b>① 稳健保本</b>
                      ：基于精确整数背包动态规划求解（单场未开单关时自动遴选最优合成单关），确保覆盖范围内{" "}
                      <b>100% 零假中奖组合</b>
                      ，并严格以<b>严格净赚率（payout &gt; cost）</b>
                      为第一排序主目标、刚回本率为次级决胜。
                    </li>
                    <li>
                      <b>② 期望效用</b>：在同预算满配与单行 `≤ 999`
                      倍约束下联立寻优<b>无倒贴整数倍保本护盾</b>
                      （允许护盾在最小保本线之上继续择优上探以最大化对数财富效用）；纯客观模式下按单腿校准期望返还
                      `O·p` 自动剔除<b>高抽水拖累腿</b>
                      （绝不误杀低抽水稳胆；雷达锚定时保留场次并置顶提醒）！
                    </li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>
                    🧩 ③ 容错缩水（严格区分旋转矩阵与独立分块容错串 ·
                    披露错≥2场击穿率）
                  </h4>
                  <ul>
                    <li>
                      传统 6 场、8 场全包多串动辄几十注，本金被严重摊薄；直接买
                      6串1 又极易对 5 场死 1 场颗粒无收。
                    </li>
                    <li>
                      <b>旋转矩阵缩水 vs 独立分块容错串</b>：在单方案
                      <b>不超过 10 组逻辑组合</b>（单组超 `99` 倍时自动按 `99`
                      倍终端上限拆算纸质实票张数）前提下，仅目标容错阶零漏网的标准覆盖设计
                      `C(v,k,t)` 冠名<b>旋转矩阵缩水</b>，而
                      8场四组6串1对偶补集或分块短串诚实标为<b>独立分块容错串</b>
                      ，同步披露<b>局部回血组数与错 ≥ 2 场击穿率</b>！
                    </li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>
                    ⚡ ④ 错价雷达（101.0% 纯正期望硬门禁 · 常态严密盘诚实空仓）
                  </h4>
                  <ul>
                    <li>
                      <b>纯 +EV 才出手</b>
                      ：对细分盘执行经验贝叶斯收缩校准，仅在单腿校准期望返还达到{" "}
                      <b>≥ 101.0%（纯正期望 ≥ +1.0% +EV）</b>且成单净期望 `EV
                      &gt; 0%` 时才激活，默认开启 <b>36% 自动轻仓护本垫</b>
                      （负期望注单遵循凯利公式 `f*=0%`，娱乐仓位严控 `≤ 2%`）。
                    </li>
                    <li>
                      <b>常态空仓与上限透明披露</b>
                      ：竞彩严密盘下无真 +EV
                      洼地导致空仓属正常理性结果；空仓态（应付
                      `¥0`、锁止套用按钮）会实时透出当前所选场次的
                      <b>最高校准单腿返还率</b>及距 `101.0%` 门槛的差值！
                    </li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>🎚️ 看球直觉倾向三档（全空间概率守恒）</h4>
                  <ul>
                    <li>
                      <b>纯客观 / 偏主队 / 防爆冷</b>
                      ：切换倾向后，系统在底层联合赛果空间做保序倾斜并严格重归一化至总概率
                      `100%`（绝不破坏概率守恒），四档精算配单随之同步重算最优选号与整数倍。
                    </li>
                    <li>
                      <b>水位刷新抚平预警</b>
                      ：若套用了错价雷达后点击「同步水位」发现官方降赔抹平了原洼地，审单台会自动保留当前实票重算并置顶弹出抚平预警，助你知情决策。
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 5: 专业名词词典 ==================== */}
          {currentTopic.id === "glossary" && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  💸 图解：体彩五大玩法「暗扣抽水率 (Vig)」真实差距（每买 ¥100
                  被暗扣多少钱）
                </div>
                <svg viewBox="0 0 760 148" className="manual-svg">
                  {[
                    {
                      y: 18,
                      name: "胜平负 / 让球胜平负",
                      ret: "返还率 ~87.8%",
                      vig: "每100元暗扣 ¥12.2",
                      w: 220,
                      c: "#10b981",
                    },
                    {
                      y: 50,
                      name: "总进球数 (TTG)",
                      ret: "返还率 ~85.5%",
                      vig: "每100元暗扣 ¥14.5",
                      w: 270,
                      c: "#0ea5e9",
                    },
                    {
                      y: 82,
                      name: "半全场胜平负 (HAFU)",
                      ret: "返还率 ~79.7%",
                      vig: "每100元暗扣 ¥20.3 (重灾区!)",
                      w: 380,
                      c: "#f59e0b",
                    },
                    {
                      y: 114,
                      name: "全场比分 (CRS)",
                      ret: "返还率 ~78.5%",
                      vig: "每100元暗扣 ¥21.5 (仅适合轻仓)",
                      w: 405,
                      c: "#ef4444",
                    },
                  ].map((r) => (
                    <g key={r.name}>
                      <text
                        x="16"
                        y={r.y + 15}
                        fill="#0f172a"
                        fontSize="11.5"
                        fontWeight="600"
                      >
                        {r.name}
                      </text>
                      <rect
                        x="175"
                        y={r.y}
                        width="420"
                        height="20"
                        rx="6"
                        fill="#e2e8f0"
                      />
                      <rect
                        x="175"
                        y={r.y}
                        width={r.w}
                        height="20"
                        rx="6"
                        fill={r.c}
                      />
                      <text
                        x={184}
                        y={r.y + 14}
                        fill="#fff"
                        fontSize="10.5"
                        fontWeight="700"
                      >
                        {r.vig}
                      </text>
                      <text x="606" y={r.y + 14} fill="#475569" fontSize="11">
                        {r.ret}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>1️⃣ 返还率、暗扣抽水 (Vig) 与串关抽水雪崩</h4>
                  <p>
                    硬币正反面如果公平赔率应该是 2.00 对 2.00（返还率
                    100%）；体彩给你开 1.76 对 1.76，相当于每投 100 元先抽走 12
                    元手续费，返还率 88%。
                  </p>
                  <p>
                    <b>为什么长串容易亏？</b> 单场返还率 88%，2串1 变成 `0.88 ×
                    0.88 = 77.4%`，
                    <b>
                      4串1 只剩 `0.88⁴ = 59.9%`（还没开踢先亏 40% 数学期望）
                    </b>
                    ！所以超过 3 场务必配合「③
                    容错缩水（旋转矩阵）」或真实跨盘洼地。
                  </p>
                </div>

                <div className="manual-card">
                  <h4>
                    2️⃣ Shin 非线性去水 + 五池联合校准（xG、卡盘率与比赛节奏）
                  </h4>
                  <p>
                    <b>Shin + 五池联合校准</b>：先用 Shin
                    非线性去水挤干高抽水比分/半全场冷门的长尾保护性水分，再以低抽水主盘为锚点统一反推半全场×全场比分联合分布，使五大玩法同义赛果概率{" "}
                    <b>100% 闭合自洽</b>（`胜胜+平胜+负胜 = 主胜`、`0球 =
                    0:0`），同时导出双方预期进球 `xG`
                    与比赛节奏相关性（低比分联动修正系数 ρ：`防守死锁 / 均衡节奏
                    / 开放对攻`）。
                  </p>
                  <p>
                    <b>一球卡盘率</b>
                    ：在任意让球线下同源算出热门方赢球时恰好只净胜 1
                    球的比重。一旦 <b>≥ 50%</b>，单买 `让胜(-1)`
                    极易卡盘，务必补防 `让球平`！
                  </p>
                </div>

                <div className="manual-card">
                  <h4>3️⃣ 同义错价替换（白捡 5%~12% 额外奖金）</h4>
                  <p>
                    体彩五大奖池独立调整赔率，经常出现
                    <b>表达完全相同赛果但赔率一高一低</b>：
                  </p>
                  <ul>
                    <li>
                      买 `总进球·0球` 与买 `比分·0:0` 100%
                      是同一件事，哪个高买哪个！
                    </li>
                    <li>
                      买 `让球(-1)让负`（客队不败）与买 `胜平负·平+负`
                      平均配平也是同一件事！审单台一旦发现更优入口会直接弹出
                      <b>「💰 一键替换」</b>。
                    </li>
                  </ul>
                </div>

                <div className="manual-card">
                  <h4>4️⃣ 合成单关、漏网死角、四舍六入五成双与封顶</h4>
                  <ul>
                    <li>
                      <b>借道合成单关</b>
                      ：胜平负未开单关时，勾选默认开单关的半全场 `胜胜 + 平胜`
                      即可单买主胜，但要留意客队半场先进球下半场被逆转（`负胜`，约占
                      4%~6%）的<b>漏网死角</b>。
                    </li>
                    <li>
                      <b>四舍六入五成双</b>：体彩官方规定先算<b>单注 2 元</b>
                      奖金保留到分（逢五看前一位奇进偶舍），再乘以倍数，绝非总金额直乘。
                    </li>
                    <li>
                      <b>法定单注封顶</b>：单关 10万、2/3关 20万、4/5关
                      50万、6~8关 100万，超额无效。
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 6: 早晚场锁利与纠偏 ==================== */}
          {currentTopic.id === "hedge" && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  ⏱️ 图解：早晚场时间差「100% 无风险锁死净利润」实战四步时间轴
                </div>
                <svg viewBox="0 0 760 150" className="manual-svg">
                  <line
                    x1="60"
                    y1="72"
                    x2="700"
                    y2="72"
                    stroke="#0ea5e9"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  {[
                    {
                      x: 110,
                      time: "20:50 出票",
                      title: "买早+晚 2串1",
                      sub: "本金 ¥100 (间隔≥135分钟)",
                      c: "#0284c7",
                    },
                    {
                      x: 310,
                      time: "22:55 早场完场",
                      title: "✅ 第一场顺利红单",
                      sub: "手握听牌活票 (身价翻倍)",
                      c: "#10b981",
                    },
                    {
                      x: 510,
                      time: "02:45 晚场开球前",
                      title: "🛡️ 按计算器补买反向",
                      sub: "如补买 ¥68 晚场受让方",
                      c: "#d97706",
                    },
                    {
                      x: 675,
                      time: "05:00 安心睡醒",
                      title: "💰 左右稳锁正收益",
                      sub: "无论谁赢总奖金>¥168! (补时临界区自动预警)",
                      c: "#16a34a",
                    },
                  ].map((p) => (
                    <g key={p.time}>
                      <circle
                        cx={p.x}
                        cy="72"
                        r="10"
                        fill={p.c}
                        stroke="#fff"
                        strokeWidth="2.5"
                      />
                      <text
                        x={p.x}
                        y="42"
                        textAnchor="middle"
                        fill={p.c}
                        fontSize="11"
                        fontWeight="700"
                      >
                        {p.time}
                      </text>
                      <text
                        x={p.x}
                        y="102"
                        textAnchor="middle"
                        fill="#0f172a"
                        fontSize="12"
                        fontWeight="700"
                      >
                        {p.title}
                      </text>
                      <text
                        x={p.x}
                        y="122"
                        textAnchor="middle"
                        fill="#64748b"
                        fontSize="10.5"
                      >
                        {p.sub}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>⚡ 具体算账例子：怎么做到无论凌晨谁赢都稳赚？</h4>
                  <p>
                    假设你花 <b>¥100</b> 买了 `20:00 早场主胜(1.85) × 03:00
                    晚场主胜(1.95)`（买 50 倍），潜在派奖 <b>¥360.75</b>。
                  </p>
                  <p>
                    22:00 早场踢完真赢了！此时去体彩店看 03:00 晚场的反向项
                    `让球(+1)客胜（即平或负）` 赔率为 <b>1.92</b>
                    。按计算器提示去店里补买 <b>¥188</b> 反向单（若平/负拿回
                    `188 × 1.92 = ¥360.96`）。
                  </p>
                  <p>
                    <b>最终总成本 `100 + 188 = ¥288`</b>
                    ，无论凌晨踢出胜、平、负任何结果，你必定拿回 <b>¥361</b>，
                    <b>躺赚 +¥73 纯利（收益率 +25.3%）</b>！
                  </p>
                </div>
                <div className="manual-card">
                  <h4>💣 串关“拖油瓶”与高抽水拖累腿体检</h4>
                  <p>
                    很多人买 3串1 喜欢硬塞一场隐含抽水高达 15% 的
                    <b>高抽水拖累腿</b>
                    凑单。串关连乘抽水会呈指数侵蚀数学期望，同时多串一场冷平风险往往把整张单子的真赚钱率拉低十几个百分点！
                  </p>
                  <p>
                    审单台会自动逐场试算剔除后的胜率跃升幅度，弹出
                    <b>「一键砍掉此场」</b>帮你瘦身提纯。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 7: 扫地僧小高双模诊断与 Price-In 消化度 ==================== */}
          {currentTopic.id === "xiaogao" && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  📊 图解：什么是「消息入价消化度（Price-In）」三种实战信号？
                </div>
                <svg viewBox="0 0 760 152" className="manual-svg">
                  <g transform="translate(18,16)">
                    <rect
                      width="232"
                      height="120"
                      rx="14"
                      fill="#fef2f2"
                      stroke="#fecaca"
                    />
                    <text
                      x="16"
                      y="28"
                      fill="#b91c1c"
                      fontSize="13"
                      fontWeight="700"
                    >
                      ① 已充分消化（接盘陷阱）
                    </text>
                    <text x="16" y="52" fill="#475569" fontSize="11">
                      例：头号射手伤停昨天已传遍全网
                    </text>
                    <text x="16" y="72" fill="#475569" fontSize="11">
                      赔率早已从 1.90 暴跌到 1.46 ▼
                    </text>
                    <text
                      x="16"
                      y="98"
                      fill="#dc2626"
                      fontSize="11.5"
                      fontWeight="700"
                    >
                      结论：油水已被榨干，再去重注纯属接盘！
                    </text>
                  </g>
                  <g transform="translate(264,16)">
                    <rect
                      width="232"
                      height="120"
                      rx="14"
                      fill="#ecfdf5"
                      stroke="#a7f3d0"
                    />
                    <text
                      x="16"
                      y="28"
                      fill="#047857"
                      fontSize="13"
                      fontWeight="700"
                    >
                      ② 尚未消化（调水滞后黄金窗）
                    </text>
                    <text x="16" y="52" fill="#475569" fontSize="11">
                      例：赛前25分钟刚出大轮换首发
                    </text>
                    <text x="16" y="72" fill="#475569" fontSize="11">
                      胜平负刚微调，半全场/进球未动
                    </text>
                    <text
                      x="16"
                      y="98"
                      fill="#059669"
                      fontSize="11.5"
                      fontWeight="700"
                    >
                      结论：体彩调水滞后，果断抓错价红利！
                    </text>
                  </g>
                  <g transform="translate(510,16)">
                    <rect
                      width="232"
                      height="120"
                      rx="14"
                      fill="#fffbeb"
                      stroke="#fde68a"
                    />
                    <text
                      x="16"
                      y="28"
                      fill="#b45309"
                      fontSize="13"
                      fontWeight="700"
                    >
                      ③ 盘面逆向背离（冷门暗雷）
                    </text>
                    <text x="16" y="52" fill="#475569" fontSize="11">
                      例：全网都在吹强队必胜
                    </text>
                    <text x="16" y="72" fill="#475569" fontSize="11">
                      强队赔率却一路亮红箭头 ▲ 上涨
                    </text>
                    <text
                      x="16"
                      y="98"
                      fill="#d97706"
                      fontSize="11.5"
                      fontWeight="700"
                    >
                      结论：机构看衰散热，严禁拿它做串关稳胆！
                    </text>
                  </g>
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>🧹 双模排雷：单场点诊 + 多场串关联合会诊</h4>
                  <ul>
                    <li>
                      <b>模式 A · 单场随时点诊（不买也能看）</b>
                      ：哪怕你不准备买某支球队，只要点击该场卡片看「底牌」，或在「小高排雷舱」的
                      <b>单场点诊栏</b>
                      直接点一下该场，小高就会单独为你拆解这场的卡盘暗雷与消息消化度。
                    </li>
                    <li>
                      <b>模式 B · 多场串关联合会诊（专治 2~8 场混合串关）</b>
                      ：当你在混合盘选了 3
                      场比赛（或在排雷舱自由勾选任意多场比赛），点击
                      <b>「🧹 一键联合会诊当前已选 N 场串关」</b>
                      ，小高会把这几场放在一起综合把脉——直接指出
                      <b>哪一场最容易成为毁掉整张串关的“老鼠屎”</b>
                      、是否存在连环爆冷共性（比如全是客场深盘强队），并给出拆成
                      2串1 或补防让平的改单方案！
                    </li>
                  </ul>
                </div>

                <div className="manual-card">
                  <h4>📒 为什么坚持「算术归算术、情报归情报」与双轨账本？</h4>
                  <p>
                    很多劣质软件让 AI
                    拍脑袋编一个胜率覆盖赔率模型，导致同一条新闻被赔率和 AI
                    重复算两次（双重扣减偏差）。在本工具中，底层泊松与凯利算术永远保持
                    100% 客观纯净，小高只给风险定性与
                    <b>滑块微调建议值（如建议往左拉 -4%）</b>
                    ，最终决策权在你手中。
                  </p>
                  <p>
                    <b>双轨止损账本（自动开奖 · 翻牌拆解 · 防上头锁死）</b>
                    ：实买真金单（朱砂实线红章）与 0
                    成本模拟观察单（虚线蓝图水印章）分轨展示并支持秒筛；记账自动封存出票固定水位与逐张实票，比赛完场后自动按中国体彩官方
                    90
                    分钟赛果核定每场红黑、局部回血与精确盈亏（早场已红还会实时提醒末场单关锁利补单）；支持
                    5
                    秒防误删撤销，且当日已亏损实买单删除后不退回止损额度，严防输钱删单上头重注！
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="manual-foot">
          <span>
            优竞体育内部专用 · 严格对齐中国体彩官方规则（四舍六入五成双 /
            法定限赔 / 1~8关）
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {currentTopic.id !== "qa" && (
              <button
                type="button"
                className="key sm"
                onClick={() => handleJumpSection("qa", false)}
              >
                💬 还有疑问？点此智能提问
              </button>
            )}
            <button type="button" className="key dark sm" onClick={onClose}>
              我已看懂，返回计算器
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
