import { useMemo, useState, type RefObject } from "react";
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
  formatHedgeDrawerCopy,
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
  const [expandedComboIds, setExpandedComboIds] = useState<
    Record<string, boolean>
  >({});
  const [simHedgeHit, setSimHedgeHit] = useState(true);
  const [convertPreviewOpen, setConvertPreviewOpen] = useState(false);

  const betCtrl = wbCtrl.betSlip;
  const {
    matches,
    multiple,
    planSpec,
    activeAuditedSlip,
    syntheticSingleMode,
    subjectiveDeltaPct,
    simVoidFirstMatch,
    workspace,
  } = snap.betSlipState;
  const { diagnosingMatchId, diagnosingCombo, comboReport, playabilityGates } =
    snap;
  const manualReport = workspace.manualReport;
  const effectiveReport = workspace.effectiveReport;
  const insights = workspace.insights;
  const allWarnings = workspace.allWarnings;
  const subjectiveEVPct = workspace.subjectiveEVPct;
  const hasPlanSpec = Boolean(planSpec);
  const budgetMismatchMeta = activeAuditedSlip.budgetMismatchMeta;
  const convertManualPreview = useMemo(
    () =>
      convertPreviewOpen && activeAuditedSlip.isAppliedPlan
        ? betCtrl.previewConvertAppliedPlanToManual()
        : null,
    [convertPreviewOpen, activeAuditedSlip, betCtrl]
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
        `已按当前新预算 ¥${snap.betSlipState.budget} 重新配单并同步审单台`
      );
    } else {
      notifyToast(
        `当前新预算 ¥${snap.betSlipState.budget} 下原档方案未过准入红线，已退回待选方案态`
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
    triggerEl?: HTMLElement | null
  ): boolean => {
    const res = betCtrl.applyBonusOptimization(optMode);
    if (!res.ok) {
      if (res.blockedReason) {
        haptic(12);
        notifyToast(res.blockedReason);
      }
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
      targetCost > effectiveReport.totalCost
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
  const onChangeSubjectiveDeltaPct = (v: number) =>
    betCtrl.setSubjectiveDeltaPct(v);
  const onChangeSimVoidFirstMatch = (v: boolean) =>
    betCtrl.setSimVoidFirstMatch(v);

  const {
    appliedPlan,
    effectiveAppliedPlan,
    isBonusOver512,
    isBonusOptDisabled,
    breakevenTargetCost,
    isSingleNonSingleContext,
    isSyntheticPlayable,
    canTrimSynthetic2Way,
    hasSyntheticInherentBlindSpot,
    showBridgeFinder,
    canToggleBanker,
    activeBankerSet,
  } = playabilityGates;

  const comboSortMode: ComboSortMode =
    userComboSort ??
    (effectiveReport.underwaterCount > 0 ? "loss-first" : "prob-first");

  const scenarioRows = useMemo(
    () =>
      buildAuditScenarioRows(effectiveReport, comboSortMode, {
        matchCount: effectiveReport.matchCount,
        defaultMultiple: multiple,
        appliedLines: effectiveAppliedPlan?.lines,
      }),
    [effectiveReport, comboSortMode, multiple, effectiveAppliedPlan?.lines]
  );

  const equalizerBars = useMemo(
    () =>
      buildAuditScenarioRows(effectiveReport, "prob-first", {
        matchCount: effectiveReport.matchCount,
        defaultMultiple: multiple,
        appliedLines: effectiveAppliedPlan?.lines,
      }).map((r) => ({
        id: r.id,
        label: r.isZeroWipeoutRow ? "全部未中" : r.desc,
        totalPayout: r.totalPayout,
        prob: r.prob,
      })),
    [effectiveReport, multiple, effectiveAppliedPlan?.lines]
  );

  const effectiveTicketOrBetCount = effectiveReport.tickets?.length
    ? effectiveReport.tickets.length
    : effectiveReport.betCount;
  const auditTicketCount =
    effectiveAppliedPlan?.lines.length ?? effectiveTicketOrBetCount;
  const isPlanHandoff = Boolean(appliedPlan || (hasPlanSpec && handoffBanner));

  if (effectiveReport.matchCount === 0) {
    return (
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
    );
  }

  const cockpitTiles = buildAuditCockpitTiles(effectiveReport, insights);
  const hedgeCopy = formatHedgeDrawerCopy(
    insights.hedge,
    effectiveReport.totalCost
  );
  const bridgeCandidates = insights.bridgeCandidates ?? [];

  return (
    <>
      <div
        key={
          isPlanHandoff
            ? (handoffBanner?.seq ?? appliedPlan?.key ?? "plan-handoff")
            : `manual-${effectiveReport.modeLabel}`
        }
        className={`handoff-banner num ${!isPlanHandoff ? "manual-src" : ""}`}
      >
        <div>
          <b>
            {isPlanHandoff
              ? `✅ 当前正在审阅：${
                  appliedPlan
                    ? `【${appliedPlan.shortTab}】¥${effectiveReport.totalCost} 方案`
                    : `精算配单【${handoffBanner?.title}】`
                }（共 ${auditTicketCount} 张实票）`
              : effectiveReport.syntheticAutoMounted && effectiveAppliedPlan
                ? `🛡️ 当前正在审阅：【${effectiveAppliedPlan.shortTab}】¥${effectiveReport.totalCost} 方案（共 ${auditTicketCount} 张单关配平票）`
                : `📋 当前正在审阅：手动选单 · ${effectiveReport.modeLabel}（共 ${auditTicketCount} 注 · ¥${effectiveReport.totalCost}）`}
          </b>
          <div className="small" style={{ marginTop: 1 }}>
            {isPlanHandoff
              ? "已完成不等倍精算拆票 · 可直接核对打票或微调沙盒"
              : effectiveReport.syntheticAutoMounted
                ? `等效水位 @${(effectiveReport.syntheticEffectiveOdds ?? effectiveReport.effectiveOdds).toFixed(2)} · 原方向已保留，再选第 2 场将自动恢复低抽水串关`
                : "等倍手动选单 · 可点下方智能分倍或切往②3+1精算配单"}
          </div>
        </div>
        {isPlanHandoff ? (
          <div
            style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap" }}
          >
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
          </div>
        ) : (
          <button type="button" className="key mini" onClick={onGoToArchetypes}>
            ② 配单
          </button>
        )}
      </div>

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
          <button
            type="button"
            data-spring="0.88"
            className="key mini dark num"
            onClick={onRequoteAtCurrentBudget}
          >
            点此按 ¥{budgetMismatchMeta.currentBudgetYuan} 重配
          </button>
        </div>
      )}

      {convertPreviewOpen && convertManualPreview && (
        <div className="card enter num">
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
        </div>
      )}

      <div ref={auditCockpitRef} className="yj-shimmer-host">
        <TactileFlipCard
          flipped={cockpitFlipBack}
          onFlipChange={setCockpitFlipBack}
          flipToBackLabel="🔄 翻转看 6 维全表与天平图 ›"
          flipToFrontLabel="↩ 返回核心审单面"
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
              <span>
                🛡️ 五维真相透视舱 · {effectiveReport.modeLabel} (¥
                {effectiveReport.totalCost})
              </span>
              {effectiveReport.totalCost > 0 && (
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
                ? 6块仪表解读
              </button>
            </div>
          }
          front={
            <>
              <div className="tiles num">
                <div
                  className={`tile ${cockpitTiles.tile1.isDanger ? "danger" : ""}`}
                >
                  <span>{cockpitTiles.tile1.label}</span>
                  <b>{cockpitTiles.tile1.value}</b>
                  <em
                    className={
                      cockpitTiles.tile1.strikeSubtitle ? "strike" : undefined
                    }
                  >
                    {cockpitTiles.tile1.subtitle}
                  </em>
                </div>
                <div
                  className={`tile ${cockpitTiles.tile2.isDanger ? "danger" : ""}`}
                >
                  <span>{cockpitTiles.tile2.label}</span>
                  <b>{cockpitTiles.tile2.value}</b>
                  <em>{cockpitTiles.tile2.subtitle}</em>
                </div>
                <div
                  ref={underwaterTileRef}
                  className={`tile ${cockpitTiles.tile3.isDanger ? "danger" : ""}`}
                >
                  <span>{cockpitTiles.tile3.label}</span>
                  <b>{cockpitTiles.tile3.value}</b>
                  <em>{cockpitTiles.tile3.subtitle}</em>
                </div>
                <div
                  className={`tile ${cockpitTiles.tile4.isDanger ? "danger" : ""}`}
                >
                  <span>{cockpitTiles.tile4.label}</span>
                  <b>{cockpitTiles.tile4.value}</b>
                  <em>{cockpitTiles.tile4.subtitle}</em>
                </div>
              </div>

              <div
                style={{
                  marginTop: 9,
                  paddingTop: 8,
                  borderTop: "0.5px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span className="small" style={{ margin: 0 }}>
                  ⚖️ 智能分倍：
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
                {effectiveReport.underwaterCount > 0 &&
                  typeof breakevenTargetCost === "number" &&
                  breakevenTargetCost > effectiveReport.totalCost &&
                  !isBonusOptDisabled && (
                    <div
                      style={{
                        width: "100%",
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="small" style={{ margin: 0 }}>
                        当前 ¥{effectiveReport.totalCost} 严守原预算（仍余{" "}
                        {effectiveReport.underwaterCount} 组局部回血）
                      </span>
                      <button
                        type="button"
                        data-spring="0.88"
                        className="key mini dark num"
                        onClick={(e) =>
                          onUpgradeBonusToBreakeven(e.currentTarget)
                        }
                      >
                        ⚡ 一键加至最低保本门槛 ¥{breakevenTargetCost}
                      </button>
                    </div>
                  )}
                {isBonusOver512 && (
                  <div
                    className="small"
                    style={{
                      width: "100%",
                      marginTop: 4,
                      color: "var(--warn)",
                    }}
                  >
                    ⚠️ 当前共 {manualReport.betCount} 注，超出 512
                    注线下逐票分倍上限，请精简包号或改用【3+1 精算配单】
                  </div>
                )}
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
                  ⚖️ 三模分倍奖金天平（虚线为总本金线）
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
                totalCost={effectiveReport.totalCost}
              />
            </>
          }
        />
      </div>

      {((effectiveReport.underwaterCount > 0 &&
        effectiveReport.effectiveOdds > 1.005) ||
        showBridgeFinder ||
        Boolean(effectiveReport.syntheticHint) ||
        Boolean(insights.activeSwapTip) ||
        Boolean(insights.weakestLink) ||
        allWarnings.length > 0) && (
        <div
          className={`card sonar-card enter ${diagnosingMatchId ? "scanning" : ""}`}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div className="sec">防坑雷达 · 弹性保本 · 省钱动作</div>

          <BridgeCandidatesCard
            showBridgeFinder={showBridgeFinder}
            bridgeCandidates={bridgeCandidates}
            compact
            previewBridgeCandidate={(c) => betCtrl.previewBridgeCandidate(c)}
            onApplyBridgeCandidate={onApplyBridgeCandidate}
          />

          {effectiveReport.underwaterCount > 0 &&
            typeof breakevenTargetCost === "number" && (
              <div className="note-box">
                <strong>✨ 弹性全保本升级方案：</strong>受 2 元整数倍影响，当前
                ¥{effectiveReport.totalCost} 存在{" "}
                {effectiveReport.underwaterCount} 种局部回血（低于总本金）；
                {breakevenTargetCost > effectiveReport.totalCost
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
                    {breakevenTargetCost > effectiveReport.totalCost
                      ? `⚡ 一键加至最低保本门槛 ¥${breakevenTargetCost}`
                      : "⚖️ 原预算内一键配平 0 假中奖"}
                  </button>
                </div>
              </div>
            )}

          {(Boolean(effectiveReport.syntheticHint) ||
            isSingleNonSingleContext) && (
            <div className="note-box">
              <strong>
                {appliedPlan
                  ? "⚖️ 智能分倍摘要："
                  : effectiveReport.syntheticAutoMounted
                    ? "🛡️ 自动配平合成单关："
                    : "💡 合成单关参谋："}
              </strong>
              {effectiveReport.syntheticHint}
              {isSyntheticPlayable && (
                <SyntheticModePills
                  mode={syntheticSingleMode}
                  canTrim2Way={canTrimSynthetic2Way}
                  hasInherentBlindSpot={hasSyntheticInherentBlindSpot}
                  partialPreview={playabilityGates.partialCoveragePreview}
                  containerClassName="syn-mode-pills num"
                  onSelect={onSwitchSyntheticMode}
                />
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

      <div className="card enter">
        <div
          className="sec-lbl"
          style={{ margin: "0 0 8px", flexWrap: "wrap", gap: 6 }}
        >
          <span>全赛果组合盈亏推演明细 · 共 {scenarioRows.length} 组</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(
              [
                ["loss-first", "亏损/回血优先"],
                ["prob-first", "高概率优先"],
                ["profit-first", "高盈利优先"],
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

        <div className="combo-list num">
          {scenarioRows.map((c) => {
            const isExpanded = c.expandable && Boolean(expandedComboIds[c.id]);
            const cardLegs = Array.isArray(c.legs) ? c.legs : [];
            return (
              <div
                key={c.id}
                className={`combo-card sdrawer ${isExpanded ? "open" : ""} ${c.isUnderwater || c.isZeroWipeoutRow ? "uw" : ""}`}
                style={!c.expandable ? { cursor: "default" } : undefined}
                onClick={() => {
                  if (c.expandable && !c.isZeroWipeoutRow) {
                    haptic(4);
                    setExpandedComboIds((prev) => ({
                      ...prev,
                      [c.id]: !prev[c.id],
                    }));
                  }
                }}
              >
                <div className="combo-card-top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="small"
                      style={{
                        margin: "0 0 4px",
                        fontWeight: 600,
                        color: c.isZeroWipeoutRow
                          ? "var(--live)"
                          : "var(--text)",
                      }}
                    >
                      {c.scenarioLabel}
                      {c.winningTicketCount > 0
                        ? ` · 命中 ${c.winningTicketCount} 张实票`
                        : c.isZeroWipeoutRow
                          ? " · 0 张实票命中"
                          : ""}
                    </div>
                    <div className="combo-legs">
                      {cardLegs.length > 0 ? (
                        cardLegs.map((lg, lIdx) => (
                          <span
                            key={`${c.id}-${lg.matchId}-${lg.poolCode}-${lg.optionKey}-${lIdx}`}
                            className="combo-leg-chip"
                          >
                            <b>
                              {lg.matchNumStr
                                ? `${lg.matchNumStr.slice(-3)} `
                                : ""}
                              {lg.home}
                            </b>
                            <span>
                              {lg.poolName}[{lg.optionLabel}]
                            </span>
                            <i>@{lg.odds.toFixed(2)}</i>
                          </span>
                        ))
                      ) : (
                        <span className="combo-leg-chip">{c.desc}</span>
                      )}
                    </div>
                  </div>
                  <div
                    className={`cpnl ${c.isZeroWipeoutRow || c.isUnderwater || c.netProfit < 0 ? "neg" : "pos"}`}
                    style={{ flexShrink: 0, textAlign: "right" }}
                  >
                    {c.netProfit >= 0
                      ? `+¥${c.netProfit.toFixed(2)}`
                      : `-¥${Math.abs(c.netProfit).toFixed(2)}`}
                    <small>{c.statusBadgeText}</small>
                  </div>
                </div>

                <div className="combo-pnl-bar">
                  <i
                    className={c.barTone}
                    style={{ width: `${c.barFillPct}%` }}
                  />
                </div>

                <div className="combo-meta-row">
                  <span>
                    发生真率 <b>{c.probText}</b> ·{" "}
                    {c.isZeroWipeoutRow ? (
                      <>
                        实派 <b>¥0.00</b>
                      </>
                    ) : (
                      <>
                        单倍 ¥{c.unitPayout.toFixed(2)} · 实派{" "}
                        <b>¥{c.totalPayout.toFixed(2)}</b>
                      </>
                    )}
                  </span>
                  {c.expandable && (
                    <span style={{ color: "var(--mark)", fontWeight: 600 }}>
                      查看中奖实票明细 {isExpanded ? "▴" : "▾"}
                    </span>
                  )}
                </div>

                {c.expandable && (
                  <div className="sdrawer-body">
                    <div className="sdrawer-inner">
                      <div className="combo-tickets-box">
                        {c.winningTickets.map((tk) => (
                          <div
                            key={`${c.id}-tk-${tk.id}-${tk.ticketNo}`}
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

      <SpringCollapseDrawer
        defaultOpen={
          insights.hedge.available ||
          subjectiveDeltaPct !== 0 ||
          simVoidFirstMatch
        }
        title={hedgeCopy.drawerTitle}
        summary={hedgeCopy.drawerSummary}
        badge={
          hedgeCopy.badgeTone === "warn" ? (
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
              min={SUBJECTIVE_SLIDER_BOUNDS.min}
              max={SUBJECTIVE_SLIDER_BOUNDS.max}
              step={SUBJECTIVE_SLIDER_BOUNDS.step}
              value={subjectiveDeltaPct}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (next !== subjectiveDeltaPct) {
                  playTactileCue(next === 0 ? "detent-zero" : "detent-tick");
                  onChangeSubjectiveDeltaPct(next);
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
              onChange={onChangeSimVoidFirstMatch}
            />
          </div>
        </div>
      </SpringCollapseDrawer>

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
            <div className="num big">¥{effectiveReport.totalCost}</div>
            <div className="num small">
              物理实票 {effectiveTicketOrBetCount} 注 · 合票{" "}
              {effectiveReport.consolidatedTickets} 张可核对
            </div>
          </div>
          <button
            type="button"
            className="key dark wide2"
            disabled={!effectiveReport.canCheckout}
            style={{ opacity: effectiveReport.canCheckout ? 1 : 0.45 }}
            onClick={onOpenPoster}
          >
            🧾 防错打票单
          </button>
        </div>
        <div className="two">
          <button
            type="button"
            className="key"
            data-spring="0.9"
            onClick={() => onRecordToLedger("paper")}
          >
            存 0 成本模拟单
          </button>
          <button
            type="button"
            className="key dark"
            data-spring="0.9"
            onClick={() => onRecordToLedger("live")}
          >
            记入实买真金账本
          </button>
        </div>
      </div>
    </>
  );
}
