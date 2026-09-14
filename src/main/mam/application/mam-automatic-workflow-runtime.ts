import type { GitStateRepository } from '../state-store/git-state-repository'
import { MamAutomaticWorkflowRunner } from './mam-automatic-workflow-runner'
import type { MamAttemptExecutionService } from './mam-attempt-execution-service'
import type { MamUiCommandService } from './mam-ui-command-service'
import type { MamWorkflowRunCommandService } from './mam-workflow-run-command-service'
import type { DesktopRuntimeLogger } from '../diagnostics/desktop-runtime-logger'

export function attachAutomaticWorkflow(input: {
  attempts: MamAttemptExecutionService
  commands: MamUiCommandService
  workflowRuns: MamWorkflowRunCommandService
  repository?: GitStateRepository
  runtimeLogger?: DesktopRuntimeLogger
  notifySnapshotChanged(): void
}): MamAutomaticWorkflowRunner {
  const runner = new MamAutomaticWorkflowRunner(
    input.attempts,
    input.commands,
    undefined,
    input.runtimeLogger
  )
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
