# Domain Docs

How the engineering skills consume this repo's domain documentation when exploring or changing the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root (single-context layout).
- **`docs/specs/0000-baseline-spec.md`**: the full-system `v2.2.0` baseline specification (existing features, data contracts, Sporttery statutory rules, quant formulas, and known quirks).
- **`docs/adr/`** — read the exact ADR file(s) matching the area you touch:
  - `docs/adr/0001-pwa-with-dual-sync-channel.md` — responsive desktop/mobile workbench & server proxy sync
  - `docs/adr/0002-decouple-llm-intel-from-math-engine.md` — deterministic math engine vs XiaoGao intel boundary & primary/fallback routing
  - `docs/adr/0003-in-app-rbac-hidden-admin-and-wechat-session.md` — hidden superadmin RBAC, first-login activation timer & 365-day session
  - `docs/adr/0004-hybrid-iron-cage-manual-qa-with-violation-lockout.md` — 0ms local manual KB + `>4` probe strike account lockout
  - `docs/adr/0005-whole-machine-48h-hardware-fingerprint-meltdown.md` — 48h `hwFp` + contagious IP fuse (`data/security-bans.json`)
  - `docs/adr/0006-native-android-shell-with-hardware-haptics.md` — Android companion WebView container & `YJAndroidNative` linear motor bridge
  - `docs/adr/0007-official-sporttery-rule-parity-and-state-space-parlay-engine.md` — China Sporttery statutory rules, mutex & state-space parlay evaluation
  - `docs/adr/0008-deep-bet-slip-state-seam-unified-runtime-and-server-xiaogao-context.md` — headless `BetSlipController` seam & `createYouJingRuntime` assembly
  - `docs/adr/0009-shin-dixon-coles-coherent-calibration-and-pareto-3plus1-portfolio.md` — `Shin/Power` de-vigging, 5-pool coherent calibration & `3+1` Pareto portfolio
  - `docs/adr/0010-partition-consistent-kl-calibration-and-exact-milp-portfolio.md` — partition-consistent KL/IPF projection, exact 0-1 knapsack/LP portfolio & real Sporttery OOS gate
  - `docs/adr/0011-guided-123-workflow-and-dual-lens-actuary-intel-synergy.md` — guided `1-2-3` workflow, step-adaptive single Primary CTA bar & read-only actuary-to-intel dual-lens synergy
  - `docs/adr/0012-exact-payout-convolution-honest-hedge-and-covering-taxonomy.md` — exact payout convolution above `131,072` states, void-leg statutory cap step-down, single-eligible honest kickoff hedge & strict $t \ge 2$ covering taxonomy
  - `docs/adr/0013-budget-sovereignty-objective-anchor-and-banker-bridge-actuary.md` — bonus budget sovereignty, objective metric lock, timestamp-verified lag & all-integer goalLine calibration, native banker parlay, bridge-match finder & discrete shop anti-slippage suite
  - `docs/adr/0014-snapshot-sealed-ledger-autosettle-and-anti-tilt-lock.md` — print-time snapshot sealing, official Sporttery 5-pool auto-settlement, honest 3-state `won/partial/lost` accounting, anti-tilt deleted-loss guardrail lock, Tab 4 dual-cabin split & domestic shopkeeper WeChat slip
  - `docs/adr/0015-intent-preserving-selection-and-auto-balanced-synthetic-single.md` — intent-preserving mutex-free smooth pool switch (with undo), auto-mounted zero-blind-spot 3-way inverse-odds synthetic single & instant parlay restoration (evolves `ADR-0007` §1 client lock)
- **`docs/specs/NNNN-*.md`**: read the originating incremental specification (latest: `0010-guided-123-workflow-tactile-flip-ui-and-actuary-intel-synergy.md`, `0011-blind-audit-actuarial-and-honesty-remediation.md`, `0012-blind-audit-v2-banker-bridge-and-honest-ui.md`, `0013-dual-track-ledger-autosettle-and-sporttery-workflow-polish.md`) when reviewing or extending a specific feature.

## Use the glossary's vocabulary

When your output names a domain concept (in UI copy, spec headings, refactor proposals, hypotheses, or test names), use the canonical term defined in `GLOSSARY.md` and avoid the synonyms listed under `_Avoid_`.

`GLOSSARY.md` stays strictly free of implementation details; record architectural trade-offs in `docs/adr/` and executable feature contracts in `docs/specs/`.

## Flag ADR conflicts

If a change contradicts an existing ADR in `docs/adr/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (in-app RBAC hidden admin & WeChat session), worth reopening because…_

## Module navigation anchors & test conventions

Use `grep` on these stable symbol anchors instead of scanning line offsets in large files:

- **`server/quantEngine.mjs`**:
  - Calibration & de-vigging: `function devigPoolProbabilities`, `export function calibrateMatchCoherentModel`, `function scanMatchAlphaCandidates`
  - Quotient state space & statutory payout: `export function bankerRoundParlayUnitPayout`, `function evaluateTicketsOnQuotientSpace`, `const canUseExactBilinearMitm`, `function computeSyntheticUncoveredStats`, `function resolveSyntheticSingleBundle`, `export function computeTruthReport`
  - `3+1` Pareto solvers: `function isGenuinePairCoveringDesign`, `function computeSurvivingMissOneFloor`, `function allocateWheelMeanCvar`, `function solveExactKnapsackDutching`, `function allocateSpearAndExactShield`, `export function generateParetoPortfolio`
  - Staggered hedge, insights, bonus, synthetic single & sandbox: `function resolveComplementaryLateHedge`, `export function computeProOrderInsights`, `export function optimizeBonusPlan`, `function buildAutoSyntheticSinglePlan`, `function applySandboxToPlan`, `export function evaluateQuantWorkspace`
- **`server/manualQaEngine.mjs`** (keep both ground-truth surfaces synchronized whenever product rules change):
  - 0ms local curated entries: `const LOCAL_CURATED_QA`
  - Grounded Engine-2 system spec (`>42` char queries): `const APP_GROUND_TRUTH_MANUAL_SPEC`
- **`src/mobile/SkinPhoneApp.tsx`**:
  - Workspace selectors, synthetic mode pills & `>512` bonus gate: `const manualBonusLineCount`, `SyntheticModePills`
  - Step 3 audit cockpit & equalizer: `PayoutEqualizerBars`, `防坑雷达 · 弹性保本 · 省钱动作`
  - Staggered hedge & sandbox drawer: `早场红单减损补单`, `SUBJECTIVE_DELTA_MIN`
- **`tests/*.test.ts` import convention**:
  - Node's native TypeScript test runner (`node --test tests/*.test.ts`) resolves local TypeScript modules with explicit `.ts` extensions (e.g. `import { createBetSlipController } from "../src/workspace/betSlipController.ts"`).
