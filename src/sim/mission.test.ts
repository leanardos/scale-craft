import { describe, it, expect } from 'vitest';
import {
  step,
  startedRuntime,
  initialRuntime,
  rampedRps,
  decisiveDecision,
  winConditionsHold,
  hasRequiredComponents,
  parseMission,
  MissionSpec,
  MissionRuntime,
  ERROR_HARD_FAIL_MS
} from './mission';
import { tick } from './core';
import { Snapshot, SimGraph, SimState } from './types';

const SPEC: MissionSpec = {
  id: 'test',
  title: 'test',
  brief: 't',
  // 2500 RPS sits well above tier-S Postgres (≈1000 RPS reads under v0.3
  // work-ms/sec model), so the no-cache linear path saturates and loses
  // on errors while a Redis-fronted path can still serve at 15% miss.
  targetRps: 2500,
  rampSeconds: 20,
  sustainSeconds: 30,
  winConditions: { p95MaxMs: 200, errorMaxPct: 1, costMaxUsd: 500 },
  allowedComponents: ['client', 'api', 'redis', 'postgres']
};

const winningSnap = (timestamp: number): Snapshot => ({
  perNodeUtilization: {},
  perNodeLatencyMs: {},
  perNodeErrorPct: {},
  perNodeIncomingRps: {},
  perEdgeRps: {},
  saturatedNodeIds: [],
  rps: 1000,
  effectiveRps: 1000,
  p50Ms: 53,
  p95Ms: 80,
  p99Ms: 133,
  errorPct: 0,
  costUsd: 200,
  staleReadPct: 0,
  cacheStaleReadPct: 0,
  queueDepthByNodeId: {},
  queueArrivalRpsByNodeId: {},
  queueDepthMax: 0,
  topologyErrors: [],
  timestamp
});

const failingSnap = (timestamp: number, errorPct: number): Snapshot => ({
  ...winningSnap(timestamp),
  errorPct
});

const linearGraph: SimGraph = {
  nodes: [
    { id: 'c', type: 'client' },
    // 2 API instances so the counterfactual (Redis-inserted) graph in
    // decisiveDecision tests doesn't trip on API saturation at 2500 RPS.
    { id: 'a', type: 'api', instanceCount: 2 },
    { id: 'p', type: 'postgres' }
  ],
  edges: [
    { source: 'c', target: 'a' },
    { source: 'a', target: 'p' }
  ]
};

const cachedGraph: SimGraph = {
  nodes: [
    { id: 'c', type: 'client' },
    // 2 API instances to clear the API capacity bound at 2500 RPS.
    { id: 'a', type: 'api', instanceCount: 2 },
    { id: 'r', type: 'redis' },
    { id: 'p', type: 'postgres' }
  ],
  edges: [
    { source: 'c', target: 'a' },
    { source: 'a', target: 'r' },
    { source: 'r', target: 'p' }
  ]
};

