import { describe, expect, it } from 'vitest'
import { HumanQuestionBatchSchema } from './human-attention'

describe('Human attention contracts', () => {
  it('accepts up to five decision and information questions with explicit recommendations', () => {
    expect(
      HumanQuestionBatchSchema.parse({
        id: 'batch.one',
        title: 'Clarify deletion behavior',
        summary: 'The result depends on product decisions.',
        questions: [
          {
            id: 'question.deletion',
            kind: 'decision',
            question: 'How should deletion work?',
            whyItMatters: 'This changes storage and recovery behavior.',
            options: [
              { id: 'option.soft', label: 'Soft delete', description: 'Keep recoverable data.' },
              { id: 'option.hard', label: 'Hard delete', description: 'Remove data permanently.' }
            ],
            recommendedOptionId: 'option.soft',
            recommendationReason: 'It preserves recovery and audit evidence.'
          },
          {
            id: 'question.days',
            kind: 'information',
            question: 'How many days should data be retained?',
            whyItMatters: 'The value is a product fact.',
            options: []
          }
        ]
      }).questions
    ).toHaveLength(2)
  })

  it('rejects decision questions without 2-3 options and one recommendation', () => {
    const result = HumanQuestionBatchSchema.safeParse({
      id: 'batch.invalid',
      title: 'Invalid batch',
      summary: 'Missing alternatives.',
      questions: [
        {
          id: 'question.invalid',
          kind: 'decision',
          question: 'Choose?',
          whyItMatters: 'It changes the result.',
          options: [{ id: 'option.only', label: 'Only', description: 'No alternative.' }]
        }
      ]
    })
    expect(result.success).toBe(false)
  })
})
