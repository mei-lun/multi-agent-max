import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  Sha256Schema
} from '../../../shared/mam/domain/primitives'
import {
  SchedulerCommandSchema,
  type SchedulerCommand
} from '../../../shared/mam/scheduler-protocol'

const ConflictRecordSchema = z
  .object({
    conflictId: MamEntityIdSchema,
    workflowRunId: MamEntityIdSchema,
    command: SchedulerCommandSchema,
    baseRevision: Sha256Schema,
    latestRevision: Sha256Schema,
    latestCommit: z.string().min(1),
    classification: z.literal('business_state_conflict'),
    failureCode: z.string().min(1),
    failureMessage: z.string().min(1),
    status: z.enum(['pending', 'consumed']),
    createdAt: IsoTimestampSchema,
    consumedAt: IsoTimestampSchema.optional(),
    resolutionCommandId: MamEntityIdSchema.optional(),
    resolvedByUserId: MamEntityIdSchema.optional()
  })
  .strict()

const ConflictFileSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    conflicts: z.array(ConflictRecordSchema)
  })
  .strict()

export type GitCommandConflictRecord = z.infer<typeof ConflictRecordSchema>

export class GitCommandConflictStore {
  private state: z.infer<typeof ConflictFileSchema>
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = resolve(filePath)
    this.state = this.read()
  }

  record(input: {
    command: SchedulerCommand
    baseRevision: string
    latestRevision: string
    latestCommit: string
    failureCode: string
    failureMessage: string
    createdAt?: string
  }): GitCommandConflictRecord {
    const conflictId = `conflict.${input.command.commandId}`
    const record = ConflictRecordSchema.parse({
      ...input,
      conflictId,
      workflowRunId: input.command.workflowRunId,
      classification: 'business_state_conflict',
      status: 'pending',
      createdAt: input.createdAt ?? new Date().toISOString()
    })
    assertSecretFree(record)
    const conflicts = this.state.conflicts.filter(
      (candidate) => candidate.conflictId !== conflictId
    )
    conflicts.push(record)
    this.commit({ schemaVersion: '1.0.0', conflicts })
    return structuredClone(record)
  }

  list(status?: GitCommandConflictRecord['status']): GitCommandConflictRecord[] {
    return structuredClone(
      status
        ? this.state.conflicts.filter((conflict) => conflict.status === status)
        : this.state.conflicts
    )
  }

  requirePending(conflictId: string): GitCommandConflictRecord {
    const conflict = this.state.conflicts.find(
      (candidate) => candidate.conflictId === conflictId && candidate.status === 'pending'
    )
    if (!conflict) throw new Error('pending Git command conflict was not found')
    return structuredClone(conflict)
  }

  consume(
    conflictId: string,
    input: {
      resolutionCommandId: string
      resolvedByUserId: string
      consumedAt?: string
    }
  ): GitCommandConflictRecord {
    const current = this.requirePending(conflictId)
    const consumed = ConflictRecordSchema.parse({
      ...current,
      ...input,
      status: 'consumed',
      consumedAt: input.consumedAt ?? new Date().toISOString()
    })
    this.commit({
      schemaVersion: '1.0.0',
      conflicts: this.state.conflicts.map((candidate) =>
        candidate.conflictId === conflictId ? consumed : candidate
      )
    })
    return structuredClone(consumed)
  }

  private read(): z.infer<typeof ConflictFileSchema> {
    try {
      return ConflictFileSchema.parse(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { schemaVersion: '1.0.0', conflicts: [] }
    }
  }

  private commit(state: z.infer<typeof ConflictFileSchema>): void {
    const parsed = ConflictFileSchema.parse(state)
    assertSecretFree(parsed)
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporaryPath, this.filePath)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
    this.state = parsed
  }
}

function assertSecretFree(value: unknown): void {
  const source = JSON.stringify(value)
  if (/(?:api[_-]?key|authorization|bearer|secret)\s*[:=]\s*[^\s,}]+/i.test(source)) {
    throw new Error('Git command conflict contains a possible plaintext secret')
  }
}
