import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = process.env.DIST_DIR || path.resolve(__dirname, '../dist');
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'sporttery-snapshot.json');
const PORT = Number(process.env.PORT || 18768);
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = process.env.OPENCODE_API_KEY || '';

const OPENCODE_BASE_URL = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
const PRIMARY_MODEL = 'deepseek-v4.1-flash';
const FALLBACK_MODEL = 'glm-5.3-flash';
const SESSION_ID = 'sess_saodiseng_xiaogao_football_v1';
const COOLDOWN_MS = 15_000;
const PROBE_INTERVAL_MS = 20_000;

const healthState = {
  degradedSince: null,
  lastError: null,
  lastActiveModel: PRIMARY_MODEL,
  primarySuccessCount: 0,
  fallbackSuccessCount: 0,
  probeTimer: null,
};

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

async function callOpenCodeModel(apiKey, model, messages, timeoutMs = 15_000, maxTokens = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENCODE_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-opencode-session': SESSION_ID,
      },
      body: JSON.stringify({
        model,
        reasoning_effort: 'low',
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 180)}`);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Upstream API error');
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Empty completion content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function startRecoveryProbe(apiKey) {
  if (healthState.probeTimer) return;
  healthState.probeTimer = setInterval(async () => {
    if (healthState.degradedSince === null) {
      clearInterval(healthState.probeTimer);
      healthState.probeTimer = null;
      return;
    }
    try {
      await callOpenCodeModel(apiKey, PRIMARY_MODEL, [{ role: 'user', content: '回复OK' }], 10_000, 64);
      healthState.degradedSince = null;
      healthState.lastError = null;
      healthState.lastActiveModel = PRIMARY_MODEL;
      clearInterval(healthState.probeTimer);
      healthState.probeTimer = null;
    } catch {
      healthState.degradedSince = Date.now();
    }
  }, PROBE_INTERVAL_MS);
  healthState.probeTimer.unref?.();
}

async function invokeWithAutoFailover(apiKey, messages) {
  const now = Date.now();
  const inRecentCooldown =
    healthState.degradedSince !== null && now - healthState.degradedSince < COOLDOWN_MS;

  if (!inRecentCooldown) {
    try {
      const content = await callOpenCodeModel(apiKey, PRIMARY_MODEL, messages);
      healthState.degradedSince = null;
      healthState.lastError = null;
      healthState.lastActiveModel = PRIMARY_MODEL;
      healthState.primarySuccessCount += 1;
      return { content, usedModel: PRIMARY_MODEL, fallbackTriggered: false };
    } catch (err) {
      healthState.degradedSince = Date.now();
      healthState.lastError = err instanceof Error ? err.message : String(err);
      startRecoveryProbe(apiKey);
    }
  }

  const content = await callOpenCodeModel(apiKey, FALLBACK_MODEL, messages);
  healthState.lastActiveModel = FALLBACK_MODEL;
  healthState.fallbackSuccessCount += 1;
  return { content, usedModel: FALLBACK_MODEL, fallbackTriggered: true };
}

function extractJsonObject(raw) {
  const cleaned = String(raw || '').replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // ignore
    }
  }
  return { summary: cleaned.slice(0, 160) };
}

async function analyzeMatchWithXiaoGao(apiKey, req) {
  const sysPrompt = `你是“扫地僧小高”，一位极其老辣、冷静克制的中国体彩竞彩足球精算与风控排雷参谋。
请根据用户提供的体彩实盘水位、去水胜率、精算师预期进球(xG)、一球卡盘率、降水异动信号及补充情报，输出靶向排雷结论。
严禁在回复中提及任何AI模型名称，自称或视角保持客观精算师口吻。
必须只输出合法的 JSON 对象（不要任何多余解释文字），字段如下：
{
  "level": "high" 或 "medium",
  "tag": "4到8个字的风险核心标签，如：防一球小胜卡盘 / 警惕浅降诱买 / 调水滞后窗口",
  "summary": "60到95字以内的犀利排雷正文，直指赔率结构隐患、抽水坑或战意盲区",
  "priceInStatus": "25字以内的定价消化度研判，说明当前体彩水位是否已充分消化预期",
  "suggestedDelta": "一句简短的主观胜率微调建议，如：建议主胜微调 -4% 或 维持客观去水胜率"
}`;

  const userPrompt = `比赛：${req.matchNumStr || ''} ${req.league || ''} (${req.kickoff || ''}) ${req.home || ''} vs ${req.away || ''}
胜平负水位与真率：${req.hadOdds || ''}
让球盘水位与真率：${req.hhadOdds || ''}
抽水结构：${req.vigSummary || ''}
泊松预期进球：${req.xgSummary || ''}，赢球即净胜1球卡盘占比：${req.oneGoalSharePct ?? 45}%
盘口官方升降异动：${req.droppingTrends || '暂无剧烈升降'}
${req.userNote ? `用户补充赛前情报：${String(req.userNote).slice(0, 300)}` : ''}`;

  const { content } = await invokeWithAutoFailover(apiKey, [
    { role: 'system', content: sysPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const parsed = extractJsonObject(content);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return {
    level: parsed.level === 'high' ? 'high' : 'medium',
    tag: parsed.tag || '临场盘面排雷',
    summary: parsed.summary || '当前盘口存在隐性抽水与卡盘分化，切忌盲目重注单边低水。',
    priceInStatus: parsed.priceInStatus || '体彩实盘水位已部分反映市场热度',
    suggestedDelta: parsed.suggestedDelta || '建议维持客观去水概率审慎配平',
    source: `扫地僧小高实时诊盘 · ${hhmm}`,
  };
}

function readJsonBody(req, maxBytes = 600_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk);
      if (raw.length > maxBytes) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
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
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(API_KEY),
        preferredPrimary: PRIMARY_MODEL,
        backupFallback: FALLBACK_MODEL,
        degraded: healthState.degradedSince !== null,
        lastActiveModel: healthState.lastActiveModel,
        primarySuccessCount: healthState.primarySuccessCount,
        fallbackSuccessCount: healthState.fallbackSuccessCount,
      });
      return;
    }

    if (pathname === '/api/xiaogao/analyze' && req.method === 'POST') {
      if (!API_KEY) {
        sendJson(res, 500, { ok: false, error: '服务端尚未配置 OPENCODE_API_KEY' });
        return;
      }
      const body = await readJsonBody(req, 120_000);
      const alert = await analyzeMatchWithXiaoGao(API_KEY, body);
      sendJson(res, 200, { ok: true, alert });
      return;
    }

    if (pathname === '/api/sporttery/snapshot') {
      if (req.method === 'GET') {
        if (!fs.existsSync(SNAPSHOT_FILE)) {
          sendJson(res, 404, { ok: false, error: 'No cached snapshot yet' });
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
          sendJson(res, 400, { ok: false, error: 'Invalid sporttery payload' });
        }
        return;
      }
    }

    // Static Assets Serving from DIST_DIR
    let safeRel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '');
    if (safeRel === '/' || safeRel === '') safeRel = '/index.html';
    let filePath = path.join(DIST_DIR, safeRel);

    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
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
    sendJson(res, 502, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[youjing-calculator] listening on http://${HOST}:${PORT}`);
});
