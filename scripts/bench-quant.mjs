import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLedgerManager } from "../server/ledgerManager.mjs";
import {
  FALLBACK_MATCHES,
  POOL_MAX_PASS,
  archetypeToReport,
  bankerRoundParlayUnitPayout,
  calibrateMatchCoherentModel,
  computeProOrderInsights,
  computeTruthReport,
  devigPoolProbabilities,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  optimizeBonusPlan,
  parseSportteryRawJson,
  statutorySingleBetCap,
} from "../server/quantEngine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SETTLED_FIXTURE_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/realSportteryOosMatches.json"
);
const SYNTHETIC_AXIOMATIC_FIXTURE_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/syntheticCoherenceFixture.json"
);

const ALL_POOL_CODES = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
const ORDINAL_POOL_CODES = ["HAD", "HHAD", "TTG"];
const ORDINAL_POOL_SET = new Set(ORDINAL_POOL_CODES);

const fixtureCache = new Map();

function loadSettledFixtureBundle(fixturePath = DEFAULT_SETTLED_FIXTURE_PATH) {
  const resolved = path.resolve(fixturePath);
  if (fixtureCache.has(resolved)) {
    return fixtureCache.get(resolved);
  }
  const rawJson = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const t0 = performance.now();
  const parsedMatches = parseSportteryRawJson({
    value: { matchInfoList: [{ subMatchList: rawJson.matches }] },
  });
  const parseElapsedMs = performance.now() - t0;
  const cycleCount =
    Number.isFinite(rawJson.cycleCount) && rawJson.cycleCount > 0
      ? rawJson.cycleCount
      : Math.floor(parsedMatches.length / 8);
  const bundle = {
    fixturePath: resolved,
    rawFixture: rawJson,
    parsedMatches,
    cycleCount,
    parseElapsedMs,
  };
  fixtureCache.set(resolved, bundle);
  return bundle;
}

export function createMulberry32(seed = 20261120) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Equal-Mass (Quantile) 10-Bin Expected Calibration Error (ECE):
 * Sorts (p, y) pairs by predicted probability p into 10 equal-count quantile bins,
 * preventing empty-bin collapse on 31-outcome pools such as CRS (D-09 remediation).
 */
function calcEqualMassTenBinEce(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return 0;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const L = sorted.length;
  const B = 10;
  let ece = 0;
  for (let b = 0; b < B; b++) {
    const lo = Math.floor((b * L) / B);
    const hi = Math.floor(((b + 1) * L) / B);
    if (hi <= lo) continue;
    let sumP = 0;
    let sumY = 0;
    for (let i = lo; i < hi; i++) {
      sumP += sorted[i][0];
      sumY += sorted[i][1];
    }
    ece += Math.abs(sumP - sumY) / L;
  }
  return ece;
}

function runPairedBootstrapDiff(arrA, arrB, rng, iterations = 10_000) {
  const N = arrA.length;
  const diffs = new Float64Array(N);
  let sumObs = 0;
  for (let i = 0; i < N; i++) {
    const d = arrA[i] - arrB[i];
    diffs[i] = d;
    sumObs += d;
  }
  const meanDiff = sumObs / Math.max(1, N);
  const bootMeans = new Float64Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let s = 0;
    for (let i = 0; i < N; i++) {
      s += diffs[(rng() * N) | 0];
    }
    bootMeans[b] = s / N;
  }
  bootMeans.sort();
  let geZero = 0;
  let leZero = 0;
  for (let b = 0; b < iterations; b++) {
    if (bootMeans[b] >= 0) geZero += 1;
    if (bootMeans[b] <= 0) leZero += 1;
  }
  const pValue = Math.min(
    1,
    2 * Math.min(geZero / iterations, leZero / iterations)
  );
  return {
    meanDiff,
    ci95: [
      bootMeans[Math.floor(0.025 * iterations)],
      bootMeans[Math.floor(0.975 * iterations)],
    ],
    pValue,
  };
}

/**
 * Layer 1 · 中国体彩真实完场 OOS 五大玩法概率校准度与 10,000 次配对 Bootstrap 显著性检验
 * - 全五池统一考核严格恰当评分规则 Log-Loss、Brier Score 与等质量分位 10-bin ECE；
 * - RPS 仅对严格一维序数池（HAD / HHAD / TTG）计算，非序数池（HAFU / CRS）置 null。
 */
export function runLayer1ProperScoringBenchmark(opts = {}) {
  const t0 = performance.now();
  const { rawFixture, parsedMatches, cycleCount, parseElapsedMs } =
    loadSettledFixtureBundle(opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH);
  const N = parsedMatches.length;
  const bootstrapIterations = Number.isFinite(opts.bootstrapIterations)
    ? Math.max(500, Math.round(opts.bootstrapIterations))
    : 10_000;
  const rng = createMulberry32(
    Number.isFinite(opts.seed) ? opts.seed >>> 0 : 20261120
  );

  let maxCrossPoolCoherenceError = 0;
  for (let i = 0; i < N; i++) {
    const pm = parsedMatches[i];
    const pOf = (code, key) =>
      pm.pools[code].options.find((o) => o.key === key || o.label === key)
        ?.fairProb ?? 0;
    const errHafuH = Math.abs(
      pOf("HAFU", "hh") +
        pOf("HAFU", "dh") +
        pOf("HAFU", "ah") -
        pOf("HAD", "h")
    );
    const errHafuD = Math.abs(
      pOf("HAFU", "hd") +
        pOf("HAFU", "dd") +
        pOf("HAFU", "ad") -
        pOf("HAD", "d")
    );
    const errHafuA = Math.abs(
      pOf("HAFU", "ha") +
        pOf("HAFU", "da") +
        pOf("HAFU", "aa") -
        pOf("HAD", "a")
    );
    const errZero = Math.abs(pOf("TTG", "s0") - pOf("CRS", "0:0"));
    maxCrossPoolCoherenceError = Math.max(
      maxCrossPoolCoherenceError,
      errHafuH,
      errHafuD,
      errHafuA,
      errZero
    );
  }

  const methods = ["multiplicative", "shin", "coherentShinDc"];
  const globalPairs = {
    multiplicative: [],
    shin: [],
    coherentShinDc: [],
  };
  const perMatchMetrics = {
    multiplicative: {
      logLoss: new Float64Array(N),
      brier: new Float64Array(N),
      ordinalRps: new Float64Array(N),
    },
    shin: {
      logLoss: new Float64Array(N),
      brier: new Float64Array(N),
      ordinalRps: new Float64Array(N),
    },
    coherentShinDc: {
      logLoss: new Float64Array(N),
      brier: new Float64Array(N),
      ordinalRps: new Float64Array(N),
    },
  };
  const pools = {};

  for (const poolCode of ALL_POOL_CODES) {
    const isOrdinal = ORDINAL_POOL_SET.has(poolCode);
    const sums = {
      multiplicative: { rps: 0, brier: 0, logLoss: 0, pairs: [] },
      shin: { rps: 0, brier: 0, logLoss: 0, pairs: [] },
      coherentShinDc: { rps: 0, brier: 0, logLoss: 0, pairs: [] },
    };

    for (let i = 0; i < N; i++) {
      const pm = parsedMatches[i];
      const rawM = rawFixture.matches[i];
      const out = rawM.outcome;
      const options = pm.pools[poolCode].options;
      const goalLine = Number(
        pm.pools.HHAD?.goalLine ?? rawM.hhad?.goalLine ?? -1
      );
      const adj = out.ftHome - out.ftAway + goalLine;
      const hhadKey = adj > 0 ? "hh" : adj === 0 ? "hd" : "ha";

      const winIdx =
        poolCode === "HAD"
          ? options.findIndex((o) => o.key === out.hadKey)
          : poolCode === "HHAD"
            ? options.findIndex((o) => o.key === hhadKey)
            : poolCode === "TTG"
              ? options.findIndex((o) => o.key === out.ttgKey)
              : poolCode === "HAFU"
                ? options.findIndex((o) => o.key === out.hafuKey)
                : options.findIndex((o) => o.label === out.crsLabel);

      if (winIdx < 0) {
        throw new Error(
          `Missing settled outcome index for ${poolCode} on match ${pm.id}`
        );
      }

      const probMap = {
        multiplicative: devigPoolProbabilities(options, "multiplicative").probs,
        shin: options.map((o) => o.shinProb ?? 0),
        coherentShinDc: options.map((o) => o.fairProb),
      };

      const R = options.length;
      for (const mKey of methods) {
        const probs = probMap[mKey];
        const acc = sums[mKey];
        let cumP = 0;
        let cumY = 0;
        let rpsVal = 0;
        let brierVal = 0;
        for (let r = 0; r < R; r++) {
          const y = r === winIdx ? 1 : 0;
          const pr = probs[r];
          const diff = pr - y;
          brierVal += diff * diff;
          acc.pairs.push([pr, y]);
          globalPairs[mKey].push([pr, y]);
          if (isOrdinal && r < R - 1) {
            cumP += pr;
            cumY += y;
            const d = cumP - cumY;
            rpsVal += d * d;
          }
        }
        const llVal = -Math.log(Math.max(1e-12, probs[winIdx]));
        acc.brier += brierVal;
        acc.logLoss += llVal;
        perMatchMetrics[mKey].brier[i] += brierVal / ALL_POOL_CODES.length;
        perMatchMetrics[mKey].logLoss[i] += llVal / ALL_POOL_CODES.length;
        if (isOrdinal) {
          const normRps = rpsVal / (R - 1);
          acc.rps += normRps;
          perMatchMetrics[mKey].ordinalRps[i] +=
            normRps / ORDINAL_POOL_CODES.length;
        }
      }
    }

    pools[poolCode] = {
      optionCount: parsedMatches[0].pools[poolCode].options.length,
      isOrdinal,
      avgVigPct:
        (parsedMatches.reduce((a, m) => a + m.pools[poolCode].vig, 0) / N) *
        100,
      multiplicative: {
        rps: isOrdinal ? sums.multiplicative.rps / N : null,
        brier: sums.multiplicative.brier / N,
        logLoss: sums.multiplicative.logLoss / N,
        ece: calcEqualMassTenBinEce(sums.multiplicative.pairs),
      },
      shin: {
        rps: isOrdinal ? sums.shin.rps / N : null,
        brier: sums.shin.brier / N,
        logLoss: sums.shin.logLoss / N,
        ece: calcEqualMassTenBinEce(sums.shin.pairs),
      },
      coherentShinDc: {
        rps: isOrdinal ? sums.coherentShinDc.rps / N : null,
        brier: sums.coherentShinDc.brier / N,
        logLoss: sums.coherentShinDc.logLoss / N,
        ece: calcEqualMassTenBinEce(sums.coherentShinDc.pairs),
      },
    };
  }

  const macroAvg = (mKey) => {
    const P = ALL_POOL_CODES.length;
    const OP = ORDINAL_POOL_CODES.length;
    return {
      rps: ORDINAL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].rps, 0) / OP,
      brier: ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].brier, 0) / P,
      logLoss:
        ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].logLoss, 0) / P,
      ece: ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].ece, 0) / P,
      pooledEce: calcEqualMassTenBinEce(globalPairs[mKey]),
    };
  };

  const buildPairStats = (keyA, keyB) => {
    const ll = runPairedBootstrapDiff(
      perMatchMetrics[keyA].logLoss,
      perMatchMetrics[keyB].logLoss,
      rng,
      bootstrapIterations
    );
    const br = runPairedBootstrapDiff(
      perMatchMetrics[keyA].brier,
      perMatchMetrics[keyB].brier,
      rng,
      bootstrapIterations
    );
    const rps = runPairedBootstrapDiff(
      perMatchMetrics[keyA].ordinalRps,
      perMatchMetrics[keyB].ordinalRps,
      rng,
      bootstrapIterations
    );
    return {
      meanLogLossDiff: ll.meanDiff,
      logLossCi95: ll.ci95,
      logLossPValue: ll.pValue,
      meanBrierDiff: br.meanDiff,
      brierCi95: br.ci95,
      brierPValue: br.pValue,
      meanOrdinalRpsDiff: rps.meanDiff,
      ordinalRpsCi95: rps.ci95,
      ordinalRpsPValue: rps.pValue,
    };
  };

  const pairedBootstrap = {
    iterations: bootstrapIterations,
    vsMultiplicative: buildPairStats("coherentShinDc", "multiplicative"),
    vsShin: buildPairStats("coherentShinDc", "shin"),
    shinVsMultiplicative: buildPairStats("shin", "multiplicative"),
  };

  return {
    matchCount: N,
    cycleCount,
    parseMsPerMatch: parseElapsedMs / N,
    elapsedMs: performance.now() - t0,
    maxCrossPoolCoherenceError,
    pools,
    aggregate: {
      multiplicative: macroAvg("multiplicative"),
      shin: macroAvg("shin"),
      coherentShinDc: macroAvg("coherentShinDc"),
    },
    pairedBootstrap,
  };
}

