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
        low: "#ff5468", // rose - hypoglycemia (< 70 mg/dL)
        normal: "#22e39a", // mint - in range (target)
        elevated: "#ffb43c", // amber - above target
        high: "#ff7a3c", // orange - well above target
      },
    },
  },
  plugins: [],
};
