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

function requirePrompt(value: string): string {
  const prompt = value.trim()
  if (!prompt) {
    throw new SystemPromptResolutionError('system_prompt_empty', 'System prompt is empty')
  }
  return prompt
}
