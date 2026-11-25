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

export function countActiveNonVoidLegs(legOdds, voidMatchSet = null) {
  if (!Array.isArray(legOdds) || legOdds.length === 0) return 0;
  let valid = 0;
  for (let i = 0; i < legOdds.length; i++) {
    const item = legOdds[i];
    if (typeof item === "object" && item !== null) {
      if (item.isVoid === true) continue;
      if (
        voidMatchSet &&
        item.matchId &&
        voidMatchSet.has(String(item.matchId))
      ) {
        continue;
      }
      const oddVal = Number(item.odds);
      if (Math.abs(oddVal - 1.0) > 1e-9) valid += 1;
    } else {
      const oddVal = Number(item);
      if (Math.abs(oddVal - 1.0) > 1e-9) valid += 1;
    }
  }
  return valid;
}

export function effectiveNonVoidLegCount(legOdds, voidMatchSet = null) {
  return Math.max(1, countActiveNonVoidLegs(legOdds, voidMatchSet));
}

export function computeLineStatutoryPayout(
  legOdds,
  multiple,
  voidMatchSet = null
) {
  const mult = Math.max(1, Math.min(999, Math.round(Number(multiple) || 1)));
  const normalizedOdds = Array.isArray(legOdds)
    ? legOdds.map((item) => {
        if (typeof item === "object" && item !== null) {
          if (
            item.isVoid === true ||
            (voidMatchSet &&
              item.matchId &&
              voidMatchSet.has(String(item.matchId)))
          ) {
            return 1.0;
          }
          return Number(item.odds);
        }
        return Number(item);
      })
    : [];
  const activeCount = countActiveNonVoidLegs(legOdds, voidMatchSet);
  const unitBeforeCap =
    activeCount === 0 && normalizedOdds.length > 0
      ? 2.0
      : bankerRoundParlayUnitPayout(normalizedOdds);
  const cap = statutorySingleBetCap(Math.max(1, activeCount));
  const unitPayout = Math.min(cap, unitBeforeCap);
  const cappedClipped = Math.max(
    0,
    Number(((unitBeforeCap - unitPayout) * mult).toFixed(2))
  );
  const returnPayout = Number((unitPayout * mult).toFixed(2));
  return {
    mult,
    cost: mult * 2,
    activeLegCount: activeCount,
    isAllVoidRefund: activeCount === 0 && normalizedOdds.length > 0,
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

// ==================== ADR-0019 · Lossless Multiset Slip Consolidator & Joint Breakeven Solver ====================

const CANONICAL_POOL_OPTION_ORDER = {
  HAD: ["h", "d", "a"],
  HHAD: ["hh", "hd", "ha", "h", "d", "a"],
  TTG: ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"],
  HAFU: ["hh", "hd", "ha", "dh", "dd", "da", "ah", "ad", "aa"],
  CRS: [
    ...OFFICIAL_CRS_PAIRS.map(([k]) => k),
    ...OFFICIAL_CRS_PAIRS.map(([, lbl]) => lbl),
  ],
};

function comparePoolOptionKeys(poolCode, keyA, keyB) {
  const order = CANONICAL_POOL_OPTION_ORDER[poolCode];
  if (order) {
    const ia = order.indexOf(keyA);
    const ib = order.indexOf(keyB);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
  }
  return String(keyA).localeCompare(String(keyB));
}

function resolveSlipPassSizes(line, matchCount) {
  if (Array.isArray(line?.passSizes) && line.passSizes.length > 0) {
    const cleaned = [
      ...new Set(
        line.passSizes
          .map((n) => Math.round(Number(n) || 0))
          .filter((n) => n >= 1)
      ),
    ].sort((a, b) => a - b);
    if (cleaned.length > 0) return cleaned;
  }
  const rawMode = String(line?.modeLabel || "").trim();
  if (
    matchCount === 1 ||
    rawMode === "单关" ||
    rawMode === "1串1" ||
    rawMode.startsWith("单关")
  ) {
    return [1];
  }
  const freeMatch = /^(\d+)串1(?!\d)/.exec(rawMode);
  if (freeMatch) {
    return [Math.max(1, parseInt(freeMatch[1], 10))];
  }
  const comboMatch = /^(\d+)串(\d+)/.exec(rawMode);
  if (comboMatch) {
    const m = parseInt(comboMatch[1], 10);
    const b = parseInt(comboMatch[2], 10);
    const table = OFFICIAL_COMBO_PASS_TABLE[m] || [];
    const entry = table.find((it) => it.code === `${m}x${b}`);
    if (entry && Array.isArray(entry.sizes) && entry.sizes.length > 0) {
      return [...entry.sizes];
    }
    return [m];
  }
  const freeMulti = [...rawMode.matchAll(/(\d+)串1/g)].map((x) =>
    parseInt(x[1], 10)
  );
  if (freeMulti.length > 0) {
    return [...new Set(freeMulti)].sort((a, b) => a - b);
  }
  return [Math.max(1, matchCount)];
}

/**
 * Expand a single `TerminalPhysicalSlip` back into its elementary `¥2` bet multiset
 * (map from canonical basic-bet signature -> integer multiplicity) to machine-verify
 * 100% lossless bijection on every call to `consolidateTerminalPhysicalSlips`.
 */
export function expandTerminalPhysicalSlipMultiset(slip) {
  const counts = new Map();
  if (
    !slip ||
    !Array.isArray(slip.legsByMatch) ||
    slip.legsByMatch.length === 0
  ) {
    return counts;
  }
  const mult = Math.max(1, Math.round(Number(slip.multiple) || 1));
  const groups = slip.legsByMatch;
  const k = groups.length;
  const comboCode = slip.comboCode ? String(slip.comboCode).trim() : "";
  const comboMeta = comboCode
    ? (OFFICIAL_COMBO_PASS_TABLE[k] || []).find((x) => x.code === comboCode)
    : null;

  const tuples = [];
  const walkOpts = (depth, acc) => {
    if (depth === k) {
      tuples.push([...acc]);
      return;
    }
    const g = groups[depth];
    const opts = Array.isArray(g.options) ? g.options : [];
    for (let i = 0; i < opts.length; i++) {
      acc.push({
        matchId: g.matchId,
        poolCode: g.poolCode,
        goalLine: g.goalLine ?? "",
        isBanker: Boolean(g.isBanker),
        optionKey: String(opts[i].optionKey),
      });
      walkOpts(depth + 1, acc);
      acc.pop();
    }
  };
  walkOpts(0, []);

  if (comboMeta) {
    const sizes = comboMeta.sizes;
    for (let t = 0; t < tuples.length; t++) {
      const tup = tuples[t];
      for (let sIdx = 0; sIdx < sizes.length; sIdx++) {
        const subK = sizes[sIdx];
        const chooseSub = (start, chosen) => {
          if (chosen.length === subK) {
            const sig = chosen
              .map(
                (c) => `${c.matchId}:${c.poolCode}:${c.goalLine}:${c.optionKey}`
              )
              .join("|");
            counts.set(sig, (counts.get(sig) || 0) + mult);
            return;
          }
          for (
            let idx = start;
            idx <= tup.length - (subK - chosen.length);
            idx++
          ) {
            chosen.push(tup[idx]);
            chooseSub(idx + 1, chosen);
            chosen.pop();
          }
        };
        chooseSub(0, []);
      }
    }
  } else {
    for (let t = 0; t < tuples.length; t++) {
      const tup = tuples[t];
      const sig = tup
        .map(
          (c) =>
            `${c.matchId}:${c.poolCode}:${c.goalLine}:${c.isBanker ? 1 : 0}:${c.optionKey}`
        )
        .join("|");
      counts.set(sig, (counts.get(sig) || 0) + mult);
    }
  }
  return counts;
}

/**
 * Lossless Multiset Bijection Terminal Physical Slip Consolidator (`ADR-0019` Deliverable 1):
 * - Official unsplit fixed-combo inputs (`line.comboCode` in `OFFICIAL_COMBO_PASS_TABLE[k]`) emit
 *   authentic Sporttery `M串N` physical slips (`comboCode`, `modeLabel: comboMeta.label`,
 *   `passSizes: comboMeta.sizes`, `basicUnitsPerSlip = comboMeta.baseBets`).
 * - Independent/expanded basic lines (`!line.comboCode`) strictly normalize to `comboCode: null`,
 *   `passSizes: [k]` (`k = legsByMatch.length`), and `modeLabel: k === 1 ? "单关" : "${k}串1"`,
 *   merging ONLY tuples with complete Cartesian closure `∏ |O_r|`.
 * - Splits `multiple > 99` into physical slips of `99, ..., rem` (`1 <= multiple <= 99`).
 * - Machine-verifies exact elementary-bet multiset bijection and `costYuan === 2 * basicUnitsPerSlip * multiple`.
 */
export function consolidateTerminalPhysicalSlips(
  lines,
  optionsOrRuleVersion = "sporttery-2026-v1",
  maybeOptions = null
) {
  if (!Array.isArray(lines) || lines.length === 0) return [];
  const opts =
    typeof optionsOrRuleVersion === "object" && optionsOrRuleVersion !== null
      ? optionsOrRuleVersion
      : maybeOptions && typeof maybeOptions === "object"
        ? maybeOptions
        : {};
  const ruleVersion =
    typeof optionsOrRuleVersion === "string" && optionsOrRuleVersion
      ? optionsOrRuleVersion
      : typeof opts.ruleVersion === "string" && opts.ruleVersion
        ? opts.ruleVersion
        : "sporttery-2026-v1";
  const consolidate = opts.consolidate !== false;

  const matchOrderMap = new Map();
  for (let i = 0; i < lines.length; i++) {
    const legs = lines[i]?.legs;
    if (!Array.isArray(legs)) continue;
    for (let j = 0; j < legs.length; j++) {
      const mid = String(legs[j]?.matchId || "");
      if (mid && !matchOrderMap.has(mid)) {
        matchOrderMap.set(mid, matchOrderMap.size);
      }
    }
  }

  let expectedTotalStakeUnits = 0;
  const expectedMultiset = new Map();
  const subBuckets = new Map();
  const seenTupleLayers = new Map();
  const bucketOrder = [];
  const comboTuplesBySig = new Map();
  const comboTupleOrder = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const rawLegs = Array.isArray(line?.legs) ? line.legs : [];
    if (rawLegs.length === 0) continue;

    const mult = Math.max(1, Math.round(Number(line?.multiple) || 1));
    const lineId = String(line?.id || `line-${lineIdx + 1}`);
    const extraSourceIds = Array.isArray(line?.sourceBasicLineIds)
      ? line.sourceBasicLineIds.map((x) => String(x))
      : [lineId];

    const byMatch = new Map();
    for (let j = 0; j < rawLegs.length; j++) {
      const g = rawLegs[j];
      const matchId = String(g?.matchId || `match-${j}`);
      const poolCode = String(g?.poolCode || "HAD");
      const goalLine =
        g?.goalLine !== undefined && g?.goalLine !== null && g?.goalLine !== ""
          ? String(g.goalLine)
          : undefined;
      const isBanker = Boolean(g?.isBanker);
      const groupKey = `${matchId}@@${poolCode}@@${goalLine ?? ""}@@${isBanker ? 1 : 0}`;
      let grp = byMatch.get(groupKey);
      if (!grp) {
        grp = {
          matchId,
          matchNumStr: String(g?.matchNumStr || matchId),
          home: String(g?.home || ""),
          away: String(g?.away || ""),
          kickoff: String(g?.kickoff || ""),
          isBanker,
          poolCode,
          poolName: String(g?.poolName || poolCode),
          goalLine,
          optionsMap: new Map(),
        };
        byMatch.set(groupKey, grp);
      }
      const optKey = String(g?.optionKey || g?.optionLabel || "opt");
      if (!grp.optionsMap.has(optKey)) {
        grp.optionsMap.set(optKey, {
          optionKey: optKey,
          optionLabel: String(g?.optionLabel || optKey),
          odds: Number(g?.odds) || 1,
        });
      }
    }

    const orderedGroups = [...byMatch.values()].sort((a, b) => {
      const oa = matchOrderMap.get(a.matchId) ?? 999999;
      const ob = matchOrderMap.get(b.matchId) ?? 999999;
      if (oa !== ob) return oa - ob;
      return a.poolCode.localeCompare(b.poolCode);
    });
    const k = orderedGroups.length;
    if (k === 0) continue;

    const rawComboCode = line?.comboCode ? String(line.comboCode).trim() : "";
    const hasAnyBanker = orderedGroups.some((g) => g.isBanker);
    const comboMeta =
      rawComboCode && !hasAnyBanker
        ? (OFFICIAL_COMBO_PASS_TABLE[k] || []).find(
            (x) => x.code === rawComboCode
          ) || null
        : null;

    // Expand if an input line carried >1 option on any match
    const optionArrays = orderedGroups.map((g) =>
      [...g.optionsMap.values()].sort((a, b) =>
        comparePoolOptionKeys(g.poolCode, a.optionKey, b.optionKey)
      )
    );
    const tuples = [];
    const buildTuples = (depth, acc) => {
      if (depth === k) {
        tuples.push([...acc]);
        return;
      }
      const opts = optionArrays[depth];
      for (let u = 0; u < opts.length; u++) {
        acc.push(opts[u]);
        buildTuples(depth + 1, acc);
        acc.pop();
      }
    };
    buildTuples(0, []);

    if (comboMeta) {
      expectedTotalStakeUnits += tuples.length * comboMeta.baseBets * mult;
      for (let t = 0; t < tuples.length; t++) {
        const tuple = tuples[t];
        const legsByMatch = orderedGroups.map((meta, idx) => {
          const grpOut = {
            matchId: meta.matchId,
            matchNumStr: meta.matchNumStr,
            home: meta.home,
            away: meta.away,
            kickoff: meta.kickoff,
            poolCode: meta.poolCode,
            poolName: meta.poolName,
            options: [{ ...tuple[idx] }],
          };
          if (meta.goalLine !== undefined) grpOut.goalLine = meta.goalLine;
          return grpOut;
        });
        for (let sIdx = 0; sIdx < comboMeta.sizes.length; sIdx++) {
          const subK = comboMeta.sizes[sIdx];
          const chooseExp = (start, chosen) => {
            if (chosen.length === subK) {
              const sig = chosen
                .map(
                  (c) =>
                    `${c.matchId}:${c.poolCode}:${c.goalLine ?? ""}:${c.options[0].optionKey}`
                )
                .join("|");
              expectedMultiset.set(
                sig,
                (expectedMultiset.get(sig) || 0) + mult
              );
              return;
            }
            for (
              let idx = start;
              idx <= legsByMatch.length - (subK - chosen.length);
              idx++
            ) {
              chosen.push(legsByMatch[idx]);
              chooseExp(idx + 1, chosen);
              chosen.pop();
            }
          };
          chooseExp(0, []);
        }
        const passKey = comboMeta.sizes.join(",");
        const lineSignature = `${comboMeta.code}|${comboMeta.label}|${passKey}|${legsByMatch
          .map(
            (g) =>
              `${g.matchId}:${g.poolCode}${g.goalLine ? `(${g.goalLine})` : ""}=${g.options[0].optionKey}`
          )
          .join("/")}`;
        const comboMergeKey = consolidate
          ? lineSignature
          : `${lineSignature}@@raw#${lineIdx}#${t}`;
        let existing = comboTuplesBySig.get(comboMergeKey);
        if (!existing) {
          existing = {
            comboCode: comboMeta.code,
            modeLabel: comboMeta.label,
            passSizes: [...comboMeta.sizes],
            basicUnitsPerTuple: comboMeta.baseBets,
            multiple: mult,
            legsByMatch,
            sourceIds: [...extraSourceIds],
            lineSignature,
          };
          comboTuplesBySig.set(comboMergeKey, existing);
          comboTupleOrder.push(comboMergeKey);
        } else {
          existing.multiple += mult;
          for (let s = 0; s < extraSourceIds.length; s++) {
            existing.sourceIds.push(extraSourceIds[s]);
          }
        }
      }
      continue;
    }

    // Independent elementary line: strictly k-leg free pass (`单关` or `k串1`) with comboCode: null
    const bankerCount = orderedGroups.filter((g) => g.isBanker).length;
    const passSizes = [k];
    const modeLabel =
      k === 1
        ? "单关"
        : `${k}串1${bankerCount > 0 ? `(${bankerCount}胆)` : ""}`;
    const passKey = String(k);
    const matchSig = orderedGroups
      .map(
        (g) =>
          `${g.matchId}:${g.poolCode}:${g.goalLine ?? ""}:${g.isBanker ? 1 : 0}`
      )
      .join("|");
    const baseBucketKey = `${modeLabel}@@${passKey}@@${mult}@@${matchSig}`;

    expectedTotalStakeUnits += tuples.length * mult;

    let tupleCounter = seenTupleLayers.get(baseBucketKey);
    if (!tupleCounter) {
      tupleCounter = new Map();
      seenTupleLayers.set(baseBucketKey, tupleCounter);
    }

    for (let t = 0; t < tuples.length; t++) {
      const tuple = tuples[t];
      const elemSig = tuple
        .map(
          (o, idx) =>
            `${orderedGroups[idx].matchId}:${orderedGroups[idx].poolCode}:${orderedGroups[idx].goalLine ?? ""}:${orderedGroups[idx].isBanker ? 1 : 0}:${o.optionKey}`
        )
        .join("|");
      expectedMultiset.set(
        elemSig,
        (expectedMultiset.get(elemSig) || 0) + mult
      );

      const tupleSig = tuple.map((o) => o.optionKey).join("|");
      const layerIdx = tupleCounter.get(tupleSig) || 0;
      tupleCounter.set(tupleSig, layerIdx + 1);
      const subKey = `${baseBucketKey}##${layerIdx}`;
      let bucket = subBuckets.get(subKey);
      if (!bucket) {
        bucket = {
          modeLabel,
          passSizes,
          passKey,
          mult,
          matchSig,
          metaGroups: orderedGroups.map((g) => ({
            matchId: g.matchId,
            matchNumStr: g.matchNumStr,
            home: g.home,
            away: g.away,
            kickoff: g.kickoff,
            isBanker: g.isBanker,
            poolCode: g.poolCode,
            poolName: g.poolName,
            goalLine: g.goalLine,
          })),
          boxes: [],
        };
        subBuckets.set(subKey, bucket);
        bucketOrder.push(subKey);
      }
      bucket.boxes.push({
        optionMaps: tuple.map((o) => new Map([[o.optionKey, o]])),
        sourceIds: [...extraSourceIds],
      });
    }
  }

  // Factor each elementary sub-bucket one match dimension at a time (100% exact Cartesian closure)
  const mergedIdenticalBoxes = new Map();
  const mergedBoxOrder = [];

  for (let cIdx = 0; cIdx < comboTupleOrder.length; cIdx++) {
    const cSig = comboTupleOrder[cIdx];
    mergedIdenticalBoxes.set(cSig, comboTuplesBySig.get(cSig));
    mergedBoxOrder.push(cSig);
  }

  for (let bIdx = 0; bIdx < bucketOrder.length; bIdx++) {
    const bucket = subBuckets.get(bucketOrder[bIdx]);
    const k = bucket.metaGroups.length;
    let boxes = bucket.boxes;

    if (consolidate) {
      for (let dim = 0; dim < k; dim++) {
        if (boxes.length <= 1) break;
        const grouped = new Map();
        const groupKeys = [];
        for (let i = 0; i < boxes.length; i++) {
          const bx = boxes[i];
          const otherParts = [];
          for (let j = 0; j < k; j++) {
            if (j === dim) continue;
            const sortedKeys = [...bx.optionMaps[j].keys()].sort((a, b) =>
              comparePoolOptionKeys(bucket.metaGroups[j].poolCode, a, b)
            );
            otherParts.push(`${j}:${sortedKeys.join("+")}`);
          }
          const otherSig = otherParts.join("|");
          let list = grouped.get(otherSig);
          if (!list) {
            list = [];
            grouped.set(otherSig, list);
            groupKeys.push(otherSig);
          }
          list.push(bx);
        }

        const nextBoxes = [];
        for (let gIdx = 0; gIdx < groupKeys.length; gIdx++) {
          const list = grouped.get(groupKeys[gIdx]);
          if (list.length === 1) {
            nextBoxes.push(list[0]);
            continue;
          }
          const unionDimMap = new Map();
          const combinedSourceIds = [];
          for (let u = 0; u < list.length; u++) {
            for (const [ok, ov] of list[u].optionMaps[dim].entries()) {
              unionDimMap.set(ok, ov);
            }
            for (let s = 0; s < list[u].sourceIds.length; s++) {
              combinedSourceIds.push(list[u].sourceIds[s]);
            }
          }
          const nextMaps = list[0].optionMaps.map((mp, idx) =>
            idx === dim ? unionDimMap : mp
          );
          nextBoxes.push({
            optionMaps: nextMaps,
            sourceIds: combinedSourceIds,
          });
        }
        boxes = nextBoxes;
      }
    }

    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      const legsByMatch = bucket.metaGroups.map((meta, idx) => {
        const options = [...bx.optionMaps[idx].values()].sort((a, b) =>
          comparePoolOptionKeys(meta.poolCode, a.optionKey, b.optionKey)
        );
        const grpOut = {
          matchId: meta.matchId,
          matchNumStr: meta.matchNumStr,
          home: meta.home,
          away: meta.away,
          kickoff: meta.kickoff,
          poolCode: meta.poolCode,
          poolName: meta.poolName,
          options,
        };
        if (meta.isBanker) grpOut.isBanker = true;
        if (meta.goalLine !== undefined) grpOut.goalLine = meta.goalLine;
        return grpOut;
      });
      const lineSignature = `free|${bucket.modeLabel}|${bucket.passKey}|${legsByMatch
        .map(
          (g) =>
            `${g.matchId}:${g.poolCode}${g.goalLine ? `(${g.goalLine})` : ""}${
              g.isBanker ? "[B]" : ""
            }=${g.options.map((o) => o.optionKey).join("+")}`
        )
        .join("/")}`;
      const mergeKey = consolidate
        ? lineSignature
        : `${lineSignature}@@raw#${bIdx}#${i}`;

      let existing = mergedIdenticalBoxes.get(mergeKey);
      if (!existing) {
        existing = {
          comboCode: null,
          modeLabel: bucket.modeLabel,
          passSizes: bucket.passSizes,
          basicUnitsPerTuple: null,
          multiple: bucket.mult,
          legsByMatch,
          sourceIds: [...bx.sourceIds],
          lineSignature,
        };
        mergedIdenticalBoxes.set(mergeKey, existing);
        mergedBoxOrder.push(mergeKey);
      } else {
        existing.multiple += bucket.mult;
        for (let s = 0; s < bx.sourceIds.length; s++) {
          existing.sourceIds.push(bx.sourceIds[s]);
        }
      }
    }
  }

  // Split >99x multiples into terminal-legal physical slips (1 <= multiple <= 99)
  const physicalSlips = [];
  let actualTotalStakeUnits = 0;
  const actualMultiset = new Map();

  for (let i = 0; i < mergedBoxOrder.length; i++) {
    const item = mergedIdenticalBoxes.get(mergedBoxOrder[i]);
    const optionProd = item.legsByMatch.reduce(
      (acc, g) => acc * g.options.length,
      1
    );
    const basicUnitsPerSlip = item.comboCode
      ? optionProd * item.basicUnitsPerTuple
      : optionProd;
    const matchIds = item.legsByMatch.map((g) => g.matchId);
    const dedupSourceIds = [...new Set(item.sourceIds)];
    let remMult = item.multiple;
    while (remMult > 0) {
      const chunkMult = Math.min(99, remMult);
      remMult -= chunkMult;
      const slipNo = physicalSlips.length + 1;
      const stakeUnits2Yuan = basicUnitsPerSlip * chunkMult;
      actualTotalStakeUnits += stakeUnits2Yuan;
      const slipObj = {
        slipNo,
        slipId: `slip-${slipNo}`,
        comboCode: item.comboCode ?? null,
        modeLabel: item.modeLabel,
        passSizes: [...item.passSizes],
        multiple: chunkMult,
        basicUnitsPerSlip,
        stakeUnits2Yuan,
        costYuan: stakeUnits2Yuan * 2,
        matchIds: [...matchIds],
        legsByMatch: item.legsByMatch.map((g) => ({
          ...g,
          options: g.options.map((o) => ({ ...o })),
        })),
        sourceBasicLineIds: [...dedupSourceIds],
        lineSignature: item.lineSignature,
        ruleVersion,
      };
      physicalSlips.push(slipObj);
      const subCounts = expandTerminalPhysicalSlipMultiset(slipObj);
      for (const [sig, cnt] of subCounts.entries()) {
        actualMultiset.set(sig, (actualMultiset.get(sig) || 0) + cnt);
      }
    }
  }

  if (
    actualTotalStakeUnits !== expectedTotalStakeUnits ||
    actualMultiset.size !== expectedMultiset.size
  ) {
    throw new Error(
      `Slip consolidation multiset invariant violated: actual=${actualTotalStakeUnits} (${actualMultiset.size}), expected=${expectedTotalStakeUnits} (${expectedMultiset.size})`
    );
  }
  for (const [sig, expCnt] of expectedMultiset.entries()) {
    if (actualMultiset.get(sig) !== expCnt) {
      throw new Error(
        `Slip consolidation multiset mismatch on ${sig}: actual=${actualMultiset.get(sig)}, expected=${expCnt}`
      );
    }
  }

  return physicalSlips;
}

