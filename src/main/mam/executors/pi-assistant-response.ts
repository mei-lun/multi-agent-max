import { readFileSync } from 'node:fs'

export type PiAssistantResponseSelection =
  | Readonly<{ status: 'selected'; text: string; phase: 'final_answer' | 'legacy' }>
  | Readonly<{ status: 'missing' | 'ambiguous' | 'failed' }>

export class PiAssistantResponseSelector {
  private lastAssistantMessage: unknown

  observe(event: unknown): void {
    if (!isRecord(event) || event.type !== 'message_end') return
    if (!isAssistantMessage(event.message)) return
    this.lastAssistantMessage = event.message
  }

  observeSessionEntry(entry: unknown): void {
    if (!isRecord(entry) || entry.type !== 'message' || !isRecord(entry.message)) return
    if (entry.message.role === 'user') this.lastAssistantMessage = undefined
    else if (isAssistantMessage(entry.message)) this.lastAssistantMessage = entry.message
  }

  select(flattenedText?: string | null, requireCompleted = false): PiAssistantResponseSelection {
    const stopReason =
      isRecord(this.lastAssistantMessage) &&
      typeof this.lastAssistantMessage.stopReason === 'string'
        ? this.lastAssistantMessage.stopReason
        : undefined
    if (stopReason === 'error' || stopReason === 'aborted') return { status: 'failed' }
    if (requireCompleted && stopReason !== 'stop') return { status: 'missing' }
    const content =
      isRecord(this.lastAssistantMessage) && Array.isArray(this.lastAssistantMessage.content)
        ? this.lastAssistantMessage.content
        : []
    const textParts = content.flatMap((part) => textPart(part))
    const finalAnswers = textParts.filter((part) => part.phase === 'final_answer')
    if (finalAnswers.length > 0) {
      return {
        status: 'selected',
        text: finalAnswers.at(-1)!.text,
        phase: 'final_answer'
      }
    }
    if (textParts.some((part) => part.phase !== undefined)) return { status: 'missing' }
    const unclassified = textParts.filter((part) => part.phase === undefined)
    if (unclassified.length === 1) {
      return { status: 'selected', text: unclassified[0]!.text, phase: 'legacy' }
    }
    if (unclassified.length > 1) return { status: 'ambiguous' }
    if (flattenedText?.trim()) {
      return { status: 'selected', text: flattenedText.trim(), phase: 'legacy' }
    }
    return { status: 'missing' }
  }

  selectText(
    flattenedText: string | null,
    requireUnambiguous: boolean,
    onAmbiguous: () => never
  ): string | null {
    const selection = this.select(flattenedText)
    if (selection.status === 'ambiguous' && requireUnambiguous) onAmbiguous()
    return selection.status === 'selected' ? selection.text : null
  }
}

export function readPiSessionAssistantResponse(path: string): PiAssistantResponseSelection {
  const selector = new PiAssistantResponseSelector()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      selector.observeSessionEntry(JSON.parse(line))
    } catch {
      // A partial trailing line cannot replace the latest complete assistant message.
    }
  }
  return selector.select(undefined, true)
}

function textPart(value: unknown): readonly Readonly<{ text: string; phase?: string }>[] {
  if (!isRecord(value) || value.type !== 'text' || typeof value.text !== 'string') return []
  const text = value.text.trim()
  if (!text) return []
  const phase = responsePhase(value.textSignature)
  return [{ text, ...(phase ? { phase } : {}) }]
}

function responsePhase(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.phase === 'string') return value.phase
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) && typeof parsed.phase === 'string' ? parsed.phase : undefined
  } catch {
    return undefined
  }
}

function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.role === 'assistant'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
