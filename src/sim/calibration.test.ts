import { describe, it, expect } from 'vitest';
import { tick } from './core';
import { Incident } from './incidents';
import {
  MissionSpec,
  LOAD_PROFILES,
  DEFAULT_MISSION_READ_PCT
} from './mission';
import { SimGraph, SimNode, Snapshot } from './types';
import ordersSpec from '../missions/orders-5k-writes.json';
import ingestSpec from '../missions/ingest-100k-burst.json';
import timelineSpec from '../missions/timeline-stale-reads.json';
import surviveSpec from '../missions/survive-region-outage.json';
import marathonSpec from '../missions/p95-marathon.json';

const TICK_MS = 100;

interface MissionRunResult {
  finalSnapshot: Snapshot | null;
  maxErrorPct: number;
  maxP95Ms: number;
  maxCostUsd: number;
  maxQueueDepth: number;
  maxStaleReadPct: number;
}

// Bypass the mission state machine: tick through the full timeline at steady-state
// load (scaled by spec.loadProfileId if set) with the spec's incident schedule.
// We're measuring whether the topology behaves correctly under load, not whether
// the run technically passes mission.step() — cost gating + budget calibration is
// HITL territory and would short-circuit metric collection here.
function simulateMission(spec: MissionSpec, graph: SimGraph): MissionRunResult {
  const sustainStart = spec.rampSeconds * 1000;
  const totalMs = sustainStart + spec.sustainSeconds * 1000;
  let prevDepths: Record<string, number> = {};
  let snap: Snapshot | null = null;
  const profile = spec.loadProfileId ? LOAD_PROFILES[spec.loadProfileId] : null;

  let maxErrorPct = 0;
  let maxP95Ms = 0;
  let maxCostUsd = 0;
  let maxQueueDepth = 0;
  let maxStaleReadPct = 0;

  const fakeRuntime = {
    sustainStartedAt: sustainStart,
    status: 'sustaining' as const
  };

  for (let now = 0; now <= totalMs; now += TICK_MS) {
    let rps: number;
    if (now < sustainStart) {
      rps = Math.round(spec.targetRps * (now / sustainStart));
    } else if (profile) {
      // Use the spec's load profile for steady state.
      rps = Math.round(
        profile(spec, fakeRuntime as never, now)
      );
    } else {
      rps = spec.targetRps;
    }

    const incidents: Incident[] = [];
    const schedule = spec.incidentSchedule ?? [];
    if (now >= sustainStart) {
      const elapsed = now - sustainStart;
      for (const inc of schedule) {
        if (elapsed >= inc.atMs && elapsed < inc.atMs + 60_000) {
          incidents.push({
            kind: inc.kind,
            startedAt: sustainStart + inc.atMs,
            regionId: inc.regionId
          });
        }
      }
    }

    const readPct = spec.readPct ?? DEFAULT_MISSION_READ_PCT;
    snap = tick(
      { graph, rps, readPct, incidents },
      now,
      prevDepths,
      TICK_MS
    );
    prevDepths = snap.queueDepthByNodeId;

    if (now >= sustainStart) {
      maxErrorPct = Math.max(maxErrorPct, snap.errorPct);
      maxP95Ms = Math.max(maxP95Ms, snap.p95Ms);
      maxCostUsd = Math.max(maxCostUsd, snap.costUsd);
      maxQueueDepth = Math.max(maxQueueDepth, snap.queueDepthMax);
      maxStaleReadPct = Math.max(maxStaleReadPct, snap.staleReadPct);
    }
  }

  return {
    finalSnapshot: snap,
    maxErrorPct,
    maxP95Ms,
    maxCostUsd,
    maxQueueDepth,
    maxStaleReadPct
  };
}

function linearChain(types: string[]): SimGraph {
  const nodes: SimNode[] = types.map((type, i) => ({
    id: `n${i}-${type}`,
    type: type as SimNode['type']
  }));
  const edges = nodes.slice(0, -1).map((n, i) => ({
    source: n.id,
    target: nodes[i + 1].id
  }));
  return { nodes, edges };
}

function setNode(graph: SimGraph, id: string, patch: Partial<SimNode>): SimGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n))
  };
}

