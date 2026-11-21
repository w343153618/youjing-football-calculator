import { useState, type RefObject } from "react";
import type { LedgerOutcomeStatus } from "../../prototype/quantTypes.ts";
import type { LedgerEntry } from "../../security/secureClient.ts";
import { haptic } from "../../spring/engine.ts";
import { playTactileCue } from "../../spring/tactileSymphony.ts";
import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import { SessionStatusCard } from "./IntelCabin.tsx";
import {
  buildLedgerEntryPresentation,
  formatLedgerStatsSummary,
} from "./cabinViewModels.ts";

export function LedgerCabin({
  wbCtrl,
  snap,
  balValRef,
  notifyToast,
  onOpenAdmin,
  onLogout,
}: {
  wbCtrl: WorkbenchController;
  snap: WorkbenchSnapshot;
  balValRef: RefObject<HTMLSpanElement | null>;
  notifyToast: (msg: string) => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}) {
  const {
    ledger,
    ledgerBusy,
    ledgerFilter,
    liveEntriesCount,
    paperEntriesCount,
    pendingEntriesCount,
    settledPaperCount,
    filteredLedgerEntries,
    undoBanner,
    authUser,
    offlineMode,
  } = snap;
  const onChangeLedgerFilter = (f: typeof ledgerFilter) =>
    wbCtrl.setLedgerFilter(f);
  const onRefreshAutoSettle = () => {
    void wbCtrl.refreshLedgerAutoSettle({ force: true }).then((res) => {
      if ((res.newlySettledCount ?? 0) > 0) {
        playTactileCue("defuse-celebrate");
        notifyToast(
          `🎉 已按体彩官方完场赛果自动结算 ${res.newlySettledCount} 笔订单`
        );
      } else if (res.ok) {
        notifyToast("已核对体彩官方最新赛果 · 待开订单暂未完场");
      } else {
        notifyToast("赛果同步繁忙，请稍后再试");
      }
    });
  };
  const onSaveDailyLimit = async (draft: string) => {
    const res = await wbCtrl.saveDailyLimit(draft);
    if (res.ok) {
      haptic(8);
      notifyToast(`已更新每日止损护栏上限 ¥${res.dailyLimit}`);
      return true;
    }
    notifyToast(res.error || "止损上限更新失败");
    return false;
  };
  const onSettleEntry = async (
    entry: LedgerEntry,
    status: LedgerOutcomeStatus,
    customReturn?: number
  ) => {
    const res = await wbCtrl.settleEntryManual(entry.id, status, customReturn);
    if (!res.ok) {
      notifyToast(res.error || "结算状态更新失败");
      return false;
    }
    haptic(10);
    const updated = res.entry?.status ?? status;
    if (updated === "won") playTactileCue("defuse-celebrate");
    const msg =
      updated === "pending"
        ? "已恢复自动对奖跟踪状态"
        : updated === "partial"
          ? "已按实派结算为局部回血单"
          : updated === "won"
            ? entry.kind === "live"
              ? "已结算红单并更新累计净盈亏"
              : "已标记模拟观察单命中"
            : entry.kind === "paper"
              ? `已标记未中 · 计入累计免损 ¥${entry.paperRefCost.toFixed(0)}`
              : "已结算黑单并更新累计净盈亏";
    notifyToast(msg);
    return true;
  };
  const onDeleteEntry = (id: string) => {
    void wbCtrl.deleteEntry(id).then((res) => {
      if (res.ok) {
        haptic(8);
        if (!res.undoToken) notifyToast("已删除该条账本记录");
      } else if (res.error) notifyToast(res.error);
    });
  };
  const onUndoDelete = () => {
    void wbCtrl.undoDeleteEntry().then((res) => {
      if (res.ok) {
        haptic(10);
        playTactileCue("optimize-arpeggio");
        notifyToast(`已无损恢复 ${res.restoredCount ?? 1} 笔账本记录`);
      } else if (res.error) notifyToast(res.error);
    });
  };
  const onClearSettledPaper = () => {
    void wbCtrl.clearSettledPaper().then((res) => {
      if (res.ok) {
        haptic(10);
        if ((res.clearedCount ?? 0) === 0) {
          notifyToast("暂无需要清理的已结模拟单");
        }
      } else if (res.error) notifyToast(res.error);
    });
  };
  const [expandedLedgerIds, setExpandedLedgerIds] = useState<
    Record<string, boolean>
  >({});
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState(() => String(ledger.dailyLimit));
  const [wonPromptEntryId, setWonPromptEntryId] = useState<string | null>(null);
  const [wonPayoutDraft, setWonPayoutDraft] = useState("");

  const statsView = formatLedgerStatsSummary(ledger.stats);

  return (
    <>
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
          <div style={{ display: "flex", gap: 5 }}>
            <button
              type="button"
              className="key mini num"
              data-spring="0.88"
              disabled={ledgerBusy}
              onClick={onRefreshAutoSettle}
              title="立即拉取中国体彩官方完场赛果自动对奖"
            >
              🔄 自动对奖
            </button>
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
        </div>
        <span ref={balValRef} className="v num">
          ¥{ledger.dailyRemaining.toFixed(2)}
        </span>
        <div className="small num" style={{ marginTop: 4 }}>
          今日已耗 ¥{ledger.dailyLiveSpent}
          {(ledger.dailyLockedLossSpent ?? 0) > 0
            ? `（含已删亏损单锁定 ¥${ledger.dailyLockedLossSpent}）`
            : ""}{" "}
          / 护栏上限 ¥{ledger.dailyLimit} · 北京时间00:00重置
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
              onClick={async () => {
                const ok = await onSaveDailyLimit(limitDraft);
                if (ok) setEditingLimit(false);
              }}
            >
              保存上限
            </button>
          </div>
        )}
      </div>

      <div className="card stats enter">
        <div>
          <b className="num" style={{ color: statsView.netProfitColor }}>
            {statsView.netProfitText}
          </b>
          <span>实买累计净盈亏</span>
        </div>
        <div>
          <b className="num">{statsView.winRateText}</b>
          <span>{statsView.winRateSub}</span>
        </div>
        <div>
          <b className="num" style={{ color: statsView.paperSavedColor }}>
            {statsView.paperSavedText}
          </b>
          <span>{statsView.paperSavedSub}</span>
        </div>
      </div>

      {undoBanner && (
        <div className="ledger-undo-bar enter num">
          <span style={{ minWidth: 0 }}>{undoBanner.label}</span>
          <button
            type="button"
            className="key mini"
            style={{ flexShrink: 0 }}
            disabled={ledgerBusy}
            onClick={onUndoDelete}
          >
            ↩️ 点此撤销
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <div className="fstrip num" style={{ flex: 1, minWidth: 0 }}>
          {(
            [
              ["all", `全部(${ledger.entries.length})`],
              ["live", `💰实买(${liveEntriesCount})`],
              ["paper", `🧪模拟(${paperEntriesCount})`],
              ["pending", `⏳待开(${pendingEntriesCount})`],
            ] as const
          ).map(([fk, fl]) => (
            <button
              key={fk}
              type="button"
              className={`fchip ${ledgerFilter === fk ? "on" : ""}`}
              onClick={() => {
                haptic(5);
                onChangeLedgerFilter(fk);
              }}
            >
              {fl}
            </button>
          ))}
        </div>
        {ledgerFilter === "paper" && settledPaperCount > 0 && (
          <button
            type="button"
            className="key mini num"
            disabled={ledgerBusy}
            onClick={onClearSettledPaper}
            title="一键清理已开奖的模拟观察单（支持5秒撤销）"
          >
            🧹 清空已结模拟单({settledPaperCount})
          </button>
        )}
      </div>

      {filteredLedgerEntries.length === 0 ? (
        <div className="card enter">
          <div className="note-box">
            {ledger.entries.length === 0 ? (
              <>
                暂无账本记录 · 在【审单锁利】或【防错打票单】点击「
                <strong>记入实买</strong>」或「
                <strong>存模拟单</strong>
                」，系统自动封存出票水位并在完场后自动对奖。
              </>
            ) : (
              <>当前筛选分类下暂无记录，点击上方「全部」可查看其余订单。</>
            )}
          </div>
        </div>
      ) : (
        filteredLedgerEntries.map((it) => {
          const pres = buildLedgerEntryPresentation(it);
          const {
            isLive,
            cardToneClass,
            stampLabel,
            badgeText,
            badgeCls,
            defaultWinReturn,
            resolvedDetail,
          } = pres;
          const hasAnatomy = Boolean(resolvedDetail);
          const isExpanded = Boolean(expandedLedgerIds[it.id]);
          const liveHedge =
            it.status === "pending" &&
            it.settlementDetail?.liveEarlyHedge?.available
              ? it.settlementDetail.liveEarlyHedge
              : null;

          return (
            <div
              key={it.id}
              className={`card ledger-entry enter ${cardToneClass}`}
            >
              <div
                className="ledger-entry-top"
                style={{ cursor: hasAnatomy ? "pointer" : undefined }}
                onClick={() => {
                  if (!hasAnatomy) return;
                  haptic(5);
                  setExpandedLedgerIds((prev) => ({
                    ...prev,
                    [it.id]: !isExpanded,
                  }));
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      flexWrap: "wrap",
                      marginBottom: 3,
                    }}
                  >
                    <span
                      className={`ledger-kind-stamp num ${isLive ? "live" : "paper"}`}
                    >
                      {stampLabel}
                    </span>
                    {it.autoSettled && (
                      <span className="qpill hi num">官方自动对奖</span>
                    )}
                    {it.manualOverride && (
                      <span className="qpill num">手工校准</span>
                    )}
                  </div>
                  <b style={{ fontSize: 13, display: "block" }}>{it.title}</b>
                  <div className="small num">
                    {isLive
                      ? `本金 ¥${it.cost.toFixed(2)}${
                          it.minPayout > 0
                            ? ` · 预计保底 ¥${it.minPayout.toFixed(2)}`
                            : ""
                        }${it.settledReturn > 0 ? ` · 实派 ¥${it.settledReturn.toFixed(2)}` : ""}`
                      : `0成本模拟观察 · 拟投 ¥${it.paperRefCost.toFixed(2)}${
                          it.settledReturn > 0
                            ? ` · 拟派 ¥${it.settledReturn.toFixed(2)}`
                            : ""
                        }`}
                  </div>
                </div>
                <span className={badgeCls}>{badgeText}</span>
              </div>

              {liveHedge && (
                <div
                  className="note-box alert num"
                  style={{ margin: 0, padding: "7px 9px" }}
                >
                  <strong>
                    {liveHedge.hedgeMode === "lock-profit"
                      ? `⚡ 前序已全红！末场开球前补单可稳锁净利 +¥${liveHedge.lockedNetProfit.toFixed(2)}`
                      : liveHedge.hedgeMode === "break-even"
                        ? "⚖️ 前序已全红！末场开球前补单可零损锁回本金"
                        : `⚠️ 前序已全红！末场补单可减损锁回（少亏 -¥${Math.abs(liveHedge.lockedNetProfit).toFixed(2)}）`}
                  </strong>
                  <div className="small" style={{ marginTop: 2 }}>
                    末场 {liveHedge.lateMatchTitle}({liveHedge.lateKickoff})
                    暂未开球：去店里单关补买{" "}
                    <b>
                      {liveHedge.oppositeLabel} (¥{liveHedge.hedgeCost})
                    </b>
                    ，无论末场赛果如何均可锁定回款！
                  </div>
                </div>
              )}

              {hasAnatomy && isExpanded && resolvedDetail && (
                <div className="ledger-anatomy num">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 6,
                      paddingBottom: 5,
                      borderBottom: "0.5px solid var(--line)",
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    <span>
                      {isLive
                        ? `总投入 ¥${it.cost.toFixed(2)} → ${
                            it.status === "pending"
                              ? `预计保底 ¥${it.minPayout.toFixed(2)}`
                              : `实派 ¥${it.settledReturn.toFixed(2)}`
                          }`
                        : `拟投 ¥${it.paperRefCost.toFixed(2)}（0真金）→ ${
                            it.status === "pending"
                              ? "跟踪观察中"
                              : `拟派 ¥${it.settledReturn.toFixed(2)}`
                          }`}
                    </span>
                    <span
                      style={{
                        color:
                          it.status === "won"
                            ? "var(--good)"
                            : it.status === "partial"
                              ? "var(--warn, #d97706)"
                              : it.status === "lost"
                                ? isLive
                                  ? "var(--live)"
                                  : "var(--good)"
                                : "var(--text-2)",
                      }}
                    >
                      {it.status === "pending"
                        ? resolvedDetail.progressSummary
                        : isLive
                          ? it.status === "won"
                            ? it.netProfit > 0
                              ? `净赚 +¥${it.netProfit.toFixed(2)} (${Math.round((it.settledReturn / Math.max(1, it.cost)) * 100)}%返还)`
                              : "平手保本 ¥0.00 (100%回本)"
                            : it.status === "partial"
                              ? `挽回 ${Math.round((it.settledReturn / Math.max(1, it.cost)) * 100)}% 本金 · 净亏 -¥${Math.abs(it.netProfit).toFixed(2)}`
                              : `未中净亏 -¥${it.cost.toFixed(2)} (0%回血)`
                          : it.status === "won"
                            ? "模拟命中（未实买踏空）"
                            : `免损省下 ¥${Math.max(0, it.paperRefCost - it.settledReturn).toFixed(2)}`}
                    </span>
                  </div>

                  {resolvedDetail.matches.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {resolvedDetail.matches.map((mOut) => (
                        <div key={mOut.matchId} className="ledger-anat-match">
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 11.5,
                            }}
                          >
                            <b>
                              {mOut.isBanker ? "📌【胆】" : ""}
                              {mOut.matchNumStr} {mOut.home} vs {mOut.away}
                            </b>
                            <span
                              style={{
                                fontWeight: 700,
                                color:
                                  mOut.state === "hit"
                                    ? "var(--live)"
                                    : mOut.state === "void"
                                      ? "var(--warn)"
                                      : mOut.state === "miss"
                                        ? "var(--text-3)"
                                        : "var(--text-2)",
                              }}
                            >
                              {mOut.state === "void"
                                ? "⚪ 无效场次(按1.0算)"
                                : mOut.fullScore
                                  ? `完场 ${mOut.fullScore}${mOut.halfScore ? ` (半${mOut.halfScore})` : ""}`
                                  : "⏳ 待完场"}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              flexWrap: "wrap",
                            }}
                          >
                            {mOut.picks.map((pk, pIdx) => (
                              <span
                                key={`${mOut.matchId}-${pk.poolCode}-${pk.optionKey}-${pIdx}`}
                                className={`ledger-pick-chip ${pk.state}`}
                              >
                                {pk.poolCode === "HHAD" && mOut.goalLine
                                  ? `让(${mOut.goalLine})`
                                  : pk.poolCode}
                                ·{pk.optionLabel}@{pk.odds.toFixed(2)}{" "}
                                {pk.state === "hit"
                                  ? "🔴中"
                                  : pk.state === "miss"
                                    ? "⚫未中"
                                    : pk.state === "void"
                                      ? "⚪1.0"
                                      : "⏳"}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {resolvedDetail.tickets.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <div
                        className="small"
                        style={{ margin: "2px 0 0", fontWeight: 600 }}
                      >
                        逐张实票拆解（命中 {resolvedDetail.hitTicketCount}/
                        {resolvedDetail.totalTicketCount} 张）：
                      </div>
                      {resolvedDetail.tickets.slice(0, 24).map((tk, tIdx) => (
                        <div key={tk.id} className="ledger-anat-ticket">
                          <span style={{ minWidth: 0 }}>
                            <b>票{tIdx + 1}</b>{" "}
                            {tk.legs
                              .map(
                                (lg) =>
                                  `${lg.matchNumStr.slice(-3)}[${lg.optionLabel}@${lg.odds.toFixed(2)}]`
                              )
                              .join("×")}{" "}
                            ({tk.modeLabel}×{tk.multiple}倍)
                          </span>
                          <b
                            style={{
                              flexShrink: 0,
                              color:
                                tk.status === "won" ||
                                tk.status === "void-refund"
                                  ? "var(--live)"
                                  : tk.status === "lost"
                                    ? "var(--text-3)"
                                    : "var(--text-2)",
                            }}
                          >
                            {tk.status === "won"
                              ? `🔴 +¥${tk.payout.toFixed(2)}`
                              : tk.status === "void-refund"
                                ? `⚪ 退¥${tk.payout.toFixed(2)}`
                                : tk.status === "lost"
                                  ? "⚫ ¥0"
                                  : `⏳ 可派¥${(tk.potentialPayout ?? 0).toFixed(2)}`}
                          </b>
                        </div>
                      ))}
                      {resolvedDetail.tickets.length > 24 && (
                        <div className="small">
                          其余 {resolvedDetail.tickets.length - 24}{" "}
                          张子票已合并计入总派奖
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isLive && wonPromptEntryId === it.id && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={wonPayoutDraft}
                    onChange={(e) => setWonPayoutDraft(e.target.value)}
                    placeholder="实际到手派奖金额（低于本金自动标局部回血）"
                    className="ledger-input num"
                  />
                  <button
                    type="button"
                    className="key mini dark"
                    disabled={ledgerBusy}
                    onClick={async () => {
                      const val = Number(wonPayoutDraft);
                      const ok = await onSettleEntry(
                        it,
                        "won",
                        Number.isFinite(val) && val > 0 ? val : undefined
                      );
                      if (ok) setWonPromptEntryId(null);
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
                  {hasAnatomy && (
                    <button
                      type="button"
                      className={`key mini num ${isExpanded ? "on" : ""}`}
                      onClick={() => {
                        haptic(5);
                        setExpandedLedgerIds((prev) => ({
                          ...prev,
                          [it.id]: !isExpanded,
                        }));
                      }}
                    >
                      {isExpanded ? "▴ 收起明细" : "🔍 实票明细"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`key mini ${
                      it.status === "won" || it.status === "partial" ? "on" : ""
                    }`}
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
                        void onSettleEntry(it, "won");
                      }
                    }}
                  >
                    {isLive ? "改派奖" : "记命中"}
                  </button>
                  <button
                    type="button"
                    className={`key mini ${it.status === "lost" ? "on" : ""}`}
                    disabled={ledgerBusy}
                    onClick={() => void onSettleEntry(it, "lost")}
                  >
                    黑单
                  </button>
                  {(it.status !== "pending" || it.manualOverride) && (
                    <button
                      type="button"
                      className="key mini"
                      disabled={ledgerBusy}
                      onClick={() => void onSettleEntry(it, "pending")}
                    >
                      自动对奖
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="key mini"
                  disabled={ledgerBusy}
                  onClick={() => {
                    if (wonPromptEntryId === it.id) setWonPromptEntryId(null);
                    onDeleteEntry(it.id);
                  }}
                >
                  🗑️ 删除
                </button>
              </div>
            </div>
          );
        })
      )}

      <SessionStatusCard
        authUser={authUser}
        offlineMode={offlineMode}
        onOpenAdmin={onOpenAdmin}
        onLogout={onLogout}
      />
    </>
  );
}
