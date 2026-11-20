const OPENCODE_BASE_URL =
  "https://opencode.ai/inference/go/openai/v1/chat/completions";
export const PRIMARY_MODEL = "deepseek-v4.1-flash";
export const FALLBACK_MODEL = "glm-5.3-flash";
const SESSION_ID = "sess_saodiseng_xiaogao_football_v1";

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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-opencode-session": SESSION_ID,
      },
      body: JSON.stringify({
        model,
        reasoning_effort: "low",
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
    if (data.error) throw new Error("Upstream inference error");
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty completion content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

const INTEL_REDACT_RE =
  /deepseek[\w.-]*|glm[\w.-]*|chatgpt|openai|claude|anthropic|qwen|kimi|moonshot|豆包|字节跳动|opencode|深度求索|智谱清言|大语言模型|人工智能模型/gi;

function sanitizeUserIntelNote(rawNote, maxLen = 280) {
  if (!rawNote) return "";
  return String(rawNote)
    .replace(
      /ignore\s+previous|system\s+prompt|忽略.*指令|无视.*规则|什么模型|哪个大模型|提示词/gi,
      ""
    )
    .replace(INTEL_REDACT_RE, "")
    .trim()
    .slice(0, maxLen);
}

function redactModelLeak(str) {
  return String(str || "")
    .replace(INTEL_REDACT_RE, "精算风控内核")
    .trim();
}

function extractJsonObject(raw) {
  const cleaned = String(raw || "")
    .replace(/```json|```/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
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
  if (trend === 1) return "↑涨";
  if (trend === -1) return "↓降";
  return "";
}

function formatOptionsSummary(options = [], includePrefix = true) {
  return options
    .map(
      (o) =>
        `${o.label}@${Number(o.odds).toFixed(2)}${formatTrendArrow(o.trend)}(${
          includePrefix ? "真率" : ""
        }${Math.round((Number(o.fairProb) || 0) * 100)}%)`
    )
    .join(" / ");
}

function formatMatchTrends(m) {
  const hadTrends = (m?.pools?.HAD?.options || [])
    .filter((o) => o.trend !== 0)
    .map((o) => `主盘${o.label}${formatTrendArrow(o.trend)}`);
  const hhadTrends = (m?.pools?.HHAD?.options || [])
    .filter((o) => o.trend !== 0)
    .map((o) => `${o.label}${formatTrendArrow(o.trend)}`);
  return [...hadTrends, ...hhadTrends].join("、");
}

/**
 * 服务端权威盘口上下文构建（单场点诊）：直接基于服务端赛事快照生成完整排雷输入，杜绝前端拼接提示上下文
 */
export function buildSingleMatchDiagnosisContext(m, userNote) {
  if (!m) throw new Error("Match not found");
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
    xgSummary: `${m.home} ${mq.homeXG ?? "-"} : ${mq.awayXG ?? "-"} ${m.away} (总预期${mq.totalXG ?? "-"}球)`,
    oneGoalSharePct: Math.round((Number(mq.oneGoalShareOfWins) || 0.45) * 100),
    droppingTrends: formatMatchTrends(m),
    userNote,
  };
}

function buildDefaultPoolImpact(it) {
  const oneGoalPct = Number(it?.oneGoalSharePct) || 45;
  const totalXgMatch = String(it?.xgSummary || "").match(
    /(?:合计|总预期)\s*([\d.]+)/
  );
  const totalXg = totalXgMatch ? Number(totalXgMatch[1]) : 2.4;
  const spfPart = it?.droppingTrends
    ? `胜平负关注异动（${it.droppingTrends}）是否已透支热度`
    : "胜平负主盘定价均衡，宜结合去水真率把握正路";
  const hhadPart =
    oneGoalPct >= 50
      ? `让球盘赢1球卡盘率达${oneGoalPct}%，慎追单边穿盘宜防让平`
      : `让球盘一球卡盘率${oneGoalPct}%处于常规带`;
  const ttgPart =
    totalXg >= 2.75
      ? `总进球预期${totalXg.toFixed(2)}球偏开放，重心2~4球`
      : totalXg <= 2.15
        ? `总进球预期${totalXg.toFixed(2)}球偏胶着，重心1~2球防闷平`
        : `总进球预期${totalXg.toFixed(2)}球属均衡节奏，重心2~3球`;
  return `${spfPart}；${hhadPart}；${ttgPart}。`;
}

/**
 * 服务端权威盘口上下文构建（多场串关联合会诊 · 含只读精算结构协同上下文，严守 ADR-0002 单向隔离）
 */
export function buildComboDiagnosisContext({
  sourceMode = "picked",
  targetMatches = [],
  picks = [],
  effectiveReport = null,
  appliedPlan = null,
  planSpec = null,
  insights = null,
  userNote,
}) {
  const safePicks = Array.isArray(picks) ? picks : [];
  const planLegsByMatch = new Map();
  if (sourceMode === "picked" && Array.isArray(appliedPlan?.lines)) {
    for (const ln of appliedPlan.lines) {
      for (const lg of ln?.legs || []) {
        if (!lg?.matchId) continue;
        const list = planLegsByMatch.get(lg.matchId) || [];
        const sig = `${lg.poolCode}:${lg.optionKey}`;
        if (!list.some((x) => `${x.poolCode}:${x.optionKey}` === sig)) {
          list.push(lg);
        }
        planLegsByMatch.set(lg.matchId, list);
      }
    }
  }

  const bankerSet = new Set(
    Array.isArray(effectiveReport?.bankerMatchIds)
      ? effectiveReport.bankerMatchIds
      : []
  );
  const bankerMatchLabels = [];
  const dualCoveredMatches = [];
  const matchesPayload = targetMatches.slice(0, 8).map((m) => {
    const mq = m.microQuant || {};
    const isBanker = sourceMode === "picked" && bankerSet.has(m.id);
    if (isBanker) {
      bankerMatchLabels.push(`${m.matchNumStr || m.home}`);
    }
    const planLegs = planLegsByMatch.get(m.id) || [];
    const mpicks =
      sourceMode === "picked"
        ? planLegs.length > 0
          ? planLegs
          : safePicks.filter((p) => p && p.matchId === m.id)
        : [];
    const formattedPicks = mpicks
      .map((p) => {
        const authPool = m.pools?.[p.poolCode];
        const authOpt = authPool?.options?.find(
          (o) => o.key === p.optionKey || o.label === p.optionLabel
        );
        if (!authPool || !authOpt) return null;
        return `${authPool.name}[${authOpt.label}@${Number(authOpt.odds).toFixed(2)}]`;
      })
      .filter(Boolean);

    if (formattedPicks.length >= 2) {
      dualCoveredMatches.push(
        `${m.matchNumStr || m.home}(${formattedPicks.join("+")})`
      );
    }

    const userPickedDesc =
      formattedPicks.length > 0
        ? `${isBanker ? "📌【胆】" : ""}${formattedPicks.join(" + ")}`
        : sourceMode === "picked" && appliedPlan
          ? "精算配单已主动精简剔除本场（未入实票）"
          : "";

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
      xgSummary: `${m.home} ${mq.homeXG ?? "-"} : ${mq.awayXG ?? "-"} ${m.away} (合计${mq.totalXG ?? "-"}球)`,
      oneGoalSharePct: Math.round(
        (Number(mq.oneGoalShareOfWins) || 0.45) * 100
      ),
      paceLabel: mq.paceLabel || "均衡节奏",
      alphaScanSummary: mq.alphaScanSummary || "",
      droppingTrends: formatMatchTrends(m),
    };
  });

  const hasValidReport =
    sourceMode === "picked" &&
    effectiveReport &&
    Number(effectiveReport.totalCost) > 0;
  const uwCount = Number(
    effectiveReport?.underwaterCount ?? appliedPlan?.underwaterCount ?? 0
  );
  const zeroUw = hasValidReport && uwCount === 0;
  const evPctStr = hasValidReport
    ? `${effectiveReport.expectedValueRate >= 0 ? "+" : ""}${(
        Number(effectiveReport.expectedValueRate || 0) * 100
      ).toFixed(1)}%`
    : null;
  const objEvRate = Number(
    effectiveReport?.objectiveEVRate ?? effectiveReport?.expectedValueRate ?? 0
  );
  const objEvPctStr = hasValidReport
    ? `${objEvRate >= 0 ? "+" : ""}${(objEvRate * 100).toFixed(1)}%`
    : null;

  let actuaryContext;
  if (sourceMode === "custom") {
    actuaryContext = {
      originKind: "custom-scan",
      badge: `横向盘面把脉 (${matchesPayload.length}场)`,
      isOptimized: false,
      zeroUnderwater: false,
      underwaterCount: 0,
      shieldSummary:
        "当前为不带实票倍数的横向自由盘面把脉，请聚焦各场水位异动与短板对比。",
      ticketLinesBrief: "",
      hedgeHint: null,
    };
  } else if (
    appliedPlan &&
    Array.isArray(appliedPlan.lines) &&
    appliedPlan.lines.length > 0
  ) {
    const isArchetype = planSpec?.kind === "archetype";
    const cleanSlotName = String(
      appliedPlan.shortTab || appliedPlan.title || "智能方案"
    ).replace(/^[^\u4e00-\u9fa5A-Za-z0-9+]+/, "");
    const originPrefix = isArchetype ? "3+1精算配单" : "三模奖金优化";
    const badge = `${originPrefix}·${cleanSlotName} (${
      zeroUw ? "0假中奖已配平" : `含${uwCount}组局部回血`
    })`;
    const ticketLinesBrief = appliedPlan.lines
      .slice(0, 6)
      .map(
        (ln, idx) =>
          `票#${idx + 1}[${ln.roleLabel || ln.modeLabel}: ${ln.modeLabel}·${ln.multiple}倍(¥${ln.cost})→返¥${Number(
            ln.returnPayout || 0
          ).toFixed(1)}]`
      )
      .join("；");
    const shieldParts = [
      `用户已启用【${originPrefix} · ${cleanSlotName}】（共 ${appliedPlan.lines.length} 张实票，总本金 ¥${effectiveReport?.totalCost ?? appliedPlan.totalCost}）`,
      zeroUw
        ? "已在数学上实现覆盖态 0 假中奖倒贴（消除了中奖亏本隐患）"
        : !isArchetype && !planSpec?.upgradeToBreakeven
          ? `已严守用户当前预算主权做最优减损分配（仍含 ${uwCount} 组局部回血低于总本金${
              typeof appliedPlan.breakevenUpgradeCost === "number"
                ? `，最低全保本门槛 ¥${appliedPlan.breakevenUpgradeCost}`
                : ""
            }）`
          : `属容错回血结构（含 ${uwCount} 组局部回血低于总本金）`,
    ];
    if (bankerMatchLabels.length > 0) {
      shieldParts.push(
        `已启用胆拖定胆（📌【胆】锁定 ${bankerMatchLabels.join("、")} 必出，剔除无胆冗余组合）`
      );
    }
    if (
      typeof appliedPlan.missOneReturn === "number" &&
      appliedPlan.missOneReturn > 0
    ) {
      shieldParts.push(
        `已配置旋转矩阵/多串防错网，错1场保底回血 ¥${appliedPlan.missOneReturn.toFixed(1)}`
      );
    }
    if (dualCoveredMatches.length > 0) {
      shieldParts.push(
        `已在 ${dualCoveredMatches.join("、")} 配置同盘双选对冲一球卡盘/平局分流`
      );
    }
    const hedgeHint = insights?.hedge?.available
      ? insights.hedge.hedgeMode === "reduce-loss"
        ? `早晚场开球间隔 ${insights.hedge.gapText}，首关红单后单关补买 ${insights.hedge.oppositeLabel}@${Number(
            insights.hedge.oppositeOdds
          ).toFixed(
            2
          )}（约¥${insights.hedge.hedgeCost}）仅属减损止血（锁死少亏 -¥${Math.abs(
            Number(insights.hedge.lockedNetProfit) || 0
          ).toFixed(2)}）`
        : `早晚场开球间隔 ${insights.hedge.gapText}，首关红单后可单关补买 ${insights.hedge.oppositeLabel}@${Number(
            insights.hedge.oppositeOdds
          ).toFixed(2)}（约¥${insights.hedge.hedgeCost}）执行时间差对冲`
      : null;
    if (hedgeHint) shieldParts.push(hedgeHint);

    actuaryContext = {
      originKind: isArchetype ? "pareto-3plus1" : "bonus-3mode",
      slotName: cleanSlotName,
      badge,
      isOptimized: true,
      zeroUnderwater: zeroUw,
      underwaterCount: uwCount,
      shieldSummary: shieldParts.join("；"),
      ticketLinesBrief,
      hedgeHint,
    };
  } else {
    const badge = hasValidReport
      ? `手动选单·${effectiveReport.modeLabel} (${
          zeroUw ? "0假中奖" : `⚠️${uwCount}组假中奖倒贴`
        })`
      : `手动待审选单 (${matchesPayload.length}场)`;
    const shieldParts = [];
    if (!hasValidReport) {
      shieldParts.push("当前选单尚未形成有效可出票组合");
    } else if (uwCount > 0) {
      shieldParts.push(
        `当前为手动未配平等倍方案，存在 ${uwCount} 组假中奖倒贴（中奖仍亏本金）`
      );
    } else {
      shieldParts.push(
        `当前为手动等倍方案（${effectiveReport.modeLabel}，暂未启用不等倍护盾或旋转矩阵容错）`
      );
    }
    if (bankerMatchLabels.length > 0) {
      shieldParts.push(
        `已启用胆拖定胆（📌【胆】锁定 ${bankerMatchLabels.join("、")} 必出）`
      );
    }
    if (dualCoveredMatches.length > 0) {
      shieldParts.push(`手动双选覆盖：${dualCoveredMatches.join("、")}`);
    }
    const hedgeHint = insights?.hedge?.available
      ? insights.hedge.hedgeMode === "reduce-loss"
        ? `早晚场间隔 ${insights.hedge.gapText}，首关红单后单关反向补单仅属减损止血（非正收益）`
        : `早晚场间隔 ${insights.hedge.gapText} 支持首关红单后晚场单关反向对冲`
      : null;

    actuaryContext = {
      originKind: "manual",
      slotName: null,
      badge,
      isOptimized: false,
      zeroUnderwater: zeroUw,
      underwaterCount: uwCount,
      shieldSummary: shieldParts.join("；"),
      ticketLinesBrief: "",
      hedgeHint,
    };
  }

  const modeDesc =
    sourceMode === "picked"
      ? `${actuaryContext.badge} · ${matchesPayload.length} 场协同联合会诊`
      : `自由勾选 ${matchesPayload.length} 场比赛横向联合会诊`;

  const orderSummary = hasValidReport
    ? `${effectiveReport.modeLabel} · 总投入¥${effectiveReport.totalCost} · 保底¥${Number(
        effectiveReport.minPayout || 0
      ).toFixed(
        1
      )}~最高¥${Number(effectiveReport.maxPayout || 0).toFixed(1)} · 综合暗扣抽水${
        effectiveReport.avgVigLossPer100
      }% · 严格净赚率${(
        (Number(
          effectiveReport.objectiveStrictNetGainProb ??
            effectiveReport.strictNetGainProb ??
            effectiveReport.realProfitProb
        ) || 0) * 100
      ).toFixed(1)}% · 客观EV ${objEvPctStr}${
        effectiveReport.subjectiveProjectedEVRate != null
          ? `(个人推演EV ${evPctStr})`
          : ""
      } · ${zeroUw ? "0 假中奖倒贴" : `${uwCount} 组假中奖倒贴`}`
    : `共勾选 ${matchesPayload.length} 场比赛进行多场联合排雷把脉`;

  return {
    modeDesc,
    orderSummary,
    actuaryContext,
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
    activeChannel: "primary",
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
        await transport(
          apiKey,
          PRIMARY_MODEL,
          [{ role: "user", content: "回复OK" }],
          10_000,
          64
        );
        state.degradedSince = null;
        state.activeChannel = "primary";
        stopProbe();
      } catch {
        state.degradedSince = nowFn();
      }
    }, probeIntervalMs);
    state.probeTimer.unref?.();
  }

  async function invokeWithAutoFailover(
    apiKey,
    messages,
    timeoutMs = 16_000,
    maxTokens = 1300
  ) {
    const now = nowFn();
    const inRecentCooldown =
      state.degradedSince !== null && now - state.degradedSince < cooldownMs;

    if (!inRecentCooldown) {
      try {
        const content = await transport(
          apiKey,
          PRIMARY_MODEL,
          messages,
          timeoutMs,
          maxTokens
        );
        state.degradedSince = null;
        state.activeChannel = "primary";
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
      const content = await transport(
        apiKey,
        FALLBACK_MODEL,
        messages,
        timeoutMs,
        maxTokens
      );
      state.activeChannel = "backup";
      state.fallbackSuccessCount += 1;
      return { content, usedModel: FALLBACK_MODEL, fallbackTriggered: true };
    } catch (fallbackErr) {
      if (inRecentCooldown) {
        const content = await transport(
          apiKey,
          PRIMARY_MODEL,
          messages,
          timeoutMs,
          maxTokens
        );
        state.degradedSince = null;
        state.activeChannel = "primary";
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
    const userPrompt = `比赛：${req.matchNumStr || ""} ${req.league || ""} (${req.kickoff || ""}) ${req.home || ""} vs ${req.away || ""}
胜平负水位与真实隐含概率：${req.hadOdds || ""}
让球盘水位与真实隐含概率：${req.hhadOdds || ""}
抽水结构：${req.vigSummary || ""}
泊松预期进球：${req.xgSummary || ""}，赢球即净胜1球卡盘占比：${req.oneGoalSharePct ?? 45}%
盘口官方升降异动：${req.droppingTrends || "暂无剧烈升降"}
${safeNote ? `用户补充赛前情报：${safeNote}` : ""}`;

    const { content } = await invokeWithAutoFailover(apiKey, [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ]);

    const parsed = extractJsonObject(content);
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    return {
      level: parsed.level === "high" ? "high" : "medium",
      tag: redactModelLeak(parsed.tag || "临场盘面排雷"),
      summary: redactModelLeak(
        parsed.summary ||
          "当前盘口存在隐性抽水与卡盘分化，切忌盲目重注单边低水。"
      ),
      priceInStatus: redactModelLeak(
        parsed.priceInStatus || "体彩实盘水位已部分反映市场热度"
      ),
      suggestedDelta: redactModelLeak(
        parsed.suggestedDelta || "建议维持客观真实隐含概率审慎配平"
      ),
      source: `扫地僧小高实时诊盘 · ${hhmm}`,
    };
  }

  async function analyzeComboMatches(apiKey, comboReq) {
    const items = Array.isArray(comboReq?.matches)
      ? comboReq.matches.slice(0, 8)
      : [];
    if (items.length === 0) {
      throw new Error("Empty combo matches");
    }

    const actCtx = comboReq.actuaryContext || {
      originKind: "manual",
      badge: `${items.length}场串关会诊`,
      isOptimized: false,
      zeroUnderwater: false,
      underwaterCount: 0,
      shieldSummary: "请结合实盘水位与卡盘温度客观评估整单风险。",
      ticketLinesBrief: "",
      hedgeHint: null,
    };

    const sysPrompt = `你是“扫地僧小高”，一位极其老辣、冷静克制的中国体彩竞彩足球多场串关风控与精算协同会诊参谋。
请严格执行【双维客观协同会诊】，做到既客观犀利绝不报喜不报忧，又与系统精算配单前后逻辑自洽、绝不自我打脸：
1. 第一维（actuarySynergy · 已构筑的精算防线/结构体检）：
   - 若用户已启用【3+1精算配单】或【三模奖金优化】（见输入“当前精算配单防线”），必须如实肯定该数学结构已经帮用户锁住了什么坑（如不等倍配平已实现0假中奖、同盘双选已对冲一球卡盘、或旋转矩阵已锁死错1场回血），切忌再当成散户裸买死串去批评“没做分倍/没防假中奖”！
   - 若用户是手动未优化的等倍裸串且存在假中奖或单边穿盘漏洞，则一针见血指出数学结构软肋。
2. 第二维（residualRisks + priceInVerdict · 盘面消化度与残余实战暗雷）：
   - 客观指出数学分倍无法消除的赛场基本面隐患、水位红升绿降背离、利好已被降赔榨干（Price-In 接盘风险）或极端连黑冷门情景，并给出与精算工作台无缝衔接的可执行动作（structureAdvice）。
严禁提及任何AI或底层模型名称，严禁任何绝对无损稳赚夸大措辞。必须只输出合法的 JSON 对象（不要任何多余文字），格式如下：
{
  "level": "high" 或 "medium" 或 "low",
  "comboTag": "6到14字的协同会诊核心定性，如：稳健保本已配平·防次关利好透支",
  "summary": "65到110字的整单客观总评，兼顾当前配单结构特征与赛场核心矛盾",
  "actuarySynergy": "45到85字：如实评价当前注单已构筑的数学精算防线（或手动裸串尚未弥补的结构漏洞）",
  "residualRisks": "45到85字：直指数学分倍之外仍需警惕的盘口异动、冷门共振或全黑风险边界",
  "weakestLeg": "点名这几场里最易出冷或最需盯防的那1场比赛及具体原因（35到65字）",
  "structureAdvice": "与当前精算状态自洽的下一步实操建议，如维持当前保本分倍、晚场时间差锁利或启用容错缩水（40到75字）",
  "priceInVerdict": "整单消息入价消化度（Price-In）白话研判：说明哪些赔率已提前消化预期、哪些尚有窗口（30到55字）",
  "perMatch": [
    {
      "matchId": "原样返回比赛matchId",
      "matchTitle": "如 周三001 科里蒂巴vs桑托斯",
      "tag": "4到8字单场排雷签",
      "note": "35到65字针对该场盘面、基本面及当前选号方向的精算点评",
      "priceInStatus": "20到35字白话说明该场赔率对市场预期的消化程度",
      "poolImpact": "35到65字具体拆解对【胜平负 / 让球 / 总进球】三个维度的实战影响"
    }
  ]
}`;

    const linesText = items
      .map(
        (it, idx) =>
          `【第${idx + 1}场 | matchId=${it.matchId}】${it.matchNumStr || ""} ${it.league || ""} (${it.kickoff || ""}) ${it.home || ""} vs ${it.away || ""}
  - 当前方案覆盖买法：${it.userPickedDesc || "暂未下注（请求纯客观盘面联合把脉）"}
  - 胜平负水位(含红升↑/绿降↓)：${it.hadOdds || ""}
  - 让球水位(含红升↑/绿降↓)：${it.hhadOdds || ""}
  - 预期进球xG：${it.xgSummary || ""} | 节奏：${it.paceLabel || "均衡节奏"} | 赢1球卡盘率：${it.oneGoalSharePct ?? 45}% | 异动：${it.droppingTrends || "平稳"}`
      )
      .join("\n");

    const safeComboNote = sanitizeUserIntelNote(comboReq.userNote, 320);
    const userPrompt = `会诊模式：${comboReq.modeDesc || `${items.length}场联合串关会诊`}
串关整体指标：${comboReq.orderSummary || `共 ${items.length} 场比赛`}
当前精算配单防线：${actCtx.shieldSummary}${actCtx.ticketLinesBrief ? `\n实票拆解结构：${actCtx.ticketLinesBrief}` : ""}
${linesText}
${safeComboNote ? `用户补充赛前情报/疑问：${safeComboNote}` : ""}`;

    const { content } = await invokeWithAutoFailover(
      apiKey,
      [
        { role: "system", content: sysPrompt },
        { role: "user", content: userPrompt },
      ],
      24_000,
      2000
    );

    const parsed = extractJsonObject(content);
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const rawPerMatch = Array.isArray(parsed.perMatch) ? parsed.perMatch : [];
    const knownIds = new Set(
      items.flatMap((it) =>
        [it.matchId, it.matchNumStr].filter(Boolean).map((v) => String(v))
      )
    );
    const perMatch = items.map((srcItem, idx) => {
      const byId = rawPerMatch.find(
        (x) =>
          String(x?.matchId) === String(srcItem.matchId) ||
          (Boolean(srcItem.matchNumStr) &&
            String(x?.matchId) === String(srcItem.matchNumStr))
      );
      const positional = rawPerMatch[idx];
      const pm =
        byId ??
        (positional &&
        (!positional.matchId || !knownIds.has(String(positional.matchId)))
          ? positional
          : null);
      return {
        matchId: String(srcItem.matchId),
        matchTitle: redactModelLeak(
          pm?.matchTitle ||
            `${srcItem.matchNumStr} ${srcItem.home}vs${srcItem.away}`
        ),
        tag: redactModelLeak(pm?.tag || "联合排雷关注"),
        note: redactModelLeak(
          pm?.note || "建议结合去水真实胜率与卡盘温度计控制串关风险。"
        ),
        priceInStatus: redactModelLeak(
          pm?.priceInStatus || "当前水位已部分消化市场一致预期"
        ),
        poolImpact: redactModelLeak(
          pm?.poolImpact || buildDefaultPoolImpact(srcItem)
        ),
      };
    });

    const defaultSynergy = actCtx.isOptimized
      ? `${actCtx.shieldSummary}。数学分倍层面已做好结构防护，无需重复拆改注单倍数。`
      : actCtx.underwaterCount > 0
        ? `当前为手动等倍注单，存在 ${actCtx.underwaterCount} 组假中奖倒贴漏洞，建议在精算配单或三模优化中先做保本配平。`
        : `${actCtx.shieldSummary}。单线等倍结构对黑单缺乏缓冲垫，需结合盘面稳定性控制仓位。`;

    const defaultResidual =
      "分倍数学无法消除主方向全黑的赛场冷门风险；请重点核查大幅绿降场次是否已提前透支利好，警惕热门强队只赢1球卡盘或闷平冷门。";

    const defaultAdvice = actCtx.isOptimized
      ? actCtx.hedgeHint
        ? `维持当前【${actCtx.badge}】分倍结构即可；${actCtx.hedgeHint}。`
        : `维持当前【${actCtx.badge}】实票配平结构即可，配合每日止损护栏理性出票。`
      : "若场次≥3场，建议切至【② 精算配单】选用稳健保本或容错缩水方案构建回血底垫。";

    return {
      level:
        parsed.level === "high"
          ? "high"
          : parsed.level === "low"
            ? "low"
            : "medium",
      planContextBadge: redactModelLeak(
        parsed.planContextBadge || actCtx.badge
      ),
      comboTag: redactModelLeak(
        parsed.comboTag || `${items.length}场联合串关靶向会诊`
      ),
      summary: redactModelLeak(
        parsed.summary ||
          "多场组合需兼顾抽水损耗与强队小胜卡盘，切忌在已大幅降赔透支的大热场次上盲目重仓。"
      ),
      actuarySynergy: redactModelLeak(parsed.actuarySynergy || defaultSynergy),
      residualRisks: redactModelLeak(parsed.residualRisks || defaultResidual),
      weakestLeg: redactModelLeak(
        parsed.weakestLeg ||
          "建议重点复核单场真实过关率最低的一关，必要时补防平局。"
      ),
      structureAdvice: redactModelLeak(parsed.structureAdvice || defaultAdvice),
      priceInVerdict: redactModelLeak(
        parsed.priceInVerdict ||
          "热门场次胜平负水位多已提前下调消化利好，半全场或总进球偶有滞后空间。"
      ),
      perMatch,
      matchCount: items.length,
      source: `扫地僧小高 ${items.length}场协同会诊 · ${hhmm}`,
    };
  }

  function getPublicStatus(configured) {
    return {
      ok: true,
      configured: Boolean(configured),
      channel: state.degradedSince !== null ? "backup" : "primary",
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
