// Pure statutory rounding, China Sporttery parlay caps, ticket consolidation,
// and the single canonical Two-Stage Inverse-Odds Discrete Dutching Allocator.

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
    if (o0 >= 1 && o0 <= 100_000) {
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
    if (
      o0 >= 1 &&
      o1 >= 1 &&
      o0 <= 100_000 &&
      o1 <= 100_000 &&
      o0 * o1 <= 400_000
    ) {
      const num = 200 * Math.round(o0 * 10000) * Math.round(o1 * 10000);
      const scale = 100_000_000;
      const q = Math.trunc(num / scale);
      const twiceRem = (num - q * scale) * 2;
      if (twiceRem < scale) return q / 100;
      if (twiceRem > scale) return (q + 1) / 100;
      return (q % 2 === 0 ? q : q + 1) / 100;
    }
  }
  if (
    oddsList.some(
      (o) => !Number.isFinite(o) || o <= 0 || !Number.isFinite(o * 10000)
    )
  ) {
    return 0;
  }
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

export function effectiveNonVoidLegCount(legOdds) {
  if (!Array.isArray(legOdds) || legOdds.length === 0) return 1;
  let valid = 0;
  for (let i = 0; i < legOdds.length; i++) {
    if (Math.abs(Number(legOdds[i]) - 1.0) > 1e-9) valid += 1;
  }
  return Math.max(1, valid);
}