describe('mission state machine', () => {
  it('idle does not transition without start', () => {
    const r = step(SPEC, initialRuntime(), null, linearGraph, 1000, false);
    expect(r.status).toBe('idle');
  });

  it('ramping → sustaining at rampSeconds', () => {
    const start = startedRuntime(0);
    const before = step(SPEC, start, winningSnap(10_000), linearGraph, 10_000, false);
    expect(before.status).toBe('ramping');
    const after = step(
      SPEC,
      start,
      winningSnap(SPEC.rampSeconds * 1000),
      linearGraph,
      SPEC.rampSeconds * 1000,
      false
    );
    expect(after.status).toBe('sustaining');
  });

  it('sustaining → won when conditions hold for full sustain window', () => {
    let runtime = startedRuntime(0);
    runtime = {
      ...runtime,
      status: 'sustaining',
      sustainStartedAt: SPEC.rampSeconds * 1000
    };
    const t0 = SPEC.rampSeconds * 1000;
    const before = step(SPEC, runtime, winningSnap(t0), linearGraph, t0, false);
    expect(before.status).toBe('sustaining');
    const tEnd = t0 + SPEC.sustainSeconds * 1000;
    runtime = before;
    const after = step(SPEC, runtime, winningSnap(tEnd), linearGraph, tEnd, false);
    expect(after.status).toBe('won');
  });

  it('sustain hold resets when conditions break, requiring full re-hold', () => {
    let runtime = startedRuntime(0);
    runtime = {
      ...runtime,
      status: 'sustaining',
      sustainStartedAt: 0
    };
    runtime = step(SPEC, runtime, winningSnap(10_000), linearGraph, 10_000, false);
    expect(runtime.sustainHoldingSinceMs).toBe(10_000);
    runtime = step(SPEC, runtime, failingSnap(15_000, 5), linearGraph, 15_000, false);
    expect(runtime.sustainHoldingSinceMs).toBeNull();
    expect(runtime.status).toBe('sustaining');
  });

  it('lost on errors > 50% sustained for 5 seconds', () => {
    let runtime = startedRuntime(0);
    runtime = { ...runtime, status: 'sustaining', sustainStartedAt: 0 };
    runtime = step(SPEC, runtime, failingSnap(0, 80), linearGraph, 0, false);
    expect(runtime.status).toBe('sustaining');
    runtime = step(
      SPEC,
      runtime,
      failingSnap(ERROR_HARD_FAIL_MS, 80),
      linearGraph,
      ERROR_HARD_FAIL_MS,
      false
    );
    expect(runtime.status).toBe('lost');
    expect(runtime.lossReason).toBe('errors');
  });

  it('lost immediately if cost exceeds budget', () => {
    let runtime = startedRuntime(0);
    runtime = { ...runtime, status: 'sustaining', sustainStartedAt: 0 };
    const overBudget: Snapshot = { ...winningSnap(100), costUsd: 9999 };
    runtime = step(SPEC, runtime, overBudget, linearGraph, 100, false);
    expect(runtime.status).toBe('lost');
    expect(runtime.lossReason).toBe('budget');
  });

  it('lost on give up', () => {
    let runtime = startedRuntime(0);
    runtime = { ...runtime, status: 'ramping' };
    runtime = step(SPEC, runtime, winningSnap(100), linearGraph, 100, true);
    expect(runtime.status).toBe('lost');
    expect(runtime.lossReason).toBe('give-up');
  });

  it('terminal states are sticky', () => {
    const wonRuntime = { ...initialRuntime(), status: 'won' as const };
    const r = step(SPEC, wonRuntime, winningSnap(0), linearGraph, 0, false);
    expect(r.status).toBe('won');
  });

  it('ramped rps interpolates 0 → target over rampSeconds', () => {
    const r = startedRuntime(0);
    expect(rampedRps(SPEC, r, 0)).toBe(0);
    expect(rampedRps(SPEC, r, SPEC.rampSeconds * 500)).toBe(
      Math.round(SPEC.targetRps * 0.5)
    );
    expect(rampedRps(SPEC, r, SPEC.rampSeconds * 1000)).toBe(SPEC.targetRps);
  });
});

describe('full mission pipeline (tick + step)', () => {
  function runMission(graph: SimGraph, maxTickMs = 100, maxDurationMs = 60_000) {
    let runtime: MissionRuntime = startedRuntime(0);
    for (let t = 0; t <= maxDurationMs; t += maxTickMs) {
      const rps = rampedRps(SPEC, runtime, t);
      const simState: SimState = { graph, rps, incidents: [] };
      const snapshot = tick(simState, t);
      runtime = step(SPEC, runtime, snapshot, graph, t, false);
      if (runtime.status === 'won' || runtime.status === 'lost') return runtime;
    }
    return runtime;
  }

  it('mission is winnable with Client → API → Redis → Postgres at default capacities', () => {
    const final = runMission(cachedGraph);
    expect(final.status).toBe('won');
    expect(final.finalSnapshot).not.toBeNull();
    expect(final.finalSnapshot!.p95Ms).toBeLessThan(SPEC.winConditions.p95MaxMs);
    expect(final.finalSnapshot!.errorPct).toBeLessThanOrEqual(
      SPEC.winConditions.errorMaxPct
    );
    expect(final.finalSnapshot!.costUsd).toBeLessThanOrEqual(
      SPEC.winConditions.costMaxUsd
    );
  });

  it('mission is losable with Client → API → Postgres (no cache)', () => {
    const final = runMission(linearGraph);
    expect(final.status).toBe('lost');
    expect(final.lossReason).toBe('errors');
  });
});

