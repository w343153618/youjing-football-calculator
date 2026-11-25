import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_MATCHES,
  computeTruthReport,
  evaluateQuantWorkspace,
  parseSportteryRawJson,
} from "../server/quantEngine.mjs";
import { createManualQaEngine } from "../server/manualQaEngine.mjs";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";
import type { MatchItem, SelectedPick } from "../src/prototype/quantTypes.ts";

describe("Spec 0005: Official China Sporttery Selection Rules, Multi-Pass State Space & Five-Archetype Radar Sync", () => {
  it("blocks same-match cross-pool parlay selection (e.g. Coritiba HAD win 3.63 + HHAD[+1] draw 3.04) while allowing same-pool multi-select and dual-single lock", async () => {
    const coritibaMatch: MatchItem = {
      ...FALLBACK_MATCHES[0],
      id: "2042838",
      matchNumStr: "周三001",
      league: "巴甲",
      home: "科里蒂巴",
      away: "桑托斯",
      pools: {
        ...FALLBACK_MATCHES[0].pools,
        HAD: {
          code: "HAD",
          name: "胜平负",
          single: false,
          selling: true,
          payoutRatio: 0.88,
          vig: 0.12,
          updateTime: "实时",
          options: [
            { key: "h", label: "主胜", odds: 3.63, trend: 0, fairProb: 0.24 },
            { key: "d", label: "平", odds: 3.5, trend: 0, fairProb: 0.25 },
            { key: "a", label: "客胜", odds: 1.73, trend: 0, fairProb: 0.51 },
          ],
        },
        HHAD: {
          code: "HHAD",
          name: "让球(+1)",
          single: false,
          selling: true,
          goalLine: "+1",
          payoutRatio: 0.88,
          vig: 0.12,
          updateTime: "实时",
          options: [
            { key: "hh", label: "让胜", odds: 1.8, trend: 0, fairProb: 0.49 },
            { key: "hd", label: "让平", odds: 3.04, trend: 0, fairProb: 0.29 },
            { key: "ha", label: "让负", odds: 3.92, trend: 0, fairProb: 0.22 },
          ],
        },
      },
    };

    const hadWinPick: SelectedPick = {
      matchId: coritibaMatch.id,
      matchNumStr: coritibaMatch.matchNumStr,
      home: coritibaMatch.home,
      away: coritibaMatch.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: false,
      optionKey: "h",
      optionLabel: "主胜",
      odds: 3.63,
      fairProb: 0.24,
    };

    const hhadDrawPick: SelectedPick = {
      matchId: coritibaMatch.id,
      matchNumStr: coritibaMatch.matchNumStr,
      home: coritibaMatch.home,
      away: coritibaMatch.away,
      poolCode: "HHAD",
      poolName: "让球(+1)",
      singleAllowed: false,
      optionKey: "hd",
      optionLabel: "让平",
      odds: 3.04,
      fairProb: 0.29,
    };

    // 1. Same-pool double pick (HAD win + HAD draw) is 100% legal via real BetSlipController interface
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl.initializeMatches(
      [coritibaMatch],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, [coritibaMatch])
    );
    assert.equal((await ctrl.togglePick(coritibaMatch, "HAD", "h")).ok, true);
    assert.equal((await ctrl.togglePick(coritibaMatch, "HAD", "d")).ok, true);

    // 2. ADR-0015 smooth same-match pool switch + 1-click undo:
    // Clicking HHAD[+1] draw 3.04 on Coritiba atomically replaces the 2 HAD picks and supports 1-click undo!
    assert.equal("isPoolMutexLocked" in ctrl, false);
    const switchedMix = await ctrl.togglePick(coritibaMatch, "HHAD", "hd");
    assert.equal(switchedMix.ok, true);
    assert.equal(switchedMix.action, "switched-pool");
    assert.equal(switchedMix.replacedCount, 2);
    assert.equal(switchedMix.canUndoPoolSwitch, true);
    assert.deepEqual(
      ctrl.getState().picks.map((p) => `${p.poolCode}:${p.optionKey}`),
      ["HHAD:hd"]
    );

    assert.equal(ctrl.undoLastPoolSwitch(), true);
    assert.deepEqual(
      ctrl.getState().picks.map((p) => `${p.poolCode}:${p.optionKey}`),
      ["HAD:h", "HAD:d"]
    );

    await ctrl.setMode("spf");
    const switchedSpfNonSingle = await ctrl.togglePick(
      coritibaMatch,
      "HHAD",
      "hd"
    );
    assert.equal(switchedSpfNonSingle.ok, true);
    assert.equal(switchedSpfNonSingle.action, "switched-pool");
    assert.equal(ctrl.undoLastPoolSwitch(), true);

    // Server defense-in-depth: forged cross-pool non-single payload cannot checkout (totalCost = 0)
    const forgedRep = computeTruthReport([hadWinPick, hhadDrawPick], 5, [
      coritibaMatch,
    ]);
    assert.equal(forgedRep.canCheckout, false);
    assert.equal(forgedRep.totalCost, 0);
    assert.equal(forgedRep.maxPayout, 0);

    // 3. Single non-single match alone (Coritiba HAD win 3.63) -> ¥0 cost & ¥0 payout in raw computeTruthReport, with syntheticHint
    const oneNonSingleRep = computeTruthReport([hadWinPick], 5, [
      coritibaMatch,
    ]);
    assert.equal(oneNonSingleRep.canCheckout, false);
    assert.equal(oneNonSingleRep.totalCost, 0);
    assert.equal(oneNonSingleRep.maxPayout, 0);
    assert.ok(
      oneNonSingleRep.syntheticHint && oneNonSingleRep.syntheticHint.length > 0
    );

    // 4. Dual-single match (FALLBACK_MATCHES[1] where HAD.single=true & HHAD.single=true):
    // smoothly switches pool in 'mix' mode (with undo), and coexists in 'spf' mode with autoLockedSingleReason='dual-single'
    const dualSingleMatch = FALLBACK_MATCHES[1] as MatchItem;
    ctrl.initializeMatches(
      FALLBACK_MATCHES as MatchItem[],
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 5 }, FALLBACK_MATCHES)
    );
    await ctrl.setMode("mix");
    assert.equal((await ctrl.togglePick(dualSingleMatch, "HAD", "h")).ok, true);
    const mixSwitchOnDual = await ctrl.togglePick(
      dualSingleMatch,
      "HHAD",
      "hd"
    );
    assert.equal(mixSwitchOnDual.ok, true);
    assert.equal(mixSwitchOnDual.action, "switched-pool");
    assert.equal(ctrl.undoLastPoolSwitch(), true);

    await ctrl.setMode("spf");
    const spfDual = await ctrl.togglePick(dualSingleMatch, "HHAD", "hd");
    assert.equal(spfDual.ok, true);
    assert.equal(spfDual.autoLockedSingleReason, "dual-single");
  });

  it("parses all 31 official CRS scorelines (including 胜其它/平其它/负其它), respects suspended pools, and caps 4/6/8 parlay legs", async () => {
    const crsRaw: Record<string, string> = {
      s01s00: "6.00",
      s02s00: "7.50",
      s02s01: "8.00",
      s03s00: "14.0",
      s03s01: "15.0",
      s03s02: "26.0",
      s04s00: "32.0",
      s04s01: "34.0",
      s04s02: "55.0",
      s05s00: "80.0",
      s05s01: "85.0",
      s05s02: "120",
      s1sh: "45.0",
      s00s00: "9.50",
      s01s01: "6.20",
      s02s02: "13.5",
      s03s03: "55.0",
      s1sd: "250",
      s00s01: "8.50",
      s00s02: "14.0",
      s01s02: "10.5",
      s00s03: "32.0",
      s01s03: "26.0",
      s02s03: "34.0",
      s00s04: "80.0",
      s01s04: "65.0",
      s02s04: "90.0",
      s00s05: "180",
      s01s05: "150",
      s02s05: "200",
      s1sa: "90.0",
    };
    const parsed = parseSportteryRawJson({
      value: {
        matchInfoList: [
          {
            subMatchList: [
              {
                matchId: 9001,
                matchNumStr: "周三009",
                leagueAbbName: "巴甲",
                matchTime: "07:30:00",
                homeTeamAbbName: "弗拉门戈",
                awayTeamAbbName: "巴竞技",
                poolList: [
                  { poolCode: "HAD", single: 0, cbtValue: 2 }, // suspended [未]
                  { poolCode: "HHAD", single: 1, cbtValue: 1 },
                  { poolCode: "CRS", single: 1, cbtValue: 1 },
                  { poolCode: "TTG", single: 1, cbtValue: 1 },
                  { poolCode: "HAFU", single: 1, cbtValue: 1 },
                ],
                had: { h: "1.10", d: "6.30", a: "14.0" },
                hhad: { goalLine: "-2", h: "2.50", d: "3.40", a: "2.25" },
                crs: crsRaw,
                ttg: {
                  s0: "12",
                  s1: "5",
                  s2: "3.4",
                  s3: "3.6",
                  s4: "5.5",
                  s5: "10",
                  s6: "20",
                  s7: "28",
                },
                hafu: {
                  hh: "1.5",
                  hd: "16",
                  ha: "45",
                  dh: "3.8",
                  dd: "7.5",
                  da: "19",
                  ah: "22",
                  ad: "19",
                  aa: "18",
                },
              },
            ],
          },
        ],
      },
    });

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].pools.HAD.selling, false);
    assert.equal(parsed[0].pools.HAD.options.length, 0);
    assert.equal(parsed[0].pools.CRS.options.length, 31);
    assert.ok(
      parsed[0].pools.CRS.options.some(
        (o: { label: string }) => o.label === "胜其它"
      )
    );
    assert.ok(
      parsed[0].pools.CRS.options.some(
        (o: { label: string }) => o.label === "平其它"
      )
    );
    assert.ok(
      parsed[0].pools.CRS.options.some(
        (o: { label: string }) => o.label === "负其它"
      )
    );

    // 6 matches where 1 match picks CRS (比分 max 4 legs) -> poolCap = 4, auto pass = 4串1 (C(6,4)=15 bets), 5关 & 6关 disabled!
    const sixPicks: SelectedPick[] = FALLBACK_MATCHES.slice(0, 6).map(
      (m, idx) => {
        if (idx === 0) {
          const opt = m.pools.CRS.options[0];
          return {
            matchId: m.id,
            matchNumStr: m.matchNumStr,
            home: m.home,
            away: m.away,
            poolCode: "CRS",
            poolName: "比分",
            singleAllowed: true,
            optionKey: opt.key,
            optionLabel: opt.label,
            odds: opt.odds,
            fairProb: opt.fairProb,
          };
        }
        const opt = m.pools.HAD.options[0];
        return {
          matchId: m.id,
          matchNumStr: m.matchNumStr,
          home: m.home,
          away: m.away,
          poolCode: "HAD",
          poolName: "胜平负",
          singleAllowed: m.pools.HAD.single,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        };
      }
    );
    const repCrs6 = computeTruthReport(sixPicks, 1, FALLBACK_MATCHES);
    assert.equal(repCrs6.poolCap, 4);
    assert.deepEqual(repCrs6.activePassSizes, [4]);
    assert.equal(repCrs6.betCount, 15); // C(6, 4) = 15 bets
    assert.equal(repCrs6.totalCost, 30);
    assert.equal(
      repCrs6.availableFreePasses.find((p) => p.size === 5)?.enabled,
      false
    );
    assert.equal(
      repCrs6.availableFreePasses.find((p) => p.size === 6)?.enabled,
      false
    );

    // 9th match in mix mode is blocked via real BetSlipController interface
    const ninthMatch: MatchItem = {
      ...(FALLBACK_MATCHES[0] as MatchItem),
      id: "match-9",
      matchNumStr: "周五009",
    };
    const nineMatches = [...(FALLBACK_MATCHES as MatchItem[]), ninthMatch];
    const ctrl9 = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: (params, matches) =>
        evaluateQuantWorkspace(params, matches),
    });
    ctrl9.initializeMatches(
      nineMatches,
      [],
      evaluateQuantWorkspace({ picks: [], multiple: 1 }, nineMatches)
    );
    for (const m of nineMatches.slice(0, 8)) {
      assert.equal((await ctrl9.togglePick(m, "HAD", "h")).ok, true);
    }
    const ninthAttempt = await ctrl9.togglePick(ninthMatch, "HAD", "h");
    assert.equal(ninthAttempt.ok, false);
  });

  it("matches official m.sporttery.cn payout to 0.01 yuan and computes exact non-overlapping probabilities for 自由过关 & M串N (4串11)", () => {
    // Official m.sporttery.cn live test vector: [3.63, 1.10, 1.60, 2.23] 4关 × 1倍 -> ¥28.49
    const fourOfficialPicks: SelectedPick[] = [3.63, 1.1, 1.6, 2.23].map(
      (odds, idx) => ({
        matchId: FALLBACK_MATCHES[idx].id,
        matchNumStr: FALLBACK_MATCHES[idx].matchNumStr,
        home: FALLBACK_MATCHES[idx].home,
        away: FALLBACK_MATCHES[idx].away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds,
        fairProb: 0.45,
      })
    );

    const rep4x1 = computeTruthReport(fourOfficialPicks, 1, FALLBACK_MATCHES, {
      mode: "free",
      passSizes: [4],
    });
    assert.equal(rep4x1.betCount, 1);
    assert.equal(rep4x1.totalCost, 2);
    assert.equal(rep4x1.maxPayout, 28.49);

    // 4串11 (2关+3关+4关 = 6 + 4 + 1 = 11 bets) on [1.50, 1.60, 2.00, 2.50] at 5倍 (totalCost = ¥110)
    const picks4x11: SelectedPick[] = [
      [1.5, 0.6],
      [1.6, 0.55],
      [2.0, 0.45],
      [2.5, 0.35],
    ].map(([odds, prob], idx) => ({
      matchId: FALLBACK_MATCHES[idx].id,
      matchNumStr: FALLBACK_MATCHES[idx].matchNumStr,
      home: FALLBACK_MATCHES[idx].home,
      away: FALLBACK_MATCHES[idx].away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: false,
      optionKey: "h",
      optionLabel: "主胜",
      odds,
      fairProb: prob,
    }));

    const rep4x11 = computeTruthReport(picks4x11, 5, FALLBACK_MATCHES, {
      mode: "combo",
      comboCode: "4x11",
    });
    assert.equal(rep4x11.modeLabel, "4串11");
    assert.equal(rep4x11.betCount, 11);
    assert.equal(rep4x11.totalCost, 110);

    // Lowest winning outcome: only 1.50 & 1.60 hit (1 bet of 2串1 wins: 1.5*1.6*2 * 5 = ¥24.00 < ¥110 -> underwater!)
    assert.equal(rep4x11.minPayout, 24);
    assert.ok(
      rep4x11.underwaterCount > 0,
      "Hitting only 2 low-odds legs in 4串11 is underwater"
    );

    // Exact binomial probability of hitting >= 2 matches out of [0.6, 0.55, 0.45, 0.35]:
    // P(0 hit) = 0.4 * 0.45 * 0.55 * 0.65 = 0.06435
    // P(1 hit) = 0.6*0.45*0.55*0.65 + 0.4*0.55*0.55*0.65 + 0.4*0.45*0.45*0.65 + 0.4*0.45*0.55*0.35
    //          = 0.096525 + 0.07865 + 0.05265 + 0.03465 = 0.262475
    // P(>=2 hit) = 1 - 0.06435 - 0.262475 = 0.673175
    assert.ok(
      Math.abs(rep4x11.anyWinProb - 0.673175) < 1e-6,
      `Expected 0.673175, got ${rep4x11.anyWinProb}`
    );
    assert.ok(rep4x11.realProfitProb < rep4x11.anyWinProb);
  });

  it("anchors Five Archetypes to user-selected teams in Match Radar when anchorToRadarPicks is enabled", () => {
    // Pick underdog away/home directions contrary to default highest-prob favorites:
    // Match 0 (中国 vs 巴林): pick 巴林 客胜 ('a' @4.18) instead of 中国 主胜 ('h' @1.69)
    // Match 3 (威尔士 vs 葡萄牙): pick 威尔士 主胜 ('h' @4.50) instead of 葡萄牙 客胜 ('a' @1.66)
    const m0 = FALLBACK_MATCHES[0];
    const m3 = FALLBACK_MATCHES[3];
    const underdogPicks: SelectedPick[] = [
      {
        matchId: m0.id,
        matchNumStr: m0.matchNumStr,
        home: m0.home,
        away: m0.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "a",
        optionLabel: "客胜",
        odds: 4.18,
        fairProb: 0.21,
      },
      {
        matchId: m3.id,
        matchNumStr: m3.matchNumStr,
        home: m3.home,
        away: m3.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: true,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 4.5,
        fairProb: 0.19,
      },
    ];

    const wsAnchored = evaluateQuantWorkspace(
      {
        picks: underdogPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m0.id, m3.id],
        anchorToRadarPicks: true,
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );

    const iron = wsAnchored.portfolioPlans.find(
      (p) => p.key === "max-profit-prob"
    )!;
    // ADR-0019 §2: extreme 4.18 × 4.50 double-underdog parlay (~4% hit rate, ~96% wipeout) is honestly blocked on Slot ①;
    // when paired with draw shields ([a,d] + [h,d]), Slot ① activates and strictly honors ONLY user-selected options!
    assert.equal(iron.available, false);

    const m1 = FALLBACK_MATCHES[4]; // 比利时 vs 意大利: default favorite is 'h' @2.38
    const m2 = FALLBACK_MATCHES[2]; // 波兰 vs 瑞典: default favorite is 'h' @2.38
    const shieldedUnderdogPicks: SelectedPick[] = [
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: Boolean(m1.pools.HAD.single),
        optionKey: "a",
        optionLabel: "客胜",
        odds: m1.pools.HAD.options[2].odds,
        fairProb: m1.pools.HAD.options[2].fairProb,
      },
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: Boolean(m1.pools.HAD.single),
        optionKey: "d",
        optionLabel: "平",
        odds: m1.pools.HAD.options[1].odds,
        fairProb: m1.pools.HAD.options[1].fairProb,
      },
      {
        matchId: m2.id,
        matchNumStr: m2.matchNumStr,
        home: m2.home,
        away: m2.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: Boolean(m2.pools.HAD.single),
        optionKey: "a",
        optionLabel: "客胜",
        odds: m2.pools.HAD.options[2].odds,
        fairProb: m2.pools.HAD.options[2].fairProb,
      },
      {
        matchId: m2.id,
        matchNumStr: m2.matchNumStr,
        home: m2.home,
        away: m2.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: Boolean(m2.pools.HAD.single),
        optionKey: "d",
        optionLabel: "平",
        odds: m2.pools.HAD.options[1].odds,
        fairProb: m2.pools.HAD.options[1].fairProb,
      },
    ];
    const wsShielded = evaluateQuantWorkspace(
      {
        picks: shieldedUnderdogPicks,
        multiple: 5,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: [m1.id, m2.id],
        anchorToRadarPicks: true,
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    const shieldedIron = wsShielded.portfolioPlans.find(
      (p) => p.key === "max-profit-prob"
    )!;
    assert.equal(shieldedIron.available, true);
    assert.ok(
      shieldedIron.lines.some((ln) =>
        ln.legs.some((lg) => lg.matchId === m1.id && lg.optionKey === "a")
      ),
      "max-profit-prob lines must honor user-selected m1 客胜"
    );
    assert.ok(
      shieldedIron.lines.some((ln) =>
        ln.legs.some((lg) => lg.matchId === m2.id && lg.optionKey === "a")
      ),
      "max-profit-prob lines must honor user-selected m2 客胜"
    );
    assert.equal(
      shieldedIron.lines.some((ln) =>
        ln.legs.some(
          (lg) =>
            (lg.matchId === m1.id && lg.optionKey === "h") ||
            (lg.matchId === m2.id && lg.optionKey === "h")
        )
      ),
      false,
      "max-profit-prob MUST NEVER inject unselected favorites (m1 主胜 or m2 主胜)"
    );
  });

  it("answers same-match mutex, M串N pass rules, and radar-sync questions instantly from Iron-Cage Manual KB", async () => {
    const qa = createManualQaEngine({
      accountManager: {
        recordQaViolation: () => ({
          locked: false,
          strikeCount: 1,
          maxAllowed: 4,
        }),
        consumeAiQuota: () => ({ ok: true, remaining: 99 }),
      },
      xiaogaoService: null,
      getApiKey: () => "",
    });

    const r1 = await qa.answerManualQuestion({
      userId: "u1",
      question: "为什么同一场比赛选了胜平负后，不能再点让球平？",
      ip: "127.0.0.1",
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.source, "local-kb");
    assert.ok(r1.answer?.includes("互斥"));

    const r2 = await qa.answerManualQuestion({
      userId: "u1",
      question: "过关选择里的自由过关和3串4有什么区别？",
      ip: "127.0.0.1",
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.source, "local-kb");
    assert.ok(r2.answer?.includes("3串4"));

    const r3 = await qa.answerManualQuestion({
      userId: "u1",
      question: "一键匹配赛事雷达已选球队有什么用？",
      ip: "127.0.0.1",
    });
    assert.equal(r3.ok, true);
    assert.equal(r3.source, "local-kb");
    assert.ok(r3.answer?.includes("方向锚定"));
  });

  it("enforces M串N multi-select Cartesian expansion (2×4=8 bets on 3串4), ¥20k hard block, O(M) 12-match single safety, and 4-leg archetype cap", () => {
    assert.ok(FALLBACK_MATCHES.every((m) => m.pools.CRS.options.length === 31));

    // [2, 1, 1] options across 3 matches: Free 2关+3关 = 7 bets, Official 3串4 = 2 * 4 = 8 bets!
    const [m0, m1, m2] = FALLBACK_MATCHES;
    const multi3Picks: SelectedPick[] = [
      {
        matchId: m0.id,
        matchNumStr: m0.matchNumStr,
        home: m0.home,
        away: m0.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 1.69,
        fairProb: 0.52,
      },
      {
        matchId: m0.id,
        matchNumStr: m0.matchNumStr,
        home: m0.home,
        away: m0.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "d",
        optionLabel: "平",
        odds: 3.25,
        fairProb: 0.27,
      },
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: true,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 1.36,
        fairProb: 0.64,
      },
      {
        matchId: m2.id,
        matchNumStr: m2.matchNumStr,
        home: m2.home,
        away: m2.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: false,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 2.38,
        fairProb: 0.37,
      },
    ];

    const repFree23 = computeTruthReport(multi3Picks, 1, FALLBACK_MATCHES, {
      mode: "free",
      passSizes: [2, 3],
    });
    assert.equal(repFree23.betCount, 7);

    const repCombo3x4 = computeTruthReport(multi3Picks, 1, FALLBACK_MATCHES, {
      mode: "combo",
      comboCode: "3x4",
    });
    assert.equal(repCombo3x4.betCount, 8);
    assert.equal(repCombo3x4.totalCost, 16);

    // > ¥20,000 hard checkout block (15 bets * 2 * 700 = ¥21,000 > ¥20,000)
    const sixPicks: SelectedPick[] = FALLBACK_MATCHES.slice(0, 6).map((m) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "HAD",
      poolName: "胜平负",
      singleAllowed: true,
      optionKey: "h",
      optionLabel: "主胜",
      odds: m.pools.HAD.options[0].odds,
      fairProb: m.pools.HAD.options[0].fairProb,
    }));
    const repOver20k = computeTruthReport(sixPicks, 700, FALLBACK_MATCHES, {
      mode: "combo",
      comboCode: "6x15",
    });
    assert.equal(repOver20k.totalCost, 21000);
    assert.equal(repOver20k.canCheckout, false);

    // Draw ('d') single-match non-single rescue maps to ['dd', 'hd', 'ad']
    const drawOnlyNonSingle = computeTruthReport(
      [multi3Picks[1]],
      5,
      FALLBACK_MATCHES
    );
    assert.equal(drawOnlyNonSingle.canCheckout, false);
    assert.deepEqual(
      drawOnlyNonSingle.syntheticRescuePicks?.map(
        (p: SelectedPick) => p.optionKey
      ),
      ["dd", "hd", "ad"]
    );

    // 12 all-single matches run in O(M) without state explosion; 16 matches are blocked
    const sixteenMatches: MatchItem[] = Array.from({ length: 16 }, (_, i) => ({
      ...FALLBACK_MATCHES[1],
      id: `sgl-${i}`,
      matchNumStr: `周六0${String(i + 1).padStart(2, "0")}`,
    }));
    const twelveSinglePicks: SelectedPick[] = sixteenMatches
      .slice(0, 12)
      .map((m) => ({
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: "HAD",
        poolName: "胜平负",
        singleAllowed: true,
        optionKey: "h",
        optionLabel: "主胜",
        odds: 2.0,
        fairProb: 0.45,
      }));
    const rep12Sgl = computeTruthReport(twelveSinglePicks, 1, sixteenMatches);
    assert.equal(rep12Sgl.canCheckout, true);
    assert.equal(rep12Sgl.modeLabel, "单关");
    assert.equal(rep12Sgl.maxPayout, 48); // 12 * (2.0 * 2) = 48

    // 6-match anchorPicks containing CRS never produces >4-leg archetype lines
    const crsAnchor: SelectedPick[] = FALLBACK_MATCHES.slice(0, 6).map((m) => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: "CRS",
      poolName: "比分",
      singleAllowed: true,
      optionKey: "0:1",
      optionLabel: "0:1",
      odds: m.pools.CRS.options.find((o) => o.label === "0:1")!.odds,
      fairProb: 0.12,
    }));
    const wsCrs6 = evaluateQuantWorkspace(
      {
        picks: crsAnchor,
        multiple: 2,
        subjectiveDeltaPct: 0,
        simVoidFirstMatch: false,
        planSpec: null,
        targetIds: FALLBACK_MATCHES.slice(0, 6).map((m) => m.id),
        anchorToRadarPicks: true,
        budget: 100,
        stance: "objective",
        unlockFullAgg: false,
      },
      FALLBACK_MATCHES
    );
    for (const plan of wsCrs6.fivePlans) {
      for (const line of plan.lines) {
        const cap = Math.min(
          ...line.legs.map((lg) =>
            lg.poolCode === "CRS" || lg.poolCode === "HAFU"
              ? 4
              : lg.poolCode === "TTG"
                ? 6
                : 8
          )
        );
        assert.ok(
          line.legs.length <= cap,
          `${plan.key} line ${line.id} must respect pool cap ${cap}`
        );
      }
    }
  });
});
