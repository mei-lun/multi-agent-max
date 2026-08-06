# Multi-Agent Max

[简体中文](README.md) | [English](README.en.md)

Multi-Agent Max (MAM) is a local, Git-driven desktop control plane for user-defined multi-agent
workflows. It turns versioned roles, workflow graphs, isolated Git worktrees, immutable attempt
evidence, reviews, and deterministic integration into one auditable delivery loop.

MAM is not an agent runtime or a remote-machine manager. It coordinates structured executors while
Git remains the authority for shared workflow state.

> [!IMPORTANT]
> MAM is under active development (`0.1.0`). macOS is the first supported release target. The
> current application executes production attempts through Pi RPC only; Codex CLI and Grok CLI
> adapters remain in the repository for later activation.

## What it provides

- **User-defined roles** — Versioned Role Profiles combine an executor, model, prompt, Skills, MCP
  servers, knowledge bases, tools, permissions, budgets, retry policy, and context policy.
- **Visual workflows** — Create and edit graphs containing role tasks, dynamic tasks, reviews,
  approvals, conditions, parallel branches, joins, artifact transforms, commands, Git merges, and
  bounded rework loops.
- **Design Assistant** — Use an existing Model Profile to clarify requirements, compare approaches,
  review a generated design section by section, and create new role and workflow definitions after
  explicit confirmation. Drafts stay local, do not read project files automatically, and never
  start a run or task when applied.
- **Fixed execution semantics** — Every executable workflow node binds exactly one role at design
  time. Tasks inherit that role and cannot be reassigned while a run is in progress.
- **Git-authoritative collaboration** — Append-only events live on an independent `mam-state`
  branch. A configured remote enables collaboration across clones; a local-only repository supports
  multiple roles on one machine.
- **Isolated attempts** — Code attempts run in dedicated branches and worktrees with a frozen
  effective configuration, structured results, immutable artifacts, and complete lineage.
- **Review and integration** — Review decisions attach to exact attempts and commits. The merge
  queue uses stable ordering, reruns validation in an integration worktree, and records conflict
  resolution lineage.
- **Automatic progression and review rework** — After a run starts, ordinary, dynamic, and Agent
  review Tasks whose dependencies and fixed roles are resolved start Attempts automatically. When
  a `review_gate` returns `changes_requested`, MAM follows the workflow-defined review target and
  bounded rework semantics, returns the findings to the producing role, creates a new Attempt with
  `previousAttemptId`, and automatically submits the replacement for review again.
- **Human review gates** — `human_review_gate` stops an upstream artifact. The user only enters
  feedback and chooses approve, request changes, or block. Change requests return to the fixed
  producing role, which reworks the artifact and submits it for review again within a bounded limit.
- **Role communication and attention queue** — Every role Task has native human clarification.
  Roles can ask up to five questions at once, provide 2–3 options and a recommendation for
  decisions, and continue clarifying until the user confirms the understanding. Reviews, role
  questions, and rework conversations share one deterministic **Needs Attention** queue.
- **Recovery and diagnostics** — Rebuild projections from Git, preserve attempt history across
  retries, reconcile unknown side effects, and export correlated diagnostics without persisting
  plaintext secrets.
- **Bilingual desktop UI** — Switch between English and Simplified Chinese from the application
  header.

## Project positioning: a domain implementation of Graph Engineering

Architecturally, MAM is a **Git-backed graph workflow orchestration platform**. The workflow graph
is the execution model, the Scheduler Kernel is the graph scheduler, Git events and Run Bundles are
the replayable authority, and structured Agent Executors perform the concrete work.

```text
Workflow Graph
      ↓
Workflow Compiler
      ↓
Scheduler Kernel
      ↓
Task / Attempt / Artifact
      ↓
Pi RPC (current) / Codex CLI and Grok CLI (later)
      ↓
Git State + Review + Merge Queue
```

This has the key properties of Graph Engineering: nodes and edges describe dependencies, the
Scheduler computes executable nodes from the graph, and conditions, parallel branches, joins,
approvals, reviews, Artifact transforms, and bounded rework are execution semantics on that graph.
Each node's result can become an Artifact input for downstream nodes.

MAM is not a graph database, GraphQL service, or general-purpose graph-data infrastructure. It is
also more than a lightweight DAG task queue: it adds role configuration, Agent invocation, Attempt
history, review, Git branches/worktrees, merge queues, and recovery on top of graph execution.

