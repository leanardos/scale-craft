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

// Per ADR 0002: write cost = 5ms + 0.5ms × non-PK index count.
const WRITE_PENALTY_PER_INDEX_MS = 0.5;

export function SchemaTab() {
  const tables = useStore((s) => s.tables);
  const inMission = useStore((s) => s.missionSpec !== null);
  const setColumnIndexed = useStore((s) => s.setColumnIndexed);
  const updateTable = useStore((s) => s.updateTable);
  const updateColumn = useStore((s) => s.updateColumn);

  if (tables.length === 0) {
    return (
      <section className="sc-inspector__section">
        <div className="sc-inspector__section-label">Schema</div>
        <div className="sc-inspector__empty">
          No tables declared. Load a mission to see its schema, or add a table
          in sandbox mode.
        </div>
      </section>
    );
  }

  return (
    <>
      {tables.map((t) => {
        const workingSet = t.rowCount * t.avgRowSize;
        return (
          <section className="sc-inspector__section" key={t.name}>
            <div className="sc-inspector__section-label">{t.name}</div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Rows</span>
              {inMission ? (
                <span className="sc-endpoint__value">{fmtInt(t.rowCount)}</span>
              ) : (
                <input
                  type="number"
                  className="sc-inspector__field-input"
                  min={0}
                  step={1000}
                  value={t.rowCount}
                  onChange={(ev) =>
                    updateTable(t.name, {
                      rowCount: Math.max(0, Number(ev.target.value))
                    })
                  }
                />
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Row size</span>
              {inMission ? (
                <span className="sc-endpoint__value">
                  {fmtBytes(t.avgRowSize)}
                </span>
              ) : (
                <input
                  type="number"
                  className="sc-inspector__field-input"
                  min={1}
                  step={1}
                  value={t.avgRowSize}
                  onChange={(ev) =>
                    updateTable(t.name, {
                      avgRowSize: Math.max(1, Number(ev.target.value))
                    })
                  }
                />
              )}
            </div>

            <div className="sc-endpoint__field">
              <span className="sc-endpoint__label">Working set</span>
              <span className="sc-endpoint__value">{fmtBytes(workingSet)}</span>
            </div>

            <div className="sc-schema__columns">
              <div className="sc-schema__columns-label">Columns</div>
              {t.columns.map((c) => (
                <div className="sc-schema__col" key={c.name}>
                  <div className="sc-schema__col-head">
                    {inMission ? (
                      <span className="sc-schema__col-name">{c.name}</span>
                    ) : (
                      <input
                        type="text"
                        className="sc-inspector__field-input sc-schema__col-name-input"
                        value={c.name}
                        onChange={(ev) =>
                          updateColumn(t.name, c.name, {
                            name: ev.target.value
                          })
                        }
                      />
                    )}
                    {inMission ? (
                      <span className="sc-schema__col-type">{c.type}</span>
                    ) : (
                      <input
                        type="text"
                        className="sc-inspector__field-input sc-schema__col-type-input"
                        value={c.type}
                        onChange={(ev) =>
                          updateColumn(t.name, c.name, {
                            type: ev.target.value
                          })
                        }
                      />
                    )}
                    {c.primaryKey ? (
                      <span className="sc-schema__col-pk">PK</span>
                    ) : null}
                  </div>
                  <label
                    className={`sc-schema__index${
                      c.primaryKey ? ' is-pk' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={c.indexed}
                      disabled={!!c.primaryKey}
                      onChange={(ev) =>
                        setColumnIndexed(t.name, c.name, ev.target.checked)
                      }
                    />
                    <span>indexed</span>
                    {!c.primaryKey ? (
                      <span className="sc-schema__index-hint">
                        +{WRITE_PENALTY_PER_INDEX_MS}ms per write
                      </span>
                    ) : null}
                  </label>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
