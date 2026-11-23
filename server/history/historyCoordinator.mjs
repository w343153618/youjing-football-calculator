import { Worker } from "node:worker_threads";
import {
  HISTORY_SNAPSHOT_SCHEMA_VERSION,
  buildBoardFreshnessMeta,
  buildEmptySnapshotPayload,
  computeSnapshotChecksum,
  formatBeijingMonthDayHM,
  hydrateImmutableHistorySnapshot,
  parseBeijingDateTimeMs,
  splitDateRangeIntoWindows,
} from "./sportteryHistoryNormalizers.mjs";

export {
  HISTORY_SNAPSHOT_SCHEMA_VERSION,
  buildBoardFreshnessMeta,
  formatBeijingMonthDayHM,
  parseBeijingDateTimeMs,
  splitDateRangeIntoWindows,
};

/**
 * 中国体彩历史参考单写者协调器（HTTP 主线程零磁盘/网络 I/O 接缝）：
 * - 默认 enableCollector: false 保持零后台 Worker 副作用；
 * - 开启后拉起唯一 collectorWorker 独占 node:sqlite WAL（不可用时自动降级追加式 JSONL）；
 * - 主线程仅在校验 seq、schemaVersion 与 SHA-256 checksum 通过后原子替换进程私有不可变快照。
 */