| Layer | MAM implementation |
| --- | --- |
| Graph model | Workflow, Node, Edge, Condition, Parallel, Join |
| Graph compilation | Workflow Compiler, execution plan, bounded-loop validation |
| Graph scheduling | Scheduler Kernel, dependency calculation, state transitions, authoritative writes |
| Execution backends | Pi RPC; structured Codex CLI and Grok CLI adapters (later activation) |
| State persistence | `mam-state` Git branch, append-only events, deterministic replay |
| Result propagation | Artifacts, Reviews, Approvals, Git Merge |
| Operator surfaces | Visual Workflow Editor, Attempt Timeline, Live Activity, Merge Queue |

## Sidebar features

| Feature | What it does |
| --- | --- |
| **Overview** | Connect or switch Git projects and see active roles, workflows, runs, merge entries, and authoritative-state issues that require attention. |
| **Design Assistant** | Use an existing Model Profile for a local multi-turn conversation that clarifies requirements, compares approaches, finds workflow defects, and confirms the design section by section. Applying a design creates new roles and a workflow, or the next version of an existing workflow, without starting a run or task. |
| **Roles** | Create and manage versioned Role Profiles that combine an executor, model, system prompt, Skills, MCP, knowledge bases, permissions, budgets, retry policy, and context policy. |
| **Workflows** | Visually manage versioned execution graphs, including nodes, edges, Artifact contracts, fixed role bindings, loop limits, duration, and budget, then start a run from a selected version. |
| **Runs** | Inspect each Workflow Run, its tasks, Attempt timeline, structured results, Git diffs, recovery actions, approval gates, and integration progress. Historical Attempts remain available. |
| **Live Activity** | Observe every node, role message, tool call, command, usage update, and state change for a selected run. Filter active or attention-required nodes and export the complete activity record. |
| **My Role** | Select locally participating roles, see tasks fixed to the selected role by their workflow, start Attempts, and manage automatic local participation by role and run. |
| **Needs Attention** | Handle role questions, rework conversations, and human review in one queue sorted by scope, blocked task count, waiting time, and stable ID. Each item opens in a separate dialog for multi-turn communication. |
| **Reviews** | Review submitted work against an exact Attempt, result, validation evidence, and Git diff; approve, request changes, or block; and resolve aggregated multi-reviewer disagreements. |
| **Merge Queue** | Track immutable reviewed revisions, execute deterministic integration order, rerun validation, and inspect queued, active, failed, conflicting, and historical entries. |
| **Resources** | Import and manage versioned Skills, MCP Server Profiles, and Knowledge Base Profiles, including the role allowlists that reference them. |
| **Settings** | Configure Provider, Model, and advanced Executor Profiles together with machine-local executable, secret, MCP, Skill, knowledge, and Git path bindings; export diagnostics when needed. |

## Interface and delivery demo

### Workflow management

A workflow can evolve through multiple versions. Each version freezes its nodes, edges, roles,
transition limit, duration, and budget, and a user can start a run directly from the selected
version.

![Multi-Agent Max workflow management](docs/readme/assets/mam-workflows.png)

### Live Activity

Live Activity groups role messages, tool and command events, token usage, and execution state by
node, making it easy to follow current work and locate anything that needs attention.

![Multi-Agent Max Live Activity](docs/readme/assets/mam-live-activity.png)

### Delivered result

The number-guessing page below was designed, implemented, reviewed, approved, and merged by the
demo workflow, illustrating the final result of a multi-role delivery coordinated by MAM.

![Number-guessing page delivered by a Multi-Agent Max workflow](docs/readme/assets/mam-delivery-example-number-game.png)

## How it fits together

```text
Role Profiles + Workflow Definition + Git Repository
                         |
                  Scheduler Kernel
                         |
          Application API / policy boundaries
                         |
         Pi RPC Adapter (current release path)
                         |
             Model Provider and tools

Authoritative events  -> mam-state branch -> deterministic projection
Code attempts         -> task branches    -> review -> merge queue
Machine-local data    -> secrets, paths, executor and resource bindings
```

The Scheduler Kernel is deterministic and does not call a model. Agents can propose results and
provide evidence, but only the kernel can advance authoritative task, review, and merge state.

## Quick start for development

### Prerequisites

- macOS (current release gate)
- Node.js 22.22 or newer
- pnpm 10.24.x
- Git 2.25 or newer

### Install and run

