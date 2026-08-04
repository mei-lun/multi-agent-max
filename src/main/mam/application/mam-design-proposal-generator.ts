import { randomUUID } from 'node:crypto'
import type { MamDesignMessage, MamDesignProposal } from '../../../shared/mam/design-assistant'
import type {
  MamDesignModelResponse,
  MamDesignProposalSpec
} from '../../../shared/mam/design-proposal'
import {
  designIssuesMessage,
  hasBlockingDesignIssues,
  MamDesignGenerationFailure,
  validationMessage
} from './mam-design-generation-recovery'
import type { MamDesignModelGateway, MamDesignModelGatewayInput } from './mam-design-model-gateway'
import { parseMamDesignModelResponse } from './mam-design-response-normalizer'

const MAX_GENERATION_ATTEMPTS = 3

export class MamDesignProposalGenerator {
  constructor(
    private readonly gateway: MamDesignModelGateway,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async generate(
    input: MamDesignModelGatewayInput,
    materialize: (source: MamDesignProposalSpec) => MamDesignProposal
  ): Promise<{ response: MamDesignModelResponse; proposal: MamDesignProposal }> {
    let responseText = await this.gateway.generate(input)
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      try {
        const response = parseMamDesignModelResponse(responseText)
        const proposal = materialize(response.proposal)
        if (hasBlockingDesignIssues(proposal.issues)) {
          throw new MamDesignGenerationFailure(
            'design_proposal_invalid',
            designIssuesMessage(proposal.issues),
            proposal.issues,
            proposal,
            attempt
          )
        }
        return { response, proposal }
      } catch (cause) {
        const failure = generationFailure(cause, attempt)
        if (attempt === MAX_GENERATION_ATTEMPTS) throw failure
        responseText = await this.gateway.generate({
          ...input,
          messages: repairMessages(input.messages, responseText, failure, this.now())
        })
      }
    }
    throw new MamDesignGenerationFailure(
      'design_model_response_invalid',
      'Model response could not be validated',
      [],
      undefined,
      MAX_GENERATION_ATTEMPTS
    )
  }
}

function repairMessages(
  messages: readonly MamDesignMessage[],
  responseText: string,
  failure: MamDesignGenerationFailure,
  createdAt: string
): MamDesignMessage[] {
  const issues = JSON.stringify(failure.issues.slice(0, 10)).slice(0, 6_000)
  const repairPrompt = `Repair the complete proposal. Validation errors: ${issues}. ${failure.message} Return one complete JSON object with message and proposal.`
  return appendMessages(
    messages,
    message('assistant', responseText.slice(0, 20_000), 'invalid', createdAt),
    message('user', repairPrompt.slice(0, 20_000), 'repair', createdAt)
  )
}

function generationFailure(cause: unknown, attempt: number): MamDesignGenerationFailure {
  if (cause instanceof MamDesignGenerationFailure) return cause
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : 'design_model_response_invalid'
  return new MamDesignGenerationFailure(code, validationMessage(cause), [], undefined, attempt)
}

function message(
  role: MamDesignMessage['role'],
  content: string,
  purpose: string,
  createdAt: string
): MamDesignMessage {
  return {
    id: `design-message.${purpose}.${randomUUID().replaceAll('-', '')}`,
    role,
    content,
    createdAt
  }
}

function appendMessages(
  messages: readonly MamDesignMessage[],
  ...next: readonly MamDesignMessage[]
): MamDesignMessage[] {
  return [...messages, ...next].slice(-200)
}
