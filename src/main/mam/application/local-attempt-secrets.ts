import type { LocalSecretBinding } from '../../../shared/mam/domain/execution-profile'

export type AttemptSecretValueProvider = Readonly<{
  resolve(binding: LocalSecretBinding): string | undefined
}>

export class EnvironmentAttemptSecretValueProvider implements AttemptSecretValueProvider {
  resolve(binding: LocalSecretBinding): string | undefined {
    return process.env[attemptSecretEnvironmentName(binding.id)]
  }
}

export class ChainedAttemptSecretValueProvider implements AttemptSecretValueProvider {
  constructor(private readonly providers: readonly AttemptSecretValueProvider[]) {}

  resolve(binding: LocalSecretBinding): string | undefined {
    for (const provider of this.providers) {
      const value = provider.resolve(binding)
      if (value) return value
    }
    return undefined
  }
}

export function attemptSecretEnvironmentName(bindingId: string): string {
  return `MAM_SECRET_${bindingId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`
}
