import { useState } from 'react';
import { useStore } from '../store/useStore';

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function fmtRowsBytes(rowCount: number, avgRowSize: number): string {
  return `${fmtInt(rowCount)} × ${fmtBytes(avgRowSize)}`;
}

export function MissionBriefPanel() {
  const spec = useStore((s) => s.missionSpec);
  const [open, setOpen] = useState(true);
  if (!spec) return null;

  const w = spec.winConditions;
  const tables = spec.tables ?? [];
  const endpoints = spec.endpoints ?? [];

  return (
    <div className={`sc-brief${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="sc-brief__head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="sc-brief__chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="sc-brief__title">{spec.title}</span>
      </button>
      {open ? (
        <div className="sc-brief__body">
          <div className="sc-brief__line">
            <span className="sc-brief__line-label">Target</span>
            <span className="sc-brief__line-value">
              {fmtInt(spec.targetRps)} RPS · ramp {spec.rampSeconds}s · sustain{' '}
              {spec.sustainSeconds}s
            </span>
          </div>
          <div className="sc-brief__line">
            <span className="sc-brief__line-label">Win</span>
            <span className="sc-brief__line-value">
              p95 ≤ {w.p95MaxMs}ms · err ≤ {w.errorMaxPct}% · cost ≤ $
              {w.costMaxUsd}
            </span>
          </div>

          {tables.length > 0 ? (
            <div className="sc-brief__group">
              <div className="sc-brief__group-label">Tables</div>
              {tables.map((t) => (
                <div className="sc-brief__row" key={t.name}>
                  <span className="sc-brief__row-name">{t.name}</span>
                  <span className="sc-brief__row-meta">
                    {fmtRowsBytes(t.rowCount, t.avgRowSize)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {endpoints.length > 0 ? (
            <div className="sc-brief__group">
              <div className="sc-brief__group-label">Endpoints</div>
              {endpoints.map((e) => (
                <div
                  className="sc-brief__row"
                  key={`${e.method}-${e.route}`}
                >
                  <span className="sc-brief__row-name">
                    {e.method} {e.route}
                  </span>
                  <span className="sc-brief__row-meta">
                    w {e.weight.toFixed(2)} · {e.skew}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
