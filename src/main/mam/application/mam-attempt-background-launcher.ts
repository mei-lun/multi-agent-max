import {
  runPreparedAttempt,
  type PreparedAttemptRunnerInput
} from './mam-attempt-background-runner'

export function launchPreparedAttempt(
  input: PreparedAttemptRunnerInput,
  onStateChanged: () => void
): void {
  // Let the start IPC return its running snapshot before executor setup can occupy the main loop.
  setImmediate(() => {
    void runPreparedAttempt(input).finally(onStateChanged)
  })
}
