import { spawn } from 'node:child_process'
export async function approvedCommand(command: string, cwd: string, timeoutMs = 120000) {
  return new Promise<{ output: string; isError: boolean }>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = '',
      stderr = '',
      exceeded = false
    const kill = () => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => child.kill())
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill()
        }
      }
    }
    const timer = setTimeout(() => {
      exceeded = true
      kill()
    }, timeoutMs)
    const capture = (chunk: Buffer, error: boolean) => {
      const text = chunk
        .toString('utf8')
        .slice(0, Math.max(0, 120000 - stdout.length - stderr.length))
      if (error) stderr += text
      else stdout += text
      if (stdout.length + stderr.length >= 120000) {
        exceeded = true
        kill()
      }
    }
    child.stdout.on('data', (chunk) => capture(chunk, false))
    child.stderr.on('data', (chunk) => capture(chunk, true))
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ output: 'Approved command could not start', isError: true })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({
        output: `exit code: ${code ?? -1}\nstdout:\n${stdout}\nstderr:\n${stderr}${exceeded ? '\nCommand stopped: time or output limit reached' : ''}`,
        isError: exceeded
      })
    })
  })
}
