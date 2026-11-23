import { useState } from "react";
import type {
  BoardFreshnessMeta,
  BridgeMatchCandidate,
  BridgeMatchPreview,
  DualAxisOptionMovement,
  MatchItem,
  OddsOption,
  PoolCode,
  SelectedPick,
} from "../../prototype/quantTypes.ts";
import { haptic } from "../../spring/engine.ts";
import { TeamCrest } from "../../spring/widgets.tsx";
import type {
  MatchMode,
  RadarMatchDayGroup,
  SportteryCutoffStatus,
} from "../../workspace/betSlipController.ts";
import {
  RADAR_QUICK_FILTERS,
  buildCompactOptionMovementViewModel,
  buildMatchRadarBoardFreshnessBanner,
  buildMatchRadarSelectedSubPoolPills,
  buildMatchRadarSingleBadge,
  buildTrendArrowSpec,
  type QuickFilter,
  type SheetState,
} from "./cabinViewModels.ts";

export function renderTrendArrow(
  trend?: -1 | 0 | 1,
  movement?: DualAxisOptionMovement | null
) {
  const spec = buildTrendArrowSpec(trend, movement);
  if (!spec) return null;
  return (
    <i className={spec.className} title={spec.title}>
      {spec.symbol}
    </i>
  );
}

export function renderCompactDeltaBadge(opt: OddsOption, probDecimals = 0) {
  const badge = buildCompactOptionMovementViewModel(
    opt,
    probDecimals
  ).deltaBadge;
  if (!badge) return null;
  return (
    <em className={`dp-badge ${badge.tone}`} title={badge.title}>
      {badge.text}
    </em>
  );
}

