import { MissionSpec } from '../sim/mission';
import userService1k from './user-service-1k.json';
import orders5kWrites from './orders-5k-writes.json';
import ingest100kBurst from './ingest-100k-burst.json';
import timelineStaleReads from './timeline-stale-reads.json';
import surviveRegionOutage from './survive-region-outage.json';
import p95Marathon from './p95-marathon.json';

export const MISSIONS: MissionSpec[] = [
  userService1k as MissionSpec,
  orders5kWrites as MissionSpec,
  ingest100kBurst as MissionSpec,
  timelineStaleReads as MissionSpec,
  surviveRegionOutage as MissionSpec,
  p95Marathon as MissionSpec
];

export function findMission(id: string): MissionSpec | undefined {
  return MISSIONS.find((m) => m.id === id);
}
