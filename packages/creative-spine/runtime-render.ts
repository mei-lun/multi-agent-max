import {
  normalizeSpineImage,
  exportSpineArchive
} from '../../vendor/levelup/baseline-6542241/src/lib/spineAssets'
import type { SpineRender } from './runtime-business'

// Execute only in the host's isolated, network-disabled Canvas renderer.
export const renderSpineBusiness: SpineRender = async (request) => {
  if (request.operation === 'spine.image.normalize' && request.source)
    return normalizeSpineImage(request.source)
  if (request.operation === 'spine.export' && request.project) {
    const archive = await exportSpineArchive(request.project)
    let binary = ''
    for (let offset = 0; offset < archive.length; offset += 32768)
      binary += String.fromCharCode(...archive.subarray(offset, offset + 32768))
    return { mimeType: 'application/zip', base64: btoa(binary) }
  }
  throw new Error('Invalid Spine rendering request')
}
