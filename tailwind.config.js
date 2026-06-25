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
        // Diagnostic highlights (semantic glucose status — never rebranded).
        low: "#3b82f6", // blue-500      — hypoglycemia (< 70 mg/dL)
        normal: "#10b981", // emerald-500  — in range
        elevated: "#f59e0b", // amber-500   — elevated
        high: "#f43f5e", // rose-500       — high
      },
    },
  },
  plugins: [],
};
