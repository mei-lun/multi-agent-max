import type { HandlerRegistry } from '../../src/main/mam/creative-runtime/jobs'
import type { BinaryAssetStore } from '../../src/main/mam/creative-runtime/assets'
import {
  normalizeConstellationGraph,
  constellationRunPlan,
  constellationExecutionLayers,
  type ConstellationValue
} from '../../vendor/levelup/baseline-6542241/src/lib/constellation'
import { createGraphNodeExecutor, ConstellationWaitingError } from './runtime-node'

/** Runs the original graph scheduler and lifted node implementation without mounting React. */
export function createConstellationBusinessServices(options: {
  generation: HandlerRegistry
  listModels: () => any[]
  assets: BinaryAssetStore
  hostCall?: (method: string, value: unknown) => Promise<unknown>
}) {
  const handlers: HandlerRegistry = (request) => {
    if (request.operation !== 'constellation.graph.execute') return
    const graph = normalizeConstellationGraph(request.params.graph)
    if (!graph) throw Error('Invalid constellation graph')
    if (JSON.stringify(graph).length > 16 * 1024 * 1024) throw Error('Constellation exceeds 16 MiB')
    const targets = Array.isArray(request.params.targets)
      ? request.params.targets.map(String)
      : undefined
    const plan = constellationRunPlan(graph.nodes, graph.edges, targets)
    const layers = constellationExecutionLayers(graph.nodes, graph.edges, plan.required)
    return {
      validate: () => {},
      run: async (_accepted, context) => {
        const models = options.listModels(),
          refs = new Map(request.inputAssets.map((ref) => [ref.id, ref]))
        const register = (item: any) => {
          const ref = item?.assetRef || item
          if (ref?.id && ref?.sha256 && ref?.mime) refs.set(ref.id, ref)
        }
        for (const node of graph.nodes) {
          for (const item of [
            ...(node.data.references || []),
            ...(node.data.inputAttachments || []),
            node.data.inputAttachment,
            node.data.canvasSource,
            node.data.canvasResult,
            node.data.maskAttachment
          ])
            register(item)
          for (const value of Object.values(node.data.outputs || {}))
            register(value?.asset || value?.attachment)
        }
        const importLocalResources = async (paths: string[], existing: any[] = []) => {
          const result = [...existing]
          for (const path of paths) {
            const ref = refs.get(path.replace(/^mam-asset:/, ''))
            if (!ref) throw Error('Graph asset reference unavailable')
            const bytes = await options.assets.read(ref)
            const text =
              ref.mime.startsWith('text/') || /\.(txt|md|json|csv|tsv)$/i.test(ref.filename)
            if (text && bytes.length > 1024 * 1024) throw Error('Graph text input exceeds 1 MiB')
            result.push({
              ...ref,
              assetRef: ref,
              name: ref.filename,
              mimeType: ref.mime,
              size: ref.bytes,
              kind: ref.mime.startsWith('image/') ? 'image' : 'file',
              content: text ? bytes.toString('utf8') : undefined
            })
          }
          return result
        }
        const invoke = async (
          operation: string,
          params: Record<string, unknown>,
          inputAssets: any[] = []
        ) => {
          context.signal.throwIfAborted()
          if (request.attempt) {
            if (!options.hostCall) throw Error('Graph attempt authorization unavailable')
            await options.hostCall('graph.authorize', { operation, params, inputAssets })
          }
          const nested = { ...request, operation, params, inputAssets },
            handler = options.generation(nested)
          if (!handler) throw Error(`Graph operation unavailable: ${operation}`)
          handler.validate(nested)
          return (await handler.run(nested, context)) as any
        }
        const runtimeValuesRef = {
          current: new Map(
            graph.nodes
              .filter((node) => !plan.execute.has(node.id) && node.data.status === 'success')
              .map((node) => [node.id, { ...(node.data.outputs || {}) }])
          )
        }
        const updateNode = (id: string, data: any) => {
          graph.nodes = graph.nodes.map((node) =>
            node.id === id ? { ...node, data: { ...node.data, ...data } } : node
          )
        }
        const updateRuntimeOutput = (id: string, outputs: any) => {
          runtimeValuesRef.current.set(id, outputs)
          updateNode(id, { outputs, status: 'success', error: undefined })
        }
        const unavailable = async () => {
          throw Error(
            'Background graph tools require explicit host authorization; use an approved MAM tool operation'
          )
        }
        const textModels = models
          .filter((m) => m.kind === 'text')
          .map((m) => ({ ...m, id: m.modelId || m.id, profileId: m.id, protocol: 'openai' }))
        const first = textModels[0],
          activeProfile = {
            id: first?.profileId,
            name: first?.label,
            model: first?.id,
            protocol: first?.protocol
          }
        const services = {
          mediaCatalog: {
            models: models
              .filter((m) => m.kind !== 'text')
              .map((m) => ({
                ...m,
                kind: m.kind === 'speech' ? 'audio' : m.kind,
                id: m.modelId || m.id,
                profileId: m.id,
                protocol: 'openai'
              })),
            errors: []
          },
          writingModels: textModels,
          activeProfile,
          importLocalResources,
          executeReadOnlyTool: options.hostCall
            ? async (name: string, args: any) =>
                options.hostCall!('graph.tool', {
                  name,
                  args: name === 'web_fetch' ? { url: args.url } : args
                })
            : unavailable,
          executeLocalCommand: options.hostCall
            ? async (command: string, workdir?: string) =>
                options.hostCall!('graph.tool', {
                  name: 'run_command',
                  args: { command, ...(workdir ? { workdir } : {}) }
                })
            : unavailable,
          onRunConversation: options.hostCall
            ? async (input: any) => {
                const result: any = await options.hostCall!('graph.conversation', {
                  ...(input.threadId ? { conversationId: input.threadId } : {}),
                  modelProfileId: activeProfile.id,
                  command: input.command,
                  context: input.context || '',
                  inputAssets: (input.attachments || [])
                    .map((item: any) => item.assetRef || refs.get(item.id))
                    .filter(Boolean)
                })
                input.onThreadReady?.({ id: result.conversationId, title: result.title })
                return { threadId: result.conversationId, title: result.title, text: result.text }
              }
            : unavailable,
          text: async (modelProfileId: string, prompt: string) =>
            (await invoke('text.generate', { modelProfileId, prompt })).text || '',
          generateMedia: async (input: any) => {
            const kind = input.kind === 'audio' ? 'speech' : input.kind,
              inputs = (input.referenceAttachmentIds || []).map((id: string) => {
                const ref = refs.get(id)
                if (!ref) throw Error('Graph media reference unavailable')
                return ref
              })
            if (input.maskAttachmentId) {
              const ref = refs.get(input.maskAttachmentId)
              if (!ref) throw Error('Graph mask unavailable')
              inputs.push(ref)
            }
            const operation =
              kind === 'speech'
                ? 'speech.generate'
                : kind === 'video'
                  ? 'video.generate'
                  : inputs.length
                    ? 'image.edit'
                    : 'image.generate'
            const params: any = { modelProfileId: input.profileId, prompt: input.prompt }
            for (const key of [
              'count',
              'size',
              'quality',
              'outputFormat',
              'background',
              'voice',
              'instructions'
            ])
              if (input[key] !== undefined) params[key] = input[key]
            if (input.seconds) params.duration = Number(input.seconds)
            if (input.videoResolution) params.resolution = input.videoResolution
            if (input.videoAspectRatio) params.aspectRatio = input.videoAspectRatio
            if (input.maskAttachmentId) params.maskAssetId = input.maskAttachmentId
            const result = await invoke(operation, params, inputs)
            const assets = (result.assets || []).map((ref: any) => {
              register(ref)
              return {
                ...ref,
                assetRef: ref,
                kind: input.kind,
                status: 'completed',
                filePath: ref.id
              }
            })
            return { assets, errors: result.errors || [] }
          }
        }
        const execute = createGraphNodeExecutor(services, {
          runtimeValuesRef,
          runEpochRef: { current: 1 },
          updateNode,
          updateRuntimeOutput,
          setNodes: (fn: any) => {
            graph.nodes = fn(graph.nodes)
          }
        })
        const failed = new Set<string>(),
          waiting = new Set<string>()
        for (const layer of layers)
          for (const node of layer) {
            context.signal.throwIfAborted()
            if (!plan.execute.has(node.id) || node.data.kind === 'note') continue
            const blocked = graph.edges.find(
              (edge) =>
                edge.target === node.id && (failed.has(edge.source) || waiting.has(edge.source))
            )
            if (blocked) {
              ;(waiting.has(blocked.source) ? waiting : failed).add(node.id)
              updateNode(node.id, {
                status: waiting.has(blocked.source) ? 'stale' : 'error',
                error: 'Upstream node requires attention'
              })
              continue
            }
            updateNode(node.id, { status: 'running', error: undefined })
            try {
              const outputs = await execute(node, graph, 1)
              context.signal.throwIfAborted()
              updateRuntimeOutput(node.id, outputs)
            } catch (error) {
              if (context.signal.aborted) throw error
              const paused = error instanceof ConstellationWaitingError
              ;(paused ? waiting : failed).add(node.id)
              updateNode(node.id, {
                status: paused ? 'waiting' : 'error',
                error: error instanceof Error ? error.message : String(error)
              })
            }
            await context.emit('log', {
              type: 'constellation_graph_checkpoint',
              nodeId: node.id,
              graph: structuredClone(graph)
            })
          }
        const outputs: ConstellationValue[] = graph.nodes
          .filter((node) => node.data.kind === 'output')
          .flatMap(
            (node) => Object.values(node.data.outputs || {}).filter(Boolean) as ConstellationValue[]
          )
        return {
          graph,
          outputs,
          failed: [...failed],
          waiting: [...waiting],
          partial: failed.size > 0 || waiting.size > 0,
          assets: outputs.flatMap((value) => (value.asset?.assetRef ? [value.asset.assetRef] : []))
        }
      }
    }
  }
  return { handlers }
}