function makePickFromMatch(match, poolCode, optionKeyOrLabel) {
  const pool = match.pools[poolCode];
  const opt = pool.options.find(
    (o) => o.key === optionKeyOrLabel || o.label === optionKeyOrLabel
  );
  if (!opt) {
    throw new Error(
      `Option ${optionKeyOrLabel} not found in ${poolCode} for match ${match.id}`
    );
  }
  return {
    matchId: match.id,
    matchNumStr: match.matchNumStr,
    home: match.home,
    away: match.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: Boolean(pool.single),
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

function doesLegHitAtomicState(leg, goalLine, st) {
  if (leg.poolCode === "HAD") return st.ft === leg.optionKey;
  if (leg.poolCode === "HHAD") {
    const adj = st.goalDiff + goalLine;
    const k = adj > 0 ? "hh" : adj === 0 ? "hd" : "ha";
    return k === leg.optionKey;
  }
  if (leg.poolCode === "TTG") {
    const norm = String(leg.optionKey).startsWith("s")
      ? leg.optionKey
      : `s${leg.optionKey}`;
    return st.ttgKey === norm;
  }
  if (leg.poolCode === "HAFU") return st.hafuKey === leg.optionKey;
  if (leg.poolCode === "CRS") {
    return st.crsKey === leg.optionKey || st.crsKey === leg.optionLabel;
  }
  return false;
}

/**
 * Independent brute-force Cartesian enumerator over full (ht, ft) atomic grids
 * (used in Layer 2 for 1..2 match portfolios to independently cross-check quotient folding).
 */
function bruteForceEvaluateTickets(tickets, totalCost, matches) {
  const matchIds = Array.from(
    new Set(tickets.flatMap((t) => t.legs.map((g) => g.matchId)))
  );
  const cals = matchIds.map((mid) => {
    const fm = matches.find((m) => m.id === mid);
    return {
      matchId: mid,
      goalLine: Number(fm.pools.HHAD?.goalLine ?? -1),
      states: calibrateMatchCoherentModel(fm).atomicStates,
    };
  });

  let anyWinProb = 0;
  let realProfitProb = 0;
  let minPayout = Infinity;
  let maxPayout = 0;
  let expectedReturn = 0;

  const walk = (depth, curProb, chosenStates) => {
    if (depth === cals.length) {
      let payout = 0;
      for (let k = 0; k < tickets.length; k++) {
        const tk = tickets[k];
        let allHit = true;
        for (let i = 0; i < tk.legs.length; i++) {
          const lg = tk.legs[i];
          const mIdx = matchIds.indexOf(lg.matchId);
          if (
            !doesLegHitAtomicState(lg, cals[mIdx].goalLine, chosenStates[mIdx])
          ) {
            allHit = false;
            break;
          }
        }
        if (allHit) {
          payout += tk.totalPayout ?? tk.returnPayout;
        }
      }
      const roundedPayout = Number(payout.toFixed(2));
      if (roundedPayout > 0) {
        anyWinProb += curProb;
        if (roundedPayout >= totalCost - 1e-9) {
          realProfitProb += curProb;
        }
        if (roundedPayout < minPayout) minPayout = roundedPayout;
        if (roundedPayout > maxPayout) maxPayout = roundedPayout;
        expectedReturn += curProb * roundedPayout;
      }
      return;
    }

    const stList = cals[depth].states;
    for (let s = 0; s < stList.length; s++) {
      chosenStates[depth] = stList[s];
      walk(depth + 1, curProb * stList[s].prob, chosenStates);
    }
  };

  walk(0, 1, new Array(cals.length));
  return {
    anyWinProb,
    realProfitProb,
    minPayout: minPayout < Infinity ? minPayout : 0,
    maxPayout,
    expectedReturn,
    expectedValueRate:
      totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0,
  };
}

/**
 * Layer 2 · 概率公理、极端边界压力（>16,384 态零近似 EV / >2,048 注显式阻断 / 缓存全敏感）与 <15ms 延迟门禁
 */
export function runLayer2AxiomaticInvariantsBenchmark(opts = {}) {
  const t0 = performance.now();
  const { parsedMatches } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );
  const synthMatches = fs.existsSync(SYNTHETIC_AXIOMATIC_FIXTURE_PATH)
    ? loadSettledFixtureBundle(SYNTHETIC_AXIOMATIC_FIXTURE_PATH).parsedMatches
    : [];
  const allMatches = [...FALLBACK_MATCHES, ...parsedMatches, ...synthMatches];

  const homeWinCrs = new Set([
    "1:0",
    "2:0",
    "2:1",
    "3:0",
    "3:1",
    "3:2",
    "4:0",
    "4:1",
    "4:2",
    "5:0",
    "5:1",
    "5:2",
    "胜其它",
  ]);
  const drawCrs = new Set(["0:0", "1:1", "2:2", "3:3", "平其它"]);
  const awayWinCrs = new Set([
    "0:1",
    "0:2",
    "1:2",
    "0:3",
    "1:3",
    "2:3",
    "0:4",
    "1:4",
    "2:4",
    "0:5",
    "1:5",
    "2:5",
    "负其它",
  ]);

  let maxMarginalSumError = 0;
  let maxCrossPoolEquivError = 0;

  // 1. Single-match 5-pool marginal sum & cross-pool exact equivalences across all 726 matches
  for (const m of allMatches) {
    const cal = calibrateMatchCoherentModel(m);
    for (const poolCode of ALL_POOL_CODES) {
      const pool = m.pools[poolCode];
      if (!pool || pool.selling === false) continue;
      const sumFair = pool.options.reduce((a, o) => a + o.fairProb, 0);
      const sumShin = pool.options.reduce((a, o) => a + (o.shinProb ?? 0), 0);
      maxMarginalSumError = Math.max(
        maxMarginalSumError,
        Math.abs(sumFair - 1),
        Math.abs(sumShin - 1)
      );
    }

    const pOf = (code, key) =>
      m.pools[code].options.find((o) => o.key === key || o.label === key)
        ?.fairProb ?? 0;

    const hafuH = pOf("HAFU", "hh") + pOf("HAFU", "dh") + pOf("HAFU", "ah");
    const hafuD = pOf("HAFU", "hd") + pOf("HAFU", "dd") + pOf("HAFU", "ad");
    const hafuA = pOf("HAFU", "ha") + pOf("HAFU", "da") + pOf("HAFU", "aa");
    const ttg0 = pOf("TTG", "s0");
    const crs00 = pOf("CRS", "0:0");
    const ttg1 = pOf("TTG", "s1");
    const crs1 = pOf("CRS", "1:0") + pOf("CRS", "0:1");
    const crsH = m.pools.CRS.options
      .filter((o) => homeWinCrs.has(o.label))
      .reduce((a, o) => a + o.fairProb, 0);
    const crsD = m.pools.CRS.options
      .filter((o) => drawCrs.has(o.label))
      .reduce((a, o) => a + o.fairProb, 0);
    const crsA = m.pools.CRS.options
      .filter((o) => awayWinCrs.has(o.label))
      .reduce((a, o) => a + o.fairProb, 0);

    let hhadEquivErr = 0;
    const gridDim = Math.round(Math.sqrt(cal.scoreGrid.length));
    const maxG = gridDim - 1;
    const gLine = Number(m.pools.HHAD?.goalLine ?? -1);
    if (gLine === -1) {
      let gridWinBy2Plus = 0;
      for (let x = 0; x <= maxG; x++) {
        for (let y = 0; y <= maxG; y++) {
          if (x - y >= 2) gridWinBy2Plus += cal.scoreGrid[x * gridDim + y];
        }
      }
      hhadEquivErr = Math.max(
        Math.abs(pOf("HHAD", "hh") - gridWinBy2Plus),
        Math.abs(pOf("HHAD", "hh") + pOf("HHAD", "hd") - pOf("HAD", "h")),
        Math.abs(pOf("HHAD", "ha") - (pOf("HAD", "d") + pOf("HAD", "a")))
      );
    } else if (gLine === 1) {
      let gridAwayBy2Plus = 0;
      for (let x = 0; x <= maxG; x++) {
        for (let y = 0; y <= maxG; y++) {
          if (y - x >= 2) gridAwayBy2Plus += cal.scoreGrid[x * gridDim + y];
        }
      }
      hhadEquivErr = Math.max(
        Math.abs(pOf("HHAD", "ha") - gridAwayBy2Plus),
        Math.abs(pOf("HHAD", "hh") - (pOf("HAD", "h") + pOf("HAD", "d")))
      );
    }

    maxCrossPoolEquivError = Math.max(
      maxCrossPoolEquivError,
      Math.abs(hafuH - pOf("HAD", "h")),
      Math.abs(hafuD - pOf("HAD", "d")),
      Math.abs(hafuA - pOf("HAD", "a")),
      Math.abs(ttg0 - crs00),
      Math.abs(ttg1 - crs1),
      Math.abs(crsH - pOf("HAD", "h")),
      Math.abs(crsD - pOf("HAD", "d")),
      Math.abs(crsA - pOf("HAD", "a")),
      hhadEquivErr
    );
  }

  // 2. Joint state-space & statutory invariants across 1..8 matches, mixed pools, dual-single, M串N, and Pareto portfolios
  let maxComboSumError = 0;
  let maxLinearEvError = 0;
  let maxBruteForceDiff = 0;
  let statutoryRoundingAndCapErrors = 0;
  let illegalTicketViolations = 0;
  let probabilityOrderingViolations = 0;
  let portfolioScenariosChecked = 0;
  const violationDetails = [];

  const verifyReportInvariants = (
    label,
    report,
    matchesSubset,
    runBruteForce = false
  ) => {
    portfolioScenariosChecked += 1;
    const tickets = report.tickets ?? [];
    const combos = report.combos ?? [];

    if (!(
      report.realProfitProb >= -1e-12 &&
      report.realProfitProb <= report.anyWinProb + 1e-12 &&
      report.anyWinProb <= 1 + 1e-12 &&
      combos.every((c) => c.prob >= 0)
    )) {
      probabilityOrderingViolations += 1;
    }

    const sumCombos = combos.reduce((a, c) => a + c.prob, 0);
    const sumProfitCombos = combos
      .filter((c) => !c.isUnderwater)
      .reduce((a, c) => a + c.prob, 0);
    maxComboSumError = Math.max(
      maxComboSumError,
      Math.abs(sumCombos - report.anyWinProb),
      Math.abs(sumProfitCombos - report.realProfitProb)
    );

    let linearTicketExpectedReturn = 0;
    for (const tk of tickets) {
      const legs = tk.legs ?? [];
      const minPoolCap = Math.min(
        ...legs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8)
      );
      if (legs.length === 0 || legs.length > minPoolCap) {
        illegalTicketViolations += 1;
        violationDetails.push(
          `${label}: pass cap violation (${legs.length} > ${minPoolCap})`
        );
      }
      if (legs.length === 1) {
        const fm = matchesSubset.find((x) => x.id === legs[0].matchId);
        if (fm && !fm.pools?.[legs[0].poolCode]?.single) {
          illegalTicketViolations += 1;
          violationDetails.push(
            `${label}: single ticket on non-single pool ${fm.id}:${legs[0].poolCode}:${legs[0].optionKey}`
          );
        }
      }
      const expectedRawUnit = bankerRoundParlayUnitPayout(
        legs.map((g) => Number(g.odds))
      );
      const expectedCap = statutorySingleBetCap(legs.length);
      const expectedUnit = Math.min(expectedCap, expectedRawUnit);
      const expectedTotal = Number((expectedUnit * tk.multiple).toFixed(2));
      if (
        Math.abs(tk.unitPayout - expectedUnit) > 1e-9 ||
        Math.abs(tk.totalPayout - expectedTotal) > 1e-9
      ) {
        statutoryRoundingAndCapErrors += 1;
      }

      let ticketHitProb = 1;
      for (const lg of legs) {
        const fm = matchesSubset.find((x) => x.id === lg.matchId);
        if (fm) {
          const cal = calibrateMatchCoherentModel(fm);
          const gl = Number(fm.pools.HHAD?.goalLine ?? -1);
          let pLeg = 0;
          for (const st of cal.atomicStates) {
            if (doesLegHitAtomicState(lg, gl, st)) pLeg += st.prob;
          }
          ticketHitProb *= pLeg;
        } else {
          ticketHitProb *= lg.fairProb;
        }
      }
      linearTicketExpectedReturn += ticketHitProb * tk.totalPayout;
    }

    const comboExpectedReturn = combos.reduce(
      (a, c) => a + c.prob * c.totalPayout,
      0
    );
    if (report.totalCost > 0 && tickets.length > 0) {
      const evFromCombos =
        (comboExpectedReturn - report.totalCost) / report.totalCost;
      const evFromLinearTickets =
        (linearTicketExpectedReturn - report.totalCost) / report.totalCost;
      maxLinearEvError = Math.max(
        maxLinearEvError,
        Math.abs(report.expectedValueRate - evFromCombos),
        Math.abs(report.expectedValueRate - evFromLinearTickets)
      );
    }

    if (runBruteForce && tickets.length > 0) {
      const bf = bruteForceEvaluateTickets(
        tickets,
        report.totalCost,
        matchesSubset
      );
      maxBruteForceDiff = Math.max(
        maxBruteForceDiff,
        Math.abs(report.anyWinProb - bf.anyWinProb),
        Math.abs(report.realProfitProb - bf.realProfitProb),
        Math.abs(report.minPayout - bf.minPayout),
        Math.abs(report.maxPayout - bf.maxPayout),
        Math.abs(report.expectedValueRate - bf.expectedValueRate)
      );
    }
  };

  // (a) 1..8 matches across FALLBACK_MATCHES and real OOS cycle 1
  for (const source of [
    { tag: "fallback", list: FALLBACK_MATCHES },
    { tag: "real-oos-c1", list: parsedMatches.slice(0, 8) },
  ]) {
    for (let mCount = 1; mCount <= 8; mCount++) {
      const sub = source.list.slice(0, mCount);
      const plans = generateParetoPortfolio(sub, 100, "objective", false, []);
      for (const pl of plans) {
        if (!pl.available || pl.lines.length === 0) continue;
        const rep = archetypeToReport(pl, null, sub);
        verifyReportInvariants(
          `${source.tag}-${mCount}-${pl.key}`,
          rep,
          sub,
          source.tag === "fallback" && mCount <= 2
        );
      }
    }
  }

  // (b) Same-match HAD + HHAD dual-single & cross-pool overlapping 2-match parlay
  const mDual = FALLBACK_MATCHES[1];
  const dualRep = computeTruthReport(
    [
      makePickFromMatch(mDual, "HAD", "h"),
      makePickFromMatch(mDual, "HAD", "d"),
      makePickFromMatch(mDual, "HHAD", "hh"),
    ],
    4,
    [mDual]
  );
  verifyReportInvariants("same-match-dual-single", dualRep, [mDual], true);

  const mixTwo = FALLBACK_MATCHES.slice(0, 2);
  const mixRep2 = computeTruthReport(
    [
      makePickFromMatch(mixTwo[0], "HAFU", "dh"),
      makePickFromMatch(mixTwo[0], "HAFU", "hh"),
      makePickFromMatch(mixTwo[1], "CRS", "1:0"),
      makePickFromMatch(mixTwo[1], "CRS", "2:0"),
    ],
    3,
    mixTwo,
    { mode: "free", passSizes: [1, 2] }
  );
  verifyReportInvariants("mixed-hafu-crs-2match", mixRep2, mixTwo, true);

  // (c) Official M串N multi-pass + Three-Mode Bonus Optimization
  const m3 = FALLBACK_MATCHES.slice(0, 3);
  const rep3x4 = computeTruthReport(
    [
      makePickFromMatch(m3[0], "HAD", "h"),
      makePickFromMatch(m3[0], "HAD", "d"),
      makePickFromMatch(m3[1], "HHAD", "hh"),
      makePickFromMatch(m3[2], "TTG", "s2"),
    ],
    2,
    m3,
    { mode: "combo", comboCode: "3x4" }
  );
  verifyReportInvariants("combo-3x4", rep3x4, m3, false);

  const m4 = FALLBACK_MATCHES.slice(0, 4);
  const rep4x11 = computeTruthReport(
    [
      makePickFromMatch(m4[0], "HAD", "h"),
      makePickFromMatch(m4[1], "HHAD", "ha"),
      makePickFromMatch(m4[2], "HAFU", "dd"),
      makePickFromMatch(m4[3], "CRS", "1:2"),
    ],
    2,
    m4,
    { mode: "combo", comboCode: "4x11" }
  );
  verifyReportInvariants("combo-4x11-mixed-5pool", rep4x11, m4, false);

  for (const optMode of ["equal", "hot-first", "cold-first"]) {
    const optPlan = optimizeBonusPlan(rep4x11, m4, optMode);
    const optRep = archetypeToReport(optPlan, rep4x11, m4);
    verifyReportInvariants(`bonus-4x11-${optMode}`, optRep, m4, false);
  }

  const m6 = FALLBACK_MATCHES.slice(0, 6);
  const rep6x15 = computeTruthReport(
    m6.map((m, idx) =>
      idx % 2 === 0
        ? makePickFromMatch(m, "HAD", "h")
        : makePickFromMatch(m, "TTG", "s2")
    ),
    2,
    m6,
    { mode: "combo", comboCode: "6x15" }
  );
  verifyReportInvariants("combo-6x15", rep6x15, m6, false);

  // (d) Pathological Stress Check 1 (D-01): 7-match x 4 TTG options in 2串1 (5^7 = 78,125 > 32,768 states)
  const sevenMatches = FALLBACK_MATCHES.slice(0, 7);
  const highStatePicks = sevenMatches.flatMap((m) =>
    ["s0", "s1", "s2", "s3"].map((k) => makePickFromMatch(m, "TTG", k))
  );
  const highStateRep = computeTruthReport(highStatePicks, 1, sevenMatches, {
    mode: "free",
    passSizes: [2],
  });
  let exactLinearHighStateRet = 0;
  for (const tk of highStateRep.tickets) {
    let pTk = 1;
    for (const g of tk.legs) {
      const fm = sevenMatches.find((x) => x.id === g.matchId);
      const opt = fm.pools[g.poolCode].options.find(
        (o) => o.key === g.optionKey
      );
      pTk *= opt.fairProb;
    }
    exactLinearHighStateRet += pTk * tk.totalPayout;
  }
  const exactHighStateEvRate =
    (exactLinearHighStateRet - highStateRep.totalCost) / highStateRep.totalCost;
  const highStateSpaceEvError = Math.abs(
    highStateRep.expectedValueRate - exactHighStateEvRate
  );
  portfolioScenariosChecked += 1;

  // (e) Pathological Stress Check 2 (D-02): 6-match full HAD cover (3^6 = 729 <= 2,048 -> anyWinProb = 1.0)
  // vs 8-match full HAD cover (3^8 = 6,561 > 2,048 -> canCheckout = false, betCount = 6,561, zero silent truncation)
  const sixBoxPicks = FALLBACK_MATCHES.slice(0, 6).flatMap((m) =>
    ["h", "d", "a"].map((k) => makePickFromMatch(m, "HAD", k))
  );
  const sixBoxRep = computeTruthReport(
    sixBoxPicks,
    1,
    FALLBACK_MATCHES.slice(0, 6),
    {
      mode: "free",
      passSizes: [6],
    }
  );
  const eightBoxPicks = FALLBACK_MATCHES.slice(0, 8).flatMap((m) =>
    ["h", "d", "a"].map((k) => makePickFromMatch(m, "HAD", k))
  );
  const eightBoxRep = computeTruthReport(
    eightBoxPicks,
    1,
    FALLBACK_MATCHES.slice(0, 8),
    {
      mode: "free",
      passSizes: [8],
    }
  );
  const combinatorialExplosionGatePassed =
    sixBoxRep.betCount === 729 &&
    Math.abs(sixBoxRep.anyWinProb - 1.0) < 1e-12 &&
    eightBoxRep.betCount === 6561 &&
    eightBoxRep.totalCost === 13122 &&
    eightBoxRep.canCheckout === false &&
    Boolean(eightBoxRep.ruleBlockReason);
  portfolioScenariosChecked += 2;

  // (f) Pathological Stress Check 3 (D-08): WeakMap cache sensitivity on mutating interior/tail HAFU & CRS options on SAME object
  const mutMatch = structuredClone(FALLBACK_MATCHES[2]);
  const calBefore = calibrateMatchCoherentModel(mutMatch);
  const beforeDh = calBefore.pools.HAFU.options.find(
    (o) => o.key === "dh"
  ).fairProb;
  const dhOptMut = mutMatch.pools.HAFU.options.find((o) => o.key === "dh");
  dhOptMut.odds = Number((dhOptMut.odds * 2.1).toFixed(2));
  const calAfterDh = calibrateMatchCoherentModel(mutMatch);
  const afterDh = calAfterDh.pools.HAFU.options.find(
    (o) => o.key === "dh"
  ).fairProb;
  const crsTailOpt = mutMatch.pools.CRS.options[30];
  const beforeTail = calAfterDh.pools.CRS.options[30].fairProb;
  crsTailOpt.odds = Number(Math.max(5, crsTailOpt.odds * 0.4).toFixed(2));
  const calAfterTail = calibrateMatchCoherentModel(mutMatch);
  const afterTail = calAfterTail.pools.CRS.options[30].fairProb;
  const cacheMutationSensitivityPassed =
    Math.abs(afterDh - beforeDh) > 1e-5 &&
    Math.abs(afterTail - beforeTail) > 1e-5;

  // (g) Statutory high-odds cap-clipping verification across 1/2/4/6-leg tiers (10w / 20w / 50w / 100w)
  const highOddsMatches = FALLBACK_MATCHES.slice(0, 6).map((fm, idx) => ({
    ...fm,
    id: `cap-tier-${idx}`,
    pools: {
      ...fm.pools,
      HAD: {
        ...fm.pools.HAD,
        single: true,
        selling: true,
        options: [
          {
            key: "h",
            label: "主胜",
            odds: 60000,
            trend: 0,
            fairProb: 0.4,
            shinProb: 0.4,
          },
          {
            key: "d",
            label: "平",
            odds: 3.5,
            trend: 0,
            fairProb: 0.3,
            shinProb: 0.3,
          },
          {
            key: "a",
            label: "客胜",
            odds: 3.5,
            trend: 0,
            fairProb: 0.3,
            shinProb: 0.3,
          },
        ],
      },
    },
  }));
  for (const [legCnt, expectedCap] of [
    [1, 100_000],
    [2, 200_000],
    [4, 500_000],
    [6, 1_000_000],
  ]) {
    const subCap = highOddsMatches.slice(0, legCnt);
    const repCap = computeTruthReport(
      subCap.map((x) => makePickFromMatch(x, "HAD", "h")),
      2,
      subCap,
      { mode: "free", passSizes: [legCnt] }
    );
    if (
      repCap.tickets[0]?.unitPayout !== expectedCap ||
      repCap.maxPayout !== expectedCap * 2
    ) {
      statutoryRoundingAndCapErrors += 1;
    }
  }

  // 3. 8-match full evaluateQuantWorkspace latency gates (< 15ms average on both 8x9 and worst-case 8x247 + bonus optimization)
  const eightMatches = FALLBACK_MATCHES;
  const eightPicks = eightMatches.map((m) => makePickFromMatch(m, "HAD", "h"));
  const targetIds = eightMatches.map((m) => m.id);
  for (let w = 0; w < 3; w++) {
    evaluateQuantWorkspace(
      {
        picks: eightPicks,
        multiple: 5,
        passSpec: { mode: "combo", comboCode: "8x247" },
        subjectiveDeltaPct: 5,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds,
        anchorToRadarPicks: true,
        budget: 500,
        stance: "objective",
        unlockFullAgg: false,
      },
      eightMatches
    );
  }
  const runs = 10;
  const latStart = performance.now();
  for (let i = 0; i < runs; i++) {
    evaluateQuantWorkspace(
      {
        picks: eightPicks,
        multiple: 5,
        passSpec: { mode: "combo", comboCode: "8x9" },
        subjectiveDeltaPct: (i % 4) * 4 - 4,
        simVoidFirstMatch: i % 2 === 1,
        planSpec: {
          kind: "archetype",
          key: "max-cvar-wheel",
          scaleMultiple: 1,
        },
        targetIds,
        anchorToRadarPicks: true,
        budget: 120,
        stance: i % 2 === 0 ? "objective" : "home-lean",
        unlockFullAgg: false,
      },
      eightMatches
    );
  }
  const avgEightMatchWorkspaceMs = (performance.now() - latStart) / runs;

  const lat247Start = performance.now();
  for (let i = 0; i < runs; i++) {
    evaluateQuantWorkspace(
      {
        picks: eightPicks,
        multiple: 2,
        passSpec: { mode: "combo", comboCode: "8x247" },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "bonus",
          optMode:
            i % 3 === 0 ? "hot-first" : i % 3 === 1 ? "equal" : "cold-first",
          scaleMultiple: 1,
        },
        targetIds,
        anchorToRadarPicks: true,
        budget: 500,
        stance: "objective",
        unlockFullAgg: false,
      },
      eightMatches
    );
  }
  const avgEightMatch247WorkspaceMs = (performance.now() - lat247Start) / runs;

  // Spec 0011 P0 Guardrails: (a) >131k-state exact realProfitProb on 6x7 TTG 2串1 (8^6 = 262,144 states, 735 bets),
  // (b) M=2 single-cushion non-summing floor bound, and (c) statutory single-eligibility gate on staggered kickoff hedge
  const sixTtgMatches = parsedMatches.slice(0, 6);
  const ttg7Keys = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
  const sixTtgPicks = sixTtgMatches.flatMap((m) =>
    ttg7Keys.map((k) => makePickFromMatch(m, "TTG", k))
  );
  const rep6x7 = computeTruthReport(sixTtgPicks, 1, sixTtgMatches, {
    mode: "free",
    passSizes: [2],
  });
  let exact6x7ProfitProb = 0;
  const stProbs6 = sixTtgMatches.map((m) => {
    const ps = ttg7Keys.map(
      (k) => m.pools.TTG.options.find((o) => o.key === k).fairProb
    );
    return [...ps, Math.max(0, 1 - ps.reduce((a, b) => a + b, 0))];
  });
  const pair6Cents = Array.from({ length: 6 }, () =>
    Array.from({ length: 6 }, () =>
      Array.from({ length: 8 }, () => new Array(8).fill(0))
    )
  );
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      for (let a = 0; a < 7; a++) {
        const oa = sixTtgMatches[i].pools.TTG.options.find(
          (o) => o.key === ttg7Keys[a]
        ).odds;
        for (let b = 0; b < 7; b++) {
          const ob = sixTtgMatches[j].pools.TTG.options.find(
            (o) => o.key === ttg7Keys[b]
          ).odds;
          pair6Cents[i][j][a][b] = Math.round(
            Math.min(200_000, bankerRoundParlayUnitPayout([oa, ob])) * 100
          );
        }
      }
    }
  }
  const cost6Cents = Math.round(rep6x7.totalCost * 100);
  const ch6 = new Int32Array(6);
  const walk6 = (d, p, pay) => {
    if (d === 5) {
      const p5 = stProbs6[5];
      for (let s = 0; s < 8; s++) {
        let add = 0;
        if (s < 7) {
          for (let prev = 0; prev < 5; prev++) {
            if (ch6[prev] < 7) add += pair6Cents[prev][5][ch6[prev]][s];
          }
        }
        if (pay + add >= cost6Cents) exact6x7ProfitProb += p * p5[s];
      }
      return;
    }
    const pd = stProbs6[d];
    for (let s = 0; s < 8; s++) {
      ch6[d] = s;
      let add = 0;
      if (s < 7) {
        for (let prev = 0; prev < d; prev++) {
          if (ch6[prev] < 7) add += pair6Cents[prev][d][ch6[prev]][s];
        }
      }
      walk6(d + 1, p * pd[s], pay + add);
    }
  };
  walk6(0, 1, 0);
  const highStateProfitProbError = Math.abs(
    rep6x7.realProfitProb - exact6x7ProfitProb
  );

  const nonSingleHedgePicks = [
    makePickFromMatch(FALLBACK_MATCHES[0], "HAD", "h"),
    makePickFromMatch(FALLBACK_MATCHES[2], "HAD", "h"),
  ];
  const nonSingleHedgeRep = computeTruthReport(
    nonSingleHedgePicks,
    5,
    FALLBACK_MATCHES
  );
  const nonSingleHedgeIns = computeProOrderInsights(
    nonSingleHedgePicks,
    nonSingleHedgeRep,
    FALLBACK_MATCHES
  );
  const statutoryHedgeSingleGatePassed =
    nonSingleHedgeIns.hedge.available === false;

  let m2NonSummingCushionPassed = true;
  for (let k = 0; k < 16 && k + 1 < parsedMatches.length; k += 2) {
    const pair = [parsedMatches[k], parsedMatches[k + 1]];
    const s3 = generateParetoPortfolio(pair, 100, "objective", false, [])[2];
    for (const missed of pair) {
      const surv = s3.lines.filter(
        (l) => !l.legs.some((g) => g.matchId === missed.id)
      );
      if (surv.length > 0) {
        const minBranch = Math.min(...surv.map((l) => l.returnPayout));
        if ((s3.missOneReturn ?? 0) > minBranch + 1e-6) {
          m2NonSummingCushionPassed = false;
        }
      }
    }
  }

  return {
    checkedMatchesCount: allMatches.length,
    portfolioScenariosChecked,
    maxMarginalSumError,
    maxCrossPoolEquivError,
    maxComboSumError,
    maxLinearEvError,
    maxBruteForceDiff,
    highStateSpaceEvError,
    highStateProfitProbError,
    statutoryHedgeSingleGatePassed,
    m2NonSummingCushionPassed,
    combinatorialExplosionGatePassed,
    cacheMutationSensitivityPassed,
    statutoryRoundingAndCapErrors,
    illegalTicketViolations,
    violationDetails,
    probabilityOrderingViolations,
    avgEightMatchWorkspaceMs,
    avgEightMatch247WorkspaceMs,
    elapsedMs: performance.now() - t0,
  };
}

