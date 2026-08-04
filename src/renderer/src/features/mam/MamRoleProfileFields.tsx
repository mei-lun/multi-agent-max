import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Textarea } from '../../components/ui/textarea'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'
import {
  MamProfileNumberField,
  MamProfileSelectField,
  MamProfileTextField
} from './MamProfileFieldControls'
import { MamRoleResourceFields } from './MamRoleResourceFields'

export function MamRoleProfileFields({
  profile,
  snapshot,
  onChange
}: Readonly<{
  profile: RoleProfile
  snapshot: MamUiSnapshot
  onChange(profile: RoleProfile): void
}>): React.JSX.Element {
  const modelOptions = compatibleModelOptions(profile, snapshot)
  return (
    <div className="space-y-4">
      <MamProfileTextField
        label="Role name"
        value={profile.displayName}
        placeholder="For example: Frontend developer"
        onChange={(displayName) => onChange({ ...profile, displayName })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <MamProfileSelectField
          label="Executor"
          value={profile.execution.executorProfileId}
          options={profileOptions(
            snapshot.executors,
            profile.execution.executorProfileId,
            (item) => `${executorName(item.kind)} · ${item.id}`
          )}
          onChange={(executorProfileId) =>
            onChange({ ...profile, execution: { ...profile.execution, executorProfileId } })
          }
        />
        <MamProfileSelectField
          label="Model"
          value={profile.execution.modelProfileId}
          options={modelOptions}
          onChange={(modelProfileId) =>
            onChange({ ...profile, execution: { ...profile.execution, modelProfileId } })
          }
        />
      </div>
      {modelOptions.length === 0 && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-xs text-destructive"
        >
          No compatible model connection is configured. Add one in Settings before saving this role.
        </p>
      )}
      <MamWorkflowLabeledField
        label="Role instructions"
        description="Tell this role what it is responsible for and how it should work."
      >
        <Textarea
          className="min-h-28"
          value={inlinePrompt(profile.systemPromptRef)}
          placeholder="Describe the role's responsibilities, constraints, and expected output."
          onChange={(event) =>
            onChange({ ...profile, systemPromptRef: `inline:${event.target.value}` })
          }
        />
      </MamWorkflowLabeledField>
      <MamRoleResourceFields profile={profile} snapshot={snapshot} onChange={onChange} />
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-xs font-medium">Limits</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <MamProfileNumberField
              label="Maximum minutes"
              value={profile.budget.maxDurationSeconds / 60}
              min={1}
              onChange={(minutes) =>
                onChange({
                  ...profile,
                  budget: { ...profile.budget, maxDurationSeconds: Math.round(minutes * 60) }
                })
              }
            />
            <MamProfileNumberField
              label="Cost limit (USD)"
              value={profile.budget.maxCostUsd}
              min={0}
              step={0.5}
              onChange={(maxCostUsd) =>
                onChange({ ...profile, budget: { ...profile.budget, maxCostUsd } })
              }
            />
            <MamProfileNumberField
              label="Maximum attempts"
              value={profile.retry.maxAttempts}
              min={1}
              onChange={(maxAttempts) =>
                onChange({ ...profile, retry: { ...profile.retry, maxAttempts } })
              }
            />
          </div>
        </div>
      </details>
    </div>
  )
}

function profileOptions<T extends { id: string }>(
  profiles: readonly T[],
  selectedId: string,
  label: (profile: T) => string
): { value: string; label: string }[] {
  const options = profiles.map((profile) => ({ value: profile.id, label: label(profile) }))
  return options.some((option) => option.value === selectedId)
    ? options
    : [{ value: selectedId, label: selectedId }, ...options]
}

function inlinePrompt(value: string): string {
  return value.startsWith('inline:') ? value.slice('inline:'.length) : value
}

function executorName(kind: string): string {
  return { 'codex-cli': 'Codex CLI', 'grok-cli': 'Grok CLI', 'pi-rpc': 'Pi RPC' }[kind] ?? kind
}

function compatibleModelOptions(
  profile: RoleProfile,
  snapshot: MamUiSnapshot
): { value: string; label: string }[] {
  const executor = snapshot.executors.find(
    (item) => item.id === profile.execution.executorProfileId
  )
  const protocols =
    executor?.kind === 'pi-rpc'
      ? new Set([
          'openai-responses',
          'openai-completions',
          'anthropic-messages',
          'google-generative-ai'
        ])
      : undefined
  const models = snapshot.models.filter((model) => {
    const provider = snapshot.providers.find((item) => item.id === model.providerProfileId)
    return provider && (!protocols || protocols.has(provider.protocol))
  })
  return models.length
    ? profileOptions(models, profile.execution.modelProfileId, (item) => item.displayName)
    : []
}
