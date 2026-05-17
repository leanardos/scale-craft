import { NodeType, PortType } from './types';

export interface NodeSpec {
  capacity: number;
  baseLatencyMs: number;
  costPerMonthUsd: number;
  inputs: PortType[];
  outputs: PortType[];
  label: string;
}

export const REDIS_HIT_RATE = 0.85;

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
    capacity: 300,
    baseLatencyMs: 20,
    costPerMonthUsd: 100,
    inputs: ['db'],
    outputs: [],
    label: 'Postgres'
  },
  postgresReplica: {
    capacity: 600,
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
