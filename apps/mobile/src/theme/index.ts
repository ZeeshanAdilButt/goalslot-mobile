// Single source of truth for design tokens across the mobile app. Every
// screen currently hardcodes hex values in its own `StyleSheet.create` —
// this file exists so new/rebranded screens (starting with the auth flow)
// pull from one place instead of guessing a slightly-different gray each
// time.
//
// Colors are NOT invented — they're read from the web app's design system
// (dw-time-web/tailwind.config.ts + src/app/globals.css) so the mobile app
// matches the product it's a client of:
//   - `primary` / `accent` (brand yellow) comes straight from
//     tailwind.config.ts's `primary.dark` / `primary.light` literals and the
//     hardcoded `#f2cc0d` used throughout globals.css (e.g. `.timer-glow`,
//     `journal-glow`, `coach-aura` — the CSS's own comments call this out
//     as "the one warm thing on the page, by design").
//   - The rest (`background`, `foreground`, `border`, `muted`, `destructive`,
//     `success`, `warning`) are converted from the HSL custom properties in
//     globals.css's `:root` block (`--background`, `--foreground`, etc.),
//     which is shadcn/ui's standard token set.
//
// This is intentionally NOT a runtime theme/dark-mode system — just a flat
// object of values. If dark mode lands later it can layer on top of this.

export const colors = {
  // Brand — hsl(48 94% 50%) in tailwind.config.ts's `--primary`, and the
  // literal `#f2cc0d` used everywhere in globals.css.
  primary: "#F2CC0D",
  primaryDark: "#E5C100", // tailwind.config.ts `primary.dark`
  primaryLight: "#FFE44D", // tailwind.config.ts `primary.light`

  // Neutrals — from globals.css `:root` (light mode): --background,
  // --foreground, --card, --border, --muted-foreground.
  background: "#FAFAFA", // hsl(0 0% 98%)
  surface: "#FFFFFF", // --card
  foreground: "#18181B", // hsl(240 6% 10%) — zinc-900
  mutedForeground: "#71717A", // hsl(240 4% 46%) — zinc-500
  border: "#E4E4E7", // hsl(240 6% 90%) — zinc-200
  secondary: "#F4F4F5", // hsl(240 5% 96%) — zinc-100

  // Dark neutrals — globals.css's `.dark` overrides. Used for the auth
  // screens' hero/brand surface, not as a full dark-mode system.
  ink: "#09090B", // --background under .dark — near-black
  inkElevated: "#18181B", // --card under .dark

  // Semantic — converted from globals.css `:root` HSL custom properties.
  destructive: "#EE4962", // hsl(351 83% 61%)
  success: "#10B77F", // hsl(160 84% 39%)
  warning: "#F59F0A", // hsl(38 92% 50%)

  white: "#FFFFFF",
  black: "#000000",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

export const typography = {
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 34,
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

export const shadows = {
  // Mirrors globals.css's `.glass-card` / `.glass-hover` box-shadow pairs —
  // low-elevation, warm-neutral shadows rather than pure black.
  card: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  raised: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
  },
} as const;

// Motion — kept short and consistent so every animated screen feels like
// the same product. 320ms sits in the "tasteful, not showy" range the
// design brief asked for.
export const motion = {
  duration: {
    fast: 180,
    base: 320,
    slow: 420,
  },
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
  motion,
} as const;

export type Theme = typeof theme;
