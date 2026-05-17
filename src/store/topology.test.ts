import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { useStore } from './useStore';
import {
  serializeTopology,
  isSavedTopology,
  saveTopology,
  listSavedTopologies,
  deleteSavedTopology,
  topologyFileName,
  TOPOLOGY_STORAGE_KEY,
  MAX_SAVED_TOPOLOGIES
} from './topology';
import { startedRuntime } from '../sim/mission';
import { Node, Edge } from 'reactflow';
import { RFNodeData } from './useStore';

const sampleNodes: Node<RFNodeData>[] = [
  {
    id: 'client-1',
    type: 'client',
    position: { x: 10, y: 20 },
    data: { type: 'client', instanceCount: 1, tier: 'S' }
  },
  {
    id: 'api-2',
    type: 'api',
    position: { x: 200, y: 100 },
    data: { type: 'api', instanceCount: 4, tier: 'M', regionId: 'us-east' }
  },
  {
    id: 'postgresReplica-7',
    type: 'postgresReplica',
    position: { x: 400, y: 100 },
    data: {
      type: 'postgresReplica',
      instanceCount: 1,
      tier: 'L',
      lagMs: 250,
      readKeyCardinality: 5000,
      regionId: 'us-east'
    }
  }
];

const sampleEdges: Edge[] = [
  { id: 'e1', source: 'client-1', target: 'api-2', type: 'animated' },
  { id: 'e2', source: 'api-2', target: 'postgresReplica-7', type: 'animated' }
];

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v))
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true
  });
}

describe('topology round-trip', () => {
  beforeAll(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      installLocalStorageStub();
    }
  });

  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      nodes: sampleNodes,
      edges: sampleEdges,
      readPct: 80,
      missionSpec: null,
      missionRuntime: { status: 'idle' } as never
    });
  });

  it('serializes and round-trips through applyTopology losslessly', () => {
    const t = serializeTopology('my-topo', sampleNodes, sampleEdges, 80, 1234);
    expect(isSavedTopology(t)).toBe(true);

    useStore.setState({
      nodes: [],
      edges: [],
      readPct: 0,
      snapshot: null,
      history: [],
      perNodeHistory: {},
      perEdgeHistory: {},
      snapshotHistory: [],
      historyOffsetMs: 0,
      incidents: []
    });

    useStore.getState().applyTopology(t);

    const s = useStore.getState();
    expect(s.readPct).toBe(80);
    expect(s.nodes).toHaveLength(sampleNodes.length);
    for (let i = 0; i < sampleNodes.length; i++) {
      expect(s.nodes[i].id).toBe(sampleNodes[i].id);
      expect(s.nodes[i].type).toBe(sampleNodes[i].type);
      expect(s.nodes[i].position).toEqual(sampleNodes[i].position);
      expect(s.nodes[i].data).toEqual(sampleNodes[i].data);
    }
    expect(s.edges).toEqual(sampleEdges);
  });

  it('applyTopology resets sim runtime fields', () => {
    useStore.setState({
      rps: 999,
      historyOffsetMs: 1000,
      history: [
        {
          t: 1,
          rps: 1,
          effectiveRps: 0,
          p50Ms: 0,
          p95Ms: 1,
          p99Ms: 0,
          errorPct: 0,
          costUsd: 0,
          staleReadPct: 0,
          queueDepthMax: 0
        }
      ],
      incidents: [{ kind: 'kill-postgres', startedAt: 0 }]
    });
    const t = serializeTopology('x', sampleNodes, sampleEdges, 50, 0);
    useStore.getState().applyTopology(t);
    const s = useStore.getState();
    expect(s.rps).toBe(0);
    expect(s.historyOffsetMs).toBe(0);
    expect(s.history).toEqual([]);
    expect(s.snapshot).toBeNull();
    expect(s.incidents).toEqual([]);
  });

  it('applyTopology while a mission is running ends the mission to idle', () => {
    useStore.setState({
      missionSpec: {
        id: 'm1',
        title: 't',
        brief: 'b',
        targetRps: 100,
        rampSeconds: 1,
        sustainSeconds: 1,
        winConditions: { p95MaxMs: 100, errorMaxPct: 1, costMaxUsd: 100 },
        allowedComponents: []
      },
      missionRuntime: startedRuntime(0)
    });
    expect(useStore.getState().missionRuntime.status).toBe('ramping');

    const t = serializeTopology('x', sampleNodes, sampleEdges, 50, 0);
    useStore.getState().applyTopology(t);

    expect(useStore.getState().missionRuntime.status).toBe('idle');
  });

  it('saveTopology / listSavedTopologies / deleteSavedTopology persist via localStorage', () => {
    const a = serializeTopology('alpha', sampleNodes, sampleEdges, 90, 100);
    const b = serializeTopology('beta', sampleNodes, sampleEdges, 70, 200);
    saveTopology(a);
    saveTopology(b);

    const list = listSavedTopologies();
    expect(list.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);

    deleteSavedTopology('alpha');
    expect(listSavedTopologies().map((t) => t.name)).toEqual(['beta']);
  });

  it('saving the same name overwrites the previous entry', () => {
    saveTopology(serializeTopology('a', sampleNodes, sampleEdges, 90, 100));
    saveTopology(serializeTopology('a', sampleNodes, [], 50, 200));
    const list = listSavedTopologies();
    expect(list).toHaveLength(1);
    expect(list[0].savedAt).toBe(200);
    expect(list[0].edges).toEqual([]);
  });

  it('isSavedTopology rejects bad shapes', () => {
    expect(isSavedTopology(null)).toBe(false);
    expect(isSavedTopology({})).toBe(false);
    expect(isSavedTopology({ name: 'x' })).toBe(false);
    expect(
      isSavedTopology({
        name: 'x',
        savedAt: 1,
        readPct: 50,
        nodes: [],
        edges: []
      })
    ).toBe(true);
  });

  it('listSavedTopologies returns [] on corrupt storage', () => {
    localStorage.setItem(TOPOLOGY_STORAGE_KEY, '{not json');
    expect(listSavedTopologies()).toEqual([]);
  });

  it('topologyFileName produces a safe filename', () => {
    expect(topologyFileName('my topology')).toBe('my_topology.scalecraft.json');
    expect(topologyFileName('')).toBe('topology.scalecraft.json');
    expect(topologyFileName('a/b\\c')).toBe('a_b_c.scalecraft.json');
  });

  it('MAX_SAVED_TOPOLOGIES is 5', () => {
    expect(MAX_SAVED_TOPOLOGIES).toBe(5);
  });
});
