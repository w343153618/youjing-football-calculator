// Pure quotient state-space payout distribution engine:
// 139-state atomic folding, exact single-match cent DP, bilinear MITM convolution, and bitmask DFS (zero I/O).
import {
  ATOMIC_TEMPLATES,
  alignAtomicProbsToPoolOptions,
  alignMatchlessAtomicToLegs,
  doesOptionHitAtomicTemplate,
  getMatchBaseAtomicProbs,
  resolveGoalLineNum,
} from "./coherentCalibration.mjs";

/**
 * 商状态压缩联合状态空间评估核（Ω̃ = ∏ Ω̃_m）：
 * - 单场 139 个物理相容 (半场, 全场比分) 原子态按候选腿命中签名折叠为极小互斥商状态集 Ω̃_m（∑P = 1）；
 * - 当 M <= 8 且 |Ω̃| <= 16,384 时使用 32 位位掩码剪枝 DFS 100% 精确遍历全部联合状态，汇总同时命中的全部实票派奖；
 * - 确保所有输出 combos 严格互斥，恒满足 0 <= realProfitProb <= anyWinProb <= 1 且线性数学期望零误差。
 */
export function canonicalTicketLegSig(legs) {
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

export function evaluateMetricsViaHitMatrix(hitMatrix, ticketRows, totalCost) {
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

function executeBilinearMitmStripJoin(
  leftStates,
  rightZero,
  rightHit,
  bands,
  canFastBulkStats,
  metricsOnly,
  totalCostCents,
  refScale,
  minCrossErr,
  maxCrossErr,
  bProb,
  bExpPay,
  bExpUnit,
  bExpClip,
  bMinC,
  bMaxC,
  bBestP,
  binIndexOf,
  writeRepState,
  evalExactCross,
  addExactPairToBin
) {
  let globalRightMinIntra = Infinity;
  let globalRightMaxIntra = 0;
  let globalRightMinSumO = Infinity;
  let globalRightMaxSumO = 0;
  let globalRightPSum = 0;
  let globalRightProbIntra = 0;
  let globalRightProbUIntra = 0;
  let globalRightProbCIntra = 0;
  let globalRightProbSumO = 0;
  let globalRightBestR = null;
  for (let bi = 0; bi < bands.length; bi++) {
    const bd = bands[bi];
    if (bd.minIntra < globalRightMinIntra) globalRightMinIntra = bd.minIntra;
    if (bd.maxIntra > globalRightMaxIntra) globalRightMaxIntra = bd.maxIntra;
    if (bd.minSumO < globalRightMinSumO) globalRightMinSumO = bd.minSumO;
    if (bd.maxSumO > globalRightMaxSumO) globalRightMaxSumO = bd.maxSumO;
    globalRightPSum += bd.pSum;
    globalRightProbIntra += bd.sumProbIntra;
    globalRightProbSumO += bd.sumProbSumO;
    if (!metricsOnly && bd.bestR) {
      globalRightProbUIntra += bd.sumProbUIntra;
      globalRightProbCIntra += bd.sumProbCIntra;
      if (!globalRightBestR || bd.bestR.prob > globalRightBestR.prob) {
        globalRightBestR = bd.bestR;
      }
    }
  }

  const accumulateBlock = (L, blk, lb, ub) => {
    const lp = L.prob * blk.pSum;
    const b = binIndexOf(lb);
    bProb[b] += lp;
    bExpPay[b] +=
      L.prob *
      (blk.pSum * L.intra +
        blk.sumProbIntra +
        refScale * L.sumO * blk.sumProbSumO);
    if (lb < bMinC[b]) bMinC[b] = Math.max(1, lb);
    if (ub > bMaxC[b]) bMaxC[b] = ub;
    if (!metricsOnly && blk.bestR) {
      bExpUnit[b] +=
        L.prob *
        (blk.pSum * L.uIntra +
          blk.sumProbUIntra +
          200 * L.sumO * blk.sumProbSumO);
      bExpClip[b] += L.prob * (blk.pSum * L.cIntra + blk.sumProbCIntra);
      const repP = L.prob * blk.bestR.prob;
      if (repP > bBestP[b]) {
        bBestP[b] = repP;
        writeRepState(b, L, blk.bestR);
      }
    }
  };

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

    const lScaledSumO = refScale * L.sumO;
    if (canFastBulkStats && bands.length > 1) {
      const allLb =
        L.intra +
        globalRightMinIntra +
        Math.floor(lScaledSumO * globalRightMinSumO + minCrossErr);
      const allUb =
        L.intra +
        globalRightMaxIntra +
        Math.ceil(lScaledSumO * globalRightMaxSumO + maxCrossErr);
      if ((allLb > 0 && allUb < totalCostCents) || allLb > totalCostCents) {
        const lp = L.prob * globalRightPSum;
        const b = binIndexOf(allLb);
        bProb[b] += lp;
        bExpPay[b] +=
          L.prob *
          (globalRightPSum * L.intra +
            globalRightProbIntra +
            lScaledSumO * globalRightProbSumO);
        if (allLb < bMinC[b]) bMinC[b] = Math.max(1, allLb);
        if (allUb > bMaxC[b]) bMaxC[b] = allUb;
        if (!metricsOnly && globalRightBestR) {
          bExpUnit[b] +=
            L.prob *
            (globalRightPSum * L.uIntra +
              globalRightProbUIntra +
              200 * L.sumO * globalRightProbSumO);
          bExpClip[b] +=
            L.prob * (globalRightPSum * L.cIntra + globalRightProbCIntra);
          const repP = L.prob * globalRightBestR.prob;
          if (repP > bBestP[b]) {
            bBestP[b] = repP;
            writeRepState(b, L, globalRightBestR);
          }
        }
        continue;
      }
    }

    for (let bi = 0; bi < bands.length; bi++) {
      const bd = bands[bi];
      const bdLb =
        L.intra +
        bd.minIntra +
        Math.floor(lScaledSumO * bd.minSumO + minCrossErr);
      const bdUb =
        L.intra +
        bd.maxIntra +
        Math.ceil(lScaledSumO * bd.maxSumO + maxCrossErr);
      if (bdUb <= 0) continue;
      if (
        canFastBulkStats &&
        ((bdLb > 0 && bdUb < totalCostCents) || bdLb > totalCostCents)
      ) {
        accumulateBlock(L, bd, bdLb, bdUb);
        continue;
      }

      const bStrips = bd.strips;
      for (let s = 0; s < bStrips.length; s++) {
        const st = bStrips[s];
        const lb =
          L.intra +
          st.minIntra +
          Math.floor(lScaledSumO * st.minSumO + minCrossErr);
        const ub =
          L.intra +
          st.maxIntra +
          Math.ceil(lScaledSumO * st.maxSumO + maxCrossErr);
        if (ub <= 0) continue;

        if (
          canFastBulkStats &&
          ((lb > 0 && ub < totalCostCents) || lb > totalCostCents)
        ) {
          accumulateBlock(L, st, lb, ub);
          continue;
        }

        const sub = st.sub;
        for (let v = 0; v < sub.length; v++) {
          const R = sub[v];
          const baseApprox = L.intra + R.intra + lScaledSumO * R.sumO;
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
            const cross = evalExactCross(L, R);
            addExactPairToBin(
              L,
              R,
              L.intra + R.intra + cross[0],
              L.uIntra + R.uIntra + cross[1],
              L.cIntra + R.cIntra + cross[2]
            );
          }
        }
      }
    }
  }
}

