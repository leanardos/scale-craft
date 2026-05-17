// PROTOTYPE — Variant A: grill-me wizard, one question at a time.
import { useState, useCallback, useEffect } from 'react';
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

const STEP_TITLES = [
  'Name your mission',
  'How much traffic?',
  'Read-heavy or write-heavy?',
  'What does winning look like?',
  'How long does it run?',
  'Which components are allowed?',
  'Any incident to survive?',
  'Ready to launch?'
];

export function VariantA_Wizard({ onExit }: Props) {
  const selectMission = useStore((s) => s.selectMission);
  const [draft, setDraft] = useState<DraftMission>(defaultDraft);
  const [step, setStep] = useState(0);
  const total = STEP_TITLES.length;

  const next = useCallback(() => setStep((s) => Math.min(total - 1, s + 1)), [total]);
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const launch = useCallback(() => {
    selectMission(buildMission(draft));
  }, [draft, selectMission]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTyping =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Enter' && !isTyping) {
        if (step === total - 1) launch();
        else next();
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, total, next, launch, onExit]);

  return (
    <div className="va-wizard">
      <div className="va-wizard__inner">
        <header className="va-wizard__header">
          <button className="va-wizard__exit" onClick={onExit}>
            ← Back to missions
          </button>
          <div className="va-wizard__progress">
            {STEP_TITLES.map((_, i) => (
              <span
                key={i}
                className={`va-wizard__dot${i === step ? ' is-active' : ''}${
                  i < step ? ' is-done' : ''
                }`}
              />
            ))}
          </div>
          <div className="va-wizard__count">
            {step + 1} / {total}
          </div>
        </header>

        <h1 className="va-wizard__title">{STEP_TITLES[step]}</h1>

        <div className="va-wizard__body">
          {step === 0 && <TitleStep draft={draft} setDraft={setDraft} />}
          {step === 1 && <RpsStep draft={draft} setDraft={setDraft} />}
          {step === 2 && <ReadPctStep draft={draft} setDraft={setDraft} />}
          {step === 3 && <SloStep draft={draft} setDraft={setDraft} />}
          {step === 4 && <TimingStep draft={draft} setDraft={setDraft} />}
          {step === 5 && <ComponentsStep draft={draft} setDraft={setDraft} />}
          {step === 6 && <IncidentStep draft={draft} setDraft={setDraft} />}
          {step === 7 && <ReviewStep draft={draft} />}
        </div>

        <footer className="va-wizard__footer">
          <button
            className="va-wizard__btn va-wizard__btn--ghost"
            onClick={back}
            disabled={step === 0}
          >
            ← Back
          </button>
          <div className="va-wizard__hint">
            Press <kbd>Enter</kbd> to continue
          </div>
          {step < total - 1 ? (
            <button className="va-wizard__btn" onClick={next}>
              Next →
            </button>
          ) : (
            <button className="va-wizard__btn va-wizard__btn--primary" onClick={launch}>
              Launch mission →
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

interface StepProps {
  draft: DraftMission;
  setDraft: React.Dispatch<React.SetStateAction<DraftMission>>;
}

function TitleStep({ draft, setDraft }: StepProps) {
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">Mission name</label>
      <input
        className="va-wizard__input va-wizard__input--big"
        autoFocus
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        placeholder="My custom mission"
      />
      <p className="va-wizard__rec">
        Recommended: a short, descriptive name. You'll see this on the dashboard.
      </p>
    </div>
  );
}

function RpsStep({ draft, setDraft }: StepProps) {
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">Target RPS</label>
      <input
        className="va-wizard__input va-wizard__input--big"
        type="number"
        min={100}
        max={50000}
        step={100}
        autoFocus
        value={draft.targetRps}
        onChange={(e) =>
          setDraft((d) => ({ ...d, targetRps: clamp(+e.target.value, 100, 50000) }))
        }
      />
      <p className="va-wizard__rec">
        Recommended: 2,000 RPS for a moderate challenge. Bump to 10,000+ for serious
        scaling work.
      </p>
    </div>
  );
}

function ReadPctStep({ draft, setDraft }: StepProps) {
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">
        Read percentage: <strong>{draft.readPct}%</strong> (writes: {100 - draft.readPct}%)
      </label>
      <input
        className="va-wizard__range"
        type="range"
        min={0}
        max={100}
        step={1}
        autoFocus
        value={draft.readPct}
        onChange={(e) => setDraft((d) => ({ ...d, readPct: +e.target.value }))}
      />
      <p className="va-wizard__rec">
        Recommended: 95% reads. Caches help on reads; only sharding helps on writes.
      </p>
    </div>
  );
}

