// Design tokens for the mobile app's main screens (Today/Schedule/Goals/
// Tasks/Timer + the tab bar) — see `./foundation.ts` for the actual values
// and their web-app citations.
//
// This file is a compatibility re-export. It was created as a second,
// parallel theme module (alongside `./index.ts`) to avoid a merge collision
// while both were being built; the two have since been reconciled into one
// source of truth in `./foundation.ts`. Real components already import from
// `@/theme/tokens` using this exact shape — a semantic `typography` scale
// (`typography.bodySmall`, not `typography.size.sm`) — so that shape is
// preserved here. For new code, either this file or `./index.ts` is fine.
import {
  colors,
  controlHeight,
  fontSize,
  iconSize,
  minTouchTarget,
  motion,
  radii,
  shadows as foundationShadows,
  spacing,
  textStyles,
} from './foundation'

export { colors, radii, spacing, minTouchTarget, motion, iconSize, controlHeight }

// Each role is spread wholesale from `textStyles` rather than being rebuilt
// key-by-key as it was originally. That's what lets a token added upstream
// (the explicit `lineHeight` every role now carries — see foundation.ts's
// note on why RN needs it pinned) reach call sites without this file having
// to be edited again. Nothing is dropped in the process: every key these
// roles exposed before is still present, plus the new ones.
export const typography = {
  display: { ...textStyles.display },
  h1: { ...textStyles.h1 },
  h2: { ...textStyles.h2 },
  // Added after this shape shipped (every pre-existing key is untouched):
  // the centred heading an empty/error state hangs off, and the big number
  // on a stat tile.
  headline: { ...textStyles.headline },
  statValue: { ...textStyles.statValue },
  title: { ...textStyles.title },
  body: { ...textStyles.body },
  bodySmall: { ...textStyles.bodySmall },
  caption: { ...textStyles.caption },
  label: { ...textStyles.label, fontSize: fontSize.twoxs },
} as const

// Elevation presets — cards get a soft shadow + hairline border (mirrors
// dw-time-web's `.glass-card`); FABs get a stronger, more standalone shadow.
export const shadows = {
  card: foundationShadows.card,
  fab: foundationShadows.fab,
  // Added alongside the two originals so a component importing from this
  // entry point can reach the full elevation ramp without a second import.
  subtle: foundationShadows.subtle,
  raised: foundationShadows.raised,
} as const
