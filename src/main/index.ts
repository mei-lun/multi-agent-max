import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ProfileCatalog } from './mam/profiles/profile-catalog'
import { GitStateRepository } from './mam/state-store/git-state-repository'
import { MamUiQueryService } from './mam/application/mam-ui-query-service'
import { MamUiCommandService } from './mam/application/mam-ui-command-service'
import { registerMamIpc } from './ipc/mam-ipc'
import { installDesktopSmokeProbe } from './desktop-smoke-probe'
import { MamLocalSettingsStore } from './mam/profiles/mam-local-settings-store'
import { createGitCommandClient } from './mam/state-store/git-command-client'
import { DiagnosticsRecorder } from './mam/diagnostics/diagnostics-recorder'
import { MamWorkflowRunCommandService } from './mam/application/mam-workflow-run-command-service'
import { MamAttemptExecutionService } from './mam/application/mam-attempt-execution-service'
import { AttemptResourceMaterializer } from './mam/profiles/attempt-resource-materializer'
import { LocalArtifactStore } from './mam/artifacts/local-artifact-store'
import { AttemptArtifactValidator } from './mam/application/attempt-artifact-validator'
// CodexHeadlessAdapter and GrokCliAdapter remain available for later structured-CLI activation.
import { PiRpcAdapter } from './mam/executors/pi-rpc-adapter'
import { MAM_UI_SNAPSHOT_CHANGED_CHANNEL } from '../shared/mam/application-api'
import { MamAttemptInspectionService } from './mam/application/mam-attempt-inspection-service'
import { MamMergeQueueExecutionService } from './mam/application/mam-merge-queue-execution-service'
import { EncryptedLocalSecretStore } from './mam/application/encrypted-local-secret-store'
import {
  ChainedAttemptSecretValueProvider,
  EnvironmentAttemptSecretValueProvider,
  type AttemptSecretValueProvider
} from './mam/application/local-attempt-secrets'
import { ensureBuiltinPiProfile } from './mam/profiles/builtin-pi-profile'
import { MamDesignDraftStore } from './mam/application/mam-design-draft-store'
import { MamDesignAssistantService } from './mam/application/mam-design-assistant-service'
import { DesktopRuntimeLogger } from './mam/diagnostics/desktop-runtime-logger'

let unregisterMamIpc: (() => void) | undefined

configureSmokeUserData()

