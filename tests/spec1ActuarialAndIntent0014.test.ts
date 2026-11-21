import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FALLBACK_MATCHES,
  OFFICIAL_CRS_PAIRS,
  analyzeMatchMicroQuant,
  calibrateMatchCoherentModel,
  computeTruthReport,
  devigPoolProbabilities,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
  parseSportteryRawJson,
  parseSportteryResultsJson,
  settleTicketSnapshotWithOfficialResults,
} from "../server/quantEngine.mjs";
import { createLedgerManager } from "../server/ledgerManager.mjs";
import { createManualQaEngine } from "../server/manualQaEngine.mjs";
import { createYouJingRuntime } from "../server/runtimeApp.mjs";
import {
  computeEnvelopeHmacHex,
  decryptEnvelope,
  deriveSessionSubkeys,
  encryptEnvelope,
} from "../server/securityShield.mjs";
import {
  createBetSlipController,
  normalizeBudgetYuan,
} from "../src/workspace/betSlipController.ts";
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
    assert.ok(
      appSrc.includes("比赛节奏相关性") &&
        appSrc.includes("低比分联动修正系数"),
      "SkinPhoneApp.tsx pace tile must clarify ρ as 低比分联动修正系数"
    );
    for (const sampleMatch of (FALLBACK_MATCHES as MatchItem[]).slice(0, 4)) {
      const cal = calibrateMatchCoherentModel(sampleMatch);
      const mq = analyzeMatchMicroQuant(sampleMatch, cal);
      assert.equal(
        mq.paceCorrelation,
        Number(cal.params.rho.toFixed(4)),
        "analyzeMatchMicroQuant.paceCorrelation must expose the calibrated Dixon-Coles low-score linkage ρ"
      );
      assert.ok(
        mq.paceCorrelation >= -0.25 && mq.paceCorrelation <= 0.25,
        `Dixon-Coles ρ must stay bounded in [-0.25, 0.25], got ${mq.paceCorrelation}`
      );
    }
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

