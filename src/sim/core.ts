import { SimState, Snapshot, SimGraph, SimNode, NodeType, edgeKey } from './types';
import {
  NODE_SPECS,
  REDIS_HIT_RATE,
  TIER_MULTIPLIERS,
  DEFAULT_REPLICATION_LAG_MS,
  DEFAULT_READ_KEY_CARDINALITY,
  CDN_DEFAULT_HIT_RATE
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
    total += NODE_SPECS.worker.capacity * tierMult.cap * instances;
  }
  return total;
}

function resolveFlow(
  graph: SimGraph,
  readRps: number,
  writeRps: number,
  effects: IncidentEffects,
  prevDepths: Record<string, number>,
  dtMs: number
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
      const hitRate = effects.hitRateOverrideByType.redis ?? REDIS_HIT_RATE;
      forwardReads = r * (1 - hitRate);
    }

    if (typeOf[id] === 'cdn') {
      const node = nodeById[id];
      const baseHit = node?.hitRate ?? CDN_DEFAULT_HIT_RATE;
      const hitRate = effects.hitRateOverrideByType.cdn ?? baseHit;
      forwardReads = r * (1 - hitRate);
    }

    if (typeOf[id] === 'queue') {
      const arrivalRps = r + w;
      queueArrivals[id] = (queueArrivals[id] ?? 0) + arrivalRps;
      const workerTargets = downstream.filter((t) => typeOf[t] === 'worker');
      const drainCap = workerCapTotal(workerTargets, nodeById);
      const prevDepth = prevDepths[id] ?? 0;
      const cap = NODE_SPECS.queue.capacity;
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
    const readTargets = replicaTargets.length > 0 ? replicaTargets : downstream;
    const writeTargets =
      writableTargets.length > 0 ? writableTargets : downstream;

    const perRead = readTargets.length > 0 ? forwardReads / readTargets.length : 0;
    const perWrite =
      writeTargets.length > 0 ? forwardWrites / writeTargets.length : 0;

    for (const next of downstream) {
      const isReplica = typeOf[next] === 'postgresReplica';
      const sendRead = readTargets.includes(next) ? perRead : 0;
      const sendWrite = !isReplica && writeTargets.includes(next) ? perWrite : 0;
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
  const flow = resolveFlow(
    state.graph,
    readRps,
    writeRps,
    effects,
    prevDepths,
    dtMs
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
    if (spec.capacity === Infinity) {
      util = 0;
    } else if (node.type === 'queue') {
      util = (flow.queueDepths[node.id] ?? 0) / spec.capacity;
    } else {
      const workingCap =
        spec.capacity * tierMult.cap * instances * workingFraction;
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
    apiErrorRateMax
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
    queueDepthByNodeId: flow.queueDepths,
    queueArrivalRpsByNodeId: flow.queueArrivals,
    queueDepthMax,
    timestamp
  };
}
