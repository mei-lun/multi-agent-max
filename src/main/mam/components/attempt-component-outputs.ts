import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assetRefSchema,
  type AssetRef,
  type CreativeJob
} from '../../../shared/mam/creative-runtime'
import { BinaryArtifactStorage } from '../artifacts/binary-asset-storage'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import type { ComponentExecutionPort } from '../application/component-execution-port'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { recordComponentPublication } from './attempt-component-ledger'
export async function publishComponentOutputs(
  input: Pick<
    Parameters<ComponentExecutionPort['execute']>[0],
    'workspace' | 'outputContracts' | 'authority' | 'signal'
  >,
  result: CreativeJob,
  services: DesktopCreativeServices,
  root: string
) {
  const { authority } = input
  const component = {
    id: result.request.componentId,
    version: result.request.componentVersion,
    operation: result.request.operation
  }
  input.signal.throwIfAborted()
  if (
    result.state !== 'succeeded' ||
    result.request.attempt?.id !== authority.attemptId ||
    result.request.projectId !== authority.workflowRunId
  )
    throw new Error('Completed owned component job required')
  const outputs = new Map<string, AssetRef>()
  for (const event of result.events) {
    if (event.type !== 'asset') continue
    const ref = assetRefSchema.parse(event.data)
    await services.assets.read(ref)
    outputs.set(ref.id, ref)
  }
  const final = result.events.at(-1)?.data
  if (final && typeof final === 'object' && 'partial' in final && final.partial)
    throw new Error('Component returned partial output; review retained job results')
  const binaries = new BinaryArtifactStorage(join(root, 'artifacts', 'binary'))
  const refs = [...outputs.values()]
  const bundle = refs.length
    ? await binaries.import(
        refs.map((ref, index) => ({
          logicalPath: `${index + 1}-${ref.filename}`,
          mime: ref.mime,
          stream: (async function* () {
            yield await services.assets.read(ref)
          })()
        })),
        {
          componentId: component.id,
          componentVersion: component.version,
          operation: component.operation
        }
      )
    : undefined
  await mkdir(input.workspace, { recursive: true })
  const claims = []
  for (const contract of input.outputContracts) {
    const value =
      contract.format === 'asset-bundle'
        ? bundle
        : contract.format === 'markdown'
          ? textValue(final)
          : final
    if (value === undefined) {
      if (contract.required) throw new Error('Required component output absent')
      continue
    }
    const bytes = validateAndEncodeArtifactContent(contract, value)
    const contentRef = `.mam-component-${createHash('sha256')
      .update(authority.attemptId + result.id + contract.artifactType)
      .digest('hex')
      .slice(0, 16)}.json`
    input.signal.throwIfAborted()
    try {
      await writeFile(join(input.workspace, contentRef), bytes, { flag: 'wx' })
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        !(await readFile(join(input.workspace, contentRef))).equals(bytes)
      )
        throw error
    }
    claims.push({
      contractId: contract.artifactType,
      type: contract.artifactType,
      contentRef,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }

  await recordComponentPublication(root, authority, input.workspace, claims)
  return claims
}
function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  return value && typeof value === 'object' && 'text' in value && typeof value.text === 'string'
    ? value.text
    : undefined
}
