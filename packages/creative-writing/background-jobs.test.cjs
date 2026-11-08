const { build } = require('esbuild'),
  vm = require('node:vm'),
  assert = require('node:assert/strict')
;(async () => {
  const compiled = await build({
    entryPoints: [__dirname + '/background-jobs.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser'
  })
  const storage = new Map(),
    submissions = []
  let fail = true
  const request = async (r) => {
    if (r.action === 'submit') {
      submissions.push(r)
      return 'job-' + submissions.length
    }
    if (r.action === 'events')
      return fail
        ? [
            {
              sequence: 1,
              type: 'log',
              data: {
                type: 'writing_goal_checkpoint',
                project: { payload: { id: 'saved', completedSteps: 2 } }
              }
            },
            { sequence: 2, type: 'failed', data: { message: 'provider interrupted' } }
          ]
        : [{ sequence: 1, type: 'succeeded', data: { project: { payload: { id: 'finished' } } } }]
    throw Error(r.action)
  }
  const load = () => {
    const ctx = {
      module: { exports: {} },
      exports: {},
      window: { componentHost: { request } },
      localStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key)
      },
      crypto: globalThis.crypto,
      setTimeout
    }
    vm.runInNewContext(compiled.outputFiles[0].text, ctx)
    return ctx.module.exports
  }
  let api = load()
  await assert.rejects(
    () => api.runBackground('goal:p', 'writing.goal.execute', { project: { id: 'original' } }),
    /provider interrupted/
  )
  assert.equal(submissions.length, 1)
  api = load()
  assert.equal((await api.recoverBackground('goal:p')).project.payload.id, 'saved')
  assert.equal(submissions.length, 1)
  fail = false
  await api.runBackground('goal:p', 'writing.goal.execute', { project: { id: 'stale' } })
  assert.equal(submissions.length, 2)
  assert.equal(submissions[1].params.project.id, 'stale')
  storage.set(
    'mam.creative.background.goal:running',
    JSON.stringify({ jobId: 'existing', operation: 'writing.goal.execute' })
  )
  await api.runBackground('goal:running', 'writing.goal.execute', { project: {} })
  assert.equal(submissions.length, 2)
  const simultaneous = await Promise.all([
    api.runBackground('goal:double', 'writing.goal.execute', { project: { id: 'same' } }),
    api.runBackground('goal:double', 'writing.goal.execute', { project: { id: 'same' } })
  ])
  assert.equal(submissions.length, 3)
  assert.equal(simultaneous[0], simultaneous[1])
  console.log(
    'PASS durable Job handles; no remount resubmit; explicit checkpoint retry; running job reuse'
  )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
