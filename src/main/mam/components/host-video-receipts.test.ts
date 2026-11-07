import { expect, test } from 'vitest'
import type { CreativeJob, CreativeRequest } from '../../../shared/mam/creative-runtime'
import { resolveHostVideoReceipt } from './host-video-receipts'

test('Veo operation receipt binds model and denies traversal or swapped model', () => {
  const source = fixture(),
    data = source.events[0]!.data as {
      remoteId: string
      model: { remoteModelId: string }
      provider: { protocol: string }
    }
  data.provider.protocol = 'google-generative-ai'
  data.model.remoteModelId = 'veo-3'
  data.remoteId = 'models/veo-3/operations/one'
  expect(resolveHostVideoReceipt(() => source, 'original', refresh)?.remoteId).toBe(data.remoteId)
  for (const invalid of ['models/other/operations/one', 'models/veo-3/operations/../secret']) {
    data.remoteId = invalid
    expect(resolveHostVideoReceipt(() => source, 'original', refresh)).toBeUndefined()
  }
})

const refresh: CreativeRequest = {
  componentId: 'creative.video',
  componentVersion: '1.0.0',
  projectId: 'p',
  operation: 'video.refresh',
  idempotencyKey: 'refresh',
  inputAssets: [],
  params: { sourceJobId: 'original' }
}
function fixture(): CreativeJob {
  return {
    id: 'original',
    state: 'reconciliation-required',
    request: {
      ...refresh,
      operation: 'video.generate',
      params: { modelProfileId: 'm', prompt: 'scene', mode: 'text' }
    },
    events: [
      {
        sequence: 1,
        type: 'log',
        at: new Date().toISOString(),
        data: {
          type: 'remote_task',
          remoteId: 'remote-id',
          model: {
            id: 'm',
            version: 1,
            displayName: 'Video',
            providerProfileId: 'provider',
            remoteModelId: 'sora-2',
            capabilities: {
              modalities: ['text'],
              supportsTools: false,
              supportsStructuredOutput: false
            }
          },
          provider: {
            id: 'provider',
            version: 1,
            protocol: 'openai-completions',
            baseUrl: 'https://provider.example/v1/',
            secretRef: 'secret-reference'
          }
        }
      }
    ]
  }
}
test('recovered durable receipt remains frozen and does not change source outcome', () => {
  const source = fixture()
  const receipt = resolveHostVideoReceipt(() => source, 'original', refresh)!
  expect(receipt.remoteId).toBe('remote-id')
  receipt.provider.baseUrl = 'https://mutated.example/'
  expect(resolveHostVideoReceipt(() => source, 'original', refresh)?.provider.baseUrl).toBe(
    'https://provider.example/v1/'
  )
  expect(source.state).toBe('reconciliation-required')
  expect(JSON.stringify(receipt)).not.toContain('Authorization')
})
test('foreign lineage and renderer-supplied overrides cannot recover receipts', () => {
  for (const patch of [
    { projectId: 'foreign' },
    { componentId: 'foreign' },
    { componentVersion: '2.0.0' },
    { operation: 'text.generate' },
    { params: { sourceJobId: 'original', modelProfileId: 'other' } },
    { params: { sourceJobId: 'other' } },
    { inputAssets: [{}] }
  ]) {
    expect(
      resolveHostVideoReceipt(() => fixture(), 'original', {
        ...refresh,
        ...patch
      } as CreativeRequest)
    ).toBeUndefined()
  }
  expect(resolveHostVideoReceipt(() => undefined, 'original', refresh)).toBeUndefined()
})
test('mismatched models/providers, non-video sources and credential-bearing receipts rejected', () => {
  for (const patch of [
    { model: { id: 'other' } },
    { model: { providerProfileId: 'other' } },
    { model: { remoteModelId: 'chat-model' } },
    { provider: { headers: { Authorization: 'Bearer raw-secret' } } },
    { provider: { baseUrl: 'https://user:raw-secret@provider.example/' } }
  ]) {
    const source = fixture()
    const data = source.events[0]!.data as {
      model: Record<string, unknown>
      provider: Record<string, unknown>
    }
    if (patch.model) Object.assign(data.model, patch.model)
    if (patch.provider) Object.assign(data.provider, patch.provider)
    expect(resolveHostVideoReceipt(() => source, 'original', refresh)).toBeUndefined()
  }
  const source = fixture()
  source.request.operation = 'video.refresh'
  expect(resolveHostVideoReceipt(() => source, 'original', refresh)).toBeUndefined()
})
