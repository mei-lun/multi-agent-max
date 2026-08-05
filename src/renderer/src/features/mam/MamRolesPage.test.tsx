import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { createWorkflowNode } from './mam-workflow-canvas-model'
import { mamUiRoleFixture, mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'
import { rolesForWorkflow } from './mam-workflow-role-filter'
import { MamRolesPage } from './MamRolesPage'

describe('MAM Roles page', () => {
  it('shows every Role without a Workflow filter and only bound Roles with one', () => {
    const builder = mamUiRoleFixture()
    const reviewer = { ...builder, id: 'role.reviewer', displayName: 'Reviewer' }
    const unbound = { ...builder, id: 'role.unbound', displayName: 'Unbound' }
    const roles = [builder, reviewer, unbound]
    const workflow: WorkflowDefinition = {
      schemaVersion: '1.0.0',
      id: 'workflow.delivery',
      name: 'Delivery',
      version: 1,
      nodes: [
        createWorkflowNode('role_task', 'build', builder.id),
        createWorkflowNode('review_gate', 'review', reviewer.id),
        createWorkflowNode('finish', 'finish')
      ],
      edges: [],
      maxTransitions: 10,
      maxRunCostUsd: 1,
      maxRunDurationSeconds: 60
    }

    expect(rolesForWorkflow(roles)).toEqual(roles)
    expect(rolesForWorkflow(roles, workflow).map((role) => role.id)).toEqual([
      builder.id,
      reviewer.id
    ])
  })

  it('renders the Workflow filter in the Roles toolbar', () => {
    const html = renderToStaticMarkup(
      <MamRolesPage
        snapshot={mamUiSnapshotFixture()}
        pending={false}
        onSaveProfile={async () => undefined}
        onDeleteRoleProfile={async () => undefined}
      />
    )

    expect(html).toContain('aria-label="Filter Roles by Workflow"')
  })
})
