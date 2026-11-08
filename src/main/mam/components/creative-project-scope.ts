import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

export function creativeProjectScope(directory: string): string {
  const path = resolve(directory)
  return `project:${createHash('sha256')
    .update(process.platform === 'win32' ? path.toLowerCase() : path)
    .digest('hex')}`
}
