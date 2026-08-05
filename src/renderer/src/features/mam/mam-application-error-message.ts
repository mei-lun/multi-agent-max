const ERROR_MESSAGES: readonly Readonly<{ token: string; message: string }>[] = [
  {
    token: 'task_not_startable:needs_attention',
    message: 'Open this Task and confirm whether it is safe to retry.'
  },
  {
    token: 'required_artifact_missing',
    message: 'The Role did not produce the required result. MAM kept its workspace for recovery.'
  },
  {
    token: 'local_executor_binding_missing',
    message: 'Configure this Role’s Executor on this machine before starting it.'
  },
  {
    token: 'executor_profile_not_found',
    message: 'Choose an available local Executor for this Role, then start the collaboration again.'
  },
  {
    token: 'executor_not_enabled',
    message: 'Enable this Role’s local Executor, then start the collaboration again.'
  },
  {
    token: 'secret_value_unavailable',
    message: 'Add the model credential required by this Role on this machine, then try again.'
  },
  {
    token: 'automatic_review_output_invalid',
    message: 'The reviewer could not make a valid decision. MAM will retry when it is safe.'
  },
  {
    token: 'active_attempts_present',
    message: 'Some local Roles are still working. Wait for them to finish, then clear this Run.'
  },
  {
    token: 'frozen_role_profile_unavailable',
    message: 'This Run uses a Role version that is no longer available. Clear and restart the Run.'
  },
  {
    token: 'frozen_role_profile_hash_mismatch',
    message: 'This Run’s saved Role version no longer matches. Clear and restart the Run.'
  },
  {
    token: 'active_role_profile_missing',
    message: 'A Workflow Role is no longer active. Restore that Role or update the Workflow.'
  },
  {
    token: 'task_role_assignment_required',
    message: 'The fixed Workflow Role was not activated. Run the Task again.'
  },
  {
    token: 'ENOENT',
    message: 'The configured local Executor was not found. Choose its installed executable.'
  },
  {
    token: 'structured interface',
    message:
      'The installed Executor version cannot run this Role. Update it or choose another Executor.'
  },
  {
    token: 'run_cancelled',
    message: 'This Run has already ended.'
  }
]

export function mamApplicationErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const known = ERROR_MESSAGES.find((candidate) => raw.includes(candidate.token))
  if (known) return known.message
  const remote = /Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)/.exec(raw)
  const message = (remote?.[1]?.trim() || raw)
    .replace(/^(?:Error|SchedulerCommandRejectedError|Mam\w+Error):\s*/i, '')
    .split('\n', 1)[0]!
    .trim()
  if (/^[a-z][a-z0-9_]*(?::[a-z0-9_.-]+)?$/i.test(message)) {
    return 'MAM could not continue this action. Open the affected Task to see what is needed.'
  }
  return message
}
