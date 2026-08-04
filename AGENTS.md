# HoloFi Protocol Agent Directives

## General Development Rules
- Remove obsolete paths. Ship only current code.
- Use simplest code that meets needs now.
- Build in layers. Ship smallest working version first. Add on top of working product.
- Keep modules separate with clear concerns.
- Prefer mature libraries that simplify or stabilize.
- Check existing deps, docs, and types first.
- Design for the long term.
- Study proven products. Adopt their patterns.

## Verification Workflow
- Before completing any task, always run full compilation, typecheck, and test suite:
  ```bash
  npx hardhat build && npx tsc --noEmit && npx hardhat test
  ```

## Linear Integration & Commit Conventions
- If the commit relates to any Linear issue → Must use `[Magic Word] [TEAM-123]` in the commit message:
  - **Closing magic words** (for final task commits): `fix`, `fixes`, `fixed`, `close`, `closes`, `closed`, `resolve`, `resolves`, `resolved`, `complete`, `completes`, `completed`.
  - **Non-closing magic words** (for specs/plans/intermediate commits): `ref`, `refs`, `relates to`, `related to`, `part of`, `toward`, `towards`.
