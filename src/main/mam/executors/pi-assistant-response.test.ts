import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PiAssistantResponseSelector,
  readPiSessionAssistantResponse
} from './pi-assistant-response'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('Pi assistant response selection', () => {
  it('selects final_answer without concatenating commentary', () => {
    const selector = new PiAssistantResponseSelector()
    selector.observe(
      assistantMessage([
        textPart('Reviewing the files now.', 'commentary'),
        textPart('{"status":"approved","summary":"Ready","findings":[]}', 'final_answer')
      ])
    )

    expect(selector.select('Reviewing the files now.\n{"status":"approved"}')).toEqual({
      status: 'selected',
      text: '{"status":"approved","summary":"Ready","findings":[]}',
      phase: 'final_answer'
    })
  })

  it('keeps one unclassified response compatible with older providers', () => {
    const selector = new PiAssistantResponseSelector()
    selector.observe(assistantMessage([{ type: 'text', text: '# Review\n\nApproved.' }]))

    expect(selector.select('# flattened')).toEqual({
      status: 'selected',
      text: '# Review\n\nApproved.',
      phase: 'legacy'
    })
  })

  it('rejects multiple unclassified text parts instead of guessing', () => {
    const selector = new PiAssistantResponseSelector()
    selector.observe(
      assistantMessage([
        { type: 'text', text: 'First candidate.' },
        { type: 'text', text: 'Second candidate.' }
      ])
    )

    expect(selector.select('First candidate.\nSecond candidate.')).toEqual({ status: 'ambiguous' })
  })

  it('does not treat classified commentary as a legacy deliverable', () => {
    const selector = new PiAssistantResponseSelector()
    selector.observe(assistantMessage([textPart('Still working.', 'commentary')]))

    expect(selector.select('Still working.')).toEqual({ status: 'missing' })
  })

  it('does not accept an unclassified part when the message also has phase metadata', () => {
    const selector = new PiAssistantResponseSelector()
    selector.observe(
      assistantMessage([
        textPart('Still working.', 'commentary'),
        { type: 'text', text: '{"status":"approved"}' }
      ])
    )

    expect(selector.select('Still working.\n{"status":"approved"}')).toEqual({
      status: 'missing'
    })
  })

  it('rejects a final answer from an aborted assistant response', () => {
    const selector = new PiAssistantResponseSelector()
    selector.observe({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'aborted',
        content: [textPart('{"status":"approved"}', 'final_answer')]
      }
    })

    expect(selector.select()).toEqual({ status: 'failed' })
  })

  it('recovers the final answer from a persisted Pi session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mam-pi-response-'))
    directories.push(directory)
    const path = join(directory, 'session.jsonl')
    await writeFile(
      path,
      `${JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [
            textPart('Still reviewing.', 'commentary'),
            textPart('审核不通过。\n- 输入为空时缺少提示', 'final_answer')
          ]
        }
      })}\n`,
      'utf8'
    )

    expect(readPiSessionAssistantResponse(path)).toEqual({
      status: 'selected',
      text: '审核不通过。\n- 输入为空时缺少提示',
      phase: 'final_answer'
    })
  })

  it('does not reuse a final answer from before the latest user turn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mam-pi-response-'))
    directories.push(directory)
    const path = join(directory, 'session.jsonl')
    await writeFile(
      path,
      [
        JSON.stringify({
          type: 'message',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [textPart('{"status":"approved"}', 'final_answer')]
          }
        }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: [] } })
      ].join('\n'),
      'utf8'
    )

    expect(readPiSessionAssistantResponse(path)).toEqual({ status: 'missing' })
  })
})

function assistantMessage(content: readonly unknown[]) {
  return { type: 'message_end', message: { role: 'assistant', content } }
}

function textPart(text: string, phase: 'commentary' | 'final_answer') {
  return {
    type: 'text',
    text,
    textSignature: JSON.stringify({ version: 1, phase })
  }
}
