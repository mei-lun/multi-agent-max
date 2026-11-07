import { BrowserWindow, session } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { readFile, lstat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import type { ComponentRegistry } from './registry'
import { assertAncestors } from './registry/persistence'
import type { ComponentId, ComponentManifest } from '../../../shared/mam/components'

const mimeTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
}

export async function openComponentWindow(
  registry: ComponentRegistry,
  id: ComponentId,
  host?: { preloadPath: string; bind(window: BrowserWindow, manifest: ComponentManifest): void }
): Promise<void> {
  const lease = await registry.acquire(id)
  const isolated = session.fromPartition(`mam-component-${randomUUID()}`)
  const allowedHost = 'package'
  try {
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel:
          !details.url.startsWith(`mam-component://${allowedHost}/`) &&
          !details.url.startsWith('data:') &&
          !details.url.startsWith('blob:')
      })
    })
    await isolated.protocol.handle('mam-component', async (request) => {
      try {
        const url = new URL(request.url)
        const relative = decodeURIComponent(url.pathname).replace(/^\//, '')
        const expected = lease.manifest.files[relative]
        if (url.hostname !== allowedHost || !expected || request.method !== 'GET')
          return new Response(null, { status: 404 })
        let file = lease.packageDirectory
        await assertAncestors(file)
        for (const part of relative.split('/')) {
          file = join(file, part)
          if ((await lstat(file)).isSymbolicLink()) return new Response(null, { status: 403 })
        }
        const bytes = await readFile(file)
        if (createHash('sha256').update(bytes).digest('hex') !== expected)
          return new Response(null, { status: 409 })
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': mimeTypes[extname(relative)] ?? 'application/octet-stream',
            'Content-Security-Policy':
              "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'",
            'X-Content-Type-Options': 'nosniff'
          }
        })
      } catch {
        return new Response(null, { status: 400 })
      }
    })
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 720,
      minHeight: 560,
      show: false,
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        ...(host ? { preload: host.preloadPath } : {})
      }
    })
    host?.bind(window, lease.manifest)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) => event.preventDefault())
    window.once('closed', () => {
      isolated.protocol.unhandle('mam-component')
      lease.release()
    })
    try {
      const entry = lease.manifest.uiEntrypoint.split('/').map(encodeURIComponent).join('/')
      await window.loadURL(`mam-component://${allowedHost}/${entry}`)
      window.show()
    } catch (error) {
      window.destroy()
      throw error
    }
  } catch (error) {
    isolated.protocol.unhandle('mam-component')
    lease.release()
    throw error
  }
}
