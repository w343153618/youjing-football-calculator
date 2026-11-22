import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  ArchetypePlan,
  BridgeMatchCandidate,
  EquivalentArbItem,
  MatchItem,
  PoolCode,
  SyntheticSingleMode,
} from "../../prototype/quantTypes.ts";
import { initHighPressureAntiReverseShield } from "../../security/antiReverseShield.ts";
import type { AuthenticatedWorkspaceBundle } from "../../security/secureClient.ts";
import {
  Spring,
  animateNumber,
  ensureGlobalTactileListener,
  enterStagger,
  fxOf,
  haptic,
  readSpringTokens,
  setGlobalTimeScale,
} from "../../spring/engine.ts";
import {
  burstCelebrationSparks,
  getTactileState,
  launchParabolicOrb,
  playTactileCue,
  shudderDangerElement,
  triggerShimmerSweep,
  updateTactileState,
} from "../../spring/tactileSymphony.ts";
import { kickElement } from "../../spring/widgets.tsx";
import type {
  MatchMode,
  PresetScenarioKind,
} from "../../workspace/betSlipController.ts";
import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import type {
  AppTab,
  DesktopRightCabinTab,
  HandoffBannerState,
  MobileTab4Cabin,
  QuickFilter,
  SheetState,
} from "./cabinViewModels.ts";

export const APP_DOC_TITLE = "优竞体育内部专用 · 智能精算与风控工作台";

