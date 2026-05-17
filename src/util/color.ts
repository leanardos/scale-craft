export function utilizationToHsl(u: number): string {
  const clamped = Math.min(1, Math.max(0, u));
  const hue = 120 - clamped * 120;
  return `hsl(${hue}, 80%, 50%)`;
}
