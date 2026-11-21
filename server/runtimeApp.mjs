import path from "node:path";
import { createXiaoGaoService } from "./xiaogaoCore.mjs";
import { createAccountManager } from "./accountManager.mjs";
import { createAppRoutes } from "./appRoutes.mjs";
import { createLedgerManager } from "./ledgerManager.mjs";
import { createManualQaEngine } from "./manualQaEngine.mjs";
import { createSecurityShield } from "./securityShield.mjs";

/**
 * 统一服务端运行时装配模块（Node 生产入口、Vite 开发中间件与全栈契约测试共用唯一装配接缝）
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
    appRoutes,
    gateway,
    dispose() {
      xiaogaoService.dispose?.();
    },
  };
}
