import {
  NodeType,
  Snapshot,
  SimGraph,
  Table,
  Endpoint,
  EndpointCacheConfig,
  Column,
  CacheMode,
  QUERY_TYPES,
  SKEWS,
  QueryType,
  Skew
} from './types';
import { tick } from './core';
import { IncidentKind } from './incidents';

export type MissionStatus = 'idle' | 'ramping' | 'sustaining' | 'won' | 'lost';

export type LossReason = 'errors' | 'budget' | 'give-up' | null;

export interface ScheduledIncident {
  atMs: number;
  kind: IncidentKind;
  regionId?: string;
}

export interface MissionSpec {
  id: string;
  title: string;
  brief: string;
  targetRps: number;
  readPct?: number;
  rampSeconds: number;
  sustainSeconds: number;
  winConditions: {
    p95MaxMs: number;
    errorMaxPct: number;
    costMaxUsd: number;
  };
  writeMaxStaleReadPct?: number;
  availabilityMin?: number;
  requiredComponents?: NodeType[];
  customWinPredicateId?: string;
  loadProfileId?: string;
  incidentSchedule?: ScheduledIncident[];
  allowedComponents: NodeType[];
  tables?: Table[];
  endpoints?: Endpoint[];
}

export const DEFAULT_MISSION_READ_PCT = 100;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseColumn(raw: unknown, tableName: string): Column {
  if (!isObject(raw)) {
    throw new Error(`table "${tableName}": column must be an object`);
  }
  const { name, type, indexed, primaryKey } = raw;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`table "${tableName}": column name must be a non-empty string`);
  }
  if (typeof type !== 'string') {
    throw new Error(`table "${tableName}".${name}: type must be a string`);
  }
  if (typeof indexed !== 'boolean') {
    throw new Error(`table "${tableName}".${name}: indexed must be boolean`);
  }
  if (primaryKey !== undefined && typeof primaryKey !== 'boolean') {
    throw new Error(`table "${tableName}".${name}: primaryKey must be boolean`);
  }
  // PK columns are always indexed (CONTEXT.md: "Primary-key columns are always indexed.")
  const effectiveIndexed = primaryKey ? true : indexed;
  return { name, type, indexed: effectiveIndexed, primaryKey };
}

function parseTable(raw: unknown): Table {
  if (!isObject(raw)) throw new Error('table must be an object');
  const { name, rowCount, avgRowSize, columns } = raw;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('table.name must be a non-empty string');
  }
  if (typeof rowCount !== 'number' || rowCount < 0) {
    throw new Error(`table "${name}": rowCount must be a non-negative number`);
  }
  if (typeof avgRowSize !== 'number' || avgRowSize <= 0) {
    throw new Error(`table "${name}": avgRowSize must be a positive number`);
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error(`table "${name}": columns must be a non-empty array`);
  }
  const parsedColumns = columns.map((c) => parseColumn(c, name));
  const seen = new Set<string>();
  for (const c of parsedColumns) {
    if (seen.has(c.name)) {
      throw new Error(`table "${name}": duplicate column "${c.name}"`);
    }
    seen.add(c.name);
  }
  return { name, rowCount, avgRowSize, columns: parsedColumns };
}

function parseEndpoint(
  raw: unknown,
  tables: Record<string, Table>
): Endpoint {
  if (!isObject(raw)) throw new Error('endpoint must be an object');
  const { method, route, table, query, responseSize, skew, weight } = raw;
  if (typeof method !== 'string' || method.length === 0) {
    throw new Error('endpoint.method must be a non-empty string');
  }
  if (typeof route !== 'string' || route.length === 0) {
    throw new Error('endpoint.route must be a non-empty string');
  }
  if (typeof table !== 'string' || !(table in tables)) {
    throw new Error(`endpoint ${method} ${route}: unknown table "${String(table)}"`);
  }
  if (!isObject(query)) {
    throw new Error(`endpoint ${method} ${route}: query must be an object`);
  }
  const { type: qType, byColumn } = query;
  if (typeof qType !== 'string' || !QUERY_TYPES.includes(qType as QueryType)) {
    throw new Error(
      `endpoint ${method} ${route}: invalid query.type "${String(qType)}"`
    );
  }
  if (byColumn !== undefined) {
    if (typeof byColumn !== 'string') {
      throw new Error(
        `endpoint ${method} ${route}: query.byColumn must be a string`
      );
    }
    const columns = tables[table].columns;
    if (!columns.some((c) => c.name === byColumn)) {
      throw new Error(
        `endpoint ${method} ${route}: query.byColumn "${byColumn}" not found on table "${table}"`
      );
    }
  }
  if (typeof responseSize !== 'number' || responseSize < 0) {
    throw new Error(
      `endpoint ${method} ${route}: responseSize must be a non-negative number`
    );
  }
  if (typeof skew !== 'string' || !SKEWS.includes(skew as Skew)) {
    throw new Error(`endpoint ${method} ${route}: invalid skew "${String(skew)}"`);
  }
  if (typeof weight !== 'number' || weight < 0) {
    throw new Error(`endpoint ${method} ${route}: weight must be a non-negative number`);
  }
  const cache = parseCacheConfig(raw.cache, `${method} ${route}`);
  return {
    method,
    route,
    table,
    query: {
      type: qType as QueryType,
      byColumn: byColumn as string | undefined
    },
    responseSize,
    skew: skew as Skew,
    weight,
    cache
  };
}

