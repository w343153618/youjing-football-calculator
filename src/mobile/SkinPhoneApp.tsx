import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FALLBACK_MATCHES,
  bankerRoundCents,
  computeTruthReport,
  requestXiaoGaoDiagnosis,
  syncOfficialMatches,
  type MatchItem,
  type PoolCode,
  type SelectedPick,
  type TruthReport,
} from '../prototype/data';
import {
  analyzeMatchMicroQuant,
  computeProOrderInsights,
  generateFiveArchetypes,
  type ArchetypeKey,
  type ArchetypePlan,
  type UserStance,
} from '../prototype/proQuant';
import {
  SKINS,
  Spring,
  animateNumber,
  bindTilt,
  ensureGlobalTactileListener,
  enterStagger,
  fxOf,
  haptic,
  popStagger,
  readSpringTokens,
  setGlobalTimeScale,
  showSpringToast,
} from '../spring/engine';
import {
  SpringProbBar,
  SpringSegmented,
  SpringSheet,
  SpringSwitch,
  TeamCrest,
  kickElement,
} from '../spring/widgets';
import { UserManualModal, type ManualSectionId } from '../manual/UserManualModal';

type AppTab = 'match' | 'archetypes' | 'audit' | 'ledger';
type MatchMode = 'mix' | 'spf' | 'bf' | 'zjq' | 'bqc' | 'single';
type QuickFilter = 'all' | 'single' | 'low-vig' | 'drop' | 'arb';

type SheetState =
  | null
  | { type: 'more'; matchId: string }
  | { type: 'intel'; matchId: string }
  | { type: 'poster' }
  | { type: 'filter' };

const MODE_OPTS: Array<[MatchMode, string]> = [
  ['mix', '混合'],
  ['spf', '胜平负'],
  ['bf', '比分'],
  ['zjq', '进球'],
  ['bqc', '半全场'],
  ['single', '单关'],
];

const ARCH_OPTS: Array<[ArchetypeKey, string]> = [
  ['iron-shield', '铁盾'],
  ['spear-shield', '博胆'],
  ['fault-tolerant', '容错'],
  ['goal-structure', '进球'],
  ['value-assassin', '刺客'],
];

function makeUnderwaterDemoPicks(matches: MatchItem[]): SelectedPick[] {
  const m1 = matches[0];
  const m2 = matches.find((x) => x.kickoff.startsWith('03:')) ?? matches[1];
  const out: SelectedPick[] = [];
  if (m1) {
    // 选半全场 3 个不同赔率选项，立刻暴露假中奖陷阱 + 早晚场时间差锁利
    for (const k of ['hh', 'dh', 'dd', 'ah']) {
      const o = m1.pools.HAFU.options.find((x) => x.key === k);
      if (o) {
        out.push({
          matchId: m1.id,
          matchNumStr: m1.matchNumStr,
          home: m1.home,
          away: m1.away,
          poolCode: 'HAFU',
          poolName: m1.pools.HAFU.name,
          singleAllowed: true,
          optionKey: o.key,
          optionLabel: o.label,
          odds: o.odds,
          fairProb: o.fairProb,
        });
      }
    }
  }
  if (m2 && out.length === 0) {
    const o = m2.pools.HAD.options[0];
    if (o) {
      out.push({
        matchId: m2.id,
        matchNumStr: m2.matchNumStr,
        home: m2.home,
        away: m2.away,
        poolCode: 'HAD',
        poolName: m2.pools.HAD.name,
        singleAllowed: m2.pools.HAD.single,
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      });
    }
  }
  return out;
}

function archetypeToReport(plan: ArchetypePlan): TruthReport {
  const matchSet = new Set<string>();
  plan.lines.forEach((l) => l.legs.forEach((lg) => matchSet.add(lg.matchId)));
  const combos = plan.lines.map((l) => ({
    id: l.id,
    desc:
      `${l.roleLabel}(${l.multiple}倍) · ` +
      l.legs.map((g) => `${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`).join('×'),
    prob: l.prob,
    unitPayout: l.unitPayout,
    totalPayout: l.returnPayout,
    cappedClipped: 0,
    netProfit: l.netProfit,
    isUnderwater: l.netProfit < 0 && plan.missOneReturn === null,
  }));

  return {
    matchCount: matchSet.size,
    comboCount: plan.lines.length,
    multiple: 1,
    modeLabel: `${plan.shortTab}·分倍精算`,
    canSingle: matchSet.size === 1,
    hasSameMatchCrossPoolConflict: false,
    totalCost: plan.totalCost,
    minPayout: plan.missOneReturn ?? plan.minReturn,
    maxPayout: plan.maxReturn,
    likelyRange: [plan.minReturn, plan.maxReturn],
    anyWinProb: plan.winProb,
    realProfitProb: plan.profitProb,
    underwaterCount: 0,
    underwaterShareOfWins: 0,
    avgPayoutRatio: (100 - plan.vigPct) / 100,
    avgVigLossPer100: plan.vigPct,
    expectedValueRate: -plan.vigPct / 100,
    dangerScore: plan.key === 'value-assassin' ? 66 : 29,
    effectiveOdds: plan.totalCost > 0 ? plan.maxReturn / plan.totalCost : 1.5,
    breakevenUpgradeCost: null,
    consolidatedTickets: plan.lines.length,
    syntheticHint: `已启用【${plan.badge}】：${plan.tagline}`,
    combos,
    warnings: [],
  };
}