describe('mission v2 win predicates', () => {
  const baseSpec: MissionSpec = {
    id: 'p',
    title: 't',
    brief: 'b',
    targetRps: 100,
    rampSeconds: 1,
    sustainSeconds: 60,
    winConditions: { p95MaxMs: 1000, errorMaxPct: 100, costMaxUsd: 10_000 },
    allowedComponents: ['client', 'api']
  };
  const snapBase: Snapshot = {
    perNodeUtilization: {},
    perNodeLatencyMs: {},
    perNodeErrorPct: {},
    perNodeIncomingRps: {},
    perEdgeRps: {},
    saturatedNodeIds: [],
    rps: 0,
    effectiveRps: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    errorPct: 0,
    costUsd: 0,
    staleReadPct: 0,
    cacheStaleReadPct: 0,
    queueDepthByNodeId: {},
    queueArrivalRpsByNodeId: {},
    queueDepthMax: 0,
    topologyErrors: [],
    timestamp: 0
  };
  const runtime = {
    ...initialRuntime(),
    sustainStartedAt: 0
  };

  it('writeMaxStaleReadPct fails when exceeded', () => {
    const spec = { ...baseSpec, writeMaxStaleReadPct: 5 };
    expect(
      winConditionsHold(spec, { ...snapBase, staleReadPct: 4 }, runtime, 1000)
    ).toBe(true);
    expect(
      winConditionsHold(spec, { ...snapBase, staleReadPct: 6 }, runtime, 1000)
    ).toBe(false);
  });

  it('availabilityMin fails when errorPct > (1-min)*100', () => {
    const spec = { ...baseSpec, availabilityMin: 0.999 };
    expect(
      winConditionsHold(spec, { ...snapBase, errorPct: 0.05 }, runtime, 1000)
    ).toBe(true);
    expect(
      winConditionsHold(spec, { ...snapBase, errorPct: 0.5 }, runtime, 1000)
    ).toBe(false);
  });

  it('queue-drained-within-60s ignores depth before 60s, requires 0 after', () => {
    const spec = {
      ...baseSpec,
      customWinPredicateId: 'queue-drained-within-60s'
    };
    expect(
      winConditionsHold(spec, { ...snapBase, queueDepthMax: 5000 }, runtime, 30_000)
    ).toBe(true);
    expect(
      winConditionsHold(spec, { ...snapBase, queueDepthMax: 5000 }, runtime, 70_000)
    ).toBe(false);
    expect(
      winConditionsHold(spec, { ...snapBase, queueDepthMax: 0 }, runtime, 70_000)
    ).toBe(true);
  });

  it('hasRequiredComponents enforces at least one node of each required type', () => {
    const spec = { ...baseSpec, requiredComponents: ['queue', 'worker'] as const };
    expect(
      hasRequiredComponents({ ...spec, requiredComponents: [...spec.requiredComponents] }, {
        nodes: [
          { id: 'c', type: 'client' },
          { id: 'q', type: 'queue' }
        ],
        edges: []
      })
    ).toBe(false);
    expect(
      hasRequiredComponents({ ...spec, requiredComponents: [...spec.requiredComponents] }, {
        nodes: [
          { id: 'q', type: 'queue' },
          { id: 'w', type: 'worker' }
        ],
        edges: []
      })
    ).toBe(true);
  });

  it('ingest-burst load profile = targetRps for 0..10s, 0 after', () => {
    const spec = { ...baseSpec, loadProfileId: 'ingest-burst', targetRps: 9999 };
    const r = { ...initialRuntime(), status: 'sustaining' as const, sustainStartedAt: 100 };
    expect(rampedRps(spec, r, 100)).toBe(9999);
    expect(rampedRps(spec, r, 5_000)).toBe(9999);
    expect(rampedRps(spec, r, 11_000)).toBe(0);
  });

  it('p95-marathon load profile peaks at midpoint, returns to lo at end', () => {
    const spec = {
      ...baseSpec,
      loadProfileId: 'p95-marathon',
      targetRps: 3000,
      sustainSeconds: 60
    };
    const r = { ...initialRuntime(), status: 'sustaining' as const, sustainStartedAt: 0 };
    expect(rampedRps(spec, r, 0)).toBe(500);
    expect(rampedRps(spec, r, 30_000)).toBe(3000);
    expect(rampedRps(spec, r, 60_000)).toBe(500);
  });
});

