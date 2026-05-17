import { useStore } from '../store/useStore';
import { TrafficDial } from './TrafficDial';
import { Palette } from './Palette';
import { IncidentsPanel } from './IncidentsPanel';
import { TopologyPanel } from './TopologyPanel';
import { MissionPanel } from '../mission/MissionPanel';

export function Sidebar() {
  const resetHints = useStore((s) => s.resetHints);
  return (
    <aside className="sc-sidebar">
      <h1 className="sc-sidebar__title">ScaleCraft</h1>
      <MissionPanel />
      <TrafficDial />
      <div className="sc-sidebar__row">
        <Palette />
        <IncidentsPanel />
      </div>
      <TopologyPanel />
      <button type="button" className="sc-sidebar__hints" onClick={resetHints}>
        Reset hints
      </button>
    </aside>
  );
}