function SloStep({ draft, setDraft }: StepProps) {
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">Win conditions — all three must hold to win</label>
      <div className="va-wizard__row3">
        <NumField
          label="p95 (ms)"
          value={draft.p95MaxMs}
          onChange={(v) => setDraft((d) => ({ ...d, p95MaxMs: v }))}
          min={10}
          max={5000}
          step={10}
        />
        <NumField
          label="errors (%)"
          value={draft.errorMaxPct}
          onChange={(v) => setDraft((d) => ({ ...d, errorMaxPct: v }))}
          min={0}
          max={50}
          step={0.5}
        />
        <NumField
          label="budget ($/mo)"
          value={draft.costMaxUsd}
          onChange={(v) => setDraft((d) => ({ ...d, costMaxUsd: v }))}
          min={50}
          max={10000}
          step={50}
        />
      </div>
      <p className="va-wizard__rec">
        Recommended: 200ms / 1% / $800. Tighten them to make the mission harder.
      </p>
    </div>
  );
}

function TimingStep({ draft, setDraft }: StepProps) {
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">Ramp + sustain</label>
      <div className="va-wizard__row2">
        <NumField
          label="ramp (s)"
          value={draft.rampSeconds}
          onChange={(v) => setDraft((d) => ({ ...d, rampSeconds: v }))}
          min={1}
          max={120}
          step={1}
        />
        <NumField
          label="sustain (s)"
          value={draft.sustainSeconds}
          onChange={(v) => setDraft((d) => ({ ...d, sustainSeconds: v }))}
          min={5}
          max={600}
          step={5}
        />
      </div>
      <p className="va-wizard__rec">
        Recommended: ramp 20s, sustain 60s. Sustain is how long win conditions must hold
        to actually win.
      </p>
    </div>
  );
}

