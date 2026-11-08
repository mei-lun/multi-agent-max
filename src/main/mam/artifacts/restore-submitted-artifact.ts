import { createHash } from 'node:crypto'
import { AttemptResultSchema } from '../../../shared/mam/domain/attempt-result'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import { attemptArtifactId } from './attempt-artifact-identity'
import { LocalArtifactStore } from './local-artifact-store'
import { validateAndEncodeArtifactContent } from './artifact-content-validator'

type Run = MamUiSnapshot['runs'][number]

export function submittedArtifactRecord(
  run: Run,
  attempt: Run['attempts'][number],
  task: Run['tasks'][number],
  contractId: string,
  content: unknown
) {
  const result = AttemptResultSchema.parse(attempt.result)
  const authority = result.system
  if (
    attempt.status !== 'submitted' ||
    result.status !== 'submitted' ||
    authority.workflowRunId !== run.run.id ||
    authority.attemptId !== attempt.id ||
    authority.taskId !== task.id ||
    attempt.taskId !== task.id ||
    (attempt.roleInstanceId && attempt.roleInstanceId !== authority.roleInstanceId)
  )
    throw new Error('Submitted artifact producer authority mismatch')
  const index = result.artifacts.findIndex((claim) => claim.contractId === contractId)
  const claim = result.artifacts[index]
  const contract = ArtifactContractSchema.parse(
    task.outputContracts?.find((item) => item.artifactType === contractId)
  )
  if (
    !claim ||
    claim.type !== contract.artifactType ||
    result.artifacts.filter((item) => item.contractId === contractId).length !== 1
  )
    throw new Error('Submitted artifact contract mismatch')
  const bytes = validateAndEncodeArtifactContent(contract, content)
  if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256)
    throw new Error('Submitted artifact canonical hash mismatch')
  return {
    artifactId: attemptArtifactId(attempt.id, contractId, index),
    artifactType: claim.type,
    workflowRunId: authority.workflowRunId,
    nodeRunId: authority.nodeRunId,
    taskId: authority.taskId,
    attemptId: authority.attemptId,
    roleInstanceId: authority.roleInstanceId,
    contract,
    inputs: task.inputArtifacts ?? [],
    content,
    contentHash: claim.sha256,
    createdAt: authority.createdAt
  }
}

/** Rebuild only verified local Artifact metadata; workflow and review state are untouched. */
export async function restoreSubmittedArtifact(
  root: string,
  record: ReturnType<typeof submittedArtifactRecord>
) {
  const store = new LocalArtifactStore(root, () => record.createdAt)
  try {
    return await store.resolveVerifiedReference(record)
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
      !(error instanceof Error && error.message === 'artifact_reference_unavailable')
    )
      throw error
  }
  const version = await store.put(record)
  if (version.contentHash !== record.contentHash) throw new Error('Restored artifact hash mismatch')
  return { artifactId: version.id, version: version.version, contentHash: version.contentHash }
}
