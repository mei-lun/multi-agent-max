import { describe, expect, it } from 'vitest'
import { parseValidationCommand } from './validation-command-parser'

describe('validation command parser', () => {
  it('parses quoted arguments without enabling shell operators', () => {
    expect(parseValidationCommand('node -e "console.log(1)" ""')).toEqual({
      executable: 'node',
      arguments: ['-e', 'console.log(1)', '']
    })
  })

  it('preserves Windows path separators', () => {
    expect(parseValidationCommand('"C:\\Program Files\\node.exe" --version')).toEqual({
      executable: 'C:\\Program Files\\node.exe',
      arguments: ['--version']
    })
  })

  it('rejects incomplete syntax', () => {
    expect(() => parseValidationCommand('node "unterminated')).toThrow('Unterminated quote')
    expect(() => parseValidationCommand('   ')).toThrow('empty')
  })
})
