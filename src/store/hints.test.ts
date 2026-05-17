import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { useStore } from './useStore';
import {
  HINT_KEYS,
  HINT_STORAGE_KEY,
  loadSeenHints,
  writeSeenHints
} from './hints';

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v))
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true
  });
}

describe('hints', () => {
  beforeAll(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      installLocalStorageStub();
    }
  });

  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ seenHints: {} });
  });

  it('markHintSeen persists to localStorage', () => {
    useStore.getState().markHintSeen(HINT_KEYS.tutorialCompleted);
    expect(useStore.getState().seenHints[HINT_KEYS.tutorialCompleted]).toBe(true);
    const reloaded = loadSeenHints();
    expect(reloaded[HINT_KEYS.tutorialCompleted]).toBe(true);
  });

  it('markHintSeen is idempotent (no thrash if already seen)', () => {
    useStore.getState().markHintSeen(HINT_KEYS.saturation95);
    const ref = useStore.getState().seenHints;
    useStore.getState().markHintSeen(HINT_KEYS.saturation95);
    expect(useStore.getState().seenHints).toBe(ref);
  });

  it('resetHints clears storage and store state', () => {
    writeSeenHints({
      [HINT_KEYS.tutorialCompleted]: true,
      [HINT_KEYS.saturation95]: true
    });
    useStore.setState({ seenHints: loadSeenHints() });
    useStore.getState().resetHints();
    expect(useStore.getState().seenHints).toEqual({});
    expect(localStorage.getItem(HINT_STORAGE_KEY)).toBeNull();
  });

  it('loadSeenHints survives corrupt storage', () => {
    localStorage.setItem(HINT_STORAGE_KEY, '{not json');
    expect(loadSeenHints()).toEqual({});
  });

  it('loadSeenHints filters non-boolean values', () => {
    localStorage.setItem(
      HINT_STORAGE_KEY,
      JSON.stringify({ a: true, b: 'yes', c: 1, d: false })
    );
    expect(loadSeenHints()).toEqual({ a: true, d: false });
  });

  it('HINT_KEYS includes the keys named in the issue', () => {
    expect(HINT_KEYS.tutorialCompleted).toBeDefined();
    expect(HINT_KEYS.saturation95).toBeDefined();
    expect(HINT_KEYS.errorsAboveZero).toBeDefined();
    expect(HINT_KEYS.cacheDecision).toBeDefined();
    expect(HINT_KEYS.queueBackpressure).toBeDefined();
    expect(HINT_KEYS.replicationLag).toBeDefined();
    expect(HINT_KEYS.regionalOutage).toBeDefined();
  });
});
