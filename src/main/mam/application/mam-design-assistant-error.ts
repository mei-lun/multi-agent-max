export class MamDesignAssistantServiceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamDesignAssistantServiceError'
  }
}

export function failMamDesignAssistant(code: string, message: string): never {
  throw new MamDesignAssistantServiceError(code, message)
}
