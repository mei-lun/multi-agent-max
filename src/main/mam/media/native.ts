import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { MediaModel } from '../../../shared/mam/media-models'

export function classifyMediaModel(
  model: ModelProfile,
  provider: ProviderProfile
): MediaModel | undefined {
  const id = model.remoteModelId
  const native = provider.protocol === 'google-generative-ai'
  const compatible = ['openai-responses', 'openai-completions'].includes(provider.protocol)
  const image = native
    ? /^(gemini-[\w.-]*(image|nano-banana)[\w.-]*|imagen-[\w.-]+)$/.test(id)
    : compatible && /^(gpt-image-|dall-e-|grok-imagine(?!-video)|image-01(?:-live)?$)/.test(id)
  const speech = native
    ? /^gemini-[\w.-]*tts[\w.-]*$/.test(id)
    : compatible && /^(tts-1(?:-hd)?$|gpt-4o-mini-tts|grok-voice-tts$)/.test(id)
  if (!image && !speech) return
  return {
    id: model.id,
    label: model.displayName,
    modelId: id,
    kind: image ? 'image' : 'speech',
    operations: image
      ? ['image.generate', ...(id === 'dall-e-3' || id.startsWith('imagen-') ? [] : ['image.edit'])]
      : ['speech.generate'],
    supportsMask: image && /^(gpt-image-|dall-e-2$)/.test(id),
    outputFormats: image
      ? id.startsWith('gpt-image-')
        ? ['png', 'jpeg', 'webp']
        : ['png']
      : native
        ? ['wav']
        : id === 'grok-voice-tts'
          ? ['mp3', 'wav']
          : ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'],
    ...(speech
      ? { voices: native ? ['Kore'] : id === 'grok-voice-tts' ? ['eve', 'ara'] : ['alloy'] }
      : {})
  }
}

export function nativeBody(
  kind: string,
  model: string,
  p: { prompt: string; size?: string | undefined; quality?: string | undefined },
  images: { mime: string; data: string }[]
) {
  if (model.startsWith('imagen-')) {
    if (images.length) throw new Error('Imagen does not accept references')
    return {
      instances: [{ prompt: p.prompt }],
      parameters: { sampleCount: 1, ...(p.size ? { aspectRatio: p.size } : {}) }
    }
  }
  if (kind === 'gemini')
    return {
      contents: [
        {
          role: 'user',
          parts: [
            { text: p.prompt },
            ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          ...(p.size ? { aspectRatio: p.size } : {}),
          ...(p.quality ? { imageSize: p.quality } : {})
        }
      }
    }
  if (kind === 'minimax') {
    if (p.prompt.length > 1500) throw new Error('MiniMax prompt too long')
    const dimensions = p.size?.match(/^(\d+)x(\d+)$/)
    let size = {}
    if (dimensions) {
      const width = Number(dimensions[1]),
        height = Number(dimensions[2])
      if (model === 'image-01-live' || [width, height].some((n) => n < 512 || n > 2048 || n % 8))
        throw new Error('Invalid MiniMax dimensions')
      size = { width, height }
    } else if (p.size) {
      if (
        ![
          '1:1',
          '16:9',
          '4:3',
          '3:2',
          '2:3',
          '3:4',
          '9:16',
          ...(model === 'image-01' ? ['21:9'] : [])
        ].includes(p.size)
      )
        throw new Error('Invalid MiniMax aspect ratio')
      size = { aspect_ratio: p.size }
    }
    if (
      images.some(
        (i) =>
          !['image/png', 'image/jpeg'].includes(i.mime) ||
          i.data.length >= (10 * 1024 * 1024 * 4) / 3
      )
    )
      throw new Error('Invalid MiniMax reference')
    return {
      model,
      prompt: p.prompt,
      n: 1,
      response_format: 'base64',
      ...size,
      ...(images.length
        ? {
            subject_reference: images.map((i) => ({
              type: 'character',
              image_file: `data:${i.mime};base64,${i.data}`
            }))
          }
        : {})
    }
  }
  if (images.length > 3) throw new Error('Grok supports at most 3 references')
  const refs = images.map((i) => ({ type: 'image_url', url: `data:${i.mime};base64,${i.data}` }))
  return {
    model,
    prompt: p.prompt,
    n: 1,
    response_format: 'b64_json',
    ...(p.size ? { aspect_ratio: p.size } : {}),
    ...(refs.length === 1 ? { image: refs[0] } : refs.length ? { images: refs } : {})
  }
}

export function nativeOutputs(kind: string, value: unknown): { b64_json?: string; url?: string }[] {
  const predictions = (value as { predictions?: { bytesBase64Encoded?: string }[] }).predictions
  if (predictions)
    return predictions.flatMap((p) =>
      p.bytesBase64Encoded ? [{ b64_json: p.bytesBase64Encoded }] : []
    )
  const v = value as {
    base_resp?: { status_code?: number }
    data?: { image_base64?: string[]; image_urls?: string[] }
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]
  }
  if (kind === 'minimax') {
    if (v.base_resp?.status_code) throw new Error('MiniMax generation failed')
    return [
      ...(v.data?.image_base64 ?? []).map((b64_json) => ({ b64_json })),
      ...(v.data?.image_urls ?? []).map((url) => ({ url }))
    ]
  }
  return (v.candidates ?? []).flatMap((c) =>
    (c.content?.parts ?? []).flatMap((p) =>
      p.inlineData?.mimeType?.startsWith('image/') && p.inlineData.data
        ? [{ b64_json: p.inlineData.data }]
        : []
    )
  )
}
