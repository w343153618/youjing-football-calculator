import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  calibrateMatchCoherentModel,
  devigPoolProbabilities,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import { createManualQaEngine } from "../server/manualQaEngine.mjs";
import type {
  MatchItem,
  PoolCode,
  SelectedPick,
  UserStance,
} from "../src/prototype/quantTypes.ts";
import {
  assembleQuantBenchmarkReport,
  runLayer1ProperScoringBenchmark,
  runLayer2AxiomaticInvariantsBenchmark,
  runLayer3MonteCarloParetoBenchmark,
  runLayer4LedgerAblationBenchmark,
} from "../scripts/bench-quant.mjs";

const REPO_ROOT = process.cwd();
const REAL_OOS_FIXTURE_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/realSportteryOosMatches.json"
);

describe("Spec #1 (0014) · Ticket #2: OOS Fixture Remediation, Upstream Calibration & Monotonic Subjective Slider", () => {
  it("Slice 1 (AC 1): remediates all 11 truncated high-scoring matches in realSportteryOosMatches.json, documents quote-timestamp semantics in top-level meta, and passes the 4-layer scientific benchmark", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    ) as {
      description: string;
      matchCount: number;
      meta?: {
        timestampSemantics?: string;
        poolQuoteTimestampSource?: string;
        matchTimeFieldMeaning?: string;
      };
      matches: Array<{
        matchId: string;
        hhad?: { goalLine?: string };
        outcome: {
          htHome?: number;
          htAway?: number;
          ftHome: number;
          ftAway: number;
          hadKey: string;
          hhadKey: string;
          hafuKey: string;
          ttgKey: string;
          crsLabel: string;
        };
      }>;
    };

    assert.equal(rawFixture.matches.length, 622);
    assert.ok(
      typeof rawFixture.meta?.timestampSemantics === "string" &&
        rawFixture.meta.timestampSemantics.includes("had.updateTime") &&
        rawFixture.meta.timestampSemantics.includes("报价"),
      "Top-level meta.timestampSemantics must clarify that matchDate/matchTime mirror HAD final quote timestamps rather than official kickoff times"
    );

    const expectedOfficial11: Record<
      string,
      {
        htHome: number;
        htAway: number;
        ftHome: number;
        ftAway: number;
        hadKey: string;
        hhadKey: string;
        hafuKey: string;
        ttgKey: string;
        crsLabel: string;
      }
    > = {
      "2042422": {
        htHome: 0,
        htAway: 5,
        ftHome: 0,
        ftAway: 9,
        hadKey: "a",
        hhadKey: "ha",
        hafuKey: "aa",
        ttgKey: "s7",
        crsLabel: "负其它",
      },
      "2042438": {
        htHome: 1,
        htAway: 1,
        ftHome: 4,
        ftAway: 3,
        hadKey: "h",
        hhadKey: "hd",
        hafuKey: "dh",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
      "2042497": {
        htHome: 3,
        htAway: 4,
        ftHome: 7,
        ftAway: 4,
        hadKey: "h",
        hhadKey: "hh",
        hafuKey: "ah",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
      "2042504": {
        htHome: 0,
        htAway: 4,
        ftHome: 0,
        ftAway: 6,
        hadKey: "a",
        hhadKey: "ha",
        hafuKey: "aa",
        ttgKey: "s6",
        crsLabel: "负其它",
      },
      "2042515": {
        htHome: 0,
        htAway: 3,
        ftHome: 1,
        ftAway: 9,
        hadKey: "a",
        hhadKey: "ha",
        hafuKey: "aa",
        ttgKey: "s7",
        crsLabel: "负其它",
      },
      "2042529": {
        htHome: 4,
        htAway: 1,
        ftHome: 6,
        ftAway: 1,
        hadKey: "h",
        hhadKey: "hh",
        hafuKey: "hh",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
      "2042630": {
        htHome: 1,
        htAway: 1,
        ftHome: 4,
        ftAway: 3,
        hadKey: "h",
        hhadKey: "hd",
        hafuKey: "dh",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
      "2042632": {
        htHome: 2,
        htAway: 2,
        ftHome: 4,
        ftAway: 4,
        hadKey: "d",
        hhadKey: "ha",
        hafuKey: "dd",
        ttgKey: "s7",
        crsLabel: "平其它",
      },
      "2042734": {
        htHome: 5,
        htAway: 0,
        ftHome: 7,
        ftAway: 0,
        hadKey: "h",
        hhadKey: "hh",
        hafuKey: "hh",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
      "2042760": {
        htHome: 3,
        htAway: 0,
        ftHome: 6,
        ftAway: 1,
        hadKey: "h",
        hhadKey: "hh",
        hafuKey: "hh",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
      "2042770": {
        htHome: 1,
        htAway: 3,
        ftHome: 5,
        ftAway: 4,
        hadKey: "h",
        hhadKey: "hd",
        hafuKey: "ah",
        ttgKey: "s7",
        crsLabel: "胜其它",
      },
    };

    const explicitCrsLabels = new Set(
      OFFICIAL_CRS_PAIRS.map(([, lbl]: [string, string]) => lbl).filter(
        (lbl: string) => lbl.includes(":")
      )
    );

    const byId = new Map(rawFixture.matches.map((m) => [m.matchId, m]));
    for (const [mid, exp] of Object.entries(expectedOfficial11)) {
      const m = byId.get(mid);
      assert.ok(m, `Expected match ${mid} in realSportteryOosMatches.json`);
      assert.equal(m.outcome.ftHome, exp.ftHome, `Match ${mid} ftHome`);
      assert.equal(m.outcome.ftAway, exp.ftAway, `Match ${mid} ftAway`);
      assert.equal(m.outcome.htHome, exp.htHome, `Match ${mid} htHome`);
      assert.equal(m.outcome.htAway, exp.htAway, `Match ${mid} htAway`);
      assert.equal(m.outcome.hadKey, exp.hadKey, `Match ${mid} hadKey`);
      assert.equal(m.outcome.hhadKey, exp.hhadKey, `Match ${mid} hhadKey`);
      assert.equal(m.outcome.hafuKey, exp.hafuKey, `Match ${mid} hafuKey`);
      assert.equal(m.outcome.ttgKey, exp.ttgKey, `Match ${mid} ttgKey`);
      assert.equal(m.outcome.crsLabel, exp.crsLabel, `Match ${mid} crsLabel`);
    }

    // Global 5-pool settlement algebraic self-consistency across all 622 matches
    for (const m of rawFixture.matches) {
      const o = m.outcome;
      const gl = Number(m.hhad?.goalLine ?? -1);
      const expHad =
        o.ftHome > o.ftAway ? "h" : o.ftHome === o.ftAway ? "d" : "a";
      const adj = o.ftHome - o.ftAway + gl;
      const expHhad = adj > 0 ? "hh" : adj === 0 ? "hd" : "ha";
      const expTtg = `s${Math.min(7, o.ftHome + o.ftAway)}`;
      const scoreLbl = `${o.ftHome}:${o.ftAway}`;
      const expCrs = explicitCrsLabels.has(scoreLbl)
        ? scoreLbl
        : o.ftHome > o.ftAway
          ? "胜其它"
          : o.ftHome === o.ftAway
            ? "平其它"
            : "负其它";

      assert.equal(o.hadKey, expHad, `Match ${m.matchId} HAD consistency`);
      assert.equal(o.hhadKey, expHhad, `Match ${m.matchId} HHAD consistency`);
      assert.equal(o.ttgKey, expTtg, `Match ${m.matchId} TTG consistency`);
      assert.equal(o.crsLabel, expCrs, `Match ${m.matchId} CRS consistency`);
      assert.equal(
        o.hafuKey[1],
        expHad,
        `Match ${m.matchId} HAFU FT char must match HAD`
      );
      if (typeof o.htHome === "number" && typeof o.htAway === "number") {
        assert.ok(o.htHome <= o.ftHome && o.htAway <= o.ftAway);
        const expHt =
          o.htHome > o.htAway ? "h" : o.htHome === o.htAway ? "d" : "a";
        assert.equal(o.hafuKey[0], expHt, `Match ${m.matchId} HAFU HT char`);
      }
    }

    const fullReport = assembleQuantBenchmarkReport({
      layer1: runLayer1ProperScoringBenchmark(),
      layer2: runLayer2AxiomaticInvariantsBenchmark(),
      layer3: runLayer3MonteCarloParetoBenchmark({
        seed: 20261120,
        samplesPerSlate: 2_000,
      }),
      layer4: runLayer4LedgerAblationBenchmark({
        dailyStopLossYuan: 300,
        initialBankrollYuan: 12_000,
      }),
    });
    assert.equal(fullReport.allPassed, true);
  });

  it("Slice 2 (AC 2): enforces strict order-preserving monotonicity on subjectiveDeltaPct across [-15%, +15%] for <2% longshots and >98% unions without 2% floor inflation while conserving probability", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );

    const makePick = (
      m: MatchItem,
      poolCode: PoolCode,
      keyOrLabel: string
    ): SelectedPick => {
      const pool = m.pools[poolCode];
      const opt = pool.options.find(
        (o) => o.key === keyOrLabel || o.label === keyOrLabel
      )!;
      assert.ok(opt, `Missing option ${poolCode}:${keyOrLabel} on ${m.id}`);
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
    };

    // 1. Ultra-longshot CRS option ("0:5", fairProb << 0.02) & HAFU comeback option ("ah", fairProb < 0.02)
    const [recalibratedExtreme] = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                ...rawFixture.matches[0],
                matchId: "ac2-longshot-1000",
                hafu: { ...rawFixture.matches[0].hafu, ha: "80.0" },
                crs: { ...rawFixture.matches[0].crs, s00s05: "1000.0" },
              },
            ],
          },
        ],
      },
    }) as MatchItem[];

    const crsLongshotPick = makePick(recalibratedExtreme, "CRS", "0:5");
    assert.ok(
      crsLongshotPick.fairProb < 0.002,
      `Expected CRS 0:5 objective fairProb < 0.2%, got ${crsLongshotPick.fairProb}`
    );

    const hafuLongshotOpt = recalibratedExtreme.pools.HAFU.options.find(
      (o) => o.fairProb > 0 && o.fairProb < 0.02
    )!;
    assert.ok(
      hafuLongshotOpt,
      "Expected at least one <2% HAFU option on real match"
    );
    const hafuLongshotPick = makePick(
      recalibratedExtreme,
      "HAFU",
      hafuLongshotOpt.key
    );

    const deltas = [-15, -10, -5, -1, 0, 1, 5, 10, 15];
    for (const pick of [crsLongshotPick, hafuLongshotPick]) {
      const probs: number[] = [];
      const subjEvs: number[] = [];
      let baseProbAtZero = 0;
      let baseEvAtZero = 0;

      for (const delta of deltas) {
        const ws = evaluateQuantWorkspace(
          {
            picks: [pick],
            multiple: 1,
            passSpec: { mode: "single" },
            subjectiveDeltaPct: delta,
            simVoidFirstMatch: false,
            planSpec: null,
            targetIds: [recalibratedExtreme.id],
            budget: 100,
            stance: "objective",
            unlockFullAgg: false,
          },
          [recalibratedExtreme]
        );
        const rep = ws.manualReport;
        assert.equal(rep.canCheckout, true);
        probs.push(rep.anyWinProb);
        subjEvs.push(ws.subjectiveEVPct);
        if (delta === 0) {
          baseProbAtZero = rep.anyWinProb;
          baseEvAtZero = rep.objectiveEVRate * 100;
          assert.ok(
            Math.abs(ws.subjectiveEVPct - rep.objectiveEVRate * 100) < 1e-12
          );
          assert.equal(rep.subjectiveProjectedEVRate, null);
        } else {
          assert.ok(
            Math.abs(
              (rep.subjectiveProjectedEVRate ?? 0) * 100 - ws.subjectiveEVPct
            ) < 1e-12
          );
        }
        // Combo probabilities conserve hit mass & stay strictly in (0, 1)
        const comboSum = rep.combos.reduce(
          (acc: number, c: { prob: number }) => acc + c.prob,
          0
        );
        assert.ok(Math.abs(comboSum - rep.anyWinProb) < 1e-12);
        assert.ok(rep.anyWinProb > 0 && rep.anyWinProb < 1);
      }

      // Strict monotonicity across all [-15 .. +15] grid points & zero 2% floor explosion
      for (let i = 1; i < deltas.length; i++) {
        assert.ok(
          probs[i] > probs[i - 1],
          `${pick.poolCode}:${pick.optionLabel} anyWinProb must strictly increase from delta=${deltas[i - 1]} (${probs[i - 1]}) to delta=${deltas[i]} (${probs[i]})`
        );
        assert.ok(
          subjEvs[i] > subjEvs[i - 1],
          `${pick.poolCode}:${pick.optionLabel} subjectiveEVPct must strictly increase from delta=${deltas[i - 1]} (${subjEvs[i - 1]}%) to delta=${deltas[i]} (${subjEvs[i]}%)`
        );
      }
      assert.ok(
        probs[3] < baseProbAtZero && probs[0] < baseProbAtZero,
        `Negative delta must strictly lower probability below objective ${baseProbAtZero}, got -1%=${probs[3]}, -15%=${probs[0]}`
      );
      assert.ok(
        subjEvs[3] < baseEvAtZero && subjEvs[0] < baseEvAtZero,
        `Negative delta must strictly lower subjectiveEVPct below objective ${baseEvAtZero}%, got -1%=${subjEvs[3]}%, -15%=${subjEvs[0]}%`
      );
    }

    // 2. High-coverage union (30 out of 31 CRS options, pS > 0.99 > 0.98) must ALSO stay monotonic (never clamped DOWN to 0.98 when delta > 0)
    const thirtyCrsPicks = recalibratedExtreme.pools.CRS.options
      .filter((o) => o.label !== "1:0")
      .map((o) => makePick(recalibratedExtreme, "CRS", o.label));
    let prevUnionProb = -1;
    for (const delta of [-15, -5, 0, 5, 15]) {
      const wsUnion = evaluateQuantWorkspace(
        {
          picks: thirtyCrsPicks,
          multiple: 1,
          passSpec: { mode: "single" },
          subjectiveDeltaPct: delta,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [recalibratedExtreme.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        [recalibratedExtreme]
      );
      assert.ok(
        wsUnion.manualReport.anyWinProb >= prevUnionProb,
        `30-of-31 CRS union prob must be non-decreasing at delta=${delta}: ${prevUnionProb} -> ${wsUnion.manualReport.anyWinProb}`
      );
      prevUnionProb = wsUnion.manualReport.anyWinProb;
    }

    // 3. Full single-match atomic space conservation (2-match parlay pairing CRS 0:5 on match 1 with full 3-way HAD cover on match 2)
    const m2 = FALLBACK_MATCHES[1] as MatchItem;
    const parlayConservationPicks = [
      crsLongshotPick,
      makePick(m2, "HAD", "h"),
      makePick(m2, "HAD", "d"),
      makePick(m2, "HAD", "a"),
    ];
    for (const delta of [-15, -1, 0, 1, 15]) {
      const wsSingle = evaluateQuantWorkspace(
        {
          picks: [crsLongshotPick],
          multiple: 1,
          passSpec: { mode: "single" },
          subjectiveDeltaPct: delta,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [recalibratedExtreme.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        [recalibratedExtreme]
      );
      const wsParlay = evaluateQuantWorkspace(
        {
          picks: parlayConservationPicks,
          multiple: 1,
          passSpec: { mode: "free", passCounts: [2] },
          subjectiveDeltaPct: delta,
          simVoidFirstMatch: false,
          planSpec: null,
          targetIds: [recalibratedExtreme.id, m2.id],
          budget: 100,
          stance: "objective",
          unlockFullAgg: false,
        },
        [recalibratedExtreme, m2]
      );
      assert.ok(
        Math.abs(
          wsParlay.manualReport.anyWinProb - wsSingle.manualReport.anyWinProb
        ) < 1e-12,
        `Full HAD marginal sum on match 2 must equal 1.0 at delta=${delta}`
      );
    }
  });

  it("Slice 3 (AC 3): tightens missing/partial/invalid updateDate handling as unverified lag in both calibrateMatchCoherentModel and cross-pool alpha scanning", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const m0Raw = rawFixture.matches[0]; // 2041500

    const buildVariant = (
      id: string,
      mutator: (clone: Record<string, any>) => void
    ): MatchItem => {
      const clone = JSON.parse(JSON.stringify(m0Raw));
      clone.matchId = id;
      for (const k of ["had", "hhad", "hafu", "ttg", "crs"]) {
        clone[k].updateDate = "2026-09-16";
        clone[k].updateTime = "12:00:00";
      }
      clone.ttg.s0 = "100.0";
      mutator(clone);
      return parseSportteryRawJson({
        value: { matchInfoList: [{ subMatchList: [clone] }] },
      })[0] as MatchItem;
    };

    const sameDateMatch = buildVariant("ac3-same-date", () => {});
    const noDateMatch = buildVariant("ac3-no-date", (c) => {
      for (const k of ["had", "hhad", "hafu", "ttg", "crs"]) {
        delete c[k].updateDate;
      }
    });
    const partialDateMatch = buildVariant("ac3-partial-date", (c) => {
      // Only HAD keeps updateDate while TTG/HAFU/CRS lack updateDate — must NOT subtract todMin from epochMin!
      delete c.ttg.updateDate;
      delete c.hafu.updateDate;
      delete c.crs.updateDate;
    });
    const invalidDateMatch = buildVariant("ac3-invalid-date", (c) => {
      c.ttg.updateDate = "2026-13-45";
    });
    const verifiedLagMatch = buildVariant("ac3-verified-lag", (c) => {
      c.had.updateTime = "21:18:50";
      c.hhad.updateTime = "21:18:50";
      c.ttg.updateTime = "15:18:13";
      c.crs.updateTime = "15:18:00";
    });

    const calSame = calibrateMatchCoherentModel(sameDateMatch);
    const calNoDate = calibrateMatchCoherentModel(noDateMatch);
    const calPartial = calibrateMatchCoherentModel(partialDateMatch);
    const calInvalid = calibrateMatchCoherentModel(invalidDateMatch);
    const calVerifiedLag = calibrateMatchCoherentModel(verifiedLagMatch);

    assert.ok(
      Math.abs(calNoDate.poolProbs.TTG.s0 - calSame.poolProbs.TTG.s0) < 1e-12,
      `Missing updateDate (${calNoDate.poolProbs.TTG.s0}) must NOT enable upward lag pull vs same-time verified (${calSame.poolProbs.TTG.s0})`
    );
    assert.ok(
      Math.abs(calPartial.poolProbs.TTG.s0 - calSame.poolProbs.TTG.s0) < 1e-12,
      `Partial updateDate (${calPartial.poolProbs.TTG.s0}) must NOT mix epoch minutes with time-of-day minutes vs (${calSame.poolProbs.TTG.s0})`
    );
    assert.ok(
      Math.abs(calInvalid.poolProbs.TTG.s0 - calSame.poolProbs.TTG.s0) < 1e-12,
      `Invalid calendar updateDate (${calInvalid.poolProbs.TTG.s0}) must be treated as unverified (${calSame.poolProbs.TTG.s0})`
    );
    assert.ok(
      calVerifiedLag.poolProbs.TTG.s0 > calSame.poolProbs.TTG.s0 + 0.005,
      `Genuine >=30m verified lag (${calVerifiedLag.poolProbs.TTG.s0}) must still retain upward lag weight over (${calSame.poolProbs.TTG.s0})`
    );

    // Offline fallback snapshot without updateDate must NOT trigger sub-pool lag +EV in alpha scanner / Slot ④
    const datelessFallbackLag: MatchItem = {
      ...(FALLBACK_MATCHES[0] as MatchItem),
      id: "ac3-fallback-no-date",
      pools: {
        ...(FALLBACK_MATCHES[0] as MatchItem).pools,
        TTG: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.TTG,
          options: (FALLBACK_MATCHES[0] as MatchItem).pools.TTG.options.map(
            (o) => (o.key === "s2" ? { ...o, odds: 4.65 } : o)
          ),
        },
      },
    };
    const wsDatelessFallback = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [datelessFallbackLag.id, FALLBACK_MATCHES[1].id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [datelessFallbackLag, FALLBACK_MATCHES[1] as MatchItem]
    );
    const alphaSlotDateless = wsDatelessFallback.portfolioPlans[3];
    assert.equal(alphaSlotDateless.key, "alpha-radar");
    assert.equal(
      alphaSlotDateless.available,
      false,
      "Dateless fallback snapshot must treat sub-pool lag as unverified and keep alpha-radar empty"
    );
    assert.equal(alphaSlotDateless.totalCost, 0);
  });

  it("Slice 4 (AC 4): protects favorite 1 .. |goalLine|-1 narrow-margin cells from normalization suppression under upset-watch on deep handicaps (|goalLine| >= 2, including -2, +2, and -3)", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const realMinus2Raw = rawFixture.matches.find(
      (m: { hhad?: { goalLine?: string } }) => m.hhad?.goalLine === "-2"
    )!;
    assert.ok(realMinus2Raw, "Expected a genuine -2 handicap match in OOS set");

    const withAllSingleOpen = (rawM: Record<string, any>, id: string) => {
      const clone = JSON.parse(JSON.stringify(rawM));
      clone.matchId = id;
      clone.poolList = ["HAD", "HHAD", "HAFU", "TTG", "CRS"].map(
        (poolCode) => ({
          poolCode,
          single: 1,
          bettingSingle: 1,
          bettingAllup: 1,
          poolStatus: "Selling",
        })
      );
      return parseSportteryRawJson({
        value: { matchInfoList: [{ subMatchList: [clone] }] },
      })[0] as MatchItem;
    };

    const deepHomeMinus2 = withAllSingleOpen(realMinus2Raw, "ac4-minus2");

    // Symmetric +2 away-favorite mirror of realMinus2Raw
    const mirrorPlus2Raw = JSON.parse(JSON.stringify(realMinus2Raw));
    mirrorPlus2Raw.had = {
      ...realMinus2Raw.had,
      h: realMinus2Raw.had.a,
      a: realMinus2Raw.had.h,
    };
    mirrorPlus2Raw.hhad = {
      ...realMinus2Raw.hhad,
      goalLine: "+2",
      h: realMinus2Raw.hhad.a,
      a: realMinus2Raw.hhad.h,
    };
    const deepAwayPlus2 = withAllSingleOpen(mirrorPlus2Raw, "ac4-plus2");

    // Deep -3 home-favorite match (protecting both diff=1 and diff=2 narrow margins)
    const minus3Raw = JSON.parse(JSON.stringify(realMinus2Raw));
    minus3Raw.had = {
      ...realMinus2Raw.had,
      h: "1.14",
      d: "6.50",
      a: "13.00",
    };
    minus3Raw.hhad = {
      ...realMinus2Raw.hhad,
      goalLine: "-3",
      h: "2.65",
      d: "4.05",
      a: "1.98",
    };
    const deepHomeMinus3 = withAllSingleOpen(minus3Raw, "ac4-minus3");

    const queryStanceProb = (
      m: MatchItem,
      poolCode: PoolCode,
      keyOrLabel: string,
      stance: UserStance
    ): number => {
      const pool = m.pools[poolCode];
      const opt = pool.options.find(
        (o) => o.key === keyOrLabel || o.label === keyOrLabel
      )!;
      assert.ok(opt, `Missing ${poolCode}:${keyOrLabel} on ${m.id}`);
      const pick: SelectedPick = {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode,
        poolName: pool.name,
        singleAllowed: true,
        optionKey: opt.key,
        optionLabel: opt.label,
        odds: opt.odds,
        fairProb: opt.fairProb,
      };
      const plans = generateParetoPortfolio([m], 100, stance, false, [pick]);
      return plans[0].lines[0].legs[0].fairProb;
    };

    // 1. Home deep favorite (-2): CRS 1:0 & 2:1 (diff=1) protected >= objective, HAD d/a & HHAD ha up, HAD h down, sums = 1
    for (const crsNarrow of ["1:0", "2:1"]) {
      const pObj = queryStanceProb(
        deepHomeMinus2,
        "CRS",
        crsNarrow,
        "objective"
      );
      const pUpset = queryStanceProb(
        deepHomeMinus2,
        "CRS",
        crsNarrow,
        "upset-watch"
      );
      assert.ok(
        pUpset >= pObj,
        `Deep -2 upset-watch must protect narrow 1-goal margin ${crsNarrow}: expected ${pUpset} >= ${pObj}`
      );
    }
    assert.ok(
      queryStanceProb(deepHomeMinus2, "HAD", "d", "upset-watch") >
        queryStanceProb(deepHomeMinus2, "HAD", "d", "objective")
    );
    assert.ok(
      queryStanceProb(deepHomeMinus2, "HAD", "a", "upset-watch") >
        queryStanceProb(deepHomeMinus2, "HAD", "a", "objective")
    );
    assert.ok(
      queryStanceProb(deepHomeMinus2, "HHAD", "ha", "upset-watch") >
        queryStanceProb(deepHomeMinus2, "HHAD", "ha", "objective")
    );
    assert.ok(
      queryStanceProb(deepHomeMinus2, "HAD", "h", "upset-watch") <
        queryStanceProb(deepHomeMinus2, "HAD", "h", "objective")
    );
    const sumHadM2 =
      queryStanceProb(deepHomeMinus2, "HAD", "h", "upset-watch") +
      queryStanceProb(deepHomeMinus2, "HAD", "d", "upset-watch") +
      queryStanceProb(deepHomeMinus2, "HAD", "a", "upset-watch");
    assert.ok(Math.abs(sumHadM2 - 1) < 1e-12);

    // 2. Away deep favorite (+2): CRS 0:1 & 1:2 (away margin=1) protected >= objective, HAD h/d & HHAD hh up, HAD a down
    for (const crsNarrow of ["0:1", "1:2"]) {
      const pObj = queryStanceProb(
        deepAwayPlus2,
        "CRS",
        crsNarrow,
        "objective"
      );
      const pUpset = queryStanceProb(
        deepAwayPlus2,
        "CRS",
        crsNarrow,
        "upset-watch"
      );
      assert.ok(
        pUpset >= pObj,
        `Deep +2 upset-watch must protect away narrow 1-goal margin ${crsNarrow}: expected ${pUpset} >= ${pObj}`
      );
    }
    assert.ok(
      queryStanceProb(deepAwayPlus2, "HHAD", "hh", "upset-watch") >
        queryStanceProb(deepAwayPlus2, "HHAD", "hh", "objective")
    );
    assert.ok(
      queryStanceProb(deepAwayPlus2, "HAD", "a", "upset-watch") <
        queryStanceProb(deepAwayPlus2, "HAD", "a", "objective")
    );

    // 3. Home ultra-deep favorite (-3): BOTH diff=1 (1:0) AND diff=2 (2:0, 3:1) in 1..|goalLine|-1 protected >= objective!
    for (const crsNarrow of ["1:0", "2:0", "3:1"]) {
      const pObj = queryStanceProb(
        deepHomeMinus3,
        "CRS",
        crsNarrow,
        "objective"
      );
      const pUpset = queryStanceProb(
        deepHomeMinus3,
        "CRS",
        crsNarrow,
        "upset-watch"
      );
      assert.ok(
        pUpset >= pObj,
        `Deep -3 upset-watch must protect narrow margin ${crsNarrow} (1..2 goals): expected ${pUpset} >= ${pObj}`
      );
    }
    assert.ok(
      queryStanceProb(deepHomeMinus3, "CRS", "4:0", "upset-watch") <
        queryStanceProb(deepHomeMinus3, "CRS", "4:0", "objective")
    );
    assert.ok(
      queryStanceProb(deepHomeMinus3, "HAD", "h", "upset-watch") <
        queryStanceProb(deepHomeMinus3, "HAD", "h", "objective")
    );
  });

  it("Slice 5 (AC 5): eliminates devigPoolProbabilities jump at odds = 1.00, guards ultra-small positive floats against NaN, and clarifies paceCorrelation as low-score linkage coefficient", async () => {
    // 1. Continuity & monotonicity across the odds = 1.00 boundary
    const aboveOne = devigPoolProbabilities([1.000001, 3, 6], "shin");
    const exactOne = devigPoolProbabilities([1.0, 3, 6], "shin");
    const belowOne = devigPoolProbabilities([0.999999, 3, 6], "shin");

    assert.ok(
      Math.abs(exactOne.probs[0] - aboveOne.probs[0]) < 1e-5,
      `Expected smooth continuity at odds=1.00, got p(1.000001)=${aboveOne.probs[0]} vs p(1.0)=${exactOne.probs[0]}`
    );
    assert.ok(
      Math.abs(belowOne.probs[0] - exactOne.probs[0]) < 1e-5,
      `Expected smooth continuity below odds=1.00, got p(1.0)=${exactOne.probs[0]} vs p(0.999999)=${belowOne.probs[0]}`
    );

    // Monotone sweep across 1.10 -> 1.000001 -> 1.0 -> 0.999999 -> 0.80 -> 0.60
    const sweepOdds = [1.1, 1.01, 1.000001, 1.0, 0.999999, 0.85, 0.72, 0.6];
    let prevP0 = 0;
    for (const o0 of sweepOdds) {
      const res = devigPoolProbabilities([o0, 3, 6], "shin");
      const sum = res.probs.reduce((a: number, b: number) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-12);
      assert.ok(
        res.probs.every((p: number) => Number.isFinite(p) && p > 0 && p < 1)
      );
      assert.ok(
        res.probs[0] >= prevP0 - 1e-12,
        `Expected p0 to increase monotonically as odds drop to ${o0}: ${prevP0} -> ${res.probs[0]}`
      );
      prevP0 = res.probs[0];
    }

    // 2. Ultra-small positive floats (1e-310, Number.MIN_VALUE) never overflow 1/o to Infinity or NaN
    for (const method of ["shin", "power", "multiplicative"] as const) {
      for (const tinyVec of [
        [1e-310, 3, 6],
        [Number.MIN_VALUE, 3, 6],
        [1e-310, 0, 6],
        [1e-310],
      ]) {
        const res = devigPoolProbabilities(tinyVec, method);
        const sum = res.probs.reduce((a: number, b: number) => a + b, 0);
        assert.equal(
          res.probs.some((p: number) => Number.isNaN(p) || !Number.isFinite(p)),
          false,
          `Method ${method} on ${JSON.stringify(tinyVec)} produced non-finite probs: ${JSON.stringify(res.probs)}`
        );
        assert.ok(
          res.probs.every((p: number) => p >= 0 && p <= 1) &&
            Math.abs(sum - 1) < 1e-12
        );
        assert.equal(Number.isFinite(res.overround), true);
        assert.equal(Number.isFinite(res.payoutRatio), true);
      }
    }

    // 3. paceCorrelation accurately documented & explained as low-score linkage correction coefficient (低比分联动修正系数)
    const qaEngine = createManualQaEngine({});
    const qaRes = await qaEngine.answerManualQuestion({
      userId: "test-member-ac5",
      question: "比赛节奏相关性是什么意思？",
      ip: "127.0.0.1",
    });
    assert.equal(qaRes.ok, true);
    assert.equal(qaRes.source, "local-kb");
    assert.ok(
      qaRes.answer.includes("低比分联动修正系数"),
      `Expected Manual Q&A to clarify paceCorrelation as 低比分联动修正系数, got: ${qaRes.answer}`
    );

    const appSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    const quantSrc = fs.readFileSync(
      path.join(REPO_ROOT, "server/quantEngine.mjs"),
      "utf8"
    );
    assert.ok(
      appSrc.includes("比赛节奏相关性") &&
        appSrc.includes("低比分联动修正系数"),
      "SkinPhoneApp.tsx pace tile must clarify ρ as 低比分联动修正系数"
    );
    assert.ok(
      quantSrc.includes("低比分联动修正系数"),
      "server/quantEngine.mjs must document paceCorrelation as 低比分联动修正系数"
    );
  });
});

