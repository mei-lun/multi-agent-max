export function installComponentQuitGuard(options: {
  app: {
    on(name: 'before-quit', callback: (event: { preventDefault(): void }) => void): unknown
    quit(): void
  }
  closeAll(): Promise<boolean>
  cleanup(): Promise<void>
  release(): Promise<void>
  report(error: unknown): void
}) {
  let closing = false,
    approved = false
  options.app.on('before-quit', (event) => {
    if (approved) return
    event.preventDefault()
    if (closing) return
    closing = true
    void (async () => {
      if (!(await options.closeAll())) return
      await options.cleanup()
      await options.release()
      approved = true
      options.app.quit()
    })()
      .catch(options.report)
      .finally(() => {
        closing = false
      })
  })
}
