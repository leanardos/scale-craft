import { useStore, DIAL_MIN, DIAL_MAX } from '../store/useStore';

export function TrafficDial() {
  const rps = useStore((s) => s.rps);
  const setRps = useStore((s) => s.setRps);
  const readPct = useStore((s) => s.readPct);
  const setReadPct = useStore((s) => s.setReadPct);
  const status = useStore((s) => s.missionRuntime.status);
  const locked = status === 'ramping' || status === 'sustaining';
  return (
    <div className="sc-dial">
      <div className="sc-dial__header">
        <span className="sc-dial__label">
          Traffic{locked ? ' · locked' : ''}
        </span>
        <span className="sc-dial__value">{rps.toLocaleString()} RPS</span>
      </div>
      <input
        className="sc-dial__slider"
        type="range"
        min={DIAL_MIN}
        max={DIAL_MAX}
        step={10}
        value={rps}
        disabled={locked}
        onChange={(e) => setRps(Number(e.target.value))}
      />
      <div className="sc-dial__scale">
        <span>{DIAL_MIN}</span>
        <span>{DIAL_MAX.toLocaleString()}</span>
      </div>

      <div className="sc-dial__split">
        <div className="sc-dial__split-header">
          <span className="sc-dial__label">% reads</span>
          <span className="sc-dial__value">
            {readPct}% / {100 - readPct}%
          </span>
        </div>
        <input
          className="sc-dial__slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={readPct}
          disabled={locked}
          onChange={(e) => setReadPct(Number(e.target.value))}
        />
        <div className="sc-dial__scale">
          <span>0% reads</span>
          <span>100% reads</span>
        </div>
      </div>
    </div>
  );
}
