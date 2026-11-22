import { useMemo, useState } from "react";
import type {
  ArchetypePlan,
  PortfolioKey,
  PortfolioRemediationAction,
  UserStance,
} from "../../prototype/quantTypes.ts";
import { haptic } from "../../spring/engine.ts";
import { playTactileCue } from "../../spring/tactileSymphony.ts";
import {
  SpringCollapseDrawer,
  SpringSegmented,
  SpringSwitch,
  TactileFlipCard,
  kickElement,
} from "../../spring/widgets.tsx";
import {
  buildRadarSignature,
  normalizeBudgetYuan,
} from "../../workspace/betSlipController.ts";
import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import {
  PORTFOLIO_BUDGET_PRESETS,
  PORTFOLIO_CUSTOM_BUDGET_LIMITS,
  buildAlphaRadarEmptyStateViewModel,
  buildPortfolioKpiTiles,
  buildPortfolioSlotOptions,
  formatPortfolioProbPct,
} from "./cabinViewModels.ts";

export function PortfolioBudgetHeader({
  budget,
  archKey,
  portfolioPlans,
  skin,
  onChangeBudget,
  onConfirmCustomBudget,
  onChangeArchKey,
}: {
  budget: number;
  archKey: PortfolioKey;
  portfolioPlans: ArchetypePlan[];
  skin: string;
  onChangeBudget: (nextBudget: number) => void;
  onConfirmCustomBudget: (normalizedBudget: number) => void;
  onChangeArchKey: (nextKey: PortfolioKey) => void;
}) {
  const [customBudgetOpen, setCustomBudgetOpen] = useState(false);
  const [customBudgetDraft, setCustomBudgetDraft] = useState(() =>
    String(budget)
  );
  const isPresetBudget = PORTFOLIO_BUDGET_PRESETS.includes(budget);
  const archOpts = buildPortfolioSlotOptions(portfolioPlans);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          marginBottom: customBudgetOpen ? 6 : 8,
        }}
      >
        <span className="small" style={{ margin: 0 }}>
          预算档位
        </span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {PORTFOLIO_BUDGET_PRESETS.map((b) => (
            <button
              key={b}
              type="button"
              data-spring="0.88"
              onClick={() => {
                haptic(5);
                setCustomBudgetOpen(false);
                onChangeBudget(b);
              }}
              className={`key mini num ${budget === b && !customBudgetOpen ? "on" : ""}`}
            >
              ¥{b}
            </button>
          ))}
          <button
            type="button"
            data-spring="0.88"
            onClick={() => {
              haptic(5);
              setCustomBudgetDraft(String(budget));
              setCustomBudgetOpen((v) => !v);
            }}
            className={`key mini num ${!isPresetBudget || customBudgetOpen ? "on" : ""}`}
          >
            {!isPresetBudget ? `¥${budget} ✎` : "⌨️ 自定义"}
          </button>
        </div>
      </div>
      {customBudgetOpen && (
        <div className="budget-custom-row num">
          <input
            type="number"
            min={PORTFOLIO_CUSTOM_BUDGET_LIMITS.min}
            max={PORTFOLIO_CUSTOM_BUDGET_LIMITS.max}
            step={PORTFOLIO_CUSTOM_BUDGET_LIMITS.step}
            value={customBudgetDraft}
            onChange={(e) => setCustomBudgetDraft(e.target.value)}
            onBlur={() => {
              const norm = normalizeBudgetYuan(
                Number(customBudgetDraft) || budget
              );
              onChangeBudget(norm);
              setCustomBudgetDraft(String(norm));
            }}
            placeholder="输入 ¥2~¥20,000（按¥2整数注向下对齐）"
            className="ledger-input num"
          />
          <button
            type="button"
            className="key mini dark"
            onClick={() => {
              const norm = normalizeBudgetYuan(Number(customBudgetDraft));
              onChangeBudget(norm);
              setCustomBudgetDraft(String(norm));
              setCustomBudgetOpen(false);
              haptic(6);
              onConfirmCustomBudget(norm);
            }}
          >
            确定 ¥{normalizeBudgetYuan(Number(customBudgetDraft) || budget)}
          </button>
        </div>
      )}
      <SpringSegmented
        options={archOpts}
        value={archKey}
        onChange={onChangeArchKey}
        skinKey={skin}
      />
    </>
  );
}

