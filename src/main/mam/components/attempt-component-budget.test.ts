import { test, expect } from 'vitest'
import { componentJobUsage, assertComponentBudget } from './attempt-component-budget'
import type { CreativeJob } from '../../../shared/mam/creative-runtime'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
const snapshot = {
  budget: { maxCostUsd: 1, maxInputTokens: 100, maxOutputTokens: 100, maxDurationSeconds: 10 }
} as PreparedAttempt['snapshot']
const job = (usage: unknown[]) =>
  ({ events: usage.map((data) => ({ type: 'usage', data })) }) as CreativeJob
test('text costStatus does not discard tokens and nested calls aggregate without inventing cost', () => {
  const first = { status: 'known', inputTokens: 30, outputTokens: 20, costStatus: 'unknown' }
  expect(componentJobUsage(job([first, first]), snapshot)).toEqual({
    status: 'partial',
    inputTokens: 60,
    outputTokens: 40
  })
  expect(() => componentJobUsage(job([first, { ...first, inputTokens: 80 }]), snapshot)).toThrow(
    'budget'
  )
  expect(componentJobUsage(job([]), snapshot)).toEqual({ status: 'unknown' })
  expect(componentJobUsage(job([{ status: 'unknown' }]), snapshot)).toEqual({ status: 'unknown' })
  expect(
    componentJobUsage(
      job([
        { status: 'known', inputTokens: 2, outputTokens: 3, costUsd: 0.2 },
        { status: 'known', inputTokens: 4, outputTokens: 5, costUsd: 0.3 }
      ]),
      snapshot
    )
  ).toEqual({ status: 'known', inputTokens: 6, outputTokens: 8, costUsd: 0.5 })
  expect(
    componentJobUsage(
      job([
        { status: 'known', inputTokens: 2, outputTokens: 3, costUsd: 0.2 },
        { status: 'unknown' }
      ]),
      snapshot
    ).status
  ).toBe('partial')
})
test.each([
  'image.generate',
  'image.edit',
  'video.generate',
  'video.edit',
  'speech.generate',
  'text.generate',
  'vision.generate',
  'writing.goal.plan',
  'writing.goal.execute'
])('zero cost rejects paid operation %s', (operation) => {
  expect(() =>
    assertComponentBudget({ ...snapshot, budget: { ...snapshot.budget, maxCostUsd: 0 } }, operation)
  ).toThrow('zero cost')
})
