import type { FormEvent } from "react";
import type { ManualAskResponse } from "../security/secureClient";
import {
  MANUAL_CHAPTER_SPECS,
  QUICK_QA_PILLS,
  type IllustratedManualSectionId,
  type ManualCardSpec,
  type ManualSectionId,
} from "./manualCatalog";

export type ManualPresetScenarioKind =
  "underwater" | "synthetic" | "parlay4" | "hedge2";

function renderChapterSvg(sectionId: IllustratedManualSectionId) {
  if (sectionId === "quickstart") {
    const steps = [
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
    ];
    return (
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
        {steps.map((s, idx) => (
          <g key={s.num}>
            <rect
              x={s.x}
              y="16"
              width="136"
              height="122"
              rx="14"
              fill="url(#stepGrad)"
            />
            <rect x={s.x} y="16" width="136" height="28" rx="14" fill={s.c} />
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
    );
  }

  if (sectionId === "sandbox") {
    return (
      <svg viewBox="0 0 760 198" className="manual-svg">
        <rect x="44" y="84" width="290" height="14" rx="7" fill="#fecdd3" />
        <rect x="334" y="84" width="382" height="14" rx="7" fill="#bbf7d0" />
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
        <text x="153" y="56" textAnchor="middle" fill="#475569" fontSize="10.8">
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
        <text x="356" y="56" textAnchor="middle" fill="#475569" fontSize="10.5">
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
        <text x="583" y="56" textAnchor="middle" fill="#475569" fontSize="10.8">
          “手握未调水突发利好，调高胜率测算能不能转正盈利”
        </text>
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
        <rect x="36" y="134" width="688" height="52" rx="10" fill="#0f172a" />
        <text x="50" y="155" fill="#f8fafc" fontSize="10.6" fontWeight="700">
          💡 算账实例：某场主胜赔率 1.85（客观去水真率 48%）。默认 0%
          时因体彩抽水 11%，右上角【期望 EV = -11.2%】。
        </text>
        <text x="50" y="175" fill="#6ee7b7" fontSize="10.6" fontWeight="600">
          👉 若得知对手门将热身拉伤且赔率未降，往右拉到 +15%（胜率变
          55.2%），【期望 EV 跳成 +2.1% 绿色】——值得出手！
        </text>
      </svg>
    );
  }

  if (sectionId === "optimizer") {
    const groups = [
      {
        tx: 55,
        label: "❌ 默认等倍复式",
        lc: "#0f172a",
        bars: [
          { x: 0, y: 158, h: 44, fill: "#ef4444", tc: "#ef4444", t: "¥67亏" },
          { x: 42, y: 102, h: 100, fill: "#64748b", tc: "#334155", t: "¥122" },
          { x: 84, y: 52, h: 150, fill: "#64748b", tc: "#334155", t: "¥208" },
        ],
      },
      {
        tx: 230,
        label: "① 平均优化 (严守预算配平)",
        lc: "#0284c7",
        bars: [
          { x: 0, y: 114, h: 88, fill: "#0ea5e9", tc: "#0284c7", t: "¥113" },
          { x: 42, y: 112, h: 90, fill: "#0ea5e9", tc: "#0284c7", t: "¥114" },
          { x: 84, y: 110, h: 92, fill: "#0ea5e9", tc: "#0284c7", t: "¥117" },
        ],
      },
      {
        tx: 405,
        label: "② 博热保本 (主攻吃肉)",
        lc: "#059669",
        bars: [
          { x: 0, y: 84, h: 118, fill: "#10b981", tc: "#059669", t: "¥138赚" },
          { x: 42, y: 132, h: 70, fill: "#94a3b8", tc: "#475569", t: "¥102保" },
          { x: 84, y: 131, h: 71, fill: "#94a3b8", tc: "#475569", t: "¥104保" },
        ],
      },
      {
        tx: 580,
        label: "③ 博冷高弹 (兜底暴击)",
        lc: "#d97706",
        bars: [
          { x: 0, y: 132, h: 70, fill: "#94a3b8", tc: "#475569", t: "¥101保" },
          { x: 42, y: 131, h: 71, fill: "#94a3b8", tc: "#475569", t: "¥103保" },
          { x: 84, y: 34, h: 168, fill: "#f59e0b", tc: "#d97706", t: "¥247暴" },
        ],
      },
    ];
    return (
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
          --- 红色虚线 = 本金回本线 ¥100（柱子低于红线 = 中奖反而亏钱！）
        </text>
        {groups.map((g) => (
          <g key={g.label} transform={`translate(${g.tx}, 0)`}>
            {g.bars.map((b) => (
              <g key={b.x}>
                <rect
                  x={b.x}
                  y={b.y}
                  width="36"
                  height={b.h}
                  rx="5"
                  fill={b.fill}
                />
                <text
                  x={b.x + 18}
                  y={b.y - 6}
                  textAnchor="middle"
                  fill={b.tc}
                  fontSize="10"
                  fontWeight="700"
                >
                  {b.t}
                </text>
              </g>
            ))}
            <text
              x="60"
              y="222"
              textAnchor="middle"
              fill={g.lc}
              fontSize="12"
              fontWeight="700"
            >
              {g.label}
            </text>
          </g>
        ))}
        <text x="55" y="18" fill="#64748b" fontSize="10.5">
          每组左柱=命中热门A(2.10) · 中柱=命中次选B(3.80) · 右柱=命中冷门C(6.50)
        </text>
      </svg>
    );
  }

  if (sectionId === "archetypes") {
    const nodes = [
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
    ];
    return (
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
        <text x="46" y="34" fill="#64748b" fontSize="10.5" fontWeight="600">
          高真赚钱率稳健区 →
        </text>
        <text x="580" y="160" fill="#64748b" fontSize="10.5" fontWeight="600">
          ← 跨盘α偏离轻仓区
        </text>
        {nodes.map((n) => (
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
    );
  }

  if (sectionId === "glossary") {
    const rows = [
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
    ];
    return (
      <svg viewBox="0 0 760 148" className="manual-svg">
        {rows.map((r) => (
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
            <rect x="175" y={r.y} width={r.w} height="20" rx="6" fill={r.c} />
            <text
              x="184"
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
    );
  }

  if (sectionId === "hedge") {
    const pts = [
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
        sub: "末场单关补买受让方",
        c: "#d97706",
      },
      {
        x: 675,
        time: "05:00 安心睡醒",
        title: "💰 左右锁定正收益",
        sub: "总派奖严格覆盖总成本",
        c: "#16a34a",
      },
    ];
    return (
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
        {pts.map((p) => (
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
    );
  }

  const cards = [
    {
      tx: 18,
      bg: "#fef2f2",
      bd: "#fecaca",
      hc: "#b91c1c",
      cc: "#dc2626",
      h: "① 已充分消化（接盘陷阱）",
      l1: "例：头号射手伤停昨天已传遍全网",
      l2: "赔率早已从 1.90 暴跌到 1.46 ▼",
      c: "结论：油水已被榨干，再去重注纯属接盘！",
    },
    {
      tx: 264,
      bg: "#ecfdf5",
      bd: "#a7f3d0",
      hc: "#047857",
      cc: "#059669",
      h: "② 尚未消化（调水滞后黄金窗）",
      l1: "例：赛前25分钟刚出大轮换首发",
      l2: "胜平负刚微调，半全场/进球未动",
      c: "结论：体彩调水滞后，果断抓错价红利！",
    },
    {
      tx: 510,
      bg: "#fffbeb",
      bd: "#fde68a",
      hc: "#b45309",
      cc: "#d97706",
      h: "③ 盘面逆向背离（冷门暗雷）",
      l1: "例：全网都在吹强队必胜",
      l2: "强队赔率却一路亮红箭头 ▲ 上涨",
      c: "结论：机构看衰散热，严禁拿它做串关稳胆！",
    },
  ];
  return (
    <svg viewBox="0 0 760 152" className="manual-svg">
      {cards.map((c) => (
        <g key={c.h} transform={`translate(${c.tx},16)`}>
          <rect width="232" height="120" rx="14" fill={c.bg} stroke={c.bd} />
          <text x="16" y="28" fill={c.hc} fontSize="13" fontWeight="700">
            {c.h}
          </text>
          <text x="16" y="52" fill="#475569" fontSize="11">
            {c.l1}
          </text>
          <text x="16" y="72" fill="#475569" fontSize="11">
            {c.l2}
          </text>
          <text x="16" y="98" fill={c.cc} fontSize="11.5" fontWeight="700">
            {c.c}
          </text>
        </g>
      ))}
    </svg>
  );
}

function renderManualCard(card: ManualCardSpec) {
  return (
    <div key={card.title + (card.tag?.text ?? "")} className="manual-card">
      {card.tag && (
        <span className={`manual-tag ${card.tag.tone}`}>{card.tag.text}</span>
      )}
      <h4>{card.title}</h4>
      {card.oddsKeyDemo && (
        <div className="manual-mini-demo">
          <div className="manual-demo-key">
            <b>
              {card.oddsKeyDemo.odds}{" "}
              <span style={{ color: "#10b981" }}>{card.oddsKeyDemo.arrow}</span>
            </b>
            <small>{card.oddsKeyDemo.fairPct}</small>
          </div>
          <div className="manual-demo-explain">
            {card.oddsKeyDemo.lines.map((ln) => (
              <p key={ln.lead}>
                <b>{ln.lead}</b>：{ln.text}
              </p>
            ))}
          </div>
        </div>
      )}
      {card.paragraphs?.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {card.subTitle && <h4>{card.subTitle}</h4>}
      {card.bullets && (
        <ul>
          {card.bullets.map((b, i) => (
            <li key={b.lead ?? i}>
              {b.lead ? (
                <>
                  <b>{b.lead}</b>：{b.text}
                </>
              ) : (
                b.text
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ManualChapterContent({
  sectionId,
  onLoadPresetScenario,
  onClose,
}: {
  sectionId: IllustratedManualSectionId;
  onLoadPresetScenario?: (kind: ManualPresetScenarioKind) => void;
  onClose: () => void;
}) {
  const spec = MANUAL_CHAPTER_SPECS[sectionId];
  const diagramNode = (
    <div className="manual-diagram-card">
      <div className="manual-diag-title">{spec.diagramTitle}</div>
      {renderChapterSvg(sectionId)}
    </div>
  );

  return (
    <div className="manual-section">
      {spec.diagramPosition !== "after-callouts" && diagramNode}
      {spec.callouts?.map((co) => (
        <div
          key={co.title}
          className={`manual-callout ${co.tone}`}
          style={{ marginBottom: 12 }}
        >
          <b>{co.title}</b>
          <p style={{ margin: "4px 0 0", lineHeight: 1.65 }}>{co.body}</p>
        </div>
      ))}
      {spec.diagramPosition === "after-callouts" && diagramNode}
      {spec.presetScenarios && onLoadPresetScenario && (
        <div className="manual-card" style={{ marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>
            🎬 经典精算教学牌例（一键载入到③审单台实操体验）
          </h4>
          <p style={{ marginBottom: 10 }}>
            把首屏空间留给真实选球，教学演示统一收纳于此；点任一牌例立即载入对应典型对阵并进入审单锁利：
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {spec.presetScenarios.map((ps) => (
              <button
                key={ps.kind}
                type="button"
                className="key sm"
                onClick={() => {
                  onLoadPresetScenario(ps.kind);
                  onClose();
                }}
              >
                {ps.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {spec.cardGroups.map((grp, idx) => (
        <div
          key={idx}
          className={grp.columns === 3 ? "manual-grid-3" : "manual-grid-2"}
        >
          {grp.cards.map(renderManualCard)}
        </div>
      ))}
    </div>
  );
}

export function ManualQaSection({
  askInput,
  asking,
  qaError,
  qaHistory,
  onAskInputChange,
  onSubmitForm,
  onSubmitPill,
  onJumpSection,
}: {
  askInput: string;
  asking: boolean;
  qaError: string | null;
  qaHistory: Array<{ id: string; q: string; res: ManualAskResponse }>;
  onAskInputChange: (val: string) => void;
  onSubmitForm: (e: FormEvent) => void;
  onSubmitPill: (q: string) => void;
  onJumpSection: (sec: ManualSectionId) => void;
}) {
  return (
    <div className="manual-section">
      <div className="manual-card" style={{ marginBottom: 14 }}>
        <h4 style={{ marginTop: 0 }}>
          💬 向「内部说明书助手」直接提问（严格锚定本 APP 真实功能）
        </h4>
        <form
          onSubmit={onSubmitForm}
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
            onChange={(e) => onAskInputChange(e.target.value)}
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
          <button type="submit" disabled={asking} className="key dark sm">
            {asking ? "正在结合本APP功能解答..." : "立即提问解答"}
          </button>
        </form>

        <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 8 }}>
          🔥 一键点选高频疑问（0毫秒秒回）：
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {QUICK_QA_PILLS.map((qText) => (
            <button
              key={qText}
              type="button"
              disabled={asking}
              onClick={() => onSubmitPill(qText)}
              className="key mini"
              style={{ textAlign: "left", height: "auto", padding: "5px 9px" }}
            >
              {qText}
            </button>
          ))}
        </div>
      </div>

      {qaError && (
        <div className="manual-callout warn" style={{ marginBottom: 12 }}>
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
          <p style={{ whiteSpace: "pre-line", margin: 0, lineHeight: 1.7 }}>
            {item.res.answer}
          </p>
          {item.res.jumpSection && item.res.jumpSection !== "qa" && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="key mini dark"
                onClick={() => onJumpSection(item.res.jumpSection!)}
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
  );
}
