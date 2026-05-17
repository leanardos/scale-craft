import { useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { useStore, useDisplaySnapshot, MetricSample } from '../store/useStore';

interface TileProps {
  label: string;
  value: string;
  unit?: string;
  data: MetricSample[];
  dataKey: keyof MetricSample;
  color: string;
}

function SparklineTile({ label, value, unit, data, dataKey, color }: TileProps) {
  return (
    <div className="sc-tile">
      <div className="sc-tile__head">
        <span className="sc-tile__label">{label}</span>
      </div>
      <div className="sc-tile__value">
        {value}
        {unit ? <span className="sc-tile__unit">{unit}</span> : null}
      </div>
      <div className="sc-tile__chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
            <YAxis hide domain={[0, 'auto']} />
            <Line
              type="monotone"
              dataKey={dataKey as string}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function fmtInt(n: number) {
  return Math.round(n).toLocaleString('en-US');
}

function fmtFixed(n: number, digits: number) {
  return n.toFixed(digits);
}

export function Dashboard() {
  const history = useStore((s) => s.history);
  const nodes = useStore((s) => s.nodes);
  const snapshot = useDisplaySnapshot();

  const hasReplica = useMemo(
    () => nodes.some((n) => n.data.type === 'postgresReplica'),
    [nodes]
  );
  const hasQueue = useMemo(
    () => nodes.some((n) => n.data.type === 'queue'),
    [nodes]
  );

  const m = useMemo(() => {
    if (snapshot) {
      return {
        rps: snapshot.rps,
        effectiveRps: snapshot.effectiveRps,
        p50Ms: snapshot.p50Ms,
        p95Ms: snapshot.p95Ms,
        p99Ms: snapshot.p99Ms,
        errorPct: snapshot.errorPct,
        costUsd: snapshot.costUsd,
        staleReadPct: snapshot.staleReadPct,
        queueDepthMax: snapshot.queueDepthMax
      };
    }
    return {
      rps: 0,
      effectiveRps: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      errorPct: 0,
      costUsd: 0,
      staleReadPct: 0,
      queueDepthMax: 0
    };
  }, [snapshot]);

  return (
    <div className="sc-dashboard">
      <SparklineTile
        label="p50 latency"
        value={fmtInt(m.p50Ms)}
        unit="ms"
        data={history}
        dataKey="p50Ms"
        color="#60a5fa"
      />
      <SparklineTile
        label="p95 latency"
        value={fmtInt(m.p95Ms)}
        unit="ms"
        data={history}
        dataKey="p95Ms"
        color="#a78bfa"
      />
      <SparklineTile
        label="p99 latency"
        value={fmtInt(m.p99Ms)}
        unit="ms"
        data={history}
        dataKey="p99Ms"
        color="#f472b6"
      />
      <SparklineTile
        label="errors"
        value={fmtFixed(m.errorPct, 1)}
        unit="%"
        data={history}
        dataKey="errorPct"
        color="#f87171"
      />
      <div className="sc-tile">
        <div className="sc-tile__head">
          <span className="sc-tile__label">RPS in → out</span>
        </div>
        <div className="sc-tile__value">
          {fmtInt(m.rps)}
          <span className="sc-tile__unit"> → {fmtInt(m.effectiveRps)}</span>
        </div>
        <div className="sc-tile__chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={history}
              margin={{ top: 4, right: 2, bottom: 2, left: 2 }}
            >
              <YAxis hide domain={[0, 'auto']} />
              <Line
                type="monotone"
                dataKey="rps"
                stroke="#38bdf8"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="effectiveRps"
                stroke="#22d3ee"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {hasQueue && (
        <SparklineTile
          label="queue depth"
          value={fmtInt(m.queueDepthMax)}
          data={history}
          dataKey="queueDepthMax"
          color="#34d399"
        />
      )}
      <SparklineTile
        label="cost / mo"
        value={`$${fmtInt(m.costUsd)}`}
        data={history}
        dataKey="costUsd"
        color="#facc15"
      />
      {hasReplica && (
        <SparklineTile
          label="stale reads"
          value={fmtFixed(m.staleReadPct, 1)}
          unit="%"
          data={history}
          dataKey="staleReadPct"
          color="#fb923c"
        />
      )}
    </div>
  );
}
