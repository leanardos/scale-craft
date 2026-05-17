import { useMemo } from 'react';
import { useViewport } from 'reactflow';
import { useStore } from '../store/useStore';

const REGION_PALETTE = [
  { fill: 'rgba(56, 189, 248, 0.08)', stroke: 'rgba(56, 189, 248, 0.4)' },
  { fill: 'rgba(167, 139, 250, 0.08)', stroke: 'rgba(167, 139, 250, 0.4)' },
  { fill: 'rgba(251, 146, 60, 0.08)', stroke: 'rgba(251, 146, 60, 0.4)' },
  { fill: 'rgba(52, 211, 153, 0.08)', stroke: 'rgba(52, 211, 153, 0.4)' },
  { fill: 'rgba(248, 113, 113, 0.08)', stroke: 'rgba(248, 113, 113, 0.4)' },
  { fill: 'rgba(250, 204, 21, 0.08)', stroke: 'rgba(250, 204, 21, 0.4)' }
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const NODE_W = 180;
const NODE_H = 76;
const PAD = 24;

export function RegionBackdrops() {
  const nodes = useStore((s) => s.nodes);
  const { x, y, zoom } = useViewport();

  const regions = useMemo(() => {
    const groups: Record<string, { x1: number; y1: number; x2: number; y2: number }> = {};
    for (const n of nodes) {
      const r = n.data.regionId;
      if (!r) continue;
      const x1 = n.position.x - PAD;
      const y1 = n.position.y - PAD;
      const x2 = n.position.x + NODE_W + PAD;
      const y2 = n.position.y + NODE_H + PAD;
      const g = groups[r];
      if (!g) groups[r] = { x1, y1, x2, y2 };
      else {
        g.x1 = Math.min(g.x1, x1);
        g.y1 = Math.min(g.y1, y1);
        g.x2 = Math.max(g.x2, x2);
        g.y2 = Math.max(g.y2, y2);
      }
    }
    return Object.entries(groups).map(([id, box]) => {
      const c = REGION_PALETTE[hashString(id) % REGION_PALETTE.length];
      return { id, ...box, fill: c.fill, stroke: c.stroke };
    });
  }, [nodes]);

  if (regions.length === 0) return null;

  return (
    <div
      className="sc-region-backdrops"
      style={{
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: '0 0'
      }}
    >
      {regions.map((r) => (
        <div
          key={r.id}
          className="sc-region-backdrop"
          style={{
            left: r.x1,
            top: r.y1,
            width: r.x2 - r.x1,
            height: r.y2 - r.y1,
            background: r.fill,
            borderColor: r.stroke
          }}
        >
          <span className="sc-region-backdrop__label" style={{ color: r.stroke }}>
            {r.id}
          </span>
        </div>
      ))}
    </div>
  );
}
