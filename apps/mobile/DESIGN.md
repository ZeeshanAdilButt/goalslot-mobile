# GoalSlot mobile — design spec

Practical reference for matching the web app's design system
(`D:\Projects - Community\dw-time-master\dw-time-web`, live at
https://www.goalslot.io). Every value here is sourced from that codebase —
file paths and line numbers are cited so you can go check. The actual token
implementation lives in `apps/mobile/src/theme/foundation.ts`; this file is
the "how to use it" companion.

If you're building a screen or component, read the "How things should look"
section first, then pull values from `@/theme` or `@/theme/tokens` (both
work — see "Two import paths" below).

## Sources

- `dw-time-web/tailwind.config.ts` — color aliases, font families, shadow
  names, border-radius scale.
- `dw-time-web/src/app/globals.css` — the `:root` HSL custom properties that
  back every semantic Tailwind color utility, plus the `.dark` overrides.
- Representative components actually rendering the product: sidebar nav
  (`src/components/app-sidebar.tsx`), buttons/cards/inputs/badges/pills
  (`src/components/ui/{button,glass-card,stat-card,status-pill,input,badge,
  page-header,page-shell,section-header}.tsx`), a real list row
  (`src/features/tasks/components/task-list-item/{task-list-item,
  task-header,task-metadata}.tsx`), and the dashboard stats grid
  (`src/features/dashboard/components/dashboard-stats.tsx`).

## Palette

Hex values are computed from the web's HSL custom properties
(`globals.css :root`), standard HSL→sRGB conversion, hand-checked against
literal hex the web app itself hardcodes for the same colors where one
exists.

| Token | Hex | Source | Use |
|---|---|---|---|
| `primary` | `#F2CC0D` | literal, used throughout `globals.css` (`.timer-glow`, `journal-glow`, `coach-aura`); also the brief's own verified value | Brand yellow. CTAs, active states, focus rings, the one warm accent color |
| `primaryDark` | `#E5C100` | `tailwind.config.ts` `colors.primary.dark` | Pressed/active state for brand-colored controls (mobile has no hover) |
| `primaryLight` | `#FFE44D` | `tailwind.config.ts` `colors.primary.light` | Light brand tint, sparingly |
| `primaryForeground` | `#18181B` | `globals.css --primary-foreground: 240 6% 10%` | Text/icons on a brand-yellow background |
| `background` | `#FAFAFA` | `--background: 0 0% 98%` | Screen background |
| `surface` / `card` | `#FFFFFF` | `--card: 0 0% 100%` | Card/row/sheet background (same value, two names — see "Two import paths") |
| `cardForeground` | `#18181B` | `--card-foreground` | Text on cards |
| `foreground` | `#18181B` | `--foreground: 240 6% 10%` (zinc-900) | Primary text |
| `mutedForeground` | `#71717A` | `--muted-foreground: 240 4% 46%` (zinc-500) | Secondary/muted text |
| `secondary` / `muted` / `accent` | `#F4F4F5` | `--secondary`/`--muted`/`--accent: 240 5% 96%` (zinc-100) | Neutral fills — chips, inactive pills, track backgrounds |
| `border` / `input` | `#E4E4E7` | `--border`/`--input: 240 6% 90%` (zinc-200) | Hairlines, card borders, input borders |
| `ring` | `#F2CC0D` | `--ring: 48 94% 50%` == brand | Focus ring |
| `destructive` | `#EE4962` | `--destructive: 351 83% 61%` | Delete/error actions and states |
| `success` | `#10B77F` | `--success: 160 84% 39%` | Positive/complete states |
| `warning` | `#F59F0A` | `--warning: 38 92% 50%` | Caution states |
| `ink` | `#09090B` | `.dark --background: 240 6% 4%` | Dark hero/auth surfaces only (not a dark-mode system) |
| `overlay` | `rgba(9,9,11,0.4)` | `dialog.tsx` `DialogOverlay`: `bg-zinc-950/40` | Modal/sheet scrim |

`destructiveMuted` (`#FCE7EA`), `successMuted` (`#E4F9F1`), `warningMuted`
(`#FEF3DD`) are tint backgrounds derived for chip/badge use (the emerald-50
/ rose-50 / yellow-50 equivalents web uses in `badge.tsx` /
`status-pill.tsx`), not pulled from a CSS variable.

**Not ported yet — chart colors.** `globals.css` defines `--chart-1..5`
(`chart-1` = brand yellow, `chart-2` = `142 72% 47%` green, `chart-3` =
`25 95% 53%` orange, `chart-4` = `330 79% 59%` pink, `chart-5` =
`258 91% 67%` purple) for future data-viz. Not in `foundation.ts` because
nothing on mobile renders a chart yet — convert on demand rather than
guess hex now.

**Dark mode.** Mobile has no `useColorScheme`/`Appearance` usage anywhere
today, so `foundation.ts` is light-only, matching how every screen already
renders. When dark mode lands, `globals.css`'s `.dark` block (lines 57-74)
has the full second palette to port — brand yellow stays the same in dark
mode by design ("the one warm thing on the page").

## Spacing — 4px grid

Tailwind's default spacing scale (`p-1` = 4px, `p-2` = 8px, ...) — not
overridden in `tailwind.config.ts`. Confirmed against real usage:
`page-shell.tsx:12` (`px-4 py-6 md:px-8 md:py-7`).

| Token | px |
|---|---|
| `xxs` | 2 |
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 20 |
| `xxl` | 24 |
| `xxxl` | 32 |

## Border radius

Direct copy of `tailwind.config.ts`'s `borderRadius` override (lines
126-131) — the app does NOT use Tailwind's own default radius scale, it
redefines it.

