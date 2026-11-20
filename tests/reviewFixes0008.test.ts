import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  FALLBACK_MATCHES,
  analyzeMatchMicroQuant,
  archetypeToReport,
  evaluateQuantWorkspace,
  generateParetoPortfolio,
} from "../server/quantEngine.mjs";
import { runLayer4LedgerAblationBenchmark } from "../scripts/bench-quant.mjs";
import type {
  ArchetypePlan,
  MatchItem,
  SelectedPick,
} from "../src/prototype/quantTypes.ts";

function makeLegFromMatch(
  m: MatchItem,
  poolCode: "HAD" | "HHAD" | "HAFU" | "TTG" | "CRS",
  optionKey: string
) {
  const pool = m.pools[poolCode];
  const opt = pool.options.find(
    (o) => o.key === optionKey || o.label === optionKey
  )!;
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
    fairProb: opt.fairProb,
  };
}

describe("Spec 0008 · Post-Review Security, Bounds & Fidelity Fixes", () => {
  it("Group A · Security, DoS Bounds & Cleanliness: rejects >64 lines, duplicate matchIds in a line, >8 parlay / >15 single distinct matches, blocks forged client odds on known matches, and deduplicates helpers & JSDoc", () => {
    const m0 = FALLBACK_MATCHES[0] as MatchItem;
    const m1 = FALLBACK_MATCHES[1] as MatchItem;

    const buildSnap = (lines: ArchetypePlan["lines"]): ArchetypePlan => ({
      key: "max-ev-utility",
      available: true,
      shortTab: "⚖️ 期望效用",
      badge: "⚖️ 期望效用极值",
      title: "边界安全测试",
      tagline: "边界安全测试",
      totalCost: lines.reduce((a, l) => a + l.cost, 0),
      savedCash: 0,
      minReturn: 10,
      maxReturn: 100,
      winProb: 0.3,
      profitProb: 0.3,
      missOneReturn: null,
      vigPct: 12,
      reasons: [],
      lines,
    });

    // 1. Rejects snapshotPlan with > 64 lines (65 lines)
    const over64Snap = buildSnap(
      Array.from({ length: 65 }, (_, idx) => ({
        id: `ln-${idx}`,
        roleLabel: `票#${idx}`,
        legs: [makeLegFromMatch(m1, "HAD", "h")],
        modeLabel: "单关",
        multiple: 1,
        cost: 2,
        unitPayout: 2.72,
        returnPayout: 2.72,
        netProfit: 0,
        prob: 0.6,
      }))
    );
    assert.equal(archetypeToReport(over64Snap, null, FALLBACK_MATCHES), null);

    // 2. Rejects duplicate matchId within a single parlay line (same match twice in 2串1)
    const dupMatchInLineSnap = buildSnap([
      {
        id: "dup-1",
        roleLabel: "同场自串伪造",
        legs: [
          makeLegFromMatch(m0, "HAD", "h"),
          makeLegFromMatch(m0, "HHAD", "hh"),
        ],
        modeLabel: "2串1",
        multiple: 5,
        cost: 10,
        unitPayout: 12.68,
        returnPayout: 63.4,
        netProfit: 53.4,
        prob: 0.25,
      },
    ]);
    assert.equal(
      archetypeToReport(dupMatchInLineSnap, null, FALLBACK_MATCHES),
      null
    );

    // 3. Rejects empty-string matchId leg
    const emptyMidSnap = buildSnap([
      {
        id: "emp-1",
        roleLabel: "空赛事ID",
        legs: [{ ...makeLegFromMatch(m1, "HAD", "h"), matchId: "   " }],
        modeLabel: "单关",
        multiple: 5,
        cost: 10,
        unitPayout: 2.72,
        returnPayout: 13.6,
        netProfit: 3.6,
        prob: 0.6,
      },
    ]);
    assert.equal(archetypeToReport(emptyMidSnap, null, FALLBACK_MATCHES), null);

    // 4. Rejects > 8 distinct matches when ANY line has legs.length >= 2 (parlay DoS / statutory 8-match bypass)
    const nineMatchParlaySnap = buildSnap(
      Array.from({ length: 9 }, (_, idx) => ({
        id: `p9-${idx}`,
        roleLabel: `超8场串#${idx}`,
        legs: [
          { ...makeLegFromMatch(m0, "HAD", "h"), matchId: `dos-m-${idx}` },
          {
            ...makeLegFromMatch(m1, "HAD", "h"),
            matchId: `dos-m-${(idx + 1) % 9}`,
          },
        ],
        modeLabel: "2串1",
        multiple: 1,
        cost: 2,
        unitPayout: 4.6,
        returnPayout: 4.6,
        netProfit: 0,
        prob: 0.3,
      }))
    );
    const t0 = performance.now();
    const wsParlayDos = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "alpha-radar",
          snapshotPlan: nineMatchParlaySnap,
        },
        targetIds: [(FALLBACK_MATCHES[2] as MatchItem).id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.ok(
      performance.now() - t0 < 25,
      "Rejected 9-match parlay snapshotPlan must return immediately"
    );
    assert.equal(
      wsParlayDos.appliedPlan,
      null,
      "Must reject >8 distinct matches when any parlay line exists"
    );

    // 5. Allows 15 distinct single-leg matches, but rejects 16 distinct single-leg matches
    const makeSingleSnapOfCount = (count: number) =>
      buildSnap(
        Array.from({ length: count }, (_, idx) => ({
          id: `sgl-${idx}`,
          roleLabel: `单关#${idx}`,
          legs: [
            { ...makeLegFromMatch(m1, "HAD", "h"), matchId: `sgl-m-${idx}` },
          ],
          modeLabel: "单关",
          multiple: 1,
          cost: 2,
          unitPayout: 3.5,
          returnPayout: 3.5,
          netProfit: 0,
          prob: 0.5,
        }))
      );
    assert.notEqual(
      archetypeToReport(makeSingleSnapOfCount(15), null, FALLBACK_MATCHES),
      null
    );
    assert.equal(
      archetypeToReport(makeSingleSnapOfCount(16), null, FALLBACK_MATCHES),
      null
    );

    // 6. applySandboxToPlan blocks forged client odds on a server-known match when optionKey/poolCode is unknown!
    const forgedKnownMatchSnap = buildSnap([
      {
        id: "forged-1",
        roleLabel: "伪造高赔",
        legs: [
          {
            ...makeLegFromMatch(m1, "HAD", "h"),
            optionKey: "forged_nonexistent_opt",
            optionLabel: "伪造项",
            odds: 9999,
          },
        ],
        modeLabel: "单关",
        multiple: 5,
        cost: 10,
        unitPayout: 19998,
        returnPayout: 99990,
        netProfit: 99980,
        prob: 0.5,
      },
    ]);
    const wsForged = evaluateQuantWorkspace(
      {
        picks: [],
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: {
          kind: "archetype",
          key: "max-ev-utility",
          snapshotPlan: forgedKnownMatchSnap,
        },
        targetIds: [m1.id],
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    assert.equal(
      wsForged.appliedPlan!.lines[0].legs[0].odds,
      0,
      "Forged optionKey on server-known match must resolve to baseOdds = 0, NEVER client 9999"
    );
    assert.equal(wsForged.appliedPlan!.lines[0].returnPayout, 0);
    assert.equal(wsForged.effectiveReport.maxPayout, 0);
    assert.equal(wsForged.effectiveReport.canCheckout, false);

    // 7. Code cleanliness & Glossary polish checks
    const engineSrc = fs.readFileSync(
      path.resolve(process.cwd(), "server/quantEngine.mjs"),
      "utf8"
    );
    assert.equal(
      engineSrc.includes("五流派"),
      false,
      "server/quantEngine.mjs must update lingering 五流派配单 JSDoc to 精算配单"
    );
    const x1LoopMatches = engineSrc.match(/for\s*\(\s*let\s+x1\s*=\s*0/g) ?? [];
    assert.equal(
      x1LoopMatches.length,
      1,
      `Expected exactly 1 shared Binomial half-time thinning x1/y1 loop in quantEngine.mjs, found ${x1LoopMatches.length}`
    );

    const appSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/mobile/SkinPhoneApp.tsx"),
      "utf8"
    );
    const slipChunkLoops =
      appSrc.match(/Math\.ceil\(totalMult\s*\/\s*99\)/g) ?? [];
    assert.equal(
      slipChunkLoops.length,
      1,
      `Expected exactly 1 shared <=99 terminal slip-splitting helper in SkinPhoneApp.tsx, found ${slipChunkLoops.length}`
    );
  });

  it("Group B.1 & B.6 · Unified Pure +EV Alpha Scanner, Passive Equivalent-Swap Retention & Layer 4 Pure Guardrail Alignment", () => {
    // 1. Lagged +EV match: alphaScanSummary and Slot ④ alpha-radar report the EXACT SAME +EV percentage!
    const m0Base = FALLBACK_MATCHES[0] as MatchItem;
    const mPosEv: MatchItem = {
      ...m0Base,
      id: "b1-pos-ev-lag",
      pools: {
        ...m0Base.pools,
        TTG: {
          ...m0Base.pools.TTG,
          options: m0Base.pools.TTG.options.map((o) =>
            o.key === "s2" ? { ...o, odds: 3.95 } : o
          ),
        },
      },
    };
    const mqPosEv = analyzeMatchMicroQuant(mPosEv);
    const slot4PosEv = generateParetoPortfolio(
      [mPosEv],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(slot4PosEv.available, true);
    assert.equal(slot4PosEv.alphaKind, "positive-ev");
    const summaryPctMatch = mqPosEv.alphaScanSummary.match(/\+(\d+\.\d)%/);
    const titlePctMatch = slot4PosEv.title.match(/\+(\d+\.\d)%/);
    assert.ok(
      summaryPctMatch && titlePctMatch,
      "Both alphaScanSummary and Slot ④ title must display +X.X%"
    );
    assert.equal(
      summaryPctMatch[1],
      titlePctMatch[1],
      `alphaScanSummary (${mqPosEv.alphaScanSummary}) and Slot ④ (${slot4PosEv.title}) must use 1:1 unified shrinkage scanner`
    );

    // 2. FALLBACK_MATCHES[1] (日本 vs 巴拉圭) has HHAD(-1) ha @2.72 vs HAD[d+a] @2.53 (+7.4% >= 3.0% arb) with negative EV:
    // preserves passive同义省钱平替 in microQuant.arbitrages & alphaScanSummary while Slot ④ stays honestly empty (Spec 0009 D-04)!
    const m1 = FALLBACK_MATCHES[1] as MatchItem;
    assert.ok(m1.microQuant.arbitrages.some((a) => a.edgePct >= 3.0));
    assert.ok(
      m1.microQuant.alphaScanSummary.includes("同义省钱平替"),
      `Expected FALLBACK_MATCHES[1] alphaScanSummary to note passive swap without +EV inducement, got: ${m1.microQuant.alphaScanSummary}`
    );
    const slot4M1 = generateParetoPortfolio(
      [m1],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(
      slot4M1.available,
      false,
      "Negative-EV equivalent arb must NOT induce active betting in Slot ④"
    );

    // 3. FALLBACK_MATCHES[2] (波兰 vs 瑞典) has only 1.5% < 3.0% arb and no sub-pool alpha -> stays honest ¥0 empty state!
    const m2 = FALLBACK_MATCHES[2] as MatchItem;
    assert.ok(m2.microQuant.arbitrages.every((a) => a.edgePct < 3.0));
    assert.ok(m2.microQuant.alphaScanSummary.includes("无跨盘错价洼地"));
    const slot4M2 = generateParetoPortfolio(
      [m2],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(slot4M2.available, false);
    assert.equal(slot4M2.totalCost, 0);

    // 4. Reverse direction: HAD 2-way harmonic synthetic [d+a] (@1.42) beats HHAD(-1) ha (@1.34) -> recorded in microQuant.arbitrages while Slot ④ stays empty unless +EV!
    const hadPairBetterMatch: MatchItem = {
      ...m2,
      id: "b1-had-pair-arb",
      matchNumStr: "周六301",
      pools: {
        ...m2.pools,
        HAD: {
          ...m2.pools.HAD,
          single: true,
          selling: true,
        },
        HHAD: {
          ...m2.pools.HHAD,
          single: true,
          selling: true,
          goalLine: "-1",
          options: [
            {
              key: "hh",
              label: "让胜",
              odds: 6.4,
              trend: 0,
              fairProb: 0.14,
              shinProb: 0.14,
            },
            {
              key: "hd",
              label: "让平",
              odds: 4.35,
              trend: 0,
              fairProb: 0.2,
              shinProb: 0.2,
            },
            {
              key: "ha",
              label: "让负",
              odds: 1.34,
              trend: 0,
              fairProb: 0.66,
              shinProb: 0.66,
            },
          ],
        },
      },
    };
    const mqHadPair = analyzeMatchMicroQuant(hadPairBetterMatch);
    assert.ok(mqHadPair.arbitrages.some((a) => a.edgePct >= 3.0));
    const slot4HadPair = generateParetoPortfolio(
      [hadPairBetterMatch],
      100,
      "objective",
      false,
      []
    )[3] as ArchetypePlan;
    assert.equal(
      slot4HadPair.available,
      false,
      "Negative-EV HAD[d+a] swap must stay passive and not activate Slot ④"
    );

    // Direction anchor guard: if user anchored opposing HAD a on mPosEv while s2 overlaps home/draw/away, check opposing HAFU hh lag blocked by away anchor!
    const mHafuHomeLag: MatchItem = {
      ...m0Base,
      id: "b1-hafu-home-lag",
      pools: {
        ...m0Base.pools,
        HAFU: {
          ...m0Base.pools.HAFU,
          options: m0Base.pools.HAFU.options.map((o) =>
            o.key === "hh" ? { ...o, odds: 4.8 } : o
          ),
        },
      },
    };
    const awayOpt = mHafuHomeLag.pools.HAD.options.find((o) => o.key === "a")!;
    const awayPick: SelectedPick = {
      matchId: mHafuHomeLag.id,
      matchNumStr: mHafuHomeLag.matchNumStr,
      home: mHafuHomeLag.home,
      away: mHafuHomeLag.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: true,
      optionKey: "a",
      optionLabel: "客胜",
      odds: awayOpt.odds,
      fairProb: awayOpt.fairProb,
    };
    assert.equal(
      generateParetoPortfolio([mHafuHomeLag], 100, "objective", false, [])[3]
        .available,
      true
    );
    const slot4AnchoredAway = generateParetoPortfolio(
      [mHafuHomeLag],
      100,
      "objective",
      false,
      [awayPick]
    )[3] as ArchetypePlan;
    assert.equal(
      slot4AnchoredAway.available,
      false,
      "Must not bet HAFU hh when user anchored opposing HAD a"
    );

    // 5. Layer 4 bench-quant.mjs alignment: zero pre-routing by dangerScore/relative-alpha (paperCount === stopLossInterceptedCount)
    const benchSrc = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/bench-quant.mjs"),
      "utf8"
    );
    assert.equal(
      benchSrc.includes("routeHighDangerToPaper"),
      false,
      "scripts/bench-quant.mjs must not pre-route relative-alpha or dangerScore >= 58 to paper before STOP_LOSS_EXCEEDED"
    );
    const l4 = runLayer4LedgerAblationBenchmark({
      dailyStopLossYuan: 300,
      initialBankrollYuan: 5000,
    });
    assert.equal(
      l4.upgraded.paperCount,
      l4.upgraded.stopLossInterceptedCount,
      "Every paper entry in Layer 4 must come strictly from STOP_LOSS_EXCEEDED guardrail interception"
    );
    assert.ok(l4.upgraded.liveRoiPct > l4.legacy.liveRoiPct);
    assert.ok(l4.upgraded.maxDrawdownYuan < l4.legacy.maxDrawdownYuan);
    assert.ok(l4.upgraded.sharpeRatio > l4.legacy.sharpeRatio);
    assert.ok(l4.upgraded.paperSavedAmount > 0);
  });

  it("Group B.2 · Slot ③ max-cvar-wheel Official M串N (<=10 tickets, including 5串10) & Honest Naming vs Genuine C(v,k,t) Wheels", () => {
    // 1. M = 3 and M = 4 only have full official M串N structures (3串3/3串4, 4串4/4串5/4串6) -> NEVER mislabeled as 旋转矩阵缩水!
    const slot3M3 = generateParetoPortfolio(
      FALLBACK_MATCHES.slice(0, 3),
      200,
      "objective",
      false,
      []
    )[2] as ArchetypePlan;
    assert.ok(
      /3串[34]/.test(slot3M3.title),
      `Expected M=3 title to name 3串3 or 3串4, got: ${slot3M3.title}`
    );
    assert.equal(
      slot3M3.title.includes("旋转矩阵缩水"),
      false,
      `Full official 3串N must not be mislabeled 旋转矩阵缩水: ${slot3M3.title}`
    );
    assert.equal(slot3M3.reasons[0].includes("旋转矩阵缩水"), false);

    const slot3M4 = generateParetoPortfolio(
      FALLBACK_MATCHES.slice(0, 4),
      100,
      "objective",
      false,
      []
    )[2] as ArchetypePlan;
    assert.ok(
      /4串[456]/.test(slot3M4.title),
      `Expected M=4 title to name 4串4/4串5/4串6, got: ${slot3M4.title}`
    );
    assert.equal(
      slot3M4.title.includes("旋转矩阵缩水"),
      false,
      `Full official 4串N must not be mislabeled 旋转矩阵缩水: ${slot3M4.title}`
    );

    // 2. M = 5 includes official 5串10 (all 10 2串1 pairs) and selects + labels it honestly without mislabeling as 旋转矩阵缩水!
    const five5x10Odds = [1.28, 1.3, 1.32, 1.35, 1.85];
    const fiveFavMatches: MatchItem[] = FALLBACK_MATCHES.slice(0, 5).map(
      (fm, idx) => {
        const o = five5x10Odds[idx];
        const p = 0.89 / o;
        const rem = 1 - p;
        return {
          ...(fm as MatchItem),
          id: `b2-5x10-${idx}`,
          matchNumStr: `周六50${idx + 1}`,
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
                  odds: o,
                  trend: 0,
                  fairProb: p,
                  shinProb: p,
                },
                {
                  key: "d",
                  label: "平",
                  odds: Number((0.89 / (rem * 0.55)).toFixed(2)),
                  trend: 0,
                  fairProb: rem * 0.55,
                  shinProb: rem * 0.55,
                },
                {
                  key: "a",
                  label: "客胜",
                  odds: Number((0.89 / (rem * 0.45)).toFixed(2)),
                  trend: 0,
                  fairProb: rem * 0.45,
                  shinProb: rem * 0.45,
                },
              ],
            },
          },
        };
      }
    );
    const fiveFavAnchors: SelectedPick[] = fiveFavMatches.map((m, idx) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: false,
      optionKey: "h",
      optionLabel: "主胜",
      odds: five5x10Odds[idx],
      fairProb: 0.89 / five5x10Odds[idx],
    }));
    const slot3M5 = generateParetoPortfolio(
      fiveFavMatches,
      100,
      "objective",
      false,
      fiveFavAnchors
    )[2] as ArchetypePlan;
    assert.equal(
      slot3M5.lines.length,
      10,
      `Expected official 5串10 (10 2串1 tickets), got ${slot3M5.lines.length} (${slot3M5.title})`
    );
    assert.ok(slot3M5.lines.every((l) => l.legs.length === 2));
    assert.ok(
      slot3M5.title.includes("5串10"),
      `Expected 5串10 in title, got: ${slot3M5.title}`
    );
    assert.equal(slot3M5.title.includes("旋转矩阵缩水"), false);
    assert.equal(slot3M5.reasons[0].includes("旋转矩阵缩水"), false);

    // 2b. Genuine C(5,2,3) covering wheel (4 blocks < C(5,2)=10) is labeled C(5,2,3) 旋转矩阵缩水!
    const uniformWheelMatches: MatchItem[] = fiveFavMatches.map((m, idx) => ({
      ...m,
      id: `b2-c523-${idx}`,
      pools: {
        ...m.pools,
        HAD: {
          ...m.pools.HAD,
          options: [
            {
              key: "h",
              label: "主胜",
              odds: 1.32,
              trend: 0,
              fairProb: 0.674,
              shinProb: 0.674,
            },
            {
              key: "d",
              label: "平",
              odds: 4.95,
              trend: 0,
              fairProb: 0.18,
              shinProb: 0.18,
            },
            {
              key: "a",
              label: "客胜",
              odds: 6.1,
              trend: 0,
              fairProb: 0.146,
              shinProb: 0.146,
            },
          ],
        },
      },
    }));
    const uniformWheelAnchors: SelectedPick[] = uniformWheelMatches.map(
      (m) => ({
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 1.32,
        fairProb: 0.674,
      })
    );
    const slot3Wheel = generateParetoPortfolio(
      uniformWheelMatches,
      100,
      "objective",
      false,
      uniformWheelAnchors
    )[2] as ArchetypePlan;
    assert.ok(
      slot3Wheel.title.includes("C(5,3,2)") ||
        slot3Wheel.title.includes("5场2串1图兰分块") ||
        slot3Wheel.title.includes("5串10"),
      `Expected valid reduced wheel or official 5串10 (zero invalid C(5,2,3)), got: ${slot3Wheel.title}`
    );
    assert.equal(slot3Wheel.title.includes("C(5,2,3)"), false);

    // 3. Across M = 5..8, reduced wheels say 旋转矩阵缩水 (and any C(v,k,t) satisfies v >= k >= t), while full M串N say M串N!
    for (const v of [5, 6, 7, 8]) {
      const s3 = generateParetoPortfolio(
        FALLBACK_MATCHES.slice(0, v),
        200,
        "objective",
        false,
        []
      )[2] as ArchetypePlan;
      assert.ok(s3.lines.length <= 10);
      const cMatch = /C\((\d+),(\d+),(\d+)\)/.exec(s3.title);
      if (cMatch) {
        assert.ok(
          Number(cMatch[1]) >= Number(cMatch[2]) &&
            Number(cMatch[2]) >= Number(cMatch[3])
        );
      }
      const isWheelTitle = s3.title.includes("旋转矩阵缩水");
      const isOfficialTitle =
        new RegExp(`${v}串\\d+`).test(s3.title) &&
        !s3.title.includes("旋转矩阵缩水");
      assert.equal(
        isWheelTitle || isOfficialTitle,
        true,
        `v=${v} Slot ③ title must be either reduced 旋转矩阵缩水 or honest ${v}串N, got: ${s3.title}`
      );
    }
  });

  it("Group B.3 & B.4 · Dual-Single (HAD+HHAD) subjectiveDeltaPct Slider & 9~15 Single-Pass Exact Cent DP + Combos Invariants", () => {
    // --- Group B.3: Dual-Single HAD + HHAD on FALLBACK_MATCHES[1] (日本 vs 巴拉圭, both HAD & HHAD single=true) ---
    const mDual = FALLBACK_MATCHES[1] as MatchItem;
    const hadH = mDual.pools.HAD.options.find((o) => o.key === "h")!;
    const hhadHH = mDual.pools.HHAD.options.find((o) => o.key === "hh")!;
    const dualSinglePicks: SelectedPick[] = [
      {
        matchId: mDual.id,
        matchNumStr: mDual.matchNumStr,
        home: mDual.home,
        away: mDual.away,
        poolCode: "HAD",
        poolName: mDual.pools.HAD.name,
        singleAllowed: true,
        optionKey: "h",
        optionLabel: hadH.label,
        odds: hadH.odds,
        fairProb: hadH.fairProb,
      },
      {
        matchId: mDual.id,
        matchNumStr: mDual.matchNumStr,
        home: mDual.home,
        away: mDual.away,
        poolCode: "HHAD",
        poolName: mDual.pools.HHAD.name,
        singleAllowed: true,
        optionKey: "hh",
        optionLabel: hhadHH.label,
        odds: hhadHH.odds,
        fairProb: hhadHH.fairProb,
      },
    ];

    const wsMinus = evaluateQuantWorkspace(
      { picks: dualSinglePicks, multiple: 5, subjectiveDeltaPct: -15 },
      FALLBACK_MATCHES
    );
    const wsZero = evaluateQuantWorkspace(
      { picks: dualSinglePicks, multiple: 5, subjectiveDeltaPct: 0 },
      FALLBACK_MATCHES
    );
    const wsPlus = evaluateQuantWorkspace(
      { picks: dualSinglePicks, multiple: 5, subjectiveDeltaPct: 20 },
      FALLBACK_MATCHES
    );

    assert.ok(
      wsMinus.manualReport.anyWinProb < wsZero.manualReport.anyWinProb - 1e-4 &&
        wsZero.manualReport.anyWinProb < wsPlus.manualReport.anyWinProb - 1e-4,
      `Dual-single anyWinProb must respond strictly to subjectiveDeltaPct (-15 -> 0 -> +20): ${wsMinus.manualReport.anyWinProb}, ${wsZero.manualReport.anyWinProb}, ${wsPlus.manualReport.anyWinProb}`
    );
    assert.ok(
      wsMinus.manualReport.realProfitProb <
        wsZero.manualReport.realProfitProb - 1e-4 &&
        wsZero.manualReport.realProfitProb <
          wsPlus.manualReport.realProfitProb - 1e-4,
      `Dual-single realProfitProb must respond strictly to subjectiveDeltaPct (-15 -> 0 -> +20): ${wsMinus.manualReport.realProfitProb}, ${wsZero.manualReport.realProfitProb}, ${wsPlus.manualReport.realProfitProb}`
    );
    assert.ok(
      wsMinus.manualReport.expectedValueRate <
        wsZero.manualReport.expectedValueRate - 1e-4 &&
        wsZero.manualReport.expectedValueRate <
          wsPlus.manualReport.expectedValueRate - 1e-4,
      "Dual-single expectedValueRate must respond strictly to subjectiveDeltaPct"
    );
    assert.ok(
      wsMinus.subjectiveEVPct < wsZero.subjectiveEVPct - 1e-2 &&
        wsZero.subjectiveEVPct < wsPlus.subjectiveEVPct - 1e-2,
      "Dual-single subjectiveEVPct must respond strictly to subjectiveDeltaPct"
    );

    // --- Group B.4 (Part 1): [totalCost - 0.05, totalCost) exact cent boundary on 10 single-pass matches ---
    // 10 single-pass matches at 1x -> totalCost = ¥20.00.
    // Match 0 has odds = 9.98 (payout ¥19.96, 4 cents underwater); Matches 1..9 have odds = 9.99 (payout ¥19.98, 2 cents underwater).
    // Hitting ONLY 1 match MUST be strictly underwater; profitable iff >= 2 matches hit!
    const boundaryMatches: MatchItem[] = Array.from(
      { length: 10 },
      (_, idx) => {
        const base = FALLBACK_MATCHES[
          idx % FALLBACK_MATCHES.length
        ] as MatchItem;
        const targetOdds = idx === 0 ? 9.98 : 9.99;
        return {
          ...base,
          id: `b4-cent-${idx}`,
          matchNumStr: `周日6${String(idx + 1).padStart(2, "0")}`,
          pools: {
            ...base.pools,
            HAD: { ...base.pools.HAD, selling: false },
            HHAD: { ...base.pools.HHAD, selling: false },
            HAFU: { ...base.pools.HAFU, selling: false },
            CRS: { ...base.pools.CRS, selling: false },
            TTG: {
              ...base.pools.TTG,
              selling: true,
              single: true,
              payoutRatio: 0.85,
              vig: 0.15,
              options: [
                {
                  key: "s0",
                  label: "0球",
                  odds: targetOdds,
                  trend: 0,
                  fairProb: 0.085,
                  shinProb: 0.085,
                },
                {
                  key: "s1",
                  label: "1球",
                  odds: 3.8,
                  trend: 0,
                  fairProb: 0.22,
                  shinProb: 0.22,
                },
                {
                  key: "s2",
                  label: "2球",
                  odds: 3.2,
                  trend: 0,
                  fairProb: 0.265,
                  shinProb: 0.265,
                },
                {
                  key: "s3",
                  label: "3球",
                  odds: 3.9,
                  trend: 0,
                  fairProb: 0.215,
                  shinProb: 0.215,
                },
                {
                  key: "s4",
                  label: "4球",
                  odds: 6.5,
                  trend: 0,
                  fairProb: 0.13,
                  shinProb: 0.13,
                },
                {
                  key: "s5",
                  label: "5球",
                  odds: 15.0,
                  trend: 0,
                  fairProb: 0.05,
                  shinProb: 0.05,
                },
                {
                  key: "s6",
                  label: "6球",
                  odds: 32.0,
                  trend: 0,
                  fairProb: 0.023,
                  shinProb: 0.023,
                },
                {
                  key: "s7",
                  label: "7+球",
                  odds: 65.0,
                  trend: 0,
                  fairProb: 0.012,
                  shinProb: 0.012,
                },
              ],
            },
          },
        };
      }
    );
    const boundaryPicks: SelectedPick[] = boundaryMatches.map((m, idx) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "TTG",
      poolName: "总进球",
      singleAllowed: true,
      optionKey: "s0",
      optionLabel: "0球",
      odds: idx === 0 ? 9.98 : 9.99,
      fairProb: 0.085,
    }));

    const wsBoundary = evaluateQuantWorkspace(
      { picks: boundaryPicks, multiple: 1 },
      boundaryMatches
    );
    const repB = wsBoundary.manualReport;
    assert.equal(repB.totalCost, 20);
    assert.equal(repB.minPayout, 19.96);

    // Exact analytical P(>= 2 hits) from ticket fairProbs
    const ps = repB.tickets.map((t) => t.prob);
    const pZero = ps.reduce((acc, p) => acc * (1 - p), 1);
    const pExactOne = ps.reduce(
      (sum, p, i) =>
        sum +
        p * ps.reduce((acc, pj, j) => (i === j ? acc : acc * (1 - pj)), 1),
      0
    );
    const exactTwoOrMore = 1 - pZero - pExactOne;
    assert.ok(
      Math.abs(repB.anyWinProb - (1 - pZero)) < 1e-9,
      `Expected anyWinProb=${1 - pZero}, got ${repB.anyWinProb}`
    );
    assert.ok(
      Math.abs(repB.realProfitProb - exactTwoOrMore) < 1e-9,
      `[19.96, 20.00) MUST NOT round up into realProfitProb! Expected ${exactTwoOrMore}, got ${repB.realProfitProb}`
    );

    // --- Group B.4 (Part 2): 9, 12, 15 single-pass matches combos invariants & subjectiveEVPct ---
    for (const count of [9, 12, 15]) {
      const mList: MatchItem[] = Array.from({ length: count }, (_, idx) => {
        const base = FALLBACK_MATCHES[
          idx % FALLBACK_MATCHES.length
        ] as MatchItem;
        return {
          ...base,
          id: `b4-inv-${count}-${idx}`,
          matchNumStr: `周一7${String(idx + 1).padStart(2, "0")}`,
        };
      });
      const pList: SelectedPick[] = mList.map((m, idx) => {
        const opt = m.pools.TTG.options[idx % 4];
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "TTG",
          poolName: m.pools.TTG.name,
          singleAllowed: true,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        };
      });
      const wsN = evaluateQuantWorkspace(
        { picks: pList, multiple: 3, subjectiveDeltaPct: 5 },
        mList
      );
      const repN = wsN.effectiveReport;
      const sumProb = repN.combos.reduce((a, c) => a + c.prob, 0);
      const sumProfProb = repN.combos
        .filter((c) => !c.isUnderwater)
        .reduce((a, c) => a + c.prob, 0);
      const sumExpRet = repN.combos.reduce(
        (a, c) => a + c.prob * c.totalPayout,
        0
      );
      const expectedRetFromEvRate =
        repN.totalCost * (1 + repN.expectedValueRate);

      assert.ok(
        Math.abs(sumProb - repN.anyWinProb) < 1e-9,
        `M=${count}: sum(combos.prob)=${sumProb} must equal anyWinProb=${repN.anyWinProb}`
      );
      assert.ok(
        Math.abs(sumProfProb - repN.realProfitProb) < 1e-9,
        `M=${count}: sum(non-underwater combos.prob)=${sumProfProb} must equal realProfitProb=${repN.realProfitProb}`
      );
      assert.ok(
        Math.abs(sumExpRet - expectedRetFromEvRate) < 1e-6,
        `M=${count}: sum(combos.prob * totalPayout)=${sumExpRet} must equal expectedReturn=${expectedRetFromEvRate}`
      );
      assert.ok(
        Math.abs(wsN.subjectiveEVPct - repN.expectedValueRate * 100) < 1e-9,
        `M=${count}: subjectiveEVPct=${wsN.subjectiveEVPct} must equal expectedValueRate*100=${repN.expectedValueRate * 100}`
      );
    }
  });

  it("Group B.5 · 1-Match anchorToRadarPicks Direction Fidelity Across All Slots (Underdog, Draw, and Non-Single HAD -> HHAD/HAFU/CRS)", () => {
    const pickFromMatch = (
      m: MatchItem,
      poolCode: "HAD" | "HHAD" | "HAFU" | "TTG" | "CRS",
      key: string
    ): SelectedPick => {
      const pool = m.pools[poolCode];
      const opt = pool.options.find((o) => o.key === key || o.label === key)!;
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

    // 1. Single-capable 1-match underdog anchor (日本 vs 巴拉圭, anchor 巴拉圭 客胜 HAD a):
    // Slots ①, ②, ③ must prioritize HAD a + compatible draw cushion HAD d (NEVER betting 日本 主胜 HAD h, and Slot ② spear must stay HAD a!)
    const mSingle = FALLBACK_MATCHES[1] as MatchItem;
    const awayUnderdogAnchor = pickFromMatch(mSingle, "HAD", "a");
    const plansUnderdog = generateParetoPortfolio(
      [mSingle],
      100,
      "objective",
      false,
      [awayUnderdogAnchor]
    );
    for (const idx of [0, 1, 2]) {
      const p = plansUnderdog[idx] as ArchetypePlan;
      assert.equal(
        p.available,
        true,
        `Slot ${idx + 1} must be available for 1-match underdog anchor`
      );
      const legKeys = p.lines.flatMap((l) =>
        l.legs.map((g) => `${g.poolCode}:${g.optionKey}`)
      );
      assert.ok(
        legKeys.includes("HAD:a"),
        `Slot ${idx + 1} (${p.key}) must include anchored underdog HAD:a, got: ${legKeys.join(", ")}`
      );
      assert.equal(
        legKeys.includes("HAD:h"),
        false,
        `Slot ${idx + 1} (${p.key}) must NEVER bet opposing favorite HAD:h when HAD:a is anchored, got: ${legKeys.join(", ")}`
      );
    }
    assert.equal(
      plansUnderdog[1].lines[0].legs[0].optionKey,
      "a",
      "Slot ② primary spear must stay locked on anchored underdog HAD:a (never swapped with shield HAD:d)"
    );

    // 2. Draw anchors (dir === 'draw') across Slots ①, ②, ③ on:
    //   (2a) non-single main pool match (FALLBACK_MATCHES[0]),
    //   (2b) single-capable HAD+HHAD match (FALLBACK_MATCHES[1]),
    //   (2c) HAD.single=false + HHAD.single=true match (FALLBACK_MATCHES[2]),
    //   (2d) HAFU-suspended match (only CRS/TTG single selling).
    const isDrawCompatibleLeg = (
      poolCode: string,
      optionKey: string,
      optionLabel: string
    ): boolean => {
      if (poolCode === "HAD") return optionKey === "d";
      if (poolCode === "HAFU") return ["dd", "hd", "ad"].includes(optionKey);
      if (poolCode === "CRS") {
        const lbl = optionLabel || optionKey;
        if (lbl === "平其它" || optionKey === "s1sd") return true;
        const [hs, as] = lbl.split(":").map(Number);
        return Number.isFinite(hs) && Number.isFinite(as) && hs === as;
      }
      if (poolCode === "TTG") return ["s0", "s2"].includes(optionKey);
      return false;
    };

    const m0 = FALLBACK_MATCHES[0] as MatchItem;
    const m2 = FALLBACK_MATCHES[2] as MatchItem;
    const mNoHafu: MatchItem = {
      ...m0,
      id: "b5-draw-nohafu",
      pools: {
        ...m0.pools,
        HAFU: { ...m0.pools.HAFU, selling: false },
      },
    };

    for (const [label, matchObj] of [
      ["non-single main (m0)", m0],
      ["single HAD+HHAD (m1)", mSingle],
      ["non-single HAD + single HHAD (m2)", m2],
      ["HAFU suspended (CRS/TTG only)", mNoHafu],
    ] as const) {
      const drawAnc = pickFromMatch(matchObj, "HAD", "d");
      const drawPlans = generateParetoPortfolio(
        [matchObj],
        100,
        "objective",
        false,
        [drawAnc]
      );
      for (const idx of [0, 1, 2]) {
        const p = drawPlans[idx] as ArchetypePlan;
        assert.equal(
          p.available,
          true,
          `Draw anchor [${label}] Slot ${idx + 1} must be available`
        );
        for (const ln of p.lines) {
          for (const g of ln.legs) {
            assert.equal(
              isDrawCompatibleLeg(g.poolCode, g.optionKey, g.optionLabel),
              true,
              `Draw anchor [${label}] Slot ${idx + 1} (${p.key}) emitted non-draw leg ${g.poolCode}:${g.optionKey}(${g.optionLabel})`
            );
          }
        }
      }
    }

    // 3. Non-single HAD anchors (HAD h and HAD a when HAD.single === false) on matches where HHAD.single === true:
    //   Test both goalLine = -2 (m2) and goalLine = +1 (mPlus1)!
    const mPlus1: MatchItem = {
      ...(FALLBACK_MATCHES[4] as MatchItem),
      id: "b5-hhad-plus1",
      pools: {
        ...(FALLBACK_MATCHES[4] as MatchItem).pools,
        HAD: { ...(FALLBACK_MATCHES[4] as MatchItem).pools.HAD, single: false },
        HHAD: {
          ...(FALLBACK_MATCHES[4] as MatchItem).pools.HHAD,
          single: true,
          goalLine: "+1",
        },
      },
    };

    // (3a) m2 (goalLine = -2), anchor HAD a (away underdog): NEVER HHAD:hh, HHAD:hd, HAFU:hh, HAFU:dh
    const m2AwayPlans = generateParetoPortfolio([m2], 100, "objective", false, [
      pickFromMatch(m2, "HAD", "a"),
    ]);
    for (const idx of [0, 1, 2]) {
      const p = m2AwayPlans[idx] as ArchetypePlan;
      assert.equal(p.available, true);
      for (const g of p.lines.flatMap((l) => l.legs)) {
        assert.equal(
          m2.pools[g.poolCode].single,
          true,
          `1-match leg must be single-allowed: ${g.poolCode}`
        );
        assert.equal(
          ["HHAD:hh", "HHAD:hd", "HAFU:hh", "HAFU:dh"].includes(
            `${g.poolCode}:${g.optionKey}`
          ),
          false,
          `m2(-2) away anchor Slot ${idx + 1} must not emit home-win leg ${g.poolCode}:${g.optionKey}`
        );
      }
    }

    // (3b) m2 (goalLine = -2), anchor HAD h (home favorite): NEVER HHAD:ha, HAFU:aa, HAFU:da
    const m2HomePlans = generateParetoPortfolio([m2], 100, "objective", false, [
      pickFromMatch(m2, "HAD", "h"),
    ]);
    for (const idx of [0, 1, 2]) {
      const p = m2HomePlans[idx] as ArchetypePlan;
      assert.equal(p.available, true);
      for (const g of p.lines.flatMap((l) => l.legs)) {
        assert.equal(m2.pools[g.poolCode].single, true);
        assert.equal(
          ["HHAD:ha", "HAFU:aa", "HAFU:da"].includes(
            `${g.poolCode}:${g.optionKey}`
          ),
          false,
          `m2(-2) home anchor Slot ${idx + 1} must not emit away-lean leg ${g.poolCode}:${g.optionKey}`
        );
      }
    }

    // (3c) mPlus1 (goalLine = +1), anchor HAD a (away favorite): NEVER HHAD:hh, HAFU:hh, HAFU:dh
    const mPlus1AwayPlans = generateParetoPortfolio(
      [mPlus1],
      100,
      "objective",
      false,
      [pickFromMatch(mPlus1, "HAD", "a")]
    );
    for (const idx of [0, 1, 2]) {
      const p = mPlus1AwayPlans[idx] as ArchetypePlan;
      assert.equal(p.available, true);
      for (const g of p.lines.flatMap((l) => l.legs)) {
        assert.equal(mPlus1.pools[g.poolCode].single, true);
        assert.equal(
          ["HHAD:hh", "HAFU:hh", "HAFU:dh"].includes(
            `${g.poolCode}:${g.optionKey}`
          ),
          false,
          `mPlus1(+1) away anchor Slot ${idx + 1} must not emit home leg ${g.poolCode}:${g.optionKey}`
        );
      }
    }

    // (3d) mPlus1 (goalLine = +1), anchor HAD h (home underdog): NEVER HHAD:ha, HHAD:hd, HAFU:aa, HAFU:da
    const mPlus1HomePlans = generateParetoPortfolio(
      [mPlus1],
      100,
      "objective",
      false,
      [pickFromMatch(mPlus1, "HAD", "h")]
    );
    for (const idx of [0, 1, 2]) {
      const p = mPlus1HomePlans[idx] as ArchetypePlan;
      assert.equal(p.available, true);
      for (const g of p.lines.flatMap((l) => l.legs)) {
        assert.equal(mPlus1.pools[g.poolCode].single, true);
        assert.equal(
          ["HHAD:ha", "HHAD:hd", "HAFU:aa", "HAFU:da"].includes(
            `${g.poolCode}:${g.optionKey}`
          ),
          false,
          `mPlus1(+1) home anchor Slot ${idx + 1} must not emit away-win leg ${g.poolCode}:${g.optionKey}`
        );
      }
    }
  });
});
