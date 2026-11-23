import {
  buildMatchObjectiveFactsBundle,
  buildNewsOddsTimelineAlignment,
} from "./history/xiaogaoObjectiveFacts.mjs";
import { sanitizeAndDeduplicatePicks } from "./quant/reportAndSettlement.mjs";

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
  /deepseek[\w.-]*|glm[\w.-]*|chatgpt|openai|claude|anthropic|qwen|doubao|kimi|moonshot|豆包|字节跳动|opencode|深度求索|智谱清言|大语言模型|人工智能模型/gi;

export function sanitizeUserIntelNote(rawNote, maxLen = 280) {
  if (!rawNote) return "";
  return String(rawNote)
    .slice(0, Math.max(maxLen * 4, 1024))
    .replace(/[\r\n\t]+/g, " ")
    .replace(
      /ignore\s+(?:all\s+)?previous(?:\s+instructions?)?|system\s+prompt|developer\s+message|忽略[^\n。；，]{0,16}(?:指令|规则|提示)|无视[^\n。；，]{0,16}(?:指令|规则|提示)|什么模型|哪个大模型|提示词/gi,
      ""
    )
    .replace(INTEL_REDACT_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function sanitizeVerifiedNewsInput(rawNews, maxItems = 8) {
  if (!Array.isArray(rawNews)) return [];
  const limit = Math.min(rawNews.length, Math.max(1, maxItems));
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    const item = rawNews[i];
    if (!item || typeof item !== "object") continue;
    const source = sanitizeUserIntelNote(item.source, 48);
    const publishedAt = sanitizeUserIntelNote(item.publishedAt, 32);
    const summary = sanitizeUserIntelNote(
      item.summary ?? item.title ?? "",
      120
    );
    if (source && publishedAt) {
      out.push({ source, publishedAt, summary });
    }
  }
  return out;
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

export const XIAOGAO_ALERT_TTL_MS = 30 * 60_000;

const ALL_POOL_SPECS = Object.freeze([
  ["HAD", "胜平负"],
  ["HHAD", "让球盘"],
  ["TTG", "总进球"],
  ["HAFU", "半全场"],
  ["CRS", "比分"],
]);

function getValidSellingOptions(pool) {
  if (!pool || pool.selling === false || !Array.isArray(pool.options)) {
    return [];
  }
  return pool.options.filter(
    (o) => Number.isFinite(Number(o?.odds)) && Number(o.odds) > 1
  );
}

function formatPoolOddsSummary(pool, includePrefix = true) {
  const validOpts = getValidSellingOptions(pool);
  if (validOpts.length === 0) {
    return "该玩法无有效报价";
  }
  return validOpts
    .map(
      (o) =>
        `${o.label}@${Number(o.odds).toFixed(2)}${formatTrendArrow(o.trend)}(${
          includePrefix ? "真率" : ""
        }${Math.round((Number(o.fairProb) || 0) * 100)}%)`
    )
    .join(" / ");
}

function formatPoolVigEntry(pool, label) {
  const validOpts = getValidSellingOptions(pool);
  if (validOpts.length === 0) {
    return `${label}：该玩法无有效报价`;
  }
  const invSum = validOpts.reduce((acc, o) => acc + 1 / Number(o.odds), 0);
  const payoutRatio = invSum > 0 ? 1 / invSum : 1;
  const realVigPct = Math.max(0, 1 - payoutRatio) * 100;
  return `${label}抽水${realVigPct.toFixed(1)}%`;
}

function buildMatchVigSummary(m) {
  return ALL_POOL_SPECS.map(([code, label]) =>
    formatPoolVigEntry(m?.pools?.[code], label)
  ).join("，");
}

function formatXgSummaryOrMissing(m, mq, totalPrefix = "总预期") {
  const hXg = Number(mq?.homeXG);
  const aXg = Number(mq?.awayXG);
  const tXg = Number(mq?.totalXG);
  if (!Number.isFinite(hXg) || !Number.isFinite(aXg) || !Number.isFinite(tXg)) {
    return "无可核验信息";
  }
  return `${m.home} ${mq.homeXG} : ${mq.awayXG} ${m.away} (${totalPrefix}${mq.totalXG}球)`;
}

function resolveOneGoalSharePct(mq) {
  const raw = mq?.oneGoalShareOfWins;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw <= 1 ? raw * 100 : raw);
  }
  return null;
}

