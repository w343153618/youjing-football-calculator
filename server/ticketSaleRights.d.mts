import type {
  BoardFreshnessMeta,
  MatchItem,
  PoolCode,
} from "../src/prototype/quantTypes";

interface SaleLeg {
  matchId: string | number;
  poolCode: PoolCode;
  optionKey: string;
}
export function isFreshTicketBoard(
  boardMeta?: Partial<BoardFreshnessMeta> | null
): boolean;
export function isTicketLegSaleConfirmed(
  leg: SaleLeg,
  matchesById: ReadonlyMap<string, MatchItem>,
  mode: "single" | "allUp"
): boolean;
export function isTicketLineSaleConfirmed(
  legs: readonly SaleLeg[],
  matchesById: ReadonlyMap<string, MatchItem>
): boolean;
