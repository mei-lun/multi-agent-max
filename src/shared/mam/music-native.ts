export type MusicEngine = 'musicgen' | 'acestep' | 'yue2'
export type MusicResourceSpec = {
  schemaVersion: number
  resourceVersion: string
  releaseTag: string
  repository: string
  target: string
  modelRevision: string
  sourceRevision?: string
  vaeRevision?: string
}
