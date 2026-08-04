import { describe, expect, it } from 'vitest'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import {
  automaticReviewArtifactContract,
  normalizePreparedReviewContracts
} from './automatic-review-contract'

describe('automatic Review contract', () => {
  it('replaces a generated Markdown handoff with the internal Review schema', () => {
    const contract = automaticReviewArtifactContract(
      ArtifactContractSchema.parse({
        schemaVersion: '1.0.0',
        artifactType: 'artifact.review-report',
        format: 'markdown',
        required: true,
        maxBytes: 100_000,
        requiredSections: ['summary']
      })
    )

    expect(contract).toMatchObject({ format: 'json-schema' })
    expect(() =>
      validateAndEncodeArtifactContent(contract, {
        status: 'approved',
        summary: 'The result meets the acceptance criteria.',
        findings: []
      })
    ).not.toThrow()
  })

  it('normalizes a frozen legacy contract again at the runner boundary', () => {
    const prepared = {
      task: {
        reviewTask: { id: 'review-task.legacy' },
        outputContracts: [
          ArtifactContractSchema.parse({
            schemaVersion: '1.0.0',
            artifactType: 'artifact.review-report',
            format: 'json-schema',
            required: true,
            maxBytes: 100_000,
            jsonSchema: { type: 'object', required: ['decision', 'issues'] }
          })
        ]
      }
    } as unknown as PreparedAttempt

    expect(normalizePreparedReviewContracts(prepared).task.outputContracts[0]).toMatchObject({
      jsonSchema: { required: ['status', 'summary'] }
    })
  })
})
