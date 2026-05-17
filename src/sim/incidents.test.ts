import { describe, it, expect } from 'vitest';
import {
  computeEffects,
  Incident,
  KILL_IMPACT_MS,
  KILL_RECOVERY_MS,
  DDOS_MULTIPLIER,
  SLOW_QUERY_MULTIPLIER
} from './incidents';

describe('incident engine', () => {
  it('kill-postgres forces 100% errors throughout the impact window', () => {
    const inc: Incident = { kind: 'kill-postgres', startedAt: 1000 };
    expect(computeEffects([inc], 1000).errorOverrideByType.postgres).toBe(1);
    expect(
      computeEffects([inc], 1000 + KILL_IMPACT_MS - 1).errorOverrideByType
        .postgres
    ).toBe(1);
  });

  it('kill-postgres decays linearly over the recovery window', () => {
    const inc: Incident = { kind: 'kill-postgres', startedAt: 0 };
    const mid = computeEffects(
      [inc],
      KILL_IMPACT_MS + KILL_RECOVERY_MS / 2
    ).errorOverrideByType.postgres;
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it('kill-postgres is fully expired after impact + recovery', () => {
    const inc: Incident = { kind: 'kill-postgres', startedAt: 0 };
    const after = computeEffects(
      [inc],
      KILL_IMPACT_MS + KILL_RECOVERY_MS + 1
    ).errorOverrideByType.postgres;
    expect(after).toBeUndefined();
  });

  it('ddos multiplies rps for its duration', () => {
    const inc: Incident = { kind: 'ddos', startedAt: 0 };
    expect(computeEffects([inc], 5_000).rpsMultiplier).toBe(DDOS_MULTIPLIER);
    expect(computeEffects([inc], 11_000).rpsMultiplier).toBe(1);
  });

  it('two simultaneous incidents compose without interfering', () => {
    const incidents: Incident[] = [
      { kind: 'kill-postgres', startedAt: 0 },
      { kind: 'slow-query', startedAt: 0 }
    ];
    const eff = computeEffects(incidents, 1_000);
    expect(eff.errorOverrideByType.postgres).toBe(1);
    expect(eff.latencyMultiplierByType.postgres).toBe(SLOW_QUERY_MULTIPLIER);
  });

  it('cache-poison forces redis hit rate to 0 for its window', () => {
    const inc: Incident = { kind: 'cache-poison', startedAt: 0 };
    expect(computeEffects([inc], 5_000).hitRateOverrideByType.redis).toBe(0);
    expect(
      computeEffects([inc], 16_000).hitRateOverrideByType.redis
    ).toBeUndefined();
  });
});
