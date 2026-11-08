import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'

export function configureSmokeUserData(): void {
  const preview = process.env.MAM_CREATIVE_PREVIEW_DATA
  const directory = preview ?? process.env.MAM_DESKTOP_SMOKE_USER_DATA
  if ((!preview && process.env.MAM_DESKTOP_SMOKE !== '1') || !directory) return
  if (!isAbsolute(directory)) throw new Error('MAM_DESKTOP_SMOKE_USER_DATA must be absolute')
  mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
}
