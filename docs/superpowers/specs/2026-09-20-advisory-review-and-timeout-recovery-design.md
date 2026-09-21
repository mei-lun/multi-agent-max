# Advisory Review and Timeout Recovery

## Status

Design proposal for Multi-Agent Max 0.1.30.

## Problem

Automatic Review currently treats every `changes_requested` result as a hard
workflow transition. A reviewer can repeatedly find non-fatal improvements,
which consumes bounded revision attempts and leaves the Run blocked even when
the delivery is usable. Separately, an Executor timeout preserves a local
Draft but the automatic collaboration loop does not resume that Draft, and the
user does not have a direct continue action for the same Attempt.

## Goals

- Keep normal `role_task` execution automatic and free of implicit Review.
- Keep Review restricted to explicit Workflow `review_gate` nodes and their
  fixed upstream subject.
- Treat non-fatal Review findings as actionable suggestions without blocking
  the current delivery or starting an unnecessary revision Attempt.
- Automatically retry an Executor timeout using the same Draft, worktree and
  Pi session within the existing retry budget.
- Provide a manual Continue action for a Draft that remains
  `waiting_for_resume` after automatic retries are exhausted.
- Preserve bounded behavior: fatal Review findings still stop after the
  configured revision limit, and timeout retries still stop after the role's
  retry limit.

## Non-Goals

- Do not make ordinary tasks reviewable by default.
- Do not allow a reviewer to approve or reject a subject outside its explicit
  Review Gate binding.
- Do not change the Workflow, Review, Attempt, Artifact or Git event schemas.
  A backward-compatible optional `continuationAttempts` field may be added to
  the local Draft record so retry limits survive application restarts.
- Do not silently turn a fatal finding into a suggestion.
- Do not create a new formal Attempt for a timeout continuation.

## Review Policy

The normalized model report remains the source of findings and summary. Before
publication, the automatic Review policy classifies the report:

| Model output                                        | MAM result                        | Workflow effect                                         |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `approved`, any findings                            | `approved` with findings retained | Continue automatically; display findings as suggestions |
| `changes_requested`, no `blocker` finding           | `approved` with findings retained | Continue automatically; no revision Attempt             |
| `changes_requested`, at least one `blocker` finding | `changes_requested`               | Start a bounded revision Attempt                        |
| `blocked`                                           | `blocked`                         | Stop and expose the blocking reason                     |

The existing Review Decision and Review Aggregation `findings` fields retain
the non-fatal suggestions. No new status value is introduced. The mapping is
applied only to automatic Review output; explicit human decisions retain their
requested status and existing authority checks.

For multiple Review Gates, each gate applies this policy to its own bound
subject. A normal role task has no Review Decision and is not affected.

## Timeout Recovery

When the Executor returns `executor_timeout`:

1. Persist the existing Draft as `waiting_for_resume`, including its session,
   worktree, frozen configuration and active runtime.
2. The background execution service schedules continuation of that same Draft
   when the local collaboration loop is active.
3. Continuation reuses the same formal Attempt and worktree, creates a fresh
   Executor invocation ID, and resumes the existing Pi session.
4. Automatic continuation is bounded by the role's existing `retry.maxAttempts`
   value. Each continuation uses the same Draft and does not consume a Review
   revision or create a new formal Attempt.
5. After the automatic retry budget is exhausted, the Draft remains
   `waiting_for_resume` and the UI exposes a manual Continue action. Continue
   uses the same continuation path and requires no new business Attempt.

Other interruption codes retain their current safety behavior. Unknown
external side effects continue to require reconciliation rather than automatic
replay.

## UI and Application API

- Extend the local collaboration action planner to recognize a timed-out
  running Attempt with a recoverable Draft and schedule continuation once.
- Add an explicit Continue action to the Attempt/Task surface for
  `waiting_for_resume`; show the last timeout summary and remaining automatic
  retry budget.
- Keep the existing Review findings visible on the Review and Task views,
  labeled as suggestions when the Review was normalized to `approved`.
- Keep `blocked` findings visible in the Runs attention view. Restart remains
  a separate Run-level action and is not used for timeout continuation.

The existing Application API remains the boundary. Renderer code does not
write Drafts or Git state directly.

## Error Handling and Idempotency

- Repeated continuation requests for the same Draft are coalesced by the
  existing local execution registry.
- A continuation that completes successfully transitions the Draft to
  `delivered` through the existing result path.
- A second timeout increments the local continuation count and either retries
  within budget or leaves the Draft waiting for the user.
- A stale Claim, changed subject, missing worktree, frozen-config mismatch or
  unknown side effect stops continuation with the existing recovery error.
- Review suggestion normalization is deterministic; repeated publication of
  the same subject remains idempotent through existing aggregation checks.

## Implementation Boundaries

- Automatic Review normalization/policy: `src/main/mam/application/automatic-review-submission.ts`.
- Review aggregation publication: existing `review-aggregation-publisher.ts` and
  `mam-attempt-background-runner.ts`.
- Draft continuation and retry budget: `mam-attempt-execution-service.ts`,
  `local-execution-draft-restore.ts`, and the local collaboration planner.
- Manual Continue UI: existing Attempt recovery/task surfaces and the public
  Application API.
- No changes to non-Review task preparation or Review Gate subject binding.

## Verification

- Unit tests for fatal versus non-fatal Review normalization and findings
  preservation.
- Real Git tests proving non-fatal findings complete without a revision and
  blocker findings create a bounded revision.
- Real Git tests proving one timeout continuation reuses the same Attempt,
  session and worktree, and a second timeout stops at the retry budget.
- UI/application tests proving `waiting_for_resume` exposes Continue and
  ordinary `role_task` records no Review decision.
- Typecheck, lint, formatting, focused Vitest suites and a desktop smoke run.

## Version and Migration

The implementation increments the patch version to `0.1.30`. No shared event,
Workflow, Review, Attempt or Artifact schema changes are planned. The local
Draft record may carry an optional continuation counter; existing Drafts
without it are treated as count zero. Existing blocked Runs remain immutable
and are not rewritten. A new Run or explicit Restart uses the new policy.
