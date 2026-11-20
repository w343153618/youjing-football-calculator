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
- **`docs/specs/NNNN-*.md`**: read the originating incremental specification (latest: `0008-coherent-quant-and-pareto-portfolio.md`, `0009-red-team-remediation-and-real-oos-closure.md`) when reviewing or extending a specific feature.

## Use the glossary's vocabulary

When your output names a domain concept (in UI copy, spec headings, refactor proposals, hypotheses, or test names), use the canonical term defined in `GLOSSARY.md` and avoid the synonyms listed under `_Avoid_`.

`GLOSSARY.md` stays strictly free of implementation details; record architectural trade-offs in `docs/adr/` and executable feature contracts in `docs/specs/`.

## Flag ADR conflicts

If a change contradicts an existing ADR in `docs/adr/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (in-app RBAC hidden admin & WeChat session), worth reopening because…_
