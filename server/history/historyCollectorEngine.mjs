import { parseSportteryRawJson } from "../quant/sportteryParsers.mjs";
import {
  SPORTTERY_ENDPOINTS,
  buildBoardFreshnessMeta,
  buildFixedBonusUrl,
  buildMatchHeadUrl,
  buildUniformMatchResultUrl,
  extractLiveBoardEvents,
  formatBeijingDate,
  normalizeFixedBonusPayload,
  normalizeUniformMatchResultPayload,
  parseBeijingDateTimeMs,
  sanitizeMatchHeadPayload,
  splitDateRangeIntoWindows,
  subtractCalendarMonthsMs,
} from "./sportteryHistoryNormalizers.mjs";

const DEFAULT_SPORTTERY_HEADERS = Object.freeze({
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Referer: "https://www.sporttery.cn/",
  Accept: "application/json",
});

export function createHistoryCollectorEngine({
  storage,
  fetchFn = globalThis.fetch,
  nowFn = () => Date.now(),
  onSnapshotEnvelope = () => {},
}) {
  function markEndpointStatus(name, patch, nowMs = nowFn()) {
    const prev = storage.state.endpoints[name] || {
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      consecutiveFailures: 0,
      backoffMs: 0,
    };
    storage.state.endpoints = {
      ...storage.state.endpoints,
      [name]: {
        ...prev,
        ...patch,
      },
    };
    storage.persistRecord("meta", "endpoints", storage.state.endpoints, nowMs);
  }

  function publish(nowMs = nowFn()) {
    const env = storage.buildSnapshotEnvelope(nowMs);
    onSnapshotEnvelope(env);
    return env;
  }

  async function fetchJsonChecked(endpointName, url) {
    const nowMs = nowFn();
    try {
      const res = await fetchFn(url, { headers: DEFAULT_SPORTTERY_HEADERS });
      if (!res || !res.ok) {
        const status = res?.status ?? 0;
        const prev = storage.state.endpoints[endpointName];
        const nextFail = (prev?.consecutiveFailures || 0) + 1;
        markEndpointStatus(
          endpointName,
          {
            lastErrorAt: nowMs,
            lastError: `HTTP_${status}`,
            consecutiveFailures: nextFail,
            backoffMs: Math.min(
              300_000,
              5_000 * 2 ** Math.min(6, nextFail - 1)
            ),
          },
          nowMs
        );
        throw new Error(`${endpointName} HTTP ${status}`);
      }
      const json = await res.json();
      markEndpointStatus(
        endpointName,
        {
          lastSuccessAt: nowMs,
          lastError: null,
          consecutiveFailures: 0,
          backoffMs: 0,
        },
        nowMs
      );
      return json;
    } catch (err) {
      const msg = String(err?.message || err || "fetch_failed");
      if (!msg.startsWith(`${endpointName} HTTP `)) {
        const prev = storage.state.endpoints[endpointName];
        const nextFail = (prev?.consecutiveFailures || 0) + 1;
        markEndpointStatus(
          endpointName,
          {
            lastErrorAt: nowMs,
            lastError: msg,
            consecutiveFailures: nextFail,
            backoffMs: Math.min(
              300_000,
              5_000 * 2 ** Math.min(6, nextFail - 1)
            ),
          },
          nowMs
        );
      }
      throw err;
    }
  }

  async function backfillMatchOpeningQuotes(
    matchId,
    { observationOrigin = "live-open-backfill" } = {}
  ) {
    const nowMs = nowFn();
    const json = await fetchJsonChecked(
      "fixedBonus",
      buildFixedBonusUrl(matchId)
    );
    const normalized = normalizeFixedBonusPayload(json, {
      nowMs,
      observationOrigin,
    });
    if (!normalized) return null;
    storage.mergeMatchMeta(normalized.matchMeta, nowMs);
    for (const evt of normalized.quoteEvents) {
      storage.upsertQuoteEvent(normalized.matchMeta.matchId, evt, nowMs);
    }
    publish(nowMs);
    return normalized;
  }

  async function backfillMatchHead(
    matchId,
    { observationOrigin = "recent-detail-backfill" } = {}
  ) {
    const nowMs = nowFn();
    const json = await fetchJsonChecked(
      "matchHead",
      buildMatchHeadUrl(matchId)
    );
    const head = sanitizeMatchHeadPayload(json, { observationOrigin });
    if (!head) return null;
    storage.mergeMatchMeta(head, nowMs);
    publish(nowMs);
    return head;
  }

  /**
   * 单个 <=60 天窗口的全分页（1..pages）拉取与严格核齐门禁：
   * - 中途某页失败：保存已核对页与 nextRetryPage 断点游标，status = "partial"（绝不标 completed）
   * - 全页拉完但唯一 matchId 数 !== expectedTotal：重置 nextRetryPage = 1，status = "partial"（绝不标 completed）
   * - 仅当 1..expectedPages 全部核验成功且唯一 matchId 数与 expectedTotal 完全核齐时，status = "completed"
   */
  async function backfillResultsWindow({
    beginDate,
    endDate,
    observationOrigin = "result-index-backfill",
    force = false,
  }) {
    const subWindows = splitDateRangeIntoWindows(beginDate, endDate, 60);
    if (subWindows.length !== 1) {
      return backfillResultsRange({
        beginDate,
        endDate,
        observationOrigin,
        force,
      });
    }
    const win = subWindows[0];
    const nowMs = nowFn();
    const prevCursor = storage.state.cursors.windows[win.key];
    if (!force && prevCursor?.status === "completed") {
      return {
        windowKey: win.key,
        completed: true,
        cursor: prevCursor,
      };
    }

    const verifiedPageSet = new Set(
      !force && Array.isArray(prevCursor?.verifiedPages)
        ? prevCursor.verifiedPages
        : []
    );
    const uniqueMatchIds = new Set(
      !force && Array.isArray(prevCursor?.uniqueMatchIds)
        ? prevCursor.uniqueMatchIds
        : []
    );
    let expectedPages =
      !force && Number.isFinite(prevCursor?.expectedPages)
        ? prevCursor.expectedPages
        : null;
    let expectedTotal =
      !force && Number.isFinite(prevCursor?.expectedTotal)
        ? prevCursor.expectedTotal
        : null;
    const startPage =
      !force &&
      Number.isInteger(prevCursor?.nextRetryPage) &&
      prevCursor.nextRetryPage >= 1
        ? prevCursor.nextRetryPage
        : 1;

    let pageNo = startPage;
    let lastError = null;

    while (true) {
      if (
        expectedPages !== null &&
        expectedPages > 0 &&
        pageNo > expectedPages
      ) {
        break;
      }
      if (verifiedPageSet.has(pageNo) && expectedPages !== null) {
        pageNo += 1;
        continue;
      }

      try {
        const json = await fetchJsonChecked(
          "uniformMatchResult",
          buildUniformMatchResultUrl({
            beginDate: win.beginDate,
            endDate: win.endDate,
            pageNo,
          })
        );
        const parsed = normalizeUniformMatchResultPayload(json, {
          nowMs: nowFn(),
          observationOrigin,
        });
        expectedTotal = parsed.total;
        expectedPages = parsed.total === 0 ? 0 : Math.max(1, parsed.pages);

        if (parsed.records.length > 0) {
          const curNow = nowFn();
          storage.upsertResultRecords(parsed.records, curNow);
          const recentQueueSet = new Set(
            storage.state.cursors.pendingRecentDetailIds || []
          );
          let queueChanged = false;
          for (const r of parsed.records) {
            const mid = String(r.matchId);
            uniqueMatchIds.add(mid);
            if (r.settled && !r.isVoid && r.matchDate) {
              const mDateMs = parseBeijingDateTimeMs(r.matchDate, "12:00:00");
              if (
                mDateMs !== null &&
                mDateMs <= curNow &&
                curNow - mDateMs <= 120 * 86_400_000
              ) {
                const meta = storage.state.matchesMeta.get(mid);
                if (!meta?.hasFixedBonusOpen || !meta?.hasHeadDetail) {
                  if (!recentQueueSet.has(mid)) {
                    recentQueueSet.add(mid);
                    queueChanged = true;
                  }
                }
              }
            }
          }
          if (queueChanged) {
            const sortedRecent = Array.from(recentQueueSet).sort((idA, idB) => {
              const dA = storage.state.resultRecords.get(idA)?.matchDate || "";
              const dB = storage.state.resultRecords.get(idB)?.matchDate || "";
              return dB.localeCompare(dA);
            });
            storage.state.cursors = {
              ...storage.state.cursors,
              pendingRecentDetailIds: sortedRecent,
            };
          }
        }
        if (expectedPages > 0) {
          verifiedPageSet.add(pageNo);
        }
        if (expectedPages === 0 || pageNo >= expectedPages) {
          break;
        }
        pageNo += 1;
      } catch (err) {
        lastError = String(err?.message || err || "page_fetch_failed");
        break;
      }
    }

    const sortedVerifiedPages = Array.from(verifiedPageSet).sort(
      (a, b) => a - b
    );
    let allPagesVerified = false;
    let firstMissingPage = 1;
    if (expectedPages === 0 && expectedTotal === 0 && lastError === null) {
      allPagesVerified = true;
      firstMissingPage = 1;
    } else if (expectedPages !== null && expectedPages > 0) {
      allPagesVerified = true;
      for (let p = 1; p <= expectedPages; p += 1) {
        if (!verifiedPageSet.has(p)) {
          allPagesVerified = false;
          firstMissingPage = p;
          break;
        }
      }
    }

    const countReconciled =
      expectedTotal !== null && uniqueMatchIds.size === expectedTotal;
    const isCompleted =
      lastError === null && allPagesVerified && countReconciled;

    const nextCursor = {
      key: win.key,
      beginDate: win.beginDate,
      endDate: win.endDate,
      status: isCompleted ? "completed" : "partial",
      expectedPages,
      expectedTotal,
      verifiedPages: sortedVerifiedPages,
      uniqueMatchIds: Array.from(uniqueMatchIds),
      uniqueMatchCount: uniqueMatchIds.size,
      nextRetryPage: isCompleted
        ? expectedPages || 1
        : allPagesVerified && !countReconciled
          ? 1
          : firstMissingPage,
      lastError: isCompleted
        ? null
        : lastError ||
          (!countReconciled
            ? "unique_match_id_count_mismatch"
            : "incomplete_pages"),
      updatedAt: nowFn(),
    };

    // If all pages ran yet count mismatched, clear verifiedPages/uniqueMatchIds for clean full re-verify on retry
    if (!isCompleted && allPagesVerified && !countReconciled) {
      nextCursor.verifiedPages = [];
      nextCursor.uniqueMatchIds = [];
    }

    storage.state.cursors = {
      ...storage.state.cursors,
      windows: {
        ...storage.state.cursors.windows,
        [win.key]: nextCursor,
      },
    };
    storage.persistRecord("meta", "cursors", storage.state.cursors, nowFn());
    publish(nowFn());

    return {
      windowKey: win.key,
      completed: isCompleted,
      cursor: nextCursor,
    };
  }

  async function backfillResultsRange({
    beginDate,
    endDate,
    months = 24,
    observationOrigin = "result-index-backfill",
    force = false,
  } = {}) {
    const nowMs = nowFn();
    const resolvedEnd = endDate || formatBeijingDate(nowMs);
    const resolvedBegin =
      beginDate || formatBeijingDate(subtractCalendarMonthsMs(nowMs, months));
    const windows = splitDateRangeIntoWindows(resolvedBegin, resolvedEnd, 60);
    const results = [];
    let allCompleted = true;
    for (const win of windows) {
      const r = await backfillResultsWindow({
        beginDate: win.beginDate,
        endDate: win.endDate,
        observationOrigin,
        force,
      });
      results.push(r);
      if (!r.completed) allCompleted = false;
    }
    return {
      beginDate: resolvedBegin,
      endDate: resolvedEnd,
      windowCount: windows.length,
      allCompleted,
      windows: results,
    };
  }

  function recordSamplingCoverage(nowMs, matchCount) {
    const intervals = Array.isArray(storage.state.samplingIntervals)
      ? storage.state.samplingIntervals.map((x) => ({ ...x }))
      : [];
    const MAX_CONTIGUOUS_GAP_MS = 15 * 60_000;
    const tail = intervals[intervals.length - 1];
    if (tail && nowMs - tail.lastVerifiedAt <= MAX_CONTIGUOUS_GAP_MS) {
      tail.lastVerifiedAt = Math.max(tail.lastVerifiedAt, nowMs);
      tail.pollCount = (tail.pollCount || 1) + 1;
      tail.matchCount = matchCount;
    } else {
      intervals.push({
        startedAt: nowMs,
        lastVerifiedAt: nowMs,
        pollCount: 1,
        matchCount,
      });
    }
    storage.state.samplingIntervals = intervals;
    storage.persistRecord("meta", "samplingIntervals", intervals, nowMs);
  }

  function reconcileFreshBoardPoolAbsences(matches, nowMs) {
    const prevBoard = storage.state.lastFreshBoardPools;
    const intervals = Array.isArray(storage.state.naturalMissingPoolIntervals)
      ? storage.state.naturalMissingPoolIntervals.map((x) => ({ ...x }))
      : [];
    const nextBoardMatches = {};
    let intervalsDirty = false;

    for (const m of matches || []) {
      if (!m?.id) continue;
      const matchId = String(m.id);
      const kickoffMs = m.kickoffDateTime
        ? parseBeijingDateTimeMs(m.kickoffDateTime)
        : m.matchDate && m.kickoff
          ? parseBeijingDateTimeMs(m.matchDate, m.kickoff)
          : null;
      const beforeKickoff = kickoffMs === null || nowMs < kickoffMs;

      const prevMatchEntry = prevBoard?.matches?.[matchId];
      const sellingPools = {};
      const poolCodes = ["HAD", "HHAD", "TTG", "HAFU", "CRS"];
      const anyPoolSelling = poolCodes.some(
        (code) =>
          m.pools?.[code]?.selling !== false &&
          (m.pools?.[code]?.options?.length ?? 0) > 0
      );

      for (const code of poolCodes) {
        const p = m.pools?.[code];
        const isPoolSelling =
          Boolean(p) &&
          p.selling !== false &&
          Array.isArray(p.options) &&
          p.options.some((o) => Number(o?.odds) > 1);

        const openInterval = intervals.find(
          (it) =>
            it.matchId === matchId &&
            it.poolCode === code &&
            it.resumedAt === null
        );

        if (isPoolSelling) {
          sellingPools[code] = nowMs;
          if (openInterval) {
            openInterval.resumedAt = nowMs;
            intervalsDirty = true;
          }
        } else if (beforeKickoff && anyPoolSelling) {
          const prevSeenSellingAt =
            prevMatchEntry?.sellingPools?.[code] ?? null;
          if (openInterval) {
            openInterval.lastObservedAbsentAt = nowMs;
            intervalsDirty = true;
          } else if (prevSeenSellingAt !== null) {
            intervals.push({
              matchId,
              poolCode: code,
              kind: "pool-absent-after-selling",
              lastSeenSellingAt: prevSeenSellingAt,
              firstAbsentAfterLastSeenAt: nowMs,
              lastObservedAbsentAt: nowMs,
              resumedAt: null,
            });
            intervalsDirty = true;
          } else {
            intervals.push({
              matchId,
              poolCode: code,
              kind: "natural-missing-pool",
              lastSeenSellingAt: null,
              firstAbsentAfterLastSeenAt: nowMs,
              lastObservedAbsentAt: nowMs,
              resumedAt: null,
            });
            intervalsDirty = true;
          }
        }
      }

      nextBoardMatches[matchId] = {
        kickoffEpochMs: kickoffMs,
        sellingPools,
      };
    }

    storage.state.lastFreshBoardPools = {
      observedAt: nowMs,
      matches: nextBoardMatches,
    };
    storage.persistRecord(
      "meta",
      "lastFreshBoardPools",
      storage.state.lastFreshBoardPools,
      nowMs
    );
    if (intervalsDirty) {
      storage.state.naturalMissingPoolIntervals = intervals;
      storage.persistRecord(
        "meta",
        "naturalMissingPoolIntervals",
        intervals,
        nowMs
      );
    }
  }

  async function ingestLiveBoard({ matches = [], boardMeta = null } = {}) {
    const nowMs = nowFn();
    const resolvedBoardMeta =
      boardMeta ||
      buildBoardFreshnessMeta({
        source: "official-live",
        boardState: matches.length > 0 ? "fresh" : "empty-board-fallback",
        lastValidBoardAt:
          matches.length > 0
            ? nowMs
            : (storage.state.boardMeta?.lastValidBoardAt ?? null),
      });

    storage.state.boardMeta = resolvedBoardMeta;
    storage.persistRecord("meta", "boardMeta", resolvedBoardMeta, nowMs);

    // Fallback / empty / timeout / maintenance board: NEVER write pool absence events or fake live frames!
    if (resolvedBoardMeta.boardState !== "fresh") {
      publish(nowMs);
      return {
        boardMeta: resolvedBoardMeta,
        ingestedMatches: 0,
      };
    }

    recordSamplingCoverage(nowMs, matches.length);
    reconcileFreshBoardPoolAbsences(matches, nowMs);

    const { matchMetas, matchQuoteEvents } = extractLiveBoardEvents(
      matches,
      nowMs
    );
    const openQueue = new Set(storage.state.cursors.pendingOpenQuoteIds || []);
    let queueDirty = false;

    for (const meta of matchMetas) {
      storage.mergeMatchMeta(meta, nowMs);
      const storedMeta = storage.state.matchesMeta.get(meta.matchId);
      if (!storedMeta?.hasFixedBonusOpen && !openQueue.has(meta.matchId)) {
        openQueue.add(meta.matchId);
        queueDirty = true;
      }
    }
    for (const { matchId, event } of matchQuoteEvents) {
      storage.upsertQuoteEvent(matchId, event, nowMs);
    }
    if (queueDirty) {
      storage.state.cursors = {
        ...storage.state.cursors,
        pendingOpenQuoteIds: Array.from(openQueue),
      };
      storage.persistRecord("meta", "cursors", storage.state.cursors, nowMs);
    }

    publish(nowMs);
    return {
      boardMeta: resolvedBoardMeta,
      ingestedMatches: matchMetas.length,
    };
  }

  async function drainPendingOpenQuotes({ maxItems = 32 } = {}) {
    const queue = [...(storage.state.cursors.pendingOpenQuoteIds || [])];
    const batch = queue.slice(0, Math.max(1, maxItems));
    const remaining = new Set(queue);
    let processed = 0;

    for (const matchId of batch) {
      try {
        await backfillMatchOpeningQuotes(matchId, {
          observationOrigin: "live-open-backfill",
        });
        remaining.delete(matchId);
        processed += 1;
      } catch {
        // retain in queue for retry
      }
    }

    storage.state.cursors = {
      ...storage.state.cursors,
      pendingOpenQuoteIds: Array.from(remaining),
    };
    storage.persistRecord("meta", "cursors", storage.state.cursors, nowFn());
    publish(nowFn());
    return { processed, remaining: remaining.size };
  }

  async function drainPendingRecentDetails({ maxItems = 24 } = {}) {
    const queue = [...(storage.state.cursors.pendingRecentDetailIds || [])];
    const batch = queue.slice(0, Math.max(1, maxItems));
    const remaining = new Set(queue);
    let processed = 0;

    for (const matchId of batch) {
      try {
        await backfillMatchOpeningQuotes(matchId, {
          observationOrigin: "recent-detail-backfill",
        });
        await backfillMatchHead(matchId, {
          observationOrigin: "recent-detail-backfill",
        });
        remaining.delete(matchId);
        processed += 1;
      } catch {
        // retain for retry
      }
    }

    storage.state.cursors = {
      ...storage.state.cursors,
      pendingRecentDetailIds: Array.from(remaining),
    };
    storage.persistRecord("meta", "cursors", storage.state.cursors, nowFn());
    publish(nowFn());
    return { processed, remaining: remaining.size };
  }

  async function fetchMatchDetailOnDemand(matchId) {
    const mid = String(matchId || "").trim();
    if (!mid) return null;
    const quotes = await backfillMatchOpeningQuotes(mid, {
      observationOrigin: "on-demand-id",
    });
    const head = await backfillMatchHead(mid, {
      observationOrigin: "on-demand-id",
    });
    return { matchId: mid, quotes, head };
  }

  let inFlightLivePoll = null;

  async function pollLiveBoardOnce() {
    if (inFlightLivePoll) return inFlightLivePoll;
    inFlightLivePoll = (async () => {
      const nowMs = nowFn();
      const prevValidAt = storage.state.boardMeta?.lastValidBoardAt ?? null;
      try {
        const json = await fetchJsonChecked(
          "liveCalculator",
          SPORTTERY_ENDPOINTS.liveCalculator
        );
        const parsed = parseSportteryRawJson(json);
        if (parsed.length === 0) {
          return ingestLiveBoard({
            matches: [],
            boardMeta: buildBoardFreshnessMeta({
              source: prevValidAt !== null ? "cached-snapshot" : "fallback",
              boardState: "empty-board-fallback",
              lastValidBoardAt: prevValidAt,
            }),
          });
        }
        return ingestLiveBoard({
          matches: parsed,
          boardMeta: buildBoardFreshnessMeta({
            source: "official-live",
            boardState: "fresh",
            lastValidBoardAt: nowMs,
          }),
        });
      } catch (err) {
        const msg = String(err?.message || "");
        const isMaint = /HTTP[_\s]50[0234]/.test(msg);
        return ingestLiveBoard({
          matches: [],
          boardMeta: buildBoardFreshnessMeta({
            source: prevValidAt !== null ? "cached-snapshot" : "fallback",
            boardState: isMaint ? "maintenance-fallback" : "timeout-fallback",
            lastValidBoardAt: prevValidAt,
          }),
        });
      } finally {
        inFlightLivePoll = null;
      }
    })();
    return inFlightLivePoll;
  }

  function computeNextLivePollDelayMs(randomFn = Math.random) {
    const nowMs = nowFn();
    const liveEp = storage.state.endpoints.liveCalculator;
    if (liveEp?.consecutiveFailures > 0) {
      const backoff = Math.min(
        300_000,
        10_000 * 2 ** Math.min(5, liveEp.consecutiveFailures - 1)
      );
      return backoff + Math.floor(randomFn() * 3_000);
    }
    let nearestKickoffDeltaMs = Infinity;
    const freshMatches = storage.state.lastFreshBoardPools?.matches || {};
    for (const info of Object.values(freshMatches)) {
      if (
        typeof info?.kickoffEpochMs === "number" &&
        info.kickoffEpochMs > nowMs
      ) {
        nearestKickoffDeltaMs = Math.min(
          nearestKickoffDeltaMs,
          info.kickoffEpochMs - nowMs
        );
      }
    }
    if (nearestKickoffDeltaMs <= 30 * 60_000) {
      return 30_000 + Math.floor(randomFn() * 6_000);
    }
    if (nearestKickoffDeltaMs <= 120 * 60_000) {
      return 60_000 + Math.floor(randomFn() * 10_000);
    }
    if (Number.isFinite(nearestKickoffDeltaMs)) {
      return 120_000 + Math.floor(randomFn() * 15_000);
    }
    return 180_000 + Math.floor(randomFn() * 20_000);
  }

  async function archiveAndPruneHotStorage(callOpts = {}) {
    const res = storage.archiveAndPruneHotStorage({
      nowMs: nowFn(),
      ...callOpts,
    });
    publish(nowFn());
    return res;
  }

  async function verifyColdArchives() {
    return storage.verifyColdArchives();
  }

  return {
    publish,
    ingestLiveBoard,
    pollLiveBoardOnce,
    computeNextLivePollDelayMs,
    drainPendingOpenQuotes,
    drainPendingRecentDetails,
    fetchMatchDetailOnDemand,
    backfillMatchOpeningQuotes,
    backfillMatchHead,
    backfillResultsWindow,
    backfillResultsRange,
    archiveAndPruneHotStorage,
    verifyColdArchives,
  };
}
