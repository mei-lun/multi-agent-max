import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function MamWorkflowMotionEdge(props: EdgeProps): React.JSX.Element {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 8
  })
  const artifact = props.data?.motionKind === 'artifact'
  const live = props.data?.motionEnabled === true
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})}
        style={{
          ...props.style,
          stroke: artifact ? 'var(--foreground)' : 'var(--muted-foreground)'
        }}
      />
      {live && (
        <>
          <path
            d={path}
            className={artifact ? 'mam-flow-trace mam-flow-trace-artifact' : 'mam-flow-trace'}
            aria-hidden="true"
            fill="none"
          />
          <circle r="3.5" className="mam-flow-head" aria-hidden="true">
            <animateMotion dur="3.6s" repeatCount="indefinite" path={path} />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.1;0.9;1"
              dur="3.6s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}
      {live &&
        artifact &&
        [0, 1, 2].map((index) => (
          <circle key={index} r="3" className="mam-flow-packet" aria-hidden="true">
            <animateMotion
              dur="3.6s"
              begin={`${index * 0.82}s`}
              repeatCount="indefinite"
              path={path}
            />
            <animate
              attributeName="opacity"
              values="0;0.85;0.85;0"
              keyTimes="0;0.08;0.88;1"
              dur="3.6s"
              begin={`${index * 0.82}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      {props.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-card-foreground shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
