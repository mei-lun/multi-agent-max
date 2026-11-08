export function inspectImage(bytes: Buffer): string {
  if (bytes.length > 32 * 1024 * 1024 || bytes.length < 24) throw new Error('Invalid image size')
  let width = 0,
    height = 0,
    mime = ''
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    width = bytes.readUInt32BE(16)
    height = bytes.readUInt32BE(20)
    mime = 'image/png'
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 9 < bytes.length; ) {
      if (bytes[offset] !== 255) break
      const marker = bytes[offset + 1]!
      const length = bytes.readUInt16BE(offset + 2)
      if ([192, 193, 194].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5)
        width = bytes.readUInt16BE(offset + 7)
        mime = 'image/jpeg'
        break
      }
      if (length < 2) break
      offset += length + 2
    }
  } else if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 16) === 'WEBPVP8X'
  ) {
    width = bytes.readUIntLE(24, 3) + 1
    height = bytes.readUIntLE(27, 3) + 1
    mime = 'image/webp'
  }
  if (!mime || !width || !height || width > 16384 || height > 16384 || width * height > 40000000)
    throw new Error('Unsupported image or dimensions')
  return mime
}
