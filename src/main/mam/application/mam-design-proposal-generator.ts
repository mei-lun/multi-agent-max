import type { MamDesignProposal } from '../../../shared/mam/design-assistant'
import type {
  MamDesignModelResponse,
  MamDesignProposalSpec
} from '../../../shared/mam/design-proposal'
import { MamDesignGenerationFailure, validationMessage } from './mam-design-generation-recovery'
import type { MamDesignModelGateway, MamDesignModelGatewayInput } from './mam-design-model-gateway'
import { parseMamDesignModelResponse } from './mam-design-response-normalizer'

export class MamDesignProposalGenerator {
  constructor(private readonly gateway: MamDesignModelGateway) {}

  async generate(
    input: MamDesignModelGatewayInput,
    materialize: (source: MamDesignProposalSpec) => MamDesignProposal
  ): Promise<{ response: MamDesignModelResponse; proposal: MamDesignProposal }> {
    const responseText = await this.gateway.generate(input)
    try {
      const response = parseMamDesignModelResponse(responseText)
      return { response, proposal: materialize(response.proposal) }
    } catch (cause) {
      throw generationFailure(cause)
    }
  }
}

function generationFailure(cause: unknown): MamDesignGenerationFailure {
  if (cause instanceof MamDesignGenerationFailure) return cause
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : 'design_model_response_invalid'
  return new MamDesignGenerationFailure(code, validationMessage(cause))
}