function ComponentsStep({ draft, setDraft }: StepProps) {
  const toggleAllowed = (t: NodeType) =>
    setDraft((d) => {
      const has = d.allowedComponents.includes(t);
      const allowedComponents = has
        ? d.allowedComponents.filter((x) => x !== t)
        : [...d.allowedComponents, t];
      const requiredComponents = d.requiredComponents.filter((x) =>
        allowedComponents.includes(x)
      );
      return { ...d, allowedComponents, requiredComponents };
    });
  const toggleRequired = (t: NodeType) =>
    setDraft((d) => {
      const has = d.requiredComponents.includes(t);
      return {
        ...d,
        requiredComponents: has
          ? d.requiredComponents.filter((x) => x !== t)
          : [...d.requiredComponents, t]
      };
    });
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">Allowed components</label>
      <div className="va-wizard__chips">
        {ALL_COMPONENTS.map((t) => (
          <button
            key={t}
            type="button"
            className={`va-wizard__chip${
              draft.allowedComponents.includes(t) ? ' is-on' : ''
            }`}
            onClick={() => toggleAllowed(t)}
          >
            {COMPONENT_LABELS[t]}
          </button>
        ))}
      </div>
      <label className="va-wizard__label" style={{ marginTop: 18 }}>
        Required (must appear in topology)
      </label>
      <div className="va-wizard__chips">
        {draft.allowedComponents.map((t) => (
          <button
            key={t}
            type="button"
            className={`va-wizard__chip${
              draft.requiredComponents.includes(t) ? ' is-on' : ''
            }`}
            onClick={() => toggleRequired(t)}
          >
            {COMPONENT_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="va-wizard__rec">
        Recommended: leave all allowed, require nothing. Forcing components makes a
        mission teach a specific concept.
      </p>
    </div>
  );
}

function IncidentStep({ draft, setDraft }: StepProps) {
  const enabled = draft.incident !== null;
  return (
    <div className="va-wizard__field">
      <label className="va-wizard__label">Optional incident schedule</label>
      <div className="va-wizard__row2" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className={`va-wizard__chip${!enabled ? ' is-on' : ''}`}
          onClick={() => setDraft((d) => ({ ...d, incident: null }))}
        >
          No incident
        </button>
        <button
          type="button"
          className={`va-wizard__chip${enabled ? ' is-on' : ''}`}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              incident: d.incident ?? {
                kind: 'kill-postgres',
                atSeconds: 30
              }
            }))
          }
        >
          Schedule one
        </button>
      </div>
      {enabled && draft.incident && (
        <div className="va-wizard__row3" style={{ marginTop: 16 }}>
          <div>
            <span className="va-wizard__sublabel">Kind</span>
            <select
              className="va-wizard__input"
              value={draft.incident.kind}
              onChange={(e) =>
                setDraft((d) =>
                  d.incident
                    ? { ...d, incident: { ...d.incident, kind: e.target.value as IncidentKind } }
                    : d
                )
              }
            >
              {INCIDENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INCIDENT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <NumField
            label="at (s into sustain)"
            value={draft.incident.atSeconds}
            onChange={(v) =>
              setDraft((d) =>
                d.incident ? { ...d, incident: { ...d.incident, atSeconds: v } } : d
              )
            }
            min={0}
            max={600}
            step={1}
          />
          {draft.incident.kind === 'regional-outage' && (
            <div>
              <span className="va-wizard__sublabel">Region ID</span>
              <input
                className="va-wizard__input"
                value={draft.incident.regionId ?? 'eu'}
                onChange={(e) =>
                  setDraft((d) =>
                    d.incident
                      ? { ...d, incident: { ...d.incident, regionId: e.target.value } }
                      : d
                  )
                }
              />
            </div>
          )}
        </div>
      )}
      <p className="va-wizard__rec">
        Recommended: no incident for your first run. Add a regional-outage at 30s to
        practice failover.
      </p>
    </div>
  );
}

function ReviewStep({ draft }: { draft: DraftMission }) {
  return (
    <div className="va-wizard__review">
      <div className="va-wizard__review-title">{draft.title}</div>
      <div className="va-wizard__review-rows">
        <Row label="Target" value={`${draft.targetRps.toLocaleString()} RPS @ ${draft.readPct}% reads`} />
        <Row
          label="Win"
          value={`p95 ≤ ${draft.p95MaxMs}ms, err ≤ ${draft.errorMaxPct}%, cost ≤ $${draft.costMaxUsd}`}
        />
        <Row label="Timing" value={`ramp ${draft.rampSeconds}s, sustain ${draft.sustainSeconds}s`} />
        <Row label="Allowed" value={draft.allowedComponents.map((c) => COMPONENT_LABELS[c]).join(', ')} />
        {draft.requiredComponents.length > 0 && (
          <Row
            label="Required"
            value={draft.requiredComponents.map((c) => COMPONENT_LABELS[c]).join(', ')}
          />
        )}
        {draft.incident && (
          <Row
            label="Incident"
            value={`${INCIDENT_LABELS[draft.incident.kind]} at t=${draft.incident.atSeconds}s${
              draft.incident.regionId ? ` (${draft.incident.regionId})` : ''
            }`}
          />
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="va-wizard__review-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <span className="va-wizard__sublabel">{label}</span>
      <input
        className="va-wizard__input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(+e.target.value, min, max))}
      />
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
