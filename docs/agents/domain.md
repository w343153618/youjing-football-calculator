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
  - `docs/adr/0016-deep-module-internal-seams-and-headless-workbench.md` — pure in-process `server/quant/*` internal seams + `sportteryFeed.mjs` I/O eviction, 1-RTT composed headless client workbench + 5 cabin views, single server print-snapshot sealer + transport-focused `securityShield`, and data-driven manual sync (evolves `ADR-0008` & `ADR-0014`)
  - `docs/adr/0017-three-tier-slip-isolation-and-three-axis-portfolio-admission.md` — three-tier slip state isolation (`manualDraftPicks` / version-locked `livePortfolioQuote` / source-tagged `appliedTicketSnapshot`), bidirectional equivalence + pass-structure + per-action stake authorization gates, OOS-calibrated portfolio admission red-lines & unconditional full-distribution audit engine (evolves `ADR-0008..0010` & `ADR-0015` §2)
  - `docs/adr/0018-sporttery-history-wal-worker-and-objective-fact-seams.md` — explicit-owner `collectorWorker` `node:sqlite` WAL + zero-I/O immutable snapshot swap, dual-axis market movement (`Δp` vs last-hop odds), XiaoGao objective historical facts + strict `matchId`/quote-version binding, and frozen actuarial kernel + super-admin read-only exposure/calibration monitoring (evolves `ADR-0002`, `ADR-0009..0011` & `ADR-0016`)
- **`docs/specs/NNNN-*.md`**: read the originating incremental specification (latest: `0010-guided-123-workflow-tactile-flip-ui-and-actuary-intel-synergy.md`, `0011-blind-audit-actuarial-and-honesty-remediation.md`, `0012-blind-audit-v2-banker-bridge-and-honest-ui.md`, `0013-dual-track-ledger-autosettle-and-sporttery-workflow-polish.md`) when reviewing or extending a specific feature.

## Use the glossary's vocabulary

When your output names a domain concept (in UI copy, spec headings, refactor proposals, hypotheses, or test names), use the canonical term defined in `GLOSSARY.md` and avoid the synonyms listed under `_Avoid_`.

`GLOSSARY.md` stays strictly free of implementation details; record architectural trade-offs in `docs/adr/` and executable feature contracts in `docs/specs/`.

## Flag ADR conflicts

