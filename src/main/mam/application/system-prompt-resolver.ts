import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export class SystemPromptResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SystemPromptResolutionError'
  }
}

export function resolveSystemPrompt(reference: string, projectDirectory: string): string {
  if (reference.startsWith('inline:')) return requirePrompt(reference.slice('inline:'.length))
  if (!reference.startsWith('project-file:')) {
    throw new SystemPromptResolutionError(
      'system_prompt_unavailable',
      'System prompt references must use inline: or project-file:'
    )
  }
  const source = reference.slice('project-file:'.length)
  if (!source || isAbsolute(source)) {
    throw new SystemPromptResolutionError(
      'system_prompt_path_invalid',
      'Project prompt path must be relative'
    )
  }
  const root = resolve(projectDirectory)
  const path = resolve(root, source)
  const pathFromRoot = relative(root, path)
  if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new SystemPromptResolutionError(
      'system_prompt_path_invalid',
      'System prompt path is outside the project'
    )
  }
  try {
    return requirePrompt(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error instanceof SystemPromptResolutionError) throw error
    throw new SystemPromptResolutionError(
      'system_prompt_unavailable',
      `Cannot read system prompt: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export function withHumanInteractionPolicy(systemPrompt: string): string {
  return `${systemPrompt}\n\n${HUMAN_INTERACTION_POLICY}`
}

const HUMAN_INTERACTION_POLICY = `Human clarification is a native Task capability, not a required step for every Task. First inspect the Task, Artifacts, code, knowledge, and project rules. If the work is clear, proceed without calling mam_ask_user or mam_confirm_understanding. Do not guess when missing or conflicting information would materially change the result; in that case call mam_ask_user before changing the affected work. Ask at most five independent questions in one batch. Every decision question must have 2-3 materially different options, one recommended option, and a concise recommendation reason; factual questions use free text. Call mam_confirm_understanding only after mam_ask_user succeeded for the same interaction and returned user answers. After receiving answers, ask another batch if needed; otherwise submit a final understanding summary and wait for explicit user confirmation before continuing. If the summary returns unconfirmed with feedback, incorporate that feedback, ask another batch if needed, and submit a corrected summary. Never call the confirmation tool proactively, invent an answer, or continue because of a timeout.`

function requirePrompt(value: string): string {
  const prompt = value.trim()
  if (!prompt) {
    throw new SystemPromptResolutionError('system_prompt_empty', 'System prompt is empty')
  }
  return prompt
}
