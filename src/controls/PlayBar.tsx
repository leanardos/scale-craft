import { useStore } from '../store/useStore';

export function PlayBar() {
  const spec = useStore((s) => s.missionSpec);
  const status = useStore((s) => s.missionRuntime.status);
  const paused = useStore((s) => s.paused);
  const setPaused = useStore((s) => s.setPaused);
  const startMission = useStore((s) => s.startMission);
  const endMissionToIdle = useStore((s) => s.endMissionToIdle);

  if (!spec) return null;
  if (status === 'won' || status === 'lost') return null;

  const isRunning = status === 'ramping' || status === 'sustaining';
  const isIdle = status === 'idle';

  return (
    <div className="sc-playbar" role="toolbar" aria-label="Mission controls">
      <button
        type="button"
        className="sc-playbar__btn sc-playbar__btn--primary"
        disabled={!isIdle}
        onClick={startMission}
        title="Start mission (begin ramping load)"
      >
        <span className="sc-playbar__icon">▶</span>
        <span>Start</span>
      </button>
      <button
        type="button"
        className="sc-playbar__btn"
        disabled={!isRunning}
        onClick={() => setPaused(!paused)}
        title={paused ? 'Resume simulation' : 'Pause simulation'}
      >
        <span className="sc-playbar__icon">{paused ? '▶' : '❚❚'}</span>
        <span>{paused ? 'Resume' : 'Pause'}</span>
      </button>
      <button
        type="button"
        className="sc-playbar__btn"
        onClick={endMissionToIdle}
        title={
          isRunning
            ? 'Stop run and reset metrics (keeps topology)'
            : 'Clear metrics'
        }
      >
        <span className="sc-playbar__icon">↺</span>
        <span>Reset</span>
      </button>
    </div>
  );
}
