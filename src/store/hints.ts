export const HINT_STORAGE_KEY = 'scalecraft.hints.v1';

export const HINT_KEYS = {
  tutorialCompleted: 'tutorial.completed',
  saturation95: 'learn.saturation95',
  errorsAboveZero: 'learn.errorsAboveZero',
  cacheDecision: 'learn.cacheDecision',
  queueBackpressure: 'learn.queueBackpressure',
  replicationLag: 'learn.replicationLag',
  regionalOutage: 'learn.regionalOutage'
} as const;

export type HintKey = (typeof HINT_KEYS)[keyof typeof HINT_KEYS];

export type SeenHints = Record<string, boolean>;

export function loadSeenHints(): SeenHints {
  try {
    const raw = localStorage.getItem(HINT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: SeenHints = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSeenHints(seen: SeenHints): void {
  try {
    localStorage.setItem(HINT_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // ignore
  }
}

export function clearSeenHints(): void {
  try {
    localStorage.removeItem(HINT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
