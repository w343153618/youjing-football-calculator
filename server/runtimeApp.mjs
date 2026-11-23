import path from "node:path";
import { createAccountManager } from "./accountManager.mjs";
import { createAppRoutes } from "./appRoutes.mjs";
import { createSportteryHistoryCoordinator } from "./history/historyCoordinator.mjs";
import { createLedgerManager } from "./ledgerManager.mjs";
import { createManualQaEngine } from "./manualQaEngine.mjs";
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

  const enableHistoryCollector = Boolean(opts.enableHistoryCollector);
  const historyCoordinator =
    opts.historyCoordinator ||
    createSportteryHistoryCoordinator({
      dataDir,
      historyDir: opts.historyDir,
      enableCollector: enableHistoryCollector,
      autoPoll: opts.historyAutoPoll !== false,
      storageBackend: opts.historyStorageBackend || "auto",
      simulateSqliteUnavailable: Boolean(opts.simulateSqliteUnavailable),
      fetchFn: opts.historyFetchFn || opts.fetchFn,
      nowFn: opts.nowFn,
    });

  if (enableHistoryCollector) {
    void historyCoordinator.start().catch(() => {});
  }

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
    xiaogaoService,
    getApiKey,
    nowFn: opts.nowFn,
    fetchMatches: opts.fetchMatches,
    fetchResults: opts.fetchResults,
  });

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
    appRoutes,
    gateway,
    async dispose() {
      xiaogaoService.dispose?.();
      await historyCoordinator.dispose?.();
    },
  };
}
