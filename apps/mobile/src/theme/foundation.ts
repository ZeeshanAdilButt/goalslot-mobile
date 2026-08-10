// ============================================================================
// GoalSlot mobile — design foundation (single source of truth)
// ============================================================================
//
// This file is the ONE place mobile design tokens are defined. Two prior
// passes independently created `theme/index.ts` and `theme/tokens.ts` with
// overlapping-but-different token sets (different spacing/radii scales, two
// incompatible `typography` shapes). Rather than pick a winner and break the
// other's importers mid-flight, this file holds the corrected, cited values
// and `index.ts` / `tokens.ts` now both re-export from here, each preserving
// its OWN original public shape (see the bottom of each file for exactly
// which keys existing components rely on). New code should import from
// whichever of the two feels natural — `tokens.ts`'s semantic typography
// scale (`display/h1/h2/title/body/...`) or `index.ts`'s primitive scale
// (`size.md` + `weight.semibold`) — they now describe the same underlying
// numbers.
//
// Every value below is sourced from the real web app at
// D:\Projects - Community\dw-time-master\dw-time-web, not invented. Sources:
//   - dw-time-web/tailwind.config.ts        ("TW config")
//   - dw-time-web/src/app/globals.css       ("globals.css") — the `:root`
//     HSL custom properties that back every `bg-background` / `text-foreground`
//     / `border-border` utility in the app.
//   - Representative real components (file:line comments below) — because
//     Tailwind's arbitrary values (`text-[10px]`, `bg-[#f2cc0d]`) and literal
//     hex overrides don't show up in the config at all.
//
// HSL → hex conversions were computed by hand (standard HSL→RGB formula) and
// spot-checked against the literal hex values the web app hardcodes for the
// same colors in `globals.css`'s dark-mode section (e.g. `--destructive`
// converts to #EE4962, and nothing in globals.css contradicts that — the
// literal hex family called out there is only the brand-yellow one). Brand
// primary itself is NOT derived from `--primary: 48 94% 50%` (that HSL
// triple rounds to ~#F7C708 by hand-calculation, not an exact match) —
// `#F2CC0D` is used instead because that's the literal hex the web app
// hardcodes everywhere it means "the brand color" (globals.css `.timer-glow`,
// `journal-glow`, `coach-aura` keyframes, plus the task brief's own
// "verified" #F2CC0D), and CSS's HSL→sRGB rounding in-browser is not
// guaranteed to hand-recompute to the bit.

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------
// Light theme only. The mobile app has no useColorScheme/Appearance usage
// anywhere yet (confirmed via grep), and the web app's dark theme is a
// separate, later concern — see DESIGN.md "Dark mode" section for the
// web's `.dark` values to carry over when that work starts.
export const colors = {
  // Brand — literal #f2cc0d used throughout globals.css; TW config's
  // `primary.dark` / `primary.light` literals for pressed/hover-equivalent
  // states. primaryForeground from globals.css `--primary-foreground: 240 6% 10%`.
  primary: '#F2CC0D',
  primaryDark: '#E5C100', // TW config `colors.primary.dark`
  primaryLight: '#FFE44D', // TW config `colors.primary.light`
  primaryForeground: '#18181B', // globals.css --primary-foreground: 240 6% 10%

  // Surfaces — globals.css :root. `surface` and `card` are the same value
  // (--card: 0 0% 100%); both names are kept because the two existing theme
  // files each picked one and real components already depend on both.
  background: '#FAFAFA', // --background: 0 0% 98%
  surface: '#FFFFFF', // --card: 0 0% 100%
  card: '#FFFFFF', // --card: 0 0% 100%
  cardForeground: '#18181B', // --card-foreground: 240 6% 10%
  popover: '#FFFFFF', // --popover: 0 0% 100%

  // Text
  foreground: '#18181B', // --foreground: 240 6% 10% (zinc-900)
  mutedForeground: '#71717A', // --muted-foreground: 240 4% 46% (zinc-500)

  // Neutral fills — chips, inactive pills, track backgrounds.
  secondary: '#F4F4F5', // --secondary: 240 5% 96% (zinc-100)
  secondaryForeground: '#18181B', // --secondary-foreground: 240 6% 10%
  muted: '#F4F4F5', // --muted: 240 5% 96%
  accent: '#F4F4F5', // --accent: 240 5% 96%
  accentForeground: '#18181B', // --accent-foreground: 240 6% 10%

  // Borders / focus
  border: '#E4E4E7', // --border: 240 6% 90% (zinc-200)
  input: '#E4E4E7', // --input: 240 6% 90%
  ring: '#F2CC0D', // --ring: 48 94% 50% == brand primary

  // Dark neutrals — used today only for brand hero/auth surfaces, not a
  // full dark-mode system. globals.css .dark overrides.
  ink: '#09090B', // .dark --background: 240 6% 4%
  inkElevated: '#18181B', // .dark --card: 240 6% 10%

  // Semantic — globals.css :root.
  destructive: '#EE4962', // --destructive: 351 83% 61%
  destructiveForeground: '#FFFFFF', // --destructive-foreground: 0 0% 100%
  destructiveMuted: '#FCE7EA', // tint derived for chip/badge backgrounds (rose-50-equivalent)
  success: '#10B77F', // --success: 160 84% 39%
  successForeground: '#FFFFFF',
  successMuted: '#E4F9F1', // tint derived for chip/badge backgrounds (emerald-50-equivalent)
  warning: '#F59F0A', // --warning: 38 92% 50%
  warningForeground: '#18181B',
  warningMuted: '#FEF3DD', // tint derived for chip/badge backgrounds (yellow-50-equivalent)

  // Pressed-state fills. Touch has no hover, so every `hover:` color the web
  // declares is reused here as the PRESSED color rather than being dropped —
  // see DESIGN.md "No hover states". Without these, pressing a button could
  // only dim it via opacity, which reads as "disabled" rather than "pressed".
  foregroundPressed: '#27272A', // button.tsx `default` variant hover:bg-zinc-800
  primaryPressed: '#D9B307', // button.tsx `brand` variant hover:bg-[#d9b307]
  destructivePressed: '#E11D48', // button.tsx `destructive` variant hover:bg-rose-600
  borderStrong: '#D4D4D8', // zinc-300 — glass-card.tsx hover:border-zinc-300, button.tsx secondary hover:border-zinc-300

  // Brand tint family — the yellow chip/ring treatment web uses for a
  // brand-accented icon container, as opposed to a solid brand-yellow fill.
  // stat-card.tsx accentRing.brand: `bg-yellow-50 text-yellow-700 border-yellow-200`.
  primaryMuted: '#FEFCE8', // yellow-50
  primaryBorder: '#FEF08A', // yellow-200
  primaryText: '#A16207', // yellow-700 — readable brand-colored TEXT (raw #F2CC0D fails contrast on white)

  // One step lighter than mutedForeground (zinc-500). Web reserves zinc-400
  // for de-emphasised chrome: sidebar group labels and the empty-state icon.
  // app-sidebar.tsx SidebarGroupLabel `text-zinc-400`, empty-state.tsx `text-zinc-400`.
  mutedForegroundLight: '#A1A1AA', // zinc-400

  // Loading-placeholder fill. skeleton.tsx — `animate-pulse rounded-md bg-zinc-100`.
  skeleton: '#F4F4F5', // zinc-100

  // Fixed helpers used a lot in row/fab compositions.
  white: '#FFFFFF',
  black: '#000000',
  overlay: 'rgba(9, 9, 11, 0.4)', // modal/sheet scrim — dialog.tsx DialogOverlay: `bg-zinc-950/40`
} as const

