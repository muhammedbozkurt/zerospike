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
        // Brand accent — cyan/ice (distinct from the diagnostic green).
        brand: "#22d3ee", // cyan-400
        brandDark: "#0891b2", // cyan-600 (pressed state)
        // Glucose color language — MIRRORS lib/theme/tokens.ts GLUCOSE_COLORS
        // (the canonical source). Keep the two in sync.
        low: "#ef4444", // red-500     — hypoglycemia (< 70 mg/dL)
        normal: "#10b981", // emerald-500 — in range (target)
        elevated: "#f59e0b", // amber-500  — above target
        high: "#f97316", // orange-500  — well above target
      },
    },
  },
  plugins: [],
};