function formatMatchTrends(m) {
  const hadTrends = getValidSellingOptions(m?.pools?.HAD)
    .filter((o) => o.trend !== 0)
    .map((o) => `主盘${o.label}${formatTrendArrow(o.trend)}`);
  const hhadTrends = getValidSellingOptions(m?.pools?.HHAD)
    .filter((o) => o.trend !== 0)
    .map((o) => `${o.label}${formatTrendArrow(o.trend)}`);
  return [...hadTrends, ...hhadTrends].join("、");
}

/**
 * 计算单场排雷结论与缓存强绑定签名：{ matchId, activePoolsMask, hhadGoalLine, quoteVersionSig, analyzedAt }
 */
export function computeMatchAlertBinding(match, analyzedAt = Date.now()) {
  const maskParts = [];
  const quoteParts = [];
  for (const [code] of ALL_POOL_SPECS) {
    const pool = match?.pools?.[code];
    const validOpts = getValidSellingOptions(pool);
    const isOpen = validOpts.length > 0;
    const canSingle = isOpen && Boolean(pool?.canSingle ?? pool?.single);
    const canAllUp = isOpen && pool?.canAllUp !== false;
    maskParts.push(
      isOpen ? `${code}:${canSingle ? 1 : 0}${canAllUp ? 1 : 0}` : `${code}:00`
    );
    if (!isOpen) {
      quoteParts.push(`${code}:-`);
      continue;
    }
    const gl = code === "HHAD" ? String(pool?.goalLine ?? "").trim() : "";
    const optsSig = validOpts
      .map((o) => `${String(o.key)}:${Number(o.odds).toFixed(4)}`)
      .sort()
      .join(",");
    quoteParts.push(`${code}[${gl}](${optsSig})`);
  }
  return Object.freeze({
    matchId: String(match?.id ?? "").trim(),
    activePoolsMask: maskParts.join("|"),
    hhadGoalLine: String(match?.pools?.HHAD?.goalLine ?? "").trim(),
    quoteVersionSig: quoteParts.join("|"),
    analyzedAt: Number(analyzedAt),
  });
}

export function isMatchAlertBindingValid(
  alertOrBinding,
  match,
  nowMs = Date.now(),
  ttlMs = XIAOGAO_ALERT_TTL_MS
) {
  const b = alertOrBinding?.binding ?? alertOrBinding;
  if (!b || typeof b !== "object" || !match || typeof match !== "object") {
    return false;
  }
  const mid = String(match.id ?? "").trim();
  if (!mid || String(b.matchId ?? "").trim() !== mid) {
    return false;
  }
  if (
    typeof b.analyzedAt !== "number" ||
    !Number.isFinite(b.analyzedAt) ||
    nowMs - b.analyzedAt > ttlMs
  ) {
    return false;
  }
  const cur = computeMatchAlertBinding(match, nowMs);
  return (
    b.activePoolsMask === cur.activePoolsMask &&
    b.hhadGoalLine === cur.hhadGoalLine &&
    b.quoteVersionSig === cur.quoteVersionSig
  );
}

/**
 * 统一权威赛事标识严格对齐判定（100% 仅认官方唯一 matchId，严禁按展示编号如“周六001”或标题子串猜测）
 */
export function matchesCanonicalSportteryItem(pm, canonical) {
  if (
    !pm ||
    typeof pm !== "object" ||
    !canonical ||
    typeof canonical !== "object"
  ) {
    return false;
  }
  const canonicalId = String(canonical.id ?? canonical.matchId ?? "").trim();
  const rawId =
    pm.matchId !== undefined && pm.matchId !== null
      ? String(pm.matchId).trim()
      : "";
  return Boolean(canonicalId) && rawId === canonicalId;
}

function pickObjectiveFactsFields(objectiveFacts) {
  return {
    restIntervalSummary: objectiveFacts.restIntervalSummary,
    recentLedgerSummary: objectiveFacts.recentLedgerSummary,
    dualAxisSummary: objectiveFacts.dualAxisSummary,
    newsTimelineSummary: objectiveFacts.newsTimelineSummary,
    hasVerifiedNews: Boolean(objectiveFacts.hasVerifiedNews),
  };
}

function resolveNormalizedObjectiveFacts(src) {
  const base = src?.objectiveFacts || {};
  return {
    restIntervalSummary:
      src?.restIntervalSummary || base.restIntervalSummary || "无可核验信息",
    recentLedgerSummary:
      src?.recentLedgerSummary || base.recentLedgerSummary || "无可核验信息",
    dualAxisSummary:
      src?.dualAxisSummary ||
      base.dualAxisSummary ||
      src?.droppingTrends ||
      "无可核验信息",
    newsTimelineSummary:
      src?.newsTimelineSummary || base.newsTimelineSummary || "无可核验信息",
    hasVerifiedNews: Boolean(src?.hasVerifiedNews ?? base.hasVerifiedNews),
  };
}

