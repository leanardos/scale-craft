import { create } from 'zustand';
import { Snapshot, NodeType, SimGraph, edgeKey } from '../sim/types';
import {
  Tier,
  DEFAULT_REPLICATION_LAG_MS,
  DEFAULT_READ_KEY_CARDINALITY,
  CDN_DEFAULT_HIT_RATE,
  CDN_MAX_HIT_RATE
} from '../sim/specs';
import { Incident, IncidentKind, totalDurationMs } from '../sim/incidents';
import {
  MissionSpec,
  MissionRuntime,
  initialRuntime,
  startedRuntime,
  step as missionStep,
  rampedRps,
  DEFAULT_MISSION_READ_PCT
} from '../sim/mission';
import { Node, Edge } from 'reactflow';
import { SavedTopology } from './topology';
import {
  SeenHints,
  HintKey,
  loadSeenHints,
  writeSeenHints,
  clearSeenHints
} from './hints';

export const DIAL_MIN = 0;
export const DIAL_MAX = 5000;
export const DEFAULT_READ_PCT = 95;

export const HISTORY_WINDOW_MS = 60_000;
export const HISTORY_MAX_SAMPLES = 600;

export interface RFNodeData {
  type: NodeType;
  instanceCount: number;
  tier: Tier;
  lagMs?: number;
  readKeyCardinality?: number;
  hitRate?: number;
  regionId?: string;
}

export const MIN_INSTANCE_COUNT = 1;
export const MAX_INSTANCE_COUNT = 32;
export const DEFAULT_TIER: Tier = 'S';

export interface MetricSample {
  t: number;
  rps: number;
  effectiveRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorPct: number;
  costUsd: number;
  staleReadPct: number;
  queueDepthMax: number;
}

export interface NodeMetricSample {
  t: number;
  util: number;
}

export interface EdgeMetricSample {
  t: number;
  rps: number;
}

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string; source: string; target: string }
  | null;

interface AppState {
  snapshot: Snapshot | null;
  snapshotHistory: Snapshot[];
  historyOffsetMs: number;
  setHistoryOffsetMs: (ms: number) => void;
  history: MetricSample[];
  perNodeHistory: Record<string, NodeMetricSample[]>;
  perEdgeHistory: Record<string, EdgeMetricSample[]>;
  selection: Selection;
  setSelection: (sel: Selection) => void;
  clearSelection: () => void;
  setSnapshot: (s: Snapshot) => void;
  rps: number;
  setRps: (n: number) => void;
  readPct: number;
  setReadPct: (n: number) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;
  incidents: Incident[];
  triggerIncident: (kind: IncidentKind, opts?: { regionId?: string }) => void;
  clearIncidents: () => void;
  missionSpec: MissionSpec | null;
  missionRuntime: MissionRuntime;
  selectMission: (spec: MissionSpec) => void;
  clearMission: () => void;
  startMission: () => void;
  giveUpMission: () => void;
  endMissionToIdle: () => void;
  tickMission: (snapshot: Snapshot) => void;
  nodes: Node<RFNodeData>[];
  edges: Edge[];
  setNodes: (next: Node<RFNodeData>[]) => void;
  setEdges: (next: Edge[]) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNodes: (ids: string[]) => void;
  removeEdges: (ids: string[]) => void;
  addEdge: (edge: Edge) => void;
  setInstanceCount: (id: string, count: number) => void;
  setTier: (id: string, tier: Tier) => void;
  setLagMs: (id: string, ms: number) => void;
  setReadKeyCardinality: (id: string, n: number) => void;
  setHitRate: (id: string, hitRate: number) => void;
  setRegionId: (id: string, regionId: string) => void;
  applyTopology: (t: SavedTopology) => void;
  seenHints: SeenHints;
  markHintSeen: (key: HintKey | string) => void;
  resetHints: () => void;
  reset: () => void;
  toSimGraph: () => SimGraph;
}

let nodeCounter = 3;
const nextId = (type: NodeType) => `${type}-${nodeCounter++}`;

