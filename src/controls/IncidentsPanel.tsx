import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  IncidentKind,
  totalDurationMs,
  KILL_IMPACT_MS
} from '../sim/incidents';

interface IncidentDef {
  kind: IncidentKind;
  label: string;
}

const INCIDENTS: IncidentDef[] = [
  { kind: 'kill-postgres', label: 'Kill Postgres' },
  { kind: 'ddos', label: 'DDoS Spike' },
  { kind: 'slow-query', label: 'Slow Query' },
  { kind: 'cache-poison', label: 'Cache Poison' },
  { kind: 'cdn-purge', label: 'CDN Purge' },
  { kind: 'retry-storm', label: 'Retry Storm' },
  { kind: 'bad-deploy', label: 'Bad Deploy' },
  { kind: 'cache-stampede', label: 'Cache Stampede' },
  { kind: 'regional-outage', label: 'Regional Outage' }
];

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function IncidentsPanel() {
  const incidents = useStore((s) => s.incidents);
  const triggerIncident = useStore((s) => s.triggerIncident);
  const nodes = useStore((s) => s.nodes);
  const now = useNow(200);

  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.data.regionId) set.add(n.data.regionId);
    }
    return Array.from(set).sort();
  }, [nodes]);

  const activeByKind = new Map<IncidentKind, number>();
  for (const inc of incidents) {
    const elapsed = now - inc.startedAt;
    if (elapsed >= 0 && elapsed < totalDurationMs(inc.kind)) {
      activeByKind.set(inc.kind, elapsed);
    }
  }

  const onClick = (kind: IncidentKind) => {
    if (kind === 'regional-outage') {
      const choice =
        regions.length > 0
          ? window.prompt(
              `Region to take down (one of: ${regions.join(', ')}):`,
              regions[0]
            )
          : window.prompt('Region to take down:');
      if (!choice) return;
      triggerIncident(kind, { regionId: choice.trim() });
      return;
    }
    triggerIncident(kind);
  };

  return (
    <div className="sc-incidents">
      <div className="sc-incidents__label">Incidents</div>
      <div className="sc-incidents__buttons">
        {INCIDENTS.map(({ kind, label }) => {
          const elapsed = activeByKind.get(kind);
          const active = elapsed !== undefined;
          let remainingS = 0;
          if (active && kind === 'kill-postgres') {
            remainingS = Math.max(0, Math.ceil((KILL_IMPACT_MS - elapsed!) / 1000));
          } else if (active) {
            remainingS = Math.max(
              0,
              Math.ceil((totalDurationMs(kind) - elapsed!) / 1000)
            );
          }
          return (
            <button
              key={kind}
              type="button"
              className={`sc-btn sc-btn--incident${active ? ' is-active' : ''}`}
              onClick={() => onClick(kind)}
            >
              {label}
              {active && remainingS > 0 ? ` · ${remainingS}s` : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
