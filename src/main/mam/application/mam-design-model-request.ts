import { z } from 'zod'
import { MamDesignModelResponseSchema } from '../../../shared/mam/design-proposal'
import type { MamDesignModelGatewayInput } from './mam-design-model-gateway'

export const MAM_DESIGN_RESPONSE_SCHEMA_NAME = 'mam_design_response'

export function buildDesignModelRequestBody(
  input: MamDesignModelGatewayInput,
  mode: 'schema' | 'json' = 'schema'
): Record<string, unknown> {
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: message.content
  }))
  if (input.provider.protocol === 'openai-responses') {
    return {
      model: input.model.remoteModelId,
      instructions: input.systemPrompt,
      input: messages,
      text: { format: mode === 'schema' ? openAiResponsesFormat() : { type: 'json_object' } },
      store: false
    }
  }
  if (input.provider.protocol === 'openai-completions') {
    return {
      model: input.model.remoteModelId,
      messages: [{ role: 'system', content: input.systemPrompt }, ...messages],
      response_format:
        mode === 'schema'
          ? { type: 'json_schema', json_schema: openAiChatSchema() }
          : { type: 'json_object' },
      store: false
    }
  }
  if (input.provider.protocol === 'anthropic-messages') {
    return {
      model: input.model.remoteModelId,
      max_tokens: outputTokenLimit(input, 16_000),
      system: input.systemPrompt,
      messages
    }
  }
  return {
    systemInstruction: { parts: [{ text: input.systemPrompt }] },
    contents: messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    })),
    generationConfig: {
      responseMimeType: 'application/json',
      ...(mode === 'schema' ? { responseJsonSchema: designResponseJsonSchema() } : {}),
      maxOutputTokens: outputTokenLimit(input, 16_000)
    }
  }
}

export function designResponseJsonSchema(): Record<string, unknown> {
  return sanitizeJsonSchema(
    z.toJSONSchema(MamDesignModelResponseSchema, { target: 'draft-7' })
  ) as Record<string, unknown>
}

function openAiResponsesFormat(): Record<string, unknown> {
  return {
    type: 'json_schema',
    ...openAiChatSchema()
  }
}

function openAiChatSchema(): Record<string, unknown> {
  return {
    name: MAM_DESIGN_RESPONSE_SCHEMA_NAME,
    strict: false,
    schema: designResponseJsonSchema()
  }
}

function outputTokenLimit(input: MamDesignModelGatewayInput, fallback: number): number {
  const configured = input.model.defaultInference?.maxOutputTokens
  return typeof configured === 'number' && Number.isInteger(configured) && configured > 0
    ? configured
    : fallback
}

function sanitizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeJsonSchema)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema' && key !== 'default')
      .map(([key, child]) => [key, sanitizeJsonSchema(child)])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
