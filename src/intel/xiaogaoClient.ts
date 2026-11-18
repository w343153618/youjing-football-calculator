import type { MatchItem, RadarWarning, SelectedPick } from '../prototype/data.ts';

export interface XiaoGaoAlert {
  level: 'high' | 'medium';
  tag: string;
  summary: string;
  priceInStatus: string;
  source: string;
  suggestedDelta?: string;
}

/**
 * 汇总已选场次的「扫地僧小高」独立情报提示（遵循 ADR-0002，与纯数学 computeTruthReport 物理隔离）
 */
export function buildXiaoGaoWarnings(
  picks: SelectedPick[],
  matches: MatchItem[]
): RadarWarning[] {
  const matchIds = Array.from(new Set(picks.map((p) => p.matchId)));
  const out: RadarWarning[] = [];
  for (const mid of matchIds) {
    const m = matches.find((x) => x.id === mid);
    if (!m?.aiAlert) continue;
    out.push({
      id: `xiaogao-${m.id}`,
      severity: m.aiAlert.level === 'high' ? 'danger' : 'warn',
      title: `🧹 扫地僧小高靶向排雷 · ${m.matchNumStr} ${m.aiAlert.tag}`,
      detail: `${m.aiAlert.summary}（Price-In 消化度：${m.aiAlert.priceInStatus}${
        m.aiAlert.suggestedDelta ? ` · ${m.aiAlert.suggestedDelta}` : ''
      }）`,
    });
  }
  return out;
}

/**
 * 独立情报参谋客户端（遵循 ADR-0002 与底层数学引擎物理隔离）：
 * 请求服务端「扫地僧小高」实时诊盘接口，不直接污染客观真实隐含概率。
 */
export async function requestXiaoGaoDiagnosis(
  m: MatchItem,
  xgText: string,
  oneGoalSharePct: number,
  userNote?: string
): Promise<XiaoGaoAlert> {
  const hadOdds = m.pools.HAD.options
    .map((o) => `${o.label}@${o.odds.toFixed(2)}(真实隐含概率${(o.fairProb * 100).toFixed(0)}%)`)
    .join(' / ');
  const hhadOdds = m.pools.HHAD.options
    .map((o) => `${o.label}@${o.odds.toFixed(2)}(真实隐含概率${(o.fairProb * 100).toFixed(0)}%)`)
    .join(' / ');
  const vigSummary = `胜平负抽水${(m.pools.HAD.vig * 100).toFixed(1)}%，半全场抽水${(m.pools.HAFU.vig * 100).toFixed(1)}%`;
  const droppingTrends = [
    ...m.pools.HAD.options.filter((o) => o.trend === -1).map((o) => `胜平负${o.label}降水`),
    ...m.pools.HHAD.options.filter((o) => o.trend === -1).map((o) => `${o.label}降水`),
  ].join('、');

  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base = metaEnv?.BASE_URL || '/';
  const res = await fetch(`${base}api/xiaogao/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      matchNumStr: m.matchNumStr,
      league: m.league,
      kickoff: m.kickoff,
      home: m.home,
      away: m.away,
      hadOdds,
      hhadOdds,
      vigSummary,
      xgSummary: xgText,
      oneGoalSharePct,
      droppingTrends,
      userNote,
    }),
  });

  const json = await res.json();
  if (!res.ok || !json?.ok || !json?.alert) {
    throw new Error(json?.error || '扫地僧小高诊盘请求失败');
  }
  return json.alert as XiaoGaoAlert;
}
