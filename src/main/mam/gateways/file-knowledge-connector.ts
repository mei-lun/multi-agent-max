import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ResolvedKnowledgeResource } from '../profiles/attempt-config-resolver'
import type {
  KnowledgeConnector,
  KnowledgeReadInput,
  KnowledgeSearchInput
} from './knowledge-gateway'

export type FileKnowledgeSearchResult = Readonly<{
  matches: readonly Readonly<{
    documentRef: string
    line: number
    excerpt: string
  }>[]
  truncated: boolean
  indexRevision?: string
}>

export type FileKnowledgeReadResult = Readonly<{
  documentRef: string
  content: string
  contentHash: string
  bytes: number
  indexRevision?: string
}>

export class FileKnowledgeConnectorError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'FileKnowledgeConnectorError'
  }
}

export class FileKnowledgeConnector implements KnowledgeConnector {
  private readonly projectRoot: string

  constructor(
    projectRoot: string,
    private readonly maxFileBytes = 1_000_000,
    private readonly maxFiles = 10_000
  ) {
    this.projectRoot = resolve(projectRoot)
  }

  async search(
    resource: ResolvedKnowledgeResource,
    input: KnowledgeSearchInput
  ): Promise<FileKnowledgeSearchResult> {
    if (input.filters && Object.keys(input.filters).length > 0) {
      fail(
        'knowledge_filters_unsupported',
        'File Knowledge connector cannot safely evaluate metadata filters'
      )
    }
    const root = await this.collectionRoot(resource, input.collection)
    const files = await collectFiles(root, this.maxFiles)
    const query = input.query.toLocaleLowerCase()
    let remainingCharacters = input.maxContextTokens * 4
    const matches: Array<{ documentRef: string; line: number; excerpt: string }> = []
    for (const path of files.paths) {
      if (matches.length >= input.topK || remainingCharacters <= 0) break
      const metadata = await stat(path)
      if (metadata.size > this.maxFileBytes) continue
      const content = await readFile(path)
      if (content.includes(0)) continue
      const lines = content.toString('utf8').split(/\r?\n/)
      for (const [index, line] of lines.entries()) {
        if (!line.toLocaleLowerCase().includes(query)) continue
        const excerpt = line.trim().slice(0, remainingCharacters)
        if (!excerpt) continue
        matches.push({ documentRef: relative(root, path), line: index + 1, excerpt })
        remainingCharacters -= excerpt.length
        if (matches.length >= input.topK || remainingCharacters <= 0) break
      }
    }
    return {
      matches,
      truncated: files.truncated || remainingCharacters <= 0,
      ...indexRevision(resource)
    }
  }

  async read(
    resource: ResolvedKnowledgeResource,
    input: KnowledgeReadInput
  ): Promise<FileKnowledgeReadResult> {
    const root = await this.collectionRoot(resource, input.collection)
    const target = await resolveContainedFile(root, input.documentRef)
    const metadata = await stat(target)
    if (metadata.size > this.maxFileBytes) {
      fail('knowledge_document_too_large', 'Knowledge document exceeds the local read limit')
    }
    const content = await readFile(target)
    if (content.includes(0)) fail('knowledge_document_binary', 'Knowledge document is not text')
    return {
      documentRef: relative(root, target),
      content: content.toString('utf8'),
      contentHash: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength,
      ...indexRevision(resource)
    }
  }

  private async collectionRoot(
    resource: ResolvedKnowledgeResource,
    collection?: string
  ): Promise<string> {
    const base = await knowledgeRoot(resource, this.projectRoot)
    if (!collection) return base
    const collectionPath = resource.profile.metadata?.[`collection.${collection}`]
    if (!collectionPath) {
      fail('knowledge_collection_unmapped', `Collection ${collection} has no local path mapping`)
    }
    return resolveContainedDirectory(base, collectionPath)
  }
}

async function knowledgeRoot(
  resource: ResolvedKnowledgeResource,
  projectRoot: string
): Promise<string> {
  if (resource.status !== 'available') {
    fail('knowledge_base_degraded', 'Knowledge Base is degraded')
  }
  if (resource.profile.kind === 'vector-store' || resource.profile.kind === 'mcp-resource') {
    fail(
      'knowledge_connector_kind_unsupported',
      `File connector does not support ${resource.profile.kind}`
    )
  }
  const localPath = resource.localBinding?.sourcePath
  if (localPath) {
    if (!isAbsolute(localPath)) {
      fail('knowledge_source_not_absolute', 'Local Knowledge binding path must be absolute')
    }
    return requireDirectory(await realpath(localPath))
  }
  if (resource.profile.kind === 'local-directory') {
    fail('knowledge_binding_unavailable', 'Local directory Knowledge Base has no local binding')
  }
  if (isAbsolute(resource.profile.sourceRef)) {
    fail(
      'knowledge_shared_source_absolute',
      'Shared Knowledge sourceRef must be repository-relative'
    )
  }
  return resolveContainedDirectory(await realpath(projectRoot), resource.profile.sourceRef)
}

async function resolveContainedDirectory(root: string, child: string): Promise<string> {
  if (isAbsolute(child)) fail('knowledge_path_escape', 'Knowledge path must be relative')
  const unresolved = resolve(root, child)
  assertContained(root, unresolved)
  const target = await realpath(unresolved)
  assertContained(root, target)
  return requireDirectory(target)
}

async function resolveContainedFile(root: string, child: string): Promise<string> {
  if (isAbsolute(child)) fail('knowledge_path_escape', 'Knowledge document ref must be relative')
  const unresolved = resolve(root, child)
  assertContained(root, unresolved)
  const target = await realpath(unresolved)
  assertContained(root, target)
  const metadata = await lstat(target)
  if (!metadata.isFile()) fail('knowledge_document_not_file', 'Knowledge document is not a file')
  return target
}

function assertContained(root: string, target: string): void {
  const traversal = relative(root, target)
  if (traversal === '..' || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    fail('knowledge_path_escape', 'Knowledge path escapes the configured source')
  }
}

async function requireDirectory(path: string): Promise<string> {
  if (!(await stat(path)).isDirectory()) {
    fail('knowledge_source_not_directory', 'Knowledge source is not a directory')
  }
  return path
}

async function collectFiles(
  root: string,
  maxFiles: number
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = []
  let truncated = false
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (paths.length >= maxFiles) {
        truncated = true
        return
      }
      if (entry.isSymbolicLink() || entry.name === '.git') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) paths.push(path)
    }
  }
  await visit(root)
  return { paths, truncated }
}

function indexRevision(resource: ResolvedKnowledgeResource): { indexRevision?: string } {
  const value = resource.localBinding?.indexRevision ?? resource.profile.indexRevision
  return value ? { indexRevision: value } : {}
}

function fail(code: string, message: string): never {
  throw new FileKnowledgeConnectorError(code, message)
}
