import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type ArchetypePlan,
  type BonusOptMode,
  type EquivalentArbItem,
  type MatchItem,
  type PoolCode,
  type PortfolioKey,
  type UserStance,
} from "../prototype/quantTypes";
import {
  bootstrapSecureWorkspace,
  createEmptyLedgerSnapshot,
  logoutSession,
  mutateServerLedger,
  readCachedUserLedger,
  readPersistedWechatAuth,
  registerAuthRevokedHandler,
  requestServerMatchesSync,
  requestServerQuantCompute,
  requestXiaoGaoComboDiagnosis,
  requestXiaoGaoDiagnosis,
  writeCachedUserLedger,
  type AuthenticatedWorkspaceBundle,
  type LedgerEntry,
  type PublicAccountUser,
  type UserLedgerSnapshot,
  type XiaoGaoComboReport,
} from "../security/secureClient";
import {
  buildRadarSignature,
  createBetSlipController,
  type MatchMode,
  type PresetScenarioKind,
} from "../workspace/betSlipController";
import { initHighPressureAntiReverseShield } from "../security/antiReverseShield";
import { LoginGate } from "../auth/LoginGate";
import { AdminConsoleModal } from "../admin/AdminConsoleModal";
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
} from "../spring/engine";
import {
  SKIN_PHYSICS_PROFILES,
  burstCelebrationSparks,
  getTactileState,
  launchParabolicOrb,
  playTactileCue,
  runHyperDemoShowcase,
  shudderDangerElement,
  triggerShimmerSweep,
  updateTactileState,
  type HapticIntensity,
} from "../spring/tactileSymphony";
import {
  PayoutEqualizerBars,
  SpringProbBar,
  SpringSegmented,
  SpringSheet,
  SpringSwitch,
  TeamCrest,
  kickElement,
} from "../spring/widgets";
import {
  UserManualModal,
  type ManualSectionId,
} from "../manual/UserManualModal";

type AppTab = "match" | "archetypes" | "audit" | "ledger";
type QuickFilter = "all" | "single" | "low-vig" | "drop" | "arb";

type SheetState =
  | null
  | { type: "more"; matchId: string }
  | { type: "intel"; matchId: string }
  | { type: "poster" }
  | { type: "filter" }
  | { type: "tactile" };

const MODE_OPTS: Array<[MatchMode, string]> = [
  ["mix", "混合"],
  ["spf", "胜平负"],
  ["bf", "比分"],
  ["zjq", "进球"],
  ["bqc", "半全场"],
  ["single", "单关"],
];

function splitTerminalPosterSlips(
  id: string,
  left: string,
  modeLabel: string,
  rawMultiple: number,
  singleSlipCost?: number
): Array<{ key: string; left: string; right: string }> {
  const totalMult = Math.max(1, rawMultiple);
  if (totalMult <= 99) {
    return [
      {
        key: id,
        left,
        right: `${modeLabel} · ${totalMult}倍 (¥${singleSlipCost ?? totalMult * 2})`,
      },
    ];
  }
  const slips: Array<{ key: string; left: string; right: string }> = [];
  let rem = totalMult;
  let idx = 1;
  const slipCount = Math.ceil(totalMult / 99);
  while (rem > 0) {
    const chunk = Math.min(99, rem);
    slips.push({
      key: `${id}-p${idx}`,
      left: `${left} [第${idx}/${slipCount}张]`,
      right: `${modeLabel} · ${chunk}倍 (¥${chunk * 2})`,
    });
    rem -= chunk;
    idx += 1;
  }
  return slips;
}

interface LedgerDraftPayload {
  title: string;
  modeLabel: string;
  betCount: number;
  cost: number;
  paperRefCost: number;
  minPayout: number;
  maxPayout: number;
}

