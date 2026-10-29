import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react'

export function MamWorkflowReturnEdge(props: EdgeProps): React.JSX.Element {
  const { sourceX, sourceY, targetX, targetY, markerEnd } = props
  const channel = props.data?.returnChannel as
    | { y: number; sourceCorridorX: number; targetCorridorX: number }
    | undefined
  const channelY = channel?.y ?? Math.min(sourceY, targetY) - 76
  const sourceCorridorX = channel?.sourceCorridorX ?? sourceX - 85
  const targetCorridorX = channel?.targetCorridorX ?? targetX + 85
  const path = `M ${sourceX} ${sourceY} L ${sourceX} ${sourceY - 16} L ${sourceCorridorX} ${sourceY - 16} L ${sourceCorridorX} ${channelY} L ${targetCorridorX} ${channelY} L ${targetCorridorX} ${targetY - 16} L ${targetX} ${targetY - 16} L ${targetX} ${targetY}`
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        {...(markerEnd ? { markerEnd } : {})}
        style={{ stroke: 'var(--ring)', strokeWidth: 1.5 }}
      />
      {props.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-card-foreground shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${channelY}px)`
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
