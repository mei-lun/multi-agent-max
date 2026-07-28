import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MamLocalSettingsSchema,
  defaultMamLocalSettings,
  type MamLocalSettings
} from '../../../shared/mam/local-settings'
import type { MamLocalSkillBinding } from '../../../shared/mam/domain/skill-definition'

export class MamLocalSettingsStore {
  private readonly path: string

  constructor(
    path: string,
    private readonly bindingIdentity = 'machine.local'
  ) {
    this.path = resolve(path)
  }

  get(): MamLocalSettings {
    if (!existsSync(this.path)) return defaultMamLocalSettings(this.bindingIdentity)
    return MamLocalSettingsSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
  }

  save(input: unknown): MamLocalSettings {
    const settings = MamLocalSettingsSchema.parse(input)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporaryPath, this.path)
    return structuredClone(settings)
  }

  upsertSkillBinding(binding: MamLocalSkillBinding): MamLocalSettings {
    const current = this.get()
    return this.save({
      ...current,
      skillBindings: [
        ...current.skillBindings.filter((candidate) => candidate.skillId !== binding.skillId),
        binding
      ]
    })
  }
}
