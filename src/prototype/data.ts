export type PoolCode = 'HAD' | 'HHAD' | 'HAFU' | 'TTG' | 'CRS';

export interface OddsOption {
  key: string;
  label: string;
  odds: number;
  trend: -1 | 0 | 1; // -1 降水, 0 平, 1 升水
  fairProb: number; // 去水真实隐含概率 (0~1)
}

export interface MatchPool {
  code: PoolCode;
  name: string;
  single: boolean; // 是否开单关
  goalLine?: string;
  payoutRatio: number; // 返还率 (如 0.878)
  vig: number; // 抽水率 (如 0.122)
  updateTime: string;
  options: OddsOption[];
}

export interface MatchItem {
  id: string;
  matchNumStr: string; // 如 周二002
  league: string;
  kickoff: string;
  home: string;
  away: string;
  homeRank?: string;
  awayRank?: string;
  isHot?: boolean;
  aiAlert?: {
    level: 'high' | 'medium';
    tag: string;
    summary: string;
    priceInStatus: string;
    source: string;
    suggestedDelta?: string;
  };
  pools: Record<PoolCode, MatchPool>;
}

export interface SelectedPick {
  matchId: string;
  matchNumStr: string;
  home: string;
  away: string;
  poolCode: PoolCode;
  poolName: string;
  singleAllowed: boolean;
  optionKey: string;
  optionLabel: string;
  odds: number;
  fairProb: number;
}

export interface ComboRow {
  id: string;
  desc: string;
  legs?: SelectedPick[]; // 构成该注的完整串关腿明细（供多场奖金优化与打票单溯源）
  prob: number;
  unitPayout: number; // 单注2元经四舍六入五成双后的奖金
  totalPayout: number; // 乘倍数且经封顶截断后的实得奖金
  cappedClipped: number; // 被封顶规则没收的金额
  netProfit: number; // 净盈亏 = totalPayout - totalCost
  isUnderwater: boolean; // 假中奖（中了却亏本）
}

export interface RadarWarning {
  id: string;
  severity: 'danger' | 'warn' | 'tip';
  title: string;
  detail: string;
}

export interface TruthReport {
  matchCount: number;
  comboCount: number;
  multiple: number;
  modeLabel: string;
  canSingle: boolean;
  hasSameMatchCrossPoolConflict: boolean;
  totalCost: number;
  minPayout: number;
  maxPayout: number;
  likelyRange: [number, number];
  anyWinProb: number; // 至少命中一注概率
  realProfitProb: number; // 真正赚钱概率 (净利 > 0)
  underwaterCount: number; // 假中奖组合数
  underwaterShareOfWins: number; // 中奖情况里倒贴钱的占比
  avgPayoutRatio: number; // 综合返还率
  avgVigLossPer100: number; // 每百元暗扣蒸发期望
  expectedValueRate: number; // EV 期望回报率
  dangerScore: number; // 0~100 危险度评分
  effectiveOdds: number; // 同场/整体合成等效水位
  breakevenUpgradeCost: number | null; // 微加几元可实现100%全保本
  consolidatedTickets: number; // 店面友好合票压缩后张数
  syntheticHint: string | null; // 合成单关与跨玩法洼地提示
  combos: ComboRow[];
  warnings: RadarWarning[];
}

function expandPrecisionDecimal(num: number): { intPart: string; decPart: string } {
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
export function bankerRoundCents(rawYuan: number): number {
  if (!Number.isFinite(rawYuan) || rawYuan <= 0) return 0;
  // 直接解析 15 位有效十进制字符串，绝不二次回转 Number().toFixed()，确保 10000.015 ~ 100000.015 零精度损失！
  const { intPart, decPart } = expandPrecisionDecimal(rawYuan);
  const padded = decPart.padEnd(16, '0');
  const centsInt = BigInt(intPart) * 100n + BigInt(padded.slice(0, 2));
  const thirdDigit = Number(padded[2]);
  const tailAfterThird = BigInt(padded.slice(3) || '0');

  if (thirdDigit < 5) {
    return Number(centsInt) / 100;
  }
  if (thirdDigit > 5 || tailAfterThird > 0n) {
    return Number(centsInt + 1n) / 100;
  }
  // 恰好等于 5 且五后皆零：前一位为偶数舍去，为奇数进一
  return Number(centsInt % 2n === 0n ? centsInt : centsInt + 1n) / 100;
}

/** 多场串关精确十进制连乘计奖（以分为单位 BigInt 运算，彻底杜绝 5~8 串 1 浮点漂移） */
export function bankerRoundParlayUnitPayout(oddsList: number[]): number {
  if (oddsList.length === 0) return 0;
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
export function statutorySingleBetCap(matchCount: number): number {
  if (matchCount <= 1) return 100_000;
  if (matchCount <= 3) return 200_000;
  if (matchCount <= 5) return 500_000;
  return 1_000_000;
}

function buildPool(
  code: PoolCode,
  name: string,
  single: boolean,
  rawOptions: Array<{ key: string; label: string; odds: number; trend?: -1 | 0 | 1 }>,
  updateTime = '17:45:21',
  goalLine?: string
): MatchPool {
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
      fairProb: invSum > 0 ? (1 / o.odds) / invSum : 0,
    })),
  };
}

export const FALLBACK_MATCHES: MatchItem[] = [
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
];

function parseTrend(v: unknown): -1 | 0 | 1 {
  if (v === '1' || v === 1) return 1;
  if (v === '-1' || v === -1) return -1;
  return 0;
}

