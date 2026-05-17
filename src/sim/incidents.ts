import { NodeType } from './types';

export type IncidentKind =
  | 'kill-postgres'
  | 'ddos'
  | 'slow-query'
  | 'cache-poison'
  | 'cdn-purge'
  | 'retry-storm'
  | 'bad-deploy'
  | 'cache-stampede'
  | 'regional-outage';

export interface Incident {
  kind: IncidentKind;
  startedAt: number;
  regionId?: string;
}

export interface IncidentEffects {
  errorOverrideByType: Partial<Record<NodeType, number>>;
  latencyMultiplierByType: Partial<Record<NodeType, number>>;
  hitRateOverrideByType: Partial<Record<NodeType, number>>;
  instanceFailureFractionByType: Partial<Record<NodeType, number>>;
  errorOverrideByRegion: Record<string, number>;
  rpsMultiplier: number;
  retryStormActive: boolean;
}

export const KILL_IMPACT_MS = 15_000;
export const KILL_RECOVERY_MS = 3_000;

export const DDOS_DURATION_MS = 10_000;
export const DDOS_MULTIPLIER = 10;

export const SLOW_QUERY_DURATION_MS = 20_000;
export const SLOW_QUERY_MULTIPLIER = 10;

export const CACHE_POISON_DURATION_MS = 15_000;

export const CDN_PURGE_DURATION_MS = 30_000;

export const RETRY_STORM_DURATION_MS = 30_000;
export const RETRY_STORM_THRESHOLD = 0.3;
export const RETRY_FACTOR = 3;

export const BAD_DEPLOY_DURATION_MS = 60_000;
export const BAD_DEPLOY_FAILURE_FRACTION = 0.5;

export const CACHE_STAMPEDE_DURATION_MS = 15_000;
export const CACHE_STAMPEDE_SPIKE_MS = 5_000;
export const CACHE_STAMPEDE_SPIKE_MULTIPLIER = 2;

export const REGIONAL_OUTAGE_DURATION_MS = 30_000;

export function emptyEffects(): IncidentEffects {
  return {
    errorOverrideByType: {},
    latencyMultiplierByType: {},
    hitRateOverrideByType: {},
    instanceFailureFractionByType: {},
    errorOverrideByRegion: {},
    rpsMultiplier: 1,
    retryStormActive: false
  };
}

export function totalDurationMs(kind: IncidentKind): number {
  switch (kind) {
    case 'kill-postgres':
      return KILL_IMPACT_MS + KILL_RECOVERY_MS;
    case 'ddos':
      return DDOS_DURATION_MS;
    case 'slow-query':
      return SLOW_QUERY_DURATION_MS;
    case 'cache-poison':
      return CACHE_POISON_DURATION_MS;
    case 'cdn-purge':
      return CDN_PURGE_DURATION_MS;
    case 'retry-storm':
      return RETRY_STORM_DURATION_MS;
    case 'bad-deploy':
      return BAD_DEPLOY_DURATION_MS;
    case 'cache-stampede':
      return CACHE_STAMPEDE_DURATION_MS;
    case 'regional-outage':
      return REGIONAL_OUTAGE_DURATION_MS;
  }
}

export function isActive(incident: Incident, now: number): boolean {
  const elapsed = now - incident.startedAt;
  return elapsed >= 0 && elapsed < totalDurationMs(incident.kind);
}

function applyKillPostgres(
  incident: Incident,
  now: number,
  effects: IncidentEffects
) {
  const elapsed = now - incident.startedAt;
  let errorRate = 0;
  if (elapsed < KILL_IMPACT_MS) {
    errorRate = 1;
  } else if (elapsed < KILL_IMPACT_MS + KILL_RECOVERY_MS) {
    const recoveryElapsed = elapsed - KILL_IMPACT_MS;
    errorRate = 1 - recoveryElapsed / KILL_RECOVERY_MS;
  }
  const prev = effects.errorOverrideByType.postgres ?? 0;
  effects.errorOverrideByType.postgres = Math.max(prev, errorRate);
}

function applyDdos(_incident: Incident, _now: number, effects: IncidentEffects) {
  effects.rpsMultiplier *= DDOS_MULTIPLIER;
}

function applySlowQuery(
  _incident: Incident,
  _now: number,
  effects: IncidentEffects
) {
  const prev = effects.latencyMultiplierByType.postgres ?? 1;
  effects.latencyMultiplierByType.postgres = prev * SLOW_QUERY_MULTIPLIER;
}

function applyCachePoison(
  _incident: Incident,
  _now: number,
  effects: IncidentEffects
) {
  effects.hitRateOverrideByType.redis = 0;
}

function applyCdnPurge(
  _incident: Incident,
  _now: number,
  effects: IncidentEffects
) {
  effects.hitRateOverrideByType.cdn = 0;
}

function applyRetryStorm(
  _incident: Incident,
  _now: number,
  effects: IncidentEffects
) {
  effects.retryStormActive = true;
}

function applyBadDeploy(
  _incident: Incident,
  _now: number,
  effects: IncidentEffects
) {
  const prev = effects.instanceFailureFractionByType.api ?? 0;
  effects.instanceFailureFractionByType.api = Math.max(
    prev,
    BAD_DEPLOY_FAILURE_FRACTION
  );
}

function applyCacheStampede(
  incident: Incident,
  now: number,
  effects: IncidentEffects
) {
  effects.hitRateOverrideByType.redis = 0;
  const elapsed = now - incident.startedAt;
  if (elapsed >= 0 && elapsed < CACHE_STAMPEDE_SPIKE_MS) {
    effects.rpsMultiplier *= CACHE_STAMPEDE_SPIKE_MULTIPLIER;
  }
}

function applyRegionalOutage(
  incident: Incident,
  _now: number,
  effects: IncidentEffects
) {
  if (!incident.regionId) return;
  const prev = effects.errorOverrideByRegion[incident.regionId] ?? 0;
  effects.errorOverrideByRegion[incident.regionId] = Math.max(prev, 1);
}

export function computeEffects(
  incidents: Incident[],
  now: number
): IncidentEffects {
  const effects = emptyEffects();
  for (const inc of incidents) {
    if (!isActive(inc, now)) continue;
    switch (inc.kind) {
      case 'kill-postgres':
        applyKillPostgres(inc, now, effects);
        break;
      case 'ddos':
        applyDdos(inc, now, effects);
        break;
      case 'slow-query':
        applySlowQuery(inc, now, effects);
        break;
      case 'cache-poison':
        applyCachePoison(inc, now, effects);
        break;
      case 'cdn-purge':
        applyCdnPurge(inc, now, effects);
        break;
      case 'retry-storm':
        applyRetryStorm(inc, now, effects);
        break;
      case 'bad-deploy':
        applyBadDeploy(inc, now, effects);
        break;
      case 'cache-stampede':
        applyCacheStampede(inc, now, effects);
        break;
      case 'regional-outage':
        applyRegionalOutage(inc, now, effects);
        break;
    }
  }
  return effects;
}