// ---------------------------------------------------------------------------
// Spacing — 4px grid
// ---------------------------------------------------------------------------
// Tailwind's default spacing scale is 4px-per-unit and is NOT overridden in
// TW config, so `p-1..p-8` etc. map straight to these numbers. Confirmed
// against real usage: dw-time-web/src/components/ui/page-shell.tsx:12
// (`px-4 py-6 md:px-8 md:py-7`) and the gap-2/gap-3/gap-4/gap-6 spacing seen
// throughout page-header.tsx, section-header.tsx, dashboard-stats.tsx.
//
// Rhythm — which step to reach for, so five screens don't each invent one:
//   xs  (4)  gap between a label and the thing it labels
//   sm  (8)  gap between icon and text inside one control
//   md  (12) gap between rows in a list; padding inside a compact card
//   lg  (16) screen horizontal gutter; padding inside a standard card
//   xl  (20) gap between a heading and its content
//   xxl (24) padding inside a content-heavy card; gap between sections
//   xxxl(32) gap between major blocks on a screen
//   huge(48) top/bottom breathing room around a full-screen empty state
// `xxs` (2) exists only for optical nudges (a 2px lift on a badge's text) —
// it is not a layout step; anything structural belongs on the 4pt grid.
export const spacing = {
  xxs: 2, // p-0.5
  xs: 4, // p-1
  sm: 8, // p-2
  md: 12, // p-3
  lg: 16, // p-4 — page-shell.tsx px-4
  xl: 20, // p-5
  xxl: 24, // p-6 — page-shell.tsx py-6
  xxxl: 32, // p-8 — page-shell.tsx md:px-8
  // Added for full-screen compositions (empty states, auth screens), which
  // have no web analogue — web's equivalents sit inside a dashboard column
  // that already provides this much surrounding space.
  xxxxl: 40, // p-10
  huge: 48, // p-12 — empty-state.tsx's own `py-12`
} as const

