import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSportteryRawJson } from "../server/quant/sportteryParsers.mjs";
import {
  enrichBoardQuoteMeta,
  reconcileMatchesPoolsNonRegressive,
} from "../server/sportteryFeed.mjs";
import {
  createLedgerManager,
  sealAuthoritativePrintSnapshot,
} from "../server/ledgerManager.mjs";
import {
  isFreshTicketBoard,
  isTicketLegSaleConfirmed,
  isTicketLineSaleConfirmed,
} from "../server/ticketSaleRights.mjs";

const fresh = {
  source: "official-live",
  boardState: "fresh",
  isFallbackReadOnly: false,
} as const;
const offline = {
  ...fresh,
  source: "cached-snapshot",
  isFallbackReadOnly: true,
} as const;
function match(poolList?: object[], updateTime = "14:00:00", matchId = "A") {
  const had = {
    h: "2.00",
    d: "3.00",
    a: "3.50",
    updateTime,
    updateDate: "2026-11-25",
  };
  return parseSportteryRawJson({
    value: {
      matchInfoList: [
        {
          subMatchList: [
            {
              matchId,
              matchNumStr: "周三001",
              homeTeamAbbName: "主队",
              awayTeamAbbName: "客队",
              had,
              ttg: { s1: "2.00", updateTime },
              poolList,
            },
          ],
        },
      ],
    },
  })[0];
}
const leg = {
  matchId: "A",
  poolCode: "TTG",
  optionKey: "s1",
  odds: 2,
} as const;
const rawSnapshotFallback = { lines: [{ legs: [leg], multiple: 1 }] };
const right = (row: object) =>
  match([{ poolCode: "TTG", ...row }]).pools.TTG.confirmedSaleRights;
const dual = { single: true, allUp: true };
const single = { single: true, allUp: false };
const neither = { single: false, allUp: false };
const verified = [{ poolCode: "TTG", bettingSingle: 1, bettingAllup: 0 }];