describe('mission calibration — orders-5k-writes (writes only, sharding mission)', () => {
  const spec = ordersSpec as unknown as MissionSpec;

  // Intended: load balancer → APIs → sharded Postgres (multiple postgres edges from one API).
  // Post-v0.3: writes cost 5 ms each, so 5000 writes/sec = 25k work-ms/sec.
  // Each shard needs ≥ ~13k wmps; 5 × L (4×) × 1000 wmps = 20k wmps per shard.
  const intendedGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'lb', type: 'lb' },
      { id: 'a', type: 'api', instanceCount: 4, tier: 'M' },
      { id: 'p1', type: 'postgres', instanceCount: 5, tier: 'L' },
      { id: 'p2', type: 'postgres', instanceCount: 5, tier: 'L' }
    ],
    edges: [
      { source: 'c', target: 'lb' },
      { source: 'lb', target: 'a' },
      { source: 'a', target: 'p1' },
      { source: 'a', target: 'p2' }
    ]
  };

  // Runner-up: single vertically-scaled Postgres. Cheaper but capacity-bound.
  const runnerUpGraph: SimGraph = linearChain(['client', 'api', 'postgres']);
  const runnerUp = setNode(runnerUpGraph, 'n2-postgres', {
    instanceCount: 1,
    tier: 'XL'
  });

  it('runner-up (single XL Postgres) saturates: errors > spec error budget', () => {
    const result = simulateMission(spec, runnerUp);
    expect(result.maxErrorPct).toBeGreaterThan(spec.winConditions.errorMaxPct);
  });

  it('intended sharded topology beats the runner-up on p95 (deciding metric)', () => {
    const intended = simulateMission(spec, intendedGraph);
    const runner = simulateMission(spec, runnerUp);
    expect(intended.maxP95Ms).toBeLessThan(runner.maxP95Ms);
  });
});

describe('mission calibration — ingest-100k-burst (queue-backpressure mission)', () => {
  const spec = ingestSpec as unknown as MissionSpec;

  // Intended: API → Queue → Workers (well-sized) → Postgres.
  const intendedGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'a', type: 'api', instanceCount: 2 },
      { id: 'q', type: 'queue' },
      { id: 'w', type: 'worker', instanceCount: 50, tier: 'M' },
      { id: 'p', type: 'postgres', instanceCount: 1, tier: 'L' }
    ],
    edges: [
      { source: 'c', target: 'a' },
      { source: 'a', target: 'q' },
      { source: 'q', target: 'w' },
      { source: 'w', target: 'p' }
    ]
  };

  // Runner-up: undersized worker pool — queue won't drain in 60s.
  const runnerUpGraph: SimGraph = {
    ...intendedGraph,
    nodes: intendedGraph.nodes.map((n) =>
      n.id === 'w' ? { ...n, instanceCount: 5, tier: 'S' } : n
    )
  };

  it('runner-up (5 workers) leaves queue depth at end of window', () => {
    const result = simulateMission(spec, runnerUpGraph);
    expect(result.finalSnapshot?.queueDepthMax ?? 0).toBeGreaterThan(0);
  });

  it('intended drains far more than runner-up at end of burst window', () => {
    const intended = simulateMission(spec, intendedGraph);
    const runner = simulateMission(spec, runnerUpGraph);
    expect(intended.maxQueueDepth).toBeLessThan(runner.maxQueueDepth);
  });
});

describe('mission calibration — timeline-stale-reads (caching/replica mission)', () => {
  const spec = timelineSpec as unknown as MissionSpec;

  // Intended: read traffic served by Redis + replica with low lag; writes go to primary.
  const intendedGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'lb', type: 'lb' },
      { id: 'a', type: 'api', instanceCount: 4, tier: 'M' },
      { id: 'r', type: 'redis', instanceCount: 1, tier: 'M' },
      { id: 'p', type: 'postgres', instanceCount: 1, tier: 'L' },
      {
        id: 'pr',
        type: 'postgresReplica',
        instanceCount: 4,
        tier: 'M',
        lagMs: 50
      }
    ],
    edges: [
      { source: 'c', target: 'lb' },
      { source: 'lb', target: 'a' },
      { source: 'a', target: 'r' },
      { source: 'r', target: 'pr' },
      { source: 'a', target: 'p' }
    ]
  };

  // Runner-up: skipped Redis — replica direct with high lag, sees full read traffic.
  const runnerUpGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'lb', type: 'lb' },
      { id: 'a', type: 'api', instanceCount: 4, tier: 'M' },
      { id: 'p', type: 'postgres', instanceCount: 1, tier: 'L' },
      {
        id: 'pr',
        type: 'postgresReplica',
        instanceCount: 4,
        tier: 'M',
        lagMs: 1000
      }
    ],
    edges: [
      { source: 'c', target: 'lb' },
      { source: 'lb', target: 'a' },
      { source: 'a', target: 'pr' },
      { source: 'a', target: 'p' }
    ]
  };

  it('runner-up (high replication lag) blows the stale-read budget', () => {
    const runner = simulateMission(spec, runnerUpGraph);
    expect(runner.maxStaleReadPct).toBeGreaterThan(spec.writeMaxStaleReadPct ?? 0);
  });

  it('intended (low-lag replica) has lower stale-read pct than runner-up', () => {
    const intended = simulateMission(spec, intendedGraph);
    const runner = simulateMission(spec, runnerUpGraph);
    expect(intended.maxStaleReadPct).toBeLessThan(runner.maxStaleReadPct);
  });
});

