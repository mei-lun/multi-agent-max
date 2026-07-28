export class ValidationCommandSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationCommandSyntaxError'
  }
}

export type ParsedValidationCommand = Readonly<{
  executable: string
  arguments: readonly string[]
}>

export function parseValidationCommand(command: string): ParsedValidationCommand {
  const tokens: string[] = []
  let token = ''
  let tokenStarted = false
  let quote: 'single' | 'double' | undefined
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!
    if (quote === 'single') {
      if (character === "'") quote = undefined
      else token += character
      continue
    }
    if (character === "'") {
      quote = 'single'
      tokenStarted = true
      continue
    }
    if (character === '"') {
      quote = quote === 'double' ? undefined : 'double'
      tokenStarted = true
      continue
    }
    if (character === '\\') {
      const next = command[index + 1]
      if (next === undefined) throw new ValidationCommandSyntaxError('Trailing escape is invalid')
      if (/\s|["'\\]/.test(next)) {
        token += next
        index += 1
      } else {
        token += character
      }
      tokenStarted = true
      continue
    }
    if (/\s/.test(character) && quote === undefined) {
      if (tokenStarted) tokens.push(token)
      token = ''
      tokenStarted = false
      continue
    }
    token += character
    tokenStarted = true
  }
  if (quote) throw new ValidationCommandSyntaxError('Unterminated quote is invalid')
  if (tokenStarted) tokens.push(token)
  const [executable, ...arguments_] = tokens
  if (!executable) throw new ValidationCommandSyntaxError('Validation command is empty')
  return { executable, arguments: arguments_ }
}
