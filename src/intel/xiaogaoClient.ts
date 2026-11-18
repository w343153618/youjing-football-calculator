import type { MatchItem } from '../prototype/quantTypes';
import { postEncryptedApi } from '../security/secureClient';

export interface XiaoGaoAlert {
  level: 'high' | 'medium';
  tag: string;
  summary: string;
  priceInStatus: string;
  source: string;
  suggestedDelta?: string;
}

/**
 * 独立情报参谋加密客户端（遵循 ADR-0002 与底层数学引擎物理隔离，全程走 AES-256-GCM 动态信封）
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

  const res = await postEncryptedApi<{ alert: XiaoGaoAlert }>('xiaogao/analyze', {
    matchId: m.id,
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
  });
  return res.alert;
}
