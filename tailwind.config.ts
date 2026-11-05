import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#fcfcfb",
        plane: "#f6f6f3",
        ink: { DEFAULT: "#0b0b0b", 2: "#52514e", 3: "#898781" },
        line: "#e1e0d9",
        brand: { DEFAULT: "#2a78d6", dark: "#1c5cab", soft: "#e8f1fc" },
        good: "#0ca30c", goodText: "#006300", warn: "#fab219", serious: "#ec835a", crit: "#d03b3b",
      },
      fontFamily: { sans: ['system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
