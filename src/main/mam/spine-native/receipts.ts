import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
export type Receipt = {
  jobId: string
  endpoint: string
  projectId: string
  componentId: string
  promptId?: string
  submitted?: boolean
}
export class SpineReceipts {
  constructor(private directory: string) {}
  private file(request: CreativeRequest, endpoint: string, id: string) {
    return join(
      this.directory,
      createHash('sha256')
        .update(JSON.stringify([request.projectId, request.componentId, endpoint, id]))
        .digest('hex') + '.json'
    )
  }
  async get(request: CreativeRequest, endpoint: string, id: string): Promise<Receipt | undefined> {
    try {
      return JSON.parse(await readFile(this.file(request, endpoint, id), 'utf8')) as Receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  async put(request: CreativeRequest, endpoint: string, receipt: Receipt) {
    await mkdir(this.directory, { recursive: true })
    const file = this.file(request, endpoint, receipt.jobId),
      temporary = file + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
    await rename(temporary, file)
  }
  async prompt(request: CreativeRequest, endpoint: string, promptId: string) {
    const files = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const file of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue
      const receipt = JSON.parse(await readFile(join(this.directory, file), 'utf8')) as Receipt
      if (
        receipt.projectId === request.projectId &&
        receipt.componentId === request.componentId &&
        receipt.endpoint === endpoint &&
        receipt.promptId === promptId
      )
        return receipt
    }
  }
}
