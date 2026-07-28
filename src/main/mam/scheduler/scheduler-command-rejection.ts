export class SchedulerCommandRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SchedulerCommandRejectedError'
  }
}
