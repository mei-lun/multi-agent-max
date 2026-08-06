import type { MergeConflictResolution } from '../../../shared/mam/domain/merge-conflict-task'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { HumanAttentionItem } from '../../../shared/mam/domain/human-attention'
import type { ReviewDecision, ReviewSubject } from '../../../shared/mam/domain/review'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'

export type AttemptBinding = Readonly<{
  roleInstanceId: string
  executorInvocationId: string
  effectiveConfigHash: string
}>

export type SchedulerTaskContext = Readonly<{
  workflowRunId: string
  taskId: string
  status:
    | 'waiting_dependencies'
    | 'waiting_role_assignment'
    | 'ready'
    | 'running'
    | 'waiting_for_human_input'
    | 'submitted'
    | 'in_review'
    | 'changes_requested'
    | 'approved'
    | 'completed'
    | 'blocked'
    | 'cancelled'
    | 'needs_attention'
  assignedRoleProfileId?: string
  assignedRoleProfileVersion?: number
  activeAttemptIds: ReadonlySet<string>
  reconcilingAttemptIds?: ReadonlySet<string>
  knownAttemptIds: ReadonlySet<string>
  submittedAttemptIds: ReadonlySet<string>
  attemptBindings: ReadonlyMap<string, AttemptBinding>
  allowedRoleProfileIds: ReadonlySet<string>
  roleCatalogVersions: ReadonlyMap<string, ReadonlySet<number>>
  dynamicTaskPlanHash?: string
  reviewTarget?: ReviewSubject
  allowedReviewNodeIds?: ReadonlySet<string>
  reviewDecisions: ReadonlyMap<string, ReviewDecision>
  minimumReviewDecisions?: number
  reviewPanelId?: string
  mergeCandidate?: MergeQueueEntry
  mergeResolutionCandidate?: MergeConflictResolution
  openHumanAttention?: HumanAttentionItem
}>

export type SchedulerKernelContext = Readonly<{
  schedulerId: string
  runCancelled?: boolean
  hasActiveAttempts?: boolean
  task?: SchedulerTaskContext
  approvalGates?: ReadonlyMap<
    string,
    Readonly<{ status: 'pending' | 'resolved'; options: ReadonlySet<string> }>
  >
  resolvedConditionNodeIds?: ReadonlySet<string>
  nodeStatuses?: ReadonlyMap<string, string>
  completedSystemNodeIds?: ReadonlySet<string>
  validArtifactHashes: ReadonlySet<string>
  processedCommandIds: ReadonlySet<string>
  runBundle?: WorkflowRunBundle
  existingTaskIds?: ReadonlySet<string>
  mergeQueueEntries: ReadonlyMap<string, MergeQueueEntry>
  humanReviewGates?: ReadonlyMap<
    string,
    Readonly<{
      status: 'pending' | 'resolved'
      subject: ReviewSubject
      revisionTargetNodeId: string
      revisionTargetTaskId: string
      attemptCount: number
      maxRevisionAttempts: number
    }>
  >
  revision?: string
}>
