import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLedgerManager } from '../server/ledgerManager.mjs';
import {
  FALLBACK_MATCHES,
  POOL_MAX_PASS,
  archetypeToReport,
  bankerRoundParlayUnitPayout,
  calibrateMatchCoherentModel,
  computeTruthReport,
  devigPoolProbabilities,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  optimizeBonusPlan,
  parseSportteryRawJson,
  statutorySingleBetCap,
} from '../server/quantEngine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SETTLED_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'tests/fixtures/settledSportteryMatches.json'
);

const ALL_POOL_CODES = ['HAD', 'HHAD', 'TTG', 'HAFU', 'CRS'];

let cachedFixtureBundle = null;

function loadSettledFixtureBundle(fixturePath = DEFAULT_SETTLED_FIXTURE_PATH) {
  if (cachedFixtureBundle && cachedFixtureBundle.fixturePath === fixturePath) {
    return cachedFixtureBundle;
  }
  const rawJson = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const t0 = performance.now();
  const parsedMatches = parseSportteryRawJson({
    value: { matchInfoList: [{ subMatchList: rawJson.matches }] },
  });
  const parseElapsedMs = performance.now() - t0;
  cachedFixtureBundle = {
    fixturePath,
    rawFixture: rawJson,
    parsedMatches,
    parseElapsedMs,
  };
  return cachedFixtureBundle;
}

function calcTenBinEce(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, sumP: 0, sumY: 0 }));
  for (let i = 0; i < pairs.length; i++) {
    const [p, y] = pairs[i];
    const idx = Math.min(9, Math.max(0, Math.floor(p * 10)));
    bins[idx].count += 1;
    bins[idx].sumP += p;
    bins[idx].sumY += y;
  }
  let ece = 0;
  for (let b = 0; b < 10; b++) {
    if (bins[b].count > 0) {
      ece += Math.abs(bins[b].sumP - bins[b].sumY) / pairs.length;
    }
  }
  return ece;
}

/**
 * Layer 1 · 完场实盘五大玩法概率校准度检验（RPS / Brier Score / Log-Loss / 10-bin ECE）
 */
export function runLayer1ProperScoringBenchmark(opts = {}) {
  const t0 = performance.now();
  const { rawFixture, parsedMatches, parseElapsedMs } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );
  const N = parsedMatches.length;

  let maxCrossPoolCoherenceError = 0;
  for (let i = 0; i < N; i++) {
    const pm = parsedMatches[i];
    const pOf = (code, key) =>
      pm.pools[code].options.find((o) => o.key === key || o.label === key)?.fairProb ?? 0;
    const errHafuH = Math.abs(pOf('HAFU', 'hh') + pOf('HAFU', 'dh') + pOf('HAFU', 'ah') - pOf('HAD', 'h'));
    const errHafuD = Math.abs(pOf('HAFU', 'hd') + pOf('HAFU', 'dd') + pOf('HAFU', 'ad') - pOf('HAD', 'd'));
    const errHafuA = Math.abs(pOf('HAFU', 'ha') + pOf('HAFU', 'da') + pOf('HAFU', 'aa') - pOf('HAD', 'a'));
    const errZero = Math.abs(pOf('TTG', 's0') - pOf('CRS', '0:0'));
    maxCrossPoolCoherenceError = Math.max(
      maxCrossPoolCoherenceError,
      errHafuH,
      errHafuD,
      errHafuA,
      errZero
    );
  }

  const methods = ['multiplicative', 'shin', 'coherentShinDc'];
  const globalPairs = {
    multiplicative: [],
    shin: [],
    coherentShinDc: [],
  };
  const pools = {};

  for (const poolCode of ALL_POOL_CODES) {
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
      const goalLine = Number(pm.pools.HHAD?.goalLine ?? rawM.hhad?.goalLine ?? -1);
      const adj = out.ftHome - out.ftAway + goalLine;
      const hhadKey = adj > 0 ? 'hh' : adj === 0 ? 'hd' : 'ha';

      const winIdx =
        poolCode === 'HAD'
          ? options.findIndex((o) => o.key === out.hadKey)
          : poolCode === 'HHAD'
            ? options.findIndex((o) => o.key === hhadKey)
            : poolCode === 'TTG'
              ? options.findIndex((o) => o.key === out.ttgKey)
              : poolCode === 'HAFU'
                ? options.findIndex((o) => o.key === out.hafuKey)
                : options.findIndex((o) => o.label === out.crsLabel);

      if (winIdx < 0) {
        throw new Error(`Missing settled outcome index for ${poolCode} on match ${pm.id}`);
      }

      const probMap = {
        multiplicative: devigPoolProbabilities(options, 'multiplicative').probs,
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
        for (let r = 0; r < R; r++) {
          const y = r === winIdx ? 1 : 0;
          const pr = probs[r];
          acc.brier += (pr - y) * (pr - y);
          acc.pairs.push([pr, y]);
          globalPairs[mKey].push([pr, y]);
          if (r < R - 1) {
            cumP += pr;
            cumY += y;
            const d = cumP - cumY;
            rpsVal += d * d;
          }
        }
        acc.rps += rpsVal / (R - 1);
        acc.logLoss += -Math.log(Math.max(1e-12, probs[winIdx]));
      }
    }

    pools[poolCode] = {
      optionCount: parsedMatches[0].pools[poolCode].options.length,
      avgVigPct:
        (parsedMatches.reduce((a, m) => a + m.pools[poolCode].vig, 0) / N) * 100,
      multiplicative: {
        rps: sums.multiplicative.rps / N,
        brier: sums.multiplicative.brier / N,
        logLoss: sums.multiplicative.logLoss / N,
        ece: calcTenBinEce(sums.multiplicative.pairs),
      },
      shin: {
        rps: sums.shin.rps / N,
        brier: sums.shin.brier / N,
        logLoss: sums.shin.logLoss / N,
        ece: calcTenBinEce(sums.shin.pairs),
      },
      coherentShinDc: {
        rps: sums.coherentShinDc.rps / N,
        brier: sums.coherentShinDc.brier / N,
        logLoss: sums.coherentShinDc.logLoss / N,
        ece: calcTenBinEce(sums.coherentShinDc.pairs),
      },
    };
  }

  const macroAvg = (mKey) => {
    const P = ALL_POOL_CODES.length;
    return {
      rps: ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].rps, 0) / P,
      brier: ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].brier, 0) / P,
      logLoss: ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].logLoss, 0) / P,
      ece: ALL_POOL_CODES.reduce((a, c) => a + pools[c][mKey].ece, 0) / P,
      pooledEce: calcTenBinEce(globalPairs[mKey]),
    };
  };

  return {
    matchCount: N,
    cycleCount: rawFixture.cycleCount,
    parseMsPerMatch: parseElapsedMs / N,
    elapsedMs: performance.now() - t0,
    maxCrossPoolCoherenceError,
    pools,
    aggregate: {
      multiplicative: macroAvg('multiplicative'),
      shin: macroAvg('shin'),
      coherentShinDc: macroAvg('coherentShinDc'),
    },
  };
}

