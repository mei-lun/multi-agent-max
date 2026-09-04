# Codex Resource Import and Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selectable import of all local Codex Skills and MCP servers and a one-click health check that marks invalid or Pi-incompatible Skills, MCP servers, and Knowledge Bases.

**Architecture:** A main-process discovery adapter produces secret-free Codex candidates, a transactional importer maps selected candidates into versioned Profiles and encrypted local bindings, and a health service probes resources through Pi's public Skill loader plus the same MCP and Knowledge connectors used at runtime. Shared Zod contracts cross trusted IPC, health results remain machine-local derived state, and the existing Resources page owns import selection and persistent status display.

**Tech Stack:** TypeScript 6, Electron 43, React 19, Zod 4, YAML/TOML parsing, `@earendil-works/pi-coding-agent`, `@modelcontextprotocol/sdk`, Vitest, shadcn/Radix UI, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-04-codex-resource-import-health-design.md`

## Global Constraints

- Follow `docs/final-reuse-integration-plan.md` and `docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`; do not restore global resource inheritance or terminal-tail completion semantics.
- New Attempts use only active resources explicitly bound to their Role; existing Runs and Attempts keep frozen Profile versions.
- Codex discovery imports Skills and MCP only; MAM Knowledge Bases participate in health checks but are not discovered from Codex.
- Never expose imported MCP environment/header values through shared Profiles, renderer candidate results, logs, diagnostics, health results, or unencrypted local settings.
- Health checks cannot call an MCP tool or an LLM and cannot automatically modify resource activation or Role bindings.
- Use Node path APIs and `homedir()`/`CODEX_HOME`; macOS is the release gate and Windows remains a development environment.
- Reuse `docs/STYLEGUIDE.md` tokens and existing shadcn primitives; cards have at most an 8px radius.
- Runtime behavior changes increment `package.json` from `0.1.1` to `0.1.2` and create/update all matching version records.
- Keep files below the configured max-lines limit; split by responsibility and do not disable lint rules.

---

### Task 1: Shared Resource Import and Health Contracts

**Files:**
- Create: `src/shared/mam/resource-import.ts`
- Create: `src/shared/mam/resource-health.ts`
- Modify: `src/shared/mam/ui-projection.ts`
- Test: `src/shared/mam/domain/domain-contracts.test.ts`

**Interfaces:**
- Produces: `CodexResourceCandidateSchema`, `MamImportCodexResourcesInputSchema`, `ResourceHealthResultSchema`, and health results on the UI snapshot.
- Consumed by: discovery, importer, health store, query snapshot, IPC, and renderer tasks.

- [ ] **Step 1: Write failing contract tests**

Add examples that accept secret-free Skill/MCP candidates and all four UI health states, reject candidate payloads containing `environment`, `headers`, or secret values, and parse an existing `MamLocalSettings` document without new fields.

```ts
expect(
  CodexResourceCandidateSchema.parse({
    key: 'skill:user:release',
    kind: 'skill',
    resourceId: 'release',
    displayName: 'Release',
    source: { kind: 'user', label: 'User Skills', path: '/Users/me/.codex/skills/release' },
    fingerprint: 'a'.repeat(64),
    importState: 'new',
    requiredSecretNames: []
  })
).not.toHaveProperty('environment')
expect(ResourceHealthResultSchema.parse(healthyResult).status).toBe('healthy')
expect(MamLocalSettingsSchema.parse(legacySettings).mcpConnections).toEqual([])
```

- [ ] **Step 2: Run the focused contract test and confirm failure**

Run: `corepack pnpm vitest run src/shared/mam/domain/domain-contracts.test.ts`

Expected: FAIL because the resource import and health schemas do not exist.

- [ ] **Step 3: Add exact shared schemas and types**

Define candidate source kinds `user | system | plugin | config`, import states `new | updated | current | unavailable`, health statuses `healthy | invalid | pi-incompatible`, and a health snapshot entry keyed by `kind`, `resourceId`, `version`, and `fingerprint`. Define import input as selected opaque keys plus `missingSecrets: Record<string, string>`.

```ts
export const MamImportCodexResourcesInputSchema = z
  .object({ candidateKeys: z.array(z.string().min(1)).min(1), missingSecrets: z.record(z.string(), z.string()) })
  .strict()

