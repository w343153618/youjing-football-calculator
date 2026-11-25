import {
  freshOfficialBoard,
  withConfirmedSaleRights,
} from "./fixtures/officialSaleBoard.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateQuantWorkspace,
  FALLBACK_MATCHES,
} from "../server/quantEngine.mjs";
import {
  enrichBoardQuoteMeta,
  reconcileMatchesPoolsNonRegressive,
} from "../server/sportteryFeed.mjs";
import { sealAuthoritativePrintSnapshot } from "../server/ledgerManager.mjs";
import { buildPosterSlipRows } from "../src/mobile/cabins/cabinViewModels.ts";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";
import type { MatchItem } from "../src/prototype/quantTypes.ts";

function board(): MatchItem[] {
  return structuredClone(FALLBACK_MATCHES.slice(0, 4)).map((match, i) => ({
    ...match,
    homeTeamId: String(i * 2 + 1),
    awayTeamId: String(i * 2 + 2),
  }));
}

function swapTeams(match: MatchItem) {
  [match.homeTeamId, match.awayTeamId] = [match.awayTeamId, match.homeTeamId];
}

function calculator(matches: MatchItem[]) {
  const c = createBetSlipController({
    debounceMs: 0,
    computeWorkspace: (p, m) => evaluateQuantWorkspace(p, m),
  });
  c.applyAuthenticatedBundle({
    matches: structuredClone(matches),
    initialPicks: [],
    workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, matches),
  });
  c.setDirectMultiple(2);
  return c;
}

test("B5 quote, ordered identity and authoritative receipt remain tied to the confirmed ¥4 line", async () => {
  const matches = withConfirmedSaleRights(board());
  const c = calculator(matches);
  c.togglePick(matches[1], "HAD", "h");
  await c.flush();
  const params = c.buildSealedLedgerDraft()!.workspaceParams!;
  const seal = (workspaceParams = params) =>
    sealAuthoritativePrintSnapshot({
      authoritativeMatches: matches,
      workspaceParams,
      entryKind: "live",
      boardMeta: freshOfficialBoard,
    });
  assert.match(params.expectedSlipLineSig!, /^ls2\|[a-f0-9]{64}$/);
  assert.equal(seal().totalCost, 4);
  swapTeams(matches[2]);
  assert.equal(seal().totalCost, 4); // No paid leg in this match.
  const prior = structuredClone(matches);
  const version = (m: MatchItem[]) =>
    enrichBoardQuoteMeta({ boardState: "live" }, m, 1).quoteVersion;
  swapTeams(matches[1]);
  assert.notEqual(version(matches), version(prior));
  assert.throws(() => seal(), { code: "QUOTE_DRIFTED" });
  for (const expectedSlipLineSig of [
    undefined,
    "ls1|",
    "future-confirmation",
  ]) {
    assert.throws(() => seal({ ...params, expectedSlipLineSig }), {
      code: "QUOTE_DRIFTED",
    });
  }
  prior[1].pools.HAD.updateTime = "23:55:00";
  prior[1].pools.HAD.options[0].odds = 99;
  const fresh = reconcileMatchesPoolsNonRegressive(prior, matches);
  assert.deepEqual(fresh[1].pools.HAD, matches[1].pools.HAD);
});

test("B6 undo rolls back a background pick while keeping a newly confirmed ticket", async () => {
  const matches = board();
  const c = calculator(matches);
  c.setBudget(20);
  for (const match of matches.slice(0, 2)) {
    c.togglePick(match, "HAD", "h");
    c.togglePick(match, "HAD", "d");
  }
  await c.flush();
  const availablePlan = () =>
    c
      .getState()
      .workspace.portfolioPlans.find((p) => p.available && p.lines?.length)!;
  assert.ok(c.applyArchetype(availablePlan()));
  await c.flush();
  const initial =
    c.buildSealedLedgerDraft()!.workspaceParams!.expectedSlipLineSig;
  assert.equal(c.togglePick(matches[0], "HHAD", "hh").action, "switched-pool");
  await c.flush();
  c.setBudget(50);
  await c.flush();
  assert.ok(c.applyArchetype(availablePlan()));
  await c.flush();
  const replacement = c.buildSealedLedgerDraft()!;
  assert.notEqual(replacement.workspaceParams!.expectedSlipLineSig, initial);
  assert.ok(c.undoLastPoolSwitch());
  await c.flush();
  const after = c.buildSealedLedgerDraft()!;
  assert.equal(
    after.workspaceParams!.expectedSlipLineSig,
    replacement.workspaceParams!.expectedSlipLineSig
  );
  assert.equal(after.cost, replacement.cost);
  assert.ok(
    c
      .getState()
      .picks.some((p) => p.matchId === matches[0].id && p.poolCode === "HAD")
  );
});

test("B6 undo after a team correction leaves the revoked ¥20 ticket blocked even if the teams revert", async () => {
  const matches = board();
  const c = calculator(matches);
  c.setBudget(20);
  for (const match of matches.slice(0, 2)) {
    c.togglePick(match, "HAD", "h");
    c.togglePick(match, "HAD", "d");
  }
  await c.flush();
  const initial = c
    .getState()
    .workspace.portfolioPlans.find((p) => p.available && p.lines.length);
  assert.ok(initial && c.applyArchetype(initial));
  await c.flush();
  assert.equal(c.buildSealedLedgerDraft()?.cost, 20);
  assert.equal(c.togglePick(matches[0], "HHAD", "hh").action, "switched-pool");
  await c.flush();
  const syncTeamChange = async () => {
    swapTeams(matches[1]);
    c.applyMatchesSync({
      matches: structuredClone(matches),
      workspace: evaluateQuantWorkspace(c.buildWorkspaceParams(), matches),
    });
    await c.flush();
  };
  await syncTeamChange();
  assert.ok(c.getState().pendingRevokedPlanConfirm);
  await syncTeamChange();
  assert.ok(c.undoLastPoolSwitch());
  await c.flush();
  const s = c.getState();
  assert.ok(s.pendingRevokedPlanConfirm);
  assert.equal(s.workspace.effectiveReport.totalCost, 0);
  assert.equal(c.formatShopkeeperWeChatSlip(), "");
  assert.equal(c.buildSealedLedgerDraft(), null);
  assert.deepEqual(
    buildPosterSlipRows(
      s.workspace.effectiveReport,
      s.matches,
      s.workspace.boardMeta,
      new Set(),
      undefined,
      s.activeAuditedSlip.physicalSlips
    ),
    []
  );
});
