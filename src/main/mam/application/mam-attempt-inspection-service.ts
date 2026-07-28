import {
  MamAttemptDiffSchema,
  MamGetAttemptDiffInputSchema,
  type MamAttemptDiff
} from '../../../shared/mam/attempt-inspection'
import type { GitCommandClient } from '../state-store/git-command-client'
import { createGitCommandClient } from '../state-store/git-command-client'
import type { GitStateRepository } from '../state-store/git-state-repository'

const MAX_DIFF_BYTES = 2 * 1024 * 1024

export class MamAttemptInspectionService {
  private repository: GitStateRepository | undefined

  constructor(
    repository?: GitStateRepository,
    private readonly createGit: () => GitCommandClient = createGitCommandClient
  ) {
    this.repository = repository
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
  }

  getDiff(input: unknown): MamAttemptDiff {
    const parsed = MamGetAttemptDiffInputSchema.parse(input)
    const repository = this.requireRepository()
    const attempt = repository.rebuild(parsed.workflowRunId).attempts[parsed.attemptId]
    const submittedCommit = attempt?.result?.system.submittedCommit
    if (!attempt || !submittedCommit) throw new Error('submitted_attempt_commit_not_found')
    const source = this.createGit().run(repository.projectDirectory, [
      'show',
      '--format=',
      '--no-ext-diff',
      '--no-color',
      submittedCommit,
      '--'
    ])
    const bytes = Buffer.byteLength(source)
    return MamAttemptDiffSchema.parse({
      attemptId: parsed.attemptId,
      submittedCommit,
      diff: bytes > MAX_DIFF_BYTES ? truncateUtf8(source, MAX_DIFF_BYTES) : source,
      truncated: bytes > MAX_DIFF_BYTES
    })
  }

  private requireRepository(): GitStateRepository {
    if (!this.repository) throw new Error('project_not_attached')
    return this.repository
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  return Buffer.from(value).subarray(0, maxBytes).toString('utf8')
}
