export type NodeType =
  | 'client'
  | 'api'
  | 'redis'
  | 'postgres'
  | 'postgresReplica'
  | 'lb'
  | 'queue'
  | 'worker'
  | 'cdn';

export type PortType = 'http' | 'cache' | 'db' | 'msg';

export interface SimNode {
  id: string;
  type: NodeType;
  instanceCount?: number;
  tier?: import('./specs').Tier;
  lagMs?: number;
  readKeyCardinality?: number;
  hitRate?: number;
  regionId?: string;
}

export interface SimEdge {
  source: string;
  target: string;
}

export interface SimGraph {
  nodes: SimNode[];
  edges: SimEdge[];
}

export interface SimState {
  graph: SimGraph;
  rps: number;
  readPct?: number;
  incidents: import('./incidents').Incident[];
}

export interface Snapshot {
  perNodeUtilization: Record<string, number>;
  perNodeLatencyMs: Record<string, number>;
  perNodeErrorPct: Record<string, number>;
  perNodeIncomingRps: Record<string, number>;
  perEdgeRps: Record<string, number>;
  saturatedNodeIds: string[];
  rps: number;
  effectiveRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorPct: number;
  costUsd: number;
  staleReadPct: number;
  queueDepthByNodeId: Record<string, number>;
  queueArrivalRpsByNodeId: Record<string, number>;
  queueDepthMax: number;
  timestamp: number;
}

export function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}
