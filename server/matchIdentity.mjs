// Pure ticket identity helpers shared with the thin client. The compact hash
// stays compatible with existing saved picks; current checkout binds the exact ordered tuple.
export function hashString32Base36(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function orderedTeams(m) {
  return [m.home, m.away, m.homeTeamId, m.awayTeamId].map((v) =>
    String(v ?? "").trim()
  );
}

export function orderedMatchKey(m) {
  return JSON.stringify(orderedTeams(m));
}

export function computeOrderedMatchIdentitySig(m, includeTeamIds) {
  const [home, away, homeId, awayId] = orderedTeams(m);
  const useIds = includeTeamIds ?? Boolean(homeId || awayId);
  const body = useIds ? [home, away, homeId, awayId] : [home, away, "", ""];
  return (useIds ? "i" : "n") + hashString32Base36(body.join("|"));
}

export function hasChangedTicketTeam(match, leg) {
  if (!match) return true;
  if (leg.home && String(leg.home).trim() !== String(match.home ?? "").trim())
    return true;
  if (leg.away && String(leg.away).trim() !== String(match.away ?? "").trim())
    return true;
  return Boolean(
    leg.th &&
    leg.th !==
      computeOrderedMatchIdentitySig(match, String(leg.th).startsWith("i"))
  );
}