const CACHE_MODES: CacheMode[] = ['invalidate', 'ttl'];

function parseCacheConfig(
  raw: unknown,
  ctx: string
): EndpointCacheConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new Error(`endpoint ${ctx}: cache must be an object`);
  const { mode, ttlSeconds, cardinality } = raw;
  const out: EndpointCacheConfig = {};
  if (mode !== undefined) {
    if (typeof mode !== 'string' || !CACHE_MODES.includes(mode as CacheMode)) {
      throw new Error(`endpoint ${ctx}: cache.mode must be 'invalidate' or 'ttl'`);
    }
    out.mode = mode as CacheMode;
  }
  if (ttlSeconds !== undefined) {
    if (typeof ttlSeconds !== 'number' || ttlSeconds <= 0) {
      throw new Error(`endpoint ${ctx}: cache.ttlSeconds must be a positive number`);
    }
    out.ttlSeconds = ttlSeconds;
  }
  if (cardinality !== undefined) {
    if (typeof cardinality !== 'number' || cardinality <= 0) {
      throw new Error(`endpoint ${ctx}: cache.cardinality must be a positive number`);
    }
    out.cardinality = cardinality;
  }
  return out;
}

export function parseMission(raw: unknown): MissionSpec {
  if (!isObject(raw)) {
    throw new Error('mission must be an object');
  }
  const required = ['id', 'title', 'brief', 'targetRps', 'rampSeconds', 'sustainSeconds', 'winConditions', 'allowedComponents'] as const;
  for (const key of required) {
    if (!(key in raw)) throw new Error(`mission missing required field "${key}"`);
  }
  const spec = raw as Record<string, unknown> & Partial<MissionSpec>;

  let tables: Table[] | undefined;
  if (spec.tables !== undefined) {
    if (!Array.isArray(spec.tables)) throw new Error('mission.tables must be an array');
    tables = spec.tables.map(parseTable);
    const seen = new Set<string>();
    for (const t of tables) {
      if (seen.has(t.name)) throw new Error(`duplicate table "${t.name}"`);
      seen.add(t.name);
    }
  }

  let endpoints: Endpoint[] | undefined;
  if (spec.endpoints !== undefined) {
    if (!Array.isArray(spec.endpoints)) {
      throw new Error('mission.endpoints must be an array');
    }
    const tableMap: Record<string, Table> = {};
    for (const t of tables ?? []) tableMap[t.name] = t;
    endpoints = spec.endpoints.map((e) => parseEndpoint(e, tableMap));
  }

  return {
    ...(raw as unknown as MissionSpec),
    tables,
    endpoints
  };
}

export interface MissionRuntime {
  status: MissionStatus;
  startedAt: number;
  sustainStartedAt: number | null;
  sustainHoldingSinceMs: number | null;
  errorOver50SinceMs: number | null;
  lossReason: LossReason;
  finalSnapshot: Snapshot | null;
  finalGraph: SimGraph | null;
  firedIncidentIndices: number[];
}

export const ERROR_HARD_FAIL_PCT = 50;
export const ERROR_HARD_FAIL_MS = 5_000;

export function initialRuntime(): MissionRuntime {
  return {
    status: 'idle',
    startedAt: 0,
    sustainStartedAt: null,
    sustainHoldingSinceMs: null,
    errorOver50SinceMs: null,
    lossReason: null,
    finalSnapshot: null,
    finalGraph: null,
    firedIncidentIndices: []
  };
}

export function startedRuntime(now: number): MissionRuntime {
  return { ...initialRuntime(), status: 'ramping', startedAt: now };
}

export type WinPredicate = (
  spec: MissionSpec,
  snapshot: Snapshot,
  runtime: MissionRuntime,
  now: number
) => boolean;

const queueDrainedWithin60s: WinPredicate = (_spec, snapshot, runtime, now) => {
  if (runtime.sustainStartedAt === null) return true;
  const elapsedSinceSustain = now - runtime.sustainStartedAt;
  if (elapsedSinceSustain < 60_000) return true;
  return snapshot.queueDepthMax === 0;
};

const staleReadBudget: WinPredicate = (spec, snapshot) => {
  if (spec.writeMaxStaleReadPct === undefined) return true;
  return snapshot.staleReadPct <= spec.writeMaxStaleReadPct;
};

