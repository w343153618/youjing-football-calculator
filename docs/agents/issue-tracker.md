# Issue Tracker & Specs

Work items and specifications for `youjing-football-calculator` (`https://github.com/w343153618/youjing-football-calculator`) are tracked via numbered executable specs in `docs/specs/NNNN-*.md` alongside GitHub repository tags/commits.

## Reading a spec (`implement-spec`, `code-review`, `tdd`)

1. Locate the active spec in `docs/specs/` (e.g. `docs/specs/0003-auth-admin-manual-qa-and-combo-audit.md`).
2. Cross-reference canonical terms in `GLOSSARY.md` and architectural constraints in `docs/adr/`.
3. Verify every numbered acceptance item in the spec with automated seam tests in `tests/` and parallel two-axis `code-review` before tagging or deploying.
