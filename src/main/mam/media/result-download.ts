import { lookup } from 'node:dns/promises'
import { request, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 2, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    )
  }
  // Limit to global unicast; exclude mapped, transition, documentation and special ranges.
  const value = address.toLowerCase()
  return isIP(value) === 6 && /^[23]/.test(value) && !/^(2001:|2002:|3fff:)/.test(value)
}

export async function downloadResult(url: URL, signal: AbortSignal): Promise<Buffer> {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Invalid result URL')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true })
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error('Non-public result destination')
  const selected = addresses[0]!
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      signal,
      agent: false,
      autoSelectFamily: false,
      family: selected.family,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family)
    }
    const req = request(url, options, (response) => {
      if (response.statusCode !== 200) {
        response.destroy()
        reject(new Error('Result download HTTP failure'))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 32 * 1024 * 1024) response.destroy(new Error('Result download too large'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.setTimeout(30000, () => req.destroy(new Error('Result download timed out')))
    req.on('error', reject)
    req.end()
  })
}
