// The category/label color palette.
//
// These are DATA, not chrome: whichever hex the user taps is persisted on the
// Category/Label record and then rendered back as that entity's identity
// color across goals, tasks and reports. They deliberately do NOT come from
// `@/theme` — the theme carries four semantic hues (brand/success/warning/
// destructive) because that's all the UI needs, whereas a category palette
// has to span the wheel so two categories never look like the same thing.
//
// Lifted out of app/(app)/categories.tsx so that screen contains zero literal
// colors and every color it renders is either a theme token or one of these
// user-chosen values.
//
// The web offers the equivalent picker in
// dw-time-web/src/features/categories/components/category-modal.tsx.

export const PRESET_COLORS = [
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#22C55E",
  "#0EA5E9",
  "#6366F1",
  "#A855F7",
  "#EC4899",
] as const;

/** Fallback used when a Label was saved without a color (Label.color is optional). */
export const DEFAULT_SWATCH: string = PRESET_COLORS[0];
