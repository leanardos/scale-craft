import { Handle, Position } from 'reactflow';
import { useStore, useDisplaySnapshot } from '../store/useStore';
import { utilizationToHsl } from '../util/color';
import { CDN_DEFAULT_HIT_RATE } from '../sim/specs';

interface Props {
  id: string;
}

export function CdnNode({ id }: Props) {
  const util = useDisplaySnapshot()?.perNodeUtilization[id] ?? 0;
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const hitRate = node?.data.hitRate ?? CDN_DEFAULT_HIT_RATE;
  const ringColor = utilizationToHsl(util);
  return (
    <div className="sc-node sc-node--cdn">
      <div
        className="sc-node__ring"
        style={{ borderColor: ringColor, boxShadow: `0 0 12px ${ringColor}` }}
      />
      <div className="sc-node__title">CDN</div>
      <div className="sc-node__sub">{Math.round(hitRate * 100)}% hit</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
