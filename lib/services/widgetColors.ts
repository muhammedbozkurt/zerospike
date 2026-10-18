/* Android widget colours, one fixed palette per system ground. Independent of
 * the app theme module and the PDF palette on purpose: the widget follows the
 * SYSTEM theme (react-native-android-widget renders {light, dark} trees), not the
 * in-app appearance setting. DARK is the pre-K7 (cd0a140) look, verbatim. */

export interface WidgetPalette {
  bgFrom: string;
  bgTo: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentFill: string;
  onAccentFill: string;
  violet: string;
  caution: string;
  glucose: { low: string; target: string; high: string; wellAbove: string; veryHigh: string };
  tile: Record<
    "glucose" | "glucosePrimary" | "meal" | "injection" | "med" | "countdown",
    { fill: string; border: string }
  >;
  tileInk: { glucose: string; meal: string; injection: string; med: string };
}

/* Tile fills are the tint flattened over the ground (the widget colour parser
 * cannot read rgba): round(bg + (tint - bg) * alpha) per channel. Dark alphas
 * 0.16/0.34 (primary 0.22/0.44, countdown 0.14/0.28). Light uses the same
 * alphas except countdown 0.06/0.20, so accent text on the pill stays >= 4.5. */
export const WIDGET_DARK: WidgetPalette = {
  bgFrom: "#0f2029",
  bgTo: "#080e14",
  surface: "#16232e",
  ink: "#eaf6fa",
  muted: "#89a3b0",
  accent: "#2ee6ff",
  accentFill: "#2ee6ff",
  onAccentFill: "#04161d",
  violet: "#7c5cff",
  caution: "#ffa02a",
  glucose: {
    low: "#ff5468",
    target: "#22e39a",
    high: "#ffd23f",
    wellAbove: "#ffa02a",
    veryHigh: "#ff8a00",
  },
  tile: {
    glucose: { fill: "#0e313a", border: "#155764" },
    glucosePrimary: { fill: "#103e48", border: "#196d7b" },
    meal: { fill: "#0c3029", border: "#115642" },
    injection: { fill: "#1b1a3a", border: "#2f2964" },
    med: { fill: "#302518", border: "#5c401b" },
    countdown: { fill: "#0d2c35", border: "#134a56" },
  },
  tileInk: { glucose: "#2ee6ff", meal: "#22e39a", injection: "#7c5cff", med: "#ffa02a" },
};

export const WIDGET_LIGHT: WidgetPalette = {
  bgFrom: "#F5EFE6",
  bgTo: "#F5EFE6",
  surface: "#FFFFFF",
  ink: "#0F2230",
  muted: "#4A5D68",
  accent: "#087089",
  accentFill: "#0E9BB8",
  onAccentFill: "#0F2230",
  violet: "#5B3FE0",
  caution: "#8F5F00",
  glucose: {
    low: "#C42A44",
    target: "#0F6F4C",
    high: "#8A5F00",
    wellAbove: "#A84F00",
    veryHigh: "#B03A0A",
  },
  tile: {
    glucose: { fill: "#cfdbd7", border: "#a4c4c6" },
    glucosePrimary: { fill: "#c1d3d2", border: "#8db7bd" },
    meal: { fill: "#d0dbcd", border: "#a7c3b2" },
    injection: { fill: "#dcd3e5", border: "#c1b3e4" },
    med: { fill: "#e5d8c1", border: "#d2be98" },
    countdown: { fill: "#e7e7e0", border: "#c6d6d3" },
  },
  tileInk: { glucose: "#087089", meal: "#0F6F4C", injection: "#5B3FE0", med: "#8F5F00" },
};
