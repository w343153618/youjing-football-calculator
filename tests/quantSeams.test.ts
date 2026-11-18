import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_MATCHES,
  bankerRoundCents,
  bankerRoundParlayUnitPayout,
  computeTruthReport,
  statutorySingleBetCap,
  type MatchItem,
  type SelectedPick,
} from '../src/prototype/data.ts';
import {
  analyzeMatchMicroQuant,
  computeProOrderInsights,
  generateFiveArchetypes,
  optimizeBonusPlan,
} from '../src/prototype/proQuant.ts';
import { buildXiaoGaoWarnings } from '../src/intel/xiaogaoClient.ts';
import { createXiaoGaoService } from '../server/xiaogaoCore.mjs';

describe('Seam 1: Official China Sports Lottery Banker Rounding, Statutory Caps & Pure Math Isolation', () => {
  it('applies exact GB/T 8170 四舍六入五成双 across small, large (>=10,000), and trailing non-zero decimals', () => {
    // 五后皆零看奇偶
    assert.equal(bankerRoundCents(2.025), 2.02); // 2 is even -> round down
    assert.equal(bankerRoundCents(2.035), 2.04); // 3 is odd  -> round up
    assert.equal(bankerRoundCents(3.375), 3.38); // 7 is odd  -> round up
    assert.equal(bankerRoundCents(3.365), 3.36); // 6 is even -> round down

    // 五后非零必进一（即使在第10位小数）
    assert.equal(bankerRoundCents(2.025000001), 2.03);

    // 大额 >= 10,000 串关单倍奖金（修复 toPrecision(15) 精度截断陷阱）
    assert.equal(bankerRoundCents(10_000.015), 10_000.02); // 1 is odd  -> round up
    assert.equal(bankerRoundCents(10_000.025), 10_000.02); // 2 is even -> round down
    assert.equal(bankerRoundCents(100_000.015), 100_000.02); // 1 is odd -> round up

    // 异常/非法赔率安全守护（绝不抛出 RangeError）
    assert.equal(bankerRoundCents(Number.NaN), 0);
    assert.equal(bankerRoundParlayUnitPayout([Number.NaN]), 0);
    assert.equal(bankerRoundParlayUnitPayout([-2]), 0);
    assert.equal(bankerRoundParlayUnitPayout([]), 0);
  });

  it('enforces statutory single-bet payout caps across all 3 official tiers (2/3关 20万, 4/5关 50万, 6~8关 100万)', () => {
    assert.equal(statutorySingleBetCap(1), 100_000);
    assert.equal(statutorySingleBetCap(2), 200_000);
    assert.equal(statutorySingleBetCap(3), 200_000);
    assert.equal(statutorySingleBetCap(4), 500_000);
    assert.equal(statutorySingleBetCap(5), 500_000);
    assert.equal(statutorySingleBetCap(6), 1_000_000);
    assert.equal(statutorySingleBetCap(8), 1_000_000);

    const makeHighPick = (m: MatchItem, odds: number): SelectedPick => ({
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      home: m.home,
      away: m.away,
      poolCode: 'CRS',
      poolName: '比分',
      singleAllowed: true,
      optionKey: '3:2',
      optionLabel: '3:2',
      odds,
      fairProb: 0.01,
    });

    // 2串1: 400 * 400 * 2 = 320,000 -> cap 200,000
    const rep2 = computeTruthReport(
      [makeHighPick(FALLBACK_MATCHES[0], 400), makeHighPick(FALLBACK_MATCHES[1], 400)],
      1,
      FALLBACK_MATCHES
    );
    assert.equal(rep2.combos[0].unitPayout, 200_000);
    assert.equal(rep2.combos[0].cappedClipped, 120_000);

    // 4串1: 30^4 * 2 = 1,620,000 -> cap 500,000
    const rep4 = computeTruthReport(
      FALLBACK_MATCHES.slice(0, 4).map((m) => makeHighPick(m, 30)),
      1,
      FALLBACK_MATCHES
    );
    assert.equal(rep4.combos[0].unitPayout, 500_000);
    assert.equal(rep4.combos[0].cappedClipped, 1_120_000);

    // 6串1: 12^6 * 2 = 5,971,968 -> cap 1,000,000
    const sixMatches: MatchItem[] = Array.from({ length: 6 }, (_, idx) => ({
      ...FALLBACK_MATCHES[idx % FALLBACK_MATCHES.length],
      id: `syn-m-${idx}`,
      matchNumStr: `周六00${idx + 1}`,
    }));
    const rep6 = computeTruthReport(
      sixMatches.map((m) => makeHighPick(m, 12)),
      1,
      sixMatches
    );
    assert.equal(rep6.combos[0].unitPayout, 1_000_000);
  });

  it('keeps realProfitProb <= anyWinProb on cross-pool picks and isolates XiaoGao intel per ADR-0002', () => {
    const m1 = FALLBACK_MATCHES[0];
    const crossPoolPicks: SelectedPick[] = [
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: 'HAD',
        poolName: '胜平负',
        singleAllowed: true,
        optionKey: 'h',
        optionLabel: '主胜',
        odds: 1.75,
        fairProb: 0.52,
      },
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: 'HHAD',
        poolName: '让球(-1)',
        singleAllowed: true,
        optionKey: 'hh',
        optionLabel: '让胜',
        odds: 3.2,
        fairProb: 0.28,
      },
    ];
    const rep = computeTruthReport(crossPoolPicks, 5, FALLBACK_MATCHES);
    assert.equal(rep.hasSameMatchCrossPoolConflict, true);
    assert.ok(rep.realProfitProb <= rep.anyWinProb + 1e-9);

    // ADR-0002: computeTruthReport must stay 100% pure math (no aiAlert warnings), while buildXiaoGaoWarnings surfaces them
    assert.equal(
      rep.warnings.some((w) => w.id.startsWith('ai-') || w.id.startsWith('xiaogao-')),
      false
    );
    const matchesWithAlert: MatchItem[] = FALLBACK_MATCHES.map((m, i) =>
      i === 0
        ? {
            ...m,
            aiAlert: {
              level: 'high',
              tag: '防轮换留力',
              summary: '杯赛前夕主力中场轮休',
              priceInStatus: '盘面尚未充分消化',
              source: '扫地僧小高靶向排雷',
            },
          }
        : m
    );
    const xgWarnings = buildXiaoGaoWarnings(crossPoolPicks, matchesWithAlert);
    assert.equal(xgWarnings.length, 1);
    assert.ok(xgWarnings[0].title.includes('扫地僧小高靶向排雷'));
  });
});

