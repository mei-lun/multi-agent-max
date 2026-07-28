import { describe, expect, it } from 'vitest'
import {
  ConditionExpressionError,
  evaluateConditionExpression,
  selectConditionBranch
} from './condition-expression-evaluator'

describe('condition expression evaluator', () => {
  it('safely evaluates structured Artifact fields without executing source text', () => {
    const artifacts = { 'artifact.decision': { approved: true, score: 2 } }
    expect(
      evaluateConditionExpression({
        expression: 'artifact["artifact.decision"].approved == true',
        artifacts
      })
    ).toBe(true)
    expect(
      selectConditionBranch({
        expression: 'artifact["artifact.decision"].score',
        artifacts,
        branches: { '2': 'two', other: 'other' }
      })
    ).toBe('2')
  })

  it('uses yes/no for a unique top-level boolean and rejects ambiguity', () => {
    expect(
      selectConditionBranch({
        expression: 'approved',
        artifacts: { 'artifact.review': { approved: false } },
        branches: { yes: 'accept', no: 'reject' }
      })
    ).toBe('no')
    expect(() =>
      evaluateConditionExpression({
        expression: 'approved',
        artifacts: { first: { approved: true }, second: { approved: false } }
      })
    ).toThrow(expect.objectContaining({ code: 'condition_property_ambiguous' }))
  })

  it('rejects arbitrary expressions and undeclared branches', () => {
    expect(() =>
      evaluateConditionExpression({ expression: 'process.exit()', artifacts: {} })
    ).toThrow(ConditionExpressionError)
    expect(() =>
      selectConditionBranch({ expression: 'true', artifacts: {}, branches: { maybe: 'next' } })
    ).toThrow(expect.objectContaining({ code: 'condition_branch_unmatched' }))
  })
})
