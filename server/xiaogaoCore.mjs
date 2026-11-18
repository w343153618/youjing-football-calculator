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

const INTEL_REDACT_RE =
  /deepseek[\w.-]*|glm[\w.-]*|chatgpt|openai|claude|anthropic|qwen|kimi|moonshot|豆包|字节跳动|opencode|深度求索|智谱清言|大语言模型|人工智能模型/gi;

function sanitizeUserIntelNote(rawNote, maxLen = 280) {
  if (!rawNote) return '';
  return String(rawNote)
    .replace(/ignore\s+previous|system\s+prompt|忽略.*指令|无视.*规则|什么模型|哪个大模型|提示词/gi, '')
    .replace(INTEL_REDACT_RE, '')
    .trim()
    .slice(0, maxLen);
}

function redactModelLeak(str) {
  return String(str || '').replace(INTEL_REDACT_RE, '精算风控内核').trim();
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

function formatTrendArrow(trend) {
  if (trend === 1) return '↑涨';
  if (trend === -1) return '↓降';
  return '';
}

function formatOptionsSummary(options = [], includePrefix = true) {
  return options
    .map(
      (o) =>
        `${o.label}@${Number(o.odds).toFixed(2)}${formatTrendArrow(o.trend)}(${
          includePrefix ? '真率' : ''
        }${Math.round((Number(o.fairProb) || 0) * 100)}%)`
    )
    .join(' / ');
}

function formatMatchTrends(m) {
  const hadTrends = (m?.pools?.HAD?.options || [])
    .filter((o) => o.trend !== 0)
    .map((o) => `主盘${o.label}${formatTrendArrow(o.trend)}`);
  const hhadTrends = (m?.pools?.HHAD?.options || [])
    .filter((o) => o.trend !== 0)
    .map((o) => `${o.label}${formatTrendArrow(o.trend)}`);
  return [...hadTrends, ...hhadTrends].join('、');
}

/**
 * 服务端权威盘口上下文构建（单场点诊）：直接基于服务端赛事快照生成完整排雷输入，杜绝前端拼接提示上下文
 */
export function buildSingleMatchDiagnosisContext(m, userNote) {
  if (!m) throw new Error('Match not found');
  const mq = m.microQuant || {};
  const hadVig = ((Number(m.pools?.HAD?.vig) || 0) * 100).toFixed(1);
  const hafuVig = ((Number(m.pools?.HAFU?.vig) || 0) * 100).toFixed(1);
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    league: m.league,
    kickoff: m.kickoff,
    home: m.home,
    away: m.away,
    hadOdds: formatOptionsSummary(m.pools?.HAD?.options || [], true),
    hhadOdds: formatOptionsSummary(m.pools?.HHAD?.options || [], true),
    vigSummary: `胜平负抽水${hadVig}%，半全场抽水${hafuVig}%`,
    xgSummary: `${m.home} ${mq.homeXG ?? '-'} : ${mq.awayXG ?? '-'} ${m.away} (总预期${mq.totalXG ?? '-'}球)`,
    oneGoalSharePct: Math.round((Number(mq.oneGoalShareOfWins) || 0.45) * 100),
    droppingTrends: formatMatchTrends(m),
    userNote,
  };
}

/**
 * 服务端权威盘口上下文构建（多场串关联合会诊）
 */
