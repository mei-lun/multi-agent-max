import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { EffectiveRoleConfigSnapshotSchema } from '../../../shared/mam/domain/role'
import { validateSkillPackage } from '../skills/skill-package-validator'
import type { ResolvedAttemptConfig } from './attempt-config-resolver'
import { profileContentHash } from './profile-content-hash'

export type MaterializedAttemptResources = Readonly<{
  attemptId: string
  rootDirectory: string
  configPath: string
  manifestPath: string
  skillDirectories: Readonly<Record<string, string>>
  contentHash: string
}>

export class AttemptResourceMaterializationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AttemptResourceMaterializationError'
  }
}

export class AttemptResourceMaterializer {
  private readonly rootDirectory: string

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory)
  }

  async materialize(config: ResolvedAttemptConfig): Promise<MaterializedAttemptResources> {
    const snapshot = EffectiveRoleConfigSnapshotSchema.parse(config.snapshot)
    const { contentHash: _contentHash, ...snapshotContent } = snapshot
    if (profileContentHash(snapshotContent) !== snapshot.contentHash) {
      throw new AttemptResourceMaterializationError(
        'effective_config_hash_mismatch',
        'Effective Config content does not match its hash'
      )
    }
    assertResolvedResources(config)
    const target = this.attemptDirectory(snapshot.attemptId)
    const existing = await this.readExisting(target)
    if (existing) {
      if (existing.contentHash !== snapshot.contentHash) {
        throw new AttemptResourceMaterializationError(
          'attempt_config_immutable',
          'Attempt already has a different Effective Config snapshot'
        )
      }
      return this.resultFor(target, config)
    }

    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(temporary, { recursive: true, mode: 0o700 })
    try {
      await this.writeBundle(temporary, config)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true })
      const raced = await this.readExisting(target)
      if (raced?.contentHash === snapshot.contentHash) return this.resultFor(target, config)
      throw error
    }
    return this.resultFor(target, config)
  }

  private async writeBundle(directory: string, config: ResolvedAttemptConfig): Promise<void> {
    const skillDirectories: Record<string, string> = {}
    for (const skill of config.skills) {
      const current = await validateSkillPackage(skill.localBinding.sourcePath)
      if (current.contentDigest !== skill.definition.contentDigest) {
        throw new AttemptResourceMaterializationError(
          'skill_content_changed',
          `Skill ${skill.definition.id} changed after config resolution`
        )
      }
      const relativeTarget = join('skills', safeDirectoryName(skill.definition.id))
      await copyDirectory(skill.localBinding.sourcePath, join(directory, relativeTarget))
      skillDirectories[skill.definition.id] = relativeTarget
    }
    await Promise.all([
      writePrivateJson(join(directory, 'effective-config.json'), config.snapshot),
      writePrivateJson(join(directory, 'executor-config.json'), {
        schemaVersion: '1.0.0',
        inheritGlobalSkills: false,
        inheritGlobalMcp: false,
        execution: config.snapshot.execution,
        tools: config.snapshot.tools
      }),
      writePrivateJson(join(directory, 'mcp-allowlist.json'), config.snapshot.mcpBindings),
      writePrivateJson(
        join(directory, 'knowledge-allowlist.json'),
        config.snapshot.knowledgeBaseBindings
      ),
      writePrivateJson(join(directory, 'resource-manifest.json'), {
        schemaVersion: '1.0.0',
        attemptId: config.snapshot.attemptId,
        effectiveConfigHash: config.snapshot.contentHash,
        inheritGlobalSkills: false,
        inheritGlobalMcp: false,
        skills: config.snapshot.skills.map((skill) => ({
          ...skill,
          materializationTarget: skillDirectories[skill.id]
        })),
        mcpServerIds: config.snapshot.mcpBindings.map((binding) => binding.serverProfileId),
        knowledgeBaseIds: config.snapshot.knowledgeBaseBindings.map(
          (binding) => binding.knowledgeBaseProfileId
        )
      })
    ])
  }

  private async readExisting(directory: string): Promise<{ contentHash: string } | undefined> {
    try {
      const snapshot = EffectiveRoleConfigSnapshotSchema.parse(
        JSON.parse(await readFile(join(directory, 'effective-config.json'), 'utf8'))
      )
      return { contentHash: snapshot.contentHash }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new AttemptResourceMaterializationError(
        'materialized_config_corrupt',
        `Cannot read materialized Effective Config: ${String(error)}`
      )
    }
  }

  private resultFor(target: string, config: ResolvedAttemptConfig): MaterializedAttemptResources {
    return {
      attemptId: config.snapshot.attemptId,
      rootDirectory: target,
      configPath: join(target, 'effective-config.json'),
      manifestPath: join(target, 'resource-manifest.json'),
      skillDirectories: Object.fromEntries(
        config.snapshot.skills.map((skill) => [
          skill.id,
          join(target, 'skills', safeDirectoryName(skill.id))
        ])
      ),
      contentHash: config.snapshot.contentHash
    }
  }

  private attemptDirectory(attemptId: string): string {
    const name = createHash('sha256').update(attemptId).digest('hex')
    return join(this.rootDirectory, 'attempts', name)
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('mam_skill_symbolic_links_not_allowed')
    const sourceEntry = join(source, entry.name)
    const targetEntry = join(target, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(sourceEntry, targetEntry)
      continue
    }
    if (!entry.isFile() || (await lstat(sourceEntry)).isSymbolicLink()) {
      throw new Error('mam_skill_special_files_not_allowed')
    }
    await copyFile(sourceEntry, targetEntry)
    await chmod(targetEntry, 0o600)
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await chmod(path, 0o600)
}

function safeDirectoryName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '-')
}

function assertResolvedResources(config: ResolvedAttemptConfig): void {
  assertExactIds(
    config.snapshot.skills.map((skill) => skill.id),
    config.skills.map((skill) => skill.definition.id),
    'skill'
  )
  assertExactIds(
    config.snapshot.mcpBindings.map((binding) => binding.serverProfileId),
    config.mcpResources.map((resource) => resource.profile.id),
    'mcp'
  )
  assertExactIds(
    config.snapshot.knowledgeBaseBindings.map((binding) => binding.knowledgeBaseProfileId),
    config.knowledgeResources.map((resource) => resource.profile.id),
    'knowledge'
  )
}

function assertExactIds(
  expected: readonly string[],
  actual: readonly string[],
  kind: string
): void {
  const normalizedExpected = [...expected].sort()
  const normalizedActual = [...actual].sort()
  if (
    normalizedExpected.length !== new Set(normalizedExpected).size ||
    JSON.stringify(normalizedExpected) !== JSON.stringify(normalizedActual)
  ) {
    throw new AttemptResourceMaterializationError(
      'resource_binding_mismatch',
      `Resolved ${kind} resources do not match the Role snapshot`
    )
  }
}
