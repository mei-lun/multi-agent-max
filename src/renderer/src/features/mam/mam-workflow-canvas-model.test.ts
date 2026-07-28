import { describe, expect, it } from 'vitest'
import { WorkflowNodeSchema, type WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import {
  createWorkflowNode,
  renameWorkflowNode,
  toCanvasEdges,
  toCanvasNodes,
  workflowNodeTypes
} from './mam-workflow-canvas-model'

describe('MAM Workflow canvas model', () => {
  it('creates schema-valid defaults for every first-release node type', () => {
    const nodes = workflowNodeTypes.map((type) =>
      createWorkflowNode(type, `node-${type.replaceAll('_', '-')}`, 'role.builder')
    )
    expect(nodes.map((node) => WorkflowNodeSchema.parse(node).type)).toEqual(workflowNodeTypes)
  })

  it('round-trips node and edge definitions through the canvas model', () => {
    const definition = workflow()
    const nodes = toCanvasNodes(definition)
    expect(nodes.map((node) => node.data.node)).toEqual(definition.nodes)
    expect(nodes.find((node) => node.id === 'fan-out')?.position.x).toBe(0)
    expect(nodes.find((node) => node.id === 'task-a')?.position.x).toBe(240)
    expect(nodes.find((node) => node.id === 'join')?.position.x).toBe(480)
    expect(toCanvasEdges(definition).map((edge) => edge.data?.edge)).toEqual(definition.edges)
  })

  it('renames graph and node-internal references together', () => {
    const definition = workflow()
    const renamed = renameWorkflowNode(definition, 'task-a', 'task-renamed')
    expect(renamed.edges).toContainEqual({ from: 'fan-out', to: 'task-renamed' })
    expect(renamed.nodes.find((node) => node.id === 'fan-out')).toMatchObject({
      branches: ['task-renamed', 'task-b']
    })
    expect(renamed.nodes.find((node) => node.id === 'join')).toMatchObject({
      waitFor: ['task-renamed', 'task-b']
    })
    expect(renamed.nodes.find((node) => node.id === 'condition')).toMatchObject({
      branches: { yes: 'task-renamed' }
    })
  })
})

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.canvas',
    name: 'Canvas workflow',
    version: 1,
    nodes: [
      { id: 'fan-out', type: 'parallel', branches: ['task-a', 'task-b'] },
      createWorkflowNode('role_task', 'task-a', 'role.builder'),
      createWorkflowNode('role_task', 'task-b', 'role.builder'),
      { id: 'condition', type: 'condition', expression: 'approved', branches: { yes: 'task-a' } },
      { id: 'join', type: 'join', waitFor: ['task-a', 'task-b'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'fan-out', to: 'task-a' },
      { from: 'fan-out', to: 'task-b' },
      { from: 'task-a', to: 'join' },
      { from: 'task-b', to: 'join' },
      { from: 'join', to: 'finish' }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 10,
    maxRunDurationSeconds: 600
  }
}
