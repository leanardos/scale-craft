import { tick } from './core';
import { SimState } from './types';

let state: SimState | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let queueDepths: Record<string, number> = {};
let lastTickAt: number | null = null;

const TICK_MS = 100;

function startTicking() {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    if (!state) return;
    const now = Date.now();
    const dtMs = lastTickAt === null ? 0 : Math.max(0, now - lastTickAt);
    const snapshot = tick(state, now, queueDepths, dtMs);
    queueDepths = snapshot.queueDepthByNodeId;
    lastTickAt = now;
    (self as unknown as Worker).postMessage(snapshot);
  }, TICK_MS);
}

function stopTicking() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as
    | { type: 'init'; state: SimState }
    | { type: 'updateState'; state: SimState }
    | { type: 'pause' }
    | { type: 'resume' }
    | { type: 'reset' }
    | { type: 'stop' };

  if (msg.type === 'init') {
    state = msg.state;
    queueDepths = {};
    lastTickAt = null;
    stopTicking();
    startTicking();
  } else if (msg.type === 'updateState') {
    state = msg.state;
  } else if (msg.type === 'reset') {
    queueDepths = {};
    lastTickAt = null;
  } else if (msg.type === 'pause') {
    stopTicking();
    lastTickAt = null;
  } else if (msg.type === 'resume') {
    startTicking();
  } else if (msg.type === 'stop') {
    stopTicking();
  }
};
