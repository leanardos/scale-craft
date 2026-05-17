import { Node, Edge } from 'reactflow';
import { RFNodeData } from './useStore';

export const TOPOLOGY_STORAGE_KEY = 'scalecraft.topologies.v1';
export const MAX_SAVED_TOPOLOGIES = 5;
export const TOPOLOGY_FILE_EXT = '.scalecraft.json';

export interface SavedTopology {
  name: string;
  savedAt: number;
  nodes: Node<RFNodeData>[];
  edges: Edge[];
  readPct: number;
}

export function serializeTopology(
  name: string,
  nodes: Node<RFNodeData>[],
  edges: Edge[],
  readPct: number,
  savedAt: number
): SavedTopology {
  return {
    name,
    savedAt,
    readPct,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { ...n.data }
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type
    }))
  };
}

export function isSavedTopology(v: unknown): v is SavedTopology {
  if (!v || typeof v !== 'object') return false;
  const t = v as Partial<SavedTopology>;
  return (
    typeof t.name === 'string' &&
    typeof t.savedAt === 'number' &&
    typeof t.readPct === 'number' &&
    Array.isArray(t.nodes) &&
    Array.isArray(t.edges)
  );
}

export function listSavedTopologies(): SavedTopology[] {
  try {
    const raw = localStorage.getItem(TOPOLOGY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedTopology);
  } catch {
    return [];
  }
}

export function writeSavedTopologies(list: SavedTopology[]): void {
  localStorage.setItem(TOPOLOGY_STORAGE_KEY, JSON.stringify(list));
}

export function saveTopology(t: SavedTopology): SavedTopology[] {
  const existing = listSavedTopologies().filter((x) => x.name !== t.name);
  const next = [...existing, t].sort((a, b) => b.savedAt - a.savedAt);
  writeSavedTopologies(next);
  return next;
}

export function deleteSavedTopology(name: string): SavedTopology[] {
  const next = listSavedTopologies().filter((t) => t.name !== name);
  writeSavedTopologies(next);
  return next;
}

export function topologyFileName(name: string): string {
  const safe = name.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'topology';
  return `${safe}${TOPOLOGY_FILE_EXT}`;
}
