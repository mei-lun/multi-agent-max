import { createHash } from 'node:crypto'
import { posix as posixPath } from 'node:path'
import type { ArtifactContract } from '../../../shared/mam/domain/artifact'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { decodeArtifactContent } from '../artifacts/artifact-content-validator'

export function readUpstreamArtifacts(input: {
  bundle: WorkflowRunBundle
  projection: WorkflowRunProjection
  nodeId: string
  readGitBlob(commit: string, projectRelativePath: string): string
  readStateArtifact?(storageRef: string): Buffer
  artifactTypes?: ReadonlySet<string>
}): Readonly<Record<string, unknown>> {
  const workflowNode = input.bundle.definition.nodes.find((node) => node.id === input.nodeId)
  if (!workflowNode) throw new Error('workflow_node_not_found')
  const artifacts: Record<string, unknown> = {}
  const dependencies =
    input.bundle.plan.nodes.find((node) => node.id === workflowNode.id)?.dependencies ?? []
  for (const dependencyNodeId of dependencies) {
    const systemExecution = input.projection.systemNodeExecutions[dependencyNodeId]
    for (const artifact of systemExecution?.artifacts ?? []) {
      if (input.artifactTypes && !input.artifactTypes.has(artifact.artifactType)) continue
      if (!input.readStateArtifact) throw new Error('system_artifact_reader_missing')
      const bytes = input.readStateArtifact(artifact.storageRef)
      if (createHash('sha256').update(bytes).digest('hex') !== artifact.contentHash) {
        throw new Error('system_artifact_hash_mismatch')
      }
      if (Object.hasOwn(artifacts, artifact.artifactType)) {
        throw new Error(`workflow_artifact_ambiguous:${artifact.artifactType}`)
      }
      artifacts[artifact.artifactType] = decodeArtifactContent(artifact.format, bytes)
    }
    const taskDefinitions = input.bundle.taskCatalog.filter(
      (task) => task.nodeId === dependencyNodeId
    )
    const dynamicDefinitions = Object.values(input.projection.dynamicTasks).filter(
      (task) => task.nodeId === dependencyNodeId
    )
    for (const definition of [...taskDefinitions, ...dynamicDefinitions]) {
      const task = input.projection.tasks[definition.id]
      const attemptId = task?.selectedAttemptId ?? task?.knownAttemptIds.at(-1)
      const attempt = attemptId ? input.projection.attempts[attemptId] : undefined
      if (!attempt?.result || attempt.result.status !== 'submitted') continue
      for (const claim of attempt.result.artifacts) {
        if (input.artifactTypes && !input.artifactTypes.has(claim.type)) continue
        const contract = definition.outputContracts.find(
          (candidate) => candidate.artifactType === claim.contractId
        )
        if (!contract) throw new Error('workflow_artifact_contract_missing')
        const value = readGitArtifact({
          readGitBlob: input.readGitBlob,
          commit: attempt.result.system.submittedCommit,
          contentRef: claim.contentRef,
          contract,
          expectedHash: claim.sha256
        })
        if (Object.hasOwn(artifacts, claim.type)) {
          throw new Error(`workflow_artifact_ambiguous:${claim.type}`)
        }
        artifacts[claim.type] = value
      }
    }
  }
  return artifacts
}

function readGitArtifact(input: {
  readGitBlob(commit: string, projectRelativePath: string): string
  commit: string | undefined
  contentRef: string
  contract: ArtifactContract
  expectedHash: string
}): unknown {
  if (!input.commit) throw new Error('workflow_artifact_commit_missing')
  const contentRef = posixPath.normalize(input.contentRef.replaceAll('\\', '/'))
  if (contentRef === '.' || contentRef.startsWith('../') || posixPath.isAbsolute(contentRef)) {
    throw new Error('workflow_artifact_path_invalid')
  }
  const bytes = Buffer.from(input.readGitBlob(input.commit, contentRef), 'utf8')
  if (createHash('sha256').update(bytes).digest('hex') !== input.expectedHash) {
    throw new Error('workflow_artifact_hash_mismatch')
  }
  const text = bytes.toString('utf8')
  if (
    input.contract.format === 'json-schema' ||
    input.contract.format === 'file-set' ||
    input.contract.format === 'test-report'
  ) {
    return JSON.parse(text)
  }
  return text
}
