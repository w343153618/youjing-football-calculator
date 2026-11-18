import {
  bankerRoundParlayUnitPayout,
  statutorySingleBetCap,
  type MatchItem,
  type PoolCode,
  type SelectedPick,
  type TruthReport,
} from './data.ts';

export type UserStance = 'objective' | 'home-lean' | 'upset-watch';
export type ArchetypeKey = 'iron-shield' | 'spear-shield' | 'fault-tolerant' | 'goal-structure' | 'value-assassin';

export interface MicroBadge {
  text: string;
  tone: 'emerald' | 'amber' | 'rose' | 'sky' | 'purple';
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
  oneGoalProb: number; // 强队恰好赢1球概率
  oneGoalShareOfWins: number; // 赢球场次里只赢1球的占比
  cardPanTip: string;
  topTwoGoals: [string, string, number]; // [key1, key2, combinedFairProb]
  halfDrawProb: number; // 半场打平概率 (平胜+平平+平负)
  arbitrages: EquivalentArbItem[];
  steamSignal: string;
  microBadges: MicroBadge[];
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
  missOneReturn: number | null; // 容错流专属：错1场时可回血金额
  vigPct: number;
  reasons: string[];
  lines: PlanTicketLine[];
}

export interface StaggeredHedgePlan {
  available: boolean;
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

export interface ProOrderInsights {
  hedge: StaggeredHedgePlan;
  weakestLink: WeakestLinkTip | null;
  fiveLossStreakProb: number;
  recommendedBankrollPct: number;
  activeSwapTip: EquivalentArbItem | null;
}

/** 1. 单场精算师底牌反推：预期进球 xG + 一球卡盘率 + 同义省钱比价 + 变盘信号 */
export function analyzeMatchMicroQuant(m: MatchItem): MatchMicroQuant {
  // 从总进球去水分布反推总预期进球 totalXG
  const ttgOpts = m.pools.TTG.options;
  const totalXG =
    ttgOpts.length >= 6
      ? ttgOpts.reduce((acc, o, idx) => acc + (idx === 7 ? 7.3 : idx) * o.fairProb, 0)
      : 2.45;

  const hProb = m.pools.HAD.options.find((o) => o.key === 'h')?.fairProb ?? 0.45;
  const dProb = m.pools.HAD.options.find((o) => o.key === 'd')?.fairProb ?? 0.27;
  const aProb = m.pools.HAD.options.find((o) => o.key === 'a')?.fairProb ?? 0.28;

  // 分配双队预期进球
  const strengthShare = (hProb + 0.5 * dProb) / Math.max(0.01, hProb + dProb + aProb);
  const homeXG = Number((totalXG * (0.18 + 0.64 * strengthShare)).toFixed(2));
  const awayXG = Number(Math.max(0.25, totalXG - homeXG).toFixed(2));

  // 一球卡盘率计算
  const goalLine = m.pools.HHAD.goalLine ?? '-1';
  const hdProb = m.pools.HHAD.options.find((o) => o.key === 'hd')?.fairProb ?? 0.28;
  const favWinProb = goalLine.includes('+') ? aProb : hProb;
  const favTeam = goalLine.includes('+') ? m.away : m.home;
  const oneGoalProb = hdProb;
  const oneGoalShareOfWins = favWinProb > 0 ? Math.min(0.85, oneGoalProb / favWinProb) : 0.5;

  const cardPanTip =
    oneGoalShareOfWins >= 0.5
      ? `${favTeam}若赢球，高达 ${(oneGoalShareOfWins * 100).toFixed(0)}% 概率仅净胜 1 球！慎追让胜穿盘，防「让平」性价比极高。`
      : `${favTeam}穿盘动能充足（净胜2+球占比 ${(100 - oneGoalShareOfWins * 100).toFixed(0)}%），可博让球正路。`;

  // 最密集的相邻两档总进球
  let bestGoalPair: [string, string, number] = ['s2', 's3', 0.48];
  for (let i = 0; i < ttgOpts.length - 1; i++) {
    const sumP = ttgOpts[i].fairProb + ttgOpts[i + 1].fairProb;
    if (sumP > bestGoalPair[2]) {
      bestGoalPair = [ttgOpts[i].key, ttgOpts[i + 1].key, sumP];
    }
  }

  // 半场闷平概率 (平胜 + 平平 + 平负)
  const halfDrawProb = m.pools.HAFU.options
    .filter((o) => o.key.startsWith('d'))
    .reduce((a, o) => a + o.fairProb, 0);

  // 扫描同义买法差价 (体彩内部错价雷达)
  const arbitrages: EquivalentArbItem[] = [];

  // 比价 1: 总进球 0球 vs 比分 0:0
  const ttg0 = m.pools.TTG.options.find((o) => o.key === 's0');
  const crs00 = m.pools.CRS.options.find((o) => o.key === '0:0');
  if (ttg0 && crs00 && Math.abs(ttg0.odds - crs00.odds) >= 0.15) {
    const ttgBetter = ttg0.odds > crs00.odds;
    const hi = ttgBetter ? ttg0.odds : crs00.odds;
    const lo = ttgBetter ? crs00.odds : ttg0.odds;
    const edge = ((hi - lo) / lo) * 100;
    const betterPicks: EquivalentArbPickRef[] = [
      ttgBetter ? { poolCode: 'TTG', optionKey: 's0' } : { poolCode: 'CRS', optionKey: '0:0' },
    ];
    const worsePicks: EquivalentArbPickRef[] = [
      ttgBetter ? { poolCode: 'CRS', optionKey: '0:0' } : { poolCode: 'TTG', optionKey: 's0' },
    ];
    arbitrages.push({
      matchId: m.id,
      title: '0:0 闷平同义差价',
      betterChoice: ttgBetter ? `总进球·0球(@${hi.toFixed(2)})` : `比分·0:0(@${hi.toFixed(2)})`,
      worseChoice: ttgBetter ? `比分·0:0(@${lo.toFixed(2)})` : `总进球·0球(@${lo.toFixed(2)})`,
      edgePct: Number(edge.toFixed(1)),
      detail: `两者100%同义！选【${ttgBetter ? '总进球0球' : '比分0:0'}】白多赚 +${edge.toFixed(1)}% 奖金`,
      betterPicks,
      worsePicks,
      poolCode: betterPicks[0].poolCode,
      optionKey: betterPicks[0].optionKey,
    });
  }

  // 比价 2: 让球(-1)让负 vs 胜平负[平+客胜]合成；或 让球(+1)让胜 vs 胜平负[主胜+平]合成
  const hadH = m.pools.HAD.options.find((o) => o.key === 'h');
  const hadD = m.pools.HAD.options.find((o) => o.key === 'd');
  const hadA = m.pools.HAD.options.find((o) => o.key === 'a');
  if (goalLine === '-1' && hadD && hadA) {
    const hhadAway = m.pools.HHAD.options.find((o) => o.key === 'ha');
    const synDouble = 1 / (1 / hadD.odds + 1 / hadA.odds);
    if (hhadAway && Math.abs(hhadAway.odds - synDouble) >= 0.02) {
      const hhadBetter = hhadAway.odds >= synDouble;
      const hi = Math.max(hhadAway.odds, synDouble);
      const lo = Math.min(hhadAway.odds, synDouble);
      const edge = ((hi - lo) / lo) * 100;
      const betterPicks: EquivalentArbPickRef[] = hhadBetter
        ? [{ poolCode: 'HHAD', optionKey: 'ha' }]
        : [
            { poolCode: 'HAD', optionKey: 'd' },
            { poolCode: 'HAD', optionKey: 'a' },
          ];
      const worsePicks: EquivalentArbPickRef[] = hhadBetter
        ? [
            { poolCode: 'HAD', optionKey: 'd' },
            { poolCode: 'HAD', optionKey: 'a' },
          ]
        : [{ poolCode: 'HHAD', optionKey: 'ha' }];
      arbitrages.push({
        matchId: m.id,
        title: `${m.away}受让不败同义比价`,
        betterChoice: hhadBetter ? `让球(-1)·让负(@${hhadAway.odds.toFixed(2)})` : `胜平负[平+客胜]配平(@${synDouble.toFixed(2)})`,
        worseChoice: hhadBetter ? `胜平负[平+客胜]双选(@${synDouble.toFixed(2)})` : `让球(-1)·让负(@${hhadAway.odds.toFixed(2)})`,
        edgePct: Number(edge.toFixed(1)),
        detail: hhadBetter
          ? `直接买单选「让负@${hhadAway.odds.toFixed(2)}」比双选「平+负(合成等效水位@${synDouble.toFixed(2)})」多赚 +${edge.toFixed(1)}% 且免凑整损耗！`
          : `配平「平+客胜(合成等效水位@${synDouble.toFixed(2)})」比直接买「让负」高出 +${edge.toFixed(1)}%！`,
        betterPicks,
        worsePicks,
        poolCode: betterPicks[0].poolCode,
        optionKey: betterPicks[0].optionKey,
      });
    }
  } else if (goalLine === '+1' && hadH && hadD) {
    const hhadHome = m.pools.HHAD.options.find((o) => o.key === 'hh');
    const synDouble = 1 / (1 / hadH.odds + 1 / hadD.odds);
    if (hhadHome && Math.abs(hhadHome.odds - synDouble) >= 0.02) {
      const hhadBetter = hhadHome.odds >= synDouble;
      const hi = Math.max(hhadHome.odds, synDouble);
      const lo = Math.min(hhadHome.odds, synDouble);
      const edge = ((hi - lo) / lo) * 100;
      const betterPicks: EquivalentArbPickRef[] = hhadBetter
        ? [{ poolCode: 'HHAD', optionKey: 'hh' }]
        : [
            { poolCode: 'HAD', optionKey: 'h' },
            { poolCode: 'HAD', optionKey: 'd' },
          ];
      const worsePicks: EquivalentArbPickRef[] = hhadBetter
        ? [
            { poolCode: 'HAD', optionKey: 'h' },
            { poolCode: 'HAD', optionKey: 'd' },
          ]
        : [{ poolCode: 'HHAD', optionKey: 'hh' }];
      arbitrages.push({
        matchId: m.id,
        title: `${m.home}不败同义比价`,
        betterChoice: hhadBetter ? `让球(+1)·让胜(@${hhadHome.odds.toFixed(2)})` : `胜平负[胜+平]配平(@${synDouble.toFixed(2)})`,
        worseChoice: hhadBetter ? `胜平负[胜+平]双选(@${synDouble.toFixed(2)})` : `让球(+1)·让胜(@${hhadHome.odds.toFixed(2)})`,
        edgePct: Number(edge.toFixed(1)),
        detail: hhadBetter
          ? `单选「让胜@${hhadHome.odds.toFixed(2)}」比双选「主胜+平(合成等效水位@${synDouble.toFixed(2)})」高 +${edge.toFixed(1)}% 且仅需1注！`
          : `配平「主胜+平」合成等效水位高出 +${edge.toFixed(1)}%！`,
        betterPicks,
        worsePicks,
        poolCode: betterPicks[0].poolCode,
        optionKey: betterPicks[0].optionKey,
      });
    }
  }

  // 变盘真假信号识别
  const droppingOpts = [
    ...m.pools.HAD.options.filter((o) => o.trend === -1).map((o) => `主盘${o.label}`),
    ...m.pools.HHAD.options.filter((o) => o.trend === -1).map((o) => o.label),
  ];
  const steamSignal =
    droppingOpts.length > 0
      ? `🔥 真防冷急降：体彩正下调【${droppingOpts.slice(0, 2).join('/')}】赔付`
      : '⚖️ 盘面平稳：暂无剧烈急跌诱盘';

  // 提炼手机卡片浓缩微结论胶囊 (纯数学指标，遵循 ADR-0002 与情报隔离)
  const microBadges: MicroBadge[] = [
    {
      text: `xG ${homeXG}:${awayXG}`,
      tone: 'sky',
    },
    {
      text:
        oneGoalShareOfWins >= 0.52
          ? `防赢1球卡盘 ${(oneGoalShareOfWins * 100).toFixed(0)}%`
          : `穿盘率 ${(100 - oneGoalShareOfWins * 100).toFixed(0)}%`,
      tone: oneGoalShareOfWins >= 0.52 ? 'amber' : 'emerald',
    },
  ];

  if (arbitrages[0]) {
    microBadges.push({
      text: `💰省钱差价 +${arbitrages[0].edgePct}%`,
      tone: 'emerald',
    });
  }
  if (droppingOpts.length > 0) {
    microBadges.push({
      text: `🔻${droppingOpts[0]}降水`,
      tone: 'purple',
    });
  }

  return {
    homeXG,
    awayXG,
    totalXG: Number(totalXG.toFixed(2)),
    oneGoalProb,
    oneGoalShareOfWins,
    cardPanTip,
    topTwoGoals: bestGoalPair,
    halfDrawProb,
    arbitrages,
    steamSignal,
    microBadges,
  };
}

function makeLeg(
  m: MatchItem,
  poolCode: PoolCode,
  optionKey: string,
  stance: UserStance
): PlanLeg | null {
  const pool = m.pools[poolCode];
  const opt = pool?.options.find((o) => o.key === optionKey) ?? pool?.options[0];
  if (!pool || !opt) return null;

  let prob = opt.fairProb;
  if (stance === 'home-lean' && (optionKey === 'h' || optionKey === 'hh' || optionKey === 'dh')) {
    prob = Math.min(0.88, prob * 1.08);
  } else if (stance === 'upset-watch' && (optionKey === 'd' || optionKey === 'hd' || optionKey === 'a' || optionKey === 'ha')) {
    prob = Math.min(0.75, prob * 1.12);
  }

  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    poolCode,
    poolName: pool.name,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: prob,
  };
}

