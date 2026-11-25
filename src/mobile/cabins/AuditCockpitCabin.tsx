import { useEffect, useMemo, useState, type RefObject } from "react";
import type { ManualSectionId } from "../../manual/UserManualModal.tsx";
import type {
  BonusOptMode,
  BridgeMatchCandidate,
  EquivalentArbItem,
  MatchItem,
  SyntheticSingleMode,
} from "../../prototype/quantTypes.ts";
import { haptic } from "../../spring/engine.ts";
import {
  burstCelebrationSparks,
  playTactileCue,
  triggerShimmerSweep,
} from "../../spring/tactileSymphony.ts";
import {
  PayoutEqualizerBars,
  SpringCollapseDrawer,
  SpringSwitch,
  TactileFlipCard,
  TeamCrest,
} from "../../spring/widgets.tsx";
import { type ComboSortMode } from "../../workspace/betSlipController.ts";
import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import { BridgeCandidatesCard, renderTrendArrow } from "./MatchRadarCabin.tsx";
import { SyntheticModePills } from "./PersistentBetBar.tsx";
import {
  SUBJECTIVE_SLIDER_BOUNDS,
  buildAuditCockpitTiles,
  buildAuditScenarioRows,
  buildAuditThreeLayerViewModel,
  buildMatchSingleSubPoolEntryPills,
  buildPendingSingleCrossPoolCards,
  dedupePlanTitle,
  formatHedgeDrawerCopy,
  resolveAuditCabinLifecycleState,
  type HandoffBannerState,
} from "./cabinViewModels.ts";

