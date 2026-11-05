import type { Config } from "tailwindcss";

// Every colour is a CSS variable (see app/globals.css), so light and dark mode
// swap in one place. Status colours stay the same in both modes.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: v("surface"),
        plane: v("plane"),
        field: v("field"),
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        line: v("line"),
        brand: { DEFAULT: v("brand"), dark: v("brand-dark"), soft: v("brand-soft") },
        good: "#0ca30c",
        goodText: v("good-text"),
        warn: "#fab219",
        warnText: v("warn-text"),
        serious: "#ec835a",
        crit: "#d03b3b",
        blockedText: v("blocked-text"),
      },
      fontFamily: { sans: ["system-ui", "-apple-system", '"Segoe UI"', "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