export function SkinPhoneApp({
  initialSkin,
  embedded,
  onOpenStage,
}: {
  initialSkin: string;
  embedded: boolean;
  onOpenStage?: () => void;
}) {
  const base = import.meta.env.BASE_URL || '/';
  const [skin, setSkin] = useState<string>(initialSkin);
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => !embedded && typeof window !== 'undefined' && window.innerWidth >= 960
  );
  const [dkRightTab, setDkRightTab] = useState<'archetypes' | 'ledger'>('archetypes');
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [manualSection, setManualSection] = useState<ManualSectionId>('optimizer');
  const openManual = (sec: ManualSectionId = 'optimizer') => {
    setManualSection(sec);
    setManualOpen(true);
  };
  const [tab, setTab] = useState<AppTab>('match');
  const [mode, setMode] = useState<MatchMode>('mix');
  const [qFilter, setQFilter] = useState<QuickFilter>('all');
  const [matches, setMatches] = useState<MatchItem[]>(FALLBACK_MATCHES);
  const [picks, setPicks] = useState<SelectedPick[]>(() =>
    makeUnderwaterDemoPicks(FALLBACK_MATCHES)
  );
  const [appliedPlan, setAppliedPlan] = useState<ArchetypePlan | null>(null);
  const [multiple, setMultiple] = useState<number>(5);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState('已连接体彩实盘快照 · 支持一键刷新官网水位');
  const [syncClock, setSyncClock] = useState('21:05');

  // Archetype tab state
  const [targetIds, setTargetIds] = useState<string[]>(() =>
    FALLBACK_MATCHES.slice(0, 2).map((m) => m.id)
  );
  const [budget, setBudget] = useState<number>(100);
  const [stance, setStance] = useState<UserStance>('objective');
  const [archKey, setArchKey] = useState<ArchetypeKey>('spear-shield');
  const [unlockFullAgg, setUnlockFullAgg] = useState(false);

  // Audit Sandbox & Hedge state
  const [simHedgeHit, setSimHedgeHit] = useState(true);
  const [subjectiveDeltaPct, setSubjectiveDeltaPct] = useState<number>(0); // -15 ~ +15% 主观胜率微调滑块
  const [simVoidFirstMatch, setSimVoidFirstMatch] = useState<boolean>(false); // 模拟首场腰斩延期(按1.0计奖)

  // Ledger state
  const [dailyRemain, setDailyRemain] = useState(300);
  const [ledgerItems, setLedgerItems] = useState<
    Array<{ id: string; kind: 'live' | 'paper'; title: string; cost: number; tag: string }>
  >([
    { id: 'l1', kind: 'live', title: '2串1 · 博胆护盾分倍3张', cost: 100, tag: '+¥82.40' },
    { id: 'l2', kind: 'paper', title: '4串1 · 高危转0成本模拟单', cost: 0, tag: '免损¥120' },
  ]);

  // Sheet state
  const [sheet, setSheet] = useState<SheetState>(null);
  const [bfGrp, setBfGrp] = useState<'win' | 'draw' | 'lose'>('win');
  const [checkedPosterLines, setCheckedPosterLines] = useState<Record<string, boolean>>({});
  const [leagueFilter, setLeagueFilter] = useState<Record<string, boolean>>({});
  const [diagnosingMatchId, setDiagnosingMatchId] = useState<string | null>(null);
  const [customIntelInput, setCustomIntelInput] = useState<string>('');

  // DOM Refs for spring physics
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const puckRef = useRef<HTMLDivElement>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const slipAmtRef = useRef<HTMLSpanElement>(null);
  const mulValRef = useRef<HTMLSpanElement>(null);
  const balValRef = useRef<HTMLSpanElement>(null);
  const bfGridRef = useRef<HTMLDivElement>(null);

  const skinLinkRef = useRef<HTMLLinkElement | null>(null);
  const puckSpringRef = useRef<Spring | null>(null);
  const slipSpringRef = useRef<Spring | null>(null);
  const prevAmtRef = useRef<number>(-1);
  const prevBalRef = useRef<number>(300);

  useEffect(() => {
    if (embedded) return;
    const onResize = () => setIsDesktop(window.innerWidth >= 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [embedded]);

  // 1. Mount core.css + active skin.css
  useEffect(() => {
    ensureGlobalTactileListener();

    let coreLink = document.getElementById('jz-core-css') as HTMLLinkElement | null;
    if (!coreLink) {
      coreLink = document.createElement('link');
      coreLink.id = 'jz-core-css';
      coreLink.rel = 'stylesheet';
      coreLink.href = `${base}skins/core.css`;
      document.head.appendChild(coreLink);
    }

    const sLink = document.createElement('link');
    sLink.rel = 'stylesheet';
    sLink.href = `${base}skins/${skin}.css`;
    sLink.onload = () => {
      readSpringTokens();
      placePuck(false);
    };
    document.head.appendChild(sLink);
    skinLinkRef.current = sLink;

    return () => {
      sLink.remove();
    };
  }, []);

  const switchSkinSmooth = (nextId: string, silent = false) => {
    if (nextId === skin) return;
    setSkin(nextId);
    if (!silent) haptic(10);
    const sh = shellRef.current;
    sh?.classList.add('skin-anim');

    const next = document.createElement('link');
    next.rel = 'stylesheet';
    next.href = `${base}skins/${nextId}.css`;
    next.onload = () => {
      skinLinkRef.current?.remove();
      skinLinkRef.current = next;
      readSpringTokens();
      requestAnimationFrame(() => {
        placePuck(false);
        window.setTimeout(() => sh?.classList.remove('skin-anim'), 420);
      });
      try {
        window.parent?.postMessage({ cmd: 'skinChanged', value: nextId }, '*');
      } catch {
        // ignore
      }
    };
    document.head.appendChild(next);
  };

  // 2. Sync live matches from China Sports Lottery
  const runOfficialSync = async (toastOnDone = false) => {
    setSyncing(true);
    const res = await syncOfficialMatches();
    setMatches(res.matches);
    const now = new Date();
    setSyncClock(
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(
        now.getSeconds()
      ).padStart(2, '0')}`
    );
    setSyncSummary(res.syncNote);

    setTargetIds((prev) => {
      const valid = res.matches.filter((m) => prev.includes(m.id)).map((m) => m.id);
      return valid.length >= 1 ? valid : res.matches.slice(0, 2).map((m) => m.id);
    });
    setPicks((prev) => {
      const synced = prev
        .map((pk) => {
          const um = res.matches.find(
            (m) => m.id === pk.matchId || m.matchNumStr === pk.matchNumStr
          );
          const uo = um?.pools[pk.poolCode]?.options.find((o) => o.key === pk.optionKey);
          if (!um || !uo) return null;
          return {
            ...pk,
            matchId: um.id,
            odds: uo.odds,
            fairProb: uo.fairProb,
            singleAllowed: um.pools[pk.poolCode].single,
          };
        })
        .filter((x): x is SelectedPick => x !== null);
      return synced.length >= 1 ? synced : makeUnderwaterDemoPicks(res.matches);
    });
    setSyncing(false);
    if (toastOnDone) {
      showSpringToast(layerRef.current, `已同步 ${res.matches.length} 场官网实盘`);
    }
  };

  useEffect(() => {
    void runOfficialSync(false);
  }, []);

  // 3. Preset Demo Scenarios (restored from web version!)
  const loadPresetScenario = (kind: 'underwater' | 'synthetic' | 'parlay4' | 'hedge2') => {
    setAppliedPlan(null);
    setSimVoidFirstMatch(false);
    setSubjectiveDeltaPct(0);
    haptic(10);

    if (kind === 'underwater') {
      setMultiple(5);
      setPicks(makeUnderwaterDemoPicks(matches));
      showSpringToast(layerRef.current, '已载入：半全场假中奖陷阱');
      setTab('audit');
    } else if (kind === 'synthetic') {
      const m = matches.find((x) => !x.pools.HAD.single) ?? matches[0];
      if (!m) return;
      setMultiple(10);
      setPicks(
        ['hh', 'dh']
          .map((k) => {
            const o = m.pools.HAFU.options.find((x) => x.key === k);
            if (!o) return null;
            return {
              matchId: m.id,
              matchNumStr: m.matchNumStr,
              home: m.home,
              away: m.away,
              poolCode: 'HAFU' as PoolCode,
              poolName: m.pools.HAFU.name,
              singleAllowed: true,
              optionKey: o.key,
              optionLabel: o.label,
              odds: o.odds,
              fairProb: o.fairProb,
            };
          })
          .filter((x): x is SelectedPick => x !== null)
      );
      showSpringToast(layerRef.current, '已载入：半全场合成单关');
      setTab('audit');
    } else if (kind === 'parlay4') {
      setMultiple(3);
      setPicks(
        matches
          .slice(0, 4)
          .map((m) => {
            const o = m.pools.HAD.options[0];
            if (!o) return null;
            return {
              matchId: m.id,
              matchNumStr: m.matchNumStr,
              home: m.home,
              away: m.away,
              poolCode: 'HAD' as PoolCode,
              poolName: m.pools.HAD.name,
              singleAllowed: m.pools.HAD.single,
              optionKey: o.key,
              optionLabel: o.label,
              odds: o.odds,
              fairProb: o.fairProb,
            };
          })
          .filter((x): x is SelectedPick => x !== null)
      );
      showSpringToast(layerRef.current, '已载入：4串1连乘抽水雪崩');
      setTab('audit');
    } else if (kind === 'hedge2') {
      const mEarly = matches[0];
      const mLate = matches.find((x) => x.kickoff.startsWith('03:') || x.kickoff.startsWith('07:')) ?? matches[matches.length - 1];
      if (!mEarly || !mLate) return;
      setMultiple(15);
      setPicks(
        [mEarly, mLate].map((m) => {
          const o = m.pools.HAD.options[0];
          return {
            matchId: m.id,
            matchNumStr: m.matchNumStr,
            home: m.home,
            away: m.away,
            poolCode: 'HAD' as PoolCode,
            poolName: m.pools.HAD.name,
            singleAllowed: m.pools.HAD.single,
            optionKey: o.key,
            optionLabel: o.label,
            odds: o.odds,
            fairProb: o.fairProb,
          };
        })
      );
      showSpringToast(layerRef.current, '已载入：早晚场时间差锁利');
      setTab('audit');
    }
  };

  // 4. Parent ComparisonStage broadcast bridge
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.cmd === 'setTab') {
        setSheet(null);
        setTab(d.value as AppTab);
      } else if (d.cmd === 'openMore') {
        setTab('match');
        setMode('mix');
        setTimeout(() => {
          setMatches((cur) => {
            if (cur[0]) setSheet({ type: 'more', matchId: cur[0].id });
            return cur;
          });
        }, 60);
      } else if (d.cmd === 'openIntel') {
        setTab('match');
        setTimeout(() => {
          setMatches((cur) => {
            if (cur[0]) setSheet({ type: 'intel', matchId: cur[0].id });
            return cur;
          });
        }, 60);
      } else if (d.cmd === 'openPoster') {
        setSheet({ type: 'poster' });
      } else if (d.cmd === 'timeScale') {
        setGlobalTimeScale(Number(d.value) || 1);
      } else if (d.cmd === 'setSkin') {
        switchSkinSmooth(String(d.value), true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  // 5. Dock Puck Spring
  const placePuck = (animate: boolean) => {
    const nav = navRef.current;
    const puckEl = puckRef.current;
    if (!nav || !puckEl) return;
    if (!puckSpringRef.current) {
      puckSpringRef.current = new Spring(0, {
        k: 480,
        c: 28,
        eps: 0.05,
        onUpdate: (v) => {
          const el = puckRef.current;
          const sp = puckSpringRef.current;
          if (!el || !sp) return;
          const stretch = 1 + Math.min(Math.abs(sp.v) / 2600, 0.24);
          el.style.transform = `translate3d(${v}px,0,0) scaleX(${stretch})`;
        },
      });
    }
    const order: AppTab[] = ['match', 'archetypes', 'audit', 'ledger'];
    const idx = Math.max(0, order.indexOf(tab));
    const cellW = nav.clientWidth / 4;
    const pw = puckEl.offsetWidth || 64;
    const x = idx * cellW + (cellW - pw) / 2;
    if (animate) puckSpringRef.current.set(x);
    else puckSpringRef.current.jump(x);
  };

  useLayoutEffect(() => {
    placePuck(true);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      enterStagger(scrollRef.current, 30);
    }
  }, [tab, mode, qFilter]);

  // 6. Computed Matches, Reports & Sandbox Adjustments
  const visibleMatches = useMemo(() => {
    const activeLeagues = Object.entries(leagueFilter)
      .filter(([, on]) => on)
      .map(([lg]) => lg);
    let list = matches;
    if (activeLeagues.length > 0) list = list.filter((m) => activeLeagues.includes(m.league));
    if (mode === 'single' || qFilter === 'single') {
      list = list.filter((m) => m.pools.HAD.single);
    } else if (qFilter === 'low-vig') {
      list = list.filter((m) => m.pools.HAD.vig < 0.1228);
    } else if (qFilter === 'drop') {
      list = list.filter((m) =>
        Object.values(m.pools).some((p) => p.options.some((o) => o.trend === -1))
      );
    } else if (qFilter === 'arb') {
      list = list.filter((m) => analyzeMatchMicroQuant(m).arbitrages.length > 0);
    }
    return list.length > 0 ? list : matches;
  }, [matches, mode, qFilter, leagueFilter]);

  // Apply Sandbox (模拟首场腰斩赔率归 1.0 + 主观胜率信心滑块微调)
  const sandboxAdjustedPicks = useMemo(() => {
    const firstMid = picks[0]?.matchId;
    return picks.map((pk) => {
      const odds = simVoidFirstMatch && pk.matchId === firstMid ? 1.0 : pk.odds;
      const prob = Math.min(
        0.96,
        Math.max(0.02, pk.fairProb * (1 + subjectiveDeltaPct / 100))
      );
      return { ...pk, odds, fairProb: prob };
    });
  }, [picks, simVoidFirstMatch, subjectiveDeltaPct]);

  const manualReport = useMemo(
    () => computeTruthReport(sandboxAdjustedPicks, multiple, matches),
    [sandboxAdjustedPicks, multiple, matches]
  );

  const effectiveReport = useMemo(
    () => (appliedPlan && !simVoidFirstMatch && subjectiveDeltaPct === 0 ? archetypeToReport(appliedPlan) : manualReport),
    [appliedPlan, manualReport, simVoidFirstMatch, subjectiveDeltaPct]
  );

  const insights = useMemo(
    () => computeProOrderInsights(sandboxAdjustedPicks, effectiveReport, matches),
    [sandboxAdjustedPicks, effectiveReport, matches]
  );

  const resolvedTargets = useMemo(() => {
    const found = matches.filter((m) => targetIds.includes(m.id));
    return found.length > 0 ? found : matches.slice(0, 2);
  }, [matches, targetIds]);

  const fivePlans = useMemo(
    () => generateFiveArchetypes(resolvedTargets, budget, stance, unlockFullAgg),
    [resolvedTargets, budget, stance, unlockFullAgg]
  );
  const currentArch = fivePlans.find((p) => p.key === archKey) ?? fivePlans[0];

  // Subjective EV calculation when slider is moved
  const subjectiveEVPct = useMemo(() => {
    if (effectiveReport.totalCost <= 0) return 0;
    const expRet = effectiveReport.combos.reduce((a, c) => a + c.prob * c.totalPayout, 0);
    return ((expRet - effectiveReport.totalCost) / effectiveReport.totalCost) * 100;
  }, [effectiveReport]);

  // 7. Slip Spring Choreography
  useLayoutEffect(() => {
    if (!slipSpringRef.current) {
      slipSpringRef.current = new Spring(150, {
        k: 380,
        c: 22,
        eps: 0.05,
        onUpdate: (v) => {
          if (slipRef.current) slipRef.current.style.transform = `translate3d(0,${v}px,0)`;
        },
      });
    }
    const show = tab === 'match' && effectiveReport.matchCount > 0;
    slipSpringRef.current
      .config(show ? 380 : 520, show ? 21 : 42)
      .set(show ? 0 : 150);
    if (slipRef.current) slipRef.current.style.pointerEvents = show ? 'auto' : 'none';

    if (show && effectiveReport.totalCost !== prevAmtRef.current) {
      if (prevAmtRef.current >= 0 && slipAmtRef.current) {
        animateNumber(
          slipAmtRef.current,
          prevAmtRef.current,
          effectiveReport.totalCost,
          (v) => `¥${Math.round(v)}`
        );
        fxOf(slipAmtRef.current).scale.config(600, 14).kick(1.9);
      } else if (slipAmtRef.current) {
        slipAmtRef.current.textContent = `¥${effectiveReport.totalCost}`;
      }
    }
    prevAmtRef.current = effectiveReport.totalCost;
  }, [tab, effectiveReport.matchCount, effectiveReport.totalCost]);

  useLayoutEffect(() => {
    if (tab === 'ledger' && balValRef.current) {
      animateNumber(
        balValRef.current,
        prevBalRef.current,
        dailyRemain,
        (v) => `¥${Math.round(v)}.00`
      );
      prevBalRef.current = dailyRemain;
    }
  }, [tab, dailyRemain]);

  // Actions
  const isPicked = (matchId: string, poolCode: PoolCode, optKey: string) =>
    picks.some(
      (p) => p.matchId === matchId && p.poolCode === poolCode && p.optionKey === optKey
    );

  const togglePick = (
    el: HTMLElement | null,
    m: MatchItem,
    poolCode: PoolCode,
    optKey: string
  ) => {
    setAppliedPlan(null);
    const pool = m.pools[poolCode];
    const opt = pool.options.find((o) => o.key === optKey);
    if (!opt) return;
    const currentlyOn = isPicked(m.id, poolCode, optKey);
    kickElement(el, currentlyOn ? -1.4 : 2.8);
    haptic(currentlyOn ? 5 : 10);

    setPicks((prev) =>
      currentlyOn
        ? prev.filter(
            (p) => !(p.matchId === m.id && p.poolCode === poolCode && p.optionKey === optKey)
          )
        : [
            ...prev,
            {
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
            },
          ]
    );
  };

  const applyArchetype = (plan: ArchetypePlan) => {
    setAppliedPlan(plan);
    setSimVoidFirstMatch(false);
    setSubjectiveDeltaPct(0);
    const map = new Map<string, SelectedPick>();
    plan.lines.forEach((l) =>
      l.legs.forEach((lg) => {
        const fm = matches.find((x) => x.id === lg.matchId);
        map.set(`${lg.matchId}-${lg.poolCode}-${lg.optionKey}`, {
          matchId: lg.matchId,
          matchNumStr: lg.matchNumStr,
          home: lg.home,
          away: lg.away,
          poolCode: lg.poolCode,
          poolName: lg.poolName,
          singleAllowed: fm?.pools[lg.poolCode]?.single ?? true,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          fairProb: lg.fairProb,
        });
      })
    );
    setPicks(Array.from(map.values()));
    haptic(12);
    showSpringToast(layerRef.current, `已套用 · ${plan.shortTab}`);
    setTab('audit');
  };

  // 三模智能奖金优化引擎：平均优化(均衡派奖) / 博热保本(主攻吃肉+次选护盾) / 博冷高弹(正路保底+高赔放大)
  const applyBonusOptimization = (optMode: 'equal' | 'hot-first' | 'cold-first') => {
    if (manualReport.combos.length === 0) return;
    const sorted = [...manualReport.combos].sort((a, b) => b.prob - a.prob);
    const k = sorted.length;
    const baseBudget = Math.max(
      manualReport.totalCost,
      manualReport.breakevenUpgradeCost ?? manualReport.totalCost,
      k * 6
    );
    const totalTickets = Math.max(k + 2, Math.round(baseBudget / 2));
    const targetStake = totalTickets * 2;

    let mults: number[] = [];
    if (optMode === 'equal' || k === 1) {
      const invSum = sorted.reduce((acc, c) => acc + 1 / Math.max(0.5, c.unitPayout), 0);
      mults = sorted.map((c) =>
        Math.max(1, Math.round((totalTickets * (1 / Math.max(0.5, c.unitPayout))) / invSum))
      );
      // 若等效水位 > 1.02，自动微调消除残余水下组合
      if (manualReport.effectiveOdds > 1.02) {
        for (let guard = 0; guard < 24; guard++) {
          const curCost = mults.reduce((a, m) => a + m * 2, 0);
          const uwIdx = sorted.findIndex((c, i) => c.unitPayout * mults[i] < curCost);
          if (uwIdx === -1) break;
          mults[uwIdx] += 1;
        }
      }
    } else if (optMode === 'hot-first') {
      mults = sorted.map((c, idx) =>
        idx === 0 ? 1 : Math.max(1, Math.ceil(targetStake / Math.max(2.02, c.unitPayout)))
      );
      const shieldSum = mults.slice(1).reduce((a, m) => a + m, 0);
      mults[0] = Math.max(
        Math.ceil(((shieldSum + 2) * 2) / Math.max(2.02, sorted[0].unitPayout)) + 2,
        totalTickets - shieldSum
      );
      // 二次校准次选保本盾
      const finalCost = mults.reduce((a, m) => a + m * 2, 0);
      if (manualReport.effectiveOdds > 1.02) {
        for (let i = 1; i < k; i++) {
          while (sorted[i].unitPayout * mults[i] < finalCost && mults[i] < 99) {
            mults[i] += 1;
          }
        }
      }
    } else {
      // cold-first: 前 k-1 项保底回本，余量倾斜给最高赔冷门项 sorted[k-1]
      mults = sorted.map((c, idx) =>
        idx === k - 1 ? 1 : Math.max(1, Math.ceil(targetStake / Math.max(2.02, c.unitPayout)))
      );
      const shieldSum = mults.slice(0, k - 1).reduce((a, m) => a + m, 0);
      mults[k - 1] = Math.max(2, totalTickets - shieldSum);
      const finalCost = mults.reduce((a, m) => a + m * 2, 0);
      if (manualReport.effectiveOdds > 1.02) {
        for (let i = 0; i < k - 1; i++) {
          while (sorted[i].unitPayout * mults[i] < finalCost && mults[i] < 99) {
            mults[i] += 1;
          }
        }
      }
    }

    const lines = sorted.map((c, idx) => {
      const mult = Math.min(99, mults[idx]);
      const role =
        optMode === 'equal'
          ? `均衡分倍#${idx + 1}`
          : optMode === 'hot-first'
            ? idx === 0
              ? '🔥主攻重锤'
              : `🛡️次选回本盾#${idx}`
            : idx === k - 1
              ? '⚡博冷高弹箭'
              : `🛡️正路免单盾#${idx + 1}`;
      return {
        id: `opt-${optMode}-${idx}`,
        roleLabel: role,
        legs: picks.slice(0, 1).map((p) => ({
          matchId: p.matchId,
          matchNumStr: p.matchNumStr,
          home: p.home,
          away: p.away,
          kickoff: '21:10',
          poolCode: p.poolCode,
          poolName: p.poolName,
          optionKey: p.optionKey,
          optionLabel: c.desc.replace(/^.*?\[|\]$/g, ''),
          odds: bankerRoundCents(c.unitPayout / 2),
          fairProb: c.prob,
        })),
        modeLabel: manualReport.modeLabel,
        multiple: mult,
        cost: mult * 2,
        unitPayout: c.unitPayout,
        returnPayout: Number((c.unitPayout * mult).toFixed(2)),
        netProfit: 0,
        prob: c.prob,
      };
    });

    const actualTotal = lines.reduce((a, l) => a + l.cost, 0);
    lines.forEach((l) => {
      l.netProfit = Number((l.returnPayout - actualTotal).toFixed(2));
    });
    const profitLinesProb = lines
      .filter((l) => l.netProfit >= 0)
      .reduce((a, l) => a + l.prob, 0);

    const metaMap = {
      equal: {
        shortTab: '平均优化',
        badge: '⚖️ 平均优化（均衡派奖）',
        title: '反比例均注 · 全选项均衡稳赚',
        reason: '按每注返奖额反比例精密分配整数倍，彻底消灭假中奖倒贴',
      },
      'hot-first': {
        shortTab: '博热保本',
        badge: '🔥 博热保本优化',
        title: '次选回本护盾 + 第一主攻利润最大化',
        reason: '防冷次选仅配保本倍数，省下筹码集中放大最高概率主方向收益',
      },
      'cold-first': {
        shortTab: '博冷高弹',
        badge: '⚡ 博冷高弹优化',
        title: '正路免单兜底 + 高赔冷门暴击放大',
        reason: '大热方向锁住保本回血线，溢价倍数倾斜博取高赔冷门超额回报',
      },
    }[optMode];

    setAppliedPlan({
      key: 'iron-shield',
      shortTab: metaMap.shortTab,
      badge: metaMap.badge,
      title: metaMap.title,
      tagline: `总投入 ¥${actualTotal} · 保底返 ¥${Math.min(...lines.map((l) => l.returnPayout)).toFixed(1)} ~ 最高 ¥${Math.max(...lines.map((l) => l.returnPayout)).toFixed(1)}`,
      totalCost: actualTotal,
      savedCash: 0,
      minReturn: Math.min(...lines.map((l) => l.returnPayout)),
      maxReturn: Math.max(...lines.map((l) => l.returnPayout)),
      winProb: manualReport.anyWinProb,
      profitProb: profitLinesProb > 0 ? profitLinesProb : manualReport.anyWinProb,
      missOneReturn: null,
      vigPct: manualReport.avgVigLossPer100,
      reasons: [metaMap.reason],
      lines,
    });
    haptic(12);
    showSpringToast(layerRef.current, `已启用${metaMap.shortTab} (¥${actualTotal})`);
  };

  const upgradeToZeroUnderwater = () => applyBonusOptimization('equal');

  const stepMultiple = (delta: number) => {
    setAppliedPlan(null);
    setMultiple((prev) => {
      const next = Math.max(1, Math.min(99, prev + delta));
      if (mulValRef.current) {
        const f = fxOf(mulValRef.current);
        f.ty.jump(delta > 0 ? 8 : -8);
        f.ty.config(520, 20).set(0);
        f.scale.kick(1.6);
      }
      haptic(5);
      return next;
    });
  };

  const recordToLedger = (kind: 'live' | 'paper') => {
    if (effectiveReport.matchCount === 0) return;
    const cost = kind === 'live' ? effectiveReport.totalCost : 0;
    if (kind === 'live') setDailyRemain((r) => Math.max(0, r - cost));
    setLedgerItems((prev) => [
      {
        id: `tk-${Date.now()}`,
        kind,
        title: `${effectiveReport.modeLabel} · ${effectiveReport.comboCount}注方案`,
        cost,
        tag: kind === 'live' ? `本¥${cost}` : '0成本观察',
      },
      ...prev,
    ]);
    haptic(14);
    showSpringToast(layerRef.current, kind === 'live' ? '已记入实买账本' : '已存为模拟观察单');
    setTab('ledger');
  };

  const triggerXiaoGaoLive = async (m: MatchItem, extraNote?: string) => {
    if (diagnosingMatchId) return;
    setDiagnosingMatchId(m.id);
    haptic(8);
    try {
      const mq = analyzeMatchMicroQuant(m);
      const alert = await requestXiaoGaoDiagnosis(
        m,
        `${m.home} ${mq.homeXG} : ${mq.awayXG} ${m.away} (总预期${mq.totalXG}球)`,
        Math.round(mq.oneGoalShareOfWins * 100),
        extraNote
      );
      setMatches((prev) =>
        prev.map((item) => (item.id === m.id ? { ...item, aiAlert: alert } : item))
      );
      haptic(12);
      showSpringToast(layerRef.current, '扫地僧小高已完成实时排雷');
    } catch {
      showSpringToast(layerRef.current, '诊盘繁忙，请稍后再试');
    } finally {
      setDiagnosingMatchId(null);
    }
  };

  const sheetMatch =
    sheet && (sheet.type === 'more' || sheet.type === 'intel')
      ? matches.find((m) => m.id === sheet.matchId) ?? matches[0]
      : null;

  const extraCountOf = (mId: string) =>
    picks.filter(
      (p) => p.matchId === mId && p.poolCode !== 'HAD' && p.poolCode !== 'HHAD'
    ).length;

  const allLeagues = useMemo(
    () => Array.from(new Set(matches.map((m) => m.league))),
    [matches]
  );

  const hasSuboptimalManual =
    !appliedPlan &&
    manualReport.matchCount > 0 &&
    (manualReport.underwaterCount > 0 || manualReport.avgVigLossPer100 > 19);

  const filterStripNode = (
    <div className="fstrip num">
      {(
        [
          ['all', '全部'],
          ['single', '⚡单关'],
          ['low-vig', '浅抽水'],
          ['drop', '🔻急降水'],
          ['arb', '省钱差价'],
        ] as const
      ).map(([fid, flbl]) => (
        <button
          key={fid}
          type="button"
          data-spring="0.9"
          onClick={() => {
            haptic(5);
            setQFilter(fid);
          }}
          className={`fchip ${qFilter === fid ? 'on' : ''}`}
        >
          {flbl}
        </button>
      ))}
      <button
        type="button"
        data-spring="0.9"
        onClick={() => loadPresetScenario('underwater')}
        className="fchip demo"
      >
        演:假中奖
      </button>
      <button
        type="button"
        data-spring="0.9"
        onClick={() => loadPresetScenario('hedge2')}
        className="fchip demo"
      >
        演:早晚锁利
      </button>
      <button
        type="button"
        data-spring="0.9"
        onClick={() => loadPresetScenario('parlay4')}
        className="fchip demo"
      >
        演:4串1雪崩
      </button>
    </div>
  );

  const matchContent = (
    <>
              {['mix', 'spf', 'single'].includes(mode) && (
                <div className="mgrid colhead enter">
                  <span style={{ textAlign: 'left' }}>球队 / 排名</span>
                  <span>让</span>
                  <span>胜(真率)</span>
                  <span>平(真率)</span>
                  <span>负(真率)</span>
                </div>
              )}

              {visibleMatches.map((m) => {
                const mq = analyzeMatchMicroQuant(m);
                const extN = extraCountOf(m.id);
                const crsSelected = picks
                  .filter((p) => p.matchId === m.id && p.poolCode === 'CRS')
                  .map((p) => p.optionLabel);

                const hP = (m.pools.HAD.options[0]?.fairProb ?? 0.45) * 100;
                const dP = (m.pools.HAD.options[1]?.fairProb ?? 0.27) * 100;
                const aP = (m.pools.HAD.options[2]?.fairProb ?? 0.28) * 100;

                return (
                  <div key={m.id} className="card enter">
                    {/* Layer 1: Full Match Meta + Single Status + Update Time */}
                    <div className="meta">
                      <div className="meta-l">
                        <span className="num no">{m.matchNumStr}</span>
                        <span>{m.league}</span>
                        {m.pools.HAD.single ? (
                          <span className="tag" title="胜平负已开单关">
                            单
                          </span>
                        ) : (
                          <span style={{ fontSize: 9.5, opacity: 0.72 }}>仅半/比单关</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="more num"
                        data-spring="0.9"
                        onClick={() => setSheet({ type: 'more', matchId: m.id })}
                      >
                        <span>{m.kickoff} · 全玩法</span>
                        <span className="more-ind">
                          {extN > 0 ? (
                            <b className="badge num">+{extN}</b>
                          ) : (
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 5 16 12 9 19" />
                            </svg>
                          )}
                        </span>
                      </button>
                    </div>

                    {/* Layer 2: Mini Visual Probability Tug-of-War Bar right on the card! */}
                    <div
                      className="mini-prob"
                      title={`去水真实胜率：主${hP.toFixed(0)}% / 平${dP.toFixed(0)}% / 客${aP.toFixed(0)}%`}
                      onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                    >
                      <i style={{ width: `${hP}%` }} />
                      <i style={{ width: `${dP}%` }} />
                      <i style={{ width: `${aP}%` }} />
                    </div>

                    {/* Layer 3: Rich Quant Micro-Pills (xG + Card-Pan + Vig Compare + Arbitrage) */}
                    <div
                      className="qstrip num"
                      onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                    >
                      <span className="qpill">
                        xG {mq.homeXG}:{mq.awayXG}
                      </span>
                      <span className={`qpill ${mq.oneGoalShareOfWins >= 0.5 ? 'warn' : ''}`}>
                        赢1球卡盘 {(mq.oneGoalShareOfWins * 100).toFixed(0)}%
                      </span>
                      <span className="qpill">
                        主抽{(m.pools.HAD.vig * 100).toFixed(1)}%/半{(m.pools.HAFU.vig * 100).toFixed(0)}%
                      </span>
                      {mq.arbitrages[0] && (
                        <span className="qpill hi">省+{mq.arbitrages[0].edgePct}%</span>
                      )}
                    </div>

                    {/* Layer 4: Mode-Specific Odds Matrix with True Fair Prob % inside EVERY button */}
                    {mode === 'zjq' ? (
                      <>
                        <div
                          className="duel"
                          data-spring="0.98"
                          onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                        >
                          <div className="side">
                            <TeamCrest name={m.home} />
                            <span className="tn">{m.home}</span>
                          </div>
                          <span className="dash" />
                          <div className="side r">
                            <span className="tn">{m.away}</span>
                            <TeamCrest name={m.away} />
                          </div>
                        </div>
                        <div className="grid-keys c4">
                          {m.pools.TTG.options.map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              data-spring="0.86"
                              onClick={(e) => togglePick(e.currentTarget, m, 'TTG', opt.key)}
                              className={`key cell num ${isPicked(m.id, 'TTG', opt.key) ? 'on' : ''}`}
                            >
                              <small>
                                {opt.label} · {(opt.fairProb * 100).toFixed(0)}%
                              </small>
                              <b>{opt.odds.toFixed(2)}</b>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : mode === 'bqc' ? (
                      <>
                        <div
                          className="duel"
                          data-spring="0.98"
                          onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                        >
                          <div className="side">
                            <TeamCrest name={m.home} />
                            <span className="tn">{m.home}</span>
                          </div>
                          <span className="dash" />
                          <div className="side r">
                            <span className="tn">{m.away}</span>
                            <TeamCrest name={m.away} />
                          </div>
                        </div>
                        <div className="grid-keys c3">
                          {m.pools.HAFU.options.map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              data-spring="0.86"
                              onClick={(e) => togglePick(e.currentTarget, m, 'HAFU', opt.key)}
                              className={`key cell num ${isPicked(m.id, 'HAFU', opt.key) ? 'on' : ''}`}
                            >
                              <small>
                                {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                              </small>
                              <b>{opt.odds.toFixed(2)}</b>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : mode === 'bf' ? (
                      <>
                        <div
                          className="duel"
                          data-spring="0.98"
                          onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                        >
                          <div className="side">
                            <TeamCrest name={m.home} />
                            <span className="tn">{m.home}</span>
                          </div>
                          <span className="dash" />
                          <div className="side r">
                            <span className="tn">{m.away}</span>
                            <TeamCrest name={m.away} />
                          </div>
                        </div>
                        <button
                          type="button"
                          data-spring="0.95"
                          onClick={() => setSheet({ type: 'more', matchId: m.id })}
                          className={`key wide num ${crsSelected.length > 0 ? 'on' : ''}`}
                        >
                          {crsSelected.length > 0 ? crsSelected.join(' · ') : '+ 展开全部比分选项 (含真率)'}
                        </button>
                      </>
                    ) : (
                      <div className="mgrid">
                        <div
                          className="teams"
                          data-spring="0.97"
                          onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                        >
                          <div className="t">
                            <TeamCrest name={m.home} />
                            <span className="tn">{m.home}</span>
                            {m.homeRank && <span className="trank">#{m.homeRank}</span>}
                          </div>
                          <div className="t">
                            <TeamCrest name={m.away} />
                            <span className="tn">{m.away}</span>
                            {m.awayRank && <span className="trank">#{m.awayRank}</span>}
                          </div>
                        </div>
                        <div className="rq num">
                          <div>0</div>
                          <div>{(m.pools.HHAD.goalLine ?? '-1').replace('-', '−')}</div>
                        </div>
                        {[0, 1, 2].map((idx) => {
                          const hadOpt = m.pools.HAD.options[idx];
                          const hhadOpt = m.pools.HHAD.options[idx];
                          return (
                            <div key={idx} className="kcol">
                              {hadOpt && (
                                <button
                                  type="button"
                                  data-spring="0.88"
                                  onClick={(e) =>
                                    togglePick(e.currentTarget, m, 'HAD', hadOpt.key)
                                  }
                                  className={`key k2 num ${isPicked(m.id, 'HAD', hadOpt.key) ? 'on' : ''}`}
                                >
                                  <span className="ko">
                                    {hadOpt.odds.toFixed(2)}
                                    {hadOpt.trend === -1 && <i className="trd dn">↓</i>}
                                    {hadOpt.trend === 1 && <i className="trd up">↑</i>}
                                  </span>
                                  <span className="kp">{(hadOpt.fairProb * 100).toFixed(0)}%</span>
                                </button>
                              )}
                              {hhadOpt && (
                                <button
                                  type="button"
                                  data-spring="0.88"
                                  onClick={(e) =>
                                    togglePick(e.currentTarget, m, 'HHAD', hhadOpt.key)
                                  }
                                  className={`key k2 num ${isPicked(m.id, 'HHAD', hhadOpt.key) ? 'on' : ''}`}
                                >
                                  <span className="ko">
                                    {hhadOpt.odds.toFixed(2)}
                                    {hhadOpt.trend === -1 && <i className="trd dn">↓</i>}
                                    {hhadOpt.trend === 1 && <i className="trd up">↑</i>}
                                  </span>
                                  <span className="kp">{(hhadOpt.fairProb * 100).toFixed(0)}%</span>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Layer 5: Inline Intelligence / Arbitrage Teaser Bar! */}
                    {(m.aiAlert || mq.arbitrages[0]) && (
                      <div
                        className="card-intel-bar"
                        onClick={() => setSheet({ type: 'intel', matchId: m.id })}
                      >
                        <span>
                          {m.aiAlert
                            ? `扫地僧小高：${m.aiAlert.tag} · ${m.aiAlert.summary}`
                            : `💰 ${mq.arbitrages[0].detail}`}
                        </span>
                        <b>底牌 ›</b>
                      </div>
                    )}
                  </div>
                );
              })}
    </>
  );

  const archetypesContent = currentArch ? (
    <>
              {/* 🩺 Restored: 买法不划算纠偏医生实时对比卡 */}
              {hasSuboptimalManual && (
                <div className="card enter" style={{ marginBottom: 10 }}>
                  <div className="note-box alert">
                    <strong>🩺 买法不划算纠偏诊断：</strong>
                    你当前自选暗扣抽水 <strong>{manualReport.avgVigLossPer100}%</strong>
                    {manualReport.underwaterCount > 0 && (
                      <>
                        ，且有 <strong>{manualReport.underwaterCount} 种结果假中奖倒亏钱</strong>
                        （真赚率仅 {(manualReport.realProfitProb * 100).toFixed(1)}%）
                      </>
                    )}
                    ！改用下方【{currentArch.shortTab}】可立消假中奖，真赚率提升至{' '}
                    <strong>{(currentArch.profitProb * 100).toFixed(1)}%</strong>。
                  </div>
                </div>
              )}

              <div className="sec-lbl enter">
                <span>① 目标对决池 (点选 1~4 场想买的球)</span>
                <span className="num">已圈 {resolvedTargets.length} 场</span>
              </div>
              <div className="pool-scroll enter" style={{ marginBottom: 10 }}>
                {matches.map((m) => {
                  const on = resolvedTargets.some((x) => x.id === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      data-spring="0.88"
                      onClick={(e) => {
                        kickElement(e.currentTarget, 2.2);
                        haptic(6);
                        setTargetIds((prev) => {
                          const valid = matches
                            .filter((x) => prev.includes(x.id))
                            .map((x) => x.id);
                          if (valid.includes(m.id)) {
                            return valid.length > 1 ? valid.filter((k) => k !== m.id) : valid;
                          }
                          return valid.length >= 4
                            ? [...valid.slice(1), m.id]
                            : [...valid, m.id];
                        });
                      }}
                      className={`key pillk num ${on ? 'on' : ''}`}
                    >
                      {m.matchNumStr.slice(-3)} {m.home}vs{m.away}
                    </button>
                  );
                })}
              </div>

              <div className="card rows enter">
                <div className="row">
                  <span className="lbl">看球直觉倾向</span>
                  <div className="pass">
                    {(
                      [
                        ['objective', '纯客观'],
                        ['home-lean', '偏主队'],
                        ['upset-watch', '防爆冷'],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        data-spring="0.88"
                        onClick={() => {
                          haptic(6);
                          setStance(k);
                        }}
                        className={`key ${stance === k ? 'on' : ''}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {currentArch.key === 'value-assassin' && (
                  <div className="row">
                    <span className="lbl">36% 自动轻仓护本垫</span>
                    <SpringSwitch
                      checked={!unlockFullAgg}
                      onChange={(keepSafe) => setUnlockFullAgg(!keepSafe)}
                    />
                  </div>
                )}
              </div>

              {/* 4-KPI Detailed Archetype Overview */}
              <div className="card enter">
                <div className="co-head">
                  <div>
                    <div className="h2">
                      {currentArch.badge} · {currentArch.title}
                    </div>
                    <div className="small">{currentArch.tagline}</div>
                  </div>
                  <span className="chip num">
                    ¥{currentArch.totalCost}
                    {currentArch.savedCash > 0 && <i>省¥{currentArch.savedCash}</i>}
                  </span>
                </div>

                <div className="tiles num">
                  <div className="tile">
                    <span>真正赚钱率</span>
                    <b>{(currentArch.profitProb * 100).toFixed(1)}%</b>
                    <em>命中任一注 {(currentArch.winProb * 100).toFixed(1)}%</em>
                  </div>
                  <div className="tile">
                    <span>{currentArch.missOneReturn !== null ? '错1场保命回血' : '命中返奖区间'}</span>
                    <b>
                      {currentArch.missOneReturn !== null
                        ? `¥${currentArch.missOneReturn.toFixed(0)} (全中¥${currentArch.maxReturn.toFixed(0)})`
                        : `¥${currentArch.minReturn.toFixed(0)}~${currentArch.maxReturn.toFixed(0)}`}
                    </b>
                    <em>0 假中奖倒贴</em>
                  </div>
                  <div className="tile">
                    <span>综合暗扣抽水</span>
                    <b>-{currentArch.vigPct}%</b>
                    <em>返还率 {(100 - currentArch.vigPct).toFixed(1)}%</em>
                  </div>
                  <div className="tile">
                    <span>店面合票张数</span>
                    <b>{currentArch.lines.length} 张实票</b>
                    <em>已做整数倍配平</em>
                  </div>
                </div>
              </div>

              {/* Detailed Per-Ticket Breakdown with Odds & Probability */}
              {currentArch.lines.map((line) => (
                <div key={line.id} className="card opt-row enter">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b>
                      {line.legs
                        .map((g) => `${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`)
                        .join(' × ')}
                    </b>
                    <div className="s num">
                      {line.roleLabel} · {line.modeLabel} · 真率{(line.prob * 100).toFixed(1)}% ·{' '}
                      {line.multiple}倍(¥{line.cost})
                    </div>
                  </div>
                  <div className="r num">
                    ¥{line.returnPayout.toFixed(2)}
                    <small style={{ color: line.netProfit >= 0 ? 'var(--good)' : 'var(--text-3)' }}>
                      {line.netProfit >= 0
                        ? `全单净赚 +¥${line.netProfit.toFixed(1)}`
                        : `保命回血 ¥${line.returnPayout.toFixed(0)}`}
                    </small>
                  </div>
                </div>
              ))}

              <div className="note-box enter" style={{ marginBottom: 8 }}>
                <strong>精算师推导依据：</strong>
                {currentArch.reasons.map((r, idx) => (
                  <div key={idx}>· {r}</div>
                ))}
              </div>

              <button
                type="button"
                data-spring="0.94"
                className="key dark full enter"
                onClick={() => applyArchetype(currentArch)}
              >
                套用【{currentArch.shortTab}】方案并查看审单台 (¥{currentArch.totalCost})
              </button>
    </>
  ) : null;

  const auditContent = (
    <>
              {effectiveReport.matchCount === 0 ? (
                <div className="empty enter">
                  <div className="orb">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="3" y="4" width="18" height="16" rx="2.5" />
                      <line x1="12" y1="4" x2="12" y2="20" />
                      <circle cx="12" cy="12" r="2.8" />
                    </svg>
                  </div>
                  <button
                    type="button"
                    className="key dark sm"
                    data-spring="0.9"
                    onClick={() => {
                      setTab('archetypes');
                      setDkRightTab('archetypes');
                    }}
                  >
                    去五流派智能配单
                  </button>
                </div>
              ) : (
                <>
                  {/* 三模智能奖金优化器 (平均优化 / 博热保本 / 博冷高弹) */}
                  <div className="card enter">
                    <div className="co-head" style={{ marginBottom: 8 }}>
                      <span className="sec num" style={{ margin: 0 }}>
                        ⚖️ 智能奖金优化分倍器
                      </span>
                      <button
                        type="button"
                        className="help-pill"
                        onClick={() => openManual('optimizer')}
                      >
                        📘 优化原理图解
                      </button>
                    </div>
                    <div className="pass">
                      <button
                        type="button"
                        data-spring="0.88"
                        className={`key ${appliedPlan?.shortTab === '平均优化' ? 'on' : ''}`}
                        onClick={() => applyBonusOptimization('equal')}
                      >
                        ① 平均优化
                      </button>
                      <button
                        type="button"
                        data-spring="0.88"
                        className={`key ${appliedPlan?.shortTab === '博热保本' ? 'on' : ''}`}
                        onClick={() => applyBonusOptimization('hot-first')}
                      >
                        ② 博热保本
                      </button>
                      <button
                        type="button"
                        data-spring="0.88"
                        className={`key ${appliedPlan?.shortTab === '博冷高弹' ? 'on' : ''}`}
                        onClick={() => applyBonusOptimization('cold-first')}
                      >
                        ③ 博冷高弹
                      </button>
                      {appliedPlan && (
                        <button
                          type="button"
                          data-spring="0.88"
                          className="key"
                          onClick={() => {
                            setAppliedPlan(null);
                            showSpringToast(layerRef.current, '已恢复默认等倍统配');
                          }}
                        >
                          还原等倍
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Selected Match Chips */}
                  {Array.from(new Set(picks.map((p) => p.matchId))).map((mid) => {
                    const mpicks = picks.filter((p) => p.matchId === mid);
                    const first = mpicks[0];
                    return (
                      <div key={mid} className="card enter">
                        <div className="co-head">
                          <div className="duo">
                            <TeamCrest name={first.home} size={20} />
                            <b>{first.home}</b>
                            <span className="sep">—</span>
                            <TeamCrest name={first.away} size={20} />
                            <b>{first.away}</b>
                          </div>
                          <button
                            type="button"
                            className="key mini"
                            data-spring="0.85"
                            onClick={() => {
                              setAppliedPlan(null);
                              setPicks((prev) => prev.filter((x) => x.matchId !== mid));
                              haptic(6);
                            }}
                          >
                            移除
                          </button>
                        </div>
                        <div className="chips">
                          {mpicks.map((v) => (
                            <span
                              key={`${v.poolCode}-${v.optionKey}`}
                              className="chip num"
                            >
                              {v.poolName}·{v.optionLabel}
                              <i>
                                @{v.odds.toFixed(2)} ({(v.fairProb * 100).toFixed(0)}%)
                              </i>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* Full 6-Tile Five-Dimension Truth Cockpit! */}
                  <div className="card enter">
                    <div className="sec num">
                      五维真相透视舱 · {effectiveReport.modeLabel} (总本金 ¥{effectiveReport.totalCost})
                    </div>
                    <div className="tiles num">
                      <div
                        className={`tile ${
                          effectiveReport.minPayout < effectiveReport.totalCost ? 'danger' : ''
                        }`}
                      >
                        <span>真实保底奖金</span>
                        <b>¥{effectiveReport.minPayout.toFixed(2)}</b>
                        <em className="strike">官网虚高 ¥{effectiveReport.maxPayout.toFixed(2)}</em>
                      </div>
                      <div className="tile">
                        <span>大概率到手落点</span>
                        <b>
                          ¥{effectiveReport.likelyRange[0].toFixed(0)}~
                          {effectiveReport.likelyRange[1].toFixed(0)}
                        </b>
                        <em>60%高概率命中带</em>
                      </div>
                      <div className="tile">
                        <span>真赚钱率 vs 命中率</span>
                        <b>
                          {(effectiveReport.realProfitProb * 100).toFixed(1)}% /{' '}
                          {(effectiveReport.anyWinProb * 100).toFixed(1)}%
                        </b>
                        <em>净利&gt;0 才算真赢</em>
                      </div>
                      <div
                        className={`tile ${effectiveReport.underwaterCount > 0 ? 'danger' : ''}`}
                      >
                        <span>假中奖倒贴检测</span>
                        <b>
                          {effectiveReport.underwaterCount > 0
                            ? `${effectiveReport.underwaterCount}/${effectiveReport.comboCount} 组亏钱`
                            : '0 假中奖'}
                        </b>
                        <em>
                          {effectiveReport.underwaterCount > 0
                            ? `占中奖率 ${(effectiveReport.underwaterShareOfWins * 100).toFixed(0)}%`
                            : '命中任一组均盈利'}
                        </em>
                      </div>
                      <div className="tile">
                        <span>暗扣抽水与等效水位</span>
                        <b>-{effectiveReport.avgVigLossPer100}%</b>
                        <em>
                          返{(effectiveReport.avgPayoutRatio * 100).toFixed(1)}% · 等效@
                          {effectiveReport.effectiveOdds.toFixed(2)}
                        </em>
                      </div>
                      <div className="tile">
                        <span>危险分与连黑预警</span>
                        <b>{effectiveReport.dangerScore}分</b>
                        <em>
                          连黑5次 {(insights.fiveLossStreakProb * 100).toFixed(0)}% · 仓位≤
                          {insights.recommendedBankrollPct}%
                        </em>
                      </div>
                    </div>
                  </div>

                  {/* Restored: +几元全保本弹性升级 + 合成单关提示 + 防坑/省钱/拖油瓶一键操作卡 */}
                  <div className="card enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="sec">防坑雷达 · 弹性保本 · 省钱动作</div>

                    {effectiveReport.underwaterCount > 0 && effectiveReport.effectiveOdds > 1.03 && (
                      <div className="note-box">
                        <strong>✨ 弹性全保本升级方案：</strong>
                        受 2 元整数倍影响，当前统买 {multiple} 倍存在{' '}
                        {effectiveReport.underwaterCount} 种假中奖亏钱；启用不等倍配平（预计约 ¥
                        {effectiveReport.breakevenUpgradeCost ?? effectiveReport.totalCost + 6}
                        ）即可实现 <strong>100% 组合零亏损保本</strong>！
                        <div className="note-act">
                          <button
                            type="button"
                            data-spring="0.88"
                            className="key mini dark"
                            onClick={upgradeToZeroUnderwater}
                          >
                            一键配平 100% 全保本
                          </button>
                        </div>
                      </div>
                    )}

                    {effectiveReport.syntheticHint && (
                      <div className="note-box">
                        <strong>💡 合成单关参谋：</strong>
                        {effectiveReport.syntheticHint}
                      </div>
                    )}

                    {insights.activeSwapTip && picks[0] && (
                      <div className="note-box">
                        <strong>💰 同义买法省钱差价 (+{insights.activeSwapTip.edgePct}%)：</strong>
                        {insights.activeSwapTip.detail}
                        <div className="note-act">
                          <button
                            type="button"
                            data-spring="0.88"
                            className="key mini dark"
                            onClick={() => {
                              const fm = matches.find((x) => x.id === picks[0].matchId);
                              if (fm) {
                                togglePick(
                                  null,
                                  fm,
                                  insights.activeSwapTip!.poolCode,
                                  insights.activeSwapTip!.optionKey
                                );
                                showSpringToast(layerRef.current, '已加入高水同义项');
                              }
                            }}
                          >
                            选用 {insights.activeSwapTip.betterChoice}
                          </button>
                        </div>
                      </div>
                    )}

                    {insights.weakestLink && (
                      <div className="note-box alert">
                        <strong>💣 串关“拖油瓶”敏感度体检：</strong>
                        {insights.weakestLink.message}
                        <div className="note-act">
                          <button
                            type="button"
                            data-spring="0.88"
                            className="key mini dark"
                            onClick={() => {
                              setAppliedPlan(null);
                              setPicks((prev) =>
                                prev.filter((x) => x.matchId !== insights.weakestLink!.matchId)
                              );
                              showSpringToast(layerRef.current, '已砍掉拖后腿场次');
                            }}
                          >
                            一键砍掉此场
                          </button>
                        </div>
                      </div>
                    )}

                    {effectiveReport.warnings.map((w) => (
                      <div key={w.id} className="note-box alert">
                        <strong>{w.title}：</strong>
                        {w.detail}
                      </div>
                    ))}
                  </div>

                  {/* Restored Full 4-Row Staggered Kickoff Hedge Calculator */}
                  <div className="card rows enter">
                    <div className="row">
                      <div>
                        <div className="lbl" style={{ fontWeight: 600, color: 'var(--text)' }}>
                          ⏰ 早晚场时间差对冲锁利
                        </div>
                        <div className="small num">
                          {insights.hedge.available
                            ? `${insights.hedge.earlyKickoff} 串 ${insights.hedge.lateKickoff} (间隔 ${insights.hedge.gapText})`
                            : insights.hedge.reason}
                        </div>
                      </div>
                      {insights.hedge.available && (
                        <SpringSwitch checked={simHedgeHit} onChange={setSimHedgeHit} />
                      )}
                    </div>
                    {insights.hedge.available && simHedgeHit && (
                      <>
                        <div className="row num" style={{ fontSize: 12 }}>
                          <span className="lbl">假设早场已红，晚场反向补单</span>
                          <b>
                            {insights.hedge.oppositeLabel} @{insights.hedge.oppositeOdds.toFixed(2)}
                          </b>
                        </div>
                        <div className="row num" style={{ fontSize: 12 }}>
                          <span className="lbl">需去店里补买对冲本金</span>
                          <b>¥{insights.hedge.hedgeCost} 元</b>
                        </div>
                        <div className="row num" style={{ fontSize: 12 }}>
                          <span className="lbl">无视凌晨赛果 100% 锁死结果</span>
                          <b style={{ color: 'var(--good)' }}>
                            {insights.hedge.lockedNetProfit >= 0
                              ? `稳赚净利 +¥${insights.hedge.lockedNetProfit.toFixed(2)}`
                              : `保本锁回 ¥${(effectiveReport.totalCost + insights.hedge.lockedNetProfit).toFixed(0)}`}
                          </b>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Restored: 推演沙盒 (主观信心微调滑块 + 模拟比赛延期腰斩按1.0计奖 + 倍数步进) */}
                  <div className="card rows enter">
                    <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span className="lbl">主观胜率信心微调沙盒</span>
                        <span className="num" style={{ fontWeight: 600 }}>
                          {subjectiveDeltaPct > 0 ? `+${subjectiveDeltaPct}%` : `${subjectiveDeltaPct}%`} · 期望EV{' '}
                          <b style={{ color: subjectiveEVPct >= 0 ? 'var(--good)' : 'var(--text-2)' }}>
                            {subjectiveEVPct >= 0 ? `+${subjectiveEVPct.toFixed(1)}%` : `${subjectiveEVPct.toFixed(1)}%`}
                          </b>
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-15}
                        max={20}
                        step={1}
                        value={subjectiveDeltaPct}
                        onChange={(e) => setSubjectiveDeltaPct(Number(e.target.value))}
                        className="srange"
                      />
                    </div>

                    <div className="row">
                      <div>
                        <div className="lbl">模拟首场延期/腰斩 (按水位1.0算)</div>
                        <div className="small">预演极端赛事取消时的剩余串关派奖</div>
                      </div>
                      <SpringSwitch
                        checked={simVoidFirstMatch}
                        onChange={setSimVoidFirstMatch}
                      />
                    </div>

                    {!appliedPlan && (
                      <div className="row">
                        <span className="lbl">统配倍数 (单票上限99倍)</span>
                        <div className="stepper">
                          <button
                            type="button"
                            className="key sq"
                            data-spring="0.82"
                            onClick={() => stepMultiple(-1)}
                          >
                            −
                          </button>
                          <span ref={mulValRef} className="num mv">
                            {multiple}
                          </span>
                          <button
                            type="button"
                            className="key sq"
                            data-spring="0.82"
                            onClick={() => stepMultiple(1)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Restored: 全赛果组合盈亏推演明细表 (四舍六入五成双逐行展开！) */}
                  <div className="card enter">
                    <div className="sec-lbl" style={{ margin: '0 0 6px' }}>
                      <span>全赛果组合盈亏推演明细 (四舍六入五成双)</span>
                      <span className="num">共 {effectiveReport.combos.length} 组</span>
                    </div>
                    <div className="combo-list num">
                      {effectiveReport.combos.map((c) => (
                        <div
                          key={c.id}
                          className={`combo-item ${c.isUnderwater ? 'uw' : ''}`}
                        >
                          <div className="cdesc">
                            <b title={c.desc}>{c.desc}</b>
                            <small>
                              发生真率 {(c.prob * 100).toFixed(1)}% · 单倍 ¥{c.unitPayout.toFixed(2)} ·
                              实派 ¥{c.totalPayout.toFixed(2)}
                            </small>
                          </div>
                          <div className={`cpnl ${c.isUnderwater ? 'neg' : 'pos'}`}>
                            {c.netProfit >= 0
                              ? `+¥${c.netProfit.toFixed(2)}`
                              : `-¥${Math.abs(c.netProfit).toFixed(2)}`}
                            <small>{c.isUnderwater ? '假中奖倒贴' : '净盈利'}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Checkout Save Actions */}
                  <div className="card total enter">
                    <div>
                      <div className="num big">¥{effectiveReport.totalCost}</div>
                      <div className="num small">
                        店面合票 {effectiveReport.consolidatedTickets} 张 · 可一键打钩核对
                      </div>
                    </div>
                    <div className="acts">
                      <button
                        type="button"
                        className="key wide2"
                        data-spring="0.9"
                        onClick={() => recordToLedger('paper')}
                      >
                        存模拟单
                      </button>
                      <button
                        type="button"
                        className="key dark wide2"
                        data-spring="0.9"
                        onClick={() => recordToLedger('live')}
                      >
                        记入实买
                      </button>
                    </div>
                  </div>
                </>
              )}
    </>
  );

  const ledgerContent = (
    <>
              {/* Sync Diff Battle Report */}
              <div className="card enter">
                <div className="sec num">官网水位同步战报 · {syncClock}</div>
                <div className="note-box">{syncSummary}</div>
              </div>

              {/* 扫地僧小高靶向排雷全列表 + 实时在线诊盘 */}
              <div className="sec-lbl enter">
                <span>扫地僧小高靶向排雷 · 临场风控</span>
                <span className="num">点击任一场可实时诊盘</span>
              </div>
              <div className="card enter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  type="text"
                  value={customIntelInput}
                  onChange={(e) => setCustomIntelInput(e.target.value)}
                  placeholder="可选：粘贴你看到的赛前突发伤停/轮换消息交由小高研判..."
                  style={{
                    width: '100%',
                    height: 32,
                    padding: '0 10px',
                    fontSize: 11.5,
                    borderRadius: 'var(--key-r)',
                    border: '1px solid var(--line)',
                    background: 'var(--tile)',
                    color: 'var(--text)',
                    outline: 'none',
                  }}
                />
                <div className="pool-scroll">
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-spring="0.88"
                      onClick={() => void triggerXiaoGaoLive(m, customIntelInput || undefined)}
                      className={`key pillk num ${diagnosingMatchId === m.id ? 'on' : ''}`}
                    >
                      {diagnosingMatchId === m.id
                        ? `小高诊盘中...`
                        : `诊:${m.matchNumStr.slice(-3)} ${m.home}`}
                    </button>
                  ))}
                </div>
              </div>
              {matches
                .filter((m) => m.aiAlert)
                .map((m) => (
                  <div key={m.id} className="card enter" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="co-head" style={{ marginBottom: 0 }}>
                      <div className="duo">
                        <TeamCrest name={m.home} size={18} />
                        <b>
                          {m.matchNumStr} {m.home} vs {m.away}
                        </b>
                      </div>
                      <span className="qpill warn">{m.aiAlert!.tag}</span>
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-2)' }}>
                      {m.aiAlert!.summary}
                    </div>
                    <div className="small num" style={{ color: 'var(--mark)', fontWeight: 600 }}>
                      Price-In 消化度：{m.aiAlert!.priceInStatus}
                      {m.aiAlert!.suggestedDelta ? ` · ${m.aiAlert!.suggestedDelta}` : ''}
                    </div>
                    <div className="small">{m.aiAlert!.source}</div>
                  </div>
                ))}

              {/* Stop-Loss Guardrail Balance */}
              <div className="card bal enter">
                <span className="lbl">今日剩余止损护栏额度 (超限建议转模拟单)</span>
                <span ref={balValRef} className="v num">
                  ¥{dailyRemain}.00
                </span>
              </div>

              {/* Personal Strength/Weakness Checkup */}
              <div className="card stats enter">
                <div>
                  <b className="num">+19.4%</b>
                  <span>2串1博胆舒适区</span>
                </div>
                <div>
                  <b className="num">-62.0%</b>
                  <span>4串1长串亏损源</span>
                </div>
                <div>
                  <b className="num">¥120</b>
                  <span>模拟单累计免损</span>
                </div>
              </div>

              {/* 8 Skins Swatch Picker */}
              <div className="sec-lbl enter">
                <span>视觉皮肤切换 (8 套材质与专属弹簧阻尼)</span>
                <span className="num">{SKINS.find((s) => s.id === skin)?.name}</span>
              </div>
              <div className="card skins enter">
                {SKINS.map((sk) => (
                  <button
                    key={sk.id}
                    type="button"
                    data-spring="0.86"
                    onClick={(e) => {
                      kickElement(e.currentTarget, 2.8);
                      switchSkinSmooth(sk.id);
                    }}
                    className={`sk ${sk.id === skin ? 'on' : ''}`}
                  >
                    <i
                      style={
                        {
                          background: sk.swatchBg,
                          '--sw-dot': sk.swatchDot,
                        } as React.CSSProperties
                      }
                    />
                    <span>{sk.name}</span>
                  </button>
                ))}
              </div>

              {/* Dual-Track Ledger History */}
              <div className="sec-lbl enter">
                <span>实买真金单 / 0成本模拟单双轨账本</span>
              </div>
              {ledgerItems.map((it) => (
                <div key={it.id} className="card opt-row enter">
                  <div>
                    <b>{it.title}</b>
                    <div className="s">{it.kind === 'live' ? '实买真金单' : '0成本防上头模拟观察单'}</div>
                  </div>
                  <span className="r num">{it.tag}</span>
                </div>
              ))}
    </>
  );

  const overlayLayerNode = (
        <div ref={layerRef} className="layer">
          {/* Sheet 1: 全玩法 (总进球 / 半全场 / 比分，每个格子均展示去水真实胜率 %！) */}
          <SpringSheet
            open={sheet?.type === 'more' && Boolean(sheetMatch)}
            onClose={() => setSheet(null)}
          >
            {sheetMatch && (
              <>
                <div className="sh-head">
                  <div className="duo">
                    <TeamCrest name={sheetMatch.home} size={20} />
                    <b>{sheetMatch.home}</b>
                    <span className="sep">—</span>
                    <TeamCrest name={sheetMatch.away} size={20} />
                    <b>{sheetMatch.away}</b>
                  </div>
                  <button
                    type="button"
                    className="key dark sm"
                    data-spring="0.88"
                    onClick={() => setSheet(null)}
                  >
                    确定
                  </button>
                </div>

                <div className="sec num">
                  总进球 · 单关 (返还率 {(sheetMatch.pools.TTG.payoutRatio * 100).toFixed(1)}% · 抽水{' '}
                  {(sheetMatch.pools.TTG.vig * 100).toFixed(1)}%)
                </div>
                <div className="grid-keys c4 pop">
                  {sheetMatch.pools.TTG.options.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      data-spring="0.86"
                      onClick={(e) => togglePick(e.currentTarget, sheetMatch, 'TTG', opt.key)}
                      className={`key cell num ${isPicked(sheetMatch.id, 'TTG', opt.key) ? 'on' : ''}`}
                    >
                      <small>
                        {opt.label} · {(opt.fairProb * 100).toFixed(0)}%
                      </small>
                      <b>{opt.odds.toFixed(2)}</b>
                    </button>
                  ))}
                </div>

                <div className="sec num" style={{ marginTop: 16 }}>
                  半全场 · 单关 (返还率 {(sheetMatch.pools.HAFU.payoutRatio * 100).toFixed(1)}% · 抽水{' '}
                  {(sheetMatch.pools.HAFU.vig * 100).toFixed(1)}%)
                </div>
                <div className="grid-keys c3 pop">
                  {sheetMatch.pools.HAFU.options.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      data-spring="0.86"
                      onClick={(e) => togglePick(e.currentTarget, sheetMatch, 'HAFU', opt.key)}
                      className={`key cell num ${isPicked(sheetMatch.id, 'HAFU', opt.key) ? 'on' : ''}`}
                    >
                      <small>
                        {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                      </small>
                      <b>{opt.odds.toFixed(2)}</b>
                    </button>
                  ))}
                </div>

                <div className="sec-row">
                  <span className="sec num">
                    比分 · 单关 (抽水 {(sheetMatch.pools.CRS.vig * 100).toFixed(1)}%)
                  </span>
                  <SpringSegmented
                    small
                    options={[
                      ['win', '主胜'],
                      ['draw', '平'],
                      ['lose', '客胜'],
                    ]}
                    value={bfGrp}
                    onChange={(g) => {
                      setBfGrp(g);
                      requestAnimationFrame(() => popStagger(bfGridRef.current, 14));
                    }}
                    skinKey={skin}
                  />
                </div>
                <div ref={bfGridRef} className="grid-keys c4 pop">
                  {sheetMatch.pools.CRS.options
                    .filter((o) => {
                      const [h, a] = o.label.split(':').map(Number);
                      if (bfGrp === 'win') return h > a;
                      if (bfGrp === 'draw') return h === a;
                      return h < a;
                    })
                    .map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        data-spring="0.86"
                        onClick={(e) => togglePick(e.currentTarget, sheetMatch, 'CRS', opt.key)}
                        className={`key cell num ${isPicked(sheetMatch.id, 'CRS', opt.key) ? 'on' : ''}`}
                      >
                        <small>
                          {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                        </small>
                        <b>{opt.odds.toFixed(2)}</b>
                      </button>
                    ))}
                </div>
              </>
            )}
          </SpringSheet>

          {/* Sheet 2: 单场精算底牌全解剖 */}
          <SpringSheet
            open={sheet?.type === 'intel' && Boolean(sheetMatch)}
            onClose={() => setSheet(null)}
          >
            {sheetMatch && (() => {
              const mq = analyzeMatchMicroQuant(sheetMatch);
              const hP = (sheetMatch.pools.HAD.options[0]?.fairProb ?? 0.45) * 100;
              const dP = (sheetMatch.pools.HAD.options[1]?.fairProb ?? 0.27) * 100;
              const aP = (sheetMatch.pools.HAD.options[2]?.fairProb ?? 0.28) * 100;
              return (
                <>
                  <div className="sh-head">
                    <div className="duo">
                      <TeamCrest name={sheetMatch.home} size={20} />
                      <b>{sheetMatch.home}</b>
                      <span className="sep">—</span>
                      <TeamCrest name={sheetMatch.away} size={20} />
                      <b>{sheetMatch.away}</b>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="help-pill"
                        onClick={() => openManual('glossary')}
                      >
                        📘 名词图解
                      </button>
                      <button
                        type="button"
                        className="round-key"
                        style={{ width: 30, height: 30, fontSize: 12 }}
                        data-spring="0.86"
                        onClick={() => setSheet(null)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <SpringProbBar probs={[hP, dP, aP]} />

                  <div className="tiles pop num">
                    <div className="tile">
                      <span>精算师预期进球 (xG)</span>
                      <b>
                        {mq.homeXG} : {mq.awayXG}
                      </b>
                      <em>泊松反推合计 {mq.totalXG} 球</em>
                    </div>
                    <div className="tile">
                      <span>一球小胜卡盘温度计</span>
                      <b>{(mq.oneGoalShareOfWins * 100).toFixed(0)}%</b>
                      <em>半场闷平率 {(mq.halfDrawProb * 100).toFixed(0)}%</em>
                    </div>
                    <div className="tile">
                      <span>黄金总进球密集区</span>
                      <b>
                        {mq.topTwoGoals[0].replace('s', '')}~{mq.topTwoGoals[1].replace('s', '')}球
                      </b>
                      <em>合并真率 {(mq.topTwoGoals[2] * 100).toFixed(0)}%</em>
                    </div>
                    <div className="tile">
                      <span>各玩法暗扣抽水对比</span>
                      <b>主{(sheetMatch.pools.HAD.vig * 100).toFixed(1)}%</b>
                      <em>
                        半全{(sheetMatch.pools.HAFU.vig * 100).toFixed(1)}% · 进球
                        {(sheetMatch.pools.TTG.vig * 100).toFixed(1)}%
                      </em>
                    </div>
                    <div className="tile w" style={{ fontFamily: 'var(--font-ui)' }}>
                      <span>卡盘建议</span>
                      <b style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45 }}>
                        {mq.cardPanTip}
                      </b>
                    </div>
                    {mq.arbitrages.map((arb, idx) => (
                      <div key={idx} className="tile w" style={{ fontFamily: 'var(--font-ui)' }}>
                        <span>💰 同义买法省钱差价 (+{arb.edgePct}%)</span>
                        <b style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45 }}>
                          {arb.detail}
                        </b>
                        <div className="note-act">
                          <button
                            type="button"
                            data-spring="0.88"
                            className="key mini dark"
                            onClick={() => {
                              togglePick(null, sheetMatch, arb.poolCode, arb.optionKey);
                              setSheet(null);
                              showSpringToast(layerRef.current, `已选高水入口 ${arb.betterChoice}`);
                            }}
                          >
                            一键选用 {arb.betterChoice}
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="tile w" style={{ fontFamily: 'var(--font-ui)' }}>
                      <span>扫地僧小高靶向排雷 & 变盘鉴别</span>
                      <b style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.45 }}>
                        {sheetMatch.aiAlert
                          ? `${sheetMatch.aiAlert.summary}（${sheetMatch.aiAlert.priceInStatus}${sheetMatch.aiAlert.suggestedDelta ? ` · ${sheetMatch.aiAlert.suggestedDelta}` : ''} · ${sheetMatch.aiAlert.source}）`
                          : mq.steamSignal}
                      </b>
                      <div className="note-act">
                        <button
                          type="button"
                          data-spring="0.88"
                          className="key mini dark"
                          onClick={() => void triggerXiaoGaoLive(sheetMatch)}
                        >
                          {diagnosingMatchId === sheetMatch.id
                            ? '扫地僧小高推演中...'
                            : '请扫地僧小高实时排雷'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </SpringSheet>

          {/* Sheet 3: 3D 倾斜体彩店大字核对实票单 */}
          <SpringSheet
            open={sheet?.type === 'poster'}
            onClose={() => setSheet(null)}
            onAfterOpen={(sh) => bindTilt(sh.querySelector<HTMLElement>('.poster'))}
          >
            <div className="poster">
              <div className="p-top">
                <span>优竞体育内部专用 · 店面防错打票单 (点击逐行打钩)</span>
                <span className="num">{effectiveReport.modeLabel}</span>
              </div>
              <div className="p-amt num">合计应付 ¥{effectiveReport.totalCost}</div>

              {(appliedPlan
                ? appliedPlan.lines.map((l) => ({
                    key: l.id,
                    left: l.legs
                      .map((g) => `${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}]`)
                      .join('×'),
                    right: `${l.modeLabel} · ${l.multiple}倍 (¥${l.cost})`,
                  }))
                : picks.map((p) => ({
                    key: `${p.matchId}-${p.poolCode}-${p.optionKey}`,
                    left: `${p.matchNumStr} ${p.home}vs${p.away}`,
                    right: `${p.poolName}[${p.optionLabel}] × ${multiple}倍`,
                  }))
              ).map((row) => {
                const done = Boolean(checkedPosterLines[row.key]);
                return (
                  <div
                    key={row.key}
                    onClick={() => {
                      haptic(6);
                      setCheckedPosterLines((prev) => ({ ...prev, [row.key]: !done }));
                    }}
                    className={`p-line num ${done ? 'done' : ''}`}
                  >
                    <span>
                      {done ? '✓ ' : '□ '}
                      {row.left}
                    </span>
                    <span>{row.right}</span>
                  </div>
                );
              })}

              <div className="p-foot">
                <span className="num">
                  保底 ¥{effectiveReport.minPayout.toFixed(2)} · 真赚率{' '}
                  {(effectiveReport.realProfitProb * 100).toFixed(1)}%
                </span>
                <div className="qr">
                  {Array.from({ length: 49 }, (_, i) => (
                    <i
                      key={i}
                      className={
                        (i * 37 + 11) % 7 > 2 && ![8, 12, 36, 40].includes(i) ? '' : 'o'
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="key dark full"
              data-spring="0.94"
              onClick={() => {
                showSpringToast(layerRef.current, '实票已全部核对无误');
                setSheet(null);
              }}
            >
              核对完毕
            </button>
          </SpringSheet>

          {/* Sheet 4: 联赛筛选 */}
          <SpringSheet open={sheet?.type === 'filter'} onClose={() => setSheet(null)}>
            <div className="sh-head">
              <span className="h2">筛选赛事联赛</span>
              <button
                type="button"
                className="key dark sm"
                data-spring="0.88"
                onClick={() => setSheet(null)}
              >
                确定
              </button>
            </div>
            <div className="grid-keys c3 pop">
              {allLeagues.map((lg) => {
                const on = Boolean(leagueFilter[lg]);
                return (
                  <button
                    key={lg}
                    type="button"
                    data-spring="0.86"
                    onClick={(e) => {
                      kickElement(e.currentTarget, on ? -1.3 : 2.5);
                      haptic(6);
                      setLeagueFilter((prev) => ({ ...prev, [lg]: !on }));
                    }}
                    className={`key cell ${on ? 'on' : ''}`}
                  >
                    <b>{lg}</b>
                  </button>
                );
              })}
            </div>
          </SpringSheet>
        </div>
  );

  // ==================== DESKTOP WIDE-SCREEN PRO WORKBENCH (>= 960px) ====================
  if (isDesktop && !embedded) {
    return (
      <div className="jz-root">
        <div ref={shellRef} className="jz-desktop">
          {/* Desktop Top Command Bar */}
          <header className="dk-topbar">
            <div className="dk-brand">
              <div className="dk-brand-mark">优竞</div>
              <div>
                <h1>优竞体育内部专用</h1>
                <p className="num">
                  智能精算与风控工作台 · 实盘 {visibleMatches.length} 场 · 同步 {syncClock}
                </p>
              </div>
            </div>

            <div className="dk-skin-bar" title="切换 8 套触感材质皮肤">
              {SKINS.map((sk) => (
                <button
                  key={sk.id}
                  type="button"
                  onClick={() => switchSkinSmooth(sk.id)}
                  className={`dk-skin-pill ${sk.id === skin ? 'on' : ''}`}
                >
                  <i style={{ background: sk.swatchBg }} />
                  <span>{sk.name}</span>
                </button>
              ))}
            </div>

            <div className="dk-actions">
              <button
                type="button"
                data-spring="0.9"
                className="key sm"
                onClick={() => void runOfficialSync(true)}
              >
                <svg
                  className={syncing ? 'spin' : ''}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 12a9 9 0 0 0-15.5-6.36L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 15.5 6.36L21 16" />
                  <path d="M16 16h5v5" />
                </svg>
                <span>同步水位</span>
              </button>
              <button
                type="button"
                data-spring="0.9"
                className="key sm dark"
                onClick={() => openManual('optimizer')}
              >
                📘 图文说明书
              </button>
              {effectiveReport.matchCount > 0 && (
                <button
                  type="button"
                  data-spring="0.9"
                  className="key sm"
                  onClick={() => setSheet({ type: 'poster' })}
                >
                  🧾 防错打票单
                </button>
              )}
              {onOpenStage && (
                <button
                  type="button"
                  data-spring="0.9"
                  className="key sm"
                  onClick={onOpenStage}
                  title="查看 8 套手机皮肤同屏对比陈列墙"
                >
                  📱 8皮肤墙
                </button>
              )}
            </div>
          </header>

          {/* 3-Column Simultaneous Desktop Workspace */}
          <div className="dk-workspace">
            {/* Column 1: 赛事雷达与全盘矩阵 */}
            <section className="dk-col">
              <div className="dk-col-head">
                <div className="dk-col-head-row">
                  <span className="dk-col-title">
                    📡 赛事雷达 · 全盘矩阵
                    <button
                      type="button"
                      className="help-pill"
                      onClick={() => openManual('glossary')}
                    >
                      ? 抽水与真率图解
                    </button>
                  </span>
                  <button
                    type="button"
                    className="key mini"
                    onClick={() => setSheet({ type: 'filter' })}
                  >
                    筛选联赛
                  </button>
                </div>
                <SpringSegmented options={MODE_OPTS} value={mode} onChange={setMode} skinKey={skin} />
                {filterStripNode}
              </div>
              <div className="dk-col-scroll">{matchContent}</div>
            </section>

            {/* Column 2: 五维审单锁利 & 三模奖金优化 */}
            <section className="dk-col">
              <div className="dk-col-head">
                <div className="dk-col-head-row" style={{ marginBottom: 0 }}>
                  <span className="dk-col-title">
                    🛡️ 五维审单锁利 · 奖金优化台
                    <button
                      type="button"
                      className="help-pill"
                      onClick={() => openManual('hedge')}
                    >
                      ? 锁利对冲图解
                    </button>
                  </span>
                  {picks.length > 0 && (
                    <button
                      type="button"
                      className="key mini"
                      onClick={() => {
                        setAppliedPlan(null);
                        setPicks([]);
                      }}
                    >
                      清空已选
                    </button>
                  )}
                </div>
              </div>
              <div className="dk-col-scroll">{auditContent}</div>
            </section>

            {/* Column 3: 五流派智能配单 & 扫地僧小高排雷账本 */}
            <section className="dk-col dk-col-right">
              <div className="dk-col-head">
                <div className="dk-col-head-row">
                  <SpringSegmented
                    options={[
                      ['archetypes', '🎯 五流派智能推荐'],
                      ['ledger', '🧹 小高排雷与账本'],
                    ]}
                    value={dkRightTab}
                    onChange={setDkRightTab}
                    skinKey={skin}
                  />
                  <button
                    type="button"
                    className="help-pill"
                    onClick={() => openManual(dkRightTab === 'archetypes' ? 'archetypes' : 'xiaogao')}
                  >
                    ? 说明
                  </button>
                </div>
                {dkRightTab === 'archetypes' && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                      }}
                    >
                      <span className="small">目标投入预算档位</span>
                      <div style={{ display: 'flex', gap: 5 }}>
                        {[50, 100, 200, 500].map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setBudget(b)}
                            className={`key mini num ${budget === b ? 'on' : ''}`}
                          >
                            ¥{b}
                          </button>
                        ))}
                      </div>
                    </div>
                    <SpringSegmented
                      options={ARCH_OPTS}
                      value={archKey}
                      onChange={setArchKey}
                      skinKey={skin}
                    />
                  </>
                )}
              </div>
              <div className="dk-col-scroll">
                {dkRightTab === 'archetypes' ? archetypesContent : ledgerContent}
              </div>
            </section>
          </div>

          {overlayLayerNode}
          <UserManualModal
            open={manualOpen}
            initialSection={manualSection}
            onClose={() => setManualOpen(false)}
          />
        </div>
      </div>
    );
  }

  // ==================== MOBILE FULL-BLEED WEB APP (< 960px or embedded) ====================
  return (
    <div className={`jz-root ${embedded ? 'embed' : ''}`}>
      <div ref={shellRef} className="shell">
        {/* Fake Status Bar only inside 8-skin showcase iframes */}
        {embedded && (
          <div className="sbar num">
            <span>21:06</span>
            <div className="sbar-i">
              <span style={{ fontSize: 10.5, opacity: 0.72, marginRight: 4 }}>距22:00停售 54m</span>
              <svg width="15" height="11" viewBox="0 0 16 12" fill="currentColor">
                <rect x="1" y="7" width="2.2" height="4" rx=".8" />
                <rect x="4.5" y="5" width="2.2" height="6" rx=".8" />
                <rect x="8" y="3" width="2.2" height="8" rx=".8" />
                <rect x="11.5" y="1" width="2.2" height="10" rx=".8" />
              </svg>
              <svg width="20" height="11" viewBox="0 0 22 12" fill="none">
                <rect x="1" y="1.5" width="17" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="3" y="3.3" width="13" height="5.4" rx="1.2" fill="currentColor" />
                <path d="M19.5 4.2v3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        )}

        {/* Mobile Header */}
        <div className="top">
          {tab === 'match' && (
            <>
              <div className="title-row">
                <div style={{ minWidth: 0 }}>
                  <span className="h1">优竞体育内部专用</span>
                  <span className="sub num">
                    实盘 {visibleMatches.length} 场 · 同步 {syncClock.slice(0, 5)}
                  </span>
                </div>
                <div className="hdr-acts">
                  <button
                    type="button"
                    className="key pillk dark"
                    data-spring="0.88"
                    onClick={() => openManual('quickstart')}
                  >
                    📘说明书
                  </button>
                  <button
                    type="button"
                    className="round-key"
                    data-spring="0.86"
                    title="手动同步中国体彩官网水位"
                    onClick={() => void runOfficialSync(true)}
                  >
                    <svg
                      className={syncing ? 'spin' : ''}
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 0 0-15.5-6.36L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 15.5 6.36L21 16" />
                      <path d="M16 16h5v5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="round-key"
                    data-spring="0.86"
                    title="筛选联赛"
                    onClick={() => setSheet({ type: 'filter' })}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                      <line x1="4" y1="7" x2="20" y2="7" />
                      <line x1="7" y1="12" x2="17" y2="12" />
                      <line x1="10" y1="17" x2="14" y2="17" />
                    </svg>
                  </button>
                </div>
              </div>
              <SpringSegmented options={MODE_OPTS} value={mode} onChange={setMode} skinKey={skin} />
              {filterStripNode}
            </>
          )}

          {tab === 'archetypes' && (
            <>
              <div className="title-row">
                <div>
                  <span className="h1">优竞体育内部专用</span>
                  <span className="sub num">选队精算 5 大流派战法</span>
                </div>
                <div className="hdr-acts">
                  <button
                    type="button"
                    className="help-pill"
                    onClick={() => openManual('archetypes')}
                  >
                    📘图解
                  </button>
                  {[50, 100, 200].map((b) => (
                    <button
                      key={b}
                      type="button"
                      data-spring="0.88"
                      onClick={() => {
                        haptic(5);
                        setBudget(b);
                      }}
                      className={`key mini num ${budget === b ? 'on' : ''}`}
                    >
                      ¥{b}
                    </button>
                  ))}
                </div>
              </div>
              <SpringSegmented options={ARCH_OPTS} value={archKey} onChange={setArchKey} skinKey={skin} />
            </>
          )}

          {tab === 'audit' && (
            <div className="title-row">
              <div>
                <span className="h1">优竞体育内部专用</span>
                <span className="sub num">五维审单 · 三模奖金优化 · 锁利</span>
              </div>
              <div className="hdr-acts">
                <button
                  type="button"
                  className="help-pill"
                  onClick={() => openManual('optimizer')}
                >
                  📘说明书
                </button>
                {effectiveReport.matchCount > 0 && (
                  <button
                    type="button"
                    data-spring="0.88"
                    className="key pillk dark"
                    onClick={() => setSheet({ type: 'poster' })}
                  >
                    店面核对卡
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'ledger' && (
            <div className="title-row">
              <div>
                <span className="h1">优竞体育内部专用</span>
                <span className="sub num">扫地僧小高排雷 · 止损账本 · 皮肤</span>
              </div>
              <div className="hdr-acts">
                <button
                  type="button"
                  className="help-pill"
                  onClick={() => openManual('xiaogao')}
                >
                  📘说明书
                </button>
                <button
                  type="button"
                  data-spring="0.88"
                  className="key pillk"
                  onClick={() => void runOfficialSync(true)}
                >
                  同步水位
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Scrollable Content */}
        <div ref={scrollRef} className="scroll">
          {tab === 'match' && matchContent}
          {tab === 'archetypes' && archetypesContent}
          {tab === 'audit' && auditContent}
          {tab === 'ledger' && ledgerContent}
        </div>

        {/* Floating Slip on Match Tab */}
        <div ref={slipRef} className="slip">
          <button
            type="button"
            className="slip-trash"
            data-spring="0.84"
            onClick={() => {
              setAppliedPlan(null);
              setPicks([]);
              haptic(14);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16" />
              <path d="M9 6V4h6v2" />
              <path d="M18 6l-.8 13H6.8L6 6" />
            </svg>
          </button>
          <div className="slip-info">
            <span ref={slipAmtRef} className="num slip-amt">
              ¥{effectiveReport.totalCost}
            </span>
            <span className="num slip-sub">
              {effectiveReport.underwaterCount > 0
                ? `保底¥${effectiveReport.minPayout.toFixed(1)} · ⚠️${effectiveReport.underwaterCount}注假中奖 · 真赚${(effectiveReport.realProfitProb * 100).toFixed(0)}%`
                : `保底¥${effectiveReport.minPayout.toFixed(1)}~${effectiveReport.maxPayout.toFixed(0)} · 真赚${(effectiveReport.realProfitProb * 100).toFixed(0)}%`}
            </span>
          </div>
          <button
            type="button"
            className="slip-go"
            data-spring="0.9"
            onClick={() => setTab('audit')}
          >
            {effectiveReport.underwaterCount > 0 ? '审单纠偏' : '五维审单'}
          </button>
        </div>

        {/* Bottom 4-Tab Dock */}
        <div className="dock">
          <nav ref={navRef} className="nav">
            <div ref={puckRef} className="nav-puck" />
            {(
              [
                [
                  'match',
                  '赛事雷达',
                  <svg key="m" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="12" y1="4" x2="12" y2="20"/><circle cx="12" cy="12" r="2.8"/></svg>,
                  false,
                ],
                [
                  'archetypes',
                  '五流派',
                  <svg key="a" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>,
                  false,
                ],
                [
                  'audit',
                  '审单锁利',
                  <svg key="u" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
                  effectiveReport.warnings.length > 0,
                ],
                [
                  'ledger',
                  '情报账本',
                  <svg key="l" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.8"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>,
                  false,
                ],
              ] as const
            ).map(([k, label, icon, hasDot]) => (
              <button
                key={k}
                type="button"
                data-spring="0.9"
                onClick={(e) => {
                  const ico = e.currentTarget.querySelector<HTMLElement>('.nav-ico');
                  if (ico) fxOf(ico).scale.config(520, 11).kick(4.2);
                  haptic(6);
                  setSheet(null);
                  setTab(k);
                }}
                className={`nav-b ${tab === k ? 'on' : ''}`}
              >
                <span className="nav-ico">
                  {icon}
                  {hasDot && <i className="nav-dot" />}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="home-ind">
            <i />
          </div>
        </div>

        {overlayLayerNode}
        <UserManualModal
          open={manualOpen}
          initialSection={manualSection}
          onClose={() => setManualOpen(false)}
        />
      </div>
    </div>
  );
}
