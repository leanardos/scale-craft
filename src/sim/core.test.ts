import { describe, it, expect } from 'vitest';
import {
  tick,
  mm1Latency,
  nodeErrorRate,
  P95_MULTIPLIER,
  CROSS_REGION_LATENCY_MS
} from './core';
import { SimState } from './types';
import { NODE_SPECS, REDIS_HIT_RATE } from './specs';
import {
  DDOS_DURATION_MS,
  DDOS_MULTIPLIER,
  SLOW_QUERY_DURATION_MS,
  SLOW_QUERY_MULTIPLIER,
  CACHE_POISON_DURATION_MS,
  CDN_PURGE_DURATION_MS,
  RETRY_STORM_DURATION_MS,
  RETRY_FACTOR,
  BAD_DEPLOY_DURATION_MS,
  BAD_DEPLOY_FAILURE_FRACTION,
  CACHE_STAMPEDE_DURATION_MS,
  CACHE_STAMPEDE_SPIKE_MS,
  CACHE_STAMPEDE_SPIKE_MULTIPLIER,
  REGIONAL_OUTAGE_DURATION_MS
} from './incidents';

const linearState: SimState = {
  graph: {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'a', type: 'api' },
      { id: 'p', type: 'postgres' }
    ],
    edges: [
      { source: 'c', target: 'a' },
      { source: 'a', target: 'p' }
    ]
  },
  rps: 100,
  incidents: []
};

