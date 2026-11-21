import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  POOL_MAX_PASS,
  evaluateQuantWorkspace,
  settleTicketSnapshotWithOfficialResults,
} from "./quantEngine.mjs";

const DEFAULT_DAILY_LIMIT = 300;
const MIN_DAILY_LIMIT = 20;
const MAX_DAILY_LIMIT = 100_000;
const MAX_ENTRY_COST = 1_000_000;
const MAX_SNAPSHOT_TOTAL_COST = 20_000;
const MAX_PAYOUT = 10_000_000;
const MAX_BET_COUNT = 100_000;
const MAX_ENTRIES_PER_USER = 200;
const MAX_SNAPSHOT_MATCHES = 15;
const MAX_SNAPSHOT_PICKS_PER_MATCH = 31;
const MAX_UNTRUSTED_SNAPSHOT_LINES = 64;
const MAX_TRUSTED_SNAPSHOT_LINES = 512;
const UNDO_TTL_MS = 15_000;

const VALID_POOLS = new Set(["HAD", "HHAD", "TTG", "HAFU", "CRS"]);
const VALID_STATUSES = new Set(["pending", "won", "partial", "lost"]);

function round2(val) {
  const raw = Number(val || 0);
  if (!Number.isFinite(raw)) return 0;
  const n = Number(raw.toFixed(2));
  return Object.is(n, -0) ? 0 : n;
}

function clampMoney(raw, maxVal) {
  const n = Number(raw);
  if (Number.isNaN(n) || n <= 0) return 0;
  return round2(Math.min(maxVal, n));
}

function clampBetCount(raw) {
  const n = Number(raw);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.max(1, Math.min(MAX_BET_COUNT, Math.round(n)));
}

function clampDailyLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_LIMIT;
  return Math.max(MIN_DAILY_LIMIT, Math.min(MAX_DAILY_LIMIT, Math.round(n)));
}

function clampCustomOdds(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1.01) return 1.01;
  return Math.min(1000, Number(n.toFixed(4)));
}

