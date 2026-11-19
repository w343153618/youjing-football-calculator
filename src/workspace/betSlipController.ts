import {
  EMPTY_WORKSPACE_RESPONSE,
  type AppliedPlanSpec,
  type ArchetypePlan,
  type BonusOptMode,
  type EquivalentArbItem,
  type MatchItem,
  type PassSelectionSpec,
  type PoolCode,
  type QuantWorkspaceParams,
  type QuantWorkspaceResponse,
  type SelectedPick,
  type UserStance,
} from '../prototype/quantTypes.ts';

export type MatchMode = 'mix' | 'spf' | 'bf' | 'zjq' | 'bqc' | 'single';
export type PresetScenarioKind = 'underwater' | 'synthetic' | 'parlay4' | 'hedge2';

export interface BetSlipState {
  matches: MatchItem[];
  picks: SelectedPick[];
  mode: MatchMode;
  multiple: number;
  passSpec: PassSelectionSpec;
  planSpec: AppliedPlanSpec;
  subjectiveDeltaPct: number;
  simVoidFirstMatch: boolean;
  targetIds: string[];
  anchorToRadarPicks: boolean;
  syncedRadarSig: string;
  budget: number;
  stance: UserStance;
  unlockFullAgg: boolean;
  workspace: QuantWorkspaceResponse;
}

export interface TogglePickVerdict {
  ok: boolean;
  action?: 'added' | 'removed';
  optionLabel?: string;
  odds?: number;
  autoLockedSingleReason?: 'dual-single' | 'over-8-matches';
  blockedReason?: string;
}

export interface BetSlipControllerOptions {
  computeWorkspace: (
    params: QuantWorkspaceParams,
    matches: MatchItem[]
  ) => QuantWorkspaceResponse | Promise<QuantWorkspaceResponse>;
  debounceMs?: number;
  onOfflineNetworkError?: () => void;
  onComputeSuccess?: () => void;
}

export function buildRadarSignature(picks: SelectedPick[]): string {
  return picks
    .map((p) => `${p.matchId}:${p.poolCode}:${p.optionKey}`)
    .sort()
    .join('|');
}

function trimToSinglePoolPerMatch(picks: SelectedPick[]): {
  cleaned: SelectedPick[];
  trimmed: boolean;
} {
  const poolByMatch = new Map<string, PoolCode>();
  let trimmed = false;
  const cleaned = picks.filter((p) => {
    const firstPool = poolByMatch.get(p.matchId) ?? p.poolCode;
    poolByMatch.set(p.matchId, firstPool);
    if (p.poolCode !== firstPool) {
      trimmed = true;
      return false;
    }
    return true;
  });
  return { cleaned, trimmed };
}

function buildInitialState(): BetSlipState {
  return {
    matches: [],
    picks: [],
    mode: 'mix',
    multiple: 5,
    passSpec: { mode: 'auto' },
    planSpec: null,
    subjectiveDeltaPct: 0,
    simVoidFirstMatch: false,
    targetIds: [],
    anchorToRadarPicks: false,
    syncedRadarSig: '',
    budget: 100,
    stance: 'objective',
    unlockFullAgg: false,
    workspace: EMPTY_WORKSPACE_RESPONSE,
  };
}

