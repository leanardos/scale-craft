import { NodeType } from '../sim/types';
import { NODE_SPECS } from '../sim/specs';

const PALETTE_TYPES: NodeType[] = [
  'client',
  'cdn',
  'lb',
  'api',
  'redis',
  'postgres',
  'postgresReplica',
  'queue',
  'worker'
];

export function Palette() {
  const onDragStart = (e: React.DragEvent, type: NodeType) => {
    e.dataTransfer.setData('application/scalecraft-node', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="sc-palette">
      <div className="sc-palette__label">Components</div>
      <div className="sc-palette__items">
        {PALETTE_TYPES.map((t) => (
          <div
            key={t}
            className="sc-palette__item"
            draggable
            onDragStart={(e) => onDragStart(e, t)}
          >
            {NODE_SPECS[t].label}
          </div>
        ))}
      </div>
      <div className="sc-palette__hint">
        Drag onto canvas. Select + Backspace to delete.
      </div>
    </div>
  );
}
