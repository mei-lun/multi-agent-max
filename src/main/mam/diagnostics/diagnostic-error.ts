export function diagnosticError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) }
  const fields = error as Error & { code?: unknown; exitCode?: unknown; stderr?: unknown }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: fields.code,
    exitCode: fields.exitCode,
    stderr: fields.stderr,
    ...(error.cause !== undefined && depth < 3
      ? { cause: diagnosticError(error.cause, depth + 1) }
      : {})
  }
}
