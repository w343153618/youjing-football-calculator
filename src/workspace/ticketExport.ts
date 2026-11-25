import type {
  BoardFreshnessMeta,
  MatchItem,
  TerminalPhysicalSlip,
  TruthReport,
} from "../prototype/quantTypes.ts";
import {
  isFreshTicketBoard,
  isTicketLegSaleConfirmed,
} from "../../server/ticketSaleRights.mjs";

export function getPhysicalTicketBlockReason(
  matches: MatchItem[],
  boardMeta: BoardFreshnessMeta | null | undefined,
  report: TruthReport,
  slips: TerminalPhysicalSlip[]
): string | null {
  if (!isFreshTicketBoard(boardMeta))
    return boardMeta?.source === "multisource-backup"
      ? "当前为多源备份同步盘（支持看盘精算与记模拟观察单），出实票前需核对官方售权"
      : "当前为参考盘口，需同步官方在售数据后才能出票";
  if (!report.canCheckout || report.totalCost <= 0)
    return "当前选单尚未形成可出票的最新报价";
  if (
    !slips.length ||
    slips.reduce((sum, slip) => sum + slip.costYuan, 0) !== report.totalCost
  ) {
    return "当前票行与参考金额尚未核对完整";
  }
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  for (const slip of slips) {
    const { legsByMatch, passSizes } = slip;
    if (
      !legsByMatch?.length ||
      !passSizes?.length ||
      !passSizes.every(
        (size) =>
          Number.isInteger(size) && size >= 1 && size <= legsByMatch.length
      )
    ) {
      return "当前票行的过关方式尚未核实";
    }
    const checkSingle = passSizes.includes(1);
    const checkAllUp = passSizes.some((size) => size > 1);
    for (const group of legsByMatch) {
      const pool = matchesById.get(group.matchId)?.pools?.[group.poolCode];
      if (!pool || !group.options?.length)
        return "当前票行的玩法或选项尚未核实";
      if (group.poolCode === "HHAD") {
        const reviewed = String(group.goalLine ?? "").trim();
        const current = String(pool.goalLine ?? "").trim();
        if (!/^[+-]?\d+$/.test(reviewed) || reviewed !== current) {
          return "当前票行的让球线与最新盘口尚未核对";
        }
      }
      for (const option of group.options) {
        const leg = {
          matchId: group.matchId,
          poolCode: group.poolCode,
          optionKey: option.optionKey,
        };
        if (
          (checkSingle &&
            !isTicketLegSaleConfirmed(leg, matchesById, "single")) ||
          (checkAllUp && !isTicketLegSaleConfirmed(leg, matchesById, "allUp"))
        ) {
          return `${group.matchNumStr} ${group.poolName}的出票资格尚未确认`;
        }
        const currentOdds = pool.options.find(
          (candidate) => candidate.key === option.optionKey
        )?.odds;
        if (currentOdds !== option.odds) {
          return "当前票行与最新盘口不一致，请重新核对";
        }
      }
    }
  }
  return null;
}
