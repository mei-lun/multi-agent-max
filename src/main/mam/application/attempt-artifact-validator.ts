import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { AttemptResultSchema, type AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { ArtifactContract, ArtifactVersion } from '../../../shared/mam/domain/artifact'
import type { ArtifactRef } from '../../../shared/mam/domain/artifact'
import type { LocalArtifactStore } from '../artifacts/local-artifact-store'

export type ValidatedAttemptArtifacts = Readonly<{
  result: AttemptResult
  validHashes: ReadonlySet<string>
  records: readonly Readonly<{
    version: ArtifactVersion
    content: unknown
    contentRef: string
  }>[]
}>

export class AttemptArtifactValidator {
  constructor(private readonly store: LocalArtifactStore) {}

  async validate(input: {
    result: AttemptResult
    outputContracts: readonly ArtifactContract[]
    workspacePath: string
    workflowRunId: string
    nodeRunId: string
    taskId: string
    attemptId: string
    roleInstanceId: string
    inputArtifacts: readonly ArtifactRef[]
  }): Promise<ValidatedAttemptArtifacts> {
    const claims = input.result.artifacts
    assertClaimsCoverContracts(claims, input.outputContracts)
    const artifacts = [] as AttemptResult['artifacts'][number][]
    const records: { version: ArtifactVersion; content: unknown; contentRef: string }[] = []
    for (const [index, claim] of claims.entries()) {
      const contract = input.outputContracts.find(
        (candidate) => candidate.artifactType === claim.contractId
      )!
      const content = await readClaimedContent(input.workspacePath, claim.contentRef, contract)
      const sourceHash = createHash('sha256').update(content.bytes).digest('hex')
      if (sourceHash !== claim.sha256) throw new Error('artifact_claim_hash_mismatch')
      const version = await this.store.put({
        artifactId: artifactId(input.attemptId, claim.contractId, index),
        artifactType: claim.type,
        workflowRunId: input.workflowRunId,
        nodeRunId: input.nodeRunId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        roleInstanceId: input.roleInstanceId,
        contract,
        inputs: input.inputArtifacts,
        content: content.value
      })
      artifacts.push({ ...claim, sha256: version.contentHash })
      records.push({ version, content: content.value, contentRef: claim.contentRef })
    }
    const result = AttemptResultSchema.parse({ ...input.result, artifacts })
    return { result, validHashes: new Set(artifacts.map((artifact) => artifact.sha256)), records }
  }
}

function assertClaimsCoverContracts(
  claims: AttemptResult['artifacts'],
  contracts: readonly ArtifactContract[]
): void {
  const known = new Set(contracts.map((contract) => contract.artifactType))
  if (claims.some((claim) => claim.type !== claim.contractId || !known.has(claim.contractId))) {
    throw new Error('artifact_claim_contract_mismatch')
  }
  if (new Set(claims.map((claim) => claim.contractId)).size !== claims.length) {
    throw new Error('artifact_claim_duplicated')
  }
  const missing = contracts.find(
    (contract) =>
      contract.required && !claims.some((claim) => claim.contractId === contract.artifactType)
  )
  if (missing) throw new Error(`required_artifact_missing:${missing.artifactType}`)
}

async function readClaimedContent(
  workspacePath: string,
  contentRef: string,
  contract: ArtifactContract
): Promise<Readonly<{ bytes: Buffer; value: unknown }>> {
  if (isAbsolute(contentRef)) throw new Error('artifact_content_ref_must_be_relative')
  const root = await realpath(resolve(workspacePath))
  const candidate = resolve(root, contentRef)
  const resolved = await realpath(candidate)
  const fromRoot = relative(root, resolved)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('artifact_content_ref_outside_workspace')
  }
  if (!(await lstat(resolved)).isFile()) throw new Error('artifact_content_ref_not_file')
  const bytes = await readFile(resolved)
  const text = bytes.toString('utf8')
  const value =
    contract.format === 'json-schema' ||
    contract.format === 'file-set' ||
    contract.format === 'test-report'
      ? JSON.parse(text)
      : text
  return { bytes, value }
}

function artifactId(attemptId: string, contractId: string, index: number): string {
  const digest = createHash('sha256')
    .update(`${attemptId}\0${contractId}\0${String(index)}`)
    .digest('hex')
  return `artifact.${digest.slice(0, 40)}`
}
