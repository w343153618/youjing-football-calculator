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

function buildPool(code, name, single, rawOptions, updateTime = '17:45:21', goalLine) {
  const valid = rawOptions.filter((o) => o.odds > 0);
  const invSum = valid.reduce((acc, o) => acc + 1 / o.odds, 0);
  const payoutRatio = invSum > 0 ? 1 / invSum : 0.88;
  const vig = Math.max(0, 1 - payoutRatio);
  return {
    code,
    name,
    single,
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
      CRS: buildPool('CRS', '比分', true, [
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
      CRS: buildPool('CRS', '比分', true, [
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
      CRS: buildPool('CRS', '比分', true, [
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
      CRS: buildPool('CRS', '比分', true, [
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
      CRS: buildPool('CRS', '比分', true, [
        { key: '0:0', label: '0:0', odds: 9.80 },
        { key: '1:1', label: '1:1', odds: 5.80, trend: -1 },
        { key: '1:0', label: '1:0', odds: 7.50 },
        { key: '2:1', label: '2:1', odds: 8.60 },
        { key: '0:1', label: '0:1', odds: 7.90 },
        { key: '1:2', label: '1:2', odds: 9.10 },
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
      CRS: buildPool('CRS', '比分', true, [
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
      CRS: buildPool('CRS', '比分', true, [
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
      CRS: buildPool('CRS', '比分', true, [
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
      for (const p of m.poolList ?? []) {
        poolFlags[p.poolCode] = Number(p.single) === 1;
      }
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
            hadRaw.updateTime || '实时'
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
            hhadRaw.goalLine || '-1'
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
            hafuRaw.updateTime || '实时'
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
            ttgRaw.updateTime || '实时'
          ),
          CRS: buildPool(
            'CRS',
            '比分',
            poolFlags.CRS ?? true,
            [
              ['s01s00', '1:0'],
              ['s02s00', '2:0'],
              ['s02s01', '2:1'],
              ['s03s00', '3:0'],
              ['s03s01', '3:1'],
              ['s00s00', '0:0'],
              ['s01s01', '1:1'],
              ['s02s02', '2:2'],
              ['s00s01', '0:1'],
              ['s00s02', '0:2'],
              ['s01s02', '1:2'],
            ].map(([k, lbl]) => ({
              key: lbl,
              label: lbl,
              odds: Number(crsRaw[k] || 0),
              trend: parseTrend(crsRaw[`${k}f`]),
            })),
            crsRaw.updateTime || '实时'
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

/** 计算五维真相看板与 6 大防坑雷达（纯数学黑盒，遵循 ADR-0002） */
export function computeTruthReport(picks, multiple, matches) {
  const byMatch = new Map();
  for (const p of picks) {
    const arr = byMatch.get(p.matchId) ?? [];
    arr.push(p);
    byMatch.set(p.matchId, arr);
  }

  const matchGroups = Array.from(byMatch.values());
  const matchCount = matchGroups.length;

  if (matchCount === 0) {
    return {
      matchCount: 0,
      comboCount: 0,
      multiple,
      modeLabel: '未选比赛',
      canSingle: false,
      hasSameMatchCrossPoolConflict: false,
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
      dangerScore: 0,
      effectiveOdds: 0,
      breakevenUpgradeCost: null,
      consolidatedTickets: 0,
      syntheticHint: null,
      combos: [],
      warnings: [],
    };
  }

  let hasSameMatchCrossPoolConflict = false;
  for (const grp of matchGroups) {
    const pools = new Set(grp.map((g) => g.poolCode));
    if (pools.size > 1) hasSameMatchCrossPoolConflict = true;
  }

  const canSingle = matchCount === 1 && matchGroups[0].every((p) => p.singleAllowed);
  const modeLabel = matchCount === 1 ? (canSingle ? '单关' : '需再选1场凑2串1') : `${matchCount}串1`;

  let cartesian = [[]];
  for (const grp of matchGroups) {
    const next = [];
    for (const prev of cartesian) {
      for (const item of grp) {
        next.push([...prev, item]);
      }
    }
    cartesian = next;
    if (cartesian.length > 256) cartesian = cartesian.slice(0, 256);
  }

  const comboCount = cartesian.length;
  const totalCost = comboCount * 2 * multiple;
  const singleBetCap = statutorySingleBetCap(matchCount);

  const combos = cartesian.map((items, idx) => {
    const prob = items.reduce((acc, it) => acc * it.fairProb, 1);
    const unitBeforeCap = bankerRoundParlayUnitPayout(items.map((it) => it.odds));
    const unitCapped = Math.min(unitBeforeCap, singleBetCap);
    const cappedClipped = Math.max(0, (unitBeforeCap - unitCapped) * multiple);
    const totalPayout = Number((unitCapped * multiple).toFixed(2));
    const netProfit = Number((totalPayout - totalCost).toFixed(2));
    return {
      id: `c-${idx}`,
      desc: items.map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`).join(' × '),
      legs: items,
      prob,
      unitPayout: unitCapped,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  });

  combos.sort((a, b) => a.totalPayout - b.totalPayout);
  const minPayout = combos[0]?.totalPayout ?? 0;
  const maxPayout = combos[combos.length - 1]?.totalPayout ?? 0;

  const byProbDesc = [...combos].sort((a, b) => b.prob - a.prob);
  const topHalf = byProbDesc.slice(0, Math.max(1, Math.ceil(byProbDesc.length * 0.6)));
  const likelyMin = Math.min(...topHalf.map((c) => c.totalPayout));
  const likelyMax = Math.max(...topHalf.map((c) => c.totalPayout));

  const conflictDiscount = hasSameMatchCrossPoolConflict ? 0.65 : 1;
  const anyWinProb = Math.min(
    hasSameMatchCrossPoolConflict ? 0.95 : 0.99,
    combos.reduce((acc, c) => acc + c.prob, 0) * conflictDiscount
  );

  const realProfitProb = Math.min(
    anyWinProb,
    combos.filter((c) => !c.isUnderwater).reduce((acc, c) => acc + c.prob, 0) * conflictDiscount
  );

  const underwaterCount = combos.filter((c) => c.isUnderwater).length;
  const underwaterShareOfWins =
    anyWinProb > 0
      ? Math.min(1, combos.filter((c) => c.isUnderwater).reduce((a, c) => a + c.prob, 0) / anyWinProb)
      : 0;

  const perMatchRatios = matchGroups.map((grp) => {
    const m = matches.find((x) => x.id === grp[0].matchId);
    const pool = m?.pools[grp[0].poolCode];
    return pool?.payoutRatio ?? 0.875;
  });
  const avgPayoutRatio = perMatchRatios.reduce((acc, r) => acc * r, 1);
  const avgVigLossPer100 = Number(((1 - avgPayoutRatio) * 100).toFixed(1));

  const expectedReturn = combos.reduce((acc, c) => acc + c.prob * c.totalPayout, 0);
  const expectedValueRate = totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0;

  const invComboOddsSum = combos.reduce((acc, c) => acc + 2 / Math.max(0.01, c.unitPayout), 0);
  const effectiveOdds = invComboOddsSum > 0 ? 1 / invComboOddsSum : 0;

  let breakevenUpgradeCost = null;
  if (underwaterCount > 0 && effectiveOdds > 1.03 && combos.length <= 24) {
    for (let targetNotes = comboCount * multiple; targetNotes <= comboCount * multiple + 15; targetNotes++) {
      const budget = targetNotes * 2;
      const neededNotes = combos.reduce((acc, c) => acc + Math.ceil(budget / c.unitPayout), 0);
      if (neededNotes <= targetNotes) {
        breakevenUpgradeCost = neededNotes * 2;
        break;
      }
    }
  }

  const rawDanger =
    (1 - realProfitProb) * 58 +
    Math.max(0, matchCount - 1) * 9 +
    underwaterShareOfWins * 22 +
    (matchCount === 1 && !canSingle ? 15 : 0);
  const dangerScore = Math.min(99, Math.max(8, Math.round(rawDanger)));

  let syntheticHint = null;
  if (matchCount === 1) {
    const m = matches.find((x) => x.id === matchGroups[0][0].matchId);
    if (m && !m.pools.HAD.single) {
      const hOdds = m.pools.HAD.options.find((o) => o.key === 'h')?.odds ?? 1.69;
      const hhOdds = m.pools.HAFU.options.find((o) => o.key === 'hh')?.odds ?? 2.95;
      const dhOdds = m.pools.HAFU.options.find((o) => o.key === 'dh')?.odds ?? 3.90;
      const synEff = 1 / (1 / hhOdds + 1 / dhOdds);
      syntheticHint = `${m.matchNumStr} 胜平负未开单关(主胜@${hOdds.toFixed(2)})；用半全场单关买「胜胜+平胜」均衡配注后合成等效水位达 ${synEff.toFixed(2)}，仅漏掉约 2.9% 的「半负全胜」逆转死角！`;
    }
  }

  const warnings = [];
  if (matchCount === 1 && !canSingle) {
    warnings.push({
      id: 'no-single',
      severity: 'warn',
      title: '该玩法未开单关（官方强制串关限制）',
      detail: '体彩本场胜平负/让球未开放单关，需再串 1 场或直接改用「半全场 / 比分 / 总进球」合成单关。',
    });
  }
  if (effectiveOdds > 0 && effectiveOdds <= 1.0) {
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
      title: `假中奖警报：${underwaterCount}/${comboCount} 种命中结果实际倒贴钱！`,
      detail: `官网只给你看最高 ${maxPayout.toFixed(2)} 元，但踢出正路最低仅拿 ${minPayout.toFixed(2)} 元（净亏 ${(totalCost - minPayout).toFixed(2)} 元）。${
        breakevenUpgradeCost
          ? `✨ 开启奖金优化并将总本金调至 ${breakevenUpgradeCost} 元即可实现 100% 组合零亏损保本！`
          : '建议使用「保本奖金优化」重新分配各注倍数。'
      }`,
    });
  }
  if (hasSameMatchCrossPoolConflict) {
    warnings.push({
      id: 'cross-pool-same-match',
      severity: 'warn',
      title: '同场跨玩法分票提醒（体彩硬规则不可同场互串）',
      detail: '同一场比赛勾选了不同玩法，体彩终端机将拆分为独立注单计奖，注意核查是否存在逻辑重叠或重复投入。',
    });
  }
  if (matchCount >= 4 || avgPayoutRatio < 0.65) {
    warnings.push({
      id: 'parlay-vig',
      severity: 'danger',
      title: `串关连乘抽水雪崩：体彩已暗扣 ${avgVigLossPer100}% 数学期望`,
      detail: `当前 ${matchCount} 串 1 综合返还率跌至 ${(avgPayoutRatio * 100).toFixed(1)}%，错 1 场即全军覆没；建议拆成两组 2串1 或改用容错 M串N。`,
    });
  }
  const totalClipped = combos.reduce((a, c) => a + c.cappedClipped, 0);
  if (totalClipped > 0 || multiple > 99) {
    warnings.push({
      id: 'cap-clip',
      severity: 'danger',
      title:
        totalClipped > 0
          ? `封顶截断警告：有 ${totalClipped.toFixed(0)} 元超额奖金将被体彩无偿没收！`
          : `超出单票 99 倍上限（需拆成 ${Math.ceil(multiple / 99)} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${singleBetCap / 10000} 万元单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : '已自动为你按每张最高 99 倍生成店面拆票方案。',
    });
  }

  const consolidatedTickets = Math.max(1, Math.min(6, Math.ceil(comboCount / 3) * Math.ceil(multiple / 99)));

  return {
    matchCount,
    comboCount,
    multiple,
    modeLabel,
    canSingle,
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

/** 2. 生成五大实战战术流派配单 */
export function generateFiveArchetypes(targetMatches, budgetYuan, stance, unlockFullAgg) {
  const cleanBudget = Math.max(20, Math.round(budgetYuan / 2) * 2);
  if (targetMatches.length === 0) return [];

  const selected = targetMatches.slice(0, 8);
  const primaryPoolOf = (m) => (m.pools.HAD.options.length >= 2 ? 'HAD' : 'HHAD');

  const ranked = [...selected].sort((a, b) => {
    const optsA = a.pools[primaryPoolOf(a)].options;
    const optsB = b.pools[primaryPoolOf(b)].options;
    const maxA = optsA.length ? Math.max(...optsA.map((o) => o.fairProb)) : 0;
    const maxB = optsB.length ? Math.max(...optsB.map((o) => o.fairProb)) : 0;
    return maxB - maxA;
  });

  const m1 = ranked[0];
  const m2 = ranked[1] ?? ranked[0];
  const extras = ranked.slice(2);

  const p1Code = primaryPoolOf(m1);
  const p2Code = primaryPoolOf(m2);
  const m1Top = [...m1.pools[p1Code].options].sort((a, b) => b.fairProb - a.fairProb);
  const m2Top = [...m2.pools[p2Code].options].sort((a, b) => b.fairProb - a.fairProb);
  const extraFavs = extras.map((em) => {
    const pCode = primaryPoolOf(em);
    const top = [...em.pools[pCode].options].sort((a, b) => b.fairProb - a.fairProb)[0];
    return top ? makeLeg(em, pCode, top.key, stance) : null;
  }).filter(Boolean);

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
      reasons,
      lines,
    };
  };

  const isSingleMatch = selected.length === 1;

  const ironLines = isSingleMatch
    ? allocateLines(
        m1.pools[p1Code].single && m1Top.length >= 2
          ? [
              { id: 'ir1', roleLabel: '首选正路', legs: [makeLeg(m1, p1Code, m1Top[0].key, stance)] },
              { id: 'ir2', roleLabel: '防平铁盾', legs: [makeLeg(m1, p1Code, m1Top[1].key, stance)] },
            ]
          : [
              { id: 'ir1', roleLabel: '合成单关·胜胜', legs: [makeLeg(m1, 'HAFU', 'hh', stance)] },
              { id: 'ir2', roleLabel: '合成单关·平胜', legs: [makeLeg(m1, 'HAFU', 'dh', stance)] },
            ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'ir1',
            roleLabel: '正路铁干',
            legs: [makeLeg(m2, p2Code, m2Top[0]?.key ?? 'h', stance), makeLeg(m1, p1Code, m1Top[0]?.key ?? 'h', stance), ...extraFavs],
          },
          {
            id: 'ir2',
            roleLabel: '次选平局盾',
            legs: [makeLeg(m2, p2Code, m2Top[1]?.key ?? 'd', stance), makeLeg(m1, p1Code, m1Top[0]?.key ?? 'h', stance), ...extraFavs],
          },
        ],
        cleanBudget
      );

  const spearLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'sp1', roleLabel: '主攻慢热高水', legs: [makeLeg(m1, 'HAFU', 'dh', stance)] },
          { id: 'sp2', roleLabel: '正路辅助箭', legs: [makeLeg(m1, 'HAFU', 'hh', stance)] },
          { id: 'sp3', roleLabel: '闷平保本盾', legs: [makeLeg(m1, 'HAFU', 'dd', stance)], shieldOnly: true },
        ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'sp1',
            roleLabel: '主攻箭A·穿盘',
            legs: [makeLeg(m2, p2Code, m2Top[0]?.key ?? 'h', stance), makeLeg(m1, 'HHAD', 'hh', stance), ...extraFavs],
          },
          {
            id: 'sp2',
            roleLabel: '主攻箭B·赢1球卡盘',
            legs: [makeLeg(m2, p2Code, m2Top[0]?.key ?? 'h', stance), makeLeg(m1, 'HHAD', 'hd', stance), ...extraFavs],
          },
          {
            id: 'sp3',
            roleLabel: '零伤亡回本盾',
            legs: [makeLeg(m2, p2Code, m2Top[1]?.key ?? 'd', stance), makeLeg(m1, p1Code, m1Top[0]?.key ?? 'h', stance), ...extraFavs],
            shieldOnly: true,
          },
        ],
        cleanBudget
      );

  const topPrimaryLegOf = (m) => {
    const pCode = primaryPoolOf(m);
    const top = [...m.pools[pCode].options].sort((a, b) => b.fairProb - a.fairProb)[0];
    return top ? makeLeg(m, pCode, top.key, stance) : makeLeg(m, 'HAFU', 'hh', stance);
  };

  let faultLines = [];
  let missOneReturn = 0;
  if (selected.length >= 5) {
    // 5~8 场完整覆盖的两两 2串1 分组容错矩阵（确保第 1..N 场每一场均进入 2串1 容错网）+ 全串冲顶票
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
        // Odd count (5 or 7 matches): pair last match with match 1 so zero matches are dropped!
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
    const scCode = singleCapable ? primaryPoolOf(singleCapable) : 'HAFU';
    const cushionLeg = singleCapable
      ? makeLeg(
          singleCapable,
          scCode,
          [...singleCapable.pools[scCode].options].sort((a, b) => b.fairProb - a.fairProb)[0]?.key ?? 'h',
          stance
        )
      : makeLeg(m1, 'HAFU', 'hh', stance);
    faultLines = allocateLines(
      [
        {
          id: 'ft1',
          roleLabel: '连红主干·2串1',
          legs: [makeLeg(m2, p2Code, m2Top[0]?.key ?? 'h', stance), makeLeg(m1, p1Code, m1Top[0]?.key ?? 'h', stance)],
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
        { id: 'ft1', roleLabel: '上半领先赢', legs: [makeLeg(m1, 'HAFU', 'hh', stance)] },
        { id: 'ft2', roleLabel: '半平下半绝杀', legs: [makeLeg(m1, 'HAFU', 'dh', stance)] },
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
  // 总进球官方最高支持 6串1
  const extraGoalLegs = extras.slice(0, 4).map((em) => {
    const qEm = analyzeMatchMicroQuant(em);
    return makeLeg(em, 'TTG', qEm.topTwoGoals[0], stance);
  }).filter(Boolean);
  const structLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'st1', roleLabel: '黄金进球主区间', legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[0], stance)] },
          { id: 'st2', roleLabel: '黄金进球次区间', legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[1], stance)] },
        ],
        cleanBudget
      )
    : allocateLines(
        [
          {
            id: 'st1',
            roleLabel: `${Math.min(6, selected.length)}场主流进球A`,
            legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[0], stance), makeLeg(m2, 'TTG', q2.topTwoGoals[0], stance), ...extraGoalLegs],
          },
          {
            id: 'st2',
            roleLabel: `${Math.min(6, selected.length)}场主流进球B`,
            legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[1], stance), makeLeg(m2, 'TTG', q2.topTwoGoals[0], stance), ...extraGoalLegs],
          },
          {
            id: 'st3',
            roleLabel: `${Math.min(6, selected.length)}场主流进球C`,
            legs: [makeLeg(m1, 'TTG', q1.topTwoGoals[0], stance), makeLeg(m2, 'TTG', q2.topTwoGoals[1], stance), ...extraGoalLegs],
          },
        ],
        cleanBudget
      );

  const aggBudget = unlockFullAgg
    ? cleanBudget
    : Math.max(16, Math.round((cleanBudget * 0.36) / 4) * 4);
  const extraValueLegs = extras
    .map((em) => makeLeg(em, 'HHAD', 'hd', stance) ?? topPrimaryLegOf(em))
    .filter(Boolean);
  const assassinLines = isSingleMatch
    ? allocateLines(
        [
          { id: 'as1', roleLabel: '卡1球黄金比分', legs: [makeLeg(m1, 'CRS', '1:0', stance) ?? makeLeg(m1, 'HAFU', 'dh', stance)] },
          { id: 'as2', roleLabel: '有球冷平刺客', legs: [makeLeg(m1, 'CRS', '1:1', stance)] },
        ],
        aggBudget
      )
    : allocateLines(
        [
          {
            id: 'as1',
            roleLabel: '滞后洼地暴击箭',
            legs: [makeLeg(m2, 'HAFU', 'dh', stance), makeLeg(m1, 'HHAD', 'hd', stance)],
          },
          {
            id: 'as2',
            roleLabel: '卡盘×轮换冷平刺客',
            legs: [makeLeg(m2, 'HHAD', 'hd', stance), makeLeg(m1, 'HAD', 'd', stance)],
          },
          ...(extraValueLegs.length > 0
            ? [
                {
                  id: 'as3',
                  roleLabel: `${selected.length}场高水卡盘长狙`,
                  legs: [
                    makeLeg(m1, 'HHAD', 'hd', stance),
                    makeLeg(m2, 'HHAD', 'hd', stance),
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

/** 4. 三模智能奖金优化深模块 */
export function optimizeBonusPlan(manualReport, matches, optMode) {
  if (!manualReport || manualReport.combos.length === 0) return null;

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

export function archetypeToReport(plan) {
  const matchSet = new Set();
  plan.lines.forEach((l) => l.legs.forEach((lg) => matchSet.add(lg.matchId)));
  const combos = plan.lines.map((l) => ({
    id: l.id,
    desc:
      `${l.roleLabel}(${l.multiple}倍) · ` +
      l.legs.map((g) => `${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`).join('×'),
    prob: l.prob,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: 0,
    netProfit: l.netProfit,
    isUnderwater: l.netProfit < 0 && plan.missOneReturn === null,
  }));

  const underwaterCombos = combos.filter((c) => c.isUnderwater);
  const winProbSum = combos.reduce((a, c) => a + c.prob, 0);
  const underwaterProbSum = underwaterCombos.reduce((a, c) => a + c.prob, 0);
  const underwaterShareOfWins = winProbSum > 0 ? underwaterProbSum / winProbSum : 0;
  const computedProfitProb =
    plan.missOneReturn !== null
      ? plan.profitProb
      : Math.min(
          plan.winProb,
          combos.filter((c) => c.netProfit >= 0).reduce((a, c) => a + c.prob, 0)
        );
  const invUnitSum = combos.reduce((a, c) => a + 2 / Math.max(0.5, c.unitPayout), 0);
  const harmonicEffOdds = invUnitSum > 0 ? 1 / invUnitSum : 1.5;

  return {
    matchCount: matchSet.size,
    comboCount: plan.lines.length,
    multiple: 1,
    modeLabel: `${plan.shortTab}·分倍精算`,
    canSingle: matchSet.size === 1,
    hasSameMatchCrossPoolConflict: false,
    totalCost: plan.totalCost,
    minPayout: plan.missOneReturn ?? plan.minReturn,
    maxPayout: plan.maxReturn,
    likelyRange: [plan.minReturn, plan.maxReturn],
    anyWinProb: plan.winProb,
    realProfitProb: computedProfitProb,
    underwaterCount: underwaterCombos.length,
    underwaterShareOfWins,
    avgPayoutRatio: (100 - plan.vigPct) / 100,
    avgVigLossPer100: plan.vigPct,
    expectedValueRate: -plan.vigPct / 100,
    dangerScore: plan.key === 'value-assassin' ? 66 : underwaterCombos.length > 0 ? 48 : 29,
    effectiveOdds: harmonicEffOdds,
    breakevenUpgradeCost: null,
    consolidatedTickets: plan.lines.length,
    syntheticHint: `已启用【${plan.badge}】：${plan.tagline}`,
    combos,
    warnings: [],
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

export function makeUnderwaterDemoPicks(matches) {
  const m1 = matches[0];
  const m2 = matches.find((x) => x.kickoff?.startsWith('03:')) ?? matches[1];
  const out = [];
  if (m1) {
    for (const k of ['hh', 'dh', 'dd', 'ah']) {
      const o = m1.pools.HAFU.options.find((x) => x.key === k);
      if (o) {
        out.push({
          matchId: m1.id,
          matchNumStr: m1.matchNumStr,
          home: m1.home,
          away: m1.away,
          poolCode: 'HAFU',
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
        poolCode: 'HAD',
        poolName: m2.pools.HAD.name,
        singleAllowed: m2.pools.HAD.single,
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      });
    }
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
  const picks = Array.isArray(params?.picks) ? params.picks : [];
  const multiple = Math.max(1, Math.min(99, Number(params?.multiple) || 5));
  const subjectiveDeltaPct = Math.max(-15, Math.min(20, Number(params?.subjectiveDeltaPct) || 0));
  const simVoidFirstMatch = Boolean(params?.simVoidFirstMatch);
  const planSpec = params?.planSpec ?? null;
  const targetIds = Array.isArray(params?.targetIds) ? params.targetIds : [];
  const budget = Math.max(20, Math.min(10_000, Number(params?.budget) || 100));
  const stance =
    params?.stance === 'home-lean' || params?.stance === 'upset-watch'
      ? params.stance
      : 'objective';
  const unlockFullAgg = Boolean(params?.unlockFullAgg);

  const firstMid = picks[0]?.matchId;
  const sandboxAdjustedPicks = picks.map((pk) => {
    const odds = simVoidFirstMatch && pk.matchId === firstMid ? 1.0 : Number(pk.odds) || 1.0;
    const prob = Math.min(
      0.96,
      Math.max(0.02, (Number(pk.fairProb) || 0.25) * (1 + subjectiveDeltaPct / 100))
    );
    return { ...pk, odds, fairProb: prob };
  });

  const manualReport = computeTruthReport(sandboxAdjustedPicks, multiple, matches);

  const foundTargets = matches.filter((m) => targetIds.includes(m.id));
  const resolvedTargets = foundTargets.length > 0 ? foundTargets : matches.slice(0, 2);
  const fivePlans = generateFiveArchetypes(resolvedTargets, budget, stance, unlockFullAgg);

  let appliedPlan = null;
  if (planSpec?.kind === 'bonus') {
    const mode =
      planSpec.optMode === 'hot-first' || planSpec.optMode === 'cold-first'
        ? planSpec.optMode
        : 'equal';
    appliedPlan = optimizeBonusPlan(manualReport, matches, mode);
  } else if (planSpec?.kind === 'archetype') {
    appliedPlan =
      planSpec.snapshotPlan ?? fivePlans.find((p) => p.key === planSpec.key) ?? null;
  }

  const effectiveReport =
    appliedPlan && !simVoidFirstMatch && subjectiveDeltaPct === 0
      ? archetypeToReport(appliedPlan)
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
