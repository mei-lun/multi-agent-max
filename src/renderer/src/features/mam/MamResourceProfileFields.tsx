import type { MamSkillDefinition } from '../../../../shared/mam/domain/skill-definition'
import type {
  KnowledgeBaseProfile,
  McpServerProfile
} from '../../../../shared/mam/domain/resource-profile'
import {
  MamProfileCheckbox,
  MamProfileSelectField,
  MamProfileTextField,
  toggleProfileId
} from './MamProfileFieldControls'

const mcpTransports = [
  { value: 'stdio', label: 'Local command (stdio)' },
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'Server-sent events (SSE)' }
] as const

const knowledgeKinds = [
  { value: 'project-files', label: 'Project files' },
  { value: 'local-directory', label: 'Local folder' },
  { value: 'git-repository', label: 'Git repository' },
  { value: 'vector-store', label: 'Vector store' },
  { value: 'mcp-resource', label: 'MCP resource' }
] as const

const MCP_CONNECTION_PLACEHOLDER = 'mcp.connection.github'
const MCP_SECRET_PLACEHOLDER = 'secret.github'
const KNOWLEDGE_SOURCE_PLACEHOLDER = 'docs'
const KNOWLEDGE_SECRET_PLACEHOLDER = 'secret.knowledge'

export function MamMcpProfileFields({
  profile,
  onChange
}: Readonly<{
  profile: McpServerProfile
  onChange(profile: McpServerProfile): void
}>): React.JSX.Element {
  return (
    <div className="space-y-4">
      <MamProfileTextField
        label="Server name"
        value={profile.displayName}
        placeholder="For example: GitHub tools"
        onChange={(displayName) => onChange({ ...profile, displayName })}
      />
      <MamProfileSelectField
        label="Connection type"
        value={profile.transport}
        options={mcpTransports}
        onChange={(transport) =>
          onChange({ ...profile, transport: transport as McpServerProfile['transport'] })
        }
      />
      <MamProfileTextField
        label="Connection reference"
        description="Use a registered local connection name; do not enter credentials here."
        value={profile.connectionRef}
        placeholder={MCP_CONNECTION_PLACEHOLDER}
        mono
        onChange={(connectionRef) => onChange({ ...profile, connectionRef })}
      />
      <MamProfileTextField
        label="Credential reference (optional)"
        value={profile.credentialRef ?? ''}
        placeholder={MCP_SECRET_PLACEHOLDER}
        mono
        onChange={(credentialRef) =>
          onChange(optionalCredential(profile, credentialRef) as McpServerProfile)
        }
      />
    </div>
  )
}

export function MamKnowledgeProfileFields({
  profile,
  onChange
}: Readonly<{
  profile: KnowledgeBaseProfile
  onChange(profile: KnowledgeBaseProfile): void
}>): React.JSX.Element {
  return (
    <div className="space-y-4">
      <MamProfileTextField
        label="Knowledge base name"
        value={profile.displayName}
        placeholder="For example: Product documentation"
        onChange={(displayName) => onChange({ ...profile, displayName })}
      />
      <MamProfileSelectField
        label="Source type"
        value={profile.kind}
        options={knowledgeKinds}
        onChange={(kind) => onChange({ ...profile, kind: kind as KnowledgeBaseProfile['kind'] })}
      />
      <MamProfileTextField
        label="Source"
        description="A project-relative source or a local binding reference."
        value={profile.sourceRef}
        placeholder={KNOWLEDGE_SOURCE_PLACEHOLDER}
        mono
        onChange={(sourceRef) => onChange({ ...profile, sourceRef })}
      />
      <MamProfileTextField
        label="Credential reference (optional)"
        value={profile.credentialRef ?? ''}
        placeholder={KNOWLEDGE_SECRET_PLACEHOLDER}
        mono
        onChange={(credentialRef) =>
          onChange(optionalCredential(profile, credentialRef) as KnowledgeBaseProfile)
        }
      />
    </div>
  )
}

export function MamSkillProfileFields({
  profile,
  onChange
}: Readonly<{
  profile: MamSkillDefinition
  onChange(profile: MamSkillDefinition): void
}>): React.JSX.Element {
  return (
    <div className="space-y-4">
      <MamProfileTextField
        label="Skill name"
        value={profile.name}
        onChange={(name) => onChange({ ...profile, name })}
      />
      <MamProfileTextField
        label="Description"
        value={profile.description}
        onChange={(description) => onChange({ ...profile, description })}
      />
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Supported executors</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(['codex-cli', 'grok-cli', 'pi-rpc'] as const).map((kind) => (
            <MamProfileCheckbox
              key={kind}
              label={executorLabel(kind)}
              checked={profile.supportedExecutors.includes(kind)}
              onChange={(enabled) =>
                onChange({
                  ...profile,
                  supportedExecutors: toggleProfileId(
                    profile.supportedExecutors,
                    kind,
                    enabled
                  ) as MamSkillDefinition['supportedExecutors']
                })
              }
            />
          ))}
        </div>
      </fieldset>
      <MamProfileCheckbox
        label="Enabled"
        description="Disabled Skills remain in history but cannot be assigned to new Attempts."
        checked={profile.enabled}
        onChange={(enabled) => onChange({ ...profile, enabled })}
      />
    </div>
  )
}

function optionalCredential<T extends object>(profile: T, value: string): T {
  const { credentialRef: _, ...base } = profile as T & { credentialRef?: string }
  return (value.trim() ? { ...base, credentialRef: value.trim() } : base) as T
}

function executorLabel(kind: string): string {
  return { 'codex-cli': 'Codex CLI', 'grok-cli': 'Grok CLI', 'pi-rpc': 'Pi RPC' }[kind]!
}
