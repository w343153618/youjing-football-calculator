import path from "node:path";
import { createAccountManager } from "./accountManager.mjs";
import { createAppRoutes } from "./appRoutes.mjs";
import { createExposureAndCalibrationMonitor } from "./history/exposureAndCalibrationMonitor.mjs";
import { createSportteryHistoryCoordinator } from "./history/historyCoordinator.mjs";
import { createLedgerManager } from "./ledgerManager.mjs";
import { createManualQaEngine } from "./manualQaEngine.mjs";
import { createPoliteMultisourceGateway } from "./politeScraperGateway.mjs";
import { createSecurityShield } from "./securityShield.mjs";
import { createXiaoGaoService } from "./xiaogaoCore.mjs";

/**
 * 统一服务端运行时装配模块（Node 生产入口、Vite 开发中间件与全栈契约测试共用唯一装配接缝）
 * 默认 enableHistoryCollector = false，确保 vite build 与常规并发单测零后台线程副作用。
 */
export function createYouJingRuntime(opts = {}) {
  const dataDir = path.resolve(
    opts.dataDir || path.resolve(process.cwd(), "data")
  );
  const snapshotFile =
    opts.snapshotFile || path.join(dataDir, "sporttery-snapshot.json");
  const resultsCacheFile =
    opts.resultsCacheFile || path.join(dataDir, "sporttery-results-cache.json");
  const scraperStateFile =
    opts.scraperStateFile || path.join(dataDir, "scraper-anti-ban-state.json");
  const banStoreFile =
    opts.banStoreFile || path.join(dataDir, "security-bans.json");
  const accountsFile =
    opts.accountsFile || path.join(dataDir, "accounts-db.json");
  const ledgerFile = opts.ledgerFile || path.join(dataDir, "ledgers-db.json");
  const adminCredsFile =
    opts.adminCredsFile || path.join(dataDir, "admin-credentials.txt");
  const getApiKey =
    typeof opts.getApiKey === "function"
      ? opts.getApiKey
      : () => String(opts.apiKey || process.env.OPENCODE_API_KEY || "");

  const hasCustomMatchesHook = typeof opts.fetchMatches === "function";
  const enforceMarketHours =
    opts.enforceMarketHours !== undefined
      ? Boolean(opts.enforceMarketHours)
      : typeof opts.nowFn !== "function";

  const politeGateway =
    opts.politeGateway !== undefined
      ? opts.politeGateway
      : hasCustomMatchesHook
        ? null
        : createPoliteMultisourceGateway({
            stateFilePath: scraperStateFile,
            snapshotFilePath: snapshotFile,
            resultsCacheFilePath: resultsCacheFile,
            nowFn: opts.nowFn,
            randomFn: opts.randomFn,
            fetchFn: opts.fetchFn,
            pushHmacSecret: opts.pushHmacSecret,
            enforceMarketHours,
            manualRefreshMinIntervalMs: opts.manualRefreshMinIntervalMs,
            idleThresholdMs: opts.idleThresholdMs,
            perDomainMaxPerMinute: opts.perDomainMaxPerMinute,
          });

  const enableHistoryCollector = Boolean(opts.enableHistoryCollector);
  const historyCoordinator =
    opts.historyCoordinator ||
    createSportteryHistoryCoordinator({
      dataDir,
      historyDir: opts.historyDir,
      enableCollector: enableHistoryCollector,
      // Unified live-board polling is owned by politeGateway when active (eliminates duplicate 30s polling)
      autoPoll:
        opts.historyAutoPoll !== undefined
          ? Boolean(opts.historyAutoPoll)
          : !politeGateway,
      autoBackfill: opts.historyAutoBackfill,
      politeMarketHoursGate: enforceMarketHours,
      backfillTickMs: opts.historyBackfillTickMs,
      initialBackfillDelayMs: opts.historyInitialBackfillDelayMs,
      storageBackend: opts.historyStorageBackend || "auto",
      simulateSqliteUnavailable: Boolean(opts.simulateSqliteUnavailable),
      fetchFn: opts.historyFetchFn || opts.fetchFn,
      nowFn: opts.nowFn,
    });

  if (enableHistoryCollector) {
    void historyCoordinator.start().catch(() => {});
  }

  const exposureMonitor =
    opts.exposureMonitor ||
    createExposureAndCalibrationMonitor({
      nowFn: opts.nowFn,
      onSyncExposureState: (nextState) => {
        historyCoordinator?.notifyWorkbenchExposureNonBlocking?.(nextState);
      },
    });

  const xiaogaoService = createXiaoGaoService({
    transport: opts.xiaogaoTransport,
    enableProbe: opts.enableXiaoGaoProbe,
    nowFn: opts.nowFn,
  });

  const accountManager = createAccountManager({
    accountsFile,
    adminCredsFile,
    nowFn: opts.nowFn,
  });

  const ledgerManager = createLedgerManager({
    ledgerFile,
    nowFn: opts.nowFn,
  });

  const manualQaEngine = createManualQaEngine({
    accountManager,
    xiaogaoService,
    getApiKey,
    nowFn: opts.nowFn,
  });

  const appRoutes = createAppRoutes({
    snapshotFile,
    resultsCacheFile,
    accountManager,
    ledgerManager,
    manualQaEngine,
    historyCoordinator,
    exposureMonitor,
    xiaogaoService,
    politeGateway,
    getApiKey,
    nowFn: opts.nowFn,
    randomFn: opts.randomFn,
    fetchMatches: opts.fetchMatches,
    fetchResults: opts.fetchResults,
  });

  let politeBgTimer = null;
  let runtimeDisposed = false;
  function scheduleNextPoliteBoardSync() {
    if (
      runtimeDisposed ||
      !enableHistoryCollector ||
      !politeGateway ||
      opts.politeBackgroundTimer === false
    ) {
      return;
    }
    if (politeBgTimer !== null) {
      clearTimeout(politeBgTimer);
      politeBgTimer = null;
    }
    const delayMs = politeGateway.computeNextBackgroundDelayMs();
    politeBgTimer = setTimeout(async () => {
      if (runtimeDisposed) return;
      try {
        if (politeGateway.isMarketOpenNow()) {
          await appRoutes.ensureMatchesLoaded("background");
        }
      } catch {
        // handled inside gateway fallback & cooldown
      } finally {
        scheduleNextPoliteBoardSync();
      }
    }, delayMs);
    politeBgTimer.unref?.();
  }

  if (enableHistoryCollector && politeGateway) {
    scheduleNextPoliteBoardSync();
  }

  const shield = createSecurityShield({
    banStoreFile,
    persistDelayMs: opts.persistDelayMs,
    fspImpl: opts.fspImpl,
    accountManager,
    appRoutes,
    nowFn: opts.nowFn,
    fuseLoopback: opts.fuseLoopback,
    fuseDurationMs: opts.fuseDurationMs,
    sessionTtlMs: opts.sessionTtlMs,
    replayWindowMs: opts.replayWindowMs,
  });

  const gateway = {
    ...shield,
    ensureMatchesLoaded: appRoutes.ensureMatchesLoaded,
  };

  return {
    dataDir,
    xiaogaoService,
    accountManager,
    ledgerManager,
    manualQaEngine,
    historyCoordinator,
    exposureMonitor,
    politeGateway,
    appRoutes,
    gateway,
    async dispose() {
      runtimeDisposed = true;
      if (politeBgTimer !== null) {
        clearTimeout(politeBgTimer);
        politeBgTimer = null;
      }
      xiaogaoService.dispose?.();
      await historyCoordinator.dispose?.();
    },
  };
}
