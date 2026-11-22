// Static 8-match Sporttery fallback fixture (pure data, zero network/disk I/O).
import {
  BASE_POOL_ALLUP_SYM,
  BASE_POOL_SINGLE_SYM,
  OFFICIAL_CRS_PAIRS,
} from "./quant/statutoryRules.mjs";

export function buildPool(
  code,
  name,
  single,
  rawOptions,
  updateTime = "17:45:21",
  goalLine,
  selling = true,
  updateDate = undefined,
  allUp = undefined
) {
  const valid = selling ? rawOptions.filter((o) => o.odds > 0) : [];
  const hasValidOpts = Boolean(selling && valid.length > 0);
  const canSingle = Boolean(hasValidOpts && single);
  const canAllUp = Boolean(
    hasValidOpts && (allUp !== undefined ? allUp : selling !== false)
  );
  const isSelling = canSingle || canAllUp;
  const effectiveOpts = isSelling ? valid : [];
  const invSum = effectiveOpts.reduce((acc, o) => acc + 1 / o.odds, 0);
  const payoutRatio = invSum > 0 ? 1 / invSum : 0.88;
  const vig = Math.max(0, 1 - payoutRatio);
  return {
    code,
    name,
    single: canSingle,
    canSingle,
    canAllUp,
    selling: isSelling,
    [BASE_POOL_SINGLE_SYM]: canSingle,
    [BASE_POOL_ALLUP_SYM]: canAllUp,
    goalLine,
    payoutRatio,
    vig,
    updateTime,
    ...(updateDate ? { updateDate } : {}),
    options: effectiveOpts.map((o) => ({
      key: o.key,
      label: o.label,
      odds: o.odds,
      trend: o.trend ?? 0,
      shinProb: invSum > 0 ? 1 / o.odds / invSum : 0,
      fairProb: invSum > 0 ? 1 / o.odds / invSum : 0,
    })),
  };
}

const DEFAULT_CRS_ODDS_BY_LABEL = {
  "1:0": 7.5,
  "2:0": 9.5,
  "2:1": 8.2,
  "3:0": 18.0,
  "3:1": 17.5,
  "3:2": 26.0,
  "4:0": 40.0,
  "4:1": 38.0,
  "4:2": 65.0,
  "5:0": 90.0,
  "5:1": 85.0,
  "5:2": 150.0,
  胜其它: 55.0,
  "0:0": 9.5,
  "1:1": 6.0,
  "2:2": 14.0,
  "3:3": 55.0,
  平其它: 150.0,
  "0:1": 8.5,
  "0:2": 12.5,
  "1:2": 9.2,
  "0:3": 26.0,
  "1:3": 22.0,
  "2:3": 28.0,
  "0:4": 60.0,
  "1:4": 50.0,
  "2:4": 80.0,
  "0:5": 130.0,
  "1:5": 110.0,
  "2:5": 180.0,
  负其它: 65.0,
};

function buildFull31CrsPool(customOpts = [], updateTime = "18:00:00") {
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
  return buildPool("CRS", "比分", true, full31, updateTime);
}

