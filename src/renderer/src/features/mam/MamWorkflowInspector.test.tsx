import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkflowDefinitionSchema } from '../../../../shared/mam/domain/workflow'
import { createWorkflowNode } from './mam-workflow-canvas-model'
import { MamWorkflowNodeInspector } from './MamWorkflowNodeInspector'
import { newWorkflowDefinition } from './MamNewWorkflowDialog'
import { mamUiRoleFixture } from './mam-renderer-snapshot-fixture'

describe('MAM Workflow Inspector', () => {
  it('creates a schema-valid visual-editor draft', () => {
    expect(
      WorkflowDefinitionSchema.parse(newWorkflowDefinition('workflow.release', 'Release'))
    ).toMatchObject({
      id: 'workflow.release',
      version: 1,
      nodes: [{ id: 'finish', type: 'finish' }]
    })
  })

  it('renders typed task, Role, Artifact, and merge controls before advanced JSON', () => {
    const role = mamUiRoleFixture()
    const task = renderToStaticMarkup(
      <MamWorkflowNodeInspector
        node={createWorkflowNode('role_task', 'build', role.id)}
        roles={[role]}
        onChange={() => undefined}
        onRename={() => undefined}
      />
    )
    const merge = renderToStaticMarkup(
      <MamWorkflowNodeInspector
        node={createWorkflowNode('git_merge', 'merge', role.id)}
        roles={[role]}
        onChange={() => undefined}
        onRename={() => undefined}
      />
    )
    expect(task).toContain('Node Role')
    expect(task).toContain('Workspace access')
    expect(task).toContain('Output Artifact contracts')
    expect(merge).toContain('Target branch')
    expect(merge).toContain('Merge strategy')
    expect(merge).toContain('Post-merge validations')
    expect(task.indexOf('Node Role')).toBeLessThan(task.indexOf('Advanced JSON'))
  })
})
