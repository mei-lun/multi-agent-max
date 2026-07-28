import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutorCapabilities } from '../../../shared/mam/domain/execution-profile'
import type { RoleProfile } from '../../../shared/mam/domain/role'
import { validateSkillPackage } from '../skills/skill-package-validator'
import { AttemptConfigResolver, type ResolvedAttemptConfig } from './attempt-config-resolver'
import { AttemptResourceMaterializer } from './attempt-resource-materializer'
import { ProfileCatalog } from './profile-catalog'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('Attempt config resolution and resource materialization', () => {
  it('isolates role allowlists and pins resource versions for each Attempt', async () => {
    const fixture = await createCatalogFixture()
    const resolver = new AttemptConfigResolver(fixture.catalog)
    const roleA = await resolver.resolve(resolutionInput(fixture, 'role.a', 'attempt.a1'))
    const roleB = await resolver.resolve(resolutionInput(fixture, 'role.b', 'attempt.b1'))
    const materializer = new AttemptResourceMaterializer(join(fixture.root, 'materialized'))
    const materializedA = await materializer.materialize(roleA)
    const materializedB = await materializer.materialize(roleB)

    expect(materializedA.rootDirectory).not.toBe(materializedB.rootDirectory)
    expect(await readdir(join(materializedA.rootDirectory, 'skills'))).toEqual(['skill.alpha'])
    expect(await readdir(join(materializedB.rootDirectory, 'skills'))).toEqual(['skill.beta'])
    expect(roleA.snapshot.executorProfile.id).toBe(roleB.snapshot.executorProfile.id)
    expect(roleA.snapshot.modelProfile.id).toBe(roleB.snapshot.modelProfile.id)
    expect(roleA.snapshot.mcpBindings[0]).toMatchObject({
      serverProfileId: 'mcp.git',
      version: 1,
      allowedTools: ['git.status']
    })
    expect(roleB.snapshot.mcpBindings).toEqual([])
    expect(roleA.snapshot.execution.inference).toMatchObject({
      temperature: 0.2,
      reasoningEffort: 'high'
    })
    expect(roleA.snapshot.localBindingIds).toEqual([
      'binding.secret.mcp',
      'binding.secret.provider',
      'binding.skill.alpha'
    ])
    const executorConfig = JSON.parse(
      await readFile(join(materializedA.rootDirectory, 'executor-config.json'), 'utf8')
    )
    expect(executorConfig).toMatchObject({ inheritGlobalSkills: false, inheritGlobalMcp: false })
    expect(JSON.stringify(executorConfig)).not.toContain('secret-value-canary')

    const oldSnapshot = await readFile(materializedA.configPath, 'utf8')
    await writeFile(join(fixture.skillAlphaPath, 'SKILL.md'), '# Alpha v2\n\nSecond version.\n')
    const alphaV2 = await validateSkillPackage(fixture.skillAlphaPath)
    fixture.catalog.skills.save({
      ...skillDefinition('skill.alpha', 2, alphaV2.contentDigest),
      importedAt: '2026-07-28T01:01:00Z'
    })
    fixture.catalog.executors.save({
      ...fixture.catalog.executors.getActive('executor.shared')!,
      version: 2,
      executableRef: 'executable.codex.v2'
    })
    fixture.catalog.providers.save({
      ...fixture.catalog.providers.getActive('provider.compatible')!,
      version: 2
    })
    fixture.catalog.models.save({
      ...fixture.catalog.models.getActive('model.shared')!,
      version: 2,
      remoteModelId: 'model-remote-id-v2'
    })
    fixture.catalog.mcpServers.save({
      ...fixture.catalog.mcpServers.getActive('mcp.git')!,
      version: 2,
      connectionRef: 'connection.git-mcp.v2'
    })
    fixture.catalog.knowledgeBases.save({
      ...fixture.catalog.knowledgeBases.getActive('knowledge.project')!,
      version: 2,
      indexRevision: 'index.2'
    })
    const roleANext = await resolver.resolve(resolutionInput(fixture, 'role.a', 'attempt.a2'))
    const materializedANext = await materializer.materialize(roleANext)

    expect(roleANext.snapshot.skills[0]?.version).toBe(2)
    expect(roleANext.snapshot.executorProfile.version).toBe(2)
    expect(roleANext.snapshot.providerProfile.version).toBe(2)
    expect(roleANext.snapshot.modelProfile.version).toBe(2)
    expect(roleANext.snapshot.mcpBindings[0]?.version).toBe(2)
    expect(roleANext.snapshot.knowledgeBaseBindings[0]).toMatchObject({
      version: 2,
      indexRevision: 'index.2'
    })
    expect(roleA.snapshot.executorProfile.version).toBe(1)
    expect(roleA.snapshot.modelProfile.version).toBe(1)
    expect(roleANext.snapshot.contentHash).not.toBe(roleA.snapshot.contentHash)
    expect(await readFile(materializedA.configPath, 'utf8')).toBe(oldSnapshot)
    expect(
      await readFile(join(materializedA.skillDirectories['skill.alpha']!, 'SKILL.md'), 'utf8')
    ).toContain('Alpha v1')
    expect(
      await readFile(join(materializedANext.skillDirectories['skill.alpha']!, 'SKILL.md'), 'utf8')
    ).toContain('Alpha v2')
  })

  it('rejects snapshot tampering and resources outside the frozen Role allowlist', async () => {
    const fixture = await createCatalogFixture()
    const resolved = await new AttemptConfigResolver(fixture.catalog).resolve(
      resolutionInput(fixture, 'role.a', 'attempt.a1')
    )
    const materializer = new AttemptResourceMaterializer(join(fixture.root, 'materialized'))
    await expect(
      materializer.materialize({
        ...resolved,
        snapshot: { ...resolved.snapshot, tools: ['unexpected.tool'] }
      })
    ).rejects.toMatchObject({ code: 'effective_config_hash_mismatch' })

    const betaDefinition = fixture.catalog.skills.getActive('skill.beta')!
    const injected: ResolvedAttemptConfig = {
      ...resolved,
      skills: [
        ...resolved.skills,
        {
          definition: betaDefinition,
          localBinding: fixture.localSkillBindings.find(
            (binding) => binding.skillId === 'skill.beta'
          )!
        }
      ]
    }
    await expect(materializer.materialize(injected)).rejects.toMatchObject({
      code: 'resource_binding_mismatch'
    })
  })

  it('orders capability checks before local preflight and rejects ambiguous bindings', async () => {
    const fixture = await createCatalogFixture()
    const resolver = new AttemptConfigResolver(fixture.catalog)
    await expect(
      resolver.resolve({
        ...resolutionInput(fixture, 'role.a', 'attempt.no-skills'),
        capabilities: { ...fullCapabilities(), supportsSkills: false },
        localSkillBindings: []
      })
    ).rejects.toMatchObject({ code: 'skills_unsupported' })

    await expect(
      resolver.resolve({
        ...resolutionInput(fixture, 'role.a', 'attempt.ambiguous'),
        localSecretBindings: [
          ...fixture.localSecretBindings,
          {
            id: 'binding.secret.provider.duplicate',
            secretRef: 'secret.provider',
            bindingIdentity: 'local.1'
          }
        ]
      })
    ).rejects.toMatchObject({ code: 'ambiguous_secret_binding' })
  })

  it('records optional local Knowledge as degraded and blocks when it is required', async () => {
    const fixture = await createCatalogFixture()
    fixture.catalog.knowledgeBases.save({
      id: 'knowledge.local',
      version: 1,
      displayName: 'Local Notes',
      kind: 'local-directory',
      sourceRef: 'local.notes'
    })
    fixture.catalog.roles.save(knowledgeRole('role.optional-knowledge', false))
    fixture.catalog.roles.save(knowledgeRole('role.required-knowledge', true))
    const resolver = new AttemptConfigResolver(fixture.catalog)
    const optional = await resolver.resolve({
      ...resolutionInput(fixture, 'role.optional-knowledge', 'attempt.optional'),
      localSkillBindings: []
    })
    expect(optional.snapshot.knowledgeBaseBindings[0]?.status).toBe('degraded')
    await expect(
      resolver.resolve({
        ...resolutionInput(fixture, 'role.required-knowledge', 'attempt.required'),
        localSkillBindings: []
      })
    ).rejects.toMatchObject({ code: 'required_knowledge_unavailable' })
  })

  it('supports eight arbitrary Roles with independently frozen Executor and Model bindings', async () => {
    const fixture = await createCatalogFixture()
    fixture.catalog.executors.save({
      id: 'executor.pi',
      version: 1,
      kind: 'pi-rpc',
      executableRef: 'executable.pi',
      adapterOptions: { configMode: 'isolated' }
    })
    for (const modelId of ['model.alpha', 'model.beta', 'model.gamma']) {
      fixture.catalog.models.save({
        ...fixture.catalog.models.getActive('model.shared')!,
        id: modelId,
        displayName: modelId,
        remoteModelId: `${modelId}-remote`
      })
    }
    const topology = [
      ['role.orchid', 'executor.shared', 'model.alpha'],
      ['role.river', 'executor.shared', 'model.beta'],
      ['role.sparrow', 'executor.shared', 'model.gamma'],
      ['role.cedar', 'executor.pi', 'model.alpha'],
      ['role.comet', 'executor.pi', 'model.shared'],
      ['role.quartz', 'executor.shared', 'model.shared'],
      ['role.lantern', 'executor.pi', 'model.beta'],
      ['role.tide', 'executor.shared', 'model.gamma']
    ] as const
    for (const [roleId, executorProfileId, modelProfileId] of topology) {
      const role = roleProfile(roleId, 'skill.alpha', false, {
        executorProfileId,
        modelProfileId
      })
      fixture.catalog.roles.save(
        executorProfileId === 'executor.pi' ? { ...role, skillBindings: [] } : role
      )
    }

    const resolver = new AttemptConfigResolver(fixture.catalog)
    const snapshots = await Promise.all(
      topology.map(([roleId]) =>
        resolver.resolve(resolutionInput(fixture, roleId, `attempt.${roleId}`))
      )
    )

    expect(new Set(snapshots.map((resolved) => resolved.snapshot.roleProfile.id)).size).toBe(8)
    expect(
      snapshots
        .filter((resolved) => resolved.snapshot.executorProfile.id === 'executor.shared')
        .map((resolved) => resolved.snapshot.modelProfile.id)
    ).toEqual(expect.arrayContaining(['model.alpha', 'model.beta', 'model.gamma']))
    expect(
      snapshots
        .filter((resolved) => resolved.snapshot.modelProfile.id === 'model.shared')
        .map((resolved) => resolved.snapshot.executorProfile.kind)
        .sort()
    ).toEqual(['codex-cli', 'pi-rpc'])
    expect(new Set(snapshots.map((resolved) => resolved.snapshot.contentHash)).size).toBe(8)
  })
})