function pruneDominatedBreakevenBuckets(rawBuckets, K) {
  const uniqueMap = new Map();
  for (let s = 0; s < rawBuckets.length; s++) {
    const row = rawBuckets[s];
    if (!row || row.length < K) continue;
    let maxVal = 0;
    let sumVal = 0;
    const arr = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      const v = Math.max(0, Math.round(Number(row[i]) || 0));
      arr[i] = v;
      if (v > maxVal) maxVal = v;
      sumVal += v;
    }
    if (maxVal <= 0) continue;
    const sig = Array.from(arr).join(",");
    if (!uniqueMap.has(sig)) {
      uniqueMap.set(sig, { arr, maxVal, sumVal });
    }
  }

  const candidates = [...uniqueMap.values()].sort(
    (a, b) => a.sumVal - b.sumVal
  );
  const minimal = [];
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    let dominated = false;
    for (let j = 0; j < minimal.length; j++) {
      const m = minimal[j].arr;
      let leAll = true;
      for (let col = 0; col < K; col++) {
        if (m[col] > cand.arr[col]) {
          leAll = false;
          break;
        }
      }
      if (leAll) {
        dominated = true;
        break;
      }
    }
    if (!dominated) minimal.push(cand);
  }

  const minSingleCents = new Float64Array(K);
  minSingleCents.fill(Infinity);
  let allSingleWinner = minimal.length > 0;

  for (let s = 0; s < minimal.length; s++) {
    const arr = minimal[s].arr;
    let nzCount = 0;
    let nzIdx = -1;
    for (let i = 0; i < K; i++) {
      if (arr[i] > 0) {
        nzCount += 1;
        nzIdx = i;
        if (nzCount > 1) break;
      }
    }
    if (nzCount === 1) {
      if (arr[nzIdx] < minSingleCents[nzIdx]) {
        minSingleCents[nzIdx] = arr[nzIdx];
      }
    } else {
      allSingleWinner = false;
    }
  }

  return {
    buckets: minimal.map((x) => x.arr),
    minSingleCents,
    allSingleWinner,
  };
}