| Token | px | Web usage |
|---|---|---|
| `sm` | 6 | small chips (`task-metadata.tsx` `rounded-sm` chips) |
| `md` | 8 | inputs (`input.tsx` `rounded-lg`... see note) |
| `lg` | 12 | buttons (`button.tsx` `rounded-lg`), inputs |
| `xl` | 16 | cards (`glass-card.tsx` `rounded-xl`) |
| `full` | 999 | pills, avatars (`status-pill.tsx`, `badge.tsx`, sidebar avatar) |

Note: Tailwind's `rounded-lg` class name maps to *this app's* `lg` = 12px
(not the `md` you might assume from the name) — both `button.tsx` and
`input.tsx` use `rounded-lg`, i.e. `radii.lg` (12px), not `radii.md`.

## Typography

TW config has no `fontSize` override, so `text-xs/sm/base/lg/xl/2xl` are
Tailwind's real defaults. Two sizes come from arbitrary bracket values the
app uses directly: `text-[10px]` (eyebrows/pills) and `text-7xl` (timer).

### Primitive scale (`fontSize`)

| Token | px | Cited from |
|---|---|---|
| `twoxs` | 10 | `stat-card.tsx:27`, `page-header.tsx:24`, `status-pill.tsx:37`, `badge.tsx:7` — all `text-[10px]` |
| `xs` | 12 | `page-header.tsx:44` description |
| `sm` | 14 | `section-header.tsx:14`, `button.tsx:9` |
| `md` | 16 | `task-header.tsx:23` task title, base size |
| `lg` | 18 | `page-header.tsx:28` h1 base size; `task-header.tsx:23` title at `sm:` |
| `xl` | 20 | `page-header.tsx:28` h1 at `sm:` breakpoint |
| `xxl` | 24 | `stat-card.tsx:41` stat value |
| `display` | 72 | `timer-display.tsx:67` — `text-7xl`, the timer's own **base** size (before its `sm:`/`md:` upscaling to 88/104px) |

Weights: `regular` 400, `medium` 500 (`timer-display.tsx:67`), `semibold`
600 (`button.tsx:9`, `section-header.tsx:14`), `bold` 700
(`page-header.tsx:28`, `stat-card.tsx:41`, `task-header.tsx:23`).

### Semantic roles (`textStyles` / `tokens.ts`'s `typography`)

