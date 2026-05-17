import { useStore } from '../store/useStore';
import { QUERY_TYPES, SKEWS, QueryType, Skew } from '../sim/types';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function EndpointsTab() {
  const endpoints = useStore((s) => s.endpoints);
  const tables = useStore((s) => s.tables);
  const updateEndpoint = useStore((s) => s.updateEndpoint);
  const inMission = useStore((s) => s.missionSpec !== null);
  const readOnly = inMission;

  if (endpoints.length === 0) {
    return (
      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Endpoints</div>
        <div className="sc-inspector__empty">
          No endpoints declared. Load a mission to see its endpoints, or add
          one in sandbox mode.
        </div>
      </section>
    );
  }

  return (
    <>
      {endpoints.map((e, idx) => {
        const table = tables.find((t) => t.name === e.table);
        const columnNames = table ? table.columns.map((c) => c.name) : [];
        return (
          <section className="sc-inspector__section" key={`${e.method}-${e.route}-${idx}`}>
            <div className="sc-inspector__section-label">
              {e.method} {e.route}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Table</span>
              {readOnly ? (
                <span className="sc-endpoint__value">{e.table}</span>
              ) : (
                <select
                  className="sc-inspector__field-input"
                  value={e.table}
                  onChange={(ev) =>
                    updateEndpoint(idx, { table: ev.target.value })
                  }
                >
                  {tables.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Query type</span>
              {readOnly ? (
                <span className="sc-endpoint__value">{e.query.type}</span>
              ) : (
                <select
                  className="sc-inspector__field-input"
                  value={e.query.type}
                  onChange={(ev) =>
                    updateEndpoint(idx, {
                      query: { type: ev.target.value as QueryType }
                    })
                  }
                >
                  {QUERY_TYPES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">By column</span>
              {readOnly ? (
                <span className="sc-endpoint__value">
                  {e.query.byColumn ?? '—'}
                </span>
              ) : (
                <select
                  className="sc-inspector__field-input"
                  value={e.query.byColumn ?? ''}
                  onChange={(ev) =>
                    updateEndpoint(idx, {
                      query: {
                        byColumn:
                          ev.target.value === '' ? undefined : ev.target.value
                      }
                    })
                  }
                >
                  <option value="">(none)</option>
                  {columnNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Response size</span>
              {readOnly ? (
                <span className="sc-endpoint__value">
                  {fmtBytes(e.responseSize)}
                </span>
              ) : (
                <input
                  type="number"
                  className="sc-inspector__field-input"
                  min={0}
                  step={1}
                  value={e.responseSize}
                  onChange={(ev) =>
                    updateEndpoint(idx, {
                      responseSize: Math.max(0, Number(ev.target.value))
                    })
                  }
                />
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Skew</span>
              {readOnly ? (
                <span className="sc-endpoint__value">{e.skew}</span>
              ) : (
                <select
                  className="sc-inspector__field-input"
                  value={e.skew}
                  onChange={(ev) =>
                    updateEndpoint(idx, { skew: ev.target.value as Skew })
                  }
                >
                  {SKEWS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Weight</span>
              {readOnly ? (
                <span className="sc-endpoint__value">
                  {e.weight.toFixed(2)}
                </span>
              ) : (
                <input
                  type="number"
                  className="sc-inspector__field-input"
                  min={0}
                  max={1}
                  step={0.01}
                  value={e.weight}
                  onChange={(ev) =>
                    updateEndpoint(idx, {
                      weight: Math.max(0, Number(ev.target.value))
                    })
                  }
                />
              )}
            </div>

            <div className="sc-endpoint__flags">
              <div className="sc-endpoint__flags-label">Retrofit flags</div>
              <FlagRow label="replicaSafe" />
              <FlagRow label="async" />
              <FlagRow label="edgeCacheable" />
              <div className="sc-endpoint__flags-note">
                Not wired yet — see issues 11–13.
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

function FlagRow({ label }: { label: string }) {
  return (
    <div className="sc-endpoint__flag">
      <span className="sc-endpoint__flag-label">{label}</span>
      <span className="sc-endpoint__flag-value">—</span>
    </div>
  );
}
