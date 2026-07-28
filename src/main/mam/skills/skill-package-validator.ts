import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ExecutorKindSchema, type ExecutorKind } from '../../../shared/mam/domain/execution-profile'

const MAX_FILES = 1_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_PACKAGE_BYTES = 20 * 1024 * 1024

export type ValidatedSkillPackage = Readonly<{
  canonicalPath: string
  name: string
  description: string
  declaredId?: string
  supportedExecutors?: readonly ExecutorKind[]
  contentDigest: string
}>

export async function validateSkillPackage(sourcePath: string): Promise<ValidatedSkillPackage> {
  const source = resolve(sourcePath)
  const sourceStat = await lstat(source)
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error('mam_skill_source_must_be_a_directory')
  }
  const canonicalPath = await realpath(source)
  const skillFile = join(canonicalPath, 'SKILL.md')
  const skillStat = await lstat(skillFile).catch(() => null)
  if (!skillStat?.isFile() || skillStat.isSymbolicLink()) {
    throw new Error('mam_skill_missing_skill_md')
  }

  const digest = createHash('sha256')
  const files = await collectFiles(canonicalPath)
  let packageBytes = 0
  let skillSource = ''
  for (const file of files) {
    const bytes = await readFile(file.absolutePath)
    packageBytes += bytes.byteLength
    if (packageBytes > MAX_PACKAGE_BYTES) throw new Error('mam_skill_package_too_large')
    digest.update(file.relativePath)
    digest.update('\0')
    digest.update(bytes)
    digest.update('\0')
    if (file.relativePath === 'SKILL.md') skillSource = bytes.toString('utf8')
  }
  return {
    canonicalPath,
    ...parseSkillMetadata(skillSource, basename(canonicalPath)),
    contentDigest: digest.digest('hex')
  }
}

async function collectFiles(
  root: string
): Promise<{ absolutePath: string; relativePath: string }[]> {
  const files: { absolutePath: string; relativePath: string }[] = []
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()!
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('mam_skill_symbolic_links_not_allowed')
      const canonicalEntry = await realpath(absolutePath)
      assertWithin(root, canonicalEntry)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }
      if (!entry.isFile()) throw new Error('mam_skill_special_files_not_allowed')
      const stat = await lstat(absolutePath)
      if (stat.size > MAX_FILE_BYTES) throw new Error('mam_skill_file_too_large')
      files.push({ absolutePath, relativePath: relative(root, absolutePath).split(sep).join('/') })
      if (files.length > MAX_FILES) throw new Error('mam_skill_too_many_files')
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function assertWithin(root: string, candidate: string): void {
  const traversal = relative(root, candidate)
  if (traversal === '..' || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    throw new Error('mam_skill_path_escape')
  }
}

function parseSkillMetadata(
  source: string,
  fallbackName: string
): Pick<ValidatedSkillPackage, 'name' | 'description' | 'declaredId' | 'supportedExecutors'> {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1]
  if (!frontmatter) return { name: fallbackName, description: firstParagraph(source) }
  const parsed = parseYaml(frontmatter)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('mam_skill_invalid_frontmatter')
  }
  const metadata = parsed as Record<string, unknown>
  const name =
    typeof metadata.name === 'string' && metadata.name.trim() ? metadata.name.trim() : fallbackName
  const description =
    typeof metadata.description === 'string'
      ? metadata.description.trim()
      : firstParagraph(source.slice(frontmatter.length))
  const declaredId =
    typeof metadata.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(metadata.id)
      ? metadata.id
      : undefined
  const executorInput = Array.isArray(metadata['mam-executors'])
    ? metadata['mam-executors']
    : undefined
  const supportedExecutors = executorInput
    ? ExecutorKindSchema.array().parse(executorInput)
    : undefined
  return {
    name,
    description,
    ...(declaredId ? { declaredId } : {}),
    ...(supportedExecutors ? { supportedExecutors } : {})
  }
}

function firstParagraph(source: string): string {
  return (
    source
      .replace(/^---[\s\S]*?---\s*/, '')
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.replace(/^#+\s*/, '').trim())
      .find(Boolean)
      ?.slice(0, 2_000) ?? ''
  )
}
