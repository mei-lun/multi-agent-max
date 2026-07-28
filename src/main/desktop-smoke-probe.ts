import { app, type BrowserWindow } from 'electron'
import { isAbsolute } from 'node:path'
import { writeFileSync } from 'node:fs'

type SmokeState = Readonly<{
  hasApi: boolean
  language: string
  title: string
  heading: string | null
  body: string
  commandTaskStatus?: string
  recoveryOriginalStatus?: string
  recoveryReplacementStatus?: string
  savedWorkflowVersion?: number
  resourcesReady?: boolean
  settingsReady?: boolean
}>

export function installDesktopSmokeProbe(window: BrowserWindow): void {
  if (process.env.MAM_DESKTOP_SMOKE !== '1') return
  window.webContents.once('did-finish-load', () => {
    void probe(window)
  })
}

async function probe(window: BrowserWindow): Promise<void> {
  try {
    const rendererState = await waitForRenderer(window)
    const chinese = rendererState.language === 'zh-CN'
    const commandTaskStatus = await runAssignmentProbe(window)
    const recoveryState = await runRecoveryProbe(window)
    await openWorkflowEditor(window, chinese)
    const capturePath = process.env.MAM_DESKTOP_SMOKE_CAPTURE
    if (capturePath) {
      if (!isAbsolute(capturePath)) throw new Error('Smoke capture path must be absolute')
      const image = await window.webContents.capturePage()
      writeFileSync(capturePath, image.toPNG())
    }
    const savedWorkflowVersion = await saveWorkflowVersion(window, chinese)
    const navigationState = await probeNavigationSurfaces(window, chinese)
    const state = {
      ...rendererState,
      ...(commandTaskStatus ? { commandTaskStatus } : {}),
      ...recoveryState,
      ...(savedWorkflowVersion ? { savedWorkflowVersion } : {}),
      ...navigationState
    }
    const expectedText = process.env.MAM_DESKTOP_SMOKE_EXPECT
    const passed =
      state.hasApi &&
      state.heading === (chinese ? '工作流概览' : 'Workflow overview') &&
      (!expectedText || state.body.includes(expectedText)) &&
      (!process.env.MAM_DESKTOP_SMOKE_ASSIGN_TASK || commandTaskStatus === 'ready') &&
      (!process.env.MAM_DESKTOP_SMOKE_RECOVER_ATTEMPT ||
        (recoveryState.recoveryOriginalStatus === 'blocked' &&
          recoveryState.recoveryReplacementStatus === 'recovery_planned')) &&
      (!process.env.MAM_DESKTOP_SMOKE_SAVE_WORKFLOW || savedWorkflowVersion === 2) &&
      navigationState.resourcesReady &&
      navigationState.settingsReady
    process.stdout.write(`MAM_DESKTOP_SMOKE ${JSON.stringify({ passed, ...state })}\n`)
    app.exit(passed ? 0 : 1)
  } catch (error) {
    process.stderr.write(`MAM_DESKTOP_SMOKE_FAILED ${String(error)}\n`)
    app.exit(1)
  }
}

async function probeNavigationSurfaces(
  window: BrowserWindow,
  chinese: boolean
): Promise<Pick<SmokeState, 'resourcesReady' | 'settingsReady'>> {
  return window.webContents.executeJavaScript(`(async () => {
    const open = async (label) => {
      const button = [...document.querySelectorAll('button')]
        .find((element) => element.textContent?.trim() === label);
      if (!button) return false;
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return document.querySelector('h1')?.textContent?.trim() === label;
    };
    return {
      resourcesReady: await open(${JSON.stringify(chinese ? '资源' : 'Resources')}),
      settingsReady: await open(${JSON.stringify(chinese ? '设置' : 'Settings')})
    };
  })()`)
}

async function saveWorkflowVersion(
  window: BrowserWindow,
  chinese: boolean
): Promise<number | undefined> {
  if (process.env.MAM_DESKTOP_SMOKE_SAVE_WORKFLOW !== '1') return undefined
  return window.webContents.executeJavaScript(`(async () => {
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === ${JSON.stringify(chinese ? '保存版本' : 'Save version')});
    if (!button) throw new Error('Missing Save version button');
    button.click();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const snapshot = await window.mam.getUiSnapshot();
      const version = snapshot.workflows
        .find((workflow) => workflow.id === 'workflow.desktop-seeded')?.version;
      if (version === 2) return version;
    }
    throw new Error('Workflow version was not saved');
  })()`)
}

