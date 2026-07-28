import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'
import type { WorkflowNode } from '../../../shared/mam/domain/workflow'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { readUpstreamArtifacts } from './workflow-node-artifact-context'
import { buildSystemArtifacts } from './system-node-artifact-builder'
import { projectWorkflowRun } from './workflow-run-projection'

type SystemNodeContents = Readonly<{
  outputs: Readonly<Record<string, unknown>>
  blocked: boolean
  failureCode?: string
  evidence?: Readonly<{ exitCode: number | null; evidenceHash: string }>
}>

export function advanceReadySystemNodes(input: {
  repository: GitStateRepository
  workflowRunId: string
  schedulerId: string
  nextCommandId(): string
  now(): string
}): readonly string[] {
  const bundle = input.repository.loadRunBundle(input.workflowRunId)
  if (!bundle) throw new Error('run_bundle_missing')
  const completed: string[] = []
  let projection = input.repository.rebuild(input.workflowRunId)
  for (;;) {
    const run = projectWorkflowRun(bundle, projection, input.now())
    const node = bundle.definition.nodes.find(
      (candidate) =>
        (candidate.type === 'artifact_transform' || candidate.type === 'command') &&
        run.nodeRuns.find((nodeRun) => nodeRun.nodeId === candidate.id)?.status === 'ready'
    )
    if (!node || (node.type !== 'artifact_transform' && node.type !== 'command')) return completed
    const outcome = executeSystemNode({
      node,
      bundle,
      projection,
      repository: input.repository,
      now: input.now()
    })
    const command: Extract<SchedulerCommand, { type: 'complete_system_node' }> = {
      schemaVersion: '1.0.0',
      commandId: input.nextCommandId(),
      issuedAt: input.now(),
      workflowRunId: input.workflowRunId,
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'complete_system_node',
      execution: outcome.execution
    }
    new GitCommandRetryCoordinator(input.repository).executeAndPush({
      command,
      schedulerId: input.schedulerId,
      validArtifactHashes: outcome.validHashes,
      ...(outcome.writes.length > 0 ? { systemArtifactWrites: outcome.writes } : {})
    })
    completed.push(node.id)
    projection = input.repository.rebuild(input.workflowRunId)
  }
}

function executeSystemNode(input: {
  node: Extract<WorkflowNode, { type: 'artifact_transform' | 'command' }>
  bundle: Parameters<typeof projectWorkflowRun>[0]
  projection: Parameters<typeof projectWorkflowRun>[1]
  repository: GitStateRepository
  now: string
}) {
  try {
    const sources = readUpstreamArtifacts({
      bundle: input.bundle,
      projection: input.projection,
      nodeId: input.node.id,
      artifactTypes: new Set(
        input.node.type === 'artifact_transform'
          ? input.node.inputs.map((artifact) => artifact.artifactId)
          : []
      ),
      readGitBlob: (commit, projectRelativePath) =>
        input.repository.readProjectBlob(commit, projectRelativePath),
      readStateArtifact: (storageRef) => input.repository.readStateArtifact(storageRef)
    })
    const contents =
      input.node.type === 'artifact_transform'
        ? transformContents(input.node, sources)
        : commandContents(input.node, input.repository.projectDirectory)
    if (contents.blocked) {
      return {
        execution: {
          schemaVersion: '1.0.0' as const,
          nodeId: input.node.id,
          nodeType: input.node.type,
          status: 'blocked' as const,
          artifacts: [],
          ...(contents.evidence ? { commandEvidence: contents.evidence } : {}),
          failureCode: contents.failureCode ?? 'system_node_blocked'
        },
        writes: [],
        validHashes: new Set<string>()
      }
    }
    const artifacts = buildSystemArtifacts({
      workflowRunId: input.bundle.run.id,
      nodeRunId: input.bundle.run.nodeRuns.find((nodeRun) => nodeRun.nodeId === input.node.id)!.id,
      nodeId: input.node.id,
      contracts: input.node.outputs,
      contents: contents.outputs,
      inputs: 'inputs' in input.node ? input.node.inputs : [],
      createdAt: input.now
    })
    return {
      execution: {
        schemaVersion: '1.0.0' as const,
        nodeId: input.node.id,
        nodeType: input.node.type,
        status: 'passed' as const,
        artifacts: [...artifacts.artifacts],
        ...(contents.evidence ? { commandEvidence: contents.evidence } : {})
      },
      writes: artifacts.writes,
      validHashes: artifacts.validHashes
    }
  } catch (error) {
    return {
      execution: {
        schemaVersion: '1.0.0' as const,
        nodeId: input.node.id,
        nodeType: input.node.type,
        status: 'blocked' as const,
        artifacts: [],
        failureCode: error instanceof Error ? error.message.slice(0, 200) : 'system_node_failed'
      },
      writes: [],
      validHashes: new Set<string>()
    }
  }
}

function transformContents(
  node: Extract<WorkflowNode, { type: 'artifact_transform' }>,
  sources: Readonly<Record<string, unknown>>
): SystemNodeContents {
  const values = Object.values(sources)
  if (node.transform === 'identity' && values.length === 1 && node.outputs.length === 1) {
    return { outputs: { [node.outputs[0]!.artifactType]: values[0] }, blocked: false }
  }
  if (node.transform === 'json_merge' && node.outputs.length === 1) {
    const merged = Object.assign({}, ...values.map(requireRecord))
    return { outputs: { [node.outputs[0]!.artifactType]: merged }, blocked: false }
  }
  if (node.transform === 'json_array' && node.outputs.length === 1) {
    return { outputs: { [node.outputs[0]!.artifactType]: values }, blocked: false }
  }
  throw new Error('unsupported_artifact_transform')
}

function commandContents(
  node: Extract<WorkflowNode, { type: 'command' }>,
  projectDirectory: string
): SystemNodeContents {
  const workingDirectory = resolve(projectDirectory, node.workingDirectory)
  const relation = relative(projectDirectory, workingDirectory)
  if (isAbsolute(node.workingDirectory) || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('command_working_directory_invalid')
  }
  const result = spawnSync(node.executable, node.arguments, {
    cwd: workingDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024,
    shell: false
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr || result.error?.message || ''
  const evidence = {
    exitCode: result.status,
    evidenceHash: createHash('sha256')
      .update(
        JSON.stringify({ executable: node.executable, arguments: node.arguments, stdout, stderr })
      )
      .digest('hex')
  }
  if (result.status !== 0) {
    return { outputs: {}, blocked: true, failureCode: 'command_exit_nonzero', evidence }
  }
  if (node.outputs.length === 0) return { outputs: {}, blocked: false, evidence }
  const parsed =
    node.outputs.length === 1 ? parseOutput(stdout, node.outputs[0]!.format) : JSON.parse(stdout)
  const outputs =
    node.outputs.length === 1
      ? { [node.outputs[0]!.artifactType]: parsed }
      : Object.fromEntries(
          node.outputs.map((contract) => [contract.artifactType, parsed[contract.artifactType]])
        )
  return { outputs, blocked: false, evidence }
}

function parseOutput(output: string, format: string): unknown {
  return format === 'json-schema' || format === 'file-set' || format === 'test-report'
    ? JSON.parse(output)
    : output
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('artifact_transform_requires_json_objects')
  }
  return value as Record<string, unknown>
}
