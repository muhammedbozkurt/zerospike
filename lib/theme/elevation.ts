export type ElevationKind = "card" | "sheet" | "popover";

const VALUES = {
  light: {
    card: { shadowColor: "#0F2230", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
    sheet: { shadowColor: "#0F2230", shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 10 },
  },
  dark: {
    card: { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
    sheet: { shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 12 },
  },
} as const;

/** Android paints `elevation` as a flat grey frame in light theme, so there the
 *  surface gets no elevation and a thin border instead. Everything else keeps
 *  its shadow/elevation values. */
export function elevationFor(kind: ElevationKind, scheme: "light" | "dark", os: string, edge: string): Record<string, unknown> {
  if (os === "android" && scheme === "light") {
    return kind === "sheet"
      ? { elevation: 0, borderTopWidth: 1, borderColor: edge }
      : { elevation: 0, borderWidth: 1, borderColor: edge };
  }
  if (kind === "popover") return { elevation: 16 };
  return { ...VALUES[scheme][kind] };
}
