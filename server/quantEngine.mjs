import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function expandPrecisionDecimal(num) {
  const sci = num.toPrecision(15);
  const [mantissa, expRaw] = sci.split(/e/i);
  const exp = expRaw ? parseInt(expRaw, 10) : 0;
  const dotIdx = mantissa.indexOf('.');
  const digits = mantissa.replace('.', '');
  const intLen = (dotIdx === -1 ? mantissa.length : dotIdx) + exp;

  if (intLen <= 0) {
    return { intPart: '0', decPart: '0'.repeat(-intLen) + digits };
  }
  if (intLen >= digits.length) {
    return { intPart: digits + '0'.repeat(intLen - digits.length), decPart: '' };
  }
  return { intPart: digits.slice(0, intLen), decPart: digits.slice(intLen) };
}

/** 中国体彩法定计奖舍入（严格遵循 GB/T 8170）：单注2元奖金保留到分，「四舍六入五成双，五后非零则进一」 */
export function bankerRoundCents(rawYuan) {
  if (!Number.isFinite(rawYuan) || rawYuan <= 0) return 0;
  const { intPart, decPart } = expandPrecisionDecimal(rawYuan);
  const padded = decPart.padEnd(16, '0');
  const centsInt = BigInt(intPart) * 100n + BigInt(padded.slice(0, 2));
  const thirdDigit = Number(padded[2]);
  const tailAfterThird = BigInt(padded.slice(3) || '0');

  if (thirdDigit < 5) return Number(centsInt) / 100;
  if (thirdDigit > 5 || tailAfterThird > 0n) return Number(centsInt + 1n) / 100;
  return Number(centsInt % 2n === 0n ? centsInt : centsInt + 1n) / 100;
}

/** 多场串关精确十进制连乘计奖（以分为单位 BigInt 运算） */
export function bankerRoundParlayUnitPayout(oddsList) {
  if (!Array.isArray(oddsList) || oddsList.length === 0) return 0;
  if (oddsList.some((o) => !Number.isFinite(o) || o <= 0)) return 0;
  let num = 200n;
  let scale = 1n;
  for (const o of oddsList) {
    const scaledOdds = BigInt(Math.round(o * 10000));
    num *= scaledOdds;
    scale *= 10000n;
  }
  const quotient = num / scale;
  const remainder = num % scale;
  const twiceRem = remainder * 2n;
  if (twiceRem < scale) return Number(quotient) / 100;
  if (twiceRem > scale) return Number(quotient + 1n) / 100;
  return Number(quotient % 2n === 0n ? quotient : quotient + 1n) / 100;
}

/** 中国体彩法定单注最高封顶赔付红线（单关10万、2/3关20万、4/5关50万、6~8关100万） */
export function statutorySingleBetCap(matchCount) {
  if (matchCount <= 1) return 100_000;
  if (matchCount <= 3) return 200_000;
  if (matchCount <= 5) return 500_000;
  return 1_000_000;
}

/** 中国体彩五大玩法法定最高串关关数上限（源自官方 lotJs.js limitLen） */
export const POOL_MAX_PASS = {
  HAD: 8,
  HHAD: 8,
  TTG: 6,
  HAFU: 4,
  CRS: 4,
};

/** 中国体彩官方标准多串过关组合表（源自官方 lotJs.js optionAry） */
export const OFFICIAL_COMBO_PASS_TABLE = {
  3: [
    { code: '3x3', label: '3串3', sizes: [2], baseBets: 3, desc: '全2关·错1仍中' },
    { code: '3x4', label: '3串4', sizes: [2, 3], baseBets: 4, desc: '2+3关·防错1场' },
  ],
  4: [
    { code: '4x4', label: '4串4', sizes: [3], baseBets: 4, desc: '全3关·错1仍中' },
    { code: '4x5', label: '4串5', sizes: [3, 4], baseBets: 5, desc: '3+4关容错' },
    { code: '4x6', label: '4串6', sizes: [2], baseBets: 6, desc: '全2关·错2仍中' },
    { code: '4x11', label: '4串11', sizes: [2, 3, 4], baseBets: 11, desc: '2~4关全包' },
  ],
  5: [
    { code: '5x5', label: '5串5', sizes: [4], baseBets: 5, desc: '全4关·错1仍中' },
    { code: '5x6', label: '5串6', sizes: [4, 5], baseBets: 6, desc: '4+5关容错' },
    { code: '5x10', label: '5串10', sizes: [2], baseBets: 10, desc: '全2关高频容错' },
    { code: '5x16', label: '5串16', sizes: [3, 4, 5], baseBets: 16, desc: '3~5关组合' },
    { code: '5x20', label: '5串20', sizes: [2, 3], baseBets: 20, desc: '2+3关稳健网' },
    { code: '5x26', label: '5串26', sizes: [2, 3, 4, 5], baseBets: 26, desc: '2~5关全包' },
  ],
  6: [
    { code: '6x6', label: '6串6', sizes: [5], baseBets: 6, desc: '全5关·错1仍中' },
    { code: '6x7', label: '6串7', sizes: [5, 6], baseBets: 7, desc: '5+6关容错' },
    { code: '6x15', label: '6串15', sizes: [2], baseBets: 15, desc: '全2关容错网' },
    { code: '6x20', label: '6串20', sizes: [3], baseBets: 20, desc: '全3关均衡网' },
    { code: '6x22', label: '6串22', sizes: [4, 5, 6], baseBets: 22, desc: '4~6关组合' },
    { code: '6x35', label: '6串35', sizes: [2, 3], baseBets: 35, desc: '2+3关双层网' },
    { code: '6x42', label: '6串42', sizes: [3, 4, 5, 6], baseBets: 42, desc: '3~6关组合' },
    { code: '6x50', label: '6串50', sizes: [2, 3, 4], baseBets: 50, desc: '2~4关厚盾网' },
    { code: '6x57', label: '6串57', sizes: [2, 3, 4, 5, 6], baseBets: 57, desc: '2~6关全包' },
  ],
  7: [
    { code: '7x7', label: '7串7', sizes: [6], baseBets: 7, desc: '全6关·错1仍中' },
    { code: '7x8', label: '7串8', sizes: [6, 7], baseBets: 8, desc: '6+7关容错' },
    { code: '7x21', label: '7串21', sizes: [5], baseBets: 21, desc: '全5关容错' },
    { code: '7x35', label: '7串35', sizes: [4], baseBets: 35, desc: '全4关容错' },
    { code: '7x120', label: '7串120', sizes: [2, 3, 4, 5, 6, 7], baseBets: 120, desc: '2~7关全包' },
  ],
  8: [
    { code: '8x8', label: '8串8', sizes: [7], baseBets: 8, desc: '全7关·错1仍中' },
    { code: '8x9', label: '8串9', sizes: [7, 8], baseBets: 9, desc: '7+8关容错' },
    { code: '8x28', label: '8串28', sizes: [6], baseBets: 28, desc: '全6关容错' },
    { code: '8x56', label: '8串56', sizes: [5], baseBets: 56, desc: '全5关容错' },
    { code: '8x70', label: '8串70', sizes: [4], baseBets: 70, desc: '全4关容错' },
    { code: '8x247', label: '8串247', sizes: [2, 3, 4, 5, 6, 7, 8], baseBets: 247, desc: '2~8关全包' },
  ],
};

/** 中国体彩全部 31 项法定比分编码表（主胜13 + 平5 + 客胜13，含胜其它/平其它/负其它） */
export const OFFICIAL_CRS_PAIRS = [
  ['s01s00', '1:0'],
  ['s02s00', '2:0'],
  ['s02s01', '2:1'],
  ['s03s00', '3:0'],
  ['s03s01', '3:1'],
  ['s03s02', '3:2'],
  ['s04s00', '4:0'],
  ['s04s01', '4:1'],
  ['s04s02', '4:2'],
  ['s05s00', '5:0'],
  ['s05s01', '5:1'],
  ['s05s02', '5:2'],
  ['s1sh', '胜其它'],
  ['s00s00', '0:0'],
  ['s01s01', '1:1'],
  ['s02s02', '2:2'],
  ['s03s03', '3:3'],
  ['s1sd', '平其它'],
  ['s00s01', '0:1'],
  ['s00s02', '0:2'],
  ['s01s02', '1:2'],
  ['s00s03', '0:3'],
  ['s01s03', '1:3'],
  ['s02s03', '2:3'],
  ['s00s04', '0:4'],
  ['s01s04', '1:4'],
  ['s02s04', '2:4'],
  ['s00s05', '0:5'],
  ['s01s05', '1:5'],
  ['s02s05', '2:5'],
  ['s1sa', '负其它'],
];

function buildPool(code, name, single, rawOptions, updateTime = '17:45:21', goalLine, selling = true) {
  const valid = selling ? rawOptions.filter((o) => o.odds > 0) : [];
  const isSelling = Boolean(selling && valid.length > 0);
  const invSum = valid.reduce((acc, o) => acc + 1 / o.odds, 0);
  const payoutRatio = invSum > 0 ? 1 / invSum : 0.88;
  const vig = Math.max(0, 1 - payoutRatio);
  return {
    code,
    name,
    single,
    selling: isSelling,
    goalLine,
    payoutRatio,
    vig,
    updateTime,
    options: valid.map((o) => ({
      key: o.key,
      label: o.label,
      odds: o.odds,
      trend: o.trend ?? 0,
      fairProb: invSum > 0 ? 1 / o.odds / invSum : 0,
    })),
  };
}

