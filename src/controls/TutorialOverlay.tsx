import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { HINT_KEYS } from '../store/hints';

interface Step {
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: '1. The canvas',
    body:
      "This is your topology canvas. You'll drop components here and wire them together. Pan with drag, zoom with scroll, click anything to inspect it."
  },
  {
    title: '2. Drag a Client from the palette',
    body:
      "On the right, the Palette has all the components you can build with. Drag a Client onto the canvas — Clients are the source of incoming traffic."
  },
  {
    title: '3. Drag an API node',
    body:
      "Now drag an API node next to the Client. The API takes the request and (eventually) calls a database to answer it."
  },
  {
    title: '4. Connect them',
    body:
      "Drag from the right edge of the Client to the left edge of the API to create an edge. Edges show the request flow; only legal connections are allowed."
  },
  {
    title: '5. Move the dial',
    body:
      "The Traffic dial controls how many requests per second the Client sends. Crank it up — watch the API ring fill, then redden as it saturates."
  },
  {
    title: '6. Watch the dashboard',
    body:
      "The bottom dashboard shows total RPS, p95 latency, error rate, and cost. Pick a mission from the Mission panel when you want a goal to play against."
  }
];

export function TutorialOverlay() {
  const seenHints = useStore((s) => s.seenHints);
  const markHintSeen = useStore((s) => s.markHintSeen);
  const [step, setStep] = useState(0);

  const visible = !seenHints[HINT_KEYS.tutorialCompleted];

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setStep((s) => {
          if (s >= STEPS.length - 1) {
            markHintSeen(HINT_KEYS.tutorialCompleted);
            return s;
          }
          return s + 1;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, markHintSeen]);

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step >= STEPS.length - 1;

  const onNext = () => {
    if (isLast) {
      markHintSeen(HINT_KEYS.tutorialCompleted);
      return;
    }
    setStep(step + 1);
  };

  const onSkip = () => {
    markHintSeen(HINT_KEYS.tutorialCompleted);
  };

  return (
    <div className="sc-tutorial" role="dialog" aria-label="Tutorial">
      <div className="sc-tutorial__head">
        <div className="sc-tutorial__progress">
          Step {step + 1} of {STEPS.length}
        </div>
        <button type="button" className="sc-tutorial__skip" onClick={onSkip}>
          Skip tutorial
        </button>
      </div>
      <div className="sc-tutorial__title">{current.title}</div>
      <div className="sc-tutorial__body">{current.body}</div>
      <div className="sc-tutorial__actions">
        <button type="button" className="sc-btn" onClick={onNext}>
          {isLast ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
}
