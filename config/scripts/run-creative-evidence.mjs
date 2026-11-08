import { spawnSync } from 'node:child_process'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { evidenceBinding, evidenceMatches } from './creative-evidence-binding.mjs'
const scenarios = {
  lifecycle: ['verify-creative-desktop.mjs', 'creative-desktop-qa'],
  media: ['verify-media-desktop.mjs', 'media-desktop-qa'],
  video: ['verify-video-desktop.mjs', 'video-desktop-qa'],
  writing: ['verify-writing-desktop.mjs', 'writing-desktop-qa'],
  spine: ['verify-spine-desktop.mjs', 'spine-desktop-qa'],
  offscreen: ['verify-creative-offscreen.mjs', 'creative-offscreen'],
  packaged: ['verify-packaged-creative.mjs', 'packaged-creative-qa'],
  native: ['verify-native-workbenches.mjs', 'native-workbenches-qa'],
  graph: ['verify-graph-desktop.mjs', 'graph-desktop-qa']
}
const scenario = scenarios[process.argv[2]]
if (!scenario) throw Error(`Choose registered scenario: ${Object.keys(scenarios).join(', ')}`)
const before = await evidenceBinding(),
  started = Date.now()
const run = spawnSync(process.execPath, [`config/scripts/${scenario[0]}`], {
  stdio: 'inherit',
  env: process.env
})
const path = `.mam-local/${scenario[1]}/latest.json`
const result = JSON.parse(await readFile(path, 'utf8')),
  after = await evidenceBinding()
const fresh = (await stat(path)).mtimeMs >= started
const passed = fresh && run.status === 0 && result.passed === true && evidenceMatches(before, after)
await writeFile(
  path,
  JSON.stringify(
    {
      ...result,
      ...after,
      passed,
      evidenceRun: {
        scenario: process.argv[2],
        startedAt: new Date(started).toISOString(),
        fresh,
        sourceStable: evidenceMatches(before, after),
        exitCode: run.status
      }
    },
    null,
    2
  )
)
if (!passed) process.exitCode = 1
