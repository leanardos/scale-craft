// PROTOTYPE — custom mission setup. Shared types & builder.
// Throwaway. When a variant wins, fold this into the chosen design.

import { NodeType } from '../../sim/types';
import { IncidentKind } from '../../sim/incidents';
import { MissionSpec, ScheduledIncident } from '../../sim/mission';

export interface DraftMission {
  title: string;
  targetRps: number;
  readPct: number;
  p95MaxMs: number;
  errorMaxPct: number;
  costMaxUsd: number;
  rampSeconds: number;
  sustainSeconds: number;
  allowedComponents: NodeType[];
  requiredComponents: NodeType[];
  incident: { kind: IncidentKind; atSeconds: number; regionId?: string } | null;
}

export const ALL_COMPONENTS: NodeType[] = [
  'client',
  'api',
  'lb',
  'redis',
  'postgres',
  'postgresReplica',
  'cdn',
  'queue',
  'worker'
];

export const COMPONENT_LABELS: Record<NodeType, string> = {
  client: 'Client',
  api: 'API',
  lb: 'Load balancer',
  redis: 'Redis',
  postgres: 'Postgres',
  postgresReplica: 'PG replica',
  cdn: 'CDN',
  queue: 'Queue',
  worker: 'Worker'
};

export const INCIDENT_KINDS: IncidentKind[] = [
  'kill-postgres',
  'ddos',
  'slow-query',
  'cache-poison',
  'cdn-purge',
  'retry-storm',
  'bad-deploy',
  'cache-stampede',
  'regional-outage'
];

export const INCIDENT_LABELS: Record<IncidentKind, string> = {
  'kill-postgres': 'Kill Postgres',
  ddos: 'DDoS',
  'slow-query': 'Slow query',
  'cache-poison': 'Cache poison',
  'cdn-purge': 'CDN purge',
  'retry-storm': 'Retry storm',
  'bad-deploy': 'Bad deploy',
  'cache-stampede': 'Cache stampede',
  'regional-outage': 'Regional outage'
};

export function defaultDraft(): DraftMission {
  return {
    title: 'Custom mission',
    targetRps: 2000,
    readPct: 95,
    p95MaxMs: 200,
    errorMaxPct: 1,
    costMaxUsd: 800,
    rampSeconds: 20,
    sustainSeconds: 60,
    allowedComponents: [...ALL_COMPONENTS],
    requiredComponents: [],
    incident: null
  };
}

export function buildMission(draft: DraftMission): MissionSpec {
  const id = `custom-${Date.now()}`;
  const brief = makeBrief(draft);
  const incidentSchedule: ScheduledIncident[] | undefined = draft.incident
    ? [
        {
          atMs: draft.incident.atSeconds * 1000,
          kind: draft.incident.kind,
          regionId: draft.incident.regionId
        }
      ]
    : undefined;
  return {
    id,
    title: draft.title.trim() || 'Custom mission',
    brief,
    targetRps: draft.targetRps,
    readPct: draft.readPct,
    rampSeconds: draft.rampSeconds,
    sustainSeconds: draft.sustainSeconds,
    winConditions: {
      p95MaxMs: draft.p95MaxMs,
      errorMaxPct: draft.errorMaxPct,
      costMaxUsd: draft.costMaxUsd
    },
    requiredComponents:
      draft.requiredComponents.length > 0 ? draft.requiredComponents : undefined,
    allowedComponents: draft.allowedComponents,
    incidentSchedule
  };
}

function makeBrief(d: DraftMission): string {
  const parts: string[] = [];
  parts.push(`Sustain ${formatRps(d.targetRps)} RPS at ${d.readPct}% reads`);
  parts.push(`p95 < ${d.p95MaxMs}ms`);
  parts.push(`errors < ${d.errorMaxPct}%`);
  parts.push(`budget $${d.costMaxUsd}/mo`);
  let s = parts.join(', ') + '.';
  if (d.incident) {
    s += ` Incident: ${INCIDENT_LABELS[d.incident.kind]} at t=${d.incident.atSeconds}s.`;
  }
  return s;
}

function formatRps(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}
