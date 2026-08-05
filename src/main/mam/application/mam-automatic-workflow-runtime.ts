import type { GitStateRepository } from '../state-store/git-state-repository'
import { MamAutomaticWorkflowRunner } from './mam-automatic-workflow-runner'
import type { MamAttemptExecutionService } from './mam-attempt-execution-service'
import type { MamUiCommandService } from './mam-ui-command-service'
import type { MamWorkflowRunCommandService } from './mam-workflow-run-command-service'

export function attachAutomaticWorkflow(input: {
  attempts: MamAttemptExecutionService
  commands: MamUiCommandService
  workflowRuns: MamWorkflowRunCommandService
  repository?: GitStateRepository
  notifySnapshotChanged(): void
}): MamAutomaticWorkflowRunner {
  const runner = new MamAutomaticWorkflowRunner(input.attempts, input.commands)
  const notify = (): void => {
    input.notifySnapshotChanged()
    runner.notify()
  }
  input.attempts.setOnStateChanged(notify)
  input.commands.setOnStateChanged(notify)
  input.workflowRuns.setOnStateChanged(notify)
  if (input.repository) runner.setRepository(input.repository)
  runner.notify()
  return runner
}
