import type { MatchItem, OddsOption, SelectedPick, TruthReport } from '../prototype/quantTypes';
import { postEncryptedApi } from '../security/secureClient';

export interface XiaoGaoAlert {
  level: 'high' | 'medium';
  tag: string;
  summary: string;
  priceInStatus: string;
  source: string;
  suggestedDelta?: string;
}

export interface XiaoGaoComboPerMatch {
  matchId: string;
  matchTitle: string;
  tag: string;
  note: string;
  priceInStatus: string;
}

export interface XiaoGaoComboReport {
  level: 'high' | 'medium' | 'low';
  comboTag: string;
  summary: string;
  weakestLeg: string;
  structureAdvice: string;
  priceInVerdict: string;
  perMatch: XiaoGaoComboPerMatch[];
  matchCount: number;
  source: string;
}

function formatTrendArrow(trend: -1 | 0 | 1): string {
  if (trend === 1) return '↑涨';
  if (trend === -1) return '↓降';
  return '';
}

function formatOptionsSummary(options: OddsOption[], includePrefix = true): string {
  return options
    .map(
      (o) =>
        `${o.label}@${o.odds.toFixed(2)}${formatTrendArrow(o.trend)}(${
          includePrefix ? '真率' : ''
        }${(o.fairProb * 100).toFixed(0)}%)`
    )
    .join(' / ');
}

function formatMatchTrends(m: MatchItem): string {
  return [
    ...m.pools.HAD.options
      .filter((o) => o.trend !== 0)
      .map((o) => `主盘${o.label}${formatTrendArrow(o.trend)}`),
    ...m.pools.HHAD.options
      .filter((o) => o.trend !== 0)
      .map((o) => `${o.label}${formatTrendArrow(o.trend)}`),
  ].join('、');
}

/**
 * 1. 单场独立靶向排雷（不买该队也能随时单独点一下查看！）
 */
export async function requestXiaoGaoDiagnosis(
  m: MatchItem,
  xgText: string,
  oneGoalSharePct: number,
  userNote?: string
): Promise<{ alert: XiaoGaoAlert; aiRemaining?: number }> {
  const vigSummary = `胜平负抽水${(m.pools.HAD.vig * 100).toFixed(1)}%，半全场抽水${(
    m.pools.HAFU.vig * 100
  ).toFixed(1)}%`;

  return postEncryptedApi<{ alert: XiaoGaoAlert; aiRemaining?: number }>('xiaogao/analyze', {
    matchId: m.id,
    matchNumStr: m.matchNumStr,
    league: m.league,
    kickoff: m.kickoff,
    home: m.home,
    away: m.away,
    hadOdds: formatOptionsSummary(m.pools.HAD.options, true),
    hhadOdds: formatOptionsSummary(m.pools.HHAD.options, true),
    vigSummary,
    xgSummary: xgText,
    oneGoalSharePct,
    droppingTrends: formatMatchTrends(m),
    userNote,
  });
}

/**
 * 2. 多场联合串关会诊（支持「一键会诊当前已买多场混合注单」或「自由勾选任意多场比赛横向联合会诊」）
 */
export async function requestXiaoGaoComboDiagnosis(
  targetMatches: MatchItem[],
  picks: SelectedPick[],
  effectiveReport: TruthReport,
  modeDesc: string,
  userNote?: string
): Promise<{ comboReport: XiaoGaoComboReport; aiRemaining?: number }> {
  const matchesPayload = targetMatches.map((m) => {
    const mq = m.microQuant;
    const mpicks = picks.filter((p) => p.matchId === m.id);
    const userPickedDesc =
      mpicks.length > 0
        ? mpicks.map((p) => `${p.poolName}[${p.optionLabel}@${p.odds.toFixed(2)}]`).join(' + ')
        : '';

    return {
      matchId: m.id,
      matchNumStr: m.matchNumStr,
      league: m.league,
      kickoff: m.kickoff,
      home: m.home,
      away: m.away,
      userPickedDesc,
      hadOdds: formatOptionsSummary(m.pools.HAD.options, false),
      hhadOdds: formatOptionsSummary(m.pools.HHAD.options, false),
      xgSummary: `${m.home} ${mq.homeXG} : ${mq.awayXG} ${m.away} (合计${mq.totalXG}球)`,
      oneGoalSharePct: Math.round(mq.oneGoalShareOfWins * 100),
      droppingTrends: formatMatchTrends(m),
    };
  });

  const orderSummary =
    effectiveReport.matchCount >= 2
      ? `${effectiveReport.modeLabel} · 总投入¥${effectiveReport.totalCost} · 保底¥${effectiveReport.minPayout.toFixed(1)}~最高¥${effectiveReport.maxPayout.toFixed(1)} · 综合暗扣抽水${effectiveReport.avgVigLossPer100}% · 真赚钱率${(effectiveReport.realProfitProb * 100).toFixed(1)}%`
      : `共勾选 ${targetMatches.length} 场比赛进行多场联合排雷把脉`;

  return postEncryptedApi<{ comboReport: XiaoGaoComboReport; aiRemaining?: number }>(
    'xiaogao/analyze-combo',
    {
      modeDesc,
      orderSummary,
      matches: matchesPayload,
      userNote,
    }
  );
}
