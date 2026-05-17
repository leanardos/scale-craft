import { Handle, Position } from 'reactflow';
import { useDisplaySnapshot } from '../store/useStore';
import { utilizationToHsl } from '../util/color';

interface Props {
  id: string;
}

function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return Math.round(n).toString();
}

export function QueueNode({ id }: Props) {
  const display = useDisplaySnapshot();
  const util = display?.perNodeUtilization[id] ?? 0;
  const depth = display?.queueDepthByNodeId[id] ?? 0;
  const ringColor = utilizationToHsl(util);
  return (
    <div className="sc-node sc-node--queue">
      <div
        className="sc-node__ring"
        style={{ borderColor: ringColor, boxShadow: `0 0 12px ${ringColor}` }}
      />
      <div className="sc-node__title">Queue</div>
      <div className="sc-node__sub">depth {fmtCompact(depth)}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
