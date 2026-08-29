import type { Config } from "tailwindcss";

/**
 * Praxis Protocol design tokens — bright, minimal.
 *
 * Warm off-white ground, white cards, hairline rules, near-black ink and a
 * single confident blue accent. Colour is spent only on state (clean /
 * disputed / slashed) and the accent; everything else is paper and ink.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          0: "#FFFFFF", // cards, raised surfaces
          50: "#FBFBF9", // page ground, warm off-white
          100: "#F5F5F2", // subtle fill, hover, inputs
          200: "#EDEDE9", // stronger fill
        },
        line: {
          200: "#F0F0EC", // faintest divider
          300: "#E4E4DE", // default hairline
          400: "#D5D5CD", // stronger edge
        },
        ink: {
          900: "#14161A", // primary text
          800: "#2A2E35",
          600: "#545A63", // secondary text — 6.7:1 on paper
          500: "#6A6F78", // muted labels — 4.9:1, clears AA at small sizes
          400: "#838890", // faint, disabled — 3.4:1, large/decorative only
        },
        accent: {
          50: "#EFF4FF",
          100: "#DEE8FF",
          400: "#6E9BFF",
          500: "#2F6BFF", // fills, marks
          600: "#1D4FD8", // small text, links — carries contrast on white
        },
        state: {
          clean: "#067A54",
          disputed: "#B45309",
          slashed: "#C2264B",
          inactive: "#8A8A85",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        tighter: "-0.03em",
        tight: "-0.018em",
      },
      boxShadow: {
        // Minimal elevation: a hairline plus a whisper of shadow, never a slab.
        card: "0 1px 2px rgba(20,22,26,0.04), 0 1px 1px rgba(20,22,26,0.02)",
        lift: "0 12px 32px -14px rgba(20,22,26,0.18), 0 2px 6px -2px rgba(20,22,26,0.06)",
        focus: "0 0 0 3px rgba(47,107,255,0.18)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(194,38,75,0.28)" },
          "70%": { boxShadow: "0 0 0 10px rgba(194,38,75,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(194,38,75,0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in-up": "fade-in-up 320ms cubic-bezier(0.16,1,0.3,1) both",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
