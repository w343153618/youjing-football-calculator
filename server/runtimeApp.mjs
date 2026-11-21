import path from "node:path";
import { createXiaoGaoService } from "./xiaogaoCore.mjs";
import { createAccountManager } from "./accountManager.mjs";
import { createLedgerManager } from "./ledgerManager.mjs";
import { createManualQaEngine } from "./manualQaEngine.mjs";
import { createSecurityAndQuantGateway } from "./securityShield.mjs";

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

  const gateway = createSecurityAndQuantGateway({
    snapshotFile,
    resultsCacheFile,
    banStoreFile,
    accountManager,
    ledgerManager,
    manualQaEngine,
    xiaogaoService,
    getApiKey,
    nowFn: opts.nowFn,
    fuseLoopback: opts.fuseLoopback,
    fuseDurationMs: opts.fuseDurationMs,
    fetchMatches: opts.fetchMatches,
    fetchResults: opts.fetchResults,
  });

  return {
    dataDir,
    xiaogaoService,
    accountManager,
    ledgerManager,
    manualQaEngine,
    gateway,
    dispose() {
      xiaogaoService.dispose?.();
    },
  };
}
