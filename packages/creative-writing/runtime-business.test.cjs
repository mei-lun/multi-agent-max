const { build } = require('esbuild'),
  vm = require('node:vm'),
  assert = require('node:assert/strict')
;(async () => {
  const bundle = async (entry) => {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node'
    })
    const sandbox = {
      module: { exports: {} },
      exports: {},
      crypto: globalThis.crypto,
      structuredClone,
      console,
      Buffer
    }
    vm.runInNewContext(result.outputFiles[0].text, sandbox)
    return sandbox.module.exports
  }
  const core = await bundle(__dirname + '/../../vendor/levelup/baseline-6542241/src/lib/writing.ts')
  const { createWritingBusinessServices } = await bundle(__dirname + '/runtime-business.ts')
  const project = core.createWritingProject(),
    goal = core.createWritingGoal(project.activeDocumentId)
  goal.mode = 'director'
  goal.plan = core.createDefaultWritingGoalPlan(goal).slice(0, 2)
  project.goals = [goal]
  const prompts = [],
    events = []
  const services = createWritingBusinessServices({
    generation: (r) => ({
      validate() {},
      async run() {
        prompts.push(r.params.prompt)
        return { text: prompts.length === 1 ? 'Facts from original context' : 'New outline result' }
      }
    })
  })
  const request = {
    operation: 'writing.goal.execute',
    params: { project, goalId: goal.id, modelProfileId: 'fixture', approved: true },
    inputAssets: []
  }
  const context = {
    signal: new AbortController().signal,
    emit: async (type, data) => events.push({ type, data })
  }
  const handler = services.handlers(request),
    result = await handler.run(request, context)
  assert.equal(events.length, 2)
  assert.equal(result.project.payload.goals[0].status, 'completed')
  assert.ok(prompts[1].includes('Facts from original context'))
  assert.ok(result.project.payload.documents.some((d) => d.content === 'New outline result'))
  assert.equal(project.goals[0].plan[0].status, 'pending')
  const resumed = { ...request, params: { ...request.params, project: result.project.payload } }
  await services.handlers(resumed).run(resumed, context)
  assert.equal(prompts.length, 2)
  assert.throws(
    () => services.handlers({ ...request, params: { ...request.params, approved: false } }),
    /approval/
  )
  let exported
  const exportServices = createWritingBusinessServices({
    generation: () => undefined,
    assets: {
      async import(source, metadata) {
        const chunks = []
        for await (const chunk of source) chunks.push(chunk)
        exported = { text: Buffer.concat(chunks).toString('utf8'), metadata }
        return { id: 'exported' }
      }
    }
  })
  const exportRequest = {
    ...request,
    operation: 'writing.project.export',
    params: { project: result.project.payload, format: 'markdown' }
  }
  const exportResult = await exportServices.handlers(exportRequest).run(exportRequest, context)
  assert.equal(exportResult.assets[0].id, 'exported')
  assert.ok(exported.text.includes('New outline result'))
  assert.equal(exported.metadata.filename, 'writing.md')
  const partner = core.createWritingProject(),
    partnerGoal = core.createWritingGoal(partner.activeDocumentId)
  partnerGoal.mode = 'partner'
  partnerGoal.plan = core.createDefaultWritingGoalPlan(partnerGoal).slice(0, 1)
  partner.goals = [partnerGoal]
  const partnerRequest = {
    ...request,
    params: { ...request.params, project: partner, goalId: partnerGoal.id }
  }
  const review = await services.handlers(partnerRequest).run(partnerRequest, context)
  assert.equal(review.project.payload.goals[0].plan[0].status, 'review')
  assert.equal(partner.documents[0].content, review.project.payload.documents[0].content)
  const count = prompts.length
  const applyReview = {
    ...partnerRequest,
    params: { ...partnerRequest.params, project: review.project.payload, automatic: true }
  }
  const applied = await services.handlers(applyReview).run(applyReview, context)
  assert.equal(applied.project.payload.goals[0].plan[0].status, 'completed')
  assert.equal(prompts.length, count)
  console.log(
    'PASS original Goal context/prompts/apply; durable checkpoints; resume skips completed; approval gate'
  )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
