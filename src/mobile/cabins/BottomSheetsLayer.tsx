import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { ManualSectionId } from "../../manual/UserManualModal.tsx";
import type {
  EquivalentArbItem,
  MatchItem,
  PoolCode,
} from "../../prototype/quantTypes.ts";
import {
  SKINS,
  bindTilt,
  haptic,
  popStagger,
  showSpringToast,
} from "../../spring/engine.ts";
import {
  SKIN_PHYSICS_PROFILES,
  burstCelebrationSparks,
  getTactileState,
  playTactileCue,
  runHyperDemoShowcase,
  updateTactileState,
  type HapticIntensity,
} from "../../spring/tactileSymphony.ts";
import {
  SpringProbBar,
  SpringSegmented,
  SpringSheet,
  SpringSwitch,
  TeamCrest,
  kickElement,
  useModalFocusTrap,
} from "../../spring/widgets.tsx";
import type {
  StopLossInterceptPrompt,
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import type { BankerConfirmPromptState } from "./useShellChoreography.ts";
import {
  renderCompactDeltaBadge,
  renderTrendArrow,
} from "./MatchRadarCabin.tsx";
import {
  buildMatchDualAxisDrawerViewModel,
  buildPosterSlipRows,
  formatPaceCorrelationTileLabel,
  type SheetState,
} from "./cabinViewModels.ts";

function DualAxisMovementSection({ match }: { match: MatchItem }) {
  const vm = buildMatchDualAxisDrawerViewModel(match);
  if (vm.pools.length === 0) return null;
  return (
    <div className="dual-axis-card num">
      <div className="da-card-top">
        <b>📊 {vm.sectionTitle}</b>
        <span>{vm.sectionSubtitle}</span>
      </div>
      {vm.pools.map((pool) => (
        <div key={pool.poolCode} className="da-pool">
          <div className="da-pool-head">
            <div className="da-pool-title">
              <strong>{pool.poolTitle}</strong>
              {pool.goalLineSegmentLabel && (
                <em className="da-seg-tag">{pool.goalLineSegmentLabel}</em>
              )}
            </div>
            <span
              className={`qpill ${
                pool.baselineSource === "official-archive-open"
                  ? "hi"
                  : pool.baselineSource === "local-first-seen"
                    ? "warn"
                    : ""
              }`}
              style={{ flexShrink: 0 }}
            >
              {pool.baselineBadgeText}
            </span>
          </div>
          {pool.sameDirectionWarningText && (
            <div className="da-same-dir-warn">
              {pool.sameDirectionWarningText}
            </div>
          )}
          <div className="da-col-hdr">
            <span>选项(真率)</span>
            <span>{vm.axis1Header}</span>
            <span>{vm.axis2Header}</span>
          </div>
          {pool.rows.map((row) => (
            <div key={row.optionKey} className="da-row">
              <div className="da-opt">
                <b>{row.optionLabel}</b>
                <small>{row.fairProbText}</small>
              </div>
              <div className={`da-col ${row.axis1Tone}`}>
                <b>{row.axis1ValueText}</b>
                <small>{row.axis1SubText}</small>
              </div>
              <div
                className={`da-col ${
                  row.axis2Direction === 1
                    ? "up"
                    : row.axis2Direction === -1
                      ? "dn"
                      : "neutral"
                }`}
              >
                <b>{row.axis2ValueText}</b>
                <small>{row.axis2TimeText}</small>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

type TactileConfigState = ReturnType<typeof getTactileState>;

export function HoneypotTrapLink() {
  return (
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
}

export function BankerConfirmModal({
  prompt,
  onConfirm,
  onDismiss,
}: {
  prompt: BankerConfirmPromptState | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(Boolean(prompt), dialogRef, onDismiss);

  if (!prompt) return null;
  return (
    <div className="manual-backdrop" onClick={onDismiss}>
      <div
        ref={dialogRef}
        className="guardrail-dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="设胆过关阶数变更确认"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="guardrail-head">
          <b>📌 设胆过关变更预览确认</b>
          <button type="button" className="key mini" onClick={onDismiss}>
            取消
          </button>
        </div>
        <div className="note-box num">{prompt.promptText}</div>
        <div className="two">
          <button type="button" className="key dark num" onClick={onConfirm}>
            确认改为 {prompt.afterLabel} (¥{prompt.afterCost})
          </button>
          <button type="button" className="key" onClick={onDismiss}>
            保留原 {prompt.beforeLabel} (¥{prompt.beforeCost})
          </button>
        </div>
      </div>
    </div>
  );
}

export function StopLossInterceptModal({
  stopLossPrompt,
  ledgerBusy,
  onConvertPaper,
  onForceLive,
  liveBlocked,
  onDismiss,
}: {
  stopLossPrompt: StopLossInterceptPrompt | null;
  ledgerBusy: boolean;
  onConvertPaper: () => void;
  onForceLive: () => void;
  liveBlocked: boolean;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(Boolean(stopLossPrompt), dialogRef, onDismiss);

  if (!stopLossPrompt) return null;
  return (
    <div className="manual-backdrop" onClick={onDismiss}>
      <div
        ref={dialogRef}
        className="guardrail-dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="每日止损护栏超限预警"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="guardrail-head">
          <b>🛑 每日止损护栏超限预警</b>
          <button type="button" className="key mini" onClick={onDismiss}>
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
          onClick={onConvertPaper}
        >
          🛡️ 一键转为 0 成本模拟观察单（防上头推荐）
        </button>
        <div className="two">
          <button
            type="button"
            className="key"
            disabled={ledgerBusy || liveBlocked}
            onClick={onForceLive}
          >
            ⚠️ 确认超限，仍记入实买
          </button>
          <button
            type="button"
            className="key"
            disabled={ledgerBusy}
            onClick={onDismiss}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export function BottomSheetsLayer({
  wbCtrl,
  snap,
  layerRef,
  demoTargetRef,
  demoCockpitRef,
  sheet,
  onCloseSheet,
  leagueFilter,
  onToggleLeague,
  skin,
  onSwitchSkin,
  onOpenStage,
  tactileCfg,
  onUpdateTactileCfg,
  poolSwitchVisible,
  onDismissPoolSwitch,
  onTogglePick,
  onOpenManual,
  onApplyEquivalentSwap,
  onDiagnoseSingleMatch,
  onRecordToLedger,
}: {
  wbCtrl: WorkbenchController;
  snap: WorkbenchSnapshot;
  layerRef: RefObject<HTMLDivElement | null>;
  demoTargetRef: RefObject<HTMLElement | null>;
  demoCockpitRef: RefObject<HTMLElement | null>;
  sheet: SheetState;
  onCloseSheet: () => void;
  leagueFilter: Record<string, boolean>;
  onToggleLeague: (league: string) => void;
  skin: string;
  onSwitchSkin: (nextSkin: string) => void;
  onOpenStage?: () => void;
  tactileCfg: TactileConfigState;
  onUpdateTactileCfg: (next: TactileConfigState) => void;
  poolSwitchVisible: boolean;
  onDismissPoolSwitch: () => void;
  onTogglePick: (
    el: HTMLElement | null,
    match: MatchItem,
    poolCode: PoolCode,
    optKey: string
  ) => void;
  onOpenManual: (sec: ManualSectionId) => void;
  onApplyEquivalentSwap: (
    arb: EquivalentArbItem,
    triggerEl?: HTMLElement | null
  ) => void;
  onDiagnoseSingleMatch: (match: MatchItem) => void;
  onRecordToLedger: (kind: "live" | "paper") => void;
}) {
  const [bfGrp, setBfGrp] = useState<"win" | "draw" | "lose">("win");
  const [checkedPosterLines, setCheckedPosterLines] = useState<
    Record<string, boolean>
  >({});
  const [wechatSlipPreview, setWechatSlipPreview] = useState<string | null>(
    null
  );
  const bfGridRef = useRef<HTMLDivElement>(null);
  const betCtrl = wbCtrl.betSlip;
  const isPicked = (mId: string, pc: PoolCode, ok: string) =>
    betCtrl.isPicked(mId, pc, ok);
  const onUndoPoolSwitch = () => {
    if (betCtrl.undoLastPoolSwitch()) {
      onDismissPoolSwitch();
      haptic(8);
      playTactileCue("optimize-arpeggio");
      showSpringToast(layerRef.current, "已恢复本场原选玩法");
    }
  };
  const onToggleTicketConsolidation = (el?: HTMLElement | null) => {
    const res = betCtrl.toggleTicketConsolidation();
    if (!res.ok) return;
    kickElement(el ?? null, res.consolidated ? 2.2 : -1.2);
    playTactileCue(res.consolidated ? "optimize-arpeggio" : "tap-off");
    showSpringToast(
      layerRef.current,
      res.consolidated
        ? "🔗 已开启智能合票减张（相近倍数已聚类合并防打票滑点）"
        : "已切回精确分倍逐票明细"
    );
  };
  const formatShopkeeperWeChatSlip = () => betCtrl.formatShopkeeperWeChatSlip();

  const {
    matches,
    picks,
    planSpec,
    activeAuditedSlip,
    livePortfolioQuote,
    lastPoolSwitchUndo,
    workspace,
  } = snap.betSlipState;
  const { playabilityGates, diagnosingMatchId, ledgerBusy } = snap;
  const effectiveReport = workspace.baselineReport ?? workspace.effectiveReport;
  const allLeagues = useMemo(
    () => Array.from(new Set(matches.map((m) => m.league))),
    [matches]
  );

  const sheetMatch =
    sheet && (sheet.type === "more" || sheet.type === "intel")
      ? (matches.find((m) => m.id === sheet.matchId) ?? matches[0])
      : null;

  const { appliedPlan, activeBankerSet, shopkeeperBlockReason } =
    playabilityGates;

  const posterOpen = sheet?.type === "poster";
  const copyScope = useRef(0);
  useLayoutEffect(() => {
    setWechatSlipPreview(null);
    setCheckedPosterLines({});
    return () => {
      copyScope.current += 1;
    };
  }, [
    posterOpen,
    shopkeeperBlockReason,
    activeAuditedSlip.revision,
    livePortfolioQuote.inputSig,
  ]);
  const posterRows =
    posterOpen && !shopkeeperBlockReason
      ? buildPosterSlipRows(
          effectiveReport,
          matches,
          workspace.boardMeta,
          activeBankerSet,
          livePortfolioQuote.inputSig,
          activeAuditedSlip.physicalSlips
        )
      : [];

  const handleCopyShopkeeperSlip = async (triggerEl?: HTMLElement | null) => {
    const scope = copyScope.current;
    await betCtrl.flush();
    if (scope !== copyScope.current) return;
    const text = formatShopkeeperWeChatSlip();
    if (!text) {
      showSpringToast(layerRef.current, "当前方案暂无法生成出票口令");
      return;
    }
    let copied = false;
    const ta = document.createElement("textarea");
    try {
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      ta.remove();
    }
    if (scope !== copyScope.current || formatShopkeeperWeChatSlip() !== text)
      return;
    if (!copied && window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (scope !== copyScope.current || formatShopkeeperWeChatSlip() !== text)
      return;
    setWechatSlipPreview(copied ? null : text);
    haptic(10);
    playTactileCue("optimize-arpeggio");
    if (triggerEl) burstCelebrationSparks(triggerEl, 18);
    showSpringToast(
      layerRef.current,
      copied
        ? "📋 已复制店主微信打票口令，可直接去微信粘贴发送"
        : "📋 已展开微信打票口令文本框，可直接长按复制"
    );
  };

  const prof = SKIN_PHYSICS_PROFILES[skin] ?? SKIN_PHYSICS_PROFILES.air;

  return (
    <div ref={layerRef} className="layer">
      {poolSwitchVisible && lastPoolSwitchUndo && (
        <div className="pool-switch-toast enter num" role="status">
          <span className="pst-txt">
            已切换至{lastPoolSwitchUndo.nextPoolName}[
            {lastPoolSwitchUndo.nextOptionLabel}]（替原
            {lastPoolSwitchUndo.replacedPoolName}）
          </span>
          <button type="button" className="pst-undo" onClick={onUndoPoolSwitch}>
            ↩ 撤销切换
          </button>
        </div>
      )}

      {/* Sheet 1: 全玩法 */}
      <SpringSheet
        open={sheet?.type === "more" && Boolean(sheetMatch)}
        onClose={onCloseSheet}
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
                onClick={onCloseSheet}
              >
                确定
              </button>
            </div>

            <div className="sec num">
              总进球 · {sheetMatch.pools.TTG.single ? "单关" : "仅串关"} ·
              最高6关 (
              {sheetMatch.pools.TTG.selling !== false &&
              sheetMatch.pools.TTG.options.length > 0
                ? `返还率 ${(sheetMatch.pools.TTG.payoutRatio * 100).toFixed(1)}% · 抽水 ${(sheetMatch.pools.TTG.vig * 100).toFixed(1)}%`
                : "该玩法无有效报价"}
              )
            </div>
            {(sheetMatch.pools.TTG.selling === false ||
              sheetMatch.pools.TTG.options.length === 0) && (
              <button
                type="button"
                className="key wide unsold num"
                onClick={(e) =>
                  onTogglePick(e.currentTarget, sheetMatch, "TTG", "closed")
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
                    onTogglePick(e.currentTarget, sheetMatch, "TTG", opt.key)
                  }
                  className={`key cell num ${isPicked(sheetMatch.id, "TTG", opt.key) ? "on" : ""}`}
                >
                  <small>
                    <span>
                      {opt.label} · {(opt.fairProb * 100).toFixed(0)}%
                    </span>
                    {renderCompactDeltaBadge(opt, 0)}
                  </small>
                  <b>
                    {opt.odds.toFixed(2)}
                    {renderTrendArrow(opt.trend, opt.movement)}
                  </b>
                </button>
              ))}
            </div>

            <div className="sec num" style={{ marginTop: 16 }}>
              半全场 · {sheetMatch.pools.HAFU.single ? "单关" : "仅串关"} ·
              最高4关 (
              {sheetMatch.pools.HAFU.selling !== false &&
              sheetMatch.pools.HAFU.options.length > 0
                ? `返还率 ${(sheetMatch.pools.HAFU.payoutRatio * 100).toFixed(1)}% · 抽水 ${(sheetMatch.pools.HAFU.vig * 100).toFixed(1)}%`
                : "该玩法无有效报价"}
              )
            </div>
            {(sheetMatch.pools.HAFU.selling === false ||
              sheetMatch.pools.HAFU.options.length === 0) && (
              <button
                type="button"
                className="key wide unsold num"
                onClick={(e) =>
                  onTogglePick(e.currentTarget, sheetMatch, "HAFU", "closed")
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
                    onTogglePick(e.currentTarget, sheetMatch, "HAFU", opt.key)
                  }
                  className={`key cell num ${isPicked(sheetMatch.id, "HAFU", opt.key) ? "on" : ""}`}
                >
                  <small>
                    <span>
                      {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                    </span>
                    {renderCompactDeltaBadge(opt, 1)}
                  </small>
                  <b>
                    {opt.odds.toFixed(2)}
                    {renderTrendArrow(opt.trend, opt.movement)}
                  </b>
                </button>
              ))}
            </div>

            <div className="sec-row">
              <span className="sec num">
                比分 · {sheetMatch.pools.CRS.single ? "单关" : "仅串关"} ·
                最高4关 (
                {sheetMatch.pools.CRS.selling !== false &&
                sheetMatch.pools.CRS.options.length > 0
                  ? `抽水 ${(sheetMatch.pools.CRS.vig * 100).toFixed(1)}%`
                  : "该玩法无有效报价"}
                )
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
                  onTogglePick(e.currentTarget, sheetMatch, "CRS", "closed")
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
                      onTogglePick(e.currentTarget, sheetMatch, "CRS", opt.key)
                    }
                    className={`key cell num ${isPicked(sheetMatch.id, "CRS", opt.key) ? "on" : ""}`}
                  >
                    <small>
                      <span>
                        {opt.label} · {(opt.fairProb * 100).toFixed(1)}%
                      </span>
                      {renderCompactDeltaBadge(opt, 1)}
                    </small>
                    <b>
                      {opt.odds.toFixed(2)}
                      {renderTrendArrow(opt.trend, opt.movement)}
                    </b>
                  </button>
                ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <DualAxisMovementSection match={sheetMatch} />
            </div>
          </>
        )}
      </SpringSheet>

      {/* Sheet 2: 单场精算底牌全解剖 */}
      <SpringSheet
        open={sheet?.type === "intel" && Boolean(sheetMatch)}
        onClose={onCloseSheet}
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
                      onClick={() => onOpenManual("glossary")}
                    >
                      📘 名词图解
                    </button>
                    <button
                      type="button"
                      className="round-key"
                      style={{ width: 30, height: 30, fontSize: 12 }}
                      data-spring="0.86"
                      onClick={onCloseSheet}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <SpringProbBar probs={[hP, dP, aP]} />

                <div style={{ margin: "0 0 8px" }}>
                  <DualAxisMovementSection match={sheetMatch} />
                </div>

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
                    <b>
                      {sheetMatch.pools.HAD.selling !== false &&
                      sheetMatch.pools.HAD.options.length > 0
                        ? `主${(sheetMatch.pools.HAD.vig * 100).toFixed(1)}%`
                        : "主·该玩法无有效报价"}
                    </b>
                    <em>
                      {sheetMatch.pools.HAFU.selling !== false &&
                      sheetMatch.pools.HAFU.options.length > 0
                        ? `半全${(sheetMatch.pools.HAFU.vig * 100).toFixed(1)}%`
                        : "半全·无有效报价"}{" "}
                      ·{" "}
                      {sheetMatch.pools.TTG.selling !== false &&
                      sheetMatch.pools.TTG.options.length > 0
                        ? `进球${(sheetMatch.pools.TTG.vig * 100).toFixed(1)}%`
                        : "进球·无有效报价"}
                    </em>
                  </div>
                  <div
                    className="tile w"
                    style={{ fontFamily: "var(--font-ui)" }}
                  >
                    <span>{formatPaceCorrelationTileLabel(mq)}</span>
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
                  {mq.arbitrages.map((arb, idx) => {
                    const wholeSlipCandidates =
                      workspace.insights.wholeSlipEquivalentSwaps ??
                      (workspace.insights.activeSwapTip
                        ? [workspace.insights.activeSwapTip]
                        : []);
                    const wholeSlipArb =
                      wholeSlipCandidates.find(
                        (w) =>
                          w.matchId === sheetMatch.id &&
                          w.worsePicks.length === arb.worsePicks.length &&
                          w.worsePicks.every((wp) =>
                            arb.worsePicks.some(
                              (ap) =>
                                ap.poolCode === wp.poolCode &&
                                ap.optionKey === wp.optionKey
                            )
                          ) &&
                          w.betterPicks.length === arb.betterPicks.length &&
                          w.betterPicks.every((bp) =>
                            arb.betterPicks.some(
                              (ap) =>
                                ap.poolCode === bp.poolCode &&
                                ap.optionKey === bp.optionKey
                            )
                          )
                      ) ?? null;
                    const effectiveArb = wholeSlipArb ?? arb;
                    const swapPv = betCtrl.previewEquivalentSwap(effectiveArb);
                    const hasWorsePickedOnMatch =
                      arb.worsePicks.length > 0 &&
                      arb.worsePicks.every((wp) =>
                        picks.some(
                          (p) =>
                            p.matchId === sheetMatch.id &&
                            p.poolCode === wp.poolCode &&
                            p.optionKey === wp.optionKey
                        )
                      );
                    return (
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
                          {wholeSlipArb ? wholeSlipArb.detail : arb.detail}
                        </b>
                        <div className="note-act">
                          {Boolean(wholeSlipArb) && swapPv.ok ? (
                            <button
                              type="button"
                              data-spring="0.88"
                              className="key mini dark"
                              onClick={(e) => {
                                onApplyEquivalentSwap(
                                  effectiveArb,
                                  e.currentTarget
                                );
                                onCloseSheet();
                              }}
                            >
                              一键选用 {effectiveArb.betterChoice}
                              {wholeSlipArb?.equalStakeCostYuan
                                ? `（整单 ¥${wholeSlipArb.equalStakeCostYuan}）`
                                : ""}
                            </button>
                          ) : (
                            <span
                              style={{
                                fontSize: 11.5,
                                color: "var(--ink-2)",
                                lineHeight: 1.4,
                              }}
                            >
                              {!hasWorsePickedOnMatch
                                ? "单场跨盘参考（当前选单未勾选被替项）"
                                : swapPv.blockedReason ||
                                  "当前整单整数配平下存在少返态，仅作单场参考"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                        ? `${sheetMatch.aiAlert.summary}（消息与变价时序对照：${sheetMatch.aiAlert.priceInStatus}${sheetMatch.aiAlert.suggestedDelta ? ` · ${sheetMatch.aiAlert.suggestedDelta}` : ""} · ${sheetMatch.aiAlert.source}）`
                        : mq.steamSignal}
                    </b>
                    <div className="note-act">
                      <button
                        type="button"
                        data-spring="0.88"
                        className="key mini dark"
                        onClick={() => onDiagnoseSingleMatch(sheetMatch)}
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
        onClose={onCloseSheet}
        onAfterOpen={(sh) => bindTilt(sh.querySelector<HTMLElement>(".poster"))}
      >
        {posterOpen &&
          (shopkeeperBlockReason ? (
            <div className="card">
              <div className="sh-head">
                <b>模拟核对</b>
              </div>
              <p role="status">{shopkeeperBlockReason}。当前可按参考价模拟。</p>
              <p className="num">
                参考金额 ¥{effectiveReport.totalCost} · 实际支出 ¥0
              </p>
              <button
                type="button"
                className="key full"
                disabled={
                  ledgerBusy ||
                  !effectiveReport.canCheckout ||
                  livePortfolioQuote.isStale
                }
                onClick={() => onRecordToLedger("paper")}
              >
                🧪 存 0 成本模拟单
              </button>
              <button type="button" className="key full" onClick={onCloseSheet}>
                关闭
              </button>
            </div>
          ) : (
            <>
              <div className="poster">
                <div className="p-top">
                  <span>优竞体育内部专用 · 店面防错打票单 (点击逐行打钩)</span>
                  <span className="num">{effectiveReport.modeLabel}</span>
                </div>
                <div className="p-amt num">
                  合计应付 ¥{effectiveReport.totalCost}
                </div>
                {planSpec && appliedPlan && appliedPlan.lines.length >= 2 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                      flexWrap: "wrap",
                      padding: "0 0 8px",
                      marginBottom: 6,
                      borderBottom: "1px dashed rgba(15,23,42,0.16)",
                    }}
                  >
                    <span className="small num" style={{ margin: 0 }}>
                      店面实打约 {effectiveReport.consolidatedTickets} 张票
                      {planSpec.consolidateTickets
                        ? "（已合并相近倍数防滑点）"
                        : "（当前为逐注精确分倍）"}
                    </span>
                    <button
                      type="button"
                      data-spring="0.88"
                      className={`key mini ${planSpec.consolidateTickets ? "on" : ""}`}
                      onClick={(e) =>
                        onToggleTicketConsolidation(e.currentTarget)
                      }
                    >
                      🔗 智能合票减张
                      {planSpec.consolidateTickets ? " · 已开" : ""}
                    </button>
                  </div>
                )}

                {posterRows.map((row, _, allRows) => {
                  const done = Boolean(checkedPosterLines[row.checkKey]);
                  return (
                    <div
                      key={row.checkKey}
                      onClick={(e) => {
                        const nextDone = !done;
                        kickElement(e.currentTarget, nextDone ? 2.4 : -1.2);
                        playTactileCue(nextDone ? "ticket-stamp" : "tap-off");
                        setCheckedPosterLines((prev) => {
                          const updated = { ...prev, [row.checkKey]: nextDone };
                          if (
                            nextDone &&
                            allRows.every((r) => updated[r.checkKey])
                          ) {
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
                    {effectiveReport.isUnconditionalFloorGuaranteed
                      ? "真实保底"
                      : "命中最低"}{" "}
                    ¥{effectiveReport.minPayout.toFixed(2)} · 严格净赚{" "}
                    {(effectiveReport.objectiveStrictNetGainProb * 100).toFixed(
                      1
                    )}
                    %
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

              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <button
                  type="button"
                  className="key dark full"
                  data-spring="0.94"
                  onClick={(e) =>
                    void handleCopyShopkeeperSlip(e.currentTarget)
                  }
                >
                  📋 一键复制发店主微信口令
                </button>
                {wechatSlipPreview &&
                  wechatSlipPreview === formatShopkeeperWeChatSlip() && (
                    <textarea
                      readOnly
                      value={wechatSlipPreview}
                      rows={4}
                      onFocus={(e) => e.currentTarget.select()}
                      className="ledger-input num"
                      style={{
                        height: "auto",
                        padding: "6px 8px",
                        lineHeight: 1.4,
                        fontSize: 11,
                      }}
                    />
                  )}
                <div className="two">
                  <button
                    type="button"
                    className="key"
                    data-spring="0.92"
                    disabled={ledgerBusy}
                    onClick={() => onRecordToLedger("paper")}
                  >
                    🧪 存 0 成本模拟单
                  </button>
                  <button
                    type="button"
                    className="key dark"
                    data-spring="0.92"
                    disabled={ledgerBusy}
                    onClick={() => onRecordToLedger("live")}
                  >
                    💰 已发店主·记实买
                  </button>
                </div>
                <button
                  type="button"
                  className="key full"
                  data-spring="0.94"
                  onClick={() => onCloseSheet()}
                >
                  仅关闭打票单
                </button>
              </div>
            </>
          ))}
      </SpringSheet>

      {/* Sheet 4: 联赛筛选 */}
      <SpringSheet open={sheet?.type === "filter"} onClose={onCloseSheet}>
        <div className="sh-head">
          <span className="h2">筛选赛事联赛</span>
          <button
            type="button"
            className="key dark sm"
            data-spring="0.88"
            onClick={onCloseSheet}
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
                  onToggleLeague(lg);
                }}
                className={`key cell ${on ? "on" : ""}`}
              >
                <b>{lg}</b>
              </button>
            );
          })}
        </div>
      </SpringSheet>

      {/* Sheet 5: 外观皮肤与超感触控舱 */}
      <SpringSheet open={sheet?.type === "tactile"} onClose={onCloseSheet}>
        <div className="sh-head">
          <div>
            <span className="h2">🎨 外观皮肤与超感触控舱</span>
            <div className="small">
              8 套材质主题 × 240Hz 弹簧阻尼 × 多段震动与微声场
            </div>
          </div>
          <button
            type="button"
            className="key dark sm"
            data-spring="0.88"
            onClick={onCloseSheet}
          >
            完成
          </button>
        </div>

        <div className="sec-row" style={{ marginTop: 2 }}>
          <span className="sec">
            视觉材质皮肤（当前：{SKINS.find((s) => s.id === skin)?.name}）
          </span>
          {onOpenStage && (
            <button
              type="button"
              className="help-pill"
              onClick={() => {
                onCloseSheet();
                onOpenStage();
              }}
            >
              📱 8皮肤同屏墙
            </button>
          )}
        </div>
        <div
          className="card skins"
          style={{ marginBottom: 12, padding: "12px 8px" }}
        >
          {SKINS.map((sk) => (
            <button
              key={sk.id}
              type="button"
              data-spring="0.86"
              onClick={(e) => {
                kickElement(e.currentTarget, 2.8);
                onSwitchSkin(sk.id);
              }}
              className={`sk ${sk.id === skin ? "on" : ""}`}
            >
              <i
                style={
                  {
                    background: sk.swatchBg,
                    "--sw-dot": sk.swatchDot,
                  } as CSSProperties
                }
              />
              <span>{sk.name}</span>
            </button>
          ))}
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
                onUpdateTactileCfg(next);
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
                onUpdateTactileCfg(next);
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
                {prof.feelDesc} · 震动序列 [{prof.pressPattern.join("ms, ")}ms]
                · 基频 {prof.baseFreqHz}Hz
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          data-spring="0.92"
          className="key dark full"
          onClick={(e) => {
            runHyperDemoShowcase(
              e.currentTarget,
              demoTargetRef.current ?? e.currentTarget,
              demoCockpitRef.current
            );
            showSpringToast(
              layerRef.current,
              "🎆 已触发：抛物线双连弹 + 琶音扫频 + 360°流光礼花"
            );
          }}
        >
          🎆 一键试玩全套超感震动连招演示
        </button>
      </SpringSheet>
    </div>
  );
}
