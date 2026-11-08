import type { DesktopCreativeServices } from './desktop-creative-services'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import type { AttemptGatewayAuthority } from '../gateways/attempt-gateway-authority'
import type { CreativeRequest, CreativeJob } from '../../../shared/mam/creative-runtime'
import { createHash } from 'node:crypto'
import { attemptRuntimeContext } from './attempt-runtime-context'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function attemptModelHandler(
  services: DesktopCreativeServices,
  root: string,
  prepared: PreparedAttempt,
  authority: AttemptGatewayAuthority,
  lookupJob: (id: string) => CreativeJob | undefined,
  request: CreativeRequest
) {
  const binding = prepared.snapshot.componentBindings?.find(
    (item) => item.componentId === request.componentId
  )
  if (!binding?.model || !binding.provider) return undefined
  const model = binding.model,
    provider = binding.provider
  const catalog = {
    models: {
      listActive: () => [model],
      getActive: (id: string) => (id === model.id ? model : undefined)
    },
    providers: { getActive: (id: string) => (id === provider.id ? provider : undefined) }
  }
  const config = {
    catalog,
    resolveSecret: (ref: string) => prepared.credentialValues[ref]
  }
  return services.runtimeHandlers(
    attemptRuntimeContext(
      services,
      {
        ...config,
        scope: hash(prepared.attemptId),
        lookupJob
      },
      {
        root: root,
        workspace: prepared.worktree.path,
        snapshot: prepared.snapshot,
        authority
      }
    )
  )(request)
}
