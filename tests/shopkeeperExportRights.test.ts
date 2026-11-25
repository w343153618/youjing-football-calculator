import assert from "node:assert/strict";
import { test } from "node:test";
import { sealAuthoritativePrintSnapshot } from "../server/ledgerManager.mjs";
import {
  evaluateQuantWorkspace,
  FALLBACK_MATCHES,
} from "../server/quantEngine.mjs";
import { buildPosterSlipRows } from "../src/mobile/cabins/cabinViewModels.ts";
import type {
  BoardFreshnessMeta,
  MatchItem,
  PoolCode,
  QuantWorkspaceParams,
} from "../src/prototype/quantTypes.ts";
import { createBetSlipController } from "../src/workspace/betSlipController.ts";
import {
  freshOfficialBoard,
  withConfirmedSaleRights,
} from "./fixtures/officialSaleBoard.ts";

function calculator() {
  const matches = withConfirmedSaleRights(FALLBACK_MATCHES.slice(0, 3));
  const source: { meta?: BoardFreshnessMeta } = { meta: freshOfficialBoard };
  const compute = (params: QuantWorkspaceParams, board: MatchItem[]) => ({
    ...evaluateQuantWorkspace(params, board),
    boardMeta: source.meta,
  });
  const ctrl = createBetSlipController({
    debounceMs: 0,
    computeWorkspace: compute,
  });
  ctrl.initializeMatches(
    matches,
    [],
    compute(ctrl.buildWorkspaceParams(), matches)
  );
  ctrl.setDirectMultiple(1);
  function update(board: MatchItem[], meta?: BoardFreshnessMeta) {
    source.meta = meta;
    ctrl.applyMatchesSync({
      matches: board,
      workspace: compute(ctrl.buildWorkspaceParams(), board),
      boardMeta: source.meta,
    });
    return ctrl.flush();
  }
  function poster() {
    const { workspace, matches, activeAuditedSlip } = ctrl.getState();
    return buildPosterSlipRows(
      workspace.baselineReport ?? workspace.effectiveReport,
      matches,
      workspace.boardMeta,
      new Set(),
      undefined,
      activeAuditedSlip.physicalSlips
    );
  }
  return { ctrl, matches, update, poster };
}

test("real poster and WeChat export follow current single rights and board provenance through refresh", async () => {
  const { ctrl, matches, update, poster } = calculator();
  const idx = matches.findIndex(
    (match) => match.pools.HAD.canSingle ?? match.pools.HAD.single
  );
  assert.ok(idx >= 0);
  ctrl.togglePick(matches[idx], "HAD", "h");
  await ctrl.flush();

  const board = structuredClone(matches);
  board[idx].pools.HAD.confirmedSaleRights = { single: true, allUp: false };
  const other = (idx + 1) % board.length;
  for (const pool of Object.values(board[other].pools))
    delete pool.confirmedSaleRights;
  await update(board, freshOfficialBoard);
  assert.equal(ctrl.buildSealedLedgerDraft()?.cost, 2);
  assert.match(await ctrl.exportWechatText(), /共1张实票 · 合计 ¥2/);
  assert.equal(poster().length, 1);

  for (const meta of [
    {
      ...freshOfficialBoard,
      source: "cached-snapshot" as const,
      boardState: "timeout-fallback" as const,
      isFallbackReadOnly: true,
    },
    undefined,
  ]) {
    await update(board, meta);
    assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, 2);
    assert.equal(ctrl.buildSealedLedgerDraft()?.paperRefCost, 2);
    assert.equal(await ctrl.exportWechatText(), "");
    assert.deepEqual(poster(), []);
  }
  await update(board, freshOfficialBoard);
  assert.equal(poster().length, 1);
  const withoutSingle = structuredClone(board);
  withoutSingle[idx].pools.HAD.confirmedSaleRights = {
    single: false,
    allUp: true,
  };
  await update(withoutSingle, freshOfficialBoard);
  assert.match(ctrl.getShopkeeperBlockReason() ?? "", /资格/);
  assert.equal(ctrl.formatShopkeeperWeChatSlip(), "");
  assert.deepEqual(poster(), []);
  assert.equal(ctrl.buildSealedLedgerDraft()?.paperRefCost, 2);
});

test("a parlay checks every purchased option against that market's all-up right", async () => {
  const { ctrl, matches, update, poster } = calculator();
  const markets: PoolCode[] = ["HAD", "HHAD"];
  for (const [i, code] of markets.entries()) {
    ctrl.togglePick(matches[i], code, matches[i].pools[code].options[0].key);
  }
  await ctrl.flush();
  const board = structuredClone(matches);
  for (const [i, code] of markets.entries()) {
    board[i].pools[code].confirmedSaleRights = { single: false, allUp: true };
  }
  await update(board, freshOfficialBoard);
  assert.equal(ctrl.buildSealedLedgerDraft()?.cost, 2);
  assert.match(ctrl.formatShopkeeperWeChatSlip(), /2串1/);
  assert.equal(poster().length, 1);
  const mixed = structuredClone(board);
  delete mixed[1].pools.HHAD.confirmedSaleRights;
  await update(mixed, freshOfficialBoard);
  assert.equal(ctrl.buildSealedLedgerDraft()?.paperRefCost, 2);
  assert.equal(await ctrl.exportWechatText({ useConsolidated: false }), "");
  assert.deepEqual(poster(), []);
});