describe('decisive-decision detection', () => {
  it('mentions Redis savings when Redis is present in the winning topology', () => {
    const runtime = {
      ...initialRuntime(),
      status: 'won' as const,
      finalSnapshot: { ...winningSnap(0), p95Ms: 80 },
      finalGraph: cachedGraph
    };
    const d = decisiveDecision(SPEC, runtime);
    expect(d).not.toBeNull();
    expect(d!.message).toMatch(/Redis/);
    expect(d!.beforeP95Ms).toBeGreaterThan(d!.afterP95Ms);
  });

  it('mentions missing Redis when the losing topology lacks it', () => {
    const runtime = {
      ...initialRuntime(),
      status: 'lost' as const,
      finalSnapshot: { ...winningSnap(0), p95Ms: 4000 },
      finalGraph: linearGraph
    };
    const d = decisiveDecision(SPEC, runtime);
    expect(d).not.toBeNull();
    expect(d!.message).toMatch(/Without Redis/);
    expect(d!.beforeP95Ms).toBeGreaterThan(d!.afterP95Ms);
  });
});

describe('parseMission (v0.3 spec loader)', () => {
  const v02Raw = {
    id: 'user-service-1k',
    title: 'Build a user service',
    brief: 'Handle 1,000 RPS reads with p95 < 200ms.',
    targetRps: 1000,
    rampSeconds: 20,
    sustainSeconds: 30,
    winConditions: { p95MaxMs: 200, errorMaxPct: 1, costMaxUsd: 500 },
    allowedComponents: ['client', 'api', 'redis', 'postgres']
  };

  const v03Raw = {
    ...v02Raw,
    id: 'url-shortener-10k',
    tables: [
      {
        name: 'urls',
        rowCount: 10_000_000,
        avgRowSize: 200,
        columns: [
          { name: 'slug', type: 'text', indexed: true, primaryKey: true },
          { name: 'target', type: 'text', indexed: false }
        ]
      }
    ],
    endpoints: [
      {
        method: 'GET',
        route: '/:slug',
        table: 'urls',
        query: { type: 'pointIndexed', byColumn: 'slug' },
        responseSize: 200,
        skew: 'heavy',
        weight: 1
      }
    ]
  };

  it('loads a v0.2 mission with no tables/endpoints cleanly', () => {
    const m = parseMission(v02Raw);
    expect(m.id).toBe('user-service-1k');
    expect(m.tables).toBeUndefined();
    expect(m.endpoints).toBeUndefined();
  });

  it('round-trips a v0.3 mission preserving tables and endpoints', () => {
    const m = parseMission(v03Raw);
    expect(m.tables).toHaveLength(1);
    expect(m.tables![0].name).toBe('urls');
    expect(m.tables![0].columns).toHaveLength(2);
    expect(m.tables![0].columns[0].indexed).toBe(true);
    expect(m.endpoints).toHaveLength(1);
    expect(m.endpoints![0].query.type).toBe('pointIndexed');
    expect(m.endpoints![0].skew).toBe('heavy');
    expect(m.endpoints![0].table).toBe('urls');
  });

  it('rejects an endpoint that references an unknown table', () => {
    const bad = {
      ...v03Raw,
      endpoints: [{ ...v03Raw.endpoints[0], table: 'nope' }]
    };
    expect(() => parseMission(bad)).toThrow(/unknown table/i);
  });

  it('rejects an endpoint with an invalid query.type', () => {
    const bad = {
      ...v03Raw,
      endpoints: [
        { ...v03Raw.endpoints[0], query: { type: 'bogus' } }
      ]
    };
    expect(() => parseMission(bad)).toThrow(/query/i);
  });

  it('rejects an endpoint with an invalid skew', () => {
    const bad = {
      ...v03Raw,
      endpoints: [{ ...v03Raw.endpoints[0], skew: 'sideways' }]
    };
    expect(() => parseMission(bad)).toThrow(/skew/i);
  });

  it('rejects a table with duplicate column names', () => {
    const bad = {
      ...v03Raw,
      tables: [
        {
          ...v03Raw.tables[0],
          columns: [
            { name: 'slug', type: 'text', indexed: true, primaryKey: true },
            { name: 'slug', type: 'text', indexed: false }
          ]
        }
      ]
    };
    expect(() => parseMission(bad)).toThrow(/duplicate column/i);
  });

  it('rejects malformed input missing required fields', () => {
    expect(() => parseMission({})).toThrow();
    expect(() => parseMission(null)).toThrow();
  });
});

