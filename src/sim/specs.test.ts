import { describe, it, expect } from 'vitest';
import {
  isLegalEdge,
  NODE_SPECS,
  derivedHitRate,
  REDIS_TIER_MEMORY_BYTES
} from './specs';
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

describe('Redis tier memory map', () => {
  it('maps S/M/L/XL to 1/4/16/64 GB', () => {
    expect(REDIS_TIER_MEMORY_BYTES.S).toBe(1_000_000_000);
    expect(REDIS_TIER_MEMORY_BYTES.M).toBe(4_000_000_000);
    expect(REDIS_TIER_MEMORY_BYTES.L).toBe(16_000_000_000);
    expect(REDIS_TIER_MEMORY_BYTES.XL).toBe(64_000_000_000);
  });
});

describe('derivedHitRate (workingSet, cacheBytes, skew)', () => {
  it('heavy skew at f≈0.05 → hit ≥ ~0.85', () => {
    const ws = 1_000_000_000;
    const cache = 50_000_000; // f = 0.05
    expect(derivedHitRate(ws, cache, 'heavy')).toBeGreaterThanOrEqual(0.85);
  });

  it('flat skew at f≈0.05 → hit ≤ ~0.05', () => {
    const ws = 1_000_000_000;
    const cache = 50_000_000;
    expect(derivedHitRate(ws, cache, 'flat')).toBeLessThanOrEqual(0.06);
  });

  it('medium skew at f≈0.05 falls between flat and heavy', () => {
    const ws = 1_000_000_000;
    const cache = 50_000_000;
    const heavy = derivedHitRate(ws, cache, 'heavy');
    const medium = derivedHitRate(ws, cache, 'medium');
    const flat = derivedHitRate(ws, cache, 'flat');
    expect(medium).toBeGreaterThan(flat);
    expect(medium).toBeLessThan(heavy);
  });

  it('any skew at cacheBytes ≥ workingSet → hit ≥ ~0.99', () => {
    const ws = 1_000_000_000;
    for (const skew of ['heavy', 'medium', 'flat'] as const) {
      expect(derivedHitRate(ws, ws, skew)).toBeGreaterThanOrEqual(0.99);
      expect(derivedHitRate(ws, ws * 4, skew)).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('clamps to [0, 1] and treats zero working set as fully cacheable', () => {
    expect(derivedHitRate(0, 1_000_000, 'heavy')).toBeGreaterThanOrEqual(0.99);
    expect(derivedHitRate(1_000_000, 0, 'heavy')).toBe(0);
  });
});
