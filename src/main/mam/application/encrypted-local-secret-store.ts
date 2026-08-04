import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import type { LocalSecretBinding } from '../../../shared/mam/domain/execution-profile'
import type { AttemptSecretValueProvider } from './local-attempt-secrets'

const SecretFileSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    entries: z.record(z.string(), z.string())
  })
  .strict()

export type LocalSecretCodec = Readonly<{
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}>

export class EncryptedLocalSecretStore implements AttemptSecretValueProvider {
  private readonly path: string

  constructor(
    path: string,
    private readonly codec: LocalSecretCodec
  ) {
    this.path = resolve(path)
  }

  save(secretRef: string, value: string): void {
    const entries = this.readEntries()
    entries[secretRef] = this.codec.encrypt(value).toString('base64')
    this.writeEntries(entries)
  }

  resolve(binding: LocalSecretBinding): string | undefined {
    return this.resolveSecret(binding.secretRef)
  }

  resolveSecret(secretRef: string): string | undefined {
    const encoded = this.readEntries()[secretRef]
    return encoded ? this.codec.decrypt(Buffer.from(encoded, 'base64')) : undefined
  }

  listConfigured(): readonly string[] {
    return Object.keys(this.readEntries()).sort((left, right) => left.localeCompare(right))
  }

  private readEntries(): Record<string, string> {
    if (!existsSync(this.path)) return {}
    return { ...SecretFileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8'))).entries }
  }

  private writeEntries(entries: Readonly<Record<string, string>>): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: '1.0.0', entries }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    )
    renameSync(temporaryPath, this.path)
  }
}