export const RAW_FALLBACK_MATCHES = [
  {
    id: "20261117-002",
    matchNumStr: "周二002",
    league: "国际赛",
    kickoff: "20:00",
    home: "中国",
    away: "巴林",
    homeRank: "90",
    awayRank: "76",
    isHot: true,
    aiAlert: {
      level: "high",
      tag: "临场伤停 & 调水滞后窗口",
      summary:
        "巴林主力后腰哈拉姆赛前热身轻度拉伤未进首发，体彩让负(1.88)已下调但半全场「平胜 3.90」尚未跟随降赔。",
      priceInStatus: "半全场尚未完全消化（存在约 25 分钟调水滞后红利）",
      source: "亚足联官方首发名单 · 28分钟前",
      suggestedDelta: "建议主胜主观概率 +4%",
    },
    pools: {
      HAD: buildPool(
        "HAD",
        "胜平负",
        false,
        [
          { key: "h", label: "主胜", odds: 1.69, trend: 0 },
          { key: "d", label: "平", odds: 3.25, trend: 0 },
          { key: "a", label: "客胜", odds: 4.18, trend: 0 },
        ],
        "16:45:40"
      ),
      HHAD: buildPool(
        "HHAD",
        "让球(-1)",
        false,
        [
          { key: "hh", label: "让胜", odds: 3.75, trend: 1 },
          { key: "hd", label: "让平", odds: 2.93, trend: -1 },
          { key: "ha", label: "让负", odds: 1.88, trend: 1 },
        ],
        "17:45:21",
        "-1"
      ),
      HAFU: buildPool(
        "HAFU",
        "半全场",
        true,
        [
          { key: "hh", label: "胜胜", odds: 2.95, trend: 0 },
          { key: "hd", label: "胜平", odds: 16.0, trend: 0 },
          { key: "ha", label: "胜负", odds: 39.0, trend: 0 },
          { key: "dh", label: "平胜", odds: 3.9, trend: -1 },
          { key: "dd", label: "平平", odds: 4.6, trend: 0 },
          { key: "da", label: "平负", odds: 8.8, trend: 0 },
          { key: "ah", label: "负胜", odds: 29.0, trend: 0 },
          { key: "ad", label: "负平", odds: 16.0, trend: 0 },
          { key: "aa", label: "负负", odds: 7.0, trend: 1 },
        ],
        "16:22:27"
      ),
      TTG: buildPool(
        "TTG",
        "总进球",
        true,
        [
          { key: "s0", label: "0球", odds: 9.25 },
          { key: "s1", label: "1球", odds: 4.15, trend: -1 },
          { key: "s2", label: "2球", odds: 2.9 },
          { key: "s3", label: "3球", odds: 3.6 },
          { key: "s4", label: "4球", odds: 6.6 },
          { key: "s5", label: "5球", odds: 14.5 },
          { key: "s6", label: "6球", odds: 30.0 },
          { key: "s7", label: "7+球", odds: 36.0 },
        ],
        "17:30:26"
      ),
      CRS: buildFull31CrsPool(
        [
          { key: "1:0", label: "1:0", odds: 5.2, trend: -1 },
          { key: "2:0", label: "2:0", odds: 6.8 },
          { key: "2:1", label: "2:1", odds: 7.25 },
          { key: "3:0", label: "3:0", odds: 13.5 },
          { key: "0:0", label: "0:0", odds: 9.25 },
          { key: "1:1", label: "1:1", odds: 6.1 },
          { key: "0:1", label: "0:1", odds: 9.5 },
          { key: "1:2", label: "1:2", odds: 13.0 },
        ],
        "17:30:00"
      ),
    },
  },
  {
    id: "20261117-003",
    matchNumStr: "周二003",
    league: "国际赛",
    kickoff: "21:10",
    home: "日本",
    away: "巴拉圭",
    homeRank: "15",
    awayRank: "55",
    isHot: true,
    aiAlert: {
      level: "medium",
      tag: "战意轮换预警",
      summary:
        "日本队主帅森保一赛前发布会透露将考察旅欧替补边路，下半场可能大面积换人；注意防让球平。",
      priceInStatus: "主胜微升已部分消化",
      source: "日刊体育赛前直击 · 2小时前",
    },
    pools: {
      HAD: buildPool(
        "HAD",
        "胜平负",
        true,
        [
          { key: "h", label: "主胜", odds: 1.36, trend: 1 },
          { key: "d", label: "平", odds: 4.15, trend: -1 },
          { key: "a", label: "客胜", odds: 6.5, trend: 0 },
        ],
        "18:05:12"
      ),
      HHAD: buildPool(
        "HHAD",
        "让球(-1)",
        true,
        [
          { key: "hh", label: "让胜", odds: 2.18, trend: 1 },
          { key: "hd", label: "让平", odds: 3.3, trend: -1 },
          { key: "ha", label: "让负", odds: 2.72, trend: 0 },
        ],
        "18:05:12",
        "-1"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "hh", label: "胜胜", odds: 2.02 },
        { key: "hd", label: "胜平", odds: 17.0 },
        { key: "ha", label: "胜负", odds: 45.0 },
        { key: "dh", label: "平胜", odds: 3.75, trend: -1 },
        { key: "dd", label: "平平", odds: 6.0 },
        { key: "da", label: "平负", odds: 13.0 },
        { key: "ah", label: "负胜", odds: 24.0 },
        { key: "ad", label: "负平", odds: 18.0 },
        { key: "aa", label: "负负", odds: 11.5 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 11.0 },
        { key: "s1", label: "1球", odds: 4.6 },
        { key: "s2", label: "2球", odds: 3.25 },
        { key: "s3", label: "3球", odds: 3.45 },
        { key: "s4", label: "4球", odds: 5.4 },
        { key: "s5", label: "5球", odds: 10.5 },
        { key: "s6", label: "6球", odds: 21.0 },
        { key: "s7", label: "7+球", odds: 28.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "1:0", label: "1:0", odds: 5.8 },
        { key: "2:0", label: "2:0", odds: 5.6, trend: -1 },
        { key: "2:1", label: "2:1", odds: 6.9 },
        { key: "3:0", label: "3:0", odds: 8.5 },
        { key: "1:1", label: "1:1", odds: 7.2 },
        { key: "0:0", label: "0:0", odds: 11.0 },
        { key: "0:1", label: "0:1", odds: 14.0 },
        { key: "1:2", label: "1:2", odds: 18.5 },
      ]),
    },
  },
  {
    id: "20261117-005",
    matchNumStr: "周二005",
    league: "欧国联",
    kickoff: "03:45",
    home: "波兰",
    away: "瑞典",
    homeRank: "31",
    awayRank: "28",
    pools: {
      HAD: buildPool(
        "HAD",
        "胜平负",
        false,
        [
          { key: "h", label: "主胜", odds: 2.38, trend: -1 },
          { key: "d", label: "平", odds: 3.15, trend: 0 },
          { key: "a", label: "客胜", odds: 2.58, trend: 1 },
        ],
        "18:12:09"
      ),
      HHAD: buildPool(
        "HHAD",
        "让球(-1)",
        false,
        [
          { key: "hh", label: "让胜", odds: 5.25 },
          { key: "hd", label: "让平", odds: 3.95 },
          { key: "ha", label: "让负", odds: 1.44, trend: -1 },
        ],
        "18:12:09",
        "-1"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "hh", label: "胜胜", odds: 3.85 },
        { key: "hd", label: "胜平", odds: 14.0 },
        { key: "ha", label: "胜负", odds: 28.0 },
        { key: "dh", label: "平胜", odds: 5.6 },
        { key: "dd", label: "平平", odds: 4.85 },
        { key: "da", label: "平负", odds: 6.0 },
        { key: "ah", label: "负胜", odds: 26.0 },
        { key: "ad", label: "负平", odds: 14.0 },
        { key: "aa", label: "负负", odds: 4.2 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 9.5 },
        { key: "s1", label: "1球", odds: 4.2 },
        { key: "s2", label: "2球", odds: 3.1 },
        { key: "s3", label: "3球", odds: 3.65 },
        { key: "s4", label: "4球", odds: 6.4 },
        { key: "s5", label: "5球", odds: 13.0 },
        { key: "s6", label: "6球", odds: 26.0 },
        { key: "s7", label: "7+球", odds: 34.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "1:0", label: "1:0", odds: 7.5 },
        { key: "2:1", label: "2:1", odds: 8.2 },
        { key: "1:1", label: "1:1", odds: 5.8 },
        { key: "0:0", label: "0:0", odds: 9.5 },
        { key: "0:1", label: "0:1", odds: 8.0 },
        { key: "1:2", label: "1:2", odds: 8.8 },
      ]),
    },
  },
  {
    id: "20261117-007",
    matchNumStr: "周二007",
    league: "欧国联",
    kickoff: "03:45",
    home: "威尔士",
    away: "葡萄牙",
    homeRank: "29",
    awayRank: "7",
    isHot: true,
    aiAlert: {
      level: "high",
      tag: "默契球 / 轮换排雷",
      summary:
        "葡萄牙已提前锁定小组头名出线，B费累积黄牌停赛且C罗轮休未随队赴客场！体彩客胜从1.48急升至1.66，切忌盲目拿葡萄牙做稳胆！",
      priceInStatus: "客胜持续升水但热度仍偏高（高危冷门雷区）",
      source: "欧足联官网赛前名单 · 45分钟前",
      suggestedDelta: "建议客胜主观概率下调 -8%",
    },
    pools: {
      HAD: buildPool(
        "HAD",
        "胜平负",
        true,
        [
          { key: "h", label: "主胜", odds: 4.5, trend: -1 },
          { key: "d", label: "平", odds: 3.55, trend: -1 },
          { key: "a", label: "客胜", odds: 1.66, trend: 1 },
        ],
        "18:28:00"
      ),
      HHAD: buildPool(
        "HHAD",
        "让球(+1)",
        true,
        [
          { key: "hh", label: "让胜", odds: 1.98, trend: -1 },
          { key: "hd", label: "让平", odds: 3.35, trend: 0 },
          { key: "ha", label: "让负", odds: 3.1, trend: 1 },
        ],
        "18:28:00",
        "+1"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "hh", label: "胜胜", odds: 7.5 },
        { key: "hd", label: "胜平", odds: 15.0 },
        { key: "ha", label: "胜负", odds: 24.0 },
        { key: "dh", label: "平胜", odds: 9.5 },
        { key: "dd", label: "平平", odds: 5.2, trend: -1 },
        { key: "da", label: "平负", odds: 4.15 },
        { key: "ah", label: "负胜", odds: 36.0 },
        { key: "ad", label: "负平", odds: 15.0 },
        { key: "aa", label: "负负", odds: 2.52, trend: 1 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 10.0 },
        { key: "s1", label: "1球", odds: 4.3 },
        { key: "s2", label: "2球", odds: 3.15 },
        { key: "s3", label: "3球", odds: 3.5 },
        { key: "s4", label: "4球", odds: 6.1 },
        { key: "s5", label: "5球", odds: 12.5 },
        { key: "s6", label: "6球", odds: 25.0 },
        { key: "s7", label: "7+球", odds: 32.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "1:1", label: "1:1", odds: 6.2, trend: -1 },
        { key: "0:1", label: "0:1", odds: 6.0 },
        { key: "0:2", label: "0:2", odds: 7.4 },
        { key: "1:2", label: "1:2", odds: 7.2 },
        { key: "1:0", label: "1:0", odds: 10.5 },
        { key: "2:1", label: "2:1", odds: 12.5 },
      ]),
    },
  },
  {
    id: "20261119-001",
    matchNumStr: "周四001",
    league: "欧国联",
    kickoff: "01:00",
    home: "比利时",
    away: "意大利",
    homeRank: "6",
    awayRank: "9",
    pools: {
      HAD: buildPool("HAD", "胜平负", true, [
        { key: "h", label: "主胜", odds: 2.38, trend: 1 },
        { key: "d", label: "平", odds: 3.15, trend: -1 },
        { key: "a", label: "客胜", odds: 2.62, trend: -1 },
      ]),
      HHAD: buildPool(
        "HHAD",
        "让球(-1)",
        true,
        [
          { key: "hh", label: "让胜", odds: 5.15, trend: 1 },
          { key: "hd", label: "让平", odds: 3.85, trend: 0 },
          { key: "ha", label: "让负", odds: 1.46, trend: -1 },
        ],
        "18:10:00",
        "-1"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "hh", label: "胜胜", odds: 3.95 },
        { key: "dh", label: "平胜", odds: 5.6 },
        { key: "dd", label: "平平", odds: 4.65, trend: -1 },
        { key: "da", label: "平负", odds: 5.85 },
        { key: "aa", label: "负负", odds: 4.3 },
        { key: "hd", label: "胜平", odds: 13.5 },
        { key: "ha", label: "胜负", odds: 26.0 },
        { key: "ah", label: "负胜", odds: 25.0 },
        { key: "ad", label: "负平", odds: 13.5 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 9.2 },
        { key: "s1", label: "1球", odds: 4.1 },
        { key: "s2", label: "2球", odds: 3.15, trend: -1 },
        { key: "s3", label: "3球", odds: 3.65 },
        { key: "s4", label: "4球", odds: 6.4 },
        { key: "s5", label: "5球", odds: 13.0 },
        { key: "s6", label: "6球", odds: 26.0 },
        { key: "s7", label: "7+球", odds: 35.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "0:0", label: "0:0", odds: 9.8 },
        { key: "1:1", label: "1:1", odds: 5.8, trend: -1 },
        { key: "2:2", label: "2:2", odds: 13.5 },
        { key: "1:0", label: "1:0", odds: 7.5 },
        { key: "2:0", label: "2:0", odds: 10.5 },
        { key: "2:1", label: "2:1", odds: 8.6 },
        { key: "0:1", label: "0:1", odds: 7.9 },
        { key: "0:2", label: "0:2", odds: 11.5 },
        { key: "1:2", label: "1:2", odds: 9.1 },
        { key: "s1sh", label: "胜其它", odds: 32.0 },
        { key: "s1sd", label: "平其它", odds: 60.0 },
        { key: "s1sa", label: "负其它", odds: 35.0 },
      ]),
    },
  },
  {
    id: "20261119-002",
    matchNumStr: "周四002",
    league: "欧国联",
    kickoff: "03:45",
    home: "法国",
    away: "以色列",
    homeRank: "2",
    awayRank: "81",
    pools: {
      HAD: buildPool("HAD", "胜平负", false, [
        { key: "h", label: "主胜", odds: 1.18, trend: 0 },
        { key: "d", label: "平", odds: 5.8, trend: 1 },
        { key: "a", label: "客胜", odds: 11.5, trend: 1 },
      ]),
      HHAD: buildPool(
        "HHAD",
        "让球(-2)",
        true,
        [
          { key: "hh", label: "让胜", odds: 2.24, trend: -1 },
          { key: "hd", label: "让平", odds: 3.75, trend: 0 },
          { key: "ha", label: "让负", odds: 2.38, trend: 1 },
        ],
        "18:12:00",
        "-2"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "hh", label: "胜胜", odds: 1.56, trend: -1 },
        { key: "dh", label: "平胜", odds: 3.85 },
        { key: "dd", label: "平平", odds: 8.2 },
        { key: "da", label: "平负", odds: 19.0 },
        { key: "aa", label: "负负", odds: 18.0 },
        { key: "hd", label: "胜平", odds: 18.0 },
        { key: "ha", label: "胜负", odds: 50.0 },
        { key: "ah", label: "负胜", odds: 21.0 },
        { key: "ad", label: "负平", odds: 22.0 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 15.0 },
        { key: "s1", label: "1球", odds: 5.8 },
        { key: "s2", label: "2球", odds: 3.75 },
        { key: "s3", label: "3球", odds: 3.3, trend: -1 },
        { key: "s4", label: "4球", odds: 4.7 },
        { key: "s5", label: "5球", odds: 7.8 },
        { key: "s6", label: "6球", odds: 14.5 },
        { key: "s7", label: "7+球", odds: 18.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "0:0", label: "0:0", odds: 16.0 },
        { key: "1:0", label: "1:0", odds: 6.8 },
        { key: "2:0", label: "2:0", odds: 5.4, trend: -1 },
        { key: "3:0", label: "3:0", odds: 6.2 },
        { key: "2:1", label: "2:1", odds: 8.2 },
        { key: "1:1", label: "1:1", odds: 9.5 },
      ]),
    },
  },
  {
    id: "20261119-003",
    matchNumStr: "周四003",
    league: "世南美预",
    kickoff: "05:00",
    home: "委内瑞拉",
    away: "巴西",
    homeRank: "44",
    awayRank: "5",
    pools: {
      HAD: buildPool("HAD", "胜平负", true, [
        { key: "h", label: "主胜", odds: 5.25, trend: -1 },
        { key: "d", label: "平", odds: 3.6, trend: -1 },
        { key: "a", label: "客胜", odds: 1.52, trend: 1 },
      ]),
      HHAD: buildPool(
        "HHAD",
        "让球(+1)",
        true,
        [
          { key: "hh", label: "让胜", odds: 2.16, trend: -1 },
          { key: "hd", label: "让平", odds: 3.3, trend: 0 },
          { key: "ha", label: "让负", odds: 2.72, trend: 1 },
        ],
        "18:15:00",
        "+1"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "aa", label: "负负", odds: 2.35, trend: 1 },
        { key: "da", label: "平负", odds: 3.95 },
        { key: "dd", label: "平平", odds: 5.1, trend: -1 },
        { key: "hh", label: "胜胜", odds: 8.8 },
        { key: "dh", label: "平胜", odds: 10.5 },
        { key: "hd", label: "胜平", odds: 15.0 },
        { key: "ha", label: "胜负", odds: 24.0 },
        { key: "ah", label: "负胜", odds: 42.0 },
        { key: "ad", label: "负平", odds: 15.0 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 8.8 },
        { key: "s1", label: "1球", odds: 3.95 },
        { key: "s2", label: "2球", odds: 3.1 },
        { key: "s3", label: "3球", odds: 3.75 },
        { key: "s4", label: "4球", odds: 6.8 },
        { key: "s5", label: "5球", odds: 14.0 },
        { key: "s6", label: "6球", odds: 28.0 },
        { key: "s7", label: "7+球", odds: 38.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "0:0", label: "0:0", odds: 9.2 },
        { key: "0:1", label: "0:1", odds: 5.6 },
        { key: "0:2", label: "0:2", odds: 6.5 },
        { key: "1:1", label: "1:1", odds: 6.4, trend: -1 },
        { key: "1:2", label: "1:2", odds: 7.8 },
        { key: "1:0", label: "1:0", odds: 11.0 },
      ]),
    },
  },
  {
    id: "20261119-004",
    matchNumStr: "周四004",
    league: "世南美预",
    kickoff: "07:30",
    home: "巴拉圭",
    away: "阿根廷",
    homeRank: "55",
    awayRank: "1",
    pools: {
      HAD: buildPool("HAD", "胜平负", true, [
        { key: "h", label: "主胜", odds: 4.85, trend: 0 },
        { key: "d", label: "平", odds: 3.35, trend: -1 },
        { key: "a", label: "客胜", odds: 1.62, trend: 1 },
      ]),
      HHAD: buildPool(
        "HHAD",
        "让球(+1)",
        true,
        [
          { key: "hh", label: "让胜", odds: 2.02, trend: -1 },
          { key: "hd", label: "让平", odds: 3.18, trend: -1 },
          { key: "ha", label: "让负", odds: 3.05, trend: 1 },
        ],
        "18:18:00",
        "+1"
      ),
      HAFU: buildPool("HAFU", "半全场", true, [
        { key: "aa", label: "负负", odds: 2.55 },
        { key: "da", label: "平负", odds: 3.85, trend: -1 },
        { key: "dd", label: "平平", odds: 4.6, trend: -1 },
        { key: "hh", label: "胜胜", odds: 8.2 },
        { key: "dh", label: "平胜", odds: 9.8 },
        { key: "hd", label: "胜平", odds: 14.5 },
        { key: "ha", label: "胜负", odds: 25.0 },
        { key: "ah", label: "负胜", odds: 40.0 },
        { key: "ad", label: "负平", odds: 14.5 },
      ]),
      TTG: buildPool("TTG", "总进球", true, [
        { key: "s0", label: "0球", odds: 7.4, trend: -1 },
        { key: "s1", label: "1球", odds: 3.55 },
        { key: "s2", label: "2球", odds: 3.05 },
        { key: "s3", label: "3球", odds: 4.1 },
        { key: "s4", label: "4球", odds: 7.8 },
        { key: "s5", label: "5球", odds: 16.5 },
        { key: "s6", label: "6球", odds: 32.0 },
        { key: "s7", label: "7+球", odds: 45.0 },
      ]),
      CRS: buildFull31CrsPool([
        { key: "0:0", label: "0:0", odds: 7.9 },
        { key: "0:1", label: "0:1", odds: 5.1, trend: -1 },
        { key: "0:2", label: "0:2", odds: 6.8 },
        { key: "1:1", label: "1:1", odds: 6.1 },
        { key: "1:2", label: "1:2", odds: 8.2 },
        { key: "1:0", label: "1:0", odds: 10.2 },
      ]),
    },
  },
];
