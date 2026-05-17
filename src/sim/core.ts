import {
  SimState,
  Snapshot,
  SimGraph,
  SimNode,
  NodeType,
  Table,
  edgeKey
} from './types';
import {
  NODE_SPECS,
  LEGACY_DEFAULT_HIT_RATE,
  TIER_MULTIPLIERS,
  DEFAULT_REPLICATION_LAG_MS,
  DEFAULT_READ_KEY_CARDINALITY,
  QUERY_COSTS,
  DEFAULT_READ_QUERY_COST_MS,
  DEFAULT_WRITE_QUERY_COST_MS,
  REDIS_TIER_MEMORY_BYTES,
  CDN_TIER_MEMORY_BYTES,
  derivedHitRate
} from './specs';
import {
  computeEffects,
  IncidentEffects,
  RETRY_STORM_THRESHOLD,
  RETRY_FACTOR
} from './incidents';

export const SATURATION_THRESHOLD = 0.95;
export const FAILURE_ERROR_THRESHOLD = 0.5;
export const P50_MULTIPLIER = 1.0;
export const P95_MULTIPLIER = 1.5;
export const P99_MULTIPLIER = 2.5;
export const CROSS_REGION_LATENCY_MS = 80;
const UTIL_CAP = 0.999;

interface FlowResult {
  nodeLoad: Record<string, number>;
  nodeReadLoad: Record<string, number>;
  edgeRps: Record<string, number>;
  queueArrivals: Record<string, number>;
  queueDepths: Record<string, number>;
  queueDropped: Record<string, number>;
}

function workerCapTotal(
  ids: string[],
  nodeById: Record<string, SimNode>
): number {
  let total = 0;
  for (const id of ids) {
    const node = nodeById[id];
    if (!node || node.type !== 'worker') continue;
    const instances = Math.max(1, node.instanceCount ?? 1);
    const tierMult = TIER_MULTIPLIERS[node.tier ?? 'S'];
    total += (NODE_SPECS.worker.capacity ?? 0) * tierMult.cap * instances;
  }
  return total;
}