export function useShellChoreography({
  initialSkin,
  embedded,
  wbCtrl,
  wbSnap,
  tab,
  setTab,
  dkRightTab,
  setDkRightTab,
  mobileCabin,
  setMobileCabin,
  setDkFocusStep,
  mode,
  qFilter,
  sheet,
  setSheet,
  handoffBanner,
  setHandoffBanner,
  poolSwitchVisible,
  poolSwitchSeq,
  setPoolSwitchVisible,
  setPoolSwitchSeq,
  refs,
  notifyToast,
}: {
  initialSkin: string;
  embedded: boolean;
  wbCtrl: WorkbenchController;
  wbSnap: WorkbenchSnapshot;
  tab: AppTab;
  setTab: (next: AppTab) => void;
  dkRightTab: DesktopRightCabinTab;
  setDkRightTab: (next: DesktopRightCabinTab) => void;
  mobileCabin: MobileTab4Cabin;
  setMobileCabin: (next: MobileTab4Cabin) => void;
  setDkFocusStep: (next: 1 | 2 | 3 | null) => void;
  mode: MatchMode;
  qFilter: QuickFilter;
  sheet: SheetState;
  setSheet: (next: SheetState) => void;
  handoffBanner: HandoffBannerState | null;
  setHandoffBanner: (next: HandoffBannerState | null) => void;
  poolSwitchVisible: boolean;
  poolSwitchSeq: number;
  setPoolSwitchVisible: (next: boolean) => void;
  setPoolSwitchSeq: (next: number) => void;
  refs: {
    shellRef: RefObject<HTMLDivElement | null>;
    scrollRef: RefObject<HTMLDivElement | null>;
    navRef: RefObject<HTMLElement | null>;
    puckRef: RefObject<HTMLDivElement | null>;
    slipRef: RefObject<HTMLDivElement | null>;
    slipAmtRef: RefObject<HTMLSpanElement | null>;
    auditCockpitRef: RefObject<HTMLDivElement | null>;
    desktopMatchColRef: RefObject<HTMLElement | null>;
    desktopArchColRef: RefObject<HTMLElement | null>;
    desktopAuditColRef: RefObject<HTMLElement | null>;
    underwaterTileRef: RefObject<HTMLDivElement | null>;
    balValRef: RefObject<HTMLSpanElement | null>;
  };
  notifyToast: (msg: string) => void;
}) {
  const base = import.meta.env.BASE_URL || "/";
  const [skin, setSkin] = useState<string>(initialSkin);
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => !embedded && typeof window !== "undefined" && window.innerWidth >= 960
  );
  const [cutoffTickNow, setCutoffTickNow] = useState<number>(() => Date.now());
  const [tactileCfg, setTactileCfg] = useState(() => getTactileState());

  const skinLinkRef = useRef<HTMLLinkElement | null>(null);
  const puckSpringRef = useRef<Spring | null>(null);
  const prevAmtRef = useRef<number>(-1);
  const prevBalRef = useRef<number>(wbSnap.ledger.dailyRemaining);
  const prevUwRef = useRef<number>(
    wbSnap.betSlipState.workspace.effectiveReport.underwaterCount
  );

  const betCtrl = wbCtrl.betSlip;
  const { authUser, ledger, playabilityGates } = wbSnap;
  const { matches, planSpec, lastPoolSwitchUndo, workspace } =
    wbSnap.betSlipState;
  const effectiveReport = workspace.effectiveReport;

  useEffect(() => {
    if (embedded) return;
    const onResize = () => setIsDesktop(window.innerWidth >= 960);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [embedded]);

  const placePuck = (animate: boolean) => {
    const nav = refs.navRef.current;
    const puckEl = refs.puckRef.current;
    if (!nav || !puckEl) return;
    if (!puckSpringRef.current) {
      puckSpringRef.current = new Spring(0, {
        k: 480,
        c: 28,
        eps: 0.05,
        onUpdate: (v) => {
          const el = refs.puckRef.current;
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
    const x = idx * cellW + (cellW - (puckEl.offsetWidth || 64)) / 2;
    if (animate) puckSpringRef.current.set(x);
    else puckSpringRef.current.jump(x);
  };

  useEffect(() => {
    initHighPressureAntiReverseShield(embedded);
    ensureGlobalTactileListener();
    setTactileCfg(updateTactileState({ skin }));
    if (!document.getElementById("jz-core-css")) {
      const coreLink = document.createElement("link");
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
    return () => sLink.remove();
  }, []);

  const switchSkinSmooth = (nextId: string, silent = false) => {
    if (nextId === skin) return;
    setSkin(nextId);
    setTactileCfg(updateTactileState({ skin: nextId }));
    if (!silent) playTactileCue("skin-shift");
    const sh = refs.shellRef.current;
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

  useEffect(() => {
    let alive = true;
    const runHandshake = async (isReconnect = false) => {
      const res = await wbCtrl.bootstrapHandshake({
        isReconnect,
        maxAttempts: 2,
        retryDelayMs: 700,
      });
      if (!alive || !res.ok) return;
      document.title = APP_DOC_TITLE;
      if ((res.newlySettledCount ?? 0) > 0) {
        playTactileCue("defuse-celebrate");
        notifyToast(
          `🎉 官方完场自动对奖：已自动结算 ${res.newlySettledCount} 笔账本订单`
        );
      }
    };
    void runHandshake(false);
    const hasSession = () => wbCtrl.hasPersistedSession();
    const onOnline = () => {
      if (hasSession()) void runHandshake(true);
    };
    const onVis = () => {
      if (!document.hidden && wbCtrl.getState().offlineMode && hasSession()) {
        void runHandshake(true);
      }
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [wbCtrl]);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== "object") return;
      if (d.cmd === "setTab") {
        setSheet(null);
        setTab(d.value as AppTab);
      } else if (d.cmd === "openMore") {
        setTab("match");
        betCtrl.setMode("mix");
        setTimeout(() => {
          const first = betCtrl.getState().matches[0];
          if (first) setSheet({ type: "more", matchId: first.id });
        }, 60);
      } else if (d.cmd === "openIntel") {
        setTab("match");
        setTimeout(() => {
          const first = betCtrl.getState().matches[0];
          if (first) setSheet({ type: "intel", matchId: first.id });
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

  useLayoutEffect(() => {
    placePuck(true);
    if (refs.scrollRef.current) {
      refs.scrollRef.current.scrollTop = 0;
      enterStagger(refs.scrollRef.current, 30);
    }
  }, [tab, mode, qFilter]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setCutoffTickNow(Date.now()),
      60_000
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!poolSwitchVisible || !lastPoolSwitchUndo) return;
    const timer = window.setTimeout(() => setPoolSwitchVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [poolSwitchVisible, poolSwitchSeq, lastPoolSwitchUndo]);

  useEffect(() => {
    if (!planSpec) setHandoffBanner(null);
  }, [planSpec]);

  useEffect(() => {
    if (!handoffBanner || (!isDesktop && tab !== "audit")) return;
    const rafId = requestAnimationFrame(() => {
      refs.scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      refs.desktopAuditColRef.current
        ?.querySelector(".dk-col-scroll")
        ?.scrollTo({ top: 0, behavior: "smooth" });
      triggerShimmerSweep(refs.auditCockpitRef.current);
      burstCelebrationSparks(refs.auditCockpitRef.current, 24);
    });
    return () => cancelAnimationFrame(rafId);
  }, [handoffBanner?.seq, tab, dkRightTab, isDesktop]);

  useLayoutEffect(() => {
    if (effectiveReport.totalCost !== prevAmtRef.current) {
      if (prevAmtRef.current >= 0 && refs.slipAmtRef.current) {
        animateNumber(
          refs.slipAmtRef.current,
          prevAmtRef.current,
          effectiveReport.totalCost,
          (v) => `¥${Math.round(v)}`
        );
        fxOf(refs.slipAmtRef.current).scale.config(600, 14).kick(1.9);
      } else if (refs.slipAmtRef.current) {
        refs.slipAmtRef.current.textContent = `¥${effectiveReport.totalCost}`;
      }
    }
    prevAmtRef.current = effectiveReport.totalCost;
  }, [tab, isDesktop, effectiveReport.matchCount, effectiveReport.totalCost]);

  useLayoutEffect(() => {
    const ledgerVisible =
      tab === "ledger" || (isDesktop && !embedded && dkRightTab === "ledger");
    if (ledgerVisible && refs.balValRef.current) {
      animateNumber(
        refs.balValRef.current,
        prevBalRef.current,
        ledger.dailyRemaining,
        (v) => `¥${v.toFixed(2)}`
      );
      prevBalRef.current = ledger.dailyRemaining;
    }
  }, [tab, isDesktop, embedded, dkRightTab, ledger.dailyRemaining]);

  useEffect(() => {
    if (
      effectiveReport.underwaterCount > prevUwRef.current &&
      effectiveReport.underwaterCount > 0
    ) {
      shudderDangerElement(
        refs.underwaterTileRef.current ?? refs.slipRef.current
      );
    }
    prevUwRef.current = effectiveReport.underwaterCount;
  }, [effectiveReport.underwaterCount]);

  useEffect(() => {
    const ledgerActive =
      (tab === "ledger" && mobileCabin === "ledger") ||
      (isDesktop && !embedded && dkRightTab === "ledger");
    if (!ledgerActive || !authUser) return;
    const hasPendingSnap = ledger.entries.some(
      (e) =>
        Boolean(e.snapshot?.lines?.length) &&
        !e.manualOverride &&
        (e.status === "pending" || !e.settlementDetail)
    );
    if (hasPendingSnap) {
      void wbCtrl.refreshLedgerAutoSettle({ force: false }).then((res) => {
        if ((res.newlySettledCount ?? 0) > 0) {
          playTactileCue("defuse-celebrate");
          notifyToast(
            `🎉 已按体彩官方完场赛果自动结算 ${res.newlySettledCount} 笔订单`
          );
        }
      });
    }
  }, [tab, mobileCabin, isDesktop, embedded, dkRightTab, authUser?.id]);

  const applyAuthenticatedBundle = (bundle: AuthenticatedWorkspaceBundle) => {
    document.title = APP_DOC_TITLE;
    wbCtrl.applyLoginBundle(bundle);
    if ((bundle.newlySettledCount ?? 0) > 0) {
      playTactileCue("defuse-celebrate");
      notifyToast(
        `🎉 官方完场自动对奖：已自动结算 ${bundle.newlySettledCount} 笔账本订单`
      );
    }
  };

  const runOfficialSync = async (toastOnDone = false) => {
    const res = await wbCtrl.syncOfficialMatches();
    if (res.ok) {
      document.title = APP_DOC_TITLE;
      if ((res.newlySettledCount ?? 0) > 0) {
        playTactileCue("defuse-celebrate");
        notifyToast(
          `🎉 同步水位并自动对奖完成：新结 ${res.newlySettledCount} 笔订单`
        );
      } else if (toastOnDone) {
        notifyToast(
          `已加密同步 ${res.matchCount ?? matches.length} 场官网实盘`
        );
      }
    } else if (toastOnDone) {
      notifyToast("同步繁忙，请稍后再试");
    }
  };

  const loadPresetScenario = (kind: PresetScenarioKind) => {
    haptic(10);
    betCtrl.loadPresetScenario(kind);
    const toastMap: Record<PresetScenarioKind, string> = {
      underwater: "已载入：半全场假中奖陷阱",
      synthetic: "已载入：半全场合成单关",
      parlay4: "已载入：4串1连乘抽水雪崩",
      hedge2: "已载入：早晚场时间差锁利",
    };
    notifyToast(toastMap[kind]);
    setTab("audit");
  };

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
      notifyToast(verdict.blockedReason || "当前选项不可选");
      return;
    }
    setPoolSwitchVisible(verdict.action === "switched-pool");
    if (verdict.action === "switched-pool") setPoolSwitchSeq(Date.now());
    if (verdict.autoLockedSingleReason === "dual-single") {
      notifyToast("同时选同场两个单关玩法，已按体彩规则自动锁定【单关】");
    } else if (verdict.autoLockedSingleReason === "over-8-matches") {
      notifyToast("超过 8 场赛事，已按体彩规则自动锁定【单关】");
    }
    const removed = verdict.action === "removed";
    kickElement(el, removed ? -1.4 : 2.8);
    if (removed) {
      playTactileCue("tap-off");
    } else {
      playTactileCue("tap-on");
      const targetContainer =
        isDesktop && !embedded
          ? (refs.auditCockpitRef.current ?? refs.desktopAuditColRef.current)
          : refs.slipRef.current;
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
    if (!betCtrl.applyEquivalentSwap(arb)) return;
    playTactileCue("optimize-arpeggio");
    if (triggerEl) burstCelebrationSparks(triggerEl, 16);
    notifyToast(`已切换高水同义项 · ${arb.betterChoice}`);
  };

  const switchSyntheticSingleModeUI = (nextMode: SyntheticSingleMode) => {
    betCtrl.setSyntheticSingleMode(nextMode);
    haptic(7);
    playTactileCue("tap-on");
    notifyToast(
      nextMode === "partial-cover"
        ? "⚠️ 已确认授权：部分覆盖/超额配平合成单关"
        : nextMode === "full-3way"
          ? playabilityGates.hasSyntheticInherentBlindSpot
            ? "🛡️ 已切换：常规比分覆盖配平合成单关"
            : "🛡️ 已切换：3项全包无死角配平合成单关"
          : nextMode === "trim-2way"
            ? "⚡ 已切换：2项省本搏常规（请注意逆转漏网风险）"
            : "🌉 已展开过桥配菜搭子，点选任一搭子即凑 2串1"
    );
  };

  const applyArchetype = (plan: ArchetypePlan) => {
    if (!betCtrl.applyArchetype(plan)) return;
    playTactileCue("defuse-celebrate");
    setHandoffBanner({
      title: plan.shortTab,
      cost: plan.totalCost,
      seq: Date.now(),
    });
    setDkFocusStep(3);
    setDkRightTab("audit");
    setTab("audit");
    notifyToast(`✅ 已移交审单台 · 精算配单【${plan.shortTab}】`);
  };

  const restoreEqualMultiple = () => {
    betCtrl.restoreEqualMultiple();
    setHandoffBanner(null);
    setDkFocusStep(null);
    playTactileCue("tap-off");
    notifyToast("已恢复默认等倍统配");
  };

  const toggleBankerMatchUI = (
    matchId: string,
    homeName: string,
    triggerEl?: HTMLElement | null
  ) => {
    const res = betCtrl.toggleBankerMatch(matchId);
    if (!res.ok) {
      haptic(12);
      notifyToast(res.reason || "当前不可设胆");
      return;
    }
    kickElement(triggerEl ?? null, res.isBanker ? 2.4 : -1.2);
    playTactileCue(res.isBanker ? "tap-on" : "tap-off");
    notifyToast(
      res.isBanker
        ? `📌 已设【${homeName}】为必出稳胆（自动剔除无胆冗余组合）`
        : `已取消【${homeName}】胆码`
    );
  };

  const applyBridgeCandidateUI = (
    cand: BridgeMatchCandidate,
    triggerEl?: HTMLElement | null
  ) => {
    const res = betCtrl.applyBridgeCandidate(cand);
    if (!res.ok) {
      haptic(12);
      notifyToast(res.blockedReason || "无法搭上该配菜场");
      return;
    }
    playTactileCue("optimize-arpeggio");
    if (triggerEl) burstCelebrationSparks(triggerEl, 18);
    notifyToast(
      `🌉 已搭上【${cand.matchNumStr} ${cand.home}·${cand.optionLabel}@${cand.odds.toFixed(2)}】凑成合法 2串1`
    );
  };

  const finalizeLedgerRecord = (
    kind: "live" | "paper",
    res: { ok: boolean; code?: string; error?: string },
    costHint: number
  ) => {
    if (res.ok) {
      if (sheet?.type === "poster") setSheet(null);
      haptic(14);
      playTactileCue(kind === "paper" ? "optimize-arpeggio" : "ticket-stamp");
      notifyToast(
        kind === "live"
          ? `已封存出票快照并记入实买账本（本金 ¥${costHint}）`
          : `已存为 0 成本模拟观察单（拟投 ¥${costHint}）`
      );
      setMobileCabin("ledger");
      setTab("ledger");
      setDkRightTab("ledger");
      return;
    }
    if (res.code === "STOP_LOSS_EXCEEDED") {
      shudderDangerElement(
        refs.auditCockpitRef.current ?? refs.slipRef.current
      );
      haptic(20);
    } else if (res.code === "UNPLAYABLE_SLIP") {
      shudderDangerElement(
        refs.auditCockpitRef.current ?? refs.slipRef.current
      );
      haptic(14);
      notifyToast(res.error || "当前方案暂无法记入账本");
    } else if (res.error && res.code !== "BUSY") {
      notifyToast(res.error);
    }
  };

  const recordToLedger = (kind: "live" | "paper") => {
    const costHint = effectiveReport.totalCost;
    void wbCtrl
      .recordToLedger(kind)
      .then((res) => finalizeLedgerRecord(kind, res, costHint));
  };

  const triggerXiaoGaoLive = async (m: MatchItem, extraNote?: string) => {
    playTactileCue("radar-ping");
    const res = await wbCtrl.diagnoseSingleMatch(m.id, extraNote);
    if (res.ok) {
      playTactileCue("radar-lock");
      notifyToast("扫地僧小高已完成单场实时排雷");
    } else if (res.error !== "当前已有排雷任务进行中") {
      notifyToast(res.error);
    }
  };

  const triggerXiaoGaoComboLive = async (
    sourceMode: "picked" | "custom",
    userNote?: string
  ) => {
    playTactileCue("radar-ping");
    const res = await wbCtrl.diagnoseComboSlip({ sourceMode, userNote });
    if (res.ok) {
      playTactileCue("radar-lock");
      notifyToast(`已完成 ${res.matchCount} 场串关联合排雷会诊`);
    } else if (res.error !== "当前已有排雷任务进行中") {
      notifyToast(res.error);
    }
  };

  const handleModeChange = (nextMode: MatchMode) => {
    const { trimmed } = betCtrl.setMode(nextMode);
    if (trimmed) {
      notifyToast("切换至混合/单项过关，同场仅保留单一玩法");
    }
  };

  const handleSelectFlowStep = (step: 1 | 2 | 3) => {
    haptic(4);
    setTab(step === 1 ? "match" : step === 2 ? "archetypes" : "audit");
    if (!isDesktop) return;
    setDkFocusStep(step);
    if (step === 3) setDkRightTab("audit");
    const colEl =
      step === 1
        ? refs.desktopMatchColRef.current
        : step === 2
          ? refs.desktopArchColRef.current
          : refs.desktopAuditColRef.current;
    colEl
      ?.querySelector(".dk-col-scroll")
      ?.scrollTo({ top: 0, behavior: "smooth" });
    triggerShimmerSweep(
      step === 3 ? (refs.auditCockpitRef.current ?? colEl) : colEl
    );
  };

  return {
    skin,
    isDesktop,
    cutoffTickNow,
    tactileCfg,
    setTactileCfg,
    switchSkinSmooth,
    actions: {
      applyAuthenticatedBundle,
      runOfficialSync,
      loadPresetScenario,
      togglePick,
      applyEquivalentSwap,
      switchSyntheticSingleModeUI,
      applyArchetype,
      restoreEqualMultiple,
      toggleBankerMatchUI,
      applyBridgeCandidateUI,
      finalizeLedgerRecord,
      recordToLedger,
      triggerXiaoGaoLive,
      triggerXiaoGaoComboLive,
      handleModeChange,
      handleSelectFlowStep,
    },
  };
}