export function AuditCockpitCabin({
  wbCtrl,
  snap,
  auditCockpitRef,
  underwaterTileRef,
  handoffBanner,
  notifyToast,
  onGoToArchetypes,
  onRestoreEqualMultiple,
  onOpenManual,
  onOpenMorePool,
  onSwitchSyntheticMode,
  onApplyBridgeCandidate,
  onApplyEquivalentSwap,
  onDiagnoseComboFromAudit,
  onDiagnoseSingleMatch,
  onToggleBankerMatch,
  onOpenPoster,
  onRecordToLedger,
}: {
  wbCtrl: WorkbenchController;
  snap: WorkbenchSnapshot;
  auditCockpitRef: RefObject<HTMLDivElement | null>;
  underwaterTileRef: RefObject<HTMLDivElement | null>;
  handoffBanner: HandoffBannerState | null;
  notifyToast: (msg: string) => void;
  onGoToArchetypes: () => void;
  onRestoreEqualMultiple: () => void;
  onOpenManual: (sec: ManualSectionId) => void;
  onOpenMorePool?: (matchId: string) => void;
  onSwitchSyntheticMode: (next: SyntheticSingleMode) => void;
  onApplyBridgeCandidate: (
    cand: BridgeMatchCandidate,
    triggerEl?: HTMLElement | null
  ) => void;
  onApplyEquivalentSwap: (
    arb: EquivalentArbItem,
    triggerEl?: HTMLElement | null
  ) => void;
  onDiagnoseComboFromAudit: () => void;
  onDiagnoseSingleMatch: (match: MatchItem) => void;
  onToggleBankerMatch: (
    matchId: string,
    homeName: string,
    triggerEl?: HTMLElement | null
  ) => void;
  onOpenPoster: () => void;
  onRecordToLedger: (kind: "live" | "paper") => void;
}) {
  const [cockpitFlipBack, setCockpitFlipBack] = useState(false);
  const [userComboSort, setUserComboSort] = useState<ComboSortMode | null>(
    null
  );
  const [hitBucketFilter, setHitBucketFilter] = useState<string>("all");
  const [expandedComboIds, setExpandedComboIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedCrossPoolKey, setExpandedCrossPoolKey] = useState<
    string | null
  >(null);
  const [simHedgeHit, setSimHedgeHit] = useState(true);
  const [convertPreviewOpen, setConvertPreviewOpen] = useState(false);
  const [pendingComboUnbundleMode, setPendingComboUnbundleMode] =
    useState<BonusOptMode | null>(null);

  const betCtrl = wbCtrl.betSlip;
  const {
    matches,
    manualDraft,
    multiple,
    planSpec,
    activeAuditedSlip,
    livePortfolioQuote,
    sandboxSim,
    syntheticSingleMode,
    subjectiveDeltaPct,
    simVoidFirstMatch,
    draftRestoredNotice,
    workspace,
  } = snap.betSlipState;
  const {
    diagnosingMatchId,
    diagnosingCombo,
    comboReport,
    playabilityGates,
    ledgerBusy,
  } = snap;

  // Unpolluted real-slip baseline report for Layer 1/2/3 & Checkout; sandbox uses workspace.effectiveReport ONLY inside sandbox!
  const baseEffectiveReport =
    workspace.baselineReport ?? workspace.effectiveReport;
  const sandboxReport = workspace.effectiveReport;
  const manualReport = workspace.baselineManualReport ?? workspace.manualReport;
  const { shopkeeperBlockReason } = playabilityGates;
  const posterButtonLabel = shopkeeperBlockReason
    ? "🧪 查看模拟单"
    : "🧾 防错打票单";
  const insights = workspace.insights;
  const allWarnings = workspace.allWarnings;
  const subjectiveEVPct = workspace.subjectiveEVPct;
  const hasPlanSpec = Boolean(planSpec);
  const budgetMismatchMeta = activeAuditedSlip.budgetMismatchMeta;

  useEffect(() => {
    setHitBucketFilter("all");
  }, [activeAuditedSlip.revision]);

  const lifecycle = useMemo(
    () =>
      resolveAuditCabinLifecycleState(
        manualDraft,
        baseEffectiveReport,
        activeAuditedSlip
      ),
    [manualDraft, baseEffectiveReport, activeAuditedSlip]
  );

  const convertManualPreview = useMemo(
    () =>
      convertPreviewOpen && activeAuditedSlip.isAppliedPlan
        ? betCtrl.previewConvertAppliedPlanToManual()
        : null,
    [convertPreviewOpen, activeAuditedSlip, betCtrl]
  );

  const {
    appliedPlan,
    effectiveAppliedPlan,
    isBonusOver512,
    isBonusOptDisabled,
    breakevenTargetCost,
    isSyntheticPlayable,
    canTrimSynthetic2Way,
    hasSyntheticInherentBlindSpot,
    showBridgeFinder,
    canToggleBanker,
    activeBankerSet,
  } = playabilityGates;

  // Default ALWAYS to prob-first so top scenarios are realistic outcomes instead of micro-crumbs
  const comboSortMode: ComboSortMode = userComboSort ?? "prob-first";

  const threeLayer = useMemo(
    () =>
      buildAuditThreeLayerViewModel(
        baseEffectiveReport,
        activeAuditedSlip,
        effectiveAppliedPlan,
        multiple,
        comboSortMode
      ),
    [
      baseEffectiveReport,
      activeAuditedSlip,
      effectiveAppliedPlan,
      multiple,
      comboSortMode,
    ]
  );

  const equalizerBars = useMemo(
    () =>
      buildAuditScenarioRows(baseEffectiveReport, "prob-first", {
        matchCount: baseEffectiveReport.matchCount,
        defaultMultiple: multiple,
        appliedLines: effectiveAppliedPlan?.lines,
      }).map((r) => ({
        id: r.id,
        label: r.isZeroWipeoutRow ? "全部未中" : r.desc,
        totalPayout: r.totalPayout,
        prob: r.prob,
      })),
    [baseEffectiveReport, multiple, effectiveAppliedPlan?.lines]
  );

  const safeSwapPreview = useMemo(
    () =>
      insights.activeSwapTip
        ? betCtrl.previewEquivalentSwap(insights.activeSwapTip)
        : null,
    [insights.activeSwapTip, betCtrl, manualDraft.picks, multiple]
  );

  const onExcludeMatchAndRequote = (mid: string, toastMsg?: string) => {
    const res = betCtrl.excludeMatchAndRequote(mid);
    if (!res.ok) {
      haptic(12);
      notifyToast(res.reason || "至少保留 1 场候选赛事用于重配");
      return;
    }
    haptic(6);
    notifyToast(toastMsg || "已排除此场并重新配单（雷达手选草稿未受改动）");
  };

  const onRequoteAtCurrentBudget = () => {
    haptic(7);
    if (betCtrl.requoteAppliedPlanAtCurrentBudget()) {
      playTactileCue("optimize-arpeggio");
      notifyToast(
        `已按当前新参数（预算 ¥${snap.betSlipState.budget}）重新配单并同步审单台`
      );
    } else {
      notifyToast(
        `当前预算 ¥${snap.betSlipState.budget} 下原档方案未过准入红线，已退回待选方案态`
      );
    }
  };

  const onConfirmConvertPlanToManual = () => {
    const res = betCtrl.convertAppliedPlanToManual();
    setConvertPreviewOpen(false);
    if (!res.ok) {
      haptic(12);
      notifyToast(res.reason || "当前方案暂无法转为手动复式");
      return;
    }
    haptic(8);
    playTactileCue("optimize-arpeggio");
    notifyToast(
      `已显式转为手动复式（${res.preview.previewPassLabel} · 新总额 ¥${res.preview.previewTotalCost}）`
    );
  };

  const onApplyBonusOptimization = (
    optMode: BonusOptMode,
    triggerEl?: HTMLElement | null,
    allowUnbundleCombo = false
  ): boolean => {
    const res = betCtrl.applyBonusOptimization(optMode, {
      requireComboConfirm: true,
      allowUnbundleCombo,
    });
    if (res.requiresComboUnbundleConfirm && !allowUnbundleCombo) {
      setPendingComboUnbundleMode(optMode);
      haptic(8);
      return false;
    }
    setPendingComboUnbundleMode(null);
    if (res.awaitingSyntheticQuote) {
      haptic(6);
      notifyToast("正在核对分倍结果。票行或金额有变化时，请确认新报价。");
      return false;
    }
    if (!res.ok) {
      if (res.blockedReason) {
        haptic(12);
        notifyToast(res.blockedReason);
      }
      return false;
    }
    if (res.unchanged || res.noOpReason) {
      haptic(8);
      notifyToast(
        res.noOpReason ||
          "当前每票均为 1 倍无机动余量，需增加预算或倍数后方可重分配"
      );
      return false;
    }
    playTactileCue("optimize-arpeggio");
    triggerShimmerSweep(auditCockpitRef.current);
    burstCelebrationSparks(triggerEl ?? auditCockpitRef.current, 22);
    notifyToast(`已启用 · ${res.modeTitle}`);
    return true;
  };

  const onUpgradeBonusToBreakeven = (triggerEl?: HTMLElement | null) => {
    const res = betCtrl.upgradeBonusToBreakeven();
    if (!res.ok) {
      if (res.reason) {
        haptic(12);
        notifyToast(res.reason);
      }
      return false;
    }
    playTactileCue("defuse-celebrate");
    triggerShimmerSweep(auditCockpitRef.current);
    burstCelebrationSparks(triggerEl ?? auditCockpitRef.current, 24);
    notifyToast(
      `⚡ 已授权升至最低保本门槛 ¥${res.upgradedCost}（100% 零假中奖）`
    );
    return true;
  };

  const onUpgradeToZeroUnderwater = (triggerEl?: HTMLElement | null) => {
    const targetCost = playabilityGates.breakevenTargetCost;
    if (
      typeof targetCost === "number" &&
      targetCost > baseEffectiveReport.totalCost
    ) {
      onUpgradeBonusToBreakeven(triggerEl);
    } else if (onApplyBonusOptimization("equal", triggerEl)) {
      playTactileCue("defuse-celebrate");
    }
  };

  const onRemoveMatchFromSlip = (mid: string, toastMsg?: string) => {
    betCtrl.removeMatchFromSlip(mid);
    if (toastMsg) notifyToast(toastMsg);
  };

  const draftNoticeBanner = draftRestoredNotice ? (
    <div
      className="card enter num"
      style={{
        borderLeft: "3px solid var(--warn)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span className="small" style={{ margin: 0 }}>
        🔄 {draftRestoredNotice}
      </span>
      <button
        type="button"
        className="key mini"
        onClick={() => betCtrl.dismissDraftRestoredNotice()}
      >
        知道了
      </button>
    </div>
  ) : null;

  // 1) EMPTY LIFECYCLE
  if (lifecycle.selectionStatus === "empty") {
    return (
      <>
        {draftNoticeBanner}
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
            onClick={onGoToArchetypes}
          >
            去 3+1 精算配单
          </button>
        </div>
      </>
    );
  }

  const bridgeCandidates = insights.bridgeCandidates ?? [];

  // 2) PENDING-SINGLE-AUTH LIFECYCLE (Zero KPI tiles, disabled checkout & ledger, 3 clear paths)
  if (lifecycle.selectionStatus === "pending-single-auth") {
    const crossPoolCards = buildPendingSingleCrossPoolCards(
      manualReport,
      baseEffectiveReport
    );
    const pickedMatchEntry = activeAuditedSlip.matches[0];
    const pickedFullMatch = pickedMatchEntry
      ? matches.find((m) => m.id === pickedMatchEntry.matchId)
      : undefined;
    const singlePoolEntryPills = pickedFullMatch
      ? buildMatchSingleSubPoolEntryPills(pickedFullMatch)
      : [];
    const serverSingleAlts =
      baseEffectiveReport.singlePoolAlternatives ??
      manualReport.singlePoolAlternatives ??
      [];
    const trimLegCount =
      playabilityGates.partialCoveragePreview?.trim2WayLegCount ?? 2;

    return (
      <>
        {draftNoticeBanner}
        <div
          ref={auditCockpitRef}
          className="card enter num"
          style={{
            border: "1px solid var(--warn, #d97706)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div className="co-head" style={{ marginBottom: 0 }}>
            <div>
              <b style={{ fontSize: 13.5, color: "var(--warn, #d97706)" }}>
                ⚠️ 未开单关 · 请选择出票方式（当前应付 ¥0）
              </b>
              <div className="small" style={{ marginTop: 2 }}>
                {lifecycle.ruleBlockReason ||
                  "所选玩法官方仅限串关，尚未形成可出票订单；请从下方 3 条路径确认出票方式："}
              </div>
            </div>
            {pickedMatchEntry && (
              <button
                type="button"
                className="key mini"
                onClick={() => onRemoveMatchFromSlip(pickedMatchEntry.matchId)}
              >
                清空重选
              </button>
            )}
          </div>

          {pickedMatchEntry && (
            <div className="note-box" style={{ margin: 0 }}>
              <strong>
                当前已选：{pickedMatchEntry.matchNumStr} {pickedMatchEntry.home}{" "}
                vs {pickedMatchEntry.away}
              </strong>
              <div className="chips" style={{ marginTop: 4 }}>
                {pickedMatchEntry.pools.flatMap((pg) =>
                  pg.legs.map((lg) => (
                    <span
                      key={`${lg.poolCode}-${lg.optionKey}`}
                      className="chip num"
                    >
                      {pg.poolName}·{lg.optionLabel}
                      <i>@{lg.odds.toFixed(2)}</i>
                    </span>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Path 1: Bridge 2x1 */}
          <div className="note-box" style={{ margin: 0 }}>
            <strong>路径 ① 串 1 场过桥凑合法 2串1（保留原低抽水主盘）</strong>
            <div style={{ marginTop: 6 }}>
              {bridgeCandidates.length > 0 ? (
                <BridgeCandidatesCard
                  showBridgeFinder
                  bridgeCandidates={bridgeCandidates}
                  compact
                  unstyledInner
                  previewBridgeCandidate={(c) =>
                    betCtrl.previewBridgeCandidate(c)
                  }
                  onApplyBridgeCandidate={onApplyBridgeCandidate}
                />
              ) : (
                <div className="small">
                  可返回赛事雷达再点选任意 1 场赛事，即可合成为标准 2串1 出票。
                </div>
              )}
            </div>
          </div>

          {/* Path 2: Cross-pool independent single replacement */}
          {(crossPoolCards.length > 0 || isSyntheticPlayable) && (
            <div
              className="note-box"
              style={{
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 7,
              }}
            >
              <strong>
                路径 ② 跨池独立单关替代（无需搭场，直接买本场单关）
              </strong>
              {crossPoolCards.map((card) => {
                const isExp = expandedCrossPoolKey === card.key;
                return (
                  <div
                    key={card.key}
                    style={{
                      padding: "7px 8px",
                      borderRadius: 8,
                      border: "0.5px solid var(--line)",
                      background: "var(--surface)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 5,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          flexWrap: "wrap",
                        }}
                      >
                        <b>{card.poolTitle}</b>
                        <span className="qpill num">{card.legCountBadge}</span>
                        <span
                          className={`qpill num ${card.isExactEquivalent ? "hi" : "warn"}`}
                        >
                          {card.coverageBadge}
                        </span>
                      </div>
                      <b className="num">应付 ¥{card.costYuan}</b>
                    </div>
                    <div className="small num" style={{ margin: 0 }}>
                      {card.payoutRangeText}
                      {card.preview.blindSpotLabel
                        ? ` · 死角提示：${card.preview.blindSpotLabel}`
                        : ""}
                    </div>
                    {Array.isArray(card.preview.previewLines) &&
                      card.preview.previewLines.length > 0 && (
                        <>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                setExpandedCrossPoolKey(isExp ? null : card.key)
                              }
                            >
                              {isExp
                                ? "▴ 收起配平明细"
                                : `▾ 查看 ${card.legCountBadge} 分倍明细`}
                            </button>
                            <button
                              type="button"
                              data-spring="0.88"
                              className="key mini dark num"
                              onClick={() => {
                                const res =
                                  betCtrl.confirmPartialCoverageSingle(
                                    card.preview
                                  );
                                if (res.ok) {
                                  haptic(8);
                                  playTactileCue("tap-on");
                                  notifyToast(
                                    `请核对待确认票行【${card.poolTitle} · ${card.legCountBadge}】（¥${card.costYuan}）`
                                  );
                                } else {
                                  haptic(12);
                                  notifyToast(
                                    "当前盘口或选单已变更，请重新核对单关报价"
                                  );
                                }
                              }}
                            >
                              核对 {card.legCountBadge} 票行（¥{card.costYuan}）
                            </button>
                          </div>
                          {isExp && (
                            <div className="combo-tickets-box num">
                              {card.preview.previewLines.map((ln, idx) => (
                                <div
                                  key={`${card.key}-ln-${idx}`}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 6,
                                  }}
                                >
                                  <span>
                                    #{idx + 1}{" "}
                                    {ln.legs.length > 0
                                      ? ln.legs
                                          .map(
                                            (g) =>
                                              `${g.poolName}·${g.optionLabel}@${g.odds.toFixed(2)}`
                                          )
                                          .join(" × ")
                                      : ln.roleLabel}{" "}
                                    × {ln.multiple}倍（¥{ln.cost}）
                                  </span>
                                  <b>中返 ¥{ln.returnPayout.toFixed(2)}</b>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                  </div>
                );
              })}

              {isSyntheticPlayable && crossPoolCards.length === 0 && (
                <SyntheticModePills
                  mode={syntheticSingleMode}
                  canTrim2Way={canTrimSynthetic2Way}
                  hasInherentBlindSpot={hasSyntheticInherentBlindSpot}
                  partialPreview={playabilityGates.partialCoveragePreview}
                  trimLegCount={trimLegCount}
                  containerClassName="syn-mode-pills num"
                  onSelect={onSwitchSyntheticMode}
                />
              )}
            </div>
          )}

          {/* Path 3: Direct switch to open single sub-pool on this match */}
          {(serverSingleAlts.length > 0 || singlePoolEntryPills.length > 0) &&
            pickedMatchEntry && (
              <div className="note-box" style={{ margin: 0 }}>
                <strong>路径 ③ 改选本场已开放单关的官方子玩法</strong>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginTop: 6,
                  }}
                >
                  {serverSingleAlts.length > 0
                    ? serverSingleAlts.map((alt) => (
                        <button
                          key={alt.poolCode}
                          type="button"
                          data-spring="0.88"
                          className="key mini dark num"
                          onClick={() =>
                            onOpenMorePool?.(pickedMatchEntry.matchId)
                          }
                        >
                          改选{alt.poolName}单关 (@{alt.minOdds.toFixed(2)}起) ›
                        </button>
                      ))
                    : singlePoolEntryPills.map((sp) => (
                        <button
                          key={sp.poolCode}
                          type="button"
                          data-spring="0.88"
                          className="key mini dark num"
                          onClick={() =>
                            onOpenMorePool?.(pickedMatchEntry.matchId)
                          }
                        >
                          改选{sp.label} ({sp.minOddsText}) ›
                        </button>
                      ))}
                </div>
              </div>
            )}
        </div>

        <div className="card enter" style={{ padding: "12px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <div className="num big">¥0</div>
              <div className="num small">
                待确认出票路径后解锁打票核对与账本封存
              </div>
            </div>
            <button
              type="button"
              className="key dark wide2"
              disabled
              style={{ opacity: 0.45 }}
            >
              {posterButtonLabel}
            </button>
          </div>
          <div className="two">
            <button
              type="button"
              className="key"
              disabled
              style={{ opacity: 0.45 }}
            >
              存 0 成本模拟单
            </button>
            <button
              type="button"
              className="key dark"
              disabled
              style={{ opacity: 0.45 }}
            >
              记入实买真金账本
            </button>
          </div>
        </div>
      </>
    );
  }

  // 3) UNCOMPUTED-OVER-CAP (>2,048 expanded lines — takes priority so >2,048 diagnostic & true estimated cost are ALWAYS reachable!)
  if (lifecycle.distributionStatus === "uncomputed-over-cap") {
    const basicCount =
      baseEffectiveReport.basicExpandedCount ??
      baseEffectiveReport.logicalLineCount ??
      baseEffectiveReport.betCount;
    const estimatedCost =
      baseEffectiveReport.totalCost > 0
        ? baseEffectiveReport.totalCost
        : (baseEffectiveReport.estimatedOverCapCost ??
          basicCount * 2 * Math.max(1, multiple));
    const estStakeUnits = Math.max(basicCount, Math.round(estimatedCost / 2));
    const canPrint =
      baseEffectiveReport.canCheckout &&
      !playabilityGates.passRuleBlockReason &&
      estimatedCost <= 20000;
    const maxParlayK = Math.max(
      1,
      Math.min(
        8,
        manualReport.poolCap || 8,
        activeAuditedSlip.matchCount || manualReport.matchCount || 2
      )
    );
    const alreadyAtMaxParlay =
      manualReport.activePassSizes.length === 1 &&
      manualReport.activePassSizes[0] === maxParlayK &&
      !manualReport.activeComboCode;
    const perMatchOptionCounts = activeAuditedSlip.matches.map((m) =>
      Math.max(1, m.legs.length)
    );
    const maxParlayBasicCount = (() => {
      const n = perMatchOptionCounts.length;
      const k = Math.min(n, maxParlayK);
      if (n === 0 || k <= 0) return basicCount;
      const dp = new Float64Array(k + 1);
      dp[0] = 1;
      for (const c of perMatchOptionCounts) {
        for (let s = k; s >= 1; s--) {
          dp[s] += dp[s - 1] * c;
        }
      }
      return Math.round(dp[k]);
    })();
    const canReduceViaMaxParlay =
      !alreadyAtMaxParlay &&
      maxParlayBasicCount <= 2048 &&
      maxParlayBasicCount < basicCount;

    return (
      <>
        {draftNoticeBanner}
        <div
          ref={auditCockpitRef}
          className="card enter num"
          style={{
            border: "1px solid var(--warn, #d97706)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div className="co-head" style={{ marginBottom: 0 }}>
            <span className="qpill hi">{threeLayer.layer1.sourceBadge}</span>
            <span className="qpill warn">超 2,048 种基本组合枚举上限</span>
          </div>
          <b style={{ fontSize: 13.5, lineHeight: 1.45, display: "block" }}>
            🧾 ① 组合规模诊断：{basicCount.toLocaleString("en-US")} 种基本组合 ·
            预估应付 ¥{estimatedCost.toLocaleString("en-US")}
          </b>
          <div className="note-box alert" style={{ margin: 0 }}>
            <strong>
              ⚠️ 超出 2,048 种基本组合精确枚举上限（已屏蔽未计算的零概率占位）：
            </strong>
            <div style={{ marginTop: 3 }}>
              当前选单展开达 <strong>{basicCount} 种基本组合</strong>（
              {multiple}倍 · 预估应付 <strong>¥{estimatedCost}</strong>）
              {lifecycle.ruleBlockReason
                ? `；${lifecycle.ruleBlockReason}`
                : "，超出服务端 2,048 注精确商空间卷积阈值。"}
            </div>
            <div style={{ marginTop: 4 }}>
              {canReduceViaMaxParlay
                ? `💡 切换至【${maxParlayK === 1 ? "单关" : `${maxParlayK}串1`}】可将基本组合从 ${basicCount} 种压降至 ${maxParlayBasicCount} 种，立即恢复精确四桶盈亏分布。`
                : `💡 当前已处于【${manualReport.modeLabel}】仍达 ${basicCount} 种基本组合，切换串关无法降至 2,048 种以内；请删减总进球/比分/半全场等多分支包号选项。`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {canReduceViaMaxParlay && (
              <button
                type="button"
                data-spring="0.88"
                className="key sm dark num"
                onClick={() => {
                  betCtrl.resetPassAuto();
                  haptic(6);
                  notifyToast(
                    `已切换至最高串关（降至 ${maxParlayBasicCount} 种基本组合）`
                  );
                }}
              >
                一键切换最高串关（降至 {maxParlayBasicCount} 种）
              </button>
            )}
            <button
              type="button"
              className="key sm"
              onClick={() => betCtrl.clearPicks()}
            >
              清空重选
            </button>
          </div>
        </div>

        <div className="card enter" style={{ padding: "12px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <div className="num big">
                {canPrint ? `¥${estimatedCost}` : `预估 ¥${estimatedCost}`}
              </div>
              <div className="num small">
                {basicCount} 种基本组合 · 预估共 {estStakeUnits} 份2元注
                {canPrint
                  ? ` · 预计终端纸票 ${threeLayer.layer1.physicalSlipCount} 张`
                  : " · 请删减高分支选项至 ≤ 2,048 种解锁出票"}
              </div>
            </div>
            <button
              type="button"
              className="key dark wide2"
              disabled={!canPrint}
              style={{ opacity: canPrint ? 1 : 0.45 }}
              onClick={onOpenPoster}
            >
              {posterButtonLabel}
            </button>
          </div>
          <div className="two">
            <button
              type="button"
              className="key"
              disabled={!canPrint || ledgerBusy}
              style={{ opacity: canPrint && !ledgerBusy ? 1 : 0.45 }}
              onClick={() => onRecordToLedger("paper")}
            >
              存 0 成本模拟单
            </button>
            <button
              type="button"
              className="key dark"
              disabled={
                !canPrint || ledgerBusy || Boolean(shopkeeperBlockReason)
              }
              title={shopkeeperBlockReason ?? undefined}
              onClick={() => onRecordToLedger("live")}
            >
              记入实买真金账本
            </button>
          </div>
        </div>
      </>
    );
  }

  // 4) RULE-BLOCKED LIFECYCLE (Incompatible comboCode, orphaned banker, pool cap conflict, cross-pool parlay block)
  if (lifecycle.selectionStatus === "rule-blocked") {
    const syntheticChoice = snap.betSlipState.pendingSyntheticChoice;
    const syntheticQuote = syntheticChoice?.quote;
    const maxParlayK = Math.max(
      1,
      Math.min(
        8,
        manualReport.poolCap || 8,
        activeAuditedSlip.matchCount || manualReport.matchCount || 2
      )
    );
    const hasOrphanedBanker =
      Array.isArray(snap.betSlipState.passSpec.bankerMatchIds) &&
      snap.betSlipState.passSpec.bankerMatchIds.some(
        (id) => !snap.betSlipState.picks.some((p) => p.matchId === id)
      );
    return (
      <>
        {draftNoticeBanner}
        <div
          ref={auditCockpitRef}
          data-synthetic-review={syntheticChoice ? true : undefined}
          className="card enter num"
          style={{
            border: "1px solid var(--live)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <b style={{ fontSize: 13.5, color: "var(--live)" }}>
            {syntheticChoice
              ? syntheticQuote?.referenceOnly
                ? "合成模拟待确认 · 实际支出 ¥0"
                : "合成单关待确认 · 当前应付 ¥0"
              : snap.betSlipState.pendingRevokedPlanConfirm
                ? "⚠️ 原已锁方案盘口已变更 · 待确认核对目标"
                : "🚫 当前过关或胆拖组合受官方规则拦截"}
          </b>
          <div className="note-box alert" style={{ margin: 0 }}>
            {syntheticChoice
              ? livePortfolioQuote.isStale
                ? "正在核对单场报价。"
                : syntheticQuote
                  ? syntheticQuote.referenceOnly
                    ? "按下列参考价模拟。恢复官方售权后，须再次核对票行和金额才能出票。"
                    : "当前玩法未开单关。确认下列替代票后，所列金额将计入应付。"
                  : "暂无可确认的合成报价，可保留原方向搭配另一场。"
              : lifecycle.ruleBlockReason ||
                "当前选单不满足体彩过关规则，请调整过关方式或移除冲突场次。"}
          </div>
          {syntheticQuote && (
            <div aria-label="待确认合成票明细" className="num">
              <div>
                <b>
                  {syntheticQuote.rows[0]?.matchNumStr}{" "}
                  {syntheticQuote.rows[0]?.home} vs{" "}
                  {syntheticQuote.rows[0]?.away}
                </b>
                <div className="small">
                  原选{" "}
                  {snap.betSlipState.picks
                    .map((pick) =>
                      [pick.poolName, pick.goalLine, pick.optionLabel]
                        .filter(Boolean)
                        .join(" ")
                    )
                    .join("、")}
                </div>
              </div>
              <p>{syntheticQuote.coverageLabel}</p>
              <table
                style={{ width: "100%", textAlign: "left" }}
                aria-label="合成单关逐行报价"
              >
                <thead>
                  <tr>
                    <th>单关选项</th>
                    <th>赔率</th>
                    <th>倍数</th>
                    <th>金额</th>
                  </tr>
                </thead>
                <tbody>
                  {syntheticQuote.rows.map((row) => (
                    <tr key={row.matchId + row.poolName + row.optionLabel}>
                      <td>
                        {row.poolName} · {row.optionLabel}
                      </td>
                      <td>{row.odds.toFixed(2)}</td>
                      <td>{row.multiple}倍</td>
                      <td>¥{row.cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <b>
                {syntheticQuote.referenceOnly ? "模拟参考金额" : "确认后应付"} ¥
                {syntheticQuote.cost}
              </b>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {syntheticChoice ? (
              <>
                {syntheticQuote && (
                  <button
                    type="button"
                    className="key sm dark num"
                    disabled={livePortfolioQuote.isStale}
                    onClick={() => {
                      if (
                        betCtrl.confirmSyntheticChoiceQuote(
                          syntheticQuote.signature
                        )
                      ) {
                        haptic(6);
                        notifyToast(
                          `${syntheticQuote.referenceOnly ? "已确认模拟" : "已确认"}${syntheticQuote.label} · ¥${syntheticQuote.cost}`
                        );
                      } else {
                        notifyToast("盘口已变化，请核对最新报价");
                      }
                    }}
                  >
                    {syntheticQuote.referenceOnly ? "确认模拟" : "确认"}
                    {syntheticQuote.label} · ¥{syntheticQuote.cost}
                  </button>
                )}
                <button
                  type="button"
                  className="key sm"
                  onClick={() => {
                    betCtrl.setSyntheticSingleMode("off");
                    haptic(6);
                    notifyToast("已保留原方向，可加选另一场组成 2串1");
                  }}
                >
                  保留原方向 · 等待搭配另一场
                </button>
              </>
            ) : snap.betSlipState.pendingRevokedPlanConfirm ? (
              <button
                type="button"
                data-spring="0.88"
                className="key sm dark num"
                onClick={() => {
                  betCtrl.revertToManualDraft();
                  haptic(6);
                  notifyToast("已确认改按当前手选草稿核对");
                }}
              >
                确认改按当前手选草稿核对
              </button>
            ) : hasOrphanedBanker ? (
              <button
                type="button"
                data-spring="0.88"
                className="key sm dark num"
                onClick={() => {
                  betCtrl.clearOrphanedBankers();
                  haptic(6);
                  notifyToast("已确认解除失效胆码，恢复普通自由过关");
                }}
              >
                确认解除失效胆码（恢复普通自由过关）
              </button>
            ) : (
              <button
                type="button"
                data-spring="0.88"
                className="key sm dark num"
                onClick={() => {
                  betCtrl.resetPassAuto();
                  haptic(6);
                  notifyToast(
                    `已切换至最高串关（当前 ${maxParlayK === 1 ? "单关" : `${maxParlayK}串1`}）`
                  );
                }}
              >
                一键切换至最高串关（当前{" "}
                {maxParlayK === 1 ? "单关" : `${maxParlayK}串1`}）
              </button>
            )}
            <button
              type="button"
              className="key sm"
              onClick={() => betCtrl.clearPicks()}
            >
              清空重选
            </button>
          </div>
        </div>

        <div className="card enter" style={{ padding: "12px 14px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <div className="num big">¥0</div>
              <div className="num small">
                {syntheticQuote?.referenceOnly
                  ? "确认后可存 0 成本模拟单"
                  : syntheticChoice
                    ? "确认合成票后可生成打票单与记账"
                    : "解除规则冲突后可生成打票单与记账"}
              </div>
            </div>
            <button
              type="button"
              className="key dark wide2"
              disabled
              style={{ opacity: 0.45 }}
            >
              {posterButtonLabel}
            </button>
          </div>
          <div className="two">
            <button
              type="button"
              className="key"
              disabled
              style={{ opacity: 0.45 }}
            >
              存 0 成本模拟单
            </button>
            <button
              type="button"
              className="key dark"
              disabled
              style={{ opacity: 0.45 }}
            >
              记入实买真金账本
            </button>
          </div>
        </div>
      </>
    );
  }

  // 5) READY + COMPUTED: Full 3-Layer Audit Architecture
  const cockpitTiles = buildAuditCockpitTiles(baseEffectiveReport, insights);
  const hedgeCopy = formatHedgeDrawerCopy(
    insights.hedge,
    baseEffectiveReport.totalCost
  );
  const isPlanHandoff = Boolean(appliedPlan || (hasPlanSpec && handoffBanner));
  const isQuoteStale = livePortfolioQuote.isStale;
  const visibleScenarios =
    hitBucketFilter === "all"
      ? threeLayer.layer3.scenarios
      : threeLayer.layer3.scenarios.filter(
          (sc) => sc.bucketKey === hitBucketFilter
        );
  const pinnedZero = threeLayer.layer3.pinnedZeroSummary;
  const sandboxActive =
    sandboxSim.voidMatchIds.length > 0 ||
    simVoidFirstMatch ||
    subjectiveDeltaPct !== 0;
  const canPrintCheckout =
    baseEffectiveReport.canCheckout && baseEffectiveReport.totalCost <= 20000;

  return (
    <>
      {draftNoticeBanner}

      {budgetMismatchMeta && (
        <div
          className="card enter num"
          style={{
            border: "1px solid var(--warn)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span className="small" style={{ margin: 0, fontWeight: 600 }}>
            ⚠️ {budgetMismatchMeta.bannerText}
          </span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <button
              type="button"
              data-spring="0.88"
              className="key mini dark num"
              onClick={onRequoteAtCurrentBudget}
            >
              按新参数重算并替换 (¥{budgetMismatchMeta.currentBudgetYuan})
            </button>
            <button
              type="button"
              className="key mini"
              onClick={onRestoreEqualMultiple}
            >
              {activeAuditedSlip.revertActionLabel}
            </button>
          </div>
        </div>
      )}

      {/* LAYER 1: 当前核对实票 · 我买了什么 */}
      <div
        key={
          isPlanHandoff
            ? (handoffBanner?.seq ?? appliedPlan?.key ?? "plan-handoff")
            : `manual-${baseEffectiveReport.modeLabel}`
        }
        className={`card enter num ${isPlanHandoff ? "sonar-card" : ""}`}
        style={{ display: "flex", flexDirection: "column", gap: 8 }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                marginBottom: 4,
              }}
            >
              <span className="sec" style={{ margin: 0 }}>
                {shopkeeperBlockReason
                  ? "🧪 ① 模拟选单"
                  : "🧾 ① 当前核对实票 · 我买了什么"}
              </span>
              <span className="qpill hi">{threeLayer.layer1.sourceBadge}</span>
              {appliedPlan?.title && (
                <span className="small" style={{ margin: 0 }}>
                  {dedupePlanTitle(appliedPlan.title)}
                </span>
              )}
              {isQuoteStale && (
                <span className="qpill warn" role="status">
                  ⏳ 重算中…
                </span>
              )}
            </div>
            <b style={{ fontSize: 12.5, lineHeight: 1.45, display: "block" }}>
              {shopkeeperBlockReason
                ? `${baseEffectiveReport.matchCount}场 · ${baseEffectiveReport.modeLabel} · ${threeLayer.layer1.stakeUnitsCount}注 · 参考金额 ¥${baseEffectiveReport.totalCost}`
                : threeLayer.layer1.equationText}
            </b>
            {shopkeeperBlockReason && (
              <div className="small" role="status">
                {shopkeeperBlockReason}。可按参考价模拟。
              </div>
            )}
          </div>

          <div
            style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap" }}
          >
            {isPlanHandoff ? (
              <>
                <button
                  type="button"
                  className="key mini"
                  onClick={() => {
                    haptic(5);
                    setConvertPreviewOpen((v) => !v);
                  }}
                >
                  转为手动复式
                </button>
                <button
                  type="button"
                  className="key mini"
                  onClick={() => {
                    setConvertPreviewOpen(false);
                    onRestoreEqualMultiple();
                  }}
                >
                  {activeAuditedSlip.revertActionLabel}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="key mini"
                onClick={onGoToArchetypes}
              >
                ② 配单
              </button>
            )}
          </div>
        </div>

        {convertPreviewOpen && convertManualPreview && (
          <div className="note-box">
            <strong>🔄 将方案转为手动复式预览：</strong>
            <div style={{ marginTop: 2 }}>
              {convertManualPreview.summaryText}
            </div>
            {convertManualPreview.canConvert ? (
              <div className="note-act" style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  data-spring="0.88"
                  className="key mini dark num"
                  onClick={onConfirmConvertPlanToManual}
                >
                  确认转为手动复式 (¥{convertManualPreview.previewTotalCost})
                </button>
                <button
                  type="button"
                  className="key mini"
                  onClick={() => setConvertPreviewOpen(false)}
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="note-act">
                <button
                  type="button"
                  className="key mini"
                  onClick={() => setConvertPreviewOpen(false)}
                >
                  知道了
                </button>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            paddingTop: 6,
            borderTop: "0.5px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span className="small" style={{ margin: 0 }}>
            ⚖️ {shopkeeperBlockReason ? "模拟分倍" : "在审实票分倍重分配"}
            （锁定总投 ¥{baseEffectiveReport.totalCost}）：
          </span>
          <div className="pass">
            <button
              type="button"
              data-spring="0.88"
              disabled={isBonusOptDisabled}
              className={`key mini ${appliedPlan?.shortTab === "平均优化" ? "on" : ""}`}
              onClick={(e) =>
                onApplyBonusOptimization("equal", e.currentTarget)
              }
            >
              ① 平均优化
            </button>
            <button
              type="button"
              data-spring="0.88"
              disabled={isBonusOptDisabled}
              className={`key mini ${appliedPlan?.shortTab === "博热保本" ? "on" : ""}`}
              onClick={(e) =>
                onApplyBonusOptimization("hot-first", e.currentTarget)
              }
            >
              ② 博热保本
            </button>
            <button
              type="button"
              data-spring="0.88"
              disabled={isBonusOptDisabled}
              className={`key mini ${appliedPlan?.shortTab === "博冷高弹" ? "on" : ""}`}
              onClick={(e) =>
                onApplyBonusOptimization("cold-first", e.currentTarget)
              }
            >
              ③ 博冷高弹
            </button>
          </div>
          {(pendingComboUnbundleMode !== null ||
            playabilityGates.effectiveAppliedPlan
              ?.requiresComboUnbundleConfirm) && (
            <div
              className="note-box alert"
              style={{ width: "100%", marginTop: 4 }}
            >
              <strong>⚠️ 固定多串解绑确认：</strong>
              当前为固定多串【{manualReport.modeLabel}】，需先确认
              <strong>将固定多串解绑为独立自由串关以启用不等倍分倍</strong>
              （解绑后按独立自由串关逐张打票）。
              <div
                className="note-act"
                style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
              >
                <button
                  type="button"
                  data-spring="0.88"
                  className="key mini dark num"
                  onClick={(e) =>
                    onApplyBonusOptimization(
                      pendingComboUnbundleMode ?? "equal",
                      e.currentTarget,
                      true
                    )
                  }
                >
                  确认解绑为自由串关并分倍
                </button>
                <button
                  type="button"
                  className="key mini"
                  onClick={() => {
                    setPendingComboUnbundleMode(null);
                    if (
                      playabilityGates.effectiveAppliedPlan
                        ?.requiresComboUnbundleConfirm
                    ) {
                      betCtrl.revertToManualDraft(false);
                    }
                  }}
                >
                  取消（保持原固定多串）
                </button>
              </div>
            </div>
          )}
          {baseEffectiveReport.underwaterCount > 0 &&
            typeof breakevenTargetCost === "number" &&
            breakevenTargetCost > baseEffectiveReport.totalCost &&
            !isBonusOptDisabled && (
              <div
                style={{
                  width: "100%",
                  marginTop: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span className="small" style={{ margin: 0 }}>
                  当前 ¥{baseEffectiveReport.totalCost} 严守原预算（仍余{" "}
                  {baseEffectiveReport.underwaterCount} 种局部回血赛果）
                </span>
                <button
                  type="button"
                  data-spring="0.88"
                  className="key mini dark num"
                  onClick={(e) => onUpgradeBonusToBreakeven(e.currentTarget)}
                >
                  ⚡ 显式授权升至最低保本门槛 ¥{breakevenTargetCost}
                </button>
              </div>
            )}
          {isBonusOver512 && (
            <div
              className="small"
              style={{ width: "100%", marginTop: 2, color: "var(--warn)" }}
            >
              ⚠️ 当前超出 512 注线下逐票分倍上限，请精简包号或改用【3+1
              精算配单】
            </div>
          )}
        </div>

        {!shopkeeperBlockReason && threeLayer.layer1.groups.length > 0 && (
          <SpringCollapseDrawer
            defaultOpen={threeLayer.layer1.totalTicketCount <= 6}
            className="audit-inner-drawer"
            title={`展开逐张基本票清单（#1 ~ #${threeLayer.layer1.totalTicketCount} · 按对阵分组）`}
            badge={
              <span className="qpill num">
                {threeLayer.layer1.groups.length} 组对阵
              </span>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {threeLayer.layer1.groups.map((grp) => (
                <div
                  key={grp.matchPairKey}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    paddingBottom: 6,
                    borderBottom: "0.5px dashed var(--line)",
                  }}
                >
                  <div
                    className="small num"
                    style={{
                      margin: 0,
                      fontWeight: 600,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 6,
                    }}
                  >
                    <span>📌 {grp.matchPairLabel}</span>
                    <span>
                      {grp.ticketCount}种基本票 · 小计 ¥{grp.subTotalCost}
                    </span>
                  </div>
                  {grp.tickets.map((tk) => (
                    <div
                      key={tk.id}
                      className="combo-item num"
                      style={{ padding: "5px 8px" }}
                    >
                      <div className="cdesc">
                        <b>
                          #{tk.ticketNo} {tk.legsText}
                        </b>
                        <small>
                          {tk.modeLabel} · 连乘{tk.oddsProductText} ·{" "}
                          {tk.multiple}倍（本金 ¥{tk.stakeCost}）
                        </small>
                      </div>
                      <div className="cpnl pos" style={{ flexShrink: 0 }}>
                        ¥{tk.singleHitPayout.toFixed(2)}
                        <small>单票中返</small>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </SpringCollapseDrawer>
        )}
      </div>

      {/* LAYER 2: 四桶客观盈亏概率分布 · ¥C 会发生什么 */}
      <div
        ref={auditCockpitRef}
        className="yj-shimmer-host"
        style={
          isQuoteStale
            ? { opacity: 0.78, transition: "opacity 160ms ease" }
            : undefined
        }
      >
        <TactileFlipCard
          flipped={cockpitFlipBack}
          onFlipChange={setCockpitFlipBack}
          flipToBackLabel="🔄 翻转看分位数与奖金天平图 ›"
          flipToFrontLabel="↩ 返回四桶分布"
          frontHeader={
            <div
              className="sec num"
              style={{
                margin: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span>{threeLayer.layer2.titleText}</span>
              {baseEffectiveReport.totalCost > 0 && (
                <span
                  className={`qpill num ${cockpitTiles.headerBadge.isDanger ? "danger" : cockpitTiles.headerBadge.isWarn ? "warn" : ""}`}
                >
                  {cockpitTiles.headerBadge.text}
                </span>
              )}
            </div>
          }
          backHeader={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span className="sec num" style={{ margin: 0 }}>
                📊 无条件分位数与奖金天平柱状图
              </span>
              <button
                type="button"
                className="help-pill"
                onClick={() => onOpenManual("sandbox")}
              >
                ? 仪表解读
              </button>
            </div>
          }
          front={
            <>
              <div
                className="audit-bucket4-bar"
                role="img"
                aria-label="四桶客观盈亏概率占比条"
              >
                {threeLayer.layer2.buckets.map((bk) =>
                  bk.widthPct > 0 ? (
                    <i
                      key={bk.key}
                      className={`b4-${bk.tone}`}
                      style={{ width: `${bk.widthPct}%` }}
                      title={`${bk.label} ${bk.formulaLabel}: ${bk.probText}`}
                    />
                  ) : null
                )}
              </div>

              <div className="tiles num">
                {threeLayer.layer2.buckets.map((bk) => (
                  <div
                    key={bk.key}
                    ref={bk.key === "partial" ? underwaterTileRef : undefined}
                    className={`tile ${
                      bk.key === "zero" && bk.prob >= 0.78
                        ? "danger"
                        : bk.key === "partial" && bk.prob > 0.0005
                          ? "danger"
                          : ""
                    }`}
                  >
                    <span>
                      {bk.label} {bk.formulaLabel}
                    </span>
                    <b>{bk.probText}</b>
                    <em>
                      {bk.key === "zero"
                        ? `净亏 -¥${baseEffectiveReport.totalCost}`
                        : bk.key === "partial"
                          ? bk.prob > 0.0005
                            ? `中票但低于本金(${baseEffectiveReport.underwaterCount}种)`
                            : "0 种倒贴回血"
                          : bk.key === "breakeven"
                            ? "实派恰好等于本金"
                            : "实派严格高于总本金"}
                    </em>
                  </div>
                ))}
              </div>

              <div
                className="num"
                style={{
                  marginTop: 8,
                  paddingTop: 7,
                  borderTop: "0.5px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  fontSize: 11.5,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    🎯 <b>{threeLayer.layer2.conditionalRangeText}</b>
                  </span>
                  <span>
                    客观EV <b>{threeLayer.layer2.objectiveEvPctText}</b>（
                    {threeLayer.layer2.expectedNetText}）· 均值抽水{" "}
                    {threeLayer.layer2.avgVigLossPct}%
                  </span>
                </div>
                <div
                  className="small num"
                  style={{
                    margin: 0,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{threeLayer.layer2.fiveZeroStreakText}</span>
                  <span>{threeLayer.layer2.fiveNoGainStreakText}</span>
                </div>
              </div>
            </>
          }
          back={
            <>
              <div className="tiles num" style={{ marginBottom: 8 }}>
                <div
                  className={`tile ${cockpitTiles.flipBack.quantileTile.isDanger ? "danger" : ""}`}
                >
                  <span>{cockpitTiles.flipBack.quantileTile.label}</span>
                  <b>{cockpitTiles.flipBack.quantileTile.value}</b>
                  <em>{cockpitTiles.flipBack.quantileTile.subtitle}</em>
                </div>
                <div
                  className={`tile ${cockpitTiles.flipBack.vigTile.isDanger ? "danger" : ""}`}
                >
                  <span>{cockpitTiles.flipBack.vigTile.label}</span>
                  <b>{cockpitTiles.flipBack.vigTile.value}</b>
                  <em>{cockpitTiles.flipBack.vigTile.subtitle}</em>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span className="small" style={{ margin: 0 }}>
                  ⚖️ 奖金天平（虚线为总本金线 ¥{baseEffectiveReport.totalCost}）
                </span>
                <button
                  type="button"
                  className="help-pill"
                  onClick={() => onOpenManual("optimizer")}
                >
                  📘 优化原理图解
                </button>
              </div>
              <PayoutEqualizerBars
                combos={equalizerBars}
                totalCost={baseEffectiveReport.totalCost}
              />
            </>
          }
        />
      </div>

      {/* Anti-pitfall & Arb Radar (zero nested sonar-card border) */}
      {((baseEffectiveReport.underwaterCount > 0 &&
        baseEffectiveReport.effectiveOdds > 1.005) ||
        showBridgeFinder ||
        Boolean(appliedPlan?.capGuardAlternative) ||
        Boolean(baseEffectiveReport.syntheticHint) ||
        Boolean(safeSwapPreview?.ok) ||
        Boolean(insights.weakestLink) ||
        allWarnings.length > 0) && (
        <div
          className={`card sonar-card enter ${diagnosingMatchId ? "scanning" : ""}`}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="sec">防坑雷达 · 弹性保本 · 省钱动作</div>

          {appliedPlan?.capGuardAlternative && (
            <div className="note-box num">
              <strong>⚠️ 超 20 万封顶减倍与期望护栏确认：</strong>
              {appliedPlan.capGuardAlternative.summaryText ||
                `可将超 20 万封顶项减倍回填（分倍 [${appliedPlan.capGuardAlternative.multiples.join(", ")}]），客观期望变动 ${(appliedPlan.capGuardAlternative.expectedValueRateDiff * 100).toFixed(2)}%`}
              <div className="note-act">
                <button
                  type="button"
                  data-spring="0.88"
                  className="key mini dark num"
                  onClick={(e) => {
                    const res = betCtrl.confirmBonusCapGuardAlternative(
                      appliedPlan.capGuardAlternative
                    );
                    if (!res.ok) {
                      haptic(12);
                      notifyToast(
                        res.blockedReason || "原备选已过期，请重新核对"
                      );
                      return;
                    }
                    playTactileCue("optimize-arpeggio");
                    triggerShimmerSweep(auditCockpitRef.current);
                    burstCelebrationSparks(e.currentTarget, 18);
                    notifyToast("已按您的确认切换封顶减倍分倍方案");
                  }}
                >
                  确认切换封顶减倍方案（接受期望折损）
                </button>
              </div>
            </div>
          )}

          <BridgeCandidatesCard
            showBridgeFinder={showBridgeFinder}
            bridgeCandidates={bridgeCandidates}
            compact
            unstyledInner
            previewBridgeCandidate={(c) => betCtrl.previewBridgeCandidate(c)}
            onApplyBridgeCandidate={onApplyBridgeCandidate}
          />

          {baseEffectiveReport.underwaterCount > 0 &&
            typeof breakevenTargetCost === "number" && (
              <div className="note-box">
                <strong>✨ 弹性全保本升级方案：</strong>受 2 元整数倍影响，当前
                ¥{baseEffectiveReport.totalCost} 存在{" "}
                {baseEffectiveReport.underwaterCount} 种局部回血（低于总本金）；
                {breakevenTargetCost > baseEffectiveReport.totalCost
                  ? `需显式授权将本金升至最低保本门槛 ¥${breakevenTargetCost} 即可实现 `
                  : "在原预算内启用不等倍配平即可实现 "}
                <strong>100% 组合零亏损保本</strong>！
                <div className="note-act">
                  <button
                    type="button"
                    data-spring="0.88"
                    disabled={isBonusOptDisabled}
                    className="key mini dark num"
                    onClick={(e) => onUpgradeToZeroUnderwater(e.currentTarget)}
                  >
                    {breakevenTargetCost > baseEffectiveReport.totalCost
                      ? `⚡ 一键加至最低保本门槛 ¥${breakevenTargetCost}`
                      : "⚖️ 原预算内一键配平 0 假中奖"}
                  </button>
                </div>
              </div>
            )}

          {Boolean(baseEffectiveReport.syntheticHint) && (
            <div className="note-box">
              <strong>
                {appliedPlan
                  ? "⚖️ 智能分倍摘要："
                  : baseEffectiveReport.syntheticAutoMounted
                    ? "🛡️ 跨池等价单关："
                    : "💡 合成单关参谋："}
              </strong>
              {baseEffectiveReport.syntheticHint}
              {isSyntheticPlayable && (
                <SyntheticModePills
                  mode={syntheticSingleMode}
                  canTrim2Way={canTrimSynthetic2Way}
                  hasInherentBlindSpot={hasSyntheticInherentBlindSpot}
                  partialPreview={playabilityGates.partialCoveragePreview}
                  trimLegCount={
                    playabilityGates.partialCoveragePreview?.trim2WayLegCount ??
                    2
                  }
                  containerClassName="syn-mode-pills num"
                  onSelect={onSwitchSyntheticMode}
                />
              )}
            </div>
          )}

          {insights.activeSwapTip && safeSwapPreview?.ok && (
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
                    onApplyEquivalentSwap(
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
                  onClick={() =>
                    activeAuditedSlip.isAppliedPlan
                      ? onExcludeMatchAndRequote(
                          insights.weakestLink!.matchId,
                          "已排除拖后腿场次并重配方案"
                        )
                      : onRemoveMatchFromSlip(
                          insights.weakestLink!.matchId,
                          "已砍掉拖后腿场次"
                        )
                  }
                >
                  {activeAuditedSlip.isAppliedPlan
                    ? "排除此场并重配"
                    : "一键砍掉此场"}
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
      )}

      {activeAuditedSlip.matchCount >= 2 && (
        <div
          className={`card sonar-card enter ${diagnosingCombo ? "scanning" : ""}`}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <div className="co-head" style={{ marginBottom: 0 }}>
            <span className="sec num" style={{ margin: 0 }}>
              🧹 精算×情报协同会诊（
              {activeAuditedSlip.isAppliedPlan
                ? `方案涉及 ${activeAuditedSlip.matchCount} 场`
                : `已选 ${activeAuditedSlip.matchCount} 场`}
              ）
            </span>
            <button
              type="button"
              data-spring="0.88"
              className="key mini dark"
              onClick={onDiagnoseComboFromAudit}
            >
              {diagnosingCombo
                ? "小高协同把脉中..."
                : `一键联合会诊这 ${activeAuditedSlip.matchCount} 场`}
            </button>
          </div>
          {comboReport && (
            <div className="note-box" style={{ marginTop: 2 }}>
              {comboReport.planContextBadge && (
                <div
                  className="small"
                  style={{
                    color: "var(--good)",
                    fontWeight: 600,
                    marginBottom: 2,
                  }}
                >
                  {comboReport.planContextBadge}
                </div>
              )}
              <strong>
                [{comboReport.comboTag}] 短板：{comboReport.weakestLeg}
              </strong>
              <div>{comboReport.summary}</div>
              {comboReport.actuarySynergy && (
                <div style={{ marginTop: 2, color: "var(--good)" }}>
                  🛡️ {comboReport.actuarySynergy}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <SpringCollapseDrawer
        defaultOpen={activeAuditedSlip.matchCount <= 3}
        title={activeAuditedSlip.drawerTitle}
        summary={activeAuditedSlip.legs
          .slice(0, 3)
          .map((p) => `${p.home}[${p.optionLabel}]`)
          .join(" · ")}
        badge={
          <span className="qpill num">
            {activeAuditedSlip.totalLegCount} 项
          </span>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {activeAuditedSlip.matches.map((mEntry) => {
            const mid = mEntry.matchId;
            const fullMatch = matches.find((x) => x.id === mid);
            return (
              <div
                key={mid}
                style={{
                  padding: "6px 0",
                  borderBottom: "0.5px solid var(--line)",
                }}
              >
                <div className="co-head" style={{ marginBottom: 5 }}>
                  <div className="duo">
                    <TeamCrest name={mEntry.home} size={18} />
                    <b>{mEntry.home}</b>
                    <span className="sep">—</span>
                    <TeamCrest name={mEntry.away} size={18} />
                    <b>{mEntry.away}</b>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                    {canToggleBanker && (
                      <button
                        type="button"
                        className={`key mini ${activeBankerSet.has(mid) ? "on" : ""}`}
                        data-spring="0.85"
                        onClick={(e) =>
                          onToggleBankerMatch(mid, mEntry.home, e.currentTarget)
                        }
                      >
                        {activeBankerSet.has(mid) ? "📌胆" : "📌设胆"}
                      </button>
                    )}
                    {fullMatch && (
                      <button
                        type="button"
                        className="key mini"
                        data-spring="0.85"
                        onClick={() => onDiagnoseSingleMatch(fullMatch)}
                      >
                        {diagnosingMatchId === mid ? "诊盘中" : "单诊"}
                      </button>
                    )}
                    {activeAuditedSlip.isAppliedPlan ? (
                      <button
                        type="button"
                        className="key mini"
                        data-spring="0.85"
                        onClick={() => onExcludeMatchAndRequote(mid)}
                      >
                        排除此场并重配
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="key mini"
                        data-spring="0.85"
                        onClick={() => {
                          onRemoveMatchFromSlip(mid);
                          haptic(6);
                        }}
                      >
                        移除
                      </button>
                    )}
                  </div>
                </div>
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  {mEntry.pools.map((pg) => (
                    <div key={`${mid}-pool-${pg.poolCode}`} className="chips">
                      {pg.legs.map((v) => {
                        const liveOpt = fullMatch?.pools[
                          v.poolCode
                        ]?.options.find((o) => o.key === v.optionKey);
                        return (
                          <span
                            key={`${v.poolCode}-${v.optionKey}`}
                            className="chip num"
                          >
                            {(activeAuditedSlip.isAppliedPlan ||
                              activeAuditedSlip.isAutoSynthetic) && (
                              <b style={{ marginRight: 3 }}>
                                [{v.legSourceLabel}]
                              </b>
                            )}
                            {pg.poolName}·{v.optionLabel}
                            <i>
                              @{v.odds.toFixed(2)}
                              {renderTrendArrow(liveOpt?.trend)} (
                              {(v.fairProb * 100).toFixed(0)}%)
                            </i>
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SpringCollapseDrawer>

      {/* LAYER 3: 赛果推演明细 · 开什么赛果中哪几张票 */}
      <div
        className="card enter"
        style={
          isQuoteStale
            ? { opacity: 0.78, transition: "opacity 160ms ease" }
            : undefined
        }
      >
        <div
          className="sec-lbl"
          style={{ margin: "0 0 8px", flexWrap: "wrap", gap: 6 }}
        >
          <span>🎲 ③ 赛果推演明细 · {threeLayer.layer3.headerCountText}</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(
              [
                ["prob-first", "高概率优先"],
                ["profit-first", "高净利优先"],
                ["loss-first", "回血/低返优先"],
              ] as Array<[ComboSortMode, string]>
            ).map(([sm, sl]) => (
              <button
                key={sm}
                type="button"
                className={`key mini ${comboSortMode === sm ? "on" : ""}`}
                onClick={() => {
                  haptic(4);
                  setUserComboSort(sm);
                }}
              >
                {sl}
              </button>
            ))}
          </div>
        </div>

        {threeLayer.layer3.hitBuckets.length > 1 && (
          <div
            className="fstrip num"
            style={{ marginBottom: 8, paddingBottom: 2 }}
          >
            <button
              type="button"
              className={`fchip ${hitBucketFilter === "all" ? "on" : ""}`}
              onClick={() => setHitBucketFilter("all")}
            >
              全部中奖情景({threeLayer.layer3.scenarios.length})
            </button>
            {threeLayer.layer3.hitBuckets.map((hb) => (
              <button
                key={hb.bucketKey}
                type="button"
                className={`fchip ${hitBucketFilter === hb.bucketKey ? "on" : ""}`}
                onClick={() => setHitBucketFilter(hb.bucketKey)}
              >
                {hb.bucketLabel}({hb.count})
              </button>
            ))}
          </div>
        )}

        <div className="combo-list num">
          {/* Permanently Pinned Top Zero-Payout Summary Row */}
          <div className="combo-card uw" style={{ cursor: "default" }}>
            <div className="combo-card-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="small"
                  style={{
                    margin: "0 0 3px",
                    fontWeight: 700,
                    color: "var(--live)",
                  }}
                >
                  📌 置顶汇总 · {pinnedZero.title}
                </div>
                <div className="small" style={{ margin: 0 }}>
                  {pinnedZero.splitSubline}
                </div>
              </div>
              <div
                className="cpnl neg"
                style={{ flexShrink: 0, textAlign: "right" }}
              >
                -¥{pinnedZero.netLossYuan.toFixed(2)}
                <small>0 张实票命中</small>
              </div>
            </div>
            <div className="combo-pnl-bar">
              <i
                className="loss"
                style={{
                  width: `${Math.max(4, Math.min(100, pinnedZero.prob * 100))}%`,
                }}
              />
            </div>
            <div className="combo-meta-row">
              <span>
                发生真率 <b>{pinnedZero.probText}</b> · 实派 <b>¥0.00</b>
              </span>
              <span>本金净损 -¥{pinnedZero.netLossYuan.toFixed(2)}</span>
            </div>
          </div>

          {/* Winning Scenarios Below */}
          {visibleScenarios.map((sc) => {
            const hasTickets = sc.winningTickets.length > 0;
            const isExpanded = hasTickets && Boolean(expandedComboIds[sc.id]);
            return (
              <div
                key={sc.id}
                className={`combo-card sdrawer ${isExpanded ? "open" : ""} ${sc.netProfit < -0.005 ? "uw" : ""}`}
                style={!hasTickets ? { cursor: "default" } : undefined}
                onClick={() => {
                  if (!hasTickets) return;
                  haptic(4);
                  setExpandedComboIds((prev) => ({
                    ...prev,
                    [sc.id]: !prev[sc.id],
                  }));
                }}
              >
                <div className="combo-card-top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="small"
                      style={{
                        margin: "0 0 4px",
                        fontWeight: 600,
                        color: "var(--text)",
                      }}
                    >
                      {sc.bucketLabel} · {sc.hitTicketBadgesText}
                    </div>
                    <div className="combo-legs">
                      <span className="combo-leg-chip">{sc.desc}</span>
                    </div>
                  </div>
                  <div
                    className={`cpnl ${sc.netProfit < -0.005 ? "neg" : "pos"}`}
                    style={{ flexShrink: 0, textAlign: "right" }}
                  >
                    {sc.netProfit >= 0
                      ? `+¥${sc.netProfit.toFixed(2)}`
                      : `-¥${Math.abs(sc.netProfit).toFixed(2)}`}
                    <small>{sc.statusBadgeText}</small>
                  </div>
                </div>

                <div className="combo-pnl-bar">
                  <i
                    className={sc.barTone}
                    style={{ width: `${sc.barFillPct}%` }}
                  />
                </div>

                <div className="combo-meta-row">
                  <span>
                    发生真率 <b>{sc.probText}</b> · 实派{" "}
                    <b>¥{sc.payout.toFixed(2)}</b> · {sc.returnSummaryText}
                  </span>
                  {hasTickets && (
                    <span style={{ color: "var(--mark)", fontWeight: 600 }}>
                      明细 {isExpanded ? "▴" : "▾"}
                    </span>
                  )}
                </div>

                {hasTickets && (
                  <div
                    className="sdrawer-body"
                    inert={!isExpanded || undefined}
                  >
                    <div className="sdrawer-inner">
                      <div className="combo-tickets-box">
                        {sc.winningTickets.map((tk) => (
                          <div
                            key={`${sc.id}-tk-${tk.id}-${tk.ticketNo}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <span>
                              实票#{tk.ticketNo}（{tk.multiple}倍 · 单注¥
                              {tk.unitPayout.toFixed(2)}）：
                              {tk.legs && tk.legs.length > 0
                                ? tk.legs
                                    .map((g) => `${g.home}[${g.optionLabel}]`)
                                    .join(" × ")
                                : tk.desc}
                            </span>
                            <b>派奖 ¥{tk.totalPayout.toFixed(2)}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ISOLATED SANDBOX PANEL (Never mutates Layer 1, BetBar, or Print Sheet) */}
      <SpringCollapseDrawer
        defaultOpen={insights.hedge.available || sandboxActive}
        title={hedgeCopy.drawerTitle}
        summary={hedgeCopy.drawerSummary}
        badge={
          sandboxActive ? (
            <span className="qpill warn num">沙盒推演中</span>
          ) : hedgeCopy.badgeTone === "warn" ? (
            <span className="qpill num" style={{ color: "var(--warn)" }}>
              {hedgeCopy.badgeText}
            </span>
          ) : hedgeCopy.badgeTone === "hi" ? (
            <span className="qpill hi num">{hedgeCopy.badgeText}</span>
          ) : (
            <span className="qpill num">{hedgeCopy.badgeText}</span>
          )
        }
      >
        <div className="rows" style={{ padding: 0 }}>
          {sandboxActive && (
            <div className="note-box num" style={{ margin: "0 0 8px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <strong>🧪 实盘基准 vs 沙盒推演对照（仅沙盒内生效）</strong>
                <button
                  type="button"
                  className="key mini"
                  onClick={() => {
                    betCtrl.setVoidMatchIds([]);
                    betCtrl.setSubjectiveDeltaPct(0);
                    haptic(5);
                  }}
                >
                  重置沙盒
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                  fontSize: 11.5,
                }}
              >
                <div>
                  <span className="small" style={{ margin: 0 }}>
                    实盘基准（打票锁死 ¥{baseEffectiveReport.totalCost}）
                  </span>
                  <div>
                    归零 {(baseEffectiveReport.zeroPayoutProb * 100).toFixed(1)}
                    % · 严格净赚{" "}
                    {(
                      baseEffectiveReport.objectiveStrictNetGainProb * 100
                    ).toFixed(1)}
                    %
                  </div>
                </div>
                <div>
                  <span className="small" style={{ margin: 0 }}>
                    沙盒假设（模拟计奖 ¥{sandboxReport.totalCost}）
                  </span>
                  <div>
                    归零 {(sandboxReport.zeroPayoutProb * 100).toFixed(1)}% ·
                    严格净赚{" "}
                    {(sandboxReport.objectiveStrictNetGainProb * 100).toFixed(
                      1
                    )}
                    % · 主观EV{" "}
                    {subjectiveEVPct >= 0
                      ? `+${subjectiveEVPct.toFixed(1)}%`
                      : `${subjectiveEVPct.toFixed(1)}%`}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="row">
            <div>
              <div
                className="lbl"
                style={{ fontWeight: 600, color: "var(--text)" }}
              >
                {hedgeCopy.rowHeader}
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
                <span className="lbl">假设早场已红，晚场单关反向补单</span>
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
                <b style={{ color: hedgeCopy.lockedOutcomeColor }}>
                  {hedgeCopy.lockedOutcomeText}
                </b>
              </div>
            </>
          )}

          <div
            className="row"
            style={{
              flexDirection: "column",
              alignItems: "stretch",
              gap: 6,
            }}
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
                  onClick={() => onOpenManual("sandbox")}
                >
                  ? 往哪拉
                </button>
              </span>
              <span className="num" style={{ fontWeight: 600 }}>
                {subjectiveDeltaPct > 0
                  ? `+${subjectiveDeltaPct}%`
                  : `${subjectiveDeltaPct}%`}{" "}
                · 主观EV{" "}
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
              min={SUBJECTIVE_SLIDER_BOUNDS.min}
              max={SUBJECTIVE_SLIDER_BOUNDS.max}
              step={SUBJECTIVE_SLIDER_BOUNDS.step}
              value={subjectiveDeltaPct}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (next !== subjectiveDeltaPct) {
                  playTactileCue(next === 0 ? "detent-zero" : "detent-tick");
                  betCtrl.setSubjectiveDeltaPct(next);
                }
              }}
              className="srange"
            />
          </div>

          <div
            className="row"
            style={{
              flexDirection: "column",
              alignItems: "stretch",
              gap: 6,
            }}
          >
            <div>
              <div className="lbl">
                模拟指定赛事延期/腰斩（按法定水位 1.0 退算，可多选）
              </div>
              <div className="small">
                勾选任意场次预演无效场次退算，不影响实票出票与记账快照
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {activeAuditedSlip.matches.map((mEntry) => {
                const isVoided = sandboxSim.voidMatchIds.includes(
                  mEntry.matchId
                );
                return (
                  <button
                    key={`void-sim-${mEntry.matchId}`}
                    type="button"
                    className={`key mini num ${isVoided ? "on" : ""}`}
                    onClick={() => {
                      haptic(5);
                      betCtrl.toggleVoidMatchId(mEntry.matchId);
                    }}
                  >
                    {isVoided ? "⚪腰斩 · " : "☐ "}
                    {mEntry.matchNumStr.slice(-3)} {mEntry.home}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SpringCollapseDrawer>

      {/* UNPOLLUTED CHECKOUT & LEDGER SEALING CARD */}
      <div className="card enter" style={{ padding: "12px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div>
            <div className="num big">
              {shopkeeperBlockReason ? "参考金额 " : ""}¥
              {baseEffectiveReport.totalCost}
            </div>
            <div className="num small">
              {threeLayer.layer1.logicalLineCount}种基本票 · 共{" "}
              {threeLayer.layer1.stakeUnitsCount} 份2元注 · 预计纸票{" "}
              {threeLayer.layer1.physicalSlipCount} 张
            </div>
          </div>
          <button
            type="button"
            className="key dark wide2"
            disabled={!canPrintCheckout}
            style={{ opacity: canPrintCheckout ? 1 : 0.45 }}
            onClick={onOpenPoster}
          >
            {posterButtonLabel}
          </button>
        </div>
        <div className="two">
          <button
            type="button"
            className="key"
            data-spring="0.9"
            disabled={!canPrintCheckout || ledgerBusy}
            onClick={() => onRecordToLedger("paper")}
          >
            存 0 成本模拟单
          </button>
          <button
            type="button"
            className="key dark"
            data-spring="0.9"
            disabled={
              !canPrintCheckout || ledgerBusy || Boolean(shopkeeperBlockReason)
            }
            title={shopkeeperBlockReason ?? undefined}
            onClick={() => onRecordToLedger("live")}
          >
            记入实买真金账本
          </button>
        </div>
      </div>
    </>
  );
}
