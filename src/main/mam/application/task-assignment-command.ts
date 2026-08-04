import type {
  MamAssignTaskInput,
  MamReassignTaskInput
} from '../../../shared/mam/application-command'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'

type TaskAssignmentPublisher = Readonly<{
  executeAndPush(input: { command: SchedulerCommand; schedulerId: string }): unknown
}>

export function publishTaskAssignmentCommand(input: {
  request: MamAssignTaskInput | MamReassignTaskInput
  type: 'assign_task' | 'reassign_task'
  userId: string
  schedulerId: string
  commandId: string
  issuedAt: string
  publisher: TaskAssignmentPublisher
}): void {
  const envelope = {
    schemaVersion: '1.0.0' as const,
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.request.workflowRunId,
    taskId: input.request.taskId,
    actor: { kind: 'user' as const, userId: input.userId }
  }
  const command: SchedulerCommand =
    input.type === 'reassign_task' && 'previousRoleProfileId' in input.request
      ? {
          ...envelope,
          type: 'reassign_task',
          previousRoleProfileId: input.request.previousRoleProfileId,
          previousRoleProfileVersion: input.request.previousRoleProfileVersion,
          roleProfileId: input.request.roleProfileId,
          roleProfileVersion: input.request.roleProfileVersion
        }
      : {
          ...envelope,
          type: 'assign_task',
          roleProfileId: input.request.roleProfileId,
          roleProfileVersion: input.request.roleProfileVersion
        }
  input.publisher.executeAndPush({ command, schedulerId: input.schedulerId })
}