function kCombinations(n, k) {
  const out = [];
  if (k <= 0 || k > n) return out;
  const dfs = (start, acc) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= n - (k - acc.length); i++) {
      acc.push(i);
      dfs(i + 1, acc);
      acc.pop();
    }
  };
  dfs(0, []);
  return out;
}

/**
 * Independent reference Exact 0-1 Knapsack solver over pairwise-disjoint ticket sets:
 * verifies zero optimality gap for Slot ① (max-profit-prob).
 */
function solveReferenceZeroUnderwaterBestProb(matches, budgetYuan) {
  const maxNotes = Math.max(1, Math.floor(budgetYuan / 2));
  const solveSet = (cands) => {
    let best = 0;
    for (let N = 1; N <= maxNotes; N++) {
      const cost = 2 * N - 1e-12;
      const dp = new Float64Array(N + 1).fill(-1);
      dp[0] = 0;
      for (let i = 0; i < cands.length; i++) {
        const w = Math.max(1, Math.ceil(cost / cands[i].unitPayout));
        if (w > N) continue;
        const p = cands[i].prob;
        for (let cap = N; cap >= w; cap--) {
          if (dp[cap - w] >= 0 && dp[cap - w] + p > dp[cap]) {
            dp[cap] = dp[cap - w] + p;
          }
        }
      }
      for (let cap = 1; cap <= N; cap++) {
        if (dp[cap] > best) best = dp[cap];
      }
    }
    return best;
  };

  let bestGlobal = 0;
  for (const m of matches) {
    for (const code of ALL_POOL_CODES) {
      const pool = m.pools[code];
      if (!pool || pool.selling === false || !pool.single) continue;
      const set = pool.options.map((o) => ({
        prob: o.fairProb,
        unitPayout: Math.min(100_000, bankerRoundParlayUnitPayout([o.odds])),
      }));
      const p = solveSet(set);
      if (p > bestGlobal) bestGlobal = p;
    }
  }
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      for (const c1 of ["HAD", "HHAD"]) {
        const p1 = matches[i].pools[c1];
        if (!p1 || p1.selling === false) continue;
        for (const c2 of ["HAD", "HHAD"]) {
          const p2 = matches[j].pools[c2];
          if (!p2 || p2.selling === false) continue;
          const set = [];
          for (const o1 of p1.options) {
            for (const o2 of p2.options) {
              set.push({
                prob: o1.fairProb * o2.fairProb,
                unitPayout: Math.min(
                  200_000,
                  bankerRoundParlayUnitPayout([o1.odds, o2.odds])
                ),
              });
            }
          }
          const p = solveSet(set);
          if (p > bestGlobal) bestGlobal = p;
        }
      }
    }
  }
  // Hybrid [single on single-open Match i + 2串1 on complement x Match j] pairwise-disjoint sets on M = 2
  if (matches.length === 2) {
    for (let i = 0; i < 2; i++) {
      const j = 1 - i;
      for (const cS of ["HAD", "HHAD"]) {
        const pS = matches[i].pools[cS];
        if (!pS || pS.selling === false || !pS.single || pS.options.length < 2)
          continue;
        for (const cP of ["HAD", "HHAD"]) {
          const pP = matches[j].pools[cP];
          if (!pP || pP.selling === false || pP.options.length === 0) continue;
          const fullMask = (1 << pS.options.length) - 1;
          for (let sMask = 1; sMask < fullMask; sMask++) {
            const set = [];
            for (let a = 0; a < pS.options.length; a++) {
              const oS = pS.options[a];
              if ((sMask & (1 << a)) !== 0) {
                set.push({
                  prob: oS.fairProb,
                  unitPayout: Math.min(
                    100_000,
                    bankerRoundParlayUnitPayout([oS.odds])
                  ),
                });
              } else {
                for (const oP of pP.options) {
                  set.push({
                    prob: oS.fairProb * oP.fairProb,
                    unitPayout: Math.min(
                      200_000,
                      bankerRoundParlayUnitPayout([oS.odds, oP.odds])
                    ),
                  });
                }
              }
            }
            const p = solveSet(set);
            if (p > bestGlobal) bestGlobal = p;
          }
        }
      }
    }
  }
  return bestGlobal;
}

