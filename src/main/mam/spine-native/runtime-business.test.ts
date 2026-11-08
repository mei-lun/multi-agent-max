import { test, expect, beforeAll, afterAll } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
type Project = { parts: unknown[]; [key: string]: unknown }
let createSpineBusiness: () => (
  operation: string,
  params: Record<string, unknown>
) => Promise<unknown>
let newSpineProject: (name?: string) => Project
let createSpinePart: (name: string, image: string, width: number, height: number) => unknown
let compileSpineProject: (project: Project) => unknown
let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'spine-business-'))
  const file = join(directory, 'business.mjs')
  await build({
    stdin: {
      contents: `export { createSpineBusiness } from './packages/creative-spine/runtime-business'; export { newSpineProject, createSpinePart, compileSpineProject } from './vendor/levelup/baseline-6542241/src/lib/spine';`,
      resolveDir: process.cwd(),
      loader: 'ts'
    },
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'esm'
  })
  ;({ createSpineBusiness, newSpineProject, createSpinePart, compileSpineProject } = await import(
    pathToFileURL(file).href
  ))
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('project roundtrip and generated animation use original core compilation', async () => {
  const run = createSpineBusiness()
  const project = newSpineProject('roundtrip')
  project.parts.push(
    createSpinePart(
      'body',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      1,
      1
    )
  )
  const normalized = await run('spine.project.normalize', { project })
  expect(await run('spine.project.compile', { project: normalized })).toEqual(
    compileSpineProject(project)
  )
  const generated = (await run('spine.animation.generate', { project, preset: 'walk' })) as {
    project: Project
    clip: { id: string }
  }
  const pose = await run('spine.pose.capture', {
    project: generated.project,
    clipId: generated.clip.id,
    time: 0.5
  })
  expect(pose).toMatchObject({ time: 0.5, targets: {} })
  await expect(run('spine.animation.generate', { project, preset: 'invalid' })).rejects.toThrow()
})

test('archive export requires real renderer, never returns a fake archive', async () => {
  await expect(
    createSpineBusiness()('spine.export', { project: newSpineProject() })
  ).rejects.toThrow('renderer unavailable')
})