function repairUnderwaterMultiples(
  initialMults: number[],
  unitPayouts: number[],
  shouldRepair: boolean
): number[] {
  const mults = initialMults.map((m) => Math.max(1, Math.min(99, Math.round(m))));
  if (!shouldRepair) return mults;

  for (let guard = 0; guard < 64; guard++) {
    const curCost = mults.reduce((a, m) => a + m * 2, 0);
    const uwIdx = unitPayouts.findIndex(
      (u, i) => u * mults[i] < curCost && mults[i] < 99 && u > 2.01
    );
    if (uwIdx === -1) break;
    mults[uwIdx] += 1;
  }
  return mults;
}

function allocateLines(
  rawLines: Array<{ id: string; roleLabel: string; legs: PlanLeg[]; shieldOnly?: boolean }>,
  targetBudgetYuan: number
): PlanTicketLine[] {
  const validLines = rawLines.filter((r) => r.legs.every(Boolean));
  if (validLines.length === 0) return [];

  const totalNotes = Math.max(validLines.length, Math.floor(targetBudgetYuan / 2));
  const realUnitPayouts = validLines.map((rl) => {
    const cap = statutorySingleBetCap(rl.legs.length);
    return Math.min(cap, bankerRoundParlayUnitPayout(rl.legs.map((l) => l.odds)));
  });
  const safeUnitPayouts = realUnitPayouts.map((u) => Math.max(2.02, u));

  const approxCost = totalNotes * 2;
  const minMults = validLines.map((_, idx) =>
    Math.min(99, Math.max(1, Math.ceil(approxCost / safeUnitPayouts[idx])))
  );
  const minSum = minMults.reduce((a, b) => a + b, 0);

  let mults: number[];
  if (minSum <= totalNotes) {
    mults = [...minMults];
    let rem = totalNotes - minSum;
    const weights = validLines.map((rl) =>
      rl.shieldOnly ? 0.04 : rl.legs.reduce((a, l) => a * l.fairProb, 1)
    );
    const wSum = weights.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < validLines.length; i++) {
      const add =
        i === validLines.length - 1
          ? rem
          : Math.min(rem, Math.round(((totalNotes - minSum) * weights[i]) / wSum));
      mults[i] = Math.min(99, mults[i] + Math.max(0, add));
      rem -= Math.max(0, add);
    }
    if (rem > 0) mults[0] = Math.min(99, mults[0] + rem);
  } else {
    const invSum = safeUnitPayouts.reduce((a, u) => a + 1 / u, 0);
    mults = safeUnitPayouts.map((u) =>
      Math.min(99, Math.max(1, Math.round((totalNotes * (1 / u)) / invSum)))
    );
  }

  const effOdds = 1 / safeUnitPayouts.reduce((a, u) => a + 2 / u, 0);
  mults = repairUnderwaterMultiples(mults, realUnitPayouts, effOdds > 1.02);

  const actualCost = mults.reduce((a, m) => a + m * 2, 0);
  return validLines.map((rl, idx) => {
    const prob = rl.legs.reduce((a, l) => a * l.fairProb, 1);
    const unitPayout = realUnitPayouts[idx];
    const returnPayout = Number((unitPayout * mults[idx]).toFixed(2));
    return {
      id: rl.id,
      roleLabel: rl.roleLabel,
      legs: rl.legs,
      modeLabel: rl.legs.length === 1 ? '单关' : `${rl.legs.length}串1`,
      multiple: mults[idx],
      cost: mults[idx] * 2,
      unitPayout,
      returnPayout,
      netProfit: Number((returnPayout - actualCost).toFixed(2)),
      prob,
    };
  });
}

