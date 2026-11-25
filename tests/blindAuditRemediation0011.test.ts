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
import { createLedgerManager } from "../server/ledgerManager.mjs";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";
import type {
  ArchetypePlan,
  MatchItem,
  PoolCode,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

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
      kickoff: "19:30",
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
    const early1930: MatchItem = { ...earlyM, kickoff: "19:30" };
    const lockProfitPicks = [
      makePick(early1930, "HAD", "h"),
      makePick(FALLBACK_MATCHES[3] as MatchItem, "HAD", "a"),
    ];
    const repLockProfit = computeTruthReport(lockProfitPicks, 15, [
      early1930,
      FALLBACK_MATCHES[3] as MatchItem,
    ]);
    const insLockProfit = computeProOrderInsights(
      lockProfitPicks,
      repLockProfit,
      [early1930, FALLBACK_MATCHES[3] as MatchItem]
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

  it("Slice 03 · Seam 1: fixes M=2 mutually exclusive cushion summing & blind-spot disclosure, enforces t>=2 covering wheel taxonomy + weighted 3-opt CVaR, and optimizes Slot ① hybrid single+2串1 & Slot ② exact log-wealth split", () => {
    const oos = loadOosMatches(40);

    // 1. P0-2a: M=2 on two non-single main-pool OOS matches (must use HAFU single cushions, NEVER sum same-match cushions, and disclose ¥0 reversal blind spot + zeroPayoutProb)
    const nonSinglePair = oos
      .filter((m) => !m.pools.HAD.single && !m.pools.HHAD.single)
      .slice(0, 2);
    assert.equal(nonSinglePair.length, 2);
    const plans2NonSingle = generateParetoPortfolio(
      nonSinglePair,
      100,
      "objective",
      false,
      []
    ) as ArchetypePlan[];
    const slot3NonSingle = plans2NonSingle[2];
    assert.equal(slot3NonSingle.key, "max-cvar-wheel");
    assert.equal(slot3NonSingle.available, true);

    // Compute true maximum achievable single-match cushion payout when exactly 1 match misses:
    // Within any single match's single-leg cushions in the same pool, options are mutually exclusive so at most ONE line can pay!
    const trueSurvivingByMissed = nonSinglePair.map((missedM) => {
      const survLines = slot3NonSingle.lines.filter(
        (l) => !l.legs.some((g) => g.matchId === missedM.id)
      );
      if (survLines.length === 0) return 0;
      // Since M=2 and missedM missed, all survLines belong to the single surviving match!
      // Mutually exclusive options in the same pool CANNOT both hit; guaranteed floor on covered cushion branches is min, and max is max (never sum!).
      return Math.min(...survLines.map((l) => l.returnPayout));
    });
    const exactGuaranteedCushionFloor = Math.min(...trueSurvivingByMissed);
    assert.ok(
      Math.abs(
        (slot3NonSingle.missOneReturn ?? 0) - exactGuaranteedCushionFloor
      ) < 1e-9,
      `M=2 missOneReturn (${slot3NonSingle.missOneReturn}) must equal guaranteed single-branch floor (${exactGuaranteedCushionFloor}), never summing mutually exclusive cushions!`
    );
    assert.ok(
      typeof slot3NonSingle.zeroPayoutProb === "number" &&
        Math.abs(slot3NonSingle.zeroPayoutProb - (1 - slot3NonSingle.winProb)) <
          1e-9,
      `Expected zeroPayoutProb = 1 - winProb (${1 - slot3NonSingle.winProb}), got ${slot3NonSingle.zeroPayoutProb}`
    );
    assert.ok(
      slot3NonSingle.tagline.includes("死角") ||
        slot3NonSingle.reasons.some((r) => r.includes("死角")),
      `Expected M=2 HAFU cushion plan to disclose half-time reversal ¥0 blind spot, got tagline="${slot3NonSingle.tagline}"`
    );

    // Sandbox slider must ALSO preserve non-summing missOneReturn on M=2!
    const wsSandboxed2 = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 5,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-cvar-wheel",
          snapshotPlan: slot3NonSingle,
        },
        targetIds: nonSinglePair.map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      nonSinglePair
    );
    assert.ok(
      Math.abs(
        (wsSandboxed2.appliedPlan?.missOneReturn ?? 0) -
          exactGuaranteedCushionFloor
      ) < 1e-9,
      `Sandboxed M=2 missOneReturn (${wsSandboxed2.appliedPlan?.missOneReturn}) must not sum mutually exclusive cushions`
    );

    // P0-2b: M=2 on two single-open matches (FALLBACK_MATCHES[1] & [3]) uses main-pool single cushions with 100% consensus coverage (zero reversal blind spot!)
    const singlePair = [
      FALLBACK_MATCHES[1] as MatchItem,
      FALLBACK_MATCHES[3] as MatchItem,
    ];
    const slot3SinglePair = generateParetoPortfolio(
      singlePair,
      100,
      "objective",
      false,
      []
    )[2] as ArchetypePlan;
    assert.ok(
      slot3SinglePair.lines
        .filter((l) => l.legs.length === 1)
        .every(
          (l) => l.legs[0].poolCode === "HAD" || l.legs[0].poolCode === "HHAD"
        ),
      "Single-open M=2 pair must use main-pool HAD/HHAD single cushions without HAFU reversal blind spot"
    );
    assert.ok(!slot3SinglePair.tagline.includes("逆转死角"));

    // 2. P1-4: Across all M=5..8 slates in OOS, "旋转矩阵缩水" ONLY appears when sub-blocks cover 100% of match pairs (t >= 2)!
    const checkPairCoverage = (
      mIds: string[],
      lines: ArchetypePlan["lines"]
    ) => {
      const v = mIds.length;
      const subBlocks = lines
        .filter((l) => l.legs.length < v)
        .map((l) => new Set(l.legs.map((g) => g.matchId)));
      if (subBlocks.length === 0) return false;
      for (let i = 0; i < v; i++) {
        for (let j = i + 1; j < v; j++) {
          const covered = subBlocks.some(
            (s) => s.has(mIds[i]) && s.has(mIds[j])
          );
          if (!covered) return false;
        }
      }
      return true;
    };

    for (const v of [5, 6, 7, 8]) {
      for (let offset = 0; offset <= 24; offset += 8) {
        const slate = oos.slice(offset, offset + v);
        if (slate.length < v) continue;
        const s3 = generateParetoPortfolio(
          slate,
          200,
          "objective",
          false,
          []
        )[2] as ArchetypePlan;
        const hasWheelName = s3.title.includes("旋转矩阵缩水");
        const isPairCover = checkPairCoverage(
          slate.map((m) => m.id),
          s3.lines
        );
        if (hasWheelName) {
          assert.equal(
            isPairCover,
            true,
            `False "旋转矩阵缩水" label on non-t=2 design: ${s3.title}`
          );
        } else {
          assert.ok(
            s3.title.includes("独立分块容错串") ||
              new RegExp(`${v}串\\d+`).test(s3.title),
            `Non-t=2 M=${v} design must use honest "独立分块容错串" or official "${v}串N", got: ${s3.title}`
          );
        }
        assert.ok(
          typeof s3.zeroPayoutProb === "number" &&
            Math.abs(s3.zeroPayoutProb - (1 - s3.winProb)) < 1e-9
        );
      }
    }

    // 3. P1-5a: Slot ① on mixed single + non-single 2-match slate beats BOTH pure 1-match single AND pure 2串1 via hybrid [single + 2串1] zero-underwater knapsack!
    const mixed2M: MatchItem[] = [
      FALLBACK_MATCHES[3] as MatchItem, // 威尔士 vs 葡萄牙: HAD.single=true (4.50 / 3.55 / 1.66, p = 0.21 / 0.25 / 0.54)
      FALLBACK_MATCHES[2] as MatchItem, // 波兰 vs 瑞典: HAD.single=false (2.38 / 3.15 / 2.58, p = 0.38 / 0.27 / 0.35)
    ];
    const slot1Mixed = generateParetoPortfolio(
      mixed2M,
      100,
      "objective",
      false,
      []
    )[0] as ArchetypePlan;
    const pure1MSlot1 = generateParetoPortfolio(
      [mixed2M[0]],
      100,
      "objective",
      false,
      []
    )[0] as ArchetypePlan;
    assert.equal(slot1Mixed.underwaterCount, 0);
    assert.ok(
      slot1Mixed.profitProb > pure1MSlot1.profitProb + 0.05 &&
        slot1Mixed.profitProb > 0.84,
      `Expected hybrid single + 2串1 zero-underwater Slot ① profitProb (${(slot1Mixed.profitProb * 100).toFixed(2)}%) > pure 1-match single (${(pure1MSlot1.profitProb * 100).toFixed(2)}%) + 5pp and > 84%`
    );
    assert.ok(
      slot1Mixed.lines.some((l) => l.legs.length === 1) &&
        slot1Mixed.lines.some((l) => l.legs.length === 2),
      "Expected Slot ① on mixed single/non-single pair to use genuine hybrid [1-leg single + 2串1] lines"
    );

    // Break-even note check: construct 1-match single where exact breakeven line (netProfit === 0) occurs at ¥20 budget (10 notes, odds 2.00 -> unitPayout 4.00, 5*4=20 -> netProfit=0)
    const exactBreakEvenMatch: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "be-single-m",
      pools: {
        ...(FALLBACK_MATCHES[1] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.0, trend: 0, fairProb: 0.45 },
            { key: "d", label: "平", odds: 2.0, trend: 0, fairProb: 0.44 },
            { key: "a", label: "客胜", odds: 7.5, trend: 0, fairProb: 0.11 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HHAD,
          selling: false,
        },
        HAFU: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAFU,
          selling: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.TTG,
          selling: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.CRS,
          selling: false,
        },
      },
    };
    const slot1Be = generateParetoPortfolio(
      [exactBreakEvenMatch],
      20,
      "objective",
      false,
      []
    )[0] as ArchetypePlan;
    if (slot1Be.lines.some((l) => Math.abs(l.netProfit) < 1e-9)) {
      assert.ok(
        slot1Be.reasons.some(
          (r) => r.includes("退回本金") || r.includes("保本")
        ) && !slot1Be.tagline.includes("100% 净赚"),
        `Break-even line must not be described as 100% 净赚 without disclosure: tagline=${slot1Be.tagline}`
      );
    }

    // 4. P1-5b: Slot ② on 1-match single-spear + cover achieves exact integer-optimal log-wealth utility (GAMMA=0.65) over all zero-underwater splits!
    const logOptMatch: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "log-opt-1m",
      pools: {
        ...(FALLBACK_MATCHES[1] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.35, trend: 0, fairProb: 0.4 },
            { key: "d", label: "平", odds: 2.65, trend: 0, fairProb: 0.35 },
            { key: "a", label: "客胜", odds: 3.6, trend: 0, fairProb: 0.25 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HHAD,
          selling: false,
        },
        HAFU: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAFU,
          selling: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.TTG,
          selling: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.CRS,
          selling: false,
        },
      },
    };
    const slot2Opt = generateParetoPortfolio(
      [logOptMatch],
      100,
      "objective",
      false,
      []
    )[1] as ArchetypePlan;
    assert.equal(slot2Opt.lines.length, 2);
    const cTot = slot2Opt.totalCost;
    const nTot = cTot / 2;
    const refW = Math.max(2, 100, cTot);
    const GAMMA = 0.65;
    const [ln0, ln1] = slot2Opt.lines;
    const pMiss = Math.max(0, 1 - ln0.prob - ln1.prob);
    const utilOf = (m0: number, m1: number) =>
      ln0.prob *
        Math.log(
          Math.max(1e-6, 1 + (GAMMA * (m0 * ln0.unitPayout - cTot)) / refW)
        ) +
      ln1.prob *
        Math.log(
          Math.max(1e-6, 1 + (GAMMA * (m1 * ln1.unitPayout - cTot)) / refW)
        ) +
      pMiss * Math.log(Math.max(1e-6, 1 - (GAMMA * cTot) / refW));
    const actualUtil = utilOf(ln0.multiple, ln1.multiple);
    const minM0 = Math.ceil((cTot - 1e-12) / ln0.unitPayout);
    const minM1 = Math.ceil((cTot - 1e-12) / ln1.unitPayout);
    let bestFeasibleUtil = -Infinity;
    for (let m0 = minM0; m0 <= nTot - minM1; m0++) {
      const m1 = nTot - m0;
      if (m0 < m1) continue; // spear-primary domain
      bestFeasibleUtil = Math.max(bestFeasibleUtil, utilOf(m0, m1));
    }
    assert.ok(
      Math.abs(actualUtil - bestFeasibleUtil) < 1e-12,
      `Slot ② integer split (${ln0.multiple}, ${ln1.multiple}) utility ${actualUtil} missed exact integer optimum ${bestFeasibleUtil}`
    );
  });

  it("Slice 04 · Seam 2 & UI Contracts: blocks >512-bet bonus opt honestly, calibrates hedge2 preset + reduce-loss UI, auto-dutches 2-pick equivalent swaps with single guard, clamps slider to [-15,15], and reports dual-sided paper ledger stats", async () => {
    const oos = loadOosMatches(16);
    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: async (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    const baseMatches = FALLBACK_MATCHES as MatchItem[];
    ctrl.applyAuthenticatedBundle({
      matches: baseMatches,
      initialPicks: [],
      workspace: evaluateQuantWorkspace(
        {
          picks: [],
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: baseMatches.slice(0, 2).map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        baseMatches
      ),
    });

    // 1. P2-4a & P0-3c: Built-in "hedge2" preset selects a single-eligible late match with positive lock-profit!
    ctrl.loadPresetScenario("hedge2");
    await ctrl.flush();
    const hedge2Ws = ctrl.getState().workspace;
    assert.equal(
      hedge2Ws.insights.hedge.available,
      true,
      `Preset hedge2 must be genuinely single-eligible and available, got reason: ${hedge2Ws.insights.hedge.reason}`
    );
    assert.equal(hedge2Ws.insights.hedge.hedgeMode, "lock-profit");
    assert.ok(
      hedge2Ws.insights.hedge.lockedNetProfit > 0,
      `Preset hedge2 must lock positive net profit, got ${hedge2Ws.insights.hedge.lockedNetProfit}`
    );

    // 2. P2-4b: Symmetric [-15, +15] subjectiveDeltaPct clamp in controller & server workspace
    ctrl.setSubjectiveDeltaPct(20);
    await ctrl.flush();
    assert.equal(ctrl.getState().subjectiveDeltaPct, 15);
    const evAt15 = ctrl.getState().workspace.subjectiveEVPct;
    const rawWsAt20 = evaluateQuantWorkspace(
      {
        ...ctrl.getState(),
        subjectiveDeltaPct: 20,
      },
      baseMatches
    );
    assert.ok(
      Math.abs(rawWsAt20.subjectiveEVPct - evAt15) < 1e-12,
      "Server evaluateQuantWorkspace must also clamp subjectiveDeltaPct at +15%"
    );
    ctrl.setSubjectiveDeltaPct(-25);
    assert.equal(ctrl.getState().subjectiveDeltaPct, -15);
    ctrl.setSubjectiveDeltaPct(0);
    await ctrl.flush();

    // 3. P1-2: >512-bet duplex (700 bets: 8 matches x 5 TTG in 2串1) blocks applyBonusOptimization with explicit reason!
    const m8 = oos.slice(0, 8);
    const picks700 = m8.flatMap((m) =>
      ["s0", "s1", "s2", "s3", "s4"].map((k) => makePick(m, "TTG", k))
    );
    ctrl.applyAuthenticatedBundle({
      matches: m8,
      initialPicks: picks700,
      workspace: evaluateQuantWorkspace(
        {
          picks: picks700,
          multiple: 1,
          passSpec: { mode: "free", passSizes: [2] },
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: m8.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        m8
      ),
    });
    // Lock 2串1 pass so betCount === 700 (> 512, <= 2,048)
    ctrl.toggleFreePassSize(2);
    await ctrl.flush();
    if (ctrl.getState().workspace.manualReport.betCount !== 700) {
      // Ensure exact [2] pass
      for (const fp of ctrl
        .getState()
        .workspace.manualReport.availableFreePasses.filter(
          (f) => f.active && f.size !== 2
        )) {
        ctrl.toggleFreePassSize(fp.size);
      }
      if (
        !ctrl
          .getState()
          .workspace.manualReport.availableFreePasses.find((f) => f.size === 2)
          ?.active
      ) {
        ctrl.toggleFreePassSize(2);
      }
      await ctrl.flush();
    }
    assert.equal(ctrl.getState().workspace.manualReport.betCount, 700);
    const blockedBonusRes = ctrl.applyBonusOptimization("equal") as {
      ok: boolean;
      blockedReason?: string;
    };
    assert.equal(blockedBonusRes.ok, false);
    assert.ok(
      blockedBonusRes.blockedReason &&
        blockedBonusRes.blockedReason.includes("512"),
      `Expected explicit >512 blockedReason, got: ${blockedBonusRes.blockedReason}`
    );
    assert.equal(ctrl.getState().planSpec, null);

    // 4. P2-3a & P2-3b: Single-match checkout guard on activeSwapTip / applyEquivalentSwap, AND auto-dutching on valid 2-pick swap!
    const hhadSingleHadNotMatch: MatchItem = {
      ...baseMatches[0],
      id: "swap-guard-m",
      pools: {
        ...baseMatches[0].pools,
        HAD: {
          ...baseMatches[0].pools.HAD,
          single: false, // NOT single-eligible!
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.95, trend: 0, fairProb: 0.46 },
            { key: "d", label: "平", odds: 3.6, trend: 0, fairProb: 0.25 },
            { key: "a", label: "客胜", odds: 3.8, trend: 0, fairProb: 0.29 },
          ],
        },
        HHAD: {
          ...baseMatches[0].pools.HHAD,
          single: true, // Single-eligible!
          selling: true,
          goalLine: "-1",
          options: [
            { key: "hh", label: "让胜", odds: 3.5, trend: 0, fairProb: 0.25 },
            { key: "hd", label: "让平", odds: 3.45, trend: 0, fairProb: 0.26 },
            { key: "ha", label: "让负", odds: 1.72, trend: 0, fairProb: 0.49 },
          ],
        },
      },
    };
    const oneSinglePick = [makePick(hhadSingleHadNotMatch, "HHAD", "ha")];
    const ws1Single = evaluateQuantWorkspace(
      {
        picks: oneSinglePick,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [hhadSingleHadNotMatch.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [hhadSingleHadNotMatch]
    );
    assert.equal(ws1Single.manualReport.canCheckout, true);
    assert.equal(
      ws1Single.insights.activeSwapTip,
      null,
      "Must NOT offer activeSwapTip into non-single HAD[d+a] when current slip is a 1-match single"
    );

    // On a 2-match parlay at even notes (multiple=6 -> 3+3 notes), HAD[d+a] swap strictly beats single AND auto-enables equal bonus dutching!
    const parlaySwapMatches = [hhadSingleHadNotMatch, baseMatches[1]];
    const parlaySwapPicks = [
      makePick(hhadSingleHadNotMatch, "HHAD", "ha"),
      makePick(baseMatches[1], "HAD", "h"),
    ];
    ctrl.applyAuthenticatedBundle({
      matches: parlaySwapMatches,
      initialPicks: parlaySwapPicks,
      workspace: evaluateQuantWorkspace(
        {
          picks: parlaySwapPicks,
          multiple: 6,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: parlaySwapMatches.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        parlaySwapMatches
      ),
    });
    const tip2M = ctrl.getState().workspace.insights.activeSwapTip;
    assert.notEqual(tip2M, null);
    assert.equal(tip2M!.betterPicks.length, 2);
    const swapped = ctrl.applyEquivalentSwap(tip2M!);
    assert.equal(swapped, true);
    await ctrl.flush();
    assert.equal(ctrl.getState().planSpec?.kind, "bonus");
    assert.equal(
      (ctrl.getState().planSpec as { kind: "bonus"; optMode: string }).optMode,
      "equal"
    );
    assert.equal(ctrl.getState().workspace.effectiveReport.underwaterCount, 0);

    // 5. P1-6: Dual-sided paper ledger stats (paperLostCount & paperWonCount alongside paperSavedAmount)
    const ledgerMgr = createLedgerManager({ nowFn: () => 1_763_640_000_000 });
    const addLost = ledgerMgr.mutateUserLedger("u-audit", {
      action: "add-entry",
      kind: "paper",
      title: "模拟单#1",
      modeLabel: "2串1",
      betCount: 1,
      paperRefCost: 80,
      minPayout: 180,
      maxPayout: 180,
    });
    const addWon = ledgerMgr.mutateUserLedger("u-audit", {
      action: "add-entry",
      kind: "paper",
      title: "模拟单#2",
      modeLabel: "2串1",
      betCount: 1,
      paperRefCost: 60,
      minPayout: 150,
      maxPayout: 150,
    });
    ledgerMgr.mutateUserLedger("u-audit", {
      action: "settle-entry",
      entryId: addLost.entry.id,
      status: "lost",
    });
    const snapAfter = ledgerMgr.mutateUserLedger("u-audit", {
      action: "settle-entry",
      entryId: addWon.entry.id,
      status: "won",
    }).ledger;
    assert.equal(snapAfter.stats.paperCount, 2);
    assert.equal(snapAfter.stats.paperLostCount, 1);
    assert.equal(snapAfter.stats.paperWonCount, 1);
    assert.equal(snapAfter.stats.paperSavedAmount, 80);

    // 6. Behavioral UI view-model & controller contracts (symmetric slider bounds, honest negative hedge copy, won paper entry & dual-sided paperWonCount)
    const {
      SUBJECTIVE_SLIDER_BOUNDS,
      buildLedgerEntryPresentation,
      formatHedgeDrawerCopy,
      formatLedgerStatsSummary,
    } = await import("../src/mobile/cabins/cabinViewModels.ts");

    assert.equal(SUBJECTIVE_SLIDER_BOUNDS.min, -15);
    assert.equal(SUBJECTIVE_SLIDER_BOUNDS.max, 15);
    const sliderCtrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (p, ms) => evaluateQuantWorkspace(p, ms),
    });
    sliderCtrl.setSubjectiveDeltaPct(20);
    assert.equal(
      sliderCtrl.getState().subjectiveDeltaPct,
      15,
      "Controller must clamp subjectiveDeltaPct symmetrically to <= +15"
    );

    const negHedgeCopy = formatHedgeDrawerCopy(
      {
        available: true,
        hedgeMode: "reduce-loss",
        gapMinutes: 240,
        gapText: "4h0m",
        earlyMatchTitle: "A vs B",
        lateMatchTitle: "C vs D",
        earlyKickoff: "19:35",
        lateKickoff: "23:35",
        oppositeLabel: "让负",
        oppositeOdds: 1.9,
        hedgeCost: 6,
        lockedNetProfit: -0.6,
        reason: "",
      },
      20
    );
    assert.ok(!JSON.stringify(negHedgeCopy).includes("保本锁回"));
    assert.ok(negHedgeCopy.lockedOutcomeText.includes("锁死少亏"));

    const wonPaperPres = buildLedgerEntryPresentation(
      snapAfter.entries.find(
        (e: any) => e.kind === "paper" && e.status === "won"
      )!
    );
    assert.ok(wonPaperPres.badgeText.includes("模拟命中"));
    const statsView = formatLedgerStatsSummary(snapAfter.stats);
    assert.equal(statsView.paperSavedSub, "模拟免损 (1亏/1中)");
  });

  it("Slice 05 · Two-Axis Review Remediation: seals snapshotPlan DoS & >2.2M-state 8x6/8x8 TTG exactness (<40ms), >2048-bet bonus gate, integer pair-hedge split, anchored Slot ② log-utility, weighted CVaR gain, and one-sided sandbox floor", async () => {
    const oos = loadOosMatches(16);
    const m8 = oos.slice(0, 8);

    // 1a. Untrusted 64-line cross-match CRS snapshotPlan across ALL 8 matches (17^8 = 6.98B raw states) MUST finish in < 50ms (zero event-loop DoS!)
    const advLines: ArchetypePlan["lines"] = [];
    for (let grp = 0; grp < 4; grp++) {
      const mA = m8[grp * 2];
      const mB = m8[grp * 2 + 1];
      const optsA = mA.pools.CRS.options.slice(0, 16);
      const optsB = mB.pools.CRS.options.slice(0, 16);
      for (let i = 0; i < 16; i++) {
        const legA = makePick(mA, "CRS", optsA[i].label);
        const legB = makePick(mB, "CRS", optsB[i].label);
        const u = Math.min(
          200_000,
          bankerRoundParlayUnitPayout([legA.odds, legB.odds])
        );
        advLines.push({
          id: `adv-${grp}-${i}`,
          roleLabel: "测试快照",
          legs: [
            { ...legA, kickoff: mA.kickoff },
            { ...legB, kickoff: mB.kickoff },
          ],
          modeLabel: "2串1",
          multiple: 1,
          cost: 2,
          unitPayout: u,
          returnPayout: u,
          netProfit: u - 128,
          prob: legA.fairProb * legB.fairProb,
        });
      }
    }
    const adv64Snap: ArchetypePlan = {
      key: "max-ev-utility",
      available: true,
      shortTab: "⚖️ 期望效用",
      badge: "测试",
      title: "对抗快照测试",
      tagline: "测试",
      totalCost: 128,
      savedCash: 0,
      minReturn: 10,
      maxReturn: 5000,
      winProb: 0.2,
      profitProb: 0.1,
      expectedValueRate: -0.2,
      underwaterCount: 0,
      missOneReturn: null,
      vigPct: 12,
      reasons: ["测试"],
      lines: advLines,
    };
    let advRep = archetypeToReport(adv64Snap, null, m8);
    const advSamples: number[] = [];
    for (let r = 0; r < 3; r++) {
      const tAdv0 = performance.now();
      advRep = archetypeToReport(adv64Snap, null, m8);
      advSamples.push(performance.now() - tAdv0);
    }
    advSamples.sort((a, b) => a - b);
    const advMs = advSamples[1];
    assert.notEqual(advRep, null);
    assert.ok(
      advMs < 50,
      `Expected adversarial 64-line 8-match CRS snapshotPlan (17^8 raw states) < 50ms, got ${advMs.toFixed(2)}ms`
    );

    // 1b. Legal >2.2M-state 8x6 TTG 2串1 (1,008 bets, 7^8 = 5.76M states) & 8x8 TTG 2串1 (1,792 bets, 8^8 = 16.78M states) exactness + p50 < 40ms!
    for (const kCount of [6, 8]) {
      const keys = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"].slice(
        0,
        kCount
      );
      const picks = m8.flatMap((m) => keys.map((k) => makePick(m, "TTG", k)));
      const samples: number[] = [];
      let rep = computeTruthReport(picks, 1, m8, {
        mode: "free",
        passSizes: [2],
      });
      for (let r = 0; r < 5; r++) {
        const t0 = performance.now();
        rep = computeTruthReport(picks, 1, m8, {
          mode: "free",
          passSizes: [2],
        });
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[2];
      assert.equal(rep.canCheckout, true);
      assert.ok(
        p50 < 40,
        `Expected 8x${kCount} TTG 2串1 (${rep.betCount} bets) p50 < 40ms, got ${p50.toFixed(2)}ms`
      );

      // Verify exact realProfitProb on 8x6 TTG against exact pair-table DFS reference
      if (kCount === 6) {
        const stProbs = m8.map((m) => {
          const ps = keys.map(
            (k) => m.pools.TTG.options.find((o) => o.key === k)!.fairProb
          );
          return [...ps, Math.max(0, 1 - ps.reduce((a, b) => a + b, 0))];
        });
        const pCents = Array.from({ length: 8 }, (_, i) =>
          Array.from({ length: 8 }, (_, j) => {
            if (j <= i) return null;
            const tbl = Array.from({ length: 7 }, () => new Int32Array(7));
            for (let a = 0; a < 6; a++) {
              const oa = m8[i].pools.TTG.options.find(
                (o) => o.key === keys[a]
              )!.odds;
              for (let b = 0; b < 6; b++) {
                const ob = m8[j].pools.TTG.options.find(
                  (o) => o.key === keys[b]
                )!.odds;
                tbl[a][b] = Math.round(
                  Math.min(200_000, bankerRoundParlayUnitPayout([oa, ob])) * 100
                );
              }
            }
            return tbl;
          })
        );
        const costC = rep.betCount * 200;
        let refWin = 0;
        let refProf = 0;
        let refMin = Infinity;
        let refMax = 0;
        const ch = new Int32Array(8);
        const walk6 = (d: number, p: number, acc: number) => {
          if (d === 7) {
            const p7 = stProbs[7];
            for (let s = 0; s < 7; s++) {
              let add = 0;
              if (s < 6) {
                for (let q = 0; q < 7; q++) {
                  const sq = ch[q];
                  if (sq < 6) add += pCents[q][7]![sq][s];
                }
              }
              const tot = acc + add;
              if (tot > 0) {
                const lp = p * p7[s];
                refWin += lp;
                if (tot >= costC) refProf += lp;
                if (tot < refMin) refMin = tot;
                if (tot > refMax) refMax = tot;
              }
            }
            return;
          }
          const pd = stProbs[d];
          for (let s = 0; s < 7; s++) {
            ch[d] = s;
            let add = 0;
            if (s < 6) {
              for (let q = 0; q < d; q++) {
                const sq = ch[q];
                if (sq < 6) add += pCents[q][d]![sq][s];
              }
            }
            walk6(d + 1, p * pd[s], acc + add);
          }
        };
        walk6(0, 1, 0);
        assert.ok(
          Math.abs(rep.anyWinProb - refWin) < 1e-12,
          `8x6 TTG anyWinProb ${rep.anyWinProb} != exact ${refWin}`
        );
        assert.ok(
          Math.abs(rep.realProfitProb - refProf) < 1e-12,
          `8x6 TTG realProfitProb ${rep.realProfitProb} != exact ${refProf} (lossy merge must not occur)`
        );
        assert.equal(rep.minPayout, refMin / 100);
        assert.equal(rep.maxPayout, refMax / 100);
      }
    }

    // 2. >2,048-bet slip (8 matches all-3 HAD in 8串1 = 6,561 bets, tickets=[]) MUST block applyBonusOptimization!
    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: async (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    const picks6561 = m8.flatMap((m) =>
      m.pools.HAD.options.map((o) => makePick(m, "HAD", o.key))
    );
    ctrl.applyAuthenticatedBundle({
      matches: m8,
      initialPicks: picks6561,
      workspace: evaluateQuantWorkspace(
        {
          picks: picks6561,
          multiple: 1,
          passSpec: { mode: "free", passSizes: [8] },
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: m8.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        m8
      ),
    });
    assert.ok(ctrl.getState().workspace.manualReport.betCount > 2048);
    assert.equal(
      ctrl.getState().workspace.manualReport.tickets?.length ?? 0,
      0
    );
    const res6561 = ctrl.applyBonusOptimization("equal") as {
      ok: boolean;
      blockedReason?: string;
    };
    assert.equal(
      res6561.ok,
      false,
      ">2048-bet blocked slip with tickets=[] must NOT bypass >512 bonus gate"
    );
    assert.ok(res6561.blockedReason?.includes("512"));
    assert.equal(ctrl.getState().planSpec, null);

    // 3. 2-option pair hedge exact ¥2 integer split:
    // Early 1.60 x Late d@3.82 -> targetReturn = ¥12.22, totalCost = ¥2; Late HAD single h@2.42 (u=4.84), a@2.42 (u=4.84):
    // Continuous harmonic 1.21 falsely claims ¥10 * 1.21 - 12 = +¥0.10 ("lock-profit"),
    // whereas EVERY physical integer split loses money: (2,2)->9.68-10=-¥0.32, (2,3)->9.68-12=-¥2.32, (3,3)->12.22-14=-¥1.78 ("reduce-loss")!
    const baseEarly = FALLBACK_MATCHES[0] as MatchItem;
    const baseLate = FALLBACK_MATCHES[3] as MatchItem;
    const pairHedgeEarly: MatchItem = {
      ...baseEarly,
      id: "20261117-021",
      kickoff: "19:30",
      pools: {
        ...baseEarly.pools,
        HAD: {
          ...baseEarly.pools.HAD,
          options: [
            { key: "h", label: "主胜", odds: 1.6, trend: 0, fairProb: 0.55 },
            { key: "d", label: "平", odds: 3.7, trend: 0, fairProb: 0.24 },
            { key: "a", label: "客胜", odds: 4.5, trend: 0, fairProb: 0.21 },
          ],
        },
      },
    };
    const pairHedgeLate: MatchItem = {
      ...baseLate,
      id: "20261117-027",
      kickoff: "03:45",
      pools: {
        ...baseLate.pools,
        HAD: {
          ...baseLate.pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.42, trend: 0, fairProb: 0.39 },
            { key: "d", label: "平", odds: 3.82, trend: 0, fairProb: 0.22 },
            { key: "a", label: "客胜", odds: 2.42, trend: 0, fairProb: 0.39 },
          ],
        },
        HHAD: {
          ...baseLate.pools.HHAD,
          selling: false,
          single: false,
        },
      },
    };
    const pairHedgePicks = [
      makePick(pairHedgeEarly, "HAD", "h"),
      makePick(pairHedgeLate, "HAD", "d"),
    ];
    const repPairHedge = computeTruthReport(pairHedgePicks, 1, [
      pairHedgeEarly,
      pairHedgeLate,
    ]);
    const insPairHedge = computeProOrderInsights(pairHedgePicks, repPairHedge, [
      pairHedgeEarly,
      pairHedgeLate,
    ]);
    assert.equal(insPairHedge.hedge.available, true);
    assert.equal(
      insPairHedge.hedge.lockedNetProfit,
      -0.32,
      `2-option pair hedge must evaluate physical ¥2 integer splits (best is (2,2) -> -¥0.32), got ${insPairHedge.hedge.lockedNetProfit}`
    );
    assert.equal(insPairHedge.hedge.hedgeMode, "reduce-loss");

    const { formatHedgeDrawerCopy } =
      await import("../src/mobile/cabins/cabinViewModels.ts");
    const beHedgeCopy = formatHedgeDrawerCopy(
      {
        ...insPairHedge.hedge,
        available: true,
        hedgeMode: "break-even",
        lockedNetProfit: 0,
      },
      20
    );
    assert.ok(
      beHedgeCopy.drawerTitle.includes("早晚场零损锁回本金") &&
        beHedgeCopy.rowHeader.includes("早晚场零损锁回本金"),
      "Break-even hedgeMode must render an honest neutral header instead of 对冲锁利"
    );

    // 4. Anchored M=1 Slot ② achieves exact integer-optimal log-wealth split AND honest Slot ② copy
    const anchored1M: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "anc-log-1m",
      pools: {
        ...(FALLBACK_MATCHES[1] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 2.35, trend: 0, fairProb: 0.4 },
            { key: "d", label: "平", odds: 2.65, trend: 0, fairProb: 0.35 },
            { key: "a", label: "客胜", odds: 3.6, trend: 0, fairProb: 0.25 },
          ],
        },
        HHAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HHAD,
          selling: false,
        },
        HAFU: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAFU,
          selling: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.TTG,
          selling: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.CRS,
          selling: false,
        },
      },
    };
    // ADR-0019 T Δ S = ∅: single-pick anchor [HAD:h] must NOT inject unpicked HAD:d without consent
    const slot2Anc1MPure = generateParetoPortfolio(
      [anchored1M],
      100,
      "objective",
      false,
      [makePick(anchored1M, "HAD", "h")]
    )[1] as ArchetypePlan;
    assert.equal(slot2Anc1MPure.lines.length, 1);

    // Explicit 2-way anchor [HAD:h, HAD:d] optimizes exact integer log-wealth utility split (28, 22) beyond minimum shield (31, 19)
    const slot2Anc1M = generateParetoPortfolio(
      [anchored1M],
      100,
      "objective",
      false,
      [makePick(anchored1M, "HAD", "h"), makePick(anchored1M, "HAD", "d")]
    )[1] as ArchetypePlan;
    assert.equal(slot2Anc1M.lines.length, 2);
    // For h@2.35 (p=0.40) + d@2.65 (p=0.35) at ¥100 (50 notes), minimum shield is ceil(100/5.30)=19 (split 31/19),
    // while exact log-wealth utility optimum is interior split (28, 22)!
    assert.ok(
      slot2Anc1M.lines[1].multiple >
        Math.ceil(slot2Anc1M.totalCost / slot2Anc1M.lines[1].unitPayout),
      `Anchored 1M Slot ② must optimize integer log-wealth utility beyond minimum breakeven shield, got (${slot2Anc1M.lines[0].multiple}, ${slot2Anc1M.lines[1].multiple})`
    );
    assert.ok(
      !slot2Anc1M.reasons.some((r) => r.includes("锁死最小保本护盾注数")),
      "Slot ② reasons must not falsely claim shields are always locked to minimum breakeven notes"
    );

    // 5. Probability-weighted miss-1 CVaR strictly beats uniform equal-multiple allocation on asymmetric 5-match C(5,3,2) slate
    const asym5: MatchItem[] = m8.slice(0, 5).map((m, idx) => ({
      ...m,
      id: `asym5-${idx}`,
      pools: {
        ...m.pools,
        HAD: {
          ...m.pools.HAD,
          selling: true,
          single: false,
          options:
            idx < 3
              ? [
                  {
                    key: "h",
                    label: "主胜",
                    odds: 1.22,
                    trend: 0,
                    fairProb: 0.76,
                  },
                  {
                    key: "d",
                    label: "平",
                    odds: 5.1,
                    trend: 0,
                    fairProb: 0.15,
                  },
                  {
                    key: "a",
                    label: "客胜",
                    odds: 9.0,
                    trend: 0,
                    fairProb: 0.09,
                  },
                ]
              : [
                  {
                    key: "h",
                    label: "主胜",
                    odds: 2.15,
                    trend: 0,
                    fairProb: 0.42,
                  },
                  {
                    key: "d",
                    label: "平",
                    odds: 3.2,
                    trend: 0,
                    fairProb: 0.29,
                  },
                  {
                    key: "a",
                    label: "客胜",
                    odds: 3.05,
                    trend: 0,
                    fairProb: 0.29,
                  },
                ],
        },
        HHAD: { ...m.pools.HHAD, selling: false },
        HAFU: { ...m.pools.HAFU, selling: false },
        TTG: { ...m.pools.TTG, selling: false },
        CRS: { ...m.pools.CRS, selling: false },
      },
    }));
    const slot3Asym5 = generateParetoPortfolio(
      asym5,
      120,
      "objective",
      false,
      []
    )[2] as ArchetypePlan;
    const subLines5 = slot3Asym5.lines.filter((l) => l.legs.length < 5);
    const calProbs5 = asym5.map(
      (m) => calibrateMatchCoherentModel(m).pools.HAD.options[0].fairProb
    );
    const weights5 = calProbs5.map((p) => (1 - p) / p);
    const wSum5 = weights5.reduce((a, b) => a + b, 0);
    const normW5 = weights5.map((w) => w / wSum5);
    const calcWeightedCvar = (mults: number[]) => {
      const vec = asym5.map((missedM, x) => ({
        w: normW5[x],
        pay: subLines5.reduce(
          (acc, l, bi) =>
            acc +
            (l.legs.some((g) => g.matchId === missedM.id)
              ? 0
              : mults[bi] * l.unitPayout),
          0
        ),
      }));
      vec.sort((a, b) => a.pay - b.pay);
      let rem = 0.5;
      let s = 0;
      for (const item of vec) {
        const take = Math.min(rem, item.w);
        s += take * item.pay;
        rem -= take;
        if (rem <= 1e-15) break;
      }
      return s / 0.5;
    };
    const subNotes5 = subLines5.reduce((a, l) => a + l.multiple, 0);
    const baseEq = Math.floor(subNotes5 / subLines5.length);
    const eqMults = subLines5.map(
      (_, i) => baseEq + (i < subNotes5 % subLines5.length ? 1 : 0)
    );
    assert.ok(
      calcWeightedCvar(subLines5.map((l) => l.multiple)) >
        calcWeightedCvar(eqMults) + 1e-6,
      "Probability-weighted wheel allocation must strictly beat uniform equal-multiple allocation on asymmetric miss-1 slate"
    );

    // 6. One-sided M=2 cushion plan MUST keep missOneReturn === 0 under sandbox slider!
    const noSingleAllPools: MatchItem = {
      ...(FALLBACK_MATCHES[2] as MatchItem),
      id: "no-single-any-pool",
      pools: {
        HAD: { ...(FALLBACK_MATCHES[2] as MatchItem).pools.HAD, single: false },
        HHAD: {
          ...(FALLBACK_MATCHES[2] as MatchItem).pools.HHAD,
          single: false,
        },
        HAFU: {
          ...(FALLBACK_MATCHES[2] as MatchItem).pools.HAFU,
          selling: false,
          single: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[2] as MatchItem).pools.TTG,
          selling: false,
          single: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[2] as MatchItem).pools.CRS,
          selling: false,
          single: false,
        },
      },
    };
    const oneSidePair = [FALLBACK_MATCHES[1] as MatchItem, noSingleAllPools];
    const slot3OneSide = generateParetoPortfolio(
      oneSidePair,
      100,
      "objective",
      false,
      []
    )[2] as ArchetypePlan;
    assert.equal(slot3OneSide.missOneReturn, 0);
    const wsOneSideSandboxed = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 5,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-cvar-wheel",
          snapshotPlan: slot3OneSide,
        },
        targetIds: oneSidePair.map((m) => m.id),
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      oneSidePair
    );
    assert.equal(
      wsOneSideSandboxed.appliedPlan?.missOneReturn,
      0,
      "Sandboxed one-sided M=2 cushion plan must preserve missOneReturn === 0 when the uncushioned match misses"
    );

    // 7. applyEquivalentSwap computes exact post-swap betCount (486 <= 512) instead of crude betCount * 2 (972 > 512)!
    const swap6Matches: MatchItem[] = [
      {
        ...(FALLBACK_MATCHES[0] as MatchItem),
        id: "swap6-m0",
        pools: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools,
          HAD: {
            ...(FALLBACK_MATCHES[0] as MatchItem).pools.HAD,
            selling: true,
            options: [
              { key: "h", label: "主胜", odds: 1.95, trend: 0, fairProb: 0.46 },
              { key: "d", label: "平", odds: 3.6, trend: 0, fairProb: 0.25 },
              { key: "a", label: "客胜", odds: 3.8, trend: 0, fairProb: 0.29 },
            ],
          },
          HHAD: {
            ...(FALLBACK_MATCHES[0] as MatchItem).pools.HHAD,
            selling: true,
            goalLine: "-1",
            options: [
              { key: "hh", label: "让胜", odds: 3.5, trend: 0, fairProb: 0.25 },
              {
                key: "hd",
                label: "让平",
                odds: 3.45,
                trend: 0,
                fairProb: 0.26,
              },
              {
                key: "ha",
                label: "让负",
                odds: 1.72,
                trend: 0,
                fairProb: 0.49,
              },
            ],
          },
        },
      },
      ...m8.slice(1, 6),
    ];
    const swap6Picks = [
      makePick(swap6Matches[0], "HHAD", "ha"),
      ...swap6Matches
        .slice(1)
        .flatMap((m) =>
          m.pools.HAD.options.map((o) => makePick(m, "HAD", o.key))
        ),
    ];
    ctrl.applyAuthenticatedBundle({
      matches: swap6Matches,
      initialPicks: swap6Picks,
      workspace: evaluateQuantWorkspace(
        {
          picks: swap6Picks,
          multiple: 2,
          passSpec: { mode: "free", passSizes: [6] },
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: swap6Matches.map((m) => m.id),
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        swap6Matches
      ),
    });
    ctrl.setDirectMultiple(2);
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.manualReport.betCount, 243);
    const swapOk486 = ctrl.applyEquivalentSwap({
      matchId: "swap6-m0",
      title: "同义替换测试",
      betterChoice: "胜平负[平+客胜]",
      worseChoice: "让球[让负]",
      edgePct: 8.5,
      detail: "测试",
      betterPicks: [
        { poolCode: "HAD", optionKey: "d" },
        { poolCode: "HAD", optionKey: "a" },
      ],
      worsePicks: [{ poolCode: "HHAD", optionKey: "ha" }],
      poolCode: "HAD",
      optionKey: "d",
    });
    assert.equal(swapOk486, true);
    await ctrl.flush();
    assert.equal(ctrl.getState().workspace.manualReport.betCount, 486);
    assert.equal(
      ctrl.getState().planSpec?.kind,
      "bonus",
      "Post-swap betCount is 486 <= 512 so auto equal bonus dutching MUST activate"
    );
  });
});
