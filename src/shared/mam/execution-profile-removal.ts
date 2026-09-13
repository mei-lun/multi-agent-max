import type { MamDeleteExecutionProfileInput } from './application-command'
import type { MamUiSnapshot } from './ui-projection'

export function executionProfileReferences(
  snapshot: Pick<MamUiSnapshot, 'roles' | 'models' | 'runs'>,
  input: MamDeleteExecutionProfileInput
): readonly string[] {
  if (input.kind === 'provider') {
    return snapshot.models
      .filter((model) => model.providerProfileId === input.profileId)
      .map((model) => model.displayName)
  }
  const roles = [
    ...snapshot.roles,
    ...snapshot.runs
      .filter((run) => !['completed', 'cancelled'].includes(run.run.status))
      .flatMap((run) => run.roleProfiles)
  ]
  return [
    ...new Set(
      roles
        .filter(
          (role) =>
            (input.kind === 'executor'
              ? role.execution.executorProfileId
              : role.execution.modelProfileId) === input.profileId
        )
        .map((role) => role.displayName)
    )
  ]
}
