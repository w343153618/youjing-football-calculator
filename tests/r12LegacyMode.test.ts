import assert from "node:assert/strict";
import { it } from "node:test";
import {
  FALLBACK_MATCHES,
  evaluateQuantWorkspace,
} from "../server/quantEngine.mjs";
import type {
  BoardFreshnessMeta,
  MatchItem,
} from "../src/prototype/quantTypes.ts";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";

const board = structuredClone(FALLBACK_MATCHES.slice(0, 2)) as MatchItem[];
board[0].pools.HAD.canSingle = board[0].pools.HAD.single = false;
board[0].pools.HAFU.canSingle = board[0].pools.HAFU.single = true;
board[0].pools.HAD.canAllUp = board[1].pools.HAD.canAllUp = true;

function storedDraft(schemaVersion: number, selections: MatchItem[]) {
  return JSON.stringify({
    schemaVersion,
    picks: selections.map(({ id, home, away }) => ({
      matchId: id,
      home,
      away,
      poolCode: "HAD",
      optionKey: "h",
    })),
    multiple: 2,
    w: 3,
  });
}

function tabs(seed: string, maxLength = Infinity) {
  const values = new Map([["yj_manual_draft_v1:default", seed]]);
  const port = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem(key: string, value: string) {
      if (value.length > maxLength) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  return async (matches: MatchItem[] = board) => {
    const c = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: evaluateQuantWorkspace,
      storagePort: port,
    });
    const boardMeta: BoardFreshnessMeta = {
      source: "official-live",
      boardState: "fresh",
      quotedAt: 1700000000000,
      lastValidBoardAt: 1700000000000,
      lastValidBoardClock: null,
      bannerText: null,
      isFallbackReadOnly: false,
    };
    const workspace = evaluateQuantWorkspace(
      { picks: [], multiple: 1 },
      matches
    );
    c.applyAuthenticatedBundle({
      matches,
      initialPicks: [],
      workspace,
      boardMeta,
    });
    if (c.isDraftWaitingForBoard()) {
      c.applyMatchesSync(
        { matches, workspace, boardMeta, freshBoardForRequest: true },
        c.captureSyncRequestContext()
      );
    }
    await c.flush();
    return c;
  };
}

type Slip = Awaited<ReturnType<ReturnType<typeof tabs>>>;

function checkHeld(c: Slip) {
  assert.ok(c.getState().pendingRevokedPlanConfirm);
  assert.equal(c.getState().workspace.effectiveReport.totalCost, 0);
  assert.equal(c.formatShopkeeperWeChatSlip(), "");
  assert.equal(c.buildSealedLedgerDraft(), null);
}

it("preserves an unresolved synthetic choice through multiplier edits and bridge removal until explicit confirmation", async () => {
  const reopen = tabs(storedDraft(1, [board[0]]));
  const c = await reopen();
  checkHeld(c);
  c.setDirectMultiple(2);
  c.stepMultiple(0);
  c.restoreEqualMultiple();
  await c.flush();
  checkHeld(c);
  c.togglePick(board[1], "HAD", "h");
  await c.flush();
  assert.equal(c.getState().workspace.effectiveReport.totalCost, 4);
  c.removeMatchFromSlip(board[1].id);
  await c.flush();
  checkHeld(c);
  const restored = await reopen();
  checkHeld(restored);
  const previousQuote = restored.getState().pendingSyntheticChoice?.quote;
  assert.ok(previousQuote);
  restored.setDirectMultiple(8);
  await restored.flush();
  checkHeld(restored);
  const quoted = restored.getState().pendingSyntheticChoice?.quote;
  assert.ok(quoted && quoted.cost > 0);
  assert.notEqual(previousQuote.signature, quoted.signature);
  assert.equal(
    restored.confirmSyntheticChoiceQuote(previousQuote.signature),
    false
  );
  assert.match(quoted.label, /合成单关/);
  assert.equal(restored.confirmSyntheticChoiceQuote("stale-quote"), false);
  checkHeld(restored);
  assert.equal(restored.confirmSyntheticChoiceQuote(quoted.signature), true);
  await restored.flush();
  const confirmedCost = restored.getState().workspace.effectiveReport.totalCost;
  assert.equal(confirmedCost, quoted.cost);
  assert.equal(
    (await reopen()).getState().workspace.effectiveReport.totalCost,
    confirmedCost
  );
});

it("migrates older ambiguous two-match bytes without charging for a synthetic after the bridge disappears", async () => {
  for (const cap of [Infinity, 420]) {
    const reopen = tabs(storedDraft(2, board), cap);
    const c = await reopen();
    assert.equal(c.getState().workspace.effectiveReport.totalCost, 4);
    c.setBudget(40);
    await c.flush();
    const restored = await reopen([board[0]]);
    checkHeld(restored);
    restored.setSyntheticSingleMode("off");
    await restored.flush();
    const off = await reopen([board[0]]);
    assert.equal(off.getState().syntheticSingleMode, "off");
    assert.equal(off.getState().workspace.effectiveReport.totalCost, 0);
    assert.equal(off.getState().pendingRevokedPlanConfirm, null);
  }
});

