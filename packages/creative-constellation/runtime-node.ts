// Original executeNode lifted from immutable ConstellationStudio; renderer closures injected below.
import {
  constellationValueReady,
  constellationInputAttachments,
  constellationFileOutputs,
  constellationConversationAttachments,
  renderConstellationTemplate,
  mediaKindForConstellationNode,
  type ConstellationNode,
  type ConstellationValue,
  type ConstellationGraph
} from '../../vendor/levelup/baseline-6542241/src/lib/constellation'
import {
  imageGenerationSize,
  imageModelCapabilities,
  videoOutputOptions
} from '../../vendor/levelup/baseline-6542241/src/lib/mediaCapabilities'
import type {
  ImageAttachment,
  MediaGenerationRequest
} from '../../vendor/levelup/baseline-6542241/src/lib/types'
import { resolveWritingRoute, resolveMediaRoute } from './runtime-routes'
export class ConstellationWaitingError extends Error {}
type GraphSnapshot = ConstellationGraph
const tr = (zh: string, _en: string) => zh
const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const uniqueAttachments = (values: ImageAttachment[]) => [
  ...new Map(values.map((v) => [v.id, v])).values()
]
export function createGraphNodeExecutor(services: any, state: any) {
  const {
    mediaCatalog,
    writingModels,
    activeProfile,
    importLocalResources,
    executeReadOnlyTool,
    executeLocalCommand,
    onRunConversation,
    generateMedia
  } = services
  const { runtimeValuesRef, runEpochRef, updateNode, updateRuntimeOutput, setNodes } = state
  const workspace = undefined
  const setMediaPending = (_update: any) => {}
  const valueToAttachment = async (value: ConstellationValue) =>
    value.attachment ||
    (value.asset?.filePath
      ? (await importLocalResources([value.asset.filePath], []))[0]
      : undefined)
  return async function executeNode(
    node: ConstellationNode,
    graph: GraphSnapshot,
    epoch: number
  ): Promise<Partial<Record<string, ConstellationValue>>> {
    if (runEpochRef.current !== epoch) throw new Error(tr('执行已停止', 'Run stopped'))
    const incoming = (handle: string) =>
      graph.edges
        .filter((edge) => edge.target === node.id && edge.targetHandle === handle)
        .map((edge) => runtimeValuesRef.current.get(edge.source)?.[edge.sourceHandle ?? ''])
        .filter((value): value is ConstellationValue => Boolean(value))
    if (node.data.kind === 'conversation') {
      const inputs = [...incoming('context'), ...incoming('files')]
      const upstream = inputs
        .map((value) => value.text)
        .filter(Boolean)
        .join('\n\n')
      const command =
        incoming('command')
          .map((value) => value.text)
          .filter(Boolean)
          .join('\n\n') ||
        node.data.sessionCommand?.trim() ||
        ''
      if (!command)
        throw new Error(tr('会话执行节点需要一条命令', 'The session step needs a command'))
      const attachments = await constellationConversationAttachments(
        [...inputs, ...incoming('command')],
        importLocalResources
      )
      if (runEpochRef.current !== epoch) throw new Error(tr('执行已停止', 'Run stopped'))
      const result = await onRunConversation({
        threadId: node.data.conversationThreadId,
        command,
        context: upstream,
        attachments,
        workspace,
        onThreadReady: (thread) =>
          updateNode(node.id, {
            conversationThreadId: thread.id,
            conversationThreadTitle: thread.title,
            conversationSnapshot: undefined
          })
      })
      if (
        result.threadId !== node.data.conversationThreadId ||
        result.title !== node.data.conversationThreadTitle
      ) {
        updateNode(node.id, {
          conversationThreadId: result.threadId,
          conversationThreadTitle: result.title,
          conversationSnapshot: undefined
        })
      }
      const text = result.text?.trim()
      if (!text)
        throw new Error(
          tr(
            '会话尚未返回可用结果，请在会话中处理待批准操作后继续',
            'The conversation has no result yet; resolve any pending approval in the conversation, then continue'
          )
        )
      return { text: { type: 'text', text, createdAt: Date.now() } }
    }
    if (node.data.kind === 'projectRef') {
      if (!node.data.projectReference || !constellationValueReady(node.data.projectValue))
        throw new Error(tr('请先选择项目作品', 'Choose a project output first'))
      return { output: structuredClone(node.data.projectValue) }
    }
    if (node.data.kind === 'input') {
      if (node.data.inputMode === 'file') {
        let attachments = constellationInputAttachments(node.data)
        if (attachments.some((item: any) => item.kind === 'file' && !item.content))
          attachments = await importLocalResources(
            attachments.map((item) => item.id),
            []
          )
        if (!attachments.length && node.data.inputPath?.trim())
          attachments = await importLocalResources([node.data.inputPath.trim()], [])
        if (!attachments.length)
          throw new Error(
            tr('请选择文件或填写有效的文件路径', 'Choose files or enter a valid file path')
          )
        return constellationFileOutputs(
          attachments,
          [
            node.data.inputText,
            ...attachments.map((item: any) => item.content || `Unparsed file: ${item.name}`)
          ]
            .filter(Boolean)
            .join('\n\n')
        )
      }
      const text =
        node.data.inputMode === 'url'
          ? await executeReadOnlyTool('web_fetch', {
              url: node.data.inputUrl?.trim(),
              maxChars: 80_000
            })
          : node.data.inputText?.trim()
      if (!text)
        throw new Error(
          tr('输入内容为空，请填写文本或选择文件', 'Input is empty; enter text or choose a file')
        )
      return { text: { type: 'text', text: text.slice(0, 80_000), createdAt: Date.now() } }
    }
    if (node.data.kind === 'localTool') {
      const upstreamInput = incoming('input')
        .map((value) => value.text ?? '')
        .join('\n\n')
      const template = node.data.toolTemplate
      if (node.data.legacyToolName) {
        const argumentsValue: unknown = JSON.parse(node.data.toolArguments || '{}')
        if (!isRecord(argumentsValue))
          throw new Error(tr('工具参数必须为 JSON 对象', 'Tool arguments must be a JSON object'))
        const substitute = (value: unknown): unknown =>
          typeof value === 'string'
            ? value.split('{{input}}').join(upstreamInput)
            : Array.isArray(value)
              ? value.map(substitute)
              : isRecord(value)
                ? Object.fromEntries(
                    Object.entries(value).map(([key, item]) => [key, substitute(item)])
                  )
                : value
        const text = await executeReadOnlyTool(
          node.data.legacyToolName,
          substitute(argumentsValue) as Record<string, unknown>
        )
        return { text: { type: 'text', text: text.slice(0, 80_000), createdAt: Date.now() } }
      }
      if (template?.command?.trim()) {
        const values = Object.fromEntries(
          (template.inputSchema ?? []).map((field) => {
            const connected = incoming(field.id)
              .map((value) => value.text ?? '')
              .filter(Boolean)
              .join('\n\n')
            return [
              field.id,
              connected || (node.data.toolInputs?.[field.id] ?? field.defaultValue ?? '')
            ]
          })
        )
        for (const field of template.inputSchema ?? []) {
          if (field.required && !String(values[field.id] ?? '').trim()) {
            throw new Error(tr(`请填写工具输入：${field.name}`, `Fill tool input: ${field.name}`))
          }
        }
        if (template.inputSchema.some((field) => field.id === 'input'))
          values.input ||= upstreamInput
        const argumentTemplate = renderConstellationTemplate(
          template.argumentTemplate || '{{input}}',
          values,
          upstreamInput
        )
        const command = renderConstellationTemplate(template.command, values, upstreamInput)
          .split('{{args}}')
          .join(argumentTemplate)
        const stdout = await executeLocalCommand(
          command,
          template.workdirMode === 'custom' ? template.workdir : undefined
        )
        const outputs: Partial<Record<string, ConstellationValue>> = {
          text: { type: 'text', text: stdout.slice(0, 120_000), createdAt: Date.now() }
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(stdout)
        } catch {
          parsed = undefined
        }
        const readJsonPath = (value: unknown, path: string): unknown =>
          path
            .split('.')
            .filter(Boolean)
            .reduce<unknown>(
              (current, key) => (isRecord(current) ? current[key] : undefined),
              value
            )
        for (const field of template.outputSchema ?? []) {
          const handle = field.id === 'stdout' ? 'text' : field.id
          if (!handle || (handle === 'text' && field.id !== 'stdout')) continue
          const source = field.source?.trim() || '{{stdout}}'
          const match = source.match(/^\{\{json(?::([^}]+))?\}\}$/)
          const fieldMatch = source.match(/^\{\{field:([^}]+)\}\}$/)
          let value: unknown =
            source === '{{stdout}}'
              ? stdout
              : match
                ? match[1]
                  ? readJsonPath(parsed, match[1])
                  : parsed
                : fieldMatch
                  ? values[fieldMatch[1]]
                  : source
          if (value === undefined || value === null) continue
          if (field.type === 'json' && typeof value === 'string') {
            try {
              value = JSON.parse(value)
            } catch {
              /* Keep non-JSON output readable. */
            }
          }
          const text = typeof value === 'string' ? value : JSON.stringify(value)
          outputs[handle] = { type: 'text', text: text.slice(0, 120_000), createdAt: Date.now() }
        }
        return outputs
      }
      const argumentsValue: unknown = JSON.parse(node.data.toolArguments || '{}')
      if (!isRecord(argumentsValue))
        throw new Error(tr('工具参数必须为 JSON 对象', 'Tool arguments must be a JSON object'))
      const substitute = (value: unknown): unknown =>
        typeof value === 'string'
          ? value.split('{{input}}').join(upstreamInput)
          : Array.isArray(value)
            ? value.map(substitute)
            : isRecord(value)
              ? Object.fromEntries(
                  Object.entries(value).map(([key, item]) => [key, substitute(item)])
                )
              : value
      const text = await executeReadOnlyTool(
        node.data.toolName ?? 'read_file',
        substitute(argumentsValue) as Record<string, unknown>
      )
      return { text: { type: 'text', text: text.slice(0, 80_000), createdAt: Date.now() } }
    }
    if (node.data.kind === 'prompt') {
      const text = node.data.prompt?.trim() ?? ''
      if (!text) throw new Error(tr('提示词节点是空的', 'The Prompt node is empty'))
      return { text: { type: 'text', text, createdAt: Date.now() } }
    }
    if (node.data.kind === 'writing') {
      const prompt =
        incoming('prompt')
          .map((value) => value.text)
          .filter(Boolean)
          .join('\n\n') ||
        node.data.prompt?.trim() ||
        ''
      const context = incoming('context')
        .map((value) => value.text)
        .filter(Boolean)
        .join('\n\n')
      if (!prompt) throw new Error(tr('写作节点需要任务文本', 'The Writing node needs task text'))
      const route = resolveWritingRoute(node, writingModels, activeProfile)
      const content = [
        node.data.instruction?.trim() || '完成这项创作任务，只输出可直接使用的内容。',
        '\n任务:\n' + prompt,
        context ? '\n上下文:\n' + context : ''
      ].join('')
      const text = await services.text(route.profileId, content)
      if (!text.trim()) throw Error('写作模型没有返回正文')
      return { text: { type: 'text', text: text.trim(), createdAt: Date.now() } }
    }
    if (node.data.kind === 'canvas') {
      const input = incoming('image')[0]
      const imageAttachment = node.data.canvasResult ?? node.data.canvasSource ?? input?.attachment
      const image = imageAttachment
        ? { type: 'image' as const, attachment: imageAttachment, createdAt: Date.now() }
        : input
      if (!image)
        throw new Error(
          tr(
            '请先打开画板并选择或连接一张图片',
            'Open the canvas and choose or connect an image first'
          )
        )
      return {
        image,
        ...(node.data.maskAttachment
          ? {
              mask: {
                type: 'image' as const,
                attachment: node.data.maskAttachment,
                createdAt: Date.now()
              }
            }
          : {})
      }
    }
    if (node.data.kind === 'output') {
      const value = incoming('media')[0]
      if (!value)
        throw new Error(tr('作品预览节点还没有输入', 'The Output Preview node has no input'))
      return { media: value }
    }
    const mediaKind = mediaKindForConstellationNode(node.data.kind)
    if (!mediaKind) return {}
    if (
      node.data.status === 'waiting' &&
      Object.values(node.data.outputCandidates ?? {}).some((values) => values?.length)
    )
      throw new ConstellationWaitingError(
        tr('请刷新或选择已保存的候选结果', 'Refresh or select a saved candidate')
      )
    const promptHandle = mediaKind === 'audio' ? 'text' : 'prompt'
    const prompt =
      incoming(promptHandle)
        .map((value) => value.text)
        .filter(Boolean)
        .join('\n\n') ||
      node.data.prompt?.trim() ||
      ''
    if (!prompt)
      throw new Error(
        tr('能力节点需要提示词或文案输入', 'The ability node needs a prompt or text input')
      )
    const referenceValues = mediaKind === 'image' || mediaKind === 'video' ? incoming('image') : []
    const attachments = uniqueAttachments([
      ...(node.data.references ?? []),
      ...(mediaKind === 'image' && node.data.canvasSource ? [node.data.canvasSource] : []),
      ...(await Promise.all(referenceValues.map(valueToAttachment))).filter(
        (value): value is ImageAttachment => Boolean(value)
      )
    ])
    const maskValue = incoming('mask')[0]
    const maskAttachment =
      maskValue?.attachment ??
      (maskValue ? await valueToAttachment(maskValue) : undefined) ??
      (mediaKind === 'image' ? node.data.maskAttachment : undefined)
    const operation = node.data.operation ?? 'generate'
    if (mediaKind === 'image' && operation !== 'generate' && attachments.length === 0) {
      throw new Error(
        operation === 'outpaint'
          ? tr('扩图需要一张源图片', 'Outpainting needs a source image')
          : tr('图片编辑需要一张源图片', 'Image editing needs a source image')
      )
    }
    if (mediaKind === 'image' && operation === 'inpaint' && !maskAttachment) {
      throw new Error(
        tr('局部重绘需要连接画板的蒙版输出', 'Inpainting needs the Canvas mask output')
      )
    }
    const route = resolveMediaRoute(
      node,
      mediaCatalog,
      Boolean(mediaKind === 'image' && maskAttachment)
    )
    const imageCapabilities = imageModelCapabilities(route.model)
    const videoMode =
      mediaKind === 'video'
        ? attachments.length > 1
          ? 'reference'
          : attachments.length === 1
            ? 'image'
            : 'text'
        : 'text'
    const videoOptions = videoOutputOptions(route.model, videoMode, node.data)
    const videoHasOutputControls = mediaKind === 'video' && videoOptions.hasControls
    if (videoHasOutputControls && !videoOptions.capabilities.modes.includes(videoMode)) {
      throw new Error(
        tr(
          '当前模型不支持此参考图数量对应的生成方式，请调整参考图或更换模型',
          'This model does not support the generation mode for these references. Adjust references or choose another model'
        )
      )
    }
    if (videoHasOutputControls && attachments.length > videoOptions.capabilities.referenceLimit) {
      throw new Error(
        tr(
          `此模型当前最多支持 ${videoOptions.capabilities.referenceLimit} 张参考图`,
          `This model supports at most ${videoOptions.capabilities.referenceLimit} reference images in this mode`
        )
      )
    }
    const imageSize = imageGenerationSize(route.model, node.data.size)
    const effectivePrompt =
      mediaKind === 'image' && operation === 'outpaint'
        ? `${prompt}\n\n${tr('扩展画面边界并无缝补全新增区域；保持原图主体、光线、透视、色彩和材质完全一致。', 'Extend the image beyond its current boundaries and seamlessly complete the new area while preserving subject, lighting, perspective, color, and material.')}`
        : prompt
    const request: MediaGenerationRequest = {
      kind: mediaKind,
      profileId: route.profileId,
      model: route.model,
      protocol: route.protocol,
      prompt: effectivePrompt,
      count: Math.max(1, Math.min(mediaKind === 'image' ? 8 : 4, node.data.count ?? 1)),
      size:
        mediaKind === 'image'
          ? imageSize !== 'auto'
            ? imageSize
            : undefined
          : mediaKind === 'video' && !videoHasOutputControls
            ? videoOptions.size
            : undefined,
      quality:
        mediaKind === 'image' && !imageCapabilities.minimax && node.data.quality !== 'auto'
          ? node.data.quality
          : undefined,
      outputFormat:
        mediaKind === 'video' || (mediaKind === 'image' && imageCapabilities.minimax)
          ? undefined
          : node.data.outputFormat,
      background:
        mediaKind === 'image' && !imageCapabilities.minimax && node.data.background !== 'auto'
          ? node.data.background
          : undefined,
      voice: mediaKind === 'audio' ? node.data.voice?.trim() || undefined : undefined,
      instructions: mediaKind === 'audio' ? node.data.instruction?.trim() || undefined : undefined,
      seconds: mediaKind === 'video' ? videoOptions.seconds : undefined,
      videoMode: mediaKind === 'video' && videoHasOutputControls ? videoMode : 'text',
      videoResolution: videoHasOutputControls ? videoOptions.resolution : undefined,
      videoAspectRatio: videoHasOutputControls ? videoOptions.aspectRatio : undefined,
      referenceAttachmentIds: attachments.map((attachment) => attachment.id),
      maskAttachmentId: mediaKind === 'image' ? maskAttachment?.id : undefined
    }
    setMediaPending((value) => value + request.count)
    try {
      const result = await generateMedia(request)
      if (result.assets.length === 0)
        throw new Error(
          result.errors.join(' · ') ||
            tr('模型没有返回可用结果', 'The model returned no usable output')
        )
      const candidates: ConstellationValue[] = result.assets.map((asset) => ({
        type: mediaKind,
        asset,
        createdAt: Date.now()
      }))
      if (runEpochRef.current !== epoch) throw new Error(tr('执行已停止', 'Run stopped'))
      setNodes((current) =>
        current.map((item) =>
          item.id === node.id
            ? {
                ...item,
                data: { ...item.data, outputCandidates: { [mediaKind]: candidates }, outputs: {} }
              }
            : item
        )
      )
      if (candidates.every((value) => value.asset?.status === 'failed'))
        throw new Error(tr('所有候选结果均失败，请重新运行', 'All candidates failed; run again'))
      if (candidates.length !== 1 || candidates[0].asset?.status !== 'completed') {
        runtimeValuesRef.current.set(node.id, {})
        throw new ConstellationWaitingError(
          tr(
            '候选结果已保存，进度会自动更新；完成后可选择结果',
            'Candidates saved; progress updates automatically. Choose an output when ready'
          )
        )
      }
      return { [mediaKind]: candidates[0] }
    } finally {
      setMediaPending((value) => Math.max(0, value - request.count))
    }
  }
}
