export function inspectVideo(bytes: Buffer): string | undefined {
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const length = bytes.readUInt32BE(0)
    if (length < 16 || length > bytes.length || length > 4096) throw new Error('Invalid MP4 header')
    const brands = [bytes.toString('ascii', 8, 12)]
    for (let offset = 16; offset + 4 <= length; offset += 4)
      brands.push(bytes.toString('ascii', offset, offset + 4))
    if (!brands.some((brand) => /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV)$/.test(brand)))
      throw new Error('Unsupported MP4 brand')
    return 'video/mp4'
  }
  return undefined
}
