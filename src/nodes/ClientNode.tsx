import { Handle, Position } from 'reactflow';
import { useStore } from '../store/useStore';

export function ClientNode() {
  const rps = useStore((s) => s.rps);
  return (
    <div className="sc-node sc-node--client">
      <div className="sc-node__title">Client</div>
      <div className="sc-node__sub">{rps.toLocaleString()} RPS</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
