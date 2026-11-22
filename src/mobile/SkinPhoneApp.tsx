import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { AdminConsoleModal } from "../admin/AdminConsoleModal";
import { LoginGate } from "../auth/LoginGate";
import {
  UserManualModal,
  type ManualSectionId,
} from "../manual/UserManualModal";
import type { PortfolioKey } from "../prototype/quantTypes";
import { showSpringToast } from "../spring/engine";
import { SpringSegmented } from "../spring/widgets";
import {
  computeSportteryCutoffStatus,
  filterAndGroupRadarMatches,
} from "../workspace/betSlipController";
import { createWorkbenchController } from "../workspace/workbenchController";
import { AuditCockpitCabin } from "./cabins/AuditCockpitCabin";
import {
  BottomSheetsLayer,
  HoneypotTrapLink,
  StopLossInterceptModal,
} from "./cabins/BottomSheetsLayer";
import { IntelCabin } from "./cabins/IntelCabin";
import { LedgerCabin } from "./cabins/LedgerCabin";
import {
  MatchRadarCabin,
  MatchRadarFilterToolbar,
} from "./cabins/MatchRadarCabin";
import {
  ParetoPortfolioCabin,
  PortfolioBudgetHeader,
} from "./cabins/ParetoPortfolioCabin";
import {
  DesktopCommandHeader,
  MobileBottomDock,
  MobileCompactTopBar,
  PersistentBetBar,
  StepFlowBar,
} from "./cabins/PersistentBetBar";
import {
  DESKTOP_RIGHT_CABIN_TABS,
  RADAR_MODE_OPTS,
  buildMobileTab4CabinOptions,
  type AppTab,
  type DesktopRightCabinTab,
  type HandoffBannerState,
  type MobileTab4Cabin,
  type QuickFilter,
  type SheetState,
} from "./cabins/cabinViewModels";
import { useShellChoreography } from "./cabins/useShellChoreography";