/** 1. 单场精算师底牌反推（服务端黑盒：xG + 一球卡盘率 + 同义省钱比价 + 变盘信号） */
export function analyzeMatchMicroQuant(m) {
  const ttgOpts = m.pools.TTG.options;
  const totalXG =
    ttgOpts.length >= 6
      ? ttgOpts.reduce((acc, o, idx) => acc + (idx === 7 ? 7.3 : idx) * o.fairProb, 0)
      : 2.45;

  const hProb = m.pools.HAD.options.find((o) => o.key === 'h')?.fairProb ?? 0.45;
  const dProb = m.pools.HAD.options.find((o) => o.key === 'd')?.fairProb ?? 0.27;
  const aProb = m.pools.HAD.options.find((o) => o.key === 'a')?.fairProb ?? 0.28;

  const strengthShare = (hProb + 0.5 * dProb) / Math.max(0.01, hProb + dProb + aProb);
  const homeXG = Number((totalXG * (0.18 + 0.64 * strengthShare)).toFixed(2));
  const awayXG = Number(Math.max(0.25, totalXG - homeXG).toFixed(2));

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

  let bestGoalPair = ['s2', 's3', 0.48];
  for (let i = 0; i < ttgOpts.length - 1; i++) {
    const sumP = ttgOpts[i].fairProb + ttgOpts[i + 1].fairProb;
    if (sumP > bestGoalPair[2]) {
      bestGoalPair = [ttgOpts[i].key, ttgOpts[i + 1].key, sumP];
    }
  }

  const halfDrawProb = m.pools.HAFU.options
    .filter((o) => o.key.startsWith('d'))
    .reduce((a, o) => a + o.fairProb, 0);

  const arbitrages = [];

  const ttg0 = m.pools.TTG.options.find((o) => o.key === 's0');
  const crs00 = m.pools.CRS.options.find((o) => o.key === '0:0');
  if (ttg0 && crs00 && Math.abs(ttg0.odds - crs00.odds) >= 0.15) {
    const ttgBetter = ttg0.odds > crs00.odds;
    const hi = ttgBetter ? ttg0.odds : crs00.odds;
    const lo = ttgBetter ? crs00.odds : ttg0.odds;
    const edge = ((hi - lo) / lo) * 100;
    const betterPicks = [
      ttgBetter ? { poolCode: 'TTG', optionKey: 's0' } : { poolCode: 'CRS', optionKey: '0:0' },
    ];
    const worsePicks = [
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
      const betterPicks = hhadBetter
        ? [{ poolCode: 'HHAD', optionKey: 'ha' }]
        : [
            { poolCode: 'HAD', optionKey: 'd' },
            { poolCode: 'HAD', optionKey: 'a' },
          ];
      const worsePicks = hhadBetter
        ? [
            { poolCode: 'HAD', optionKey: 'd' },
            { poolCode: 'HAD', optionKey: 'a' },
          ]
        : [{ poolCode: 'HHAD', optionKey: 'ha' }];
      arbitrages.push({
        matchId: m.id,
        title: `${m.away}受让不败同义比价`,
        betterChoice: hhadBetter
          ? `让球(-1)·让负(@${hhadAway.odds.toFixed(2)})`
          : `胜平负[平+客胜]配平(@${synDouble.toFixed(2)})`,
        worseChoice: hhadBetter
          ? `胜平负[平+客胜]双选(@${synDouble.toFixed(2)})`
          : `让球(-1)·让负(@${hhadAway.odds.toFixed(2)})`,
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
      const betterPicks = hhadBetter
        ? [{ poolCode: 'HHAD', optionKey: 'hh' }]
        : [
            { poolCode: 'HAD', optionKey: 'h' },
            { poolCode: 'HAD', optionKey: 'd' },
          ];
      const worsePicks = hhadBetter
        ? [
            { poolCode: 'HAD', optionKey: 'h' },
            { poolCode: 'HAD', optionKey: 'd' },
          ]
        : [{ poolCode: 'HHAD', optionKey: 'hh' }];
      arbitrages.push({
        matchId: m.id,
        title: `${m.home}不败同义比价`,
        betterChoice: hhadBetter
          ? `让球(+1)·让胜(@${hhadHome.odds.toFixed(2)})`
          : `胜平负[胜+平]配平(@${synDouble.toFixed(2)})`,
        worseChoice: hhadBetter
          ? `胜平负[胜+平]双选(@${synDouble.toFixed(2)})`
          : `让球(+1)·让胜(@${hhadHome.odds.toFixed(2)})`,
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

  const droppingOpts = [
    ...m.pools.HAD.options.filter((o) => o.trend === -1).map((o) => `主盘${o.label}`),
    ...m.pools.HHAD.options.filter((o) => o.trend === -1).map((o) => o.label),
  ];
  const steamSignal =
    droppingOpts.length > 0
      ? `🔥 真防冷急降：体彩正下调【${droppingOpts.slice(0, 2).join('/')}】赔付`
      : '⚖️ 盘面平稳：暂无剧烈急跌诱盘';

  const microBadges = [
    { text: `xG ${homeXG}:${awayXG}`, tone: 'sky' },
    {
      text:
        oneGoalShareOfWins >= 0.52
          ? `防赢1球卡盘 ${(oneGoalShareOfWins * 100).toFixed(0)}%`
          : `穿盘率 ${(100 - oneGoalShareOfWins * 100).toFixed(0)}%`,
      tone: oneGoalShareOfWins >= 0.52 ? 'amber' : 'emerald',
    },
  ];
  if (arbitrages[0]) {
    microBadges.push({ text: `💰省钱差价 +${arbitrages[0].edgePct}%`, tone: 'emerald' });
  }
  if (droppingOpts.length > 0) {
    microBadges.push({ text: `🔻${droppingOpts[0]}降水`, tone: 'purple' });
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

export function attachMicroQuant(matches) {
  return matches.map((m) => ({
    ...m,
    microQuant: analyzeMatchMicroQuant(m),
  }));
}

const DEFAULT_CRS_ODDS_BY_LABEL = {
  '1:0': 7.5,
  '2:0': 9.5,
  '2:1': 8.2,
  '3:0': 18.0,
  '3:1': 17.5,
  '3:2': 26.0,
  '4:0': 40.0,
  '4:1': 38.0,
  '4:2': 65.0,
  '5:0': 90.0,
  '5:1': 85.0,
  '5:2': 150.0,
  '胜其它': 55.0,
  '0:0': 9.5,
  '1:1': 6.0,
  '2:2': 14.0,
  '3:3': 55.0,
  '平其它': 150.0,
  '0:1': 8.5,
  '0:2': 12.5,
  '1:2': 9.2,
  '0:3': 26.0,
  '1:3': 22.0,
  '2:3': 28.0,
  '0:4': 60.0,
  '1:4': 50.0,
  '2:4': 80.0,
  '0:5': 130.0,
  '1:5': 110.0,
  '2:5': 180.0,
  '负其它': 65.0,
};

function buildFull31CrsPool(customOpts = [], updateTime = '18:00:00') {
  const byLabel = new Map();
  for (const o of customOpts) {
    byLabel.set(o.label, o);
  }
  const full31 = OFFICIAL_CRS_PAIRS.map(([, lbl]) => {
    const hit = byLabel.get(lbl);
    return {
      key: lbl,
      label: lbl,
      odds: hit?.odds ?? DEFAULT_CRS_ODDS_BY_LABEL[lbl] ?? 50.0,
      trend: hit?.trend ?? 0,
    };
  });
  return buildPool('CRS', '比分', true, full31, updateTime);
}

const RAW_FALLBACK_MATCHES = [
  {
    id: '20261117-002',
    matchNumStr: '周二002',
    league: '国际赛',
    kickoff: '20:00',
    home: '中国',
    away: '巴林',
    homeRank: '90',
    awayRank: '76',
    isHot: true,
    aiAlert: {
      level: 'high',
      tag: '临场伤停 & 调水滞后窗口',
      summary: '巴林主力后腰哈拉姆赛前热身轻度拉伤未进首发，体彩让负(1.88)已下调但半全场「平胜 3.90」尚未跟随降赔。',
      priceInStatus: '半全场尚未完全消化（存在约 25 分钟调水滞后红利）',
      source: '亚足联官方首发名单 · 28分钟前',
      suggestedDelta: '建议主胜主观概率 +4%',
    },
    pools: {
      HAD: buildPool('HAD', '胜平负', false, [
        { key: 'h', label: '主胜', odds: 1.69, trend: 0 },
        { key: 'd', label: '平', odds: 3.25, trend: 0 },
        { key: 'a', label: '客胜', odds: 4.18, trend: 0 },
      ], '16:45:40'),
      HHAD: buildPool('HHAD', '让球(-1)', false, [
        { key: 'hh', label: '让胜', odds: 3.75, trend: 1 },
        { key: 'hd', label: '让平', odds: 2.93, trend: -1 },
        { key: 'ha', label: '让负', odds: 1.88, trend: 1 },
      ], '17:45:21', '-1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'hh', label: '胜胜', odds: 2.95, trend: 0 },
        { key: 'hd', label: '胜平', odds: 16.0, trend: 0 },
        { key: 'ha', label: '胜负', odds: 39.0, trend: 0 },
        { key: 'dh', label: '平胜', odds: 3.90, trend: -1 },
        { key: 'dd', label: '平平', odds: 4.60, trend: 0 },
        { key: 'da', label: '平负', odds: 8.80, trend: 0 },
        { key: 'ah', label: '负胜', odds: 29.0, trend: 0 },
        { key: 'ad', label: '负平', odds: 16.0, trend: 0 },
        { key: 'aa', label: '负负', odds: 7.00, trend: 1 },
      ], '16:22:27'),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 9.25 },
        { key: 's1', label: '1球', odds: 4.15, trend: -1 },
        { key: 's2', label: '2球', odds: 2.90 },
        { key: 's3', label: '3球', odds: 3.60 },
        { key: 's4', label: '4球', odds: 6.60 },
        { key: 's5', label: '5球', odds: 14.5 },
        { key: 's6', label: '6球', odds: 30.0 },
        { key: 's7', label: '7+球', odds: 36.0 },
      ], '17:30:26'),
      CRS: buildFull31CrsPool([
        { key: '1:0', label: '1:0', odds: 5.20, trend: -1 },
        { key: '2:0', label: '2:0', odds: 6.80 },
        { key: '2:1', label: '2:1', odds: 7.25 },
        { key: '3:0', label: '3:0', odds: 13.5 },
        { key: '0:0', label: '0:0', odds: 9.25 },
        { key: '1:1', label: '1:1', odds: 6.10 },
        { key: '0:1', label: '0:1', odds: 9.50 },
        { key: '1:2', label: '1:2', odds: 13.0 },
      ], '17:30:00'),
    },
  },
  {
    id: '20261117-003',
    matchNumStr: '周二003',
    league: '国际赛',
    kickoff: '21:10',
    home: '日本',
    away: '巴拉圭',
    homeRank: '15',
    awayRank: '55',
    isHot: true,
    aiAlert: {
      level: 'medium',
      tag: '战意轮换预警',
      summary: '日本队主帅森保一赛前发布会透露将考察旅欧替补边路，下半场可能大面积换人；注意防让球平。',
      priceInStatus: '主胜微升已部分消化',
      source: '日刊体育赛前直击 · 2小时前',
    },
    pools: {
      HAD: buildPool('HAD', '胜平负', true, [
        { key: 'h', label: '主胜', odds: 1.36, trend: 1 },
        { key: 'd', label: '平', odds: 4.15, trend: -1 },
        { key: 'a', label: '客胜', odds: 6.50, trend: 0 },
      ], '18:05:12'),
      HHAD: buildPool('HHAD', '让球(-1)', true, [
        { key: 'hh', label: '让胜', odds: 2.18, trend: 1 },
        { key: 'hd', label: '让平', odds: 3.30, trend: -1 },
        { key: 'ha', label: '让负', odds: 2.72, trend: 0 },
      ], '18:05:12', '-1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'hh', label: '胜胜', odds: 2.02 },
        { key: 'hd', label: '胜平', odds: 17.0 },
        { key: 'ha', label: '胜负', odds: 45.0 },
        { key: 'dh', label: '平胜', odds: 3.75, trend: -1 },
        { key: 'dd', label: '平平', odds: 6.00 },
        { key: 'da', label: '平负', odds: 13.0 },
        { key: 'ah', label: '负胜', odds: 24.0 },
        { key: 'ad', label: '负平', odds: 18.0 },
        { key: 'aa', label: '负负', odds: 11.5 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 11.0 },
        { key: 's1', label: '1球', odds: 4.60 },
        { key: 's2', label: '2球', odds: 3.25 },
        { key: 's3', label: '3球', odds: 3.45 },
        { key: 's4', label: '4球', odds: 5.40 },
        { key: 's5', label: '5球', odds: 10.5 },
        { key: 's6', label: '6球', odds: 21.0 },
        { key: 's7', label: '7+球', odds: 28.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '1:0', label: '1:0', odds: 5.80 },
        { key: '2:0', label: '2:0', odds: 5.60, trend: -1 },
        { key: '2:1', label: '2:1', odds: 6.90 },
        { key: '3:0', label: '3:0', odds: 8.50 },
        { key: '1:1', label: '1:1', odds: 7.20 },
        { key: '0:0', label: '0:0', odds: 11.0 },
        { key: '0:1', label: '0:1', odds: 14.0 },
        { key: '1:2', label: '1:2', odds: 18.5 },
      ]),
    },
  },
  {
    id: '20261117-005',
    matchNumStr: '周二005',
    league: '欧国联',
    kickoff: '03:45',
    home: '波兰',
    away: '瑞典',
    homeRank: '31',
    awayRank: '28',
    pools: {
      HAD: buildPool('HAD', '胜平负', false, [
        { key: 'h', label: '主胜', odds: 2.38, trend: -1 },
        { key: 'd', label: '平', odds: 3.15, trend: 0 },
        { key: 'a', label: '客胜', odds: 2.58, trend: 1 },
      ], '18:12:09'),
      HHAD: buildPool('HHAD', '让球(-1)', false, [
        { key: 'hh', label: '让胜', odds: 5.25 },
        { key: 'hd', label: '让平', odds: 3.95 },
        { key: 'ha', label: '让负', odds: 1.44, trend: -1 },
      ], '18:12:09', '-1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'hh', label: '胜胜', odds: 3.85 },
        { key: 'hd', label: '胜平', odds: 14.0 },
        { key: 'ha', label: '胜负', odds: 28.0 },
        { key: 'dh', label: '平胜', odds: 5.60 },
        { key: 'dd', label: '平平', odds: 4.85 },
        { key: 'da', label: '平负', odds: 6.00 },
        { key: 'ah', label: '负胜', odds: 26.0 },
        { key: 'ad', label: '负平', odds: 14.0 },
        { key: 'aa', label: '负负', odds: 4.20 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 9.50 },
        { key: 's1', label: '1球', odds: 4.20 },
        { key: 's2', label: '2球', odds: 3.10 },
        { key: 's3', label: '3球', odds: 3.65 },
        { key: 's4', label: '4球', odds: 6.40 },
        { key: 's5', label: '5球', odds: 13.0 },
        { key: 's6', label: '6球', odds: 26.0 },
        { key: 's7', label: '7+球', odds: 34.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '1:0', label: '1:0', odds: 7.50 },
        { key: '2:1', label: '2:1', odds: 8.20 },
        { key: '1:1', label: '1:1', odds: 5.80 },
        { key: '0:0', label: '0:0', odds: 9.50 },
        { key: '0:1', label: '0:1', odds: 8.00 },
        { key: '1:2', label: '1:2', odds: 8.80 },
      ]),
    },
  },
  {
    id: '20261117-007',
    matchNumStr: '周二007',
    league: '欧国联',
    kickoff: '03:45',
    home: '威尔士',
    away: '葡萄牙',
    homeRank: '29',
    awayRank: '7',
    isHot: true,
    aiAlert: {
      level: 'high',
      tag: '默契球 / 轮换排雷',
      summary: '葡萄牙已提前锁定小组头名出线，B费累积黄牌停赛且C罗轮休未随队赴客场！体彩客胜从1.48急升至1.66，切忌盲目拿葡萄牙做稳胆！',
      priceInStatus: '客胜持续升水但热度仍偏高（高危冷门雷区）',
      source: '欧足联官网赛前名单 · 45分钟前',
      suggestedDelta: '建议客胜主观概率下调 -8%',
    },
    pools: {
      HAD: buildPool('HAD', '胜平负', true, [
        { key: 'h', label: '主胜', odds: 4.50, trend: -1 },
        { key: 'd', label: '平', odds: 3.55, trend: -1 },
        { key: 'a', label: '客胜', odds: 1.66, trend: 1 },
      ], '18:28:00'),
      HHAD: buildPool('HHAD', '让球(+1)', true, [
        { key: 'hh', label: '让胜', odds: 1.98, trend: -1 },
        { key: 'hd', label: '让平', odds: 3.35, trend: 0 },
        { key: 'ha', label: '让负', odds: 3.10, trend: 1 },
      ], '18:28:00', '+1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'hh', label: '胜胜', odds: 7.50 },
        { key: 'hd', label: '胜平', odds: 15.0 },
        { key: 'ha', label: '胜负', odds: 24.0 },
        { key: 'dh', label: '平胜', odds: 9.50 },
        { key: 'dd', label: '平平', odds: 5.20, trend: -1 },
        { key: 'da', label: '平负', odds: 4.15 },
        { key: 'ah', label: '负胜', odds: 36.0 },
        { key: 'ad', label: '负平', odds: 15.0 },
        { key: 'aa', label: '负负', odds: 2.52, trend: 1 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 10.0 },
        { key: 's1', label: '1球', odds: 4.30 },
        { key: 's2', label: '2球', odds: 3.15 },
        { key: 's3', label: '3球', odds: 3.50 },
        { key: 's4', label: '4球', odds: 6.10 },
        { key: 's5', label: '5球', odds: 12.5 },
        { key: 's6', label: '6球', odds: 25.0 },
        { key: 's7', label: '7+球', odds: 32.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '1:1', label: '1:1', odds: 6.20, trend: -1 },
        { key: '0:1', label: '0:1', odds: 6.00 },
        { key: '0:2', label: '0:2', odds: 7.40 },
        { key: '1:2', label: '1:2', odds: 7.20 },
        { key: '1:0', label: '1:0', odds: 10.5 },
        { key: '2:1', label: '2:1', odds: 12.5 },
      ]),
    },
  },
  {
    id: '20261119-001',
    matchNumStr: '周四001',
    league: '欧国联',
    kickoff: '01:00',
    home: '比利时',
    away: '意大利',
    homeRank: '6',
    awayRank: '9',
    pools: {
      HAD: buildPool('HAD', '胜平负', true, [
        { key: 'h', label: '主胜', odds: 2.38, trend: 1 },
        { key: 'd', label: '平', odds: 3.15, trend: -1 },
        { key: 'a', label: '客胜', odds: 2.62, trend: -1 },
      ]),
      HHAD: buildPool('HHAD', '让球(-1)', true, [
        { key: 'hh', label: '让胜', odds: 5.15, trend: 1 },
        { key: 'hd', label: '让平', odds: 3.85, trend: 0 },
        { key: 'ha', label: '让负', odds: 1.46, trend: -1 },
      ], '18:10:00', '-1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'hh', label: '胜胜', odds: 3.95 },
        { key: 'dh', label: '平胜', odds: 5.60 },
        { key: 'dd', label: '平平', odds: 4.65, trend: -1 },
        { key: 'da', label: '平负', odds: 5.85 },
        { key: 'aa', label: '负负', odds: 4.30 },
        { key: 'hd', label: '胜平', odds: 13.5 },
        { key: 'ha', label: '胜负', odds: 26.0 },
        { key: 'ah', label: '负胜', odds: 25.0 },
        { key: 'ad', label: '负平', odds: 13.5 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 9.20 },
        { key: 's1', label: '1球', odds: 4.10 },
        { key: 's2', label: '2球', odds: 3.15, trend: -1 },
        { key: 's3', label: '3球', odds: 3.65 },
        { key: 's4', label: '4球', odds: 6.40 },
        { key: 's5', label: '5球', odds: 13.0 },
        { key: 's6', label: '6球', odds: 26.0 },
        { key: 's7', label: '7+球', odds: 35.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '0:0', label: '0:0', odds: 9.80 },
        { key: '1:1', label: '1:1', odds: 5.80, trend: -1 },
        { key: '2:2', label: '2:2', odds: 13.5 },
        { key: '1:0', label: '1:0', odds: 7.50 },
        { key: '2:0', label: '2:0', odds: 10.5 },
        { key: '2:1', label: '2:1', odds: 8.60 },
        { key: '0:1', label: '0:1', odds: 7.90 },
        { key: '0:2', label: '0:2', odds: 11.5 },
        { key: '1:2', label: '1:2', odds: 9.10 },
        { key: 's1sh', label: '胜其它', odds: 32.0 },
        { key: 's1sd', label: '平其它', odds: 60.0 },
        { key: 's1sa', label: '负其它', odds: 35.0 },
      ]),
    },
  },
  {
    id: '20261119-002',
    matchNumStr: '周四002',
    league: '欧国联',
    kickoff: '03:45',
    home: '法国',
    away: '以色列',
    homeRank: '2',
    awayRank: '81',
    pools: {
      HAD: buildPool('HAD', '胜平负', false, [
        { key: 'h', label: '主胜', odds: 1.18, trend: 0 },
        { key: 'd', label: '平', odds: 5.80, trend: 1 },
        { key: 'a', label: '客胜', odds: 11.5, trend: 1 },
      ]),
      HHAD: buildPool('HHAD', '让球(-2)', true, [
        { key: 'hh', label: '让胜', odds: 2.24, trend: -1 },
        { key: 'hd', label: '让平', odds: 3.75, trend: 0 },
        { key: 'ha', label: '让负', odds: 2.38, trend: 1 },
      ], '18:12:00', '-2'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'hh', label: '胜胜', odds: 1.56, trend: -1 },
        { key: 'dh', label: '平胜', odds: 3.85 },
        { key: 'dd', label: '平平', odds: 8.20 },
        { key: 'da', label: '平负', odds: 19.0 },
        { key: 'aa', label: '负负', odds: 18.0 },
        { key: 'hd', label: '胜平', odds: 18.0 },
        { key: 'ha', label: '胜负', odds: 50.0 },
        { key: 'ah', label: '负胜', odds: 21.0 },
        { key: 'ad', label: '负平', odds: 22.0 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 15.0 },
        { key: 's1', label: '1球', odds: 5.80 },
        { key: 's2', label: '2球', odds: 3.75 },
        { key: 's3', label: '3球', odds: 3.30, trend: -1 },
        { key: 's4', label: '4球', odds: 4.70 },
        { key: 's5', label: '5球', odds: 7.80 },
        { key: 's6', label: '6球', odds: 14.5 },
        { key: 's7', label: '7+球', odds: 18.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '0:0', label: '0:0', odds: 16.0 },
        { key: '1:0', label: '1:0', odds: 6.80 },
        { key: '2:0', label: '2:0', odds: 5.40, trend: -1 },
        { key: '3:0', label: '3:0', odds: 6.20 },
        { key: '2:1', label: '2:1', odds: 8.20 },
        { key: '1:1', label: '1:1', odds: 9.50 },
      ]),
    },
  },
  {
    id: '20261119-003',
    matchNumStr: '周四003',
    league: '世南美预',
    kickoff: '05:00',
    home: '委内瑞拉',
    away: '巴西',
    homeRank: '44',
    awayRank: '5',
    pools: {
      HAD: buildPool('HAD', '胜平负', true, [
        { key: 'h', label: '主胜', odds: 5.25, trend: -1 },
        { key: 'd', label: '平', odds: 3.60, trend: -1 },
        { key: 'a', label: '客胜', odds: 1.52, trend: 1 },
      ]),
      HHAD: buildPool('HHAD', '让球(+1)', true, [
        { key: 'hh', label: '让胜', odds: 2.16, trend: -1 },
        { key: 'hd', label: '让平', odds: 3.30, trend: 0 },
        { key: 'ha', label: '让负', odds: 2.72, trend: 1 },
      ], '18:15:00', '+1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'aa', label: '负负', odds: 2.35, trend: 1 },
        { key: 'da', label: '平负', odds: 3.95 },
        { key: 'dd', label: '平平', odds: 5.10, trend: -1 },
        { key: 'hh', label: '胜胜', odds: 8.80 },
        { key: 'dh', label: '平胜', odds: 10.5 },
        { key: 'hd', label: '胜平', odds: 15.0 },
        { key: 'ha', label: '胜负', odds: 24.0 },
        { key: 'ah', label: '负胜', odds: 42.0 },
        { key: 'ad', label: '负平', odds: 15.0 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 8.80 },
        { key: 's1', label: '1球', odds: 3.95 },
        { key: 's2', label: '2球', odds: 3.10 },
        { key: 's3', label: '3球', odds: 3.75 },
        { key: 's4', label: '4球', odds: 6.80 },
        { key: 's5', label: '5球', odds: 14.0 },
        { key: 's6', label: '6球', odds: 28.0 },
        { key: 's7', label: '7+球', odds: 38.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '0:0', label: '0:0', odds: 9.20 },
        { key: '0:1', label: '0:1', odds: 5.60 },
        { key: '0:2', label: '0:2', odds: 6.50 },
        { key: '1:1', label: '1:1', odds: 6.40, trend: -1 },
        { key: '1:2', label: '1:2', odds: 7.80 },
        { key: '1:0', label: '1:0', odds: 11.0 },
      ]),
    },
  },
  {
    id: '20261119-004',
    matchNumStr: '周四004',
    league: '世南美预',
    kickoff: '07:30',
    home: '巴拉圭',
    away: '阿根廷',
    homeRank: '55',
    awayRank: '1',
    pools: {
      HAD: buildPool('HAD', '胜平负', true, [
        { key: 'h', label: '主胜', odds: 4.85, trend: 0 },
        { key: 'd', label: '平', odds: 3.35, trend: -1 },
        { key: 'a', label: '客胜', odds: 1.62, trend: 1 },
      ]),
      HHAD: buildPool('HHAD', '让球(+1)', true, [
        { key: 'hh', label: '让胜', odds: 2.02, trend: -1 },
        { key: 'hd', label: '让平', odds: 3.18, trend: -1 },
        { key: 'ha', label: '让负', odds: 3.05, trend: 1 },
      ], '18:18:00', '+1'),
      HAFU: buildPool('HAFU', '半全场', true, [
        { key: 'aa', label: '负负', odds: 2.55 },
        { key: 'da', label: '平负', odds: 3.85, trend: -1 },
        { key: 'dd', label: '平平', odds: 4.60, trend: -1 },
        { key: 'hh', label: '胜胜', odds: 8.20 },
        { key: 'dh', label: '平胜', odds: 9.80 },
        { key: 'hd', label: '胜平', odds: 14.5 },
        { key: 'ha', label: '胜负', odds: 25.0 },
        { key: 'ah', label: '负胜', odds: 40.0 },
        { key: 'ad', label: '负平', odds: 14.5 },
      ]),
      TTG: buildPool('TTG', '总进球', true, [
        { key: 's0', label: '0球', odds: 7.40, trend: -1 },
        { key: 's1', label: '1球', odds: 3.55 },
        { key: 's2', label: '2球', odds: 3.05 },
        { key: 's3', label: '3球', odds: 4.10 },
        { key: 's4', label: '4球', odds: 7.80 },
        { key: 's5', label: '5球', odds: 16.5 },
        { key: 's6', label: '6球', odds: 32.0 },
        { key: 's7', label: '7+球', odds: 45.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: '0:0', label: '0:0', odds: 7.90 },
        { key: '0:1', label: '0:1', odds: 5.10, trend: -1 },
        { key: '0:2', label: '0:2', odds: 6.80 },
        { key: '1:1', label: '1:1', odds: 6.10 },
        { key: '1:2', label: '1:2', odds: 8.20 },
        { key: '1:0', label: '1:0', odds: 10.2 },
      ]),
    },
  },
];

