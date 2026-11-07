import type { z } from 'zod'
import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import type { mediaParamsSchema } from '../../../shared/mam/media-requests'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { OperationHandler } from '../creative-runtime/jobs'
import { inspectImage } from '../components/host-image-inspection'
import { nativeBody, nativeOutputs } from './native'
import { downloadResult } from './result-download'
import { geminiSpeechBody, geminiSpeechBytes } from './speech'

const LIMIT = 32 * 1024 * 1024
function imageMime(bytes: Buffer): string {
  return inspectImage(bytes)
}
async function bounded(response: Response): Promise<Buffer> {
  if (!response.ok) throw new Error(`Media HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > LIMIT)
    throw new Error('Media response too large')
  if (!response.body) throw new Error('Empty media response')
  const parts: Uint8Array[] = []
  let size = 0
  for await (const part of response.body) {
    size += part.length
    if (size > LIMIT) {
      await response.body.cancel().catch(() => {})
      throw new Error('Media response too large')
    }
    parts.push(part)
  }
  return Buffer.concat(parts)
}
type Execution = {
  request: CreativeRequest
  params: z.infer<typeof mediaParamsSchema>
  model: ModelProfile
  provider: ProviderProfile
  secret: string | undefined
  assets: BinaryAssetStore
  fetcher: typeof fetch
  context: Parameters<OperationHandler['run']>[1]
  validateImage?: (bytes: Buffer) => string
}
export async function execute(o: Execution) {
  const signal = AbortSignal.any([o.context.signal, AbortSignal.timeout(180000)])
  const count = o.request.operation === 'speech.generate' ? 1 : (o.params.count ?? 1)
  let next = 0
  const assets = [] as Awaited<ReturnType<typeof executeOne>>['assets']
  const errors: { index: number; message: string }[] = []
  await Promise.all(
    Array.from({ length: Math.min(count, 2) }, async () => {
      while (next < count) {
        signal.throwIfAborted()
        const index = next++
        try {
          const result = await executeOne({
            ...o,
            params: { ...o.params, count: 1 },
            context: { ...o.context, signal }
          })
          assets.push(...result.assets)
        } catch {
          signal.throwIfAborted()
          errors.push({ index, message: 'Media generation failed' })
        }
      }
    })
  )
  if (errors.length && !assets.length) throw new Error('Media generation failed')
  return { assets, errors, partial: errors.length > 0 }
}
async function executeOne(o: Execution) {
  const validateImage = o.validateImage ?? imageMime
  const { params: p, request: r, context } = o
  await context.emit('log', {
    modelProfileId: o.model.id,
    modelVersion: o.model.version,
    modelId: o.model.remoteModelId,
    providerProfileId: o.provider.id,
    providerVersion: o.provider.version,
    protocol: o.provider.protocol
  })
  const base = new URL(o.provider.baseUrl ?? 'https://api.openai.com/v1/')
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid provider endpoint')
  base.pathname = base.pathname.replace(/\/?$/, '/')
  if (base.pathname === '/') base.pathname = '/v1/'
  const speech = r.operation === 'speech.generate'
  const format =
    p.outputFormat ??
    (speech ? (o.provider.protocol === 'google-generative-ai' ? 'wav' : 'mp3') : 'png')
  if (speech ? ['png', 'jpeg', 'webp'].includes(format) : !['png', 'jpeg', 'webp'].includes(format))
    throw new Error('Unsupported output format')
  const headers = new Headers(o.provider.headers)
  if (o.secret) headers.set('Authorization', `Bearer ${o.secret}`)
  let body: BodyInit
  const fields: Record<string, string | number> = speech
    ? {
        model: o.model.remoteModelId,
        input: p.prompt,
        voice: p.voice ?? 'alloy',
        response_format: format
      }
    : {
        model: o.model.remoteModelId,
        prompt: p.prompt,
        n: p.count ?? 1,
        ...(p.size ? { size: p.size } : {}),
        ...(p.quality ? { quality: p.quality } : {}),
        response_format: 'b64_json',
        ...(o.model.remoteModelId.startsWith('gpt-image-') ? { output_format: format } : {})
      }
  if (r.operation === 'image.edit') {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.set(key, String(value))
    let source: Buffer | undefined
    let mask: Buffer | undefined
    for (const ref of r.inputAssets) {
      if (ref.bytes > LIMIT) throw new Error('Input image too large')
      const bytes = await o.assets.read(ref)
      const mime = validateImage(bytes)
      const isMask = ref.id === p.maskAssetId
      if (isMask) {
        if (mime !== 'image/png') throw new Error('Mask must be PNG')
        mask = bytes
      } else source ??= bytes
      form.append(
        isMask ? 'mask' : 'image',
        new Blob([new Uint8Array(bytes)], { type: mime }),
        ref.filename
      )
    }
    if (!source) throw new Error('Edit requires source image')
    if (
      mask &&
      (validateImage(source) !== 'image/png' ||
        !source.subarray(16, 24).equals(mask.subarray(16, 24)))
    )
      throw new Error('Mask dimensions must match PNG source')
    headers.delete('content-type')
    body = form
  } else {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(fields)
  }
  let endpoint = speech
    ? 'audio/speech'
    : r.operation === 'image.edit'
      ? 'images/edits'
      : 'images/generations'
  const native =
    o.provider.protocol === 'google-generative-ai'
      ? 'gemini'
      : o.model.remoteModelId.startsWith('image-01')
        ? 'minimax'
        : o.model.remoteModelId.startsWith('grok-imagine')
          ? 'grok'
          : undefined
  if (native) {
    if (p.maskAssetId) throw new Error('Provider does not support explicit masks')
    const images = []
    for (const ref of r.inputAssets) {
      if (ref.bytes > LIMIT) throw new Error('Input image too large')
      const bytes = await o.assets.read(ref)
      images.push({ mime: validateImage(bytes), data: bytes.toString('base64') })
    }
    body = JSON.stringify(
      speech && native === 'gemini'
        ? geminiSpeechBody(p.prompt, p.voice)
        : nativeBody(native, o.model.remoteModelId, p, images)
    )
    headers.set('Content-Type', 'application/json')
    if (native === 'gemini') {
      if (!/^[\w.-]+$/.test(o.model.remoteModelId)) throw new Error('Invalid Gemini model')
      base.pathname = base.pathname.replace(/\/(v1|v1beta)\/$/, '/')
      endpoint = `v1beta/models/${o.model.remoteModelId}:${o.model.remoteModelId.startsWith('imagen-') ? 'predict' : 'generateContent'}`
      headers.delete('Authorization')
      if (o.secret) headers.set('x-goog-api-key', o.secret)
    } else if (native === 'minimax') endpoint = 'image_generation'
  }
  if (speech && o.model.remoteModelId === 'grok-voice-tts') {
    endpoint = 'tts'
    body = JSON.stringify({
      text: p.prompt.trim(),
      language: 'auto',
      voice_id: p.voice?.trim() || 'eve',
      output_format: { codec: format }
    })
  }
  const response = await o.fetcher(new URL(endpoint, base), {
    method: 'POST',
    headers,
    body,
    signal: context.signal,
    redirect: 'error'
  })
  let raw = await bounded(response)
  if (speech && native === 'gemini') raw = geminiSpeechBytes(raw)
  if (speech && o.model.remoteModelId === 'grok-voice-tts' && raw[0] === 123) {
    const value = JSON.parse(raw.toString()) as { audio?: string }
    if (!value.audio || value.audio.length > LIMIT * 1.4) throw new Error('Invalid Grok audio')
    raw = Buffer.from(value.audio, 'base64')
  }
  const outputs = speech
    ? [{ bytes: raw }]
    : native && native !== 'grok'
      ? nativeOutputs(native, JSON.parse(raw.toString()))
      : (JSON.parse(raw.toString()) as { data?: { b64_json?: string; url?: string }[] }).data
  if (!outputs?.length || outputs.length > 10) throw new Error('Invalid media response')
  const assets = []
  for (const output of outputs) {
    context.signal.throwIfAborted()
    let bytes: Buffer
    if ('bytes' in output) bytes = output.bytes
    else if (output.b64_json) {
      if (output.b64_json.length > LIMIT * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(output.b64_json))
        throw new Error('Invalid image encoding')
      bytes = Buffer.from(output.b64_json, 'base64')
    } else if (output.url) {
      const url = new URL(output.url)
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Invalid result URL')
      bytes = await downloadResult(url, context.signal)
    } else throw new Error('Missing media output')
    const mime = speech
      ? (
          {
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            opus: 'audio/ogg',
            aac: 'audio/aac',
            flac: 'audio/flac',
            pcm: 'audio/pcm'
          } as Record<string, string>
        )[format]
      : validateImage(bytes)
    if (!bytes.length || bytes.length > LIMIT) throw new Error('Invalid output size')
    if (speech) {
      const prefix = bytes.toString('ascii', 0, 4)
      const valid =
        format === 'pcm'
          ? bytes.length % 2 === 0
          : format === 'mp3'
            ? bytes.toString('ascii', 0, 3) === 'ID3' ||
              (bytes[0] === 255 && (bytes[1]! & 224) === 224)
            : format === 'wav'
              ? prefix === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
              : format === 'flac'
                ? prefix === 'fLaC'
                : format === 'opus'
                  ? prefix === 'OggS' && bytes.includes(Buffer.from('OpusHead'))
                  : format === 'aac' && bytes[0] === 255 && (bytes[1]! & 246) === 240
      if (!valid) throw new Error('Invalid audio bytes')
    }
    if (!mime) throw new Error('Unsupported MIME')
    const asset = await o.assets.import(
      (async function* () {
        yield bytes
      })(),
      {
        mime,
        filename: `generated.${speech ? format : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'}`
      }
    )
    assets.push(asset)
    await context.emit('asset', asset)
  }
  return { assets }
}
