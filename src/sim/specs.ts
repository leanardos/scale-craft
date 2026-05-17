import { NodeType, PortType, QueryType, Skew, Table } from './types';

export interface NodeSpec {
  capacity?: number;
  workMsPerSec?: number;
  baseLatencyMs: number;
  costPerMonthUsd: number;
  inputs: PortType[];
  outputs: PortType[];
  label: string;
}

// Placeholder until issue 07 (HITL calibration). Per ADR 0002, postgres tier-S
// is ~1000 work-ms/sec per core. Replica gets ~2× to match v0.2 ratio.
export const PLACEHOLDER_POSTGRES_WORK_MS_PER_SEC = 1000;
export const PLACEHOLDER_POSTGRES_REPLICA_WORK_MS_PER_SEC = 2000;

// Defaults used when no endpoint declarations are available (legacy v0.2 flows).
export const DEFAULT_READ_QUERY_COST_MS = 1;
export const DEFAULT_WRITE_QUERY_COST_MS = 5;

function rowsReturned(table: Table | undefined, responseSize: number): number {
  if (!table || table.avgRowSize <= 0) return 0;
  return responseSize / table.avgRowSize;
}

function nonPkIndexCount(table: Table | undefined): number {
  if (!table) return 0;
  let n = 0;
  for (const c of table.columns) if (c.indexed && !c.primaryKey) n++;
  return n;
}

export const QUERY_COSTS: Record<
  QueryType,
  (table: Table | undefined, responseSize: number) => number
> = {
  pointIndexed: () => 1,
  pointScan: (t) => (t?.rowCount ?? 0) * 0.0001,
  rangeIndexed: (t, r) => 5 + rowsReturned(t, r) * 0.05,
  rangeScan: (t, r) => (t?.rowCount ?? 0) * 0.0001 + rowsReturned(t, r) * 0.05,
  write: (t) => 5 + 0.5 * nonPkIndexCount(t)
};

// Fallback hit rate for legacy v0.2 flows with no endpoint/table specs.
// Keeps shipped missions running until v0.3 retrofit lands.
export const LEGACY_DEFAULT_HIT_RATE = 0.85;

export type Tier = 'S' | 'M' | 'L' | 'XL';

export const TIERS: Tier[] = ['S', 'M', 'L', 'XL'];

export interface TierMultipliers {
  cap: number;
  cost: number;
}

export const TIER_MULTIPLIERS: Record<Tier, TierMultipliers> = {
  S: { cap: 1.0, cost: 1.0 },
  M: { cap: 2.0, cost: 1.8 },
  L: { cap: 4.0, cost: 3.4 },
  XL: { cap: 8.0, cost: 6.5 }
};

// Per-instance Redis memory by tier (decimal GB).
export const REDIS_TIER_MEMORY_BYTES: Record<Tier, number> = {
  S: 1_000_000_000,
  M: 4_000_000_000,
  L: 16_000_000_000,
  XL: 64_000_000_000
};

// Pareto-style hit-rate curve. f = cacheBytes / workingSet; hitRate = f^α.
// α is small for heavy skew (top-1% serves ~90%) and 1 for flat (uniform).
const SKEW_EXPONENT: Record<Skew, number> = {
  heavy: 0.05,
  medium: 0.3,
  flat: 1.0
};

export function derivedHitRate(
  workingSetBytes: number,
  cacheBytes: number,
  skew: Skew
): number {
  if (cacheBytes <= 0) return 0;
  if (workingSetBytes <= 0) return 1;
  const f = cacheBytes / workingSetBytes;
  if (f >= 1) return 1;
  const h = Math.pow(f, SKEW_EXPONENT[skew]);
  return Math.max(0, Math.min(1, h));
}

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  client: {
    capacity: Infinity,
    baseLatencyMs: 0,
    costPerMonthUsd: 0,
    inputs: [],
    outputs: ['http'],
    label: 'Client'
  },
  lb: {
    capacity: 50000,
    baseLatencyMs: 1,
    costPerMonthUsd: 20,
    inputs: ['http'],
    outputs: ['http'],
    label: 'Load Balancer'
  },
  api: {
    capacity: 2000,
    baseLatencyMs: 5,
    costPerMonthUsd: 50,
    inputs: ['http'],
    outputs: ['db', 'cache', 'msg'],
    label: 'API Server'
  },
  redis: {
    capacity: 10000,
    baseLatencyMs: 1,
    costPerMonthUsd: 50,
    inputs: ['cache'],
    outputs: ['db'],
    label: 'Redis'
  },
  postgres: {
    workMsPerSec: PLACEHOLDER_POSTGRES_WORK_MS_PER_SEC,
    baseLatencyMs: 20,
    costPerMonthUsd: 100,
    inputs: ['db'],
    outputs: [],
    label: 'Postgres'
  },
  postgresReplica: {
    workMsPerSec: PLACEHOLDER_POSTGRES_REPLICA_WORK_MS_PER_SEC,
    baseLatencyMs: 25,
    costPerMonthUsd: 80,
    inputs: ['db'],
    outputs: [],
    label: 'Postgres Replica'
  },
  queue: {
    capacity: 100_000,
    baseLatencyMs: 2,
    costPerMonthUsd: 30,
    inputs: ['msg'],
    outputs: ['msg'],
    label: 'Message Queue'
  },
  worker: {
    capacity: 200,
    baseLatencyMs: 50,
    costPerMonthUsd: 40,
    inputs: ['msg'],
    outputs: ['db'],
    label: 'Worker'
  },
  cdn: {
    capacity: 1_000_000,
    baseLatencyMs: 10,
    costPerMonthUsd: 25,
    inputs: ['http'],
    outputs: ['http'],
    label: 'CDN'
  }
};

export const CDN_DEFAULT_HIT_RATE = 0.6;
export const CDN_MAX_HIT_RATE = 0.95;

export const QUEUE_CAPACITY = NODE_SPECS.queue.capacity;

export const DEFAULT_REPLICATION_LAG_MS = 200;
export const DEFAULT_READ_KEY_CARDINALITY = 1_000;

export function isLegalEdge(source: NodeType, target: NodeType): boolean {
  const out = NODE_SPECS[source]?.outputs ?? [];
  const inp = NODE_SPECS[target]?.inputs ?? [];
  return out.some((p) => inp.includes(p));
}
