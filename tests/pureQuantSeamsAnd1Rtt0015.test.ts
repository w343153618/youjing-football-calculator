import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as quantModule from "../server/quantEngine.mjs";
import {
  FALLBACK_MATCHES,
  archetypeToReport,
  bankerRoundParlayUnitPayout,
  computeTruthReport,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  optimizeBonusPlan,
  settleTicketSnapshotWithOfficialResults,
} from "../server/quantEngine.mjs";
import type {
  ArchetypePlan,
  MatchItem,
  QuantWorkspaceResponse,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

function makePick(
  m: MatchItem,
  poolCode: "HAD" | "HHAD" | "HAFU" | "TTG" | "CRS",
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
    singleAllowed: pool.single,
    optionKey: opt.key,
    optionLabel: opt.label,
    odds: opt.odds,
    fairProb: opt.fairProb,
  };
}

describe("Spec #5 · Ticket #6: Pure Quant Seams, Unified Two-Stage Dutching & 1-RTT Objective Portfolio", () => {
  it("Slice 1 (1-RTT Objective Portfolio Contract): includes exact objectivePortfolioPlans when stance !== 'objective' and omits it when stance === 'objective'", () => {
    const matches = FALLBACK_MATCHES as MatchItem[];
    const targetIds = [matches[0].id, matches[1].id, matches[2].id];
    const radarPicks = [
      makePick(matches[0], "HAD", "h"),
      makePick(matches[1], "HAD", "h"),
    ];

    const objRes = evaluateQuantWorkspace(
      {
        picks: radarPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds,
        anchorToRadarPicks: true,
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      matches
    ) as QuantWorkspaceResponse;

    assert.equal(
      objRes.objectivePortfolioPlans,
      undefined,
      "objective stance must omit objectivePortfolioPlans (zero redundant baseline payload)"
    );
    assert.equal(
      "objectivePortfolioPlans" in objRes,
      false,
      "objective stance must not serialize an objectivePortfolioPlans key"
    );

    for (const nonObjStance of ["home-lean", "upset-watch"] as const) {
      const tiltedRes = evaluateQuantWorkspace(
        {
          picks: radarPicks,
          multiple: 5,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds,
          anchorToRadarPicks: true,
          budget: 100,
          stance: nonObjStance,
          unlockFullAgg: false,
        },
        matches
      ) as QuantWorkspaceResponse;

      assert.ok(
        Array.isArray(tiltedRes.objectivePortfolioPlans),
        `stance='${nonObjStance}' must return objectivePortfolioPlans in a single call`
      );
      assert.equal(
        tiltedRes.objectivePortfolioPlans!.length,
        objRes.portfolioPlans.length
      );
      assert.deepEqual(
        tiltedRes.objectivePortfolioPlans!.map((p) => ({
          key: p.key,
          available: p.available,
          totalCost: p.totalCost,
          profitProb: p.profitProb,
          expectedValueRate: p.expectedValueRate,
          lineCount: p.lines.length,
        })),
        objRes.portfolioPlans.map((p) => ({
          key: p.key,
          available: p.available,
          totalCost: p.totalCost,
          profitProb: p.profitProb,
          expectedValueRate: p.expectedValueRate,
          lineCount: p.lines.length,
        })),
        `objectivePortfolioPlans under '${nonObjStance}' must match standalone objective portfolioPlans`
      );
      // Verify tilted portfolioPlans actually reflects the stance tilt while objectivePortfolioPlans stays objective
      assert.notEqual(
        tiltedRes.portfolioPlans[0].profitProb,
        tiltedRes.objectivePortfolioPlans![0].profitProb,
        `tilted portfolioPlans[0].profitProb must differ from objective baseline under '${nonObjStance}'`
      );
    }
  });

  it("Slice 2 (Unified Two-Stage Inverse-Odds Dutching): enforces -1e-9 IEEE-754 ceiling guard on 42/2.80 breakeven and Stage-1 exact-refund lift by descending probability across portfolio, bonus, and synthetic-single allocators", () => {
    // 1. IEEE-754 float boundary: odds 1.40 -> unitPayout = 2.80, where 42 / 2.8 === 15.000000000000002 in Float64!
    //    On [hh@1.40 (u=2.80), dh@5.95 (u=11.90), dd@10.50 (u=21.00)] at budget = ¥42 (21 notes),
    //    [15, 4, 2] (15+4+2 = 21 notes) is the UNIQUE feasible 3-line zero-underwater solution in [18..21] notes!
    const baseM = FALLBACK_MATCHES[0] as MatchItem;
    const floatBoundaryMatch: MatchItem = {
      ...baseM,
      id: "dutch-ieee754-42-over-2p8",
      pools: {
        ...baseM.pools,
        HAD: {
          ...baseM.pools.HAD,
          single: false,
          selling: true,
          options: [
            { key: "h", label: "主胜", odds: 1.35, trend: 0, fairProb: 0.66 },
            { key: "d", label: "平", odds: 4.5, trend: 0, fairProb: 0.2 },
            { key: "a", label: "客胜", odds: 6.5, trend: 0, fairProb: 0.14 },
          ],
        },
        HHAD: { ...baseM.pools.HHAD, selling: false, options: [] },
        HAFU: {
          ...baseM.pools.HAFU,
          single: true,
          selling: true,
          options: [
            { key: "hh", label: "胜胜", odds: 1.4, trend: 0, fairProb: 0.5 },
            { key: "dh", label: "平胜", odds: 5.95, trend: 0, fairProb: 0.15 },
            { key: "dd", label: "平平", odds: 10.5, trend: 0, fairProb: 0.09 },
            { key: "ah", label: "负胜", odds: 45.0, trend: 0, fairProb: 0.01 },
            { key: "hd", label: "胜平", odds: 18.0, trend: 0, fairProb: 0.05 },
            { key: "ad", label: "负平", odds: 18.0, trend: 0, fairProb: 0.04 },
            { key: "ha", label: "胜负", odds: 40.0, trend: 0, fairProb: 0.02 },
            { key: "da", label: "平负", odds: 12.0, trend: 0, fairProb: 0.07 },
            { key: "aa", label: "负负", odds: 10.0, trend: 0, fairProb: 0.07 },
          ],
        },
        TTG: { ...baseM.pools.TTG, selling: false, options: [] },
        CRS: { ...baseM.pools.CRS, selling: false, options: [] },
      },
    };

    const plans42 = generateParetoPortfolio(
      [floatBoundaryMatch],
      42,
      "objective",
      false,
      []
    );
    const slot3 = plans42.find((p) => p.key === "max-cvar-wheel")!;
    assert.equal(
      slot3.lines.length,
      3,
      "Zero-underwater cushion dutching must preserve all 3 lines [15, 4, 2] at ¥42 (fixing Math.ceil(42 / 2.8) === 16 drift)"
    );
    assert.deepEqual(
      Object.fromEntries(
        slot3.lines.map((l) => [l.legs[0].optionKey, l.multiple])
      ),
      { hh: 15, dh: 4, dd: 2 }
    );
    assert.equal(slot3.totalCost, 42);
    assert.equal(slot3.underwaterCount, 0);

    // 2. Stage-1 exact-refund lift: at ¥20 (10 notes), Pick 1 (u=4.00, prob=0.50 -> 5x=¥20 exact refund)
    //    and Pick 2 (u=10.00, prob=0.22 -> 2x=¥20 exact refund, higher u*prob=2.20 > 2.00) + Pick 3 (u=12.00, prob=0.15 -> 2x=¥24).
    //    Stage 1 MUST lift highest-prob exact-refund Pick 1 from 5x -> 6x ([6, 2, 2]), maximizing strictNetGainProb!
    const stage1Picks: SelectedPick[] = [
      {
        matchId: "stage1-matchless-1",
        matchNumStr: "周六101",
        home: "甲队",
        away: "乙队",
        poolCode: "HAFU",
        poolName: "半全场",
        singleAllowed: true,
        optionKey: "hh",
        optionLabel: "胜胜",
        odds: 2.0,
        fairProb: 0.5,
      },
      {
        matchId: "stage1-matchless-1",
        matchNumStr: "周六101",
        home: "甲队",
        away: "乙队",
        poolCode: "HAFU",
        poolName: "半全场",
        singleAllowed: true,
        optionKey: "dh",
        optionLabel: "平胜",
        odds: 5.0,
        fairProb: 0.22,
      },
      {
        matchId: "stage1-matchless-1",
        matchNumStr: "周六101",
        home: "甲队",
        away: "乙队",
        poolCode: "HAFU",
        poolName: "半全场",
        singleAllowed: true,
        optionKey: "dd",
        optionLabel: "平平",
        odds: 6.0,
        fairProb: 0.15,
      },
    ];
    const manualStage1 = computeTruthReport(stage1Picks, 4, []);
    const equalBonus = optimizeBonusPlan(manualStage1, [], "equal", {
      targetBudgetCost: 20,
    })!;
    assert.equal(equalBonus.totalCost, 20);
    assert.deepEqual(
      equalBonus.lines.map((l: { multiple: number }) => l.multiple),
      [6, 2, 2],
      "Equal bonus optimization must apply Stage-1 exact-refund lift to highest-prob Pick 1 ([6, 2, 2]) instead of ev tie-break ([5, 3, 2])"
    );
    assert.ok(
      (equalBonus.strictNetGainProb ?? 0) >= 0.64,
      `Expected strictNetGainProb >= 0.64 after lifting 50% exact-refund favorite, got ${equalBonus.strictNetGainProb}`
    );
  });

  it("Slice 3 (Unified Atomic Re-Alignment & Statutory Report/Warning Pipeline): keeps multi-pool frozen snapshot, standalone bonus opt, manual report, and plan report 100% consistent", () => {
    const m1 = FALLBACK_MATCHES[1] as MatchItem; // HAD single + HHAD
    const m2 = FALLBACK_MATCHES[2] as MatchItem;

    // 1. Multi-pool frozen snapshotPlan on m1 (HAD 'h' + HHAD 'hh' tilted under home-lean):
    //    standalone archetypeToReport vs evaluateQuantWorkspace(applySandboxToPlan) must align atomic probabilities identically!
    const homeLeanPlans = generateParetoPortfolio(
      [m1, m2],
      100,
      "home-lean",
      false,
      []
    );
    const baseLegHad = homeLeanPlans
      .flatMap((p) => p.lines.flatMap((l) => l.legs))
      .find((g) => g.matchId === m1.id && g.poolCode === "HAD") ?? {
      matchId: m1.id,
      matchNumStr: m1.matchNumStr,
      home: m1.home,
      away: m1.away,
      kickoff: m1.kickoff,
      poolCode: "HAD" as const,
      poolName: m1.pools.HAD.name,
      optionKey: "h",
      optionLabel: "主胜",
      odds: m1.pools.HAD.options[0].odds,
      fairProb: Math.min(0.92, m1.pools.HAD.options[0].fairProb * 1.08),
    };
    const hhadOpt = m1.pools.HHAD.options[0];
    const m2Opt = m2.pools.HAD.options[0];
    const sglUnit = bankerRoundParlayUnitPayout([baseLegHad.odds]);
    const parUnit = bankerRoundParlayUnitPayout([hhadOpt.odds, m2Opt.odds]);
    const multiPoolFrozenSnap: ArchetypePlan = {
      key: "max-profit-prob",
      available: true,
      shortTab: "🛡️ 稳健保本",
      badge: "🛡️ 稳健保本",
      title: "跨池混合冻结快照一致性校验",
      tagline: "单关缓冲 + 让球2串1",
      totalCost: 20,
      savedCash: 0,
      minReturn: 20,
      maxReturn: 60,
      winProb: 0.6,
      profitProb: 0.5,
      expectedValueRate: -0.1,
      underwaterCount: 0,
      missOneReturn: null,
      vigPct: 12,
      reasons: ["test"],
      lines: [
        {
          id: "mp-sgl",
          roleLabel: "单关护盾",
          modeLabel: "单关",
          multiple: 6,
          cost: 12,
          unitPayout: sglUnit,
          returnPayout: Number((sglUnit * 6).toFixed(2)),
          netProfit: Number((sglUnit * 6 - 20).toFixed(2)),
          prob: baseLegHad.fairProb,
          legs: [baseLegHad],
        },
        {
          id: "mp-par",
          roleLabel: "穿盘主攻",
          modeLabel: "2串1",
          multiple: 4,
          cost: 8,
          unitPayout: parUnit,
          returnPayout: Number((parUnit * 4).toFixed(2)),
          netProfit: Number((parUnit * 4 - 20).toFixed(2)),
          prob: hhadOpt.fairProb * 1.08 * m2Opt.fairProb,
          legs: [
            {
              matchId: m1.id,
              matchNumStr: m1.matchNumStr,
              home: m1.home,
              away: m1.away,
              kickoff: m1.kickoff,
              poolCode: "HHAD",
              poolName: m1.pools.HHAD.name,
              optionKey: hhadOpt.key,
              optionLabel: hhadOpt.label,
              odds: hhadOpt.odds,
              fairProb: Math.min(0.85, hhadOpt.fairProb * 1.08),
            },
            {
              matchId: m2.id,
              matchNumStr: m2.matchNumStr,
              home: m2.home,
              away: m2.away,
              kickoff: m2.kickoff,
              poolCode: "HAD",
              poolName: m2.pools.HAD.name,
              optionKey: m2Opt.key,
              optionLabel: m2Opt.label,
              odds: m2Opt.odds,
              fairProb: m2Opt.fairProb,
            },
          ],
        },
      ],
    };

    const repDirect = archetypeToReport(multiPoolFrozenSnap, undefined, [
      m1,
      m2,
    ]);
    const wsFrozen = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          snapshotPlan: multiPoolFrozenSnap,
          scaleMultiple: 1,
        },
        targetIds: [m1.id, m2.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      [m1, m2]
    );
    assert.ok(
      Math.abs(
        repDirect.expectedValueRate - wsFrozen.effectiveReport.expectedValueRate
      ) < 1e-12,
      `Multi-pool frozen snapshot EV drifted: direct=${repDirect.expectedValueRate} vs workspace=${wsFrozen.effectiveReport.expectedValueRate}`
    );
    assert.ok(
      Math.abs(
        repDirect.realProfitProb - wsFrozen.effectiveReport.realProfitProb
      ) < 1e-12,
      `Multi-pool frozen snapshot realProfitProb drifted: direct=${repDirect.realProfitProb} vs workspace=${wsFrozen.effectiveReport.realProfitProb}`
    );

    // 2. Standalone optimizeBonusPlan on tilted manualReport aligns leg probabilities & matches archetypeToReport
    const wsTiltedManual = evaluateQuantWorkspace(
      {
        picks: [makePick(m1, "HAD", "h"), makePick(m1, "HAD", "d")],
        multiple: 5,
        subjectiveDeltaPct: 12,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m1.id],
        budget: 20,
        stance: "objective",
        unlockFullAgg: false,
      },
      [m1]
    );
    const standaloneBonus = optimizeBonusPlan(
      wsTiltedManual.manualReport,
      [m1],
      "equal"
    )!;
    const standaloneBonusRep = archetypeToReport(
      standaloneBonus,
      wsTiltedManual.manualReport,
      [m1]
    );
    assert.ok(
      Math.abs(
        standaloneBonus.expectedValueRate - standaloneBonusRep.expectedValueRate
      ) < 1e-12,
      `Standalone optimizeBonusPlan EV (${standaloneBonus.expectedValueRate}) must match archetypeToReport (${standaloneBonusRep.expectedValueRate})`
    );

    // 3. Statutory warning self-consistency: invalid-odds & underwater breakevenUpgradeCost guidance across manual vs plan reports
    const invalidManual = computeTruthReport(
      [{ ...makePick(m1, "HAD", "h"), odds: 0 }],
      1,
      []
    );
    assert.equal(invalidManual.canCheckout, false);
    assert.ok(
      invalidManual.warnings.some(
        (w: { id: string }) => w.id === "invalid-odds"
      ),
      "Manual TruthReport with odds<=0 must emit canonical 'invalid-odds' statutory warning"
    );

    const threeSinglePicks = [
      makePick(m1, "HAFU", "hh"),
      makePick(m1, "HAFU", "dh"),
      makePick(m1, "HAFU", "dd"),
    ];
    const underBudgetManual = computeTruthReport(threeSinglePicks, 1, [m1]);
    assert.ok(
      typeof underBudgetManual.breakevenUpgradeCost === "number" &&
        underBudgetManual.breakevenUpgradeCost > 6
    );
    const underBudgetBonus = optimizeBonusPlan(
      underBudgetManual,
      [m1],
      "equal"
    )!;
    const underBudgetBonusRep = archetypeToReport(
      underBudgetBonus,
      underBudgetManual,
      [m1]
    );
    const uwWarn = underBudgetBonusRep.warnings.find(
      (w: { id: string }) => w.id === "underwater"
    );
    assert.ok(
      uwWarn,
      "Under-budget bonus report must emit 'underwater' warning"
    );
    assert.ok(
      uwWarn!.detail.includes(String(underBudgetManual.breakevenUpgradeCost)),
      `Plan report underwater warning must surface breakevenUpgradeCost (${underBudgetManual.breakevenUpgradeCost}), got: ${uwWarn!.detail}`
    );
  });

  it("Slice 4 (Zero-I/O Pure Quant Sub-Modules, Sporttery Feed Separation & Slim Facade <600L): evicts network/disk/fixture to sportteryFeed.mjs, eliminates dead exports, and runs 100% pure in-memory", async () => {
    const repoRoot = process.cwd();
    const sportteryFeedPath = path.join(repoRoot, "server/sportteryFeed.mjs");
    assert.equal(
      fs.existsSync(sportteryFeedPath),
      true,
      "server/sportteryFeed.mjs must exist as the dedicated upstream feed & cache adapter"
    );
    const feedMod = await import("../server/sportteryFeed.mjs");
    assert.equal(Array.isArray(feedMod.FALLBACK_MATCHES), true);
    assert.equal(feedMod.FALLBACK_MATCHES.length, 8);
    assert.equal(typeof feedMod.parseSportteryRawJson, "function");
    assert.equal(typeof feedMod.fetchOfficialMatchesServer, "function");
    assert.equal(typeof feedMod.parseSportteryResultsJson, "function");
    assert.equal(typeof feedMod.fetchOfficialMatchResultsServer, "function");

    const quantFacadePath = path.join(repoRoot, "server/quantEngine.mjs");
    const facadeLines = fs
      .readFileSync(quantFacadePath, "utf8")
      .split("\n").length;
    assert.ok(
      facadeLines < 600,
      `Expected server/quantEngine.mjs < 600 lines, got ${facadeLines}`
    );

    // Recursively walk EVERY static & dynamic import reachable from server/quantEngine.mjs
    // (plus all files inside server/quant/) to guarantee true 100% zero transitive I/O!
    const forbiddenSpecifierRe =
      /^(?:node:)?(?:fs|fs\/promises|http|https|net|tls|dgram|child_process)$/;
    const forbiddenSourceIoRe =
      /\bnode:(?:fs|fs\/promises|http|https)\b|\bfs\/promises\b|\bfetch\s*\(|\bglobalThis\.fetch\b/;
    const importSpecRe =
      /(?:from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\))/g;

    const visitedFiles = new Set<string>();
    const walkPureQuantGraph = (absFile: string) => {
      const normalized = path.resolve(absFile);
      if (visitedFiles.has(normalized)) return;
      visitedFiles.add(normalized);
      assert.equal(
        fs.existsSync(normalized),
        true,
        `Reachable module must exist on disk: ${normalized}`
      );
      const src = fs.readFileSync(normalized, "utf8");
      const rel = path.relative(repoRoot, normalized);
      assert.equal(
        forbiddenSourceIoRe.test(src),
        false,
        `Transitively reachable module ${rel} from server/quantEngine.mjs must contain ZERO node:fs, node:fs/promises, node:http, node:https, or fetch`
      );
      let m: RegExpExecArray | null;
      importSpecRe.lastIndex = 0;
      while ((m = importSpecRe.exec(src)) !== null) {
        const spec = m[1] || m[2];
        if (!spec) continue;
        assert.equal(
          forbiddenSpecifierRe.test(spec),
          false,
          `Module ${rel} must NOT import I/O specifier "${spec}"`
        );
        if (spec.startsWith(".")) {
          walkPureQuantGraph(path.resolve(path.dirname(normalized), spec));
        }
      }
    };

    walkPureQuantGraph(quantFacadePath);
    const quantDirEntries = fs
      .readdirSync(path.join(repoRoot, "server/quant"))
      .filter((f) => f.endsWith(".mjs"));
    assert.ok(
      quantDirEntries.length >= 5,
      `Expected cohesive server/quant/*.mjs modules, found ${quantDirEntries.length}`
    );
    for (const fname of quantDirEntries) {
      walkPureQuantGraph(path.join(repoRoot, "server/quant", fname));
    }
    assert.equal(
      visitedFiles.has(sportteryFeedPath),
      false,
      "server/quantEngine.mjs must NOT transitively import server/sportteryFeed.mjs"
    );

    // Dead & I/O symbols removed from external surface while all 20 pure exports remain intact
    for (const deadOrIoSym of [
      "OFFICIAL_COMBO_PASS_TABLE",
      "attachMicroQuant",
      "repairUnderwaterMultiples",
      "buildSandboxAdjustedPicks",
      "fetchOfficialMatchesServer",
      "fetchOfficialMatchResultsServer",
    ]) {
      assert.equal(
        deadOrIoSym in quantModule,
        false,
        `Symbol ${deadOrIoSym} must not be exported on pure server/quantEngine.mjs`
      );
    }
    const requiredPureExports = [
      "FALLBACK_MATCHES",
      "OFFICIAL_CRS_PAIRS",
      "POOL_MAX_PASS",
      "analyzeMatchMicroQuant",
      "archetypeToReport",
      "bankerRoundCents",
      "bankerRoundParlayUnitPayout",
      "buildXiaoGaoWarnings",
      "calibrateMatchCoherentModel",
      "computeProOrderInsights",
      "computeTruthReport",
      "devigPoolProbabilities",
      "evaluateQuantWorkspace",
      "generateFiveArchetypes",
      "generateParetoPortfolio",
      "optimizeBonusPlan",
      "parseSportteryRawJson",
      "parseSportteryResultsJson",
      "settleTicketSnapshotWithOfficialResults",
      "statutorySingleBetCap",
    ];
    for (const sym of requiredPureExports) {
      assert.equal(
        sym in quantModule,
        true,
        `Required public symbol ${sym} must remain exported on server/quantEngine.mjs`
      );
    }

    // Behavioral proof: poisoning globalThis.fetch does NOT affect workspace evaluation or snapshot settlement
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("Network I/O forbidden inside pure quant evaluation");
    }) as typeof fetch;
    try {
      const m0 = FALLBACK_MATCHES[0] as MatchItem;
      const ws = evaluateQuantWorkspace(
        {
          picks: [makePick(m0, "HAD", "h")],
          multiple: 2,
          subjectiveDeltaPct: 0,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [m0.id],
          budget: 20,
          stance: "home-lean",
          unlockFullAgg: false,
        },
        [m0]
      );
      assert.equal(ws.effectiveReport.canCheckout, true);
      assert.ok(Array.isArray(ws.objectivePortfolioPlans));

      const settled = settleTicketSnapshotWithOfficialResults(
        {
          matches: [
            {
              matchId: m0.id,
              matchNumStr: m0.matchNumStr,
              home: m0.home,
              away: m0.away,
              kickoff: m0.kickoff,
              picks: [
                {
                  poolCode: "HAD",
                  optionKey: "h",
                  optionLabel: "主胜",
                  odds: 2.0,
                },
              ],
            },
          ],
          lines: [
            {
              id: "ln-1",
              modeLabel: "单关",
              multiple: 2,
              legs: [
                {
                  matchId: m0.id,
                  poolCode: "HAD",
                  optionKey: "h",
                  odds: 2.0,
                },
              ],
            },
          ],
        },
        [
          {
            matchId: m0.id,
            matchResultStatus: "2",
            poolStatus: "Payout",
            sectionsNo1: "1:0",
            sectionsNo999: "2:0",
          },
        ],
        { stakeCost: 4 }
      );
      assert.equal(settled.status, "won");
      assert.equal(settled.settledReturn, 8);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("Slice 6 (Post-Review Hard #2): clamps non-authoritative sandbox custom odds strictly to [1.01, 1000] across workspace picks and snapshotPlan legs (0, -5, 1e308, NaN) without coercing to 1.0 or throwing BigInt RangeError", () => {
    const authMatches = FALLBACK_MATCHES.slice(0, 2) as MatchItem[];
    const extremeInputs = [
      { id: "sbx-zero", rawOdds: 0, expectedOdds: 1.01 },
      { id: "sbx-neg", rawOdds: -5, expectedOdds: 1.01 },
      { id: "sbx-nan", rawOdds: Number.NaN, expectedOdds: 1.01 },
      { id: "sbx-huge", rawOdds: 1e308, expectedOdds: 1000 },
    ];

    const sandboxPicks: SelectedPick[] = extremeInputs.map((item, idx) => ({
      matchId: item.id,
      matchNumStr: `沙盒00${idx + 1}`,
      home: `主队${idx + 1}`,
      away: `客队${idx + 1}`,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: true,
      optionKey: "h",
      optionLabel: "主胜",
      odds: item.rawOdds,
      fairProb: 0.45,
    }));

    // 1. Manual workspace picks on 4 non-authoritative sandbox matches (4串1 -> hits BigInt path in statutoryRules.mjs)
    const wsManual = evaluateQuantWorkspace(
      {
        picks: sandboxPicks,
        multiple: 1,
        passSpec: { mode: "auto" },
      },
      authMatches
    );
    assert.equal(wsManual.manualReport.canCheckout, true);
    assert.equal(wsManual.manualReport.tickets.length, 1);
    const manualLegOdds = wsManual.manualReport.tickets[0].legs!.map(
      (lg) => lg.odds
    );
    assert.deepEqual(
      manualLegOdds,
      extremeInputs.map((x) => x.expectedOdds)
    );
    assert.ok(
      manualLegOdds.every((o) => o >= 1.01 && o <= 1000),
      `Every non-authoritative sandbox leg must lie strictly in [1.01, 1000], got ${JSON.stringify(manualLegOdds)}`
    );

    // 2. snapshotPlan (applySandboxToPlan + scaleArchetypePlan) with 0, -5, NaN, 1e308 on non-authoritative matches
    const wsPlan = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        planSpec: {
          kind: "archetype",
          key: "max-profit-prob",
          scaleMultiple: 2,
          snapshotPlan: {
            key: "max-profit-prob",
            available: true,
            shortTab: "沙盒验证",
            badge: "沙盒",
            title: "沙盒极限赔率校验",
            tagline: "校验",
            totalCost: 2,
            savedCash: 0,
            minReturn: 4,
            maxReturn: 4,
            winProb: 0.2,
            profitProb: 0.2,
            strictNetGainProb: 0.2,
            breakEvenProb: 0,
            expectedValueRate: 0,
            underwaterCount: 0,
            breakevenUpgradeCost: null,
            consolidateTickets: false,
            missOneReturn: null,
            vigPct: 12,
            reasons: [],
            lines: [
              {
                id: "sbx-line-1",
                roleLabel: "沙盒实票#1",
                modeLabel: "4串1",
                multiple: 1,
                cost: 2,
                unitPayout: 4,
                cappedClipped: 0,
                returnPayout: 4,
                netProfit: 2,
                prob: 0.04,
                legs: extremeInputs.map((item, idx) => ({
                  matchId: item.id,
                  matchNumStr: `沙盒00${idx + 1}`,
                  home: `主队${idx + 1}`,
                  away: `客队${idx + 1}`,
                  kickoff: "21:00",
                  poolCode: "HAD" as const,
                  poolName: "胜平负",
                  optionKey: "h",
                  optionLabel: "主胜",
                  odds: item.rawOdds,
                  fairProb: 0.45,
                })),
              },
            ],
          },
        },
      },
      authMatches
    );
    assert.ok(wsPlan.appliedPlan);
    const planLegOdds = wsPlan.appliedPlan!.lines[0].legs.map((lg) => lg.odds);
    assert.deepEqual(
      planLegOdds,
      extremeInputs.map((x) => x.expectedOdds)
    );
    assert.equal(wsPlan.effectiveReport.canCheckout, true);
  });
});