function resolveFlow(
  graph: SimGraph,
  readRps: number,
  writeRps: number,
  effects: IncidentEffects,
  prevDepths: Record<string, number>,
  dtMs: number,
  redisHitRateByNodeId: Record<string, number>,
  cdnHitRateByNodeId: Record<string, number>,
  replicaSafeReadFraction: number,
  asyncWriteFraction: number
): FlowResult {
  const adjacency: Record<string, string[]> = {};
  for (const e of graph.edges) {
    (adjacency[e.source] ??= []).push(e.target);
  }
  const typeOf: Record<string, NodeType> = {};
  const nodeById: Record<string, SimNode> = {};
  for (const n of graph.nodes) {
    typeOf[n.id] = n.type;
    nodeById[n.id] = n;
  }

  const nodeLoad: Record<string, number> = {};
  const nodeReadLoad: Record<string, number> = {};
  const edgeRps: Record<string, number> = {};
  const queueArrivals: Record<string, number> = {};
  const queueDepths: Record<string, number> = {};
  const queueDropped: Record<string, number> = {};

  for (const node of graph.nodes) {
    if (node.type === 'queue') {
      queueDepths[node.id] = prevDepths[node.id] ?? 0;
      queueArrivals[node.id] = 0;
      queueDropped[node.id] = 0;
    }
  }

  const clientIds = graph.nodes
    .filter((n) => n.type === 'client')
    .map((n) => n.id);

  const queue: Array<{ id: string; readRps: number; writeRps: number }> =
    clientIds.map((id) => ({ id, readRps, writeRps }));

  while (queue.length > 0) {
    const { id, readRps: r, writeRps: w } = queue.shift()!;
    nodeLoad[id] = (nodeLoad[id] ?? 0) + r + w;
    nodeReadLoad[id] = (nodeReadLoad[id] ?? 0) + r;
    const downstream = adjacency[id] ?? [];
    if (downstream.length === 0) continue;
    let forwardReads = r;
    let forwardWrites = w;

    if (typeOf[id] === 'redis') {
      const baseHit = redisHitRateByNodeId[id] ?? LEGACY_DEFAULT_HIT_RATE;
      const hitRate = effects.hitRateOverrideByType.redis ?? baseHit;
      forwardReads = r * (1 - hitRate);
    }

    if (typeOf[id] === 'cdn') {
      const node = nodeById[id];
      // Manual hitRate override (slider) wins over the derived per-endpoint rate.
      const derived = cdnHitRateByNodeId[id] ?? 0;
      const baseHit = node?.hitRate ?? derived;
      const hitRate = effects.hitRateOverrideByType.cdn ?? baseHit;
      forwardReads = r * (1 - hitRate);
    }

    if (typeOf[id] === 'queue') {
      const arrivalRps = r + w;
      queueArrivals[id] = (queueArrivals[id] ?? 0) + arrivalRps;
      const workerTargets = downstream.filter((t) => typeOf[t] === 'worker');
      const drainCap = workerCapTotal(workerTargets, nodeById);
      const prevDepth = prevDepths[id] ?? 0;
      const cap = NODE_SPECS.queue.capacity ?? Infinity;
      const dtSec = dtMs / 1000;

      let newDepth = prevDepth;
      let drainRps = 0;
      let droppedFraction = 0;

      if (dtSec <= 0) {
        drainRps =
          prevDepth > 0 ? drainCap : Math.min(drainCap, arrivalRps);
      } else {
        const desiredDrainCount = drainCap * dtSec;
        const available = prevDepth + arrivalRps * dtSec;
        const actualDrainCount = Math.min(desiredDrainCount, available);
        drainRps = actualDrainCount / dtSec;
        let attemptedDepth = available - actualDrainCount;
        if (attemptedDepth > cap) {
          const overflow = attemptedDepth - cap;
          attemptedDepth = cap;
          if (arrivalRps > 0) {
            droppedFraction = Math.min(1, overflow / dtSec / arrivalRps);
          }
        }
        newDepth = Math.max(0, attemptedDepth);
      }

      queueDepths[id] = newDepth;
      queueDropped[id] = droppedFraction;

      const passFraction = arrivalRps > 0 ? drainRps / arrivalRps : 0;
      forwardReads = r * passFraction;
      forwardWrites = w * passFraction;
    }

    if (forwardReads === 0 && forwardWrites === 0) continue;

    const replicaTargets = downstream.filter(
      (t) => typeOf[t] === 'postgresReplica'
    );
    const writableTargets = downstream.filter(
      (t) => typeOf[t] !== 'postgresReplica'
    );
    const replicaCapable = replicaTargets.length > 0;
    const readTargets = replicaCapable ? replicaTargets : downstream;
    const writeTargets =
      writableTargets.length > 0 ? writableTargets : downstream;

    // replicaSafeReadFraction splits reads between replica-eligible and
    // primary-only buckets. With no replicas downstream the split collapses
    // (everything goes to downstream as before).
    const replicaSafeReads = replicaCapable
      ? forwardReads * replicaSafeReadFraction
      : forwardReads;
    const replicaUnsafeReads = replicaCapable
      ? forwardReads - replicaSafeReads
      : 0;

    // asyncWriteFraction splits writes between queue-routed and direct buckets.
    // Queue targets are the only true async path; non-queue writable targets
    // (postgres, etc.) take sync writes. If only one path exists, the other
    // bucket falls back to it (topology errors are surfaced separately).
    const queueTargets = writeTargets.filter((t) => typeOf[t] === 'queue');
    const directTargets = writeTargets.filter((t) => typeOf[t] !== 'queue');
    let asyncWrites = forwardWrites * asyncWriteFraction;
    let syncWrites = forwardWrites - asyncWrites;
    if (queueTargets.length === 0 && asyncWrites > 0) {
      syncWrites += asyncWrites;
      asyncWrites = 0;
    }
    if (directTargets.length === 0 && syncWrites > 0) {
      asyncWrites += syncWrites;
      syncWrites = 0;
    }

    const perReplicaSafeRead =
      readTargets.length > 0 ? replicaSafeReads / readTargets.length : 0;
    const perReplicaUnsafeRead =
      writeTargets.length > 0 ? replicaUnsafeReads / writeTargets.length : 0;
    const perAsyncWrite =
      queueTargets.length > 0 ? asyncWrites / queueTargets.length : 0;
    const perSyncWrite =
      directTargets.length > 0 ? syncWrites / directTargets.length : 0;

    for (const next of downstream) {
      const isReplica = typeOf[next] === 'postgresReplica';
      const isQueue = typeOf[next] === 'queue';
      const sendRead =
        (readTargets.includes(next) ? perReplicaSafeRead : 0) +
        (!isReplica && writeTargets.includes(next) ? perReplicaUnsafeRead : 0);
      let sendWrite = 0;
      if (!isReplica && writeTargets.includes(next)) {
        sendWrite = isQueue ? perAsyncWrite : perSyncWrite;
      }
      if (sendRead === 0 && sendWrite === 0) continue;
      const key = edgeKey(id, next);
      edgeRps[key] = (edgeRps[key] ?? 0) + sendRead + sendWrite;
      queue.push({ id: next, readRps: sendRead, writeRps: sendWrite });
    }
  }

  return {
    nodeLoad,
    nodeReadLoad,
    edgeRps,
    queueArrivals,
    queueDepths,
    queueDropped
  };
}

