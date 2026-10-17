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
      // Every color reads a CSS variable that ThemeProvider sets from the active
      // palette (lib/theme/ThemeProvider.tsx), so className colors follow the
      // light/dark theme. Opaque tokens use channel triplets so `/opacity`
      // works; glass, hair and sheet are whole colors.
      colors: {
        brand: "rgb(var(--c-brand) / <alpha-value>)",
        brandDark: "rgb(var(--c-brandDark) / <alpha-value>)",
        onAccent: "rgb(var(--c-onAccent) / <alpha-value>)",
        dangerFill: "rgb(var(--c-dangerFill) / <alpha-value>)",
        onDanger: "rgb(var(--c-onDanger) / <alpha-value>)",
        low: "rgb(var(--c-low) / <alpha-value>)",
        normal: "rgb(var(--c-normal) / <alpha-value>)",
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        high: "rgb(var(--c-high) / <alpha-value>)",
        veryHigh: "rgb(var(--c-veryHigh) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        mut: "rgb(var(--c-mut) / <alpha-value>)",
        glass: "var(--c-glass)",
        sheet: "var(--c-sheet)",
        hair: "var(--c-hair)",
      },
    },
  },
  plugins: [],
};
