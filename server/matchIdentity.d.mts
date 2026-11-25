interface OrderedTeams {
  home?: string;
  away?: string;
  homeTeamId?: string | number;
  awayTeamId?: string | number;
}
export function hashString32Base36(input: string): string;
export function orderedMatchKey(match: OrderedTeams): string;
export function computeOrderedMatchIdentitySig(
  match: OrderedTeams,
  includeTeamIds?: boolean
): string;
export function hasChangedTicketTeam(
  match: OrderedTeams | undefined,
  leg: OrderedTeams & { th?: string }
): boolean;
