// Reference feeds can carry usable odds without granting permission to print.
export function isFreshTicketBoard(boardMeta) {
  return (
    boardMeta?.source === "official-live" &&
    boardMeta.boardState === "fresh" &&
    boardMeta.isFallbackReadOnly === false
  );
}

export function isTicketLegSaleConfirmed(leg, matchesById, mode) {
  if (!leg || (mode !== "single" && mode !== "allUp")) return false;
  const pool = matchesById?.get(String(leg.matchId))?.pools?.[leg.poolCode];
  if (
    !pool ||
    pool.selling !== true ||
    pool.confirmedSaleRights?.[mode] !== true
  )
    return false;
  if (
    mode === "single"
      ? pool.canSingle === false || pool.single === false
      : pool.canAllUp === false
  )
    return false;
  const option = pool.options?.find(
    (candidate) => candidate.key === leg.optionKey
  );
  return Number.isFinite(option?.odds) && option.odds > 1;
}

export function isTicketLineSaleConfirmed(legs, matchesById) {
  if (!Array.isArray(legs) || !legs.length) return false;
  const mode = legs.length === 1 ? "single" : "allUp";
  return legs.every((leg) => isTicketLegSaleConfirmed(leg, matchesById, mode));
}
