import assert from "node:assert/strict";
import type { createBetSlipController } from "../../src/workspace/betSlipController.ts";

export async function confirmQuotedSynthetic(
  ctrl: ReturnType<typeof createBetSlipController>
) {
  await ctrl.flush();
  const pending = ctrl.getState();
  assert.equal(pending.workspace.effectiveReport.totalCost, 0);
  assert.equal(ctrl.buildSealedLedgerDraft(), null);
  const quote = pending.pendingSyntheticChoice?.quote;
  assert.ok(
    quote && quote.cost > 0 && quote.label.length > 0,
    "Expected a priced synthetic ticket"
  );
  assert.ok(quote.rows.length > 0 && quote.coverageLabel);
  assert.equal(
    quote.rows.reduce((sum, line) => sum + line.cost, 0),
    quote.cost
  );
  assert.equal(ctrl.confirmSyntheticChoiceQuote(quote.signature), true);
  await ctrl.flush();
  assert.equal(ctrl.getState().workspace.effectiveReport.totalCost, quote.cost);
}
