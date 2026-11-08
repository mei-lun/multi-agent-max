import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
export function validOperation(id: string) {
  return /^(?:v1beta\/)?models\/[\w.-]+\/operations\/[\w-]+$/.test(id)
}
export function veoBody(prompt: string, duration?: number, aspectRatio?: string) {
  return {
    instances: [{ prompt: prompt.trim() }],
    parameters: {
      sampleCount: 1,
      ...(duration ? { durationSeconds: duration } : {}),
      ...(aspectRatio ? { aspectRatio } : {})
    }
  }
}
export function findVideoUri(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (['uri', 'videoUri', 'video_uri'].includes(key) && typeof item === 'string') return item
    const nested = findVideoUri(item)
    if (nested) return nested
  }
  return
}

export async function uploadSeedanceReference(
  fetcher: typeof fetch,
  base: URL,
  headers: Headers,
  bytes: Buffer,
  mime: string,
  filename: string,
  signal: AbortSignal,
  read: (response: Response) => Promise<Buffer>
) {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename)
  const uploadHeaders = new Headers(headers)
  uploadHeaders.delete('Content-Type')
  const uploaded = JSON.parse(
    (
      await read(
        await fetcher(new URL('media/references', base), {
          method: 'POST',
          headers: uploadHeaders,
          body: form,
          signal,
          redirect: 'error'
        })
      )
    ).toString()
  ) as { url?: string }
  if (!uploaded.url) throw new Error('Missing reference upload URL')
  const target = new URL(uploaded.url)
  if (target.protocol !== 'https:' || target.username || target.password)
    throw new Error('Invalid reference upload URL')
  return target.href
}

export function videoMime(bytes: Buffer): string {
  if (bytes.length >= 24 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const length = bytes.readUInt32BE(0)
    if (
      length < 16 ||
      length > 4096 ||
      length > bytes.length ||
      !/^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV)$/.test(bytes.toString('ascii', 8, 12))
    )
      throw new Error('Invalid MP4 header')
    let offset = 0,
      media = false,
      movie = false
    while (offset + 8 <= bytes.length) {
      let size = bytes.readUInt32BE(offset)
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (size === 1) {
        if (offset + 16 > bytes.length) throw new Error('Invalid MP4 box')
        size = Number(bytes.readBigUInt64BE(offset + 8))
        if (size < 16) throw new Error('Invalid MP4 box')
      }
      if (size === 0) size = bytes.length - offset
      if (size < 8 || offset + size > bytes.length) throw new Error('Invalid MP4 box')
      if (type === 'mdat' && size > 8) media = true
      if (type === 'moov' || type === 'moof') movie = true
      offset += size
    }
    if (offset !== bytes.length || !media || !movie) throw new Error('Incomplete MP4 container')
    return 'video/mp4'
  }
  if (bytes.length >= 16 && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])))
    return 'video/webm'
  throw new Error('Unsupported video bytes')
}

export async function read(response: Response): Promise<Buffer> {
  if (!response.ok) throw new Error(`Video HTTP ${response.status}`)
  if (!response.body) throw new Error('Empty video response')
  let size = 0
  const parts: Uint8Array[] = []
  for await (const part of response.body) {
    size += part.length
    if (size > 32 * 1024 * 1024) throw new Error('Video response too large')
    parts.push(part)
  }
  return Buffer.concat(parts)
}

export function videoModel(model: ModelProfile, provider: ProviderProfile) {
  if (provider.protocol === 'google-generative-ai')
    return /^veo-[\w.-]+$/i.test(model.remoteModelId)
  return (
    ['openai-completions', 'openai-responses'].includes(provider.protocol) &&
    /^(grok-imagine-video|sora-|minimax-h3|seedance-2)/i.test(model.remoteModelId)
  )
}
