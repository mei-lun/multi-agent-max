import { describe, expect, it } from 'vitest'
import { compileWorkflow } from '../../../../main/mam/workflow/workflow-compiler'
import { validateMamDesignDelivery } from '../../../../main/mam/application/mam-design-delivery-validation'
import { mamUiRoleFixture } from './mam-renderer-snapshot-fixture'
import {
  DEFAULT_MAM_WORKFLOW_STARTER,
  newDeliveryWorkflowDefinition,
  newWorkflowDefinitionForStarter
} from './MamNewWorkflowDialog'

describe('MAM new Workflow delivery starter', () => {
  it('creates a compilable Review, develop, approval, main, and Finish path', () => {
    const reviewer = { ...mamUiRoleFixture(), id: 'role.reviewer', displayName: 'Reviewer' }
    const author = {
      ...mamUiRoleFixture(),
      id: 'role.author',
      displayName: 'Author',
      permissions: { ...mamUiRoleFixture().permissions, writePaths: ['.'] }
    }
    const definition = newDeliveryWorkflowDefinition('workflow.delivery', 'Delivery', [
      reviewer,
      author
    ])

    expect(definition.nodes.map((node) => [node.id, node.type])).toEqual([
      ['create-delivery', 'role_task'],
      ['review-delivery', 'review_gate'],
      ['integrate-develop', 'git_merge'],
      ['approve-release', 'approval_gate'],
      ['promote-main', 'git_merge'],
      ['finish', 'finish']
    ])
    expect(definition.nodes[0]).toMatchObject({
      recommendedRoleProfileIds: ['role.author'],
      workspaceMode: 'write'
    })
    expect(definition.nodes[1]).toMatchObject({
      recommendedRoleProfileIds: ['role.reviewer']
    })
    expect(validateMamDesignDelivery(definition)).toEqual([])
    expect(() => compileWorkflow(definition)).not.toThrow()
  })

  it('uses the reviewed delivery path as the default creation starter', () => {
    const definition = newWorkflowDefinitionForStarter(
      DEFAULT_MAM_WORKFLOW_STARTER,
      'workflow.default-delivery',
      'Default delivery',
      []
    )

    expect(definition.nodes.map((node) => node.type)).toEqual([
      'role_task',
      'review_gate',
      'git_merge',
      'approval_gate',
      'git_merge',
      'finish'
    ])
  })
})
