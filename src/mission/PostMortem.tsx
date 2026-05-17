import { useStore } from '../store/useStore';
import { decisiveDecision } from '../sim/mission';
import { NODE_SPECS } from '../sim/specs';
import { MISSIONS } from '../missions';

export function PostMortem() {
  const spec = useStore((s) => s.missionSpec);
  const runtime = useStore((s) => s.missionRuntime);
  const nodes = useStore((s) => s.nodes);
  const startMission = useStore((s) => s.startMission);
  const endMissionToIdle = useStore((s) => s.endMissionToIdle);
  const selectMission = useStore((s) => s.selectMission);
  const clearMission = useStore((s) => s.clearMission);

  if (!spec) return null;
  if (runtime.status !== 'won' && runtime.status !== 'lost') return null;

  const currentIdx = MISSIONS.findIndex((m) => m.id === spec.id);
  const nextSpec =
    currentIdx >= 0 && currentIdx < MISSIONS.length - 1
      ? MISSIONS[currentIdx + 1]
      : null;

  const currentTopologyCost = nodes.reduce(
    (sum, n) => sum + NODE_SPECS[n.data.type].costPerMonthUsd,
    0
  );
  const overBudget = currentTopologyCost > spec.winConditions.costMaxUsd;

  const won = runtime.status === 'won';
  const finalSnap = runtime.finalSnapshot;
  const decision = decisiveDecision(spec, runtime);

  let lossLine = '';
  switch (runtime.lossReason) {
    case 'errors':
      lossLine = 'Errors stayed above 50% for 5 seconds.';
      break;
    case 'budget':
      lossLine = `Budget exceeded ($${spec.winConditions.costMaxUsd}/mo).`;
      break;
    case 'give-up':
      lossLine = 'You gave up.';
      break;
    default:
      lossLine = '';
  }

  return (
    <div className="sc-postmortem">
      <div className="sc-postmortem__card">
        <div className={`sc-postmortem__verdict${won ? ' is-won' : ' is-lost'}`}>
          {won ? 'Mission complete' : 'Mission failed'}
        </div>
        <div className="sc-postmortem__title">{spec.title}</div>
        {!won && lossLine ? (
          <div className="sc-postmortem__reason">{lossLine}</div>
        ) : null}
        {finalSnap ? (
          <div className="sc-postmortem__metrics">
            <div>
              <span>p95</span>
              <strong>{Math.round(finalSnap.p95Ms)}ms</strong>
            </div>
            <div>
              <span>errors</span>
              <strong>{finalSnap.errorPct.toFixed(2)}%</strong>
            </div>
            <div>
              <span>cost</span>
              <strong>${Math.round(finalSnap.costUsd)}/mo</strong>
            </div>
          </div>
        ) : null}
        {decision ? (
          <div className="sc-postmortem__callout">{decision.message}</div>
        ) : null}
        {overBudget ? (
          <div className="sc-postmortem__hint">
            Your current topology costs ${currentTopologyCost}/mo — over the $
            {spec.winConditions.costMaxUsd} budget. Edit the canvas to remove
            components before retrying.
          </div>
        ) : null}
        <div className="sc-postmortem__actions">
          <button
            type="button"
            className="sc-btn"
            onClick={endMissionToIdle}
          >
            Edit topology
          </button>
          <button
            type="button"
            className="sc-btn sc-btn--start"
            disabled={overBudget}
            onClick={startMission}
            title={
              overBudget
                ? 'Reduce topology cost below budget before retrying'
                : undefined
            }
          >
            Try again
          </button>
          {won && nextSpec ? (
            <button
              type="button"
              className="sc-btn sc-btn--next"
              onClick={() => selectMission(nextSpec)}
              title={`Move on to "${nextSpec.title}"`}
            >
              Next mission →
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="sc-postmortem__menu-link"
          onClick={clearMission}
        >
          ← Back to menu
        </button>
      </div>
    </div>
  );
}
