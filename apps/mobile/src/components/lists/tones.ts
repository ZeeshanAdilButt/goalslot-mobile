// Semantic badge/accent tones, and the task-status -> tone mapping.
//
// Direct port of dw-time-web/src/features/tasks/utils/task-status-styles.ts,
// which gives every TaskStatus a matching set of {badge, dot, fill, border}
// classes. Two deliberate deviations, both forced by the mobile token set
// (apps/mobile/src/theme/foundation.ts), which only carries the semantic
// families the web's globals.css `:root` defines:
//
//   1. TODO is `blue-50/blue-700/blue-500` on web. There is no blue token in
//      the mobile theme and this task may not add one, so TODO reads as the
//      NEUTRAL tone (zinc chip, foreground-weight dot) — still visibly
//      "queued and waiting", just not blue. Flagged in the handover.
//   2. DOING is `bg-[#f2cc0d]` on web — the literal brand yellow. Here that's
//      `colors.primary` tinted for the chip surface with foreground (dark)
//      text on top, never white, per the brand rule.

import { type TaskStatus } from "@goalslot/shared";

import { colors } from "@/theme/tokens";

import { withAlpha } from "./color";

export type Tone = "muted" | "neutral" | "brand" | "success" | "warning" | "danger";

export interface ToneStyle {
  /** Chip / badge surface. */
  background: string;
  /** Text and icon color on that surface. */
  foreground: string;
  /** Hairline around the chip. */
  border: string;
  /** Saturated dot / progress fill / card accent stripe. */
  accent: string;
}

export const TONES: Record<Tone, ToneStyle> = {
  // BACKLOG — web `bg-zinc-100 text-zinc-700 border-zinc-200`, `bg-zinc-400` dot.
  muted: {
    background: colors.secondary,
    foreground: colors.mutedForeground,
    border: colors.border,
    accent: colors.mutedForeground,
  },
  // TODO — see the deviation note above.
  neutral: {
    background: colors.secondary,
    foreground: colors.foreground,
    border: colors.border,
    accent: colors.foreground,
  },
  // DOING — web `bg-[#f2cc0d]`; brand yellow as an accent, dark text on it.
  brand: {
    background: withAlpha(colors.primary, 0.18, colors.secondary),
    foreground: colors.foreground,
    border: withAlpha(colors.primary, 0.5, colors.border),
    accent: colors.primary,
  },
  // DONE — web `bg-emerald-50 text-emerald-700 border-emerald-200`.
  success: {
    background: colors.successMuted,
    foreground: colors.success,
    border: withAlpha(colors.success, 0.28, colors.border),
    accent: colors.success,
  },
  // Due-date chips — web `border-amber-200 bg-amber-50 text-amber-800`
  // (task-metadata.tsx:45).
  warning: {
    background: colors.warningMuted,
    foreground: colors.warning,
    border: withAlpha(colors.warning, 0.3, colors.border),
    accent: colors.warning,
  },
  danger: {
    background: colors.destructiveMuted,
    foreground: colors.destructive,
    border: withAlpha(colors.destructive, 0.28, colors.border),
    accent: colors.destructive,
  },
};

export function taskStatusTone(status: TaskStatus): Tone {
  switch (status) {
    case "DONE":
      return "success";
    case "DOING":
      return "brand";
    case "TODO":
      return "neutral";
    case "BACKLOG":
    default:
      return "muted";
  }
}

/** Human label for a status — web renders `task.status.replace('_', ' ')`. */
export function taskStatusLabel(status: TaskStatus): string {
  return status.replace("_", " ");
}
