import { isAbsolute, posix } from 'node:path'
import Ajv from 'ajv'
import { minimatch } from 'minimatch'
import { z } from 'zod'
import type { ArtifactContract, ArtifactVersion } from '../../../shared/mam/domain/artifact'
import { ArtifactStoreError } from './artifact-store-error'

export const TestReportContentSchema = z
  .object({
    framework: z.string().min(1),
    status: z.enum(['passed', 'failed']),
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    summary: z.string().min(1)
  })
  .strict()
  .superRefine((report, context) => {
    if (report.passed + report.failed + report.skipped !== report.total) {
      context.addIssue({ code: 'custom', message: 'test counts must equal total' })
    }
    if ((report.status === 'passed') !== (report.failed === 0)) {
      context.addIssue({ code: 'custom', message: 'test status must match failed count' })
    }
  })

export type FileSetContent = Readonly<{
  files: readonly Readonly<{ path: string; content: string }>[]
}>

export function validateAndEncodeArtifactContent(
  contract: ArtifactContract,
  content: unknown
): Buffer {
  switch (contract.format) {
    case 'json-schema': {
      const validator = new Ajv({ allErrors: true, strict: false }).compile(contract.jsonSchema!)
      if (!validator(content)) {
        throw new ArtifactStoreError(
          'artifact_contract_invalid',
          validator.errors?.map((error) => error.message).join('; ') ?? 'invalid JSON Artifact'
        )
      }
      return Buffer.from(canonicalJson(content))
    }
    case 'markdown': {
      if (typeof content !== 'string') {
        return invalidContent('Markdown Artifact must be text')
      }
      const missing = contract.requiredSections!.filter(
        (section) => !new RegExp(`^#{1,6}\\s+${escapeRegex(section)}\\s*$`, 'im').test(content)
      )
      if (missing.length > 0) {
        return invalidContent(`missing Markdown sections: ${missing.join(',')}`)
      }
      return Buffer.from(content)
    }
    case 'file-set': {
      const parsed = parseFileSet(content)
      const invalid = parsed.files.find((file) =>
        contract.allowedGlobs!.every((glob) => !minimatch(file.path, glob, { dot: true }))
      )
      if (invalid) {
        return invalidContent(`file is outside allowed globs: ${invalid.path}`)
      }
      return Buffer.from(canonicalJson(parsed))
    }
    case 'diff':
      if (typeof content !== 'string' || !/^diff --git /m.test(content)) {
        return invalidContent('Diff Artifact must contain a git patch')
      }
      return Buffer.from(content)
    case 'test-report': {
      const parsed = TestReportContentSchema.safeParse(content)
      if (!parsed.success) {
        return invalidContent(parsed.error.issues[0]?.message ?? 'invalid report')
      }
      return Buffer.from(canonicalJson(parsed.data))
    }
  }
}

export function decodeArtifactContent(format: ArtifactVersion['format'], bytes: Buffer): unknown {
  const text = bytes.toString('utf8')
  return format === 'json-schema' || format === 'file-set' || format === 'test-report'
    ? JSON.parse(text)
    : text
}

function parseFileSet(content: unknown): FileSetContent {
  if (!content || typeof content !== 'object' || !('files' in content)) {
    return invalidContent('File-set Artifact requires files')
  }
  const files = (content as { files?: unknown }).files
  if (!Array.isArray(files) || files.length === 0) {
    return invalidContent('File-set is empty')
  }
  const parsed = files.map((file) => {
    if (!file || typeof file !== 'object') {
      return invalidContent('invalid file-set entry')
    }
    const { path, content: fileContent } = file as { path?: unknown; content?: unknown }
    if (
      typeof path !== 'string' ||
      typeof fileContent !== 'string' ||
      isAbsolute(path) ||
      path.includes('\\') ||
      posix.normalize(path).startsWith('../')
    ) {
      return invalidContent('unsafe file-set entry')
    }
    return { path: posix.normalize(path), content: fileContent }
  })
  if (new Set(parsed.map((file) => file.path)).size !== parsed.length) {
    return invalidContent('duplicate file-set path')
  }
  return { files: parsed }
}

function invalidContent(message: string): never {
  throw new ArtifactStoreError('artifact_contract_invalid', message)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
