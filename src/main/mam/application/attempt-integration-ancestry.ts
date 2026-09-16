import type { GitCommandClient } from '../state-store/git-command-client'

export function createIntegrationAncestryResolver(input: {
  git: GitCommandClient
  repositoryPath: string
  remoteName: string | undefined
}): (targetBranch: string, ancestor: string, descendant: string) => boolean {
  const fetchedBranches = new Set<string>()
  return (targetBranch, ancestor, descendant) => {
    if (input.remoteName && !fetchedBranches.has(targetBranch)) {
      input.git.run(input.repositoryPath, [
        'fetch',
        '--no-tags',
        input.remoteName,
        `+refs/heads/${targetBranch}:refs/remotes/${input.remoteName}/${targetBranch}`
      ])
      fetchedBranches.add(targetBranch)
    }
    return input.git.succeeds(input.repositoryPath, [
      'merge-base',
      '--is-ancestor',
      ancestor,
      descendant
    ])
  }
}
