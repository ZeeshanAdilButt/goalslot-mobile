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
//
// It also watches the CROSS-DEVICE session (`/timer/session`), not just the
// local store. Reading the local store alone was why "if there is a session
// running anywhere, show me that it is running so I can stop it" wasn't true:
// a timer started on the web app, on another phone, or by the Coach lives
// only on the server, so this banner stayed blank and the only place in the
// whole app that showed it was the Timer tab itself.

import { useEffect, useMemo, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { goalQueries, taskQueries, timerSessionQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { cleanLabel, isDormantServerSession, resolveEffectiveTimer } from "@/lib/timer-attribution";
import { getElapsedMs, useTimerStore } from "@/lib/timer-store";
import { useTrackingBannerHeight } from "@/lib/tracking-banner-store";
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
 * How often this banner re-checks for a session started elsewhere.
 *
 * Deliberately slower than the Timer screen's own 20s (see timer.tsx's
 * SERVER_SESSION_POLL_MS): this component is mounted for the entire
 * authenticated life of the app, not just while one tab is open, so its poll
 * is the app's permanent background cost. A minute is well inside "I opened
 * my phone and it already knows" while being three times cheaper on battery
 * and data. Both share one query key, so react-query keeps a single request
 * in flight and the screen's faster cadence simply wins while it is open.
 */
const SERVER_SESSION_POLL_MS = 60_000;

/**
 * The cadence used instead while the server says nothing is running.
 *
 * The 60s above is the right number for the case it was chosen for — a live
 * session, which really can be stopped or paused from another device while
 * the user is looking at some other tab here. But for most users most of the
 * time there is no session at all, and in that state the poll can only ever
 * discover "a session just started somewhere else". The AppState listener
 * below already invalidates on every foreground, which is overwhelmingly how
 * that discovery actually happens ("I picked my phone back up"), so the
 * minute cadence was re-asking a question with a known answer ~1,400 times a
 * day per installed app for nothing.
 *
 * Five minutes idle keeps a genuine cross-device start visible without the
 * user doing anything, and the instant a session does appear the query flips
 * back to the 60s cadence on its own.
 */
const IDLE_SERVER_SESSION_POLL_MS = 300_000;

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

  const localStatus = useTimerStore((s) => s.status);
  const localStartedAt = useTimerStore((s) => s.startedAt);
  const localPausedElapsedMs = useTimerStore((s) => s.pausedElapsedMs);
  const localTaskId = useTimerStore((s) => s.taskId);
  const localGoalId = useTimerStore((s) => s.goalId);

  const serverSessionQuery = useQuery({
    ...timerSessionQueries.active(),
    // Same "is there anything worth watching?" test the render below applies,
    // so the fast cadence is spent only on sessions the banner would actually
    // show. See IDLE_SERVER_SESSION_POLL_MS.
    refetchInterval: (query) => {
      const session = query.state.data ?? null;
      return session && !isDormantServerSession(session)
        ? SERVER_SESSION_POLL_MS
        : IDLE_SERVER_SESSION_POLL_MS;
    },
  });
  // A dormant row (paused, no time, nothing attached) is excluded so the
  // banner never advertises a session the user has no way to recognise —
  // the same exclusion the Timer screen applies to its own rendering.
  const rawServerSession = serverSessionQuery.data ?? null;
  const serverSession = isDormantServerSession(rawServerSession) ? null : rawServerSession;

  // A poll alone can be up to a minute stale, and the most common way to
  // find out about a session started elsewhere is picking the phone back up.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void queryClient.invalidateQueries({ queryKey: timerSessionQueries.timerSessionQueries.all });
      }
    });
    return () => subscription.remove();
  }, []);

  // Exactly the merge the Timer screen performs, from the same helper, so
  // the banner and the hero can never disagree about what is running.
  const { status, startedAt, pausedElapsedMs, taskId, goalId } = resolveEffectiveTimer(serverSession, {
    status: localStatus,
    startedAt: localStartedAt,
    pausedElapsedMs: localPausedElapsedMs,
    taskId: localTaskId,
    goalId: localGoalId,
  });

  // Same resolution pattern timer.tsx's activeTask/activeGoal use: the store
  // only persists ids, so the title comes from matching those ids against
  // the already-fetched task/goal lists (shared react-query cache — this
  // doesn't add a network request beyond what Today/Timer/etc. already make).
  const tasksQuery = useQuery(taskQueries.list());
  const goalsQuery = useQuery(goalQueries.list());
  const activeTask = useMemo(() => tasksQuery.data?.find((t) => t.id === taskId) ?? null, [tasksQuery.data, taskId]);
  const activeGoal = useMemo(() => goalsQuery.data?.find((g) => g.id === goalId) ?? null, [goalsQuery.data, goalId]);
  // A server session carries its own titles, so it can name itself before —
  // or without — the goal/task lists ever loading, including its free-text
  // `taskName` (a Coach session logged as "gym" has no goal or task behind
  // it at all).
  const label =
    cleanLabel(activeTask?.title) ??
    cleanLabel(activeGoal?.title) ??
    cleanLabel(serverSession?.task?.title) ??
    cleanLabel(serverSession?.goal?.title) ??
    cleanLabel(serverSession?.taskName) ??
    UNTITLED_SESSION_LABEL;
  const accentColor =
    activeGoal?.color ?? activeTask?.goal?.color ?? serverSession?.goal?.color ?? colors.primary;

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
  // and the Pressable (and its onLayout) stop rendering entirely. Also
  // resets the shared store below so <ConnectivityPill/> stops reserving
  // room for a banner that's no longer on screen.
  useEffect(() => {
    if (status === "idle") {
      onContentHeightChange?.(0);
      useTrackingBannerHeight.getState().setHeight(0);
    }
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
        // banner's true total footprint, marginTop included. Mirrored into
        // the shared store (not just the prop) so <ConnectivityPill/>, which
        // lives one layout up and never receives this prop directly, can
        // read the same figure and stack itself below instead of on top.
        onLayout={(e) => {
          const height = e.nativeEvent.layout.height + spacing.sm;
          onContentHeightChange?.(height);
          useTrackingBannerHeight.getState().setHeight(height);
        }}
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
