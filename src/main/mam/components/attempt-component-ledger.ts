import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { z } from 'zod'
import { atomicJson, readSafe } from '../creative-runtime/storage'
import { AttemptResultArtifactSchema } from '../../../shared/mam/domain/attempt-result'
import type { AttemptResultAuthority } from '../artifacts/attempt-result-builder'
import type { ArtifactContract } from '../../../shared/mam/domain/artifact'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import type { AttemptArtifactContent } from '../application/attempt-artifact-validator'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import { attemptComponentUsage } from './attempt-usage-budget'
type Authority = Omit<AttemptResultAuthority, 'createdAt'>
const locations = new Map<string, { directory: string; root: string }>()
const identity = (a: Authority) =>
  JSON.stringify([
    a.workflowRunId,
    a.taskId,
    a.attemptId,
    a.roleInstanceId,
    a.executorInvocationId,
    a.effectiveConfigHash
  ])
const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
export function registerComponentLedger(root: string, authority: Authority) {
  const key = identity(authority),
    directory = join(root, 'component-publications', digest(key))
  locations.set(key, { directory, root })
  return directory
}
export async function recordComponentPublication(
  root: string,
  authority: Authority,
  workspace: string,
  claims: z.infer<typeof AttemptResultArtifactSchema>[]
) {
  const directory = registerComponentLedger(root, authority)
  for (const claim of claims) {
    const bytes = await readSafe(join(workspace, claim.contentRef))
    if (digest(bytes) !== claim.sha256) throw Error('Published artifact changed before recording')
    await atomicJson(join(directory, digest(claim.contractId) + '.json'), {
      authority: identity(authority),
      claim
    })
  }
}
export async function collectComponentPublications(
  authority: Authority,
  workspace: string,
  contracts: readonly ArtifactContract[],
  snapshot: PreparedAttempt['snapshot']
) {
  const location = locations.get(identity(authority))
  if (!location) return undefined
  const { directory, root } = location
  const files = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (!files.length) return undefined
  await attemptComponentUsage(root, snapshot)
  const claims: z.infer<typeof AttemptResultArtifactSchema>[] = [],
    contents = new Map<string, AttemptArtifactContent>()
  for (const filename of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue
    const entry = z
      .object({ authority: z.string(), claim: AttemptResultArtifactSchema })
      .strict()
      .parse(JSON.parse((await readSafe(join(directory, filename))).toString()))
    if (entry.authority !== identity(authority))
      throw Error('Published artifact authority mismatch')
    const contract = contracts.find((c) => c.artifactType === entry.claim.contractId)
    if (!contract) throw Error('Published artifact contract not granted')
    if (!/^\.mam-component-[a-f0-9]{16}\.json$/.test(entry.claim.contentRef))
      throw Error('Published artifact path invalid')
    const bytes = await readSafe(join(workspace, entry.claim.contentRef))
    if (digest(bytes) !== entry.claim.sha256) throw Error('Published artifact hash mismatch')
    const value = contract.format === 'markdown' ? bytes.toString() : JSON.parse(bytes.toString())
    validateAndEncodeArtifactContent(contract, value)
    claims.push(entry.claim)
    contents.set(contract.artifactType, { bytes, value })
  }
  return claims.length ? { claims, contents } : undefined
}
