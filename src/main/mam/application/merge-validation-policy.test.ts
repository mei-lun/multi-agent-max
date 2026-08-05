import { describe, expect, it } from 'vitest'
import {
  executableMergeValidationCommands,
  isExecutableMergeValidationCommand,
  mergeValidationEvidence
} from './merge-validation-policy'

describe('merge validation policy', () => {
  it('keeps executable commands and ignores legacy prose checklists', () => {
    const values = [
      'pnpm test',
      './scripts/check.sh --strict',
      '确认独立审核结论允许集成',
      'Confirm the reviewed result is ready'
    ]

    expect(executableMergeValidationCommands(values)).toEqual([
      'pnpm test',
      './scripts/check.sh --strict'
    ])
    expect(isExecutableMergeValidationCommand('node "unterminated')).toBe(false)
  })

  it('binds post-merge command policy to the submitted revision without prior Agent evidence', () => {
    const evidence = mergeValidationEvidence(['pnpm test', '确认实现符合验收标准'], 'abcdef1234567')

    expect(Object.keys(evidence)).toEqual(['pnpm test'])
    expect(evidence['pnpm test']).toMatch(/^[0-9a-f]{64}$/)
  })
})