/**
 * Independent $O(B \cdot K)$ machine verifier for integer breakeven witness `mults`:
 * checks `length === K`, every `m_i` integer in `1..999`, `sum(m_i) === targetN`,
 * and `(H m)_b >= 200 * targetN` across all valid rows.
 */
export function verifyBreakevenWitness(
  bucketsCents,
  K,
  targetN,
  mults,
  maxNotesCap = 10_000
) {
  if (
    !Number.isInteger(K) ||
    K <= 0 ||
    !Number.isInteger(targetN) ||
    targetN < K ||
    targetN > 999 * K ||
    targetN > maxNotesCap
  ) {
    return false;
  }
  if (!Array.isArray(mults) || mults.length !== K) return false;
  let sumM = 0;
  for (let i = 0; i < K; i++) {
    const m = mults[i];
    if (!Number.isInteger(m) || m < 1 || m > 999) return false;
    sumM += m;
  }
  if (sumM !== targetN) return false;
  if (!Array.isArray(bucketsCents) || bucketsCents.length === 0) return false;

  const targetCents = 200 * targetN;
  let checkedRows = 0;
  for (let s = 0; s < bucketsCents.length; s++) {
    const row = bucketsCents[s];
    if (!row || row.length < K) continue;
    let hasPositive = false;
    let pay = 0;
    for (let i = 0; i < K; i++) {
      const v = Math.max(0, Math.round(Number(row[i]) || 0));
      if (v > 0) hasPositive = true;
      pay += v * mults[i];
    }
    if (!hasPositive) continue;
    checkedRows += 1;
    if (pay < targetCents) return false;
  }
  return checkedRows > 0;
}

