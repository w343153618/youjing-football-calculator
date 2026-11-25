import { createHash } from "node:crypto";
import { orderedMatchKey } from "./matchIdentity.mjs";
import {
  isPoolAllUpEligible,
  isPoolSingleEligible,
} from "./quant/statutoryRules.mjs";

// Issued with the baseline quote. Use the authority's ordered teams, handicap,
// odds and required sale right, even if a stored plan still carries older legs.
export function buildTicketLineReceipt(lines, multiple, matches) {
  if (!lines?.length) return null;
  const board =
    matches instanceof Map
      ? matches
      : new Map((matches ?? []).map((m) => [String(m.id), m]));
  const keys = new Map();
  const rows = [];
  for (const line of lines) {
    if (!line.legs?.length) return null;
    const row = [];
    for (const leg of line.legs) {
      const single = line.legs.length === 1;
      const ref = JSON.stringify([
        leg.matchId,
        leg.poolCode,
        leg.optionKey,
        single,
      ]);
      if (!keys.has(ref)) {
        const match = board.get(String(leg.matchId));
        const pool = match?.pools?.[leg.poolCode];
        const option = pool?.options?.find((o) => o.key === leg.optionKey);
        if (
          !option ||
          !(single ? isPoolSingleEligible(pool) : isPoolAllUpEligible(pool))
        )
          return null;
        keys.set(
          ref,
          JSON.stringify([
            leg.matchId,
            orderedMatchKey(match),
            leg.poolCode,
            leg.optionKey,
            leg.poolCode === "HHAD" ? String(pool.goalLine ?? "") : "",
            Number(option.odds),
            single,
          ])
        );
      }
      row.push(keys.get(ref));
    }
    rows.push([
      row,
      Math.max(1, Math.round(Number(line.multiple ?? multiple) || 1)),
    ]);
  }
  const dictionary = [...new Set(keys.values())].sort();
  const index = new Map(dictionary.map((key, i) => [key, i]));
  const normalized = rows
    .map(([legs, mult]) =>
      JSON.stringify([
        legs.map((leg) => index.get(leg)).sort((a, b) => a - b),
        mult,
      ])
    )
    .sort();
  const digest = createHash("sha256");
  digest.update(JSON.stringify(dictionary));
  for (const row of normalized) digest.update("\n").update(row);
  return "ls2|" + digest.digest("hex");
}
