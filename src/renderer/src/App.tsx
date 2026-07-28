import {
  AlertTriangle,
  GitMerge,
  History,
  Languages,
  LayoutDashboard,
  Loader2,
  MessagesSquare,
  Network,
  PackageOpen,
  RefreshCw,
  Settings,
  UserRoundCheck,
  Users
} from 'lucide-react'
import { useState } from 'react'
import { Button } from './components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip'
import { MamMergeQueuePage } from './features/mam/MamMergeQueuePage'
import { MamMyRolePage } from './features/mam/MamMyRolePage'
import { MamOverviewPage } from './features/mam/MamOverviewPage'
import { MamReviewsPage } from './features/mam/MamReviewsPage'
import { MamResourcesPage } from './features/mam/MamResourcesPage'
import { MamRolesPage } from './features/mam/MamRolesPage'
import { MamRunsPage } from './features/mam/MamRunsPage'
import { MamSettingsPage } from './features/mam/MamSettingsPage'
import { MamWorkflowsPage } from './features/mam/MamWorkflowsPage'
import { useMamSnapshot } from './features/mam/use-mam-snapshot'
import { cn } from './lib/class-name'
import { LocalizedUiText, useUiLocale, type UiLocale } from './i18n/ui-locale'

type Page =
  | 'overview'
  | 'roles'
  | 'workflows'
  | 'runs'
  | 'my-role'
  | 'reviews'
  | 'merge-queue'
  | 'resources'
  | 'settings'

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('overview')
  const state = useMamSnapshot()
  const { locale, setLocale } = useUiLocale()
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <LocalizedUiText />
      <header className="titlebar flex h-9 shrink-0 items-center border-b border-border px-2">
        {isMac && <div className="titlebar-traffic-light-pad" />}
        <span className="titlebar-app-name text-xs font-semibold">Multi-Agent Max</span>
        <div className="ml-auto flex items-center">
          <Languages className="mr-1 size-3.5 text-muted-foreground" aria-hidden="true" />
          <Select value={locale} onValueChange={(value) => setLocale(value as UiLocale)}>
            <SelectTrigger
              className="mr-1 h-6 w-24 border-0 px-2 shadow-none"
              aria-label="Interface language"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={state.pending}
                aria-label="Refresh authoritative state"
                onClick={() => void state.refresh()}
              >
                {state.showPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh authoritative state</TooltipContent>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Primary"
          className="scrollbar-sleek w-52 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar p-2"
        >
          <NavigationButton
            current={page === 'overview'}
            icon={LayoutDashboard}
            label="Overview"
            onClick={() => setPage('overview')}
          />
          <NavigationButton
            current={page === 'roles'}
            icon={Users}
            label="Roles"
            onClick={() => setPage('roles')}
          />
          <NavigationButton
            current={page === 'workflows'}
            icon={Network}
            label="Workflows"
            onClick={() => setPage('workflows')}
          />
          <NavigationButton
            current={page === 'runs'}
            icon={History}
            label="Runs"
            onClick={() => setPage('runs')}
          />
          <NavigationButton
            current={page === 'my-role'}
            icon={UserRoundCheck}
            label="My Role"
            onClick={() => setPage('my-role')}
          />
          <NavigationButton
            current={page === 'reviews'}
            icon={MessagesSquare}
            label="Reviews"
            onClick={() => setPage('reviews')}
          />
          <NavigationButton
            current={page === 'merge-queue'}
            icon={GitMerge}
            label="Merge Queue"
            onClick={() => setPage('merge-queue')}
          />
          <NavigationButton
            current={page === 'resources'}
            icon={PackageOpen}
            label="Resources"
            onClick={() => setPage('resources')}
          />
          <NavigationButton
            current={page === 'settings'}
            icon={Settings}
            label="Settings"
            onClick={() => setPage('settings')}
          />
        </nav>

        <main className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto">
          {state.error && !state.snapshot ? (
            <div className="mx-auto flex min-h-full max-w-lg items-center justify-center p-6">
              <div className="w-full rounded-xl border border-destructive bg-card p-5">
                <h1 className="text-sm font-semibold text-destructive">
                  State could not be loaded
                </h1>
                <p className="mt-2 text-xs text-muted-foreground">{state.error}</p>
                <Button className="mt-4" size="sm" onClick={() => void state.refresh()}>
                  Retry
                </Button>
              </div>
            </div>
          ) : state.snapshot ? (
            <>
              {state.error && (
                <div
                  role="alert"
                  className="mx-auto mt-4 flex w-[calc(100%-3rem)] max-w-5xl items-start gap-2 rounded-lg border border-destructive bg-card p-3 text-xs text-destructive"
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {state.error}
                </div>
              )}
              <ActivePage
                page={page}
                snapshot={state.snapshot}
                pending={state.pending}
                onChooseProject={() => void state.selectProject()}
                onAssignTask={state.assignTask}
                onRecoverAttempt={state.recoverAttempt}
                onStartAttempt={state.startAttempt}
                onExecuteNextMerge={state.executeNextMerge}
                onSaveWorkflow={state.saveWorkflow}
                onCreateWorkflowRun={state.createWorkflowRun}
                onSubmitReview={state.submitReview}
                onResolveReviewDisagreement={state.resolveReviewDisagreement}
                onResolveApprovalGate={state.resolveApprovalGate}
                onSelectAttempt={state.selectAttempt}
                onGetAttemptDiff={state.getAttemptDiff}
                onSaveProfile={state.saveProfile}
                onSaveLocalSettings={state.saveLocalSettings}
                onImportSkill={state.importSkill}
                onExportDiagnostics={state.exportDiagnostics}
              />
            </>
          ) : (
            <div className="flex min-h-full items-center justify-center" aria-live="polite">
              {state.showPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading authoritative state…
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function ActivePage({
  page,
  snapshot,
  pending,
  onChooseProject,
  onAssignTask,
  onRecoverAttempt,
  onStartAttempt,
  onExecuteNextMerge,
  onSaveWorkflow,
  onCreateWorkflowRun,
  onSubmitReview,
  onResolveReviewDisagreement,
  onResolveApprovalGate,
  onSelectAttempt,
  onGetAttemptDiff,
  onSaveProfile,
  onSaveLocalSettings,
  onImportSkill,
  onExportDiagnostics
}: Readonly<{
  page: Page
  snapshot: NonNullable<ReturnType<typeof useMamSnapshot>['snapshot']>
  pending: boolean
  onChooseProject(): void
  onAssignTask: ReturnType<typeof useMamSnapshot>['assignTask']
  onRecoverAttempt: ReturnType<typeof useMamSnapshot>['recoverAttempt']
  onStartAttempt: ReturnType<typeof useMamSnapshot>['startAttempt']
  onExecuteNextMerge: ReturnType<typeof useMamSnapshot>['executeNextMerge']
  onSaveWorkflow: ReturnType<typeof useMamSnapshot>['saveWorkflow']
  onCreateWorkflowRun: ReturnType<typeof useMamSnapshot>['createWorkflowRun']
  onSubmitReview: ReturnType<typeof useMamSnapshot>['submitReview']
  onResolveReviewDisagreement: ReturnType<typeof useMamSnapshot>['resolveReviewDisagreement']
  onResolveApprovalGate: ReturnType<typeof useMamSnapshot>['resolveApprovalGate']
  onSelectAttempt: ReturnType<typeof useMamSnapshot>['selectAttempt']
  onGetAttemptDiff: ReturnType<typeof useMamSnapshot>['getAttemptDiff']
  onSaveProfile: ReturnType<typeof useMamSnapshot>['saveProfile']
  onSaveLocalSettings: ReturnType<typeof useMamSnapshot>['saveLocalSettings']
  onImportSkill: ReturnType<typeof useMamSnapshot>['importSkill']
  onExportDiagnostics: ReturnType<typeof useMamSnapshot>['exportDiagnostics']
}>): React.JSX.Element {
  if (page === 'roles') {
    return <MamRolesPage snapshot={snapshot} pending={pending} onSaveProfile={onSaveProfile} />
  }
  if (page === 'workflows') {
    return (
      <MamWorkflowsPage
        snapshot={snapshot}
        pending={pending}
        onSaveWorkflow={onSaveWorkflow}
        onCreateWorkflowRun={onCreateWorkflowRun}
      />
    )
  }
  if (page === 'runs') {
    return (
      <MamRunsPage
        runs={snapshot.runs}
        roles={snapshot.roles}
        pending={pending}
        onRecoverAttempt={onRecoverAttempt}
        onSelectAttempt={onSelectAttempt}
        onGetAttemptDiff={onGetAttemptDiff}
        onResolveApprovalGate={onResolveApprovalGate}
      />
    )
  }
  if (page === 'my-role') {
    return (
      <MamMyRolePage
        snapshot={snapshot}
        pending={pending}
        onAssignTask={onAssignTask}
        onStartAttempt={onStartAttempt}
      />
    )
  }
  if (page === 'reviews') {
    return (
      <MamReviewsPage
        runs={snapshot.runs}
        pending={pending}
        onSubmitReview={onSubmitReview}
        onResolveDisagreement={onResolveReviewDisagreement}
      />
    )
  }
  if (page === 'merge-queue') {
    return (
      <MamMergeQueuePage
        runs={snapshot.runs}
        pending={pending}
        onExecuteNextMerge={onExecuteNextMerge}
      />
    )
  }
  if (page === 'resources') {
    return (
      <MamResourcesPage
        snapshot={snapshot}
        pending={pending}
        onSaveProfile={onSaveProfile}
        onImportSkill={onImportSkill}
      />
    )
  }
  if (page === 'settings') {
    return (
      <MamSettingsPage
        snapshot={snapshot}
        pending={pending}
        onSaveProfile={onSaveProfile}
        onSaveLocalSettings={onSaveLocalSettings}
        onExportDiagnostics={onExportDiagnostics}
      />
    )
  }
  return <MamOverviewPage snapshot={snapshot} pending={pending} onChooseProject={onChooseProject} />
}

function NavigationButton({
  current,
  icon: Icon,
  label,
  onClick
}: Readonly<{
  current: boolean
  icon: typeof LayoutDashboard
  label: string
  onClick(): void
}>): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      data-current={current ? 'true' : 'false'}
      className={cn(
        'mb-1 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        current && 'bg-sidebar-accent text-sidebar-accent-foreground'
      )}
      onClick={onClick}
    >
      <Icon /> {label}
    </Button>
  )
}
