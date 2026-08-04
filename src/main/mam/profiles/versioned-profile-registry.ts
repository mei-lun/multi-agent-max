import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { z } from 'zod'

type VersionedProfile = Readonly<{ id: string; version: number }>
type ActiveVersions = Readonly<Record<string, number>>

export class VersionedProfileRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'VersionedProfileRegistryError'
  }
}

export class VersionedProfileRegistry<T extends VersionedProfile> {
  private readonly rootDirectory: string

  constructor(
    rootDirectory: string,
    private readonly schema: z.ZodType<T>
  ) {
    this.rootDirectory = resolve(rootDirectory)
  }

  save(input: unknown, activate = true): T {
    const profile = this.schema.parse(input)
    assertSecretFreeProfile(profile)
    const path = this.versionPath(profile.id, profile.version)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    try {
      writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new VersionedProfileRegistryError(
          'profile_version_exists',
          `${profile.id} version ${profile.version} already exists`
        )
      }
      throw error
    }
    if (activate) this.activate(profile.id, profile.version)
    return structuredClone(profile)
  }

  get(id: string, version: number): T | undefined {
    try {
      return this.schema.parse(JSON.parse(readFileSync(this.versionPath(id, version), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  getActive(id: string): T | undefined {
    const version = this.readActiveVersions()[id]
    return version === undefined ? undefined : this.get(id, version)
  }

  listActive(): readonly T[] {
    return Object.entries(this.readActiveVersions())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, version]) => this.get(id, version)!)
  }

  activate(id: string, version: number): T {
    const profile = this.get(id, version)
    if (!profile) {
      throw new VersionedProfileRegistryError(
        'profile_version_not_found',
        `${id} version ${version} does not exist`
      )
    }
    const active = { ...this.readActiveVersions(), [id]: version }
    this.writeActiveVersions(active)
    return structuredClone(profile)
  }

  listVersions(id: string): readonly T[] {
    const directory = this.profileDirectory(id)
    try {
      return readdirSync(directory)
        .filter((name) => /^\d+\.json$/.test(name))
        .map((name) => Number.parseInt(name, 10))
        .sort((left, right) => left - right)
        .map((version) => this.get(id, version)!)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  deactivate(id: string): void {
    const active = this.readActiveVersions()
    if (!(id in active)) return
    const { [id]: _removed, ...remaining } = active
    this.writeActiveVersions(remaining)
  }

  discardInactive(id: string, version: number): void {
    if (this.readActiveVersions()[id] === version) {
      throw new VersionedProfileRegistryError(
        'active_profile_discard_forbidden',
        `${id} version ${version} is active`
      )
    }
    try {
      unlinkSync(this.versionPath(id, version))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  contentHash(profile: T): string {
    return createHash('sha256').update(canonicalJson(profile)).digest('hex')
  }

  private versionPath(id: string, version: number): string {
    if (!Number.isInteger(version) || version < 1) {
      throw new VersionedProfileRegistryError('invalid_profile_version', 'version must be positive')
    }
    return join(this.profileDirectory(id), `${version}.json`)
  }

  private profileDirectory(id: string): string {
    const name = createHash('sha256').update(id).digest('hex')
    return join(this.rootDirectory, 'versions', name)
  }

  private readActiveVersions(): ActiveVersions {
    const path = join(this.rootDirectory, 'active.json')
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new VersionedProfileRegistryError('active_index_corrupt', 'active index is invalid')
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([id, version]) => {
        if (!Number.isInteger(version) || (version as number) < 1) {
          throw new VersionedProfileRegistryError(
            'active_index_corrupt',
            'active version is invalid'
          )
        }
        return [id, version as number]
      })
    )
  }

  private writeActiveVersions(active: ActiveVersions): void {
    const path = join(this.rootDirectory, 'active.json')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(active, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporaryPath, path)
  }
}

function assertSecretFreeProfile(value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFreeProfile(entry, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key
    const normalized = key.toLowerCase()
    const isReference = normalized.endsWith('ref') || normalized.endsWith('refs')
    if (
      !isReference &&
      /(?:secret|password|passwd|api[_-]?key|authorization|credential|access[_-]?token)/i.test(key)
    ) {
      throw new VersionedProfileRegistryError(
        'plaintext_secret_forbidden',
        `profile field ${fieldPath} must use a reference`
      )
    }
    assertSecretFreeProfile(entry, fieldPath)
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