async function createCatalogFixture() {
  const root = await mkdtemp(join(tmpdir(), 'mam-attempt-config-'))
  temporaryDirectories.push(root)
  const catalog = new ProfileCatalog(join(root, 'catalog'))
  const skillAlphaPath = await createSkill(root, 'alpha', '# Alpha v1\n\nFirst version.\n')
  const skillBetaPath = await createSkill(root, 'beta', '# Beta\n\nSeparate role skill.\n')
  const alpha = await validateSkillPackage(skillAlphaPath)
  const beta = await validateSkillPackage(skillBetaPath)

  catalog.executors.save({
    id: 'executor.shared',
    version: 1,
    kind: 'codex-cli',
    executableRef: 'executable.codex',
    adapterOptions: { configMode: 'isolated' }
  })
  catalog.providers.save({
    id: 'provider.compatible',
    version: 1,
    protocol: 'openai-responses',
    baseUrl: 'https://models.example.test/v1',
    secretRef: 'secret.provider'
  })
  catalog.models.save({
    id: 'model.shared',
    version: 1,
    displayName: 'Shared Model',
    providerProfileId: 'provider.compatible',
    remoteModelId: 'model-remote-id',
    capabilities: {
      modalities: ['text'],
      supportsTools: true,
      supportsStructuredOutput: true,
      maxContextTokens: 200_000
    },
    defaultInference: { temperature: 0.2 }
  })
  catalog.skills.save(skillDefinition('skill.alpha', 1, alpha.contentDigest))
  catalog.skills.save(skillDefinition('skill.beta', 1, beta.contentDigest))
  catalog.mcpServers.save({
    id: 'mcp.git',
    version: 1,
    displayName: 'Git MCP',
    transport: 'stdio',
    connectionRef: 'connection.git-mcp',
    credentialRef: 'secret.mcp'
  })
  catalog.knowledgeBases.save({
    id: 'knowledge.project',
    version: 1,
    displayName: 'Project Knowledge',
    kind: 'project-files',
    sourceRef: 'repository.root',
    indexRevision: 'index.1'
  })
  catalog.roles.save(roleProfile('role.a', 'skill.alpha', true))
  catalog.roles.save(roleProfile('role.b', 'skill.beta', false))

  return {
    root,
    catalog,
    skillAlphaPath,
    localSkillBindings: [
      localSkillBinding('alpha', 'skill.alpha', skillAlphaPath),
      localSkillBinding('beta', 'skill.beta', skillBetaPath)
    ],
    localSecretBindings: [
      { id: 'binding.secret.provider', secretRef: 'secret.provider', bindingIdentity: 'local.1' },
      { id: 'binding.secret.mcp', secretRef: 'secret.mcp', bindingIdentity: 'local.1' }
    ]
  }
}

