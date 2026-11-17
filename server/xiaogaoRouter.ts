import type { IncomingMessage, ServerResponse } from 'node:http';

const OPENCODE_BASE_URL = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
const PRIMARY_MODEL = 'deepseek-v4.1-flash';
const FALLBACK_MODEL = 'glm-5.3-flash';
const SESSION_ID = 'sess_saodiseng_xiaogao_football_v1';

// 短路冷却窗口：当主模型刚报错时，15秒内直接走备选模型保证秒回；
// 一旦超过 15 秒（或后台恢复探测成功），立即自动切回优先尝试主模型 deepseek-v4.1-flash！
const COOLDOWN_MS = 15_000;
const PROBE_INTERVAL_MS = 20_000;

interface RouterHealthState {
  degradedSince: number | null;
  lastError: string | null;
  lastActiveModel: string;
  primarySuccessCount: number;
  fallbackSuccessCount: number;
  probeTimer: ReturnType<typeof setInterval> | null;
}

const state: RouterHealthState = {
  degradedSince: null,
  lastError: null,
  lastActiveModel: PRIMARY_MODEL,
  primarySuccessCount: 0,
  fallbackSuccessCount: 0,
  probeTimer: null,
};

export interface XiaoGaoAnalyzeRequest {
  matchNumStr: string;
  league: string;
  kickoff: string;
  home: string;
  away: string;
  hadOdds: string;
  hhadOdds: string;
  vigSummary: string;
  xgSummary: string;
  oneGoalSharePct: number;
  droppingTrends: string;
  userNote?: string;
}

export interface XiaoGaoAnalyzeResult {
  level: 'high' | 'medium';
  tag: string;
  summary: string;
  priceInStatus: string;
  suggestedDelta: string;
  source: string;
}

async function callOpenCodeModel(
  apiKey: string,
  model: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs = 15_000,
  maxTokens = 1200
): Promise<string> {
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

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(data.error.message || 'Upstream API error');
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty completion content');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function startRecoveryProbe(apiKey: string) {
  if (state.probeTimer) return;
  state.probeTimer = setInterval(async () => {
    if (state.degradedSince === null) {
      if (state.probeTimer) {
        clearInterval(state.probeTimer);
        state.probeTimer = null;
      }
      return;
    }
    try {
      await callOpenCodeModel(
        apiKey,
        PRIMARY_MODEL,
        [{ role: 'user', content: '回复OK' }],
        10_000,
        64
      );
      // 主模型恢复！立即清除降级状态，自动切回 deepseek-v4.1-flash
      state.degradedSince = null;
      state.lastError = null;
      state.lastActiveModel = PRIMARY_MODEL;
      if (state.probeTimer) {
        clearInterval(state.probeTimer);
        state.probeTimer = null;
      }
    } catch {
      // 仍不可用，继续保持备选并等待下一轮探测
      state.degradedSince = Date.now();
    }
  }, PROBE_INTERVAL_MS);
}

/**
 * 核心主备路由：永远优先尝试 deepseek-v4.1-flash；
 * 不可用时自动无缝切换 glm-5.3-flash，并在主模型恢复后自动切回。
 */
export async function invokeWithAutoFailover(
  apiKey: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  options?: { simulatePrimaryDown?: boolean }
): Promise<{ content: string; usedModel: string; fallbackTriggered: boolean }> {
  const now = Date.now();
  const inRecentCooldown =
    state.degradedSince !== null && now - state.degradedSince < COOLDOWN_MS;

  if (!inRecentCooldown) {
    try {
      if (options?.simulatePrimaryDown) {
        throw new Error('Simulated primary model outage');
      }
      const content = await callOpenCodeModel(apiKey, PRIMARY_MODEL, messages);
      // 主模型调用成功 -> 确保恢复标志清空
      state.degradedSince = null;
      state.lastError = null;
      state.lastActiveModel = PRIMARY_MODEL;
      state.primarySuccessCount += 1;
      return { content, usedModel: PRIMARY_MODEL, fallbackTriggered: false };
    } catch (err) {
      state.degradedSince = Date.now();
      state.lastError = err instanceof Error ? err.message : String(err);
      startRecoveryProbe(apiKey);
    }
  }

  // 主模型不可用或处于瞬时故障冷却期内 -> 自动调用备选 glm-5.3-flash
  const content = await callOpenCodeModel(apiKey, FALLBACK_MODEL, messages);
  state.lastActiveModel = FALLBACK_MODEL;
  state.fallbackSuccessCount += 1;
  return { content, usedModel: FALLBACK_MODEL, fallbackTriggered: true };
}

function extractJsonObject(raw: string): Partial<XiaoGaoAnalyzeResult> {
  const cleaned = raw.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Partial<XiaoGaoAnalyzeResult>;
    } catch {
      // fall through
    }
  }
  return { summary: cleaned.slice(0, 160) };
}

export async function analyzeMatchWithXiaoGao(
  apiKey: string,
  req: XiaoGaoAnalyzeRequest
): Promise<XiaoGaoAnalyzeResult> {
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

  const userPrompt = `比赛：${req.matchNumStr} ${req.league} (${req.kickoff}) ${req.home} vs ${req.away}
胜平负水位与真率：${req.hadOdds}
让球盘水位与真率：${req.hhadOdds}
抽水结构：${req.vigSummary}
泊松预期进球：${req.xgSummary}，赢球即净胜1球卡盘占比：${req.oneGoalSharePct}%
盘口官方升降异动：${req.droppingTrends || '暂无剧烈升降'}
${req.userNote ? `用户补充赛前情报：${req.userNote}` : ''}`;

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

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk);
      if (raw.length > 100_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function createXiaoGaoMiddleware(apiKey: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || '';
    if (url.startsWith('/api/xiaogao/status') && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          ok: true,
          configured: Boolean(apiKey),
          preferredPrimary: PRIMARY_MODEL,
          backupFallback: FALLBACK_MODEL,
          degraded: state.degradedSince !== null,
          lastActiveModel: state.lastActiveModel,
          primarySuccessCount: state.primarySuccessCount,
          fallbackSuccessCount: state.fallbackSuccessCount,
        })
      );
      return;
    }

    if (url.startsWith('/api/xiaogao/analyze') && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (!apiKey) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: '未配置 OPENCODE_API_KEY' }));
        return;
      }
      try {
        const body = (await readJsonBody(req)) as unknown as XiaoGaoAnalyzeRequest;
        const result = await analyzeMatchWithXiaoGao(apiKey, body);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, alert: result }));
      } catch (err) {
        res.statusCode = 502;
        res.end(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : '诊盘服务暂时繁忙',
          })
        );
      }
      return;
    }

    next();
  };
}
