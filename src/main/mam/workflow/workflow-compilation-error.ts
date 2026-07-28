export class WorkflowCompilationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'WorkflowCompilationError'
  }
}
