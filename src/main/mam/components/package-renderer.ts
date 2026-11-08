import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import type { ComponentRegistry } from './registry'
import { openComponentWindow } from './component-window'

const requestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('spine.image.normalize'),
      source: z
        .string()
        .max(48 * 1024 * 1024)
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/)
    })
    .strict(),
  z
    .object({ operation: z.literal('spine.export'), project: z.record(z.string(), z.json()) })
    .strict()
])
export async function executePackageRenderer(
  registry: ComponentRegistry,
  request: CreativeRequest,
  input: unknown,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  if (request.componentId !== 'creative.spine') throw new Error('Renderer capability denied')
  const value = requestSchema.parse(input)
  if (value.operation !== request.operation) throw new Error('Renderer operation mismatch')
  if (JSON.stringify(value).length > 64 * 1024 * 1024) throw new Error('Renderer input too large')
  let window: BrowserWindow | undefined
  const cancel = () => {
    if (window && !window.isDestroyed()) window.destroy()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await openComponentWindow(registry, 'creative.spine', {
      preloadPath: '',
      version: request.componentVersion,
      entrypoint: 'spine-render.html',
      show: false,
      bind: (created) => {
        window = created
        if (signal.aborted) cancel()
      }
    })
    signal.throwIfAborted()
    if (!window || window.isDestroyed()) throw new Error('Renderer closed before execution')
    const result: unknown = await window.webContents.executeJavaScript(
      `globalThis.spineBusiness.run(${JSON.stringify(value)})`
    )
    signal.throwIfAborted()
    if (JSON.stringify(result).length > 72 * 1024 * 1024)
      throw new Error('Renderer output too large')
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
  }
}