export function computeLineStatutoryPayout(legOdds, multiple) {
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

export const TRUSTED_SERVER_BONUS_PLANS = new WeakSet();

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

export function combinationsOfIndices(n, k) {
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

export function countPhysical99xSlips(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  let sheets = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = Math.max(1, Math.round(Number(lines[i]?.multiple) || 1));
    sheets += Math.max(1, Math.ceil(m / 99));
  }
  return sheets;
}

/**
 * Stage 2 反比例木桶注水核心（自动跳过法定封顶截断实票，上限 999 倍）：
 * - 当 rem > 256 时先用精确二分定位安全水位下界 L_lo - 1e-7 批量注水，再逐注完成并列裁决；
 * - 与纯逐注贪心（最低 curPay = m_i * u_i，并列按 prob_i * u_i 降序）结果严格一致。
 */
export function waterFillInverseOddsNotes(
  mults,
  items,
  remNotes,
  { skipCapClipped = true } = {}
) {
  const k = mults.length;
  let rem = Math.max(0, Math.floor(Number(remNotes) || 0));
  if (k === 0 || rem <= 0) return rem;

  const hasUnclippedCapacity = () => {
    if (!skipCapClipped) return false;
    for (let i = 0; i < k; i++) {
      if (!items[i].isCapClipped && mults[i] < 999) return true;
    }
    return false;
  };

  if (rem > 256) {
    const protectUnclipped = hasUnclippedCapacity();
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < k; i++) {
      if (protectUnclipped && items[i].isCapClipped) continue;
      const maxPay = 999 * items[i].unitPayout;
      if (maxPay > hi) hi = maxPay;
    }
    for (let iter = 0; iter < 40; iter++) {
      const mid = 0.5 * (lo + hi);
      let needed = 0;
      for (let i = 0; i < k; i++) {
        if (mults[i] >= 999) continue;
        if (protectUnclipped && items[i].isCapClipped) continue;
        const u = Math.max(0.5, items[i].unitPayout);
        const mTarget = Math.min(999, Math.ceil((mid - 1e-7) / u));
        if (mTarget > mults[i]) needed += mTarget - mults[i];
      }
      if (needed <= rem) lo = mid;
      else hi = mid;
    }
    if (lo > 0) {
      for (let i = 0; i < k && rem > 0; i++) {
        if (mults[i] >= 999) continue;
        if (protectUnclipped && items[i].isCapClipped) continue;
        const u = Math.max(0.5, items[i].unitPayout);
        const mTarget = Math.min(999, Math.ceil((lo - 1e-7) / u));
        const jump = Math.min(rem, Math.max(0, mTarget - mults[i]));
        if (jump > 0) {
          mults[i] += jump;
          rem -= jump;
        }
      }
    }
  }

  while (rem > 0) {
    const protectUnclipped = hasUnclippedCapacity();
    let bestI = -1;
    let lowestPay = Infinity;
    let bestEv = -Infinity;
    for (let i = 0; i < k; i++) {
      if (mults[i] >= 999) continue;
      if (protectUnclipped && items[i].isCapClipped) continue;
      const u = items[i].unitPayout;
      const curPay = mults[i] * u;
      const ev = (items[i].prob || 0) * u;
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
    mults[bestI] += 1;
    rem -= 1;
  }
  return rem;
}

/**
 * 唯一权威双阶段离散反比例分倍器（Two-Stage Inverse-Odds Discrete Dutching Allocator）：
 * 统一承载合成单关配平、三模奖金优化、零假中奖保本配单与背包配单的离散分倍：
 * 1. 保本下界与 -1e-9 IEEE-754 浮点上界防抖：w_i = max(1, ceil((2 * totalNotes - 1e-9) / unitPayout_i))；
 * 2. Stage 1 平手保本精确提拉：优先将恰好等于总本金的平手实票按命中率 prob 降序提拉 +1 倍转为严格净赚；
 * 3. Stage 2 反比例木桶注水：剩余注数按当前最低派奖额 m_i * unitPayout_i 升序均衡注水。
 */
export function allocateInverseOddsDutching(
  items,
  totalNotes,
  {
    skipCapClipped = true,
    requireStrictNetGain = false,
    validateAllNonLoss = true,
    stage2Mode = "water-fill",
  } = {}
) {
  const k = Array.isArray(items) ? items.length : 0;
  const candN = Math.floor(Number(totalNotes) || 0);
  if (k === 0 || candN < k) return null;

  const hasUnclipped = skipCapClipped && items.some((it) => !it.isCapClipped);
  const cVal = 2 * candN;
  const cFloor = cVal - 1e-9;

  const mults = new Array(k);
  let sumReq = 0;
  for (let i = 0; i < k; i++) {
    const isSkipped = hasUnclipped && Boolean(items[i].isCapClipped);
    const u = Math.max(0.5, Number(items[i].unitPayout) || 0);
    const wReq = isSkipped ? 1 : Math.max(1, Math.ceil(cFloor / u));
    if (wReq > 999) return null;
    sumReq += wReq;
    if (sumReq > candN) return null;
    mults[i] = wReq;
  }

  let rem = candN - sumReq;
  if (rem > 0) {
    if (stage2Mode === "hot-first") {
      for (let i = 0; i < k && rem > 0; i++) {
        if (hasUnclipped && items[i].isCapClipped) continue;
        const add = Math.min(rem, 999 - mults[i]);
        mults[i] += add;
        rem -= add;
      }
    } else if (stage2Mode === "cold-first") {
      for (let i = k - 1; i >= 0 && rem > 0; i--) {
        if (hasUnclipped && items[i].isCapClipped) continue;
        const add = Math.min(rem, 999 - mults[i]);
        mults[i] += add;
        rem -= add;
      }
    } else {
      const refundOrder = [];
      for (let i = 0; i < k; i++) {
        if (hasUnclipped && items[i].isCapClipped) continue;
        if (
          mults[i] < 999 &&
          mults[i] * items[i].unitPayout <= cVal + 1e-6 &&
          (mults[i] + 1) * items[i].unitPayout > cVal + 1e-6
        ) {
          refundOrder.push(i);
        }
      }
      refundOrder.sort(
        (a, b) =>
          (items[b].prob || 0) - (items[a].prob || 0) ||
          (items[b].prob || 0) * items[b].unitPayout -
            (items[a].prob || 0) * items[a].unitPayout
      );
      for (let r = 0; r < refundOrder.length && rem > 0; r++) {
        mults[refundOrder[r]] += 1;
        rem -= 1;
      }

      if (rem > 0) {
        waterFillInverseOddsNotes(mults, items, rem, { skipCapClipped });
      }
    }
  }

  const finalNotes = mults.reduce((a, b) => a + b, 0);
  const finalCost = finalNotes * 2;
  let strictP = 0;
  let nonLossP = 0;
  let minPay = Infinity;
  let maxPay = -Infinity;
  let expRet = 0;
  for (let i = 0; i < k; i++) {
    const pay = Number((mults[i] * items[i].unitPayout).toFixed(2));
    const isSkipped = hasUnclipped && Boolean(items[i].isCapClipped);
    if (validateAllNonLoss && !isSkipped && pay < finalCost - 1e-6) {
      return null;
    }
    const p = items[i].prob || 0;
    if (pay >= finalCost - 1e-6) nonLossP += p;
    if (pay > finalCost + 1e-6) strictP += p;
    if (pay < minPay) minPay = pay;
    if (pay > maxPay) maxPay = pay;
    expRet += p * pay;
  }
  if (requireStrictNetGain && !(maxPay > finalCost + 1e-6)) {
    return null;
  }

  return {
    mults,
    notes: finalNotes,
    totalCost: finalCost,
    minPayout: minPay === Infinity ? 0 : minPay,
    maxPayout: maxPay === -Infinity ? 0 : maxPay,
    strictProb: strictP,
    nonLossProb: nonLossP,
    floorRatio: finalCost > 0 ? (minPay - finalCost) / finalCost : 0,
    evRate: finalCost > 0 ? (expRet - finalCost) / finalCost : 0,
  };
}

/** Knaster-Tarski 单调不动点迭代求解最低保本门槛金额（B* <= ¥20,000） */
export function computeBreakevenUpgradeCost(unitPayouts, baseNotes) {
  if (!Array.isArray(unitPayouts) || unitPayouts.length === 0) return null;
  let curN = Math.max(unitPayouts.length, Math.floor(Number(baseNotes) || 1));
  let stepIdx = 0;
  while (curN <= 10_000) {
    const budgetC = curN * 2;
    let needed = 0;
    let infeasible = false;
    for (let i = 0; i < unitPayouts.length; i++) {
      const u = unitPayouts[i];
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
      return (stepIdx === 0 ? needed : curN) * 2;
    }
    curN = needed;
    stepIdx++;
  }
  return null;
}

export function consolidateCloseMultiples(
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
        if (newMinPay < oldMinPay * 0.97 - 1e-9) continue;

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

export function buildConsolidatedLines(rawLines, alreadySmoothed = false) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) return [];
  if (rawLines.length === 1 || rawLines.length > 64) return rawLines;
  const totalCost = rawLines.reduce((a, l) => a + (Number(l.cost) || 0), 0);
  const smoothed = alreadySmoothed
    ? rawLines
    : (() => {
        const cMults = consolidateCloseMultiples(
          rawLines.map((l) =>
            Math.max(1, Math.min(999, Math.round(Number(l.multiple) || 1)))
          ),
          rawLines.map((l) => Math.max(0.5, Number(l.unitPayout) || 2)),
          rawLines.map((l) => (Number(l.cappedClipped) || 0) > 0),
          rawLines.map((l) => (l.legs ?? []).length || 1),
          totalCost
        );
        return rawLines.map((l, idx) => {
          const m = cMults[idx];
          const cost = m * 2;
          const ret = Number((Number(l.unitPayout) * m).toFixed(2));
          return {
            ...l,
            multiple: m,
            cost,
            returnPayout: ret,
            netProfit: Number((ret - totalCost).toFixed(2)),
          };
        });
      })();

  const merged = smoothed.map((l) => ({
    ...l,
    legs: l.legs.map((g) => ({ ...g })),
  }));
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < merged.length && !didMerge; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i];
        const b = merged[j];
        if (
          a.multiple !== b.multiple ||
          a.modeLabel !== b.modeLabel ||
          a.legs.length !== b.legs.length
        ) {
          continue;
        }
        let diffPos = -1;
        let sameOther = true;
        for (let pos = 0; pos < a.legs.length; pos++) {
          const ga = a.legs[pos];
          const gb = b.legs[pos];
          if (ga.matchId !== gb.matchId || ga.poolCode !== gb.poolCode) {
            sameOther = false;
            break;
          }
          if (ga.optionLabel !== gb.optionLabel) {
            if (diffPos >= 0) {
              sameOther = false;
              break;
            }
            diffPos = pos;
          }
        }
        if (sameOther && diffPos >= 0) {
          const ga = a.legs[diffPos];
          const gb = b.legs[diffPos];
          const combinedLegs = a.legs.map((g, pos) =>
            pos === diffPos
              ? {
                  ...g,
                  optionLabel: `${ga.optionLabel}+${gb.optionLabel}`,
                  odds: Math.min(Number(ga.odds) || 1, Number(gb.odds) || 1),
                  fairProb: Math.min(
                    1,
                    (Number(ga.fairProb) || 0) + (Number(gb.fairProb) || 0)
                  ),
                }
              : g
          );
          const minUnit = Math.min(a.unitPayout, b.unitPayout);
          const minRet = Math.min(a.returnPayout, b.returnPayout);
          merged[i] = {
            ...a,
            roleLabel: `${a.roleLabel}·合票`,
            legs: combinedLegs,
            cost: a.cost + b.cost,
            unitPayout: minUnit,
            returnPayout: minRet,
            netProfit: Number((minRet - totalCost).toFixed(2)),
            prob: Math.min(1, (Number(a.prob) || 0) + (Number(b.prob) || 0)),
          };
          merged.splice(j, 1);
          didMerge = true;
          break;
        }
      }
    }
  }
  return merged;
}

