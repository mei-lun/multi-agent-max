# Flexible Review Output Recovery Design

Date: 2026-09-20

## Purpose

Restore the existing design in which a Role produces business deliverables while MAM constructs
and validates the authoritative Attempt Result. Complete the missing Review boundary so Pi response
commentary, Markdown, localized prose, or a JSON final answer cannot be mistaken for the scheduler
control envelope.

This change reuses the result collection and automatic Review normalization introduced by commit
`73dd060`. It does not introduce a new Artifact or Review submission subsystem.

## Problem

Pi returns the last assistant message as flattened text. Models using the OpenAI Responses protocol
may place both a `commentary` text part and a `final_answer` text part in that message. The current
Review path then:

1. forces the Review output contract to `json-schema`;
2. passes the flattened assistant text to the direct Artifact collector;
3. calls `JSON.parse()` before automatic Review normalization; and
4. interrupts the Attempt before the existing JSON, alias, Markdown, and prose compatibility logic
   can run.

The existing tests call the Review normalizer with an already validated Artifact, so they do not
exercise this ordering defect.

## Design Decisions

### Preserve the existing completion model

- Writable Roles continue to deliver through workspace files and Git changes.
- Read-only Roles continue to deliver one direct textual Artifact through their final response.
- Pi may still return a standard Attempt Result when it supports that contract.
- When Pi does not return a standard Attempt Result, MAM continues to construct the Attempt Result
  from validated workspace or direct Artifact content.
- Terminal tail text, process exit, and idle state do not independently complete an Attempt.

### Separate response phases before collecting content

The Pi adapter will observe the structured assistant message returned by Pi and retain the latest
non-empty `final_answer` text part as the deliverable text. A `commentary` part remains an execution
event for UI and diagnostics but is not concatenated into the Artifact.

Compatibility rules:

- When explicit response-phase metadata is present, only `final_answer` is eligible as deliverable
  text.
- When a provider or older Pi response has no phase metadata and exposes a single text response, the
  existing single-text behavior remains valid.
- Multiple unclassified text parts are not guessed into a delivery. The Attempt remains a local
  draft with a specific ambiguous-output error.
- Standard Attempt Result parsing uses the same selected deliverable text, not the flattened message.

### Normalize Review content before strict Artifact validation

Review Tasks will use the existing automatic Review normalizer on the selected deliverable text
before direct Artifact encoding. The normalizer continues to support:

- the canonical `status`, `summary`, and `findings` object;
- common `decision`, `result`, `conclusion`, `issues`, and localized aliases;
- fenced or surrounded JSON with one unambiguous object;
- Chinese or English Markdown/prose containing an explicit verdict; and
- actionable bullet lists converted into Review findings.

MAM will encode the normalized Review report as the internal JSON Artifact required by the Review
gate. The JSON Schema therefore remains an internal validation and persistence contract; it is not
the required syntax of the Role's chat response.

Non-Review `json-schema` Artifacts remain strict. A Workflow that explicitly declares a general
business Artifact as JSON is still entitled to JSON validation.

### Stop instructing Review Roles to emit JSON

The Review Task prompt will require:

- one explicit verdict: `approved`, `changes_requested`, or `blocked`;
- a concise summary;
- actionable findings when changes are requested; and
- a complete report as the final response.

It will state that JSON, Markdown, and clear prose are accepted. It will no longer say that the Role
must return exactly one JSON object. MAM-owned output contract details remain available for
validation but are described as the canonical stored result, not mandatory response syntax.

## Processing Flow

```text
Pi structured assistant message
  -> retain commentary as diagnostics
  -> select final_answer, or one legacy unclassified text response
  -> try optional standard Attempt Result
  -> otherwise collect workspace/direct business Artifact
  -> for Review: normalize report into canonical Review object
  -> validate Artifact Contract and hashes
  -> MAM builds authoritative Attempt Result
  -> publish Review decision and advance the Scheduler
```

## Recovery

The failed Attempt remains a Local Execution Draft. Recovery of an executor-complete Review must not
call the model again when the persisted Pi session already contains one unambiguous `final_answer`.

The recovery path will:

1. read the latest persisted Pi session for the retained draft;
2. select the `final_answer` using the same phase-aware selector;
3. run Review normalization, Artifact validation, and normal finalization locally; and
4. preserve the same Attempt ID, frozen Effective Config, Claim generation, and worktree.

If the session has no unambiguous final answer, recovery remains `needs_attention`; it must not use
arbitrary terminal text or silently start another Provider request.

## Code Boundaries

- `pi-rpc-adapter`: capture phase-aware deliverable text and keep commentary observable.
- A focused Pi response selector module: interpret text phases independently of process and Artifact
  logic.
- `prepared-attempt-result-collector`: route Review text through canonical normalization before
  direct Artifact parsing.
- `automatic-review-submission`: expose the existing normalization through a small, testable API;
  retain publication and stale-subject logic unchanged.
- `mam-attempt-execution-preparation`: replace the JSON-only Review instruction with format-neutral
  verdict requirements.
- Local draft recovery: reuse the selector and collector without invoking the Executor.

The existing Artifact validator, Review publisher, Scheduler commands, Git finalization, and event
schemas remain authoritative and should not be duplicated.

## Errors

New failures must use stable diagnostic codes rather than raw `SyntaxError` messages:

- `review_output_missing`: no eligible final Review content;
- `assistant_output_ambiguous`: multiple unclassified deliverable candidates;
- `review_output_invalid`: content has no reliable verdict or violates the canonical Review rules;
- `review_output_recovery_unavailable`: a retained session cannot be finalized locally.

All failures retain the Local Execution Draft and worktree. Logs may record phase, byte counts, and
validation issues, but not full private response content or credentials.

## Verification

Unit coverage will include:

- commentary followed by a JSON `final_answer`;
- commentary followed by a Chinese Markdown `final_answer`;
- one legacy unclassified text response;
- rejection of multiple unclassified text responses;
- canonical JSON, aliases, prose verdicts, and actionable bullet normalization;
- a general non-Review JSON Artifact remaining strict; and
- no regression in standard Attempt Result parsing.

Integration coverage will run the complete read-only Review path from Pi execution result through
Artifact validation and automatic Review publication. A recovery test will persist a completed Pi
session, recreate the service, finalize the same draft without calling the Executor, and assert that
the same Attempt ID becomes the formal delivery.

## Non-Goals

- Adding `artifacts.submit`, `reviews.submit`, or `attempts.complete` tools in this change.
- Relaxing explicitly declared non-Review JSON Schemas.
- Treating arbitrary assistant prose, terminal output, process exit, or idle state as completion.
- Changing Workflow, Review, Attempt, or Git event schemas.
- Automatically retrying the model when deterministic local recovery fails.