const availabilityCheck: WinPredicate = (spec, snapshot) => {
  if (spec.availabilityMin === undefined) return true;
  return snapshot.errorPct <= (1 - spec.availabilityMin) * 100;
};

export const CUSTOM_WIN_PREDICATES: Record<string, WinPredicate> = {
  'queue-drained-within-60s': queueDrainedWithin60s,
  'stale-read-budget': staleReadBudget,
  'availability-99-9': availabilityCheck,
  'survive-region-outage': availabilityCheck,
  'p95-marathon': () => true
};

export function winConditionsHold(
  spec: MissionSpec,
  snapshot: Snapshot | null,
  runtime?: MissionRuntime,
  now?: number
): boolean {
  if (!snapshot) return false;
  const w = spec.winConditions;
  if (
    snapshot.p95Ms > w.p95MaxMs ||
    snapshot.errorPct > w.errorMaxPct ||
    snapshot.costUsd > w.costMaxUsd
  ) {
    return false;
  }
  if (
    spec.writeMaxStaleReadPct !== undefined &&
    snapshot.staleReadPct > spec.writeMaxStaleReadPct
  ) {
    return false;
  }
  if (
    spec.availabilityMin !== undefined &&
    snapshot.errorPct > (1 - spec.availabilityMin) * 100
  ) {
    return false;
  }
  if (spec.customWinPredicateId && runtime && now !== undefined) {
    const pred = CUSTOM_WIN_PREDICATES[spec.customWinPredicateId];
    if (pred && !pred(spec, snapshot, runtime, now)) return false;
  }
  return true;
}

export function hasRequiredComponents(
  spec: MissionSpec,
  graph: SimGraph
): boolean {
  if (!spec.requiredComponents || spec.requiredComponents.length === 0)
    return true;
  const present = new Set(graph.nodes.map((n) => n.type));
  return spec.requiredComponents.every((t) => present.has(t));
}

export type LoadProfile = (
  spec: MissionSpec,
  runtime: MissionRuntime,
  now: number
) => number;

const ingestBurst: LoadProfile = (spec, runtime, now) => {
  if (runtime.sustainStartedAt === null) return 0;
  const elapsed = now - runtime.sustainStartedAt;
  if (elapsed < 0 || elapsed > 10_000) return 0;
  return spec.targetRps;
};

const p95Marathon: LoadProfile = (spec, runtime, now) => {
  if (runtime.sustainStartedAt === null) return 0;
  const elapsed = now - runtime.sustainStartedAt;
  const sustainMs = spec.sustainSeconds * 1000;
  const t = Math.max(0, Math.min(1, elapsed / sustainMs));
  const lo = 500;
  const hi = spec.targetRps;
  const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
  return Math.round(lo + (hi - lo) * tri);
};

export const LOAD_PROFILES: Record<string, LoadProfile> = {
  'ingest-burst': ingestBurst,
  'p95-marathon': p95Marathon
};

export function rampedRps(
  spec: MissionSpec,
  runtime: MissionRuntime,
  now: number
): number {
  if (runtime.status === 'idle') return 0;
  if (runtime.status === 'ramping') {
    const elapsed = now - runtime.startedAt;
    const t = Math.max(0, Math.min(1, elapsed / (spec.rampSeconds * 1000)));
    return Math.round(spec.targetRps * t);
  }
  if (spec.loadProfileId) {
    const profile = LOAD_PROFILES[spec.loadProfileId];
    if (profile) return Math.max(0, Math.round(profile(spec, runtime, now)));
  }
  return spec.targetRps;
}

