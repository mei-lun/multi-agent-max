import type { ArtifactContract, ArtifactRef } from '../../../shared/mam/domain/artifact'
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
