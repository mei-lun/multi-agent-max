import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  ArtifactVersionSchema,
  type ArtifactContract,
  type ArtifactRef,
  type ArtifactVersion
} from '../../../shared/mam/domain/artifact'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import type { GitSystemArtifactWrite } from '../state-store/git-state-repository'

export type BuiltSystemArtifacts = Readonly<{
  artifacts: readonly ArtifactVersion[]
  writes: readonly GitSystemArtifactWrite[]
  validHashes: ReadonlySet<string>
}>

export function buildSystemArtifacts(input: {
  workflowRunId: string
  nodeRunId: string
  nodeId: string
  contracts: readonly ArtifactContract[]
  contents: Readonly<Record<string, unknown>>
  inputs: readonly ArtifactRef[]
  createdAt: string
}): BuiltSystemArtifacts {
  const artifacts: ArtifactVersion[] = []
  const writes: GitSystemArtifactWrite[] = []
  for (const contract of input.contracts) {
    if (!Object.hasOwn(input.contents, contract.artifactType)) {
      if (contract.required) throw new Error(`system_artifact_missing:${contract.artifactType}`)
      continue
    }
    const bytes = validateAndEncodeArtifactContent(contract, input.contents[contract.artifactType])
    if (bytes.byteLength > contract.maxBytes) throw new Error('system_artifact_too_large')
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const identity = createHash('sha256')
      .update(`${input.workflowRunId}\0${input.nodeId}\0${contract.artifactType}`)
      .digest('hex')
    const relativePath = join(
      '.workflow',
      'runs',
      input.workflowRunId,
      'artifacts',
      'system',
      input.nodeId,
      contentHash
    )
    artifacts.push(
      ArtifactVersionSchema.parse({
        schemaVersion: '1.0.0',
        id: `artifact.${identity.slice(0, 40)}`,
        artifactType: contract.artifactType,
        version: 1,
        workflowRunId: input.workflowRunId,
        nodeRunId: input.nodeRunId,
        taskId: `system-task.${identity.slice(0, 32)}`,
        attemptId: `system-attempt.${identity.slice(0, 32)}`,
        roleInstanceId: `system-role.${identity.slice(0, 32)}`,
        format: contract.format,
        contentHash,
        byteSize: bytes.byteLength,
        storageRef: `git-state:${relativePath}`,
        availability: 'git',
        inputs: input.inputs,
        validationStatus: 'valid',
        createdAt: input.createdAt
      })
    )
    writes.push({ relativePath, content: bytes, contentHash })
  }
  return { artifacts, writes, validHashes: new Set(artifacts.map((item) => item.contentHash)) }
}