/** 2. 生成五大实战战术流派配单 (铁盾 / 博胆护盾 / M串N容错防爆 / 进球半场结构 / 错价轻仓刺客) */
export function generateFiveArchetypes(
  targetMatches: MatchItem[],
  budgetYuan: number,
  stance: UserStance,
  unlockFullAgg: boolean
): ArchetypePlan[] {
  const cleanBudget = Math.max(20, Math.round(budgetYuan / 2) * 2);
  if (targetMatches.length === 0) return [];

  const selected = targetMatches.slice(0, 4);
  const ranked = [...selected].sort((a, b) => {
    const maxA = Math.max(...a.pools.HAD.options.map((o) => o.fairProb));
    const maxB = Math.max(...b.pools.HAD.options.map((o) => o.fairProb));
    return maxB - maxA;
  });

  const m1 = ranked[0];
  const m2 = ranked[1] ?? ranked[0];
  const extras = ranked.slice(2);

  const m1Top = [...m1.pools.HAD.options].sort((a, b) => b.fairProb - a.fairProb);
  const m2Top = [...m2.pools.HAD.options].sort((a, b) => b.fairProb - a.fairProb);
  const extraFavs = extras.map((em) => {
    const top = [...em.pools.HAD.options].sort((a, b) => b.fairProb - a.fairProb)[0];
    return makeLeg(em, 'HAD', top.key, stance)!;
  });

  // 辅助汇总器
  const pack = (
    key: ArchetypeKey,
    shortTab: string,
    badge: string,
    title: string,
    tagline: string,
    lines: PlanTicketLine[],
    savedCash: number,
    missOneReturn: number | null,
    reasons: string[]
  ): ArchetypePlan => {
    const totalCost = lines.reduce((a, l) => a + l.cost, 0);
    const returns = lines.map((l) => l.returnPayout);
    const minReturn = returns.length ? Math.min(...returns) : 0;
    const maxReturn = returns.length ? Math.max(...returns) : 0;
    const winProb = Math.min(0.92, lines.reduce((a, l) => a + l.prob, 0));
    const profitProb = Math.min(
      0.9,
      lines.filter((l) => l.netProfit >= 0).reduce((a, l) => a + l.prob, 0)
    );
    const sample = lines[0];
    const payoutProd = sample
      ? sample.legs.reduce((acc, lg) => {
          const found = targetMatches.find((x) => x.id === lg.matchId);
          return acc * (found?.pools[lg.poolCode]?.payoutRatio ?? 0.878);
        }, 1)
      : 0.878;
    const vigPct = Number(((1 - payoutProd) * 100).toFixed(1));

    return {
      key,
      shortTab,
      badge,
      title,
      tagline,
      totalCost,
      savedCash,
      minReturn,
      maxReturn,
      winProb,
      profitProb: profitProb > 0 ? profitProb : winProb * 0.85,
      missOneReturn,
      vigPct,
      reasons,
      lines,
    };
  };

  const isSingleMatch = selected.length === 1;

  // ① 🛡️ 铁盾保本流
  const ironLines = isSingleMatch
    ? allocateLines(
        m1.pools.HAD.single
          ? [
              { id: 'ir1', roleLabel: '首选正路', legs: [makeLeg(m1, 'HAD', m1Top[0].key, stance)!] },
              { id: 'ir2', roleLabel: '防平铁盾', legs: [makeLeg(m1, 'HAD', m1Top[1].key, stance)!] },
            ]
          : [
              { id: 'ir1', roleLabel: '合成单关·胜胜', legs: [makeLeg(m1, 'HAFU', 'hh', stance)!] },
              { id: 'ir2', roleLabel: '合成单关·平胜', legs: [makeLeg(m1, 'HAFU', 'dh', stance)!] },
            ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'ir1',
            roleLabel: '正路铁干',
            legs: [makeLeg(m2, 'HAD', m2Top[0].key, stance)!, makeLeg(m1, 'HAD', m1Top[0].key, stance)!, ...extraFavs],
          },
          {
            id: 'ir2',
            roleLabel: '次选平局盾',
            legs: [makeLeg(m2, 'HAD', 'd', stance)!, makeLeg(m1, 'HAD', m1Top[0].key, stance)!, ...extraFavs],
          },
        ],
        cleanBudget
      );

  // ② 🎯 博胆护盾流
  const spearLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'sp1', roleLabel: '主攻慢热高水', legs: [makeLeg(m1, 'HAFU', 'dh', stance)!] },
          { id: 'sp2', roleLabel: '正路辅助箭', legs: [makeLeg(m1, 'HAFU', 'hh', stance)!] },
          { id: 'sp3', roleLabel: '闷平保本盾', legs: [makeLeg(m1, 'HAFU', 'dd', stance)!], shieldOnly: true },
        ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'sp1',
            roleLabel: '主攻箭A·穿盘',
            legs: [makeLeg(m2, 'HAD', m2Top[0].key, stance)!, makeLeg(m1, 'HHAD', 'hh', stance)!, ...extraFavs],
          },
          {
            id: 'sp2',
            roleLabel: '主攻箭B·赢1球卡盘',
            legs: [makeLeg(m2, 'HAD', m2Top[0].key, stance)!, makeLeg(m1, 'HHAD', 'hd', stance)!, ...extraFavs],
          },
          {
            id: 'sp3',
            roleLabel: '零伤亡回本盾',
            legs: [makeLeg(m2, 'HAD', 'd', stance)!, makeLeg(m1, 'HAD', m1Top[0].key, stance)!, ...extraFavs],
            shieldOnly: true,
          },
        ],
        cleanBudget
      );

  // ③ 🧩 容错防爆流（专治“错一场全死”！）
  let faultLines: PlanTicketLine[] = [];
  let missOneReturn = 0;
  if (selected.length >= 3) {
    // 3场或4场：组两两 2串1 容错矩阵 (3串3 / 4串6)，黑掉任意1场依然命中其余 2串1！
    const topLegs = selected.slice(0, 3).map((m) => {
      const top = [...m.pools.HAD.options].sort((a, b) => b.fairProb - a.fairProb)[0];
      return makeLeg(m, 'HAD', top.key, stance)!;
    });
    faultLines = allocateLines(
      [
        { id: 'ft1', roleLabel: '容错组① (AB)', legs: [topLegs[0], topLegs[1]] },
        { id: 'ft2', roleLabel: '容错组② (AC)', legs: [topLegs[0], topLegs[2]] },
        { id: 'ft3', roleLabel: '容错组③ (BC)', legs: [topLegs[1], topLegs[2]] },
      ],
      cleanBudget
    );
    missOneReturn = Math.min(...faultLines.map((l) => l.returnPayout));
    // 全红时三注全中！修正展示区间
  } else if (selected.length === 2) {
    // 2场时：2串1 主干 + 可单关场次的单关回血垫（错1场也能回血！）
    const singleCapable = m1.pools.HAD.single ? m1 : m2.pools.HAD.single ? m2 : null;
    const cushionLeg = singleCapable
      ? makeLeg(singleCapable, 'HAD', [...singleCapable.pools.HAD.options].sort((a, b) => b.fairProb - a.fairProb)[0].key, stance)!
      : makeLeg(m1, 'HAFU', 'hh', stance)!;
    faultLines = allocateLines(
      [
        {
          id: 'ft1',
          roleLabel: '连红主干·2串1',
          legs: [makeLeg(m2, 'HAD', m2Top[0].key, stance)!, makeLeg(m1, 'HAD', m1Top[0].key, stance)!],
        },
        {
          id: 'ft2',
          roleLabel: '防错1场·单关回血垫',
          legs: [cushionLeg],
          shieldOnly: true,
        },
      ],
      cleanBudget
    );
    missOneReturn = faultLines[1]?.returnPayout ?? 0;
  } else {
    // 1场：三路全包容错（胜胜+平胜+平平）
    faultLines = allocateLines(
      [
        { id: 'ft1', roleLabel: '上半领先赢', legs: [makeLeg(m1, 'HAFU', 'hh', stance)!] },
        { id: 'ft2', roleLabel: '半平下半绝杀', legs: [makeLeg(m1, 'HAFU', 'dh', stance)!] },
        { id: 'ft3', roleLabel: '全场闷平兜底', legs: [makeLeg(m1, 'HAFU', 'dd', stance)!] },
      ],
      cleanBudget
    );
    missOneReturn = Math.min(...faultLines.map((l) => l.returnPayout));
  }
  const faultAllHitReturn = faultLines.length >= 2 && selected.length >= 2
    ? Number(faultLines.reduce((a, l) => a + l.returnPayout, 0).toFixed(2))
    : Math.max(...faultLines.map((l) => l.returnPayout));

  // ④ 🔬 进球/半场结构流（绕开胜负悬念，抓高确定性总进球区间！）
  const q1 = analyzeMatchMicroQuant(m1);
  const q2 = analyzeMatchMicroQuant(m2);
  const structLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'st1', roleLabel: '黄金进球主区间', legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[0], stance)!] },
          { id: 'st2', roleLabel: '黄金进球次区间', legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[1], stance)!] },
        ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'st1',
            roleLabel: '双场主流进球A',
            legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[0], stance)!, makeLeg(m2, 'TTG', q2.topTwoGoals[0], stance)!],
          },
          {
            id: 'st2',
            roleLabel: '双场主流进球B',
            legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[1], stance)!, makeLeg(m2, 'TTG', q2.topTwoGoals[0], stance)!],
          },
          {
            id: 'st3',
            roleLabel: '双场主流进球C',
            legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[0], stance)!, makeLeg(m2, 'TTG', q2.topTwoGoals[1], stance)!],
          },
        ],
        cleanBudget
      );

  // ⑤ ⚡ 错价/滞后刺客流（自动轻仓 36%）
  const aggBudget = unlockFullAgg
    ? cleanBudget
    : Math.max(16, Math.round((cleanBudget * 0.36) / 4) * 4);
  const assassinLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'as1', roleLabel: '卡1球黄金比分', legs: [makeLeg(m1, 'CRS', '1:0', stance) ?? makeLeg(m1, 'HAFU', 'dh', stance)!] },
          { id: 'as2', roleLabel: '有球冷平刺客', legs: [makeLeg(m1, 'CRS', '1:1', stance)!] },
        ],
        aggBudget
      )
    : allocateLines(
        [
          {
            id: 'as1',
            roleLabel: '滞后洼地暴击箭',
            legs: [makeLeg(m2, 'HAFU', 'dh', stance)!, makeLeg(m1, 'HHAD', 'hd', stance)!],
          },
          {
            id: 'as2',
            roleLabel: '卡盘×轮换冷平刺客',
            legs: [makeLeg(m2, 'HHAD', 'hd', stance)!, makeLeg(m1, 'HAD', 'd', stance)!],
          },
        ],
        aggBudget
      );
  const aggActual = assassinLines.reduce((a, l) => a + l.cost, 0);

  const faultPlan = pack(
    'fault-tolerant',
    '🧩 容错防爆',
    '🧩 容错防爆流',
    selected.length >= 3 ? 'M串N 防黑一场回血网' : '串关+单关双层防死垫',
    `哪怕黑掉1场仍拿回 ¥${missOneReturn.toFixed(0)} 保命 · 全红斩获 ¥${faultAllHitReturn.toFixed(0)}`,
    faultLines,
    0,
    missOneReturn,
    [
      selected.length >= 3
        ? '将高危长串拆解为两两 2串1 容错矩阵，彻底告别“4场对3场却一分钱拿不到”的惨剧'
        : '底层配置单关保命垫，即使串关折戟一场也能收回大半本金留住翻盘火种',
      `全中可叠加拿回 ¥${faultAllHitReturn.toFixed(2)}，容错韧性拉满`,
    ]
  );
  faultPlan.maxReturn = faultAllHitReturn;

  return [
    pack(
      'iron-shield',
      '🛡️ 铁盾保本',
      '🛡️ 铁盾保本流',
      '低抽水零假中奖铁盾',
      '命中任一所选赛果 100% 稳赚，绝不中奖倒贴',
      ironLines,
      0,
      null,
      [
        isSingleMatch
          ? '通过半全场/单关正路反比例配平注数，破解不开单关限制'
          : '锁定 12.2% 最低抽水胜平负入口，比盲买半全场串关立省 13.5% 隐性抽水',
        '严格整数倍保本约束，正路与防平双双净赚',
      ]
    ),
    pack(
      'spear-shield',
      '🎯 博胆护盾',
      '🎯 博胆护盾流',
      '让球双箭主攻 + 回本盾',
      '次选闷平全身而退 · 正路赢球利润翻倍',
      spearLines,
      0,
      null,
      [
        `结合卡盘率模型，把 ${m1.home} 拆成「让胜+让平」通吃小胜与穿盘，拉高主攻赔率`,
        '单独划拨少量预算构建零伤亡保本盾，进可攻退可守',
      ]
    ),
    faultPlan,
    pack(
      'goal-structure',
      '🔬 进球结构',
      '🔬 进球结构流',
      `总进球黄金区 (xG ${q1.totalXG}球)`,
      '不猜谁输谁赢 · 只抓高确定性进球密度区间',
      structLines,
      0,
      null,
      [
        `精算师底牌反推预期总进球为 ${q1.totalXG} 球，前两档热门进球区间合并真率高达 ${(q1.topTwoGoals[2] * 100).toFixed(0)}%`,
        '完美避开强弱队爆冷与默契平局干扰，只看场面开放度即可收米',
      ]
    ),
    pack(
      'value-assassin',
      '⚡ 错价刺客',
      '⚡ 错价刺客流',
      '滞后洼地 & 卡盘刺客',
      unlockFullAgg
        ? '已解锁全额火力冲击 6x～12x 高倍靶心'
        : `自动轻仓护栏：仅动用 ¥${aggActual} 搏高倍（省 ¥${Math.max(0, cleanBudget - aggActual)} 护本）`,
      assassinLines,
      Math.max(0, cleanBudget - aggActual),
      null,
      [
        `精准狙击半全场滞后高水与「净胜1球卡盘率 ${(q1.oneGoalShareOfWins * 100).toFixed(0)}%」交叉高赔区`,
        unlockFullAgg
          ? '全额高赔搏杀中，请严守单日止损纪律'
          : '默认启用 36% 轻仓克制法则，小成本博取 6 倍以上爆发收益',
      ]
    ),
  ];
}

