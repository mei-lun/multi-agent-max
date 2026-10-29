import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Position } from '@xyflow/react'
import { MamWorkflowMotionEdge } from './MamWorkflowMotionEdge'
import { MamWorkflowReturnEdge } from './MamWorkflowReturnEdge'

const props = {
  id: 'edge.test',
  source: 'a',
  target: 'b',
  sourceX: 20,
  sourceY: 20,
  targetX: 220,
  targetY: 20,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  selected: false,
  animated: false,
  selectable: true,
  deletable: true,
  isInSmoothStepPath: false
}

describe('workflow directional motion', () => {
  it('renders static control edges without a motion overlay', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <MamWorkflowMotionEdge {...props} data={{ motionEnabled: false }} />
      </svg>
    )
    expect(markup).not.toContain('mam-flow-trace')
    expect(markup).not.toContain('animateMotion')
  })

  it('renders control trace and Artifact packets only after motion is enabled', () => {
    const control = renderToStaticMarkup(
      <svg>
        <MamWorkflowMotionEdge {...props} data={{ motionEnabled: true }} />
      </svg>
    )
    const artifact = renderToStaticMarkup(
      <svg>
        <MamWorkflowMotionEdge {...props} data={{ motionEnabled: true, motionKind: 'artifact' }} />
      </svg>
    )
    expect(control).toContain('mam-flow-trace')
    expect(control).toContain('mam-flow-head')
    expect(control.match(/<animateMotion/g)).toHaveLength(1)
    expect(artifact).toContain('mam-flow-trace-artifact')
    expect(artifact.match(/<animateMotion/g)).toHaveLength(4)
  })

  it('animates the actual bounded-return route only when enabled', () => {
    const route = { y: -90, sourceCorridorX: -20, targetCorridorX: 280 }
    const still = renderToStaticMarkup(
      <svg>
        <MamWorkflowReturnEdge {...props} data={{ returnChannel: route, motionEnabled: false }} />
      </svg>
    )
    const live = renderToStaticMarkup(
      <svg>
        <MamWorkflowReturnEdge {...props} data={{ returnChannel: route, motionEnabled: true }} />
      </svg>
    )
    expect(still).not.toContain('mam-flow-trace')
    expect(live).toContain('mam-flow-trace-return')
    expect(live).toContain('mam-flow-head-return')
    expect(live).toContain('L -20 -90')
  })
})
