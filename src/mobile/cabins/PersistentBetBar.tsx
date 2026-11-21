import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { ManualSectionId } from "../../manual/UserManualModal.tsx";
import type {
  BridgeMatchCandidate,
  SyntheticSingleMode,
} from "../../prototype/quantTypes.ts";
import { fxOf, haptic } from "../../spring/engine.ts";
import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import { BridgeCandidatesCard } from "./MatchRadarCabin.tsx";
import {
  KEYPAD_MULTIPLIER_PRESETS,
  buildSyntheticModePillSpecs,
  resolveCompactAuditBarPrimaryAction,
  type AppTab,
  type BarPopoverKind,
} from "./cabinViewModels.ts";

export function SyncRefreshSvg({
  spinning,
  size = 14,
}: {
  spinning: boolean;
  size?: number;
}) {
  return (
    <svg
      className={spinning ? "spin" : ""}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-15.5-6.36L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15.5 6.36L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

export function MobileBottomDock({
  navRef,
  puckRef,
  tab,
  hasAuditDot,
  embedded,
  onSelectTab,
}: {
  navRef: RefObject<HTMLElement | null>;
  puckRef: RefObject<HTMLDivElement | null>;
  tab: AppTab;
  hasAuditDot: boolean;
  embedded: boolean;
  onSelectTab: (next: AppTab) => void;
}) {
  const items = [
    [
      "match",
      "赛事雷达",
      <>
        <rect x="3" y="4" width="18" height="16" rx="2.5" />
        <line x1="12" y1="4" x2="12" y2="20" />
        <circle cx="12" cy="12" r="2.8" />
      </>,
      false,
    ],
    [
      "archetypes",
      "精算配单",
      <polygon key="p" points="12 2 19 21 12 17 5 21 12 2" />,
      false,
    ],
    [
      "audit",
      "审单锁利",
      <path key="u" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
      hasAuditDot,
    ],
    [
      "ledger",
      "情报账本",
      <>
        <circle cx="12" cy="8" r="3.8" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>,
      false,
    ],
  ] as const;

  return (
    <div className="dock">
      <nav ref={navRef} className="nav">
        <div ref={puckRef} className="nav-puck" />
        {items.map(([k, label, iconNodes, hasDot]) => (
          <button
            key={k}
            type="button"
            data-spring="0.9"
            onClick={(e) => {
              const ico =
                e.currentTarget.querySelector<HTMLElement>(".nav-ico");
              if (ico) fxOf(ico).scale.config(520, 11).kick(4.2);
              haptic(6);
              onSelectTab(k);
            }}
            className={`nav-b ${tab === k ? "on" : ""}`}
          >
            <span className="nav-ico">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {iconNodes}
              </svg>
              {hasDot && <i className="nav-dot" />}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {embedded && (
        <div className="home-ind">
          <i />
        </div>
      )}
    </div>
  );
}

export function DesktopCommandHeader({
  visibleMatchCount,
  syncClock,
  syncing,
  isSuperAdmin,
  stepFlowNode,
  onSync,
  onOpenTactile,
  onOpenManual,
  onOpenAdmin,
}: {
  visibleMatchCount: number;
  syncClock: string;
  syncing: boolean;
  isSuperAdmin: boolean;
  stepFlowNode: React.ReactNode;
  onSync: () => void;
  onOpenTactile: () => void;
  onOpenManual: () => void;
  onOpenAdmin: () => void;
}) {
  return (
    <header className="dk-topbar">
      <div className="dk-brand">
        <div className="dk-brand-mark">优竞</div>
        <div>
          <h1>优竞体育内部专用</h1>
          <p className="num">
            智能精算与风控工作台 · 实盘 {visibleMatchCount} 场 · 同步{" "}
            {syncClock}
          </p>
        </div>
      </div>
      {stepFlowNode}
      <div className="dk-actions">
        <button
          type="button"
          data-spring="0.9"
          className="key sm"
          onClick={onSync}
        >
          <SyncRefreshSvg spinning={syncing} size={14} />
          <span>同步水位</span>
        </button>
        <button
          type="button"
          data-spring="0.9"
          className="key sm"
          onClick={onOpenTactile}
          title="切换 8 套皮肤材质、调节震动与微声场"
        >
          🎨 外观与触感
        </button>
        <button
          type="button"
          data-spring="0.9"
          className="key sm dark"
          onClick={onOpenManual}
        >
          📘 图文说明书
        </button>
        {isSuperAdmin && (
          <button
            type="button"
            data-spring="0.9"
            className="key sm dark"
            onClick={onOpenAdmin}
            title="超级管理员专属隐形总控台"
          >
            👑 总控台
          </button>
        )}
      </div>
    </header>
  );
}

export function MobileCompactTopBar({
  tab,
  visibleMatchCount,
  syncClock,
  syncing,
  isSuperAdmin,
  onOpenTactile,
  onOpenManual,
  onOpenAdmin,
  onSync,
  onOpenFilter,
}: {
  tab: AppTab;
  visibleMatchCount: number;
  syncClock: string;
  syncing: boolean;
  isSuperAdmin: boolean;
  onOpenTactile: () => void;
  onOpenManual: (sec: ManualSectionId) => void;
  onOpenAdmin: () => void;
  onSync: () => void;
  onOpenFilter: () => void;
}) {
  return (
    <div className="title-row">
      <div style={{ minWidth: 0 }}>
        <span className="h1">优竞体育内部专用</span>
        <span className="sub num">
          {tab === "match"
            ? `实盘 ${visibleMatchCount} 场 · 同步 ${syncClock.slice(0, 5)}`
            : tab === "archetypes"
              ? "五池闭合校准 · 3+1 帕累托精算配单"
              : tab === "audit"
                ? "五维审单 · 智能分倍 · 锁利核对"
                : "精算×情报协同会诊 · 双轨止损账本"}
        </span>
      </div>
      <div className="hdr-acts">
        <button
          type="button"
          className="key mini"
          data-spring="0.88"
          title="外观皮肤与超感触控"
          onClick={onOpenTactile}
        >
          🎨
        </button>
        <button
          type="button"
          className="key mini dark"
          data-spring="0.88"
          onClick={() =>
            onOpenManual(
              tab === "archetypes"
                ? "archetypes"
                : tab === "audit"
                  ? "optimizer"
                  : tab === "ledger"
                    ? "xiaogao"
                    : "sandbox"
            )
          }
        >
          📘手册
        </button>
        {isSuperAdmin && (
          <button
            type="button"
            className="key mini dark"
            data-spring="0.88"
            onClick={onOpenAdmin}
          >
            👑
          </button>
        )}
        {(tab === "match" || tab === "ledger") && (
          <button
            type="button"
            className="round-key"
            style={{ width: 28, height: 28 }}
            data-spring="0.86"
            title="手动同步中国体彩官网水位"
            onClick={onSync}
          >
            <SyncRefreshSvg spinning={syncing} size={13} />
          </button>
        )}
        {tab === "match" && (
          <button
            type="button"
            className="round-key"
            style={{ width: 28, height: 28 }}
            data-spring="0.86"
            title="筛选联赛"
            onClick={onOpenFilter}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="10" y1="17" x2="14" y2="17" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export function StepFlowBar({
  compactMobile,
  isDesktop,
  tab,
  dkFocusStep,
  pickedMatchCount,
  hasAppliedPlan,
  canCheckoutNonEmpty,
  onSelectStep,
}: {
  compactMobile: boolean;
  isDesktop: boolean;
  tab: AppTab;
  dkFocusStep: 1 | 2 | 3 | null;
  pickedMatchCount: number;
  hasAppliedPlan: boolean;
  canCheckoutNonEmpty: boolean;
  onSelectStep: (step: 1 | 2 | 3) => void;
}) {
  const step1Done = pickedMatchCount > 0;
  const step2Done = hasAppliedPlan;
  const step3Done = canCheckoutNonEmpty;
  const autoStep: 1 | 2 | 3 = step2Done ? 3 : step1Done ? 2 : 1;
  const activeStep = isDesktop
    ? (dkFocusStep ?? autoStep)
    : tab === "archetypes"
      ? 2
      : tab === "audit"
        ? 3
        : 1;
  return (
    <div className="step-flow-bar num" aria-label="1-2-3三步精算向导">
      <button
        type="button"
        className={`step-node ${activeStep === 1 ? "active" : step1Done ? "done" : ""}`}
        onClick={() => onSelectStep(1)}
      >
        <span className="step-badge-num">{step1Done ? "✓" : "1"}</span>
        <span>
          {compactMobile
            ? `选球${step1Done ? `(${pickedMatchCount})` : ""}`
            : `选球定方向${step1Done ? ` (${pickedMatchCount}场)` : ""}`}
        </span>
      </button>
      <button
        type="button"
        className={`step-node ${activeStep === 2 ? "active" : step2Done ? "done" : ""}`}
        onClick={() => onSelectStep(2)}
      >
        <span className="step-badge-num">{step2Done ? "✓" : "2"}</span>
        <span>{compactMobile ? "精算配单" : "3+1精算配单"}</span>
      </button>
      <button
        type="button"
        className={`step-node ${activeStep === 3 ? "active" : step3Done ? "done" : ""}`}
        onClick={() => onSelectStep(3)}
      >
        <span className="step-badge-num">{step3Done ? "✓" : "3"}</span>
        <span>{compactMobile ? "审单锁利" : "审单锁利打票"}</span>
      </button>
    </div>
  );
}

export function SyntheticModePills({
  mode,
  canTrim2Way,
  hasInherentBlindSpot = false,
  compactMobile = false,
  containerClassName,
  containerStyle,
  onSelect,
}: {
  mode: SyntheticSingleMode;
  canTrim2Way: boolean;
  hasInherentBlindSpot?: boolean;
  compactMobile?: boolean;
  containerClassName?: string;
  containerStyle?: CSSProperties;
  onSelect: (nextMode: SyntheticSingleMode) => void;
}) {
  const pillSpecs = buildSyntheticModePillSpecs(
    canTrim2Way,
    hasInherentBlindSpot,
    compactMobile
  );
  const pillClass = (target: SyntheticSingleMode) =>
    compactMobile
      ? `m-bet-pill ${mode === target ? "hi" : ""}`
      : `key mini ${mode === target ? "on" : ""}`;
  const springAttr = compactMobile ? undefined : "0.88";

  return (
    <div className={containerClassName} style={containerStyle}>
      {pillSpecs.map((spec) => (
        <button
          key={spec.mode}
          type="button"
          data-spring={springAttr}
          className={pillClass(spec.mode)}
          onClick={() => onSelect(spec.mode)}
        >
          {spec.label}
        </button>
      ))}
    </div>
  );
}

export function PersistentBetBar({
  variant,
  tab,
  slipRef,
  slipAmtRef,
  wbCtrl,
  snap,
  notifyToast,
  onToggleBankerMatch,
  onRestoreEqualMultiple,
  onSwitchSyntheticMode,
  onApplyBridgeCandidate,
  onOpenPoster,
  onSwitchTab,
}: {
  variant: "desktop" | "mobile";
  tab: AppTab;
  slipRef: RefObject<HTMLElement | null>;
  slipAmtRef: RefObject<HTMLElement | null>;
  wbCtrl: WorkbenchController;
  snap: WorkbenchSnapshot;
  notifyToast: (msg: string) => void;
  onToggleBankerMatch: (
    matchId: string,
    homeName: string,
    triggerEl?: HTMLElement | null
  ) => void;
  onRestoreEqualMultiple: () => void;
  onSwitchSyntheticMode: (next: SyntheticSingleMode) => void;
  onApplyBridgeCandidate: (
    cand: BridgeMatchCandidate,
    triggerEl?: HTMLElement | null
  ) => void;
  onOpenPoster: () => void;
  onSwitchTab: (next: AppTab) => void;
}) {
  const [barPopover, setBarPopover] = useState<BarPopoverKind>(null);
  const [keypadFresh, setKeypadFresh] = useState(true);
  const betCtrl = wbCtrl.betSlip;
  const onClearPicks = () => betCtrl.clearPicks();
  const onResetPassAuto = () => betCtrl.resetPassAuto();
  const onToggleFreePassSize = (sz: number) => {
    const res = betCtrl.toggleFreePassSize(sz);
    if (!res.ok) {
      haptic(12);
      notifyToast(res.reason || "当前选单不满足该过关条件");
    } else haptic(6);
  };
  const onSelectComboPass = (code: string) => {
    const res = betCtrl.selectComboPass(code);
    if (!res.ok) {
      haptic(12);
      notifyToast(res.reason || "当前选单不可选该多串组合");
    } else haptic(7);
  };
  const onRemoveMatchFromSlip = (mid: string) =>
    betCtrl.removeMatchFromSlip(mid);
  const onStepMultiple = (delta: number) => {
    betCtrl.stepMultiple(delta);
    haptic(5);
  };
  const onApplyDirectMultiple = (next: number) => {
    betCtrl.setDirectMultiple(next);
    haptic(4);
  };
  const onScaleAppliedPlan = (factor: number) => {
    betCtrl.scaleAppliedPlanBy(factor);
    haptic(8);
    notifyToast(`智能分倍方案已扩倍 ×${factor}`);
  };
  const onRequirePickToast = () => notifyToast("请先在列表点选至少 1 场球队");

  const { picks, multiple, syntheticSingleMode, workspace } = snap.betSlipState;
  const playabilityGates = snap.playabilityGates;
  const manualReport = workspace.manualReport;
  const effectiveReport = workspace.effectiveReport;
  const bridgeCandidates = workspace.insights.bridgeCandidates ?? [];
  const pickedMatchIds = useMemo(
    () => Array.from(new Set(picks.map((p) => p.matchId))),
    [picks]
  );

  useEffect(() => {
    setBarPopover(null);
  }, [tab, variant]);

  const {
    appliedPlan,
    isSyntheticPlayable,
    canTrimSynthetic2Way,
    hasSyntheticInherentBlindSpot,
    showBridgeFinder,
    canToggleBanker,
    activeBankerSet,
  } = playabilityGates;

  const isDesktop = variant === "desktop";
  const hideMobileBetBar = tab === "archetypes" || tab === "ledger";
  const isCompactMobileBar = tab === "audit";

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
                    onResetPassAuto();
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
                  onClick={() => onToggleFreePassSize(fp.size)}
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

            {canToggleBanker && (
              <>
                <div className="sec" style={{ marginTop: 10 }}>
                  📌 胆拖定胆（点亮必出稳胆，一键砍掉不含稳胆的废票）
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {pickedMatchIds.map((mid) => {
                    const f = picks.find((p) => p.matchId === mid);
                    if (!f) return null;
                    const on = activeBankerSet.has(mid);
                    return (
                      <button
                        key={`pass-banker-${mid}`}
                        type="button"
                        data-spring="0.88"
                        className={`key mini num ${on ? "on" : ""}`}
                        onClick={(e) =>
                          onToggleBankerMatch(mid, f.home, e.currentTarget)
                        }
                      >
                        {on ? "📌胆 · " : "📌设胆 · "}
                        {f.matchNumStr.slice(-3)} {f.home}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

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
                    onClick={() => onSelectComboPass(cp.code)}
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
              {KEYPAD_MULTIPLIER_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onApplyDirectMultiple(preset);
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
                    onApplyDirectMultiple(Math.max(1, next));
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
                  onApplyDirectMultiple(1);
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
                    onApplyDirectMultiple(1);
                  } else {
                    onApplyDirectMultiple(
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
                  onApplyDirectMultiple(next >= 1 ? next : 1);
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
                      onClearPicks();
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
                      <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                        {canToggleBanker && (
                          <button
                            type="button"
                            className={`key mini ${activeBankerSet.has(mid) ? "on" : ""}`}
                            onClick={(e) =>
                              onToggleBankerMatch(mid, f.home, e.currentTarget)
                            }
                          >
                            {activeBankerSet.has(mid) ? "📌胆" : "📌设胆"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="key mini"
                          onClick={() => onRemoveMatchFromSlip(mid)}
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  );
                })}
                <BridgeCandidatesCard
                  showBridgeFinder={showBridgeFinder}
                  bridgeCandidates={bridgeCandidates}
                  compact
                  onApplyBridgeCandidate={onApplyBridgeCandidate}
                />
              </div>
            )}
          </>
        )}
      </div>
    </>
  ) : null;

  if (isDesktop) {
    return (
      <>
        <footer ref={slipRef as RefObject<HTMLElement>} className="dk-betdock">
          {isSyntheticPlayable && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                padding: "6px 14px",
                borderBottom: "0.5px solid var(--line)",
              }}
            >
              <span
                className="small num"
                style={{ margin: 0, fontWeight: 600 }}
              >
                🛡️ 单场未开单关 · 自动合成单关模式（选满第 2
                场自动恢复原盘串关）：
              </span>
              <SyntheticModePills
                mode={syntheticSingleMode}
                canTrim2Way={canTrimSynthetic2Way}
                hasInherentBlindSpot={hasSyntheticInherentBlindSpot}
                containerStyle={{ display: "flex", gap: 6, flexWrap: "wrap" }}
                onSelect={onSwitchSyntheticMode}
              />
            </div>
          )}
          {showBridgeFinder && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
                padding: "6px 14px",
                borderBottom: "0.5px solid var(--line)",
              }}
            >
              <span
                className="small num"
                style={{ margin: 0, fontWeight: 600 }}
              >
                🌉 过桥配菜搭子精选：
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {bridgeCandidates.map((cand) => (
                  <button
                    key={`dk-br-${cand.kind}-${cand.matchId}-${cand.poolCode}-${cand.optionKey}`}
                    type="button"
                    data-spring="0.88"
                    className="key mini dark num"
                    onClick={(e) =>
                      onApplyBridgeCandidate(cand, e.currentTarget)
                    }
                  >
                    {cand.kind === "lowest-vig" ? "🛡️最低抽水" : "⏰时间差锁利"}{" "}
                    · {cand.matchNumStr.slice(-3)}
                    {cand.home}[{cand.optionLabel}@{cand.odds.toFixed(2)}]
                    一键搭上
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="dk-betdock-inner">
            <div className="dk-bet-left">
              <button
                type="button"
                className="key sm"
                disabled={picks.length === 0}
                style={{ opacity: picks.length === 0 ? 0.45 : 1 }}
                onClick={() => {
                  onClearPicks();
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
                  (effectiveReport.matchCount > 0 &&
                    effectiveReport.canCheckout)
                    ? "dark"
                    : ""
                }`}
                onClick={() =>
                  setBarPopover((p) => (p === "pass" ? null : "pass"))
                }
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
                    onClick={() => onScaleAppliedPlan(2)}
                  >
                    ×2倍扩仓
                  </button>
                  <button
                    type="button"
                    className="key mini"
                    onClick={onRestoreEqualMultiple}
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
                    onClick={() => onStepMultiple(-1)}
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
                    onClick={() => onStepMultiple(1)}
                  >
                    +
                  </button>
                </div>
              )}
            </div>

            <div className="dk-bet-mid num">
              <div className="dk-bet-kpi">
                <b>
                  应付{" "}
                  <span ref={slipAmtRef as RefObject<HTMLSpanElement>}>
                    ¥{effectiveReport.totalCost}
                  </span>{" "}
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
                      !effectiveReport.canCheckout &&
                      effectiveReport.matchCount > 0
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
                        ? `保底 ¥${effectiveReport.minPayout.toFixed(2)} ~ 最高 ¥${effectiveReport.maxPayout.toFixed(2)} · ⚠️ ${effectiveReport.underwaterCount}组局部回血 · 净赚率 ${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(1)}%`
                        : `真实保底 ¥${effectiveReport.minPayout.toFixed(2)} ~ 最高 ¥${effectiveReport.maxPayout.toFixed(2)} · 严格净赚 ${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(1)}%`}
                </small>
              </div>
            </div>

            <div className="dk-bet-right">
              <button
                type="button"
                className="key sm dark"
                disabled={!effectiveReport.canCheckout}
                style={{ opacity: effectiveReport.canCheckout ? 1 : 0.45 }}
                onClick={onOpenPoster}
              >
                🧾 查看实票核对单
              </button>
            </div>
          </div>
        </footer>
        {betPopoverNode}
      </>
    );
  }

  const compactPrimaryAction = resolveCompactAuditBarPrimaryAction(
    effectiveReport,
    { isSyntheticPlayable, showBridgeFinder },
    bridgeCandidates
  );

  return (
    <>
      {hideMobileBetBar ? null : isCompactMobileBar ? (
        <div
          ref={slipRef as RefObject<HTMLDivElement>}
          className="m-betbar compact num"
        >
          <button
            type="button"
            className={`m-bet-pill ${
              !effectiveReport.canCheckout && effectiveReport.matchCount > 0
                ? "warn"
                : "hi"
            }`}
            style={{
              maxWidth: 138,
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
                onClick={() => onScaleAppliedPlan(2)}
              >
                ×2倍
              </button>
              <button
                type="button"
                className="m-bet-pill"
                title="还原等倍"
                onClick={onRestoreEqualMultiple}
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
            <b ref={slipAmtRef as RefObject<HTMLElement>}>
              ¥{effectiveReport.totalCost}
            </b>
          </div>

          <button
            type="button"
            className="m-bet-go"
            style={{ flexShrink: 0 }}
            onClick={() => {
              setBarPopover(null);
              if (compactPrimaryAction.kind === "poster") {
                onOpenPoster();
              } else if (compactPrimaryAction.kind === "synthetic") {
                onSwitchSyntheticMode("full-3way");
              } else if (
                compactPrimaryAction.kind === "bridge" &&
                bridgeCandidates[0]
              ) {
                onApplyBridgeCandidate(bridgeCandidates[0]);
              } else {
                onSwitchTab("match");
              }
            }}
          >
            {compactPrimaryAction.label}
          </button>
        </div>
      ) : (
        <div
          ref={slipRef as RefObject<HTMLDivElement>}
          className="m-betbar num"
        >
          {isSyntheticPlayable && (
            <SyntheticModePills
              mode={syntheticSingleMode}
              canTrim2Way={canTrimSynthetic2Way}
              hasInherentBlindSpot={hasSyntheticInherentBlindSpot}
              compactMobile
              containerClassName="m-syn-strip"
              onSelect={onSwitchSyntheticMode}
            />
          )}
          {showBridgeFinder && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                overflowX: "auto",
                paddingBottom: 5,
                marginBottom: 4,
                borderBottom: "0.5px solid rgba(255,255,255,0.12)",
              }}
            >
              {bridgeCandidates.map((cand) => (
                <button
                  key={`mb-br-${cand.kind}-${cand.matchId}-${cand.poolCode}-${cand.optionKey}`}
                  type="button"
                  className="m-bet-pill hi"
                  style={{ flexShrink: 0 }}
                  onClick={(e) => onApplyBridgeCandidate(cand, e.currentTarget)}
                >
                  {cand.kind === "lowest-vig" ? "🛡️低抽水" : "⏰时间差"}·
                  {cand.matchNumStr.slice(-3)}
                  {cand.home}[{cand.optionLabel}@{cand.odds.toFixed(2)}]
                  一键搭上
                </button>
              ))}
            </div>
          )}
          <div className="m-betbar-r1">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
              }}
            >
              <button
                type="button"
                className="m-bet-trash"
                title="清空已选"
                onClick={() => {
                  onClearPicks();
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
                onClick={() =>
                  setBarPopover((p) => (p === "pass" ? null : "pass"))
                }
              >
                🎯{" "}
                {effectiveReport.matchCount === 0
                  ? "过关选择"
                  : effectiveReport.modeLabel}{" "}
                ▴
              </button>
              {picks.length > 0 && (
                <button
                  type="button"
                  className="m-bet-pill"
                  onClick={() => {
                    setBarPopover(null);
                    onSwitchTab("audit");
                  }}
                >
                  直审
                </button>
              )}
            </div>
            <span
              style={{ fontSize: 10.5, opacity: 0.78, whiteSpace: "nowrap" }}
            >
              {effectiveReport.betCount}注
              {effectiveReport.poolCap < 8
                ? `·限${effectiveReport.poolCap}关`
                : ""}
            </span>
          </div>

          <div className="m-betbar-r2">
            {appliedPlan ? (
              <div className="m-mul-grp">
                <span className="m-bet-pill">
                  ⚖️智能分倍(¥{effectiveReport.totalCost})
                </span>
                <button
                  type="button"
                  className="m-mul-val"
                  onClick={() => onScaleAppliedPlan(2)}
                >
                  ×2倍
                </button>
                <button
                  type="button"
                  className="m-bet-pill"
                  onClick={onRestoreEqualMultiple}
                >
                  等倍
                </button>
              </div>
            ) : (
              <div className="m-mul-grp">
                <button
                  type="button"
                  className="m-mul-step"
                  onClick={() => onStepMultiple(-1)}
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
                  onClick={() => onStepMultiple(1)}
                >
                  +
                </button>
              </div>
            )}

            <div className="m-bet-sum">
              <b ref={slipAmtRef as RefObject<HTMLElement>}>
                ¥{effectiveReport.totalCost}
              </b>
              <small>
                {effectiveReport.matchCount === 0
                  ? "第一步：点选心仪球队赔率定方向"
                  : !effectiveReport.canCheckout
                    ? effectiveReport.ruleBlockReason ||
                      "未开单关·还差1场凑2串1"
                    : effectiveReport.underwaterCount > 0
                      ? `⚠️${effectiveReport.underwaterCount}注局部回血 · 建议去②配单消坑`
                      : `保底¥${effectiveReport.minPayout.toFixed(0)}~${effectiveReport.maxPayout.toFixed(0)} · 净赚${(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(0)}%`}
              </small>
            </div>

            <button
              type="button"
              className="m-bet-go"
              onClick={() => {
                setBarPopover(null);
                if (picks.length === 0) {
                  onRequirePickToast();
                  return;
                }
                onSwitchTab("archetypes");
              }}
            >
              {picks.length === 0 ? "先选球" : "下一步:②配单 ›"}
            </button>
          </div>
        </div>
      )}
      {betPopoverNode}
    </>
  );
}