/** 真实拉取中国体彩官网计算器接口 (支持直连 + 本地代理双通道) */
export async function syncOfficialMatches(): Promise<{
  matches: MatchItem[];
  source: 'official-live' | 'fallback';
  syncNote: string;
}> {
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string; DEV?: boolean } }).env;
  const base = metaEnv?.BASE_URL || '/';
  const urls = [
    'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c',
    ...(metaEnv?.DEV
      ? [`${base}api/sporttery/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c`]
      : []),
    `${base}api/sporttery/snapshot`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json = await res.json();
      if (url.startsWith('https://webapi.sporttery.cn/') && json?.value?.matchInfoList?.length) {
        void fetch(`${base}api/sporttery/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(json),
        }).catch(() => {});
      }
      const groups = json?.value?.matchInfoList ?? [];
      const parsed: MatchItem[] = [];

      for (const g of groups) {
        for (const m of g.subMatchList ?? []) {
          const poolFlags: Record<string, boolean> = {};
          for (const p of m.poolList ?? []) {
            poolFlags[p.poolCode] = Number(p.single) === 1;
          }
          const hadRaw = m.had ?? {};
          const hhadRaw = m.hhad ?? {};
          const hafuRaw = m.hafu ?? {};
          const ttgRaw = m.ttg ?? {};
          const crsRaw = m.crs ?? {};

          const fallbackMatch = FALLBACK_MATCHES.find((fm) => fm.matchNumStr === m.matchNumStr);

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

      if (parsed.length > 0) {
        const dropCount = parsed.filter((m) =>
          Object.values(m.pools).some((p) => p.options.some((o) => o.trend === -1))
        ).length;
        return {
          matches: parsed,
          source: 'official-live',
          syncNote: `已从中国体彩官网同步 ${parsed.length} 场在售实盘赛事｜检测到 ${dropCount} 场存在官方降水异动`,
        };
      }
    } catch {
      // try next channel
    }
  }

  return {
    matches: FALLBACK_MATCHES,
    source: 'fallback',
    syncNote: '使用内置实盘快照（周二竞彩 4 场焦点战）',
  };
}

/** 计算五维真相看板与 6 大防坑雷达 */
export function computeTruthReport(
  picks: SelectedPick[],
  multiple: number,
  matches: MatchItem[]
): TruthReport {
  const byMatch = new Map<string, SelectedPick[]>();
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

  // 检测同场是否跨了多个玩法
  let hasSameMatchCrossPoolConflict = false;
  for (const grp of matchGroups) {
    const pools = new Set(grp.map((g) => g.poolCode));
    if (pools.size > 1) hasSameMatchCrossPoolConflict = true;
  }

  const canSingle = matchCount === 1 && matchGroups[0].every((p) => p.singleAllowed);
  const modeLabel = matchCount === 1 ? (canSingle ? '单关' : '需再选1场凑2串1') : `${matchCount}串1`;

  // 笛卡尔积展开所有过关组合
  let cartesian: SelectedPick[][] = [[]];
  for (const grp of matchGroups) {
    const next: SelectedPick[][] = [];
    for (const prev of cartesian) {
      for (const item of grp) {
        next.push([...prev, item]);
      }
    }
    cartesian = next;
    if (cartesian.length > 256) {
      cartesian = cartesian.slice(0, 256);
    }
  }

  const comboCount = cartesian.length;
  const totalCost = comboCount * 2 * multiple;

  // 体彩法定单注封顶上限
  const singleBetCap = statutorySingleBetCap(matchCount);

  const combos: ComboRow[] = cartesian.map((items, idx) => {
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

  // 大概率奖金落点（概率最高的前50%组合区间）
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
    combos
      .filter((c) => !c.isUnderwater)
      .reduce((acc, c) => acc + c.prob, 0) * conflictDiscount
  );

  const underwaterCount = combos.filter((c) => c.isUnderwater).length;
  const underwaterShareOfWins =
    anyWinProb > 0
      ? Math.min(1, combos.filter((c) => c.isUnderwater).reduce((a, c) => a + c.prob, 0) / anyWinProb)
      : 0;

  // 计算综合返还率（各场涉及玩法平均返还率连乘）
  const perMatchRatios = matchGroups.map((grp) => {
    const m = matches.find((x) => x.id === grp[0].matchId);
    const pool = m?.pools[grp[0].poolCode];
    return pool?.payoutRatio ?? 0.875;
  });
  const avgPayoutRatio = perMatchRatios.reduce((acc, r) => acc * r, 1);
  const avgVigLossPer100 = Number(((1 - avgPayoutRatio) * 100).toFixed(1));

  const expectedReturn = combos.reduce((acc, c) => acc + c.prob * c.totalPayout, 0);
  const expectedValueRate = totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0;

  // 合成等效水位 = 1 / sum(1 / comboOdds)
  const invComboOddsSum = combos.reduce((acc, c) => acc + 2 / Math.max(0.01, c.unitPayout), 0);
  const effectiveOdds = invComboOddsSum > 0 ? 1 / invComboOddsSum : 0;

  // 计算是否可以微加几元实现100%全保本（当 effectiveOdds > 1.04 且当前存在假中奖时）
  let breakevenUpgradeCost: number | null = null;
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

  // 危险度评分 (0~100)
  const rawDanger =
    (1 - realProfitProb) * 58 +
    Math.max(0, matchCount - 1) * 9 +
    underwaterShareOfWins * 22 +
    (matchCount === 1 && !canSingle ? 15 : 0);
  const dangerScore = Math.min(99, Math.max(8, Math.round(rawDanger)));

  // 合成单关提示
  let syntheticHint: string | null = null;
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

  // 6 大防坑雷达扫描
  const warnings: RadarWarning[] = [];

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