| Role | Size / weight | Cited from |
|---|---|---|
| `display` | 72 / medium | `timer-display.tsx:67` big timer digits |
| `h1` | 18 / bold | `page-header.tsx:28` screen title |
| `h2` | 14 / semibold / uppercase | `section-header.tsx:14` — a small uppercase group label, not a big heading |
| `title` | 16 / bold | `task-header.tsx:23` row/card primary title. Web bakes `uppercase` into this one usage — treat that as the caller's choice, not baked into the role |
| `body` | 14 / regular | Tailwind default body copy; no weight utility anywhere it's used |
| `bodySmall` | 12 / regular | `page-header.tsx:44` description text |
| `caption` | 11 / semibold / uppercase | `task-metadata.tsx:17` metadata chips |
| `label` | 10 / semibold / uppercase | `stat-card.tsx:27`, `page-header.tsx:24` eyebrows |

### Font family — a real deviation

Web loads three Google Fonts via `@import` in `globals.css:1`: **Inter**
(body/sans, weights 400-900), **JetBrains Mono** (mono, timers/numeric
data), **Plus Jakarta Sans** (display — used for the `font-display` class,
e.g. task titles in `task-header.tsx:23`).

React Native can't do a CSS `@import`. Until fonts are loaded via
`expo-font` (not currently set up — check before adding), every screen
renders in the OS system font (San Francisco / Roboto). This is an
acceptable, expected gap for now — call it out if you're the one wiring up
`expo-font`, don't silently assume it's already done.

## Elevation (shadows)

Web's cards use a two-layer CSS box-shadow (`glass-card.tsx:16` —
`0 1px 2px rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.03)`), which iOS/Android
can't replicate exactly (native shadow props are single-layer; Android only
has a scalar `elevation`). `shadows.card` in `foundation.ts` approximates
the dominant, more visible layer.

| Token | Web source | Notes |
|---|---|---|
| `card` | `glass-card.tsx:16` box-shadow | Default card/row elevation |
| `raised` | `glass-card.tsx:18` hover box-shadow | Repurposed for mobile's "elevated surface" moments (modals, sheets, pressed state) since touch has no hover |
| `fab` | — | Mobile-only, no web source. The web app is a sidebar layout with no floating action buttons; this is sized like a native FAB for e.g. a floating quick-add button |

## Motion

| Token | ms | Cited from |
|---|---|---|
| `fast` | 150 | `button.tsx:9` `transition-all duration-150` |
| `base` | 200 | `glass-card.tsx:18` `transition-all duration-200` |
| `slow` | 400 | `globals.css:107` `.screen-enter` — `animation: screenEnter 0.4s` |

## How things should look

**Card.** White (`colors.surface`) background, `radii.xl` (16px) corners,
`shadows.card` elevation, hairline `colors.border` border. Padding
`spacing.xxl` (24px) if content-heavy, `spacing.lg` (16px) for compact
cards (stat tiles). Cited: `glass-card.tsx`, `stat-card.tsx`.

**List row (task/goal/note).** Same card treatment but with a 4px
left-accent bar in a status color (`task-list-item.tsx:47` — `border-l-4`)
when the row has a status. Title uses the `title` text role (16/bold), a
status dot, metadata as small uppercase chips (`caption` role, 11/semibold/
uppercase, in a bordered pill using `radii.sm`).

**Button.** `radii.lg` (12px, not `md` — see radius note above),
horizontal padding `spacing.lg`, vertical padding around `spacing.md`,
label text at `sm` (14px) / `semibold`. Minimum height 44pt regardless of
the web's more compact `h-9`/36px (see "Mobile deviations" below).
Variants, cited from `button.tsx:13-19`:
- primary/default → `colors.foreground` bg, white text (web: `bg-zinc-900`)
- brand → `colors.primary` bg, `colors.primaryForeground` text
- secondary → white bg, `colors.border` border, `colors.foreground` text
- destructive → `colors.destructive` bg, white text
- ghost → transparent, `colors.foreground` text

**Input.** White background, `radii.lg` (12px — web: `rounded-lg`),
`colors.border` border, focus state switches border to `colors.primary`
(web: `focus-visible:border-[#f2cc0d]`). Text at `md` (16px) — deliberately
not web's 14px, since 16px avoids iOS Safari-style zoom-on-focus behavior
and reads better as a touch target. Cited: `input.tsx:11`.

**Pills/badges/status.** `radii.full`, `label` text role (10/semibold/
uppercase), tinted background + matching text color per semantic color
(e.g. success → `successMuted` bg + `success` text). Cited:
`status-pill.tsx`, `badge.tsx`.

