// Pure 5-pool coherent calibration, Shin/Power de-vigging, subjective probability tilts,
// per-match atomic re-alignment, and pure +EV cross-pool alpha scanner (zero I/O).
import {
  OFFICIAL_CRS_PAIRS,
  bankerRoundParlayUnitPayout,
} from "./statutoryRules.mjs";

/**
 * 单池非线性去水求解器（Seam A）：
 * - 默认优先采用 Shin (1993) 知情交易博弈二分法（z ∈ (1e-12, 1 - 1e-12)，容差 <= 1e-12）剥离冷门长尾保护性暗扣，
 *   并在 odds = 1.00 分界及 z -> 1^- 上界处保持 C^0 连续保序延拓（消除 1.00 分支跳变）；
 * - 对极小正浮点数输入施加安全下界防护（>= 1e-100），杜绝 1 / odds 溢出产生 Infinity / NaN；
 * - 当 V <= 1 + 1e-9 时平滑回退 Power 幂次法（q_i^k）或 Multiplicative 等比归一化，确保输出概率有限且总和误差 < 1e-12。
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

  const SAFE_MIN_POSITIVE_ODDS = 1e-100;
  const odds = rawInputs.map((item) =>
    typeof item === "object" && item !== null ? Number(item.odds) : Number(item)
  );
  const n = odds.length;

  if (odds.some((o) => !Number.isFinite(o) || o <= 0)) {
    const validInv = odds.map((o) =>
      Number.isFinite(o) && o > 0 ? 1 / Math.max(SAFE_MIN_POSITIVE_ODDS, o) : 0
    );
    const invSum = validInv.reduce((a, b) => a + b, 0);
    const probs =
      invSum > 0 && Number.isFinite(invSum)
        ? validInv.map((q) => q / invSum)
        : odds.map(() => 1 / n);
    const payoutRatio =
      invSum > 0 && Number.isFinite(invSum) ? 1 / invSum : 0.88;
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
    const safeO0 = Math.max(SAFE_MIN_POSITIVE_ODDS, odds[0]);
    const overround = 1 / safeO0;
    const payoutRatio = safeO0;
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
  let sumQSq = 0;
  let allSubUnitQ = true;
  for (let i = 0; i < n; i++) {
    const safeOdds = Math.max(SAFE_MIN_POSITIVE_ODDS, odds[i]);
    const qi = 1 / safeOdds;
    q[i] = qi;
    V += qi;
    sumQSq += qi * qi;
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
    if (!(V > 1 + 1e-9)) return null;
    // Continuous z -> 1^- boundary extension when ultra-low sub-1.0 odds push sum(q_i^2) >= V
    if (sumQSq > 0 && Number.isFinite(sumQSq) && sumQSq >= V * (1 - 1e-13)) {
      const sqRaw = Array.from(q, (qi) => (qi * qi) / sumQSq);
      const sqSum = sqRaw.reduce((a, b) => a + b, 0);
      if (sqSum > 0 && Number.isFinite(sqSum)) {
        return {
          probs: sqRaw.map((p) => p / sqSum),
          methodUsed: "shin",
          overround: V,
          payoutRatio,
          vig,
          param: 1,
        };
      }
    }
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

    let zLo = 1e-12;
    let zHi = 1 - 1e-12;
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

function parsePoolTimestampMinutes(pool) {
  if (
    !pool ||
    typeof pool.updateDate !== "string" ||
    typeof pool.updateTime !== "string"
  ) {
    return null;
  }
  const dm = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(pool.updateDate.trim());
  if (!dm) return null;
  const yy = Number(dm[1]);
  const mo = Number(dm[2]);
  const dd = Number(dm[3]);
  const utcMs = Date.UTC(yy, mo - 1, dd);
  if (!Number.isFinite(utcMs)) return null;
  const checkDate = new Date(utcMs);
  if (
    checkDate.getUTCFullYear() !== yy ||
    checkDate.getUTCMonth() + 1 !== mo ||
    checkDate.getUTCDate() !== dd
  ) {
    return null;
  }
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(pool.updateTime.trim());
  if (!tm) return null;
  const hh = Number(tm[1]);
  const mm = Number(tm[2]);
  const ss = Number(tm[3] || 0);
  if (!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60 && ss >= 0 && ss < 60)) {
    return null;
  }
  return Math.round(utcMs / 60_000) + hh * 60 + mm + ss / 60;
}

function resolveNormalizedMatchPoolTimestamps(pools) {
  const codes = ["HAD", "HHAD", "HAFU", "TTG", "CRS"];
  const raw = {};
  for (const c of codes) {
    raw[c] = parsePoolTimestampMinutes(pools?.[c]);
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
export const CRS_INDEX_BY_KEY = (() => {
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
  const mainProbs = ordered.map(
    (_, i) => 0.35 * shinProbs[i] + 0.5 * powerProbs[i] + 0.15 * multProbs[i]
  );
  const hhadMainProbs = ordered.map(
    (_, i) => 0.35 * shinProbs[i] + 0.65 * multProbs[i]
  );
  const payoutRatio = 1 / invSum;
  return {
    probs: shinProbs,
    mainProbs,
    hhadMainProbs,
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

    let tHad = hadTarget ? Float64Array.from(hadTarget.mainProbs) : null;
    let tHhad = hhadTarget ? Float64Array.from(hhadTarget.hhadMainProbs) : null;

    if (tHad && tHhad && Math.abs(goalLine) === 1) {
      const mHhad = hhadTarget.multProbs;
      const pHhad = hhadTarget.powerProbs;
      const smoothReconWeight = (gap) => {
        if (gap <= 0.1) return 1;
        if (gap >= 0.16) return 0;
        return 0.5 * (1 + Math.cos((Math.PI * (gap - 0.1)) / 0.06));
      };
      if (goalLine === -1) {
        const splitWin =
          0.35 * (pHhad[0] + pHhad[1]) + 0.65 * (mHhad[0] + mHhad[1]);
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
          0.35 * (pHhad[1] + pHhad[2]) + 0.65 * (mHhad[1] + mHhad[2]);
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
      const pHhad = hhadTarget.powerProbs;
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
          0.35 * (pHhad[0] + pHhad[1]) + 0.65 * (mHhad[0] + mHhad[1]);
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
          0.35 * (pHhad[1] + pHhad[2]) + 0.65 * (mHhad[1] + mHhad[2]);
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
    // Only apply upward lag pull toward the cross-pool prior when explicit updateDate + updateTime
    // prove the sub-pool genuinely lagged behind the main pool by >= 30 minutes without fresher contradiction.
    const normTs = resolveNormalizedMatchPoolTimestamps(rawPools);
    const ttgTs = ttgTarget ? normTs.TTG : null;
    const hafuTs = hafuTarget ? normTs.HAFU : null;
    const crsTs = crsTarget ? normTs.CRS : null;
    const hadTs = hadTarget ? normTs.HAD : null;
    const hhadTs = hhadTarget ? normTs.HHAD : null;
    const mainRefTs =
      hadTs !== null && hhadTs !== null
        ? Math.max(hadTs, hhadTs)
        : (hadTs ?? hhadTs);

    let crsExactTtgSum = null;
    if (
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
    const ttgLagValid =
      ttgTs !== null &&
      mainRefTs !== null &&
      mainRefTs - ttgTs >= 30 &&
      !(crsExactTtgSum !== null);
    const hafuLagValid =
      hafuTs !== null && mainRefTs !== null && mainRefTs - hafuTs >= 30;
    const crsLagValid =
      crsTs !== null && mainRefTs !== null && mainRefTs - crsTs >= 30;

    const tTtg = ttgTarget
      ? huberNormalize(
          Float64Array.from(ttgTarget.probs, (v, j) => {
            const rawBlended = 0.65 * v + 0.35 * ttgTarget.powerProbs[j];
            if (!ttgLagValid) {
              return 0.97 * rawBlended + 0.03 * qTtg[j];
            }
            return (
              0.97 * huberLagCap(rawBlended, qTtg[j], 0.032) + 0.03 * qTtg[j]
            );
          })
        )
      : null;
    const tHafu = hafuTarget
      ? huberNormalize(
          Float64Array.from(hafuTarget.powerProbs, (v, j) =>
            hafuLagValid
              ? 0.85 * huberLagCap(v, qHafu[j], 0.045) + 0.15 * qHafu[j]
              : 0.85 * v + 0.15 * qHafu[j]
          )
        )
      : null;
    const tCrs = crsTarget
      ? huberNormalize(
          Float64Array.from(crsTarget.powerProbs, (v, j) =>
            crsLagValid
              ? 0.8 * huberLagCap(v, qCrs[j], 0.035) + 0.2 * qCrs[j]
              : 0.8 * v + 0.2 * qCrs[j]
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

export function computeMatchPoolsFingerprint(match) {
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

export function getCachedMatchCalibration(match) {
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

export function resolveGoalLineNum(match, poolName) {
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

export function doesOptionHitAtomicTemplate(
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

export function sumOptionProbOnAtomic(
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

export function alignAtomicProbsToPoolOptions(
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

export function getMatchBaseAtomicProbs(match, preferredPools = null) {
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

export function alignMatchlessAtomicToLegs(legsOnMatch, gl) {
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

export function alignMultiPoolAtomicToTiltedLegs(baseProbs, mLegs, gl) {
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

export function computeCapitalWeightedVig(lines, matches) {
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

export function tiltAtomicProbsByStance(baseProbs, match, stance) {
  if (stance !== "home-lean" && stance !== "upset-watch") {
    return baseProbs;
  }
  const atomicLen = ATOMIC_TEMPLATES.length;
  const out = new Float64Array(atomicLen);

  const homeBoost = Math.exp(0.22);
  const drawBoost = Math.exp(0.24);
  const dogBoost = Math.exp(0.28);

  let underdogFt = "a";
  let deepAbsGl = 0;
  let narrowFavBoost = 1;
  if (stance === "upset-watch") {
    let pH = 0;
    let pA = 0;
    let pD = 0;
    for (let i = 0; i < atomicLen; i++) {
      const ft = ATOMIC_TEMPLATES[i].ft;
      if (ft === "h") pH += baseProbs[i];
      else if (ft === "a") pA += baseProbs[i];
      else pD += baseProbs[i];
    }
    const gl = resolveGoalLineNum(match);
    const isAwayFav = Math.abs(pA - pH) > 1e-6 ? pA > pH : gl > 0;
    underdogFt = isAwayFav ? "h" : "a";
    if (
      Math.abs(gl) >= 2 &&
      ((gl <= -2 && !isAwayFav) || (gl >= 2 && isAwayFav))
    ) {
      deepAbsGl = Math.abs(gl);
      let pFavCover = 0;
      for (let i = 0; i < atomicLen; i++) {
        const favMargin = isAwayFav
          ? -ATOMIC_TEMPLATES[i].goalDiff
          : ATOMIC_TEMPLATES[i].goalDiff;
        if (favMargin >= deepAbsGl) pFavCover += baseProbs[i];
      }
      const pDog = isAwayFav ? pH : pA;
      const nonNarrowMass = pFavCover + pD + pDog;
      if (nonNarrowMass > 1e-12 && pFavCover > 1e-12) {
        const bNeutral =
          (pFavCover + pD * drawBoost + pDog * dogBoost) / nonNarrowMass;
        narrowFavBoost = bNeutral + 0.25 * Math.max(0, drawBoost - bNeutral);
      }
    }
  }

  let sum = 0;
  for (let i = 0; i < atomicLen; i++) {
    const ft = ATOMIC_TEMPLATES[i].ft;
    let mult = 1;
    if (stance === "home-lean") {
      if (ft === "h") mult = homeBoost;
    } else if (stance === "upset-watch") {
      if (ft === "d") {
        mult = drawBoost;
      } else if (ft === underdogFt) {
        mult = dogBoost;
      } else if (deepAbsGl >= 2) {
        const favMargin =
          underdogFt === "h"
            ? -ATOMIC_TEMPLATES[i].goalDiff
            : ATOMIC_TEMPLATES[i].goalDiff;
        if (favMargin >= 1 && favMargin <= deepAbsGl - 1) {
          mult = narrowFavBoost;
        }
      }
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
  if (!(pS > 0 && pS < 1 - 1e-9)) {
    return baseProbs;
  }
  const rawTarget = pS * (1 + delta / 100);
  const pPrime =
    delta > 0
      ? pS < 0.98
        ? Math.min(0.98, rawTarget)
        : Math.min(1 - 1e-9, pS + (1 - pS) * Math.min(0.99, delta / 100))
      : Math.min(pS, Math.max(1e-15, rawTarget));
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

function computeMinDiscreteSplitNotes(odds1, odds2, singleOdds, maxScan = 99) {
  const u1 = bankerRoundParlayUnitPayout([odds1]);
  const u2 = bankerRoundParlayUnitPayout([odds2]);
  const uSingle = bankerRoundParlayUnitPayout([singleOdds]);
  if (!(u1 > 0 && u2 > 0 && uSingle > 0)) return null;
  for (let n = 2; n <= maxScan; n++) {
    const target = n * uSingle;
    const m1Ideal = Math.max(
      1,
      Math.min(n - 1, Math.round((n * u2) / (u1 + u2)))
    );
    for (
      let m1 = Math.max(1, m1Ideal - 1);
      m1 <= Math.min(n - 1, m1Ideal + 1);
      m1++
    ) {
      const m2 = n - m1;
      const worstPay = Math.min(m1 * u1, m2 * u2);
      if (worstPay > target + 1e-9) {
        return n;
      }
    }
  }
  return null;
}

export function canDiscreteSplitBeatSingleAtExactNotes(
  odds1,
  odds2,
  singleOdds,
  exactNotes
) {
  const n = Math.min(999, Math.floor(Number(exactNotes) || 0));
  if (n < 2) return false;
  const u1 = bankerRoundParlayUnitPayout([odds1]);
  const u2 = bankerRoundParlayUnitPayout([odds2]);
  const uSingle = bankerRoundParlayUnitPayout([singleOdds]);
  if (!(u1 > 0 && u2 > 0 && uSingle > 0)) return false;
  const target = n * uSingle;
  const m1Ideal = Math.max(
    1,
    Math.min(n - 1, Math.round((n * u2) / (u1 + u2)))
  );
  for (
    let m1 = Math.max(1, m1Ideal - 1);
    m1 <= Math.min(n - 1, m1Ideal + 1);
    m1++
  ) {
    const m2 = n - m1;
    const worstPay = Math.min(m1 * u1, m2 * u2);
    if (worstPay > target + 1e-9) {
      return true;
    }
  }
  return false;
}

export function computeEquivalentArbitrages(m) {
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
        const minSplitNotes = !hhadBetter
          ? computeMinDiscreteSplitNotes(hadD.odds, hadA.odds, hhadAway.odds)
          : null;
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
            : `配平「平+客胜(合成等效水位@${synDouble.toFixed(2)})」比直接买「让负」高出 +${edge.toFixed(1)}%${
                minSplitNotes
                  ? `（需至少 ${minSplitNotes} 注即 ¥${minSplitNotes * 2} 分倍配平才免两元凑整损耗）`
                  : ""
              }！`,
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
        const minSplitNotes = !hhadBetter
          ? computeMinDiscreteSplitNotes(hadH.odds, hadD.odds, hhadHome.odds)
          : null;
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
            : `配平「主胜+平」合成等效水位高出 +${edge.toFixed(1)}%${
                minSplitNotes
                  ? `（需至少 ${minSplitNotes} 注即 ¥${minSplitNotes * 2} 分倍配平才免两元凑整损耗）`
                  : ""
              }！`,
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

export function computeOptionShrunkAlpha(odds, dcProb, shinProb) {
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
export function scanMatchAlphaCandidates(
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
    const isVerifiedSubPoolLag =
      !isMainPool &&
      hasRealTsSpread &&
      curPoolTs !== null &&
      mainLatestTs !== null &&
      mainLatestTs - curPoolTs >= 30;
    const isUnverifiedSubPoolLag = !isMainPool && !isVerifiedSubPoolLag;
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
      if (
        isUnverifiedSubPoolLag &&
        !arbitrages.some((arb) =>
          Array.isArray(arb.betterPicks)
            ? arb.betterPicks.some(
                (bp) => bp.poolCode === poolCode && bp.optionKey === opt.key
              )
            : arb.poolCode === poolCode && arb.optionKey === opt.key
        )
      ) {
        continue;
      }
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

/** 1. 单场精算师底牌反推（服务端黑盒：五池闭合 xG + 全让球线统一一球卡盘率 + Dixon-Coles 低比分联动修正系数 ρ + 跨盘错价扫描） */
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

  // paceCorrelation 为 Dixon-Coles {0:0, 1:0, 0:1, 1:1} 低比分联动修正系数 ρ（非全场总进球 Pearson 相关系数）
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

