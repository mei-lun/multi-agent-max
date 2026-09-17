import { describe, expect, it } from 'vitest'
import { workflowInputTaskIds } from './workflow-input-task-ids'

describe('workflowInputTaskIds', () => {
  it('finds Task dependencies through non-executable join nodes', () => {
    const bundle = {
      taskCatalog: [
        { id: 'task.a', nodeId: 'node.a' },
        { id: 'task.b', nodeId: 'node.b' },
        { id: 'task.target', nodeId: 'node.target' }
      ],
      plan: {
        nodes: [
          { id: 'node.a', dependencies: [] },
          { id: 'node.b', dependencies: [] },
          { id: 'node.join', dependencies: ['node.a', 'node.b'] },
          { id: 'node.target', dependencies: ['node.join'] }
        ]
      }
    }
    expect(workflowInputTaskIds(bundle as never, 'node.target')).toEqual(['task.a', 'task.b'])
  })
})
