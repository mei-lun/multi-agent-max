import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  ArtifactContractSchema,
  ArtifactRefSchema,
  ArtifactVersionSchema,
  type ArtifactContract,
  type ArtifactRef,
  type ArtifactVersion
} from '../../../shared/mam/domain/artifact'
import {
  decodeArtifactContent,
  validateAndEncodeArtifactContent
} from './artifact-content-validator'
import { ArtifactStoreError } from './artifact-store-error'

export { ArtifactStoreError } from './artifact-store-error'

export type ArtifactWriteRequest = Readonly<{
  artifactId: string
  artifactType: string
  workflowRunId: string
  nodeRunId: string
  taskId: string
  attemptId: string
  roleInstanceId: string
  contract: ArtifactContract
  inputs: readonly ArtifactRef[]
  content: unknown
}>

export class LocalArtifactStore {
  private readonly nodeInputs = new Map<string, Set<string>>()
  private readonly versionLocks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly rootDirectory: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  put(request: ArtifactWriteRequest): Promise<ArtifactVersion> {
    return this.withVersionLock(request.artifactId, async () => {
      const contract = ArtifactContractSchema.parse(request.contract)
      if (contract.artifactType !== request.artifactType) {
        throw new ArtifactStoreError('artifact_type_mismatch', 'contract does not match artifact')
      }
      const inputs = request.inputs.map((input) => ArtifactRefSchema.parse(input))
      const bytes = validateAndEncodeArtifactContent(contract, request.content)
      if (bytes.byteLength > contract.maxBytes) {
        throw new ArtifactStoreError(
          'artifact_too_large',
          `artifact has ${bytes.byteLength} bytes; maximum is ${contract.maxBytes}`
        )
      }
      const contentHash = sha256(bytes)
      const version = await this.nextVersion(request.artifactId)
      const objectPath = this.objectPath(contentHash)
      await mkdir(join(resolve(this.rootDirectory), 'objects'), { recursive: true, mode: 0o700 })
      await writeImmutable(objectPath, bytes)

      const artifact = ArtifactVersionSchema.parse({
        schemaVersion: '1.0.0',
        id: request.artifactId,
        artifactType: request.artifactType,
        version,
        workflowRunId: request.workflowRunId,
        nodeRunId: request.nodeRunId,
        taskId: request.taskId,
        attemptId: request.attemptId,
        roleInstanceId: request.roleInstanceId,
        format: contract.format,
        contentHash,
        byteSize: bytes.byteLength,
        storageRef: objectPath,
        availability: 'local',
        inputs,
        validationStatus: 'valid',
        createdAt: this.now()
      })
      const metadataDirectory = this.metadataDirectory(request.artifactId)
      await mkdir(metadataDirectory, { recursive: true, mode: 0o700 })
      await writeFile(join(metadataDirectory, `${version}.json`), `${JSON.stringify(artifact)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      })
      return deepFreeze(artifact)
    })
  }

  async registerNodeInputs(
    workflowRunId: string,
    nodeId: string,
    artifacts: readonly ArtifactRef[]
  ): Promise<void> {
    const parsed = artifacts.map((artifact) => ArtifactRefSchema.parse(artifact))
    const key = nodeScopeKey(workflowRunId, nodeId)
    this.nodeInputs.set(key, new Set(parsed.map(artifactRefKey)))
    const directory = join(resolve(this.rootDirectory), 'access')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = this.accessProjectionPath(key)
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ workflowRunId, nodeId, artifacts: parsed })}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    )
    await rename(temporaryPath, path)
  }

  async readForNode(
    workflowRunId: string,
    nodeId: string,
    referenceInput: ArtifactRef
  ): Promise<{ version: ArtifactVersion; content: unknown }> {
    const reference = ArtifactRefSchema.parse(referenceInput)
    const allowed = await this.getNodeInputs(workflowRunId, nodeId)
    if (!allowed?.has(artifactRefKey(reference))) {
      throw new ArtifactStoreError(
        'artifact_access_denied',
        'node did not declare this Artifact input'
      )
    }
    const version = await this.readMetadata(reference)
    if (version.workflowRunId !== workflowRunId) {
      throw new ArtifactStoreError('artifact_access_denied', 'Artifact belongs to another run')
    }
    const bytes = await this.readVerifiedBytes(version)
    return { version, content: decodeArtifactContent(version.format, bytes) }
  }

  async verify(referenceInput: ArtifactRef): Promise<boolean> {
    try {
      const reference = ArtifactRefSchema.parse(referenceInput)
      const version = await this.readMetadata(reference)
      await this.readVerifiedBytes(version)
      return true
    } catch {
      return false
    }
  }

  private async readMetadata(reference: ArtifactRef): Promise<ArtifactVersion> {
    let source: string
    try {
      source = await readFile(
        join(this.metadataDirectory(reference.artifactId), `${reference.version}.json`),
        'utf8'
      )
    } catch {
      throw new ArtifactStoreError('artifact_not_found', 'Artifact version does not exist')
    }
    const version = ArtifactVersionSchema.parse(JSON.parse(source))
    if (
      version.id !== reference.artifactId ||
      version.version !== reference.version ||
      version.contentHash !== reference.contentHash
    ) {
      throw new ArtifactStoreError('artifact_reference_mismatch', 'Artifact reference is stale')
    }
    return version
  }

  private async readVerifiedBytes(version: ArtifactVersion): Promise<Buffer> {
    if (resolve(version.storageRef) !== this.objectPath(version.contentHash)) {
      throw new ArtifactStoreError('artifact_storage_mismatch', 'Artifact storage path is invalid')
    }
    const bytes = await readFile(version.storageRef)
    if (bytes.byteLength !== version.byteSize || sha256(bytes) !== version.contentHash) {
      throw new ArtifactStoreError('artifact_hash_mismatch', 'Artifact content was modified')
    }
    return bytes
  }

  private async nextVersion(artifactId: string): Promise<number> {
    try {
      const entries = await readdir(this.metadataDirectory(artifactId))
      const versions = entries
        .map((entry) => Number.parseInt(entry.replace(/\.json$/, ''), 10))
        .filter(Number.isSafeInteger)
      return Math.max(0, ...versions) + 1
    } catch {
      return 1
    }
  }

  private metadataDirectory(artifactId: string): string {
    return join(
      resolve(this.rootDirectory),
      'versions',
      createHash('sha256').update(artifactId).digest('hex')
    )
  }

  private async getNodeInputs(workflowRunId: string, nodeId: string): Promise<Set<string>> {
    const key = nodeScopeKey(workflowRunId, nodeId)
    const existing = this.nodeInputs.get(key)
    if (existing) {
      return existing
    }
    try {
      const source = await readFile(this.accessProjectionPath(key), 'utf8')
      const parsed = JSON.parse(source) as { artifacts?: unknown }
      if (!Array.isArray(parsed.artifacts)) {
        return new Set()
      }
      const restored = new Set(
        parsed.artifacts.map((artifact) => artifactRefKey(ArtifactRefSchema.parse(artifact)))
      )
      this.nodeInputs.set(key, restored)
      return restored
    } catch {
      return new Set()
    }
  }

  private accessProjectionPath(scopeKey: string): string {
    const name = createHash('sha256').update(scopeKey).digest('hex')
    return join(resolve(this.rootDirectory), 'access', `${name}.json`)
  }

  private objectPath(contentHash: string): string {
    return join(resolve(this.rootDirectory), 'objects', contentHash)
  }

  private async withVersionLock<T>(artifactId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.versionLocks.get(artifactId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.versionLocks.set(artifactId, current)
    try {
      return await current
    } finally {
      if (this.versionLocks.get(artifactId) === current) {
        this.versionLocks.delete(artifactId)
      }
    }
  }
}

function artifactRefKey(reference: ArtifactRef): string {
  return `${reference.artifactId}:${reference.version}:${reference.contentHash}`
}

function nodeScopeKey(workflowRunId: string, nodeId: string): string {
  return `${workflowRunId}\0${nodeId}`
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function writeImmutable(path: string, bytes: Buffer): Promise<void> {
  try {
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (!isAlreadyExists(error) || sha256(await readFile(path)) !== sha256(bytes)) {
      throw error
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

export function toArtifactRef(version: ArtifactVersion): ArtifactRef {
  return ArtifactRefSchema.parse({
    artifactId: version.id,
    version: version.version,
    contentHash: version.contentHash
  })
}