describe("Spec #1 (0014) · Ticket #4: Intent-Preserving Mutex-Free Selection, Auto-Balanced 3-Way Synthetic Single & Instant Parlay Restoration", () => {
  it("Slice 10 (Ticket #4 AC 1): removes mutex lock on open pools, switches same-match pools smoothly (including direct equivalent-arb target clicks) with 1-click undo, preserves dual-single coexistence, and retains server forged-payload defense", async () => {
    const m0 = FALLBACK_MATCHES[0] as MatchItem; // HAD.single = false
    const m1 = FALLBACK_MATCHES[1] as MatchItem; // HAD.single = true, HHAD.single = true
    const m2 = FALLBACK_MATCHES[2] as MatchItem;

    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      FALLBACK_MATCHES as MatchItem[],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, FALLBACK_MATCHES)
    );

    // 1. Pick HAD:h + HAD:d on m0 AND HAD:h on m2 (2-match parlay)
    assert.equal(ctrl.togglePick(m0, "HAD", "h").ok, true);
    assert.equal(ctrl.togglePick(m0, "HAD", "d").ok, true);
    assert.equal(ctrl.togglePick(m2, "HAD", "h").ok, true);

    // Zero open pools are mutex-locked across HAD/HHAD/TTG/HAFU/CRS
    for (const pool of ["HAD", "HHAD", "TTG", "HAFU", "CRS"] as PoolCode[]) {
      assert.equal(
        ctrl.isPoolMutexLocked(m0, pool),
        false,
        `Pool ${pool} on open match must NOT be mutex-locked`
      );
    }

    // 2. Direct 1-tap switch on m0 from HAD (h+d) -> HHAD (ha / equivalent-arb style click) preserves m2 pick!
    const hhadKey = m0.pools.HHAD.options[2].key;
    const sw1 = ctrl.togglePick(m0, "HHAD", hhadKey);
    assert.equal(sw1.ok, true);
    assert.equal(sw1.action, "switched-pool");
    assert.equal(sw1.replacedCount, 2);
    assert.equal(sw1.replacedPoolName, m0.pools.HAD.name);
    assert.equal(sw1.canUndoPoolSwitch, true);
    assert.ok(ctrl.getState().lastPoolSwitchUndo !== null);
    assert.deepEqual(
      ctrl
        .getState()
        .picks.map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`),
      [`${m2.id}:HAD:h`, `${m0.id}:HHAD:${hhadKey}`]
    );
    assert.equal(ctrl.getState().workspace.manualReport.canCheckout, true);
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, "2串1");

    // 3. 1-click undo restores exact previous [m0 HAD:h, m0 HAD:d, m2 HAD:h] state and consumes snapshot
    assert.equal(ctrl.undoLastPoolSwitch(), true);
    assert.equal(ctrl.getState().lastPoolSwitchUndo, null);
    assert.deepEqual(
      ctrl
        .getState()
        .picks.map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`),
      [`${m0.id}:HAD:h`, `${m0.id}:HAD:d`, `${m2.id}:HAD:h`]
    );
    assert.equal(ctrl.undoLastPoolSwitch(), false);

    // 4. Direct switch across TTG -> HAFU -> CRS on m0 also works smoothly
    const swTtg = ctrl.togglePick(m0, "TTG", "s2");
    assert.equal(swTtg.ok, true);
    assert.equal(swTtg.action, "switched-pool");
    assert.equal(swTtg.replacedCount, 2);
    const swHafu = ctrl.togglePick(m0, "HAFU", "hh");
    assert.equal(swHafu.ok, true);
    assert.equal(swHafu.action, "switched-pool");
    const crsFirstKey = m0.pools.CRS.options[0].key;
    const swCrs = ctrl.togglePick(m0, "CRS", crsFirstKey);
    assert.equal(swCrs.ok, true);
    assert.equal(swCrs.action, "switched-pool");
    assert.deepEqual(
      ctrl
        .getState()
        .picks.filter((p) => p.matchId === m0.id)
        .map((p) => `${p.poolCode}:${p.optionKey}`),
      [`CRS:${crsFirstKey}`]
    );

    // 5. All-single coexistence on m1 in 'spf' & 'single' modes locks [1] with autoLockedSingleReason = 'dual-single'
    ctrl.clearPicks();
    ctrl.setMode("single");
    assert.equal(ctrl.togglePick(m1, "HAD", "h").ok, true);
    const dualRes = ctrl.togglePick(m1, "HHAD", m1.pools.HHAD.options[1].key);
    assert.equal(dualRes.ok, true);
    assert.equal(dualRes.action, "added");
    assert.equal(dualRes.autoLockedSingleReason, "dual-single");
    assert.equal(ctrl.getState().picks.length, 2);
    assert.equal(ctrl.getState().workspace.manualReport.canCheckout, true);
    assert.equal(ctrl.getState().workspace.manualReport.modeLabel, "单关");

    // 6. Server statutory defense-in-depth: forged mixed-pool parlay payload is strictly blocked with ¥0
    const forgedMixed = [
      {
        matchId: m0.id,
        matchNumStr: m0.matchNumStr,
        home: m0.home,
        away: m0.away,
        poolCode: "HAD" as PoolCode,
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds: m0.pools.HAD.options[0].odds,
        fairProb: m0.pools.HAD.options[0].fairProb,
      },
      {
        matchId: m0.id,
        matchNumStr: m0.matchNumStr,
        home: m0.home,
        away: m0.away,
        poolCode: "TTG" as PoolCode,
        poolName: "总进球",
        singleAllowed: true,
        optionKey: "s2",
        optionLabel: "2球",
        odds: m0.pools.TTG.options[2].odds,
        fairProb: m0.pools.TTG.options[2].fairProb,
      },
    ];
    const forgedRep = computeTruthReport(forgedMixed, 5, FALLBACK_MATCHES);
    assert.equal(forgedRep.canCheckout, false);
    assert.equal(forgedRep.totalCost, 0);
    assert.equal(forgedRep.maxPayout, 0);
  });

  it("Slice 11 (Ticket #4 AC 2): upgrades syntheticRescuePicks to full 3-way equivalence and auto-mounts zero-blind-spot inverse-odds balanced Synthetic Single into effectiveReport, shopkeeper slip & sealed ledger snapshot without mutating picks", async () => {
    const os = await import("node:os");
    const m0 = FALLBACK_MATCHES[0] as MatchItem; // HAD.single = false, HAFU.single = true
    assert.equal(m0.pools.HAD.single, false);
    assert.equal(m0.pools.HAFU.single, true);

    const makePick = (
      m: MatchItem,
      poolCode: PoolCode,
      optKey: string
    ): SelectedPick => {
      const pool = m.pools[poolCode];
      const opt = pool.options.find((o) => o.key === optKey)!;
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

    // 1. computeTruthReport upgrades syntheticRescuePicks to complete 3-way HAFU & multi-pick / HHAD unions
    const repHome = computeTruthReport([makePick(m0, "HAD", "h")], 5, [m0]);
    assert.deepEqual(
      repHome.syntheticRescuePicks?.map((p: SelectedPick) => p.optionKey),
      ["hh", "dh", "ah"]
    );
    const repDraw = computeTruthReport([makePick(m0, "HAD", "d")], 5, [m0]);
    assert.deepEqual(
      repDraw.syntheticRescuePicks?.map((p: SelectedPick) => p.optionKey),
      ["dd", "hd", "ad"]
    );
    const repAway = computeTruthReport([makePick(m0, "HAD", "a")], 5, [m0]);
    assert.deepEqual(
      repAway.syntheticRescuePicks?.map((p: SelectedPick) => p.optionKey),
      ["aa", "da", "ha"]
    );
    const repHomeDraw = computeTruthReport(
      [makePick(m0, "HAD", "h"), makePick(m0, "HAD", "d")],
      5,
      [m0]
    );
    assert.equal(repHomeDraw.syntheticRescuePicks?.length, 6);

    const nonSingleHhadMatch: MatchItem = {
      ...m0,
      id: "m0-hhad-nosgl",
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: false },
        HHAD: { ...m0.pools.HHAD, goalLine: "-1", single: false },
      },
    };
    const repHhadPlus = computeTruthReport(
      [makePick(nonSingleHhadMatch, "HHAD", "ha")],
      5,
      [nonSingleHhadMatch]
    );
    assert.equal(
      repHhadPlus.syntheticRescuePicks?.length,
      6,
      "HHAD(-1) ha (= Draw + Away) must resolve to 6 single-eligible HAFU items when HAD & HHAD are non-single"
    );
    const repHhadMinus = computeTruthReport(
      [makePick(nonSingleHhadMatch, "HHAD", "hh")],
      5,
      [nonSingleHhadMatch]
    );
    assert.ok(
      (repHhadMinus.syntheticRescuePicks?.length ?? 0) >= 8 &&
        repHhadMinus.syntheticRescuePicks?.every(
          (p: SelectedPick) => p.poolCode === "CRS" && p.singleAllowed === true
        ),
      "HHAD(-1) hh (win by >=2) must resolve to single-eligible CRS scorelines"
    );

    // 2. BetSlipController: selecting 1 non-single HAD:h preserves state.picks=[HAD:h] while auto-mounting balanced 3-way HAFU in effectiveReport
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      FALLBACK_MATCHES as MatchItem[],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, FALLBACK_MATCHES)
    );

    const vPick = ctrl.togglePick(m0, "HAD", "h");
    assert.equal(vPick.ok, true);
    assert.equal(ctrl.getState().syntheticSingleMode, "full-3way");
    // Intent preserved! Match Radar button stays highlighted on HAD:h!
    assert.deepEqual(
      ctrl.getState().picks.map((p) => `${p.poolCode}:${p.optionKey}`),
      ["HAD:h"]
    );

    const ws = ctrl.getState().workspace;
    assert.equal(ws.manualReport.canCheckout, false);
    assert.equal(ws.effectiveReport.canCheckout, true);
    assert.equal(ws.effectiveReport.syntheticAutoMounted, true);
    assert.equal(ws.effectiveReport.syntheticModeUsed, "full-3way");
    assert.equal(ws.effectiveReport.syntheticBlindSpotProb, 0);
    assert.equal(ws.effectiveReport.underwaterCount, 0);
    assert.ok(
      ws.effectiveReport.totalCost >= 6 &&
        ws.effectiveReport.totalCost % 2 === 0
    );
    assert.ok(ws.effectiveReport.minPayout >= ws.effectiveReport.totalCost);
    assert.ok((ws.effectiveReport.syntheticEffectiveOdds ?? 0) > 1.0);

    // Exact probability equivalence: 3-way HAFU hit rate === coherent HAD:h fairProb!
    const hadHProb = m0.pools.HAD.options.find((o) => o.key === "h")!.fairProb;
    assert.ok(
      Math.abs(ws.effectiveReport.anyWinProb - hadHProb) < 1e-6,
      `3-way HAFU anyWinProb (${ws.effectiveReport.anyWinProb}) must equal coherent HAD:h prob (${hadHProb}) with 0% blind spot`
    );
    assert.deepEqual(
      ws.effectiveReport.tickets?.map((t) => t.legs?.[0]?.optionKey).sort(),
      ["ah", "dh", "hh"]
    );

    // 3. Shopkeeper WeChat Slip outputs the 3 balanced HAFU single lines summing to effectiveReport.totalCost
    const slipText = ctrl.formatShopkeeperWeChatSlip();
    assert.ok(slipText.includes(`合计 ¥${ws.effectiveReport.totalCost}`));
    assert.ok(
      slipText.includes("胜胜") &&
        slipText.includes("平胜") &&
        slipText.includes("负胜")
    );
    assert.equal(slipText.includes("胜平负"), false);

    // 4. Sealed Ledger Snapshot passes authoritative server ledgerManager single-eligibility check AND settles comeback 0:1 -> 2:1 ("ah") as WON!
    const draft = ctrl.buildSealedLedgerDraft();
    assert.ok(draft && draft.snapshot);
    assert.equal(draft.cost, ws.effectiveReport.totalCost);
    assert.equal(draft.snapshot.lines.length, 3);
    assert.ok(
      draft.snapshot.lines.every(
        (ln) => ln.legs.length === 1 && ln.legs[0].poolCode === "HAFU"
      )
    );

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yj-syn-ledger-"));
    try {
      const lm = createLedgerManager({ dataDir: tmpDir });
      const addRes = lm.mutateUserLedger(
        "u-syn-1",
        {
          action: "add-entry",
          kind: "live",
          ...draft,
        },
        {
          authoritativeMatches: FALLBACK_MATCHES,
          trustedServerSnapshot: true,
        }
      );
      assert.equal(addRes.ok, true);
      const savedEntry = addRes.ledger.entries[0];
      assert.equal(savedEntry.snapshot.lines.length, 3);

      // Settle against a halftime-trailing comeback HT 0:1 -> FT 2:1 ("ah" = 负胜)!
      const comebackResults = parseSportteryResultsJson({
        errorCode: "0",
        value: {
          matchResult: [
            {
              matchId: m0.id,
              matchNumStr: m0.matchNumStr,
              homeTeam: m0.home,
              awayTeam: m0.away,
              matchResultStatus: "2",
              poolStatus: "Payout",
              sectionsNo1: "0:1",
              sectionsNo999: "2:1",
            },
          ],
        },
      });
      const settled = settleTicketSnapshotWithOfficialResults(
        savedEntry.snapshot,
        comebackResults,
        { stakeCost: savedEntry.cost }
      );
      assert.equal(
        settled.status,
        "won",
        "3-way synthetic single MUST win with net profit > 0 even on HT 0:1 -> FT 2:1 comeback!"
      );
      assert.ok(settled.settledReturn >= savedEntry.cost);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("Slice 12 (Ticket #4 AC 3, AC 4 & AC 5): supports full-3way / trim-2way (with exact comeback blind-spot disclosure) / off mode switching, blocks synEff <= 1.00 unplayable favorites honestly, restores low-vig 2串1 in 0ms on 2nd match, seals via encrypted runtime, and enforces dual-viewport UI contracts", async () => {
    const os = await import("node:os");
    const { EventEmitter } = await import("node:events");
    const m0 = FALLBACK_MATCHES[0] as MatchItem; // HAD.single = false
    const m2 = FALLBACK_MATCHES[2] as MatchItem; // HAD.single = false

    const ctrl = createBetSlipController({
      debounceMs: 0,
      autoSyncRadar: true,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      FALLBACK_MATCHES as MatchItem[],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, FALLBACK_MATCHES)
    );

    // 1. Start on 1 non-single match (m0 HAD:h): full-3way default -> switch to trim-2way -> switch to off
    ctrl.togglePick(m0, "HAD", "h");
    const repFull = ctrl.getState().workspace.effectiveReport;
    assert.equal(repFull.syntheticAutoMounted, true);
    assert.equal(repFull.syntheticModeUsed, "full-3way");
    assert.equal(repFull.syntheticBlindSpotProb, 0);

    ctrl.setSyntheticSingleMode("trim-2way");
    const repTrim = ctrl.getState().workspace.effectiveReport;
    assert.equal(repTrim.canCheckout, true);
    assert.equal(repTrim.syntheticAutoMounted, true);
    assert.equal(repTrim.syntheticModeUsed, "trim-2way");
    assert.equal(repTrim.underwaterCount, 0);
    assert.deepEqual(
      repTrim.tickets?.map((t) => t.legs?.[0]?.optionKey).sort(),
      ["dh", "hh"]
    );
    assert.ok(
      (repTrim.syntheticEffectiveOdds ?? 0) >
        (repFull.syntheticEffectiveOdds ?? 0),
      `trim-2way effective odds (${repTrim.syntheticEffectiveOdds}) must exceed full-3way (${repFull.syntheticEffectiveOdds})`
    );
    const ahProb = m0.pools.HAFU.options.find((o) => o.key === "ah")!.fairProb;
    assert.ok(
      (repTrim.syntheticBlindSpotProb ?? 0) > 0 &&
        Math.abs((repTrim.syntheticBlindSpotProb ?? 0) - ahProb) < 1e-5,
      `trim-2way must report exact comeback blind-spot prob ${ahProb}, got ${repTrim.syntheticBlindSpotProb}`
    );
    assert.ok(
      Math.abs(
        repFull.anyWinProb -
          repTrim.anyWinProb -
          (repTrim.syntheticBlindSpotProb ?? 0)
      ) < 1e-5
    );
    assert.ok(repTrim.syntheticBlindSpotLabel?.includes("逆转"));
    assert.ok(
      repTrim.warnings.some((w) => w.id === "synthetic-blind-spot"),
      "trim-2way must emit explicit synthetic-blind-spot warning"
    );

    // Away direction ("a") in trim-2way drops "ha" (胜负) comeback
    ctrl.clearPicks();
    ctrl.togglePick(m0, "HAD", "a");
    ctrl.setSyntheticSingleMode("trim-2way");
    const repAwayTrim = ctrl.getState().workspace.effectiveReport;
    assert.deepEqual(
      repAwayTrim.tickets?.map((t) => t.legs?.[0]?.optionKey).sort(),
      ["aa", "da"]
    );
    assert.ok((repAwayTrim.syntheticBlindSpotProb ?? 0) > 0);
    assert.ok(repAwayTrim.syntheticBlindSpotLabel?.includes("胜负"));

    // "off" mode unmounts synthetic single and exposes bridgeCandidates
    ctrl.setSyntheticSingleMode("off");
    const wsOff = ctrl.getState().workspace;
    assert.equal(wsOff.effectiveReport.canCheckout, false);
    assert.equal(Boolean(wsOff.effectiveReport.syntheticAutoMounted), false);
    assert.equal(wsOff.effectiveReport.syntheticModeUsed, "off");
    assert.ok(wsOff.insights.bridgeCandidates.length >= 1);

    // Switch back to full-3way before testing 2nd-match parlay restoration
    ctrl.clearPicks();
    ctrl.togglePick(m0, "HAD", "h");
    assert.equal(
      ctrl.getState().workspace.effectiveReport.syntheticAutoMounted,
      true
    );

    // 2. Instant 0ms Parlay Restoration on adding 2nd match (m2 HAD:h):
    // Zero HAFU residue, low-vig HAD × HAD 2串1, clean radar anchor!
    ctrl.togglePick(m2, "HAD", "h");
    const stParlay = ctrl.getState();
    assert.deepEqual(
      stParlay.picks.map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`),
      [`${m0.id}:HAD:h`, `${m2.id}:HAD:h`]
    );
    assert.equal(
      Boolean(stParlay.workspace.effectiveReport.syntheticAutoMounted),
      false
    );
    assert.equal(stParlay.workspace.manualReport.canCheckout, true);
    assert.equal(stParlay.workspace.effectiveReport.canCheckout, true);
    assert.equal(stParlay.workspace.effectiveReport.modeLabel, "2串1");
    assert.equal(stParlay.workspace.effectiveReport.betCount, 1);
    assert.equal(stParlay.workspace.effectiveReport.totalCost, 10);
    assert.ok(
      stParlay.workspace.effectiveReport.tickets?.every((t) =>
        t.legs?.every((lg) => lg.poolCode === "HAD")
      ),
      "2-match parlay tickets MUST use low-vig HAD legs with zero HAFU residue"
    );
    assert.ok(
      stParlay.workspace.effectiveReport.avgVigLossPer100 < 24,
      `Expected low-vig HADxHAD parlay (<24%), got ${stParlay.workspace.effectiveReport.avgVigLossPer100}%`
    );
    const slot1Parlay = stParlay.workspace.portfolioPlans.find(
      (p) => p.key === "max-profit-prob"
    )!;
    assert.ok(
      slot1Parlay.lines[0].legs.some(
        (lg) =>
          lg.matchId === m0.id && lg.poolCode === "HAD" && lg.optionKey === "h"
      ),
      "3+1 Pareto anchor must see clean m0 HAD:h without HAFU pollution"
    );

    // Removing 2nd match smoothly re-mounts 3-way synthetic single on m0!
    ctrl.removeMatchFromSlip(m2.id);
    assert.equal(
      ctrl.getState().workspace.effectiveReport.syntheticAutoMounted,
      true
    );
    assert.equal(ctrl.getState().workspace.effectiveReport.canCheckout, true);

    // 3. Profitability Hard Gate: ultra-heavy favorite (<= 1.12, synEff <= 1.00) is honestly blocked!
    const ultraHeavyMatch: MatchItem = {
      ...m0,
      id: "m-ultra-heavy-112",
      matchNumStr: "周六099",
      pools: {
        ...m0.pools,
        HAD: {
          ...m0.pools.HAD,
          single: false,
          options: [
            { key: "h", label: "主胜", odds: 1.12, trend: -1, fairProb: 0.8 },
            { key: "d", label: "平", odds: 6.5, trend: 0, fairProb: 0.13 },
            { key: "a", label: "客胜", odds: 13.0, trend: 1, fairProb: 0.07 },
          ],
        },
        HAFU: {
          ...m0.pools.HAFU,
          single: true,
          options: m0.pools.HAFU.options.map((o) =>
            o.key === "hh"
              ? { ...o, odds: 1.42 }
              : o.key === "dh"
                ? { ...o, odds: 3.6 }
                : o.key === "ah"
                  ? { ...o, odds: 22.0 }
                  : o
          ),
        },
      },
    };
    const wsUnplayable = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: ultraHeavyMatch.id,
            matchNumStr: ultraHeavyMatch.matchNumStr,
            home: ultraHeavyMatch.home,
            away: ultraHeavyMatch.away,
            poolCode: "HAD",
            poolName: "胜平负",
            singleAllowed: false,
            optionKey: "h",
            optionLabel: "主胜",
            odds: 1.12,
            fairProb: 0.8,
          },
        ],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [ultraHeavyMatch.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      [ultraHeavyMatch, m2]
    );
    assert.equal(wsUnplayable.effectiveReport.canCheckout, false);
    assert.equal(wsUnplayable.effectiveReport.totalCost, 0);
    assert.equal(
      Boolean(wsUnplayable.effectiveReport.syntheticAutoMounted),
      false
    );
    assert.ok(
      (wsUnplayable.effectiveReport.syntheticEffectiveOdds ?? 1) <= 1.0
    );
    assert.ok(
      wsUnplayable.effectiveReport.warnings.some(
        (w) => w.id === "synthetic-unplayable" && w.detail.includes("过桥")
      )
    );
    assert.ok(wsUnplayable.insights.bridgeCandidates.length >= 1);

    // 4. End-to-end encrypted /api/ledger/mutate seals single-eligible HAFU lines when workspaceParams has planSpec=null & 1 non-single match
    const tmpRuntimeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "yj-rt-syn-ledger-")
    );
    const runtime = createYouJingRuntime({
      dataDir: tmpRuntimeDir,
      getApiKey: () => "test-key",
      enableXiaoGaoProbe: false,
      fetchMatches: async () => ({
        matches: FALLBACK_MATCHES,
        syncNote: "测试快照",
      }),
    });
    try {
      const created = runtime.accountManager.createAccount({
        username: "syn_member",
        note: "Ticket 4 Ledger Test",
        durationHours: 24,
        maxDevices: 2,
        aiEnabled: false,
        dailyAiLimit: 0,
      });
      const headersBase = {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "sec-fetch-mode": "cors",
      };
      const callRoute = async (
        url: string,
        headers: Record<string, string>,
        body: unknown
      ) => {
        const req = new EventEmitter() as any;
        req.method = "POST";
        req.url = url;
        req.headers = Object.fromEntries(
          Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
        );
        req.socket = { remoteAddress: "198.51.100.88" };
        req.destroy = () => {};
        let statusCode = 200;
        let rawBody = "";
        const res = {
          get statusCode() {
            return statusCode;
          },
          set statusCode(v: number) {
            statusCode = v;
          },
          headersSent: false,
          setHeader() {},
          end(chunk = "") {
            res.headersSent = true;
            rawBody += String(chunk);
          },
        };
        queueMicrotask(() => {
          req.emit("data", Buffer.from(JSON.stringify(body), "utf8"));
          req.emit("end");
        });
        await runtime.gateway.handleRequest(req, res, url);
        return { statusCode, body: rawBody };
      };

      const bootRes = await callRoute("/api/security/bootstrap", headersBase, {
        v: 1,
        tz: "Asia/Shanghai",
        hwFp: "b".repeat(64),
      });
      const bootJson = JSON.parse(bootRes.body);
      const { aesKey, hmacKey } = deriveSessionSubkeys(
        Buffer.from(bootJson.k, "base64")
      );
      const postEnc = async (
        endpoint: string,
        payload: unknown,
        nonce: string
      ) => {
        const ts = String(Date.now());
        const env = encryptEnvelope(aesKey, payload);
        const sig = computeEnvelopeHmacHex(
          hmacKey,
          bootJson.sid,
          endpoint,
          ts,
          nonce,
          env.iv,
          env.d
        );
        const r = await callRoute(
          `/api/${endpoint}`,
          {
            ...headersBase,
            "x-yj-sid": bootJson.sid,
            "x-yj-ts": ts,
            "x-yj-nonce": nonce,
            "x-yj-sig": sig,
          },
          env
        );
        assert.equal(r.statusCode, 200);
        const parsed = JSON.parse(r.body);
        return decryptEnvelope(aesKey, parsed.payload.iv, parsed.payload.d);
      };

      await postEnc(
        "auth/login",
        {
          username: "syn_member",
          password: created.plainPassword,
          hwFp: "b".repeat(64),
          deviceLabel: "Mac",
        },
        "a".repeat(32)
      );
      const sealedDraft = ctrl.buildSealedLedgerDraft()!;
      const ledgerRes = await postEnc(
        "ledger/mutate",
        {
          action: "add-entry",
          kind: "live",
          ...sealedDraft,
          workspaceParams: ctrl.buildWorkspaceParams(),
        },
        "b".repeat(32)
      );
      assert.equal(ledgerRes.ok, true);
      assert.equal(ledgerRes.ledger.entries.length, 1);
      assert.equal(ledgerRes.ledger.entries[0].snapshot.lines.length, 3);
      assert.ok(
        ledgerRes.ledger.entries[0].snapshot.lines.every(
          (ln: any) => ln.legs[0].poolCode === "HAFU"
        )
      );
    } finally {
      runtime.dispose();
      fs.rmSync(tmpRuntimeDir, { recursive: true, force: true });
    }

    // 5. Dual-Viewport UI & CSS Source Contracts
    const appSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    const coreCss = fs.readFileSync(
      path.join(REPO_ROOT, "public/skins/core.css"),
      "utf8"
    );
    assert.equal(
      appSrc.includes("mutex-lock") || coreCss.includes("mutex-lock"),
      false,
      "SkinPhoneApp.tsx and core.css must completely remove .mutex-lock visual locking"
    );
    assert.ok(
      appSrc.includes("undoLastPoolSwitch") && appSrc.includes("撤销切换"),
      "SkinPhoneApp.tsx must wire 1-tap 撤销切换 to betCtrl.undoLastPoolSwitch()"
    );
    assert.ok(
      appSrc.includes("setSyntheticSingleMode") &&
        appSrc.includes("3项全包无死角") &&
        appSrc.includes("2项省本搏常规"),
      "SkinPhoneApp.tsx must render 1-tap synthetic-single mode pills (3项全包无死角 / 2项省本搏常规 / 过桥凑2串1)"
    );
  });
});

describe("Slice 13: Two-Axis Code-Review Remediation", () => {
  it("Slice 13.1 (Finding #1): computes exact 139-state blindSpotProb when CRS synthetic single omits straddling 胜其它/平其它/负其它 and emits honest synthetic-blind-spot warning without claiming 无死角", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const oosMatches = parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: rawFixture.matches.slice(0, 12) }],
      },
    }) as MatchItem[];
    const baseM = oosMatches.find((m) => m.pools.HHAD.goalLine === "-1")!;
    assert.ok(baseM, "Expected a -1 goalLine match in OOS fixture");

    const nonSingleMinus1: MatchItem = {
      ...baseM,
      id: "rev-crs-blindspot-m1",
      pools: {
        ...baseM.pools,
        HAD: { ...baseM.pools.HAD, single: false },
        HHAD: { ...baseM.pools.HHAD, goalLine: "-1", single: false },
        CRS: { ...baseM.pools.CRS, single: true },
      },
    };
    const hdOpt = nonSingleMinus1.pools.HHAD.options.find(
      (o) => o.key === "hd"
    )!;
    const hdPick: SelectedPick = {
      matchId: nonSingleMinus1.id,
      matchNumStr: nonSingleMinus1.matchNumStr,
      home: nonSingleMinus1.home,
      away: nonSingleMinus1.away,
      poolCode: "HHAD",
      poolName: nonSingleMinus1.pools.HHAD.name,
      singleAllowed: false,
      optionKey: hdOpt.key,
      optionLabel: hdOpt.label,
      odds: hdOpt.odds,
      fairProb: hdOpt.fairProb,
    };

    // Independent truth: P(HHAD(-1) hd) = P(1:0) + P(2:1) + P(3:2) + P(4:3, 5:4, ... inside 胜其它)
    const p10 = nonSingleMinus1.pools.CRS.options.find(
      (o) => o.label === "1:0"
    )!.fairProb;
    const p21 = nonSingleMinus1.pools.CRS.options.find(
      (o) => o.label === "2:1"
    )!.fairProb;
    const p32 = nonSingleMinus1.pools.CRS.options.find(
      (o) => o.label === "3:2"
    )!.fairProb;
    const expectedHdBlindSpot = hdOpt.fairProb - (p10 + p21 + p32);
    assert.ok(
      expectedHdBlindSpot > 1e-6,
      `Expected non-zero 4:3/5:4 mass inside 胜其它, got ${expectedHdBlindSpot}`
    );

    const wsHd = evaluateQuantWorkspace(
      { picks: [hdPick], multiple: 5, syntheticSingleMode: "full-3way" },
      [nonSingleMinus1]
    );
    assert.equal(wsHd.effectiveReport.canCheckout, true);
    assert.equal(wsHd.effectiveReport.syntheticAutoMounted, true);
    assert.deepEqual(
      wsHd.effectiveReport.tickets?.map((t) => t.legs?.[0]?.optionLabel),
      ["1:0", "2:1", "3:2"]
    );
    assert.ok(
      (wsHd.effectiveReport.syntheticBlindSpotProb ?? 0) > 1e-6 &&
        Math.abs(
          (wsHd.effectiveReport.syntheticBlindSpotProb ?? 0) -
            expectedHdBlindSpot
        ) < 1e-6,
      `Expected exact blindSpotProb ${expectedHdBlindSpot}, got ${wsHd.effectiveReport.syntheticBlindSpotProb}`
    );
    assert.ok(
      wsHd.effectiveReport.syntheticBlindSpotLabel?.includes("胜其它") &&
        wsHd.effectiveReport.syntheticBlindSpotLabel?.includes("4:3"),
      `Expected descriptive blindSpotLabel mentioning 胜其它 & 4:3, got ${wsHd.effectiveReport.syntheticBlindSpotLabel}`
    );
    assert.ok(
      wsHd.effectiveReport.warnings.some(
        (w) => w.id === "synthetic-blind-spot"
      ),
      "CRS synthetic single with blindSpotProb > 1e-9 must emit synthetic-blind-spot warning"
    );
    const allDisplayedCopy = [
      wsHd.manualReport.syntheticHint ?? "",
      wsHd.effectiveReport.syntheticHint ?? "",
      wsHd.effectiveReport.modeLabel ?? "",
      wsHd.appliedPlan?.shortTab ?? "",
      wsHd.appliedPlan?.badge ?? "",
      wsHd.appliedPlan?.title ?? "",
      ...(wsHd.appliedPlan?.reasons ?? []),
    ].join(" | ");
    assert.equal(
      allDisplayedCopy.includes("100% 等价") ||
        allDisplayedCopy.includes("无死角") ||
        allDisplayedCopy.includes("0% 漏网死角"),
      false,
      `Must NEVER claim 100% 等价 / 无死角 / 0% 漏网死角 when blindSpotProb > 1e-9: ${allDisplayedCopy}`
    );

    // Case 2: Real OOS match 2041506 where HHAD(-1) 让胜 (hh) ALSO omits straddling 胜其它 (mounts 9 explicit >=2-margin CRS options)
    const raw2041506 = JSON.parse(
      JSON.stringify(
        rawFixture.matches.find((m: any) => m.matchId === "2041506")
      )
    );
    assert.ok(raw2041506, "Expected real OOS match 2041506");
    raw2041506.had = { ...raw2041506.had, single: "0" };
    raw2041506.hhad = { ...raw2041506.hhad, single: "0" };
    const [oos2041506] = parseSportteryRawJson({
      value: { matchInfoList: [{ subMatchList: [raw2041506] }] },
    }) as MatchItem[];
    const hh2041 = oos2041506.pools.HHAD.options.find((o) => o.key === "hh")!;
    const hd2041 = oos2041506.pools.HHAD.options.find((o) => o.key === "hd")!;
    const pWinOther2041 = oos2041506.pools.CRS.options.find(
      (o) => o.label === "胜其它"
    )!.fairProb;

    const wsHh2041 = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: oos2041506.id,
            matchNumStr: oos2041506.matchNumStr,
            home: oos2041506.home,
            away: oos2041506.away,
            poolCode: "HHAD",
            poolName: oos2041506.pools.HHAD.name,
            singleAllowed: false,
            optionKey: hh2041.key,
            optionLabel: hh2041.label,
            odds: hh2041.odds,
            fairProb: hh2041.fairProb,
          },
        ],
        multiple: 5,
        syntheticSingleMode: "full-3way",
      },
      [oos2041506]
    );
    const wsHd2041 = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: oos2041506.id,
            matchNumStr: oos2041506.matchNumStr,
            home: oos2041506.home,
            away: oos2041506.away,
            poolCode: "HHAD",
            poolName: oos2041506.pools.HHAD.name,
            singleAllowed: false,
            optionKey: hd2041.key,
            optionLabel: hd2041.label,
            odds: hd2041.odds,
            fairProb: hd2041.fairProb,
          },
        ],
        multiple: 5,
        syntheticSingleMode: "full-3way",
      },
      [oos2041506]
    );

    assert.equal(wsHh2041.effectiveReport.syntheticAutoMounted, true);
    const mountedHhLabels =
      wsHh2041.effectiveReport.tickets?.map((t) => t.legs?.[0]?.optionLabel) ??
      [];
    assert.equal(mountedHhLabels.includes("胜其它"), false);
    const coveredHhProb = mountedHhLabels.reduce(
      (sum, lbl) =>
        sum +
        (oos2041506.pools.CRS.options.find((o) => o.label === lbl)?.fairProb ??
          0),
      0
    );
    const expectedHhBlindSpot = hh2041.fairProb - coveredHhProb;
    assert.ok(expectedHhBlindSpot > 1e-6);
    assert.ok(
      Math.abs(
        (wsHh2041.effectiveReport.syntheticBlindSpotProb ?? 0) -
          expectedHhBlindSpot
      ) < 1e-6,
      `Expected 让胜 omitting 胜其它 blindSpotProb=${expectedHhBlindSpot}, got ${wsHh2041.effectiveReport.syntheticBlindSpotProb}`
    );
    // Axiomatic partition law: mass(goalDiff=1 inside 胜其它) + blindSpot(让胜 omitting 胜其它) === P(CRS 胜其它)!
    const explicit1Goal2041 = ["1:0", "2:1", "3:2"].reduce(
      (sum, lbl) =>
        sum +
        (oos2041506.pools.CRS.options.find((o) => o.label === lbl)?.fairProb ??
          0),
      0
    );
    const hdMassInWinOther2041 = hd2041.fairProb - explicit1Goal2041;
    assert.ok(
      Math.abs(
        hdMassInWinOther2041 +
          (wsHh2041.effectiveReport.syntheticBlindSpotProb ?? 0) -
          pWinOther2041
      ) < 1e-6,
      "1-goal mass in 胜其它 + 让胜 blind spot in 胜其它 must sum to exact P(胜其它)"
    );
    // And because hdMassInWinOther2041 > 50% of P(胜其它), wsHd2041 includes 胜其它 with 0% blind spot
    assert.equal(wsHd2041.effectiveReport.syntheticBlindSpotProb, 0);
    assert.ok(
      wsHh2041.effectiveReport.syntheticBlindSpotLabel?.includes("胜其它")
    );
    assert.ok(
      wsHh2041.effectiveReport.warnings.some(
        (w) => w.id === "synthetic-blind-spot"
      )
    );
    assert.equal(
      (wsHh2041.effectiveReport.syntheticHint ?? "").includes("无死角") ||
        (wsHh2041.effectiveReport.syntheticHint ?? "").includes("0% 漏网死角"),
      false
    );
  });

  it("Slice 13.2 (Finding #2): prevents activeSwapTip on a 1-match slip from recommending non-single HAD duplex and keeps planSpec=null in applyEquivalentSwap so auto-synthetic checkout never collapses to ¥0", async () => {
    const m0 = FALLBACK_MATCHES[0] as MatchItem;
    const m2 = FALLBACK_MATCHES[2] as MatchItem;
    const swapTrapMatch: MatchItem = {
      ...m0,
      id: "rev-swap-trap-m1",
      pools: {
        ...m0.pools,
        HAD: {
          ...m0.pools.HAD,
          single: false,
          options: [
            { key: "h", label: "主胜", odds: 1.92, trend: 0, fairProb: 0.46 },
            { key: "d", label: "平", odds: 3.65, trend: 0, fairProb: 0.28 },
            { key: "a", label: "客胜", odds: 4.35, trend: 0, fairProb: 0.26 },
          ],
        },
        HHAD: {
          ...m0.pools.HHAD,
          goalLine: "-1",
          single: false,
          options: [
            { key: "hh", label: "让胜", odds: 3.55, trend: 0, fairProb: 0.23 },
            { key: "hd", label: "让平", odds: 3.45, trend: 0, fairProb: 0.23 },
            { key: "ha", label: "让负", odds: 1.72, trend: 0, fairProb: 0.54 },
          ],
        },
        HAFU: {
          ...m0.pools.HAFU,
          single: true,
        },
      },
    };

    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      [swapTrapMatch, m2],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 10 }, [swapTrapMatch, m2])
    );
    ctrl.setDirectMultiple(20);
    ctrl.togglePick(swapTrapMatch, "HHAD", "ha");
    await ctrl.flush();

    // 1. On 1-match slip (both auto-synthetic mode AND off mode), activeSwapTip MUST NOT recommend non-single HAD[d+a]
    const ws1Auto = ctrl.getState().workspace;
    assert.equal(ws1Auto.effectiveReport.canCheckout, true);
    assert.equal(ws1Auto.effectiveReport.syntheticAutoMounted, true);
    if (ws1Auto.insights.activeSwapTip) {
      assert.ok(
        ws1Auto.insights.activeSwapTip.betterPicks.every(
          (bp) => swapTrapMatch.pools[bp.poolCode]?.single === true
        ),
        `1-match activeSwapTip must never recommend non-single pool: got ${JSON.stringify(ws1Auto.insights.activeSwapTip.betterPicks)}`
      );
    }

    ctrl.setSyntheticSingleMode("off");
    await ctrl.flush();
    const ws1Off = ctrl.getState().workspace;
    if (ws1Off.insights.activeSwapTip) {
      assert.ok(
        ws1Off.insights.activeSwapTip.betterPicks.every(
          (bp) => swapTrapMatch.pools[bp.poolCode]?.single === true
        ),
        `1-match activeSwapTip (off mode) must never recommend non-single pool: got ${JSON.stringify(ws1Off.insights.activeSwapTip.betterPicks)}`
      );
    }
    ctrl.setSyntheticSingleMode("full-3way");
    await ctrl.flush();

    // Verify the same match DOES surface HAD[d+a] swap tip when paired in a 2-match parlay
    ctrl.togglePick(m2, "HAD", "h");
    await ctrl.flush();
    const ws2Parlay = ctrl.getState().workspace;
    assert.ok(
      ws2Parlay.insights.activeSwapTip &&
        ws2Parlay.insights.activeSwapTip.matchId === swapTrapMatch.id &&
        ws2Parlay.insights.activeSwapTip.betterPicks.length === 2,
      "On a 2-match parlay, the genuine HAD[平+客胜] equivalent swap tip remains active"
    );
    const parlayDuplexArb = ws2Parlay.insights.activeSwapTip!;

    // 2. Back on 1-match slip: invoking applyEquivalentSwap with a non-single duplex MUST keep planSpec = null so auto-synthetic stays playable (never collapsing to 应付 ¥0)
    ctrl.removeMatchFromSlip(m2.id);
    await ctrl.flush();
    assert.equal(ctrl.getState().picks.length, 1);
    const swapped = ctrl.applyEquivalentSwap(parlayDuplexArb);
    await ctrl.flush();
    assert.equal(swapped, true);
    assert.equal(
      ctrl.getState().planSpec,
      null,
      "applyEquivalentSwap on 1 non-single match must keep planSpec=null instead of setting { kind: 'bonus' }"
    );
    assert.equal(
      ctrl.getState().workspace.effectiveReport.canCheckout,
      true,
      "Auto-synthetic 6-way HAFU checkout must stay active (never collapsing to 应付 ¥0)"
    );
    assert.ok(ctrl.getState().workspace.effectiveReport.totalCost > 0);
    assert.equal(
      ctrl.getState().workspace.effectiveReport.syntheticAutoMounted,
      true
    );

    // 3. Also verify a genuinely single-open 1-match pick rejects swapping into non-single duplex even if pick.singleAllowed were forged
    const singleHhadMatch: MatchItem = {
      ...swapTrapMatch,
      id: "rev-swap-sgl-hhad",
      pools: {
        ...swapTrapMatch.pools,
        HAD: { ...swapTrapMatch.pools.HAD, single: false },
        HHAD: { ...swapTrapMatch.pools.HHAD, single: true },
      },
    };
    const ctrlSgl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrlSgl.initializeMatches(
      [singleHhadMatch],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 10 }, [singleHhadMatch])
    );
    ctrlSgl.togglePick(singleHhadMatch, "HHAD", "ha");
    await ctrlSgl.flush();
    assert.equal(
      ctrlSgl.getState().workspace.effectiveReport.canCheckout,
      true
    );
    const rejectedBreakSingle = ctrlSgl.applyEquivalentSwap({
      ...parlayDuplexArb,
      matchId: singleHhadMatch.id,
    });
    assert.equal(
      rejectedBreakSingle,
      false,
      "applyEquivalentSwap must refuse breaking 1-match single eligibility"
    );
  });

  it("Slice 13.3 (Finding #3): aligns Grounded Engine 2 APP_GROUND_TRUTH_MANUAL_SPEC and UserManualModal.tsx with ADR-0015 mutex-free switching, 3-way auto-balanced synthetic single, and 0ms parlay restoration", async () => {
    let capturedSysPrompt = "";
    const qaEngine = createManualQaEngine({
      accountManager: {
        consumeAiQuota: () => ({ ok: true, remaining: 9 }),
        recordQaViolation: () => ({
          locked: false,
          strikeCount: 1,
          maxAllowed: 4,
        }),
      },
      xiaogaoService: {
        invokeWithAutoFailover: async (
          _apiKey: string,
          messages: Array<{ role: string; content: string }>
        ) => {
          capturedSysPrompt = messages[0]?.content ?? "";
          return {
            content: JSON.stringify({
              outOfScope: false,
              section: "quickstart",
              answer:
                "只选1场未开单关主胜时，前台保留原主胜高亮，出票层自动挂载胜胜+平胜+负胜3项全包反比例配平合成单关；再选第2场自动恢复低抽水原盘串关。",
            }),
          };
        },
      },
      getApiKey: () => "test-key",
    });

    const res = await qaEngine.answerManualQuestion({
      userId: "u-adr15",
      question:
        "如果我在赛事雷达只选了1场没有开单关的胜平负主胜，又想点同场的让球或再加选第2场凑2串1，系统会怎么处理出票与还原？",
      ip: "127.0.0.1",
    });
    assert.equal(res.ok, true);
    assert.equal(res.source, "grounded-ai");
    assert.ok(capturedSysPrompt.length > 200);

    // Must abolish legacy mutex-block / 0-yuan dead-end claims in Grounded Engine 2 spec
    assert.equal(
      capturedSysPrompt.includes("标「互斥」拦截提示") ||
        capturedSysPrompt.includes("仅选 1 场未开单关时投注额归 0 元"),
      false,
      "APP_GROUND_TRUTH_MANUAL_SPEC must remove legacy 互斥-block and 0-yuan dead-end descriptions"
    );
    assert.ok(
      capturedSysPrompt.includes("撤销切换") &&
        capturedSysPrompt.includes("3项全包无死角") &&
        capturedSysPrompt.includes("2项省本搏常规") &&
        capturedSysPrompt.includes("≤ 1.00") &&
        capturedSysPrompt.includes("恢复低抽水原盘串关"),
      "APP_GROUND_TRUTH_MANUAL_SPEC must describe smooth cross-pool switch + undo, 3-way balanced HAFU modes, <=1.00 honest block, and 0ms parlay restoration"
    );

    const manualModalSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/manual/UserManualModal.tsx"),
      "utf8"
    );
    assert.equal(
      manualModalSrc.includes("勾选默认开单关的半全场 `胜胜 + 平胜`"),
      false,
      "UserManualModal.tsx must replace legacy manual 2-way `胜胜 + 平胜` instruction"
    );
    assert.ok(
      manualModalSrc.includes("胜胜 + 平胜 + 负胜") &&
        manualModalSrc.includes("反比例") &&
        manualModalSrc.includes("2项省本搏常规"),
      "UserManualModal.tsx must document 3-way 胜胜+平胜+负胜 inverse-odds auto-balancing + optional 2-way comeback trade-off"
    );
  });

  it("Slice 13.4 (Finding #4): wires logicalGroupCount / physicalTicketCount into SkinPhoneApp.tsx KPI tile #4 across all 4 slots and allows >= ¥2 floor-to-even custom budgets in normalizeBudgetYuan", async () => {
    // 1. normalizeBudgetYuan accepts ¥2..¥8 and floors odd inputs downward (never overspending)
    assert.equal(normalizeBudgetYuan(NaN), 10);
    assert.equal(normalizeBudgetYuan(0), 10);
    assert.equal(normalizeBudgetYuan(-5), 10);
    assert.equal(normalizeBudgetYuan(1), 2);
    assert.equal(normalizeBudgetYuan(2), 2);
    assert.equal(normalizeBudgetYuan(3), 2);
    assert.equal(normalizeBudgetYuan(4), 4);
    assert.equal(normalizeBudgetYuan(7), 6);
    assert.equal(normalizeBudgetYuan(8), 8);
    assert.equal(normalizeBudgetYuan(9), 8);
    assert.equal(normalizeBudgetYuan(11), 10);
    assert.equal(normalizeBudgetYuan(15), 14);
    assert.equal(normalizeBudgetYuan(20000), 20000);
    assert.equal(normalizeBudgetYuan(25000), 20000);

    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      FALLBACK_MATCHES as MatchItem[],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, FALLBACK_MATCHES)
    );
    assert.equal(ctrl.setBudget(6), 6);
    await ctrl.flush();
    assert.equal(ctrl.getState().budget, 6);
    assert.equal(ctrl.setBudget(11), 10);
    await ctrl.flush();
    assert.equal(ctrl.getState().budget, 10);
    assert.equal(ctrl.setBudget(2), 2);
    await ctrl.flush();
    assert.equal(ctrl.getState().budget, 2);

    // 2. All 4 Pareto slots expose logicalGroupCount & physicalTicketCount (with physicalTicketCount > logicalGroupCount when >99x)
    const plansAt5000 = generateParetoPortfolio(
      (FALLBACK_MATCHES as MatchItem[]).slice(0, 3),
      5000,
      "objective",
      false,
      []
    );
    assert.equal(plansAt5000.length, 4);
    let saw99xSplit = false;
    for (const p of plansAt5000) {
      assert.equal(typeof p.logicalGroupCount, "number");
      assert.equal(typeof p.physicalTicketCount, "number");
      if (p.available) {
        assert.equal(p.logicalGroupCount, p.lines.length);
        const expectedPhys = p.lines.reduce(
          (s: number, l: any) => s + Math.ceil(l.multiple / 99),
          0
        );
        assert.equal(p.physicalTicketCount, expectedPhys);
        if (p.physicalTicketCount > p.logicalGroupCount) {
          saw99xSplit = true;
        }
      }
    }
    assert.equal(
      saw99xSplit,
      true,
      "At ¥5,000 budget, at least one Pareto slot must exhibit >99x split (physicalTicketCount > logicalGroupCount)"
    );

    // 3. SkinPhoneApp.tsx consumes logicalGroupCount & physicalTicketCount in KPI tile #4 (店面逻辑组与实票) and allows min={2} custom budget
    const appSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    assert.ok(
      appSrc.includes("店面逻辑组与实票") &&
        appSrc.includes("currentArch.logicalGroupCount") &&
        appSrc.includes("currentArch.physicalTicketCount") &&
        appSrc.includes("组 · ") &&
        appSrc.includes("张票") &&
        appSrc.includes("组（") &&
        appSrc.includes("张实票）"),
      "SkinPhoneApp.tsx KPI tile #4 must consume currentArch.logicalGroupCount & currentArch.physicalTicketCount and distinguish >99x split vs 1:1 slips"
    );
    assert.equal(
      appSrc.includes("<span>店面合票张数</span>"),
      false,
      "Legacy KPI tile #4 label 店面合票张数 must be replaced by 店面逻辑组与实票"
    );
    assert.ok(
      appSrc.includes("min={2}"),
      "Custom budget input in SkinPhoneApp.tsx must allow min={2}"
    );
  });

  it("Slice 13.5 (Finding #5): floors odd budgetYuan downward in generateParetoPortfolio and prevents cleanBudget = ¥2 overspend in Slot ① (and all 4 slots) across M=1..8", () => {
    const rawFixture = JSON.parse(
      fs.readFileSync(REAL_OOS_FIXTURE_PATH, "utf8")
    );
    const oosMatches = parseSportteryRawJson({
      value: {
        matchInfoList: [{ subMatchList: rawFixture.matches.slice(0, 16) }],
      },
    }) as MatchItem[];

    const makePrimaryAnchor = (m: MatchItem): SelectedPick => {
      const pool = m.pools.HAD.selling !== false ? m.pools.HAD : m.pools.HHAD;
      const pCode: PoolCode = m.pools.HAD.selling !== false ? "HAD" : "HHAD";
      const opt = pool.options[0];
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: pCode,
        poolName: pool.name,
        singleAllowed: pool.single,
        optionKey: opt.key,
        optionLabel: opt.label,
        odds: opt.odds,
        fairProb: opt.fairProb,
      };
    };

    // 1. Sweep b in [2, 3, 4, 5, 7, 11, 15, 99] across M = 1..8 (both unanchored & radar-anchored)
    for (const b of [2, 3, 4, 5, 7, 11, 15, 99]) {
      const expectedClean = Math.max(2, Math.min(20000, Math.floor(b / 2) * 2));
      for (let mCount = 1; mCount <= 8; mCount++) {
        const slate = oosMatches.slice(0, mCount);
        const anchors = slate.map(makePrimaryAnchor);
        for (const anc of [[], anchors]) {
          const plans = generateParetoPortfolio(
            slate,
            b,
            "objective",
            false,
            anc
          );
          assert.equal(plans.length, 4);
          for (const p of plans) {
            assert.ok(
              p.totalCost <= b && p.totalCost <= expectedClean,
              `Overspend at b=${b} (clean=${expectedClean}), M=${mCount}, anchored=${anc.length > 0}, slot=${p.key}: totalCost=${p.totalCost}`
            );
            assert.equal(
              p.totalCost + p.savedCash,
              expectedClean,
              `Budget conservation broken at b=${b} (clean=${expectedClean}), M=${mCount}, slot=${p.key}: totalCost=${p.totalCost} + savedCash=${p.savedCash}`
            );
            if (p.available) {
              assert.ok(p.lines.length >= 1 && p.totalCost >= 2);
              assert.equal(
                p.lines.reduce((s: number, l: any) => s + l.cost, 0),
                p.totalCost
              );
            } else {
              assert.equal(p.totalCost, 0);
              assert.equal(p.savedCash, expectedClean);
              assert.equal(p.lines.length, 0);
            }
          }
        }
      }
    }

    // 2. When M >= 2 at ¥2 has NO feasible main-pool M串1 (e.g. HAD & HHAD suspended), Slot ① marks available: false with savedCash = 2 (NEVER spending ¥4!)
    const noMainParlaySlate: MatchItem[] = oosMatches
      .slice(0, 3)
      .map((m, idx) => ({
        ...m,
        id: `rev-nomain-2yuan-${idx}`,
        pools: {
          ...m.pools,
          HAD: { ...m.pools.HAD, selling: false, single: false },
          HHAD: { ...m.pools.HHAD, selling: false, single: false },
        },
      }));
    const impossibleAt2 = generateParetoPortfolio(
      noMainParlaySlate,
      2,
      "objective",
      false,
      []
    );
    const slot1ImpossibleAt2 = impossibleAt2[0];
    assert.equal(slot1ImpossibleAt2.available, false);
    assert.equal(slot1ImpossibleAt2.totalCost, 0);
    assert.equal(slot1ImpossibleAt2.savedCash, 2);
    assert.ok(
      typeof slot1ImpossibleAt2.emptyReason === "string" &&
        slot1ImpossibleAt2.emptyReason.length > 0
    );

    // 3. Multi-single +EV alpha match at budgetYuan = 2 & 3 also obeys totalCost <= 2 in Slot ④
    const multiAlphaMatch: MatchItem = {
      ...oosMatches[0],
      id: "rev-alpha-2yuan",
      pools: {
        ...oosMatches[0].pools,
        HAFU: {
          ...oosMatches[0].pools.HAFU,
          single: true,
          options: oosMatches[0].pools.HAFU.options.map((o) =>
            o.key === "hh" || o.key === "dh"
              ? { ...o, odds: Number((o.odds * 1.45).toFixed(2)) }
              : o
          ),
        },
      },
    };
    for (const b of [2, 3]) {
      for (const unlock of [false, true]) {
        const alphaPlans = generateParetoPortfolio(
          [multiAlphaMatch],
          b,
          "objective",
          unlock,
          []
        );
        for (const p of alphaPlans) {
          assert.ok(
            p.totalCost <= 2,
            `Slot ${p.key} at b=${b}, unlock=${unlock} overspent: ${p.totalCost}`
          );
          assert.equal(p.totalCost + p.savedCash, 2);
        }
      }
    }
  });

  it("Slice 13.6 (Finding #6): unifies SkinPhoneApp.tsx synthetic playability gate with synthetic-unplayable warning check and deduplicates <SyntheticModePills /> across all 3 placements", () => {
    const appSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );

    // 1. Playability gate checks both syntheticEffectiveOdds > 1.0 AND absence of synthetic-unplayable warning
    assert.ok(
      appSrc.includes('w.id === "synthetic-unplayable"') &&
        appSrc.includes("manualReport.syntheticEffectiveOdds"),
      "SkinPhoneApp.tsx isSyntheticPlayable must check !manualReport.warnings.some((w) => w.id === 'synthetic-unplayable')"
    );

    // 2. Single reusable SyntheticModePills helper rendered across all 3 placements (no 3x copy-paste of button markup)
    const defCount = (appSrc.match(/function SyntheticModePills\b/g) ?? [])
      .length;
    const callCount = (appSrc.match(/<SyntheticModePills\b/g) ?? []).length;
    const trimLabelCount = (appSrc.match(/2项省本搏常规/g) ?? []).length;
    const bridgeLabelCount = (appSrc.match(/搭1场过桥凑2串1/g) ?? []).length;

    assert.equal(
      defCount,
      1,
      "Expected exactly 1 reusable SyntheticModePills component definition in SkinPhoneApp.tsx"
    );
    assert.equal(
      callCount,
      3,
      `Expected <SyntheticModePills /> to be reused at all 3 placements (audit note, desktop bar, mobile bar), got ${callCount}`
    );
    assert.equal(
      trimLabelCount,
      2,
      `Expected '2项省本搏常规' to appear only once in <SyntheticModePills /> + once in toast (no 3x pill copy-paste), got ${trimLabelCount}`
    );
    assert.equal(
      bridgeLabelCount,
      1,
      `Expected '搭1场过桥凑2串1' pill label to live in 1 place instead of 3x copy-paste, got ${bridgeLabelCount}`
    );

    // 3. Behavioral boundary: when continuous synEff = 1.001 > 1.0 yet 999x terminal cap blocks discrete breakeven (0.01 * m1 >= 10 requires m1 >= 1000 > 999), manualReport emits synthetic-unplayable so UI gate suppresses mode pills!
    const m0 = FALLBACK_MATCHES[0] as MatchItem;
    const discTrapMatch: MatchItem = {
      ...m0,
      id: "rev-disc-999-unplayable",
      pools: {
        ...m0.pools,
        HAD: { ...m0.pools.HAD, single: false },
        HAFU: {
          ...m0.pools.HAFU,
          single: true,
          options: m0.pools.HAFU.options.map((o) =>
            o.key === "hh" ? { ...o, odds: 1.005 } : { ...o, odds: 1250 }
          ),
        },
      },
    };
    const wsDiscTrap = evaluateQuantWorkspace(
      {
        picks: [
          {
            matchId: discTrapMatch.id,
            matchNumStr: "周六088",
            home: discTrapMatch.home,
            away: discTrapMatch.away,
            poolCode: "HAD",
            poolName: "胜平负",
            singleAllowed: false,
            optionKey: "h",
            optionLabel: "主胜",
            odds: 1.01,
            fairProb: 0.9,
          },
          {
            matchId: discTrapMatch.id,
            matchNumStr: "周六088",
            home: discTrapMatch.home,
            away: discTrapMatch.away,
            poolCode: "HAD",
            poolName: "胜平负",
            singleAllowed: false,
            optionKey: "d",
            optionLabel: "平",
            odds: 18.0,
            fairProb: 0.08,
          },
        ],
        multiple: 5,
      },
      [discTrapMatch]
    );
    assert.ok((wsDiscTrap.manualReport.syntheticEffectiveOdds ?? 0) > 1.0);
    assert.equal(wsDiscTrap.effectiveReport.canCheckout, false);
    assert.equal(
      wsDiscTrap.manualReport.warnings.some(
        (w) => w.id === "synthetic-unplayable"
      ),
      true,
      "999x discrete unplayable boundary with synEff > 1.0 must emit synthetic-unplayable warning"
    );
  });
});