export function SkinPhoneApp({
  initialSkin,
  embedded,
  onOpenStage,
}: {
  initialSkin: string;
  embedded: boolean;
  onOpenStage?: () => void;
}) {
  const [tab, setTab] = useState<AppTab>("match");
  const [dkRightTab, setDkRightTab] = useState<DesktopRightCabinTab>("audit");
  const [mobileCabin, setMobileCabin] = useState<MobileTab4Cabin>("ledger");
  const [dkFocusStep, setDkFocusStep] = useState<1 | 2 | 3 | null>(null);
  const [archKey, setArchKey] = useState<PortfolioKey>("max-ev-utility");
  const [qFilter, setQFilter] = useState<QuickFilter>("all");
  const [radarSearchQuery, setRadarSearchQuery] = useState<string>("");
  const [leagueFilter, setLeagueFilter] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<SheetState>(null);
  const [manualOpen, setManualOpen] = useState<boolean>(false);
  const [manualSection, setManualSection] =
    useState<ManualSectionId>("optimizer");
  const [adminOpen, setAdminOpen] = useState<boolean>(false);
  const [poolSwitchVisible, setPoolSwitchVisible] = useState<boolean>(false);
  const [poolSwitchSeq, setPoolSwitchSeq] = useState<number>(0);
  const [handoffBanner, setHandoffBanner] = useState<HandoffBannerState | null>(
    null
  );

  const wbCtrlRef = useRef<ReturnType<typeof createWorkbenchController> | null>(
    null
  );
  if (!wbCtrlRef.current) {
    wbCtrlRef.current = createWorkbenchController({
      debounceMs: 18,
      autoSyncRadar: true,
    });
  }
  const wbCtrl = wbCtrlRef.current;
  useEffect(() => {
    return () => wbCtrl.dispose();
  }, [wbCtrl]);
  const betCtrl = wbCtrl.betSlip;
  const wbSnap = useSyncExternalStore(wbCtrl.subscribe, wbCtrl.getState);
  const {
    betSlipState,
    playabilityGates,
    authUser,
    authChecked,
    authNotice,
    syncing,
    syncClock,
    ledger,
    ledgerBusy,
    stopLossPrompt,
  } = wbSnap;
  const { matches, picks, mode, budget, workspace } = betSlipState;
  const effectiveReport = workspace.effectiveReport;
  const { appliedPlan, portfolioPlans } = playabilityGates;

  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const puckRef = useRef<HTMLDivElement>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const slipAmtRef = useRef<HTMLSpanElement>(null);
  const auditCockpitRef = useRef<HTMLDivElement>(null);
  const desktopMatchColRef = useRef<HTMLElement>(null);
  const desktopArchColRef = useRef<HTMLElement>(null);
  const desktopAuditColRef = useRef<HTMLElement>(null);
  const underwaterTileRef = useRef<HTMLDivElement>(null);
  const balValRef = useRef<HTMLSpanElement>(null);

  const notifyToast = (msg: string) => showSpringToast(layerRef.current, msg);
  const openManual = (sec: ManualSectionId = "optimizer") => {
    setManualSection(sec);
    setManualOpen(true);
  };
  const selectArchKey = (nextKey: PortfolioKey) => {
    setArchKey(nextKey);
    wbCtrl.setActivePortfolioKey(nextKey);
  };

  const {
    skin,
    isDesktop,
    cutoffTickNow,
    tactileCfg,
    setTactileCfg,
    switchSkinSmooth,
    actions,
  } = useShellChoreography({
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
    refs: {
      shellRef,
      scrollRef,
      navRef,
      puckRef,
      slipRef,
      slipAmtRef,
      auditCockpitRef,
      desktopMatchColRef,
      desktopArchColRef,
      desktopAuditColRef,
      underwaterTileRef,
      balValRef,
    },
    notifyToast,
  });

  const cutoffStatus = useMemo(
    () => computeSportteryCutoffStatus(cutoffTickNow, matches),
    [cutoffTickNow, matches]
  );
  const radarFiltered = useMemo(() => {
    const activeLeagues = Object.entries(leagueFilter)
      .filter(([, on]) => on)
      .map(([lg]) => lg);
    return filterAndGroupRadarMatches(matches, {
      searchQuery: radarSearchQuery,
      mode,
      qFilter,
      activeLeagues,
    });
  }, [matches, radarSearchQuery, mode, qFilter, leagueFilter]);
  const visibleMatches = radarFiltered.filteredMatches;
  const pickedMatchCount = useMemo(
    () => new Set(picks.map((p) => p.matchId)).size,
    [picks]
  );

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
        <HoneypotTrapLink />
        正在验证加密通行状态...
      </div>
    );
  }

  if (!authUser) {
    return (
      <>
        <HoneypotTrapLink />
        <LoginGate
          initialNotice={authNotice}
          onLoginSuccess={actions.applyAuthenticatedBundle}
        />
      </>
    );
  }

  const handleLogoutUI = () => {
    setAdminOpen(false);
    void wbCtrl.logout();
  };

  const matchCabinNode = (
    <MatchRadarCabin
      mode={mode}
      qFilter={qFilter}
      radarSearchQuery={radarSearchQuery}
      visibleMatches={visibleMatches}
      groups={radarFiltered.groups}
      picks={picks}
      isPicked={(mId, pc, ok) => betCtrl.isPicked(mId, pc, ok)}
      onTogglePick={actions.togglePick}
      onOpenSheet={setSheet}
      onResetFilters={() => {
        setRadarSearchQuery("");
        setQFilter("all");
      }}
    />
  );
  const portfolioCabinNode = (
    <ParetoPortfolioCabin
      wbCtrl={wbCtrl}
      snap={wbSnap}
      archKey={archKey}
      notifyToast={notifyToast}
      onFallbackToMatchTab={() => {
        if (!isDesktop || embedded) setTab("match");
      }}
      onChangeArchKey={selectArchKey}
      onApplyArchetype={actions.applyArchetype}
    />
  );
  const auditCabinNode = (
    <AuditCockpitCabin
      wbCtrl={wbCtrl}
      snap={wbSnap}
      auditCockpitRef={auditCockpitRef}
      underwaterTileRef={underwaterTileRef}
      handoffBanner={handoffBanner}
      notifyToast={notifyToast}
      onGoToArchetypes={() => actions.handleSelectFlowStep(2)}
      onRestoreEqualMultiple={actions.restoreEqualMultiple}
      onOpenManual={openManual}
      onSwitchSyntheticMode={actions.switchSyntheticSingleModeUI}
      onApplyBridgeCandidate={actions.applyBridgeCandidateUI}
      onApplyEquivalentSwap={actions.applyEquivalentSwap}
      onDiagnoseComboFromAudit={() => {
        void actions.triggerXiaoGaoComboLive("picked");
        setMobileCabin("intel");
        if (isDesktop && !embedded) setDkRightTab("intel");
      }}
      onDiagnoseSingleMatch={(m) => void actions.triggerXiaoGaoLive(m)}
      onToggleBankerMatch={actions.toggleBankerMatchUI}
      onOpenPoster={() => setSheet({ type: "poster" })}
      onRecordToLedger={actions.recordToLedger}
    />
  );
  const intelCabinNode = (
    <IntelCabin
      wbCtrl={wbCtrl}
      snap={wbSnap}
      notifyToast={notifyToast}
      onOpenManual={openManual}
      onDiagnoseSingleMatch={(m, note) =>
        void actions.triggerXiaoGaoLive(m, note)
      }
      onDiagnoseCombo={(src, note) =>
        void actions.triggerXiaoGaoComboLive(src, note)
      }
      onOpenAdmin={() => setAdminOpen(true)}
      onLogout={handleLogoutUI}
    />
  );
  const ledgerCabinNode = (
    <LedgerCabin
      wbCtrl={wbCtrl}
      snap={wbSnap}
      balValRef={balValRef}
      notifyToast={notifyToast}
      onOpenAdmin={() => setAdminOpen(true)}
      onLogout={handleLogoutUI}
    />
  );

  const sharedBetBarProps = {
    tab,
    slipRef,
    slipAmtRef,
    wbCtrl,
    snap: wbSnap,
    notifyToast,
    onToggleBankerMatch: actions.toggleBankerMatchUI,
    onRestoreEqualMultiple: actions.restoreEqualMultiple,
    onSwitchSyntheticMode: actions.switchSyntheticSingleModeUI,
    onApplyBridgeCandidate: actions.applyBridgeCandidateUI,
    onOpenPoster: () => setSheet({ type: "poster" }),
    onSwitchTab: setTab,
  };

  const sharedOverlays = (
    <>
      <BottomSheetsLayer
        wbCtrl={wbCtrl}
        snap={wbSnap}
        layerRef={layerRef}
        demoTargetRef={
          (isDesktop && !embedded
            ? auditCockpitRef
            : slipRef) as RefObject<HTMLElement | null>
        }
        demoCockpitRef={
          (isDesktop && !embedded
            ? auditCockpitRef
            : desktopAuditColRef) as RefObject<HTMLElement | null>
        }
        sheet={sheet}
        onCloseSheet={() => setSheet(null)}
        leagueFilter={leagueFilter}
        onToggleLeague={(lg) =>
          setLeagueFilter((prev) => ({ ...prev, [lg]: !prev[lg] }))
        }
        skin={skin}
        onSwitchSkin={(nextSkin) => switchSkinSmooth(nextSkin)}
        onOpenStage={onOpenStage}
        tactileCfg={tactileCfg}
        onUpdateTactileCfg={setTactileCfg}
        poolSwitchVisible={poolSwitchVisible}
        onDismissPoolSwitch={() => setPoolSwitchVisible(false)}
        onTogglePick={actions.togglePick}
        onOpenManual={openManual}
        onApplyEquivalentSwap={actions.applyEquivalentSwap}
        onDiagnoseSingleMatch={(m) => void actions.triggerXiaoGaoLive(m)}
        onRecordToLedger={actions.recordToLedger}
      />
      <StopLossInterceptModal
        stopLossPrompt={stopLossPrompt}
        ledgerBusy={ledgerBusy}
        onConvertPaper={() => {
          const costHint = stopLossPrompt?.draft.paperRefCost ?? 0;
          void wbCtrl
            .confirmConvertStopLossToPaper()
            .then((res) =>
              actions.finalizeLedgerRecord("paper", res, costHint)
            );
        }}
        onForceLive={() => {
          const costHint = stopLossPrompt?.draft.cost ?? 0;
          void wbCtrl
            .confirmForceLiveOverStopLoss()
            .then((res) => actions.finalizeLedgerRecord("live", res, costHint));
        }}
        onDismiss={() => wbCtrl.dismissStopLossPrompt()}
      />
      <UserManualModal
        open={manualOpen}
        initialSection={manualSection}
        onClose={() => setManualOpen(false)}
        onQuotaUpdate={(rem) => wbCtrl.syncRemainingAiQuota(rem)}
        onLoadPresetScenario={actions.loadPresetScenario}
      />
      {authUser.role === "superadmin" && (
        <AdminConsoleModal
          open={adminOpen}
          currentUser={authUser}
          onClose={() => setAdminOpen(false)}
        />
      )}
    </>
  );

  const stepFlowProps = {
    isDesktop,
    tab,
    dkFocusStep,
    pickedMatchCount,
    hasAppliedPlan: Boolean(appliedPlan),
    canCheckoutNonEmpty:
      effectiveReport.matchCount > 0 && effectiveReport.canCheckout,
    onSelectStep: actions.handleSelectFlowStep,
  };

  if (isDesktop && !embedded) {
    return (
      <div className="jz-root">
        <HoneypotTrapLink />
        <div ref={shellRef} className="jz-desktop">
          <DesktopCommandHeader
            visibleMatchCount={visibleMatches.length}
            syncClock={syncClock}
            syncing={syncing}
            isSuperAdmin={authUser.role === "superadmin"}
            stepFlowNode={
              <StepFlowBar compactMobile={false} {...stepFlowProps} />
            }
            onSync={() => void actions.runOfficialSync(true)}
            onOpenTactile={() => setSheet({ type: "tactile" })}
            onOpenManual={() => openManual("sandbox")}
            onOpenAdmin={() => setAdminOpen(true)}
          />

          <div className="dk-workspace">
            <section ref={desktopMatchColRef} className="dk-col">
              <div className="dk-col-head">
                <div className="dk-col-head-row">
                  <span className="dk-col-title">
                    ① 📡 赛事雷达 · 全盘矩阵
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
                  options={RADAR_MODE_OPTS}
                  value={mode}
                  onChange={actions.handleModeChange}
                  skinKey={skin}
                />
                <MatchRadarFilterToolbar
                  qFilter={qFilter}
                  onSelectQuickFilter={setQFilter}
                  radarSearchQuery={radarSearchQuery}
                  onChangeSearchQuery={setRadarSearchQuery}
                  cutoffStatus={cutoffStatus}
                />
              </div>
              <div className="dk-col-scroll">{matchCabinNode}</div>
            </section>

            <section ref={desktopArchColRef} className="dk-col">
              <div className="dk-col-head">
                <div className="dk-col-head-row">
                  <span className="dk-col-title">
                    ② 🎯 3+1 精算配单
                    <span className="small num" style={{ fontWeight: 400 }}>
                      五池闭合校准 · 3+1 帕累托精算配单
                    </span>
                  </span>
                  <button
                    type="button"
                    className="help-pill"
                    onClick={() => openManual("archetypes")}
                  >
                    ? 说明
                  </button>
                </div>
                <PortfolioBudgetHeader
                  budget={budget}
                  archKey={archKey}
                  portfolioPlans={portfolioPlans}
                  skin={skin}
                  onChangeBudget={(b) => betCtrl.setBudget(b)}
                  onConfirmCustomBudget={(norm) =>
                    notifyToast(
                      `已按 ¥2 彩票整注对齐预算：¥${norm}（${norm / 2} 注）`
                    )
                  }
                  onChangeArchKey={selectArchKey}
                />
              </div>
              <div className="dk-col-scroll">{portfolioCabinNode}</div>
            </section>

            <section ref={desktopAuditColRef} className="dk-col dk-col-right">
              <div className="dk-col-head">
                <div className="dk-col-head-row" style={{ marginBottom: 0 }}>
                  <SpringSegmented
                    options={DESKTOP_RIGHT_CABIN_TABS}
                    value={dkRightTab}
                    onChange={setDkRightTab}
                    skinKey={skin}
                  />
                  <div style={{ display: "flex", gap: 5 }}>
                    {dkRightTab === "audit" &&
                      (picks.length > 0 ||
                        betSlipState.activeAuditedSlip.isAppliedPlan) && (
                        <button
                          type="button"
                          className="key mini"
                          onClick={() =>
                            picks.length > 0
                              ? betCtrl.clearPicks()
                              : actions.restoreEqualMultiple()
                          }
                        >
                          {picks.length > 0
                            ? "清空"
                            : betSlipState.activeAuditedSlip.revertActionLabel}
                        </button>
                      )}
                    <button
                      type="button"
                      className="help-pill"
                      onClick={() =>
                        openManual(dkRightTab === "audit" ? "hedge" : "xiaogao")
                      }
                    >
                      ? 图解
                    </button>
                  </div>
                </div>
              </div>
              <div className="dk-col-scroll">
                {dkRightTab === "audit"
                  ? auditCabinNode
                  : dkRightTab === "intel"
                    ? intelCabinNode
                    : ledgerCabinNode}
              </div>
            </section>
          </div>

          <PersistentBetBar variant="desktop" {...sharedBetBarProps} />
          {sharedOverlays}
        </div>
      </div>
    );
  }

  const hideMobileBetBar = tab === "archetypes" || tab === "ledger";
  return (
    <div className={`jz-root ${embedded ? "embed" : ""}`}>
      <HoneypotTrapLink />
      <div ref={shellRef} className="shell">
        {embedded && (
          <div className="sbar num">
            <span>21:06</span>
            <div className="sbar-i">
              <span style={{ fontSize: 10.5, opacity: 0.72, marginRight: 4 }}>
                距22:00停售 54m
              </span>
            </div>
          </div>
        )}
        <div className="top">
          <MobileCompactTopBar
            tab={tab}
            visibleMatchCount={visibleMatches.length}
            syncClock={syncClock}
            syncing={syncing}
            isSuperAdmin={authUser.role === "superadmin"}
            onOpenTactile={() => setSheet({ type: "tactile" })}
            onOpenManual={openManual}
            onOpenAdmin={() => setAdminOpen(true)}
            onSync={() => void actions.runOfficialSync(true)}
            onOpenFilter={() => setSheet({ type: "filter" })}
          />
          {tab !== "ledger" && <StepFlowBar compactMobile {...stepFlowProps} />}
          {tab === "match" && (
            <>
              <SpringSegmented
                options={RADAR_MODE_OPTS}
                value={mode}
                onChange={actions.handleModeChange}
                skinKey={skin}
              />
              <MatchRadarFilterToolbar
                qFilter={qFilter}
                onSelectQuickFilter={setQFilter}
                radarSearchQuery={radarSearchQuery}
                onChangeSearchQuery={setRadarSearchQuery}
                cutoffStatus={cutoffStatus}
              />
            </>
          )}
          {tab === "archetypes" && (
            <PortfolioBudgetHeader
              budget={budget}
              archKey={archKey}
              portfolioPlans={portfolioPlans}
              skin={skin}
              onChangeBudget={(b) => betCtrl.setBudget(b)}
              onConfirmCustomBudget={(norm) =>
                notifyToast(
                  `已按 ¥2 彩票整注对齐预算：¥${norm}（${norm / 2} 注）`
                )
              }
              onChangeArchKey={selectArchKey}
            />
          )}
          {tab === "ledger" && (
            <SpringSegmented
              options={buildMobileTab4CabinOptions(
                ledger.entries.length,
                matches.length
              )}
              value={mobileCabin}
              onChange={setMobileCabin}
              skinKey={skin}
            />
          )}
        </div>

        <div
          ref={scrollRef}
          className={`scroll ${hideMobileBetBar ? "no-betbar-pad" : ""}`}
        >
          {tab === "match" && matchCabinNode}
          {tab === "archetypes" && portfolioCabinNode}
          {tab === "audit" && auditCabinNode}
          {tab === "ledger" &&
            (mobileCabin === "intel" ? intelCabinNode : ledgerCabinNode)}
        </div>

        <PersistentBetBar variant="mobile" {...sharedBetBarProps} />
        <MobileBottomDock
          navRef={navRef}
          puckRef={puckRef}
          tab={tab}
          hasAuditDot={workspace.allWarnings.length > 0}
          embedded={embedded}
          onSelectTab={(nextTab) => {
            setSheet(null);
            setTab(nextTab);
          }}
        />
        {sharedOverlays}
      </div>
    </div>
  );
}
