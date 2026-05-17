// PROTOTYPE — Variant C: live-preview workbench. Sliders on the left, mission card on the right.
import { useMemo, useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  DraftMission,
  defaultDraft,
  buildMission,
  ALL_COMPONENTS,
  COMPONENT_LABELS,
  INCIDENT_KINDS,
  INCIDENT_LABELS
} from './draft';
import { NodeType } from '../../sim/types';
import { IncidentKind } from '../../sim/incidents';

interface Props {
  onExit: () => void;
}

export function VariantC_Workbench({ onExit }: Props) {
  const selectMission = useStore((s) => s.selectMission);
  const [d, setD] = useState<DraftMission>(defaultDraft);

  const update = <K extends keyof DraftMission>(k: K, v: DraftMission[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const toggleAllowed = (t: NodeType) =>
    setD((prev) => {
      const has = prev.allowedComponents.includes(t);
      const allowedComponents = has
        ? prev.allowedComponents.filter((x) => x !== t)
        : [...prev.allowedComponents, t];
      const requiredComponents = prev.requiredComponents.filter((x) =>
        allowedComponents.includes(x)
      );
      return { ...prev, allowedComponents, requiredComponents };
    });

  const toggleRequired = (t: NodeType) =>
    setD((prev) => ({
      ...prev,
      requiredComponents: prev.requiredComponents.includes(t)
        ? prev.requiredComponents.filter((x) => x !== t)
        : [...prev.requiredComponents, t]
    }));

  const spec = useMemo(() => buildMission(d), [d]);

  const launch = () => selectMission(spec);

  return (
    <div className="vc-wb">
      <div className="vc-wb__inner">
        <header className="vc-wb__header">
          <button type="button" className="vc-wb__exit" onClick={onExit}>
            ← Back to missions
          </button>
          <h1 className="vc-wb__title">Custom mission — workbench</h1>
          <p className="vc-wb__subtitle">Tweak on the left, the mission card on the right updates live.</p>
        </header>

        <div className="vc-wb__split">
          <div className="vc-wb__panel">
            <div className="vc-wb__group">
              <label className="vc-wb__group-label">Title</label>
              <input
                className="vc-wb__text"
                value={d.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </div>

            <Slider
              label="Target RPS"
              value={d.targetRps}
              display={d.targetRps.toLocaleString()}
              min={100}
              max={20000}
              step={100}
              onChange={(v) => update('targetRps', v)}
            />
            <Slider
              label="Reads"
              value={d.readPct}
              display={`${d.readPct}% reads / ${100 - d.readPct}% writes`}
              min={0}
              max={100}
              step={1}
              onChange={(v) => update('readPct', v)}
            />
            <Slider
              label="p95 ceiling"
              value={d.p95MaxMs}
              display={`${d.p95MaxMs} ms`}
              min={10}
              max={2000}
              step={10}
              onChange={(v) => update('p95MaxMs', v)}
            />
            <Slider
              label="Error ceiling"
              value={d.errorMaxPct}
              display={`${d.errorMaxPct}%`}
              min={0}
              max={20}
              step={0.5}
              onChange={(v) => update('errorMaxPct', v)}
            />
            <Slider
              label="Cost budget"
              value={d.costMaxUsd}
              display={`$${d.costMaxUsd}/mo`}
              min={50}
              max={5000}
              step={50}
              onChange={(v) => update('costMaxUsd', v)}
            />
            <div className="vc-wb__group">
              <label className="vc-wb__group-label">Timing</label>
              <div className="vc-wb__row">
                <SmallNum
                  label="ramp"
                  unit="s"
                  value={d.rampSeconds}
                  min={1}
                  max={120}
                  onChange={(v) => update('rampSeconds', v)}
                />
                <SmallNum
                  label="sustain"
                  unit="s"
                  value={d.sustainSeconds}
                  min={5}
                  max={600}
                  onChange={(v) => update('sustainSeconds', v)}
                />
              </div>
            </div>

            <div className="vc-wb__group">
              <label className="vc-wb__group-label">Allowed components</label>
              <div className="vc-wb__chips">
                {ALL_COMPONENTS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`vc-wb__chip${
                      d.allowedComponents.includes(t) ? ' is-on' : ''
                    }`}
                    onClick={() => toggleAllowed(t)}
                  >
                    {COMPONENT_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="vc-wb__group">
              <label className="vc-wb__group-label">Required components</label>
              <div className="vc-wb__chips">
                {d.allowedComponents.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`vc-wb__chip vc-wb__chip--alt${
                      d.requiredComponents.includes(t) ? ' is-on' : ''
                    }`}
                    onClick={() => toggleRequired(t)}
                  >
                    {COMPONENT_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div className="vc-wb__group">
              <label className="vc-wb__group-label">Incident</label>
              <div className="vc-wb__row">
                <select
                  className="vc-wb__text"
                  value={d.incident?.kind ?? ''}
                  onChange={(e) =>
                    setD((prev) => ({
                      ...prev,
                      incident:
                        e.target.value === ''
                          ? null
                          : {
                              kind: e.target.value as IncidentKind,
                              atSeconds: prev.incident?.atSeconds ?? 30,
                              regionId: prev.incident?.regionId
                            }
                    }))
                  }
                >
                  <option value="">none</option>
                  {INCIDENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {INCIDENT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <SmallNum
                  label="at"
                  unit="s"
                  value={d.incident?.atSeconds ?? 30}
                  min={0}
                  max={600}
                  disabled={!d.incident}
                  onChange={(v) =>
                    setD((prev) =>
                      prev.incident
                        ? { ...prev, incident: { ...prev.incident, atSeconds: v } }
                        : prev
                    )
                  }
                />
              </div>
              {d.incident?.kind === 'regional-outage' && (
                <input
                  className="vc-wb__text"
                  style={{ marginTop: 8 }}
                  placeholder="region id (e.g. eu)"
                  value={d.incident.regionId ?? ''}
                  onChange={(e) =>
                    setD((prev) =>
                      prev.incident
                        ? {
                            ...prev,
                            incident: { ...prev.incident, regionId: e.target.value }
                          }
                        : prev
                    )
                  }
                />
              )}
            </div>
          </div>

          <div className="vc-wb__preview">
            <span className="vc-wb__preview-eyebrow">Live preview</span>
            <article
              className="sc-start__card vc-wb__card"
              style={{ ['--accent' as string]: '#38bdf8' }}
            >
              <div className="sc-start__card-top">
                <span className="sc-start__tag">Custom</span>
                <span className="sc-start__best">Built just now</span>
              </div>
              <div className="sc-start__rps">
                <span className="sc-start__rps-num">{formatRps(d.targetRps)}</span>
                <span className="sc-start__rps-unit">RPS</span>
              </div>
              <h2 className="sc-start__card-title">{spec.title}</h2>
              <p className="sc-start__brief">{spec.brief}</p>
              <div className="sc-start__chips">
                <span className="sc-start__chip">
                  <span>p95</span>
                  <strong>≤{d.p95MaxMs}ms</strong>
                </span>
                <span className="sc-start__chip">
                  <span>err</span>
                  <strong>≤{d.errorMaxPct}%</strong>
                </span>
                <span className="sc-start__chip">
                  <span>$</span>
                  <strong>≤{d.costMaxUsd}</strong>
                </span>
                <span className="sc-start__chip">
                  <span>reads</span>
                  <strong>{d.readPct}%</strong>
                </span>
              </div>
              <button type="button" className="sc-start__launch" onClick={launch}>
                Launch →
              </button>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="vc-wb__group">
      <label className="vc-wb__group-label">
        {label} <span className="vc-wb__value">{display}</span>
      </label>
      <input
        className="vc-wb__slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  );
}

function SmallNum({
  label,
  unit,
  value,
  min,
  max,
  onChange,
  disabled
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="vc-wb__small">
      <span>
        {label} ({unit})
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(+e.target.value, min, max))}
      />
    </label>
  );
}

function formatRps(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