interface StopLossInterceptState {
  draft: LedgerDraftPayload;
  dailyLimit: number;
  dailyRemaining: number;
  overBy: number;
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
  const base = import.meta.env.BASE_URL || "/";
  const [skin, setSkin] = useState<string>(initialSkin);
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => !embedded && typeof window !== "undefined" && window.innerWidth >= 960
  );
  const [dkRightTab, setDkRightTab] = useState<"archetypes" | "ledger">(
    "archetypes"
  );
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [manualSection, setManualSection] =
    useState<ManualSectionId>("optimizer");
  const openManual = (sec: ManualSectionId = "optimizer") => {
    setManualSection(sec);
    setManualOpen(true);
  };
  const [tab, setTab] = useState<AppTab>("match");
  const [qFilter, setQFilter] = useState<QuickFilter>("all");
  const [barPopover, setBarPopover] = useState<
    null | "pass" | "keypad" | "selected"
  >(null);
  const [keypadFresh, setKeypadFresh] = useState<boolean>(true);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState(
    "正在建立 AES-256-GCM 加密精算会话..."
  );
  const [syncClock, setSyncClock] = useState("21:05");
  const [archKey, setArchKey] = useState<PortfolioKey>("max-ev-utility");
  const [simHedgeHit, setSimHedgeHit] = useState(true);

  // Encrypted per-member dual-track stop-loss ledger state (with per-user localStorage offline fallback)
  const [ledger, setLedger] = useState<UserLedgerSnapshot>(() => {
    const initUid = readPersistedWechatAuth()?.cachedUser?.id;
    return (
      (initUid ? readCachedUserLedger(initUid) : null) ??
      createEmptyLedgerSnapshot()
    );
  });
  const [ledgerBusy, setLedgerBusy] = useState<boolean>(false);
  const [editingLimit, setEditingLimit] = useState<boolean>(false);
  const [limitDraft, setLimitDraft] = useState<string>("300");
  const [stopLossPrompt, setStopLossPrompt] =
    useState<StopLossInterceptState | null>(null);
  const [wonPromptEntryId, setWonPromptEntryId] = useState<string | null>(null);
  const [wonPayoutDraft, setWonPayoutDraft] = useState<string>("");

  // Auth & Hidden Super-Admin Console (2b) + WeChat Offline Resilience state
  const [authUser, setAuthUser] = useState<PublicAccountUser | null>(
    () => readPersistedWechatAuth()?.cachedUser ?? null
  );
  const [authChecked, setAuthChecked] = useState<boolean>(() =>
    Boolean(readPersistedWechatAuth()?.cachedUser)
  );
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState<boolean>(false);
  const [adminOpen, setAdminOpen] = useState<boolean>(false);

  const betCtrlRef = useRef<ReturnType<typeof createBetSlipController> | null>(
    null
  );
  if (!betCtrlRef.current) {
    betCtrlRef.current = createBetSlipController({
      debounceMs: 18,
      computeWorkspace: (params) => requestServerQuantCompute(params),
      onComputeSuccess: () => setOfflineMode(false),
      onOfflineNetworkError: () => setOfflineMode(true),
    });
  }
  const betCtrl = betCtrlRef.current;
  const betState = useSyncExternalStore(betCtrl.subscribe, betCtrl.getState);
  const {
    matches,
    picks,
    mode,
    multiple,
    passSpec,
    planSpec,
    subjectiveDeltaPct,
    simVoidFirstMatch,
    targetIds,
    anchorToRadarPicks,
    syncedRadarSig,
    budget,
    stance,
    unlockFullAgg,
    workspace,
  } = betState;

  const setAnchorToRadarPicks = (v: boolean) =>
    void betCtrl.setAnchorToRadarPicks(v);
  const setBudget = (b: number) => void betCtrl.setBudget(b);
  const setStance = (s: UserStance) => void betCtrl.setStance(s);
  const setUnlockFullAgg = (v: boolean) => void betCtrl.setUnlockFullAgg(v);
  const setSubjectiveDeltaPct = (v: number) =>
    void betCtrl.setSubjectiveDeltaPct(v);
  const setSimVoidFirstMatch = (v: boolean) =>
    void betCtrl.setSimVoidFirstMatch(v);

  // Sheet & Dual-Mode XiaoGao Diagnosis state
  const [sheet, setSheet] = useState<SheetState>(null);
  const [bfGrp, setBfGrp] = useState<"win" | "draw" | "lose">("win");
  const [checkedPosterLines, setCheckedPosterLines] = useState<
    Record<string, boolean>
  >({});
  const [leagueFilter, setLeagueFilter] = useState<Record<string, boolean>>({});
  const [diagnosingMatchId, setDiagnosingMatchId] = useState<string | null>(
    null
  );
  const [diagnosingCombo, setDiagnosingCombo] = useState<boolean>(false);
  const [comboSelectedIds, setComboSelectedIds] = useState<string[]>([]);
  const [comboReport, setComboReport] = useState<XiaoGaoComboReport | null>(
    null
  );
  const [customIntelInput, setCustomIntelInput] = useState<string>("");
  const [tactileCfg, setTactileCfg] = useState(() => getTactileState());

  // DOM Refs for spring physics
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const puckRef = useRef<HTMLDivElement>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const slipAmtRef = useRef<HTMLSpanElement>(null);
  const auditCockpitRef = useRef<HTMLDivElement>(null);
  const desktopAuditColRef = useRef<HTMLElement>(null);
  const underwaterTileRef = useRef<HTMLDivElement>(null);
  const demoBtnRef = useRef<HTMLButtonElement>(null);
  const mulValRef = useRef<HTMLSpanElement>(null);
  const balValRef = useRef<HTMLSpanElement>(null);
  const bfGridRef = useRef<HTMLDivElement>(null);

  const skinLinkRef = useRef<HTMLLinkElement | null>(null);
  const puckSpringRef = useRef<Spring | null>(null);
  const prevAmtRef = useRef<number>(-1);
  const prevBalRef = useRef<number>(ledger.dailyRemaining);

  useEffect(() => {
    if (embedded) return;
    const onResize = () => setIsDesktop(window.innerWidth >= 960);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [embedded]);

  // 1. Mount High-Pressure Anti-Reverse Shield + core.css + active skin.css
  useEffect(() => {
    initHighPressureAntiReverseShield(embedded);
    ensureGlobalTactileListener();
    setTactileCfg(updateTactileState({ skin }));

    let coreLink = document.getElementById(
      "jz-core-css"
    ) as HTMLLinkElement | null;
    if (!coreLink) {
      coreLink = document.createElement("link");
      coreLink.id = "jz-core-css";
      coreLink.rel = "stylesheet";
      coreLink.href = `${base}skins/core.css`;
      document.head.appendChild(coreLink);
    }

    const sLink = document.createElement("link");
    sLink.rel = "stylesheet";
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
    setTactileCfg(updateTactileState({ skin: nextId }));
    if (!silent) playTactileCue("skin-shift");
    const sh = shellRef.current;
    sh?.classList.add("skin-anim");

    const next = document.createElement("link");
    next.rel = "stylesheet";
    next.href = `${base}skins/${nextId}.css`;
    next.onload = () => {
      skinLinkRef.current?.remove();
      skinLinkRef.current = next;
      readSpringTokens();
      requestAnimationFrame(() => {
        placePuck(false);
        window.setTimeout(() => sh?.classList.remove("skin-anim"), 420);
      });
      try {
        window.parent?.postMessage({ cmd: "skinChanged", value: nextId }, "*");
      } catch {
        // ignore
      }
    };
    document.head.appendChild(next);
  };

  const syncLedgerState = (
    nextLedger: UserLedgerSnapshot,
    explicitUserId?: string
  ) => {
    setLedger(nextLedger);
    const uid =
      explicitUserId ||
      authUser?.id ||
      readPersistedWechatAuth()?.cachedUser?.id;
    if (uid) {
      writeCachedUserLedger(uid, nextLedger);
    }
  };

  const applyAuthenticatedBundle = (bundle: AuthenticatedWorkspaceBundle) => {
    document.title = "优竞体育内部专用 · 智能精算与风控工作台";
    setAuthUser(bundle.user);
    setAuthChecked(true);
    setAuthNotice(null);
    setOfflineMode(false);
    const resolvedLedger =
      bundle.ledger ??
      readCachedUserLedger(bundle.user.id) ??
      createEmptyLedgerSnapshot();
    syncLedgerState(resolvedLedger, bundle.user.id);
    setLimitDraft(String(resolvedLedger.dailyLimit));
    setStopLossPrompt(null);
    setEditingLimit(false);
    setWonPromptEntryId(null);
    betCtrl.applyAuthenticatedBundle(bundle);
    setComboSelectedIds(bundle.matches.slice(0, 3).map((m) => m.id));
    setSyncSummary(bundle.syncNote);
    const now = new Date();
    setSyncClock(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(
        now.getSeconds()
      ).padStart(2, "0")}`
    );
  };

  const hasMatchesRef = useRef<boolean>(false);
  hasMatchesRef.current = matches.length > 0;
  const offlineModeRef = useRef<boolean>(false);
  offlineModeRef.current = offlineMode;

  const syncRemainingAiQuota = (remaining?: number) => {
    if (remaining === undefined) return;
    setAuthUser((prev) =>
      prev
        ? { ...prev, aiUsedToday: Math.max(0, prev.dailyAiLimit - remaining) }
        : prev
    );
  };

  // 2. Initial 1-RTT Encrypted Handshake + WeChat-Style Permanent Login & Offline Reconnect Protection
  useEffect(() => {
    let alive = true;
    registerAuthRevokedHandler((reason) => {
      if (!alive) return;
      setAuthUser(null);
      setLedger(createEmptyLedgerSnapshot());
      setStopLossPrompt(null);
      setEditingLimit(false);
      setWonPromptEntryId(null);
      betCtrl.setBootstrapped(false);
      setAuthChecked(true);
      setAuthNotice(reason);
    });

    const runHandshake = async (isReconnect = false) => {
      if (!isReconnect) setSyncing(true);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const boot = await bootstrapSecureWorkspace(
            attempt > 0 || isReconnect
          );
          if (!alive) return;
          if (!boot.authenticated) {
            setAuthUser(null);
            setLedger(createEmptyLedgerSnapshot());
            betCtrl.setBootstrapped(false);
            setAuthChecked(true);
            if (boot.authError) setAuthNotice(boot.authError);
            break;
          }
          if (isReconnect && hasMatchesRef.current) {
            // Seamless silent reconnect after offline blip without wiping user's in-progress picks!
            setAuthUser(boot.user);
            if (boot.ledger) {
              syncLedgerState(boot.ledger, boot.user.id);
              setLimitDraft(String(boot.ledger.dailyLimit));
            }
            setOfflineMode(false);
            betCtrl.setBootstrapped(true);
            setSyncSummary(boot.syncNote);
          } else {
            applyAuthenticatedBundle(boot);
          }
          break;
        } catch (err) {
          if (String((err as Error)?.message) === "Fused") break;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 700));
          } else if (alive) {
            // WeChat Offline Guarantee: NEVER kick cached logged-in user out on transient network loss!
            const cached = readPersistedWechatAuth();
            if (cached?.cachedUser) {
              setAuthUser(cached.cachedUser);
              const cachedLedger = readCachedUserLedger(cached.cachedUser.id);
              if (cachedLedger) {
                setLedger(cachedLedger);
                setLimitDraft(String(cachedLedger.dailyLimit));
              }
              setOfflineMode(true);
              setAuthChecked(true);
              setSyncSummary(
                "当前网络离线波动 · 已保持长期免登状态，恢复联网后自动无感重连"
              );
            } else {
              setAuthChecked(true);
            }
          }
        }
      }
      if (alive && !isReconnect) setSyncing(false);
    };

    void runHandshake(false);

    const handleOnline = () => {
      if (readPersistedWechatAuth()?.authToken) {
        void runHandshake(true);
      }
    };
    const handleVisibility = () => {
      if (
        !document.hidden &&
        offlineModeRef.current &&
        readPersistedWechatAuth()?.authToken
      ) {
        void runHandshake(true);
      }
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      alive = false;
      registerAuthRevokedHandler(null);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const runOfficialSync = async (toastOnDone = false) => {
    setSyncing(true);
    try {
      const res = await requestServerMatchesSync(
        betCtrl.buildWorkspaceParams()
      );
      document.title = "优竞体育内部专用 · 智能精算与风控工作台";
      setOfflineMode(false);
      betCtrl.applyMatchesSync(res);
      const now = new Date();
      setSyncClock(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(
          now.getSeconds()
        ).padStart(2, "0")}`
      );
      setSyncSummary(res.syncNote);
      if (toastOnDone) {
        showSpringToast(
          layerRef.current,
          `已加密同步 ${res.matches.length} 场官网实盘`
        );
      }
    } catch (err) {
      if (err instanceof TypeError) setOfflineMode(true);
      if (toastOnDone)
        showSpringToast(layerRef.current, "同步繁忙，请稍后再试");
    } finally {
      setSyncing(false);
    }
  };

  // 3. Preset Demo Scenarios
  const loadPresetScenario = (kind: PresetScenarioKind) => {
    haptic(10);
    void betCtrl.loadPresetScenario(kind);
    const toastMap: Record<PresetScenarioKind, string> = {
      underwater: "已载入：半全场假中奖陷阱",
      synthetic: "已载入：半全场合成单关",
      parlay4: "已载入：4串1连乘抽水雪崩",
      hedge2: "已载入：早晚场时间差锁利",
    };
    showSpringToast(layerRef.current, toastMap[kind]);
    setTab("audit");
  };

  // 4. Parent ComparisonStage broadcast bridge
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.cmd === "setTab") {
        setSheet(null);
        setTab(d.value as AppTab);
      } else if (d.cmd === "openMore") {
        setTab("match");
        void betCtrl.setMode("mix");
        setTimeout(() => {
          const cur = betCtrl.getState().matches;
          if (cur[0]) setSheet({ type: "more", matchId: cur[0].id });
        }, 60);
      } else if (d.cmd === "openIntel") {
        setTab("match");
        setTimeout(() => {
          const cur = betCtrl.getState().matches;
          if (cur[0]) setSheet({ type: "intel", matchId: cur[0].id });
        }, 60);
      } else if (d.cmd === "openPoster") {
        setSheet({ type: "poster" });
      } else if (d.cmd === "timeScale") {
        setGlobalTimeScale(Number(d.value) || 1);
      } else if (d.cmd === "setSkin") {
        switchSkinSmooth(String(d.value), true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
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
    const order: AppTab[] = ["match", "archetypes", "audit", "ledger"];
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

  // 6. Server Black-Box Quant Sync & Pre-Computed Match Filtering
  const visibleMatches = useMemo(() => {
    const activeLeagues = Object.entries(leagueFilter)
      .filter(([, on]) => on)
      .map(([lg]) => lg);
    let list = matches;
    if (activeLeagues.length > 0)
      list = list.filter((m) => activeLeagues.includes(m.league));
    if (mode === "single" || qFilter === "single") {
      list = list.filter((m) => m.pools.HAD.single || m.pools.HHAD.single);
    } else if (qFilter === "low-vig") {
      list = list.filter((m) => m.pools.HAD.vig < 0.1228);
    } else if (qFilter === "drop") {
      list = list.filter((m) =>
        Object.values(m.pools).some((p) =>
          p.options.some((o) => o.trend === -1)
        )
      );
    } else if (qFilter === "arb") {
      list = list.filter((m) => (m.microQuant?.arbitrages?.length ?? 0) > 0);
    }
    return list.length > 0 ? list : matches;
  }, [matches, mode, qFilter, leagueFilter]);

  const resolvedTargets = useMemo(() => {
    const found = matches.filter((m) => targetIds.includes(m.id));
    return found.length > 0 ? found : matches.slice(0, 2);
  }, [matches, targetIds]);

  const manualReport = workspace.manualReport;
  const effectiveReport = workspace.effectiveReport;
  const appliedPlan = planSpec ? workspace.appliedPlan : null;
  const insights = workspace.insights;
  const allWarnings = workspace.allWarnings;
  const portfolioPlans = workspace.portfolioPlans?.length
    ? workspace.portfolioPlans
    : workspace.fivePlans;
  const alphaPlan = portfolioPlans.find(
    (p) => p.key === "alpha-radar" || p.key === "value-assassin"
  );
  const archOpts: Array<[PortfolioKey, string]> = [
    ["max-profit-prob", "稳健保本"],
    ["max-ev-utility", "期望效用"],
    ["max-cvar-wheel", "容错缩水"],
    [
      "alpha-radar",
      alphaPlan?.available === false ? "错价雷达·空仓" : "错价雷达",
    ],
  ];
  const currentArch =
    portfolioPlans.find((p) => p.key === archKey) ?? portfolioPlans[0];
  const fallbackValidArch =
    currentArch?.available !== false
      ? currentArch
      : (portfolioPlans.find((p) => p.available !== false) ??
        portfolioPlans[0]);
  const subjectiveEVPct = workspace.subjectiveEVPct;

  // 7. Persistent BetBar Amount Counter Choreography
  useLayoutEffect(() => {
    if (effectiveReport.totalCost !== prevAmtRef.current) {
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
  }, [tab, isDesktop, effectiveReport.matchCount, effectiveReport.totalCost]);

  useLayoutEffect(() => {
    const ledgerVisible =
      tab === "ledger" || (isDesktop && !embedded && dkRightTab === "ledger");
    if (ledgerVisible && balValRef.current) {
      animateNumber(
        balValRef.current,
        prevBalRef.current,
        ledger.dailyRemaining,
        (v) => `¥${v.toFixed(2)}`
      );
      prevBalRef.current = ledger.dailyRemaining;
    }
  }, [tab, isDesktop, embedded, dkRightTab, ledger.dailyRemaining]);

  // Danger shudder when manual underwater count increases
  const prevUwRef = useRef<number>(effectiveReport.underwaterCount);
  useEffect(() => {
    if (
      effectiveReport.underwaterCount > prevUwRef.current &&
      effectiveReport.underwaterCount > 0
    ) {
      shudderDangerElement(underwaterTileRef.current ?? slipRef.current);
    }
    prevUwRef.current = effectiveReport.underwaterCount;
  }, [effectiveReport.underwaterCount]);

  // Actions (delegated to deep BetSlipController; view layer handles only tactile & spring choreography)
  const isPicked = (matchId: string, poolCode: PoolCode, optKey: string) =>
    betCtrl.isPicked(matchId, poolCode, optKey);

  const isPoolMutexLocked = (m: MatchItem, poolCode: PoolCode) =>
    betCtrl.isPoolMutexLocked(m, poolCode);

  const togglePick = (
    el: HTMLElement | null,
    m: MatchItem,
    poolCode: PoolCode,
    optKey: string
  ) => {
    const verdict = betCtrl.togglePick(m, poolCode, optKey);
    if (!verdict.ok) {
      shudderDangerElement(el);
      haptic(16);
      showSpringToast(
        layerRef.current,
        verdict.blockedReason || "当前选项不可选"
      );
      return;
    }
    if (verdict.autoLockedSingleReason === "dual-single") {
      showSpringToast(
        layerRef.current,
        "同时选同场两个单关玩法，已按体彩规则自动锁定【单关】"
      );
    } else if (verdict.autoLockedSingleReason === "over-8-matches") {
      showSpringToast(
        layerRef.current,
        "超过 8 场赛事，已按体彩规则自动锁定【单关】"
      );
    }

    const removed = verdict.action === "removed";
    kickElement(el, removed ? -1.4 : 2.8);
    if (removed) {
      playTactileCue("tap-off");
    } else {
      playTactileCue("tap-on");
      const targetContainer =
        isDesktop && !embedded
          ? (auditCockpitRef.current ?? desktopAuditColRef.current)
          : slipRef.current;
      launchParabolicOrb(
        el,
        targetContainer,
        `+${verdict.optionLabel || ""}@${(verdict.odds ?? 0).toFixed(2)}`
      );
    }
  };

  const applyEquivalentSwap = (
    arb: EquivalentArbItem,
    triggerEl?: HTMLElement | null
  ) => {
    const applied = betCtrl.applyEquivalentSwap(arb);
    if (!applied) return;
    playTactileCue("optimize-arpeggio");
    if (triggerEl) burstCelebrationSparks(triggerEl, 16);
    showSpringToast(layerRef.current, `已切换高水同义项 · ${arb.betterChoice}`);
  };

  const applyArchetype = (plan: ArchetypePlan) => {
    if (!betCtrl.applyArchetype(plan)) return;
    playTactileCue("defuse-celebrate");
    triggerShimmerSweep(auditCockpitRef.current);
    burstCelebrationSparks(auditCockpitRef.current, 26);
    showSpringToast(layerRef.current, `已套用 · ${plan.shortTab}`);
    setTab("audit");
  };

  const restoreEqualMultiple = () => {
    betCtrl.restoreEqualMultiple();
    playTactileCue("tap-off");
    showSpringToast(layerRef.current, "已恢复默认等倍统配");
  };

  const scaleAppliedPlanBy = (factor: number) => {
    betCtrl.scaleAppliedPlanBy(factor);
    haptic(8);
    showSpringToast(layerRef.current, `智能分倍方案已扩倍 ×${factor}`);
  };

  const applyBonusOptimization = (
    optMode: BonusOptMode,
    triggerEl?: HTMLElement | null
  ) => {
    const res = betCtrl.applyBonusOptimization(optMode);
    if (!res.ok) return;
    playTactileCue("optimize-arpeggio");
    triggerShimmerSweep(auditCockpitRef.current);
    burstCelebrationSparks(triggerEl ?? auditCockpitRef.current, 22);
    showSpringToast(layerRef.current, `已启用 · ${res.modeTitle}`);
  };

  const upgradeToZeroUnderwater = (triggerEl?: HTMLElement | null) => {
    applyBonusOptimization("equal", triggerEl);
    playTactileCue("defuse-celebrate");
  };

  const applyDirectMultiple = (nextRaw: number) => {
    betCtrl.setDirectMultiple(nextRaw);
    if (mulValRef.current) {
      fxOf(mulValRef.current).scale.kick(1.4);
    }
    haptic(4);
  };

  const stepMultiple = (delta: number) => {
    betCtrl.stepMultiple(delta);
    if (mulValRef.current) {
      const f = fxOf(mulValRef.current);
      f.ty.jump(delta > 0 ? 8 : -8);
      f.ty.config(520, 20).set(0);
      f.scale.kick(1.6);
    }
    haptic(5);
  };

  const toggleFreePassSize = (size: number) => {
    const res = betCtrl.toggleFreePassSize(size);
    if (!res.ok) {
      haptic(12);
      showSpringToast(
        layerRef.current,
        res.reason || "当前选单不满足该过关条件"
      );
      return;
    }
    haptic(6);
  };

  const selectComboPass = (code: string) => {
    const res = betCtrl.selectComboPass(code);
    if (!res.ok) {
      haptic(12);
      showSpringToast(
        layerRef.current,
        res.reason || "当前选单不可选该多串组合"
      );
      return;
    }
    haptic(7);
  };

  const handleModeChange = (nextMode: MatchMode) => {
    const { trimmed } = betCtrl.setMode(nextMode);
    if (trimmed) {
      showSpringToast(
        layerRef.current,
        "切换至混合/单项过关，同场仅保留单一玩法"
      );
    }
  };

  const currentRadarSig = useMemo(() => buildRadarSignature(picks), [picks]);

  const syncRadarPicksToArchetypes = () => {
    const res = betCtrl.syncRadarPicksToArchetypes();
    if (!res.ok) {
      haptic(12);
      showSpringToast(
        layerRef.current,
        "请先在【赛事雷达】点选至少 1 场想买的球队"
      );
      if (!isDesktop || embedded) setTab("match");
      return;
    }
    playTactileCue("optimize-arpeggio");
    showSpringToast(
      layerRef.current,
      `已匹配赛事雷达 ${res.syncedCount} 场已选球队并锚定推荐方向`
    );
  };

  const buildCurrentLedgerDraft = (): LedgerDraftPayload | null => {
    if (
      effectiveReport.matchCount === 0 ||
      !effectiveReport.canCheckout ||
      effectiveReport.totalCost <= 0
    ) {
      shudderDangerElement(auditCockpitRef.current ?? slipRef.current);
      haptic(14);
      showSpringToast(
        layerRef.current,
        effectiveReport.ruleBlockReason ||
          "当前方案未满足出票条件，暂无法记入账本"
      );
      return null;
    }
    const title = appliedPlan
      ? `${effectiveReport.modeLabel} · ${appliedPlan.shortTab}(${appliedPlan.lines.length}张)`
      : `${effectiveReport.modeLabel} · ${effectiveReport.betCount}注方案`;
    return {
      title,
      modeLabel: effectiveReport.modeLabel,
      betCount: Math.max(1, effectiveReport.betCount),
      cost: effectiveReport.totalCost,
      paperRefCost: effectiveReport.totalCost,
      minPayout: effectiveReport.minPayout,
      maxPayout: effectiveReport.maxPayout,
    };
  };

  const submitLedgerEntry = async (
    draft: LedgerDraftPayload,
    kind: "live" | "paper",
    forceConfirmed = false
  ) => {
    if (ledgerBusy) return;
    setLedgerBusy(true);
    try {
      const res = await mutateServerLedger({
        action: "add-entry",
        kind,
        title: draft.title,
        modeLabel: draft.modeLabel,
        betCount: draft.betCount,
        cost: kind === "live" ? draft.cost : 0,
        paperRefCost: kind === "paper" ? draft.paperRefCost : undefined,
        minPayout: draft.minPayout,
        maxPayout: draft.maxPayout,
        forceConfirmed,
      });
      syncLedgerState(res.ledger);
      if (!res.ok && res.code === "STOP_LOSS_EXCEEDED") {
        shudderDangerElement(auditCockpitRef.current ?? slipRef.current);
        haptic(20);
        setStopLossPrompt({
          draft,
          dailyLimit: res.dailyLimit,
          dailyRemaining: res.dailyRemaining,
          overBy: res.overBy,
        });
        return;
      }
      setStopLossPrompt(null);
      haptic(14);
      playTactileCue(kind === "paper" ? "optimize-arpeggio" : "ticket-stamp");
      showSpringToast(
        layerRef.current,
        kind === "live"
          ? `已记入实买账本（本金 ¥${draft.cost}）`
          : `已存为 0 成本模拟观察单（拟投 ¥${draft.paperRefCost}）`
      );
      setTab("ledger");
      setDkRightTab("ledger");
    } catch (err) {
      if (err instanceof TypeError) setOfflineMode(true);
      showSpringToast(
        layerRef.current,
        (err as Error)?.message || "当前网络离线，请恢复连接后再记账"
      );
    } finally {
      setLedgerBusy(false);
    }
  };

  const recordToLedger = (kind: "live" | "paper") => {
    const draft = buildCurrentLedgerDraft();
    if (!draft) return;
    void submitLedgerEntry(draft, kind, false);
  };

  const handleSaveDailyLimit = async () => {
    const parsed = Math.round(Number(limitDraft));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      showSpringToast(
        layerRef.current,
        "请输入有效的每日止损上限（¥20 ~ ¥100000）"
      );
      return;
    }
    if (ledgerBusy) return;
    setLedgerBusy(true);
    try {
      const res = await mutateServerLedger({
        action: "set-daily-limit",
        dailyLimit: parsed,
      });
      if (res.ok) {
        syncLedgerState(res.ledger);
        setLimitDraft(String(res.ledger.dailyLimit));
        setEditingLimit(false);
        haptic(8);
        showSpringToast(
          layerRef.current,
          `已更新每日止损护栏上限 ¥${res.ledger.dailyLimit}`
        );
      }
    } catch (err) {
      if (err instanceof TypeError) setOfflineMode(true);
      showSpringToast(
        layerRef.current,
        (err as Error)?.message || "止损上限更新失败"
      );
    } finally {
      setLedgerBusy(false);
    }
  };

  const handleSettleEntry = async (
    entry: LedgerEntry,
    status: "pending" | "won" | "lost",
    customReturn?: number
  ) => {
    if (ledgerBusy) return;
    setLedgerBusy(true);
    try {
      const res = await mutateServerLedger({
        action: "settle-entry",
        entryId: entry.id,
        status,
        settledReturn:
          status === "won" && entry.kind === "live" ? customReturn : undefined,
      });
      if (res.ok) {
        syncLedgerState(res.ledger);
        setWonPromptEntryId(null);
        haptic(10);
        if (status === "won") playTactileCue("defuse-celebrate");
        const msg =
          status === "pending"
            ? "已重置为待开奖状态"
            : status === "won"
              ? entry.kind === "live"
                ? "已结算红单并更新累计净盈亏"
                : "已标记模拟观察单命中"
              : entry.kind === "paper"
                ? `已标记未中 · 计入累计免损 ¥${entry.paperRefCost.toFixed(0)}`
                : "已结算黑单并更新累计净盈亏";
        showSpringToast(layerRef.current, msg);
      }
    } catch (err) {
      if (err instanceof TypeError) setOfflineMode(true);
      showSpringToast(
        layerRef.current,
        (err as Error)?.message || "结算状态更新失败"
      );
    } finally {
      setLedgerBusy(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (ledgerBusy) return;
    setLedgerBusy(true);
    try {
      const res = await mutateServerLedger({
        action: "delete-entry",
        entryId,
      });
      if (res.ok) {
        syncLedgerState(res.ledger);
        if (wonPromptEntryId === entryId) setWonPromptEntryId(null);
        haptic(8);
        showSpringToast(layerRef.current, "已删除该条账本记录");
      }
    } catch (err) {
      if (err instanceof TypeError) setOfflineMode(true);
      showSpringToast(
        layerRef.current,
        (err as Error)?.message || "删除账本记录失败"
      );
    } finally {
      setLedgerBusy(false);
    }
  };

  const pickedMatchIds = useMemo(
    () => Array.from(new Set(picks.map((p) => p.matchId))),
    [picks]
  );

  const renderTrendArrow = (trend?: -1 | 0 | 1) => {
    if (trend === 1)
      return (
        <i className="trd up" title="水位上调(红升)">
          ▲
        </i>
      );
    if (trend === -1)
      return (
        <i className="trd dn" title="水位下调(绿降)">
          ▼
        </i>
      );
    return null;
  };

  const handleExplicitLogout = async () => {
    await logoutSession();
    setAuthUser(null);
    setLedger(createEmptyLedgerSnapshot());
    setStopLossPrompt(null);
    setEditingLimit(false);
    setWonPromptEntryId(null);
    betCtrl.setBootstrapped(false);
    setAdminOpen(false);
    setAuthNotice("已安全退出当前账号");
  };

  const triggerXiaoGaoLive = async (m: MatchItem, extraNote?: string) => {
    if (diagnosingMatchId || diagnosingCombo) return;
    setDiagnosingMatchId(m.id);
    playTactileCue("radar-ping");
    try {
      const { alert, aiRemaining } = await requestXiaoGaoDiagnosis(
        m.id,
        extraNote
      );
      syncRemainingAiQuota(aiRemaining);
      await betCtrl.applyMatchAiAlert(m.id, alert);
      playTactileCue("radar-lock");
      showSpringToast(layerRef.current, "扫地僧小高已完成单场实时排雷");
    } catch (err) {
      showSpringToast(
        layerRef.current,
        (err as Error)?.message || "诊盘繁忙，请稍后再试"
      );
    } finally {
      setDiagnosingMatchId(null);
    }
  };

  const triggerXiaoGaoComboLive = async (sourceMode: "picked" | "custom") => {
    if (diagnosingCombo || diagnosingMatchId) return;
    const ids = sourceMode === "picked" ? pickedMatchIds : comboSelectedIds;
    const targetList = matches.filter((m) => ids.includes(m.id));
    if (targetList.length < 2) {
      showSpringToast(
        layerRef.current,
        "请至少选择 2 场比赛再发起多场联合会诊"
      );
      return;
    }
    setDiagnosingCombo(true);
    playTactileCue("radar-ping");
    try {
      const { comboReport: rep, aiRemaining } =
        await requestXiaoGaoComboDiagnosis({
          sourceMode,
          matchIds: targetList.map((m) => m.id),
          picks: sourceMode === "picked" ? picks : [],
          multiple,
          passSpec,
          planSpec,
          subjectiveDeltaPct,
          simVoidFirstMatch,
          userNote: customIntelInput || undefined,
        });
      syncRemainingAiQuota(aiRemaining);
      setComboReport(rep);
      if (Array.isArray(rep.perMatch) && rep.perMatch.length > 0) {
        await betCtrl.applyComboAiReport(rep);
      }
      playTactileCue("radar-lock");
      showSpringToast(
        layerRef.current,
        `已完成 ${targetList.length} 场串关联合排雷会诊`
      );
    } catch (err) {
      showSpringToast(
        layerRef.current,
        (err as Error)?.message || "联合会诊繁忙，请稍后再试"
      );
    } finally {
      setDiagnosingCombo(false);
    }
  };

  const sheetMatch =
    sheet && (sheet.type === "more" || sheet.type === "intel")
      ? (matches.find((m) => m.id === sheet.matchId) ?? matches[0])
      : null;

  const extraCountOf = (mId: string) =>
    picks.filter(
      (p) => p.matchId === mId && p.poolCode !== "HAD" && p.poolCode !== "HHAD"
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
          ["all", "全部"],
          ["single", "⚡单关"],
          ["low-vig", "浅抽水"],
          ["drop", "🔻急降水"],
          ["arb", "省钱差价"],
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
          className={`fchip ${qFilter === fid ? "on" : ""}`}
        >
          {flbl}
        </button>
      ))}
      <button
        type="button"
        data-spring="0.9"
        onClick={() => loadPresetScenario("underwater")}
        className="fchip demo"
      >
        演:假中奖
      </button>
      <button
        type="button"
        data-spring="0.9"
        onClick={() => loadPresetScenario("hedge2")}
        className="fchip demo"
      >
        演:早晚锁利
      </button>
      <button
        type="button"
        data-spring="0.9"
        onClick={() => loadPresetScenario("parlay4")}
        className="fchip demo"
      >
        演:4串1雪崩
      </button>
    </div>
  );

  const matchContent = (
    <>
      {["mix", "spf", "single"].includes(mode) && (
        <div className="mgrid colhead enter">
          <span style={{ textAlign: "left" }}>球队 / 排名</span>
          <span>让</span>
          <span>胜(真率)</span>
          <span>平(真率)</span>
          <span>负(真率)</span>
        </div>
      )}

      {visibleMatches.map((m) => {
        const mq = m.microQuant;
        const extN = extraCountOf(m.id);
        const crsSelected = picks
          .filter((p) => p.matchId === m.id && p.poolCode === "CRS")
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
                  <span style={{ fontSize: 9.5, opacity: 0.72 }}>
                    仅半/比单关
                  </span>
                )}
              </div>
              <button
                type="button"
                className="more num"
                data-spring="0.9"
                onClick={() => setSheet({ type: "more", matchId: m.id })}
              >
                <span>{m.kickoff} · 全玩法</span>
                <span className="more-ind">
                  {extN > 0 ? (
                    <b className="badge num">+{extN}</b>
                  ) : (
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
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
              onClick={() => setSheet({ type: "intel", matchId: m.id })}
            >
              <i style={{ width: `${hP}%` }} />
              <i style={{ width: `${dP}%` }} />
              <i style={{ width: `${aP}%` }} />
            </div>

            {/* Layer 3: Rich Quant Micro-Pills (xG + Card-Pan + Vig Compare + Arbitrage) */}
            <div
              className="qstrip num"
              onClick={() => setSheet({ type: "intel", matchId: m.id })}
            >
              <span className="qpill">
                xG {mq.homeXG}:{mq.awayXG}
              </span>
              <span
                className={`qpill ${mq.oneGoalShareOfWins >= 0.5 ? "warn" : ""}`}
              >
                赢1球卡盘 {(mq.oneGoalShareOfWins * 100).toFixed(0)}%
              </span>
              <span className="qpill">
                主抽{(m.pools.HAD.vig * 100).toFixed(1)}%/半
                {(m.pools.HAFU.vig * 100).toFixed(0)}%
              </span>
              {mq.arbitrages[0] && (
                <span className="qpill hi">省+{mq.arbitrages[0].edgePct}%</span>
              )}
            </div>

            {/* Layer 4: Mode-Specific Odds Matrix with True Fair Prob % inside EVERY button */}
            {mode === "zjq" ? (
              <>
                <div
                  className="duel"
                  data-spring="0.98"
                  onClick={() => setSheet({ type: "intel", matchId: m.id })}
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
                {m.pools.TTG.selling === false ||
                m.pools.TTG.options.length === 0 ? (
                  <button
                    type="button"
                    className="key wide unsold num"
                    onClick={(e) =>
                      togglePick(e.currentTarget, m, "TTG", "closed")
                    }
                  >
                    总进球玩法暂未开售
                  </button>
                ) : (
                  <div className="grid-keys c4">
                    {m.pools.TTG.options.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        data-spring="0.86"
                        onClick={(e) =>
                          togglePick(e.currentTarget, m, "TTG", opt.key)
                        }
                        className={`key cell num ${isPicked(m.id, "TTG", opt.key) ? "on" : ""} ${
                          isPoolMutexLocked(m, "TTG") ? "mutex-lock" : ""
                        }`}
                      >
                        <small>
                          {opt.label} · {(opt.fairProb * 100).toFixed(0)}%
                        </small>
                        <b>
                          {opt.odds.toFixed(2)}
                          {renderTrendArrow(opt.trend)}
                        </b>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : mode === "bqc" ? (
              <>
                <div
                  className="duel"
                  data-spring="0.98"
                  onClick={() => setSheet({ type: "intel", matchId: m.id })}
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
                {m.pools.HAFU.selling === false ||
                m.pools.HAFU.options.length === 0 ? (
                  <button
                    type="button"
                    className="key wide unsold num"
                    onClick={(e) =>
                      togglePick(e.currentTarget, m, "HAFU", "closed")
                    }
                  >
                    半全场玩法暂未开售
                  </button>
                ) : (
                  <div className="grid-keys c3">
                    {m.pools.HAFU.options.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        data-spring="0.86"
                        onClick={(e) =>
                          togglePick(e.currentTarget, m, "HAFU", opt.key)
                        }
                        className={`key cell num ${isPicked(m.id, "HAFU", opt.key) ? "on" : ""} ${
                          isPoolMutexLocked(m, "HAFU") ? "mutex-lock" : ""
                        }`}
                      >
                        <small>
                          {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                        </small>
                        <b>
                          {opt.odds.toFixed(2)}
                          {renderTrendArrow(opt.trend)}
                        </b>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : mode === "bf" ? (
              <>
                <div
                  className="duel"
                  data-spring="0.98"
                  onClick={() => setSheet({ type: "intel", matchId: m.id })}
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
                {m.pools.CRS.selling === false ||
                m.pools.CRS.options.length === 0 ? (
                  <button
                    type="button"
                    className="key wide unsold num"
                    onClick={(e) =>
                      togglePick(e.currentTarget, m, "CRS", "closed")
                    }
                  >
                    比分玩法暂未开售
                  </button>
                ) : (
                  <button
                    type="button"
                    data-spring="0.95"
                    onClick={() => setSheet({ type: "more", matchId: m.id })}
                    className={`key wide num ${crsSelected.length > 0 ? "on" : ""} ${
                      isPoolMutexLocked(m, "CRS") ? "mutex-lock" : ""
                    }`}
                  >
                    {crsSelected.length > 0
                      ? crsSelected.join(" · ")
                      : "+ 展开全部 31 项比分选项 (含真率)"}
                  </button>
                )}
              </>
            ) : (
              <div className="mgrid">
                <div
                  className="teams"
                  data-spring="0.97"
                  onClick={() => setSheet({ type: "intel", matchId: m.id })}
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
                  <div>
                    {m.pools.HAD.selling === false ||
                    m.pools.HAD.options.length === 0 ? (
                      <span className="rq-unsold">未</span>
                    ) : (
                      <>
                        <span>0</span>
                        {m.pools.HAD.single && <i className="rq-sgl">单</i>}
                      </>
                    )}
                  </div>
                  <div>
                    {m.pools.HHAD.selling === false ||
                    m.pools.HHAD.options.length === 0 ? (
                      <span className="rq-unsold">未</span>
                    ) : (
                      <>
                        <span>
                          {(m.pools.HHAD.goalLine ?? "-1").replace("-", "−")}
                        </span>
                        {m.pools.HHAD.single && <i className="rq-sgl">单</i>}
                      </>
                    )}
                  </div>
                </div>
                {[0, 1, 2].map((idx) => {
                  const hadOpt = m.pools.HAD.options[idx];
                  const hhadOpt = m.pools.HHAD.options[idx];
                  const hadOpen =
                    m.pools.HAD.selling !== false && Boolean(hadOpt);
                  const hhadOpen =
                    m.pools.HHAD.selling !== false && Boolean(hhadOpt);
                  return (
                    <div key={idx} className="kcol">
                      {hadOpen && hadOpt ? (
                        <button
                          type="button"
                          data-spring="0.88"
                          onClick={(e) =>
                            togglePick(e.currentTarget, m, "HAD", hadOpt.key)
                          }
                          className={`key k2 num ${isPicked(m.id, "HAD", hadOpt.key) ? "on" : ""} ${
                            isPoolMutexLocked(m, "HAD") ? "mutex-lock" : ""
                          }`}
                        >
                          <span className="ko">
                            {hadOpt.odds.toFixed(2)}
                            {renderTrendArrow(hadOpt.trend)}
                          </span>
                          <span className="kp">
                            {(hadOpt.fairProb * 100).toFixed(0)}%
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) =>
                            togglePick(e.currentTarget, m, "HAD", "closed")
                          }
                          className="key k2 unsold num"
                        >
                          <span className="ko">—</span>
                          <span className="kp">未开售</span>
                        </button>
                      )}
                      {hhadOpen && hhadOpt ? (
                        <button
                          type="button"
                          data-spring="0.88"
                          onClick={(e) =>
                            togglePick(e.currentTarget, m, "HHAD", hhadOpt.key)
                          }
                          className={`key k2 num ${isPicked(m.id, "HHAD", hhadOpt.key) ? "on" : ""} ${
                            isPoolMutexLocked(m, "HHAD") ? "mutex-lock" : ""
                          }`}
                        >
                          <span className="ko">
                            {hhadOpt.odds.toFixed(2)}
                            {renderTrendArrow(hhadOpt.trend)}
                          </span>
                          <span className="kp">
                            {(hhadOpt.fairProb * 100).toFixed(0)}%
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) =>
                            togglePick(e.currentTarget, m, "HHAD", "closed")
                          }
                          className="key k2 unsold num"
                        >
                          <span className="ko">—</span>
                          <span className="kp">未开售</span>
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
                onClick={() => setSheet({ type: "intel", matchId: m.id })}
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

  const cappedRadarIds = useMemo(
    () => pickedMatchIds.slice(0, 8),
    [pickedMatchIds]
  );
  const isTargetMatchingRadar = useMemo(
    () =>
      cappedRadarIds.length > 0 &&
      cappedRadarIds.length === resolvedTargets.length &&
      cappedRadarIds.every((id) => resolvedTargets.some((t) => t.id === id)) &&
      currentRadarSig === syncedRadarSig,
    [cappedRadarIds, resolvedTargets, currentRadarSig, syncedRadarSig]
  );
  const isFullySyncedToRadar = anchorToRadarPicks && isTargetMatchingRadar;

  const archetypesContent = currentArch ? (
    <>
      {/* 🎯 新增：对齐扫地僧小高排雷舱的「一键匹配赛事雷达已选球队」联动总入口 */}
      <div
        className={`card radar-sync-card enter ${isFullySyncedToRadar ? "synced" : ""}`}
        style={{ marginBottom: 10 }}
      >
        <div className="radar-sync-head">
          <span className="radar-sync-title">
            <span>🎯 赛事雷达选队联动锚定</span>
          </span>
          <span className="qpill num">
            {isFullySyncedToRadar
              ? `✅ 已锚定雷达选队 (${cappedRadarIds.length}场)`
              : pickedMatchIds.length > 0
                ? `雷达已选 ${pickedMatchIds.length} 场`
                : "纯盘面客观模式"}
          </span>
        </div>
        <div className="radar-sync-sub">
          {isFullySyncedToRadar
            ? "当前精算配单（3+1 方案）已严格围绕你在【赛事雷达】亲手点选的球队/让球方向做精算配单，绝不违背你的看球意向反推对立面。"
            : "和小高排雷一样，点击下方按钮即可一键读取你在最左栏【赛事雷达】选过的比赛与球队方向，生成专属精算配单（3+1 方案）。"}
        </div>
        <div className="radar-sync-acts">
          <button
            type="button"
            data-spring="0.92"
            className={`key main-btn num ${isFullySyncedToRadar ? "on" : "dark"}`}
            onClick={syncRadarPicksToArchetypes}
          >
            {pickedMatchIds.length === 0
              ? "🎯 一键匹配赛事雷达已选球队（去选球）"
              : isFullySyncedToRadar
                ? `✅ 已匹配赛事雷达已选球队（${cappedRadarIds.length} 场）`
                : anchorToRadarPicks && !isTargetMatchingRadar
                  ? `🔄 雷达选单已更新（${cappedRadarIds.length} 场），点此同步`
                  : `🎯 一键匹配赛事雷达已选球队（已选 ${cappedRadarIds.length} 场）`}
          </button>
          {anchorToRadarPicks && (
            <button
              type="button"
              data-spring="0.88"
              className="key sm"
              onClick={() => {
                haptic(5);
                setAnchorToRadarPicks(false);
                showSpringToast(layerRef.current, "已切回纯客观盘面自由选池");
              }}
            >
              纯盘面重选
            </button>
          )}
        </div>
      </div>

      {/* 🩺 Restored: 买法不划算纠偏医生实时对比卡 */}
      {hasSuboptimalManual && fallbackValidArch && (
        <div className="card enter" style={{ marginBottom: 10 }}>
          <div className="note-box alert">
            <strong>🩺 买法不划算纠偏诊断：</strong>
            你当前自选暗扣抽水 <strong>{manualReport.avgVigLossPer100}%</strong>
            {manualReport.underwaterCount > 0 && (
              <>
                ，且有{" "}
                <strong>
                  {manualReport.underwaterCount} 种结果假中奖倒亏钱
                </strong>
                （真赚率仅 {(manualReport.realProfitProb * 100).toFixed(1)}%）
              </>
            )}
            ！改用下方【{fallbackValidArch.shortTab}】可立消假中奖，真赚率提升至{" "}
            <strong>{(fallbackValidArch.profitProb * 100).toFixed(1)}%</strong>
            。
          </div>
        </div>
      )}

      <div className="sec-lbl enter">
        <span>① 目标对决池 (自由点选 1~8 场想买的球)</span>
        <span
          className="num"
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          <span>已圈 {resolvedTargets.length}/8 场</span>
          {matches.length > 2 && (
            <button
              type="button"
              className="help-pill"
              onClick={() => {
                haptic(6);
                void betCtrl.selectTargetSlice(8);
              }}
            >
              全选{Math.min(8, matches.length)}场
            </button>
          )}
          {resolvedTargets.length !== 2 && matches.length >= 2 && (
            <button
              type="button"
              className="help-pill"
              onClick={() => {
                haptic(5);
                void betCtrl.selectTargetSlice(2);
              }}
            >
              重置2场
            </button>
          )}
        </span>
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
                void betCtrl.toggleTargetMatch(m.id);
              }}
              className={`key pillk num ${on ? "on" : ""}`}
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
                ["objective", "纯客观"],
                ["home-lean", "偏主队"],
                ["upset-watch", "防爆冷"],
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
                className={`key ${stance === k ? "on" : ""}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {(currentArch.key === "alpha-radar" ||
          currentArch.key === "value-assassin") && (
          <div className="row">
            <span className="lbl">36% 自动轻仓护本垫</span>
            <SpringSwitch
              checked={!unlockFullAgg}
              onChange={(keepSafe) => setUnlockFullAgg(!keepSafe)}
            />
          </div>
        )}
      </div>

      {currentArch.available === false ? (
        <>
          <div className="card enter">
            <div className="co-head">
              <div>
                <div className="h2">
                  {currentArch.badge} · {currentArch.title}
                </div>
                <div className="small">
                  {currentArch.emptyReason ||
                    `当前盘面定价严密，无跨盘错价洼地 · 建议空仓省下 ¥${currentArch.savedCash} 或采用前 3 档主方案`}
                </div>
              </div>
              <span className="chip num" style={{ flexShrink: 0 }}>
                ¥0<i>省¥{currentArch.savedCash}</i>
              </span>
            </div>
            <div className="note-box" style={{ marginTop: 8 }}>
              <strong>🛡️ 宁缺毋滥 · 诚实空仓省钱纪律：</strong>
              <div>
                {currentArch.emptyReason ||
                  `当前盘面定价严密，无跨盘错价洼地 · 建议空仓省下 ¥${currentArch.savedCash}，绝不硬凑高抽水废单。`}
              </div>
              {currentArch.reasons
                .filter((r) => r !== currentArch.emptyReason)
                .map((r, idx) => (
                  <div key={idx}>· {r}</div>
                ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              disabled
              className="key full enter"
              style={{ opacity: 0.55, cursor: "not-allowed" }}
            >
              当前无真错价洼地（建议空仓省下 ¥{currentArch.savedCash}）
            </button>
            <button
              type="button"
              data-spring="0.94"
              className="key dark full enter"
              onClick={() => {
                haptic(6);
                setArchKey("max-profit-prob");
              }}
            >
              👉 切往【① 稳健保本】主方案
            </button>
          </div>
        </>
      ) : (
        <>
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
              <div
                className={`tile ${(currentArch.underwaterCount ?? 0) > 0 ? "danger" : ""}`}
              >
                <span>
                  {currentArch.missOneReturn !== null
                    ? "错1场保命回血"
                    : "命中返奖区间"}
                </span>
                <b>
                  {currentArch.missOneReturn !== null
                    ? `¥${currentArch.missOneReturn.toFixed(0)} (全中¥${currentArch.maxReturn.toFixed(0)})`
                    : `¥${currentArch.minReturn.toFixed(0)}~${currentArch.maxReturn.toFixed(0)}`}
                </b>
                <em>
                  {(currentArch.underwaterCount ?? 0) > 0
                    ? `⚠️ 含 ${currentArch.underwaterCount} 组局部回血(<本金)`
                    : "0 假中奖倒贴"}
                </em>
              </div>
              {(() => {
                const archEvPct = currentArch.expectedValueRate * 100;
                const payoutReturnPct = Math.max(
                  0,
                  100 - currentArch.vigPct
                ).toFixed(1);
                return (
                  <div className="tile">
                    <span>数学期望与抽水</span>
                    <b>
                      {archEvPct >= 0 ? "+" : ""}
                      {archEvPct.toFixed(1)}%
                    </b>
                    <em>票面返还 {payoutReturnPct}%</em>
                  </div>
                );
              })()}
              <div className="tile">
                <span>店面合票张数</span>
                <b>{currentArch.lines.length} 张实票</b>
                <em>
                  {typeof currentArch.wipeoutMiss2Prob === "number"
                    ? `错≥2场击穿 ${(currentArch.wipeoutMiss2Prob * 100).toFixed(1)}%`
                    : "已做整数倍配平"}
                </em>
              </div>
            </div>
          </div>

          {/* Detailed Per-Ticket Breakdown with Odds & Probability */}
          {currentArch.lines.map((line) => (
            <div key={line.id} className="card opt-row enter">
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>
                  {line.legs
                    .map(
                      (g) => `${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`
                    )
                    .join(" × ")}
                </b>
                <div className="s num">
                  {line.roleLabel} · {line.modeLabel} · 真率
                  {(line.prob * 100).toFixed(1)}% · {line.multiple}倍(¥
                  {line.cost})
                </div>
              </div>
              <div className="r num">
                ¥{line.returnPayout.toFixed(2)}
                <small
                  style={{
                    color:
                      line.netProfit >= 0 ? "var(--good)" : "var(--text-3)",
                  }}
                >
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
            套用【{currentArch.shortTab}】方案并查看审单台 (¥
            {currentArch.totalCost})
          </button>
        </>
      )}
    </>
  ) : null;

  const auditContent = (
    <>
      {effectiveReport.matchCount === 0 ? (
        <div className="empty enter">
          <div className="orb">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
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
              setTab("archetypes");
              setDkRightTab("archetypes");
            }}
          >
            去 3+1 精算配单
          </button>
        </div>
      ) : (
        <>
          {/* 三模智能奖金优化器 (平均优化 / 博热保本 / 博冷高弹 + 动态弹簧奖金天平柱状图) */}
          <div ref={auditCockpitRef} className="card enter yj-shimmer-host">
            <div className="co-head" style={{ marginBottom: 8 }}>
              <span className="sec num" style={{ margin: 0 }}>
                ⚖️ 智能奖金优化分倍器
              </span>
              <button
                type="button"
                className="help-pill"
                onClick={() => openManual("optimizer")}
              >
                📘 优化原理图解
              </button>
            </div>
            <div className="pass">
              <button
                type="button"
                data-spring="0.88"
                className={`key ${appliedPlan?.shortTab === "平均优化" ? "on" : ""}`}
                onClick={(e) =>
                  applyBonusOptimization("equal", e.currentTarget)
                }
              >
                ① 平均优化
              </button>
              <button
                type="button"
                data-spring="0.88"
                className={`key ${appliedPlan?.shortTab === "博热保本" ? "on" : ""}`}
                onClick={(e) =>
                  applyBonusOptimization("hot-first", e.currentTarget)
                }
              >
                ② 博热保本
              </button>
              <button
                type="button"
                data-spring="0.88"
                className={`key ${appliedPlan?.shortTab === "博冷高弹" ? "on" : ""}`}
                onClick={(e) =>
                  applyBonusOptimization("cold-first", e.currentTarget)
                }
              >
                ③ 博冷高弹
              </button>
              {appliedPlan && (
                <button
                  type="button"
                  data-spring="0.88"
                  className="key"
                  onClick={restoreEqualMultiple}
                >
                  还原等倍
                </button>
              )}
            </div>
            <PayoutEqualizerBars
              combos={[...effectiveReport.combos]
                .sort((a, b) => b.prob - a.prob)
                .map((c) => ({
                  id: c.id,
                  label: c.desc,
                  totalPayout: c.totalPayout,
                  prob: c.prob,
                }))}
              totalCost={effectiveReport.totalCost}
            />
          </div>
          {/* Multi-Match Joint Parlay Diagnosis Quick Trigger right inside Audit! */}
          {pickedMatchIds.length >= 2 && (
            <div
              className={`card sonar-card enter ${diagnosingCombo ? "scanning" : ""}`}
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <div className="co-head" style={{ marginBottom: 0 }}>
                <span className="sec num" style={{ margin: 0 }}>
                  🧹 多场串关联合会诊（已选 {pickedMatchIds.length} 场）
                </span>
                <button
                  type="button"
                  data-spring="0.88"
                  className="key mini dark"
                  onClick={() => {
                    void triggerXiaoGaoComboLive("picked");
                    if (isDesktop && !embedded) setDkRightTab("ledger");
                  }}
                >
                  {diagnosingCombo
                    ? "小高联合把脉中..."
                    : `一键联合会诊这 ${pickedMatchIds.length} 场`}
                </button>
              </div>
              {comboReport && (
                <div className="note-box" style={{ marginTop: 2 }}>
                  <strong>
                    [{comboReport.comboTag}] 最弱短板：{comboReport.weakestLeg}
                  </strong>
                  <div>{comboReport.summary}</div>
                  <div
                    style={{
                      marginTop: 3,
                      fontWeight: 600,
                      color: "var(--mark)",
                    }}
                  >
                    改单建议：{comboReport.structureAdvice}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Selected Match Chips with Live Trend Arrows & Single-Match Quick Diagnosis */}
          {pickedMatchIds.map((mid) => {
            const mpicks = picks.filter((p) => p.matchId === mid);
            const first = mpicks[0];
            const fullMatch = matches.find((x) => x.id === mid);
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
                  <div style={{ display: "flex", gap: 5 }}>
                    {fullMatch && (
                      <button
                        type="button"
                        className="key mini"
                        data-spring="0.85"
                        onClick={() => void triggerXiaoGaoLive(fullMatch)}
                      >
                        {diagnosingMatchId === mid ? "诊盘中" : "单诊"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="key mini"
                      data-spring="0.85"
                      onClick={() => {
                        void betCtrl.removeMatchFromSlip(mid);
                        haptic(6);
                      }}
                    >
                      移除
                    </button>
                  </div>
                </div>
                <div className="chips">
                  {mpicks.map((v) => {
                    const liveOpt = fullMatch?.pools[v.poolCode]?.options.find(
                      (o) => o.key === v.optionKey
                    );
                    return (
                      <span
                        key={`${v.poolCode}-${v.optionKey}`}
                        className="chip num"
                      >
                        {v.poolName}·{v.optionLabel}
                        <i>
                          @{v.odds.toFixed(2)}
                          {renderTrendArrow(liveOpt?.trend)} (
                          {(v.fairProb * 100).toFixed(0)}%)
                        </i>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Full 6-Tile Five-Dimension Truth Cockpit! */}
          <div className="card enter">
            <div className="co-head" style={{ marginBottom: 6 }}>
              <div className="sec num" style={{ margin: 0 }}>
                五维真相透视舱 · {effectiveReport.modeLabel} (总本金 ¥
                {effectiveReport.totalCost})
              </div>
              <button
                type="button"
                className="help-pill"
                onClick={() => openManual("sandbox")}
              >
                ? 6块仪表解读
              </button>
            </div>
            <div className="tiles num">
              <div
                className={`tile ${
                  effectiveReport.minPayout < effectiveReport.totalCost
                    ? "danger"
                    : ""
                }`}
              >
                <span>真实保底奖金</span>
                <b>¥{effectiveReport.minPayout.toFixed(2)}</b>
                <em className="strike">
                  官网虚高 ¥{effectiveReport.maxPayout.toFixed(2)}
                </em>
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
                  {(effectiveReport.realProfitProb * 100).toFixed(1)}% /{" "}
                  {(effectiveReport.anyWinProb * 100).toFixed(1)}%
                </b>
                <em>净利&gt;0 才算真赢</em>
              </div>
              <div
                ref={underwaterTileRef}
                className={`tile ${effectiveReport.underwaterCount > 0 ? "danger" : ""}`}
              >
                <span>假中奖倒贴检测</span>
                <b>
                  {effectiveReport.underwaterCount > 0
                    ? `${effectiveReport.underwaterCount}/${effectiveReport.comboCount} 组亏钱`
                    : "0 假中奖"}
                </b>
                <em>
                  {effectiveReport.underwaterCount > 0
                    ? `占中奖率 ${(effectiveReport.underwaterShareOfWins * 100).toFixed(0)}%`
                    : "命中任一组均盈利"}
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
                  连黑5次 {(insights.fiveLossStreakProb * 100).toFixed(0)}% ·{" "}
                  {effectiveReport.expectedValueRate <= 0
                    ? `凯利0%·娱乐≤${insights.recommendedBankrollPct}%`
                    : `凯利仓≤${insights.recommendedBankrollPct}%`}
                </em>
              </div>
            </div>
          </div>

          {/* Restored: +几元全保本弹性升级 + 合成单关提示 + 防坑/省钱/拖油瓶一键操作卡 */}
          <div
            className={`card sonar-card enter ${diagnosingMatchId ? "scanning" : ""}`}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div className="sec">防坑雷达 · 弹性保本 · 省钱动作</div>

            {effectiveReport.underwaterCount > 0 &&
              effectiveReport.effectiveOdds > 1.03 && (
                <div className="note-box">
                  <strong>✨ 弹性全保本升级方案：</strong>受 2
                  元整数倍影响，当前统买 {multiple} 倍存在{" "}
                  {effectiveReport.underwaterCount}{" "}
                  种假中奖亏钱；启用不等倍配平（预计约 ¥
                  {effectiveReport.breakevenUpgradeCost ??
                    effectiveReport.totalCost + 6}
                  ）即可实现 <strong>100% 组合零亏损保本</strong>！
                  <div className="note-act">
                    <button
                      type="button"
                      data-spring="0.88"
                      className="key mini dark"
                      onClick={(e) => upgradeToZeroUnderwater(e.currentTarget)}
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
                {effectiveReport.matchCount === 1 &&
                  !effectiveReport.canCheckout &&
                  effectiveReport.syntheticRescuePicks &&
                  effectiveReport.syntheticRescuePicks.length > 0 && (
                    <div className="note-act">
                      <button
                        type="button"
                        data-spring="0.88"
                        className="key mini dark"
                        onClick={() => {
                          const nextPicks =
                            effectiveReport.syntheticRescuePicks;
                          if (nextPicks && nextPicks.length > 0) {
                            void betCtrl.replacePicks(nextPicks);
                            playTactileCue("optimize-arpeggio");
                            showSpringToast(
                              layerRef.current,
                              "已一键切换为本场半全场合成单关"
                            );
                          }
                        }}
                      >
                        ⚡ 一键切换半全场合成单关
                      </button>
                    </div>
                  )}
              </div>
            )}

            {insights.activeSwapTip && (
              <div className="note-box">
                <strong>
                  💰 同义买法省钱差价 (+{insights.activeSwapTip.edgePct}%)：
                </strong>
                {insights.activeSwapTip.detail}
                <div className="note-act">
                  <button
                    type="button"
                    data-spring="0.88"
                    className="key mini dark"
                    onClick={(e) =>
                      applyEquivalentSwap(
                        insights.activeSwapTip!,
                        e.currentTarget
                      )
                    }
                  >
                    一键替换 {insights.activeSwapTip.betterChoice}
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
                      void betCtrl.removeMatchFromSlip(
                        insights.weakestLink!.matchId
                      );
                      showSpringToast(layerRef.current, "已砍掉拖后腿场次");
                    }}
                  >
                    一键砍掉此场
                  </button>
                </div>
              </div>
            )}

            {allWarnings.map((w) => (
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
                <div
                  className="lbl"
                  style={{ fontWeight: 600, color: "var(--text)" }}
                >
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
                    {insights.hedge.oppositeLabel} @
                    {insights.hedge.oppositeOdds.toFixed(2)}
                  </b>
                </div>
                <div className="row num" style={{ fontSize: 12 }}>
                  <span className="lbl">需去店里补买对冲本金</span>
                  <b>¥{insights.hedge.hedgeCost} 元</b>
                </div>
                <div className="row num" style={{ fontSize: 12 }}>
                  <span className="lbl">无视凌晨赛果 100% 锁死结果</span>
                  <b style={{ color: "var(--good)" }}>
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
            <div
              className="row"
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                }}
              >
                <span
                  className="lbl"
                  style={{ display: "flex", alignItems: "center", gap: 5 }}
                >
                  <span>主观胜率信心微调沙盒</span>
                  <button
                    type="button"
                    className="help-pill"
                    onClick={() => openManual("sandbox")}
                  >
                    ? 往哪拉
                  </button>
                </span>
                <span className="num" style={{ fontWeight: 600 }}>
                  {subjectiveDeltaPct > 0
                    ? `+${subjectiveDeltaPct}%`
                    : `${subjectiveDeltaPct}%`}{" "}
                  · 期望EV{" "}
                  <b
                    style={{
                      color:
                        subjectiveEVPct >= 0 ? "var(--good)" : "var(--text-2)",
                    }}
                  >
                    {subjectiveEVPct >= 0
                      ? `+${subjectiveEVPct.toFixed(1)}%`
                      : `${subjectiveEVPct.toFixed(1)}%`}
                  </b>
                </span>
              </div>
              <input
                type="range"
                min={-15}
                max={20}
                step={1}
                value={subjectiveDeltaPct}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (next !== subjectiveDeltaPct) {
                    playTactileCue(next === 0 ? "detent-zero" : "detent-tick");
                    setSubjectiveDeltaPct(next);
                  }
                }}
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
                <span className="lbl">统配倍数 (1~999倍 · 超99倍自动拆票)</span>
                <div className="stepper">
                  <button
                    type="button"
                    className="key sq"
                    data-spring="0.82"
                    onClick={() => stepMultiple(-1)}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="key mini num"
                    onClick={() => {
                      setKeypadFresh(true);
                      setBarPopover("keypad");
                    }}
                  >
                    <span ref={mulValRef} className="num mv">
                      {multiple}
                    </span>
                    <span>倍 ⌨️</span>
                  </button>
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
            <div className="sec-lbl" style={{ margin: "0 0 6px" }}>
              <span>全赛果组合盈亏推演明细 (四舍六入五成双)</span>
              <span className="num">
                互斥场景 · 共 {effectiveReport.combos.length} 组
              </span>
            </div>
            <div className="combo-list num">
              {effectiveReport.combos.map((c) => (
                <div
                  key={c.id}
                  className={`combo-item ${c.isUnderwater ? "uw" : ""}`}
                >
                  <div className="cdesc">
                    <b title={c.desc}>{c.desc}</b>
                    <small>
                      发生真率 {(c.prob * 100).toFixed(1)}% · 单倍 ¥
                      {c.unitPayout.toFixed(2)} · 实派 ¥
                      {c.totalPayout.toFixed(2)}
                    </small>
                  </div>
                  <div className={`cpnl ${c.isUnderwater ? "neg" : "pos"}`}>
                    {c.netProfit >= 0
                      ? `+¥${c.netProfit.toFixed(2)}`
                      : `-¥${Math.abs(c.netProfit).toFixed(2)}`}
                    <small>{c.isUnderwater ? "假中奖倒贴" : "净盈利"}</small>
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
                物理实票{" "}
                {effectiveReport.tickets?.length ?? effectiveReport.betCount} 注
                · 合票 {effectiveReport.consolidatedTickets} 张可核对
              </div>
            </div>
            <div className="acts">
              <button
                type="button"
                className="key wide2"
                data-spring="0.9"
                onClick={() => recordToLedger("paper")}
              >
                存模拟单
              </button>
              <button
                type="button"
                className="key dark wide2"
                data-spring="0.9"
                onClick={() => recordToLedger("live")}
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

      {/* 扫地僧小高双模靶向排雷：模式A 单场随时点诊 + 模式B 多场串关联合会诊 */}
      <div className="sec-lbl enter">
        <span>扫地僧小高双模排雷 · 单场点诊 + 多场联合会诊</span>
        <button
          type="button"
          className="help-pill"
          onClick={() => openManual("xiaogao")}
        >
          ? 什么是消息消化度
        </button>
      </div>
      <div
        className={`card sonar-card enter ${
          diagnosingMatchId || diagnosingCombo ? "scanning" : ""
        }`}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <input
          type="text"
          value={customIntelInput}
          onChange={(e) => setCustomIntelInput(e.target.value)}
          placeholder="可选：粘贴你看到的赛前伤停/轮换消息交由小高联合研判..."
          style={{
            width: "100%",
            height: 32,
            padding: "0 10px",
            fontSize: 11.5,
            borderRadius: "var(--key-r)",
            border: "1px solid var(--line)",
            background: "var(--tile)",
            color: "var(--text)",
            outline: "none",
          }}
        />

        {/* Mode B1: One-click diagnose currently picked parlay */}
        {pickedMatchIds.length >= 2 && (
          <button
            type="button"
            data-spring="0.92"
            className="key dark full num"
            onClick={() => void triggerXiaoGaoComboLive("picked")}
          >
            {diagnosingCombo
              ? "🧹 扫地僧小高正在联合会诊串关..."
              : `🧹 一键联合会诊当前已买 ${pickedMatchIds.length} 场串关方案`}
          </button>
        )}

        {/* Mode B2: Free multi-select checkboxes for any 2~8 matches */}
        <div className="small" style={{ fontWeight: 600 }}>
          多场自由勾选会诊（打钩任意 2~8 场一起把脉）：
        </div>
        <div className="pool-scroll">
          {matches.map((m) => {
            const checked = comboSelectedIds.includes(m.id);
            return (
              <button
                key={`cb-${m.id}`}
                type="button"
                data-spring="0.88"
                onClick={() => {
                  haptic(5);
                  setComboSelectedIds((prev) =>
                    prev.includes(m.id)
                      ? prev.filter((id) => id !== m.id)
                      : prev.length >= 8
                        ? [...prev.slice(1), m.id]
                        : [...prev, m.id]
                  );
                }}
                className={`key pillk num ${checked ? "on" : ""}`}
              >
                {checked ? "✓ " : "□ "}
                {m.matchNumStr.slice(-3)} {m.home}
              </button>
            );
          })}
          <button
            type="button"
            data-spring="0.88"
            onClick={() => void triggerXiaoGaoComboLive("custom")}
            className="key pillk dark num"
          >
            {diagnosingCombo
              ? "会诊中..."
              : `联合会诊已勾(${comboSelectedIds.length}场)`}
          </button>
        </div>

        {/* Mode A: Single-match 1-click on-demand diagnosis (even without betting on it!) */}
        <div className="small" style={{ fontWeight: 600 }}>
          单场独立点诊（不买也能单独点看任意一场）：
        </div>
        <div className="pool-scroll">
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              data-spring="0.88"
              onClick={() =>
                void triggerXiaoGaoLive(m, customIntelInput || undefined)
              }
              className={`key pillk num ${diagnosingMatchId === m.id ? "on" : ""}`}
            >
              {diagnosingMatchId === m.id
                ? `小高诊盘中...`
                : `单诊:${m.matchNumStr.slice(-3)} ${m.home}`}
            </button>
          ))}
        </div>
      </div>

      {/* Multi-Match Joint Parlay Diagnosis Report Card */}
      {comboReport && (
        <div
          className="card enter yj-cipher-reveal"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            border: "1px solid var(--mark)",
          }}
        >
          <div className="co-head" style={{ marginBottom: 0 }}>
            <b>🧹 {comboReport.matchCount} 场联合串关会诊报告</b>
            <span className="qpill warn">
              {comboReport.level === "high"
                ? "🚨高危结构"
                : comboReport.level === "low"
                  ? "✅结构稳健"
                  : "⚠️中度关注"}{" "}
              · {comboReport.comboTag}
            </span>
          </div>
          <div
            style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}
          >
            {comboReport.summary}
          </div>
          <div className="note-box alert" style={{ margin: 0 }}>
            <div>
              <strong>💣 最易黑单短板场：</strong>
              {comboReport.weakestLeg}
            </div>
            <div style={{ marginTop: 3 }}>
              <strong>🛠️ 串关拆单/补防建议：</strong>
              {comboReport.structureAdvice}
            </div>
          </div>
          {comboReport.perMatch.length > 0 && (
            <div className="chips">
              {comboReport.perMatch.map((pm, idx) => (
                <span key={`${pm.matchId}-${idx}`} className="chip num">
                  {pm.matchTitle} · <i>{pm.tag}</i>
                </span>
              ))}
            </div>
          )}
          <div
            className="small num"
            style={{ color: "var(--mark)", fontWeight: 600 }}
          >
            📊 消息入价消化度（Price-In）：{comboReport.priceInVerdict}
          </div>
          <div className="small">{comboReport.source}</div>
        </div>
      )}

      {matches
        .filter((m) => m.aiAlert)
        .map((m) => (
          <div
            key={`${m.id}-${m.aiAlert!.tag}-${m.aiAlert!.summary.slice(0, 12)}`}
            className="card enter yj-cipher-reveal"
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            <div className="co-head" style={{ marginBottom: 0 }}>
              <div className="duo">
                <TeamCrest name={m.home} size={18} />
                <b>
                  {m.matchNumStr} {m.home} vs {m.away}
                </b>
              </div>
              <span className="qpill warn">{m.aiAlert!.tag}</span>
            </div>
            <div
              style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-2)" }}
            >
              {m.aiAlert!.summary}
            </div>
            <div
              className="small num"
              style={{ color: "var(--mark)", fontWeight: 600 }}
            >
              消息入价消化度（Price-In）：{m.aiAlert!.priceInStatus}
              {m.aiAlert!.suggestedDelta
                ? ` · ${m.aiAlert!.suggestedDelta}`
                : ""}
            </div>
            <div className="small">{m.aiAlert!.source}</div>
          </div>
        ))}

      {/* Daily Stop-Loss Guardrail Balance Card */}
      <div className="card bal enter">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span className="lbl">今日剩余止损护栏额度</span>
          <button
            type="button"
            className="key mini"
            data-spring="0.88"
            onClick={() => {
              setLimitDraft(String(ledger.dailyLimit));
              setEditingLimit((v) => !v);
            }}
          >
            {editingLimit ? "收起" : "⚙️ 设上限"}
          </button>
        </div>
        <span ref={balValRef} className="v num">
          ¥{ledger.dailyRemaining.toFixed(2)}
        </span>
        <div className="small num" style={{ marginTop: 4 }}>
          今日已投 ¥{ledger.dailyLiveSpent} / 护栏上限 ¥{ledger.dailyLimit} ·
          北京时间00:00重置
        </div>
        {editingLimit && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
            }}
          >
            <input
              type="number"
              min={20}
              max={100000}
              step={10}
              value={limitDraft}
              onChange={(e) => setLimitDraft(e.target.value)}
              placeholder="每日止损上限 (¥20~100000)"
              className="ledger-input num"
            />
            <button
              type="button"
              className="key mini dark"
              disabled={ledgerBusy}
              onClick={() => void handleSaveDailyLimit()}
            >
              保存上限
            </button>
          </div>
        )}
      </div>

      {/* Real 3-Cell Dynamic Ledger Stats Card */}
      <div className="card stats enter">
        <div>
          <b
            className="num"
            style={{
              color:
                ledger.stats.liveNetProfit > 0
                  ? "var(--good)"
                  : ledger.stats.liveNetProfit < 0
                    ? "var(--live)"
                    : undefined,
            }}
          >
            {ledger.stats.liveNetProfit > 0
              ? `+¥${ledger.stats.liveNetProfit.toFixed(2)}`
              : ledger.stats.liveNetProfit < 0
                ? `-¥${Math.abs(ledger.stats.liveNetProfit).toFixed(2)}`
                : "¥0.00"}
          </b>
          <span>实买累计净盈亏</span>
        </div>
        <div>
          <b className="num">{ledger.stats.liveWinRatePct.toFixed(1)}%</b>
          <span>
            实买结算红单率 ({ledger.stats.liveWonCount}/
            {ledger.stats.liveSettledCount})
          </span>
        </div>
        <div>
          <b
            className="num"
            style={{
              color:
                ledger.stats.paperSavedAmount > 0 ? "var(--good)" : undefined,
            }}
          >
            ¥{ledger.stats.paperSavedAmount.toFixed(0)}
          </b>
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
            className={`sk ${sk.id === skin ? "on" : ""}`}
          >
            <i
              style={
                {
                  background: sk.swatchBg,
                  "--sw-dot": sk.swatchDot,
                } as React.CSSProperties
              }
            />
            <span>{sk.name}</span>
          </button>
        ))}
      </div>

      {/* Dual-Track Ledger History & Settlement Closure */}
      <div className="sec-lbl enter">
        <span>实买真金单 / 0成本模拟单双轨账本</span>
        <span className="num">共 {ledger.entries.length} 笔</span>
      </div>
      {ledger.entries.length === 0 ? (
        <div className="card enter">
          <div className="note-box">
            暂无账本记录 · 在【审单锁利】台配好方案后点击「
            <strong>记入实买</strong>」或「
            <strong>存模拟单</strong>
            」，即可按个人账号跨设备加密保存并复盘红黑盈亏。
          </div>
        </div>
      ) : (
        ledger.entries.map((it) => {
          const isLive = it.kind === "live";
          const defaultWinReturn =
            it.settledReturn > 0
              ? it.settledReturn
              : it.minPayout > 0
                ? it.minPayout
                : it.maxPayout > 0
                  ? it.maxPayout
                  : it.cost;
          let badgeText = "⏳待开奖";
          let badgeCls = "ledger-badge num";
          if (it.status === "won") {
            if (isLive) {
              badgeText =
                it.netProfit >= 0
                  ? `🔴红单 +¥${it.netProfit.toFixed(2)}`
                  : `🔴中奖 -¥${Math.abs(it.netProfit).toFixed(2)}`;
              badgeCls = `ledger-badge num ${it.netProfit >= 0 ? "won" : "lost"}`;
            } else {
              badgeText = "🎯观察命中";
              badgeCls = "ledger-badge num won";
            }
          } else if (it.status === "lost") {
            if (isLive) {
              badgeText = `⚫黑单 -¥${it.cost.toFixed(2)}`;
              badgeCls = "ledger-badge num lost";
            } else {
              badgeText = `🛡️未中免损 ¥${it.paperRefCost.toFixed(0)}`;
              badgeCls = "ledger-badge num saved";
            }
          }

          return (
            <div key={it.id} className="card ledger-entry enter">
              <div className="ledger-entry-top">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ fontSize: 13, display: "block" }}>{it.title}</b>
                  <div className="small num">
                    {isLive
                      ? `实买真金单 · 本金¥${it.cost}${
                          it.minPayout > 0
                            ? ` · 保底¥${it.minPayout.toFixed(2)}`
                            : ""
                        }${it.settledReturn > 0 ? ` · 实派¥${it.settledReturn.toFixed(2)}` : ""}`
                      : `0成本模拟观察单 · 拟投¥${it.paperRefCost}`}
                  </div>
                </div>
                <span className={badgeCls}>{badgeText}</span>
              </div>

              {isLive && wonPromptEntryId === it.id && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={wonPayoutDraft}
                    onChange={(e) => setWonPayoutDraft(e.target.value)}
                    placeholder="实际到手派奖金额"
                    className="ledger-input num"
                  />
                  <button
                    type="button"
                    className="key mini dark"
                    disabled={ledgerBusy}
                    onClick={() => {
                      const val = Number(wonPayoutDraft);
                      void handleSettleEntry(
                        it,
                        "won",
                        Number.isFinite(val) && val > 0 ? val : undefined
                      );
                    }}
                  >
                    确认实派
                  </button>
                  <button
                    type="button"
                    className="key mini"
                    onClick={() => setWonPromptEntryId(null)}
                  >
                    取消
                  </button>
                </div>
              )}

              <div className="ledger-acts">
                <div className="ledger-acts-grp">
                  <button
                    type="button"
                    className={`key mini ${it.status === "won" ? "on" : ""}`}
                    disabled={ledgerBusy}
                    onClick={() => {
                      if (isLive) {
                        if (wonPromptEntryId === it.id) {
                          setWonPromptEntryId(null);
                        } else {
                          setWonPayoutDraft(defaultWinReturn.toFixed(2));
                          setWonPromptEntryId(it.id);
                        }
                      } else {
                        void handleSettleEntry(it, "won");
                      }
                    }}
                  >
                    红单
                  </button>
                  <button
                    type="button"
                    className={`key mini ${it.status === "lost" ? "on" : ""}`}
                    disabled={ledgerBusy}
                    onClick={() => void handleSettleEntry(it, "lost")}
                  >
                    黑单
                  </button>
                  {it.status !== "pending" && (
                    <button
                      type="button"
                      className="key mini"
                      disabled={ledgerBusy}
                      onClick={() => void handleSettleEntry(it, "pending")}
                    >
                      重置待开
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="key mini"
                  disabled={ledgerBusy}
                  onClick={() => void handleDeleteEntry(it.id)}
                >
                  删除
                </button>
              </div>
            </div>
          );
        })
      )}

      {/* Member Session Continuity Status & Explicit Logout */}
      {authUser && (
        <div className="card opt-row enter" style={{ marginTop: 6 }}>
          <div>
            <b>
              当前授权账号：{authUser.username}
              {offlineMode ? "（离线重连保护中）" : "（长期在线免重登）"}
            </b>
            <div className="s num">
              今日智能诊盘额度：
              {authUser.aiEnabled
                ? `${authUser.aiUsedToday}/${authUser.dailyAiLimit} 次`
                : "未开通"}
              {" · "}设备绑定 {authUser.boundDevicesCount}/
              {authUser.maxDevices >= 99 ? "∞" : authUser.maxDevices} 台
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {authUser.role === "superadmin" && (
              <button
                type="button"
                className="key mini dark"
                onClick={() => setAdminOpen(true)}
              >
                👑 总控台
              </button>
            )}
            <button
              type="button"
              className="key mini"
              onClick={() => void handleExplicitLogout()}
            >
              退出账号
            </button>
          </div>
        </div>
      )}
    </>
  );

  const overlayLayerNode = (
    <div ref={layerRef} className="layer">
      {/* Sheet 1: 全玩法 (总进球 / 半全场 / 比分，每个格子均展示去水真实胜率 %！) */}
      <SpringSheet
        open={sheet?.type === "more" && Boolean(sheetMatch)}
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
              总进球 · {sheetMatch.pools.TTG.single ? "单关" : "仅串关"} ·
              最高6关 (返还率{" "}
              {(sheetMatch.pools.TTG.payoutRatio * 100).toFixed(1)}% · 抽水{" "}
              {(sheetMatch.pools.TTG.vig * 100).toFixed(1)}%)
            </div>
            {(sheetMatch.pools.TTG.selling === false ||
              sheetMatch.pools.TTG.options.length === 0) && (
              <button
                type="button"
                className="key wide unsold num"
                onClick={(e) =>
                  togglePick(e.currentTarget, sheetMatch, "TTG", "closed")
                }
              >
                总进球玩法暂未开售
              </button>
            )}
            <div className="grid-keys c4 pop">
              {sheetMatch.pools.TTG.options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  data-spring="0.86"
                  onClick={(e) =>
                    togglePick(e.currentTarget, sheetMatch, "TTG", opt.key)
                  }
                  className={`key cell num ${isPicked(sheetMatch.id, "TTG", opt.key) ? "on" : ""} ${
                    isPoolMutexLocked(sheetMatch, "TTG") ? "mutex-lock" : ""
                  }`}
                >
                  <small>
                    {opt.label} · {(opt.fairProb * 100).toFixed(0)}%
                  </small>
                  <b>
                    {opt.odds.toFixed(2)}
                    {renderTrendArrow(opt.trend)}
                  </b>
                </button>
              ))}
            </div>

            <div className="sec num" style={{ marginTop: 16 }}>
              半全场 · {sheetMatch.pools.HAFU.single ? "单关" : "仅串关"} ·
              最高4关 (返还率{" "}
              {(sheetMatch.pools.HAFU.payoutRatio * 100).toFixed(1)}% · 抽水{" "}
              {(sheetMatch.pools.HAFU.vig * 100).toFixed(1)}%)
            </div>
            {(sheetMatch.pools.HAFU.selling === false ||
              sheetMatch.pools.HAFU.options.length === 0) && (
              <button
                type="button"
                className="key wide unsold num"
                onClick={(e) =>
                  togglePick(e.currentTarget, sheetMatch, "HAFU", "closed")
                }
              >
                半全场玩法暂未开售
              </button>
            )}
            <div className="grid-keys c3 pop">
              {sheetMatch.pools.HAFU.options.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  data-spring="0.86"
                  onClick={(e) =>
                    togglePick(e.currentTarget, sheetMatch, "HAFU", opt.key)
                  }
                  className={`key cell num ${isPicked(sheetMatch.id, "HAFU", opt.key) ? "on" : ""} ${
                    isPoolMutexLocked(sheetMatch, "HAFU") ? "mutex-lock" : ""
                  }`}
                >
                  <small>
                    {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                  </small>
                  <b>
                    {opt.odds.toFixed(2)}
                    {renderTrendArrow(opt.trend)}
                  </b>
                </button>
              ))}
            </div>

            <div className="sec-row">
              <span className="sec num">
                比分 · {sheetMatch.pools.CRS.single ? "单关" : "仅串关"} ·
                最高4关 (抽水 {(sheetMatch.pools.CRS.vig * 100).toFixed(1)}%)
              </span>
              <SpringSegmented
                small
                options={[
                  ["win", "主胜"],
                  ["draw", "平"],
                  ["lose", "客胜"],
                ]}
                value={bfGrp}
                onChange={(g) => {
                  setBfGrp(g);
                  requestAnimationFrame(() =>
                    popStagger(bfGridRef.current, 14)
                  );
                }}
                skinKey={skin}
              />
            </div>
            {(sheetMatch.pools.CRS.selling === false ||
              sheetMatch.pools.CRS.options.length === 0) && (
              <button
                type="button"
                className="key wide unsold num"
                onClick={(e) =>
                  togglePick(e.currentTarget, sheetMatch, "CRS", "closed")
                }
              >
                比分玩法暂未开售
              </button>
            )}
            <div ref={bfGridRef} className="grid-keys c4 pop">
              {sheetMatch.pools.CRS.options
                .filter((o) => {
                  if (o.label === "胜其它" || o.key === "s1sh")
                    return bfGrp === "win";
                  if (o.label === "平其它" || o.key === "s1sd")
                    return bfGrp === "draw";
                  if (o.label === "负其它" || o.key === "s1sa")
                    return bfGrp === "lose";
                  const [h, a] = o.label.split(":").map(Number);
                  if (bfGrp === "win") return h > a;
                  if (bfGrp === "draw") return h === a;
                  return h < a;
                })
                .map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    data-spring="0.86"
                    onClick={(e) =>
                      togglePick(e.currentTarget, sheetMatch, "CRS", opt.key)
                    }
                    className={`key cell num ${isPicked(sheetMatch.id, "CRS", opt.key) ? "on" : ""} ${
                      isPoolMutexLocked(sheetMatch, "CRS") ? "mutex-lock" : ""
                    }`}
                  >
                    <small>
                      {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                    </small>
                    <b>
                      {opt.odds.toFixed(2)}
                      {renderTrendArrow(opt.trend)}
                    </b>
                  </button>
                ))}
            </div>
          </>
        )}
      </SpringSheet>

      {/* Sheet 2: 单场精算底牌全解剖 */}
      <SpringSheet
        open={sheet?.type === "intel" && Boolean(sheetMatch)}
        onClose={() => setSheet(null)}
      >
        {sheetMatch &&
          (() => {
            const mq = sheetMatch.microQuant;
            const hP =
              (sheetMatch.pools.HAD.options[0]?.fairProb ?? 0.45) * 100;
            const dP =
              (sheetMatch.pools.HAD.options[1]?.fairProb ?? 0.27) * 100;
            const aP =
              (sheetMatch.pools.HAD.options[2]?.fairProb ?? 0.28) * 100;
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
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <button
                      type="button"
                      className="help-pill"
                      onClick={() => openManual("glossary")}
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
                      {mq.topTwoGoals[0].replace("s", "")}~
                      {mq.topTwoGoals[1].replace("s", "")}球
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
                  <div
                    className="tile w"
                    style={{ fontFamily: "var(--font-ui)" }}
                  >
                    <span>
                      比赛节奏相关性 · {mq.paceLabel}（ρ=
                      {mq.paceCorrelation >= 0 ? "+" : ""}
                      {mq.paceCorrelation.toFixed(2)}）
                    </span>
                    <b
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        lineHeight: 1.45,
                      }}
                    >
                      跨盘定价扫描结论：{mq.alphaScanSummary}
                    </b>
                  </div>
                  <div
                    className="tile w"
                    style={{ fontFamily: "var(--font-ui)" }}
                  >
                    <span>卡盘建议</span>
                    <b
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        lineHeight: 1.45,
                      }}
                    >
                      {mq.cardPanTip}
                    </b>
                  </div>
                  {mq.arbitrages.map((arb, idx) => (
                    <div
                      key={idx}
                      className="tile w"
                      style={{ fontFamily: "var(--font-ui)" }}
                    >
                      <span>💰 同义买法省钱差价 (+{arb.edgePct}%)</span>
                      <b
                        style={{
                          fontSize: 12.5,
                          fontWeight: 500,
                          lineHeight: 1.45,
                        }}
                      >
                        {arb.detail}
                      </b>
                      <div className="note-act">
                        <button
                          type="button"
                          data-spring="0.88"
                          className="key mini dark"
                          onClick={(e) => {
                            applyEquivalentSwap(arb, e.currentTarget);
                            setSheet(null);
                          }}
                        >
                          一键选用 {arb.betterChoice}
                        </button>
                      </div>
                    </div>
                  ))}
                  <div
                    className={`tile w sonar-card ${diagnosingMatchId === sheetMatch.id ? "scanning" : ""}`}
                    style={{ fontFamily: "var(--font-ui)" }}
                  >
                    <span>扫地僧小高靶向排雷 & 变盘鉴别</span>
                    <b
                      key={sheetMatch.aiAlert?.summary || mq.steamSignal}
                      className="yj-cipher-reveal"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        lineHeight: 1.45,
                      }}
                    >
                      {sheetMatch.aiAlert
                        ? `${sheetMatch.aiAlert.summary}（${sheetMatch.aiAlert.priceInStatus}${sheetMatch.aiAlert.suggestedDelta ? ` · ${sheetMatch.aiAlert.suggestedDelta}` : ""} · ${sheetMatch.aiAlert.source}）`
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
                          ? "扫地僧小高推演中..."
                          : "请扫地僧小高实时排雷"}
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
        open={sheet?.type === "poster"}
        onClose={() => setSheet(null)}
        onAfterOpen={(sh) => bindTilt(sh.querySelector<HTMLElement>(".poster"))}
      >
        <div className="poster">
          <div className="p-top">
            <span>优竞体育内部专用 · 店面防错打票单 (点击逐行打钩)</span>
            <span className="num">{effectiveReport.modeLabel}</span>
          </div>
          <div className="p-amt num">合计应付 ¥{effectiveReport.totalCost}</div>

          {(appliedPlan
            ? appliedPlan.lines.flatMap((l) => {
                const left = l.legs
                  .map(
                    (g) =>
                      `${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}]`
                  )
                  .join("×");
                return splitTerminalPosterSlips(
                  l.id,
                  left,
                  l.modeLabel,
                  l.multiple,
                  l.cost
                );
              })
            : effectiveReport.tickets && effectiveReport.tickets.length > 0
              ? effectiveReport.tickets.flatMap((tk) => {
                  const left = (tk.legs ?? [])
                    .map(
                      (g) =>
                        `${g.matchNumStr.slice(-3)}${g.home}[${g.optionLabel}]`
                    )
                    .join("×");
                  const passTxt =
                    (tk.legs?.length ?? 1) === 1
                      ? "单关"
                      : `${tk.legs?.length}串1`;
                  return splitTerminalPosterSlips(
                    tk.id,
                    left,
                    passTxt,
                    multiple
                  );
                })
              : picks.map((p) => ({
                  key: `${p.matchId}-${p.poolCode}-${p.optionKey}`,
                  left: `${p.matchNumStr} ${p.home}vs${p.away}`,
                  right: `${p.poolName}[${p.optionLabel}] × ${multiple}倍`,
                }))
          ).map((row, _, allRows) => {
            const done = Boolean(checkedPosterLines[row.key]);
            return (
              <div
                key={row.key}
                onClick={(e) => {
                  const nextDone = !done;
                  kickElement(e.currentTarget, nextDone ? 2.4 : -1.2);
                  playTactileCue(nextDone ? "ticket-stamp" : "tap-off");
                  setCheckedPosterLines((prev) => {
                    const updated = { ...prev, [row.key]: nextDone };
                    if (nextDone && allRows.every((r) => updated[r.key])) {
                      playTactileCue("defuse-celebrate");
                      burstCelebrationSparks(e.currentTarget, 30);
                    }
                    return updated;
                  });
                }}
                className={`p-line num ${done ? "done" : ""}`}
              >
                <span>
                  {done ? "✓ " : "□ "}
                  {row.left}
                </span>
                <span>{row.right}</span>
              </div>
            );
          })}

          <div className="p-foot">
            <span className="num">
              保底 ¥{effectiveReport.minPayout.toFixed(2)} · 真赚率{" "}
              {(effectiveReport.realProfitProb * 100).toFixed(1)}%
            </span>
            <div className="qr">
              {Array.from({ length: 49 }, (_, i) => (
                <i
                  key={i}
                  className={
                    (i * 37 + 11) % 7 > 2 && ![8, 12, 36, 40].includes(i)
                      ? ""
                      : "o"
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
            showSpringToast(layerRef.current, "实票已全部核对无误");
            setSheet(null);
          }}
        >
          核对完毕
        </button>
      </SpringSheet>

      {/* Sheet 4: 联赛筛选 */}
      <SpringSheet
        open={sheet?.type === "filter"}
        onClose={() => setSheet(null)}
      >
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
                className={`key cell ${on ? "on" : ""}`}
              >
                <b>{lg}</b>
              </button>
            );
          })}
        </div>
      </SpringSheet>

      {/* Sheet 5: 🎮 超感物理与多维震动体感控制台 */}
      <SpringSheet
        open={sheet?.type === "tactile"}
        onClose={() => setSheet(null)}
      >
        {(() => {
          const prof = SKIN_PHYSICS_PROFILES[skin] ?? SKIN_PHYSICS_PROFILES.air;
          return (
            <>
              <div className="sh-head">
                <div>
                  <span className="h2">🎮 超感物理与手机震动舱</span>
                  <div className="small">
                    240Hz 弹簧形变 × 多段震动波形 × 拟真微声场
                  </div>
                </div>
                <button
                  type="button"
                  className="key dark sm"
                  data-spring="0.88"
                  onClick={() => setSheet(null)}
                >
                  完成
                </button>
              </div>

              <div className="sec">手机震动与触感反馈档位</div>
              <div className="grid-keys c4 pop">
                {(
                  [
                    ["mute", "静音关闭", "0×"],
                    ["soft", "轻柔微振", "0.55×"],
                    ["standard", "标准棘轮", "1.0×"],
                    ["hyper", "🔥超感狂暴", "1.55×"],
                  ] as Array<[HapticIntensity, string, string]>
                ).map(([lvl, name, multLbl]) => (
                  <button
                    key={lvl}
                    type="button"
                    data-spring="0.86"
                    onClick={() => {
                      const next = updateTactileState({ intensity: lvl });
                      setTactileCfg(next);
                      if (lvl !== "mute") playTactileCue("optimize-arpeggio");
                    }}
                    className={`key cell num ${tactileCfg.intensity === lvl ? "on" : ""}`}
                  >
                    <small>{multLbl}</small>
                    <b style={{ fontSize: 11.5 }}>{name}</b>
                  </button>
                ))}
              </div>

              <div className="card rows" style={{ marginTop: 12 }}>
                <div className="row">
                  <div>
                    <div
                      className="lbl"
                      style={{ fontWeight: 600, color: "var(--text)" }}
                    >
                      🔊 拟真机械轴体微音效 (WebAudio 零延迟合成)
                    </div>
                    <div className="small">
                      即使手机系统静音，也能提供干脆利落的微动与落袋锤感
                    </div>
                  </div>
                  <SpringSwitch
                    checked={tactileCfg.soundEnabled}
                    onChange={(en) => {
                      const next = updateTactileState({ soundEnabled: en });
                      setTactileCfg(next);
                      if (en) playTactileCue("tap-on");
                    }}
                  />
                </div>
                <div className="row">
                  <div>
                    <div
                      className="lbl"
                      style={{ fontWeight: 600, color: "var(--text)" }}
                    >
                      当前皮肤物理轴体：{prof.title}
                    </div>
                    <div className="small num">
                      {prof.feelDesc} · 震动序列 [
                      {prof.pressPattern.join("ms, ")}ms] · 基频{" "}
                      {prof.baseFreqHz}Hz
                    </div>
                  </div>
                </div>
              </div>

              <button
                ref={demoBtnRef}
                type="button"
                data-spring="0.92"
                className="key dark full"
                onClick={(e) => {
                  const tgt =
                    isDesktop && !embedded
                      ? (auditCockpitRef.current ?? desktopAuditColRef.current)
                      : slipRef.current;
                  runHyperDemoShowcase(
                    e.currentTarget,
                    tgt ?? e.currentTarget,
                    auditCockpitRef.current ?? desktopAuditColRef.current
                  );
                  showSpringToast(
                    layerRef.current,
                    "🎆 已触发：抛物线双连弹 + 琶音扫频 + 360°流光礼花"
                  );
                }}
              >
                🎆 一键试玩全套超感震动连招演示
              </button>
            </>
          );
        })()}
      </SpringSheet>
    </div>
  );

  const isCompactMobileBar = tab === "archetypes" || tab === "ledger";

  const betPopoverNode = barPopover ? (
    <>
      <div className="bet-pop-mask" onClick={() => setBarPopover(null)} />
      <div
        className={`bet-pop ${!isDesktop && isCompactMobileBar ? "from-compact" : ""}`}
      >
        {barPopover === "pass" && (
          <>
            <div className="bet-pop-head">
              <div>
                <b>过关方式选择</b>
                <div className="small num">
                  已选 {manualReport.matchCount} 场 · 最高可串{" "}
                  {manualReport.poolCap} 关
                  {manualReport.poolCap <= 4
                    ? "（含比分/半全场法定上限4关）"
                    : manualReport.poolCap <= 6
                      ? "（含总进球法定上限6关）"
                      : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="key mini"
                  onClick={() => {
                    void betCtrl.resetPassAuto();
                    haptic(5);
                  }}
                >
                  自动最优
                </button>
                <button
                  type="button"
                  className="key mini dark"
                  onClick={() => setBarPopover(null)}
                >
                  完成
                </button>
              </div>
            </div>

            {appliedPlan && (
              <div className="note-box" style={{ marginBottom: 8 }}>
                当前处于【{appliedPlan.shortTab}
                】不等倍智能拆票态；点选下方任一过关方式将自动切回手动过关。
              </div>
            )}

            <div className="sec">
              自由过关（支持多选叠加拆票，如同时勾 2关+3关）
            </div>
            <div className="pass-grid8 num">
              {(manualReport.availableFreePasses.length > 0
                ? manualReport.availableFreePasses
                : [1, 2, 3, 4, 5, 6, 7, 8].map((sz) => ({
                    size: sz,
                    label: sz === 1 ? "单关" : `${sz}关`,
                    enabled: false,
                    active: false,
                    disabledReason: "请先选比赛",
                  }))
              ).map((fp) => (
                <button
                  key={fp.size}
                  type="button"
                  onClick={() => toggleFreePassSize(fp.size)}
                  className={`pass-cell ${fp.active && !appliedPlan ? "on" : ""} ${
                    !fp.enabled ? "dis" : ""
                  }`}
                >
                  <b>{fp.label}</b>
                  <small>
                    {fp.active && !appliedPlan
                      ? "✓ 已选"
                      : fp.enabled
                        ? fp.size === 1
                          ? "单场即买"
                          : `${fp.size}串1`
                        : fp.disabledReason || "不可选"}
                  </small>
                </button>
              ))}
            </div>

            <div className="sec" style={{ marginTop: 12 }}>
              多串容错过关（中国体彩官方 M串N 错场防爆快选）
            </div>
            {manualReport.availableComboPasses.length === 0 ? (
              <div className="note-box">
                选满 <strong>3 ~ 8 场</strong>
                比赛后，此处自动解锁官方标准多串容错组合（如{" "}
                <strong>3串3 / 3串4 / 4串6 / 4串11 / 5串26 / 6串57</strong>
                ），黑 1~2 场仍可回血保命。
              </div>
            ) : (
              <div className="combo-pass-grid num">
                {manualReport.availableComboPasses.map((cp) => (
                  <button
                    key={cp.code}
                    type="button"
                    onClick={() => selectComboPass(cp.code)}
                    className={`pass-cell ${cp.active && !appliedPlan ? "on" : ""} ${
                      !cp.enabled ? "dis" : ""
                    }`}
                  >
                    <b>
                      {cp.label} · {cp.actualBets ?? cp.baseBets}注
                    </b>
                    <small>
                      {cp.enabled ? cp.desc : cp.disabledReason || "超玩法上限"}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {barPopover === "keypad" && (
          <>
            <div className="bet-pop-head">
              <div>
                <b className="num">投倍设置 · 当前 {multiple} 倍</b>
                <div className="small num">
                  共 {effectiveReport.betCount} 注 · 应付总额 ¥
                  {effectiveReport.totalCost}
                </div>
              </div>
              <button
                type="button"
                className="key mini dark"
                onClick={() => setBarPopover(null)}
              >
                确定
              </button>
            </div>

            {multiple > 99 && (
              <div className="note-box" style={{ marginBottom: 8 }}>
                💡 体彩终端单张实票最高 99 倍，当前{" "}
                <strong>{multiple} 倍</strong> 将自动拆为{" "}
                <strong>{Math.ceil(multiple / 99)} 张</strong>
                同号票出票，总赔付不变。
              </div>
            )}
            {effectiveReport.totalCost > 20000 ? (
              <div className="note-box alert" style={{ marginBottom: 8 }}>
                <strong>🚨 超单次订单法定上限：</strong>当前总额 ¥
                {effectiveReport.totalCost} 已超体彩单次订单硬上限
                ¥20,000，请调低倍数或分单。
              </div>
            ) : effectiveReport.totalCost > 6000 ? (
              <div className="note-box" style={{ marginBottom: 8 }}>
                <strong>⚠️ 大额理性提示：</strong>单次投入已超
                ¥6,000，请结合止损账本理性控制仓位。
              </div>
            ) : null}

            <div className="kpad-presets num">
              {[1, 5, 10, 20, 50, 99].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    applyDirectMultiple(preset);
                    setKeypadFresh(true);
                  }}
                  className={`key mini num ${multiple === preset && !appliedPlan ? "on" : ""}`}
                  style={{ width: "100%" }}
                >
                  {preset}倍
                </button>
              ))}
            </div>

            <div className="kpad-grid num">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  className="kpad-key"
                  onClick={() => {
                    const next = keypadFresh
                      ? digit
                      : Math.min(999, multiple * 10 + digit);
                    applyDirectMultiple(Math.max(1, next));
                    setKeypadFresh(false);
                  }}
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                className="kpad-key fn"
                onClick={() => {
                  applyDirectMultiple(1);
                  setKeypadFresh(true);
                }}
              >
                重置1倍
              </button>
              <button
                type="button"
                className="kpad-key"
                onClick={() => {
                  if (keypadFresh) {
                    applyDirectMultiple(1);
                  } else {
                    applyDirectMultiple(
                      Math.max(1, Math.min(999, multiple * 10))
                    );
                  }
                }}
              >
                0
              </button>
              <button
                type="button"
                className="kpad-key fn"
                onClick={() => {
                  const next = Math.floor(multiple / 10);
                  applyDirectMultiple(next >= 1 ? next : 1);
                  setKeypadFresh(next < 1);
                }}
              >
                ⌫ 退格
              </button>
            </div>
          </>
        )}

        {barPopover === "selected" && (
          <>
            <div className="bet-pop-head">
              <b>已选场次速览（{pickedMatchIds.length} 场）</b>
              <div style={{ display: "flex", gap: 6 }}>
                {picks.length > 0 && (
                  <button
                    type="button"
                    className="key mini"
                    onClick={() => {
                      void betCtrl.clearPicks();
                      setBarPopover(null);
                    }}
                  >
                    全部清空
                  </button>
                )}
                <button
                  type="button"
                  className="key mini dark"
                  onClick={() => setBarPopover(null)}
                >
                  关闭
                </button>
              </div>
            </div>
            {pickedMatchIds.length === 0 ? (
              <div className="note-box">
                暂未选择比赛，请在【赛事雷达】点击赔率按钮选球。
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pickedMatchIds.map((mid) => {
                  const mp = picks.filter((p) => p.matchId === mid);
                  const f = mp[0];
                  return (
                    <div key={mid} className="combo-item num">
                      <div className="cdesc">
                        <b>
                          {f.matchNumStr} {f.home} vs {f.away}
                        </b>
                        <small>
                          {mp
                            .map(
                              (x) =>
                                `${x.poolName}[${x.optionLabel}@${x.odds.toFixed(2)}]`
                            )
                            .join(" · ")}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="key mini"
                        onClick={() => {
                          void betCtrl.removeMatchFromSlip(mid);
                        }}
                      >
                        移除
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  ) : null;

  const desktopBetDockNode = (
    <footer ref={slipRef} className="dk-betdock">
      <div className="dk-betdock-inner">
        <div className="dk-bet-left">
          <button
            type="button"
            className="key sm"
            disabled={picks.length === 0}
            style={{ opacity: picks.length === 0 ? 0.45 : 1 }}
            onClick={() => {
              void betCtrl.clearPicks();
              haptic(12);
            }}
          >
            🗑 清空
          </button>
          <button
            type="button"
            className="key sm num"
            onClick={() =>
              setBarPopover((p) => (p === "selected" ? null : "selected"))
            }
          >
            已选 {effectiveReport.matchCount} 场 ▴
          </button>
          <button
            type="button"
            className={`key sm num ${
              barPopover === "pass" ||
              (effectiveReport.matchCount > 0 && effectiveReport.canCheckout)
                ? "dark"
                : ""
            }`}
            onClick={() => setBarPopover((p) => (p === "pass" ? null : "pass"))}
          >
            🎯 过关：
            {effectiveReport.matchCount === 0
              ? "过关选择"
              : effectiveReport.modeLabel}{" "}
            ▴
          </button>

          {appliedPlan ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginLeft: 4,
              }}
            >
              <span className="qpill hi num">
                ⚖️ 智能分倍中 (总¥{effectiveReport.totalCost})
              </span>
              <button
                type="button"
                className="key mini num"
                onClick={() => scaleAppliedPlanBy(2)}
              >
                ×2倍扩仓
              </button>
              <button
                type="button"
                className="key mini"
                onClick={restoreEqualMultiple}
              >
                还原等倍
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginLeft: 4,
              }}
            >
              <span className="small" style={{ margin: 0 }}>
                倍数
              </span>
              <button
                type="button"
                className="key sq"
                onClick={() => stepMultiple(-1)}
              >
                −
              </button>
              <button
                type="button"
                className={`key sm num ${barPopover === "keypad" ? "on" : ""}`}
                onClick={() => {
                  setKeypadFresh(true);
                  setBarPopover((p) => (p === "keypad" ? null : "keypad"));
                }}
              >
                <b>{multiple}倍</b>
                <span style={{ fontSize: 11, opacity: 0.75 }}>⌨️</span>
              </button>
              <button
                type="button"
                className="key sq"
                onClick={() => stepMultiple(1)}
              >
                +
              </button>
            </div>
          )}
        </div>

        <div className="dk-bet-mid num">
          <div className="dk-bet-kpi">
            <b>
              应付 <span ref={slipAmtRef}>¥{effectiveReport.totalCost}</span>{" "}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-3)",
                }}
              >
                ({effectiveReport.betCount}注)
              </span>
            </b>
            <small
              style={{
                color:
                  !effectiveReport.canCheckout && effectiveReport.matchCount > 0
                    ? "var(--live)"
                    : effectiveReport.underwaterCount > 0
                      ? "var(--live)"
                      : undefined,
              }}
            >
              {effectiveReport.matchCount === 0
                ? "在左栏【赛事雷达】点选赔率，随时调整过关方式与倍数"
                : !effectiveReport.canCheckout
                  ? effectiveReport.ruleBlockReason ||
                    "未开单关 · 还差 1 场凑 2串1"
                  : effectiveReport.underwaterCount > 0
                    ? `保底 ¥${effectiveReport.minPayout.toFixed(2)} ~ 最高 ¥${effectiveReport.maxPayout.toFixed(2)} · ⚠️ ${effectiveReport.underwaterCount}组假中奖 · 真赚率 ${(effectiveReport.realProfitProb * 100).toFixed(1)}%`
                    : `真实保底 ¥${effectiveReport.minPayout.toFixed(2)} ~ 最高 ¥${effectiveReport.maxPayout.toFixed(2)} · 真赚率 ${(effectiveReport.realProfitProb * 100).toFixed(1)}%`}
            </small>
          </div>
        </div>

        <div className="dk-bet-right">
          <button
            type="button"
            className="key sm dark"
            disabled={!effectiveReport.canCheckout}
            style={{ opacity: effectiveReport.canCheckout ? 1 : 0.45 }}
            onClick={() => setSheet({ type: "poster" })}
          >
            🧾 查看实票核对单
          </button>
        </div>
      </div>
    </footer>
  );

  const mobileBetBarNode = isCompactMobileBar ? (
    <div ref={slipRef} className="m-betbar compact num">
      <button
        type="button"
        className={`m-bet-pill ${
          !effectiveReport.canCheckout && effectiveReport.matchCount > 0
            ? "warn"
            : "hi"
        }`}
        style={{
          maxWidth: 132,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        onClick={() => setBarPopover((p) => (p === "pass" ? null : "pass"))}
      >
        {effectiveReport.matchCount}场 ·{" "}
        {effectiveReport.matchCount === 0
          ? "过关选择"
          : appliedPlan
            ? "智能分倍"
            : effectiveReport.modeLabel}{" "}
        ▴
      </button>

      {appliedPlan ? (
        <div className="m-mul-grp" style={{ flexShrink: 0 }}>
          <button
            type="button"
            className="m-mul-val"
            title="×2倍扩仓"
            onClick={() => scaleAppliedPlanBy(2)}
          >
            ×2倍
          </button>
          <button
            type="button"
            className="m-bet-pill"
            title="还原等倍"
            onClick={restoreEqualMultiple}
          >
            等倍
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="m-mul-val"
          onClick={() => {
            setKeypadFresh(true);
            setBarPopover((p) => (p === "keypad" ? null : "keypad"));
          }}
        >
          {multiple}倍 ⌨️
        </button>
      )}

      <div
        className="m-bet-sum"
        style={{ cursor: "pointer", minWidth: 0 }}
        onClick={() => {
          if (appliedPlan) {
            setBarPopover((p) => (p === "pass" ? null : "pass"));
          } else {
            setKeypadFresh(true);
            setBarPopover((p) => (p === "keypad" ? null : "keypad"));
          }
        }}
      >
        <b ref={slipAmtRef}>¥{effectiveReport.totalCost}</b>
      </div>

      <button
        type="button"
        className="m-bet-go"
        style={{ flexShrink: 0 }}
        onClick={() => {
          setBarPopover(null);
          setTab(effectiveReport.matchCount === 0 ? "match" : "audit");
        }}
      >
        {effectiveReport.matchCount === 0 ? "选球" : "审单"}
      </button>
    </div>
  ) : (
    <div ref={slipRef} className="m-betbar num">
      <div className="m-betbar-r1">
        <div
          style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}
        >
          <button
            type="button"
            className="m-bet-trash"
            title="清空已选"
            onClick={() => {
              void betCtrl.clearPicks();
              haptic(14);
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6h16" />
              <path d="M9 6V4h6v2" />
              <path d="M18 6l-.8 13H6.8L6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="m-bet-pill"
            onClick={() =>
              setBarPopover((p) => (p === "selected" ? null : "selected"))
            }
          >
            已选{effectiveReport.matchCount}场 ▴
          </button>
          <button
            type="button"
            className={`m-bet-pill ${
              !effectiveReport.canCheckout && effectiveReport.matchCount > 0
                ? "warn"
                : "hi"
            }`}
            onClick={() => setBarPopover((p) => (p === "pass" ? null : "pass"))}
          >
            🎯{" "}
            {effectiveReport.matchCount === 0
              ? "过关选择"
              : effectiveReport.modeLabel}{" "}
            ▴
          </button>
        </div>
        <span style={{ fontSize: 10.5, opacity: 0.78, whiteSpace: "nowrap" }}>
          {effectiveReport.betCount}注
          {effectiveReport.poolCap < 8 ? `·限${effectiveReport.poolCap}关` : ""}
        </span>
      </div>

      <div className="m-betbar-r2">
        {appliedPlan ? (
          <div className="m-mul-grp">
            <span className="m-bet-pill">
              ⚖️智能分倍中(总¥{effectiveReport.totalCost})
            </span>
            <button
              type="button"
              className="m-mul-val"
              onClick={() => scaleAppliedPlanBy(2)}
            >
              ×2倍扩仓
            </button>
            <button
              type="button"
              className="m-bet-pill"
              onClick={restoreEqualMultiple}
            >
              还原等倍
            </button>
          </div>
        ) : (
          <div className="m-mul-grp">
            <button
              type="button"
              className="m-mul-step"
              onClick={() => stepMultiple(-1)}
            >
              −
            </button>
            <button
              type="button"
              className="m-mul-val"
              onClick={() => {
                setKeypadFresh(true);
                setBarPopover((p) => (p === "keypad" ? null : "keypad"));
              }}
            >
              {multiple}倍 ⌨️
            </button>
            <button
              type="button"
              className="m-mul-step"
              onClick={() => stepMultiple(1)}
            >
              +
            </button>
          </div>
        )}

        <div className="m-bet-sum">
          <b ref={slipAmtRef}>¥{effectiveReport.totalCost}</b>
          <small>
            {effectiveReport.matchCount === 0
              ? "点选赔率实时精算保底与真赚率"
              : !effectiveReport.canCheckout
                ? effectiveReport.ruleBlockReason || "未开单关·还差1场凑2串1"
                : effectiveReport.underwaterCount > 0
                  ? `保底¥${effectiveReport.minPayout.toFixed(0)} · ⚠️${effectiveReport.underwaterCount}注假中奖`
                  : `保底¥${effectiveReport.minPayout.toFixed(0)}~${effectiveReport.maxPayout.toFixed(0)} · 真赚${(effectiveReport.realProfitProb * 100).toFixed(0)}%`}
          </small>
        </div>

        <button
          type="button"
          className="m-bet-go"
          onClick={() => {
            setBarPopover(null);
            if (tab === "audit") {
              if (effectiveReport.canCheckout) setSheet({ type: "poster" });
              else setTab("match");
            } else {
              setTab("audit");
            }
          }}
        >
          {tab === "audit"
            ? effectiveReport.canCheckout
              ? "打票核对"
              : "去凑场次"
            : !effectiveReport.canCheckout && effectiveReport.matchCount === 1
              ? "合成单关"
              : effectiveReport.underwaterCount > 0
                ? "审单纠偏"
                : "五维审单"}
        </button>
      </div>
    </div>
  );

  const stopLossModalNode = stopLossPrompt ? (
    <div className="manual-backdrop" onClick={() => setStopLossPrompt(null)}>
      <div className="guardrail-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="guardrail-head">
          <b>🛑 每日止损护栏超限预警</b>
          <button
            type="button"
            className="key mini"
            onClick={() => setStopLossPrompt(null)}
          >
            取消
          </button>
        </div>
        <div className="note-box alert num">
          当前待记方案【<strong>{stopLossPrompt.draft.title}</strong>】本金{" "}
          <strong>¥{stopLossPrompt.draft.cost}</strong>
          ，已超出今日剩余止损护栏额度{" "}
          <strong>¥{stopLossPrompt.dailyRemaining.toFixed(2)}</strong>（单日上限
          ¥{stopLossPrompt.dailyLimit} · 超额{" "}
          <strong>¥{stopLossPrompt.overBy.toFixed(2)}</strong>）。
        </div>
        <div className="small" style={{ lineHeight: 1.5 }}>
          逆风或超额状态下盲目加码极易扩大回撤，建议先转为 0
          成本模拟观察单验证判断，若黑单未中将自动计入累计免损金额。
        </div>
        <button
          type="button"
          className="key dark full"
          disabled={ledgerBusy}
          style={{ marginTop: 2 }}
          onClick={() =>
            void submitLedgerEntry(stopLossPrompt.draft, "paper", false)
          }
        >
          🛡️ 一键转为 0 成本模拟观察单（防上头推荐）
        </button>
        <div className="two">
          <button
            type="button"
            className="key"
            disabled={ledgerBusy}
            onClick={() =>
              void submitLedgerEntry(stopLossPrompt.draft, "live", true)
            }
          >
            ⚠️ 确认超限，仍记入实买
          </button>
          <button
            type="button"
            className="key"
            disabled={ledgerBusy}
            onClick={() => setStopLossPrompt(null)}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const honeypotTrapNode = (
    <a
      href="/internal-export-trap"
      rel="nofollow"
      tabIndex={-1}
      aria-hidden="true"
      style={{ display: "none" }}
    >
      strategy-dump
    </a>
  );

  // Full-Gate Member Authentication Barrier (WeChat-style persistent login; zero calculator data before auth!)
  if (!authChecked && !authUser) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#070b14",
          color: "#94a3b8",
          fontSize: 13,
        }}
      >
        {honeypotTrapNode}
        正在验证加密通行状态...
      </div>
    );
  }

  if (!authUser) {
    return (
      <>
        {honeypotTrapNode}
        <LoginGate
          initialNotice={authNotice}
          onLoginSuccess={applyAuthenticatedBundle}
        />
      </>
    );
  }

  // ==================== DESKTOP WIDE-SCREEN PRO WORKBENCH (>= 960px) ====================
  if (isDesktop && !embedded) {
    return (
      <div className="jz-root">
        {honeypotTrapNode}
        <div ref={shellRef} className="jz-desktop">
          {/* Desktop Top Command Bar */}
          <header className="dk-topbar">
            <div className="dk-brand">
              <div className="dk-brand-mark">优竞</div>
              <div>
                <h1>优竞体育内部专用</h1>
                <p className="num">
                  智能精算与风控工作台 · 实盘 {visibleMatches.length} 场 · 同步{" "}
                  {syncClock}
                </p>
              </div>
            </div>

            <div className="dk-skin-bar" title="切换 8 套触感材质皮肤">
              {SKINS.map((sk) => (
                <button
                  key={sk.id}
                  type="button"
                  onClick={() => switchSkinSmooth(sk.id)}
                  className={`dk-skin-pill ${sk.id === skin ? "on" : ""}`}
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
                  className={syncing ? "spin" : ""}
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
                className="key sm"
                onClick={() => setSheet({ type: "tactile" })}
                title="调节手机震动波形强度与超感特效"
              >
                🎮 超感舱
              </button>
              <button
                type="button"
                data-spring="0.9"
                className="key sm dark"
                onClick={() => openManual("sandbox")}
              >
                📘 图文说明书
              </button>
              {authUser.role === "superadmin" && (
                <button
                  type="button"
                  data-spring="0.9"
                  className="key sm dark"
                  onClick={() => setAdminOpen(true)}
                  title="超级管理员专属隐形总控台"
                >
                  👑 总控台
                </button>
              )}
              {effectiveReport.matchCount > 0 && (
                <button
                  type="button"
                  data-spring="0.9"
                  className="key sm"
                  onClick={() => setSheet({ type: "poster" })}
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
                      onClick={() => openManual("glossary")}
                    >
                      ? 抽水与真率图解
                    </button>
                  </span>
                  <button
                    type="button"
                    className="key mini"
                    onClick={() => setSheet({ type: "filter" })}
                  >
                    筛选联赛
                  </button>
                </div>
                <SpringSegmented
                  options={MODE_OPTS}
                  value={mode}
                  onChange={handleModeChange}
                  skinKey={skin}
                />
                {filterStripNode}
              </div>
              <div className="dk-col-scroll">{matchContent}</div>
            </section>

            {/* Column 2: 五维审单锁利 & 三模奖金优化 */}
            <section ref={desktopAuditColRef} className="dk-col">
              <div className="dk-col-head">
                <div className="dk-col-head-row" style={{ marginBottom: 0 }}>
                  <span className="dk-col-title">
                    🛡️ 五维审单锁利 · 奖金优化台
                    <button
                      type="button"
                      className="help-pill"
                      onClick={() => openManual("hedge")}
                    >
                      ? 锁利对冲图解
                    </button>
                  </span>
                  {picks.length > 0 && (
                    <button
                      type="button"
                      className="key mini"
                      onClick={() => {
                        void betCtrl.clearPicks();
                      }}
                    >
                      清空已选
                    </button>
                  )}
                </div>
              </div>
              <div className="dk-col-scroll">{auditContent}</div>
            </section>

            {/* Column 3: 3+1 精算配单 & 扫地僧小高排雷账本 */}
            <section className="dk-col dk-col-right">
              <div className="dk-col-head">
                <div className="dk-col-head-row">
                  <SpringSegmented
                    options={[
                      ["archetypes", "🎯 3+1 精算配单"],
                      ["ledger", "🧹 小高排雷与账本"],
                    ]}
                    value={dkRightTab}
                    onChange={setDkRightTab}
                    skinKey={skin}
                  />
                  <button
                    type="button"
                    className="help-pill"
                    onClick={() =>
                      openManual(
                        dkRightTab === "archetypes" ? "archetypes" : "xiaogao"
                      )
                    }
                  >
                    ? 说明
                  </button>
                </div>
                {dkRightTab === "archetypes" && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span className="small">目标投入预算档位</span>
                      <div style={{ display: "flex", gap: 5 }}>
                        {[50, 100, 200, 500].map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setBudget(b)}
                            className={`key mini num ${budget === b ? "on" : ""}`}
                          >
                            ¥{b}
                          </button>
                        ))}
                      </div>
                    </div>
                    <SpringSegmented
                      options={archOpts}
                      value={archKey}
                      onChange={setArchKey}
                      skinKey={skin}
                    />
                  </>
                )}
              </div>
              <div className="dk-col-scroll">
                {dkRightTab === "archetypes"
                  ? archetypesContent
                  : ledgerContent}
              </div>
            </section>
          </div>

          {desktopBetDockNode}
          {betPopoverNode}
          {overlayLayerNode}
          {stopLossModalNode}
          <UserManualModal
            open={manualOpen}
            initialSection={manualSection}
            onClose={() => setManualOpen(false)}
            onQuotaUpdate={syncRemainingAiQuota}
          />
          {authUser.role === "superadmin" && (
            <AdminConsoleModal
              open={adminOpen}
              currentUser={authUser}
              onClose={() => setAdminOpen(false)}
            />
          )}
        </div>
      </div>
    );
  }

  // ==================== MOBILE FULL-BLEED WEB APP (< 960px or embedded) ====================
  return (
    <div className={`jz-root ${embedded ? "embed" : ""}`}>
      {honeypotTrapNode}
      <div ref={shellRef} className="shell">
        {/* Fake Status Bar only inside 8-skin showcase iframes */}
        {embedded && (
          <div className="sbar num">
            <span>21:06</span>
            <div className="sbar-i">
              <span style={{ fontSize: 10.5, opacity: 0.72, marginRight: 4 }}>
                距22:00停售 54m
              </span>
              <svg
                width="15"
                height="11"
                viewBox="0 0 16 12"
                fill="currentColor"
              >
                <rect x="1" y="7" width="2.2" height="4" rx=".8" />
                <rect x="4.5" y="5" width="2.2" height="6" rx=".8" />
                <rect x="8" y="3" width="2.2" height="8" rx=".8" />
                <rect x="11.5" y="1" width="2.2" height="10" rx=".8" />
              </svg>
              <svg width="20" height="11" viewBox="0 0 22 12" fill="none">
                <rect
                  x="1"
                  y="1.5"
                  width="17"
                  height="9"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <rect
                  x="3"
                  y="3.3"
                  width="13"
                  height="5.4"
                  rx="1.2"
                  fill="currentColor"
                />
                <path
                  d="M19.5 4.2v3.6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Mobile Header */}
        <div className="top">
          {tab === "match" && (
            <>
              <div className="title-row">
                <div style={{ minWidth: 0 }}>
                  <span className="h1">优竞体育内部专用</span>
                  <span className="sub num">
                    实盘 {visibleMatches.length} 场 · 同步{" "}
                    {syncClock.slice(0, 5)}
                  </span>
                </div>
                <div className="hdr-acts">
                  <button
                    type="button"
                    className="key pillk"
                    data-spring="0.88"
                    onClick={() => setSheet({ type: "tactile" })}
                  >
                    🎮超感
                  </button>
                  <button
                    type="button"
                    className="key pillk dark"
                    data-spring="0.88"
                    onClick={() => openManual("sandbox")}
                  >
                    📘说明书
                  </button>
                  {authUser.role === "superadmin" && (
                    <button
                      type="button"
                      className="key pillk dark"
                      data-spring="0.88"
                      onClick={() => setAdminOpen(true)}
                    >
                      👑总控
                    </button>
                  )}
                  <button
                    type="button"
                    className="round-key"
                    data-spring="0.86"
                    title="手动同步中国体彩官网水位"
                    onClick={() => void runOfficialSync(true)}
                  >
                    <svg
                      className={syncing ? "spin" : ""}
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
                    onClick={() => setSheet({ type: "filter" })}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                    >
                      <line x1="4" y1="7" x2="20" y2="7" />
                      <line x1="7" y1="12" x2="17" y2="12" />
                      <line x1="10" y1="17" x2="14" y2="17" />
                    </svg>
                  </button>
                </div>
              </div>
              <SpringSegmented
                options={MODE_OPTS}
                value={mode}
                onChange={handleModeChange}
                skinKey={skin}
              />
              {filterStripNode}
            </>
          )}

          {tab === "archetypes" && (
            <>
              <div className="title-row">
                <div style={{ minWidth: 0 }}>
                  <span className="h1">优竞体育内部专用</span>
                  <span className="sub num">
                    五池闭合校准 · 3+1 帕累托精算配单
                  </span>
                </div>
                <div className="hdr-acts" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="key mini"
                    data-spring="0.88"
                    onClick={() => setSheet({ type: "tactile" })}
                    title="超感震动舱"
                  >
                    🎮
                  </button>
                  <button
                    type="button"
                    className="help-pill"
                    onClick={() => openManual("archetypes")}
                  >
                    📘图解
                  </button>
                  {authUser.role === "superadmin" && (
                    <button
                      type="button"
                      className="key mini dark"
                      onClick={() => setAdminOpen(true)}
                    >
                      👑总控
                    </button>
                  )}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span className="small" style={{ margin: 0 }}>
                  目标投入预算档位
                </span>
                <div style={{ display: "flex", gap: 5 }}>
                  {[50, 100, 200, 500].map((b) => (
                    <button
                      key={b}
                      type="button"
                      data-spring="0.88"
                      onClick={() => {
                        haptic(5);
                        setBudget(b);
                      }}
                      className={`key mini num ${budget === b ? "on" : ""}`}
                    >
                      ¥{b}
                    </button>
                  ))}
                </div>
              </div>
              <SpringSegmented
                options={archOpts}
                value={archKey}
                onChange={setArchKey}
                skinKey={skin}
              />
            </>
          )}

          {tab === "audit" && (
            <div className="title-row">
              <div>
                <span className="h1">优竞体育内部专用</span>
                <span className="sub num">五维审单 · 三模奖金优化 · 锁利</span>
              </div>
              <div className="hdr-acts">
                <button
                  type="button"
                  className="key pillk"
                  data-spring="0.88"
                  onClick={() => setSheet({ type: "tactile" })}
                >
                  🎮超感
                </button>
                <button
                  type="button"
                  className="help-pill"
                  onClick={() => openManual("optimizer")}
                >
                  📘说明书
                </button>
                {authUser.role === "superadmin" && (
                  <button
                    type="button"
                    className="key pillk dark"
                    data-spring="0.88"
                    onClick={() => setAdminOpen(true)}
                  >
                    👑总控
                  </button>
                )}
                {effectiveReport.matchCount > 0 && (
                  <button
                    type="button"
                    data-spring="0.88"
                    className="key pillk dark"
                    onClick={() => setSheet({ type: "poster" })}
                  >
                    店面核对卡
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === "ledger" && (
            <div className="title-row">
              <div>
                <span className="h1">优竞体育内部专用</span>
                <span className="sub num">
                  扫地僧小高排雷 · 止损账本 · 皮肤
                </span>
              </div>
              <div className="hdr-acts">
                <button
                  type="button"
                  className="key pillk"
                  data-spring="0.88"
                  onClick={() => setSheet({ type: "tactile" })}
                >
                  🎮超感
                </button>
                <button
                  type="button"
                  className="help-pill"
                  onClick={() => openManual("xiaogao")}
                >
                  📘说明书
                </button>
                {authUser.role === "superadmin" && (
                  <button
                    type="button"
                    className="key pillk dark"
                    data-spring="0.88"
                    onClick={() => setAdminOpen(true)}
                  >
                    👑总控
                  </button>
                )}
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
        <div
          ref={scrollRef}
          className={`scroll ${isCompactMobileBar ? "compact-pad" : ""}`}
        >
          {tab === "match" && matchContent}
          {tab === "archetypes" && archetypesContent}
          {tab === "audit" && auditContent}
          {tab === "ledger" && ledgerContent}
        </div>

        {/* Global Persistent Pass Selection + Multiplier Control Bar across ALL 4 Tabs */}
        {mobileBetBarNode}
        {betPopoverNode}

        {/* Bottom 4-Tab Dock */}
        <div className="dock">
          <nav ref={navRef} className="nav">
            <div ref={puckRef} className="nav-puck" />
            {(
              [
                [
                  "match",
                  "赛事雷达",
                  <svg
                    key="m"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2.5" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                    <circle cx="12" cy="12" r="2.8" />
                  </svg>,
                  false,
                ],
                [
                  "archetypes",
                  "精算配单",
                  <svg
                    key="a"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="12 2 19 21 12 17 5 21 12 2" />
                  </svg>,
                  false,
                ],
                [
                  "audit",
                  "审单锁利",
                  <svg
                    key="u"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>,
                  allWarnings.length > 0,
                ],
                [
                  "ledger",
                  "情报账本",
                  <svg
                    key="l"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="8" r="3.8" />
                    <path d="M5 20a7 7 0 0 1 14 0" />
                  </svg>,
                  false,
                ],
              ] as const
            ).map(([k, label, icon, hasDot]) => (
              <button
                key={k}
                type="button"
                data-spring="0.9"
                onClick={(e) => {
                  const ico =
                    e.currentTarget.querySelector<HTMLElement>(".nav-ico");
                  if (ico) fxOf(ico).scale.config(520, 11).kick(4.2);
                  haptic(6);
                  setSheet(null);
                  setTab(k);
                }}
                className={`nav-b ${tab === k ? "on" : ""}`}
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
        {stopLossModalNode}
        <UserManualModal
          open={manualOpen}
          initialSection={manualSection}
          onClose={() => setManualOpen(false)}
        />
        {authUser.role === "superadmin" && (
          <AdminConsoleModal
            open={adminOpen}
            currentUser={authUser}
            onClose={() => setAdminOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
