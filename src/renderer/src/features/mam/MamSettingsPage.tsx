import { Bot, BrainCircuit, Cloud, Download, Languages, Settings } from 'lucide-react'
import { useState } from 'react'
import type {
  MamSaveLocalSettingsInput,
  MamSaveProfileInput
} from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamLocalSettingsEditor } from './MamLocalSettingsEditor'
import { MamProfileEditorDialog } from './MamProfileEditorDialog'
import { mamProfileTemplate } from './mam-profile-templates'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { useUiLocale, type UiLocale } from '../../i18n/ui-locale'

export function MamSettingsPage({
  snapshot,
  pending,
  onSaveProfile,
  onSaveLocalSettings,
  onExportDiagnostics
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSaveProfile(input: MamSaveProfileInput): Promise<void>
  onSaveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
  onExportDiagnostics(): Promise<string | undefined>
}>): React.JSX.Element {
  const [exportPath, setExportPath] = useState<string>()
  const { locale, setLocale } = useUiLocale()
  return (
    <section aria-labelledby="settings-title" className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 id="settings-title" className="text-xl font-semibold">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Executor, Provider, Model, Git, directories, and machine-local bindings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MamProfileEditorDialog
            kind="executor"
            template={mamProfileTemplate('executor', snapshot)}
            pending={pending}
            onSave={onSaveProfile}
          />
          <MamProfileEditorDialog
            kind="provider"
            template={mamProfileTemplate('provider', snapshot)}
            pending={pending}
            onSave={onSaveProfile}
          />
          <MamProfileEditorDialog
            kind="model"
            template={mamProfileTemplate('model', snapshot)}
            pending={pending}
            onSave={onSaveProfile}
          />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <ProfileColumn title="Executors" icon={Bot} empty="No Executor Profiles">
          {snapshot.executors.map((profile) => (
            <SettingsProfileCard
              key={profile.id}
              title={profile.kind}
              detail={profile.executableRef}
              profile={profile}
              action={
                <MamProfileEditorDialog
                  kind="executor"
                  profile={profile}
                  template={profile}
                  pending={pending}
                  onSave={onSaveProfile}
                />
              }
            />
          ))}
        </ProfileColumn>
        <ProfileColumn title="Providers" icon={Cloud} empty="No Provider Profiles">
          {snapshot.providers.map((profile) => (
            <SettingsProfileCard
              key={profile.id}
              title={profile.protocol}
              detail={profile.baseUrl ?? 'Executor-native endpoint'}
              profile={profile}
              action={
                <MamProfileEditorDialog
                  kind="provider"
                  profile={profile}
                  template={profile}
                  pending={pending}
                  onSave={onSaveProfile}
                />
              }
            />
          ))}
        </ProfileColumn>
        <ProfileColumn title="Models" icon={BrainCircuit} empty="No Model Profiles">
          {snapshot.models.map((profile) => (
            <SettingsProfileCard
              key={profile.id}
              title={profile.displayName}
              detail={profile.remoteModelId}
              profile={profile}
              action={
                <MamProfileEditorDialog
                  kind="model"
                  profile={profile}
                  template={profile}
                  pending={pending}
                  onSave={onSaveProfile}
                />
              }
            />
          ))}
        </ProfileColumn>
      </div>
      <MamLocalSettingsEditor
        settings={snapshot.localSettings}
        {...(snapshot.projectBinding
          ? { projectDirectory: snapshot.projectBinding.projectDirectory }
          : {})}
        pending={pending}
        onSave={onSaveLocalSettings}
      />
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Languages className="size-4 text-muted-foreground" /> Interface language
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses the system language on first launch, then keeps this choice on this Mac.
            </p>
          </div>
          <Select value={locale} onValueChange={(value) => setLocale(value as UiLocale)}>
            <SelectTrigger className="w-40" aria-label="Interface language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="zh-CN">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Diagnostics export</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Exports a redacted JSON bundle. Secret-like keys and bearer values are removed before
              writing.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const path = await onExportDiagnostics()
              if (path) setExportPath(path)
            }}
          >
            <Download /> Export diagnostics
          </Button>
        </div>
        {exportPath && (
          <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
            Exported to {exportPath}
          </p>
        )}
      </div>
      {snapshot.projectBinding && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="size-4 text-muted-foreground" /> Git state binding
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">State worktree</dt>
            <dd className="truncate font-mono">{snapshot.projectBinding.stateDirectory}</dd>
            <dt className="text-muted-foreground">Remote</dt>
            <dd className="font-mono">{snapshot.projectBinding.remote}</dd>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="font-mono">{snapshot.projectBinding.branch}</dd>
          </dl>
        </div>
      )}
    </section>
  )
}

function ProfileColumn({
  title,
  icon: Icon,
  empty,
  children
}: Readonly<{
  title: string
  icon: typeof Bot
  empty: string
  children: React.ReactNode
}>): React.JSX.Element {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" /> {title}
      </h2>
      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
          {empty}
        </p>
      )}
    </div>
  )
}

function SettingsProfileCard({
  title,
  detail,
  profile,
  action
}: Readonly<{
  title: string
  detail: string
  profile: Readonly<{ id: string; version: number }>
  action: React.ReactNode
}>): React.JSX.Element {
  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold">{title}</h3>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{profile.id}</p>
        </div>
        <Badge variant="outline">v{profile.version}</Badge>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground">{detail}</p>
      <div className="mt-3 flex justify-end border-t border-border pt-2">{action}</div>
    </article>
  )
}
