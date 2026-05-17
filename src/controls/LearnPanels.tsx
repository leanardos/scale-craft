import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { HINT_KEYS, HintKey } from '../store/hints';

interface LearnHint {
  key: HintKey;
  title: string;
  body: string;
}

const HINTS: Record<string, LearnHint> = {
  [HINT_KEYS.saturation95]: {
    key: HINT_KEYS.saturation95,
    title: 'Saturation: M/M/1 hockey stick',
    body:
      "A node just hit 95%+ utilization. Latency under an M/M/1 queue grows as 1/(1-ρ) — the closer ρ gets to 1, the steeper the curve. That's why p95 explodes at the edge instead of degrading smoothly. Add capacity (instances or tier) before you hit the wall."
  },
  [HINT_KEYS.errorsAboveZero]: {
    key: HINT_KEYS.errorsAboveZero,
    title: 'Errors above zero',
    body:
      "Once a component is fully saturated, it starts shedding load — errors climb above 0. Real systems do the same: timeouts, 503s, dropped connections. The fix is always more capacity, less work, or a queue to absorb the burst — not retries from the client."
  },
  [HINT_KEYS.cacheDecision]: {
    key: HINT_KEYS.cacheDecision,
    title: 'Adding a cache',
    body:
      "Redis sits in front of slower components and serves repeated reads at near-zero latency. The default hit rate (85%) means only 15% of read traffic falls through to the database. Caches don't help writes — those still have to hit the source of truth."
  },
  [HINT_KEYS.queueBackpressure]: {
    key: HINT_KEYS.queueBackpressure,
    title: 'Queue depth growing',
    body:
      "If arrival rate exceeds drain rate, queue depth grows without bound. That's backpressure. The fix is more workers (raise drain rate), faster workers (higher per-job throughput), or rejecting load earlier. Watch the queue-depth tile — once it hits the buffer cap, you start losing messages."
  },
  [HINT_KEYS.replicationLag]: {
    key: HINT_KEYS.replicationLag,
    title: 'Replication lag = stale reads',
    body:
      "A read replica serves a snapshot of the primary from `lagMs` ago. Reads of keys that were just written can return the old value — eventual consistency. Tune lag down to reduce stale reads; route reads-after-write to the primary if you can't tolerate any staleness."
  },
  [HINT_KEYS.regionalOutage]: {
    key: HINT_KEYS.regionalOutage,
    title: 'Regional outage',
    body:
      "Every component in the affected region is returning 100% errors. If you're single-region, the system is down. Multi-region only helps if traffic can fail over — replicas in another region must be able to serve reads, and writes must have a path that doesn't cross the dead region."
  }
};

export function LearnPanels() {
  const snapshot = useStore((s) => s.snapshot);
  const nodes = useStore((s) => s.nodes);
  const incidents = useStore((s) => s.incidents);
  const seenHints = useStore((s) => s.seenHints);
  const markHintSeen = useStore((s) => s.markHintSeen);
  const tutorialDone = !!seenHints[HINT_KEYS.tutorialCompleted];

  const [queue, setQueue] = useState<HintKey[]>([]);

  const enqueue = (key: HintKey) => {
    if (seenHints[key]) return;
    setQueue((q) => (q.includes(key) ? q : [...q, key]));
  };

  // saturation95 + errorsAboveZero — derived from snapshot
  useEffect(() => {
    if (!snapshot || !tutorialDone) return;
    if (!seenHints[HINT_KEYS.saturation95]) {
      let maxUtil = 0;
      for (const id in snapshot.perNodeUtilization) {
        const u = snapshot.perNodeUtilization[id];
        if (u > maxUtil) maxUtil = u;
      }
      if (maxUtil >= 0.95) enqueue(HINT_KEYS.saturation95);
    }
    if (!seenHints[HINT_KEYS.errorsAboveZero] && snapshot.errorPct > 0) {
      enqueue(HINT_KEYS.errorsAboveZero);
    }
    if (!seenHints[HINT_KEYS.queueBackpressure]) {
      let maxDepth = 0;
      for (const id in snapshot.queueDepthByNodeId) {
        const d = snapshot.queueDepthByNodeId[id];
        if (d > maxDepth) maxDepth = d;
      }
      if (maxDepth >= 1000) enqueue(HINT_KEYS.queueBackpressure);
    }
  }, [snapshot, tutorialDone, seenHints]);

  // cacheDecision + replicationLag — derived from nodes
  useEffect(() => {
    if (!tutorialDone) return;
    if (
      !seenHints[HINT_KEYS.cacheDecision] &&
      nodes.some((n) => n.data.type === 'redis')
    ) {
      enqueue(HINT_KEYS.cacheDecision);
    }
    if (
      !seenHints[HINT_KEYS.replicationLag] &&
      nodes.some((n) => n.data.type === 'postgresReplica')
    ) {
      enqueue(HINT_KEYS.replicationLag);
    }
  }, [nodes, tutorialDone, seenHints]);

  // regionalOutage — derived from incidents
  useEffect(() => {
    if (!tutorialDone) return;
    if (
      !seenHints[HINT_KEYS.regionalOutage] &&
      incidents.some((i) => i.kind === 'regional-outage')
    ) {
      enqueue(HINT_KEYS.regionalOutage);
    }
  }, [incidents, tutorialDone, seenHints]);

  // drop already-seen items from the queue (e.g. after Reset hints + immediate replay)
  useEffect(() => {
    setQueue((q) => q.filter((k) => !seenHints[k]));
  }, [seenHints]);

  const head = queue[0];
  if (!head) return null;
  const hint = HINTS[head];
  if (!hint) return null;

  const onDismiss = () => {
    markHintSeen(hint.key);
    setQueue((q) => q.slice(1));
  };

  return (
    <div className="sc-learn" role="dialog" aria-label={hint.title}>
      <div className="sc-learn__label">Learn</div>
      <div className="sc-learn__title">{hint.title}</div>
      <div className="sc-learn__body">{hint.body}</div>
      <div className="sc-learn__actions">
        <button type="button" className="sc-btn" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
