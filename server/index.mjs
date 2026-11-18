import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createXiaoGaoService } from './xiaogaoCore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.resolve(__dirname, '../dist'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.resolve(__dirname, '../data'));
const SNAPSHOT_FILE = path.join(DATA_DIR, 'sporttery-snapshot.json');
const PORT = Number(process.env.PORT || 18768);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.OPENCODE_API_KEY || '';

const xiaogaoService = createXiaoGaoService();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function readJsonBody(req, maxBytes = 600_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      raw += String(chunk);
      if (raw.length > maxBytes) {
        settled = true;
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function sendJson(res, statusCode, payload) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function isSafeInsideDir(baseDir, candidatePath) {
  const rel = path.relative(baseDir, candidatePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    const pathname = u.pathname;

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'youjing-football-calculator',
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }

    if (pathname === '/api/xiaogao/status' && req.method === 'GET') {
      sendJson(res, 200, xiaogaoService.getPublicStatus(Boolean(API_KEY)));
      return;
    }

    if (pathname === '/api/xiaogao/analyze' && req.method === 'POST') {
      if (!API_KEY) {
        sendJson(res, 500, { ok: false, error: '服务端尚未配置诊盘凭证' });
        return;
      }
      const body = await readJsonBody(req, 120_000);
      const alert = await xiaogaoService.analyzeMatch(API_KEY, body);
      sendJson(res, 200, { ok: true, alert });
      return;
    }

    if (pathname === '/api/sporttery/snapshot') {
      if (req.method === 'GET') {
        if (!fs.existsSync(SNAPSHOT_FILE)) {
          sendJson(res, 404, { ok: false, error: '暂无缓存快照' });
          return;
        }
        const raw = await fsp.readFile(SNAPSHOT_FILE, 'utf-8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(raw);
        return;
      }
      if (req.method === 'POST') {
        const body = await readJsonBody(req, 1_500_000);
        if (Array.isArray(body?.value?.matchInfoList) && body.value.matchInfoList.length > 0) {
          await fsp.mkdir(DATA_DIR, { recursive: true });
          await fsp.writeFile(SNAPSHOT_FILE, JSON.stringify(body), 'utf-8');
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 400, { ok: false, error: '无效的实盘快照结构' });
        }
        return;
      }
    }

    // Unknown /api/* routes MUST return 404 JSON rather than SPA index.html
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: 'API endpoint not found' });
      return;
    }

    // Static Assets Serving from DIST_DIR with strict path.relative containment
    let decodedPath = '/';
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      sendJson(res, 400, { ok: false, error: 'Malformed URI' });
      return;
    }

    const relReq = decodedPath === '/' || decodedPath === '' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    let filePath = path.resolve(DIST_DIR, relReq);

    if (!isSafeInsideDir(DIST_DIR, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Build artifacts not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (pathname.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    const rawBuf = await fsp.readFile(filePath);
    const acceptEnc = String(req.headers['accept-encoding'] || '');
    if (
      acceptEnc.includes('gzip') &&
      rawBuf.length > 1024 &&
      ['.html', '.js', '.mjs', '.css', '.json', '.svg'].includes(ext)
    ) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.end(zlib.gzipSync(rawBuf));
      return;
    }

    res.end(rawBuf);
  } catch (err) {
    console.error('[youjing-prod] request error:', err);
    sendJson(res, 502, {
      ok: false,
      error: '服务请求繁忙，请稍后再试',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[youjing-calculator] listening on http://${HOST}:${PORT}`);
});
