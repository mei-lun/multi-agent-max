import { expect, test } from 'vitest'
import { inspectVideo } from './host-video-inspection'

test('recognizes supported MP4 brands and rejects truncated or unrelated ISO image containers', () => {
  const video = Buffer.alloc(24)
  video.writeUInt32BE(24)
  video.write('ftyp', 4)
  video.write('isom', 8)
  video.write('mp42', 16)
  expect(inspectVideo(video)).toBe('video/mp4')
  expect(() => inspectVideo(video.subarray(0, 16))).toThrow('Invalid MP4')
  const image = Buffer.from(video)
  image.write('avif', 8)
  image.write('avif', 16)
  expect(() => inspectVideo(image)).toThrow('Unsupported MP4')
  expect(inspectVideo(Buffer.from('not a video file'))).toBeUndefined()
})