export function mm1Latency(baseMs: number, utilization: number): number {
  if (baseMs === 0) return 0;
  const u = Math.min(Math.max(utilization, 0), UTIL_CAP);
  return baseMs / (1 - u);
}

export function nodeErrorRate(utilization: number): number {
  if (utilization <= 1) return 0;
  const overflow = utilization - 1;
  return Math.min(overflow / utilization, 1);
}

interface PerNodeResult {
  perNodeUtilization: Record<string, number>;
  perNodeLatency: Record<string, number>;
  perNodeError: Record<string, number>;
  perNodeIncomingRps: Record<string, number>;
  flow: FlowResult;
  apiErrorRateMax: number;
  cacheStaleReadPct: number;
}

interface QueryCostMix {
  read: number;
  write: number;
}

// If byColumn is declared and not indexed, an Indexed query falls back to its
// Scan equivalent. This is what makes "add/remove an index" a meaningful lever.
function effectiveQueryType(
  declared: import('./types').QueryType,
  table: Table | undefined,
  byColumn: string | undefined
): import('./types').QueryType {
  if (!byColumn || !table) return declared;
  const col = table.columns.find((c) => c.name === byColumn);
  if (!col || col.indexed) return declared;
  if (declared === 'pointIndexed') return 'pointScan';
  if (declared === 'rangeIndexed') return 'rangeScan';
  return declared;
}

function avgQueryCostMix(state: SimState): QueryCostMix {
  const endpoints = state.endpoints ?? [];
  if (endpoints.length === 0) {
    return { read: DEFAULT_READ_QUERY_COST_MS, write: DEFAULT_WRITE_QUERY_COST_MS };
  }
  const tables: Record<string, Table | undefined> = {};
  for (const t of state.tables ?? []) tables[t.name] = t;

  let rW = 0;
  let rC = 0;
  let wW = 0;
  let wC = 0;
  for (const e of endpoints) {
    const table = tables[e.table];
    const type = effectiveQueryType(e.query.type, table, e.query.byColumn);
    const cost = QUERY_COSTS[type](table, e.responseSize);
    if (type === 'write') {
      wW += e.weight;
      wC += e.weight * cost;
    } else {
      rW += e.weight;
      rC += e.weight * cost;
    }
  }
  return {
    read: rW > 0 ? rC / rW : DEFAULT_READ_QUERY_COST_MS,
    write: wW > 0 ? wC / wW : DEFAULT_WRITE_QUERY_COST_MS
  };
}