function buildObjectiveFactsSignature(facts) {
  return `${facts.restIntervalSummary}|${facts.recentLedgerSummary}|${facts.dualAxisSummary}|${facts.newsTimelineSummary}|${facts.hasVerifiedNews ? 1 : 0}`;
}

/**
 * 服务端权威盘口上下文构建（单场点诊）：直接基于服务端赛事快照与客观历史底座生成完整排雷输入，杜绝前端拼接提示上下文
 */
export function buildSingleMatchDiagnosisContext(m, userNote, opts = {}) {
  if (!m) throw new Error("Match not found");
  const mq = m.microQuant || {};
  const rawBundle = buildMatchObjectiveFactsBundle(m, {
    ...opts,
    userNote,
  });
  const objectiveFacts = pickObjectiveFactsFields(rawBundle);
  const binding = computeMatchAlertBinding(m, rawBundle.decisionEpochMs);
  return {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    league: m.league,
    kickoff: m.kickoff,
    home: m.home,
    away: m.away,
    hadOdds: formatPoolOddsSummary(m.pools?.HAD, true),
    hhadOdds: formatPoolOddsSummary(m.pools?.HHAD, true),
    ttgSelling: getValidSellingOptions(m.pools?.TTG).length > 0,
    vigSummary: buildMatchVigSummary(m),
    xgSummary: formatXgSummaryOrMissing(m, mq, "总预期"),
    oneGoalSharePct: resolveOneGoalSharePct(mq),
    droppingTrends: objectiveFacts.dualAxisSummary || formatMatchTrends(m),
    objectiveFacts,
    ...objectiveFacts,
    binding,
    userNote,
  };
}

