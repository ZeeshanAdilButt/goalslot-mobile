// The in-screen title block every list tab starts with.
//
// Mirrors dw-time-web/src/components/ui/page-header.tsx — a tiny uppercase
// eyebrow, a tight-tracking title, and a muted one-line description, with
// actions docked right.
//
// Two mobile-only rules are baked in here rather than repeated per screen:
//   1. `HAMBURGER_CLEARANCE`. app/(app)/_layout.tsx renders a floating 40pt
//      menu button absolutely positioned top-RIGHT over every screen. Header
//      content has to stop short of it or the title collides with the
//      hamburger on first paint. Reserving the gutter in the shared header is
//      the only way that stays true as screens change.
//   2. Callers wrap this in `<SafeAreaView edges={["top"]}>` (the pattern
//      app/(app)/index.tsx established) — `headerShown: false` is set for
//      every route in the layout, so nothing else keeps content out from
//      under the status bar. On tall Android status bars this was landing the
//      Goals filter tabs *inside* the system bar.

import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "@/theme/tokens";

/**
 * Right-hand gutter kept clear for the layout's floating menu button:
 * 40pt button + its 16pt right margin, rounded up for breathing room.
 */
export const HAMBURGER_CLEARANCE = 60;

export interface ScreenHeaderProps {
  title: string;
  /** Tiny uppercase line above the title — web's page-header eyebrow. */
  eyebrow?: string;
  /** One muted supporting line under the title. */
  subtitle?: string;
  /**
   * Rendered on its own row UNDER the title, right-aligned. Deliberately not
   * inline with the title: that row's right edge belongs to the layout's
   * floating menu button, and anything docked there would sit beneath it.
   */
  action?: ReactNode;
}

export function ScreenHeader({ title, eyebrow, subtitle, action }: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.titleBlock}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  titleBlock: {
    gap: spacing.xxs,
    // Keeps long titles from sliding under the floating hamburger.
    paddingRight: HAMBURGER_CLEARANCE,
  },
  eyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  title: {
    ...typography.h1,
    fontSize: 26,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    lineHeight: 17,
  },
  // Deliberately no alignItems here: a full-width control (the Goals
  // segmented switch) must be free to fill the row, while a button that
  // should hug the right edge sets its own `alignSelf` — see notes.tsx's
  // "New page" button.
  action: {},
});
