import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DAILY_LIMIT = 300;
const MIN_DAILY_LIMIT = 20;
const MAX_DAILY_LIMIT = 100_000;
const MAX_ENTRY_COST = 1_000_000;
const MAX_PAYOUT = 10_000_000;
const MAX_BET_COUNT = 100_000;
const MAX_ENTRIES_PER_USER = 200;

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

function beijingDateStr(nowMs) {
  const d = new Date(nowMs + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'paper' ? 'paper' : raw.kind === 'live' ? 'live' : null;
  if (!kind || typeof raw.id !== 'string') return null;
  const status = ['pending', 'won', 'lost'].includes(raw.status) ? raw.status : 'pending';
  const cost = kind === 'live' ? clampMoney(raw.cost, MAX_ENTRY_COST) : 0;
  const paperRefCost = kind === 'paper' ? clampMoney(raw.paperRefCost, MAX_ENTRY_COST) : 0;
  const settledReturn =
    kind === 'live' && status === 'won' ? clampMoney(raw.settledReturn, MAX_PAYOUT) : 0;
  const minPayout = clampMoney(raw.minPayout, MAX_PAYOUT);
  const maxPayout = Math.max(minPayout, clampMoney(raw.maxPayout, MAX_PAYOUT));
  const netProfit =
    kind === 'live'
      ? status === 'won'
        ? round2(settledReturn - cost)
        : status === 'lost'
          ? round2(-cost)
          : 0
      : 0;
  return {
    id: raw.id,
    kind,
    title: String(raw.title || '方案').slice(0, 120),
    modeLabel: String(raw.modeLabel || '方案').slice(0, 40),
    betCount: clampBetCount(raw.betCount),
    cost,
    paperRefCost,
    minPayout,
    maxPayout,
    status,
    settledReturn,
    netProfit,
    createdAt: Number(raw.createdAt) || 0,
    settledAt: status === 'pending' ? null : Number(raw.settledAt) || null,
  };
}

function buildSnapshot(rec, nowMs) {
  const dailyLimit = clampDailyLimit(rec?.dailyLimit ?? DEFAULT_DAILY_LIMIT);
  const usageDate = beijingDateStr(nowMs);
  const entries = Array.isArray(rec?.entries) ? rec.entries.map((e) => ({ ...e })) : [];

  let dailyLiveSpent = 0;
  let liveSettledCount = 0;
  let liveWonCount = 0;
  let liveTotalStaked = 0;
  let liveSettledStaked = 0;
  let liveNetProfit = 0;
  let paperCount = 0;
  let paperSavedAmount = 0;

  for (const e of entries) {
    if (e.kind === 'live') {
      liveTotalStaked += e.cost;
      if (beijingDateStr(e.createdAt) === usageDate) {
        dailyLiveSpent += e.cost;
      }
      if (e.status === 'won' || e.status === 'lost') {
        liveSettledCount += 1;
        liveSettledStaked += e.cost;
        liveNetProfit += e.netProfit;
        if (e.status === 'won') {
          liveWonCount += 1;
        }
      }
    } else if (e.kind === 'paper') {
      paperCount += 1;
      if (e.status === 'lost') {
        paperSavedAmount += e.paperRefCost;
      }
    }
  }

  const roundedSpent = round2(dailyLiveSpent);
  const dailyRemaining = round2(Math.max(0, dailyLimit - roundedSpent));
  const roundedNetProfit = round2(liveNetProfit);

  return {
    dailyLimit,
    usageDate,
    dailyLiveSpent: roundedSpent,
    dailyRemaining,
    entries,
    stats: {
      liveSettledCount,
      liveWonCount,
      liveWinRatePct: liveSettledCount > 0 ? round2((liveWonCount / liveSettledCount) * 100) : 0,
      liveTotalStaked: round2(liveTotalStaked),
      liveNetProfit: roundedNetProfit,
      liveRoiPct: liveSettledStaked > 0 ? round2((roundedNetProfit / liveSettledStaked) * 100) : 0,
      paperCount,
      paperSavedAmount: round2(paperSavedAmount),
    },
  };
}

/**
 * 独立个人双轨止损账本管理深模块（按成员隔离、北京时间 00:00 自然日止损重置、0o600 原子持久化）
 */
export function createLedgerManager(opts = {}) {
  const ledgerFile = opts.ledgerFile || null;
  const nowFn = opts.nowFn || (() => Date.now());

  const db = {
    users: {},
  };

  if (ledgerFile && fs.existsSync(ledgerFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      if (parsed && parsed.users && typeof parsed.users === 'object') {
        for (const [uid, rec] of Object.entries(parsed.users)) {
          if (!rec || typeof rec !== 'object') continue;
          const cleanEntries = Array.isArray(rec.entries)
            ? rec.entries.map(sanitizeEntry).filter(Boolean).slice(0, MAX_ENTRIES_PER_USER)
            : [];
          db.users[uid] = {
            dailyLimit: clampDailyLimit(rec.dailyLimit),
            entries: cleanEntries,
          };
        }
      }
    } catch {
      // ignore corrupted ledger file
    }
  }

  function persistNowSync() {
    if (!ledgerFile) return;
    try {
      fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
      const tmp = `${ledgerFile}.tmp.${process.pid}.${crypto.randomBytes(3).toString('hex')}`;
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, ledgerFile);
    } catch {
      // ignore disk write failure
    }
  }

  function ensureUserRecord(uid) {
    if (!db.users[uid]) {
      db.users[uid] = {
        dailyLimit: DEFAULT_DAILY_LIMIT,
        entries: [],
      };
    }
    return db.users[uid];
  }

  function getUserLedger(userId) {
    const uid = String(userId || '').trim();
    const rec = uid ? db.users[uid] : null;
    return buildSnapshot(rec, nowFn());
  }

  function mutateUserLedger(userId, payload = {}) {
    const uid = String(userId || '').trim();
    if (!uid) {
      throw new Error('无效的授权账号标识');
    }
    const act = String(payload?.action || '');
    const now = nowFn();

    if (act === 'set-daily-limit') {
      const rawLimit = payload?.dailyLimit ?? payload?.limit;
      if (
        rawLimit === undefined ||
        rawLimit === null ||
        rawLimit === '' ||
        !Number.isFinite(Number(rawLimit))
      ) {
        throw new Error('请输入有效的每日止损上限金额');
      }
      const rec = ensureUserRecord(uid);
      rec.dailyLimit = clampDailyLimit(rawLimit);
      persistNowSync();
      return {
        ok: true,
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === 'add-entry') {
      const kind = payload?.kind === 'paper' ? 'paper' : payload?.kind === 'live' ? 'live' : null;
      if (!kind) {
        throw new Error('账本记录类型必须为实买单或模拟观察单');
      }

      const rec = ensureUserRecord(uid);
      const curSnap = buildSnapshot(rec, now);
      const rawCost = Number(payload?.cost);
      const rawPaperRef = Number(payload?.paperRefCost);

      if (kind === 'live') {
        if (!Number.isFinite(rawCost) || rawCost <= 0) {
          throw new Error('实买单投入本金必须大于 0 元');
        }
        const cost = round2(Math.min(1_000_000, rawCost));
        if (cost > curSnap.dailyRemaining && payload?.forceConfirmed !== true) {
          return {
            ok: false,
            code: 'STOP_LOSS_EXCEEDED',
            dailyRemaining: curSnap.dailyRemaining,
            dailyLimit: curSnap.dailyLimit,
            overBy: round2(cost - curSnap.dailyRemaining),
            ledger: curSnap,
          };
        }
      }

      const cost = kind === 'live' ? clampMoney(rawCost, MAX_ENTRY_COST) : 0;
      const paperRefCost =
        kind === 'paper'
          ? clampMoney(
              !Number.isNaN(rawPaperRef) && rawPaperRef > 0 ? rawPaperRef : rawCost,
              MAX_ENTRY_COST
            )
          : 0;
      const betCount = clampBetCount(payload?.betCount);
      const modeLabel = String(payload?.modeLabel || '方案').trim().slice(0, 40) || '方案';
      const title =
        String(payload?.title || `${modeLabel} · ${betCount}注方案`)
          .trim()
          .slice(0, 120) || `${modeLabel} · ${betCount}注方案`;
      const minPayout = clampMoney(payload?.minPayout, MAX_PAYOUT);
      const maxPayout = Math.max(minPayout, clampMoney(payload?.maxPayout, MAX_PAYOUT));

      const entry = {
        id: `ldg_${now}_${crypto.randomBytes(4).toString('hex')}`,
        kind,
        title,
        modeLabel,
        betCount,
        cost,
        paperRefCost,
        minPayout,
        maxPayout,
        status: 'pending',
        settledReturn: 0,
        netProfit: 0,
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

    if (act === 'settle-entry') {
      const entryId = String(payload?.entryId || '').trim();
      const nextStatus = payload?.status;
      if (!['pending', 'won', 'lost'].includes(nextStatus)) {
        throw new Error('无效的账本结算状态');
      }
      const rec = db.users[uid];
      const target = rec?.entries?.find((e) => e.id === entryId);
      if (!target) {
        throw new Error('未找到对应的账本记录');
      }

      if (nextStatus === 'pending') {
        target.status = 'pending';
        target.settledReturn = 0;
        target.netProfit = 0;
        target.settledAt = null;
      } else if (nextStatus === 'won') {
        target.status = 'won';
        if (target.kind === 'live') {
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
          target.settledReturn = settledReturn;
          target.netProfit = round2(settledReturn - target.cost);
        } else {
          target.settledReturn = 0;
          target.netProfit = 0;
        }
        target.settledAt = now;
      } else {
        target.status = 'lost';
        target.settledReturn = 0;
        target.netProfit = target.kind === 'live' ? round2(-target.cost) : 0;
        target.settledAt = now;
      }

      persistNowSync();
      return {
        ok: true,
        entry: { ...target },
        ledger: buildSnapshot(rec, now),
      };
    }

    if (act === 'delete-entry') {
      const entryId = String(payload?.entryId || '').trim();
      const rec = db.users[uid];
      const idx = rec?.entries ? rec.entries.findIndex((e) => e.id === entryId) : -1;
      if (idx === -1) {
        throw new Error('未找到对应的账本记录');
      }
      rec.entries.splice(idx, 1);
      persistNowSync();
      return {
        ok: true,
        deletedId: entryId,
        ledger: buildSnapshot(rec, now),
      };
    }

    throw new Error('不支持的账本操作类型');
  }

  function deleteUserLedger(userId) {
    const uid = String(userId || '').trim();
    if (uid && db.users[uid]) {
      delete db.users[uid];
      persistNowSync();
    }
    return { ok: true };
  }

  return {
    getUserLedger,
    mutateUserLedger,
    deleteUserLedger,
  };
}
