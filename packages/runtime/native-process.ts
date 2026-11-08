import * as childProcess from 'child_process'
function track(child: childProcess.ChildProcess) {
  if (child.pid && process.connected)
    process.send!({ type: 'descendant', id: String(child.pid), value: child.pid })
  child.once('close', () => {
    if (child.pid && process.connected)
      process.send!({ type: 'descendant-exit', id: String(child.pid), value: child.pid })
  })
  return child
}
export const execFile = ((...args: Parameters<typeof childProcess.execFile>) =>
  track(childProcess.execFile(...args))) as typeof childProcess.execFile
export const spawn: typeof childProcess.spawn = ((
  ...args: Parameters<typeof childProcess.spawn>
) => {
  const child = childProcess.spawn(...args)
  return track(child)
}) as typeof childProcess.spawn
