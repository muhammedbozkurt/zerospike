/**
 * Midnight Monitor signature components - the rich visual vocabulary approved in
 * docs/design/redesign-mockup.html (direction B). Screens compose these instead
 * of hand-rolling gradients/glows, so the whole app reads as one lit data panel.
 */
export { AppBackground } from "./AppBackground";
export { GlassCard, withAlpha } from "./GlassCard";
export { GlucoseRing } from "./GlucoseRing";
export { TIRDonut, tirSegments } from "./TIRDonut";
export type { DonutSegment } from "./TIRDonut";
export { GradientAreaChart } from "./GradientAreaChart";
export { NeonProgressBar } from "./NeonProgressBar";
export { ConicAvatar } from "./ConicAvatar";
export { IconTile } from "./IconTile";
export { GlucoseChip } from "./GlucoseChip";
export { GradientCTA } from "./GradientCTA";
export * from "./svgGeom";
