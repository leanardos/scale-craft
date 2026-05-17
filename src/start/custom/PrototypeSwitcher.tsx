// PROTOTYPE — floating bottom-center switcher. Dev only. Cycles ?variant=.
import { useEffect } from 'react';
import {
  VARIANT_KEYS,
  VARIANT_NAMES,
  VariantKey,
  parseVariant
} from './CustomMissionPrototype';

interface Props {
  variant: VariantKey;
  setVariant: (v: VariantKey) => void;
}

export function PrototypeSwitcher({ variant, setVariant }: Props) {
  if (!import.meta.env.DEV) return null;

  const idx = VARIANT_KEYS.indexOf(variant);
  const prev = () => setVariant(VARIANT_KEYS[(idx - 1 + VARIANT_KEYS.length) % VARIANT_KEYS.length]);
  const next = () => setVariant(VARIANT_KEYS[(idx + 1) % VARIANT_KEYS.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="proto-switcher" role="toolbar" aria-label="Prototype variant switcher">
      <button
        type="button"
        className="proto-switcher__btn"
        onClick={prev}
        aria-label="Previous variant"
      >
        ←
      </button>
      <div className="proto-switcher__label">
        <span className="proto-switcher__key">{variant}</span>
        <span className="proto-switcher__name">{VARIANT_NAMES[variant]}</span>
      </div>
      <button
        type="button"
        className="proto-switcher__btn"
        onClick={next}
        aria-label="Next variant"
      >
        →
      </button>
    </div>
  );
}

export { parseVariant };
