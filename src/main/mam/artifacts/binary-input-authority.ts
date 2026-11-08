import { readdir } from 'node:fs/promises'
import {
  ArtifactRefSchema,
  type ArtifactRef,
  type ArtifactVersion
} from '../../../shared/mam/domain/artifact'
type Access = {
  metadataDirectory: (id: string) => string
  readMetadata: (ref: ArtifactRef) => Promise<ArtifactVersion>
  readVerifiedBytes: (version: ArtifactVersion) => Promise<unknown>
  registerNodeInputs: (run: string, node: string, refs: readonly ArtifactRef[]) => Promise<void>
}
export async function resolveVerifiedReference(
  access: Access,
  input: { artifactId: string; contentHash: string; workflowRunId: string }
): Promise<ArtifactRef> {
  const entries = await readdir(access.metadataDirectory(input.artifactId))
  for (const entry of entries.sort().reverse()) {
    if (!/^\d+\.json$/.test(entry)) continue
    const reference = ArtifactRefSchema.parse({
      artifactId: input.artifactId,
      contentHash: input.contentHash,
      version: Number(entry.slice(0, -5))
    })
    let version: ArtifactVersion
    try {
      version = await access.readMetadata(reference)
    } catch {
      continue
    }
    if (version.workflowRunId !== input.workflowRunId) throw new Error('artifact_access_denied')
    await access.readVerifiedBytes(version)
    return reference
  }
  throw new Error('artifact_reference_unavailable')
}
export async function authorizeNodeInputs(
  access: Access,
  workflowRunId: string,
  nodeId: string,
  references: readonly ArtifactRef[]
): Promise<void> {
  for (const reference of references) {
    const version = await access.readMetadata(reference)
    if (version.workflowRunId !== workflowRunId) throw new Error('artifact_access_denied')
    await access.readVerifiedBytes(version)
  }
  await access.registerNodeInputs(workflowRunId, nodeId, references)
}