function bumpNodeCounter(ids: string[]): void {
  let max = nodeCounter;
  for (const id of ids) {
    const m = /-(\d+)$/.exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n + 1 > max) max = n + 1;
    }
  }
  nodeCounter = max;
}

const initialNodes: Node<RFNodeData>[] = [
  {
    id: 'client-1',
    type: 'client',
    position: { x: 60, y: 200 },
    data: { type: 'client', instanceCount: 1, tier: DEFAULT_TIER }
  },
  {
    id: 'api-1',
    type: 'api',
    position: { x: 320, y: 200 },
    data: { type: 'api', instanceCount: 1, tier: DEFAULT_TIER }
  },
  {
    id: 'postgres-1',
    type: 'postgres',
    position: { x: 600, y: 200 },
    data: { type: 'postgres', instanceCount: 1, tier: DEFAULT_TIER }
  }
];

const initialEdges: Edge[] = [
  { id: 'e-c-a', source: 'client-1', target: 'api-1', type: 'animated' },
  { id: 'e-a-p', source: 'api-1', target: 'postgres-1', type: 'animated' }
];

function pushBounded<T extends { t: number }>(
  prev: T[],
  sample: T,
  cutoff: number
): T[] {
  const start =
    prev.length > HISTORY_MAX_SAMPLES ? prev.length - HISTORY_MAX_SAMPLES : 0;
  const next: T[] = [];
  for (let i = start; i < prev.length; i++) {
    if (prev[i].t >= cutoff) next.push(prev[i]);
  }
  next.push(sample);
  return next;
}

function pushBoundedSnapshot(
  prev: Snapshot[],
  s: Snapshot,
  cutoff: number
): Snapshot[] {
  const start =
    prev.length > HISTORY_MAX_SAMPLES ? prev.length - HISTORY_MAX_SAMPLES : 0;
  const next: Snapshot[] = [];
  for (let i = start; i < prev.length; i++) {
    if (prev[i].timestamp >= cutoff) next.push(prev[i]);
  }
  next.push(s);
  return next;
}

export function findSnapshotAt(
  history: Snapshot[],
  live: Snapshot | null,
  offsetMs: number
): Snapshot | null {
  if (!live) return null;
  if (offsetMs <= 0 || history.length === 0) return live;
  const target = live.timestamp - offsetMs;
  let best: Snapshot = history[0];
  let bestDelta = Math.abs(history[0].timestamp - target);
  for (let i = 1; i < history.length; i++) {
    const d = Math.abs(history[i].timestamp - target);
    if (d < bestDelta) {
      best = history[i];
      bestDelta = d;
    }
  }
  return best;
}

export function useDisplaySnapshot(): Snapshot | null {
  return useStore((s) =>
    findSnapshotAt(s.snapshotHistory, s.snapshot, s.historyOffsetMs)
  );
}

function loadInitialHints(): SeenHints {
  if (typeof globalThis.localStorage === 'undefined') return {};
  return loadSeenHints();
}

