import { MissionSpec, parseMission } from '../sim/mission';
import userService1k from './user-service-1k.json';
import orders5kWrites from './orders-5k-writes.json';
import ingest100kBurst from './ingest-100k-burst.json';
import timelineStaleReads from './timeline-stale-reads.json';
import surviveRegionOutage from './survive-region-outage.json';
import p95Marathon from './p95-marathon.json';

export const MISSIONS: MissionSpec[] = [
  userService1k,
  orders5kWrites,
  ingest100kBurst,
  timelineStaleReads,
  surviveRegionOutage,
  p95Marathon
].map(parseMission);

export function findMission(id: string): MissionSpec | undefined {
  return MISSIONS.find((m) => m.id === id);
}