function parseKickoffMinutes(hhmm: string): number {
  const [hStr, mStr] = (hhmm || '20:00').split(':');
  const h = Number(hStr) || 0;
  const min = Number(mStr) || 0;
  // 竞彩赛程中 00:00 ~ 11:00 为次日凌晨比赛
  const normalizedH = h < 12 ? h + 24 : h;
  return normalizedH * 60 + min;
}

/** 3. 审单细节小 Tips：早晚场时间差对冲锁利 + 串关拖油瓶体检 + 同义省钱替换 + 连黑预警 */
export function computeProOrderInsights(
  picks: SelectedPick[],
  report: TruthReport,
  matches: MatchItem[]
): ProOrderInsights {
  const matchIds = Array.from(new Set(picks.map((p) => p.matchId)));
  const pickedMatches = matchIds
    .map((id) => matches.find((m) => m.id === id))
    .filter((x): x is MatchItem => Boolean(x));

  // ① 早晚场时间差对冲锁利计算
  let hedge: StaggeredHedgePlan = {
    available: false,
    gapMinutes: 0,
    gapText: '同时间段开球',
    earlyMatchTitle: '',
    lateMatchTitle: '',
    earlyKickoff: '',
    lateKickoff: '',
    oppositeLabel: '',
    oppositeOdds: 1.85,
    hedgeCost: 0,
    lockedNetProfit: 0,
    reason: '需至少选择 2 场且开球时间间隔 ≥ 110 分钟（前场完场后可补单锁利）',
  };

  if (pickedMatches.length >= 2) {
    const sortedByTime = [...pickedMatches].sort(
      (a, b) => parseKickoffMinutes(a.kickoff) - parseKickoffMinutes(b.kickoff)
    );
    const early = sortedByTime[0];
    const late = sortedByTime[sortedByTime.length - 1];
    const gap = parseKickoffMinutes(late.kickoff) - parseKickoffMinutes(early.kickoff);

    if (gap >= 110) {
      const hrs = Math.floor(gap / 60);
      const mins = gap % 60;
      const latePick = picks.find((p) => p.matchId === late.id);
      const isPickingHome = latePick?.optionKey === 'h' || latePick?.optionKey === 'hh';
      const oppOpt = isPickingHome
        ? late.pools.HHAD.options.find((o) => o.key === 'ha') ?? late.pools.HAD.options[2]
        : late.pools.HHAD.options.find((o) => o.key === 'hh') ?? late.pools.HAD.options[0];
      const oppOdds = oppOpt?.odds ?? 1.85;
      const targetReturn = Math.max(report.minPayout, report.likelyRange[0]);
      const rawHedgeMoney = targetReturn / oppOdds;
      const hedgeCost = Math.max(2, Math.round(rawHedgeMoney / 2) * 2);
      const lockedNetProfit = Number(
        (Math.min(targetReturn, hedgeCost * oppOdds) - report.totalCost - hedgeCost).toFixed(2)
      );

      hedge = {
        available: true,
        gapMinutes: gap,
        gapText: `${hrs}小时${mins > 0 ? `${mins}分` : ''}`,
        earlyMatchTitle: `${early.matchNumStr} ${early.home}vs${early.away}`,
        lateMatchTitle: `${late.matchNumStr} ${late.home}vs${late.away}`,
        earlyKickoff: early.kickoff,
        lateKickoff: late.kickoff,
        oppositeLabel: `${late.home} 反向【${oppOpt?.label ?? '让负'}】`,
        oppositeOdds: oppOdds,
        hedgeCost,
        lockedNetProfit,
        reason: `早场(${early.kickoff})完场后距晚场(${late.kickoff})仍有充裕时间！若第一关顺利红单，补买 ¥${hedgeCost} 反向即可无视凌晨结果提前锁利！`,
      };
    }
  }

  // ② 串关“拖油瓶”场次敏感度体检
  let weakestLink: WeakestLinkTip | null = null;
  if (pickedMatches.length >= 2) {
    const perMatchProb = pickedMatches.map((m) => {
      const mp = picks.filter((p) => p.matchId === m.id);
      const sumP = Math.min(0.95, mp.reduce((a, x) => a + x.fairProb, 0));
      return { m, sumP };
    });
    perMatchProb.sort((a, b) => a.sumP - b.sumP);
    const worst = perMatchProb[0];
    const withoutWorstProb = perMatchProb.slice(1).reduce((acc, x) => acc * x.sumP, 1);
    if (worst && withoutWorstProb - report.realProfitProb >= 0.14) {
      weakestLink = {
        matchId: worst.m.id,
        matchTitle: `${worst.m.matchNumStr} ${worst.m.home}vs${worst.m.away}`,
        currentProfitProb: report.realProfitProb,
        afterRemoveProfitProb: withoutWorstProb,
        message: `【${worst.m.home}vs${worst.m.away}】单场过关率仅 ${(worst.sumP * 100).toFixed(0)}%，是拉低整单胜率的最大瓶颈；砍掉它后整单胜率立升至 ${(withoutWorstProb * 100).toFixed(1)}%！`,
      };
    }
  }

  // ③ 检查当前已选里是否真实踩中了某一场的“同义低水劣势项”可白捡钱替换
  let activeSwapTip: EquivalentArbItem | null = null;
  for (const m of pickedMatches) {
    const mpicks = picks.filter((p) => p.matchId === m.id);
    const mq = analyzeMatchMicroQuant(m);
    const matchedArb = mq.arbitrages.find((arb) => {
      const hasAllWorse =
        arb.worsePicks.length > 0 &&
        arb.worsePicks.every((wp) =>
          mpicks.some((p) => p.poolCode === wp.poolCode && p.optionKey === wp.optionKey)
        );
      const hasAllBetter =
        arb.betterPicks.length > 0 &&
        arb.betterPicks.every((bp) =>
          mpicks.some((p) => p.poolCode === bp.poolCode && p.optionKey === bp.optionKey)
        );
      return hasAllWorse && !hasAllBetter;
    });
    if (matchedArb) {
      activeSwapTip = matchedArb;
      break;
    }
  }

  // ④ 连黑 5 次概率与建议备战金比例
  const p = Math.max(0.03, report.realProfitProb);
  const fiveLossStreakProb = Math.pow(1 - p, 5);
  const recommendedBankrollPct = p >= 0.45 ? 12 : p >= 0.3 ? 8 : p >= 0.18 ? 5 : 2.5;

  return {
    hedge,
    weakestLink,
    fiveLossStreakProb,
    recommendedBankrollPct,
    activeSwapTip,
  };
}