it("requires a concrete ticket confirmation for old boolean auto markers across draft schema versions", async () => {
  const saved = JSON.parse(storedDraft(2, [board[0]]));
  for (const flags of [{ so: 0 }, { sa: 1 }, { lu: 1 }, {}]) {
    const legacy = await tabs(JSON.stringify({ ...saved, ...flags }))();
    checkHeld(legacy);
  }

  const unresolved = tabs(
    JSON.stringify({ ...saved, schemaVersion: 3, lu: 1 })
  );
  const c = await unresolved();
  checkHeld(c);
  c.setBudget(26);
  await c.flush();
  checkHeld(await unresolved());
});

it("keeps a new single conversion at zero through generic controls and preserves the identical priced ticket across a bridge", async () => {
  const reopen = tabs("");
  const c = await reopen();
  c.setDirectMultiple(2);
  c.togglePick(board[0], "HAD", "h");
  await c.flush();
  checkHeld(c);
  c.setSyntheticSingleMode("full-3way");
  c.revertToManualDraft();
  await c.flush();
  checkHeld(c);
  const q = c.getState().pendingSyntheticChoice?.quote;
  assert.ok(q);
  assert.equal(
    q.rows.reduce((sum, row) => sum + row.cost, 0),
    q.cost
  );
  for (const row of q.rows) {
    assert.equal(row.matchId, board[0].id);
    assert.ok(row.poolName && row.optionLabel && row.odds > 1);
    assert.equal(row.cost, 2 * row.multiple);
  }
  assert.ok(c.confirmSyntheticChoiceQuote(q.signature));
  c.togglePick(board[1], "HAD", "h");
  await c.flush();
  assert.equal(c.getState().workspace.effectiveReport.totalCost, 4);
  c.removeMatchFromSlip(board[1].id);
  await c.flush();
  assert.equal(c.getState().workspace.effectiveReport.totalCost, q.cost);
  assert.equal(
    (await reopen()).getState().workspace.effectiveReport.totalCost,
    q.cost
  );

  const updated = structuredClone(board);
  const leg = q.rows[0];
  const chosenPool = Object.values(updated[0].pools).find(
    (pool) => pool.name === leg.poolName
  )!;
  const updatedOption = chosenPool.options.find(
    (o) => o.label === leg.optionLabel
  )!;
  updatedOption.odds += 0.15;
  const changed = await reopen(updated);
  checkHeld(changed);
  assert.equal(changed.confirmSyntheticChoiceQuote(q.signature), false);
});

it("quotes a trim or partial preview before every first payment and prompts again when storage fits only the selection", async () => {
  for (const mode of ["trim-2way", "partial-cover"] as const) {
    const reopen = tabs("", 280);
    const c = await reopen();
    c.setDirectMultiple(2);
    c.togglePick(board[0], "HAD", "h");
    await c.flush();
    c.setSyntheticSingleMode(mode);
    await c.flush();
    checkHeld(c);
    const q = c.getState().pendingSyntheticChoice?.quote;
    assert.ok(q);
    assert.equal(q.mode, mode);
    assert.ok(q.coverageLabel);
    assert.ok(c.confirmSyntheticChoiceQuote(q.signature));
    assert.equal(c.getState().workspace.effectiveReport.totalCost, q.cost);
    const cold = await reopen();
    checkHeld(cold);
    assert.equal(cold.getState().picks.length, 1);
  }
});

it("keeps native singles payable and waits when a two-leg draft first turns into a synthetic single", async () => {
  const matches = structuredClone(board);
  matches[1].pools.HAD.single = matches[1].pools.HAD.canSingle = true;
  const c = await tabs("")(matches);
  c.setDirectMultiple(2);
  c.togglePick(matches[1], "HAD", "h");
  await c.flush();
  assert.equal(c.getState().workspace.effectiveReport.totalCost, 4);
  assert.equal(c.getState().pendingSyntheticChoice, null);
  c.togglePick(matches[0], "HAD", "h");
  await c.flush();
  assert.equal(c.getState().workspace.effectiveReport.totalCost, 4);
  c.removeMatchFromSlip(matches[1].id);
  await c.flush();
  checkHeld(c);
  assert.ok(c.getState().pendingSyntheticChoice?.quote);
});

it("binds bonus optimization to a confirmed synthetic ticket and requires a new priced confirmation for changed row multiples", async () => {
  const reopen = tabs("");
  const c = await reopen();
  c.setDirectMultiple(10);
  c.togglePick(board[0], "HAD", "h");
  await c.flush();
  assert.equal(c.applyBonusOptimization("cold-first").ok, false);
  const original = c.getState().pendingSyntheticChoice?.quote;
  assert.ok(original);
  assert.ok(c.confirmSyntheticChoiceQuote(original.signature));
  const requested = c.applyBonusOptimization("cold-first");
  await c.flush();
  const proposal = c.getState().pendingSyntheticChoice?.quote;
  assert.ok(proposal);
  assert.equal(requested.ok, false);
  assert.equal(requested.awaitingSyntheticQuote, true);
  checkHeld(c);
  assert.notEqual(proposal.signature, original.signature);
  assert.equal(proposal.cost, original.cost);
  assert.ok(c.confirmSyntheticChoiceQuote(proposal.signature));
  assert.ok(c.buildSealedLedgerDraft());
  const copy = await reopen();
  assert.ok(copy.buildSealedLedgerDraft());
  assert.equal(
    copy.getState().workspace.effectiveReport.totalCost,
    proposal.cost
  );
});
