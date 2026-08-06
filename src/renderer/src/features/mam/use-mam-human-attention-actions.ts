import { useCallback } from 'react'
import type {
  MamAnswerHumanQuestionsInput,
  MamConfirmHumanUnderstandingInput,
  MamResolveHumanReviewInput,
  MamReviseHumanUnderstandingInput
} from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { getMamRendererApi } from '../../renderer-api'

type ApplyAuthoritativeChange = (change: () => Promise<MamUiSnapshot>) => Promise<void>

export function useMamHumanAttentionActions(apply: ApplyAuthoritativeChange) {
  const answerHumanQuestions = useCallback(
    (input: MamAnswerHumanQuestionsInput) =>
      apply(() => getMamRendererApi().answerHumanQuestions(input)),
    [apply]
  )
  const confirmHumanUnderstanding = useCallback(
    (input: MamConfirmHumanUnderstandingInput) =>
      apply(() => getMamRendererApi().confirmHumanUnderstanding(input)),
    [apply]
  )
  const reviseHumanUnderstanding = useCallback(
    (input: MamReviseHumanUnderstandingInput) =>
      apply(() => getMamRendererApi().reviseHumanUnderstanding(input)),
    [apply]
  )
  const resolveHumanReview = useCallback(
    (input: MamResolveHumanReviewInput) =>
      apply(() => getMamRendererApi().resolveHumanReview(input)),
    [apply]
  )
  return {
    answerHumanQuestions,
    confirmHumanUnderstanding,
    reviseHumanUnderstanding,
    resolveHumanReview
  }
}
