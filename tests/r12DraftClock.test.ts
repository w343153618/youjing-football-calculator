import assert from "node:assert/strict";
import { it } from "node:test";

import {
  evaluateQuantWorkspace,
  FALLBACK_MATCHES,
} from "../server/quantEngine.mjs";
import type { MatchItem } from "../src/prototype/quantTypes.ts";
import type { AuthenticatedWorkspaceBundle } from "../src/security/secureClient.ts";
import {
  createWorkbenchController,
  type WorkbenchQuantPort,
} from "../src/workspace/workbenchController.ts";

const key = "yj_manual_draft_v1:clock";
const capture = 1795492800000;
const matches: MatchItem[] = FALLBACK_MATCHES.slice(0, 3).map((m, i) => ({
  ...structuredClone(m),
  id: String(7000000 + i),
}));
function bundle(
  board: MatchItem[],
  at = capture
): AuthenticatedWorkspaceBundle {
  return {
    user: {
      id: "clock",
      username: "clock",
      note: "",
      role: "member",
      status: "active",
      lockedReason: null,
      createdAt: 0,
      durationHours: null,
      firstLoginAt: null,
      expiresAt: null,
      remainingMs: null,
      maxDevices: 1,
      boundDevicesCount: 0,
      boundDevices: [],
      aiEnabled: false,
      dailyAiLimit: 0,
      aiUsedToday: 0,
      violationCount: 0,
      failedLoginCount: 0,
      loginLockedUntil: null,
    },
    authenticated: true,
    authToken: "fixture",
    syncNote: "fixture",
    matches: board,
    initialPicks: [],
    boardMeta: {
      source: "official-live",
      boardState: "fresh",
      lastValidBoardAt: at,
      lastValidBoardClock: null,
      bannerText: null,
      isFallbackReadOnly: false,
    },
    workspace: evaluateQuantWorkspace({ picks: [], multiple: 1 }, board),
  };
}
function sharedStore(cap = Infinity) {
  const data = new Map<string, string>();
  return {
    getItem(k: string) {
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (k === key && v.length > cap) throw new Error("Quota exceeded");
      data.set(k, v);
    },
    removeItem(k: string) {
      data.delete(k);
    },
  };
}
function tab(
  storagePort: ReturnType<typeof sharedStore>,
  syncMatches?: WorkbenchQuantPort["syncMatches"]
) {
  return createWorkbenchController({
    storagePort,
    debounceMs: 0,
    quantPort: { computeWorkspace: evaluateQuantWorkspace, syncMatches },
  });
}
async function saveParlay(
  storage: ReturnType<typeof sharedStore>,
  board = matches
) {
  const owner = tab(storage);
  owner.applyLoginBundle(bundle(board));
  const slip = owner.betSlip;
  slip.setDirectMultiple(2);
  for (const match of board.slice(0, 2)) slip.togglePick(match, "HAD", "h");
  await slip.flush();
  assert.equal(slip.getState().workspace.effectiveReport.totalCost, 4);
  return owner;
}

it("B1 keeps both legs and the original capture at narrow storage quotas", async () => {
  for (const cap of [199, 200, 207, 220]) {
    const store = sharedStore(cap);
    await saveParlay(store);
    const before = store.getItem(key);
    assert.ok(before);
    assert.equal(JSON.parse(before).qa, capture);
    const stale = tab(store);
    stale.applyLoginBundle(bundle(matches.slice(0, 1), capture - 1000));
    assert.equal(stale.betSlip.buildSealedLedgerDraft(), null);
    stale.betSlip.applyMatchesSync(bundle(matches.slice(0, 1), capture - 500));
    assert.equal(store.getItem(key), before);
    const current = tab(store);
    current.applyLoginBundle(bundle(matches));
    await current.betSlip.flush();
    assert.equal(
      current.betSlip.getState().workspace.effectiveReport.totalCost,
      4
    );
    assert.equal(current.betSlip.getState().picks.length, 2);
  }
});

