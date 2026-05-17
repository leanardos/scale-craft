// PROTOTYPE — variant router for custom mission setup.
import { VariantA_Wizard } from './VariantA_Wizard';
import { VariantB_Form } from './VariantB_Form';
import { VariantC_Workbench } from './VariantC_Workbench';

export const VARIANT_KEYS = ['A', 'B', 'C'] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];
export const VARIANT_NAMES: Record<VariantKey, string> = {
  A: 'Grill-me wizard',
  B: 'Spec sheet',
  C: 'Live workbench'
};

export function parseVariant(raw: string | null): VariantKey {
  if (raw === 'A' || raw === 'B' || raw === 'C') return raw;
  return 'A';
}

interface Props {
  variant: VariantKey;
  onExit: () => void;
}

export function CustomMissionPrototype({ variant, onExit }: Props) {
  if (variant === 'A') return <VariantA_Wizard onExit={onExit} />;
  if (variant === 'B') return <VariantB_Form onExit={onExit} />;
  return <VariantC_Workbench onExit={onExit} />;
}
