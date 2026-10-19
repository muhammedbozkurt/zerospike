import { HIT_TARGET, TYPE, type Palette } from "./tokens";

/**
 * Pure mapping logic behind components/ui.tsx (no react-native import, so
 * scripts/uiPrimitives.test.ts can run it in plain Node).
 *
 * Legacy variant names (ghost, danger) keep their exact class strings and
 * behavior; the canonical names (tertiary, destructive, outlined) are what new
 * and migrated screens use. A screen only changes look when it switches name.
 */

export type LegacyButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type CanonicalButtonVariant = "primary" | "outlined" | "tertiary" | "destructive";
export type ButtonVariant = LegacyButtonVariant | CanonicalButtonVariant;
export type ButtonSize = "lg" | "md" | "sm";

/** Names that opt in to the new press feedback (Android ripple) and the
 *  44 pt hit target by default. Legacy names stay byte-identical. */
const NEW_NAMES: readonly ButtonVariant[] = ["outlined", "tertiary", "destructive"];

export function isCanonicalVariant(v: ButtonVariant): boolean {
  return NEW_NAMES.includes(v);
}

/** ghost -> tertiary, danger -> destructive. `secondary` stays the legacy
 *  unframed look; the framed secondary is `outlined`. */
export function canonicalVariant(v: ButtonVariant): CanonicalButtonVariant | "secondary" {
  if (v === "ghost") return "tertiary";
  if (v === "danger") return "destructive";
  return v;
}

export const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: "bg-brand active:bg-brandDark",
  secondary: "bg-glass active:opacity-80",
  danger: "bg-low/15 active:opacity-80 border border-low/40",
  ghost: "bg-transparent active:opacity-80",
  outlined: "bg-transparent active:opacity-80 border border-hair",
  tertiary: "bg-transparent active:opacity-80",
  destructive: "bg-low/15 active:opacity-80 border border-low/40",
};

export const VARIANT_TEXT: Record<ButtonVariant, string> = {
  primary: "text-onAccent",
  secondary: "text-ink",
  danger: "text-low",
  ghost: "text-mut",
  outlined: "text-ink",
  tertiary: "text-mut",
  destructive: "text-low",
};

export const SIZE_PAD: Record<ButtonSize, string> = {
  lg: "py-4 px-5",
  md: "py-3 px-4",
  sm: "py-2 px-3",
};

export const SIZE_TEXT: Record<ButtonSize, string> = {
  lg: "text-base",
  md: "text-base",
  sm: "text-sm",
};

/** Rendered height of a Button: vertical padding x2 + the text-base (24) or
 *  text-sm (20) line height. Border adds nothing the hit slop must cover. */
export const BUTTON_VISUAL_HEIGHT: Record<ButtonSize, number> = {
  lg: 16 * 2 + 24,
  md: 12 * 2 + 24,
  sm: 8 * 2 + 20,
};

/** Hit slop on one axis that lifts a visual extent to the 44 pt minimum.
 *  Slop never changes layout or paint, only the touch area. */
export function hitSlopFor(visual: number, min: number = HIT_TARGET): number {
  return visual >= min ? 0 : Math.ceil((min - visual) / 2);
}

export function buttonHitSlop(size: ButtonSize): { top: number; bottom: number } | undefined {
  const s = hitSlopFor(BUTTON_VISUAL_HEIGHT[size]);
  return s > 0 ? { top: s, bottom: s } : undefined;
}

export function buttonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  isOff: boolean,
  extra: string = "",
): string {
  return `flex-row items-center justify-center rounded-2xl ${SIZE_PAD[size]} ${VARIANT_BG[variant]} ${isOff ? "opacity-50" : ""} ${extra}`;
}

export function buttonTextClassName(variant: ButtonVariant, size: ButtonSize): string {
  return `font-semibold ${SIZE_TEXT[size]} ${VARIANT_TEXT[variant]}`;
}

/** Palette keys that paint a variant. The Android ripple takes `ripple` at
 *  `RIPPLE_ALPHA`; the color itself is resolved by the caller from the live
 *  palette so the test can check it per scheme. */
export interface VariantColors {
  fill: string | "transparent";
  border: string | "transparent";
  text: string;
  ripple: string;
}

export function resolveVariantColors(variant: ButtonVariant, p: Palette): VariantColors {
  switch (canonicalVariant(variant)) {
    case "primary":
      return { fill: p.accentFill, border: "transparent", text: p.accentOnFill, ripple: p.accentOnFill };
    case "outlined":
      return { fill: "transparent", border: p.border, text: p.text, ripple: p.text };
    case "tertiary":
      return { fill: "transparent", border: "transparent", text: p.textMuted, ripple: p.textMuted };
    case "destructive":
      return { fill: "transparent", border: p.danger, text: p.danger, ripple: p.danger };
    case "secondary":
      return { fill: p.surface, border: "transparent", text: p.text, ripple: p.text };
  }
}

export const RIPPLE_ALPHA = 0.16;

/* Typography: five steps. title = TYPE.title2, subtitle = title3, body, caption, micro. */
export type TextKind = "title" | "subtitle" | "body" | "caption" | "micro";

export const TEXT_KIND_STYLE = {
  title: TYPE.title2,
  subtitle: TYPE.title3,
  body: TYPE.body,
  caption: TYPE.caption,
  micro: TYPE.micro,
} as const;

export type TextTone = "text" | "muted" | "accent" | "danger" | "success" | "onAccent";

export function toneColor(tone: TextTone, p: Palette): string {
  switch (tone) {
    case "text":
      return p.text;
    case "muted":
      return p.textMuted;
    case "accent":
      return p.accent;
    case "danger":
      return p.danger;
    case "success":
      return p.success;
    case "onAccent":
      return p.accentOnFill;
  }
}

/* Chip: text-sm (20) + py-2 (16) = 36 visual. */
export const CHIP_VISUAL_HEIGHT = 36;

export function chipClassName(selected: boolean): string {
  return `flex-row items-center justify-center rounded-full px-3.5 py-2 border ${
    selected ? "bg-brand border-brand" : "bg-glass border-hair"
  }`;
}

export function chipTextClassName(selected: boolean): string {
  return `text-sm font-medium ${selected ? "text-onAccent" : "text-mut"}`;
}

/** Row: minHeight floor (icon plate 36 + 12/12 padding). */
export const ROW_MIN_HEIGHT = 60;
export const ROW_PLATE = 36;
