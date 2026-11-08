import { expect, test } from 'vitest'
import { projectMedia } from './host-project-media'
import type { CreativeJob } from '../../../shared/mam/creative-runtime'
import type { ComponentManifest } from '../../../shared/mam/components'

test('project library requires declared permission and never lists foreign projects or arbitrary log refs', () => {
  const ref = {
    id: '11111111-1111-4111-8111-111111111111',
    sha256: 'a'.repeat(64),
    bytes: 8,
    mime: 'image/png',
    filename: 'image.png'
  }
  const job = {
    id: 'job',
    request: { projectId: 'one', params: { prompt: 'art', modelProfileId: 'model' } },
    events: [{ sequence: 1, type: 'asset', at: '2026-11-07T00:00:00.000Z', data: ref }]
  } as unknown as CreativeJob
  const manifest = {
    operations: [{ requiredCapabilities: ['assets.projectMedia'] }]
  } as unknown as ComponentManifest
  expect(projectMedia([job], 'one', manifest, 'image', 24).assets[0]?.ref).toEqual(ref)
  expect(projectMedia([job], 'two', manifest, 'image', 24).total).toBe(0)
  expect(
    projectMedia(
      [{ ...job, events: [{ ...job.events[0]!, type: 'log' }] }],
      'one',
      manifest,
      'image',
      24
    ).total
  ).toBe(0)
  expect(() =>
    projectMedia([job], 'one', { operations: [] } as unknown as ComponentManifest, 'image', 24)
  ).toThrow('permission')
})
