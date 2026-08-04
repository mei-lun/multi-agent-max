import type { MamSaveProfileInput } from '../../../../shared/mam/application-command'
import type {
  ExecutorProfile,
  ModelProfile,
  ProviderProfile
} from '../../../../shared/mam/domain/execution-profile'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { MamSkillDefinition } from '../../../../shared/mam/domain/skill-definition'
import type {
  KnowledgeBaseProfile,
  McpServerProfile
} from '../../../../shared/mam/domain/resource-profile'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import {
  MamExecutorProfileFields,
  MamModelProfileFields,
  MamProviderProfileFields
} from './MamExecutionProfileFields'
import {
  MamKnowledgeProfileFields,
  MamMcpProfileFields,
  MamSkillProfileFields
} from './MamResourceProfileFields'
import { MamRoleProfileFields } from './MamRoleProfileFields'

type Profile = MamSaveProfileInput['profile']

export function MamProfileForm({
  kind,
  profile,
  snapshot,
  onChange
}: Readonly<{
  kind: MamSaveProfileInput['kind']
  profile: Profile
  snapshot: MamUiSnapshot
  onChange(profile: Profile): void
}>): React.JSX.Element {
  if (kind === 'role') {
    return (
      <MamRoleProfileFields
        profile={profile as RoleProfile}
        snapshot={snapshot}
        onChange={onChange}
      />
    )
  }
  if (kind === 'executor') {
    return <MamExecutorProfileFields profile={profile as ExecutorProfile} onChange={onChange} />
  }
  if (kind === 'provider') {
    return <MamProviderProfileFields profile={profile as ProviderProfile} onChange={onChange} />
  }
  if (kind === 'model') {
    return (
      <MamModelProfileFields
        profile={profile as ModelProfile}
        snapshot={snapshot}
        onChange={onChange}
      />
    )
  }
  if (kind === 'mcp') {
    return <MamMcpProfileFields profile={profile as McpServerProfile} onChange={onChange} />
  }
  if (kind === 'knowledge') {
    return (
      <MamKnowledgeProfileFields profile={profile as KnowledgeBaseProfile} onChange={onChange} />
    )
  }
  return <MamSkillProfileFields profile={profile as MamSkillDefinition} onChange={onChange} />
}