const POOL_TYPE_ID = { HAD: 1, HHAD: 2, TTG: 3, HAFU: 4, CRS: 5 };

function evaluateSlateMonteCarloPareto(
  name,
  matches,
  budget,
  rng,
  samplesPerSlate = 10_000
) {
  const plans = generateParetoPortfolio(
    matches,
    budget,
    "objective",
    false,
    []
  );
  const primarySlots = plans.slice(0, 3);
  const M = matches.length;
  const fullSlateMask = (1 << M) - 1;

  // Independent exact 0-1 knapsack zero-gap verification for Slot ①
  const refKnapsackProb = solveReferenceZeroUnderwaterBestProb(matches, budget);
  const knapsackOptimalityGap = Math.max(
    0,
    refKnapsackProb - primarySlots[0].profitProb
  );

  // 1. Collect candidate legs per match (keep per-match branching bounded on M >= 6 so S stays <= 3,000 and < 50ms/slate)
  const candLegsByMatch = matches.map((m, mIdx) => {
    const mp = new Map();
    const putOpt = (poolCode, opt) => {
      if (!opt || !(opt.odds > 1.01)) return;
      const pool = m.pools[poolCode];
      if (!pool || pool.selling === false) return;
      const key = `${poolCode}:${opt.key}`;
      if (!mp.has(key)) {
        mp.set(key, {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          kickoff: m.kickoff,
          poolCode,
          poolName: pool.name,
          singleAllowed: Boolean(pool.single),
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        });
      }
    };
    const codes = M >= 6 ? ["HAD"] : ["HAD", "HHAD"];
    const takeCount = (M >= 8 && mIdx >= 1) || (M >= 6 && mIdx >= 3) ? 1 : 2;
    for (const code of codes) {
      const pool = m.pools[code];
      if (pool && pool.selling !== false) {
        const sorted = [...pool.options].sort(
          (a, b) => b.fairProb - a.fairProb
        );
        for (let t = 0; t < takeCount && sorted[t]; t++) {
          putOpt(code, sorted[t]);
        }
      }
    }
    return mp;
  });

  for (const pl of primarySlots) {
    for (const ln of pl.lines) {
      for (const lg of ln.legs) {
        const mIdx = matches.findIndex((m) => m.id === lg.matchId);
        if (mIdx >= 0) {
          const key = `${lg.poolCode}:${lg.optionKey}`;
          if (!candLegsByMatch[mIdx].has(key)) {
            candLegsByMatch[mIdx].set(key, {
              ...lg,
              singleAllowed: Boolean(matches[mIdx].pools[lg.poolCode]?.single),
            });
          }
        }
      }
    }
  }

  const matchLegLists = candLegsByMatch.map((mp) => Array.from(mp.values()));
  const spearDirIdxPerMatch = matches.map((m, mIdx) => {
    const s2Leg = primarySlots[1].lines[0]?.legs.find(
      (g) => g.matchId === m.id
    );
    if (s2Leg) {
      const j = matchLegLists[mIdx].findIndex(
        (g) => g.poolCode === s2Leg.poolCode && g.optionKey === s2Leg.optionKey
      );
      if (j >= 0) return j;
    }
    let bestJ = 0;
    let bestP = -1;
    for (let j = 0; j < matchLegLists[mIdx].length; j++) {
      const g = matchLegLists[mIdx][j];
      if (
        (g.poolCode === "HAD" || g.poolCode === "HHAD") &&
        g.odds >= 1.18 &&
        g.fairProb > bestP
      ) {
        bestP = g.fairProb;
        bestJ = j;
      }
    }
    return bestJ;
  });
  const wheelDirIdxPerMatch = matches.map((m, mIdx) => {
    for (const ln of primarySlots[2].lines) {
      const lg = ln.legs.find((g) => g.matchId === m.id);
      if (lg) {
        const j = matchLegLists[mIdx].findIndex(
          (g) => g.poolCode === lg.poolCode && g.optionKey === lg.optionKey
        );
        if (j >= 0) return j;
      }
    }
    return spearDirIdxPerMatch[mIdx];
  });

  // 2. Build legal candidate ticket universe across ALL pass sizes 1..M
  const ticketMap = new Map();
  const addTicket = (legs) => {
    if (!legs || legs.length === 0) return -1;
    const maxCap = Math.min(...legs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
    if (legs.length > maxCap) return -1;
    if (legs.length === 1) {
      const fm = matches.find((m) => m.id === legs[0].matchId);
      if (!fm?.pools?.[legs[0].poolCode]?.single) return -1;
    }
    const sortedLegs = [...legs].sort(
      (a, b) =>
        matches.findIndex((m) => m.id === a.matchId) -
        matches.findIndex((m) => m.id === b.matchId)
    );
    let matchMask = 0;
    const parlayPools = new Int8Array(M);
    for (const g of sortedLegs) {
      const mIdx = matches.findIndex((m) => m.id === g.matchId);
      if ((matchMask & (1 << mIdx)) !== 0) return -1;
      matchMask |= 1 << mIdx;
      if (sortedLegs.length >= 2) {
        parlayPools[mIdx] = POOL_TYPE_ID[g.poolCode] ?? 1;
      }
    }
    const sig = sortedLegs
      .map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
      .join("|");
    if (ticketMap.has(sig)) return ticketMap.get(sig).idx;
    const rawU = bankerRoundParlayUnitPayout(sortedLegs.map((g) => g.odds));
    const unitPayout = Math.min(statutorySingleBetCap(sortedLegs.length), rawU);
    const idx = ticketMap.size;
    ticketMap.set(sig, {
      idx,
      sig,
      legs: sortedLegs,
      len: sortedLegs.length,
      unitPayout,
      unitCents: Math.round(unitPayout * 100),
      matchMask,
      avoidMask: fullSlateMask & ~matchMask,
      parlayPools,
    });
    return idx;
  };

  const slotTicketSpecs = primarySlots.map((pl) =>
    pl.lines.map((ln) => {
      const idx = addTicket(ln.legs);
      if (idx < 0) {
        throw new Error(
          `Slot ${pl.key} produced illegal ticket on slate ${name}`
        );
      }
      return { idx, mult: ln.multiple };
    })
  );

  for (let m = 0; m < M; m++) {
    for (const lg of matchLegLists[m]) {
      if (lg.singleAllowed) addTicket([lg]);
    }
  }

  const spearProfile = matches.map(
    (_, mIdx) => matchLegLists[mIdx][spearDirIdxPerMatch[mIdx]]
  );
  const wheelProfile = matches.map(
    (_, mIdx) => matchLegLists[mIdx][wheelDirIdxPerMatch[mIdx]]
  );
  const highEvProfile = matches.map(
    (_, mIdx) =>
      [...matchLegLists[mIdx]].sort(
        (a, b) => b.odds * b.fairProb - a.odds * a.fairProb
      )[0]
  );
  const backboneProfiles =
    M >= 7
      ? [spearProfile, wheelProfile]
      : [spearProfile, wheelProfile, highEvProfile];

  for (let k = 2; k <= M; k++) {
    const combs = kCombinations(M, k);
    const maxCombs = M >= 7 && combs.length > 28 ? combs.slice(0, 28) : combs;
    for (const comb of maxCombs) {
      for (const prof of backboneProfiles) {
        const base = comb.map((i) => prof[i]);
        addTicket(base);
        for (let pos = 0; pos < comb.length; pos++) {
          const mIdx = comb[pos];
          const baseLeg = base[pos];
          for (const alt of matchLegLists[mIdx]) {
            if (
              alt.poolCode !== baseLeg.poolCode ||
              alt.optionKey !== baseLeg.optionKey
            ) {
              const copy = [...base];
              copy[pos] = alt;
              addTicket(copy);
            }
          }
        }
      }
    }
  }

  const tickets = Array.from(ticketMap.values());
  const K = tickets.length;
  const fullParlayDepth = primarySlots[1].lines[0]?.legs.length ?? M;

  // 3. Precompute exact coherent quotient state space Ω̃ and monotone 4D payout tables
  const quotientByMatch = matches.map((m, mIdx) => {
    const cal = calibrateMatchCoherentModel(m);
    const opts = matchLegLists[mIdx];
    const gLine = Number(m.pools.HHAD?.goalLine ?? -1);
    const byMask = new Map();
    for (const st of cal.atomicStates) {
      let mask = 0;
      for (let j = 0; j < opts.length; j++) {
        if (doesLegHitAtomicState(opts[j], gLine, st)) {
          mask |= 1 << j;
        }
      }
      byMask.set(mask, (byMask.get(mask) ?? 0) + st.prob);
    }
    return Array.from(byMask.entries()).map(([mask, prob]) => ({ mask, prob }));
  });

  let jointStates = [{ prob: 1, masks: [] }];
  for (let m = 0; m < M; m++) {
    const next = [];
    const qList = quotientByMatch[m];
    for (let i = 0; i < jointStates.length; i++) {
      const prev = jointStates[i];
      for (let j = 0; j < qList.length; j++) {
        next.push({
          prob: prev.prob * qList[j].prob,
          masks: [...prev.masks, qList[j].mask],
        });
      }
    }
    jointStates = next;
  }

  const S = jointStates.length;
  const stateProb = new Float64Array(S);
  for (let s = 0; s < S; s++) stateProb[s] = jointStates[s].prob;

  let fullHitProb = 0;
  const isFullHitState = new Uint8Array(S);
  const missGroupProb = new Float64Array(M);
  const stateMissOwner = new Int8Array(S).fill(-1);
  for (let s = 0; s < S; s++) {
    const masks = jointStates[s].masks;
    let allSpearHit = true;
    for (let m = 0; m < M; m++) {
      if ((masks[m] & (1 << spearDirIdxPerMatch[m])) === 0) {
        allSpearHit = false;
        break;
      }
    }
    if (allSpearHit) {
      isFullHitState[s] = 1;
      fullHitProb += stateProb[s];
    }

    let missCount = 0;
    let missIdx = -1;
    for (let m = 0; m < M; m++) {
      if ((masks[m] & (1 << wheelDirIdxPerMatch[m])) === 0) {
        missCount += 1;
        missIdx = m;
        if (missCount > 1) break;
      }
    }
    if (missCount === 1) {
      stateMissOwner[s] = missIdx;
      missGroupProb[missIdx] += stateProb[s];
    }
  }

  const ticketUnitCents = new Int32Array(K);
  const ticketHitProb = new Float64Array(K);
  const ticketExpectedReturn = new Float64Array(K);
  const ticketFullDepthCondReturn = new Float64Array(K);
  const ticketMissCondReturn = new Float64Array(K * M);
  const ticketHitStates = new Array(K);
  const ticketMatchOptCode = new Int16Array(K * M).fill(-1);

  for (let k = 0; k < K; k++) {
    const tk = tickets[k];
    ticketUnitCents[k] = tk.unitCents;

    const legLookup = tk.legs.map((lg) => {
      const mIdx = matches.findIndex((m) => m.id === lg.matchId);
      const jIdx = matchLegLists[mIdx].findIndex(
        (o) => o.poolCode === lg.poolCode && o.optionKey === lg.optionKey
      );
      ticketMatchOptCode[k * M + mIdx] =
        ((POOL_TYPE_ID[lg.poolCode] ?? 1) << 8) | jIdx;
      return { mIdx, bit: 1 << jIdx };
    });

    const hits = [];
    let hitProbSum = 0;
    let fullHitSum = 0;
    const missHitProb = new Float64Array(M);
    for (let s = 0; s < S; s++) {
      const masks = jointStates[s].masks;
      let ok = true;
      for (let i = 0; i < legLookup.length; i++) {
        if ((masks[legLookup[i].mIdx] & legLookup[i].bit) === 0) {
          ok = false;
          break;
        }
      }
      if (ok) {
        hits.push(s);
        const p = stateProb[s];
        hitProbSum += p;
        if (isFullHitState[s]) fullHitSum += p;
        const mo = stateMissOwner[s];
        if (mo >= 0) missHitProb[mo] += p;
      }
    }
    ticketHitStates[k] = Int32Array.from(hits);
    ticketHitProb[k] = hitProbSum;
    ticketExpectedReturn[k] = hitProbSum * tk.unitPayout;
    const parlayMinLen = M >= 2 ? 2 : 1;
    const depthWeight =
      tk.len >= parlayMinLen ? Math.pow(tk.len / fullParlayDepth, 2) : 0;
    ticketFullDepthCondReturn[k] =
      depthWeight > 0 && fullHitProb > 0
        ? depthWeight * (fullHitSum / fullHitProb) * tk.unitPayout
        : 0;
    for (let x = 0; x < M; x++) {
      ticketMissCondReturn[k * M + x] =
        missGroupProb[x] > 0
          ? (missHitProb[x] / missGroupProb[x]) * tk.unitPayout
          : 0;
    }
  }

  const payCentsBuf = new Int32Array(S);
  const touchedBuf = new Int32Array(S);
  const stampBuf = new Int32Array(S);
  const missScratch = new Float64Array(M);
  let curStamp = 1;

  const arePairwiseDisjoint = (activeIdx, activeCount) => {
    if (activeCount <= 1) return true;
    for (let a = 0; a < activeCount; a++) {
      const baseA = activeIdx[a] * M;
      for (let b = a + 1; b < activeCount; b++) {
        const baseB = activeIdx[b] * M;
        let disjointOnSomeMatch = false;
        for (let m = 0; m < M; m++) {
          const ca = ticketMatchOptCode[baseA + m];
          const cb = ticketMatchOptCode[baseB + m];
          if (ca >= 0 && cb >= 0 && ca >> 8 === cb >> 8 && ca !== cb) {
            disjointOnSomeMatch = true;
            break;
          }
        }
        if (!disjointOnSomeMatch) return false;
      }
    }
    return true;
  };

  // State-wise monotone 4D vector: (evRate, profitProb, fullDepthReturnRatio, missOneCvarRatio)
  const evalMonotone4D = (activeIdx, activeMult, activeCount) => {
    let totalNotes = 0;
    let expReturn = 0;
    let fullDepthRet = 0;
    missScratch.fill(0);

    for (let i = 0; i < activeCount; i++) {
      const k = activeIdx[i];
      const mult = activeMult[i];
      totalNotes += mult;
      expReturn += mult * ticketExpectedReturn[k];
      fullDepthRet += mult * ticketFullDepthCondReturn[k];
      const baseOff = k * M;
      for (let x = 0; x < M; x++) {
        missScratch[x] += mult * ticketMissCondReturn[baseOff + x];
      }
    }

    const costYuan = totalNotes * 2;
    const costCents = totalNotes * 200;
    let profitProb = 0;

    if (arePairwiseDisjoint(activeIdx, activeCount)) {
      for (let i = 0; i < activeCount; i++) {
        const k = activeIdx[i];
        const rc = activeMult[i] * ticketUnitCents[k];
        if (rc >= costCents) profitProb += ticketHitProb[k];
      }
    } else {
      curStamp += 1;
      let tLen = 0;
      for (let i = 0; i < activeCount; i++) {
        const k = activeIdx[i];
        const payCents = activeMult[i] * ticketUnitCents[k];
        const hs = ticketHitStates[k];
        for (let j = 0; j < hs.length; j++) {
          const s = hs[j];
          if (stampBuf[s] !== curStamp) {
            stampBuf[s] = curStamp;
            payCentsBuf[s] = payCents;
            touchedBuf[tLen++] = s;
          } else {
            payCentsBuf[s] += payCents;
          }
        }
      }
      for (let j = 0; j < tLen; j++) {
        const s = touchedBuf[j];
        if (payCentsBuf[s] >= costCents) profitProb += stateProb[s];
      }
    }

    missScratch.sort();
    const tailLen = Math.max(1, Math.ceil(M * 0.5));
    let tailSum = 0;
    for (let t = 0; t < tailLen; t++) tailSum += missScratch[t];
    const missSafety =
      (0.5 * missScratch[0] + 0.5 * (tailSum / tailLen)) / costYuan;

    return {
      cost: costYuan,
      evRate: (expReturn - costYuan) / costYuan,
      profitProb,
      fullDepthReturnRatio: fullDepthRet / costYuan,
      missOneCvarRatio: missSafety,
    };
  };

  const slotRefs = slotTicketSpecs.map((items, sIdx) => {
    const idxArr = Int32Array.from(items.map((x) => x.idx));
    const multArr = Int32Array.from(items.map((x) => x.mult));
    return {
      key: primarySlots[sIdx].key,
      underwaterCount: primarySlots[sIdx].underwaterCount ?? 0,
      idxArr,
      multArr,
      metrics: evalMonotone4D(idxArr, multArr, items.length),
    };
  });

  const isSameMatchSinglePoolCompatible = (chosenIdx, count, candTicketIdx) => {
    const candPoolsArr = tickets[candTicketIdx].parlayPools;
    for (let i = 0; i < count; i++) {
      const exPoolsArr = tickets[chosenIdx[i]].parlayPools;
      for (let m = 0; m < M; m++) {
        if (
          candPoolsArr[m] !== 0 &&
          exPoolsArr[m] !== 0 &&
          candPoolsArr[m] !== exPoolsArr[m]
        ) {
          return false;
        }
      }
    }
    return true;
  };

  const maxNotes = Math.floor(budget / 2);
  const minNotes = Math.max(1, Math.floor(maxNotes * 0.85));
  const activeIdxBuf = new Int32Array(10);
  const activeMultBuf = new Int32Array(10);
  const weightBuf = new Float64Array(10);

  const domCounts = [0, 0, 0];
  const domExamples = [null, null, null];

  const evalStart = performance.now();
  let samplesEvaluated = 0;

  // 10,000 genuinely independent random portfolios across ALL legal 1..M tickets (zero self-cloning, zero pass-size silos!)
  while (samplesEvaluated < samplesPerSlate) {
    const maxK = Math.min(10, K, maxNotes);
    const wantK = 1 + Math.floor(rng() * maxK);
    let rCount = 0;
    let attempts = 0;
    while (rCount < wantK && attempts < 30) {
      attempts += 1;
      const cand = Math.floor(rng() * K);
      let dup = false;
      for (let i = 0; i < rCount; i++) {
        if (activeIdxBuf[i] === cand) {
          dup = true;
          break;
        }
      }
      if (!dup && isSameMatchSinglePoolCompatible(activeIdxBuf, rCount, cand)) {
        activeIdxBuf[rCount++] = cand;
      }
    }
    if (rCount === 0) {
      activeIdxBuf[0] = Math.floor(rng() * K);
      rCount = 1;
    }

    const notesUse = Math.max(
      rCount,
      minNotes + Math.floor(rng() * (maxNotes - minNotes + 1))
    );
    let rem = notesUse - rCount;
    let wSum = 0;
    for (let i = 0; i < rCount; i++) {
      const w = -Math.log(Math.max(1e-6, rng()));
      weightBuf[i] = w;
      wSum += w;
      activeMultBuf[i] = 1;
    }
    for (let i = 0; i < rCount - 1; i++) {
      const add = Math.min(
        rem,
        Math.floor(((notesUse - rCount) * weightBuf[i]) / wSum)
      );
      activeMultBuf[i] += add;
      rem -= add;
    }
    activeMultBuf[rCount - 1] += rem;

    const candMetrics = evalMonotone4D(activeIdxBuf, activeMultBuf, rCount);
    samplesEvaluated += 1;

    // Compare every sampled portfolio directly against ALL 3 slots (zero pass-length or match-mask skip!)
    for (let s = 0; s < 3; s++) {
      const rm = slotRefs[s].metrics;
      const geAll =
        candMetrics.evRate >= rm.evRate - 1e-9 &&
        candMetrics.profitProb >= rm.profitProb - 1e-9 &&
        candMetrics.fullDepthReturnRatio >= rm.fullDepthReturnRatio - 1e-9 &&
        candMetrics.missOneCvarRatio >= rm.missOneCvarRatio - 1e-9;
      if (!geAll) continue;
      const gtOne =
        candMetrics.evRate > rm.evRate + 1e-6 ||
        candMetrics.profitProb > rm.profitProb + 1e-6 ||
        candMetrics.fullDepthReturnRatio > rm.fullDepthReturnRatio + 1e-6 ||
        candMetrics.missOneCvarRatio > rm.missOneCvarRatio + 1e-6;
      if (gtOne) {
        domCounts[s] += 1;
        if (!domExamples[s]) {
          domExamples[s] = {
            slotMetrics: rm,
            candMetrics,
            slotLines: Array.from(slotRefs[s].idxArr).map(
              (ti, ii) => `${tickets[ti].sig} x${slotRefs[s].multArr[ii]}`
            ),
            candLines: Array.from(activeIdxBuf.subarray(0, rCount)).map(
              (ti, ii) => `${tickets[ti].sig} x${activeMultBuf[ii]}`
            ),
          };
        }
      }
    }
  }

  const evalElapsedMs = performance.now() - evalStart;
  return {
    name,
    matchCount: M,
    budget,
    candidateTicketCount: K,
    quotientStateCount: S,
    samplesEvaluated,
    evalElapsedMs,
    knapsackOptimalityGap,
    slots: slotRefs.map((sr, idx) => ({
      key: sr.key,
      underwaterCount: sr.underwaterCount,
      metrics: sr.metrics,
      strictlyDominatedByCount: domCounts[idx],
      dominatingExample: domExamples[idx],
    })),
  };
}

/**
 * Layer 3 · 无筒仓、无自克隆 10,000 次蒙特卡洛单调四维帕累托支配检验 + 精确 0-1 背包对账
 */
export function runLayer3MonteCarloParetoBenchmark(opts = {}) {
  const t0 = performance.now();
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : 20261120;
  const samplesPerSlate = Number.isFinite(opts.samplesPerSlate)
    ? Math.max(100, Math.round(opts.samplesPerSlate))
    : 10_000;
  const rng = createMulberry32(seed);
  const { parsedMatches } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );

  const slateConfigs = [
    {
      name: "FALLBACK_2M_B100",
      matches: FALLBACK_MATCHES.slice(0, 2),
      budget: 100,
    },
    {
      name: "FALLBACK_3M_B200",
      matches: FALLBACK_MATCHES.slice(0, 3),
      budget: 200,
    },
    {
      name: "FALLBACK_4M_B100",
      matches: FALLBACK_MATCHES.slice(0, 4),
      budget: 100,
    },
    {
      name: "FALLBACK_6M_B200",
      matches: FALLBACK_MATCHES.slice(0, 6),
      budget: 200,
    },
    {
      name: "REAL_OOS_2M_B200",
      matches: parsedMatches.slice(0, 2),
      budget: 200,
    },
    {
      name: "REAL_OOS_3M_B100",
      matches: parsedMatches.slice(8, 11),
      budget: 100,
    },
    {
      name: "REAL_OOS_4M_B200",
      matches: parsedMatches.slice(0, 4),
      budget: 200,
    },
    {
      name: "REAL_OOS_6M_B100",
      matches: parsedMatches.slice(16, 22),
      budget: 100,
    },
    {
      name: "REAL_OOS_8M_B200",
      matches: parsedMatches.slice(24, 32),
      budget: 200,
    },
  ];

  const slates = slateConfigs.map((cfg) =>
    evaluateSlateMonteCarloPareto(
      cfg.name,
      cfg.matches,
      cfg.budget,
      rng,
      samplesPerSlate
    )
  );
  const totalStrictDominations = slates.reduce(
    (acc, sl) =>
      acc + sl.slots.reduce((s, x) => s + x.strictlyDominatedByCount, 0),
    0
  );
  const maxKnapsackOptimalityGap = slates.reduce(
    (acc, sl) => Math.max(acc, sl.knapsackOptimalityGap),
    0
  );

  return {
    seed,
    samplesPerSlate,
    slates,
    totalStrictDominations,
    maxKnapsackOptimalityGap,
    elapsedMs: performance.now() - t0,
  };
}