export const useStore = create<AppState>((set, get) => ({
  seenHints: loadInitialHints(),
  markHintSeen: (key) => {
    const prev = get().seenHints;
    if (prev[key]) return;
    const next = { ...prev, [key]: true };
    writeSeenHints(next);
    set({ seenHints: next });
  },
  resetHints: () => {
    clearSeenHints();
    set({ seenHints: {} });
  },
  snapshot: null,
  snapshotHistory: [],
  historyOffsetMs: 0,
  setHistoryOffsetMs: (ms) => {
    const clamped = Math.max(0, Math.min(HISTORY_WINDOW_MS, Math.round(ms)));
    set({ historyOffsetMs: clamped });
  },
  history: [],
  perNodeHistory: {},
  perEdgeHistory: {},
  selection: null,
  setSelection: (sel) => set({ selection: sel }),
  clearSelection: () => set({ selection: null }),
  setSnapshot: (s) => {
    const sample: MetricSample = {
      t: s.timestamp,
      rps: s.rps,
      effectiveRps: s.effectiveRps,
      p50Ms: s.p50Ms,
      p95Ms: s.p95Ms,
      p99Ms: s.p99Ms,
      errorPct: s.errorPct,
      costUsd: s.costUsd,
      staleReadPct: s.staleReadPct,
      queueDepthMax: s.queueDepthMax
    };
    const cutoff = s.timestamp - HISTORY_WINDOW_MS;
    const prev = get().history;
    const next = pushBounded(prev, sample, cutoff);

    const prevNode = get().perNodeHistory;
    const nextNode: Record<string, NodeMetricSample[]> = {};
    for (const id in s.perNodeUtilization) {
      nextNode[id] = pushBounded(
        prevNode[id] ?? [],
        { t: s.timestamp, util: s.perNodeUtilization[id] },
        cutoff
      );
    }

    const prevEdge = get().perEdgeHistory;
    const nextEdge: Record<string, EdgeMetricSample[]> = {};
    for (const key in s.perEdgeRps) {
      nextEdge[key] = pushBounded(
        prevEdge[key] ?? [],
        { t: s.timestamp, rps: s.perEdgeRps[key] },
        cutoff
      );
    }

    const prevSnap = get().snapshotHistory;
    const nextSnap = pushBoundedSnapshot(prevSnap, s, cutoff);

    set({
      snapshot: s,
      snapshotHistory: nextSnap,
      history: next,
      perNodeHistory: nextNode,
      perEdgeHistory: nextEdge
    });
  },
  rps: 0,
  setRps: (n) =>
    set({ rps: Math.max(DIAL_MIN, Math.min(DIAL_MAX, Math.round(n))) }),
  readPct: DEFAULT_READ_PCT,
  setReadPct: (n) =>
    set({ readPct: Math.max(0, Math.min(100, Math.round(n))) }),
  paused: false,
  setPaused: (p) => set({ paused: p }),
  incidents: [],
  triggerIncident: (kind, opts) => {
    const now = Date.now();
    const others = get().incidents.filter(
      (i) => i.kind !== kind && now - i.startedAt < totalDurationMs(i.kind)
    );
    set({
      incidents: [
        ...others,
        { kind, startedAt: now, regionId: opts?.regionId }
      ]
    });
  },
  clearIncidents: () => set({ incidents: [] }),
  missionSpec: null,
  missionRuntime: initialRuntime(),
  selectMission: (spec) =>
    set({
      missionSpec: spec,
      missionRuntime: initialRuntime(),
      incidents: [],
      paused: false,
      history: [],
      perNodeHistory: {},
      perEdgeHistory: {},
      snapshot: null,
      snapshotHistory: [],
      historyOffsetMs: 0,
      rps: 0,
      readPct: spec.readPct ?? DEFAULT_MISSION_READ_PCT
    }),
  clearMission: () =>
    set({ missionSpec: null, missionRuntime: initialRuntime() }),
  startMission: () => {
    const spec = get().missionSpec;
    if (!spec) return;
    set({
      missionRuntime: startedRuntime(Date.now()),
      incidents: [],
      paused: false,
      history: [],
      perNodeHistory: {},
      perEdgeHistory: {},
      snapshot: null,
      snapshotHistory: [],
      historyOffsetMs: 0,
      rps: 0,
      readPct: spec.readPct ?? DEFAULT_MISSION_READ_PCT
    });
  },
  endMissionToIdle: () => {
    if (!get().missionSpec) return;
    set({
      missionRuntime: initialRuntime(),
      incidents: [],
      paused: false,
      history: [],
      perNodeHistory: {},
      perEdgeHistory: {},
      snapshot: null,
      snapshotHistory: [],
      historyOffsetMs: 0,
      rps: 0,
      readPct: DEFAULT_READ_PCT
    });
  },
  giveUpMission: () => {
    const { missionRuntime, missionSpec, snapshot, toSimGraph } = get();
    if (!missionSpec) return;
    if (
      missionRuntime.status !== 'ramping' &&
      missionRuntime.status !== 'sustaining'
    )
      return;
    const next = missionStep(
      missionSpec,
      missionRuntime,
      snapshot,
      toSimGraph(),
      Date.now(),
      true
    );
    set({ missionRuntime: next });
  },
  tickMission: (snapshot) => {
    const { missionSpec, missionRuntime, toSimGraph, incidents } = get();
    if (!missionSpec) return;
    if (
      missionRuntime.status !== 'ramping' &&
      missionRuntime.status !== 'sustaining'
    )
      return;
    const now = snapshot.timestamp;
    const graph = toSimGraph();
    const next = missionStep(missionSpec, missionRuntime, snapshot, graph, now, false);
    const targetRps = rampedRps(missionSpec, next, now);
    const lockedReadPct = missionSpec.readPct ?? DEFAULT_MISSION_READ_PCT;

    let firedIncidentIndices = next.firedIncidentIndices;
    let nextIncidents = incidents;
    const schedule = missionSpec.incidentSchedule ?? [];
    if (schedule.length > 0 && next.sustainStartedAt !== null) {
      const elapsed = now - next.sustainStartedAt;
      for (let i = 0; i < schedule.length; i++) {
        if (firedIncidentIndices.includes(i)) continue;
        if (elapsed >= schedule[i].atMs) {
          firedIncidentIndices = [...firedIncidentIndices, i];
          nextIncidents = [
            ...nextIncidents,
            {
              kind: schedule[i].kind,
              startedAt: now,
              regionId: schedule[i].regionId
            }
          ];
        }
      }
    }

    set({
      missionRuntime:
        firedIncidentIndices === next.firedIncidentIndices
          ? next
          : { ...next, firedIncidentIndices },
      rps: targetRps,
      readPct: lockedReadPct,
      incidents: nextIncidents
    });
  },
  nodes: initialNodes,
  edges: initialEdges,
  setNodes: (next) => set({ nodes: next }),
  setEdges: (next) => set({ edges: next }),
  addNode: (type, position) => {
    const id = nextId(type);
    const data: RFNodeData = {
      type,
      instanceCount: 1,
      tier: DEFAULT_TIER
    };
    if (type === 'postgresReplica') {
      data.lagMs = DEFAULT_REPLICATION_LAG_MS;
      data.readKeyCardinality = DEFAULT_READ_KEY_CARDINALITY;
    }
    if (type === 'cdn') {
      data.hitRate = CDN_DEFAULT_HIT_RATE;
    }
    set({
      nodes: [...get().nodes, { id, type, position, data }]
    });
  },
  setInstanceCount: (id, count) => {
    const clamped = Math.max(
      MIN_INSTANCE_COUNT,
      Math.min(MAX_INSTANCE_COUNT, Math.round(count))
    );
    set({
      nodes: get().nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, instanceCount: clamped } }
          : n
      )
    });
  },
  setTier: (id, tier) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, tier } } : n
      )
    });
  },
  setLagMs: (id, ms) => {
    const clamped = Math.max(0, Math.round(ms));
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, lagMs: clamped } } : n
      )
    });
  },
  setReadKeyCardinality: (id, n) => {
    const clamped = Math.max(1, Math.round(n));
    set({
      nodes: get().nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, readKeyCardinality: clamped } }
          : node
      )
    });
  },
  setHitRate: (id, hitRate) => {
    const clamped = Math.max(0, Math.min(CDN_MAX_HIT_RATE, hitRate));
    set({
      nodes: get().nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, hitRate: clamped } }
          : node
      )
    });
  },
  applyTopology: (t) => {
    const nodes: Node<RFNodeData>[] = t.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { ...n.data }
    }));
    const edges: Edge[] = t.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type ?? 'animated'
    }));
    bumpNodeCounter(nodes.map((n) => n.id));
    const { missionSpec, missionRuntime } = get();
    const missionRunning =
      !!missionSpec &&
      (missionRuntime.status === 'ramping' || missionRuntime.status === 'sustaining');
    set({
      nodes,
      edges,
      readPct: Math.max(0, Math.min(100, Math.round(t.readPct))),
      rps: 0,
      paused: false,
      snapshot: null,
      snapshotHistory: [],
      historyOffsetMs: 0,
      history: [],
      perNodeHistory: {},
      perEdgeHistory: {},
      selection: null,
      incidents: [],
      missionRuntime: missionRunning ? initialRuntime() : missionRuntime
    });
  },
  setRegionId: (id, regionId) => {
    const trimmed = regionId.trim();
    set({
      nodes: get().nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: { ...node.data, regionId: trimmed === '' ? undefined : trimmed }
            }
          : node
      )
    });
  },
  removeNodes: (ids) => {
    const idSet = new Set(ids);
    const remainingEdges = get().edges.filter(
      (e) => !idSet.has(e.source) && !idSet.has(e.target)
    );
    const droppedEdgeKeys = new Set(
      get()
        .edges.filter((e) => idSet.has(e.source) || idSet.has(e.target))
        .map((e) => edgeKey(e.source, e.target))
    );
    const prevNode = get().perNodeHistory;
    const nextNode: Record<string, NodeMetricSample[]> = {};
    for (const id in prevNode) {
      if (!idSet.has(id)) nextNode[id] = prevNode[id];
    }
    const prevEdge = get().perEdgeHistory;
    const nextEdge: Record<string, EdgeMetricSample[]> = {};
    for (const key in prevEdge) {
      if (!droppedEdgeKeys.has(key)) nextEdge[key] = prevEdge[key];
    }
    const sel = get().selection;
    const nextSel: Selection =
      sel && sel.kind === 'node' && idSet.has(sel.id)
        ? null
        : sel && sel.kind === 'edge' && (idSet.has(sel.source) || idSet.has(sel.target))
          ? null
          : sel;
    set({
      nodes: get().nodes.filter((n) => !idSet.has(n.id)),
      edges: remainingEdges,
      perNodeHistory: nextNode,
      perEdgeHistory: nextEdge,
      selection: nextSel
    });
  },
  removeEdges: (ids) => {
    const idSet = new Set(ids);
    const droppedKeys = new Set(
      get()
        .edges.filter((e) => idSet.has(e.id))
        .map((e) => edgeKey(e.source, e.target))
    );
    const prevEdge = get().perEdgeHistory;
    const nextEdge: Record<string, EdgeMetricSample[]> = {};
    for (const key in prevEdge) {
      if (!droppedKeys.has(key)) nextEdge[key] = prevEdge[key];
    }
    const sel = get().selection;
    const nextSel: Selection =
      sel && sel.kind === 'edge' && idSet.has(sel.id) ? null : sel;
    set({
      edges: get().edges.filter((e) => !idSet.has(e.id)),
      perEdgeHistory: nextEdge,
      selection: nextSel
    });
  },
  addEdge: (edge) => set({ edges: [...get().edges, edge] }),
  reset: () =>
    set({
      nodes: [],
      edges: [],
      rps: 0,
      paused: false,
      snapshot: null,
      snapshotHistory: [],
      historyOffsetMs: 0,
      history: [],
      perNodeHistory: {},
      perEdgeHistory: {},
      selection: null,
      incidents: [],
      missionSpec: null,
      missionRuntime: initialRuntime()
    }),
  toSimGraph: () => {
    const { nodes, edges } = get();
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.type,
        instanceCount: n.data.instanceCount ?? 1,
        tier: n.data.tier ?? DEFAULT_TIER,
        lagMs: n.data.lagMs,
        readKeyCardinality: n.data.readKeyCardinality,
        hitRate: n.data.hitRate,
        regionId: n.data.regionId
      })),
      edges: edges.map((e) => ({ source: e.source, target: e.target }))
    };
  }
}));
