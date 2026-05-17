import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  SavedTopology,
  listSavedTopologies,
  saveTopology,
  deleteSavedTopology,
  serializeTopology,
  isSavedTopology,
  topologyFileName,
  MAX_SAVED_TOPOLOGIES
} from '../store/topology';

function formatTimestamp(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TopologyPanel() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const readPct = useStore((s) => s.readPct);
  const applyTopology = useStore((s) => s.applyTopology);

  const [name, setName] = useState('');
  const [list, setList] = useState<SavedTopology[]>(() => listSavedTopologies());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(id);
  }, [error]);

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name first.');
      return;
    }
    const existing = listSavedTopologies();
    const isReplacing = existing.some((t) => t.name === trimmed);
    if (!isReplacing && existing.length >= MAX_SAVED_TOPOLOGIES) {
      setError(
        `You have ${existing.length} saved topologies (max ${MAX_SAVED_TOPOLOGIES}). Delete one first.`
      );
      return;
    }
    const t = serializeTopology(trimmed, nodes, edges, readPct, Date.now());
    const next = saveTopology(t);
    setList(next);
    setName('');
  };

  const onLoad = (t: SavedTopology) => {
    applyTopology(t);
  };

  const onDelete = (t: SavedTopology) => {
    if (!window.confirm(`Delete saved topology "${t.name}"?`)) return;
    setList(deleteSavedTopology(t.name));
  };

  const onExport = () => {
    const trimmed = name.trim() || 'topology';
    const t = serializeTopology(trimmed, nodes, edges, readPct, Date.now());
    downloadJson(topologyFileName(trimmed), JSON.stringify(t, null, 2));
  };

  const onImportClick = () => fileInputRef.current?.click();

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!isSavedTopology(parsed)) {
        setError('Not a valid ScaleCraft topology file.');
        return;
      }
      applyTopology(parsed);
    } catch {
      setError('Could not read topology file.');
    }
  };

  return (
    <div className="sc-topology">
      <div className="sc-topology__label">Topology</div>
      <div className="sc-topology__row">
        <input
          className="sc-topology__input"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
          }}
        />
        <button type="button" className="sc-btn" onClick={onSave}>
          Save
        </button>
      </div>
      <div className="sc-topology__row">
        <button type="button" className="sc-btn" onClick={onExport}>
          Export
        </button>
        <button type="button" className="sc-btn" onClick={onImportClick}>
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
      </div>
      {error && <div className="sc-topology__error">{error}</div>}
      {list.length === 0 ? (
        <div className="sc-topology__empty">No saved topologies yet.</div>
      ) : (
        <ul className="sc-topology__list">
          {list.map((t) => (
            <li key={t.name} className="sc-topology__item">
              <div className="sc-topology__item-meta">
                <div className="sc-topology__item-name">{t.name}</div>
                <div className="sc-topology__item-sub">
                  {t.nodes.length} nodes · {formatTimestamp(t.savedAt)}
                </div>
              </div>
              <div className="sc-topology__item-actions">
                <button
                  type="button"
                  className="sc-btn sc-btn--small"
                  onClick={() => onLoad(t)}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="sc-btn sc-btn--small sc-btn--danger"
                  onClick={() => onDelete(t)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
