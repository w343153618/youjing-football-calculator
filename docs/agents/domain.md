# Domain Docs

How the engineering skills consume this repo's domain documentation when exploring or changing the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root (single-context layout).
- **`docs/adr/`**: read ADRs (`0001` through `0005`+) that touch the area you are about to work in.
- **`docs/specs/`**: read the originating specification (`0001`, `0002`, `0003`, ...) before implementing or reviewing changes.

## Use the glossary's vocabulary

When your output names a domain concept (in UI copy, spec headings, refactor proposals, hypotheses, or test names), use the canonical term defined in `GLOSSARY.md` and avoid the synonyms listed under `_Avoid_`.

`GLOSSARY.md` stays strictly free of implementation details; record architectural trade-offs in `docs/adr/` and executable feature contracts in `docs/specs/`.

## Flag ADR conflicts

If a change contradicts an existing ADR in `docs/adr/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (in-app RBAC hidden admin & WeChat session), worth reopening because…_