function makePickFromMatch(match, poolCode, optionKeyOrLabel) {
  const pool = match.pools[poolCode];
  const opt = pool.options.find((o) => o.key === optionKeyOrLabel || o.label === optionKeyOrLabel);
  if (!opt) {
    throw new Error(`Option ${optionKeyOrLabel} not found in ${poolCode} for match ${match.id}`);
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
  if (leg.poolCode === 'HAD') return st.ft === leg.optionKey;
  if (leg.poolCode === 'HHAD') {
    const adj = st.goalDiff + goalLine;
    const k = adj > 0 ? 'hh' : adj === 0 ? 'hd' : 'ha';
    return k === leg.optionKey;
  }
  if (leg.poolCode === 'TTG') {
    const norm = String(leg.optionKey).startsWith('s') ? leg.optionKey : `s${leg.optionKey}`;
    return st.ttgKey === norm;
  }
  if (leg.poolCode === 'HAFU') return st.hafuKey === leg.optionKey;
  if (leg.poolCode === 'CRS') {
    return st.crsKey === leg.optionKey || st.crsKey === leg.optionLabel;
  }
  return false;
}

/**
 * Independent brute-force Cartesian enumerator over full 139-state (ht, ft) atomic grids
 * (used in Layer 2 for 1..2 match portfolios to independently cross-check quotient folding).
 */
function bruteForceEvaluateTickets(tickets, totalCost, matches) {
  const matchIds = Array.from(new Set(tickets.flatMap((t) => t.legs.map((g) => g.matchId))));
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
          if (!doesLegHitAtomicState(lg, cals[mIdx].goalLine, chosenStates[mIdx])) {
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
    expectedValueRate: totalCost > 0 ? (expectedReturn - totalCost) / totalCost : 0,
  };
}

/**
 * Layer 2 · 概率公理、跨盘自洽性与联合状态空间零误差不变量 + <15ms 延迟门禁
 */
export function runLayer2AxiomaticInvariantsBenchmark(opts = {}) {
  const t0 = performance.now();
  const { parsedMatches } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );
  const allMatches = [...FALLBACK_MATCHES, ...parsedMatches];

  const homeWinCrs = new Set([
    '1:0', '2:0', '2:1', '3:0', '3:1', '3:2', '4:0', '4:1', '4:2', '5:0', '5:1', '5:2', '胜其它',
  ]);
  const drawCrs = new Set(['0:0', '1:1', '2:2', '3:3', '平其它']);
  const awayWinCrs = new Set([
    '0:1', '0:2', '1:2', '0:3', '1:3', '2:3', '0:4', '1:4', '2:4', '0:5', '1:5', '2:5', '负其它',
  ]);

  let maxMarginalSumError = 0;
  let maxCrossPoolEquivError = 0;

  // 1. Single-match 5-pool marginal sum & cross-pool exact equivalences across all 104 matches
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
      m.pools[code].options.find((o) => o.key === key || o.label === key)?.fairProb ?? 0;

    const hafuH = pOf('HAFU', 'hh') + pOf('HAFU', 'dh') + pOf('HAFU', 'ah');
    const hafuD = pOf('HAFU', 'hd') + pOf('HAFU', 'dd') + pOf('HAFU', 'ad');
    const hafuA = pOf('HAFU', 'ha') + pOf('HAFU', 'da') + pOf('HAFU', 'aa');
    const ttg0 = pOf('TTG', 's0');
    const crs00 = pOf('CRS', '0:0');
    const ttg1 = pOf('TTG', 's1');
    const crs1 = pOf('CRS', '1:0') + pOf('CRS', '0:1');
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
    const gLine = Number(m.pools.HHAD?.goalLine ?? -1);
    if (gLine === -1) {
      let gridWinBy2Plus = 0;
      for (let x = 0; x <= 10; x++) {
        for (let y = 0; y <= 10; y++) {
          if (x - y >= 2) gridWinBy2Plus += cal.scoreGrid[x * 11 + y];
        }
      }
      hhadEquivErr = Math.max(
        Math.abs(pOf('HHAD', 'hh') - gridWinBy2Plus),
        Math.abs(pOf('HHAD', 'hh') + pOf('HHAD', 'hd') - pOf('HAD', 'h')),
        Math.abs(pOf('HHAD', 'ha') - (pOf('HAD', 'd') + pOf('HAD', 'a')))
      );
    } else if (gLine === 1) {
      let gridAwayBy2Plus = 0;
      for (let x = 0; x <= 10; x++) {
        for (let y = 0; y <= 10; y++) {
          if (y - x >= 2) gridAwayBy2Plus += cal.scoreGrid[x * 11 + y];
        }
      }
      hhadEquivErr = Math.max(
        Math.abs(pOf('HHAD', 'ha') - gridAwayBy2Plus),
        Math.abs(pOf('HHAD', 'hh') - (pOf('HAD', 'h') + pOf('HAD', 'd')))
      );
    }

    maxCrossPoolEquivError = Math.max(
      maxCrossPoolEquivError,
      Math.abs(hafuH - pOf('HAD', 'h')),
      Math.abs(hafuD - pOf('HAD', 'd')),
      Math.abs(hafuA - pOf('HAD', 'a')),
      Math.abs(ttg0 - crs00),
      Math.abs(ttg1 - crs1),
      Math.abs(crsH - pOf('HAD', 'h')),
      Math.abs(crsD - pOf('HAD', 'd')),
      Math.abs(crsA - pOf('HAD', 'a')),
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

  const verifyReportInvariants = (label, report, matchesSubset, runBruteForce = false) => {
    portfolioScenariosChecked += 1;
    const tickets = report.tickets ?? [];
    const combos = report.combos ?? [];

    if (
      !(
        report.realProfitProb >= -1e-12 &&
        report.realProfitProb <= report.anyWinProb + 1e-12 &&
        report.anyWinProb <= 1 + 1e-12 &&
        combos.every((c) => c.prob >= 0)
      )
    ) {
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

    // Check every physical ticket for statutory legality, GB/T 8170 rounding, and 10w/20w/50w/100w caps
    let linearTicketExpectedReturn = 0;
    for (const tk of tickets) {
      const legs = tk.legs ?? [];
      const minPoolCap = Math.min(...legs.map((g) => POOL_MAX_PASS[g.poolCode] ?? 8));
      if (legs.length === 0 || legs.length > minPoolCap) {
        illegalTicketViolations += 1;
        violationDetails.push(`${label}: pass cap violation (${legs.length} > ${minPoolCap})`);
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
      const expectedRawUnit = bankerRoundParlayUnitPayout(legs.map((g) => Number(g.odds)));
      const expectedCap = statutorySingleBetCap(legs.length);
      const expectedUnit = Math.min(expectedCap, expectedRawUnit);
      const expectedTotal = Number((expectedUnit * tk.multiple).toFixed(2));
      if (
        Math.abs(tk.unitPayout - expectedUnit) > 1e-9 ||
        Math.abs(tk.totalPayout - expectedTotal) > 1e-9
      ) {
        statutoryRoundingAndCapErrors += 1;
      }

      // Independent ticket hit probability from coherent per-match atomic states
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

    const comboExpectedReturn = combos.reduce((a, c) => a + c.prob * c.totalPayout, 0);
    if (report.totalCost > 0) {
      const evFromCombos = (comboExpectedReturn - report.totalCost) / report.totalCost;
      const evFromLinearTickets = (linearTicketExpectedReturn - report.totalCost) / report.totalCost;
      maxLinearEvError = Math.max(
        maxLinearEvError,
        Math.abs(report.expectedValueRate - evFromCombos),
        Math.abs(report.expectedValueRate - evFromLinearTickets)
      );
    }

    if (runBruteForce && tickets.length > 0) {
      const bf = bruteForceEvaluateTickets(tickets, report.totalCost, matchesSubset);
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

  // (a) 1..8 matches across FALLBACK_MATCHES and settled cycle 1: Pareto 3+1 slots (including covering wheels 1..8)
  for (const source of [
    { tag: 'fallback', list: FALLBACK_MATCHES },
    { tag: 'settled-c1', list: parsedMatches.slice(0, 8) },
  ]) {
    for (let mCount = 1; mCount <= 8; mCount++) {
      const sub = source.list.slice(0, mCount);
      const plans = generateParetoPortfolio(sub, 100, 'objective', false, []);
      for (const pl of plans) {
        if (!pl.available || pl.lines.length === 0) continue;
        const rep = archetypeToReport(pl, null, sub);
        verifyReportInvariants(
          `${source.tag}-${mCount}-${pl.key}`,
          rep,
          sub,
          source.tag === 'fallback' && mCount <= 2
        );
      }
    }
  }

  // (b) Same-match HAD + HHAD dual-single & cross-pool overlapping 2-match parlay (brute-forced against 139^2 = 19,321 atomic states!)
  const mDual = FALLBACK_MATCHES[1]; // 日本 vs 巴拉圭 (single open on HAD & HHAD)
  const dualRep = computeTruthReport(
    [
      makePickFromMatch(mDual, 'HAD', 'h'),
      makePickFromMatch(mDual, 'HAD', 'd'),
      makePickFromMatch(mDual, 'HHAD', 'hh'),
    ],
    4,
    [mDual]
  );
  verifyReportInvariants('same-match-dual-single', dualRep, [mDual], true);

  const mixTwo = FALLBACK_MATCHES.slice(0, 2);
  const mixRep2 = computeTruthReport(
    [
      makePickFromMatch(mixTwo[0], 'HAFU', 'dh'),
      makePickFromMatch(mixTwo[0], 'HAFU', 'hh'),
      makePickFromMatch(mixTwo[1], 'CRS', '1:0'),
      makePickFromMatch(mixTwo[1], 'CRS', '2:0'),
    ],
    3,
    mixTwo,
    { mode: 'free', passSizes: [1, 2] }
  );
  verifyReportInvariants('mixed-hafu-crs-2match', mixRep2, mixTwo, true);

  // (c) Official M串N multi-pass (3串4, 4串11, 6串15) + mixed 5-pool parlay + Three-Mode Bonus Optimization
  const m3 = FALLBACK_MATCHES.slice(0, 3);
  const rep3x4 = computeTruthReport(
    [
      makePickFromMatch(m3[0], 'HAD', 'h'),
      makePickFromMatch(m3[0], 'HAD', 'd'),
      makePickFromMatch(m3[1], 'HHAD', 'hh'),
      makePickFromMatch(m3[2], 'TTG', 's2'),
    ],
    2,
    m3,
    { mode: 'combo', comboCode: '3x4' }
  );
  verifyReportInvariants('combo-3x4', rep3x4, m3, false);

  const m4 = FALLBACK_MATCHES.slice(0, 4);
  const rep4x11 = computeTruthReport(
    [
      makePickFromMatch(m4[0], 'HAD', 'h'),
      makePickFromMatch(m4[1], 'HHAD', 'ha'),
      makePickFromMatch(m4[2], 'HAFU', 'dd'),
      makePickFromMatch(m4[3], 'CRS', '1:2'),
    ],
    2,
    m4,
    { mode: 'combo', comboCode: '4x11' }
  );
  verifyReportInvariants('combo-4x11-mixed-5pool', rep4x11, m4, false);

  for (const optMode of ['equal', 'hot-first', 'cold-first']) {
    const optPlan = optimizeBonusPlan(rep4x11, m4, optMode);
    const optRep = archetypeToReport(optPlan, rep4x11, m4);
    verifyReportInvariants(`bonus-4x11-${optMode}`, optRep, m4, false);
  }

  const m6 = FALLBACK_MATCHES.slice(0, 6);
  const rep6x15 = computeTruthReport(
    m6.map((m, idx) =>
      idx % 2 === 0 ? makePickFromMatch(m, 'HAD', 'h') : makePickFromMatch(m, 'TTG', 's2')
    ),
    2,
    m6,
    { mode: 'combo', comboCode: '6x15' }
  );
  verifyReportInvariants('combo-6x15', rep6x15, m6, false);

  // (d) Statutory high-odds cap-clipping verification across 1/2/4/6-leg tiers (10w / 20w / 50w / 100w)
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
          { key: 'h', label: '主胜', odds: 60000, trend: 0, fairProb: 0.4, shinProb: 0.4 },
          { key: 'd', label: '平', odds: 3.5, trend: 0, fairProb: 0.3, shinProb: 0.3 },
          { key: 'a', label: '客胜', odds: 3.5, trend: 0, fairProb: 0.3, shinProb: 0.3 },
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
      subCap.map((x) => makePickFromMatch(x, 'HAD', 'h')),
      2,
      subCap,
      { mode: 'free', passSizes: [legCnt] }
    );
    if (repCap.tickets[0]?.unitPayout !== expectedCap || repCap.maxPayout !== expectedCap * 2) {
      statutoryRoundingAndCapErrors += 1;
    }
  }

  // 3. 8-match full evaluateQuantWorkspace latency gate (< 15ms average)
  const eightMatches = FALLBACK_MATCHES;
  const eightPicks = eightMatches.map((m) => makePickFromMatch(m, 'HAD', 'h'));
  const targetIds = eightMatches.map((m) => m.id);
  for (let w = 0; w < 2; w++) {
    evaluateQuantWorkspace(
      {
        picks: eightPicks,
        multiple: 5,
        passSpec: { mode: 'combo', comboCode: '8x9' },
        subjectiveDeltaPct: 5,
        simVoidFirstMatch: false,
        planSpec: { kind: 'archetype', key: 'max-cvar-wheel', scaleMultiple: 1 },
        targetIds,
        anchorToRadarPicks: true,
        budget: 120,
        stance: 'objective',
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
        passSpec: { mode: 'combo', comboCode: '8x9' },
        subjectiveDeltaPct: (i % 4) * 4 - 4,
        simVoidFirstMatch: i % 2 === 1,
        planSpec: { kind: 'archetype', key: 'max-cvar-wheel', scaleMultiple: 1 },
        targetIds,
        anchorToRadarPicks: true,
        budget: 120,
        stance: i % 2 === 0 ? 'objective' : 'home-lean',
        unlockFullAgg: false,
      },
      eightMatches
    );
  }
  const avgEightMatchWorkspaceMs = (performance.now() - latStart) / runs;

  return {
    checkedMatchesCount: allMatches.length,
    portfolioScenariosChecked,
    maxMarginalSumError,
    maxCrossPoolEquivError,
    maxComboSumError,
    maxLinearEvError,
    maxBruteForceDiff,
    statutoryRoundingAndCapErrors,
    illegalTicketViolations,
    violationDetails,
    probabilityOrderingViolations,
    avgEightMatchWorkspaceMs,
    elapsedMs: performance.now() - t0,
  };
}

export function createMulberry32(seed = 20261119) {
  let state = seed >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

const POOL_TYPE_ID = { HAD: 1, HHAD: 2, TTG: 3, HAFU: 4, CRS: 5 };

function evaluateSlateMonteCarloPareto(name, matches, budget, rng, samplesPerSlate = 10_000) {
  const plans = generateParetoPortfolio(matches, budget, 'objective', false, []);
  const primarySlots = plans.slice(0, 3);
  const M = matches.length;
  const fullSlateMask = (1 << M) - 1;

  // 1. Collect candidate legs per match (HAD/HHAD top 2 + any legs used by primarySlots)
  const candLegsByMatch = matches.map((m) => {
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
    for (const code of ['HAD', 'HHAD']) {
      const pool = m.pools[code];
      if (pool && pool.selling !== false) {
        const sorted = [...pool.options].sort((a, b) => b.fairProb - a.fairProb);
        if (sorted[0]) putOpt(code, sorted[0]);
        if (sorted[1]) putOpt(code, sorted[1]);
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
  const primaryDirIdxPerMatch = matches.map((_, mIdx) => {
    const lst = matchLegLists[mIdx];
    let bestJ = 0;
    let bestP = -1;
    for (let j = 0; j < lst.length; j++) {
      const g = lst[j];
      if ((g.poolCode === 'HAD' || g.poolCode === 'HHAD') && g.odds >= 1.18 && g.fairProb > bestP) {
        bestP = g.fairProb;
        bestJ = j;
      }
    }
    return bestJ;
  });

  // 2. Build legal candidate ticket universe
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
      (a, b) => matches.findIndex((m) => m.id === a.matchId) - matches.findIndex((m) => m.id === b.matchId)
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
    const sig = sortedLegs.map((g) => `${g.matchId}:${g.poolCode}:${g.optionKey}`).join('|');
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
        throw new Error(`Slot ${pl.key} produced illegal ticket on slate ${name}`);
      }
      return { idx, mult: ln.multiple };
    })
  );

  // Add all single-capable 1-leg tickets
  for (let m = 0; m < M; m++) {
    for (const lg of matchLegLists[m]) {
      if (lg.singleAllowed) addTicket([lg]);
    }
  }

  // Add k-leg parlays across HAD primary, HHAD primary, EV-best primary, and 1-flip secondary covers
  const hadTopPerMatch = matches.map((_, mIdx) =>
    matchLegLists[mIdx].find((g) => g.poolCode === 'HAD') ?? matchLegLists[mIdx][primaryDirIdxPerMatch[mIdx]]
  );
  const hhadTopPerMatch = matches.map((_, mIdx) =>
    matchLegLists[mIdx].find((g) => g.poolCode === 'HHAD') ?? matchLegLists[mIdx][primaryDirIdxPerMatch[mIdx]]
  );
  const highProbPerMatch = matches.map((_, mIdx) => matchLegLists[mIdx][primaryDirIdxPerMatch[mIdx]]);
  const highEvPerMatch = matches.map((_, mIdx) =>
    [...matchLegLists[mIdx]].sort((a, b) => b.odds * b.fairProb - a.odds * a.fairProb)[0]
  );

  const backboneProfiles = [highProbPerMatch, highEvPerMatch, hadTopPerMatch, hhadTopPerMatch];
  for (let k = 2; k <= M; k++) {
    const combs = kCombinations(M, k);
    for (const comb of combs) {
      for (const prof of backboneProfiles) {
        const base = comb.map((i) => prof[i]);
        addTicket(base);
        // 1-flip same-pool secondary covers
        for (let pos = 0; pos < comb.length; pos++) {
          const mIdx = comb[pos];
          const baseLeg = base[pos];
          for (const alt of matchLegLists[mIdx]) {
            if (alt.poolCode === baseLeg.poolCode && alt.optionKey !== baseLeg.optionKey) {
              const copy = [...base];
              copy[pos] = alt;
              addTicket(copy);
            }
          }
          // Also 1-match cross-pool mixed parlay switch (HAD <-> HHAD on match mIdx, respecting single pool on mIdx!)
          for (const alt of matchLegLists[mIdx]) {
            if (alt.poolCode !== baseLeg.poolCode) {
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

  // 3. Precompute exact coherent quotient state space Ω̃ and vectorized payout tables
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

  const missGroupProb = new Float64Array(M);
  const stateMissOwner = new Int8Array(S).fill(-1);
  for (let s = 0; s < S; s++) {
    const masks = jointStates[s].masks;
    let missCount = 0;
    let missIdx = -1;
    for (let m = 0; m < M; m++) {
      const hitPrim = (masks[m] & (1 << primaryDirIdxPerMatch[m])) !== 0;
      if (!hitPrim) {
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
  const ticketMissCondReturn = new Float64Array(K * M);
  const ticketHitStates = new Array(K);
  const ticketMatchMask = new Int32Array(K);
  const ticketAvoidMask = new Int32Array(K);
  const ticketLen = new Int8Array(K);
  const ticketMatchOptCode = new Int16Array(K * M).fill(-1);

  for (let k = 0; k < K; k++) {
    const tk = tickets[k];
    ticketUnitCents[k] = tk.unitCents;
    ticketMatchMask[k] = tk.matchMask;
    ticketAvoidMask[k] = tk.avoidMask;
    ticketLen[k] = tk.len;

    const legLookup = tk.legs.map((lg) => {
      const mIdx = matches.findIndex((m) => m.id === lg.matchId);
      const jIdx = matchLegLists[mIdx].findIndex(
        (o) => o.poolCode === lg.poolCode && o.optionKey === lg.optionKey
      );
      ticketMatchOptCode[k * M + mIdx] = ((POOL_TYPE_ID[lg.poolCode] ?? 1) << 8) | jIdx;
      return { mIdx, bit: 1 << jIdx };
    });

    const hits = [];
    let hitProbSum = 0;
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
        const mo = stateMissOwner[s];
        if (mo >= 0) missHitProb[mo] += p;
      }
    }
    ticketHitStates[k] = Int32Array.from(hits);
    ticketHitProb[k] = hitProbSum;
    ticketExpectedReturn[k] = hitProbSum * tk.unitPayout;
    for (let x = 0; x < M; x++) {
      ticketMissCondReturn[k * M + x] =
        missGroupProb[x] > 0 ? (missHitProb[x] / missGroupProb[x]) * tk.unitPayout : 0;
    }
  }

  // Vectorized scratch buffers (zero heap allocation inside the 10,000-iteration hot loop!)
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
          if (ca >= 0 && cb >= 0 && (ca >> 8) === (cb >> 8) && ca !== cb) {
            disjointOnSomeMatch = true;
            break;
          }
        }
        if (!disjointOnSomeMatch) return false;
      }
    }
    return true;
  };

  const evalVectorized4D = (activeIdx, activeMult, activeCount) => {
    let totalNotes = 0;
    let expReturn = 0;
    missScratch.fill(0);

    for (let i = 0; i < activeCount; i++) {
      const k = activeIdx[i];
      const mult = activeMult[i];
      totalNotes += mult;
      expReturn += mult * ticketExpectedReturn[k];
      const baseOff = k * M;
      for (let x = 0; x < M; x++) {
        missScratch[x] += mult * ticketMissCondReturn[baseOff + x];
      }
    }

    const costYuan = totalNotes * 2;
    const costCents = totalNotes * 200;
    let profitProb = 0;
    let minWinCents = 0x7fffffff;

    if (arePairwiseDisjoint(activeIdx, activeCount)) {
      for (let i = 0; i < activeCount; i++) {
        const k = activeIdx[i];
        const rc = activeMult[i] * ticketUnitCents[k];
        const hp = ticketHitProb[k];
        if (hp > 0) {
          if (rc >= costCents) profitProb += hp;
          if (rc > 0 && rc < minWinCents) minWinCents = rc;
        }
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
        const rc = payCentsBuf[s];
        if (rc >= costCents) profitProb += stateProb[s];
        if (rc > 0 && rc < minWinCents) minWinCents = rc;
      }
    }

    missScratch.sort();
    const tailLen = Math.max(1, Math.ceil(M * 0.5));
    let tailSum = 0;
    for (let t = 0; t < tailLen; t++) {
      tailSum += missScratch[t];
    }

    return {
      cost: costYuan,
      evRate: (expReturn - costYuan) / costYuan,
      profitProb,
      coveredFloorRatio: minWinCents < 0x7fffffff ? (minWinCents - costCents) / costCents : -1,
      missOneCvarRatio: tailSum / tailLen / costYuan,
    };
  };

  const slotRefs = slotTicketSpecs.map((items, sIdx) => {
    const idxArr = Int32Array.from(items.map((x) => x.idx));
    const multArr = Int32Array.from(items.map((x) => x.mult));
    const reqMatchMask = items.reduce((acc, x) => acc | ticketMatchMask[x.idx], 0);
    const reqPassLen = ticketLen[items[0].idx];
    return {
      key: primarySlots[sIdx].key,
      idxArr,
      multArr,
      reqMatchMask,
      reqPassLen,
      metrics: evalVectorized4D(idxArr, multArr, items.length),
    };
  });

  // Candidate pools per slot respecting Same-Match Single-Pool Exclusivity & pass structure
  const fullPassPoolsForMask = (reqLen, reqMask) =>
    tickets
      .filter((tk) => tk.len === reqLen && (tk.matchMask & reqMask) === tk.matchMask)
      .map((tk) => tk.idx);
  const slot0CandPool = fullPassPoolsForMask(slotRefs[0].reqPassLen, slotRefs[0].reqMatchMask);
  const slot1CandPool = fullPassPoolsForMask(slotRefs[1].reqPassLen, slotRefs[1].reqMatchMask);
  const slot2MinLen = M >= 3 ? 2 : 1;
  const slot2CandPool = tickets.filter((tk) => tk.len >= slot2MinLen).map((tk) => tk.idx);
  const candPools = [slot0CandPool, slot1CandPool, slot2CandPool];

  const isSameMatchSinglePoolCompatible = (chosenIdx, count, candTicketIdx) => {
    const candPoolsArr = tickets[candTicketIdx].parlayPools;
    for (let i = 0; i < count; i++) {
      const exPoolsArr = tickets[chosenIdx[i]].parlayPools;
      for (let m = 0; m < M; m++) {
        if (candPoolsArr[m] !== 0 && exPoolsArr[m] !== 0 && candPoolsArr[m] !== exPoolsArr[m]) {
          return false;
        }
      }
    }
    return true;
  };

  const maxNotes = Math.floor(budget / 2);
  const minNotes = Math.max(1, Math.floor(maxNotes * 0.9));
  const activeIdxBuf = new Int32Array(10);
  const activeMultBuf = new Int32Array(10);
  const weightBuf = new Float64Array(10);

  const domCounts = [0, 0, 0];
  const domExamples = [null, null, null];

  const evalStart = performance.now();
  let samplesEvaluated = 0;

  while (samplesEvaluated < samplesPerSlate) {
    const targetSlot = samplesEvaluated % 3;
    const pool = candPools[targetSlot];
    const refSlot = slotRefs[targetSlot];
    let rCount = 0;

    if (samplesEvaluated < 3600) {
      // Adversarial local neighborhood around refSlot's own tickets (+ optional legal extra line)
      for (let i = 0; i < refSlot.idxArr.length && rCount < 10; i++) {
        activeIdxBuf[rCount++] = refSlot.idxArr[i];
      }
      if (rng() < 0.35 && rCount < 10 && pool.length > rCount) {
        const extra = pool[Math.floor(rng() * pool.length)];
        let dup = false;
        for (let i = 0; i < rCount; i++) {
          if (activeIdxBuf[i] === extra) {
            dup = true;
            break;
          }
        }
        if (!dup && isSameMatchSinglePoolCompatible(activeIdxBuf, rCount, extra)) {
          activeIdxBuf[rCount++] = extra;
        }
      }
    } else {
      const maxK = Math.min(10, pool.length, maxNotes);
      const minK = targetSlot === 2 && M >= 2 ? Math.min(maxK, 2) : 1;
      const wantK = minK + Math.floor(rng() * (maxK - minK + 1));
      let attempts = 0;
      while (rCount < wantK && attempts < 40) {
        attempts += 1;
        const cand = pool[Math.floor(rng() * pool.length)];
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
      // Ensure active match mask (and for Slot 2 covering wheel, genuine miss-1 avoid mask) is satisfied;
      // if random draw missed coverage, repair with a compatible covering line from refSlot or pool.
      let uMask = 0;
      let aMask = 0;
      for (let i = 0; i < rCount; i++) {
        uMask |= ticketMatchMask[activeIdxBuf[i]];
        aMask |= ticketAvoidMask[activeIdxBuf[i]];
      }
      if (
        (uMask & refSlot.reqMatchMask) !== refSlot.reqMatchMask ||
        (targetSlot === 2 && M >= 2 && (aMask & fullSlateMask) !== fullSlateMask)
      ) {
        rCount = 0;
        for (let i = 0; i < refSlot.idxArr.length && rCount < 10; i++) {
          activeIdxBuf[rCount++] = refSlot.idxArr[i];
        }
      }
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
      const add = Math.min(rem, Math.floor(((notesUse - rCount) * weightBuf[i]) / wSum));
      activeMultBuf[i] += add;
      rem -= add;
    }
    activeMultBuf[rCount - 1] += rem;

    const candMetrics = evalVectorized4D(activeIdxBuf, activeMultBuf, rCount);
    samplesEvaluated += 1;

    // Check unionMatchMask & avoidMask to test against ALL slots whose feasible support cand satisfies!
    let unionMask = 0;
    let avoidUnion = 0;
    let allSameLen = true;
    const firstLen = ticketLen[activeIdxBuf[0]];
    let minLenInCand = firstLen;
    for (let i = 0; i < rCount; i++) {
      const tkIdx = activeIdxBuf[i];
      unionMask |= ticketMatchMask[tkIdx];
      avoidUnion |= ticketAvoidMask[tkIdx];
      const tl = ticketLen[tkIdx];
      if (tl !== firstLen) allSameLen = false;
      if (tl < minLenInCand) minLenInCand = tl;
    }

    for (let s = 0; s < 3; s++) {
      const sRef = slotRefs[s];
      if (s === 0 || s === 1) {
        if (!allSameLen || firstLen !== sRef.reqPassLen || unionMask !== sRef.reqMatchMask) {
          continue;
        }
      } else {
        if (
          minLenInCand < slot2MinLen ||
          unionMask !== fullSlateMask ||
          (M >= 2 && (avoidUnion & fullSlateMask) !== fullSlateMask)
        ) {
          continue;
        }
      }

      const rm = sRef.metrics;
      const geAll =
        candMetrics.evRate >= rm.evRate - 1e-9 &&
        candMetrics.profitProb >= rm.profitProb - 1e-9 &&
        candMetrics.coveredFloorRatio >= rm.coveredFloorRatio - 1e-9 &&
        candMetrics.missOneCvarRatio >= rm.missOneCvarRatio - 1e-9;
      if (!geAll) continue;
      const gtOne =
        candMetrics.evRate > rm.evRate + 1e-6 ||
        candMetrics.profitProb > rm.profitProb + 1e-6 ||
        candMetrics.coveredFloorRatio > rm.coveredFloorRatio + 1e-6 ||
        candMetrics.missOneCvarRatio > rm.missOneCvarRatio + 1e-6;
      if (gtOne) {
        domCounts[s] += 1;
        if (!domExamples[s]) {
          domExamples[s] = {
            slotMetrics: rm,
            candMetrics,
            slotLines: Array.from(sRef.idxArr).map(
              (ti, ii) => `${tickets[ti].sig} x${sRef.multArr[ii]}`
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
    slots: slotRefs.map((sr, idx) => ({
      key: sr.key,
      metrics: sr.metrics,
      strictlyDominatedByCount: domCounts[idx],
      dominatingExample: domExamples[idx],
    })),
  };
}

/**
 * Layer 3 · 10,000 次蒙特卡洛随机组合四维单位本金帕累托前沿支配检验
 */
export function runLayer3MonteCarloParetoBenchmark(opts = {}) {
  const t0 = performance.now();
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : 20261119;
  const samplesPerSlate = Number.isFinite(opts.samplesPerSlate)
    ? Math.max(100, Math.round(opts.samplesPerSlate))
    : 10_000;
  const rng = createMulberry32(seed);
  const { parsedMatches } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );

  const slateConfigs = [
    { name: 'FALLBACK_2M_B100', matches: FALLBACK_MATCHES.slice(0, 2), budget: 100 },
    { name: 'FALLBACK_3M_B200', matches: FALLBACK_MATCHES.slice(0, 3), budget: 200 },
    { name: 'FALLBACK_4M_B100', matches: FALLBACK_MATCHES.slice(0, 4), budget: 100 },
    { name: 'FALLBACK_6M_B200', matches: FALLBACK_MATCHES.slice(0, 6), budget: 200 },
    { name: 'SETTLED_2M_B200', matches: parsedMatches.slice(0, 2), budget: 200 },
    { name: 'SETTLED_3M_B100', matches: parsedMatches.slice(8, 11), budget: 100 },
    { name: 'SETTLED_4M_B200', matches: parsedMatches.slice(0, 4), budget: 200 },
    { name: 'SETTLED_6M_B100', matches: parsedMatches.slice(16, 22), budget: 100 },
  ];

  const slates = slateConfigs.map((cfg) =>
    evaluateSlateMonteCarloPareto(cfg.name, cfg.matches, cfg.budget, rng, samplesPerSlate)
  );
  const totalStrictDominations = slates.reduce(
    (acc, sl) => acc + sl.slots.reduce((s, x) => s + x.strictlyDominatedByCount, 0),
    0
  );

  return {
    seed,
    samplesPerSlate,
    slates,
    totalStrictDominations,
    elapsedMs: performance.now() - t0,
  };
}

function didLegHitSettledOutcome(leg, rawMatch) {
  const out = rawMatch.outcome;
  if (leg.poolCode === 'HAD') return leg.optionKey === out.hadKey;
  if (leg.poolCode === 'HHAD') {
    const gl = Number(rawMatch.hhad?.goalLine ?? -1);
    const adj = out.ftHome - out.ftAway + gl;
    const hk = adj > 0 ? 'hh' : adj === 0 ? 'hd' : 'ha';
    return leg.optionKey === hk;
  }
  if (leg.poolCode === 'TTG') return leg.optionKey === out.ttgKey;
  if (leg.poolCode === 'HAFU') return leg.optionKey === out.hafuKey;
  if (leg.poolCode === 'CRS') {
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

/**
 * Legacy pre-Spec-0008 baseline strategy for paired ablation replay:
 * - Multiplicative isolated de-vigging;
 * - Forced 5-archetype betting every slate (including 0.04 shield-inversion weight,
 *   forced TTG parlay, and forced CRS 1:0 / HAFU 平胜 assassin script even when no alpha exists).
 */
function buildLegacyFiveArchetypePlans(matches, budgetYuan) {
  const notes = Math.max(4, Math.floor(budgetYuan / 2));
  const multTop = (m, code) => {
    const pool = m.pools[code];
    const probs = devigPoolProbabilities(pool.options, 'multiplicative').probs;
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
    const probs = devigPoolProbabilities(pool.options, 'multiplicative').probs;
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

  if (matches.length === 1) {
    const m0 = matches[0];
    const mainCode = m0.pools.HAD.single ? 'HAD' : 'HHAD';
    const p = multTop(m0, mainCode);
    const s = multSecondary(m0, mainCode, p.optionKey);
    const ttg = multTop(m0, 'TTG');
    const crsOpt = m0.pools.CRS.options.find((x) => x.label === '1:0') ?? m0.pools.CRS.options[0];
    const hafuOpt = m0.pools.HAFU.options.find((x) => x.key === 'dh') ?? m0.pools.HAFU.options[0];
    const crsLeg = {
      matchId: m0.id,
      matchNumStr: m0.matchNumStr,
      home: m0.home,
      away: m0.away,
      poolCode: 'CRS',
      poolName: '比分',
      optionKey: crsOpt.key,
      optionLabel: crsOpt.label,
      odds: crsOpt.odds,
      fairProb: 0.1,
    };
    const hafuLeg = {
      matchId: m0.id,
      matchNumStr: m0.matchNumStr,
      home: m0.home,
      away: m0.away,
      poolCode: 'HAFU',
      poolName: '半全场',
      optionKey: hafuOpt.key,
      optionLabel: hafuOpt.label,
      odds: hafuOpt.odds,
      fairProb: 0.15,
    };
    const half = Math.max(1, Math.floor(notes * 0.5));
    return [
      [matLine('leg-s-1', [p], Math.floor(notes * 0.65)), matLine('leg-s-2', [s], notes - Math.floor(notes * 0.65))],
      [matLine('leg-s-sp', [p], notes - half), matLine('leg-s-sh', [s], half)],
      [matLine('leg-s-ft1', [p], half), matLine('leg-s-ft2', [s], notes - half)],
      [matLine('leg-s-ttg', [ttg], notes)],
      [matLine('leg-s-crs', [crsLeg], half), matLine('leg-s-hafu', [hafuLeg], notes - half)],
    ].map((lines, idx) => ({
      key: `legacy-${idx + 1}`,
      totalCost: lines.reduce((a, l) => a + l.cost, 0),
      minReturn: Math.min(...lines.map((l) => l.returnPayout)),
      maxReturn: lines.reduce((a, l) => a + l.returnPayout, 0),
      lines,
    }));
  }

  const prims = matches.map((m) => multTop(m, 'HAD'));
  const alt0 = [...prims];
  alt0[0] = multSecondary(matches[0], 'HAD', prims[0].optionKey);

  // 1. Legacy iron-shield
  const p1 = [
    matLine('leg-iron-1', prims, Math.max(1, Math.floor(notes * 0.65))),
    matLine('leg-iron-2', alt0, Math.max(1, notes - Math.floor(notes * 0.65))),
  ];
  // 2. Legacy spear-shield with hardcoded 0.04 shield weight (causes shield inversion on 4+ matches!)
  const spProb = prims.reduce((a, g) => a * g.fairProb, 1);
  const shWeight = 0.04 / (spProb + 0.04);
  const shNotes = Math.min(notes - 1, Math.max(1, Math.round(notes * shWeight)));
  const p2 = [
    matLine('leg-spear', prims, Math.max(1, notes - shNotes)),
    matLine('leg-shield', alt0, shNotes),
  ];
  // 3. Legacy fault-tolerant unreduced 2-leg pairs
  const pairs = [];
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      pairs.push([prims[i], prims[j]]);
    }
  }
  const perPair = Math.max(1, Math.floor(notes / pairs.length));
  const p3 = pairs.map((legs, idx) => matLine(`leg-ft-${idx}`, legs, perPair));
  // 4. Legacy forced goal-structure (TTG parlay)
  const ttgLegs = matches.slice(0, Math.min(4, matches.length)).map((m) => multTop(m, 'TTG'));
  const p4 = [matLine('leg-ttg', ttgLegs, notes)];
  // 5. Legacy forced value-assassin (hardcoded CRS 1:0 + HAFU 平胜 script)
  const assLegs = matches.slice(0, 2).map((m, idx) => {
    if (idx === 0) {
      const o = m.pools.CRS.options.find((x) => x.label === '1:0') ?? m.pools.CRS.options[0];
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: 'CRS',
        poolName: '比分',
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: 0.1,
      };
    }
    const o = m.pools.HAFU.options.find((x) => x.key === 'dh') ?? m.pools.HAFU.options[0];
    return {
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: 'HAFU',
      poolName: '半全场',
      optionKey: o.key,
      optionLabel: o.label,
      odds: o.odds,
      fairProb: 0.15,
    };
  });
  const halfAss = Math.max(1, Math.floor(notes * 0.5));
  const qtrAss = Math.max(1, Math.floor(notes * 0.25));
  const p5 = [
    matLine('leg-ass-par', assLegs, halfAss),
    matLine('leg-ass-s1', [assLegs[0]], qtrAss),
    matLine('leg-ass-s2', [assLegs[1]], Math.max(1, notes - halfAss - qtrAss)),
  ];

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
    const prevEq = Math.max(1, equity);
    periodReturns.push(net / initialBankrollYuan);
    equity = Number((equity + net).toFixed(2));
    if (equity > peak) peak = equity;
    const ddYuan = Number((peak - equity).toFixed(2));
    const ddPct = peak > 0 ? Number(((ddYuan / peak) * 100).toFixed(2)) : 0;
    if (ddYuan > maxDrawdownYuan) maxDrawdownYuan = ddYuan;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    void prevEq;
  }

  const n = periodReturns.length;
  const mean = n > 0 ? periodReturns.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 1
      ? periodReturns.reduce((a, r) => a + (r - mean) * (r - mean), 0) / (n - 1)
      : 0;
  const std = Math.sqrt(Math.max(1e-12, variance));
  const sharpeRatio = Number(((mean / std) * Math.sqrt(12)).toFixed(4));

  return {
    finalEquityYuan: equity,
    maxDrawdownYuan,
    maxDrawdownPct,
    sharpeRatio,
  };
}

/**
 * Layer 4 · 双轨止损账本 12 周期完场实盘配对消融回放（Legacy 5流派 vs Spec 0008 3+1 帕累托 + 止损护栏）
 */
export function runLayer4LedgerAblationBenchmark(opts = {}) {
  const t0 = performance.now();
  const dailyStopLossYuan = Number.isFinite(opts.dailyStopLossYuan)
    ? Math.max(20, Math.round(opts.dailyStopLossYuan))
    : 300;
  const initialBankrollYuan = Number.isFinite(opts.initialBankrollYuan)
    ? Math.max(1000, Math.round(opts.initialBankrollYuan))
    : 5000;

  const { rawFixture, parsedMatches } = loadSettledFixtureBundle(
    opts.fixturePath || DEFAULT_SETTLED_FIXTURE_PATH
  );
  const rawById = new Map(rawFixture.matches.map((m) => [String(m.matchId), m]));
  const parsedById = new Map(parsedMatches.map((m) => [m.id, m]));

  let simNowMs = Date.parse('2026-10-02T12:00:00+08:00');
  const legacyLedger = createLedgerManager({ nowFn: () => simNowMs });
  const upgradedLedger = createLedgerManager({ nowFn: () => simNowMs });
  legacyLedger.mutateUserLedger('bench_legacy', {
    action: 'set-daily-limit',
    dailyLimit: dailyStopLossYuan,
  });
  upgradedLedger.mutateUserLedger('bench_upgraded', {
    action: 'set-daily-limit',
    dailyLimit: dailyStopLossYuan,
  });

  const legacyCycleNets = [];
  const upgradedCycleNets = [];
  let emptyAlphaAbstainCount = 0;
  let emptyAlphaSavedCash = 0;
  let stopLossInterceptedCount = 0;

  for (let cyc = 1; cyc <= rawFixture.cycleCount; cyc++) {
    const rawCycleMatches = rawFixture.matches.filter((m) => m.cycle === cyc);
    const pmCycle = rawCycleMatches.map((r) => parsedById.get(String(r.matchId)));
    simNowMs = Date.parse(`${rawCycleMatches[0].matchDate}T14:00:00+08:00`);

    // 3 matchday desk slates: 4-match early slate (¥80), 3-match late slate (¥80), 1-match featured slate (¥60)
    // Total legacy entries = 12 * 3 * 5 = 180 <= MAX_ENTRIES_PER_USER (200) -> zero truncation!
    const daySlates = [
      { matches: pmCycle.slice(0, 4), budget: 80 },
      { matches: pmCycle.slice(4, 7), budget: 80 },
      { matches: [pmCycle[7]], budget: 60 },
    ];

    let legDayNet = 0;
    let upgDayNet = 0;

    for (const sl of daySlates) {
      // A. Legacy unguarded forced 5-archetype betting
      const legPlans = buildLegacyFiveArchetypePlans(sl.matches, sl.budget);
      for (const pl of legPlans) {
        const added = legacyLedger.mutateUserLedger('bench_legacy', {
          action: 'add-entry',
          kind: 'live',
          forceConfirmed: true,
          cost: pl.totalCost,
          betCount: pl.lines.length,
          modeLabel: pl.key,
          minPayout: pl.minReturn,
          maxPayout: pl.maxReturn,
        });
        const actualReturn = settlePortfolioLines(pl.lines, rawById);
        const settled = legacyLedger.mutateUserLedger('bench_legacy', {
          action: 'settle-entry',
          entryId: added.entry.id,
          status: actualReturn > 0 ? 'won' : 'lost',
          settledReturn: actualReturn,
        });
        legDayNet += settled.entry.netProfit;
      }

      // B. Upgraded Spec 0008: Shin+DC + 3+1 Pareto + honest ¥0 alpha-radar + ¥300/day stop-loss routing to paper
      const upgPlans = generateParetoPortfolio(sl.matches, sl.budget, 'objective', false, []);
      for (const pl of upgPlans) {
        if (!pl.available || pl.totalCost <= 0 || pl.lines.length === 0) {
          emptyAlphaAbstainCount += 1;
          emptyAlphaSavedCash += pl.savedCash ?? sl.budget;
          continue;
        }

        let entryRes = upgradedLedger.mutateUserLedger('bench_upgraded', {
          action: 'add-entry',
          kind: 'live',
          cost: pl.totalCost,
          betCount: pl.lines.length,
          modeLabel: pl.shortTab,
          minPayout: pl.minReturn,
          maxPayout: pl.maxReturn,
        });
        if (!entryRes.ok && entryRes.code === 'STOP_LOSS_EXCEEDED') {
          stopLossInterceptedCount += 1;
          entryRes = upgradedLedger.mutateUserLedger('bench_upgraded', {
            action: 'add-entry',
            kind: 'paper',
            paperRefCost: pl.totalCost,
            betCount: pl.lines.length,
            modeLabel: pl.shortTab,
            minPayout: pl.minReturn,
            maxPayout: pl.maxReturn,
          });
        }

        const actualReturn = settlePortfolioLines(pl.lines, rawById);
        const settled = upgradedLedger.mutateUserLedger('bench_upgraded', {
          action: 'settle-entry',
          entryId: entryRes.entry.id,
          status: actualReturn > 0 ? 'won' : 'lost',
          settledReturn: actualReturn,
        });
        if (settled.entry.kind === 'live') {
          upgDayNet += settled.entry.netProfit;
        }
      }
    }

    legacyCycleNets.push(Number(legDayNet.toFixed(2)));
    upgradedCycleNets.push(Number(upgDayNet.toFixed(2)));
  }

  const legStats = legacyLedger.getUserLedger('bench_legacy').stats;
  const upgStats = upgradedLedger.getUserLedger('bench_upgraded').stats;
  const legRisk = computeCycleEquityCurveMetrics(legacyCycleNets, initialBankrollYuan);
  const upgRisk = computeCycleEquityCurveMetrics(upgradedCycleNets, initialBankrollYuan);

  return {
    cycleCount: rawFixture.cycleCount,
    matchCount: parsedMatches.length,
    dailyStopLossYuan,
    initialBankrollYuan,
    legacy: {
      ...legStats,
      ...legRisk,
    },
    upgraded: {
      ...upgStats,
      ...upgRisk,
      emptyAlphaAbstainCount,
      emptyAlphaSavedCash,
      stopLossInterceptedCount,
    },
    elapsedMs: performance.now() - t0,
  };
}

export function assembleQuantBenchmarkReport({ layer1, layer2, layer3, layer4, totalElapsedMs }) {
  const l1Pass =
    layer1.aggregate.coherentShinDc.rps < layer1.aggregate.multiplicative.rps &&
    layer1.aggregate.coherentShinDc.brier < layer1.aggregate.multiplicative.brier &&
    layer1.aggregate.coherentShinDc.logLoss < layer1.aggregate.multiplicative.logLoss &&
    layer1.aggregate.coherentShinDc.ece < layer1.aggregate.multiplicative.ece &&
    layer1.maxCrossPoolCoherenceError < 1e-12;

  const l2Pass =
    layer2.maxMarginalSumError < 1e-12 &&
    layer2.maxCrossPoolEquivError < 1e-12 &&
    layer2.maxComboSumError < 1e-9 &&
    layer2.maxLinearEvError < 1e-9 &&
    layer2.maxBruteForceDiff < 1e-9 &&
    layer2.statutoryRoundingAndCapErrors === 0 &&
    layer2.illegalTicketViolations === 0 &&
    layer2.probabilityOrderingViolations === 0 &&
    layer2.avgEightMatchWorkspaceMs < 15;

  const l3Pass =
    layer3.totalStrictDominations === 0 &&
    layer3.slates.every((s) => s.evalElapsedMs < 50);

  const l4Pass =
    layer4.upgraded.liveRoiPct > layer4.legacy.liveRoiPct &&
    layer4.upgraded.maxDrawdownYuan < layer4.legacy.maxDrawdownYuan &&
    layer4.upgraded.maxDrawdownPct < layer4.legacy.maxDrawdownPct &&
    layer4.upgraded.sharpeRatio > layer4.legacy.sharpeRatio &&
    layer4.upgraded.paperSavedAmount > 0 &&
    layer4.upgraded.emptyAlphaSavedCash > 0;

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
  const pad = ' '.repeat(width - s.length);
  return alignRight ? pad + s : s + pad;
}

export function formatQuantBenchmarkReport(report) {
  const { layer1, layer2, layer3, layer4, gates, allPassed, totalElapsedMs } = report;
  const out = [];

  out.push('========================================================================================');
  out.push('  优竞体育内部专用 · Spec 0008 四层客观科学验证基准报表 (Four-Layer Scientific Benchmark)');
  out.push('========================================================================================');
  out.push('');

  // Layer 1 Table
  out.push(
    `[Layer 1] 完场实盘概率校准度检验 (${layer1.matchCount} 场 × ${layer1.cycleCount} 周期 · 耗时 ${layer1.elapsedMs.toFixed(1)}ms · 状态: ${gates.l1Pass ? 'PASS' : 'FAIL'})`
  );
  out.push(
    'Pool      | Vig%   | Mult RPS -> Shin -> Coherent | Mult Brier -> Coherent | Mult LogLoss -> Coherent | Mult ECE -> Coherent'
  );
  out.push(
    '----------+--------+------------------------------+------------------------+--------------------------+---------------------'
  );
  for (const code of ALL_POOL_CODES) {
    const p = layer1.pools[code];
    out.push(
      `${padCell(code, 9)} | ${padCell(`${p.avgVigPct.toFixed(1)}%`, 6, true)} | ` +
        `${p.multiplicative.rps.toFixed(4)} -> ${p.shin.rps.toFixed(4)} -> ${p.coherentShinDc.rps.toFixed(4)} | ` +
        `${p.multiplicative.brier.toFixed(4)}  ->  ${p.coherentShinDc.brier.toFixed(4)}  | ` +
        `${p.multiplicative.logLoss.toFixed(4)}   ->   ${p.coherentShinDc.logLoss.toFixed(4)}   | ` +
        `${p.multiplicative.ece.toFixed(4)} ->  ${p.coherentShinDc.ece.toFixed(4)}`
    );
  }
  const agg = layer1.aggregate;
  out.push(
    `${padCell('ALL_5_AVG', 9)} | ${padCell('--', 6, true)} | ` +
      `${agg.multiplicative.rps.toFixed(4)} -> ${agg.shin.rps.toFixed(4)} -> ${agg.coherentShinDc.rps.toFixed(4)} | ` +
      `${agg.multiplicative.brier.toFixed(4)}  ->  ${agg.coherentShinDc.brier.toFixed(4)}  | ` +
      `${agg.multiplicative.logLoss.toFixed(4)}   ->   ${agg.coherentShinDc.logLoss.toFixed(4)}   | ` +
      `${agg.multiplicative.ece.toFixed(4)} ->  ${agg.coherentShinDc.ece.toFixed(4)}`
  );
  out.push('');

  // Layer 2 Summary
  out.push(
    `[Layer 2] 概率公理与联合分布零误差不变量 (${layer2.portfolioScenariosChecked} 组多维场景 · 耗时 ${layer2.elapsedMs.toFixed(1)}ms · 状态: ${gates.l2Pass ? 'PASS' : 'FAIL'})`
  );
  out.push(
    `  - 五池边缘归一最大误差      : ${layer2.maxMarginalSumError.toExponential(3)} (< 1e-12)`
  );
  out.push(
    `  - 跨盘同义闭合最大误差      : ${layer2.maxCrossPoolEquivError.toExponential(3)} (< 1e-12)`
  );
  out.push(
    `  - 联合状态 combos 概率守恒  : ${layer2.maxComboSumError.toExponential(3)} (< 1e-9)`
  );
  out.push(
    `  - 线性期望与 EV% 一致性误差 : ${layer2.maxLinearEvError.toExponential(3)} (< 1e-9)`
  );
  out.push(
    `  - 独立 139^M 暴力枚举对账差 : ${layer2.maxBruteForceDiff.toExponential(3)} (< 1e-9)`
  );
  out.push(
    `  - 法定舍入/封顶/出票违规数  : ${layer2.statutoryRoundingAndCapErrors + layer2.illegalTicketViolations} (0 error)`
  );
  out.push(
    `  - 8场满额工作区平均评估耗时 : ${layer2.avgEightMatchWorkspaceMs.toFixed(2)}ms (< 15.00ms)`
  );
  out.push('');

  // Layer 3 Table
  out.push(
    `[Layer 3] 万次蒙特卡洛四维单位本金帕累托前沿支配检验 (Seed=${layer3.seed} · ${layer3.samplesPerSlate}/盘面 · 耗时 ${layer3.elapsedMs.toFixed(1)}ms · 状态: ${gates.l3Pass ? 'PASS' : 'FAIL'})`
  );
  out.push(
    'Slate             | States | Tickets | Time(ms) | Slot1 Dom | Slot2 Dom | Slot3 Dom | Slot1 Floor | Slot3 Miss1CVaR'
  );
  out.push(
    '------------------+--------+---------+----------+-----------+-----------+-----------+-------------+----------------'
  );
  for (const sl of layer3.slates) {
    const [s1, s2, s3] = sl.slots;
    out.push(
      `${padCell(sl.name, 17)} | ${padCell(sl.quotientStateCount, 6, true)} | ${padCell(sl.candidateTicketCount, 7, true)} | ` +
        `${padCell(sl.evalElapsedMs.toFixed(1), 8, true)} | ` +
        `${padCell(s1.strictlyDominatedByCount, 9, true)} | ${padCell(s2.strictlyDominatedByCount, 9, true)} | ${padCell(s3.strictlyDominatedByCount, 9, true)} | ` +
        `${padCell(`${(s1.metrics.coveredFloorRatio * 100).toFixed(1)}%`, 11, true)} | ` +
        `${padCell(`${(s3.metrics.missOneCvarRatio * 100).toFixed(1)}%`, 14, true)}`
    );
  }
  out.push('');

  // Layer 4 Table
  out.push(
    `[Layer 4] 双轨止损账本 12 周期配对消融回放 (止损护栏 ¥${layer4.dailyStopLossYuan}/日 · 初始本金 ¥${layer4.initialBankrollYuan} · 耗时 ${layer4.elapsedMs.toFixed(1)}ms · 状态: ${gates.l4Pass ? 'PASS' : 'FAIL'})`
  );
  out.push(
    'Strategy                             | Live Bets | WinRate% | Staked(¥) | Net P&L(¥) | Live ROI% | MaxDD(¥ / %)        | Sharpe  | PaperSaved(¥) | EmptyAlphaSaved(¥)'
  );
  out.push(
    '-------------------------------------+-----------+----------+-----------+------------+-----------+---------------------+---------+---------------+-------------------'
  );
  const leg = layer4.legacy;
  const upg = layer4.upgraded;
  out.push(
    `${padCell('Legacy (Multiplicative + Forced 5)', 36)} | ${padCell(leg.liveSettledCount, 9, true)} | ${padCell(`${leg.liveWinRatePct.toFixed(2)}%`, 8, true)} | ` +
      `${padCell(leg.liveTotalStaked.toFixed(0), 9, true)} | ${padCell(leg.liveNetProfit.toFixed(2), 10, true)} | ${padCell(`${leg.liveRoiPct.toFixed(2)}%`, 9, true)} | ` +
      `${padCell(`¥${leg.maxDrawdownYuan.toFixed(2)} (${leg.maxDrawdownPct.toFixed(1)}%)`, 19, true)} | ${padCell(leg.sharpeRatio.toFixed(3), 7, true)} | ` +
      `${padCell(`¥${leg.paperSavedAmount.toFixed(0)}`, 13, true)} | ${padCell('¥0', 18, true)}`
  );
  out.push(
    `${padCell('Spec 0008 (Shin+DC + 3+1 + Guard)', 36)} | ${padCell(upg.liveSettledCount, 9, true)} | ${padCell(`${upg.liveWinRatePct.toFixed(2)}%`, 8, true)} | ` +
      `${padCell(upg.liveTotalStaked.toFixed(0), 9, true)} | ${padCell(upg.liveNetProfit.toFixed(2), 10, true)} | ${padCell(`${upg.liveRoiPct.toFixed(2)}%`, 9, true)} | ` +
      `${padCell(`¥${upg.maxDrawdownYuan.toFixed(2)} (${upg.maxDrawdownPct.toFixed(1)}%)`, 19, true)} | ${padCell(upg.sharpeRatio.toFixed(3), 7, true)} | ` +
      `${padCell(`¥${upg.paperSavedAmount.toFixed(0)}`, 13, true)} | ${padCell(`¥${upg.emptyAlphaSavedCash.toFixed(0)} (${upg.emptyAlphaAbstainCount}次)`, 18, true)}`
  );
  out.push('');
  out.push(
    `========================================================================================`
  );
  out.push(
    `  OVERALL VERDICT: ${allPassed ? 'ALL 4 SCIENTIFIC LAYERS PASSED' : 'BENCHMARK FAILED'} · Total Elapsed: ${totalElapsedMs.toFixed(1)}ms`
  );
  out.push(
    `========================================================================================`
  );

  return out.join('\n');
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