function beijingDateStr(nowMs) {
  const d = new Date(nowMs + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function toAuthoritativeMap(authInput) {
  if (!authInput) return null;
  if (authInput instanceof Map) return authInput;
  if (Array.isArray(authInput)) {
    return new Map(
      authInput
        .filter((m) => m && m.id !== undefined)
        .map((m) => [String(m.id), m])
    );
  }
  return null;
}

function resolveAuthoritativePick(authMap, matchId, poolCode, optionKey) {
  const m = authMap?.get(matchId);
  if (!m || !m.pools) return null;
  const pool = m.pools[poolCode];
  if (!pool || pool.selling === false || !Array.isArray(pool.options)) {
    return null;
  }
  const opt = pool.options.find((o) => String(o.key) === optionKey);
  if (!opt || !(Number(opt.odds) > 1)) return null;
  return {
    odds: Number(opt.odds),
    optionLabel: opt.label || optionKey,
    goalLine: m.pools.HHAD?.goalLine ?? "-1",
    single: Boolean(pool.single),
    matchNumStr: m.matchNumStr,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    businessDate: m.businessDate,
  };
}

function sanitizeTicketSnapshot(raw, opts = {}) {
  if (!raw || typeof raw !== "object") return undefined;
  const strict = Boolean(opts.strictValidate);
  const trusted = Boolean(opts.trustedServerSnapshot);
  const authMap = toAuthoritativeMap(opts.authoritativeMatches);
  const lineCap = trusted
    ? MAX_TRUSTED_SNAPSHOT_LINES
    : MAX_UNTRUSTED_SNAPSHOT_LINES;

  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return undefined;
  if (raw.lines.length > lineCap) {
    if (strict) {
      throw new Error(`出票快照实票行数超出上限（最多 ${lineCap} 行）`);
    }
    return undefined;
  }

  const rawMatches = Array.isArray(raw.matches)
    ? raw.matches.slice(0, MAX_SNAPSHOT_MATCHES)
    : [];
  const distinctMatchIds = new Set();
  let hasParlayLine = false;
  let totalLineCost = 0;

  const lines = [];
  for (let i = 0; i < raw.lines.length; i++) {
    const ln = raw.lines[i];
    if (!ln || typeof ln !== "object" || !Array.isArray(ln.legs)) continue;
    if (ln.legs.length === 0 || ln.legs.length > 8) {
      if (strict) throw new Error("单张实票关数不合法");
      continue;
    }

    const seenLineMatches = new Set();
    const legs = [];
    let minPoolCap = 8;
    let lineInvalid = false;
    let firstLegAuthSingle = true;

    for (const lg of ln.legs) {
      if (!lg || typeof lg !== "object") {
        if (strict) throw new Error("实票选项参数无效");
        lineInvalid = true;
        break;
      }
      const matchId = String(lg.matchId ?? "")
        .trim()
        .slice(0, 32);
      const poolCode = String(lg.poolCode || "").toUpperCase();
      const optionKey = String(lg.optionKey ?? "")
        .trim()
        .slice(0, 16);
      if (!matchId || !VALID_POOLS.has(poolCode) || !optionKey) {
        if (strict) throw new Error("实票选项参数无效");
        lineInvalid = true;
        break;
      }
      if (seenLineMatches.has(matchId)) {
        if (strict) throw new Error("同一张实票内禁止重复同一场赛事");
        lineInvalid = true;
        break;
      }
      seenLineMatches.add(matchId);
      minPoolCap = Math.min(minPoolCap, POOL_MAX_PASS[poolCode] || 8);

      const isKnownAuthMatch = Boolean(authMap?.has(matchId));
      const authPick = resolveAuthoritativePick(
        authMap,
        matchId,
        poolCode,
        optionKey
      );
      if (isKnownAuthMatch && !authPick) {
        if (strict) {
          throw new Error(
            "权威在售盘口未开售该玩法或选项无效，禁止写入自定义赔率"
          );
        }
        return undefined;
      }
      if (legs.length === 0 && isKnownAuthMatch) {
        firstLegAuthSingle = Boolean(authPick?.single);
      }

      const resolvedOdds = authPick ? authPick.odds : clampCustomOdds(lg.odds);
      const resolvedGoalLine = authPick
        ? authPick.goalLine
        : lg.goalLine !== undefined
          ? String(lg.goalLine).slice(0, 8)
          : undefined;

      legs.push({
        matchId,
        matchNumStr:
          authPick?.matchNumStr ||
          (lg.matchNumStr ? String(lg.matchNumStr).slice(0, 20) : undefined),
        home:
          authPick?.home ||
          (lg.home ? String(lg.home).slice(0, 32) : undefined),
        away:
          authPick?.away ||
          (lg.away ? String(lg.away).slice(0, 32) : undefined),
        kickoff:
          authPick?.kickoff ||
          (lg.kickoff ? String(lg.kickoff).slice(0, 16) : undefined),
        poolCode,
        optionKey,
        optionLabel: String(
          authPick?.optionLabel || lg.optionLabel || optionKey
        ).slice(0, 24),
        odds: resolvedOdds,
        goalLine: resolvedGoalLine,
      });
    }

    if (lineInvalid || legs.length === 0) continue;
    if (legs.length === 1 && !firstLegAuthSingle) {
      if (strict) {
        throw new Error("该场次对应玩法未开单关，禁止伪造单关实票快照");
      }
      return undefined;
    }
    if (legs.length > minPoolCap) {
      if (strict) {
        throw new Error(
          `出票快照包含超出中国体彩玩法最高过关上限（${minPoolCap}关）的串关组合`
        );
      }
      return undefined;
    }
    for (const vLeg of legs) {
      distinctMatchIds.add(vLeg.matchId);
    }
    if (legs.length >= 2) hasParlayLine = true;

    const mult = Math.max(
      1,
      Math.min(999, Math.round(Number(ln.multiple) || 1))
    );
    totalLineCost += mult * 2;
    lines.push({
      id: String(ln.id || `line_${i + 1}`).slice(0, 40),
      modeLabel: String(
        ln.modeLabel || (legs.length === 1 ? "单关" : `${legs.length}串1`)
      ).slice(0, 24),
      multiple: mult,
      legs,
    });
  }

  if (lines.length === 0) return undefined;
  const maxMatchesAllowed = hasParlayLine ? 8 : 15;
  if (distinctMatchIds.size > maxMatchesAllowed) {
    if (strict) {
      throw new Error(`方案关联场次数超出上限（最多 ${maxMatchesAllowed} 场）`);
    }
    return undefined;
  }
  if (totalLineCost > MAX_SNAPSHOT_TOTAL_COST) {
    if (strict) {
      throw new Error("单次方案总金额超出中国体彩 ¥20,000 法定上限");
    }
    return undefined;
  }

  const bankerIds =
    opts.bankerMatchIds instanceof Set ? opts.bankerMatchIds : null;
  const matchesById = new Map();
  for (const m of rawMatches) {
    if (!m || typeof m !== "object") continue;
    const matchId = String(m.matchId ?? "")
      .trim()
      .slice(0, 32);
    if (!matchId || !distinctMatchIds.has(matchId)) continue;
    const authM = authMap?.get(matchId);
    const rawPicks = Array.isArray(m.picks)
      ? m.picks.slice(0, MAX_SNAPSHOT_PICKS_PER_MATCH)
      : [];
    const picks = [];
    for (const p of rawPicks) {
      if (!p || typeof p !== "object") continue;
      const poolCode = String(p.poolCode || "").toUpperCase();
      if (!VALID_POOLS.has(poolCode)) continue;
      const optionKey = String(p.optionKey ?? "")
        .trim()
        .slice(0, 16);
      if (!optionKey) continue;
      const authPick = resolveAuthoritativePick(
        authMap,
        matchId,
        poolCode,
        optionKey
      );
      if (authM && !authPick) {
        if (strict) {
          throw new Error(
            "权威在售盘口未开售该玩法或选项无效，禁止写入自定义赔率"
          );
        }
        continue;
      }
      picks.push({
        poolCode,
        optionKey,
        optionLabel: String(
          authPick?.optionLabel || p.optionLabel || optionKey
        ).slice(0, 24),
        odds: authPick ? authPick.odds : clampCustomOdds(p.odds),
        goalLine: authPick
          ? authPick.goalLine
          : p.goalLine !== undefined
            ? String(p.goalLine).slice(0, 8)
            : undefined,
      });
    }
    matchesById.set(matchId, {
      matchId,
      matchNumStr: String(authM?.matchNumStr || m.matchNumStr || matchId).slice(
        0,
        20
      ),
      home: String(authM?.home || m.home || "").slice(0, 32),
      away: String(authM?.away || m.away || "").slice(0, 32),
      kickoff: String(authM?.kickoff || m.kickoff || "").slice(0, 16),
      businessDate:
        authM?.businessDate || m.businessDate
          ? String(authM?.businessDate || m.businessDate).slice(0, 12)
          : undefined,
      goalLine: authM?.pools?.HHAD?.goalLine
        ? String(authM.pools.HHAD.goalLine).slice(0, 8)
        : m.goalLine !== undefined
          ? String(m.goalLine).slice(0, 8)
          : undefined,
      isBanker: bankerIds ? bankerIds.has(matchId) : Boolean(m.isBanker),
      picks,
    });
  }

  for (const ln of lines) {
    for (const lg of ln.legs) {
      let item = matchesById.get(lg.matchId);
      if (!item) {
        const authM = authMap?.get(lg.matchId);
        item = {
          matchId: lg.matchId,
          matchNumStr: String(
            authM?.matchNumStr || lg.matchNumStr || lg.matchId
          ).slice(0, 20),
          home: String(authM?.home || lg.home || "").slice(0, 32),
          away: String(authM?.away || lg.away || "").slice(0, 32),
          kickoff: String(authM?.kickoff || lg.kickoff || "").slice(0, 16),
          ...(authM?.businessDate
            ? { businessDate: String(authM.businessDate).slice(0, 12) }
            : {}),
          goalLine: authM?.pools?.HHAD?.goalLine
            ? String(authM.pools.HHAD.goalLine).slice(0, 8)
            : lg.goalLine,
          isBanker: bankerIds ? bankerIds.has(lg.matchId) : false,
          picks: [],
        };
        matchesById.set(lg.matchId, item);
      }
      if (
        !item.picks.some(
          (p) => p.poolCode === lg.poolCode && p.optionKey === lg.optionKey
        )
      ) {
        item.picks.push({
          poolCode: lg.poolCode,
          optionKey: lg.optionKey,
          optionLabel: lg.optionLabel,
          odds: lg.odds,
          goalLine: lg.goalLine ?? item.goalLine,
        });
      }
    }
  }

  return {
    matches: Array.from(matchesById.values()),
    lines,
  };
}

/**
 * 服务端唯一权威出票快照封存器：
 * 共享精算模块导出的 POOL_MAX_PASS，依据权威在售盘口一次性定格对阵元数据、开球时间、让球线、固定水位、胆码标识与实票列表；
 * 当未传入 workspaceParams 时，平滑回退至历史/离线原始快照严格核验。
 */
export function sealAuthoritativePrintSnapshot(opts = {}) {
  const {
    workspaceParams = null,
    workspaceRes = null,
    authoritativeMatches = null,
    rawSnapshotFallback = undefined,
    trustedServerSnapshot = false,
    title,
    modeLabel,
    betCount,
    cost,
    paperRefCost,
    minPayout,
    maxPayout,
  } = opts;

  const hasWorkspaceParams =
    workspaceParams !== null && workspaceParams !== undefined;
  if (
    hasWorkspaceParams &&
    (typeof workspaceParams !== "object" || Array.isArray(workspaceParams))
  ) {
    throw new Error("选单工作区参数格式无效");
  }

  if (hasWorkspaceParams || workspaceRes) {
    const cleanWsParams = hasWorkspaceParams
      ? {
          ...workspaceParams,
          simVoidFirstMatch: false,
          subjectiveDeltaPct: 0,
        }
      : null;
    const hasCallerSandboxShift =
      Boolean(workspaceParams?.simVoidFirstMatch) ||
      Number(workspaceParams?.subjectiveDeltaPct || 0) !== 0;
    const authList = Array.isArray(authoritativeMatches)
      ? authoritativeMatches
      : authoritativeMatches instanceof Map
        ? Array.from(authoritativeMatches.values())
        : undefined;
    const ws =
      !hasCallerSandboxShift && workspaceRes
        ? workspaceRes
        : evaluateQuantWorkspace(cleanWsParams || {}, authList);
    const effRep = ws?.effectiveReport;

    if (!effRep?.canCheckout || !(effRep.totalCost > 0)) {
      throw new Error(
        effRep?.ruleBlockReason || "当前选单尚未满足中国体彩合法出票条件"
      );
    }

    const appPlan =
      cleanWsParams?.planSpec || effRep.syntheticAutoMounted
        ? ws.appliedPlan
        : null;
    const bankerSet = new Set(
      (
        effRep.bankerMatchIds ??
        ws.manualReport?.bankerMatchIds ??
        cleanWsParams?.passSpec?.bankerMatchIds ??
        []
      ).map((id) => String(id))
    );
    const authMap = toAuthoritativeMap(authoritativeMatches);
    const mapSealedLeg = (lg) => {
      const m = authMap?.get(String(lg.matchId));
      const opt = m?.pools?.[lg.poolCode]?.options?.find(
        (o) => String(o.key) === String(lg.optionKey)
      );
      return {
        matchId: lg.matchId,
        matchNumStr: m?.matchNumStr || lg.matchNumStr,
        home: m?.home || lg.home,
        away: m?.away || lg.away,
        kickoff: m?.kickoff || lg.kickoff,
        poolCode: lg.poolCode,
        optionKey: lg.optionKey,
        optionLabel: opt?.label || lg.optionLabel,
        odds: opt?.odds ?? lg.odds,
        goalLine: m?.pools?.HHAD?.goalLine ?? lg.goalLine ?? "-1",
      };
    };

    const builtLines =
      effRep.betCount <= MAX_TRUSTED_SNAPSHOT_LINES
        ? appPlan
          ? appPlan.lines.map((ln, idx) => ({
              id: ln.id || `ap_${idx + 1}`,
              modeLabel: ln.modeLabel,
              multiple: Math.max(1, Math.round(ln.multiple || 1)),
              legs: (ln.legs || []).map(mapSealedLeg),
            }))
          : (effRep.tickets || []).map((tk, idx) => {
              const legs = tk.legs || [];
              const passTxt =
                legs.length === 1
                  ? "单关"
                  : `${legs.length}串1${
                      bankerSet.size > 0 ? `(${bankerSet.size}胆)` : ""
                    }`;
              return {
                id: tk.id || `tk_${idx + 1}`,
                modeLabel: passTxt,
                multiple: Math.max(
                  1,
                  Math.round(
                    Number(tk.multiple ?? cleanWsParams?.multiple) || 1
                  )
                ),
                legs: legs.map(mapSealedLeg),
              };
            })
        : [];

    const snapshot =
      builtLines.length > 0 && builtLines.length <= MAX_TRUSTED_SNAPSHOT_LINES
        ? sanitizeTicketSnapshot(
            {
              matches: [],
              lines: builtLines,
            },
            {
              strictValidate: true,
              trustedServerSnapshot: true,
              authoritativeMatches,
              bankerMatchIds: bankerSet,
            }
          )
        : undefined;

    const resolvedBetCount = Math.max(1, effRep.betCount);
    const resolvedModeLabel =
      String(modeLabel || effRep.modeLabel || "方案")
        .trim()
        .slice(0, 40) || "方案";
    const defaultTitle = appPlan
      ? `${effRep.modeLabel} · ${appPlan.shortTab}(${appPlan.lines.length}张)`
      : `${effRep.modeLabel} · ${resolvedBetCount}注方案`;
    const resolvedTitle =
      String(title || defaultTitle)
        .trim()
        .slice(0, 120) || defaultTitle;

    return {
      sealedFromWorkspace: true,
      snapshot,
      betCount: resolvedBetCount,
      totalCost: effRep.totalCost,
      minPayout: effRep.minPayout,
      maxPayout: effRep.maxPayout,
      modeLabel: resolvedModeLabel,
      title: resolvedTitle,
      bankerMatchIds: Array.from(bankerSet),
    };
  }

  const hasRawSnapshotInput =
    rawSnapshotFallback !== undefined && rawSnapshotFallback !== null;
  const snapshot = sanitizeTicketSnapshot(rawSnapshotFallback, {
    strictValidate: true,
    trustedServerSnapshot: Boolean(trustedServerSnapshot),
    authoritativeMatches,
  });
  if (hasRawSnapshotInput && !snapshot) {
    throw new Error("出票快照参数无效或实票列表为空");
  }
  const snapshotCost = snapshot
    ? snapshot.lines.reduce((s, l) => s + l.multiple * 2, 0)
    : null;
  const resolvedBetCount = clampBetCount(
    betCount ?? (snapshot ? snapshot.lines.length : 1)
  );
  const resolvedModeLabel =
    String(modeLabel || snapshot?.lines?.[0]?.modeLabel || "方案")
      .trim()
      .slice(0, 40) || "方案";
  const resolvedTitle =
    String(title || `${resolvedModeLabel} · ${resolvedBetCount}注方案`)
      .trim()
      .slice(0, 120) || `${resolvedModeLabel} · ${resolvedBetCount}注方案`;

  return {
    sealedFromWorkspace: false,
    snapshot,
    betCount: resolvedBetCount,
    totalCost: snapshotCost,
    minPayout,
    maxPayout,
    modeLabel: resolvedModeLabel,
    title: resolvedTitle,
    bankerMatchIds: snapshot
      ? snapshot.matches.filter((m) => m.isBanker).map((m) => m.matchId)
      : [],
  };
}

function normalizeStatusAndPayout(
  kind,
  rawStatus,
  rawSettledReturn,
  cost,
  paperRefCost
) {
  if (!VALID_STATUSES.has(rawStatus) || rawStatus === "pending") {
    return { status: "pending", settledReturn: 0, netProfit: 0 };
  }
  if (rawStatus === "lost") {
    return {
      status: "lost",
      settledReturn: 0,
      netProfit: kind === "live" ? round2(-cost) : 0,
    };
  }
  const refStake = kind === "live" ? cost : paperRefCost;
  const settledReturn = clampMoney(rawSettledReturn, MAX_PAYOUT);
  if (settledReturn <= 0 && rawStatus === "partial") {
    return {
      status: "lost",
      settledReturn: 0,
      netProfit: kind === "live" ? round2(-cost) : 0,
    };
  }
  if (kind === "live") {
    if (settledReturn <= 0) {
      return { status: "lost", settledReturn: 0, netProfit: round2(-cost) };
    }
    const status = settledReturn + 1e-9 < cost ? "partial" : "won";
    return {
      status,
      settledReturn,
      netProfit: round2(settledReturn - cost),
    };
  }
  if (settledReturn > 0 && refStake > 0) {
    const status = settledReturn + 1e-9 < refStake ? "partial" : "won";
    return { status, settledReturn, netProfit: 0 };
  }
  return {
    status: rawStatus === "partial" ? "partial" : "won",
    settledReturn,
    netProfit: 0,
  };
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind =
    raw.kind === "paper" ? "paper" : raw.kind === "live" ? "live" : null;
  if (!kind || typeof raw.id !== "string") return null;
  const cost = kind === "live" ? clampMoney(raw.cost, MAX_ENTRY_COST) : 0;
  const paperRefCost =
    kind === "paper" ? clampMoney(raw.paperRefCost, MAX_ENTRY_COST) : 0;
  const minPayout = clampMoney(raw.minPayout, MAX_PAYOUT);
  const maxPayout = Math.max(minPayout, clampMoney(raw.maxPayout, MAX_PAYOUT));
  const norm = normalizeStatusAndPayout(
    kind,
    raw.status,
    raw.settledReturn,
    cost,
    paperRefCost
  );
  const snapshot = sanitizeTicketSnapshot(raw.snapshot, {
    strictValidate: false,
    trustedServerSnapshot: true,
  });

  return {
    id: raw.id,
    kind,
    title: String(raw.title || "方案").slice(0, 120),
    modeLabel: String(raw.modeLabel || "方案").slice(0, 40),
    betCount: clampBetCount(raw.betCount),
    cost,
    paperRefCost,
    minPayout,
    maxPayout,
    status: norm.status,
    settledReturn: norm.settledReturn,
    netProfit: norm.netProfit,
    everSettledLoss: Boolean(raw.everSettledLoss) || norm.netProfit < 0,
    manualOverride: Boolean(raw.manualOverride),
    autoSettled: Boolean(raw.autoSettled),
    snapshot,
    settlementDetail:
      raw.settlementDetail && typeof raw.settlementDetail === "object"
        ? raw.settlementDetail
        : undefined,
    createdAt: Number(raw.createdAt) || 0,
    settledAt: norm.status === "pending" ? null : Number(raw.settledAt) || null,
  };
}

function sanitizeDailyLockedLosses(rawLocks) {
  const out = {};
  if (!rawLocks || typeof rawLocks !== "object") return out;
  for (const [id, item] of Object.entries(rawLocks)) {
    if (!item || typeof item !== "object") continue;
    const date = String(item.date || "").slice(0, 10);
    const cost = clampMoney(item.cost, MAX_ENTRY_COST);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && cost > 0) {
      out[id] = { date, cost };
    }
  }
  return out;
}

function buildSnapshot(rec, nowMs) {
  const dailyLimit = clampDailyLimit(rec?.dailyLimit ?? DEFAULT_DAILY_LIMIT);
  const usageDate = beijingDateStr(nowMs);
  const entries = Array.isArray(rec?.entries)
    ? rec.entries.map((e) => ({ ...e }))
    : [];
  const activeIds = new Set(entries.map((e) => e.id));

  let dailyLiveSpent = 0;
  let dailyLockedLossSpent = 0;
  if (rec?.dailyLockedLosses && typeof rec.dailyLockedLosses === "object") {
    for (const [lockId, lock] of Object.entries(rec.dailyLockedLosses)) {
      if (lock && lock.date === usageDate && !activeIds.has(lockId)) {
        dailyLockedLossSpent += clampMoney(lock.cost, MAX_ENTRY_COST);
      }
    }
  }

  let liveSettledCount = 0;
  let liveWonCount = 0;
  let livePartialCount = 0;
  let liveTotalStaked = 0;
  let liveSettledStaked = 0;
  let liveNetProfit = 0;
  let paperCount = 0;
  let paperLostCount = 0;
  let paperPartialCount = 0;
  let paperWonCount = 0;
  let paperSavedAmount = 0;

  for (const e of entries) {
    if (e.kind === "live") {
      liveTotalStaked += e.cost;
      if (beijingDateStr(e.createdAt) === usageDate) {
        dailyLiveSpent += e.cost;
      }
      if (e.status === "won" || e.status === "partial" || e.status === "lost") {
        liveSettledCount += 1;
        liveSettledStaked += e.cost;
        liveNetProfit += e.netProfit;
        if (e.status === "won") {
          liveWonCount += 1;
        } else if (e.status === "partial") {
          livePartialCount += 1;
        }
      }
    } else if (e.kind === "paper") {
      paperCount += 1;
      if (e.status === "lost") {
        paperLostCount += 1;
        paperSavedAmount += e.paperRefCost;
      } else if (e.status === "partial") {
        paperPartialCount += 1;
        paperSavedAmount += Math.max(
          0,
          round2(e.paperRefCost - e.settledReturn)
        );
      } else if (e.status === "won") {
        paperWonCount += 1;
      }
    }
  }

  const roundedSpent = round2(dailyLiveSpent + dailyLockedLossSpent);
  const dailyRemaining = round2(Math.max(0, dailyLimit - roundedSpent));
  const roundedNetProfit = round2(liveNetProfit);

  return {
    dailyLimit,
    usageDate,
    dailyLiveSpent: roundedSpent,
    ...(dailyLockedLossSpent > 0
      ? { dailyLockedLossSpent: round2(dailyLockedLossSpent) }
      : {}),
    dailyRemaining,
    entries,
    stats: {
      liveSettledCount,
      liveWonCount,
      ...(livePartialCount > 0 ? { livePartialCount } : {}),
      liveWinRatePct:
        liveSettledCount > 0
          ? round2((liveWonCount / liveSettledCount) * 100)
          : 0,
      liveTotalStaked: round2(liveTotalStaked),
      liveNetProfit: roundedNetProfit,
      liveRoiPct:
        liveSettledStaked > 0
          ? round2((roundedNetProfit / liveSettledStaked) * 100)
          : 0,
      paperCount,
      paperLostCount,
      ...(paperPartialCount > 0 ? { paperPartialCount } : {}),
      paperWonCount,
      paperSavedAmount: round2(paperSavedAmount),
    },
  };
}

/**
 * 独立个人双轨止损账本管理深模块（按成员隔离、出票快照封存自动对奖、防上头亏损锁死、0o600 原子持久化）
 */
export function createLedgerManager(opts = {}) {
  const ledgerFile = opts.ledgerFile || null;
  const nowFn = opts.nowFn || (() => Date.now());
  const settleFn =
    opts.settleSnapshotFn || settleTicketSnapshotWithOfficialResults;

  const db = {
    users: {},
  };
  // Single-slot 15-second soft undo per user
  const undoSlots = new Map();

  if (ledgerFile && fs.existsSync(ledgerFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
      if (parsed && parsed.users && typeof parsed.users === "object") {
        for (const [uid, rec] of Object.entries(parsed.users)) {
          if (!rec || typeof rec !== "object") continue;
          const cleanEntries = Array.isArray(rec.entries)
            ? rec.entries
                .map(sanitizeEntry)
                .filter(Boolean)
                .slice(0, MAX_ENTRIES_PER_USER)
            : [];
          db.users[uid] = {
            dailyLimit: clampDailyLimit(rec.dailyLimit),
            dailyLockedLosses: sanitizeDailyLockedLosses(rec.dailyLockedLosses),
            entries: cleanEntries,
          };
        }
      }
    } catch {
      // ignore corrupted ledger file
    }
  }

  function pruneStaleLockedLosses(rec, nowMs) {
    if (!rec?.dailyLockedLosses) return;
    const today = beijingDateStr(nowMs);
    for (const [k, v] of Object.entries(rec.dailyLockedLosses)) {
      if (!v || v.date !== today) {
        delete rec.dailyLockedLosses[k];
      }
    }
  }

  function persistNowSync() {
    if (!ledgerFile) return;
    try {
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
      const tmp = `${ledgerFile}.tmp.${process.pid}.${crypto.randomBytes(3).toString("hex")}`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(tmp, ledgerFile);
    } catch {
      // ignore disk write failure
    }
  }

  function ensureUserRecord(uid) {
    if (!db.users[uid]) {
      db.users[uid] = {
        dailyLimit: DEFAULT_DAILY_LIMIT,
        dailyLockedLosses: {},
        entries: [],
      };
    }
    if (!db.users[uid].dailyLockedLosses) {
      db.users[uid].dailyLockedLosses = {};
    }
    return db.users[uid];
  }

  function setUndoSlot(uid, items, nowMs) {
    const token = `undo_${nowMs}_${crypto.randomBytes(3).toString("hex")}`;
    undoSlots.set(uid, {
      token,
      createdAt: nowMs,
      items: items.map((it) => ({
        index: it.index,
        entry: structuredClone(it.entry),
      })),
    });
    return token;
  }

  function hasPendingSnapshots(userId) {
    const uid = String(userId || "").trim();
    const rec = uid ? db.users[uid] : null;
    if (!rec || !Array.isArray(rec.entries)) return false;
    return rec.entries.some(
      (e) =>
        e.snapshot?.lines?.length > 0 &&
        !e.manualOverride &&
        (e.status === "pending" || !e.settlementDetail)
    );
  }

  function autoSettleUserLedger(userId, context = {}) {
    const uid = String(userId || "").trim();
    const now = nowFn();
    const rec = uid ? db.users[uid] : null;
    if (!rec || !Array.isArray(rec.entries) || rec.entries.length === 0) {
      return {
        ok: true,
        newlySettledCount: 0,
        newlySettledTitles: [],
        ledger: buildSnapshot(rec, now),
      };
    }

    const resultsById = context.resultsById ?? new Map();
    const liveMatchesById = context.liveMatchesById ?? null;
    let dirty = false;
    let newlySettledCount = 0;
    const newlySettledTitles = [];

    for (const e of rec.entries) {
      if (!e.snapshot?.lines?.length) continue;
      if (
        e.status !== "pending" &&
        e.settlementDetail &&
        !context.forceRecalcAll
      ) {
        continue;
      }

      const detail = settleFn(e.snapshot, resultsById, {
        stakeCost: e.kind === "live" ? e.cost : 0,
        paperRefCost: e.paperRefCost,
        liveMatchesById,
        nowMs: now,
      });
      e.settlementDetail = detail;
      dirty = true;

      if (!e.manualOverride && detail.status !== "pending") {
        const wasPending = e.status === "pending";
        const norm = normalizeStatusAndPayout(
          e.kind,
          detail.status,
          detail.settledReturn,
          e.cost,
          e.paperRefCost
        );
        e.status = norm.status;
        e.settledReturn = norm.settledReturn;
        e.netProfit = norm.netProfit;
        if (e.kind === "live") {
          e.everSettledLoss = norm.netProfit < 0;
        }
        e.autoSettled = true;
        if (!e.settledAt) e.settledAt = now;
        if (wasPending) {
          newlySettledCount += 1;
          newlySettledTitles.push(e.title);
        }
      }
    }

    if (dirty) {
      pruneStaleLockedLosses(rec, now);
      persistNowSync();
    }
    return {
      ok: true,
      newlySettledCount,
      newlySettledTitles,
      ledger: buildSnapshot(rec, now),
    };
  }

  function getUserLedger(userId) {
    const uid = String(userId || "").trim();
    const rec = uid ? db.users[uid] : null;
    return buildSnapshot(rec, nowFn());
  }

  function mutateUserLedger(userId, payload = {}, callOpts = {}) {
    const uid = String(userId || "").trim();
    if (!uid) {
      throw new Error("无效的授权账号标识");
    }
    const act = String(payload?.action || "");
    const now = nowFn();

    if (act === "set-daily-limit") {
      const rawLimit = payload?.dailyLimit ?? payload?.limit;
      if (
        rawLimit === undefined ||
        rawLimit === null ||
        rawLimit === "" ||
        !Number.isFinite(Number(rawLimit))
      ) {
        throw new Error("请输入有效的每日止损上限金额");
      }
      const rec = ensureUserRecord(uid);
      pruneStaleLockedLosses(rec, now);
      rec.dailyLimit = clampDailyLimit(rawLimit);
      persistNowSync();
      return {
        ok: true,
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === "add-entry") {
      const kind =
        payload?.kind === "paper"
          ? "paper"
          : payload?.kind === "live"
            ? "live"
            : null;
      if (!kind) {
        throw new Error("账本记录类型必须为实买单或模拟观察单");
      }

      const sealed = sealAuthoritativePrintSnapshot({
        workspaceParams: payload?.workspaceParams,
        authoritativeMatches: callOpts.authoritativeMatches,
        rawSnapshotFallback: payload?.snapshot,
        trustedServerSnapshot: Boolean(callOpts.trustedServerSnapshot),
        title: payload?.title,
        modeLabel: payload?.modeLabel,
        betCount: payload?.betCount,
        cost: payload?.cost,
        paperRefCost: payload?.paperRefCost,
        minPayout: payload?.minPayout,
        maxPayout: payload?.maxPayout,
      });
      const snapshot = sealed.snapshot;

      const rec = ensureUserRecord(uid);
      pruneStaleLockedLosses(rec, now);
      const curSnap = buildSnapshot(rec, now);
      const rawCost = sealed.totalCost ?? Number(payload?.cost);
      const rawPaperRef = sealed.totalCost ?? Number(payload?.paperRefCost);

      if (kind === "live") {
        if (!Number.isFinite(rawCost) || rawCost <= 0) {
          throw new Error("实买单投入本金必须大于 0 元");
        }
        const costCheck = round2(Math.min(MAX_ENTRY_COST, rawCost));
        if (
          costCheck > curSnap.dailyRemaining &&
          payload?.forceConfirmed !== true
        ) {
          return {
            ok: false,
            code: "STOP_LOSS_EXCEEDED",
            dailyRemaining: curSnap.dailyRemaining,
            dailyLimit: curSnap.dailyLimit,
            overBy: round2(costCheck - curSnap.dailyRemaining),
            ledger: curSnap,
          };
        }
      }

      const cost = kind === "live" ? clampMoney(rawCost, MAX_ENTRY_COST) : 0;
      const paperRefCost =
        kind === "paper"
          ? clampMoney(
              !Number.isNaN(rawPaperRef) && rawPaperRef > 0
                ? rawPaperRef
                : Number(payload?.cost),
              MAX_ENTRY_COST
            )
          : 0;
      const betCount = clampBetCount(sealed.betCount);
      const modeLabel = sealed.modeLabel;
      const title = sealed.title;
      const minPayout = clampMoney(sealed.minPayout, MAX_PAYOUT);
      const maxPayout = Math.max(
        minPayout,
        clampMoney(sealed.maxPayout, MAX_PAYOUT)
      );

      const entry = {
        id: `ldg_${now}_${crypto.randomBytes(4).toString("hex")}`,
        kind,
        title,
        modeLabel,
        betCount,
        cost,
        paperRefCost,
        minPayout,
        maxPayout,
        status: "pending",
        settledReturn: 0,
        netProfit: 0,
        everSettledLoss: false,
        manualOverride: false,
        autoSettled: false,
        snapshot,
        settlementDetail: snapshot
          ? settleFn(snapshot, new Map(), {
              stakeCost: cost,
              paperRefCost,
              nowMs: now,
            })
          : undefined,
        createdAt: now,
        settledAt: null,
      };

      rec.entries.unshift(entry);
      if (rec.entries.length > MAX_ENTRIES_PER_USER) {
        rec.entries.length = MAX_ENTRIES_PER_USER;
      }
      persistNowSync();
      return {
        ok: true,
        entry: { ...entry },
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === "settle-entry") {
      const entryId = String(payload?.entryId || "").trim();
      const nextStatus = payload?.status;
      if (!VALID_STATUSES.has(nextStatus)) {
        throw new Error("无效的账本结算状态");
      }
      const rec = db.users[uid];
      const target = rec?.entries?.find((e) => e.id === entryId);
      if (!target) {
        throw new Error("未找到对应的账本记录");
      }

      if (nextStatus === "pending") {
        if (target.kind === "live" && target.netProfit < 0) {
          target.everSettledLoss = true;
        }
        target.status = "pending";
        target.settledReturn = 0;
        target.netProfit = 0;
        target.settledAt = null;
        target.manualOverride = false;
        target.autoSettled = false;
      } else if (nextStatus === "won" || nextStatus === "partial") {
        if (target.kind === "live") {
          const passedRet = Number(payload?.settledReturn);
          const fallbackRet =
            target.minPayout > 0
              ? target.minPayout
              : target.maxPayout > 0
                ? target.maxPayout
                : target.cost;
          const settledReturn = round2(
            Number.isFinite(passedRet) && passedRet > 0
              ? Math.min(10_000_000, passedRet)
              : fallbackRet
          );
          const norm = normalizeStatusAndPayout(
            "live",
            nextStatus,
            settledReturn,
            target.cost,
            0
          );
          target.status = norm.status;
          target.settledReturn = norm.settledReturn;
          target.netProfit = norm.netProfit;
          if (norm.netProfit < 0) {
            target.everSettledLoss = true;
          }
        } else {
          const passedRet = Number(payload?.settledReturn);
          const fallbackPaperWonRet = Math.max(
            target.paperRefCost,
            target.minPayout || target.paperRefCost
          );
          const settledReturn =
            Number.isFinite(passedRet) && passedRet > 0
              ? round2(Math.min(10_000_000, passedRet))
              : nextStatus === "won"
                ? fallbackPaperWonRet
                : target.settledReturn;
          const norm = normalizeStatusAndPayout(
            "paper",
            nextStatus,
            settledReturn,
            0,
            target.paperRefCost
          );
          target.status = norm.status;
          target.settledReturn = norm.settledReturn;
          target.netProfit = 0;
        }
        target.manualOverride = true;
        target.autoSettled = false;
        target.settledAt = now;
      } else {
        target.status = "lost";
        target.settledReturn = 0;
        target.netProfit = target.kind === "live" ? round2(-target.cost) : 0;
        if (target.kind === "live") {
          target.everSettledLoss = true;
        }
        target.manualOverride = true;
        target.autoSettled = false;
        target.settledAt = now;
      }

      persistNowSync();
      return {
        ok: true,
        entry: { ...target },
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === "delete-entry") {
      const entryId = String(payload?.entryId || "").trim();
      const rec = db.users[uid];
      const idx = rec?.entries
        ? rec.entries.findIndex((e) => e.id === entryId)
        : -1;
      if (idx === -1) {
        throw new Error("未找到对应的账本记录");
      }
      pruneStaleLockedLosses(rec, now);
      const [removed] = rec.entries.splice(idx, 1);
      const today = beijingDateStr(now);
      let lockedStopLossStake = 0;

      const settledAsLoss =
        removed.netProfit < 0 ||
        removed.everSettledLoss ||
        removed.settlementDetail?.status === "lost" ||
        removed.settlementDetail?.status === "partial";

      if (
        removed.kind === "live" &&
        beijingDateStr(removed.createdAt) === today &&
        settledAsLoss
      ) {
        rec.dailyLockedLosses[removed.id] = {
          date: today,
          cost: removed.cost,
        };
        lockedStopLossStake = removed.cost;
      }

      const undoToken = setUndoSlot(uid, [{ index: idx, entry: removed }], now);
      persistNowSync();
      return {
        ok: true,
        deletedId: entryId,
        undoToken,
        lockedStopLossStake,
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === "clear-settled-paper") {
      const rec = ensureUserRecord(uid);
      pruneStaleLockedLosses(rec, now);
      const removedItems = [];
      const kept = [];
      rec.entries.forEach((e, index) => {
        if (e.kind === "paper" && e.status !== "pending") {
          removedItems.push({ index, entry: e });
        } else {
          kept.push(e);
        }
      });
      if (removedItems.length === 0) {
        return {
          ok: true,
          clearedCount: 0,
          undoToken: undefined,
          ledger: buildSnapshot(rec, now),
        };
      }
      rec.entries = kept;
      const undoToken = setUndoSlot(uid, removedItems, now);
      persistNowSync();
      return {
        ok: true,
        clearedCount: removedItems.length,
        undoToken,
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === "restore-entry") {
      const rec = ensureUserRecord(uid);
      pruneStaleLockedLosses(rec, now);
      const token = String(payload?.undoToken || "").trim();
      const slot = undoSlots.get(uid);
      if (
        !token ||
        !slot ||
        slot.token !== token ||
        now - slot.createdAt > UNDO_TTL_MS
      ) {
        throw new Error("撤销窗口已过期或记录不存在");
      }
      undoSlots.delete(uid);

      const existingIds = new Set(rec.entries.map((e) => e.id));
      const sorted = [...slot.items].sort((a, b) => a.index - b.index);
      let restoredCount = 0;
      for (const item of sorted) {
        if (existingIds.has(item.entry.id)) continue;
        delete rec.dailyLockedLosses[item.entry.id];
        const pos = Math.max(0, Math.min(rec.entries.length, item.index));
        rec.entries.splice(pos, 0, item.entry);
        existingIds.add(item.entry.id);
        restoredCount += 1;
      }
      if (rec.entries.length > MAX_ENTRIES_PER_USER) {
        rec.entries.length = MAX_ENTRIES_PER_USER;
      }
      persistNowSync();
      return {
        ok: true,
        restoredCount,
        ledger: buildSnapshot(rec, now),
      };
    }

    throw new Error("不支持的账本操作类型");
  }

  function deleteUserLedger(userId) {
    const uid = String(userId || "").trim();
    if (uid && db.users[uid]) {
      delete db.users[uid];
      undoSlots.delete(uid);
      persistNowSync();
    }
    return { ok: true };
  }

  return {
    getUserLedger,
    hasPendingSnapshots,
    autoSettleUserLedger,
    mutateUserLedger,
    deleteUserLedger,
  };
}