export function resolveMatchAtomicContexts(
  rawItems,
  matches,
  {
    mode = "workspace-picks",
    isArchetype = false,
    hasFrozenSnapshot = false,
    stance = "objective",
    subjectiveDeltaPct = 0,
  } = {}
) {
  const legsByMatch = new Map();
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (!item?.matchId) continue;
      const arr = legsByMatch.get(item.matchId) ?? [];
      if (
        !arr.some(
          (x) => x.poolCode === item.poolCode && x.optionKey === item.optionKey
        )
      ) {
        arr.push(item);
      }
      legsByMatch.set(item.matchId, arr);
    }
  }

  const matchById = new Map();
  if (Array.isArray(matches)) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m?.id) matchById.set(m.id, m);
    }
  }

  const contexts = new Map();
  const atomicMap = new Map();
  const objectiveAtomicMap = new Map();

  for (const [mid, mLegs] of legsByMatch.entries()) {
    const fm = matchById.get(mid) ?? null;
    const gl = resolveGoalLineNum(
      fm,
      mLegs.find((x) => x.poolCode === "HHAD")?.poolName ?? mLegs[0]?.poolName
    );
    const poolCodes = Array.from(new Set(mLegs.map((g) => g.poolCode)));
    const pureObjAtomic = fm
      ? getMatchBaseAtomicProbs(fm, poolCodes)
      : alignMatchlessAtomicToLegs(mLegs, gl);
    objectiveAtomicMap.set(mid, pureObjAtomic);

    const alignToLegFairProbs = () => {
      if (poolCodes.length === 1) {
        const pseudoOpts = mLegs.map((g) => ({
          key: g.optionKey,
          label: g.optionLabel,
          fairProb: g.fairProb,
        }));
        return alignAtomicProbsToPoolOptions(
          pureObjAtomic,
          poolCodes[0],
          pseudoOpts,
          gl
        );
      }
      return alignMultiPoolAtomicToTiltedLegs(pureObjAtomic, mLegs, gl);
    };

    let baseAtomic;
    if (!fm) {
      baseAtomic = pureObjAtomic;
    } else if (mode === "plan-legs") {
      baseAtomic = alignToLegFairProbs();
    } else if (mode === "sandbox-plan") {
      const oddsUnchanged = mLegs.every((g) => {
        const opt = fm.pools?.[g.poolCode]?.options?.find(
          (o) => o.key === g.optionKey || o.label === g.optionLabel
        );
        return Boolean(opt) && Math.abs(opt.odds - Number(g.odds)) < 1e-6;
      });
      if (hasFrozenSnapshot && oddsUnchanged) {
        baseAtomic = alignToLegFairProbs();
      } else if (isArchetype && !hasFrozenSnapshot) {
        baseAtomic = tiltAtomicProbsByStance(pureObjAtomic, fm, stance);
      } else {
        baseAtomic = pureObjAtomic;
      }
    } else {
      baseAtomic = pureObjAtomic;
    }

    const shifted = tiltAtomicProbsBySubjectiveDelta(
      baseAtomic,
      mLegs,
      gl,
      subjectiveDeltaPct
    );
    contexts.set(mid, { shifted, gl, fm });
    atomicMap.set(mid, shifted);
  }

  return { contexts, atomicMap, objectiveAtomicMap };
}

export { ATOMIC_TEMPLATES };