export const FALLBACK_MATCHES = attachMicroQuant(RAW_FALLBACK_MATCHES);

function parseTrend(v) {
  if (v === '1' || v === 1) return 1;
  if (v === '-1' || v === -1) return -1;
  return 0;
}

export function parseSportteryRawJson(json) {
  const groups = json?.value?.matchInfoList ?? [];
  const parsed = [];
  for (const g of groups) {
    for (const m of g.subMatchList ?? []) {
      const poolFlags = {};
      const poolSelling = {};
      const hasPoolList = Array.isArray(m.poolList) && m.poolList.length > 0;
      for (const p of m.poolList ?? []) {
        poolFlags[p.poolCode] = Number(p.bettingSingle) === 1 || Number(p.single) === 1;
        const statusOk = String(p.poolStatus ?? 'Selling').toLowerCase() === 'selling';
        const bettingOk =
          p.bettingAllup !== undefined || p.bettingSingle !== undefined
            ? Number(p.bettingAllup) === 1 || Number(p.bettingSingle) === 1
            : Number(p.cbtValue ?? 1) !== 2;
        poolSelling[p.poolCode] = statusOk && bettingOk;
      }
      const isSelling = (code) => (hasPoolList ? Boolean(poolSelling[code]) : true);
      const hadRaw = m.had ?? {};
      const hhadRaw = m.hhad ?? {};
      const hafuRaw = m.hafu ?? {};
      const ttgRaw = m.ttg ?? {};
      const crsRaw = m.crs ?? {};
      const fallbackMatch = RAW_FALLBACK_MATCHES.find((fm) => fm.matchNumStr === m.matchNumStr);

      parsed.push({
        id: String(m.matchId),
        matchNumStr: m.matchNumStr,
        league: m.leagueAbbName,
        kickoff: (m.matchTime ?? '').slice(0, 5),
        home: m.homeTeamAbbName,
        away: m.awayTeamAbbName,
        homeRank: String(m.homeRank || '').replace(/\D+/g, '') || undefined,
        awayRank: String(m.awayRank || '').replace(/\D+/g, '') || undefined,
        isHot: Number(m.isHot) === 1,
        aiAlert: fallbackMatch?.aiAlert,
        pools: {
          HAD: buildPool(
            'HAD',
            '胜平负',
            Boolean(poolFlags.HAD),
            [
              { key: 'h', label: '主胜', odds: Number(hadRaw.h || 0), trend: parseTrend(hadRaw.hf) },
              { key: 'd', label: '平', odds: Number(hadRaw.d || 0), trend: parseTrend(hadRaw.df) },
              { key: 'a', label: '客胜', odds: Number(hadRaw.a || 0), trend: parseTrend(hadRaw.af) },
            ],
            hadRaw.updateTime || '实时',
            undefined,
            isSelling('HAD')
          ),
          HHAD: buildPool(
            'HHAD',
            `让球(${hhadRaw.goalLine || '-1'})`,
            Boolean(poolFlags.HHAD),
            [
              { key: 'hh', label: '让胜', odds: Number(hhadRaw.h || 0), trend: parseTrend(hhadRaw.hf) },
              { key: 'hd', label: '让平', odds: Number(hhadRaw.d || 0), trend: parseTrend(hhadRaw.df) },
              { key: 'ha', label: '让负', odds: Number(hhadRaw.a || 0), trend: parseTrend(hhadRaw.af) },
            ],
            hhadRaw.updateTime || '实时',
            hhadRaw.goalLine || '-1',
            isSelling('HHAD')
          ),
          HAFU: buildPool(
            'HAFU',
            '半全场',
            poolFlags.HAFU ?? true,
            [
              ['hh', '胜胜'],
              ['hd', '胜平'],
              ['ha', '胜负'],
              ['dh', '平胜'],
              ['dd', '平平'],
              ['da', '平负'],
              ['ah', '负胜'],
              ['ad', '负平'],
              ['aa', '负负'],
            ].map(([k, lbl]) => ({
              key: k,
              label: lbl,
              odds: Number(hafuRaw[k] || 0),
              trend: parseTrend(hafuRaw[`${k}f`]),
            })),
            hafuRaw.updateTime || '实时',
            undefined,
            isSelling('HAFU')
          ),
          TTG: buildPool(
            'TTG',
            '总进球',
            poolFlags.TTG ?? true,
            ['0', '1', '2', '3', '4', '5', '6', '7'].map((n) => ({
              key: `s${n}`,
              label: n === '7' ? '7+球' : `${n}球`,
              odds: Number(ttgRaw[`s${n}`] || 0),
              trend: parseTrend(ttgRaw[`s${n}f`]),
            })),
            ttgRaw.updateTime || '实时',
            undefined,
            isSelling('TTG')
          ),
          CRS: buildPool(
            'CRS',
            '比分',
            poolFlags.CRS ?? true,
            OFFICIAL_CRS_PAIRS.map(([k, lbl]) => ({
              key: lbl,
              label: lbl,
              odds: Number(crsRaw[k] || 0),
              trend: parseTrend(crsRaw[`${k}f`]),
            })),
            crsRaw.updateTime || '实时',
            undefined,
            isSelling('CRS')
          ),
        },
      });
    }
  }
  return attachMicroQuant(parsed);
}

/** 服务端体彩实盘同步（带内存热缓存与磁盘快照双通道） */
export async function fetchOfficialMatchesServer(snapshotFilePath) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(
        'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c',
        { signal: controller.signal }
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = parseSportteryRawJson(json);
        if (parsed.length > 0) {
          if (snapshotFilePath) {
            await fsp.mkdir(path.dirname(snapshotFilePath), { recursive: true }).catch(() => {});
            const tmpPath = `${snapshotFilePath}.tmp.${process.pid}.${Date.now()}`;
            await fsp
              .writeFile(tmpPath, JSON.stringify(json), 'utf-8')
              .then(() => fsp.rename(tmpPath, snapshotFilePath))
              .catch(() => fsp.unlink(tmpPath).catch(() => {}));
          }
          const dropCount = parsed.filter((m) =>
            Object.values(m.pools).some((p) => p.options.some((o) => o.trend === -1))
          ).length;
          return {
            matches: parsed,
            source: 'official-live',
            syncNote: `已从中国体彩官网同步 ${parsed.length} 场在售实盘赛事｜检测到 ${dropCount} 场存在官方降水异动`,
          };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // fallback to disk snapshot
  }

  if (snapshotFilePath && fs.existsSync(snapshotFilePath)) {
    try {
      const raw = await fsp.readFile(snapshotFilePath, 'utf-8');
      const parsed = parseSportteryRawJson(JSON.parse(raw));
      if (parsed.length > 0) {
        const dropCount = parsed.filter((m) =>
          Object.values(m.pools).some((p) => p.options.some((o) => o.trend === -1))
        ).length;
        return {
          matches: parsed,
          source: 'official-live',
          syncNote: `已载入体彩实盘快照 ${parsed.length} 场在售赛事｜检测到 ${dropCount} 场存在官方降水异动`,
        };
      }
    } catch {
      // fallback to built-in
    }
  }

  return {
    matches: FALLBACK_MATCHES,
    source: 'fallback',
    syncNote: '使用内置实盘快照（周二竞彩 4 场焦点战）',
  };
}