export function createSportteryHistoryCoordinator(opts = {}) {
  let enableCollector = Boolean(opts.enableCollector);
  const hasCustomNow = typeof opts.nowFn === "function";
  const nowFn = hasCustomNow ? opts.nowFn : () => Date.now();
  const hasCustomFetch = typeof opts.fetchFn === "function";
  const fetchFn = hasCustomFetch ? opts.fetchFn : globalThis.fetch;
  const autoPoll = opts.autoPoll !== false;

  const initialPayload = buildEmptySnapshotPayload();
  let currentSnapshot = hydrateImmutableHistorySnapshot({
    seq: 0,
    schemaVersion: HISTORY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: nowFn(),
    storageBackend: "memory",
    checksum: computeSnapshotChecksum(initialPayload),
    payload: initialPayload,
  });

  let rejectedSwapCount = 0;
  let worker = null;
  let startPromise = null;
  let started = false;
  let disposed = false;
  let nextRpcId = 1;
  const pendingRpcs = new Map();

  function applySnapshotEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") {
      rejectedSwapCount += 1;
      return false;
    }
    if (envelope.schemaVersion !== HISTORY_SNAPSHOT_SCHEMA_VERSION) {
      rejectedSwapCount += 1;
      return false;
    }
    if (!(Number(envelope.seq) > currentSnapshot.seq)) {
      rejectedSwapCount += 1;
      return false;
    }
    const expectedChecksum = computeSnapshotChecksum(envelope.payload);
    if (expectedChecksum !== envelope.checksum) {
      rejectedSwapCount += 1;
      return false;
    }
    currentSnapshot = hydrateImmutableHistorySnapshot(envelope);
    return true;
  }

  async function handleHostFetch(msg) {
    if (!worker) return;
    try {
      const res = await fetchFn(msg.url, { headers: msg.headers });
      let bodyText = "null";
      if (res && typeof res.text === "function") {
        bodyText = await res.text();
      } else if (res && typeof res.json === "function") {
        bodyText = JSON.stringify(await res.json());
      }
      worker?.postMessage({
        type: "host-fetch-res",
        fetchId: msg.fetchId,
        ok: Boolean(res?.ok),
        status: Number(res?.status ?? 200),
        bodyText,
      });
    } catch (err) {
      worker?.postMessage({
        type: "host-fetch-res",
        fetchId: msg.fetchId,
        ok: false,
        status: 0,
        networkError: String(err?.message || err || "host_fetch_failed"),
      });
    }
  }

  function callWorkerRpc(method, args = []) {
    if (!worker) {
      return Promise.resolve(null);
    }
    const reqId = nextRpcId++;
    return new Promise((resolve, reject) => {
      pendingRpcs.set(reqId, { resolve, reject });
      worker.postMessage({
        type: "rpc",
        reqId,
        method,
        args,
        nowMs: nowFn(),
      });
    });
  }

  async function start({ forceEnable = false } = {}) {
    if (forceEnable) {
      enableCollector = true;
    }
    if (disposed || !enableCollector) return;
    if (started) return;
    if (startPromise) return startPromise;

    startPromise = new Promise((resolve, reject) => {
      let readySettled = false;
      const w = new Worker(new URL("./collectorWorker.mjs", import.meta.url), {
        workerData: {
          dataDir: opts.dataDir,
          historyDir: opts.historyDir,
          storageBackend: opts.storageBackend || "auto",
          simulateSqliteUnavailable: Boolean(opts.simulateSqliteUnavailable),
          useHostFetchBridge: hasCustomFetch,
          useRealClock: !hasCustomNow,
          initialNowMs: nowFn(),
          autoPoll,
        },
      });
      worker = w;

      w.on("message", (msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "ready") {
          if (msg.envelope) {
            applySnapshotEnvelope(msg.envelope);
          }
          started = true;
          if (!readySettled) {
            readySettled = true;
            resolve();
          }
          return;
        }
        if (msg.type === "snapshot") {
          applySnapshotEnvelope(msg.envelope);
          return;
        }
        if (msg.type === "host-fetch") {
          void handleHostFetch(msg);
          return;
        }
        if (msg.type === "rpc-result") {
          const pending = pendingRpcs.get(msg.reqId);
          if (!pending) return;
          pendingRpcs.delete(msg.reqId);
          if (msg.ok) {
            pending.resolve(msg.result);
          } else {
            pending.reject(new Error(msg.error || "worker_rpc_failed"));
          }
        }
      });

      w.on("error", (err) => {
        if (!readySettled) {
          readySettled = true;
          reject(err);
        }
        for (const [, p] of pendingRpcs.entries()) {
          p.reject(err);
        }
        pendingRpcs.clear();
      });

      w.on("exit", () => {
        if (worker === w) {
          worker = null;
          started = false;
        }
        for (const [, p] of pendingRpcs.entries()) {
          p.reject(new Error("collectorWorker exited"));
        }
        pendingRpcs.clear();
      });
    });

    return startPromise;
  }

  async function ingestLiveBoard(callOpts) {
    if (!worker) return null;
    return callWorkerRpc("ingestLiveBoard", [callOpts]);
  }

  function notifyLiveBoardNonBlocking(callOpts) {
    if (!worker || disposed) return;
    void callWorkerRpc("ingestLiveBoard", [callOpts]).catch(() => {});
  }

  async function pollLiveBoardOnce() {
    if (!worker) return null;
    return callWorkerRpc("pollLiveBoardOnce", []);
  }

  async function computeNextLivePollDelayMs() {
    if (!worker) return 180_000;
    return callWorkerRpc("computeNextLivePollDelayMs", []);
  }

  async function drainPendingOpenQuotes(callOpts) {
    if (!worker) return null;
    return callWorkerRpc("drainPendingOpenQuotes", [callOpts]);
  }

  async function drainPendingRecentDetails(callOpts) {
    if (!worker) return null;
    return callWorkerRpc("drainPendingRecentDetails", [callOpts]);
  }

  async function fetchMatchDetailOnDemand(matchId) {
    if (!worker) return null;
    return callWorkerRpc("fetchMatchDetailOnDemand", [matchId]);
  }

  async function backfillMatchOpeningQuotes(matchId, callOpts) {
    if (!worker) return null;
    return callWorkerRpc("backfillMatchOpeningQuotes", [matchId, callOpts]);
  }

  async function backfillMatchHead(matchId, callOpts) {
    if (!worker) return null;
    return callWorkerRpc("backfillMatchHead", [matchId, callOpts]);
  }

  async function backfillResultsWindow(callOpts) {
    if (!worker) return null;
    return callWorkerRpc("backfillResultsWindow", [callOpts]);
  }

  async function backfillResultsRange(callOpts) {
    if (!worker) return null;
    return callWorkerRpc("backfillResultsRange", [callOpts]);
  }

  async function archiveAndPruneHotStorage(callOpts) {
    if (!worker) return null;
    return callWorkerRpc("archiveAndPruneHotStorage", [callOpts]);
  }

  async function verifyColdArchives() {
    if (!worker) return null;
    return callWorkerRpc("verifyColdArchives", []);
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    started = false;
    startPromise = null;
    const w = worker;
    worker = null;
    if (!w) return;

    const exitPromise = new Promise((resolve) => {
      w.once("exit", () => resolve());
    });

    try {
      const reqId = nextRpcId++;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        pendingRpcs.set(reqId, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: () => {
            clearTimeout(timer);
            resolve();
          },
        });
        w.postMessage({
          type: "rpc",
          reqId,
          method: "shutdown",
          args: [],
          nowMs: nowFn(),
        });
      });
    } catch {
      // proceed to terminate
    }
    await w.terminate().catch(() => {});
    await exitPromise;
  }

  return {
    get isStarted() {
      return started;
    },
    get isWorkerRunning() {
      return Boolean(worker);
    },
    get rejectedSwapCount() {
      return rejectedSwapCount;
    },
    getSnapshot() {
      return currentSnapshot;
    },
    applySnapshotEnvelope,
    start,
    ingestLiveBoard,
    notifyLiveBoardNonBlocking,
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
    dispose,
  };
}
