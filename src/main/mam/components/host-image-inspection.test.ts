import { describe, expect, it } from 'vitest'
import { inspectImage } from './host-image-inspection'
describe('bounded image intake', () => {
  const png = (width: number, height: number) => {
    const bytes = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
    bytes.write('IHDR', 12)
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    return bytes
  }
  it('detects PNG dimensions before decoding', () => {
    expect(inspectImage(png(1024, 768))).toBe('image/png')
    expect(() => inspectImage(png(100000, 100000))).toThrow()
    expect(() => inspectImage(Buffer.alloc(24))).toThrow()
    expect(() => inspectImage(png(0, 10))).toThrow()
  })
})