test("a confirmed reference synthetic single stays paper on reload and requires a new confirmation on the same official prices", async () => {
  const matches = withConfirmedSaleRights(FALLBACK_MATCHES);
  const match = matches.find(
    (m) => !m.pools.HAD.canSingle && m.pools.HAFU.canSingle
  )!;
  const fallback: BoardFreshnessMeta = {
    ...freshOfficialBoard,
    source: "cached-snapshot",
    boardState: "timeout-fallback",
    isFallbackReadOnly: true,
  };
  const values = new Map<string, string>();
  function open(meta: BoardFreshnessMeta) {
    const calc = (params: QuantWorkspaceParams) => ({
      ...evaluateQuantWorkspace(params, [match]),
      boardMeta: meta,
    });
    const ctrl = createBetSlipController({
      debounceMs: 0,
      computeWorkspace: calc,
      storagePort: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
        removeItem: (key) => {
          values.delete(key);
        },
      },
    });
    ctrl.initializeMatches([match], [], calc(ctrl.buildWorkspaceParams()));
    return ctrl;
  }
  const initial = open(fallback);
  initial.setDirectMultiple(1);
  initial.togglePick(match, "HAD", "h");
  await initial.flush();
  const paper = initial.getState().pendingSyntheticChoice?.quote;
  assert.ok(paper?.referenceOnly && paper.cost > 0);
  assert.equal(initial.confirmSyntheticChoiceQuote(paper.signature), true);
  assert.equal(initial.buildSealedLedgerDraft()?.paperRefCost, paper.cost);
  assert.equal(await initial.exportWechatText(), "");

  const restored = open(fallback);
  await restored.flush();
  assert.equal(restored.buildSealedLedgerDraft()?.paperRefCost, paper.cost);
  assert.equal(await restored.exportWechatText(), "");

  const freshTab = open(freshOfficialBoard);
  await freshTab.flush();
  assert.equal(freshTab.buildSealedLedgerDraft(), null);
  assert.equal(await freshTab.exportWechatText(), "");
  assert.equal(freshTab.confirmSyntheticChoiceQuote(paper.signature), false);
  const official = freshTab.getState().pendingSyntheticChoice?.quote;
  assert.ok(official && !official.referenceOnly);
  assert.equal(official.cost, paper.cost);
  assert.notEqual(official.signature, paper.signature);

  restored.applyMatchesSync({
    matches: [match],
    boardMeta: freshOfficialBoard,
    workspace: {
      ...evaluateQuantWorkspace(restored.buildWorkspaceParams(), [match]),
      boardMeta: freshOfficialBoard,
    },
  });
  await restored.flush();
  assert.equal(await restored.exportWechatText(), "");
  const promoted = restored.getState().pendingSyntheticChoice?.quote;
  assert.ok(promoted && !promoted.referenceOnly);
  assert.equal(restored.confirmSyntheticChoiceQuote(paper.signature), false);
  assert.ok(restored.confirmSyntheticChoiceQuote(promoted.signature));
  assert.equal(restored.buildSealedLedgerDraft()?.cost, paper.cost);
  assert.match(restored.formatShopkeeperWeChatSlip(), /竞彩出票单/);
});