describe('Seam 2: Bonus Optimizer, Five Archetypes, Equivalent Arbitrage & Staggered Hedge', () => {
  it('optimizes both single-match (单关) and multi-match (2串1) slips across equal, hot-first, and cold-first', () => {
    const m1 = FALLBACK_MATCHES[0];
    const m2 = FALLBACK_MATCHES[1];

    // Single-match HAFU double pick
    const singlePicks: SelectedPick[] = ['hh', 'dh'].map((key) => {
      const opt = m1.pools.HAFU.options.find((o) => o.key === key)!;
      return {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: 'HAFU',
        poolName: '半全场',
        singleAllowed: true,
        optionKey: opt.key,
        optionLabel: opt.label,
        odds: opt.odds,
        fairProb: opt.fairProb,
      };
    });
    const singleRep = computeTruthReport(singlePicks, 5, FALLBACK_MATCHES);
    for (const mode of ['equal', 'hot-first', 'cold-first'] as const) {
      const plan = optimizeBonusPlan(singleRep, FALLBACK_MATCHES, mode)!;
      assert.ok(plan);
      assert.equal(plan.lines.length, 2);
      assert.ok(plan.lines.every((l) => l.legs.length === 1 && l.returnPayout >= plan.totalCost));
    }

    // 2串1 multi-match parlay
    const parlayPicks: SelectedPick[] = [
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: 'HAD',
        poolName: '胜平负',
        singleAllowed: false,
        optionKey: 'h',
        optionLabel: '主胜',
        odds: 1.65,
        fairProb: 0.53,
      },
      {
        matchId: m1.id,
        matchNumStr: m1.matchNumStr,
        home: m1.home,
        away: m1.away,
        poolCode: 'HAD',
        poolName: '胜平负',
        singleAllowed: false,
        optionKey: 'd',
        optionLabel: '平',
        odds: 3.45,
        fairProb: 0.25,
      },
      {
        matchId: m2.id,
        matchNumStr: m2.matchNumStr,
        home: m2.home,
        away: m2.away,
        poolCode: 'HAD',
        poolName: '胜平负',
        singleAllowed: false,
        optionKey: 'h',
        optionLabel: '主胜',
        odds: 1.85,
        fairProb: 0.47,
      },
    ];
    const manual = computeTruthReport(parlayPicks, 5, FALLBACK_MATCHES);
    for (const mode of ['equal', 'hot-first', 'cold-first'] as const) {
      const plan = optimizeBonusPlan(manual, FALLBACK_MATCHES, mode)!;
      assert.ok(plan);
      for (const line of plan.lines) {
        assert.equal(line.legs.length, 2);
        assert.ok(line.multiple >= 1 && line.multiple <= 99);
        assert.ok(line.returnPayout >= plan.totalCost);
      }
    }

    const eqPlan = optimizeBonusPlan(manual, FALLBACK_MATCHES, 'equal')!;
    const hotPlan = optimizeBonusPlan(manual, FALLBACK_MATCHES, 'hot-first')!;
    const coldPlan = optimizeBonusPlan(manual, FALLBACK_MATCHES, 'cold-first')!;
    assert.ok(
      hotPlan.lines.find((l) => l.prob >= 0.2)!.netProfit >=
        eqPlan.lines.find((l) => l.prob >= 0.2)!.netProfit
    );
    assert.ok(
      coldPlan.lines.find((l) => l.prob < 0.2)!.netProfit >=
        eqPlan.lines.find((l) => l.prob < 0.2)!.netProfit
    );
  });

  it('enforces 36% light-position guardrail on value-assassin archetype by default', () => {
    const plans = generateFiveArchetypes(FALLBACK_MATCHES.slice(0, 2), 100, 'objective', false);
    assert.equal(plans.length, 5);
    const assassin = plans.find((p) => p.key === 'value-assassin')!;
    assert.ok(assassin.totalCost <= 44);
    assert.ok(assassin.savedCash >= 56);
  });

  it('computes staggered kickoff hedge lock-in and match-exact activeSwapTip (including HAD synthetic better than HHAD)', () => {
    // Construct two matches 4 hours apart where Match 2 has HAD(d+a) synthetic better than HHAD(-1 ha)
    const early: MatchItem = {
      ...FALLBACK_MATCHES[0],
      id: 'm-early',
      kickoff: '20:00',
    };
    const lateBase = FALLBACK_MATCHES[1];
    const late: MatchItem = {
      ...lateBase,
      id: 'm-late',
      kickoff: '00:30', // 24:30 -> 270 mins after 20:00 (>= 110 mins)
      pools: {
        ...lateBase.pools,
        HAD: {
          ...lateBase.pools.HAD,
          options: [
            { key: 'h', label: '主胜', odds: 1.95, trend: 0, fairProb: 0.46 },
            { key: 'd', label: '平', odds: 3.6, trend: 0, fairProb: 0.25 },
            { key: 'a', label: '客胜', odds: 3.8, trend: 0, fairProb: 0.29 },
          ],
        },
        HHAD: {
          ...lateBase.pools.HHAD,
          goalLine: '-1',
          // synDouble of 3.6 & 3.8 is ~1.849; set HHAD ha = 1.72 so HAD[d+a] is strictly better!
          options: [
            { key: 'hh', label: '让胜', odds: 3.5, trend: 0, fairProb: 0.25 },
            { key: 'hd', label: '让平', odds: 3.45, trend: 0, fairProb: 0.26 },
            { key: 'ha', label: '让负', odds: 1.72, trend: 0, fairProb: 0.49 },
          ],
        },
      },
    };

    const mqLate = analyzeMatchMicroQuant(late);
    const hhadArb = mqLate.arbitrages.find((a) => a.title.includes('受让不败'))!;
    assert.ok(hhadArb, 'Expected handicap equivalence arbitrage item');
    assert.equal(hhadArb.matchId, 'm-late');
    // Since synDouble (~1.85) > hhadAway (1.72), betterPicks MUST be HAD d + HAD a, worsePicks MUST be HHAD ha!
    assert.deepEqual(hhadArb.betterPicks, [
      { poolCode: 'HAD', optionKey: 'd' },
      { poolCode: 'HAD', optionKey: 'a' },
    ]);
    assert.deepEqual(hhadArb.worsePicks, [{ poolCode: 'HHAD', optionKey: 'ha' }]);

    // Case A: User picked HAD h on early & HAD h on late (did NOT pick worsePicks HHAD ha) -> activeSwapTip must be null!
    const picksNoInferior: SelectedPick[] = [
      {
        matchId: early.id,
        matchNumStr: early.matchNumStr,
        home: early.home,
        away: early.away,
        poolCode: 'HAD',
        poolName: '胜平负',
        singleAllowed: true,
        optionKey: 'h',
        optionLabel: '主胜',
        odds: 1.8,
        fairProb: 0.5,
      },
      {
        matchId: late.id,
        matchNumStr: late.matchNumStr,
        home: late.home,
        away: late.away,
        poolCode: 'HAD',
        poolName: '胜平负',
        singleAllowed: true,
        optionKey: 'h',
        optionLabel: '主胜',
        odds: 1.95,
        fairProb: 0.46,
      },
    ];
    const repA = computeTruthReport(picksNoInferior, 10, [early, late]);
    const insA = computeProOrderInsights(picksNoInferior, repA, [early, late]);
    assert.equal(insA.hedge.available, true);
    assert.equal(insA.hedge.gapMinutes, 270);
    assert.ok(insA.hedge.hedgeCost >= 2 && insA.hedge.hedgeCost % 2 === 0);
    assert.equal(insA.activeSwapTip, null);

    // Case B: User picked worse option HHAD ha on m-late -> activeSwapTip fires specifically for m-late!
    const picksWithInferior: SelectedPick[] = [
      picksNoInferior[0],
      {
        matchId: late.id,
        matchNumStr: late.matchNumStr,
        home: late.home,
        away: late.away,
        poolCode: 'HHAD',
        poolName: '让球(-1)',
        singleAllowed: true,
        optionKey: 'ha',
        optionLabel: '让负',
        odds: 1.72,
        fairProb: 0.49,
      },
    ];
    const repB = computeTruthReport(picksWithInferior, 10, [early, late]);
    const insB = computeProOrderInsights(picksWithInferior, repB, [early, late]);
    assert.ok(insB.activeSwapTip);
    assert.equal(insB.activeSwapTip!.matchId, 'm-late');
    assert.deepEqual(insB.activeSwapTip!.betterPicks, [
      { poolCode: 'HAD', optionKey: 'd' },
      { poolCode: 'HAD', optionKey: 'a' },
    ]);
  });
});

