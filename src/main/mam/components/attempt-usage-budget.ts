import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readSafe } from '../creative-runtime/storage'
import { creativeJobSchema, type CreativeJob } from '../../../shared/mam/creative-runtime'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import {
  componentJobUsage,
  isPaidComponentOperation,
  assertComponentBudget
} from './attempt-component-budget'
export async function attemptComponentUsage(
  root: string,
  snapshot: PreparedAttempt['snapshot'],
  dispatchOperation?: string
) {
  const hash = createHash('sha256').update(snapshot.attemptId).digest('hex'),
    events: CreativeJob['events'] = []
  for (const kind of ['component-tool-attempts', 'component-attempts']) {
    const directory = join(root, kind, hash)
    const files = await readdir(directory).catch((error) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const file of files) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue
      const job = creativeJobSchema.parse(
        JSON.parse((await readSafe(join(directory, file))).toString())
      ) as CreativeJob
      if (
        job.request.attempt?.id !== snapshot.attemptId ||
        job.request.projectId !== snapshot.workflowRunId
      )
        throw Error('Foreign Attempt usage record')
      const reported = job.events.filter((event) => event.type === 'usage')
      events.push(
        ...(reported.length
          ? reported
          : [{ ...job.events[0]!, type: 'usage', data: { status: 'unknown' } }])
      )
    }
  }
  const usage = componentJobUsage({ events } as CreativeJob, snapshot),
    budget = snapshot.budget
  if (dispatchOperation) {
    assertComponentBudget(snapshot, dispatchOperation)
    if (
      budget &&
      isPaidComponentOperation(dispatchOperation) &&
      ((usage.costUsd !== undefined && usage.costUsd >= budget.maxCostUsd) ||
        (usage.inputTokens !== undefined && usage.inputTokens >= budget.maxInputTokens) ||
        (usage.outputTokens !== undefined && usage.outputTokens >= budget.maxOutputTokens))
    )
      throw Error('Attempt component budget exhausted')
  }
  return usage
}
