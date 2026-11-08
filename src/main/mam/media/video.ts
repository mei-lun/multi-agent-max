export { videoModel } from './video-protocol'
import { read } from './video-protocol'
import { CreativeReconciliationRequired } from '../../../shared/mam/creative-runtime-errors'
import { videoMime } from './video-protocol'
export { videoMime } from './video-protocol'
import { setTimeout as delay } from 'node:timers/promises'
import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import { videoParamsSchema } from '../../../shared/mam/video-requests'
import type { OperationHandler } from '../creative-runtime/jobs'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import { downloadResult } from './result-download'
import { inspectImage } from '../components/host-image-inspection'
import { validOperation, veoBody, findVideoUri, uploadSeedanceReference } from './video-protocol'

export type VideoReceipt = {
  type: 'remote_task'
  remoteId: string
  model: ModelProfile
  provider: ProviderProfile
}
export function createVideoHandler(options: {
  request: CreativeRequest
  model: ModelProfile
  provider: ProviderProfile
  secret: string | undefined
  assets: BinaryAssetStore
  fetcher: typeof fetch
  receipt?: VideoReceipt
  validateImage?: (bytes: Buffer) => string
}): OperationHandler {
  const o = options,
    p = o.receipt ? undefined : videoParamsSchema.parse(o.request.params)
  const modelId = o.model.remoteModelId.toLowerCase()
  const grok = modelId.startsWith('grok-')
  const minimax = modelId.startsWith('minimax-h3')
  const seedance = modelId.startsWith('seedance-')
  const veo = o.provider.protocol === 'google-generative-ai'
  const base = new URL(o.provider.baseUrl ?? 'https://api.openai.com/v1/')
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid video endpoint')
  base.pathname = base.pathname === '/' ? '/v1/' : base.pathname.replace(/\/?$/, '/')
  const directMini = minimax && /(^|\.)minimax\.(io|cn)$/.test(base.hostname)
  if (veo) base.pathname = base.pathname.replace(/\/(v1|v1beta)\/$/, '/')
  const headers = new Headers(o.provider.headers)
  headers.set('Content-Type', 'application/json')
  if (o.secret) headers.set('Authorization', `Bearer ${o.secret}`)
  if (veo) {
    headers.delete('Authorization')
    if (o.secret) headers.set('x-goog-api-key', o.secret)
  }
  function validate() {
    if (!p) return
    const n = o.request.inputAssets.length
    if (
      (p.mode === 'text' && n) ||
      (p.mode === 'image' && n !== 1) ||
      (p.mode === 'video' && n !== 1) ||
      (p.mode === 'reference' && (n < 1 || n > 3))
    )
      throw new Error('Invalid video references')
    if (
      (p.mode === 'first_last' && !minimax && !seedance) ||
      (!grok && !minimax && !seedance && p.mode !== 'text') ||
      (minimax && p.mode === 'video')
    )
      throw new Error('Unsupported video mode for model')
    if (seedance && p.mode === 'video') throw new Error('Seedance video edit unavailable')
    if (directMini && p.resolution)
      throw new Error(
        'Direct MiniMax requires native 768p/2k resolution; omit compatible resolution'
      )
    if (p.mode === 'first_last' && n !== 2)
      throw new Error('First/last mode requires exactly two frames')
    if ((o.request.operation === 'video.edit') !== (p.mode === 'video'))
      throw new Error('Video editing requires video mode')
  }
  return {
    validate,
    async run(_request, context) {
      validate()
      let submitted = false
      try {
        const signal = AbortSignal.any([context.signal, AbortSignal.timeout(15 * 60 * 1000)])
        let id = o.receipt?.remoteId
        if (!id) {
          const refs = []
          for (const ref of o.request.inputAssets) {
            if (ref.bytes > 20 * 1024 * 1024) throw new Error('Video reference too large')
            const bytes = await o.assets.read(ref)
            const mime =
              p!.mode === 'video' ? videoMime(bytes) : (o.validateImage ?? inspectImage)(bytes)
            let url = `data:${mime};base64,${bytes.toString('base64')}`
            if (seedance)
              url = await uploadSeedanceReference(
                o.fetcher,
                base,
                headers,
                bytes,
                mime,
                ref.filename,
                signal,
                read
              )
            refs.push({ url })
          }
          let body: Record<string, unknown> = {
            model: o.model.remoteModelId,
            prompt: p!.prompt,
            ...(p!.duration ? { duration: p!.duration } : {}),
            ...(p!.resolution ? { resolution: p!.resolution } : {}),
            ...(p!.aspectRatio ? { aspect_ratio: p!.aspectRatio } : {}),
            ...(p!.mode === 'image'
              ? { image: refs[0] }
              : p!.mode === 'reference'
                ? { reference_images: refs }
                : p!.mode === 'video'
                  ? { video: refs[0] }
                  : {})
          }
          if (veo) body = veoBody(p!.prompt, p!.duration, p!.aspectRatio)
          if (seedance) {
            body = {
              model: o.model.remoteModelId,
              prompt: p!.prompt,
              duration: p!.duration ?? 5,
              ...(p!.resolution ? { resolution: p!.resolution } : {}),
              ...(p!.mode === 'image' || p!.mode === 'first_last'
                ? { first_image: refs[0]!.url, ...(refs[1] ? { last_image: refs[1].url } : {}) }
                : {
                    ratio: p!.aspectRatio ?? '16:9',
                    ...(refs.length ? { referenceImages: refs.map((ref) => ref.url) } : {})
                  })
            }
          }
          if (minimax) {
            Object.assign(body, {
              duration: p!.duration ?? 5,
              resolution: p!.resolution ?? '720p',
              ...(p!.mode === 'image' || p!.mode === 'first_last'
                ? { first_image: refs[0]?.url, ...(refs[1] ? { last_image: refs[1].url } : {}) }
                : refs.length
                  ? { referenceImages: refs.map((r) => r.url) }
                  : { ratio: p!.aspectRatio ?? '16:9' })
            })
            delete (body as Record<string, unknown>).image
            delete (body as Record<string, unknown>).reference_images
            if (directMini)
              body = {
                model: o.model.remoteModelId,
                content: [
                  { type: 'text', text: p!.prompt },
                  ...refs.map((ref, index) => ({
                    type: 'image_url',
                    image_url: { url: ref.url },
                    role:
                      p!.mode === 'image' || p!.mode === 'first_last'
                        ? index === 0
                          ? 'first_frame'
                          : 'last_frame'
                        : 'reference_image'
                  }))
                ],
                duration: p!.duration ?? 5,
                resolution: '768P',
                ratio: refs.length ? 'adaptive' : (p!.aspectRatio ?? '16:9')
              }
          }
          submitted = true
          const value = JSON.parse(
            (
              await read(
                await o.fetcher(
                  new URL(
                    directMini
                      ? new URL('/v2/video_generation', base)
                      : veo
                        ? `v1beta/models/${o.model.remoteModelId}:predictLongRunning`
                        : grok
                          ? p!.mode === 'video'
                            ? 'videos/edits'
                            : 'videos/generations'
                          : 'videos',
                    base
                  ),
                  { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' }
                )
              )
            ).toString()
          ) as {
            id?: string
            request_id?: string
            task_id?: string
            name?: string
            task?: { id?: string }
          }
          id = value.id ?? value.request_id ?? value.task_id ?? value.name ?? value.task?.id
          if (!id || !(veo ? validOperation(id) : /^[-\w]{1,200}$/.test(id)))
            throw new Error('Missing or invalid remote video ID; do not automatically resubmit')
          await context.emit('log', {
            type: 'remote_task',
            remoteId: id,
            model: o.model,
            provider: Object.fromEntries(
              Object.entries(o.provider).filter(([key]) => key !== 'headers')
            )
          })
        }
        if (!(veo ? validOperation(id) : /^[-\w]{1,200}$/.test(id)))
          throw new Error('Invalid recovered video ID')
        for (let attempt = 0; attempt < 180; attempt++) {
          const value = JSON.parse(
            (
              await read(
                await o.fetcher(
                  directMini
                    ? new URL(`/v2/query/video_generation/${id}`, base)
                    : new URL(
                        veo ? (id.startsWith('v1beta/') ? id : `v1beta/${id}`) : `videos/${id}`,
                        base
                      ),
                  { headers, signal, redirect: 'error' }
                )
              )
            ).toString()
          ) as {
            status?: string
            progress?: number
            url?: string
            video?: { url?: string }
            done?: boolean
            error?: unknown
            task?: { status?: string; content?: { url?: string } }
          }
          if (value.task) {
            if (value.task.status) value.status = value.task.status
            if (value.task.content?.url) value.url = value.task.content.url
          }
          if (veo && value.done) {
            if (value.error) throw new Error('Veo generation failed')
            value.status = 'completed'
            const uri = findVideoUri(value)
            if (!uri) throw new Error('Veo completed without video URI')
            value.url = uri
          }
          await context.emit('log', {
            type: 'remote_progress',
            remoteId: id,
            status: value.status,
            ...(typeof value.progress === 'number' ? { progress: value.progress } : {})
          })
          if (['failed', 'cancelled', 'expired'].includes(value.status ?? ''))
            throw new Error('Remote video failed or cancelled')
          if (['completed', 'succeeded', 'done'].includes(value.status ?? '')) {
            const url = value.url ?? value.video?.url
            const target = url ? new URL(url, base) : undefined
            const bytes = target
              ? target.origin === base.origin
                ? await read(await o.fetcher(target, { headers, signal, redirect: 'error' }))
                : await downloadResult(target, signal)
              : await read(
                  await o.fetcher(new URL(`videos/${id}/content`, base), {
                    headers,
                    signal,
                    redirect: 'error'
                  })
                )
            const mime = videoMime(bytes)
            const asset = await o.assets.import(
              (async function* () {
                yield bytes
              })(),
              { mime, filename: `generated.${mime === 'video/mp4' ? 'mp4' : 'webm'}` }
            )
            await context.emit('asset', asset)
            return { assets: [asset], remoteId: id }
          }
          await delay(5000, undefined, { signal })
        }
        throw new Error('Video polling stopped; refresh persisted remote task to continue')
      } catch (error) {
        if (submitted || o.receipt) {
          await context
            .emit('log', { type: 'remote_uncertain', recoveryRequired: true, canResubmit: false })
            .catch(() => {})
          throw new CreativeReconciliationRequired(
            'Video outcome requires reconciliation; do not resubmit'
          )
        }
        throw error
      }
    }
  }
}
