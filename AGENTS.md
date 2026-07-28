# AGENTS.md

## Product Authority

Follow `docs/final-reuse-integration-plan.md` and
`docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`. Do not restore superseded Device Registry,
SSH, container, jcode, independent Session, Role inheritance, fallback, or terminal-tail
completion semantics.

## Design System

All UI work must follow `docs/STYLEGUIDE.md`. Reuse documented tokens and shadcn primitives
before adding new visual values or components.

## Code Quality

- Add concise comments only for non-obvious reasons.
- Never disable or raise the max-lines rule for a file.
- Do not use vague module names such as `helpers`, `utils`, `common`, or `misc`.
- Keep Git commands compatible with Git 2.25 and use runtime capability checks for newer options.
- Use path APIs instead of platform-specific separators. macOS is the first release gate, while
  implementation boundaries should remain portable for later Linux and Windows support.
