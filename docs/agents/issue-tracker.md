# Issue Tracker & Specs

Specifications and decision maps for `youjing-football-calculator` (`https://github.com/w343153618/youjing-football-calculator`) use local versioned markdown files in this repository (with GitHub tags/releases for milestone artifacts).

## Spec conventions (`to-spec`, `code-review`, `tdd`)

- **System Baseline Spec**: `docs/specs/0000-baseline-spec.md` captures the complete `v2.2.0` production ground truth (features, schemas, cryptographic envelope routes, Sporttery statutory math, and known quirks). Read it before scoping changes to existing behavior.
- **Incremental Feature Specs**: New features and behavior changes are published as numbered specs at `docs/specs/NNNN-<slug>.md` (continuing from `0008-...`), carrying a `Status: ready-for-agent` (or `completed`) header.
- **Verification**: Verify every acceptance item in the active spec with `pnpm run check:guardrails`, automated seam tests in `tests/*.test.ts`, `pnpm build` (which enforces zero `.map` and zero plaintext Chinese chars), and parallel two-axis `code-review` against `CODING_STANDARDS.md` before tagging or deploying.

## Parallel subagent worktrees (`implement-spec`)

When spawning isolated git worktrees for ticket subagents, link the existing `node_modules` directory first so `pnpm typecheck`, `pnpm test`, and `pnpm build` run immediately in `0ms` without network installs:

```bash
ln -s /Users/yawen/gemini/caipiao/football-calculator/node_modules node_modules
```

## Wayfinding operations (`wayfinder`)

Used by `/wayfinder` when planning multi-session efforts wrapped in fog (local-markdown tracker layout):

- **Map**: `.scratch/<effort>/map.md` (holds `## Destination`, `## Notes`, `## Decisions so far`, `## Not yet specified`, `## Out of scope`).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with `## Question` in the body, a `Type:` header (`research` / `prototype` / `grilling` / `task`), and a `Status:` header (`open` / `claimed` / `resolved` / `out-of-scope`).
- **Blocking**: Optional `Blocked by: NN, NN` header line near the top of a child ticket; unblocked when every listed blocker is `resolved`.
- **Frontier**: Scan `.scratch/<effort>/issues/` in numeric order for tickets that are `open`, unblocked, and unclaimed.
- **Claim**: Set `Status: claimed` on the chosen ticket before starting work.
- **Resolve**: Append the decision under `## Answer`, set `Status: resolved`, and append a one-line gist + relative link to `## Decisions so far` in `.scratch/<effort>/map.md`.