// Fraction of read RPS attributable to endpoints marked replicaSafe (default true).
// 1.0 when no endpoints are declared, preserving legacy "all reads can go to replica".
function replicaSafeReadFraction(state: SimState): number {
  const endpoints = state.endpoints ?? [];
  if (endpoints.length === 0) return 1;
  let totalReadWeight = 0;
  let safeReadWeight = 0;
  for (const e of endpoints) {
    if (e.query.type === 'write') continue;
    totalReadWeight += e.weight;
    if (e.replicaSafe !== false) safeReadWeight += e.weight;
  }
  return totalReadWeight > 0 ? safeReadWeight / totalReadWeight : 1;
}

// Fraction of write RPS attributable to endpoints marked async (default false).
// 0 when no endpoints are declared, preserving legacy "writes go direct".
function asyncWriteFraction(state: SimState): number {
  const endpoints = state.endpoints ?? [];
  if (endpoints.length === 0) return 0;
  let totalWriteWeight = 0;
  let asyncWriteWeight = 0;
  for (const e of endpoints) {
    if (e.query.type !== 'write') continue;
    totalWriteWeight += e.weight;
    if (e.async === true) asyncWriteWeight += e.weight;
  }
  return totalWriteWeight > 0 ? asyncWriteWeight / totalWriteWeight : 0;
}

function hasQueueWorkerPath(graph: SimGraph): boolean {
  const typeOf: Record<string, NodeType> = {};
  for (const n of graph.nodes) typeOf[n.id] = n.type;
  for (const e of graph.edges) {
    if (typeOf[e.source] !== 'queue' || typeOf[e.target] !== 'worker') continue;
    const hasUpstream = graph.edges.some((up) => up.target === e.source);
    if (hasUpstream) return true;
  }
  return false;
}

function computeTopologyErrors(state: SimState): string[] {
  const errors: string[] = [];
  const endpoints = state.endpoints ?? [];
  const asyncEndpoints = endpoints.filter(
    (e) => e.async === true && e.query.type === 'write'
  );
  if (asyncEndpoints.length > 0 && !hasQueueWorkerPath(state.graph)) {
    const labels = asyncEndpoints.map((e) => `${e.method} ${e.route}`).join(', ');
    errors.push(
      `Async endpoint(s) ${labels} require a queue + worker path. Add a queue between API and the worker that writes to the DB.`
    );
  }
  return errors;
}

const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_CACHE_MODE: 'invalidate' | 'ttl' = 'invalidate';

interface CacheImpact {
  hitRateByRedisNodeId: Record<string, number>;
  cacheStaleReadPct: number;
}