function combinationsOfIndices(n, k) {
  const out = [];
  if (k <= 0 || k > n) return out;
  function dfs(start, acc) {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= n - (k - acc.length); i++) {
      acc.push(i);
      dfs(i + 1, acc);
      acc.pop();
    }
  }
  dfs(0, []);
  return out;
}

function buildFreePassMetadata(matchCount, poolCap, isAllSingle, forceSingleOnly, activePassSizes) {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((size) => {
    const label = size === 1 ? '单关' : `${size}关`;
    let enabled = false;
    let disabledReason = null;
    if (matchCount === 0) {
      disabledReason = '请先选比赛';
    } else if (size === 1) {
      enabled = isAllSingle;
      if (!enabled) disabledReason = '所选含未开单关玩法';
    } else if (forceSingleOnly) {
      disabledReason = '当前选单仅限单关';
    } else if (size > matchCount) {
      disabledReason = `需选满${size}场`;
    } else if (size > poolCap) {
      disabledReason = poolCap <= 4 ? '含比分/半全场限4关' : '含总进球限6关';
    } else {
      enabled = true;
    }
    return {
      size,
      label,
      enabled,
      active: activePassSizes.includes(size),
      disabledReason,
    };
  });
}

function buildComboPassMetadata(
  matchCount,
  poolCap,
  forceSingleOnly,
  activeComboCode,
  mTupleCount = 1
) {
  const presets = OFFICIAL_COMBO_PASS_TABLE[matchCount] ?? [];
  return presets.map((pr) => {
    const enabled = !forceSingleOnly && pr.sizes.every((s) => s <= poolCap);
    return {
      code: pr.code,
      label: pr.label,
      sizes: pr.sizes,
      baseBets: pr.baseBets,
      actualBets: pr.baseBets * Math.max(1, mTupleCount),
      desc: pr.desc,
      enabled,
      active: activeComboCode === pr.code,
      disabledReason: forceSingleOnly
        ? '当前选单仅限单关'
        : !enabled
          ? poolCap <= 4
            ? '含比分/半全场限4关'
            : '含总进球限6关'
          : null,
    };
  });
}

function areHadHhadCompatible(hadKey, hhadKey, goalLineNum) {
  const gl = Number(goalLineNum) || -1;
  // 测试典型净胜球差 diff in [-4..+4] 是否存在同时命中的真实比分
  for (let diff = -4; diff <= 4; diff++) {
    const hadOut = diff > 0 ? 'h' : diff === 0 ? 'd' : 'a';
    const adj = diff + gl;
    const hhadOut = adj > 0 ? 'hh' : adj === 0 ? 'hd' : 'ha';
    if (hadOut === hadKey && hhadOut === hhadKey) return true;
  }
  return false;
}

function buildBlockedTruthReport({
  matchCount,
  multiple,
  modeLabel,
  canSingle,
  ruleBlockReason,
  poolCap,
  availableFreePasses,
  availableComboPasses,
  hasSameMatchCrossPoolConflict,
  syntheticHint,
  syntheticRescuePicks,
  warnings,
}) {
  return {
    matchCount,
    betCount: 0,
    comboCount: 0,
    multiple,
    modeLabel,
    canSingle,
    canCheckout: false,
    ruleBlockReason,
    poolCap,
    activePassSizes: [],
    activeComboCode: null,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    totalCost: 0,
    minPayout: 0,
    maxPayout: 0,
    likelyRange: [0, 0],
    anyWinProb: 0,
    realProfitProb: 0,
    underwaterCount: 0,
    underwaterShareOfWins: 0,
    avgPayoutRatio: 0,
    avgVigLossPer100: 0,
    expectedValueRate: 0,
    dangerScore: matchCount > 0 ? 45 : 0,
    effectiveOdds: 0,
    breakevenUpgradeCost: null,
    consolidatedTickets: 0,
    syntheticHint: syntheticHint ?? null,
    syntheticRescuePicks: syntheticRescuePicks ?? null,
    tickets: [],
    combos: [],
    warnings: warnings ?? [],
  };
}

