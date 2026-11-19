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

/**
 * 单池非线性去水求解器（Seam A）：
 * - 默认优先采用 Shin (1993) 知情交易博弈二分法（z ∈ (1e-9, 1 - 1e-9)，容差 <= 1e-12）剥离冷门长尾保护性暗扣；
 * - 当 V <= 1 + 1e-6 或极端畸形水位导致 Shin 越界时，平滑回退 Power 幂次法（q_i^k）；
 * - 当 n < 2 或存在 <= 1.0 超界水位时兜底回退 Multiplicative 等比归一化，确保输出概率恒属于 (0, 1] 且总和误差 < 1e-12。
 */
export function devigPoolProbabilities(rawInputs, method = 'shin') {
  if (!Array.isArray(rawInputs) || rawInputs.length === 0) {
    return {
      probs: [],
      methodUsed: 'multiplicative',
      overround: 0,
      payoutRatio: 0.88,
      vig: 0.12,
      param: 1,
    };
  }

  const odds = rawInputs.map((item) =>
    typeof item === 'object' && item !== null ? Number(item.odds) : Number(item)
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
      methodUsed: 'multiplicative',
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
      methodUsed: 'multiplicative',
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
      methodUsed: 'multiplicative',
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
        methodUsed: 'power',
        overround: V,
        payoutRatio,
        vig,
        param: 1,
      };
    }

    const logQ = new Float64Array(n);
    for (let i = 0; i < n; i++) logQ[i] = Math.log(q[i]);
    const evalSum = (k) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Math.exp(k * logQ[i]);
      return s;
    };

    let kLo = 1e-6;
    let kHi = 8.0;
    while (evalSum(kHi) > 1 && kHi < 4096) {
      kLo = kHi;
      kHi *= 2;
    }
    while (evalSum(kLo) < 1 && kLo > 1e-12) {
      kHi = kLo;
      kLo *= 0.1;
    }
    if (!(evalSum(kLo) >= 1 && evalSum(kHi) <= 1)) return null;

    let kMid = 1;
    for (let iter = 0; iter < 64; iter++) {
      kMid = 0.5 * (kLo + kHi);
      const s = evalSum(kMid);
      if (Math.abs(s - 1) <= 1e-14 || kHi - kLo <= 1e-14) break;
      if (s > 1) kLo = kMid;
      else kHi = kMid;
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
      methodUsed: 'power',
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

    let zMid = 0.05;
    for (let iter = 0; iter < 64; iter++) {
      zMid = 0.5 * (zLo + zHi);
      const s = evalSum(zMid);
      if (Math.abs(s - 1) <= 1e-14 || zHi - zLo <= 1e-14) break;
      if (s > 1) zLo = zMid;
      else zHi = zMid;
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
      methodUsed: 'shin',
      overround: V,
      payoutRatio,
      vig,
      param: zMid,
    };
  };

  if (method === 'multiplicative') return solveMultiplicative();
  if (method === 'power') return solvePower() ?? solveMultiplicative();
  return solveShin() ?? solvePower() ?? solveMultiplicative();
}

function buildPool(code, name, single, rawOptions, updateTime = '17:45:21', goalLine, selling = true) {
  const valid = selling ? rawOptions.filter((o) => o.odds > 0) : [];
  const isSelling = Boolean(selling && valid.length > 0);
  const invSum = valid.reduce((acc, o) => acc + 1 / o.odds, 0);
  const payoutRatio = invSum > 0 ? 1 / invSum : 0.88;
  const vig = Math.max(0, 1 - payoutRatio);
  const devigged = isSelling ? devigPoolProbabilities(valid, 'shin') : null;
  return {
    code,
    name,
    single,
    selling: isSelling,
    goalLine,
    payoutRatio,
    vig,
    updateTime,
    options: valid.map((o, idx) => ({
      key: o.key,
      label: o.label,
      odds: o.odds,
      trend: o.trend ?? 0,
      shinProb: devigged ? devigged.probs[idx] : 0,
      fairProb: devigged ? devigged.probs[idx] : 0,
    })),
  };
}

const DC_MAX_GOALS = 10;
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

const HAD_KEY_ORDER = ['h', 'd', 'a'];
const HHAD_KEY_ORDER = ['hh', 'hd', 'ha'];
const TTG_KEY_ORDER = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];
const HAFU_KEY_ORDER = ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'];
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
  const htChars = ['h', 'd', 'a'];

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
  return v < 0.12 ? 0.12 : v > 5.5 ? 5.5 : v;
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
const SCRATCH_CRS = new Float64Array(31);
const SCRATCH_TTG = new Float64Array(8);
const SCRATCH_HAFU = new Float64Array(9);
const SCRATCH_R0 = new Float64Array(64);
const SCRATCH_RP = new Float64Array(64);
const SCRATCH_RCAND = new Float64Array(64);
const SCRATCH_J0 = new Float64Array(64);
const SCRATCH_J1 = new Float64Array(64);
const SCRATCH_J2 = new Float64Array(64);
const SCRATCH_ATOMIC = new Float64Array(256);

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
    for (let k = 0; k <= n; k++) {
      outB[rowOut + k] = rowC[k] * SCRATCH_POW_T[k] * SCRATCH_POW_Q[n - k];
    }
  }
}

function projectHafuFromGrid(scoreGrid, theta, binomBuf, outHafu) {
  fillBinomPmfTable(theta, binomBuf);
  outHafu.fill(0);
  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const rowX = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const pXY = scoreGrid[rowX + y];
      const ftCode = x > y ? 0 : x === y ? 1 : 2;
      if (x === 0 && y === 0) {
        outHafu[3 + ftCode] += pXY;
        continue;
      }
      if (x === 0) {
        const wD = binomBuf[y * DC_DIM];
        const pD = pXY * wD;
        outHafu[3 + ftCode] += pD;
        outHafu[6 + ftCode] += pXY - pD;
        continue;
      }
      if (y === 0) {
        const wD = binomBuf[rowX];
        const pD = pXY * wD;
        outHafu[3 + ftCode] += pD;
        outHafu[ftCode] += pXY - pD;
        continue;
      }

      const rowY = y * DC_DIM;
      let rawH = 0;
      let rawD = 0;
      let rawA = 0;
      for (let x1 = 0; x1 <= x; x1++) {
        const bx = binomBuf[rowX + x1];
        for (let y1 = 0; y1 <= y; y1++) {
          const p = bx * binomBuf[rowY + y1];
          if (x1 > y1) rawH += p;
          else if (x1 === y1) rawD += p;
          else rawA += p;
        }
      }
      const tot = rawH + rawD + rawA;
      const pH = pXY * (rawH / tot);
      const pD = pXY * (rawD / tot);
      const pA = Math.max(0, pXY - pH - pD);
      outHafu[ftCode] += pH;
      outHafu[3 + ftCode] += pD;
      outHafu[6 + ftCode] += pA;
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

function extractCanonicalPoolTarget(pool, expectedKeys, mapByLabel = false) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options)) return null;
  if (pool.options.length !== expectedKeys.length) return null;
  if (pool.options.some((o) => !Number.isFinite(o.odds) || o.odds <= 0)) return null;

  const byKey = new Map();
  for (const o of pool.options) {
    byKey.set(mapByLabel ? o.label || o.key : o.key, o);
    if (!mapByLabel && o.label) byKey.set(o.label, o);
  }
  const ordered = [];
  for (const k of expectedKeys) {
    const hit = byKey.get(k);
    if (!hit) return null;
    ordered.push(hit);
  }
  const devig = devigPoolProbabilities(ordered, 'shin');
  return {
    probs: devig.probs,
    payoutRatio: devig.payoutRatio,
    vig: devig.vig,
  };
}

