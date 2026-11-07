import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url),
  env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(
  require('electron'),
  [fileURLToPath(new URL('../../packages/creative-speech/native-qa.cjs', import.meta.url))],
  { env, windowsHide: true, stdio: 'inherit' }
)
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