export function step(
  spec: MissionSpec,
  runtime: MissionRuntime,
  snapshot: Snapshot | null,
  graph: SimGraph,
  now: number,
  gaveUp: boolean
): MissionRuntime {
  if (
    runtime.status === 'idle' ||
    runtime.status === 'won' ||
    runtime.status === 'lost'
  ) {
    return runtime;
  }

  if (gaveUp) {
    return {
      ...runtime,
      status: 'lost',
      lossReason: 'give-up',
      finalSnapshot: snapshot,
      finalGraph: graph
    };
  }

  if (snapshot && snapshot.costUsd > spec.winConditions.costMaxUsd) {
    return {
      ...runtime,
      status: 'lost',
      lossReason: 'budget',
      finalSnapshot: snapshot,
      finalGraph: graph
    };
  }

  let errorOver50SinceMs = runtime.errorOver50SinceMs;
  if (snapshot && snapshot.errorPct > ERROR_HARD_FAIL_PCT) {
    if (errorOver50SinceMs === null) errorOver50SinceMs = now;
    if (now - errorOver50SinceMs >= ERROR_HARD_FAIL_MS) {
      return {
        ...runtime,
        status: 'lost',
        lossReason: 'errors',
        errorOver50SinceMs,
        finalSnapshot: snapshot,
        finalGraph: graph
      };
    }
  } else {
    errorOver50SinceMs = null;
  }

  if (runtime.status === 'ramping') {
    if (now - runtime.startedAt >= spec.rampSeconds * 1000) {
      return {
        ...runtime,
        status: 'sustaining',
        sustainStartedAt: now,
        sustainHoldingSinceMs: null,
        errorOver50SinceMs
      };
    }
    return { ...runtime, errorOver50SinceMs };
  }

  let sustainHoldingSinceMs = runtime.sustainHoldingSinceMs;
  if (winConditionsHold(spec, snapshot, runtime, now)) {
    if (sustainHoldingSinceMs === null) sustainHoldingSinceMs = now;
    if (now - sustainHoldingSinceMs >= spec.sustainSeconds * 1000) {
      return {
        ...runtime,
        status: 'won',
        sustainHoldingSinceMs,
        errorOver50SinceMs,
        finalSnapshot: snapshot,
        finalGraph: graph
      };
    }
  } else {
    sustainHoldingSinceMs = null;
  }

  return { ...runtime, sustainHoldingSinceMs, errorOver50SinceMs };
}

export interface DecisiveDecision {
  message: string;
  beforeP95Ms: number;
  afterP95Ms: number;
}

function hasRedis(graph: SimGraph): boolean {
  return graph.nodes.some((n) => n.type === 'redis');
}

function graphWithoutRedis(graph: SimGraph): SimGraph {
  const redisIds = new Set(
    graph.nodes.filter((n) => n.type === 'redis').map((n) => n.id)
  );
  if (redisIds.size === 0) return graph;
  const incoming: Record<string, string[]> = {};
  const outgoing: Record<string, string[]> = {};
  for (const e of graph.edges) {
    (incoming[e.target] ??= []).push(e.source);
    (outgoing[e.source] ??= []).push(e.target);
  }
  const nodes = graph.nodes.filter((n) => !redisIds.has(n.id));
  const edges: { source: string; target: string }[] = [];
  for (const e of graph.edges) {
    if (redisIds.has(e.source) || redisIds.has(e.target)) continue;
    edges.push(e);
  }
  for (const rid of redisIds) {
    const ups = incoming[rid] ?? [];
    const downs = outgoing[rid] ?? [];
    for (const u of ups) {
      for (const d of downs) {
        if (redisIds.has(u) || redisIds.has(d)) continue;
        if (!edges.some((e) => e.source === u && e.target === d)) {
          edges.push({ source: u, target: d });
        }
      }
    }
  }
  return { nodes, edges };
}

function graphWithRedisInserted(graph: SimGraph): SimGraph | null {
  const apiToPg = graph.edges.find((e) => {
    const s = graph.nodes.find((n) => n.id === e.source);
    const t = graph.nodes.find((n) => n.id === e.target);
    return s?.type === 'api' && t?.type === 'postgres';
  });
  if (!apiToPg) return null;
  const redisId = `__pm_redis__`;
  const nodes = [
    ...graph.nodes,
    { id: redisId, type: 'redis' as NodeType, instanceCount: 1 }
  ];
  const edges = graph.edges
    .filter((e) => e !== apiToPg)
    .concat([
      { source: apiToPg.source, target: redisId },
      { source: redisId, target: apiToPg.target }
    ]);
  return { nodes, edges };
}

export function decisiveDecision(
  spec: MissionSpec,
  runtime: MissionRuntime
): DecisiveDecision | null {
  const graph = runtime.finalGraph;
  if (!graph) return null;
  const actualP95 = runtime.finalSnapshot?.p95Ms ?? 0;
  const readPct = spec.readPct ?? DEFAULT_MISSION_READ_PCT;

  if (hasRedis(graph)) {
    const altGraph = graphWithoutRedis(graph);
    const altSnap = tick(
      { graph: altGraph, rps: spec.targetRps, readPct, incidents: [] },
      0
    );
    return {
      message: `Adding Redis dropped p95 from ${Math.round(altSnap.p95Ms)}ms to ${Math.round(actualP95)}ms.`,
      beforeP95Ms: altSnap.p95Ms,
      afterP95Ms: actualP95
    };
  }

  const altGraph = graphWithRedisInserted(graph);
  if (!altGraph) return null;
  const altSnap = tick(
    { graph: altGraph, rps: spec.targetRps, readPct, incidents: [] },
    0
  );
  return {
    message: `Without Redis, Postgres saturated — p95 hit ${Math.round(actualP95)}ms. With Redis it would have been ${Math.round(altSnap.p95Ms)}ms.`,
    beforeP95Ms: actualP95,
    afterP95Ms: altSnap.p95Ms
  };
}
