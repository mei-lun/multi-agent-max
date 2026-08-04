import type {
  ExecutorProfile,
  ModelProfile,
  ProviderProfile
} from '../../../../shared/mam/domain/execution-profile'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import {
  MamProfileCheckbox,
  MamProfileNumberField,
  MamProfileSelectField,
  MamProfileTextField,
  toggleProfileId
} from './MamProfileFieldControls'

const executorKinds = [
  { value: 'codex-cli', label: 'Codex CLI' },
  { value: 'grok-cli', label: 'Grok CLI' },
  { value: 'pi-rpc', label: 'Pi RPC' }
] as const

const providerProtocols = [
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-completions', label: 'OpenAI compatible' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'executor-native', label: 'Executor native' }
] as const

const CODEX_COMMAND_PLACEHOLDER = 'codex'
const API_ADDRESS_PLACEHOLDER = 'https://api.example.com/v1'
const PROVIDER_SECRET_PLACEHOLDER = 'secret.openai'
const MODEL_ID_PLACEHOLDER = 'model-id'

export function MamExecutorProfileFields({
  profile,
  onChange
}: Readonly<{
  profile: ExecutorProfile
  onChange(profile: ExecutorProfile): void
}>): React.JSX.Element {
  return (
    <div className="space-y-4">
      <MamProfileSelectField
        label="Executor type"
        value={profile.kind}
        options={executorKinds}
        onChange={(kind) => onChange(changeExecutorKind(profile, kind as ExecutorProfile['kind']))}
      />
      <MamProfileTextField
        label="Command"
        description="The command name only; choose its local path under Machine-local bindings."
        value={profile.executableRef}
        placeholder={CODEX_COMMAND_PLACEHOLDER}
        mono
        onChange={(executableRef) => onChange({ ...profile, executableRef })}
      />
    </div>
  )
}

export function MamProviderProfileFields({
  profile,
  onChange
}: Readonly<{
  profile: ProviderProfile
  onChange(profile: ProviderProfile): void
}>): React.JSX.Element {
  return (
    <div className="space-y-4">
      <MamProfileTextField
        label="Provider ID"
        description="A short stable name, for example provider.openai."
        value={profile.id}
        mono
        onChange={(id) => onChange({ ...profile, id })}
      />
      <MamProfileSelectField
        label="API format"
        value={profile.protocol}
        options={providerProtocols}
        onChange={(protocol) =>
          onChange({ ...profile, protocol: protocol as ProviderProfile['protocol'] })
        }
      />
      <MamProfileTextField
        label="API address"
        description="Leave empty when the executor uses its native endpoint."
        value={profile.baseUrl ?? ''}
        placeholder={API_ADDRESS_PLACEHOLDER}
        mono
        onChange={(baseUrl) => onChange(withOptional(profile, 'baseUrl', baseUrl))}
      />
      <MamProfileTextField
        label="Secret reference"
        description="This is a reference name, not the API key itself."
        value={profile.secretRef ?? ''}
        placeholder={PROVIDER_SECRET_PLACEHOLDER}
        mono
        onChange={(secretRef) => onChange(withOptional(profile, 'secretRef', secretRef))}
      />
    </div>
  )
}

export function MamModelProfileFields({
  profile,
  snapshot,
  onChange
}: Readonly<{
  profile: ModelProfile
  snapshot: MamUiSnapshot
  onChange(profile: ModelProfile): void
}>): React.JSX.Element {
  const providerOptions = snapshot.providers.map((provider) => ({
    value: provider.id,
    label: provider.id
  }))
  if (!providerOptions.some((option) => option.value === profile.providerProfileId)) {
    providerOptions.unshift({ value: profile.providerProfileId, label: profile.providerProfileId })
  }
  return (
    <div className="space-y-4">
      <MamProfileTextField
        label="Model name"
        value={profile.displayName}
        placeholder="For example: GPT coding model"
        onChange={(displayName) => onChange({ ...profile, displayName })}
      />
      <MamProfileSelectField
        label="Provider"
        value={profile.providerProfileId}
        options={providerOptions}
        onChange={(providerProfileId) => onChange({ ...profile, providerProfileId })}
      />
      <MamProfileTextField
        label="Model ID"
        description="Use the model identifier expected by the provider."
        value={profile.remoteModelId}
        placeholder={MODEL_ID_PLACEHOLDER}
        mono
        onChange={(remoteModelId) => onChange({ ...profile, remoteModelId })}
      />
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-xs font-medium">Model capabilities</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {(['text', 'image', 'audio'] as const).map((modality) => (
              <MamProfileCheckbox
                key={modality}
                label={modalityLabel(modality)}
                checked={profile.capabilities.modalities.includes(modality)}
                onChange={(enabled) =>
                  onChange({
                    ...profile,
                    capabilities: {
                      ...profile.capabilities,
                      modalities: toggleProfileId(
                        profile.capabilities.modalities,
                        modality,
                        enabled
                      ) as ModelProfile['capabilities']['modalities']
                    }
                  })
                }
              />
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <MamProfileCheckbox
              label="Tool calling"
              checked={profile.capabilities.supportsTools}
              onChange={(supportsTools) =>
                onChange({
                  ...profile,
                  capabilities: { ...profile.capabilities, supportsTools }
                })
              }
            />
            <MamProfileCheckbox
              label="Structured output"
              checked={profile.capabilities.supportsStructuredOutput}
              onChange={(supportsStructuredOutput) =>
                onChange({
                  ...profile,
                  capabilities: { ...profile.capabilities, supportsStructuredOutput }
                })
              }
            />
          </div>
          <MamProfileNumberField
            label="Context window (tokens)"
            value={profile.capabilities.maxContextTokens ?? 100_000}
            min={1}
            onChange={(maxContextTokens) =>
              onChange({
                ...profile,
                capabilities: { ...profile.capabilities, maxContextTokens }
              })
            }
          />
        </div>
      </details>
    </div>
  )
}

function withOptional<T extends object, K extends keyof T>(profile: T, key: K, value: string): T {
  const next = { ...profile }
  if (value.trim()) next[key] = value.trim() as T[K]
  else delete next[key]
  return next
}

function modalityLabel(value: string): string {
  return { text: 'Text', image: 'Images', audio: 'Audio' }[value]!
}

function changeExecutorKind(
  profile: ExecutorProfile,
  kind: ExecutorProfile['kind']
): ExecutorProfile {
  const defaults: Record<ExecutorProfile['kind'], string> = {
    'codex-cli': 'codex',
    'grok-cli': 'grok',
    'pi-rpc': 'pi'
  }
  const executableRef = Object.values(defaults).includes(profile.executableRef)
    ? defaults[kind]
    : profile.executableRef
  return { ...profile, kind, executableRef }
}