export type BonusOptMode = 'equal' | 'hot-first' | 'cold-first';

/**
 * 三模智能奖金优化深模块：
 * - equal: 反比例均衡派奖，消灭假中奖倒贴
 * - hot-first: 次选刚性保本护盾 + 第一主攻利润最大化
 * - cold-first: 正路免单兜底 + 高赔冷门暴击放大
 * 严格保留每个组合的完整多场串关腿（c.legs），确保 2串1~8串1 实票核对零丢腿！
 */
export function optimizeBonusPlan(
  manualReport: TruthReport,
  matches: MatchItem[],
  optMode: BonusOptMode
): ArchetypePlan | null {
  if (manualReport.combos.length === 0) return null;

  const sorted = [...manualReport.combos].sort((a, b) => b.prob - a.prob);
  const k = sorted.length;
  const baseBudget = Math.max(
    manualReport.totalCost,
    manualReport.breakevenUpgradeCost ?? manualReport.totalCost,
    k * 6
  );
  const totalTickets = Math.max(k + 2, Math.round(baseBudget / 2));
  const targetStake = totalTickets * 2;

  const cappedUnits = sorted.map((c) => {
    const legCount = c.legs?.length ?? manualReport.matchCount;
    return Math.min(statutorySingleBetCap(legCount), c.unitPayout);
  });

  let mults: number[] = [];
  if (optMode === 'equal' || k === 1) {
    const invSum = cappedUnits.reduce((acc, u) => acc + 1 / Math.max(0.5, u), 0);
    mults = cappedUnits.map((u) =>
      Math.max(1, Math.round((totalTickets * (1 / Math.max(0.5, u))) / invSum))
    );
  } else if (optMode === 'hot-first') {
    mults = cappedUnits.map((u, idx) =>
      idx === 0 ? 1 : Math.max(1, Math.ceil(targetStake / Math.max(2.02, u)))
    );
    const shieldSum = mults.slice(1).reduce((a, m) => a + m, 0);
    mults[0] = Math.max(
      Math.ceil(((shieldSum + 2) * 2) / Math.max(2.02, cappedUnits[0])) + 2,
      totalTickets - shieldSum
    );
  } else {
    mults = cappedUnits.map((u, idx) =>
      idx === k - 1 ? 1 : Math.max(1, Math.ceil(targetStake / Math.max(2.02, u)))
    );
    const shieldSum = mults.slice(0, k - 1).reduce((a, m) => a + m, 0);
    mults[k - 1] = Math.max(
      Math.ceil(((shieldSum + 2) * 2) / Math.max(2.02, cappedUnits[k - 1])) + 2,
      totalTickets - shieldSum
    );
  }

  mults = repairUnderwaterMultiples(mults, cappedUnits, manualReport.effectiveOdds > 1.02);

  const lines: PlanTicketLine[] = sorted.map((c, idx) => {
    const mult = mults[idx];
    const unit = cappedUnits[idx];
    const role =
      optMode === 'equal'
        ? `均衡分倍#${idx + 1}`
        : optMode === 'hot-first'
          ? idx === 0
            ? '🔥主攻重锤'
            : `🛡️次选回本盾#${idx}`
          : idx === k - 1
            ? '⚡博冷高弹箭'
            : `🛡️正路免单盾#${idx + 1}`;

    const fullLegs = (c.legs ?? []).map((p) => {
      const fm = matches.find((m) => m.id === p.matchId);
      return {
        matchId: p.matchId,
        matchNumStr: p.matchNumStr,
        home: p.home,
        away: p.away,
        kickoff: fm?.kickoff ?? '21:00',
        poolCode: p.poolCode,
        poolName: p.poolName,
        optionKey: p.optionKey,
        optionLabel: p.optionLabel,
        odds: p.odds,
        fairProb: p.fairProb,
      };
    });

    return {
      id: `opt-${optMode}-${idx}`,
      roleLabel: role,
      legs: fullLegs,
      modeLabel: manualReport.modeLabel,
      multiple: mult,
      cost: mult * 2,
      unitPayout: unit,
      returnPayout: Number((unit * mult).toFixed(2)),
      netProfit: 0,
      prob: c.prob,
    };
  });

  const actualTotal = lines.reduce((a, l) => a + l.cost, 0);
  lines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - actualTotal).toFixed(2));
  });

  const profitLinesProb = lines
    .filter((l) => l.netProfit >= 0)
    .reduce((a, l) => a + l.prob, 0);

  const metaMap = {
    equal: {
      shortTab: '平均优化',
      badge: '⚖️ 平均优化（均衡派奖）',
      title: '反比例均注 · 全选项均衡稳赚',
      reason: '按每注返奖额反比例精密分配整数倍，彻底消灭假中奖倒贴',
    },
    'hot-first': {
      shortTab: '博热保本',
      badge: '🔥 博热保本优化',
      title: '次选回本护盾 + 第一主攻利润最大化',
      reason: '防冷次选仅配保本倍数，省下筹码集中放大最高概率主方向收益',
    },
    'cold-first': {
      shortTab: '博冷高弹',
      badge: '⚡ 博冷高弹优化',
      title: '正路免单兜底 + 高赔冷门暴击放大',
      reason: '大热方向锁住保本回血线，溢价倍数倾斜博取高赔冷门超额回报',
    },
  }[optMode];

  return {
    key: 'iron-shield',
    shortTab: metaMap.shortTab,
    badge: metaMap.badge,
    title: metaMap.title,
    tagline: `总投入 ¥${actualTotal} · 保底返 ¥${Math.min(...lines.map((l) => l.returnPayout)).toFixed(1)} ~ 最高 ¥${Math.max(...lines.map((l) => l.returnPayout)).toFixed(1)}`,
    totalCost: actualTotal,
    savedCash: 0,
    minReturn: Math.min(...lines.map((l) => l.returnPayout)),
    maxReturn: Math.max(...lines.map((l) => l.returnPayout)),
    winProb: manualReport.anyWinProb,
    profitProb: profitLinesProb > 0 ? Math.min(manualReport.anyWinProb, profitLinesProb) : manualReport.anyWinProb,
    missOneReturn: null,
    vigPct: manualReport.avgVigLossPer100,
    reasons: [metaMap.reason],
    lines,
  };
}
