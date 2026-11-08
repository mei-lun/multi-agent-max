import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import type { DesktopCreativeServices } from './desktop-creative-services'
import type { PackageRuntimeContext } from './package-runtime'
import { createAttemptGraphCapabilities } from './attempt-graph-capabilities'
export function attemptRuntimeContext(
  services: DesktopCreativeServices,
  media: PackageRuntimeContext,
  options: {
    root: string
    workspace: string
    snapshot: PreparedAttempt['snapshot']
    authority: { attemptId: string; workflowRunId: string }
  }
): PackageRuntimeContext {
  const context: PackageRuntimeContext = { ...media }
  context.invokeCapability = createAttemptGraphCapabilities({
    ...options,
    handlers: (request) => services.runtimeHandlers(context)(request)
  })
  return context
}