export const ResourceHealthResultSchema = z
  .object({
    kind: z.enum(['skill', 'mcp', 'knowledge']),
    resourceId: MamEntityIdSchema,
    version: z.number().int().positive(),
    fingerprint: Sha256Schema,
    status: z.enum(['healthy', 'invalid', 'pi-incompatible']),
    checkedAt: IsoTimestampSchema,
    stage: z.string().min(1).max(120),
    code: z.string().min(1).max(120).optional(),
    message: z.string().min(1).max(500).optional()
  })
  .strict()
```

Reuse the existing `McpServerProfile.credentialRef` and local `secretBindings` contracts for credential bundles, leaving legacy local MCP connection parsing unchanged. Add `resourceHealth` with an empty default to `MamUiSnapshotSchema`.

- [ ] **Step 4: Run shared tests and typecheck**

Run: `corepack pnpm vitest run src/shared/mam/domain/domain-contracts.test.ts && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/shared/mam/resource-import.ts src/shared/mam/resource-health.ts src/shared/mam/ui-projection.ts src/shared/mam/domain/domain-contracts.test.ts
git commit -m "feat: define resource import health contracts"
```

### Task 2: Local Codex Resource Discovery

**Files:**
- Create: `src/main/mam/resources/codex-home-resolver.ts`
- Create: `src/main/mam/resources/codex-resource-discovery.ts`
- Create: `src/main/mam/resources/codex-resource-discovery.test.ts`

**Interfaces:**
- Consumes: `CodexResourceCandidate`, `ProfileCatalog`, `MamLocalSettingsStore`, existing `validateSkillPackage()`.
- Produces: `class CodexResourceDiscovery { list(): Promise<readonly CodexResourceCandidate[]>; resolve(key: string): Promise<ResolvedCodexCandidate | undefined> }` where resolved MCP candidates retain secrets only inside the main process.

- [ ] **Step 1: Write fixture-based discovery tests**

Create temporary Codex homes containing user and `.system` Skills, enabled plugin manifests with Skill roots and `desktop-mcp.json`, and a `config.toml` with stdio and HTTP servers. Assert source labels, deterministic keys, canonical deduplication, `new/updated/current`, unavailable rows, and absence of raw secret values.

```ts
const candidates = await discovery.list()
expect(candidates.map(({ kind, source }) => [kind, source.kind])).toEqual(
  expect.arrayContaining([
    ['skill', 'user'],
    ['skill', 'system'],
    ['skill', 'plugin'],
    ['mcp', 'config'],
    ['mcp', 'plugin']
  ])
)
expect(JSON.stringify(candidates)).not.toContain('sk-test-secret')
```

- [ ] **Step 2: Run the discovery test and confirm failure**

Run: `corepack pnpm vitest run src/main/mam/resources/codex-resource-discovery.test.ts`

Expected: FAIL because `CodexResourceDiscovery` is missing.

- [ ] **Step 3: Implement Codex home and enabled-plugin resolution**

Resolve an injected home for tests, then `process.env.CODEX_HOME`, then `join(homedir(), '.codex')`. Parse TOML with a dedicated parser dependency or the repository's available structured parser; do not parse TOML with regular expressions. Resolve plugin cache roots from enabled `[plugins."name@marketplace"]` entries and validate every manifest-relative path remains within its plugin root.

- [ ] **Step 4: Implement normalized Skill and MCP discovery**

Reuse `validateSkillPackage` for fingerprint and metadata. Support Codex `command`, `args`, `cwd`, `url`, `env`, `env_vars`, enabled flags, and plugin `mcpServers` descriptors. Normalize but retain a private `ResolvedCodexCandidate` containing source configuration and credential values for import.

- [ ] **Step 5: Run discovery tests, lint, and typecheck**

Run: `corepack pnpm vitest run src/main/mam/resources/codex-resource-discovery.test.ts && corepack pnpm lint && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit discovery**

