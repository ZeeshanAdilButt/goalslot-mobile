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
  fontSize,
  minTouchTarget,
  radii,
  shadows as foundationShadows,
  spacing,
  textStyles,
} from './foundation'

export { colors, radii, spacing, minTouchTarget }

export const typography = {
  display: {
    fontSize: textStyles.display.fontSize,
    fontWeight: textStyles.display.fontWeight,
    letterSpacing: textStyles.display.letterSpacing,
  },
  h1: {
    fontSize: textStyles.h1.fontSize,
    fontWeight: textStyles.h1.fontWeight,
    letterSpacing: textStyles.h1.letterSpacing,
  },
  h2: {
    fontSize: textStyles.h2.fontSize,
    fontWeight: textStyles.h2.fontWeight,
    textTransform: textStyles.h2.textTransform,
    letterSpacing: textStyles.h2.letterSpacing,
  },
  title: { fontSize: textStyles.title.fontSize, fontWeight: textStyles.title.fontWeight },
  body: { fontSize: textStyles.body.fontSize, fontWeight: textStyles.body.fontWeight },
  bodySmall: { fontSize: textStyles.bodySmall.fontSize, fontWeight: textStyles.bodySmall.fontWeight },
  caption: {
    fontSize: textStyles.caption.fontSize,
    fontWeight: textStyles.caption.fontWeight,
    textTransform: textStyles.caption.textTransform,
  },
  label: {
    fontSize: fontSize.twoxs,
    fontWeight: textStyles.label.fontWeight,
    textTransform: textStyles.label.textTransform,
    letterSpacing: textStyles.label.letterSpacing,
  },
} as const

// Elevation presets — cards get a soft shadow + hairline border (mirrors
// dw-time-web's `.glass-card`); FABs get a stronger, more standalone shadow.
export const shadows = { card: foundationShadows.card, fab: foundationShadows.fab } as const

export const tokens = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
  minTouchTarget,
} as const

export type Tokens = typeof tokens