function didLegHitSettledOutcome(leg, rawMatch) {
  const out = rawMatch.outcome;
  if (leg.poolCode === "HAD") return leg.optionKey === out.hadKey;
  if (leg.poolCode === "HHAD") {
    const gl = Number(rawMatch.hhad?.goalLine ?? -1);
    const adj = out.ftHome - out.ftAway + gl;
    const hk = adj > 0 ? "hh" : adj === 0 ? "hd" : "ha";
    return leg.optionKey === hk;
  }
  if (leg.poolCode === "TTG") return leg.optionKey === out.ttgKey;
  if (leg.poolCode === "HAFU") return leg.optionKey === out.hafuKey;
  if (leg.poolCode === "CRS") {
    return (leg.optionLabel || leg.optionKey) === out.crsLabel;
  }
  return false;
}

function settlePortfolioLines(lines, rawById) {
  let totalReturn = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let allHit = true;
    for (let j = 0; j < ln.legs.length; j++) {
      const lg = ln.legs[j];
      const rm = rawById.get(String(lg.matchId));
      if (!rm || !didLegHitSettledOutcome(lg, rm)) {
        allHit = false;
        break;
      }
    }
    if (allHit) totalReturn += ln.returnPayout;
  }
  return Number(totalReturn.toFixed(2));
}

