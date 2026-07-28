# Multi-Agent Max

Multi-Agent Max is a local, Git-driven control plane for user-defined multi-agent workflows.
Tasks are assigned to roles by the user and currently executed through the structured Pi RPC
adapter. Codex CLI and Grok CLI adapters remain available for a later activation.

The current repository is being built by selectively migrating verified source assets from the
Orca-integrated implementation. Product authority and migration decisions live in:

- `docs/final-reuse-integration-plan.md`
- `docs/MAM_CURRENT_PROJECT_REUSE_MATRIX.md`
- `docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`

## Development

```bash
pnpm install
pnpm verify
pnpm smoke:desktop
pnpm smoke:desktop:seeded
pnpm probe:executors
pnpm smoke:pi
```

## Packaging

Build distributable packages on the target operating system:

```bash
# macOS x64: DMG and ZIP
pnpm package:mac

# Windows x64: NSIS installer and ZIP
pnpm package:win
```

Artifacts are written to `release/`. Production packaging is restricted to its native host so the
installer uses the platform's own packaging tools. Architecture and builder arguments are contained
in each native script; no command-line arguments are required.

```bash
./config/scripts/package-mac.sh
```

```powershell
.\config\scripts\package-windows.ps1
```

The migrated program contains shared domain contracts, Artifact validation/storage, Review policies,
Scheduler authority, atomic event batches, deterministic replay, an independent `mam-state`
worktree, command-level Git retry, diagnostics, a sandboxed Electron/React Renderer, and a
source-to-target SHA-256 manifest.
Current phase details are in `docs/MIGRATION_STATUS.md`.
Device Registry, SSH, containers, jcode, terminal-tail completion, independent Agent Sessions,
Role inheritance, Session overrides, fallback routing, and Pi-specific extensions are
intentionally absent.