export function attachLazyConsolidatedLines(
  target,
  lines,
  alreadySmoothed = false
) {
  let cached;
  let evaluated = false;
  Object.defineProperty(target, "consolidatedLines", {
    enumerable: true,
    configurable: true,
    get() {
      if (!evaluated) {
        cached = buildConsolidatedLines(lines, alreadySmoothed);
        evaluated = true;
      }
      return cached;
    },
    set(v) {
      cached = v;
      evaluated = true;
    },
  });
  return target;
}

export function shallowClonePlanWithoutConsolidated(plan) {
  const out = {};
  const keys = Object.keys(plan);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k !== "consolidatedLines") out[k] = plan[k];
  }
  return out;
}

export const BASE_POOL_SINGLE_SYM = Symbol.for("yj.basePoolSingle");
export const BASE_POOL_ALLUP_SYM = Symbol.for("yj.basePoolAllUp");

export function isPoolSingleEligible(pool) {
  if (
    !pool ||
    pool.selling === false ||
    !Array.isArray(pool.options) ||
    pool.options.length === 0
  ) {
    return false;
  }
  const baseS = pool[BASE_POOL_SINGLE_SYM];
  if (typeof baseS === "boolean") {
    if (typeof pool.canSingle === "boolean" && pool.canSingle !== baseS) {
      return pool.canSingle;
    }
    if (typeof pool.single === "boolean" && pool.single !== baseS) {
      return pool.single;
    }
    return baseS;
  }
  if (typeof pool.canSingle === "boolean" && typeof pool.single === "boolean") {
    return pool.canSingle && pool.single;
  }
  if (typeof pool.canSingle === "boolean") return pool.canSingle;
  return Boolean(pool.single);
}

export function isPoolAllUpEligible(pool) {
  if (
    !pool ||
    pool.selling === false ||
    !Array.isArray(pool.options) ||
    pool.options.length === 0
  ) {
    return false;
  }
  const baseA = pool[BASE_POOL_ALLUP_SYM];
  if (typeof baseA === "boolean") {
    if (typeof pool.canAllUp === "boolean" && pool.canAllUp !== baseA) {
      return pool.canAllUp;
    }
    return baseA;
  }
  if (typeof pool.canAllUp === "boolean") return pool.canAllUp;
  return true;
}