/**
 * 零历史库四参数 Dixon-Coles + 二项半场稀疏拆分跨盘闭合校准器（Seam A）
 * - 输入单场赛事快照（不原地篡改入参），输出 11x11 全场比分分布、物理相容半全场×全场原子态及五池闭合概率。
 * - 当在售锚点奖池 >= 2 时执行反抽水方差加权超定反演（耗时 < 0.5ms）；< 2 时无感回退单池 Shin/Power 去水值。
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
    Number.isFinite(rawGoalLine) && Number.isInteger(rawGoalLine) && rawGoalLine !== 0
      ? extractCanonicalPoolTarget(rawPools.HHAD, HHAD_KEY_ORDER)
      : null;
  const ttgTarget = extractCanonicalPoolTarget(rawPools.TTG, TTG_KEY_ORDER);
  const hafuTarget = extractCanonicalPoolTarget(rawPools.HAFU, HAFU_KEY_ORDER);
  const crsTarget = extractCanonicalPoolTarget(rawPools.CRS, CRS_LABEL_ORDER, true);

  const sellingTargets = [hadTarget, hhadTarget, ttgTarget, hafuTarget, crsTarget].filter(Boolean);
  const sellingPoolCount = sellingTargets.length;
  const coherent = sellingPoolCount >= 2;

  // Analytical initialization of (lambdaHome, lambdaAway, rho)
  let initTotalGoals = 2.55;
  if (ttgTarget) {
    let mu = 0;
    for (let k = 0; k < 8; k++) mu += (k === 7 ? 7.35 : k) * ttgTarget.probs[k];
    initTotalGoals = Math.max(0.6, Math.min(7.5, mu));
  } else if (crsTarget) {
    let mu = 0;
    for (let i = 0; i < 31; i++) {
      const lbl = CRS_LABEL_ORDER[i];
      if (lbl.includes(':')) {
        const [hx, ay] = lbl.split(':').map(Number);
        mu += (hx + ay) * crsTarget.probs[i];
      } else {
        mu += (lbl === '平其它' ? 8.0 : 6.5) * crsTarget.probs[i];
      }
    }
    initTotalGoals = Math.max(0.6, Math.min(7.5, mu));
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
      0.08,
      Math.min(0.92, hhadTarget.probs[0] + 0.5 * hhadTarget.probs[1] - 0.18 * goalLine)
    );
    initPD = 0.24;
    initPH = share * (1 - initPD);
    initPA = (1 - share) * (1 - initPD);
  }

  const logRatio = Math.log(
    Math.max(0.02, initPH + 0.25 * initPD) / Math.max(0.02, initPA + 0.25 * initPD)
  );
  const initDiff = initTotalGoals * Math.tanh(0.42 * logRatio);
  let lamH = clampLambda(0.5 * (initTotalGoals + initDiff));
  let lamA = clampLambda(0.5 * (initTotalGoals - initDiff));
  let rho = 0;

  // Build weighted residual specification for Stage 1
  const invVigPrecision = (t) =>
    Math.pow(t.payoutRatio / Math.max(0.045, t.vig), 2);
  const rawWHad = hadTarget ? invVigPrecision(hadTarget) * 1.0 : 0;
  const rawWHhad = hhadTarget ? invVigPrecision(hhadTarget) * 1.0 : 0;
  const rawWTtg = ttgTarget ? invVigPrecision(ttgTarget) * 1.5 : 0;
  const rawWHafuFt = hafuTarget
    ? invVigPrecision(hafuTarget) * (hadTarget ? 0.15 : 1.0)
    : 0;
  const hasCoreAnchors = Boolean(ttgTarget && (hadTarget || hhadTarget));
  const rawWCrs = crsTarget
    ? invVigPrecision(crsTarget) * (hasCoreAnchors ? 0.15 : 1.0)
    : 0;

  const maxRawW = Math.max(1, rawWHad, rawWHhad, rawWTtg, rawWHafuFt, rawWCrs);
  const sHad = Math.sqrt(rawWHad / maxRawW);
  const sHhad = Math.sqrt(rawWHhad / maxRawW);
  const sTtg = Math.sqrt(rawWTtg / maxRawW);
  const sHafuFt = Math.sqrt(rawWHafuFt / maxRawW);
  const sCrs = Math.sqrt(rawWCrs / maxRawW);

  const hasScalePool = Boolean(ttgTarget || crsTarget || hhadTarget);
  const sRhoPrior = Math.sqrt(hasScalePool && sellingPoolCount >= 2 ? 0.0015 : 0.03);
  const sTotPrior = !hasScalePool ? Math.sqrt(0.025) : 0;

  const hafuFtObs = hafuTarget
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
    (hafuFtObs ? 3 : 0) +
    (crsTarget ? 31 : 0) +
    1 +
    (sTotPrior > 0 ? 1 : 0);

  const gridWork = SCRATCH_GRID;
  const crsWork = SCRATCH_CRS;
  const ttgWork = SCRATCH_TTG;

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
    if (hafuFtObs) {
      outRes[k++] = sHafuFt * (pH - hafuFtObs[0]);
      outRes[k++] = sHafuFt * (pD - hafuFtObs[1]);
      outRes[k++] = sHafuFt * (pA - hafuFtObs[2]);
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

    for (let iter = 0; iter < 10; iter++) {
      const epsH = lamH > 5.49 ? -1e-5 : 1e-5;
      evalResiduals(clampLambda(lamH + epsH), lamA, rho, rP);
      const invEpsH = 1 / (clampLambda(lamH + epsH) - lamH);
      for (let i = 0; i < residualCount; i++) j0[i] = (rP[i] - r0[i]) * invEpsH;

      const epsA = lamA > 5.49 ? -1e-5 : 1e-5;
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
        const paramMove = Math.hypot(candLamH - lamH, candLamA - lamA, candRho - rho);
        const lossDrop = loss - candLoss;
        lamH = candLamH;
        lamA = candLamA;
        rho = candRho;
        loss = candLoss;
        for (let t = 0; t < residualCount; t++) r0[t] = rCand[t];
        damping = Math.max(1e-7, damping * 0.35);
        if (lossDrop < 1e-10 && paramMove < 2e-6) break;
      } else {
        damping *= 4.0;
        if (damping > 1e4) break;
      }
    }
  }

  rho = clampDcRho(rho, lamH, lamA);
  const scoreGrid = new Float64Array(DC_GRID_LEN);
  evalDixonColesGrid(lamH, lamA, rho, scoreGrid);

  // Stage 2: Fit half-time goal share theta in [0.38, 0.46] when HAFU is selling, else fixed 0.43
  let theta = DEFAULT_HT_GOAL_SHARE;
  const binomBuf = SCRATCH_BINOM;
  if (coherent && hafuTarget) {
    const hafuWork = SCRATCH_HAFU;
    const evalThetaLoss = (th) => {
      projectHafuFromGrid(scoreGrid, th, binomBuf, hafuWork);
      let l = 0.06 * (th - DEFAULT_HT_GOAL_SHARE) * (th - DEFAULT_HT_GOAL_SHARE);
      for (let i = 0; i < 9; i++) {
        const d = hafuWork[i] - hafuTarget.probs[i];
        l += d * d;
      }
      return l;
    };

    const invPhi = (Math.sqrt(5) - 1) / 2;
    let a = 0.38;
    let b = 0.46;
    let c = b - invPhi * (b - a);
    let d = a + invPhi * (b - a);
    let fc = evalThetaLoss(c);
    let fd = evalThetaLoss(d);
    for (let iter = 0; iter < 12; iter++) {
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

  // Exact Binomial Thinning expansion into physically compatible atomicStates
  fillBinomPmfTable(theta, binomBuf);
  const atomicLen = ATOMIC_TEMPLATES.length;
  const atomicProbs = SCRATCH_ATOMIC;
  for (let i = 0; i < atomicLen; i++) atomicProbs[i] = 0;
  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const rowX = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const cell = rowX + y;
      const pXY = scoreGrid[cell];
      const baseMap = cell * 3;
      if (x === 0 && y === 0) {
        atomicProbs[GRID_HT_TO_ATOMIC[baseMap + 1]] += pXY;
        continue;
      }
      if (x === 0) {
        const wD = binomBuf[y * DC_DIM];
        const pD = pXY * wD;
        atomicProbs[GRID_HT_TO_ATOMIC[baseMap + 1]] += pD;
        atomicProbs[GRID_HT_TO_ATOMIC[baseMap + 2]] += Math.max(0, pXY - pD);
        continue;
      }
      if (y === 0) {
        const wD = binomBuf[rowX];
        const pD = pXY * wD;
        atomicProbs[GRID_HT_TO_ATOMIC[baseMap + 1]] += pD;
        atomicProbs[GRID_HT_TO_ATOMIC[baseMap]] += Math.max(0, pXY - pD);
        continue;
      }

      const rowY = y * DC_DIM;
      let rawH = 0;
      let rawD = 0;
      let rawA = 0;
      for (let x1 = 0; x1 <= x; x1++) {
        const bx = binomBuf[rowX + x1];
        for (let y1 = 0; y1 <= y; y1++) {
          const p = bx * binomBuf[rowY + y1];
          if (x1 > y1) rawH += p;
          else if (x1 === y1) rawD += p;
          else rawA += p;
        }
      }
      const tot = rawH + rawD + rawA;
      const pH = pXY * (rawH / tot);
      const pD = pXY * (rawD / tot);
      const pA = Math.max(0, pXY - pH - pD);
      atomicProbs[GRID_HT_TO_ATOMIC[baseMap]] += pH;
      atomicProbs[GRID_HT_TO_ATOMIC[baseMap + 1]] += pD;
      atomicProbs[GRID_HT_TO_ATOMIC[baseMap + 2]] += pA;
    }
  }

  let atomicSum = 0;
  for (let i = 0; i < atomicLen; i++) atomicSum += atomicProbs[i];
  const invAtomicSum = 1 / atomicSum;
  for (let i = 0; i < atomicLen; i++) atomicProbs[i] *= invAtomicSum;

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

  const poolProbs = {
    HAD: { h: hadArr[0], d: hadArr[1], a: hadArr[2] },
    HHAD: { hh: hhadArr[0], hd: hhadArr[1], ha: hhadArr[2] },
    TTG: Object.fromEntries(TTG_KEY_ORDER.map((k, idx) => [k, ttgArr[idx]])),
    HAFU: Object.fromEntries(HAFU_KEY_ORDER.map((k, idx) => [k, hafuArr[idx]])),
    CRS: Object.fromEntries(CRS_LABEL_ORDER.map((lbl, idx) => [lbl, crsArr[idx]])),
  };

  // Build cloned pools with preserved raw payoutRatio & vig, single-pool shinProb, and coherent (or fallback) fairProb
  const calibratedPools = {};
  for (const code of ['HAD', 'HHAD', 'HAFU', 'TTG', 'CRS']) {
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
        options: Array.isArray(srcPool.options) ? srcPool.options.map((o) => ({ ...o })) : [],
      };
      continue;
    }

    const devig = devigPoolProbabilities(srcPool.options, 'shin');
    const coherentMap = poolProbs[code];
    const canProjectPool =
      coherent &&
      ((code === 'HAD' && Boolean(hadTarget)) ||
        (code === 'HHAD' && Boolean(hhadTarget)) ||
        (code === 'TTG' && Boolean(ttgTarget)) ||
        (code === 'HAFU' && Boolean(hafuTarget)) ||
        (code === 'CRS' && Boolean(crsTarget)));

    calibratedPools[code] = {
      ...srcPool,
      options: srcPool.options.map((o, idx) => {
        const shinProb = devig.probs[idx];
        const lookupKey = code === 'CRS' ? o.label || o.key : o.key;
        const projected = canProjectPool ? coherentMap[lookupKey] : undefined;
        return {
          ...o,
          shinProb,
          fairProb: typeof projected === 'number' ? projected : shinProb,
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

function buildMatchPoolsCacheSig(match) {
  const pools = match?.pools;
  if (!pools) return 'empty';
  let sig = '';
  for (const code of ['HAD', 'HHAD', 'HAFU', 'TTG', 'CRS']) {
    const p = pools[code];
    if (!p || p.selling === false || !Array.isArray(p.options) || p.options.length === 0) {
      sig += `${code}:0|`;
      continue;
    }
    const o0 = p.options[0];
    const oLast = p.options[p.options.length - 1];
    const oMid = p.options[p.options.length >> 1];
    sig += `${code}:${p.options.length}:${p.goalLine ?? ''}:${o0?.odds}:${oMid?.odds}:${oLast?.odds}:${o0?.fairProb}|`;
  }
  return sig;
}

function getCachedMatchCalibration(match) {
  if (!match || typeof match !== 'object') return null;
  const sig = buildMatchPoolsCacheSig(match);
  const cached = MATCH_CALIBRATION_CACHE.get(match);
  if (cached && cached.sig === sig) return cached.cal;
  const cal = calibrateMatchCoherentModel(match);
  MATCH_CALIBRATION_CACHE.set(match, { sig, cal });
  return cal;
}

const NEUTRAL_ATOMIC_PROBS = (() => {
  const grid = new Float64Array(DC_GRID_LEN);
  const binom = new Float64Array(DC_GRID_LEN);
  evalDixonColesGrid(1.38, 1.14, 0, grid);
  fillBinomPmfTable(DEFAULT_HT_GOAL_SHARE, binom);
  const atomicLen = ATOMIC_TEMPLATES.length;
  const out = new Float64Array(atomicLen);
  for (let x = 0; x <= DC_MAX_GOALS; x++) {
    const rowX = x * DC_DIM;
    for (let y = 0; y <= DC_MAX_GOALS; y++) {
      const cell = rowX + y;
      const pXY = grid[cell];
      const baseMap = cell * 3;
      if (x === 0 && y === 0) {
        out[GRID_HT_TO_ATOMIC[baseMap + 1]] += pXY;
        continue;
      }
      if (x === 0) {
        const pD = pXY * binom[y * DC_DIM];
        out[GRID_HT_TO_ATOMIC[baseMap + 1]] += pD;
        out[GRID_HT_TO_ATOMIC[baseMap + 2]] += Math.max(0, pXY - pD);
        continue;
      }
      if (y === 0) {
        const pD = pXY * binom[rowX];
        out[GRID_HT_TO_ATOMIC[baseMap + 1]] += pD;
        out[GRID_HT_TO_ATOMIC[baseMap]] += Math.max(0, pXY - pD);
        continue;
      }
      const rowY = y * DC_DIM;
      let rawH = 0;
      let rawD = 0;
      let rawA = 0;
      for (let x1 = 0; x1 <= x; x1++) {
        const bx = binom[rowX + x1];
        for (let y1 = 0; y1 <= y; y1++) {
          const p = bx * binom[rowY + y1];
          if (x1 > y1) rawH += p;
          else if (x1 === y1) rawD += p;
          else rawA += p;
        }
      }
      const tot = rawH + rawD + rawA;
      const pH = pXY * (rawH / tot);
      const pD = pXY * (rawD / tot);
      const pA = Math.max(0, pXY - pH - pD);
      out[GRID_HT_TO_ATOMIC[baseMap]] += pH;
      out[GRID_HT_TO_ATOMIC[baseMap + 1]] += pD;
      out[GRID_HT_TO_ATOMIC[baseMap + 2]] += pA;
    }
  }
  let s = 0;
  for (let i = 0; i < atomicLen; i++) s += out[i];
  for (let i = 0; i < atomicLen; i++) out[i] /= s;
  return out;
})();

function resolveGoalLineNum(match, poolName) {
  const rawFromMatch = Number(match?.pools?.HHAD?.goalLine);
  if (Number.isFinite(rawFromMatch) && Math.trunc(rawFromMatch) !== 0) {
    return Math.trunc(rawFromMatch);
  }
  if (typeof poolName === 'string') {
    const parsed = /\(([+-]?\d+)\)/.exec(poolName);
    if (parsed) {
      const n = Number(parsed[1]);
      if (Number.isFinite(n) && Math.trunc(n) !== 0) return Math.trunc(n);
    }
  }
  return -1;
}

function doesOptionHitAtomicTemplate(poolCode, optionKey, optionLabel, goalLineNum, tpl) {
  if (poolCode === 'HAD') {
    return tpl.ft === optionKey;
  }
  if (poolCode === 'HHAD') {
    const adj = tpl.goalDiff + goalLineNum;
    const key = adj > 0 ? 'hh' : adj === 0 ? 'hd' : 'ha';
    return key === optionKey;
  }
  if (poolCode === 'TTG') {
    const norm = String(optionKey).startsWith('s') ? optionKey : `s${optionKey}`;
    return tpl.ttgKey === norm;
  }
  if (poolCode === 'HAFU') {
    return tpl.hafuKey === optionKey;
  }
  if (poolCode === 'CRS') {
    const idx = CRS_INDEX_BY_KEY.get(optionKey) ?? CRS_INDEX_BY_KEY.get(optionLabel);
    if (idx !== undefined) return tpl.crsIdx === idx;
    return tpl.crsKey === optionKey || tpl.crsKey === optionLabel;
  }
  return false;
}

function sumOptionProbOnAtomic(atomicProbs, poolCode, optionKey, optionLabel, goalLineNum) {
  let s = 0;
  for (let i = 0; i < ATOMIC_TEMPLATES.length; i++) {
    if (doesOptionHitAtomicTemplate(poolCode, optionKey, optionLabel, goalLineNum, ATOMIC_TEMPLATES[i])) {
      s += atomicProbs[i];
    }
  }
  return s;
}

function alignAtomicProbsToPoolOptions(baseProbs, poolCode, options, goalLineNum) {
  if (!Array.isArray(options) || options.length === 0) return baseProbs;
  const validOpts = options.filter(
    (o) => o && Number.isFinite(Number(o.fairProb)) && Number(o.fairProb) > 0
  );
  if (validOpts.length === 0) return baseProbs;

  let maxDrift = 0;
  for (const o of validOpts) {
    const cur = sumOptionProbOnAtomic(baseProbs, poolCode, o.key, o.label, goalLineNum);
    const d = Math.abs(cur - Number(o.fairProb));
    if (d > maxDrift) maxDrift = d;
  }
  if (maxDrift <= 1e-14) return baseProbs;

  const atomicLen = ATOMIC_TEMPLATES.length;
  const out = new Float64Array(baseProbs);
  const covered = new Uint8Array(atomicLen);
  let targetCoveredSum = 0;
  const rawTargetSum = validOpts.reduce((acc, o) => acc + Number(o.fairProb), 0);
  const targetScale =
    rawTargetSum > 1
      ? 1 / rawTargetSum
      : validOpts.length >= (poolCode === 'HAD' || poolCode === 'HHAD' ? 3 : poolCode === 'TTG' ? 8 : poolCode === 'HAFU' ? 9 : 31) &&
          Math.abs(rawTargetSum - 1) < 0.05
        ? 1 / rawTargetSum
        : Math.min(1, 0.999999 / Math.max(1e-9, rawTargetSum));

  for (const o of validOpts) {
    const targetP = Number(o.fairProb) * targetScale;
    let curSum = 0;
    for (let i = 0; i < atomicLen; i++) {
      if (doesOptionHitAtomicTemplate(poolCode, o.key, o.label, goalLineNum, ATOMIC_TEMPLATES[i])) {
        covered[i] = 1;
        curSum += baseProbs[i];
      }
    }
    if (curSum > 0) {
      const factor = targetP / curSum;
      for (let i = 0; i < atomicLen; i++) {
        if (doesOptionHitAtomicTemplate(poolCode, o.key, o.label, goalLineNum, ATOMIC_TEMPLATES[i])) {
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
      : ['HAD', 'HHAD', 'TTG', 'HAFU', 'CRS'];

  // When coherent >= 2 pools AND caller inspects multiple pools on the same match,
  // cal.atomicStates is already the unique cross-pool coherent distribution.
  if (cal.coherent && checkCodes.length > 1) {
    return probs;
  }

  for (const code of checkCodes) {
    const pool = match.pools?.[code];
    if (!pool || pool.selling === false || !Array.isArray(pool.options) || pool.options.length === 0) {
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
      arr.push({ key: lg.optionKey, label: lg.optionLabel, fairProb: lg.fairProb });
    }
    byPool.set(lg.poolCode, arr);
  }
  const orderedPools = Array.from(byPool.keys()).sort(
    (a, b) => (poolOrder[a] ?? 9) - (poolOrder[b] ?? 9)
  );
  if (orderedPools.length === 1) {
    return alignAtomicProbsToPoolOptions(probs, orderedPools[0], byPool.get(orderedPools[0]), gl);
  }

  // Iterative Proportional Fitting (IPF) across coarse and fine pools for synthetic matchless fixtures
  for (let iter = 0; iter < 14; iter++) {
    for (const pCode of orderedPools) {
      probs = alignAtomicProbsToPoolOptions(probs, pCode, byPool.get(pCode), gl);
    }
  }
  return probs;
}

function computeCapitalWeightedVig(lines, matches) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { avgPayoutRatio: 0.88, vigPct: 12.0 };
  }
  let weightedRatioSum = 0;
  let totalWeight = 0;
  for (const l of lines) {
    const w = Math.max(0, Number(l.cost ?? (Number(l.multiple) || 1) * 2));
    if (w <= 0) continue;
    const legs = Array.isArray(l.legs) ? l.legs : [];
    let lineRatio = 1;
    for (const lg of legs) {
      if (Number(lg.odds) === 1.0) {
        // Voided leg has 1.0 multiplier (0% vig on voided match)
        continue;
      }
      const fm = Array.isArray(matches) ? matches.find((x) => x.id === lg.matchId) : null;
      const poolRatio = fm?.pools?.[lg.poolCode]?.payoutRatio;
      lineRatio *=
        typeof poolRatio === 'number' && Number.isFinite(poolRatio) && poolRatio > 0
          ? Math.min(1, poolRatio)
          : lg.poolCode === 'CRS'
            ? 0.76
            : lg.poolCode === 'HAFU'
              ? 0.78
              : lg.poolCode === 'TTG'
                ? 0.82
                : 0.88;
    }
    weightedRatioSum += w * lineRatio;
    totalWeight += w;
  }
  const avgPayoutRatio = totalWeight > 0 ? weightedRatioSum / totalWeight : 0.88;
  const vigPct = Number((Math.max(0, 1 - avgPayoutRatio) * 100).toFixed(1));
  return { avgPayoutRatio, vigPct };
}

/**
 * 商状态压缩联合状态空间评估核（Ω̃ = ∏ Ω̃_m）：
 * - 单场 139 个物理相容 (半场, 全场比分) 原子态按候选腿命中签名折叠为极小互斥商状态集 Ω̃_m（∑P = 1）；
 * - 当 M <= 8 且 |Ω̃| <= 16,384 时使用 32 位位掩码剪枝 DFS 100% 精确遍历全部联合状态，汇总同时命中的全部实票派奖；
 * - 确保所有输出 combos 严格互斥，恒满足 0 <= realProfitProb <= anyWinProb <= 1 且线性数学期望零误差。
 */
