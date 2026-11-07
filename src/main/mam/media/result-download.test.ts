import { test, expect } from 'vitest'
import { isPublicAddress, downloadResult } from './result-download'

test('rejects private, special and mapped IP destinations', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '::1',
    '::ffff:8.8.8.8',
    '2001:db8::1',
    'fc00::1',
    'fe80::1'
  ]) {
    expect(isPublicAddress(ip), ip).toBe(false)
    await expect(
      downloadResult(
        new URL(`https://${ip.includes(':') ? `[${ip}]` : ip}/`),
        new AbortController().signal
      )
    ).rejects.toThrow()
  }
  expect(isPublicAddress('8.8.8.8')).toBe(true)
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
})
test('rejects endpoint credential and port overrides before DNS', async () => {
  for (const url of [
    'http://example.org/',
    'https://user:pass@example.org/',
    'https://example.org:8443/'
  ])
    await expect(downloadResult(new URL(url), new AbortController().signal)).rejects.toThrow(
      'Invalid result URL'
    )
})