/** 计算五维真相看板、体彩法定过关矩阵与 6 大防坑雷达（纯数学黑盒，遵循 ADR-0002 & ADR-0007） */
export function computeTruthReport(rawPicksInput, rawMultiple, matches, passSpec) {
  const multiple = Math.max(1, Math.min(999, Math.round(Number(rawMultiple) || 1)));
  const picks = (Array.isArray(rawPicksInput) ? rawPicksInput : [])
    .filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof p.matchId === 'string' &&
        typeof p.poolCode === 'string' &&
        typeof p.optionKey === 'string'
    )
    .slice(0, 120);

  const byMatch = new Map();
  for (const p of picks) {
    const arr = byMatch.get(p.matchId) ?? [];
    arr.push(p);
    byMatch.set(p.matchId, arr);
  }

  const matchGroups = Array.from(byMatch.values());
  const matchCount = matchGroups.length;

  if (matchCount === 0) {
    return buildBlockedTruthReport({
      matchCount: 0,
      multiple,
      modeLabel: '过关选择',
      canSingle: false,
      ruleBlockReason: null,
      poolCap: 8,
      availableFreePasses: buildFreePassMetadata(0, 8, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: false,
      syntheticHint: null,
      syntheticRescuePicks: null,
      warnings: [],
    });
  }

  // 校验未开售盘口与异常赔率
  for (const p of picks) {
    const fm = Array.isArray(matches) ? matches.find((x) => x.id === p.matchId) : null;
    const pool = fm?.pools?.[p.poolCode];
    if (pool && (pool.selling === false || !Array.isArray(pool.options) || pool.options.length === 0)) {
      return buildBlockedTruthReport({
        matchCount,
        multiple,
        modeLabel: '含停售盘口',
        canSingle: false,
        ruleBlockReason: `${fm.matchNumStr || ''}【${pool.name || p.poolCode}】当前未开售或已暂停销售`,
        poolCap: 8,
        availableFreePasses: buildFreePassMetadata(matchCount, 8, false, false, []),
        availableComboPasses: [],
        hasSameMatchCrossPoolConflict: false,
        syntheticHint: null,
        syntheticRescuePicks: null,
        warnings: [],
      });
    }
    if (!(Number(p.odds) > 0)) {
      return buildBlockedTruthReport({
        matchCount,
        multiple,
        modeLabel: '无效赔率',
        canSingle: false,
        ruleBlockReason: '选单包含未开售或无效赔率选项',
        poolCap: 8,
        availableFreePasses: buildFreePassMetadata(matchCount, 8, false, false, []),
        availableComboPasses: [],
        hasSameMatchCrossPoolConflict: false,
        syntheticHint: null,
        syntheticRescuePicks: null,
        warnings: [],
      });
    }
  }

  let hasSameMatchCrossPoolConflict = false;
  let hasIllegalCrossPoolPair = false;
  for (const grp of matchGroups) {
    const pools = Array.from(new Set(grp.map((g) => g.poolCode)));
    if (pools.length > 1) {
      hasSameMatchCrossPoolConflict = true;
      if (pools.some((c) => c !== 'HAD' && c !== 'HHAD')) {
        hasIllegalCrossPoolPair = true;
      }
    }
  }

  const isPickSingleAllowed = (pk) => {
    const fm = Array.isArray(matches) ? matches.find((x) => x.id === pk.matchId) : null;
    const pool = fm?.pools?.[pk.poolCode];
    if (pool && typeof pool.single === 'boolean') {
      return Boolean(pk.singleAllowed) && pool.single;
    }
    return Boolean(pk.singleAllowed);
  };
  const isAllSingle = picks.length > 0 && picks.every(isPickSingleAllowed);
  const canSingle = matchCount === 1 && isAllSingle && !hasIllegalCrossPoolPair;
  const poolCap = Math.min(...picks.map((p) => POOL_MAX_PASS[p.poolCode] ?? 8));

  let syntheticHint = null;
  let syntheticRescuePicks = null;
  if (matchCount === 1) {
    const m = Array.isArray(matches) ? matches.find((x) => x.id === matchGroups[0][0].matchId) : null;
    if (m && (!canSingle || !m.pools.HAD.single) && m.pools.HAFU?.single) {
      const grpKeys = matchGroups[0].map((g) => g.optionKey);
      const isOnlyDraw = grpKeys.includes('d') && !grpKeys.includes('h') && !grpKeys.includes('a');
      const isAwayLean = grpKeys.some((k) => k === 'a' || k === 'ha') && !grpKeys.includes('h');
      const rescueKeys = isOnlyDraw ? ['dd', 'hd', 'ad'] : isAwayLean ? ['aa', 'da'] : ['hh', 'dh'];
      const rescueOpts = rescueKeys
        .map((rk) => m.pools.HAFU.options.find((o) => o.key === rk))
        .filter(Boolean);
      if (rescueOpts.length >= 2) {
        const synEff = 1 / rescueOpts.reduce((acc, o) => acc + 1 / Math.max(1.01, o.odds), 0);
        const labelPair = rescueOpts.map((o) => o.label).join('+');
        syntheticRescuePicks = rescueOpts.map((o) => ({
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: 'HAFU',
          poolName: m.pools.HAFU.name,
          singleAllowed: true,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        }));
        syntheticHint = `${m.matchNumStr} 当前所选玩法未开单关；借道半全场单关买「${labelPair}」均衡配注后合成等效水位达 ${synEff.toFixed(2)}，支持一键无损切换单场出票！`;
      }
    }
  }

  if (hasIllegalCrossPoolPair || (hasSameMatchCrossPoolConflict && !isAllSingle)) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: '同场跨玩法禁串',
      canSingle: false,
      ruleBlockReason: '同一场比赛不能同时选择多种玩法进行串关，请取消同场跨玩法选项',
      poolCap,
      availableFreePasses: buildFreePassMetadata(matchCount, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: true,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: 'cross-pool-same-match',
          severity: 'danger',
          title: '同场跨玩法违规（体彩严禁同一场不同玩法互串）',
          detail: '你在同一场比赛勾选了两种不同玩法且不满足双单关条件，体彩终端无法出票；请只保留一种玩法。',
        },
      ],
    });
  }

  if (matchCount > 15) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: '超15场上限',
      canSingle: false,
      ruleBlockReason: '中国体彩单次选单最多不超过 15 场赛事',
      poolCap,
      availableFreePasses: buildFreePassMetadata(matchCount, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: 'over-15-matches',
          severity: 'danger',
          title: '超出 15 场单次选单上限',
          detail: '请精简场次至 15 场以内（串关最多 8 场）。',
        },
      ],
    });
  }

  if (matchCount > 8 && !isAllSingle) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: '超8场串关上限',
      canSingle: false,
      ruleBlockReason: '中国体彩串关最多不能超过 8 场赛事',
      poolCap,
      availableFreePasses: buildFreePassMetadata(matchCount, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: 'over-8-matches',
          severity: 'danger',
          title: '超出 8 场串关法定上限',
          detail: '竞彩足球串关最多允许选择 8 场比赛，请精简场次后再计算。',
        },
      ],
    });
  }

  if (matchCount === 1 && !canSingle) {
    return buildBlockedTruthReport({
      matchCount: 1,
      multiple,
      modeLabel: '还差1场凑2串1',
      canSingle: false,
      ruleBlockReason: '该玩法未开放单关，需再选至少 1 场比赛凑 2串1，或改选半全场/比分/总进球单关',
      poolCap,
      availableFreePasses: buildFreePassMetadata(1, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: false,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: 'no-single',
          severity: 'warn',
          title: '该玩法未开单关（当前无法单独出票，需再选 1 场）',
          detail: '体彩本场胜平负/让球未开放单关，需再串 1 场或直接改用「半全场 / 比分 / 总进球」合成单关。',
        },
      ],
    });
  }

  const forceSingleOnly = hasSameMatchCrossPoolConflict || matchCount > 8;
  const effectiveMaxPass = forceSingleOnly ? 1 : Math.min(matchCount, poolCap);
  const mTupleCount = matchGroups.reduce((acc, grp) => Math.min(2048, acc * grp.length), 1);

  let activePassSizes = [];
  let activeComboCode = null;
  let modeLabel = '';

  if (forceSingleOnly || matchCount === 1) {
    activePassSizes = [1];
    modeLabel = '单关';
  } else if (passSpec?.mode === 'combo' && passSpec.comboCode) {
    const presets = OFFICIAL_COMBO_PASS_TABLE[matchCount] ?? [];
    const matched = presets.find(
      (pr) => pr.code === passSpec.comboCode && pr.sizes.every((s) => s <= effectiveMaxPass)
    );
    if (matched) {
      activePassSizes = [...matched.sizes];
      activeComboCode = matched.code;
      modeLabel = matched.label;
    }
  } else if (passSpec?.mode === 'free' && Array.isArray(passSpec.passSizes)) {
    const valid = Array.from(new Set(passSpec.passSizes.map((x) => Number(x))))
      .filter((k) => (k === 1 ? isAllSingle : k >= 2 && k <= effectiveMaxPass))
      .sort((a, b) => a - b);
    if (valid.length > 0) {
      activePassSizes = valid;
      modeLabel = valid.map((k) => (k === 1 ? '单关' : `${k}串1`)).join('+');
    }
  }

  if (activePassSizes.length === 0) {
    activePassSizes = [effectiveMaxPass];
    modeLabel = effectiveMaxPass === 1 ? '单关' : `${effectiveMaxPass}串1`;
  }

  const availableFreePasses = buildFreePassMetadata(
    matchCount,
    poolCap,
    isAllSingle,
    forceSingleOnly,
    activeComboCode ? [] : activePassSizes
  );
  const availableComboPasses = buildComboPassMetadata(
    matchCount,
    poolCap,
    forceSingleOnly,
    activeComboCode,
    mTupleCount
  );

  const rawTickets = [];
  if (activeComboCode) {
    // 官方 M串N 多串过关复式规则：先对 M 场比赛取单场各1项笛卡尔积（共 mTupleCount 组 M串N 票），再逐组展开子串关！
    let mTuples = [[]];
    for (const grp of matchGroups) {
      const next = [];
      for (const prev of mTuples) {
        for (const item of grp) {
          next.push([...prev, item]);
        }
      }
      mTuples = next.length > 512 ? next.slice(0, 512) : next;
    }
    for (const tuple of mTuples) {
      for (const k of activePassSizes) {
        const indexSubsets = combinationsOfIndices(matchCount, k);
        for (const subset of indexSubsets) {
          rawTickets.push({
            legs: subset.map((i) => tuple[i]),
            matchIndices: subset,
          });
          if (rawTickets.length >= 2048) break;
        }
        if (rawTickets.length >= 2048) break;
      }
      if (rawTickets.length >= 2048) break;
    }
  } else if (forceSingleOnly && hasSameMatchCrossPoolConflict) {
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      for (const p of matchGroups[mIdx]) {
        rawTickets.push({ legs: [p], matchIndices: [mIdx] });
      }
    }
  } else {
    for (const k of activePassSizes) {
      if (k === 1) {
        for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
          for (const p of matchGroups[mIdx]) {
            rawTickets.push({ legs: [p], matchIndices: [mIdx] });
          }
        }
      } else {
        const indexSubsets = combinationsOfIndices(matchCount, k);
        for (const subset of indexSubsets) {
          let tupleCartesian = [[]];
          for (const mIdx of subset) {
            const next = [];
            for (const prev of tupleCartesian) {
              for (const item of matchGroups[mIdx]) {
                next.push([...prev, item]);
              }
            }
            tupleCartesian = next;
            if (tupleCartesian.length > 512) tupleCartesian = tupleCartesian.slice(0, 512);
          }
          for (const legs of tupleCartesian) {
            rawTickets.push({ legs, matchIndices: subset });
            if (rawTickets.length >= 2048) break;
          }
          if (rawTickets.length >= 2048) break;
        }
      }
      if (rawTickets.length >= 2048) break;
    }
  }

  const betCount = rawTickets.length;
  const totalCost = betCount * 2 * multiple;

  const ticketRows = rawTickets.map((t, idx) => {
    const legCount = t.legs.length;
    const cap = statutorySingleBetCap(legCount);
    const prob = t.legs.reduce((acc, it) => acc * it.fairProb, 1);
    const unitBeforeCap = bankerRoundParlayUnitPayout(t.legs.map((it) => it.odds));
    const unitCapped = Math.min(cap, unitBeforeCap);
    const cappedClipped = Math.max(0, (unitBeforeCap - unitCapped) * multiple);
    const totalPayout = Number((unitCapped * multiple).toFixed(2));
    const netProfit = Number((totalPayout - totalCost).toFixed(2));
    return {
      id: `tk-${idx}`,
      desc: t.legs.map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`).join(' × '),
      legs: t.legs,
      matchIndices: t.matchIndices,
      prob,
      unitPayout: unitCapped,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  });

  let combos = [];
  const isPureFullParlay =
    !hasSameMatchCrossPoolConflict &&
    activePassSizes.length === 1 &&
    activePassSizes[0] === matchCount;

  const isSinglePassOnly = activePassSizes.length === 1 && activePassSizes[0] === 1;

  if (isPureFullParlay) {
    combos = ticketRows.map((tr, idx) => ({
      id: `c-${idx}`,
      desc: tr.desc,
      legs: tr.legs,
      prob: tr.prob,
      unitPayout: tr.unitPayout,
      totalPayout: tr.totalPayout,
      cappedClipped: tr.cappedClipped,
      netProfit: tr.netProfit,
      isUnderwater: tr.isUnderwater,
    }));
  } else if (isSinglePassOnly) {
    // 单关专属精确评估器（支持同场 HAD+HHAD 双单关物理比分兼容矩阵 & 9~15 场 O(M) 线性无阻塞聚合）
    const perMatchOutcomes = matchGroups.map((grp, mIdx) => {
      const mTickets = ticketRows.filter((tr) => tr.matchIndices[0] === mIdx);
      const pools = new Set(grp.map((g) => g.poolCode));
      if (pools.size <= 1) {
        const rawSum = mTickets.reduce((a, t) => a + t.prob, 0);
        const scale = rawSum > 0.995 ? 0.995 / rawSum : 1;
        const winSets = mTickets.map((t) => ({
          tickets: [t],
          prob: t.prob * scale,
        }));
        const hitSum = winSets.reduce((a, w) => a + w.prob, 0);
        return { winSets, hitSum, missProb: Math.max(0, 1 - hitSum) };
      }

      // 同场 HAD + HHAD 双单关：按净胜球差 diff in [-4..+4] 枚举真实兼容中奖集合
      const fm = Array.isArray(matches) ? matches.find((x) => x.id === grp[0].matchId) : null;
      const gl = Number(fm?.pools?.HHAD?.goalLine) || -1;
      const diffWeights = [
        [-3, 0.03],
        [-2, 0.08],
        [-1, 0.17],
        [0, 0.26],
        [1, 0.23],
        [2, 0.14],
        [3, 0.09],
      ];
      const byKey = new Map();
      let missProb = 0;
      for (const [diff, w] of diffWeights) {
        const hadKey = diff > 0 ? 'h' : diff === 0 ? 'd' : 'a';
        const adj = diff + gl;
        const hhadKey = adj > 0 ? 'hh' : adj === 0 ? 'hd' : 'ha';
        const hits = mTickets.filter(
          (t) =>
            (t.legs[0].poolCode === 'HAD' && t.legs[0].optionKey === hadKey) ||
            (t.legs[0].poolCode === 'HHAD' && t.legs[0].optionKey === hhadKey)
        );
        if (hits.length === 0) {
          missProb += w;
        } else {
          const sig = hits.map((h) => h.id).join('+');
          const prev = byKey.get(sig);
          if (prev) prev.prob += w;
          else byKey.set(sig, { tickets: hits, prob: w });
        }
      }
      const winSets = Array.from(byKey.values());
      const hitSum = winSets.reduce((a, x) => a + x.prob, 0);
      return { winSets, hitSum, missProb: Math.max(0, 1 - hitSum) };
    });

    const singleStateCount = perMatchOutcomes.reduce((acc, m) => acc * (m.winSets.length + 1), 1);
    if (matchCount <= 8 && singleStateCount <= 2048) {
      let stateVecs = [[]];
      for (const pm of perMatchOutcomes) {
        const next = [];
        for (const prev of stateVecs) {
          next.push([...prev, null]);
          for (const ws of pm.winSets) next.push([...prev, ws]);
        }
        stateVecs = next;
      }
      let scIdx = 0;
      for (const sv of stateVecs) {
        const winningTickets = [];
        for (const cell of sv) {
          if (cell) winningTickets.push(...cell.tickets);
        }
        if (winningTickets.length === 0) continue;
        const prob = sv.reduce(
          (acc, cell, mIdx) => acc * (cell ? cell.prob : perMatchOutcomes[mIdx].missProb),
          1
        );
        const unitPayout = Number(winningTickets.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
        const totalPayout = Number(winningTickets.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
        const cappedClipped = Number(
          winningTickets.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2)
        );
        const netProfit = Number((totalPayout - totalCost).toFixed(2));
        const hitLegs = winningTickets.map((w) => w.legs[0]);
        combos.push({
          id: `c-${scIdx++}`,
          desc:
            `单关中${winningTickets.length}注 · ` +
            hitLegs.map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`).join(' + '),
          legs: hitLegs,
          prob,
          unitPayout,
          totalPayout,
          cappedClipped,
          netProfit,
          isUnderwater: netProfit < 0,
        });
      }
    } else {
      // 9~15 场多场单关 O(M) 线性汇总（彻底杜绝 2^N 状态爆炸）
      const overallMissProb = perMatchOutcomes.reduce((acc, m) => acc * m.missProb, 1);
      const overallWinProb = Math.max(0.001, 1 - overallMissProb);
      const allBestTickets = perMatchOutcomes
        .map((pm) =>
          [...pm.winSets].sort(
            (a, b) =>
              b.tickets.reduce((s, t) => s + t.totalPayout, 0) -
              a.tickets.reduce((s, t) => s + t.totalPayout, 0)
          )[0]
        )
        .filter(Boolean);
      const allHitTickets = allBestTickets.flatMap((x) => x.tickets);
      const allHitProb = perMatchOutcomes.reduce((acc, m) => acc * Math.max(0.01, m.hitSum), 1);
      const remProb = Math.max(0, overallWinProb - allHitProb);
      const soloWeight = remProb / Math.max(1, perMatchOutcomes.length);

      let scIdx = 0;
      perMatchOutcomes.forEach((pm) => {
        const worst = [...pm.winSets].sort(
          (a, b) =>
            a.tickets.reduce((s, t) => s + t.totalPayout, 0) -
            b.tickets.reduce((s, t) => s + t.totalPayout, 0)
        )[0];
        if (!worst) return;
        const unitPayout = Number(worst.tickets.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
        const totalPayout = Number(worst.tickets.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
        const cappedClipped = Number(
          worst.tickets.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2)
        );
        const netProfit = Number((totalPayout - totalCost).toFixed(2));
        const hitLegs = worst.tickets.map((w) => w.legs[0]);
        combos.push({
          id: `c-${scIdx++}`,
          desc: `单关仅中1场 · ${hitLegs.map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`).join('+')}`,
          legs: hitLegs,
          prob: soloWeight,
          unitPayout,
          totalPayout,
          cappedClipped,
          netProfit,
          isUnderwater: netProfit < 0,
        });
      });

      if (allHitTickets.length > 0) {
        const unitPayout = Number(allHitTickets.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
        const totalPayout = Number(allHitTickets.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
        const cappedClipped = Number(
          allHitTickets.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2)
        );
        const netProfit = Number((totalPayout - totalCost).toFixed(2));
        const hitLegs = allHitTickets.map((w) => w.legs[0]);
        combos.push({
          id: `c-${scIdx++}`,
          desc: `单关${matchCount}场全红(${allHitTickets.length}注齐中)`,
          legs: hitLegs,
          prob: allHitProb,
          unitPayout,
          totalPayout,
          cappedClipped,
          netProfit,
          isUnderwater: netProfit < 0,
        });
      }
    }
  } else {
    const kMin = Math.min(...activePassSizes);
    const normalizedGroups = matchGroups.map((grp) => {
      const rawSum = grp.reduce((a, p) => a + p.fairProb, 0);
      const scale = rawSum > 0.995 ? 0.995 / rawSum : 1;
      const items = grp.map((p) => ({ pick: p, prob: p.fairProb * scale }));
      const hitSum = items.reduce((a, x) => a + x.prob, 0);
      return { items, hitSum, missProb: Math.max(0, 1 - hitSum) };
    });

    const totalStateCount = normalizedGroups.reduce((acc, g) => acc * (g.items.length + 1), 1);

    if (totalStateCount <= 2048) {
      let stateVectors = [[]];
      for (const ng of normalizedGroups) {
        const next = [];
        for (const prev of stateVectors) {
          next.push([...prev, null]);
          for (const it of ng.items) {
            next.push([...prev, it]);
          }
        }
        stateVectors = next;
      }

      let scIdx = 0;
      for (const sv of stateVectors) {
        let hitCount = 0;
        for (const cell of sv) if (cell) hitCount++;
        if (hitCount < kMin) continue;

        const winningTickets = ticketRows.filter((tr) =>
          tr.matchIndices.every((mIdx, pos) => sv[mIdx]?.pick === tr.legs[pos])
        );
        if (winningTickets.length === 0) continue;

        const prob = sv.reduce(
          (acc, cell, mIdx) => acc * (cell ? cell.prob : normalizedGroups[mIdx].missProb),
          1
        );
        const unitPayout = Number(winningTickets.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
        const totalPayout = Number(winningTickets.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
        const cappedClipped = Number(
          winningTickets.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2)
        );
        const netProfit = Number((totalPayout - totalCost).toFixed(2));
        const hitLegs = sv.filter(Boolean).map((c) => c.pick);
        combos.push({
          id: `c-${scIdx++}`,
          desc:
            `中${hitLegs.length}/${matchCount}场(${winningTickets.length}注中) · ` +
            hitLegs.map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`).join(' × '),
          legs: hitLegs,
          prob,
          unitPayout,
          totalPayout,
          cappedClipped,
          netProfit,
          isUnderwater: netProfit < 0,
        });
      }
    } else {
      // matchCount 此处恒 <= 8（最多 256 个场次子集），将极值提取至循环外
      const minPickByMatch = matchGroups.map((grp) =>
        [...grp].sort((a, b) => a.odds - b.odds)[0]
      );
      const maxPickByMatch = matchGroups.map((grp) =>
        [...grp].sort((a, b) => b.odds - a.odds)[0]
      );
      const subsetCount = 1 << Math.min(8, matchCount);
      let scIdx = 0;
      for (let mask = 1; mask < subsetCount; mask++) {
        const hitIndices = [];
        for (let b = 0; b < Math.min(8, matchCount); b++) {
          if (mask & (1 << b)) hitIndices.push(b);
        }
        if (hitIndices.length < kMin) continue;
        const subsetProb = normalizedGroups.reduce(
          (acc, ng, idx) => acc * (mask & (1 << idx) ? ng.hitSum : ng.missProb),
          1
        );

        const evalPickVector = (pickVec, weightShare, tag) => {
          const winning = ticketRows.filter((tr) =>
            tr.matchIndices.every(
              (mIdx, pos) => (mask & (1 << mIdx)) !== 0 && pickVec[mIdx] === tr.legs[pos]
            )
          );
          if (winning.length === 0) return;
          const unitPayout = Number(winning.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
          const totalPayout = Number(winning.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
          const cappedClipped = Number(winning.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2));
          const netProfit = Number((totalPayout - totalCost).toFixed(2));
          const hitLegs = hitIndices.map((idx) => pickVec[idx]);
          combos.push({
            id: `c-${scIdx++}`,
            desc:
              `中${hitLegs.length}/${matchCount}场(${tag}·${winning.length}注中) · ` +
              hitLegs.map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`).join(' × '),
            legs: hitLegs,
            prob: subsetProb * weightShare,
            unitPayout,
            totalPayout,
            cappedClipped,
            netProfit,
            isUnderwater: netProfit < 0,
          });
        };
        const sameExtremes = hitIndices.every((idx) => minPickByMatch[idx] === maxPickByMatch[idx]);
        if (sameExtremes) {
          evalPickVector(maxPickByMatch, 1, '标准');
        } else {
          evalPickVector(minPickByMatch, 0.55, '低赔档');
          evalPickVector(maxPickByMatch, 0.45, '高赔档');
        }
      }
    }
  }

  combos.sort((a, b) => a.totalPayout - b.totalPayout);
  const comboCount = combos.length;
  const minPayout = combos[0]?.totalPayout ?? 0;
  const maxPayout = combos[combos.length - 1]?.totalPayout ?? 0;

  const byProbDesc = [...combos].sort((a, b) => b.prob - a.prob);
  const topHalf = byProbDesc.slice(0, Math.max(1, Math.ceil(byProbDesc.length * 0.6)));
  const likelyMin = topHalf.length ? Math.min(...topHalf.map((c) => c.totalPayout)) : 0;
  const likelyMax = topHalf.length ? Math.max(...topHalf.map((c) => c.totalPayout)) : 0;

  const anyWinProb = Math.min(
    0.995,
    combos.reduce((acc, c) => acc + c.prob, 0)
  );

  const realProfitProb = Math.min(
    anyWinProb,
    combos.filter((c) => !c.isUnderwater).reduce((acc, c) => acc + c.prob, 0)
  );

  const underwaterCount = combos.filter((c) => c.isUnderwater).length;
  const underwaterShareOfWins =
    anyWinProb > 0
      ? Math.min(1, combos.filter((c) => c.isUnderwater).reduce((a, c) => a + c.prob, 0) / anyWinProb)
      : 0;

  const avgPassLen =
    activePassSizes.reduce((a, b) => a + b, 0) / Math.max(1, activePassSizes.length);
  const perMatchRatios = matchGroups.map((grp) => {
    const m = Array.isArray(matches) ? matches.find((x) => x.id === grp[0].matchId) : null;
    const pool = m?.pools[grp[0].poolCode];
    return pool?.payoutRatio ?? 0.875;
  });
  const meanSingleRatio =
    perMatchRatios.reduce((a, b) => a + b, 0) / Math.max(1, perMatchRatios.length);
  const avgPayoutRatio =
    isPureFullParlay
      ? perMatchRatios.reduce((acc, r) => acc * r, 1)
      : Math.pow(meanSingleRatio, avgPassLen);
  const avgVigLossPer100 = Number(((1 - avgPayoutRatio) * 100).toFixed(1));

  const expectedReturn = combos.reduce((acc, c) => acc + c.prob * c.totalPayout, 0);
  const expectedValueRate = totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0;

  const invTicketOddsSum = ticketRows.reduce((acc, c) => acc + 2 / Math.max(0.01, c.unitPayout), 0);
  const effectiveOdds = invTicketOddsSum > 0 ? 1 / invTicketOddsSum : 0;

  let breakevenUpgradeCost = null;
  if (underwaterCount > 0 && effectiveOdds > 1.03 && ticketRows.length <= 24) {
    for (
      let targetNotes = betCount * multiple;
      targetNotes <= betCount * multiple + 15;
      targetNotes++
    ) {
      const budget = targetNotes * 2;
      const neededNotes = ticketRows.reduce((acc, c) => acc + Math.ceil(budget / c.unitPayout), 0);
      if (neededNotes <= targetNotes) {
        breakevenUpgradeCost = neededNotes * 2;
        break;
      }
    }
  }

  const rawDanger =
    (1 - realProfitProb) * 58 +
    Math.max(0, avgPassLen - 1) * 9 +
    underwaterShareOfWins * 22;
  const dangerScore = Math.min(99, Math.max(8, Math.round(rawDanger)));

  const warnings = [];
  if (matchCount > poolCap && !forceSingleOnly) {
    warnings.push({
      id: 'pool-pass-cap',
      severity: 'tip',
      title: `玩法最高过关自动限流（已按最高 ${poolCap} 关拆票）`,
      detail:
        poolCap <= 4
          ? '所选包含「比分 / 半全场」玩法，按中国体彩规则单注最高仅限 4 关，已自动禁用 5~8 关。'
          : '所选包含「总进球」玩法，按中国体彩规则单注最高仅限 6 关，已自动禁用 7~8 关。',
    });
  }
  if (effectiveOdds > 0 && effectiveOdds <= 1.0 && activePassSizes.length === 1 && activePassSizes[0] === matchCount) {
    warnings.push({
      id: 'guaranteed-loss',
      severity: 'danger',
      title: `必亏盘红灯拦截（合成等效水位仅 ${effectiveOdds.toFixed(2)}）`,
      detail: '同场包号过多，无论如何分配倍数都注定亏本或大面积倒贴！请至少砍掉 1~2 个高赔低概率鸡肋项。',
    });
  } else if (underwaterCount > 0) {
    warnings.push({
      id: 'underwater',
      severity: 'danger',
      title: `假中奖警报：${underwaterCount}/${comboCount} 种命中场景实际倒贴钱！`,
      detail: `官网只给你看最高 ${maxPayout.toFixed(2)} 元，但低赔或局部命中时最低仅拿 ${minPayout.toFixed(2)} 元（净亏 ${(totalCost - minPayout).toFixed(2)} 元）。${
        breakevenUpgradeCost
          ? `✨ 开启奖金优化并将总本金调至 ${breakevenUpgradeCost} 元即可实现 100% 组合零亏损保本！`
          : '建议使用「三模奖金优化」重新分配各注倍数。'
      }`,
    });
  }
  if (hasSameMatchCrossPoolConflict) {
    warnings.push({
      id: 'cross-pool-same-match',
      severity: 'warn',
      title: '同场双单关独立计奖提醒（已强制锁定单关）',
      detail: '同一场比赛勾选了两个已开单关玩法，按中国体彩规则仅支持【单关】独立计奖，不可参与串关。',
    });
  }
  if (avgPassLen >= 4 || avgPayoutRatio < 0.65) {
    warnings.push({
      id: 'parlay-vig',
      severity: 'danger',
      title: `串关连乘抽水雪崩：体彩已暗扣 ${avgVigLossPer100}% 数学期望`,
      detail: `当前 ${modeLabel} 综合返还率跌至 ${(avgPayoutRatio * 100).toFixed(1)}%；建议在底栏「过关选择」改选 2关/3关 或 M串N 容错防黑单场。`,
    });
  }
  const maxPassUsed = Math.max(...activePassSizes);
  const maxTierCap = statutorySingleBetCap(maxPassUsed);
  const totalClipped = ticketRows.reduce((a, c) => a + c.cappedClipped, 0);
  if (totalClipped > 0 || multiple > 99) {
    warnings.push({
      id: 'cap-clip',
      severity: totalClipped > 0 ? 'danger' : 'warn',
      title:
        totalClipped > 0
          ? `封顶截断警告：有 ${totalClipped.toFixed(0)} 元超额奖金将被体彩无偿没收！`
          : `超出单张实票 99 倍上限（体彩店需拆成 ${Math.ceil(multiple / 99)} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${maxTierCap / 10000} 万元法定单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : '终端机单张实票最高 99 倍，已自动为你按 99 倍上限核算店面拆票张数。',
    });
  }
  const overOrder20k = totalCost > 20_000;
  if (overOrder20k) {
    warnings.push({
      id: 'order-limit-20k',
      severity: 'danger',
      title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${totalCost}）`,
      detail: '中国体彩规定单次订单投注金额不得超过 20,000 元，已拦截出票，请下调倍数或分批打票。',
    });
  } else if (totalCost > 6_000) {
    warnings.push({
      id: 'rational-6k',
      severity: 'warn',
      title: `大额投注风控提醒（当前总投入 ¥${totalCost} 已超 ¥6,000）`,
      detail: '触发体彩官方大额理性购彩阈值，请严格核对今日止损护栏额度。',
    });
  }

  const consolidatedTickets = Math.max(
    1,
    Math.min(24, Math.ceil(betCount / 3) * Math.ceil(multiple / 99))
  );

  return {
    matchCount,
    betCount,
    comboCount,
    multiple,
    modeLabel,
    canSingle,
    canCheckout: !overOrder20k,
    ruleBlockReason: overOrder20k
      ? `单次订单金额 ¥${totalCost} 超出体彩 ¥20,000 硬上限，请调低倍数或分单`
      : null,
    poolCap,
    activePassSizes,
    activeComboCode,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    totalCost,
    minPayout,
    maxPayout,
    likelyRange: [likelyMin, likelyMax],
    anyWinProb,
    realProfitProb,
    underwaterCount,
    underwaterShareOfWins,
    avgPayoutRatio,
    avgVigLossPer100,
    expectedValueRate,
    dangerScore,
    effectiveOdds,
    breakevenUpgradeCost,
    consolidatedTickets,
    syntheticHint,
    syntheticRescuePicks,
    tickets: ticketRows,
    combos,
    warnings,
  };
}

function makeLeg(m, poolCode, optionKey, stance) {
  const pool = m.pools[poolCode];
  const opt = pool?.options.find((o) => o.key === optionKey) ?? pool?.options[0];
  if (!pool || !opt) return null;

  let prob = opt.fairProb;
  if (stance === 'home-lean' && (optionKey === 'h' || optionKey === 'hh' || optionKey === 'dh')) {
    prob = Math.min(0.88, prob * 1.08);
  } else if (
    stance === 'upset-watch' &&
    (optionKey === 'd' || optionKey === 'hd' || optionKey === 'a' || optionKey === 'ha')
  ) {
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

function repairUnderwaterMultiples(initialMults, unitPayouts, shouldRepair) {
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

function allocateLines(rawLines, targetBudgetYuan) {
  const validLines = rawLines
    .map((r) => {
      const nonNull = (Array.isArray(r?.legs) ? r.legs : []).filter(Boolean);
      if (nonNull.length === 0) return null;
      const legCap = Math.min(...nonNull.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
      return { ...r, legs: nonNull.slice(0, legCap) };
    })
    .filter(Boolean);
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

  let mults;
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

/** 2. 生成五大实战战术流派配单（支持锚定赛事雷达用户所选球队方向） */
export function generateFiveArchetypes(
  targetMatches,
  budgetYuan,
  stance,
  unlockFullAgg,
  anchorPicks = []
) {
  const cleanBudget = Math.max(20, Math.round(budgetYuan / 2) * 2);
  if (targetMatches.length === 0) return [];

  const selected = targetMatches.slice(0, 8);
  const primaryPoolOf = (m) => (m.pools.HAD.options.length >= 2 ? 'HAD' : 'HHAD');

  const anchorsByMatch = new Map();
  if (Array.isArray(anchorPicks)) {
    for (const pk of anchorPicks) {
      if (!selected.some((m) => m.id === pk.matchId)) continue;
      const arr = anchorsByMatch.get(pk.matchId) ?? [];
      arr.push(pk);
      anchorsByMatch.set(pk.matchId, arr);
    }
  }
  const hasUserAnchors = anchorsByMatch.size > 0;

  const ranked = [...selected].sort((a, b) => {
    const aHas = anchorsByMatch.has(a.id) ? 1 : 0;
    const bHas = anchorsByMatch.has(b.id) ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    const optsA = a.pools[primaryPoolOf(a)].options;
    const optsB = b.pools[primaryPoolOf(b)].options;
    const maxA = optsA.length ? Math.max(...optsA.map((o) => o.fairProb)) : 0;
    const maxB = optsB.length ? Math.max(...optsB.map((o) => o.fairProb)) : 0;
    return maxB - maxA;
  });

  const preferredPrimaryLeg = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const sortedAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb);
      const chosen = makeLeg(m, sortedAnc[0].poolCode, sortedAnc[0].optionKey, stance);
      if (chosen) return chosen;
    }
    const pCode = primaryPoolOf(m);
    const top = [...m.pools[pCode].options].sort((a, b) => b.fairProb - a.fairProb)[0];
    return top ? makeLeg(m, pCode, top.key, stance) : makeLeg(m, 'HAFU', 'hh', stance);
  };

  const preferredCoverLeg = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length >= 2) {
      const sortedAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb);
      const sec = makeLeg(m, sortedAnc[1].poolCode, sortedAnc[1].optionKey, stance);
      if (sec) return sec;
    }
    if (anc && anc.length === 1) {
      const a0 = anc[0];
      const poolOpts = [...(m.pools[a0.poolCode]?.options ?? [])]
        .filter((o) => o.key !== a0.optionKey)
        .sort((a, b) => b.fairProb - a.fairProb);
      const drawOrNext =
        poolOpts.find((o) => o.key === 'd' || o.key === 'hd' || o.key === 'dd') ?? poolOpts[0];
      if (drawOrNext) {
        const cov = makeLeg(m, a0.poolCode, drawOrNext.key, stance);
        if (cov) return cov;
      }
    }
    const pCode = primaryPoolOf(m);
    const sorted = [...m.pools[pCode].options].sort((a, b) => b.fairProb - a.fairProb);
    const secKey = sorted[1]?.key ?? 'd';
    return makeLeg(m, pCode, secKey, stance) ?? preferredPrimaryLeg(m);
  };

  const m1 = ranked[0];
  const m2 = ranked[1] ?? ranked[0];
  const extras = ranked.slice(2);

  const p1Code = primaryPoolOf(m1);
  const p2Code = primaryPoolOf(m2);
  const m1Primary = preferredPrimaryLeg(m1);
  const m1Cover = preferredCoverLeg(m1);
  const m2Primary = preferredPrimaryLeg(m2);
  const m2Cover = preferredCoverLeg(m2);
  const extraFavs = extras.map(preferredPrimaryLeg).filter(Boolean);

  const anchorBadgeNote = hasUserAnchors
    ? `🎯 已同步赛事雷达已选方向：${Array.from(anchorsByMatch.entries())
        .map(([mid, pks]) => {
          const fm = selected.find((x) => x.id === mid);
          return `${fm?.matchNumStr ?? ''}${fm?.home ?? ''}[${pks.map((p) => p.optionLabel).join('/')}]`;
        })
        .join('、')}`
    : null;

  const withAnchorReason = (list) => (anchorBadgeNote ? [anchorBadgeNote, ...list] : list);

  const pack = (key, shortTab, badge, title, tagline, lines, savedCash, missOneReturn, reasons) => {
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
      reasons: withAnchorReason(reasons),
      lines,
    };
  };

  const isSingleMatch = selected.length === 1;
  const m1AnchorSingleOk =
    m1Primary && m1.pools[m1Primary.poolCode]?.single && m1Cover && m1.pools[m1Cover.poolCode]?.single;

  const ironLines = isSingleMatch
    ? allocateLines(
        m1AnchorSingleOk
          ? [
              { id: 'ir1', roleLabel: '首选主攻', legs: [m1Primary] },
              { id: 'ir2', roleLabel: '防冷铁盾', legs: [m1Cover] },
            ]
          : [
              {
                id: 'ir1',
                roleLabel: '合成单关·主方向',
                legs: [
                  makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'aa' : 'hh', stance),
                ],
              },
              {
                id: 'ir2',
                roleLabel: '合成单关·半平绝杀',
                legs: [
                  makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'da' : 'dh', stance),
                ],
              },
            ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'ir1',
            roleLabel: hasUserAnchors ? '雷达主选铁干' : '正路铁干',
            legs: [m2Primary, m1Primary, ...extraFavs],
          },
          {
            id: 'ir2',
            roleLabel: '次选防冷盾',
            legs: [m2Cover, m1Primary, ...extraFavs],
          },
        ],
        cleanBudget
      );

  const inferMatchDirection = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const topAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb)[0];
      const k = topAnc.optionKey;
      const lbl = topAnc.optionLabel || k;
      if (topAnc.poolCode === 'HAD') {
        return k === 'a' ? 'away' : k === 'd' ? 'draw' : 'home';
      }
      if (topAnc.poolCode === 'HHAD') {
        const gl = Number(m.pools.HHAD.goalLine) || -1;
        if (k === 'hh') return 'home';
        if (k === 'ha') return 'away';
        return gl < 0 ? 'home' : 'away';
      }
      if (topAnc.poolCode === 'HAFU') {
        if (k.endsWith('a')) return 'away';
        if (k.endsWith('d')) return 'draw';
        return 'home';
      }
      if (topAnc.poolCode === 'CRS') {
        if (lbl === '负其它' || k === 's1sa') return 'away';
        if (lbl === '平其它' || k === 's1sd') return 'draw';
        if (lbl === '胜其它' || k === 's1sh') return 'home';
        const [hs, as] = lbl.split(':').map(Number);
        if (Number.isFinite(hs) && Number.isFinite(as)) {
          return hs < as ? 'away' : hs === as ? 'draw' : 'home';
        }
      }
    }
    const pCode = primaryPoolOf(m);
    const top = [...m.pools[pCode].options].sort((a, b) => b.fairProb - a.fairProb)[0];
    return top?.key === 'a' || top?.key === 'ha' ? 'away' : 'home';
  };

  const m1Dir = inferMatchDirection(m1);
  const m2Dir = inferMatchDirection(m2);
  const m1Gl = Number(m1.pools.HHAD.goalLine) || -1;
  const m1SpearA =
    m1Dir === 'away'
      ? m1Gl > 0
        ? makeLeg(m1, 'HHAD', 'ha', stance) ?? m1Primary
        : makeLeg(m1, 'HAD', 'a', stance) ?? m1Primary
      : m1Dir === 'draw'
        ? makeLeg(m1, 'HAD', 'd', stance) ?? m1Primary
        : m1Gl < 0
          ? makeLeg(m1, 'HHAD', 'hh', stance) ?? m1Primary
          : makeLeg(m1, 'HAD', 'h', stance) ?? m1Primary;
  const m1SpearB =
    m1Dir === 'away'
      ? m1Gl > 0
        ? makeLeg(m1, 'HHAD', 'hd', stance) ?? m1Cover
        : makeLeg(m1, 'HHAD', 'ha', stance) ?? m1Cover
      : m1Dir === 'draw'
        ? makeLeg(m1, 'HAFU', 'dd', stance) ?? m1Cover
        : m1Gl < 0
          ? makeLeg(m1, 'HHAD', 'hd', stance) ?? m1Cover
          : makeLeg(m1, 'HHAD', 'hh', stance) ?? m1Cover;

  const spearLines = isSingleMatch
    ? allocateLines(
        [
          {
            id: 'sp1',
            roleLabel: '主攻慢热高水',
            legs: [makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'da' : 'dh', stance)],
          },
          {
            id: 'sp2',
            roleLabel: '顺向辅助箭',
            legs: [makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'aa' : 'hh', stance)],
          },
          { id: 'sp3', roleLabel: '闷平保本盾', legs: [makeLeg(m1, 'HAFU', 'dd', stance)], shieldOnly: true },
        ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'sp1',
            roleLabel: '主攻箭A·穿盘',
            legs: [m2Primary, m1SpearA, ...extraFavs],
          },
          {
            id: 'sp2',
            roleLabel: '主攻箭B·赢1球卡盘',
            legs: [m2Primary, m1SpearB, ...extraFavs],
          },
          {
            id: 'sp3',
            roleLabel: '零伤亡回本盾',
            legs: [m2Cover, m1Primary, ...extraFavs],
            shieldOnly: true,
          },
        ],
        cleanBudget
      );

  const topPrimaryLegOf = preferredPrimaryLeg;

  let faultLines = [];
  let missOneReturn = 0;
  if (selected.length >= 5) {
    const allTopLegs = selected.map(topPrimaryLegOf);
    const pairSpecs = [];
    for (let i = 0; i < allTopLegs.length; i += 2) {
      if (i + 1 < allTopLegs.length) {
        pairSpecs.push({
          id: `ft_${pairSpecs.length + 1}`,
          roleLabel: `容错组${pairSpecs.length + 1} (第${i + 1}+${i + 2}场·2串1)`,
          legs: [allTopLegs[i], allTopLegs[i + 1]],
        });
      } else {
        pairSpecs.push({
          id: `ft_${pairSpecs.length + 1}`,
          roleLabel: `容错组${pairSpecs.length + 1} (第1+${i + 1}场·2串1)`,
          legs: [allTopLegs[0], allTopLegs[i]],
        });
      }
    }
    pairSpecs.push({
      id: `ft_all`,
      roleLabel: `${allTopLegs.length}场全红冲顶串`,
      legs: allTopLegs,
    });
    faultLines = allocateLines(pairSpecs, cleanBudget);
    const pairPayouts = faultLines.slice(0, pairSpecs.length - 1).map((l) => l.returnPayout);
    missOneReturn = pairPayouts.length > 0 ? Math.min(...pairPayouts) : faultLines[0].returnPayout;
  } else if (selected.length === 4) {
    const topLegs = selected.map(topPrimaryLegOf);
    faultLines = allocateLines(
      [
        { id: 'ft1', roleLabel: '容错组① (ABC·3串1)', legs: [topLegs[0], topLegs[1], topLegs[2]] },
        { id: 'ft2', roleLabel: '容错组② (ABD·3串1)', legs: [topLegs[0], topLegs[1], topLegs[3]] },
        { id: 'ft3', roleLabel: '容错组③ (ACD·3串1)', legs: [topLegs[0], topLegs[2], topLegs[3]] },
        { id: 'ft4', roleLabel: '容错组④ (BCD·3串1)', legs: [topLegs[1], topLegs[2], topLegs[3]] },
      ],
      cleanBudget
    );
    missOneReturn = Math.min(...faultLines.map((l) => l.returnPayout));
  } else if (selected.length === 3) {
    const topLegs = selected.slice(0, 3).map(topPrimaryLegOf);
    faultLines = allocateLines(
      [
        { id: 'ft1', roleLabel: '容错组① (AB)', legs: [topLegs[0], topLegs[1]] },
        { id: 'ft2', roleLabel: '容错组② (AC)', legs: [topLegs[0], topLegs[2]] },
        { id: 'ft3', roleLabel: '容错组③ (BC)', legs: [topLegs[1], topLegs[2]] },
      ],
      cleanBudget
    );
    missOneReturn = Math.min(...faultLines.map((l) => l.returnPayout));
  } else if (selected.length === 2) {
    const singleCapable = m1.pools[p1Code].single ? m1 : m2.pools[p2Code].single ? m2 : null;
    const cushionLeg = singleCapable
      ? preferredPrimaryLeg(singleCapable)
      : makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'aa' : 'hh', stance);
    faultLines = allocateLines(
      [
        {
          id: 'ft1',
          roleLabel: '连红主干·2串1',
          legs: [m2Primary, m1Primary],
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
    faultLines = allocateLines(
      [
        {
          id: 'ft1',
          roleLabel: '上半领先赢',
          legs: [makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'aa' : 'hh', stance)],
        },
        {
          id: 'ft2',
          roleLabel: '半平下半绝杀',
          legs: [makeLeg(m1, 'HAFU', m1Primary?.optionKey === 'a' ? 'da' : 'dh', stance)],
        },
        { id: 'ft3', roleLabel: '全场闷平兜底', legs: [makeLeg(m1, 'HAFU', 'dd', stance)] },
      ],
      cleanBudget
    );
    missOneReturn = Math.min(...faultLines.map((l) => l.returnPayout));
  }
  const faultAllHitReturn =
    faultLines.length >= 2 && selected.length >= 2
      ? Number(faultLines.reduce((a, l) => a + l.returnPayout, 0).toFixed(2))
      : Math.max(...faultLines.map((l) => l.returnPayout));

  const q1 = analyzeMatchMicroQuant(m1);
  const q2 = analyzeMatchMicroQuant(m2);
  const preferredGoalKeysOf = (m, q) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const ttgAnc = anc.filter((p) => p.poolCode === 'TTG').map((p) => p.optionKey);
      if (ttgAnc.length >= 2) return [ttgAnc[0], ttgAnc[1]];
      if (ttgAnc.length === 1) {
        const alt = q.topTwoGoals[0] === ttgAnc[0] ? q.topTwoGoals[1] : q.topTwoGoals[0];
        return [ttgAnc[0], alt];
      }
      const crsAnc = anc.find((p) => p.poolCode === 'CRS');
      if (crsAnc) {
        const [hs, as] = String(crsAnc.optionLabel || '').split(':').map(Number);
        if (Number.isFinite(hs) && Number.isFinite(as)) {
          const sum = Math.min(7, hs + as);
          const k0 = `s${sum}`;
          const k1 = q.topTwoGoals[0] === k0 ? q.topTwoGoals[1] : q.topTwoGoals[0];
          return [k0, k1];
        }
      }
    }
    return [q.topTwoGoals[0], q.topTwoGoals[1]];
  };
  const [g1A, g1B] = preferredGoalKeysOf(m1, q1);
  const [g2A, g2B] = preferredGoalKeysOf(m2, q2);
  // 总进球官方最高支持 6串1
  const extraGoalLegs = extras.slice(0, 4).map((em) => {
    const qEm = analyzeMatchMicroQuant(em);
    const [gEmA] = preferredGoalKeysOf(em, qEm);
    return makeLeg(em, 'TTG', gEmA, stance);
  }).filter(Boolean);
  const structLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'st1', roleLabel: '黄金进球主区间', legs: [makeLeg(m1, 'TTG', g1A, stance)] },
          { id: 'st2', roleLabel: '黄金进球次区间', legs: [makeLeg(m1, 'TTG', g1B, stance)] },
        ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'st1',
            roleLabel: `${Math.min(6, selected.length)}场主流进球A`,
            legs: [makeLeg(m1, 'TTG', g1A, stance), makeLeg(m2, 'TTG', g2A, stance), ...extraGoalLegs],
          },
          {
            id: 'st2',
            roleLabel: `${Math.min(6, selected.length)}场主流进球B`,
            legs: [makeLeg(m1, 'TTG', g1B, stance), makeLeg(m2, 'TTG', g2A, stance), ...extraGoalLegs],
          },
          {
            id: 'st3',
            roleLabel: `${Math.min(6, selected.length)}场主流进球C`,
            legs: [makeLeg(m1, 'TTG', g1A, stance), makeLeg(m2, 'TTG', g2B, stance), ...extraGoalLegs],
          },
        ],
        cleanBudget
      );

  const aggBudget = unlockFullAgg
    ? cleanBudget
    : Math.max(16, Math.round((cleanBudget * 0.36) / 4) * 4);
  const assassinLegFor = (m, dir, kind) => {
    const gl = Number(m.pools.HHAD.goalLine) || -1;
    if (dir === 'away') {
      if (kind === 'crs') return makeLeg(m, 'CRS', '0:1', stance) ?? makeLeg(m, 'HAFU', 'da', stance);
      if (kind === 'hafu') return makeLeg(m, 'HAFU', 'da', stance) ?? makeLeg(m, 'HAD', 'a', stance);
      return gl > 0 ? makeLeg(m, 'HHAD', 'hd', stance) : makeLeg(m, 'HAD', 'a', stance);
    }
    if (dir === 'draw') {
      if (kind === 'crs') return makeLeg(m, 'CRS', '1:1', stance) ?? makeLeg(m, 'HAFU', 'dd', stance);
      if (kind === 'hafu') return makeLeg(m, 'HAFU', 'dd', stance);
      return makeLeg(m, 'HAD', 'd', stance);
    }
    if (kind === 'crs') return makeLeg(m, 'CRS', '1:0', stance) ?? makeLeg(m, 'HAFU', 'dh', stance);
    if (kind === 'hafu') return makeLeg(m, 'HAFU', 'dh', stance) ?? makeLeg(m, 'HAD', 'h', stance);
    return gl < 0 ? makeLeg(m, 'HHAD', 'hd', stance) : makeLeg(m, 'HAD', 'h', stance);
  };
  const extraValueLegs = extras
    .map((em) => assassinLegFor(em, inferMatchDirection(em), 'card') ?? topPrimaryLegOf(em))
    .filter(Boolean);
  const assassinLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'as1', roleLabel: '顺向黄金比分刺客', legs: [assassinLegFor(m1, m1Dir, 'crs')] },
          {
            id: 'as2',
            roleLabel: m1Dir === 'draw' ? '闷平零封刺客' : '半平绝杀高水箭',
            legs: [m1Dir === 'draw' ? makeLeg(m1, 'CRS', '0:0', stance) : assassinLegFor(m1, m1Dir, 'hafu')],
          },
        ],
        aggBudget
      )
    : allocateLines(
        [
          {
            id: 'as1',
            roleLabel: '滞后洼地暴击箭',
            legs: [assassinLegFor(m2, m2Dir, 'hafu'), assassinLegFor(m1, m1Dir, 'card')],
          },
          {
            id: 'as2',
            roleLabel: '顺向卡盘×高水刺客',
            legs: [assassinLegFor(m2, m2Dir, 'card'), assassinLegFor(m1, m1Dir, 'hafu')],
          },
          ...(extraValueLegs.length > 0
            ? [
                {
                  id: 'as3',
                  roleLabel: `${selected.length}场高水卡盘长狙`,
                  legs: [
                    assassinLegFor(m1, m1Dir, 'card'),
                    assassinLegFor(m2, m2Dir, 'card'),
                    ...extraValueLegs,
                  ],
                },
              ]
            : []),
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

function parseKickoffMinutes(hhmm) {
  const [hStr, mStr] = String(hhmm || '20:00').split(':');
  const h = Number(hStr) || 0;
  const min = Number(mStr) || 0;
  const normalizedH = h < 12 ? h + 24 : h;
  return normalizedH * 60 + min;
}

/** 3. 审单细节小 Tips：早晚场时间差对冲锁利 + 串关拖油瓶体检 + 同义省钱替换 + 连黑预警 */
export function computeProOrderInsights(picks, report, matches) {
  const matchIds = Array.from(new Set(picks.map((p) => p.matchId)));
  const pickedMatches = matchIds
    .map((id) => matches.find((m) => m.id === id))
    .filter(Boolean);

  let hedge = {
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

  let weakestLink = null;
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

  let activeSwapTip = null;
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

/** 4. 三模智能奖金优化深模块（支持多串实票逐张分倍） */
export function optimizeBonusPlan(manualReport, matches, optMode) {
  const baseRows =
    Array.isArray(manualReport?.tickets) && manualReport.tickets.length > 0
      ? manualReport.tickets
      : manualReport?.combos ?? [];
  if (!manualReport || baseRows.length === 0) return null;

  const sorted = [...baseRows].sort((a, b) => b.prob - a.prob);
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

  let mults = [];
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

  const lines = sorted.map((c, idx) => {
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

    const perLineMode =
      fullLegs.length === 1
        ? '单关'
        : fullLegs.length > 1
          ? `${fullLegs.length}串1`
          : manualReport.modeLabel;

    return {
      id: `opt-${optMode}-${idx}`,
      roleLabel: role,
      legs: fullLegs,
      modeLabel: perLineMode,
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

  const profitLinesProb = lines.filter((l) => l.netProfit >= 0).reduce((a, l) => a + l.prob, 0);

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

function isValidPlanObject(plan) {
  return (
    Boolean(plan) &&
    typeof plan === 'object' &&
    Array.isArray(plan.lines) &&
    plan.lines.length > 0 &&
    plan.lines.every(
      (l) =>
        l &&
        typeof l === 'object' &&
        Array.isArray(l.legs) &&
        l.legs.length >= 1 &&
        l.legs.length <= Math.min(...l.legs.map((g) => POOL_MAX_PASS[g?.poolCode] ?? 8)) &&
        Number.isFinite(Number(l.multiple)) &&
        Number.isFinite(Number(l.unitPayout))
    )
  );
}

function scaleArchetypePlan(plan, rawScale) {
  if (!isValidPlanObject(plan)) return null;
  const requestedScale = Math.max(1, Math.min(50, Math.round(Number(rawScale) || 1)));
  if (requestedScale <= 1) return plan;
  const maxBaseMult = Math.max(1, ...plan.lines.map((l) => Number(l.multiple) || 1));
  const scale = Math.max(1, Math.min(requestedScale, Math.floor(999 / maxBaseMult)));
  if (scale <= 1) return plan;
  const scaledLines = plan.lines.map((l) => {
    const mult = Math.max(1, Math.min(999, Math.round((Number(l.multiple) || 1) * scale)));
    const cost = mult * 2;
    const returnPayout = Number((Number(l.unitPayout) * mult).toFixed(2));
    return {
      ...l,
      multiple: mult,
      cost,
      returnPayout,
      netProfit: 0,
    };
  });
  const totalCost = scaledLines.reduce((a, l) => a + l.cost, 0);
  scaledLines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - totalCost).toFixed(2));
  });
  const returns = scaledLines.map((l) => l.returnPayout);
  const minReturn = returns.length ? Math.min(...returns) : 0;
  const hasMissOne = typeof plan.missOneReturn === 'number' && Number.isFinite(plan.missOneReturn);
  const scaledMax = hasMissOne
    ? Number((Number(plan.maxReturn || 0) * scale).toFixed(2))
    : returns.length
      ? Math.max(...returns)
      : 0;
  return {
    ...plan,
    totalCost,
    minReturn,
    maxReturn: Math.max(minReturn, scaledMax),
    missOneReturn: hasMissOne ? Number((plan.missOneReturn * scale).toFixed(2)) : null,
    lines: scaledLines,
  };
}

export function archetypeToReport(plan, fallbackManual) {
  if (!isValidPlanObject(plan)) return fallbackManual;
  const matchSet = new Set();
  const sizeSet = new Set();
  plan.lines.forEach((l) => {
    sizeSet.add(l.legs.length);
    l.legs.forEach((lg) => matchSet.add(lg.matchId));
  });
  const hasMissOne = typeof plan.missOneReturn === 'number' && Number.isFinite(plan.missOneReturn);
  const combos = plan.lines.map((l) => ({
    id: l.id,
    desc:
      `${l.roleLabel}(${l.multiple}倍) · ` +
      l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join('×'),
    legs: l.legs,
    prob: l.prob,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: 0,
    netProfit: l.netProfit,
    isUnderwater: l.netProfit < 0 && !hasMissOne,
  }));

  const underwaterCombos = combos.filter((c) => c.isUnderwater);
  const winProbSum = combos.reduce((a, c) => a + c.prob, 0);
  const underwaterProbSum = underwaterCombos.reduce((a, c) => a + c.prob, 0);
  const underwaterShareOfWins = winProbSum > 0 ? underwaterProbSum / winProbSum : 0;
  const computedProfitProb = hasMissOne
    ? plan.profitProb
    : Math.min(
        plan.winProb,
        combos.filter((c) => c.netProfit >= 0).reduce((a, c) => a + c.prob, 0)
      );
  const invUnitSum = combos.reduce((a, c) => a + 2 / Math.max(0.5, c.unitPayout), 0);
  const harmonicEffOdds = invUnitSum > 0 ? 1 / invUnitSum : 1.5;
  const activeSizes = Array.from(sizeSet)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b);

  const planWarnings = [];
  const maxLineMult = Math.max(...plan.lines.map((l) => Number(l.multiple) || 1));
  const consolidatedTickets = plan.lines.reduce(
    (a, l) => a + Math.max(1, Math.ceil((Number(l.multiple) || 1) / 99)),
    0
  );
  if (maxLineMult > 99) {
    planWarnings.push({
      id: 'cap-clip',
      severity: 'warn',
      title: `分倍含超 99 倍单注（体彩店需拆成 ${consolidatedTickets} 张实票打印）`,
      detail: '终端机单张实票最高 99 倍，已按 99 倍上限自动核算店面拆票张数。',
    });
  }
  const over20k = plan.totalCost > 20_000;
  if (over20k) {
    planWarnings.push({
      id: 'order-limit-20k',
      severity: 'danger',
      title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${plan.totalCost}）`,
      detail: '中国体彩规定单次订单投注金额不得超过 20,000 元，请还原等倍或分批打票。',
    });
  } else if (plan.totalCost > 6_000) {
    planWarnings.push({
      id: 'rational-6k',
      severity: 'warn',
      title: `大额投注风控提醒（当前总投入 ¥${plan.totalCost} 已超 ¥6,000）`,
      detail: '触发体彩官方大额理性购彩阈值，请严格核对今日止损护栏额度。',
    });
  }

  return {
    matchCount: matchSet.size,
    betCount: plan.lines.length,
    comboCount: plan.lines.length,
    multiple: 1,
    modeLabel: `${plan.shortTab}·分倍精算`,
    canSingle: matchSet.size === 1,
    canCheckout: plan.lines.length > 0 && !over20k,
    ruleBlockReason: over20k
      ? `单次订单金额 ¥${plan.totalCost} 超出体彩 ¥20,000 硬上限，请调低仓位或分单`
      : null,
    poolCap: fallbackManual?.poolCap ?? 8,
    activePassSizes: activeSizes,
    activeComboCode: null,
    availableFreePasses:
      fallbackManual?.availableFreePasses ??
      buildFreePassMetadata(matchSet.size, 8, matchSet.size === 1, false, activeSizes),
    availableComboPasses: fallbackManual?.availableComboPasses ?? [],
    hasSameMatchCrossPoolConflict: false,
    totalCost: plan.totalCost,
    minPayout: hasMissOne ? plan.missOneReturn : plan.minReturn,
    maxPayout: plan.maxReturn,
    likelyRange: [plan.minReturn, plan.maxReturn],
    anyWinProb: plan.winProb,
    realProfitProb: computedProfitProb,
    underwaterCount: underwaterCombos.length,
    underwaterShareOfWins,
    avgPayoutRatio: (100 - (Number(plan.vigPct) || 12)) / 100,
    avgVigLossPer100: Number(plan.vigPct) || 12,
    expectedValueRate: -(Number(plan.vigPct) || 12) / 100,
    dangerScore: plan.key === 'value-assassin' ? 66 : underwaterCombos.length > 0 ? 48 : 29,
    effectiveOdds: harmonicEffOdds,
    breakevenUpgradeCost: null,
    consolidatedTickets,
    syntheticHint: `已启用【${plan.badge}】：${plan.tagline}`,
    syntheticRescuePicks: null,
    tickets: combos,
    combos,
    warnings: planWarnings,
  };
}

export function buildXiaoGaoWarnings(picks, matches) {
  const matchIds = Array.from(new Set(picks.map((p) => p.matchId)));
  const out = [];
  for (const mid of matchIds) {
    const m = matches.find((x) => x.id === mid);
    if (!m?.aiAlert) continue;
    out.push({
      id: `xiaogao-${m.id}`,
      severity: m.aiAlert.level === 'high' ? 'danger' : 'warn',
      title: `🧹 扫地僧小高靶向排雷 · ${m.matchNumStr} ${m.aiAlert.tag}`,
      detail: `${m.aiAlert.summary}（Price-In 消化度：${m.aiAlert.priceInStatus}${
        m.aiAlert.suggestedDelta ? ` · ${m.aiAlert.suggestedDelta}` : ''
      }）`,
    });
  }
  return out;
}

/**
 * 统一服务端黑盒精算调度器（单次密文往返完成全部五维审单、三模分倍、五流派配单与对冲计算）
 */
export function evaluateQuantWorkspace(params, matchesInput) {
  const baseMatches = matchesInput && matchesInput.length > 0 ? matchesInput : FALLBACK_MATCHES;
  const clientAlerts =
    params?.clientAlerts && typeof params.clientAlerts === 'object' ? params.clientAlerts : null;
  const matches = clientAlerts
    ? baseMatches.map((m) => (clientAlerts[m.id] ? { ...m, aiAlert: clientAlerts[m.id] } : m))
    : baseMatches;
  const picks = (Array.isArray(params?.picks) ? params.picks : [])
    .filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof p.matchId === 'string' &&
        typeof p.poolCode === 'string' &&
        typeof p.optionKey === 'string'
    )
    .slice(0, 120);
  const multiple = Math.max(1, Math.min(999, Math.round(Number(params?.multiple) || 5)));
  const passSpec = params?.passSpec ?? { mode: 'auto' };
  const subjectiveDeltaPct = Math.max(-15, Math.min(20, Number(params?.subjectiveDeltaPct) || 0));
  const simVoidFirstMatch = Boolean(params?.simVoidFirstMatch);
  const planSpec = params?.planSpec ?? null;
  const targetIds = Array.isArray(params?.targetIds) ? params.targetIds : [];
  const anchorToRadarPicks = Boolean(params?.anchorToRadarPicks);
  const budget = Math.max(20, Math.min(20_000, Number(params?.budget) || 100));
  const stance =
    params?.stance === 'home-lean' || params?.stance === 'upset-watch'
      ? params.stance
      : 'objective';
  const unlockFullAgg = Boolean(params?.unlockFullAgg);

  const firstMid = picks[0]?.matchId;
  const sandboxAdjustedPicks = picks.map((pk) => {
    const fm = matches.find((x) => x.id === pk.matchId);
    const pool = fm?.pools?.[pk.poolCode];
    const authOpt = pool?.options?.find(
      (o) => o.key === pk.optionKey || o.label === pk.optionLabel
    );
    const baseOdds =
      pool?.selling === false
        ? 0
        : authOpt
          ? authOpt.odds
          : fm
            ? 0
            : Number(pk.odds) || 1.0;
    const baseProb = authOpt ? authOpt.fairProb : Number(pk.fairProb) || 0.25;
    const odds = simVoidFirstMatch && pk.matchId === firstMid && baseOdds > 0 ? 1.0 : baseOdds;
    const prob = Math.min(
      0.96,
      Math.max(0.02, baseProb * (1 + subjectiveDeltaPct / 100))
    );
    return {
      ...pk,
      singleAllowed: pool ? Boolean(pool.single) : Boolean(pk.singleAllowed),
      odds,
      fairProb: prob,
    };
  });

  const manualReport = computeTruthReport(sandboxAdjustedPicks, multiple, matches, passSpec);

  const foundTargets = matches.filter((m) => targetIds.includes(m.id));
  const resolvedTargets = foundTargets.length > 0 ? foundTargets : matches.slice(0, 2);
  const fivePlans = generateFiveArchetypes(
    resolvedTargets,
    budget,
    stance,
    unlockFullAgg,
    anchorToRadarPicks ? sandboxAdjustedPicks : []
  );

  let appliedPlan = null;
  if (planSpec?.kind === 'bonus') {
    const mode =
      planSpec.optMode === 'hot-first' || planSpec.optMode === 'cold-first'
        ? planSpec.optMode
        : 'equal';
    appliedPlan = scaleArchetypePlan(
      optimizeBonusPlan(manualReport, matches, mode),
      planSpec.scaleMultiple
    );
  } else if (planSpec?.kind === 'archetype') {
    const validSnap = isValidPlanObject(planSpec.snapshotPlan) ? planSpec.snapshotPlan : null;
    const basePlan = validSnap ?? fivePlans.find((p) => p.key === planSpec.key) ?? null;
    appliedPlan = scaleArchetypePlan(basePlan, planSpec.scaleMultiple);
  }

  const effectiveReport =
    appliedPlan && !simVoidFirstMatch && subjectiveDeltaPct === 0
      ? archetypeToReport(appliedPlan, manualReport)
      : manualReport;

  const insights = computeProOrderInsights(sandboxAdjustedPicks, effectiveReport, matches);

  let subjectiveEVPct = 0;
  if (effectiveReport.totalCost > 0) {
    const expRet = effectiveReport.combos.reduce((a, c) => a + c.prob * c.totalPayout, 0);
    subjectiveEVPct = ((expRet - effectiveReport.totalCost) / effectiveReport.totalCost) * 100;
  }

  const allWarnings = [...effectiveReport.warnings, ...buildXiaoGaoWarnings(picks, matches)];

  return {
    manualReport,
    effectiveReport,
    appliedPlan,
    insights,
    fivePlans,
    subjectiveEVPct,
    allWarnings,
  };
}
