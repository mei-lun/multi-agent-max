import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArtifactContract } from '../../../shared/mam/domain/artifact'
import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { ExecutorUsage } from '../../../shared/mam/executor-events'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import {
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'
import type { AttemptArtifactContent } from './attempt-artifact-validator'

export type DirectAttemptResult = Readonly<{
  result: AttemptResult
  contents: ReadonlyMap<string, AttemptArtifactContent>
}>

export async function materializeDirectAttemptResult(
  workspacePath: string,
  outputContracts: readonly ArtifactContract[],
  contents: ReadonlyMap<string, AttemptArtifactContent>
): Promise<void> {
  for (const contract of outputContracts) {
    const content = contents.get(contract.artifactType)
    if (!content) continue
    await writeFile(join(workspacePath, directArtifactFilename(contract)), content.bytes, {
      encoding: 'utf8',
      mode: 0o600
    })
  }
}

/** Creates an Artifact from a read-only Role's final response, such as a review or design document. */
export function collectDirectAttemptResult(input: {
  text: string | null | undefined
  outputContracts: readonly ArtifactContract[]
  authority: AttemptResultAuthority
  usage: ExecutorUsage
}): DirectAttemptResult {
  if (input.outputContracts.length === 0) return emptyResult(input)
  if (input.outputContracts.length !== 1) {
    throw new Error('direct_artifact_output_ambiguous')
  }
  const contract = input.outputContracts[0]!
  if (!isDirectFormat(contract)) {
    throw new Error(`direct_artifact_output_unsupported:${contract.format}`)
  }
  if (!input.text?.trim()) {
    if (contract.required) throw new Error(`required_artifact_missing:${contract.artifactType}`)
    return emptyResult(input)
  }
  const value = directContent(contract, input.text)
  const bytes = validateAndEncodeArtifactContent(contract, value)
  const content: AttemptArtifactContent = { bytes, value }
  const claim = {
    contractId: contract.artifactType,
    type: contract.artifactType,
    contentRef: directArtifactFilename(contract),
    sha256: sha256(bytes)
  }
  return {
    result: buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: 'MAM verified one direct executor output artifact.',
        verifications: [],
        risks: [],
        followUps: [],
        artifacts: [claim],
        usage: resultUsage(input.usage)
      },
      input.authority
    ),
    contents: new Map([[contract.artifactType, content]])
  }
}

function emptyResult(input: {
  authority: AttemptResultAuthority
  usage: ExecutorUsage
}): DirectAttemptResult {
  return {
    result: buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: 'MAM verified an executor completion with no output artifacts.',
        verifications: [],
        risks: [],
        followUps: [],
        artifacts: [],
        usage: resultUsage(input.usage)
      },
      input.authority
    ),
    contents: new Map()
  }
}

function isDirectFormat(contract: ArtifactContract): boolean {
  return (
    contract.format === 'markdown' ||
    contract.format === 'json-schema' ||
    contract.format === 'test-report'
  )
}

function directContent(contract: ArtifactContract, text: string): unknown {
  if (contract.format === 'markdown') return text
  return JSON.parse(unfencedJson(text))
}

function directArtifactFilename(contract: ArtifactContract): string {
  const extension = contract.format === 'markdown' ? 'md' : 'json'
  return `${contract.artifactType}.${extension}`
}

function unfencedJson(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  return fenced?.[1] ?? trimmed
}

function resultUsage(usage: ExecutorUsage) {
  return {
    status: usage.status,
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd })
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
