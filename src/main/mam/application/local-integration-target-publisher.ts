import type { GitCommandClient } from '../state-store/git-command-client'

export type LocalIntegrationTarget = Readonly<{
  branchRef: string
  checkedOutWorktree?: string
}>

export function prepareLocalIntegrationTarget(input: {
  git: GitCommandClient
  repositoryPath: string
  targetBranch: string
  targetCommitBefore: string
}): LocalIntegrationTarget {
  const branchRef = `refs/heads/${input.targetBranch}`
  const checkedOutWorktree = findCheckedOutWorktree(input.git, input.repositoryPath, branchRef)
  if (!checkedOutWorktree) return { branchRef }

  const checkedOutCommit = input.git.run(checkedOutWorktree, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}'
  ])
  if (checkedOutCommit !== input.targetCommitBefore) {
    throw new Error(`Checked-out target branch ${input.targetBranch} changed during preflight`)
  }
  if (input.git.run(checkedOutWorktree, ['status', '--porcelain'])) {
    throw new Error(`Checked-out target branch ${input.targetBranch} has uncommitted changes`)
  }
  return { branchRef, checkedOutWorktree }
}

export function publishLocalIntegrationTarget(input: {
  git: GitCommandClient
  repositoryPath: string
  target: LocalIntegrationTarget
  mergeCommit: string
  targetCommitBefore: string
}): void {
  if (input.target.checkedOutWorktree) {
    input.git.run(input.target.checkedOutWorktree, ['merge', '--ff-only', input.mergeCommit])
    return
  }
  input.git.run(input.repositoryPath, [
    'update-ref',
    input.target.branchRef,
    input.mergeCommit,
    input.targetCommitBefore
  ])
}

function findCheckedOutWorktree(
  git: GitCommandClient,
  repositoryPath: string,
  branchRef: string
): string | undefined {
  const records = git
    .runRaw(repositoryPath, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n\r?\n/)
  for (const record of records) {
    const lines = record.split(/\r?\n/)
    if (!lines.includes(`branch ${branchRef}`)) continue
    const worktree = lines.find((line) => line.startsWith('worktree '))
    if (worktree) return worktree.slice('worktree '.length)
  }
  return undefined
}
