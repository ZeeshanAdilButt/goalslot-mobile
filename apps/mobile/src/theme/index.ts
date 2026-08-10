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
  controlHeight,
  fontSize,
  fontWeight,
  iconSize,
  minTouchTarget,
  motion,
  radii,
  shadows as foundationShadows,
  spacing,
  textStyles,
} from './foundation'

export { colors, radii, spacing, motion, minTouchTarget, iconSize, controlHeight, textStyles }

export const typography = {
  size: {
    // `twoxs`/`xxxl`/`stat` were added after this shape shipped; every key
    // that existed before is untouched, so existing `typography.size.*`
    // call sites are unaffected.
    twoxs: fontSize.twoxs,
    xs: fontSize.xs,
    sm: fontSize.sm,
    md: fontSize.md,
    lg: fontSize.lg,
    xl: fontSize.xl,
    xxl: fontSize.xxl,
    xxxl: fontSize.xxxl,
    stat: fontSize.stat,
    display: fontSize.display,
  },
  weight: fontWeight,
} as const

export const shadows = {
  card: foundationShadows.card,
  raised: foundationShadows.raised,
  // Added alongside the two originals — `subtle` seats a control on the
  // surface (web `shadow-sm`), `fab` is the floating-button preset that
  // previously only `@/theme/tokens` re-exported.
  subtle: foundationShadows.subtle,
  fab: foundationShadows.fab,
} as const

export const theme = {
  colors,
  spacing,
  radii,
  typography,
  textStyles,
  shadows,
  motion,
  minTouchTarget,
  iconSize,
  controlHeight,
} as const

export type Theme = typeof theme
