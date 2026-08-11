// The Time Tracker's hero: a pair of concentric progress rings wrapped
// around the running clock.
//
// WHY two rings. A count-up stopwatch has no "total" to fill, so a single
// arc has nothing to measure against. These read like a clock face instead:
// the thick outer arc sweeps once per MINUTE (fast enough to be visibly
// alive, the way a second hand is) and the thin inner arc sweeps once per
// HOUR (slow context for how deep into the session you are). Neither is a
// percentage of anything the user has to interpret.
//
// WHY the tick loop lives here rather than in the screen. timer.tsx used to
// force a re-render of the whole screen — picker, controls, recent-entries
// list — every second just to move the digits. This component owns that
// interval now and is the only thing that re-renders per tick; the arcs
// themselves never re-render at all, they're driven on the UI thread by
// Reanimated shared values (see `useAnimatedProps` below), so the sweep
// stays smooth even while the JS thread is busy.
//
// Elapsed time is still read from `getElapsedMs` (src/lib/timer-store.ts) —
// the same pure now-minus-startedAt function the rest of the app uses. This
// component adds no duration math of its own.

import { useEffect, useMemo, useReducer } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import { useReduceMotion } from "@/hooks/useReduceMotion";
import { getElapsedMs, type TimerStatus } from "@/lib/timer-store";
import { colors, spacing, typography } from "@/theme/tokens";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TICK_MS = 1000;
const OUTER_STROKE = 14;
const INNER_STROKE = 4;
/** Clear space between the two rings so they read as separate tracks. */
const RING_GAP = 6;
const HEAD_RADIUS = 5;
/**
 * Approximate advance width of "00:00:00" in ems for the bold system face:
 * six digits at ~0.58em plus two colons at ~0.30em, rounded up for headroom.
 * Used to derive a font size that is guaranteed to fit the inner circle.
 */
const CLOCK_WIDTH_IN_EMS = 4.3;

/**
 * Always-padded hh/mm/ss parts. Deliberately not `formatDuration` from
 * packages/shared/src/scheduling/time.ts, which formats whole minutes for
 * summaries ("1h 20m") rather than a seconds-precision ticking display.
 * Always showing hours (rather than hiding a leading "00:") mirrors
 * dw-time-web's TimerDisplay
 * (dw-time-web/src/features/time-tracker/components/timer-display.tsx:37-39)
 * so the clock reads identically across platforms.
 */
function formatClockParts(ms: number): { hh: string; mm: string; ss: string } {
  const totalSeconds = Math.floor(ms / 1000);
  return {
    hh: String(Math.floor(totalSeconds / 3600)).padStart(2, "0"),
    mm: String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0"),
    ss: String(totalSeconds % 60).padStart(2, "0"),
  };
}

/**
 * Spoken form of the elapsed time, and deliberately COARSER than the digits
 * on screen: an `accessibilityLabel` that changed every second would make
 * VoiceOver/TalkBack re-read the whole clock on every tick for as long as it
 * held focus, which is unusable. Minutes are the finest unit anything else in
 * the app reports (`formatDuration` in packages/shared), so this string
 * changes at most once a minute.
 */
function describeElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (parts.length === 0) return "Less than a minute";
  return parts.join(" ");
}

/**
 * The visible caption is only worth speaking while RUNNING, where it carries
 * the wall-clock start ("Started 2:32 PM"). Paused and idle set it to
 * "Paused" / "Elapsed", which would just repeat the status word back.
 */
function buildClockLabel(elapsedMs: number, status: TimerStatus, caption: string | undefined): string {
  const elapsed = `${describeElapsed(elapsedMs)} elapsed`;
  if (status === "running") return caption ? `${elapsed}. ${caption}` : `${elapsed}. Tracking`;
  if (status === "paused") return `${elapsed}. Paused`;
  return elapsed;
}

export interface TimerRingProps {
  status: TimerStatus;
  /** Epoch ms the current running segment began; null while paused/idle. */
  startedAt: number | null;
  pausedElapsedMs: number;
  /** Diameter in points. The caller sizes this against the viewport. */
  size: number;
  /** Category/goal tint for the arc. Falls back to brand yellow when nothing is selected. */
  accentColor?: string | null;
  /** Small line under the digits — session context, e.g. "Started at 2:32 PM". */
  caption?: string;
}