```bash
git add package.json pnpm-lock.yaml src/main/mam/resources/codex-home-resolver.ts src/main/mam/resources/codex-resource-discovery.ts src/main/mam/resources/codex-resource-discovery.test.ts
git commit -m "feat: discover local Codex resources"
```

### Task 3: Transactional Multi-Resource Import

**Files:**
- Create: `src/main/mam/resources/codex-resource-importer.ts`
- Create: `src/main/mam/resources/codex-resource-import-transaction.ts`
- Create: `src/main/mam/resources/codex-resource-importer.test.ts`
- Modify: `src/main/mam/application/encrypted-local-secret-store.ts`
- Modify: `src/main/mam/profiles/mam-local-settings-store.ts`
- Modify: `src/main/mam/profiles/versioned-profile-registry.ts`
- Modify: `src/main/mam/application/mam-profile-write-ports.ts`

**Interfaces:**
- Consumes: `CodexResourceDiscovery.resolve()`, `MamImportCodexResourcesInput`, `ProfileCatalog`, local settings, and encrypted secrets.
- Produces: `CodexResourceImporter.import(input): Promise<MamUiSnapshot>` via the command service, inactive Profile staging methods, and recovery of an interrupted local transaction.

- [ ] **Step 1: Write failing importer tests**

Cover multi-select success, unchanged no-op, updated activation, hidden immutable history, required missing secrets, secret bundle encryption, stale keys, ID collisions, validation-before-write, rollback on write failure, and transaction recovery.

```ts
await importer.import({ candidateKeys: ['skill:user:release', 'mcp:config:docs'], missingSecrets: {} })
expect(profiles.skills.getActive('release')?.version).toBe(2)
expect(profiles.skills.listVersions('release')).toHaveLength(2)
expect(settings.get().mcpConnections[0]).not.toHaveProperty('environment.API_TOKEN')
expect(secretStore.resolveSecret('secret.mcp.docs')).toContain('API_TOKEN')
```

- [ ] **Step 2: Run importer tests and confirm failure**

Run: `corepack pnpm vitest run src/main/mam/resources/codex-resource-importer.test.ts`

Expected: FAIL because importer and staging APIs are absent.

- [ ] **Step 3: Add staging and snapshot/restore ports**

Add narrowly named registry methods for saving inactive versions and removing only inactive versions created by the failed transaction. Add local settings and encrypted-secret snapshot/restore methods scoped to the importer. Persist a transaction journal under the MAM user-data root before activation and remove it after commit or restore.

- [ ] **Step 4: Implement deterministic imports**

Rediscover and resolve every opaque key, reject stale fingerprints and unavailable candidates, validate all resources first, create only changed versions, store one encrypted JSON credential bundle per imported MCP, update local bindings, then activate staged versions. Preserve old versions internally but expose only active versions through existing registries.

- [ ] **Step 5: Run importer and existing profile tests**