function checkGlobalDualInfeasibility(buckets, K) {
  const B = buckets.length;
  if (B === 0) return false;
  for (let s = 0; s < B; s++) {
    let rowMax = 0;
    let nzCount = 0;
    for (let i = 0; i < K; i++) {
      if (buckets[s][i] > 0) nzCount += 1;
      if (buckets[s][i] > rowMax) rowMax = buckets[s][i];
    }
    if (rowMax < 200) return true;
    if (K > 1 && nzCount === 1 && rowMax <= 200) return true;
  }
  if (B === 1) return false;

  const y = new Float64Array(B);
  y.fill(1 / B);
  const colSums = new Float64Array(K);

  for (let iter = 0; iter < 56; iter++) {
    colSums.fill(0);
    for (let s = 0; s < B; s++) {
      const ys = y[s];
      const row = buckets[s];
      for (let i = 0; i < K; i++) {
        colSums[i] += ys * row[i];
      }
    }
    let bestCol = 0;
    let maxColVal = colSums[0];
    for (let i = 1; i < K; i++) {
      if (colSums[i] > maxColVal) {
        maxColVal = colSums[i];
        bestCol = i;
      }
    }
    if (maxColVal < 200 - 1e-7) {
      let sumW = 0;
      const wInt = new Int32Array(B);
      for (let s = 0; s < B; s++) {
        const w = Math.max(0, Math.round(y[s] * 65536));
        wInt[s] = w;
        sumW += w;
      }
      if (sumW > 0) {
        let maxIntCol = 0;
        for (let i = 0; i < K; i++) {
          let acc = 0;
          for (let s = 0; s < B; s++) acc += wInt[s] * buckets[s][i];
          if (acc > maxIntCol) maxIntCol = acc;
        }
        if (maxIntCol < 200 * sumW) return true;
      }
    }
    const eta = 0.45 / Math.sqrt(1 + iter * 0.35);
    let z = 0;
    for (let s = 0; s < B; s++) {
      const scaled = buckets[s][bestCol] / Math.max(200, maxColVal);
      y[s] *= Math.exp(-eta * scaled);
      z += y[s];
    }
    if (z <= 0) break;
    for (let s = 0; s < B; s++) y[s] /= z;
  }
  return false;
}

