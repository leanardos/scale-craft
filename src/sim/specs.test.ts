import { describe, it, expect } from 'vitest';
import { isLegalEdge, NODE_SPECS } from './specs';
import { NodeType } from './types';

const types = Object.keys(NODE_SPECS) as NodeType[];

const legalPairs: Array<[NodeType, NodeType]> = [
  ['client', 'api'],
  ['client', 'lb'],
  ['client', 'cdn'],
  ['cdn', 'api'],
  ['cdn', 'lb'],
  ['cdn', 'cdn'],
  ['lb', 'api'],
  ['lb', 'lb'],
  ['lb', 'cdn'],
  ['api', 'postgres'],
  ['api', 'postgresReplica'],
  ['api', 'redis'],
  ['api', 'queue'],
  ['api', 'worker'],
  ['redis', 'postgres'],
  ['redis', 'postgresReplica'],
  ['queue', 'queue'],
  ['queue', 'worker'],
  ['worker', 'postgres'],
  ['worker', 'postgresReplica']
];

describe('isLegalEdge', () => {
  it('accepts every legal pair', () => {
    for (const [s, t] of legalPairs) expect(isLegalEdge(s, t)).toBe(true);
  });

  it('rejects every other pair', () => {
    for (const s of types) {
      for (const t of types) {
        if (legalPairs.some(([ls, lt]) => ls === s && lt === t)) continue;
        expect(isLegalEdge(s, t)).toBe(false);
      }
    }
  });

  it('rejects self-loops at type level (except tiered LB, chained queues, and chained CDNs)', () => {
    for (const s of types) {
      if (s === 'lb' || s === 'queue' || s === 'cdn') continue;
      expect(isLegalEdge(s, s)).toBe(false);
    }
  });
});
