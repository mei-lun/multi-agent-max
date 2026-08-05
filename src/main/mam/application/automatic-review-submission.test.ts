import { describe, expect, it } from 'vitest'
import type { ValidatedAttemptArtifacts } from './attempt-artifact-validator'
import { automaticReviewSubmission } from './automatic-review-submission'
import type { PreparedAttempt } from './mam-attempt-execution-types'

describe('automatic Review submission', () => {
  it('converts a validated Review report into a Review command request', () => {
    const prepared = {
      workflowRunId: 'run.review',
      taskId: 'review-task.1',
      attemptId: 'attempt.review.1',
      task: { reviewTask: { id: 'review-task.1' } }
    } as unknown as PreparedAttempt
    const validated = {
      records: [
        {
          content: {
            status: 'approved',
            summary: 'All acceptance criteria pass.',
            findings: []
          }
        }
      ]
    } as unknown as ValidatedAttemptArtifacts

    expect(automaticReviewSubmission(prepared, validated)).toEqual({
      workflowRunId: 'run.review',
      reviewerTaskId: 'review-task.1',
      reviewerAttemptId: 'attempt.review.1',
      status: 'approved',
      summary: 'All acceptance criteria pass.',
      findings: []
    })
  })

  it('rejects changes requested without actionable findings', () => {
    const prepared = {
      workflowRunId: 'run.review',
      taskId: 'review-task.1',
      attemptId: 'attempt.review.1',
      task: { reviewTask: { id: 'review-task.1' } }
    } as unknown as PreparedAttempt
    const validated = {
      records: [{ content: { status: 'changes_requested', summary: 'Needs work.', findings: [] } }]
    } as unknown as ValidatedAttemptArtifacts

    expect(automaticReviewSubmission(prepared, validated)).toBeUndefined()
  })

  it('turns an actionable structured summary into a finding', () => {
    expect(
      automaticReviewSubmission(
        preparedReview(),
        validatedReview({
          status: 'changes_requested',
          summary: 'Empty input has no validation message.',
          findings: []
        })
      )
    ).toMatchObject({
      status: 'changes_requested',
      findings: [expect.objectContaining({ summary: 'Empty input has no validation message.' })]
    })
  })

  it('normalizes an approved Chinese Markdown Review without user formatting', () => {
    expect(
      automaticReviewSubmission(
        preparedReview(),
        validatedReview('## 审核结论\n\n审核通过，页面符合设计规范，未发现阻塞问题。')
      )
    ).toMatchObject({
      status: 'approved',
      findings: []
    })
  })

  it('turns actionable Markdown change bullets into structured findings', () => {
    expect(
      automaticReviewSubmission(
        preparedReview(),
        validatedReview('审核不通过，需要修改：\n- 输入为空时缺少校验提示\n- 键盘回车无法提交猜测')
      )
    ).toMatchObject({
      status: 'changes_requested',
      findings: [
        expect.objectContaining({ category: 'validation', summary: '输入为空时缺少校验提示' }),
        expect.objectContaining({ summary: '键盘回车无法提交猜测' })
      ]
    })
  })

  it('accepts common decision and issues aliases from a Review Role', () => {
    expect(
      automaticReviewSubmission(
        preparedReview(),
        validatedReview({
          decision: 'request changes',
          conclusion: 'Input handling needs changes.',
          issues: ['Empty input has no validation message.']
        })
      )
    ).toMatchObject({
      status: 'changes_requested',
      findings: [expect.objectContaining({ summary: 'Empty input has no validation message.' })]
    })
  })

  it('normalizes localized structured finding categories to internal IDs', () => {
    expect(
      automaticReviewSubmission(
        preparedReview(),
        validatedReview({
          status: 'changes_requested',
          summary: '需要修改。',
          findings: [
            {
              severity: 'blocker',
              category: '输入校验与计数',
              summary: '空白输入不应增加猜测次数。'
            },
            {
              severity: 'high',
              category: '安全与依赖',
              summary: '不得加载远程脚本。'
            }
          ]
        })
      )
    ).toMatchObject({
      status: 'changes_requested',
      findings: [{ category: 'validation' }, { category: 'security' }]
    })
  })
})

function preparedReview(): PreparedAttempt {
  return {
    workflowRunId: 'run.review',
    taskId: 'review-task.1',
    attemptId: 'attempt.review.1',
    task: { reviewTask: { id: 'review-task.1' } }
  } as unknown as PreparedAttempt
}

function validatedReview(content: unknown): ValidatedAttemptArtifacts {
  return { records: [{ content }] } as unknown as ValidatedAttemptArtifacts
}