describe('tick', () => {
  it('propagates load through Client → API → Postgres', () => {
    const snap = tick(linearState, 0);
    expect(snap.perNodeUtilization['c']).toBe(0);
    expect(snap.perNodeUtilization['a']).toBeCloseTo(100 / NODE_SPECS.api.capacity, 5);
    expect(snap.perNodeUtilization['p']).toBeCloseTo(100 / NODE_SPECS.postgres.capacity, 5);
  });

  it('is deterministic for identical inputs', () => {
    const a = tick(linearState, 0);
    const b = tick(linearState, 0);
    expect(a).toEqual(b);
  });

  it('passes the timestamp through unchanged', () => {
    const snap = tick(linearState, 1234);
    expect(snap.timestamp).toBe(1234);
  });

  it('M/M/1 hockey stick: u=0.5 → 2× base, u=0.9 → 10×, u=0.95 → 20×', () => {
    expect(mm1Latency(10, 0.5)).toBeCloseTo(20, 5);
    expect(mm1Latency(10, 0.9)).toBeCloseTo(100, 5);
    expect(mm1Latency(10, 0.95)).toBeCloseTo(200, 5);
  });

  it('node error rate is zero below capacity, positive above', () => {
    expect(nodeErrorRate(0.5)).toBe(0);
    expect(nodeErrorRate(1)).toBe(0);
    expect(nodeErrorRate(2)).toBeCloseTo(0.5, 5);
  });

  it('p95 ≈ sum of mean component latencies × 1.5', () => {
    const snap = tick(linearState, 0);
    const apiU = 100 / NODE_SPECS.api.capacity;
    const pgU = 100 / NODE_SPECS.postgres.capacity;
    const expected =
      (mm1Latency(NODE_SPECS.api.baseLatencyMs, apiU) +
        mm1Latency(NODE_SPECS.postgres.baseLatencyMs, pgU)) *
      P95_MULTIPLIER;
    expect(snap.p95Ms).toBeCloseTo(expected, 5);
  });

  it('end-to-end error rate composes via 1 − ∏(1 − e_i)', () => {
    const overload: SimState = {
      ...linearState,
      rps: 600
    };
    const snap = tick(overload, 0);
    const apiU = 600 / NODE_SPECS.api.capacity;
    const pgU = 600 / NODE_SPECS.postgres.capacity;
    const ok = (1 - nodeErrorRate(apiU)) * (1 - nodeErrorRate(pgU));
    expect(snap.errorPct).toBeCloseTo((1 - ok) * 100, 5);
    expect(snap.errorPct).toBeGreaterThan(0);
  });

  it('flags saturated nodes once utilization crosses 0.95', () => {
    const heavy: SimState = { ...linearState, rps: 290 };
    const snap = tick(heavy, 0);
    expect(snap.saturatedNodeIds).toContain('p');
    expect(snap.saturatedNodeIds).not.toContain('a');
  });

  it('saturatedNodeIds is empty when system has headroom', () => {
    const snap = tick(linearState, 0);
    expect(snap.saturatedNodeIds).toEqual([]);
  });

  it('Redis on the path absorbs 85% of read traffic — Postgres sees 15%', () => {
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 1000,
      incidents: []
    };
    const snap = tick(cached, 0);
    const apiU = 1000 / NODE_SPECS.api.capacity;
    const redisU = 1000 / NODE_SPECS.redis.capacity;
    const pgU = 150 / NODE_SPECS.postgres.capacity;
    expect(snap.perNodeUtilization['a']).toBeCloseTo(apiU, 5);
    expect(snap.perNodeUtilization['r']).toBeCloseTo(redisU, 5);
    expect(snap.perNodeUtilization['p']).toBeCloseTo(pgU, 5);
  });

  it('at 1000 RPS, adding Redis drops Postgres from saturated to healthy and p95 < 100ms', () => {
    const noCache: SimState = { ...linearState, rps: 1000 };
    const noCacheSnap = tick(noCache, 0);
    expect(noCacheSnap.saturatedNodeIds).toContain('p');
    expect(noCacheSnap.p95Ms).toBeGreaterThan(200);

    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 1000,
      incidents: []
    };
    const cachedSnap = tick(cached, 0);
    expect(cachedSnap.saturatedNodeIds).not.toContain('p');
    expect(cachedSnap.p95Ms).toBeLessThan(100);
  });

  it('cost equals sum of component costs for Client → API → Postgres', () => {
    const snap = tick(linearState, 0);
    const expected =
      NODE_SPECS.client.costPerMonthUsd +
      NODE_SPECS.api.costPerMonthUsd +
      NODE_SPECS.postgres.costPerMonthUsd;
    expect(snap.costUsd).toBe(expected);
  });

  it('adding Redis bumps cost by Redis monthly cost', () => {
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 100,
      incidents: []
    };
    const before = tick(linearState, 0).costUsd;
    const after = tick(cached, 0).costUsd;
    expect(after - before).toBe(NODE_SPECS.redis.costPerMonthUsd);
  });

  it('cost is zero for an empty graph', () => {
    const empty: SimState = {
      graph: { nodes: [], edges: [] },
      rps: 0,
      incidents: []
    };
    expect(tick(empty, 0).costUsd).toBe(0);
  });

  it('kill-postgres incident drives errorPct to 100% and flags Postgres as failed', () => {
    const stateWithIncident: SimState = {
      ...linearState,
      incidents: [{ kind: 'kill-postgres', startedAt: 1000 }]
    };
    const snap = tick(stateWithIncident, 1000);
    expect(snap.errorPct).toBeCloseTo(100, 5);
    expect(snap.saturatedNodeIds).toContain('p');
  });

  it('after kill-postgres expires, system returns to baseline', () => {
    const stateWithIncident: SimState = {
      ...linearState,
      incidents: [{ kind: 'kill-postgres', startedAt: 0 }]
    };
    const snap = tick(stateWithIncident, 30_000);
    expect(snap.errorPct).toBeLessThan(0.001);
    expect(snap.saturatedNodeIds).not.toContain('p');
  });

  it('DDoS multiplies effective RPS by 10 during its window, snaps back after', () => {
    const ddosState: SimState = {
      ...linearState,
      rps: 100,
      incidents: [{ kind: 'ddos', startedAt: 0 }]
    };
    const during = tick(ddosState, DDOS_DURATION_MS / 2);
    expect(during.rps).toBe(100 * DDOS_MULTIPLIER);
    const after = tick(ddosState, DDOS_DURATION_MS + 1);
    expect(after.rps).toBe(100);
  });

  it('slow-query multiplies Postgres latency ×10 during window, recovers after', () => {
    const cachedGraph: SimState = {
      ...linearState,
      rps: 100,
      incidents: [{ kind: 'slow-query', startedAt: 0 }]
    };
    const baseline = tick(linearState, 0);
    const during = tick(cachedGraph, SLOW_QUERY_DURATION_MS / 2);
    const pgU = 100 / NODE_SPECS.postgres.capacity;
    const apiLatency = mm1Latency(NODE_SPECS.api.baseLatencyMs, 100 / NODE_SPECS.api.capacity);
    const slowPgLatency = mm1Latency(
      NODE_SPECS.postgres.baseLatencyMs * SLOW_QUERY_MULTIPLIER,
      pgU
    );
    expect(during.p95Ms).toBeCloseTo((apiLatency + slowPgLatency) * P95_MULTIPLIER, 5);
    expect(during.p95Ms).toBeGreaterThan(baseline.p95Ms);
    const after = tick(cachedGraph, SLOW_QUERY_DURATION_MS + 1);
    expect(after.p95Ms).toBeCloseTo(baseline.p95Ms, 5);
  });

  it('cache-poison sends all reads to Postgres while active, recovers after', () => {
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 200,
      incidents: [{ kind: 'cache-poison', startedAt: 0 }]
    };
    const during = tick(cached, CACHE_POISON_DURATION_MS / 2);
    expect(during.perNodeUtilization['p']).toBeCloseTo(200 / NODE_SPECS.postgres.capacity, 5);
    const after = tick(cached, CACHE_POISON_DURATION_MS + 1);
    expect(after.perNodeUtilization['p']).toBeCloseTo(
      ((1 - REDIS_HIT_RATE) * 200) / NODE_SPECS.postgres.capacity,
      5
    );
  });

  it('cache-poison without Redis in the graph has no visible effect (no error)', () => {
    const noRedis: SimState = {
      ...linearState,
      incidents: [{ kind: 'cache-poison', startedAt: 0 }]
    };
    const baseline = tick(linearState, 0);
    const during = tick(noRedis, 1_000);
    expect(during.perNodeUtilization).toEqual(baseline.perNodeUtilization);
    expect(during.p95Ms).toBeCloseTo(baseline.p95Ms, 5);
  });

  it('two incidents (kill + slow-query) compose: errors=100% AND latency ×10', () => {
    const both: SimState = {
      ...linearState,
      incidents: [
        { kind: 'kill-postgres', startedAt: 0 },
        { kind: 'slow-query', startedAt: 0 }
      ]
    };
    const snap = tick(both, 1_000);
    expect(snap.errorPct).toBeCloseTo(100, 5);
    const apiLatency = mm1Latency(
      NODE_SPECS.api.baseLatencyMs,
      100 / NODE_SPECS.api.capacity
    );
    const slowPg = mm1Latency(
      NODE_SPECS.postgres.baseLatencyMs * SLOW_QUERY_MULTIPLIER,
      100 / NODE_SPECS.postgres.capacity
    );
    expect(snap.p95Ms).toBeCloseTo((apiLatency + slowPg) * P95_MULTIPLIER, 5);
  });

  it('records per-edge RPS reflecting Redis cache hit rate (api→redis heavy, redis→postgres light)', () => {
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 1000,
      incidents: []
    };
    const snap = tick(cached, 0);
    expect(snap.perEdgeRps['c->a']).toBe(1000);
    expect(snap.perEdgeRps['a->r']).toBe(1000);
    expect(snap.perEdgeRps['r->p']).toBeCloseTo(150, 5);
  });

  it('reports zero load for orphan nodes with no path from a client', () => {
    const orphan: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'p', type: 'postgres' }
        ],
        edges: []
      },
      rps: 100,
      incidents: []
    };
    const snap = tick(orphan, 0);
    expect(snap.perNodeUtilization['p']).toBe(0);
  });

  it('horizontal scaling: 4 instances at same RPS → 4× capacity, 4× cost, 1/4 per-instance utilization', () => {
    const single: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 1 },
          { id: 'p', type: 'postgres', instanceCount: 1 }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 200,
      incidents: []
    };
    const scaled: SimState = {
      ...single,
      graph: {
        ...single.graph,
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 4 },
          { id: 'p', type: 'postgres', instanceCount: 4 }
        ]
      }
    };
    const a = tick(single, 0);
    const b = tick(scaled, 0);

    expect(b.perNodeUtilization['a']).toBeCloseTo(a.perNodeUtilization['a'] / 4, 5);
    expect(b.perNodeUtilization['p']).toBeCloseTo(a.perNodeUtilization['p'] / 4, 5);

    const baseCost =
      NODE_SPECS.api.costPerMonthUsd + NODE_SPECS.postgres.costPerMonthUsd;
    expect(a.costUsd).toBe(baseCost);
    expect(b.costUsd).toBe(baseCost * 4);
  });

  it('vertical scaling: XL gives 1/8 the per-instance util and 6.5× the cost vs S', () => {
    const small: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 1, tier: 'S' },
          { id: 'p', type: 'postgres', instanceCount: 1, tier: 'S' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 200,
      incidents: []
    };
    const xl: SimState = {
      ...small,
      graph: {
        ...small.graph,
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 1, tier: 'XL' },
          { id: 'p', type: 'postgres', instanceCount: 1, tier: 'XL' }
        ]
      }
    };
    const a = tick(small, 0);
    const b = tick(xl, 0);
    expect(b.perNodeUtilization['a']).toBeCloseTo(a.perNodeUtilization['a'] / 8, 5);
    expect(b.perNodeUtilization['p']).toBeCloseTo(a.perNodeUtilization['p'] / 8, 5);
    const baseCost =
      NODE_SPECS.api.costPerMonthUsd + NODE_SPECS.postgres.costPerMonthUsd;
    expect(a.costUsd).toBe(baseCost);
    expect(b.costUsd).toBeCloseTo(baseCost * 6.5, 5);
  });

  it('vertical: 8×S and 1×XL give equal aggregate capacity; 1×XL costs less ($325 vs $400)', () => {
    const eightSmall: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 8, tier: 'S' }
        ],
        edges: [{ source: 'c', target: 'a' }]
      },
      rps: 1000,
      incidents: []
    };
    const oneXl: SimState = {
      ...eightSmall,
      graph: {
        ...eightSmall.graph,
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 1, tier: 'XL' }
        ]
      }
    };
    // Aggregate api capacity: 8 × 1.0 × 2000 = 16000 vs 1 × 8.0 × 2000 = 16000.
    // But per-instance util differs: 8×S = (1000/8)/2000 = 0.0625; 1×XL = 1000/(8×2000) = 0.0625.
    const a = tick(eightSmall, 0);
    const b = tick(oneXl, 0);
    expect(a.perNodeUtilization['a']).toBeCloseTo(b.perNodeUtilization['a'], 5);
    // Cost: 8 × $50 = $400 vs 6.5 × $50 = $325 — vertical wins on cost.
    expect(a.costUsd).toBe(400);
    expect(b.costUsd).toBeCloseTo(325, 5);
    expect(b.costUsd).toBeLessThan(a.costUsd);
  });

  it('replica routing: reads go to replica, writes go to primary', () => {
    const replicaState: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'p', type: 'postgres' },
          { id: 'r', type: 'postgresReplica' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' },
          { source: 'a', target: 'r' }
        ]
      },
      rps: 1000,
      readPct: 95,
      incidents: []
    };
    const snap = tick(replicaState, 0);
    // Reads (950) all go to replica; writes (50) all go to primary.
    expect(snap.perNodeIncomingRps['r']).toBeCloseTo(950, 5);
    expect(snap.perNodeIncomingRps['p']).toBeCloseTo(50, 5);
  });

  it('stale-read rate ≈ 2% at 100 writes/s, ≈ 20% at 1000 writes/s with default lag/cardinality', () => {
    const make = (totalRps: number, writePct: number): SimState => ({
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'p', type: 'postgres' },
          { id: 'r', type: 'postgresReplica' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' },
          { source: 'a', target: 'r' }
        ]
      },
      rps: totalRps,
      readPct: 100 - writePct,
      incidents: []
    });
    // 100 writes/s, default lag (200ms), default cardinality (1000) → 0.02 = 2%
    const lo = tick(make(1000, 10), 0);
    expect(lo.staleReadPct).toBeCloseTo(2.0, 1);
    // 1000 writes/s → 0.20 = 20%
    const hi = tick(make(10000, 10), 0);
    expect(hi.staleReadPct).toBeCloseTo(20.0, 1);
  });

  it('readPct splits traffic: writes bypass Redis, reads see the cache', () => {
    const split: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 1000,
      readPct: 95,
      incidents: []
    };
    const snap = tick(split, 0);
    // Writes (50) bypass: pass through Redis untouched. Reads (950) get 85% hit.
    // Postgres incoming = 50 + 0.15 × 950 = 192.5
    expect(snap.perNodeIncomingRps['p']).toBeCloseTo(50 + 0.15 * 950, 5);
    expect(snap.perEdgeRps['r->p']).toBeCloseTo(50 + 0.15 * 950, 5);
    expect(snap.perEdgeRps['a->r']).toBeCloseTo(1000, 5);
  });

  it('readPct=0 sends every request to Postgres regardless of Redis', () => {
    const allWrites: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 200,
      readPct: 0,
      incidents: []
    };
    const snap = tick(allWrites, 0);
    expect(snap.perNodeIncomingRps['p']).toBeCloseTo(200, 5);
  });

  it('omitting readPct keeps v0.1 behavior (100% reads)', () => {
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 1000,
      incidents: []
    };
    const snap = tick(cached, 0);
    expect(snap.perNodeIncomingRps['p']).toBeCloseTo(150, 5);
  });

  it('load balancer fans 1000 RPS across 4 downstream APIs → 250 RPS each', () => {
    const fanOut: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'lb', type: 'lb' },
          { id: 'a1', type: 'api' },
          { id: 'a2', type: 'api' },
          { id: 'a3', type: 'api' },
          { id: 'a4', type: 'api' }
        ],
        edges: [
          { source: 'c', target: 'lb' },
          { source: 'lb', target: 'a1' },
          { source: 'lb', target: 'a2' },
          { source: 'lb', target: 'a3' },
          { source: 'lb', target: 'a4' }
        ]
      },
      rps: 1000,
      incidents: []
    };
    const snap = tick(fanOut, 0);
    expect(snap.perEdgeRps['lb->a1']).toBeCloseTo(250, 5);
    expect(snap.perEdgeRps['lb->a2']).toBeCloseTo(250, 5);
    expect(snap.perEdgeRps['lb->a3']).toBeCloseTo(250, 5);
    expect(snap.perEdgeRps['lb->a4']).toBeCloseTo(250, 5);
    expect(snap.perNodeIncomingRps['lb']).toBeCloseTo(1000, 5);
    expect(snap.perNodeIncomingRps['a1']).toBeCloseTo(250, 5);
  });

  it('retry-storm: when API errorRate > threshold, effective RPS amplifies by (1 + retryFactor × errorRate); snaps back after window', () => {
    const overload: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 4000,
      incidents: [{ kind: 'retry-storm', startedAt: 0 }]
    };
    const baseline = tick({ ...overload, incidents: [] }, 0);
    const apiErr = nodeErrorRate(4000 / NODE_SPECS.api.capacity);
    const expectedRps = 4000 * (1 + RETRY_FACTOR * apiErr);
    const during = tick(overload, RETRY_STORM_DURATION_MS / 2);
    expect(during.rps).toBeCloseTo(expectedRps, 5);
    expect(during.rps).toBeGreaterThan(baseline.rps);
    const after = tick(overload, RETRY_STORM_DURATION_MS + 1);
    expect(after.rps).toBeCloseTo(baseline.rps, 5);
  });

  it('retry-storm: stays inert when API errors are below threshold', () => {
    const healthy: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 100,
      incidents: [{ kind: 'retry-storm', startedAt: 0 }]
    };
    const snap = tick(healthy, 1000);
    expect(snap.rps).toBe(100);
  });

  it('bad-deploy: half of API instances return errors → total error ≥ 50%; recovers after 60s', () => {
    const state: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 4 },
          { id: 'p', type: 'postgres', instanceCount: 4 }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 100,
      incidents: [{ kind: 'bad-deploy', startedAt: 0 }]
    };
    const during = tick(state, BAD_DEPLOY_DURATION_MS / 2);
    expect(during.perNodeErrorPct['a']).toBeGreaterThanOrEqual(
      BAD_DEPLOY_FAILURE_FRACTION * 100 - 0.001
    );
    const after = tick(state, BAD_DEPLOY_DURATION_MS + 1);
    expect(after.perNodeErrorPct['a']).toBeLessThan(0.001);
  });

  it('cache-stampede: zero hit rate for full window AND 2× rps spike for first 5s', () => {
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 200,
      incidents: [{ kind: 'cache-stampede', startedAt: 0 }]
    };
    const spike = tick(cached, 1000);
    expect(spike.rps).toBeCloseTo(200 * CACHE_STAMPEDE_SPIKE_MULTIPLIER, 5);
    expect(spike.perNodeIncomingRps['p']).toBeCloseTo(
      200 * CACHE_STAMPEDE_SPIKE_MULTIPLIER,
      5
    );
    const afterSpike = tick(cached, CACHE_STAMPEDE_SPIKE_MS + 1000);
    expect(afterSpike.rps).toBe(200);
    expect(afterSpike.perNodeIncomingRps['p']).toBeCloseTo(200, 5);
    const after = tick(cached, CACHE_STAMPEDE_DURATION_MS + 1);
    expect(after.perNodeIncomingRps['p']).toBeCloseTo(0.15 * 200, 5);
  });

  it('regional-outage: only nodes in the named region return errors; recovers after 30s', () => {
    const split: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client', regionId: 'us' },
          { id: 'a', type: 'api', regionId: 'us' },
          { id: 'a2', type: 'api', regionId: 'eu' },
          { id: 'p', type: 'postgres', regionId: 'eu' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' },
          { source: 'c', target: 'a2' }
        ]
      },
      rps: 100,
      incidents: [{ kind: 'regional-outage', startedAt: 0, regionId: 'eu' }]
    };
    const during = tick(split, REGIONAL_OUTAGE_DURATION_MS / 2);
    expect(during.perNodeErrorPct['a2']).toBeCloseTo(100, 5);
    expect(during.perNodeErrorPct['p']).toBeCloseTo(100, 5);
    expect(during.perNodeErrorPct['a']).toBeLessThan(0.001);
    const after = tick(split, REGIONAL_OUTAGE_DURATION_MS + 1);
    expect(after.perNodeErrorPct['a2']).toBeLessThan(0.001);
    expect(after.perNodeErrorPct['p']).toBeLessThan(0.001);
  });

  it('cross-region latency: split topology adds CROSS_REGION_LATENCY_MS × crossings × P95_MULTIPLIER over single-region p95', () => {
    const single: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client', regionId: 'us' },
          { id: 'a', type: 'api', regionId: 'us' },
          { id: 'p', type: 'postgres', regionId: 'us' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 100,
      incidents: []
    };
    const split: SimState = {
      ...single,
      graph: {
        ...single.graph,
        nodes: [
          { id: 'c', type: 'client', regionId: 'us' },
          { id: 'a', type: 'api', regionId: 'eu' },
          { id: 'p', type: 'postgres', regionId: 'eu' }
        ]
      }
    };
    const sSnap = tick(single, 0);
    const tSnap = tick(split, 0);
    const crossings = 1;
    expect(tSnap.p95Ms - sSnap.p95Ms).toBeCloseTo(
      CROSS_REGION_LATENCY_MS * crossings * P95_MULTIPLIER,
      5
    );
  });

  it('cross-region latency does not apply when only one node has a regionId set', () => {
    const partial: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', regionId: 'us' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 100,
      incidents: []
    };
    const baseline: SimState = {
      ...partial,
      graph: {
        ...partial.graph,
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'p', type: 'postgres' }
        ]
      }
    };
    expect(tick(partial, 0).p95Ms).toBeCloseTo(tick(baseline, 0).p95Ms, 5);
  });

  it('CDN at 60% hit rate forwards 40% of read traffic to API: 10k reads → 4k API RPS', () => {
    const cdnState: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'cdn', type: 'cdn', hitRate: 0.6 },
          { id: 'a', type: 'api' }
        ],
        edges: [
          { source: 'c', target: 'cdn' },
          { source: 'cdn', target: 'a' }
        ]
      },
      rps: 10_000,
      readPct: 100,
      incidents: []
    };
    const snap = tick(cdnState, 0);
    expect(snap.perEdgeRps['c->cdn']).toBeCloseTo(10_000, 5);
    expect(snap.perEdgeRps['cdn->a']).toBeCloseTo(4_000, 5);
    expect(snap.perNodeIncomingRps['a']).toBeCloseTo(4_000, 5);
  });

  it('CDN passes writes through unaffected (no caching of writes)', () => {
    const cdnState: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'cdn', type: 'cdn', hitRate: 0.6 },
          { id: 'a', type: 'api' }
        ],
        edges: [
          { source: 'c', target: 'cdn' },
          { source: 'cdn', target: 'a' }
        ]
      },
      rps: 1000,
      readPct: 0,
      incidents: []
    };
    const snap = tick(cdnState, 0);
    expect(snap.perEdgeRps['cdn->a']).toBeCloseTo(1000, 5);
  });

  it('cdn-purge incident drops CDN hit rate to 0% during window, recovers after', () => {
    const cdnState: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'cdn', type: 'cdn', hitRate: 0.6 },
          { id: 'a', type: 'api' }
        ],
        edges: [
          { source: 'c', target: 'cdn' },
          { source: 'cdn', target: 'a' }
        ]
      },
      rps: 10_000,
      readPct: 100,
      incidents: [{ kind: 'cdn-purge', startedAt: 0 }]
    };
    const during = tick(cdnState, CDN_PURGE_DURATION_MS / 2);
    expect(during.perEdgeRps['cdn->a']).toBeCloseTo(10_000, 5);
    const after = tick(cdnState, CDN_PURGE_DURATION_MS + 1);
    expect(after.perEdgeRps['cdn->a']).toBeCloseTo(4_000, 5);
  });

  it('queue depth grows linearly when arrivals exceed drain, caps at capacity (backpressure trips), and drains when workers added', () => {
    const queueGraph: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'q', type: 'queue' },
          { id: 'w', type: 'worker', instanceCount: 1 }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'q' },
          { source: 'q', target: 'w' }
        ]
      },
      rps: 500,
      incidents: []
    };
    const TICK_MS = 100;
    const QUEUE_CAP = NODE_SPECS.queue.capacity;

    // Phase 1: linear growth at (500 − 200) = 300 msgs/s. After 1s, depth = 300.
    let depths: Record<string, number> = {};
    let snap = tick(queueGraph, TICK_MS, depths, TICK_MS);
    expect(snap.queueArrivalRpsByNodeId['q']).toBeCloseTo(500, 5);
    expect(snap.queueDepthByNodeId['q']).toBeCloseTo(30, 5);
    depths = snap.queueDepthByNodeId;
    for (let t = 2; t <= 10; t++) {
      snap = tick(queueGraph, t * TICK_MS, depths, TICK_MS);
      depths = snap.queueDepthByNodeId;
    }
    expect(depths['q']).toBeCloseTo(300, 5);
    expect(snap.perNodeErrorPct['q']).toBe(0);

    // Phase 2: backpressure trips when depth is at cap and arrivals still exceed drain.
    const atCap: Record<string, number> = { q: QUEUE_CAP };
    const trip = tick(queueGraph, 1_000_000, atCap, TICK_MS);
    expect(trip.queueDepthByNodeId['q']).toBe(QUEUE_CAP);
    expect(trip.perNodeErrorPct['q']).toBeGreaterThan(0);
    expect(trip.saturatedNodeIds).toContain('q');

    // Phase 3: with 6 workers (1200 jobs/s) and 500 arrivals, net drain = 700/s.
    // Starting from full depth, simulate until empty (~143s of sim).
    const drainGraph: SimState = {
      ...queueGraph,
      graph: {
        ...queueGraph.graph,
        nodes: queueGraph.graph.nodes.map((n) =>
          n.id === 'w' ? { ...n, instanceCount: 6 } : n
        )
      }
    };
    depths = { q: QUEUE_CAP };
    for (let t = 1; t <= 2000 && depths['q'] > 0; t++) {
      const s = tick(drainGraph, t * TICK_MS, depths, TICK_MS);
      depths = s.queueDepthByNodeId;
    }
    expect(depths['q']).toBe(0);
  });

  it('horizontal scaling: 4 instances rescues a saturated node', () => {
    const overloaded: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 1 },
          { id: 'p', type: 'postgres', instanceCount: 1 }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'p' }
        ]
      },
      rps: 800,
      incidents: []
    };
    const sharded: SimState = {
      ...overloaded,
      graph: {
        ...overloaded.graph,
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api', instanceCount: 1 },
          { id: 'p', type: 'postgres', instanceCount: 4 }
        ]
      }
    };
    expect(tick(overloaded, 0).saturatedNodeIds).toContain('p');
    expect(tick(sharded, 0).saturatedNodeIds).not.toContain('p');
  });

  it('p99 ≥ p95 ≥ p50 across a battery of fixtures and load levels', () => {
    const fixtures: SimState[] = [
      // empty
      { graph: { nodes: [], edges: [] }, rps: 0, incidents: [] },
      // linear
      linearState,
      // cached
      {
        graph: {
          nodes: [
            { id: 'c', type: 'client' },
            { id: 'a', type: 'api' },
            { id: 'r', type: 'redis' },
            { id: 'p', type: 'postgres' }
          ],
          edges: [
            { source: 'c', target: 'a' },
            { source: 'a', target: 'r' },
            { source: 'r', target: 'p' }
          ]
        },
        rps: 0,
        incidents: []
      },
      // replica
      {
        graph: {
          nodes: [
            { id: 'c', type: 'client' },
            { id: 'a', type: 'api' },
            { id: 'p', type: 'postgres' },
            { id: 'pr', type: 'postgresReplica', lagMs: 200 }
          ],
          edges: [
            { source: 'c', target: 'a' },
            { source: 'a', target: 'p' },
            { source: 'a', target: 'pr' }
          ]
        },
        rps: 0,
        readPct: 95,
        incidents: []
      },
      // queue + worker
      {
        graph: {
          nodes: [
            { id: 'c', type: 'client' },
            { id: 'q', type: 'queue' },
            { id: 'w', type: 'worker' },
            { id: 'p', type: 'postgres' }
          ],
          edges: [
            { source: 'c', target: 'q' },
            { source: 'q', target: 'w' },
            { source: 'w', target: 'p' }
          ]
        },
        rps: 0,
        incidents: []
      },
      // retry storm fired
      { ...linearState, rps: 1900, incidents: [{ kind: 'retry-storm', startedAt: 0 }] }
    ];
    const loads = [0, 1, 100, 1000, 5000, 50_000];
    for (const baseState of fixtures) {
      for (const rps of loads) {
        const state = { ...baseState, rps };
        const snap = tick(state, 0);
        expect(snap.p50Ms).toBeGreaterThanOrEqual(0);
        expect(snap.p95Ms).toBeGreaterThanOrEqual(snap.p50Ms);
        expect(snap.p99Ms).toBeGreaterThanOrEqual(snap.p95Ms);
      }
    }
  });

  it('effectiveRps measures load reaching backend (postgres / replica / worker)', () => {
    // No DB → effectiveRps is 0 even with traffic
    const noBackend: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' }
        ],
        edges: [{ source: 'c', target: 'a' }]
      },
      rps: 100,
      incidents: []
    };
    expect(tick(noBackend, 0).effectiveRps).toBe(0);

    // Linear: full RPS reaches Postgres
    const linear = tick({ ...linearState, rps: 100 }, 0);
    expect(linear.effectiveRps).toBeCloseTo(100, 5);

    // Cached: only (1 - hit) of reads reaches Postgres
    const cached: SimState = {
      graph: {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'a', type: 'api' },
          { id: 'r', type: 'redis' },
          { id: 'p', type: 'postgres' }
        ],
        edges: [
          { source: 'c', target: 'a' },
          { source: 'a', target: 'r' },
          { source: 'r', target: 'p' }
        ]
      },
      rps: 100,
      incidents: []
    };
    expect(tick(cached, 0).effectiveRps).toBeCloseTo(
      100 * (1 - REDIS_HIT_RATE),
      5
    );
  });
});
