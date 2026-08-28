import type { Config } from "tailwindcss";

/**
 * Praxis Protocol design tokens.
 * Dark navy ground, cyan as the single accent, semantic colours reserved for
 * agent state (clean / disputed / slashed) so status reads at a glance.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#050912", // page ground
          900: "#0A1122", // panel ground
          850: "#0E1729", // raised panel
          800: "#131F36", // hover / input
          700: "#1B2B49", // border strong
          600: "#25395C", // border subtle on raised
        },
        cyan: {
          400: "#38E0F5",
          500: "#12C6E0",
          600: "#0AA3BC",
        },
        ink: {
          50: "#EAF2FB", // primary text
          200: "#A9BCD4", // secondary text
          400: "#6E829E", // muted / labels
          600: "#44566F", // disabled
        },
        state: {
          clean: "#34D399",
          disputed: "#FBBF24",
          slashed: "#FB7185",
          inactive: "#64748B",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(18,198,224,0.35), 0 0 24px -6px rgba(18,198,224,0.45)",
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.8)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(251,113,133,0.45)" },
          "70%": { boxShadow: "0 0 0 10px rgba(251,113,133,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(251,113,133,0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
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
