import type {
  BoardFreshnessMeta,
  LedgerOutcomeStatus,
  MatchItem,
  PortfolioKey,
  QuantWorkspaceParams,
  QuantWorkspaceResponse,
  SelectedPick,
} from "../prototype/quantTypes.ts";
import {
  bootstrapSecureWorkspace,
  clearPersistedWechatAuth,
  createEmptyLedgerSnapshot,
  loginWithPassword,
  logoutSession,
  mutateServerLedger,
  persistCachedLedgerSnapshot,
  persistWechatAuth,
  readCachedLedgerSnapshot,
  readPersistedWechatAuth,
  registerAuthRevokedHandler,
  requestServerMatchesSync,
  requestServerQuantCompute,
  requestXiaoGaoComboDiagnosis,
  requestXiaoGaoDiagnosis,
  type AuthenticatedWorkspaceBundle,
  type BootstrapResult,
  type LedgerEntry,
  type LedgerMutatePayload,
  type LedgerMutateResponse,
  type PersistedWechatAuth,
  type PublicAccountUser,
  type UserLedgerSnapshot,
  type XiaoGaoAlert,
  type XiaoGaoComboReport,
} from "../security/secureClient.ts";
import {
  createBetSlipController,
  type BetSlipState,
  type PlayabilityGates,
  type SealedLedgerDraft,
} from "./betSlipController.ts";

export type LedgerFilterKind = "all" | "live" | "paper" | "pending";

export interface StopLossInterceptPrompt {
  draft: SealedLedgerDraft;
  dailyLimit: number;
  dailyRemaining: number;
  overBy: number;
}

export interface SoftUndoBanner {
  undoToken: string;
  label: string;
  seq: number;
  expiresAt: number;
}

export interface WorkbenchClockPort {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WorkbenchStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkbenchQuantPort {
  computeWorkspace(
    params: QuantWorkspaceParams,
    matches: MatchItem[]
  ): QuantWorkspaceResponse | Promise<QuantWorkspaceResponse>;
  syncMatches?(workspaceParams: QuantWorkspaceParams): Promise<{
    matches: MatchItem[];
    syncNote: string;
    boardMeta?: BoardFreshnessMeta;
    workspace: QuantWorkspaceResponse;
    ledger?: UserLedgerSnapshot;
    newlySettledCount?: number;
  }>;
}

export interface WorkbenchLedgerPort {
  mutate(payload: LedgerMutatePayload): Promise<LedgerMutateResponse>;
}

export interface WorkbenchXiaogaoPort {
  diagnoseMatch(
    matchId: string,
    userNote?: string
  ): Promise<{ alert: XiaoGaoAlert; aiRemaining?: number }>;
  diagnoseCombo(
    params: Partial<QuantWorkspaceParams> & {
      sourceMode: "picked" | "custom";
      matchIds: string[];
      picks: SelectedPick[];
      auditedLegs?: SelectedPick[];
      userNote?: string;
    }
  ): Promise<{ comboReport: XiaoGaoComboReport; aiRemaining?: number }>;
}

export interface WorkbenchAuthPort {
  bootstrap(forceReset?: boolean): Promise<BootstrapResult>;
  login?(
    username: string,
    password: string
  ): Promise<AuthenticatedWorkspaceBundle>;
  logout?(): Promise<void>;
  registerRevokedHandler?(handler: ((reason: string) => void) | null): void;
}

export interface WorkbenchControllerOptions {
  debounceMs?: number;
  autoSyncRadar?: boolean;
  undoDurationMs?: number;
  autoSettleThrottleMs?: number;
  quantPort?: WorkbenchQuantPort;
  ledgerPort?: WorkbenchLedgerPort;
  xiaogaoPort?: WorkbenchXiaogaoPort;
  authPort?: WorkbenchAuthPort;
  storagePort?: WorkbenchStoragePort;
  clockPort?: WorkbenchClockPort;
}

export interface WorkbenchSnapshot {
  betSlipState: BetSlipState;
  playabilityGates: PlayabilityGates;
  authUser: PublicAccountUser | null;
  authChecked: boolean;
  authNotice: string | null;
  offlineMode: boolean;
  syncing: boolean;
  syncSummary: string;
  syncClock: string;
  boardMeta: BoardFreshnessMeta | null;
  ledger: UserLedgerSnapshot;
  ledgerBusy: boolean;
  ledgerFilter: LedgerFilterKind;
  liveEntriesCount: number;
  paperEntriesCount: number;
  pendingEntriesCount: number;
  settledPaperCount: number;
  filteredLedgerEntries: LedgerEntry[];
  stopLossPrompt: StopLossInterceptPrompt | null;
  undoBanner: SoftUndoBanner | null;
  diagnosingMatchId: string | null;
  diagnosingCombo: boolean;
  comboSelectedIds: string[];
  comboReport: XiaoGaoComboReport | null;
  remainingAiQuota: number | null;
  matchAiAlerts: Record<string, NonNullable<MatchItem["aiAlert"]>>;
}

function createDefaultClockPort(): WorkbenchClockPort {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

function createDefaultStoragePort(): WorkbenchStoragePort {
  const fallback = new Map<string, string>();
  const resolveDomStorage = (): Storage | null => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        return window.localStorage;
      }
      const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      if (desc && "value" in desc && desc.value) {
        return desc.value as Storage;
      }
    } catch {
      // ignore sandboxed storage error
    }
    return null;
  };
  return {
    getItem(key) {
      const dom = resolveDomStorage();
      if (dom) {
        try {
          return dom.getItem(key);
        } catch {
          return fallback.get(key) ?? null;
        }
      }
      return fallback.get(key) ?? null;
    },
    setItem(key, value) {
      const dom = resolveDomStorage();
      if (dom) {
        try {
          dom.setItem(key, value);
          return;
        } catch {
          // fall back to memory map
        }
      }
      fallback.set(key, value);
    },
    removeItem(key) {
      const dom = resolveDomStorage();
      if (dom) {
        try {
          dom.removeItem(key);
        } catch {
          // ignore
        }
      }
      fallback.delete(key);
    },
  };
}

