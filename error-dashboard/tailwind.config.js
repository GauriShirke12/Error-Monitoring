/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#080112",
          subtle: "#130633",
        },
        accent: {
          DEFAULT: "#8b5cf6",
          soft: "#a855f7",
          muted: "#4c1d95",
        },
        surface: {
          DEFAULT: "rgba(23, 9, 49, 0.7)",
          soft: "rgba(12, 3, 28, 0.75)",
        },
        outline: {
          glow: "rgba(168, 85, 247, 0.35)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