describe('parseMission: schema validation for indexes and byColumn', () => {
  it('auto-promotes primaryKey columns to indexed=true', () => {
    const m = parseMission({
      id: 'pk',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: false, primaryKey: true }]
        }
      ]
    });
    expect(m.tables![0].columns[0].indexed).toBe(true);
  });

  it('accepts endpoint with query.byColumn referencing an existing column', () => {
    const m = parseMission({
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'photos',
          rowCount: 10,
          avgRowSize: 100,
          columns: [
            { name: 'id', type: 'int', indexed: true, primaryKey: true },
            { name: 'user_id', type: 'int', indexed: true }
          ]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/photos',
          table: 'photos',
          query: { type: 'pointIndexed', byColumn: 'user_id' },
          responseSize: 100,
          skew: 'heavy',
          weight: 1
        }
      ]
    });
    expect(m.endpoints![0].query.byColumn).toBe('user_id');
    expect(m.endpoints![0].query.type).toBe('pointIndexed');
  });

  it('endpoint.replicaSafe defaults to true when omitted', () => {
    const m = parseMission({
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/x',
          table: 'x',
          query: { type: 'pointIndexed', byColumn: 'id' },
          responseSize: 1,
          skew: 'flat',
          weight: 1
        }
      ]
    });
    expect(m.endpoints![0].replicaSafe).toBe(true);
  });

  it('endpoint.replicaSafe round-trips false when set', () => {
    const m = parseMission({
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/x',
          table: 'x',
          query: { type: 'pointIndexed', byColumn: 'id' },
          responseSize: 1,
          skew: 'flat',
          weight: 1,
          replicaSafe: false
        }
      ]
    });
    expect(m.endpoints![0].replicaSafe).toBe(false);
  });

  it('endpoint.async defaults to false when omitted', () => {
    const m = parseMission({
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'POST',
          route: '/x',
          table: 'x',
          query: { type: 'write' },
          responseSize: 0,
          skew: 'flat',
          weight: 1
        }
      ]
    });
    expect(m.endpoints![0].async).toBe(false);
  });

  it('endpoint.edgeCacheable defaults to true for reads, false for writes', () => {
    const m = parseMission({
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/r',
          table: 'x',
          query: { type: 'pointIndexed', byColumn: 'id' },
          responseSize: 1,
          skew: 'flat',
          weight: 1
        },
        {
          method: 'POST',
          route: '/w',
          table: 'x',
          query: { type: 'write' },
          responseSize: 0,
          skew: 'flat',
          weight: 1
        }
      ]
    });
    expect(m.endpoints![0].edgeCacheable).toBe(true);
    expect(m.endpoints![1].edgeCacheable).toBe(false);
  });

  it('rejects edgeCacheable: true on a write endpoint', () => {
    const bad = {
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'POST',
          route: '/w',
          table: 'x',
          query: { type: 'write' },
          responseSize: 0,
          skew: 'flat',
          weight: 1,
          edgeCacheable: true
        }
      ]
    };
    expect(() => parseMission(bad)).toThrow(/edgeCacheable/i);
  });

  it('rejects async: true on a non-write endpoint', () => {
    const bad = {
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/x',
          table: 'x',
          query: { type: 'pointIndexed', byColumn: 'id' },
          responseSize: 1,
          skew: 'flat',
          weight: 1,
          async: true
        }
      ]
    };
    expect(() => parseMission(bad)).toThrow(/async.*write/i);
  });

  it('rejects non-boolean replicaSafe', () => {
    const bad = {
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'x',
          rowCount: 1,
          avgRowSize: 1,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/x',
          table: 'x',
          query: { type: 'pointIndexed', byColumn: 'id' },
          responseSize: 1,
          skew: 'flat',
          weight: 1,
          replicaSafe: 'yes'
        }
      ]
    };
    expect(() => parseMission(bad)).toThrow(/replicaSafe/);
  });

  it('rejects endpoint whose byColumn does not exist on the referenced table', () => {
    const bad = {
      id: 'p',
      title: 't',
      brief: 'b',
      targetRps: 1,
      rampSeconds: 1,
      sustainSeconds: 1,
      winConditions: { p95MaxMs: 1, errorMaxPct: 1, costMaxUsd: 1 },
      allowedComponents: ['client'],
      tables: [
        {
          name: 'photos',
          rowCount: 10,
          avgRowSize: 100,
          columns: [{ name: 'id', type: 'int', indexed: true, primaryKey: true }]
        }
      ],
      endpoints: [
        {
          method: 'GET',
          route: '/x',
          table: 'photos',
          query: { type: 'pointIndexed', byColumn: 'nope' },
          responseSize: 100,
          skew: 'flat',
          weight: 1
        }
      ]
    };
    expect(() => parseMission(bad)).toThrow(/byColumn/i);
  });
});