/**
 * Exact lossless bound propagation on `m in [lo, hi]^K` with `sum(m) === N` and `H m >= 200 N`:
 * - Sum coupling: `lo_i >= N - sum_{j != i} hi_j` and `hi_i <= N - sum_{j != i} lo_j`.
 * - Row box upper-bound propagation: `H_{b,i} m_i + sum_{j != i} H_{b,j} hi_j >= 200 N`.
 * - Row cardinality-aware top-2 tightening over `d_j = m_j - lo_j >= 0, sum d_j = N - sumLo`.
 * Returns `false` ONLY when `[lo, hi]` contains ZERO valid solutions.
 */
function propagateBreakevenBounds(buckets, B, K, N, lo, hi) {
  const T = 200 * N;
  let changed = true;
  while (changed) {
    changed = false;
    let sumLo = 0;
    let sumHi = 0;
    for (let i = 0; i < K; i++) {
      if (lo[i] > hi[i]) return false;
      sumLo += lo[i];
      sumHi += hi[i];
    }
    if (sumLo > N || sumHi < N) return false;

    for (let i = 0; i < K; i++) {
      const maxAllowed = N - (sumLo - lo[i]);
      if (maxAllowed < hi[i]) {
        hi[i] = maxAllowed;
        if (lo[i] > hi[i]) return false;
        sumHi -= hi[i] < maxAllowed ? 0 : 0;
        changed = true;
      }
      const minRequired = N - (sumHi - hi[i]);
      if (minRequired > lo[i]) {
        sumLo += minRequired - lo[i];
        lo[i] = minRequired;
        if (lo[i] > hi[i] || sumLo > N) return false;
        changed = true;
      }
    }
    if (changed) continue;

    const rem = N - sumLo;
    for (let s = 0; s < B; s++) {
      const row = buckets[s];
      let sumRowLo = 0;
      let sumRowHi = 0;
      let max1 = 0;
      let max1Idx = -1;
      let max2 = 0;
      for (let i = 0; i < K; i++) {
        const v = row[i];
        if (v <= 0) continue;
        sumRowLo += v * lo[i];
        sumRowHi += v * hi[i];
        if (hi[i] > lo[i]) {
          if (v > max1) {
            max2 = max1;
            max1 = v;
            max1Idx = i;
          } else if (v > max2) {
            max2 = v;
          }
        }
      }
      if (sumRowHi < T) return false;
      if (sumRowLo + rem * max1 < T) return false;

      // Exact row box lower-bound propagation on every positive column
      for (let i = 0; i < K; i++) {
        const v = row[i];
        if (v <= 0 || hi[i] <= lo[i]) continue;
        const otherMax = sumRowHi - v * hi[i];
        if (otherMax < T) {
          const reqLo = Math.ceil((T - otherMax - 1e-9) / v);
          if (reqLo > hi[i]) return false;
          if (reqLo > lo[i]) {
            sumLo += reqLo - lo[i];
            lo[i] = reqLo;
            if (sumLo > N) return false;
            changed = true;
          }
        }
      }
      if (changed) break;

      // Exact cardinality-coupled top-2 lower-bound propagation
      if (max1Idx >= 0 && max1 > max2 && sumRowLo + rem * max2 < T) {
        const reqDelta = Math.ceil(
          (T - sumRowLo - rem * max2 - 1e-9) / (max1 - max2)
        );
        if (reqDelta > 0) {
          const nextLo = lo[max1Idx] + reqDelta;
          if (nextLo > hi[max1Idx] || sumLo + reqDelta > N) return false;
          lo[max1Idx] = nextLo;
          sumLo += reqDelta;
          changed = true;
          break;
        }
      }
    }
  }
  return true;
}

/**
 * Dual convex-combination Farkas test over boxed simplex `{ m in [lo, hi]^K : sum(m) === N }`:
 * - Evaluates exact greedy maximization of `sum_i c_i(lambda) m_i` on `[lo, hi]^K, sum m_i = N`.
 * - If primal extreme point `m*(lambda)` satisfies `H m*(lambda) >= 200 N`, returns `{ witness }`!
 * - If integer-rounded dual weights `W_s >= 0` certify `max_{m in box} (W^T H m) < 200 N * sum(W)`,
 *   returns `{ infeasible: true }` (100% machine-verifiable integer Farkas certificate!).
 */