function buildDefaultPoolImpact(it) {
  const hasOneGoal =
    typeof it?.oneGoalSharePct === "number" &&
    Number.isFinite(it.oneGoalSharePct);
  const oneGoalPct = hasOneGoal ? it.oneGoalSharePct : null;
  const totalXgMatch = String(it?.xgSummary || "").match(
    /(?:合计|总预期)\s*([\d.]+)/
  );
  const totalXg =
    totalXgMatch && Number.isFinite(Number(totalXgMatch[1]))
      ? Number(totalXgMatch[1])
      : null;

  const spfPart =
    it?.hadOdds === "该玩法无有效报价"
      ? "胜平负：该玩法无有效报价"
      : it?.droppingTrends
        ? `胜平负结合双维走势（${String(it.droppingTrends).slice(0, 48)}）审视去水真率`
        : "胜平负主盘定价均衡，宜结合去水真率把握正路";

  const hhadPart =
    it?.hhadOdds === "该玩法无有效报价"
      ? "让球盘：该玩法无有效报价"
      : oneGoalPct === null
        ? "让球盘一球卡盘率：无可核验信息"
        : oneGoalPct >= 50
          ? `让球盘赢1球卡盘率达${oneGoalPct}%，慎追单边穿盘宜防让平`
          : `让球盘一球卡盘率${oneGoalPct}%处于常规带`;

  const ttgPart =
    it?.ttgSelling === false
      ? "总进球：该玩法无有效报价"
      : totalXg === null
        ? "总进球预期：无可核验信息"
        : totalXg >= 2.75
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
  verifiedNews = null,
  historySnapshot = null,
  historyCoordinator = null,
  decisionEpochMs = undefined,
}) {
  const safePicks = sanitizeAndDeduplicatePicks(picks, 512);
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
  const allVisibleQuoteTimestamps = [];
  const matchesPayload = targetMatches.slice(0, 8).map((m) => {
    const mq = m.microQuant || {};
    const rawBundle = buildMatchObjectiveFactsBundle(m, {
      historySnapshot,
      historyCoordinator,
      decisionEpochMs,
      userNote,
      verifiedNews,
    });
    const objectiveFacts = pickObjectiveFactsFields(rawBundle);
    for (const ts of rawBundle.visibleQuoteTimestamps || []) {
      const prefixed = `${m.matchNumStr || m.id}·${ts}`;
      if (!allVisibleQuoteTimestamps.includes(prefixed)) {
        allVisibleQuoteTimestamps.push(prefixed);
      }
    }
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
      hadOdds: formatPoolOddsSummary(m.pools?.HAD, false),
      hhadOdds: formatPoolOddsSummary(m.pools?.HHAD, false),
      ttgSelling: getValidSellingOptions(m.pools?.TTG).length > 0,
      vigSummary: buildMatchVigSummary(m),
      xgSummary: formatXgSummaryOrMissing(m, mq, "合计"),
      oneGoalSharePct: resolveOneGoalSharePct(mq),
      paceLabel: mq.paceLabel || "均衡节奏",
      alphaScanSummary: mq.alphaScanSummary || "",
      droppingTrends: objectiveFacts.dualAxisSummary || formatMatchTrends(m),
      objectiveFacts,
      ...objectiveFacts,
      binding: computeMatchAlertBinding(m, rawBundle.decisionEpochMs),
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
  const isBridgePair2x1 = (() => {
    if (
      sourceMode !== "picked" ||
      targetMatches.length !== 2 ||
      !hasValidReport
    ) {
      return null;
    }
    const perMatchSingle = targetMatches.map((m) => {
      const mp = safePicks.filter((p) => p && p.matchId === m.id);
      const anyNonSingle = mp.some(
        (p) =>
          m.pools?.[p.poolCode]?.single === false ||
          m.pools?.[p.poolCode]?.canSingle === false
      );
      const hasBridgeMateSource = mp.some((p) => p.legSource === "bridge-mate");
      const maxProb = mp.reduce(
        (mx, p) =>
          Math.max(
            mx,
            Number(
              m.pools?.[p.poolCode]?.options?.find(
                (o) => o.key === p.optionKey || o.label === p.optionLabel
              )?.fairProb ?? p.fairProb
            ) || 0
          ),
        0
      );
      return {
        m,
        anyNonSingle,
        hasBridgeMateSource,
        maxProb,
        count: mp.length,
      };
    });
    const explicitMate = perMatchSingle.find((x) => x.hasBridgeMateSource);
    if (
      perMatchSingle.some((x) => x.anyNonSingle && x.count > 0) &&
      (explicitMate ||
        perMatchSingle.some((x) => x.maxProb >= 0.48) ||
        Boolean(insights?.hedge?.available))
    ) {
      const steady =
        explicitMate ||
        [...perMatchSingle].sort((a, b) => b.maxProb - a.maxProb)[0];
      return `已构建过桥配菜搭子 2串1 结构（借低耗稳胆/时间差搭子 ${steady.m.matchNumStr || steady.m.home} 协助非单关主看场合法出票）`;
    }
    return null;
  })();

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
    if (isBridgePair2x1) {
      shieldParts.push(isBridgePair2x1);
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
    if (isBridgePair2x1) {
      shieldParts.push(isBridgePair2x1);
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
    ? `${effectiveReport.modeLabel} · 总投入¥${effectiveReport.totalCost} · ${
        effectiveReport.isUnconditionalFloorGuaranteed ? "保底" : "命中最低"
      }¥${Number(effectiveReport.minPayout || 0).toFixed(
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

  const auditedLegSources = safePicks
    .filter((p) => typeof p.legSource === "string")
    .map((p) => ({
      matchId: p.matchId,
      poolCode: p.poolCode,
      optionKey: p.optionKey,
      legSource: p.legSource,
    }));

  const comboNewsTimeline = buildNewsOddsTimelineAlignment({
    userNote,
    verifiedNews,
    visibleQuoteTimestamps: allVisibleQuoteTimestamps,
  });

  return {
    modeDesc,
    orderSummary,
    actuaryContext,
    matches: matchesPayload,
    sanitizedPickCount: safePicks.length,
    auditedLegSources,
    newsTimelineSummary: comboNewsTimeline.summary,
    hasVerifiedNews: comboNewsTimeline.hasVerifiedNews,
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

  const FORBIDDEN_SUBJECTIVE_CLAIM_RE =
    /消化\s*\d+%|已部分反映市场热度|已部分消化市场一致预期|提前下调消化利好|必然回归|市场追热/;

  function resolveTimelineField(
    rawModelText,
    hasVerifiedNews,
    deterministicTimeline
  ) {
    if (!hasVerifiedNews) {
      return "无可核验信息";
    }
    const clean = redactModelLeak(rawModelText || "");
    if (!clean || FORBIDDEN_SUBJECTIVE_CLAIM_RE.test(clean)) {
      return redactModelLeak(deterministicTimeline || "无可核验信息");
    }
    return clean;
  }

  function scrubSubjectiveRegressionClaims(str) {
    return redactModelLeak(str)
      .replace(/下场必然回归|必然均值回归|必然回归/g, "历史同期偏差记录")
      .replace(/市场追热/g, "盘面变价记录");
  }

  const singleDiagnosisCache = new Map();
  const comboDiagnosisCache = new Map();
  const MAX_DIAGNOSIS_CACHE = 64;

  function formatCardPanPctText(pct) {
    return typeof pct === "number" && Number.isFinite(pct)
      ? `${pct}%`
      : "无可核验信息";
  }

  function putBoundedCache(cacheMap, key, value, nowMs) {
    for (const [k, v] of cacheMap.entries()) {
      if (nowMs - Number(v.analyzedAt || 0) > XIAOGAO_ALERT_TTL_MS) {
        cacheMap.delete(k);
      }
    }
    if (!cacheMap.has(key) && cacheMap.size >= MAX_DIAGNOSIS_CACHE) {
      const oldestKey = cacheMap.keys().next().value;
      if (oldestKey !== undefined) cacheMap.delete(oldestKey);
    }
    cacheMap.set(key, {
      analyzedAt: nowMs,
      value: structuredClone(value),
    });
  }

  function getValidBoundedCache(cacheMap, key, nowMs) {
    if (!key || !cacheMap.has(key)) return null;
    const hit = cacheMap.get(key);
    if (!hit || nowMs - Number(hit.analyzedAt || 0) > XIAOGAO_ALERT_TTL_MS) {
      cacheMap.delete(key);
      return null;
    }
    return structuredClone(hit.value);
  }

  async function analyzeMatch(apiKey, req) {
    const nowMs = nowFn();
    const facts = resolveNormalizedObjectiveFacts(req);
    const {
      restIntervalSummary,
      recentLedgerSummary,
      dualAxisSummary,
      newsTimelineSummary,
      hasVerifiedNews,
    } = facts;
    const safeNote = sanitizeUserIntelNote(req.userNote, 280);

    const cacheKey =
      req?.binding?.matchId && req?.binding?.quoteVersionSig
        ? `${req.binding.matchId}|${req.binding.activePoolsMask}|${req.binding.hhadGoalLine}|${req.binding.quoteVersionSig}|${safeNote}|${buildObjectiveFactsSignature(facts)}`
        : null;
    const cachedAlert = getValidBoundedCache(
      singleDiagnosisCache,
      cacheKey,
      nowMs
    );
    if (cachedAlert) {
      return cachedAlert;
    }

    const sysPrompt = `你是“扫地僧小高”，一位极其老辣、冷静克制的中国体彩竞彩足球精算与风控排雷参谋。
请根据服务端提供的体彩实盘水位、真实隐含概率、精算师预期进球(xG)、一球卡盘率、赛程休息间隔上界、近90天竞彩客观战绩账本、双维盘面走势及消息与变价时序对照，输出靶向排雷结论。
严守客观事实铁律：
1. 严禁在回复中提及任何AI或底层模型名称，严禁修改真实隐含概率或配单权重。
2. 赛程间隔观测值仅为真实休息间隔上界，两上界之差对真实间隔差无上下界保证；近90天战绩对照仅陈述历史事实，严禁硬判“下场必然回归”或“市场追热”。
3. 「消息与变价时序对照」（priceInStatus）仅在存在明确来源与发布时间的外部消息时并列陈述发布时刻与变价时刻，绝不推断消化比例；无核验外部消息时必须固定输出“无可核验信息”。
必须只输出合法的 JSON 对象（不要任何多余解释文字），字段如下：
{
  "level": "high" 或 "medium",
  "tag": "4到8个字的风险核心标签，如：防一球小胜卡盘 / 密集赛程观察 / 双维同向调水",
  "summary": "60到95字以内的客观排雷正文，结合双维盘面走势、卡盘率与客观战绩/休息间隔上界指出风险点",
  "priceInStatus": "存在核验消息时并列陈述消息与变价时序（不推断消化比例）；无核验消息时固定填 无可核验信息",
  "suggestedDelta": "存在明确可核验赛前消息时给出一句谨慎微调参考，否则固定填 维持客观真实隐含概率"
}`;

    const cardPanPctText = formatCardPanPctText(req.oneGoalSharePct);
    const userPrompt = `比赛：${req.matchNumStr || ""} ${req.league || ""} (${req.kickoff || ""}) ${req.home || ""} vs ${req.away || ""}
胜平负水位与真实隐含概率：${req.hadOdds || "该玩法无有效报价"}
让球盘水位与真实隐含概率：${req.hhadOdds || "该玩法无有效报价"}
抽水结构：${req.vigSummary || "无可核验信息"}
泊松预期进球：${req.xgSummary || "无可核验信息"}，赢球即净胜1球卡盘占比：${cardPanPctText}
赛程休息间隔上界：${restIntervalSummary}
近90天竞彩客观战绩账本：${recentLedgerSummary}
双维盘面走势：${dualAxisSummary}
消息与变价时序对照：${newsTimelineSummary}
${safeNote ? `用户补充赛前备注：${safeNote}` : ""}`;

    const { content } = await invokeWithAutoFailover(apiKey, [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ]);

    const parsed = extractJsonObject(content);
    const finishedMs = nowFn();
    const now = new Date(finishedMs);
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const defaultSummary = `一球卡盘率 ${cardPanPctText}；赛程间隔：${restIntervalSummary.slice(
      0,
      46
    )}；${dualAxisSummary.slice(0, 52)}。`;

    const resolvedBinding = req?.binding
      ? {
          matchId: String(req.binding.matchId),
          activePoolsMask: String(req.binding.activePoolsMask),
          hhadGoalLine: String(req.binding.hhadGoalLine),
          quoteVersionSig: String(req.binding.quoteVersionSig),
          analyzedAt: finishedMs,
        }
      : undefined;

    const resultAlert = {
      level: parsed.level === "high" ? "high" : "medium",
      tag: scrubSubjectiveRegressionClaims(parsed.tag || "临场客观排雷"),
      summary: scrubSubjectiveRegressionClaims(
        parsed.summary || defaultSummary
      ),
      priceInStatus: resolveTimelineField(
        parsed.priceInStatus,
        hasVerifiedNews,
        newsTimelineSummary
      ),
      suggestedDelta: hasVerifiedNews
        ? scrubSubjectiveRegressionClaims(
            parsed.suggestedDelta || "维持客观真实隐含概率"
          )
        : "维持客观真实隐含概率",
      source: `扫地僧小高实时诊盘 · ${hhmm}`,
      ...(resolvedBinding ? { binding: resolvedBinding } : {}),
    };

    if (cacheKey) {
      putBoundedCache(singleDiagnosisCache, cacheKey, resultAlert, finishedMs);
    }
    return resultAlert;
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

    const comboHasVerifiedNews =
      Boolean(comboReq.hasVerifiedNews) ||
      items.some((it) => resolveNormalizedObjectiveFacts(it).hasVerifiedNews);
    const comboNewsTimelineSummary =
      comboReq.newsTimelineSummary || "无可核验信息";
    const safeComboNote = sanitizeUserIntelNote(comboReq.userNote, 320);

    const nowMs = nowFn();
    const allHaveBindings = items.every(
      (it) => it?.binding?.matchId && it?.binding?.quoteVersionSig
    );
    const comboCacheKey = allHaveBindings
      ? `${items
          .map((it) => {
            const lf = resolveNormalizedObjectiveFacts(it);
            return `${it.binding.matchId}#${it.binding.activePoolsMask}#${it.binding.hhadGoalLine}#${it.binding.quoteVersionSig}#${it.userPickedDesc || ""}#${buildObjectiveFactsSignature(lf)}`;
          })
          .join(
            "||"
          )}@@${actCtx.badge || ""}|${comboReq.orderSummary || ""}|${safeComboNote}|${comboNewsTimelineSummary}|${comboHasVerifiedNews ? 1 : 0}`
      : null;
    const cachedCombo = getValidBoundedCache(
      comboDiagnosisCache,
      comboCacheKey,
      nowMs
    );
    if (cachedCombo) {
      return cachedCombo;
    }

    const sysPrompt = `你是“扫地僧小高”，一位极其老辣、冷静克制的中国体彩竞彩足球多场串关风控与精算协同会诊参谋。
请严格执行【双维客观协同会诊】，做到既客观犀利绝不报喜不报忧，又与系统精算配单前后逻辑自洽、绝不自我打脸：
1. 第一维（actuarySynergy · 已构筑的精算防线/结构体检）：
   - 若用户已启用【3+1精算配单】或【三模奖金优化】（见输入“当前精算配单防线”），必须如实肯定该数学结构已经帮用户锁住了什么坑（如不等倍配平已实现0假中奖、同盘双选已对冲一球卡盘、或旋转矩阵已锁死错1场回血），切忌再当成散户裸买死串去批评“没做分倍/没防假中奖”！
   - 若用户是手动未优化的等倍裸串且存在假中奖或单边穿盘漏洞，则一针见血指出数学结构软肋。
2. 第二维（residualRisks + priceInVerdict · 消息与变价时序对照及残余实战暗雷）：
   - 客观结合赛程休息间隔上界（注意各队观测值仅为真实休息间隔上界，两上界之差对真实间隔差无上下界保证）、近90天竞彩客观战绩账本（严禁硬判“下场必然回归”或“市场追热”）与双维盘面走势，指出数学分倍无法消除的赛场隐患，并给出与精算工作台无缝衔接的可执行动作（structureAdvice）。
   - 「消息与变价时序对照」（priceInVerdict 及每场 priceInStatus）仅在存在明确来源与发布时间的外部消息时并列陈述消息发布时刻与盘面变价时刻，绝不推断消息消化比例；无核验外部消息时必须固定输出“无可核验信息”。
严禁提及任何AI或底层模型名称，严禁任何绝对无损稳赚夸大措辞。必须只输出合法的 JSON 对象（不要任何多余文字），格式如下：
{
  "level": "high" 或 "medium" 或 "low",
  "comboTag": "6到14字的协同会诊核心定性，如：稳健保本已配平·盯防密集赛程",
  "summary": "65到110字的整单客观总评，兼顾当前配单结构特征与赛场客观证据",
  "actuarySynergy": "45到85字：如实评价当前注单已构筑的数学精算防线（或手动裸串尚未弥补的结构漏洞）",
  "residualRisks": "45到85字：直指数学分倍之外仍需警惕的双维走势变化、密集赛程或全黑风险边界",
  "weakestLeg": "点名这几场里最易出冷或最需盯防的那1场比赛及具体客观原因（35到65字）",
  "structureAdvice": "与当前精算状态自洽的下一步实操建议，如维持当前保本分倍、晚场时间差锁利或启用容错缩水（40到75字）",
  "priceInVerdict": "整单消息与变价时序对照：有核验消息时并列陈述发布与变价时序，无核验消息时固定填 无可核验信息",
  "perMatch": [
    {
      "matchId": "原样返回比赛官方唯一matchId",
      "matchTitle": "如 周三001 科里蒂巴vs桑托斯",
      "tag": "4到8字单场排雷签",
      "note": "35到65字针对该场双维走势、客观战绩/间隔上界及当前选号方向的精算点评",
      "priceInStatus": "有核验消息时并列陈述消息与变价时序，无核验消息时固定填 无可核验信息",
      "poolImpact": "35到65字具体拆解对【胜平负 / 让球 / 总进球】三个维度的实战影响"
    }
  ]
}`;

    const linesText = items
      .map(
        (it, idx) =>
          `【第${idx + 1}场 | matchId=${it.matchId}】${it.matchNumStr || ""} ${it.league || ""} (${it.kickoff || ""}) ${it.home || ""} vs ${it.away || ""}
  - 当前方案覆盖买法：${it.userPickedDesc || "暂未下注（请求纯客观盘面联合把脉）"}
  - 胜平负水位：${it.hadOdds || "该玩法无有效报价"}
  - 让球水位：${it.hhadOdds || "该玩法无有效报价"}
  - 抽水结构：${it.vigSummary || "无可核验信息"}
  - 预期进球xG：${it.xgSummary || "无可核验信息"} | 节奏：${it.paceLabel || "均衡节奏"} | 赢1球卡盘率：${formatCardPanPctText(it.oneGoalSharePct)}
  - 赛程休息间隔上界：${it.restIntervalSummary || "无可核验信息"}
  - 近90天竞彩客观战绩账本：${it.recentLedgerSummary || "无可核验信息"}
  - 双维盘面走势：${it.dualAxisSummary || it.droppingTrends || "无可核验信息"}
  - 消息与变价时序对照：${it.newsTimelineSummary || "无可核验信息"}`
      )
      .join("\n");

    const userPrompt = `会诊模式：${comboReq.modeDesc || `${items.length}场联合串关会诊`}
串关整体指标：${comboReq.orderSummary || `共 ${items.length} 场比赛`}
当前精算配单防线：${actCtx.shieldSummary}${actCtx.ticketLinesBrief ? `\n实票拆解结构：${actCtx.ticketLinesBrief}` : ""}
整单消息与变价时序对照：${comboNewsTimelineSummary}
${linesText}
${safeComboNote ? `用户补充赛前备注/疑问：${safeComboNote}` : ""}`;

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
    const finishedMs = nowFn();
    const now = new Date(finishedMs);
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const rawPerMatch = Array.isArray(parsed.perMatch) ? parsed.perMatch : [];
    const perMatch = items.map((srcItem) => {
      // 100% strict canonical matchId matching ONLY (zero matchNumStr, matchTitle substring, or positional fallback!)
      const pm =
        rawPerMatch.find((x) => matchesCanonicalSportteryItem(x, srcItem)) ||
        null;
      const itemHasNews = Boolean(
        srcItem.hasVerifiedNews || comboHasVerifiedNews
      );
      const itemTimeline =
        srcItem.newsTimelineSummary || comboNewsTimelineSummary;
      const cardPanPctText = formatCardPanPctText(srcItem.oneGoalSharePct);
      const defaultItemNote = `一球卡盘率 ${cardPanPctText}；赛程间隔：${(
        srcItem.restIntervalSummary || "无可核验信息"
      ).slice(0, 38)}；${(
        srcItem.dualAxisSummary || "建议结合去水真率控制串关风险"
      ).slice(0, 42)}。`;
      const itemBinding = srcItem?.binding
        ? {
            matchId: String(srcItem.binding.matchId),
            activePoolsMask: String(srcItem.binding.activePoolsMask),
            hhadGoalLine: String(srcItem.binding.hhadGoalLine),
            quoteVersionSig: String(srcItem.binding.quoteVersionSig),
            analyzedAt: finishedMs,
          }
        : undefined;
      return {
        matchId: String(srcItem.matchId),
        matchTitle: redactModelLeak(
          pm?.matchTitle ||
            `${srcItem.matchNumStr} ${srcItem.home}vs${srcItem.away}`
        ),
        tag: scrubSubjectiveRegressionClaims(pm?.tag || "联合排雷关注"),
        note: scrubSubjectiveRegressionClaims(pm?.note || defaultItemNote),
        priceInStatus: resolveTimelineField(
          pm?.priceInStatus,
          itemHasNews,
          itemTimeline
        ),
        poolImpact: scrubSubjectiveRegressionClaims(
          pm?.poolImpact || buildDefaultPoolImpact(srcItem)
        ),
        ...(itemBinding ? { binding: itemBinding } : {}),
      };
    });

    const defaultSynergy = actCtx.isOptimized
      ? `${actCtx.shieldSummary}。数学分倍层面已做好结构防护，无需重复拆改注单倍数。`
      : actCtx.underwaterCount > 0
        ? `当前为手动等倍注单，存在 ${actCtx.underwaterCount} 组假中奖倒贴漏洞，建议在精算配单或三模优化中先做保本配平。`
        : `${actCtx.shieldSummary}。单线等倍结构对黑单缺乏缓冲垫，需结合盘面稳定性控制仓位。`;

    const defaultResidual =
      "分倍数学无法消除主方向全黑的赛场冷门风险；请结合各场双维盘面走势、休息间隔上界与一球卡盘率审慎控制串关风险。";

    const defaultAdvice = actCtx.isOptimized
      ? actCtx.hedgeHint
        ? `维持当前【${actCtx.badge}】分倍结构即可；${actCtx.hedgeHint}。`
        : `维持当前【${actCtx.badge}】实票配平结构即可，配合每日止损护栏理性出票。`
      : "若场次≥3场，建议切至【② 精算配单】选用稳健保本或容错缩水方案构建回血底垫。";

    const comboResult = {
      level:
        parsed.level === "high"
          ? "high"
          : parsed.level === "low"
            ? "low"
            : "medium",
      planContextBadge: redactModelLeak(
        parsed.planContextBadge || actCtx.badge
      ),
      comboTag: scrubSubjectiveRegressionClaims(
        parsed.comboTag || `${items.length}场联合串关靶向会诊`
      ),
      summary: scrubSubjectiveRegressionClaims(
        parsed.summary ||
          "多场组合需兼顾连乘抽水损耗、双维盘面走势与强队一球小胜卡盘风险，宜结合客观证据理性控仓。"
      ),
      actuarySynergy: scrubSubjectiveRegressionClaims(
        parsed.actuarySynergy || defaultSynergy
      ),
      residualRisks: scrubSubjectiveRegressionClaims(
        parsed.residualRisks || defaultResidual
      ),
      weakestLeg: scrubSubjectiveRegressionClaims(
        parsed.weakestLeg ||
          "建议重点复核单场真实过关率最低的一关，必要时补防平局。"
      ),
      structureAdvice: scrubSubjectiveRegressionClaims(
        parsed.structureAdvice || defaultAdvice
      ),
      priceInVerdict: resolveTimelineField(
        parsed.priceInVerdict,
        comboHasVerifiedNews,
        comboNewsTimelineSummary
      ),
      perMatch,
      matchCount: items.length,
      source: `扫地僧小高 ${items.length}场协同会诊 · ${hhmm}`,
    };

    if (comboCacheKey) {
      putBoundedCache(
        comboDiagnosisCache,
        comboCacheKey,
        comboResult,
        finishedMs
      );
    }
    return comboResult;
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
