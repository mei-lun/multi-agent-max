import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { analyzeWorkflowVisual } from './mam-workflow-visual-analysis'
import { layoutWorkflow } from './mam-workflow-layout'
import { reachableWorkflowNodes } from './mam-workflow-reachability'

function graph(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.graph',
    name: 'Graph',
    version: 1,
    nodes: [
      { id: 'split', type: 'parallel', branches: ['a', 'b'] },
      {
        id: 'a',
        type: 'command',
        executable: 'git',
        arguments: [],
        workingDirectory: '.',
        outputs: []
      },
      {
        id: 'b',
        type: 'command',
        executable: 'git',
        arguments: [],
        workingDirectory: '.',
        outputs: []
      },
      { id: 'join', type: 'join', waitFor: ['a', 'b'] },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'split', to: 'a' },
      { from: 'split', to: 'b' },
      { from: 'a', to: 'join' },
      { from: 'b', to: 'join' },
      { from: 'join', to: 'finish' },
      { from: 'join', to: 'a', when: 'retry', maxTraversals: 2 }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 60
  }
}

describe('workflow visual analysis', () => {
  it('keeps the base path progressing through a bounded loop and identifies its region', () => {
    const definition = graph()
    const analysis = analyzeWorkflowVisual(definition)
    expect(analysis.ranks.get('split')).toBe(0)
    expect(analysis.ranks.get('a')).toBe(1)
    expect(analysis.ranks.get('join')).toBe(2)
    expect(analysis.ranks.get('finish')).toBe(3)
    expect(analysis.cyclicNodeIds).toEqual(new Set(['a', 'join']))
    expect(analysis.parallelGroups).toMatchObject([
      { splitId: 'split', joinId: 'join', branchIds: ['a', 'b'] }
    ])
    expect(analysis.returnEdges).toHaveLength(1)
  })

  it('is deterministic when definition arrays are reordered', () => {
    const first = graph()
    const second = {
      ...first,
      nodes: [...first.nodes].reverse(),
      edges: [...first.edges].reverse()
    }
    expect([...layoutWorkflow(analyzeWorkflowVisual(first), first)]).toEqual([
      ...layoutWorkflow(analyzeWorkflowVisual(second), second)
    ])
  })

  it('traverses selected downstream nodes once across a loop', () => {
    expect(reachableWorkflowNodes('a', graph().edges, 'downstream')).toEqual(
      new Set(['a', 'join', 'finish'])
    )
  })
})
