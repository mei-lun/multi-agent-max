import type { MediaCatalog } from '../media'
import type { CreativeMediaFactory } from './desktop-creative-services'
import { coordinateGpuHandler } from './gpu-job-coordinator'
import { createPackageRuntime } from './package-runtime'

export type DesktopMediaDependencies = {
  catalog: MediaCatalog
  resolveSecret(reference: string): string | undefined
}
export function creativeFactory(
  mamRoot: string,
  media: DesktopMediaDependencies
): CreativeMediaFactory {
  return (assets, lookupJob, host) => {
    const runtime = createPackageRuntime({ ...host, assets })
    const runtimeHandlers: typeof runtime.runtimeHandlers = (context) => {
      const handlers = runtime.runtimeHandlers(context)
      return (request) => coordinateGpuHandler(mamRoot, request.operation, handlers(request))
    }
    return {
      handlers: runtimeHandlers({ ...media, lookupJob }),
      runtimeHandlers,
      releaseRuntimeScope: runtime.releaseRuntimeScope,
      listModels: () => runtime.listModels(media),
      dispose: () => runtime.dispose()
    }
  }
}