describe('Seam 3: Shared XiaoGao Core Failover, Auto-Recovery & Brand Confidentiality', () => {
  it('prioritizes deepseek-v4.1-flash, fails over to glm-5.3-flash, retries primary if backup fails in cooldown, recovers after cooldown, and redacts public status', async () => {
    let now = 1_000_000;
    let primaryHealthy = true;
    let backupHealthy = true;

    const svc = createXiaoGaoService({
      cooldownMs: 15_000,
      enableProbe: false,
      nowFn: () => now,
      transport: async (_key: string, model: string) => {
        if (model === 'deepseek-v4.1-flash' && !primaryHealthy) {
          throw new Error('503 Primary Unavailable');
        }
        if (model === 'glm-5.3-flash' && !backupHealthy) {
          throw new Error('502 Backup Unavailable');
        }
        return '{"level":"high","tag":"防一球卡盘","summary":"测试排雷","priceInStatus":"未消化"}';
      },
    });

    // 1. Healthy primary -> uses deepseek-v4.1-flash
    const r1 = await svc.invokeWithAutoFailover('test-key', [{ role: 'user', content: 'ping' }]);
    assert.equal(r1.usedModel, 'deepseek-v4.1-flash');
    assert.equal(r1.fallbackTriggered, false);

    // 2. Primary outage -> seamlessly switches to glm-5.3-flash
    primaryHealthy = false;
    now += 1_000;
    const r2 = await svc.invokeWithAutoFailover('test-key', [{ role: 'user', content: 'ping' }]);
    assert.equal(r2.usedModel, 'glm-5.3-flash');
    assert.equal(r2.fallbackTriggered, true);
    assert.equal(svc.getPublicStatus().channel, 'backup');

    // 3. During cooldown (<15s), if primary quietly recovered and backup suddenly glitches -> immediately retries primary!
    primaryHealthy = true;
    backupHealthy = false;
    now += 3_000;
    const r3 = await svc.invokeWithAutoFailover('test-key', [{ role: 'user', content: 'ping' }]);
    assert.equal(r3.usedModel, 'deepseek-v4.1-flash');
    assert.equal(r3.fallbackTriggered, false);
    assert.equal(svc.getPublicStatus().channel, 'primary');

    // 4. Trigger outage again, wait past 15s cooldown, then verify automatic switch back to primary
    backupHealthy = true;
    primaryHealthy = false;
    await svc.invokeWithAutoFailover('test-key', [{ role: 'user', content: 'ping' }]);
    assert.equal(svc.getPublicStatus().channel, 'backup');

    primaryHealthy = true;
    now += 16_000; // past cooldown
    const r4 = await svc.invokeWithAutoFailover('test-key', [{ role: 'user', content: 'ping' }]);
    assert.equal(r4.usedModel, 'deepseek-v4.1-flash');
    assert.equal(svc.getPublicStatus().channel, 'primary');

    // 5. Public status endpoint payload MUST NEVER leak "deepseek" or "glm"
    const pubJson = JSON.stringify(svc.getPublicStatus()).toLowerCase();
    assert.equal(pubJson.includes('deepseek'), false);
    assert.equal(pubJson.includes('glm'), false);
  });
});
