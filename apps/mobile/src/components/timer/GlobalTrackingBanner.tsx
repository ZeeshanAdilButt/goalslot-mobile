// A persistent "you're tracking time" banner, visible from every tab — not
// just the Timer screen.
//
// WHY this exists: the timer's only in-app surface used to be the Time
// Tracker screen itself (the ongoing OS notification in useTimerNotification.ts
// covers being *outside* the app, not inside it). A session left running
// while the user is on Today, Schedule, or anywhere else was invisible in-app:
// "It doesn't currently show that the timer is working if I am anywhere in
// the app except for the timer screen."
//
// Renders nothing while idle. Mounted once in app/(app)/_layout.tsx, above
// every tab's content, so it survives tab switches instead of being remounted
// (and losing its tick phase) per screen.
//
// Elapsed time ticks via a plain `setInterval`, not the self-re-arming
// setTimeout TimerRing.tsx uses for the hero clock. That precision is worth
// it for the big seconds-place digits users stare at on the Timer screen;
// here the banner just needs to visibly move once a second while running, and
// only while THIS component is mounted (the store itself owns no interval —
// see timer-store.ts's header for why — so nothing ticks when no screen is
// showing the clock).

import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { goalQueries, taskQueries } from "@/lib/queries";
import { getElapsedMs, useTimerStore } from "@/lib/timer-store";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";
import { Icon } from "@/components/ui/Icon";

/**
 * Horizontal room reserved on the right so the banner never runs under the
 * floating hamburger drawn in _layout.tsx (`hamburgerButton`: 40pt wide +
 * spacing.lg right margin + spacing.sm top margin ≈ 64pt of footprint).
 * Matches the identical HAMBURGER_CLEARANCE constant timer.tsx and
 * index.tsx already reserve in their own headers for the same button.
 */
const HAMBURGER_CLEARANCE = 64;

const TICK_MS = 1000;

/**
 * Placeholder for a session tracked without a task or goal attached.
 * Deliberately the same string useTimerNotification.ts's describeSession()
 * falls back to ("Focus session") and timer.tsx's UNRESOLVED_TARGET_LABEL —
 * one wording for "nothing attached", wherever the session surfaces.
 */
const UNTITLED_SESSION_LABEL = "Focus session";

/**
 * hh:mm:ss once past an hour, mm:ss below it — the same always-padded shape
 * TimerRing.tsx's formatClockParts uses for the Timer screen's own clock, so
 * the banner and the hero never disagree on how a duration reads. Kept as a
 * private copy rather than an import: that function isn't exported, and
 * duplicating four lines here is cheaper than widening TimerRing's public
 * surface for it.
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

export interface GlobalTrackingBannerProps {
  /**
   * Reports the banner's own content height (the pill, NOT the safe-area
   * inset above it — the caller's screens each already add that inset
   * themselves via their own `<SafeAreaView edges={["top"]}>`, so double
   * counting it here would push every screen down twice). The layout uses
   * this to pad `<Tabs/>` by exactly that much while the banner is showing,
   * so it pushes screen content down instead of painting over it. Fires
   * with 0 when the banner goes back to idle.
   */
  onContentHeightChange?: (height: number) => void;
}

export function GlobalTrackingBanner({
  onContentHeightChange,
}: GlobalTrackingBannerProps) {
  const router = useRouter();

  const status = useTimerStore((s) => s.status);
  const startedAt = useTimerStore((s) => s.startedAt);
  const pausedElapsedMs = useTimerStore((s) => s.pausedElapsedMs);
  const timerTaskId = useTimerStore((s) => s.taskId);
  const timerGoalId = useTimerStore((s) => s.goalId);

  // Same resolution pattern timer.tsx's activeTask/activeGoal use: the store
  // only persists ids, so the title comes from matching those ids against
  // the already-fetched task/goal lists (shared react-query cache — this
  // doesn't add a network request beyond what Today/Timer/etc. already make).
  const tasksQuery = useQuery(taskQueries.list());
  const goalsQuery = useQuery(goalQueries.list());
  const activeTask = useMemo(
    () => tasksQuery.data?.find((t) => t.id === timerTaskId) ?? null,
    [tasksQuery.data, timerTaskId],
  );
  const activeGoal = useMemo(
    () => goalsQuery.data?.find((g) => g.id === timerGoalId) ?? null,
    [goalsQuery.data, timerGoalId],
  );
  const label =
    activeTask?.title ?? activeGoal?.title ?? UNTITLED_SESSION_LABEL;
  const accentColor =
    activeGoal?.color ?? activeTask?.goal?.color ?? colors.primary;

  // Re-renders once a second while running so the clock actually moves.
  // Skipped entirely while paused/idle — a paused elapsed value is a fixed
  // number (see getElapsedMs), so there is nothing to tick.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => forceTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [status]);

  // Hooks must run unconditionally, so this sits above the early return
  // below — it's the only path that fires once status flips back to idle
  // and the Pressable (and its onLayout) stop rendering entirely.
  useEffect(() => {
    if (status === "idle") onContentHeightChange?.(0);
  }, [status, onContentHeightChange]);

  if (status === "idle") return null;

  const isPaused = status === "paused";
  const elapsedMs = getElapsedMs({ status, startedAt, pausedElapsedMs });
  const elapsedLabel = formatElapsed(elapsedMs);

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top"]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={() => router.push("/timer")}
        // + spacing.sm: onLayout reports the Pressable's own box, which
        // excludes its `marginTop` (margin sits outside an element's
        // reported layout rect) — added back in so the caller gets the
        // banner's true total footprint, marginTop included.
        onLayout={(e) =>
          onContentHeightChange?.(e.nativeEvent.layout.height + spacing.sm)
        }
        style={({ pressed }) => [
          styles.banner,
          pressed && styles.bannerPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${isPaused ? "Paused" : "Tracking"} ${label}, ${elapsedLabel} elapsed`}
        accessibilityHint="Opens the timer"
      >
        <View
          style={[
            styles.dot,
            {
              backgroundColor: isPaused
                ? colors.mutedForegroundLight
                : accentColor,
            },
          ]}
        />

        <View style={styles.textGroup}>
          <Text style={styles.statusText}>
            {isPaused ? "Paused" : "Tracking"}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>

        <Text style={styles.elapsed}>{elapsedLabel}</Text>
        <Icon name="chevron" size={16} color={colors.white} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginLeft: spacing.lg,
    marginRight: HAMBURGER_CLEARANCE,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.foreground,
    ...shadows.fab,
  },
  bannerPressed: {
    backgroundColor: colors.foregroundPressed,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  statusText: {
    ...typography.label,
    color: colors.white,
    opacity: 0.7,
  },
  label: {
    ...typography.bodySmall,
    color: colors.white,
    fontWeight: "700",
  },
  elapsed: {
    ...typography.body,
    color: colors.white,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
