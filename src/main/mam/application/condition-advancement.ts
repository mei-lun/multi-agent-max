import type { GitStateRepository } from '../state-store/git-state-repository'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { projectWorkflowRun } from './workflow-run-projection'
import { readUpstreamArtifacts } from './workflow-node-artifact-context'
import { selectConditionBranch } from './condition-expression-evaluator'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'

export function advanceReadyConditions(input: {
  repository: GitStateRepository
  workflowRunId: string
  schedulerId: string
  nextCommandId(): string
  now(): string
}): readonly string[] {
  const resolved: string[] = []
  let projection = input.repository.rebuild(input.workflowRunId)
  const bundle = input.repository.loadRunBundle(input.workflowRunId)
  if (!bundle) throw new Error('run_bundle_missing')
  for (;;) {
    const run = projectWorkflowRun(bundle, projection, input.now())
    const node = bundle.definition.nodes
      .filter((candidate) => candidate.type === 'condition')
      .find(
        (candidate) =>
          run.nodeRuns.find((nodeRun) => nodeRun.nodeId === candidate.id)?.status === 'ready'
      )
    if (!node || node.type !== 'condition') return resolved
    const artifacts = readUpstreamArtifacts({
      bundle,
      projection,
      nodeId: node.id,
      readGitBlob: (commit, projectRelativePath) =>
        input.repository.readProjectBlob(commit, projectRelativePath),
      readStateArtifact: (storageRef) => input.repository.readStateArtifact(storageRef)
    })
    const selectedBranch = selectConditionBranch({
      expression: node.expression,
      artifacts,
      branches: node.branches
    })
    const command: Extract<SchedulerCommand, { type: 'resolve_condition' }> = {
      schemaVersion: '1.0.0',
      commandId: input.nextCommandId(),
      issuedAt: input.now(),
      workflowRunId: input.workflowRunId,
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'resolve_condition',
      nodeId: node.id,
      selectedBranch
    }
    new GitCommandRetryCoordinator(input.repository).executeAndPush({
      command,
      schedulerId: input.schedulerId
    })
    resolved.push(node.id)
    projection = input.repository.rebuild(input.workflowRunId)
  }
}
