// "What am I timing?" — the row directly under the ring.
//
// Every state is one component so the hero card's height never changes
// between them (a jumping card under the controls is what makes a timer
// screen feel unstable).
//
// THE ROW IS ALWAYS PRESSABLE, including mid-session. It used to lock itself
// the moment a session began, on the reasoning that the store's taskId/goalId
// was fixed for the life of a run. That reasoning inverted when starting
// stopped requiring a target: attaching a goal *while the clock runs* is now
// the ordinary way a session gets attributed, so the row has to stay live.
// The store's `retarget` action is what makes it safe — re-pointing a session
// never touches startedAt or pausedElapsedMs, so the clock is undisturbed.
//
// THREE EMPTY STATES, NOT ONE. "Nothing is attached" and "we can't yet tell
// what's attached" look identical on screen if you let them, and they need
// opposite copy: the first is a perfectly fine end state the user chose, the
// second is a transient cold-start gap where ids exist but the goal/task
// lists haven't loaded. `hasTarget` is what separates them — without it a
// deliberately unattributed session would announce itself as "Untitled",
// which reads like something went wrong.

import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface TrackingTargetProps {
  /** Resolved task or goal title, or null when there isn't one to show. */
  label: string | null;
  /** Secondary line — the parent goal, or the goal's category. */
  sublabel?: string | null;
  /** Goal colour, used as the identifying accent. Null falls back to neutral. */
  accentColor?: string | null;
  /**
   * True when a task/goal id is actually set. Distinguishes "the user chose
   * not to attach anything" (false) from "something is attached but its title
   * hasn't resolved yet" (true) — see this file's header.
   */
  hasTarget: boolean;
  /** True while a session is running or paused, which changes the copy. */
  running: boolean;
  onPress: () => void;
}

export function TrackingTarget({ label, sublabel, accentColor, hasTarget, running, onPress }: TrackingTargetProps) {
  if (label === null) {
    // Ids are set but the lists haven't resolved them yet. Not an invitation
    // to attach something — there already is something — so this state keeps
    // the neutral clock glyph and doesn't promise an empty slot.
    const unresolved = hasTarget;

    const title = unresolved ? "Untitled session" : running ? "No goal attached" : "Add a goal (optional)";
    const subtitle = unresolved
      ? "The clock is running"
      : running
        ? "Tap to file this session under a goal"
        : "Or just press start — you can attach one later";

    return (
      <Pressable
        style={({ pressed }) => [styles.emptySlot, pressed && styles.pressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          unresolved
            ? "Tracking an unnamed session. Change what this is tracked against"
            : running
              ? "No goal attached. Attach a goal or task to this session"
              : "Add a goal or task to track against. Optional"
        }
      >
        <View style={styles.emptyGlyph}>
          {/* `timer` is the Icon set's Clock glyph — there is no bare "clock"
              name; see src/components/ui/Icon.tsx. */}
          <Icon name={unresolved ? "timer" : "add"} size={18} color={colors.mutedForeground} />
        </View>
        <View style={styles.body}>
          <Text style={styles.emptyTitle}>{title}</Text>
          <Text style={styles.emptySubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Icon name="chevron" size={18} color={colors.mutedForeground} />
      </Pressable>
    );
  }

  const accent = accentColor ?? colors.mutedForeground;

  return (
    <Pressable
      style={({ pressed }) => [styles.filledSlot, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Tracking ${label}. Change what this is tracked against`}
    >
      <View style={[styles.rail, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <View style={styles.sublabelRow}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.sublabel} numberOfLines={1}>
              {sublabel}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.changeAffordance}>
        <Text style={styles.changeText}>Change</Text>
        <Icon name="chevron" size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

const slotBase = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: spacing.md,
  width: "100%" as const,
  minHeight: minTouchTarget + spacing.md,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: radii.lg,
};

const styles = StyleSheet.create({
  emptySlot: {
    ...slotBase,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  filledSlot: {
    ...slotBase,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingLeft: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  rail: {
    width: 4,
    alignSelf: "stretch",
    marginVertical: spacing.xs,
    borderRadius: radii.full,
  },
  emptyGlyph: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  title: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  sublabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sublabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  emptySubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  changeAffordance: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  changeText: {
    ...typography.label,
    color: colors.mutedForeground,
  },
});