export function ParetoPortfolioCabin({
  wbCtrl,
  snap,
  archKey,
  notifyToast,
  onFallbackToMatchTab,
  onChangeArchKey,
  onApplyArchetype,
}: {
  wbCtrl: WorkbenchController;
  snap: WorkbenchSnapshot;
  archKey: PortfolioKey;
  notifyToast: (msg: string) => void;
  onFallbackToMatchTab: () => void;
  onChangeArchKey: (next: PortfolioKey) => void;
  onApplyArchetype: (plan: ArchetypePlan) => void;
}) {
  const [archFlipBack, setArchFlipBack] = useState(false);
  const betCtrl = wbCtrl.betSlip;
  const stanceDelta = betCtrl.getStanceDeltaSummary(archKey);
  const onSyncRadarPicks = () => {
    const res = betCtrl.syncRadarPicksToArchetypes();
    if (!res.ok) {
      haptic(12);
      notifyToast("请先在【赛事雷达】点选至少 1 场想买的球队");
      onFallbackToMatchTab();
      return;
    }
    playTactileCue("optimize-arpeggio");
    notifyToast(`已匹配赛事雷达 ${res.syncedCount} 场已选球队并锚定推荐方向`);
  };
  const onDisableRadarAnchor = () => {
    haptic(5);
    betCtrl.setAnchorToRadarPicks(false);
    notifyToast("已切换为纯盘面自由选池");
  };
  const onSelectTargetSlice = (n: number) => betCtrl.selectTargetSlice(n);
  const onToggleTargetMatch = (id: string) => betCtrl.toggleTargetMatch(id);
  const onChangeStance = (s: UserStance) => betCtrl.setStance(s);
  const onChangeUnlockFullAgg = (v: boolean) => betCtrl.setUnlockFullAgg(v);
  const onChangeAllowSaveCash = (v: boolean) => betCtrl.setAllowSaveCash(v);
  const onChangeBudget = (b: number) => betCtrl.setBudget(b);
  const onTriggerRemediationAction = (action: PortfolioRemediationAction) => {
    haptic(6);
    const res = betCtrl.applyPortfolioRemediationAction(action);
    if (!res.ok) return;
    if (action.kind === "lower-pass-preview") {
      notifyToast(
        `已解锁同方向降阶结构（${action.structureLabel || "低阶分块"}）`
      );
    } else if (action.kind === "min-feasible-budget" && res.nextBudget) {
      notifyToast(`已切换至经证明的最低可行预算 ¥${res.nextBudget}`);
    } else if (action.kind === "keep-cash") {
      notifyToast(`已保留 ¥${snap.betSlipState.budget} 本金空仓观望`);
    } else if (action.kind === "go-manual") {
      notifyToast("已保持原始手选方向，请前往审单手动区核对注倍");
    } else if (action.kind === "switch-main-pool") {
      notifyToast("已切回赛事雷达主盘视图，可改选低抽水在售主盘");
      onFallbackToMatchTab();
    }
  };
  const {
    matches,
    picks,
    targetIds,
    anchorToRadarPicks,
    syncedRadarSig,
    budget,
    stance,
    unlockFullAgg,
    allowSaveCash,
    livePortfolioQuote,
    activeAuditedSlip,
    workspace,
  } = snap.betSlipState;
  const { currentArch, fallbackValidArch, hasSuboptimalManual } =
    snap.playabilityGates;
  const manualReport = workspace.manualReport;
  const budgetMismatchMeta = activeAuditedSlip.budgetMismatchMeta;
  const onRequoteAtCurrentBudget = () => {
    haptic(7);
    if (betCtrl.requoteAppliedPlanAtCurrentBudget()) {
      playTactileCue("optimize-arpeggio");
      notifyToast(`已按当前新预算 ¥${budget} 重新配单并更新审单台`);
    } else {
      notifyToast(
        `当前新预算 ¥${budget} 下原档方案未过准入红线，已退回待选方案态`
      );
    }
  };

  const pickedMatchIds = useMemo(
    () => Array.from(new Set(picks.map((p) => p.matchId))),
    [picks]
  );
  const resolvedTargets = useMemo(() => {
    const found = matches.filter((m) => targetIds.includes(m.id));
    return found.length > 0 ? found : matches.slice(0, 2);
  }, [matches, targetIds]);
  const cappedRadarIds = pickedMatchIds.slice(0, 8);
  const isFullySyncedToRadar =
    anchorToRadarPicks &&
    cappedRadarIds.length > 0 &&
    cappedRadarIds.length === resolvedTargets.length &&
    cappedRadarIds.every((id) => resolvedTargets.some((t) => t.id === id)) &&
    buildRadarSignature(picks) === syncedRadarSig;

  if (!currentArch) return null;
  const cappedRadarCount = cappedRadarIds.length;
  const kpi = buildPortfolioKpiTiles(currentArch, { allowSaveCash });

  return (
    <>
      {budgetMismatchMeta && (
        <div
          className="card enter num"
          style={{
            marginBottom: 10,
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
                （严格净赚率仅{" "}
                {(manualReport.objectiveStrictNetGainProb * 100).toFixed(1)}%）
              </>
            )}
            ！改用下方【{fallbackValidArch.shortTab}
            】可立消假中奖，严格净赚率提升至{" "}
            <strong>
              {(
                (fallbackValidArch.objectiveStrictNetGainProb ??
                  fallbackValidArch.strictNetGainProb ??
                  fallbackValidArch.profitProb) * 100
              ).toFixed(1)}
              %
            </strong>
            。
          </div>
        </div>
      )}

      <SpringCollapseDrawer
        title={
          isFullySyncedToRadar
            ? `🎯 已自动锚定雷达已选球队 (${cappedRadarCount} 场)`
            : pickedMatchIds.length > 0 && !anchorToRadarPicks
              ? `🧭 纯盘面自由选池 (已圈 ${resolvedTargets.length}/8 场)`
              : `🎯 目标对决池 (已圈 ${resolvedTargets.length}/8 场 · 点①选球可自动锚定)`
        }
        summary={
          isFullySyncedToRadar
            ? "四档方案严格顺应你在①赛事雷达点选的方向配单；点此可切换纯盘面自由选池"
            : "点开可一键重锁①赛事雷达已选球队，或手动勾选 1~8 场目标比赛"
        }
        badge={
          <span className="qpill num">
            {isFullySyncedToRadar ? "✅ 自动联动" : "调池"}
          </span>
        }
      >
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            data-spring="0.9"
            className={`key sm num ${isFullySyncedToRadar ? "on" : "dark"}`}
            onClick={onSyncRadarPicks}
          >
            {pickedMatchIds.length === 0
              ? "🎯 去①赛事雷达选球自动锚定"
              : isFullySyncedToRadar
                ? `✅ 已锚定雷达已选（${cappedRadarCount} 场）`
                : `🎯 一键恢复锚定雷达已选（${cappedRadarCount} 场）`}
          </button>
          {anchorToRadarPicks && (
            <button
              type="button"
              data-spring="0.88"
              className="key sm"
              onClick={onDisableRadarAnchor}
            >
              纯盘面自由选池
            </button>
          )}
          {matches.length > 2 && (
            <button
              type="button"
              className="key sm num"
              onClick={() => {
                haptic(6);
                onSelectTargetSlice(8);
              }}
            >
              全选前{Math.min(8, matches.length)}场
            </button>
          )}
        </div>
        <div className="pool-scroll">
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
                  onToggleTargetMatch(m.id);
                }}
                className={`key pillk num ${on ? "on" : ""}`}
              >
                {m.matchNumStr.slice(-3)} {m.home}vs{m.away}
              </button>
            );
          })}
        </div>
      </SpringCollapseDrawer>

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
                  onChangeStance(k);
                }}
                className={`key ${stance === k ? "on" : ""}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            padding: "2px 0 8px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div className="small" style={{ margin: 0, lineHeight: 1.45 }}>
            {stanceDelta.ruleNote} <b>{stanceDelta.instantRecalcNote}</b>
          </div>
          {stance !== "objective" && stanceDelta.hasBaseline && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <span
                className={`stance-delta-pill num ${stanceDelta.deltaProfitProbPct < 0 ? "neg" : ""}`}
              >
                真赚率 Δ {stanceDelta.deltaProfitProbPct >= 0 ? "+" : ""}
                {stanceDelta.deltaProfitProbPct.toFixed(1)}%
              </span>
              <span
                className={`stance-delta-pill num ${stanceDelta.deltaEvPct < 0 ? "neg" : ""}`}
              >
                期望EV Δ {stanceDelta.deltaEvPct >= 0 ? "+" : ""}
                {stanceDelta.deltaEvPct.toFixed(1)}%
              </span>
              <span className="qpill num">
                {stanceDelta.ticketsChanged
                  ? "🔄 实票配单已随倾向联动调整"
                  : "📌 最优实票未变·仅微调概率评估"}
              </span>
            </div>
          )}
          {stanceDelta.anchorLockNote && stance !== "objective" && (
            <div
              className="small"
              style={{ margin: 0, color: "var(--mark)", fontWeight: 500 }}
            >
              🔒 {stanceDelta.anchorLockNote}
            </div>
          )}
        </div>
        {(currentArch.key === "max-ev-utility" ||
          currentArch.key === "spear-shield" ||
          currentArch.key === "goal-structure") && (
          <div className="row">
            <span className="lbl">允许留现省钱</span>
            <SpringSwitch
              checked={Boolean(allowSaveCash)}
              onChange={(nextVal) => onChangeAllowSaveCash(nextVal)}
            />
          </div>
        )}
        {(currentArch.key === "alpha-radar" ||
          currentArch.key === "value-assassin") && (
          <div className="row">
            <span className="lbl">36% 自动轻仓护本垫</span>
            <SpringSwitch
              checked={!unlockFullAgg}
              onChange={(keepSafe) => onChangeUnlockFullAgg(!keepSafe)}
            />
          </div>
        )}
      </div>

      {currentArch.available === false ? (
        currentArch.key === "alpha-radar" ||
        currentArch.key === "value-assassin" ? (
          (() => {
            const alphaEmptyVm = buildAlphaRadarEmptyStateViewModel(
              currentArch,
              budget
            );
            return (
              <>
                <div className="card enter">
                  <div className="co-head">
                    <div>
                      <div className="h2">
                        {currentArch.badge} · {currentArch.title}
                      </div>
                      <div className="small">{alphaEmptyVm.noteLead}</div>
                    </div>
                    <span className="chip num" style={{ flexShrink: 0 }}>
                      ¥0<i>省¥{currentArch.savedCash || budget}</i>
                    </span>
                  </div>
                  <div className="note-box" style={{ marginTop: 8 }}>
                    <strong>{alphaEmptyVm.noteTitle}</strong>
                    <div>{alphaEmptyVm.noteLead}</div>
                    {currentArch.reasons
                      .filter((r) => r !== currentArch.emptyReason)
                      .map((r, idx) => (
                        <div key={idx}>· {r}</div>
                      ))}
                    {alphaEmptyVm.remediationActions.map((act) => (
                      <div key={`${act.id}-detail`} style={{ marginTop: 4 }}>
                        👉 <strong>{act.label}</strong>：{act.detail}
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {alphaEmptyVm.hasRemediationActions ? (
                    alphaEmptyVm.remediationActions.map((act, idx) => (
                      <button
                        key={act.id}
                        type="button"
                        data-spring="0.92"
                        className={`key full num enter ${
                          alphaEmptyVm.isNarrowBudgetAlphaGated && idx === 0
                            ? "dark"
                            : ""
                        }`}
                        onClick={() => onTriggerRemediationAction(act)}
                      >
                        {act.label}
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="key full enter"
                      style={{ opacity: 0.55, cursor: "not-allowed" }}
                    >
                      {alphaEmptyVm.disabledButtonText}
                    </button>
                  )}
                  <button
                    type="button"
                    data-spring="0.94"
                    className={`key full enter ${
                      alphaEmptyVm.isNarrowBudgetAlphaGated ? "" : "dark"
                    }`}
                    onClick={() => {
                      haptic(6);
                      onChangeArchKey("max-profit-prob");
                    }}
                  >
                    👉 切往【① 稳健保本】主方案
                  </button>
                </div>
              </>
            );
          })()
        ) : (
          <div className="card enter">
            <div className="co-head">
              <div>
                <div className="h2">
                  {currentArch.badge} · {currentArch.title}
                </div>
                <div className="small">
                  {currentArch.emptyReason ||
                    `当前 ¥${budget}（共 ${Math.floor(budget / 2)} 注）未通过该档精算准入红线，系统拒绝硬凑高归零或假保本废单`}
                </div>
              </div>
              <span className="chip num">
                ¥0<i>省¥{currentArch.savedCash || budget}</i>
              </span>
            </div>
            <div className="note-box" style={{ marginTop: 8 }}>
              <strong>💡 诚实精算准入与可验证处方：</strong>
              {currentArch.upperBoundBlocked &&
                typeof currentArch.theoreticalStrictNetGainCeiling ===
                  "number" && (
                  <div>
                    当前所锁方向在允许结构下的理论净赚率并集上限仅{" "}
                    <strong>
                      {formatPortfolioProbPct(
                        currentArch.theoreticalStrictNetGainCeiling
                      )}
                    </strong>
                    ，盲目追加预算无法突破概率上限。
                  </div>
                )}
              {currentArch.reasons.map((r, idx) => (
                <div key={idx}>· {r}</div>
              ))}
              {Array.isArray(currentArch.remediationActions) &&
                currentArch.remediationActions.map((act) => (
                  <div key={`${act.id}-detail`} style={{ marginTop: 4 }}>
                    👉 <strong>{act.label}</strong>：{act.detail}
                  </div>
                ))}
            </div>
            {Array.isArray(currentArch.remediationActions) &&
            currentArch.remediationActions.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                {currentArch.remediationActions.map((act, idx) => (
                  <button
                    key={act.id}
                    type="button"
                    data-spring="0.92"
                    className={`key full num ${idx === 0 ? "dark" : ""}`}
                    onClick={() => onTriggerRemediationAction(act)}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="two" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="key"
                  onClick={() => {
                    onChangeArchKey(
                      currentArch.key === "max-profit-prob"
                        ? "max-ev-utility"
                        : "max-profit-prob"
                    );
                    haptic(6);
                  }}
                >
                  切往其他主方案查看
                </button>
              </div>
            )}
          </div>
        )
      ) : (
        <>
          <TactileFlipCard
            flipped={archFlipBack}
            onFlipChange={setArchFlipBack}
            flipToBackLabel={kpi.groupTicket.flipToBackLabel}
            flipToFrontLabel="↩ 返回方案核心指标"
            frontHeader={
              <div>
                <div className="h2">
                  {currentArch.badge} · {currentArch.title}
                </div>
                <div className="small">{currentArch.tagline}</div>
              </div>
            }
            backHeader={
              <div>
                <div className="h2">
                  {currentArch.shortTab} · 逐张实票构成与精算依据
                </div>
                <div className="small num">
                  共 {kpi.groupTicket.summary} · 合计 ¥{currentArch.totalCost}
                </div>
              </div>
            }
            front={
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span className="chip num">
                    {kpi.saveCashSummary ? (
                      kpi.saveCashSummary
                    ) : (
                      <>
                        实投 ¥{currentArch.totalCost}
                        {currentArch.savedCash > 0 && (
                          <i>留存¥{currentArch.savedCash}</i>
                        )}
                      </>
                    )}
                  </span>
                  {currentArch.structureBadge && (
                    <span className="qpill num">
                      {currentArch.structureBadge}
                    </span>
                  )}
                  <span
                    className={`qpill num ${(currentArch.zeroPayoutProb ?? 0) > 0.8 ? "warn" : ""}`}
                  >
                    整单归零率{" "}
                    {formatPortfolioProbPct(
                      currentArch.zeroPayoutProb ??
                        Math.max(0, 1 - currentArch.winProb)
                    )}
                    {(currentArch.key === "max-profit-prob" ||
                      currentArch.key === "iron-shield") &&
                      " · 覆盖范围内不倒贴"}
                  </span>
                  {currentArch.totalCost > budget && (
                    <span className="qpill warn num">
                      当前覆盖最少需 {currentArch.lines.length} 注 (¥
                      {currentArch.totalCost})
                    </span>
                  )}
                </div>

                <div className="tiles num">
                  <div className={`tile ${kpi.tile1.isDanger ? "danger" : ""}`}>
                    <span>{kpi.tile1.label}</span>
                    <b>{kpi.tile1.value}</b>
                    <em>{kpi.tile1.subtitle}</em>
                  </div>
                  <div className={`tile ${kpi.tile2.isDanger ? "danger" : ""}`}>
                    <span>{kpi.tile2.label}</span>
                    <b>{kpi.tile2.value}</b>
                    <em>{kpi.tile2.subtitle}</em>
                  </div>
                  <div className="tile">
                    <span>{kpi.tile3.label}</span>
                    <b>{kpi.tile3.value}</b>
                    <em>{kpi.tile3.subtitle}</em>
                  </div>
                  <div className="tile">
                    <span>{kpi.tile4.label}</span>
                    <b>{kpi.tile4.value}</b>
                    <em>{kpi.tile4.subtitle}</em>
                  </div>
                </div>
              </>
            }
            back={
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {currentArch.lines.map((line) => (
                  <div
                    key={line.id}
                    className="combo-item num"
                    style={{ alignItems: "flex-start" }}
                  >
                    <div className="cdesc">
                      <b>
                        {line.legs
                          .map(
                            (g) =>
                              `${g.home}[${g.optionLabel}@${g.odds.toFixed(2)}]`
                          )
                          .join(" × ")}
                      </b>
                      <small>
                        {line.roleLabel} · {line.modeLabel} · 真率{" "}
                        {(line.prob * 100).toFixed(1)}% · {line.multiple}倍(¥
                        {line.cost})
                      </small>
                    </div>
                    <div className={`cpnl ${line.netProfit >= 0 ? "pos" : ""}`}>
                      ¥{line.returnPayout.toFixed(2)}
                      <small>
                        {line.netProfit >= 0
                          ? `净赚 +¥${line.netProfit.toFixed(1)}`
                          : `保命回血 ¥${line.returnPayout.toFixed(0)}`}
                      </small>
                    </div>
                  </div>
                ))}

                <div className="note-box">
                  <strong>精算师推导依据：</strong>
                  {currentArch.reasons.map((r, idx) => (
                    <div key={idx}>· {r}</div>
                  ))}
                </div>
              </div>
            }
          />

          <button
            type="button"
            data-spring="0.94"
            disabled={!livePortfolioQuote.canApplyLiveQuote}
            style={
              !livePortfolioQuote.canApplyLiveQuote
                ? { opacity: 0.6, cursor: "wait" }
                : undefined
            }
            className="key dark full enter num"
            onClick={() => onApplyArchetype(currentArch)}
          >
            {!livePortfolioQuote.canApplyLiveQuote
              ? `⏳ 新报价重算中（版本锁保护）...`
              : `套用【${currentArch.shortTab}】方案并查看审单台 → ③ (¥${currentArch.totalCost})`}
          </button>
        </>
      )}
    </>
  );
}
