// Design tokens for the mobile app's main screens (Today/Schedule/Goals/
// Tasks/Timer + the tab bar). Deliberately a SEPARATE file from
// `src/theme/index.ts` — a parallel effort owns that filename for the app
// shell/auth screens and shared UI primitives (Button/TextField). Splitting
// avoids a merge collision; the two token sets should get reconciled into
// one source of truth once both land. See DECISIONS or the PR description
// for that follow-up.
//
// Values are NOT invented — they're read directly from the web app's brand
// palette (dw-time-web/tailwind.config.ts + src/app/globals.css), which
// defines the real GoalSlot brand colors as HSL CSS custom properties (light
// theme only; the web app's dark theme is a separate concern this mobile
// pass doesn't take on — the app has no useColorScheme/Appearance usage
// anywhere yet, so a single light palette matches how every screen already
// renders).
//
// Source values, from dw-time-web/src/app/globals.css `:root`:
//   --primary:            48 94% 50%   -> #F2CC0D (explicitly reused as a
//                                         literal hex throughout that file's
//                                         dark-mode overrides, e.g.
//                                         "brand-yellow (#f2cc0d...)")
//   --primary-foreground: 240 6% 10%   -> #18181B
//   --background:         0 0% 98%     -> #FAFAFA
//   --foreground:         240 6% 10%   -> #18181B
//   --card:               0 0% 100%    -> #FFFFFF
//   --secondary/--muted:  240 5% 96%   -> #F4F4F5
//   --muted-foreground:   240 4% 46%   -> #71717A
//   --border:             240 6% 90%   -> #E4E4E7
//   --destructive:        351 83% 61%  -> #EE4962
//   --success:            160 84% 39%  -> #10B77F
//   --warning:             38 92% 50%  -> #F59F0A
// dw-time-web/tailwind.config.ts also defines two literal (non-HSL-var)
// primary shades used for hover/pressed states:
//   primary.dark:  #E5C100
//   primary.light: #FFE44D
// and a border-radius scale (`sm/md/lg/xl` = 0.375/0.5/0.75/1rem) mirrored
// below in `radii`.

export const colors = {
  // Brand primary (GoalSlot yellow).
  primary: "#F2CC0D",
  primaryDark: "#E5C100",
  primaryLight: "#FFE44D",
  primaryForeground: "#18181B",

  // Surfaces.
  background: "#FAFAFA",
  card: "#FFFFFF",
  cardForeground: "#18181B",

  // Text.
  foreground: "#18181B",
  mutedForeground: "#71717A",

  // Secondary/neutral fills (chips, inactive tab pills, track backgrounds).
  secondary: "#F4F4F5",
  secondaryForeground: "#18181B",
  muted: "#F4F4F5",

  // Borders/dividers.
  border: "#E4E4E7",

  // Semantic.
  destructive: "#EE4962",
  destructiveForeground: "#FFFFFF",
  destructiveMuted: "#FCE7EA",
  success: "#10B77F",
  successForeground: "#FFFFFF",
  successMuted: "#E4F9F1",
  warning: "#F59F0A",
  warningForeground: "#18181B",
  warningMuted: "#FEF3DD",

  // Fixed white/transparent helpers used a lot in row/fab compositions.
  white: "#FFFFFF",
  overlay: "rgba(24, 24, 27, 0.4)",
} as const;

// 4px grid, matching the spacing values already in use across the app's
// screens (4/8/12/16/20/24/32).
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

// Mirrors dw-time-web's tailwind borderRadius scale (sm/md/lg/xl = 6/8/12/16
// px at the default 16px root), plus `full` for pill/circular shapes.
export const radii = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  full: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.3 },
  h1: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.2 },
  h2: { fontSize: 18, fontWeight: "700" as const },
  title: { fontSize: 16, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "500" as const },
  bodySmall: { fontSize: 13, fontWeight: "500" as const },
  caption: { fontSize: 12, fontWeight: "600" as const },
  label: { fontSize: 11, fontWeight: "700" as const, textTransform: "uppercase" as const, letterSpacing: 0.4 },
} as const;

// Elevation presets — cards get a soft shadow + hairline border (mirrors
// dw-time-web's `.glass-card`); FABs get a stronger, more standalone shadow.
export const shadows = {
  card: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  fab: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
} as const;

// Minimum comfortable touch target (Apple HIG / Material both land on
// 44-48pt) — used for FABs, tab bar icons, and any tap target that isn't
// already a full-width row.
export const minTouchTarget = 44;

export const tokens = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
  minTouchTarget,
} as const;

export type Tokens = typeof tokens;
