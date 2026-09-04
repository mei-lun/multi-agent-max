import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MamLocalSettings } from '../../../shared/mam/local-settings'
import type { EncryptedLocalSecretStore } from '../application/encrypted-local-secret-store'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'

type Target = Readonly<{
  kind: 'skill' | 'mcp'
  id: string
  stagedVersion: number
  previousVersion?: number
}>

type TransactionState = Readonly<{
  schemaVersion: '1.0.0'
  settings: MamLocalSettings
  encryptedEntries: Readonly<Record<string, string>>
  targets: readonly Target[]
}>

export class CodexResourceImportTransaction {
  private readonly path: string

  constructor(
    path: string,
    private readonly profiles: Pick<ProfileCatalog, 'skills' | 'mcpServers'>,
    private readonly settings: MamLocalSettingsStore,
    private readonly secrets: EncryptedLocalSecretStore
  ) {
    this.path = resolve(path)
  }

  recover(): void {
    if (!existsSync(this.path)) return
    this.rollback(this.read())
  }

  begin(targets: readonly Target[]): void {
    this.recover()
    this.write({
      schemaVersion: '1.0.0',
      settings: this.settings.get(),
      encryptedEntries: this.secrets.captureEncryptedEntries(),
      targets
    })
  }

  commit(): void {
    this.removeJournal()
  }

  rollback(state = this.read()): void {
    for (const target of state.targets) {
      const registry = target.kind === 'skill' ? this.profiles.skills : this.profiles.mcpServers
      if (target.previousVersion) registry.activate(target.id, target.previousVersion)
      else registry.deactivate(target.id)
    }
    this.settings.save(state.settings)
    this.secrets.restoreEncryptedEntries(state.encryptedEntries)
    for (const target of state.targets) {
      const registry = target.kind === 'skill' ? this.profiles.skills : this.profiles.mcpServers
      registry.discardInactive(target.id, target.stagedVersion)
    }
    this.removeJournal()
  }

  private read(): TransactionState {
    return JSON.parse(readFileSync(this.path, 'utf8')) as TransactionState
  }

  private write(state: TransactionState): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporary, this.path)
  }

  private removeJournal(): void {
    try {
      unlinkSync(this.path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
