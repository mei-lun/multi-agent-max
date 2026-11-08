import { executionAssetRef } from './media-execution'
export { agentTurnStream, cancelAgentTurn, exportWritingFile } from './text-bridge'
export {
  generateMedia,
  getMediaCatalog,
  getModelCatalog,
  listMediaAssets,
  mediaAssetUrl,
  selectImageReferences,
  importAttachments,
  importClipboardImages,
  getProviderSettings,
  onMediaAssetUpdate,
  refreshMediaAsset
} from './media-bridge'
import { selectImageReferences, mediaAssetUrl } from './media-bridge'
const request = (action: string, params = {}) =>
  window.componentHost?.request({ action, ...params })
export const isDesktop = () => Boolean(window.componentHost)
export const listThreadSummaries = () => request('listConversations')
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('mam.creative.constellation', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' })
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
async function store(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest) {
  const db = await database
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction('projects', mode),
      r = fn(tx.objectStore('projects'))
    tx.oncomplete = () => resolve(r.result)
    tx.onerror = () => reject(tx.error)
  })
}
export const listConstellationProjects = () => store('readonly', (s) => s.getAll())
export const deleteConstellationProject = (id: string) => store('readwrite', (s) => s.delete(id))
export async function saveConstellationProject(record: any) {
  if (new TextEncoder().encode(JSON.stringify(record)).length > 16 * 1024 * 1024)
    throw Error('星图超过16MiB')
  await store('readwrite', (s) => s.put(structuredClone(record)))
  return record
}
export const selectSingleImageReference = async () => (await selectImageReferences())[0] || null
export const selectVideoReference = async () => {
  const ref = await request('importAsset')
  if (!ref) return null
  if (ref.mime !== 'video/mp4') throw Error('请选择MP4视频')
  return {
    ...ref,
    name: ref.filename,
    mimeType: ref.mime,
    url: await request('previewAsset', { ref })
  }
}
export const importMediaReferences = async (paths?: string[]) =>
  paths?.length ? importLocalResources(paths, []) : selectImageReferences()
export const previewAttachment = async (attachment: any) => ({
  url: attachment.previewUrl || attachment.url
})
export async function exportMediaAsset(asset: any) {
  const { id, sha256, bytes, mime, filename } = asset.assetRef || asset
  return request('exportAsset', { ref: { id, sha256, bytes, mime, filename } })
}
export const deleteImageAttachment = async () => {
  throw Error('此处不删除宿主共享资产。')
}
export const deleteMediaAsset = deleteImageAttachment
export const openMediaDirectory = async () => {
  throw Error('请使用导出原始文件。')
}
const toolTokens = new Map<string, string>()
export async function harnessCheckTool(input: any) {
  const call = input.call
  if (!['read_file', 'list_files', 'search_files', 'web_fetch', 'run_command'].includes(call.name))
    throw Error('工具不支持')
  const args = structuredClone(call.arguments || {})
  if (call.name === 'web_fetch') delete args.maxChars
  const result = await request('toolCheck', { call: { name: call.name, args } })
  if (result.decision === 'allow' && result.token) toolTokens.set(call.id, result.token)
  return result.decision
}
export async function executeTool(call: any) {
  const token = toolTokens.get(call.id)
  toolTokens.delete(call.id)
  if (!token) throw Error('工具需要重新授权')
  return request('toolExecute', { token })
}
const localAssets = new Map<string, any>()
try {
  for (const [token, ref] of JSON.parse(
    localStorage.getItem('mam.constellation.local-assets') || '[]'
  ))
    localAssets.set(token, ref)
} catch {}
export const selectLocalResourcePaths = async () => {
  const ref = await request('importAsset', { kind: 'file' })
  if (!ref) return []
  const token = `mam-asset:${ref.id}`
  localAssets.set(token, ref)
  localStorage.setItem('mam.constellation.local-assets', JSON.stringify([...localAssets]))
  return [token]
}
export async function importLocalResources(paths: string[], existing: any[] = []) {
  const values = new Map(existing.map((item) => [item.id, item]))
  for (const token of paths) {
    if (typeof token !== 'string' || (!token.startsWith('mam-asset:') && !executionAssetRef(token)))
      throw Error('请使用“选择文件”导入。此组件不能读取手动输入的文件路径。')
    const ref = localAssets.get(token) || executionAssetRef(token)
    if (!ref) throw Error('文件授权标识已失效，请重新选择文件。')
    const { id, sha256, bytes, mime, filename } = ref
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime.startsWith('video/')
        ? 'video'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'file'
    const url = ['image', 'video', 'audio'].includes(kind)
      ? await request('previewAsset', { ref: { id, sha256, bytes, mime, filename } })
      : undefined
    values.set(id, {
      id,
      name: filename,
      mimeType: mime,
      size: bytes,
      kind,
      path: token,
      assetRef: { id, sha256, bytes, mime, filename },
      previewUrl: url,
      url,
      content:
        kind === 'file'
          ? (
              await request('readAssetText', {
                ref: { id, sha256, bytes, mime, filename },
                maxBytes: 1024 * 1024
              })
            ).text
          : undefined
    })
  }
  return [...values.values()]
}