function computeCacheImpact(
  state: SimState,
  totalReadRps: number,
  totalWriteRps: number
): CacheImpact {
  const endpoints = state.endpoints ?? [];
  const hitRateByRedisNodeId: Record<string, number> = {};
  if (endpoints.length === 0) return { hitRateByRedisNodeId, cacheStaleReadPct: 0 };

  const tables: Record<string, Table | undefined> = {};
  for (const t of state.tables ?? []) tables[t.name] = t;

  // Per-endpoint write RPS, computed from weights among write-typed endpoints.
  const writeEndpointTotalWeight = endpoints
    .filter((e) => e.query.type === 'write')
    .reduce((s, e) => s + e.weight, 0);
  const writeRpsPerTable: Record<string, number> = {};
  for (const e of endpoints) {
    if (e.query.type !== 'write' || writeEndpointTotalWeight === 0) continue;
    const rps = totalWriteRps * (e.weight / writeEndpointTotalWeight);
    writeRpsPerTable[e.table] = (writeRpsPerTable[e.table] ?? 0) + rps;
  }

  // Per-endpoint read RPS, computed from weights among read-typed endpoints.
  const readEndpointTotalWeight = endpoints
    .filter((e) => e.query.type !== 'write')
    .reduce((s, e) => s + e.weight, 0);

  let totalStaleReads = 0;
  let totalReads = 0;

  for (const node of state.graph.nodes) {
    if (node.type !== 'redis') continue;
    const tier = node.tier ?? 'S';
    const instances = Math.max(1, node.instanceCount ?? 1);
    const cacheBytes = REDIS_TIER_MEMORY_BYTES[tier] * instances;

    let totalReadWeight = 0;
    let weightedEffectiveHit = 0;

    for (const e of endpoints) {
      if (e.query.type === 'write') continue;
      const table = tables[e.table];
      const workingSet = table ? table.rowCount * table.avgRowSize : 0;
      const baseHit = derivedHitRate(workingSet, cacheBytes, e.skew);

      const mode = e.cache?.mode ?? DEFAULT_CACHE_MODE;
      const ttlSec = e.cache?.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS;
      const cardinality = e.cache?.cardinality ?? table?.rowCount ?? 1;
      const writeRpsForTable = writeRpsPerTable[e.table] ?? 0;

      let effectiveHit = baseHit;

      if (mode === 'invalidate' && writeRpsForTable > 0) {
        // Each write invalidates ~1 key per RPS. Within the warming window,
        // the fraction of the cache invalidated per second ≈ writeRps / N.
        const invalidationRate = Math.min(1, writeRpsForTable / cardinality);
        effectiveHit = baseHit * (1 - invalidationRate);
      }

      // Per-endpoint read RPS attributed to this cache.
      const epRps =
        readEndpointTotalWeight > 0
          ? totalReadRps * (e.weight / readEndpointTotalWeight)
          : 0;

      if (mode === 'ttl' && writeRpsForTable > 0) {
        // Hits return stale data; staleness is bounded by TTL.
        const staleFraction = Math.min(
          1,
          (writeRpsForTable * ttlSec) / cardinality
        );
        totalStaleReads += epRps * baseHit * staleFraction;
      }

      totalReads += epRps;
      totalReadWeight += e.weight;
      weightedEffectiveHit += e.weight * effectiveHit;
    }

    hitRateByRedisNodeId[node.id] =
      totalReadWeight > 0
        ? weightedEffectiveHit / totalReadWeight
        : LEGACY_DEFAULT_HIT_RATE;
  }

  // If no Redis node sits in the graph, still report staleness against read traffic
  // attributable to TTL-mode endpoints (the read may not actually be cached, but the
  // metric is "what fraction of cache hits would be stale"; 0 reads ⇒ 0).
  const cacheStaleReadPct =
    totalReads > 0 ? (totalStaleReads / totalReads) * 100 : 0;

  return { hitRateByRedisNodeId, cacheStaleReadPct };
}

// Derived hit rate per CDN node: weighted across edgeCacheable read endpoints
// using the same skew/working-set/cache-bytes formula as Redis (issue 03).
// Non-cacheable reads contribute 0 hit, dragging the effective node-level rate down.
function computeCdnHitRates(state: SimState): Record<string, number> {
  const endpoints = state.endpoints ?? [];
  const tables: Record<string, Table | undefined> = {};
  for (const t of state.tables ?? []) tables[t.name] = t;
  const out: Record<string, number> = {};
  if (endpoints.length === 0) return out;

  for (const node of state.graph.nodes) {
    if (node.type !== 'cdn') continue;
    const tier = node.tier ?? 'S';
    const instances = Math.max(1, node.instanceCount ?? 1);
    const cacheBytes = CDN_TIER_MEMORY_BYTES[tier] * instances;

    let totalReadWeight = 0;
    let weightedHit = 0;
    for (const e of endpoints) {
      if (e.query.type === 'write') continue;
      totalReadWeight += e.weight;
      const cacheable = e.edgeCacheable !== false;
      if (!cacheable) continue;
      const table = tables[e.table];
      const workingSet = table ? table.rowCount * table.avgRowSize : 0;
      weightedHit += e.weight * derivedHitRate(workingSet, cacheBytes, e.skew);
    }
    out[node.id] = totalReadWeight > 0 ? weightedHit / totalReadWeight : 0;
  }
  return out;
}

