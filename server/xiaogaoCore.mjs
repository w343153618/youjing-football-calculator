const OPENCODE_BASE_URL = 'https://opencode.ai/inference/go/openai/v1/chat/completions';
export const PRIMARY_MODEL = 'deepseek-v4.1-flash';
export const FALLBACK_MODEL = 'glm-5.3-flash';
const SESSION_ID = 'sess_saodiseng_xiaogao_football_v1';

const DEFAULT_COOLDOWN_MS = 15_000;
const DEFAULT_PROBE_INTERVAL_MS = 20_000;

export async function defaultOpenCodeTransport(
  apiKey,
  model,
  messages,
  timeoutMs = 15_000,
  maxTokens = 1200
) {
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
      throw new Error(`Upstream HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.error) throw new Error('Upstream inference error');
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Empty completion content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonObject(raw) {
  const cleaned = String(raw || '').replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      // ignore malformed JSON
    }
  }
  return { summary: cleaned.slice(0, 160) };
}

/**
 * 创建「扫地僧小高」高可用主备路由实例（开发中间件、生产服务与契约测试共用同一接缝）
 * - 永远优先调用主模型 deepseek-v4.1-flash
 * - 主模型异常时自动切换备选 glm-5.3-flash
 * - 后台恢复探测或冷却窗口结束后自动切回主模型
 * - 对外状态与报错严格脱敏，绝不泄露底层模型标识
 */
export function createXiaoGaoService(opts = {}) {
  const transport = opts.transport ?? defaultOpenCodeTransport;
  const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const probeIntervalMs = opts.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  const enableProbe = opts.enableProbe !== false;
  const nowFn = opts.nowFn ?? (() => Date.now());

  const state = {
    degradedSince: null,
    activeChannel: 'primary',
    primarySuccessCount: 0,
    fallbackSuccessCount: 0,
    probeTimer: null,
  };

  function stopProbe() {
    if (state.probeTimer) {
      clearInterval(state.probeTimer);
      state.probeTimer = null;
    }
  }

  function startRecoveryProbe(apiKey) {
    if (!enableProbe || state.probeTimer) return;
    state.probeTimer = setInterval(async () => {
      if (state.degradedSince === null) {
        stopProbe();
        return;
      }
      try {
        await transport(apiKey, PRIMARY_MODEL, [{ role: 'user', content: '回复OK' }], 10_000, 64);
        state.degradedSince = null;
        state.activeChannel = 'primary';
        stopProbe();
      } catch {
        state.degradedSince = nowFn();
      }
    }, probeIntervalMs);
    state.probeTimer.unref?.();
  }

  async function invokeWithAutoFailover(apiKey, messages) {
    const now = nowFn();
    const inRecentCooldown =
      state.degradedSince !== null && now - state.degradedSince < cooldownMs;

    if (!inRecentCooldown) {
      try {
        const content = await transport(apiKey, PRIMARY_MODEL, messages);
        state.degradedSince = null;
        state.activeChannel = 'primary';
        state.primarySuccessCount += 1;
        stopProbe();
        return { content, usedModel: PRIMARY_MODEL, fallbackTriggered: false };
      } catch {
        state.degradedSince = nowFn();
        startRecoveryProbe(apiKey);
      }
    }

    // 主模型暂不可用或处于瞬时冷却期 -> 调用备选模型；若冷却期内备选也偶发报错则立即兜底重试主模型
    try {
      const content = await transport(apiKey, FALLBACK_MODEL, messages);
      state.activeChannel = 'backup';
      state.fallbackSuccessCount += 1;
      return { content, usedModel: FALLBACK_MODEL, fallbackTriggered: true };
    } catch (fallbackErr) {
      if (inRecentCooldown) {
        const content = await transport(apiKey, PRIMARY_MODEL, messages);
        state.degradedSince = null;
        state.activeChannel = 'primary';
        state.primarySuccessCount += 1;
        stopProbe();
        return { content, usedModel: PRIMARY_MODEL, fallbackTriggered: false };
      }
      throw fallbackErr;
    }
  }

  async function analyzeMatch(apiKey, req) {
    const sysPrompt = `你是“扫地僧小高”，一位极其老辣、冷静克制的中国体彩竞彩足球精算与风控排雷参谋。
请根据用户提供的体彩实盘水位、真实隐含概率、精算师预期进球(xG)、一球卡盘率、降水异动信号及补充情报，输出靶向排雷结论。
严禁在回复中提及任何AI或底层模型名称，保持纯粹客观精算师口吻。
必须只输出合法的 JSON 对象（不要任何多余解释文字），字段如下：
{
  "level": "high" 或 "medium",
  "tag": "4到8个字的风险核心标签，如：防一球小胜卡盘 / 警惕浅降诱买 / 调水滞后窗口",
  "summary": "60到95字以内的犀利排雷正文，直指水位结构隐患、抽水坑或战意盲区",
  "priceInStatus": "25字以内的定价消化度研判，说明当前体彩水位是否已充分消化预期",
  "suggestedDelta": "一句简短的主观概率微调建议，如：建议主胜微调 -4% 或 维持客观真实隐含概率"
}`;

    const userPrompt = `比赛：${req.matchNumStr || ''} ${req.league || ''} (${req.kickoff || ''}) ${req.home || ''} vs ${req.away || ''}
胜平负水位与真实隐含概率：${req.hadOdds || ''}
让球盘水位与真实隐含概率：${req.hhadOdds || ''}
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
      suggestedDelta: parsed.suggestedDelta || '建议维持客观真实隐含概率审慎配平',
      source: `扫地僧小高实时诊盘 · ${hhmm}`,
    };
  }

  function getPublicStatus(configured) {
    return {
      ok: true,
      configured: Boolean(configured),
      channel: state.degradedSince !== null ? 'backup' : 'primary',
      degraded: state.degradedSince !== null,
      primarySuccessCount: state.primarySuccessCount,
      fallbackSuccessCount: state.fallbackSuccessCount,
    };
  }

  return {
    invokeWithAutoFailover,
    analyzeMatch,
    getPublicStatus,
    dispose: stopProbe,
  };
}