export function BridgeCandidatesCard({
  showBridgeFinder,
  bridgeCandidates,
  compact = false,
  previewBridgeCandidate,
  onApplyBridgeCandidate,
}: {
  showBridgeFinder: boolean;
  bridgeCandidates: BridgeMatchCandidate[];
  compact?: boolean;
  previewBridgeCandidate?: (
    cand: BridgeMatchCandidate
  ) => BridgeMatchPreview | null;
  onApplyBridgeCandidate: (
    cand: BridgeMatchCandidate,
    triggerEl?: HTMLElement | null
  ) => void;
}) {
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  if (!showBridgeFinder || bridgeCandidates.length === 0) return null;
  return (
    <div
      className="card sonar-card enter num"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: compact ? "8px 10px" : undefined,
      }}
    >
      <div className="co-head" style={{ marginBottom: 0 }}>
        <span className="sec" style={{ margin: 0 }}>
          🌉 过桥配菜搭子寻优（还差 1 场凑合法 2串1）
        </span>
        <span className="qpill hi" style={{ flexShrink: 0 }}>
          全盘精选 Top {bridgeCandidates.length}
        </span>
      </div>
      {bridgeCandidates.map((cand) => {
        const candKey = `${cand.kind}-${cand.matchId}-${cand.poolCode}-${cand.optionKey}`;
        const preview = previewBridgeCandidate?.(cand) ?? null;
        const isConfirming = confirmingKey === candKey;
        return (
          <div
            key={candKey}
            className="note-box"
            style={{ margin: 0, padding: "6px 8px" }}
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
              <div>
                <strong>
                  {cand.badge} · {cand.matchNumStr} {cand.home}vs{cand.away}
                </strong>
                <div className="small" style={{ margin: "2px 0 0" }}>
                  {cand.poolName}[{cand.optionLabel}@{cand.odds.toFixed(2)} ·
                  真率
                  {(cand.fairProb * 100).toFixed(0)}%] — {cand.reason}
                </div>
                {preview && (
                  <div
                    className="small num"
                    style={{
                      margin: "2px 0 0",
                      color: "var(--mark)",
                      fontWeight: 600,
                    }}
                  >
                    {preview.summaryText}
                  </div>
                )}
              </div>
              {preview && isConfirming ? (
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  <button
                    type="button"
                    data-spring="0.88"
                    className="key mini dark num"
                    onClick={(e) => {
                      setConfirmingKey(null);
                      onApplyBridgeCandidate(cand, e.currentTarget);
                    }}
                  >
                    确认加场 (¥{preview.previewTotalCost})
                  </button>
                  <button
                    type="button"
                    className="key mini"
                    onClick={() => setConfirmingKey(null)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-spring="0.88"
                  className="key mini dark num"
                  style={{ flexShrink: 0 }}
                  onClick={(e) => {
                    if (preview) {
                      haptic(5);
                      setConfirmingKey(candKey);
                      return;
                    }
                    onApplyBridgeCandidate(cand, e.currentTarget);
                  }}
                >
                  {preview
                    ? `搭上预览 (¥${preview.previewTotalCost})`
                    : "一键搭上"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MatchRadarFilterToolbar({
  qFilter,
  onSelectQuickFilter,
  radarSearchQuery,
  onChangeSearchQuery,
  cutoffStatus,
}: {
  qFilter: QuickFilter;
  onSelectQuickFilter: (next: QuickFilter) => void;
  radarSearchQuery: string;
  onChangeSearchQuery: (next: string) => void;
  cutoffStatus: SportteryCutoffStatus;
}) {
  return (
    <>
      <div className="fstrip num">
        {RADAR_QUICK_FILTERS.map(([fid, flbl]) => (
          <button
            key={fid}
            type="button"
            data-spring="0.9"
            onClick={() => {
              haptic(5);
              onSelectQuickFilter(fid);
            }}
            className={`fchip ${qFilter === fid ? "on" : ""}`}
          >
            {flbl}
          </button>
        ))}
      </div>
      <div className="radar-toolbar num">
        <div className="radar-search-wrap">
          <input
            type="text"
            value={radarSearchQuery}
            onChange={(e) => onChangeSearchQuery(e.target.value)}
            placeholder="🔍 搜编号(如008)/队名/联赛"
            className="radar-search-input"
          />
          {radarSearchQuery && (
            <button
              type="button"
              className="radar-search-clear"
              title="清空搜索"
              onClick={() => onChangeSearchQuery("")}
            >
              ×
            </button>
          )}
        </div>
        <span
          className={`cutoff-pill ${cutoffStatus.level}`}
          title="中国体彩线下实体店每日官方销售截止参考（平日22:00 / 周末23:00）"
        >
          {cutoffStatus.badgeText}
        </span>
      </div>
    </>
  );
}

export function MatchRadarFreshnessBanner({
  boardMeta,
}: {
  boardMeta?: BoardFreshnessMeta | null;
}) {
  const vm = buildMatchRadarBoardFreshnessBanner(boardMeta);
  if (!vm) return null;
  return (
    <div
      role="status"
      className="card enter num"
      style={{
        padding: "7px 10px",
        marginBottom: 8,
        borderLeft: "3px solid var(--amber, #d97706)",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          minWidth: 0,
        }}
      >
        <strong
          style={{
            fontSize: 11.5,
            lineHeight: 1.3,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={vm.fullBannerText}
        >
          🕒 {vm.headline}
        </strong>
        <span className="qpill warn" style={{ flexShrink: 0, fontSize: 10 }}>
          {vm.badgeText}
        </span>
      </div>
      <div
        className="small"
        style={{
          margin: 0,
          fontSize: 10.5,
          lineHeight: 1.35,
          opacity: 0.84,
          overflowWrap: "anywhere",
        }}
      >
        {vm.detailText}
      </div>
    </div>
  );
}

export function MatchRadarCabin({
  mode,
  qFilter,
  radarSearchQuery,
  boardMeta,
  visibleMatches,
  groups,
  picks,
  isPicked,
  onTogglePick,
  onOpenSheet,
  onResetFilters,
}: {
  mode: MatchMode;
  qFilter: QuickFilter;
  radarSearchQuery: string;
  boardMeta?: BoardFreshnessMeta | null;
  visibleMatches: MatchItem[];
  groups: RadarMatchDayGroup[];
  picks: SelectedPick[];
  isPicked: (matchId: string, poolCode: PoolCode, optKey: string) => boolean;
  onTogglePick: (
    el: HTMLElement | null,
    match: MatchItem,
    poolCode: PoolCode,
    optKey: string
  ) => void;
  onOpenSheet: (next: SheetState) => void;
  onResetFilters: () => void;
}) {
  const [collapsedDayKeys, setCollapsedDayKeys] = useState<
    Record<string, boolean>
  >({});

  const extraCountOf = (mId: string) =>
    picks.filter(
      (p) => p.matchId === mId && p.poolCode !== "HAD" && p.poolCode !== "HHAD"
    ).length;

  const renderSingleRadarMatchCard = (m: MatchItem) => {
    const mq = m.microQuant;
    const extN = extraCountOf(m.id);
    const crsSelected = picks
      .filter((p) => p.matchId === m.id && p.poolCode === "CRS")
      .map((p) => p.optionLabel);

    const hP = (m.pools.HAD.options[0]?.fairProb ?? 0.45) * 100;
    const dP = (m.pools.HAD.options[1]?.fairProb ?? 0.27) * 100;
    const aP = (m.pools.HAD.options[2]?.fairProb ?? 0.28) * 100;
    const singleBadge = buildMatchRadarSingleBadge(m);
    const subPoolPills =
      mode === "mix" || mode === "spf" || mode === "single"
        ? buildMatchRadarSelectedSubPoolPills(m, picks)
        : [];

    return (
      <div key={m.id} className="card enter">
        <div className="meta">
          <div className="meta-l">
            <span className="num no">{m.matchNumStr}</span>
            <span>{m.league}</span>
            {singleBadge.isMainSingle ? (
              <span className="tag" title={singleBadge.title}>
                {singleBadge.text}
              </span>
            ) : (
              <span
                title={singleBadge.title}
                style={{
                  fontSize: 9.5,
                  opacity: 0.72,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {singleBadge.text}
              </span>
            )}
          </div>
          <button
            type="button"
            className="more num"
            data-spring="0.9"
            onClick={() => onOpenSheet({ type: "more", matchId: m.id })}
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

        <div
          className="mini-prob"
          title={`去水真实胜率：主${hP.toFixed(0)}% / 平${dP.toFixed(0)}% / 客${aP.toFixed(0)}%`}
          onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
        >
          <i style={{ width: `${hP}%` }} />
          <i style={{ width: `${dP}%` }} />
          <i style={{ width: `${aP}%` }} />
        </div>

        <div
          className="qstrip num"
          onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
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

        {mode === "zjq" ? (
          <>
            <div
              className="duel"
              data-spring="0.98"
              onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
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
                  onTogglePick(e.currentTarget, m, "TTG", "closed")
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
                      onTogglePick(e.currentTarget, m, "TTG", opt.key)
                    }
                    className={`key cell num ${isPicked(m.id, "TTG", opt.key) ? "on" : ""}`}
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
            )}
          </>
        ) : mode === "bqc" ? (
          <>
            <div
              className="duel"
              data-spring="0.98"
              onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
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
                  onTogglePick(e.currentTarget, m, "HAFU", "closed")
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
                      onTogglePick(e.currentTarget, m, "HAFU", opt.key)
                    }
                    className={`key cell num ${isPicked(m.id, "HAFU", opt.key) ? "on" : ""}`}
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
            )}
          </>
        ) : mode === "bf" ? (
          <>
            <div
              className="duel"
              data-spring="0.98"
              onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
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
                  onTogglePick(e.currentTarget, m, "CRS", "closed")
                }
              >
                比分玩法暂未开售
              </button>
            ) : (
              <button
                type="button"
                data-spring="0.95"
                onClick={() => onOpenSheet({ type: "more", matchId: m.id })}
                className={`key wide num ${crsSelected.length > 0 ? "on" : ""}`}
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
              onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
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
              const hadOpen = m.pools.HAD.selling !== false && Boolean(hadOpt);
              const hhadOpen =
                m.pools.HHAD.selling !== false && Boolean(hhadOpt);
              return (
                <div key={idx} className="kcol">
                  {hadOpen && hadOpt ? (
                    <button
                      type="button"
                      data-spring="0.88"
                      onClick={(e) =>
                        onTogglePick(e.currentTarget, m, "HAD", hadOpt.key)
                      }
                      className={`key k2 num ${isPicked(m.id, "HAD", hadOpt.key) ? "on" : ""}`}
                    >
                      <span className="ko">
                        {hadOpt.odds.toFixed(2)}
                        {renderTrendArrow(hadOpt.trend, hadOpt.movement)}
                      </span>
                      <span className="kp">
                        <span>{(hadOpt.fairProb * 100).toFixed(0)}%</span>
                        {renderCompactDeltaBadge(hadOpt, 0)}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) =>
                        onTogglePick(e.currentTarget, m, "HAD", "closed")
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
                        onTogglePick(e.currentTarget, m, "HHAD", hhadOpt.key)
                      }
                      className={`key k2 num ${isPicked(m.id, "HHAD", hhadOpt.key) ? "on" : ""}`}
                    >
                      <span className="ko">
                        {hhadOpt.odds.toFixed(2)}
                        {renderTrendArrow(hhadOpt.trend, hhadOpt.movement)}
                      </span>
                      <span className="kp">
                        <span>{(hhadOpt.fairProb * 100).toFixed(0)}%</span>
                        {renderCompactDeltaBadge(hhadOpt, 0)}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) =>
                        onTogglePick(e.currentTarget, m, "HHAD", "closed")
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

        {subPoolPills.length > 0 && (
          <div
            className="num"
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 5,
              marginTop: 7,
              paddingTop: 6,
              borderTop: "0.5px dashed var(--line)",
            }}
          >
            <span
              className="small"
              style={{ margin: 0, fontWeight: 600, color: "var(--mark)" }}
            >
              🎯 已选子玩法：
            </span>
            {subPoolPills.map((pill) => (
              <button
                key={pill.key}
                type="button"
                aria-label={pill.clearAriaLabel}
                data-spring="0.88"
                className="key mini on num"
                style={{ padding: "2px 7px", fontSize: 11 }}
                onClick={(e) =>
                  onTogglePick(
                    e.currentTarget,
                    m,
                    pill.poolCode,
                    pill.optionKey
                  )
                }
              >
                {pill.text} ×
              </button>
            ))}
          </div>
        )}

        {(m.aiAlert || mq.arbitrages[0]) && (
          <div
            className="card-intel-bar"
            onClick={() => onOpenSheet({ type: "intel", matchId: m.id })}
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
  };

  return (
    <>
      <MatchRadarFreshnessBanner boardMeta={boardMeta} />
      {["mix", "spf", "single"].includes(mode) && visibleMatches.length > 0 && (
        <div className="mgrid colhead enter">
          <span style={{ textAlign: "left" }}>球队 / 排名</span>
          <span>让</span>
          <span>胜(真率)</span>
          <span>平(真率)</span>
          <span>负(真率)</span>
        </div>
      )}

      {visibleMatches.length === 0 ? (
        <div className="card enter">
          <div
            className="note-box"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>
              未找到匹配「<strong>{radarSearchQuery || "当前筛选"}</strong>
              」的在售赛事
            </span>
            {(radarSearchQuery || qFilter !== "all") && (
              <button
                type="button"
                className="key mini dark"
                onClick={onResetFilters}
              >
                重置筛选
              </button>
            )}
          </div>
        </div>
      ) : (
        groups.map((grp) => {
          const isCollapsed = Boolean(collapsedDayKeys[grp.dayKey]);
          return (
            <div key={grp.dayKey}>
              <button
                type="button"
                className="day-grp-hdr num"
                onClick={() =>
                  setCollapsedDayKeys((prev) => ({
                    ...prev,
                    [grp.dayKey]: !isCollapsed,
                  }))
                }
              >
                <span>📅 {grp.dayLabel}</span>
                <span>
                  {grp.matches.length} 场 {isCollapsed ? "▸ 展开" : "▾"}
                </span>
              </button>
              {!isCollapsed && grp.matches.map(renderSingleRadarMatchCard)}
            </div>
          );
        })
      )}
    </>
  );
}
