import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans:  ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input:  "hsl(var(--input))",
        ring:   "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        amber: "hsl(var(--amber))",
        teal:  "hsl(var(--teal))",
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        // Public site only. A surface that is DARKER than the page in both
        // palettes, so "sold out" / "occupied" reads recessed either way —
        // --accent cannot do that job, being darker than --card on the light
        // theme and lighter than it on the dark one. Falls back to --accent so
        // the utility is never an invalid colour outside app/(public).
        "surface-sunken": "hsl(var(--surface-sunken, var(--accent)))",
        // Public site only. The header and the trust strip beneath it. Fall
        // back to --card/--muted so they are safe anywhere outside the public
        // scope, where neither token is defined.
        "surface-header": "hsl(var(--surface-header, var(--card)))",
        "surface-trust": "hsl(var(--surface-trust, var(--muted)))",
        // Alpha-capable: the dialog's sticky CTA bar uses /95.
        "surface-dialog": "hsl(var(--surface-dialog, var(--background)) / <alpha-value>)",
        // Public site only, defined in app/(public)/public-theme.css. RGB
        // channels rather than HSL so the light values are the exact hexes the
        // branch page used to hardcode; <alpha-value> keeps /10 and /25 tints.
        "pub-success": "rgb(var(--pub-success) / <alpha-value>)",
        "pub-info":    "rgb(var(--pub-info) / <alpha-value>)",
        "pub-cool":    "rgb(var(--pub-cool) / <alpha-value>)",
        "pub-violet":  "rgb(var(--pub-violet) / <alpha-value>)",
        "pub-warn":    "rgb(var(--pub-warn) / <alpha-value>)",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          // Falls back to --border, which is all the app theme defines. Only
          // the public theme sets --card-border, so border-card-border is safe
          // to use anywhere without leaving an invalid colour behind.
          border:     "hsl(var(--card-border, var(--border)))",
        },
        sidebar: {
          DEFAULT:              "hsl(var(--sidebar))",
          foreground:           "hsl(var(--sidebar-foreground))",
          border:               "hsl(var(--sidebar-border))",
          accent:               "hsl(var(--sidebar-accent))",
          "accent-foreground":  "hsl(var(--sidebar-accent-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
        "fade-up": {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-left": {
          "0%":   { opacity: "0", transform: "translateX(-12px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down":  "accordion-down 0.2s ease-out",
        "accordion-up":    "accordion-up 0.2s ease-out",
        "fade-up":         "fade-up 0.45s cubic-bezier(0.16,1,0.3,1) both",
        "fade-in":         "fade-in 0.3s ease-out both",
        "slide-in-left":   "slide-in-left 0.35s cubic-bezier(0.16,1,0.3,1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
