import type {
  MamDesignProposal,
  MamDesignRecovery,
  MamDesignValidationIssue
} from '../../../shared/mam/design-assistant'

export class MamDesignGenerationFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: readonly MamDesignValidationIssue[] = [],
    readonly proposal?: MamDesignProposal,
    readonly attempts = 1
  ) {
    super(message)
    this.name = 'MamDesignGenerationFailure'
  }
}

export function createMamDesignRecovery(cause: unknown, occurredAt: string): MamDesignRecovery {
  if (cause instanceof MamDesignGenerationFailure) {
    return {
      code: boundedCode(cause.code),
      message: boundedMessage(cause),
      issues: [...cause.issues].slice(0, 20),
      attempts: Math.min(Math.max(cause.attempts, 1), 3),
      occurredAt
    }
  }
  return {
    code: codedError(cause) ?? 'design_generation_failed',
    message: boundedMessage(cause),
    issues: [],
    attempts: 1,
    occurredAt
  }
}

export function createMamDesignIssueRecovery(
  issues: readonly MamDesignValidationIssue[],
  occurredAt: string
): MamDesignRecovery {
  return createMamDesignRecovery(
    new MamDesignGenerationFailure('design_proposal_invalid', designIssuesMessage(issues), issues),
    occurredAt
  )
}

export function hasBlockingDesignIssues(issues: readonly MamDesignValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

export function designIssuesMessage(issues: readonly MamDesignValidationIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.code}${issue.path ? ` at ${issue.path}` : ''}: ${issue.message}`)
    .join('; ')
}

export function validationMessage(cause: unknown): string {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'issues' in cause &&
    Array.isArray(cause.issues)
  ) {
    return cause.issues
      .slice(0, 5)
      .map((issue) =>
        typeof issue === 'object' && issue && 'message' in issue
          ? String(issue.message)
          : String(issue)
      )
      .join('; ')
  }
  return errorMessage(cause)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function codedError(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return undefined
  return typeof cause.code === 'string' && cause.code.trim() ? boundedCode(cause.code) : undefined
}

function boundedCode(code: string): string {
  return code.trim().slice(0, 200) || 'design_generation_failed'
}

function boundedMessage(cause: unknown): string {
  return errorMessage(cause).trim().slice(0, 4_000) || 'Unknown Design Assistant failure'
}
