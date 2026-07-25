/** @type {import('tailwindcss').Config} */
module.exports = {
  // IMPORTANT: include EVERY source folder, otherwise classes used only in
  // one folder get purged (zerogram lesson #3).
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand accent - cyan/ice (distinct from the diagnostic green).
        // Aligned to the Midnight Monitor accent.
        brand: "#2ee6ff",
        brandDark: "#12c6e0", // pressed state
        // Glucose color language - MIRRORS lib/theme/tokens.ts GLUCOSE_COLORS
        // (the canonical source). Keep the two in sync. Midnight Monitor palette.
        low: "#ff5468", // rose - below the user's own low threshold
        normal: "#22e39a", // mint - in the target range
        elevated: "#ffd23f", // yellow - above the range (E1)
        high: "#ffa02a", // amber - well above the range
        veryHigh: "#ff8a00", // deep orange - at/above the fixed 250 mg/dL ceiling
        // Midnight Monitor glass surfaces (translucent over the app wash).
        glass: "rgba(255,255,255,0.05)",
        // OPAQUE elevated surface for center-popover modals (language / profile
        // pickers). A translucent glass here shows the screen behind it through the
        // dim overlay and becomes unreadable - popovers must be solid.
        sheet: "#16232e",
        hair: "rgba(255,255,255,0.10)",
        ink: "#eaf6fa",
        mut: "#89a3b0",
      },
    },
  },
  plugins: [],
};