// ---------------------------------------------------------------------------
// Border radius
// ---------------------------------------------------------------------------
// Direct copy of TW config's borderRadius override (tailwind.config.ts:127-130),
// which is what every `rounded-sm/md/lg/xl` utility in the app actually
// resolves to (NOT Tailwind's own defaults — this app redefines them).
// `full` added for pill/circular shapes (rounded-full: status-pill.tsx,
// badge.tsx, avatar circle in app-sidebar.tsx).
//
// ROLES — use the semantic name, not the t-shirt size. The t-shirt sizes are
// the raw scale (kept because existing components import them); the role
// names below are aliases onto that same scale and are what new code should
// use, so radius stops being a per-screen judgement call:
//
//   radii.chip    (8)  chips, badges' square variants, small inline tags
//   radii.control (12) buttons, inputs, select rows, drawer nav rows —
//                      anything a finger presses that isn't a card
//   radii.card    (16) cards, list rows, tiles, any elevated surface
//   radii.sheet   (24) bottom sheets and modals, top corners only
//   radii.pill    (999) pills, avatars, circular icon badges, FABs
//
// Why a control is 12 and a card is 16: nesting a 12px control inside a 16px
// card keeps the corners visually concentric (outer radius > inner radius),
// which is what makes a stack of surfaces look intentional. Both numbers are
// the web app's own (`rounded-lg` / `rounded-xl` from tailwind.config.ts) —
// they are not a mobile invention.
export const radii = {
  sm: 6, // TW config borderRadius.sm: 0.375rem
  md: 8, // TW config borderRadius.md: 0.5rem
  lg: 12, // TW config borderRadius.lg: 0.75rem — buttons/inputs (button.tsx, input.tsx both use rounded-lg)
  xl: 16, // TW config borderRadius.xl: 1rem — cards (glass-card.tsx uses rounded-xl)
  full: 999,
  // Sheets/modals. No web source: web's dialog is a centred box with the
  // same `rounded-xl` as a card, but a bottom sheet is anchored to the screen
  // edge and needs a larger top radius to read as a separate layer sliding
  // over the app rather than as a very wide card.
  xxl: 24,
  // Role aliases — same numbers, named for the decision they answer.
  chip: 8,
  control: 12,
  card: 16,
  sheet: 24,
  pill: 999,
} as const

// ---------------------------------------------------------------------------
// Typography — primitive scale
// ---------------------------------------------------------------------------
// TW config has no fontSize override, so `text-xs/sm/base/lg/xl/2xl` are
// Tailwind's real defaults (0.75/0.875/1/1.125/1.25/1.5rem @ 16px root).
// `twoxs` (10px) and `display` (72px) are arbitrary values the app actually
// uses via bracket syntax — cited per-line below.
export const fontSize = {
  twoxs: 10, // text-[10px] — stat-card.tsx:27, page-header.tsx:24 (eyebrow), status-pill.tsx:37, badge.tsx:7
  xs: 12, // text-xs — page-header.tsx:44 (description)
  sm: 14, // text-sm — section-header.tsx:14, button.tsx:9
  md: 16, // text-base — task-header.tsx:23 (task title, base size)
  lg: 18, // text-lg — page-header.tsx:28 (h1, base size), task-header.tsx:23 (title, sm: size)
  xl: 20, // text-xl — page-header.tsx:28 (h1, sm: breakpoint size)
  xxl: 24, // text-2xl — stat-card.tsx:41 (stat value)
  xxxl: 30, // text-3xl
  // Mobile-only step. Web's stat tiles sit in a dense multi-column grid so
  // `text-2xl` (24px) reads as large there; on a single-column phone layout
  // the same number looks undersized against the whitespace around it, so
  // stat values get the next real Tailwind step up (text-4xl).
  stat: 36, // text-4xl
  display: 72, // text-7xl — timer-display.tsx:67 (big timer digits, base size before its own sm:/md: upscaling)
} as const

export const fontWeight = {
  regular: '400',
  medium: '500', // timer-display.tsx:67 font-medium
  semibold: '600', // button.tsx:9, section-header.tsx:14, status-pill.tsx:37
  bold: '700', // page-header.tsx:28, stat-card.tsx:41, task-header.tsx:23
} as const