function formatClockHMS(nowMs: number): string {
  const d = new Date(nowMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function buildEmptyLedgerAt(
  dailyLimit: number,
  nowMs: number
): UserLedgerSnapshot {
  const base = createEmptyLedgerSnapshot(dailyLimit);
  const bjDate = new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10);
  return { ...base, usageDate: bjDate };
}

function computeRemainingQuota(user: PublicAccountUser | null): number | null {
  if (!user) return null;
  return Math.max(0, (user.dailyAiLimit ?? 0) - (user.aiUsedToday ?? 0));
}

function extractMatchAiAlerts(
  matches: MatchItem[]
): Record<string, NonNullable<MatchItem["aiAlert"]>> {
  const out: Record<string, NonNullable<MatchItem["aiAlert"]>> = {};
  for (const m of matches) {
    if (m.aiAlert) {
      out[m.id] = m.aiAlert;
    }
  }
  return out;
}

function isExplicitAuthInvalidationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as {
    statusCode?: number;
    status?: number;
    authRequired?: boolean;
    accountLocked?: boolean;
  };
  const code = anyErr.statusCode ?? anyErr.status;
  return (
    code === 401 ||
    code === 403 ||
    anyErr.authRequired === true ||
    anyErr.accountLocked === true
  );
}

export function createWorkbenchController(
  options: WorkbenchControllerOptions = {}
) {
  const undoDurationMs = options.undoDurationMs ?? 5_000;
  const autoSettleThrottleMs = options.autoSettleThrottleMs ?? 45_000;
  const clockPort = options.clockPort ?? createDefaultClockPort();
  const storagePort = options.storagePort ?? createDefaultStoragePort();

  const quantPort: WorkbenchQuantPort = options.quantPort ?? {
    computeWorkspace: (params) => requestServerQuantCompute(params),
    syncMatches: (wp) => requestServerMatchesSync(wp),
  };
  const ledgerPort: WorkbenchLedgerPort = options.ledgerPort ?? {
    mutate: (payload) => mutateServerLedger(payload),
  };
  const xiaogaoPort: WorkbenchXiaogaoPort = options.xiaogaoPort ?? {
    diagnoseMatch: (id, note) => requestXiaoGaoDiagnosis(id, note),
    diagnoseCombo: (params) => requestXiaoGaoComboDiagnosis(params),
  };
  const authPort: WorkbenchAuthPort = options.authPort ?? {
    bootstrap: (forceReset) => bootstrapSecureWorkspace(forceReset),
    login: (u, p) => loginWithPassword(u, p),
    logout: () => logoutSession(),
    registerRevokedHandler: (fn) => registerAuthRevokedHandler(fn),
  };

  const listeners = new Set<() => void>();
  let undoTimerHandle: unknown = null;
  let lastAutoSettleAt = 0;
  let activeArchKey: PortfolioKey = "max-ev-utility";

  function readPersistedAuth(): PersistedWechatAuth | null {
    return readPersistedWechatAuth(storagePort);
  }

  function writePersistedAuth(authToken: string, user: PublicAccountUser) {
    persistWechatAuth(authToken, user, storagePort, clockPort.now());
  }

  function clearPersistedAuth() {
    clearPersistedWechatAuth(storagePort);
  }

  function readCachedLedger(userId: string): UserLedgerSnapshot | null {
    return readCachedLedgerSnapshot(userId, storagePort);
  }

  function writeCachedLedger(userId: string, snap: UserLedgerSnapshot) {
    persistCachedLedgerSnapshot(userId, snap, storagePort);
  }

  const initPersisted = readPersistedAuth();
  let authUser: PublicAccountUser | null = initPersisted?.cachedUser ?? null;
  let authChecked = Boolean(initPersisted?.cachedUser);
  let authNotice: string | null = null;
  let offlineMode = false;
  let syncing = false;
  let syncSummary = "正在建立 AES-256-GCM 加密精算会话...";
  let syncClock = formatClockHMS(clockPort.now());
  let boardMeta: BoardFreshnessMeta | null = null;

  let ledger: UserLedgerSnapshot =
    (authUser ? readCachedLedger(authUser.id) : null) ??
    buildEmptyLedgerAt(300, clockPort.now());
  let ledgerBusy = false;
  let ledgerFilter: LedgerFilterKind = "all";
  let stopLossPrompt: StopLossInterceptPrompt | null = null;
  let undoBanner: SoftUndoBanner | null = null;

  let diagnosingMatchId: string | null = null;
  let diagnosingCombo = false;
  let comboSelectedIds: string[] = [];
  let comboReport: XiaoGaoComboReport | null = null;
  let remainingAiQuota: number | null = computeRemainingQuota(authUser);

  const betSlip = createBetSlipController({
    debounceMs: options.debounceMs ?? 18,
    autoSyncRadar: options.autoSyncRadar ?? true,
    computeWorkspace: (params, matches) =>
      quantPort.computeWorkspace(params, matches),
    onComputeSuccess: () => {
      if (offlineMode) {
        offlineMode = false;
        rebuildSnapshotAndEmit();
      }
    },
    onOfflineNetworkError: () => {
      if (!offlineMode) {
        offlineMode = true;
        rebuildSnapshotAndEmit();
      }
    },
  });

  function buildSnapshot(): WorkbenchSnapshot {
    const betSlipState = betSlip.getState();
    const playabilityGates = betSlip.getPlayabilityGates(activeArchKey);
    const liveEntriesCount = ledger.entries.filter(
      (e) => e.kind === "live"
    ).length;
    const paperEntriesCount = ledger.entries.filter(
      (e) => e.kind === "paper"
    ).length;
    const pendingEntriesCount = ledger.entries.filter(
      (e) => e.status === "pending"
    ).length;
    const settledPaperCount = ledger.entries.filter(
      (e) => e.kind === "paper" && e.status !== "pending"
    ).length;
    const filteredLedgerEntries = ledger.entries.filter((e) => {
      if (ledgerFilter === "live") return e.kind === "live";
      if (ledgerFilter === "paper") return e.kind === "paper";
      if (ledgerFilter === "pending") return e.status === "pending";
      return true;
    });

    return {
      betSlipState,
      playabilityGates,
      authUser,
      authChecked,
      authNotice,
      offlineMode,
      syncing,
      syncSummary,
      syncClock,
      boardMeta,
      ledger,
      ledgerBusy,
      ledgerFilter,
      liveEntriesCount,
      paperEntriesCount,
      pendingEntriesCount,
      settledPaperCount,
      filteredLedgerEntries,
      stopLossPrompt,
      undoBanner,
      diagnosingMatchId,
      diagnosingCombo,
      comboSelectedIds,
      comboReport,
      remainingAiQuota,
      matchAiAlerts: extractMatchAiAlerts(betSlipState.matches),
    };
  }

  let currentSnapshot: WorkbenchSnapshot = buildSnapshot();

  function rebuildSnapshotAndEmit() {
    currentSnapshot = buildSnapshot();
    for (const listener of listeners) {
      listener();
    }
  }

  let unsubBetSlip = betSlip.subscribe(() => {
    rebuildSnapshotAndEmit();
  });
  let disposed = false;

  function ensureActiveLifecycle() {
    if (!disposed) return;
    disposed = false;
    unsubBetSlip = betSlip.subscribe(() => {
      rebuildSnapshotAndEmit();
    });
    authPort.registerRevokedHandler?.((reason) => {
      clearSessionState(reason);
    });
  }

  function clearUndoTimer() {
    if (undoTimerHandle !== null) {
      clockPort.clearTimeout(undoTimerHandle);
      undoTimerHandle = null;
    }
  }

  function scheduleUndoBanner(undoToken: string, label: string) {
    clearUndoTimer();
    const now = clockPort.now();
    undoBanner = {
      undoToken,
      label,
      seq: now,
      expiresAt: now + undoDurationMs,
    };
    undoTimerHandle = clockPort.setTimeout(() => {
      if (undoBanner?.undoToken === undoToken) {
        undoBanner = null;
        undoTimerHandle = null;
        rebuildSnapshotAndEmit();
      }
    }, undoDurationMs);
  }

  function syncLedgerSnapshot(
    nextLedger: UserLedgerSnapshot,
    explicitUserId?: string
  ) {
    ledger = nextLedger;
    const uid =
      explicitUserId || authUser?.id || readPersistedAuth()?.cachedUser?.id;
    if (uid) {
      writeCachedLedger(uid, nextLedger);
    }
  }

  function syncRemainingAiQuota(remaining?: number) {
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) return;
    const clamped = Math.max(0, Math.round(remaining));
    remainingAiQuota = clamped;
    if (authUser) {
      authUser = {
        ...authUser,
        aiUsedToday: Math.max(0, authUser.dailyAiLimit - clamped),
      };
      const persisted = readPersistedAuth();
      if (persisted?.authToken && persisted.cachedUser.id === authUser.id) {
        writePersistedAuth(persisted.authToken, authUser);
      }
    }
    rebuildSnapshotAndEmit();
  }

  function clearSessionState(reason: string | null) {
    clearPersistedAuth();
    clearUndoTimer();
    undoBanner = null;
    authUser = null;
    remainingAiQuota = null;
    ledger = buildEmptyLedgerAt(300, clockPort.now());
    stopLossPrompt = null;
    offlineMode = false;
    boardMeta = null;
    authChecked = true;
    authNotice = reason;
    betSlip.setBootstrapped(false);
    rebuildSnapshotAndEmit();
  }

  authPort.registerRevokedHandler?.((reason) => {
    clearSessionState(reason);
  });

  function applyLoginBundle(bundle: AuthenticatedWorkspaceBundle) {
    authUser = bundle.user;
    remainingAiQuota = computeRemainingQuota(bundle.user);
    authChecked = true;
    authNotice = null;
    offlineMode = false;
    writePersistedAuth(bundle.authToken, bundle.user);

    const resolvedLedger =
      bundle.ledger ??
      readCachedLedger(bundle.user.id) ??
      buildEmptyLedgerAt(300, clockPort.now());
    syncLedgerSnapshot(resolvedLedger, bundle.user.id);
    stopLossPrompt = null;

    betSlip.applyAuthenticatedBundle(bundle);
    comboSelectedIds = bundle.matches.slice(0, 3).map((m) => m.id);
    syncSummary = bundle.syncNote;
    syncClock = formatClockHMS(clockPort.now());
    boardMeta = bundle.boardMeta ?? null;
    rebuildSnapshotAndEmit();
  }

  async function bootstrapHandshake(opts?: {
    isReconnect?: boolean;
    maxAttempts?: number;
    retryDelayMs?: number;
  }): Promise<{
    ok: boolean;
    authenticated: boolean;
    offline: boolean;
    newlySettledCount?: number;
    authError?: string | null;
  }> {
    const isReconnect = Boolean(opts?.isReconnect);
    const maxAttempts = Math.max(1, opts?.maxAttempts ?? 2);
    const retryDelayMs = Math.max(0, opts?.retryDelayMs ?? 0);
    ensureActiveLifecycle();

    if (!isReconnect) {
      syncing = true;
      rebuildSnapshotAndEmit();
    }

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const boot = await authPort.bootstrap(attempt > 0 || isReconnect);
          if (!boot.authenticated) {
            clearSessionState(boot.authError ?? null);
            return {
              ok: false,
              authenticated: false,
              offline: false,
              authError: boot.authError ?? null,
            };
          }

          if (isReconnect && betSlip.getState().matches.length > 0) {
            authUser = boot.user;
            remainingAiQuota = computeRemainingQuota(boot.user);
            writePersistedAuth(boot.authToken, boot.user);
            if (boot.ledger) {
              syncLedgerSnapshot(boot.ledger, boot.user.id);
            }
            offlineMode = false;
            authChecked = true;
            betSlip.setBootstrapped(true);
            syncSummary = boot.syncNote;
            syncClock = formatClockHMS(clockPort.now());
            if (boot.boardMeta !== undefined) {
              boardMeta = boot.boardMeta ?? null;
            }
            rebuildSnapshotAndEmit();
          } else {
            applyLoginBundle(boot);
          }

          return {
            ok: true,
            authenticated: true,
            offline: false,
            newlySettledCount: boot.newlySettledCount ?? 0,
          };
        } catch (err) {
          if (String((err as Error)?.message) === "Fused") {
            return { ok: false, authenticated: false, offline: false };
          }
          if (isExplicitAuthInvalidationError(err)) {
            const msg = (err as Error)?.message || "登录授权已失效，请重新登录";
            clearSessionState(msg);
            return {
              ok: false,
              authenticated: false,
              offline: false,
              authError: msg,
            };
          }

          if (attempt + 1 < maxAttempts) {
            if (retryDelayMs > 0) {
              await new Promise<void>((resolve) => {
                clockPort.setTimeout(resolve, retryDelayMs);
              });
            }
            continue;
          }

          // ADR-0003 WeChat Offline Continuity: preserve cached session & ledger on transient network errors
          const persisted = readPersistedAuth();
          const preservedUser = persisted?.cachedUser ?? authUser;
          if (preservedUser) {
            authUser = preservedUser;
            remainingAiQuota = computeRemainingQuota(preservedUser);
            const cachedLedger = readCachedLedger(preservedUser.id);
            if (cachedLedger) {
              ledger = cachedLedger;
            }
            offlineMode = true;
            authChecked = true;
            syncSummary =
              "当前网络离线波动 · 已保持长期免登状态，恢复联网后自动无感重连";
            rebuildSnapshotAndEmit();
            return { ok: false, authenticated: true, offline: true };
          }

          offlineMode = true;
          authChecked = true;
          rebuildSnapshotAndEmit();
          return { ok: false, authenticated: false, offline: true };
        }
      }
      return {
        ok: false,
        authenticated: Boolean(authUser),
        offline: offlineMode,
      };
    } finally {
      if (!isReconnect) {
        syncing = false;
        rebuildSnapshotAndEmit();
      }
    }
  }

  async function syncOfficialMatches(): Promise<{
    ok: boolean;
    matchCount?: number;
    newlySettledCount?: number;
    error?: string;
  }> {
    if (!quantPort.syncMatches) {
      return { ok: false, error: "当前环境未配置实盘同步通道" };
    }
    syncing = true;
    rebuildSnapshotAndEmit();
    try {
      const res = await quantPort.syncMatches(betSlip.buildWorkspaceParams());
      offlineMode = false;
      betSlip.applyMatchesSync(res);
      if (res.ledger) {
        syncLedgerSnapshot(res.ledger);
      }
      syncSummary = res.syncNote;
      syncClock = formatClockHMS(clockPort.now());
      if (res.boardMeta !== undefined) {
        boardMeta = res.boardMeta ?? null;
      }
      rebuildSnapshotAndEmit();
      return {
        ok: true,
        matchCount: res.matches.length,
        newlySettledCount: res.newlySettledCount ?? 0,
      };
    } catch (err) {
      if (err instanceof TypeError) {
        offlineMode = true;
      }
      rebuildSnapshotAndEmit();
      return {
        ok: false,
        error: (err as Error)?.message || "同步繁忙，请稍后再试",
      };
    } finally {
      syncing = false;
      rebuildSnapshotAndEmit();
    }
  }

  async function recordToLedger(
    kind: "live" | "paper",
    recordOpts?: { draft?: SealedLedgerDraft; forceConfirmed?: boolean }
  ): Promise<{
    ok: boolean;
    code?: "UNPLAYABLE_SLIP" | "BUSY" | "STOP_LOSS_EXCEEDED" | "NETWORK_ERROR";
    entry?: LedgerEntry;
    stopLossPrompt?: StopLossInterceptPrompt;
    error?: string;
  }> {
    const draft = recordOpts?.draft ?? betSlip.buildSealedLedgerDraft();
    if (!draft) {
      return {
        ok: false,
        code: "UNPLAYABLE_SLIP",
        error:
          betSlip.getState().workspace.effectiveReport.ruleBlockReason ||
          "当前方案未满足出票条件，暂无法记入账本",
      };
    }
    if (ledgerBusy) {
      return { ok: false, code: "BUSY", error: "账本处理中" };
    }

    ledgerBusy = true;
    rebuildSnapshotAndEmit();
    try {
      const res = await ledgerPort.mutate({
        action: "add-entry",
        kind,
        title: draft.title,
        modeLabel: draft.modeLabel,
        betCount: draft.betCount,
        cost: kind === "live" ? draft.cost : 0,
        paperRefCost: kind === "paper" ? draft.paperRefCost : undefined,
        minPayout: draft.minPayout,
        maxPayout: draft.maxPayout,
        snapshot: draft.snapshot,
        workspaceParams:
          draft.workspaceParams ?? betSlip.buildWorkspaceParams(),
        forceConfirmed: Boolean(recordOpts?.forceConfirmed),
      });

      syncLedgerSnapshot(res.ledger);
      if (!res.ok && res.code === "STOP_LOSS_EXCEEDED") {
        stopLossPrompt = {
          draft,
          dailyLimit: res.dailyLimit,
          dailyRemaining: res.dailyRemaining,
          overBy: res.overBy,
        };
        return {
          ok: false,
          code: "STOP_LOSS_EXCEEDED",
          stopLossPrompt,
        };
      }

      stopLossPrompt = null;
      ledgerFilter = "all";
      return {
        ok: true,
        entry: res.ok ? res.entry : undefined,
      };
    } catch (err) {
      if (err instanceof TypeError) {
        offlineMode = true;
      }
      return {
        ok: false,
        code: "NETWORK_ERROR",
        error: (err as Error)?.message || "当前网络离线，请恢复连接后再记账",
      };
    } finally {
      ledgerBusy = false;
      rebuildSnapshotAndEmit();
    }
  }

  return {
    betSlip,
    getState: () => currentSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setActivePortfolioKey(key: PortfolioKey) {
      if (activeArchKey === key) return;
      activeArchKey = key;
      rebuildSnapshotAndEmit();
    },

    // Session Handshake & Offline Continuity
    bootstrapHandshake,
    applyLoginBundle,
    async login(username: string, password: string) {
      if (!authPort.login) {
        throw new Error("未配置登录适配器");
      }
      const bundle = await authPort.login(username, password);
      applyLoginBundle(bundle);
      return bundle;
    },
    async logout() {
      try {
        await authPort.logout?.();
      } catch {
        // ignore logout network error
      }
      clearSessionState("已安全退出当前账号");
    },
    handleAuthRevoked(reason: string) {
      clearSessionState(reason);
    },
    syncOfficialMatches,
    syncRemainingAiQuota,

    // Dual-Track Ledger & Stop-Loss Guardrail
    setLedgerFilter(nextFilter: LedgerFilterKind) {
      if (ledgerFilter === nextFilter) return;
      ledgerFilter = nextFilter;
      rebuildSnapshotAndEmit();
    },
    recordToLedger,
    async confirmConvertStopLossToPaper() {
      if (!stopLossPrompt) {
        return { ok: false as const, error: "当前无待处理的止损拦截方案" };
      }
      return recordToLedger("paper", {
        draft: stopLossPrompt.draft,
        forceConfirmed: false,
      });
    },
    async confirmForceLiveOverStopLoss() {
      if (!stopLossPrompt) {
        return { ok: false as const, error: "当前无待处理的止损拦截方案" };
      }
      return recordToLedger("live", {
        draft: stopLossPrompt.draft,
        forceConfirmed: true,
      });
    },
    dismissStopLossPrompt() {
      if (!stopLossPrompt) return;
      stopLossPrompt = null;
      rebuildSnapshotAndEmit();
    },
    async saveDailyLimit(rawLimit: number | string) {
      const parsed = Math.round(Number(rawLimit));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          ok: false,
          error: "请输入有效的每日止损上限（¥20 ~ ¥100000）",
        };
      }
      if (ledgerBusy) return { ok: false, error: "账本处理中" };
      ledgerBusy = true;
      rebuildSnapshotAndEmit();
      try {
        const res = await ledgerPort.mutate({
          action: "set-daily-limit",
          dailyLimit: parsed,
        });
        if (res.ok) {
          syncLedgerSnapshot(res.ledger);
          return { ok: true, dailyLimit: res.ledger.dailyLimit };
        }
        return { ok: false, error: "止损上限更新失败" };
      } catch (err) {
        if (err instanceof TypeError) offlineMode = true;
        return {
          ok: false,
          error: (err as Error)?.message || "止损上限更新失败",
        };
      } finally {
        ledgerBusy = false;
        rebuildSnapshotAndEmit();
      }
    },
    async settleEntryManual(
      entryId: string,
      status: LedgerOutcomeStatus,
      customReturn?: number
    ) {
      if (ledgerBusy) return { ok: false, error: "账本处理中" };
      const entry = ledger.entries.find((e) => e.id === entryId);
      ledgerBusy = true;
      rebuildSnapshotAndEmit();
      try {
        const res = await ledgerPort.mutate({
          action: "settle-entry",
          entryId,
          status,
          settledReturn:
            (status === "won" || status === "partial") &&
            (!entry || entry.kind === "live")
              ? customReturn
              : undefined,
        });
        if (res.ok) {
          syncLedgerSnapshot(res.ledger);
          return { ok: true, entry: res.entry };
        }
        return { ok: false, error: "结算状态更新失败" };
      } catch (err) {
        if (err instanceof TypeError) offlineMode = true;
        return {
          ok: false,
          error: (err as Error)?.message || "结算状态更新失败",
        };
      } finally {
        ledgerBusy = false;
        rebuildSnapshotAndEmit();
      }
    },
    async deleteEntry(entryId: string) {
      if (ledgerBusy) return { ok: false, error: "账本处理中" };
      ledgerBusy = true;
      rebuildSnapshotAndEmit();
      try {
        const res = await ledgerPort.mutate({
          action: "delete-entry",
          entryId,
        });
        if (res.ok) {
          syncLedgerSnapshot(res.ledger);
          if (res.undoToken) {
            const label =
              (res.lockedStopLossStake ?? 0) > 0
                ? `已移除亏损实买单（当日止损额度 ¥${res.lockedStopLossStake} 保持锁死防上头）`
                : "已删除该笔账本订单";
            scheduleUndoBanner(res.undoToken, label);
          }
          return {
            ok: true,
            undoToken: res.undoToken,
            lockedStopLossStake: res.lockedStopLossStake ?? 0,
          };
        }
        return { ok: false, error: "删除账本记录失败" };
      } catch (err) {
        if (err instanceof TypeError) offlineMode = true;
        return {
          ok: false,
          error: (err as Error)?.message || "删除账本记录失败",
        };
      } finally {
        ledgerBusy = false;
        rebuildSnapshotAndEmit();
      }
    },
    async undoDeleteEntry() {
      if (!undoBanner?.undoToken) {
        return { ok: false, error: "撤销窗口已过期" };
      }
      if (clockPort.now() >= undoBanner.expiresAt) {
        clearUndoTimer();
        undoBanner = null;
        rebuildSnapshotAndEmit();
        return { ok: false, error: "撤销窗口已过期" };
      }
      if (ledgerBusy) return { ok: false, error: "账本处理中" };
      const token = undoBanner.undoToken;
      ledgerBusy = true;
      rebuildSnapshotAndEmit();
      try {
        const res = await ledgerPort.mutate({
          action: "restore-entry",
          undoToken: token,
        });
        if (res.ok) {
          syncLedgerSnapshot(res.ledger);
          clearUndoTimer();
          undoBanner = null;
          return { ok: true, restoredCount: res.restoredCount ?? 1 };
        }
        return { ok: false, error: "撤销窗口已过期" };
      } catch (err) {
        clearUndoTimer();
        undoBanner = null;
        return {
          ok: false,
          error: (err as Error)?.message || "撤销窗口已过期",
        };
      } finally {
        ledgerBusy = false;
        rebuildSnapshotAndEmit();
      }
    },
    async clearSettledPaper() {
      if (ledgerBusy) return { ok: false, error: "账本处理中" };
      ledgerBusy = true;
      rebuildSnapshotAndEmit();
      try {
        const res = await ledgerPort.mutate({ action: "clear-settled-paper" });
        if (res.ok) {
          syncLedgerSnapshot(res.ledger);
          if ((res.clearedCount ?? 0) > 0 && res.undoToken) {
            scheduleUndoBanner(
              res.undoToken,
              `已清理 ${res.clearedCount} 笔已结模拟观察单`
            );
          }
          return { ok: true, clearedCount: res.clearedCount ?? 0 };
        }
        return { ok: false, error: "清理已结模拟单失败" };
      } catch (err) {
        return {
          ok: false,
          error: (err as Error)?.message || "清理已结模拟单失败",
        };
      } finally {
        ledgerBusy = false;
        rebuildSnapshotAndEmit();
      }
    },
    async refreshLedgerAutoSettle(opts?: { force?: boolean }) {
      const force = Boolean(opts?.force);
      if (ledgerBusy) {
        return { ok: false, throttled: false, newlySettledCount: 0 };
      }
      const now = clockPort.now();
      if (
        !force &&
        lastAutoSettleAt > 0 &&
        now - lastAutoSettleAt < autoSettleThrottleMs
      ) {
        return { ok: true, throttled: true, newlySettledCount: 0 };
      }
      lastAutoSettleAt = now;
      if (force) {
        ledgerBusy = true;
        rebuildSnapshotAndEmit();
      }
      try {
        const res = await ledgerPort.mutate({
          action: "auto-settle",
          forceRefresh: force,
        });
        if (res.ok) {
          syncLedgerSnapshot(res.ledger);
          return {
            ok: true,
            throttled: false,
            newlySettledCount: res.newlySettledCount ?? 0,
          };
        }
        return { ok: false, throttled: false, newlySettledCount: 0 };
      } catch {
        return { ok: false, throttled: false, newlySettledCount: 0 };
      } finally {
        if (force) {
          ledgerBusy = false;
        }
        rebuildSnapshotAndEmit();
      }
    },

    // XiaoGao Intel Diagnosis State Machine
    setComboSelectedIds(ids: string[]) {
      comboSelectedIds = Array.from(new Set(ids)).slice(0, 8);
      rebuildSnapshotAndEmit();
    },
    toggleComboSelectedMatch(matchId: string): {
      ok: boolean;
      reason?: string;
    } {
      if (comboSelectedIds.includes(matchId)) {
        comboSelectedIds = comboSelectedIds.filter((id) => id !== matchId);
        rebuildSnapshotAndEmit();
        return { ok: true };
      }
      if (comboSelectedIds.length >= 8) {
        return { ok: false, reason: "联合会诊最多同时选择 8 场比赛" };
      }
      comboSelectedIds = [...comboSelectedIds, matchId];
      rebuildSnapshotAndEmit();
      return { ok: true };
    },
    async diagnoseSingleMatch(matchId: string, userNote?: string) {
      if (diagnosingMatchId || diagnosingCombo) {
        return { ok: false as const, error: "当前已有排雷任务进行中" };
      }
      diagnosingMatchId = matchId;
      rebuildSnapshotAndEmit();
      try {
        const { alert, aiRemaining } = await xiaogaoPort.diagnoseMatch(
          matchId,
          userNote
        );
        syncRemainingAiQuota(aiRemaining);
        await betSlip.applyMatchAiAlert(matchId, alert);
        return {
          ok: true as const,
          alert,
          aiRemaining: remainingAiQuota,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error)?.message || "诊盘繁忙，请稍后再试",
        };
      } finally {
        diagnosingMatchId = null;
        rebuildSnapshotAndEmit();
      }
    },
    async diagnoseComboSlip(opts?: {
      sourceMode?: "picked" | "custom";
      matchIds?: string[];
      userNote?: string;
    }) {
      if (diagnosingCombo || diagnosingMatchId) {
        return { ok: false as const, error: "当前已有排雷任务进行中" };
      }
      const sourceMode = opts?.sourceMode ?? "picked";
      const auditedSlip = betSlip.getActiveAuditedSlip();
      const candidateIds =
        opts?.matchIds ??
        (sourceMode === "picked"
          ? betSlip.getAuditedMatchIds()
          : comboSelectedIds);
      const allMatches = betSlip.getState().matches;
      const targetList = allMatches.filter((m) => candidateIds.includes(m.id));
      if (targetList.length < 2) {
        return {
          ok: false as const,
          error: "请至少选择 2 场比赛再发起多场联合会诊",
        };
      }

      diagnosingCombo = true;
      rebuildSnapshotAndEmit();
      try {
        const wsParams = betSlip.buildWorkspaceParams();
        const { comboReport: rep, aiRemaining } =
          await xiaogaoPort.diagnoseCombo({
            ...wsParams,
            sourceMode,
            matchIds: targetList.map((m) => m.id),
            picks: sourceMode === "picked" ? betSlip.getState().picks : [],
            auditedLegs: sourceMode === "picked" ? auditedSlip.legs : undefined,
            userNote: opts?.userNote || undefined,
          });
        syncRemainingAiQuota(aiRemaining);
        comboReport = rep;
        if (Array.isArray(rep.perMatch) && rep.perMatch.length > 0) {
          await betSlip.applyComboAiReport(rep);
        }
        return {
          ok: true as const,
          comboReport: rep,
          matchCount: targetList.length,
          aiRemaining: remainingAiQuota,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: (err as Error)?.message || "联合会诊繁忙，请稍后再试",
        };
      } finally {
        diagnosingCombo = false;
        rebuildSnapshotAndEmit();
      }
    },

    hasPersistedSession(): boolean {
      return Boolean(authUser || readPersistedAuth()?.authToken);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearUndoTimer();
      unsubBetSlip();
      authPort.registerRevokedHandler?.(null);
    },
  };
}

export type WorkbenchController = ReturnType<typeof createWorkbenchController>;
