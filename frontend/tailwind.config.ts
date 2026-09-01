import type { Config } from "tailwindcss";

/**
 * Praxis Protocol design tokens — glass on a deep ground.
 *
 * The surface language is frosted glass: translucent planes that let the
 * aurora backdrop bleed through, separated by light hairlines rather than
 * shadows. That only works if the ground underneath has real luminance
 * variation for `backdrop-blur` to pick up — hence the deep, non-flat base and
 * the drifting colour blooms in <ParallaxBackground />.
 *
 * The scales stay role-based, so a token means the same thing it always did:
 *   paper  0 → 200   rising surface elevation (ground is `void`, cards climb)
 *   ink  900 → 400   falling text emphasis (900 is the brightest, 400 faintest)
 *   line 200 → 400   rising border strength
 *
 * Contrast: ink-900/800/600 clear AA on the glass fills at body sizes; ink-400
 * is decorative or large-only. Every state colour is the *dark-ground* variant
 * — the light-theme greens and reds sat under 3:1 against this base.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The ground itself. Not black — a deep blue-violet, so the blooms
        // read as light in the room rather than as stickers on a flat plane.
        void: {
          900: "#05060D", // deepest, page ground
          800: "#0A0C17",
          700: "#111426",
        },
        // Glass surfaces. These are the *fill* under the blur; alpha is applied
        // at use sites so the backdrop shows through.
        paper: {
          0: "#FFFFFF", // used only at low alpha, as the glass tint
          50: "#05060D", // page ground (matches void-900)
          100: "#151829", // solid fallback fill where blur is unavailable
          200: "#1D2136", // stronger fill, inputs, pressed states
        },
        line: {
          200: "rgba(255,255,255,0.06)", // faintest divider
          300: "rgba(255,255,255,0.10)", // default hairline
          400: "rgba(255,255,255,0.18)", // stronger edge, hover
        },
        ink: {
          900: "#F4F6FF", // primary text — 16.8:1 on the ground
          800: "#DDE2F2",
          600: "#A8B0CC", // secondary text — 7.9:1
          500: "#8891AE", // muted labels — 5.4:1, clears AA at small sizes
          400: "#666E8C", // faint, disabled — 3.2:1, large/decorative only
        },
        accent: {
          50: "rgba(124,158,255,0.10)",
          100: "rgba(124,158,255,0.22)",
          400: "#A9C0FF",
          500: "#7C9EFF", // fills, marks, the live pulse
          600: "#B7C8FF", // small text and links — brightened for dark
        },
        // Secondary hue, used only by the backdrop and the hero gradient.
        iris: {
          400: "#C4A2FF",
          500: "#A87BFF",
        },
        state: {
          clean: "#3EE0A1", // 9.6:1 on the ground
          disputed: "#FFB454", // 10.4:1
          slashed: "#FF6B8A", // 7.4:1
          inactive: "#6E7590",
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
      backdropBlur: {
        glass: "22px",
      },
      boxShadow: {
        // Glass elevation: depth comes from the shadow *under* the plane and a
        // bright inset along its top edge, which is what reads as a lit pane.
        glass:
          "0 8px 32px -8px rgba(0,0,0,0.55), 0 2px 8px -2px rgba(0,0,0,0.35), inset 0 1px 0 0 rgba(255,255,255,0.10)",
        "glass-lift":
          "0 24px 64px -16px rgba(0,0,0,0.65), 0 8px 20px -6px rgba(0,0,0,0.40), inset 0 1px 0 0 rgba(255,255,255,0.16)",
        glow: "0 0 0 1px rgba(124,158,255,0.28), 0 8px 32px -6px rgba(124,158,255,0.40)",
        "glow-danger": "0 0 0 1px rgba(255,107,138,0.30), 0 8px 32px -6px rgba(255,107,138,0.42)",
        focus: "0 0 0 3px rgba(124,158,255,0.35)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(255,107,138,0.40)" },
          "70%": { boxShadow: "0 0 0 10px rgba(255,107,138,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,107,138,0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        // Slow, non-repeating-looking drift for the backdrop blooms. Long
        // durations and different periods per layer keep them from beating
        // against each other in a visible rhythm.
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "33%": { transform: "translate3d(4%, -3%, 0) scale(1.06)" },
          "66%": { transform: "translate3d(-3%, 4%, 0) scale(0.96)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        twinkle: {
          "0%, 100%": { opacity: "0.15" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 380ms cubic-bezier(0.16,1,0.3,1) both",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
        "drift-slow": "drift 34s ease-in-out infinite",
        "drift-slower": "drift 52s ease-in-out infinite",
        "drift-slowest": "drift 71s ease-in-out infinite",
        "gradient-pan": "gradient-pan 14s ease-in-out infinite",
        twinkle: "twinkle 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