export function TimerRing({
  status,
  startedAt,
  pausedElapsedMs,
  size,
  accentColor,
  caption,
}: TimerRingProps) {
  const reduceMotion = useReduceMotion();
  const accent = accentColor ?? colors.primary;

  // Re-renders this component (and only this component) once a second so the
  // digits below actually tick. No elapsed value is stored — it's recomputed
  // from the store's timestamps on every render, which is what keeps a
  // backgrounded or restarted session accurate. See timer-store.ts.
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // A self-re-arming timeout aimed at the next whole second, NOT
  // `setInterval(tick, 1000)`.
  //
  // setInterval schedules each callback ~1000ms after the previous one
  // *ran*, so every late frame permanently shifts the phase. The digits are
  // derived from `Date.now() - startedAt` rather than counted up, so that
  // accumulated drift doesn't make the clock wrong — it makes it *skip*: once
  // the phase has slipped a full second (a few minutes of a busy JS thread at
  // a handful of ms per tick) the display jumps 00:00:01 -> 00:00:03.
  // Re-deriving the delay from the real elapsed value each time pins the flip
  // to the true second boundary for the life of the session.
  useEffect(() => {
    if (status !== "running") return;

    let handle: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remainder = getElapsedMs({ status, startedAt, pausedElapsedMs }) % TICK_MS;
      // Floor of one frame: a boundary we've only just crossed must not
      // schedule a busy-loop of ~0ms timeouts.
      handle = setTimeout(() => {
        tick();
        schedule();
      }, Math.max(16, TICK_MS - remainder));
    };
    schedule();

    return () => clearTimeout(handle);
  }, [status, startedAt, pausedElapsedMs]);

  // Foregrounding after a background stretch. JS timers are suspended (iOS)
  // or heavily throttled (Android) while the app is away, so the pending
  // timeout above can land up to a second late — long enough to see a stale
  // clock in the app-switcher snapshot and on the first frame back. The
  // elapsed value is never *wrong* (it is always now-minus-startedAt); this
  // only forces the repaint to happen immediately rather than at the next
  // tick. `schedule()` re-derives its delay from the fresh elapsed value on
  // the following tick, so the boundary alignment self-heals too.
  useEffect(() => {
    if (status !== "running") return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") tick();
    });
    return () => subscription.remove();
  }, [status]);

  const elapsedMs = getElapsedMs({ status, startedAt, pausedElapsedMs });
  const { hh, mm, ss } = formatClockParts(elapsedMs);

  const geometry = useMemo(() => {
    const center = size / 2;
    const outerRadius = (size - OUTER_STROKE) / 2 - HEAD_RADIUS;
    const innerRadius = outerRadius - OUTER_STROKE / 2 - RING_GAP - INNER_STROKE / 2;
    return {
      center,
      outerRadius,
      innerRadius,
      outerCircumference: 2 * Math.PI * outerRadius,
      innerCircumference: 2 * Math.PI * innerRadius,
    };
  }, [size]);

  const secondsProgress = useSharedValue(0);
  const minutesProgress = useSharedValue(0);

  useEffect(() => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    // Target the END of the current second/minute so each step animates
    // across the full tick interval — that's what turns a once-a-second
    // update into a continuous sweep rather than a visible jump.
    const secondsTarget = ((totalSeconds % 60) + 1) / 60;
    const minutesTarget = ((totalSeconds % 3600) + 1) / 3600;
    const animate = status === "running" && !reduceMotion;
    const step = (target: number) =>
      animate ? withTiming(target, { duration: TICK_MS, easing: Easing.linear }) : target;

    // Wrapping past the top of the minute/hour must snap to zero, otherwise
    // the arc animates backwards all the way round.
    if (secondsTarget < secondsProgress.value) secondsProgress.value = 0;
    if (minutesTarget < minutesProgress.value) minutesProgress.value = 0;

    secondsProgress.value = step(secondsTarget);
    minutesProgress.value = step(minutesTarget);
  }, [elapsedMs, status, reduceMotion, secondsProgress, minutesProgress]);

  const outerArcProps = useAnimatedProps(() => ({
    strokeDashoffset: geometry.outerCircumference * (1 - secondsProgress.value),
  }));

  const innerArcProps = useAnimatedProps(() => ({
    strokeDashoffset: geometry.innerCircumference * (1 - minutesProgress.value),
  }));

  // A small filled dot riding the leading edge of the outer arc — the detail
  // that makes the sweep read as motion rather than a filling bar.
  const headProps = useAnimatedProps(() => {
    const angle = -Math.PI / 2 + 2 * Math.PI * secondsProgress.value;
    return {
      cx: geometry.center + geometry.outerRadius * Math.cos(angle),
      cy: geometry.center + geometry.outerRadius * Math.sin(angle),
    };
  });

  // Derived from the actual clear width inside the inner track rather than
  // from `size` directly, so the readout is guaranteed never to collide with
  // the rings on a small phone — and never uses auto-shrinking text, which
  // would visibly resize the clock as digits tick over.
  const clearWidth = 2 * geometry.innerRadius - INNER_STROKE;
  const digitSize = Math.round(Math.min(56, Math.max(26, clearWidth / CLOCK_WIDTH_IN_EMS)));
  const isIdle = status === "idle";

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="timerRingSweep" x1="0" y1="0" x2="1" y2="1">
            {/* Two stops of the SAME accent at different opacities — a real
                gradient without inventing a second colour that isn't in the
                category palette or the theme. */}
            <Stop offset="0" stopColor={accent} stopOpacity={0.4} />
            <Stop offset="1" stopColor={accent} stopOpacity={1} />
          </LinearGradient>
        </Defs>

        <Circle
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.outerRadius}
          stroke={colors.secondary}
          strokeWidth={OUTER_STROKE}
          fill="none"
        />
        <Circle
          cx={geometry.center}
          cy={geometry.center}
          r={geometry.innerRadius}
          stroke={colors.secondary}
          strokeWidth={INNER_STROKE}
          fill="none"
        />

        {!isIdle ? (
          <>
            {/* rotation -90 puts 0% at 12 o'clock instead of 3 o'clock. */}
            <AnimatedCircle
              cx={geometry.center}
              cy={geometry.center}
              r={geometry.innerRadius}
              stroke={accent}
              strokeOpacity={0.35}
              strokeWidth={INNER_STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={geometry.innerCircumference}
              animatedProps={innerArcProps}
              originX={geometry.center}
              originY={geometry.center}
              rotation={-90}
            />
            <AnimatedCircle
              cx={geometry.center}
              cy={geometry.center}
              r={geometry.outerRadius}
              stroke="url(#timerRingSweep)"
              strokeWidth={OUTER_STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={geometry.outerCircumference}
              animatedProps={outerArcProps}
              originX={geometry.center}
              originY={geometry.center}
              rotation={-90}
            />
            {/* No `rotation` here, unlike the arcs above: the -90° offset is
                already baked into the angle `headProps` computes, so rotating
                the element as well would put the dot half a turn out. */}
            <AnimatedCircle
              cx={geometry.center}
              cy={geometry.center - geometry.outerRadius}
              r={HEAD_RADIUS}
              fill={accent}
              animatedProps={headProps}
            />
          </>
        ) : null}
      </Svg>

      {/* One accessibility node for the whole readout. Ungrouped, the five
          Text children are focused one at a time and read as "01", ":",
          "23" — the colons are announced as punctuation and the number of
          swipes to cross the hero triples. `accessibilityLiveRegion="none"`
          is explicit rather than assumed: nothing here may auto-announce on
          every tick (see `describeElapsed` for the matching coarse label). */}
      <View
        style={styles.centerContent}
        pointerEvents="none"
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion="none"
        accessibilityLabel={buildClockLabel(elapsedMs, status, caption)}
      >
        <View style={styles.clockRow}>
          <Text style={[styles.digits, { fontSize: digitSize }]}>{hh}</Text>
          <Text style={[styles.colon, { fontSize: digitSize * 0.78 }]}>:</Text>
          <Text style={[styles.digits, { fontSize: digitSize }]}>{mm}</Text>
          <Text style={[styles.colon, { fontSize: digitSize * 0.78 }]}>:</Text>
          {/* Seconds sit one step back in the hierarchy, matching the web
              clock's `text-zinc-500` seconds span. */}
          <Text style={[styles.digits, styles.seconds, { fontSize: digitSize }]}>{ss}</Text>
        </View>
        {caption ? (
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerContent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  clockRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  digits: {
    fontWeight: "700",
    // Tabular figures keep every digit the same advance width, so the
    // readout doesn't shuffle sideways as the seconds roll over.
    fontVariant: ["tabular-nums"],
    letterSpacing: -1.5,
    color: colors.foreground,
  },
  seconds: {
    color: colors.mutedForeground,
  },
  colon: {
    fontWeight: "700",
    color: colors.border,
    marginHorizontal: 1,
  },
  caption: {
    ...typography.label,
    color: colors.mutedForeground,
    maxWidth: "70%",
    textAlign: "center",
  },
});
