import { createComponentExecutionPort } from './mam/components/attempt-component-executor'
import { createComponentTools } from './mam/components/attempt-component-tools'
import { desktopCreativeServices } from './mam/components/desktop-creative-services'
import {
  creativeFactory,
  type DesktopMediaDependencies
} from './mam/components/desktop-creative-factory'

export function desktopComponentExecution(root: string, media: DesktopMediaDependencies) {
  const options = {
    root,
    services: () => desktopCreativeServices(root, creativeFactory(root, media))
  }
  return {
    componentExecutor: createComponentExecutionPort(options),
    componentTools: createComponentTools(options)
  }
}