**Page header.** Screen title at `h1` (18/bold), optional muted eyebrow
above it at `label` role, optional description below at `bodySmall`,
muted. Cited: `page-header.tsx`.

**Section header.** Uppercase group label at `h2` role (14/semibold/
uppercase/muted), used above a group of cards/rows. Cited:
`section-header.tsx`.

## Icons

Web uses **`lucide-react`** (`package.json`: `"lucide-react": "^0.439.0"`)
throughout — every icon in `app-sidebar.tsx`, buttons, stat cards, chips.
For 1:1 icon parity, mobile should use the equivalent icon family/glyphs —
either `lucide-react-native` or `@expo/vector-icons`'s Ionicons/Feather set
picked to match each `lucide-react` icon name as closely as possible
(most map 1:1 by name: `Clock`, `Calendar`, `CheckSquare`, `Target`,
`TrendingUp`, etc.). A separate agent is currently adding
`@expo/vector-icons` — coordinate icon choice with that work rather than
introducing a second icon dependency.

## Mobile deviations from web (intentional, not oversights)

- **Touch targets ≥ 44pt.** Web's `button.tsx` default height is `h-9`
  (36px) because a mouse pointer has no minimum hit-area requirement.
  Mobile enforces `minTouchTarget` (44, from `foundation.ts` — Apple HIG /
  Material both land on 44-48pt) as a floor on any tappable control, even
  where that means the control renders taller than its literal web
  equivalent.
- **No hover states.** Every `hover:` variant in web CSS (button hover
  colors, `glass-card.tsx`'s `hover:-translate-y-0.5`, sidebar item hover)
  has no mobile equivalent. Use a **pressed** state instead (opacity dip or
  `primaryDark`/darker-shade swap on `onPressIn`), not a translate/lift
  effect — lifting a card on press reads as a bug on touch, not a hover
  affordance.
- **Elevation via native shadow, not CSS multi-layer.** See "Elevation"
  above — RN shadow props are single-layer (iOS) or a scalar (Android
  `elevation`), so `shadows.card`/`raised`/`fab` approximate rather than
  replicate web's stacked box-shadows.
- **No sidebar.** Web's primary nav is a collapsible left sidebar
  (`app-sidebar.tsx`). Mobile nav is necessarily a bottom tab bar or drawer
  — match the *color/weight/icon* treatment of the active/inactive nav item
  (`app-sidebar.tsx:204-209` — active items get `text-[#f2cc0d]` /
  `colors.primary`), not the layout.
- **System font, not web's font stack.** Every screen currently renders in
  the OS system font instead of the web's Inter/JetBrains Mono/Plus Jakarta
  Sans until `expo-font` is wired up (not currently in the dependency list —
  check before assuming it exists). See "Font family — a real deviation"
  above.
- **Input text size bumped to 16px.** Web uses 14px; mobile uses `md`
  (16px) to avoid iOS auto-zoom-on-focus and to read better as a touch
  target (see "Input" above).

## Two import paths — why, and which to use

`apps/mobile/src/theme/index.ts` and `apps/mobile/src/theme/tokens.ts` are
both re-exports of `apps/mobile/src/theme/foundation.ts` (the actual source
of truth). They exist as two files because two earlier passes each built a
theme module under a different filename before either landed, and real
components already import from both paths with two different `typography`
shapes:

- `@/theme` (`index.ts`) — primitive scale: `typography.size.md`,
  `typography.weight.semibold`.
- `@/theme/tokens` (`tokens.ts`) — semantic scale: `typography.body`,
  `typography.h1`, `typography.label`.

Both shapes are preserved exactly as existing components already consume
them (`Button.tsx`/`TextField.tsx` via `@/theme`; `EmptyState.tsx`/
`ErrorState.tsx`/`Skeleton.tsx` via `@/theme/tokens`) — nothing needed to
change in those files. For **new** code, pick whichever shape reads better
for what you're building; both resolve to the same underlying numbers in
`foundation.ts`. Don't add a third theme file — extend `foundation.ts` and,
if a new shape is genuinely needed, re-export it from one of the two
existing entry points.
