import { Handle, Position } from 'reactflow';
import { useStore, useDisplaySnapshot } from '../store/useStore';
import { utilizationToHsl } from '../util/color';

interface Props {
  id: string;
}

export function PostgresNode({ id }: Props) {
  const util = useDisplaySnapshot()?.perNodeUtilization[id] ?? 0;
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const instances = node?.data.instanceCount ?? 1;
  const tier = node?.data.tier ?? 'S';
  const ringColor = utilizationToHsl(util);
  return (
    <div className="sc-node sc-node--postgres">
      <div
        className="sc-node__ring"
        style={{ borderColor: ringColor, boxShadow: `0 0 12px ${ringColor}` }}
      />
      <div className="sc-node__title">Postgres</div>
      <div className="sc-node__sub">{Math.round(util * 100)}% util</div>
      {instances > 1 || tier !== 'S' ? (
        <div className="sc-node__badge">
          {tier}
          {instances > 1 ? ` ×${instances}` : ''}
        </div>
      ) : null}
      <Handle type="target" position={Position.Left} />
    </div>
  );
}
