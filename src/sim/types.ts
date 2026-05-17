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
  tables?: Table[];
  endpoints?: Endpoint[];
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
  cacheStaleReadPct: number;
  queueDepthByNodeId: Record<string, number>;
  queueArrivalRpsByNodeId: Record<string, number>;
  queueDepthMax: number;
  topologyErrors: string[];
  timestamp: number;
}

export function edgeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

export type QueryType =
  | 'pointIndexed'
  | 'pointScan'
  | 'rangeIndexed'
  | 'rangeScan'
  | 'write';

export const QUERY_TYPES: QueryType[] = [
  'pointIndexed',
  'pointScan',
  'rangeIndexed',
  'rangeScan',
  'write'
];

export type Skew = 'heavy' | 'medium' | 'flat';

export const SKEWS: Skew[] = ['heavy', 'medium', 'flat'];

export interface Column {
  name: string;
  type: string;
  indexed: boolean;
  primaryKey?: boolean;
}

export interface Table {
  name: string;
  rowCount: number;
  avgRowSize: number;
  columns: Column[];
}

export interface EndpointQuery {
  type: QueryType;
  byColumn?: string;
}

export type CacheMode = 'invalidate' | 'ttl';

export interface EndpointCacheConfig {
  mode?: CacheMode;
  ttlSeconds?: number;
  cardinality?: number;
}

export interface Endpoint {
  method: string;
  route: string;
  table: string;
  query: EndpointQuery;
  responseSize: number;
  skew: Skew;
  weight: number;
  cache?: EndpointCacheConfig;
  replicaSafe?: boolean;
  async?: boolean;
  edgeCacheable?: boolean;
}
