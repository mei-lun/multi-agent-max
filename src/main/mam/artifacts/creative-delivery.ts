import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile, lstat } from 'node:fs/promises'
import { join, posix } from 'node:path'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type {
  CreativeDelivery,
  CreativeDeliverySelection
} from '../../../shared/mam/creative-delivery'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import { assertAncestors } from '../components/registry/persistence'
import { BinaryArtifactStorage } from './binary-asset-storage'
import { publishBinaryDirectory } from './binary-directory-transaction'
import { restoreSubmittedArtifact, submittedArtifactRecord } from './restore-submitted-artifact'

export type CreativeDeliveryProject = {
  directory: string
  snapshot: MamUiSnapshot
  readProjectBlob(commit: string, path: string): string
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** The Git-submitted claim is authority; a transfer never creates a Task or marks it approved. */
export class CreativeDeliveryStore {
  private storage: BinaryArtifactStorage
  constructor(
    private root: string,
    private project: CreativeDeliveryProject
  ) {
    this.storage = new BinaryArtifactStorage(join(root, 'artifacts', 'binary'))
  }
  private resolve(selection: CreativeDeliverySelection) {
    const run = this.project.snapshot.runs.find((run) => run.run.id === selection.workflowRunId)
    const attempt = run?.attempts.find((item) => item.id === selection.attemptId)
    const task = run?.tasks.find((item) => item.id === attempt?.taskId)
    const claim = attempt?.result?.artifacts.find(
      (item) => item.contractId === selection.contractId
    )
    const contract = task?.outputContracts?.find(
      (item) => item.artifactType === selection.contractId
    )
    const commit = attempt?.result?.system.submittedCommit
    if (
      !claim ||
      !contract ||
      contract.format !== 'asset-bundle' ||
      !commit ||
      attempt?.result?.status !== 'submitted'
    )
      throw new Error('Binary delivery is not a submitted artifact in the current project')
    const path = posix.normalize(claim.contentRef.replaceAll('\\', '/'))
    if (
      !/^[a-f0-9]{7,64}$/i.test(commit) ||
      path === '.' ||
      path.startsWith('../') ||
      posix.isAbsolute(path) ||
      path.includes(':')
    )
      throw new Error('Invalid submitted artifact location')
    const bytes = Buffer.from(this.project.readProjectBlob(commit, path), 'utf8')
    if (bytes.length > contract.maxBytes || sha(bytes) !== claim.sha256)
      throw new Error('Submitted artifact integrity mismatch')
    const manifest = AssetBundleSchema.parse(JSON.parse(bytes.toString('utf8')))
    const record = submittedArtifactRecord(run!, attempt!, task!, selection.contractId, manifest)
    return { bytes, manifest, record, title: `${task!.title} · ${claim.type}` }
  }
  async list(): Promise<CreativeDelivery[]> {
    const results: CreativeDelivery[] = []
    for (const run of this.project.snapshot.runs)
      for (const attempt of run.attempts) {
        const task = run.tasks.find((item) => item.id === attempt.taskId)
        for (const contract of task?.outputContracts?.filter(
          (item) => item.format === 'asset-bundle'
        ) ?? []) {
          if (
            !attempt.result?.artifacts.some((claim) => claim.contractId === contract.artifactType)
          )
            continue
          const selection = {
            workflowRunId: run.run.id,
            attemptId: attempt.id,
            contractId: contract.artifactType
          }
          const { manifest, bytes, title } = this.resolve(selection)
          let available = true
          try {
            await this.storage.verify(manifest)
          } catch {
            available = false
          }
          results.push({
            ...selection,
            title,
            contentHash: sha(bytes),
            available,
            files: manifest.files.length,
            bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0)
          })
        }
      }
    return results
  }
  async export(selection: CreativeDeliverySelection, destination: string) {
    const { manifest, bytes } = this.resolve(selection)
    await this.storage.verify(manifest)
    await publishBinaryDirectory(destination, async (stage) => {
      await this.storage.materialize(manifest, join(stage, 'files'))
      await writeFile(join(stage, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 })
    })
  }
  async import(selection: CreativeDeliverySelection, source: string) {
    const expected = this.resolve(selection)
    const path = join(source, 'manifest.json')
    await assertAncestors(path)
    const details = await lstat(path)
    if (!details.isFile() || details.size !== expected.bytes.length)
      throw new Error('Delivery manifest does not match selected artifact')
    const bytes = await readFile(path)
    if (sha(bytes) !== sha(expected.bytes))
      throw new Error('Delivery manifest does not match submitted hash')
    const files = await Promise.all(
      expected.manifest.files.map(async (file) => {
        const path = join(source, 'files', ...file.logicalPath.split('/'))
        await assertAncestors(path)
        const details = await lstat(path)
        if (!details.isFile() || details.size !== file.bytes)
          throw new Error('Delivery file unavailable')
        return { logicalPath: file.logicalPath, mime: file.mime, stream: createReadStream(path) }
      })
    )
    const imported = await this.storage.import(files, expected.manifest.source)
    if (JSON.stringify(imported) !== JSON.stringify(expected.manifest))
      throw new Error('Delivery file integrity mismatch')
    await this.storage.verify(expected.manifest)
    await restoreSubmittedArtifact(join(this.root, 'artifacts'), expected.record)
  }
}
