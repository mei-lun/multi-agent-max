export class LocalTaskExecutionRegistry<T> {
  private readonly executions = new Map<string, Promise<T>>()

  getOrCreate(key: string, create: () => Promise<T>): Promise<T> {
    const existing = this.executions.get(key)
    if (existing) return existing
    const created = create()
    this.executions.set(key, created)
    return created
  }

  release(key: string): void {
    this.executions.delete(key)
  }
}
