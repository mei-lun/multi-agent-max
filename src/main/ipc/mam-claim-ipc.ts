import type { BrowserWindow } from 'electron'
import {
  MAM_CLAIM_TASK_CHANNEL,
  MAM_FORCE_TAKEOVER_TASK_CHANNEL,
  MAM_RELEASE_TASK_CLAIM_CHANNEL
} from '../../shared/mam/application-api'
import type { MamUiCommandService } from '../mam/application/mam-ui-command-service'
import type { mamIpcRequestHandler } from './mam-ipc-request-handler'
import { assertTrustedRenderer } from './trusted-renderer-ipc'

export function registerMamClaimIpc(
  window: BrowserWindow,
  commands: MamUiCommandService,
  handle: ReturnType<typeof mamIpcRequestHandler>
): void {
  handle(MAM_CLAIM_TASK_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.claimTask(input)
  })
  handle(MAM_RELEASE_TASK_CLAIM_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.releaseTaskClaim(input)
  })
  handle(MAM_FORCE_TAKEOVER_TASK_CHANNEL, (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    return commands.forceTakeoverTask(input)
  })
}
