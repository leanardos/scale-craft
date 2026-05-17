// PROTOTYPE — Variant B: dense single-form sheet. All fields visible, no walkthrough.
import { useState } from 'react';
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

export function VariantB_Form({ onExit }: Props) {
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    selectMission(buildMission(d));
  };

  return (
    <div className="vb-form">
      <div className="vb-form__inner">
        <header className="vb-form__header">
          <button type="button" className="vb-form__exit" onClick={onExit}>
            ← Back to missions
          </button>
          <h1 className="vb-form__title">Custom mission — spec sheet</h1>
        </header>

        <form className="vb-form__form" onSubmit={submit}>
          <fieldset className="vb-form__section">
            <legend>Identity</legend>
            <div className="vb-form__grid">
              <Field label="Title">
                <input
                  className="vb-form__input"
                  value={d.title}
                  onChange={(e) => update('title', e.target.value)}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="vb-form__section">
            <legend>Traffic</legend>
            <div className="vb-form__grid vb-form__grid--3">
              <Field label="Target RPS">
                <input
                  className="vb-form__input"
                  type="number"
                  min={100}
                  max={50000}
                  step={100}
                  value={d.targetRps}
                  onChange={(e) =>
                    update('targetRps', clamp(+e.target.value, 100, 50000))
                  }
                />
              </Field>
              <Field label="Read %">
                <input
                  className="vb-form__input"
                  type="number"
                  min={0}
                  max={100}
                  value={d.readPct}
                  onChange={(e) => update('readPct', clamp(+e.target.value, 0, 100))}
                />
              </Field>
              <Field label="(write %)">
                <input
                  className="vb-form__input"
                  type="number"
                  value={100 - d.readPct}
                  readOnly
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="vb-form__section">
            <legend>Win conditions</legend>
            <div className="vb-form__grid vb-form__grid--3">
              <Field label="p95 max (ms)">
                <input
                  className="vb-form__input"
                  type="number"
                  min={10}
                  max={5000}
                  step={10}
                  value={d.p95MaxMs}
                  onChange={(e) => update('p95MaxMs', clamp(+e.target.value, 10, 5000))}
                />
              </Field>
              <Field label="Error max (%)">
                <input
                  className="vb-form__input"
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={d.errorMaxPct}
                  onChange={(e) => update('errorMaxPct', clamp(+e.target.value, 0, 50))}
                />
              </Field>
              <Field label="Cost max ($/mo)">
                <input
                  className="vb-form__input"
                  type="number"
                  min={50}
                  max={10000}
                  step={50}
                  value={d.costMaxUsd}
                  onChange={(e) => update('costMaxUsd', clamp(+e.target.value, 50, 10000))}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="vb-form__section">
            <legend>Timing</legend>
            <div className="vb-form__grid vb-form__grid--2">
              <Field label="Ramp (s)">
                <input
                  className="vb-form__input"
                  type="number"
                  min={1}
                  max={120}
                  value={d.rampSeconds}
                  onChange={(e) => update('rampSeconds', clamp(+e.target.value, 1, 120))}
                />
              </Field>
              <Field label="Sustain (s)">
                <input
                  className="vb-form__input"
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  value={d.sustainSeconds}
                  onChange={(e) =>
                    update('sustainSeconds', clamp(+e.target.value, 5, 600))
                  }
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="vb-form__section">
            <legend>Components</legend>
            <div className="vb-form__chips-label">Allowed</div>
            <div className="vb-form__chips">
              {ALL_COMPONENTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`vb-form__chip${
                    d.allowedComponents.includes(t) ? ' is-on' : ''
                  }`}
                  onClick={() => toggleAllowed(t)}
                >
                  {COMPONENT_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="vb-form__chips-label">Required</div>
            <div className="vb-form__chips">
              {d.allowedComponents.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`vb-form__chip${
                    d.requiredComponents.includes(t) ? ' is-on' : ''
                  }`}
                  onClick={() => toggleRequired(t)}
                >
                  {COMPONENT_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="vb-form__section">
            <legend>Incident (optional)</legend>
            <div className="vb-form__grid vb-form__grid--3">
              <Field label="Kind">
                <select
                  className="vb-form__input"
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
                  <option value="">— none —</option>
                  {INCIDENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {INCIDENT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="At t = (s)">
                <input
                  className="vb-form__input"
                  type="number"
                  min={0}
                  max={600}
                  value={d.incident?.atSeconds ?? 30}
                  disabled={!d.incident}
                  onChange={(e) =>
                    setD((prev) =>
                      prev.incident
                        ? {
                            ...prev,
                            incident: {
                              ...prev.incident,
                              atSeconds: clamp(+e.target.value, 0, 600)
                            }
                          }
                        : prev
                    )
                  }
                />
              </Field>
              <Field label="Region (for regional-outage)">
                <input
                  className="vb-form__input"
                  value={d.incident?.regionId ?? ''}
                  disabled={!d.incident || d.incident.kind !== 'regional-outage'}
                  placeholder="eu"
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
              </Field>
            </div>
          </fieldset>

          <div className="vb-form__actions">
            <button type="button" className="vb-form__btn vb-form__btn--ghost" onClick={onExit}>
              Cancel
            </button>
            <button type="submit" className="vb-form__btn vb-form__btn--primary">
              Launch mission →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="vb-form__field">
      <span className="vb-form__field-label">{label}</span>
      {children}
    </label>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
