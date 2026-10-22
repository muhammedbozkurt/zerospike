// Pure Reduce Motion rules (no react-native import, so node tests can load it).
// Reduced: slides/scales/springs run instantly, opacity fades stay under 120 ms.
export const REDUCED_FADE_MS = 100;

export function motionDuration(reduced: boolean, ms: number): number {
  return reduced ? 0 : ms;
}

export function fadeDuration(reduced: boolean, ms: number): number {
  return reduced ? Math.min(ms, REDUCED_FADE_MS) : ms;
}

export function slideDistance(reduced: boolean, px: number): number {
  return reduced ? 0 : px;
}
