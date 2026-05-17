import { useStore, useDisplaySnapshot } from '../store/useStore';
import { NODE_SPECS } from '../sim/specs';
import { NodeType } from '../sim/types';
import { Incident, IncidentKind, isActive } from '../sim/incidents';

const SATURATION_MESSAGES: Partial<Record<NodeType, string>> = {
  api: 'API server overloaded — requests queueing',
  redis: 'Redis overloaded — cache stalling',
  postgres: 'Postgres overloaded — queries timing out',
  postgresReplica: 'Postgres replica overloaded — read latency spiking',
  lb: 'Load balancer overloaded — connections dropping',
  queue: 'Queue full — dropping messages',
  worker: 'Worker pool overloaded — falling behind queue',
  cdn: 'CDN saturated — origin getting hammered'
};

function incidentMessage(inc: Incident): string {
  switch (inc.kind as IncidentKind) {
    case 'retry-storm':
      return 'Retry storm — clients amplifying load';
    case 'bad-deploy':
      return 'Bad deploy — half of API instances returning errors';
    case 'cache-stampede':
      return 'Cache stampede — hot key expired, origin getting slammed';
    case 'regional-outage':
      return inc.regionId
        ? `Region ${inc.regionId} down — all components in region failing`
        : 'Regional outage';
    default:
      return '';
  }
}

export function FailureToasts() {
  const snapshot = useDisplaySnapshot();
  const nodes = useStore((s) => s.nodes);
  const incidents = useStore((s) => s.incidents);
  const now = snapshot?.timestamp ?? Date.now();

  const saturated = snapshot
    ? snapshot.saturatedNodeIds
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is NonNullable<typeof n> => Boolean(n))
    : [];

  const activeNamed = incidents.filter(
    (i) =>
      isActive(i, now) &&
      (i.kind === 'retry-storm' ||
        i.kind === 'bad-deploy' ||
        i.kind === 'cache-stampede' ||
        i.kind === 'regional-outage')
  );

  if (saturated.length === 0 && activeNamed.length === 0) return null;

  return (
    <div className="sc-toasts">
      {activeNamed.map((inc) => (
        <div key={`inc-${inc.kind}-${inc.startedAt}`} className="sc-toast">
          <span className="sc-toast__dot" />
          <span className="sc-toast__msg">{incidentMessage(inc)}</span>
        </div>
      ))}
      {saturated.map((n) => {
        const spec = NODE_SPECS[n.data.type];
        const msg =
          SATURATION_MESSAGES[n.data.type] ?? `${spec.label} saturated`;
        return (
          <div key={n.id} className="sc-toast">
            <span className="sc-toast__dot" />
            <span className="sc-toast__msg">{msg}</span>
          </div>
        );
      })}
    </div>
  );
}
