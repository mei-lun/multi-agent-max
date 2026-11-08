const { build } = require('esbuild'),
  vm = require('node:vm'),
  assert = require('node:assert/strict')
;(async () => {
  const load = async (path) => {
    const r = await build({
      entryPoints: [path],
      bundle: true,
      write: false,
      format: 'cjs',
      platform: 'node'
    })
    const ctx = {
      module: { exports: {} },
      exports: {},
      crypto: globalThis.crypto,
      structuredClone,
      console,
      Buffer
    }
    vm.runInNewContext(r.outputFiles[0].text, ctx)
    return ctx.module.exports
  }
  const core = await load(
      __dirname + '/../../vendor/levelup/baseline-6542241/src/lib/constellation.ts'
    ),
    { createConstellationBusinessServices } = await load(__dirname + '/runtime-business.ts')
  const graph = core.createDefaultConstellationGraph()
  const image = graph.nodes.find((n) => n.data.kind === 'image')
  image.data.count = 2
  let calls = 0
  const checkpoints = []
  const service = createConstellationBusinessServices({
    listModels: () => [
      { id: 'image-profile', kind: 'image', modelId: 'gpt-image-1', operations: ['image.generate'] }
    ],
    assets: { read: async () => Buffer.from('input') },
    generation: (r) => ({
      validate() {},
      async run() {
        calls++
        assert.equal(r.operation, 'image.generate')
        assert.equal(r.params.count, 2)
        return {
          assets: [0, 1].map((i) => ({
            id: 'image-' + i,
            sha256: 'a'.repeat(64),
            bytes: 1,
            mime: 'image/png',
            filename: i + '.png'
          }))
        }
      }
    })
  })
  const request = { operation: 'constellation.graph.execute', params: { graph }, inputAssets: [] },
    context = {
      signal: new AbortController().signal,
      emit: async (type, data) => checkpoints.push(data)
    }
  const result = await service.handlers(request).run(request, context)
  assert.equal(calls, 1)
  assert.equal(result.failed.length, 0)
  assert.ok(result.waiting.includes(image.id))
  assert.equal(result.partial, true)
  assert.equal(
    result.graph.nodes.find((n) => n.id === image.id).data.outputCandidates.image.length,
    2
  )
  assert.ok(checkpoints.length >= 2)
  assert.notEqual(graph.nodes.find((n) => n.id === image.id).data.status, 'waiting')
  const selected = result.graph.nodes.find((n) => n.id === image.id)
  selected.data.outputs = { image: selected.data.outputCandidates.image[1] }
  selected.data.status = 'success'
  const resumed = { ...request, params: { graph: result.graph } }
  const continued = await service.handlers(resumed).run(resumed, context)
  assert.equal(calls, 1)
  assert.equal(continued.failed.length, 0)
  assert.equal(continued.waiting.length, 0)
  assert.equal(continued.partial, false)
  assert.equal(continued.outputs[0].asset.id, 'image-1')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() =>
    service.handlers(request).run(request, { ...context, signal: controller.signal })
  )
  assert.equal(calls, 1)
  const fileGraph = core.createDefaultConstellationGraph(),
    input = core.createConstellationNode('input', fileGraph.nodes[0].position),
    ability = fileGraph.nodes.find((n) => n.data.kind === 'image')
  input.id = fileGraph.nodes[0].id
  fileGraph.nodes[0] = input
  input.data.inputMode = 'file'
  input.data.inputPath = 'text-ref'
  const writing = core.createConstellationNode('writing', ability.position)
  writing.id = ability.id
  writing.data.prompt = 'Summarize source'
  fileGraph.nodes = fileGraph.nodes.map((n) => (n.id === ability.id ? writing : n))
  fileGraph.edges[0].sourceHandle = 'text'
  fileGraph.edges[0].targetHandle = 'context'
  fileGraph.edges[1].sourceHandle = 'text'
  const textRef = {
    id: 'text-ref',
    sha256: 'b'.repeat(64),
    bytes: 24,
    mime: 'text/plain',
    filename: 'original.txt'
  }
  let textPrompt = ''
  const textService = createConstellationBusinessServices({
    listModels: () => [{ id: 'text-profile', kind: 'text', modelId: 'text-model' }],
    assets: { read: async () => Buffer.from('ACTUAL ORIGINAL CONTENT') },
    generation: (r) => ({
      validate() {},
      async run() {
        textPrompt = r.params.prompt
        return { text: 'file summary' }
      }
    })
  })
  const fileRequest = { ...request, params: { graph: fileGraph }, inputAssets: [textRef] }
  const fileResult = await textService.handlers(fileRequest).run(fileRequest, context)
  assert.equal(fileResult.failed.length, 0)
  assert.ok(textPrompt.includes('ACTUAL ORIGINAL CONTENT'))
  assert.equal(fileResult.outputs[0].text, 'file summary')
  console.log(
    'PASS original graph scheduler/node execution; media count forwarding; durable candidates/checkpoints; no UI mount'
  )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
