# Migration Status

**Updated:** 2026-07-28  
**Source repository:** `/Users/mei/Documents/multi-agent-max`  
**Target repository:** `/Users/mei/Dev/Github-Poj/multi-agent-max`  
**Authority:** `docs/final-reuse-integration-plan.md` 2.1 and `docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`

## Current result

The independent Electron application now implements the local macOS M0–M7 product path:

- Git-authoritative Workflow Runs, Role Assignment, non-exclusive execution notices, Attempt recovery, deterministic replay and command retry.
- Versioned Role/Executor/Provider/Model/Skill/MCP/Knowledge profiles and local-only bindings.
- Visual Workflow creation/editing with type-specific Inspector controls and schema/compiler round-trip.
- Real local Attempt worktrees, frozen Effective Config, Pi RPC structured execution, validated standard results, Git Artifacts and diagnostics. Codex/Grok adapters remain in the repository but are not wired into the current release.
- Automatic Review panel creation, structured reviewer decisions, deterministic quorum aggregation, human disagreement resolution, invalidation and rework lineage.
- Automatic Git-readable Task Plan materialization and user-resolved Workflow approval gates.
- Deterministic condition routing plus controlled `artifact_transform` and local `command` nodes, with immutable Git-state Artifact output and execution evidence.
- Automatic immutable merge readiness, stable Merge Queue ordering, public execute-next API, integration worktree validation/push, and conflict lineage.
- Runs, My Role, Reviews, Merge Queue, Resources and Settings application surfaces through the sandboxed preload API.
- Frozen Role Profile content in the Git Run Bundle, allowing another clone to continue without the creator's local Role catalog.

Removed scope has not been restored: there is no Device Registry, lease, SSH/WSL host orchestration, container runtime, jcode, independent Agent Session, Role inheritance, automatic fallback or terminal-tail completion.

## Verification

The current validation scope is Pi RPC only. `pnpm verify:final` regenerates `docs/acceptance/final-traceability.json` and per-command logs; Codex/Grok requirements are explicitly recorded as deferred in the report.

| Gate | Result |
| --- | --- |
| Format, lint, typecheck | Passed |
| Deterministic and real-Git tests | 63 files / 167 tests passed |
| Core and Electron production builds | Passed |
| Empty-project desktop smoke | Passed |
| Seeded Git rebuild desktop smoke | Passed |
| Pi RPC real-process smoke | Passed |
| Source manifest regeneration | Passed |
| Legacy requirement mapping | Passed |
| Secret canary | Passed |
| Codex/Grok integration | Deferred for a later release; adapters and tests remain available |

The aggregate result is evaluated against the Pi-only scope; deferred Codex/Grok requirements are not reported as passed.

## Important implementation closures

- Task details expose specification, inputs, output contracts, immutable Attempt history and authoritative Git diff.
- Execution preflight runs before Git state changes; failed local preflight leaves an assigned Task retryable.
- MAM validates Artifact payloads and hashes before the Kernel accepts a result.
- Every Attempt receives a unique Scheduler commit, even when the workspace has no file changes.
- Review approval creates a queue entry only for the reviewed result/commit and exact validation policy.
- Human-approved Review disagreements update the reviewed Task and then publish immutable merge readiness.
- Merge Queue execution claims one entry, merges in an isolated integration worktree, reruns validation, pushes the target and persists the outcome.
- A `git_merge` node completes from its merged queue evidence, allowing the Workflow Run to reach `completed`.
- Merge conflicts become assignable coordinator Tasks whose structured Attempt produces a verified two-parent resolution and persisted lineage.
- A changes-requested replacement uses the prior submitted commit as its base and records `previousAttemptId`.
- Run Bundles embed frozen Role Profiles and verify their content hashes against the Run Role catalog.
- Condition routing cancels unselected branches and converges joins from the selected path; system-node output and failed command evidence replay from `mam-state`.

## Deferred executor work

Codex and Grok adapters, structured router tests, and executor probes remain in the repository for later activation. The main application currently wires only `PiRpcAdapter` and rejects deferred Executor kinds before an Attempt is created.

The generated traceability report is the completion authority. This document is descriptive and must not override a failed machine-readable criterion.
