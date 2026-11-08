import { lookup } from 'node:dns/promises'
import { request, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import { isPublicAddress } from '../../media/result-download'
export async function fetchPublicText(url: URL, cancel?: AbortSignal) {
  cancel?.throwIfAborted()
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
    throw new Error('Public HTTPS required')
  const host = url.hostname.replace(/^\[|\]$/g, ''),
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true })
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address.address)))
    throw new Error('Nonpublic address')
  const selected = addresses[0]!,
    signal = cancel
      ? AbortSignal.any([cancel, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000)
  return new Promise<string>((resolve, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      signal,
      agent: false,
      autoSelectFamily: false,
      family: selected.family,
      lookup: (_host, _options, callback) => callback(null, selected.address, selected.family)
    }
    const req = request(url, options, (response) => {
      const type = response.headers['content-type'] ?? ''
      if (
        response.statusCode !== 200 ||
        !/^(text\/|application\/(json|xml|xhtml\+xml))/i.test(type) ||
        Number(response.headers['content-length']) > 1024 * 1024
      ) {
        response.destroy()
        reject(new Error('Not bounded web text'))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1024 * 1024) response.destroy(new Error('Web text too large'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(30000, () => req.destroy(new Error('Web timeout')))
    req.on('error', reject)
    req.end()
  })
}
