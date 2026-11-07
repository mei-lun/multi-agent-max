import { isAbsolute } from 'node:path'
import type { MamLocalSettingsStore } from './mam/profiles/mam-local-settings-store'
import { GitStateRepository } from './mam/state-store/git-state-repository'
import { createGitCommandClient } from './mam/state-store/git-command-client'

export function stateRepositoryOptions(settings: MamLocalSettingsStore): { remote?: null } {
  return settings.get().collaborationMode === 'local' ? { remote: null } : {}
}
export function configuredStateRepository(
  settings: MamLocalSettingsStore
): GitStateRepository | undefined {
  const projectDirectory = process.env.MAM_PROJECT_DIRECTORY
  if (!projectDirectory) return undefined
  if (!isAbsolute(projectDirectory))
    throw new Error('MAM_PROJECT_DIRECTORY must be an absolute path')
  return GitStateRepository.attach(projectDirectory, undefined, {
    ...stateRepositoryOptions(settings),
    gitClient: createGitCommandClient(settings.get().gitExecutable)
  })
}