describe("current official per-market sale rights", () => {
  it("separates explicit single and parlay authorizations from reference defaults", () => {
    const unknown = match();
    assert.equal(unknown.pools.TTG.canSingle, true);
    assert.equal(unknown.pools.TTG.options[0].odds, 2);
    assert.deepEqual(unknown.pools.TTG.confirmedSaleRights, neither);
    assert.deepEqual(right({ single: 1, cbtValue: 1 }), dual);
    assert.deepEqual(right({ single: 1 }), neither);
    assert.deepEqual(right({ bettingSingle: 1 }), single);
    assert.deepEqual(
      right({ bettingSingle: "1", bettingAllUp: "0", single: 0, cbtValue: 2 }),
      single
    );
    assert.deepEqual(right({ bettingSingle: "0", bettingAllup: 1 }), {
      single: false,
      allUp: true,
    });
    assert.deepEqual(right({ bettingAllup: 1, bettingAllUp: 0 }), neither);
    assert.deepEqual(right({ bettingAllup: null, cbtValue: 1 }), neither);
    assert.deepEqual(
      right({ bettingSingle: 1, bettingAllup: 1, poolStatus: "Suspended" }),
      neither
    );
    assert.deepEqual(
      match([...verified, { poolCode: "TTG", bettingSingle: 0 }]).pools.TTG
        .confirmedSaleRights,
      neither
    );
  });

  it("uses the modes of the paid legs and rejects bad prices or other markets' rights", () => {
    const m = match(verified);
    const m2 = match([{ poolCode: "TTG", bettingAllup: 1 }], undefined, "B");
    const matches = new Map([
      [m.id, m],
      [m2.id, m2],
    ]);
    const second = { ...leg, matchId: "B" };
    assert.equal(isTicketLineSaleConfirmed([leg], matches), true);
    assert.equal(isTicketLineSaleConfirmed([second], matches), false);
    assert.equal(isTicketLineSaleConfirmed([leg, second], matches), false);
    assert.equal(isTicketLegSaleConfirmed(second, matches, "allUp"), true);
    assert.equal(
      isTicketLegSaleConfirmed(
        { ...leg, poolCode: "HAD", optionKey: "h" },
        matches,
        "single"
      ),
      false
    );
    assert.equal(
      isTicketLegSaleConfirmed({ ...leg, optionKey: "s0" }, matches, "single"),
      false
    );
    assert.equal(isTicketLineSaleConfirmed([], matches), false);
  });

  it("invalidates identical-price cached evidence and does not restore it with an older incoming price", () => {
    const confirmed = match([{ poolCode: "HAD", bettingAllup: 1 }]);
    const unknown = match([{ poolCode: "HAD" }], "13:00:00");
    const olderStamp = unknown.pools.HAD.updateTime;
    assert.equal(unknown.pools.HAD.canAllUp, confirmed.pools.HAD.canAllUp);
    const [merged] = reconcileMatchesPoolsNonRegressive([confirmed], [unknown]);
    assert.notEqual(merged.pools.HAD.updateTime, olderStamp);
    assert.deepEqual(merged.pools.HAD.confirmedSaleRights, neither);
    const oldHash = enrichBoardQuoteMeta(fresh, [confirmed], 0).quoteVersion;
    const revokedHash = enrichBoardQuoteMeta(fresh, [merged], 0).quoteVersion;
    assert.notEqual(revokedHash, oldHash);
    const [restored] = reconcileMatchesPoolsNonRegressive(
      [merged],
      [confirmed]
    );
    assert.equal(restored.pools.HAD.confirmedSaleRights.allUp, true);
    assert.equal(
      enrichBoardQuoteMeta(fresh, [restored], 0).quoteVersion,
      oldHash
    );
  });

  it("uses only the server board and does not accept the history import flag from a ledger payload", () => {
    const ledger = createLedgerManager();
    const payload = {
      action: "add-entry",
      kind: "live",
      boardMeta: fresh,
      snapshot: rawSnapshotFallback,
      cost: 2,
      allowOfflineTicketOverride: true,
    };
    assert.throws(
      () =>
        ledger.mutateUserLedger("local", payload, {
          boardMeta: offline,
          authoritativeMatches: [match(verified)],
        }),
      { code: "STALE_FALLBACK_BOARD" }
    );
    assert.throws(
      () =>
        ledger.mutateUserLedger("local", payload, {
          boardMeta: fresh,
          authoritativeMatches: [match()],
        }),
      { code: "UNCONFIRMED_SALE_RIGHTS" }
    );
    assert.equal(ledger.getUserLedger("local").entries.length, 0);
  });

  it("seals a real ¥2 single only with a fresh board and positive rights, and preserves simulation and offline imports", () => {
    const confirmed = match(verified);
    const unknown = match();
    const opts = { rawSnapshotFallback, boardMeta: fresh, entryKind: "live" };
    const real = sealAuthoritativePrintSnapshot({
      ...opts,
      authoritativeMatches: [confirmed],
    });
    assert.equal(real.totalCost, 2);
    assert.equal(real.snapshot.lines.length, 1);
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          ...opts,
          authoritativeMatches: [unknown],
        }),
      { code: "UNCONFIRMED_SALE_RIGHTS" }
    );
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({ ...opts, authoritativeMatches: [] }),
      { code: "UNCONFIRMED_SALE_RIGHTS" }
    );
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          ...opts,
          boardMeta: offline,
          authoritativeMatches: [confirmed],
        }),
      { code: "STALE_FALLBACK_BOARD" }
    );
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          ...opts,
          boardMeta: null,
          authoritativeMatches: [confirmed],
        }),
      { code: "STALE_FALLBACK_BOARD" }
    );
    assert.equal(
      isFreshTicketBoard({ ...fresh, boardState: "timeout-fallback" }),
      false
    );
    const simulated = sealAuthoritativePrintSnapshot({
      ...opts,
      boardMeta: offline,
      entryKind: "paper",
      authoritativeMatches: [unknown],
    });
    assert.equal(simulated.snapshot.lines[0].legs[0].odds, 2);
    const historical = sealAuthoritativePrintSnapshot({
      ...opts,
      boardMeta: offline,
      allowOfflineTicketOverride: true,
    });
    assert.equal(historical.snapshot.lines[0].legs[0].odds, 2);
  });
});
