import { useStore, HISTORY_WINDOW_MS } from '../store/useStore';

export function TimeScrubber() {
  const offsetMs = useStore((s) => s.historyOffsetMs);
  const setOffsetMs = useStore((s) => s.setHistoryOffsetMs);
  const liveTimestamp = useStore((s) => s.snapshot?.timestamp ?? 0);
  const historyLen = useStore((s) => s.snapshotHistory.length);

  const scrubbed = offsetMs > 0;
  const offsetSec = (offsetMs / 1000).toFixed(1);
  const sliderValue = HISTORY_WINDOW_MS - offsetMs;

  const onPointerUp = () => {
    setOffsetMs(0);
  };

  return (
    <div className="sc-scrubber">
      <button
        type="button"
        className={`sc-btn sc-scrubber__btn${scrubbed ? '' : ' is-active'}`}
        onClick={() => setOffsetMs(0)}
        aria-label="Snap to live"
      >
        Live
      </button>
      <input
        type="range"
        className="sc-scrubber__slider"
        min={0}
        max={HISTORY_WINDOW_MS}
        step={100}
        value={sliderValue}
        onChange={(e) =>
          setOffsetMs(HISTORY_WINDOW_MS - Number(e.target.value))
        }
        onPointerUp={onPointerUp}
        disabled={historyLen < 2 && liveTimestamp === 0}
      />
      <div className="sc-scrubber__readout">
        {scrubbed ? `−${offsetSec}s` : 'Live'}
      </div>
    </div>
  );
}
