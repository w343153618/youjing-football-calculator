import { useEffect, useState } from 'react';

export type ManualSectionId =
  | 'quickstart'
  | 'optimizer'
  | 'archetypes'
  | 'glossary'
  | 'hedge'
  | 'xiaogao';

interface ManualTopic {
  id: ManualSectionId;
  shortTitle: string;
  badge: string;
  title: string;
  subtitle: string;
  keywords: string[];
}

export const MANUAL_TOPICS: ManualTopic[] = [
  {
    id: 'quickstart',
    shortTitle: '快速上手',
    badge: '01 · 入门全流程',
    title: '30 秒看懂「优竞体育内部专用」精算五步法',
    subtitle: '从同步体彩实盘水位、识破暗扣抽水，到智能配单与线下防错出票的完整闭环',
    keywords: ['入门', '流程', '怎么用', '同步', '实票', '核对', '单关', '混合过关'],
  },
  {
    id: 'optimizer',
    shortTitle: '奖金优化图解',
    badge: '02 · 核心功能详解',
    title: '什么是平均优化 / 博热保本 / 博冷高弹？有什么好处？',
    subtitle: '图文对比「体彩默认等倍复式」为什么会中奖倒亏，以及三种智能分倍优化如何拯救收益率',
    keywords: [
      '平均优化',
      '博热保本',
      '博冷高弹',
      '奖金优化',
      '分倍',
      '等倍',
      '假中奖',
      '保本',
      '好处',
      '作用',
    ],
  },
  {
    id: 'archetypes',
    shortTitle: '五流派战术',
    badge: '03 · 智能买法推荐',
    title: '选好想买的球队后，五大流派分别适合什么战况？',
    subtitle: '铁盾保本 · 博胆护盾 · 容错防爆 · 进球结构 · 错价刺客 —— 风险与收益结构全景图',
    keywords: [
      '五流派',
      '铁盾',
      '博胆',
      '容错',
      '防爆',
      '进球结构',
      '错价刺客',
      '保守',
      '综合',
      '激进',
    ],
  },
  {
    id: 'glossary',
    shortTitle: '专业名词词典',
    badge: '04 · 精算术语白话图解',
    title: '抽水、去水真率、xG、一球卡盘、同义差价、合成单关全解',
    subtitle: '把复杂的精算数学翻译成一眼看懂的图形，不再被表面低赔率和虚假最高奖迷惑',
    keywords: [
      '返还率',
      '抽水',
      'vig',
      '去水',
      '真实胜率',
      '真率',
      '假中奖',
      '水下',
      'xG',
      '预期进球',
      '卡盘',
      '一球',
      '同义',
      '差价',
      '合成单关',
      '漏网死角',
      '四舍六入五成双',
      '封顶',
    ],
  },
  {
    id: 'hedge',
    shortTitle: '锁利与纠偏',
    badge: '05 · 实战进阶武器',
    title: '早晚场时间差 100% 锁利对冲 & 串关拖油瓶剔除',
    subtitle: '利用开球时间差提前锁定稳赚净利润，识别拉低期望值的鸡肋蚊子肉场次',
    keywords: ['对冲', '时间差', '早晚场', '锁利', '拖油瓶', '剔除', '纠偏', '腰斩', '主观微调'],
  },
  {
    id: 'xiaogao',
    shortTitle: '小高排雷与风控',
    badge: '06 · 情报与资金纪律',
    title: '扫地僧小高靶向排雷、Price-In 消化度与双轨止损账本',
    subtitle: '为什么坚持「算术归算术、情报归情报」？如何辨别诱盘旧闻与未调水黄金窗口？',
    keywords: ['扫地僧小高', '排雷', 'Price-In', '消化度', '诱盘', '降水', '模拟单', '止损', '凯利'],
  },
];

