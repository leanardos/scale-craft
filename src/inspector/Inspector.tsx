import { useMemo, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import {
  useStore,
  useDisplaySnapshot,
  NodeMetricSample,
  EdgeMetricSample,
  MIN_INSTANCE_COUNT,
  MAX_INSTANCE_COUNT
} from '../store/useStore';
import { EndpointsTab } from './EndpointsTab';
import { SchemaTab } from './SchemaTab';
import {
  NODE_SPECS,
  TIERS,
  TIER_MULTIPLIERS,
  Tier,
  DEFAULT_REPLICATION_LAG_MS,
  DEFAULT_READ_KEY_CARDINALITY,
  CDN_MAX_HIT_RATE
} from '../sim/specs';
import { edgeKey } from '../sim/types';
import { utilizationToHsl } from '../util/color';

function fmtInt(n: number) {
  return Math.round(n).toLocaleString('en-US');
}

function fmtFixed(n: number, digits: number) {
  return n.toFixed(digits);
}

function fmtCapacity(cap: number) {
  return cap === Infinity ? '∞' : fmtInt(cap);
}

interface SparklineProps {
  data: Array<NodeMetricSample | EdgeMetricSample>;
  dataKey: 'util' | 'rps';
  color: string;
}

function Sparkline({ data, dataKey, color }: SparklineProps) {
  return (
    <div className="sc-inspector__chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[0, 'auto']} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  unit?: string;
}

function Row({ label, value, unit }: RowProps) {
  return (
    <div className="sc-inspector__row">
      <span className="sc-inspector__row-label">{label}</span>
      <span className="sc-inspector__row-value">
        {value}
        {unit ? <span className="sc-inspector__row-unit">{unit}</span> : null}
      </span>
    </div>
  );
}

type NodeTab = 'overview' | 'endpoints' | 'schema';

function NodeInspector({ id }: { id: string }) {
  const node = useStore((s) => s.nodes.find((n) => n.id === id));
  const snapshot = useDisplaySnapshot();
  const history = useStore((s) => s.perNodeHistory[id] ?? []);
  const setInstanceCount = useStore((s) => s.setInstanceCount);
  const setTier = useStore((s) => s.setTier);
  const setLagMs = useStore((s) => s.setLagMs);
  const setReadKeyCardinality = useStore((s) => s.setReadKeyCardinality);
  const setHitRate = useStore((s) => s.setHitRate);
  const setRegionId = useStore((s) => s.setRegionId);
  const [activeTab, setActiveTab] = useState<NodeTab>('overview');

  if (!node) return null;
  const spec = NODE_SPECS[node.data.type];
  const tabsForType: NodeTab[] = ['overview'];
  if (node.data.type === 'api') tabsForType.push('endpoints');
  if (node.data.type === 'postgres') tabsForType.push('schema');
  const showTab = tabsForType.includes(activeTab) ? activeTab : 'overview';
  const instances = node.data.instanceCount ?? 1;
  const tier: Tier = node.data.tier ?? 'S';
  const tierMult = TIER_MULTIPLIERS[tier];
  const util = snapshot?.perNodeUtilization[id] ?? 0;
  const latencyMs = snapshot?.perNodeLatencyMs[id] ?? 0;
  const errorPct = snapshot?.perNodeErrorPct[id] ?? 0;
  const incomingRps = snapshot?.perNodeIncomingRps[id] ?? 0;
  const ringColor = utilizationToHsl(util);
  const capForDisplay =
    node.data.type === 'postgres' || node.data.type === 'postgresReplica'
      ? spec.workMsPerSec ?? 0
      : spec.capacity ?? 0;
  const scalable = capForDisplay !== Infinity && node.data.type !== 'queue';
  const effectiveCapacity =
    capForDisplay === Infinity ? Infinity : capForDisplay * tierMult.cap * instances;
  const effectiveCost = spec.costPerMonthUsd * tierMult.cost * instances;

  return (
    <>
      <div className="sc-inspector__head">
        <div className="sc-inspector__title">{spec.label}</div>
        <div className="sc-inspector__sub">
          <span className="sc-inspector__type">{node.data.type}</span>
          <span className="sc-inspector__id">#{id}</span>
        </div>
      </div>

      {tabsForType.length > 1 ? (
        <div className="sc-inspector__tabs" role="tablist">
          {tabsForType.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={showTab === t}
              className={`sc-inspector__tab${
                showTab === t ? ' is-active' : ''
              }`}
              onClick={() => setActiveTab(t)}
            >
              {t === 'overview'
                ? 'Overview'
                : t === 'endpoints'
                  ? 'Endpoints'
                  : 'Schema'}
            </button>
          ))}
        </div>
      ) : null}

      {showTab === 'endpoints' ? <EndpointsTab /> : null}
      {showTab === 'schema' ? <SchemaTab /> : null}
      {showTab !== 'overview' ? null : <>

      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Spec</div>
        {node.data.type === 'queue' ? null : (
          <Row
            label="Capacity / instance"
            value={fmtCapacity(capForDisplay)}
            unit={
              node.data.type === 'postgres' || node.data.type === 'postgresReplica'
                ? 'work-ms/s'
                : node.data.type === 'worker'
                  ? 'jobs/s'
                  : 'rps'
            }
          />
        )}
        <Row label="Base latency" value={fmtFixed(spec.baseLatencyMs, 0)} unit="ms" />
        <Row label="Cost / instance" value={`$${fmtInt(spec.costPerMonthUsd)}`} unit="/mo" />
      </section>

      {scalable ? (
        <section className="sc-inspector__section">
          <div className="sc-inspector__section-label">Scaling</div>
          <div className="sc-inspector__stepper">
            <button
              className="sc-stepper__btn"
              onClick={() => setInstanceCount(id, instances - 1)}
              disabled={instances <= MIN_INSTANCE_COUNT}
              aria-label="Decrease instance count"
            >
              −
            </button>
            <span className="sc-stepper__value">{instances}</span>
            <button
              className="sc-stepper__btn"
              onClick={() => setInstanceCount(id, instances + 1)}
              disabled={instances >= MAX_INSTANCE_COUNT}
              aria-label="Increase instance count"
            >
              +
            </button>
            <span className="sc-stepper__caption">instances</span>
          </div>
          <div className="sc-inspector__tier">
            <label className="sc-inspector__tier-label" htmlFor={`tier-${id}`}>
              Tier
            </label>
            <select
              id={`tier-${id}`}
              className="sc-inspector__tier-select"
              value={tier}
              onChange={(e) => setTier(id, e.target.value as Tier)}
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t} · {TIER_MULTIPLIERS[t].cap}× cap / {TIER_MULTIPLIERS[t].cost}× cost
                </option>
              ))}
            </select>
          </div>
          <Row
            label="Effective capacity"
            value={fmtCapacity(effectiveCapacity)}
            unit={
              node.data.type === 'postgres' || node.data.type === 'postgresReplica'
                ? 'work-ms/s'
                : 'rps'
            }
          />
          <Row
            label="Effective cost"
            value={`$${fmtInt(effectiveCost)}`}
            unit="/mo"
          />
        </section>
      ) : null}

      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Live</div>
        <Row
          label="Util / instance"
          value={fmtInt(util * 100)}
          unit="%"
        />
        <Row label="Latency" value={fmtInt(latencyMs)} unit="ms" />
        <Row label="Errors" value={fmtFixed(errorPct, 1)} unit="%" />
        <Row label="Incoming" value={fmtInt(incomingRps)} unit="rps" />
      </section>

      {node.data.type === 'queue' ? (
        <section className="sc-inspector__section">
          <div className="sc-inspector__section-label">Queue</div>
          <Row
            label="Depth"
            value={fmtInt(snapshot?.queueDepthByNodeId[id] ?? 0)}
            unit="msgs"
          />
          <Row
            label="Capacity"
            value={fmtInt(spec.capacity ?? 0)}
            unit="msgs"
          />
          <Row
            label="Arrivals"
            value={fmtInt(snapshot?.queueArrivalRpsByNodeId[id] ?? 0)}
            unit="rps"
          />
        </section>
      ) : null}

      {node.data.type === 'cdn' ? (
        <section className="sc-inspector__section">
          <div className="sc-inspector__section-label">Edge cache</div>
          <div className="sc-inspector__field">
            <label className="sc-inspector__field-label" htmlFor={`hit-${id}`}>
              Hit rate override (
              {node.data.hitRate === undefined
                ? 'auto'
                : `${Math.round(node.data.hitRate * 100)}%`}
              )
            </label>
            <input
              id={`hit-${id}`}
              type="range"
              className="sc-inspector__field-input"
              min={0}
              max={Math.round(CDN_MAX_HIT_RATE * 100)}
              step={1}
              value={Math.round((node.data.hitRate ?? 0) * 100)}
              onChange={(e) => setHitRate(id, Number(e.target.value) / 100)}
            />
          </div>
        </section>
      ) : null}

      {node.data.type === 'postgresReplica' ? (
        <section className="sc-inspector__section">
          <div className="sc-inspector__section-label">Replication</div>
          <div className="sc-inspector__field">
            <label className="sc-inspector__field-label" htmlFor={`lag-${id}`}>
              Lag (ms)
            </label>
            <input
              id={`lag-${id}`}
              type="number"
              className="sc-inspector__field-input"
              min={0}
              step={10}
              value={node.data.lagMs ?? DEFAULT_REPLICATION_LAG_MS}
              onChange={(e) => setLagMs(id, Number(e.target.value))}
            />
          </div>
          <div className="sc-inspector__field">
            <label className="sc-inspector__field-label" htmlFor={`card-${id}`}>
              Read keys
            </label>
            <input
              id={`card-${id}`}
              type="number"
              className="sc-inspector__field-input"
              min={1}
              step={100}
              value={
                node.data.readKeyCardinality ?? DEFAULT_READ_KEY_CARDINALITY
              }
              onChange={(e) =>
                setReadKeyCardinality(id, Number(e.target.value))
              }
            />
          </div>
        </section>
      ) : null}

      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Region</div>
        <div className="sc-inspector__field">
          <label className="sc-inspector__field-label" htmlFor={`region-${id}`}>
            Region ID
          </label>
          <input
            id={`region-${id}`}
            type="text"
            className="sc-inspector__field-input"
            placeholder="(global)"
            value={node.data.regionId ?? ''}
            onChange={(e) => setRegionId(id, e.target.value)}
          />
        </div>
      </section>

      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Utilization · 60s</div>
        <Sparkline data={history} dataKey="util" color={ringColor} />
      </section>
      </>}
    </>
  );
}

