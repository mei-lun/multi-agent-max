export class MamUiCommandServiceError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamUiCommandServiceError'
  }
}

export function makeMamUiCommandError(code: string, message: string): MamUiCommandServiceError {
  return new MamUiCommandServiceError(code, message)
}
