import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
for (const mode of ['image', 'audio', 'video', 'writing', 'localTool', 'file']) {
  const env = { ...process.env, CONSTELLATION_QA_KIND: mode }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    require('electron'),
    [
      fileURLToPath(
        new URL('../../packages/creative-constellation/executor-qa.cjs', import.meta.url)
      )
    ],
    { env, windowsHide: true, stdio: 'inherit' }
  )
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', resolve)
  })
  if (code !== 0) throw Error(`Executor fixture failed: ${mode}`)
}
