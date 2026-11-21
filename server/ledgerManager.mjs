import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { settleTicketSnapshotWithOfficialResults } from "./quantEngine.mjs";

const DEFAULT_DAILY_LIMIT = 300;
const MIN_DAILY_LIMIT = 20;
const MAX_DAILY_LIMIT = 100_000;
const MAX_ENTRY_COST = 1_000_000;
const MAX_PAYOUT = 10_000_000;
const MAX_BET_COUNT = 100_000;
const MAX_ENTRIES_PER_USER = 200;
const MAX_SNAPSHOT_MATCHES = 15;
const MAX_SNAPSHOT_PICKS_PER_MATCH = 31;
const MAX_SNAPSHOT_LINES = 512;
const MAX_SNAPSHOT_LEGS_PER_LINE = 8;
const MAX_UNDO_RECORDS_PER_USER = 8;
const UNDO_TTL_MS = 5 * 60_000;

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

function clampOdds(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(10_000, Number(n.toFixed(4)));
}

function beijingDateStr(nowMs) {
  const d = new Date(nowMs + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function sanitizeTicketSnapshot(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const rawMatches = Array.isArray(raw.matches)
    ? raw.matches.slice(0, MAX_SNAPSHOT_MATCHES)
    : [];
  const rawLines = Array.isArray(raw.lines)
    ? raw.lines.slice(0, MAX_SNAPSHOT_LINES)
    : [];
  if (rawLines.length === 0) return undefined;

  const matches = [];
  for (const m of rawMatches) {
    if (!m || typeof m !== "object") continue;
    const matchId = String(m.matchId ?? "")
      .trim()
      .slice(0, 32);
    if (!matchId) continue;
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
      picks.push({
        poolCode,
        optionKey,
        optionLabel: String(p.optionLabel || optionKey).slice(0, 24),
        odds: clampOdds(p.odds),
        goalLine:
          p.goalLine !== undefined ? String(p.goalLine).slice(0, 8) : undefined,
      });
    }
    matches.push({
      matchId,
      matchNumStr: String(m.matchNumStr || matchId).slice(0, 20),
      home: String(m.home || "").slice(0, 32),
      away: String(m.away || "").slice(0, 32),
      kickoff: String(m.kickoff || "").slice(0, 16),
      businessDate: m.businessDate
        ? String(m.businessDate).slice(0, 12)
        : undefined,
      goalLine:
        m.goalLine !== undefined ? String(m.goalLine).slice(0, 8) : undefined,
      isBanker: Boolean(m.isBanker),
      picks,
    });
  }

  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i];
    if (!ln || typeof ln !== "object" || !Array.isArray(ln.legs)) continue;
    const seenMatchIds = new Set();
    const legs = [];
    for (const lg of ln.legs.slice(0, MAX_SNAPSHOT_LEGS_PER_LINE)) {
      if (!lg || typeof lg !== "object") continue;
      const matchId = String(lg.matchId ?? "")
        .trim()
        .slice(0, 32);
      const poolCode = String(lg.poolCode || "").toUpperCase();
      const optionKey = String(lg.optionKey ?? "")
        .trim()
        .slice(0, 16);
      if (!matchId || !VALID_POOLS.has(poolCode) || !optionKey) continue;
      if (seenMatchIds.has(matchId)) continue;
      seenMatchIds.add(matchId);
      legs.push({
        matchId,
        matchNumStr: lg.matchNumStr
          ? String(lg.matchNumStr).slice(0, 20)
          : undefined,
        home: lg.home ? String(lg.home).slice(0, 32) : undefined,
        away: lg.away ? String(lg.away).slice(0, 32) : undefined,
        kickoff: lg.kickoff ? String(lg.kickoff).slice(0, 16) : undefined,
        poolCode,
        optionKey,
        optionLabel: String(lg.optionLabel || optionKey).slice(0, 24),
        odds: clampOdds(lg.odds),
        goalLine:
          lg.goalLine !== undefined
            ? String(lg.goalLine).slice(0, 8)
            : undefined,
      });
    }
    if (legs.length === 0) continue;
    const mult = Math.max(
      1,
      Math.min(9999, Math.round(Number(ln.multiple) || 1))
    );
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
  return { matches, lines };
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
  // Paper ticket: settledReturn may be 0 when legacy manual mark "won" had no snapshot
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
  const snapshot = sanitizeTicketSnapshot(raw.snapshot);

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
    dailyLockedLossSpent: round2(dailyLockedLossSpent),
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
  // Per-user ephemeral undo buffer (not persisted to disk; bounded to MAX_UNDO_RECORDS_PER_USER)
  const undoBuffers = new Map();

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

  function pushUndoRecord(uid, items, nowMs) {
    const token = `undo_${nowMs}_${crypto.randomBytes(3).toString("hex")}`;
    const list = (undoBuffers.get(uid) || []).filter(
      (r) => nowMs - r.createdAt <= UNDO_TTL_MS
    );
    list.unshift({
      token,
      createdAt: nowMs,
      items: items.map((it) => ({
        index: it.index,
        entry: structuredClone(it.entry),
      })),
    });
    if (list.length > MAX_UNDO_RECORDS_PER_USER) {
      list.length = MAX_UNDO_RECORDS_PER_USER;
    }
    undoBuffers.set(uid, list);
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
      const detail = settleFn(e.snapshot, resultsById, {
        stakeCost: e.kind === "live" ? e.cost : 0,
        paperRefCost: e.paperRefCost,
        liveMatchesById,
      });
      const prevDetailJson = JSON.stringify(e.settlementDetail || null);
      const nextDetailJson = JSON.stringify(detail);
      if (prevDetailJson !== nextDetailJson) {
        e.settlementDetail = detail;
        dirty = true;
      }

      if (!e.manualOverride && detail.status !== "pending") {
        const wasPending = e.status === "pending";
        const norm = normalizeStatusAndPayout(
          e.kind,
          detail.status,
          detail.settledReturn,
          e.cost,
          e.paperRefCost
        );
        if (
          e.status !== norm.status ||
          e.settledReturn !== norm.settledReturn ||
          e.netProfit !== norm.netProfit ||
          !e.autoSettled
        ) {
          e.status = norm.status;
          e.settledReturn = norm.settledReturn;
          e.netProfit = norm.netProfit;
          e.autoSettled = true;
          if (!e.settledAt) e.settledAt = now;
          dirty = true;
          if (wasPending) {
            newlySettledCount += 1;
            newlySettledTitles.push(e.title);
          }
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

  function mutateUserLedger(userId, payload = {}) {
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

      const rec = ensureUserRecord(uid);
      pruneStaleLockedLosses(rec, now);
      const curSnap = buildSnapshot(rec, now);
      const rawCost = Number(payload?.cost);
      const rawPaperRef = Number(payload?.paperRefCost);

      if (kind === "live") {
        if (!Number.isFinite(rawCost) || rawCost <= 0) {
          throw new Error("实买单投入本金必须大于 0 元");
        }
        const cost = round2(Math.min(1_000_000, rawCost));
        if (cost > curSnap.dailyRemaining && payload?.forceConfirmed !== true) {
          return {
            ok: false,
            code: "STOP_LOSS_EXCEEDED",
            dailyRemaining: curSnap.dailyRemaining,
            dailyLimit: curSnap.dailyLimit,
            overBy: round2(cost - curSnap.dailyRemaining),
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
                : rawCost,
              MAX_ENTRY_COST
            )
          : 0;
      const betCount = clampBetCount(payload?.betCount);
      const modeLabel =
        String(payload?.modeLabel || "方案")
          .trim()
          .slice(0, 40) || "方案";
      const title =
        String(payload?.title || `${modeLabel} · ${betCount}注方案`)
          .trim()
          .slice(0, 120) || `${modeLabel} · ${betCount}注方案`;
      const minPayout = clampMoney(payload?.minPayout, MAX_PAYOUT);
      const maxPayout = Math.max(
        minPayout,
        clampMoney(payload?.maxPayout, MAX_PAYOUT)
      );
      const snapshot = sanitizeTicketSnapshot(payload?.snapshot);

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
        manualOverride: false,
        autoSettled: false,
        snapshot,
        settlementDetail: snapshot
          ? settleFn(snapshot, new Map(), {
              stakeCost: cost,
              paperRefCost,
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
        } else {
          const passedRet = Number(payload?.settledReturn);
          const settledReturn =
            Number.isFinite(passedRet) && passedRet > 0
              ? round2(Math.min(10_000_000, passedRet))
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

      // Anti-tilt stop-loss lock: deleting a same-day settled losing/underwater live entry does NOT refund daily quota
      if (
        removed.kind === "live" &&
        beijingDateStr(removed.createdAt) === today &&
        removed.status !== "pending" &&
        removed.netProfit < 0
      ) {
        rec.dailyLockedLosses[removed.id] = {
          date: today,
          cost: removed.cost,
        };
        lockedStopLossStake = removed.cost;
      }

      const undoToken = pushUndoRecord(
        uid,
        [{ index: idx, entry: removed }],
        now
      );
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
      const undoToken = pushUndoRecord(uid, removedItems, now);
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
      const list = (undoBuffers.get(uid) || []).filter(
        (r) => now - r.createdAt <= UNDO_TTL_MS
      );
      const foundIdx = token
        ? list.findIndex((r) => r.token === token)
        : list.length > 0
          ? 0
          : -1;
      if (foundIdx === -1) {
        throw new Error("撤销窗口已过期或记录不存在");
      }
      const [record] = list.splice(foundIdx, 1);
      undoBuffers.set(uid, list);

      const existingIds = new Set(rec.entries.map((e) => e.id));
      const sorted = [...record.items].sort((a, b) => a.index - b.index);
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
      undoBuffers.delete(uid);
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