```bash
git clone https://github.com/mei-lun/multi-agent-max.git
cd multi-agent-max
pnpm install
pnpm dev
```

To run the production preview instead:

```bash
pnpm build
pnpm start
```

## First workflow

1. Open **Overview** and choose a local Git repository. MAM creates or attaches an independent
   `mam-state` worktree without moving the project branch.
2. Open **Settings** and configure the Provider and Model Profiles required by your roles. The Pi
   executor profile and bundled Pi CLI binding are created automatically when available.
3. Add machine-local secret, MCP, Skill, and knowledge-base bindings. These bindings are not written
   to shared Git state.
4. Create Role Profiles under **Roles**. Then use **Design Assistant** or **Workflows** to create a
   versioned workflow whose executable nodes each have one fixed role.
5. Start a run from **Workflows**. Fixed-role nodes execute automatically when their dependencies
   are satisfied. When an Agent review requests changes, MAM automatically starts a new Attempt for
   the workflow-defined producing role and sends the replacement through review again. Monitor the
   process in **Runs**, **Live Activity**, and **My Role**.
6. Human action is required only for explicit approval or human-review gates, role clarification,
   unresolved reviewer disagreement, `blocked`, `reconciliation`, missing resources, or preflight
   failure. Handle those items in **Needs Attention**. For a human change request, enter the problem
   points only; after confirming its understanding, the fixed upstream role performs the rework.
   Reviewed code enters **Merge Queue** only when the workflow contains a Git merge stage and its
   validation evidence is current.

For a repository with no commits, MAM can create the first empty commit when the first attempt is
started, provided the worktree is clean. If staged, modified, or untracked files exist, create the
initial commit yourself first so MAM never commits user work implicitly.

## Local secrets

Secret values stay outside Role, Workflow, Run, and Attempt definitions. Add them through the
encrypted local secret store in the UI, or expose an environment variable derived from the local
secret binding ID:

```text
secret.openai -> MAM_SECRET_SECRET_OPENAI
provider-key  -> MAM_SECRET_PROVIDER_KEY
```

The conversion uppercases the ID, replaces punctuation with underscores, and prefixes
`MAM_SECRET_`. Effective configuration snapshots record only references and content hashes, never
the secret value.

## Automatic review, human gates, and role communication

`review_gate` is an Agent review node executed by its fixed reviewer role. Its ordinary path does
not require the user to advance or reassign anything:

```text
Fixed producing role runs automatically
                 ↓
Fixed reviewer role reviews automatically
          ┌──────┴──────────────┐
       approve            request changes
          ↓                       ↓
workflow downstream      new producing-role Attempt
                                  ↓
                         automatic review again
```

Each replacement records `previousAttemptId` and remains bounded by `maxRevisionAttempts` or the
return edge's `maxTraversals`. Only an explicit `approval_gate` or `human_review_gate`, role
clarification, unresolved multi-reviewer disagreement, `blocked`, `reconciliation`, missing
resources, or preflight failure pauses this automatic path.

Human review is an explicit workflow gate, not a decision delegated to the role:

```text
Upstream role submits artifact
            ↓
     Human review gate
       ┌────┼────────┐
    approve  changes  block
       ↓        ↓
   downstream  fixed upstream role
                    ↓
          clarify and confirm understanding
                    ↓
              new Attempt rework
                    ↓
              back to human review
```

When a role faces uncertainty that could materially change the result, it pauses the current Task
and dependent downstream work, while independent parallel branches continue. The user can answer
questions in batches, choose recommendations, provide free-text facts, or request clarification
of the role's understanding. Execution cannot start or resume until the user explicitly confirms.

See the [Human Review and Role Clarification Product Design](docs/readme/HUMAN_REVIEW_AND_CLARIFICATION_DESIGN.md)
for the state model, events, authority rules, and acceptance scenarios.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Electron and the renderer in development mode |
| `pnpm build` | Build the TypeScript core and Electron application |
| `pnpm test` | Run unit, integration, real-Git, and package-script tests |
| `pnpm lint` | Lint `src` and `config` with oxlint |
| `pnpm typecheck` | Type-check the application without emitting files |
| `pnpm format:check` | Check formatting without rewriting files |
| `pnpm verify` | Run format, lint, typecheck, tests, and production builds |
| `pnpm smoke:desktop` | Smoke-test an empty desktop project |
| `pnpm smoke:desktop:seeded` | Rebuild seeded state from Git in the desktop app |
| `pnpm smoke:pi` | Exercise the Pi RPC adapter with a real local process |
| `pnpm probe:executors` | Generate structured executor capability evidence |
| `pnpm verify:final` | Regenerate final traceability evidence and acceptance logs |

