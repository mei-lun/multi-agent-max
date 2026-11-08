import { dialog } from 'electron'
import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import type { ComponentToolPort } from '../application/component-tool-port'
import type { AttemptGatewayAuthority } from '../gateways/attempt-gateway-authority'
export async function approveComponentTool(
  prepared: PreparedAttempt,
  authority: AttemptGatewayAuthority,
  identityDirectory: string,
  active: () => void,
  {
    request,
    requestHash,
    categories
  }: Parameters<NonNullable<ComponentToolPort['requestApproval']>>[0]
) {
  active()
  const binding = prepared.snapshot.componentBindings?.find(
    (item) => item.componentId === request.componentId
  )
  const redact = (value: string) =>
    value.replace(/Bearer\s+\S+|\b(?:sk|xai|api)-[A-Za-z0-9_-]+/gi, '[redacted]')
  const prompt =
    typeof request.params.prompt === 'string'
      ? redact(request.params.prompt.slice(0, 1500))
      : '(native component operation)'
  const decision = await dialog.showMessageBox({
    type: 'question',
    title: 'Approve component operation',
    message: `${request.componentId}: ${request.operation}`,
    detail: `Role: ${prepared.snapshot.roleProfile.id}\nTask: ${prepared.taskId}\nModel: ${binding?.model?.displayName ?? 'Native engine'}\nCount: ${typeof request.params.count === 'number' ? request.params.count : 1}\nPermissions: ${categories.join(', ')}\nProvider cost is unknown and may be charged.\n\n${prompt}\n\nRequest: ${requestHash}`,
    buttons: ['Reject', 'Approve this operation'],
    defaultId: 0,
    cancelId: 0
  })
  await mkdir(identityDirectory, { recursive: true })
  await appendFile(
    join(identityDirectory, 'approvals.jsonl'),
    JSON.stringify({
      requestHash,
      categories,
      allowed: decision.response === 1,
      ...authority,
      recordedAt: new Date().toISOString()
    }) + '\n'
  )
  active()
  return decision.response === 1
}