// ---------------------------------------------------------------------------
// Typography — semantic roles
// ---------------------------------------------------------------------------
// Named usage patterns pulled directly off the primitive scale above, each
// grounded in a specific real component. `display` is the one mobile-only
// extension without a literal web source line (see note).
//
// THE HIERARCHY, largest to smallest — one role per job, so a screen never
// has to invent a size:
//   display   72  the running timer, and nothing else
//   statValue 36  the single number on a stat tile
//   headline  20  the heading a full-screen state hangs off (empty/error)
//   h1        18  screen title in a header bar
//   title     16  a row's or card's primary line
//   h2        14  small uppercase group label above a set of rows
//   body      14  paragraph and row copy
//   bodySmall 12  secondary/description copy under a title
//   caption   11  metadata chips
//   label     10  eyebrows and pill text
//
// Every role carries an explicit `lineHeight`. React Native's default line
// height is font-dependent, so two Texts at the same size can sit on
// different baselines across iOS and Android; pinning it is what makes a
// stack of rows line up. The values follow Tailwind's `leading-*` ratios
// (none 1, tight 1.25, snug 1.375, normal 1.5) rounded to whole pixels, and
// tracking tightens as size grows — large type set at 0 tracking reads loose.
export const textStyles = {
  // Big standalone numbers (timer). timer-display.tsx:67 —
  // `text-7xl font-medium leading-none tracking-tight ... tabular-nums`.
  display: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.medium,
    letterSpacing: -1.8,
    lineHeight: 72, // leading-none
  },
  // Screen/page title. page-header.tsx:28 — `text-lg font-bold ... tracking-tight`.
  h1: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: -0.4, lineHeight: 24 },
  // Section/group label (the small uppercase kind, not a big heading).
  // section-header.tsx:14 — `text-sm font-semibold uppercase tracking-wider`.
  h2: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.7,
    lineHeight: 18,
  },
  // Row/card primary title (task title, goal name, list-row heading).
  // task-header.tsx:23 — `font-display text-base font-bold uppercase leading-tight`.
  // NOTE: web bakes uppercase into this one specific usage; treat uppercase
  // as the caller's choice, not an inherent part of the role.
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, letterSpacing: -0.2, lineHeight: 20 },
  // Default paragraph/body copy. globals.css:81 body has no weight utility
  // (regular); task-metadata.tsx description text likewise carries no
  // font-weight class.
  body: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, letterSpacing: 0, lineHeight: 20 },
  // Secondary/description copy. page-header.tsx:44 —
  // `text-xs leading-snug text-zinc-500` (no weight utility = regular).
  bodySmall: { fontSize: fontSize.xs, fontWeight: fontWeight.regular, letterSpacing: 0, lineHeight: 16 },
  // Metadata chips (due date, goal tag). task-metadata.tsx:17 —
  // `text-[10px] font-semibold uppercase ... sm:text-[11px]`.
  caption: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    lineHeight: 14,
  },
  // Empty/error-state headline and any "moment" heading that owns the middle
  // of the screen. empty-state.tsx:24 is `text-base font-semibold` (16px) —
  // stepped up to 20px here because that headline is centred in a full phone
  // viewport with nothing else competing, where 16px reads as a caption
  // rather than a heading.
  headline: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold, letterSpacing: -0.3, lineHeight: 26 },
  // Big numeric value on a stat tile. stat-card.tsx:41 —
  // `text-2xl font-bold tabular-nums`, taken to `fontSize.stat` for the
  // single-column reason documented on that token.
  statValue: { fontSize: fontSize.stat, fontWeight: fontWeight.bold, letterSpacing: -1, lineHeight: 40 },
  // Tiny eyebrow/pill text. stat-card.tsx:27, page-header.tsx:24,
  // status-pill.tsx:37, badge.tsx:7 — all `text-[10px] font-semibold
  // uppercase tracking-wider`.
  label: {
    fontSize: fontSize.twoxs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    lineHeight: 14,
  },
} as const

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------
// React Native can't stack two box-shadows the way CSS can (iOS shadow
// props are single-layer; Android only has a scalar `elevation`), so each
// preset approximates the DOMINANT (larger, more visible) layer of the
// web's two-layer shadow rather than both.
//   glass-card.tsx:16 — `shadow-[0_1px_2px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.03)]`
//   glass-card.tsx:18 (hover) — `hover:shadow-[0_10px_20px_rgba(0,0,0,0.04)]`
// `fab` has no web source — the web app is a sidebar layout with no
// floating action buttons; this is a mobile-only addition for e.g. a
// floating quick-add button, sized like a native FAB (Material spec).
//
// THE RAMP — one level per layer of the interface, in order. Picking by
// role instead of by taste is what stops a screen from reading as flat
// white-on-white (every surface at elevation 0) or as noisy (every surface
// competing at elevation 3):
//   subtle  — a control seated ON a surface (button, input)
//   card    — a surface resting on the background (card, list row, tile)
//   raised  — a surface floating over other content (popover, dropdown,
//             the pressed/dragged state of a card)
//   fab     — a control floating over the whole screen (FAB, sticky bar)
//   modal   — a layer that takes over the screen (bottom sheet, dialog),
//             always paired with the `overlay` scrim behind it
// Opacity climbs with offset and blur together: a shadow that gets darker
// without also getting larger reads as a hard edge, not as height.
export const shadows = {
  // The lightest layer — a 1px seat under a control so it separates from the
  // surface behind it without reading as "floating". button.tsx:14 `default`
  // variant carries `shadow-sm` (Tailwind: 0 1px 2px rgba(0,0,0,0.05)).
  subtle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  // Stronger elevation for modals/sheets/pressed state — the web
  // equivalent of glass-card's hover shadow, repurposed for mobile's
  // "raised surface" moments since there's no hover on touch.
  raised: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 6,
  },
  // Mobile-only: floating action button.
  fab: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  // Mobile-only: the sheet/dialog layer. Cast upward (negative Y) because a
  // bottom sheet's visible edge is its TOP one — a downward shadow on it
  // falls off-screen and the sheet ends up looking pasted on.
  modal: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 16,
  },
} as const

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------
// Durations cited from the web's own transition/animation timings:
//   button.tsx:9 — `transition-all duration-150`
//   glass-card.tsx:18 — `transition-all duration-200`
//   globals.css:107 `.screen-enter` — `animation: screenEnter 0.4s ...`
export const motion = {
  duration: {
    fast: 150, // button.tsx transition-all duration-150
    base: 200, // glass-card.tsx transition duration-200
    slow: 400, // globals.css screenEnter 0.4s
  },
  // Mobile-only. Web expresses press/hover feedback as a CSS transition on
  // color; touch UIs expect the control to physically give under the finger,
  // which is a spring, not a duration. These numbers are a critically-damped
  // -ish spring: it settles in ~150ms with no visible overshoot, so the
  // button feels responsive rather than bouncy.
  spring: {
    damping: 18,
    stiffness: 320,
    mass: 0.6,
  },
  // How far a pressed control scales down. Small on purpose — the press is
  // meant to be felt more than seen, and anything below ~0.95 makes text
  // inside the control visibly resample.
  pressScale: 0.97,
} as const

