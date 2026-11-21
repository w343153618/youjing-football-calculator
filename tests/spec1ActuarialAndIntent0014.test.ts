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
