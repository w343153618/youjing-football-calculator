import { parentPort, workerData } from "node:worker_threads";
import { createHistoryCollectorEngine } from "./historyCollectorEngine.mjs";
import { createHistoryStorage } from "./historyStorage.mjs";

if (!parentPort) {
  throw new Error("collectorWorker must run inside node:worker_threads");
}

let virtualNowMs =
  typeof workerData?.initialNowMs === "number" ? workerData.initialNowMs : null;
const useRealClock = Boolean(workerData?.useRealClock);
const nowFn = () =>
  !useRealClock && typeof virtualNowMs === "number" ? virtualNowMs : Date.now();

let nextFetchSeq = 1;
const pendingHostFetches = new Map();

async function bridgedFetch(url, init = {}) {
  if (!workerData?.useHostFetchBridge) {
    return globalThis.fetch(url, init);
  }
  const fetchId = nextFetchSeq++;
  return new Promise((resolve, reject) => {
    pendingHostFetches.set(fetchId, { resolve, reject });
    parentPort.postMessage({
      type: "host-fetch",
      fetchId,
      url: String(url),
      headers: init?.headers || {},
    });
  });
}

let storage = null;
let engine = null;
let autoPollTimer = null;
let shuttingDown = false;

function stopAutoPoll() {
  if (autoPollTimer !== null) {
    clearTimeout(autoPollTimer);
    autoPollTimer = null;
  }
}

function scheduleNextAutoPoll() {
  if (shuttingDown || !workerData?.autoPoll || !engine) return;
  stopAutoPoll();
  const delayMs = engine.computeNextLivePollDelayMs();
  autoPollTimer = setTimeout(async () => {
    if (shuttingDown || !engine) return;
    try {
      await engine.pollLiveBoardOnce();
      await engine.drainPendingOpenQuotes({ maxItems: 6 });
      await engine.drainPendingRecentDetails({ maxItems: 3 });
    } catch {
      // backoff already recorded in endpoint telemetry
    } finally {
      scheduleNextAutoPoll();
    }
  }, delayMs);
}

const initPromise = (async () => {
  storage = await createHistoryStorage({
    dataDir: workerData?.dataDir,
    historyDir: workerData?.historyDir,
    storageBackend: workerData?.storageBackend || "auto",
    sqliteLoader: workerData?.simulateSqliteUnavailable
      ? async () => {
          throw new Error("Simulated unavailable node:sqlite");
        }
      : undefined,
  });

  engine = createHistoryCollectorEngine({
    storage,
    fetchFn: bridgedFetch,
    nowFn,
    onSnapshotEnvelope: (envelope) => {
      parentPort.postMessage({ type: "snapshot", envelope });
    },
  });

  const initialEnv = storage.buildSnapshotEnvelope(nowFn());
  parentPort.postMessage({ type: "ready", envelope: initialEnv });

  if (workerData?.autoPoll) {
    // Trigger initial non-blocking live poll & tier-2/3/4 background warmup
    queueMicrotask(async () => {
      if (shuttingDown || !engine) return;
      try {
        await engine.pollLiveBoardOnce();
        await engine.drainPendingOpenQuotes({ maxItems: 8 });
      } catch {
        // handled via backoff
      } finally {
        scheduleNextAutoPoll();
      }
    });
  }
})();

parentPort.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "host-fetch-res") {
    const pending = pendingHostFetches.get(msg.fetchId);
    if (!pending) return;
    pendingHostFetches.delete(msg.fetchId);
    if (msg.networkError) {
      pending.reject(new Error(msg.networkError));
      return;
    }
    pending.resolve({
      ok: Boolean(msg.ok),
      status: Number(msg.status || 200),
      json: async () => JSON.parse(msg.bodyText || "null"),
      text: async () => String(msg.bodyText || ""),
    });
    return;
  }

  if (msg.type === "rpc") {
    const { reqId, method, args = [] } = msg;
    if (typeof msg.nowMs === "number" && Number.isFinite(msg.nowMs)) {
      virtualNowMs = msg.nowMs;
    }
    try {
      await initPromise;
      if (method === "shutdown") {
        shuttingDown = true;
        stopAutoPoll();
        for (const [, p] of pendingHostFetches.entries()) {
          p.reject(new Error("worker_shutting_down"));
        }
        pendingHostFetches.clear();
        if (storage) {
          storage.close(nowFn());
          storage = null;
        }
        engine = null;
        parentPort.postMessage({ type: "rpc-result", reqId, ok: true });
        parentPort.close();
        return;
      }

      if (!engine || typeof engine[method] !== "function") {
        throw new Error(`Unknown collectorWorker RPC method: ${method}`);
      }
      const result = await engine[method](...args);
      parentPort.postMessage({
        type: "rpc-result",
        reqId,
        ok: true,
        result,
      });
    } catch (err) {
      parentPort.postMessage({
        type: "rpc-result",
        reqId,
        ok: false,
        error: String(err?.message || err || "worker_rpc_error"),
      });
    }
  }
});