describe("Spec #1 (0014) · Ticket #3: 3+1 Pareto Portfolio Budget Sovereignty, Same-Budget Utility Shield & Honest Taxonomy", () => {
  it("Slice 6 (Ticket #3 AC 1 & AC 2): enforces match-order permutation invariance, abolishes 84% pure-spear underspend arbitrage, restores 3~8-match shield structures, and guarantees 0 broken shields + budget conservation across 1~8 matches × ¥10~¥20,000", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const oosMatches = parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: rawFixture.matches.slice(0, 64) }],
      },
    }) as MatchItem[];

    // 1. Match-order permutation invariance across all 4 slots (catches .map(evPrimaryLegOf) index-as-minProbFloor bug!)
    const permSlate = oosMatches.slice(0, 4);
    const permutations = [
      [0, 1, 2, 3],
      [1, 0, 3, 2],
      [2, 3, 1, 0],
      [3, 2, 0, 1],
      [3, 0, 2, 1],
    ];
    const serializePlans = (plans: any[]) =>
      plans.map((p) => ({
        key: p.key,
        available: p.available,
        totalCost: p.totalCost,
        savedCash: p.savedCash,
        minReturn: p.minReturn,
        maxReturn: p.maxReturn,
        winProb: Number((p.winProb ?? 0).toFixed(12)),
        profitProb: Number((p.profitProb ?? 0).toFixed(12)),
        expectedValueRate: Number((p.expectedValueRate ?? 0).toFixed(12)),
        underwaterCount: p.underwaterCount,
        lines: p.lines.map((l: any) => ({
          multiple: l.multiple,
          cost: l.cost,
          returnPayout: l.returnPayout,
          legs: l.legs
            .map((g: any) => `${g.matchId}:${g.poolCode}:${g.optionKey}`)
            .sort(),
        })),
      }));

    const basePermRef = serializePlans(
      generateParetoPortfolio(permSlate, 100, "objective", false, [])
    );
    for (const perm of permutations.slice(1)) {
      const reordered = perm.map((idx) => permSlate[idx]);
      const permOut = serializePlans(
        generateParetoPortfolio(reordered, 100, "objective", false, [])
      );
      assert.deepEqual(
        permOut,
        basePermRef,
        `Objective Pareto 3+1 output must be strictly invariant under match permutation ${JSON.stringify(perm)}`
      );
    }

    // 2. Abolish pure-spear 84% voluntary underspend & restore genuine 主攻+单翻护盾 across 3~8 matches at ¥100
    for (const mCount of [3, 4, 5, 6, 7, 8]) {
      let shieldedCount = 0;
      let totalSlates = 0;
      for (let off = 0; off + mCount <= 48; off += 4) {
        const sub = oosMatches.slice(off, off + mCount);
        const s2 = generateParetoPortfolio(sub, 100, "objective", false, [])[1];
        totalSlates += 1;
        assert.equal(s2.available, true);
        assert.equal(s2.underwaterCount, 0);
        assert.equal(s2.totalCost + s2.savedCash, 100);
        if (s2.lines.length === 1) {
          assert.equal(
            s2.totalCost,
            100,
            `1-line pure spear at ¥100 must spend full ¥100 (no 84% = ¥84 underspend arbitrage!), got ¥${s2.totalCost}`
          );
        } else {
          shieldedCount += 1;
        }
      }
      assert.ok(
        shieldedCount >= Math.ceil(totalSlates * 0.4),
        `Expected genuine multi-line 主攻+单翻护盾 restoration on M=${mCount} at ¥100 (got ${shieldedCount}/${totalSlates} shielded)`
      );
    }

    // 3. Full matrix 1~8 matches × ¥10~¥20,000: per-line multiple <= 999, totalCost <= budget, totalCost + savedCash === budget, underwaterCount === 0!
    const budgets = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const mCount of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const b of budgets) {
        for (const slate of [
          FALLBACK_MATCHES.slice(0, mCount) as MatchItem[],
          oosMatches.slice(0, mCount),
          oosMatches.slice(8, 8 + mCount),
        ]) {
          const s2 = generateParetoPortfolio(
            slate,
            b,
            "objective",
            false,
            []
          )[1];
          assert.equal(s2.key, "max-ev-utility");
          assert.equal(s2.available, true);
          assert.ok(
            s2.totalCost <= b,
            `M=${mCount}, B=${b}: totalCost ${s2.totalCost} > ${b}`
          );
          assert.equal(
            s2.totalCost + s2.savedCash,
            b,
            `M=${mCount}, B=${b}: totalCost(${s2.totalCost}) + savedCash(${s2.savedCash}) !== ${b}`
          );
          assert.equal(
            s2.underwaterCount,
            0,
            `M=${mCount}, B=${b}: broken shield detected (underwaterCount=${s2.underwaterCount}, minReturn=${s2.minReturn}, totalCost=${s2.totalCost})`
          );
          assert.ok(
            s2.minReturn >= s2.totalCost - 1e-6,
            `M=${mCount}, B=${b}: minReturn ${s2.minReturn} < totalCost ${s2.totalCost}`
          );
          for (const ln of s2.lines) {
            assert.ok(
              ln.multiple >= 1 && ln.multiple <= 999,
              `M=${mCount}, B=${b}: line multiple ${ln.multiple} outside [1, 999]`
            );
          }
        }
      }
    }

    // Specifically sweep all 64 real OOS single matches at ¥10,000 & ¥100 (catches the 286/909 broken shields at ¥10,000 & 794/1,418 suboptimal 3-line splits at ¥100!)
    for (const m of oosMatches) {
      const s2At10k = generateParetoPortfolio(
        [m],
        10000,
        "objective",
        false,
        []
      )[1];
      assert.equal(
        s2At10k.underwaterCount,
        0,
        `Single OOS match ${m.id} at ¥10,000 suffered broken shield: cost=${s2At10k.totalCost}, minReturn=${s2At10k.minReturn}`
      );
      assert.equal(s2At10k.totalCost + s2At10k.savedCash, 10000);

      const s2At100 = generateParetoPortfolio(
        [m],
        100,
        "objective",
        false,
        []
      )[1];
      assert.equal(s2At100.underwaterCount, 0);
      if (s2At100.lines.length === 3) {
        // Verify exact log-wealth utility optimality over all zero-underwater 3-line splits with m2 < N * 0.45 at same totalCost!
        const cTot = s2At100.totalCost;
        const nTot = cTot / 2;
        const GAMMA = 0.65;
        const [l0, l1, l2] = s2At100.lines;
        const pMiss = Math.max(0, 1 - l0.prob - l1.prob - l2.prob);
        const evalU3 = (m0: number, m1: number, m2: number) =>
          l0.prob *
            Math.log(
              Math.max(1e-6, 1 + (GAMMA * (m0 * l0.unitPayout - cTot)) / 100)
            ) +
          l1.prob *
            Math.log(
              Math.max(1e-6, 1 + (GAMMA * (m1 * l1.unitPayout - cTot)) / 100)
            ) +
          l2.prob *
            Math.log(
              Math.max(1e-6, 1 + (GAMMA * (m2 * l2.unitPayout - cTot)) / 100)
            ) +
          pMiss * Math.log(Math.max(1e-6, 1 - (GAMMA * cTot) / 100));
        const actualU = evalU3(l0.multiple, l1.multiple, l2.multiple);
        let bestU = -Infinity;
        for (let m2 = 1; m2 < nTot * 0.45; m2++) {
          if (m2 * l2.unitPayout < cTot - 1e-6) continue;
          for (let m0 = 1; m0 <= nTot - m2 - 1; m0++) {
            const m1 = nTot - m2 - m0;
            if (m0 * l0.unitPayout < cTot - 1e-6) continue;
            if (m1 * l1.unitPayout < cTot - 1e-6) continue;
            if (m0 < Math.ceil((nTot - m2) / 2)) continue;
            bestU = Math.max(bestU, evalU3(m0, m1, m2));
          }
        }
        assert.ok(
          actualU >= bestU - 1e-12,
          `Single OOS match ${m.id} 3-line split (${l0.multiple},${l1.multiple},${l2.multiple}) utility ${actualU} < optimal ${bestU}`
        );
      }
    }
  });

  it("Slice 7 (Ticket #3 AC 3): enforces strict totalCost <= budget on Slot ③ (max-cvar-wheel) across 1~8 matches × ¥4~¥20,000, degrades gracefully to disjoint-block parlays at ¥4~¥10, and marks available:false only below ¥4", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const oosMatches = parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: rawFixture.matches.slice(0, 120) }],
      },
    }) as MatchItem[];

    // 1. Sweep M=4 and M=5 across 24 real OOS slates at ¥10 (reproduces the 315/315 ¥12 & 103/243 ¥20 budget overrun!)
    for (const mCount of [4, 5, 6, 7, 8]) {
      for (let i = 0; i + mCount <= 120; i += 5) {
        const slate = oosMatches.slice(i, i + mCount);
        const s3 = generateParetoPortfolio(
          slate,
          10,
          "objective",
          false,
          []
        )[2];
        assert.equal(s3.key, "max-cvar-wheel");
        assert.equal(
          s3.available,
          true,
          `M=${mCount} at ¥10 must be available`
        );
        assert.ok(
          s3.totalCost >= 4 && s3.totalCost <= 10,
          `M=${mCount} at ¥10 overrun! Expected totalCost in [4, 10], got ¥${s3.totalCost} (${s3.title})`
        );
        assert.equal(s3.totalCost + s3.savedCash, 10);
        assert.ok(s3.lines.length >= 2 && s3.lines.length <= 5);
        assert.ok(
          (s3.missOneReturn ?? 0) > 0,
          `M=${mCount} at ¥10 disjoint-block fallback must preserve miss-1 return > 0, got ${s3.missOneReturn}`
        );
      }
    }

    // 2. Full small-to-large budget matrix [4, 6, 8, 10, 20, 100, 5000, 20000] across M=1..8 + workspace checkout apply check
    for (const mCount of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const slate = oosMatches.slice(0, mCount);
      for (const b of [4, 6, 8, 10, 20, 100, 5000, 20000]) {
        const plans = generateParetoPortfolio(slate, b, "objective", false, []);
        const s3 = plans[2];
        assert.equal(
          s3.available,
          true,
          `M=${mCount} at ¥${b} (>= ¥4) must keep Slot ③ available`
        );
        assert.ok(
          s3.totalCost > 0 && s3.totalCost <= b,
          `M=${mCount} at ¥${b}: Slot ③ totalCost ${s3.totalCost} exceeded budget ${b}`
        );
        assert.equal(s3.totalCost + s3.savedCash, b);
        for (const ln of s3.lines) {
          assert.ok(ln.multiple >= 1 && ln.multiple <= 999);
        }
      }
    }

    // Verify evaluateQuantWorkspace applying max-cvar-wheel at budget=10 on 4 matches never charges ¥12 in effectiveReport
    const fourOos = oosMatches.slice(0, 4);
    const ws10Wheel = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 1,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-cvar-wheel",
          scaleMultiple: 1,
        },
        targetIds: fourOos.map((m) => m.id),
        budget: 10,
        stance: "objective",
        unlockFullAgg: false,
      },
      fourOos
    );
    assert.equal(ws10Wheel.portfolioPlans[2].available, true);
    assert.ok(ws10Wheel.portfolioPlans[2].totalCost <= 10);
    assert.ok(ws10Wheel.effectiveReport.totalCost <= 10);

    // 3. Budget < ¥4 (budget = 2 -> 1 note) honestly marks Slot ③ available: false across M=1..8
    for (const mCount of [1, 2, 4, 8]) {
      const slate = oosMatches.slice(0, mCount);
      const s3Under4 = generateParetoPortfolio(
        slate,
        2,
        "objective",
        false,
        []
      )[2];
      assert.equal(s3Under4.available, false);
      assert.equal(s3Under4.totalCost, 0);
      assert.equal(s3Under4.savedCash, 2);
      assert.equal(s3Under4.lines.length, 0);
      assert.ok(
        typeof s3Under4.emptyReason === "string" &&
          s3Under4.emptyReason.includes("¥4"),
        `Expected < ¥4 emptyReason on M=${mCount}, got: ${s3Under4.emptyReason}`
      );
    }
  });

  it("Slice 8 (Ticket #3 AC 4): classifies 8-match 4×6串1 dual complement honestly as 独立分块容错串 (zero false 旋转矩阵缩水 on miss-2-leaky v>=6 designs) and distinguishes <=10 logical groups from 99x physical shop slips", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const oosMatches = parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: rawFixture.matches.slice(0, 64) }],
      },
    }) as MatchItem[];

    // 1. Construct 8 strong-favorite matches where 4×6串1 dual complement wins at budget=8 (4 notes) & budget=100
    const eightFavs: MatchItem[] = FALLBACK_MATCHES.slice(0, 8).map(
      (fm, idx) => ({
        ...(fm as MatchItem),
        id: `ac4-8fav-${idx}`,
        matchNumStr: `周六30${idx + 1}`,
        pools: {
          ...(fm as MatchItem).pools,
          HHAD: { ...(fm as MatchItem).pools.HHAD, selling: false },
          HAFU: { ...(fm as MatchItem).pools.HAFU, selling: false },
          TTG: { ...(fm as MatchItem).pools.TTG, selling: false },
          CRS: { ...(fm as MatchItem).pools.CRS, selling: false },
          HAD: {
            ...(fm as MatchItem).pools.HAD,
            selling: true,
            single: false,
            payoutRatio: 0.89,
            vig: 0.11,
            options: [
              {
                key: "h",
                label: "主胜",
                odds: 1.26,
                trend: 0,
                fairProb: 0.706,
                shinProb: 0.706,
              },
              {
                key: "d",
                label: "平",
                odds: 5.2,
                trend: 0,
                fairProb: 0.171,
                shinProb: 0.171,
              },
              {
                key: "a",
                label: "客胜",
                odds: 7.2,
                trend: 0,
                fairProb: 0.123,
                shinProb: 0.123,
              },
            ],
          },
        },
      })
    );

    const s3EightAt8 = generateParetoPortfolio(
      eightFavs,
      8,
      "objective",
      false,
      []
    )[2] as any;
    assert.equal(s3EightAt8.available, true);
    assert.equal(s3EightAt8.totalCost, 8);
    if (s3EightAt8.lines.some((l: any) => l.legs.length === 6)) {
      assert.equal(
        s3EightAt8.title.includes("旋转矩阵缩水"),
        false,
        `8-match 4×6串1 dual complement wipes out on 24/28 miss-2 pairs and MUST NOT be crowned 旋转矩阵缩水: ${s3EightAt8.title}`
      );
      assert.ok(
        s3EightAt8.title.includes("独立分块容错串"),
        `Expected 4×6串1 dual complement to be classified honestly as 独立分块容错串, got: ${s3EightAt8.title}`
      );
    }

    const s3EightAt100 = generateParetoPortfolio(
      eightFavs,
      100,
      "objective",
      false,
      []
    )[2] as any;
    if (
      s3EightAt100.lines
        .filter((l: any) => l.legs.length < 8)
        .some((l: any) => l.legs.length === 6)
    ) {
      assert.equal(
        s3EightAt100.title.includes("旋转矩阵缩水"),
        false,
        `8-match 4×6串1 at ¥100 must NOT be crowned 旋转矩阵缩水: ${s3EightAt100.title}`
      );
      assert.ok(s3EightAt100.title.includes("独立分块容错串"));
    }

    // Universal invariant across M=6..8 OOS slates: any design crowned "旋转矩阵缩水" MUST survive 100% of miss-2 pairs (0 miss-2 wipeout)!
    const hasZeroMiss2WipeoutOnLines = (mIds: string[], lines: any[]) => {
      const v = mIds.length;
      const subBlocks = lines
        .filter((l) => l.legs.length < v)
        .map((l) => new Set(l.legs.map((g: any) => g.matchId)));
      if (subBlocks.length === 0) return false;
      for (let i = 0; i < v; i++) {
        for (let j = i + 1; j < v; j++) {
          const missA = mIds[i];
          const missB = mIds[j];
          const survives = subBlocks.some(
            (s) => !s.has(missA) && !s.has(missB)
          );
          if (!survives) return false;
        }
      }
      return true;
    };

    for (const v of [6, 7, 8]) {
      for (let off = 0; off + v <= 64; off += 4) {
        const slate = oosMatches.slice(off, off + v);
        for (const b of [8, 20, 100, 200]) {
          const s3 = generateParetoPortfolio(
            slate,
            b,
            "objective",
            false,
            []
          )[2] as any;
          if (s3.title.includes("旋转矩阵缩水")) {
            assert.equal(
              hasZeroMiss2WipeoutOnLines(
                slate.map((m) => m.id),
                s3.lines
              ),
              true,
              `v=${v}, B=${b}: design "${s3.title}" crowned 旋转矩阵缩水 despite having miss-2 wipeout gaps!`
            );
          }
        }
      }
    }

    // Genuine C(6,3,2), C(7,3,2), C(8,4,2) still earn "旋转矩阵缩水" on balanced slates at ¥200
    const balanced6 = oosMatches.slice(0, 6);
    const s3Bal6 = generateParetoPortfolio(
      balanced6,
      200,
      "objective",
      false,
      []
    )[2] as any;
    if (s3Bal6.title.includes("C(6,3,2)")) {
      assert.ok(s3Bal6.title.includes("旋转矩阵缩水"));
    }

    // 2. Distinguish logicalGroupCount (<= 10) vs 99x physicalTicketCount on normal (¥100) and large (¥10,000) budgets
    const sixOos = oosMatches.slice(0, 6);
    const s3Normal = generateParetoPortfolio(
      sixOos,
      100,
      "objective",
      false,
      []
    )[2] as any;
    assert.equal(s3Normal.logicalGroupCount, s3Normal.lines.length);
    assert.ok(s3Normal.logicalGroupCount <= 10);
    assert.equal(
      s3Normal.physicalTicketCount,
      s3Normal.lines.reduce(
        (a: number, l: any) => a + Math.ceil(l.multiple / 99),
        0
      )
    );

    const s3Large10k = generateParetoPortfolio(
      sixOos,
      10000,
      "objective",
      false,
      []
    )[2] as any;
    const expectedPhysical = s3Large10k.lines.reduce(
      (a: number, l: any) => a + Math.ceil(l.multiple / 99),
      0
    );
    assert.equal(s3Large10k.logicalGroupCount, s3Large10k.lines.length);
    assert.ok(s3Large10k.logicalGroupCount <= 10);
    assert.equal(s3Large10k.physicalTicketCount, expectedPhysical);
    assert.ok(
      s3Large10k.physicalTicketCount > s3Large10k.logicalGroupCount * 4,
      `Expected ¥10,000 wheel physical 99x slip count (${s3Large10k.physicalTicketCount}) >> logical groups (${s3Large10k.logicalGroupCount})`
    );
    assert.ok(
      s3Large10k.title.includes("逻辑组合") &&
        s3Large10k.title.includes(`${expectedPhysical}张纸质实票`),
      `Large-budget wheel title must distinguish logical groups from ${expectedPhysical} physical 99x slips, got: ${s3Large10k.title}`
    );
    assert.ok(
      s3Large10k.reasons[0].includes("逻辑组合") &&
        s3Large10k.reasons[0].includes("99") &&
        s3Large10k.reasons[0].includes(`${expectedPhysical}`),
      `Large-budget wheel reasons[0] must explain 99x physical slip count, got: ${s3Large10k.reasons[0]}`
    );
  });

  it("Slice 9 (Ticket #3 AC 5): prioritizes strictNetGainProb over breakEvenProb in Slot ① (including ¥4,000 scaling), surfaces dynamic bestObservedReturnPct & 101.0% gap in empty Slot ④, and aligns Manual Q&A + UserManualModal honesty", async () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const oosMatches = parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: rawFixture.matches.slice(0, 64) }],
      },
    }) as MatchItem[];

    // 1a. Direct trade-off: pure refund [2.00, 2.00] (strictNetGainProb=0, breakEvenProb=0.89) vs strict net-gain [2.00, 7.50] (strictNetGainProb=0.56) at ¥20
    const strictVsRefundMatch: MatchItem = {
      ...(FALLBACK_MATCHES[1] as MatchItem),
      id: "ac5-strict-vs-refund",
      pools: {
        ...(FALLBACK_MATCHES[1] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[1] as MatchItem).pools.HAD,
          single: true,
          selling: true,
          options: [
            {
              key: "h",
              label: "主胜",
              odds: 2.0,
              trend: 0,
              fairProb: 0.45,
              shinProb: 0.45,
            },
            {
              key: "d",
              label: "平",
              odds: 2.0,
              trend: 0,
              fairProb: 0.44,
              shinProb: 0.44,
            },
            {
              key: "a",
              label: "客胜",
              odds: 7.5,
              trend: 0,
              fairProb: 0.11,
              shinProb: 0.11,
            },
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
    const slot1Strict = generateParetoPortfolio(
      [strictVsRefundMatch],
      20,
      "objective",
      false,
      []
    )[0] as any;
    assert.equal(slot1Strict.underwaterCount, 0);
    assert.ok(
      slot1Strict.strictNetGainProb > 0.5,
      `Slot ① must prioritize strictNetGainProb (>0.50 via {h,a}) over 0%-net-gain pure refund {h,d}, got strict=${slot1Strict.strictNetGainProb}, breakEven=${slot1Strict.breakEvenProb}`
    );

    // 1b. Large-budget ¥4,000 single-match strictNetGainProb: zero 1-note transfer improvement on same chosen options & same totalCost!
    const exactDivisor4kMatch: MatchItem = {
      ...(FALLBACK_MATCHES[0] as MatchItem),
      id: "ac5-4k-divisor",
      pools: {
        ...(FALLBACK_MATCHES[0] as MatchItem).pools,
        HAD: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.HAD,
          selling: false,
        },
        HHAD: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.HHAD,
          selling: false,
        },
        CRS: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.CRS,
          selling: false,
        },
        HAFU: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.HAFU,
          selling: false,
        },
        TTG: {
          ...(FALLBACK_MATCHES[0] as MatchItem).pools.TTG,
          single: true,
          selling: true,
          options: [
            {
              key: "s2",
              label: "2球",
              odds: 1.37,
              trend: 0,
              fairProb: 0.7517,
              shinProb: 0.7517,
            },
            {
              key: "s3",
              label: "3球",
              odds: 9.75,
              trend: 0,
              fairProb: 0.0824,
              shinProb: 0.0824,
            },
            {
              key: "s4",
              label: "4球",
              odds: 140.0,
              trend: 0,
              fairProb: 0.02,
              shinProb: 0.02,
            },
            {
              key: "s0",
              label: "0球",
              odds: 18.0,
              trend: 0,
              fairProb: 0.0459,
              shinProb: 0.0459,
            },
            {
              key: "s1",
              label: "1球",
              odds: 12.0,
              trend: 0,
              fairProb: 0.05,
              shinProb: 0.05,
            },
            {
              key: "s5",
              label: "5球",
              odds: 35.0,
              trend: 0,
              fairProb: 0.02,
              shinProb: 0.02,
            },
            {
              key: "s6",
              label: "6球",
              odds: 60.0,
              trend: 0,
              fairProb: 0.015,
              shinProb: 0.015,
            },
            {
              key: "s7",
              label: "7+球",
              odds: 80.0,
              trend: 0,
              fairProb: 0.015,
              shinProb: 0.015,
            },
          ],
        },
      },
    };
    for (const m of [exactDivisor4kMatch, ...oosMatches]) {
      const s1At4k = generateParetoPortfolio(
        [m],
        4000,
        "objective",
        false,
        []
      )[0] as any;
      assert.equal(s1At4k.underwaterCount, 0);
      assert.equal(s1At4k.totalCost + s1At4k.savedCash, 4000);
      const cTot = s1At4k.totalCost;
      const curStrict = s1At4k.lines
        .filter((l: any) => l.returnPayout > cTot + 1e-6)
        .reduce((a: number, l: any) => a + l.prob, 0);
      // Verify NO 1-note move from line i to line j preserves zero-underwater while strictly increasing strictNetGainProb!
      for (let i = 0; i < s1At4k.lines.length; i++) {
        const li = s1At4k.lines[i];
        if (li.multiple <= 1) continue;
        if ((li.multiple - 1) * li.unitPayout < cTot - 1e-6) continue;
        for (let j = 0; j < s1At4k.lines.length; j++) {
          if (i === j) continue;
          const lj = s1At4k.lines[j];
          if (lj.multiple >= 999) continue;
          const movedStrict = s1At4k.lines.reduce(
            (acc: number, lk: any, k: number) => {
              const multK =
                k === i
                  ? lk.multiple - 1
                  : k === j
                    ? lk.multiple + 1
                    : lk.multiple;
              return acc + (multK * lk.unitPayout > cTot + 1e-6 ? lk.prob : 0);
            },
            0
          );
          assert.ok(
            movedStrict <= curStrict + 1e-12,
            `Match ${m.id} at ¥4,000 left strictNetGainProb on the table: moving 1 note ${i}->${j} lifts ${curStrict} -> ${movedStrict}`
          );
        }
      }
    }

    // 2. Slot ④ empty state dynamically exposes bestObservedReturnPct & gap to 101.0% while preserving >= 101% + positive-EV gate
    const s4OosA = generateParetoPortfolio(
      oosMatches.slice(0, 2),
      100,
      "objective",
      false,
      []
    )[3] as any;
    const s4OosB = generateParetoPortfolio(
      oosMatches.slice(10, 14),
      100,
      "objective",
      false,
      []
    )[3] as any;
    for (const s4 of [s4OosA, s4OosB]) {
      assert.equal(s4.available, false);
      assert.equal(s4.totalCost, 0);
      assert.equal(s4.savedCash, 100);
      assert.ok(
        typeof s4.bestObservedReturnPct === "number" &&
          s4.bestObservedReturnPct > 75 &&
          s4.bestObservedReturnPct < 101,
        `Expected bestObservedReturnPct in (75, 101), got ${s4.bestObservedReturnPct}`
      );
      assert.equal(
        s4.alphaThresholdGapPct,
        Number((101.0 - s4.bestObservedReturnPct).toFixed(1))
      );
      const expectedPhrase = `当前所选场次最高校准单腿返还率 ${s4.bestObservedReturnPct.toFixed(1)}%（距 101.0% 正期望门槛差 ${s4.alphaThresholdGapPct.toFixed(1)} 个百分点）`;
      assert.ok(
        s4.emptyReason?.includes(expectedPhrase),
        `Expected emptyReason to include "${expectedPhrase}", got: ${s4.emptyReason}`
      );
    }

    // 3. Iron-Cage Manual Q&A & UserManualModal honest copy verification
    const qa = createManualQaEngine({});
    const resAlpha = await qa.answerManualQuestion({
      userId: "u-ac5-alpha",
      question: "为什么错价雷达总是空仓？",
      ip: "127.0.0.1",
    });
    assert.equal(resAlpha.ok, true);
    assert.equal(resAlpha.source, "local-kb");
    assert.ok(
      resAlpha.answer.includes("常态") &&
        resAlpha.answer.includes("101") &&
        resAlpha.answer.includes("最高校准单腿返还率"),
      `qa-alpha-empty must state empty state is normal under tight pricing and mention 最高校准单腿返还率, got: ${resAlpha.answer}`
    );

    const resWheel = await qa.answerManualQuestion({
      userId: "u-ac5-wheel",
      question: "什么是旋转矩阵缩水？",
      ip: "127.0.0.1",
    });
    assert.equal(resWheel.ok, true);
    assert.equal(resWheel.source, "local-kb");
    assert.ok(
      resWheel.answer.includes("独立分块容错串") &&
        resWheel.answer.includes("逻辑组合") &&
        resWheel.answer.includes("99"),
      `qa-covering-wheel must distinguish 独立分块容错串 and <=10 组逻辑组合 vs 99x physical slips, got: ${resWheel.answer}`
    );

    const manualSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/manual/UserManualModal.tsx"),
      "utf8"
    );
    assert.ok(
      manualSrc.includes("独立分块容错串") &&
        manualSrc.includes("逻辑组合") &&
        manualSrc.includes("99") &&
        manualSrc.includes("最高校准单腿返还率"),
      "UserManualModal.tsx must reflect honest taxonomy, 99x slip distinction, and empty-alpha ceiling disclosure"
    );
  });
});
