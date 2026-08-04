import { z } from 'zod'
import {
  MamSubmitReviewInputSchema,
  type MamSubmitReviewInput
} from '../../../shared/mam/application-command'
import type { ValidatedAttemptArtifacts } from './attempt-artifact-validator'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { submitReviewAndAggregate } from './mam-review-command-service'

const automaticReviewReportSchema = z
  .object({
    status: z.enum(['approved', 'changes_requested', 'blocked']),
    summary: z.string().min(1).max(4000),
    findings: z
      .array(
        z
          .object({
            severity: z.enum(['blocker', 'high', 'medium', 'low']),
            category: z.string().min(1),
            summary: z.string().min(1).max(4000),
            filePath: z.string().min(1).optional(),
            line: z.number().int().positive().optional()
          })
          .passthrough()
      )
      .default([])
  })
  .passthrough()

export function automaticReviewSubmission(
  prepared: PreparedAttempt,
  validated: ValidatedAttemptArtifacts
): MamSubmitReviewInput | undefined {
  if (!prepared.task.reviewTask) return undefined
  const report = validated.records
    .map((record) => normalizeAutomaticReviewReport(record.content))
    .find((candidate) => candidate !== undefined)
  if (!report) return undefined
  const request = {
    workflowRunId: prepared.workflowRunId,
    reviewerTaskId: prepared.taskId,
    reviewerAttemptId: prepared.attemptId,
    status: report.status,
    summary: report.summary,
    findings: report.findings.map((finding) => ({
      severity: finding.severity,
      category: finding.category,
      summary: finding.summary,
      ...(finding.filePath ? { filePath: finding.filePath } : {}),
      ...(finding.line ? { line: finding.line } : {})
    }))
  }
  const parsed = MamSubmitReviewInputSchema.safeParse(request)
  return parsed.success ? parsed.data : undefined
}

function normalizeAutomaticReviewReport(
  content: unknown
): z.infer<typeof automaticReviewReportSchema> | undefined {
  const direct = normalizeReviewObject(content)
  if (direct) return direct
  if (typeof content !== 'string' || !content.trim()) return undefined
  for (const candidate of jsonCandidates(content)) {
    try {
      const parsed = normalizeReviewObject(JSON.parse(candidate))
      if (parsed) return parsed
    } catch {
      // Fall through to conservative prose interpretation.
    }
  }
  return normalizeReviewProse(content)
}

function normalizeReviewObject(
  value: unknown
): z.infer<typeof automaticReviewReportSchema> | undefined {
  const direct = automaticReviewReportSchema.safeParse(value)
  if (direct.success) {
    return finalizeReport(direct.data.status, direct.data.summary, direct.data.findings)
  }
  if (!isRecord(value)) return undefined
  const status = reviewStatus(value.status ?? value.decision ?? value.result ?? value['结论'])
  const summary = reviewText(
    value.summary ?? value.conclusion ?? value.reason ?? value.review ?? value['摘要']
  )
  if (!status || !summary) return undefined
  const findings = normalizeFindings(
    value.findings ?? value.issues ?? value.problems ?? value['问题']
  )
  return finalizeReport(status, summary, findings)
}

function normalizeReviewProse(
  source: string
): z.infer<typeof automaticReviewReportSchema> | undefined {
  const text = source
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  const status = inferredReviewStatus(text)
  if (!status) return undefined
  const summary = text.replace(/\s+/g, ' ').slice(0, 4000)
  const bullets = source
    .split(/\r?\n/)
    .map((line) => /^\s*(?:[-*]|\d+[.)])\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
    .map((line) => reviewFinding(line))
  return finalizeReport(status, summary, bullets)
}

function finalizeReport(
  status: 'approved' | 'changes_requested' | 'blocked',
  summary: string,
  findings: z.infer<typeof automaticReviewReportSchema>['findings']
): z.infer<typeof automaticReviewReportSchema> | undefined {
  const actionable =
    status === 'changes_requested' && findings.length === 0 && !isGenericChangeSummary(summary)
      ? [reviewFinding(summary)]
      : findings
  const parsed = automaticReviewReportSchema.safeParse({ status, summary, findings: actionable })
  return parsed.success ? parsed.data : undefined
}

