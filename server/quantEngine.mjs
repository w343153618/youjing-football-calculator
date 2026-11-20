import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function expandPrecisionDecimal(num) {
  const rawStr = String(num).trim();
  const m = /^[+-]?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(rawStr);
  const [, intRaw = "0", fracRaw = "", expRaw] = m || [];
  const exp = expRaw ? parseInt(expRaw, 10) : 0;
  const digits = intRaw + fracRaw;
  const intLen = intRaw.length + exp;

  if (intLen <= 0) {
    return { intPart: "0", decPart: "0".repeat(-intLen) + digits };
  }
  if (intLen >= digits.length) {
    return {
      intPart: digits + "0".repeat(intLen - digits.length),
      decPart: "",
    };
  }
  return { intPart: digits.slice(0, intLen), decPart: digits.slice(intLen) };
}

/** 中国体彩法定计奖舍入（严格遵循 GB/T 8170）：单注2元奖金保留到分，「四舍六入五成双，五后非零则进一」 */
export function bankerRoundCents(rawYuan) {
  if (!Number.isFinite(rawYuan) || rawYuan <= 0) return 0;
  const { intPart, decPart } = expandPrecisionDecimal(rawYuan);
  const padded = decPart.padEnd(16, "0");
  const centsInt = BigInt(intPart) * 100n + BigInt(padded.slice(0, 2));
  const thirdDigit = Number(padded[2]);
  const tailAfterThird = BigInt(padded.slice(3) || "0");

  if (thirdDigit < 5) return Number(centsInt) / 100;
  if (thirdDigit > 5 || tailAfterThird > 0n) return Number(centsInt + 1n) / 100;
  return Number(centsInt % 2n === 0n ? centsInt : centsInt + 1n) / 100;
}

/** 多场串关精确十进制连乘计奖（以分为单位 BigInt 运算，1~2关安全整数域零分配快径） */
export function bankerRoundParlayUnitPayout(oddsList) {
  if (!Array.isArray(oddsList) || oddsList.length === 0) return 0;
  const len = oddsList.length;
  if (len === 1) {
    const o0 = oddsList[0];
    if (!Number.isFinite(o0) || o0 <= 0) return 0;
    if (o0 <= 1_000_000) {
      const num = 200 * Math.round(o0 * 10000);
      const q = Math.trunc(num / 10000);
      const twiceRem = (num - q * 10000) * 2;
      if (twiceRem < 10000) return q / 100;
      if (twiceRem > 10000) return (q + 1) / 100;
      return (q % 2 === 0 ? q : q + 1) / 100;
    }
  } else if (len === 2) {
    const o0 = oddsList[0];
    const o1 = oddsList[1];
    if (!Number.isFinite(o0) || o0 <= 0 || !Number.isFinite(o1) || o1 <= 0) {
      return 0;
    }
    if (o0 * o1 <= 400_000) {
      const num = 200 * Math.round(o0 * 10000) * Math.round(o1 * 10000);
      const scale = 100_000_000;
      const q = Math.trunc(num / scale);
      const twiceRem = (num - q * scale) * 2;
      if (twiceRem < scale) return q / 100;
      if (twiceRem > scale) return (q + 1) / 100;
      return (q % 2 === 0 ? q : q + 1) / 100;
    }
  }
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

function effectiveNonVoidLegCount(legOdds) {
  if (!Array.isArray(legOdds) || legOdds.length === 0) return 1;
  let valid = 0;
  for (let i = 0; i < legOdds.length; i++) {
    if (Math.abs(Number(legOdds[i]) - 1.0) > 1e-9) valid += 1;
  }
  return Math.max(1, valid);
}

const TRUSTED_SERVER_BONUS_PLANS = new WeakSet();

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
    {
      code: "3x3",
      label: "3串3",
      sizes: [2],
      baseBets: 3,
      desc: "全2关·错1仍中",
    },
    {
      code: "3x4",
      label: "3串4",
      sizes: [2, 3],
      baseBets: 4,
      desc: "2+3关·防错1场",
    },
  ],
  4: [
    {
      code: "4x4",
      label: "4串4",
      sizes: [3],
      baseBets: 4,
      desc: "全3关·错1仍中",
    },
    {
      code: "4x5",
      label: "4串5",
      sizes: [3, 4],
      baseBets: 5,
      desc: "3+4关容错",
    },
    {
      code: "4x6",
      label: "4串6",
      sizes: [2],
      baseBets: 6,
      desc: "全2关·错2仍中",
    },
    {
      code: "4x11",
      label: "4串11",
      sizes: [2, 3, 4],
      baseBets: 11,
      desc: "2~4关全包",
    },
  ],
  5: [
    {
      code: "5x5",
      label: "5串5",
      sizes: [4],
      baseBets: 5,
      desc: "全4关·错1仍中",
    },
    {
      code: "5x6",
      label: "5串6",
      sizes: [4, 5],
      baseBets: 6,
      desc: "4+5关容错",
    },
    {
      code: "5x10",
      label: "5串10",
      sizes: [2],
      baseBets: 10,
      desc: "全2关高频容错",
    },
    {
      code: "5x16",
      label: "5串16",
      sizes: [3, 4, 5],
      baseBets: 16,
      desc: "3~5关组合",
    },
    {
      code: "5x20",
      label: "5串20",
      sizes: [2, 3],
      baseBets: 20,
      desc: "2+3关稳健网",
    },
    {
      code: "5x26",
      label: "5串26",
      sizes: [2, 3, 4, 5],
      baseBets: 26,
      desc: "2~5关全包",
    },
  ],
  6: [
    {
      code: "6x6",
      label: "6串6",
      sizes: [5],
      baseBets: 6,
      desc: "全5关·错1仍中",
    },
    {
      code: "6x7",
      label: "6串7",
      sizes: [5, 6],
      baseBets: 7,
      desc: "5+6关容错",
    },
    {
      code: "6x15",
      label: "6串15",
      sizes: [2],
      baseBets: 15,
      desc: "全2关容错网",
    },
    {
      code: "6x20",
      label: "6串20",
      sizes: [3],
      baseBets: 20,
      desc: "全3关均衡网",
    },
    {
      code: "6x22",
      label: "6串22",
      sizes: [4, 5, 6],
      baseBets: 22,
      desc: "4~6关组合",
    },
    {
      code: "6x35",
      label: "6串35",
      sizes: [2, 3],
      baseBets: 35,
      desc: "2+3关双层网",
    },
    {
      code: "6x42",
      label: "6串42",
      sizes: [3, 4, 5, 6],
      baseBets: 42,
      desc: "3~6关组合",
    },
    {
      code: "6x50",
      label: "6串50",
      sizes: [2, 3, 4],
      baseBets: 50,
      desc: "2~4关厚盾网",
    },
    {
      code: "6x57",
      label: "6串57",
      sizes: [2, 3, 4, 5, 6],
      baseBets: 57,
      desc: "2~6关全包",
    },
  ],
  7: [
    {
      code: "7x7",
      label: "7串7",
      sizes: [6],
      baseBets: 7,
      desc: "全6关·错1仍中",
    },
    {
      code: "7x8",
      label: "7串8",
      sizes: [6, 7],
      baseBets: 8,
      desc: "6+7关容错",
    },
    {
      code: "7x21",
      label: "7串21",
      sizes: [5],
      baseBets: 21,
      desc: "全5关容错",
    },
    {
      code: "7x35",
      label: "7串35",
      sizes: [4],
      baseBets: 35,
      desc: "全4关容错",
    },
    {
      code: "7x120",
      label: "7串120",
      sizes: [2, 3, 4, 5, 6, 7],
      baseBets: 120,
      desc: "2~7关全包",
    },
  ],
  8: [
    {
      code: "8x8",
      label: "8串8",
      sizes: [7],
      baseBets: 8,
      desc: "全7关·错1仍中",
    },
    {
      code: "8x9",
      label: "8串9",
      sizes: [7, 8],
      baseBets: 9,
      desc: "7+8关容错",
    },
    {
      code: "8x28",
      label: "8串28",
      sizes: [6],
      baseBets: 28,
      desc: "全6关容错",
    },
    {
      code: "8x56",
      label: "8串56",
      sizes: [5],
      baseBets: 56,
      desc: "全5关容错",
    },
    {
      code: "8x70",
      label: "8串70",
      sizes: [4],
      baseBets: 70,
      desc: "全4关容错",
    },
    {
      code: "8x247",
      label: "8串247",
      sizes: [2, 3, 4, 5, 6, 7, 8],
      baseBets: 247,
      desc: "2~8关全包",
    },
  ],
};

/** 中国体彩全部 31 项法定比分编码表（主胜13 + 平5 + 客胜13，含胜其它/平其它/负其它） */
export const OFFICIAL_CRS_PAIRS = [
  ["s01s00", "1:0"],
  ["s02s00", "2:0"],
  ["s02s01", "2:1"],
  ["s03s00", "3:0"],
  ["s03s01", "3:1"],
  ["s03s02", "3:2"],
  ["s04s00", "4:0"],
  ["s04s01", "4:1"],
  ["s04s02", "4:2"],
  ["s05s00", "5:0"],
  ["s05s01", "5:1"],
  ["s05s02", "5:2"],
  ["s1sh", "胜其它"],
  ["s00s00", "0:0"],
  ["s01s01", "1:1"],
  ["s02s02", "2:2"],
  ["s03s03", "3:3"],
  ["s1sd", "平其它"],
  ["s00s01", "0:1"],
  ["s00s02", "0:2"],
  ["s01s02", "1:2"],
  ["s00s03", "0:3"],
  ["s01s03", "1:3"],
  ["s02s03", "2:3"],
  ["s00s04", "0:4"],
  ["s01s04", "1:4"],
  ["s02s04", "2:4"],
  ["s00s05", "0:5"],
  ["s01s05", "1:5"],
  ["s02s05", "2:5"],
  ["s1sa", "负其它"],
];

/**
 * 单池非线性去水求解器（Seam A）：
 * - 默认优先采用 Shin (1993) 知情交易博弈二分法（z ∈ (1e-9, 1 - 1e-9)，容差 <= 1e-12）剥离冷门长尾保护性暗扣；
 * - 当 V <= 1 + 1e-6 或极端畸形水位导致 Shin 越界时，平滑回退 Power 幂次法（q_i^k）；
 * - 当 n < 2 或存在 <= 1.0 超界水位时兜底回退 Multiplicative 等比归一化，确保输出概率恒属于 (0, 1] 且总和误差 < 1e-12。
 */
export function devigPoolProbabilities(rawInputs, method = "shin") {
  if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
    return {
      probs: [],
      methodUsed: "multiplicative",
      overround: 0,
      payoutRatio: 0.88,
      vig: 0.12,
      param: 1,
    };
  }

  const odds = rawInputs.map((item) =>
    typeof item === "object" && item !== null ? Number(item.odds) : Number(item)
  );
  const n = odds.length;

  if (odds.some((o) => !Number.isFinite(o) || o <= 0)) {
    const validInv = odds.map((o) => (Number.isFinite(o) && o > 0 ? 1 / o : 0));
    const invSum = validInv.reduce((a, b) => a + b, 0);
    const probs =
      invSum > 0 ? validInv.map((q) => q / invSum) : odds.map(() => 1 / n);
    const payoutRatio = invSum > 0 ? 1 / invSum : 0.88;
    return {
      probs,
      methodUsed: "multiplicative",
      overround: invSum,
      payoutRatio,
      vig: Math.max(0, 1 - payoutRatio),
      param: 1,
    };
  }

  if (n === 1) {
    const overround = 1 / odds[0];
    const payoutRatio = odds[0];
    return {
      probs: [1],
      methodUsed: "multiplicative",
      overround,
      payoutRatio,
      vig: Math.max(0, 1 - payoutRatio),
      param: 1,
    };
  }

  const q = new Float64Array(n);
  let V = 0;
  let allSubUnitQ = true;
  for (let i = 0; i < n; i++) {
    const qi = 1 / odds[i];
    q[i] = qi;
    V += qi;
    if (!(qi > 0 && qi < 1)) allSubUnitQ = false;
  }
  const payoutRatio = 1 / V;
  const vig = Math.max(0, 1 - payoutRatio);

  const solveMultiplicative = () => {
    const raw = new Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const pi = q[i] / V;
      raw[i] = pi;
      s += pi;
    }
    const probs = s > 0 ? raw.map((p) => p / s) : raw;
    return {
      probs,
      methodUsed: "multiplicative",
      overround: V,
      payoutRatio,
      vig,
      param: 1,
    };
  };

  const solvePower = () => {
    if (!allSubUnitQ) return null;
    if (Math.abs(V - 1) <= 1e-13) {
      const probs = Array.from(q, (qi) => qi / V);
      return {
        probs,
        methodUsed: "power",
        overround: V,
        payoutRatio,
        vig,
        param: 1,
      };
    }

    const logQ = new Float64Array(n);
    let maxLogQ = -Infinity;
    for (let i = 0; i < n; i++) {
      const lq = Math.log(q[i]);
      logQ[i] = lq;
      if (lq > maxLogQ) maxLogQ = lq;
    }
    if (!(maxLogQ < -1e-12)) return null;

    let kLo;
    let kHi;
    if (V > 1) {
      kLo = 1.0;
      kHi = Math.max(2.0, Math.log(n + 1) / -maxLogQ + 1.0);
    } else {
      kLo = 1e-9;
      kHi = 1.0;
    }

    let kMid = V > 1 ? 1 + Math.log(V) / Math.max(0.2, Math.log(n)) : 0.5;
    if (!(kMid > kLo && kMid < kHi)) kMid = 0.5 * (kLo + kHi);
    for (let iter = 0; iter < 32; iter++) {
      let s = 0;
      let ds = 0;
      for (let i = 0; i < n; i++) {
        const pi = Math.exp(kMid * logQ[i]);
        s += pi;
        ds += pi * logQ[i];
      }
      if (Math.abs(s - 1) <= 1e-14 || kHi - kLo <= 1e-14) break;
      if (s > 1) kLo = kMid;
      else kHi = kMid;
      const newton = ds !== 0 ? kMid - (s - 1) / ds : 0.5 * (kLo + kHi);
      kMid = newton > kLo && newton < kHi ? newton : 0.5 * (kLo + kHi);
    }

    const raw = new Array(n);
    let sumP = 0;
    for (let i = 0; i < n; i++) {
      const pi = Math.exp(kMid * logQ[i]);
      if (!(pi > 0 && pi < 1 && Number.isFinite(pi))) return null;
      raw[i] = pi;
      sumP += pi;
    }
    if (!(sumP > 0 && Number.isFinite(sumP))) return null;
    return {
      probs: raw.map((p) => p / sumP),
      methodUsed: "power",
      overround: V,
      payoutRatio,
      vig,
      param: kMid,
    };
  };

  const solveShin = () => {
    if (!(V > 1 + 1e-6 && allSubUnitQ)) return null;
    const twoQSqOverV = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      twoQSqOverV[i] = (2 * q[i] * q[i]) / V;
    }
    const evalSum = (z) => {
      const zSq = z * z;
      const twoMinusTwoZ = 2 * (1 - z);
      let s = 0;
      for (let i = 0; i < n; i++) {
        const c = twoQSqOverV[i];
        s += c / (Math.sqrt(zSq + twoMinusTwoZ * c) + z);
      }
      return s;
    };

    let zLo = 1e-9;
    let zHi = 1 - 1e-9;
    const sLo = evalSum(zLo);
    const sHi = evalSum(zHi);
    if (!(sLo > 1 + 1e-13 && sHi < 1 - 1e-13)) return null;

    let zMid = Math.min(0.4, Math.max(1e-4, (V - 1) / Math.max(2, n - 1)));
    for (let iter = 0; iter < 32; iter++) {
      const zSq = zMid * zMid;
      const twoMinusTwoZ = 2 * (1 - zMid);
      let s = 0;
      let ds = 0;
      for (let i = 0; i < n; i++) {
        const c = twoQSqOverV[i];
        const rad = Math.sqrt(zSq + twoMinusTwoZ * c);
        const den = rad + zMid;
        const pi = c / den;
        s += pi;
        const dRad = (zMid - c) / rad;
        ds -= (pi / den) * (dRad + 1);
      }
      if (Math.abs(s - 1) <= 1e-14 || zHi - zLo <= 1e-14) break;
      if (s > 1) zLo = zMid;
      else zHi = zMid;
      const newton = ds !== 0 ? zMid - (s - 1) / ds : 0.5 * (zLo + zHi);
      zMid = newton > zLo && newton < zHi ? newton : 0.5 * (zLo + zHi);
    }

    const raw = new Array(n);
    const zSq = zMid * zMid;
    const twoMinusTwoZ = 2 * (1 - zMid);
    let sumP = 0;
    for (let i = 0; i < n; i++) {
      const c = twoQSqOverV[i];
      const pi = c / (Math.sqrt(zSq + twoMinusTwoZ * c) + zMid);
      if (!(pi > 0 && pi < 1 && Number.isFinite(pi))) return null;
      raw[i] = pi;
      sumP += pi;
    }
    if (!(sumP > 0 && Number.isFinite(sumP))) return null;
    return {
      probs: raw.map((p) => p / sumP),
      methodUsed: "shin",
      overround: V,
      payoutRatio,
      vig,
      param: zMid,
    };
  };

  if (method === "multiplicative") return solveMultiplicative();
  if (method === "power") return solvePower() ?? solveMultiplicative();
  return solveShin() ?? solvePower() ?? solveMultiplicative();
}

function buildPool(
  code,
  name,
  single,
  rawOptions,
  updateTime = "17:45:21",
  goalLine,
  selling = true,
  updateDate = undefined
) {
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
    ...(updateDate ? { updateDate } : {}),
    options: valid.map((o) => ({
      key: o.key,
      label: o.label,
      odds: o.odds,
      trend: o.trend ?? 0,
      shinProb: invSum > 0 ? 1 / o.odds / invSum : 0,
      fairProb: invSum > 0 ? 1 / o.odds / invSum : 0,
    })),
  };
}

function parsePoolTimestampMinutes(pool) {
  if (!pool || typeof pool.updateTime !== "string") return null;
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(pool.updateTime.trim());
  if (!tm) return null;
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  const ss = Number(tm[3] || 0);
  if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60 && ss >= 0 && ss < 60)) {
    return null;
  }
  const todMin = hh * 60 + mm + ss / 60;
  if (typeof pool.updateDate === "string") {
    const dm = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(pool.updateDate.trim());
    if (dm) {
      const baseUtcMin = Math.round(
        Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) / 60_000
      );
      if (Number.isFinite(baseUtcMin)) return baseUtcMin + todMin;
    }
  }
  return todMin;
}

function resolveNormalizedMatchPoolTimestamps(pools) {
  const codes = ["HAD", "HHAD", "HAFU", "TTG", "CRS"];
  const raw = {};
  let hasExplicitDate = false;
  let hasLateEvening = false;
  for (const c of codes) {
    const p = pools?.[c];
    const v = parsePoolTimestampMinutes(p);
    raw[c] = v;
    if (p?.updateDate) hasExplicitDate = true;
    if (v !== null && v >= 16 * 60 && v < 24 * 60) hasLateEvening = true;
  }
  if (!hasExplicitDate && hasLateEvening) {
    // Sporttery daily selling window spans 11:00 -> 01:00/03:00 (+1d); wrap post-midnight times when updateDate is absent
    for (const c of codes) {
      if (raw[c] !== null && raw[c] < 7 * 60) {
        raw[c] += 1440;
      }
    }
  }
  return raw;
}

const DC_MAX_GOALS = 14;
const DC_DIM = DC_MAX_GOALS + 1;
const DC_GRID_LEN = DC_DIM * DC_DIM;
const DEFAULT_HT_GOAL_SHARE = 0.43;

const BINOM_TABLE = (() => {
  const tbl = Array.from({ length: DC_DIM }, () => new Float64Array(DC_DIM));
  for (let n = 0; n <= DC_MAX_GOALS; n++) {
    tbl[n][0] = 1;
    tbl[n][n] = 1;
    for (let k = 1; k < n; k++) {
      tbl[n][k] = tbl[n - 1][k - 1] + tbl[n - 1][k];
    }
  }
  return tbl;
})();

const HAD_KEY_ORDER = ["h", "d", "a"];
const HHAD_KEY_ORDER = ["hh", "hd", "ha"];
const TTG_KEY_ORDER = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"];
const HAFU_KEY_ORDER = ["hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa"];
const CRS_LABEL_ORDER = OFFICIAL_CRS_PAIRS.map(([, lbl]) => lbl);
const CRS_INDEX_BY_KEY = (() => {
  const m = new Map();
  OFFICIAL_CRS_PAIRS.forEach(([rawKey, lbl], idx) => {
    m.set(lbl, idx);
    m.set(rawKey, idx);
  });
  return m;
})();

const {
  GRID_CRS_IDX,
  GRID_TTG_IDX,
  GRID_DIFF,
  ATOMIC_TEMPLATES,
  GRID_HT_TO_ATOMIC,
} = (() => {
  const gridCrs = new Int8Array(DC_GRID_LEN);
  const gridTtg = new Int8Array(DC_GRID_LEN);
  const gridDiff = new Int8Array(DC_GRID_LEN);
  const gridHtToAtomic = new Int16Array(DC_GRID_LEN * 3).fill(-1);
  const templates = [];
  const tplIndexBySig = new Map();
  const htChars = ["h", "d", "a"];

  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const cell = x * DC_DIM + y;
      const diff = x - y;
      const ttgIdx = Math.min(7, x + y);
      const exactLbl = `${x}:${y}`;
      const crsIdx = CRS_INDEX_BY_KEY.has(exactLbl)
        ? CRS_INDEX_BY_KEY.get(exactLbl)
        : diff > 0
          ? 12
          : diff === 0
            ? 17
            : 30;
      gridCrs[cell] = crsIdx;
      gridTtg[cell] = ttgIdx;
      gridDiff[cell] = diff;

      const ftCode = diff > 0 ? 0 : diff === 0 ? 1 : 2;
      const ftChar = htChars[ftCode];
      for (let htCode = 0; htCode < 3; htCode++) {
        if (htCode === 0 && x === 0) continue;
        if (htCode === 2 && y === 0) continue;
        const htChar = htChars[htCode];
        const sig = `${htCode}|${crsIdx}|${ttgIdx}|${diff}`;
        let aIdx = tplIndexBySig.get(sig);
        if (aIdx === undefined) {
          aIdx = templates.length;
          tplIndexBySig.set(sig, aIdx);
          templates.push({
            ht: htChar,
            ft: ftChar,
            ftCode,
            homeGoals: x,
            awayGoals: y,
            goalDiff: diff,
            totalGoals: x + y,
            ttgIdx,
            ttgKey: TTG_KEY_ORDER[ttgIdx],
            hafuIdx: htCode * 3 + ftCode,
            hafuKey: `${htChar}${ftChar}`,
            crsIdx,
            crsKey: CRS_LABEL_ORDER[crsIdx],
          });
        }
        gridHtToAtomic[cell * 3 + htCode] = aIdx;
      }
    }
  }

  return {
    GRID_CRS_IDX: gridCrs,
    GRID_TTG_IDX: gridTtg,
    GRID_DIFF: gridDiff,
    ATOMIC_TEMPLATES: templates,
    GRID_HT_TO_ATOMIC: gridHtToAtomic,
  };
})();

function clampLambda(v) {
  return v < 0.08 ? 0.08 : v > 7.0 ? 7.0 : v;
}

function clampDcRho(rho, lamH, lamA) {
  const lo = Math.max(-0.45, Math.max(-1 / lamH, -1 / lamA) + 1e-4);
  const hi = Math.min(0.45, Math.min(1, 1 / (lamH * lamA)) - 1e-4);
  return rho < lo ? lo : rho > hi ? hi : rho;
}

const SCRATCH_PX = new Float64Array(DC_DIM);
const SCRATCH_PY = new Float64Array(DC_DIM);
const SCRATCH_POW_T = new Float64Array(DC_DIM);
const SCRATCH_POW_Q = new Float64Array(DC_DIM);
const SCRATCH_GRID = new Float64Array(DC_GRID_LEN);
const SCRATCH_BINOM = new Float64Array(DC_GRID_LEN);
const SCRATCH_BINOM_CDF = new Float64Array(DC_GRID_LEN);
const SCRATCH_CRS = new Float64Array(31);
const SCRATCH_TTG = new Float64Array(8);
const SCRATCH_HAFU = new Float64Array(9);
const SCRATCH_R0 = new Float64Array(96);
const SCRATCH_RP = new Float64Array(96);
const SCRATCH_RCAND = new Float64Array(96);
const SCRATCH_J0 = new Float64Array(96);
const SCRATCH_J1 = new Float64Array(96);
const SCRATCH_J2 = new Float64Array(96);
const SCRATCH_ATOMIC = new Float64Array(Math.max(512, ATOMIC_TEMPLATES.length));
const SCRATCH_PRIOR_ATOMIC = new Float64Array(
  Math.max(512, ATOMIC_TEMPLATES.length)
);
const SCRATCH_LOG_PRIOR = new Float64Array(
  Math.max(512, ATOMIC_TEMPLATES.length)
);
const SCRATCH_LOG_MULT = new Float64Array(
  Math.max(512, ATOMIC_TEMPLATES.length)
);
const SCRATCH_CELL_PRIOR_HT = new Float64Array(DC_GRID_LEN * 3);
const SCRATCH_HT3 = new Float64Array(3);
const SCRATCH_Q_TTG = new Float64Array(8);
const SCRATCH_Q_HAFU = new Float64Array(9);
const SCRATCH_Q_CRS = new Float64Array(31);
const SCRATCH_M_HAD = new Float64Array(3);
const SCRATCH_M_HHAD = new Float64Array(3);
const SCRATCH_M_TTG = new Float64Array(8);
const SCRATCH_M_HAFU = new Float64Array(9);
const SCRATCH_M_CRS = new Float64Array(31);
const SCRATCH_R_HAD = new Float64Array(3);
const SCRATCH_R_HHAD = new Float64Array(3);
const SCRATCH_R_TTG = new Float64Array(8);
const SCRATCH_R_HAFU = new Float64Array(9);
const SCRATCH_R_CRS = new Float64Array(31);

function evalDixonColesGrid(lamH, lamA, rho, outGrid) {
  SCRATCH_PX[0] = Math.exp(-lamH);
  SCRATCH_PY[0] = Math.exp(-lamA);
  for (let i = 1; i <= DC_MAX_GOALS; i++) {
    SCRATCH_PX[i] = (SCRATCH_PX[i - 1] * lamH) / i;
    SCRATCH_PY[i] = (SCRATCH_PY[i - 1] * lamA) / i;
  }

  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const px = SCRATCH_PX[x];
    const row = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      outGrid[row + y] = px * SCRATCH_PY[y];
    }
  }

  const r = clampDcRho(rho, lamH, lamA);
  outGrid[0] *= 1 - lamH * lamA * r;
  outGrid[1] *= 1 + lamH * r;
  outGrid[DC_DIM] *= 1 + lamA * r;
  outGrid[DC_DIM + 1] *= 1 - r;

  let sum = 0;
  for (let i = 0; i < DC_GRID_LEN; i++) sum += outGrid[i];
  const inv = 1 / sum;
  for (let i = 0; i < DC_GRID_LEN; i++) outGrid[i] *= inv;
}

function fillBinomPmfTable(theta, outB) {
  const q = 1 - theta;
  SCRATCH_POW_T[0] = 1;
  SCRATCH_POW_Q[0] = 1;
  for (let i = 1; i <= DC_MAX_GOALS; i++) {
    SCRATCH_POW_T[i] = SCRATCH_POW_T[i - 1] * theta;
    SCRATCH_POW_Q[i] = SCRATCH_POW_Q[i - 1] * q;
  }
  for (let n = 0; n <= DC_MAX_GOALS; n++) {
    const rowC = BINOM_TABLE[n];
    const rowOut = n * DC_DIM;
    let cum = 0;
    for (let k = 0; k <= n; k++) {
      const p = rowC[k] * SCRATCH_POW_T[k] * SCRATCH_POW_Q[n - k];
      outB[rowOut + k] = p;
      cum += p;
      SCRATCH_BINOM_CDF[rowOut + k] = cum;
    }
  }
}

function computeCellHtSplitProbs(x, y, pXY, binomBuf, out3) {
  if (x === 0 && y === 0) {
    out3[0] = 0;
    out3[1] = pXY;
    out3[2] = 0;
    return;
  }
  if (x === 0) {
    const pD = pXY * binomBuf[y * DC_DIM];
    out3[0] = 0;
    out3[1] = pD;
    out3[2] = Math.max(0, pXY - pD);
    return;
  }
  if (y === 0) {
    const pD = pXY * binomBuf[x * DC_DIM];
    out3[0] = Math.max(0, pXY - pD);
    out3[1] = pD;
    out3[2] = 0;
    return;
  }

  const rowX = x * DC_DIM;
  const rowY = y * DC_DIM;
  const minXY = x < y ? x : y;
  let rawD = 0;
  for (let k = 0; k <= minXY; k++) {
    rawD += binomBuf[rowX + k] * binomBuf[rowY + k];
  }
  let rawH = 0;
  for (let x1 = 0; x1 <= x; x1++) {
    if (x1 === 0) continue;
    const yMax = x1 - 1 < y ? x1 - 1 : y;
    rawH += binomBuf[rowX + x1] * SCRATCH_BINOM_CDF[rowY + yMax];
  }
  const pH = pXY * rawH;
  const pD = pXY * rawD;
  out3[0] = pH;
  out3[1] = pD;
  out3[2] = Math.max(0, pXY - pH - pD);
}

function expandScoreGridToAtomicProbs(
  scoreGrid,
  theta,
  binomBuf,
  outAtomic,
  outCellHt = null
) {
  fillBinomPmfTable(theta, binomBuf);
  const atomicLen = ATOMIC_TEMPLATES.length;
  for (let i = 0; i < atomicLen; i++) outAtomic[i] = 0;
  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const rowX = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const cell = rowX + y;
      const baseMap = cell * 3;
      computeCellHtSplitProbs(x, y, scoreGrid[cell], binomBuf, SCRATCH_HT3);
      if (outCellHt) {
        outCellHt[baseMap] = SCRATCH_HT3[0];
        outCellHt[baseMap + 1] = SCRATCH_HT3[1];
        outCellHt[baseMap + 2] = SCRATCH_HT3[2];
      }
      if (SCRATCH_HT3[0] > 0)
        outAtomic[GRID_HT_TO_ATOMIC[baseMap]] += SCRATCH_HT3[0];
      if (SCRATCH_HT3[1] > 0)
        outAtomic[GRID_HT_TO_ATOMIC[baseMap + 1]] += SCRATCH_HT3[1];
      if (SCRATCH_HT3[2] > 0)
        outAtomic[GRID_HT_TO_ATOMIC[baseMap + 2]] += SCRATCH_HT3[2];
    }
  }
  let atomicSum = 0;
  for (let i = 0; i < atomicLen; i++) atomicSum += outAtomic[i];
  const invAtomicSum = 1 / atomicSum;
  for (let i = 0; i < atomicLen; i++) outAtomic[i] *= invAtomicSum;
}

function projectHafuFromGrid(scoreGrid, theta, binomBuf, outHafu) {
  fillBinomPmfTable(theta, binomBuf);
  outHafu.fill(0);
  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const rowX = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const pXY = scoreGrid[rowX + y];
      if (pXY < 1e-9) continue;
      const ftCode = x > y ? 0 : x === y ? 1 : 2;
      computeCellHtSplitProbs(x, y, pXY, binomBuf, SCRATCH_HT3);
      if (SCRATCH_HT3[0] > 0) outHafu[ftCode] += SCRATCH_HT3[0];
      if (SCRATCH_HT3[1] > 0) outHafu[3 + ftCode] += SCRATCH_HT3[1];
      if (SCRATCH_HT3[2] > 0) outHafu[6 + ftCode] += SCRATCH_HT3[2];
    }
  }
}

function solveSymmetric3x3(a00, a01, a02, a11, a12, a22, b0, b1, b2) {
  const c00 = a11 * a22 - a12 * a12;
  const c01 = a02 * a12 - a01 * a22;
  const c02 = a01 * a12 - a02 * a11;
  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const c11 = a00 * a22 - a02 * a02;
  const c12 = a01 * a02 - a00 * a12;
  const c22 = a00 * a11 - a01 * a01;
  const invDet = 1 / det;
  return [
    (c00 * b0 + c01 * b1 + c02 * b2) * invDet,
    (c01 * b0 + c11 * b1 + c12 * b2) * invDet,
    (c02 * b0 + c12 * b1 + c22 * b2) * invDet,
  ];
}

function extractCanonicalPoolTarget(
  pool,
  expectedKeys,
  mapByLabel = false,
  needPower = true
) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options))
    return null;
  const opts = pool.options;
  const len = expectedKeys.length;
  if (opts.length !== len) return null;

  let inOrder = true;
  for (let i = 0; i < len; i++) {
    const o = opts[i];
    if (!Number.isFinite(o.odds) || o.odds <= 0) return null;
    const ok = mapByLabel
      ? (o.label || o.key) === expectedKeys[i]
      : o.key === expectedKeys[i] || o.label === expectedKeys[i];
    if (!ok) inOrder = false;
  }

  let ordered = opts;
  if (!inOrder) {
    const byKey = new Map();
    for (let i = 0; i < len; i++) {
      const o = opts[i];
      byKey.set(mapByLabel ? o.label || o.key : o.key, o);
      if (!mapByLabel && o.label) byKey.set(o.label, o);
    }
    ordered = new Array(len);
    for (let i = 0; i < len; i++) {
      const hit = byKey.get(expectedKeys[i]);
      if (!hit) return null;
      ordered[i] = hit;
    }
  }

  let invSum = 0;
  for (let i = 0; i < len; i++) {
    invSum += 1 / ordered[i].odds;
  }
  const shinProbs = devigPoolProbabilities(ordered, "shin").probs;
  const shinByKey = Object.create(null);
  for (let i = 0; i < len; i++) {
    shinByKey[expectedKeys[i]] = shinProbs[i];
  }
  const multProbs = ordered.map((o) => 1 / o.odds / invSum);
  const powerProbs = needPower
    ? devigPoolProbabilities(ordered, "power").probs
    : shinProbs;
  const payoutRatio = 1 / invSum;
  return {
    probs: shinProbs,
    shinByKey,
    powerProbs,
    multProbs,
    payoutRatio,
    vig: Math.max(0, 1 - payoutRatio),
  };
}

/**
 * 零历史库分割一致最小相对熵（KL / SMART-IPF）跨盘闭合校准器（ADR-0010 / Spec 0009）
 * - 第 1~2 阶段在扩展 {0..14}^2 比分网格与全量 9 项 HAFU 上反演光滑先验基底 Q（消除深盘右尾截断与 HAD+HAFU 闷平失明）；
 * - 第 3 阶段对齐 HAD 与 HHAD(±1) 跨分割去水边缘、对长尾多分支池施加先验平滑，再经最小相对熵比例投影导出严格闭合原子分布 P*。
 */
export function calibrateMatchCoherentModel(match) {
  const rawPools = match?.pools ?? {};
  const hadTarget = extractCanonicalPoolTarget(rawPools.HAD, HAD_KEY_ORDER);
  const rawGoalLine = Number(rawPools.HHAD?.goalLine ?? -1);
  const goalLine =
    Number.isFinite(rawGoalLine) && Math.trunc(rawGoalLine) !== 0
      ? Math.trunc(rawGoalLine)
      : -1;
  const hhadTarget =
    Number.isFinite(rawGoalLine) &&
    Number.isInteger(rawGoalLine) &&
    rawGoalLine !== 0
      ? extractCanonicalPoolTarget(rawPools.HHAD, HHAD_KEY_ORDER, false, false)
      : null;
  const ttgTarget = extractCanonicalPoolTarget(rawPools.TTG, TTG_KEY_ORDER);
  const hafuTarget = extractCanonicalPoolTarget(rawPools.HAFU, HAFU_KEY_ORDER);
  const crsTarget = extractCanonicalPoolTarget(
    rawPools.CRS,
    CRS_LABEL_ORDER,
    true
  );

  const sellingTargets = [
    hadTarget,
    hhadTarget,
    ttgTarget,
    hafuTarget,
    crsTarget,
  ].filter(Boolean);
  const sellingPoolCount = sellingTargets.length;
  const coherent = sellingPoolCount >= 2;

  // Analytical initialization of (lambdaHome, lambdaAway, rho)
  let initTotalGoals = 2.55;
  if (ttgTarget) {
    let mu = 0;
    for (let k = 0; k < 8; k++) mu += (k === 7 ? 7.45 : k) * ttgTarget.probs[k];
    initTotalGoals = Math.max(0.45, Math.min(8.5, mu));
  } else if (crsTarget) {
    let mu = 0;
    for (let i = 0; i < 31; i++) {
      const lbl = CRS_LABEL_ORDER[i];
      if (lbl.includes(":")) {
        const [hx, ay] = lbl.split(":").map(Number);
        mu += (hx + ay) * crsTarget.probs[i];
      } else {
        mu += (lbl === "平其它" ? 8.0 : 6.6) * crsTarget.probs[i];
      }
    }
    initTotalGoals = Math.max(0.45, Math.min(8.5, mu));
  } else if (hafuTarget) {
    // Extract goal scale directly from HAFU 9-way dd (HT draw & FT draw, strongly governed by exp(-mu))
    const ddProb = Math.max(0.03, Math.min(0.85, hafuTarget.probs[4]));
    const reversalProb = hafuTarget.probs[2] + hafuTarget.probs[6];
    initTotalGoals = Math.max(
      0.45,
      Math.min(5.5, -Math.log(ddProb) * 1.15 + reversalProb * 2.2)
    );
  }

  let initPH = 0.44;
  let initPD = 0.27;
  let initPA = 0.29;
  if (hadTarget) {
    [initPH, initPD, initPA] = hadTarget.probs;
  } else if (hafuTarget) {
    initPH = hafuTarget.probs[0] + hafuTarget.probs[3] + hafuTarget.probs[6];
    initPD = hafuTarget.probs[1] + hafuTarget.probs[4] + hafuTarget.probs[7];
    initPA = hafuTarget.probs[2] + hafuTarget.probs[5] + hafuTarget.probs[8];
  } else if (crsTarget) {
    initPH = 0;
    initPD = 0;
    initPA = 0;
    for (let i = 0; i < 13; i++) initPH += crsTarget.probs[i];
    for (let i = 13; i < 18; i++) initPD += crsTarget.probs[i];
    for (let i = 18; i < 31; i++) initPA += crsTarget.probs[i];
  } else if (hhadTarget) {
    const share = Math.max(
      0.06,
      Math.min(
        0.94,
        hhadTarget.probs[0] + 0.5 * hhadTarget.probs[1] - 0.18 * goalLine
      )
    );
    initPD = 0.24;
    initPH = share * (1 - initPD);
    initPA = (1 - share) * (1 - initPD);
  }

  const logRatio = Math.log(
    Math.max(0.015, initPH + 0.25 * initPD) /
      Math.max(0.015, initPA + 0.25 * initPD)
  );
  const initDiff = initTotalGoals * Math.tanh(0.42 * logRatio);
  let lamH = clampLambda(0.5 * (initTotalGoals + initDiff));
  let lamA = clampLambda(0.5 * (initTotalGoals - initDiff));
  let rho = 0;

  // Build weighted residual specification for Stage 1 prior Q
  const invVigPrecision = (t) =>
    Math.pow(t.payoutRatio / Math.max(0.045, t.vig), 2);
  const hasPrimaryScalePool = Boolean(ttgTarget || crsTarget || hhadTarget);
  const useFullHafuInStage1 = Boolean(hafuTarget && !ttgTarget && !crsTarget);

  const rawWHad = hadTarget ? invVigPrecision(hadTarget) * 1.0 : 0;
  const rawWHhad = hhadTarget ? invVigPrecision(hhadTarget) * 1.0 : 0;
  const rawWTtg = ttgTarget ? invVigPrecision(ttgTarget) * 1.5 : 0;
  const rawWHafu = hafuTarget
    ? invVigPrecision(hafuTarget) *
      (useFullHafuInStage1 ? 1.0 : hadTarget ? 0.15 : 1.0)
    : 0;
  const hasCoreAnchors = Boolean(ttgTarget && (hadTarget || hhadTarget));
  const rawWCrs = crsTarget
    ? invVigPrecision(crsTarget) * (hasCoreAnchors ? 0.15 : 1.0)
    : 0;

  const maxRawW = Math.max(1, rawWHad, rawWHhad, rawWTtg, rawWHafu, rawWCrs);
  const sHad = Math.sqrt(rawWHad / maxRawW);
  const sHhad = Math.sqrt(rawWHhad / maxRawW);
  const sTtg = Math.sqrt(rawWTtg / maxRawW);
  const sHafu = Math.sqrt(rawWHafu / maxRawW);
  const sCrs = Math.sqrt(rawWCrs / maxRawW);

  const hasAnyScaleSignal = Boolean(hasPrimaryScalePool || hafuTarget);
  const sRhoPrior = Math.sqrt(
    hasAnyScaleSignal && sellingPoolCount >= 2 ? 0.0015 : 0.03
  );
  const sTotPrior = !hasAnyScaleSignal ? Math.sqrt(0.025) : 0;

  const hafuFtObs =
    hafuTarget && !useFullHafuInStage1
      ? [
          hafuTarget.probs[0] + hafuTarget.probs[3] + hafuTarget.probs[6],
          hafuTarget.probs[1] + hafuTarget.probs[4] + hafuTarget.probs[7],
          hafuTarget.probs[2] + hafuTarget.probs[5] + hafuTarget.probs[8],
        ]
      : null;

  const residualCount =
    (hadTarget ? 3 : 0) +
    (hhadTarget ? 3 : 0) +
    (ttgTarget ? 8 : 0) +
    (useFullHafuInStage1 ? 9 : hafuFtObs ? 3 : 0) +
    (crsTarget ? 31 : 0) +
    1 +
    (sTotPrior > 0 ? 1 : 0);

  const gridWork = SCRATCH_GRID;
  const crsWork = SCRATCH_CRS;
  const ttgWork = SCRATCH_TTG;
  const binomBuf = SCRATCH_BINOM;
  const hafuWork = SCRATCH_HAFU;

  const evalResiduals = (lh, la, rVal, outRes) => {
    const rClamped = clampDcRho(rVal, lh, la);
    evalDixonColesGrid(lh, la, rClamped, gridWork);
    let pH = 0;
    let pD = 0;
    let pA = 0;
    let pHH = 0;
    let pHD = 0;
    let pHA = 0;
    if (ttgTarget) ttgWork.fill(0);
    if (crsTarget) crsWork.fill(0);

    for (let i = 0; i < DC_GRID_LEN; i++) {
      const p = gridWork[i];
      const d = GRID_DIFF[i];
      if (d > 0) pH += p;
      else if (d === 0) pD += p;
      else pA += p;

      if (hhadTarget) {
        const adj = d + goalLine;
        if (adj > 0) pHH += p;
        else if (adj === 0) pHD += p;
        else pHA += p;
      }
      if (ttgTarget) ttgWork[GRID_TTG_IDX[i]] += p;
      if (crsTarget) crsWork[GRID_CRS_IDX[i]] += p;
    }

    let k = 0;
    if (hadTarget) {
      outRes[k++] = sHad * (pH - hadTarget.probs[0]);
      outRes[k++] = sHad * (pD - hadTarget.probs[1]);
      outRes[k++] = sHad * (pA - hadTarget.probs[2]);
    }
    if (hhadTarget) {
      outRes[k++] = sHhad * (pHH - hhadTarget.probs[0]);
      outRes[k++] = sHhad * (pHD - hhadTarget.probs[1]);
      outRes[k++] = sHhad * (pHA - hhadTarget.probs[2]);
    }
    if (ttgTarget) {
      for (let j = 0; j < 8; j++) {
        outRes[k++] = sTtg * (ttgWork[j] - ttgTarget.probs[j]);
      }
    }
    if (useFullHafuInStage1) {
      projectHafuFromGrid(gridWork, DEFAULT_HT_GOAL_SHARE, binomBuf, hafuWork);
      for (let j = 0; j < 9; j++) {
        outRes[k++] = sHafu * (hafuWork[j] - hafuTarget.probs[j]);
      }
    } else if (hafuFtObs) {
      outRes[k++] = sHafu * (pH - hafuFtObs[0]);
      outRes[k++] = sHafu * (pD - hafuFtObs[1]);
      outRes[k++] = sHafu * (pA - hafuFtObs[2]);
    }
    if (crsTarget) {
      for (let j = 0; j < 31; j++) {
        outRes[k++] = sCrs * (crsWork[j] - crsTarget.probs[j]);
      }
    }
    outRes[k++] = sRhoPrior * rClamped;
    if (sTotPrior > 0) {
      outRes[k++] = sTotPrior * (lh + la - 2.55);
    }

    let loss = 0;
    for (let i = 0; i < k; i++) loss += outRes[i] * outRes[i];
    return loss;
  };

  if (sellingPoolCount >= 1) {
    const r0 = SCRATCH_R0;
    const rP = SCRATCH_RP;
    const rCand = SCRATCH_RCAND;
    const j0 = SCRATCH_J0;
    const j1 = SCRATCH_J1;
    const j2 = SCRATCH_J2;

    let loss = evalResiduals(lamH, lamA, rho, r0);
    let damping = 1e-3;

    for (let iter = 0; iter < 5; iter++) {
      const epsH = lamH > 6.99 ? -1e-5 : 1e-5;
      evalResiduals(clampLambda(lamH + epsH), lamA, rho, rP);
      const invEpsH = 1 / (clampLambda(lamH + epsH) - lamH);
      for (let i = 0; i < residualCount; i++) j0[i] = (rP[i] - r0[i]) * invEpsH;

      const epsA = lamA > 6.99 ? -1e-5 : 1e-5;
      evalResiduals(lamH, clampLambda(lamA + epsA), rho, rP);
      const invEpsA = 1 / (clampLambda(lamA + epsA) - lamA);
      for (let i = 0; i < residualCount; i++) j1[i] = (rP[i] - r0[i]) * invEpsA;

      const rhoHi = Math.min(0.45, Math.min(1, 1 / (lamH * lamA)) - 1e-4);
      const epsR = rho + 1e-5 <= rhoHi ? 1e-5 : -1e-5;
      const pertR = clampDcRho(rho + epsR, lamH, lamA);
      const dR = pertR - rho;
      if (Math.abs(dR) > 1e-12) {
        evalResiduals(lamH, lamA, pertR, rP);
        const invDR = 1 / dR;
        for (let i = 0; i < residualCount; i++) j2[i] = (rP[i] - r0[i]) * invDR;
      } else {
        j2.fill(0);
      }

      let a00 = damping;
      let a01 = 0;
      let a02 = 0;
      let a11 = damping;
      let a12 = 0;
      let a22 = damping;
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < residualCount; i++) {
        const g0 = j0[i];
        const g1 = j1[i];
        const g2 = j2[i];
        const ri = r0[i];
        a00 += g0 * g0;
        a01 += g0 * g1;
        a02 += g0 * g2;
        a11 += g1 * g1;
        a12 += g1 * g2;
        a22 += g2 * g2;
        b0 -= g0 * ri;
        b1 -= g1 * ri;
        b2 -= g2 * ri;
      }

      const step = solveSymmetric3x3(a00, a01, a02, a11, a12, a22, b0, b1, b2);
      if (!step) break;

      const candLamH = clampLambda(lamH + step[0]);
      const candLamA = clampLambda(lamA + step[1]);
      const candRho = clampDcRho(rho + step[2], candLamH, candLamA);
      const candLoss = evalResiduals(candLamH, candLamA, candRho, rCand);

      if (candLoss < loss) {
        const paramMove = Math.hypot(
          candLamH - lamH,
          candLamA - lamA,
          candRho - rho
        );
        const lossDrop = loss - candLoss;
        lamH = candLamH;
        lamA = candLamA;
        rho = candRho;
        loss = candLoss;
        for (let t = 0; t < residualCount; t++) r0[t] = rCand[t];
        damping = Math.max(1e-7, damping * 0.35);
        if (lossDrop < 1e-8 && paramMove < 2e-5) break;
      } else {
        damping *= 4.0;
        if (damping > 1e4) break;
      }
    }
  }

  rho = clampDcRho(rho, lamH, lamA);
  const scoreGrid = new Float64Array(DC_GRID_LEN);
  evalDixonColesGrid(lamH, lamA, rho, scoreGrid);

  // Stage 2: Fit half-time goal share theta in [0.36, 0.48] (24 golden-section steps -> < 1.2e-6 tolerance)
  let theta = DEFAULT_HT_GOAL_SHARE;
  if (coherent && hafuTarget) {
    const evalThetaLoss = (th) => {
      projectHafuFromGrid(scoreGrid, th, binomBuf, hafuWork);
      let l =
        0.05 * (th - DEFAULT_HT_GOAL_SHARE) * (th - DEFAULT_HT_GOAL_SHARE);
      for (let i = 0; i < 9; i++) {
        const d = hafuWork[i] - hafuTarget.probs[i];
        l += d * d;
      }
      return l;
    };

    const invPhi = (Math.sqrt(5) - 1) / 2;
    let a = 0.36;
    let b = 0.48;
    let c = b - invPhi * (b - a);
    let d = a + invPhi * (b - a);
    let fc = evalThetaLoss(c);
    let fd = evalThetaLoss(d);
    for (let iter = 0; iter < 13; iter++) {
      if (fc < fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - invPhi * (b - a);
        fc = evalThetaLoss(c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + invPhi * (b - a);
        fd = evalThetaLoss(d);
      }
    }
    theta = 0.5 * (a + b);
  }

  // Expand prior scoreGrid into physically compatible atomic prior Q
  const atomicLen = ATOMIC_TEMPLATES.length;
  const atomicProbs = SCRATCH_ATOMIC;
  const cellPriorHt = SCRATCH_CELL_PRIOR_HT;
  expandScoreGridToAtomicProbs(
    scoreGrid,
    theta,
    binomBuf,
    atomicProbs,
    cellPriorHt
  );

  // Stage 3: Partition-Consistent Target Alignment + Minimum Relative Entropy (SMART / IPF) Projection
  if (coherent) {
    const priorAtomic = SCRATCH_PRIOR_ATOMIC;
    const logPrior = SCRATCH_LOG_PRIOR;
    const logMult = SCRATCH_LOG_MULT;
    const qTtg = SCRATCH_Q_TTG;
    const qHafu = SCRATCH_Q_HAFU;
    const qCrs = SCRATCH_Q_CRS;
    qTtg.fill(0);
    qHafu.fill(0);
    qCrs.fill(0);
    for (let i = 0; i < atomicLen; i++) {
      const p0 = Math.max(1e-14, atomicProbs[i]);
      priorAtomic[i] = p0;
      logPrior[i] = Math.log(p0);
      const tpl = ATOMIC_TEMPLATES[i];
      qTtg[tpl.ttgIdx] += p0;
      qHafu[tpl.hafuIdx] += p0;
      qCrs[tpl.crsIdx] += p0;
    }

    let tHad = hadTarget
      ? Float64Array.from(
          hadTarget.probs,
          (v, j) => 0.5 * v + 0.5 * hadTarget.powerProbs[j]
        )
      : null;
    let tHhad = hhadTarget
      ? Float64Array.from(
          hhadTarget.probs,
          (v, j) => 0.35 * v + 0.65 * hhadTarget.multProbs[j]
        )
      : null;

    if (tHad && tHhad && Math.abs(goalLine) === 1) {
      const mHhad = hhadTarget.multProbs;
      const sHhad = hhadTarget.probs;
      const smoothReconWeight = (gap) => {
        if (gap <= 0.1) return 1;
        if (gap >= 0.16) return 0;
        return 0.5 * (1 + Math.cos((Math.PI * (gap - 0.1)) / 0.06));
      };
      if (goalLine === -1) {
        const splitWin =
          0.5 * (sHhad[0] + sHhad[1]) + 0.5 * (mHhad[0] + mHhad[1]);
        const alpha = smoothReconWeight(Math.abs(splitWin - tHad[0]));
        if (alpha > 0) {
          // Symmetric Jensen-cancelling reconciliation with C1 smooth ramp on [0.10, 0.16]
          const pHCons = Math.min(
            0.995,
            Math.max(0.005, 0.5 * tHad[0] + 0.5 * splitWin)
          );
          const pDaCons = 1 - pHCons;
          const daSum = Math.max(1e-12, tHad[1] + tHad[2]);
          const hhSum = Math.max(1e-12, mHhad[0] + mHhad[1]);
          const rHad0 = pHCons;
          const rHad1 = pDaCons * (tHad[1] / daSum);
          const rHad2 = pDaCons * (tHad[2] / daSum);
          const rHhad0 = pHCons * (mHhad[0] / hhSum);
          const rHhad1 = pHCons * (mHhad[1] / hhSum);
          const rHhad2 = pDaCons;
          tHad = new Float64Array([
            (1 - alpha) * tHad[0] + alpha * rHad0,
            (1 - alpha) * tHad[1] + alpha * rHad1,
            (1 - alpha) * tHad[2] + alpha * rHad2,
          ]);
          tHhad = new Float64Array([
            (1 - alpha) * tHhad[0] + alpha * rHhad0,
            (1 - alpha) * tHhad[1] + alpha * rHhad1,
            (1 - alpha) * tHhad[2] + alpha * rHhad2,
          ]);
        }
      } else {
        const splitAway =
          0.5 * (sHhad[1] + sHhad[2]) + 0.5 * (mHhad[1] + mHhad[2]);
        const alpha = smoothReconWeight(Math.abs(splitAway - tHad[2]));
        if (alpha > 0) {
          const pACons = Math.min(
            0.995,
            Math.max(0.005, 0.5 * tHad[2] + 0.5 * splitAway)
          );
          const pHdCons = 1 - pACons;
          const hdSum = Math.max(1e-12, tHad[0] + tHad[1]);
          const haSum = Math.max(1e-12, mHhad[1] + mHhad[2]);
          const rHad0 = pHdCons * (tHad[0] / hdSum);
          const rHad1 = pHdCons * (tHad[1] / hdSum);
          const rHad2 = pACons;
          const rHhad0 = pHdCons;
          const rHhad1 = pACons * (mHhad[1] / haSum);
          const rHhad2 = pACons * (mHhad[2] / haSum);
          tHad = new Float64Array([
            (1 - alpha) * tHad[0] + alpha * rHad0,
            (1 - alpha) * tHad[1] + alpha * rHad1,
            (1 - alpha) * tHad[2] + alpha * rHad2,
          ]);
          tHhad = new Float64Array([
            (1 - alpha) * tHhad[0] + alpha * rHhad0,
            (1 - alpha) * tHhad[1] + alpha * rHhad1,
            (1 - alpha) * tHhad[2] + alpha * rHhad2,
          ]);
        }
      }
    } else if (tHad && tHhad && Math.abs(goalLine) >= 2) {
      // Generalized subset-monotonicity reconciliation for deep integer handicaps (goalLine = ±2, ±3, ...):
      // Preserve market-implied bridge mass P(1 <= |d| < |goalLine|) = P(win) - P(bigWin) whenever valid,
      // and smoothly reconcile ONLY when vig distortion causes subset inversion (P(bigWin) + minBridge > P(win)).
      const mHhad = hhadTarget.multProbs;
      const sHhad = hhadTarget.probs;
      const absGl = Math.abs(goalLine);
      let qBridge = 0;
      for (let i = 0; i < atomicLen; i++) {
        const d = ATOMIC_TEMPLATES[i].goalDiff;
        if (goalLine < 0 ? d >= 1 && d < absGl : d <= -1 && d > -absGl) {
          qBridge += priorAtomic[i];
        }
      }
      const minBridgeFloor = Math.max(0.015, 0.25 * qBridge);
      if (goalLine < 0) {
        const splitBigWin =
          0.5 * (sHhad[0] + sHhad[1]) + 0.5 * (mHhad[0] + mHhad[1]);
        const excess = splitBigWin + minBridgeFloor - tHad[0];
        if (excess > 0) {
          const alpha = Math.min(1, excess / 0.06);
          const pHCons = Math.min(
            0.995,
            Math.max(0.02, tHad[0] + 0.35 * Math.min(0.12, excess))
          );
          const bigWinCons = Math.max(
            0.005,
            pHCons - Math.max(minBridgeFloor, 0.6 * qBridge)
          );
          const pDaCons = 1 - pHCons;
          const daSum = Math.max(1e-12, tHad[1] + tHad[2]);
          const hhSum = Math.max(1e-12, mHhad[0] + mHhad[1]);
          tHad = new Float64Array([
            (1 - alpha) * tHad[0] + alpha * pHCons,
            (1 - alpha) * tHad[1] + alpha * pDaCons * (tHad[1] / daSum),
            (1 - alpha) * tHad[2] + alpha * pDaCons * (tHad[2] / daSum),
          ]);
          tHhad = new Float64Array([
            (1 - alpha) * tHhad[0] + alpha * bigWinCons * (mHhad[0] / hhSum),
            (1 - alpha) * tHhad[1] + alpha * bigWinCons * (mHhad[1] / hhSum),
            (1 - alpha) * tHhad[2] + alpha * (1 - bigWinCons),
          ]);
        }
      } else {
        const splitBigAway =
          0.5 * (sHhad[1] + sHhad[2]) + 0.5 * (mHhad[1] + mHhad[2]);
        const excess = splitBigAway + minBridgeFloor - tHad[2];
        if (excess > 0) {
          const alpha = Math.min(1, excess / 0.06);
          const pACons = Math.min(
            0.995,
            Math.max(0.02, tHad[2] + 0.35 * Math.min(0.12, excess))
          );
          const bigAwayCons = Math.max(
            0.005,
            pACons - Math.max(minBridgeFloor, 0.6 * qBridge)
          );
          const pHdCons = 1 - pACons;
          const hdSum = Math.max(1e-12, tHad[0] + tHad[1]);
          const haSum = Math.max(1e-12, mHhad[1] + mHhad[2]);
          tHad = new Float64Array([
            (1 - alpha) * tHad[0] + alpha * pHdCons * (tHad[0] / hdSum),
            (1 - alpha) * tHad[1] + alpha * pHdCons * (tHad[1] / hdSum),
            (1 - alpha) * tHad[2] + alpha * pACons,
          ]);
          tHhad = new Float64Array([
            (1 - alpha) * tHhad[0] + alpha * (1 - bigAwayCons),
            (1 - alpha) * tHhad[1] + alpha * bigAwayCons * (mHhad[1] / haSum),
            (1 - alpha) * tHhad[2] + alpha * bigAwayCons * (mHhad[2] / haSum),
          ]);
        }
      }
    }

    const huberNormalize = (arr) => {
      let s = 0;
      for (let j = 0; j < arr.length; j++) s += arr[j];
      if (s > 0) {
        const inv = 1 / s;
        for (let j = 0; j < arr.length; j++) arr[j] *= inv;
      }
      return arr;
    };
    const huberLagCap = (rawVal, priorVal, tol) =>
      rawVal < priorVal - tol
        ? priorVal - tol + 0.15 * (rawVal - (priorVal - tol))
        : rawVal;

    // Timestamp-verified cross-pool anti-hallucination (Spec 0012 / ADR-0013):
    // When explicit updateDate + updateTime show CRS is fresher than TTG (>15m) and its exact goal-sum
    // partition contradicts Poisson prior, cap TTG's reference prior at CRS's exact partition sum.
    const normTs = resolveNormalizedMatchPoolTimestamps(rawPools);
    const hasExplicitDate = Boolean(
      rawPools.HAD?.updateDate ||
      rawPools.HHAD?.updateDate ||
      rawPools.TTG?.updateDate ||
      rawPools.CRS?.updateDate
    );
    const ttgTs = ttgTarget ? normTs.TTG : null;
    const crsTs = crsTarget ? normTs.CRS : null;
    const hadTs = hadTarget ? normTs.HAD : null;
    const hhadTs = hhadTarget ? normTs.HHAD : null;
    const mainRefTs =
      hadTs !== null && hhadTs !== null
        ? Math.max(hadTs, hhadTs)
        : (hadTs ?? hhadTs);

    let crsExactTtgSum = null;
    if (
      hasExplicitDate &&
      crsTarget &&
      ttgTarget &&
      crsTs !== null &&
      ttgTs !== null &&
      crsTs > ttgTs + 15
    ) {
      crsExactTtgSum = new Float64Array(6);
      for (let i = 0; i < 31; i++) {
        const lbl = CRS_LABEL_ORDER[i];
        if (!lbl.includes(":")) continue;
        const [hx, ay] = lbl.split(":").map(Number);
        const tot = hx + ay;
        if (tot >= 0 && tot <= 5) {
          crsExactTtgSum[tot] += crsTarget.powerProbs[i];
        }
      }
    }
    const ttgMovedAfterMain =
      hasExplicitDate &&
      ttgTs !== null &&
      mainRefTs !== null &&
      ttgTs > mainRefTs + 15;

    const tTtg = ttgTarget
      ? huberNormalize(
          Float64Array.from(ttgTarget.probs, (v, j) => {
            const rawBlended = 0.65 * v + 0.35 * ttgTarget.powerProbs[j];
            if (ttgMovedAfterMain) {
              return 0.97 * rawBlended + 0.03 * qTtg[j];
            }
            const refPrior =
              crsExactTtgSum && j <= 5 && crsExactTtgSum[j] < qTtg[j] - 0.015
                ? crsExactTtgSum[j]
                : qTtg[j];
            return (
              0.97 * huberLagCap(rawBlended, refPrior, 0.032) + 0.03 * qTtg[j]
            );
          })
        )
      : null;
    const tHafu = hafuTarget
      ? huberNormalize(
          Float64Array.from(
            hafuTarget.powerProbs,
            (v, j) => 0.85 * huberLagCap(v, qHafu[j], 0.045) + 0.15 * qHafu[j]
          )
        )
      : null;
    const tCrs = crsTarget
      ? huberNormalize(
          Float64Array.from(
            crsTarget.powerProbs,
            (v, j) => 0.8 * huberLagCap(v, qCrs[j], 0.035) + 0.2 * qCrs[j]
          )
        )
      : null;

    const rawW = [
      tHad ? 14.0 : 0,
      tHhad ? 14.0 : 0,
      tTtg ? 15.0 : 0,
      tHafu ? 8.0 : 0,
      tCrs ? 6.0 : 0,
    ];
    const sumRawW = rawW.reduce((a, b) => a + b, 0) || 1;
    const wPrior = 0.02;
    const sw0 = ((1 - wPrior) * rawW[0]) / sumRawW;
    const sw1 = ((1 - wPrior) * rawW[1]) / sumRawW;
    const sw2 = ((1 - wPrior) * rawW[2]) / sumRawW;
    const sw3 = ((1 - wPrior) * rawW[3]) / sumRawW;
    const sw4 = ((1 - wPrior) * rawW[4]) / sumRawW;

    const mHadBuf = SCRATCH_M_HAD;
    const mHhadBuf = SCRATCH_M_HHAD;
    const mTtgBuf = SCRATCH_M_TTG;
    const mHafuBuf = SCRATCH_M_HAFU;
    const mCrsBuf = SCRATCH_M_CRS;
    const rHad = SCRATCH_R_HAD;
    const rHhad = SCRATCH_R_HHAD;
    const rTtg = SCRATCH_R_TTG;
    const rHafu = SCRATCH_R_HAFU;
    const rCrs = SCRATCH_R_CRS;

    for (let i = 0; i < atomicLen; i++) logMult[i] = logPrior[i];
    let logNormShift = 0;

    for (let iter = 0; iter < 9; iter++) {
      if (tHad) mHadBuf.fill(0);
      if (tHhad) mHhadBuf.fill(0);
      if (tTtg) mTtgBuf.fill(0);
      if (tHafu) mHafuBuf.fill(0);
      if (tCrs) mCrsBuf.fill(0);

      for (let i = 0; i < atomicLen; i++) {
        const pi = atomicProbs[i];
        const tpl = ATOMIC_TEMPLATES[i];
        if (tHad) mHadBuf[tpl.ftCode] += pi;
        if (tHhad) {
          const adj = tpl.goalDiff + goalLine;
          mHhadBuf[adj > 0 ? 0 : adj === 0 ? 1 : 2] += pi;
        }
        if (tTtg) mTtgBuf[tpl.ttgIdx] += pi;
        if (tHafu) mHafuBuf[tpl.hafuIdx] += pi;
        if (tCrs) mCrsBuf[tpl.crsIdx] += pi;
      }

      if (tHad) {
        for (let j = 0; j < 3; j++)
          rHad[j] =
            sw0 *
            Math.log(Math.max(1e-13, tHad[j]) / Math.max(1e-13, mHadBuf[j]));
      }
      if (tHhad) {
        for (let j = 0; j < 3; j++)
          rHhad[j] =
            sw1 *
            Math.log(Math.max(1e-13, tHhad[j]) / Math.max(1e-13, mHhadBuf[j]));
      }
      if (tTtg) {
        for (let j = 0; j < 8; j++)
          rTtg[j] =
            sw2 *
            Math.log(Math.max(1e-13, tTtg[j]) / Math.max(1e-13, mTtgBuf[j]));
      }
      if (tHafu) {
        for (let j = 0; j < 9; j++)
          rHafu[j] =
            sw3 *
            Math.log(Math.max(1e-13, tHafu[j]) / Math.max(1e-13, mHafuBuf[j]));
      }
      if (tCrs) {
        for (let j = 0; j < 31; j++)
          rCrs[j] =
            sw4 *
            Math.log(Math.max(1e-13, tCrs[j]) / Math.max(1e-13, mCrsBuf[j]));
      }

      let maxLm = -Infinity;
      for (let i = 0; i < atomicLen; i++) {
        const tpl = ATOMIC_TEMPLATES[i];
        let lm =
          wPrior * logPrior[i] + (1 - wPrior) * (logMult[i] - logNormShift);
        if (tHad) lm += rHad[tpl.ftCode];
        if (tHhad) {
          const adj = tpl.goalDiff + goalLine;
          lm += rHhad[adj > 0 ? 0 : adj === 0 ? 1 : 2];
        }
        if (tTtg) lm += rTtg[tpl.ttgIdx];
        if (tHafu) lm += rHafu[tpl.hafuIdx];
        if (tCrs) lm += rCrs[tpl.crsIdx];
        logMult[i] = lm;
        if (lm > maxLm) maxLm = lm;
      }

      let sumP = 0;
      for (let i = 0; i < atomicLen; i++) {
        const v = Math.exp(logMult[i] - maxLm);
        atomicProbs[i] = v;
        sumP += v;
      }
      const invSum = 1 / sumP;
      for (let i = 0; i < atomicLen; i++) atomicProbs[i] *= invSum;
      logNormShift = maxLm + Math.log(sumP);
    }

    // Reconstruct coherent scoreGrid from projected atomicProbs so xG, card-pan & all 5 pools agree to 1e-16
    scoreGrid.fill(0);
    for (let cell = 0; cell < DC_GRID_LEN; cell++) {
      const baseMap = cell * 3;
      let cellMass = 0;
      for (let htCode = 0; htCode < 3; htCode++) {
        const aIdx = GRID_HT_TO_ATOMIC[baseMap + htCode];
        if (aIdx >= 0) {
          const priorCellHt = cellPriorHt[baseMap + htCode];
          const priorAtom = priorAtomic[aIdx];
          if (priorCellHt > 0 && priorAtom > 0) {
            cellMass += atomicProbs[aIdx] * (priorCellHt / priorAtom);
          }
        }
      }
      scoreGrid[cell] = cellMass;
    }
    let sgSum = 0;
    for (let cell = 0; cell < DC_GRID_LEN; cell++) sgSum += scoreGrid[cell];
    if (sgSum > 0) {
      const invSg = 1 / sgSum;
      for (let cell = 0; cell < DC_GRID_LEN; cell++) scoreGrid[cell] *= invSg;
    }
  } else if (sellingPoolCount === 1) {
    // Closed-form 1-step KL projection onto the sole selling pool's Shin marginal so fairProb, poolProbs & scoreGrid align to <1e-15
    const priorAtomic = SCRATCH_PRIOR_ATOMIC;
    for (let i = 0; i < atomicLen; i++) {
      priorAtomic[i] = Math.max(1e-14, atomicProbs[i]);
    }
    let singleTargetProbs = null;
    let bucketOf = null;
    if (hadTarget) {
      singleTargetProbs = hadTarget.probs;
      bucketOf = (tpl) => tpl.ftCode;
    } else if (hhadTarget) {
      singleTargetProbs = hhadTarget.probs;
      bucketOf = (tpl) => {
        const adj = tpl.goalDiff + goalLine;
        return adj > 0 ? 0 : adj === 0 ? 1 : 2;
      };
    } else if (ttgTarget) {
      singleTargetProbs = ttgTarget.probs;
      bucketOf = (tpl) => tpl.ttgIdx;
    } else if (hafuTarget) {
      singleTargetProbs = hafuTarget.probs;
      bucketOf = (tpl) => tpl.hafuIdx;
    } else if (crsTarget) {
      singleTargetProbs = crsTarget.probs;
      bucketOf = (tpl) => tpl.crsIdx;
    }
    if (singleTargetProbs && bucketOf) {
      const curMarg = new Float64Array(singleTargetProbs.length);
      for (let i = 0; i < atomicLen; i++) {
        curMarg[bucketOf(ATOMIC_TEMPLATES[i])] += priorAtomic[i];
      }
      let sumP = 0;
      for (let i = 0; i < atomicLen; i++) {
        const b = bucketOf(ATOMIC_TEMPLATES[i]);
        const ratio = curMarg[b] > 0 ? singleTargetProbs[b] / curMarg[b] : 0;
        const v = priorAtomic[i] * ratio;
        atomicProbs[i] = v;
        sumP += v;
      }
      if (sumP > 0) {
        const inv = 1 / sumP;
        for (let i = 0; i < atomicLen; i++) atomicProbs[i] *= inv;
      }
      scoreGrid.fill(0);
      for (let cell = 0; cell < DC_GRID_LEN; cell++) {
        const baseMap = cell * 3;
        let cellMass = 0;
        for (let htCode = 0; htCode < 3; htCode++) {
          const aIdx = GRID_HT_TO_ATOMIC[baseMap + htCode];
          if (aIdx >= 0) {
            const priorCellHt = cellPriorHt[baseMap + htCode];
            const priorAtom = priorAtomic[aIdx];
            if (priorCellHt > 0 && priorAtom > 0) {
              cellMass += atomicProbs[aIdx] * (priorCellHt / priorAtom);
            }
          }
        }
        scoreGrid[cell] = cellMass;
      }
      let sgSum = 0;
      for (let cell = 0; cell < DC_GRID_LEN; cell++) sgSum += scoreGrid[cell];
      if (sgSum > 0) {
        const invSg = 1 / sgSum;
        for (let cell = 0; cell < DC_GRID_LEN; cell++) scoreGrid[cell] *= invSg;
      }
    }
  }

  const hadArr = new Float64Array(3);
  const hhadArr = new Float64Array(3);
  const ttgArr = new Float64Array(8);
  const hafuArr = new Float64Array(9);
  const crsArr = new Float64Array(31);
  const atomicStates = new Array(atomicLen);

  for (let i = 0; i < atomicLen; i++) {
    const tpl = ATOMIC_TEMPLATES[i];
    const prob = atomicProbs[i];
    hadArr[tpl.ftCode] += prob;
    const adj = tpl.goalDiff + goalLine;
    hhadArr[adj > 0 ? 0 : adj === 0 ? 1 : 2] += prob;
    ttgArr[tpl.ttgIdx] += prob;
    hafuArr[tpl.hafuIdx] += prob;
    crsArr[tpl.crsIdx] += prob;
    atomicStates[i] = {
      ht: tpl.ht,
      ft: tpl.ft,
      homeGoals: tpl.homeGoals,
      awayGoals: tpl.awayGoals,
      goalDiff: tpl.goalDiff,
      totalGoals: tpl.totalGoals,
      ttgKey: tpl.ttgKey,
      hafuKey: tpl.hafuKey,
      crsKey: tpl.crsKey,
      prob,
    };
  }

  const ttgProbObj = {};
  for (let i = 0; i < 8; i++) ttgProbObj[TTG_KEY_ORDER[i]] = ttgArr[i];
  const hafuProbObj = {};
  for (let i = 0; i < 9; i++) hafuProbObj[HAFU_KEY_ORDER[i]] = hafuArr[i];
  const crsProbObj = {};
  for (let i = 0; i < 31; i++) crsProbObj[CRS_LABEL_ORDER[i]] = crsArr[i];

  const poolProbs = {
    HAD: { h: hadArr[0], d: hadArr[1], a: hadArr[2] },
    HHAD: { hh: hhadArr[0], hd: hhadArr[1], ha: hhadArr[2] },
    TTG: ttgProbObj,
    HAFU: hafuProbObj,
    CRS: crsProbObj,
  };

  // Build cloned pools with preserved raw payoutRatio & vig, single-pool shinProb, and coherent (or fallback) fairProb
  const calibratedPools = {};
  for (const code of ["HAD", "HHAD", "HAFU", "TTG", "CRS"]) {
    const srcPool = rawPools[code];
    if (!srcPool) continue;
    const isPoolValidSelling =
      srcPool.selling !== false &&
      Array.isArray(srcPool.options) &&
      srcPool.options.length > 0 &&
      srcPool.options.every((o) => Number.isFinite(o.odds) && o.odds > 0);

    if (!isPoolValidSelling) {
      calibratedPools[code] = {
        ...srcPool,
        options: Array.isArray(srcPool.options)
          ? srcPool.options.map((o) => ({ ...o }))
          : [],
      };
      continue;
    }

    const canonicalTarget =
      code === "HAD"
        ? hadTarget
        : code === "HHAD"
          ? hhadTarget
          : code === "TTG"
            ? ttgTarget
            : code === "HAFU"
              ? hafuTarget
              : crsTarget;
    const fallbackDevigProbs = canonicalTarget
      ? null
      : devigPoolProbabilities(srcPool.options, "shin").probs;
    const coherentMap = poolProbs[code];
    const canProjectPool = coherent && Boolean(canonicalTarget);

    calibratedPools[code] = {
      ...srcPool,
      options: srcPool.options.map((o, idx) => {
        const lookupKey = code === "CRS" ? o.label || o.key : o.key;
        const shinProb = canonicalTarget
          ? (canonicalTarget.shinByKey[lookupKey] ??
            canonicalTarget.shinByKey[o.label] ??
            0)
          : fallbackDevigProbs[idx];
        const projected = canProjectPool ? coherentMap[lookupKey] : undefined;
        return {
          ...o,
          shinProb,
          fairProb: typeof projected === "number" ? projected : shinProb,
        };
      }),
    };
  }

  return {
    coherent,
    sellingPoolCount,
    params: {
      lambdaHome: lamH,
      lambdaAway: lamA,
      rho,
      theta,
    },
    scoreGrid,
    atomicStates,
    poolProbs,
    pools: calibratedPools,
  };
}

const MATCH_CALIBRATION_CACHE = new WeakMap();
const CACHE_SIG_F64 = new Float64Array(1);
const CACHE_SIG_U32 = new Uint32Array(CACHE_SIG_F64.buffer);
const CACHE_POOL_CODES = ["HAD", "HHAD", "HAFU", "TTG", "CRS"];

function computeMatchPoolsFingerprint(match) {
  const pools = match?.pools;
  if (!pools) return { h1: 0, h2: 0, len: 0 };
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let len = 0;
  const mix = (val) => {
    h1 = Math.imul(h1 ^ val, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 + (val >>> 0), 0x85ebca6b) ^ (h1 >>> 13)) >>> 0;
  };
  const mixFloat = (f) => {
    CACHE_SIG_F64[0] = Number.isFinite(f) ? f : -999999.125;
    mix(CACHE_SIG_U32[0]);
    mix(CACHE_SIG_U32[1]);
  };
  const mixStr = (s) => {
    mix(s.length);
    for (let k = 0; k < s.length; k++) {
      mix(s.charCodeAt(k) | ((k & 0xff) << 16));
    }
  };
  for (let c = 0; c < 5; c++) {
    const p = pools[CACHE_POOL_CODES[c]];
    if (
      !p ||
      p.selling === false ||
      !Array.isArray(p.options) ||
      p.options.length === 0
    ) {
      mix(0x100 + c);
      continue;
    }
    const opts = p.options;
    const glNum = Number(p.goalLine);
    mix(
      (0x200 + c) | ((p.single ? 1 : 0) << 12) | ((opts.length & 0xff) << 16)
    );
    mixFloat(Number.isFinite(glNum) ? glNum : 0);
    mixStr(String(p.updateDate ?? ""));
    mixStr(String(p.updateTime ?? ""));
    len += opts.length;
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i];
      mixStr(String(o?.key ?? ""));
      mixStr(String(o?.label ?? ""));
      mixFloat(Number(o?.odds));
      mixFloat(o?.fairProb !== undefined ? Number(o.fairProb) : -1);
    }
  }
  return { h1, h2, len };
}

function getCachedMatchCalibration(match) {
  if (!match || typeof match !== "object") return null;
  const fp = computeMatchPoolsFingerprint(match);
  const cached = MATCH_CALIBRATION_CACHE.get(match);
  if (
    cached &&
    cached.h1 === fp.h1 &&
    cached.h2 === fp.h2 &&
    cached.len === fp.len
  ) {
    return cached.cal;
  }
  const cal = calibrateMatchCoherentModel(match);
  MATCH_CALIBRATION_CACHE.set(match, {
    h1: fp.h1,
    h2: fp.h2,
    len: fp.len,
    cal,
  });
  return cal;
}

const NEUTRAL_ATOMIC_PROBS = (() => {
  const grid = new Float64Array(DC_GRID_LEN);
  const binom = new Float64Array(DC_GRID_LEN);
  evalDixonColesGrid(1.38, 1.14, 0, grid);
  const out = new Float64Array(ATOMIC_TEMPLATES.length);
  expandScoreGridToAtomicProbs(grid, DEFAULT_HT_GOAL_SHARE, binom, out);
  return out;
})();

function resolveGoalLineNum(match, poolName) {
  const rawFromMatch = Number(match?.pools?.HHAD?.goalLine);
  if (Number.isFinite(rawFromMatch) && Math.trunc(rawFromMatch) !== 0) {
    return Math.trunc(rawFromMatch);
  }
  if (typeof poolName === "string") {
    const parsed = /\(([+-]?\d+)\)/.exec(poolName);
    if (parsed) {
      const n = Number(parsed[1]);
      if (Number.isFinite(n) && Math.trunc(n) !== 0) return Math.trunc(n);
    }
  }
  return -1;
}

function doesOptionHitAtomicTemplate(
  poolCode,
  optionKey,
  optionLabel,
  goalLineNum,
  tpl
) {
  if (poolCode === "HAD") {
    return tpl.ft === optionKey;
  }
  if (poolCode === "HHAD") {
    const adj = tpl.goalDiff + goalLineNum;
    const key = adj > 0 ? "hh" : adj === 0 ? "hd" : "ha";
    return key === optionKey;
  }
  if (poolCode === "TTG") {
    const norm = String(optionKey).startsWith("s")
      ? optionKey
      : `s${optionKey}`;
    return tpl.ttgKey === norm;
  }
  if (poolCode === "HAFU") {
    return tpl.hafuKey === optionKey;
  }
  if (poolCode === "CRS") {
    const idx =
      CRS_INDEX_BY_KEY.get(optionKey) ?? CRS_INDEX_BY_KEY.get(optionLabel);
    if (idx !== undefined) return tpl.crsIdx === idx;
    return tpl.crsKey === optionKey || tpl.crsKey === optionLabel;
  }
  return false;
}

function sumOptionProbOnAtomic(
  atomicProbs,
  poolCode,
  optionKey,
  optionLabel,
  goalLineNum
) {
  let s = 0;
  for (let i = 0; i < ATOMIC_TEMPLATES.length; i++) {
    if (
      doesOptionHitAtomicTemplate(
        poolCode,
        optionKey,
        optionLabel,
        goalLineNum,
        ATOMIC_TEMPLATES[i]
      )
    ) {
      s += atomicProbs[i];
    }
  }
  return s;
}

function alignAtomicProbsToPoolOptions(
  baseProbs,
  poolCode,
  options,
  goalLineNum
) {
  if (!Array.isArray(options) || options.length === 0) return baseProbs;
  const validOpts = options.filter(
    (o) => o && Number.isFinite(Number(o.fairProb)) && Number(o.fairProb) > 0
  );
  if (validOpts.length === 0) return baseProbs;

  let maxDrift = 0;
  for (const o of validOpts) {
    const cur = sumOptionProbOnAtomic(
      baseProbs,
      poolCode,
      o.key,
      o.label,
      goalLineNum
    );
    const d = Math.abs(cur - Number(o.fairProb));
    if (d > maxDrift) maxDrift = d;
  }
  if (maxDrift <= 1e-14) return baseProbs;

  const atomicLen = ATOMIC_TEMPLATES.length;
  const out = new Float64Array(baseProbs);
  const covered = new Uint8Array(atomicLen);
  let targetCoveredSum = 0;
  const rawTargetSum = validOpts.reduce(
    (acc, o) => acc + Number(o.fairProb),
    0
  );
  const targetScale =
    rawTargetSum > 1
      ? 1 / rawTargetSum
      : validOpts.length >=
            (poolCode === "HAD" || poolCode === "HHAD"
              ? 3
              : poolCode === "TTG"
                ? 8
                : poolCode === "HAFU"
                  ? 9
                  : 31) && Math.abs(rawTargetSum - 1) < 0.05
        ? 1 / rawTargetSum
        : Math.min(1, 0.999999 / Math.max(1e-9, rawTargetSum));

  for (const o of validOpts) {
    const targetP = Number(o.fairProb) * targetScale;
    let curSum = 0;
    for (let i = 0; i < atomicLen; i++) {
      if (
        doesOptionHitAtomicTemplate(
          poolCode,
          o.key,
          o.label,
          goalLineNum,
          ATOMIC_TEMPLATES[i]
        )
      ) {
        covered[i] = 1;
        curSum += baseProbs[i];
      }
    }
    if (curSum > 0) {
      const factor = targetP / curSum;
      for (let i = 0; i < atomicLen; i++) {
        if (
          doesOptionHitAtomicTemplate(
            poolCode,
            o.key,
            o.label,
            goalLineNum,
            ATOMIC_TEMPLATES[i]
          )
        ) {
          out[i] = baseProbs[i] * factor;
        }
      }
      targetCoveredSum += targetP;
    }
  }

  let uncovBaseSum = 0;
  for (let i = 0; i < atomicLen; i++) {
    if (!covered[i]) uncovBaseSum += baseProbs[i];
  }
  const remTarget = Math.max(0, 1 - targetCoveredSum);
  if (uncovBaseSum > 0) {
    const uncovFactor = remTarget / uncovBaseSum;
    for (let i = 0; i < atomicLen; i++) {
      if (!covered[i]) out[i] = baseProbs[i] * uncovFactor;
    }
  }

  let total = 0;
  for (let i = 0; i < atomicLen; i++) total += out[i];
  if (total > 0) {
    const inv = 1 / total;
    for (let i = 0; i < atomicLen; i++) out[i] *= inv;
  }
  return out;
}

function getMatchBaseAtomicProbs(match, preferredPools = null) {
  if (!match) return new Float64Array(NEUTRAL_ATOMIC_PROBS);
  const cal = getCachedMatchCalibration(match);
  const atomicLen = ATOMIC_TEMPLATES.length;
  let probs = new Float64Array(atomicLen);
  for (let i = 0; i < atomicLen; i++) probs[i] = cal.atomicStates[i].prob;

  const gl = resolveGoalLineNum(match);
  const checkCodes =
    Array.isArray(preferredPools) && preferredPools.length > 0
      ? Array.from(new Set(preferredPools))
      : ["HAD", "HHAD", "TTG", "HAFU", "CRS"];

  // When coherent >= 2 pools AND caller inspects multiple pools on the same match,
  // cal.atomicStates is already the unique cross-pool coherent distribution.
  if (cal.coherent && checkCodes.length > 1) {
    return probs;
  }

  for (const code of checkCodes) {
    const pool = match.pools?.[code];
    if (
      !pool ||
      pool.selling === false ||
      !Array.isArray(pool.options) ||
      pool.options.length === 0
    ) {
      continue;
    }
    probs = alignAtomicProbsToPoolOptions(probs, code, pool.options, gl);
  }
  return probs;
}

function alignMatchlessAtomicToLegs(legsOnMatch, gl) {
  const atomicLen = ATOMIC_TEMPLATES.length;
  let probs = new Float64Array(NEUTRAL_ATOMIC_PROBS);
  if (!Array.isArray(legsOnMatch) || legsOnMatch.length === 0) return probs;

  const poolOrder = { HAD: 1, HHAD: 2, TTG: 3, HAFU: 4, CRS: 5 };
  const byPool = new Map();
  for (const lg of legsOnMatch) {
    const arr = byPool.get(lg.poolCode) ?? [];
    if (!arr.some((x) => x.optionKey === lg.optionKey)) {
      arr.push({
        key: lg.optionKey,
        label: lg.optionLabel,
        fairProb: lg.fairProb,
      });
    }
    byPool.set(lg.poolCode, arr);
  }
  const orderedPools = Array.from(byPool.keys()).sort(
    (a, b) => (poolOrder[a] ?? 9) - (poolOrder[b] ?? 9)
  );
  if (orderedPools.length === 1) {
    return alignAtomicProbsToPoolOptions(
      probs,
      orderedPools[0],
      byPool.get(orderedPools[0]),
      gl
    );
  }

  // Iterative Proportional Fitting (IPF) across coarse and fine pools for synthetic matchless fixtures
  for (let iter = 0; iter < 14; iter++) {
    for (const pCode of orderedPools) {
      probs = alignAtomicProbsToPoolOptions(
        probs,
        pCode,
        byPool.get(pCode),
        gl
      );
    }
  }
  return probs;
}

function alignMultiPoolAtomicToTiltedLegs(baseProbs, mLegs, gl) {
  if (!Array.isArray(mLegs) || mLegs.length === 0) return baseProbs;
  const refLeg = mLegs[0];
  const baseRefP = sumOptionProbOnAtomic(
    baseProbs,
    refLeg.poolCode,
    refLeg.optionKey,
    refLeg.optionLabel,
    gl
  );
  if (!(
    baseRefP > 1e-6 && Math.abs(baseRefP - Number(refLeg.fairProb)) > 1e-5
  )) {
    return baseProbs;
  }
  const atomicLen = ATOMIC_TEMPLATES.length;
  const hitMask = new Uint8Array(atomicLen);
  let baseUnion = 0;
  for (let i = 0; i < atomicLen; i++) {
    const tpl = ATOMIC_TEMPLATES[i];
    for (const g of mLegs) {
      if (
        doesOptionHitAtomicTemplate(
          g.poolCode,
          g.optionKey,
          g.optionLabel,
          gl,
          tpl
        )
      ) {
        hitMask[i] = 1;
        baseUnion += baseProbs[i];
        break;
      }
    }
  }
  const scaleRatio = Number(refLeg.fairProb) / baseRefP;
  const targetUnion = Math.min(0.999, Math.max(0.001, baseUnion * scaleRatio));
  if (!(baseUnion > 0 && baseUnion < 0.999)) return baseProbs;
  const hitScale = targetUnion / baseUnion;
  const missScale = (1 - targetUnion) / (1 - baseUnion);
  const shifted = new Float64Array(atomicLen);
  let s = 0;
  for (let i = 0; i < atomicLen; i++) {
    shifted[i] = baseProbs[i] * (hitMask[i] ? hitScale : missScale);
    s += shifted[i];
  }
  if (s > 0) for (let i = 0; i < atomicLen; i++) shifted[i] /= s;
  return shifted;
}

function computeCapitalWeightedVig(lines, matches) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { avgPayoutRatio: 0.88, vigPct: 12.0 };
  }
  const matchById = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m?.id) matchById.set(m.id, m);
    }
  }
  let weightedRatioSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const w = Math.max(0, Number(l.cost ?? (Number(l.multiple) || 1) * 2));
    if (w <= 0) continue;
    const legs = Array.isArray(l.legs) ? l.legs : [];
    let lineRatio = 1;
    for (let j = 0; j < legs.length; j++) {
      const lg = legs[j];
      if (Number(lg.odds) === 1.0) continue;
      const fm = matchById.get(lg.matchId);
      const poolRatio = fm?.pools?.[lg.poolCode]?.payoutRatio;
      lineRatio *=
        typeof poolRatio === "number" &&
        Number.isFinite(poolRatio) &&
        poolRatio > 0
          ? Math.min(1, poolRatio)
          : lg.poolCode === "CRS"
            ? 0.76
            : lg.poolCode === "HAFU"
              ? 0.78
              : lg.poolCode === "TTG"
                ? 0.82
                : 0.88;
    }
    weightedRatioSum += w * lineRatio;
    totalWeight += w;
  }
  const avgPayoutRatio =
    totalWeight > 0 ? weightedRatioSum / totalWeight : 0.88;
  const vigPct = Number((Math.max(0, 1 - avgPayoutRatio) * 100).toFixed(1));
  return { avgPayoutRatio, vigPct };
}

/**
 * 商状态压缩联合状态空间评估核（Ω̃ = ∏ Ω̃_m）：
 * - 单场 139 个物理相容 (半场, 全场比分) 原子态按候选腿命中签名折叠为极小互斥商状态集 Ω̃_m（∑P = 1）；
 * - 当 M <= 8 且 |Ω̃| <= 16,384 时使用 32 位位掩码剪枝 DFS 100% 精确遍历全部联合状态，汇总同时命中的全部实票派奖；
 * - 确保所有输出 combos 严格互斥，恒满足 0 <= realProfitProb <= anyWinProb <= 1 且线性数学期望零误差。
 */
function canonicalTicketLegSig(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return "";
  if (legs.length === 1) {
    const g = legs[0];
    return `${g.matchId}\0${g.poolCode}\0${g.optionKey}`;
  }
  return legs
    .map((g) => `${g.matchId}\0${g.poolCode}\0${g.optionKey}`)
    .sort()
    .join("&");
}

function evaluateMetricsViaHitMatrix(hitMatrix, ticketRows, totalCost) {
  const K = ticketRows.length;
  if (!hitMatrix || hitMatrix.K !== K) return null;
  const origPayouts = new Float64Array(K);
  const seenOrig = new Uint8Array(K);
  for (let r = 0; r < K; r++) {
    const sig = canonicalTicketLegSig(ticketRows[r].legs);
    const origK = hitMatrix.sigToOrigIdx.get(sig);
    if (origK === undefined || seenOrig[origK] !== 0) return null;
    seenOrig[origK] = 1;
    origPayouts[origK] = Number(ticketRows[r].totalPayout || 0);
  }

  let exactExpectedReturn = 0;
  for (let k = 0; k < K; k++) {
    exactExpectedReturn += hitMatrix.origTicketProbs[k] * origPayouts[k];
  }
  const exactExpectedValueRate =
    totalCost > 0 ? (exactExpectedReturn - totalCost) / totalCost : 0;

  const B = hitMatrix.bucketProbs.length;
  const activeTiers = new Array(B);
  for (let b = 0; b < B; b++) {
    const hits = hitMatrix.bucketHits[b];
    let sum = 0;
    for (let j = 0; j < hits.length; j++) {
      sum += origPayouts[hits[j]];
    }
    const totalPayout = Math.round(sum * 100) / 100;
    const diffCents = Math.round((totalPayout - totalCost) * 100);
    activeTiers[b] = {
      prob: hitMatrix.bucketProbs[b],
      totalPayout,
      isUnderwater: diffCents < 0,
      isBreakEven: diffCents === 0,
    };
  }
  activeTiers.sort((a, b) => a.totalPayout - b.totalPayout);

  let anyWinSum = 0;
  let profitSum = 0;
  let breakEvenSum = 0;
  let underwaterCount = 0;
  let underwaterProbSum = 0;
  for (let i = 0; i < B; i++) {
    const c = activeTiers[i];
    anyWinSum += c.prob;
    if (c.isUnderwater) {
      underwaterCount += 1;
      underwaterProbSum += c.prob;
    } else {
      profitSum += c.prob;
      if (c.isBreakEven) breakEvenSum += c.prob;
    }
  }
  const anyWinProb = Math.min(1, Math.max(0, anyWinSum));
  const realProfitProb = Math.min(anyWinProb, Math.max(0, profitSum));
  const allNonUwBreakEven =
    B > 0 && activeTiers.every((c) => c.isUnderwater || c.isBreakEven);
  const breakEvenProb = allNonUwBreakEven
    ? realProfitProb
    : Math.min(realProfitProb, Math.max(0, breakEvenSum));
  const strictNetGainProb = allNonUwBreakEven
    ? 0
    : Math.max(0, realProfitProb - breakEvenProb);
  const minPayout = activeTiers[0]?.totalPayout ?? 0;
  const maxPayout = activeTiers[B - 1]?.totalPayout ?? 0;
  const underwaterShareOfWins =
    anyWinProb > 0
      ? Math.min(1, Math.max(0, underwaterProbSum / anyWinProb))
      : 0;

  const byProbDesc = [...activeTiers].sort((a, b) => b.prob - a.prob);
  const topHalf = byProbDesc.slice(
    0,
    Math.max(1, Math.ceil(byProbDesc.length * 0.6))
  );
  const rawLikelyMin = topHalf.length
    ? Math.min(...topHalf.map((c) => c.totalPayout))
    : 0;
  const rawLikelyMax = topHalf.length
    ? Math.max(...topHalf.map((c) => c.totalPayout))
    : 0;
  const likelyMin = B > 0 ? Math.max(minPayout, rawLikelyMin) : 0;
  const likelyMax =
    B > 0 ? Math.min(maxPayout, Math.max(likelyMin, rawLikelyMax)) : 0;

  return {
    combos: [],
    tiers: activeTiers,
    anyWinProb,
    realProfitProb,
    strictNetGainProb,
    breakEvenProb,
    minPayout,
    maxPayout,
    expectedReturn: exactExpectedReturn,
    expectedValueRate: exactExpectedValueRate,
    underwaterCount,
    underwaterShareOfWins,
    likelyRange: [likelyMin, likelyMax],
  };
}

function evaluateTicketsOnQuotientSpace(
  ticketRows,
  totalCost,
  matches,
  matchAtomicMap = null,
  options = null
) {
  if (!Array.isArray(ticketRows) || ticketRows.length === 0) {
    return {
      combos: [],
      anyWinProb: 0,
      realProfitProb: 0,
      strictNetGainProb: 0,
      breakEvenProb: 0,
      minPayout: 0,
      maxPayout: 0,
      expectedReturn: 0,
      expectedValueRate: 0,
      underwaterCount: 0,
      underwaterShareOfWins: 0,
      likelyRange: [0, 0],
      tiers: [],
    };
  }
  const metricsOnly = Boolean(options?.metricsOnly);
  const reusableHitMatrix = options?.reusableHitMatrix ?? null;
  if (
    metricsOnly &&
    reusableHitMatrix &&
    reusableHitMatrix.matchesRef === matches &&
    reusableHitMatrix.K === ticketRows.length
  ) {
    const fastRes = evaluateMetricsViaHitMatrix(
      reusableHitMatrix,
      ticketRows,
      totalCost
    );
    if (fastRes) return fastRes;
  }

  const K = ticketRows.length;
  const matchOrder = [];
  const matchIndexMap = new Map();
  const distinctOptsByMatch = [];

  for (let k = 0; k < K; k++) {
    const legs = ticketRows[k].legs || [];
    for (let i = 0; i < legs.length; i++) {
      const lg = legs[i];
      let mIdx = matchIndexMap.get(lg.matchId);
      if (mIdx === undefined) {
        mIdx = matchOrder.length;
        matchIndexMap.set(lg.matchId, mIdx);
        matchOrder.push(lg.matchId);
        distinctOptsByMatch.push([]);
      }
      const optList = distinctOptsByMatch[mIdx];
      if (
        !optList.some(
          (o) => o.poolCode === lg.poolCode && o.optionKey === lg.optionKey
        )
      ) {
        optList.push(lg);
      }
    }
  }

  const M = matchOrder.length;
  const atomicLen = ATOMIC_TEMPLATES.length;
  const quotientByMatch = new Array(M);

  for (let m = 0; m < M; m++) {
    const mid = matchOrder[m];
    const opts = distinctOptsByMatch[m];
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === mid)
      : null;
    const gl = resolveGoalLineNum(
      fm,
      opts.find((o) => o.poolCode === "HHAD")?.poolName
    );

    let atomicProbs = matchAtomicMap?.get(mid) ?? null;
    if (!atomicProbs) {
      const poolCodes = Array.from(new Set(opts.map((o) => o.poolCode)));
      if (!fm) {
        atomicProbs = alignMatchlessAtomicToLegs(opts, gl);
      } else if (poolCodes.length === 1) {
        const base = getMatchBaseAtomicProbs(fm, poolCodes);
        const pseudoOpts = opts.map((o) => ({
          key: o.optionKey,
          label: o.optionLabel,
          fairProb: o.fairProb,
        }));
        atomicProbs = alignAtomicProbsToPoolOptions(
          base,
          poolCodes[0],
          pseudoOpts,
          gl
        );
      } else {
        atomicProbs = getMatchBaseAtomicProbs(fm, poolCodes);
      }
    }

    const r = opts.length;
    const useBigMask = r > 30;
    const bySig = new Map();
    for (let a = 0; a < atomicLen; a++) {
      const p = atomicProbs[a];
      if (!(p > 0)) continue;
      const tpl = ATOMIC_TEMPLATES[a];
      if (!useBigMask) {
        let mask = 0;
        for (let j = 0; j < r; j++) {
          const o = opts[j];
          if (
            doesOptionHitAtomicTemplate(
              o.poolCode,
              o.optionKey,
              o.optionLabel,
              gl,
              tpl
            )
          ) {
            mask |= 1 << j;
          }
        }
        const prev = bySig.get(mask);
        if (prev) prev.prob += p;
        else bySig.set(mask, { mask, prob: p });
      } else {
        let mask = 0n;
        for (let j = 0; j < r; j++) {
          const o = opts[j];
          if (
            doesOptionHitAtomicTemplate(
              o.poolCode,
              o.optionKey,
              o.optionLabel,
              gl,
              tpl
            )
          ) {
            mask |= 1n << BigInt(j);
          }
        }
        const prev = bySig.get(mask);
        if (prev) prev.prob += p;
        else bySig.set(mask, { mask, prob: p });
      }
    }

    const qStates = [];
    let qSum = 0;
    for (const item of bySig.values()) {
      qSum += item.prob;
      const hitSet = new Set();
      if (!useBigMask) {
        for (let j = 0; j < r; j++) {
          if ((item.mask & (1 << j)) !== 0) hitSet.add(j);
        }
      } else {
        for (let j = 0; j < r; j++) {
          if ((item.mask & (1n << BigInt(j))) !== 0n) hitSet.add(j);
        }
      }
      qStates.push({ prob: item.prob, hitSet });
    }
    if (qSum > 0 && Math.abs(qSum - 1) > 1e-14) {
      for (const qs of qStates) qs.prob /= qSum;
    }
    quotientByMatch[m] = qStates;
  }

  // Ticket-match leg lookup: ticketOptIdx[k * M + m] = index in distinctOptsByMatch[m], or -1 if ticket k doesn't involve match m
  const ticketOptIdx = new Int16Array(K * M).fill(-1);
  let isAllSingleTickets = true;
  for (let k = 0; k < K; k++) {
    const legs = ticketRows[k].legs || [];
    if (legs.length !== 1) isAllSingleTickets = false;
    for (let i = 0; i < legs.length; i++) {
      const lg = legs[i];
      const mIdx = matchIndexMap.get(lg.matchId);
      const jIdx = distinctOptsByMatch[mIdx].findIndex(
        (o) => o.poolCode === lg.poolCode && o.optionKey === lg.optionKey
      );
      ticketOptIdx[k * M + mIdx] = jIdx;
    }
  }

  // Exact per-match option probabilities on uncompressed quotient space Ω̃_m -> zero-approximation linear EV
  const matchOptProb = quotientByMatch.map((qStates, m) => {
    const r = distinctOptsByMatch[m].length;
    const probs = new Float64Array(r);
    for (let s = 0; s < qStates.length; s++) {
      const p = qStates[s].prob;
      for (const j of qStates[s].hitSet) {
        probs[j] += p;
      }
    }
    return probs;
  });

  const origTicketProbs = new Float64Array(K);
  let exactExpectedReturn = 0;
  for (let k = 0; k < K; k++) {
    let pTicket = 1;
    for (let m = 0; m < M; m++) {
      const jIdx = ticketOptIdx[k * M + m];
      if (jIdx >= 0) {
        pTicket *= matchOptProb[m][jIdx];
        if (pTicket === 0) break;
      }
    }
    origTicketProbs[k] = pTicket;
    exactExpectedReturn += pTicket * Number(ticketRows[k].totalPayout || 0);
  }
  const exactExpectedValueRate =
    totalCost > 0 ? (exactExpectedReturn - totalCost) / totalCost : 0;

  let prodSize = 1;
  for (let m = 0; m < M; m++) {
    prodSize *= quotientByMatch[m].length;
    if (prodSize > 1_000_000_000) break;
  }

  // Case B: pure single-pass matches -> Exact integer-cent 1D DP + mutually-exclusive payout-tier combos
  if (isAllSingleTickets && (M > 8 || prodSize > 65_536)) {
    const gcdInt = (a, b) => {
      let x = Math.abs(Math.trunc(a));
      let y = Math.abs(Math.trunc(b));
      while (y !== 0) {
        const t = x % y;
        x = y;
        y = t;
      }
      return x;
    };
    const totalCostCents = Math.max(0, Math.round(totalCost * 100));
    let stepGcd = totalCostCents;

    const perMatchDist = quotientByMatch.map((qStates, m) => {
      const mTickets = [];
      for (let k = 0; k < K; k++) {
        const jIdx = ticketOptIdx[k * M + m];
        if (jIdx >= 0) mTickets.push({ k, jIdx, row: ticketRows[k] });
      }
      let missProb = 0;
      const winOutcomes = [];
      for (const qs of qStates) {
        const hits = mTickets
          .filter((mt) => qs.hitSet.has(mt.jIdx))
          .map((mt) => mt.row);
        if (hits.length === 0) {
          missProb += qs.prob;
        } else {
          const totalPay = hits.reduce((a, w) => a + w.totalPayout, 0);
          const payCents = Math.max(0, Math.round(totalPay * 100));
          if (payCents > 0) stepGcd = gcdInt(stepGcd, payCents);
          winOutcomes.push({
            prob: qs.prob,
            legs: hits.flatMap((w) => w.legs || []),
            payCents,
            unitPayout: hits.reduce((a, w) => a + w.unitPayout, 0),
            totalPayout: payCents / 100,
            cappedClipped: hits.reduce((a, w) => a + w.cappedClipped, 0),
          });
        }
      }
      return { missProb, winOutcomes };
    });

    const unitDiv = Math.max(1, stepGcd);
    const costUnits = Math.round(totalCostCents / unitDiv);

    const mergeDpBucket = (
      map,
      key,
      prob,
      expPay,
      expUnit,
      expClip,
      minCents,
      maxCents,
      minHits,
      maxHits,
      legs
    ) => {
      if (!(prob > 0)) return;
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          prob,
          expPay,
          expUnit,
          expClip,
          minCents,
          maxCents,
          minHits,
          maxHits,
          legs,
          bestProb: prob,
        });
      } else {
        if (prob > cur.bestProb) {
          cur.bestProb = prob;
          cur.legs = legs;
        }
        cur.prob += prob;
        cur.expPay += expPay;
        cur.expUnit += expUnit;
        cur.expClip += expClip;
        if (minCents < cur.minCents) cur.minCents = minCents;
        if (maxCents > cur.maxCents) cur.maxCents = maxCents;
        if (minHits < cur.minHits) cur.minHits = minHits;
        if (maxHits > cur.maxHits) cur.maxHits = maxHits;
      }
    };

    const keyForState = (minCents, maxCents) => {
      if (maxCents === 0) return 0;
      if (minCents === totalCostCents && maxCents === totalCostCents) {
        return -2_000_000_000;
      }
      if (maxCents < totalCostCents) {
        if (minCents === maxCents && costUnits <= 8192) {
          return Math.round(minCents / unitDiv);
        }
        const u = Math.floor(maxCents / Math.max(1, unitDiv));
        const safeCap = Math.max(1, costUnits - 1);
        return (
          -1 -
          Math.min(
            2047,
            Math.floor(((safeCap - Math.min(safeCap, u)) / safeCap) * 2048)
          )
        );
      }
      if (
        minCents === maxCents &&
        costUnits <= 8192 &&
        minCents <= totalCostCents * 4
      ) {
        return Math.round(minCents / unitDiv);
      }
      const excessUnits = Math.max(
        0,
        (minCents - totalCostCents) / Math.max(1, unitDiv)
      );
      const tier = Math.min(95, Math.floor(Math.log1p(excessUnits) * 10));
      return costUnits + 1_000_000 + tier;
    };

    let dp = new Map([
      [
        0,
        {
          prob: 1,
          expPay: 0,
          expUnit: 0,
          expClip: 0,
          minCents: 0,
          maxCents: 0,
          minHits: 0,
          maxHits: 0,
          legs: [],
          bestProb: 1,
        },
      ],
    ]);

    for (const d of perMatchDist) {
      const nextDp = new Map();
      for (const prev of dp.values()) {
        if (d.missProb > 0) {
          const pMiss = prev.prob * d.missProb;
          const kMiss = keyForState(prev.minCents, prev.maxCents);
          mergeDpBucket(
            nextDp,
            kMiss,
            pMiss,
            prev.expPay * d.missProb,
            prev.expUnit * d.missProb,
            prev.expClip * d.missProb,
            prev.minCents,
            prev.maxCents,
            prev.minHits,
            prev.maxHits,
            prev.legs
          );
        }
        for (const wo of d.winOutcomes) {
          const pHit = prev.prob * wo.prob;
          if (!(pHit > 0)) continue;
          const newMinCents = prev.minCents + wo.payCents;
          const newMaxCents = prev.maxCents + wo.payCents;
          const kHit = keyForState(newMinCents, newMaxCents);
          const mergedLegs =
            prev.legs.length === 0
              ? wo.legs
              : prev.legs.length < 16
                ? [...prev.legs, ...wo.legs]
                : prev.legs;
          mergeDpBucket(
            nextDp,
            kHit,
            pHit,
            prev.expPay * wo.prob + pHit * wo.totalPayout,
            prev.expUnit * wo.prob + pHit * wo.unitPayout,
            prev.expClip * wo.prob + pHit * wo.cappedClipped,
            newMinCents,
            newMaxCents,
            prev.minHits + 1,
            prev.maxHits + 1,
            mergedLegs
          );
        }
      }

      // Keep profitable upper-set [totalCostCents, inf) compact while preserving exact maxCents singleton
      if (nextDp.size > 512) {
        const compactDp = new Map();
        let globalMaxProfCents = -1;
        for (const b of nextDp.values()) {
          if (b.minCents >= totalCostCents && b.maxCents > globalMaxProfCents) {
            globalMaxProfCents = b.maxCents;
          }
        }
        for (const [k, b] of nextDp.entries()) {
          if (
            b.maxCents < totalCostCents ||
            (b.minCents === totalCostCents && b.maxCents === totalCostCents) ||
            (b.minCents === b.maxCents && b.maxCents === globalMaxProfCents)
          ) {
            mergeDpBucket(
              compactDp,
              k,
              b.prob,
              b.expPay,
              b.expUnit,
              b.expClip,
              b.minCents,
              b.maxCents,
              b.minHits,
              b.maxHits,
              b.legs
            );
          } else {
            const excessUnits = Math.max(
              0,
              (b.minCents - totalCostCents) / Math.max(1, unitDiv)
            );
            const tier = Math.min(63, Math.floor(Math.log1p(excessUnits) * 8));
            mergeDpBucket(
              compactDp,
              costUnits + 2_000_000 + tier,
              b.prob,
              b.expPay,
              b.expUnit,
              b.expClip,
              b.minCents,
              b.maxCents,
              b.minHits,
              b.maxHits,
              b.legs
            );
          }
        }
        dp = compactDp;
      } else {
        dp = nextDp;
      }
    }

    // Partition final winning DP buckets into <= 64 mutually-exclusive combos strictly separated at totalCostCents
    const rawWinBuckets = Array.from(dp.values()).filter(
      (b) => b.maxCents > 0 && b.prob > 0
    );
    let finalBuckets = rawWinBuckets;
    if (rawWinBuckets.length > 64) {
      let minWinCents = Infinity;
      let maxWinCents = 0;
      for (const b of rawWinBuckets) {
        if (b.minCents < minWinCents) minWinCents = b.minCents;
        if (b.maxCents > maxWinCents) maxWinCents = b.maxCents;
      }
      const folded = new Map();
      for (const b of rawWinBuckets) {
        let fKey;
        if (b.minCents === totalCostCents && b.maxCents === totalCostCents) {
          fKey = "BE";
        } else if (b.minCents === minWinCents && b.maxCents === minWinCents) {
          fKey = "MIN";
        } else if (b.minCents === maxWinCents && b.maxCents === maxWinCents) {
          fKey = "MAX";
        } else if (b.maxCents < totalCostCents) {
          const span = Math.max(1, totalCostCents - minWinCents);
          const t = Math.min(
            23,
            Math.floor(((b.minCents - minWinCents) / span) * 24)
          );
          fKey = `U${t}`;
        } else {
          const span = Math.max(1, maxWinCents - totalCostCents);
          const t = Math.min(
            37,
            Math.floor(
              (Math.log1p(b.minCents - totalCostCents) / Math.log1p(span)) * 38
            )
          );
          fKey = `P${t}`;
        }
        mergeDpBucket(
          folded,
          fKey,
          b.prob,
          b.expPay,
          b.expUnit,
          b.expClip,
          b.minCents,
          b.maxCents,
          b.minHits,
          b.maxHits,
          b.legs
        );
      }
      finalBuckets = Array.from(folded.values());
    }

    finalBuckets.sort((a, b) => a.expPay / a.prob - b.expPay / b.prob);
    const combos = finalBuckets.map((b, idx) => {
      const isSingleton = b.minCents === b.maxCents;
      const totalPayout = isSingleton ? b.minCents / 100 : b.expPay / b.prob;
      const unitPayout = b.expUnit / b.prob;
      const cappedClipped = b.expClip / b.prob;
      const isUnderwater = b.maxCents < totalCostCents;
      const netProfit = totalPayout - totalCost;
      const hitDesc =
        b.minHits === M && b.maxHits === M
          ? `单关${M}场全红(${b.legs.length}注齐中)`
          : b.minHits === 1 && b.maxHits === 1 && isSingleton
            ? `单关仅中1场 · ${b.legs
                .slice(0, 4)
                .map(
                  (i) =>
                    `${i.matchNumStr}[${i.optionLabel}@${Number(i.odds).toFixed(2)}]`
                )
                .join("+")}`
            : b.minHits === b.maxHits
              ? `单关命中${b.minHits}场 · 派奖${isSingleton ? `¥${totalPayout.toFixed(2)}` : `区间 ¥${(b.minCents / 100).toFixed(2)}~¥${(b.maxCents / 100).toFixed(2)}`}`
              : `单关命中${b.minHits}~${b.maxHits}场 · 派奖区间 ¥${(b.minCents / 100).toFixed(2)}~¥${(b.maxCents / 100).toFixed(2)}`;
      return {
        id: `c-sgl-${idx}`,
        desc: hitDesc,
        legs: b.legs,
        prob: b.prob,
        unitPayout,
        totalPayout,
        cappedClipped,
        netProfit,
        isUnderwater,
      };
    });

    const anyWinProb = Math.min(
      1,
      Math.max(
        0,
        combos.reduce((acc, c) => acc + c.prob, 0)
      )
    );
    const realProfitProb = Math.min(
      anyWinProb,
      Math.max(
        0,
        combos
          .filter((c) => !c.isUnderwater)
          .reduce((acc, c) => acc + c.prob, 0)
      )
    );
    const rawSglBreakEven = combos
      .filter(
        (c) =>
          !c.isUnderwater && Math.round((c.totalPayout - totalCost) * 100) === 0
      )
      .reduce((acc, c) => acc + c.prob, 0);
    const allSglBreakEven =
      combos.length > 0 &&
      combos.every(
        (c) =>
          c.isUnderwater || Math.round((c.totalPayout - totalCost) * 100) === 0
      );
    const breakEvenProb = allSglBreakEven
      ? realProfitProb
      : Math.min(realProfitProb, Math.max(0, rawSglBreakEven));
    const strictNetGainProb = allSglBreakEven
      ? 0
      : Math.max(0, realProfitProb - breakEvenProb);
    const minPayout =
      combos.length > 0
        ? Math.min(...finalBuckets.map((b) => b.minCents)) / 100
        : 0;
    const maxPayout =
      combos.length > 0
        ? Math.max(...finalBuckets.map((b) => b.maxCents)) / 100
        : 0;
    const expectedReturn = exactExpectedReturn;
    const expectedValueRate = exactExpectedValueRate;
    const underwaterCount = combos.filter((c) => c.isUnderwater).length;
    const underwaterProbSum = combos
      .filter((c) => c.isUnderwater)
      .reduce((acc, c) => acc + c.prob, 0);
    const underwaterShareOfWins =
      anyWinProb > 0
        ? Math.min(1, Math.max(0, underwaterProbSum / anyWinProb))
        : 0;

    const byProbDesc = [...combos].sort((a, b) => b.prob - a.prob);
    const topHalf = byProbDesc.slice(
      0,
      Math.max(1, Math.ceil(byProbDesc.length * 0.6))
    );
    const rawLikelyMin = topHalf.length
      ? Math.min(...topHalf.map((c) => c.totalPayout))
      : 0;
    const rawLikelyMax = topHalf.length
      ? Math.max(...topHalf.map((c) => c.totalPayout))
      : 0;
    const likelyMin = combos.length ? Math.max(minPayout, rawLikelyMin) : 0;
    const likelyMax = combos.length
      ? Math.min(maxPayout, Math.max(likelyMin, rawLikelyMax))
      : 0;

    return {
      combos: metricsOnly ? [] : combos,
      tiers: combos,
      anyWinProb,
      realProfitProb,
      strictNetGainProb,
      breakEvenProb,
      minPayout,
      maxPayout,
      expectedReturn,
      expectedValueRate,
      underwaterCount,
      underwaterShareOfWins,
      likelyRange: [likelyMin, likelyMax],
    };
  }

  // Exact Bilinear Meet-in-the-Middle for <=2,048-bet Cartesian <=2-leg single-pool-per-match slips (e.g. 8x5 / 8x6 / 8x8 TTG 2串1 up to 43M states in <10ms with 0 lossy merge);
  // <=512-line mutually-exclusive bonus plans stay exact up to 400k states (covering 5^8 = 390,625), while untrusted <=64-line snapshotPlan inputs cap strictly at 131,072 states (<10ms DoS-safe).
  const isMutuallyExclusivePerMatch = quotientByMatch.every((qs) =>
    qs.every((q) => q.hitSet.size <= 1)
  );
  const EXACT_JOINT_STATE_CAP =
    isMutuallyExclusivePerMatch && K > 64 && K <= 512 ? 400_000 : 131_072;
  let maxTicketLegs = 0;
  let twoLegCount = 0;
  let firstTwoLegMult = -1;
  let allTwoLegSameMult = true;
  for (let k = 0; k < K; k++) {
    let lc = 0;
    for (let m = 0; m < M; m++) {
      if (ticketOptIdx[k * M + m] >= 0) lc++;
    }
    if (lc > maxTicketLegs) maxTicketLegs = lc;
    if (lc === 2) {
      twoLegCount++;
      const mult = Number(ticketRows[k].multiple || 1);
      if (firstTwoLegMult < 0) firstTwoLegMult = mult;
      else if (mult !== firstTwoLegMult) allTwoLegSameMult = false;
    }
  }
  let expectedCartesianPairs = 0;
  if (isMutuallyExclusivePerMatch && maxTicketLegs === 2) {
    const hitCounts = quotientByMatch.map((qs) => {
      const seen = new Set();
      for (const q of qs) {
        if (q.hitSet.size === 1) seen.add(q.hitSet.values().next().value);
      }
      return seen.size;
    });
    for (let i = 0; i < M; i++) {
      for (let j = i + 1; j < M; j++) {
        expectedCartesianPairs += hitCounts[i] * hitCounts[j];
      }
    }
  }
  const canUseExactBilinearMitm =
    !isAllSingleTickets &&
    isMutuallyExclusivePerMatch &&
    M >= 2 &&
    M <= 8 &&
    K <= 2048 &&
    maxTicketLegs === 2 &&
    allTwoLegSameMult &&
    twoLegCount > 0 &&
    twoLegCount === expectedCartesianPairs &&
    prodSize > EXACT_JOINT_STATE_CAP;

  let evalQuotient = quotientByMatch;
  let compressedPerMatch = false;
  if (
    !canUseExactBilinearMitm &&
    (prodSize > EXACT_JOINT_STATE_CAP || (M > 8 && !isAllSingleTickets))
  ) {
    compressedPerMatch = true;
    const matchBuckets = quotientByMatch.map((qStates, m) => {
      let missProb = 0;
      const wins = [];
      for (const qs of qStates) {
        if (qs.hitSet.size === 0) {
          missProb += qs.prob;
        } else {
          let maxOdds = 0;
          for (const j of qs.hitSet) {
            const o = distinctOptsByMatch[m][j];
            if (o && o.odds > maxOdds) maxOdds = o.odds;
          }
          wins.push({ prob: qs.prob, hitSet: qs.hitSet, meanOdds: maxOdds });
        }
      }
      wins.sort((a, b) => a.meanOdds - b.meanOdds);
      return { missProb, wins };
    });

    const calcBucketProd = () => {
      let p = 1;
      for (let i = 0; i < matchBuckets.length; i++) {
        const len =
          (matchBuckets[i].missProb > 0 ? 1 : 0) + matchBuckets[i].wins.length;
        p *= Math.max(1, len);
        if (p > 1_000_000_000) return p;
      }
      return p;
    };

    let mergeFlip = 0;
    while (calcBucketProd() > EXACT_JOINT_STATE_CAP) {
      let targetM = -1;
      let maxWins = 3;
      for (let m = 0; m < M; m++) {
        if (matchBuckets[m].wins.length > maxWins) {
          maxWins = matchBuckets[m].wins.length;
          targetM = m;
        }
      }
      if (targetM === -1) break;
      const wins = matchBuckets[targetM].wins;
      let bestIdx = 1;
      let bestGap = Infinity;
      const startIdx = wins.length >= 4 ? 1 : 0;
      const endIdx = wins.length >= 4 ? wins.length - 3 : wins.length - 2;
      for (let i = startIdx; i <= endIdx; i++) {
        const gap = Math.abs(wins[i + 1].meanOdds - wins[i].meanOdds);
        if (gap < bestGap) {
          bestGap = gap;
          bestIdx = i;
        }
      }
      const a = wins[bestIdx];
      const b = wins[bestIdx + 1];
      const sumP = a.prob + b.prob;
      const meanMerged =
        sumP > 0
          ? (a.prob * a.meanOdds + b.prob * b.meanOdds) / sumP
          : a.meanOdds;
      const repHitSet =
        bestIdx === 0
          ? a.hitSet
          : bestIdx + 1 === wins.length - 1
            ? b.hitSet
            : (++mergeFlip & 1) === 1
              ? b.hitSet
              : a.hitSet;
      wins.splice(bestIdx, 2, {
        prob: sumP,
        hitSet: repHitSet,
        meanOdds: meanMerged,
      });
    }

    for (
      let m = M - 1;
      m >= 0 && calcBucketProd() > EXACT_JOINT_STATE_CAP;
      m--
    ) {
      const wins = matchBuckets[m].wins;
      if (wins.length === 3) {
        const gapLo = Math.abs(wins[1].meanOdds - wins[0].meanOdds);
        const gapHi = Math.abs(wins[2].meanOdds - wins[1].meanOdds);
        if (gapLo <= gapHi) {
          const sumP = wins[0].prob + wins[1].prob;
          wins.splice(0, 2, {
            prob: sumP,
            hitSet: wins[0].hitSet,
            meanOdds: wins[0].meanOdds,
          });
        } else {
          const sumP = wins[1].prob + wins[2].prob;
          wins.splice(1, 2, {
            prob: sumP,
            hitSet: wins[2].hitSet,
            meanOdds: wins[2].meanOdds,
          });
        }
      }
    }

    for (
      let m = M - 1;
      m >= 0 && calcBucketProd() > EXACT_JOINT_STATE_CAP;
      m--
    ) {
      const wins = matchBuckets[m].wins;
      if (wins.length >= 2) {
        const sumP = wins.reduce((acc, w) => acc + w.prob, 0);
        const rep = [...wins].sort((a, b) => b.prob - a.prob)[0];
        matchBuckets[m].wins = [
          { prob: sumP, hitSet: rep.hitSet, meanOdds: rep.meanOdds },
        ];
      }
    }

    evalQuotient = matchBuckets.map((mb) => {
      const out = [];
      if (mb.missProb > 0) out.push({ prob: mb.missProb, hitSet: new Set() });
      for (const w of mb.wins) out.push({ prob: w.prob, hitSet: w.hitSet });
      return out;
    });
  }

  let evalProdSize = 1;
  for (let m = 0; m < M; m++) {
    evalProdSize *= evalQuotient[m].length;
    if (evalProdSize > 10_000_000) break;
  }

  // Pre-index flat distinct legs & pre-formatted tags once for zero-allocation combo formatting
  const flatLegs = [];
  const flatLegMatchIdx = [];
  const flatLegLabels = [];
  const matchOptFlatBase = new Int32Array(M);
  for (let m = 0; m < M; m++) {
    matchOptFlatBase[m] = flatLegs.length;
    const opts = distinctOptsByMatch[m];
    for (let j = 0; j < opts.length; j++) {
      const g = opts[j];
      flatLegs.push(g);
      flatLegMatchIdx.push(m);
      flatLegLabels.push(
        `${g.matchNumStr || g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`
      );
    }
  }
  const ticketFlatLegs = !metricsOnly
    ? ticketRows.map((_, k) => {
        const ids = [];
        for (let m = 0; m < M; m++) {
          const jIdx = ticketOptIdx[k * M + m];
          if (jIdx >= 0) ids.push(matchOptFlatBase[m] + jIdx);
        }
        return ids;
      })
    : null;
  const seenLegStamp = !metricsOnly ? new Int32Array(flatLegs.length) : null;
  const seenMatchStamp = !metricsOnly ? new Int32Array(M) : null;
  let curStamp = 0;

  const formatBucketCombo = (winIndices, prob, idx, payOverride = null) => {
    const winCount = winIndices.length;
    if (winCount === 1 && !payOverride) {
      const k0 = winIndices[0];
      const tk = ticketRows[k0];
      const unitPayout = Math.round(tk.unitPayout * 100) / 100;
      const totalPayout = Math.round(tk.totalPayout * 100) / 100;
      const cappedClipped = Math.round((tk.cappedClipped ?? 0) * 100) / 100;
      const netProfit = Math.round((totalPayout - totalCost) * 100) / 100;
      return {
        id: tk.id,
        desc: tk.desc,
        legs: tk.legs || [],
        prob,
        unitPayout,
        totalPayout,
        cappedClipped,
        netProfit,
        isUnderwater: netProfit < 0,
      };
    }

    curStamp += 1;
    let sumUnit = 0;
    let sumTotal = 0;
    let sumClip = 0;
    let hitMatchCount = 0;
    const dedupIds = [];
    for (let i = 0; i < winCount; i++) {
      const k = winIndices[i];
      const tk = ticketRows[k];
      sumUnit += tk.unitPayout;
      sumTotal += tk.totalPayout;
      sumClip += tk.cappedClipped ?? 0;
      const fIds = ticketFlatLegs[k];
      for (let j = 0; j < fIds.length; j++) {
        const fid = fIds[j];
        if (seenLegStamp[fid] !== curStamp) {
          seenLegStamp[fid] = curStamp;
          dedupIds.push(fid);
          const mIdx = flatLegMatchIdx[fid];
          if (seenMatchStamp[mIdx] !== curStamp) {
            seenMatchStamp[mIdx] = curStamp;
            hitMatchCount += 1;
          }
        }
      }
    }
    const unitPayout = payOverride
      ? payOverride.unitPayout
      : Math.round(sumUnit * 100) / 100;
    const totalPayout = payOverride
      ? payOverride.totalPayout
      : Math.round(sumTotal * 100) / 100;
    const cappedClipped = payOverride
      ? payOverride.cappedClipped
      : Math.round(sumClip * 100) / 100;
    const isUnderwater = payOverride
      ? payOverride.isUnderwater
      : Math.round((totalPayout - totalCost) * 100) < 0;
    const netProfit = payOverride
      ? totalPayout - totalCost
      : Math.round((totalPayout - totalCost) * 100) / 100;
    const dedupLegs = new Array(dedupIds.length);
    for (let i = 0; i < dedupIds.length; i++)
      dedupLegs[i] = flatLegs[dedupIds[i]];
    const showLen = Math.min(6, dedupIds.length);
    let legSummary = "";
    for (let i = 0; i < showLen; i++) {
      legSummary += (i === 0 ? "" : " × ") + flatLegLabels[dedupIds[i]];
    }
    const prefix =
      payOverride && payOverride.minCents !== payOverride.maxCents
        ? `派奖区间 ¥${(payOverride.minCents / 100).toFixed(2)}~¥${(payOverride.maxCents / 100).toFixed(2)}`
        : hitMatchCount === M && M > 1
          ? `全中${M}场(${winCount}注齐收)`
          : M === 1
            ? `同场兼中${winCount}注`
            : `中${hitMatchCount}/${M}场(${winCount}注兼中)`;
    return {
      id: `c-jv-${idx}`,
      desc: `${prefix} · ${legSummary}${dedupIds.length > 6 ? "…" : ""}`,
      legs: dedupLegs,
      prob,
      unitPayout,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater,
    };
  };

  const MAX_DFS_NODES = 1_048_576;
  const EXACT_MASK_BUCKET_CAP = 2_048;
  const EXACT_CENT_OVERFLOW_CAP = 8_192;
  const totalCostCents = Math.max(0, Math.round(totalCost * 100));
  const rowPayCents = Float64Array.from(ticketRows, (r) =>
    Math.max(0, Math.round(Number(r.totalPayout || 0) * 100))
  );
  const rowUnitCents = !metricsOnly
    ? Float64Array.from(ticketRows, (r) =>
        Math.max(0, Math.round(Number(r.unitPayout || 0) * 100))
      )
    : null;
  const rowClipCents = !metricsOnly
    ? Float64Array.from(ticketRows, (r) =>
        Math.max(0, Math.round(Number(r.cappedClipped || 0) * 100))
      )
    : null;
  const metricTiers = metricsOnly ? [] : null;
  const combos = [];
  const payoutOverflowBuckets = new Map();
  let globalMinWinCents = Infinity;
  let globalMaxWinCents = 0;
  let exactBreakEvenProb = 0;
  let capturedBucketProbs = null;
  let capturedBucketHits = null;

  const foldIntoPayoutOverflow = (
    payCents,
    unitCents,
    clipCents,
    nextProb,
    getRep
  ) => {
    if (payCents === totalCostCents) exactBreakEvenProb += nextProb;
    if (payCents < globalMinWinCents) globalMinWinCents = payCents;
    if (payCents > globalMaxWinCents) globalMaxWinCents = payCents;
    let pKey = payCents;
    if (
      !payoutOverflowBuckets.has(pKey) &&
      payoutOverflowBuckets.size >= EXACT_CENT_OVERFLOW_CAP
    ) {
      pKey =
        payCents < totalCostCents
          ? `QU_${Math.floor((totalCostCents - 1 - payCents) / 100)}`
          : `QP_${Math.floor((payCents - totalCostCents) / 100)}`;
    }
    const cur = payoutOverflowBuckets.get(pKey);
    if (cur) {
      cur.prob += nextProb;
      cur.expPayCents += nextProb * payCents;
      cur.expUnitCents += nextProb * unitCents;
      cur.expClipCents += nextProb * clipCents;
      if (payCents < cur.minCents) cur.minCents = payCents;
      if (payCents > cur.maxCents) cur.maxCents = payCents;
      if (!metricsOnly && nextProb > cur.bestProb) {
        cur.bestProb = nextProb;
        cur.rep = getRep();
      }
    } else {
      payoutOverflowBuckets.set(pKey, {
        prob: nextProb,
        expPayCents: nextProb * payCents,
        expUnitCents: nextProb * unitCents,
        expClipCents: nextProb * clipCents,
        minCents: payCents,
        maxCents: payCents,
        bestProb: nextProb,
        rep: !metricsOnly ? getRep() : null,
      });
    }
  };

  const materializeOverflowTiers = (extractWinIndices) => {
    let entries = Array.from(payoutOverflowBuckets.values()).filter(
      (b) => b.maxCents > 0 && b.prob > 0
    );
    if (!metricsOnly && entries.length > 96) {
      const folded = new Map();
      const mergeFolded = (fKey, b) => {
        const cur = folded.get(fKey);
        if (!cur) {
          folded.set(fKey, { ...b });
        } else {
          if (b.bestProb > cur.bestProb) {
            cur.bestProb = b.bestProb;
            cur.rep = b.rep;
          }
          cur.prob += b.prob;
          cur.expPayCents += b.expPayCents;
          cur.expUnitCents += b.expUnitCents;
          cur.expClipCents += b.expClipCents;
          if (b.minCents < cur.minCents) cur.minCents = b.minCents;
          if (b.maxCents > cur.maxCents) cur.maxCents = b.maxCents;
        }
      };
      for (const b of entries) {
        let fKey;
        if (
          b.minCents === globalMinWinCents &&
          b.maxCents === globalMinWinCents
        ) {
          fKey = "MIN";
        } else if (
          b.minCents === globalMaxWinCents &&
          b.maxCents === globalMaxWinCents
        ) {
          fKey = "MAX";
        } else if (b.maxCents < totalCostCents) {
          const span = Math.max(1, totalCostCents - globalMinWinCents);
          const t = Math.min(
            39,
            Math.floor(((b.minCents - globalMinWinCents) / span) * 40)
          );
          fKey = `U${t}`;
        } else {
          const span = Math.max(1, globalMaxWinCents - totalCostCents);
          const t = Math.min(
            55,
            Math.floor(
              (Math.log1p(b.minCents - totalCostCents) / Math.log1p(span)) * 56
            )
          );
          fKey = `P${t}`;
        }
        mergeFolded(fKey, b);
      }
      entries = Array.from(folded.values());
    }

    if (metricsOnly) {
      for (const b of entries) {
        const isSingleton = b.minCents === b.maxCents;
        const totalPayout = isSingleton
          ? b.minCents / 100
          : b.expPayCents / b.prob / 100;
        metricTiers.push({
          prob: b.prob,
          totalPayout,
          isUnderwater: b.maxCents < totalCostCents,
        });
      }
    } else {
      let bIdx = 0;
      for (const b of entries) {
        const winIndices = extractWinIndices(b.rep);
        if (winIndices.length > 0) {
          const isSingleton = b.minCents === b.maxCents;
          const totalPayout = isSingleton
            ? b.minCents / 100
            : b.expPayCents / b.prob / 100;
          combos.push(
            formatBucketCombo(winIndices, b.prob, bIdx++, {
              totalPayout,
              unitPayout: b.expUnitCents / b.prob / 100,
              cappedClipped: b.expClipCents / b.prob / 100,
              isUnderwater: b.maxCents < totalCostCents,
              minCents: b.minCents,
              maxCents: b.maxCents,
            })
          );
        }
      }
    }
  };

  const canUseScalarPrefixDfs =
    !canUseExactBilinearMitm &&
    evalProdSize > 65_536 &&
    M >= 2 &&
    M <= 8 &&
    distinctOptsByMatch.every((opts) => opts.length <= 31);

  if (canUseExactBilinearMitm) {
    // Exact Bilinear Meet-in-the-Middle + Exact Rounding-Band Strip Solver (0 unequal-odds merge across <=43M states)
    const mStates = evalQuotient.map((qs, m) => {
      const opts = distinctOptsByMatch[m];
      const byOpt = new Map();
      let missP = 0;
      for (const q of qs) {
        if (q.hitSet.size === 0) {
          missP += q.prob;
        } else {
          const jIdx = q.hitSet.values().next().value;
          byOpt.set(jIdx, (byOpt.get(jIdx) ?? 0) + q.prob);
        }
      }
      const arr = [];
      for (const [jIdx, p] of byOpt.entries()) {
        if (p > 0) {
          arr.push({
            prob: p,
            jIdx,
            odds: Number(opts[jIdx]?.odds || 0),
            sglPay: 0,
            sglUnit: 0,
            sglClip: 0,
          });
        }
      }
      if (missP > 0) {
        arr.push({
          prob: missP,
          jIdx: -1,
          odds: 0,
          sglPay: 0,
          sglUnit: 0,
          sglClip: 0,
        });
      }
      return arr;
    });

    const optToStateIdx = mStates.map((st, m) => {
      const map = new Int32Array(
        Math.max(1, distinctOptsByMatch[m].length)
      ).fill(-1);
      for (let s = 0; s < st.length; s++) {
        if (st[s].jIdx >= 0) map[st[s].jIdx] = s;
      }
      return map;
    });

    const pairPay = Array.from({ length: M }, (_, i) =>
      Array.from({ length: M }, (_, j) =>
        j > i ? new Float64Array(mStates[i].length * mStates[j].length) : null
      )
    );
    const pairUnit = !metricsOnly
      ? Array.from({ length: M }, (_, i) =>
          Array.from({ length: M }, (_, j) =>
            j > i
              ? new Float64Array(mStates[i].length * mStates[j].length)
              : null
          )
        )
      : null;
    const pairClip = !metricsOnly
      ? Array.from({ length: M }, (_, i) =>
          Array.from({ length: M }, (_, j) =>
            j > i
              ? new Float64Array(mStates[i].length * mStates[j].length)
              : null
          )
        )
      : null;

    for (let k = 0; k < K; k++) {
      let m1 = -1;
      let j1 = -1;
      let m2 = -1;
      let j2 = -1;
      for (let m = 0; m < M; m++) {
        const jIdx = ticketOptIdx[k * M + m];
        if (jIdx >= 0) {
          if (m1 < 0) {
            m1 = m;
            j1 = jIdx;
          } else {
            m2 = m;
            j2 = jIdx;
          }
        }
      }
      if (m1 >= 0 && m2 < 0) {
        const s1 = optToStateIdx[m1][j1];
        if (s1 >= 0) {
          mStates[m1][s1].sglPay += rowPayCents[k];
          if (!metricsOnly) {
            mStates[m1][s1].sglUnit += rowUnitCents[k];
            mStates[m1][s1].sglClip += rowClipCents[k];
          }
        }
      } else if (m1 >= 0 && m2 > m1) {
        const s1 = optToStateIdx[m1][j1];
        const s2 = optToStateIdx[m2][j2];
        if (s1 >= 0 && s2 >= 0) {
          const idx = s1 * mStates[m2].length + s2;
          pairPay[m1][m2][idx] += rowPayCents[k];
          if (!metricsOnly) {
            pairUnit[m1][m2][idx] += rowUnitCents[k];
            pairClip[m1][m2][idx] += rowClipCents[k];
          }
        }
      }
    }

    const ML = M >> 1;
    const MR = M - ML;
    const refMult =
      K > 0 ? Math.max(1, Number(ticketRows[0].multiple || 1)) : 1;
    const refScale = 200 * refMult;

    let minCrossErr = 0;
    let maxCrossErr = 0;
    let maxCrossUnitDiff = 0;
    let maxCrossClipVal = 0;
    for (let i = 0; i < ML; i++) {
      const stI = mStates[i];
      for (let j = ML; j < M; j++) {
        const stJ = mStates[j];
        const lenJ = stJ.length;
        const pp = pairPay[i][j];
        let pMin = Infinity;
        let pMax = -Infinity;
        for (let a = 0; a < stI.length; a++) {
          const oa = stI[a].odds;
          const baseOff = a * lenJ;
          for (let b = 0; b < lenJ; b++) {
            const ob = stJ[b].odds;
            const d = pp[baseOff + b] - refScale * oa * ob;
            if (d < pMin) pMin = d;
            if (d > pMax) pMax = d;
            if (!metricsOnly) {
              const ud = Math.abs(pairUnit[i][j][baseOff + b] - 200 * oa * ob);
              if (ud > maxCrossUnitDiff) maxCrossUnitDiff = ud;
              if (pairClip[i][j][baseOff + b] > maxCrossClipVal) {
                maxCrossClipVal = pairClip[i][j][baseOff + b];
              }
            }
          }
        }
        minCrossErr += pMin;
        maxCrossErr += pMax;
      }
    }

    const buildHalfStates = (startM, len) => {
      const out = [];
      const curIdx = new Int32Array(len);
      const rec = (d, prob, intra, uIntra, cIntra, sumO, hits) => {
        if (d === len) {
          out.push({
            prob,
            intra,
            uIntra,
            cIntra,
            sumO,
            hits,
            s: Int32Array.from(curIdx),
          });
          return;
        }
        const m = startM + d;
        const st = mStates[m];
        for (let a = 0; a < st.length; a++) {
          const pn = prob * st[a].prob;
          if (!(pn > 0)) continue;
          let addPay = st[a].sglPay;
          let addU = st[a].sglUnit;
          let addC = st[a].sglClip;
          const isHit = st[a].jIdx >= 0;
          if (isHit) {
            for (let p = 0; p < d; p++) {
              const mPrev = startM + p;
              const sp = curIdx[p];
              if (mStates[mPrev][sp].jIdx >= 0) {
                const idx = sp * st.length + a;
                addPay += pairPay[mPrev][m][idx];
                if (!metricsOnly) {
                  addU += pairUnit[mPrev][m][idx];
                  addC += pairClip[mPrev][m][idx];
                }
              }
            }
          }
          curIdx[d] = a;
          rec(
            d + 1,
            pn,
            intra + addPay,
            uIntra + addU,
            cIntra + addC,
            sumO + (isHit ? st[a].odds : 0),
            hits + (isHit ? 1 : 0)
          );
        }
      };
      rec(0, 1, 0, 0, 0, 0, 0);
      return out;
    };

    const leftStates = buildHalfStates(0, ML);
    const rightStates = buildHalfStates(ML, MR);

    const evalExactCross = (L, R) => {
      let cPay = 0;
      let cUnit = 0;
      let cClip = 0;
      for (let i = 0; i < ML; i++) {
        const si = L.s[i];
        if (mStates[i][si].jIdx < 0) continue;
        for (let j = 0; j < MR; j++) {
          const mR = ML + j;
          const sj = R.s[j];
          if (mStates[mR][sj].jIdx < 0) continue;
          const idx = si * mStates[mR].length + sj;
          cPay += pairPay[i][mR][idx];
          if (!metricsOnly) {
            cUnit += pairUnit[i][mR][idx];
            cClip += pairClip[i][mR][idx];
          }
        }
      }
      return [cPay, cUnit, cClip];
    };

    const BINS = 96;
    const bProb = new Float64Array(BINS);
    const bExpPay = new Float64Array(BINS);
    const bExpUnit = !metricsOnly ? new Float64Array(BINS) : null;
    const bExpClip = !metricsOnly ? new Float64Array(BINS) : null;
    const bMinC = new Float64Array(BINS).fill(Infinity);
    const bMaxC = new Float64Array(BINS);
    const bBestP = !metricsOnly ? new Float64Array(BINS) : null;
    const bRepOpt = !metricsOnly ? new Int32Array(BINS * M).fill(-1) : null;
    const invCostScale = 48 / Math.max(1, totalCostCents);

    const binIndexOf = (payC) =>
      payC < totalCostCents
        ? Math.min(47, (payC * invCostScale) | 0)
        : (48 +
            Math.min(47, Math.log1p((payC - totalCostCents) * 0.01) * 6.0)) |
          0;

    const writeRepState = (b, L, R) => {
      const baseOff = b * M;
      for (let i = 0; i < ML; i++) {
        bRepOpt[baseOff + i] = mStates[i][L.s[i]].jIdx;
      }
      for (let j = 0; j < MR; j++) {
        bRepOpt[baseOff + ML + j] = mStates[ML + j][R.s[j]].jIdx;
      }
    };

    const addExactPairToBin = (L, R, totPay, totUnit, totClip) => {
      if (!(totPay > 0)) return;
      const lp = L.prob * R.prob;
      if (totPay === totalCostCents) exactBreakEvenProb += lp;
      if (totPay < globalMinWinCents) globalMinWinCents = totPay;
      if (totPay > globalMaxWinCents) globalMaxWinCents = totPay;
      const b = binIndexOf(totPay);
      bProb[b] += lp;
      bExpPay[b] += lp * totPay;
      if (totPay < bMinC[b]) bMinC[b] = totPay;
      if (totPay > bMaxC[b]) bMaxC[b] = totPay;
      if (!metricsOnly) {
        bExpUnit[b] += lp * totUnit;
        bExpClip[b] += lp * totClip;
        if (lp > bBestP[b]) {
          bBestP[b] = lp;
          writeRepState(b, L, R);
        }
      }
    };

    const rightZero = rightStates.filter((r) => r.hits === 0);
    const rightHit = rightStates
      .filter((r) => r.hits > 0)
      .sort((a, b) => a.sumO - b.sumO || a.intra - b.intra);

    const STRIP_TARGET = 32;
    const stripCount = Math.min(
      STRIP_TARGET,
      Math.max(1, Math.ceil(rightHit.length / 96))
    );
    const strips = [];
    for (let s = 0; s < stripCount; s++) {
      const lo = Math.floor((s * rightHit.length) / stripCount);
      const hi = Math.floor(((s + 1) * rightHit.length) / stripCount);
      if (lo >= hi) continue;
      const sub = rightHit.slice(lo, hi);
      let minIntra = Infinity;
      let maxIntra = 0;
      let pSum = 0;
      let sumProbIntra = 0;
      let sumProbUIntra = 0;
      let sumProbCIntra = 0;
      let sumProbSumO = 0;
      let bestR = sub[0];
      for (let i = 0; i < sub.length; i++) {
        const r = sub[i];
        if (r.intra < minIntra) minIntra = r.intra;
        if (r.intra > maxIntra) maxIntra = r.intra;
        pSum += r.prob;
        sumProbIntra += r.prob * r.intra;
        sumProbSumO += r.prob * r.sumO;
        if (!metricsOnly) {
          sumProbUIntra += r.prob * r.uIntra;
          sumProbCIntra += r.prob * r.cIntra;
          if (r.prob > bestR.prob) bestR = r;
        }
      }
      strips.push({
        sub,
        pSum,
        minSumO: sub[0].sumO,
        maxSumO: sub[sub.length - 1].sumO,
        minIntra,
        maxIntra,
        sumProbIntra,
        sumProbUIntra,
        sumProbCIntra,
        sumProbSumO,
        bestR,
      });
    }

    const canFastBulkStats =
      metricsOnly || (maxCrossUnitDiff <= 1.0 && maxCrossClipVal === 0);

    for (let u = 0; u < leftStates.length; u++) {
      const L = leftStates[u];
      for (let z = 0; z < rightZero.length; z++) {
        const R = rightZero[z];
        if (L.intra + R.intra > 0) {
          addExactPairToBin(
            L,
            R,
            L.intra + R.intra,
            L.uIntra + R.uIntra,
            L.cIntra + R.cIntra
          );
        }
      }
      if (rightHit.length === 0) continue;
      if (L.hits === 0) {
        for (let v = 0; v < rightHit.length; v++) {
          const R = rightHit[v];
          if (L.intra + R.intra > 0) {
            addExactPairToBin(
              L,
              R,
              L.intra + R.intra,
              L.uIntra + R.uIntra,
              L.cIntra + R.cIntra
            );
          }
        }
        continue;
      }

      for (let s = 0; s < strips.length; s++) {
        const st = strips[s];
        const lb =
          L.intra +
          st.minIntra +
          Math.floor(refScale * L.sumO * st.minSumO + minCrossErr);
        const ub =
          L.intra +
          st.maxIntra +
          Math.ceil(refScale * L.sumO * st.maxSumO + maxCrossErr);
        if (ub <= 0) continue;

        if (
          canFastBulkStats &&
          ((lb > 0 && ub < totalCostCents) || lb > totalCostCents)
        ) {
          const lp = L.prob * st.pSum;
          const b = lb < totalCostCents ? binIndexOf(lb) : binIndexOf(lb);
          bProb[b] += lp;
          const expPayBlock =
            L.prob *
            (st.pSum * L.intra +
              st.sumProbIntra +
              refScale * L.sumO * st.sumProbSumO);
          bExpPay[b] += expPayBlock;
          if (lb < bMinC[b]) bMinC[b] = Math.max(1, lb);
          if (ub > bMaxC[b]) bMaxC[b] = ub;
          if (!metricsOnly) {
            bExpUnit[b] +=
              L.prob *
              (st.pSum * L.uIntra +
                st.sumProbUIntra +
                200 * L.sumO * st.sumProbSumO);
            bExpClip[b] += L.prob * (st.pSum * L.cIntra + st.sumProbCIntra);
            const repP = L.prob * st.bestR.prob;
            if (repP > bBestP[b]) {
              bBestP[b] = repP;
              writeRepState(b, L, st.bestR);
            }
          }
          continue;
        }

        const sub = st.sub;
        for (let v = 0; v < sub.length; v++) {
          const R = sub[v];
          const baseApprox = L.intra + R.intra + refScale * L.sumO * R.sumO;
          const pairLb = Math.floor(baseApprox + minCrossErr);
          const pairUb = Math.ceil(baseApprox + maxCrossErr);
          if (pairUb <= 0) continue;
          if (
            canFastBulkStats &&
            ((pairLb > 0 && pairUb < totalCostCents) || pairLb > totalCostCents)
          ) {
            const lp = L.prob * R.prob;
            const b = binIndexOf(pairLb);
            bProb[b] += lp;
            bExpPay[b] += lp * baseApprox;
            if (pairLb < bMinC[b]) bMinC[b] = Math.max(1, pairLb);
            if (pairUb > bMaxC[b]) bMaxC[b] = pairUb;
            if (!metricsOnly) {
              bExpUnit[b] += lp * (L.uIntra + R.uIntra + 200 * L.sumO * R.sumO);
              bExpClip[b] += lp * (L.cIntra + R.cIntra);
              if (lp > bBestP[b]) {
                bBestP[b] = lp;
                writeRepState(b, L, R);
              }
            }
          } else {
            const [cPay, cUnit, cClip] = evalExactCross(L, R);
            addExactPairToBin(
              L,
              R,
              L.intra + R.intra + cPay,
              L.uIntra + R.uIntra + cUnit,
              L.cIntra + R.cIntra + cClip
            );
          }
        }
      }
    }

    // Exact global minPayout & maxPayout search seeded with min-odds / max-odds corners (<0.05ms, 0-cent error!)
    if (rightHit.length > 0 && leftStates.length > 0) {
      const evalFullAssignment = (stateIdxByMatch) => {
        let tot = 0;
        for (let i = 0; i < M; i++) {
          const si = stateIdxByMatch[i];
          const stI = mStates[i][si];
          tot += stI.sglPay;
          if (stI.jIdx < 0) continue;
          for (let j = i + 1; j < M; j++) {
            const sj = stateIdxByMatch[j];
            if (mStates[j][sj].jIdx < 0) continue;
            tot += pairPay[i][j][si * mStates[j].length + sj];
          }
        }
        return tot;
      };
      const maxCorner = mStates.map((st) => {
        let best = 0;
        for (let i = 1; i < st.length; i++) {
          if (st[i].odds > st[best].odds) best = i;
        }
        return best;
      });
      const seedMax = evalFullAssignment(maxCorner);
      if (seedMax > globalMaxWinCents) globalMaxWinCents = seedMax;

      const minHitIdx = mStates.map((st) => {
        let best = -1;
        for (let i = 0; i < st.length; i++) {
          if (st[i].jIdx >= 0 && (best < 0 || st[i].odds < st[best].odds)) {
            best = i;
          }
        }
        return best;
      });
      const missIdx = mStates.map((st) => st.findIndex((x) => x.jIdx < 0));
      if (minHitIdx.every((x) => x >= 0)) {
        const allMinHit = evalFullAssignment(minHitIdx);
        if (allMinHit > 0 && allMinHit < globalMinWinCents) {
          globalMinWinCents = allMinHit;
        }
      }
      // Also seed minimal 2-hit + (M-2)-miss states when misses exist
      for (let a = 0; a < M; a++) {
        if (minHitIdx[a] < 0) continue;
        for (let b = a + 1; b < M; b++) {
          if (minHitIdx[b] < 0) continue;
          let canMissRest = true;
          const assign = new Int32Array(M);
          for (let m = 0; m < M; m++) {
            if (m === a || m === b) assign[m] = minHitIdx[m];
            else if (missIdx[m] >= 0) assign[m] = missIdx[m];
            else if (minHitIdx[m] >= 0) assign[m] = minHitIdx[m];
            else canMissRest = false;
          }
          if (canMissRest) {
            const pVal = evalFullAssignment(assign);
            if (pVal > 0 && pVal < globalMinWinCents) globalMinWinCents = pVal;
          }
        }
      }

      const rightAsc = rightHit; // already sorted ascending by sumO!
      const nR = rightAsc.length;
      const sufMinIntraR = new Float64Array(nR);
      sufMinIntraR[nR - 1] = rightAsc[nR - 1].intra;
      for (let i = nR - 2; i >= 0; i--) {
        sufMinIntraR[i] = Math.min(rightAsc[i].intra, sufMinIntraR[i + 1]);
      }
      const leftPosAsc = leftStates
        .filter((l) => l.hits > 0)
        .sort(
          (a, b) =>
            a.intra +
            refScale * a.sumO * rightAsc[0].sumO -
            (b.intra + refScale * b.sumO * rightAsc[0].sumO)
        );
      for (let u = 0; u < leftPosAsc.length; u++) {
        const L = leftPosAsc[u];
        const minLBound =
          L.intra +
          sufMinIntraR[0] +
          Math.floor(refScale * L.sumO * rightAsc[0].sumO + minCrossErr);
        if (minLBound >= globalMinWinCents) continue;
        for (let v = 0; v < nR; v++) {
          const R = rightAsc[v];
          const lb =
            L.intra +
            sufMinIntraR[v] +
            Math.floor(refScale * L.sumO * R.sumO + minCrossErr);
          if (lb >= globalMinWinCents) break;
          const [cPay] = evalExactCross(L, R);
          const tot = L.intra + R.intra + cPay;
          if (tot > 0 && tot < globalMinWinCents) globalMinWinCents = tot;
        }
      }

      const rightDesc = [...rightHit].sort(
        (a, b) => b.sumO - a.sumO || b.intra - a.intra
      );
      const sufMaxIntraR = new Float64Array(nR);
      sufMaxIntraR[nR - 1] = rightDesc[nR - 1].intra;
      for (let i = nR - 2; i >= 0; i--) {
        sufMaxIntraR[i] = Math.max(rightDesc[i].intra, sufMaxIntraR[i + 1]);
      }
      const leftPosDesc = leftStates
        .filter((l) => l.hits > 0)
        .sort(
          (a, b) =>
            b.intra +
            refScale * b.sumO * rightDesc[0].sumO -
            (a.intra + refScale * a.sumO * rightDesc[0].sumO)
        );
      for (let u = 0; u < leftPosDesc.length; u++) {
        const L = leftPosDesc[u];
        const maxLBound =
          L.intra +
          sufMaxIntraR[0] +
          Math.ceil(refScale * L.sumO * rightDesc[0].sumO + maxCrossErr);
        if (maxLBound <= globalMaxWinCents) continue;
        for (let v = 0; v < nR; v++) {
          const R = rightDesc[v];
          const ub =
            L.intra +
            sufMaxIntraR[v] +
            Math.ceil(refScale * L.sumO * R.sumO + maxCrossErr);
          if (ub <= globalMaxWinCents) break;
          const [cPay] = evalExactCross(L, R);
          const tot = L.intra + R.intra + cPay;
          if (tot > globalMaxWinCents) globalMaxWinCents = tot;
        }
      }
    }

    let bIdx = 0;
    for (let b = 0; b < BINS; b++) {
      const prob = bProb[b];
      if (!(prob > 0 && bMaxC[b] > 0)) continue;
      const isUnderwater = b < 48;
      const clampedMinC = isUnderwater
        ? Math.max(
            globalMinWinCents < Infinity ? globalMinWinCents : 1,
            bMinC[b]
          )
        : Math.max(totalCostCents, bMinC[b]);
      const clampedMaxC = isUnderwater
        ? Math.min(Math.max(1, totalCostCents - 1), bMaxC[b])
        : Math.min(
            globalMaxWinCents > 0 ? globalMaxWinCents : bMaxC[b],
            bMaxC[b]
          );
      const isSingleton = clampedMinC === clampedMaxC;
      const totalPayout = isSingleton
        ? clampedMinC / 100
        : bExpPay[b] / prob / 100;
      if (metricsOnly) {
        metricTiers.push({ prob, totalPayout, isUnderwater });
      } else {
        const baseOff = b * M;
        const winIndices = [];
        for (let k = 0; k < K; k++) {
          let hit = true;
          for (let m = 0; m < M; m++) {
            const jIdx = ticketOptIdx[k * M + m];
            if (jIdx >= 0 && bRepOpt[baseOff + m] !== jIdx) {
              hit = false;
              break;
            }
          }
          if (hit) winIndices.push(k);
        }
        if (winIndices.length > 0) {
          combos.push(
            formatBucketCombo(winIndices, prob, bIdx++, {
              totalPayout,
              unitPayout: bExpUnit[b] / prob / 100,
              cappedClipped: bExpClip[b] / prob / 100,
              isUnderwater,
              minCents: clampedMinC,
              maxCents: clampedMaxC,
            })
          );
        }
      }
    }
  } else if (canUseScalarPrefixDfs) {
    const stateProbs = evalQuotient.map((qs) =>
      Float64Array.from(qs, (q) => q.prob)
    );
    const stateMasks = evalQuotient.map((qs) =>
      Int32Array.from(qs, (q) => {
        let msk = 0;
        for (const j of q.hitSet) msk |= 1 << j;
        return msk;
      })
    );

    const bucketLists = Array.from({ length: M * 32 }, () => []);
    let totalPrefPairs = 0;
    for (let k = 0; k < K; k++) {
      let lastM = -1;
      let lastJ = -1;
      let legCnt = 0;
      for (let m = 0; m < M; m++) {
        const jIdx = ticketOptIdx[k * M + m];
        if (jIdx >= 0) {
          lastM = m;
          lastJ = jIdx;
          legCnt += 1;
        }
      }
      if (lastM >= 0 && lastJ >= 0) {
        bucketLists[lastM * 32 + lastJ].push(k);
        totalPrefPairs += Math.max(0, legCnt - 1);
      }
    }

    const slotStart = new Int32Array(M * 32);
    const slotEnd = new Int32Array(M * 32);
    const ePay = new Float64Array(K);
    const eUnit = !metricsOnly ? new Float64Array(K) : null;
    const eClip = !metricsOnly ? new Float64Array(K) : null;
    const ePStart = new Int32Array(K);
    const ePEnd = new Int32Array(K);
    const prefM = new Int32Array(Math.max(1, totalPrefPairs));
    const prefBit = new Int32Array(Math.max(1, totalPrefPairs));

    let eCursor = 0;
    let pCursor = 0;
    for (let slot = 0; slot < M * 32; slot++) {
      slotStart[slot] = eCursor;
      const ks = bucketLists[slot];
      const lastM = slot >> 5;
      for (let idx = 0; idx < ks.length; idx++) {
        const k = ks[idx];
        ePay[eCursor] = rowPayCents[k];
        if (!metricsOnly) {
          eUnit[eCursor] = rowUnitCents[k];
          eClip[eCursor] = rowClipCents[k];
        }
        ePStart[eCursor] = pCursor;
        for (let m = 0; m < lastM; m++) {
          const jIdx = ticketOptIdx[k * M + m];
          if (jIdx >= 0) {
            prefM[pCursor] = m;
            prefBit[pCursor] = 1 << jIdx;
            pCursor += 1;
          }
        }
        ePEnd[eCursor] = pCursor;
        eCursor += 1;
      }
      slotEnd[slot] = eCursor;
    }

    const BINS = 96;
    const bProb = new Float64Array(BINS);
    const bExpPay = new Float64Array(BINS);
    const bExpUnit = !metricsOnly ? new Float64Array(BINS) : null;
    const bExpClip = !metricsOnly ? new Float64Array(BINS) : null;
    const bMinC = new Float64Array(BINS).fill(Infinity);
    const bMaxC = new Float64Array(BINS);
    const bBestP = !metricsOnly ? new Float64Array(BINS) : null;
    const bRepS = !metricsOnly ? new Int32Array(BINS * M).fill(-1) : null;

    const curMask = new Int32Array(M);
    const chosenS = !metricsOnly ? new Int32Array(M) : null;
    const optPayBuf = Array.from(
      { length: M },
      (_, m) => new Float64Array(Math.max(1, distinctOptsByMatch[m].length))
    );
    const optUnitBuf = !metricsOnly
      ? Array.from(
          { length: M },
          (_, m) => new Float64Array(Math.max(1, distinctOptsByMatch[m].length))
        )
      : null;
    const optClipBuf = !metricsOnly
      ? Array.from(
          { length: M },
          (_, m) => new Float64Array(Math.max(1, distinctOptsByMatch[m].length))
        )
      : null;

    const invCostScale = 48 / Math.max(1, totalCostCents);
    const MAX_SCALAR_LEAVES = 450_000;
    let visitedScalarLeaves = 0;
    const sumMaskDelta = (msk, oPay, oUnit, oClip) => {
      if (msk === 0) return [0, 0, 0];
      if ((msk & (msk - 1)) === 0) {
        const j = 31 - Math.clz32(msk);
        return [
          oPay[j],
          !metricsOnly ? oUnit[j] : 0,
          !metricsOnly ? oClip[j] : 0,
        ];
      }
      let aPay = 0;
      let aUnit = 0;
      let aClip = 0;
      let v = msk;
      while (v !== 0) {
        const lsb = v & -v;
        const j = 31 - Math.clz32(lsb);
        aPay += oPay[j];
        if (!metricsOnly) {
          aUnit += oUnit[j];
          aClip += oClip[j];
        }
        v &= v - 1;
      }
      return [aPay, aUnit, aClip];
    };
    const walkScalar = (m, curProb, accPay, accUnit, accClip) => {
      if (visitedScalarLeaves >= MAX_SCALAR_LEAVES) return;
      const r = distinctOptsByMatch[m].length;
      const oPay = optPayBuf[m];
      const oUnit = !metricsOnly ? optUnitBuf[m] : null;
      const oClip = !metricsOnly ? optClipBuf[m] : null;
      const baseSlot = m << 5;

      for (let j = 0; j < r; j++) {
        let sPay = 0;
        let sUnit = 0;
        let sClip = 0;
        const st = slotStart[baseSlot + j];
        const en = slotEnd[baseSlot + j];
        for (let e = st; e < en; e++) {
          let ok = true;
          const ps = ePStart[e];
          const pe = ePEnd[e];
          for (let p = ps; p < pe; p++) {
            if ((curMask[prefM[p]] & prefBit[p]) === 0) {
              ok = false;
              break;
            }
          }
          if (ok) {
            sPay += ePay[e];
            if (!metricsOnly) {
              sUnit += eUnit[e];
              sClip += eClip[e];
            }
          }
        }
        oPay[j] = sPay;
        if (!metricsOnly) {
          oUnit[j] = sUnit;
          oClip[j] = sClip;
        }
      }

      const pArr = stateProbs[m];
      const mArr = stateMasks[m];
      const sLen = pArr.length;

      if (m === M - 1) {
        visitedScalarLeaves += sLen;
        for (let s = 0; s < sLen; s++) {
          const [addPay, addUnit, addClip] = sumMaskDelta(
            mArr[s],
            oPay,
            oUnit,
            oClip
          );
          const totPay = accPay + addPay;
          if (totPay <= 0) continue;
          const lp = curProb * pArr[s];
          if (totPay === totalCostCents) exactBreakEvenProb += lp;
          if (totPay < globalMinWinCents) globalMinWinCents = totPay;
          if (totPay > globalMaxWinCents) globalMaxWinCents = totPay;
          const b =
            totPay < totalCostCents
              ? Math.min(47, (totPay * invCostScale) | 0)
              : (48 +
                  Math.min(
                    47,
                    Math.log1p((totPay - totalCostCents) * 0.01) * 6.0
                  )) |
                0;
          bProb[b] += lp;
          bExpPay[b] += lp * totPay;
          if (totPay < bMinC[b]) bMinC[b] = totPay;
          if (totPay > bMaxC[b]) bMaxC[b] = totPay;
          if (!metricsOnly) {
            bExpUnit[b] += lp * (accUnit + addUnit);
            bExpClip[b] += lp * (accClip + addClip);
            if (lp > bBestP[b]) {
              bBestP[b] = lp;
              const baseOff = b * M;
              for (let q = 0; q < M - 1; q++) bRepS[baseOff + q] = chosenS[q];
              bRepS[baseOff + M - 1] = s;
            }
          }
        }
        return;
      }

      for (let s = 0; s < sLen; s++) {
        if (visitedScalarLeaves >= MAX_SCALAR_LEAVES) break;
        const msk = mArr[s];
        const [addPay, addUnit, addClip] = sumMaskDelta(
          msk,
          oPay,
          oUnit,
          oClip
        );
        curMask[m] = msk;
        if (!metricsOnly) chosenS[m] = s;
        walkScalar(
          m + 1,
          curProb * pArr[s],
          accPay + addPay,
          accUnit + addUnit,
          accClip + addClip
        );
      }
    };

    walkScalar(0, 1, 0, 0, 0);

    let bIdx = 0;
    for (let b = 0; b < BINS; b++) {
      const prob = bProb[b];
      if (!(prob > 0 && bMaxC[b] > 0)) continue;
      const isSingleton = bMinC[b] === bMaxC[b];
      const totalPayout = isSingleton
        ? bMinC[b] / 100
        : bExpPay[b] / prob / 100;
      const isUnderwater = b < 48;
      if (metricsOnly) {
        metricTiers.push({ prob, totalPayout, isUnderwater });
      } else {
        const baseOff = b * M;
        const winIndices = [];
        for (let k = 0; k < K; k++) {
          let hit = true;
          for (let m = 0; m < M; m++) {
            const jIdx = ticketOptIdx[k * M + m];
            if (jIdx >= 0) {
              const repStateIdx = bRepS[baseOff + m];
              if (
                repStateIdx < 0 ||
                (stateMasks[m][repStateIdx] & (1 << jIdx)) === 0
              ) {
                hit = false;
                break;
              }
            }
          }
          if (hit) winIndices.push(k);
        }
        if (winIndices.length > 0) {
          combos.push(
            formatBucketCombo(winIndices, prob, bIdx++, {
              totalPayout,
              unitPayout: bExpUnit[b] / prob / 100,
              cappedClipped: bExpClip[b] / prob / 100,
              isUnderwater,
              minCents: bMinC[b],
              maxCents: bMaxC[b],
            })
          );
        }
      }
    }
  } else if (K <= 32) {
    const fullMask = K === 32 ? -1 : (1 << K) - 1;
    const compatMask = evalQuotient.map((qStates, m) => {
      const arr = new Int32Array(qStates.length);
      for (let s = 0; s < qStates.length; s++) {
        const hs = qStates[s].hitSet;
        let mask = 0;
        for (let k = 0; k < K; k++) {
          const jIdx = ticketOptIdx[k * M + m];
          if (jIdx === -1 || hs.has(jIdx)) {
            mask |= 1 << k;
          }
        }
        arr[s] = mask;
      }
      return arr;
    });

    const sumMaskCents = (uMask) => {
      let payC = 0;
      let unitC = 0;
      let clipC = 0;
      let mVal = uMask | 0;
      while (mVal !== 0) {
        const lsb = mVal & -mVal;
        const k = 31 - Math.clz32(lsb);
        payC += rowPayCents[k];
        if (!metricsOnly) {
          unitC += rowUnitCents[k];
          clipC += rowClipCents[k];
        }
        mVal &= mVal - 1;
      }
      return [payC, unitC, clipC];
    };

    let visitedNodes = 0;
    let overflowActive = false;
    const winBuckets = new Map();
    const walk32 = (m, curProb, aliveMask) => {
      if (++visitedNodes > MAX_DFS_NODES) return;
      const qStates = evalQuotient[m];
      const cArr = compatMask[m];
      const isLast = m === M - 1;
      for (let s = 0; s < qStates.length; s++) {
        const nextMask = aliveMask & cArr[s];
        if (nextMask === 0) continue;
        const nextProb = curProb * qStates[s].prob;
        if (isLast) {
          const uMask = nextMask >>> 0;
          if (!overflowActive) {
            const prev = winBuckets.get(uMask);
            if (prev !== undefined) {
              winBuckets.set(uMask, prev + nextProb);
              continue;
            }
            if (winBuckets.size < EXACT_MASK_BUCKET_CAP) {
              winBuckets.set(uMask, nextProb);
              continue;
            }
            overflowActive = true;
          }
          const [payC, unitC, clipC] = sumMaskCents(uMask);
          if (payC > 0) {
            foldIntoPayoutOverflow(payC, unitC, clipC, nextProb, () => uMask);
          }
        } else {
          walk32(m + 1, nextProb, nextMask);
        }
      }
    };
    walk32(0, 1, fullMask);

    if (overflowActive) {
      for (const [uMask, prob] of winBuckets.entries()) {
        const [payC, unitC, clipC] = sumMaskCents(uMask);
        if (payC > 0) {
          foldIntoPayoutOverflow(payC, unitC, clipC, prob, () => uMask);
        }
      }
      materializeOverflowTiers((uMask) => {
        const winIndices = [];
        for (let k = 0; k < K; k++) {
          if ((uMask & (1 << k)) !== 0) winIndices.push(k);
        }
        return winIndices;
      });
    } else {
      const wantCapture =
        Boolean(options?.captureHitMatrix) && !compressedPerMatch && K <= 512;
      if (wantCapture) {
        capturedBucketProbs = [];
        capturedBucketHits = [];
      }
      let bIdx = 0;
      for (const [uMask, prob] of winBuckets.entries()) {
        const winIndices = [];
        let payC = 0;
        for (let k = 0; k < K; k++) {
          if ((uMask & (1 << k)) !== 0) {
            winIndices.push(k);
            payC += rowPayCents[k];
          }
        }
        if (winIndices.length > 0) {
          if (payC === totalCostCents) exactBreakEvenProb += prob;
          if (payC < globalMinWinCents) globalMinWinCents = payC;
          if (payC > globalMaxWinCents) globalMaxWinCents = payC;
          if (wantCapture) {
            capturedBucketProbs.push(prob);
            capturedBucketHits.push(Int16Array.from(winIndices));
          }
          if (metricsOnly) {
            const totalPayout = payC / 100;
            metricTiers.push({
              prob,
              totalPayout,
              isUnderwater: payC < totalCostCents,
            });
          } else {
            combos.push(formatBucketCombo(winIndices, prob, bIdx++));
          }
        }
      }
    }
  } else {
    const wordCount = Math.ceil(K / 32);
    const compatWords = evalQuotient.map((qStates, m) =>
      qStates.map((qs) => {
        const words = new Uint32Array(wordCount);
        for (let k = 0; k < K; k++) {
          const jIdx = ticketOptIdx[k * M + m];
          if (jIdx === -1 || qs.hitSet.has(jIdx)) {
            words[k >>> 5] |= 1 << (k & 31);
          }
        }
        return words;
      })
    );

    const depthBufs = Array.from(
      { length: M + 1 },
      () => new Uint32Array(wordCount)
    );
    for (let k = 0; k < K; k++) {
      depthBufs[0][k >>> 5] |= 1 << (k & 31);
    }

    const sumWordsCents = (words) => {
      let payC = 0;
      let unitC = 0;
      let clipC = 0;
      for (let w = 0; w < wordCount; w++) {
        let wVal = words[w] | 0;
        const base = w << 5;
        while (wVal !== 0) {
          const lsb = wVal & -wVal;
          const k = base + (31 - Math.clz32(lsb));
          payC += rowPayCents[k];
          if (!metricsOnly) {
            unitC += rowUnitCents[k];
            clipC += rowClipCents[k];
          }
          wVal &= wVal - 1;
        }
      }
      return [payC, unitC, clipC];
    };

    let visitedNodes = 0;
    let overflowActive = false;
    const winBuckets = new Map();
    const walkWords = (m, curProb) => {
      if (++visitedNodes > MAX_DFS_NODES) return;
      const prevWords = depthBufs[m];
      const nextWords = depthBufs[m + 1];
      const qStates = evalQuotient[m];
      const cList = compatWords[m];
      const isLast = m === M - 1;
      for (let s = 0; s < qStates.length; s++) {
        const cw = cList[s];
        let nonZero = 0;
        for (let w = 0; w < wordCount; w++) {
          const v = prevWords[w] & cw[w];
          nextWords[w] = v;
          nonZero |= v;
        }
        if (nonZero === 0) continue;
        const nextProb = curProb * qStates[s].prob;
        if (isLast) {
          if (!overflowActive) {
            let key = "";
            for (let w = 0; w < wordCount; w++) {
              key +=
                w === 0
                  ? nextWords[w].toString(36)
                  : `_${nextWords[w].toString(36)}`;
            }
            const prev = winBuckets.get(key);
            if (prev) {
              prev.prob += nextProb;
              continue;
            }
            if (winBuckets.size < EXACT_MASK_BUCKET_CAP) {
              winBuckets.set(key, {
                words: new Uint32Array(nextWords),
                prob: nextProb,
              });
              continue;
            }
            overflowActive = true;
          }
          const [payC, unitC, clipC] = sumWordsCents(nextWords);
          if (payC > 0) {
            foldIntoPayoutOverflow(
              payC,
              unitC,
              clipC,
              nextProb,
              () => new Uint32Array(nextWords)
            );
          }
        } else {
          walkWords(m + 1, nextProb);
        }
      }
    };
    walkWords(0, 1);

    if (overflowActive) {
      for (const entry of winBuckets.values()) {
        const [payC, unitC, clipC] = sumWordsCents(entry.words);
        if (payC > 0) {
          foldIntoPayoutOverflow(
            payC,
            unitC,
            clipC,
            entry.prob,
            () => entry.words
          );
        }
      }
      materializeOverflowTiers((words) => {
        const winIndices = [];
        for (let w = 0; w < wordCount; w++) {
          let wVal = words[w] | 0;
          const base = w << 5;
          while (wVal !== 0) {
            const lsb = wVal & -wVal;
            winIndices.push(base + (31 - Math.clz32(lsb)));
            wVal &= wVal - 1;
          }
        }
        return winIndices;
      });
    } else {
      const wantCapture =
        Boolean(options?.captureHitMatrix) && !compressedPerMatch && K <= 512;
      if (wantCapture) {
        capturedBucketProbs = [];
        capturedBucketHits = [];
      }
      let bIdx = 0;
      for (const entry of winBuckets.values()) {
        const winIndices = [];
        let payC = 0;
        for (let w = 0; w < wordCount; w++) {
          let wVal = entry.words[w] | 0;
          const base = w << 5;
          while (wVal !== 0) {
            const lsb = wVal & -wVal;
            const k = base + (31 - Math.clz32(lsb));
            winIndices.push(k);
            payC += rowPayCents[k];
            wVal &= wVal - 1;
          }
        }
        if (winIndices.length > 0) {
          if (payC === totalCostCents) exactBreakEvenProb += entry.prob;
          if (payC < globalMinWinCents) globalMinWinCents = payC;
          if (payC > globalMaxWinCents) globalMaxWinCents = payC;
          if (wantCapture) {
            capturedBucketProbs.push(entry.prob);
            capturedBucketHits.push(Int16Array.from(winIndices));
          }
          if (metricsOnly) {
            const totalPayout = payC / 100;
            metricTiers.push({
              prob: entry.prob,
              totalPayout,
              isUnderwater: payC < totalCostCents,
            });
          } else {
            combos.push(formatBucketCombo(winIndices, entry.prob, bIdx++));
          }
        }
      }
    }
  }

  let hitMatrix = null;
  if (capturedBucketProbs && capturedBucketHits) {
    const sigToOrigIdx = new Map();
    let uniqueSigs = true;
    for (let k = 0; k < K; k++) {
      const sig = canonicalTicketLegSig(ticketRows[k].legs);
      if (!sig || sigToOrigIdx.has(sig)) {
        uniqueSigs = false;
        break;
      }
      sigToOrigIdx.set(sig, k);
    }
    if (uniqueSigs) {
      hitMatrix = {
        K,
        matchesRef: matches,
        isBaselineAtomic: Boolean(!matchAtomicMap || options?.isBaselineAtomic),
        sigToOrigIdx,
        origTicketProbs,
        bucketProbs: Float64Array.from(capturedBucketProbs),
        bucketHits: capturedBucketHits,
      };
    }
  }

  const activeTiers = metricsOnly ? metricTiers : combos;
  activeTiers.sort((a, b) => a.totalPayout - b.totalPayout);
  const anyWinProb = Math.min(
    1,
    Math.max(
      0,
      activeTiers.reduce((acc, c) => acc + c.prob, 0)
    )
  );
  const realProfitProb = Math.min(
    anyWinProb,
    Math.max(
      0,
      activeTiers
        .filter((c) => !c.isUnderwater)
        .reduce((acc, c) => acc + c.prob, 0)
    )
  );
  const allJointBreakEven =
    activeTiers.length > 0 &&
    Math.abs(realProfitProb - exactBreakEvenProb) <= 1e-13 &&
    activeTiers.every(
      (c) =>
        c.isUnderwater || Math.round((c.totalPayout - totalCost) * 100) === 0
    );
  const breakEvenProb = allJointBreakEven
    ? realProfitProb
    : Math.min(realProfitProb, Math.max(0, exactBreakEvenProb));
  const strictNetGainProb = allJointBreakEven
    ? 0
    : Math.max(0, realProfitProb - breakEvenProb);
  const minPayout =
    activeTiers.length > 0 && Number.isFinite(globalMinWinCents)
      ? globalMinWinCents / 100
      : (activeTiers[0]?.totalPayout ?? 0);
  const maxPayout =
    activeTiers.length > 0 && globalMaxWinCents > 0
      ? globalMaxWinCents / 100
      : (activeTiers[activeTiers.length - 1]?.totalPayout ?? 0);
  const expectedReturn = exactExpectedReturn;
  const expectedValueRate = exactExpectedValueRate;
  const underwaterCount = activeTiers.filter((c) => c.isUnderwater).length;
  const underwaterProbSum = activeTiers
    .filter((c) => c.isUnderwater)
    .reduce((acc, c) => acc + c.prob, 0);
  const underwaterShareOfWins =
    anyWinProb > 0
      ? Math.min(1, Math.max(0, underwaterProbSum / anyWinProb))
      : 0;

  const byProbDesc = [...activeTiers].sort((a, b) => b.prob - a.prob);
  const topHalf = byProbDesc.slice(
    0,
    Math.max(1, Math.ceil(byProbDesc.length * 0.6))
  );
  const rawLikelyMin = topHalf.length
    ? Math.min(...topHalf.map((c) => c.totalPayout))
    : 0;
  const rawLikelyMax = topHalf.length
    ? Math.max(...topHalf.map((c) => c.totalPayout))
    : 0;
  const likelyMin = activeTiers.length ? Math.max(minPayout, rawLikelyMin) : 0;
  const likelyMax = activeTiers.length
    ? Math.min(maxPayout, Math.max(likelyMin, rawLikelyMax))
    : 0;

  return {
    combos,
    tiers: activeTiers,
    hitMatrix,
    anyWinProb,
    realProfitProb,
    strictNetGainProb,
    breakEvenProb,
    minPayout,
    maxPayout,
    expectedReturn,
    expectedValueRate,
    underwaterCount,
    underwaterShareOfWins,
    likelyRange: [likelyMin, likelyMax],
  };
}

function tiltAtomicProbsByStance(baseProbs, match, stance) {
  if (stance !== "home-lean" && stance !== "upset-watch") {
    return baseProbs;
  }
  const atomicLen = ATOMIC_TEMPLATES.length;
  const out = new Float64Array(atomicLen);

  let underdogFt = "a";
  if (stance === "upset-watch") {
    let pH = 0;
    let pA = 0;
    for (let i = 0; i < atomicLen; i++) {
      const ft = ATOMIC_TEMPLATES[i].ft;
      if (ft === "h") pH += baseProbs[i];
      else if (ft === "a") pA += baseProbs[i];
    }
    const gl = resolveGoalLineNum(match);
    const isAwayFav = Math.abs(pA - pH) > 1e-6 ? pA > pH : gl > 0;
    underdogFt = isAwayFav ? "h" : "a";
  }

  const homeBoost = Math.exp(0.22);
  const drawBoost = Math.exp(0.24);
  const dogBoost = Math.exp(0.28);

  let sum = 0;
  for (let i = 0; i < atomicLen; i++) {
    const ft = ATOMIC_TEMPLATES[i].ft;
    let mult = 1;
    if (stance === "home-lean") {
      if (ft === "h") mult = homeBoost;
    } else if (stance === "upset-watch") {
      if (ft === "d") mult = drawBoost;
      else if (ft === underdogFt) mult = dogBoost;
    }
    const w = baseProbs[i] * mult;
    out[i] = w;
    sum += w;
  }

  if (sum > 0) {
    const inv = 1 / sum;
    for (let i = 0; i < atomicLen; i++) out[i] *= inv;
  }
  return out;
}

function tiltAtomicProbsBySubjectiveDelta(
  baseProbs,
  legsOnMatch,
  goalLineNum,
  subjectiveDeltaPct
) {
  const delta = Number(subjectiveDeltaPct) || 0;
  if (delta === 0 || !Array.isArray(legsOnMatch) || legsOnMatch.length === 0) {
    return baseProbs;
  }
  const atomicLen = ATOMIC_TEMPLATES.length;
  const hitMask = new Uint8Array(atomicLen);
  let pS = 0;
  for (let i = 0; i < atomicLen; i++) {
    const tpl = ATOMIC_TEMPLATES[i];
    for (let j = 0; j < legsOnMatch.length; j++) {
      const lg = legsOnMatch[j];
      if (
        doesOptionHitAtomicTemplate(
          lg.poolCode,
          lg.optionKey,
          lg.optionLabel,
          goalLineNum,
          tpl
        )
      ) {
        hitMask[i] = 1;
        pS += baseProbs[i];
        break;
      }
    }
  }
  if (!(pS > 0 && pS < 0.999)) {
    return baseProbs;
  }
  const pPrime = Math.min(0.98, Math.max(0.02, pS * (1 + delta / 100)));
  const hitScale = pPrime / pS;
  const missScale = (1 - pPrime) / (1 - pS);
  const out = new Float64Array(atomicLen);
  let sum = 0;
  for (let i = 0; i < atomicLen; i++) {
    const w = baseProbs[i] * (hitMask[i] ? hitScale : missScale);
    out[i] = w;
    sum += w;
  }
  if (sum > 0) {
    const inv = 1 / sum;
    for (let i = 0; i < atomicLen; i++) out[i] *= inv;
  }
  return out;
}

function computeEquivalentArbitrages(m) {
  const arbitrages = [];
  if (!m?.pools) return arbitrages;

  const ttgSelling =
    m.pools.TTG?.selling !== false &&
    Array.isArray(m.pools.TTG?.options) &&
    m.pools.TTG.options.length > 0;
  const crsSelling =
    m.pools.CRS?.selling !== false &&
    Array.isArray(m.pools.CRS?.options) &&
    m.pools.CRS.options.length > 0;
  if (ttgSelling && crsSelling) {
    const ttg0 = m.pools.TTG.options.find((o) => o.key === "s0");
    const crs00 = m.pools.CRS.options.find(
      (o) => o.key === "0:0" || o.label === "0:0"
    );
    if (
      ttg0 &&
      crs00 &&
      ttg0.odds > 0 &&
      crs00.odds > 0 &&
      Math.abs(ttg0.odds - crs00.odds) >= 0.15
    ) {
      const ttgBetter = ttg0.odds > crs00.odds;
      const hi = ttgBetter ? ttg0.odds : crs00.odds;
      const lo = ttgBetter ? crs00.odds : ttg0.odds;
      const edge = ((hi - lo) / lo) * 100;
      const betterPicks = [
        ttgBetter
          ? { poolCode: "TTG", optionKey: "s0" }
          : { poolCode: "CRS", optionKey: "0:0" },
      ];
      const worsePicks = [
        ttgBetter
          ? { poolCode: "CRS", optionKey: "0:0" }
          : { poolCode: "TTG", optionKey: "s0" },
      ];
      arbitrages.push({
        matchId: m.id,
        title: "0:0 闷平同义差价",
        betterChoice: ttgBetter
          ? `总进球·0球(@${hi.toFixed(2)})`
          : `比分·0:0(@${hi.toFixed(2)})`,
        worseChoice: ttgBetter
          ? `比分·0:0(@${lo.toFixed(2)})`
          : `总进球·0球(@${lo.toFixed(2)})`,
        edgePct: Number(edge.toFixed(1)),
        detail: `两者100%同义！选【${ttgBetter ? "总进球0球" : "比分0:0"}】白多赚 +${edge.toFixed(1)}% 奖金`,
        betterPicks,
        worsePicks,
        poolCode: betterPicks[0].poolCode,
        optionKey: betterPicks[0].optionKey,
      });
    }
  }

  const hadSelling =
    m.pools.HAD?.selling !== false &&
    Array.isArray(m.pools.HAD?.options) &&
    m.pools.HAD.options.length > 0;
  const hhadSelling =
    m.pools.HHAD?.selling !== false &&
    Array.isArray(m.pools.HHAD?.options) &&
    m.pools.HHAD.options.length > 0;
  if (hadSelling && hhadSelling) {
    const goalLine = String(m.pools.HHAD?.goalLine ?? "-1");
    const hadH = m.pools.HAD.options.find((o) => o.key === "h");
    const hadD = m.pools.HAD.options.find((o) => o.key === "d");
    const hadA = m.pools.HAD.options.find((o) => o.key === "a");
    if (
      (goalLine === "-1" || Number(goalLine) === -1) &&
      hadD?.odds > 0 &&
      hadA?.odds > 0
    ) {
      const hhadAway = m.pools.HHAD.options.find((o) => o.key === "ha");
      const synDouble = 1 / (1 / hadD.odds + 1 / hadA.odds);
      if (hhadAway?.odds > 0 && Math.abs(hhadAway.odds - synDouble) >= 0.02) {
        const hhadBetter = hhadAway.odds >= synDouble;
        const hi = Math.max(hhadAway.odds, synDouble);
        const lo = Math.min(hhadAway.odds, synDouble);
        const edge = ((hi - lo) / lo) * 100;
        const betterPicks = hhadBetter
          ? [{ poolCode: "HHAD", optionKey: "ha" }]
          : [
              { poolCode: "HAD", optionKey: "d" },
              { poolCode: "HAD", optionKey: "a" },
            ];
        const worsePicks = hhadBetter
          ? [
              { poolCode: "HAD", optionKey: "d" },
              { poolCode: "HAD", optionKey: "a" },
            ]
          : [{ poolCode: "HHAD", optionKey: "ha" }];
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
    } else if (
      (goalLine === "+1" || Number(goalLine) === 1) &&
      hadH?.odds > 0 &&
      hadD?.odds > 0
    ) {
      const hhadHome = m.pools.HHAD.options.find((o) => o.key === "hh");
      const synDouble = 1 / (1 / hadH.odds + 1 / hadD.odds);
      if (hhadHome?.odds > 0 && Math.abs(hhadHome.odds - synDouble) >= 0.02) {
        const hhadBetter = hhadHome.odds >= synDouble;
        const hi = Math.max(hhadHome.odds, synDouble);
        const lo = Math.min(hhadHome.odds, synDouble);
        const edge = ((hi - lo) / lo) * 100;
        const betterPicks = hhadBetter
          ? [{ poolCode: "HHAD", optionKey: "hh" }]
          : [
              { poolCode: "HAD", optionKey: "h" },
              { poolCode: "HAD", optionKey: "d" },
            ];
        const worsePicks = hhadBetter
          ? [
              { poolCode: "HAD", optionKey: "h" },
              { poolCode: "HAD", optionKey: "d" },
            ]
          : [{ poolCode: "HHAD", optionKey: "hh" }];
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
  }

  return arbitrages;
}

function computeOptionShrunkAlpha(odds, dcProb, shinProb) {
  const cleanOdds = Number(odds);
  if (!(cleanOdds > 1.01 && dcProb > 0)) {
    return { pShrunk: 0, expectedReturn: 0 };
  }
  const baseShin =
    typeof shinProb === "number" && shinProb > 0 ? shinProb : dcProb;
  const excessOdds = Math.max(0, cleanOdds - 1.5);
  // Post-SMART dcProb already incorporates cross-pool KL projection; apply residual Winner's Curse shrinkage
  const wShrink = 0.1 + 0.45 * (excessOdds / (excessOdds + 10.0));
  const pRaw = (1 - wShrink) * dcProb + wShrink * baseShin;
  const maxRatio = cleanOdds > 25 ? 1.08 : cleanOdds > 12 ? 1.2 : 1.42;
  const pShrunk = Math.min(pRaw, baseShin * maxRatio);
  return {
    wShrink,
    pShrunk,
    expectedReturn: cleanOdds * pShrunk,
  };
}

/**
 * 统一单场跨盘正期望（+EV）扫描器（ADR-0010 / Spec 0009，驱动 analyzeMatchMicroQuant.alphaScanSummary 与 Slot ④ alpha-radar）：
 * - 对细分玩法（HAFU / TTG / CRS）与主让球盘（HAD / HHAD）执行向单池 Shin 的经验贝叶斯防赢家诅咒收缩；
 * - 严格执行纯正期望硬门禁：仅当收缩校准单腿期望返还 O * p_shrunk >= 1.01（>= +1.0% +EV）时才入池，彻底杜绝负期望同义替换诱导建仓。
 */
function scanMatchAlphaCandidates(
  match,
  anchorList = null,
  precomputedCal = null,
  precomputedArbs = null
) {
  const cal = precomputedCal ?? getCachedMatchCalibration(match);
  if (!cal) {
    return {
      coherent: false,
      sellingPoolCount: 0,
      mainPayoutRatio: 0.88,
      maxExpectedReturn: 0,
      maxDelta: -Infinity,
      arbitrages: [],
      candidates: [],
    };
  }

  let mainPayoutRatio = 0;
  for (const mainCode of ["HAD", "HHAD"]) {
    const p = cal.pools[mainCode];
    if (
      p &&
      p.selling !== false &&
      Array.isArray(p.options) &&
      p.options.length > 0
    ) {
      if (p.payoutRatio > mainPayoutRatio) mainPayoutRatio = p.payoutRatio;
    }
  }
  if (mainPayoutRatio <= 0) {
    for (const p of Object.values(cal.pools)) {
      if (
        p &&
        p.selling !== false &&
        Array.isArray(p.options) &&
        p.options.length > 0
      ) {
        if (p.payoutRatio > mainPayoutRatio) mainPayoutRatio = p.payoutRatio;
      }
    }
  }
  if (mainPayoutRatio <= 0) mainPayoutRatio = 0.88;

  const arbitrages = precomputedArbs ?? computeEquivalentArbitrages(match);
  if (!cal.coherent || cal.sellingPoolCount < 2) {
    return {
      coherent: cal.coherent,
      sellingPoolCount: cal.sellingPoolCount,
      mainPayoutRatio,
      maxExpectedReturn: 0,
      maxDelta: -Infinity,
      arbitrages,
      candidates: [],
    };
  }

  const atomicLen = ATOMIC_TEMPLATES.length;
  const calAtomic = new Float64Array(atomicLen);
  for (let i = 0; i < atomicLen; i++) calAtomic[i] = cal.atomicStates[i].prob;
  const gl = resolveGoalLineNum(match);

  let ancMask = null;
  if (Array.isArray(anchorList) && anchorList.length > 0) {
    ancMask = new Uint8Array(atomicLen);
    for (let i = 0; i < atomicLen; i++) {
      const tpl = ATOMIC_TEMPLATES[i];
      for (const a of anchorList) {
        if (
          doesOptionHitAtomicTemplate(
            a.poolCode,
            a.optionKey,
            a.optionLabel,
            gl,
            tpl
          )
        ) {
          ancMask[i] = 1;
          break;
        }
      }
    }
  }

  const poolTsMap = resolveNormalizedMatchPoolTimestamps(cal.pools);
  const hadTs = poolTsMap.HAD;
  const hhadTs = poolTsMap.HHAD;
  const hafuTs = poolTsMap.HAFU;
  const ttgTs = poolTsMap.TTG;
  const crsTs = poolTsMap.CRS;
  const validTsAll = [hadTs, hhadTs, hafuTs, ttgTs, crsTs].filter(
    (t) => t !== null
  );
  const hasRealTsSpread =
    validTsAll.length >= 2 &&
    Math.max(...validTsAll) - Math.min(...validTsAll) >= 0.5;
  const mainLatestTs =
    hadTs !== null && hhadTs !== null
      ? Math.max(hadTs, hhadTs)
      : (hadTs ?? hhadTs);

  // Standalone power-devigged CRS exact goal-sum probabilities for k in {0..5} (anti-Poisson-artifact check)
  let crsStandaloneTtg = null;
  const rawCrsPool = cal.pools?.CRS;
  if (
    rawCrsPool &&
    rawCrsPool.selling !== false &&
    Array.isArray(rawCrsPool.options) &&
    rawCrsPool.options.length >= 28
  ) {
    const crsPower = devigPoolProbabilities(rawCrsPool.options, "power").probs;
    crsStandaloneTtg = new Float64Array(6);
    for (let i = 0; i < rawCrsPool.options.length; i++) {
      const lbl =
        rawCrsPool.options[i].label || rawCrsPool.options[i].key || "";
      if (!lbl.includes(":")) continue;
      const [hx, ay] = lbl.split(":").map(Number);
      const tot = hx + ay;
      if (tot >= 0 && tot <= 5) {
        crsStandaloneTtg[tot] += crsPower[i] ?? 0;
      }
    }
  }

  const candidates = [];
  let maxExpectedReturn = 0;
  let maxDelta = -Infinity;

  for (const poolCode of ["HAD", "HHAD", "HAFU", "TTG", "CRS"]) {
    const pool = cal.pools[poolCode];
    if (
      !pool ||
      pool.selling === false ||
      !Array.isArray(pool.options) ||
      pool.options.length === 0
    ) {
      continue;
    }
    const isMainPool = poolCode === "HAD" || poolCode === "HHAD";
    const curPoolTs = poolTsMap[poolCode] ?? null;
    // Sub-pool updated strictly AFTER main pool (>1 min) moved first in live trading — not a stale lag candidate
    if (
      !isMainPool &&
      hasRealTsSpread &&
      curPoolTs !== null &&
      mainLatestTs !== null &&
      curPoolTs > mainLatestTs + 1
    ) {
      continue;
    }

    for (const opt of pool.options) {
      if (!(Number.isFinite(opt.odds) && opt.odds > 1.01)) continue;
      if (ancMask) {
        let optMass = 0;
        let overlapMass = 0;
        for (let i = 0; i < atomicLen; i++) {
          if (
            doesOptionHitAtomicTemplate(
              poolCode,
              opt.key,
              opt.label,
              gl,
              ATOMIC_TEMPLATES[i]
            )
          ) {
            optMass += calAtomic[i];
            if (ancMask[i]) overlapMass += calAtomic[i];
          }
        }
        if (!(optMass > 0 && overlapMass / optMass >= 0.5)) continue;
      }

      const lookupKey = poolCode === "CRS" ? opt.label || opt.key : opt.key;
      const dcProb =
        cal.poolProbs?.[poolCode]?.[lookupKey] ??
        sumOptionProbOnAtomic(calAtomic, poolCode, opt.key, opt.label, gl);
      const shinProb = opt.shinProb ?? dcProb;
      let pShrunk;
      let expectedReturn;
      if (isMainPool) {
        pShrunk = Math.min(0.65 * dcProb + 0.35 * shinProb, shinProb * 1.28);
        expectedReturn = opt.odds * pShrunk;
      } else {
        const sh = computeOptionShrunkAlpha(opt.odds, dcProb, shinProb);
        pShrunk = sh.pShrunk;
        expectedReturn = sh.expectedReturn;
      }

      // Cross-pool exact partition anti-hallucination gate on TTG s0..s5:
      // When CRS is fresher than TTG (>5m) and its exact goal-sum partition contradicts +EV (< 1.0), block Poisson artifact!
      if (poolCode === "TTG" && crsStandaloneTtg) {
        const kGoal = Number(String(opt.key).replace(/^s/, ""));
        const crsFresherThanTtg =
          hasRealTsSpread &&
          curPoolTs !== null &&
          crsTs !== null &&
          crsTs > curPoolTs + 5;
        if (
          Number.isInteger(kGoal) &&
          kGoal >= 0 &&
          kGoal <= 5 &&
          crsFresherThanTtg &&
          opt.odds * crsStandaloneTtg[kGoal] < 1.0
        ) {
          expectedReturn = Math.min(
            expectedReturn,
            opt.odds * crsStandaloneTtg[kGoal]
          );
          pShrunk = expectedReturn / opt.odds;
        }
      }

      const posEdge = expectedReturn - 1.0;
      const mainExcess = expectedReturn - mainPayoutRatio;
      if (expectedReturn > maxExpectedReturn)
        maxExpectedReturn = expectedReturn;
      if (posEdge > maxDelta) maxDelta = posEdge;

      // Strict Pure +EV Gate: O * p_shrunk >= 1.01 (>= +1.0% genuine positive expected value)
      if (expectedReturn >= 1.01) {
        const sig = `${poolCode}:${opt.key}`;
        candidates.push({
          kind: isMainPool ? "main-pool" : "sub-pool",
          sig,
          matchId: match.id,
          match,
          poolCode,
          poolName: pool.name || poolCode,
          singleAllowed: Boolean(pool.single),
          optionKey: opt.key,
          optionLabel: opt.label || opt.key,
          odds: opt.odds,
          betterPicks: [{ poolCode, optionKey: opt.key }],
          pShrunk,
          expectedReturn,
          mainExcess,
          arbEdgePct: 0,
          arbBetterChoice: null,
          arbWorseChoice: null,
          delta: posEdge,
          isPositiveEv: true,
        });
      }
    }
  }

  candidates.sort(
    (a, b) => b.expectedReturn - a.expectedReturn || b.pShrunk - a.pShrunk
  );
  return {
    coherent: cal.coherent,
    sellingPoolCount: cal.sellingPoolCount,
    mainPayoutRatio,
    maxExpectedReturn,
    maxDelta,
    arbitrages,
    candidates,
  };
}

function formatMatchAlphaScanSummary(scan) {
  if (!scan.coherent || scan.sellingPoolCount < 2) {
    return "单池独立开售：已启用非线性去水校准，暂无跨盘比价基准";
  }
  if (scan.candidates.length > 0) {
    const best = scan.candidates[0];
    return `检出跨盘绝对正期望洼地：【${best.poolName}·${best.optionLabel}@${best.odds.toFixed(2)}】收缩校准期望返还 ${(best.expectedReturn * 100).toFixed(1)}%（纯正期望 +${((best.expectedReturn - 1) * 100).toFixed(1)}% +EV）`;
  }
  const topArb = Array.isArray(scan.arbitrages)
    ? scan.arbitrages.find((a) => a.edgePct >= 3.0)
    : null;
  if (topArb) {
    return `五池定价严密（无跨盘错价洼地/+EV套利） · 同义省钱平替：${topArb.betterChoice} 较同义项省 +${topArb.edgePct.toFixed(1)}%`;
  }
  const maxRetPct =
    scan.maxExpectedReturn > 0
      ? `${(scan.maxExpectedReturn * 100).toFixed(1)}%`
      : "88.0%";
  return `五池定价严密：各玩法经经验贝叶斯收缩校准后最高期望返还 ${maxRetPct}（未达 101.0% 纯+EV门禁），无跨盘错价洼地`;
}

/** 1. 单场精算师底牌反推（服务端黑盒：五池闭合 xG + 全让球线统一一球卡盘率 + 比赛节奏相关性 + 跨盘错价扫描） */
export function analyzeMatchMicroQuant(m, precomputedCal) {
  const cal = precomputedCal ?? calibrateMatchCoherentModel(m);
  const scoreGrid = cal.scoreGrid;

  let rawHomeXG = 0;
  let rawAwayXG = 0;
  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const rowX = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const p = scoreGrid[rowX + y];
      rawHomeXG += x * p;
      rawAwayXG += y * p;
    }
  }
  const homeXG = Number(rawHomeXG.toFixed(2));
  const awayXG = Number(rawAwayXG.toFixed(2));
  const totalXG = Number((homeXG + awayXG).toFixed(2));

  const goalLine = m.pools.HHAD?.goalLine ?? "-1";
  const goalLineNum = Number(goalLine);
  const hhadSelling =
    m.pools.HHAD?.selling !== false &&
    Array.isArray(m.pools.HHAD?.options) &&
    m.pools.HHAD.options.length > 0;

  const cohHomeWinProb = cal.poolProbs.HAD.h;
  const cohAwayWinProb = cal.poolProbs.HAD.a;
  const isAwayFav = hhadSelling
    ? String(goalLine).includes("+") || goalLineNum > 0
    : Math.abs(cohAwayWinProb - cohHomeWinProb) > 1e-6
      ? cohAwayWinProb > cohHomeWinProb
      : String(goalLine).includes("+") || goalLineNum > 0;
  const favTeam = isAwayFav ? m.away : m.home;

  let favWinProb = 0;
  let favOneGoalProb = 0;
  const targetDiff = isAwayFav ? -1 : 1;
  for (let i = 0; i < DC_GRID_LEN; i++) {
    const d = GRID_DIFF[i];
    if (isAwayFav ? d < 0 : d > 0) {
      favWinProb += scoreGrid[i];
      if (d === targetDiff) favOneGoalProb += scoreGrid[i];
    }
  }
  const oneGoalProb = favOneGoalProb;
  const oneGoalShareOfWins =
    favWinProb > 0 ? Math.min(0.85, oneGoalProb / favWinProb) : 0.5;

  const cardPanTip =
    oneGoalShareOfWins >= 0.5
      ? `${favTeam}若赢球，高达 ${(oneGoalShareOfWins * 100).toFixed(0)}% 概率仅净胜 1 球！慎追让胜穿盘，防「让平」性价比极高。`
      : `${favTeam}穿盘动能充足（净胜2+球占比 ${(100 - oneGoalShareOfWins * 100).toFixed(0)}%），可博让球正路。`;

  let bestGoalPair = ["s2", "s3", 0];
  for (let i = 0; i < TTG_KEY_ORDER.length - 1; i++) {
    const k0 = TTG_KEY_ORDER[i];
    const k1 = TTG_KEY_ORDER[i + 1];
    const sumP = cal.poolProbs.TTG[k0] + cal.poolProbs.TTG[k1];
    if (sumP > bestGoalPair[2]) {
      bestGoalPair = [k0, k1, sumP];
    }
  }

  const halfDrawProb =
    cal.poolProbs.HAFU.dh + cal.poolProbs.HAFU.dd + cal.poolProbs.HAFU.da;

  const arbitrages = computeEquivalentArbitrages(m);

  const droppingOpts = [
    ...(m.pools.HAD?.options ?? [])
      .filter((o) => o.trend === -1)
      .map((o) => `主盘${o.label}`),
    ...(m.pools.HHAD?.options ?? [])
      .filter((o) => o.trend === -1)
      .map((o) => o.label),
  ];
  const steamSignal =
    droppingOpts.length > 0
      ? `🔥 真防冷急降：体彩正下调【${droppingOpts.slice(0, 2).join("/")}】赔付`
      : "⚖️ 盘面平稳：暂无剧烈急跌诱盘";

  const microBadges = [
    { text: `xG ${homeXG}:${awayXG}`, tone: "sky" },
    {
      text:
        oneGoalShareOfWins >= 0.5
          ? `防赢1球卡盘 ${(oneGoalShareOfWins * 100).toFixed(0)}%`
          : `穿盘率 ${(100 - oneGoalShareOfWins * 100).toFixed(0)}%`,
      tone: oneGoalShareOfWins >= 0.5 ? "amber" : "emerald",
    },
  ];
  if (arbitrages[0]) {
    microBadges.push({
      text: `💰省钱差价 +${arbitrages[0].edgePct}%`,
      tone: "emerald",
    });
  }
  if (droppingOpts.length > 0) {
    microBadges.push({ text: `🔻${droppingOpts[0]}降水`, tone: "purple" });
  }

  const paceCorrelation = Number(cal.params.rho.toFixed(4));
  const paceLabel =
    paceCorrelation <= -0.05
      ? "防守死锁"
      : paceCorrelation >= 0.05
        ? "开放对攻"
        : "均衡节奏";
  const alphaScan = scanMatchAlphaCandidates(m, null, cal, arbitrages);
  const alphaScanSummary = formatMatchAlphaScanSummary(alphaScan);

  return {
    homeXG,
    awayXG,
    totalXG,
    oneGoalProb,
    oneGoalShareOfWins,
    cardPanTip,
    topTwoGoals: bestGoalPair,
    halfDrawProb,
    arbitrages,
    steamSignal,
    microBadges,
    paceCorrelation,
    paceLabel,
    alphaScanSummary,
  };
}

export function attachMicroQuant(matches) {
  return matches.map((m) => {
    const cal = calibrateMatchCoherentModel(m);
    const calibratedMatch = {
      ...m,
      pools: cal.pools,
    };
    return {
      ...calibratedMatch,
      microQuant: analyzeMatchMicroQuant(calibratedMatch, cal),
    };
  });
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

const RAW_FALLBACK_MATCHES = [
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

export const FALLBACK_MATCHES = attachMicroQuant(RAW_FALLBACK_MATCHES);

function parseTrend(v) {
  if (v === "1" || v === 1) return 1;
  if (v === "-1" || v === -1) return -1;
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
        poolFlags[p.poolCode] =
          Number(p.bettingSingle) === 1 || Number(p.single) === 1;
        const statusOk =
          String(p.poolStatus ?? "Selling").toLowerCase() === "selling";
        const bettingOk =
          p.bettingAllup !== undefined || p.bettingSingle !== undefined
            ? Number(p.bettingAllup) === 1 || Number(p.bettingSingle) === 1
            : Number(p.cbtValue ?? 1) !== 2;
        poolSelling[p.poolCode] = statusOk && bettingOk;
      }
      const isSelling = (code) =>
        hasPoolList ? Boolean(poolSelling[code]) : true;
      const hadRaw = m.had ?? {};
      const hhadRaw = m.hhad ?? {};
      const hafuRaw = m.hafu ?? {};
      const ttgRaw = m.ttg ?? {};
      const crsRaw = m.crs ?? {};

      parsed.push({
        id: String(m.matchId),
        matchNumStr: m.matchNumStr,
        league: m.leagueAbbName,
        kickoff: (m.matchTime ?? "").slice(0, 5),
        home: m.homeTeamAbbName,
        away: m.awayTeamAbbName,
        homeRank: String(m.homeRank || "").replace(/\D+/g, "") || undefined,
        awayRank: String(m.awayRank || "").replace(/\D+/g, "") || undefined,
        isHot: Number(m.isHot) === 1,
        aiAlert: undefined,
        pools: {
          HAD: buildPool(
            "HAD",
            "胜平负",
            Boolean(poolFlags.HAD),
            [
              {
                key: "h",
                label: "主胜",
                odds: Number(hadRaw.h || 0),
                trend: parseTrend(hadRaw.hf),
              },
              {
                key: "d",
                label: "平",
                odds: Number(hadRaw.d || 0),
                trend: parseTrend(hadRaw.df),
              },
              {
                key: "a",
                label: "客胜",
                odds: Number(hadRaw.a || 0),
                trend: parseTrend(hadRaw.af),
              },
            ],
            hadRaw.updateTime || "实时",
            undefined,
            isSelling("HAD"),
            hadRaw.updateDate || undefined
          ),
          HHAD: buildPool(
            "HHAD",
            `让球(${hhadRaw.goalLine || "-1"})`,
            Boolean(poolFlags.HHAD),
            [
              {
                key: "hh",
                label: "让胜",
                odds: Number(hhadRaw.h || 0),
                trend: parseTrend(hhadRaw.hf),
              },
              {
                key: "hd",
                label: "让平",
                odds: Number(hhadRaw.d || 0),
                trend: parseTrend(hhadRaw.df),
              },
              {
                key: "ha",
                label: "让负",
                odds: Number(hhadRaw.a || 0),
                trend: parseTrend(hhadRaw.af),
              },
            ],
            hhadRaw.updateTime || "实时",
            hhadRaw.goalLine || "-1",
            isSelling("HHAD"),
            hhadRaw.updateDate || undefined
          ),
          HAFU: buildPool(
            "HAFU",
            "半全场",
            poolFlags.HAFU ?? true,
            [
              ["hh", "胜胜"],
              ["hd", "胜平"],
              ["ha", "胜负"],
              ["dh", "平胜"],
              ["dd", "平平"],
              ["da", "平负"],
              ["ah", "负胜"],
              ["ad", "负平"],
              ["aa", "负负"],
            ].map(([k, lbl]) => ({
              key: k,
              label: lbl,
              odds: Number(hafuRaw[k] || 0),
              trend: parseTrend(hafuRaw[`${k}f`]),
            })),
            hafuRaw.updateTime || "实时",
            undefined,
            isSelling("HAFU"),
            hafuRaw.updateDate || undefined
          ),
          TTG: buildPool(
            "TTG",
            "总进球",
            poolFlags.TTG ?? true,
            ["0", "1", "2", "3", "4", "5", "6", "7"].map((n) => ({
              key: `s${n}`,
              label: n === "7" ? "7+球" : `${n}球`,
              odds: Number(ttgRaw[`s${n}`] || 0),
              trend: parseTrend(ttgRaw[`s${n}f`]),
            })),
            ttgRaw.updateTime || "实时",
            undefined,
            isSelling("TTG"),
            ttgRaw.updateDate || undefined
          ),
          CRS: buildPool(
            "CRS",
            "比分",
            poolFlags.CRS ?? true,
            OFFICIAL_CRS_PAIRS.map(([k, lbl]) => ({
              key: lbl,
              label: lbl,
              odds: Number(crsRaw[k] || 0),
              trend: parseTrend(crsRaw[`${k}f`]),
            })),
            crsRaw.updateTime || "实时",
            undefined,
            isSelling("CRS"),
            crsRaw.updateDate || undefined
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
        "https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c",
        { signal: controller.signal }
      );
      if (res.ok) {
        const json = await res.json();
        const parsed = parseSportteryRawJson(json);
        if (parsed.length > 0) {
          if (snapshotFilePath) {
            await fsp
              .mkdir(path.dirname(snapshotFilePath), { recursive: true })
              .catch(() => {});
            const tmpPath = `${snapshotFilePath}.tmp.${process.pid}.${Date.now()}`;
            await fsp
              .writeFile(tmpPath, JSON.stringify(json), "utf-8")
              .then(() => fsp.rename(tmpPath, snapshotFilePath))
              .catch(() => fsp.unlink(tmpPath).catch(() => {}));
          }
          const dropCount = parsed.filter((m) =>
            Object.values(m.pools).some((p) =>
              p.options.some((o) => o.trend === -1)
            )
          ).length;
          return {
            matches: parsed,
            source: "official-live",
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
      const raw = await fsp.readFile(snapshotFilePath, "utf-8");
      const parsed = parseSportteryRawJson(JSON.parse(raw));
      if (parsed.length > 0) {
        const dropCount = parsed.filter((m) =>
          Object.values(m.pools).some((p) =>
            p.options.some((o) => o.trend === -1)
          )
        ).length;
        return {
          matches: parsed,
          source: "official-live",
          syncNote: `已载入体彩实盘快照 ${parsed.length} 场在售赛事｜检测到 ${dropCount} 场存在官方降水异动`,
        };
      }
    } catch {
      // fallback to built-in
    }
  }

  return {
    matches: FALLBACK_MATCHES,
    source: "fallback",
    syncNote: `使用内置实盘快照（共 ${FALLBACK_MATCHES.length} 场精选赛事）`,
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

function buildFreePassMetadata(
  matchCount,
  poolCap,
  isAllSingle,
  forceSingleOnly,
  activePassSizes
) {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((size) => {
    const label = size === 1 ? "单关" : `${size}关`;
    let enabled = false;
    let disabledReason = null;
    if (matchCount === 0) {
      disabledReason = "请先选比赛";
    } else if (size === 1) {
      enabled = isAllSingle;
      if (!enabled) disabledReason = "所选含未开单关玩法";
    } else if (forceSingleOnly) {
      disabledReason = "当前选单仅限单关";
    } else if (size > matchCount) {
      disabledReason = `需选满${size}场`;
    } else if (size > poolCap) {
      disabledReason = poolCap <= 4 ? "含比分/半全场限4关" : "含总进球限6关";
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
        ? "当前选单仅限单关"
        : !enabled
          ? poolCap <= 4
            ? "含比分/半全场限4关"
            : "含总进球限6关"
          : null,
    };
  });
}

function buildBlockedTruthReport({
  matchCount,
  betCount = 0,
  totalCost = 0,
  multiple,
  modeLabel,
  canSingle,
  ruleBlockReason,
  poolCap,
  activePassSizes = [],
  activeComboCode = null,
  availableFreePasses,
  availableComboPasses,
  hasSameMatchCrossPoolConflict,
  dangerScore,
  syntheticHint,
  syntheticRescuePicks,
  warnings,
}) {
  return {
    matchCount,
    betCount,
    comboCount: 0,
    multiple,
    modeLabel,
    canSingle,
    canCheckout: false,
    ruleBlockReason,
    poolCap,
    activePassSizes,
    activeComboCode,
    availableFreePasses,
    availableComboPasses,
    hasSameMatchCrossPoolConflict,
    totalCost,
    minPayout: 0,
    maxPayout: 0,
    likelyRange: [0, 0],
    anyWinProb: 0,
    realProfitProb: 0,
    strictNetGainProb: 0,
    breakEvenProb: 0,
    underwaterCount: 0,
    underwaterShareOfWins: 0,
    avgPayoutRatio: 0,
    avgVigLossPer100: 0,
    expectedValueRate: 0,
    objectiveEVRate: 0,
    objectiveProfitProb: 0,
    objectiveStrictNetGainProb: 0,
    subjectiveProjectedEVRate: null,
    subjectiveProjectedProfitProb: null,
    dangerScore: dangerScore ?? (matchCount > 0 ? 45 : 0),
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

function sanitizeAndDeduplicatePicks(rawPicksInput, maxLen = 512) {
  if (!Array.isArray(rawPicksInput) || rawPicksInput.length === 0) return [];
  const out = [];
  const seen = new Set();
  const scanCap = Math.min(rawPicksInput.length, 4096);
  for (let i = 0; i < scanCap && out.length < maxLen; i++) {
    const p = rawPicksInput[i];
    if (
      !p ||
      typeof p !== "object" ||
      typeof p.matchId !== "string" ||
      typeof p.poolCode !== "string" ||
      typeof p.optionKey !== "string"
    ) {
      continue;
    }
    const sig = `${p.matchId}\0${p.poolCode}\0${p.optionKey}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(p);
  }
  return out;
}

/** 计算五维真相看板、体彩法定过关矩阵与 6 大防坑雷达（纯数学黑盒，遵循 ADR-0002 & ADR-0007） */
export function computeTruthReport(
  rawPicksInput,
  rawMultiple,
  matches,
  passSpec,
  matchAtomicMap = null,
  options = null
) {
  const multiple = Math.max(
    1,
    Math.min(999, Math.round(Number(rawMultiple) || 1))
  );
  const picks = sanitizeAndDeduplicatePicks(rawPicksInput, 512);

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
      modeLabel: "过关选择",
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
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === p.matchId)
      : null;
    const pool = fm?.pools?.[p.poolCode];
    if (
      pool &&
      (pool.selling === false ||
        !Array.isArray(pool.options) ||
        pool.options.length === 0)
    ) {
      return buildBlockedTruthReport({
        matchCount,
        multiple,
        modeLabel: "含停售盘口",
        canSingle: false,
        ruleBlockReason: `${fm.matchNumStr || ""}【${pool.name || p.poolCode}】当前未开售或已暂停销售`,
        poolCap: 8,
        availableFreePasses: buildFreePassMetadata(
          matchCount,
          8,
          false,
          false,
          []
        ),
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
        modeLabel: "无效赔率",
        canSingle: false,
        ruleBlockReason: "选单包含未开售或无效赔率选项",
        poolCap: 8,
        availableFreePasses: buildFreePassMetadata(
          matchCount,
          8,
          false,
          false,
          []
        ),
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
      if (pools.some((c) => c !== "HAD" && c !== "HHAD")) {
        hasIllegalCrossPoolPair = true;
      }
    }
  }

  const isPickSingleAllowed = (pk) => {
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === pk.matchId)
      : null;
    const pool = fm?.pools?.[pk.poolCode];
    if (pool && typeof pool.single === "boolean") {
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
    const m = Array.isArray(matches)
      ? matches.find((x) => x.id === matchGroups[0][0].matchId)
      : null;
    if (m && (!canSingle || !m.pools.HAD.single) && m.pools.HAFU?.single) {
      const grpKeys = matchGroups[0].map((g) => g.optionKey);
      const isOnlyDraw =
        grpKeys.includes("d") &&
        !grpKeys.includes("h") &&
        !grpKeys.includes("a");
      const isAwayLean =
        grpKeys.some((k) => k === "a" || k === "ha") && !grpKeys.includes("h");
      const rescueKeys = isOnlyDraw
        ? ["dd", "hd", "ad"]
        : isAwayLean
          ? ["aa", "da"]
          : ["hh", "dh"];
      const rescueOpts = rescueKeys
        .map((rk) => m.pools.HAFU.options.find((o) => o.key === rk))
        .filter(Boolean);
      if (rescueOpts.length >= 2) {
        const synEff =
          1 /
          rescueOpts.reduce((acc, o) => acc + 1 / Math.max(1.01, o.odds), 0);
        const labelPair = rescueOpts.map((o) => o.label).join("+");
        syntheticRescuePicks = rescueOpts.map((o) => ({
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "HAFU",
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

  if (
    hasIllegalCrossPoolPair ||
    (hasSameMatchCrossPoolConflict && !isAllSingle)
  ) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: "同场跨玩法禁串",
      canSingle: false,
      ruleBlockReason:
        "同一场比赛不能同时选择多种玩法进行串关，请取消同场跨玩法选项",
      poolCap,
      availableFreePasses: buildFreePassMetadata(
        matchCount,
        poolCap,
        false,
        false,
        []
      ),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: true,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "cross-pool-same-match",
          severity: "danger",
          title: "同场跨玩法违规（体彩严禁同一场不同玩法互串）",
          detail:
            "你在同一场比赛勾选了两种不同玩法且不满足双单关条件，体彩终端无法出票；请只保留一种玩法。",
        },
      ],
    });
  }

  if (matchCount > 15) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: "超15场上限",
      canSingle: false,
      ruleBlockReason: "中国体彩单次选单最多不超过 15 场赛事",
      poolCap,
      availableFreePasses: buildFreePassMetadata(
        matchCount,
        poolCap,
        false,
        false,
        []
      ),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "over-15-matches",
          severity: "danger",
          title: "超出 15 场单次选单上限",
          detail: "请精简场次至 15 场以内（串关最多 8 场）。",
        },
      ],
    });
  }

  if (matchCount > 8 && !isAllSingle) {
    return buildBlockedTruthReport({
      matchCount,
      multiple,
      modeLabel: "超8场串关上限",
      canSingle: false,
      ruleBlockReason: "中国体彩串关最多不能超过 8 场赛事",
      poolCap,
      availableFreePasses: buildFreePassMetadata(
        matchCount,
        poolCap,
        false,
        false,
        []
      ),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "over-8-matches",
          severity: "danger",
          title: "超出 8 场串关法定上限",
          detail: "竞彩足球串关最多允许选择 8 场比赛，请精简场次后再计算。",
        },
      ],
    });
  }

  if (matchCount === 1 && !canSingle) {
    return buildBlockedTruthReport({
      matchCount: 1,
      multiple,
      modeLabel: "还差1场凑2串1",
      canSingle: false,
      ruleBlockReason:
        "该玩法未开放单关，需再选至少 1 场比赛凑 2串1，或改选半全场/比分/总进球单关",
      poolCap,
      availableFreePasses: buildFreePassMetadata(1, poolCap, false, false, []),
      availableComboPasses: [],
      hasSameMatchCrossPoolConflict: false,
      syntheticHint,
      syntheticRescuePicks,
      warnings: [
        {
          id: "no-single",
          severity: "warn",
          title: "该玩法未开单关（当前无法单独出票，需再选 1 场）",
          detail:
            "体彩本场胜平负/让球未开放单关，需再串 1 场或直接改用「半全场 / 比分 / 总进球」合成单关。",
        },
      ],
    });
  }

  const forceSingleOnly = hasSameMatchCrossPoolConflict || matchCount > 8;
  const effectiveMaxPass = forceSingleOnly ? 1 : Math.min(matchCount, poolCap);
  const exactMTupleCount = matchGroups.reduce(
    (acc, grp) => Math.min(Number.MAX_SAFE_INTEGER, acc * grp.length),
    1
  );

  let activePassSizes = [];
  let activeComboCode = null;
  let modeLabel = "";

  if (forceSingleOnly || matchCount === 1) {
    activePassSizes = [1];
    modeLabel = "单关";
  } else if (passSpec?.mode === "combo" && passSpec.comboCode) {
    const presets = OFFICIAL_COMBO_PASS_TABLE[matchCount] ?? [];
    const matched = presets.find(
      (pr) =>
        pr.code === passSpec.comboCode &&
        pr.sizes.every((s) => s <= effectiveMaxPass)
    );
    if (matched) {
      activePassSizes = [...matched.sizes];
      activeComboCode = matched.code;
      modeLabel = matched.label;
    }
  } else if (passSpec?.mode === "free" && Array.isArray(passSpec.passSizes)) {
    const valid = Array.from(new Set(passSpec.passSizes.map((x) => Number(x))))
      .filter((k) => (k === 1 ? isAllSingle : k >= 2 && k <= effectiveMaxPass))
      .sort((a, b) => a - b);
    if (valid.length > 0) {
      activePassSizes = valid;
      modeLabel = valid.map((k) => (k === 1 ? "单关" : `${k}串1`)).join("+");
    }
  }

  if (activePassSizes.length === 0) {
    activePassSizes = [effectiveMaxPass];
    modeLabel = effectiveMaxPass === 1 ? "单关" : `${effectiveMaxPass}串1`;
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
    exactMTupleCount
  );

  // Exact O(M^2) combinatorial pre-count before ticket expansion: zero silent truncation
  let totalRawBetCount = 0;
  if (activeComboCode) {
    let baseSubsets = 0;
    for (const k of activePassSizes) {
      baseSubsets += combinationsOfIndices(matchCount, k).length;
    }
    totalRawBetCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      exactMTupleCount * baseSubsets
    );
  } else if (forceSingleOnly && hasSameMatchCrossPoolConflict) {
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      totalRawBetCount += matchGroups[mIdx].length;
    }
  } else {
    const elemSym = new Float64Array(matchCount + 1);
    elemSym[0] = 1;
    for (let mIdx = 0; mIdx < matchGroups.length; mIdx++) {
      const sz = matchGroups[mIdx].length;
      for (let k = mIdx + 1; k >= 1; k--) {
        elemSym[k] += elemSym[k - 1] * sz;
      }
    }
    for (const k of activePassSizes) {
      totalRawBetCount += Math.round(elemSym[k] ?? 0);
    }
  }

  const MAX_EXACT_SLIP_BETS = 2048;
  if (totalRawBetCount > MAX_EXACT_SLIP_BETS) {
    const trueTotalCost = totalRawBetCount * 2 * multiple;
    const over20k = trueTotalCost > 20_000;
    const blockWarnings = [
      {
        id: "over-2048-bets",
        severity: "danger",
        title: `🚨 复式组合爆炸拦截：当前共 ${totalRawBetCount} 注（超出实时精算 ${MAX_EXACT_SLIP_BETS} 注上限）`,
        detail:
          "大面积全包复式不仅触发指数级连乘抽水雪崩，也超出单次实时穷举上限。系统严禁静默砍单，请精简低概率包号、下调过关阶数，或直接使用【3+1精算配单】智能缩水。",
      },
    ];
    if (over20k) {
      blockWarnings.push({
        id: "order-limit-20k",
        severity: "danger",
        title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${trueTotalCost}）`,
        detail:
          "中国体彩规定单次订单投注金额不得超过 20,000 元，请精简包号或分批打票。",
      });
    }
    return buildBlockedTruthReport({
      matchCount,
      betCount: totalRawBetCount,
      totalCost: trueTotalCost,
      multiple,
      modeLabel,
      canSingle,
      ruleBlockReason: over20k
        ? `当前复式共 ${totalRawBetCount} 注（总金额 ¥${trueTotalCost}），超出单次 ${MAX_EXACT_SLIP_BETS} 注及体彩 ¥20,000 硬上限，请精简包号`
        : `当前复式共 ${totalRawBetCount} 注（总金额 ¥${trueTotalCost}），超出实时精算 ${MAX_EXACT_SLIP_BETS} 注上限，请精简包号或改用【3+1精算配单】`,
      poolCap,
      activePassSizes,
      activeComboCode,
      availableFreePasses,
      availableComboPasses,
      hasSameMatchCrossPoolConflict,
      dangerScore: 96,
      syntheticHint,
      syntheticRescuePicks,
      warnings: blockWarnings,
    });
  }

  const rawTickets = [];
  if (activeComboCode) {
    // 官方 M串N 多串过关复式规则：先对 M 场比赛取单场各1项笛卡尔积（共 exactMTupleCount 组 M串N 票），再逐组展开子串关
    let mTuples = [[]];
    for (const grp of matchGroups) {
      const next = [];
      for (const prev of mTuples) {
        for (const item of grp) {
          next.push([...prev, item]);
        }
      }
      mTuples = next;
    }
    for (const tuple of mTuples) {
      for (const k of activePassSizes) {
        const indexSubsets = combinationsOfIndices(matchCount, k);
        for (const subset of indexSubsets) {
          rawTickets.push({
            legs: subset.map((i) => tuple[i]),
            matchIndices: subset,
          });
        }
      }
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
          }
          for (const legs of tupleCartesian) {
            rawTickets.push({ legs, matchIndices: subset });
          }
        }
      }
    }
  }

  const betCount = rawTickets.length;
  const totalCost = betCount * 2 * multiple;

  const ticketRows = rawTickets.map((t, idx) => {
    const legOdds = t.legs.map((it) => it.odds);
    const cap = statutorySingleBetCap(effectiveNonVoidLegCount(legOdds));
    const prob = t.legs.reduce((acc, it) => acc * it.fairProb, 1);
    const unitBeforeCap = bankerRoundParlayUnitPayout(legOdds);
    const unitCapped = Math.min(cap, unitBeforeCap);
    const cappedClipped = Math.max(0, (unitBeforeCap - unitCapped) * multiple);
    const totalPayout = Math.round(unitCapped * multiple * 100) / 100;
    const netProfit = Math.round((totalPayout - totalCost) * 100) / 100;
    return {
      id: `tk-${idx}`,
      desc: t.legs
        .map((i) => `${i.matchNumStr}[${i.optionLabel}@${i.odds.toFixed(2)}]`)
        .join(" × "),
      legs: t.legs,
      matchIndices: t.matchIndices,
      multiple,
      cost: multiple * 2,
      prob,
      unitPayout: unitCapped,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  });

  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRows,
    totalCost,
    matches,
    matchAtomicMap,
    options
      ? { captureHitMatrix: true, ...options }
      : { captureHitMatrix: true }
  );
  const {
    combos,
    anyWinProb,
    realProfitProb,
    strictNetGainProb,
    breakEvenProb,
    minPayout,
    maxPayout,
    expectedValueRate,
    underwaterCount,
    underwaterShareOfWins,
    likelyRange: [likelyMin, likelyMax],
  } = jointEval;
  const comboCount = combos.length;
  const hasSubjectiveShift = Boolean(options?.hasSubjectiveShift);
  const objEvalForManual =
    hasSubjectiveShift && options?.precomputedObjectiveEval
      ? options.precomputedObjectiveEval
      : hasSubjectiveShift && options?.objectiveAtomicMap
        ? evaluateTicketsOnQuotientSpace(
            ticketRows,
            totalCost,
            matches,
            options.objectiveAtomicMap,
            {
              metricsOnly: true,
              reusableHitMatrix: options?.objectiveHitMatrix ?? null,
            }
          )
        : jointEval;

  const avgPassLen =
    activePassSizes.reduce((a, b) => a + b, 0) /
    Math.max(1, activePassSizes.length);
  const { avgPayoutRatio, vigPct: avgVigLossPer100 } =
    computeCapitalWeightedVig(ticketRows, matches);

  const invTicketOddsSum = ticketRows.reduce(
    (acc, c) => acc + 2 / Math.max(0.01, c.unitPayout),
    0
  );
  const effectiveOdds = invTicketOddsSum > 0 ? 1 / invTicketOddsSum : 0;

  let breakevenUpgradeCost = null;
  if (
    underwaterCount > 0 &&
    !activeComboCode &&
    activePassSizes.length === 1 &&
    effectiveOdds > 1.005 &&
    ticketRows.length <= 512
  ) {
    // Knaster-Tarski monotone fixed-point iteration: finds exact minimum integer N* in <= ~20 steps (<0.05ms for K<=512)
    let curN = Math.max(betCount, betCount * multiple);
    for (let step = 0; step < 64 && curN <= 10_000; step++) {
      const budgetC = curN * 2;
      let needed = 0;
      let infeasible = false;
      for (let i = 0; i < ticketRows.length; i++) {
        const u = ticketRows[i].unitPayout;
        if (!(u > 2.001)) {
          infeasible = true;
          break;
        }
        const mReq = Math.max(1, Math.ceil((budgetC - 1e-9) / u));
        if (mReq > 999) {
          infeasible = true;
          break;
        }
        needed += mReq;
      }
      if (infeasible) break;
      if (needed <= curN) {
        breakevenUpgradeCost = (step === 0 ? needed : curN) * 2;
        break;
      }
      curN = needed;
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
      id: "pool-pass-cap",
      severity: "tip",
      title: `玩法最高过关自动限流（已按最高 ${poolCap} 关拆票）`,
      detail:
        poolCap <= 4
          ? "所选包含「比分 / 半全场」玩法，按中国体彩规则单注最高仅限 4 关，已自动禁用 5~8 关。"
          : "所选包含「总进球」玩法，按中国体彩规则单注最高仅限 6 关，已自动禁用 7~8 关。",
    });
  }
  if (
    effectiveOdds > 0 &&
    effectiveOdds <= 1.0 &&
    activePassSizes.length === 1 &&
    activePassSizes[0] === matchCount
  ) {
    warnings.push({
      id: "guaranteed-loss",
      severity: "danger",
      title: `必亏盘红灯拦截（合成等效水位仅 ${effectiveOdds.toFixed(2)}）`,
      detail:
        "同场包号过多，无论如何分配倍数都注定亏本或大面积倒贴！请至少砍掉 1~2 个高赔低概率鸡肋项。",
    });
  } else if (underwaterCount > 0) {
    warnings.push({
      id: "underwater",
      severity: "danger",
      title: `假中奖警报：${underwaterCount}/${comboCount} 种命中场景实际倒贴钱！`,
      detail: `官网只给你看最高 ${maxPayout.toFixed(2)} 元，但低赔或局部命中时最低仅拿 ${minPayout.toFixed(2)} 元（净亏 ${(totalCost - minPayout).toFixed(2)} 元）。${
        breakevenUpgradeCost
          ? `✨ 开启奖金优化并将总本金调至 ${breakevenUpgradeCost} 元即可实现 100% 组合零亏损保本！`
          : "建议使用「三模奖金优化」重新分配各注倍数。"
      }`,
    });
  }
  if (hasSameMatchCrossPoolConflict) {
    warnings.push({
      id: "cross-pool-same-match",
      severity: "warn",
      title: "同场双单关独立计奖提醒（已强制锁定单关）",
      detail:
        "同一场比赛勾选了两个已开单关玩法，按中国体彩规则仅支持【单关】独立计奖，不可参与串关。",
    });
  }
  if (avgPassLen >= 2 && (avgPassLen >= 4 || avgPayoutRatio < 0.72)) {
    warnings.push({
      id: "parlay-vig",
      severity: "danger",
      title: `串关连乘抽水雪崩：体彩已暗扣 ${avgVigLossPer100}% 数学期望`,
      detail: `当前 ${modeLabel} 综合返还率跌至 ${(avgPayoutRatio * 100).toFixed(1)}%；建议在底栏「过关选择」改选 2关/3关 或 M串N 容错防黑单场。`,
    });
  }
  const maxPassUsed = ticketRows
    .filter((c) => c.cappedClipped > 0)
    .reduce(
      (mx, c) =>
        Math.max(
          mx,
          effectiveNonVoidLegCount((c.legs ?? []).map((g) => g.odds))
        ),
      Math.max(...activePassSizes)
    );
  const maxTierCap = statutorySingleBetCap(maxPassUsed);
  const totalClipped = ticketRows.reduce((a, c) => a + c.cappedClipped, 0);
  if (totalClipped > 0 || multiple > 99) {
    warnings.push({
      id: "cap-clip",
      severity: totalClipped > 0 ? "danger" : "warn",
      title:
        totalClipped > 0
          ? `封顶截断警告：有 ${totalClipped.toFixed(0)} 元超额奖金将被体彩无偿没收！`
          : `超出单张实票 99 倍上限（体彩店需拆成 ${Math.ceil(multiple / 99)} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${maxTierCap / 10000} 万元法定单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : "终端机单张实票最高 99 倍，已自动为你按 99 倍上限核算店面拆票张数。",
    });
  }
  const overOrder20k = totalCost > 20_000;
  if (overOrder20k) {
    warnings.push({
      id: "order-limit-20k",
      severity: "danger",
      title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${totalCost}）`,
      detail:
        "中国体彩规定单次订单投注金额不得超过 20,000 元，已拦截出票，请下调倍数或分批打票。",
    });
  } else if (totalCost > 6_000) {
    warnings.push({
      id: "rational-6k",
      severity: "warn",
      title: `大额投注风控提醒（当前总投入 ¥${totalCost} 已超 ¥6,000）`,
      detail: "触发体彩官方大额理性购彩阈值，请严格核对今日止损护栏额度。",
    });
  }

  const consolidatedTickets = Math.max(
    1,
    Math.min(24, Math.ceil(betCount / 3) * Math.ceil(multiple / 99))
  );

  const outReport = {
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
    strictNetGainProb,
    breakEvenProb,
    underwaterCount,
    underwaterShareOfWins,
    avgPayoutRatio,
    avgVigLossPer100,
    expectedValueRate,
    objectiveEVRate: objEvalForManual.expectedValueRate,
    objectiveProfitProb: objEvalForManual.realProfitProb,
    objectiveStrictNetGainProb: objEvalForManual.strictNetGainProb,
    subjectiveProjectedEVRate: hasSubjectiveShift ? expectedValueRate : null,
    subjectiveProjectedProfitProb: hasSubjectiveShift ? realProfitProb : null,
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
  if (jointEval.hitMatrix) {
    Object.defineProperty(outReport, "_reusableHitMatrix", {
      value: jointEval.hitMatrix,
      enumerable: false,
      configurable: true,
    });
  }
  return outReport;
}

function makeLeg(
  m,
  poolCode,
  optionKey,
  stance,
  precomputedStanceProbs = null
) {
  const pool = m.pools[poolCode];
  const opt =
    pool?.options.find((o) => o.key === optionKey || o.label === optionKey) ??
    pool?.options[0];
  if (!pool || !opt) return null;

  const stanceProbs =
    precomputedStanceProbs ??
    tiltAtomicProbsByStance(getMatchBaseAtomicProbs(m, [poolCode]), m, stance);
  const gl = resolveGoalLineNum(m, pool.name);
  const prob = sumOptionProbOnAtomic(
    stanceProbs,
    poolCode,
    opt.key,
    opt.label,
    gl
  );

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
    fairProb: prob > 0 ? prob : opt.fairProb,
  };
}

function repairUnderwaterMultiples(
  initialMults,
  unitPayouts,
  shouldRepair,
  maxTotalNotes = Infinity
) {
  const mults = initialMults.map((m) =>
    Math.max(1, Math.min(999, Math.round(m)))
  );
  if (!shouldRepair) return mults;

  for (let guard = 0; guard < 64; guard++) {
    const curNotes = mults.reduce((a, m) => a + m, 0);
    if (curNotes >= maxTotalNotes) break;
    const curCost = curNotes * 2;
    const uwIdx = unitPayouts.findIndex(
      (u, i) => u * mults[i] < curCost && mults[i] < 999 && u > 2.01
    );
    if (uwIdx === -1) break;
    mults[uwIdx] += 1;
  }
  return mults;
}

// Authentic combinatorial C(v, k, t) covering-wheel designs strictly satisfying v >= k >= t (t = 2, blocks.length < C(v, k),
// every t-pair of matches covered in >= 1 block, and missing ANY 1 match leaves >= 1 intact block).
const COVERING_WHEEL_DESIGNS = {
  5: [
    {
      name: "C(5,3,2)",
      maxK: 3,
      blocks: [
        [0, 1, 2],
        [0, 3, 4],
        [1, 3, 4],
        [2, 3, 4],
      ],
    },
    {
      name: "C(5,3,2)·轮转5注",
      maxK: 3,
      blocks: [
        [0, 1, 2],
        [1, 2, 3],
        [2, 3, 4],
        [0, 3, 4],
        [0, 1, 4],
      ],
    },
    {
      name: "5场2串1图兰分块",
      maxK: 2,
      blocks: [
        [0, 1],
        [2, 3],
        [2, 4],
        [3, 4],
      ],
    },
  ],
  6: [
    {
      name: "C(6,3,2)",
      maxK: 3,
      blocks: [
        [0, 1, 2],
        [0, 3, 4],
        [0, 4, 5],
        [1, 3, 5],
        [1, 2, 4],
        [2, 3, 5],
      ],
    },
  ],
  7: [
    {
      name: "C(7,3,2)",
      maxK: 3,
      blocks: [
        [0, 1, 3],
        [1, 2, 4],
        [2, 3, 5],
        [3, 4, 6],
        [0, 4, 5],
        [1, 5, 6],
        [0, 2, 6],
      ],
    },
  ],
  8: [
    {
      name: "C(8,4,2)",
      maxK: 4,
      blocks: [
        [0, 1, 2, 3],
        [0, 1, 4, 5],
        [0, 1, 6, 7],
        [2, 3, 4, 5],
        [2, 3, 6, 7],
        [4, 5, 6, 7],
      ],
    },
    {
      name: "8场3串1循环容错网",
      maxK: 3,
      blocks: [
        [0, 1, 3],
        [1, 2, 4],
        [2, 3, 5],
        [3, 4, 6],
        [4, 5, 7],
        [5, 6, 0],
        [6, 7, 1],
        [7, 0, 2],
      ].map((b) => [...b].sort((x, y) => x - y)),
    },
  ],
};

function buildDisjointPartitionDesigns(v, wheelLegs, poolCap) {
  const ranked = Array.from({ length: v }, (_, idx) => ({
    idx,
    odds: Number(wheelLegs[idx]?.odds ?? 1.8),
  })).sort((a, b) => a.odds - b.odds);
  const ord = ranked.map((r) => r.idx);
  const normBlocks = (rawBlocks) =>
    rawBlocks
      .filter((b) => b.length >= 2 && b.length <= poolCap)
      .map((b) => [...b].sort((x, y) => x - y));

  const out = [];
  const addWheelShape = (label, rawBlocks) => {
    const blocks = normBlocks(rawBlocks);
    if (blocks.length < 2 || blocks.length > 10) return;
    const covered = new Set(blocks.flat());
    if (covered.size !== v) return;
    for (let x = 0; x < v; x++) {
      if (!blocks.some((b) => !b.includes(x))) return;
    }
    out.push({
      name: label,
      maxK: Math.max(...blocks.map((b) => b.length)),
      blocks,
    });
  };

  if (v === 6) {
    addWheelShape("双3串1独立分块", [
      [ord[0], ord[3], ord[5]],
      [ord[1], ord[2], ord[4]],
    ]);
    addWheelShape("三组2串1独立分块", [
      [ord[0], ord[5]],
      [ord[1], ord[4]],
      [ord[2], ord[3]],
    ]);
    addWheelShape("6场双三角2串1图兰分块", [
      [ord[0], ord[2]],
      [ord[0], ord[4]],
      [ord[2], ord[4]],
      [ord[1], ord[3]],
      [ord[1], ord[5]],
      [ord[3], ord[5]],
    ]);
  } else if (v === 7) {
    addWheelShape("3串1+4串1独立分块", [
      [ord[0], ord[4], ord[6]],
      [ord[1], ord[2], ord[3], ord[5]],
    ]);
    addWheelShape("双2串1+3串1独立分块", [
      [ord[0], ord[6]],
      [ord[1], ord[5]],
      [ord[2], ord[3], ord[4]],
    ]);
  } else if (v === 8) {
    addWheelShape("双4串1独立分块", [
      [ord[0], ord[3], ord[5], ord[6]],
      [ord[1], ord[2], ord[4], ord[7]],
    ]);
    addWheelShape("双3串1+2串1独立分块", [
      [ord[0], ord[5], ord[7]],
      [ord[1], ord[4], ord[6]],
      [ord[2], ord[3]],
    ]);
    addWheelShape("四组2串1独立分块", [
      [ord[0], ord[7]],
      [ord[1], ord[6]],
      [ord[2], ord[5]],
      [ord[3], ord[4]],
    ]);
    addWheelShape("四组6串1对偶补集", [
      [ord[2], ord[3], ord[4], ord[5], ord[6], ord[7]],
      [ord[0], ord[1], ord[4], ord[5], ord[6], ord[7]],
      [ord[0], ord[1], ord[2], ord[3], ord[6], ord[7]],
      [ord[0], ord[1], ord[2], ord[3], ord[4], ord[5]],
    ]);
  }
  return out;
}

function isGenuinePairCoveringDesign(v, blocks) {
  if (
    v < 3 ||
    !Array.isArray(blocks) ||
    blocks.length < 2 ||
    blocks.some((b) => !Array.isArray(b) || b.length < 2 || b.length >= v)
  ) {
    return false;
  }
  for (let i = 0; i < v; i++) {
    for (let j = i + 1; j < v; j++) {
      let covered = false;
      for (let b = 0; b < blocks.length; b++) {
        if (blocks[b].includes(i) && blocks[b].includes(j)) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
  }
  return true;
}

function computeSurvivingMissOneFloor(lines, matchIds) {
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  if (!Array.isArray(matchIds) || matchIds.length < 2) {
    return Math.min(...lines.map((l) => l.returnPayout));
  }
  const perMissed = matchIds.map((missedId) => {
    const surv = lines.filter(
      (l) => !l.legs.some((g) => g.matchId === missedId)
    );
    if (surv.length === 0) return 0;
    let multiSum = 0;
    const singlePoolGroups = new Map();
    for (let i = 0; i < surv.length; i++) {
      const ln = surv[i];
      if (ln.legs.length >= 2) {
        multiSum += ln.returnPayout;
      } else if (ln.legs.length === 1) {
        const g = ln.legs[0];
        const gk = `${g.matchId}:${g.poolCode}`;
        const arr = singlePoolGroups.get(gk) ?? [];
        arr.push(ln.returnPayout);
        singlePoolGroups.set(gk, arr);
      }
    }
    let singleGuaranteedSum = 0;
    for (const arr of singlePoolGroups.values()) {
      singleGuaranteedSum += Math.min(...arr);
    }
    return Number((multiSum + singleGuaranteedSum).toFixed(2));
  });
  return Math.min(...perMissed);
}

function allocateWheelMeanCvar(
  blockSpecs,
  kickerSpec,
  matchIds,
  targetBudgetYuan,
  exactNotesOnly = false,
  condMissWeights = null,
  missSceneProbs = null
) {
  const allSpecs = kickerSpec ? [...blockSpecs, kickerSpec] : [...blockSpecs];
  const K = allSpecs.length;
  if (K === 0) return { lines: [], missOneReturn: 0 };

  const units = allSpecs.map((sp) => {
    const rawU = bankerRoundParlayUnitPayout(sp.legs.map((g) => g.odds));
    return Math.min(statutorySingleBetCap(sp.legs.length), rawU);
  });
  const probs = allSpecs.map((sp) =>
    sp.legs.reduce((a, g) => a * g.fairProb, 1)
  );
  const B = blockSpecs.length;
  const v = matchIds.length;

  // blockWeight[b][x] = conditional hit weight of block b when match x misses consensus (1 if deterministic avoid)
  const blockWeight =
    condMissWeights ??
    blockSpecs.map((sp) =>
      matchIds.map((mid) => (!sp.legs.some((g) => g.matchId === mid) ? 1 : 0))
    );

  // Normalize conditional miss-1 probability weights w_x (proportional to (1 - p_x) / p_x)
  let sceneProbs = null;
  if (Array.isArray(missSceneProbs) && missSceneProbs.length === v) {
    const sumW = missSceneProbs.reduce((a, w) => a + Math.max(0, w), 0);
    if (sumW > 0) {
      sceneProbs = Float64Array.from(
        missSceneProbs,
        (w) => Math.max(0, w) / sumW
      );
    }
  }

  const vec = new Float64Array(v);
  const ordIdx = Array.from({ length: v }, (_, i) => i);
  const evalCandidateMults = (candMults) => {
    let floorVal = Infinity;
    for (let x = 0; x < v; x++) {
      let s = 0;
      for (let b = 0; b < B; b++) {
        const w = blockWeight[b][x];
        if (w > 0) s += candMults[b] * units[b] * w;
      }
      vec[x] = s;
      if (s < floorVal) floorVal = s;
    }
    let tailAvg = 0;
    if (sceneProbs) {
      for (let i = 0; i < v; i++) ordIdx[i] = i;
      ordIdx.sort((a, b) => vec[a] - vec[b]);
      let remMass = 0.5;
      let weightedSum = 0;
      for (let r = 0; r < v && remMass > 1e-15; r++) {
        const idx = ordIdx[r];
        const take = Math.min(remMass, sceneProbs[idx]);
        weightedSum += take * vec[idx];
        remMass -= take;
      }
      const wCvar = weightedSum / 0.5;
      // Blend Rockafellar-Uryasev weighted CVaR_0.5 with worst-case floor & uniform tail so both probability-weighted and worst-case axes stay sharp
      const tailLen = Math.max(1, Math.ceil(v * 0.5));
      let uSum = 0;
      for (let t = 0; t < tailLen; t++) uSum += vec[ordIdx[t]];
      tailAvg = 0.8 * wCvar + 0.2 * (uSum / tailLen);
    } else {
      vec.sort();
      const tailLen = Math.max(1, Math.ceil(v * 0.5));
      let tailSum = 0;
      for (let t = 0; t < tailLen; t++) tailSum += vec[t];
      tailAvg = tailSum / tailLen;
    }
    let minLinePay = Infinity;
    let expRet = 0;
    let notes = 0;
    for (let i = 0; i < K; i++) {
      const m = candMults[i];
      notes += m;
      const lp = m * units[i];
      if (lp < minLinePay) minLinePay = lp;
      expRet += m * probs[i] * units[i];
    }
    const cost = notes * 2;
    return {
      floorVal: floorVal < Infinity ? floorVal : 0,
      tailAvg,
      tailRatio: tailAvg / cost,
      floorRatio: (minLinePay - cost) / cost,
      evRate: (expRet - cost) / cost,
    };
  };

  const solveForNotes = (totalNotes) => {
    const mults = new Array(K).fill(1);
    let rem = totalNotes - K;
    if (kickerSpec && rem >= 12) {
      const kickerExtra = Math.min(998, Math.max(0, Math.floor(rem * 0.06)));
      mults[K - 1] += kickerExtra;
      rem -= kickerExtra;
    }

    while (rem > 0) {
      let bestB = -1;
      let bestTail = -Infinity;
      let bestFloor = -Infinity;
      let bestMinLine = -Infinity;
      let bestEv = -Infinity;
      const step = rem > 32 ? Math.max(2, Math.floor(rem / 16)) : 1;

      for (let b = 0; b < B; b++) {
        if (mults[b] + step > 999) continue;
        mults[b] += step;
        const mRes = evalCandidateMults(mults);
        mults[b] -= step;
        const evScore = probs[b] * units[b];

        if (
          mRes.tailAvg > bestTail + 1e-9 ||
          (Math.abs(mRes.tailAvg - bestTail) <= 1e-9 &&
            mRes.floorVal > bestFloor + 1e-9) ||
          (Math.abs(mRes.tailAvg - bestTail) <= 1e-9 &&
            Math.abs(mRes.floorVal - bestFloor) <= 1e-9 &&
            mRes.floorRatio > bestMinLine + 1e-9) ||
          (Math.abs(mRes.tailAvg - bestTail) <= 1e-9 &&
            Math.abs(mRes.floorVal - bestFloor) <= 1e-9 &&
            Math.abs(mRes.floorRatio - bestMinLine) <= 1e-9 &&
            evScore > bestEv)
        ) {
          bestTail = mRes.tailAvg;
          bestFloor = mRes.floorVal;
          bestMinLine = mRes.floorRatio;
          bestEv = evScore;
          bestB = b;
        }
      }
      if (bestB === -1) break;
      mults[bestB] += step;
      rem -= step;
    }

    // 2-opt integer polish across blocks so nonsmooth ties never trap greedy steps
    for (let pass = 0; pass < 6; pass++) {
      let improved = false;
      let cur = evalCandidateMults(mults);
      for (let a = 0; a < B; a++) {
        if (mults[a] >= 999) continue;
        for (let b = 0; b < B; b++) {
          if (a === b || mults[b] <= 1) continue;
          mults[a] += 1;
          mults[b] -= 1;
          const nxt = evalCandidateMults(mults);
          const better =
            (nxt.tailAvg >= cur.tailAvg - 1e-9 &&
              nxt.floorRatio >= cur.floorRatio - 1e-9 &&
              nxt.evRate >= cur.evRate - 1e-9 &&
              (nxt.tailAvg > cur.tailAvg + 1e-6 ||
                nxt.floorRatio > cur.floorRatio + 1e-6 ||
                nxt.evRate > cur.evRate + 1e-6)) ||
            (nxt.tailAvg > cur.tailAvg + 1e-6 &&
              nxt.floorVal >= cur.floorVal - 1e-9);
          if (better) {
            cur = nxt;
            improved = true;
          } else {
            mults[a] -= 1;
            mults[b] += 1;
          }
        }
      }
      if (!improved) break;
    }

    return { mults, metrics: evalCandidateMults(mults) };
  };

  // 3-way integer neighborhood polish ((+2,-1,-1) and (-2,+1,+1)) run once on the selected note-trial winner (keeps 8-match latency <10ms!)
  const polishChosen3Opt = (mults) => {
    if (exactNotesOnly || B < 3 || B > 8 || v > 8) return;
    const isBetterMetrics = (nxt, cur) =>
      (nxt.tailAvg >= cur.tailAvg - 1e-9 &&
        nxt.floorRatio >= cur.floorRatio - 1e-9 &&
        nxt.evRate >= cur.evRate - 1e-9 &&
        (nxt.tailAvg > cur.tailAvg + 1e-6 ||
          nxt.floorRatio > cur.floorRatio + 1e-6 ||
          nxt.evRate > cur.evRate + 1e-6)) ||
      (nxt.tailAvg > cur.tailAvg + 1e-6 && nxt.floorVal >= cur.floorVal - 1e-9);
    const maxPasses = B <= 7 ? 2 : 1;
    for (let pass = 0; pass < maxPasses; pass++) {
      let improved3 = false;
      let cur = evalCandidateMults(mults);
      for (let a = 0; a < B; a++) {
        for (let b = 0; b < B; b++) {
          if (b === a) continue;
          for (let c = b + 1; c < B; c++) {
            if (c === a) continue;
            if (mults[a] + 2 <= 999 && mults[b] >= 2 && mults[c] >= 2) {
              mults[a] += 2;
              mults[b] -= 1;
              mults[c] -= 1;
              const nxt = evalCandidateMults(mults);
              if (isBetterMetrics(nxt, cur)) {
                cur = nxt;
                improved3 = true;
              } else {
                mults[a] -= 2;
                mults[b] += 1;
                mults[c] += 1;
              }
            }
            if (mults[a] >= 3 && mults[b] + 1 <= 999 && mults[c] + 1 <= 999) {
              mults[a] -= 2;
              mults[b] += 1;
              mults[c] += 1;
              const nxt = evalCandidateMults(mults);
              if (isBetterMetrics(nxt, cur)) {
                cur = nxt;
                improved3 = true;
              } else {
                mults[a] += 2;
                mults[b] -= 1;
                mults[c] -= 1;
              }
            }
          }
        }
      }
      if (!improved3) break;
    }
  };

  const maxNotes = Math.max(K, Math.floor(targetBudgetYuan / 2));
  const noteTrials = exactNotesOnly
    ? [maxNotes]
    : Array.from(
        new Set([
          maxNotes,
          Math.max(K, maxNotes - 1),
          Math.max(K, Math.floor(maxNotes * 0.95)),
        ])
      );
  const candidates = noteTrials.map((n) => solveForNotes(n));
  const nonDom = candidates.filter(
    (c) =>
      !candidates.some(
        (o) =>
          o !== c &&
          o.metrics.tailRatio >= c.metrics.tailRatio - 1e-9 &&
          o.metrics.floorRatio >= c.metrics.floorRatio - 1e-9 &&
          o.metrics.evRate >= c.metrics.evRate - 1e-9 &&
          (o.metrics.tailRatio > c.metrics.tailRatio + 1e-6 ||
            o.metrics.floorRatio > c.metrics.floorRatio + 1e-6 ||
            o.metrics.evRate > c.metrics.evRate + 1e-6)
      )
  );
  const chosen = (nonDom.length > 0 ? nonDom : candidates).sort(
    (a, b) =>
      b.metrics.tailRatio - a.metrics.tailRatio ||
      b.metrics.floorRatio - a.metrics.floorRatio ||
      b.metrics.evRate - a.metrics.evRate
  )[0];
  polishChosen3Opt(chosen.mults);

  const lines = materializePlanLines(allSpecs, chosen.mults);
  const missOneReturn = computeSurvivingMissOneFloor(lines, matchIds);
  const finalMetrics = evalCandidateMults(chosen.mults);
  return {
    lines,
    missOneReturn,
    weightedTailRatio: finalMetrics.tailRatio,
  };
}

function materializePlanLines(specs, mults) {
  const actualCost = mults.reduce((a, m) => a + m * 2, 0);
  return specs.map((sp, idx) => {
    const mult = mults[idx];
    const rawUnit = bankerRoundParlayUnitPayout(sp.legs.map((g) => g.odds));
    const cap = statutorySingleBetCap(sp.legs.length);
    const unitPayout = Math.min(cap, rawUnit);
    const cappedClipped = Math.max(
      0,
      Number(((rawUnit - unitPayout) * mult).toFixed(2))
    );
    const returnPayout = Number((unitPayout * mult).toFixed(2));
    const prob = sp.legs.reduce((a, g) => a * g.fairProb, 1);
    return {
      id: sp.id,
      roleLabel: sp.roleLabel,
      legs: sp.legs,
      modeLabel: sp.legs.length === 1 ? "单关" : `${sp.legs.length}串1`,
      multiple: mult,
      cost: mult * 2,
      unitPayout,
      cappedClipped,
      returnPayout,
      netProfit: Number((returnPayout - actualCost).toFixed(2)),
      prob,
    };
  });
}

/**
 * Exact Global 0-1 Knapsack Solver for Zero-Underwater Max-Profit-Prob Dutching (ADR-0010 / Spec 0009):
 * Given mutually disjoint ticket candidates and budget B (maxNotes = floor(B/2)),
 * solves over all total note counts N in [1..maxNotes] the exact subset S (|S| <= maxLinesCap)
 * maximizing sum_{i in S} prob_i subject to sum_{i in S} ceil(2N / unitPayout_i) <= N,
 * then water-fills any leftover slack notes to maximize the minimum net profit floor.
 */
function solveExactKnapsackDutching(
  rawSpecs,
  targetBudgetYuan,
  maxLinesCap = 64,
  { pinnedFirstId = null } = {}
) {
  const rawTargetNotes = Math.max(1, Math.floor(targetBudgetYuan / 2));
  const maxNotes = Math.max(1, Math.min(500, rawTargetNotes));
  const w1Limit = Math.min(maxLinesCap, maxNotes);
  const w1Threshold = 2 * maxNotes + 0.05;

  // Stage 1: Cheap Float64 pre-screen & exact weight-1 dominance pruning before BigInt banker-rounding
  const preValid = [];
  for (let i = 0; i < rawSpecs.length; i++) {
    const r = rawSpecs[i];
    const nonNull = r?.legs;
    if (!Array.isArray(nonNull) || nonNull.length === 0) continue;
    let legCap = 8;
    let prob = 1;
    let approxOddsProd = 1;
    let hasNull = false;
    for (let j = 0; j < nonNull.length; j++) {
      const g = nonNull[j];
      if (!g) {
        hasNull = true;
        break;
      }
      const pc = POOL_MAX_PASS[g.poolCode] ?? 8;
      if (pc < legCap) legCap = pc;
      prob *= g.fairProb;
      approxOddsProd *= g.odds;
    }
    if (hasNull || nonNull.length > legCap || !(prob > 0)) continue;
    const approxUnit = Math.min(
      statutorySingleBetCap(nonNull.length),
      2 * approxOddsProd
    );
    if (approxUnit <= 1.98) continue;
    preValid.push({
      r,
      legs: nonNull,
      prob,
      approxUnit,
      isPinned: pinnedFirstId !== null && r.id === pinnedFirstId,
    });
  }
  if (preValid.length === 0) return [];

  preValid.sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) ||
      b.prob - a.prob ||
      b.prob * b.approxUnit - a.prob * a.approxUnit
  );

  let pinnedItem = null;
  const valid = [];
  let guaranteedW1Count = 0;
  for (let i = 0; i < preValid.length; i++) {
    const pv = preValid[i];
    if (!pv.isPinned && pv.approxUnit >= w1Threshold) {
      if (guaranteedW1Count >= w1Limit) continue;
      guaranteedW1Count++;
    }
    const rawUnit =
      typeof pv.r.rawUnit === "number" && pv.r.rawUnit > 0
        ? pv.r.rawUnit
        : bankerRoundParlayUnitPayout(pv.legs.map((g) => g.odds));
    const unitPayout = Math.min(statutorySingleBetCap(pv.legs.length), rawUnit);
    if (!(unitPayout > 2.0)) continue;
    const built = {
      ...pv.r,
      legs: pv.legs,
      rawUnit,
      unitPayout,
      prob: pv.prob,
    };
    if (pv.isPinned && !pinnedItem) {
      pinnedItem = built;
    } else {
      valid.push(built);
    }
  }
  if (pinnedFirstId !== null && !pinnedItem) return [];
  if (!pinnedItem && valid.length === 0) return [];

  const effLinesCap = pinnedItem ? Math.max(0, maxLinesCap - 1) : maxLinesCap;
  valid.sort(
    (a, b) => b.prob - a.prob || b.prob * b.unitPayout - a.prob * a.unitPayout
  );
  const V = valid.length;
  const vProbs = new Float64Array(V);
  const vUnits = new Float64Array(V);
  for (let i = 0; i < V; i++) {
    vProbs[i] = valid[i].prob;
    vUnits[i] = valid[i].unitPayout;
  }
  const maxTakeable = Math.min(V, effLinesCap, maxNotes);
  let maxPossibleProb = pinnedItem ? pinnedItem.prob : 0;
  for (let i = 0; i < maxTakeable; i++) maxPossibleProb += vProbs[i];

  const buildBucketsForN = (N, remCap) => {
    const cost = 2 * N;
    const byW = Array.from({ length: remCap + 1 }, () => []);
    for (let i = 0; i < V; i++) {
      const it = valid[i];
      const w = Math.max(1, Math.ceil((cost - 1e-12) / it.unitPayout));
      if (w > remCap || w > 999) continue;
      const bucketLimit = Math.min(effLinesCap, Math.floor(remCap / w));
      if (byW[w].length < bucketLimit) {
        byW[w].push({ item: it, w });
      }
    }
    const w1 = remCap >= 1 ? byW[1] : [];
    const prefW1 = new Float64Array(w1.length + 1);
    for (let i = 0; i < w1.length; i++)
      prefW1[i + 1] = prefW1[i] + w1[i].item.prob;
    const heavy = [];
    for (let w = 2; w <= remCap; w++) {
      for (let j = 0; j < byW[w].length; j++) heavy.push(byW[w][j]);
    }
    return { w1, prefW1, heavy };
  };

  let bestProb = 0;
  let bestN = 0;

  // Zero-allocation typed buffers for the N-search loop
  const bucketCounts = new Int16Array(maxNotes + 1);
  const prefW1Buf = new Float64Array(w1Limit + 1);
  const heavyW = new Int16Array(Math.max(1, V));
  const heavyP = new Float64Array(Math.max(1, V));
  const dpVal = new Float64Array(maxNotes + 1);
  const dpCnt = new Int16Array(maxNotes + 1);

  for (let N = maxNotes; N >= 1; N--) {
    const cost = 2 * N - 1e-12;
    let wPin = 0;
    if (pinnedItem) {
      wPin = Math.max(1, Math.ceil(cost / pinnedItem.unitPayout));
      if (wPin > N || wPin > 999) continue;
    }
    const remCap = N - wPin;
    const capItems = Math.min(V, effLinesCap, remCap);
    let upperAtN = pinnedItem ? pinnedItem.prob : 0;
    for (let i = 0; i < capItems; i++) upperAtN += vProbs[i];
    if (upperAtN <= bestProb + 1e-13) {
      if (!pinnedItem) break;
      continue;
    }

    let curMax = -1;
    if (remCap === 0 || effLinesCap === 0 || V === 0) {
      curMax = pinnedItem ? pinnedItem.prob : -1;
    } else {
      bucketCounts.fill(0, 0, remCap + 1);
      let w1Len = 0;
      let hLen = 0;
      let sumAllW = 0;
      let countFitAll = 0;
      let probFitAll = 0;

      for (let i = 0; i < V; i++) {
        const w = Math.max(1, Math.ceil(cost / vUnits[i]));
        if (w > remCap || w > 999) continue;
        if (countFitAll < effLinesCap && sumAllW + w <= remCap) {
          sumAllW += w;
          countFitAll++;
          probFitAll += vProbs[i];
        }
        if (w === 1) {
          if (w1Len < effLinesCap && w1Len < remCap) {
            prefW1Buf[w1Len + 1] = prefW1Buf[w1Len] + vProbs[i];
            w1Len++;
          }
        } else {
          const lim = Math.min(effLinesCap, (remCap / w) | 0);
          if (bucketCounts[w] < lim) {
            bucketCounts[w]++;
            heavyW[hLen] = w;
            heavyP[hLen] = vProbs[i];
            hLen++;
          }
        }
      }

      const basePinP = pinnedItem ? pinnedItem.prob : 0;
      if (
        countFitAll === capItems &&
        basePinP + probFitAll >= upperAtN - 1e-15
      ) {
        curMax = basePinP + probFitAll;
      } else {
        dpVal.fill(-1, 0, remCap + 1);
        dpCnt.fill(0, 0, remCap + 1);
        dpVal[0] = 0;
        let maxReachedCap = 0;

        for (let h = 0; h < hLen; h++) {
          const w = heavyW[h];
          const p = heavyP[h];
          const hi = Math.min(remCap, maxReachedCap + w);
          for (let cap = hi; cap >= w; cap--) {
            const prev = dpVal[cap - w];
            if (prev >= 0 && dpCnt[cap - w] + 1 <= effLinesCap) {
              const cand = prev + p;
              if (cand > dpVal[cap] + 1e-15) {
                dpVal[cap] = cand;
                dpCnt[cap] = dpCnt[cap - w] + 1;
                if (cap > maxReachedCap) maxReachedCap = cap;
              }
            }
          }
        }

        for (let u = 0; u <= maxReachedCap; u++) {
          if (dpVal[u] < 0) continue;
          const maxTake1 = Math.min(w1Len, remCap - u, effLinesCap - dpCnt[u]);
          if (maxTake1 < 0) continue;
          const totP = basePinP + dpVal[u] + prefW1Buf[maxTake1];
          if (totP > curMax) curMax = totP;
        }
      }
    }

    if (curMax > bestProb + 1e-12) {
      bestProb = curMax;
      bestN = N;
      if (bestProb >= maxPossibleProb - 1e-15) break;
    }
  }

  if (bestN <= 0 || !(bestProb > 0)) return [];

  const chosen = [];
  let remBestCap = bestN;
  if (pinnedItem) {
    const wPinBest = Math.max(
      1,
      Math.ceil((2 * bestN - 1e-12) / pinnedItem.unitPayout)
    );
    chosen.push({ item: pinnedItem, w: wPinBest, isPinned: true });
    remBestCap -= wPinBest;
  }

  if (remBestCap > 0 && effLinesCap > 0 && V > 0) {
    const { w1, prefW1, heavy } = buildBucketsForN(bestN, remBestCap);
    const H = heavy.length;
    const rows = Array.from({ length: H + 1 }, () =>
      new Float64Array(remBestCap + 1).fill(-1)
    );
    const cntRows = Array.from(
      { length: H + 1 },
      () => new Int16Array(remBestCap + 1)
    );
    const takeBit = Array.from(
      { length: H + 1 },
      () => new Uint8Array(remBestCap + 1)
    );
    rows[0][0] = 0;

    for (let h = 0; h < H; h++) {
      const w = heavy[h].w;
      const p = heavy[h].item.prob;
      const prevR = rows[h];
      const nextR = rows[h + 1];
      const prevC = cntRows[h];
      const nextC = cntRows[h + 1];
      const tb = takeBit[h + 1];
      for (let cap = 0; cap <= remBestCap; cap++) {
        nextR[cap] = prevR[cap];
        nextC[cap] = prevC[cap];
      }
      for (let cap = w; cap <= remBestCap; cap++) {
        if (prevR[cap - w] >= 0 && prevC[cap - w] + 1 <= effLinesCap) {
          const cand = prevR[cap - w] + p;
          if (cand > nextR[cap] + 1e-15) {
            nextR[cap] = cand;
            nextC[cap] = prevC[cap - w] + 1;
            tb[cap] = 1;
          }
        }
      }
    }

    let bestU = 0;
    let bestTake1 = 0;
    let bestRecon = -1;
    for (let u = 0; u <= remBestCap; u++) {
      const baseP = rows[H][u];
      if (baseP < 0) continue;
      const t1 = Math.min(
        w1.length,
        remBestCap - u,
        effLinesCap - cntRows[H][u]
      );
      if (t1 < 0) continue;
      const tot = baseP + prefW1[t1];
      if (tot > bestRecon + 1e-15) {
        bestRecon = tot;
        bestU = u;
        bestTake1 = t1;
      }
    }

    const extraChosen = [];
    let curCap = bestU;
    for (let h = H; h >= 1; h--) {
      if (takeBit[h][curCap] === 1) {
        extraChosen.push(heavy[h - 1]);
        curCap -= heavy[h - 1].w;
      }
    }
    for (let i = 0; i < bestTake1; i++) {
      extraChosen.push(w1[i]);
    }
    extraChosen.sort(
      (a, b) =>
        b.item.prob - a.item.prob || a.item.unitPayout - b.item.unitPayout
    );
    for (const ec of extraChosen) chosen.push(ec);
  }
  if (chosen.length === 0) return [];
  const chosenSpecs = chosen.map((c, idx) => ({
    ...c.item,
    id: c.item.id || `mp-${idx + 1}`,
    roleLabel:
      c.item.roleLabel ||
      (idx === 0
        ? "零倒贴稳健主干"
        : idx === 1
          ? "一号防冷保本盾"
          : `防冷保本盾#${idx}`),
  }));
  let mults = chosen.map((c) => c.w);
  let targetFillNotes = bestN;
  if (rawTargetNotes > maxNotes && chosenSpecs.length > 0) {
    const hiCap = Math.min(rawTargetNotes, chosenSpecs.length * 999);
    const checkFeasibleAtN = (candN) => {
      const cStake = 2 * candN - 1e-12;
      let sumReq = 0;
      const reqArr = new Array(chosenSpecs.length);
      for (let i = 0; i < chosenSpecs.length; i++) {
        const wReq = Math.max(1, Math.ceil(cStake / chosenSpecs[i].unitPayout));
        if (wReq > 999) return null;
        sumReq += wReq;
        if (sumReq > candN) return null;
        reqArr[i] = wReq;
      }
      return reqArr;
    };
    let scaledReq = null;
    let scaledN = bestN;
    for (let candN = hiCap; candN >= Math.max(bestN, hiCap - 16); candN--) {
      const r = checkFeasibleAtN(candN);
      if (r) {
        scaledReq = r;
        scaledN = candN;
        break;
      }
    }
    if (!scaledReq && hiCap > bestN) {
      let lo = bestN;
      let hi = hiCap;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const r = checkFeasibleAtN(mid);
        if (r) {
          scaledReq = r;
          scaledN = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }
    if (scaledReq && scaledN > bestN) {
      mults = scaledReq;
      targetFillNotes = scaledN;
    } else {
      const maxBaseW = Math.max(1, ...mults);
      const kScale = Math.max(
        1,
        Math.min(Math.floor(rawTargetNotes / bestN), Math.floor(999 / maxBaseW))
      );
      if (kScale > 1) {
        mults = mults.map((m) => m * kScale);
        targetFillNotes = bestN * kScale;
      }
    }
  }
  let rem = targetFillNotes - mults.reduce((a, b) => a + b, 0);
  while (rem > 0) {
    let bestIdx = -1;
    let lowestRet = Infinity;
    let bestEv = -Infinity;
    const step = rem > 64 ? Math.max(1, Math.floor(rem / 32)) : 1;
    for (let i = 0; i < chosenSpecs.length; i++) {
      if (mults[i] >= 999) continue;
      const curRet = mults[i] * chosenSpecs[i].unitPayout;
      const ev = chosenSpecs[i].prob * chosenSpecs[i].unitPayout;
      if (
        curRet < lowestRet - 1e-9 ||
        (Math.abs(curRet - lowestRet) <= 1e-9 && ev > bestEv)
      ) {
        lowestRet = curRet;
        bestEv = ev;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const addStep = Math.min(step, 999 - mults[bestIdx], rem);
    mults[bestIdx] += addStep;
    rem -= addStep;
  }

  return materializePlanLines(chosenSpecs, mults);
}

function solveZeroUnderwaterDutching(rawSpecs, targetBudgetYuan) {
  let active = rawSpecs
    .map((r) => {
      const nonNull = (Array.isArray(r?.legs) ? r.legs : []).filter(Boolean);
      if (nonNull.length === 0) return null;
      const legCap = Math.min(
        ...nonNull.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8)
      );
      const legs = nonNull.slice(0, legCap);
      const rawUnit = bankerRoundParlayUnitPayout(legs.map((g) => g.odds));
      const unitPayout = Math.min(statutorySingleBetCap(legs.length), rawUnit);
      const prob = legs.reduce((a, g) => a * g.fairProb, 1);
      return { ...r, legs, rawUnit, unitPayout, prob };
    })
    .filter((x) => x && x.unitPayout >= 2.0);

  if (active.length === 0) return [];

  // Keep caller's primary spec at index 0; sort only secondary covers (indices 1..) by efficiency
  if (active.length > 2) {
    const head = active[0];
    const tail = active
      .slice(1)
      .sort(
        (a, b) =>
          b.prob * b.unitPayout - a.prob * a.unitPayout || b.prob - a.prob
      );
    active = [head, ...tail];
  }

  const maxNotes = Math.max(1, Math.floor(targetBudgetYuan / 2));

  while (active.length > 0) {
    const K = active.length;
    if (K === 1) {
      const m0 = Math.max(1, Math.min(999, maxNotes));
      return materializePlanLines(active, [m0]);
    }

    const invSum = active.reduce((a, x) => a + 2 / x.unitPayout, 0);
    const effOdds = invSum > 0 ? 1 / invSum : 0;

    let solvedMults = null;
    if (effOdds > 1.02 && maxNotes >= K) {
      const minSearchNotes = Math.max(K, Math.floor(maxNotes * 0.9));
      let bestFloorRatio = -Infinity;
      let bestEvRate = -Infinity;
      for (let candNotes = maxNotes; candNotes >= minSearchNotes; candNotes--) {
        const targetCost = candNotes * 2;
        const minMults = active.map((x) =>
          Math.max(1, Math.ceil(targetCost / x.unitPayout))
        );
        const sumMin = minMults.reduce((a, b) => a + b, 0);
        if (sumMin <= candNotes && Math.max(...minMults) <= 999) {
          const mults = [...minMults];
          let rem = candNotes - sumMin;
          while (rem > 0) {
            let bestIdx = -1;
            let lowestReturn = Infinity;
            let bestEv = -Infinity;
            for (let i = 0; i < K; i++) {
              if (mults[i] >= 999) continue;
              const curRet = mults[i] * active[i].unitPayout;
              const evScore = active[i].prob * active[i].unitPayout;
              if (
                curRet < lowestReturn - 1e-9 ||
                (Math.abs(curRet - lowestReturn) <= 1e-9 && evScore > bestEv)
              ) {
                lowestReturn = curRet;
                bestEv = evScore;
                bestIdx = i;
              }
            }
            if (bestIdx === -1) break;
            mults[bestIdx] += 1;
            rem -= 1;
          }
          const minRet = Math.min(
            ...mults.map((m, idx) => m * active[idx].unitPayout)
          );
          const floorRatio = (minRet - targetCost) / targetCost;
          const evRate =
            mults.reduce(
              (acc, m, idx) =>
                acc + m * active[idx].prob * active[idx].unitPayout,
              0
            ) /
              targetCost -
            1;
          if (
            floorRatio > bestFloorRatio + 1e-9 ||
            (Math.abs(floorRatio - bestFloorRatio) <= 1e-9 &&
              evRate > bestEvRate + 1e-9)
          ) {
            bestFloorRatio = floorRatio;
            bestEvRate = evRate;
            solvedMults = mults;
          }
        }
      }
    }

    if (solvedMults) {
      return materializePlanLines(active, solvedMults);
    }

    // Prune lowest-efficiency tail leg (never index 0 unless only 2 left, where index 1 is dropped)
    let dropIdx = active.length - 1;
    let worstScore = Infinity;
    for (let i = 1; i < active.length; i++) {
      const score = active[i].prob * active[i].unitPayout;
      if (score < worstScore) {
        worstScore = score;
        dropIdx = i;
      }
    }
    active.splice(dropIdx, 1);
  }

  return [];
}

function allocateSpearAndExactShield(
  spearSpecs,
  shieldSpec,
  targetBudgetYuan,
  { lockPrimarySpear = false, optimizeShieldUtility = false } = {}
) {
  const mappedSpears = spearSpecs
    .map((r) => {
      const legs = (r?.legs ?? []).filter(Boolean);
      if (legs.length === 0) return null;
      const rawUnit = bankerRoundParlayUnitPayout(legs.map((g) => g.odds));
      const unitPayout = Math.min(statutorySingleBetCap(legs.length), rawUnit);
      const prob = legs.reduce((a, g) => a * g.fairProb, 1);
      return { ...r, legs, rawUnit, unitPayout, prob };
    })
    .filter((x) => x && x.unitPayout >= 2.0);

  const cleanSpears = lockPrimarySpear
    ? mappedSpears.length > 1
      ? [
          mappedSpears[0],
          ...mappedSpears
            .slice(1)
            .sort((a, b) => b.prob * b.unitPayout - a.prob * a.unitPayout),
        ]
      : mappedSpears
    : mappedSpears.sort(
        (a, b) => b.prob * b.unitPayout - a.prob * a.unitPayout
      );

  if (cleanSpears.length === 0) return [];

  let effectiveShieldSpec = shieldSpec;
  if (
    !lockPrimarySpear &&
    cleanSpears.length === 1 &&
    shieldSpec &&
    Array.isArray(shieldSpec.legs) &&
    shieldSpec.legs.length > 0
  ) {
    const shRawU = bankerRoundParlayUnitPayout(
      shieldSpec.legs.map((g) => g.odds)
    );
    const shUnitU = Math.min(
      statutorySingleBetCap(shieldSpec.legs.length),
      shRawU
    );
    const shProb = shieldSpec.legs.reduce((a, g) => a * g.fairProb, 1);
    // Prevent post-rounding spear/shield EV inversion: higher unit-EV line must always be the primary spear
    if (
      shProb * shUnitU >
        cleanSpears[0].prob * cleanSpears[0].unitPayout + 1e-9 &&
      cleanSpears[0].unitPayout > 2.02
    ) {
      const oldSpear = cleanSpears[0];
      cleanSpears[0] = {
        id: oldSpear.id,
        roleLabel: oldSpear.roleLabel,
        legs: shieldSpec.legs,
        rawUnit: shRawU,
        unitPayout: shUnitU,
        prob: shProb,
      };
      effectiveShieldSpec = {
        id: shieldSpec.id,
        roleLabel: shieldSpec.roleLabel,
        legs: oldSpear.legs,
      };
    }
  }

  const solveAtTotalNotes = (totalNotes) => {
    const spearsLocal = cleanSpears.map((s) => ({ ...s }));
    const totalStake = totalNotes * 2;
    let cleanShield = null;
    if (
      effectiveShieldSpec &&
      Array.isArray(effectiveShieldSpec.legs) &&
      effectiveShieldSpec.legs.length > 0
    ) {
      const rawU = bankerRoundParlayUnitPayout(
        effectiveShieldSpec.legs.map((g) => g.odds)
      );
      const unitU = Math.min(
        statutorySingleBetCap(effectiveShieldSpec.legs.length),
        rawU
      );
      if (unitU > 2.02) {
        const exactShieldMult = Math.ceil(totalStake / unitU);
        const remNotes = totalNotes - exactShieldMult;
        if (
          exactShieldMult >= 1 &&
          exactShieldMult < totalNotes * 0.45 &&
          remNotes >= spearsLocal.length &&
          remNotes * spearsLocal[0].unitPayout >= totalStake
        ) {
          const shProb = effectiveShieldSpec.legs.reduce(
            (a, g) => a * g.fairProb,
            1
          );
          let chosenShieldMult = exactShieldMult;
          let chosenRoleLabel = effectiveShieldSpec.roleLabel;
          if (optimizeShieldUtility && spearsLocal.length === 1) {
            const sp0 = spearsLocal[0];
            const minSpear0 = Math.ceil((totalStake - 1e-12) / sp0.unitPayout);
            const maxShieldMult = Math.min(
              Math.floor((totalNotes - 1) / 2),
              totalNotes - minSpear0
            );
            if (maxShieldMult > exactShieldMult) {
              const refW = Math.max(2, targetBudgetYuan, totalStake);
              const GAMMA = 0.65;
              const pMiss = Math.max(0, 1 - sp0.prob - shProb);
              const missTerm =
                pMiss *
                Math.log(Math.max(1e-6, 1 - (GAMMA * totalStake) / refW));
              let bestU = -Infinity;
              for (let mSh = exactShieldMult; mSh <= maxShieldMult; mSh++) {
                const mSp = totalNotes - mSh;
                const u =
                  sp0.prob *
                    Math.log(
                      Math.max(
                        1e-6,
                        1 + (GAMMA * (mSp * sp0.unitPayout - totalStake)) / refW
                      )
                    ) +
                  shProb *
                    Math.log(
                      Math.max(
                        1e-6,
                        1 + (GAMMA * (mSh * unitU - totalStake)) / refW
                      )
                    ) +
                  missTerm;
                if (u > bestU + 1e-15) {
                  bestU = u;
                  chosenShieldMult = mSh;
                }
              }
              if (chosenShieldMult > exactShieldMult) {
                chosenRoleLabel = "对数效用协同副攻";
              }
            }
          }
          cleanShield = {
            ...effectiveShieldSpec,
            roleLabel: chosenRoleLabel,
            rawUnit: rawU,
            unitPayout: unitU,
            prob: shProb,
            exactMult: chosenShieldMult,
          };
        }
      }
    }

    const attackNotes = cleanShield
      ? totalNotes - cleanShield.exactMult
      : Math.max(spearsLocal.length, totalNotes);
    const finalStake =
      (attackNotes + (cleanShield ? cleanShield.exactMult : 0)) * 2;

    let attackMults = [];
    if (spearsLocal.length === 1) {
      attackMults = [Math.min(999, attackNotes)];
    } else if (spearsLocal.length === 2) {
      const sp0 = spearsLocal[0];
      const sp1 = spearsLocal[1];
      const min0 = Math.ceil((finalStake - 1e-12) / sp0.unitPayout);
      const min1 = Math.ceil((finalStake - 1e-12) / sp1.unitPayout);
      if (min0 + min1 <= attackNotes) {
        const refWealth = Math.max(2, targetBudgetYuan, finalStake);
        const GAMMA = 0.65;
        const pShield = cleanShield ? cleanShield.prob : 0;
        const uShieldTerm = cleanShield
          ? pShield *
            Math.log(
              Math.max(
                1e-6,
                1 +
                  (GAMMA *
                    (cleanShield.exactMult * cleanShield.unitPayout -
                      finalStake)) /
                    refWealth
              )
            )
          : 0;
        const pMiss = Math.max(0, 1 - sp0.prob - sp1.prob - pShield);
        const missTerm =
          pMiss *
          Math.log(Math.max(1e-6, 1 - (GAMMA * finalStake) / refWealth));
        const lo0 = cleanShield
          ? min0
          : Math.max(min0, Math.ceil(attackNotes / 2));
        const hi0 = attackNotes - min1;
        let bestM0 = hi0;
        let bestUtil = -Infinity;
        for (let m0 = Math.min(lo0, hi0); m0 <= hi0; m0++) {
          const m1 = attackNotes - m0;
          const u =
            sp0.prob *
              Math.log(
                Math.max(
                  1e-6,
                  1 + (GAMMA * (m0 * sp0.unitPayout - finalStake)) / refWealth
                )
              ) +
            sp1.prob *
              Math.log(
                Math.max(
                  1e-6,
                  1 + (GAMMA * (m1 * sp1.unitPayout - finalStake)) / refWealth
                )
              ) +
            uShieldTerm +
            missTerm;
          if (u > bestUtil + 1e-15) {
            bestUtil = u;
            bestM0 = m0;
          }
        }
        attackMults = [bestM0, attackNotes - bestM0];
      } else {
        spearsLocal.splice(1);
        attackMults = [Math.min(999, attackNotes)];
      }
    } else {
      const wSum =
        spearsLocal.reduce((a, s) => a + s.prob * s.unitPayout, 0) || 1;
      let rem = attackNotes;
      attackMults = spearsLocal.map((s, idx) => {
        if (idx === spearsLocal.length - 1) return Math.max(1, rem);
        const alloc = Math.max(
          1,
          Math.min(
            rem - (spearsLocal.length - 1 - idx),
            Math.round((attackNotes * s.prob * s.unitPayout) / wSum)
          )
        );
        rem -= alloc;
        return alloc;
      });
    }

    if (cleanShield) {
      const curTotalNotes =
        attackMults.reduce((a, b) => a + b, 0) + cleanShield.exactMult;
      const exactReq = Math.ceil((curTotalNotes * 2) / cleanShield.unitPayout);
      if (exactReq > cleanShield.exactMult && exactReq < curTotalNotes * 0.45) {
        const diff = exactReq - cleanShield.exactMult;
        if (attackMults[0] - diff >= 1) {
          attackMults[0] -= diff;
          cleanShield.exactMult = exactReq;
        }
      }
      return materializePlanLines(
        [...spearsLocal, cleanShield],
        [...attackMults, cleanShield.exactMult]
      );
    }

    return materializePlanLines(spearsLocal, attackMults);
  };

  const minReqNotes = cleanSpears.length + (effectiveShieldSpec ? 1 : 0);
  const maxNotes = Math.max(minReqNotes, Math.floor(targetBudgetYuan / 2));
  const minSearchNotes = Math.max(minReqNotes, Math.floor(maxNotes * 0.84));
  const noteStride =
    maxNotes > 250
      ? Math.max(1, Math.floor((maxNotes - minSearchNotes) / 40))
      : 1;
  const candSolutions = [];
  for (let n = maxNotes; n >= minSearchNotes; n -= noteStride) {
    const lines = solveAtTotalNotes(n);
    if (lines.length === 0) continue;
    const cost = lines.reduce((a, l) => a + l.cost, 0);
    const refWealth = Math.max(2, targetBudgetYuan, cost);
    const GAMMA = 0.65;
    let pSum = 0;
    let logUtil = 0;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      pSum += ln.prob;
      logUtil +=
        ln.prob *
        Math.log(
          Math.max(1e-6, 1 + (GAMMA * (ln.returnPayout - cost)) / refWealth)
        );
    }
    logUtil +=
      Math.max(0, 1 - pSum) *
      Math.log(Math.max(1e-6, 1 - (GAMMA * cost) / refWealth));
    const evRate =
      lines.reduce((a, l) => a + l.prob * l.returnPayout, 0) / cost - 1;
    const profitProb = lines
      .filter((l) => l.returnPayout >= cost - 1e-9)
      .reduce((a, l) => a + l.prob, 0);
    const spearReturnRatio = (lines[0].returnPayout - cost) / cost;
    candSolutions.push({
      lines,
      cost,
      logUtil,
      evRate,
      profitProb,
      spearReturnRatio,
    });
  }
  const nonDom = candSolutions.filter(
    (c) =>
      !candSolutions.some(
        (o) =>
          o !== c &&
          o.evRate >= c.evRate - 1e-9 &&
          o.profitProb >= c.profitProb - 1e-9 &&
          o.spearReturnRatio >= c.spearReturnRatio - 1e-9 &&
          (o.evRate > c.evRate + 1e-6 ||
            o.profitProb > c.profitProb + 1e-6 ||
            o.spearReturnRatio > c.spearReturnRatio + 1e-6)
      )
  );
  const pool = nonDom.length > 0 ? nonDom : candSolutions;
  pool.sort(
    (a, b) =>
      b.logUtil - a.logUtil ||
      b.evRate - a.evRate ||
      b.spearReturnRatio - a.spearReturnRatio ||
      b.cost - a.cost
  );
  return pool[0]?.lines ?? [];
}

function solveFullSlatePartitionDutching(
  selected,
  legOf,
  primaryPoolOf,
  targetBudgetYuan
) {
  const M = selected.length;
  if (M < 3) return [];
  const rawTargetNotes = Math.max(2, Math.floor(targetBudgetYuan / 2));
  const maxNotes = Math.max(2, Math.min(500, rawTargetNotes));

  const mainSinglePoolOf = (m) => {
    const hadOk =
      m.pools.HAD?.selling !== false &&
      m.pools.HAD?.single &&
      Array.isArray(m.pools.HAD?.options) &&
      m.pools.HAD.options.length >= 2;
    const hhadOk =
      m.pools.HHAD?.selling !== false &&
      m.pools.HHAD?.single &&
      Array.isArray(m.pools.HHAD?.options) &&
      m.pools.HHAD.options.length >= 2;
    if (hadOk && hhadOk) {
      const topHad = Math.max(
        ...m.pools.HAD.options.map((o) => o.fairProb || 0)
      );
      const topHhad = Math.max(
        ...m.pools.HHAD.options.map((o) => o.fairProb || 0)
      );
      return topHhad > topHad + 0.04 ? "HHAD" : "HAD";
    }
    return hadOk ? "HAD" : hhadOk ? "HHAD" : null;
  };

  const bestPoolOf = (m) => {
    const hadOk =
      m.pools.HAD?.selling !== false &&
      Array.isArray(m.pools.HAD?.options) &&
      m.pools.HAD.options.length >= 2;
    const hhadOk =
      m.pools.HHAD?.selling !== false &&
      Array.isArray(m.pools.HHAD?.options) &&
      m.pools.HHAD.options.length >= 2;
    if (hadOk && hhadOk) {
      const topHad = Math.max(
        ...m.pools.HAD.options.map((o) => o.fairProb || 0)
      );
      const topHhad = Math.max(
        ...m.pools.HHAD.options.map((o) => o.fairProb || 0)
      );
      return topHhad > topHad + 0.08 ? "HHAD" : "HAD";
    }
    return primaryPoolOf(m);
  };

  const buildBlockItems = (mIndices) => {
    if (mIndices.length === 1) {
      const m = selected[mIndices[0]];
      const sCode = mainSinglePoolOf(m);
      if (!sCode) return null;
      const cap = statutorySingleBetCap(1);
      const items = (m.pools[sCode]?.options ?? [])
        .map((o) => legOf(m, sCode, o.key))
        .filter(Boolean)
        .map((lg) => {
          const rawUnit = bankerRoundParlayUnitPayout([lg.odds]);
          const unitPayout = Math.min(cap, rawUnit);
          return { legs: [lg], rawUnit, unitPayout, prob: lg.fairProb };
        })
        .filter((it) => it.unitPayout > 2.0 && it.prob > 0);
      return items.length > 0 ? items : null;
    }
    const cap = statutorySingleBetCap(mIndices.length);
    let tuples = [[]];
    for (let i = 0; i < mIndices.length; i++) {
      const m = selected[mIndices[i]];
      const pCode = bestPoolOf(m);
      const opts = (m.pools[pCode]?.options ?? [])
        .map((o) => legOf(m, pCode, o.key))
        .filter(Boolean);
      if (opts.length === 0) return null;
      const next = [];
      for (let a = 0; a < tuples.length; a++) {
        for (let b = 0; b < opts.length; b++) {
          next.push([...tuples[a], opts[b]]);
        }
      }
      tuples = next;
    }
    const items = tuples
      .map((legs) => {
        const rawUnit = bankerRoundParlayUnitPayout(legs.map((g) => g.odds));
        const unitPayout = Math.min(cap, rawUnit);
        const prob = legs.reduce((a, g) => a * g.fairProb, 1);
        return { legs, rawUnit, unitPayout, prob };
      })
      .filter((it) => it.unitPayout > 2.0 && it.prob > 0);
    return items.length > 0 && items.length <= 30 ? items : null;
  };

  const makeRemainderBlocks = (remIdxs) => {
    const out = [];
    let cur = 0;
    while (cur < remIdxs.length) {
      const left = remIdxs.length - cur;
      if (left === 3) {
        out.push([remIdxs[cur], remIdxs[cur + 1], remIdxs[cur + 2]]);
        cur += 3;
      } else if (left >= 2) {
        out.push([remIdxs[cur], remIdxs[cur + 1]]);
        cur += 2;
      } else {
        break;
      }
    }
    return out;
  };

  const ranked = Array.from({ length: M }, (_, idx) => {
    const m = selected[idx];
    const pCode = bestPoolOf(m);
    const topP = Math.max(
      ...(m.pools[pCode]?.options ?? []).map((o) => o.fairProb || 0),
      0
    );
    return { idx, topP, singleCode: mainSinglePoolOf(m) };
  }).sort((a, b) => b.topP - a.topP);
  const ord = ranked.map((r) => r.idx);

  const partitions = [];
  if (M === 4) {
    partitions.push([
      [0, 1],
      [2, 3],
    ]);
    partitions.push([
      [0, 2],
      [1, 3],
    ]);
    partitions.push([
      [0, 3],
      [1, 2],
    ]);
  } else if (M >= 5) {
    partitions.push(makeRemainderBlocks(ord));
    const altOrd = [];
    for (let lo = 0, hi = M - 1; lo <= hi; lo++, hi--) {
      altOrd.push(ord[lo]);
      if (lo < hi) altOrd.push(ord[hi]);
    }
    partitions.push(makeRemainderBlocks(altOrd));
  }

  const singleCapable = ranked.filter((r) => r.singleCode !== null);
  for (const sTake of [1, 2, 3]) {
    if (singleCapable.length < sTake) continue;
    const remCount = M - sTake;
    if (remCount !== 0 && remCount < 2) continue;
    const sSet = new Set(singleCapable.slice(0, sTake).map((r) => r.idx));
    const blocks = Array.from(sSet).map((si) => [si]);
    const remIdxs = ord.filter((idx) => !sSet.has(idx));
    for (const rb of makeRemainderBlocks(remIdxs)) blocks.push(rb);
    const covered = new Set(blocks.flat());
    if (covered.size === M && blocks.length >= 2) {
      partitions.push(blocks);
    }
  }

  let bestLines = [];
  let bestUnionProb = -1;
  let bestEvScore = -Infinity;

  const noteTrials = Array.from(
    new Set([
      maxNotes,
      Math.max(2, maxNotes - 1),
      Math.max(2, Math.floor(maxNotes * 0.95)),
    ])
  );

  for (let pIdx = 0; pIdx < partitions.length; pIdx++) {
    const blocks = partitions[pIdx];
    const R = blocks.length;
    if (R < 2) continue;
    const blockItemLists = blocks.map(buildBlockItems);
    if (blockItemLists.some((b) => !b)) continue;

    for (const N of noteTrials) {
      if (N < R) continue;
      const cost = 2 * N - 1e-12;
      const bProb = Array.from({ length: R }, () =>
        new Float64Array(N + 1).fill(-1)
      );
      const bMask = Array.from({ length: R }, () => new Int32Array(N + 1));
      const bItemW = new Array(R);
      let feasibleAllBlocks = true;

      for (let q = 0; q < R; q++) {
        const items = blockItemLists[q];
        const Kq = items.length;
        const ws = new Int16Array(Kq);
        let minW = Infinity;
        for (let i = 0; i < Kq; i++) {
          const w = Math.max(1, Math.ceil(cost / items[i].unitPayout));
          const wFull =
            rawTargetNotes > maxNotes
              ? Math.max(
                  1,
                  Math.ceil((2 * rawTargetNotes - 1e-12) / items[i].unitPayout)
                )
              : w;
          ws[i] = w <= N && w <= 999 && wFull <= 999 ? w : 30000;
          if (ws[i] < minW) minW = ws[i];
        }
        if (minW > N) {
          feasibleAllBlocks = false;
          break;
        }
        bItemW[q] = ws;
        const dpP = new Float64Array(N + 1).fill(-1);
        const dpM = new Int32Array(N + 1);
        dpP[0] = 0;
        for (let i = 0; i < Kq; i++) {
          const w = ws[i];
          if (w > N) continue;
          const pr = items[i].prob;
          const bit = 1 << i;
          for (let c = N; c >= w; c--) {
            if (dpP[c - w] >= 0 && dpP[c - w] + pr > dpP[c] + 1e-15) {
              dpP[c] = dpP[c - w] + pr;
              dpM[c] = dpM[c - w] | bit;
            }
          }
        }
        let bestSoFar = -1;
        let bestM = 0;
        for (let c = 1; c <= N; c++) {
          if (dpM[c] !== 0 && dpP[c] > bestSoFar + 1e-15) {
            bestSoFar = Math.min(0.999999999, dpP[c]);
            bestM = dpM[c];
          }
          if (bestSoFar > 0) {
            bProb[q][c] = bestSoFar;
            bMask[q][c] = bestM;
          }
        }
        if (bProb[q][N] <= 0) {
          feasibleAllBlocks = false;
          break;
        }
      }
      if (!feasibleAllBlocks) continue;

      // Exact 1D DP maximizing sum_q -ln(1 - p_q(c_q)) <=> maximizing 1 - prod_q (1 - p_q(c_q))
      const logSurv = Array.from({ length: R + 1 }, () =>
        new Float64Array(N + 1).fill(-Infinity)
      );
      const choiceC = Array.from(
        { length: R + 1 },
        () => new Int16Array(N + 1)
      );
      logSurv[0][0] = 0;

      for (let q = 0; q < R; q++) {
        const prev = logSurv[q];
        const next = logSurv[q + 1];
        const ch = choiceC[q + 1];
        const bp = bProb[q];
        // Only distinct jump points of bp[c] need transition!
        const jumps = [];
        let lastP = -1;
        for (let c = 1; c <= N; c++) {
          if (bp[c] > lastP + 1e-15) {
            lastP = bp[c];
            jumps.push({
              c,
              gain: -Math.log(Math.max(1e-12, 1 - bp[c])),
            });
          }
        }
        for (let u = 0; u <= N; u++) {
          const baseVal = prev[u];
          if (baseVal < -1e30) continue;
          for (let j = 0; j < jumps.length; j++) {
            const jc = jumps[j].c;
            if (u + jc > N) break;
            const cand = baseVal + jumps[j].gain;
            if (cand > next[u + jc] + 1e-14) {
              next[u + jc] = cand;
              ch[u + jc] = jc;
            }
          }
        }
      }

      let bestU = -1;
      let bestGain = -Infinity;
      for (let u = R; u <= N; u++) {
        if (logSurv[R][u] > bestGain + 1e-14) {
          bestGain = logSurv[R][u];
          bestU = u;
        }
      }
      if (bestU < 0) continue;
      const unionProb = 1 - Math.exp(-bestGain);
      if (unionProb < bestUnionProb - 1e-12) continue;

      const chosenSpecs = [];
      let mults = [];
      let curU = bestU;
      for (let q = R - 1; q >= 0; q--) {
        const cq = choiceC[q + 1][curU];
        curU -= cq;
        const msk = bMask[q][cq];
        const items = blockItemLists[q];
        const ws = bItemW[q];
        for (let i = 0; i < items.length; i++) {
          if ((msk & (1 << i)) !== 0) {
            chosenSpecs.push({
              ...items[i],
              id: `mp-pt-${q + 1}-${chosenSpecs.length + 1}`,
              roleLabel:
                items[i].legs.length === 1
                  ? `分块单关稳胆#${q + 1}`
                  : `分块${items[i].legs.length}串1保本盾#${q + 1}`,
            });
            mults.push(ws[i]);
          }
        }
      }
      if (chosenSpecs.length === 0) continue;

      // Water-fill up to N (or scale up to rawTargetNotes when > 500)
      let fillTarget = N;
      if (rawTargetNotes > maxNotes) {
        const hiCap = Math.min(rawTargetNotes, chosenSpecs.length * 999);
        const tryScaleAt = (candN) => {
          const st = 2 * candN - 1e-12;
          const req = chosenSpecs.map((sp) =>
            Math.max(1, Math.ceil(st / sp.unitPayout))
          );
          const sReq = req.reduce((a, b) => a + b, 0);
          return sReq <= candN && Math.max(...req) <= 999 ? req : null;
        };
        let scaledOk = false;
        for (let candN = hiCap; candN >= Math.max(N, hiCap - 16); candN--) {
          const req = tryScaleAt(candN);
          if (req) {
            mults = req;
            fillTarget = candN;
            scaledOk = true;
            break;
          }
        }
        if (!scaledOk && hiCap > N) {
          let lo = N;
          let hi = hiCap;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const req = tryScaleAt(mid);
            if (req) {
              mults = req;
              fillTarget = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
        }
      }
      let rem = fillTarget - mults.reduce((a, b) => a + b, 0);
      while (rem > 0) {
        let bestI = -1;
        let bestEv = -Infinity;
        const step = rem > 64 ? Math.max(1, Math.floor(rem / 32)) : 1;
        for (let i = 0; i < chosenSpecs.length; i++) {
          if (mults[i] >= 999) continue;
          const ev = chosenSpecs[i].prob * chosenSpecs[i].unitPayout;
          if (ev > bestEv) {
            bestEv = ev;
            bestI = i;
          }
        }
        if (bestI < 0) break;
        const add = Math.min(step, 999 - mults[bestI], rem);
        mults[bestI] += add;
        rem -= add;
      }

      const candCost = mults.reduce((a, b) => a + b * 2, 0);
      const evScore =
        chosenSpecs.reduce(
          (acc, sp, idx) => acc + mults[idx] * sp.prob * sp.unitPayout,
          0
        ) /
          Math.max(2, candCost) -
        1;
      if (
        unionProb > bestUnionProb + 1e-12 ||
        (Math.abs(unionProb - bestUnionProb) <= 1e-12 &&
          evScore > bestEvScore + 1e-9)
      ) {
        bestUnionProb = unionProb;
        bestEvScore = evScore;
        bestLines = materializePlanLines(chosenSpecs, mults);
      }
    }
  }

  // On M = 3 when no HAD/HHAD is single-open: also check pivot [m_p x m_a] + [m_p x m_b] zero-underwater 2串1 pair
  if (M === 3 && singleCapable.length === 0) {
    for (let piv = 0; piv < 3; piv++) {
      const mP = selected[piv];
      const pCodeP = bestPoolOf(mP);
      const pivLeg = [...(mP.pools[pCodeP]?.options ?? [])]
        .map((o) => legOf(mP, pCodeP, o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb)[0];
      if (!pivLeg) continue;
      const others = [0, 1, 2].filter((x) => x !== piv);
      const wingItems = others.map((wi) => {
        const mw = selected[wi];
        const cw = bestPoolOf(mw);
        return (mw.pools[cw]?.options ?? [])
          .map((o) => legOf(mw, cw, o.key))
          .filter(Boolean)
          .map((lg) => {
            const rawUnit = bankerRoundParlayUnitPayout([pivLeg.odds, lg.odds]);
            const unitPayout = Math.min(200_000, rawUnit);
            return {
              legs: piv < wi ? [pivLeg, lg] : [lg, pivLeg],
              rawUnit,
              unitPayout,
              condProb: lg.fairProb,
              prob: pivLeg.fairProb * lg.fairProb,
            };
          })
          .filter((it) => it.unitPayout > 2.0 && it.condProb > 0);
      });
      if (wingItems.some((w) => w.length === 0)) continue;

      const N = maxNotes;
      const cost = 2 * N - 1e-12;
      const wingRes = wingItems.map((items) => {
        const dp = new Float64Array(N + 1).fill(-1);
        const msk = new Int32Array(N + 1);
        const ws = items.map((it) =>
          Math.max(1, Math.ceil(cost / it.unitPayout))
        );
        dp[0] = 0;
        for (let i = 0; i < items.length; i++) {
          const w = ws[i];
          if (w > N || w > 999) continue;
          for (let c = N; c >= w; c--) {
            if (
              dp[c - w] >= 0 &&
              dp[c - w] + items[i].condProb > dp[c] + 1e-15
            ) {
              dp[c] = dp[c - w] + items[i].condProb;
              msk[c] = msk[c - w] | (1 << i);
            }
          }
        }
        return { dp, msk, ws, items };
      });
      for (let c0 = 1; c0 < N; c0++) {
        const p0 = wingRes[0].dp[c0];
        if (p0 <= 0) continue;
        const c1 = N - c0;
        let bestP1 = -1;
        let bestC1 = 0;
        for (let k1 = 1; k1 <= c1; k1++) {
          if (wingRes[1].dp[k1] > bestP1) {
            bestP1 = wingRes[1].dp[k1];
            bestC1 = k1;
          }
        }
        if (bestP1 <= 0) continue;
        const pHit = pivLeg.fairProb * (1 - (1 - p0) * (1 - bestP1));
        if (pHit > bestUnionProb + 1e-12) {
          const specs = [];
          const ms = [];
          [
            [wingRes[0], c0, 1],
            [wingRes[1], bestC1, 2],
          ].forEach(([wr, cc, tag]) => {
            for (let i = 0; i < wr.items.length; i++) {
              if ((wr.msk[cc] & (1 << i)) !== 0) {
                specs.push({
                  ...wr.items[i],
                  id: `mp-piv-${tag}-${specs.length + 1}`,
                  roleLabel: `满场2串1保本翼#${tag}`,
                });
                ms.push(wr.ws[i]);
              }
            }
          });
          if (specs.length >= 2) {
            let rem = N - ms.reduce((a, b) => a + b, 0);
            while (rem > 0) {
              ms[0] = Math.min(999, ms[0] + 1);
              rem -= 1;
              if (ms[0] >= 999) break;
            }
            bestUnionProb = pHit;
            bestLines = materializePlanLines(specs, ms);
          }
        }
      }
    }
  }

  return bestLines;
}

/** 2. 生成 3+1 帕累托精算配单（支持锚定赛事雷达用户所选球队方向，导出兼容别名 generateFiveArchetypes） */
export function generateParetoPortfolio(
  targetMatches,
  budgetYuan,
  stance,
  unlockFullAgg,
  anchorPicks = []
) {
  const cleanBudget = Math.max(
    10,
    Math.round((Number(budgetYuan) || 100) / 2) * 2
  );
  if (!Array.isArray(targetMatches) || targetMatches.length === 0) return [];

  const selected = targetMatches.slice(0, 8);
  const baseAtomicMap = new Map();
  const stanceAtomicMap = new Map();
  for (const m of selected) {
    const baseA = getMatchBaseAtomicProbs(m);
    baseAtomicMap.set(m.id, baseA);
    stanceAtomicMap.set(m.id, tiltAtomicProbsByStance(baseA, m, stance));
  }

  const primaryPoolOf = (m) =>
    m.pools.HAD?.selling !== false && m.pools.HAD?.options?.length >= 2
      ? "HAD"
      : "HHAD";

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

  const legOf = (m, poolCode, optionKey) =>
    makeLeg(m, poolCode, optionKey, stance, stanceAtomicMap.get(m.id));

  const preferredPrimaryLeg = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const sortedAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb);
      const chosen = legOf(m, sortedAnc[0].poolCode, sortedAnc[0].optionKey);
      if (chosen) return chosen;
    }
    const pCode = primaryPoolOf(m);
    const poolOpts = m.pools[pCode]?.options ?? [];
    const legs = poolOpts.map((o) => legOf(m, pCode, o.key)).filter(Boolean);
    legs.sort((a, b) => b.fairProb - a.fairProb);
    return legs[0] ?? legOf(m, "HAFU", "hh");
  };

  const preferredHighProbMainLeg = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) return preferredPrimaryLeg(m);
    const cands = [];
    for (const code of ["HAD", "HHAD"]) {
      const pool = m.pools[code];
      if (!pool || pool.selling === false || !Array.isArray(pool.options))
        continue;
      for (const o of pool.options) {
        if (o.odds >= 1.18) {
          const lg = legOf(m, code, o.key);
          if (lg) cands.push(lg);
        }
      }
    }
    if (cands.length === 0) return preferredPrimaryLeg(m);
    cands.sort((a, b) => b.fairProb - a.fairProb);
    return cands[0];
  };

  const inferMatchDirection = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const topAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb)[0];
      const k = topAnc.optionKey;
      const lbl = topAnc.optionLabel || k;
      if (topAnc.poolCode === "HAD")
        return k === "a" ? "away" : k === "d" ? "draw" : "home";
      if (topAnc.poolCode === "HHAD") {
        const gl = resolveGoalLineNum(m, topAnc.poolName);
        if (k === "hh") return "home";
        if (k === "ha") return "away";
        return gl < 0 ? "home" : "away";
      }
      if (topAnc.poolCode === "HAFU") {
        return k.endsWith("a") ? "away" : k.endsWith("d") ? "draw" : "home";
      }
      if (topAnc.poolCode === "TTG") {
        if (k === "s0") return "draw";
      }
      if (topAnc.poolCode === "CRS") {
        if (lbl === "负其它" || k === "s1sa") return "away";
        if (lbl === "平其它" || k === "s1sd") return "draw";
        if (lbl === "胜其它" || k === "s1sh") return "home";
        const [hs, as] = lbl.split(":").map(Number);
        if (Number.isFinite(hs) && Number.isFinite(as)) {
          return hs < as ? "away" : hs === as ? "draw" : "home";
        }
      }
    }
    const top = preferredPrimaryLeg(m);
    return top?.optionKey === "a" || top?.optionKey === "ha" ? "away" : "home";
  };

  const secondaryDisjointLegInPool = (m, primaryLeg) => {
    if (!primaryLeg) return null;
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length >= 2) {
      const samePool = anc
        .filter(
          (a) =>
            a.poolCode === primaryLeg.poolCode &&
            a.optionKey !== primaryLeg.optionKey
        )
        .map((a) => legOf(m, a.poolCode, a.optionKey))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb);
      if (samePool[0]) return samePool[0];
    }
    const poolOpts = m.pools[primaryLeg.poolCode]?.options ?? [];
    const others = poolOpts
      .filter((o) => o.key !== primaryLeg.optionKey)
      .map((o) => legOf(m, primaryLeg.poolCode, o.key))
      .filter(Boolean)
      .sort((a, b) => b.fairProb - a.fairProb);

    if (anc && anc.length === 1) {
      const dir = inferMatchDirection(m);
      if (dir === "draw") {
        if (primaryLeg.poolCode === "HAD" || primaryLeg.poolCode === "HHAD")
          return null;
        if (primaryLeg.poolCode === "HAFU") {
          return (
            others.find((o) => ["dd", "hd", "ad"].includes(o.optionKey)) ?? null
          );
        }
        if (primaryLeg.poolCode === "CRS") {
          return (
            others.find((o) => {
              const lbl = o.optionLabel || o.optionKey;
              if (lbl === "平其它" || o.optionKey === "s1sd") return true;
              const [hs, as] = lbl.split(":").map(Number);
              return Number.isFinite(hs) && Number.isFinite(as) && hs === as;
            }) ?? null
          );
        }
        if (primaryLeg.poolCode === "TTG") {
          return (
            others.find((o) => o.optionKey === "s0" || o.optionKey === "s2") ??
            null
          );
        }
      }
      if (primaryLeg.poolCode === "HHAD") {
        const gl = resolveGoalLineNum(m, primaryLeg.poolName);
        if (primaryLeg.optionKey === "hh") {
          return gl < 0
            ? (others.find((o) => o.optionKey === "hd") ?? null)
            : null;
        }
        if (primaryLeg.optionKey === "ha") {
          return gl > 0
            ? (others.find((o) => o.optionKey === "hd") ?? null)
            : null;
        }
        if (primaryLeg.optionKey === "hd") {
          return (
            others.find(
              (o) => o.optionKey === (dir === "away" ? "ha" : "hh")
            ) ?? null
          );
        }
      }
    }

    return (
      others.find(
        (o) =>
          o.optionKey === "d" || o.optionKey === "hd" || o.optionKey === "dd"
      ) ??
      others[0] ??
      null
    );
  };

  const resolveDirectionSingleBundles = (m) => {
    const dir = inferMatchDirection(m);
    const hadDrawLeg =
      dir === "draw" && m.pools.HAD?.selling !== false && m.pools.HAD?.single
        ? legOf(m, "HAD", "d")
        : null;

    let hhadCompatLegs = [];
    if (
      dir !== "draw" &&
      m.pools.HHAD?.selling !== false &&
      m.pools.HHAD?.single
    ) {
      const gl = resolveGoalLineNum(m, m.pools.HHAD?.name);
      const compatKeys =
        dir === "home"
          ? gl < 0
            ? ["hh", "hd"]
            : ["hh"]
          : gl > 0
            ? ["ha", "hd"]
            : ["ha"];
      hhadCompatLegs = compatKeys
        .map((k) => legOf(m, "HHAD", k))
        .filter(Boolean);
    }

    let hafuCompatLegs = [];
    if (m.pools.HAFU?.selling !== false && m.pools.HAFU?.single) {
      const keys =
        dir === "draw"
          ? ["dd", "hd", "ad"]
          : dir === "away"
            ? ["aa", "da"]
            : ["hh", "dh"];
      hafuCompatLegs = keys.map((k) => legOf(m, "HAFU", k)).filter(Boolean);
    }

    let crsCompatLegs = [];
    if (m.pools.CRS?.selling !== false && m.pools.CRS?.single) {
      crsCompatLegs = (m.pools.CRS.options ?? [])
        .filter((o) => {
          const lbl = o.label || o.key;
          if (lbl === "胜其它" || o.key === "s1sh") return dir === "home";
          if (lbl === "平其它" || o.key === "s1sd") return dir === "draw";
          if (lbl === "负其它" || o.key === "s1sa") return dir === "away";
          const [hs, as] = lbl.split(":").map(Number);
          if (!Number.isFinite(hs) || !Number.isFinite(as)) return false;
          return dir === "draw"
            ? hs === as
            : dir === "away"
              ? hs < as
              : hs > as;
        })
        .map((o) => legOf(m, "CRS", o.label || o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb);
    }

    let ttgDrawLegs = [];
    if (
      dir === "draw" &&
      m.pools.TTG?.selling !== false &&
      m.pools.TTG?.single
    ) {
      ttgDrawLegs = ["s0", "s2"].map((k) => legOf(m, "TTG", k)).filter(Boolean);
    }

    return {
      dir,
      hadDrawLeg,
      hhadCompatLegs,
      hafuCompatLegs,
      crsCompatLegs,
      ttgDrawLegs,
    };
  };

  const anchorBadgeNote = hasUserAnchors
    ? `🎯 已同步赛事雷达已选方向：${Array.from(anchorsByMatch.entries())
        .map(([mid, pks]) => {
          const fm = selected.find((x) => x.id === mid);
          return `${fm?.matchNumStr ?? ""}${fm?.home ?? ""}[${pks.map((p) => p.optionLabel).join("/")}]`;
        })
        .join("、")}`
    : null;

  const packSlot = ({
    key,
    available = true,
    alphaKind,
    emptyReason = null,
    shortTab,
    badge,
    title,
    tagline,
    lines,
    savedCash = 0,
    missOneReturn = null,
    wipeoutMiss2Prob = null,
    reasons = [],
    prependWarningReason = null,
  }) => {
    if (!available || !Array.isArray(lines) || lines.length === 0) {
      return {
        key,
        available: false,
        alphaKind: alphaKind ?? "none",
        emptyReason,
        shortTab,
        badge,
        title,
        tagline,
        totalCost: 0,
        savedCash: cleanBudget,
        minReturn: 0,
        maxReturn: 0,
        winProb: 0,
        profitProb: 0,
        strictNetGainProb: 0,
        breakEvenProb: 0,
        expectedValueRate: 0,
        objectiveEVRate: 0,
        objectiveProfitProb: 0,
        objectiveStrictNetGainProb: 0,
        subjectiveProjectedEVRate: null,
        subjectiveProjectedProfitProb: null,
        underwaterCount: 0,
        zeroPayoutProb: null,
        missOneReturn: null,
        wipeoutMiss2Prob: null,
        vigPct: 0,
        reasons,
        lines: [],
      };
    }

    const totalCost = lines.reduce((a, l) => a + l.cost, 0);
    const effectiveSavedCash = Math.max(0, cleanBudget - totalCost);
    const ticketRows = lines.map((l) => ({
      id: l.id,
      desc: `${l.roleLabel}(${l.multiple}倍)`,
      legs: l.legs,
      multiple: l.multiple,
      cost: l.cost,
      unitPayout: l.unitPayout,
      totalPayout: l.returnPayout,
      cappedClipped: l.cappedClipped ?? 0,
    }));
    const jointEval = evaluateTicketsOnQuotientSpace(
      ticketRows,
      totalCost,
      selected,
      stanceAtomicMap,
      { metricsOnly: true }
    );
    const hasStanceFilter = stance !== "objective";
    const objEval = hasStanceFilter
      ? evaluateTicketsOnQuotientSpace(
          ticketRows,
          totalCost,
          selected,
          baseAtomicMap,
          { metricsOnly: true }
        )
      : jointEval;
    const { vigPct } = computeCapitalWeightedVig(lines, selected);

    const mergedReasons = [];
    if (prependWarningReason) mergedReasons.push(prependWarningReason);
    if (anchorBadgeNote) mergedReasons.push(anchorBadgeNote);
    for (const r of reasons) mergedReasons.push(r);

    return {
      key,
      available: true,
      ...(alphaKind ? { alphaKind } : {}),
      emptyReason: null,
      shortTab,
      badge,
      title,
      tagline:
        tagline ||
        `总投入 ¥${totalCost} · 保底返 ¥${jointEval.minPayout.toFixed(1)} ~ 最高 ¥${jointEval.maxPayout.toFixed(1)}`,
      totalCost,
      savedCash: effectiveSavedCash,
      minReturn: jointEval.minPayout,
      maxReturn: jointEval.maxPayout,
      winProb: jointEval.anyWinProb,
      profitProb: jointEval.realProfitProb,
      strictNetGainProb: jointEval.strictNetGainProb,
      breakEvenProb: jointEval.breakEvenProb,
      expectedValueRate: jointEval.expectedValueRate,
      objectiveEVRate: objEval.expectedValueRate,
      objectiveProfitProb: objEval.realProfitProb,
      objectiveStrictNetGainProb: objEval.strictNetGainProb,
      subjectiveProjectedEVRate: hasStanceFilter
        ? jointEval.expectedValueRate
        : null,
      subjectiveProjectedProfitProb: hasStanceFilter
        ? jointEval.realProfitProb
        : null,
      underwaterCount: jointEval.underwaterCount,
      zeroPayoutProb: Math.max(0, 1 - jointEval.anyWinProb),
      missOneReturn,
      ...(wipeoutMiss2Prob !== null ? { wipeoutMiss2Prob } : {}),
      vigPct,
      reasons: mergedReasons,
      lines,
    };
  };

  // Exact 4D unit-stake objective evaluator on coherent joint space Ω̃ for internal Pareto filtering
  const primaryConsensusLegs = selected.map(preferredHighProbMainLeg);
  const matchIdxById = new Map(selected.map((m, idx) => [m.id, idx]));
  const legCondCache = new Map();
  const getLegCondPair = (mIdx, lg) => {
    const ck = `${mIdx}:${lg.poolCode}:${lg.optionKey}`;
    const hit = legCondCache.get(ck);
    if (hit) return hit;
    const fm = selected[mIdx];
    const gl = resolveGoalLineNum(fm, lg.poolName);
    const aProbs = stanceAtomicMap.get(fm.id);
    const pLeg = primaryConsensusLegs[mIdx];
    const pGl = resolveGoalLineNum(fm, pLeg?.poolName);
    let numHit = 0;
    let denHit = 0;
    let numMiss = 0;
    let denMiss = 0;
    for (let a = 0; a < ATOMIC_TEMPLATES.length; a++) {
      const tpl = ATOMIC_TEMPLATES[a];
      const pa = aProbs[a];
      const hitConsensus = pLeg
        ? doesOptionHitAtomicTemplate(
            pLeg.poolCode,
            pLeg.optionKey,
            pLeg.optionLabel,
            pGl,
            tpl
          )
        : true;
      const hitLg = doesOptionHitAtomicTemplate(
        lg.poolCode,
        lg.optionKey,
        lg.optionLabel,
        gl,
        tpl
      );
      if (hitConsensus) {
        denHit += pa;
        if (hitLg) numHit += pa;
      } else {
        denMiss += pa;
        if (hitLg) numMiss += pa;
      }
    }
    const pair = [
      denHit > 0 ? numHit / denHit : 0,
      denMiss > 0 ? numMiss / denMiss : 0,
    ];
    legCondCache.set(ck, pair);
    return pair;
  };

  const evalLines4DObj = (lines, knownDisjoint = false) => {
    const cost = lines.reduce((a, l) => a + l.cost, 0);
    if (cost <= 0 || lines.length === 0) {
      return {
        evRate: -1,
        profitProb: 0,
        coveredFloorRatio: -1,
        missOneCvarRatio: 0,
      };
    }
    let evRate;
    let profitProb;
    let coveredFloorRatio;
    if (knownDisjoint) {
      let expRet = 0;
      let pProf = 0;
      let minPay = Infinity;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        expRet += ln.prob * ln.returnPayout;
        if (ln.returnPayout >= cost - 1e-9) pProf += ln.prob;
        if (ln.returnPayout > 0 && ln.returnPayout < minPay)
          minPay = ln.returnPayout;
      }
      evRate = (expRet - cost) / cost;
      profitProb = pProf;
      coveredFloorRatio = minPay < Infinity ? (minPay - cost) / cost : -1;
    } else {
      const ev = evaluateTicketsOnQuotientSpace(
        lines.map((l) => ({ ...l, totalPayout: l.returnPayout })),
        cost,
        selected,
        stanceAtomicMap,
        { metricsOnly: true }
      );
      evRate = ev.expectedValueRate;
      profitProb = ev.realProfitProb;
      coveredFloorRatio = ev.anyWinProb > 0 ? (ev.minPayout - cost) / cost : -1;
    }
    const M = selected.length;
    const missRatios = new Float64Array(M);
    for (let x = 0; x < M; x++) {
      let condRet = 0;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        let ticketCondProb = 1;
        for (let j = 0; j < ln.legs.length; j++) {
          const lg = ln.legs[j];
          const mIdx = matchIdxById.get(lg.matchId);
          if (mIdx === undefined) continue;
          const pair = getLegCondPair(mIdx, lg);
          ticketCondProb *= mIdx === x ? pair[1] : pair[0];
          if (ticketCondProb === 0) break;
        }
        condRet += ticketCondProb * ln.returnPayout;
      }
      missRatios[x] = condRet / cost;
    }
    missRatios.sort();
    const tailLen = Math.max(1, Math.ceil(M * 0.5));
    let tailSum = 0;
    for (let t = 0; t < tailLen; t++) tailSum += missRatios[t];
    return {
      evRate,
      profitProb,
      coveredFloorRatio,
      missOneCvarRatio: tailSum / tailLen,
    };
  };

  const filterNonDominatedCandidates = (items) =>
    items.filter(
      (c) =>
        !items.some(
          (o) =>
            o !== c &&
            o.obj.evRate >= c.obj.evRate - 1e-9 &&
            o.obj.profitProb >= c.obj.profitProb - 1e-9 &&
            o.obj.coveredFloorRatio >= c.obj.coveredFloorRatio - 1e-9 &&
            o.obj.missOneCvarRatio >= c.obj.missOneCvarRatio - 1e-9 &&
            (o.obj.evRate > c.obj.evRate + 1e-6 ||
              o.obj.profitProb > c.obj.profitProb + 1e-6 ||
              o.obj.coveredFloorRatio > c.obj.coveredFloorRatio + 1e-6 ||
              o.obj.missOneCvarRatio > c.obj.missOneCvarRatio + 1e-6)
        )
    );

  const evalLogWealthUtility = (lines, knownDisjoint = false) => {
    const cost = lines.reduce((a, l) => a + l.cost, 0);
    if (cost <= 0 || lines.length === 0) return -Infinity;
    const refWealth = Math.max(2, cleanBudget, cost);
    const GAMMA = 0.65;
    if (knownDisjoint) {
      let pSum = 0;
      let uSum = 0;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        pSum += ln.prob;
        uSum +=
          ln.prob *
          Math.log(
            Math.max(1e-6, 1 + (GAMMA * (ln.returnPayout - cost)) / refWealth)
          );
      }
      uSum +=
        Math.max(0, 1 - pSum) *
        Math.log(Math.max(1e-6, 1 - (GAMMA * cost) / refWealth));
      return uSum;
    }
    const ev = evaluateTicketsOnQuotientSpace(
      lines.map((l) => ({ ...l, totalPayout: l.returnPayout })),
      cost,
      selected,
      stanceAtomicMap,
      { metricsOnly: true }
    );
    let pSum = 0;
    let uSum = 0;
    for (let i = 0; i < ev.tiers.length; i++) {
      const t = ev.tiers[i];
      pSum += t.prob;
      uSum +=
        t.prob *
        Math.log(
          Math.max(1e-6, 1 + (GAMMA * (t.totalPayout - cost)) / refWealth)
        );
    }
    uSum +=
      Math.max(0, 1 - pSum) *
      Math.log(Math.max(1e-6, 1 - (GAMMA * cost) / refWealth));
    return uSum;
  };

  // =========================================================================
  // Slot ①: max-profit-prob (🛡️ 稳健保本 · 精确 0-1 背包覆盖态 100% 零假中奖真赚钱率全局最优)
  // =========================================================================
  let slot1Lines = [];
  let slot1AnchoredTwoMatchNote = null;

  const buildSinglePoolSpecs = (m, code, prefix) => {
    const pool = m.pools[code];
    if (
      !pool ||
      pool.selling === false ||
      !pool.single ||
      !Array.isArray(pool.options)
    )
      return null;
    const legs = pool.options
      .map((o) => legOf(m, code, code === "CRS" ? o.label || o.key : o.key))
      .filter(Boolean);
    if (legs.length === 0) return null;
    return legs.map((lg, idx) => ({
      id: `${prefix}-${idx + 1}`,
      roleLabel:
        code === "HAD" || code === "HHAD"
          ? idx === 0
            ? "零倒贴稳健主干"
            : `防冷保本盾#${idx}`
          : `合成单关·${pool.name}#${idx + 1}`,
      legs: [lg],
    }));
  };

  const buildPairCartesianSpecs = (mA, codeA, mB, codeB, prefix) => {
    const pA = mA.pools[codeA];
    const pB = mB.pools[codeB];
    if (
      !pA ||
      pA.selling === false ||
      !Array.isArray(pA.options) ||
      pA.options.length === 0
    )
      return null;
    if (
      !pB ||
      pB.selling === false ||
      !Array.isArray(pB.options) ||
      pB.options.length === 0
    )
      return null;
    const legsA = pA.options
      .map((o) => legOf(mA, codeA, o.key))
      .filter(Boolean);
    const legsB = pB.options
      .map((o) => legOf(mB, codeB, o.key))
      .filter(Boolean);
    if (legsA.length === 0 || legsB.length === 0) return null;
    const out = [];
    let idx = 1;
    for (let i = 0; i < legsA.length; i++) {
      for (let j = 0; j < legsB.length; j++) {
        out.push({
          id: `${prefix}-${idx++}`,
          roleLabel: idx === 2 ? "双场稳健主干" : `双场保本盾#${idx - 2}`,
          legs: [legsA[i], legsB[j]],
        });
      }
    }
    return out;
  };

  if (selected.length === 1) {
    const m1 = selected[0];
    const anc = anchorsByMatch.get(m1.id) ?? [];
    const ancSinglePool =
      anc.length > 0 &&
      anc.every(
        (a) =>
          m1.pools[a.poolCode]?.selling !== false &&
          m1.pools[a.poolCode]?.single &&
          a.poolCode === anc[0].poolCode
      )
        ? anc[0].poolCode
        : null;

    const candidateSets = [];
    if (ancSinglePool) {
      const ancLegs = anc
        .map((a) =>
          legOf(
            m1,
            a.poolCode,
            a.poolCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
          )
        )
        .filter(Boolean);
      candidateSets.push(
        ancLegs.map((lg, idx) => ({
          id: `mp-${idx + 1}`,
          roleLabel: idx === 0 ? "雷达主选铁干" : `防冷保本盾#${idx}`,
          legs: [lg],
        }))
      );
      if (ancLegs.length === 1) {
        const cov = secondaryDisjointLegInPool(m1, ancLegs[0]);
        if (cov) {
          candidateSets.push([
            { id: "mp-1", roleLabel: "雷达主选铁干", legs: [ancLegs[0]] },
            { id: "mp-2", roleLabel: "同盘防平保本盾", legs: [cov] },
          ]);
        }
      }
    } else if (anc.length > 0) {
      const {
        dir,
        hadDrawLeg,
        hhadCompatLegs,
        hafuCompatLegs,
        crsCompatLegs,
        ttgDrawLegs,
      } = resolveDirectionSingleBundles(m1);
      if (hadDrawLeg) {
        candidateSets.push([
          { id: "mp-had-d", roleLabel: "雷达锚定平局主干", legs: [hadDrawLeg] },
        ]);
      }
      if (hhadCompatLegs.length >= 1) {
        candidateSets.push(
          hhadCompatLegs.map((lg, idx) => ({
            id: `mp-hhad-${idx + 1}`,
            roleLabel: idx === 0 ? "顺向让球主干" : "一球卡盘保本盾",
            legs: [lg],
          }))
        );
      }
      if (hafuCompatLegs.length >= 2) {
        const ddLeg = legOf(m1, "HAFU", "dd");
        const fullHafu =
          dir !== "draw" &&
          ddLeg &&
          !hafuCompatLegs.some((g) => g.optionKey === "dd")
            ? [...hafuCompatLegs, ddLeg]
            : hafuCompatLegs;
        candidateSets.push(
          fullHafu.map((lg, idx) => ({
            id: `mp-hafu-${idx + 1}`,
            roleLabel: idx === 0 ? "合成单关·主干" : `合成单关·护盾#${idx}`,
            legs: [lg],
          }))
        );
      }
      if (crsCompatLegs.length >= 2) {
        candidateSets.push(
          crsCompatLegs.map((lg, idx) => ({
            id: `mp-crs-${idx + 1}`,
            roleLabel: `合成单关·比分#${idx + 1}`,
            legs: [lg],
          }))
        );
      }
      if (ttgDrawLegs.length >= 2) {
        candidateSets.push(
          ttgDrawLegs.map((lg, idx) => ({
            id: `mp-ttgd-${idx + 1}`,
            roleLabel: `合成单关·平局进球#${idx + 1}`,
            legs: [lg],
          }))
        );
      }
    } else {
      for (const code of ["HAD", "HHAD", "HAFU", "TTG", "CRS"]) {
        const sp = buildSinglePoolSpecs(m1, code, `mp-${code}`);
        if (sp) candidateSets.push(sp);
      }
    }

    const pinSingleFirst = anc.length === 1;
    const slot1Cands = [];
    for (const cs of candidateSets) {
      const lines = solveExactKnapsackDutching(
        cs,
        cleanBudget,
        64,
        pinSingleFirst && cs[0] ? { pinnedFirstId: cs[0].id } : {}
      );
      if (lines.length === 0) continue;
      const obj = evalLines4DObj(lines, true);
      if (obj.coveredFloorRatio < -1e-9) continue;
      slot1Cands.push({ lines, obj });
    }
    slot1Cands.sort(
      (a, b) =>
        b.obj.profitProb - a.obj.profitProb ||
        b.obj.coveredFloorRatio - a.obj.coveredFloorRatio ||
        b.obj.evRate - a.obj.evRate
    );
    if (slot1Cands[0]) slot1Lines = slot1Cands[0].lines;
  } else if (!hasUserAnchors) {
    // Full-slate fair comparison (Spec 0012 / ADR-0013): retain ALL M user-selected matches (up to statutory passCap);
    // never silently drop M-1 matches to bet 1 single! Surface core 1~2-match benchmark only as a bottom note in reasons.
    const candidateSpecGroups = [];
    const primPools = selected.map((m) => primaryPoolOf(m));
    const passCap = Math.min(
      selected.length,
      ...primPools.map((c) => POOL_MAX_PASS[c] ?? 8)
    );

    if (selected.length === 2) {
      for (const c1 of ["HAD", "HHAD"]) {
        for (const c2 of ["HAD", "HHAD"]) {
          const pairSp = buildPairCartesianSpecs(
            selected[0],
            c1,
            selected[1],
            c2,
            `mp-p-0-1-${c1}-${c2}`
          );
          if (pairSp) candidateSpecGroups.push(pairSp);
        }
      }
      // Hybrid [Single on single-open Match S + 2串1 on complement x Partner Match P] pairwise-disjoint groups covering BOTH matches
      for (let i = 0; i < 2; i++) {
        const j = 1 - i;
        const mS = selected[i];
        const mP = selected[j];
        for (const cS of ["HAD", "HHAD"]) {
          const pS = mS.pools[cS];
          if (
            !pS ||
            pS.selling === false ||
            !pS.single ||
            !Array.isArray(pS.options) ||
            pS.options.length < 2
          ) {
            continue;
          }
          const legsS = pS.options
            .map((o) => legOf(mS, cS, o.key))
            .filter(Boolean);
          if (legsS.length < 2) continue;
          for (const cP of ["HAD", "HHAD"]) {
            const pP = mP.pools[cP];
            if (
              !pP ||
              pP.selling === false ||
              !Array.isArray(pP.options) ||
              pP.options.length === 0
            ) {
              continue;
            }
            const legsP = pP.options
              .map((o) => legOf(mP, cP, o.key))
              .filter(Boolean);
            if (legsP.length === 0) continue;
            const fullMask = (1 << legsS.length) - 1;
            for (let sMask = 1; sMask < fullMask; sMask++) {
              const hybridSpecs = [];
              let hIdx = 1;
              for (let a = 0; a < legsS.length; a++) {
                if ((sMask & (1 << a)) !== 0) {
                  hybridSpecs.push({
                    id: `mp-hyb-${i}-${j}-${cS}-${cP}-${sMask}-${hIdx++}`,
                    roleLabel:
                      hIdx === 2 ? "单关稳健主干" : `单关保本盾#${hIdx - 2}`,
                    legs: [legsS[a]],
                  });
                }
              }
              for (let a = 0; a < legsS.length; a++) {
                if ((sMask & (1 << a)) === 0) {
                  for (let b = 0; b < legsP.length; b++) {
                    hybridSpecs.push({
                      id: `mp-hyb-${i}-${j}-${cS}-${cP}-${sMask}-${hIdx++}`,
                      roleLabel: `跨场2串1保本盾#${hIdx - 1}`,
                      legs: [legsS[a], legsP[b]],
                    });
                  }
                }
              }
              if (hybridSpecs.length >= 2) {
                candidateSpecGroups.push(hybridSpecs);
              }
            }
          }
        }
      }
    } else {
      const bestEffPools = selected.map((m) => {
        const hadOk =
          m.pools.HAD?.selling !== false &&
          Array.isArray(m.pools.HAD?.options) &&
          m.pools.HAD.options.length >= 2;
        const hhadOk =
          m.pools.HHAD?.selling !== false &&
          Array.isArray(m.pools.HHAD?.options) &&
          m.pools.HHAD.options.length >= 2;
        if (hadOk && hhadOk) {
          return (m.pools.HHAD.payoutRatio ?? 0.88) >
            (m.pools.HAD.payoutRatio ?? 0.88) + 0.005
            ? "HHAD"
            : "HAD";
        }
        return hadOk ? "HAD" : "HHAD";
      });
      const poolProfiles = [primPools];
      if (
        selected.length <= 5 &&
        bestEffPools.join(",") !== primPools.join(",")
      ) {
        poolProfiles.push(bestEffPools);
      }
      for (let pIdx = 0; pIdx < poolProfiles.length; pIdx++) {
        const prof = poolProfiles[pIdx];
        let mCartesian = [[]];
        for (let idx = 0; idx < passCap; idx++) {
          const m = selected[idx];
          const pCode = prof[idx];
          const opts = (m.pools[pCode]?.options ?? [])
            .map((o) => legOf(m, pCode, o.key))
            .filter(Boolean);
          if (opts.length === 0) break;
          const next = [];
          for (let a = 0; a < mCartesian.length; a++) {
            for (let b = 0; b < opts.length; b++) {
              next.push([...mCartesian[a], opts[b]]);
            }
          }
          mCartesian = next;
        }
        if (mCartesian.length > 0 && mCartesian[0].length === passCap) {
          candidateSpecGroups.push(
            mCartesian.map((legs, idx) => ({
              id: `mp-m-${pIdx}-${idx + 1}`,
              roleLabel: idx === 0 ? "全关稳健主干" : `全关保本盾#${idx}`,
              legs,
            }))
          );
        }
      }
    }

    let bestObj = null;
    for (let g = 0; g < candidateSpecGroups.length; g++) {
      const lines = solveExactKnapsackDutching(
        candidateSpecGroups[g],
        cleanBudget
      );
      if (lines.length === 0) continue;
      const distinctMids = new Set();
      for (let li = 0; li < lines.length; li++) {
        const lgs = lines[li].legs;
        for (let gi = 0; gi < lgs.length; gi++) {
          distinctMids.add(lgs[gi].matchId);
        }
      }
      if (distinctMids.size < passCap) continue;
      const obj = evalLines4DObj(lines, true);
      if (obj.coveredFloorRatio < -1e-9) continue;
      if (
        !bestObj ||
        obj.profitProb > bestObj.obj.profitProb + 1e-12 ||
        (Math.abs(obj.profitProb - bestObj.obj.profitProb) <= 1e-12 &&
          (obj.coveredFloorRatio > bestObj.obj.coveredFloorRatio + 1e-9 ||
            obj.evRate > bestObj.obj.evRate + 1e-9))
      ) {
        bestObj = { lines, obj };
      }
    }
    if (selected.length >= 3) {
      const partLines = solveFullSlatePartitionDutching(
        selected,
        legOf,
        primaryPoolOf,
        cleanBudget
      );
      if (partLines.length > 0) {
        const distinctPart = new Set(
          partLines.flatMap((l) => l.legs.map((g) => g.matchId))
        );
        if (distinctPart.size >= passCap) {
          const partObj = evalLines4DObj(partLines, false);
          if (
            partObj.coveredFloorRatio >= -1e-9 &&
            (!bestObj ||
              partObj.profitProb > bestObj.obj.profitProb + 1e-12 ||
              (Math.abs(partObj.profitProb - bestObj.obj.profitProb) <= 1e-12 &&
                partObj.evRate > bestObj.obj.evRate + 1e-9))
          ) {
            bestObj = { lines: partLines, obj: partObj };
          }
        }
      }
    }
    if (bestObj) slot1Lines = bestObj.lines;

    if (selected.length >= 3) {
      let bestSubProb = 0;
      let bestSubMatches = 2;
      for (let i = 0; i < selected.length; i++) {
        for (const code of ["HAD", "HHAD"]) {
          const sp = buildSinglePoolSpecs(
            selected[i],
            code,
            `mp-sub1-${i}-${code}`
          );
          if (!sp) continue;
          const l1 = solveExactKnapsackDutching(sp, cleanBudget);
          if (l1.length > 0) {
            const p1 = evalLines4DObj(l1, true).profitProb;
            if (p1 > bestSubProb) {
              bestSubProb = p1;
              bestSubMatches = 1;
            }
          }
        }
      }
      const pairRank = [];
      for (let i = 0; i < selected.length; i++) {
        const topI = Math.max(
          ...(selected[i].pools[primPools[i]]?.options ?? []).map(
            (o) => o.fairProb || 0
          ),
          0
        );
        for (let j = i + 1; j < selected.length; j++) {
          const topJ = Math.max(
            ...(selected[j].pools[primPools[j]]?.options ?? []).map(
              (o) => o.fairProb || 0
            ),
            0
          );
          pairRank.push({ i, j, score: topI * topJ });
        }
      }
      pairRank.sort((a, b) => b.score - a.score);
      for (const { i, j } of pairRank.slice(0, 4)) {
        const pairSp = buildPairCartesianSpecs(
          selected[i],
          primPools[i],
          selected[j],
          primPools[j],
          `mp-sub2-${i}-${j}`
        );
        if (!pairSp) continue;
        const l2 = solveExactKnapsackDutching(pairSp, cleanBudget);
        if (l2.length > 0) {
          const p2 = evalLines4DObj(l2, true).profitProb;
          if (p2 > bestSubProb) {
            bestSubProb = p2;
            bestSubMatches = 2;
          }
        }
      }
      const curFullProb = bestObj ? bestObj.obj.profitProb : 0;
      if (bestSubProb > 0) {
        const subTag =
          bestSubMatches === 1 ? "核心 1 场单关" : "核心 2 场 2串1";
        slot1AnchoredTwoMatchNote =
          bestSubProb > curFullProb + 1e-6
            ? `💡 当前已锁定全部 ${passCap} 场公平求解 0-1 背包最优（不亏率 ${(curFullProb * 100).toFixed(1)}%）；若精简至${subTag}，零倒贴不亏率可升至 ${(bestSubProb * 100).toFixed(1)}%`
            : `💡 当前已锁定全部 ${passCap} 场公平求解 0-1 背包最优，对标核心 1~2 场保本上限 ${(bestSubProb * 100).toFixed(1)}%`;
      }
    }
  } else {
    // Radar-anchored mode: keep all selected matches (up to statutory passCap) and solve exact 0-1 knapsack on anchored Cartesian box
    let addedUnanchoredShield = false;
    const perMatchDisjointOpts = selected.map((m) => {
      const anc = anchorsByMatch.get(m.id) ?? [];
      if (anc.length > 0) {
        const byPool = new Map();
        for (const a of anc) {
          if (m.pools[a.poolCode]?.selling === false) continue;
          const list = byPool.get(a.poolCode) ?? [];
          list.push(a);
          byPool.set(a.poolCode, list);
        }
        const rankedPools = Array.from(byPool.entries()).sort(
          (x, y) =>
            y[1].length - x[1].length ||
            Math.max(...y[1].map((p) => p.fairProb)) -
              Math.max(...x[1].map((p) => p.fairProb))
        );
        if (rankedPools[0]) {
          const [pCode, poolPicks] = rankedPools[0];
          const ancLegs = poolPicks
            .map((a) =>
              legOf(
                m,
                pCode,
                pCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
              )
            )
            .filter(Boolean);
          if (ancLegs.length >= 2) return ancLegs;
          if (ancLegs.length === 1) {
            const sec = secondaryDisjointLegInPool(m, ancLegs[0]);
            if (sec) addedUnanchoredShield = true;
            return sec ? [ancLegs[0], sec] : ancLegs;
          }
        }
      }
      const prim = preferredPrimaryLeg(m);
      const pCode = prim?.poolCode ?? primaryPoolOf(m);
      const others = (m.pools[pCode]?.options ?? [])
        .filter((o) => o.key !== prim?.optionKey)
        .map((o) => legOf(m, pCode, o.key))
        .filter(Boolean);
      if (others.length > 0) addedUnanchoredShield = true;
      return prim ? [prim, ...others] : others;
    });

    const passCap = Math.min(
      selected.length,
      ...perMatchDisjointOpts.map(
        (opts) => POOL_MAX_PASS[opts[0]?.poolCode] ?? 8
      )
    );
    let mCartesian = [[]];
    for (let idx = 0; idx < passCap; idx++) {
      const opts = perMatchDisjointOpts[idx];
      const next = [];
      for (let a = 0; a < mCartesian.length; a++) {
        for (let b = 0; b < opts.length; b++) {
          next.push([...mCartesian[a], opts[b]]);
        }
      }
      mCartesian = next;
    }
    if (mCartesian.length > 0 && mCartesian[0].length === passCap) {
      const cartSpecs = mCartesian.map((legs, idx) => ({
        id: `mp-anc-${idx + 1}`,
        roleLabel: idx === 0 ? "雷达主选铁干" : `防冷保本盾#${idx}`,
        legs,
      }));
      slot1Lines = solveExactKnapsackDutching(
        cartSpecs,
        cleanBudget,
        64,
        addedUnanchoredShield ? { pinnedFirstId: "mp-anc-1" } : {}
      );
      if (slot1Lines.length === 0 && addedUnanchoredShield) {
        slot1Lines = solveExactKnapsackDutching(cartSpecs, cleanBudget);
      }
    }

    if (selected.length >= 4) {
      let best2mProb = 0;
      const ancPairRank = [];
      for (let i = 0; i < selected.length; i++) {
        const sumI = perMatchDisjointOpts[i].reduce(
          (a, g) => a + (g.fairProb || 0),
          0
        );
        for (let j = i + 1; j < selected.length; j++) {
          const sumJ = perMatchDisjointOpts[j].reduce(
            (a, g) => a + (g.fairProb || 0),
            0
          );
          ancPairRank.push({ i, j, score: sumI * sumJ });
        }
      }
      ancPairRank.sort((a, b) => b.score - a.score);
      for (const { i, j } of ancPairRank.slice(0, 4)) {
        const optsI = perMatchDisjointOpts[i];
        const optsJ = perMatchDisjointOpts[j];
        const pairSpecs = [];
        for (let a = 0; a < optsI.length; a++) {
          for (let b = 0; b < optsJ.length; b++) {
            pairSpecs.push({
              id: `mp-cmp-${a}-${b}`,
              roleLabel: "双场保本对标",
              legs: [optsI[a], optsJ[b]],
            });
          }
        }
        const lines2m = solveExactKnapsackDutching(pairSpecs, cleanBudget);
        if (lines2m.length > 0) {
          const obj2m = evalLines4DObj(lines2m, true);
          if (obj2m.profitProb > best2mProb) best2mProb = obj2m.profitProb;
        }
      }
      const curAncProb =
        slot1Lines.length > 0 ? evalLines4DObj(slot1Lines, true).profitProb : 0;
      if (best2mProb > 0) {
        slot1AnchoredTwoMatchNote =
          best2mProb > curAncProb + 1e-6
            ? `💡 当前已锁定全部 ${passCap} 场求得同关数 0-1 背包全局最优（真赚钱率 ${(curAncProb * 100).toFixed(1)}%）；若精简至核心 2 场，零倒贴真赚钱率可升至 ${(best2mProb * 100).toFixed(1)}%`
            : `💡 当前已锁定全部 ${passCap} 场求得 0-1 背包全局最优，对标核心 2 场保本上限 ${(best2mProb * 100).toFixed(1)}%`;
      }
    }
  }

  const slot1SyntheticUsed =
    selected.length === 1 &&
    slot1Lines.some((l) =>
      l.legs.some((g) => g.poolCode !== "HAD" && g.poolCode !== "HHAD")
    );

  const slot1BreakEvenCount = slot1Lines.filter(
    (l) => Math.abs(l.netProfit) < 1e-9
  ).length;

  const slot1Reasons = [
    slot1SyntheticUsed
      ? "主盘未开单关，已自动跨盘比选最低等效抽水的合成单关入口并执行精确 0-1 背包配平"
      : "基于精确整数 0-1 背包动态规划（Exact Knapsack Dutching）求解满场零倒贴不亏率全局最优解",
    slot1BreakEvenCount > 0
      ? `施加覆盖态零假中奖约束（含 ${slot1BreakEvenCount} 张刚好退回本金净赚 ¥0.00 的保本回笼支）`
      : "施加覆盖态 100% 零假中奖硬约束，命中覆盖集合内任一赛果确保净赚不倒贴",
  ];
  if (slot1AnchoredTwoMatchNote) slot1Reasons.push(slot1AnchoredTwoMatchNote);

  const slot1Plan = packSlot({
    key: "max-profit-prob",
    shortTab: "🛡️ 稳健保本",
    badge: "🛡️ 稳健保本极值",
    title: "覆盖态零假中奖 · 真赚钱率最大化",
    tagline:
      slot1BreakEvenCount > 0
        ? "覆盖范围内 100% 保本不亏（含刚退本金保护支）· 彻底杜绝中奖倒贴"
        : "覆盖范围内命中任一组合 100% 净赚 · 彻底杜绝中奖倒贴",
    lines: slot1Lines,
    reasons: slot1Reasons,
  });
  if (slot1Plan.available && slot1BreakEvenCount > 0) {
    slot1Plan.reasons[1] = `施加覆盖态零假中奖约束（含 ${slot1BreakEvenCount} 张刚好退回本金净赚 ¥0.00 的保本回笼支，严格净赚率 ${((slot1Plan.strictNetGainProb ?? 0) * 100).toFixed(1)}%）`;
  }

  // =========================================================================
  // Slot ②: max-ev-utility (⚖️ 期望效用 · 对数财富效用 + 按单腿 O·p 剔除高抽水拖累腿 + 防封顶)
  // =========================================================================
  let evActiveMatches = [...selected];
  const prunedDragMatches = [];
  let anchoredDragWarning = null;

  const canSingleMainPool = (m) =>
    Boolean(
      (m.pools.HAD?.selling !== false && m.pools.HAD?.single) ||
      (m.pools.HHAD?.selling !== false && m.pools.HHAD?.single)
    );

  const matchBestMainEfficiency = (m) => {
    let best = 0;
    for (const code of ["HAD", "HHAD"]) {
      const pool = m.pools[code];
      if (!pool || pool.selling === false) continue;
      for (const o of pool.options ?? []) {
        const lg = legOf(m, code, o.key);
        if (
          lg &&
          lg.odds >= 1.12 &&
          lg.fairProb >= 0.35 &&
          lg.odds * lg.fairProb > best
        ) {
          best = lg.odds * lg.fairProb;
        }
      }
    }
    if (best === 0) {
      const prim = preferredPrimaryLeg(m);
      best = prim ? prim.odds * prim.fairProb : 0;
    }
    return best;
  };

  const slateMaxEff = selected.reduce(
    (mx, m) => Math.max(mx, matchBestMainEfficiency(m)),
    0
  );
  const isHighVigDragMatch = (m) => {
    const eff = matchBestMainEfficiency(m);
    return (
      eff < 0.875 ||
      (selected.length >= 3 && slateMaxEff - eff >= 0.04 && eff < 0.885)
    );
  };

  if (hasUserAnchors) {
    const ancDrags = selected.filter((m) => {
      const anc = anchorsByMatch.get(m.id);
      if (!anc || anc.length === 0) return false;
      const bestAncRet = Math.max(
        ...anc.map((a) => {
          const lg = legOf(
            m,
            a.poolCode,
            a.poolCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
          );
          return lg
            ? lg.odds * lg.fairProb
            : Number(a.odds) * Number(a.fairProb);
        })
      );
      return bestAncRet < 0.875;
    });
    if (ancDrags.length > 0) {
      const names = ancDrags
        .map((m) => {
          const anc = anchorsByMatch.get(m.id);
          const topAnc = [...anc].sort(
            (a, b) => b.odds * b.fairProb - a.odds * a.fairProb
          )[0];
          const lg = legOf(m, topAnc.poolCode, topAnc.optionKey);
          const vigLossPct = (
            (1 - (lg ? lg.odds * lg.fairProb : 0.86)) *
            100
          ).toFixed(1);
          return `${m.matchNumStr} ${m.home}(单腿抽水${vigLossPct}%)`;
        })
        .join("、");
      anchoredDragWarning = `⚠️ 锚定场次含高抽水拖累腿【${names}】（单腿校准抽水 > 12.5%），串关连乘将放大期望折损，建议回赛事雷达精简提效`;
    }
  } else if (selected.length >= 2) {
    const cleanList = selected.filter((m) => !isHighVigDragMatch(m));
    const dragList = selected.filter((m) => isHighVigDragMatch(m));

    if (dragList.length > 0) {
      const rankedDrags = [...dragList].sort(
        (a, b) => matchBestMainEfficiency(b) - matchBestMainEfficiency(a)
      );

      if (
        cleanList.length >= 2 ||
        (cleanList.length === 1 && canSingleMainPool(cleanList[0]))
      ) {
        evActiveMatches = cleanList;
        prunedDragMatches.push(...dragList);
      } else if (cleanList.length === 1) {
        const keepPartner = rankedDrags[0];
        evActiveMatches = selected.filter(
          (m) => m.id === cleanList[0].id || m.id === keepPartner.id
        );
        prunedDragMatches.push(...rankedDrags.slice(1));
      } else {
        const keepCount = canSingleMainPool(rankedDrags[0])
          ? 1
          : Math.min(2, rankedDrags.length);
        const keepSet = new Set(
          rankedDrags.slice(0, keepCount).map((m) => m.id)
        );
        evActiveMatches = selected.filter((m) => keepSet.has(m.id));
        prunedDragMatches.push(...selected.filter((m) => !keepSet.has(m.id)));
      }
    }
  }

  // Select highest calibrated single-leg expected return (O * p) legal main-pool leg per active match
  const evPrimaryLegOf = (m, minProbFloor = 0.22) => {
    const requireSingle = evActiveMatches.length === 1;
    const isLegLegal = (lg) =>
      Boolean(lg) && (!requireSingle || Boolean(m.pools[lg.poolCode]?.single));
    if (anchorsByMatch.has(m.id)) {
      const ancPrim = preferredPrimaryLeg(m);
      if (isLegLegal(ancPrim)) return ancPrim;
    }
    const cands = [];
    for (const code of ["HAD", "HHAD"]) {
      const pool = m.pools[code];
      if (!pool || pool.selling === false) continue;
      if (requireSingle && !pool.single) continue;
      for (const o of pool.options ?? []) {
        const lg = legOf(m, code, o.key);
        if (lg && lg.fairProb >= minProbFloor) cands.push(lg);
      }
    }
    if (cands.length > 0) {
      cands.sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
      return cands[0];
    }
    const prim = preferredPrimaryLeg(m);
    if (isLegLegal(prim)) return prim;
    for (const code of ["HAD", "HHAD"]) {
      const pool = m.pools[code];
      if (!pool || pool.selling === false || (requireSingle && !pool.single))
        continue;
      const best = (pool.options ?? [])
        .map((o) => legOf(m, code, o.key))
        .filter(Boolean)
        .sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb)[0];
      if (best) return best;
    }
    return prim;
  };

  let slot2Lines = [];
  let slot2SplitCapNote = null;

  if (evActiveMatches.length === 1) {
    const em = evActiveMatches[0];
    const anc = anchorsByMatch.get(em.id) ?? [];
    if (
      anc.length > 0 &&
      anc.every(
        (a) =>
          em.pools[a.poolCode]?.selling !== false &&
          em.pools[a.poolCode]?.single
      )
    ) {
      const ancLegs = anc
        .map((a) => legOf(em, a.poolCode, a.optionKey))
        .filter(Boolean)
        .sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
      const secCov =
        ancLegs.length < 2 ? secondaryDisjointLegInPool(em, ancLegs[0]) : null;
      const shield =
        ancLegs.length >= 2
          ? { id: "ev-sh", roleLabel: "最小整数倍保本盾", legs: [ancLegs[1]] }
          : secCov
            ? { id: "ev-sh", roleLabel: "最小整数倍保本盾", legs: [secCov] }
            : null;
      slot2Lines = allocateSpearAndExactShield(
        [{ id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [ancLegs[0]] }],
        shield,
        cleanBudget,
        { lockPrimarySpear: true, optimizeShieldUtility: true }
      );
    } else if (anc.length > 0) {
      const {
        dir,
        hadDrawLeg,
        hhadCompatLegs,
        hafuCompatLegs,
        crsCompatLegs,
        ttgDrawLegs,
      } = resolveDirectionSingleBundles(em);
      const s2Cands = [];
      const pushS2 = (lines) => {
        if (Array.isArray(lines) && lines.length > 0) {
          s2Cands.push({
            lines,
            hasShield: lines.some((l) => String(l.roleLabel).includes("盾")),
            obj: evalLines4DObj(lines, true),
          });
        }
      };
      if (hadDrawLeg) {
        pushS2(
          allocateSpearAndExactShield(
            [{ id: "ev-sp1", roleLabel: "主攻平局独赢箭", legs: [hadDrawLeg] }],
            null,
            cleanBudget,
            { lockPrimarySpear: true }
          )
        );
      }
      if (hhadCompatLegs.length >= 2) {
        pushS2(
          allocateSpearAndExactShield(
            [
              {
                id: "ev-sp1",
                roleLabel: "主攻顺向让球箭",
                legs: [hhadCompatLegs[0]],
              },
            ],
            {
              id: "ev-sh",
              roleLabel: "最小整数倍卡盘盾",
              legs: [hhadCompatLegs[1]],
            },
            cleanBudget,
            { optimizeShieldUtility: true }
          )
        );
      } else if (hhadCompatLegs.length === 1) {
        pushS2(
          allocateSpearAndExactShield(
            [
              {
                id: "ev-sp1",
                roleLabel: "主攻顺向让球箭",
                legs: [hhadCompatLegs[0]],
              },
            ],
            null,
            cleanBudget,
            { lockPrimarySpear: true }
          )
        );
      }
      if (hafuCompatLegs.length >= 2) {
        if (dir === "draw") {
          const dd =
            hafuCompatLegs.find((g) => g.optionKey === "dd") ??
            hafuCompatLegs[0];
          const nonDd = hafuCompatLegs.filter(
            (g) => g.optionKey !== dd.optionKey
          );
          pushS2(
            allocateSpearAndExactShield(
              nonDd.length > 0
                ? nonDd.map((g, i) => ({
                    id: `ev-sp${i + 1}`,
                    roleLabel: i === 0 ? "主攻半分全平箭" : "次路全平辅助箭",
                    legs: [g],
                  }))
                : [{ id: "ev-sp1", roleLabel: "主攻闷平箭", legs: [dd] }],
              nonDd.length > 0
                ? { id: "ev-sh", roleLabel: "最小整数倍闷平盾", legs: [dd] }
                : null,
              cleanBudget
            )
          );
        } else {
          const spA = legOf(em, "HAFU", dir === "away" ? "da" : "dh");
          const spB = legOf(em, "HAFU", dir === "away" ? "aa" : "hh");
          const sh = legOf(em, "HAFU", "dd");
          pushS2(
            allocateSpearAndExactShield(
              [
                { id: "ev-sp1", roleLabel: "主攻半平绝杀箭", legs: [spA] },
                { id: "ev-sp2", roleLabel: "顺向连赢辅助箭", legs: [spB] },
              ],
              sh
                ? { id: "ev-sh", roleLabel: "最小整数倍闷平盾", legs: [sh] }
                : null,
              cleanBudget
            )
          );
        }
      }
      if (crsCompatLegs.length >= 2) {
        pushS2(
          allocateSpearAndExactShield(
            [
              {
                id: "ev-sp1",
                roleLabel: "主攻比分箭#1",
                legs: [crsCompatLegs[0]],
              },
              {
                id: "ev-sp2",
                roleLabel: "顺向比分箭#2",
                legs: [crsCompatLegs[1]],
              },
            ],
            crsCompatLegs[2]
              ? {
                  id: "ev-sh",
                  roleLabel: "最小整数倍比分盾",
                  legs: [crsCompatLegs[2]],
                }
              : null,
            cleanBudget
          )
        );
      }
      if (ttgDrawLegs.length >= 2) {
        const sortedTtgD = [...ttgDrawLegs].sort(
          (a, b) => b.odds * b.fairProb - a.odds * a.fairProb
        );
        pushS2(
          allocateSpearAndExactShield(
            [
              {
                id: "ev-sp1",
                roleLabel: "主攻平局进球箭",
                legs: [sortedTtgD[0]],
              },
            ],
            {
              id: "ev-sh",
              roleLabel: "最小整数倍闷平进球盾",
              legs: [sortedTtgD[1]],
            },
            cleanBudget,
            { optimizeShieldUtility: true }
          )
        );
      }
      for (const c of s2Cands) c.logUtil = evalLogWealthUtility(c.lines, true);
      s2Cands.sort(
        (a, b) =>
          b.logUtil - a.logUtil ||
          b.obj.evRate - a.obj.evRate ||
          b.obj.profitProb - a.obj.profitProb
      );
      slot2Lines = s2Cands[0]?.lines ?? [];
    } else if (canSingleMainPool(em)) {
      const mainCode =
        em.pools.HAD?.selling !== false && em.pools.HAD?.single
          ? "HAD"
          : "HHAD";
      const prim =
        evPrimaryLegOf(em) ??
        legOf(em, mainCode, em.pools[mainCode].options[0].key);
      const sec = secondaryDisjointLegInPool(em, prim);
      const minShieldLines = allocateSpearAndExactShield(
        [{ id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [prim] }],
        sec
          ? { id: "ev-sh", roleLabel: "最小整数倍回本盾", legs: [sec] }
          : null,
        cleanBudget,
        { optimizeShieldUtility: true }
      );
      const exactLogSplitLines = sec
        ? allocateSpearAndExactShield(
            [
              { id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [prim] },
              { id: "ev-sp2", roleLabel: "对数效用协同副箭", legs: [sec] },
            ],
            null,
            cleanBudget
          )
        : [];
      slot2Lines =
        exactLogSplitLines.length > 0 &&
        evalLogWealthUtility(exactLogSplitLines, true) >
          evalLogWealthUtility(minShieldLines, true) + 1e-12
          ? exactLogSplitLines
          : minShieldLines;
    } else {
      const { dir, hafuCompatLegs, crsCompatLegs } =
        resolveDirectionSingleBundles(em);
      if (hafuCompatLegs.length >= 2) {
        const spA = legOf(
          em,
          "HAFU",
          dir === "away" ? "da" : dir === "draw" ? "hd" : "dh"
        );
        const spB = legOf(
          em,
          "HAFU",
          dir === "away" ? "aa" : dir === "draw" ? "ad" : "hh"
        );
        const sh = legOf(em, "HAFU", "dd");
        slot2Lines = allocateSpearAndExactShield(
          [
            { id: "ev-sp1", roleLabel: "主攻半平绝杀箭", legs: [spA] },
            { id: "ev-sp2", roleLabel: "顺向连赢辅助箭", legs: [spB] },
          ],
          sh
            ? { id: "ev-sh", roleLabel: "最小整数倍闷平盾", legs: [sh] }
            : null,
          cleanBudget
        );
      } else if (crsCompatLegs.length >= 2) {
        slot2Lines = allocateSpearAndExactShield(
          [
            {
              id: "ev-sp1",
              roleLabel: "主攻比分箭#1",
              legs: [crsCompatLegs[0]],
            },
            {
              id: "ev-sp2",
              roleLabel: "顺向比分箭#2",
              legs: [crsCompatLegs[1]],
            },
          ],
          crsCompatLegs[2]
            ? {
                id: "ev-sh",
                roleLabel: "最小整数倍比分盾",
                legs: [crsCompatLegs[2]],
              }
            : null,
          cleanBudget
        );
      }
    }
  } else {
    const activePrims = evActiveMatches.map(evPrimaryLegOf).filter(Boolean);
    const poolCap = Math.min(
      ...activePrims.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8)
    );
    let targetPass = Math.min(activePrims.length, poolCap);

    // Statutory Cap-Clipping Guard: split down pass size if raw unit payout > statutorySingleBetCap
    while (targetPass > 1) {
      const subsets = combinationsOfIndices(activePrims.length, targetPass);
      const anyClips = subsets.some((idxs) => {
        const rawU = bankerRoundParlayUnitPayout(
          idxs.map((i) => activePrims[i].odds)
        );
        return rawU > statutorySingleBetCap(targetPass);
      });
      if (!anyClips) break;
      targetPass -= 1;
    }

    if (targetPass < Math.min(activePrims.length, poolCap)) {
      slot2SplitCapNote = `🛡️ 原 ${Math.min(activePrims.length, poolCap)} 关高赔连乘触发法定单注封顶截断，已自动降阶拆为 ${targetPass === 1 ? "单关" : `${targetPass}串1`} 零损耗实票`;
      if (targetPass === 1) {
        const singleSpecs = activePrims
          .filter((g) => {
            const fm = evActiveMatches.find((x) => x.id === g.matchId);
            return fm?.pools?.[g.poolCode]?.single !== false;
          })
          .slice(0, 4)
          .map((g, idx) => ({
            id: `ev-sgl-${idx + 1}`,
            roleLabel: `防截断单关#${idx + 1}`,
            legs: [g],
          }));
        slot2Lines = allocateSpearAndExactShield(
          singleSpecs.length > 0
            ? singleSpecs
            : [{ id: "ev-sgl-1", roleLabel: "主攻箭", legs: [activePrims[0]] }],
          null,
          cleanBudget
        );
      } else {
        const subsets = combinationsOfIndices(activePrims.length, targetPass)
          .map((idxs) => {
            const legs = idxs.map((i) => activePrims[i]);
            const evScore = legs.reduce((a, g) => a * g.odds * g.fairProb, 1);
            return { legs, evScore };
          })
          .sort((a, b) => b.evScore - a.evScore)
          .slice(0, 4);
        slot2Lines = allocateSpearAndExactShield(
          subsets.map((s, idx) => ({
            id: `ev-sub-${idx + 1}`,
            roleLabel: `防截断${targetPass}串1#${idx + 1}`,
            legs: s.legs,
          })),
          null,
          cleanBudget
        );
      }
    } else {
      const backboneProfiles = [activePrims.slice(0, targetPass)];
      if (!hasUserAnchors) {
        const strictEvLegs = evActiveMatches.slice(0, targetPass).map((m) => {
          const cands = [];
          for (const code of ["HAD", "HHAD"]) {
            const pool = m.pools[code];
            if (!pool || pool.selling === false) continue;
            for (const o of pool.options ?? []) {
              const lg = legOf(m, code, o.key);
              if (lg && lg.fairProb >= 0.2) cands.push(lg);
            }
          }
          cands.sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
          return cands[0] ?? evPrimaryLegOf(m);
        });
        const highProbMainLegs = evActiveMatches
          .slice(0, targetPass)
          .map(preferredHighProbMainLeg);
        const hadMainLegs = evActiveMatches
          .slice(0, targetPass)
          .map((m) => preferredPrimaryLeg(m));
        for (const candBackbone of [
          strictEvLegs,
          highProbMainLegs,
          hadMainLegs,
        ]) {
          if (
            candBackbone.every(Boolean) &&
            bankerRoundParlayUnitPayout(candBackbone.map((g) => g.odds)) <=
              statutorySingleBetCap(candBackbone.length)
          ) {
            const sig = candBackbone
              .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
              .join("|");
            if (
              !backboneProfiles.some(
                (bp) =>
                  bp
                    .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
                    .join("|") === sig
              )
            ) {
              backboneProfiles.push(candBackbone);
            }
          }
        }
      }

      const slot2Candidates = [];
      for (const bLegs of backboneProfiles) {
        // Pure spear candidate (global EV anchor)
        const pureLines = allocateSpearAndExactShield(
          [{ id: "ev-sp1", roleLabel: "高性价比主攻箭", legs: bLegs }],
          null,
          cleanBudget
        );
        if (pureLines.length > 0) {
          slot2Candidates.push({
            lines: pureLines,
            hasShield: false,
            obj: evalLines4DObj(pureLines, true),
          });
        }

        // Same-pool disjoint 1-flip shield candidates across all disjoint options (not just draw!)
        const flipCands = [];
        for (let idx = 0; idx < bLegs.length; idx++) {
          const lg = bLegs[idx];
          const fm = evActiveMatches[idx];
          const anc = anchorsByMatch.get(fm.id);
          const samePoolAlts =
            anc && anc.length >= 2
              ? anc
                  .filter(
                    (a) =>
                      a.poolCode === lg.poolCode && a.optionKey !== lg.optionKey
                  )
                  .map((a) => legOf(fm, a.poolCode, a.optionKey))
                  .filter(Boolean)
              : hasUserAnchors && anc && anc.length === 1
                ? [secondaryDisjointLegInPool(fm, lg)].filter(Boolean)
                : (fm.pools[lg.poolCode]?.options ?? [])
                    .filter((o) => o.key !== lg.optionKey)
                    .map((o) => legOf(fm, lg.poolCode, o.key))
                    .filter(Boolean);

          for (const sec of samePoolAlts) {
            const altLegs = [...bLegs];
            altLegs[idx] = sec;
            const rawU = bankerRoundParlayUnitPayout(
              altLegs.map((g) => g.odds)
            );
            if (rawU <= statutorySingleBetCap(altLegs.length)) {
              flipCands.push({
                legs: altLegs,
                score: sec.fairProb * sec.odds + sec.fairProb * 0.15,
              });
            }
          }
        }
        flipCands.sort((a, b) => b.score - a.score);
        for (const fc of flipCands.slice(0, 4)) {
          const optModes =
            evActiveMatches.length <= 3 ? [false, true] : [false];
          for (const optUtil of optModes) {
            const shLines = allocateSpearAndExactShield(
              [{ id: "ev-sp1", roleLabel: "高性价比主攻箭", legs: bLegs }],
              { id: "ev-sh", roleLabel: "最小整数倍回本盾", legs: fc.legs },
              cleanBudget,
              {
                lockPrimarySpear: hasUserAnchors,
                optimizeShieldUtility: optUtil,
              }
            );
            if (shLines.length > 0) {
              const obj = evalLines4DObj(shLines, true);
              if (
                !optUtil ||
                shLines.length < 2 ||
                shLines[1].prob * shLines[1].unitPayout >=
                  shLines[0].prob * shLines[0].unitPayout - 1e-6
              ) {
                slot2Candidates.push({
                  lines: shLines,
                  hasShield: shLines.some((l) =>
                    String(l.roleLabel).includes("盾")
                  ),
                  obj,
                });
              }
            }
          }
        }
      }

      const paretoSlot2 = filterNonDominatedCandidates(slot2Candidates);
      const pool2 = paretoSlot2.length > 0 ? paretoSlot2 : slot2Candidates;
      for (const c of pool2) {
        c.logUtil = evalLogWealthUtility(c.lines, true);
      }
      pool2.sort(
        (a, b) =>
          b.logUtil - a.logUtil ||
          b.obj.evRate - a.obj.evRate ||
          b.obj.profitProb - a.obj.profitProb
      );
      slot2Lines = pool2[0]?.lines ?? [];
    }
  }

  const slot2Reasons = [];
  if (prunedDragMatches.length > 0) {
    const names = prunedDragMatches
      .map((m) => {
        const vigLossPct = ((1 - matchBestMainEfficiency(m)) * 100).toFixed(1);
        return `${m.matchNumStr} ${m.home}(单腿抽水${vigLossPct}%)`;
      })
      .join("、");
    slot2Reasons.push(
      `✂️ 已按单腿校准期望返还 O·p 自动剔除高抽水拖累腿【${names}】，省去负边际连乘抽水侵蚀`
    );
  }
  if (slot2SplitCapNote) slot2Reasons.push(slot2SplitCapNote);
  slot2Reasons.push(
    "基于分数凯利对数财富效用（Expected Log-Wealth Utility）在零倒贴整数域寻优主攻与护盾配比，兼顾复利增长与回撤保护"
  );

  const slot2Plan = packSlot({
    key: "max-ev-utility",
    shortTab: "⚖️ 期望效用",
    badge: "⚖️ 期望效用极值",
    title: "对数财富效用 · 主攻护盾整数寻优",
    tagline:
      "按期望对数财富效用寻优零倒贴主攻与护盾整数配比 · 火力集中高效率组合",
    lines: slot2Lines,
    reasons: slot2Reasons,
    prependWarningReason: anchoredDragWarning,
  });

  // =========================================================================
  // Slot ③: max-cvar-wheel (🧩 容错缩水 · 旋转矩阵 C(v,k,t) 组合覆盖 <=10 张实票)
  // =========================================================================
  let slot3Lines = [];
  let slot3MissOneReturn = 0;
  let slot3DesignLabel = "单场防冷缓冲网";
  let slot3IsCoveringWheel = false;

  const singleCushionLegOf = (m) => {
    const anc = anchorsByMatch.get(m.id) ?? [];
    const singleAnc = anc
      .filter(
        (a) =>
          m.pools[a.poolCode]?.selling !== false && m.pools[a.poolCode]?.single
      )
      .sort((a, b) => b.fairProb - a.fairProb)[0];
    if (singleAnc) return legOf(m, singleAnc.poolCode, singleAnc.optionKey);

    if (anc.length > 0) {
      const {
        hadDrawLeg,
        hhadCompatLegs,
        hafuCompatLegs,
        crsCompatLegs,
        ttgDrawLegs,
      } = resolveDirectionSingleBundles(m);
      if (hadDrawLeg) return hadDrawLeg;
      if (hhadCompatLegs[0]) return hhadCompatLegs[0];
      if (hafuCompatLegs[0]) return hafuCompatLegs[0];
      if (crsCompatLegs[0]) return crsCompatLegs[0];
      if (ttgDrawLegs[0]) return ttgDrawLegs[0];
    }

    const mIdx = selected.findIndex((sm) => sm.id === m.id);
    const mainSingleCands = [];
    for (const mainCode of ["HAD", "HHAD"]) {
      const pool = m.pools[mainCode];
      if (
        pool?.selling !== false &&
        pool?.single &&
        pool?.options?.length > 0
      ) {
        for (const o of pool.options) {
          const lg = legOf(m, mainCode, o.key);
          if (lg) mainSingleCands.push(lg);
        }
      }
    }
    if (mainSingleCands.length > 0) {
      if (mIdx >= 0) {
        mainSingleCands.sort(
          (a, b) =>
            getLegCondPair(mIdx, b)[0] * b.odds -
              getLegCondPair(mIdx, a)[0] * a.odds || b.fairProb - a.fairProb
        );
      } else {
        mainSingleCands.sort((a, b) => b.fairProb - a.fairProb);
      }
      return mainSingleCands[0];
    }

    const subCands = [];
    if (m.pools.HAFU?.selling !== false && m.pools.HAFU?.single) {
      for (const o of m.pools.HAFU.options ?? []) {
        const lg = legOf(m, "HAFU", o.key);
        if (lg) subCands.push(lg);
      }
    }
    if (m.pools.TTG?.selling !== false && m.pools.TTG?.single) {
      for (const o of m.pools.TTG.options ?? []) {
        const lg = legOf(m, "TTG", o.key);
        if (lg) subCands.push(lg);
      }
    }
    if (subCands.length > 0) {
      if (mIdx >= 0) {
        subCands.sort(
          (a, b) =>
            getLegCondPair(mIdx, b)[0] * b.odds -
              getLegCondPair(mIdx, a)[0] * a.odds ||
            b.odds * b.fairProb - a.odds * a.fairProb
        );
      } else {
        subCands.sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
      }
      return subCands[0];
    }
    return preferredPrimaryLeg(m);
  };

  let slot3HasPartialCushionBlindSpot = false;
  let slot3UsesSubPoolCushion = false;
  let slot3MissingOneSideCushion = false;
  let slot3MinCushionCondCov = 1;

  if (selected.length === 1) {
    const m1 = selected[0];
    const anc = anchorsByMatch.get(m1.id) ?? [];
    const ancSinglePool =
      anc.length > 0 &&
      anc.every(
        (a) =>
          m1.pools[a.poolCode]?.selling !== false &&
          m1.pools[a.poolCode]?.single &&
          a.poolCode === anc[0].poolCode
      )
        ? anc[0].poolCode
        : null;
    const cushionSpecs = [];

    if (ancSinglePool) {
      const ancLegs = anc
        .map((a) => legOf(m1, a.poolCode, a.optionKey))
        .filter(Boolean);
      const cov =
        ancLegs.length === 1
          ? secondaryDisjointLegInPool(m1, ancLegs[0])
          : null;
      const chosenLegs = cov ? [ancLegs[0], cov] : ancLegs;
      chosenLegs.forEach((lg, idx) =>
        cushionSpecs.push({
          id: `cw-1-${idx + 1}`,
          roleLabel: idx === 0 ? "雷达主选防冷主垫" : "顺向防平缓冲垫",
          legs: [lg],
        })
      );
    } else if (anc.length > 0) {
      const {
        dir,
        hadDrawLeg,
        hhadCompatLegs,
        hafuCompatLegs,
        crsCompatLegs,
        ttgDrawLegs,
      } = resolveDirectionSingleBundles(m1);
      let chosenLegs = [];
      if (hadDrawLeg) {
        chosenLegs = [hadDrawLeg];
      } else if (hhadCompatLegs.length > 0) {
        chosenLegs = hhadCompatLegs;
      } else if (hafuCompatLegs.length > 0) {
        const ddLeg = legOf(m1, "HAFU", "dd");
        chosenLegs =
          dir !== "draw" &&
          ddLeg &&
          !hafuCompatLegs.some((g) => g.optionKey === "dd")
            ? [...hafuCompatLegs, ddLeg]
            : hafuCompatLegs;
      } else if (crsCompatLegs.length > 0) {
        chosenLegs = crsCompatLegs.slice(0, 3);
      } else if (ttgDrawLegs.length > 0) {
        chosenLegs = ttgDrawLegs;
      }
      chosenLegs.forEach((lg, idx) =>
        cushionSpecs.push({
          id: `cw-1-${idx + 1}`,
          roleLabel: idx === 0 ? "顺向单关主垫" : `顺向缓冲垫#${idx}`,
          legs: [lg],
        })
      );
    } else if (m1.pools.HAD?.selling !== false && m1.pools.HAD?.single) {
      const top2 = m1.pools.HAD.options
        .map((o) => legOf(m1, "HAD", o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb)
        .slice(0, 2);
      top2.forEach((lg, idx) =>
        cushionSpecs.push({
          id: `cw-1-${idx + 1}`,
          roleLabel: idx === 0 ? "正路防爆主垫" : "防平缓冲垫",
          legs: [lg],
        })
      );
    } else if (m1.pools.HHAD?.selling !== false && m1.pools.HHAD?.single) {
      const top2 = m1.pools.HHAD.options
        .map((o) => legOf(m1, "HHAD", o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb)
        .slice(0, 2);
      top2.forEach((lg, idx) =>
        cushionSpecs.push({
          id: `cw-1-${idx + 1}`,
          roleLabel: idx === 0 ? "让球正路主垫" : "一球卡盘缓冲垫",
          legs: [lg],
        })
      );
    } else {
      const { dir, hafuCompatLegs, crsCompatLegs } =
        resolveDirectionSingleBundles(m1);
      if (hafuCompatLegs.length > 0) {
        const ddLeg = legOf(m1, "HAFU", "dd");
        const legsToUse =
          dir !== "draw" &&
          ddLeg &&
          !hafuCompatLegs.some((g) => g.optionKey === "dd")
            ? [...hafuCompatLegs, ddLeg]
            : hafuCompatLegs;
        legsToUse.forEach((lg, idx) => {
          cushionSpecs.push({
            id: `cw-1-${idx + 1}`,
            roleLabel:
              idx === 0
                ? "上半领先赢"
                : idx === 1
                  ? "半平绝杀垫"
                  : "全场闷平兜底",
            legs: [lg],
          });
        });
      } else if (crsCompatLegs.length > 0) {
        crsCompatLegs.slice(0, 3).forEach((lg, idx) => {
          cushionSpecs.push({
            id: `cw-1-${idx + 1}`,
            roleLabel: `比分缓冲垫#${idx + 1}`,
            legs: [lg],
          });
        });
      }
    }
    slot3Lines = solveZeroUnderwaterDutching(cushionSpecs, cleanBudget);
    if (slot3Lines.length === 0 && cushionSpecs.length > 0) {
      const takeSpecs = cushionSpecs.slice(0, 2);
      const fallbackMults =
        takeSpecs.length === 1
          ? [Math.max(1, Math.floor(cleanBudget / 2))]
          : [
              Math.max(1, Math.floor(cleanBudget / 4)),
              Math.max(1, Math.floor(cleanBudget / 4)),
            ];
      slot3Lines = materializePlanLines(takeSpecs, fallbackMults);
    }
    slot3MissOneReturn = slot3Lines.length
      ? Math.min(...slot3Lines.map((l) => l.returnPayout))
      : 0;
  } else if (selected.length === 2) {
    slot3DesignLabel = "2串1主干 + 双路单关回血垫";
    const [mA, mB] = selected;
    const legA = preferredHighProbMainLeg(mA);
    const legB = preferredHighProbMainLeg(mB);

    const pickOneSingleCushion = (m, mIdx, consLeg) => {
      const anc = anchorsByMatch.get(m.id) ?? [];
      if (anc.length === 0 && consLeg) {
        if (
          m.pools[consLeg.poolCode]?.selling !== false &&
          m.pools[consLeg.poolCode]?.single
        ) {
          return consLeg;
        }
        for (const mainCode of ["HAD", "HHAD"]) {
          const pool = m.pools[mainCode];
          if (
            pool?.selling !== false &&
            pool?.single &&
            Array.isArray(pool.options)
          ) {
            const fullCover = pool.options
              .map((o) => legOf(m, mainCode, o.key))
              .find((g) => g && getLegCondPair(mIdx, g)[0] >= 0.999);
            if (fullCover) return fullCover;
          }
        }
      }
      const sgl = singleCushionLegOf(m);
      return sgl && m.pools[sgl.poolCode]?.single ? sgl : null;
    };

    const sglA1 = pickOneSingleCushion(mA, 0, legA);
    const sglB1 = pickOneSingleCushion(mB, 1, legB);
    const sglA2 = singleCushionLegOf(mA);
    const sglB2 = singleCushionLegOf(mB);
    const validSglA2 = sglA2 && mA.pools[sglA2.poolCode]?.single ? sglA2 : null;
    const validSglB2 = sglB2 && mB.pools[sglB2.poolCode]?.single ? sglB2 : null;
    const mainKicker = {
      id: "cw-2-all",
      roleLabel: "连红主干·2串1",
      legs: [legA, legB],
    };
    const rawPairs = [
      [sglA1, sglB1],
      [validSglA2, validSglB2],
      [sglA1, validSglB2],
      [validSglA2, sglB1],
    ];
    const seenPairSigs = new Set();
    const groupConfigs = [];
    for (const [ga, gb] of rawPairs) {
      const sig = `${ga ? `${ga.poolCode}:${ga.optionKey}` : "none"}|${gb ? `${gb.poolCode}:${gb.optionKey}` : "none"}`;
      if (!seenPairSigs.has(sig) && (ga || gb)) {
        seenPairSigs.add(sig);
        groupConfigs.push([ga ? [ga] : [], gb ? [gb] : []]);
      }
    }
    const totalNotes = Math.max(3, Math.floor(cleanBudget / 2));
    if (groupConfigs.length > 0) {
      const matchIdList = selected.map((m) => m.id);
      const twoMatchCands = [];
      for (const [grpA, grpB] of groupConfigs) {
        const blockSpecs = [];
        grpA.forEach((g, idx) =>
          blockSpecs.push({
            id: `cw-2-s1-${idx + 1}`,
            roleLabel: `防错回血垫①${grpA.length > 1 ? `·${g.optionLabel}` : ""} (${mA.matchNumStr}单关)`,
            legs: [g],
          })
        );
        grpB.forEach((g, idx) =>
          blockSpecs.push({
            id: `cw-2-s2-${idx + 1}`,
            roleLabel: `防错回血垫②${grpB.length > 1 ? `·${g.optionLabel}` : ""} (${mB.matchNumStr}单关)`,
            legs: [g],
          })
        );
        if (blockSpecs.length === 0) continue;
        const allSpecs = [mainKicker, ...blockSpecs];
        const cond2Weights = blockSpecs.map((sp) =>
          selected.map((_, x) =>
            sp.legs.reduce((acc, g) => {
              const gi = selected.findIndex((sm) => sm.id === g.matchId);
              const pr = gi >= 0 ? getLegCondPair(gi, g) : [1, 0];
              return acc * (gi === x ? pr[1] : pr[0]);
            }, 1)
          )
        );
        const minNotes = Math.max(
          allSpecs.length,
          Math.floor(totalNotes * 0.9)
        );
        for (let candN = totalNotes; candN >= minNotes; candN--) {
          const kickerSet =
            candN >= 10
              ? new Set([
                  Math.max(2, Math.round(candN * 0.18)),
                  Math.max(2, Math.round(candN * 0.24)),
                  Math.max(2, Math.round(candN * 0.3)),
                ])
              : new Set([1, 2]);
          for (const kNotes of kickerSet) {
            if (kNotes + blockSpecs.length > candN) continue;
            const cushionBudget = (candN - kNotes) * 2;
            const solvedCushions = allocateWheelMeanCvar(
              blockSpecs,
              null,
              matchIdList,
              cushionBudget,
              true,
              cond2Weights
            );
            const candLines = materializePlanLines(allSpecs, [
              kNotes,
              ...solvedCushions.lines.map((l) => l.multiple),
            ]);
            const missOne = computeSurvivingMissOneFloor(
              candLines,
              matchIdList
            );
            twoMatchCands.push({
              lines: candLines,
              missOneReturn: missOne,
              obj: evalLines4DObj(candLines),
            });
          }
        }
      }
      const nonDom2 = filterNonDominatedCandidates(twoMatchCands);
      const pool2 = nonDom2.length > 0 ? nonDom2 : twoMatchCands;
      pool2.sort(
        (a, b) =>
          0.48 * b.obj.missOneCvarRatio +
          0.32 * b.obj.profitProb +
          0.2 * b.obj.evRate -
          (0.48 * a.obj.missOneCvarRatio +
            0.32 * a.obj.profitProb +
            0.2 * a.obj.evRate)
      );
      slot3Lines = pool2[0].lines;
      slot3MissOneReturn = pool2[0].missOneReturn;
      const chosenSglsA = slot3Lines
        .filter((l) => l.legs.length === 1 && l.legs[0].matchId === mA.id)
        .map((l) => l.legs[0]);
      const chosenSglsB = slot3Lines
        .filter((l) => l.legs.length === 1 && l.legs[0].matchId === mB.id)
        .map((l) => l.legs[0]);
      const covA =
        chosenSglsA.length === 0
          ? 0
          : Math.min(
              1,
              chosenSglsA.reduce((acc, g) => acc + getLegCondPair(0, g)[0], 0)
            );
      const covB =
        chosenSglsB.length === 0
          ? 0
          : Math.min(
              1,
              chosenSglsB.reduce((acc, g) => acc + getLegCondPair(1, g)[0], 0)
            );
      slot3MinCushionCondCov = Math.min(covA, covB);
      slot3MissingOneSideCushion =
        chosenSglsA.length === 0 || chosenSglsB.length === 0;
      slot3UsesSubPoolCushion = [...chosenSglsA, ...chosenSglsB].some(
        (g) => g.poolCode !== "HAD" && g.poolCode !== "HHAD"
      );
      slot3HasPartialCushionBlindSpot =
        !slot3MissingOneSideCushion &&
        (chosenSglsA.length > 0 || chosenSglsB.length > 0) &&
        slot3MinCushionCondCov < 0.999;
    } else {
      slot3Lines = materializePlanLines([mainKicker], [totalNotes]);
      slot3MissOneReturn = 0;
      slot3MissingOneSideCushion = true;
    }
  } else {
    const v = selected.length;
    const matchIds = selected.map((m) => m.id);
    // Lock strictly to consensus high-probability main legs (or user radar anchors): zero longshot cold-leg hijack
    const legProfiles = [selected.map(preferredHighProbMainLeg)];

    const wheelCands = [];
    for (const wheelLegs of legProfiles) {
      const condPairs = wheelLegs.map((lg, idx) => getLegCondPair(idx, lg));
      const legGivenHit = condPairs.map((p) => p[0]);
      const legGivenMiss = condPairs.map((p) => p[1]);
      // Conditional miss-1 probability weights w_x proportional to (1 - p_x) / p_x
      const missSceneProbs = wheelLegs.map((g) => {
        const p = Math.min(0.995, Math.max(0.02, g.fairProb));
        return (1 - p) / p;
      });
      const geomLegProb = Math.pow(
        wheelLegs.reduce((acc, g) => acc * Math.max(0.05, g.fairProb), 1),
        1 / Math.max(1, v)
      );
      const missOneHitWeight = Math.pow(geomLegProb, Math.max(1, v - 1));
      const poolCap = Math.min(
        ...wheelLegs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8)
      );
      const fullVUnclipped =
        v <= poolCap &&
        bankerRoundParlayUnitPayout(wheelLegs.map((g) => g.odds)) <=
          statutorySingleBetCap(v);

      const scoreWheelCandidate = (
        obj,
        missOneReturn,
        totalC,
        weightedTailRatio = null
      ) => {
        const probWeightedFloor = Math.min(
          2.0,
          (missOneReturn * missOneHitWeight) / Math.max(1, totalC)
        );
        const effCvarRatio =
          typeof weightedTailRatio === "number" &&
          Number.isFinite(weightedTailRatio)
            ? 0.6 * weightedTailRatio + 0.4 * obj.missOneCvarRatio
            : obj.missOneCvarRatio;
        return (
          0.55 * effCvarRatio +
          0.2 * probWeightedFloor +
          0.15 * obj.profitProb +
          0.1 * obj.evRate
        );
      };

      // 1. Official M串N combo topologies from OFFICIAL_COMBO_PASS_TABLE[v] with baseBets <= 10 (including 5串10!)
      const officialTopologies = (OFFICIAL_COMBO_PASS_TABLE[v] ?? []).filter(
        (pr) => pr.baseBets <= 10 && pr.sizes.every((s) => s <= poolCap)
      );
      for (const pr of officialTopologies) {
        const hasFullV = pr.sizes.includes(v);
        if (hasFullV && !fullVUnclipped) continue;
        const subSizes = pr.sizes.filter((s) => s < v);
        const subBlocks = subSizes.flatMap((k) => combinationsOfIndices(v, k));
        if (subBlocks.length === 0) continue;

        const blockSpecs = subBlocks.map((idxs, bIdx) => ({
          id: `cw-${bIdx + 1}`,
          roleLabel: `${pr.label}·子串#${bIdx + 1} (${idxs.map((i) => `第${i + 1}场`).join("×")})`,
          legs: idxs.map((i) => wheelLegs[i]),
        }));
        const condMissWeights = subBlocks.map((idxs) =>
          matchIds.map((_, x) =>
            idxs.reduce(
              (acc, i) => acc * (i === x ? legGivenMiss[i] : legGivenHit[i]),
              1
            )
          )
        );
        const kicker = hasFullV
          ? {
              id: "cw-all",
              roleLabel: `${pr.label}·${v}关全红主串`,
              legs: wheelLegs,
            }
          : null;

        const cand = allocateWheelMeanCvar(
          blockSpecs,
          kicker,
          matchIds,
          cleanBudget,
          false,
          condMissWeights,
          missSceneProbs
        );
        const totalC = cand.lines.reduce((a, l) => a + l.cost, 0);
        if (totalC <= 0) continue;
        const obj = evalLines4DObj(cand.lines);
        const score =
          scoreWheelCandidate(
            obj,
            cand.missOneReturn,
            totalC,
            cand.weightedTailRatio
          ) + (isGenuinePairCoveringDesign(v, subBlocks) ? 0.02 : 0);
        wheelCands.push({
          lines: cand.lines,
          missOneReturn: cand.missOneReturn,
          designLabel: `官方${pr.label}多串容错 (${cand.lines.length}张实票)`,
          isCoveringWheel: false,
          obj,
          score,
        });
      }

      // 2. Genuine C(v, k, t) covering-wheel designs (t >= 2) vs honest disjoint/sub-t=2 block partitions (ADR-0012 / Spec 0011)
      const allReducedDesigns = [
        ...(COVERING_WHEEL_DESIGNS[v] ?? []),
        ...buildDisjointPartitionDesigns(v, wheelLegs, poolCap),
      ].filter((d) => d.maxK <= poolCap && d.blocks.length <= 10);

      for (const d of allReducedDesigns) {
        const isPairCover = isGenuinePairCoveringDesign(v, d.blocks);
        const blockSpecs = d.blocks.map((idxs, bIdx) => ({
          id: `cw-${bIdx + 1}`,
          roleLabel: `${isPairCover ? "缩水组" : "容错分块"}#${bIdx + 1} (${idxs.map((i) => `第${i + 1}场`).join("×")})`,
          legs: idxs.map((i) => wheelLegs[i]),
        }));
        const condMissWeights = d.blocks.map((idxs) =>
          matchIds.map((_, x) =>
            idxs.reduce(
              (acc, i) => acc * (i === x ? legGivenMiss[i] : legGivenHit[i]),
              1
            )
          )
        );

        const canAddKicker = fullVUnclipped && d.blocks.length + 1 <= 10;
        const kickerCandidates = canAddKicker
          ? [
              null,
              { id: "cw-all", roleLabel: `${v}场全红冲顶串`, legs: wheelLegs },
            ]
          : [null];

        for (const kicker of kickerCandidates) {
          const cand = allocateWheelMeanCvar(
            blockSpecs,
            kicker,
            matchIds,
            cleanBudget,
            false,
            condMissWeights,
            missSceneProbs
          );
          const totalC = cand.lines.reduce((a, l) => a + l.cost, 0);
          if (totalC <= 0) continue;
          const obj = evalLines4DObj(cand.lines);
          const score =
            scoreWheelCandidate(
              obj,
              cand.missOneReturn,
              totalC,
              cand.weightedTailRatio
            ) + (isPairCover ? 0.02 : 0);
          const cleanDesignBase = d.name.replace(/独立分块$/, "");
          const designLabel = isPairCover
            ? `${d.name}${kicker ? `+${v}串1` : ""} 旋转矩阵缩水 (${cand.lines.length}张实票)`
            : `${cleanDesignBase}${kicker ? `+${v}串1` : ""} 独立分块容错串 (${cand.lines.length}张实票)`;
          wheelCands.push({
            lines: cand.lines,
            missOneReturn: cand.missOneReturn,
            designLabel,
            isCoveringWheel: isPairCover,
            obj,
            score,
          });
        }
      }
    }

    const paretoWheels = filterNonDominatedCandidates(wheelCands);
    const bestWheel = (
      paretoWheels.length > 0 ? paretoWheels : wheelCands
    ).sort((a, b) => b.score - a.score)[0];
    if (bestWheel) {
      slot3Lines = bestWheel.lines;
      slot3MissOneReturn = bestWheel.missOneReturn;
      slot3DesignLabel = bestWheel.designLabel;
      slot3IsCoveringWheel = Boolean(bestWheel.isCoveringWheel);
    }
  }

  let slot3WipeoutMiss2Prob = null;
  if (selected.length >= 2) {
    const consensusProbs = selected.map((m) => {
      const lg = preferredHighProbMainLeg(m);
      return Math.min(0.999, Math.max(0.001, lg?.fairProb ?? 0.5));
    });
    const pAll = consensusProbs.reduce((acc, p) => acc * p, 1);
    let pMiss1 = 0;
    for (let x = 0; x < consensusProbs.length; x++) {
      let prodOthers = 1;
      for (let i = 0; i < consensusProbs.length; i++) {
        if (i !== x) prodOthers *= consensusProbs[i];
      }
      pMiss1 += (1 - consensusProbs[x]) * prodOthers;
    }
    slot3WipeoutMiss2Prob = Math.min(1, Math.max(0, 1 - pAll - pMiss1));
  }

  const slot3Reasons = [
    selected.length >= 3
      ? slot3IsCoveringWheel
        ? `采用组合覆盖设计 ${slot3DesignLabel}（满足任意两场全覆盖 t≥2，严控 ≤ 10 张实票），锁定错 1 场保底回血 ¥${slot3MissOneReturn.toFixed(2)}`
        : `采用中国体彩 ${slot3DesignLabel} 结构（严控 ≤ 10 张独立实票），锁定错 1 场保底回血 ¥${slot3MissOneReturn.toFixed(2)}`
      : slot3MissingOneSideCushion
        ? "仅开放单关场次可配回血垫，若未开放单关场次爆冷则错 1 场保底为 ¥0.00"
        : slot3HasPartialCushionBlindSpot
          ? slot3UsesSubPoolCushion
            ? `借道半全场/局部单关构建回血垫（覆盖正路 ${(slot3MinCushionCondCov * 100).toFixed(0)}%），若踢出半场逆转等未覆盖死角派奖为 ¥0`
            : `采用让球单关构建高赔回血垫（覆盖正路 ${(slot3MinCushionCondCov * 100).toFixed(0)}%），若踢出一球卡盘未覆盖死角派奖为 ¥0`
          : "配置无死角主盘单关回血垫，最大化错 1 场保底回血与连红上限",
  ];

  const slot3Plan = packSlot({
    key: "max-cvar-wheel",
    shortTab: "🧩 容错缩水",
    badge: "🧩 容错缩水极值",
    title:
      selected.length >= 3
        ? slot3DesignLabel
        : selected.length === 2
          ? "2串1主干 + 单关回血垫"
          : "单场多路防冷缓冲网",
    tagline: null,
    lines: slot3Lines,
    missOneReturn: slot3MissOneReturn,
    wipeoutMiss2Prob: slot3WipeoutMiss2Prob,
    reasons: slot3Reasons,
  });
  if (slot3Plan.available) {
    const zProb =
      slot3Plan.zeroPayoutProb ?? Math.max(0, 1 - slot3Plan.winProb);
    if (slot3WipeoutMiss2Prob !== null) {
      slot3Plan.reasons.push(
        `风险诚实披露：整单真实全黑归零率 ${(zProb * 100).toFixed(1)}% · 主干错 ≥ 2 场率 ${(slot3WipeoutMiss2Prob * 100).toFixed(1)}%（错 1 场属局部回血缓冲，非全额无损保本）`
      );
    } else {
      slot3Plan.reasons.push(
        "全中时多张覆盖子票叠加派奖，兼顾防黑韧性与满贯上限"
      );
    }
    slot3Plan.tagline =
      selected.length >= 3
        ? `黑掉1场保底拿回 ¥${slot3MissOneReturn.toFixed(1)} · 全中叠加拿回 ¥${slot3Plan.maxReturn.toFixed(1)}`
        : selected.length === 2
          ? slot3MissingOneSideCushion
            ? `单侧未开单关保底 ¥0.0（有垫侧回血 ¥${Math.max(0, ...slot3Lines.filter((l) => l.legs.length === 1).map((l) => l.returnPayout)).toFixed(1)}） · 全中拿回 ¥${slot3Plan.maxReturn.toFixed(1)}`
            : slot3HasPartialCushionBlindSpot
              ? slot3UsesSubPoolCushion
                ? `命中回血垫保底拿回 ¥${slot3MissOneReturn.toFixed(1)}（半场逆转死角 ¥0） · 全中拿回 ¥${slot3Plan.maxReturn.toFixed(1)}`
                : `命中让球垫保底拿回 ¥${slot3MissOneReturn.toFixed(1)}（一球卡盘死角 ¥0） · 全中拿回 ¥${slot3Plan.maxReturn.toFixed(1)}`
              : `黑掉1场保底拿回 ¥${slot3MissOneReturn.toFixed(1)} · 全中叠加拿回 ¥${slot3Plan.maxReturn.toFixed(1)}`
          : `命中缓冲网保底拿回 ¥${slot3Plan.minReturn.toFixed(1)} ~ 最高 ¥${slot3Plan.maxReturn.toFixed(1)}`;
  }

  // =========================================================================
  // Slot ④: alpha-radar (⚡ 错价雷达 · 经验贝叶斯收缩纯正期望 +EV 硬门禁 + 宁缺毋滥空仓纪律)
  // =========================================================================
  const rawAlphaPool = [];
  for (const m of selected) {
    const scan = scanMatchAlphaCandidates(
      m,
      hasUserAnchors ? anchorsByMatch.get(m.id) : null
    );
    for (const c of scan.candidates) {
      if (c.isPositiveEv && c.expectedReturn >= 1.01) {
        rawAlphaPool.push(c);
      }
    }
  }
  rawAlphaPool.sort(
    (a, b) => b.expectedReturn - a.expectedReturn || b.delta - a.delta
  );

  const aggBudget = unlockFullAgg
    ? cleanBudget
    : Math.min(
        cleanBudget,
        Math.max(16, Math.round((cleanBudget * 0.36) / 4) * 4)
      );

  const appendSingleAlphaSpecs = (cand, idPrefix) => {
    const singleLeg = legOf(cand.match, cand.poolCode, cand.optionKey);
    if (!singleLeg) return false;
    alphaSpecs.push({
      id: `${idPrefix}-${alphaSpecs.length + 1}`,
      roleLabel: "跨盘+EV单关直击",
      legs: [singleLeg],
      weight: Math.max(0.02, cand.delta + 0.06),
    });
    return true;
  };

  const sortLegsBySelectedOrder = (legs) =>
    [...legs].sort(
      (a, b) =>
        selected.findIndex((m) => m.id === a.matchId) -
        selected.findIndex((m) => m.id === b.matchId)
    );

  let alphaSpecs = [];
  let selectedAlphaCands = [];

  if (selected.length === 1) {
    // Single-match checkout legality gate: ONLY single-capable +EV options can check out alone at a Sporttery shop
    const legalSingles = rawAlphaPool.filter((c) => c.singleAllowed);
    for (const c of legalSingles.slice(0, 2)) {
      if (appendSingleAlphaSpecs(c, "ar")) selectedAlphaCands.push(c);
    }
  } else if (rawAlphaPool.length > 0) {
    const bestAlphaByMatch = [];
    const seenMid = new Set();
    for (const c of rawAlphaPool) {
      if (!seenMid.has(c.matchId)) {
        seenMid.add(c.matchId);
        bestAlphaByMatch.push(c);
      }
    }

    // 1. Prefer single-capable +EV tickets directly (zero parlay vig compound loss!)
    const topSingles = rawAlphaPool.filter((c) => c.singleAllowed).slice(0, 2);
    for (const c of topSingles) {
      if (alphaSpecs.length >= 4) break;
      if (appendSingleAlphaSpecs(c, "ar-sgl")) {
        selectedAlphaCands.push(c);
      }
    }

    // 2. Only when NO single-capable +EV ticket exists (non-single +EV leg requires 1 partner to place a legal 2串1)
    if (alphaSpecs.length === 0 && bestAlphaByMatch.length >= 1) {
      const alphaC = bestAlphaByMatch[0];
      const alphaLeg = legOf(alphaC.match, alphaC.poolCode, alphaC.optionKey);
      let partnerLeg = null;
      let partnerCand = null;
      if (bestAlphaByMatch.length >= 2) {
        partnerCand = bestAlphaByMatch[1];
        partnerLeg = legOf(
          partnerCand.match,
          partnerCand.poolCode,
          partnerCand.optionKey
        );
      } else {
        const partnerMatches = selected
          .filter((m) => m.id !== alphaC.matchId)
          .map((m) => ({ m, leg: evPrimaryLegOf(m) }))
          .filter((x) => x.leg)
          .sort(
            (a, b) => b.leg.odds * b.leg.fairProb - a.leg.odds * a.leg.fairProb
          );
        if (partnerMatches[0]) partnerLeg = partnerMatches[0].leg;
      }
      if (alphaLeg && partnerLeg) {
        const pairLegs = sortLegsBySelectedOrder([alphaLeg, partnerLeg]);
        const maxPass = Math.min(
          ...pairLegs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8)
        );
        if (
          pairLegs.length === 2 &&
          maxPass >= 2 &&
          bankerRoundParlayUnitPayout(pairLegs.map((g) => g.odds)) <=
            statutorySingleBetCap(2)
        ) {
          alphaSpecs.push({
            id: "ar-par-1",
            roleLabel: partnerCand ? "2场跨盘+EV双核2串1" : "跨盘+EV配胆·2串1",
            legs: pairLegs,
            weight: Math.max(
              0.02,
              alphaC.delta + (partnerCand ? partnerCand.delta * 0.5 : 0)
            ),
          });
          selectedAlphaCands.push(alphaC);
          if (partnerCand) selectedAlphaCands.push(partnerCand);
        }
      }
    }
  }

  const buildEmptyAlphaSlot = () => {
    const emptyMsg = `当前所选场次五池定价严密，无跨盘错价洼地 · 建议空仓立省 ¥${cleanBudget}，或采用前 3 档主方案`;
    return packSlot({
      key: "alpha-radar",
      available: false,
      alphaKind: "none",
      emptyReason: emptyMsg,
      shortTab: "⚡ 错价雷达",
      badge: "⚡ 跨盘真错价雷达 · 空仓",
      title: "当前盘面定价严密 · 建议空仓省钱",
      tagline: `已替你拦截强凑废单 · 全额立省 ¥${cleanBudget} 本金`,
      lines: [],
      savedCash: cleanBudget,
      reasons: [
        emptyMsg,
        "全盘经经验贝叶斯收缩校准扫描后无 ≥ +1.0% 纯正期望（+EV）洼地，严守宁缺毋滥客观纪律",
      ],
    });
  };

  let slot4Plan;
  if (alphaSpecs.length === 0 || selectedAlphaCands.length === 0) {
    slot4Plan = buildEmptyAlphaSlot();
  } else {
    const targetNotes = Math.max(alphaSpecs.length, Math.floor(aggBudget / 2));
    const wSum = alphaSpecs.reduce((a, s) => a + s.weight, 0) || 1;
    let rem = targetNotes - alphaSpecs.length;
    const mults = alphaSpecs.map(() => 1);
    for (let i = 0; i < alphaSpecs.length && rem > 0; i++) {
      const add =
        i === alphaSpecs.length - 1
          ? rem
          : Math.min(
              rem,
              Math.round(
                ((targetNotes - alphaSpecs.length) * alphaSpecs[i].weight) /
                  wSum
              )
            );
      mults[i] = Math.min(999, mults[i] + Math.max(0, add));
      rem -= Math.max(0, add);
    }
    if (rem > 0) mults[0] = Math.min(999, mults[0] + rem);

    const alphaLines = materializePlanLines(alphaSpecs, mults);
    const actualSpent = alphaLines.reduce((a, l) => a + l.cost, 0);
    const savedCash = Math.max(0, cleanBudget - actualSpent);
    const bestCand = selectedAlphaCands[0];
    const displayEdgePct = (bestCand.delta * 100).toFixed(1);

    const candidatePlan = packSlot({
      key: "alpha-radar",
      available: true,
      alphaKind: "positive-ev",
      shortTab: "⚡ 错价雷达",
      badge: `🔥 跨盘绝对正期望 (+${displayEdgePct}% +EV)`,
      title: `跨盘调水滞后 · 绝对正期望 (+${displayEdgePct}% +EV) 狙击`,
      tagline: unlockFullAgg
        ? `已解锁全额仓位 ¥${actualSpent} 狙击真实跨盘正期望`
        : `36% 轻仓护本垫：仅动用 ¥${actualSpent} 狙击正期望洼地（立省 ¥${savedCash} 护本）`,
      lines: alphaLines,
      savedCash,
      reasons: [
        `检出【${bestCand.match.matchNumStr} ${bestCand.poolName}·${bestCand.optionLabel}@${bestCand.odds.toFixed(2)}】收缩校准期望返还 ${(bestCand.expectedReturn * 100).toFixed(1)}%（纯正期望 +${displayEdgePct}% +EV）`,
        unlockFullAgg
          ? "已手动解锁全额仓位，请严格配合每日止损护栏控制波动"
          : `默认开启 36% 轻仓护栏，保住 ¥${savedCash} 现金储备抵御高赔方差`,
      ],
    });

    // Strict Post-Ticket Hard Gate: require BOTH objective shrunk-prob +EV AND active-stance net plan EV > 0
    const getObjectiveShrunkLegProb = (lg) => {
      const fm = selected.find((m) => m.id === lg.matchId);
      if (!fm) return lg.fairProb;
      const cal = getCachedMatchCalibration(fm);
      const calOpt = cal.pools?.[lg.poolCode]?.options?.find(
        (o) => o.key === lg.optionKey || o.label === lg.optionLabel
      );
      const lookupKey =
        lg.poolCode === "CRS" ? lg.optionLabel || lg.optionKey : lg.optionKey;
      const dcProb =
        cal.poolProbs?.[lg.poolCode]?.[lookupKey] ??
        calOpt?.fairProb ??
        lg.fairProb;
      const shinProb = calOpt?.shinProb ?? dcProb;
      if (lg.poolCode === "HAD" || lg.poolCode === "HHAD") {
        return Math.min(0.65 * dcProb + 0.35 * shinProb, shinProb * 1.28);
      }
      return computeOptionShrunkAlpha(lg.odds, dcProb, shinProb).pShrunk;
    };
    const shrunkExpectedReturn = alphaLines.reduce(
      (acc, l) =>
        acc +
        l.returnPayout *
          l.legs.reduce((p, lg) => p * getObjectiveShrunkLegProb(lg), 1),
      0
    );
    slot4Plan =
      candidatePlan.available &&
      candidatePlan.expectedValueRate > 0 &&
      shrunkExpectedReturn > actualSpent
        ? candidatePlan
        : buildEmptyAlphaSlot();
  }

  return [slot1Plan, slot2Plan, slot3Plan, slot4Plan];
}

export const generateFiveArchetypes = generateParetoPortfolio;

function parseKickoffMinutes(hhmm) {
  const [hStr, mStr] = String(hhmm || "20:00").split(":");
  const h = Number(hStr) || 0;
  const min = Number(mStr) || 0;
  const normalizedH = h < 12 ? h + 24 : h;
  return normalizedH * 60 + min;
}

function parseMatchDatePrefixMinutes(matchId) {
  const m =
    /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[-_]\d+|\d{3})?$/.exec(
      String(matchId || "")
    );
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dy = Number(m[3]);
  const ts = Date.UTC(yr, mo, dy);
  return Number.isFinite(ts) ? Math.round(ts / 60_000) : null;
}

function getSellingPoolOption(pool, key, requireSingle = false) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options))
    return null;
  if (requireSingle && pool.single !== true) return null;
  const found = pool.options.find((o) => o.key === key && Number(o.odds) > 0);
  return found ?? null;
}

function resolveComplementaryLateHedge(late, latePicks) {
  if (!Array.isArray(latePicks) || latePicks.length === 0) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr || ""} 未包含有效选号，无法构建互补反向对冲`,
    };
  }

  const latePools = Array.from(new Set(latePicks.map((p) => p.poolCode)));
  const nonCompPool = latePools.find(
    (c) => c === "TTG" || c === "CRS" || c === "HAFU"
  );
  if (nonCompPool) {
    const poolTitle =
      nonCompPool === "TTG"
        ? "总进球"
        : nonCompPool === "CRS"
          ? "比分"
          : "半全场";
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 所选为【${poolTitle}】玩法，属局部赛果分支，无法通过胜平负或让球盘构成 100% 无死角互补对冲`,
    };
  }

  if (
    latePools.length !== 1 ||
    (latePools[0] !== "HAD" && latePools[0] !== "HHAD")
  ) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 含跨玩法混合选项，无法构建 100% 无死角互补反向盘`,
    };
  }

  const poolCode = latePools[0];
  const pickedKeys = new Set(latePicks.map((p) => p.optionKey));
  const hadPool = late.pools?.HAD;
  const hhadPool = late.pools?.HHAD;
  const goalLineNum = Number(hhadPool?.goalLine ?? "-1");
  const goalLineStr =
    hhadPool?.goalLine ??
    (goalLineNum > 0 ? `+${goalLineNum}` : String(goalLineNum));

  const pickBest = (candidates) => {
    const valid = candidates.filter(
      (c) => c && Number.isFinite(c.odds) && c.odds > 0
    );
    if (valid.length === 0) return null;
    valid.sort(
      (a, b) => b.odds - a.odds || Number(a.isPair) - Number(b.isPair)
    );
    return valid[0];
  };

  const makeSingleCand = (opt, poolTag) =>
    opt
      ? {
          label: `${late.home} 反向【${poolTag}·${opt.label}】`,
          odds: opt.odds,
          isPair: false,
        }
      : null;

  const makePairCand = (opt1, opt2, poolTag) =>
    opt1 && opt2
      ? {
          label: `${late.home} 反向【${poolTag}·${opt1.label}+${opt2.label}配平】`,
          poolTag,
          opt1Label: opt1.label,
          opt2Label: opt2.label,
          odds1: opt1.odds,
          odds2: opt2.odds,
          odds: 1 / (1 / opt1.odds + 1 / opt2.odds),
          isPair: true,
        }
      : null;

  const evalForSingleRequirement = (requireSingle) => {
    if (poolCode === "HAD") {
      const validHadKeys = ["h", "d", "a"].filter((k) => pickedKeys.has(k));
      if (
        validHadKeys.length !== pickedKeys.size ||
        validHadKeys.length === 0
      ) {
        return {
          ok: false,
          reason: `末场 ${late.matchNumStr} 胜平负选项异常，无法构成完备互补对冲`,
        };
      }
      if (validHadKeys.length >= 3) {
        return {
          ok: false,
          reason: `末场 ${late.matchNumStr} 已全包胜平负全部赛果，无需额外补买反向对冲`,
        };
      }
      if (validHadKeys.length === 2) {
        const remKey = ["h", "d", "a"].find((k) => !pickedKeys.has(k));
        const remOpt = getSellingPoolOption(hadPool, remKey, requireSingle);
        const best = makeSingleCand(remOpt, "胜平负");
        return best
          ? { ok: true, candidate: best }
          : {
              ok: false,
              reason: `末场 ${late.matchNumStr} 缺少在售的胜平负互补第 3 项，无法无死角锁利`,
            };
      }

      const singleKey = validHadKeys[0];
      const hadH = getSellingPoolOption(hadPool, "h", requireSingle);
      const hadD = getSellingPoolOption(hadPool, "d", requireSingle);
      const hadA = getSellingPoolOption(hadPool, "a", requireSingle);
      let best = null;
      if (singleKey === "h") {
        const hhadHa =
          goalLineNum === -1
            ? getSellingPoolOption(hhadPool, "ha", requireSingle)
            : null;
        best = pickBest([
          makeSingleCand(hhadHa, "让球(-1)"),
          makePairCand(hadD, hadA, "胜平负"),
        ]);
      } else if (singleKey === "a") {
        const hhadHh =
          goalLineNum === 1
            ? getSellingPoolOption(hhadPool, "hh", requireSingle)
            : null;
        best = pickBest([
          makeSingleCand(hhadHh, "让球(+1)"),
          makePairCand(hadH, hadD, "胜平负"),
        ]);
      } else if (singleKey === "d") {
        best = makePairCand(hadH, hadA, "胜平负");
      }

      return best
        ? { ok: true, candidate: best }
        : {
            ok: false,
            reason: `末场 ${late.matchNumStr} 缺少在售的 100% 互补反向盘口，无法无死角对冲`,
          };
    }

    const validHhadKeys = ["hh", "hd", "ha"].filter((k) => pickedKeys.has(k));
    if (
      !Number.isFinite(goalLineNum) ||
      goalLineNum === 0 ||
      validHhadKeys.length !== pickedKeys.size ||
      validHhadKeys.length === 0
    ) {
      return {
        ok: false,
        reason: `末场 ${late.matchNumStr} 让球盘选项异常，无法构成完备互补对冲`,
      };
    }
    if (validHhadKeys.length >= 3) {
      return {
        ok: false,
        reason: `末场 ${late.matchNumStr} 已全包让球胜平负全部赛果，无需额外补买反向对冲`,
      };
    }
    const poolTag = `让球(${goalLineStr})`;
    if (validHhadKeys.length === 2) {
      const remKey = ["hh", "hd", "ha"].find((k) => !pickedKeys.has(k));
      const remOpt = getSellingPoolOption(hhadPool, remKey, requireSingle);
      const best = makeSingleCand(remOpt, poolTag);
      return best
        ? { ok: true, candidate: best }
        : {
            ok: false,
            reason: `末场 ${late.matchNumStr} 缺少在售的${poolTag}互补第 3 项，无法无死角锁利`,
          };
    }

    const singleKey = validHhadKeys[0];
    const otherKeys = ["hh", "hd", "ha"].filter((k) => k !== singleKey);
    const opt1 = getSellingPoolOption(hhadPool, otherKeys[0], requireSingle);
    const opt2 = getSellingPoolOption(hhadPool, otherKeys[1], requireSingle);
    let crossSingle = null;
    if (goalLineNum === -1 && singleKey === "ha") {
      crossSingle = makeSingleCand(
        getSellingPoolOption(hadPool, "h", requireSingle),
        "胜平负"
      );
    } else if (goalLineNum === 1 && singleKey === "hh") {
      crossSingle = makeSingleCand(
        getSellingPoolOption(hadPool, "a", requireSingle),
        "胜平负"
      );
    }
    const best = pickBest([crossSingle, makePairCand(opt1, opt2, poolTag)]);
    return best
      ? { ok: true, candidate: best }
      : {
          ok: false,
          reason: `末场 ${late.matchNumStr} 缺少在售的 100% 互补反向盘口，无法无死角对冲`,
        };
  };

  const strictSingleRes = evalForSingleRequirement(true);
  if (strictSingleRes.ok) return strictSingleRes;
  const sellingOnlyRes = evalForSingleRequirement(false);
  if (sellingOnlyRes.ok) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 互补胜平负/让球盘未开单关，体彩店无法单独补买反向盘对冲`,
    };
  }
  return strictSingleRes;
}

function extractPlanEffectivePicks(appliedPlan) {
  if (!Array.isArray(appliedPlan?.lines) || appliedPlan.lines.length === 0)
    return null;
  const byKey = new Map();
  for (const l of appliedPlan.lines) {
    for (const lg of l.legs || []) {
      const k = `${lg.matchId}-${lg.poolCode}-${lg.optionKey}`;
      if (!byKey.has(k)) {
        byKey.set(k, {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          singleAllowed: true,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
        });
      }
    }
  }
  return Array.from(byKey.values());
}

function validatePlanLateHedgeConsistency(appliedPlan, late) {
  if (!Array.isArray(appliedPlan?.lines) || appliedPlan.lines.length === 0) {
    return { ok: true, latePicks: null };
  }
  const lateLines = appliedPlan.lines.filter(
    (l) => Array.isArray(l.legs) && l.legs.some((g) => g.matchId === late.id)
  );
  if (lateLines.length === 0) {
    return {
      ok: false,
      reason: `当前分倍方案未包含末场 ${late.matchNumStr} 串关实票，无法执行末场补单锁利`,
    };
  }
  const latePoolSet = new Set();
  const latePickMap = new Map();
  const earlySigToLateOpts = new Map();

  for (const l of lateLines) {
    const earlySig = l.legs
      .filter((g) => g.matchId !== late.id)
      .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
      .sort()
      .join("|");
    const lateLegs = l.legs.filter((g) => g.matchId === late.id);
    if (!earlySigToLateOpts.has(earlySig)) {
      earlySigToLateOpts.set(earlySig, new Set());
    }
    const optSet = earlySigToLateOpts.get(earlySig);
    for (const lg of lateLegs) {
      latePoolSet.add(lg.poolCode);
      optSet.add(`${lg.poolCode}:${lg.optionKey}`);
      const pkKey = `${lg.poolCode}:${lg.optionKey}`;
      if (!latePickMap.has(pkKey)) {
        latePickMap.set(pkKey, {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          singleAllowed: true,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
        });
      }
    }
  }

  if (latePoolSet.size > 1) {
    return {
      ok: false,
      reason: `当前分倍方案在末场 ${late.matchNumStr} 混合了跨玩法盘口，无法通过单一反向单 100% 无死角锁利`,
    };
  }

  const canonicalOptionSets = Array.from(earlySigToLateOpts.values()).map((s) =>
    Array.from(s).sort().join(",")
  );
  if (new Set(canonicalOptionSets).size > 1) {
    return {
      ok: false,
      reason: `当前分倍方案各注前序赛果对应的末场 ${late.matchNumStr} 持仓不一致，需前序完场确认存活实票后再定向补单`,
    };
  }

  return { ok: true, latePicks: Array.from(latePickMap.values()) };
}

/** 3. 审单细节小 Tips：早晚场时间差对冲锁利 + 串关拖油瓶体检 + 同义省钱替换 + 连黑预警 */
export function computeProOrderInsights(
  picks,
  report,
  matches,
  appliedPlan = null
) {
  const planPicks = extractPlanEffectivePicks(appliedPlan);
  const effectivePicks = planPicks && planPicks.length > 0 ? planPicks : picks;
  const matchIds = Array.from(new Set(effectivePicks.map((p) => p.matchId)));
  const pickedMatches = matchIds
    .map((id) => matches.find((m) => m.id === id))
    .filter(Boolean);

  let hedge = {
    available: false,
    hedgeMode: "unavailable",
    gapMinutes: 0,
    gapText: "同时间段开球",
    earlyMatchTitle: "",
    lateMatchTitle: "",
    earlyKickoff: "",
    lateKickoff: "",
    oppositeLabel: "",
    oppositeOdds: 1.85,
    hedgeCost: 0,
    lockedNetProfit: 0,
    reason: "需至少选择 2 场且开球时间间隔 ≥ 110 分钟（前场完场后可补单锁利）",
  };

  if (pickedMatches.length >= 2) {
    const isPureSinglePass =
      !Array.isArray(report?.activePassSizes) ||
      report.activePassSizes.length === 0 ||
      report.activePassSizes.every((s) => s === 1);

    if (report?.canCheckout !== true) {
      hedge.reason =
        report?.ruleBlockReason ||
        "当前选单不满足合法出票条件，暂无法启用早晚场时间差对冲锁利";
    } else if (isPureSinglePass) {
      hedge.reason =
        "当前为纯单关独立计奖模式，各场互不串连，无需早晚场补单对冲锁利";
    } else {
      const useDatePrefix = pickedMatches.every(
        (m) => parseMatchDatePrefixMinutes(m.id) !== null
      );
      const timeMinutesOf = (m) =>
        (useDatePrefix ? (parseMatchDatePrefixMinutes(m.id) ?? 0) : 0) +
        parseKickoffMinutes(m.kickoff);

      const sortedByTime = [...pickedMatches].sort(
        (a, b) => timeMinutesOf(a) - timeMinutesOf(b)
      );
      const penultimate = sortedByTime[sortedByTime.length - 2];
      const late = sortedByTime[sortedByTime.length - 1];
      const gap = Math.max(0, timeMinutesOf(late) - timeMinutesOf(penultimate));
      const hrs = Math.floor(gap / 60);
      const mins = gap % 60;
      const gapText =
        gap <= 0
          ? "同时间段开球"
          : hrs > 0
            ? `${hrs}小时${mins > 0 ? `${mins}分` : ""}`
            : `${mins}分`;
      const earlyMatchTitle = `${penultimate.matchNumStr} ${penultimate.home}vs${penultimate.away}`;
      const lateMatchTitle = `${late.matchNumStr} ${late.home}vs${late.away}`;

      if (gap < 110) {
        hedge = {
          ...hedge,
          available: false,
          hedgeMode: "unavailable",
          gapMinutes: gap,
          gapText,
          earlyMatchTitle,
          lateMatchTitle,
          earlyKickoff: penultimate.kickoff,
          lateKickoff: late.kickoff,
          reason:
            sortedByTime.length >= 3
              ? `前序最晚场次 ${penultimate.matchNumStr}(${penultimate.kickoff}) 与末场 ${late.matchNumStr}(${late.kickoff}) 开球仅差 ${gap} 分钟（需 ≥ 110 分钟），前序场次未在末场开球前完场，无法单场无风险锁利`
              : `两场开球仅间隔 ${gap} 分钟（需 ≥ 110 分钟），前场尚未完场，暂无法执行早晚场补单锁利`,
        };
      } else {
        const planConsistency = validatePlanLateHedgeConsistency(
          appliedPlan,
          late
        );
        const latePicks =
          planConsistency.ok && planConsistency.latePicks
            ? planConsistency.latePicks
            : effectivePicks.filter((p) => p.matchId === late.id);
        const resolved = planConsistency.ok
          ? resolveComplementaryLateHedge(late, latePicks)
          : { ok: false, reason: planConsistency.reason };
        if (!resolved.ok) {
          hedge = {
            ...hedge,
            available: false,
            hedgeMode: "unavailable",
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            reason: resolved.reason,
          };
        } else {
          const bestCand = resolved.candidate;
          const oppOdds = bestCand.odds;
          const allHitCombos = Array.isArray(report.combos)
            ? report.combos.filter(
                (c) =>
                  Array.isArray(c.legs) &&
                  new Set(c.legs.map((g) => g.matchId)).size ===
                    pickedMatches.length
              )
            : [];
          const minAllHitPayout =
            allHitCombos.length > 0
              ? Math.min(...allHitCombos.map((c) => c.totalPayout))
              : 0;
          const targetReturn =
            minAllHitPayout > 0
              ? minAllHitPayout
              : Math.max(report.minPayout, report.likelyRange?.[0] ?? 0);
          let hedgeCost = 2;
          let lockedNetProfit = -report.totalCost;
          let oppositeLabel = bestCand.label;
          if (
            bestCand.isPair &&
            Number(bestCand.odds1) > 0 &&
            Number(bestCand.odds2) > 0
          ) {
            const u1 = bankerRoundParlayUnitPayout([bestCand.odds1]);
            const u2 = bankerRoundParlayUnitPayout([bestCand.odds2]);
            const m1Mid = Math.max(1, Math.round(targetReturn / u1));
            const m2Mid = Math.max(1, Math.round(targetReturn / u2));
            let bestNet = -Infinity;
            let bestM1 = m1Mid;
            let bestM2 = m2Mid;
            for (let m1 = Math.max(1, m1Mid - 3); m1 <= m1Mid + 3; m1++) {
              for (let m2 = Math.max(1, m2Mid - 3); m2 <= m2Mid + 3; m2++) {
                const cHedge = 2 * (m1 + m2);
                const worstPay = Math.min(targetReturn, m1 * u1, m2 * u2);
                const net = worstPay - report.totalCost - cHedge;
                if (
                  net > bestNet + 1e-9 ||
                  (Math.abs(net - bestNet) <= 1e-9 &&
                    cHedge < 2 * (bestM1 + bestM2))
                ) {
                  bestNet = net;
                  bestM1 = m1;
                  bestM2 = m2;
                }
              }
            }
            hedgeCost = 2 * (bestM1 + bestM2);
            lockedNetProfit = Number(bestNet.toFixed(2));
            oppositeLabel = `${late.home} 反向【${bestCand.poolTag}·${bestCand.opt1Label}¥${2 * bestM1}+${bestCand.opt2Label}¥${2 * bestM2}】`;
          } else {
            const uSingle = bankerRoundParlayUnitPayout([oppOdds]);
            const mMid = Math.max(1, Math.round(targetReturn / uSingle));
            let bestNet = -Infinity;
            let bestM = mMid;
            for (let m = Math.max(1, mMid - 2); m <= mMid + 2; m++) {
              const cHedge = 2 * m;
              const worstPay = Math.min(targetReturn, m * uSingle);
              const net = worstPay - report.totalCost - cHedge;
              if (
                net > bestNet + 1e-9 ||
                (Math.abs(net - bestNet) <= 1e-9 && cHedge < 2 * bestM)
              ) {
                bestNet = net;
                bestM = m;
              }
            }
            hedgeCost = 2 * bestM;
            lockedNetProfit = Number(bestNet.toFixed(2));
          }
          const hedgeMode =
            lockedNetProfit > 0
              ? "lock-profit"
              : lockedNetProfit === 0
                ? "break-even"
                : "reduce-loss";
          const lockedReturn = Number(
            (report.totalCost + hedgeCost + lockedNetProfit).toFixed(2)
          );
          const hedgeReason =
            hedgeMode === "lock-profit"
              ? sortedByTime.length >= 3
                ? `前 ${sortedByTime.length - 1} 场最晚(${penultimate.kickoff})完场后距末场(${late.kickoff})仍有 ${gapText} 窗口！若前序 ${sortedByTime.length - 1} 关全红，单关补买 ¥${hedgeCost} 互补反向盘即可稳赚锁利 +¥${lockedNetProfit.toFixed(2)}！`
                : `早场(${penultimate.kickoff})完场后距晚场(${late.kickoff})间隔 ${gapText}！若第一关顺利红单，单关补买 ¥${hedgeCost} 互补反向盘即可稳赚锁利 +¥${lockedNetProfit.toFixed(2)}！`
              : hedgeMode === "break-even"
                ? `前序红单后距末场(${late.kickoff})间隔 ${gapText}；单关补买 ¥${hedgeCost} 互补反向盘可零损拿回全部成本 ¥${lockedReturn.toFixed(2)}。`
                : `受两元偶数凑整与双盘抽水影响，前序红单后单关补买 ¥${hedgeCost} 互补反向盘仅属减损止血：锁死少亏 -¥${Math.abs(lockedNetProfit).toFixed(2)}（拿回 ¥${lockedReturn.toFixed(2)}），无法正收益，请谨慎评估。`;

          hedge = {
            available: true,
            hedgeMode,
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            oppositeLabel,
            oppositeOdds: oppOdds,
            hedgeCost,
            lockedNetProfit,
            reason: hedgeReason,
          };
        }
      }
    }
  }

  let weakestLink = null;
  const rawPicksList = Array.isArray(picks) ? picks : [];
  const rawPickedMatchIds = Array.from(
    new Set(rawPicksList.map((p) => p.matchId))
  );
  if (!appliedPlan && rawPickedMatchIds.length >= 2 && report?.canCheckout) {
    const rawPickedMatches = rawPickedMatchIds
      .map((id) => matches.find((m) => m.id === id))
      .filter(Boolean);
    if (rawPickedMatches.length >= 2) {
      const perMatchProb = rawPickedMatches.map((m) => {
        const mp = rawPicksList.filter((p) => p.matchId === m.id);
        const sumP = Math.min(
          0.98,
          mp.reduce((a, x) => a + x.fairProb, 0)
        );
        return { m, sumP };
      });
      perMatchProb.sort((a, b) => a.sumP - b.sumP);
      const worst = perMatchProb[0];
      if (worst) {
        const remainingPicks = rawPicksList.filter(
          (p) => p.matchId !== worst.m.id
        );
        const nextPassSpec = report.activeComboCode
          ? { mode: "combo", comboCode: report.activeComboCode }
          : Array.isArray(report.activePassSizes) &&
              report.activePassSizes.length > 0
            ? { mode: "free", passSizes: report.activePassSizes }
            : { mode: "auto" };
        const afterRep = computeTruthReport(
          remainingPicks,
          report.multiple || 1,
          matches,
          nextPassSpec
        );
        if (
          afterRep.canCheckout === true &&
          afterRep.realProfitProb - report.realProfitProb >= 0.14
        ) {
          weakestLink = {
            matchId: worst.m.id,
            matchTitle: `${worst.m.matchNumStr} ${worst.m.home}vs${worst.m.away}`,
            currentProfitProb: report.realProfitProb,
            afterRemoveProfitProb: afterRep.realProfitProb,
            message: `【${worst.m.home}vs${worst.m.away}】单场命中率仅 ${(worst.sumP * 100).toFixed(0)}%，是拉低整单真赚钱率的最大瓶颈；砍掉它后真赚钱率立升至 ${(afterRep.realProfitProb * 100).toFixed(1)}%！`,
          };
        }
      }
    }
  }

  let activeSwapTip = null;
  for (const m of pickedMatches) {
    const mpicks = effectivePicks.filter((p) => p.matchId === m.id);
    const arbitrages = computeEquivalentArbitrages(m);
    const matchedArb = arbitrages.find((arb) => {
      if (
        pickedMatches.length === 1 &&
        report?.canCheckout === true &&
        !arb.betterPicks.every(
          (bp) =>
            m.pools?.[bp.poolCode]?.selling !== false &&
            m.pools?.[bp.poolCode]?.single === true
        )
      ) {
        return false;
      }
      const hasAllWorse =
        arb.worsePicks.length > 0 &&
        arb.worsePicks.every((wp) =>
          mpicks.some(
            (p) => p.poolCode === wp.poolCode && p.optionKey === wp.optionKey
          )
        );
      const hasAllBetter =
        arb.betterPicks.length > 0 &&
        arb.betterPicks.every((bp) =>
          mpicks.some(
            (p) => p.poolCode === bp.poolCode && p.optionKey === bp.optionKey
          )
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
  const evRate = Number(report.expectedValueRate) || 0;
  // Kelly Criterion discipline (ADR-0010 / Spec 0009): negative-EV bets have optimal Kelly f* = 0%;
  // cap recreational budget exposure strictly at <= 2% so high-hit-rate favorites never induce ruinous 12% stakes.
  const recommendedBankrollPct =
    evRate <= 0
      ? p >= 0.4
        ? 2
        : 1
      : Math.min(
          5,
          Math.max(
            1,
            Math.round(
              0.25 *
                (evRate /
                  Math.max(0.25, (Number(report.effectiveOdds) || 2) - 1)) *
                100
            )
          )
        );

  return {
    hedge,
    weakestLink,
    fiveLossStreakProb,
    recommendedBankrollPct,
    activeSwapTip,
  };
}

function consolidateCloseMultiples(
  mults,
  cappedUnits,
  isCapClipped,
  passLengths,
  totalCost
) {
  const k = mults.length;
  if (k < 2) return mults;
  const out = [...mults];
  const byPass = new Map();
  for (let i = 0; i < k; i++) {
    if (isCapClipped[i]) continue;
    const plen = passLengths[i] || 1;
    const arr = byPass.get(plen) ?? [];
    arr.push(i);
    byPass.set(plen, arr);
  }

  for (const idxs of byPass.values()) {
    if (idxs.length < 2) continue;
    idxs.sort((a, b) => out[b] - out[a] || cappedUnits[a] - cappedUnits[b]);
    let cursor = 0;
    while (cursor < idxs.length) {
      let bestEnd = cursor;
      for (let end = idxs.length - 1; end > cursor; end--) {
        const sub = idxs.slice(cursor, end + 1);
        const mHi = out[sub[0]];
        const mLo = out[sub[sub.length - 1]];
        if (mHi > Math.ceil(mLo * 1.35) + 1) continue;
        const noteSum = sub.reduce((a, ii) => a + out[ii], 0);
        const L = sub.length;
        const oldMinPay = Math.min(
          ...sub.map((ii) => out[ii] * cappedUnits[ii])
        );
        const wasZeroUw = oldMinPay >= totalCost - 1e-9;

        // Try uniform multiple first when divisible, else at most 2 adjacent multiples
        const candMults = new Array(L);
        const baseAvg = Math.floor(noteSum / L);
        const rem = noteSum - baseAvg * L;
        const rankedByUnitAsc = sub
          .map((ii, pos) => ({ ii, pos, u: cappedUnits[ii] }))
          .sort((a, b) => a.u - b.u);
        for (let r = 0; r < L; r++) {
          const item = rankedByUnitAsc[r];
          candMults[item.pos] = Math.min(999, baseAvg + (r < rem ? 1 : 0));
        }
        if (candMults.reduce((a, b) => a + b, 0) !== noteSum) continue;
        const newMinPay = Math.min(
          ...sub.map((ii, pos) => candMults[pos] * cappedUnits[ii])
        );
        if (wasZeroUw && newMinPay < totalCost - 1e-9) continue;
        if (newMinPay < oldMinPay * 0.94 - 1e-9) continue;

        const oldDistinct = new Set(sub.map((ii) => out[ii])).size;
        const newDistinct = new Set(candMults).size;
        if (newDistinct < oldDistinct) {
          for (let pos = 0; pos < L; pos++) {
            out[sub[pos]] = candMults[pos];
          }
          bestEnd = end;
          break;
        }
      }
      cursor = bestEnd + 1;
    }
  }
  return out;
}

/** 4. 三模智能奖金优化深模块（严格预算主权守恒 + 999倍逻辑分倍 + M串N联合状态保底 + 显式保本门槛升级 + 合票压缩） */
export function optimizeBonusPlan(
  manualReport,
  matches,
  optMode,
  options = {}
) {
  const baseRows =
    Array.isArray(manualReport?.tickets) && manualReport.tickets.length > 0
      ? manualReport.tickets
      : (manualReport?.combos ?? []);
  if (!manualReport || baseRows.length === 0 || baseRows.length > 512)
    return null;

  const upgradeToBreakeven = Boolean(options?.upgradeToBreakeven);
  const consolidateTickets = Boolean(options?.consolidateTickets);

  const sorted = [...baseRows].sort((a, b) => b.prob - a.prob);
  const k = sorted.length;
  const strictBaseCost = Math.max(
    k * 2,
    Math.round((Number(manualReport.totalCost) || k * 2) / 2) * 2
  );
  const targetBudgetCost =
    upgradeToBreakeven &&
    typeof manualReport.breakevenUpgradeCost === "number" &&
    manualReport.breakevenUpgradeCost > strictBaseCost
      ? Math.min(20_000, manualReport.breakevenUpgradeCost)
      : strictBaseCost;
  const totalTickets = Math.max(k, Math.floor(targetBudgetCost / 2));
  const targetStake = totalTickets * 2;

  const matchMap = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m?.id) matchMap.set(m.id, m);
    }
  }
  const rawUnits = sorted.map((c) => {
    if (
      typeof c.unitPayout === "number" &&
      c.unitPayout > 0 &&
      typeof c.cappedClipped === "number" &&
      c.cappedClipped === 0
    ) {
      return c.unitPayout;
    }
    return bankerRoundParlayUnitPayout(
      (c.legs ?? []).map((p) => Number(p.odds))
    );
  });
  const cappedUnits = sorted.map((c, idx) => {
    const legOdds = (c.legs ?? []).map((p) => Number(p.odds));
    const cap = statutorySingleBetCap(
      legOdds.length > 0
        ? effectiveNonVoidLegCount(legOdds)
        : manualReport.matchCount
    );
    const raw = rawUnits[idx] > 0 ? rawUnits[idx] : c.unitPayout;
    return Math.min(cap, raw);
  });
  const isCapClipped = sorted.map((c, idx) => {
    const legOdds = (c.legs ?? []).map((p) => Number(p.odds));
    const effLegs =
      legOdds.length > 0
        ? effectiveNonVoidLegCount(legOdds)
        : manualReport.matchCount;
    return rawUnits[idx] > statutorySingleBetCap(effLegs);
  });
  const hasUnclippedLine = isCapClipped.some((clipped) => !clipped);

  const reusableHitMatrix = manualReport?._reusableHitMatrix?.isBaselineAtomic
    ? manualReport._reusableHitMatrix
    : (manualReport?._reusableHitMatrix ?? null);
  const isMultiPassOverlap =
    Boolean(reusableHitMatrix) &&
    reusableHitMatrix.K === k &&
    (Boolean(manualReport.activeComboCode) ||
      (Array.isArray(manualReport.activePassSizes) &&
        manualReport.activePassSizes.length > 1));

  let mults = new Array(k).fill(1);

  if (isMultiPassOverlap && k >= 2) {
    // Non-disjoint M串N / multi-pass joint hit-bucket optimizer (strictly <= totalTickets)
    const origToSorted = new Int16Array(k).fill(-1);
    let mappingValid = true;
    for (let idx = 0; idx < k; idx++) {
      const sig = canonicalTicketLegSig(sorted[idx].legs);
      const origK = reusableHitMatrix.sigToOrigIdx.get(sig);
      if (origK === undefined || origToSorted[origK] !== -1) {
        mappingValid = false;
        break;
      }
      origToSorted[origK] = idx;
    }

    if (mappingValid && reusableHitMatrix.bucketHits.length > 0) {
      const B = reusableHitMatrix.bucketHits.length;
      const bucketSortedHits = new Array(B);
      const lineDeg = new Int32Array(k);
      const bucketPay = new Float64Array(B);
      let totalEdges = 0;
      for (let b = 0; b < B; b++) {
        const rawHits = reusableHitMatrix.bucketHits[b];
        const mapped = new Int16Array(rawHits.length);
        let sumU = 0;
        for (let j = 0; j < rawHits.length; j++) {
          const sIdx = origToSorted[rawHits[j]];
          mapped[j] = sIdx;
          lineDeg[sIdx] += 1;
          sumU += cappedUnits[sIdx];
        }
        totalEdges += rawHits.length;
        bucketSortedHits[b] = mapped;
        bucketPay[b] = sumU;
      }
      const lineStart = new Int32Array(k + 1);
      for (let i = 0; i < k; i++) lineStart[i + 1] = lineStart[i] + lineDeg[i];
      const lineCur = Int32Array.from(lineStart);
      const lineBucketsFlat = new Int16Array(Math.max(1, totalEdges));
      for (let b = 0; b < B; b++) {
        const mapped = bucketSortedHits[b];
        for (let j = 0; j < mapped.length; j++) {
          const sIdx = mapped[j];
          lineBucketsFlat[lineCur[sIdx]++] = b;
        }
      }

      let rem = totalTickets - k;
      while (rem > 0) {
        let bMin = 0;
        for (let b = 1; b < B; b++) {
          if (bucketPay[b] < bucketPay[bMin]) bMin = b;
        }
        const allCleared = bucketPay[bMin] >= targetStake - 1e-9;
        if (allCleared && optMode !== "equal") {
          const prefIdx =
            optMode === "hot-first"
              ? isCapClipped.findIndex((cl) => !cl)
              : (() => {
                  for (let r = k - 1; r >= 0; r--) {
                    if (!isCapClipped[r]) return r;
                  }
                  return 0;
                })();
          const tgt = prefIdx >= 0 && mults[prefIdx] < 999 ? prefIdx : -1;
          if (tgt >= 0) {
            const add = Math.min(rem, 999 - mults[tgt]);
            mults[tgt] += add;
            const deltaPay = add * cappedUnits[tgt];
            const st = lineStart[tgt];
            const en = lineStart[tgt + 1];
            for (let q = st; q < en; q++) {
              bucketPay[lineBucketsFlat[q]] += deltaPay;
            }
            rem -= add;
            continue;
          }
        }

        const candLines = bucketSortedHits[bMin];
        let bestIdx = -1;
        let bestU = -Infinity;
        let bestEv = -Infinity;
        for (let j = 0; j < candLines.length; j++) {
          const sIdx = candLines[j];
          if (mults[sIdx] >= 999) continue;
          if (isCapClipped[sIdx] && hasUnclippedLine) continue;
          const u = cappedUnits[sIdx];
          const ev = (sorted[sIdx].prob || 0) * u;
          if (
            u > bestU + 1e-9 ||
            (Math.abs(u - bestU) <= 1e-9 && ev > bestEv)
          ) {
            bestU = u;
            bestEv = ev;
            bestIdx = sIdx;
          }
        }
        if (bestIdx === -1) {
          bestIdx = mults.findIndex(
            (m, i) => m < 999 && (!isCapClipped[i] || !hasUnclippedLine)
          );
          if (bestIdx === -1) break;
        }
        const step = Math.min(
          rem,
          999 - mults[bestIdx],
          rem > 24 ? Math.max(2, Math.floor(rem / 16)) : 1
        );
        mults[bestIdx] += step;
        const deltaPay = step * cappedUnits[bestIdx];
        const st = lineStart[bestIdx];
        const en = lineStart[bestIdx + 1];
        for (let q = st; q < en; q++) {
          bucketPay[lineBucketsFlat[q]] += deltaPay;
        }
        rem -= step;
      }
    }
  } else if (k === 1) {
    mults = [
      isCapClipped[0] && hasUnclippedLine
        ? 1
        : Math.max(1, Math.min(999, totalTickets)),
    ];
  } else {
    const reqMult = cappedUnits.map((u, idx) =>
      isCapClipped[idx] && hasUnclippedLine
        ? 1
        : Math.min(
            999,
            Math.max(1, Math.ceil((targetStake - 1e-9) / Math.max(0.5, u)))
          )
    );
    const sumReq = reqMult.reduce((a, b) => a + b, 0);
    const waterFillNotes = (arr, remNotes) => {
      let rem = remNotes;
      if (rem > 64) {
        let invUnclipped = 0;
        for (let i = 0; i < k; i++) {
          if (!(isCapClipped[i] && hasUnclippedLine) && arr[i] < 999) {
            invUnclipped += 1 / Math.max(0.5, cappedUnits[i]);
          }
        }
        if (invUnclipped > 0) {
          const targetTotal = arr.reduce((a, b) => a + b, 0) + rem;
          for (let i = 0; i < k && rem > 16; i++) {
            if (isCapClipped[i] && hasUnclippedLine) continue;
            const ideal = Math.floor(
              (targetTotal * (1 / Math.max(0.5, cappedUnits[i]))) / invUnclipped
            );
            const jump = Math.min(
              rem - 8,
              999 - arr[i],
              Math.max(0, ideal - arr[i])
            );
            if (jump > 0) {
              arr[i] += jump;
              rem -= jump;
            }
          }
        }
      }
      while (rem > 0) {
        let bestI = -1;
        let lowestPay = Infinity;
        let bestEv = -Infinity;
        for (let i = 0; i < k; i++) {
          if (arr[i] >= 999) continue;
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const curPay = arr[i] * cappedUnits[i];
          const ev = (sorted[i].prob || 0) * cappedUnits[i];
          if (
            curPay < lowestPay - 1e-9 ||
            (Math.abs(curPay - lowestPay) <= 1e-9 && ev > bestEv)
          ) {
            lowestPay = curPay;
            bestEv = ev;
            bestI = i;
          }
        }
        if (bestI === -1) break;
        arr[bestI] += 1;
        rem -= 1;
      }
    };

    if (sumReq <= totalTickets) {
      mults = [...reqMult];
      let rem = totalTickets - sumReq;
      if (optMode === "equal") {
        waterFillNotes(mults, rem);
      } else if (optMode === "hot-first") {
        for (let i = 0; i < k && rem > 0; i++) {
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const add = Math.min(rem, 999 - mults[i]);
          mults[i] += add;
          rem -= add;
        }
      } else {
        for (let i = k - 1; i >= 0 && rem > 0; i--) {
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const add = Math.min(rem, 999 - mults[i]);
          mults[i] += add;
          rem -= add;
        }
      }
    } else {
      // Strict Budget Sovereignty: totalTickets < sumReq -> never inflate user stake!
      mults = new Array(k).fill(1);
      let rem = Math.max(0, totalTickets - k);
      if (optMode === "equal") {
        waterFillNotes(mults, rem);
      } else if (optMode === "hot-first") {
        for (let i = 0; i < k && rem > 0; i++) {
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const need = Math.max(0, reqMult[i] - 1);
          if (need > 0 && need <= rem) {
            mults[i] += need;
            rem -= need;
          }
        }
        for (let i = 0; i < k && rem > 0; i++) {
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const add = Math.min(rem, 999 - mults[i]);
          mults[i] += add;
          rem -= add;
        }
      } else {
        const coldIdx = (() => {
          for (let r = k - 1; r >= 0; r--) {
            if (!(isCapClipped[r] && hasUnclippedLine)) return r;
          }
          return k - 1;
        })();
        const reserveCold = rem >= 2 ? 1 : 0;
        let shieldBudget = Math.max(0, rem - reserveCold);
        for (let i = 0; i < k && shieldBudget > 0; i++) {
          if (i === coldIdx) continue;
          if (isCapClipped[i] && hasUnclippedLine) continue;
          const need = Math.max(0, reqMult[i] - 1);
          if (need > 0 && need <= shieldBudget) {
            mults[i] += need;
            shieldBudget -= need;
            rem -= need;
          }
        }
        if (rem > 0 && mults[coldIdx] < 999) {
          const add = Math.min(rem, 999 - mults[coldIdx]);
          mults[coldIdx] += add;
          rem -= add;
        }
        if (rem > 0) waterFillNotes(mults, rem);
      }
    }
  }

  if (hasUnclippedLine) {
    mults = mults.map((m, idx) => (isCapClipped[idx] ? 1 : m));
  }

  if (consolidateTickets && k >= 2) {
    const preCost = mults.reduce((a, m) => a + m * 2, 0);
    mults = consolidateCloseMultiples(
      mults,
      cappedUnits,
      isCapClipped,
      sorted.map((c) => (c.legs ?? []).length || 1),
      preCost
    );
  }

  const lines = sorted.map((c, idx) => {
    const mult = mults[idx];
    const unit = cappedUnits[idx];
    const role =
      optMode === "equal"
        ? `均衡分倍#${idx + 1}`
        : optMode === "hot-first"
          ? idx === 0
            ? "🔥主攻重锤"
            : `🛡️次选回本盾#${idx}`
          : idx === k - 1
            ? "⚡博冷高弹箭"
            : `🛡️正路免单盾#${idx + 1}`;

    const fullLegs = (c.legs ?? []).map((p) => {
      const fm = matchMap.get(p.matchId);
      return {
        matchId: p.matchId,
        matchNumStr: p.matchNumStr,
        home: p.home,
        away: p.away,
        kickoff: fm?.kickoff ?? "21:00",
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
        ? "单关"
        : fullLegs.length > 1
          ? `${fullLegs.length}串1`
          : manualReport.modeLabel;

    const rawBeforeCap = rawUnits[idx] > 0 ? rawUnits[idx] : unit;
    const cappedClipped = Math.max(
      0,
      Number(((rawBeforeCap - unit) * mult).toFixed(2))
    );

    return {
      id: `opt-${optMode}-${idx}`,
      roleLabel: role,
      legs: fullLegs,
      modeLabel: perLineMode,
      multiple: mult,
      cost: mult * 2,
      unitPayout: unit,
      cappedClipped,
      returnPayout: Number((unit * mult).toFixed(2)),
      netProfit: 0,
      prob: c.prob,
    };
  });

  const actualTotal = lines.reduce((a, l) => a + l.cost, 0);
  lines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - actualTotal).toFixed(2));
  });

  const ticketRowsForEval = lines.map((l) => ({
    id: l.id,
    desc: `${l.roleLabel}(${l.multiple}倍) · ${l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join("×")}`,
    legs: l.legs,
    multiple: l.multiple,
    cost: l.cost,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: l.cappedClipped ?? 0,
  }));
  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRowsForEval,
    actualTotal,
    matches,
    null,
    {
      metricsOnly: true,
      reusableHitMatrix: manualReport?._reusableHitMatrix?.isBaselineAtomic
        ? manualReport._reusableHitMatrix
        : null,
    }
  );
  const { vigPct } = computeCapitalWeightedVig(lines, matches);

  const uwCount = jointEval.underwaterCount;
  const totalScenarios = Math.max(1, jointEval.tiers?.length ?? k);
  const rawUpgradeCost =
    typeof manualReport.breakevenUpgradeCost === "number" &&
    manualReport.breakevenUpgradeCost > actualTotal
      ? manualReport.breakevenUpgradeCost
      : null;

  const metaMap = {
    equal: {
      shortTab: "平均优化",
      badge:
        uwCount > 0 ? "⚖️ 平均优化（预算内减损）" : "⚖️ 平均优化（均衡派奖）",
      title:
        uwCount > 0
          ? "严守当前预算 · 最优均衡减损配比"
          : "反比例均注 · 全选项均衡稳赚",
      reason:
        uwCount > 0
          ? `严守当前本金上限 ¥${actualTotal}（绝不暗自加注），受离散凑整限制仍有 ${uwCount}/${totalScenarios} 种命中场景属局部回血`
          : "按每注返奖额反比例精密分配整数倍，彻底消灭假中奖倒贴",
    },
    "hot-first": {
      shortTab: "博热保本",
      badge: uwCount > 0 ? "🔥 博热减损（主攻倾斜）" : "🔥 博热保本优化",
      title:
        uwCount > 0
          ? "严守当前预算 · 主攻优先减损配比"
          : "次选回本护盾 + 第一主攻利润最大化",
      reason:
        uwCount > 0
          ? `严守当前本金上限 ¥${actualTotal} 优先抬高高概率正路回血，仍有 ${uwCount}/${totalScenarios} 种场景属局部回血`
          : "防冷次选仅配保本倍数，省下筹码集中放大最高概率主方向收益",
    },
    "cold-first": {
      shortTab: "博冷高弹",
      badge: uwCount > 0 ? "⚡ 博冷减损（冷门倾斜）" : "⚡ 博冷高弹优化",
      title:
        uwCount > 0
          ? "严守当前预算 · 博冷倾斜减损配比"
          : "正路免单兜底 + 高赔冷门暴击放大",
      reason:
        uwCount > 0
          ? `严守当前本金上限 ¥${actualTotal} 兼顾正路缓冲与高赔冷门弹性，仍有 ${uwCount}/${totalScenarios} 种场景属局部回血`
          : "大热方向锁住保本回血线，溢价倍数倾斜博取高赔冷门超额回报",
    },
  }[optMode];

  const bonusReasons = [metaMap.reason];
  if (uwCount > 0 && rawUpgradeCost) {
    bonusReasons.push(
      `若需 100% 清零假中奖倒贴，可点击「一键加至最低保本门槛 ¥${rawUpgradeCost}」显式授权扩充本金`
    );
  }

  const outBonusPlan = {
    key: "max-profit-prob",
    available: true,
    shortTab: metaMap.shortTab,
    badge: metaMap.badge,
    title: metaMap.title,
    tagline: `总投入 ¥${actualTotal} · 保底返 ¥${jointEval.minPayout.toFixed(1)} ~ 最高 ¥${jointEval.maxPayout.toFixed(1)}`,
    totalCost: actualTotal,
    savedCash: 0,
    minReturn: jointEval.minPayout,
    maxReturn: jointEval.maxPayout,
    winProb: jointEval.anyWinProb,
    profitProb: jointEval.realProfitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
    expectedValueRate: jointEval.expectedValueRate,
    objectiveEVRate: jointEval.expectedValueRate,
    objectiveProfitProb: jointEval.realProfitProb,
    objectiveStrictNetGainProb: jointEval.strictNetGainProb,
    subjectiveProjectedEVRate: null,
    subjectiveProjectedProfitProb: null,
    underwaterCount: uwCount,
    breakevenUpgradeCost: uwCount > 0 ? rawUpgradeCost : null,
    consolidateTickets,
    missOneReturn: null,
    vigPct,
    reasons: bonusReasons,
    lines,
  };
  TRUSTED_SERVER_BONUS_PLANS.add(outBonusPlan);
  return outBonusPlan;
}

function isValidPlanObject(plan) {
  const maxLines = plan && TRUSTED_SERVER_BONUS_PLANS.has(plan) ? 512 : 64;
  if (
    !plan ||
    typeof plan !== "object" ||
    !Array.isArray(plan.lines) ||
    plan.lines.length < 1 ||
    plan.lines.length > maxLines
  ) {
    return false;
  }

  const allDistinctMatches = new Set();
  let hasParlayLine = false;

  for (const l of plan.lines) {
    if (
      !l ||
      typeof l !== "object" ||
      !Array.isArray(l.legs) ||
      l.legs.length < 1 ||
      !Number.isFinite(Number(l.multiple)) ||
      !Number.isFinite(Number(l.unitPayout))
    ) {
      return false;
    }
    const maxPass = Math.min(
      ...l.legs.map((g) => POOL_MAX_PASS[g?.poolCode] ?? 8)
    );
    if (l.legs.length > maxPass) return false;
    if (l.legs.length >= 2) hasParlayLine = true;

    const lineMatches = new Set();
    for (const g of l.legs) {
      if (typeof g?.matchId !== "string" || g.matchId.trim().length === 0) {
        return false;
      }
      if (lineMatches.has(g.matchId)) return false;
      lineMatches.add(g.matchId);
      allDistinctMatches.add(g.matchId);
    }
  }

  const maxDistinctMatches = hasParlayLine ? 8 : 15;
  return (
    allDistinctMatches.size >= 1 &&
    allDistinctMatches.size <= maxDistinctMatches
  );
}

function scaleArchetypePlan(plan, rawScale) {
  if (!isValidPlanObject(plan)) return null;
  const requestedScale = Math.max(
    1,
    Math.min(50, Math.round(Number(rawScale) || 1))
  );
  if (requestedScale <= 1) return plan;
  const maxBaseMult = Math.max(
    1,
    ...plan.lines.map((l) => Number(l.multiple) || 1)
  );
  const scale = Math.max(
    1,
    Math.min(requestedScale, Math.floor(999 / maxBaseMult))
  );
  if (scale <= 1) return plan;
  const scaledLines = plan.lines.map((l) => {
    const mult = Math.max(
      1,
      Math.min(999, Math.round((Number(l.multiple) || 1) * scale))
    );
    const cost = mult * 2;
    const legOdds = l.legs.map((g) => Number(g.odds));
    const cap = statutorySingleBetCap(effectiveNonVoidLegCount(legOdds));
    const unitBeforeCap = bankerRoundParlayUnitPayout(legOdds);
    const effectiveUnit = Math.min(cap, Number(l.unitPayout));
    const cappedClipped =
      unitBeforeCap > cap
        ? Math.max(
            0,
            Number(((unitBeforeCap - effectiveUnit) * mult).toFixed(2))
          )
        : 0;
    const returnPayout = Number((effectiveUnit * mult).toFixed(2));
    return {
      ...l,
      multiple: mult,
      cost,
      unitPayout: effectiveUnit,
      cappedClipped,
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
  const hasMissOne =
    typeof plan.missOneReturn === "number" &&
    Number.isFinite(plan.missOneReturn);
  const scaledMax = hasMissOne
    ? Number((Number(plan.maxReturn || 0) * scale).toFixed(2))
    : returns.length
      ? Math.max(...returns)
      : 0;
  const scaledOut = {
    ...plan,
    totalCost,
    minReturn,
    maxReturn: Math.max(minReturn, scaledMax),
    missOneReturn: hasMissOne
      ? Number((plan.missOneReturn * scale).toFixed(2))
      : null,
    lines: scaledLines,
  };
  if (TRUSTED_SERVER_BONUS_PLANS.has(plan)) {
    TRUSTED_SERVER_BONUS_PLANS.add(scaledOut);
  }
  return scaledOut;
}

function buildSandboxAdjustedBundle(
  picks,
  matches,
  simVoidFirstMatch,
  subjectiveDeltaPct
) {
  const firstMid = picks[0]?.matchId;
  const byMatch = new Map();
  for (const pk of picks) {
    const arr = byMatch.get(pk.matchId) ?? [];
    arr.push(pk);
    byMatch.set(pk.matchId, arr);
  }

  const shiftedAtomicByMatch = new Map();
  const atomicMap = new Map();
  for (const [mid, mPicks] of byMatch.entries()) {
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === mid)
      : null;
    const gl = resolveGoalLineNum(fm, mPicks[0]?.poolName);
    const poolCodes = Array.from(new Set(mPicks.map((p) => p.poolCode)));
    let baseAtomic = fm
      ? getMatchBaseAtomicProbs(fm, poolCodes)
      : new Float64Array(NEUTRAL_ATOMIC_PROBS);
    if (!fm) {
      for (const pCode of poolCodes) {
        const pseudoOpts = mPicks
          .filter((p) => p.poolCode === pCode)
          .map((p) => ({
            key: p.optionKey,
            label: p.optionLabel,
            fairProb: p.fairProb,
          }));
        baseAtomic = alignAtomicProbsToPoolOptions(
          baseAtomic,
          pCode,
          pseudoOpts,
          gl
        );
      }
    }
    const shifted = tiltAtomicProbsBySubjectiveDelta(
      baseAtomic,
      mPicks,
      gl,
      subjectiveDeltaPct
    );
    shiftedAtomicByMatch.set(mid, { shifted, gl, fm });
    atomicMap.set(mid, shifted);
  }

  const adjustedPicks = picks.map((pk) => {
    const ctx = shiftedAtomicByMatch.get(pk.matchId);
    const fm = ctx?.fm ?? null;
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
    const odds =
      simVoidFirstMatch && pk.matchId === firstMid && baseOdds > 0
        ? 1.0
        : baseOdds;
    const prob = ctx
      ? sumOptionProbOnAtomic(
          ctx.shifted,
          pk.poolCode,
          pk.optionKey,
          pk.optionLabel,
          ctx.gl
        )
      : Number(pk.fairProb) || 0.25;
    return {
      ...pk,
      singleAllowed: pool ? Boolean(pool.single) : Boolean(pk.singleAllowed),
      odds,
      fairProb: prob > 0 ? prob : Number(pk.fairProb) || 0.02,
    };
  });

  return { picks: adjustedPicks, atomicMap };
}

function buildSandboxAdjustedPicks(
  picks,
  matches,
  simVoidFirstMatch,
  subjectiveDeltaPct
) {
  return buildSandboxAdjustedBundle(
    picks,
    matches,
    simVoidFirstMatch,
    subjectiveDeltaPct
  ).picks;
}

function computeLineStatutoryPayout(legOdds, multiple) {
  const mult = Math.max(1, Math.min(999, Math.round(Number(multiple) || 1)));
  const unitBeforeCap = bankerRoundParlayUnitPayout(legOdds);
  const cap = statutorySingleBetCap(effectiveNonVoidLegCount(legOdds));
  const unitPayout = Math.min(cap, unitBeforeCap);
  const cappedClipped = Math.max(
    0,
    Number(((unitBeforeCap - unitPayout) * mult).toFixed(2))
  );
  const returnPayout = Number((unitPayout * mult).toFixed(2));
  return {
    mult,
    cost: mult * 2,
    unitBeforeCap,
    cap,
    unitPayout,
    cappedClipped,
    returnPayout,
  };
}

function applySandboxToPlan(
  basePlan,
  matches,
  picks,
  simVoidFirstMatch,
  subjectiveDeltaPct,
  {
    isArchetype = false,
    hasFrozenSnapshot = false,
    stance = "objective",
    manualReport = null,
    objectiveHitMatrix = null,
    targetFirstMid = null,
  } = {}
) {
  if (!isValidPlanObject(basePlan)) return null;
  const planMatchIds = new Set();
  for (const l of basePlan.lines) {
    for (const lg of l.legs) {
      if (lg?.matchId) planMatchIds.add(lg.matchId);
    }
  }
  const boardFirstMid = Array.isArray(matches)
    ? matches.find((m) => planMatchIds.has(m.id))?.id
    : undefined;
  const firstMid =
    targetFirstMid ??
    boardFirstMid ??
    (picks[0]?.matchId && planMatchIds.has(picks[0].matchId)
      ? picks[0].matchId
      : basePlan.lines[0]?.legs[0]?.matchId);

  const legsByMatch = new Map();
  for (const l of basePlan.lines) {
    for (const lg of l.legs) {
      if (!lg?.matchId) continue;
      const arr = legsByMatch.get(lg.matchId) ?? [];
      if (
        !arr.some(
          (x) => x.poolCode === lg.poolCode && x.optionKey === lg.optionKey
        )
      ) {
        arr.push(lg);
      }
      legsByMatch.set(lg.matchId, arr);
    }
  }

  const planAtomicByMatch = new Map();
  const objAtomicByMatch = new Map();
  for (const [mid, mLegs] of legsByMatch.entries()) {
    const fm = Array.isArray(matches)
      ? matches.find((x) => x.id === mid)
      : null;
    const gl = resolveGoalLineNum(
      fm,
      mLegs.find((x) => x.poolCode === "HHAD")?.poolName
    );
    const poolCodes = Array.from(new Set(mLegs.map((g) => g.poolCode)));
    const pureObjAtomic = fm
      ? getMatchBaseAtomicProbs(fm, poolCodes)
      : alignMatchlessAtomicToLegs(mLegs, gl);
    objAtomicByMatch.set(mid, pureObjAtomic);
    const oddsUnchanged =
      Boolean(fm) &&
      mLegs.every((g) => {
        const opt = fm.pools?.[g.poolCode]?.options?.find(
          (o) => o.key === g.optionKey || o.label === g.optionLabel
        );
        return Boolean(opt) && Math.abs(opt.odds - Number(g.odds)) < 1e-6;
      });

    let baseAtomic;
    if (!fm || (hasFrozenSnapshot && oddsUnchanged)) {
      baseAtomic = fm
        ? new Float64Array(pureObjAtomic)
        : new Float64Array(NEUTRAL_ATOMIC_PROBS);
      for (const pCode of poolCodes) {
        const pseudoOpts = mLegs
          .filter((g) => g.poolCode === pCode)
          .map((g) => ({
            key: g.optionKey,
            label: g.optionLabel,
            fairProb: g.fairProb,
          }));
        baseAtomic = alignAtomicProbsToPoolOptions(
          baseAtomic,
          pCode,
          pseudoOpts,
          gl
        );
      }
    } else {
      baseAtomic = pureObjAtomic;
      if (isArchetype && !hasFrozenSnapshot) {
        baseAtomic = tiltAtomicProbsByStance(baseAtomic, fm, stance);
      }
    }

    const shifted = tiltAtomicProbsBySubjectiveDelta(
      baseAtomic,
      mLegs,
      gl,
      subjectiveDeltaPct
    );
    planAtomicByMatch.set(mid, { shifted, gl, fm });
  }

  const lines = basePlan.lines.map((l) => {
    const legs = l.legs.map((lg) => {
      const ctx = planAtomicByMatch.get(lg.matchId);
      const fm = ctx?.fm ?? null;
      const pool = fm?.pools?.[lg.poolCode];
      const authOpt = pool?.options?.find(
        (o) => o.key === lg.optionKey || o.label === lg.optionLabel
      );
      const baseOdds =
        pool?.selling === false
          ? 0
          : authOpt
            ? authOpt.odds
            : fm
              ? 0
              : Number(lg.odds) || 1.0;
      const odds =
        simVoidFirstMatch && lg.matchId === firstMid && baseOdds > 0
          ? 1.0
          : baseOdds;
      const fairProb = ctx
        ? sumOptionProbOnAtomic(
            ctx.shifted,
            lg.poolCode,
            lg.optionKey,
            lg.optionLabel,
            ctx.gl
          )
        : Number(lg.fairProb) || 0.25;
      return {
        ...lg,
        odds,
        fairProb: fairProb > 0 ? fairProb : Number(lg.fairProb) || 0.02,
      };
    });
    const prob = legs.reduce((acc, it) => acc * it.fairProb, 1);
    const { mult, cost, unitPayout, cappedClipped, returnPayout } =
      computeLineStatutoryPayout(
        legs.map((it) => it.odds),
        l.multiple
      );
    return {
      ...l,
      legs,
      multiple: mult,
      cost,
      unitPayout,
      cappedClipped,
      returnPayout,
      netProfit: 0,
      prob,
    };
  });

  const totalCost = lines.reduce((a, l) => a + l.cost, 0);
  lines.forEach((l) => {
    l.netProfit = Number((l.returnPayout - totalCost).toFixed(2));
  });

  const atomicMapForEval = new Map();
  for (const [mid, ctx] of planAtomicByMatch.entries()) {
    atomicMapForEval.set(mid, ctx.shifted);
  }
  const ticketRowsForEval = lines.map((l) => ({
    id: l.id,
    desc: `${l.roleLabel}(${l.multiple}倍) · ${l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join("×")}`,
    legs: l.legs,
    multiple: l.multiple,
    cost: l.cost,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: l.cappedClipped ?? 0,
  }));
  const jointEval = evaluateTicketsOnQuotientSpace(
    ticketRowsForEval,
    totalCost,
    matches,
    atomicMapForEval
  );
  const hasSubjectiveFilter =
    (Number(subjectiveDeltaPct) || 0) !== 0 ||
    (isArchetype && stance !== "objective");
  const objEval =
    hasSubjectiveFilter || hasFrozenSnapshot
      ? evaluateTicketsOnQuotientSpace(
          ticketRowsForEval,
          totalCost,
          matches,
          objAtomicByMatch,
          {
            metricsOnly: true,
            reusableHitMatrix:
              !simVoidFirstMatch && objectiveHitMatrix
                ? objectiveHitMatrix
                : null,
          }
        )
      : jointEval;
  const { vigPct } = computeCapitalWeightedVig(lines, matches);

  const hasMissOne =
    typeof basePlan.missOneReturn === "number" &&
    Number.isFinite(basePlan.missOneReturn);

  let missOneReturn = null;
  if (hasMissOne) {
    const distinctMids = Array.from(planMatchIds);
    if (distinctMids.length >= 2) {
      const hasSubMatchTicket = lines.some((l) =>
        distinctMids.some((mid) => !l.legs.some((g) => g.matchId === mid))
      );
      missOneReturn = hasSubMatchTicket
        ? computeSurvivingMissOneFloor(lines, distinctMids)
        : jointEval.minPayout;
    } else {
      missOneReturn = jointEval.minPayout;
    }
  }

  const minReturn = jointEval.minPayout;
  const maxReturn = jointEval.maxPayout;
  const winProb = jointEval.anyWinProb;
  const profitProb = jointEval.realProfitProb;

  const nextTagline = !isArchetype
    ? `总投入 ¥${totalCost} · 保底返 ¥${minReturn.toFixed(1)} ~ 最高 ¥${maxReturn.toFixed(1)}`
    : basePlan.tagline;

  const outPlan = {
    ...basePlan,
    tagline: nextTagline,
    totalCost,
    minReturn,
    maxReturn,
    winProb,
    profitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
    expectedValueRate: jointEval.expectedValueRate,
    objectiveEVRate: objEval.expectedValueRate,
    objectiveProfitProb: objEval.realProfitProb,
    objectiveStrictNetGainProb: objEval.strictNetGainProb,
    subjectiveProjectedEVRate: hasSubjectiveFilter
      ? jointEval.expectedValueRate
      : null,
    subjectiveProjectedProfitProb: hasSubjectiveFilter
      ? jointEval.realProfitProb
      : null,
    underwaterCount: jointEval.underwaterCount,
    zeroPayoutProb: Math.max(0, 1 - winProb),
    missOneReturn,
    vigPct,
    lines,
  };
  if (TRUSTED_SERVER_BONUS_PLANS.has(basePlan)) {
    TRUSTED_SERVER_BONUS_PLANS.add(outPlan);
  }
  Object.defineProperty(outPlan, "_cachedJointEval", {
    value: {
      matchesRef: matches,
      totalCost,
      linesSig: computePlanLinesEvalSig(lines),
      jointEval,
      objEval,
      hasSubjectiveFilter,
    },
    enumerable: false,
    configurable: true,
  });
  return outPlan;
}

function computePlanLinesEvalSig(lines) {
  if (!Array.isArray(lines)) return "";
  let sig = `${lines.length}`;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    sig += `|${l.multiple}:${l.unitPayout}:${l.returnPayout ?? ""}:`;
    const legs = l.legs || [];
    for (let j = 0; j < legs.length; j++) {
      const g = legs[j];
      sig += `${j > 0 ? "," : ""}${g.matchId}/${g.poolCode}/${g.optionKey}@${g.odds}~${Number(g.fairProb ?? 0).toFixed(8)}`;
    }
  }
  return sig;
}

export function archetypeToReport(plan, fallbackManual, matches = null) {
  if (!isValidPlanObject(plan)) return fallbackManual;
  const matchSet = new Set();
  const sizeSet = new Set();
  plan.lines.forEach((l) => {
    sizeSet.add(l.legs.length);
    l.legs.forEach((lg) => matchSet.add(lg.matchId));
  });
  const physicalTickets = plan.lines.map((l) => {
    const { mult, cap, unitBeforeCap } = computeLineStatutoryPayout(
      l.legs.map((g) => Number(g.odds)),
      l.multiple
    );
    const effectiveUnit = Math.min(cap, Number(l.unitPayout));
    const derivedClip =
      unitBeforeCap > cap
        ? Math.max(
            0,
            Number(((unitBeforeCap - effectiveUnit) * mult).toFixed(2))
          )
        : 0;
    const lineClipped =
      typeof l.cappedClipped === "number" &&
      Number.isFinite(l.cappedClipped) &&
      l.cappedClipped > 0
        ? Math.max(l.cappedClipped, derivedClip)
        : derivedClip;
    const returnPayout = Number(
      l.returnPayout ?? (effectiveUnit * mult).toFixed(2)
    );
    const netProfit = Number((returnPayout - plan.totalCost).toFixed(2));
    return {
      id: l.id,
      desc:
        `${l.roleLabel}(${l.multiple}倍) · ` +
        l.legs
          .map(
            (g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`
          )
          .join("×"),
      legs: l.legs,
      multiple: mult,
      cost: mult * 2,
      prob: l.prob,
      unitPayout: effectiveUnit,
      totalPayout: returnPayout,
      cappedClipped: lineClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  });

  let jointEval = null;
  let objEval = null;
  let hasSubjectiveFilter = Boolean(plan.subjectiveProjectedEVRate != null);
  if (
    plan._cachedJointEval &&
    plan._cachedJointEval.matchesRef === matches &&
    plan._cachedJointEval.totalCost === plan.totalCost &&
    plan._cachedJointEval.linesSig === computePlanLinesEvalSig(plan.lines)
  ) {
    jointEval = plan._cachedJointEval.jointEval;
    objEval = plan._cachedJointEval.objEval ?? jointEval;
    hasSubjectiveFilter = Boolean(plan._cachedJointEval.hasSubjectiveFilter);
  } else {
    // Build per-match atomic map respecting frozen/sandboxed leg probabilities when consistent
    const legsByMatch = new Map();
    for (const l of plan.lines) {
      for (const lg of l.legs) {
        const arr = legsByMatch.get(lg.matchId) ?? [];
        if (
          !arr.some(
            (x) => x.poolCode === lg.poolCode && x.optionKey === lg.optionKey
          )
        ) {
          arr.push(lg);
        }
        legsByMatch.set(lg.matchId, arr);
      }
    }
    const atomicMap = new Map();
    const objAtomicMap = new Map();
    for (const [mid, mLegs] of legsByMatch.entries()) {
      const fm = Array.isArray(matches)
        ? matches.find((x) => x.id === mid)
        : null;
      const gl = resolveGoalLineNum(
        fm,
        mLegs.find((x) => x.poolCode === "HHAD")?.poolName
      );
      const poolCodes = Array.from(new Set(mLegs.map((g) => g.poolCode)));
      if (!fm) {
        const matchlessA = alignMatchlessAtomicToLegs(mLegs, gl);
        atomicMap.set(mid, matchlessA);
        objAtomicMap.set(mid, matchlessA);
      } else {
        const pureBase = getMatchBaseAtomicProbs(fm, poolCodes);
        objAtomicMap.set(mid, pureBase);
        if (poolCodes.length === 1) {
          const pseudoOpts = mLegs.map((g) => ({
            key: g.optionKey,
            label: g.optionLabel,
            fairProb: g.fairProb,
          }));
          atomicMap.set(
            mid,
            alignAtomicProbsToPoolOptions(
              pureBase,
              poolCodes[0],
              pseudoOpts,
              gl
            )
          );
        } else {
          atomicMap.set(
            mid,
            alignMultiPoolAtomicToTiltedLegs(pureBase, mLegs, gl)
          );
        }
      }
    }

    jointEval = evaluateTicketsOnQuotientSpace(
      physicalTickets,
      plan.totalCost,
      matches,
      atomicMap
    );
    objEval =
      Array.isArray(matches) && matches.length > 0
        ? evaluateTicketsOnQuotientSpace(
            physicalTickets,
            plan.totalCost,
            matches,
            objAtomicMap,
            { metricsOnly: true }
          )
        : jointEval;
  }
  const { combos } = jointEval;

  const invUnitSum = physicalTickets.reduce(
    (a, c) => a + 2 / Math.max(0.5, c.unitPayout),
    0
  );
  const harmonicEffOdds = invUnitSum > 0 ? 1 / invUnitSum : 1.5;
  const activeSizes = Array.from(sizeSet)
    .filter((n) => n >= 1)
    .sort((a, b) => a - b);

  const planWarnings = [];
  const maxLineMult = Math.max(
    ...plan.lines.map((l) => Number(l.multiple) || 1)
  );
  const consolidatedTickets = plan.consolidateTickets
    ? (() => {
        const batchCounts = new Map();
        for (const l of plan.lines) {
          const m = Math.max(1, Number(l.multiple) || 1);
          const bk = `${(l.legs ?? []).length}:${m}`;
          batchCounts.set(bk, (batchCounts.get(bk) ?? 0) + 1);
        }
        let sumSheets = 0;
        for (const [bk, cnt] of batchCounts.entries()) {
          const m = Number(bk.split(":")[1]) || 1;
          sumSheets += Math.ceil(cnt / 4) * Math.max(1, Math.ceil(m / 99));
        }
        return Math.max(1, sumSheets);
      })()
    : plan.lines.reduce(
        (a, l) => a + Math.max(1, Math.ceil((Number(l.multiple) || 1) / 99)),
        0
      );
  const totalClipped = physicalTickets.reduce((a, c) => a + c.cappedClipped, 0);
  const maxClippedPassSize = physicalTickets
    .filter((c) => c.cappedClipped > 0)
    .reduce(
      (mx, c) =>
        Math.max(
          mx,
          effectiveNonVoidLegCount((c.legs ?? []).map((g) => g.odds))
        ),
      activeSizes[activeSizes.length - 1] ?? 1
    );
  const maxTierCap = statutorySingleBetCap(maxClippedPassSize);
  if (totalClipped > 0 || maxLineMult > 99) {
    planWarnings.push({
      id: "cap-clip",
      severity: totalClipped > 0 ? "danger" : "warn",
      title:
        totalClipped > 0
          ? `封顶截断警告：有 ${totalClipped.toFixed(0)} 元超额奖金将被体彩无偿没收！`
          : `分倍含超 99 倍单注（体彩店需拆成 ${consolidatedTickets} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${maxTierCap / 10000} 万元法定单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : "终端机单张实票最高 99 倍，已按 99 倍上限自动核算店面拆票张数。",
    });
  }
  const hasInvalidOdds = plan.lines.some((l) =>
    l.legs.some((g) => !(Number(g.odds) > 0))
  );
  const over20k = plan.totalCost > 20_000;
  if (hasInvalidOdds) {
    planWarnings.push({
      id: "invalid-odds",
      severity: "danger",
      title: "选单包含未开售或无效赔率选项，已拦截出票",
      detail:
        "部分实票选项在当前官方盘面未开售或不存在，请还原等倍后重新选号。",
    });
  }
  if (over20k) {
    planWarnings.push({
      id: "order-limit-20k",
      severity: "danger",
      title: `🚨 超出体彩单次订单 ¥20,000 硬上限拦截（当前 ¥${plan.totalCost}）`,
      detail:
        "中国体彩规定单次订单投注金额不得超过 20,000 元，请还原等倍或分批打票。",
    });
  } else if (plan.totalCost > 6_000) {
    planWarnings.push({
      id: "rational-6k",
      severity: "warn",
      title: `大额投注风控提醒（当前总投入 ¥${plan.totalCost} 已超 ¥6,000）`,
      detail: "触发体彩官方大额理性购彩阈值，请严格核对今日止损护栏额度。",
    });
  }
  if (jointEval.underwaterCount > 0) {
    planWarnings.push({
      id: "underwater",
      severity: "warn",
      title: `存在 ${jointEval.underwaterCount}/${combos.length} 种局部回血场景低于总本金`,
      detail: `最低回血 ¥${jointEval.minPayout.toFixed(2)}（本金 ¥${plan.totalCost}），属容错回血垫或腰斩折算场景。`,
    });
  }

  const hasExplicitMatches = Array.isArray(matches) && matches.length > 0;
  const computedVig = computeCapitalWeightedVig(plan.lines, matches);
  const effectiveVigPct =
    hasExplicitMatches || !(Number(plan.vigPct) > 0)
      ? computedVig.vigPct
      : Number(plan.vigPct);
  const avgPayoutRatio = Math.max(
    0,
    Math.min(1, (100 - effectiveVigPct) / 100)
  );

  return {
    matchCount: matchSet.size,
    betCount: plan.lines.length,
    comboCount: combos.length,
    multiple: 1,
    modeLabel: `${plan.shortTab}·分倍精算`,
    canSingle: matchSet.size === 1,
    canCheckout: plan.lines.length > 0 && !over20k && !hasInvalidOdds,
    ruleBlockReason: hasInvalidOdds
      ? "选单包含未开售或无效赔率选项"
      : over20k
        ? `单次订单金额 ¥${plan.totalCost} 超出体彩 ¥20,000 硬上限，请调低仓位或分单`
        : null,
    poolCap: fallbackManual?.poolCap ?? 8,
    activePassSizes: activeSizes,
    activeComboCode: null,
    availableFreePasses:
      fallbackManual?.availableFreePasses ??
      buildFreePassMetadata(
        matchSet.size,
        8,
        matchSet.size === 1,
        false,
        activeSizes
      ),
    availableComboPasses: fallbackManual?.availableComboPasses ?? [],
    hasSameMatchCrossPoolConflict: false,
    totalCost: plan.totalCost,
    minPayout: jointEval.minPayout,
    maxPayout: jointEval.maxPayout,
    likelyRange: jointEval.likelyRange,
    anyWinProb: jointEval.anyWinProb,
    realProfitProb: jointEval.realProfitProb,
    strictNetGainProb: jointEval.strictNetGainProb,
    breakEvenProb: jointEval.breakEvenProb,
    underwaterCount: jointEval.underwaterCount,
    underwaterShareOfWins: jointEval.underwaterShareOfWins,
    avgPayoutRatio,
    avgVigLossPer100: effectiveVigPct,
    expectedValueRate: jointEval.expectedValueRate,
    objectiveEVRate: objEval.expectedValueRate,
    objectiveProfitProb: objEval.realProfitProb,
    objectiveStrictNetGainProb: objEval.strictNetGainProb,
    subjectiveProjectedEVRate: hasSubjectiveFilter
      ? jointEval.expectedValueRate
      : null,
    subjectiveProjectedProfitProb: hasSubjectiveFilter
      ? jointEval.realProfitProb
      : null,
    dangerScore:
      plan.key === "alpha-radar" || plan.key === "value-assassin"
        ? 58
        : jointEval.underwaterCount > 0
          ? 44
          : 26,
    effectiveOdds: harmonicEffOdds,
    breakevenUpgradeCost:
      jointEval.underwaterCount > 0
        ? (plan.breakevenUpgradeCost ??
          (fallbackManual?.breakevenUpgradeCost &&
          fallbackManual.breakevenUpgradeCost > plan.totalCost
            ? fallbackManual.breakevenUpgradeCost
            : null))
        : null,
    consolidatedTickets,
    syntheticHint: `已启用【${plan.badge}】：${plan.tagline}`,
    syntheticRescuePicks: null,
    tickets: physicalTickets,
    combos,
    warnings: planWarnings,
  };
}

function normalizePortfolioKey(rawKey) {
  if (rawKey === "iron-shield") return "max-profit-prob";
  if (rawKey === "spear-shield") return "max-ev-utility";
  if (rawKey === "fault-tolerant") return "max-cvar-wheel";
  if (rawKey === "value-assassin") return "alpha-radar";
  if (rawKey === "goal-structure") return "max-ev-utility";
  if (
    rawKey === "max-profit-prob" ||
    rawKey === "max-ev-utility" ||
    rawKey === "max-cvar-wheel" ||
    rawKey === "alpha-radar"
  ) {
    return rawKey;
  }
  return "max-ev-utility";
}

export function buildXiaoGaoWarnings(picks, matches) {
  const matchIds = Array.from(new Set(picks.map((p) => p.matchId)));
  const out = [];
  for (const mid of matchIds) {
    const m = matches.find((x) => x.id === mid);
    if (!m?.aiAlert) continue;
    out.push({
      id: `xiaogao-${m.id}`,
      severity: m.aiAlert.level === "high" ? "danger" : "warn",
      title: `🧹 扫地僧小高靶向排雷 · ${m.matchNumStr} ${m.aiAlert.tag}`,
      detail: `${m.aiAlert.summary}（Price-In 消化度：${m.aiAlert.priceInStatus}${
        m.aiAlert.suggestedDelta ? ` · ${m.aiAlert.suggestedDelta}` : ""
      }）`,
    });
  }
  return out;
}

/**
 * 统一服务端黑盒精算调度器（单次密文往返完成全部五维审单、三模分倍、精算配单与对冲计算）
 */
export function evaluateQuantWorkspace(params, matchesInput) {
  const baseMatches =
    matchesInput && matchesInput.length > 0 ? matchesInput : FALLBACK_MATCHES;
  const clientAlerts =
    params?.clientAlerts && typeof params.clientAlerts === "object"
      ? params.clientAlerts
      : null;
  const matches = clientAlerts
    ? baseMatches.map((m) =>
        clientAlerts[m.id] ? { ...m, aiAlert: clientAlerts[m.id] } : m
      )
    : baseMatches;
  const picks = sanitizeAndDeduplicatePicks(params?.picks, 512);
  const multiple = Math.max(
    1,
    Math.min(999, Math.round(Number(params?.multiple) || 5))
  );
  const passSpec = params?.passSpec ?? { mode: "auto" };
  const subjectiveDeltaPct = Math.max(
    -15,
    Math.min(15, Number(params?.subjectiveDeltaPct) || 0)
  );
  const simVoidFirstMatch = Boolean(params?.simVoidFirstMatch);
  const planSpec = params?.planSpec ?? null;
  const targetIds = Array.isArray(params?.targetIds) ? params.targetIds : [];
  const anchorToRadarPicks = Boolean(params?.anchorToRadarPicks);
  const budget = Math.max(10, Math.min(20_000, Number(params?.budget) || 100));
  const stance =
    params?.stance === "home-lean" || params?.stance === "upset-watch"
      ? params.stance
      : "objective";
  const unlockFullAgg = Boolean(params?.unlockFullAgg);

  const sandboxBundle = buildSandboxAdjustedBundle(
    picks,
    matches,
    simVoidFirstMatch,
    subjectiveDeltaPct
  );
  const sandboxAdjustedPicks = sandboxBundle.picks;
  const hasSubjectiveShift = subjectiveDeltaPct !== 0;
  const hasSandboxShift = simVoidFirstMatch || hasSubjectiveShift;
  const baselineBundle = hasSandboxShift
    ? buildSandboxAdjustedBundle(picks, matches, false, 0)
    : sandboxBundle;
  const baselinePicks = baselineBundle.picks;
  const objectiveVoidBundle =
    hasSubjectiveShift && simVoidFirstMatch
      ? buildSandboxAdjustedBundle(picks, matches, true, 0)
      : baselineBundle;

  const precomputedBaselineManual =
    hasSandboxShift && (hasSubjectiveShift || planSpec?.kind === "bonus")
      ? computeTruthReport(
          baselinePicks,
          multiple,
          matches,
          passSpec,
          baselineBundle.atomicMap,
          {
            metricsOnly: true,
            captureHitMatrix: true,
            isBaselineAtomic: true,
          }
        )
      : null;

  const manualReport = computeTruthReport(
    sandboxAdjustedPicks,
    multiple,
    matches,
    passSpec,
    sandboxBundle.atomicMap,
    {
      captureHitMatrix: true,
      isBaselineAtomic: !hasSandboxShift,
      hasSubjectiveShift,
      objectiveAtomicMap: objectiveVoidBundle.atomicMap,
      precomputedObjectiveEval:
        hasSubjectiveShift && !simVoidFirstMatch && precomputedBaselineManual
          ? precomputedBaselineManual
          : null,
    }
  );

  const foundTargets = matches.filter((m) => targetIds.includes(m.id));
  const resolvedTargets =
    foundTargets.length > 0 ? foundTargets : matches.slice(0, 2);
  const fivePlans = generateFiveArchetypes(
    resolvedTargets,
    budget,
    stance,
    unlockFullAgg,
    anchorToRadarPicks ? baselinePicks : []
  );

  let appliedPlan = null;
  let alphaSmoothedAfterSync = false;
  if (planSpec?.kind === "bonus") {
    const mode =
      planSpec.optMode === "hot-first" || planSpec.optMode === "cold-first"
        ? planSpec.optMode
        : "equal";
    const baselineManualForOpt = precomputedBaselineManual ?? manualReport;
    const baseAppliedPlan = scaleArchetypePlan(
      optimizeBonusPlan(baselineManualForOpt, matches, mode, {
        upgradeToBreakeven: Boolean(planSpec.upgradeToBreakeven),
        consolidateTickets: Boolean(planSpec.consolidateTickets),
      }),
      planSpec.scaleMultiple
    );
    appliedPlan = applySandboxToPlan(
      baseAppliedPlan,
      matches,
      picks,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      {
        isArchetype: false,
        stance,
        manualReport,
        objectiveHitMatrix: baselineManualForOpt?._reusableHitMatrix ?? null,
      }
    );
  } else if (planSpec?.kind === "archetype") {
    const normalizedKey = normalizePortfolioKey(planSpec.key);
    const validSnap = isValidPlanObject(planSpec.snapshotPlan)
      ? planSpec.snapshotPlan
      : null;
    const liveCandidate =
      fivePlans.find((p) => p.key === normalizedKey) ?? null;
    const usableLive =
      liveCandidate &&
      liveCandidate.available !== false &&
      liveCandidate.lines.length > 0
        ? liveCandidate
        : null;
    const basePlan = validSnap ?? usableLive;
    const scaledBasePlan = scaleArchetypePlan(basePlan, planSpec.scaleMultiple);
    const baseAppliedPlan =
      scaledBasePlan &&
      planSpec.consolidateTickets &&
      scaledBasePlan.lines.length >= 2
        ? (() => {
            const cMults = consolidateCloseMultiples(
              scaledBasePlan.lines.map((l) => Number(l.multiple) || 1),
              scaledBasePlan.lines.map((l) => Number(l.unitPayout) || 2),
              scaledBasePlan.lines.map((l) => (l.cappedClipped ?? 0) > 0),
              scaledBasePlan.lines.map((l) => (l.legs ?? []).length || 1),
              scaledBasePlan.totalCost
            );
            const cLines = scaledBasePlan.lines.map((l, idx) => {
              const m = cMults[idx];
              const cost = m * 2;
              const ret = Number((l.unitPayout * m).toFixed(2));
              return {
                ...l,
                multiple: m,
                cost,
                returnPayout: ret,
                netProfit: Number((ret - scaledBasePlan.totalCost).toFixed(2)),
              };
            });
            return {
              ...scaledBasePlan,
              consolidateTickets: true,
              lines: cLines,
            };
          })()
        : scaledBasePlan;
    appliedPlan = applySandboxToPlan(
      baseAppliedPlan,
      matches,
      picks,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      {
        isArchetype: true,
        hasFrozenSnapshot: Boolean(validSnap),
        stance,
        manualReport,
        targetFirstMid: foundTargets[0]?.id ?? null,
      }
    );

    if (normalizedKey === "alpha-radar" && validSnap && appliedPlan) {
      // Check if live alpha-radar is now empty OR none of validSnap's legs still clear >= +3% alpha on live matches
      let anySnapLegStillAlpha = false;
      for (const l of validSnap.lines) {
        for (const lg of l.legs) {
          const fm = matches.find((m) => m.id === lg.matchId);
          if (!fm) continue;
          const scan = scanMatchAlphaCandidates(fm, null);
          if (
            scan.candidates.some((c) =>
              Array.isArray(c.betterPicks)
                ? c.betterPicks.some(
                    (bp) =>
                      bp.poolCode === lg.poolCode &&
                      bp.optionKey === lg.optionKey
                  )
                : c.poolCode === lg.poolCode && c.optionKey === lg.optionKey
            )
          ) {
            anySnapLegStillAlpha = true;
            break;
          }
        }
        if (anySnapLegStillAlpha) break;
      }
      if (!usableLive || !anySnapLegStillAlpha) {
        alphaSmoothedAfterSync = true;
      }
    }
  }

  const effectiveReport = appliedPlan
    ? archetypeToReport(appliedPlan, manualReport, matches)
    : manualReport;

  if (
    alphaSmoothedAfterSync &&
    effectiveReport &&
    Array.isArray(effectiveReport.warnings)
  ) {
    effectiveReport.warnings = [
      {
        id: "alpha-smoothed",
        severity: "warn",
        title:
          "⚠️ 原跨盘错价洼地已被官方最新调水抚平，建议还原等倍或改选前 3 档主方案",
        detail:
          "最新同步水位已消化原跨盘超额红利，当前实票结构已按最新实盘水位保留重算派奖与 EV。",
      },
      ...effectiveReport.warnings.filter((w) => w.id !== "alpha-smoothed"),
    ];
  }

  const insights = computeProOrderInsights(
    sandboxAdjustedPicks,
    effectiveReport,
    matches,
    appliedPlan
  );

  const subjectiveEVPct =
    effectiveReport.totalCost > 0 ? effectiveReport.expectedValueRate * 100 : 0;

  const allWarnings = [
    ...effectiveReport.warnings,
    ...buildXiaoGaoWarnings(picks, matches),
  ];

  return {
    manualReport,
    effectiveReport,
    appliedPlan,
    insights,
    portfolioPlans: fivePlans,
    fivePlans,
    subjectiveEVPct,
    allWarnings,
  };
}