The final verification report is written to
[`docs/acceptance/final-traceability.json`](docs/acceptance/final-traceability.json). Deferred
requirements are reported as deferred rather than passed.

## Packaging

Build the current macOS x64 DMG and ZIP on macOS:

```bash
pnpm package:mac
```

Artifacts are written to `release/`. Packaging reuses the Electron distribution under
`node_modules/electron/dist` and retries transient builder failures up to three times. If GitHub is
unreachable during dependency or packaging work, opt into a trusted mirror explicitly:

```bash
MAM_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm package:mac
```

A Windows packaging script exists for portability work, but Windows and Linux are not current
release gates and are not yet supported targets.

## Git and data model

MAM deliberately separates three kinds of state:

| State | Location | Authority |
| --- | --- | --- |
| Frozen Run Bundles, tasks, attempts, formal artifacts, reviews, approvals, and merge evidence | `mam-state` Git branch | Shared and authoritative |
| Code changes | Dedicated task/attempt branches and worktrees | Git commits referenced by authoritative events |
| Reusable Profile and Workflow catalogs, executable paths, credentials, local resource connections, caches, and large diagnostics | Electron user-data directory | Machine-local; each Run copies its frozen workflow and roles into Git |

Execution notices are advisory, not locks. If two clones start the same task, both attempts are
preserved and the UI reports concurrent execution instead of silently discarding history.

## Project structure

```text
src/
  main/
    mam/
      application/     Application services and command orchestration
      scheduler/       Deterministic state transitions and authority checks
      workflow/        Workflow compilation and execution planning
      state-store/     Git-backed append-only events and replay
      executors/       Structured executor adapters and process integration
      profiles/        Versioned catalogs and effective config materialization
      artifacts/       Artifact validation and local large-object storage
      review/          Review aggregation and rework rules
      gateways/        MCP and knowledge access boundaries
      diagnostics/     Correlated runtime evidence and exports
    ipc/               Sandboxed Electron IPC boundary
  preload/             Narrow renderer-facing API
  renderer/src/        React desktop UI and bilingual messages
  shared/mam/          Zod domain contracts and Application API schemas
config/scripts/        Verification, smoke, probe, and packaging scripts
docs/                  Product authority, migration records, style guide, and evidence
```

## Scope boundaries

The current product intentionally does **not** include Device Registry, device assignment,
exclusive leases, SSH orchestration, containers, jcode, independent Agent Sessions, Role
inheritance, Session overrides, automatic executor/model fallback, terminal-tail completion, or
hosted issue/PR integrations.

Codex CLI and Grok CLI remain planned structured executors. They must pass capability and local
preflight checks before activation; MAM will not silently fall back to another executor, provider,
or model.

## Documentation

- [Final product and reuse plan](docs/final-reuse-integration-plan.md) — the current product
  authority
- [Requirements delta and traceability](docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md) — stable
  requirement IDs and superseded semantics
- [0.1.0 version feature record](docs/versions/0.1.0.md) — current capabilities, optimization
  history, limits, and verification baseline
- [Version record policy](docs/versions/README.md) — mandatory record format and update process for
  every subsequent change
- [Human Review and Role Clarification Product Design](docs/readme/HUMAN_REVIEW_AND_CLARIFICATION_DESIGN.md) — review gates, the unified attention queue, and multi-turn communication
- [Migration status](docs/MIGRATION_STATUS.md) — implemented path and deferred executor work
- [Current-project reuse matrix](docs/MAM_CURRENT_PROJECT_REUSE_MATRIX.md) — source migration
  decisions
- [UI style guide](docs/STYLEGUIDE.md) — required design tokens and component rules

When documents conflict, the final product and reuse plan takes precedence.

## Contributing

Keep changes aligned with [`AGENTS.md`](AGENTS.md) and the product authority above. Every feature,
optimization, fix, refactor, documentation update, or configuration change must update the version
record matching `package.json` in the same change set; the current record is
[`docs/versions/0.1.0.md`](docs/versions/0.1.0.md). Before opening a pull request, run:

```bash
pnpm verify
pnpm smoke:desktop
pnpm smoke:desktop:seeded
pnpm smoke:pi
pnpm verify:final
```

## License

[MIT](LICENSE)
