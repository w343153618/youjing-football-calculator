import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createXiaoGaoMiddleware } from './server/xiaogaoRouter';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.OPENCODE_API_KEY || process.env.OPENCODE_API_KEY || '';

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'saodiseng-xiaogao-api',
        configureServer(server) {
          server.middlewares.use(createXiaoGaoMiddleware(apiKey));
        },
      },
    ],
    server: {
      port: 5173,
      proxy: {
        '/api/sporttery': {
          target: 'https://webapi.sporttery.cn',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/sporttery/, ''),
        },
      },
    },
  };
});