function evaluateTicketsOnQuotientSpace(ticketRows, totalCost, matches, matchAtomicMap = null) {
  if (!Array.isArray(ticketRows) || ticketRows.length === 0) {
    return {
      combos: [],
      anyWinProb: 0,
      realProfitProb: 0,
      minPayout: 0,
      maxPayout: 0,
      expectedReturn: 0,
      expectedValueRate: 0,
      underwaterCount: 0,
      underwaterShareOfWins: 0,
      likelyRange: [0, 0],
    };
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
      if (!optList.some((o) => o.poolCode === lg.poolCode && o.optionKey === lg.optionKey)) {
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
    const fm = Array.isArray(matches) ? matches.find((x) => x.id === mid) : null;
    const gl = resolveGoalLineNum(fm, opts.find((o) => o.poolCode === 'HHAD')?.poolName);

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
        atomicProbs = alignAtomicProbsToPoolOptions(base, poolCodes[0], pseudoOpts, gl);
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
          if (doesOptionHitAtomicTemplate(o.poolCode, o.optionKey, o.optionLabel, gl, tpl)) {
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
          if (doesOptionHitAtomicTemplate(o.poolCode, o.optionKey, o.optionLabel, gl, tpl)) {
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

  let prodSize = 1;
  for (let m = 0; m < M; m++) {
    prodSize *= quotientByMatch[m].length;
    if (prodSize > 1_000_000) break;
  }

  // Case B: 9~15 pure single-pass matches -> O(M) exact probability & expectation + 1D DP for realProfitProb
  if (M > 8 && isAllSingleTickets) {
    const perMatchDist = quotientByMatch.map((qStates, m) => {
      const mTickets = [];
      for (let k = 0; k < K; k++) {
        const jIdx = ticketOptIdx[k * M + m];
        if (jIdx >= 0) mTickets.push({ k, jIdx, row: ticketRows[k] });
      }
      let missProb = 0;
      const winOutcomes = [];
      for (const qs of qStates) {
        const hits = mTickets.filter((mt) => qs.hitSet.has(mt.jIdx)).map((mt) => mt.row);
        if (hits.length === 0) {
          missProb += qs.prob;
        } else {
          winOutcomes.push({
            prob: qs.prob,
            tickets: hits,
            unitPayout: hits.reduce((a, w) => a + w.unitPayout, 0),
            totalPayout: hits.reduce((a, w) => a + w.totalPayout, 0),
            cappedClipped: hits.reduce((a, w) => a + w.cappedClipped, 0),
          });
        }
      }
      return { missProb, winOutcomes };
    });

    const overallMissProb = perMatchDist.reduce((acc, d) => acc * d.missProb, 1);
    const anyWinProb = Math.max(0, Math.min(1, 1 - overallMissProb));
    const expectedReturn = perMatchDist.reduce(
      (acc, d) => acc + d.winOutcomes.reduce((s, o) => s + o.prob * o.totalPayout, 0),
      0
    );

    // 1D convolution DP over 0.1-yuan buckets for exact realProfitProb
    let dp = new Map([[0, 1]]);
    for (const d of perMatchDist) {
      const nextDp = new Map();
      const addMass = (amt, p) => {
        if (p <= 0) return;
        const key = amt >= totalCost ? Math.max(totalCost, Math.round(amt * 2) / 2) : Math.round(amt * 10) / 10;
        nextDp.set(key, (nextDp.get(key) ?? 0) + p);
      };
      for (const [prevAmt, prevP] of dp.entries()) {
        if (d.missProb > 0) addMass(prevAmt, prevP * d.missProb);
        for (const wo of d.winOutcomes) {
          addMass(prevAmt + wo.totalPayout, prevP * wo.prob);
        }
      }
      dp = nextDp;
    }

    let realProfitProb = 0;
    for (const [amt, p] of dp.entries()) {
      if (amt >= totalCost - 1e-9) realProfitProb += p;
    }
    realProfitProb = Math.min(anyWinProb, Math.max(0, realProfitProb));

    const allBestTickets = perMatchDist
      .map((d) => [...d.winOutcomes].sort((a, b) => b.totalPayout - a.totalPayout)[0])
      .filter(Boolean)
      .flatMap((o) => o.tickets);
    const allHitProb = perMatchDist.reduce(
      (acc, d) => acc * Math.max(0, 1 - d.missProb),
      1
    );
    const remProb = Math.max(0, anyWinProb - allHitProb);
    const soloWeight = remProb / Math.max(1, M);

    const combos = [];
    let scIdx = 0;
    perMatchDist.forEach((d) => {
      const worst = [...d.winOutcomes].sort((a, b) => a.totalPayout - b.totalPayout)[0];
      if (!worst) return;
      const netProfit = Number((worst.totalPayout - totalCost).toFixed(2));
      const hitLegs = worst.tickets.flatMap((w) => w.legs || []);
      combos.push({
        id: `c-sgl-${scIdx++}`,
        desc: `单关仅中1场 · ${hitLegs.map((i) => `${i.matchNumStr}[${i.optionLabel}@${Number(i.odds).toFixed(2)}]`).join('+')}`,
        legs: hitLegs,
        prob: soloWeight,
        unitPayout: Number(worst.unitPayout.toFixed(2)),
        totalPayout: Number(worst.totalPayout.toFixed(2)),
        cappedClipped: Number(worst.cappedClipped.toFixed(2)),
        netProfit,
        isUnderwater: netProfit < 0,
      });
    });
    if (allBestTickets.length > 0) {
      const unitPayout = Number(allBestTickets.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
      const totalPayout = Number(allBestTickets.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
      const cappedClipped = Number(allBestTickets.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2));
      const netProfit = Number((totalPayout - totalCost).toFixed(2));
      const hitLegs = allBestTickets.flatMap((w) => w.legs || []);
      combos.push({
        id: `c-sgl-all`,
        desc: `单关${M}场全红(${allBestTickets.length}注齐中)`,
        legs: hitLegs,
        prob: allHitProb,
        unitPayout,
        totalPayout,
        cappedClipped,
        netProfit,
        isUnderwater: netProfit < 0,
      });
    }
    combos.sort((a, b) => a.totalPayout - b.totalPayout);
    const minPayout = combos[0]?.totalPayout ?? 0;
    const maxPayout = combos[combos.length - 1]?.totalPayout ?? 0;
    const underwaterCount = combos.filter((c) => c.isUnderwater).length;
    const underwaterShareOfWins = anyWinProb > 0 ? Math.max(0, (anyWinProb - realProfitProb) / anyWinProb) : 0;
    return {
      combos,
      anyWinProb,
      realProfitProb,
      minPayout,
      maxPayout,
      expectedReturn,
      expectedValueRate: totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0,
      underwaterCount,
      underwaterShareOfWins,
      likelyRange: [minPayout, maxPayout],
    };
  }

  // Compress per-match quotient states ONLY if ultra-wide multi-select exceeds 16,384 joint states
  let evalQuotient = quotientByMatch;
  if (prodSize > 16_384) {
    evalQuotient = quotientByMatch.map((qStates, m) => {
      const missStates = qStates.filter((q) => q.hitSet.size === 0);
      const winStates = qStates.filter((q) => q.hitSet.size > 0);
      if (winStates.length <= 2) return qStates;
      const scored = winStates
        .map((qs) => {
          let maxOdds = 0;
          for (const j of qs.hitSet) {
            const o = distinctOptsByMatch[m][j];
            if (o && o.odds > maxOdds) maxOdds = o.odds;
          }
          return { qs, maxOdds };
        })
        .sort((a, b) => a.maxOdds - b.maxOdds);
      const lo = scored[0].qs;
      const hi = scored[scored.length - 1].qs;
      const midProb = scored.slice(1, -1).reduce((a, x) => a + x.qs.prob, 0);
      const halfMid = midProb * 0.5;
      const compressed = [
        ...missStates,
        { prob: lo.prob + halfMid, hitSet: lo.hitSet },
        { prob: hi.prob + (midProb - halfMid), hitSet: hi.hitSet },
      ];
      return compressed;
    });
  }

  const formatBucketCombo = (winningTickets, prob, idx) => {
    const unitPayout = Number(winningTickets.reduce((a, w) => a + w.unitPayout, 0).toFixed(2));
    const totalPayout = Number(winningTickets.reduce((a, w) => a + w.totalPayout, 0).toFixed(2));
    const cappedClipped = Number(
      winningTickets.reduce((a, w) => a + w.cappedClipped, 0).toFixed(2)
    );
    const netProfit = Number((totalPayout - totalCost).toFixed(2));
    const legMap = new Map();
    const hitMatches = new Set();
    for (const w of winningTickets) {
      for (const lg of w.legs || []) {
        hitMatches.add(lg.matchId);
        const lk = `${lg.matchId}:${lg.poolCode}:${lg.optionKey}`;
        if (!legMap.has(lk)) legMap.set(lk, lg);
      }
    }
    const dedupLegs = Array.from(legMap.values());
    if (winningTickets.length === 1) {
      const tk = winningTickets[0];
      return {
        id: tk.id,
        desc: tk.desc,
        legs: dedupLegs,
        prob,
        unitPayout,
        totalPayout,
        cappedClipped,
        netProfit,
        isUnderwater: netProfit < 0,
      };
    }
    const legSummary = dedupLegs
      .slice(0, 6)
      .map((g) => `${g.matchNumStr || g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`)
      .join(' × ');
    const prefix =
      hitMatches.size === M && M > 1
        ? `全中${M}场(${winningTickets.length}注齐收)`
        : M === 1
          ? `同场兼中${winningTickets.length}注`
          : `中${hitMatches.size}/${M}场(${winningTickets.length}注兼中)`;
    return {
      id: `c-jv-${idx}`,
      desc: `${prefix} · ${legSummary}${dedupLegs.length > 6 ? '…' : ''}`,
      legs: dedupLegs,
      prob,
      unitPayout,
      totalPayout,
      cappedClipped,
      netProfit,
      isUnderwater: netProfit < 0,
    };
  };

  const combos = [];
  if (K <= 32) {
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

    const winBuckets = new Map();
    const walk32 = (m, curProb, aliveMask) => {
      const qStates = evalQuotient[m];
      const cArr = compatMask[m];
      const isLast = m === M - 1;
      for (let s = 0; s < qStates.length; s++) {
        const nextMask = aliveMask & cArr[s];
        if (nextMask === 0) continue;
        const nextProb = curProb * qStates[s].prob;
        if (isLast) {
          const uMask = nextMask >>> 0;
          winBuckets.set(uMask, (winBuckets.get(uMask) ?? 0) + nextProb);
        } else {
          walk32(m + 1, nextProb, nextMask);
        }
      }
    };
    walk32(0, 1, fullMask);

    let bIdx = 0;
    for (const [uMask, prob] of winBuckets.entries()) {
      const winningTickets = [];
      for (let k = 0; k < K; k++) {
        if ((uMask & (1 << k)) !== 0) winningTickets.push(ticketRows[k]);
      }
      if (winningTickets.length > 0) {
        combos.push(formatBucketCombo(winningTickets, prob, bIdx++));
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

    const depthBufs = Array.from({ length: M + 1 }, () => new Uint32Array(wordCount));
    for (let k = 0; k < K; k++) {
      depthBufs[0][k >>> 5] |= 1 << (k & 31);
    }

    const winBuckets = new Map();
    const walkWords = (m, curProb) => {
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
          let key = '';
          for (let w = 0; w < wordCount; w++) {
            key += w === 0 ? nextWords[w].toString(36) : `_${nextWords[w].toString(36)}`;
          }
          const prev = winBuckets.get(key);
          if (prev) prev.prob += nextProb;
          else winBuckets.set(key, { words: new Uint32Array(nextWords), prob: nextProb });
        } else {
          walkWords(m + 1, nextProb);
        }
      }
    };
    walkWords(0, 1);

    let bIdx = 0;
    for (const entry of winBuckets.values()) {
      const winningTickets = [];
      for (let k = 0; k < K; k++) {
        if ((entry.words[k >>> 5] & (1 << (k & 31))) !== 0) {
          winningTickets.push(ticketRows[k]);
        }
      }
      if (winningTickets.length > 0) {
        combos.push(formatBucketCombo(winningTickets, entry.prob, bIdx++));
      }
    }
  }

  combos.sort((a, b) => a.totalPayout - b.totalPayout);
  const anyWinProb = Math.min(
    1,
    Math.max(0, combos.reduce((acc, c) => acc + c.prob, 0))
  );
  const realProfitProb = Math.min(
    anyWinProb,
    Math.max(
      0,
      combos.filter((c) => !c.isUnderwater).reduce((acc, c) => acc + c.prob, 0)
    )
  );
  const minPayout = combos[0]?.totalPayout ?? 0;
  const maxPayout = combos[combos.length - 1]?.totalPayout ?? 0;
  const expectedReturn = combos.reduce((acc, c) => acc + c.prob * c.totalPayout, 0);
  const expectedValueRate = totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0;
  const underwaterCount = combos.filter((c) => c.isUnderwater).length;
  const underwaterProbSum = combos
    .filter((c) => c.isUnderwater)
    .reduce((acc, c) => acc + c.prob, 0);
  const underwaterShareOfWins =
    anyWinProb > 0 ? Math.min(1, Math.max(0, underwaterProbSum / anyWinProb)) : 0;

  const byProbDesc = [...combos].sort((a, b) => b.prob - a.prob);
  const topHalf = byProbDesc.slice(0, Math.max(1, Math.ceil(byProbDesc.length * 0.6)));
  const rawLikelyMin = topHalf.length ? Math.min(...topHalf.map((c) => c.totalPayout)) : 0;
  const rawLikelyMax = topHalf.length ? Math.max(...topHalf.map((c) => c.totalPayout)) : 0;
  const likelyMin = combos.length ? Math.max(minPayout, rawLikelyMin) : 0;
  const likelyMax = combos.length ? Math.min(maxPayout, Math.max(likelyMin, rawLikelyMax)) : 0;

  return {
    combos,
    anyWinProb,
    realProfitProb,
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
  if (stance !== 'home-lean' && stance !== 'upset-watch') {
    return baseProbs;
  }
  const atomicLen = ATOMIC_TEMPLATES.length;
  const out = new Float64Array(atomicLen);

  let underdogFt = 'a';
  if (stance === 'upset-watch') {
    let pH = 0;
    let pA = 0;
    for (let i = 0; i < atomicLen; i++) {
      const ft = ATOMIC_TEMPLATES[i].ft;
      if (ft === 'h') pH += baseProbs[i];
      else if (ft === 'a') pA += baseProbs[i];
    }
    const gl = resolveGoalLineNum(match);
    const isAwayFav = Math.abs(pA - pH) > 1e-6 ? pA > pH : gl > 0;
    underdogFt = isAwayFav ? 'h' : 'a';
  }

  const homeBoost = Math.exp(0.22);
  const drawBoost = Math.exp(0.24);
  const dogBoost = Math.exp(0.28);

  let sum = 0;
  for (let i = 0; i < atomicLen; i++) {
    const ft = ATOMIC_TEMPLATES[i].ft;
    let mult = 1;
    if (stance === 'home-lean') {
      if (ft === 'h') mult = homeBoost;
    } else if (stance === 'upset-watch') {
      if (ft === 'd') mult = drawBoost;
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

function tiltAtomicProbsBySubjectiveDelta(baseProbs, legsOnMatch, goalLineNum, subjectiveDeltaPct) {
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
      if (doesOptionHitAtomicTemplate(lg.poolCode, lg.optionKey, lg.optionLabel, goalLineNum, tpl)) {
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

function computeShrunkSubPoolScan(calPools, coherent, sellingPoolCount) {
  if (!coherent || sellingPoolCount < 2) {
    return '单池独立开售：已启用非线性去水校准，暂无跨盘比价基准';
  }

  let mainPayoutRatio = 0;
  for (const mainCode of ['HAD', 'HHAD']) {
    const p = calPools[mainCode];
    if (p && p.selling !== false && Array.isArray(p.options) && p.options.length > 0) {
      if (p.payoutRatio > mainPayoutRatio) mainPayoutRatio = p.payoutRatio;
    }
  }
  if (mainPayoutRatio <= 0) {
    for (const p of Object.values(calPools)) {
      if (p && p.selling !== false && Array.isArray(p.options) && p.options.length > 0) {
        if (p.payoutRatio > mainPayoutRatio) mainPayoutRatio = p.payoutRatio;
      }
    }
  }
  if (mainPayoutRatio <= 0) mainPayoutRatio = 0.88;

  let bestHit = null;
  let bestDelta = -Infinity;
  for (const subCode of ['HAFU', 'TTG', 'CRS']) {
    const pool = calPools[subCode];
    if (!pool || pool.selling === false || !Array.isArray(pool.options)) continue;
    for (const opt of pool.options) {
      if (!(Number.isFinite(opt.odds) && opt.odds > 0 && opt.fairProb > 0)) continue;
      const shinP = typeof opt.shinProb === 'number' && opt.shinProb > 0 ? opt.shinProb : opt.fairProb;
      const wDc = 6.0 / (6.0 + Math.max(0, opt.odds - 2.0));
      const pBlend = wDc * opt.fairProb + (1 - wDc) * shinP;
      const returnCap =
        opt.odds > 28
          ? mainPayoutRatio + 0.025
          : opt.odds > 14
            ? Math.min(1.05, mainPayoutRatio + 0.075)
            : 1.18;
      const shrunkReturn = Math.min(returnCap, opt.odds * pBlend);
      const delta = shrunkReturn - mainPayoutRatio;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestHit = {
          poolName: pool.name || subCode,
          label: opt.label || opt.key,
          odds: opt.odds,
          shrunkReturn,
          delta,
        };
      }
    }
  }

  if (bestHit && (bestHit.delta >= 0.03 || bestHit.shrunkReturn > 1.0)) {
    if (bestHit.shrunkReturn > 1.0) {
      return `检出跨盘绝对正期望洼地：【${bestHit.poolName}·${bestHit.label}@${bestHit.odds.toFixed(2)}】收缩期望返还 ${(bestHit.shrunkReturn * 100).toFixed(1)}%（跑赢主盘 +${(bestHit.delta * 100).toFixed(1)}%）`;
    }
    return `检出跨盘错价洼地：【${bestHit.poolName}·${bestHit.label}@${bestHit.odds.toFixed(2)}】收缩期望返还 ${(bestHit.shrunkReturn * 100).toFixed(1)}%（较主盘少亏 +${(bestHit.delta * 100).toFixed(1)}%）`;
  }

  const maxDeltaText = Number.isFinite(bestDelta)
    ? `${bestDelta >= 0 ? '+' : ''}${(bestDelta * 100).toFixed(1)}%`
    : '0.0%';
  return `五池定价严密：各细分玩法经收缩校准后均未跑赢主盘基准（最高偏离 ${maxDeltaText} < +3.0%），无跨盘错价洼地`;
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

  const goalLine = m.pools.HHAD?.goalLine ?? '-1';
  const goalLineNum = Number(goalLine);
  const hhadSelling =
    m.pools.HHAD?.selling !== false &&
    Array.isArray(m.pools.HHAD?.options) &&
    m.pools.HHAD.options.length > 0;

  const cohHomeWinProb = cal.poolProbs.HAD.h;
  const cohAwayWinProb = cal.poolProbs.HAD.a;
  const isAwayFav = hhadSelling
    ? String(goalLine).includes('+') || goalLineNum > 0
    : Math.abs(cohAwayWinProb - cohHomeWinProb) > 1e-6
      ? cohAwayWinProb > cohHomeWinProb
      : String(goalLine).includes('+') || goalLineNum > 0;
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

  let bestGoalPair = ['s2', 's3', 0];
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
        oneGoalShareOfWins >= 0.5
          ? `防赢1球卡盘 ${(oneGoalShareOfWins * 100).toFixed(0)}%`
          : `穿盘率 ${(100 - oneGoalShareOfWins * 100).toFixed(0)}%`,
      tone: oneGoalShareOfWins >= 0.5 ? 'amber' : 'emerald',
    },
  ];
  if (arbitrages[0]) {
    microBadges.push({ text: `💰省钱差价 +${arbitrages[0].edgePct}%`, tone: 'emerald' });
  }
  if (droppingOpts.length > 0) {
    microBadges.push({ text: `🔻${droppingOpts[0]}降水`, tone: 'purple' });
  }

  const paceCorrelation = Number(cal.params.rho.toFixed(4));
  const paceLabel =
    paceCorrelation <= -0.05
      ? '防守死锁'
      : paceCorrelation >= 0.05
        ? '开放对攻'
        : '均衡节奏';
  const alphaScanSummary = computeShrunkSubPoolScan(
    cal.pools,
    cal.coherent,
    cal.sellingPoolCount
  );

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
        aiAlert: undefined,
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

  const jointEval = evaluateTicketsOnQuotientSpace(ticketRows, totalCost, matches);
  const {
    combos,
    anyWinProb,
    realProfitProb,
    minPayout,
    maxPayout,
    expectedValueRate,
    underwaterCount,
    underwaterShareOfWins,
    likelyRange: [likelyMin, likelyMax],
  } = jointEval;
  const comboCount = combos.length;

  const avgPassLen =
    activePassSizes.reduce((a, b) => a + b, 0) / Math.max(1, activePassSizes.length);
  const { avgPayoutRatio, vigPct: avgVigLossPer100 } = computeCapitalWeightedVig(
    ticketRows,
    matches
  );

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

function makeLeg(m, poolCode, optionKey, stance, precomputedStanceProbs = null) {
  const pool = m.pools[poolCode];
  const opt =
    pool?.options.find((o) => o.key === optionKey || o.label === optionKey) ?? pool?.options[0];
  if (!pool || !opt) return null;

  const stanceProbs =
    precomputedStanceProbs ?? tiltAtomicProbsByStance(getMatchBaseAtomicProbs(m, [poolCode]), m, stance);
  const gl = resolveGoalLineNum(m, pool.name);
  const prob = sumOptionProbOnAtomic(stanceProbs, poolCode, opt.key, opt.label, gl);

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

const COVERING_WHEEL_DESIGNS = {
  3: [{ name: 'C(3,2,2)', maxK: 2, blocks: [[0, 1], [0, 2], [1, 2]] }],
  4: [
    { name: 'C(4,3,3)', maxK: 3, blocks: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] },
    { name: 'C(4,2,2)', maxK: 2, blocks: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] },
  ],
  5: [
    { name: 'C(5,3,4)', maxK: 3, blocks: [[0, 1, 2], [1, 2, 3], [2, 3, 4], [0, 3, 4], [0, 1, 4]] },
    { name: 'C(5,2,3)', maxK: 2, blocks: [[0, 1], [2, 3], [2, 4], [3, 4]] },
    {
      name: 'C(5,4,4)',
      maxK: 4,
      blocks: [[0, 1, 2, 3], [0, 1, 2, 4], [0, 1, 3, 4], [0, 2, 3, 4], [1, 2, 3, 4]],
    },
  ],
  6: [
    {
      name: 'C(6,3,4)',
      maxK: 3,
      blocks: [[0, 1, 2], [0, 1, 3], [0, 4, 5], [1, 4, 5], [2, 3, 4], [2, 3, 5]],
    },
    {
      name: 'C(6,2,4)',
      maxK: 2,
      blocks: [[0, 1], [0, 2], [1, 2], [3, 4], [3, 5], [4, 5]],
    },
    {
      name: 'C(6,5,5)',
      maxK: 5,
      blocks: [
        [0, 1, 2, 3, 4],
        [0, 1, 2, 3, 5],
        [0, 1, 2, 4, 5],
        [0, 1, 3, 4, 5],
        [0, 2, 3, 4, 5],
        [1, 2, 3, 4, 5],
      ],
    },
  ],
  7: [
    {
      name: 'C(7,3,5)',
      maxK: 3,
      blocks: [[0, 1, 3], [1, 2, 4], [2, 3, 5], [3, 4, 6], [0, 4, 5], [1, 5, 6], [0, 2, 6]],
    },
    {
      name: 'C(7,6,6)',
      maxK: 6,
      blocks: [
        [0, 1, 2, 3, 4, 5],
        [0, 1, 2, 3, 4, 6],
        [0, 1, 2, 3, 5, 6],
        [0, 1, 2, 4, 5, 6],
        [0, 1, 3, 4, 5, 6],
        [0, 2, 3, 4, 5, 6],
        [1, 2, 3, 4, 5, 6],
      ],
    },
  ],
  8: [
    {
      name: 'C(8,4,6)',
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
      name: 'C(8,3,6)',
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
    {
      name: 'C(8,7,7)',
      maxK: 7,
      blocks: [
        [0, 1, 2, 3, 4, 5, 6],
        [0, 1, 2, 3, 4, 5, 7],
        [0, 1, 2, 3, 4, 6, 7],
        [0, 1, 2, 3, 5, 6, 7],
        [0, 1, 2, 4, 5, 6, 7],
        [0, 1, 3, 4, 5, 6, 7],
        [0, 2, 3, 4, 5, 6, 7],
        [1, 2, 3, 4, 5, 6, 7],
      ],
    },
  ],
};

function allocateWheelMeanCvar(blockSpecs, kickerSpec, matchIds, targetBudgetYuan) {
  const allSpecs = kickerSpec ? [...blockSpecs, kickerSpec] : [...blockSpecs];
  const K = allSpecs.length;
  if (K === 0) return { lines: [], missOneReturn: 0 };

  const units = allSpecs.map((sp) => {
    const rawU = bankerRoundParlayUnitPayout(sp.legs.map((g) => g.odds));
    return Math.min(statutorySingleBetCap(sp.legs.length), rawU);
  });
  const probs = allSpecs.map((sp) => sp.legs.reduce((a, g) => a * g.fairProb, 1));
  const B = blockSpecs.length;
  const v = matchIds.length;

  // blockAvoids[b][x] = true iff block b does NOT depend on match x
  const blockAvoids = blockSpecs.map((sp) =>
    matchIds.map((mid) => !sp.legs.some((g) => g.matchId === mid))
  );

  const totalNotes = Math.max(K, Math.floor(targetBudgetYuan / 2));
  const mults = new Array(K).fill(1);
  let rem = totalNotes - K;

  // Give optional full-parlay kicker at most ~10% of extra notes so 90%+ strengthens miss-1 floor
  if (kickerSpec && rem >= 8) {
    const kickerExtra = Math.min(998, Math.max(0, Math.floor(rem * 0.1)));
    mults[K - 1] += kickerExtra;
    rem -= kickerExtra;
  }

  const evalMissVec = (candMults) => {
    const vec = new Float64Array(v);
    for (let x = 0; x < v; x++) {
      let s = 0;
      for (let b = 0; b < B; b++) {
        if (blockAvoids[b][x]) s += candMults[b] * units[b];
      }
      vec[x] = s;
    }
    vec.sort();
    return vec;
  };

  while (rem > 0) {
    let bestB = -1;
    let bestFloor = -Infinity;
    let bestTailAvg = -Infinity;
    let bestEv = -Infinity;
    const step = rem > 90 ? Math.max(1, Math.floor(rem / 45)) : 1;

    for (let b = 0; b < B; b++) {
      if (mults[b] + step > 999) continue;
      mults[b] += step;
      const sortedMiss = evalMissVec(mults);
      mults[b] -= step;
      const floorVal = sortedMiss[0];
      const tailLen = Math.max(1, Math.ceil(v * 0.5));
      let tailSum = 0;
      for (let t = 0; t < tailLen; t++) tailSum += sortedMiss[t];
      const tailAvg = tailSum / tailLen;
      const evScore = probs[b] * units[b];

      if (
        floorVal > bestFloor + 1e-9 ||
        (Math.abs(floorVal - bestFloor) <= 1e-9 && tailAvg > bestTailAvg + 1e-9) ||
        (Math.abs(floorVal - bestFloor) <= 1e-9 &&
          Math.abs(tailAvg - bestTailAvg) <= 1e-9 &&
          evScore > bestEv)
      ) {
        bestFloor = floorVal;
        bestTailAvg = tailAvg;
        bestEv = evScore;
        bestB = b;
      }
    }
    if (bestB === -1) break;
    mults[bestB] += step;
    rem -= step;
  }

  const lines = materializePlanLines(allSpecs, mults);
  const missPayouts = matchIds.map((mid) =>
    Number(
      lines
        .filter((l) => !l.legs.some((g) => g.matchId === mid))
        .reduce((a, l) => a + l.returnPayout, 0)
        .toFixed(2)
    )
  );
  const missOneReturn = v >= 2 ? Math.min(...missPayouts) : Math.min(...lines.map((l) => l.returnPayout));
  return { lines, missOneReturn };
}

function computeOptionShrunkAlpha(odds, dcProb, shinProb) {
  const cleanOdds = Number(odds);
  if (!(cleanOdds > 1.01 && dcProb > 0)) {
    return { pShrunk: 0, expectedReturn: 0 };
  }
  const baseShin = typeof shinProb === 'number' && shinProb > 0 ? shinProb : dcProb;
  const excessOdds = Math.max(0, cleanOdds - 1.5);
  const wShrink = 0.25 + 0.5 * (excessOdds / (excessOdds + 6.0));
  const pRaw = (1 - wShrink) * dcProb + wShrink * baseShin;
  const maxRatio = cleanOdds > 25 ? 1.08 : cleanOdds > 12 ? 1.2 : 1.38;
  const pShrunk = Math.min(pRaw, baseShin * maxRatio);
  return {
    wShrink,
    pShrunk,
    expectedReturn: cleanOdds * pShrunk,
  };
}

function scanMatchAlphaCandidates(match, anchorList = null) {
  const cal = getCachedMatchCalibration(match);
  if (!cal) return { mainPayoutRatio: 0.88, candidates: [] };

  let mainPayoutRatio = 0;
  for (const mainCode of ['HAD', 'HHAD']) {
    const p = cal.pools[mainCode];
    if (p && p.selling !== false && Array.isArray(p.options) && p.options.length > 0) {
      if (p.payoutRatio > mainPayoutRatio) mainPayoutRatio = p.payoutRatio;
    }
  }
  if (mainPayoutRatio <= 0) {
    for (const p of Object.values(cal.pools)) {
      if (p && p.selling !== false && Array.isArray(p.options) && p.options.length > 0) {
        if (p.payoutRatio > mainPayoutRatio) mainPayoutRatio = p.payoutRatio;
      }
    }
  }
  if (mainPayoutRatio <= 0) mainPayoutRatio = 0.88;

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
        if (doesOptionHitAtomicTemplate(a.poolCode, a.optionKey, a.optionLabel, gl, tpl)) {
          ancMask[i] = 1;
          break;
        }
      }
    }
  }

  const candidates = [];
  for (const code of ['HAD', 'HHAD', 'HAFU', 'TTG', 'CRS']) {
    const pool = cal.pools[code];
    if (!pool || pool.selling === false || !Array.isArray(pool.options) || pool.options.length === 0) {
      continue;
    }
    const isMainPool = code === 'HAD' || code === 'HHAD';
    for (const opt of pool.options) {
      if (!(Number.isFinite(opt.odds) && opt.odds > 1.01)) continue;
      if (ancMask) {
        let optMass = 0;
        let overlapMass = 0;
        for (let i = 0; i < atomicLen; i++) {
          if (doesOptionHitAtomicTemplate(code, opt.key, opt.label, gl, ATOMIC_TEMPLATES[i])) {
            optMass += calAtomic[i];
            if (ancMask[i]) overlapMass += calAtomic[i];
          }
        }
        if (!(optMass > 0 && overlapMass / optMass >= 0.5)) continue;
      }

      const dcProb = cal.coherent
        ? sumOptionProbOnAtomic(calAtomic, code, opt.key, opt.label, gl)
        : opt.shinProb ?? opt.fairProb;
      const shinProb = opt.shinProb ?? dcProb;
      const { pShrunk, expectedReturn } = computeOptionShrunkAlpha(opt.odds, dcProb, shinProb);
      const ownPoolReturn = opt.odds * shinProb;
      const crossPoolDivergence = expectedReturn - ownPoolReturn;
      const otherMainCode = code === 'HAD' ? 'HHAD' : 'HAD';
      const otherMainPool = cal.pools[otherMainCode];
      const otherMainRatio =
        isMainPool &&
        otherMainPool &&
        otherMainPool.selling !== false &&
        otherMainPool.payoutRatio > 0
          ? otherMainPool.payoutRatio
          : mainPayoutRatio;
      const delta =
        !isMainPool && cal.coherent && cal.sellingPoolCount >= 2
          ? expectedReturn - mainPayoutRatio
          : isMainPool && cal.coherent && cal.sellingPoolCount >= 2 && crossPoolDivergence >= 0.015
            ? expectedReturn - otherMainRatio
            : expectedReturn > 1.0
              ? expectedReturn - mainPayoutRatio
              : -1;

      if (delta >= 0.03 || expectedReturn > 1.0) {
        candidates.push({
          matchId: match.id,
          match,
          poolCode: code,
          poolName: pool.name || code,
          singleAllowed: Boolean(pool.single),
          optionKey: opt.key,
          optionLabel: opt.label || opt.key,
          odds: opt.odds,
          pShrunk,
          expectedReturn,
          delta,
          isPositiveEv: expectedReturn > 1.0,
        });
      }
    }
  }

  candidates.sort((a, b) => b.delta - a.delta || b.expectedReturn - a.expectedReturn);
  return { mainPayoutRatio, candidates };
}

function materializePlanLines(specs, mults) {
  const actualCost = mults.reduce((a, m) => a + m * 2, 0);
  return specs.map((sp, idx) => {
    const mult = mults[idx];
    const rawUnit = bankerRoundParlayUnitPayout(sp.legs.map((g) => g.odds));
    const cap = statutorySingleBetCap(sp.legs.length);
    const unitPayout = Math.min(cap, rawUnit);
    const cappedClipped = Math.max(0, Number(((rawUnit - unitPayout) * mult).toFixed(2)));
    const returnPayout = Number((unitPayout * mult).toFixed(2));
    const prob = sp.legs.reduce((a, g) => a * g.fairProb, 1);
    return {
      id: sp.id,
      roleLabel: sp.roleLabel,
      legs: sp.legs,
      modeLabel: sp.legs.length === 1 ? '单关' : `${sp.legs.length}串1`,
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

function solveZeroUnderwaterDutching(rawSpecs, targetBudgetYuan) {
  let active = rawSpecs
    .map((r) => {
      const nonNull = (Array.isArray(r?.legs) ? r.legs : []).filter(Boolean);
      if (nonNull.length === 0) return null;
      const legCap = Math.min(...nonNull.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
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
      .sort((a, b) => b.prob * b.unitPayout - a.prob * a.unitPayout || b.prob - a.prob);
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
      for (let candNotes = maxNotes; candNotes >= Math.max(K, maxNotes - 4); candNotes--) {
        const targetCost = candNotes * 2;
        const minMults = active.map((x) => Math.max(1, Math.ceil(targetCost / x.unitPayout)));
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
          solvedMults = mults;
          break;
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

function allocateSpearAndExactShield(spearSpecs, shieldSpec, targetBudgetYuan) {
  const cleanSpears = spearSpecs
    .map((r) => {
      const legs = (r?.legs ?? []).filter(Boolean);
      if (legs.length === 0) return null;
      const rawUnit = bankerRoundParlayUnitPayout(legs.map((g) => g.odds));
      const unitPayout = Math.min(statutorySingleBetCap(legs.length), rawUnit);
      const prob = legs.reduce((a, g) => a * g.fairProb, 1);
      return { ...r, legs, rawUnit, unitPayout, prob };
    })
    .filter((x) => x && x.unitPayout >= 2.0)
    .sort((a, b) => b.prob * b.unitPayout - a.prob * a.unitPayout);

  if (cleanSpears.length === 0) return [];

  const totalNotes = Math.max(cleanSpears.length + (shieldSpec ? 1 : 0), Math.floor(targetBudgetYuan / 2));
  const totalStake = totalNotes * 2;

  let cleanShield = null;
  if (shieldSpec && Array.isArray(shieldSpec.legs) && shieldSpec.legs.length > 0) {
    const rawU = bankerRoundParlayUnitPayout(shieldSpec.legs.map((g) => g.odds));
    const unitU = Math.min(statutorySingleBetCap(shieldSpec.legs.length), rawU);
    if (unitU > 2.02) {
      const exactShieldMult = Math.ceil(totalStake / unitU);
      const remNotes = totalNotes - exactShieldMult;
      // Strict anti-inversion: shield must take < 45% of budget and leave enough notes for primary spear breakeven
      if (
        exactShieldMult >= 1 &&
        exactShieldMult < totalNotes * 0.45 &&
        remNotes >= cleanSpears.length &&
        remNotes * cleanSpears[0].unitPayout >= totalStake
      ) {
        cleanShield = {
          ...shieldSpec,
          rawUnit: rawU,
          unitPayout: unitU,
          prob: shieldSpec.legs.reduce((a, g) => a * g.fairProb, 1),
          exactMult: exactShieldMult,
        };
      }
    }
  }

  const attackNotes = cleanShield
    ? totalNotes - cleanShield.exactMult
    : Math.max(cleanSpears.length, Math.floor(targetBudgetYuan / 2));
  const finalStake = (attackNotes + (cleanShield ? cleanShield.exactMult : 0)) * 2;

  let attackMults = [];
  if (cleanSpears.length === 1) {
    attackMults = [Math.min(999, attackNotes)];
  } else if (cleanSpears.length === 2) {
    const sp0 = cleanSpears[0];
    const sp1 = cleanSpears[1];
    const min0 = Math.ceil(finalStake / sp0.unitPayout);
    const min1 = Math.ceil(finalStake / sp1.unitPayout);
    if (min0 + min1 <= attackNotes) {
      // Maximize log-utility on bankroll W0 = 3 * finalStake across exact integer splits [min0 .. attackNotes - min1]
      const wBase = 2 * finalStake;
      const pMiss = Math.max(0, 1 - sp0.prob - sp1.prob - (cleanShield ? cleanShield.prob : 0));
      let bestM0 = attackNotes - min1;
      let bestUtil = -Infinity;
      const hi0 = attackNotes - min1;
      const step = Math.max(1, Math.floor((hi0 - min0) / 64));
      const evalM0 = (m0) => {
        const m1 = attackNotes - m0;
        return (
          sp0.prob * Math.log(Math.max(1, wBase + m0 * sp0.unitPayout)) +
          sp1.prob * Math.log(Math.max(1, wBase + m1 * sp1.unitPayout)) +
          pMiss * Math.log(Math.max(1, wBase))
        );
      };
      for (let m0 = min0; m0 <= hi0; m0 += step) {
        const u = evalM0(m0);
        if (u > bestUtil) {
          bestUtil = u;
          bestM0 = m0;
        }
      }
      for (let m0 = Math.max(min0, bestM0 - step); m0 <= Math.min(hi0, bestM0 + step); m0++) {
        const u = evalM0(m0);
        if (u > bestUtil) {
          bestUtil = u;
          bestM0 = m0;
        }
      }
      attackMults = [bestM0, attackNotes - bestM0];
    } else {
      // Cannot keep 2nd arrow above breakeven -> concentrate 100% of attack notes onto primary arrow!
      cleanSpears.splice(1);
      attackMults = [Math.min(999, attackNotes)];
    }
  } else {
    const wSum = cleanSpears.reduce((a, s) => a + s.prob * s.unitPayout, 0) || 1;
    let rem = attackNotes;
    attackMults = cleanSpears.map((s, idx) => {
      if (idx === cleanSpears.length - 1) return Math.max(1, rem);
      const alloc = Math.max(
        1,
        Math.min(rem - (cleanSpears.length - 1 - idx), Math.round((attackNotes * s.prob * s.unitPayout) / wSum))
      );
      rem -= alloc;
      return alloc;
    });
  }

  // Re-verify exact ceil(C / u_shield) with final total cost C
  if (cleanShield) {
    const curTotalNotes = attackMults.reduce((a, b) => a + b, 0) + cleanShield.exactMult;
    const exactReq = Math.ceil((curTotalNotes * 2) / cleanShield.unitPayout);
    if (exactReq !== cleanShield.exactMult && exactReq < curTotalNotes * 0.45) {
      const diff = exactReq - cleanShield.exactMult;
      if (attackMults[0] - diff >= 1) {
        attackMults[0] -= diff;
        cleanShield.exactMult = exactReq;
      }
    }
    return materializePlanLines(
      [...cleanSpears, cleanShield],
      [...attackMults, cleanShield.exactMult]
    );
  }

  return materializePlanLines(cleanSpears, attackMults);
}

/** 2. 生成 3+1 帕累托精算配单（支持锚定赛事雷达用户所选球队方向，导出兼容别名 generateFiveArchetypes） */
export function generateParetoPortfolio(
  targetMatches,
  budgetYuan,
  stance,
  unlockFullAgg,
  anchorPicks = []
) {
  const cleanBudget = Math.max(20, Math.round((Number(budgetYuan) || 100) / 2) * 2);
  if (!Array.isArray(targetMatches) || targetMatches.length === 0) return [];

  const selected = targetMatches.slice(0, 8);
  const stanceAtomicMap = new Map();
  for (const m of selected) {
    stanceAtomicMap.set(m.id, tiltAtomicProbsByStance(getMatchBaseAtomicProbs(m), m, stance));
  }

  const primaryPoolOf = (m) =>
    m.pools.HAD?.selling !== false && m.pools.HAD?.options?.length >= 2 ? 'HAD' : 'HHAD';

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
    return legs[0] ?? legOf(m, 'HAFU', 'hh');
  };

  const preferredHighProbMainLeg = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) return preferredPrimaryLeg(m);
    const cands = [];
    for (const code of ['HAD', 'HHAD']) {
      const pool = m.pools[code];
      if (!pool || pool.selling === false || !Array.isArray(pool.options)) continue;
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

  const secondaryDisjointLegInPool = (m, primaryLeg) => {
    if (!primaryLeg) return null;
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length >= 2) {
      const samePool = anc
        .filter((a) => a.poolCode === primaryLeg.poolCode && a.optionKey !== primaryLeg.optionKey)
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
    return (
      others.find((o) => o.optionKey === 'd' || o.optionKey === 'hd' || o.optionKey === 'dd') ??
      others[0] ??
      null
    );
  };

  const inferMatchDirection = (m) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const topAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb)[0];
      const k = topAnc.optionKey;
      const lbl = topAnc.optionLabel || k;
      if (topAnc.poolCode === 'HAD') return k === 'a' ? 'away' : k === 'd' ? 'draw' : 'home';
      if (topAnc.poolCode === 'HHAD') {
        const gl = resolveGoalLineNum(m, topAnc.poolName);
        if (k === 'hh') return 'home';
        if (k === 'ha') return 'away';
        return gl < 0 ? 'home' : 'away';
      }
      if (topAnc.poolCode === 'HAFU') {
        return k.endsWith('a') ? 'away' : k.endsWith('d') ? 'draw' : 'home';
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
    const top = preferredPrimaryLeg(m);
    return top?.optionKey === 'a' || top?.optionKey === 'ha' ? 'away' : 'home';
  };

  const anchorBadgeNote = hasUserAnchors
    ? `🎯 已同步赛事雷达已选方向：${Array.from(anchorsByMatch.entries())
        .map(([mid, pks]) => {
          const fm = selected.find((x) => x.id === mid);
          return `${fm?.matchNumStr ?? ''}${fm?.home ?? ''}[${pks.map((p) => p.optionLabel).join('/')}]`;
        })
        .join('、')}`
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
    reasons = [],
    prependWarningReason = null,
  }) => {
    if (!available || !Array.isArray(lines) || lines.length === 0) {
      return {
        key,
        available: false,
        alphaKind: alphaKind ?? 'none',
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
        missOneReturn: null,
        vigPct: 0,
        reasons,
        lines: [],
      };
    }

    const totalCost = lines.reduce((a, l) => a + l.cost, 0);
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
      stanceAtomicMap
    );
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
      savedCash,
      minReturn: jointEval.minPayout,
      maxReturn: jointEval.maxPayout,
      winProb: jointEval.anyWinProb,
      profitProb: jointEval.realProfitProb,
      missOneReturn,
      vigPct,
      reasons: mergedReasons,
      lines,
    };
  };

  // =========================================================================
  // Slot ①: max-profit-prob (🛡️ 稳健保本 · 覆盖态 100% 零假中奖真赚钱率极值)
  // =========================================================================
  let slot1Lines = [];
  let slot1SyntheticUsed = false;
  if (selected.length === 1) {
    const m1 = selected[0];
    const anc = anchorsByMatch.get(m1.id) ?? [];
    const ancSinglePool =
      anc.length > 0 && anc.every((a) => m1.pools[a.poolCode]?.single && a.poolCode === anc[0].poolCode)
        ? anc[0].poolCode
        : null;

    const candidateSets = [];
    if (ancSinglePool) {
      const ancLegs = anc.map((a) => legOf(m1, a.poolCode, a.optionKey)).filter(Boolean);
      candidateSets.push(
        ancLegs.map((lg, idx) => ({
          id: `mp-${idx + 1}`,
          roleLabel: idx === 0 ? '雷达主选铁干' : `防冷保本盾#${idx}`,
          legs: [lg],
        }))
      );
      if (ancLegs.length === 1) {
        const cov = secondaryDisjointLegInPool(m1, ancLegs[0]);
        if (cov) {
          candidateSets.push([
            { id: 'mp-1', roleLabel: '雷达主选铁干', legs: [ancLegs[0]] },
            { id: 'mp-2', roleLabel: '同盘防平保本盾', legs: [cov] },
          ]);
        }
      }
    } else {
      for (const mainCode of ['HAD', 'HHAD']) {
        const pool = m1.pools[mainCode];
        if (pool?.selling !== false && pool?.single && pool?.options?.length >= 2) {
          const sorted = pool.options
            .map((o) => legOf(m1, mainCode, o.key))
            .filter(Boolean)
            .sort((a, b) => b.fairProb - a.fairProb);
          if (sorted.length >= 2) {
            candidateSets.push([
              { id: 'mp-1', roleLabel: '低水主干', legs: [sorted[0]] },
              { id: 'mp-2', roleLabel: '防平铁盾', legs: [sorted[1]] },
            ]);
          }
          if (sorted[0]) {
            candidateSets.push([{ id: 'mp-1', roleLabel: '高胜率独赢主干', legs: [sorted[0]] }]);
          }
        }
      }

      if (candidateSets.length === 0) {
        slot1SyntheticUsed = true;
        const dir = inferMatchDirection(m1);
        if (m1.pools.HAFU?.selling !== false && m1.pools.HAFU?.single) {
          const dirKeys =
            dir === 'away' ? ['aa', 'da'] : dir === 'draw' ? ['dd', 'hd', 'ad'] : ['hh', 'dh'];
          const dirLegs = dirKeys.map((k) => legOf(m1, 'HAFU', k)).filter(Boolean);
          if (dirLegs.length >= 2) {
            candidateSets.push(
              dirLegs.map((lg, idx) => ({
                id: `mp-hafu-${idx + 1}`,
                roleLabel: idx === 0 ? '合成单关·主干' : `合成单关·护盾#${idx}`,
                legs: [lg],
              }))
            );
            const ddLeg = legOf(m1, 'HAFU', 'dd');
            if (ddLeg && !dirKeys.includes('dd')) {
              candidateSets.push([
                ...dirLegs.map((lg, idx) => ({
                  id: `mp-hafu3-${idx + 1}`,
                  roleLabel: idx === 0 ? '合成单关·主干' : '合成单关·次干',
                  legs: [lg],
                })),
                { id: 'mp-hafu3-3', roleLabel: '合成单关·闷平盾', legs: [ddLeg] },
              ]);
            }
          }
        }
        if (m1.pools.TTG?.selling !== false && m1.pools.TTG?.single) {
          const ttgSorted = m1.pools.TTG.options
            .map((o) => legOf(m1, 'TTG', o.key))
            .filter(Boolean)
            .sort((a, b) => b.fairProb - a.fairProb);
          for (const take of [2, 3]) {
            if (ttgSorted.length >= take) {
              candidateSets.push(
                ttgSorted.slice(0, take).map((lg, idx) => ({
                  id: `mp-ttg${take}-${idx + 1}`,
                  roleLabel: `合成单关·进球#${idx + 1}`,
                  legs: [lg],
                }))
              );
            }
          }
        }
        if (m1.pools.CRS?.selling !== false && m1.pools.CRS?.single) {
          const crsSorted = m1.pools.CRS.options
            .map((o) => legOf(m1, 'CRS', o.label))
            .filter(Boolean)
            .sort((a, b) => b.fairProb - a.fairProb);
          if (crsSorted.length >= 3) {
            candidateSets.push(
              crsSorted.slice(0, 3).map((lg, idx) => ({
                id: `mp-crs-${idx + 1}`,
                roleLabel: `合成单关·比分#${idx + 1}`,
                legs: [lg],
              }))
            );
          }
        }
      }
    }

    let bestScore = -Infinity;
    for (const cs of candidateSets) {
      const lines = solveZeroUnderwaterDutching(cs, cleanBudget);
      if (lines.length === 0) continue;
      const totalC = lines.reduce((a, l) => a + l.cost, 0);
      const ev = evaluateTicketsOnQuotientSpace(
        lines.map((l) => ({ ...l, totalPayout: l.returnPayout })),
        totalC,
        selected,
        stanceAtomicMap
      );
      if (ev.underwaterCount > 0) continue;
      const minNetRatio = totalC > 0 ? (ev.minPayout - totalC) / totalC : 0;
      const score = ev.realProfitProb * 100 + minNetRatio * 0.5 + ev.expectedValueRate * 2;
      if (score > bestScore) {
        bestScore = score;
        slot1Lines = lines;
      }
    }
  } else {
    const buildBackboneCandidate = (useHighProbCrossPool) => {
      const prims = selected.map((m) =>
        useHighProbCrossPool ? preferredHighProbMainLeg(m) : preferredPrimaryLeg(m)
      );
      const passCap = Math.min(...prims.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
      const cappedMatches = selected.slice(0, passCap);
      const cappedPrims = prims.slice(0, passCap);

      // Rank matches by uncertainty (highest secondary option probability) to place disjoint cover legs
      const coverRanks = cappedMatches
        .map((m, idx) => ({
          idx,
          sec: secondaryDisjointLegInPool(m, cappedPrims[idx]),
        }))
        .filter((x) => x.sec !== null)
        .sort((a, b) => b.sec.fairProb - a.sec.fairProb);

      const variants = [
        [{ id: 'mp-1', roleLabel: hasUserAnchors ? '雷达主选铁干' : '高胜率稳健铁干', legs: cappedPrims }],
      ];
      if (coverRanks[0]) {
        const alt1 = [...cappedPrims];
        alt1[coverRanks[0].idx] = coverRanks[0].sec;
        variants.push([
          { id: 'mp-1', roleLabel: hasUserAnchors ? '雷达主选铁干' : '正路稳健主干', legs: cappedPrims },
          { id: 'mp-2', roleLabel: '次选零倒贴铁盾', legs: alt1 },
        ]);
        if (coverRanks[1]) {
          const alt2 = [...cappedPrims];
          alt2[coverRanks[1].idx] = coverRanks[1].sec;
          variants.push([
            { id: 'mp-1', roleLabel: hasUserAnchors ? '雷达主选铁干' : '正路稳健主干', legs: cappedPrims },
            { id: 'mp-2', roleLabel: '一号防冷保本盾', legs: alt1 },
            { id: 'mp-3', roleLabel: '二号防平保本盾', legs: alt2 },
          ]);
        }
      }
      return variants;
    };

    const allVariants = [
      ...buildBackboneCandidate(false),
      ...(hasUserAnchors ? [] : buildBackboneCandidate(true)),
    ];
    let bestScore = -Infinity;
    for (const vSpecs of allVariants) {
      const lines = solveZeroUnderwaterDutching(vSpecs, cleanBudget);
      if (lines.length === 0) continue;
      const totalC = lines.reduce((a, l) => a + l.cost, 0);
      const ev = evaluateTicketsOnQuotientSpace(
        lines.map((l) => ({ ...l, totalPayout: l.returnPayout })),
        totalC,
        selected,
        stanceAtomicMap
      );
      if (ev.underwaterCount > 0) continue;
      const minNetRatio = totalC > 0 ? (ev.minPayout - totalC) / totalC : 0;
      const score = ev.realProfitProb * 100 + minNetRatio * 0.5 + ev.expectedValueRate * 2;
      if (score > bestScore) {
        bestScore = score;
        slot1Lines = lines;
      }
    }
  }

  const slot1Plan = packSlot({
    key: 'max-profit-prob',
    shortTab: '🛡️ 稳健保本',
    badge: '🛡️ 稳健保本极值',
    title: '覆盖态零假中奖 · 真赚钱率最大化',
    tagline: '覆盖范围内命中任一组合 100% 净赚 · 彻底杜绝中奖倒贴',
    lines: slot1Lines,
    reasons: [
      slot1SyntheticUsed
        ? '主盘未开单关，已自动跨盘比选最低等效抽水的合成单关入口并精确整数配平'
        : '优先锁定最低抽水主盘入口，采用整数最大最小配平（Max-Min Dutching）最大化真赚钱率',
      '施加覆盖态 100% 零假中奖硬约束，自动裁剪低效长尾累赘项确保中奖必保本',
    ],
  });

  // =========================================================================
  // Slot ②: max-ev-utility (⚖️ 期望效用 · 最小整数倍锁盾 + 裁剪 <=1.45 累赘腿 + 防封顶)
  // =========================================================================
  let evActiveMatches = [...selected];
  const prunedDragMatches = [];
  let anchoredDragWarning = null;

  const isLowOddsMatch = (m) => {
    const prim = preferredPrimaryLeg(m);
    return Boolean(prim && prim.odds <= 1.45);
  };
  const canSingleMainPool = (m) =>
    Boolean(
      (m.pools.HAD?.selling !== false && m.pools.HAD?.single) ||
        (m.pools.HHAD?.selling !== false && m.pools.HHAD?.single)
    );

  if (hasUserAnchors) {
    const ancDrags = selected.filter((m) => {
      const anc = anchorsByMatch.get(m.id);
      if (!anc || anc.length === 0) return false;
      const topAnc = [...anc].sort((a, b) => b.fairProb - a.fairProb)[0];
      return Number(topAnc.odds) <= 1.45;
    });
    if (ancDrags.length > 0) {
      const names = ancDrags
        .map((m) => {
          const topAnc = [...anchorsByMatch.get(m.id)].sort((a, b) => b.fairProb - a.fairProb)[0];
          return `${m.matchNumStr} ${m.home}(@${Number(topAnc.odds).toFixed(2)})`;
        })
        .join('、');
      anchoredDragWarning = `⚠️ 锚定场次含低赔蚊子肉累赘腿【${names}】（水位 ≤ 1.45），串关连乘抽水将侵蚀期望回报，建议回赛事雷达精简提效`;
    }
  } else if (selected.length >= 2) {
    const cleanList = selected.filter((m) => !isLowOddsMatch(m));
    const dragList = selected.filter((m) => isLowOddsMatch(m));

    if (dragList.length > 0) {
      const scoreMatchUtility = (m) => {
        let best = 0;
        for (const code of ['HAD', 'HHAD']) {
          const pool = m.pools[code];
          if (!pool || pool.selling === false) continue;
          for (const o of pool.options ?? []) {
            if (o.odds > 1.45) {
              const lg = legOf(m, code, o.key);
              if (lg && lg.odds * lg.fairProb > best) best = lg.odds * lg.fairProb;
            }
          }
        }
        if (best === 0) {
          const prim = preferredPrimaryLeg(m);
          best = prim ? (prim.odds * prim.fairProb) * 0.9 : 0;
        }
        return best;
      };

      const rankedDrags = [...dragList].sort((a, b) => scoreMatchUtility(b) - scoreMatchUtility(a));

      if (cleanList.length >= 2 || (cleanList.length === 1 && canSingleMainPool(cleanList[0]))) {
        evActiveMatches = cleanList;
        prunedDragMatches.push(...dragList);
      } else if (cleanList.length === 1) {
        // cleanList[0] requires at least 1 partner for 2串1 checkout
        const keepPartner = rankedDrags[0];
        evActiveMatches = selected.filter((m) => m.id === cleanList[0].id || m.id === keepPartner.id);
        prunedDragMatches.push(...rankedDrags.slice(1));
      } else {
        // ALL selected matches have primary odds <= 1.45 -> retain best 1 (if single-capable) or best 2
        const keepCount = canSingleMainPool(rankedDrags[0]) ? 1 : Math.min(2, rankedDrags.length);
        const keepSet = new Set(rankedDrags.slice(0, keepCount).map((m) => m.id));
        evActiveMatches = selected.filter((m) => keepSet.has(m.id));
        prunedDragMatches.push(...selected.filter((m) => !keepSet.has(m.id)));
      }
    }
  }

  // Upgrade non-anchored <= 1.45 match inside evActiveMatches to best > 1.45 HHAD leg if available
  const evPrimaryLegOf = (m) => {
    if (anchorsByMatch.has(m.id)) return preferredPrimaryLeg(m);
    const prim = preferredPrimaryLeg(m);
    if (prim && prim.odds > 1.45) {
      // Also check if another main option has strictly better O*P with reasonable probability (>= 0.28)
      const cands = [prim];
      for (const code of ['HAD', 'HHAD']) {
        const pool = m.pools[code];
        if (!pool || pool.selling === false) continue;
        if (evActiveMatches.length === 1 && !pool.single) continue;
        for (const o of pool.options ?? []) {
          if (o.odds > 1.45) {
            const lg = legOf(m, code, o.key);
            if (lg && lg.fairProb >= 0.30) cands.push(lg);
          }
        }
      }
      cands.sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
      return cands[0];
    }
    // Primary HAD is <= 1.45 -> switch to HHAD > 1.45 if selling & legal
    const hhad = m.pools.HHAD;
    if (
      hhad &&
      hhad.selling !== false &&
      (evActiveMatches.length > 1 || hhad.single) &&
      Array.isArray(hhad.options)
    ) {
      const hhadLegs = hhad.options
        .filter((o) => o.odds > 1.45)
        .map((o) => legOf(m, 'HHAD', o.key))
        .filter(Boolean)
        .sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
      if (hhadLegs[0]) return hhadLegs[0];
    }
    return prim;
  };

  let slot2Lines = [];
  let slot2SplitCapNote = null;

  if (evActiveMatches.length === 1) {
    const em = evActiveMatches[0];
    const anc = anchorsByMatch.get(em.id) ?? [];
    if (anc.length > 0 && anc.every((a) => em.pools[a.poolCode]?.single)) {
      const ancLegs = anc
        .map((a) => legOf(em, a.poolCode, a.optionKey))
        .filter(Boolean)
        .sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
      const shield =
        ancLegs.length >= 2
          ? { id: 'ev-sh', roleLabel: '最小整数倍保本盾', legs: [ancLegs[1]] }
          : secondaryDisjointLegInPool(em, ancLegs[0])
            ? { id: 'ev-sh', roleLabel: '最小整数倍保本盾', legs: [secondaryDisjointLegInPool(em, ancLegs[0])] }
            : null;
      slot2Lines = allocateSpearAndExactShield(
        [{ id: 'ev-sp1', roleLabel: '主攻高性价比箭', legs: [ancLegs[0]] }],
        shield,
        cleanBudget
      );
    } else if (canSingleMainPool(em)) {
      const mainCode =
        em.pools.HAD?.selling !== false && em.pools.HAD?.single ? 'HAD' : 'HHAD';
      const prim = evPrimaryLegOf(em) ?? legOf(em, mainCode, em.pools[mainCode].options[0].key);
      const sec = secondaryDisjointLegInPool(em, prim);
      slot2Lines = allocateSpearAndExactShield(
        [{ id: 'ev-sp1', roleLabel: '主攻高性价比箭', legs: [prim] }],
        sec ? { id: 'ev-sh', roleLabel: '最小整数倍回本盾', legs: [sec] } : null,
        cleanBudget
      );
    } else {
      const dir = inferMatchDirection(em);
      const spA = legOf(em, 'HAFU', dir === 'away' ? 'da' : 'dh');
      const spB = legOf(em, 'HAFU', dir === 'away' ? 'aa' : 'hh');
      const sh = legOf(em, 'HAFU', 'dd');
      slot2Lines = allocateSpearAndExactShield(
        [
          { id: 'ev-sp1', roleLabel: '主攻半平绝杀箭', legs: [spA] },
          { id: 'ev-sp2', roleLabel: '顺向连赢辅助箭', legs: [spB] },
        ],
        sh ? { id: 'ev-sh', roleLabel: '最小整数倍闷平盾', legs: [sh] } : null,
        cleanBudget
      );
    }
  } else {
    const activePrims = evActiveMatches.map(evPrimaryLegOf).filter(Boolean);
    const poolCap = Math.min(...activePrims.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
    let targetPass = Math.min(activePrims.length, poolCap);

    // Statutory Cap-Clipping Guard: split down pass size if raw unit payout > statutorySingleBetCap
    while (targetPass > 1) {
      const subsets = combinationsOfIndices(activePrims.length, targetPass);
      const anyClips = subsets.some((idxs) => {
        const rawU = bankerRoundParlayUnitPayout(idxs.map((i) => activePrims[i].odds));
        return rawU > statutorySingleBetCap(targetPass);
      });
      if (!anyClips) break;
      targetPass -= 1;
    }

    if (targetPass < Math.min(activePrims.length, poolCap)) {
      slot2SplitCapNote = `🛡️ 原 ${Math.min(activePrims.length, poolCap)} 关高赔连乘触发法定单注封顶截断，已自动降阶拆为 ${targetPass === 1 ? '单关' : `${targetPass}串1`} 零损耗实票`;
      if (targetPass === 1) {
        const singleSpecs = activePrims
          .filter((g) => {
            const fm = evActiveMatches.find((x) => x.id === g.matchId);
            return fm?.pools?.[g.poolCode]?.single !== false;
          })
          .slice(0, 4)
          .map((g, idx) => ({ id: `ev-sgl-${idx + 1}`, roleLabel: `防截断单关#${idx + 1}`, legs: [g] }));
        slot2Lines = allocateSpearAndExactShield(
          singleSpecs.length > 0 ? singleSpecs : [{ id: 'ev-sgl-1', roleLabel: '主攻箭', legs: [activePrims[0]] }],
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
      const baseLegs = activePrims.slice(0, targetPass);
      // Build secondary breakeven shield by flipping the match with best secondary cover EV
      const shieldCands = baseLegs
        .map((lg, idx) => {
          const fm = evActiveMatches[idx];
          const sec = secondaryDisjointLegInPool(fm, lg);
          if (!sec) return null;
          const altLegs = [...baseLegs];
          altLegs[idx] = sec;
          const rawU = bankerRoundParlayUnitPayout(altLegs.map((g) => g.odds));
          if (rawU > statutorySingleBetCap(altLegs.length)) return null;
          return {
            idx,
            legs: altLegs,
            score: sec.fairProb * sec.odds,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      const shieldSpec = shieldCands[0]
        ? { id: 'ev-sh', roleLabel: '最小整数倍回本盾', legs: shieldCands[0].legs }
        : null;

      slot2Lines = allocateSpearAndExactShield(
        [{ id: 'ev-sp1', roleLabel: '高性价比主攻箭', legs: baseLegs }],
        shieldSpec,
        cleanBudget
      );
    }
  }

  const slot2Reasons = [];
  if (prunedDragMatches.length > 0) {
    const names = prunedDragMatches
      .map((m) => {
        const p = preferredPrimaryLeg(m);
        return `${m.matchNumStr} ${m.home}(@${Number(p?.odds ?? 1.2).toFixed(2)})`;
      })
      .join('、');
    slot2Reasons.push(
      `✂️ 已自动剔除低赔蚊子肉累赘腿【${names}】（水位 ≤ 1.45），省去负边际效用连乘抽水`
    );
  }
  if (slot2SplitCapNote) slot2Reasons.push(slot2SplitCapNote);
  slot2Reasons.push(
    '回本护盾严格按最小整数倍 ⌈总本金 / 单倍返奖⌉ 锁死（绝不主盾倒挂），剩余筹码 100% 集中主攻高性价比组合'
  );

  const slot2Plan = packSlot({
    key: 'max-ev-utility',
    shortTab: '⚖️ 期望效用',
    badge: '⚖️ 期望效用极值',
    title: '最小整数倍锁盾 · 风险调整效用极值',
    tagline: '精准锁死保本护盾最小注数 · 火力集中高效率主攻组合',
    lines: slot2Lines,
    reasons: slot2Reasons,
    prependWarningReason: anchoredDragWarning,
  });

  // =========================================================================
  // Slot ③: max-cvar-wheel (🧩 容错缩水 · 旋转矩阵 C(v,k,t) 组合覆盖 <=10 张实票)
  // =========================================================================
  let slot3Lines = [];
  let slot3MissOneReturn = 0;
  let slot3DesignLabel = '单场防冷缓冲网';

  const singleCushionLegOf = (m) => {
    const anc = anchorsByMatch.get(m.id) ?? [];
    const singleAnc = anc
      .filter((a) => m.pools[a.poolCode]?.selling !== false && m.pools[a.poolCode]?.single)
      .sort((a, b) => b.fairProb - a.fairProb)[0];
    if (singleAnc) return legOf(m, singleAnc.poolCode, singleAnc.optionKey);

    for (const mainCode of ['HAD', 'HHAD']) {
      const pool = m.pools[mainCode];
      if (pool?.selling !== false && pool?.single && pool?.options?.length > 0) {
        const best = pool.options
          .map((o) => legOf(m, mainCode, o.key))
          .filter(Boolean)
          .sort((a, b) => b.fairProb - a.fairProb)[0];
        if (best) return best;
      }
    }

    const dir = inferMatchDirection(m);
    const subCands = [];
    if (m.pools.HAFU?.selling !== false && m.pools.HAFU?.single) {
      const k = dir === 'away' ? 'aa' : dir === 'draw' ? 'dd' : 'hh';
      const lg = legOf(m, 'HAFU', k);
      if (lg) subCands.push(lg);
    }
    if (m.pools.TTG?.selling !== false && m.pools.TTG?.single) {
      const topTtg = m.pools.TTG.options
        .map((o) => legOf(m, 'TTG', o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb)[0];
      if (topTtg) subCands.push(topTtg);
    }
    subCands.sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb);
    return subCands[0] ?? preferredPrimaryLeg(m);
  };

  if (selected.length === 1) {
    const m1 = selected[0];
    const cushionSpecs = [];
    if (m1.pools.HAD?.selling !== false && m1.pools.HAD?.single) {
      const top2 = m1.pools.HAD.options
        .map((o) => legOf(m1, 'HAD', o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb)
        .slice(0, 2);
      top2.forEach((lg, idx) =>
        cushionSpecs.push({
          id: `cw-1-${idx + 1}`,
          roleLabel: idx === 0 ? '正路防爆主垫' : '防平缓冲垫',
          legs: [lg],
        })
      );
    } else if (m1.pools.HHAD?.selling !== false && m1.pools.HHAD?.single) {
      const top2 = m1.pools.HHAD.options
        .map((o) => legOf(m1, 'HHAD', o.key))
        .filter(Boolean)
        .sort((a, b) => b.fairProb - a.fairProb)
        .slice(0, 2);
      top2.forEach((lg, idx) =>
        cushionSpecs.push({
          id: `cw-1-${idx + 1}`,
          roleLabel: idx === 0 ? '让球正路主垫' : '一球卡盘缓冲垫',
          legs: [lg],
        })
      );
    } else {
      const dir = inferMatchDirection(m1);
      const keys = dir === 'away' ? ['aa', 'da', 'dd'] : ['hh', 'dh', 'dd'];
      keys.forEach((k, idx) => {
        const lg = legOf(m1, 'HAFU', k);
        if (lg) {
          cushionSpecs.push({
            id: `cw-1-${idx + 1}`,
            roleLabel: idx === 0 ? '上半领先赢' : idx === 1 ? '半平绝杀垫' : '全场闷平兜底',
            legs: [lg],
          });
        }
      });
    }
    slot3Lines = solveZeroUnderwaterDutching(cushionSpecs, cleanBudget);
    if (slot3Lines.length === 0) {
      slot3Lines = materializePlanLines(cushionSpecs.slice(0, 2), [
        Math.max(1, Math.floor(cleanBudget / 4)),
        Math.max(1, Math.floor(cleanBudget / 4)),
      ]);
    }
    slot3MissOneReturn = slot3Lines.length
      ? Math.min(...slot3Lines.map((l) => l.returnPayout))
      : 0;
  } else if (selected.length === 2) {
    slot3DesignLabel = '2串1主干 + 双路单关回血垫';
    const [mA, mB] = selected;
    const legA = preferredHighProbMainLeg(mA);
    const legB = preferredHighProbMainLeg(mB);
    const sglA = singleCushionLegOf(mA);
    const sglB = singleCushionLegOf(mB);
    const blockSpecs = [];
    if (sglA && mA.pools[sglA.poolCode]?.single) {
      blockSpecs.push({ id: 'cw-2-s1', roleLabel: `防错回血垫① (${mA.matchNumStr}单关)`, legs: [sglA] });
    }
    if (sglB && mB.pools[sglB.poolCode]?.single) {
      blockSpecs.push({ id: 'cw-2-s2', roleLabel: `防错回血垫② (${mB.matchNumStr}单关)`, legs: [sglB] });
    }
    const mainKicker = { id: 'cw-2-all', roleLabel: '连红主干·2串1', legs: [legA, legB] };
    // Allocate ~40% to 2串1 kicker and ~60% equalized across single cushions for strong miss-1 floor + upside
    const totalNotes = Math.max(blockSpecs.length + 1, Math.floor(cleanBudget / 2));
    if (blockSpecs.length > 0) {
      const kickerNotes = Math.max(1, Math.round(totalNotes * 0.38));
      const cushionBudget = Math.max(blockSpecs.length * 2, (totalNotes - kickerNotes) * 2);
      const solvedCushions = allocateWheelMeanCvar(
        blockSpecs,
        null,
        selected.map((m) => m.id),
        cushionBudget
      );
      const allSpecs = [mainKicker, ...blockSpecs];
      const allMults = [kickerNotes, ...solvedCushions.lines.map((l) => l.multiple)];
      slot3Lines = materializePlanLines(allSpecs, allMults);
      const missPayouts = selected.map((m) =>
        Number(
          slot3Lines
            .filter((l) => !l.legs.some((g) => g.matchId === m.id))
            .reduce((a, l) => a + l.returnPayout, 0)
            .toFixed(2)
        )
      );
      slot3MissOneReturn = Math.min(...missPayouts);
    } else {
      slot3Lines = materializePlanLines([mainKicker], [totalNotes]);
      slot3MissOneReturn = 0;
    }
  } else {
    const v = selected.length;
    const wheelLegs = selected.map(preferredHighProbMainLeg);
    const poolCap = Math.min(...wheelLegs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
    const designs = (COVERING_WHEEL_DESIGNS[v] ?? []).filter(
      (d) => d.maxK <= poolCap && d.blocks.length <= 10
    );

    let bestObj = -Infinity;
    const matchIds = selected.map((m) => m.id);

    for (const d of designs) {
      const blockSpecs = d.blocks.map((idxs, bIdx) => ({
        id: `cw-${bIdx + 1}`,
        roleLabel: `缩水组#${bIdx + 1} (${idxs.map((i) => `第${i + 1}场`).join('×')})`,
        legs: idxs.map((i) => wheelLegs[i]),
      }));

      const canAddKicker =
        v <= poolCap &&
        d.blocks.length + 1 <= 10 &&
        bankerRoundParlayUnitPayout(wheelLegs.map((g) => g.odds)) <= statutorySingleBetCap(v);
      const kickerCandidates = canAddKicker
        ? [null, { id: 'cw-all', roleLabel: `${v}场全红冲顶串`, legs: wheelLegs }]
        : [null];

      for (const kicker of kickerCandidates) {
        const cand = allocateWheelMeanCvar(blockSpecs, kicker, matchIds, cleanBudget);
        const totalC = cand.lines.reduce((a, l) => a + l.cost, 0);
        if (totalC <= 0) continue;
        const ev = evaluateTicketsOnQuotientSpace(
          cand.lines.map((l) => ({ ...l, totalPayout: l.returnPayout })),
          totalC,
          selected,
          stanceAtomicMap
        );
        // Compute tail CVaR_0.35 across state space
        const missProb = Math.max(0, 1 - ev.anyWinProb);
        let remAlpha = 0.35;
        let tailReturnSum = 0;
        const takeZero = Math.min(remAlpha, missProb);
        remAlpha -= takeZero;
        for (const c of ev.combos) {
          if (remAlpha <= 1e-12) break;
          const take = Math.min(remAlpha, c.prob);
          tailReturnSum += take * c.totalPayout;
          remAlpha -= take;
        }
        const cvar35 = tailReturnSum / 0.35;

        const score =
          0.55 * (cand.missOneReturn / totalC) +
          0.25 * (cvar35 / totalC) +
          0.20 * (ev.expectedReturn / totalC);
        if (score > bestObj) {
          bestObj = score;
          slot3Lines = cand.lines;
          slot3MissOneReturn = cand.missOneReturn;
          slot3DesignLabel = `${d.name} 旋转矩阵缩水 (${cand.lines.length}张实票)`;
        }
      }
    }
  }

  const slot3Plan = packSlot({
    key: 'max-cvar-wheel',
    shortTab: '🧩 容错缩水',
    badge: '🧩 容错缩水极值',
    title: selected.length >= 3 ? slot3DesignLabel : selected.length === 2 ? '2串1主干 + 单关回血垫' : '单场多路防冷缓冲网',
    tagline: null,
    lines: slot3Lines,
    missOneReturn: slot3MissOneReturn,
    reasons: [
      selected.length >= 3
        ? `采用组合覆盖设计 ${slot3DesignLabel}（严控 ≤ 10 张独立实票），省去冗余全包注数并 100% 锁定错 1 场保底回血 ¥${slot3MissOneReturn.toFixed(2)}`
        : '配置低抽水缓冲回血垫，最大化逆境尾部条件保底回报（Mean-CVaR）',
      '全中时多张覆盖子票叠加派奖，兼顾防黑韧性与满贯上限',
    ],
  });
  if (slot3Plan.available) {
    slot3Plan.tagline =
      selected.length >= 2
        ? `黑掉1场保底拿回 ¥${slot3MissOneReturn.toFixed(1)} · 全中叠加拿回 ¥${slot3Plan.maxReturn.toFixed(1)}`
        : `命中缓冲网保底拿回 ¥${slot3Plan.minReturn.toFixed(1)} ~ 最高 ¥${slot3Plan.maxReturn.toFixed(1)}`;
  }

  // =========================================================================
  // Slot ④: alpha-radar (⚡ 错价雷达 · 经验贝叶斯收缩 + 宁缺毋滥空仓纪律)
  // =========================================================================
  const rawAlphaPool = [];
  for (const m of selected) {
    const scan = scanMatchAlphaCandidates(m, hasUserAnchors ? anchorsByMatch.get(m.id) : null);
    for (const c of scan.candidates) {
      rawAlphaPool.push(c);
    }
  }
  rawAlphaPool.sort((a, b) => b.delta - a.delta || b.expectedReturn - a.expectedReturn);

  const aggBudget = unlockFullAgg
    ? cleanBudget
    : Math.min(cleanBudget, Math.max(16, Math.round((cleanBudget * 0.36) / 4) * 4));

  let alphaSpecs = [];
  let selectedAlphaCands = [];

  if (selected.length === 1) {
    // Single-match checkout legality gate: ONLY single-capable options can check out alone at a Sporttery shop!
    const legalSingles = rawAlphaPool.filter((c) => c.singleAllowed);
    if (legalSingles.length > 0) {
      // Pick top 1~2 disjoint options in the best pool or top 2 distinct single options
      const chosen = legalSingles.slice(0, 2);
      selectedAlphaCands = chosen;
      alphaSpecs = chosen.map((c, idx) => ({
        id: `ar-${idx + 1}`,
        roleLabel: c.isPositiveEv ? `正期望洼地单狙#${idx + 1}` : `跨盘低水差洼地#${idx + 1}`,
        legs: [legOf(c.match, c.poolCode, c.optionKey)],
        weight: Math.max(0.01, c.delta + (c.isPositiveEv ? 0.05 : 0)),
      }));
    }
  } else if (rawAlphaPool.length > 0) {
    // Group best alpha candidate per match
    const bestAlphaByMatch = [];
    const seenMid = new Set();
    for (const c of rawAlphaPool) {
      if (!seenMid.has(c.matchId)) {
        seenMid.add(c.matchId);
        bestAlphaByMatch.push(c);
      }
    }

    // 1. Add top 1~2 single-capable alpha tickets directly (zero parlay vig compound loss!)
    const topSingles = rawAlphaPool.filter((c) => c.singleAllowed).slice(0, 2);
    for (const c of topSingles) {
      alphaSpecs.push({
        id: `ar-sgl-${alphaSpecs.length + 1}`,
        roleLabel: c.isPositiveEv ? '跨盘+EV单关直击' : '跨盘错价单关洼地',
        legs: [legOf(c.match, c.poolCode, c.optionKey)],
        weight: Math.max(0.02, c.delta + (c.isPositiveEv ? 0.06 : 0.01)),
      });
      selectedAlphaCands.push(c);
    }

    // 2. If >= 2 matches have alpha candidates, or if top alpha candidate is non-single (needs 2串1 partner!), build 2~4 leg alpha parlay
    if (bestAlphaByMatch.length >= 2) {
      const cap = Math.min(
        4,
        ...bestAlphaByMatch.slice(0, 3).map((c) => POOL_MAX_PASS[c.poolCode] ?? 8)
      );
      if (cap >= 2) {
        const comboCands = bestAlphaByMatch.slice(0, Math.min(3, cap));
        const comboLegs = comboCands
          .map((c) => legOf(c.match, c.poolCode, c.optionKey))
          .filter(Boolean);
        // Keep selected match order
        comboLegs.sort(
          (a, b) =>
            selected.findIndex((m) => m.id === a.matchId) -
            selected.findIndex((m) => m.id === b.matchId)
        );
        if (
          comboLegs.length >= 2 &&
          bankerRoundParlayUnitPayout(comboLegs.map((g) => g.odds)) <=
            statutorySingleBetCap(comboLegs.length)
        ) {
          alphaSpecs.push({
            id: `ar-par-${alphaSpecs.length + 1}`,
            roleLabel: `${comboLegs.length}场跨盘错价共振串`,
            legs: comboLegs,
            weight: Math.max(0.015, comboCands.reduce((a, c) => a + c.delta, 0) * 0.5),
          });
          selectedAlphaCands.push(...comboCands);
        }
      }
    } else if (alphaSpecs.length === 0 && bestAlphaByMatch.length === 1 && !bestAlphaByMatch[0].singleAllowed) {
      // Non-single alpha option paired with highest-efficiency anchor leg on another selected match
      const alphaC = bestAlphaByMatch[0];
      const partnerMatches = selected
        .filter((m) => m.id !== alphaC.matchId)
        .map((m) => ({ m, leg: evPrimaryLegOf(m) }))
        .filter((x) => x.leg)
        .sort((a, b) => b.leg.odds * b.leg.fairProb - a.leg.odds * a.leg.fairProb);
      if (partnerMatches[0]) {
        const pairLegs = [
          legOf(alphaC.match, alphaC.poolCode, alphaC.optionKey),
          partnerMatches[0].leg,
        ].sort(
          (a, b) =>
            selected.findIndex((m) => m.id === a.matchId) -
            selected.findIndex((m) => m.id === b.matchId)
        );
        alphaSpecs.push({
          id: 'ar-par-1',
          roleLabel: '跨盘洼地配胆·2串1',
          legs: pairLegs,
          weight: Math.max(0.02, alphaC.delta),
        });
        selectedAlphaCands.push(alphaC);
      }
    }
  }

  let slot4Plan;
  if (alphaSpecs.length === 0) {
    const emptyMsg = `当前所选场次五池定价严密，无跨盘错价洼地 · 建议空仓立省 ¥${cleanBudget}，或采用前 3 档主方案`;
    slot4Plan = packSlot({
      key: 'alpha-radar',
      available: false,
      alphaKind: 'none',
      emptyReason: emptyMsg,
      shortTab: '⚡ 错价雷达',
      badge: '⚡ 跨盘真错价雷达 · 空仓',
      title: '当前盘面定价严密 · 建议空仓省钱',
      tagline: `已替你拦截强凑废单 · 全额立省 ¥${cleanBudget} 本金`,
      lines: [],
      savedCash: cleanBudget,
      reasons: [
        emptyMsg,
        '细分玩法经经验贝叶斯收缩校准后均未跑赢同场最低抽水主盘 ≥ +3.0%，严守宁缺毋滥客观纪律',
      ],
    });
  } else {
    const targetNotes = Math.max(alphaSpecs.length, Math.floor(aggBudget / 2));
    const wSum = alphaSpecs.reduce((a, s) => a + s.weight, 0) || 1;
    let rem = targetNotes - alphaSpecs.length;
    const mults = alphaSpecs.map(() => 1);
    for (let i = 0; i < alphaSpecs.length && rem > 0; i++) {
      const add =
        i === alphaSpecs.length - 1
          ? rem
          : Math.min(rem, Math.round(((targetNotes - alphaSpecs.length) * alphaSpecs[i].weight) / wSum));
      mults[i] = Math.min(999, mults[i] + Math.max(0, add));
      rem -= Math.max(0, add);
    }
    if (rem > 0) mults[0] = Math.min(999, mults[0] + rem);

    const alphaLines = materializePlanLines(alphaSpecs, mults);
    const actualSpent = alphaLines.reduce((a, l) => a + l.cost, 0);
    const savedCash = Math.max(0, cleanBudget - actualSpent);
    const hasPosEv = selectedAlphaCands.some((c) => c.isPositiveEv);
    const bestCand = selectedAlphaCands[0];
    const alphaKind = hasPosEv ? 'positive-ev' : 'relative-alpha';

    slot4Plan = packSlot({
      key: 'alpha-radar',
      available: true,
      alphaKind,
      shortTab: '⚡ 错价雷达',
      badge: hasPosEv
        ? '🔥 跨盘绝对正期望 (+EV)'
        : `💎 跨盘低抽水洼地 (较主盘少亏 ${(bestCand.delta * 100).toFixed(1)}%)`,
      title: hasPosEv
        ? '跨盘调水滞后 · 绝对正期望 (+EV) 狙击'
        : `跨盘低抽水洼地 (较主盘少亏 +${(bestCand.delta * 100).toFixed(1)}%)`,
      tagline: unlockFullAgg
        ? `已解锁全额仓位 ¥${actualSpent} 狙击真实跨盘正偏离`
        : `36% 轻仓护本垫：仅动用 ¥${actualSpent} 狙击真洼地（立省 ¥${savedCash} 护本）`,
      lines: alphaLines,
      savedCash,
      reasons: [
        hasPosEv
          ? `检出【${bestCand.match.matchNumStr} ${bestCand.poolName}·${bestCand.optionLabel}@${bestCand.odds.toFixed(2)}】收缩校准期望返还 ${(bestCand.expectedReturn * 100).toFixed(1)}% (> 100% 绝对正期望)`
          : `检出【${bestCand.match.matchNumStr} ${bestCand.poolName}·${bestCand.optionLabel}@${bestCand.odds.toFixed(2)}】跑赢同场主盘基准 +${(bestCand.delta * 100).toFixed(1)}%（≥ +3.0% 激活门禁）`,
        unlockFullAgg
          ? '已手动解锁全额仓位，请严格配合每日止损护栏控制波动'
          : `默认开启 36% 轻仓护栏，保住 ¥${savedCash} 现金储备抵御高赔方差`,
      ],
    });
  }

  return [slot1Plan, slot2Plan, slot3Plan, slot4Plan];
}

export const generateFiveArchetypes = generateParetoPortfolio;

function parseKickoffMinutes(hhmm) {
  const [hStr, mStr] = String(hhmm || '20:00').split(':');
  const h = Number(hStr) || 0;
  const min = Number(mStr) || 0;
  const normalizedH = h < 12 ? h + 24 : h;
  return normalizedH * 60 + min;
}

function parseMatchDatePrefixMinutes(matchId) {
  const m = /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[-_]\d+|\d{3})?$/.exec(
    String(matchId || '')
  );
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dy = Number(m[3]);
  const ts = Date.UTC(yr, mo, dy);
  return Number.isFinite(ts) ? Math.round(ts / 60_000) : null;
}

function getSellingPoolOption(pool, key) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options)) return null;
  const found = pool.options.find((o) => o.key === key && Number(o.odds) > 0);
  return found ?? null;
}

function resolveComplementaryLateHedge(late, latePicks) {
  if (!Array.isArray(latePicks) || latePicks.length === 0) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr || ''} 未包含有效选号，无法构建互补反向对冲`,
    };
  }

  const latePools = Array.from(new Set(latePicks.map((p) => p.poolCode)));
  const nonCompPool = latePools.find((c) => c === 'TTG' || c === 'CRS' || c === 'HAFU');
  if (nonCompPool) {
    const poolTitle =
      nonCompPool === 'TTG' ? '总进球' : nonCompPool === 'CRS' ? '比分' : '半全场';
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 所选为【${poolTitle}】玩法，属局部赛果分支，无法通过胜平负或让球盘构成 100% 无死角互补对冲`,
    };
  }

  if (latePools.length !== 1 || (latePools[0] !== 'HAD' && latePools[0] !== 'HHAD')) {
    return {
      ok: false,
      reason: `末场 ${late.matchNumStr} 含跨玩法混合选项，无法构建 100% 无死角互补反向盘`,
    };
  }

  const poolCode = latePools[0];
  const pickedKeys = new Set(latePicks.map((p) => p.optionKey));
  const hadPool = late.pools?.HAD;
  const hhadPool = late.pools?.HHAD;
  const goalLineNum = Number(hhadPool?.goalLine ?? '-1');
  const goalLineStr =
    hhadPool?.goalLine ?? (goalLineNum > 0 ? `+${goalLineNum}` : String(goalLineNum));

  const pickBest = (candidates) => {
    const valid = candidates.filter((c) => c && Number.isFinite(c.odds) && c.odds > 0);
    if (valid.length === 0) return null;
    valid.sort((a, b) => b.odds - a.odds || Number(a.isPair) - Number(b.isPair));
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
          odds: 1 / (1 / opt1.odds + 1 / opt2.odds),
          isPair: true,
        }
      : null;

  if (poolCode === 'HAD') {
    const validHadKeys = ['h', 'd', 'a'].filter((k) => pickedKeys.has(k));
    if (validHadKeys.length !== pickedKeys.size || validHadKeys.length === 0) {
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
      const remKey = ['h', 'd', 'a'].find((k) => !pickedKeys.has(k));
      const remOpt = getSellingPoolOption(hadPool, remKey);
      const best = makeSingleCand(remOpt, '胜平负');
      return best
        ? { ok: true, candidate: best }
        : {
            ok: false,
            reason: `末场 ${late.matchNumStr} 缺少在售的胜平负互补第 3 项，无法无死角锁利`,
          };
    }

    const singleKey = validHadKeys[0];
    const hadH = getSellingPoolOption(hadPool, 'h');
    const hadD = getSellingPoolOption(hadPool, 'd');
    const hadA = getSellingPoolOption(hadPool, 'a');
    let best = null;
    if (singleKey === 'h') {
      const hhadHa = goalLineNum === -1 ? getSellingPoolOption(hhadPool, 'ha') : null;
      best = pickBest([
        makeSingleCand(hhadHa, '让球(-1)'),
        makePairCand(hadD, hadA, '胜平负'),
      ]);
    } else if (singleKey === 'a') {
      const hhadHh = goalLineNum === 1 ? getSellingPoolOption(hhadPool, 'hh') : null;
      best = pickBest([
        makeSingleCand(hhadHh, '让球(+1)'),
        makePairCand(hadH, hadD, '胜平负'),
      ]);
    } else if (singleKey === 'd') {
      best = makePairCand(hadH, hadA, '胜平负');
    }

    return best
      ? { ok: true, candidate: best }
      : {
          ok: false,
          reason: `末场 ${late.matchNumStr} 缺少在售的 100% 互补反向盘口，无法无死角对冲`,
        };
  }

  const validHhadKeys = ['hh', 'hd', 'ha'].filter((k) => pickedKeys.has(k));
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
    const remKey = ['hh', 'hd', 'ha'].find((k) => !pickedKeys.has(k));
    const remOpt = getSellingPoolOption(hhadPool, remKey);
    const best = makeSingleCand(remOpt, poolTag);
    return best
      ? { ok: true, candidate: best }
      : {
          ok: false,
          reason: `末场 ${late.matchNumStr} 缺少在售的${poolTag}互补第 3 项，无法无死角锁利`,
        };
  }

  const singleKey = validHhadKeys[0];
  const otherKeys = ['hh', 'hd', 'ha'].filter((k) => k !== singleKey);
  const opt1 = getSellingPoolOption(hhadPool, otherKeys[0]);
  const opt2 = getSellingPoolOption(hhadPool, otherKeys[1]);
  let crossSingle = null;
  if (goalLineNum === -1 && singleKey === 'ha') {
    crossSingle = makeSingleCand(getSellingPoolOption(hadPool, 'h'), '胜平负');
  } else if (goalLineNum === 1 && singleKey === 'hh') {
    crossSingle = makeSingleCand(getSellingPoolOption(hadPool, 'a'), '胜平负');
  }
  const best = pickBest([crossSingle, makePairCand(opt1, opt2, poolTag)]);
  return best
    ? { ok: true, candidate: best }
    : {
        ok: false,
        reason: `末场 ${late.matchNumStr} 缺少在售的 100% 互补反向盘口，无法无死角对冲`,
      };
}

function extractPlanEffectivePicks(appliedPlan) {
  if (!Array.isArray(appliedPlan?.lines) || appliedPlan.lines.length === 0) return null;
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
      .join('|');
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
    Array.from(s).sort().join(',')
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
export function computeProOrderInsights(picks, report, matches, appliedPlan = null) {
  const planPicks = extractPlanEffectivePicks(appliedPlan);
  const effectivePicks = planPicks && planPicks.length > 0 ? planPicks : picks;
  const matchIds = Array.from(new Set(effectivePicks.map((p) => p.matchId)));
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
    const isPureSinglePass =
      !Array.isArray(report?.activePassSizes) ||
      report.activePassSizes.length === 0 ||
      report.activePassSizes.every((s) => s === 1);

    if (report?.canCheckout !== true) {
      hedge.reason =
        report?.ruleBlockReason || '当前选单不满足合法出票条件，暂无法启用早晚场时间差对冲锁利';
    } else if (isPureSinglePass) {
      hedge.reason = '当前为纯单关独立计奖模式，各场互不串连，无需早晚场补单对冲锁利';
    } else {
      const useDatePrefix = pickedMatches.every(
        (m) => parseMatchDatePrefixMinutes(m.id) !== null
      );
      const timeMinutesOf = (m) =>
        (useDatePrefix ? parseMatchDatePrefixMinutes(m.id) ?? 0 : 0) +
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
          ? '同时间段开球'
          : hrs > 0
            ? `${hrs}小时${mins > 0 ? `${mins}分` : ''}`
            : `${mins}分`;
      const earlyMatchTitle = `${penultimate.matchNumStr} ${penultimate.home}vs${penultimate.away}`;
      const lateMatchTitle = `${late.matchNumStr} ${late.home}vs${late.away}`;

      if (gap < 110) {
        hedge = {
          ...hedge,
          available: false,
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
        const planConsistency = validatePlanLateHedgeConsistency(appliedPlan, late);
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
                  new Set(c.legs.map((g) => g.matchId)).size === pickedMatches.length
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
          const rawHedgeMoney = targetReturn / oppOdds;
          const minStake = bestCand.isPair ? 4 : 2;
          const hedgeCost = Math.max(minStake, Math.round(rawHedgeMoney / 2) * 2);
          const lockedNetProfit = Number(
            (Math.min(targetReturn, hedgeCost * oppOdds) - report.totalCost - hedgeCost).toFixed(2)
          );

          hedge = {
            available: true,
            gapMinutes: gap,
            gapText,
            earlyMatchTitle,
            lateMatchTitle,
            earlyKickoff: penultimate.kickoff,
            lateKickoff: late.kickoff,
            oppositeLabel: bestCand.label,
            oppositeOdds: oppOdds,
            hedgeCost,
            lockedNetProfit,
            reason:
              sortedByTime.length >= 3
                ? `前 ${sortedByTime.length - 1} 场最晚(${penultimate.kickoff})完场后距末场(${late.kickoff})仍有 ${gapText} 窗口！若前序 ${sortedByTime.length - 1} 关全红，补买 ¥${hedgeCost} 互补反向盘即可 100% 无死角提前锁利！`
                : `早场(${penultimate.kickoff})完场后距晚场(${late.kickoff})间隔 ${gapText}！若第一关顺利红单，补买 ¥${hedgeCost} 互补反向盘即可 100% 无死角提前锁利！`,
          };
        }
      }
    }
  }

  let weakestLink = null;
  if (pickedMatches.length >= 2) {
    const perMatchProb = pickedMatches.map((m) => {
      const mp = effectivePicks.filter((p) => p.matchId === m.id);
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
    const mpicks = effectivePicks.filter((p) => p.matchId === m.id);
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

  const rawUnits = sorted.map((c) =>
    bankerRoundParlayUnitPayout((c.legs ?? []).map((p) => Number(p.odds)))
  );
  const cappedUnits = sorted.map((c, idx) => {
    const legCount = c.legs?.length ?? manualReport.matchCount;
    const cap = statutorySingleBetCap(legCount);
    const raw = rawUnits[idx] > 0 ? rawUnits[idx] : c.unitPayout;
    return Math.min(cap, raw);
  });
  const isCapClipped = sorted.map((c, idx) => {
    const legCount = c.legs?.length ?? manualReport.matchCount;
    return rawUnits[idx] > statutorySingleBetCap(legCount);
  });
  const hasUnclippedLine = isCapClipped.some((clipped) => !clipped);

  let mults = [];
  if (optMode === 'equal' || k === 1) {
    const invSum = cappedUnits.reduce((acc, u) => acc + 1 / Math.max(0.5, u), 0);
    mults = cappedUnits.map((u, idx) =>
      isCapClipped[idx] && hasUnclippedLine
        ? 1
        : Math.max(1, Math.round((totalTickets * (1 / Math.max(0.5, u))) / invSum))
    );
  } else if (optMode === 'hot-first') {
    mults = cappedUnits.map((u, idx) =>
      idx === 0 ? 1 : Math.max(1, Math.ceil(targetStake / Math.max(2.02, u)))
    );
    const shieldSum = mults.slice(1).reduce((a, m) => a + m, 0);
    mults[0] =
      isCapClipped[0] && hasUnclippedLine
        ? 1
        : Math.max(
            Math.ceil(((shieldSum + 2) * 2) / Math.max(2.02, cappedUnits[0])) + 2,
            totalTickets - shieldSum
          );
  } else {
    mults = cappedUnits.map((u, idx) =>
      idx === k - 1 ? 1 : Math.max(1, Math.ceil(targetStake / Math.max(2.02, u)))
    );
    const shieldSum = mults.slice(0, k - 1).reduce((a, m) => a + m, 0);
    if (isCapClipped[k - 1] && hasUnclippedLine) {
      mults[k - 1] = 1;
      const unclippedIdx = isCapClipped.findIndex((clipped) => !clipped);
      const rem = Math.max(0, totalTickets - shieldSum - 1);
      if (unclippedIdx >= 0 && rem > 0) {
        mults[unclippedIdx] = Math.min(99, mults[unclippedIdx] + rem);
      }
    } else {
      mults[k - 1] = Math.max(
        Math.ceil(((shieldSum + 2) * 2) / Math.max(2.02, cappedUnits[k - 1])) + 2,
        totalTickets - shieldSum
      );
    }
  }

  mults = repairUnderwaterMultiples(mults, cappedUnits, manualReport.effectiveOdds > 1.02);
  if (hasUnclippedLine) {
    mults = mults.map((m, idx) => (isCapClipped[idx] ? 1 : m));
  }

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

    const rawBeforeCap = bankerRoundParlayUnitPayout(fullLegs.map((p) => Number(p.odds)));
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
    desc: `${l.roleLabel}(${l.multiple}倍) · ${l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join('×')}`,
    legs: l.legs,
    multiple: l.multiple,
    cost: l.cost,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: l.cappedClipped ?? 0,
  }));
  const jointEval = evaluateTicketsOnQuotientSpace(ticketRowsForEval, actualTotal, matches);
  const { vigPct } = computeCapitalWeightedVig(lines, matches);

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
    key: 'max-profit-prob',
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
    missOneReturn: null,
    vigPct,
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
    const cap = statutorySingleBetCap(l.legs.length);
    const unitBeforeCap = bankerRoundParlayUnitPayout(l.legs.map((g) => Number(g.odds)));
    const effectiveUnit = Math.min(cap, Number(l.unitPayout));
    const cappedClipped =
      unitBeforeCap > cap
        ? Math.max(0, Number(((unitBeforeCap - effectiveUnit) * mult).toFixed(2)))
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

function buildSandboxAdjustedPicks(picks, matches, simVoidFirstMatch, subjectiveDeltaPct) {
  const firstMid = picks[0]?.matchId;
  const byMatch = new Map();
  for (const pk of picks) {
    const arr = byMatch.get(pk.matchId) ?? [];
    arr.push(pk);
    byMatch.set(pk.matchId, arr);
  }

  const shiftedAtomicByMatch = new Map();
  for (const [mid, mPicks] of byMatch.entries()) {
    const fm = Array.isArray(matches) ? matches.find((x) => x.id === mid) : null;
    const gl = resolveGoalLineNum(fm, mPicks[0]?.poolName);
    const poolCodes = Array.from(new Set(mPicks.map((p) => p.poolCode)));
    let baseAtomic = fm
      ? getMatchBaseAtomicProbs(fm, poolCodes)
      : new Float64Array(NEUTRAL_ATOMIC_PROBS);
    if (!fm) {
      for (const pCode of poolCodes) {
        const pseudoOpts = mPicks
          .filter((p) => p.poolCode === pCode)
          .map((p) => ({ key: p.optionKey, label: p.optionLabel, fairProb: p.fairProb }));
        baseAtomic = alignAtomicProbsToPoolOptions(baseAtomic, pCode, pseudoOpts, gl);
      }
    }
    const shifted = tiltAtomicProbsBySubjectiveDelta(baseAtomic, mPicks, gl, subjectiveDeltaPct);
    shiftedAtomicByMatch.set(mid, { shifted, gl, fm });
  }

  return picks.map((pk) => {
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
    const odds = simVoidFirstMatch && pk.matchId === firstMid && baseOdds > 0 ? 1.0 : baseOdds;
    const prob = ctx
      ? sumOptionProbOnAtomic(ctx.shifted, pk.poolCode, pk.optionKey, pk.optionLabel, ctx.gl)
      : Number(pk.fairProb) || 0.25;
    return {
      ...pk,
      singleAllowed: pool ? Boolean(pool.single) : Boolean(pk.singleAllowed),
      odds,
      fairProb: prob > 0 ? prob : Number(pk.fairProb) || 0.02,
    };
  });
}

function computeLineStatutoryPayout(legOdds, multiple) {
  const mult = Math.max(1, Math.min(999, Math.round(Number(multiple) || 1)));
  const unitBeforeCap = bankerRoundParlayUnitPayout(legOdds);
  const cap = statutorySingleBetCap(legOdds.length);
  const unitPayout = Math.min(cap, unitBeforeCap);
  const cappedClipped = Math.max(0, Number(((unitBeforeCap - unitPayout) * mult).toFixed(2)));
  const returnPayout = Number((unitPayout * mult).toFixed(2));
  return { mult, cost: mult * 2, unitBeforeCap, cap, unitPayout, cappedClipped, returnPayout };
}

function applySandboxToPlan(
  basePlan,
  matches,
  picks,
  simVoidFirstMatch,
  subjectiveDeltaPct,
  { isArchetype = false, hasFrozenSnapshot = false, stance = 'objective', manualReport = null } = {}
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
    boardFirstMid ??
    (picks[0]?.matchId && planMatchIds.has(picks[0].matchId)
      ? picks[0].matchId
      : basePlan.lines[0]?.legs[0]?.matchId);

  const legsByMatch = new Map();
  for (const l of basePlan.lines) {
    for (const lg of l.legs) {
      if (!lg?.matchId) continue;
      const arr = legsByMatch.get(lg.matchId) ?? [];
      if (!arr.some((x) => x.poolCode === lg.poolCode && x.optionKey === lg.optionKey)) {
        arr.push(lg);
      }
      legsByMatch.set(lg.matchId, arr);
    }
  }

  const planAtomicByMatch = new Map();
  for (const [mid, mLegs] of legsByMatch.entries()) {
    const fm = Array.isArray(matches) ? matches.find((x) => x.id === mid) : null;
    const gl = resolveGoalLineNum(fm, mLegs.find((x) => x.poolCode === 'HHAD')?.poolName);
    const poolCodes = Array.from(new Set(mLegs.map((g) => g.poolCode)));
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
      baseAtomic = fm ? getMatchBaseAtomicProbs(fm, poolCodes) : new Float64Array(NEUTRAL_ATOMIC_PROBS);
      for (const pCode of poolCodes) {
        const pseudoOpts = mLegs
          .filter((g) => g.poolCode === pCode)
          .map((g) => ({ key: g.optionKey, label: g.optionLabel, fairProb: g.fairProb }));
        baseAtomic = alignAtomicProbsToPoolOptions(baseAtomic, pCode, pseudoOpts, gl);
      }
    } else {
      baseAtomic = getMatchBaseAtomicProbs(fm, poolCodes);
      if (isArchetype && !hasFrozenSnapshot) {
        baseAtomic = tiltAtomicProbsByStance(baseAtomic, fm, stance);
      }
    }

    const shifted = tiltAtomicProbsBySubjectiveDelta(baseAtomic, mLegs, gl, subjectiveDeltaPct);
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
            : Number(lg.odds) || 1.0;
      const odds = simVoidFirstMatch && lg.matchId === firstMid && baseOdds > 0 ? 1.0 : baseOdds;
      const fairProb = ctx
        ? sumOptionProbOnAtomic(ctx.shifted, lg.poolCode, lg.optionKey, lg.optionLabel, ctx.gl)
        : Number(lg.fairProb) || 0.25;
      return {
        ...lg,
        odds,
        fairProb: fairProb > 0 ? fairProb : Number(lg.fairProb) || 0.02,
      };
    });
    const prob = legs.reduce((acc, it) => acc * it.fairProb, 1);
    const { mult, cost, unitPayout, cappedClipped, returnPayout } = computeLineStatutoryPayout(
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
    desc: `${l.roleLabel}(${l.multiple}倍) · ${l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join('×')}`,
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
  const { vigPct } = computeCapitalWeightedVig(lines, matches);

  const hasMissOne =
    typeof basePlan.missOneReturn === 'number' && Number.isFinite(basePlan.missOneReturn);

  let missOneReturn = null;
  if (hasMissOne) {
    const distinctMids = Array.from(planMatchIds);
    if (distinctMids.length >= 2) {
      const missPayouts = distinctMids.map((missedId) =>
        Number(
          lines
            .filter((l) => !l.legs.some((g) => g.matchId === missedId))
            .reduce((a, l) => a + l.returnPayout, 0)
            .toFixed(2)
        )
      );
      const posMiss = missPayouts.filter((v) => v > 0);
      missOneReturn = posMiss.length > 0 ? Math.min(...posMiss) : jointEval.minPayout;
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

  return {
    ...basePlan,
    tagline: nextTagline,
    totalCost,
    minReturn,
    maxReturn,
    winProb,
    profitProb,
    missOneReturn,
    vigPct,
    lines,
  };
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
        ? Math.max(0, Number(((unitBeforeCap - effectiveUnit) * mult).toFixed(2)))
        : 0;
    const lineClipped =
      typeof l.cappedClipped === 'number' && Number.isFinite(l.cappedClipped) && l.cappedClipped > 0
        ? Math.max(l.cappedClipped, derivedClip)
        : derivedClip;
    const returnPayout = Number(l.returnPayout ?? (effectiveUnit * mult).toFixed(2));
    const netProfit = Number((returnPayout - plan.totalCost).toFixed(2));
    return {
      id: l.id,
      desc:
        `${l.roleLabel}(${l.multiple}倍) · ` +
        l.legs.map((g) => `${g.home}[${g.optionLabel}@${Number(g.odds).toFixed(2)}]`).join('×'),
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

  // Build per-match atomic map respecting frozen/sandboxed leg probabilities when consistent
  const legsByMatch = new Map();
  for (const l of plan.lines) {
    for (const lg of l.legs) {
      const arr = legsByMatch.get(lg.matchId) ?? [];
      if (!arr.some((x) => x.poolCode === lg.poolCode && x.optionKey === lg.optionKey)) {
        arr.push(lg);
      }
      legsByMatch.set(lg.matchId, arr);
    }
  }
  const atomicMap = new Map();
  for (const [mid, mLegs] of legsByMatch.entries()) {
    const fm = Array.isArray(matches) ? matches.find((x) => x.id === mid) : null;
    const gl = resolveGoalLineNum(fm, mLegs.find((x) => x.poolCode === 'HHAD')?.poolName);
    const poolCodes = Array.from(new Set(mLegs.map((g) => g.poolCode)));
    if (!fm) {
      atomicMap.set(mid, alignMatchlessAtomicToLegs(mLegs, gl));
    } else if (poolCodes.length === 1) {
      const base = getMatchBaseAtomicProbs(fm, poolCodes);
      const pseudoOpts = mLegs.map((g) => ({
        key: g.optionKey,
        label: g.optionLabel,
        fairProb: g.fairProb,
      }));
      atomicMap.set(mid, alignAtomicProbsToPoolOptions(base, poolCodes[0], pseudoOpts, gl));
    } else {
      // Multi-pool on same match: start from coherent distribution and apply union ratio if legs were sandbox-tilted
      let base = getMatchBaseAtomicProbs(fm, poolCodes);
      const refLeg = mLegs[0];
      const baseRefP = sumOptionProbOnAtomic(
        base,
        refLeg.poolCode,
        refLeg.optionKey,
        refLeg.optionLabel,
        gl
      );
      if (baseRefP > 1e-6 && Math.abs(baseRefP - Number(refLeg.fairProb)) > 1e-5) {
        const atomicLen = ATOMIC_TEMPLATES.length;
        const hitMask = new Uint8Array(atomicLen);
        let baseUnion = 0;
        for (let i = 0; i < atomicLen; i++) {
          const tpl = ATOMIC_TEMPLATES[i];
          for (const g of mLegs) {
            if (doesOptionHitAtomicTemplate(g.poolCode, g.optionKey, g.optionLabel, gl, tpl)) {
              hitMask[i] = 1;
              baseUnion += base[i];
              break;
            }
          }
        }
        const scaleRatio = Number(refLeg.fairProb) / baseRefP;
        const targetUnion = Math.min(0.999, Math.max(0.001, baseUnion * scaleRatio));
        if (baseUnion > 0 && baseUnion < 0.999) {
          const hitScale = targetUnion / baseUnion;
          const missScale = (1 - targetUnion) / (1 - baseUnion);
          const shifted = new Float64Array(atomicLen);
          let s = 0;
          for (let i = 0; i < atomicLen; i++) {
            shifted[i] = base[i] * (hitMask[i] ? hitScale : missScale);
            s += shifted[i];
          }
          if (s > 0) for (let i = 0; i < atomicLen; i++) shifted[i] /= s;
          base = shifted;
        }
      }
      atomicMap.set(mid, base);
    }
  }

  const jointEval = evaluateTicketsOnQuotientSpace(
    physicalTickets,
    plan.totalCost,
    matches,
    atomicMap
  );
  const { combos } = jointEval;

  const invUnitSum = physicalTickets.reduce((a, c) => a + 2 / Math.max(0.5, c.unitPayout), 0);
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
  const totalClipped = physicalTickets.reduce((a, c) => a + c.cappedClipped, 0);
  const maxClippedPassSize = physicalTickets
    .filter((c) => c.cappedClipped > 0)
    .reduce(
      (mx, c) => Math.max(mx, c.legs?.length ?? 1),
      activeSizes[activeSizes.length - 1] ?? 1
    );
  const maxTierCap = statutorySingleBetCap(maxClippedPassSize);
  if (totalClipped > 0 || maxLineMult > 99) {
    planWarnings.push({
      id: 'cap-clip',
      severity: totalClipped > 0 ? 'danger' : 'warn',
      title:
        totalClipped > 0
          ? `封顶截断警告：有 ${totalClipped.toFixed(0)} 元超额奖金将被体彩无偿没收！`
          : `分倍含超 99 倍单注（体彩店需拆成 ${consolidatedTickets} 张实票打印）`,
      detail:
        totalClipped > 0
          ? `当前触发 ${maxTierCap / 10000} 万元法定单注封顶，多投的倍数属于白送体彩，请立即下调高赔注倍数！`
          : '终端机单张实票最高 99 倍，已按 99 倍上限自动核算店面拆票张数。',
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
  if (jointEval.underwaterCount > 0) {
    planWarnings.push({
      id: 'underwater',
      severity: 'warn',
      title: `存在 ${jointEval.underwaterCount}/${combos.length} 种局部回血场景低于总本金`,
      detail: `最低回血 ¥${jointEval.minPayout.toFixed(2)}（本金 ¥${plan.totalCost}），属容错回血垫或腰斩折算场景。`,
    });
  }

  const hasExplicitMatches = Array.isArray(matches) && matches.length > 0;
  const computedVig = computeCapitalWeightedVig(plan.lines, matches);
  const effectiveVigPct =
    hasExplicitMatches || !(Number(plan.vigPct) > 0) ? computedVig.vigPct : Number(plan.vigPct);
  const avgPayoutRatio = Math.max(0, Math.min(1, (100 - effectiveVigPct) / 100));

  return {
    matchCount: matchSet.size,
    betCount: plan.lines.length,
    comboCount: combos.length,
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
    minPayout: jointEval.minPayout,
    maxPayout: jointEval.maxPayout,
    likelyRange: jointEval.likelyRange,
    anyWinProb: jointEval.anyWinProb,
    realProfitProb: jointEval.realProfitProb,
    underwaterCount: jointEval.underwaterCount,
    underwaterShareOfWins: jointEval.underwaterShareOfWins,
    avgPayoutRatio,
    avgVigLossPer100: effectiveVigPct,
    expectedValueRate: jointEval.expectedValueRate,
    dangerScore:
      plan.key === 'alpha-radar' || plan.key === 'value-assassin'
        ? 58
        : jointEval.underwaterCount > 0
          ? 44
          : 26,
    effectiveOdds: harmonicEffOdds,
    breakevenUpgradeCost: null,
    consolidatedTickets,
    syntheticHint: `已启用【${plan.badge}】：${plan.tagline}`,
    syntheticRescuePicks: null,
    tickets: physicalTickets,
    combos,
    warnings: planWarnings,
  };
}

function normalizePortfolioKey(rawKey) {
  if (rawKey === 'iron-shield') return 'max-profit-prob';
  if (rawKey === 'spear-shield') return 'max-ev-utility';
  if (rawKey === 'fault-tolerant') return 'max-cvar-wheel';
  if (rawKey === 'value-assassin') return 'alpha-radar';
  if (rawKey === 'goal-structure') return 'max-ev-utility';
  if (
    rawKey === 'max-profit-prob' ||
    rawKey === 'max-ev-utility' ||
    rawKey === 'max-cvar-wheel' ||
    rawKey === 'alpha-radar'
  ) {
    return rawKey;
  }
  return 'max-ev-utility';
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

  const sandboxAdjustedPicks = buildSandboxAdjustedPicks(
    picks,
    matches,
    simVoidFirstMatch,
    subjectiveDeltaPct
  );
  const hasSandboxShift = simVoidFirstMatch || subjectiveDeltaPct !== 0;
  const baselinePicks = hasSandboxShift
    ? buildSandboxAdjustedPicks(picks, matches, false, 0)
    : sandboxAdjustedPicks;

  const manualReport = computeTruthReport(sandboxAdjustedPicks, multiple, matches, passSpec);

  const foundTargets = matches.filter((m) => targetIds.includes(m.id));
  const resolvedTargets = foundTargets.length > 0 ? foundTargets : matches.slice(0, 2);
  const fivePlans = generateFiveArchetypes(
    resolvedTargets,
    budget,
    stance,
    unlockFullAgg,
    anchorToRadarPicks ? baselinePicks : []
  );

  let appliedPlan = null;
  let alphaSmoothedAfterSync = false;
  if (planSpec?.kind === 'bonus') {
    const mode =
      planSpec.optMode === 'hot-first' || planSpec.optMode === 'cold-first'
        ? planSpec.optMode
        : 'equal';
    const baselineManualForOpt = hasSandboxShift
      ? computeTruthReport(baselinePicks, multiple, matches, passSpec)
      : manualReport;
    const baseAppliedPlan = scaleArchetypePlan(
      optimizeBonusPlan(baselineManualForOpt, matches, mode),
      planSpec.scaleMultiple
    );
    appliedPlan = applySandboxToPlan(
      baseAppliedPlan,
      matches,
      picks,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      { isArchetype: false, stance, manualReport }
    );
  } else if (planSpec?.kind === 'archetype') {
    const normalizedKey = normalizePortfolioKey(planSpec.key);
    const validSnap = isValidPlanObject(planSpec.snapshotPlan) ? planSpec.snapshotPlan : null;
    const liveCandidate = fivePlans.find((p) => p.key === normalizedKey) ?? null;
    const usableLive =
      liveCandidate && liveCandidate.available !== false && liveCandidate.lines.length > 0
        ? liveCandidate
        : null;
    const basePlan = validSnap ?? usableLive;
    const baseAppliedPlan = scaleArchetypePlan(basePlan, planSpec.scaleMultiple);
    appliedPlan = applySandboxToPlan(
      baseAppliedPlan,
      matches,
      picks,
      simVoidFirstMatch,
      subjectiveDeltaPct,
      { isArchetype: true, hasFrozenSnapshot: Boolean(validSnap), stance, manualReport }
    );

    if (normalizedKey === 'alpha-radar' && validSnap && appliedPlan) {
      // Check if live alpha-radar is now empty OR none of validSnap's legs still clear >= +3% alpha on live matches
      let anySnapLegStillAlpha = false;
      for (const l of validSnap.lines) {
        for (const lg of l.legs) {
          const fm = matches.find((m) => m.id === lg.matchId);
          if (!fm) continue;
          const scan = scanMatchAlphaCandidates(fm, null);
          if (scan.candidates.some((c) => c.poolCode === lg.poolCode && c.optionKey === lg.optionKey)) {
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

  if (alphaSmoothedAfterSync && effectiveReport && Array.isArray(effectiveReport.warnings)) {
    effectiveReport.warnings = [
      {
        id: 'alpha-smoothed',
        severity: 'warn',
        title: '⚠️ 原跨盘错价洼地已被官方最新调水抚平，建议还原等倍或改选前 3 档主方案',
        detail:
          '最新同步水位已消化原跨盘超额红利，当前实票结构已按最新实盘水位保留重算派奖与 EV。',
      },
      ...effectiveReport.warnings.filter((w) => w.id !== 'alpha-smoothed'),
    ];
  }

  const insights = computeProOrderInsights(sandboxAdjustedPicks, effectiveReport, matches, appliedPlan);

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
    portfolioPlans: fivePlans,
    fivePlans,
    subjectiveEVPct,
    allWarnings,
  };
}