Run: `corepack pnpm vitest run src/main/mam/resources/codex-resource-importer.test.ts src/main/mam/application/mam-profile-commands.test.ts src/main/mam/profiles/versioned-profile-registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit importer and transaction support**

```bash
git add src/main/mam/resources/codex-resource-importer.ts src/main/mam/resources/codex-resource-import-transaction.ts src/main/mam/resources/codex-resource-importer.test.ts src/main/mam/application/encrypted-local-secret-store.ts src/main/mam/profiles/mam-local-settings-store.ts src/main/mam/profiles/versioned-profile-registry.ts src/main/mam/application/mam-profile-write-ports.ts
git commit -m "feat: import selected Codex resources"
```

### Task 4: Runtime MCP Credential Bundles and Capability Probe

**Files:**
- Create: `src/main/mam/gateways/mcp-connection-resolver.ts`
- Create: `src/main/mam/gateways/mcp-connection-resolver.test.ts`
- Modify: `src/main/mam/gateways/mcp-sdk-connector.ts`
- Modify: `src/main/mam/gateways/mcp-sdk-connector.test.ts`
- Modify: `src/main/mam/application/attempt-capability-bridge.ts`

**Interfaces:**
- Consumes: local MCP connections, `credentialRef`, and a secret value resolver.
- Produces: `resolveMcpConnection(profile): McpLocalConnection | undefined` and `McpSdkConnector.probe(profile): Promise<McpCapabilitySummary>` using initialization plus advertised list operations.

- [ ] **Step 1: Write failing credential and probe tests**

Assert stdio environment and HTTP headers are reconstructed only for the requested profile, legacy plaintext connections remain supported, malformed encrypted bundles fail with stable codes, capability list calls are made only when advertised, and clients always close.

```ts
expect(resolveMcpConnection(profile)).toMatchObject({
  transport: 'stdio',
  environment: { API_TOKEN: 'secret-value' }
})
await expect(connector.probe(profile)).resolves.toMatchObject({ connected: true })
expect(client.listTools).toHaveBeenCalledOnce()
expect(client.close).toHaveBeenCalledOnce()
```

- [ ] **Step 2: Run focused MCP tests and confirm failure**

Run: `corepack pnpm vitest run src/main/mam/gateways/mcp-connection-resolver.test.ts src/main/mam/gateways/mcp-sdk-connector.test.ts`

Expected: FAIL because credential-bundle resolution and probe methods are missing.

- [ ] **Step 3: Implement credential resolution and SDK capability listing**

Parse the encrypted JSON bundle with Zod, merge it into a cloned connection, and retain the minimal environment boundary. Extend the SDK client port with server capability inspection plus `listTools`, `listResources`, and `listPrompts`. The probe must not invoke tools, read resources, or fetch prompts.

- [ ] **Step 4: Wire Attempts to the shared resolver**

Replace the inline `settings.mcpConnections.find(...)` callback in `attempt-capability-bridge.ts` with the resolver used by health checks, passing only the local secret provider required for the selected Profile.

- [ ] **Step 5: Run MCP, bridge, and type tests**

Run: `corepack pnpm vitest run src/main/mam/gateways/mcp-connection-resolver.test.ts src/main/mam/gateways/mcp-sdk-connector.test.ts src/main/mam/application/executor-capability-bridge.test.ts && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit runtime MCP support**

```bash
git add src/main/mam/gateways/mcp-connection-resolver.ts src/main/mam/gateways/mcp-connection-resolver.test.ts src/main/mam/gateways/mcp-sdk-connector.ts src/main/mam/gateways/mcp-sdk-connector.test.ts src/main/mam/application/attempt-capability-bridge.ts
git commit -m "feat: resolve encrypted MCP connections"
```

### Task 5: Resource Health Store and Pi-Path Checker

**Files:**
- Create: `src/main/mam/resources/resource-health-store.ts`
- Create: `src/main/mam/resources/resource-health-checker.ts`
- Create: `src/main/mam/resources/resource-health-checker.test.ts`
- Modify: `src/main/mam/application/mam-ui-query-service.ts`

**Interfaces:**
- Consumes: active registries, local settings, MCP resolver/connector, `FileKnowledgeConnector`, Pi `loadSkills`, and a clock.
- Produces: `ResourceHealthChecker.checkAll(): Promise<readonly ResourceHealthResult[]>`, fingerprint matching, atomic cache persistence, and current results in `MamUiSnapshot.resourceHealth`.

- [ ] **Step 1: Write failing health tests**