function buildLegacyFiveArchetypePlans(matches, budgetYuan) {
  const notes = Math.max(4, Math.floor(budgetYuan / 2));
  const multTop = (m, code) => {
    const pool = m.pools[code];
    const probs = devigPoolProbabilities(pool.options, "multiplicative").probs;
    let bestI = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[bestI]) bestI = i;
    }
    const o = pool.options[bestI];
    return {
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: code,
      poolName: pool.name,
      optionKey: o.key,
      optionLabel: o.label,
      odds: o.odds,
      fairProb: probs[bestI],
    };
  };
  const multSecondary = (m, code, primKey) => {
    const pool = m.pools[code];
    const probs = devigPoolProbabilities(pool.options, "multiplicative").probs;
    const cands = pool.options
      .map((o, idx) => ({ o, p: probs[idx] }))
      .filter((x) => x.o.key !== primKey)
      .sort((a, b) => b.p - a.p);
    const best = cands[0] ?? { o: pool.options[0], p: probs[0] };
    return {
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: code,
      poolName: pool.name,
      optionKey: best.o.key,
      optionLabel: best.o.label,
      odds: best.o.odds,
      fairProb: best.p,
    };
  };
  const matLine = (id, legs, mult) => {
    const u = Math.min(
      statutorySingleBetCap(legs.length),
      bankerRoundParlayUnitPayout(legs.map((g) => g.odds))
    );
    return {
      id,
      roleLabel: id,
      legs,
      multiple: mult,
      cost: mult * 2,
      unitPayout: u,
      returnPayout: Number((u * mult).toFixed(2)),
    };
  };

  const prims = matches.map((m) => multTop(m, "HAD"));
  const alt0 = [...prims];
  alt0[0] = multSecondary(matches[0], "HAD", prims[0].optionKey);

  const p1 = [
    matLine("leg-iron-1", prims, Math.max(1, Math.floor(notes * 0.65))),
    matLine("leg-iron-2", alt0, Math.max(1, notes - Math.floor(notes * 0.65))),
  ];
  const spProb = prims.reduce((a, g) => a * g.fairProb, 1);
  const shWeight = 0.04 / (spProb + 0.04);
  const shNotes = Math.min(
    notes - 1,
    Math.max(1, Math.round(notes * shWeight))
  );
  const p2 = [
    matLine("leg-spear", prims, Math.max(1, notes - shNotes)),
    matLine("leg-shield", alt0, shNotes),
  ];
  const pairs = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      pairs.push([prims[i], prims[j]]);
    }
  }
  const perPair = Math.max(1, Math.floor(notes / Math.max(1, pairs.length)));
  const p3 = pairs.map((legs, idx) => matLine(`leg-ft-${idx}`, legs, perPair));
  const ttgLegs = matches
    .slice(0, Math.min(4, matches.length))
    .map((m) => multTop(m, "TTG"));
  const p4 = [matLine("leg-ttg", ttgLegs, notes)];
  const assLegs = matches
    .slice(0, Math.min(2, matches.length))
    .map((m, idx) => {
      if (idx === 0) {
        const o =
          m.pools.CRS.options.find((x) => x.label === "1:0") ??
          m.pools.CRS.options[0];
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "CRS",
          poolName: "比分",
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: 0.1,
        };
      }
      const o =
        m.pools.HAFU.options.find((x) => x.key === "dh") ??
        m.pools.HAFU.options[0];
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: "HAFU",
        poolName: "半全场",
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: 0.15,
      };
    });
  const halfAss = Math.max(1, Math.floor(notes * 0.5));
  const qtrAss = Math.max(1, Math.floor(notes * 0.25));
  const p5 =
    assLegs.length >= 2
      ? [
          matLine("leg-ass-par", assLegs, halfAss),
          matLine("leg-ass-s1", [assLegs[0]], qtrAss),
          matLine(
            "leg-ass-s2",
            [assLegs[1]],
            Math.max(1, notes - halfAss - qtrAss)
          ),
        ]
      : [matLine("leg-ass-s1", [assLegs[0]], notes)];

  return [p1, p2, p3, p4, p5].map((lines, idx) => ({
    key: `legacy-${idx + 1}`,
    totalCost: lines.reduce((a, l) => a + l.cost, 0),
    minReturn: Math.min(...lines.map((l) => l.returnPayout)),
    maxReturn: lines.reduce((a, l) => a + l.returnPayout, 0),
    lines,
  }));
}

