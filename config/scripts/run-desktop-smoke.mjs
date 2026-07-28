import { spawn } from 'node:child_process'
import { join } from 'node:path'

const executable = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
)
const child = spawn(executable, ['preview'], {
  cwd: process.cwd(),
  env: { ...process.env, MAM_DESKTOP_SMOKE: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
const timeout = setTimeout(() => {
  child.kill('SIGTERM')
}, 60_000)
child.once('error', (error) => {
  clearTimeout(timeout)
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
child.once('exit', (code) => {
  clearTimeout(timeout)
  process.exitCode = code ?? 1
})
