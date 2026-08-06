# AGENTS.md

## Product Authority

Follow `docs/final-reuse-integration-plan.md` and
`docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`. Do not restore superseded Device Registry,
SSH, container, jcode, independent Session, Role inheritance, fallback, or terminal-tail
completion semantics.

## Design System

All UI work must follow `docs/STYLEGUIDE.md`. Reuse documented tokens and shadcn primitives
before adding new visual values or components.

## Version Records

- Read `docs/versions/README.md` and the version file matching `package.json` before changing the
  project.
- Every intentional feature, optimization, bug fix, refactor, documentation change, or
  configuration change must update that version file in the same change set.
- Keep the version file's feature inventory accurate and append a dated change entry that records
  behavior, implementation scope, state or migration impact, verification, and known limits.
- When `package.json` receives a new version, create the matching `docs/versions/<version>.md`,
  carry forward the still-supported feature baseline, and update `docs/versions/README.md`.
- Do not declare work complete when its version record is missing or stale.

## Code Quality

- Add concise comments only for non-obvious reasons.
- Never disable or raise the max-lines rule for a file.
- Do not use vague module names such as `helpers`, `utils`, `common`, or `misc`.
- Keep Git commands compatible with Git 2.25 and use runtime capability checks for newer options.
- Use path APIs instead of platform-specific separators. macOS is the first release gate, while
  implementation boundaries should remain portable for later Linux and Windows support.
