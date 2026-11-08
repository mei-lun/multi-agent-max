import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ProfileCatalog } from '../profiles/profile-catalog'
import { saveModelConnectionProfiles } from './model-connection-command'

test('media connections retain media capabilities without being advertised as coding models', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mam-media-connection-'))
  try {
    const profiles = new ProfileCatalog(root)
    for (const remoteModelId of [
      'gpt-image-2',
      'tts-1',
      'gpt-text-fixture',
      'grok-imagine-video'
    ]) {
      saveModelConnectionProfiles(
        {
          displayName: remoteModelId,
          protocol: 'openai-completions',
          baseUrl: 'http://127.0.0.1:1234/v1',
          remoteModelId
        },
        profiles
      )
    }
    const models = profiles.models.listActive()
    const image = models.find((model) => model.remoteModelId === 'gpt-image-2')!
    expect(image.capabilities).toEqual({
      modalities: ['image'],
      supportsTools: false,
      supportsStructuredOutput: false
    })
    expect(image.defaultInference).toBeUndefined()
    expect(
      models.find((model) => model.remoteModelId === 'grok-imagine-video')?.capabilities
    ).toEqual({ modalities: ['video'], supportsTools: false, supportsStructuredOutput: false })
    expect(
      models.find((model) => model.remoteModelId === 'tts-1')?.capabilities.modalities
    ).toEqual(['audio'])
    expect(
      models.find((model) => model.remoteModelId === 'gpt-text-fixture')?.capabilities.supportsTools
    ).toBe(true)
    saveModelConnectionProfiles(
      {
        displayName: 'Vision',
        protocol: 'openai-completions',
        remoteModelId: 'vision-fixture',
        supportsImageInput: true
      },
      profiles
    )
    expect(
      profiles.models.listActive().find((model) => model.remoteModelId === 'vision-fixture')
        ?.capabilities.modalities
    ).toEqual(['text', 'image'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