function normalizeFindings(
  value: unknown
): z.infer<typeof automaticReviewReportSchema>['findings'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [reviewFinding(item)]
    if (!isRecord(item)) return []
    const summary = reviewText(item.summary ?? item.description ?? item.message ?? item['问题'])
    if (!summary) return []
    const lineValue = item.line ?? item.lineNumber
    const line = typeof lineValue === 'number' ? lineValue : Number(lineValue)
    return [
      {
        severity: reviewSeverity(item.severity ?? item.level),
        category: reviewText(item.category ?? item.type) ?? reviewCategory(summary),
        summary,
        ...(reviewText(item.filePath ?? item.file)
          ? { filePath: reviewText(item.filePath ?? item.file)! }
          : {}),
        ...(Number.isInteger(line) && line > 0 ? { line } : {})
      }
    ]
  })
}

function reviewFinding(summary: string) {
  return {
    severity: reviewSeverity(summary),
    category: reviewCategory(summary),
    summary: summary.slice(0, 4000)
  } as const
}

function reviewStatus(value: unknown): 'approved' | 'changes_requested' | 'blocked' | undefined {
  if (typeof value !== 'string') return undefined
  return inferredReviewStatus(value)
}

function inferredReviewStatus(
  value: string
): 'approved' | 'changes_requested' | 'blocked' | undefined {
  const text = value.toLocaleLowerCase()
  if (
    /^\s*blocked\b|(?:status|decision|verdict)\s*[:：-]?\s*blocked\b|无法审核|(?:结论|状态|判定).{0,6}阻塞|阻塞(?:审核|合并|发布)/.test(
      text
    )
  ) {
    return 'blocked'
  }
  if (
    /changes?[_ -]?requested|request(?:ed)? changes|needs? changes|需要修改|需修改|修改后|不通过|未通过|存在(?:以下)?问题|(?:^|[^未])发现.{0,12}问题/.test(
      text
    )
  ) {
    return 'changes_requested'
  }
  if (
    /\bapproved\b|\bpass(?:ed)?\b|审核通过|验收通过|可以通过|符合.{0,20}(?:要求|规范)|未发现.{0,12}问题|无.{0,12}问题/.test(
      text
    )
  ) {
    return 'approved'
  }
  return undefined
}

function reviewSeverity(value: unknown): 'blocker' | 'high' | 'medium' | 'low' {
  const text = typeof value === 'string' ? value.toLocaleLowerCase() : ''
  if (/blocker|阻断|致命/.test(text)) return 'blocker'
  if (/high|严重|高/.test(text)) return 'high'
  if (/low|轻微|低/.test(text)) return 'low'
  return 'medium'
}

function reviewCategory(value: string): string {
  if (/accessib|a11y|无障碍/i.test(value)) return 'accessibility'
  if (/security|安全/i.test(value)) return 'security'
  if (/test|测试/i.test(value)) return 'testing'
  if (/visual|style|样式|视觉/i.test(value)) return 'visual'
  if (/input|validation|输入|校验/i.test(value)) return 'validation'
  return 'review'
}

function isGenericChangeSummary(value: string): boolean {
  return /^(?:needs? work|needs? changes|修改|需要修改|需修改)[.!。！]?$/i.test(value.trim())
}

function jsonCandidates(source: string): readonly string[] {
  const trimmed = source.trim()
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(trimmed)?.[1]?.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  return [
    trimmed,
    fenced,
    firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : undefined
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function reviewText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 4000) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function publishAutomaticReviewSubmission(input: {
  request: MamSubmitReviewInput | undefined
  repository: GitStateRepository
  schedulerId: string
  nextCommandId(): string
  now(): string
}): boolean {
  if (!input.request) return false
  submitReviewAndAggregate({
    request: input.request,
    repository: input.repository,
    schedulerId: input.schedulerId,
    nextCommandId: input.nextCommandId,
    now: input.now
  })
  return true
}