export function evaluateTicketsOnQuotientSpace(
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

    const rightStateLens = Int32Array.from(
      { length: MR },
      (_, j) => mStates[ML + j].length
    );
    const crossPayGrid = Array.from({ length: ML }, (_, i) =>
      Array.from({ length: MR }, (_, j) => pairPay[i][ML + j])
    );
    const crossUnitGrid = !metricsOnly
      ? Array.from({ length: ML }, (_, i) =>
          Array.from({ length: MR }, (_, j) => pairUnit[i][ML + j])
        )
      : null;
    const crossClipGrid = !metricsOnly
      ? Array.from({ length: ML }, (_, i) =>
          Array.from({ length: MR }, (_, j) => pairClip[i][ML + j])
        )
      : null;
    const crossOut = new Float64Array(3);

    const evalExactCross = (L, R) => {
      let cPay = 0;
      let cUnit = 0;
      let cClip = 0;
      const ls = L.s;
      const rs = R.s;
      for (let i = 0; i < ML; i++) {
        const si = ls[i];
        const payRow = crossPayGrid[i];
        const unitRow = !metricsOnly ? crossUnitGrid[i] : null;
        const clipRow = !metricsOnly ? crossClipGrid[i] : null;
        for (let j = 0; j < MR; j++) {
          const idx = si * rightStateLens[j] + rs[j];
          cPay += payRow[j][idx];
          if (!metricsOnly) {
            cUnit += unitRow[j][idx];
            cClip += clipRow[j][idx];
          }
        }
      }
      crossOut[0] = cPay;
      crossOut[1] = cUnit;
      crossOut[2] = cClip;
      return crossOut;
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

    const logBinCeil = new Float64Array(48);
    for (let k = 0; k < 48; k++) {
      logBinCeil[k] = totalCostCents + Math.expm1((k + 1) / 6.0) * 100;
    }
    const binIndexOf = (payC) => {
      if (payC < totalCostCents) {
        return Math.min(47, (payC * invCostScale) | 0);
      }
      let lo = 0;
      let hi = 47;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (payC < logBinCeil[mid]) hi = mid;
        else lo = mid + 1;
      }
      return 48 + lo;
    };

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
    const rightByIntra = rightStates
      .filter((r) => r.hits > 0)
      .sort((a, b) => a.intra - b.intra || a.sumO - b.sumO);
    const rightHit = [...rightByIntra].sort(
      (a, b) => a.sumO - b.sumO || a.intra - b.intra
    );

    const INTRA_BANDS =
      rightByIntra.length >= 256
        ? Math.min(16, Math.max(4, Math.ceil(rightByIntra.length / 256)))
        : 1;
    const bands = [];
    for (let ib = 0; ib < INTRA_BANDS; ib++) {
      const iLo = Math.floor((ib * rightByIntra.length) / INTRA_BANDS);
      const iHi = Math.floor(((ib + 1) * rightByIntra.length) / INTRA_BANDS);
      if (iLo >= iHi) continue;
      const bandArr = rightByIntra
        .slice(iLo, iHi)
        .sort((a, b) => a.sumO - b.sumO || a.intra - b.intra);
      const sCount = Math.min(16, Math.max(1, Math.ceil(bandArr.length / 16)));
      const bStrips = [];
      let bdMinIntra = Infinity;
      let bdMaxIntra = 0;
      let bdPSum = 0;
      let bdProbIntra = 0;
      let bdProbUIntra = 0;
      let bdProbCIntra = 0;
      let bdProbSumO = 0;
      let bdBestR = bandArr[0];
      for (let s = 0; s < sCount; s++) {
        const lo = Math.floor((s * bandArr.length) / sCount);
        const hi = Math.floor(((s + 1) * bandArr.length) / sCount);
        if (lo >= hi) continue;
        const sub = bandArr.slice(lo, hi);
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
        if (minIntra < bdMinIntra) bdMinIntra = minIntra;
        if (maxIntra > bdMaxIntra) bdMaxIntra = maxIntra;
        bdPSum += pSum;
        bdProbIntra += sumProbIntra;
        bdProbSumO += sumProbSumO;
        if (!metricsOnly) {
          bdProbUIntra += sumProbUIntra;
          bdProbCIntra += sumProbCIntra;
          if (bestR.prob > bdBestR.prob) bdBestR = bestR;
        }
        bStrips.push({
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
      bands.push({
        strips: bStrips,
        pSum: bdPSum,
        minSumO: bandArr[0].sumO,
        maxSumO: bandArr[bandArr.length - 1].sumO,
        minIntra: bdMinIntra,
        maxIntra: bdMaxIntra,
        sumProbIntra: bdProbIntra,
        sumProbUIntra: bdProbUIntra,
        sumProbCIntra: bdProbCIntra,
        sumProbSumO: bdProbSumO,
        bestR: bdBestR,
      });
    }

    const canFastBulkStats =
      metricsOnly || (maxCrossUnitDiff <= 1.0 && maxCrossClipVal === 0);

    executeBilinearMitmStripJoin(
      leftStates,
      rightZero,
      rightHit,
      bands,
      canFastBulkStats,
      metricsOnly,
      totalCostCents,
      refScale,
      minCrossErr,
      maxCrossErr,
      bProb,
      bExpPay,
      bExpUnit,
      bExpClip,
      bMinC,
      bMaxC,
      bBestP,
      binIndexOf,
      writeRepState,
      evalExactCross,
      addExactPairToBin
    );

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
          const cPay = evalExactCross(L, R)[0];
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
          const cPay = evalExactCross(L, R)[0];
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
    const deltaOut = new Float64Array(3);
    const sumMaskDelta = (msk, oPay, oUnit, oClip) => {
      if (msk === 0) {
        deltaOut[0] = 0;
        deltaOut[1] = 0;
        deltaOut[2] = 0;
        return deltaOut;
      }
      if ((msk & (msk - 1)) === 0) {
        const j = 31 - Math.clz32(msk);
        deltaOut[0] = oPay[j];
        deltaOut[1] = !metricsOnly ? oUnit[j] : 0;
        deltaOut[2] = !metricsOnly ? oClip[j] : 0;
        return deltaOut;
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
      deltaOut[0] = aPay;
      deltaOut[1] = aUnit;
      deltaOut[2] = aClip;
      return deltaOut;
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
          const dVal = sumMaskDelta(mArr[s], oPay, oUnit, oClip);
          const addPay = dVal[0];
          const addUnit = dVal[1];
          const addClip = dVal[2];
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
        const dVal = sumMaskDelta(msk, oPay, oUnit, oClip);
        const addPay = dVal[0];
        const addUnit = dVal[1];
        const addClip = dVal[2];
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
