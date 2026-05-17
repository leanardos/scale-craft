import { describe, it, expect, beforeEach } from 'vitest';
import {
  useStore,
  findSnapshotAt,
  HISTORY_MAX_SAMPLES,
  HISTORY_WINDOW_MS
} from './useStore';
import { Snapshot } from '../sim/types';

describe('store', () => {
  beforeEach(() => {
    useStore.setState({
      nodes: [
        {
          id: 'a',
          type: 'api',
          position: { x: 0, y: 0 },
          data: { type: 'api', instanceCount: 1, tier: 'S' }
        },
        {
          id: 'b',
          type: 'postgres',
          position: { x: 0, y: 0 },
          data: { type: 'postgres', instanceCount: 1, tier: 'S' }
        }
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }]
    });
  });

  it('removeNodes drops dangling edges', () => {
    useStore.getState().removeNodes(['b']);
    const { nodes, edges } = useStore.getState();
    expect(nodes.map((n) => n.id)).toEqual(['a']);
    expect(edges).toEqual([]);
  });

  it('history is bounded by sample count and window', () => {
    useStore.setState({ history: [] });
    const mk = (t: number): Snapshot => ({
      perNodeUtilization: {},
      perNodeLatencyMs: {},
      perNodeErrorPct: {},
      perNodeIncomingRps: {},
      perEdgeRps: {},
      saturatedNodeIds: [],
      rps: 100,
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
      timestamp: t
    });
    const total = HISTORY_MAX_SAMPLES + 200;
    const tickStep = 100;
    for (let i = 0; i < total; i++) {
      useStore.getState().setSnapshot(mk(i * tickStep));
    }
    const { history } = useStore.getState();
    expect(history.length).toBeLessThanOrEqual(HISTORY_MAX_SAMPLES + 1);
    const last = history[history.length - 1];
    const first = history[0];
    expect(last.t - first.t).toBeLessThanOrEqual(HISTORY_WINDOW_MS);
  });

  it('reset clears graph, dial, history, and snapshot', () => {
    useStore.setState({
      rps: 1234,
      paused: true,
      snapshot: {
        perNodeUtilization: { a: 0.5 },
        perNodeLatencyMs: {},
        perNodeErrorPct: {},
        perNodeIncomingRps: {},
        perEdgeRps: {},
        saturatedNodeIds: [],
        rps: 1234,
        effectiveRps: 0,
        p50Ms: 8,
        p95Ms: 12,
        p99Ms: 20,
        errorPct: 0,
        costUsd: 150,
        staleReadPct: 0,
        cacheStaleReadPct: 0,
        queueDepthByNodeId: {},
        queueArrivalRpsByNodeId: {},
        queueDepthMax: 0,
        topologyErrors: [],
        timestamp: 0
      },
      history: [
        {
          t: 0,
          rps: 1,
          effectiveRps: 0,
          p50Ms: 0,
          p95Ms: 1,
          p99Ms: 0,
          errorPct: 0,
          costUsd: 0,
          staleReadPct: 0,
          queueDepthMax: 0
        },
        {
          t: 1,
          rps: 2,
          effectiveRps: 0,
          p50Ms: 0,
          p95Ms: 1,
          p99Ms: 0,
          errorPct: 0,
          costUsd: 0,
          staleReadPct: 0,
          queueDepthMax: 0
        }
      ]
    });
    useStore.getState().reset();
    const s = useStore.getState();
    expect(s.nodes).toEqual([]);
    expect(s.edges).toEqual([]);
    expect(s.rps).toBe(0);
    expect(s.paused).toBe(false);
    expect(s.snapshot).toBeNull();
    expect(s.history).toEqual([]);
  });

  it('triggerIncident adds an incident; re-triggering same kind re-arms it cleanly', () => {
    useStore.setState({ incidents: [] });
    useStore.getState().triggerIncident('kill-postgres');
    const first = useStore.getState().incidents;
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe('kill-postgres');

    const firstStartedAt = first[0].startedAt;
    // ensure clock advances at least 1 ms before re-arming
    const start = Date.now();
    while (Date.now() === start) {
      // spin
    }
    useStore.getState().triggerIncident('kill-postgres');
    const second = useStore.getState().incidents;
    expect(second).toHaveLength(1);
    expect(second[0].startedAt).toBeGreaterThan(firstStartedAt);
  });

  it('reset clears active incidents', () => {
    useStore.setState({
      incidents: [{ kind: 'kill-postgres', startedAt: Date.now() }]
    });
    useStore.getState().reset();
    expect(useStore.getState().incidents).toEqual([]);
  });

  it('findSnapshotAt: returns the snapshot within ±100 ms (one tick) of the requested offset', () => {
    const mk = (t: number): Snapshot => ({
      perNodeUtilization: {},
      perNodeLatencyMs: {},
      perNodeErrorPct: {},
      perNodeIncomingRps: {},
      perEdgeRps: {},
      saturatedNodeIds: [],
      rps: t,
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
      timestamp: t
    });
    const TICK_MS = 100;
    const live = mk(60_000);
    const history: Snapshot[] = [];
    for (let t = 0; t <= 60_000; t += TICK_MS) history.push(mk(t));

    const offset = 5_000;
    const result = findSnapshotAt(history, live, offset);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.timestamp - (live.timestamp - offset))).toBeLessThanOrEqual(
      TICK_MS
    );

    expect(findSnapshotAt(history, live, 0)).toBe(live);
    expect(findSnapshotAt(history, null, 1_000)).toBeNull();
  });

  it('setHistoryOffsetMs clamps to [0, HISTORY_WINDOW_MS]; reset returns to live', () => {
    useStore.setState({ historyOffsetMs: 0 });
    useStore.getState().setHistoryOffsetMs(5_000);
    expect(useStore.getState().historyOffsetMs).toBe(5_000);
    useStore.getState().setHistoryOffsetMs(-1);
    expect(useStore.getState().historyOffsetMs).toBe(0);
    useStore.getState().setHistoryOffsetMs(HISTORY_WINDOW_MS + 1000);
    expect(useStore.getState().historyOffsetMs).toBe(HISTORY_WINDOW_MS);
    useStore.getState().reset();
    expect(useStore.getState().historyOffsetMs).toBe(0);
    expect(useStore.getState().snapshotHistory).toEqual([]);
  });

  it('setPaused toggles paused flag', () => {
    useStore.setState({ paused: false });
    useStore.getState().setPaused(true);
    expect(useStore.getState().paused).toBe(true);
    useStore.getState().setPaused(false);
    expect(useStore.getState().paused).toBe(false);
  });

  it('toSimGraph projects RF state to sim shape', () => {
    const g = useStore.getState().toSimGraph();
    expect(g.nodes).toEqual([
      { id: 'a', type: 'api', instanceCount: 1, tier: 'S' },
      { id: 'b', type: 'postgres', instanceCount: 1, tier: 'S' }
    ]);
    expect(g.edges).toEqual([{ source: 'a', target: 'b' }]);
  });

  it('setTier updates the node tier', () => {
    useStore.getState().setTier('a', 'XL');
    expect(useStore.getState().nodes.find((n) => n.id === 'a')?.data.tier).toBe('XL');
  });

  it('setInstanceCount clamps to ≥ 1 and updates the node', () => {
    useStore.getState().setInstanceCount('a', 4);
    expect(
      useStore.getState().nodes.find((n) => n.id === 'a')?.data.instanceCount
    ).toBe(4);
    useStore.getState().setInstanceCount('a', 0);
    expect(
      useStore.getState().nodes.find((n) => n.id === 'a')?.data.instanceCount
    ).toBe(1);
  });
});
