import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { creativeBackgroundUiPlugin } from './creative-background-ui-patches.mjs'
test('actual transformed Goal handler saves exact returned document before acknowledgement and retains failure', async () => {
  let load
  creativeBackgroundUiPlugin(process.cwd()).setup({
    onLoad: (_options, callback) => {
      load = callback
    }
  })
  const transformed = await load({
    path: path.resolve('vendor/levelup/baseline-6542241/src/components/WritingStudio.tsx')
  })
  const source = transformed.contents
  const start = source.indexOf("const key='goal:'+project.id;"),
    end = source.indexOf('return next||undefined', start)
  const block = source.slice(start, end)
  const clean = block.slice(block.indexOf('try{') + 4)
  const execute = new Function(
    'project',
    'goalId',
    'operation',
    'extra',
    'writingRunProfile',
    'selectedContextIds',
    'selectedReferenceContextIds',
    'mamRunBackground',
    'projectFromRecord',
    'commitGoalProject',
    'enqueueProjectSaves',
    'mamAcknowledgeBackground',
    `return (async()=>{const key='goal:'+project.id;${clean}})()`
  )
  const exact = { id: 'p', documents: [{ content: 'returned text' }] },
    calls = []
  const args = [
    { id: 'p' },
    'g',
    'writing.goal.execute',
    {},
    { id: 'model' },
    [],
    [],
    async () => ({ project: exact }),
    (record) => record,
    (next) => calls.push(['commit', next])
  ]
  let release
  const save = new Promise((resolve) => {
    release = resolve
  })
  const running = execute(
    ...args,
    async (entries) => {
      assert.equal(entries[0], exact)
      calls.push(['save', entries[0]])
      await save
    },
    (key) => calls.push(['ack', key])
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    calls.some((c) => c[0] === 'ack'),
    false
  )
  release()
  await running
  assert.equal(calls.at(-1)[0], 'ack')
  calls.length = 0
  await assert.rejects(
    execute(
      ...args,
      async () => {
        throw Error('disk failure')
      },
      (key) => calls.push(['ack', key])
    ),
    /disk failure/
  )
  assert.equal(
    calls.some((c) => c[0] === 'ack'),
    false
  )
})
test('actual graph persistence synchronizes cleanup snapshot before deferred result save', async () => {
  let load
  creativeBackgroundUiPlugin(process.cwd()).setup({
    onLoad: (_options, callback) => {
      load = callback
    }
  })
  const { contents } = await load({
    path: path.resolve('vendor/levelup/baseline-6542241/src/components/ConstellationStudio.tsx')
  })
  const start = contents.indexOf('const mamPersistGraph=async'),
    end = contents.indexOf('\n  useEffect(', start)
  let body = contents
    .slice(start, end)
    .replace(
      'const mamPersistGraph=async(id:string,graph:ConstellationGraph)=>',
      'return async(id,graph)=>'
    )
    .replaceAll(' as any', '')
  const graphRef = { current: { nodes: ['old'], edges: [] } },
    meta = { current: { id: 'p' } },
    timer = { current: null },
    saved = [],
    acks = []
  let release
  const deferred = new Promise((resolve) => {
    release = resolve
  })
  let queue = Promise.resolve()
  const enqueue = (change) => {
    const task = queue.then(async () => {
      const record = change([{ id: 'p', payload: {} }])
      await deferred
      saved.push(record.payload.graph)
    })
    queue = task
    return task
  }
  const reactState = { nodes: ['old'], edges: [] }
  const persist = new Function(
    'graphMetaRef',
    'graphRef',
    'autosaveTimerRef',
    'queueProjectSave',
    'mamAcknowledgeBackground',
    'setNodes',
    'setEdges',
    body
  )(
    meta,
    graphRef,
    timer,
    enqueue,
    (key) => acks.push(key),
    (nodes) => {
      reactState.nodes = nodes
    },
    (edges) => {
      reactState.edges = edges
    }
  )
  const exact = { nodes: ['new'], edges: [] }
  const result = persist('p', exact)
  assert.equal(graphRef.current.nodes, exact.nodes)
  // The original component assigns the ref from React state on every render.
  graphRef.current = { nodes: reactState.nodes, edges: reactState.edges }
  const cleanupSnapshot = graphRef.current
  const cleanup = enqueue(() => ({ id: 'p', payload: { graph: cleanupSnapshot } }))
  assert.equal(acks.length, 0)
  release()
  await result
  await cleanup
  assert.deepEqual(saved.at(-1).nodes, ['new'])
  assert.equal(acks.length, 1)
})
test('transformed Goal commit advances the cleanup ref synchronously before React commits', async () => {
  let load
  creativeBackgroundUiPlugin(process.cwd()).setup({
    onLoad: (_options, callback) => {
      load = callback
    }
  })
  const { contents } = await load({
    path: path.resolve('vendor/levelup/baseline-6542241/src/components/WritingStudio.tsx')
  })
  const start = contents.indexOf('const commitGoalProject ='),
    end = contents.indexOf('  const requestGoalAgent =', start)
  const body = contents
    .slice(start, end)
    .replace(
      'const commitGoalProject = (nextProject: WritingProject) =>',
      'return (nextProject) =>'
    )
  const refs = {
    current: [
      { id: 'p', content: 'old' },
      { id: 'q', content: 'keep' }
    ]
  }
  let pending
  const commit = new Function('projectsRef', 'setProjects', body)(refs, (next) => {
    pending = next
  })
  commit({ id: 'p', content: 'new' })
  assert.equal(refs.current[0].content, 'new')
  assert.equal(refs.current[1].content, 'keep')
  assert.equal(pending, refs.current)
})
