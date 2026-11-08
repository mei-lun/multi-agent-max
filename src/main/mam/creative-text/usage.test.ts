import { test, expect } from 'vitest'
import { readUsage } from './usage'
test('usage maps actual API metadata without invented counts', () => {
  expect(readUsage({ response: { usage: { input_tokens: 12, output_tokens: 3 } } })).toEqual({
    inputTokens: 12,
    outputTokens: 3
  })
  expect(readUsage({ usage: { prompt_tokens: 7, completion_tokens: 2 } })).toEqual({
    inputTokens: 7,
    outputTokens: 2
  })
  expect(readUsage({ message: { usage: { input_tokens: 5 } } })).toEqual({ inputTokens: 5 })
  expect(readUsage({ usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 9 } })).toEqual({
    inputTokens: 4,
    outputTokens: 9
  })
  expect(readUsage({ usage: { input_tokens: -2 } })).toBeUndefined()
})
