export type MamUiProjectBindingSource = Readonly<{
  projectDirectory?: string
  stateDirectory?: string
  remote?: string | undefined
  collaborationMode?: 'local' | 'distributed'
  branch?: string
}>

export function projectBinding(source: MamUiProjectBindingSource | undefined): object {
  if (!source?.projectDirectory || !source.stateDirectory || !source.branch) return {}
  return {
    projectBinding: {
      projectDirectory: source.projectDirectory,
      stateDirectory: source.stateDirectory,
      collaborationMode: source.collaborationMode ?? (source.remote ? 'distributed' : 'local'),
      ...(source.remote ? { remote: source.remote } : {}),
      branch: source.branch
    }
  }
}