If a change contradicts an existing ADR in `docs/adr/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (in-app RBAC hidden admin & WeChat session), worth reopening because…_

## Module navigation anchors & test conventions

Use `grep` on these stable symbol anchors instead of scanning line offsets across deep modules:

- **`server/quantEngine.mjs`**:
  - Pure in-process actuarial facade & LRU workspace cache: `const WORKSPACE_PARETO_CACHE`, `export function evaluateQuantWorkspace`, `export function settleTicketSnapshotWithOfficialResults`
- **`server/quant/statutoryRules.mjs`**:
  - China Sporttery banker's rounding, statutory caps & pass tables: `export function bankerRoundCents`, `export function bankerRoundParlayUnitPayout`, `export function statutorySingleBetCap`, `export const POOL_MAX_PASS`, `export const OFFICIAL_COMBO_PASS_TABLE`
- **`server/quant/coherentCalibration.mjs`**:
  - Shin/Power de-vigging, 5-pool KL/IPF calibration & alpha scanner: `export function devigPoolProbabilities`, `export function calibrateMatchCoherentModel`, `export function tiltAtomicProbsByStance`, `export function scanMatchAlphaCandidates`, `export function analyzeMatchMicroQuant`
- **`server/quant/quotientStateSpace.mjs`**:
  - Quotient state-space DP & exact hit-matrix evaluation: `export function canonicalTicketLegSig`, `export function evaluateMetricsViaHitMatrix`, `export function evaluateTicketsOnQuotientSpace`
- **`server/quant/paretoPortfolio.mjs`**:
  - `3+1` Pareto solvers (`0-1` knapsack, log-wealth shield, `C(v,k,t)` covering wheel & pure `+EV` alpha): `export function computeSurvivingMissOneFloor`, `function solveExactKnapsackDutching`, `function allocateSpearAndExactShield`, `function isGenuinePairCoveringDesign`, `export function generateParetoPortfolio`
- **`server/quant/reportAndSettlement.mjs`**:
  - Truth report, bonus optimization, synthetic single, staggered hedge, quote-version gate & snapshot settlement: `export function resolveSyntheticSingleBundle`, `export function computeTruthReport`, `export function computeProOrderInsights`, `export function optimizeBonusPlan`, `export function applySandboxToPlan`, `export function archetypeToReport`, `export function validateAppliedArchetypeQuoteGate`, `export function settleTicketSnapshotOnResultsMap`
- **`server/quant/sportteryParsers.mjs`**:
  - Pure zero-I/O Sporttery JSON parsers & calibrated fallback fixture: `export const FALLBACK_MATCHES`, `export function parseSportteryRawJson`, `export function parseSportteryResultsJson`
- **`server/sportteryFallbackMatches.mjs`**:
  - Static 8-match Sporttery fallback fixture data: `export function buildPool`, `export const RAW_FALLBACK_MATCHES`
- **`server/sportteryFeed.mjs`**:
  - Upstream Sporttery live odds & 90-minute match result feed I/O adapter: `export async function fetchOfficialMatchesServer`, `export async function fetchOfficialMatchResultsServer`
- **`server/securityShield.mjs`**:
  - Transport ECDH/AES-GCM/HMAC envelope, anti-scraper decoy & 48h `hwFp`/IP fuse: `export function deriveSessionSubkeys`, `export function encryptEnvelope`, `export function decryptEnvelope`, `export function createSecurityShield`
- **`server/appRoutes.mjs`**:
  - Authenticated domain route dispatcher & XiaoGao match-alert reconciliation: `export function reconcileComboAlertsToMatchMap`, `export function createAppRoutes`
- **`server/ledgerManager.mjs`**:
  - Single authoritative print-snapshot sealer & Dual-Track Stop-Loss Ledger: `export function sealAuthoritativePrintSnapshot`, `export function createLedgerManager`
- **`server/manualQaEngine.mjs`**:
  - Derived Iron-Cage Manual Q&A (`0ms` local KB -> Grounded Engine-2 spec): `export const LOCAL_CURATED_QA`, `export function buildAppGroundTruthManualSpec`, `export const APP_GROUND_TRUTH_MANUAL_SPEC`, `export function createManualQaEngine`
- **`src/workspace/betSlipController.ts`**:
  - Pure bet-slip state machine, unified playability gates & WeChat shopkeeper slip: `export function createBetSlipController`, `export function resolveComboTicketBreakdown`, `export function buildMatchIntelDigest`, `export function splitTerminalPosterSlips`
- **`src/workspace/workbenchController.ts`**:
  - Headless client workbench orchestrator (session, ledger, stop-loss, 5s undo, 45s auto-settle & XiaoGao): `export function createWorkbenchController`, `export type WorkbenchController`
- **`src/manual/manualCatalog.ts`**:
  - Structured manual topic catalog, quick Q&A pills, bigram search & chapter specs: `export const MANUAL_TOPICS`, `export const QUICK_QA_PILLS`, `export function resolveManualNavigation`, `export const MANUAL_CHAPTER_SPECS`
- **`src/manual/manualChapters.tsx`**:
  - Illustrated SVG schematics & Q&A panel renderers: `export function ManualChapterContent`, `export function ManualQaSection`
- **`src/manual/UserManualModal.tsx`**:
  - Thin illustrated manual modal shell (`<= 350L`): `export function UserManualModal`
- **`src/mobile/SkinPhoneApp.tsx`**:
  - Responsive dual-viewport shell (`<= 800L`, desktop `>= 960px` 3-column & mobile `< 960px` 4-tab): `export function SkinPhoneApp`, `createWorkbenchController`
- **`src/mobile/cabins/cabinViewModels.ts`**:
  - Shared pure cabin view-models (zero JSX, directly imported by `node --test` & cabins): `export function formatPortfolioGroupAndTicketMetric`, `export function buildPortfolioKpiTiles`, `export function buildAuditCockpitTiles`, `export function formatHedgeDrawerCopy`, `export function buildMatchRadarSelectedSubPoolPills`, `export function buildSyntheticModePillSpecs`, `export function resolveCompactAuditBarPrimaryAction`, `export function buildLedgerEntryPresentation`
- **Pure-render cabin views (`src/mobile/cabins/*.tsx`) & shell choreography**:
  - `src/mobile/cabins/MatchRadarCabin.tsx`: `export function MatchRadarCabin`
  - `src/mobile/cabins/ParetoPortfolioCabin.tsx`: `export function ParetoPortfolioCabin`
  - `src/mobile/cabins/AuditCockpitCabin.tsx`: `export function AuditCockpitCabin`
  - `src/mobile/cabins/IntelCabin.tsx`: `export function IntelCabin`
  - `src/mobile/cabins/LedgerCabin.tsx`: `export function LedgerCabin`
  - `src/mobile/cabins/BottomSheetsLayer.tsx`: `export function BottomSheetsLayer`
  - `src/mobile/cabins/PersistentBetBar.tsx`: `export function SyntheticModePills`, `export function PersistentBetBar`
  - `src/mobile/cabins/useShellChoreography.ts`: `export function useShellChoreography`
- **`tests/*.test.ts` import convention**:
  - Node's native TypeScript test runner (`node --test tests/*.test.ts`) resolves local TypeScript modules with explicit `.ts` extensions (e.g. `import { createWorkbenchController } from "../src/workspace/workbenchController.ts"`).