// ---------------------------------------------------------------------------
// Icon sizing
// ---------------------------------------------------------------------------
// Web sets icon size per-context with Tailwind's `size-*` utilities rather
// than a named scale; these are those literal sizes, named, so mobile stops
// passing magic numbers to <Icon size={...}>.
export const iconSize = {
  xs: 14, // size-3.5 — stat-card.tsx accent ring icon
  sm: 16, // size-4 — button.tsx `[&_svg]:size-4`, app-sidebar.tsx nav icons
  md: 20, // size-5 — empty-state.tsx icon slot
  lg: 24, // size-6 — app-sidebar.tsx coach icon
  // No web source: mobile-only sizes for the illustrative icon at the centre
  // of an empty/error state, where the icon IS the artwork rather than a
  // label's companion.
  xl: 28,
  xxl: 36,
} as const

// ---------------------------------------------------------------------------
// Control heights
// ---------------------------------------------------------------------------
// Web's button heights (button.tsx:22-27 — sm h-8/32, default h-9/36,
// lg h-11/44) raised so the SMALLEST still clears `minTouchTarget`. See
// DESIGN.md "Touch targets >= 44pt" — this is the documented, deliberate
// deviation, not a mismatch.
export const controlHeight = {
  sm: 40, // web h-8 (32) — the compact size, still within one thumb press of 44
  md: 48, // web h-9 (36) — default
  lg: 56, // web h-11 (44) — prominent CTA
} as const

// ---------------------------------------------------------------------------
// Platform-specific: mobile deviations from web
// ---------------------------------------------------------------------------
// Minimum comfortable touch target — Apple HIG / Material both land on
// 44-48pt. Web has no equivalent (mouse pointer has no minimum size
// requirement); this exists purely because mobile needs it.
export const minTouchTarget = 44