function runBoxedFarkasDualCheck(buckets, B, K, N, lo, hi, maxIters = 48) {
  const T = 200 * N;
  let sumLo = 0;
  for (let i = 0; i < K; i++) sumLo += lo[i];
  const rem = N - sumLo;
  if (rem < 0) return { infeasible: true, witness: null };

  const y = new Float64Array(B);
  y.fill(1 / B);
  const c = new Float64Array(K);
  const order = Array.from({ length: K }, (_, idx) => idx);
  const candM = new Int32Array(K);
  const rowPay = new Float64Array(B);

  for (let iter = 0; iter < maxIters; iter++) {
    c.fill(0);
    for (let s = 0; s < B; s++) {
      const ys = y[s];
      if (ys <= 0) continue;
      const row = buckets[s];
      for (let i = 0; i < K; i++) c[i] += ys * row[i];
    }

    order.sort((a, b) => c[b] - c[a] || a - b);
    let rLeft = rem;
    let dualUpper = 0;
    for (let idx = 0; idx < K; idx++) {
      const col = order[idx];
      const cap = hi[col] - lo[col];
      const add = rLeft > 0 && cap > 0 ? Math.min(rLeft, cap) : 0;
      const val = lo[col] + add;
      candM[col] = val;
      rLeft -= add;
      dualUpper += c[col] * val;
    }
    if (rLeft > 0) return { infeasible: true, witness: null };

    if (dualUpper < T - 1e-7) {
      let sumW = 0;
      const wInt = new Int32Array(B);
      for (let s = 0; s < B; s++) {
        const w = Math.max(0, Math.round(y[s] * 65536));
        wInt[s] = w;
        sumW += w;
      }
      if (sumW > 0) {
        const cInt = new Float64Array(K);
        for (let i = 0; i < K; i++) {
          let acc = 0;
          for (let s = 0; s < B; s++) acc += wInt[s] * buckets[s][i];
          cInt[i] = acc;
        }
        order.sort((a, b) => cInt[b] - cInt[a] || a - b);
        let rInt = rem;
        let maxIntObj = 0;
        for (let idx = 0; idx < K; idx++) {
          const col = order[idx];
          const add =
            rInt > 0 && hi[col] > lo[col]
              ? Math.min(rInt, hi[col] - lo[col])
              : 0;
          maxIntObj += cInt[col] * (lo[col] + add);
          rInt -= add;
        }
        if (rInt === 0 && maxIntObj < T * sumW) {
          return { infeasible: true, witness: null };
        }
      }
    }

    let minRow = Infinity;
    for (let s = 0; s < B; s++) {
      let p = 0;
      const row = buckets[s];
      for (let i = 0; i < K; i++) p += row[i] * candM[i];
      rowPay[s] = p;
      if (p < minRow) minRow = p;
    }
    if (minRow >= T) {
      return { infeasible: false, witness: Array.from(candM) };
    }

    const eta = 0.55 / Math.sqrt(1 + iter * 0.35);
    let z = 0;
    for (let s = 0; s < B; s++) {
      const scaledSlack = (rowPay[s] - T) / Math.max(200, T);
      y[s] *= Math.exp(-eta * Math.max(-4, Math.min(4, scaledSlack)));
      z += y[s];
    }
    if (z <= 0 || !Number.isFinite(z)) break;
    for (let s = 0; s < B; s++) y[s] /= z;
  }

  return { infeasible: false, witness: null };
}

/**
 * Solve integer breakeven feasibility `F(N)` at a single exact total stake-units count `N`:
 * `m_i in [1, 999]`, `sum(m_i) === N`, `min_s (a_s · m) >= 200 * N`.
 * Completeness guarantee: NEVER uses lossy column skipping; only returns `"certified-infeasible"`
 * via lossless bound propagation, exact integer Farkas certificate, or exhaustive B&B tree search.
 */
