import { memo, useMemo } from 'react';
import { BaseEdge, EdgeProps, getBezierPath } from 'reactflow';
import { useDisplaySnapshot } from '../store/useStore';
import { edgeKey } from '../sim/types';

const MAX_DOTS = 8;
const RPS_PER_DOT = 200;
const SLOW_DURATION_S = 2.5;
const FAST_DURATION_S = 0.5;
const FULL_SPEED_RPS = 2000;
const DURATION_QUANTUM_S = 0.25;

function AnimatedEdgeImpl(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    source,
    target,
    style,
    markerEnd
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const rps =
    useDisplaySnapshot()?.perEdgeRps[edgeKey(source, target)] ?? 0;

  const dotCount = useMemo(
    () => Math.min(MAX_DOTS, Math.max(0, Math.ceil(rps / RPS_PER_DOT))),
    [rps]
  );

  const dur = useMemo(() => {
    if (rps <= 0) return SLOW_DURATION_S;
    const t = Math.min(1, rps / FULL_SPEED_RPS);
    const raw = SLOW_DURATION_S - (SLOW_DURATION_S - FAST_DURATION_S) * t;
    return Math.max(
      FAST_DURATION_S,
      Math.round(raw / DURATION_QUANTUM_S) * DURATION_QUANTUM_S
    );
  }, [rps]);

  const pathId = `sc-edge-path-${id}`;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <path id={pathId} d={edgePath} fill="none" stroke="none" />
      {Array.from({ length: dotCount }).map((_, i) => (
        <circle key={`${dotCount}-${dur}-${i}`} r={2.5} fill="#7dd3fc" opacity={0.85}>
          <animateMotion
            dur={`${dur}s`}
            repeatCount="indefinite"
            begin={`${-(i / dotCount) * dur}s`}
            rotate="auto"
          >
            <mpath xlinkHref={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

export const AnimatedEdge = memo(AnimatedEdgeImpl);
