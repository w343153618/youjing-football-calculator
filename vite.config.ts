import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createXiaoGaoService } from './server/xiaogaoCore.mjs';
import { createAccountManager } from './server/accountManager.mjs';
import { createManualQaEngine } from './server/manualQaEngine.mjs';
import { createSecurityAndQuantGateway } from './server/securityShield.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.OPENCODE_API_KEY || process.env.OPENCODE_API_KEY || '';
  const xiaogaoService = createXiaoGaoService();
  const accountManager = createAccountManager({
    accountsFile: path.resolve(process.cwd(), 'data/accounts-db.json'),
    adminCredsFile: path.resolve(process.cwd(), 'data/admin-credentials.txt'),
  });
  const manualQaEngine = createManualQaEngine({
    accountManager,
    xiaogaoService,
    getApiKey: () => apiKey,
  });
  const gateway = createSecurityAndQuantGateway({
    snapshotFile: path.resolve(process.cwd(), 'data/sporttery-snapshot.json'),
    banStoreFile: path.resolve(process.cwd(), 'data/security-bans.json'),
    accountManager,
    manualQaEngine,
    xiaogaoService,
    getApiKey: () => apiKey,
  });

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'youjing-security-and-quant-gateway',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            try {
              const u = new URL(req.url || '/', 'http://localhost');
              const handled = await gateway.handleRequest(req, res, u.pathname);
              if (!handled) next();
            } catch (err) {
              next(err);
            }
          });
        },
      },
    ],
    build: {
      sourcemap: false,
      minify: 'esbuild',
    },
    server: {
      port: 5173,
    },
  };
});