it("B1 a preview merges only its own preference into the newest ticket", async () => {
  const store = sharedStore();
  const stale = tab(store);
  stale.applyLoginBundle(bundle(matches.slice(1), capture - 1000));
  stale.betSlip.togglePick(matches[2], "HAD", "d");
  await stale.betSlip.flush();
  await saveParlay(store);
  const ticket = JSON.parse(store.getItem(key)!);
  stale.betSlip.setBudget(122);
  await stale.betSlip.flush();
  const merged = JSON.parse(store.getItem(key)!);
  assert.equal(merged.budget, 122);
  assert.ok(merged.w > ticket.w);
  assert.deepEqual({ ...merged, budget: ticket.budget, w: ticket.w }, ticket);
});

it("B2 a delayed login requests the board automatically and restores the complete ticket", async () => {
  const store = sharedStore();
  const owner = await saveParlay(store);
  const original = owner.betSlip.formatShopkeeperWeChatSlip();
  const raw = store.getItem(key);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const client = tab(store, async () => {
    requests++;
    await gate;
    return { ...bundle(matches), freshBoardForRequest: true };
  });
  // At the same timestamp, a conflicting roster still cannot retire a leg.
  client.applyLoginBundle(bundle(matches.slice(0, 1)));
  assert.equal(requests, 1);
  const slip = client.betSlip;
  const waiting = slip.getState();
  const preview = waiting.workspace.portfolioPlans.find(
    (plan) => plan.available && plan.lines?.length
  );
  assert.ok(preview, "The old board contains a real plan to preview");
  assert.equal(slip.isDraftWaitingForBoard(), true);
  assert.equal(slip.applyArchetype(preview), false);
  assert.equal(waiting.livePortfolioQuote.canApplyLiveQuote, false);
  assert.equal(slip.getState().planSpec, null);
  assert.equal(
    client.betSlip.getState().workspace.effectiveReport.totalCost,
    0
  );
  assert.equal(client.betSlip.formatShopkeeperWeChatSlip(), "");
  assert.equal(client.betSlip.buildSealedLedgerDraft(), null);
  assert.equal(store.getItem(key), raw);
  const synced = new Promise<void>((resolve) => {
    const unsub = client.subscribe(() => {
      if (!client.getState().syncing) {
        unsub();
        resolve();
      }
    });
  });
  release();
  await synced;
  await client.betSlip.flush();
  assert.equal(client.betSlip.isDraftWaitingForBoard(), false);
  assert.equal(
    client.betSlip.getState().workspace.effectiveReport.totalCost,
    4
  );
  assert.equal(client.betSlip.formatShopkeeperWeChatSlip(), original);
  assert.ok(client.betSlip.buildSealedLedgerDraft());
  const recovered = slip.getState();
  assert.equal(recovered.livePortfolioQuote.canApplyLiveQuote, true);
  const currentPlan = recovered.workspace.portfolioPlans.find(
    (plan) => plan.available && plan.lines?.length
  );
  assert.ok(currentPlan);
  assert.equal(slip.applyArchetype(currentPlan), true);
  await slip.flush();
  assert.equal(slip.getState().planSpec?.kind, "archetype");
  assert.equal(
    slip.getState().workspace.effectiveReport.totalCost,
    currentPlan.totalCost
  );
});

it("B2 an unknown capture needs matching prices or a fresh acquisition for the same revision", async () => {
  const store = sharedStore();
  await saveParlay(store);
  const saved = JSON.parse(store.getItem(key)!);
  delete saved.qa;
  store.setItem(key, JSON.stringify(saved));
  const client = tab(store);
  client.applyLoginBundle(bundle(matches.slice(0, 1)));
  const slip = client.betSlip;
  const request = slip.captureSyncRequestContext();
  const incomplete = bundle(matches.slice(0, 1), capture + 1000);
  slip.applyMatchesSync(incomplete, request);
  assert.equal(slip.isDraftWaitingForBoard(), true);
  saved.w++;
  store.setItem(key, JSON.stringify(saved));
  slip.applyMatchesSync({ ...incomplete, freshBoardForRequest: true }, request);
  assert.equal(slip.isDraftWaitingForBoard(), true);
  assert.equal(JSON.parse(store.getItem(key)!).picks.length, 2);
  slip.applyMatchesSync(
    { ...bundle(matches), freshBoardForRequest: true },
    slip.captureSyncRequestContext()
  );
  await slip.flush();
  assert.equal(slip.getState().workspace.effectiveReport.totalCost, 4);
});