function computePerNode(
  state: SimState,
  effects: IncidentEffects,
  prevDepths: Record<string, number>,
  dtMs: number
): PerNodeResult {
  const readPct = state.readPct ?? 100;
  const readFraction = Math.max(0, Math.min(1, readPct / 100));
  const effectiveRps = state.rps * effects.rpsMultiplier;
  const readRps = effectiveRps * readFraction;
  const writeRps = effectiveRps - readRps;
  const costMix = avgQueryCostMix(state);
  const cacheImpact = computeCacheImpact(state, readRps, writeRps);
  const cdnHitRateByNodeId = computeCdnHitRates(state);
  const flow = resolveFlow(
    state.graph,
    readRps,
    writeRps,
    effects,
    prevDepths,
    dtMs,
    cacheImpact.hitRateByRedisNodeId,
    cdnHitRateByNodeId,
    replicaSafeReadFraction(state),
    asyncWriteFraction(state)
  );
  const perNodeUtilization: Record<string, number> = {};
  const perNodeLatency: Record<string, number> = {};
  const perNodeError: Record<string, number> = {};
  const perNodeIncomingRps: Record<string, number> = {};
  let apiErrorRateMax = 0;

  for (const node of state.graph.nodes) {
    const spec = NODE_SPECS[node.type as NodeType];
    const incoming = flow.nodeLoad[node.id] ?? 0;
    perNodeIncomingRps[node.id] = incoming;
    const instances = Math.max(1, node.instanceCount ?? 1);
    const tierMult = TIER_MULTIPLIERS[node.tier ?? 'S'];
    const failFraction = Math.max(
      0,
      Math.min(1, effects.instanceFailureFractionByType[node.type] ?? 0)
    );
    const workingFraction = 1 - failFraction;

    let util: number;
    if (node.type === 'postgres' || node.type === 'postgresReplica') {
      const wmps = spec.workMsPerSec ?? 0;
      const readLoad = flow.nodeReadLoad[node.id] ?? 0;
      const writeLoad = Math.max(0, incoming - readLoad);
      const workMs = readLoad * costMix.read + writeLoad * costMix.write;
      const workingCap = wmps * tierMult.cap * instances * workingFraction;
      util = workingCap > 0 ? workMs / workingCap : 1;
    } else if (spec.capacity === Infinity) {
      util = 0;
    } else if (node.type === 'queue') {
      util = (flow.queueDepths[node.id] ?? 0) / (spec.capacity ?? 1);
    } else {
      const workingCap =
        (spec.capacity ?? 0) * tierMult.cap * instances * workingFraction;
      util = workingCap > 0 ? incoming / workingCap : 1;
    }
    perNodeUtilization[node.id] = util;

    const latencyMult = effects.latencyMultiplierByType[node.type] ?? 1;
    const baseL = spec.baseLatencyMs * latencyMult;
    perNodeLatency[node.id] =
      node.type === 'queue' || node.type === 'worker'
        ? baseL
        : mm1Latency(baseL, util);

    let baseError: number;
    if (node.type === 'queue') {
      baseError = flow.queueDropped[node.id] ?? 0;
    } else {
      const utilError = nodeErrorRate(util);
      baseError = failFraction + workingFraction * utilError;
    }
    const overrideError = effects.errorOverrideByType[node.type];
    let combined =
      overrideError !== undefined ? Math.max(baseError, overrideError) : baseError;
    if (node.regionId) {
      const regionOverride = effects.errorOverrideByRegion[node.regionId];
      if (regionOverride !== undefined) {
        combined = Math.max(combined, regionOverride);
      }
    }
    perNodeError[node.id] = Math.max(0, Math.min(1, combined));

    if (node.type === 'api' && perNodeError[node.id] > apiErrorRateMax) {
      apiErrorRateMax = perNodeError[node.id];
    }
  }

  return {
    perNodeUtilization,
    perNodeLatency,
    perNodeError,
    perNodeIncomingRps,
    flow,
    apiErrorRateMax,
    cacheStaleReadPct: cacheImpact.cacheStaleReadPct
  };
}