Cover healthy and digest-changed Skills, Pi loader diagnostics, MCP initialization/list failures and timeouts, healthy empty Knowledge searches, first-result reads, unsupported Knowledge kinds, bounded concurrency, per-resource isolation, redaction, and stale fingerprint filtering.

```ts
const results = await checker.checkAll()
expect(results).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ resourceId: 'skill.release', status: 'healthy' }),
    expect.objectContaining({ resourceId: 'mcp.docs', status: 'pi-incompatible' }),
    expect.objectContaining({ resourceId: 'knowledge.local', status: 'invalid' })
  ])
)
expect(JSON.stringify(results)).not.toContain('secret-value')
```

- [ ] **Step 2: Run health tests and confirm failure**

Run: `corepack pnpm vitest run src/main/mam/resources/resource-health-checker.test.ts`

Expected: FAIL because the health store and checker do not exist.

- [ ] **Step 3: Implement atomic local health storage and fingerprints**

Follow the repository's temporary-file plus rename pattern. Hash active Profile content, local connection/binding shape, and encrypted credential content without persisting secret material. Return only results whose version and fingerprint match current state.

- [ ] **Step 4: Implement bounded, isolated probes**

Use Pi's public `loadSkills` export; classify MAM package failures as `invalid` and Pi diagnostics as `pi-incompatible`. Probe MCP with a 30-second timeout and guaranteed disposal. Probe file Knowledge through `FileKnowledgeConnector.search()` and read the first small result when present. Limit concurrent probes to three and convert every failure into a redacted result.

- [ ] **Step 5: Add current health results to query snapshots**

Inject the health store into `MamUiQueryService` and merge only matching current results into `getSnapshot()`. Keep `resourceHealth: []` in fixtures that do not inject a store.

- [ ] **Step 6: Run focused and snapshot tests**

Run: `corepack pnpm vitest run src/main/mam/resources/resource-health-checker.test.ts src/renderer/src/features/mam/mam-integration-view-model.test.ts && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit health services**

```bash
git add src/main/mam/resources/resource-health-store.ts src/main/mam/resources/resource-health-checker.ts src/main/mam/resources/resource-health-checker.test.ts src/main/mam/application/mam-ui-query-service.ts
git commit -m "feat: check resource health through Pi paths"
```

### Task 6: Trusted IPC and Renderer Actions

**Files:**
- Modify: `src/shared/mam/application-api.ts`
- Modify: `src/main/mam/application/mam-ui-command-service.ts`
- Modify: `src/main/ipc/mam-ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/features/mam/use-mam-snapshot.ts`
- Modify: `src/main/desktop-smoke-probe.ts`
- Test: `src/main/desktop-seeded-project.smoke.ts`

**Interfaces:**
- Consumes: discovery `list`, importer `import`, checker `checkAll`, and their shared schemas.
- Produces: renderer API methods `listCodexResources()`, `importCodexResources(input)`, and `checkResourceHealth()`.

- [ ] **Step 1: Extend the seeded smoke test with failing IPC expectations**

Assert the three channels are registered, trusted-renderer checks run before service calls, discovery returns secret-free fixture candidates, import refreshes the snapshot, and health results appear after a deterministic check.

- [ ] **Step 2: Run seeded smoke and confirm failure**

Run: `corepack pnpm vitest run --config vitest.smoke.config.ts src/main/desktop-seeded-project.smoke.ts`

Expected: FAIL because the channels and methods are absent.

- [ ] **Step 3: Add API constants and typed methods**

```ts
export const MAM_LIST_CODEX_RESOURCES_CHANNEL = 'mam:list-codex-resources'
export const MAM_IMPORT_CODEX_RESOURCES_CHANNEL = 'mam:import-codex-resources'
export const MAM_CHECK_RESOURCE_HEALTH_CHANNEL = 'mam:check-resource-health'
```

Add methods with schema-validated inputs/results to `MamRendererApi`, preload, and the main command service. Ensure runtime logger payloads contain channel and duration only.

- [ ] **Step 4: Compose services in the Electron main process**

Instantiate discovery, importer, health store, MCP resolver, and checker under `mamRoot`. Recover an interrupted import before registering IPC. Notify the renderer after import and after health results are persisted.

- [ ] **Step 5: Add renderer callbacks without broad pending-state coupling**

Expose local pending states for discovery/import/check so a long health run does not disable unrelated Workflow actions. Refresh the authoritative snapshot after import and health completion.

- [ ] **Step 6: Run smoke, API, and type tests**

Run: `corepack pnpm vitest run --config vitest.smoke.config.ts src/main/desktop-seeded-project.smoke.ts && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit IPC integration**

