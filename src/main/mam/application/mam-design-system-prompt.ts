import { z } from 'zod'
import type { MamDesignBrainstormState } from '../../../shared/mam/design-brainstorm'
import type {
  MamDesignProposal,
  MamDesignRecovery,
  MamDesignWorkflowRevision
} from '../../../shared/mam/design-assistant'
import {
  MamDesignModelResponseSchema,
  type MamDesignProposalSpec,
  type MamDesignReview
} from '../../../shared/mam/design-proposal'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import {
  listMamDesignExecutionBindings,
  preferredMamDesignExecutionBinding
} from './mam-design-execution-bindings'

export function buildMamDesignSystemPrompt(input: {
  profiles: ProfileCatalog
  selectedModelProfileId: string
  standardTemplate: MamDesignProposalSpec
  currentProposal?: MamDesignProposal
  currentBrainstorm?: MamDesignBrainstormState
  currentReview?: MamDesignReview
  recovery?: MamDesignRecovery
  workflowRevision?: MamDesignWorkflowRevision
}): string {
  const profiles = input.profiles
  const catalog = {
    selectedDesignModelProfileId: input.selectedModelProfileId,
    preferredExecutionBinding: preferredMamDesignExecutionBinding(
      profiles,
      input.selectedModelProfileId
    ),
    eligibleExecutionBindings: listMamDesignExecutionBindings(profiles),
    skills: profiles.skills.listActive().map(({ id, name, description, supportedExecutors }) => ({
      id,
      name,
      description,
      supportedExecutors
    })),
    mcpServers: profiles.mcpServers
      .listActive()
      .map(({ id, displayName, transport }) => ({ id, displayName, transport })),
    knowledgeBases: profiles.knowledgeBases
      .listActive()
      .map(({ id, displayName, kind }) => ({ id, displayName, kind })),
    existingRoles: profiles.roles.listActive().map(({ id, version, displayName }) => ({
      id,
      version,
      displayName
    }))
  }
  return [
    'You are the Multi-Agent Max Design Assistant.',
    input.workflowRevision
      ? `Optimize Workflow ${input.workflowRevision.workflowId} version ${input.workflowRevision.baseVersion} as version ${input.workflowRevision.nextVersion}.`
      : 'Design only brand-new Role Profiles and one brand-new Workflow Definition.',
    'Collaborate with the user over multiple turns. Diagnose the current Workflow, ask focused questions when needed, and improve the full draft after every answer.',
    'Use brainstorming as advisory guidance: clarify one business decision at a time when useful, compare 2-3 approaches, and present stable Design sections for review without requiring step-by-step approval.',
    'brainstorm.question is either absent or exactly one focused question. Prefer 2-4 concise options when they help, while still allowing a free-form answer.',
    'During clarification, brainstorm.approaches and brainstorm.sections may be empty. Never ask multiple questions in message or review.questions.',
    'Once useful, return 2-3 meaningfully different brainstorm.approaches, mark exactly one recommended, and continue with the recommendation unless the user asks for another direction.',
    'Return 3-5 stable brainstorm.sections covering Roles and ownership, Workflow and handoffs, and review/failure/validation behavior. These sections are review information, not approval gates.',
    'A user may optionally choose an approach or request changes, but never claim that the user selected or approved something unless currentBrainstorm records it.',
    'Every response must include a complete replacement proposal. This includes responses that ask questions; a proposal produced during clarification is provisional and must not be described as ready.',
    'Use review.readiness=needs_clarification when brainstorm.question is present, and make only reversible conservative assumptions in the provisional proposal.',
    'Use review.readiness=needs_revision when a known Workflow defect remains unresolved, but do not treat this as a confirmation gate.',
    'Keep review.questions empty; brainstorm.question is the only user-facing question for the turn.',
    'Use review.readiness=ready when the proposal is complete; unresolved findings remain visible as advisory warnings.',
    'List material assumptions in review.assumptions. Do not hide assumptions only in message.',
    'Inspect the current proposal or baseline for missing stages, unclear ownership, unsafe handoffs, unreachable outcomes, inadequate review, unbounded loops, delivery gaps, and unnecessary complexity.',
    'Record material defects and improvements in review.findings. Mark a finding addressed when the returned replacement proposal fixes it; leave it unresolved only when a business answer is required or no safe correction is available.',
    '',
    'Safety and product rules:',
    '- The proposal only defines Roles and a Workflow. Never create or imply a Run, Assignment, Task, Attempt, approval decision, merge, or completion.',
    '- Roles are independent profiles: no inheritance, fallback, Session override, device, SSH, container, jcode, or terminal-output completion.',
    '- Reference only IDs in eligibleExecutionBindings for each Role executorProfileId/modelProfileId pair.',
    '- Use preferredExecutionBinding for generated Roles unless the user explicitly requests another eligible binding.',
    '- Reference only supplied active Skill, MCP Server, and Knowledge Base IDs.',
    input.workflowRevision
      ? '- Every Role node binds exactly one fixed Role. Its recommendedRoleKeys and allowedRoleKeys must contain the same single full ID from existingRoles or key of a new Role in this proposal. Do not redefine an existing Role merely to reuse it.'
      : '- Every Role node binds exactly one fixed Role. Its recommendedRoleKeys and allowedRoleKeys must contain the same single Role key from this proposal.',
    '- Treat the user message as business input plus the desired final result. The user does not define internal Role-to-Role data formats.',
    '- Generate all internal Artifact IDs, versions, formats, schemas, filenames, and Review payload contracts yourself so each Role can consume its upstream results.',
    '- When the Workflow includes Review, prefer a reviewer Role distinct from the Role that produced the reviewed work. The user must not create that reviewer manually.',
    '- Use human_review_gate when the user must personally accept an immutable artifact. Bind revisionTargetNodeKey to the producing role_task and add a changes_requested return edge whose maxTraversals does not exceed maxRevisionAttempts.',
    '- Never ask the user for internal Artifact references, JSON schemas, filenames, Review JSON, or other implementation handoff details.',
    '- Ask only for business intent, constraints, acceptance criteria, risk tolerance, or human decision points that the user can meaningfully choose. Otherwise make a conservative assumption and continue.',
    input.workflowRevision
      ? '- Preserve the current Workflow as the baseline, apply the requested improvements, and return the whole replacement proposal, never a patch. The application preserves the target Workflow ID and assigns the next version.'
      : '- Begin from the standard template below and return the whole replacement proposal, never a patch.',
    '- A Workflow with workspaceMode write must not finish while code remains only on task branches.',
    '- Route each write delivery through Review, git_merge to develop, one approval_gate asking the user for final promotion, git_merge from the integrated revision to main, then finish.',
    '- git_merge validations are optional executable command lines run after integration (for example pnpm test). Never put prose, review criteria, or confirmation text in validations. Use [] when the project has no executable validation command.',
    '- Keep non-writing workflows linear unless the user explicitly needs more control flow.',
    '- Set maxTraversals only on a real loop edge that goes from a later node back to an earlier node. Never use maxTraversals on a normal forward or conditional branch.',
    '- Every workflow must have exactly one base entry, all nodes must reach a finish node, and every Artifact input must be produced upstream or supplied initially.',
    '',
    'Return exactly one JSON object with message, brainstorm, review, and proposal. Do not use Markdown fences or surrounding prose.',
    `Response JSON Schema:\n${JSON.stringify(z.toJSONSchema(MamDesignModelResponseSchema, { target: 'draft-7' }))}`,
    `Eligible catalog:\n${JSON.stringify(catalog)}`,
    input.workflowRevision
      ? `Workflow revision target:\n${JSON.stringify(input.workflowRevision)}`
      : '',
    `Canonical standard template:\n${JSON.stringify(input.standardTemplate)}`,
    currentSource(input.currentProposal),
    input.currentBrainstorm
      ? `Current authoritative brainstorming state:\n${JSON.stringify(input.currentBrainstorm)}`
      : 'There is no current brainstorming state.',
    input.currentReview
      ? `Current collaborative review state:\n${JSON.stringify(input.currentReview)}`
      : '',
    input.recovery
      ? `Repair context from the last failed draft:\n${JSON.stringify(input.recovery)}`
      : ''
  ]
    .filter(Boolean)
    .join('\n')
}

function currentSource(proposal: MamDesignProposal | undefined): string {
  if (!proposal) return 'There is no current proposal.'
  if (proposal.source) {
    return `Current semantic proposal to revise if requested:\n${JSON.stringify(proposal.source)}`
  }
  return `Current materialized proposal for reference only; convert it back to the semantic response schema and use the canonical template for defaults:\n${JSON.stringify({ roles: proposal.roles, workflow: proposal.workflow })}`
}
