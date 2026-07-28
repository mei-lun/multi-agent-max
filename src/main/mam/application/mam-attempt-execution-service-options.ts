import type { ExecutorKind } from '../../../shared/mam/domain/execution-profile'
import type { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import type { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import type { MamUiQueryService } from './mam-ui-query-service'
import type { AttemptSecretValueProvider } from './local-attempt-secrets'
import type { ExecutorRouter } from './mam-attempt-execution-types'

export type MamAttemptExecutionServiceOptions = Readonly<{
  query: MamUiQueryService
  catalog: ProfileCatalog
  settings: MamLocalSettingsStore
  executor: ExecutorRouter
  resources: AttemptResourceMaterializer
  artifacts: AttemptArtifactValidator
  diagnostics: DiagnosticsRecorder
  workspaceRoot: string
  schedulerId?: string
  repository?: GitStateRepository
  secretValues?: AttemptSecretValueProvider
  now?: () => string
  createId?: (kind: string) => string
  onStateChanged?: () => void
  preflight?: ExecutorLocalPreflight
  enabledExecutorKinds?: readonly ExecutorKind[]
}>