export function buildComboDiagnosisContext({
  sourceMode = 'picked',
  targetMatches = [],
  picks = [],
  effectiveReport = null,
  userNote,
}) {
  const safePicks = Array.isArray(picks) ? picks : [];
  const matchesPayload = targetMatches.slice(0, 8).map((m) => {
    const mq = m.microQuant || {};
    const mpicks =
      sourceMode === 'picked' ? safePicks.filter((p) => p && p.matchId === m.id) : [];
    const userPickedDesc =
      mpicks.length > 0
        ? mpicks
            .map((p) => {
              const authPool = m.pools?.[p.poolCode];
              const authOpt = authPool?.options?.find((o) => o.key === p.optionKey);
              if (!authPool || !authOpt) return null;
              return `${authPool.name}[${authOpt.label}@${Number(authOpt.odds).toFixed(2)}]`;
            })
            .filter(Boolean)
            .join(' + ')
        : '';

    return {
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      league: m.league,
      kickoff: m.kickoff,
      home: m.home,
      away: m.away,
      userPickedDesc,
      hadOdds: formatOptionsSummary(m.pools?.HAD?.options || [], false),
      hhadOdds: formatOptionsSummary(m.pools?.HHAD?.options || [], false),
      xgSummary: `${m.home} ${mq.homeXG ?? '-'} : ${mq.awayXG ?? '-'} ${m.away} (合计${mq.totalXG ?? '-'}球)`,
      oneGoalSharePct: Math.round((Number(mq.oneGoalShareOfWins) || 0.45) * 100),
      droppingTrends: formatMatchTrends(m),
    };
  });

  const modeDesc =
    sourceMode === 'picked'
      ? `混合过关已选 ${matchesPayload.length} 场实投串关联合会诊`
      : `自由勾选 ${matchesPayload.length} 场比赛横向联合会诊`;

  const orderSummary =
    sourceMode === 'picked' && effectiveReport && effectiveReport.matchCount >= 2
      ? `${effectiveReport.modeLabel} · 总投入¥${effectiveReport.totalCost} · 保底¥${Number(
          effectiveReport.minPayout || 0
        ).toFixed(1)}~最高¥${Number(effectiveReport.maxPayout || 0).toFixed(1)} · 综合暗扣抽水${
          effectiveReport.avgVigLossPer100
        }% · 真赚钱率${((Number(effectiveReport.realProfitProb) || 0) * 100).toFixed(1)}%`
      : `共勾选 ${matchesPayload.length} 场比赛进行多场联合排雷把脉`;

  return {
    modeDesc,
    orderSummary,
    matches: matchesPayload,
    userNote,
  };
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

  async function invokeWithAutoFailover(apiKey, messages, timeoutMs = 16_000, maxTokens = 1300) {
    const now = nowFn();
    const inRecentCooldown =
      state.degradedSince !== null && now - state.degradedSince < cooldownMs;

    if (!inRecentCooldown) {
      try {
        const content = await transport(apiKey, PRIMARY_MODEL, messages, timeoutMs, maxTokens);
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
      const content = await transport(apiKey, FALLBACK_MODEL, messages, timeoutMs, maxTokens);
      state.activeChannel = 'backup';
      state.fallbackSuccessCount += 1;
      return { content, usedModel: FALLBACK_MODEL, fallbackTriggered: true };
    } catch (fallbackErr) {
      if (inRecentCooldown) {
        const content = await transport(apiKey, PRIMARY_MODEL, messages, timeoutMs, maxTokens);
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

    const safeNote = sanitizeUserIntelNote(req.userNote, 280);
    const userPrompt = `比赛：${req.matchNumStr || ''} ${req.league || ''} (${req.kickoff || ''}) ${req.home || ''} vs ${req.away || ''}
胜平负水位与真实隐含概率：${req.hadOdds || ''}
让球盘水位与真实隐含概率：${req.hhadOdds || ''}
抽水结构：${req.vigSummary || ''}
泊松预期进球：${req.xgSummary || ''}，赢球即净胜1球卡盘占比：${req.oneGoalSharePct ?? 45}%
盘口官方升降异动：${req.droppingTrends || '暂无剧烈升降'}
${safeNote ? `用户补充赛前情报：${safeNote}` : ''}`;

    const { content } = await invokeWithAutoFailover(apiKey, [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = extractJsonObject(content);
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    return {
      level: parsed.level === 'high' ? 'high' : 'medium',
      tag: redactModelLeak(parsed.tag || '临场盘面排雷'),
      summary: redactModelLeak(
        parsed.summary || '当前盘口存在隐性抽水与卡盘分化，切忌盲目重注单边低水。'
      ),
      priceInStatus: redactModelLeak(
        parsed.priceInStatus || '体彩实盘水位已部分反映市场热度'
      ),
      suggestedDelta: redactModelLeak(
        parsed.suggestedDelta || '建议维持客观真实隐含概率审慎配平'
      ),
      source: `扫地僧小高实时诊盘 · ${hhmm}`,
    };
  }

  async function analyzeComboMatches(apiKey, comboReq) {
    const items = Array.isArray(comboReq?.matches) ? comboReq.matches.slice(0, 8) : [];
    if (items.length === 0) {
      throw new Error('Empty combo matches');
    }

    const sysPrompt = `你是“扫地僧小高”，一位极其老辣、冷静克制的中国体彩竞彩足球多场串关风控与精算会诊专家。
用户正在把多场比赛组合在一起（或勾选多场进行横向排雷对比）。请你站在「整张串关系统性生死」的高度进行联合会诊，找出最容易导致整单竹篮打水一场空的“致命短板腿”、同质化盲目追热陷阱、水位红绿升降背离与消息入价消化度（Price-In：即当前赔率是否早已把利好榨干、还是存在调水滞后红利窗口）。
严禁提及任何AI或底层模型名称。必须只输出合法的 JSON 对象（不要任何多余文字），格式如下：
{
  "level": "high" 或 "medium" 或 "low",
  "comboTag": "6到12字的联合会诊核心定性，例如：3串1·警惕次关一球卡盘翻车",
  "summary": "75到120字的整单宏观排雷总评，直指多场组合的连乘抽水损耗、水位升降异动与相关性风险",
  "weakestLeg": "点名这几场里最危险、最可能黑掉整单的那1场比赛及具体死穴原因（40到70字）",
  "structureAdvice": "一针见血的实操改单/拆单/防平/早晚场时间差锁利建议（45到80字）",
  "priceInVerdict": "整单消息入价消化度（Price-In）白话研判：直说这些赔率是已经被降赔榨干（去接盘），还是尚有未调水红利（30到55字）",
  "perMatch": [
    {
      "matchId": "原样返回比赛matchId",
      "matchTitle": "如 周三001 科里蒂巴vs桑托斯",
      "tag": "4到8字单场排雷签",
      "note": "35到65字针对该场盘面及用户所选买法的精算点评",
      "priceInStatus": "20到35字白话说明该场赔率对市场预期的消化程度"
    }
  ]
}`;

    const linesText = items
      .map(
        (it, idx) =>
          `【第${idx + 1}场 | matchId=${it.matchId}】${it.matchNumStr || ''} ${it.league || ''} (${it.kickoff || ''}) ${it.home || ''} vs ${it.away || ''}
  - 用户当前已选买法：${it.userPickedDesc || '暂未下注（请求纯客观盘面联合把脉）'}
  - 胜平负水位(含红升↑/绿降↓)：${it.hadOdds || ''}
  - 让球水位(含红升↑/绿降↓)：${it.hhadOdds || ''}
  - 预期进球xG：${it.xgSummary || ''} | 赢1球卡盘率：${it.oneGoalSharePct ?? 45}% | 异动：${it.droppingTrends || '平稳'}`
      )
      .join('\n');

    const safeComboNote = sanitizeUserIntelNote(comboReq.userNote, 320);
    const userPrompt = `会诊模式：${comboReq.modeDesc || `${items.length}场联合串关会诊`}
串关整体指标：${comboReq.orderSummary || `共 ${items.length} 场比赛`}
${linesText}
${safeComboNote ? `用户补充赛前情报/疑问：${safeComboNote}` : ''}`;

    const { content } = await invokeWithAutoFailover(
      apiKey,
      [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
      24_000,
      1800
    );

    const parsed = extractJsonObject(content);
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const perMatch = Array.isArray(parsed.perMatch)
      ? parsed.perMatch.map((pm, idx) => ({
          matchId: String(pm.matchId || items[idx]?.matchId || ''),
          matchTitle: redactModelLeak(
            pm.matchTitle ||
              (items[idx] ? `${items[idx].matchNumStr} ${items[idx].home}vs${items[idx].away}` : '')
          ),
          tag: redactModelLeak(pm.tag || '联合排雷关注'),
          note: redactModelLeak(pm.note || '注意防范浅盘热度过高与一球小胜卡盘风险。'),
          priceInStatus: redactModelLeak(
            pm.priceInStatus || '当前水位已部分消化市场一致预期'
          ),
        }))
      : items.map((it) => ({
          matchId: String(it.matchId),
          matchTitle: `${it.matchNumStr} ${it.home}vs${it.away}`,
          tag: '盘面重点核查',
          note: '建议结合去水真实胜率与卡盘温度计控制串关风险。',
          priceInStatus: '盘面水位已部分消化预期',
        }));

    return {
      level: parsed.level === 'high' ? 'high' : parsed.level === 'low' ? 'low' : 'medium',
      comboTag: redactModelLeak(parsed.comboTag || `${items.length}场联合串关靶向会诊`),
      summary: redactModelLeak(
        parsed.summary ||
          '多场串关需重点警惕连乘抽水放大与中低水强队小胜卡盘，切忌在已大幅降赔的大热场次上盲目叠串。'
      ),
      weakestLeg: redactModelLeak(
        parsed.weakestLeg || '建议重点复核单场真实过关率最低的一关，必要时补防平局。'
      ),
      structureAdvice: redactModelLeak(
        parsed.structureAdvice || '若场次≥3场，建议拆分为两组2串1或启用容错防爆结构以保留回血底垫。'
      ),
      priceInVerdict: redactModelLeak(
        parsed.priceInVerdict || '热门场次胜平负水位多已提前下调消化利好，半全场或总进球偶有滞后空间。'
      ),
      perMatch,
      matchCount: items.length,
      source: `扫地僧小高 ${items.length}场联合会诊 · ${hhmm}`,
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
    analyzeComboMatches,
    getPublicStatus,
    dispose: stopProbe,
  };
}
