// Single source of truth for design tokens across the mobile app — see
// `./foundation.ts` for the actual values and their web-app citations.
//
// This file is a compatibility re-export. It existed before `tokens.ts` did
// (two concurrent passes each created a theme module under a different
// filename) and real components already import from `@/theme` using this
// exact shape — `typography.size.md` / `typography.weight.semibold`, a flat
// `shadows.card` / `shadows.raised`, etc. That shape is preserved here
// so nothing importing from `@/theme` needs to change. For new code, either
// this file or `./tokens.ts` is fine — `./tokens.ts` additionally exposes a
// named semantic type scale (`h1`, `body`, `label`, ...) if that reads
// better than `size.md` + `weight.semibold`.
import {
  colors,
  fontSize,
  fontWeight,
  minTouchTarget,
  motion,
  radii,
  shadows as foundationShadows,
  spacing,
} from './foundation'

export { colors, radii, spacing, motion, minTouchTarget }

export const typography = {
  size: {
    xs: fontSize.xs,
    sm: fontSize.sm,
    md: fontSize.md,
    lg: fontSize.lg,
    xl: fontSize.xl,
    xxl: fontSize.xxl,
    display: fontSize.display,
  },
  weight: fontWeight,
} as const

export const shadows = { card: foundationShadows.card, raised: foundationShadows.raised } as const

export const theme = {
  colors,
  spacing,
  radii,
  typography,
  shadows,
  motion,
  minTouchTarget,
} as const

export type Theme = typeof theme
