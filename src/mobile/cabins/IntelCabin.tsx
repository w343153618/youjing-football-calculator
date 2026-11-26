import { useState } from "react";
import { canAccessAdminConsole } from "../../admin/adminHistoryMonitorViewModel.ts";
import type { ManualSectionId } from "../../manual/UserManualModal.tsx";
import type { MatchItem } from "../../prototype/quantTypes.ts";
import type { PublicAccountUser } from "../../security/secureClient.ts";
import { haptic } from "../../spring/engine.ts";
import { SpringCollapseDrawer } from "../../spring/widgets.tsx";
import { buildMatchIntelDigest } from "../../workspace/betSlipController.ts";
import type {
  WorkbenchController,
  WorkbenchSnapshot,
} from "../../workspace/workbenchController.ts";
import { normalizeComboResidualRisks } from "./cabinViewModels.ts";

export function SessionStatusCard({
  authUser,
  offlineMode,
  onOpenAdmin,
  onLogout,
}: {
  authUser: PublicAccountUser | null;
  offlineMode: boolean;
  onOpenAdmin: () => void;
  onLogout: () => void;
}) {
  if (!authUser) return null;
  return (
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
        {canAccessAdminConsole(authUser) && (
          <button type="button" className="key mini dark" onClick={onOpenAdmin}>
            👑 总控台
          </button>
        )}
        <button type="button" className="key mini" onClick={onLogout}>
          退出账号
        </button>
      </div>
    </div>
  );
}

