import type { Config } from "tailwindcss";

/*
 * Paper, ink, one red. The whole app is drawn in a warm neutral scale (as `slate`), an ink scale for
 * what used to be the brand color (as `indigo` and `violet`, so every existing brand class turns to
 * ink without a rewrite) and a single red accent (as `fuchsia`, and `accent`).
 */
const neutral = {
  50: "#f4f4f2", 100: "#ebebe8", 200: "#deded9", 300: "#c6c6c0", 400: "#9a9a96",
  500: "#6b6b70", 600: "#4a4a50", 700: "#3a3a40", 800: "#26262b", 900: "#18181b", 950: "#0f0f11",
};
const ink = {
  50: "#f1f1ee", 100: "#e6e6e2", 200: "#d4d4ce", 300: "#b8b8b2", 400: "#8f8f8c",
  500: "#5c5c60", 600: "#2a2a2f", 700: "#1c1c20", 800: "#141417", 900: "#101012", 950: "#0a0a0b",
};
const red = {
  50: "#fff1f1", 100: "#ffe0e0", 200: "#ffc6c6", 300: "#ff9d9d", 400: "#ff6363",
  500: "#ff4040", 600: "#e62525", 700: "#c21b1b", 800: "#a01a1a", 900: "#841c1c", 950: "#480808",
};

const config: Config = {
  // The theme is a choice (components/ThemeToggle.tsx), not only the system's: <html data-theme>.
  darkMode: ["selector", '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // Class names written out in helpers (label chips, avatar gradients) live here too.
    "./src/lib/**/*.{js,ts,jsx,tsx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        slate: neutral,
        indigo: ink,
        violet: ink,
        fuchsia: red,
        accent: red,
        paper: "#f4f4f2",
        ink: "#121214",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgb(18 18 20 / 0.03), 0 4px 16px -6px rgb(18 18 20 / 0.06)",
        lift: "0 2px 4px rgb(18 18 20 / 0.04), 0 18px 36px -14px rgb(18 18 20 / 0.2)",
        glow: "0 10px 24px -10px rgb(255 64 64 / 0.55)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          // "none", not translateY(0): a lasting transform would make this element the containing
          // block of any position: fixed descendant (a dialog opened from inside a page).
          to: { opacity: "1", transform: "none" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.96)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(4%, -6%) scale(1.06)" },
          "66%": { transform: "translate(-5%, 4%) scale(0.96)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        progress: { from: { transform: "scaleX(1)" }, to: { transform: "scaleX(0)" } },
        grow: { from: { transform: "scaleX(0)" }, to: { transform: "scaleX(1)" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "70%": { transform: "scale(1.12)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out both",
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        "scale-in": "scale-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-up": "slide-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-left": "slide-in-left 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        "toast-in": "toast-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
        float: "float 6s ease-in-out infinite",
        drift: "drift 18s ease-in-out infinite",
        "gradient-pan": "gradient-pan 8s ease infinite",
        grow: "grow 0.8s cubic-bezier(0.22, 1, 0.36, 1) both",
        pop: "pop 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        marquee: "marquee 40s linear infinite",
        "spin-slow": "spin-slow 24s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