function createMainWindow(): void {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const mamRoot = join(app.getPath('userData'), 'mam')
  const runtimeLogger = new DesktopRuntimeLogger(join(mamRoot, 'diagnostics', 'runtime.jsonl'))
  const stopRuntimeHeartbeat = runtimeLogger.startHeartbeat()
  runtimeLogger.record('main', 'window_create_start', { platform: process.platform })
  const profiles = new ProfileCatalog(join(mamRoot, 'catalog'))
  const localSettings = new MamLocalSettingsStore(
    join(mamRoot, 'local-settings.json'),
    process.env.MAM_BINDING_ID ?? 'machine.local'
  )
  ensureBuiltinPiProfile(profiles, localSettings, join(mamRoot, 'executors', 'pi'))
  const localSecrets = new EncryptedLocalSecretStore(join(mamRoot, 'secrets.enc.json'), {
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secret encryption unavailable')
      return safeStorage.encryptString(value)
    },
    decrypt: (value) => safeStorage.decryptString(value)
  })
  const secretValues = new ChainedAttemptSecretValueProvider([
    localSecrets,
    new EnvironmentAttemptSecretValueProvider()
  ])
  const diagnostics = new DiagnosticsRecorder(
    join(app.getPath('userData'), 'mam', 'diagnostics', 'events.json')
  )
  const initialRepository = configuredStateRepository(localSettings)
  runtimeLogger.record('main', 'repository_attached', {
    attached: Boolean(initialRepository),
    collaborationMode: initialRepository?.collaborationMode
  })
  const service = new MamUiQueryService(
    {
      roles: profiles.roles,
      workflows: profiles.workflows,
      executors: profiles.executors,
      providers: profiles.providers,
      models: profiles.models,
      skills: profiles.skills,
      mcpServers: profiles.mcpServers,
      knowledgeBases: profiles.knowledgeBases,
      localSettings
    },
    initialRepository,
    undefined,
    diagnostics
  )
  const commands = new MamUiCommandService(
    service,
    {
      userId: process.env.MAM_USER_ID ?? 'user.local',
      schedulerId: 'scheduler.desktop'
    },
    initialRepository,
    profiles,
    localSettings,
    localSecrets
  )
  const designs = new MamDesignAssistantService(
    service,
    profiles,
    new MamDesignDraftStore(join(mamRoot, 'design-draft.json')),
    { resolve: (secretRef) => resolveDesignSecret(secretRef, localSettings, secretValues) }
  )
  const workflowRuns = new MamWorkflowRunCommandService(
    service,
    profiles,
    'scheduler.desktop',
    initialRepository
  )
  const attempts = new MamAttemptExecutionService({
    query: service,
    catalog: profiles,
    settings: localSettings,
    executor: new PiRpcAdapter(),
    enabledExecutorKinds: ['pi-rpc'],
    resources: new AttemptResourceMaterializer(
      join(app.getPath('userData'), 'mam', 'attempt-resources')
    ),
    artifacts: new AttemptArtifactValidator(
      new LocalArtifactStore(join(app.getPath('userData'), 'mam', 'artifacts'))
    ),
    diagnostics,
    workspaceRoot: join(app.getPath('userData'), 'mam', 'attempt-worktrees'),
    secretValues,
    ...(initialRepository ? { repository: initialRepository } : {}),
    onStateChanged: () => {
      if (!window.isDestroyed()) window.webContents.send(MAM_UI_SNAPSHOT_CHANGED_CHANNEL)
    }
  })
  const attemptInspection = new MamAttemptInspectionService(initialRepository, () =>
    createGitCommandClient(localSettings.get().gitExecutable)
  )
  const mergeQueue = new MamMergeQueueExecutionService(
    service,
    localSettings,
    join(app.getPath('userData'), 'mam', 'integration-worktrees'),
    'scheduler.desktop',
    initialRepository
  )
  unregisterMamIpc = registerMamIpc(
    window,
    service,
    commands,
    designs,
    workflowRuns,
    attempts,
    attemptInspection,
    mergeQueue,
    async () => {
      const defaultPath = localSettings.get().defaultProjectDirectory
      const result = await dialog.showOpenDialog(window, {
        title: 'Choose a Git project',
        ...(defaultPath ? { defaultPath } : {}),
        properties: ['openDirectory']
      })
      const directory = result.filePaths[0]
      if (result.canceled || !directory) return undefined
      const repository = GitStateRepository.attach(directory, undefined, {
        gitClient: createGitCommandClient(localSettings.get().gitExecutable)
      })
      service.setRunSource(repository)
      commands.setRepository(repository)
      workflowRuns.setRepository(repository)
      attempts.setRepository(repository)
      attemptInspection.setRepository(repository)
      mergeQueue.setRepository(repository)
      return service.getSnapshot()
    },
    async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Import a Skill package',
        properties: ['openDirectory']
      })
      const directory = result.filePaths[0]
      if (result.canceled || !directory) return undefined
      return commands.importSkill(directory)
    },
    async () => {
      const result = await dialog.showSaveDialog(window, {
        title: 'Export MAM diagnostics',
        defaultPath: join(app.getPath('documents'), 'mam-diagnostics.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return undefined
      return diagnostics.exportBundle(result.filePath)
    },
    runtimeLogger
  )

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.on('unresponsive', () => runtimeLogger.record('window', 'unresponsive'))
  window.on('responsive', () => runtimeLogger.record('window', 'responsive'))
  window.webContents.on('did-start-loading', () =>
    runtimeLogger.record('renderer', 'did_start_loading')
  )
  window.webContents.on('did-finish-load', () =>
    runtimeLogger.record('renderer', 'did_finish_load')
  )
  window.webContents.on('render-process-gone', (_event, details) =>
    runtimeLogger.record('renderer', 'render_process_gone', {
      reason: details.reason,
      exitCode: details.exitCode
    })
  )
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  installDesktopSmokeProbe(window)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    runtimeLogger.record('main', 'window_closed')
    stopRuntimeHeartbeat()
    unregisterMamIpc?.()
    unregisterMamIpc = undefined
  })

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (developmentUrl) void window.loadURL(developmentUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

function configuredStateRepository(
  settings: MamLocalSettingsStore
): GitStateRepository | undefined {
  const projectDirectory = process.env.MAM_PROJECT_DIRECTORY
  if (!projectDirectory) return undefined
  if (!isAbsolute(projectDirectory)) {
    throw new Error('MAM_PROJECT_DIRECTORY must be an absolute path')
  }
  return GitStateRepository.attach(projectDirectory, undefined, {
    gitClient: createGitCommandClient(settings.get().gitExecutable)
  })
}

function resolveDesignSecret(
  secretRef: string,
  settings: MamLocalSettingsStore,
  secretValues: AttemptSecretValueProvider
): string | undefined {
  const local = settings.get()
  const binding = local.secretBindings.find((candidate) => candidate.secretRef === secretRef) ?? {
    id: secretRef,
    secretRef,
    bindingIdentity: local.bindingIdentity
  }
  return secretValues.resolve(binding)
}

function configureSmokeUserData(): void {
  const directory = process.env.MAM_DESKTOP_SMOKE_USER_DATA
  if (process.env.MAM_DESKTOP_SMOKE !== '1' || !directory) return
  if (!isAbsolute(directory)) throw new Error('MAM_DESKTOP_SMOKE_USER_DATA must be absolute')
  mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
}

void app.whenReady().then(() => {
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
