import { lstatSync, type Stats } from 'node:fs'
import { lstat } from 'node:fs/promises'
const verified = new Map<string, string>()
export const binaryIdentity = (stat: Stats) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
export async function rememberBinary(path: string, before: string) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile() || binaryIdentity(stat) !== before)
    throw new Error('Binary changed during verification')
  verified.set(path, before)
}
export function requireVerifiedBinary(path: string, bytes: number) {
  const stat = lstatSync(path)
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size !== bytes ||
    verified.get(path) !== binaryIdentity(stat)
  ) {
    verified.delete(path)
    throw new Error('binary_artifact_verification_pending')
  }
}