function buildPresetPicks(matches: MatchItem[], kind: PresetScenarioKind): {
  multiple: number;
  picks: SelectedPick[];
} {
  if (kind === 'underwater') {
    const m1 = matches[0];
    const m2 = matches.find((x) => x.kickoff.startsWith('03:')) ?? matches[1];
    const out: SelectedPick[] = [];
    if (m1) {
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
    return { multiple: 5, picks: out };
  }

  if (kind === 'synthetic') {
    const m = matches.find((x) => !x.pools.HAD.single) ?? matches[0];
    if (!m) return { multiple: 10, picks: [] };
    const picks = ['hh', 'dh']
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
      .filter((x): x is SelectedPick => x !== null);
    return { multiple: 10, picks };
  }

  if (kind === 'parlay4') {
    const picks = matches
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
      .filter((x): x is SelectedPick => x !== null);
    return { multiple: 3, picks };
  }

  const mEarly = matches[0];
  const mLate =
    matches.find((x) => x.kickoff.startsWith('03:') || x.kickoff.startsWith('07:')) ??
    matches[matches.length - 1];
  if (!mEarly || !mLate) return { multiple: 15, picks: [] };
  const picks = [mEarly, mLate]
    .map((m): SelectedPick | null => {
      const pCode: PoolCode = m.pools.HAD.options.length > 0 ? 'HAD' : 'HHAD';
      const o = m.pools[pCode].options[0];
      if (!o) return null;
      return {
        matchId: m.id,
        matchNumStr: m.matchNumStr,
        home: m.home,
        away: m.away,
        poolCode: pCode,
        poolName: m.pools[pCode].name,
        singleAllowed: m.pools[pCode].single,
        optionKey: o.key,
        optionLabel: o.label,
        odds: o.odds,
        fairProb: o.fairProb,
      };
    })
    .filter((x): x is SelectedPick => x !== null);
  return { multiple: 15, picks };
}

/**
 * 选单工作区深模块（仅负责前端交互状态机与体彩选号互斥门禁；所有算奖、去水概率、优化与精算配单（3+1 帕累托体系）公式 100% 委托注入的工作区计算适配器执行）
 */
export function createBetSlipController(options: BetSlipControllerOptions) {
  const debounceMs = options.debounceMs ?? 18;
  const listeners = new Set<() => void>();
  let bootstrapped = false;
  let computeSeq = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolvers: Array<() => void> = [];
  let inFlightPromise: Promise<void> | null = null;

  let state: BetSlipState = buildInitialState();

  function emit() {
    for (const fn of listeners) fn();
  }

  function settlePendingResolvers() {
    if (pendingResolvers.length === 0) return;
    const list = pendingResolvers;
    pendingResolvers = [];
    for (const resolve of list) resolve();
  }

  function cancelPendingTimer() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    settlePendingResolvers();
  }

  function buildWorkspaceParams(s: BetSlipState = state): QuantWorkspaceParams {
    const clientAlerts: Record<string, NonNullable<MatchItem['aiAlert']>> = {};
    for (const m of s.matches) {
      if (m.aiAlert) clientAlerts[m.id] = m.aiAlert;
    }
    return {
      picks: s.picks,
      multiple: s.multiple,
      passSpec: s.passSpec,
      subjectiveDeltaPct: s.subjectiveDeltaPct,
      simVoidFirstMatch: s.simVoidFirstMatch,
      planSpec: s.planSpec,
      targetIds: s.targetIds,
      anchorToRadarPicks: s.anchorToRadarPicks,
      budget: s.budget,
      stance: s.stance,
      unlockFullAgg: s.unlockFullAgg,
      clientAlerts,
    };
  }

  function executeComputeNow(): Promise<void> {
    const seq = ++computeSeq;
    try {
      const maybePromise = options.computeWorkspace(buildWorkspaceParams(state), state.matches);
      if (maybePromise && typeof (maybePromise as Promise<QuantWorkspaceResponse>).then === 'function') {
        const p = (maybePromise as Promise<QuantWorkspaceResponse>)
          .then((ws) => {
            if (seq === computeSeq) {
              state = { ...state, workspace: ws };
              options.onComputeSuccess?.();
              emit();
            }
          })
          .catch((err) => {
            if (err instanceof TypeError) {
              options.onOfflineNetworkError?.();
            }
          })
          .finally(() => {
            if (inFlightPromise === p) inFlightPromise = null;
          });
        inFlightPromise = p;
        return p;
      }
      if (seq === computeSeq) {
        state = { ...state, workspace: maybePromise as QuantWorkspaceResponse };
        options.onComputeSuccess?.();
        emit();
      }
      return Promise.resolve();
    } catch (err) {
      if (err instanceof TypeError) {
        options.onOfflineNetworkError?.();
      }
      return Promise.resolve();
    }
  }

  function scheduleRefresh(): Promise<void> {
    if (!bootstrapped) return Promise.resolve();
    cancelPendingTimer();
    if (debounceMs <= 0) {
      return executeComputeNow();
    }
    return new Promise((resolve) => {
      pendingResolvers.push(resolve);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        void executeComputeNow().finally(() => {
          settlePendingResolvers();
        });
      }, debounceMs);
    });
  }

  function isAuthoritativePickSingle(pk: SelectedPick): boolean {
    const fm = state.matches.find((x) => x.id === pk.matchId);
    const pool = fm?.pools[pk.poolCode];
    return pool ? Boolean(pk.singleAllowed) && Boolean(pool.single) : Boolean(pk.singleAllowed);
  }

  function isPicked(matchId: string, poolCode: PoolCode, optKey: string): boolean {
    return state.picks.some(
      (p) => p.matchId === matchId && p.poolCode === poolCode && p.optionKey === optKey
    );
  }

  function isPoolMutexLocked(m: MatchItem, poolCode: PoolCode): boolean {
    const sameMatch = state.picks.filter((p) => p.matchId === m.id);
    if (sameMatch.length === 0) return false;
    const otherPools = sameMatch.filter((p) => p.poolCode !== poolCode);
    if (otherPools.length === 0) return false;
    if (state.mode !== 'spf' && state.mode !== 'single') return true;
    if (poolCode !== 'HAD' && poolCode !== 'HHAD') return true;
    if (otherPools.some((p) => p.poolCode !== 'HAD' && p.poolCode !== 'HHAD')) return true;
    const candPool = m.pools[poolCode];
    if (!candPool?.single) return true;
    return !state.picks.every(isAuthoritativePickSingle);
  }

  function applyAuthenticatedBundle(bundle: {
    matches: MatchItem[];
    initialPicks: SelectedPick[];
    workspace: QuantWorkspaceResponse;
  }) {
    cancelPendingTimer();
    bootstrapped = true;
    computeSeq += 1;
    state = {
      ...buildInitialState(),
      matches: bundle.matches,
      picks: bundle.initialPicks,
      targetIds: bundle.matches.slice(0, 2).map((m) => m.id),
      workspace: bundle.workspace,
    };
    emit();
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async flush(): Promise<void> {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
        await executeComputeNow();
        settlePendingResolvers();
        return;
      }
      if (inFlightPromise) {
        await inFlightPromise;
      }
    },
    buildWorkspaceParams: () => buildWorkspaceParams(state),
    isPicked,
    isPoolMutexLocked,
    getPickedMatchIds(): string[] {
      return Array.from(new Set(state.picks.map((p) => p.matchId)));
    },
    isRadarSyncCurrent(): boolean {
      const sig = buildRadarSignature(state.picks);
      return state.anchorToRadarPicks && sig.length > 0 && state.syncedRadarSig === sig;
    },

    applyAuthenticatedBundle,
    initializeMatches(
      matches: MatchItem[],
      initialPicks: SelectedPick[],
      workspace: QuantWorkspaceResponse
    ) {
      applyAuthenticatedBundle({ matches, initialPicks, workspace });
    },

    setBootstrapped(val: boolean) {
      bootstrapped = val;
      if (!val) {
        cancelPendingTimer();
        computeSeq += 1;
      }
    },

    applyMatchesSync(res: { matches: MatchItem[]; workspace: QuantWorkspaceResponse }) {
      cancelPendingTimer();
      bootstrapped = true;
      computeSeq += 1;

      const mergedMatches = res.matches.map((nm) => {
        if (nm.aiAlert) return nm;
        const prev = state.matches.find(
          (em) =>
            em.id === nm.id ||
            (Boolean(em.matchNumStr) && em.matchNumStr === nm.matchNumStr)
        );
        return prev?.aiAlert ? { ...nm, aiAlert: prev.aiAlert } : nm;
      });

      const validTargets = mergedMatches
        .filter((m) => state.targetIds.includes(m.id))
        .map((m) => m.id);
      const nextTargets =
        validTargets.length >= 1 ? validTargets : mergedMatches.slice(0, 2).map((m) => m.id);

      let picksRemapped = false;
      const syncedPicks = state.picks
        .map((pk) => {
          const um = mergedMatches.find(
            (m) =>
              m.id === pk.matchId ||
              (Boolean(m.matchNumStr) && m.matchNumStr === pk.matchNumStr)
          );
          const uo = um?.pools[pk.poolCode]?.options.find((o) => o.key === pk.optionKey);
          if (!um || !uo) {
            picksRemapped = true;
            return null;
          }
          const nextSingle = um.pools[pk.poolCode].single;
          if (um.id !== pk.matchId || uo.odds !== pk.odds || nextSingle !== pk.singleAllowed) {
            picksRemapped = true;
          }
          return {
            ...pk,
            matchId: um.id,
            odds: uo.odds,
            fairProb: uo.fairProb,
            singleAllowed: nextSingle,
          };
        })
        .filter((x): x is SelectedPick => x !== null);

      const targetsChanged =
        nextTargets.length !== state.targetIds.length ||
        nextTargets.some((id, idx) => id !== state.targetIds[idx]);

      state = {
        ...state,
        matches: mergedMatches,
        targetIds: nextTargets,
        picks: syncedPicks,
        workspace: res.workspace,
      };
      emit();

      if (picksRemapped || targetsChanged) {
        void scheduleRefresh();
      }
    },

    async applyMatchAiAlert(matchId: string, alert: NonNullable<MatchItem['aiAlert']>) {
      state = {
        ...state,
        matches: state.matches.map((item) =>
          item.id === matchId ? { ...item, aiAlert: alert } : item
        ),
      };
      emit();
      await scheduleRefresh();
    },

    async applyComboAiReport(rep: {
      level: 'high' | 'medium' | 'low';
      source: string;
      perMatch: Array<{
        matchId: string;
        matchTitle: string;
        tag: string;
        note: string;
        priceInStatus: string;
      }>;
    }) {
      if (!Array.isArray(rep?.perMatch) || rep.perMatch.length === 0) return;
      state = {
        ...state,
        matches: state.matches.map((item) => {
          const pm = rep.perMatch.find(
            (x) =>
              x.matchId === item.id ||
              (Boolean(item.matchNumStr) && x.matchId === item.matchNumStr) ||
              Boolean(
                item.matchNumStr && x.matchTitle && x.matchTitle.includes(item.matchNumStr)
              )
          );
          if (!pm) return item;
          return {
            ...item,
            aiAlert: {
              level: rep.level === 'high' ? 'high' : 'medium',
              tag: pm.tag,
              summary: pm.note,
              priceInStatus: pm.priceInStatus,
              source: rep.source,
            },
          };
        }),
      };
      emit();
      await scheduleRefresh();
    },

    togglePick(m: MatchItem, poolCode: PoolCode, optKey: string): TogglePickVerdict {
      const currentlyOn = isPicked(m.id, poolCode, optKey);
      if (currentlyOn) {
        const prevPick = state.picks.find(
          (p) => p.matchId === m.id && p.poolCode === poolCode && p.optionKey === optKey
        );
        state = {
          ...state,
          planSpec: null,
          picks: state.picks.filter(
            (p) => !(p.matchId === m.id && p.poolCode === poolCode && p.optionKey === optKey)
          ),
        };
        emit();
        void scheduleRefresh();
        return {
          ok: true,
          action: 'removed',
          optionLabel: prevPick?.optionLabel,
          odds: prevPick?.odds,
        };
      }

      const pool = m.pools[poolCode];
      const opt = pool?.options.find((o) => o.key === optKey);
      if (!pool || pool.selling === false || pool.options.length === 0 || !opt || opt.odds <= 0) {
        return { ok: false, blockedReason: '该玩法或选项当前暂未开售' };
      }

      const byMatchPools = new Map<string, Set<PoolCode>>();
      for (const p of state.picks) {
        const s = byMatchPools.get(p.matchId) ?? new Set<PoolCode>();
        s.add(p.poolCode);
        byMatchPools.set(p.matchId, s);
      }
      const existingHasCrossPool = Array.from(byMatchPools.values()).some((s) => s.size > 1);
      const existingDistinctCount = byMatchPools.size;
      const allSingleWithCand =
        state.picks.every(isAuthoritativePickSingle) && Boolean(pool.single);

      if ((existingHasCrossPool || existingDistinctCount > 8) && !pool.single) {
        return {
          ok: false,
          blockedReason: '当前选单已锁定【单关】模式，无法混入未开单关的选项！',
        };
      }

      let nextPassSpec = state.passSpec;
      let autoLockedSingleReason: TogglePickVerdict['autoLockedSingleReason'];

      const sameMatchOther = state.picks.filter(
        (p) => p.matchId === m.id && p.poolCode !== poolCode
      );
      if (sameMatchOther.length > 0) {
        const isSpfDualSinglePair =
          (state.mode === 'spf' || state.mode === 'single') &&
          allSingleWithCand &&
          (poolCode === 'HAD' || poolCode === 'HHAD') &&
          sameMatchOther.every((p) => p.poolCode === 'HAD' || p.poolCode === 'HHAD');

        if (!isSpfDualSinglePair) {
          return {
            ok: false,
            blockedReason:
              '同一场比赛只能选择一种玩法进行串关计算；如需改选其他玩法，请先取消本场已选项',
          };
        }
        nextPassSpec = { mode: 'free', passSizes: [1] };
        autoLockedSingleReason = 'dual-single';
      } else if (!byMatchPools.has(m.id) && existingDistinctCount >= 15) {
        return { ok: false, blockedReason: '单次选单最多不能超过 15 场赛事' };
      } else if (!byMatchPools.has(m.id) && existingDistinctCount >= 8) {
        if ((state.mode !== 'spf' && state.mode !== 'single') || !allSingleWithCand) {
          return { ok: false, blockedReason: '过关数量不能超过 8 场赛事' };
        }
        nextPassSpec = { mode: 'free', passSizes: [1] };
        autoLockedSingleReason = 'over-8-matches';
      }

      state = {
        ...state,
        planSpec: null,
        passSpec: nextPassSpec,
        picks: [
          ...state.picks,
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
        ],
      };
      emit();
      void scheduleRefresh();
      return {
        ok: true,
        action: 'added',
        optionLabel: opt.label,
        odds: opt.odds,
        autoLockedSingleReason,
      };
    },

    setMode(nextMode: MatchMode): { trimmed: boolean } {
      let nextPicks = state.picks;
      let nextPassSpec = state.passSpec;
      let trimmed = false;

      if (nextMode !== 'spf' && nextMode !== 'single') {
        const res = trimToSinglePoolPerMatch(state.picks);
        nextPicks = res.cleaned;
        trimmed = res.trimmed;
        if (trimmed) {
          nextPassSpec = { mode: 'auto' };
        }
      }

      state = {
        ...state,
        mode: nextMode,
        picks: nextPicks,
        passSpec: nextPassSpec,
      };
      emit();
      if (trimmed) void scheduleRefresh();
      return { trimmed };
    },

    clearPicks() {
      state = {
        ...state,
        picks: [],
        planSpec: null,
        passSpec: { mode: 'auto' },
      };
      emit();
      void scheduleRefresh();
    },

    removeMatchFromSlip(matchId: string) {
      state = {
        ...state,
        planSpec: null,
        picks: state.picks.filter((p) => p.matchId !== matchId),
      };
      emit();
      void scheduleRefresh();
    },

    replacePicks(nextPicks: SelectedPick[]) {
      state = {
        ...state,
        planSpec: null,
        passSpec: { mode: 'auto' },
        picks: nextPicks,
      };
      emit();
      void scheduleRefresh();
    },

    resetPassAuto() {
      state = {
        ...state,
        planSpec: null,
        passSpec: { mode: 'auto' },
      };
      emit();
      void scheduleRefresh();
    },

    setDirectMultiple(nextRaw: number): number {
      const clamped = Math.max(1, Math.min(999, Math.round(nextRaw) || 1));
      state = { ...state, planSpec: null, multiple: clamped };
      emit();
      void scheduleRefresh();
      return clamped;
    },

    stepMultiple(delta: number): number {
      const next = Math.max(1, Math.min(999, state.multiple + delta));
      state = { ...state, planSpec: null, multiple: next };
      emit();
      void scheduleRefresh();
      return next;
    },

    toggleFreePassSize(size: number): { ok: boolean; reason?: string } {
      const manualReport = state.workspace.manualReport;
      const opt = manualReport.availableFreePasses.find((f) => f.size === size);
      if (!opt || !opt.enabled) {
        return { ok: false, reason: opt?.disabledReason || '当前选单不满足该过关条件' };
      }
      const currentActive = manualReport.activeComboCode
        ? []
        : manualReport.availableFreePasses.filter((f) => f.active).map((f) => f.size);
      const exists = currentActive.includes(size);
      if (exists && currentActive.length <= 1) {
        return { ok: false, reason: '至少需保留一种过关方式' };
      }
      const nextSizes = exists
        ? currentActive.filter((s) => s !== size)
        : [...currentActive, size].sort((a, b) => a - b);
      state = {
        ...state,
        planSpec: null,
        passSpec: { mode: 'free', passSizes: nextSizes },
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    selectComboPass(code: string): { ok: boolean; reason?: string } {
      const manualReport = state.workspace.manualReport;
      const opt = manualReport.availableComboPasses.find((c) => c.code === code);
      if (!opt || !opt.enabled) {
        return { ok: false, reason: opt?.disabledReason || '当前选单不可选该多串组合' };
      }
      const nextSpec: PassSelectionSpec =
        manualReport.activeComboCode === code ? { mode: 'auto' } : { mode: 'combo', comboCode: code };
      state = {
        ...state,
        planSpec: null,
        passSpec: nextSpec,
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    applyBonusOptimization(optMode: BonusOptMode): { ok: boolean; modeTitle?: string } {
      if (state.workspace.manualReport.combos.length === 0) return { ok: false };
      state = {
        ...state,
        planSpec: { kind: 'bonus', optMode, scaleMultiple: 1 },
      };
      emit();
      void scheduleRefresh();
      const modeTitle =
        optMode === 'equal' ? '平均优化' : optMode === 'hot-first' ? '博热保本' : '博冷高弹';
      return { ok: true, modeTitle };
    },

    applyArchetype(plan: ArchetypePlan): boolean {
      if (!plan || plan.available === false || !Array.isArray(plan.lines) || plan.lines.length === 0) {
        return false;
      }
      const primaryPoolByMatch = new Map<string, PoolCode>();
      const map = new Map<string, SelectedPick>();
      plan.lines.forEach((l) =>
        l.legs.forEach((lg) => {
          const chosenPool = primaryPoolByMatch.get(lg.matchId) ?? lg.poolCode;
          primaryPoolByMatch.set(lg.matchId, chosenPool);
          if (lg.poolCode !== chosenPool) return;
          const fm = state.matches.find((x) => x.id === lg.matchId);
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
      const boardIndex = new Map<string, number>();
      state.matches.forEach((m, idx) => boardIndex.set(m.id, idx));
      const orderedPicks = Array.from(map.values()).sort((a, b) => {
        const ia = boardIndex.get(a.matchId) ?? Number.MAX_SAFE_INTEGER;
        const ib = boardIndex.get(b.matchId) ?? Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
      state = {
        ...state,
        planSpec: { kind: 'archetype', key: plan.key, snapshotPlan: plan, scaleMultiple: 1 },
        simVoidFirstMatch: false,
        subjectiveDeltaPct: 0,
        picks: orderedPicks,
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    restoreEqualMultiple() {
      const { cleaned } = trimToSinglePoolPerMatch(state.picks);
      state = { ...state, planSpec: null, picks: cleaned };
      emit();
      void scheduleRefresh();
    },

    scaleAppliedPlanBy(factor: number) {
      if (!state.planSpec) return;
      const nextScale = Math.max(
        1,
        Math.min(50, Math.round((state.planSpec.scaleMultiple ?? 1) * factor))
      );
      state = {
        ...state,
        planSpec: { ...state.planSpec, scaleMultiple: nextScale },
      };
      emit();
      void scheduleRefresh();
    },

    applyEquivalentSwap(arb: EquivalentArbItem): boolean {
      const fm = state.matches.find((x) => x.id === arb.matchId);
      if (!fm) return false;
      const targetPools = new Set(arb.betterPicks.map((bp) => bp.poolCode));
      const cleaned = state.picks.filter(
        (p) =>
          !(
            p.matchId === fm.id &&
            (!targetPools.has(p.poolCode) ||
              arb.worsePicks.some(
                (wp) => wp.poolCode === p.poolCode && wp.optionKey === p.optionKey
              ))
          )
      );
      const additions: SelectedPick[] = [];
      for (const bp of arb.betterPicks) {
        const already = cleaned.some(
          (p) => p.matchId === fm.id && p.poolCode === bp.poolCode && p.optionKey === bp.optionKey
        );
        if (already) continue;
        const pool = fm.pools[bp.poolCode];
        const opt = pool?.options.find((o) => o.key === bp.optionKey);
        if (!pool || !opt) continue;
        additions.push({
          matchId: fm.id,
          matchNumStr: fm.matchNumStr,
          home: fm.home,
          away: fm.away,
          poolCode: bp.poolCode,
          poolName: pool.name,
          singleAllowed: pool.single,
          optionKey: opt.key,
          optionLabel: opt.label,
          odds: opt.odds,
          fairProb: opt.fairProb,
        });
      }
      state = {
        ...state,
        planSpec: null,
        picks: [...cleaned, ...additions],
      };
      emit();
      void scheduleRefresh();
      return true;
    },

    syncRadarPicksToArchetypes(): { ok: boolean; syncedCount: number } {
      const pickedIds = Array.from(new Set(state.picks.map((p) => p.matchId)));
      if (pickedIds.length === 0) return { ok: false, syncedCount: 0 };
      const syncedIds = pickedIds.slice(0, 8);
      state = {
        ...state,
        targetIds: syncedIds,
        anchorToRadarPicks: true,
        syncedRadarSig: buildRadarSignature(state.picks),
      };
      emit();
      void scheduleRefresh();
      return { ok: true, syncedCount: syncedIds.length };
    },

    toggleTargetMatch(matchId: string): { ok: boolean; reason?: string } {
      const valid = state.matches
        .filter((x) => state.targetIds.includes(x.id))
        .map((x) => x.id);
      let nextTargets: string[];
      if (valid.includes(matchId)) {
        if (valid.length <= 1) {
          return { ok: false, reason: '至少保留 1 场目标比赛' };
        }
        nextTargets = valid.filter((k) => k !== matchId);
      } else {
        nextTargets = valid.length >= 8 ? [...valid.slice(1), matchId] : [...valid, matchId];
      }
      state = {
        ...state,
        anchorToRadarPicks: false,
        targetIds: nextTargets,
      };
      emit();
      void scheduleRefresh();
      return { ok: true };
    },

    selectTargetSlice(count: number) {
      state = {
        ...state,
        anchorToRadarPicks: false,
        targetIds: state.matches.slice(0, Math.max(1, Math.min(8, count))).map((x) => x.id),
      };
      emit();
      void scheduleRefresh();
    },

    setAnchorToRadarPicks(val: boolean) {
      state = { ...state, anchorToRadarPicks: val };
      emit();
      void scheduleRefresh();
    },

    setBudget(nextBudget: number) {
      state = { ...state, budget: nextBudget };
      emit();
      void scheduleRefresh();
    },

    setStance(nextStance: UserStance) {
      state = { ...state, stance: nextStance };
      emit();
      void scheduleRefresh();
    },

    setUnlockFullAgg(val: boolean) {
      state = { ...state, unlockFullAgg: val };
      emit();
      void scheduleRefresh();
    },

    setSubjectiveDeltaPct(val: number) {
      state = { ...state, subjectiveDeltaPct: val };
      emit();
      void scheduleRefresh();
    },

    setSimVoidFirstMatch(val: boolean) {
      state = { ...state, simVoidFirstMatch: val };
      emit();
      void scheduleRefresh();
    },

    loadPresetScenario(kind: PresetScenarioKind) {
      const built = buildPresetPicks(state.matches, kind);
      state = {
        ...state,
        planSpec: null,
        passSpec: { mode: 'auto' },
        simVoidFirstMatch: false,
        subjectiveDeltaPct: 0,
        multiple: built.multiple,
        picks: built.picks,
      };
      emit();
      void scheduleRefresh();
    },
  };
}