test("a free-pool HHAD ticket carries its original handicap through physical consolidation and rejects same-price handicap drift", async () => {
  const matches = withConfirmedSaleRights(FALLBACK_MATCHES);
  const compute = (p: QuantWorkspaceParams, m: MatchItem[]) => ({
    ...evaluateQuantWorkspace(p, m),
    boardMeta: freshOfficialBoard,
  });
  const ctrl = createBetSlipController({
    debounceMs: 0,
    computeWorkspace: compute,
  });
  const params = {
    ...ctrl.buildWorkspaceParams(),
    picks: [],
    targetIds: matches.slice(0, 2).map((m) => m.id),
  };
  ctrl.initializeMatches(matches, [], compute(params, matches));
  const plan = ctrl
    .getState()
    .workspace.portfolioPlans.find(
      (p) =>
        p.available &&
        p.lines.some(
          (line) =>
            line.legs.length === 2 &&
            line.legs.some((leg) => leg.poolCode === "HHAD")
        )
    )!;
  assert.ok(plan);
  assert.ok(ctrl.applyArchetype(plan));
  await ctrl.flush();
  const s = ctrl.getState();
  const report = s.workspace.baselineReport ?? s.workspace.effectiveReport;
  const slips = s.activeAuditedSlip.physicalSlips!;
  const hhad = slips
    .flatMap((slip) => slip.legsByMatch)
    .find((g) => g.poolCode === "HHAD")!;
  const original = matches.find((match) => match.id === hhad.matchId)!.pools
    .HHAD;
  assert.equal(original.goalLine, "-1");
  assert.equal(hhad.goalLine, original.goalLine);
  assert.equal(
    plan.lines
      .flatMap((line) => line.legs)
      .find((leg) => leg.matchId === hhad.matchId && leg.poolCode === "HHAD")!
      .goalLine,
    original.goalLine
  );
  const posterFor = (board: MatchItem[], reviewedSlips = slips) =>
    buildPosterSlipRows(
      report,
      board,
      freshOfficialBoard,
      new Set(),
      undefined,
      reviewedSlips
    );
  assert.equal(s.picks.length, 0);
  assert.ok(posterFor(matches).length > 0);
  assert.match(ctrl.formatShopkeeperWeChatSlip(), /竞彩出票单/);

  const flipped = structuredClone(matches);
  const current = flipped.find((match) => match.id === hhad.matchId)!.pools
    .HHAD;
  current.goalLine = "+1";
  assert.deepEqual(
    current.options.map((o) => o.odds),
    original.options.map((o) => o.odds)
  );
  assert.deepEqual(posterFor(flipped), []);
  const unbound = structuredClone(slips);
  for (const group of unbound.flatMap((slip) => slip.legsByMatch)) {
    if (group.poolCode === "HHAD") delete group.goalLine;
  }
  assert.deepEqual(posterFor(matches, unbound), []);
  delete current.goalLine;
  assert.deepEqual(posterFor(flipped, unbound), []);
});

test("real sealing verifies both submitted and authoritative HHAD lines before rebinding a snapshot", async () => {
  const { ctrl, matches } = calculator();
  ctrl.togglePick(matches[0], "HAD", "h");
  ctrl.togglePick(matches[1], "HHAD", "hh");
  await ctrl.flush();
  const params = ctrl.buildSealedLedgerDraft()!.workspaceParams!;
  const opts = {
    authoritativeMatches: matches,
    boardMeta: freshOfficialBoard,
    entryKind: "live",
  };
  const report = ctrl.getState().workspace;
  const real = sealAuthoritativePrintSnapshot({
    ...opts,
    workspaceParams: params,
  });
  assert.equal(
    real.snapshot.lines[0].legs.find((l) => l.poolCode === "HHAD")?.goalLine,
    "-1"
  );
  const raw = real.snapshot;
  const sameOdds = structuredClone(matches);
  sameOdds[1].pools.HHAD.goalLine = "+1";
  const noSource = structuredClone(raw);
  delete noSource.lines[0].legs.find((l) => l.poolCode === "HHAD")!.goalLine;
  const noOriginalPick = structuredClone(params);
  delete noOriginalPick.picks.find((l) => l.poolCode === "HHAD")!.goalLine;
  const noCurrent = structuredClone(matches);
  delete noCurrent[1].pools.HHAD.goalLine;
  const stale = { code: "QUOTE_DRIFTED" };
  for (const board of [sameOdds, noCurrent]) {
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          ...opts,
          workspaceParams: params,
          authoritativeMatches: board,
        }),
      stale
    );
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          ...opts,
          workspaceRes: report,
          authoritativeMatches: board,
        }),
      stale
    );
    assert.throws(
      () =>
        sealAuthoritativePrintSnapshot({
          ...opts,
          rawSnapshotFallback: raw,
          authoritativeMatches: board,
        }),
      stale
    );
  }
  assert.throws(
    () =>
      sealAuthoritativePrintSnapshot({
        ...opts,
        workspaceParams: noOriginalPick,
      }),
    stale
  );
  assert.throws(
    () =>
      sealAuthoritativePrintSnapshot({
        ...opts,
        rawSnapshotFallback: noSource,
      }),
    stale
  );
  assert.throws(
    () =>
      sealAuthoritativePrintSnapshot({
        ...opts,
        rawSnapshotFallback: noSource,
        authoritativeMatches: noCurrent,
      }),
    stale
  );
  assert.ok(
    sealAuthoritativePrintSnapshot({
      ...opts,
      rawSnapshotFallback: noSource,
      entryKind: "paper",
    }).snapshot
  );
  const imported = sealAuthoritativePrintSnapshot({
    ...opts,
    rawSnapshotFallback: raw,
    authoritativeMatches: sameOdds,
    allowOfflineTicketOverride: true,
  });
  assert.equal(
    imported.snapshot.lines[0].legs.find((l) => l.poolCode === "HHAD")
      ?.goalLine,
    "-1"
  );
});
