import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Gotham", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // SoE Legacy Magenta — primary brand scale
        primary: {
          50:  "#fce8f3",
          100: "#f9c5e4",
          200: "#f490c9",
          300: "#ef5baf",
          400: "#EC008C",
          500: "#d4007e",
          600: "#A70063",
          700: "#7d004a",
          800: "#540031",
          900: "#2b0019",
          950: "#15000c",
        },
        // Warm neutral scale (slight magenta undertone)
        neutral: {
          50:  "#faf8fb",
          100: "#f3f0f5",
          200: "#e8e0ec",
          300: "#d4c9db",
          400: "#b09dbf",
          500: "#8a7399",
          600: "#6b5880",
          700: "#4e3e63",
          800: "#342848",
          900: "#1e1430",
          950: "#0f0a18",
        },
        // Semantic status palette
        brand: {
          magenta:      "#EC008C",
          "magenta-dark": "#A70063",
          blue:         "#0076A3",
          orange:       "#F26522",
          green:        "#39B54A",
          "green-dark": "#14732C",
          teal:         "#00AAAD",
          chrome:       "#FFC20E",
          purple:       "#9A258F",
        },
      },
      boxShadow: {
        card:       "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)",
        "card-hover": "0 4px 16px rgba(236,0,140,0.08), 0 1px 4px rgba(0,0,0,0.06)",
        "primary":  "0 4px 14px rgba(236,0,140,0.28)",
      },
    },
  },
  plugins: [],
} satisfies Config;
