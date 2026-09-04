# Codex Resource Import and Health Design

## Status

- Date: 2026-09-04
- Scope: selectable local Codex Skill and MCP import plus Skill, MCP, and Knowledge Base health checks
- Product version at design time: 0.1.1
- Approved direction: discover all local Codex resource sources, import selected Skills and MCP servers, and verify every active resource through the Pi execution path

## Problem

The Resources page currently imports one Skill directory at a time, requires MCP Profiles and local connections to be entered manually, and does not show whether a configured resource can be used. This makes the user's existing Codex setup expensive to reproduce in MAM and allows invalid or Pi-incompatible resources to remain indistinguishable from working resources until an Attempt fails.

Codex Skills and MCP servers also do not map directly to a single Pi mechanism. Pi loads Skill packages through its Skill loader, while MAM exposes MCP and Knowledge Base capabilities to Pi through controlled application API bridges. A useful health result must therefore distinguish resource validity from compatibility with the path Pi actually uses.

## Goals

- Discover the Skills and MCP servers available to the user's local Codex installation.
- Include user, built-in, installed-plugin, and `config.toml` sources, with their source visible in the import picker.
- Let the user search, select, and import multiple resources in one operation.
- Avoid duplicate imports when content has not changed and activate a new version when content has changed.
- Keep historical versions hidden and unavailable for new selection while retaining them for frozen Runs and Attempts.
- Keep imported MCP environment and header values out of shared Profiles, renderer discovery results, logs, and unencrypted local settings.
- Check all active Skills, MCP servers, and Knowledge Bases from one Resources-page action.
- Mark invalid resources and resources that cannot be used through the Pi execution path.
- Persist only local, derived health results and invalidate them when relevant configuration changes.

## Non-goals

- Importing Codex memories, `AGENTS.md`, rules, project documents, or other files as Knowledge Base Profiles.
- Treating MCP resources as duplicate Knowledge Base Profiles.
- Executing an LLM task to decide whether a model will choose a resource correctly.
- Calling an MCP tool during a health check.
- Periodic or background health polling.
- Automatically disabling a resource, changing Role allowlists, or rewriting a Workflow after a failed check.
- Deleting historical Profile versions required by existing Runs or Attempts.
- Restoring global Executor resource discovery. Attempts continue to receive only their Role allowlist.

## Product Decisions

- The import picker shows all discoverable local Codex Skill and MCP sources. Nothing is selected by default.
- Knowledge Bases remain MAM-managed resources and participate only in health checks.
- Reimporting unchanged content is a no-op. Changed content creates and activates a new version.
- Only the active version appears in resource management and health checks. Historical versions remain internal for reproducibility.
- Health checks are user-triggered with one `Check all` action.
- A health check verifies deterministic loading and bridge behavior without model calls or mutating MCP operations.

## Architecture

### Codex resource discovery

A main-process `CodexResourceDiscovery` service resolves Codex home from an explicit `CODEX_HOME` value when present and otherwise from `homedir()` plus `.codex`. It does not rely on platform-specific separators.

The service discovers:

1. Skills under the Codex Skills roots, including the user root and `.system`.
2. Skills declared by installed plugin manifests and their referenced Skill directories.
3. MCP servers declared in Codex `config.toml`.
4. MCP servers declared by installed plugin manifests.

Discovery normalizes every candidate into a secret-free descriptor with a stable source key, display name, resource kind, source category, canonical source location, content fingerprint, and import state. Import state is `new`, `updated`, or `current`, calculated against the active MAM Profile and its local binding.

Malformed, missing, or unsupported candidates remain visible as unavailable rows with a concise validation reason. Duplicate physical sources are collapsed by canonical path for Skills and normalized connection identity for MCP. When two distinct sources claim the same logical ID, the picker shows the collision and requires the user to choose at most one.

Discovery never returns MCP environment values or HTTP header values to the renderer. It returns names, presence flags, and masked metadata only.

### Import contracts

The shared application API adds separate, schema-validated operations to:

- list Codex import candidates;
- import a set of selected candidate keys plus explicitly supplied missing secret values;
- run all resource health checks.

The renderer submits opaque candidate keys rather than source paths or raw parsed configurations. On import, the main process performs discovery again and resolves each key from the fresh result. This prevents renderer-supplied paths or stale preview data from becoming trusted input.

### Skill import

Selected Skills use the existing package validator for directory containment, symlink rejection, file count and size limits, frontmatter parsing, and SHA-256 content digest calculation. Codex Skills without MAM-specific metadata default to support for the three retained Executors, matching the existing import behavior.

An unchanged digest does not create another version. A changed digest receives the next immutable version, becomes active, and replaces the current local source binding for new Attempts. Existing Runs and Attempts retain their frozen version and materialized content.

The existing directory-picker import remains available as a secondary action for Skill packages outside Codex.

### MCP import and credentials

