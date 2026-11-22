// Pure 3+1 Pareto Portfolio solvers:
// Exact 0-1 knapsack/MCKP dutching, log-wealth spear-and-shield utility, C(v,k,t) covering wheels, and +EV alpha radar (zero I/O).
import {
  OFFICIAL_COMBO_PASS_TABLE,
  POOL_MAX_PASS,
  allocateInverseOddsDutching,
  attachLazyConsolidatedLines,
  bankerRoundParlayUnitPayout,
  combinationsOfIndices,
  countPhysical99xSlips,
  isPoolAllUpEligible,
  isPoolSingleEligible,
  statutorySingleBetCap,
} from "./statutoryRules.mjs";
import {
  ATOMIC_TEMPLATES,
  computeCapitalWeightedVig,
  computeOptionShrunkAlpha,
  doesOptionHitAtomicTemplate,
  getCachedMatchCalibration,
  getMatchBaseAtomicProbs,
  resolveGoalLineNum,
  resolvePureSingleSubsetPoolCandidates,
  scanMatchAlphaCandidates,
  sumOptionProbOnAtomic,
  tiltAtomicProbsByStance,
} from "./coherentCalibration.mjs";
import { evaluateTicketsOnQuotientSpace } from "./quotientStateSpace.mjs";

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

function buildDisjointPartitionDesigns(
  v,
  wheelLegs,
  poolCap,
  maxWheelNotes = Infinity
) {
  const ranked = Array.from({ length: v }, (_, idx) => ({
    idx,
    odds: Number(wheelLegs[idx]?.odds ?? 1.8),
  })).sort((a, b) => a.odds - b.odds || a.idx - b.idx);
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
      isDisjointPartition: true,
    });
  };

  if (v === 4) {
    // At >= 4 notes (>= ¥8, including ¥10), official 4串4 (4 notes) & 4串5 (5 notes) already cover all 4 matches with >= 4 lines;
    // emit 2..3-block disjoint fallbacks strictly for ultra-small < ¥8 budgets (¥4 = 2 notes, ¥6 = 3 notes).
    if (maxWheelNotes < 4) {
      addWheelShape("双2串1独立分块", [
        [ord[0], ord[3]],
        [ord[1], ord[2]],
      ]);
      addWheelShape("双2串1交叉独立分块", [
        [ord[0], ord[2]],
        [ord[1], ord[3]],
      ]);
      addWheelShape("4场三组2串1独立分块", [
        [ord[0], ord[3]],
        [ord[1], ord[2]],
        [ord[0], ord[2]],
      ]);
    }
  } else if (v === 5) {
    // At >= 4 notes (>= ¥8, including ¥10), C(5,3,2) (4 notes) & C(5,3,2)·轮转5注 (5 notes) already fit;
    // emit 2..3-block disjoint fallbacks strictly for ultra-small < ¥8 budgets.
    if (maxWheelNotes < 4) {
      addWheelShape("2串1+3串1独立分块", [
        [ord[0], ord[4]],
        [ord[1], ord[2], ord[3]],
      ]);
      addWheelShape("5场三组2串1独立分块", [
        [ord[0], ord[4]],
        [ord[1], ord[3]],
        [ord[2], ord[4]],
      ]);
    }
  } else if (v === 6) {
    if (maxWheelNotes < 3) {
      addWheelShape("双3串1独立分块", [
        [ord[0], ord[3], ord[5]],
        [ord[1], ord[2], ord[4]],
      ]);
    }
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
    if (maxWheelNotes < 3) {
      addWheelShape("3串1+4串1独立分块", [
        [ord[0], ord[4], ord[6]],
        [ord[1], ord[2], ord[3], ord[5]],
      ]);
    }
    addWheelShape("双2串1+3串1独立分块", [
      [ord[0], ord[6]],
      [ord[1], ord[5]],
      [ord[2], ord[3], ord[4]],
    ]);
    addWheelShape("7场四组2串1独立分块", [
      [ord[0], ord[6]],
      [ord[1], ord[5]],
      [ord[2], ord[4]],
      [ord[0], ord[3]],
    ]);
  } else if (v === 8) {
    if (maxWheelNotes < 4) {
      addWheelShape("双4串1独立分块", [
        [ord[0], ord[3], ord[5], ord[6]],
        [ord[1], ord[2], ord[4], ord[7]],
      ]);
      addWheelShape("双3串1+2串1独立分块", [
        [ord[0], ord[5], ord[7]],
        [ord[1], ord[4], ord[6]],
        [ord[2], ord[3]],
      ]);
    }
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

function hasZeroMissTwoWipeout(v, blocks) {
  if (v < 4 || !Array.isArray(blocks) || blocks.length < 2) return false;
  for (let i = 0; i < v; i++) {
    for (let j = i + 1; j < v; j++) {
      let survives = false;
      for (let b = 0; b < blocks.length; b++) {
        if (!blocks[b].includes(i) && !blocks[b].includes(j)) {
          survives = true;
          break;
        }
      }
      if (!survives) return false;
    }
  }
  return true;
}

function isGenuineCoveringWheelDesign(v, blocks, designMeta = null) {
  if (designMeta?.isDisjointPartition) return false;
  if (!isGenuinePairCoveringDesign(v, blocks)) return false;
  for (let x = 0; x < v; x++) {
    if (!blocks.some((b) => !b.includes(x))) return false;
  }
  if (v >= 6 || blocks.some((b) => b.length > Math.ceil(v / 2))) {
    if (!hasZeroMissTwoWipeout(v, blocks)) return false;
  }
  return true;
}

function formatWheelSlipCountTag(lines) {
  const logical = Array.isArray(lines) ? lines.length : 0;
  const physical = countPhysical99xSlips(lines);
  return physical > logical
    ? `${logical}组逻辑组合 · 终端99倍拆${physical}张纸质实票`
    : `${logical}组逻辑组合 · ${physical}张纸质实票`;
}

export function computeSurvivingMissOneFloor(lines, matchIds) {
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

  const rawBudgetNotes = Math.floor(targetBudgetYuan / 2);
  if (rawBudgetNotes < K) {
    return { lines: [], missOneReturn: 0, weightedTailRatio: 0 };
  }
  const maxNotes = Math.min(K * 999, rawBudgetNotes);
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
  const clampedMults = mults.map((m) =>
    Math.max(1, Math.min(999, Math.round(Number(m) || 1)))
  );
  const actualCost = clampedMults.reduce((a, m) => a + m * 2, 0);
  return specs.map((sp, idx) => {
    const mult = clampedMults[idx];
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
    const costFloor = 2 * N - 1e-9;
    const byW = Array.from({ length: remCap + 1 }, () => []);
    for (let i = 0; i < V; i++) {
      const it = valid[i];
      const w = Math.max(1, Math.ceil(costFloor / it.unitPayout));
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

  const isBetterPair = (sA, nlA, sB, nlB) =>
    sA > sB + 1e-12 || (Math.abs(sA - sB) <= 1e-12 && nlA > nlB + 1e-12);

  // Exact 2-choice MCKP at fixed N when >= 1 feasible item has exact refund (wBe * u === 2 * N)
  const solveMckpAtN = (N, reconstruct = false) => {
    const costVal = 2 * N;
    const costFloor = costVal - 1e-9;
    const pinModes = [];
    if (!pinnedItem) {
      pinModes.push({ wPin: 0, pinStrict: 0, pinNonLoss: 0 });
    } else {
      const wPinBe = Math.max(1, Math.ceil(costFloor / pinnedItem.unitPayout));
      if (wPinBe > N || wPinBe > 999) {
        return { strictProb: -1, nonLossProb: -1, chosen: [] };
      }
      const pinRefund = wPinBe * pinnedItem.unitPayout <= costVal + 1e-6;
      if (pinRefund) {
        if (wPinBe + 1 <= N && wPinBe + 1 <= 999) {
          pinModes.push({
            wPin: wPinBe + 1,
            pinStrict: pinnedItem.prob,
            pinNonLoss: pinnedItem.prob,
          });
        }
        pinModes.push({
          wPin: wPinBe,
          pinStrict: 0,
          pinNonLoss: pinnedItem.prob,
        });
      } else {
        pinModes.push({
          wPin: wPinBe,
          pinStrict: pinnedItem.prob,
          pinNonLoss: pinnedItem.prob,
        });
      }
    }

    let bestRes = { strictProb: -1, nonLossProb: -1, chosen: [] };

    for (let pmIdx = 0; pmIdx < pinModes.length; pmIdx++) {
      const pm = pinModes[pmIdx];
      const remCap = N - pm.wPin;
      if (remCap === 0 || effLinesCap === 0 || V === 0) {
        const candS = pinnedItem ? pm.pinStrict : -1;
        const candNL = pinnedItem ? pm.pinNonLoss : -1;
        if (
          candNL > 0 &&
          isBetterPair(candS, candNL, bestRes.strictProb, bestRes.nonLossProb)
        ) {
          bestRes = {
            strictProb: candS,
            nonLossProb: candNL,
            chosen: pinnedItem
              ? [{ item: pinnedItem, w: pm.wPin, isPinned: true }]
              : [],
          };
        }
        continue;
      }

      const w1Strict = [];
      const mckpItems = [];
      const refundBucketCnt = new Int16Array(remCap + 1);
      const strictBucketCnt = new Int16Array(remCap + 1);

      for (let i = 0; i < V; i++) {
        const it = valid[i];
        const wBe = Math.max(1, Math.ceil(costFloor / it.unitPayout));
        if (wBe > remCap || wBe > 999) continue;
        const isRef = wBe * it.unitPayout <= costVal + 1e-6;
        const wStrict = isRef ? wBe + 1 : wBe;
        if (wStrict === 1) {
          if (w1Strict.length < effLinesCap && w1Strict.length < remCap) {
            w1Strict.push({ item: it, w: 1 });
          }
        } else {
          const lim = Math.min(effLinesCap, (remCap / wBe) | 0);
          const cntArr = isRef ? refundBucketCnt : strictBucketCnt;
          if (cntArr[wBe] < lim) {
            cntArr[wBe]++;
            mckpItems.push({ item: it, wBe, wStrict, p: it.prob });
          }
        }
      }

      const prefW1 = new Float64Array(w1Strict.length + 1);
      for (let i = 0; i < w1Strict.length; i++) {
        prefW1[i + 1] = prefW1[i] + w1Strict[i].item.prob;
      }

      const M = mckpItems.length;
      if (!reconstruct) {
        const sRow = new Float64Array(remCap + 1).fill(-1);
        const nlRow = new Float64Array(remCap + 1).fill(-1);
        const cRow = new Int16Array(remCap + 1);
        sRow[0] = 0;
        nlRow[0] = 0;
        let maxR = 0;

        for (let idx = 0; idx < M; idx++) {
          const { wBe, wStrict, p } = mckpItems[idx];
          const hi = Math.min(remCap, maxR + wStrict);
          for (let cap = hi; cap >= wBe; cap--) {
            let bS = sRow[cap];
            let bNL = nlRow[cap];
            let bC = cRow[cap];
            if (
              wStrict <= cap &&
              wStrict <= 999 &&
              sRow[cap - wStrict] >= 0 &&
              cRow[cap - wStrict] + 1 <= effLinesCap
            ) {
              const cs = sRow[cap - wStrict] + p;
              const cnl = nlRow[cap - wStrict] + p;
              const cc = cRow[cap - wStrict] + 1;
              if (
                cs > bS + 1e-15 ||
                (Math.abs(cs - bS) <= 1e-15 &&
                  (cnl > bNL + 1e-15 ||
                    (Math.abs(cnl - bNL) <= 1e-15 && cc < bC)))
              ) {
                bS = cs;
                bNL = cnl;
                bC = cc;
              }
            }
            if (
              wStrict > wBe &&
              sRow[cap - wBe] >= 0 &&
              cRow[cap - wBe] + 1 <= effLinesCap
            ) {
              const cs = sRow[cap - wBe];
              const cnl = nlRow[cap - wBe] + p;
              const cc = cRow[cap - wBe] + 1;
              if (
                cs > bS + 1e-15 ||
                (Math.abs(cs - bS) <= 1e-15 &&
                  (cnl > bNL + 1e-15 ||
                    (Math.abs(cnl - bNL) <= 1e-15 && cc < bC)))
              ) {
                bS = cs;
                bNL = cnl;
                bC = cc;
              }
            }
            if (
              bS > sRow[cap] + 1e-15 ||
              (Math.abs(bS - sRow[cap]) <= 1e-15 &&
                (bNL > nlRow[cap] + 1e-15 ||
                  (Math.abs(bNL - nlRow[cap]) <= 1e-15 && bC < cRow[cap])))
            ) {
              sRow[cap] = bS;
              nlRow[cap] = bNL;
              cRow[cap] = bC;
              if (cap > maxR) maxR = cap;
            }
          }
        }

        for (let u = 0; u <= maxR; u++) {
          if (sRow[u] < 0) continue;
          const t1 = Math.min(
            w1Strict.length,
            remCap - u,
            effLinesCap - cRow[u]
          );
          if (t1 < 0) continue;
          const totS = pm.pinStrict + sRow[u] + prefW1[t1];
          const totNL = pm.pinNonLoss + nlRow[u] + prefW1[t1];
          if (
            totNL > 0 &&
            isBetterPair(totS, totNL, bestRes.strictProb, bestRes.nonLossProb)
          ) {
            bestRes = { strictProb: totS, nonLossProb: totNL, chosen: [] };
          }
        }
      } else {
        const sRows = Array.from({ length: M + 1 }, () =>
          new Float64Array(remCap + 1).fill(-1)
        );
        const nlRows = Array.from({ length: M + 1 }, () =>
          new Float64Array(remCap + 1).fill(-1)
        );
        const cRows = Array.from(
          { length: M + 1 },
          () => new Int16Array(remCap + 1)
        );
        const chRows = Array.from(
          { length: M + 1 },
          () => new Uint8Array(remCap + 1)
        );
        sRows[0][0] = 0;
        nlRows[0][0] = 0;

        for (let idx = 0; idx < M; idx++) {
          const { wBe, wStrict, p } = mckpItems[idx];
          const pS = sRows[idx];
          const pNL = nlRows[idx];
          const pC = cRows[idx];
          const nS = sRows[idx + 1];
          const nNL = nlRows[idx + 1];
          const nC = cRows[idx + 1];
          const ch = chRows[idx + 1];
          for (let cap = 0; cap <= remCap; cap++) {
            nS[cap] = pS[cap];
            nNL[cap] = pNL[cap];
            nC[cap] = pC[cap];
          }
          for (let cap = wBe; cap <= remCap; cap++) {
            if (
              wStrict <= cap &&
              wStrict <= 999 &&
              pS[cap - wStrict] >= 0 &&
              pC[cap - wStrict] + 1 <= effLinesCap
            ) {
              const cs = pS[cap - wStrict] + p;
              const cnl = pNL[cap - wStrict] + p;
              const cc = pC[cap - wStrict] + 1;
              if (
                cs > nS[cap] + 1e-15 ||
                (Math.abs(cs - nS[cap]) <= 1e-15 &&
                  (cnl > nNL[cap] + 1e-15 ||
                    (Math.abs(cnl - nNL[cap]) <= 1e-15 && cc < nC[cap])))
              ) {
                nS[cap] = cs;
                nNL[cap] = cnl;
                nC[cap] = cc;
                ch[cap] = 1;
              }
            }
            if (
              wStrict > wBe &&
              pS[cap - wBe] >= 0 &&
              pC[cap - wBe] + 1 <= effLinesCap
            ) {
              const cs = pS[cap - wBe];
              const cnl = pNL[cap - wBe] + p;
              const cc = pC[cap - wBe] + 1;
              if (
                cs > nS[cap] + 1e-15 ||
                (Math.abs(cs - nS[cap]) <= 1e-15 &&
                  (cnl > nNL[cap] + 1e-15 ||
                    (Math.abs(cnl - nNL[cap]) <= 1e-15 && cc < nC[cap])))
              ) {
                nS[cap] = cs;
                nNL[cap] = cnl;
                nC[cap] = cc;
                ch[cap] = 2;
              }
            }
          }
        }

        let bestU = 0;
        let bestT1 = 0;
        let locS = -1;
        let locNL = -1;
        for (let u = 0; u <= remCap; u++) {
          if (sRows[M][u] < 0) continue;
          const t1 = Math.min(
            w1Strict.length,
            remCap - u,
            effLinesCap - cRows[M][u]
          );
          if (t1 < 0) continue;
          const totS = pm.pinStrict + sRows[M][u] + prefW1[t1];
          const totNL = pm.pinNonLoss + nlRows[M][u] + prefW1[t1];
          if (
            totS > locS + 1e-15 ||
            (Math.abs(totS - locS) <= 1e-15 && totNL > locNL + 1e-15)
          ) {
            locS = totS;
            locNL = totNL;
            bestU = u;
            bestT1 = t1;
          }
        }

        if (
          locNL > 0 &&
          isBetterPair(locS, locNL, bestRes.strictProb, bestRes.nonLossProb)
        ) {
          const outChosen = [];
          if (pinnedItem) {
            outChosen.push({ item: pinnedItem, w: pm.wPin, isPinned: true });
          }
          const extra = [];
          let curCap = bestU;
          for (let idx = M; idx >= 1; idx--) {
            const code = chRows[idx][curCap];
            if (code === 1) {
              const mIt = mckpItems[idx - 1];
              extra.push({ item: mIt.item, w: mIt.wStrict });
              curCap -= mIt.wStrict;
            } else if (code === 2) {
              const mIt = mckpItems[idx - 1];
              extra.push({ item: mIt.item, w: mIt.wBe });
              curCap -= mIt.wBe;
            }
          }
          for (let i = 0; i < bestT1; i++) extra.push(w1Strict[i]);
          extra.sort(
            (a, b) =>
              b.item.prob - a.item.prob || a.item.unitPayout - b.item.unitPayout
          );
          for (const ec of extra) outChosen.push(ec);
          bestRes = {
            strictProb: locS,
            nonLossProb: locNL,
            chosen: outChosen,
          };
        }
      }
    }
    return bestRes;
  };

  let bestStrictProb = -1;
  let bestNonLossProb = 0;
  let bestN = 0;
  let bestUsedMckp = false;

  // Zero-allocation typed buffers for the common fast-path N-search loop
  const bucketCounts = new Int16Array(maxNotes + 1);
  const prefW1Buf = new Float64Array(w1Limit + 1);
  const heavyW = new Int16Array(Math.max(1, V));
  const heavyP = new Float64Array(Math.max(1, V));
  const dpVal = new Float64Array(maxNotes + 1);
  const dpCnt = new Int16Array(maxNotes + 1);

  for (let N = maxNotes; N >= 1; N--) {
    const costVal = 2 * N;
    const costFloor = costVal - 1e-9;
    let wPin = 0;
    let pinRefund = false;
    if (pinnedItem) {
      wPin = Math.max(1, Math.ceil(costFloor / pinnedItem.unitPayout));
      if (wPin > N || wPin > 999) continue;
      pinRefund = wPin * pinnedItem.unitPayout <= costVal + 1e-6;
    }
    const remCap = N - wPin;
    const capItems = Math.min(V, effLinesCap, remCap);
    let upperAtN = pinnedItem ? pinnedItem.prob : 0;
    for (let i = 0; i < capItems; i++) upperAtN += vProbs[i];
    const cannotBeatBest =
      bestNonLossProb > 0 &&
      (upperAtN < bestStrictProb - 1e-12 ||
        (upperAtN <= bestStrictProb + 1e-12 &&
          upperAtN <= bestNonLossProb + 1e-13));
    if (cannotBeatBest) {
      if (!pinnedItem) break;
      continue;
    }

    let anyExactRefund = pinRefund;
    if (!anyExactRefund && remCap > 0 && effLinesCap > 0 && V > 0) {
      for (let i = 0; i < V; i++) {
        const w = Math.max(1, Math.ceil(costFloor / vUnits[i]));
        if (w <= remCap && w <= 999 && w * vUnits[i] <= costVal + 1e-6) {
          anyExactRefund = true;
          break;
        }
      }
    }

    if (anyExactRefund) {
      const mckp = solveMckpAtN(N, false);
      if (
        mckp.nonLossProb > 0 &&
        isBetterPair(
          mckp.strictProb,
          mckp.nonLossProb,
          bestStrictProb,
          bestNonLossProb
        )
      ) {
        bestStrictProb = mckp.strictProb;
        bestNonLossProb = mckp.nonLossProb;
        bestN = N;
        bestUsedMckp = true;
        if (bestStrictProb >= maxPossibleProb - 1e-15) break;
      }
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
        const w = Math.max(1, Math.ceil(costFloor / vUnits[i]));
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

    if (
      curMax > 0 &&
      isBetterPair(curMax, curMax, bestStrictProb, bestNonLossProb)
    ) {
      bestStrictProb = curMax;
      bestNonLossProb = curMax;
      bestN = N;
      bestUsedMckp = false;
      if (bestStrictProb >= maxPossibleProb - 1e-15) break;
    }
  }

  if (bestN <= 0 || !(bestNonLossProb > 0)) return [];

  let chosen = [];
  if (bestUsedMckp) {
    chosen = solveMckpAtN(bestN, true).chosen;
  } else {
    let remBestCap = bestN;
    if (pinnedItem) {
      const wPinBest = Math.max(
        1,
        Math.ceil((2 * bestN - 1e-9) / pinnedItem.unitPayout)
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

  const dutchItems = chosenSpecs.map((sp) => ({
    unitPayout: sp.unitPayout,
    prob: sp.prob,
    isCapClipped: (sp.rawUnit ?? sp.unitPayout) > sp.unitPayout,
  }));
  const waterFillAtNotes = (candN) =>
    allocateInverseOddsDutching(dutchItems, candN);

  let bestScaled = waterFillAtNotes(bestN);
  if (rawTargetNotes > maxNotes && chosenSpecs.length > 0) {
    const maxCapBy999 = Math.min(
      rawTargetNotes,
      chosenSpecs.length * 999,
      ...chosenSpecs.map((sp) => Math.floor((999 * sp.unitPayout + 1e-6) / 2))
    );
    const trialSet = new Set();
    let foundFeasible = 0;
    for (
      let candN = maxCapBy999;
      candN > bestN && candN >= maxCapBy999 - 256 && foundFeasible < 24;
      candN--
    ) {
      const sol = waterFillAtNotes(candN);
      if (sol) {
        trialSet.add(candN);
        foundFeasible++;
        if (
          !bestScaled ||
          sol.strictProb > bestScaled.strictProb + 1e-12 ||
          (Math.abs(sol.strictProb - bestScaled.strictProb) <= 1e-12 &&
            (sol.nonLossProb > bestScaled.nonLossProb + 1e-12 ||
              (Math.abs(sol.nonLossProb - bestScaled.nonLossProb) <= 1e-12 &&
                (sol.notes > bestScaled.notes ||
                  sol.floorRatio > bestScaled.floorRatio + 1e-9 ||
                  sol.evRate > bestScaled.evRate + 1e-9))))
        ) {
          bestScaled = sol;
        }
      }
    }
    const maxBaseW = Math.max(1, ...chosen.map((c) => c.w));
    const kScale = Math.max(
      1,
      Math.min(Math.floor(rawTargetNotes / bestN), Math.floor(999 / maxBaseW))
    );
    if (kScale > 1 && !trialSet.has(bestN * kScale)) {
      const solK = waterFillAtNotes(bestN * kScale);
      if (
        solK &&
        (!bestScaled ||
          solK.strictProb > bestScaled.strictProb + 1e-12 ||
          (Math.abs(solK.strictProb - bestScaled.strictProb) <= 1e-12 &&
            (solK.nonLossProb > bestScaled.nonLossProb + 1e-12 ||
              (Math.abs(solK.nonLossProb - bestScaled.nonLossProb) <= 1e-12 &&
                solK.notes > bestScaled.notes))))
      ) {
        bestScaled = solK;
      }
    }
  }

  const finalMults = bestScaled ? bestScaled.mults : chosen.map((c) => c.w);
  return materializePlanLines(chosenSpecs, finalMults);
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
      return {
        ...r,
        legs,
        rawUnit,
        unitPayout,
        prob,
        isCapClipped: rawUnit > unitPayout,
      };
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
      let bestStrictProb = -Infinity;
      let bestEvRate = -Infinity;
      for (let candNotes = maxNotes; candNotes >= minSearchNotes; candNotes--) {
        const sol = allocateInverseOddsDutching(active, candNotes);
        if (!sol) continue;
        if (
          sol.floorRatio > bestFloorRatio + 1e-9 ||
          (Math.abs(sol.floorRatio - bestFloorRatio) <= 1e-9 &&
            (sol.strictProb > bestStrictProb + 1e-12 ||
              (Math.abs(sol.strictProb - bestStrictProb) <= 1e-12 &&
                sol.evRate > bestEvRate + 1e-9)))
        ) {
          bestFloorRatio = sol.floorRatio;
          bestStrictProb = sol.strictProb;
          bestEvRate = sol.evRate;
          solvedMults = sol.mults;
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

  let validShield = null;
  if (
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
    if (shUnitU > 2.02 && shProb > 0) {
      validShield = {
        ...shieldSpec,
        rawUnit: shRawU,
        unitPayout: shUnitU,
        prob: shProb,
      };
    }
  }

  // Prevent post-rounding spear/shield EV inversion when primary spear is unlocked
  if (
    !lockPrimarySpear &&
    cleanSpears.length === 1 &&
    validShield &&
    validShield.prob * validShield.unitPayout >
      cleanSpears[0].prob * cleanSpears[0].unitPayout + 1e-9 &&
    cleanSpears[0].unitPayout > 2.02
  ) {
    const oldSpear = cleanSpears[0];
    cleanSpears[0] = {
      id: oldSpear.id,
      roleLabel: oldSpear.roleLabel,
      legs: validShield.legs,
      rawUnit: validShield.rawUnit,
      unitPayout: validShield.unitPayout,
      prob: validShield.prob,
    };
    validShield = {
      id: validShield.id,
      roleLabel: validShield.roleLabel,
      legs: oldSpear.legs,
      rawUnit: oldSpear.rawUnit,
      unitPayout: oldSpear.unitPayout,
      prob: oldSpear.prob,
    };
  }

  const targetNotes = Math.max(1, Math.floor(targetBudgetYuan / 2));
  const refWealth = Math.max(2, targetNotes * 2);
  const GAMMA = 0.65;

  const evalValidAllocation = (specs, mults) => {
    if (!specs.length || specs.length !== mults.length) return null;
    let sumNotes = 0;
    for (let i = 0; i < mults.length; i++) {
      const m = mults[i];
      if (!Number.isInteger(m) || m < 1 || m > 999) return null;
      sumNotes += m;
    }
    if (sumNotes > targetNotes) return null;
    const actualCost = sumNotes * 2;
    let pSum = 0;
    let logUtil = 0;
    let expRet = 0;
    for (let i = 0; i < specs.length; i++) {
      const ret = Number((specs[i].unitPayout * mults[i]).toFixed(2));
      if (ret < actualCost - 1e-6) return null;
      const pr = specs[i].prob;
      pSum += pr;
      expRet += pr * ret;
      logUtil +=
        pr *
        Math.log(Math.max(1e-6, 1 + (GAMMA * (ret - actualCost)) / refWealth));
    }
    logUtil +=
      Math.max(0, 1 - pSum) *
      Math.log(Math.max(1e-6, 1 - (GAMMA * actualCost) / refWealth));
    return {
      specs,
      mults,
      cost: actualCost,
      logUtil,
      evRate: (expRet - actualCost) / actualCost,
    };
  };

  // Optimal 1D integer split of remNotes into (m0, m1 = remNotes - m0) maximizing concave log-wealth utility
  const bestConcavePairSplit = (sp0, sp1, remNotes, actualCost, lo0, hi0) => {
    if (lo0 > hi0) return null;
    const B0 = (GAMMA * sp0.unitPayout) / refWealth;
    const B1 = (GAMMA * sp1.unitPayout) / refWealth;
    const A0 = 1 - (GAMMA * actualCost) / refWealth;
    const A1 =
      1 + (GAMMA * (remNotes * sp1.unitPayout - actualCost)) / refWealth;
    const denom = (sp0.prob + sp1.prob) * B0 * B1;
    const rawStar =
      denom > 1e-18 ? (sp0.prob * B0 * A1 - sp1.prob * B1 * A0) / denom : hi0;
    const probeSet = [
      lo0,
      hi0,
      Math.max(lo0, Math.min(hi0, Math.floor(rawStar))),
      Math.max(lo0, Math.min(hi0, Math.ceil(rawStar))),
      Math.max(lo0, Math.min(hi0, Math.floor(rawStar) - 1)),
      Math.max(lo0, Math.min(hi0, Math.ceil(rawStar) + 1)),
    ];
    let bestM0 = -1;
    let bestScore = -Infinity;
    for (let k = 0; k < probeSet.length; k++) {
      const m0 = probeSet[k];
      const m1 = remNotes - m0;
      const r0 = Number((sp0.unitPayout * m0).toFixed(2));
      const r1 = Number((sp1.unitPayout * m1).toFixed(2));
      if (r0 < actualCost - 1e-6 || r1 < actualCost - 1e-6) continue;
      const sc =
        sp0.prob *
          Math.log(
            Math.max(1e-6, 1 + (GAMMA * (r0 - actualCost)) / refWealth)
          ) +
        sp1.prob *
          Math.log(Math.max(1e-6, 1 + (GAMMA * (r1 - actualCost)) / refWealth));
      if (sc > bestScore + 1e-15) {
        bestScore = sc;
        bestM0 = m0;
      }
    }
    return bestM0;
  };

  const buildPureSingleSpear = (sp0) => {
    const m0 = Math.min(999, targetNotes);
    return evalValidAllocation([sp0], [m0]);
  };

  const solveTwoDisjointLines = (line0, line1, allowUtilityBoost, isShield) => {
    const solveAtN = (N) => {
      if (N < 2 || N > targetNotes || N > 1998) return null;
      const cost = 2 * N;
      const min0 = Math.max(1, Math.ceil((cost - 1e-6) / line0.unitPayout));
      const min1 = Math.max(1, Math.ceil((cost - 1e-6) / line1.unitPayout));
      if (min0 > 999 || min1 > 999 || min0 + min1 > N) return null;

      if (!allowUtilityBoost) {
        const m1 = min1;
        const m0 = N - m1;
        if (m0 > 999 || m0 < min0 || (isShield && !(m1 < N * 0.45)))
          return null;
        return evalValidAllocation([line0, line1], [m0, m1]);
      }

      const max1 = isShield ? Math.floor((N - 1) / 2) : Math.floor(N / 2);
      // Allow m0 === m1 on N === 2 or symmetric spear-primary domain (m0 >= m1) on 1-match single
      const effMax1 =
        isShield && line0.legs.length >= 2 ? max1 : Math.floor(N / 2);
      const lo0 = Math.max(min0, N - effMax1, N - 999);
      const hi0 = Math.min(999, N - min1);
      const bestM0 = bestConcavePairSplit(line0, line1, N, cost, lo0, hi0);
      if (bestM0 < 0) return null;
      const chosenM1 = N - bestM0;
      const adjLine1 =
        isShield && chosenM1 > min1
          ? { ...line1, roleLabel: "对数效用协同副攻" }
          : line1;
      return evalValidAllocation([line0, adjLine1], [bestM0, chosenM1]);
    };

    const cands = [];
    if (targetNotes <= 999) {
      for (let N = targetNotes; N >= 2; N--) {
        const sol = solveAtN(N);
        if (sol) {
          cands.push(sol);
          break;
        }
      }
    } else {
      if (targetNotes <= 1998) {
        const fullSol = solveAtN(targetNotes);
        if (fullSol) cands.push(fullSol);
      }
      // Primary spear at statutory 999x ceiling: actualCost = 2 * (999 + m1)
      if (line1.unitPayout > 2.02) {
        const min1At999 = Math.max(
          1,
          Math.ceil((1998 - 1e-6) / (line1.unitPayout - 2))
        );
        const max1ByCap = Math.min(
          999,
          targetNotes - 999,
          Math.floor((999 * (line0.unitPayout - 2) + 1e-6) / 2)
        );
        if (min1At999 <= max1ByCap) {
          if (!allowUtilityBoost) {
            if (!isShield || min1At999 < (999 + min1At999) * 0.45) {
              const s999 = evalValidAllocation(
                [line0, line1],
                [999, min1At999]
              );
              if (s999) cands.push(s999);
            }
          } else {
            let best999 = null;
            for (let m1 = min1At999; m1 <= max1ByCap; m1++) {
              const adj1 =
                isShield && m1 > min1At999
                  ? { ...line1, roleLabel: "对数效用协同副攻" }
                  : line1;
              const ev = evalValidAllocation([line0, adj1], [999, m1]);
              if (ev && (!best999 || ev.logUtil > best999.logUtil + 1e-15)) {
                best999 = ev;
              }
            }
            if (best999) cands.push(best999);
          }
        }
      }
      // Equal-budget anchor with 1-line 999x cap (N = 999 -> ¥1,998)
      const sol999 = solveAtN(999);
      if (sol999) cands.push(sol999);

      if (cands.length === 0) {
        const hiN = Math.min(
          targetNotes,
          1998,
          Math.floor((999 * line0.unitPayout + 1e-6) / 2),
          Math.floor((999 * line1.unitPayout + 1e-6) / 2)
        );
        for (let N = hiN; N >= 2; N--) {
          const sol = solveAtN(N);
          if (sol) {
            cands.push(sol);
            break;
          }
        }
      }
    }

    if (cands.length === 0) return null;
    cands.sort(
      (a, b) => b.logUtil - a.logUtil || b.evRate - a.evRate || b.cost - a.cost
    );
    return cands[0];
  };

  if (cleanSpears.length === 1) {
    const sp0 = cleanSpears[0];
    if (validShield) {
      const twoSol = solveTwoDisjointLines(
        sp0,
        validShield,
        optimizeShieldUtility,
        true
      );
      if (twoSol) return materializePlanLines(twoSol.specs, twoSol.mults);
    }
    const pureSol = buildPureSingleSpear(sp0);
    return pureSol ? materializePlanLines(pureSol.specs, pureSol.mults) : [];
  }

  if (cleanSpears.length === 2) {
    const [sp0, sp1] = cleanSpears;
    const candidates = [];

    if (validShield) {
      const solveThreeAtN = (N) => {
        if (N < 3 || N > targetNotes || N > 2997) return null;
        const cost = 2 * N;
        const min0 = Math.max(1, Math.ceil((cost - 1e-6) / sp0.unitPayout));
        const min1 = Math.max(1, Math.ceil((cost - 1e-6) / sp1.unitPayout));
        const min2 = Math.max(
          1,
          Math.ceil((cost - 1e-6) / validShield.unitPayout)
        );
        if (min0 > 999 || min1 > 999 || min2 > 999 || min0 + min1 + min2 > N) {
          return null;
        }
        const hi2 = optimizeShieldUtility
          ? Math.min(999, Math.ceil(N * 0.45) - 1, N - min0 - min1)
          : min2 < N * 0.45
            ? min2
            : -1;
        const lo2 = Math.max(min2, N - 1998);
        if (lo2 > hi2) return null;

        let bestTri = null;
        for (let m2 = lo2; m2 <= hi2; m2++) {
          const remAtt = N - m2;
          const lo0 = Math.max(min0, Math.ceil(remAtt / 2), remAtt - 999);
          const hi0 = Math.min(999, remAtt - min1);
          const m0 = bestConcavePairSplit(sp0, sp1, remAtt, cost, lo0, hi0);
          if (m0 < 0) continue;
          const m1 = remAtt - m0;
          const adjSh =
            m2 > min2
              ? { ...validShield, roleLabel: "对数效用协同副攻" }
              : validShield;
          const ev = evalValidAllocation([sp0, sp1, adjSh], [m0, m1, m2]);
          if (ev && (!bestTri || ev.logUtil > bestTri.logUtil + 1e-15)) {
            bestTri = ev;
          }
        }
        return bestTri;
      };

      const maxCap3 = Math.min(
        targetNotes,
        2997,
        Math.floor((999 * sp0.unitPayout + 1e-6) / 2),
        Math.floor((999 * sp1.unitPayout + 1e-6) / 2),
        Math.floor((999 * validShield.unitPayout + 1e-6) / 2)
      );
      for (let N = maxCap3; N >= 3; N--) {
        const sol3 = solveThreeAtN(N);
        if (sol3) {
          candidates.push(sol3);
          break;
        }
      }
      if (targetNotes > 999) {
        const sol3At999 = solveThreeAtN(999);
        if (sol3At999) candidates.push(sol3At999);
      }
      const fallbackSp0Sh = solveTwoDisjointLines(
        sp0,
        validShield,
        optimizeShieldUtility,
        true
      );
      if (fallbackSp0Sh && candidates.length === 0) {
        candidates.push(fallbackSp0Sh);
      }
    }

    if (!validShield || candidates.length === 0) {
      const twoSpSol = solveTwoDisjointLines(sp0, sp1, true, false);
      if (twoSpSol) candidates.push(twoSpSol);
    }

    if (candidates.length === 0) {
      const pureSol = buildPureSingleSpear(sp0);
      if (pureSol) candidates.push(pureSol);
    }

    candidates.sort(
      (a, b) => b.logUtil - a.logUtil || b.evRate - a.evRate || b.cost - a.cost
    );
    return candidates[0]
      ? materializePlanLines(candidates[0].specs, candidates[0].mults)
      : [];
  }

  // Multi-line fallback (K >= 3, e.g. statutory cap-clipping subset split): enforce <= 999 per line, <= targetNotes total, and zero underwater
  let activeMulti = [...cleanSpears];
  while (activeMulti.length > 1) {
    const capN = Math.min(targetNotes, activeMulti.length * 999);
    const cost = capN * 2;
    const minReq = activeMulti.map((s) =>
      Math.max(1, Math.ceil((cost - 1e-6) / s.unitPayout))
    );
    const sumMin = minReq.reduce((a, b) => a + b, 0);
    if (sumMin <= capN && Math.max(...minReq) <= 999) {
      const mults = [...minReq];
      let rem = capN - sumMin;
      const wSum =
        activeMulti.reduce((a, s) => a + s.prob * s.unitPayout, 0) || 1;
      for (let i = 0; i < activeMulti.length && rem > 0; i++) {
        const add =
          i === activeMulti.length - 1
            ? Math.min(rem, 999 - mults[i])
            : Math.min(
                rem,
                999 - mults[i],
                Math.round(
                  ((capN - sumMin) *
                    activeMulti[i].prob *
                    activeMulti[i].unitPayout) /
                    wSum
                )
              );
        mults[i] += Math.max(0, add);
        rem -= Math.max(0, add);
      }
      for (let i = 0; i < activeMulti.length && rem > 0; i++) {
        const add = Math.min(rem, 999 - mults[i]);
        mults[i] += add;
        rem -= add;
      }
      const actualC = mults.reduce((a, b) => a + b * 2, 0);
      if (
        activeMulti.every(
          (s, i) =>
            Number((s.unitPayout * mults[i]).toFixed(2)) >= actualC - 1e-6
        )
      ) {
        return materializePlanLines(activeMulti, mults);
      }
    }
    activeMulti.pop();
  }
  const lastPure = buildPureSingleSpear(activeMulti[0]);
  return lastPure ? materializePlanLines(lastPure.specs, lastPure.mults) : [];
}

function solveFullSlatePartitionDutching(
  selected,
  legOf,
  primaryPoolOf,
  targetBudgetYuan
) {
  const M = selected.length;
  if (M < 3) return [];
  const rawTargetNotes = Math.floor(targetBudgetYuan / 2);
  if (rawTargetNotes < 2) return [];
  const maxNotes = Math.min(500, rawTargetNotes);

  const mainSinglePoolOf = (m) => {
    const hadOk =
      isPoolSingleEligible(m.pools.HAD) &&
      Array.isArray(m.pools.HAD?.options) &&
      m.pools.HAD.options.length >= 2;
    const hhadOk =
      isPoolSingleEligible(m.pools.HHAD) &&
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
      isPoolAllUpEligible(m.pools.HAD) &&
      Array.isArray(m.pools.HAD?.options) &&
      m.pools.HAD.options.length >= 2;
    const hhadOk =
      isPoolAllUpEligible(m.pools.HHAD) &&
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
  let bestStrictUnionProb = -1;
  let bestUnionProb = -1;
  let bestEvScore = -Infinity;

  for (let pIdx = 0; pIdx < partitions.length; pIdx++) {
    const blocks = partitions[pIdx];
    const R = blocks.length;
    if (R < 2 || maxNotes < R) continue;
    const blockItemLists = blocks.map(buildBlockItems);
    if (blockItemLists.some((b) => !b)) continue;
    const noteTrials = Array.from(
      new Set([
        maxNotes,
        Math.max(R, maxNotes - 1),
        Math.max(R, Math.floor(maxNotes * 0.95)),
      ])
    ).filter((n) => n >= R && n <= maxNotes);

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
      const chosenBlockIdx = [];
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
            chosenBlockIdx.push(q);
            mults.push(ws[i]);
          }
        }
      }
      if (chosenSpecs.length === 0) continue;

      // Water-fill up to N (or scale up to rawTargetNotes when > 500)
      let fillTarget = N;
      if (rawTargetNotes > maxNotes) {
        const hiCap = Math.min(
          rawTargetNotes,
          chosenSpecs.length * 999,
          ...chosenSpecs.map((sp) =>
            Math.floor((999 * sp.unitPayout + 1e-6) / 2)
          )
        );
        const tryScaleAt = (candN) => {
          const st = 2 * candN - 1e-9;
          const req = chosenSpecs.map((sp) =>
            Math.max(1, Math.ceil(st / sp.unitPayout))
          );
          const sReq = req.reduce((a, b) => a + b, 0);
          return sReq <= candN && Math.max(...req) <= 999 ? req : null;
        };
        let scaledOk = false;
        for (let candN = hiCap; candN >= Math.max(N, hiCap - 32); candN--) {
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
      if (rem > 0) {
        const cTarget = 2 * fillTarget;
        const refundIdx = [];
        for (let i = 0; i < chosenSpecs.length; i++) {
          if (
            mults[i] < 999 &&
            mults[i] * chosenSpecs[i].unitPayout <= cTarget + 1e-6
          ) {
            refundIdx.push(i);
          }
        }
        refundIdx.sort((a, b) => chosenSpecs[b].prob - chosenSpecs[a].prob);
        for (let r = 0; r < refundIdx.length && rem > 0; r++) {
          mults[refundIdx[r]] += 1;
          rem -= 1;
        }
      }
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
      const bStrictP = new Float64Array(R);
      const bRefundP = new Float64Array(R);
      for (let i = 0; i < chosenSpecs.length; i++) {
        const q = chosenBlockIdx[i];
        const pay = Number((mults[i] * chosenSpecs[i].unitPayout).toFixed(2));
        if (pay > candCost + 1e-6) bStrictP[q] += chosenSpecs[i].prob;
        else if (pay >= candCost - 1e-6) bRefundP[q] += chosenSpecs[i].prob;
      }
      let pZero = 1;
      let pOneRef = 0;
      for (let q = 0; q < R; q++) {
        const p0 = Math.max(0, 1 - bStrictP[q] - bRefundP[q]);
        const nextOneRef = pZero * bRefundP[q] + pOneRef * p0;
        pZero *= p0;
        pOneRef = nextOneRef;
      }
      const strictUnionProb = Math.max(0, 1 - pZero - pOneRef);
      const evScore =
        chosenSpecs.reduce(
          (acc, sp, idx) => acc + mults[idx] * sp.prob * sp.unitPayout,
          0
        ) /
          Math.max(2, candCost) -
        1;
      if (
        strictUnionProb > bestStrictUnionProb + 1e-12 ||
        (Math.abs(strictUnionProb - bestStrictUnionProb) <= 1e-12 &&
          (unionProb > bestUnionProb + 1e-12 ||
            (Math.abs(unionProb - bestUnionProb) <= 1e-12 &&
              evScore > bestEvScore + 1e-9)))
      ) {
        bestStrictUnionProb = strictUnionProb;
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
  anchorPicks = [],
  portfolioOptions = null
) {
  const acceptPartialSingleCoverage = Boolean(
    portfolioOptions?.acceptPartialSingleCoverage
  );
  const allowSaveCash = Boolean(portfolioOptions?.allowSaveCash);
  const skipRemediation = Boolean(portfolioOptions?.skipRemediation);
  const rawPassSpec = portfolioOptions?.passSpec ?? null;
  const rawBudgetVal = Number(budgetYuan);
  const cleanBudget =
    Number.isFinite(rawBudgetVal) && rawBudgetVal > 0
      ? Math.max(2, Math.min(20_000, Math.floor(rawBudgetVal / 2) * 2))
      : 100;
  if (!Array.isArray(targetMatches) || targetMatches.length === 0) return [];

  const selected = [...targetMatches.slice(0, 8)].sort(
    (a, b) =>
      String(a.id || "").localeCompare(String(b.id || "")) ||
      String(a.matchNumStr || "").localeCompare(String(b.matchNumStr || ""))
  );
  let explicitPassSizes = null;
  if (
    rawPassSpec &&
    rawPassSpec.mode === "free" &&
    Array.isArray(rawPassSpec.passSizes) &&
    rawPassSpec.passSizes.length > 0
  ) {
    explicitPassSizes = Array.from(
      new Set(
        rawPassSpec.passSizes
          .map((s) => Math.round(Number(s)))
          .filter((s) => Number.isFinite(s) && s >= 1 && s <= 8)
      )
    ).sort((a, b) => a - b);
  } else if (
    rawPassSpec &&
    rawPassSpec.mode === "combo" &&
    typeof rawPassSpec.comboCode === "string" &&
    rawPassSpec.comboCode.length > 0
  ) {
    const comboEntry = (OFFICIAL_COMBO_PASS_TABLE[selected.length] ?? []).find(
      (pr) => pr.code === rawPassSpec.comboCode
    );
    if (comboEntry && Array.isArray(comboEntry.sizes)) {
      explicitPassSizes = [...comboEntry.sizes].sort((a, b) => a - b);
    }
  } else if (portfolioOptions?.hasExplicitPassSelection === true) {
    explicitPassSizes = [selected.length];
  }
  const hasExplicitPassSelection =
    Boolean(portfolioOptions?.hasExplicitPassSelection) ||
    (Array.isArray(explicitPassSizes) && explicitPassSizes.length > 0);
  const baseAtomicMap = new Map();
  const stanceAtomicMap = new Map();
  for (const m of selected) {
    const baseA = getMatchBaseAtomicProbs(m);
    baseAtomicMap.set(m.id, baseA);
    stanceAtomicMap.set(m.id, tiltAtomicProbsByStance(baseA, m, stance));
  }

  const primaryPoolOf = (m) => {
    const requireAllUp = selected.length >= 2;
    const hadOpen = requireAllUp
      ? isPoolAllUpEligible(m.pools.HAD)
      : m.pools.HAD?.selling !== false;
    return hadOpen && m.pools.HAD?.options?.length >= 2 ? "HAD" : "HHAD";
  };

  const anchorsByMatch = new Map();
  if (Array.isArray(anchorPicks)) {
    for (const pk of anchorPicks) {
      if (!selected.some((m) => m.id === pk.matchId)) continue;
      const arr = anchorsByMatch.get(pk.matchId) ?? [];
      arr.push(pk);
      anchorsByMatch.set(pk.matchId, arr);
    }
    for (const [mid, arr] of anchorsByMatch.entries()) {
      arr.sort(
        (a, b) =>
          String(a.poolCode || "").localeCompare(String(b.poolCode || "")) ||
          String(a.optionKey || "").localeCompare(String(b.optionKey || ""))
      );
      anchorsByMatch.set(mid, arr);
    }
  }
  const hasUserAnchors = anchorsByMatch.size > 0;

  const legOf = (m, poolCode, optionKey) =>
    makeLeg(m, poolCode, optionKey, stance, stanceAtomicMap.get(m.id));

  const preferredPrimaryLeg = (m, requireAllUp = selected.length >= 2) => {
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) {
      const legalAnc = requireAllUp
        ? anc.filter((a) => isPoolAllUpEligible(m.pools[a.poolCode]))
        : anc;
      const sortedAnc = [...legalAnc].sort((a, b) => b.fairProb - a.fairProb);
      if (sortedAnc[0]) {
        const chosen = legOf(
          m,
          sortedAnc[0].poolCode,
          sortedAnc[0].poolCode === "CRS"
            ? sortedAnc[0].optionLabel || sortedAnc[0].optionKey
            : sortedAnc[0].optionKey
        );
        if (chosen) return chosen;
      }
    }
    for (const pCode of [
      primaryPoolOf(m),
      "HAD",
      "HHAD",
      "HAFU",
      "TTG",
      "CRS",
    ]) {
      const pool = m.pools[pCode];
      if (!pool) continue;
      if (requireAllUp && !isPoolAllUpEligible(pool)) continue;
      if (!requireAllUp && pool.selling === false) continue;
      const legs = (pool.options ?? [])
        .map((o) => legOf(m, pCode, pCode === "CRS" ? o.label || o.key : o.key))
        .filter(Boolean);
      if (legs.length > 0) {
        legs.sort((a, b) => b.fairProb - a.fairProb);
        return legs[0];
      }
    }
    return null;
  };

  const preferredHighProbMainLeg = (m) => {
    const requireAllUp = selected.length >= 2;
    const anc = anchorsByMatch.get(m.id);
    if (anc && anc.length > 0) return preferredPrimaryLeg(m, requireAllUp);
    const cands = [];
    for (const code of ["HAD", "HHAD"]) {
      const pool = m.pools[code];
      if (!pool || !Array.isArray(pool.options)) continue;
      if (requireAllUp ? !isPoolAllUpEligible(pool) : pool.selling === false)
        continue;
      for (const o of pool.options) {
        if (o.odds >= 1.18) {
          const lg = legOf(m, code, o.key);
          if (lg) cands.push(lg);
        }
      }
    }
    if (cands.length === 0) return preferredPrimaryLeg(m, requireAllUp);
    cands.sort((a, b) => b.fairProb - a.fairProb);
    return cands[0];
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
    if (primaryLeg.poolCode !== "HAD" && primaryLeg.poolCode !== "HHAD") {
      return null;
    }
    const poolOpts = m.pools[primaryLeg.poolCode]?.options ?? [];
    const others = poolOpts
      .filter((o) => o.key !== primaryLeg.optionKey)
      .map((o) => legOf(m, primaryLeg.poolCode, o.key))
      .filter(Boolean)
      .sort((a, b) => b.fairProb - a.fairProb);

    if (anc && anc.length === 1) {
      if (primaryLeg.poolCode === "HAD") {
        if (primaryLeg.optionKey === "d") return null;
        return others.find((o) => o.optionKey === "d") ?? null;
      }
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
          others.find((o) => o.optionKey === (gl < 0 ? "hh" : "ha")) ?? null
        );
      }
      return null;
    }

    return (
      others.find((o) => o.optionKey === "d" || o.optionKey === "hd") ??
      others[0] ??
      null
    );
  };

  const resolveSingleMatchSubsetCandidates = (m, targetPicksInput) => {
    const cands = resolvePureSingleSubsetPoolCandidates(
      m,
      targetPicksInput,
      baseAtomicMap.get(m.id)
    );
    return cands
      .map((c) => {
        const legs = c.fullPicks
          .map((p) =>
            legOf(
              m,
              p.poolCode,
              p.poolCode === "CRS" ? p.optionLabel || p.optionKey : p.optionKey
            )
          )
          .filter(Boolean);
        return legs.length === c.fullPicks.length ? { ...c, legs } : null;
      })
      .filter(Boolean);
  };

  const buildSinglePartialCoveragePreview = (m, cand) => {
    if (!cand || !Array.isArray(cand.legs) || cand.legs.length === 0) {
      return null;
    }
    const singleCap = statutorySingleBetCap(1);
    const rawUnits = cand.legs.map((lg) =>
      bankerRoundParlayUnitPayout([lg.odds])
    );
    const cappedUnits = rawUnits.map((u) => Math.min(singleCap, u));
    const dutchItems = cand.legs.map((lg, idx) => ({
      unitPayout: cappedUnits[idx],
      prob: lg.fairProb,
      isCapClipped: rawUnits[idx] > singleCap,
    }));
    const K = cand.legs.length;
    const maxN = Math.min(10_000, 999 * K);
    let minAlloc = null;
    for (let N = K; N <= maxN; N++) {
      const a = allocateInverseOddsDutching(dutchItems, N, {
        requireStrictNetGain: true,
      });
      if (a) {
        minAlloc = a;
        break;
      }
    }
    if (!minAlloc) return null;
    const previewLines = cand.legs.map((lg, idx) => {
      const mult = minAlloc.mults[idx];
      const unit = cappedUnits[idx];
      const ret = Number((unit * mult).toFixed(2));
      return {
        id: `preview-${lg.poolCode}-${lg.optionKey}`,
        roleLabel: `部分覆盖单关#${idx + 1}`,
        legs: [lg],
        modeLabel: "单关",
        multiple: mult,
        cost: mult * 2,
        unitPayout: unit,
        returnPayout: ret,
        netProfit: Number((ret - minAlloc.totalCost).toFixed(2)),
        prob: lg.fairProb,
      };
    });
    return {
      poolCode: cand.poolCode,
      poolName: m.pools[cand.poolCode]?.name || cand.poolCode,
      isExactEquivalent: cand.isExactEquivalent,
      requiresExplicitConfirm:
        !cand.isExactEquivalent || minAlloc.totalCost > cleanBudget,
      confirmReason: !cand.isExactEquivalent
        ? "partial-coverage"
        : "over-budget-cap",
      authorizedMaxCost: cleanBudget,
      previewCost: minAlloc.totalCost,
      effectiveOdds: Number(cand.synEff.toFixed(4)),
      targetProb: Number(cand.targetProb.toFixed(8)),
      coveredProb: Number(cand.coveredInTargetProb.toFixed(8)),
      retainedDirectionRatio: Number(cand.retainedDirectionRatio.toFixed(8)),
      blindSpotProb: Number(cand.blindSpotProb.toFixed(8)),
      withinDirectionMissRatio: Number(
        cand.withinDirectionMissRatio.toFixed(8)
      ),
      overCoverProb: Number(cand.overCoverProb.toFixed(8)),
      blindSpotLabel: cand.blindSpotLabel ?? null,
      missedScores: cand.missedScores ?? [],
      previewLines,
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
    const matchById = new Map(selected.map((m) => [m.id, m]));
    const legalLines = Array.isArray(lines)
      ? lines.filter((l) => {
          if (!Array.isArray(l?.legs) || l.legs.length === 0) return false;
          if (l.legs.length === 1) {
            const lg = l.legs[0];
            const fm = matchById.get(lg.matchId);
            return fm ? isPoolSingleEligible(fm.pools?.[lg.poolCode]) : true;
          }
          return l.legs.every((lg) => {
            const fm = matchById.get(lg.matchId);
            return fm ? isPoolAllUpEligible(fm.pools?.[lg.poolCode]) : true;
          });
        })
      : [];
    if (!available || legalLines.length === 0) {
      return {
        key,
        available: false,
        alphaKind: alphaKind ?? "none",
        emptyReason:
          emptyReason ??
          (available && Array.isArray(lines) && lines.length > 0
            ? "所选玩法受体彩单关/过关销售资格限制，当前结构无法出票"
            : null),
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
        logicalGroupCount: 0,
        physicalTicketCount: 0,
        zeroPayoutProb: null,
        missOneReturn: null,
        wipeoutMiss2Prob: null,
        vigPct: 0,
        reasons,
        lines: [],
      };
    }

    lines = legalLines;

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

    const slotOut = {
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
      logicalGroupCount: lines.length,
      physicalTicketCount: countPhysical99xSlips(lines),
      zeroPayoutProb: Math.max(0, 1 - jointEval.anyWinProb),
      missOneReturn,
      ...(wipeoutMiss2Prob !== null ? { wipeoutMiss2Prob } : {}),
      vigPct,
      reasons: mergedReasons,
      lines,
    };
    return attachLazyConsolidatedLines(slotOut, lines);
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

  const formatProbPctHonest = (prob) => {
    const pct = Math.max(0, Math.min(100, Number(prob ?? 0) * 100));
    if (pct <= 1e-9) return "0.0%";
    if (pct < 0.1) return `${pct.toFixed(2)}%`;
    return `${pct.toFixed(1)}%`;
  };

  const evalLines4DObj = (lines, knownDisjoint = false) => {
    const cost = lines.reduce((a, l) => a + l.cost, 0);
    if (cost <= 0 || lines.length === 0) {
      return {
        evRate: -1,
        strictNetGainProb: 0,
        profitProb: 0,
        coveredFloorRatio: -1,
        missOneCvarRatio: 0,
        anyWinProb: 0,
        zeroPayoutProb: 1,
      };
    }
    let evRate;
    let strictNetGainProb;
    let profitProb;
    let coveredFloorRatio;
    let anyWinProb;
    if (knownDisjoint) {
      let expRet = 0;
      let pStrict = 0;
      let pProf = 0;
      let pWin = 0;
      let minPay = Infinity;
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        expRet += ln.prob * ln.returnPayout;
        if (ln.returnPayout > 0) pWin += ln.prob;
        if (ln.returnPayout > cost + 1e-6) pStrict += ln.prob;
        if (ln.returnPayout >= cost - 1e-6) pProf += ln.prob;
        if (ln.returnPayout > 0 && ln.returnPayout < minPay)
          minPay = ln.returnPayout;
      }
      evRate = (expRet - cost) / cost;
      strictNetGainProb = pStrict;
      profitProb = pProf;
      anyWinProb = Math.min(1, Math.max(0, pWin));
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
      strictNetGainProb = ev.strictNetGainProb;
      profitProb = ev.realProfitProb;
      anyWinProb = ev.anyWinProb;
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
      strictNetGainProb,
      profitProb,
      coveredFloorRatio,
      missOneCvarRatio: tailSum / tailLen,
      anyWinProb,
      zeroPayoutProb: Math.max(0, 1 - anyWinProb),
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
    if (!isPoolSingleEligible(pool)) return null;
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
    if (!isPoolAllUpEligible(pA) || !isPoolAllUpEligible(pB)) return null;
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

  let slot1StructureBadge = null;
  let slot1PassCapBlockedReason = null;
  let anchoredPassCapBlockedReason = null;
  let anchoredBlockHelper = null;

  if (selected.length >= 2 && hasUserAnchors) {
    const M = selected.length;
    let addedMainShield = false;
    const rawPerMatchAnc = selected.map((m, mPos) => {
      const anc = anchorsByMatch.get(m.id) ?? [];
      let allUpLegs = [];
      let singleLegs = [];
      if (anc.length > 0) {
        const byAllUpPool = new Map();
        const bySinglePool = new Map();
        for (const a of anc) {
          if (isPoolAllUpEligible(m.pools[a.poolCode])) {
            const list = byAllUpPool.get(a.poolCode) ?? [];
            list.push(a);
            byAllUpPool.set(a.poolCode, list);
          }
          if (isPoolSingleEligible(m.pools[a.poolCode])) {
            const sList = bySinglePool.get(a.poolCode) ?? [];
            sList.push(a);
            bySinglePool.set(a.poolCode, sList);
          }
        }
        const rankPoolEntries = (entries) =>
          entries.sort(
            (x, y) =>
              y[1].length - x[1].length ||
              Math.max(...y[1].map((p) => p.fairProb)) -
                Math.max(...x[1].map((p) => p.fairProb)) ||
              String(x[0]).localeCompare(String(y[0]))
          );
        const topAllUp = rankPoolEntries(Array.from(byAllUpPool.entries()))[0];
        if (topAllUp) {
          const [pCode, pks] = topAllUp;
          allUpLegs = pks
            .map((a) =>
              legOf(
                m,
                pCode,
                pCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
              )
            )
            .filter(Boolean);
        }
        const topSingle = rankPoolEntries(
          Array.from(bySinglePool.entries())
        )[0];
        if (topSingle) {
          const [sCode, pks] = topSingle;
          singleLegs = pks
            .map((a) =>
              legOf(
                m,
                sCode,
                sCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
              )
            )
            .filter(Boolean);
        }
        return {
          m,
          mPos,
          kind: "anc",
          allUpLegs,
          singleLegs,
          rawPoolCodes: Array.from(new Set(anc.map((a) => a.poolCode))),
        };
      }
      const primAllUp = preferredPrimaryLeg(m, true);
      const primSingle = preferredPrimaryLeg(m, false);
      return {
        m,
        mPos,
        kind: "unanc",
        allUpLegs: primAllUp ? [primAllUp] : [],
        singleLegs:
          primSingle && isPoolSingleEligible(m.pools[primSingle.poolCode])
            ? [primSingle]
            : [],
        rawPoolCodes: primAllUp ? [primAllUp.poolCode] : [primaryPoolOf(m)],
      };
    });

    const shieldAllowedSet = new Set();
    if (M <= 4) {
      for (let i = 0; i < M; i++) shieldAllowedSet.add(i);
    } else {
      const singleAncs = rawPerMatchAnc
        .filter((x) => x.kind === "anc" && x.allUpLegs.length === 1)
        .sort(
          (a, b) =>
            (a.allUpLegs[0]?.fairProb ?? 1) - (b.allUpLegs[0]?.fairProb ?? 1) ||
            a.mPos - b.mPos
        );
      for (const item of singleAncs.slice(0, 4)) {
        shieldAllowedSet.add(item.mPos);
      }
      for (const item of rawPerMatchAnc) {
        if (item.kind === "unanc" && shieldAllowedSet.size < 4) {
          shieldAllowedSet.add(item.mPos);
        }
      }
    }

    const shieldedAllUpOpts = rawPerMatchAnc.map(
      ({ m, mPos, kind, allUpLegs }) => {
        if (kind === "anc") {
          if (allUpLegs.length >= 2) return allUpLegs;
          if (allUpLegs.length === 1) {
            if (!shieldAllowedSet.has(mPos)) return allUpLegs;
            const sec = secondaryDisjointLegInPool(m, allUpLegs[0]);
            if (sec) addedMainShield = true;
            return sec ? [allUpLegs[0], sec] : allUpLegs;
          }
          return [];
        }
        const prim = allUpLegs[0] ?? preferredPrimaryLeg(m, true);
        if (!prim) return [];
        const pCode = prim.poolCode;
        if (
          !shieldAllowedSet.has(mPos) ||
          (pCode !== "HAD" && pCode !== "HHAD")
        ) {
          return [prim];
        }
        const others = (m.pools[pCode]?.options ?? [])
          .filter((o) => o.key !== prim.optionKey)
          .map((o) => legOf(m, pCode, o.key))
          .filter(Boolean);
        if (others.length > 0) addedMainShield = true;
        return [prim, ...others];
      }
    );

    const statutoryPassCap = Math.min(
      ...rawPerMatchAnc.map((item) => {
        const codes =
          item.rawPoolCodes.length > 0
            ? item.rawPoolCodes
            : [primaryPoolOf(item.m)];
        return Math.min(...codes.map((c) => POOL_MAX_PASS[c] ?? 8));
      })
    );

    if (hasExplicitPassSelection) {
      const reqSizes =
        Array.isArray(explicitPassSizes) && explicitPassSizes.length > 0
          ? explicitPassSizes
          : [M];
      if (reqSizes.some((s) => s > statutoryPassCap)) {
        const maxReq = Math.max(...reqSizes);
        anchoredPassCapBlockedReason = `当前共选 ${M} 场比赛，但所含子玩法（比分/半全场法定最高 4 关、总进球最高 6 关）最高仅支持 ${statutoryPassCap} 关，无法组成 ${maxReq}串1（超出最高过关上限 ${maxReq - statutoryPassCap} 场）；拒绝静默截尾丢场，可改用覆盖全部 ${M} 场的同方向低阶分块方案`;
      }
    }

    const requiredUserOptionSigs = new Set();
    for (const item of rawPerMatchAnc) {
      if (item.kind !== "anc") continue;
      const anc = anchorsByMatch.get(item.m.id) ?? [];
      const refPool =
        item.allUpLegs[0]?.poolCode ??
        item.singleLegs[0]?.poolCode ??
        anc[0]?.poolCode;
      for (const a of anc) {
        if (a.poolCode !== refPool) continue;
        const normKey =
          a.poolCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey;
        requiredUserOptionSigs.add(`${item.m.id}:${a.poolCode}:${normKey}`);
      }
    }

    const totalAnchoredCartesianSize = rawPerMatchAnc.reduce(
      (acc, item) =>
        acc * Math.max(1, item.allUpLegs.length || item.singleLegs.length || 1),
      1
    );

    const coversAllMatchesAndUserOptions = (lines) => {
      if (!Array.isArray(lines) || lines.length === 0) return false;
      const seenMatches = new Set();
      const seenOpts = new Set();
      for (const ln of lines) {
        for (const lg of ln.legs ?? []) {
          seenMatches.add(lg.matchId);
          const normKey =
            lg.poolCode === "CRS"
              ? lg.optionLabel || lg.optionKey
              : lg.optionKey;
          seenOpts.add(`${lg.matchId}:${lg.poolCode}:${normKey}`);
        }
      }
      if (seenMatches.size < M) return false;
      if (totalAnchoredCartesianSize <= 9) {
        for (const reqSig of requiredUserOptionSigs) {
          if (!seenOpts.has(reqSig)) return false;
        }
      }
      return true;
    };

    const solveZeroUnderwaterBlockSpecs = (
      specs,
      budgetLimit,
      mode = "strict-prob",
      opts = {}
    ) => {
      if (!Array.isArray(specs) || specs.length === 0) return [];
      const K = specs.length;
      const maxNotes = Math.floor(budgetLimit / 2);
      if (maxNotes < K) return [];
      const units = specs.map((sp) => {
        const rawU = bankerRoundParlayUnitPayout(sp.legs.map((g) => g.odds));
        return Math.min(statutorySingleBetCap(sp.legs.length), rawU);
      });
      if (units.some((u) => !(u > 2.0))) return [];
      const probs = specs.map((sp) =>
        sp.legs.reduce((acc, g) => acc * g.fairProb, 1)
      );

      const minStrictNotesFor = (u, targetCost) => {
        let m = Math.max(1, Math.floor((targetCost + 1e-6) / u) + 1);
        while (m <= 999 && Number((m * u).toFixed(2)) <= targetCost + 1e-6) {
          m += 1;
        }
        return m;
      };
      const minBeNotesFor = (u, targetCost) => {
        let m = Math.max(1, Math.ceil((targetCost - 1e-6) / u));
        while (m <= 999 && Number((m * u).toFixed(2)) < targetCost - 1e-6) {
          m += 1;
        }
        return m;
      };

      const buildCandidateNs = () => {
        if (maxNotes <= 64) {
          const arr = [];
          for (let n = maxNotes; n >= K; n--) arr.push(n);
          return arr;
        }
        const set = new Set([maxNotes, K]);
        for (let d = 1; d <= 24; d++) {
          if (maxNotes - d >= K) set.add(maxNotes - d);
          if (K + d <= maxNotes) set.add(K + d);
        }
        for (let step = 1; step <= 16; step++) {
          const n = Math.round(K + ((maxNotes - K) * step) / 16);
          if (n >= K && n <= maxNotes) set.add(n);
        }
        return Array.from(set).sort((a, b) => b - a);
      };

      const candNs = buildCandidateNs();
      const refWealth = Math.max(2, opts.fixedRefWealth ?? budgetLimit);
      const GAMMA = 0.65;

      const allocateAtN = (N, requireAllStrict) => {
        const cost = 2 * N;
        const base = units.map((u) =>
          requireAllStrict ? minStrictNotesFor(u, cost) : minBeNotesFor(u, cost)
        );
        if (base.some((m) => m > 999)) return null;
        let used = base.reduce((a, b) => a + b, 0);
        if (used > N) return null;
        const mults = [...base];
        let rem = N - used;

        if (!requireAllStrict && rem > 0) {
          const beOrder = Array.from({ length: K }, (_, i) => i)
            .filter(
              (i) =>
                mults[i] < 999 &&
                Number((mults[i] * units[i]).toFixed(2)) <= cost + 1e-6
            )
            .sort((a, b) => probs[b] - probs[a]);
          for (const idx of beOrder) {
            if (rem <= 0) break;
            mults[idx] += 1;
            rem -= 1;
          }
        }

        while (rem > 0) {
          const chunk = rem > 64 ? Math.max(1, Math.floor(rem / 32)) : 1;
          let bestIdx = -1;
          let bestGain = -Infinity;
          for (let i = 0; i < K; i++) {
            if (mults[i] >= 999) continue;
            const step = Math.min(chunk, 999 - mults[i], rem);
            let gain;
            if (mode === "log-utility") {
              const curPay = mults[i] * units[i];
              const nxtPay = (mults[i] + step) * units[i];
              gain =
                probs[i] *
                (Math.log(
                  Math.max(1e-6, 1 + (GAMMA * (nxtPay - cost)) / refWealth)
                ) -
                  Math.log(
                    Math.max(1e-6, 1 + (GAMMA * (curPay - cost)) / refWealth)
                  ));
            } else {
              gain = probs[i] * units[i] * step;
            }
            if (gain > bestGain + 1e-15) {
              bestGain = gain;
              bestIdx = i;
            }
          }
          if (bestIdx < 0) break;
          const add = Math.min(chunk, 999 - mults[bestIdx], rem);
          mults[bestIdx] += add;
          rem -= add;
        }
        return materializePlanLines(specs, mults);
      };

      if (opts.preferMinStake) {
        const ascNs = [...candNs].sort((a, b) => a - b);
        for (const N of ascNs) {
          const strictLines = allocateAtN(N, true);
          if (strictLines) return strictLines;
        }
        for (const N of ascNs) {
          const beLines = allocateAtN(N, false);
          if (beLines) return beLines;
        }
        return [];
      }

      if (mode === "log-utility" && opts.sweepAllSubBudgets) {
        let bestLines = [];
        let bestU = -Infinity;
        for (const N of candNs) {
          const candLines = allocateAtN(N, true) ?? allocateAtN(N, false);
          if (!candLines) continue;
          const u = evalLogWealthUtility(candLines, false);
          if (u > bestU + 1e-12) {
            bestU = u;
            bestLines = candLines;
          }
        }
        return bestLines;
      }

      for (const N of candNs) {
        const strictLines = allocateAtN(N, true);
        if (strictLines) return strictLines;
      }
      for (const N of candNs) {
        const beLines = allocateAtN(N, false);
        if (beLines) return beLines;
      }
      return [];
    };

    const ordByProb = Array.from({ length: M }, (_, idx) => {
      const pSum =
        rawPerMatchAnc[idx].allUpLegs.reduce(
          (a, g) => a + (g.fairProb || 0),
          0
        ) ||
        rawPerMatchAnc[idx].singleLegs.reduce(
          (a, g) => a + (g.fairProb || 0),
          0
        );
      return { idx, pSum, id: selected[idx].id };
    })
      .sort(
        (a, b) => b.pSum - a.pSum || String(a.id).localeCompare(String(b.id))
      )
      .map((x) => x.idx);

    const buildBlockPartitionSpecSets = ({
      forceAllowSubPass = false,
    } = {}) => {
      const effectiveExplicit = hasExplicitPassSelection && !forceAllowSubPass;
      const reqSizes = effectiveExplicit
        ? Array.isArray(explicitPassSizes) && explicitPassSizes.length > 0
          ? explicitPassSizes
          : [M]
        : null;
      const allowSize = (k) =>
        k >= 1 && k <= statutoryPassCap && (!reqSizes || reqSizes.includes(k));

      const rawTopologies = [];
      const pushTopo = (blocks, structureBadge) => {
        const normBlocks = blocks.map((b) => [...b].sort((x, y) => x - y));
        if (normBlocks.some((b) => !allowSize(b.length))) return;
        const cov = new Set(normBlocks.flat());
        if (cov.size !== M) return;
        const sig = normBlocks
          .map((b) => b.join("."))
          .sort()
          .join("|");
        if (rawTopologies.some((t) => t.sig === sig)) return;
        rawTopologies.push({ sig, blocks: normBlocks, structureBadge });
      };

      if (allowSize(M)) {
        pushTopo([Array.from({ length: M }, (_, i) => i)], null);
      }

      if (!effectiveExplicit || (reqSizes && reqSizes.some((s) => s < M))) {
        if (M >= 3 && allowSize(2)) {
          if (M === 3) {
            pushTopo(
              [
                [0, 1],
                [0, 2],
                [1, 2],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [ordByProb[0], ordByProb[1]],
                [ordByProb[0], ordByProb[2]],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [ordByProb[1], ordByProb[0]],
                [ordByProb[1], ordByProb[2]],
              ],
              "同向 2串1 分块"
            );
          } else if (M === 4) {
            pushTopo(
              [
                [0, 1],
                [2, 3],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [0, 2],
                [1, 3],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [0, 3],
                [1, 2],
              ],
              "同向 2串1 分块"
            );
            pushTopo(combinationsOfIndices(4, 2), "同向 2串1 分块");
          } else if (M === 5) {
            pushTopo(
              [
                [ordByProb[0], ordByProb[4]],
                [ordByProb[1], ordByProb[3]],
                [ordByProb[0], ordByProb[2]],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [ordByProb[0], ordByProb[1]],
                [ordByProb[2], ordByProb[3]],
                [ordByProb[0], ordByProb[4]],
              ],
              "同向 2串1 分块"
            );
          } else if (M === 6) {
            pushTopo(
              [
                [ordByProb[0], ordByProb[5]],
                [ordByProb[1], ordByProb[4]],
                [ordByProb[2], ordByProb[3]],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [ordByProb[0], ordByProb[1]],
                [ordByProb[2], ordByProb[3]],
                [ordByProb[4], ordByProb[5]],
              ],
              "同向 2串1 分块"
            );
          } else if (M === 7) {
            pushTopo(
              [
                [ordByProb[0], ordByProb[6]],
                [ordByProb[1], ordByProb[5]],
                [ordByProb[2], ordByProb[4]],
                [ordByProb[0], ordByProb[3]],
              ],
              "同向 2串1 分块"
            );
          } else if (M === 8) {
            pushTopo(
              [
                [ordByProb[0], ordByProb[7]],
                [ordByProb[1], ordByProb[6]],
                [ordByProb[2], ordByProb[5]],
                [ordByProb[3], ordByProb[4]],
              ],
              "同向 2串1 分块"
            );
            pushTopo(
              [
                [ordByProb[0], ordByProb[1]],
                [ordByProb[2], ordByProb[3]],
                [ordByProb[4], ordByProb[5]],
                [ordByProb[6], ordByProb[7]],
              ],
              "同向 2串1 分块"
            );
          }
        }

        if (M === 5 && allowSize(2) && allowSize(3)) {
          pushTopo(
            [
              [ordByProb[0], ordByProb[4]],
              [ordByProb[1], ordByProb[2], ordByProb[3]],
            ],
            "同向 2/3串1 分块"
          );
        } else if (M === 6 && allowSize(3)) {
          pushTopo(
            [
              [ordByProb[0], ordByProb[3], ordByProb[5]],
              [ordByProb[1], ordByProb[2], ordByProb[4]],
            ],
            "同向 3串1 分块"
          );
        } else if (M === 7 && allowSize(2) && allowSize(3)) {
          pushTopo(
            [
              [ordByProb[0], ordByProb[6]],
              [ordByProb[1], ordByProb[5]],
              [ordByProb[2], ordByProb[3], ordByProb[4]],
            ],
            "同向 2/3串1 分块"
          );
        } else if (M === 7 && allowSize(3) && allowSize(4)) {
          pushTopo(
            [
              [ordByProb[0], ordByProb[4], ordByProb[6]],
              [ordByProb[1], ordByProb[2], ordByProb[3], ordByProb[5]],
            ],
            "同向 3/4串1 分块"
          );
        } else if (M === 8 && allowSize(4)) {
          pushTopo(
            [
              [ordByProb[0], ordByProb[3], ordByProb[5], ordByProb[6]],
              [ordByProb[1], ordByProb[2], ordByProb[4], ordByProb[7]],
            ],
            "同向 4串1 分块"
          );
        }

        if (M >= 3 && M % 2 === 1 && allowSize(1) && allowSize(2)) {
          const sglCandIdx = ordByProb.find(
            (i) => rawPerMatchAnc[i].singleLegs.length > 0
          );
          if (sglCandIdx !== undefined) {
            const rem = ordByProb.filter((i) => i !== sglCandIdx);
            const hBlocks = [[sglCandIdx]];
            for (let lo = 0, hi = rem.length - 1; lo < hi; lo++, hi--) {
              hBlocks.push([rem[lo], rem[hi]]);
            }
            pushTopo(hBlocks, "同向 单关+2串1 分块");
          }
        }

        if (
          allowSize(1) &&
          rawPerMatchAnc.every((item) => item.singleLegs.length > 0)
        ) {
          pushTopo(
            Array.from({ length: M }, (_, i) => [i]),
            "同向单关分块"
          );
        }
      }

      const outSpecSets = [];
      for (const topo of rawTopologies) {
        const isFullSingleBlock =
          topo.blocks.length === 1 && topo.blocks[0].length === M;
        const blockSpecLists = [];
        let validTopo = true;
        for (let bIdx = 0; bIdx < topo.blocks.length; bIdx++) {
          const blk = topo.blocks[bIdx];
          if (blk.length === 1) {
            const sLegs = rawPerMatchAnc[blk[0]].singleLegs;
            if (sLegs.length === 0) {
              validTopo = false;
              break;
            }
            for (let k = 0; k < sLegs.length; k++) {
              blockSpecLists.push({
                id: `anc-blk-${topo.sig}-s-${blk[0]}-${k + 1}`,
                roleLabel: `同向单关分块#${blockSpecLists.length + 1}`,
                legs: [sLegs[k]],
              });
            }
          } else {
            let tuples = [[]];
            for (let bi = 0; bi < blk.length; bi++) {
              const mIdx = blk[bi];
              const aLegs = rawPerMatchAnc[mIdx].allUpLegs;
              if (
                aLegs.length === 0 ||
                aLegs.some((g) => (POOL_MAX_PASS[g.poolCode] ?? 8) < blk.length)
              ) {
                tuples = [];
                break;
              }
              const next = [];
              for (let x = 0; x < tuples.length; x++) {
                for (let y = 0; y < aLegs.length; y++) {
                  next.push([...tuples[x], aLegs[y]]);
                }
              }
              tuples = next;
              const tupleLimit = isFullSingleBlock ? 8192 : 64;
              if (tuples.length > tupleLimit) {
                tuples = [];
                break;
              }
            }
            if (tuples.length === 0) {
              validTopo = false;
              break;
            }
            for (let t = 0; t < tuples.length; t++) {
              blockSpecLists.push({
                id: `anc-blk-${topo.sig}-${bIdx + 1}-${t + 1}`,
                roleLabel: isFullSingleBlock
                  ? t === 0
                    ? "雷达主选铁干"
                    : `同向复式支#${t}`
                  : `同向${blk.length}串1分块#${blockSpecLists.length + 1}`,
                legs: tuples[t],
              });
            }
          }
        }
        if (validTopo && blockSpecLists.length > 0) {
          outSpecSets.push({
            specs: blockSpecLists,
            structureBadge: topo.structureBadge,
            isFullSingleBlock,
            hasSyntheticShield: false,
          });
        }
        if (isFullSingleBlock && addedMainShield) {
          let shTuples = [[]];
          for (let i = 0; i < M; i++) {
            const opts = shieldedAllUpOpts[i];
            if (
              opts.length === 0 ||
              opts.some((g) => (POOL_MAX_PASS[g.poolCode] ?? 8) < M)
            ) {
              shTuples = [];
              break;
            }
            const next = [];
            for (let x = 0; x < shTuples.length; x++) {
              for (let y = 0; y < opts.length; y++) {
                next.push([...shTuples[x], opts[y]]);
              }
            }
            shTuples = next;
            if (shTuples.length > 64) {
              shTuples = [];
              break;
            }
          }
          if (shTuples.length > 0) {
            outSpecSets.push({
              specs: shTuples.map((legs, idx) => ({
                id: `mp-anc-${idx + 1}`,
                roleLabel: idx === 0 ? "雷达主选铁干" : `防冷保本盾#${idx}`,
                legs,
              })),
              structureBadge: null,
              isFullSingleBlock: true,
              hasSyntheticShield: true,
            });
          }
        }
      }
      return outSpecSets;
    };

    anchoredBlockHelper = {
      statutoryPassCap,
      rawPerMatchAnc,
      shieldedAllUpOpts,
      addedMainShield,
      coversAllMatchesAndUserOptions,
      solveZeroUnderwaterBlockSpecs,
      buildBlockPartitionSpecSets,
    };
  }

  let slot1SinglePartialPreview = null;
  let slot1BlockedPartialReason = null;

  const solveFullSetZeroUnderwaterLines = (specs, budgetLimit) => {
    if (!Array.isArray(specs) || specs.length === 0) return [];
    const maxNotes = Math.floor(budgetLimit / 2);
    if (maxNotes < specs.length) return [];
    const kpLines = solveExactKnapsackDutching(specs, budgetLimit, 64);
    if (kpLines.length === specs.length) return kpLines;

    const singleCap = statutorySingleBetCap(1);
    const rawUnits = specs.map((s) =>
      bankerRoundParlayUnitPayout(s.legs.map((g) => g.odds))
    );
    const cappedUnits = rawUnits.map((u) => Math.min(singleCap, u));
    const dutchItems = specs.map((s, idx) => ({
      unitPayout: cappedUnits[idx],
      prob: s.legs.reduce((a, g) => a * g.fairProb, 1),
      isCapClipped: rawUnits[idx] > singleCap,
    }));
    for (const strict of [true, false]) {
      for (let N = maxNotes; N >= specs.length; N--) {
        const cand = allocateInverseOddsDutching(dutchItems, N, {
          requireStrictNetGain: strict,
        });
        if (cand) {
          return materializePlanLines(specs, cand.mults);
        }
      }
    }
    return [];
  };

  const computeEffectiveSlot1VigGatePct = (lines, rawVigPct, evRateVal) => {
    if (selected.length === 1) {
      return Math.min(rawVigPct, Math.max(0, -(evRateVal ?? -1) * 100));
    }
    const hasSubPoolLeg = lines.some((l) =>
      l.legs.some((g) => g.poolCode !== "HAD" && g.poolCode !== "HHAD")
    );
    if (hasSubPoolLeg) return rawVigPct;
    const maxK = Math.max(1, ...lines.map((l) => l.legs.length));
    if (maxK <= 3) return rawVigPct;
    // Pure HAD/HHAD >=4-leg full-slate Dutching: normalize to 3-leg equivalent main-pool vig so statutory 0.88^4..0.88^8 main-pool boxes aren't misclassified as sub-pool vig snowballs
    const avgRatio = Math.max(0.01, Math.min(1, 1 - rawVigPct / 100));
    const perLegRatio = Math.pow(avgRatio, 1 / maxK);
    return (1 - Math.pow(perLegRatio, 3)) * 100;
  };

  const passesSlot1AdmissionObj = (lines, obj) => {
    if (!lines || lines.length === 0 || !obj) return false;
    if (obj.coveredFloorRatio < -1e-9) return false;
    if (obj.strictNetGainProb < 0.2 - 1e-9) return false;
    if ((obj.zeroPayoutProb ?? 1) > 0.8 + 1e-9) return false;
    const { vigPct } = computeCapitalWeightedVig(lines, selected);
    const effVigPct = computeEffectiveSlot1VigGatePct(
      lines,
      vigPct,
      obj.evRate
    );
    return effVigPct <= 35 + 1e-9;
  };

  if (selected.length === 1) {
    const m1 = selected[0];
    const anc = anchorsByMatch.get(m1.id) ?? [];
    const ancSinglePool =
      anc.length > 0 &&
      anc.every(
        (a) =>
          isPoolSingleEligible(m1.pools[a.poolCode]) &&
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
        slot1Cands.push({
          lines,
          obj,
          admissible: passesSlot1AdmissionObj(lines, obj),
        });
      }
      slot1Cands.sort(
        (a, b) =>
          Number(b.admissible) - Number(a.admissible) ||
          b.obj.strictNetGainProb - a.obj.strictNetGainProb ||
          b.obj.profitProb - a.obj.profitProb ||
          b.obj.coveredFloorRatio - a.obj.coveredFloorRatio ||
          b.obj.evRate - a.obj.evRate
      );
      if (slot1Cands[0]) slot1Lines = slot1Cands[0].lines;
    } else if (anc.length > 0) {
      const subsetCands = resolveSingleMatchSubsetCandidates(m1, anc);
      const exactCands = subsetCands.filter((c) => c.isExactEquivalent);
      const slot1Cands = [];
      for (const ec of exactCands) {
        const specs = ec.legs.map((lg, idx) => ({
          id: `mp-eq-${ec.poolCode}-${idx + 1}`,
          roleLabel: idx === 0 ? "等价单关·主干" : `等价单关·配平盾#${idx}`,
          legs: [lg],
        }));
        const lines = solveFullSetZeroUnderwaterLines(specs, cleanBudget);
        if (lines.length !== specs.length) continue;
        const obj = evalLines4DObj(lines, true);
        if (obj.coveredFloorRatio < -1e-9) continue;
        slot1Cands.push({
          lines,
          obj,
          admissible: passesSlot1AdmissionObj(lines, obj),
        });
      }
      if (slot1Cands.length > 0) {
        slot1Cands.sort((a, b) => {
          if (a.admissible !== b.admissible) {
            return Number(b.admissible) - Number(a.admissible);
          }
          if (
            Math.abs(b.obj.strictNetGainProb - a.obj.strictNetGainProb) > 1e-9
          ) {
            return b.obj.strictNetGainProb - a.obj.strictNetGainProb;
          }
          if (Math.abs(b.obj.profitProb - a.obj.profitProb) > 1e-9) {
            return b.obj.profitProb - a.obj.profitProb;
          }
          if (
            Math.abs(b.obj.coveredFloorRatio - a.obj.coveredFloorRatio) > 1e-6
          ) {
            return b.obj.coveredFloorRatio - a.obj.coveredFloorRatio;
          }
          return b.obj.evRate - a.obj.evRate;
        });
        slot1Lines = slot1Cands[0].lines;
      } else if (subsetCands[0]) {
        slot1SinglePartialPreview = buildSinglePartialCoveragePreview(
          m1,
          subsetCands[0]
        );
        if (acceptPartialSingleCoverage) {
          const pSpecs = subsetCands[0].legs.map((lg, idx) => ({
            id: `mp-part-${idx + 1}`,
            roleLabel: `部分覆盖单关#${idx + 1}`,
            legs: [lg],
          }));
          const lines = solveExactKnapsackDutching(pSpecs, cleanBudget, 64);
          if (lines.length > 0) slot1Lines = lines;
        } else {
          const prev = slot1SinglePartialPreview;
          slot1BlockedPartialReason = prev
            ? prev.isExactEquivalent
              ? `所锁非单关方向虽有等价单关集合，但零倒贴整数配平最少需 ¥${prev.previewCost}（超出当前预算 ¥${cleanBudget}），已拒绝静默缩水丢项`
              : `所锁方向无 100% 双向等价单关（最优纯子集为${prev.poolName}，保住原方向 ${(prev.retainedDirectionRatio * 100).toFixed(1)}%、漏保 ${(prev.blindSpotProb * 100).toFixed(2)}%，完整配平需 ¥${prev.previewCost}），未经确认绝不静默篡改方向`
            : `所锁非单关方向在当前预算 ¥${cleanBudget} 下不存在等价可单关替代`;
        }
      } else {
        slot1BlockedPartialReason = `所锁非单关方向不存在任何合法可单关纯子集`;
      }
    } else {
      for (const code of ["HAD", "HHAD", "HAFU", "TTG", "CRS"]) {
        const sp = buildSinglePoolSpecs(m1, code, `mp-${code}`);
        if (sp) candidateSets.push(sp);
      }
      const slot1Cands = [];
      for (const cs of candidateSets) {
        const lines = solveExactKnapsackDutching(cs, cleanBudget, 64);
        if (lines.length === 0) continue;
        const obj = evalLines4DObj(lines, true);
        if (obj.coveredFloorRatio < -1e-9) continue;
        slot1Cands.push({
          lines,
          obj,
          admissible: passesSlot1AdmissionObj(lines, obj),
        });
      }
      slot1Cands.sort(
        (a, b) =>
          Number(b.admissible) - Number(a.admissible) ||
          b.obj.strictNetGainProb - a.obj.strictNetGainProb ||
          b.obj.profitProb - a.obj.profitProb ||
          b.obj.coveredFloorRatio - a.obj.coveredFloorRatio ||
          b.obj.evRate - a.obj.evRate
      );
      if (slot1Cands[0]) slot1Lines = slot1Cands[0].lines;
    }
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
          const pPool = m.pools[pCode];
          const opts =
            pPool && pPool.selling !== false && Array.isArray(pPool.options)
              ? pPool.options.map((o) => legOf(m, pCode, o.key)).filter(Boolean)
              : [];
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

    const isBetterSlot1Obj = (candLines, candObj, curBest) => {
      if (!curBest) return true;
      const curObj = curBest.obj;
      const candAdm = passesSlot1AdmissionObj(candLines, candObj);
      const curAdm = passesSlot1AdmissionObj(curBest.lines, curObj);
      if (candAdm !== curAdm) return candAdm;
      if (
        Math.abs(candObj.strictNetGainProb - curObj.strictNetGainProb) > 1e-12
      ) {
        return candObj.strictNetGainProb > curObj.strictNetGainProb;
      }
      if (Math.abs(candObj.profitProb - curObj.profitProb) > 1e-12) {
        return candObj.profitProb > curObj.profitProb;
      }
      if (
        Math.abs(candObj.coveredFloorRatio - curObj.coveredFloorRatio) > 1e-9
      ) {
        return candObj.coveredFloorRatio > curObj.coveredFloorRatio;
      }
      return candObj.evRate > curObj.evRate + 1e-9;
    };

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
      if (isBetterSlot1Obj(lines, obj, bestObj)) {
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
            isBetterSlot1Obj(partLines, partObj, bestObj)
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
  } else if (anchoredPassCapBlockedReason) {
    slot1PassCapBlockedReason = anchoredPassCapBlockedReason;
    slot1Lines = [];
  } else if (anchoredBlockHelper) {
    const specSets = anchoredBlockHelper.buildBlockPartitionSpecSets();
    const compareSlot1Cands = (a, b) => {
      if (a.admissible !== b.admissible) {
        return Number(b.admissible) - Number(a.admissible);
      }
      if (Math.abs(b.obj.strictNetGainProb - a.obj.strictNetGainProb) > 1e-12) {
        return b.obj.strictNetGainProb - a.obj.strictNetGainProb;
      }
      if (Math.abs(b.obj.profitProb - a.obj.profitProb) > 1e-12) {
        return b.obj.profitProb - a.obj.profitProb;
      }
      if (Math.abs(b.obj.coveredFloorRatio - a.obj.coveredFloorRatio) > 1e-9) {
        return b.obj.coveredFloorRatio - a.obj.coveredFloorRatio;
      }
      return b.obj.evRate - a.obj.evRate;
    };

    const slot1Cands = [];
    for (const ss of specSets) {
      let candLinesList = [];
      if (ss.isFullSingleBlock) {
        const kpLines = solveExactKnapsackDutching(
          ss.specs,
          cleanBudget,
          64,
          ss.hasSyntheticShield ? { pinnedFirstId: "mp-anc-1" } : {}
        );
        if (kpLines.length > 0) candLinesList.push(kpLines);
        if (kpLines.length === 0 && ss.hasSyntheticShield) {
          const kpFallback = solveExactKnapsackDutching(ss.specs, cleanBudget);
          if (kpFallback.length > 0) candLinesList.push(kpFallback);
        }
        if (!ss.hasSyntheticShield) {
          const fullSetLines = solveFullSetZeroUnderwaterLines(
            ss.specs,
            cleanBudget
          );
          if (fullSetLines.length === ss.specs.length) {
            candLinesList.push(fullSetLines);
          }
        }
      } else {
        const blkLines = anchoredBlockHelper.solveZeroUnderwaterBlockSpecs(
          ss.specs,
          cleanBudget,
          "strict-prob",
          {
            preferMinStake:
              Boolean(portfolioOptions?.preferMinSingleStake) &&
              ss.specs.every((sp) => sp.legs.length === 1),
          }
        );
        if (blkLines.length > 0) candLinesList.push(blkLines);
      }

      for (const lines of candLinesList) {
        if (!anchoredBlockHelper.coversAllMatchesAndUserOptions(lines))
          continue;
        const obj = evalLines4DObj(lines, ss.isFullSingleBlock);
        if (obj.coveredFloorRatio < -1e-9) continue;
        slot1Cands.push({
          lines,
          obj,
          admissible: passesSlot1AdmissionObj(lines, obj),
          structureBadge: ss.structureBadge,
        });
      }
    }

    slot1Cands.sort(compareSlot1Cands);
    if (slot1Cands[0]) {
      slot1Lines = slot1Cands[0].lines;
      slot1StructureBadge = slot1Cands[0].structureBadge;
    }

    if (selected.length >= 4) {
      let best2mProb = 0;
      const perMatchDisjointOpts = anchoredBlockHelper.shieldedAllUpOpts;
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
        slot1Lines.length > 0
          ? evalLines4DObj(slot1Lines, false).profitProb
          : 0;
      if (best2mProb > 0) {
        slot1AnchoredTwoMatchNote =
          best2mProb > curAncProb + 1e-6
            ? `💡 当前已完整保留全部 ${selected.length} 场求解全局最优（不亏率 ${(curAncProb * 100).toFixed(1)}%）；若精简至核心 2 场，零倒贴不亏率可升至 ${(best2mProb * 100).toFixed(1)}%`
            : `💡 当前已完整保留全部 ${selected.length} 场求解全局最优，对标核心 2 场保本上限 ${(best2mProb * 100).toFixed(1)}%`;
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
    slot1StructureBadge
      ? `未显式锁定过关阶数，已将【${slot1StructureBadge}】纳入全场次同方向择优（较满关长串大幅降低连乘抽水与归零率）`
      : slot1SyntheticUsed
        ? "主盘未开单关，已自动跨盘比选最低等效抽水的合成单关入口并执行精确 0-1 背包配平"
        : "基于精确整数 0-1 背包动态规划（Exact Knapsack Dutching）求解满场零倒贴不亏率全局最优解",
    slot1BreakEvenCount > 0
      ? `施加覆盖态零假中奖约束（含 ${slot1BreakEvenCount} 张刚好退回本金净赚 ¥0.00 的保本回笼支）`
      : "施加覆盖态 100% 零假中奖硬约束，命中覆盖集合内任一赛果确保净赚不倒贴",
  ];
  if (slot1AnchoredTwoMatchNote) slot1Reasons.push(slot1AnchoredTwoMatchNote);

  const slot1BlockedReason =
    slot1PassCapBlockedReason ?? slot1BlockedPartialReason;
  const slot1TotalSpend = slot1Lines.reduce((a, l) => a + l.cost, 0);
  const slot1Valid = slot1Lines.length > 0 && slot1TotalSpend <= cleanBudget;
  let slot1Plan = packSlot({
    key: "max-profit-prob",
    available: slot1Valid,
    emptyReason: slot1Valid
      ? null
      : (slot1BlockedReason ??
        `当前预算 ¥${cleanBudget} 下无法构造满足零倒贴与体彩单注法定封顶约束的有效注单（已全额保留 ¥${cleanBudget}）`),
    shortTab: "🛡️ 稳健保本",
    badge:
      slot1Valid && slot1StructureBadge
        ? `🛡️ 稳健保本极值 · ${slot1StructureBadge}`
        : "🛡️ 稳健保本极值",
    title: slot1Valid
      ? slot1StructureBadge
        ? `稳健保本 · ${slot1StructureBadge}（覆盖态零假中奖）`
        : "覆盖态零假中奖 · 真赚钱率最大化"
      : slot1PassCapBlockedReason
        ? "所选场次超出子玩法最高过关上限 · 拒绝静默丢场"
        : slot1BlockedPartialReason
          ? "所锁方向无完全等价单关 · 待确认部分覆盖或加场"
          : "当前预算或限赔约束下无合法零倒贴注单",
    tagline: !slot1Valid
      ? slot1BlockedReason
        ? `严守方向与全选场次不越界 · 全额保留 ¥${cleanBudget}`
        : `已替你拦截超额或封顶废票 · 全额保留 ¥${cleanBudget}`
      : slot1BreakEvenCount > 0
        ? `${slot1StructureBadge ? `${slot1StructureBadge} · ` : ""}覆盖范围内不倒贴（含刚退本金保护支）· 彻底杜绝中奖倒贴`
        : `${slot1StructureBadge ? `${slot1StructureBadge} · ` : ""}覆盖范围内不倒贴（命中任一覆盖组合 100% 净赚）· 彻底杜绝中奖倒贴`,
    lines: slot1Valid ? slot1Lines : [],
    reasons: slot1Valid
      ? slot1Reasons
      : slot1BlockedReason
        ? [slot1BlockedReason]
        : slot1Reasons,
  });

  if (slot1Plan.available) {
    const s1Strict = slot1Plan.strictNetGainProb ?? 0;
    const s1Zero =
      slot1Plan.zeroPayoutProb ?? Math.max(0, 1 - slot1Plan.winProb);
    const s1GateFailures = [];
    if (slot1Plan.underwaterCount > 0) {
      s1GateFailures.push(`存在 ${slot1Plan.underwaterCount} 个中奖倒贴层级`);
    }
    if (s1Strict < 0.2 - 1e-9) {
      s1GateFailures.push(
        `严格净赚率 ${formatProbPctHonest(s1Strict)} 低于 20.0% 准入红线`
      );
    }
    if (s1Zero > 0.8 + 1e-9) {
      s1GateFailures.push(
        `整单归零率 ${formatProbPctHonest(s1Zero)} 超出 80.0% 风险红线`
      );
    }
    const effSlot1VigPct = computeEffectiveSlot1VigGatePct(
      slot1Plan.lines,
      slot1Plan.vigPct,
      slot1Plan.objectiveEVRate ?? slot1Plan.expectedValueRate
    );
    if (effSlot1VigPct > 35 + 1e-9) {
      s1GateFailures.push(
        `综合抽水损耗 ${effSlot1VigPct.toFixed(1)}% 超出 35.0% 抽水红线`
      );
    }
    if (s1GateFailures.length > 0) {
      const s1GateReason = `当前方向与过关约束下未达【🛡️ 稳健保本】实盘准入红线（${s1GateFailures.join("；")}），已拦截高归零废票并全额保留 ¥${cleanBudget}`;
      slot1Plan = packSlot({
        key: "max-profit-prob",
        available: false,
        emptyReason: s1GateReason,
        shortTab: "🛡️ 稳健保本",
        badge: "🛡️ 稳健保本极值 · 未达准入红线",
        title: "未达稳健保本准入红线 · 建议降阶或空仓护本",
        tagline: `严守 ≥20% 严格净赚率与 ≤35% 抽水红线 · 全额保留 ¥${cleanBudget}`,
        lines: [],
        reasons: [s1GateReason],
      });
    } else {
      const zPctText = formatProbPctHonest(s1Zero);
      slot1Plan.tagline =
        slot1BreakEvenCount > 0
          ? `${slot1StructureBadge ? `${slot1StructureBadge} · ` : ""}整单归零率 ${zPctText} · 覆盖范围内不倒贴（含刚退本金保护支）`
          : `${slot1StructureBadge ? `${slot1StructureBadge} · ` : ""}整单归零率 ${zPctText} · 覆盖范围内不倒贴（命中覆盖组合 100% 净赚）`;
      if (slot1StructureBadge) {
        slot1Plan.structureBadge = slot1StructureBadge;
      }
      if (slot1BreakEvenCount > 0) {
        const beIdx = slot1Plan.reasons.findIndex((r) =>
          r.includes("施加覆盖态零假中奖约束")
        );
        if (beIdx >= 0) {
          slot1Plan.reasons[beIdx] =
            `施加覆盖态零假中奖约束（含 ${slot1BreakEvenCount} 张刚好退回本金净赚 ¥0.00 的保本回笼支，严格净赚率 ${formatProbPctHonest(s1Strict)}）`;
        }
      }
      slot1Plan.reasons.push(
        `风险诚实披露：整单归零率 ${zPctText}（未命中覆盖集合损 ¥${slot1Plan.totalCost}）· 覆盖范围内不倒贴`
      );
    }
  }
  if (slot1SinglePartialPreview) {
    slot1Plan.partialCoveragePreview = slot1SinglePartialPreview;
  }

  // =========================================================================
  // Slot ②: max-ev-utility (⚖️ 期望效用 · 对数财富效用 + 按单腿 O·p 剔除高抽水拖累腿 + 防封顶)
  // =========================================================================
  let evActiveMatches = [...selected];
  const prunedDragMatches = [];
  let anchoredDragWarning = null;

  const canSingleMainPool = (m) =>
    Boolean(
      isPoolSingleEligible(m.pools.HAD) || isPoolSingleEligible(m.pools.HHAD)
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
  let slot2SinglePartialPreview = null;
  let slot2BlockedPartialReason = null;

  const solveExactSetUtilityLines = (rawLegs, budgetLimit) => {
    if (!Array.isArray(rawLegs) || rawLegs.length === 0) return [];
    const sortedLegs = [...rawLegs].sort(
      (a, b) =>
        b.odds * b.fairProb - a.odds * a.fairProb || b.fairProb - a.fairProb
    );
    const fullFallbackSpecs = sortedLegs.map((lg, idx) => ({
      id: `ev-eq-${idx + 1}`,
      roleLabel: idx === 0 ? "主攻等价高性价比箭" : `等价保本护盾#${idx}`,
      legs: [lg],
    }));
    if (sortedLegs.length === 1) {
      return allocateSpearAndExactShield(
        [{ id: "ev-sp1", roleLabel: "主攻等价独赢箭", legs: [sortedLegs[0]] }],
        null,
        budgetLimit,
        { lockPrimarySpear: true }
      );
    }
    if (sortedLegs.length === 2) {
      const l2 = allocateSpearAndExactShield(
        [
          {
            id: "ev-sp1",
            roleLabel: "主攻等价高性价比箭",
            legs: [sortedLegs[0]],
          },
        ],
        {
          id: "ev-sh",
          roleLabel: "最小整数倍等价保本盾",
          legs: [sortedLegs[1]],
        },
        budgetLimit,
        { optimizeShieldUtility: true }
      );
      if (l2.length === 2) return l2;
      return solveFullSetZeroUnderwaterLines(fullFallbackSpecs, budgetLimit);
    }
    if (sortedLegs.length === 3) {
      const l3 = allocateSpearAndExactShield(
        [
          {
            id: "ev-sp1",
            roleLabel: "主攻等价高性价比箭",
            legs: [sortedLegs[0]],
          },
          { id: "ev-sp2", roleLabel: "顺向等价辅助箭", legs: [sortedLegs[1]] },
        ],
        {
          id: "ev-sh",
          roleLabel: "最小整数倍等价保本盾",
          legs: [sortedLegs[2]],
        },
        budgetLimit,
        { optimizeShieldUtility: true }
      );
      if (l3.length === 3) return l3;
      return solveFullSetZeroUnderwaterLines(fullFallbackSpecs, budgetLimit);
    }
    return solveFullSetZeroUnderwaterLines(fullFallbackSpecs, budgetLimit);
  };

  const buildSlot2SubBudgets = (maxB) => {
    if (!allowSaveCash || maxB <= 2) return [maxB];
    if (maxB <= 48) {
      const out = [];
      for (let b = 2; b <= maxB; b += 2) out.push(b);
      return out;
    }
    const set = new Set([2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 50, maxB]);
    for (let step = 1; step <= 8; step++) {
      const b = Math.max(2, Math.floor((maxB * step) / 8 / 2) * 2);
      set.add(b);
    }
    return Array.from(set)
      .filter((b) => b >= 2 && b <= maxB)
      .sort((a, b) => a - b);
  };

  const passesSlot2AdmissionObj = (lines, obj) => {
    if (!lines || lines.length === 0 || !obj) return false;
    const hasSub = lines.some((l) =>
      l.legs.some((g) => g.poolCode !== "HAD" && g.poolCode !== "HHAD")
    );
    if (!hasUserAnchors && !hasSub) return true;
    return obj.strictNetGainProb >= 0.03 - 1e-9 && obj.evRate >= -0.55 - 1e-9;
  };

  if (evActiveMatches.length === 1) {
    const em = evActiveMatches[0];
    const anc = anchorsByMatch.get(em.id) ?? [];
    const slot2SubBudgets1m = buildSlot2SubBudgets(cleanBudget);
    const pickBest1mByLogUtil = (buildAtBudget) => {
      let bestLines = [];
      let bestU = -Infinity;
      for (const subB of slot2SubBudgets1m) {
        const candL = buildAtBudget(subB);
        if (!candL || candL.length === 0) continue;
        const u = evalLogWealthUtility(candL, true);
        if (u > bestU + 1e-12) {
          bestU = u;
          bestLines = candL;
        }
      }
      return bestLines;
    };
    if (
      anc.length > 0 &&
      anc.every((a) => isPoolSingleEligible(em.pools[a.poolCode]))
    ) {
      const ancLegs = anc
        .map((a) =>
          legOf(
            em,
            a.poolCode,
            a.poolCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
          )
        )
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
      slot2Lines = pickBest1mByLogUtil((subB) =>
        allocateSpearAndExactShield(
          [{ id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [ancLegs[0]] }],
          shield,
          subB,
          { lockPrimarySpear: true, optimizeShieldUtility: true }
        )
      );
    } else if (anc.length > 0) {
      const subsetCands = resolveSingleMatchSubsetCandidates(em, anc);
      const exactCands = subsetCands.filter((c) => c.isExactEquivalent);
      const s2Cands = [];
      for (const ec of exactCands) {
        for (const subB of slot2SubBudgets1m) {
          const lines = solveExactSetUtilityLines(ec.legs, subB);
          if (lines.length === ec.legs.length) {
            s2Cands.push({
              lines,
              obj: evalLines4DObj(lines, true),
              logUtil: evalLogWealthUtility(lines, true),
            });
          }
        }
      }
      if (s2Cands.length > 0) {
        s2Cands.sort(
          (a, b) =>
            b.logUtil - a.logUtil ||
            b.obj.evRate - a.obj.evRate ||
            b.obj.profitProb - a.obj.profitProb
        );
        slot2Lines = s2Cands[0].lines;
      } else if (subsetCands[0]) {
        slot2SinglePartialPreview = buildSinglePartialCoveragePreview(
          em,
          subsetCands[0]
        );
        if (acceptPartialSingleCoverage) {
          const topLegs = [...subsetCands[0].legs].sort(
            (a, b) => b.odds * b.fairProb - a.odds * a.fairProb
          );
          slot2Lines = pickBest1mByLogUtil((subB) =>
            allocateSpearAndExactShield(
              topLegs.slice(0, 2).map((lg, idx) => ({
                id: `ev-sp${idx + 1}`,
                roleLabel: idx === 0 ? "部分覆盖主攻箭" : "部分覆盖副攻箭",
                legs: [lg],
              })),
              topLegs[2]
                ? {
                    id: "ev-sh",
                    roleLabel: "部分覆盖保本盾",
                    legs: [topLegs[2]],
                  }
                : null,
              subB,
              { optimizeShieldUtility: true }
            )
          );
        } else {
          const prev = slot2SinglePartialPreview;
          slot2BlockedPartialReason = prev
            ? prev.isExactEquivalent
              ? `所锁方向等价单关最少需 ¥${prev.previewCost}（超出当前预算 ¥${cleanBudget}），拒绝静默缩减漏保`
              : `所锁方向不存在零死角等价单关（最优纯子集${prev.poolName}保住原方向 ${(prev.retainedDirectionRatio * 100).toFixed(1)}%、漏保 ${(prev.blindSpotProb * 100).toFixed(2)}%），未获确认不自动篡改`
            : `所锁非单关方向在当前预算 ¥${cleanBudget} 下无等价单关方案`;
        }
      } else {
        slot2BlockedPartialReason = `所锁非单关方向不存在任何合法可单关纯子集`;
      }
    } else if (canSingleMainPool(em)) {
      const mainCode = isPoolSingleEligible(em.pools.HAD) ? "HAD" : "HHAD";
      const prim =
        evPrimaryLegOf(em) ??
        legOf(em, mainCode, em.pools[mainCode].options[0].key);
      const sec = secondaryDisjointLegInPool(em, prim);
      slot2Lines = pickBest1mByLogUtil((subB) => {
        const minShieldLines = allocateSpearAndExactShield(
          [{ id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [prim] }],
          sec
            ? { id: "ev-sh", roleLabel: "最小整数倍回本盾", legs: [sec] }
            : null,
          subB,
          { optimizeShieldUtility: true }
        );
        const exactLogSplitLines = sec
          ? allocateSpearAndExactShield(
              [
                { id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [prim] },
                { id: "ev-sp2", roleLabel: "对数效用协同副箭", legs: [sec] },
              ],
              null,
              subB
            )
          : [];
        return exactLogSplitLines.length > 0 &&
          evalLogWealthUtility(exactLogSplitLines, true) >
            evalLogWealthUtility(minShieldLines, true) + 1e-12
          ? exactLogSplitLines
          : minShieldLines;
      });
    } else {
      const freePrim = preferredPrimaryLeg(em, false);
      const freeSubsets = freePrim
        ? resolveSingleMatchSubsetCandidates(em, [freePrim])
        : [];
      if (freeSubsets[0] && freeSubsets[0].legs.length >= 2) {
        const fLegs = [...freeSubsets[0].legs].sort(
          (a, b) => b.odds * b.fairProb - a.odds * a.fairProb
        );
        slot2Lines = pickBest1mByLogUtil((subB) =>
          allocateSpearAndExactShield(
            [
              { id: "ev-sp1", roleLabel: "主攻高性价比箭", legs: [fLegs[0]] },
              { id: "ev-sp2", roleLabel: "顺向协同辅助箭", legs: [fLegs[1]] },
            ],
            fLegs[2]
              ? { id: "ev-sh", roleLabel: "最小整数倍保本盾", legs: [fLegs[2]] }
              : null,
            subB,
            { optimizeShieldUtility: true }
          )
        );
      }
    }
  }
  let slot2StructureBadge = null;
  if (evActiveMatches.length >= 2 && anchoredPassCapBlockedReason) {
    slot2BlockedPartialReason = anchoredPassCapBlockedReason;
    slot2Lines = [];
  } else if (evActiveMatches.length >= 2) {
    const activePrims = evActiveMatches
      .map((m) => evPrimaryLegOf(m))
      .filter(Boolean);
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

    const slot2AnchoredCands = [];
    if (anchoredBlockHelper) {
      const specSets = anchoredBlockHelper.buildBlockPartitionSpecSets();
      for (const ss of specSets) {
        if (ss.isFullSingleBlock) continue;
        const blkLines = anchoredBlockHelper.solveZeroUnderwaterBlockSpecs(
          ss.specs,
          cleanBudget,
          "log-utility",
          { sweepAllSubBudgets: allowSaveCash, fixedRefWealth: cleanBudget }
        );
        if (
          blkLines.length > 0 &&
          anchoredBlockHelper.coversAllMatchesAndUserOptions(blkLines)
        ) {
          const obj = evalLines4DObj(blkLines, false);
          if (obj.coveredFloorRatio >= -1e-9) {
            slot2AnchoredCands.push({
              lines: blkLines,
              hasShield: blkLines.length >= 2,
              obj,
              knownDisjoint: false,
              structureBadge: ss.structureBadge,
            });
          }
        }
      }
    }

    const fullPassAllowed =
      targetPass === activePrims.length &&
      (!hasExplicitPassSelection ||
        !Array.isArray(explicitPassSizes) ||
        explicitPassSizes.includes(activePrims.length));

    if (targetPass < Math.min(activePrims.length, poolCap)) {
      slot2SplitCapNote = `🛡️ 原 ${Math.min(activePrims.length, poolCap)} 关高赔连乘触发法定单注封顶截断，已自动降阶拆为 ${targetPass === 1 ? "单关" : `${targetPass}串1`} 零损耗实票`;
      if (targetPass === 1) {
        const singleSpecs = activePrims
          .filter((g) => {
            const fm = evActiveMatches.find((x) => x.id === g.matchId);
            return isPoolSingleEligible(fm?.pools?.[g.poolCode]);
          })
          .slice(0, 8)
          .map((g, idx) => ({
            id: `ev-sgl-${idx + 1}`,
            roleLabel: `防截断单关#${idx + 1}`,
            legs: [g],
          }));
        const capLines =
          singleSpecs.length === activePrims.length
            ? anchoredBlockHelper
              ? anchoredBlockHelper.solveZeroUnderwaterBlockSpecs(
                  singleSpecs,
                  cleanBudget,
                  "log-utility",
                  {
                    sweepAllSubBudgets: allowSaveCash,
                    fixedRefWealth: cleanBudget,
                  }
                )
              : allocateSpearAndExactShield(singleSpecs, null, cleanBudget)
            : [];
        if (capLines.length > 0) {
          slot2Lines = capLines;
          slot2StructureBadge = "同向单关分块";
        }
      } else {
        const subsets = combinationsOfIndices(activePrims.length, targetPass)
          .map((idxs) => {
            const legs = idxs.map((i) => activePrims[i]);
            const evScore = legs.reduce((a, g) => a * g.odds * g.fairProb, 1);
            return { legs, evScore, idxs };
          })
          .sort((a, b) => b.evScore - a.evScore);
        const chosenSubs = [];
        const coveredSet = new Set();
        for (const s of subsets) {
          if (
            chosenSubs.length < 4 ||
            (coveredSet.size < activePrims.length &&
              s.idxs.some((i) => !coveredSet.has(i)))
          ) {
            chosenSubs.push(s);
            for (const i of s.idxs) coveredSet.add(i);
          }
          if (chosenSubs.length >= 8) break;
        }
        slot2Lines = allocateSpearAndExactShield(
          chosenSubs.map((s, idx) => ({
            id: `ev-sub-${idx + 1}`,
            roleLabel: `防截断${targetPass}串1#${idx + 1}`,
            legs: s.legs,
          })),
          null,
          cleanBudget
        );
      }
      if (slot2AnchoredCands.length > 0) {
        for (const ac of slot2AnchoredCands) {
          ac.logUtil = evalLogWealthUtility(ac.lines, ac.knownDisjoint);
        }
        slot2AnchoredCands.sort((a, b) => b.logUtil - a.logUtil);
        const curLogU =
          slot2Lines.length > 0
            ? evalLogWealthUtility(slot2Lines, false)
            : -Infinity;
        if (slot2AnchoredCands[0].logUtil > curLogU + 1e-12) {
          slot2Lines = slot2AnchoredCands[0].lines;
          slot2StructureBadge = slot2AnchoredCands[0].structureBadge;
        }
      }
    } else {
      const slot2Candidates = [...slot2AnchoredCands];
      if (fullPassAllowed) {
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
            .map((m) => preferredHighProbMainLeg(m));
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

        const slot2SubBudgetsMulti = buildSlot2SubBudgets(cleanBudget);
        for (const bLegs of backboneProfiles) {
          for (const subB of slot2SubBudgetsMulti) {
            const pureLines = allocateSpearAndExactShield(
              [{ id: "ev-sp1", roleLabel: "高性价比主攻箭", legs: bLegs }],
              null,
              subB
            );
            if (pureLines.length > 0) {
              slot2Candidates.push({
                lines: pureLines,
                hasShield: false,
                obj: evalLines4DObj(pureLines, true),
                knownDisjoint: true,
                structureBadge: null,
              });
            }
          }

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
                        a.poolCode === lg.poolCode &&
                        a.optionKey !== lg.optionKey
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
          for (const fc of flipCands.slice(0, 8)) {
            for (const subB of slot2SubBudgetsMulti) {
              for (const optUtil of [false, true]) {
                const shLines = allocateSpearAndExactShield(
                  [{ id: "ev-sp1", roleLabel: "高性价比主攻箭", legs: bLegs }],
                  { id: "ev-sh", roleLabel: "最小整数倍回本盾", legs: fc.legs },
                  subB,
                  {
                    lockPrimarySpear: hasUserAnchors,
                    optimizeShieldUtility: optUtil,
                  }
                );
                if (shLines.length > 0) {
                  slot2Candidates.push({
                    lines: shLines,
                    hasShield: shLines.length >= 2,
                    obj: evalLines4DObj(shLines, true),
                    knownDisjoint: true,
                    structureBadge: null,
                  });
                }
              }
            }
          }
        }
      }

      for (const c of slot2Candidates) {
        const cCost = c.lines.reduce((a, l) => a + l.cost, 0);
        c.spearSig = (c.lines[0]?.legs ?? [])
          .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
          .join("|");
        c.spearReturnRatio =
          cCost > 0 && c.lines[0] ? c.lines[0].returnPayout / cCost : 0;
        c.logUtil = evalLogWealthUtility(c.lines, Boolean(c.knownDisjoint));
        c.admissible = passesSlot2AdmissionObj(c.lines, c.obj);
      }
      const paretoSlot2 = slot2Candidates.filter(
        (c) =>
          !slot2Candidates.some(
            (o) =>
              o !== c &&
              (!c.admissible || o.admissible) &&
              (!allowSaveCash || o.logUtil >= c.logUtil - 1e-12) &&
              o.spearSig === c.spearSig &&
              o.obj.evRate >= c.obj.evRate - 1e-9 &&
              o.obj.profitProb >= c.obj.profitProb - 1e-9 &&
              o.spearReturnRatio >= c.spearReturnRatio - 1e-9 &&
              o.obj.missOneCvarRatio >= c.obj.missOneCvarRatio - 1e-9 &&
              (o.obj.evRate > c.obj.evRate + 1e-6 ||
                o.obj.profitProb > c.obj.profitProb + 1e-6 ||
                o.spearReturnRatio > c.spearReturnRatio + 1e-6 ||
                o.obj.missOneCvarRatio > c.obj.missOneCvarRatio + 1e-6 ||
                (allowSaveCash && o.logUtil > c.logUtil + 1e-9))
          ) &&
          !slot2Candidates.some(
            (o) =>
              o !== c &&
              (!c.admissible || o.admissible) &&
              (!allowSaveCash || o.logUtil >= c.logUtil - 1e-12) &&
              o.obj.evRate >= c.obj.evRate - 1e-9 &&
              o.obj.profitProb >= c.obj.profitProb - 1e-9 &&
              o.obj.coveredFloorRatio >= c.obj.coveredFloorRatio - 1e-9 &&
              o.obj.missOneCvarRatio >= c.obj.missOneCvarRatio - 1e-9 &&
              (o.obj.evRate > c.obj.evRate + 1e-6 ||
                o.obj.profitProb > c.obj.profitProb + 1e-6 ||
                o.obj.coveredFloorRatio > c.obj.coveredFloorRatio + 1e-6 ||
                o.obj.missOneCvarRatio > c.obj.missOneCvarRatio + 1e-6 ||
                (allowSaveCash && o.logUtil > c.logUtil + 1e-9))
          )
      );
      const pool2 = paretoSlot2.length > 0 ? paretoSlot2 : slot2Candidates;
      pool2.sort(
        (a, b) =>
          Number(b.admissible) - Number(a.admissible) ||
          b.logUtil - a.logUtil ||
          b.obj.evRate - a.obj.evRate ||
          b.obj.profitProb - a.obj.profitProb
      );
      slot2Lines = pool2[0]?.lines ?? [];
      slot2StructureBadge = pool2[0]?.structureBadge ?? null;
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
  if (slot2StructureBadge) {
    slot2Reasons.push(
      `未显式锁定过关阶数，已将【${slot2StructureBadge}】纳入对数财富效用同台寻优`
    );
  }
  slot2Reasons.push(
    "基于分数凯利对数财富效用（Expected Log-Wealth Utility）在零倒贴整数域寻优主攻与护盾配比，兼顾复利增长与回撤保护"
  );

  let slot2Plan = packSlot({
    key: "max-ev-utility",
    available: slot2Lines.length > 0,
    emptyReason:
      slot2Lines.length > 0
        ? null
        : (slot2BlockedPartialReason ??
          `当前预算 ¥${cleanBudget} 下无法构造满足对数效用约束的实票`),
    shortTab: "⚖️ 期望效用",
    badge:
      slot2Lines.length > 0 && slot2StructureBadge
        ? `⚖️ 期望效用极值 · ${slot2StructureBadge}`
        : "⚖️ 期望效用极值",
    title:
      slot2Lines.length > 0
        ? slot2StructureBadge
          ? `期望效用 · ${slot2StructureBadge}（对数效用寻优）`
          : "对数财富效用 · 主攻护盾整数寻优"
        : anchoredPassCapBlockedReason
          ? "所选场次超出子玩法最高过关上限 · 拒绝静默丢场"
          : "所锁方向无完全等价单关 · 待确认部分覆盖或加场",
    tagline:
      slot2Lines.length > 0
        ? `${slot2StructureBadge ? `${slot2StructureBadge} · ` : ""}按期望对数财富效用寻优零倒贴主攻与护盾整数配比 · 火力集中高效率组合`
        : `严守已锁方向不越界 · 全额保留 ¥${cleanBudget}`,
    lines: slot2Lines,
    reasons:
      slot2Lines.length > 0
        ? slot2Reasons
        : slot2BlockedPartialReason
          ? [slot2BlockedPartialReason]
          : slot2Reasons,
    prependWarningReason: anchoredDragWarning,
  });

  if (slot2Plan.available) {
    const slot2HasSubPoolLegs = slot2Plan.lines.some((l) =>
      l.legs.some((g) => g.poolCode !== "HAD" && g.poolCode !== "HHAD")
    );
    if (hasUserAnchors || slot2HasSubPoolLegs) {
      const s2Strict = slot2Plan.strictNetGainProb ?? 0;
      const s2Ev = slot2Plan.expectedValueRate ?? -1;
      const s2GateFails = [];
      if (s2Strict < 0.03 - 1e-9) {
        s2GateFails.push(
          `严格净赚率 ${formatProbPctHonest(s2Strict)} 低于 3.0% 准入红线`
        );
      }
      if (s2Ev < -0.55 - 1e-9) {
        s2GateFails.push(
          `期望收益率 ${(s2Ev * 100).toFixed(1)}% 低于 -55.0% 折损红线`
        );
      }
      if (s2GateFails.length > 0) {
        const s2GateReason = `当前锁定方向与串关约束下未达【⚖️ 期望效用】实盘准入红线（${s2GateFails.join("；")}），已拦截深度负期望废票并全额保留 ¥${cleanBudget}`;
        slot2Plan = packSlot({
          key: "max-ev-utility",
          available: false,
          emptyReason: s2GateReason,
          shortTab: "⚖️ 期望效用",
          badge: "⚖️ 期望效用极值 · 未达准入红线",
          title: "期望折损或净赚率越过红线 · 建议降阶或空仓护本",
          tagline: `严守 ≥3% 严格净赚率与 ≥-55% 期望红线 · 全额保留 ¥${cleanBudget}`,
          lines: [],
          reasons: [s2GateReason],
        });
      }
    }
  }
  if (slot2Plan.available) {
    if (slot2StructureBadge) {
      slot2Plan.structureBadge = slot2StructureBadge;
    }
    if (allowSaveCash) {
      slot2Plan.tagline = `实投 ¥${slot2Plan.totalCost} · 留存 ¥${slot2Plan.savedCash} · ${slot2Plan.tagline}`;
      slot2Plan.reasons.push(
        `已开启允许留现省钱：经对数财富效用含留存现金比选，实投 ¥${slot2Plan.totalCost} · 留存 ¥${slot2Plan.savedCash}`
      );
    }
  }
  if (slot2SinglePartialPreview) {
    slot2Plan.partialCoveragePreview = slot2SinglePartialPreview;
  }

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
      .filter((a) => isPoolSingleEligible(m.pools[a.poolCode]))
      .sort((a, b) => b.fairProb - a.fairProb)[0];
    if (singleAnc)
      return legOf(
        m,
        singleAnc.poolCode,
        singleAnc.poolCode === "CRS"
          ? singleAnc.optionLabel || singleAnc.optionKey
          : singleAnc.optionKey
      );

    if (anc.length > 0) {
      const subsetCands = resolveSingleMatchSubsetCandidates(m, anc);
      if (subsetCands[0] && subsetCands[0].legs.length > 0) {
        return [...subsetCands[0].legs].sort(
          (a, b) => b.fairProb - a.fairProb
        )[0];
      }
      return null;
    }

    const mIdx = selected.findIndex((sm) => sm.id === m.id);
    const mainSingleCands = [];
    for (const mainCode of ["HAD", "HHAD"]) {
      const pool = m.pools[mainCode];
      if (isPoolSingleEligible(pool)) {
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
    if (isPoolSingleEligible(m.pools.HAFU)) {
      for (const o of m.pools.HAFU.options ?? []) {
        const lg = legOf(m, "HAFU", o.key);
        if (lg) subCands.push(lg);
      }
    }
    if (isPoolSingleEligible(m.pools.TTG)) {
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
    return preferredPrimaryLeg(m, false);
  };

  let slot3HasPartialCushionBlindSpot = false;
  let slot3UsesSubPoolCushion = false;
  let slot3MissingOneSideCushion = false;
  let slot3MinCushionCondCov = 1;

  const slot3UnderMinBudget = cleanBudget < 4;
  let slot3EmptyReason = slot3UnderMinBudget
    ? `当前预算 ¥${cleanBudget} 低于 ¥4（不足 2 注），无法拆出至少 2 注容错组合，请将预算调至 ¥4 及以上或选用前两档方案`
    : null;

  if (slot3UnderMinBudget) {
    slot3Lines = [];
  } else if (selected.length === 1) {
    const m1 = selected[0];
    const anc = anchorsByMatch.get(m1.id) ?? [];
    const ancSinglePool =
      anc.length > 0 &&
      anc.every(
        (a) =>
          isPoolSingleEligible(m1.pools[a.poolCode]) &&
          a.poolCode === anc[0].poolCode
      )
        ? anc[0].poolCode
        : null;
    const cushionSpecs = [];

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
      const subsetCands = resolveSingleMatchSubsetCandidates(m1, anc);
      if (subsetCands[0] && subsetCands[0].legs.length > 0) {
        const chosenLegs = subsetCands[0].isExactEquivalent
          ? subsetCands[0].legs
          : [...subsetCands[0].legs]
              .sort((a, b) => b.fairProb - a.fairProb)
              .slice(0, 3);
        chosenLegs.forEach((lg, idx) =>
          cushionSpecs.push({
            id: `cw-1-${idx + 1}`,
            roleLabel: idx === 0 ? "顺向单关主垫" : `顺向缓冲垫#${idx}`,
            legs: [lg],
          })
        );
      }
    } else if (isPoolSingleEligible(m1.pools.HAD)) {
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
    } else if (isPoolSingleEligible(m1.pools.HHAD)) {
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
      const freePrim = preferredPrimaryLeg(m1, false);
      if (isPoolSingleEligible(m1.pools.HAFU) && freePrim?.poolCode === "HAD") {
        const cushionKeys =
          freePrim.optionKey === "a"
            ? ["aa", "da", "dd"]
            : freePrim.optionKey === "d"
              ? ["dd", "hd", "ad"]
              : ["hh", "dh", "dd"];
        cushionKeys
          .map((k) => legOf(m1, "HAFU", k))
          .filter(Boolean)
          .forEach((lg, idx) => {
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
      } else {
        const freeSubsets = freePrim
          ? resolveSingleMatchSubsetCandidates(m1, [freePrim])
          : [];
        if (freeSubsets[0] && freeSubsets[0].legs.length > 0) {
          freeSubsets[0].legs.slice(0, 3).forEach((lg, idx) => {
            cushionSpecs.push({
              id: `cw-1-${idx + 1}`,
              roleLabel: `单关缓冲垫#${idx + 1}`,
              legs: [lg],
            });
          });
        }
      }
    }
    slot3Lines = solveZeroUnderwaterDutching(cushionSpecs, cleanBudget).filter(
      Boolean
    );
    if (slot3Lines.reduce((a, l) => a + l.cost, 0) > cleanBudget) {
      slot3Lines = [];
    }
    if (slot3Lines.length === 0 && cushionSpecs.length > 0) {
      const budgetNotes = Math.floor(cleanBudget / 2);
      const takeSpecs = cushionSpecs.slice(0, Math.min(2, budgetNotes));
      const fallbackMults =
        takeSpecs.length === 1
          ? [Math.min(999, Math.max(1, budgetNotes))]
          : [
              Math.min(999, Math.max(1, Math.ceil(budgetNotes / 2))),
              Math.min(999, Math.max(1, Math.floor(budgetNotes / 2))),
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
    const totalNotes = Math.floor(cleanBudget / 2);
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
        if (totalNotes < allSpecs.length) {
          // Small budget (e.g. ¥4 = 2 notes while allSpecs has 3 lines): use 2-line single cushions or kicker + cushion within budget!
          if (blockSpecs.length <= totalNotes) {
            const solvedOnlyBlocks = allocateWheelMeanCvar(
              blockSpecs,
              null,
              matchIdList,
              cleanBudget,
              true,
              cond2Weights
            );
            if (
              solvedOnlyBlocks.lines.length > 0 &&
              solvedOnlyBlocks.lines.reduce((a, l) => a + l.cost, 0) <=
                cleanBudget
            ) {
              twoMatchCands.push({
                lines: solvedOnlyBlocks.lines,
                missOneReturn: computeSurvivingMissOneFloor(
                  solvedOnlyBlocks.lines,
                  matchIdList
                ),
                obj: evalLines4DObj(solvedOnlyBlocks.lines),
              });
            }
          }
          if (totalNotes >= 2 && blockSpecs[0]) {
            const twoLines = materializePlanLines(
              [mainKicker, blockSpecs[0]],
              [1, totalNotes - 1]
            );
            twoMatchCands.push({
              lines: twoLines,
              missOneReturn: computeSurvivingMissOneFloor(
                twoLines,
                matchIdList
              ),
              obj: evalLines4DObj(twoLines),
            });
          }
          continue;
        }
        const cappedMaxN = Math.min(totalNotes, allSpecs.length * 999);
        const minNotes = Math.max(
          allSpecs.length,
          Math.floor(cappedMaxN * 0.9)
        );
        for (let candN = cappedMaxN; candN >= minNotes; candN--) {
          const kickerSet =
            candN >= 10
              ? new Set([
                  Math.min(999, Math.max(2, Math.round(candN * 0.18))),
                  Math.min(999, Math.max(2, Math.round(candN * 0.24))),
                  Math.min(999, Math.max(2, Math.round(candN * 0.3))),
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
            if (solvedCushions.lines.length !== blockSpecs.length) continue;
            const candLines = materializePlanLines(allSpecs, [
              kNotes,
              ...solvedCushions.lines.map((l) => l.multiple),
            ]);
            if (candLines.reduce((a, l) => a + l.cost, 0) > cleanBudget)
              continue;
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
      if (pool2[0]) {
        slot3Lines = pool2[0].lines;
        slot3MissOneReturn = pool2[0].missOneReturn;
      }
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
      slot3Lines = materializePlanLines(
        [mainKicker],
        [Math.min(999, Math.max(1, totalNotes))]
      );
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
        const wipeoutPenalty =
          (obj.zeroPayoutProb ?? 0) > 0.85
            ? ((obj.zeroPayoutProb ?? 0) - 0.85) * 8.0 + 0.65
            : 0;
        return (
          0.55 * effCvarRatio +
          0.2 * probWeightedFloor +
          0.15 * obj.profitProb +
          0.1 * obj.evRate -
          wipeoutPenalty
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
        if (totalC <= 0 || totalC > cleanBudget) continue;
        const obj = evalLines4DObj(cand.lines);
        const score =
          scoreWheelCandidate(
            obj,
            cand.missOneReturn,
            totalC,
            cand.weightedTailRatio
          ) + (isGenuineCoveringWheelDesign(v, subBlocks) ? 0.02 : 0);
        wheelCands.push({
          lines: cand.lines,
          missOneReturn: cand.missOneReturn,
          designLabel: `官方${pr.label}多串容错 (${formatWheelSlipCountTag(cand.lines)})`,
          isCoveringWheel: false,
          obj,
          score,
        });
      }

      // 2. Genuine covering-wheel designs (zero wipeout at target miss tier) vs honest disjoint/sub-covering block partitions
      const maxWheelNotes = Math.floor(cleanBudget / 2);
      const allReducedDesigns = [
        ...(COVERING_WHEEL_DESIGNS[v] ?? []),
        ...buildDisjointPartitionDesigns(v, wheelLegs, poolCap, maxWheelNotes),
      ].filter((d) => d.maxK <= poolCap && d.blocks.length <= 10);

      for (const d of allReducedDesigns) {
        const isCoveringWheel = isGenuineCoveringWheelDesign(v, d.blocks, d);
        const blockSpecs = d.blocks.map((idxs, bIdx) => ({
          id: `cw-${bIdx + 1}`,
          roleLabel: `${isCoveringWheel ? "缩水组" : "容错分块"}#${bIdx + 1} (${idxs.map((i) => `第${i + 1}场`).join("×")})`,
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
          if (totalC <= 0 || totalC > cleanBudget) continue;
          const obj = evalLines4DObj(cand.lines);
          const score =
            scoreWheelCandidate(
              obj,
              cand.missOneReturn,
              totalC,
              cand.weightedTailRatio
            ) + (isCoveringWheel ? 0.02 : 0);
          const cleanDesignBase = d.name.replace(/独立分块$/, "");
          const slipTag = formatWheelSlipCountTag(cand.lines);
          const designLabel = isCoveringWheel
            ? `${d.name}${kicker ? `+${v}串1` : ""} 旋转矩阵缩水 (${slipTag})`
            : `${cleanDesignBase}${kicker ? `+${v}串1` : ""} 独立分块容错串 (${slipTag})`;
          wheelCands.push({
            lines: cand.lines,
            missOneReturn: cand.missOneReturn,
            designLabel,
            isCoveringWheel,
            obj,
            score,
          });
        }
      }
      // 3. v === 3 small-budget (¥4 = 2 notes) disjoint [1单关 + 2串1] fallback when 3串3 (¥6) exceeds cleanBudget
      if (
        v === 3 &&
        Math.floor(cleanBudget / 2) === 2 &&
        wheelCands.length === 0
      ) {
        for (let sIdx = 0; sIdx < 3; sIdx++) {
          const sglLeg = singleCushionLegOf(selected[sIdx]);
          if (!sglLeg || !selected[sIdx].pools[sglLeg.poolCode]?.single)
            continue;
          const pIdxs = [0, 1, 2].filter((x) => x !== sIdx);
          const pairLegs = pIdxs.map((x) => wheelLegs[x]);
          const maxPairPass = Math.min(
            ...pairLegs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8)
          );
          if (maxPairPass < 2) continue;
          const twoBlockSpecs = [
            {
              id: "cw-1",
              roleLabel: `容错分块#1 (第${sIdx + 1}场单关)`,
              legs: [sglLeg],
            },
            {
              id: "cw-2",
              roleLabel: `容错分块#2 (${pIdxs.map((i) => `第${i + 1}场`).join("×")})`,
              legs: pairLegs,
            },
          ];
          const twoLines = materializePlanLines(twoBlockSpecs, [1, 1]);
          const totalC = twoLines.reduce((a, l) => a + l.cost, 0);
          if (totalC <= 0 || totalC > cleanBudget) continue;
          const missOne = computeSurvivingMissOneFloor(twoLines, matchIds);
          const obj = evalLines4DObj(twoLines);
          wheelCands.push({
            lines: twoLines,
            missOneReturn: missOne,
            designLabel: `单关+2串1 独立分块容错串 (2组逻辑组合 · 2张纸质实票)`,
            isCoveringWheel: false,
            obj,
            score: scoreWheelCandidate(obj, missOne, totalC),
          });
        }
      }
    }

    const admissibleWheelCands = wheelCands.filter(
      (c) => (c.obj.zeroPayoutProb ?? 1) <= 0.9 + 1e-9
    );
    const activeWheelPool =
      admissibleWheelCands.length > 0 ? admissibleWheelCands : wheelCands;
    const paretoWheels = filterNonDominatedCandidates(activeWheelPool);
    const bestWheel = (
      paretoWheels.length > 0 ? paretoWheels : activeWheelPool
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

  const slot3LogicalGroups = slot3Lines.length;
  const slot3PhysicalSlips = countPhysical99xSlips(slot3Lines);
  const slot3Reasons = [
    selected.length >= 3
      ? slot3IsCoveringWheel
        ? `采用组合覆盖设计 ${slot3DesignLabel}（满足目标错场层级全覆盖零归零存活，严控 ≤ 10 组逻辑组合；按线下终端单票 99 倍上限共打印 ${slot3PhysicalSlips} 张纸质实票），锁定错 1 场保底回血 ¥${slot3MissOneReturn.toFixed(2)}`
        : `采用中国体彩 ${slot3DesignLabel} 结构（严控 ${slot3LogicalGroups} ≤ 10 组逻辑组合；按线下终端单票 99 倍上限共打印 ${slot3PhysicalSlips} 张纸质实票），锁定错 1 场保底回血 ¥${slot3MissOneReturn.toFixed(2)}`
      : selected.length === 2
        ? slot3MissingOneSideCushion
          ? "仅开放单关场次可配回血垫，若未开放单关场次爆冷则错 1 场保底为 ¥0.00"
          : slot3HasPartialCushionBlindSpot
            ? slot3UsesSubPoolCushion
              ? `借道半全场/局部单关构建回血垫（覆盖正路 ${(slot3MinCushionCondCov * 100).toFixed(0)}%），若踢出半场逆转等未覆盖死角派奖为 ¥0`
              : `采用让球单关构建高赔回血垫（覆盖正路 ${(slot3MinCushionCondCov * 100).toFixed(0)}%），若踢出一球卡盘未覆盖死角派奖为 ¥0`
            : "配置无死角主盘单关回血垫，最大化错 1 场保底回血与连红上限"
        : "同场多路互斥赛果分层构建防冷缓冲网，兼顾正路主干返奖与次热防冷回血缓冲",
  ];

  let slot3Plan = packSlot({
    key: "max-cvar-wheel",
    available: !slot3UnderMinBudget && slot3Lines.length > 0,
    emptyReason:
      slot3EmptyReason ??
      (slot3Lines.length === 0
        ? `当前预算 ¥${cleanBudget} 不足以构造容错拆单组合`
        : null),
    shortTab: "🧩 容错缩水",
    badge: "🧩 容错缩水极值",
    title: slot3UnderMinBudget
      ? "当前预算低于 ¥4 · 无法拆出容错双注"
      : selected.length >= 3
        ? slot3DesignLabel
        : selected.length === 2
          ? "2串1主干 + 单关回血垫"
          : "单场多路防冷缓冲网",
    tagline: slot3UnderMinBudget
      ? `至少需 ¥4（2 注）方可拆分为多路容错组合 · 已保留 ¥${cleanBudget}`
      : null,
    lines: slot3Lines,
    missOneReturn: slot3MissOneReturn,
    wipeoutMiss2Prob: slot3WipeoutMiss2Prob,
    reasons: slot3UnderMinBudget ? [slot3EmptyReason] : slot3Reasons,
  });
  if (slot3Plan.available) {
    const zProb =
      slot3Plan.zeroPayoutProb ?? Math.max(0, 1 - slot3Plan.winProb);
    if (zProb > 0.9 + 1e-9) {
      const s3GateReason = `当前方向与串关组合下整单全黑归零率高达 ${formatProbPctHonest(zProb)}（超出 90.0% 容错准入红线），失去容错回血实效，已拦截并全额保留 ¥${cleanBudget}`;
      slot3Plan = packSlot({
        key: "max-cvar-wheel",
        available: false,
        emptyReason: s3GateReason,
        shortTab: "🧩 容错缩水",
        badge: "🧩 容错缩水极值 · 归零超限拦截",
        title: "整单归零率超出 90% 红线 · 拒绝伪容错出票",
        tagline: `严守容错组合 ≤90% 归零红线 · 全额保留 ¥${cleanBudget}`,
        lines: [],
        reasons: [s3GateReason],
      });
    } else {
      if (slot3WipeoutMiss2Prob !== null) {
        slot3Plan.reasons.push(
          `风险诚实披露：整单真实全黑归零率 ${formatProbPctHonest(zProb)} · 主干错 ≥ 2 场率 ${(slot3WipeoutMiss2Prob * 100).toFixed(1)}%（错 1 场属局部回血缓冲，非全额无损保本）`
        );
      } else {
        slot3Plan.reasons.push(
          `风险诚实披露：单场缓冲网未覆盖冷门赛果整单归零率 ${formatProbPctHonest(zProb)}（非全包无损保本）`
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
  }

  // =========================================================================
  // Slot ④: alpha-radar (⚡ 错价雷达 · 经验贝叶斯收缩纯正期望 +EV 硬门禁 + 宁缺毋滥空仓纪律)
  // =========================================================================
  const rawAlphaPool = [];
  let bestObservedExpectedReturn = 0;
  let bestSingleAllowedExpectedReturn = 0;
  for (const m of selected) {
    const scan = scanMatchAlphaCandidates(
      m,
      hasUserAnchors ? anchorsByMatch.get(m.id) : null
    );
    if (scan.maxExpectedReturn > bestObservedExpectedReturn) {
      bestObservedExpectedReturn = scan.maxExpectedReturn;
    }
    for (const c of scan.candidates) {
      if (
        c.singleAllowed &&
        c.expectedReturn > bestSingleAllowedExpectedReturn
      ) {
        bestSingleAllowedExpectedReturn = c.expectedReturn;
      }
      if (c.isPositiveEv && c.expectedReturn >= 1.01) {
        rawAlphaPool.push(c);
      }
    }
    // Fallback ceiling scan when single-match checkout requires single===true or match has only 1 open pool
    const calFallback = getCachedMatchCalibration(m);
    for (const pCode of ["HAD", "HHAD", "HAFU", "TTG", "CRS"]) {
      const p = calFallback?.pools?.[pCode] ?? m.pools[pCode];
      if (!p || p.selling === false || !Array.isArray(p.options)) continue;
      for (const opt of p.options) {
        if (!(Number.isFinite(opt.odds) && opt.odds > 1.01)) continue;
        const lKey = pCode === "CRS" ? opt.label || opt.key : opt.key;
        const dcP =
          calFallback?.poolProbs?.[pCode]?.[lKey] ?? opt.fairProb ?? 0;
        const shinP = opt.shinProb ?? dcP;
        const expRet =
          pCode === "HAD" || pCode === "HHAD"
            ? opt.odds * Math.min(0.65 * dcP + 0.35 * shinP, shinP * 1.28)
            : computeOptionShrunkAlpha(opt.odds, dcP, shinP).expectedReturn;
        if (p.single && expRet > bestSingleAllowedExpectedReturn) {
          bestSingleAllowedExpectedReturn = expRet;
        }
        if (
          bestObservedExpectedReturn <= 0 &&
          expRet > bestObservedExpectedReturn
        ) {
          bestObservedExpectedReturn = expRet;
        }
      }
    }
  }
  rawAlphaPool.sort(
    (a, b) => b.expectedReturn - a.expectedReturn || b.delta - a.delta
  );

  const aggBudget = unlockFullAgg
    ? cleanBudget
    : Math.floor((cleanBudget * 0.36) / 2) * 2;

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
  const maxAlphaNotes = Math.floor(aggBudget / 2);

  if (maxAlphaNotes >= 1 && selected.length === 1) {
    // Single-match checkout legality gate: ONLY single-capable +EV options can check out alone at a Sporttery shop
    const legalSingles = rawAlphaPool.filter((c) => c.singleAllowed);
    for (const c of legalSingles.slice(0, Math.min(2, maxAlphaNotes))) {
      if (appendSingleAlphaSpecs(c, "ar")) selectedAlphaCands.push(c);
    }
  } else if (maxAlphaNotes >= 1 && rawAlphaPool.length > 0) {
    const bestAlphaByMatch = [];
    const seenMid = new Set();
    for (const c of rawAlphaPool) {
      if (!seenMid.has(c.matchId)) {
        seenMid.add(c.matchId);
        bestAlphaByMatch.push(c);
      }
    }

    // 1. Prefer single-capable +EV tickets directly (zero parlay vig compound loss!)
    const topSingles = rawAlphaPool
      .filter((c) => c.singleAllowed)
      .slice(0, Math.min(2, maxAlphaNotes));
    for (const c of topSingles) {
      if (alphaSpecs.length >= Math.min(4, maxAlphaNotes)) break;
      if (appendSingleAlphaSpecs(c, "ar-sgl")) {
        selectedAlphaCands.push(c);
      }
    }

    // 2. Only when NO single-capable +EV ticket exists (non-single +EV leg requires 1 partner to place a legal 2串1)
    const allUpAlphaByMatch = bestAlphaByMatch.filter(
      (c) => c.allUpAllowed !== false
    );
    if (alphaSpecs.length === 0 && allUpAlphaByMatch.length >= 1) {
      const alphaC = allUpAlphaByMatch[0];
      const alphaLeg = legOf(alphaC.match, alphaC.poolCode, alphaC.optionKey);
      let partnerLeg = null;
      let partnerCand = null;
      if (allUpAlphaByMatch.length >= 2) {
        partnerCand = allUpAlphaByMatch[1];
        partnerLeg = legOf(
          partnerCand.match,
          partnerCand.poolCode,
          partnerCand.optionKey
        );
      } else {
        const partnerMatches = selected
          .filter((m) => m.id !== alphaC.matchId)
          .map((m) => ({ m, leg: evPrimaryLegOf(m) }))
          .filter(
            (x) => x.leg && isPoolAllUpEligible(x.m.pools?.[x.leg.poolCode])
          )
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

  const rawCeilingRet =
    selected.length === 1 && bestSingleAllowedExpectedReturn > 0
      ? bestSingleAllowedExpectedReturn
      : bestObservedExpectedReturn;
  const computeObservedCeilingMeta = () => {
    if (!(rawCeilingRet > 0)) {
      return { bestObsPct: null, gapPct: null };
    }
    const roundedPct = Number((rawCeilingRet * 100).toFixed(1));
    const bestObsPct =
      rawCeilingRet < 1.01 ? Math.min(100.9, roundedPct) : roundedPct;
    const gapPct = Number(Math.max(0, 101.0 - bestObsPct).toFixed(1));
    return { bestObsPct, gapPct };
  };

  const buildEmptyAlphaSlot = () => {
    const { bestObsPct, gapPct } = computeObservedCeilingMeta();
    const narrowLightStakeBlocked =
      !unlockFullAgg && maxAlphaNotes < 1 && rawAlphaPool.length > 0;
    const ceilingPrefix = narrowLightStakeBlocked
      ? `虽检出跨盘正期望洼地，但当前预算 ¥${cleanBudget} 的 36% 轻仓上限（¥${(cleanBudget * 0.36).toFixed(2)}）低于 1 注法定起投额（¥2），`
      : bestObsPct !== null && gapPct !== null
        ? bestObsPct < 101.0
          ? `当前所选场次最高校准单腿返还率 ${bestObsPct.toFixed(1)}%（距 101.0% 正期望门槛差 ${gapPct.toFixed(1)} 个百分点），`
          : `当前所选场次最高校准单腿返还率 ${bestObsPct.toFixed(1)}%（未开单关凑 2串1 后连乘抽水净期望 ≤ 0%），`
        : "当前所选场次五池定价严密，";
    const emptyMsg = narrowLightStakeBlocked
      ? `${ceilingPrefix}默认空仓立省 ¥${cleanBudget} 护本（如需出击可开启全额仓位或提升预算至 ¥6+）`
      : `${ceilingPrefix}无跨盘错价洼地 · 建议空仓立省 ¥${cleanBudget}，或采用前 3 档主方案`;
    const emptyPlan = packSlot({
      key: "alpha-radar",
      available: false,
      alphaKind: "none",
      emptyReason: emptyMsg,
      shortTab: "⚡ 错价雷达",
      badge: "⚡ 跨盘真错价雷达 · 空仓",
      title: narrowLightStakeBlocked
        ? "轻仓额度不足 ¥2 · 默认空仓护本"
        : "当前盘面定价严密 · 建议空仓省钱",
      tagline: `已替你拦截强凑废单 · 全额立省 ¥${cleanBudget} 本金`,
      lines: [],
      savedCash: cleanBudget,
      reasons: [
        emptyMsg,
        narrowLightStakeBlocked
          ? "严守 36% 轻仓风控纪律：窄预算下绝不透支 100% 本金伪装轻仓"
          : "常态严密盘下空仓属正常理性纪律：全盘经经验贝叶斯收缩校准扫描后无 ≥ 101.0%（≥ +1.0% +EV）可出票洼地",
      ],
    });
    emptyPlan.bestObservedReturnPct = bestObsPct;
    emptyPlan.alphaThresholdGapPct = gapPct;
    return emptyPlan;
  };

  let slot4Plan;
  if (
    maxAlphaNotes < 1 ||
    alphaSpecs.length === 0 ||
    selectedAlphaCands.length === 0
  ) {
    slot4Plan = buildEmptyAlphaSlot();
  } else {
    const targetNotes = Math.min(Math.floor(cleanBudget / 2), maxAlphaNotes);
    if (alphaSpecs.length > targetNotes) {
      alphaSpecs = alphaSpecs.slice(0, targetNotes);
      selectedAlphaCands = selectedAlphaCands.slice(
        0,
        Math.max(1, targetNotes)
      );
    }
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
    candidatePlan.bestObservedReturnPct = Number(
      (Math.max(rawCeilingRet, bestCand.expectedReturn) * 100).toFixed(1)
    );
    candidatePlan.alphaThresholdGapPct = 0;
    slot4Plan =
      candidatePlan.available &&
      candidatePlan.expectedValueRate > 0 &&
      shrunkExpectedReturn > actualSpent
        ? candidatePlan
        : buildEmptyAlphaSlot();
  }

  if (!skipRemediation) {
    const allSlots = [slot1Plan, slot2Plan, slot3Plan, slot4Plan];
    const hasSubPoolUserAnchors =
      hasUserAnchors &&
      Array.isArray(anchorPicks) &&
      anchorPicks.some(
        (p) =>
          p &&
          p.poolCode !== "HAD" &&
          p.poolCode !== "HHAD" &&
          selected.some((m) => m.id === p.matchId)
      );

    const computeMatchAllowedUnionProb = (m, allowMainShield = true) => {
      const aProbs = stanceAtomicMap.get(m.id);
      if (!aProbs) return 1;
      const anc = anchorsByMatch.get(m.id) ?? [];
      if (anc.length === 0) return 1;
      let allowedLegs = [];
      if (
        allowMainShield &&
        anc.length === 1 &&
        (anc[0].poolCode === "HAD" || anc[0].poolCode === "HHAD")
      ) {
        const baseLeg = legOf(m, anc[0].poolCode, anc[0].optionKey);
        const secLeg = baseLeg ? secondaryDisjointLegInPool(m, baseLeg) : null;
        allowedLegs = [baseLeg, secLeg].filter(Boolean);
      } else {
        allowedLegs = anc
          .map((a) =>
            legOf(
              m,
              a.poolCode,
              a.poolCode === "CRS" ? a.optionLabel || a.optionKey : a.optionKey
            )
          )
          .filter(Boolean);
      }
      if (allowedLegs.length === 0) return 0;
      let unionP = 0;
      for (let a = 0; a < ATOMIC_TEMPLATES.length; a++) {
        const tpl = ATOMIC_TEMPLATES[a];
        const pa = aProbs[a];
        if (pa <= 0) continue;
        let hitAny = false;
        for (let j = 0; j < allowedLegs.length; j++) {
          const lg = allowedLegs[j];
          const gl = resolveGoalLineNum(m, lg.poolName);
          if (
            doesOptionHitAtomicTemplate(
              lg.poolCode,
              lg.optionKey,
              lg.optionLabel,
              gl,
              tpl
            )
          ) {
            hitAny = true;
            break;
          }
        }
        if (hitAny) unionP += pa;
      }
      return Math.min(1, Math.max(0, unionP));
    };

    const poissonBinomialTailProb = (probs, minK) => {
      const n = probs.length;
      if (minK <= 0) return 1;
      if (minK > n) return 0;
      const dp = new Float64Array(n + 1);
      dp[0] = 1;
      for (let i = 0; i < n; i++) {
        const p = Math.min(1, Math.max(0, probs[i]));
        for (let k = i + 1; k >= 1; k--) {
          dp[k] = dp[k] * (1 - p) + dp[k - 1] * p;
        }
        dp[0] *= 1 - p;
      }
      let sum = 0;
      for (let k = minK; k <= n; k++) sum += dp[k];
      return Math.min(1, Math.max(0, sum));
    };

    const computeSlotTheoreticalBound = (slotIdx) => {
      const M = selected.length;
      if (M === 1) {
        const m0 = selected[0];
        const anc = anchorsByMatch.get(m0.id) ?? [];
        if (anc.length === 0) {
          return {
            ceiling: 1,
            nonEquivalentSingleBlocked: false,
            passCapBlocked: false,
          };
        }
        const allSingleElig = anc.every((a) =>
          isPoolSingleEligible(m0.pools[a.poolCode])
        );
        if (allSingleElig) {
          return {
            ceiling: computeMatchAllowedUnionProb(m0),
            nonEquivalentSingleBlocked: false,
            passCapBlocked: false,
          };
        }
        const subsetCands = resolveSingleMatchSubsetCandidates(m0, anc);
        if (!acceptPartialSingleCoverage) {
          const exactCands = subsetCands.filter((c) => c.isExactEquivalent);
          if (exactCands.length === 0) {
            return {
              ceiling: 0,
              nonEquivalentSingleBlocked: true,
              passCapBlocked: false,
            };
          }
          return {
            ceiling: exactCands[0].coveredInTargetProb,
            nonEquivalentSingleBlocked: false,
            passCapBlocked: false,
          };
        }
        return {
          ceiling: subsetCands[0]?.coveredInTargetProb ?? 0,
          nonEquivalentSingleBlocked: false,
          passCapBlocked: false,
        };
      }

      if (slotIdx === 2) {
        // Slot ③ wheel: on M >= 3 uses 1 consensus/anchored leg per match with k >= 2
        if (M >= 3) {
          const wheelProbs = selected.map(
            (m) => preferredHighProbMainLeg(m)?.fairProb ?? 0
          );
          return {
            ceiling: poissonBinomialTailProb(wheelProbs, 2),
            nonEquivalentSingleBlocked: false,
            passCapBlocked: false,
          };
        }
        const m2Probs = selected.map((m) => computeMatchAllowedUnionProb(m));
        const anySingleCushion = selected.some((m) => {
          const sgl = singleCushionLegOf(m);
          return Boolean(sgl && isPoolSingleEligible(m.pools[sgl.poolCode]));
        });
        return {
          ceiling: poissonBinomialTailProb(m2Probs, anySingleCushion ? 1 : 2),
          nonEquivalentSingleBlocked: false,
          passCapBlocked: false,
        };
      }

      if (!hasUserAnchors) {
        return {
          ceiling: 1,
          nonEquivalentSingleBlocked: false,
          passCapBlocked: false,
        };
      }

      if (anchoredPassCapBlockedReason) {
        return {
          ceiling: 0,
          nonEquivalentSingleBlocked: false,
          passCapBlocked: true,
        };
      }

      const statCap =
        anchoredBlockHelper?.statutoryPassCap ??
        Math.min(
          ...selected.map((m) => {
            const anc = anchorsByMatch.get(m.id) ?? [];
            const codes =
              anc.length > 0 ? anc.map((a) => a.poolCode) : [primaryPoolOf(m)];
            return Math.min(...codes.map((c) => POOL_MAX_PASS[c] ?? 8));
          })
        );
      const everySingleOk = selected.every((m) => {
        const anc = anchorsByMatch.get(m.id) ?? [];
        if (anc.length > 0) {
          return anc.some((a) => isPoolSingleEligible(m.pools[a.poolCode]));
        }
        const p = preferredPrimaryLeg(m, false);
        return Boolean(p && isPoolSingleEligible(m.pools[p.poolCode]));
      });
      const everyAllUpOk = selected.every((m) => {
        const anc = anchorsByMatch.get(m.id) ?? [];
        if (anc.length > 0) {
          return anc.some((a) => isPoolAllUpEligible(m.pools[a.poolCode]));
        }
        return Boolean(preferredPrimaryLeg(m, true));
      });

      let allowedKs = [];
      if (
        hasExplicitPassSelection &&
        Array.isArray(explicitPassSizes) &&
        explicitPassSizes.length > 0
      ) {
        allowedKs = explicitPassSizes.filter(
          (k) =>
            k <= M && k <= statCap && (k === 1 ? everySingleOk : everyAllUpOk)
        );
      } else {
        if (everySingleOk) allowedKs.push(1);
        if (everyAllUpOk) {
          for (let k = 2; k <= Math.min(M, statCap); k++) allowedKs.push(k);
        }
      }
      if (allowedKs.length === 0) {
        return {
          ceiling: 0,
          nonEquivalentSingleBlocked: false,
          passCapBlocked: true,
        };
      }
      const minK = Math.min(...allowedKs);
      const canUseMultiMatchShield = allowedKs.includes(M) && M <= 6;
      const perMatchProbs = selected.map((m) =>
        computeMatchAllowedUnionProb(m, canUseMultiMatchShield)
      );
      return {
        ceiling: poissonBinomialTailProb(perMatchProbs, minK),
        nonEquivalentSingleBlocked: false,
        passCapBlocked: false,
      };
    };

    const anySingleAnchorPossible = selected.every((m) => {
      const anc = anchorsByMatch.get(m.id) ?? [];
      if (anc.length > 0) {
        return anc.some((a) => isPoolSingleEligible(m.pools[a.poolCode]));
      }
      const p = preferredPrimaryLeg(m, false);
      return Boolean(p && isPoolSingleEligible(m.pools[p.poolCode]));
    });

    const probeCache = new Map();
    const runProbeAt = (probeBudget, extraOpts = {}) => {
      const effMinSingle =
        Boolean(extraOpts.preferMinSingleStake) && anySingleAnchorPossible;
      const cacheKey = `${probeBudget}:${Boolean(extraOpts.autoPass)}:${effMinSingle}`;
      if (probeCache.has(cacheKey)) return probeCache.get(cacheKey);
      const nextOpts = {
        ...(portfolioOptions ?? {}),
        ...(extraOpts.autoPass ? { passSpec: { mode: "auto" } } : {}),
        preferMinSingleStake: effMinSingle,
        skipRemediation: true,
      };
      const res = generateParetoPortfolio(
        selected,
        probeBudget,
        stance,
        unlockFullAgg,
        anchorPicks,
        nextOpts
      );
      probeCache.set(cacheKey, res);
      return res;
    };

    const findMinFeasibleBudgetForSlot = (slotIdx) => {
      const checkB = (b) => {
        const plans = runProbeAt(b);
        return plans[slotIdx]?.available ? plans[slotIdx] : null;
      };
      const upperProbeB = Math.max(cleanBudget + 20, 400);
      const upperHit = checkB(upperProbeB);
      if (!upperHit) {
        const quickHit = checkB(cleanBudget + 2);
        return quickHit ? { minB: cleanBudget + 2, plan: quickHit } : null;
      }
      for (let b = cleanBudget + 2; b <= cleanBudget + 16; b += 2) {
        const hit = checkB(b);
        if (hit) return { minB: b, plan: hit };
      }
      const landmarks = [32, 48, 72, 110, 180, 300, upperProbeB].filter(
        (x) => x > cleanBudget + 16
      );
      let lo = cleanBudget + 16;
      let hi = null;
      let hiPlan = null;
      for (const lm of landmarks) {
        const hit = checkB(lm);
        if (hit) {
          hi = lm;
          hiPlan = hit;
          break;
        }
        lo = lm;
      }
      if (hi === null || !hiPlan) return null;
      while (hi - lo > 2) {
        const mid = Math.floor((lo + hi) / 2 / 2) * 2;
        if (mid <= lo || mid >= hi) break;
        const hit = checkB(mid);
        if (hit) {
          hi = mid;
          hiPlan = hit;
        } else {
          lo = mid;
        }
      }
      for (let chk = Math.max(cleanBudget + 2, hi - 6); chk < hi; chk += 2) {
        const hit = checkB(chk);
        if (hit) return { minB: chk, plan: hit };
      }
      return { minB: hi, plan: hiPlan };
    };

    for (let slotIdx = 0; slotIdx < allSlots.length; slotIdx++) {
      const plan = allSlots[slotIdx];
      if (!plan || plan.available) continue;

      const actions = [];
      if (slotIdx === 3) {
        const narrowAlphaBlocked =
          !unlockFullAgg && maxAlphaNotes < 1 && rawAlphaPool.length > 0;
        if (narrowAlphaBlocked) {
          const foundAlpha = findMinFeasibleBudgetForSlot(3);
          if (foundAlpha) {
            actions.push({
              kind: "min-feasible-budget",
              label: `预算升至 ¥${foundAlpha.minB} 解锁 36% 轻仓起投（实投 ¥${foundAlpha.plan.totalCost}）`,
              detail: `当前预算 ¥${cleanBudget} 的 36% 轻仓上限不足 1 注（¥2）；升至 ¥${foundAlpha.minB} 即可动用 ¥${foundAlpha.plan.totalCost} 轻仓捕捉正期望洼地`,
              minFeasibleBudgetYuan: foundAlpha.minB,
              previewCost: foundAlpha.plan.totalCost,
              strictNetGainProb: foundAlpha.plan.strictNetGainProb,
              zeroPayoutProb: foundAlpha.plan.zeroPayoutProb,
              structureLabel: "36% 轻仓护本",
              previewLines: foundAlpha.plan.lines,
            });
          }
        }
        actions.push({
          kind: "keep-cash",
          label: `空仓护本 · 保留 ¥${cleanBudget}`,
          detail: `严守正期望与轻仓纪律，全额保留 ¥${cleanBudget} 现金储备`,
        });
        plan.remediationActions = actions;
        continue;
      }

      // 1. Check lower-pass-preview when explicit pass selection locked out valid sub-pass partitions
      if (hasExplicitPassSelection && selected.length >= 2) {
        const unlockedPlans = runProbeAt(cleanBudget, {
          autoPass: true,
          preferMinSingleStake: slotIdx === 0,
        });
        const unlockedSlot = unlockedPlans[slotIdx];
        if (unlockedSlot && unlockedSlot.available) {
          const allSingleLines =
            unlockedSlot.lines.length > 0 &&
            unlockedSlot.lines.every((l) => l.legs.length === 1);
          const structLabel = allSingleLines
            ? `同向单关分块（${unlockedSlot.lines.length}张1串1）`
            : (unlockedSlot.structureBadge ??
              unlockedSlot.title ??
              "同向低阶分块");
          const strictPct = formatProbPctHonest(
            unlockedSlot.strictNetGainProb ?? unlockedSlot.winProb
          );
          actions.push({
            kind: "lower-pass-preview",
            label: `解锁低阶分块 · ${structLabel}（实投 ¥${unlockedSlot.totalCost} · 净赚率 ${strictPct}）`,
            detail: `保持所选场次与方向不变，解除锁死高关并改用【${structLabel}】，¥${unlockedSlot.totalCost} 即可达标（严格净赚率 ${strictPct}，整单归零率 ${formatProbPctHonest(unlockedSlot.zeroPayoutProb)}）`,
            structureLabel: structLabel,
            previewCost: unlockedSlot.totalCost,
            strictNetGainProb: unlockedSlot.strictNetGainProb,
            zeroPayoutProb: unlockedSlot.zeroPayoutProb,
            previewLines: unlockedSlot.lines,
          });
        }
      }

      // 2. Compute exact theoretical probability upper bound under current pass constraints
      const boundInfo = computeSlotTheoreticalBound(slotIdx);
      const slotThreshold =
        slotIdx === 0 ? 0.2 : slotIdx === 1 ? (hasUserAnchors ? 0.03 : 0) : 0.1;
      const isUpperBoundBlocked =
        !boundInfo.passCapBlocked &&
        !boundInfo.nonEquivalentSingleBlocked &&
        slotThreshold > 0 &&
        boundInfo.ceiling < slotThreshold - 1e-9;

      if (isUpperBoundBlocked) {
        plan.upperBoundBlocked = true;
        plan.theoreticalStrictNetGainCeiling = Number(
          boundInfo.ceiling.toFixed(6)
        );
        const ceilText = formatProbPctHonest(boundInfo.ceiling);
        const threshText = `${(slotThreshold * 100).toFixed(1)}%`;
        const metricName = slotIdx === 2 ? "最高中奖率" : "最高严格净赚率";
        const ceilingDisclosure = `经全组合概率上界验算，当前锁定方向与过关约束下理论${metricName}上限仅 ${ceilText}（低于 ${threshText} 准入红线），追加任何预算均无法突破该数学上限；已省略无效加预算建议`;
        plan.emptyReason = plan.emptyReason
          ? `${plan.emptyReason}；${ceilingDisclosure}`
          : ceilingDisclosure;
        plan.reasons = [ceilingDisclosure, ...plan.reasons];
      } else if (
        !boundInfo.passCapBlocked &&
        !boundInfo.nonEquivalentSingleBlocked
      ) {
        // 3. Solver-verified min-feasible-budget sweep (strictly ZERO "真保本" wording!)
        const foundMin = findMinFeasibleBudgetForSlot(slotIdx);
        if (foundMin) {
          const fp = foundMin.plan;
          const strictPct = formatProbPctHonest(fp.strictNetGainProb);
          const zeroPct = formatProbPctHonest(fp.zeroPayoutProb);
          actions.push({
            kind: "min-feasible-budget",
            label:
              slotIdx === 0
                ? `预算升至 ¥${foundMin.minB} 解锁零倒贴配平（净赚率 ${strictPct}）`
                : slotIdx === 1
                  ? `预算升至 ¥${foundMin.minB} 解锁对数效用配单（净赚率 ${strictPct}）`
                  : `预算升至 ¥${foundMin.minB} 解锁容错拆单组合`,
            detail: `受 ¥2 整注离散粒度限制，当前预算 ¥${cleanBudget} 下无法无倒贴配平；经求解器验算，最低需 ¥${foundMin.minB}（实投 ¥${fp.totalCost}，覆盖范围内不倒贴，整单归零率 ${zeroPct}）`,
            minFeasibleBudgetYuan: foundMin.minB,
            previewCost: fp.totalCost,
            strictNetGainProb: fp.strictNetGainProb,
            zeroPayoutProb: fp.zeroPayoutProb,
            structureLabel: fp.structureBadge ?? fp.shortTab,
            previewLines: fp.lines,
          });
        }
      }

      actions.push({
        kind: "keep-cash",
        label: `空仓护本 · 保留 ¥${cleanBudget}`,
        detail: `拒绝强凑高归零或倒贴废票，全额留存 ¥${cleanBudget} 本金`,
      });
      actions.push({
        kind: "go-manual",
        label: "转右侧手动自由组单",
        detail:
          "退出精算准入约束，保留当前手选方案在右侧审单舱自由调整过关与倍数",
      });
      if (hasSubPoolUserAnchors) {
        actions.push({
          kind: "switch-main-pool",
          label: "一键切回胜平负/让球主盘重配",
          detail:
            "将高抽水低命中子玩法切回同场胜平负/让球主盘正路，显著降低抽水与整单归零率",
        });
      }
      plan.remediationActions = actions;
    }
  }

  return [slot1Plan, slot2Plan, slot3Plan, slot4Plan];
}

export const generateFiveArchetypes = generateParetoPortfolio;
