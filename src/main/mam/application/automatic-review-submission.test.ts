import { describe, expect, it, vi } from 'vitest'
import type { ValidatedAttemptArtifacts } from './attempt-artifact-validator'
import {
  automaticReviewSubmission,
  publishAutomaticReviewSubmission
} from './automatic-review-submission'
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

  it('supersedes an automatic Review after its subject has been replaced', () => {
    const request = automaticReviewSubmission(
      preparedReview(),
      validatedReview({ status: 'approved', summary: 'The old result is valid.', findings: [] })
    )
    const repository = {
      rebuild: () => ({
        reviewTasks: {
          'review-task.1': {
            subject: { taskId: 'task.source', attemptId: 'attempt.old' }
          }
        },
        tasks: {
          'task.source': {
            status: 'running',
            selectedAttemptId: 'attempt.old',
            knownAttemptIds: ['attempt.old', 'attempt.new']
          }
        },
        attempts: {
          'attempt.old': { status: 'submitted' },
          'attempt.new': { status: 'running' }
        },
        reviewAggregations: {}
      })
    }

    expect(
      publishAutomaticReviewSubmission({
        request,
        repository: repository as never,
        schedulerId: 'scheduler.desktop',
        nextCommandId: () => 'command.review',
        now: () => '2026-09-14T08:00:00Z'
      })
    ).toBe('superseded')
  })

  it('does not supersede a later Review gate that shares the same subject', () => {
    const request = automaticReviewSubmission(
      preparedReview(),
      validatedReview({ status: 'approved', summary: 'The result is valid.', findings: [] })
    )
    const subject = { taskId: 'task.source', attemptId: 'attempt.source' }
    const repository = {
      rebuild: () => ({
        reviewTasks: {
          'review-task.1': { reviewNodeId: 'review.second', subject }
        },
        tasks: {
          'task.source': {
            status: 'in_review',
            selectedAttemptId: 'attempt.source',
            knownAttemptIds: ['attempt.source']
          }
        },
        attempts: { 'attempt.source': { status: 'submitted' } },
        reviewAggregations: {
          'aggregation.first': { reviewNodeId: 'review.first', subject }
        }
      })
    }

    const publish = vi.fn()
    expect(
      publishAutomaticReviewSubmission(
        {
          request,
          repository: repository as never,
          schedulerId: 'scheduler.desktop',
          nextCommandId: () => 'command.review',
          now: () => '2026-09-14T08:00:00Z'
        },
        publish
      )
    ).toBe('submitted')
    expect(publish).toHaveBeenCalledOnce()
  })

  it('rechecks the frozen subject after an aggregation publication race', () => {
    const request = automaticReviewSubmission(
      preparedReview(),
      validatedReview({ status: 'approved', summary: 'The result is valid.', findings: [] })
    )
    const subject = { taskId: 'task.source', attemptId: 'attempt.source' }
    let replaced = false
    const repository = {
      rebuild: () => ({
        reviewTasks: { 'review-task.1': { reviewNodeId: 'review.current', subject } },
        tasks: {
          'task.source': replaced
            ? {
                status: 'submitted',
                selectedAttemptId: 'attempt.replacement',
                knownAttemptIds: ['attempt.source', 'attempt.replacement']
              }
            : {
                status: 'in_review',
                selectedAttemptId: 'attempt.source',
                knownAttemptIds: ['attempt.source']
              }
        },
        attempts: {
          'attempt.source': { status: 'submitted' },
          'attempt.replacement': { status: 'submitted' }
        },
        reviewAggregations: {}
      })
    }
    const publish = () => {
      replaced = true
      throw Object.assign(new Error('Task is no longer collecting Reviews'), {
        code: 'review_not_collecting'
      })
    }

    expect(
      publishAutomaticReviewSubmission(
        {
          request,
          repository: repository as never,
          schedulerId: 'scheduler.desktop',
          nextCommandId: () => 'command.review',
          now: () => '2026-09-14T08:00:00Z'
        },
        publish
      )
    ).toBe('superseded')
  })

  it('rechecks the frozen subject after a non-throwing publication race', () => {
    const request = automaticReviewSubmission(
      preparedReview(),
      validatedReview({ status: 'approved', summary: 'The result is valid.', findings: [] })
    )
    const subject = { taskId: 'task.source', attemptId: 'attempt.source' }
    let replaced = false
    const repository = {
      rebuild: () => ({
        reviewTasks: { 'review-task.1': { reviewNodeId: 'review.current', subject } },
        tasks: {
          'task.source': {
            status: replaced ? 'submitted' : 'in_review',
            selectedAttemptId: replaced ? 'attempt.replacement' : 'attempt.source',
            knownAttemptIds: replaced
              ? ['attempt.source', 'attempt.replacement']
              : ['attempt.source']
          }
        },
        attempts: {
          'attempt.source': { status: 'submitted' },
          'attempt.replacement': { status: 'submitted' }
        },
        reviewAggregations: replaced
          ? { 'aggregation.old': { reviewNodeId: 'review.current', subject } }
          : {}
      })
    }

    expect(
      publishAutomaticReviewSubmission(
        {
          request,
          repository: repository as never,
          schedulerId: 'scheduler.desktop',
          nextCommandId: () => 'command.review',
          now: () => '2026-09-14T08:00:00Z'
        },
        () => {
          replaced = true
        }
      )
    ).toBe('superseded')
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
