import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { winConditionsHold } from '../sim/mission';

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ConditionTile({
  label,
  value,
  ok
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className={`sc-cond${ok ? ' is-ok' : ''}`}>
      <span className="sc-cond__check">{ok ? '✓' : '·'}</span>
      <span className="sc-cond__label">{label}</span>
      <span className="sc-cond__value">{value}</span>
    </div>
  );
}

export function MissionPanel() {
  const spec = useStore((s) => s.missionSpec);
  const runtime = useStore((s) => s.missionRuntime);
  const snapshot = useStore((s) => s.snapshot);
  const clearMission = useStore((s) => s.clearMission);
  const giveUp = useStore((s) => s.giveUpMission);
  const now = useNow(200);

  if (!spec) return null;

  const isRamping = runtime.status === 'ramping';
  const isSustaining = runtime.status === 'sustaining';
  const isIdle = runtime.status === 'idle';
  const isCustom = spec.id.startsWith('custom-');
  const labelText = isCustom ? 'Mission · Custom' : `Mission · ${spec.id}`;

  if (isIdle) {
    return (
      <div className="sc-mission">
        <div className="sc-mission__label">{labelText}</div>
        <div className="sc-mission__title">{spec.title}</div>
        <div className="sc-mission__brief">{spec.brief}</div>
        <div className="sc-mission__target">
          Target: {spec.targetRps} RPS · budget ${spec.winConditions.costMaxUsd}
        </div>
        <div className="sc-mission__hint">
          Build your topology, then press <strong>Start</strong> below.
        </div>
        <button
          type="button"
          className="sc-mission__change"
          onClick={clearMission}
        >
          ← Change mission
        </button>
      </div>
    );
  }

  let timerLine = '';
  if (isRamping) {
    const remaining = Math.max(
      0,
      Math.ceil((spec.rampSeconds * 1000 - (now - runtime.startedAt)) / 1000)
    );
    timerLine = `Ramping · ${remaining}s left`;
  } else if (isSustaining && runtime.sustainStartedAt !== null) {
    const elapsedSustain = Math.max(0, now - runtime.sustainStartedAt);
    const remaining = Math.max(
      0,
      Math.ceil((spec.sustainSeconds * 1000 - elapsedSustain) / 1000)
    );
    timerLine = `Sustaining · ${remaining}s left`;
  }

  const w = spec.winConditions;
  const p95Ok = (snapshot?.p95Ms ?? Infinity) <= w.p95MaxMs;
  const errOk = (snapshot?.errorPct ?? Infinity) <= w.errorMaxPct;
  const costOk = (snapshot?.costUsd ?? Infinity) <= w.costMaxUsd;
  const allHold = winConditionsHold(spec, snapshot);

  return (
    <div className="sc-mission">
      <div className="sc-mission__label">{labelText}</div>
      <div className="sc-mission__title">{spec.title}</div>
      <div className="sc-mission__brief">{spec.brief}</div>
      {timerLine ? <div className="sc-mission__timer">{timerLine}</div> : null}
      <div className="sc-mission__target">Target: {spec.targetRps} RPS</div>
      <div className="sc-mission__conds">
        <ConditionTile
          label={`p95 ≤ ${w.p95MaxMs}ms`}
          value={`${Math.round(snapshot?.p95Ms ?? 0)}ms`}
          ok={p95Ok}
        />
        <ConditionTile
          label={`errors ≤ ${w.errorMaxPct}%`}
          value={`${(snapshot?.errorPct ?? 0).toFixed(1)}%`}
          ok={errOk}
        />
        <ConditionTile
          label={`cost ≤ $${w.costMaxUsd}`}
          value={`$${Math.round(snapshot?.costUsd ?? 0)}`}
          ok={costOk}
        />
      </div>
      {isSustaining ? (
        <div className={`sc-mission__hold${allHold ? ' is-ok' : ''}`}>
          {allHold ? 'All conditions holding' : 'Waiting for all conditions'}
        </div>
      ) : null}
      {(isRamping || isSustaining) && (
        <button type="button" className="sc-btn sc-btn--danger" onClick={giveUp}>
          Give up
        </button>
      )}
    </div>
  );
}