export function IntelCabin({
  wbCtrl,
  snap,
  notifyToast,
  onOpenManual,
  onDiagnoseSingleMatch,
  onDiagnoseCombo,
  onOpenAdmin,
  onLogout,
}: {
  wbCtrl: WorkbenchController;
  snap: WorkbenchSnapshot;
  notifyToast: (msg: string) => void;
  onOpenManual: (section: ManualSectionId) => void;
  onDiagnoseSingleMatch: (match: MatchItem, extraNote?: string) => void;
  onDiagnoseCombo: (sourceMode: "picked" | "custom", userNote?: string) => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}) {
  const onToggleComboSelectedMatch = (id: string) => {
    const res = wbCtrl.toggleComboSelectedMatch(id);
    if (!res.ok && res.reason) notifyToast(res.reason);
  };
  const [customIntelInput, setCustomIntelInput] = useState("");
  const [expandedIntelIds, setExpandedIntelIds] = useState<
    Record<string, boolean>
  >({});
  const [perCardNotes, setPerCardNotes] = useState<Record<string, string>>({});

  const { matches, activeAuditedSlip } = snap.betSlipState;
  const { appliedPlan } = snap.playabilityGates;
  const {
    syncClock,
    syncSummary,
    diagnosingMatchId,
    diagnosingCombo,
    comboSelectedIds,
    comboReport,
    authUser,
    offlineMode,
  } = snap;
  const auditedMatchIds = activeAuditedSlip.matchIds;
  const residualList = normalizeComboResidualRisks(comboReport?.residualRisks);

  return (
    <>
      <div className="card enter">
        <div className="sec num">官网水位同步战报 · {syncClock}</div>
        <div className="note-box">{syncSummary}</div>
      </div>

      <div className="sec-lbl enter">
        <span>扫地僧小高 · 精算×情报双维协同排雷</span>
        <button
          type="button"
          className="help-pill"
          onClick={() => onOpenManual("xiaogao")}
        >
          ? 消息与变价时序对照
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

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {auditedMatchIds.length >= 2 && (
            <button
              type="button"
              data-spring="0.92"
              className="key dark sm num"
              style={{ flex: 1, minWidth: 190 }}
              onClick={() =>
                onDiagnoseCombo("picked", customIntelInput || undefined)
              }
            >
              {diagnosingCombo
                ? "🧹 小高双维协同把脉中..."
                : appliedPlan
                  ? `🧹 协同会诊已套用【${appliedPlan.shortTab}】(${auditedMatchIds.length}场)`
                  : `🧹 一键联合会诊已选 ${auditedMatchIds.length} 场方案`}
            </button>
          )}
          <button
            type="button"
            data-spring="0.9"
            className="key sm num"
            onClick={() =>
              onDiagnoseCombo("custom", customIntelInput || undefined)
            }
          >
            {diagnosingCombo
              ? "会诊中..."
              : `会诊下方勾选 (${comboSelectedIds.length}场)`}
          </button>
        </div>
      </div>

      {comboReport && (
        <div
          className="card enter yj-cipher-reveal"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            border: "1px solid var(--mark)",
          }}
        >
          <div className="co-head" style={{ marginBottom: 0 }}>
            <div>
              <b>🧹 {comboReport.matchCount} 场精算×情报协同会诊报告</b>
              {comboReport.planContextBadge && (
                <div
                  className="small num"
                  style={{ color: "var(--good)", fontWeight: 600 }}
                >
                  {comboReport.planContextBadge}
                </div>
              )}
            </div>
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

          {comboReport.actuarySynergy && (
            <div className="note-box" style={{ margin: 0 }}>
              <strong>🛡️ 已构筑精算防线核验：</strong>
              <div>{comboReport.actuarySynergy}</div>
            </div>
          )}

          <div className="note-box alert" style={{ margin: 0 }}>
            <div>
              <strong>💣 最需警惕短板场：</strong>
              {comboReport.weakestLeg}
            </div>
            {residualList.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>⚡ 盘面残余实战暗雷：</strong>
                {residualList.map((rk, rIdx) => (
                  <div key={rIdx}>· {rk}</div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              <strong>🛠️ 协同调仓与补防建议：</strong>
              {comboReport.structureAdvice}
            </div>
          </div>

          {comboReport.perMatch.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {comboReport.perMatch.map((pm, idx) => (
                <div
                  key={`${pm.matchId}-${idx}`}
                  className="combo-card"
                  style={{ cursor: "default" }}
                >
                  <div className="combo-card-top">
                    <b>{pm.matchTitle}</b>
                    <span className="qpill warn">{pm.tag}</span>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                    {pm.note}
                  </div>
                  {pm.poolImpact && (
                    <div
                      className="small"
                      style={{ color: "var(--text-2)", margin: 0 }}
                    >
                      🎯 三池影响：{pm.poolImpact}
                    </div>
                  )}
                  <div
                    className="small num"
                    style={{ color: "var(--mark)", margin: 0, fontWeight: 600 }}
                  >
                    消息与变价时序对照：{pm.priceInStatus}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            className="small num"
            style={{ color: "var(--mark)", fontWeight: 600 }}
          >
            📊 消息与变价时序对照：{comboReport.priceInVerdict}
          </div>
          <div className="small">{comboReport.source}</div>
        </div>
      )}

      <div className="sec-lbl enter">
        <span>全盘单场深度情报流 (已诊置顶 · 点开看水位异动与三池拆解)</span>
        <span className="num">共 {matches.length} 场</span>
      </div>
      {[...matches]
        .sort((a, b) => Number(Boolean(b.aiAlert)) - Number(Boolean(a.aiAlert)))
        .map((m, idx) => {
          const digest = buildMatchIntelDigest(m);
          const checked = comboSelectedIds.includes(m.id);
          const isOpen =
            expandedIntelIds[m.id] !== undefined
              ? expandedIntelIds[m.id]
              : Boolean(m.aiAlert) || idx === 0;
          const cardNote = perCardNotes[m.id] ?? "";
          return (
            <SpringCollapseDrawer
              key={`intel-stream-${m.id}`}
              open={isOpen}
              onOpenChange={(next) =>
                setExpandedIntelIds((prev) => ({ ...prev, [m.id]: next }))
              }
              title={
                <>
                  <span>
                    {m.matchNumStr} {m.home} vs {m.away}
                  </span>
                  {digest.aiAlert && (
                    <span className="qpill warn">{digest.aiAlert.tag}</span>
                  )}
                </>
              }
              summary={`${digest.kickoffLeague} · ${digest.xgSummary}`}
              badge={
                <span
                  role="button"
                  tabIndex={0}
                  className={`qpill num ${checked ? "hi" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    haptic(5);
                    onToggleComboSelectedMatch(m.id);
                  }}
                >
                  {checked ? "✓ 已勾会诊" : "+ 勾会诊"}
                </span>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {digest.trendMovements.length > 0 && (
                  <div className="chips">
                    {digest.trendMovements.map((tm, tIdx) => (
                      <span
                        key={`${m.id}-tr-${tIdx}`}
                        className="chip num"
                        title={tm.interpretation}
                      >
                        {tm.poolName}·{tm.optionLabel} @{tm.odds.toFixed(2)}
                        <i>{tm.trend === -1 ? "▼末跳下调" : "▲末跳上调"}</i>
                      </span>
                    ))}
                  </div>
                )}

                <div>
                  <div
                    className="small num"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      margin: "0 0 3px",
                    }}
                  >
                    <span>
                      🌡️ 一球小胜卡盘温度计：{digest.cardPanAlert.tip}
                    </span>
                    <b
                      style={{
                        color:
                          digest.cardPanAlert.level === "high"
                            ? "var(--live)"
                            : "var(--text)",
                      }}
                    >
                      {digest.cardPanAlert.sharePct}%
                    </b>
                  </div>
                  <div className="combo-pnl-bar">
                    <i
                      className={
                        digest.cardPanAlert.level === "high"
                          ? "loss"
                          : digest.cardPanAlert.level === "warn"
                            ? "breakeven"
                            : "gain"
                      }
                      style={{
                        width: `${Math.max(8, Math.min(100, digest.cardPanAlert.sharePct))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="note-box" style={{ fontSize: 11.5 }}>
                  <div>
                    <strong>① 胜平负：</strong>
                    {digest.poolImpacts.had}
                  </div>
                  <div style={{ marginTop: 3 }}>
                    <strong>② 让球盘：</strong>
                    {digest.poolImpacts.hhad}
                  </div>
                  <div style={{ marginTop: 3 }}>
                    <strong>③ 总进球：</strong>
                    {digest.poolImpacts.ttg}
                  </div>
                  <div
                    className="small"
                    style={{ marginTop: 4, color: "var(--text-3)" }}
                  >
                    跨盘扫描：{digest.alphaSummary}
                  </div>
                </div>

                {digest.aiAlert && (
                  <div className="note-box alert" style={{ margin: 0 }}>
                    <strong>
                      🧹 扫地僧小高单场深挖 · {digest.aiAlert.tag}：
                    </strong>
                    <div>{digest.aiAlert.summary}</div>
                    <div
                      className="small num"
                      style={{ color: "var(--mark)", fontWeight: 600 }}
                    >
                      消息与变价时序对照：{digest.aiAlert.priceInStatus}
                      {digest.aiAlert.suggestedDelta
                        ? ` · ${digest.aiAlert.suggestedDelta}`
                        : ""}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="text"
                    value={cardNote}
                    onChange={(e) =>
                      setPerCardNotes((prev) => ({
                        ...prev,
                        [m.id]: e.target.value,
                      }))
                    }
                    placeholder={`补充本场伤停/首发消息 (${digest.steamSignal.slice(0, 14)}...)`}
                    className="ledger-input"
                  />
                  <button
                    type="button"
                    data-spring="0.88"
                    className="key mini dark"
                    style={{ flexShrink: 0 }}
                    onClick={() =>
                      onDiagnoseSingleMatch(
                        m,
                        cardNote || customIntelInput || undefined
                      )
                    }
                  >
                    {diagnosingMatchId === m.id
                      ? "小高诊盘中..."
                      : "🧹 请小高单场深挖"}
                  </button>
                </div>
              </div>
            </SpringCollapseDrawer>
          );
        })}
      <SessionStatusCard
        authUser={authUser}
        offlineMode={offlineMode}
        onOpenAdmin={onOpenAdmin}
        onLogout={onLogout}
      />
    </>
  );
}