export function solveJointBreakevenAtNotes(
  prunedInfo,
  K,
  targetN,
  deadlineMs = Infinity,
  {
    candidateMults = null,
    rawBuckets = null,
    nodeBudget = 40_000,
    maxNotesCap = 10_000,
  } = {}
) {
  if (
    !Number.isInteger(K) ||
    K <= 0 ||
    !Number.isInteger(targetN) ||
    targetN < K ||
    targetN > 999 * K ||
    targetN > maxNotesCap
  ) {
    return {
      status: "certified-infeasible",
      proofStatus: "certified",
      mults: null,
    };
  }
  const N = targetN;
  const { buckets, minSingleCents, allSingleWinner } = prunedInfo;
  const verifyTarget = Array.isArray(rawBuckets) ? rawBuckets : buckets;
  const B = buckets.length;
  if (B === 0) {
    return {
      status: "certified-infeasible",
      proofStatus: "certified",
      mults: null,
    };
  }

  if (
    Array.isArray(candidateMults) &&
    verifyBreakevenWitness(verifyTarget, K, N, candidateMults, maxNotesCap)
  ) {
    return {
      status: "certified-feasible",
      proofStatus: "certified",
      mults: Array.from(candidateMults),
    };
  }

  const T = 200 * N;
  const lo = new Int32Array(K);
  const hi = new Int32Array(K);
  let sumLb = 0;
  for (let i = 0; i < K; i++) {
    const sc = minSingleCents[i];
    const req = sc < Infinity ? Math.max(1, Math.ceil((T - 1e-9) / sc)) : 1;
    if (req > 999) {
      return {
        status: "certified-infeasible",
        proofStatus: "certified",
        mults: null,
      };
    }
    lo[i] = req;
    hi[i] = 999;
    sumLb += req;
    if (sumLb > N) {
      return {
        status: "certified-infeasible",
        proofStatus: "certified",
        mults: null,
      };
    }
  }

  if (allSingleWinner) {
    const mults = Array.from(lo);
    let rem = N - sumLb;
    for (let i = 0; i < K && rem > 0; i++) {
      const add = Math.min(rem, 999 - mults[i]);
      mults[i] += add;
      rem -= add;
    }
    if (
      rem === 0 &&
      verifyBreakevenWitness(verifyTarget, K, N, mults, maxNotesCap)
    ) {
      return { status: "certified-feasible", proofStatus: "certified", mults };
    }
    return {
      status: "certified-infeasible",
      proofStatus: "certified",
      mults: null,
    };
  }

  if (!propagateBreakevenBounds(buckets, B, K, N, lo, hi)) {
    return {
      status: "certified-infeasible",
      proofStatus: "certified",
      mults: null,
    };
  }

  let sumLoAfterProp = 0;
  for (let i = 0; i < K; i++) sumLoAfterProp += lo[i];
  const remAfterLb = N - sumLoAfterProp;

  if (remAfterLb === 0) {
    const fixedMults = Array.from(lo);
    if (verifyBreakevenWitness(verifyTarget, K, N, fixedMults, maxNotesCap)) {
      return {
        status: "certified-feasible",
        proofStatus: "certified",
        mults: fixedMults,
      };
    }
    return {
      status: "certified-infeasible",
      proofStatus: "certified",
      mults: null,
    };
  }

  const dualRes = runBoxedFarkasDualCheck(buckets, B, K, N, lo, hi, 56);
  if (dualRes.infeasible) {
    return {
      status: "certified-infeasible",
      proofStatus: "lp-infeasible",
      mults: null,
    };
  }
  if (
    dualRes.witness &&
    verifyBreakevenWitness(verifyTarget, K, N, dualRes.witness, maxNotesCap)
  ) {
    return {
      status: "certified-feasible",
      proofStatus: "certified",
      mults: dualRes.witness,
    };
  }

  // Constructive minimax greedy + 2-opt swap + violated-row repair within [lo, hi]
  const mults = Array.from(lo);
  const curPay = new Float64Array(B);
  for (let s = 0; s < B; s++) {
    let p = 0;
    for (let i = 0; i < K; i++) p += buckets[s][i] * mults[i];
    curPay[s] = p;
  }
  let rem = remAfterLb;

  while (rem > 0) {
    let minP = Infinity;
    for (let s = 0; s < B; s++) {
      if (curPay[s] < minP) minP = curPay[s];
    }
    const critThreshold = minP + 200;
    let bestCol = -1;
    let bestMinLift = -1;
    let bestSoftSum = -1;
    for (let i = 0; i < K; i++) {
      if (mults[i] >= hi[i]) continue;
      let nextMin = Infinity;
      let softSum = 0;
      for (let s = 0; s < B; s++) {
        const np = curPay[s] + buckets[s][i];
        if (np < nextMin) nextMin = np;
        if (curPay[s] <= critThreshold) softSum += buckets[s][i];
      }
      if (
        nextMin > bestMinLift ||
        (nextMin === bestMinLift && softSum > bestSoftSum)
      ) {
        bestMinLift = nextMin;
        bestSoftSum = softSum;
        bestCol = i;
      }
    }
    if (bestCol === -1) break;
    mults[bestCol] += 1;
    for (let s = 0; s < B; s++) curPay[s] += buckets[s][bestCol];
    rem -= 1;
  }

  const evalMinAndTies = (arrPay) => {
    let mn = Infinity;
    let ties = 0;
    for (let s = 0; s < B; s++) {
      const v = arrPay[s];
      if (v < mn) {
        mn = v;
        ties = 1;
      } else if (v === mn) {
        ties += 1;
      }
    }
    return { mn, ties };
  };

  let curStat = evalMinAndTies(curPay);
  if (
    curStat.mn >= T &&
    verifyBreakevenWitness(verifyTarget, K, N, mults, maxNotesCap)
  ) {
    return { status: "certified-feasible", proofStatus: "certified", mults };
  }

  for (let pass = 0; pass < 40 && curStat.mn < T; pass++) {
    let improved = false;
    for (let addIdx = 0; addIdx < K && !improved; addIdx++) {
      if (mults[addIdx] >= hi[addIdx]) continue;
      for (let subIdx = 0; subIdx < K; subIdx++) {
        if (addIdx === subIdx || mults[subIdx] <= lo[subIdx]) continue;
        let nextMn = Infinity;
        let nextTies = 0;
        for (let s = 0; s < B; s++) {
          const np = curPay[s] + buckets[s][addIdx] - buckets[s][subIdx];
          if (np < nextMn) {
            nextMn = np;
            nextTies = 1;
          } else if (np === nextMn) {
            nextTies += 1;
          }
        }
        if (
          nextMn > curStat.mn ||
          (nextMn === curStat.mn && nextTies < curStat.ties)
        ) {
          mults[addIdx] += 1;
          mults[subIdx] -= 1;
          for (let s = 0; s < B; s++) {
            curPay[s] += buckets[s][addIdx] - buckets[s][subIdx];
          }
          curStat = { mn: nextMn, ties: nextTies };
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  if (
    curStat.mn >= T &&
    verifyBreakevenWitness(verifyTarget, K, N, mults, maxNotesCap)
  ) {
    return { status: "certified-feasible", proofStatus: "certified", mults };
  }

  if (Date.now() > deadlineMs) {
    return {
      status: "unknown",
      proofStatus: "time-budget-unproved",
      mults: null,
    };
  }

  // Exact complete fixed-variable-order Branch-and-Bound (`idx = 0..K-1`, binary domain splitting + full propagation)
  const varOrder = Array.from({ length: K }, (_, i) => i).sort((a, b) => {
    const spanA = hi[a] - lo[a];
    const spanB = hi[b] - lo[b];
    if (spanA !== spanB) return spanA - spanB;
    return a - b;
  });

  let nodes = 0;
  let abortedByBudget = false;
  let foundWitness = null;
  const maxNodes = Math.max(256, Math.floor(Number(nodeBudget) || 40_000));

  const bnb = (curLo, curHi) => {
    nodes += 1;
    if (nodes > maxNodes || ((nodes & 31) === 0 && Date.now() > deadlineMs)) {
      abortedByBudget = true;
      return false;
    }

    if (!propagateBreakevenBounds(buckets, B, K, N, curLo, curHi)) {
      return false;
    }

    // Pick first unfixed variable in fixed order `varOrder`
    let branchVar = -1;
    for (let p = 0; p < K; p++) {
      const idx = varOrder[p];
      if (curLo[idx] < curHi[idx]) {
        branchVar = idx;
        break;
      }
    }

    if (branchVar === -1) {
      const leaf = Array.from(curLo);
      if (verifyBreakevenWitness(verifyTarget, K, N, leaf, maxNotesCap)) {
        foundWitness = leaf;
        return true;
      }
      return false;
    }

    if (nodes > 4 && (nodes & 7) === 1 && B >= 3) {
      const subDual = runBoxedFarkasDualCheck(
        buckets,
        B,
        K,
        N,
        curLo,
        curHi,
        12
      );
      if (subDual.infeasible) return false;
      if (
        subDual.witness &&
        verifyBreakevenWitness(verifyTarget, K, N, subDual.witness, maxNotesCap)
      ) {
        foundWitness = subDual.witness;
        return true;
      }
    }

    const vLo = curLo[branchVar];
    const vHi = curHi[branchVar];
    const mid = Math.floor((vLo + vHi) / 2);
    const preferUpper = mults[branchVar] > mid;

    const tryHalf = (halfLo, halfHi) => {
      const nextLo = Int32Array.from(curLo);
      const nextHi = Int32Array.from(curHi);
      nextLo[branchVar] = halfLo;
      nextHi[branchVar] = halfHi;
      return bnb(nextLo, nextHi);
    };

    if (preferUpper) {
      if (tryHalf(mid + 1, vHi)) return true;
      if (abortedByBudget) return false;
      return tryHalf(vLo, mid);
    }
    if (tryHalf(vLo, mid)) return true;
    if (abortedByBudget) return false;
    return tryHalf(mid + 1, vHi);
  };

  if (bnb(Int32Array.from(lo), Int32Array.from(hi)) && foundWitness) {
    return {
      status: "certified-feasible",
      proofStatus: "certified",
      mults: foundWitness,
    };
  }
  if (abortedByBudget) {
    return {
      status: "unknown",
      proofStatus: "time-budget-unproved",
      mults: null,
    };
  }
  return {
    status: "certified-infeasible",
    proofStatus: "certified",
    mults: null,
  };
}

/**
 * Certify joint breakeven (`minFeasibleBudget`, `isCurrentFeasible`, `nextFeasibleBudget`)
 * WITHOUT assuming monotonicity of `F(N)` (`ADR-0019` Deliverable 6).
 */
export function certifyAndSolveJointBreakeven(
  bucketsCents,
  ticketCount,
  currentNotes,
  {
    timeBudgetMs = 15,
    maxScanNotes = 10_000,
    zeroPayoutProb = 0,
    baseMultiples = null,
    candidateMults = null,
    nodeBudget = 40_000,
  } = {}
) {
  const K = Number.isInteger(ticketCount)
    ? ticketCount
    : Math.floor(Number(ticketCount) || 0);
  const rawCurrentNotes = Number(currentNotes);
  const maxNotesCap = Math.min(
    10_000,
    Math.max(0, Math.floor(Number(maxScanNotes) || 10_000))
  );

  if (K <= 0 || !Array.isArray(bucketsCents) || bucketsCents.length === 0) {
    return {
      cert: {
        minFeasibleBudget: null,
        isCurrentFeasible: "certified-infeasible",
        nextFeasibleBudget: null,
        proofStatus: "certified",
        conditionalFloorAtCurrent: 0,
        zeroPayoutProb,
      },
      feasibleMultsAtCurrent: null,
      minFeasibleMults: null,
      nextFeasibleMults: null,
      prunedInfo: null,
    };
  }

  const isCurrentInLegalDomain =
    Number.isInteger(rawCurrentNotes) &&
    rawCurrentNotes >= K &&
    rawCurrentNotes <= 999 * K &&
    rawCurrentNotes <= 10_000;

  let conditionalFloorAtCurrent = null;
  if (Array.isArray(baseMultiples) && baseMultiples.length === K) {
    let minCents = Infinity;
    for (let s = 0; s < bucketsCents.length; s++) {
      const row = bucketsCents[s];
      if (!row || row.length < K) continue;
      let pay = 0;
      for (let i = 0; i < K; i++)
        pay += (Number(row[i]) || 0) * baseMultiples[i];
      if (pay < minCents) minCents = pay;
    }
    if (minCents < Infinity) {
      conditionalFloorAtCurrent = Number((minCents / 100).toFixed(2));
    }
  }

  const fastSingletonMin = new Float64Array(K);
  fastSingletonMin.fill(Infinity);
  let hasSub200Row = false;
  let validRowCount = 0;
  for (let s = 0; s < bucketsCents.length; s++) {
    const row = bucketsCents[s];
    if (!row || row.length < K) continue;
    let nzCount = 0;
    let nzIdx = -1;
    let rowMax = 0;
    for (let i = 0; i < K; i++) {
      const v = Math.max(0, Math.round(Number(row[i]) || 0));
      if (v > 0) {
        nzCount += 1;
        nzIdx = i;
        if (v > rowMax) rowMax = v;
      }
    }
    if (rowMax <= 0) continue;
    validRowCount += 1;
    if (rowMax < 200 || (K > 1 && nzCount === 1 && rowMax <= 200)) {
      hasSub200Row = true;
      break;
    }
    if (nzCount === 1 && rowMax < fastSingletonMin[nzIdx]) {
      fastSingletonMin[nzIdx] = rowMax;
    }
  }
  let invSingletonSum = 0;
  if (!hasSub200Row && validRowCount > 0) {
    for (let i = 0; i < K; i++) {
      if (fastSingletonMin[i] < Infinity) {
        invSingletonSum += 200 / fastSingletonMin[i];
      }
    }
  }
  if (validRowCount === 0 || hasSub200Row || invSingletonSum > 1 + 1e-11) {
    return {
      cert: {
        minFeasibleBudget: null,
        isCurrentFeasible: "certified-infeasible",
        nextFeasibleBudget: null,
        proofStatus: "lp-infeasible",
        conditionalFloorAtCurrent,
        zeroPayoutProb,
      },
      feasibleMultsAtCurrent: null,
      minFeasibleMults: null,
      nextFeasibleMults: null,
      prunedInfo: null,
    };
  }

  const totalBudgetMs = Math.max(2, Number(timeBudgetMs) || 15);
  const nowStart = Date.now();
  const curDeadlineMs = nowStart + Math.max(2, Math.ceil(totalBudgetMs * 0.65));
  const scanDeadlineMs = nowStart + totalBudgetMs;
  const prunedInfo = pruneDominatedBreakevenBuckets(bucketsCents, K);

  if (
    prunedInfo.buckets.length === 0 ||
    checkGlobalDualInfeasibility(prunedInfo.buckets, K)
  ) {
    return {
      cert: {
        minFeasibleBudget: null,
        isCurrentFeasible: "certified-infeasible",
        nextFeasibleBudget: null,
        proofStatus: "lp-infeasible",
        conditionalFloorAtCurrent,
        zeroPayoutProb,
      },
      feasibleMultsAtCurrent: null,
      minFeasibleMults: null,
      nextFeasibleMults: null,
      prunedInfo,
    };
  }

  let curSolve;
  if (!isCurrentInLegalDomain) {
    curSolve = {
      status: "certified-infeasible",
      proofStatus: "certified",
      mults: null,
    };
  } else if (
    Array.isArray(candidateMults) &&
    verifyBreakevenWitness(
      bucketsCents,
      K,
      rawCurrentNotes,
      candidateMults,
      10_000
    )
  ) {
    curSolve = {
      status: "certified-feasible",
      proofStatus: "certified",
      mults: Array.from(candidateMults),
    };
  } else if (
    Array.isArray(baseMultiples) &&
    verifyBreakevenWitness(
      bucketsCents,
      K,
      rawCurrentNotes,
      baseMultiples,
      10_000
    )
  ) {
    curSolve = {
      status: "certified-feasible",
      proofStatus: "certified",
      mults: Array.from(baseMultiples),
    };
  } else {
    curSolve = solveJointBreakevenAtNotes(
      prunedInfo,
      K,
      rawCurrentNotes,
      curDeadlineMs,
      {
        candidateMults,
        rawBuckets: bucketsCents,
        nodeBudget,
        maxNotesCap: 10_000,
      }
    );
  }
  const isCurrentFeasible = curSolve.status;

  let minFeasibleN = null;
  let minFeasibleMults = null;
  let nextFeasibleN = null;
  let nextFeasibleMults = null;
  let scanProofStatus = curSolve.proofStatus;

  const upperN = Math.min(maxNotesCap, 999 * K);
  const nextThresholdN = Number.isFinite(rawCurrentNotes)
    ? Math.max(K - 1, Math.floor(rawCurrentNotes))
    : K - 1;
  let candN = K;

  while (candN <= upperN) {
    let sumMonoLb = 0;
    let exceeds999 = false;
    const T = 200 * candN;
    for (let i = 0; i < K; i++) {
      const sc = prunedInfo.minSingleCents[i];
      const req = sc < Infinity ? Math.max(1, Math.ceil((T - 1e-9) / sc)) : 1;
      if (req > 999) {
        exceeds999 = true;
        break;
      }
      sumMonoLb += req;
    }
    if (exceeds999) break;
    if (sumMonoLb > candN) {
      candN = sumMonoLb;
      continue;
    }

    if (!prunedInfo.allSingleWinner && Date.now() > scanDeadlineMs) {
      if (scanProofStatus === "certified") {
        scanProofStatus = "time-budget-unproved";
      }
      break;
    }

    const res =
      isCurrentInLegalDomain && candN === rawCurrentNotes
        ? curSolve
        : solveJointBreakevenAtNotes(prunedInfo, K, candN, scanDeadlineMs, {
            rawBuckets: bucketsCents,
            nodeBudget: Math.min(nodeBudget, 12_000),
            maxNotesCap,
          });

    if (res.status === "certified-feasible") {
      if (minFeasibleN === null) {
        minFeasibleN = candN;
        minFeasibleMults = res.mults;
      }
      if (isCurrentFeasible === "certified-feasible") {
        break;
      }
      if (candN > nextThresholdN) {
        nextFeasibleN = candN;
        nextFeasibleMults = res.mults;
        break;
      }
      if (candN < nextThresholdN) {
        candN = nextThresholdN + 1;
        continue;
      }
    } else if (res.status === "unknown") {
      scanProofStatus = "time-budget-unproved";
    }

    candN += 1;
  }

  return {
    cert: {
      minFeasibleBudget: minFeasibleN !== null ? minFeasibleN * 2 : null,
      isCurrentFeasible,
      nextFeasibleBudget:
        isCurrentFeasible === "certified-feasible"
          ? null
          : nextFeasibleN !== null
            ? nextFeasibleN * 2
            : null,
      proofStatus: scanProofStatus,
      conditionalFloorAtCurrent,
      zeroPayoutProb,
    },
    feasibleMultsAtCurrent: curSolve.mults,
    minFeasibleMults,
    nextFeasibleMults,
    prunedInfo,
  };
}
