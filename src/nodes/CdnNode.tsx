import { Handle, Position } from 'reactflow';
import { useStore, useDisplaySnapshot } from '../store/useStore';
import { utilizationToHsl } from '../util/color';

interface Props {
  id: string;
}

export function CdnNode({ id }: Props) {
  const util = useDisplaySnapshot()?.perNodeUtilization[id] ?? 0;
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const ringColor = utilizationToHsl(util);
  const hitLabel =
    node?.data.hitRate === undefined
      ? 'auto'
      : `${Math.round(node.data.hitRate * 100)}%`;
  return (
    <div className="sc-node sc-node--cdn">
      <div
        className="sc-node__ring"
        style={{ borderColor: ringColor, boxShadow: `0 0 12px ${ringColor}` }}
      />
      <div className="sc-node__title">CDN</div>
      <div className="sc-node__sub">{hitLabel} hit</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
