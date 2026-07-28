import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export type GitSystemArtifactWrite = Readonly<{
  relativePath: string
  content: Buffer
  contentHash: string
}>

export class GitSystemArtifactWriterError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GitSystemArtifactWriterError'
  }
}

export function writeSystemArtifacts(input: {
  stateDirectory: string
  workflowRunId: string
  writes: readonly GitSystemArtifactWrite[]
}): void {
  const root = resolve(
    input.stateDirectory,
    '.workflow',
    'runs',
    input.workflowRunId,
    'artifacts',
    'system'
  )
  for (const write of input.writes) {
    if (createHash('sha256').update(write.content).digest('hex') !== write.contentHash) {
      fail('system_artifact_hash_mismatch', 'System Artifact bytes do not match the declared hash')
    }
    const target = resolve(input.stateDirectory, write.relativePath)
    const relation = relative(root, target)
    if (relation.startsWith('..') || isAbsolute(relation)) {
      fail('system_artifact_path_invalid', 'System Artifact path is outside its Run scope')
    }
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(target)) {
      if (!readFileSync(target).equals(write.content)) {
        fail('system_artifact_immutable', 'System Artifact content cannot be overwritten')
      }
      continue
    }
    writeFileSync(target, write.content, { flag: 'wx' })
  }
}

export function readSystemArtifact(stateDirectory: string, storageRef: string): Buffer {
  if (!storageRef.startsWith('git-state:')) {
    fail('system_artifact_storage_invalid', 'System Artifact storage is not Git state')
  }
  const root = resolve(stateDirectory, '.workflow')
  const target = resolve(stateDirectory, storageRef.slice('git-state:'.length))
  const relation = relative(root, target)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    fail('system_artifact_path_invalid', 'System Artifact path is outside Git state')
  }
  return readFileSync(target)
}

function fail(code: string, message: string): never {
  throw new GitSystemArtifactWriterError(code, message)
}