function resolutionInput(
  fixture: Awaited<ReturnType<typeof createCatalogFixture>>,
  roleProfileId: string,
  attemptId: string
) {
  return {
    workflowRunId: 'run.1',
    taskId: `task.${roleProfileId}`,
    attemptId,
    roleProfileId,
    roleProfileVersion: 1,
    capabilities: fullCapabilities(),
    localSecretBindings: fixture.localSecretBindings,
    localSkillBindings: fixture.localSkillBindings,
    localKnowledgeBindings: [],
    createdAt: '2026-07-28T01:00:00Z'
  }
}

async function createSkill(root: string, name: string, source: string): Promise<string> {
  const path = join(root, 'local-skills', name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), source)
  return path
}

function skillDefinition(id: string, version: number, contentDigest: string) {
  return {
    schemaVersion: '1.0.0',
    id,
    version,
    name: id,
    description: `${id} description`,
    supportedExecutors: ['codex-cli'],
    contentDigest,
    enabled: true,
    importedAt: '2026-07-28T01:00:00Z'
  }
}

function localSkillBinding(suffix: string, skillId: string, sourcePath: string) {
  return {
    id: `binding.skill.${suffix}`,
    skillId,
    sourcePath,
    bindingIdentity: 'local.1'
  }
}

function roleProfile(
  id: string,
  skillId: string,
  includeResources: boolean,
  execution = { executorProfileId: 'executor.shared', modelProfileId: 'model.shared' }
): RoleProfile {
  return {
    schemaVersion: '1.0.0',
    id,
    version: 1,
    displayName: id,
    execution: {
      ...execution,
      inferenceOverrides: { reasoningEffort: 'high' }
    },
    systemPromptRef: `prompt.${id}`,
    skillBindings: [{ skillId }],
    mcpBindings: includeResources
      ? [
          {
            serverProfileId: 'mcp.git',
            allowedTools: ['git.status'],
            allowedResources: ['repository://current'],
            allowedPrompts: []
          }
        ]
      : [],
    knowledgeBaseBindings: includeResources
      ? [
          {
            knowledgeBaseProfileId: 'knowledge.project',
            collections: ['source'],
            allowedOperations: ['search', 'read'],
            retrievalPolicy: { topK: 5, maxContextTokens: 8_000 },
            required: true
          }
        ]
      : [],
    tools: ['shell'],
    permissions: {
      readPaths: ['.'],
      writePaths: ['.'],
      allowedCommands: ['pnpm'],
      deniedCommands: [],
      allowedNetworkHosts: ['models.example.test'],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 100_000,
      maxOutputTokens: 20_000,
      maxCostUsd: 10,
      maxDurationSeconds: 3_600
    },
    retry: { maxAttempts: 2, initialBackoffMs: 100, maxBackoffMs: 1_000 },
    contextPolicy: {
      maxContextTokens: 100_000,
      compaction: 'executor',
      includePreviousAttempts: true
    }
  }
}

function knowledgeRole(id: string, required: boolean): RoleProfile {
  return {
    ...roleProfile(id, 'skill.alpha', false),
    skillBindings: [],
    knowledgeBaseBindings: [
      {
        knowledgeBaseProfileId: 'knowledge.local',
        allowedOperations: ['search', 'read'],
        retrievalPolicy: { topK: 3, maxContextTokens: 2_000 },
        required
      }
    ]
  }
}

function fullCapabilities(): ExecutorCapabilities {
  return {
    supportedProtocols: ['openai-responses'],
    supportsCustomEndpoint: true,
    supportsModelOverride: true,
    supportsPerInstanceConfig: true,
    supportsPerInstanceCredentials: true,
    supportsSkills: true,
    supportedMcpTransports: ['stdio'],
    supportsKnowledgeGateway: true,
    supportsStructuredOutput: true,
    supportsInvocationReconnect: false
  }
}
