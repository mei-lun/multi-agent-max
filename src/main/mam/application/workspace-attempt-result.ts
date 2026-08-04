import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { minimatch } from 'minimatch'
import type { ArtifactContract } from '../../../shared/mam/domain/artifact'
import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { ExecutorUsage } from '../../../shared/mam/executor-events'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import {
  buildAttemptResult,
  type AttemptResultAuthority
} from '../artifacts/attempt-result-builder'
import type { GitCommandClient } from '../state-store/git-command-client'
import type { AttemptArtifactContent } from './attempt-artifact-validator'

export type WorkspaceAttemptResult = Readonly<{
  result: AttemptResult
  contents: ReadonlyMap<string, AttemptArtifactContent>
}>

export async function collectWorkspaceAttemptResult(input: {
  workspacePath: string
  baseCommit: string
  outputContracts: readonly ArtifactContract[]
  git: GitCommandClient
  authority: AttemptResultAuthority
  usage: ExecutorUsage
}): Promise<WorkspaceAttemptResult> {
  const paths = changedWorkspacePaths(input.git, input.workspacePath, input.baseCommit)
  const contents = new Map<string, AttemptArtifactContent>()
  const claims: AttemptResult['artifacts'] = []
  const usedPaths = new Set<string>()
  for (const contract of input.outputContracts) {
    const collected = await collectContract({ ...input, contract, paths, usedPaths })
    if (!collected) continue
    usedPaths.add(collected.path)
    contents.set(contract.artifactType, collected.content)
    claims.push({
      contractId: contract.artifactType,
      type: contract.artifactType,
      contentRef: collected.contentRef,
      sha256: sha256(collected.content.bytes)
    })
  }
  return {
    result: buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: `MAM verified ${String(claims.length)} workspace output artifact(s).`,
        verifications: [],
        risks: [],
        followUps: [],
        artifacts: claims,
        usage: resultUsage(input.usage)
      },
      input.authority
    ),
    contents
  }
}

async function collectContract(input: {
  workspacePath: string
  baseCommit: string
  contract: ArtifactContract
  paths: readonly string[]
  usedPaths: ReadonlySet<string>
  git: GitCommandClient
}): Promise<CollectedWorkspaceArtifact | undefined> {
  if (input.contract.format === 'diff') return collectDiff(input)
  if (input.contract.format === 'file-set') return collectFileSet(input)
  const candidates = await collectFileCandidates(input)
  const selected = selectCandidate(input.contract, candidates)
  if (!selected) {
    if (input.contract.required)
      throw new Error(`required_artifact_missing:${input.contract.artifactType}`)
    return undefined
  }
  return {
    path: selected.path,
    contentRef: `workspace:${selected.path}`,
    content: selected.content
  }
}

function collectDiff(input: {
  workspacePath: string
  baseCommit: string
  contract: ArtifactContract
  git: GitCommandClient
}): CollectedWorkspaceArtifact | undefined {
  input.git.run(input.workspacePath, ['add', '--intent-to-add', '--', '.'])
  const diff = input.git.runRaw(input.workspacePath, [
    'diff',
    '--binary',
    '--no-ext-diff',
    input.baseCommit,
    '--'
  ])
  if (!diff) {
    if (input.contract.required)
      throw new Error(`required_artifact_missing:${input.contract.artifactType}`)
    return undefined
  }
  return {
    path: `git-diff:${input.baseCommit}`,
    contentRef: `git:diff:${input.baseCommit}`,
    content: { bytes: Buffer.from(diff), value: diff }
  }
}

async function collectFileSet(input: {
  workspacePath: string
  contract: ArtifactContract
  paths: readonly string[]
}): Promise<CollectedWorkspaceArtifact | undefined> {
  const paths = input.paths.filter((path) =>
    input.contract.allowedGlobs!.some((glob) => minimatch(path, glob, { dot: true }))
  )
  if (paths.length === 0) {
    if (input.contract.required)
      throw new Error(`required_artifact_missing:${input.contract.artifactType}`)
    return undefined
  }
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: (await readFile(join(input.workspacePath, path))).toString('utf8')
    }))
  )
  const value = { files }
  return {
    path: `file-set:${input.contract.artifactType}`,
    contentRef: `workspace:file-set:${input.contract.artifactType}`,
    content: { bytes: Buffer.from(JSON.stringify(value)), value }
  }
}

async function collectFileCandidates(input: {
  workspacePath: string
  contract: ArtifactContract
  paths: readonly string[]
  usedPaths: ReadonlySet<string>
}): Promise<readonly CollectedWorkspaceArtifact[]> {
  const candidates: CollectedWorkspaceArtifact[] = []
  for (const path of input.paths) {
    if (input.usedPaths.has(path)) continue
    try {
      const bytes = await readFile(join(input.workspacePath, path))
      const value = fileValue(input.contract, bytes)
      validateAndEncodeArtifactContent(input.contract, value)
      candidates.push({ path, contentRef: `workspace:${path}`, content: { bytes, value } })
    } catch {
      continue
    }
  }
  return candidates
}

function fileValue(contract: ArtifactContract, bytes: Buffer): unknown {
  const text = bytes.toString('utf8')
  return contract.format === 'markdown' ? text : JSON.parse(text)
}

function selectCandidate(
  contract: ArtifactContract,
  candidates: readonly CollectedWorkspaceArtifact[]
): CollectedWorkspaceArtifact | undefined {
  const matching = candidates.filter((candidate) =>
    artifactNameMatches(contract.artifactType, candidate.path)
  )
  if (matching.length === 1) return matching[0]
  if (matching.length > 1 || candidates.length > 1) {
    throw new Error(`artifact_output_ambiguous:${contract.artifactType}`)
  }
  return candidates[0]
}

function changedWorkspacePaths(
  git: GitCommandClient,
  workspacePath: string,
  baseCommit: string
): string[] {
  const tracked = git.runRaw(workspacePath, ['diff', '--name-only', '-z', baseCommit, '--'])
  const untracked = git.runRaw(workspacePath, ['ls-files', '--others', '--exclude-standard', '-z'])
  return [...new Set(`${tracked}${untracked}`.split('\0').filter(Boolean))].sort()
}

function artifactNameMatches(artifactType: string, path: string): boolean {
  const name = basename(path).toLowerCase()
  const token = artifactType.replace(/^artifact[._-]?/, '').toLowerCase()
  return token.length > 0 && name.includes(token)
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

type CollectedWorkspaceArtifact = Readonly<{
  path: string
  contentRef: string
  content: AttemptArtifactContent
}>