```bash
git add src/shared/mam/application-api.ts src/main/mam/application/mam-ui-command-service.ts src/main/ipc/mam-ipc.ts src/main/index.ts src/preload/index.ts src/renderer/src/features/mam/use-mam-snapshot.ts src/main/desktop-smoke-probe.ts src/main/desktop-seeded-project.smoke.ts
git commit -m "feat: expose Codex resource operations"
```

### Task 7: Selectable Import Dialog and Health Status UI

**Files:**
- Create: `src/renderer/src/components/ui/checkbox.tsx`
- Create: `src/renderer/src/components/ui/tabs.tsx`
- Create: `src/renderer/src/features/mam/MamCodexResourceImportDialog.tsx`
- Create: `src/renderer/src/features/mam/MamCodexResourceImportDialog.test.tsx`
- Create: `src/renderer/src/features/mam/mam-resource-health-view.ts`
- Create: `src/renderer/src/features/mam/mam-resource-health-view.test.ts`
- Modify: `src/renderer/src/features/mam/MamResourcesPage.tsx`
- Modify: `src/renderer/src/features/mam/MamResourcesSettingsPages.test.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/assets/main.css`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: candidate list/import/check callbacks and `MamUiSnapshot.resourceHealth`.
- Produces: accessible searchable multi-select dialog, fixed-width `Check all` action, progress/error state, and persistent health Badges/reasons on resource cards.

- [ ] **Step 1: Write failing view-model and rendered UI tests**

Test search filtering, select-all limited to filtered rows, no default selection, current/unavailable disabled rows, missing-secret validation, status labels, redacted reasons, and card radius/style tokens.

```tsx
expect(resourceHealthView(resource, results)).toMatchObject({ label: 'Pi incompatible' })
expect(rendered).toContain('Import from Codex')
expect(rendered).toContain('Check all')
expect(rendered).toContain('Healthy')
```

- [ ] **Step 2: Run UI tests and confirm failure**

Run: `corepack pnpm vitest run src/renderer/src/features/mam/MamCodexResourceImportDialog.test.tsx src/renderer/src/features/mam/mam-resource-health-view.test.ts src/renderer/src/features/mam/MamResourcesSettingsPages.test.tsx`

Expected: FAIL because dialog and health view modules are absent.

- [ ] **Step 3: Add shadcn Checkbox and Tabs primitives**

Install the matching Radix packages at versions compatible with the existing shadcn stack. Follow existing Button/Input/Dialog token usage and expose only the variants required by the import dialog.

- [ ] **Step 4: Implement the import dialog**

Load candidates when opened, keep raw secrets out of component props, filter by name/ID/source, support tab-scoped select-all, collect only required missing values, preserve non-secret selection after errors, and submit selected opaque keys.

- [ ] **Step 5: Render one-click health and persistent problem marks**

Add `Import from Codex`, secondary folder import, and fixed-width `Check all`. Map current results to cards by kind/ID/version and render `Unchecked`, `Healthy`, `Invalid`, or `Pi incompatible`. Show reason and timestamp only for problem states. Use `rounded-md`/8px cards and avoid nested cards.

