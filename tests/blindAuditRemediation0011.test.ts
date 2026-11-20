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
});
