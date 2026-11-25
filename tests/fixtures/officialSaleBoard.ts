import type {
  BoardFreshnessMeta,
  MatchItem,
} from "../../src/prototype/quantTypes.ts";

export const freshOfficialBoard: BoardFreshnessMeta = {
  source: "official-live",
  boardState: "fresh",
  lastValidBoardAt: 1_795_492_850_000,
  lastValidBoardClock: null,
  isFallbackReadOnly: false,
  bannerText: null,
};

// For positive checkout tests only. Simulate an official board with an explicit
// decision for every sale mode, retaining the fixture's market restrictions.
export function withConfirmedSaleRights(matches: MatchItem[]): MatchItem[] {
  const confirmed = structuredClone(matches);
  for (const match of confirmed) {
    for (const pool of Object.values(match.pools)) {
      pool.selling ??= pool.options.length > 0;
      pool.confirmedSaleRights = {
        single: pool.selling && (pool.canSingle ?? pool.single),
        allUp: pool.selling && pool.canAllUp !== false,
      };
    }
  }
  return confirmed;
}