Selected MCP candidates map to a shared `McpServerProfile` and a machine-local connection. Stable IDs derive from the Codex resource identity and use collision-safe normalization.

MCP commands, arguments, working directories, transports, and URLs may be stored in the local connection. Imported environment and request-header values are serialized as one credential bundle and stored through `EncryptedLocalSecretStore`. The shared Profile stores only its `credentialRef`; the local settings store contains the corresponding secret binding and no imported secret values.

The import picker identifies values that Codex expects from the ambient environment but cannot resolve. The user must supply those values before the affected MCP candidate can be submitted. Supplied values cross the trusted IPC command once, are not returned in the resulting snapshot, and are written immediately to encrypted storage.

At connection time, the MCP connection resolver reads the credential bundle and merges its environment or header values only into the selected server's transport configuration. The bundle is never added to a general process environment or diagnostic payload.

### Import consistency

The importer validates and constructs all selected outputs before changing active state. It writes new Profile versions without activation, updates encrypted credentials and machine-local bindings, and switches active version indexes last. A normal command failure rolls back files and local state written by that command.

An unexpected process termination can leave an unreferenced inactive version file, but it cannot make that version visible to new Runs until its active index is committed. Startup and later imports tolerate these inactive files. Cross-registry activation remains ordered and recoverable; the importer records enough local transaction state to finish or restore an interrupted activation before accepting another import.

## Health Model

### Result schema

Health results are local derived state keyed by resource kind, resource ID, active version, and a configuration fingerprint. Each result contains:

- `status`: `healthy`, `invalid`, or `pi-incompatible`;
- `checkedAt`;
- `stage`: a stable machine-readable stage identifier;
- a stable error code when unsuccessful;
- a concise, redacted user-facing message.

The absence of a matching result is represented in the UI as `unchecked`. `checking` is transient renderer state and is not persisted.

The configuration fingerprint includes the active Profile content hash and the relevant local binding or connection shape. It includes only hashes of secret values, never the values themselves. A Profile, local binding, connection, or credential change therefore makes a previous result inapplicable immediately.

Results are stored under the MAM user-data directory in `resource-health.json`. They are not committed to Git and do not enter an Effective Config snapshot.

### Skill checks

For every active Skill, the checker:

1. Resolves its machine-local source binding.
2. Runs the existing package validator and recomputes the content digest.
3. Compares the digest with the active Skill definition.
4. Calls Pi's public `loadSkills` API against that isolated Skill path.
5. Treats loader diagnostics or failure to identify the selected Skill as Pi incompatibility.

Missing sources, unreadable packages, invalid frontmatter, unsafe filesystem entries, and digest changes are `invalid`. A package that passes MAM validation but fails Pi loading is `pi-incompatible`.

### MCP checks

For every active MCP Profile, the checker resolves the same machine-local connection and encrypted credential bundle used by Attempts. It connects through the MCP SDK transport with the normal minimal inherited environment and a 30-second timeout.

After initialization it calls `listTools`, `listResources`, and `listPrompts` where the server advertises those capabilities, then closes the client. It does not call tools, read resources, or request prompts. A missing or malformed connection is `invalid`; a server that cannot initialize or enumerate an advertised capability through the Pi bridge path is `pi-incompatible`.

Failure output is normalized and redacted. Command arguments, environment values, headers, authorization data, and raw server stderr do not appear in the result.

### Knowledge Base checks

For every active Knowledge Base, the checker resolves the same local binding and `FileKnowledgeConnector` used by the Pi application bridge. It verifies the source root and performs a bounded search with a neutral probe query. A successful empty result is healthy because it proves the search path can execute. When the search yields a small text match, the checker reads the first result through the connector as an additional probe.

Missing paths, invalid containment, permissions, or unreadable sources are `invalid`. Resource kinds that the current Pi bridge cannot serve, including `vector-store` and `mcp-resource`, are `pi-incompatible` with a specific reason.

### Execution behavior

The one-click operation checks all active resources with bounded concurrency. A resource failure is captured as that resource's result and does not reject the whole operation. MCP timeouts are isolated and all opened clients are closed best-effort. The renderer receives incremental progress counts only if supported by the existing snapshot notification flow; otherwise it receives one final result set while keeping the button disabled and showing a stable checking label.

Health results are advisory. Attempt preflight and runtime resolution remain authoritative and continue to block resources that are unavailable at execution time.

## User Interface

The existing Resources page keeps its three Skill, MCP, and Knowledge Base sections.

The page header adds:

- `Import from Codex`, which opens the selectable import dialog;
- `Check all`, with a refresh icon and a fixed footprint while progress text changes;
- the existing folder-based Skill import as a visually secondary action.

The import dialog uses Skill and MCP tabs. Each tab provides search, a select-all control scoped to the current filter, and accessible checkboxes for individual candidates. Rows show name, stable ID, source category, source location in truncated form, and `New`, `Updated`, `Current`, or `Unavailable` status. Current and unavailable rows cannot be submitted. No row is selected by default.