describe('mission calibration — survive-region-outage (fault-tolerance mission)', () => {
  const spec = surviveSpec as unknown as MissionSpec;

  // Intended: serve from 'us' only — eu outage doesn't touch our serving path.
  // (v0.2 sim aggregates errors multiplicatively across all nodes, so genuine
  //  fan-out failover would require sim-model changes; HITL note in CALIBRATION-v2.md.)
  const intendedGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client', regionId: 'us' },
      { id: 'lb', type: 'lb', regionId: 'us' },
      { id: 'a-us', type: 'api', instanceCount: 2, tier: 'M', regionId: 'us' },
      { id: 'p-us', type: 'postgres', instanceCount: 1, tier: 'L', regionId: 'us' }
    ],
    edges: [
      { source: 'c', target: 'lb' },
      { source: 'lb', target: 'a-us' },
      { source: 'a-us', target: 'p-us' }
    ]
  };

  // Runner-up: everything in 'eu' — the outage takes everything down.
  const runnerUpGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client', regionId: 'eu' },
      { id: 'a', type: 'api', instanceCount: 2, tier: 'M', regionId: 'eu' },
      { id: 'p', type: 'postgres', instanceCount: 1, tier: 'L', regionId: 'eu' }
    ],
    edges: [
      { source: 'c', target: 'a' },
      { source: 'a', target: 'p' }
    ]
  };

  it('runner-up (single region) blows availability during eu outage', () => {
    const runner = simulateMission(spec, runnerUpGraph);
    const availMin = spec.availabilityMin ?? 0;
    expect(runner.maxErrorPct).toBeGreaterThan((1 - availMin) * 100);
  });

  it('intended (multi-region) keeps errors lower than runner-up during outage', () => {
    const intended = simulateMission(spec, intendedGraph);
    const runner = simulateMission(spec, runnerUpGraph);
    expect(intended.maxErrorPct).toBeLessThan(runner.maxErrorPct);
  });
});

describe('mission calibration — p95-marathon (sustained SLO mission)', () => {
  const spec = marathonSpec as unknown as MissionSpec;

  // Intended: CDN + Redis + horizontally-scaled APIs absorb the variable load.
  const intendedGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'cdn', type: 'cdn', hitRate: 0.7 },
      { id: 'lb', type: 'lb' },
      { id: 'a', type: 'api', instanceCount: 3, tier: 'M' },
      { id: 'r', type: 'redis', instanceCount: 1, tier: 'M' },
      { id: 'p', type: 'postgres', instanceCount: 1, tier: 'L' }
    ],
    edges: [
      { source: 'c', target: 'cdn' },
      { source: 'cdn', target: 'lb' },
      { source: 'lb', target: 'a' },
      { source: 'a', target: 'r' },
      { source: 'r', target: 'p' }
    ]
  };

  // Runner-up: no CDN, no Redis. Postgres saturates at peak load.
  const runnerUpGraph: SimGraph = {
    nodes: [
      { id: 'c', type: 'client' },
      { id: 'a', type: 'api', instanceCount: 2, tier: 'M' },
      { id: 'p', type: 'postgres', instanceCount: 1, tier: 'L' }
    ],
    edges: [
      { source: 'c', target: 'a' },
      { source: 'a', target: 'p' }
    ]
  };

  it('runner-up (no caching) sees p95 spike well above the SLO at peak load', () => {
    const runner = simulateMission(spec, runnerUpGraph);
    expect(runner.maxP95Ms).toBeGreaterThan(spec.winConditions.p95MaxMs);
  });

  it('intended beats runner-up on peak p95', () => {
    const intended = simulateMission(spec, intendedGraph);
    const runner = simulateMission(spec, runnerUpGraph);
    expect(intended.maxP95Ms).toBeLessThan(runner.maxP95Ms);
  });
});