export function UserManualModal({
  open,
  initialSection = 'optimizer',
  onClose,
}: {
  open: boolean;
  initialSection?: ManualSectionId;
  onClose: () => void;
}) {
  const [activeSec, setActiveSec] = useState<ManualSectionId>(initialSection);
  const [query, setQuery] = useState('');

  // Sync section when opened from a contextual [?] button
  useEffect(() => {
    if (open && initialSection) {
      setActiveSec(initialSection);
    }
  }, [open, initialSection]);

  if (!open) return null;

  const trimmed = query.trim().toLowerCase();
  const matchedTopics = trimmed
    ? MANUAL_TOPICS.filter(
        (t) =>
          t.title.toLowerCase().includes(trimmed) ||
          t.subtitle.toLowerCase().includes(trimmed) ||
          t.shortTitle.toLowerCase().includes(trimmed) ||
          t.keywords.some((k) => k.toLowerCase().includes(trimmed))
      )
    : MANUAL_TOPICS;

  const currentTopic =
    matchedTopics.find((t) => t.id === activeSec) ?? matchedTopics[0] ?? MANUAL_TOPICS[0];

  return (
    <div className="manual-backdrop" onClick={onClose}>
      <div
        className="manual-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="优竞体育内部专用 图文说明书"
      >
        {/* Top Sticky Header */}
        <div className="manual-head">
          <div className="manual-head-title">
            <span className="manual-pill">📘 内部实战手册</span>
            <div>
              <h2>优竞体育内部专用 · 图文精算说明书</h2>
              <p>随时查阅专业名词、三种奖金优化原理、五流派战术与实战锁利图解</p>
            </div>
          </div>
          <button type="button" className="round-key" onClick={onClose} title="关闭说明书">
            ✕
          </button>
        </div>

        {/* Search + Chapter Tabs */}
        <div className="manual-toolbar">
          <div className="manual-search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <line x1="20" y1="20" x2="16.2" y2="16.2" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                const q = e.target.value.trim().toLowerCase();
                if (q) {
                  const hit = MANUAL_TOPICS.find(
                    (t) =>
                      t.title.toLowerCase().includes(q) ||
                      t.keywords.some((k) => k.toLowerCase().includes(q))
                  );
                  if (hit) setActiveSec(hit.id);
                }
              }}
              placeholder="搜功能或名词：如 平均优化、假中奖、抽水、一球卡盘、容错、对冲、Price-In..."
            />
            {query && (
              <button type="button" className="manual-clear" onClick={() => setQuery('')}>
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
                  onClick={() => setActiveSec(t.id)}
                  className={`manual-tab ${currentTopic.id === t.id ? 'on' : ''} ${!isHit ? 'dim' : ''}`}
                >
                  {t.shortTitle}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rich Illustrated Content Body */}
        <div className="manual-body">
          <div className="manual-hero-banner">
            <span className="manual-sec-badge">{currentTopic.badge}</span>
            <h3>{currentTopic.title}</h3>
            <p>{currentTopic.subtitle}</p>
          </div>

          {/* ==================== SECTION 1: 快速上手 ==================== */}
          {currentTopic.id === 'quickstart' && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">📊 图解：从看盘到打票的「五步精算防坑闭环」</div>
                <svg viewBox="0 0 760 156" className="manual-svg">
                  <defs>
                    <linearGradient id="stepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e293b" />
                      <stop offset="100%" stopColor="#0f172a" />
                    </linearGradient>
                  </defs>
                  {[
                    { x: 12, num: 'STEP 1', t: '同步实盘水位', d: '拉取体彩5大玩法', d2: '自动算抽水&真率', c: '#2563eb' },
                    { x: 162, num: 'STEP 2', t: '看底牌与排雷', d: '查泊松xG/卡1球率', d2: '请小高诊突发雷区', c: '#7c3aed' },
                    { x: 312, num: 'STEP 3', t: '五流派/手选', d: '圈定心仪对阵球队', d2: '生成5档战术方案', c: '#0d9488' },
                    { x: 462, num: 'STEP 4', t: '奖金优化审单', d: '平均/博热/博冷配平', d2: '消灭假中奖倒贴', c: '#d97706' },
                    { x: 612, num: 'STEP 5', t: '防错实票核对', d: '生成大字打票清单', d2: '逐行打钩+记入账本', c: '#16a34a' },
                  ].map((s, idx) => (
                    <g key={s.num}>
                      <rect x={s.x} y="16" width="136" height="122" rx="14" fill="url(#stepGrad)" />
                      <rect x={s.x} y="16" width="136" height="28" rx="14" fill={s.c} />
                      <text x={s.x + 68} y="35" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">
                        {s.num}
                      </text>
                      <text x={s.x + 68} y="68" textAnchor="middle" fill="#f8fafc" fontSize="13.5" fontWeight="700">
                        {s.t}
                      </text>
                      <text x={s.x + 68} y="94" textAnchor="middle" fill="#cbd5e1" fontSize="11">
                        {s.d}
                      </text>
                      <text x={s.x + 68} y="114" textAnchor="middle" fill="#94a3b8" fontSize="10.5">
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
                  <defs>
                    <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#64748b" />
                    </marker>
                  </defs>
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>📱 手机浏览器 vs 💻 电脑浏览器双形态</h4>
                  <ul>
                    <li>
                      <b>手机浏览器访问</b>：自动切换为<b>全屏单手触控布局</b>，底部四页签（赛事雷达 / 五流派 / 审单锁利 / 情报账本）+ 弹簧手势抽屉，在体彩店站着也能单手秒算。
                    </li>
                    <li>
                      <b>电脑浏览器访问</b>：自动展开为<b>三栏宽屏精算工作台</b>，左选比赛、中审注单做奖金优化、右看五流派与扫地僧小高排雷，无需来回切页，一屏统览全局。
                    </li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>🔍 赔率按钮上的两行数字分别是什么？</h4>
                  <div className="manual-mini-demo">
                    <div className="manual-demo-key">
                      <b>1.73↘</b>
                      <small>51%</small>
                    </div>
                    <div className="manual-demo-explain">
                      <p>
                        <b>上方 `1.73↘`</b>：中国体彩当前实盘固定赔率（`↘` 代表官方刚下调赔率降水，`↗` 代表升水）。
                      </p>
                      <p>
                        <b>下方 `51%`</b>：剔除体彩 12.2% 暗扣抽水后，精算还原出的<b>去水真实胜率</b>！避免你把 1.73 误以为有 58% 胜率。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 2: 奖金优化图解 ==================== */}
          {currentTopic.id === 'optimizer' && (
            <div className="manual-section">
              <div className="manual-callout warn">
                <b>⚠️ 为什么官方默认「等倍复式」是新手最大亏损源？</b>
                <p>
                  假设你花 <b>¥100</b> 同时防了 3 个赛果组合：组合A（低赔 2串1 水位 <b>2.10</b>）、组合B（中赔 <b>3.80</b>）、组合C（防冷 <b>6.50</b>）。若按体彩机器默认<b>每注等买 16 倍（共96元）</b>：一旦打出最容易出的组合A（单注返 4.20 元 × 16 倍 = <b>¥67.20</b>），你明明<b>猜中了比赛，却倒亏 ¥28.80</b>！这就是本工具重点标红的<b>「假中奖（水下组合）」</b>。
                </p>
              </div>

              {/* Graphic Comparison of Equal Multiples vs 3 Optimization Modes */}
              <div className="manual-diagram-card">
                <div className="manual-diag-title">
                  📈 图解：同样约 ¥100 预算，4 种注额分配方式在命中不同结果时的实际到手奖金对比
                </div>
                <svg viewBox="0 0 760 235" className="manual-svg">
                  {/* Baseline Cost Line */}
                  <line x1="48" y1="135" x2="735" y2="135" stroke="#ef4444" strokeDasharray="5 4" strokeWidth="1.8" />
                  <text x="732" y="18" textAnchor="end" fill="#ef4444" fontSize="10.5" fontWeight="700">
                    --- 红色虚线 = 本金回本线 ¥100（低于虚线即假中奖亏钱）
                  </text>

                  {/* Group 1: 官方默认等倍 */}
                  <g transform="translate(55, 0)">
                    <rect x="0" y="158" width="36" height="44" rx="5" fill="#ef4444" />
                    <text x="18" y="152" textAnchor="middle" fill="#ef4444" fontSize="10" fontWeight="700">¥67亏</text>
                    <rect x="42" y="102" width="36" height="100" rx="5" fill="#64748b" />
                    <text x="60" y="96" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">¥122</text>
                    <rect x="84" y="52" width="36" height="150" rx="5" fill="#64748b" />
                    <text x="102" y="46" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">¥208</text>
                    <text x="60" y="222" textAnchor="middle" fill="#0f172a" fontSize="12" fontWeight="700">
                      ❌ 默认等倍复式
                    </text>
                  </g>

                  {/* Group 2: 平均优化 */}
                  <g transform="translate(230, 0)">
                    <rect x="0" y="114" width="36" height="88" rx="5" fill="#0ea5e9" />
                    <text x="18" y="108" textAnchor="middle" fill="#0284c7" fontSize="10" fontWeight="700">¥113</text>
                    <rect x="42" y="112" width="36" height="90" rx="5" fill="#0ea5e9" />
                    <text x="60" y="106" textAnchor="middle" fill="#0284c7" fontSize="10" fontWeight="700">¥114</text>
                    <rect x="84" y="110" width="36" height="92" rx="5" fill="#0ea5e9" />
                    <text x="102" y="104" textAnchor="middle" fill="#0284c7" fontSize="10" fontWeight="700">¥117</text>
                    <text x="60" y="222" textAnchor="middle" fill="#0284c7" fontSize="12" fontWeight="700">
                      ① 平均优化 (全稳赚)
                    </text>
                  </g>

                  {/* Group 3: 博热保本优化 */}
                  <g transform="translate(405, 0)">
                    <rect x="0" y="84" width="36" height="118" rx="5" fill="#10b981" />
                    <text x="18" y="78" textAnchor="middle" fill="#059669" fontSize="10.5" fontWeight="700">¥138赚</text>
                    <rect x="42" y="132" width="36" height="70" rx="5" fill="#94a3b8" />
                    <text x="60" y="126" textAnchor="middle" fill="#475569" fontSize="10" fontWeight="600">¥102保</text>
                    <rect x="84" y="131" width="36" height="71" rx="5" fill="#94a3b8" />
                    <text x="102" y="125" textAnchor="middle" fill="#475569" fontSize="10" fontWeight="600">¥104保</text>
                    <text x="60" y="222" textAnchor="middle" fill="#059669" fontSize="12" fontWeight="700">
                      ② 博热保本 (主攻吃肉)
                    </text>
                  </g>

                  {/* Group 4: 博冷高弹优化 */}
                  <g transform="translate(580, 0)">
                    <rect x="0" y="132" width="36" height="70" rx="5" fill="#94a3b8" />
                    <text x="18" y="126" textAnchor="middle" fill="#475569" fontSize="10" fontWeight="600">¥101保</text>
                    <rect x="42" y="131" width="36" height="71" rx="5" fill="#94a3b8" />
                    <text x="60" y="125" textAnchor="middle" fill="#475569" fontSize="10" fontWeight="600">¥103保</text>
                    <rect x="84" y="34" width="36" height="168" rx="5" fill="#f59e0b" />
                    <text x="102" y="26" textAnchor="middle" fill="#d97706" fontSize="10.5" fontWeight="700">¥247暴</text>
                    <text x="60" y="222" textAnchor="middle" fill="#d97706" fontSize="12" fontWeight="700">
                      ③ 博冷高弹 (兜底暴击)
                    </text>
                  </g>

                  {/* Legend */}
                  <text x="55" y="18" fill="#64748b" fontSize="10.5">
                    每组左柱=命中热门A(2.10) · 中柱=命中次选B(3.80) · 右柱=命中冷门C(6.50)
                  </text>
                </svg>
              </div>

              <div className="manual-grid-3">
                <div className="manual-card">
                  <span className="manual-tag blue">① 平均优化（均衡派奖）</span>
                  <h4>怎么算的？</h4>
                  <p>按每注赔率的<b>反比例</b>精密分配整数倍数：低赔多投几倍、高赔少投几倍，使每个中奖组合的派奖额趋于一致。</p>
                  <h4>核心好处与适用场景</h4>
                  <ul>
                    <li><b>零假中奖</b>：只要命中任一勾选项，100% 稳拿相近正收益。</li>
                    <li><b>适合</b>：看不准主胜还是平局、想稳稳当当双选过关，不想操心打出会不会倒贴时首选。</li>
                  </ul>
                </div>

                <div className="manual-card">
                  <span className="manual-tag green">② 博热保本（主攻+护盾）</span>
                  <h4>怎么算的？</h4>
                  <p>先给防平/次选组合分配<b>恰好覆盖总本金</b>的最小整数倍（保本盾），再把剩余全部预算集中压在第一主攻方向！</p>
                  <h4>核心好处与适用场景</h4>
                  <ul>
                    <li><b>主攻多赚 35%~60%</b>：既保留了爆次选不亏钱的安全垫，又避免次选分走过多利润。</li>
                    <li><b>适合</b>：心里有明确看好的主方向，只想顺带防一手平局或让球平卡盘。</li>
                  </ul>
                </div>

                <div className="manual-card">
                  <span className="manual-tag amber">③ 博冷高弹（正路免单+博冷）</span>
                  <h4>怎么算的？</h4>
                  <p>反过来用大概率热门项做<b>免单保底防线</b>（正路打出刚好回本不亏），把溢价倍数全部倾斜给高赔冷门项！</p>
                  <h4>核心好处与适用场景</h4>
                  <ul>
                    <li><b>无痛搏高赔</b>：大热赢球你不花一分钱白看球，一旦爆冷直接翻倍暴击。</li>
                    <li><b>适合</b>：强队轮换大热升水、扫地僧小高提示「冷门未消化窗口」时使用。</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 3: 五流派战术 ==================== */}
          {currentTopic.id === 'archetypes' && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">🧭 图解：五大战术流派「稳健度 vs 爆发力」定位矩阵</div>
                <svg viewBox="0 0 760 185" className="manual-svg">
                  <rect x="40" y="16" width="680" height="142" rx="12" fill="#f8fafc" stroke="#cbd5e1" />
                  <line x1="380" y1="16" x2="380" y2="158" stroke="#cbd5e1" strokeDasharray="4 4" />
                  <line x1="40" y1="87" x2="720" y2="87" stroke="#cbd5e1" strokeDasharray="4 4" />
                  <text x="52" y="34" fill="#64748b" fontSize="10.5" fontWeight="600">高命中稳健区 →</text>
                  <text x="615" y="150" fill="#64748b" fontSize="10.5" fontWeight="600">← 高赔率爆发区</text>

                  {[
                    { x: 120, y: 55, c: '#0284c7', t: '🛡️ 铁盾保本流', s: '反比例均注 · 0假中奖' },
                    { x: 265, y: 65, c: '#059669', t: '🎯 博胆护盾流', s: '主攻重注 + 次选回本盾' },
                    { x: 390, y: 108, c: '#7c3aed', t: '🧩 容错防爆流', s: 'M串N拆组 · 错1场仍有奖' },
                    { x: 525, y: 68, c: '#0d9488', t: '🔬 进球结构流', s: '绕开胜负 · 抓2~3球密集区' },
                    { x: 640, y: 118, c: '#e11d48', t: '⚡ 错价刺客流', s: '抓调水洼地 · 自动36%轻仓' },
                  ].map((n) => (
                    <g key={n.t}>
                      <circle cx={n.x} cy={n.y} r="8" fill={n.c} />
                      <text x={n.x} y={n.y - 14} textAnchor="middle" fill="#0f172a" fontSize="12" fontWeight="700">
                        {n.t}
                      </text>
                      <text x={n.x} y={n.y + 22} textAnchor="middle" fill="#475569" fontSize="10">
                        {n.s}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>🛡️ 1. 铁盾保本流 & 🎯 2. 博胆护盾流</h4>
                  <ul>
                    <li><b>铁盾保本</b>：锁定每场概率最高的前两项做平均保本优化，只要不爆极端大冷门就能全身而退。</li>
                    <li><b>博胆护盾（默认推荐）</b>：70% 火力打双主推 2串1 吃高利润，30% 火力给最可能卡盘的那场铺一张保本盾牌，攻守兼备。</li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>🧩 3. 容错防爆流（M串N拆票）</h4>
                  <ul>
                    <li>当你选了 3 场及以上比赛时，最怕「3串1 死在最后一场补时绝平」！</li>
                    <li><b>容错防爆</b>会自动将 3 场拆成 <b>3 张 2串1</b>（或 3串4），哪怕<b>黑掉其中任意 1 场</b>，剩下命中的 2 场依然能拿回可观回血奖金！</li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>🔬 4. 进球结构流（专治强强对话/默契球）</h4>
                  <ul>
                    <li>很多比赛胜平负极难猜（比如德比战 1:1、2:1、1:2 都有可能），但<b>总进球落在 2~3 球</b>的合并真实概率往往高达 <b>48%~55%</b>！</li>
                    <li>绕开胜负平猜忌，直接捕捉泊松分布最肥美的总进球区间。</li>
                  </ul>
                </div>
                <div className="manual-card">
                  <h4>⚡ 5. 错价刺客流（内置 36% 轻仓护栏）</h4>
                  <ul>
                    <li>专门扫描让球穿盘、高水逆转或跨玩法滞后洼地，博取 4~8 倍高赔率。</li>
                    <li><b>贴心保护</b>：系统默认将刺客流投入锁在预算的 <b>36% 轻仓</b>（例如 100 元预算只花 36 元刺客试单，替你省下 64 元现金防上头），除非你主动打开全仓开关。</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 4: 专业名词词典 ==================== */}
          {currentTopic.id === 'glossary' && (
            <div className="manual-section">
              {/* Vig Funnel Diagram */}
              <div className="manual-diagram-card">
                <div className="manual-diag-title">💸 图解：体彩五大玩法「暗扣抽水率 (Vig)」真实差距（同样投 ¥100 隐性损耗）</div>
                <svg viewBox="0 0 760 148" className="manual-svg">
                  {[
                    { y: 18, name: '胜平负 / 让球胜平负', ret: '返还率 ~87.8%', vig: '暗扣 ¥12.2', w: 220, c: '#10b981' },
                    { y: 50, name: '总进球数 (TTG)', ret: '返还率 ~85.5%', vig: '暗扣 ¥14.5', w: 270, c: '#0ea5e9' },
                    { y: 82, name: '半全场胜平负 (HAFU)', ret: '返还率 ~79.7%', vig: '暗扣 ¥20.3 (重灾区!)', w: 380, c: '#f59e0b' },
                    { y: 114, name: '全场比分 (CRS)', ret: '返还率 ~78.5%', vig: '暗扣 ¥21.5 (娱乐轻仓)', w: 405, c: '#ef4444' },
                  ].map((r) => (
                    <g key={r.name}>
                      <text x="16" y={r.y + 15} fill="#0f172a" fontSize="11.5" fontWeight="600">
                        {r.name}
                      </text>
                      <rect x="175" y={r.y} width="420" height="20" rx="6" fill="#e2e8f0" />
                      <rect x="175" y={r.y} width={r.w} height="20" rx="6" fill={r.c} />
                      <text x={184} y={r.y + 14} fill="#fff" fontSize="10.5" fontWeight="700">
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
                  <h4>1️⃣ 返还率 & 去水真实胜率 (Fair Prob)</h4>
                  <p>
                    公式：把某玩法全部选项赔率求倒数相加 <b>Σ (1 ÷ 赔率)</b>。比如主胜 1.73、平 3.45、客胜 3.95，倒数和 = 1.121，返还率就是 <b>1 ÷ 1.121 = 89.2%</b>，暗扣抽水 <b>10.8%</b>。
                  </p>
                  <p>
                    <b>去水真率</b>：将虚高的表面概率除以 1.121 挤干水分，才是庄家精算模型眼里的<b>真实发生概率</b>。如果两场 88% 返还率的比赛串成 2串1，复合返还率只剩 <b>0.88 × 0.88 = 77.4%</b>！所以串关越长抽水越狠。
                  </p>
                </div>

                <div className="manual-card">
                  <h4>2️⃣ 预期进球 (xG) & 一球小胜卡盘率</h4>
                  <p>
                    系统利用同场 31 个比分赔率与 8 个总进球赔率，通过<b>泊松分布逆向还原</b>出双方精算预期进球（如 `波兰 1.62 : 0.88 瑞典`）。
                  </p>
                  <p>
                    <b>一球卡盘温度计</b>：统计主胜所有比分里 `1:0 / 2:1 / 3:2` 净胜恰好 1 球的占比。若超过 <b>48%</b>，说明强队大概率小胜即收兵，盲目贪高赔买 `让胜(-1)` 极易死在「让球平」上！
                  </p>
                </div>

                <div className="manual-card">
                  <h4>3️⃣ 同义错价替换 (Equivalent Arbitrage)</h4>
                  <p>
                    体彩不同玩法奖池独立调水，经常出现<b>同一件事在两个入口赔率不同</b>！
                  </p>
                  <ul>
                    <li>例 A：买 `总进球·0球` 赔率 <b>9.50</b>，而买完全等价的 `比分·0:0` 赔率却是 <b>10.50</b> —— 直接白捡 <b>+10.5%</b> 奖金！</li>
                    <li>例 B：买 `让球(+1)让胜`（即主不败）赔率 1.42，有时不如用 `胜平负·主胜 + 平` 做平均优化后的合成等效水位 1.47 划算。系统会自动扫描并弹出「💰省钱替换」按钮。</li>
                  </ul>
                </div>

                <div className="manual-card">
                  <h4>4️⃣ 合成单关 & 四舍六入五成双 & 封顶红线</h4>
                  <ul>
                    <li><b>合成单关</b>：当心仪场次的胜平负没开单关（强制2串1），系统会帮你测算能否借道默认开单关的「半全场（如胜胜+平胜）」或「总进球」合成单关，并警示漏防 `负胜` 逆转的<b>漏网死角概率</b>。</li>
                    <li><b>四舍六入五成双</b>：体彩官方规定必须先算<b>单注 2 元</b>奖金并按奇偶银行家舍入保留分位，最后再乘倍数（绝非总金额直接相乘）。</li>
                    <li><b>法定封顶</b>：单注最高赔付 2/3关 <b>20万</b>、4/5关 <b>50万</b>、6~8关 <b>100万</b>，超额部分打多少倍都会被无偿截断。</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 5: 锁利与纠偏 ==================== */}
          {currentTopic.id === 'hedge' && (
            <div className="manual-section">
              <div className="manual-diagram-card">
                <div className="manual-diag-title">⏱️ 图解：早晚场时间差「100% 稳赚锁利对冲」操作时间轴</div>
                <svg viewBox="0 0 760 150" className="manual-svg">
                  <line x1="60" y1="72" x2="700" y2="72" stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round" />
                  {[
                    { x: 110, time: '20:50 出票', title: '买早+晚 2串1', sub: '本金 ¥100 (早场先踢)', c: '#0284c7' },
                    { x: 310, time: '22:55 早场完场', title: '✅ 第一场红单！', sub: '手握听牌活票 (价值跃升)', c: '#10b981' },
                    { x: 510, time: '02:45 晚场开球前', title: '🛡️ 补买晚场反向单', sub: '按本工具算出精确对冲额', c: '#d97706' },
                    { x: 675, time: '05:00 全场结束', title: '💰 左右100%双赢', sub: '无论谁赢均锁定纯利!', c: '#16a34a' },
                  ].map((p) => (
                    <g key={p.time}>
                      <circle cx={p.x} cy="72" r="10" fill={p.c} stroke="#fff" strokeWidth="2.5" />
                      <text x={p.x} y="42" textAnchor="middle" fill={p.c} fontSize="11" fontWeight="700">
                        {p.time}
                      </text>
                      <text x={p.x} y="102" textAnchor="middle" fill="#0f172a" fontSize="12" fontWeight="700">
                        {p.title}
                      </text>
                      <text x={p.x} y="122" textAnchor="middle" fill="#64748b" fontSize="10.5">
                        {p.sub}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>⚡ 为什么要故意挑「一早一晚」两场串关？</h4>
                  <p>
                    如果两场比赛都在 21:00 同时开球，第一场踢完前你根本来不及操作第二场；但如果你挑一场 <b>21:00</b> 搭配一场 <b>03:00</b>，一旦 21:00 顺利拿下，你的 2串1 活票就已经增值！此时打开「审单锁利」页签的<b>时间差锁利计算器</b>，照着给出的补单金额补一手反向（如受让球），就能在半夜睡觉前提前把<b>无风险净利润</b>装进口袋。
                  </p>
                </div>
                <div className="manual-card">
                  <h4>✂️ 串关「拖油瓶剔除」与「腰斩延期沙盒」</h4>
                  <ul>
                    <li><b>拖油瓶诊断</b>：很多人喜欢硬凑一场 1.25 超低水强队凑串关，殊不知该场抽水 12% 加上爆冷概率，会让整张单子的真实赚钱率暴跌。系统会自动揪出期望值最低的那一场，一键剔除。</li>
                    <li><b>首场腰斩模拟</b>：比赛因暴雨延期超过 36 小时按体彩规则赔率算 `1.0`。打开沙盒开关即可预演极端情况下会不会跌破本金线。</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ==================== SECTION 6: 扫地僧小高与风控 ==================== */}
          {currentTopic.id === 'xiaogao' && (
            <div className="manual-section">
              <div className="manual-grid-2">
                <div className="manual-card">
                  <h4>🧹 扫地僧小高靶向排雷 & Price-In 消化度</h4>
                  <p>
                    点击任一场比赛的<b>「请扫地僧小高实时排雷」</b>，或粘贴你在群里/新闻里看到的突发伤停、轮换传闻，小高会结合当前体彩实盘水位、去水真率、xG 与一球卡盘率进行交叉审计：
                  </p>
                  <ul>
                    <li><b>已充分消化 (Priced-In)</b>：比如主力前锋昨天就宣布伤缺，体彩水位早已从 1.55 升到 1.88 —— 此时切勿重复恐慌杀跌！</li>
                    <li><b>调水滞后窗口 (Not Priced-In)</b>：赛前 40 分钟刚出替补大轮换名单，而体彩官方固定赔率还没来得及大调 —— 这才是真正值得重锤或避险的情报窗口！</li>
                  </ul>
                </div>

                <div className="manual-card">
                  <h4>🛡️ 为什么坚持「算术归算术、情报归情报」？</h4>
                  <p>
                    很多劣质预测软件让大模型直接瞎编一个胜率（比如拍脑袋说主胜 75%）去覆盖赔率模型，这会造成致命的<b>双重扣减 (Double-Counting)</b> 误差！
                  </p>
                  <p>
                    在「优竞体育内部专用」中：<b>底层泊松与凯利算术引擎</b>永远保持 100% 客观严谨；扫地僧小高只提供定性风险点与<b>主观微调建议值（如 -3%）</b>，最终是否拉动「主观信心滑块」决定权永远在你手中。
                  </p>
                </div>
              </div>

              <div className="manual-callout good">
                <b>📒 内部铁律：止损护栏与「0成本模拟观察单」</b>
                <p>
                  长期在竞彩存活不靠一晚暴富，而靠<b>不在逆风期上头翻倍追单</b>。当方案风险评分过高（&gt;65分）或接近当日额度红线时，请点击<b>「存模拟单」</b>—— 一分钱不花同样能验证你的看盘眼光，账本会自动统计「模拟单累计帮你免损多少真金白银」。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="manual-foot">
          <span>优竞体育内部专用 · 精算引擎严格对齐中国体彩官方规则（四舍六入五成双 / 法定限赔）</span>
          <button type="button" className="key dark sm" onClick={onClose}>
            我已看懂，返回计算器
          </button>
        </div>
      </div>
    </div>
  );
}