export function tick(
  state: SimState,
  timestamp: number,
  prevDepths: Record<string, number> = {},
  dtMs: number = 0
): Snapshot {
  const effects = computeEffects(state.incidents ?? [], timestamp);

  let result = computePerNode(state, effects, prevDepths, dtMs);

  if (
    effects.retryStormActive &&
    result.apiErrorRateMax > RETRY_STORM_THRESHOLD
  ) {
    effects.rpsMultiplier *= 1 + RETRY_FACTOR * result.apiErrorRateMax;
    result = computePerNode(state, effects, prevDepths, dtMs);
  }

  const effectiveRps = state.rps * effects.rpsMultiplier;
  const readPct = state.readPct ?? 100;
  const readFraction = Math.max(0, Math.min(1, readPct / 100));
  const readRps = effectiveRps * readFraction;
  const writeRps = effectiveRps - readRps;
  const {
    perNodeUtilization,
    perNodeLatency,
    perNodeError,
    perNodeIncomingRps,
    flow
  } = result;

  let meanSum = 0;
  let okFactor = 1;
  for (const node of state.graph.nodes) {
    meanSum += perNodeLatency[node.id];
    okFactor *= 1 - perNodeError[node.id];
  }
  const regionById: Record<string, string | undefined> = {};
  for (const n of state.graph.nodes) regionById[n.id] = n.regionId;
  for (const e of state.graph.edges) {
    const sr = regionById[e.source];
    const tr = regionById[e.target];
    if (sr && tr && sr !== tr) meanSum += CROSS_REGION_LATENCY_MS;
  }
  const p50Ms = meanSum * P50_MULTIPLIER;
  const p95Ms = meanSum * P95_MULTIPLIER;
  const p99Ms = meanSum * P99_MULTIPLIER;
  const errorPct = (1 - okFactor) * 100;

  const saturated: string[] = [];
  for (const node of state.graph.nodes) {
    if (
      perNodeUtilization[node.id] >= SATURATION_THRESHOLD ||
      perNodeError[node.id] >= FAILURE_ERROR_THRESHOLD
    ) {
      saturated.push(node.id);
    }
  }

  let costUsd = 0;
  for (const node of state.graph.nodes) {
    const instances = Math.max(1, node.instanceCount ?? 1);
    const tierMult = TIER_MULTIPLIERS[node.tier ?? 'S'];
    costUsd +=
      NODE_SPECS[node.type as NodeType].costPerMonthUsd *
      tierMult.cost *
      instances;
  }

  const perNodeErrorPct: Record<string, number> = {};
  for (const id in perNodeError) perNodeErrorPct[id] = perNodeError[id] * 100;

  let totalReplicaReads = 0;
  let staleReads = 0;
  for (const node of state.graph.nodes) {
    if (node.type !== 'postgresReplica') continue;
    const reads = flow.nodeReadLoad[node.id] ?? 0;
    if (reads === 0) continue;
    const lagMs = node.lagMs ?? DEFAULT_REPLICATION_LAG_MS;
    const cardinality = Math.max(
      1,
      node.readKeyCardinality ?? DEFAULT_READ_KEY_CARDINALITY
    );
    const stalePerRead = Math.min(
      1,
      (writeRps * (lagMs / 1000)) / cardinality
    );
    totalReplicaReads += reads;
    staleReads += reads * stalePerRead;
  }
  const staleReadPct = readRps > 0 ? (staleReads / readRps) * 100 : 0;

  let queueDepthMax = 0;
  for (const id in flow.queueDepths) {
    if (flow.queueDepths[id] > queueDepthMax) queueDepthMax = flow.queueDepths[id];
  }

  let backendRps = 0;
  for (const node of state.graph.nodes) {
    if (
      node.type === 'postgres' ||
      node.type === 'postgresReplica' ||
      node.type === 'worker'
    ) {
      backendRps += perNodeIncomingRps[node.id] ?? 0;
    }
  }

  return {
    perNodeUtilization,
    perNodeLatencyMs: perNodeLatency,
    perNodeErrorPct,
    perNodeIncomingRps,
    perEdgeRps: flow.edgeRps,
    saturatedNodeIds: saturated,
    rps: effectiveRps,
    effectiveRps: backendRps,
    p50Ms,
    p95Ms,
    p99Ms,
    errorPct,
    costUsd,
    staleReadPct,
    cacheStaleReadPct: result.cacheStaleReadPct,
    queueDepthByNodeId: flow.queueDepths,
    queueArrivalRpsByNodeId: flow.queueArrivals,
    queueDepthMax,
    topologyErrors: computeTopologyErrors(state),
    timestamp
  };
}