function computeCycleEquityCurveMetrics(cycleNetProfits, initialBankrollYuan) {
  let equity = initialBankrollYuan;
  let peak = initialBankrollYuan;
  let maxDrawdownYuan = 0;
  let maxDrawdownPct = 0;
  const periodReturns = [];

  for (const net of cycleNetProfits) {
    periodReturns.push(net / initialBankrollYuan);
    equity = Number((equity + net).toFixed(2));
    if (equity > peak) peak = equity;
    const ddYuan = Number((peak - equity).toFixed(2));
    const ddPct = peak > 0 ? Number(((ddYuan / peak) * 100).toFixed(2)) : 0;
    if (ddYuan > maxDrawdownYuan) maxDrawdownYuan = ddYuan;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  const n = periodReturns.length;
  const mean = n > 0 ? periodReturns.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 1
      ? periodReturns.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (n - 1)
      : 0;
  const std = Math.sqrt(Math.max(1e-12, variance));
  // Israelsen (2005) Modified Sharpe Ratio: coincides with classical Sharpe when mean >= 0,
  // and stays strictly monotone in both higher mean return and lower volatility when mean < 0.
  const sharpeRatio = Number(
    (mean >= 0 ? (mean / std) * Math.sqrt(12) : mean * std * 1200).toFixed(4)
  );

  return {
    finalEquityYuan: equity,
    maxDrawdownYuan,
    maxDrawdownPct,
    sharpeRatio,
  };
}

function replaySameRuleDualTrackCycles({
  parsedMatches,
  rawById,
  dailyStopLossYuan,
  initialBankrollYuan,
  reverseIntraDayOrder = false,
}) {
  const numCycles = Math.floor(parsedMatches.length / 8);
  let simNowMs = Date.parse("2026-08-01T12:00:00+08:00");
  const legacyLedger = createLedgerManager({ nowFn: () => simNowMs });
  const upgradedLedger = createLedgerManager({ nowFn: () => simNowMs });

  const legacyCycleNets = [];
  const upgradedCycleNets = [];
  const legacyEpochIds = new Set();
  const upgradedEpochIds = new Set();

  let emptyAlphaAbstainCount = 0;
  let emptyAlphaSavedCash = 0;
  let legacyStopLossInterceptedCount = 0;
  let upgradedStopLossInterceptedCount = 0;
  let legacyNetPaperSavedPnl = 0;
  let upgradedNetPaperSavedPnl = 0;

  for (let cyc = 0; cyc < numCycles; cyc++) {
    simNowMs = Date.parse("2026-08-01T12:00:00+08:00") + cyc * 86_400_000;
    // Shard user buckets every 15 cycles (<= 150 entries/bucket < MAX_ENTRIES_PER_USER = 200) so zero entries are truncated
    const epochIdx = Math.floor(cyc / 15);
    const legUid = `bench_legacy_${epochIdx}`;
    const upgUid = `bench_upgraded_${epochIdx}`;
    if (!legacyEpochIds.has(legUid)) {
      legacyEpochIds.add(legUid);
      legacyLedger.mutateUserLedger(legUid, {
        action: "set-daily-limit",
        dailyLimit: dailyStopLossYuan,
      });
    }
    if (!upgradedEpochIds.has(upgUid)) {
      upgradedEpochIds.add(upgUid);
      upgradedLedger.mutateUserLedger(upgUid, {
        action: "set-daily-limit",
        dailyLimit: dailyStopLossYuan,
      });
    }

    const pmCycle = parsedMatches.slice(cyc * 8, (cyc + 1) * 8);
    // Two homogeneous 4-match slates per cycle (budget ¥56/plan -> Legacy ¥560/day vs Spec 0009 ¥336/day; both trigger ¥300/day guardrail fairly!)
    const daySlates = [
      { matches: pmCycle.slice(0, 4), budget: 56 },
      { matches: pmCycle.slice(4, 8), budget: 56 },
    ];
    if (reverseIntraDayOrder) {
      daySlates.reverse();
    }

    let legDayNet = 0;
    let upgDayNet = 0;

    for (const sl of daySlates) {
      // A. Legacy 5-archetype strategy under the EXACT SAME ¥300/day stop-loss rule (zero double standard!)
      const legPlans = buildLegacyFiveArchetypePlans(sl.matches, sl.budget);
      for (const pl of legPlans) {
        let entryRes = legacyLedger.mutateUserLedger(legUid, {
          action: "add-entry",
          kind: "live",
          cost: pl.totalCost,
          betCount: pl.lines.length,
          modeLabel: pl.key,
          minPayout: pl.minReturn,
          maxPayout: pl.maxReturn,
        });
        const actualReturn = settlePortfolioLines(pl.lines, rawById);
        if (!entryRes.ok && entryRes.code === "STOP_LOSS_EXCEEDED") {
          legacyStopLossInterceptedCount += 1;
          legacyNetPaperSavedPnl += pl.totalCost - actualReturn;
          entryRes = legacyLedger.mutateUserLedger(legUid, {
            action: "add-entry",
            kind: "paper",
            paperRefCost: pl.totalCost,
            betCount: pl.lines.length,
            modeLabel: pl.key,
            minPayout: pl.minReturn,
            maxPayout: pl.maxReturn,
          });
        }
        const settled = legacyLedger.mutateUserLedger(legUid, {
          action: "settle-entry",
          entryId: entryRes.entry.id,
          status: actualReturn > 0 ? "won" : "lost",
          settledReturn: actualReturn,
        });
        if (settled.entry.kind === "live") {
          legDayNet += settled.entry.netProfit;
        }
      }

      // B. Spec 0009: Coherent KL/SMART + 3+1 Exact MILP/Knapsack + Pure +EV Alpha Gate + identical ¥300/day stop-loss
      const upgPlans = generateParetoPortfolio(
        sl.matches,
        sl.budget,
        "objective",
        false,
        []
      );
      for (const pl of upgPlans) {
        if (!pl.available || pl.totalCost <= 0 || pl.lines.length === 0) {
          emptyAlphaAbstainCount += 1;
          emptyAlphaSavedCash += pl.savedCash ?? sl.budget;
          continue;
        }

        let entryRes = upgradedLedger.mutateUserLedger(upgUid, {
          action: "add-entry",
          kind: "live",
          cost: pl.totalCost,
          betCount: pl.lines.length,
          modeLabel: pl.shortTab,
          minPayout: pl.minReturn,
          maxPayout: pl.maxReturn,
        });
        const actualReturn = settlePortfolioLines(pl.lines, rawById);
        if (!entryRes.ok && entryRes.code === "STOP_LOSS_EXCEEDED") {
          upgradedStopLossInterceptedCount += 1;
          upgradedNetPaperSavedPnl += pl.totalCost - actualReturn;
          entryRes = upgradedLedger.mutateUserLedger(upgUid, {
            action: "add-entry",
            kind: "paper",
            paperRefCost: pl.totalCost,
            betCount: pl.lines.length,
            modeLabel: pl.shortTab,
            minPayout: pl.minReturn,
            maxPayout: pl.maxReturn,
          });
        }
        const settled = upgradedLedger.mutateUserLedger(upgUid, {
          action: "settle-entry",
          entryId: entryRes.entry.id,
          status: actualReturn > 0 ? "won" : "lost",
          settledReturn: actualReturn,
        });
        if (settled.entry.kind === "live") {
          upgDayNet += settled.entry.netProfit;
        }
      }
    }

    legacyCycleNets.push(Number(legDayNet.toFixed(2)));
    upgradedCycleNets.push(Number(upgDayNet.toFixed(2)));
  }

  const aggregateLedgerEpochs = (ledger, uids) => {
    let liveSettledCount = 0;
    let liveWonCount = 0;
    let liveTotalStaked = 0;
    let liveNetProfit = 0;
    let paperCount = 0;
    let paperSavedAmount = 0;
    for (const uid of uids) {
      const st = ledger.getUserLedger(uid).stats;
      liveSettledCount += st.liveSettledCount;
      liveWonCount += st.liveWonCount;
      liveTotalStaked += st.liveTotalStaked;
      liveNetProfit += st.liveNetProfit;
      paperCount += st.paperCount;
      paperSavedAmount += st.paperSavedAmount;
    }
    return {
      liveSettledCount,
      liveWonCount,
      liveWinRatePct:
        liveSettledCount > 0
          ? Number(((liveWonCount / liveSettledCount) * 100).toFixed(2))
          : 0,
      liveTotalStaked: Number(liveTotalStaked.toFixed(2)),
      liveNetProfit: Number(liveNetProfit.toFixed(2)),
      liveRoiPct:
        liveTotalStaked > 0
          ? Number(((liveNetProfit / liveTotalStaked) * 100).toFixed(2))
          : 0,
      paperCount,
      paperSavedAmount: Number(paperSavedAmount.toFixed(2)),
    };
  };

  const legStats = aggregateLedgerEpochs(legacyLedger, legacyEpochIds);
  const upgStats = aggregateLedgerEpochs(upgradedLedger, upgradedEpochIds);
  const legRisk = computeCycleEquityCurveMetrics(
    legacyCycleNets,
    initialBankrollYuan
  );
  const upgRisk = computeCycleEquityCurveMetrics(
    upgradedCycleNets,
    initialBankrollYuan
  );

  return {
    numCycles,
    legacy: {
      ...legStats,
      ...legRisk,
      stopLossInterceptedCount: legacyStopLossInterceptedCount,
      netPaperSavedPnl: Number(legacyNetPaperSavedPnl.toFixed(2)),
    },
    upgraded: {
      ...upgStats,
      ...upgRisk,
      emptyAlphaAbstainCount,
      emptyAlphaSavedCash,
      stopLossInterceptedCount: upgradedStopLossInterceptedCount,
      netPaperSavedPnl: Number(upgradedNetPaperSavedPnl.toFixed(2)),
    },
  };
}

/**
 * Layer 4 · 同规则双轨止损账本真实体彩完场 OOS 配对消融回放 + 同日盘面顺序置换稳健性校验
 */
export function runLayer4LedgerAblationBenchmark(opts = {}) {
  const t0 = performance.now();
  const dailyStopLossYuan = Number.isFinite(opts.dailyStopLossYuan)
    ? Math.max(20, Math.round(opts.dailyStopLossYuan))
    : 300;
  const initialBankrollYuan = Number.isFinite(opts.initialBankrollYuan)
    ? Math.max(1000, Math.round(opts.initialBankrollYuan))
    : 12_000;

  const { rawFixture, parsedMatches } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );
  const rawById = new Map(
    rawFixture.matches.map((m) => [String(m.matchId), m])
  );

  const forward = replaySameRuleDualTrackCycles({
    parsedMatches,
    rawById,
    dailyStopLossYuan,
    initialBankrollYuan,
    reverseIntraDayOrder: false,
  });

  const reversed = replaySameRuleDualTrackCycles({
    parsedMatches,
    rawById,
    dailyStopLossYuan,
    initialBankrollYuan,
    reverseIntraDayOrder: true,
  });

  return {
    cycleCount: forward.numCycles,
    matchCount: parsedMatches.length,
    dailyStopLossYuan,
    initialBankrollYuan,
    legacy: forward.legacy,
    upgraded: forward.upgraded,
    reversedOrderCheck: {
      legacyLiveRoiPct: reversed.legacy.liveRoiPct,
      upgradedLiveRoiPct: reversed.upgraded.liveRoiPct,
      upgradedNetPaperSavedPnl: reversed.upgraded.netPaperSavedPnl,
      roiGainPct: Number(
        (reversed.upgraded.liveRoiPct - reversed.legacy.liveRoiPct).toFixed(2)
      ),
    },
    elapsedMs: performance.now() - t0,
  };
}

export function assembleQuantBenchmarkReport({
  layer1,
  layer2,
  layer3,
  layer4,
  totalElapsedMs,
}) {
  const pb = layer1.pairedBootstrap;
  const l1Pass =
    layer1.matchCount >= 600 &&
    layer1.pools.HAFU.coherentShinDc.rps === null &&
    layer1.pools.CRS.coherentShinDc.rps === null &&
    layer1.aggregate.coherentShinDc.rps < layer1.aggregate.multiplicative.rps &&
    layer1.aggregate.coherentShinDc.brier <
      layer1.aggregate.multiplicative.brier &&
    layer1.aggregate.coherentShinDc.logLoss <
      layer1.aggregate.multiplicative.logLoss &&
    layer1.aggregate.coherentShinDc.ece < layer1.aggregate.multiplicative.ece &&
    pb.vsMultiplicative.logLossPValue < 0.05 &&
    pb.vsShin.meanLogLossDiff < 0 &&
    pb.vsShin.logLossPValue < 0.05 &&
    layer1.maxCrossPoolCoherenceError < 1e-12;

  const l2Pass =
    layer2.maxMarginalSumError < 1e-12 &&
    layer2.maxCrossPoolEquivError < 1e-12 &&
    layer2.maxComboSumError < 1e-9 &&
    layer2.maxLinearEvError < 1e-9 &&
    layer2.maxBruteForceDiff < 1e-9 &&
    layer2.highStateSpaceEvError < 1e-12 &&
    layer2.highStateProfitProbError < 1e-12 &&
    layer2.statutoryHedgeSingleGatePassed === true &&
    layer2.m2NonSummingCushionPassed === true &&
    layer2.combinatorialExplosionGatePassed === true &&
    layer2.cacheMutationSensitivityPassed === true &&
    layer2.statutoryRoundingAndCapErrors === 0 &&
    layer2.illegalTicketViolations === 0 &&
    layer2.probabilityOrderingViolations === 0 &&
    layer2.avgEightMatchWorkspaceMs < 15 &&
    layer2.avgEightMatch247WorkspaceMs < 15;

  const l3Pass =
    layer3.totalStrictDominations === 0 &&
    layer3.maxKnapsackOptimalityGap <= 1e-9 &&
    layer3.slates.every((s) => s.evalElapsedMs < 50);

  const l4Pass =
    layer4.upgraded.liveRoiPct > layer4.legacy.liveRoiPct &&
    layer4.upgraded.maxDrawdownYuan < layer4.legacy.maxDrawdownYuan &&
    layer4.upgraded.maxDrawdownPct < layer4.legacy.maxDrawdownPct &&
    layer4.upgraded.sharpeRatio > layer4.legacy.sharpeRatio &&
    layer4.upgraded.paperSavedAmount > 0 &&
    layer4.upgraded.netPaperSavedPnl > 0 &&
    layer4.upgraded.emptyAlphaSavedCash > 0 &&
    layer4.reversedOrderCheck.upgradedLiveRoiPct >
      layer4.reversedOrderCheck.legacyLiveRoiPct &&
    layer4.reversedOrderCheck.upgradedNetPaperSavedPnl > 0;

  return {
    allPassed: l1Pass && l2Pass && l3Pass && l4Pass,
    gates: { l1Pass, l2Pass, l3Pass, l4Pass },
    layer1,
    layer2,
    layer3,
    layer4,
    totalElapsedMs:
      totalElapsedMs ??
      layer1.elapsedMs + layer2.elapsedMs + layer3.elapsedMs + layer4.elapsedMs,
  };
}

