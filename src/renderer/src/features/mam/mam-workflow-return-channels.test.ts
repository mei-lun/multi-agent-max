import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import { returnEdgeChannels } from './mam-workflow-return-channels'

const definition: WorkflowDefinition = {
  schemaVersion: '1.0.0',
  id: 'workflow.route',
  name: 'Route',
  version: 1,
  nodes: [
    { id: 'a', type: 'finish', inputs: [] },
    { id: 'middle', type: 'finish', inputs: [] },
    { id: 'c', type: 'finish', inputs: [] },
    { id: 'd', type: 'finish', inputs: [] }
  ],
  edges: [
    { from: 'c', to: 'a', when: 'retry', maxTraversals: 2 },
    { from: 'd', to: 'a', when: 'rework', maxTraversals: 3 }
  ],
  maxTransitions: 20,
  maxRunCostUsd: 1,
  maxRunDurationSeconds: 60
}

describe('workflow return channels', () => {
  it('routes above intermediate nodes and separates overlapping return paths', () => {
    const positions = new Map([
      ['a', { x: 0, y: 100 }],
      ['middle', { x: 260, y: -80 }],
      ['c', { x: 520, y: 100 }],
      ['d', { x: 780, y: 100 }]
    ])
    const channels = returnEdgeChannels(definition, positions)
    expect(channels.get(0)?.y).toBeLessThan(-80)
    expect(channels.get(1)!.y).toBeLessThan(channels.get(0)!.y)
    expect(channels.get(0)).toMatchObject({ sourceCorridorX: 492, targetCorridorX: 218 })
    expect(returnEdgeChannels(definition, positions)).toEqual(channels)
  })
})