- [ ] **Step 6: Wire the Resources page in App**

Pass discovery/import/check methods and their local pending states through the existing page selection boundary without changing unrelated page props.

- [ ] **Step 7: Run UI tests, format, lint, and typecheck**

Run: `corepack pnpm vitest run src/renderer/src/features/mam/MamCodexResourceImportDialog.test.tsx src/renderer/src/features/mam/mam-resource-health-view.test.ts src/renderer/src/features/mam/MamResourcesSettingsPages.test.tsx && corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the Resources UI**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/components/ui/checkbox.tsx src/renderer/src/components/ui/tabs.tsx src/renderer/src/features/mam/MamCodexResourceImportDialog.tsx src/renderer/src/features/mam/MamCodexResourceImportDialog.test.tsx src/renderer/src/features/mam/mam-resource-health-view.ts src/renderer/src/features/mam/mam-resource-health-view.test.ts src/renderer/src/features/mam/MamResourcesPage.tsx src/renderer/src/features/mam/MamResourcesSettingsPages.test.tsx src/renderer/src/App.tsx src/renderer/src/assets/main.css
git commit -m "feat: add resource import and health UI"
```

### Task 8: Version Records, Documentation, and Full Verification

**Files:**
- Modify: `package.json`
- Create: `docs/versions/0.1.2.md`
- Modify: `docs/versions/README.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/superpowers/plans/2026-09-04-codex-resource-import-health.md`

**Interfaces:**
- Consumes: all completed behavior and verification evidence.
- Produces: accurate 0.1.2 feature baseline, user-facing resource workflow documentation, checked plan boxes, and a clean verified branch.

- [ ] **Step 1: Increment and document version 0.1.2**

Set `package.json#version` to `0.1.2`, update the lockfile importer version, create the 0.1.2 record by carrying forward the supported 0.1.1 baseline, and record behavior, implementation scope, local state/schema impact, verification, and known platform limits. Update the version index current row.

- [ ] **Step 2: Document resource import and health workflows**

Add concise Chinese and English README sections describing `Import from Codex`, encrypted MCP credentials, `Check all`, the four states, the lack of Codex Knowledge Base import, and the distinction between deterministic Pi-path compatibility and model behavior.

- [ ] **Step 3: Run focused resource suites**

Run: `corepack pnpm vitest run src/main/mam/resources src/main/mam/gateways/mcp-connection-resolver.test.ts src/main/mam/gateways/mcp-sdk-connector.test.ts src/renderer/src/features/mam/MamCodexResourceImportDialog.test.tsx src/renderer/src/features/mam/mam-resource-health-view.test.ts src/renderer/src/features/mam/MamResourcesSettingsPages.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run complete verification**

Run: `corepack pnpm verify`

Expected: format check, lint, typecheck, complete tests, and production build all PASS.

- [ ] **Step 5: Run seeded Electron smoke**

Run: `corepack pnpm smoke:desktop:seeded`

Expected: PASS with discovery/import/health IPC coverage. If the host cannot run a platform-specific external MCP executable, use only the deterministic fixture server and record that limit in `0.1.2.md`.

- [ ] **Step 6: Review final diff and version consistency**

Run: `git diff --check && git status --short && node -e "const p=require('./package.json'); if(p.version!=='0.1.2') process.exit(1)"`

Expected: no whitespace errors; only intended files remain; package, lockfile, version index, and version archive agree on 0.1.2.

- [ ] **Step 7: Commit release records and final fixes**

```bash
git add package.json pnpm-lock.yaml README.md README.en.md docs/versions/README.md docs/versions/0.1.2.md docs/superpowers/plans/2026-09-04-codex-resource-import-health.md
git commit -m "docs: record Codex resource health release"
```

- [ ] **Step 8: Request final code review**

Use the `requesting-code-review` skill against the complete branch diff, address any correctness or security findings, rerun affected tests, and keep the worktree clean.