function EdgeInspector({
  source,
  target
}: {
  source: string;
  target: string;
}) {
  const sourceNode = useStore((s) => s.nodes.find((n) => n.id === source));
  const targetNode = useStore((s) => s.nodes.find((n) => n.id === target));
  const key = edgeKey(source, target);
  const rps = useDisplaySnapshot()?.perEdgeRps[key] ?? 0;
  const history = useStore((s) => s.perEdgeHistory[key] ?? []);

  const sourceLabel = sourceNode ? NODE_SPECS[sourceNode.data.type].label : source;
  const targetLabel = targetNode ? NODE_SPECS[targetNode.data.type].label : target;

  return (
    <>
      <div className="sc-inspector__head">
        <div className="sc-inspector__title">Edge</div>
        <div className="sc-inspector__sub">
          <span>
            {sourceLabel} → {targetLabel}
          </span>
        </div>
      </div>

      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Live</div>
        <Row label="Throughput" value={fmtInt(rps)} unit="rps" />
      </section>

      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Throughput · 60s</div>
        <Sparkline data={history} dataKey="rps" color="#7dd3fc" />
      </section>
    </>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const clearSelection = useStore((s) => s.clearSelection);

  const body = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'node') return <NodeInspector id={selection.id} />;
    return <EdgeInspector source={selection.source} target={selection.target} />;
  }, [selection]);

  if (!selection) return null;

  return (
    <aside className="sc-inspector">
      <button
        className="sc-inspector__close"
        onClick={clearSelection}
        aria-label="Close inspector"
      >
        ×
      </button>
      {body}
    </aside>
  );
}