Missing MCP credential inputs appear only for selected candidates that require them. Known values loaded from Codex are represented as configured and remain hidden. The primary action reports the selected count and stays disabled until every selected candidate is valid.

Each active resource card shows one persistent Badge:

- `Unchecked` for no current matching result;
- `Healthy` for a successful resource and Pi-path check;
- `Invalid` for a resource-level failure;
- `Pi incompatible` for a failure specific to Pi loading or the MAM bridge Pi uses.

Invalid and incompatible cards show a concise reason and check time below their metadata. Results are visible inline rather than in a transient toast. During a check, `Check all` is immediately disabled and uses delayed visible progress feedback consistent with the style guide. The layout reserves button width so the header does not shift.

The page continues to use existing tokens, Badge, Button, Dialog, Input, and Tooltip primitives. Tabs and Checkbox are added as local shadcn primitives only if the repository does not already contain them. Cards use the style guide's maximum 8px radius and are not nested inside other cards.

## Errors and Recovery

- Missing or unreadable Codex home produces an empty picker with an inline acquisition or configuration message, not a false successful scan.
- A malformed `config.toml` or plugin manifest identifies its source without exposing its content.
- A candidate changed between preview and import is rejected as stale and the user is asked to refresh the list.
- Logical ID collisions are visible before import and cannot silently overwrite another source.
- Import validation errors preserve the user's selection and credential fields except secret values already submitted successfully.
- Health check failures always identify the resource and stage. They do not change resource activation or Role bindings.
- Re-running `Check all` replaces results for resources checked in that run and removes results for resources that are no longer active.
- Secrets are redacted by structured error mapping rather than by displaying raw exception strings from transports.

## State and Compatibility

The feature adds local import-transaction and health-cache files beneath the existing MAM user-data root. It adds optional MCP credential-bundle handling while preserving parsing and execution of existing local MCP connections. No Scheduler event, Git state, Workflow, Role, or Attempt schema changes are required.

Historical Profile versions remain immutable. New Runs use the latest active version; frozen Runs and Attempts retain their recorded versions. The UI does not expose historical resource versions as selectable alternatives.

The implementation must increment the package patch version from 0.1.1 to 0.1.2, create `docs/versions/0.1.2.md`, carry forward the supported baseline, update `docs/versions/README.md`, and record behavior, state impact, verification, and limits.

macOS remains the release gate. Discovery and filesystem logic use Node path and home-directory APIs and are covered for Windows development behavior without introducing Windows-only paths.

## Testing

- Unit-test Codex home resolution and user, system, plugin, and `config.toml` discovery.
- Test canonical-path deduplication, logical ID collisions, malformed sources, unsupported transports, and stale candidate rejection.
- Test unchanged imports, updated imports, active-version switching, hidden history, multi-item validation, rollback, and interrupted-transaction recovery.
- Assert that discovery IPC results, Profiles, local settings, health cache, diagnostics, and error messages contain no imported credential values.
- Test encrypted credential-bundle resolution for stdio environment and HTTP headers while retaining legacy local connections.
- Test Skill invalid, digest-changed, healthy Pi-load, and Pi-loader-diagnostic outcomes.
- Test MCP initialization, advertised capability enumeration, timeout, cleanup, redaction, and failure isolation.
- Test Knowledge Base root validation, empty successful search, bounded read, unsupported kind, and missing binding outcomes.
- Test health fingerprint invalidation after Profile, local binding, connection, and credential changes.
- Test import dialog filtering, selection, disabled states, missing credential validation, and resource-card health rendering.
- Extend the Electron seeded smoke probe to cover trusted IPC registration and one representative discovery/check flow with deterministic fixtures.
- Run formatting checks, lint, typecheck, the full test suite, and the production build.

## Acceptance Criteria

- `Import from Codex` lists all valid user, built-in, plugin, and configured MCP candidates without exposing secrets to the renderer.
- A user can select multiple Skills and MCP servers and import them with one confirmation.
- Unchanged resources are not versioned again; changed resources become the only active version shown and used by new Runs.
- Existing frozen Runs and Attempts remain reproducible after a resource update.
- Imported MCP credentials are encrypted and absent from Profiles, local settings, logs, cached health results, and IPC discovery payloads.
- `Check all` checks every active Skill, MCP, and Knowledge Base without model calls or mutating MCP operations.
- One failed or timed-out resource does not prevent other health results from completing.
- Problem resources remain visibly marked as `Invalid` or `Pi incompatible` with a redacted reason until configuration changes or another check replaces the result.
- Health results are invalidated when their active resource or local configuration fingerprint changes.
- Existing manually configured resources and local settings continue to parse and execute.
- Required automated verification passes, with any platform-specific validation limit recorded in the 0.1.2 version file.