async function openWorkflowEditor(window: BrowserWindow, chinese: boolean): Promise<void> {
  if (process.env.MAM_DESKTOP_SMOKE_OPEN_WORKFLOW_EDITOR !== '1') return
  await window.webContents.executeJavaScript(`(async () => {
    const clickByText = (text) => {
      const element = [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === text);
      if (!element) throw new Error('Missing button: ' + text);
      element.click();
    };
    clickByText(${JSON.stringify(chinese ? '工作流' : 'Workflows')});
    await new Promise((resolve) => setTimeout(resolve, 100));
    clickByText(${JSON.stringify(chinese ? '编辑新版本' : 'Edit new version')});
    await new Promise((resolve) => setTimeout(resolve, 300));
    const node = [...document.querySelectorAll('.react-flow__node')]
      .find((element) => element.textContent?.includes('assign-task'));
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (${JSON.stringify(chinese)}) {
      const editorLabel = document.querySelector('section[aria-label]')?.getAttribute('aria-label');
      const nodeIdLabel = document.querySelector('input[aria-label]')?.getAttribute('aria-label');
      if (editorLabel !== '工作流编辑器') {
        throw new Error('Workflow editor aria-label was not localized');
      }
      if (nodeIdLabel !== '新节点 ID') {
        throw new Error('New node input aria-label was not localized');
      }
    }
  })()`)
}

async function runRecoveryProbe(
  window: BrowserWindow
): Promise<Pick<SmokeState, 'recoveryOriginalStatus' | 'recoveryReplacementStatus'>> {
  const encodedInput = process.env.MAM_DESKTOP_SMOKE_RECOVER_ATTEMPT
  if (!encodedInput) return {}
  const input = JSON.parse(encodedInput) as unknown
  return window.webContents.executeJavaScript(`(async () => {
    const input = ${JSON.stringify(input)};
    const snapshot = await window.mam.recoverAttempt(input);
    const attempts = snapshot.runs
      .find((run) => run.run.id === input.workflowRunId)?.attempts ?? [];
    return {
      recoveryOriginalStatus: attempts.find(
        (attempt) => attempt.id === input.previousAttemptId
      )?.status,
      recoveryReplacementStatus: attempts.find(
        (attempt) => attempt.previousAttemptId === input.previousAttemptId
      )?.status
    };
  })()`)
}

async function runAssignmentProbe(window: BrowserWindow): Promise<string | undefined> {
  const encodedInput = process.env.MAM_DESKTOP_SMOKE_ASSIGN_TASK
  if (!encodedInput) return undefined
  const input = JSON.parse(encodedInput) as unknown
  return window.webContents.executeJavaScript(`(async () => {
    const input = ${JSON.stringify(input)};
    const snapshot = await window.mam.assignTask(input);
    return snapshot.runs
      .find((run) => run.run.id === input.workflowRunId)?.tasks
      .find((task) => task.id === input.taskId)?.status;
  })()`)
}

async function waitForRenderer(window: BrowserWindow): Promise<SmokeState> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await readRendererState(window)
    if (state.heading || state.body.includes('State could not be loaded')) return state
    await delay(100)
  }
  throw new Error('Renderer did not become ready')
}

function readRendererState(window: BrowserWindow): Promise<SmokeState> {
  return window.webContents.executeJavaScript(`(() => ({
    hasApi: ['getUiSnapshot', 'getAttemptDiff', 'selectProject', 'assignTask', 'recoverAttempt', 'saveWorkflow',
      'createWorkflowRun', 'startAttempt', 'executeNextMerge', 'onUiSnapshotChanged',
      'submitReview', 'resolveReviewDisagreement', 'resolveApprovalGate', 'selectAttempt', 'saveProfile',
      'saveLocalSettings', 'importSkill', 'exportDiagnostics']
      .every((name) => typeof window.mam?.[name] === 'function'),
    language: document.documentElement.lang,
    title: document.title,
    heading: document.querySelector('h1')?.textContent ?? null,
    body: document.body.innerText.slice(0, 2000)
  }))()`)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
