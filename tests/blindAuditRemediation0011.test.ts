import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  FALLBACK_MATCHES,
  archetypeToReport,
  bankerRoundParlayUnitPayout,
  calibrateMatchCoherentModel,
  computeProOrderInsights,
  computeTruthReport,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import type {
  ArchetypePlan,
  MatchItem,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.js";

const REAL_OOS_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/realSportteryOosMatches.json"
);

function loadOosMatches(limit = 32): MatchItem[] {
  const raw = JSON.parse(fs.readFileSync(REAL_OOS_PATH, "utf8"));
  return parseSportteryRawJson({
    value: { matchInfoList: [{ subMatchList: raw.matches.slice(0, limit) }] },
  }) as MatchItem[];
}

function makePick(
  m: MatchItem,
  poolCode: PoolCode,
  optionKey: string
): SelectedPick {
  const pool = m.pools[poolCode];
  const opt = pool.options.find(
    (o) => o.key === optionKey || o.label === optionKey
  )!;
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    poolCode,
    poolName: pool.name,
    singleAllowed: Boolean(pool.single),
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

describe("Spec 0011 · Blind-Audit Actuarial Precision & Honesty Remediation", () => {
  it("Slice 01 · Seam 1: preserves exact realProfitProb on >131,072-state legal duplexes, steps down statutory cap tier on voided legs, and applies 65..512-line server bonus plans while rejecting >64-line untrusted snapshots (<15ms)", () => {
    const oos = loadOosMatches(16);

    // 1. P0-1: 8 matches x 5 TTG options in 2串1 (700 bets <= 2,048, 6^8 = 1,679,616 > 131,072 states)
    const m8 = oos.slice(0, 8);
    const ttgKeys5 = ["s0", "s1", "s2", "s3", "s4"];
    const picks8x5 = m8.flatMap((m) =>
      ttgKeys5.map((k) => makePick(m, "TTG", k))
    );
    const rep8x5 = computeTruthReport(picks8x5, 1, m8, {
      mode: "free",
      passSizes: [2],
    });
    assert.equal(rep8x5.betCount, 700);
    assert.equal(rep8x5.canCheckout, true);

    // Independent exact reference enumeration over 6^8 = 1,679,616 states in typed array
    const stateProbs8 = m8.map((m) => {
      const ps = ttgKeys5.map(
        (k) => m.pools.TTG.options.find((o) => o.key === k)!.fairProb
      );
      const pMiss = Math.max(0, 1 - ps.reduce((a, b) => a + b, 0));
      return [...ps, pMiss];
    });
    const pairPayCents: number[][][][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () =>
        Array.from({ length: 6 }, () => new Array(6).fill(0))
      )
    );
    for (let i = 0; i < 8; i++) {
      for (let j = i + 1; j < 8; j++) {
        for (let a = 0; a < 5; a++) {
          const oa = m8[i].pools.TTG.options.find(
            (o) => o.key === ttgKeys5[a]
          )!.odds;
          for (let b = 0; b < 5; b++) {
            const ob = m8[j].pools.TTG.options.find(
              (o) => o.key === ttgKeys5[b]
            )!.odds;
            const u = Math.min(200_000, bankerRoundParlayUnitPayout([oa, ob]));
            pairPayCents[i][j][a][b] = Math.round(u * 100);
          }
        }
      }
    }
    const costCents = Math.round(rep8x5.totalCost * 100);
    let exactAnyWin = 0;
    let exactProfitProb = 0;
    let exactMinCents = Infinity;
    let exactMaxCents = 0;
    const chosen = new Int32Array(8);
    const walkRef = (depth: number, prob: number, accPay: number) => {
      if (depth === 7) {
        const p7 = stateProbs8[7];
        for (let s = 0; s < 6; s++) {
          let add = 0;
          if (s < 5) {
            for (let prev = 0; prev < 7; prev++) {
              const sp = chosen[prev];
              if (sp < 5) add += pairPayCents[prev][7][sp][s];
            }
          }
          const tot = accPay + add;
          if (tot > 0) {
            const lp = prob * p7[s];
            exactAnyWin += lp;
            if (tot >= costCents) exactProfitProb += lp;
            if (tot < exactMinCents) exactMinCents = tot;
            if (tot > exactMaxCents) exactMaxCents = tot;
          }
        }
        return;
      }
      const pd = stateProbs8[depth];
      for (let s = 0; s < 6; s++) {
        chosen[depth] = s;
        let add = 0;
        if (s < 5) {
          for (let prev = 0; prev < depth; prev++) {
            const sp = chosen[prev];
            if (sp < 5) add += pairPayCents[prev][depth][sp][s];
          }
        }
        walkRef(depth + 1, prob * pd[s], accPay + add);
      }
    };
    walkRef(0, 1, 0);

    assert.ok(
      Math.abs(rep8x5.anyWinProb - exactAnyWin) < 1e-12,
      `Expected exact anyWinProb ${exactAnyWin}, got ${rep8x5.anyWinProb}`
    );
    assert.ok(
      Math.abs(rep8x5.realProfitProb - exactProfitProb) < 1e-12,
      `Expected exact realProfitProb ${exactProfitProb} (~16.21%), got ${rep8x5.realProfitProb}`
    );
    assert.equal(rep8x5.minPayout, exactMinCents / 100);
    assert.equal(rep8x5.maxPayout, exactMaxCents / 100);

    // 2. P1-3: 4-leg parlay [void@1.0, 60, 60, 60] steps statutory cap down from 4-leg (¥500k) to 3-valid-leg (¥200k)!
    const fourCrsMatches = oos.slice(0, 4).map((m, idx) => ({
      ...m,
      id: `void-cap-m-${idx}`,
      pools: {
        ...m.pools,
        CRS: {
          ...m.pools.CRS,
          selling: true,
          options: m.pools.CRS.options.map((o) =>
            o.label === "3:2" ? { ...o, odds: 60.0 } : o
          ),
        },
      },
    }));
    const fourCrsPicks = fourCrsMatches.map((m) => makePick(m, "CRS", "3:2"));
    const wsVoid4 = evaluateQuantWorkspace(
      {
        picks: fourCrsPicks,
        multiple: 1,
        passSpec: { mode: "free", passSizes: [4] },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: true,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: fourCrsMatches.slice(0, 2).map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      fourCrsMatches
    );
    // Raw product = 2 * 1.0 * 60 * 60 * 60 = 432,000; 3 remaining valid legs cap at ¥200,000!
    assert.equal(
      wsVoid4.manualReport.tickets![0].unitPayout,
      200_000,
      `Expected 3-valid-leg statutory cap ¥200,000 on manualReport, got ${wsVoid4.manualReport.tickets![0].unitPayout}`
    );
    assert.equal(
      wsVoid4.appliedPlan!.lines[0].unitPayout,
      200_000,
      `Expected 3-valid-leg statutory cap ¥200,000 on appliedPlan, got ${wsVoid4.appliedPlan!.lines[0].unitPayout}`
    );

    // 3. P1-2: 8串247 (247 bets) & 4场全包4串1 (81 bets) server bonus plans succeed (non-null!), while untrusted >64-line archetype snapshot is still rejected!
    const eightHadPicks = m8.map((m) => makePick(m, "HAD", "h"));
    const ws8x247 = evaluateQuantWorkspace(
      {
        picks: eightHadPicks,
        multiple: 2,
        passSpec: { mode: "combo", comboCode: "8x247" },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
        targetIds: m8.map((m) => m.id),
        anchorToRadarPicks: true,
        budget: 500,
        stance: "objective",
        unlockFullAgg: false,
      },
      m8
    );
    assert.notEqual(
      ws8x247.appliedPlan,
      null,
      "Server-generated 247-line bonus plan must not silently drop to null"
    );
    assert.equal(ws8x247.appliedPlan!.lines.length, 247);
    assert.ok(ws8x247.effectiveReport.modeLabel.includes("分倍精算"));

    const fourAllHadPicks = m8
      .slice(0, 4)
      .flatMap((m) =>
        m.pools.HAD.options.map((o) => makePick(m, "HAD", o.key))
      );
    const ws81 = evaluateQuantWorkspace(
      {
        picks: fourAllHadPicks,
        multiple: 1,
        passSpec: { mode: "free", passSizes: [4] },
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: { kind: "bonus", optMode: "equal", scaleMultiple: 1 },
        targetIds: m8.slice(0, 4).map((m) => m.id),
        budget: 200,
        stance: "objective",
        unlockFullAgg: false,
      },
      m8.slice(0, 4)
    );
    assert.notEqual(ws81.appliedPlan, null);
    assert.equal(ws81.appliedPlan!.lines.length, 81);

    // Untrusted client archetype snapshot with 65 lines MUST still be rejected
    const forged65Snap: ArchetypePlan = {
      ...ws81.appliedPlan!,
      key: "max-ev-utility",
      lines: ws81.appliedPlan!.lines.slice(0, 65),
    };
    assert.equal(archetypeToReport(forged65Snap, null, m8), null);
    const wsForged65 = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          snapshotPlan: forged65Snap,
        },
        targetIds: [m8[0].id, m8[1].id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      m8
    );
    assert.notEqual(wsForged65.appliedPlan?.lines.length, 65);

    // Keep 8串247 workspace p50 latency < 15ms even with full 247-line bonus active!
    const latTimes: number[] = [];
    for (let r = 0; r < 11; r++) {
      const t0 = performance.now();
      evaluateQuantWorkspace(
        {
          picks: eightHadPicks,
          multiple: 2,
          passSpec: { mode: "combo", comboCode: "8x247" },
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: { kind: "bonus", optMode: "hot-first", scaleMultiple: 1 },
          targetIds: m8.map((m) => m.id),
          anchorToRadarPicks: true,
          budget: 500,
          stance: "objective",
          unlockFullAgg: false,
        },
        m8
      );
      latTimes.push(performance.now() - t0);
    }
    latTimes.sort((a, b) => a - b);
    assert.ok(
      latTimes[5] < 15,
      `Expected 8串247 active bonus p50 < 15ms, got ${latTimes[5].toFixed(2)}ms`
    );
  });

  it("Slice 02 · Seam 1: enforces single-eligibility & reduce-loss honesty on staggered hedge, aligns single-pool calibration + smooth HAD/HHAD ramp, and guards weakestLink with exact legal realProfitProb", () => {
    // 1. P0-3a: Late match with HAD.single=false & HHAD.single=false (FALLBACK_MATCHES[2] 周二005) MUST reject hedge
    const earlyM = FALLBACK_MATCHES[0] as MatchItem; // 20:00
    const nonSingleLate = FALLBACK_MATCHES[2] as MatchItem; // 03:45, hadSingle=false, hhadSingle=false
    const nonSinglePicks = [
      makePick(earlyM, "HAD", "h"),
      makePick(nonSingleLate, "HAD", "h"),
    ];
    const repNonSingle = computeTruthReport(nonSinglePicks, 5, [
      earlyM,
      nonSingleLate,
    ]);
    const insNonSingle = computeProOrderInsights(nonSinglePicks, repNonSingle, [
      earlyM,
      nonSingleLate,
    ]);
    assert.equal(
      insNonSingle.hedge.available,
      false,
      "Non-single late match cannot be hedged as a standalone ticket at a Sporttery shop"
    );
    assert.equal(insNonSingle.hedge.hedgeMode, "unavailable");
    assert.ok(
      insNonSingle.hedge.reason.includes("单关"),
      `Expected reason to explain missing single eligibility, got: ${insNonSingle.hedge.reason}`
    );

    // 2. P0-3b: Single-eligible late match with rounding/vig net loss MUST classify as reduce-loss with zero "提前锁利"/"保本" wording
    const lowOddsEarly: MatchItem = {
      ...earlyM,
      id: "20261117-011",
      kickoff: "20:00",
      pools: {
        ...earlyM.pools,
        HAD: {
          ...earlyM.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 1.08, trend: 0, fairProb: 0.82 },
            { key: "d", label: "平", odds: 6.5, trend: 0, fairProb: 0.11 },
            { key: "a", label: "客胜", odds: 11.0, trend: 0, fairProb: 0.07 },
          ],
        },
      },
    };
    const singleLate: MatchItem = {
      ...(FALLBACK_MATCHES[3] as MatchItem), // 20261117-007 03:45, single=true
      pools: {
        ...(FALLBACK_MATCHES[3] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.82, trend: 0, fairProb: 0.48 },
            { key: "d", label: "平", odds: 3.3, trend: 0, fairProb: 0.27 },
            { key: "a", label: "客胜", odds: 3.6, trend: 0, fairProb: 0.25 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[3] as MatchItem).pools.HHAD,
          single: true,
          selling: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.5, trend: 0, fairProb: 0.25 },
            { key: "hd", label: "让平", odds: 3.4, trend: 0, fairProb: 0.26 },
            { key: "ha", label: "让负", odds: 1.78, trend: 0, fairProb: 0.49 },
          ],
        },
      },
    };
    const reduceLossPicks = [
      makePick(lowOddsEarly, "HAD", "h"),
      makePick(singleLate, "HAD", "h"),
    ];
    const repReduceLoss = computeTruthReport(reduceLossPicks, 1, [
      lowOddsEarly,
      singleLate,
    ]);
    const insReduceLoss = computeProOrderInsights(
      reduceLossPicks,
      repReduceLoss,
      [lowOddsEarly, singleLate]
    );
    assert.equal(insReduceLoss.hedge.available, true);
    assert.ok(
      insReduceLoss.hedge.lockedNetProfit < 0,
      `Expected negative lockedNetProfit, got ${insReduceLoss.hedge.lockedNetProfit}`
    );
    assert.equal(insReduceLoss.hedge.hedgeMode, "reduce-loss");
    assert.ok(!insReduceLoss.hedge.reason.includes("提前锁利"));
    assert.ok(!insReduceLoss.hedge.reason.includes("保本"));

    // Positive net profit case -> hedgeMode === "lock-profit"
    const lockProfitPicks = [
      makePick(earlyM, "HAD", "h"),
      makePick(FALLBACK_MATCHES[3] as MatchItem, "HAD", "a"),
    ];
    const repLockProfit = computeTruthReport(lockProfitPicks, 15, [
      earlyM,
      FALLBACK_MATCHES[3] as MatchItem,
    ]);
    const insLockProfit = computeProOrderInsights(
      lockProfitPicks,
      repLockProfit,
      [earlyM, FALLBACK_MATCHES[3] as MatchItem]
    );
    assert.equal(insLockProfit.hedge.available, true);
    assert.ok(insLockProfit.hedge.lockedNetProfit > 0);
    assert.equal(insLockProfit.hedge.hedgeMode, "lock-profit");

    // 3. P2-1: Single-pool selling match aligns poolProbs & scoreGrid with shinProb/fairProb (<1e-12), and HAD/HHAD ramp has zero cliff at 0.12
    const singleHadOnly = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: "single-had-only",
                matchNumStr: "周六101",
                homeTeamAbbName: "甲队",
                awayTeamAbbName: "乙队",
                leagueAbbName: "测试赛",
                matchTime: "21:00:00",
                poolList: [
                  {
                    poolCode: "HAD",
                    single: 1,
                    cbtValue: 1,
                    poolStatus: "Selling",
                  },
                  {
                    poolCode: "HHAD",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "HAFU",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "TTG",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                  {
                    poolCode: "CRS",
                    single: 0,
                    cbtValue: 2,
                    poolStatus: "Suspended",
                  },
                ],
                had: { h: "1.42", d: "4.10", a: "5.85" },
              },
            ],
          },
        ],
      },
    })[0] as MatchItem;
    const calOnePool = calibrateMatchCoherentModel(singleHadOnly);
    assert.equal(calOnePool.coherent, false);
    assert.equal(calOnePool.sellingPoolCount, 1);
    for (const o of calOnePool.pools.HAD.options) {
      assert.ok(
        Math.abs(
          o.fairProb -
            calOnePool.poolProbs.HAD[
              o.key as keyof typeof calOnePool.poolProbs.HAD
            ]
        ) < 1e-12,
        `Single-pool HAD[${o.key}] fairProb=${o.fairProb} diverged from poolProbs.HAD=${calOnePool.poolProbs.HAD[o.key as keyof typeof calOnePool.poolProbs.HAD]}`
      );
    }

    // Continuity test across gap ~ 0.12 between HAD[h] and HHAD(-1)[hh+hd]
    const makeGapMatch = (hhadHaOdds: number): MatchItem => ({
      ...earlyM,
      id: `gap-test-${hhadHaOdds}`,
      pools: {
        ...earlyM.pools,
        HAD: {
          ...earlyM.pools.HAD,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.55, trend: 0, fairProb: 0.56 },
            { key: "d", label: "平", odds: 3.75, trend: 0, fairProb: 0.24 },
            { key: "a", label: "客胜", odds: 4.9, trend: 0, fairProb: 0.2 },
          ],
        },
        HHAD: {
          ...earlyM.pools.HHAD,
          selling: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.4, trend: 0, fairProb: 0.25 },
            { key: "hd", label: "让平", odds: 3.65, trend: 0, fairProb: 0.24 },
            {
              key: "ha",
              label: "让负",
              odds: hhadHaOdds,
              trend: 0,
              fairProb: 0.51,
            },
          ],
        },
      },
    });
    let maxStepJump = 0;
    let prevHadH: number | null = null;
    for (let haOdds = 1.55; haOdds <= 1.85; haOdds += 0.002) {
      const calStep = calibrateMatchCoherentModel(
        makeGapMatch(Number(haOdds.toFixed(4)))
      );
      const curH = calStep.pools.HAD.options[0].fairProb;
      if (prevHadH !== null) {
        maxStepJump = Math.max(maxStepJump, Math.abs(curH - prevHadH));
      }
      prevHadH = curH;
    }
    assert.ok(
      maxStepJump < 0.0025,
      `Expected smooth HAD/HHAD calibration across gap threshold (< 0.0025 per 0.002 odds step), got cliff ${maxStepJump}`
    );

    // 4. P2-2: weakestLink MUST NOT recommend cutting a 2-match non-single parlay into an un-checkoutable 1-match slip,
    // and on a valid 3-match slip with underwater branch MUST report exact afterRep.realProfitProb!
    const twoNonSingle = [
      FALLBACK_MATCHES[0] as MatchItem, // hadSingle=false
      FALLBACK_MATCHES[2] as MatchItem, // hadSingle=false
    ];
    const picks2NonSingle = [
      makePick(twoNonSingle[0], "HAD", "a"), // low prob drag leg
      makePick(twoNonSingle[1], "HAD", "h"), // non-single remaining leg!
    ];
    const rep2NonSingle = computeTruthReport(picks2NonSingle, 1, twoNonSingle);
    const ins2NonSingle = computeProOrderInsights(
      picks2NonSingle,
      rep2NonSingle,
      twoNonSingle
    );
    assert.equal(
      ins2NonSingle.weakestLink,
      null,
      "Must not suggest removing a leg when remaining 1-match slip cannot be checked out as single"
    );

    // Case 4b: False-positive trap — Match 5 (1.18+5.40) + Match 3 (1.66) + Match 2 (5.20):
    // Cutting Match 2 leaves 1.18*1.66*2 = ¥3.92 < ¥4.00 underwater, so realProfitProb stays ~8% (NOT ~50% anyWinProb)!
    const trapMatches = [
      FALLBACK_MATCHES[5] as MatchItem,
      FALLBACK_MATCHES[3] as MatchItem,
      FALLBACK_MATCHES[2] as MatchItem,
    ];
    const trapPicks = [
      makePick(trapMatches[0], "HAD", "h"),
      makePick(trapMatches[0], "HAD", "d"),
      makePick(trapMatches[1], "HAD", "a"),
      makePick(trapMatches[2], "HAD", "a"),
    ];
    const repTrap = computeTruthReport(trapPicks, 1, trapMatches);
    const insTrap = computeProOrderInsights(trapPicks, repTrap, trapMatches);
    assert.equal(
      insTrap.weakestLink,
      null,
      "Must NOT claim +40% win-rate jump when the favorite branch after cutting is underwater"
    );

    // Case 4c: True positive with underwater branch on real FALLBACK_MATCHES —
    // 波兰vs瑞典 all-3 HAD (2.38/3.15/2.58) + 法国vs以色列 HAD h (1.18) + drag 日本vs巴拉圭 HAD a (6.50, 13%):
    // After cutting 日本vs巴拉圭, 2.38*1.18*2=¥5.62 < ¥6 is underwater while 3.15 & 2.58 branches profit (~49% realProfitProb vs ~79% anyWinProb)!
    const mA = FALLBACK_MATCHES[2] as MatchItem; // 波兰 vs 瑞典
    const mB = FALLBACK_MATCHES[5] as MatchItem; // 法国 vs 以色列
    const mC = FALLBACK_MATCHES[1] as MatchItem; // 日本 vs 巴拉圭 (pick a @ 6.50, p=0.13)
    const threeMatches = [mA, mB, mC];
    const picks3WithUnderwater = [
      makePick(mA, "HAD", "h"),
      makePick(mA, "HAD", "d"),
      makePick(mA, "HAD", "a"),
      makePick(mB, "HAD", "h"),
      makePick(mC, "HAD", "a"),
    ];
    const rep3Before = computeTruthReport(
      picks3WithUnderwater,
      1,
      threeMatches
    );
    const ins3Before = computeProOrderInsights(
      picks3WithUnderwater,
      rep3Before,
      threeMatches
    );
    assert.notEqual(
      ins3Before.weakestLink,
      null,
      "Expected weakestLink to fire on 3-match slip with heavy drag leg"
    );
    const remainingAfterCut = picks3WithUnderwater.filter(
      (p) => p.matchId !== ins3Before.weakestLink!.matchId
    );
    const repAfterExact = computeTruthReport(
      remainingAfterCut,
      1,
      threeMatches
    );
    assert.equal(repAfterExact.canCheckout, true);
    assert.ok(
      repAfterExact.anyWinProb - repAfterExact.realProfitProb > 0.2,
      "Remaining 2串1 must have underwater branch so anyWinProb (~62%) >> realProfitProb (~33%)"
    );
    assert.ok(
      Math.abs(
        ins3Before.weakestLink!.afterRemoveProfitProb -
          repAfterExact.realProfitProb
      ) < 1e-12,
      `Expected weakestLink.afterRemoveProfitProb=${repAfterExact.realProfitProb}, got ${ins3Before.weakestLink!.afterRemoveProfitProb}`
    );
  });
});