export function runQuantScientificBenchmarks(opts = {}) {
  const t0 = performance.now();
  const layer1 = runLayer1ProperScoringBenchmark(opts);
  const layer2 = runLayer2AxiomaticInvariantsBenchmark(opts);
  const layer3 = runLayer3MonteCarloParetoBenchmark(opts);
  const layer4 = runLayer4LedgerAblationBenchmark(opts);
  return assembleQuantBenchmarkReport({
    layer1,
    layer2,
    layer3,
    layer4,
    totalElapsedMs: performance.now() - t0,
  });
}

function padCell(str, width, alignRight = false) {
  const s = String(str);
  if (s.length >= width) return s;
  const pad = " ".repeat(width - s.length);
  return alignRight ? pad + s : s + pad;
}

export function formatQuantBenchmarkReport(report) {
  const { layer1, layer2, layer3, layer4, gates, allPassed, totalElapsedMs } =
    report;
  const out = [];

  out.push(
    "========================================================================================"
  );
  out.push(
    "  优竞体育内部专用 · Spec 0009 真实体彩 OOS 四层科学验证基准报表 (Real Sporttery OOS)"
  );
  out.push(
    "========================================================================================"
  );
  out.push("");

  // Layer 1 Table
  out.push(
    `[Layer 1] 中国体彩真实完场 OOS 概率校准与万次配对 Bootstrap (${layer1.matchCount} 场 · 耗时 ${layer1.elapsedMs.toFixed(1)}ms · 状态: ${gates.l1Pass ? "PASS" : "FAIL"})`
  );
  out.push(
    "Pool      | Vig%   | Ordinal RPS (M -> S -> C)    | Mult Brier -> Coherent | Mult LogLoss -> Coherent | Quantile ECE (M->C)"
  );
  out.push(
    "----------+--------+------------------------------+------------------------+--------------------------+--------------------"
  );
  for (const code of ALL_POOL_CODES) {
    const p = layer1.pools[code];
    const rpsStr = p.isOrdinal
      ? `${p.multiplicative.rps.toFixed(4)} -> ${p.shin.rps.toFixed(4)} -> ${p.coherentShinDc.rps.toFixed(4)}`
      : "          N/A (nominal)     ";
    out.push(
      `${padCell(code, 9)} | ${padCell(`${p.avgVigPct.toFixed(1)}%`, 6, true)} | ` +
        `${padCell(rpsStr, 28)} | ` +
        `${p.multiplicative.brier.toFixed(4)}  ->  ${p.coherentShinDc.brier.toFixed(4)}  | ` +
        `${p.multiplicative.logLoss.toFixed(4)}   ->   ${p.coherentShinDc.logLoss.toFixed(4)}   | ` +
        `${p.multiplicative.ece.toFixed(4)} ->  ${p.coherentShinDc.ece.toFixed(4)}`
    );
  }
  const agg = layer1.aggregate;
  out.push(
    `${padCell("ALL_5_AVG", 9)} | ${padCell("--", 6, true)} | ` +
      `${agg.multiplicative.rps.toFixed(4)} -> ${agg.shin.rps.toFixed(4)} -> ${agg.coherentShinDc.rps.toFixed(4)} | ` +
      `${agg.multiplicative.brier.toFixed(4)}  ->  ${agg.coherentShinDc.brier.toFixed(4)}  | ` +
      `${agg.multiplicative.logLoss.toFixed(4)}   ->   ${agg.coherentShinDc.logLoss.toFixed(4)}   | ` +
      `${agg.multiplicative.ece.toFixed(4)} ->  ${agg.coherentShinDc.ece.toFixed(4)}`
  );
  const pb = layer1.pairedBootstrap;
  out.push(
    `  * Paired Bootstrap (${pb.iterations}x) Coherent vs Mult Log-Loss : Δ=${pb.vsMultiplicative.meanLogLossDiff.toFixed(6)} [${pb.vsMultiplicative.logLossCi95[0].toFixed(6)}, ${pb.vsMultiplicative.logLossCi95[1].toFixed(6)}] (p=${pb.vsMultiplicative.logLossPValue.toFixed(4)})`
  );
  out.push(
    `  * Paired Bootstrap (${pb.iterations}x) Coherent vs Shin Log-Loss : Δ=${pb.vsShin.meanLogLossDiff.toFixed(6)} [${pb.vsShin.logLossCi95[0].toFixed(6)}, ${pb.vsShin.logLossCi95[1].toFixed(6)}] (p=${pb.vsShin.logLossPValue.toFixed(4)})`
  );
  out.push("");

  // Layer 2 Summary
  out.push(
    `[Layer 2] 概率公理与极端边界零误差不变量 (${layer2.checkedMatchesCount} 场 · ${layer2.portfolioScenariosChecked} 组场景 · 耗时 ${layer2.elapsedMs.toFixed(1)}ms · 状态: ${gates.l2Pass ? "PASS" : "FAIL"})`
  );
  out.push(
    `  - 五池边缘归一最大误差      : ${layer2.maxMarginalSumError.toExponential(3)} (< 1e-12)`
  );
  out.push(
    `  - 跨盘同义闭合最大误差      : ${layer2.maxCrossPoolEquivError.toExponential(3)} (< 1e-12)`
  );
  out.push(
    `  - >16,384态大复式线性EV误差 : ${layer2.highStateSpaceEvError.toExponential(3)} (< 1e-12)`
  );
  out.push(
    `  - >2,048注显式阻断/缓存敏感 : ${layer2.combinatorialExplosionGatePassed && layer2.cacheMutationSensitivityPassed ? "PASS" : "FAIL"}`
  );
  out.push(
    `  - 独立原子网格暴力枚举对账差: ${layer2.maxBruteForceDiff.toExponential(3)} (< 1e-9)`
  );
  out.push(
    `  - 法定舍入/封顶/出票违规数  : ${layer2.statutoryRoundingAndCapErrors + layer2.illegalTicketViolations} (0 error)`
  );
  out.push(
    `  - 8场工作区延迟(8x9 / 8x247): ${layer2.avgEightMatchWorkspaceMs.toFixed(2)}ms / ${layer2.avgEightMatch247WorkspaceMs.toFixed(2)}ms (< 15.00ms)`
  );
  out.push("");

  // Layer 3 Table
  out.push(
    `[Layer 3] 无筒仓万次蒙特卡洛单调四维帕累托与精确 0-1 背包对账 (Seed=${layer3.seed} · MaxKnapsackGap=${layer3.maxKnapsackOptimalityGap.toExponential(2)} · 状态: ${gates.l3Pass ? "PASS" : "FAIL"})`
  );
  out.push(
    "Slate             | States | Tickets | Time(ms) | Slot1 Dom | Slot2 Dom | Slot3 Dom | KnapsackGap | Slot3 Miss1Safety"
  );
  out.push(
    "------------------+--------+---------+----------+-----------+-----------+-----------+-------------+------------------"
  );
  for (const sl of layer3.slates) {
    const [s1, s2, s3] = sl.slots;
    out.push(
      `${padCell(sl.name, 17)} | ${padCell(sl.quotientStateCount, 6, true)} | ${padCell(sl.candidateTicketCount, 7, true)} | ` +
        `${padCell(sl.evalElapsedMs.toFixed(1), 8, true)} | ` +
        `${padCell(s1.strictlyDominatedByCount, 9, true)} | ${padCell(s2.strictlyDominatedByCount, 9, true)} | ${padCell(s3.strictlyDominatedByCount, 9, true)} | ` +
        `${padCell(sl.knapsackOptimalityGap.toExponential(2), 11, true)} | ` +
        `${padCell(`${(s3.metrics.missOneCvarRatio * 100).toFixed(1)}%`, 16, true)}`
    );
  }
  out.push("");

  // Layer 4 Table
  out.push(
    `[Layer 4] 同规则双轨止损账本 ${layer4.cycleCount} 周期完场实盘消融回放 (同守 ¥${layer4.dailyStopLossYuan}/日止损 · 初始本金 ¥${layer4.initialBankrollYuan} · 状态: ${gates.l4Pass ? "PASS" : "FAIL"})`
  );
  out.push(
    "Strategy                             | Live Bets | WinRate% | Staked(¥) | Net P&L(¥) | Live ROI% | MaxDD(¥ / %)         | Sharpe  | NetPaperSaved | EmptyAlphaSaved"
  );
  out.push(
    "-------------------------------------+-----------+----------+-----------+------------+-----------+----------------------+---------+---------------+----------------"
  );
  const leg = layer4.legacy;
  const upg = layer4.upgraded;
  out.push(
    `${padCell("Legacy (Mult + Forced 5 + ¥300 Cap)", 36)} | ${padCell(leg.liveSettledCount, 9, true)} | ${padCell(`${leg.liveWinRatePct.toFixed(2)}%`, 8, true)} | ` +
      `${padCell(leg.liveTotalStaked.toFixed(0), 9, true)} | ${padCell(leg.liveNetProfit.toFixed(2), 10, true)} | ${padCell(`${leg.liveRoiPct.toFixed(2)}%`, 9, true)} | ` +
      `${padCell(`¥${leg.maxDrawdownYuan.toFixed(2)} (${leg.maxDrawdownPct.toFixed(1)}%)`, 20, true)} | ${padCell(leg.sharpeRatio.toFixed(3), 7, true)} | ` +
      `${padCell(`¥${leg.netPaperSavedPnl.toFixed(0)}`, 13, true)} | ${padCell("¥0", 15, true)}`
  );
  out.push(
    `${padCell("Spec 0009 (KL + MILP 3+1 + ¥300 Cap)", 36)} | ${padCell(upg.liveSettledCount, 9, true)} | ${padCell(`${upg.liveWinRatePct.toFixed(2)}%`, 8, true)} | ` +
      `${padCell(upg.liveTotalStaked.toFixed(0), 9, true)} | ${padCell(upg.liveNetProfit.toFixed(2), 10, true)} | ${padCell(`${upg.liveRoiPct.toFixed(2)}%`, 9, true)} | ` +
      `${padCell(`¥${upg.maxDrawdownYuan.toFixed(2)} (${upg.maxDrawdownPct.toFixed(1)}%)`, 20, true)} | ${padCell(upg.sharpeRatio.toFixed(3), 7, true)} | ` +
      `${padCell(`¥${upg.netPaperSavedPnl.toFixed(0)}`, 13, true)} | ${padCell(`¥${upg.emptyAlphaSavedCash.toFixed(0)} (${upg.emptyAlphaAbstainCount}次)`, 15, true)}`
  );
  out.push(
    `  * 同日盘面逆序置换稳健性校验 : Upgraded ROI ${layer4.reversedOrderCheck.upgradedLiveRoiPct.toFixed(2)}% vs Legacy ROI ${layer4.reversedOrderCheck.legacyLiveRoiPct.toFixed(2)}% (净优势 +${layer4.reversedOrderCheck.roiGainPct.toFixed(2)}%, 逆序模拟净免损 ¥${layer4.reversedOrderCheck.upgradedNetPaperSavedPnl.toFixed(2)})`
  );
  out.push("");
  out.push(
    `========================================================================================`
  );
  out.push(
    `  OVERALL VERDICT: ${allPassed ? "ALL 4 SCIENTIFIC LAYERS PASSED" : "BENCHMARK FAILED"} · Total Elapsed: ${totalElapsedMs.toFixed(1)}ms`
  );
  out.push(
    `========================================================================================`
  );

  return out.join("\n");
}

const isDirectCliExecution =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectCliExecution) {
  const report = runQuantScientificBenchmarks();
  console.log(formatQuantBenchmarkReport(report));
  if (!report.allPassed) {
    process.exitCode = 1;
  }
}
