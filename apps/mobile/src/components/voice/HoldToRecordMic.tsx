// WhatsApp-style hold/slide-to-lock recording, layered on top of MicOrb and
// useVoiceCapture without changing either. Neither owns an interaction model
// beyond "something called start/stop" — this is the thing that decides WHEN
// those get called from a real touch.
//
// Three ways this can end, all starting from the same press-down:
//
//   1. A quick tap (pressed and released again fast, no drag) — unchanged
//      from before this component existed: the mic opens and STAYS open,
//      exactly like the plain `Pressable onPress` toggle every mic in this
//      app used until now. A second tap (or the dock's own controls) closes
//      it. This is the graceful-degradation path: a user who never holds the
//      button at all gets the old, fully-tested tap-to-toggle behaviour with
//      nothing missing.
//   2. A deliberate hold (still down past HOLD_ENGAGE_MS) released WITHOUT
//      sliding up — release-to-send, the WhatsApp voice-note convention:
//      the recording stops and commits right on release, exactly as if the
//      user had tapped a second time. Holding is what signals "I meant to
//      do the WhatsApp gesture", so only a hold's release triggers this;
//      a quick tap's release does nothing (see path 1).
//   3. A hold dragged upward past LOCK_DISTANCE before release — the
//      recording locks into hands-free mode: a "Locked" badge appears, the
//      finger can lift with no effect, and a dedicated Stop control
//      (rendered by this component, a plain always-tappable Pressable) is
//      what ends it from here on. This is the fix for "I couldn't talk fast
//      enough" — once locked, there is no clock running against how long
//      the user takes.
//
// A second real touch landing while the mic is already open (whichever path
// opened it) is always treated as "stop" on press-down, not on release —
// that is what let a WhatsApp-style second tap and the old toggle's second
// tap both keep working through the same gesture.
//
// Screen-reader activation goes through the exact same `Pressable`/`onPress`
// every mic in this app already used (MicOrb's own, before `interactive`
// existed) — VoiceOver/TalkBack's synthetic "activate" calls it directly,
// bypassing the native touch stream entirely, so it is unaffected by
// whichever of the three paths above a real touch would have taken. A real
// touch never reaches this `onPress` at all: the wrapping PanResponder below
// claims the responder on every touch-start via
// `onStartShouldSetPanResponderCapture` (capture phase runs root-to-leaf,
// ahead of the inner Pressable's own bubble-phase claim), the same
// "whichever gesture claims the touch first wins, the other's press handler
// is never called" arbitration SheetHandle.tsx's header comment describes
// for the opposite case. That is why `onTogglePress` here is safe to give
// the exact old toggle semantics without it ever double-firing alongside
// `onHoldStart`/`onCommit`.
//
// PLAIN CORE-RN PanResponder, DELIBERATELY, NOT react-native-gesture-handler.
// This used to be built on Gesture.Pan with its callbacks running as
// worklets on the UI thread (`runOnJS` back to JS for each of onHoldStart/
// onCommit/etc). On a real Android device, opening this exact gesture on the
// Notes page — the one screen that also hosts the @10play/tentap-editor
// WebView — crashed the whole app on the very first press: a native
// `com.facebook.jni.CppException: [Worklets] Tried to synchronously call a
// Remote Function` thrown from inside react-native-gesture-handler's own
// worklet event-dispatch path (useAnimatedGesture.ts calling into
// react-native-worklets' scheduleOnRN), before any JS frame — invisible to
// try/catch and to ScreenErrorBoundary alike, since neither can intercept an
// exception thrown on the UI thread with no JS call frame above it.
// Confirmed on-device (adb logcat) and NOT reproducible the same way for
// AppDrawer.tsx's own Gesture.Pan + runOnJS usage, which points at
// something specific to this screen (most likely the co-mounted WebView)
// rather than a blanket reanimated/gesture-handler incompatibility — so
// AppDrawer's pan gesture is left as-is; only this component, the one that
// actually crashed, is rewritten.
//
// PanResponder runs its callbacks on the JS thread through React Native's
// original core responder system — no worklets, no UI-thread dispatch, no
// JSI call into react-native-worklets at all — so this class of crash has
// nowhere left to come from. The drag-hint animation still reads a
// reanimated `useSharedValue` for a smooth `useAnimatedStyle`, which stays
// completely safe here: writing `sharedValue.value = ...` from a plain JS
// callback (not a worklet) is standard, supported usage and is how shared
// values are driven from event handlers throughout this app already.
import { useCallback, useEffect, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { Icon } from "@/components/ui/Icon";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import type { VoiceCaptureStatus } from "@/hooks/useVoiceCapture";
import { hapticRecordingLocked } from "@/lib/haptics";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { MicOrb } from "./MicOrb";

/** How long a press has to stay down before its release counts as "stop", rather than the old tap-to-toggle's "leave it open". */
const HOLD_ENGAGE_MS = 350;

/** How far up (px) a hold has to drag before it locks into hands-free recording. WhatsApp's own affordance sits in roughly this range. */
const LOCK_DISTANCE = 72;

/** Visual travel cap on the drag hint — past this the hint already reads as "locked in", so further finger movement shouldn't keep dragging it further. */
const DRAG_VISUAL_MAX = LOCK_DISTANCE * 1.15;

export interface HoldToRecordMicProps {
  status: VoiceCaptureStatus;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /**
   * A real touch went down while at rest (idle/error/success/unavailable —
   * every status the old tap-to-toggle would also have called `start()`
   * for). Fired on EVERY press-down that isn't a stop or a blocked-state tap,
   * whether it turns out to be a quick tap or a genuine hold — the mic has
   * to open immediately either way, or the button reads as laggy.
   */
  onHoldStart: () => void;
  /**
   * Stop and commit: a held press released before locking, a second real
   * touch landing while already listening, or the locked badge's own Stop
   * control. Wire this to the same function a plain "stop" button would
   * call — never to the toggle function, which would risk re-starting if
   * `start()` from `onHoldStart` hasn't resolved yet on a very fast
   * tap-hold-release.
   */
  onCommit: () => void;
  /**
   * Screen-reader activation only — the exact tap-to-toggle handler this mic
   * used before this component existed. A real touch never reaches this;
   * see the header comment for why that's safe to rely on.
   */
  onTogglePress: () => void;
}

/**
 * True for every status a fresh press-down should treat as "begin
 * recording" — i.e. everything the old plain-tap toggle would have called
 * `start()` for. Kept as an exhaustive switch (not `status !== "listening"
 * && ...`) so a new VoiceCaptureStatus added later fails to compile here
 * instead of silently falling into the wrong branch.
 */
function isStartEligible(status: VoiceCaptureStatus): boolean {
  switch (status) {
    case "idle":
    case "error":
    case "success":
    case "unavailable":
      return true;
    case "listening":
    case "processing":
    case "permission-denied":
      return false;
  }
}

export function HoldToRecordMic({
  status,
  size = 56,
  style,
  accessibilityLabel,
  accessibilityHint,
  onHoldStart,
  onCommit,
  onTogglePress,
}: HoldToRecordMicProps) {
  const reduceMotion = useReduceMotion();
  const [locked, setLocked] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Refs, not the props themselves, so the PanResponder below can be built
  // once (its callbacks read live prop values through these) instead of
  // being torn down and rebuilt on every parent re-render, which is what
  // closing over the props directly would require.
  const statusRef = useRef(status);
  statusRef.current = status;
  const holdStartRef = useRef(onHoldStart);
  holdStartRef.current = onHoldStart;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const toggleRef = useRef(onTogglePress);
  toggleRef.current = onTogglePress;

  // Whether THIS gesture is the one that opened the mic (a fresh press-down
  // while at rest) — only that kind commits on release. A "stop" touch or a
  // blocked-state touch is handled entirely on press-down and has nothing
  // left to do when the finger lifts.
  const heldRef = useRef(false);
  const pressStartedAtRef = useRef(0);
  // Plain JS-thread ref, not a reanimated shared value read from a worklet:
  // every callback that touches this now runs on the JS thread already, so
  // there is nothing left that needs UI-thread-safe storage.
  const lockedRef = useRef(false);

  const dragY = useSharedValue(0);

  const callCommit = useCallback(() => commitRef.current(), []);
  const callToggle = useCallback(() => toggleRef.current(), []);

  // A commit (whichever path triggered it) or the hook settling back to a
  // non-listening status both mean this session is over — reset the lock and
  // the drag visual so the NEXT press starts from a clean slate rather than
  // inheriting a lock from the previous recording.
  useEffect(() => {
    if (status === "listening") return;
    lockedRef.current = false;
    setLocked(false);
    setDragging(false);
    dragY.value = withTiming(0, { duration: 150 });
  }, [status, dragY]);

  const finalizeGesture = useCallback(() => {
    if (heldRef.current) {
      const wasLocked = lockedRef.current;
      const heldLongEnough = Date.now() - pressStartedAtRef.current >= HOLD_ENGAGE_MS;
      // Path 1 (quick tap): leave it open, matching the pre-existing
      // tap-to-toggle behaviour exactly. Path 2's release-to-stop is a
      // REAL commit here; path 3 (locked) is handled by the badge's own
      // Stop control instead, so it does nothing on release.
      if (!wasLocked && heldLongEnough) {
        commitRef.current();
      }
    }
    heldRef.current = false;
    if (!lockedRef.current) {
      dragY.value = withSpring(0, { damping: 16 });
    }
    setDragging(false);
  }, [dragY]);

  // Lazy useState initializer, not useRef(PanResponder.create(...)): a
  // useRef initial-value expression re-runs on every render (only its first
  // result is ever kept), which would rebuild the whole PanResponder object
  // every time for nothing. useState's initializer function form is the one
  // React hook guaranteed to run exactly once.
  const [panResponder] = useState(() =>
    PanResponder.create({
      // Capture (root-to-leaf) rather than the bubble-phase
      // onStartShouldSetPanResponder: claiming here runs BEFORE the inner
      // Pressable gets a chance to claim its own responder, matching the old
      // Gesture.Pan's `minDistance(0)` "claims the touch stream immediately"
      // behaviour so a real touch never reaches `onTogglePress`.
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const currentStatus = statusRef.current;
        if (currentStatus === "listening") {
          // A second real touch while already open — the WhatsApp
          // second-tap-to-stop / old toggle's second-tap both land here.
          heldRef.current = false;
          commitRef.current();
          return;
        }
        if (!isStartEligible(currentStatus)) {
          // permission-denied / processing — replicate the exact behaviour
          // the tap-to-toggle handler already has for these (open Settings,
          // or a no-op while busy). No drag semantics make sense here.
          heldRef.current = false;
          toggleRef.current();
          return;
        }
        heldRef.current = true;
        pressStartedAtRef.current = Date.now();
        lockedRef.current = false;
        dragY.value = 0;
        holdStartRef.current();
      },
      onPanResponderMove: (_event, gestureState) => {
        if (!heldRef.current || lockedRef.current) return;
        const clamped = Math.max(-DRAG_VISUAL_MAX, Math.min(0, gestureState.dy));
        dragY.value = clamped;
        setDragging(clamped < -8);
        if (gestureState.dy <= -LOCK_DISTANCE) {
          lockedRef.current = true;
          dragY.value = withSpring(0, { damping: 16 });
          setLocked(true);
          hapticRecordingLocked();
        }
      },
      onPanResponderRelease: finalizeGesture,
      // A parent (e.g. a ScrollView) stealing the responder mid-gesture is
      // not a normal release, but the recording this started should not be
      // left hanging either — same finalize path as a real release.
      onPanResponderTerminate: finalizeGesture,
    }),
  );

  const dragStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? (dragY.value < -4 ? 1 : 0) : Math.min(1, -dragY.value / LOCK_DISTANCE),
    transform: [{ translateY: reduceMotion ? 0 : dragY.value * 0.5 }],
  }));

  const diameter = Math.max(minTouchTarget, size);
  const busy = status === "listening" || status === "processing";
  const label =
    accessibilityLabel ??
    (status === "listening" ? "Recording. Tap to stop, or hold and slide up to lock" : "Hold to record");

  return (
    <View style={styles.wrap}>
      {/* The slide-up hint, shown only while dragging and not yet locked —
          gone the instant the gesture ends or locks, so it never lingers as
          stale advice once the state it was describing is over. */}
      {dragging && !locked ? (
        <Animated.View style={[styles.hint, dragStyle]} pointerEvents="none">
          <Icon name="chevron-up" size={14} color={colors.mutedForeground} />
          <Text style={styles.hintText}>Slide up to lock</Text>
        </Animated.View>
      ) : null}

      {/* The locked indicator + its own explicit Stop control. Deliberately
          NOT part of the pan gesture at all — a plain Pressable, reachable
          the normal way by touch and by a screen reader alike, since the
          finger that dragged it here is no longer relevant once locked. */}
      {locked ? (
        <View style={styles.lockBadgeRow} accessibilityLiveRegion="polite">
          <View style={styles.lockBadge}>
            <Icon name="lock" size={12} color={colors.primaryForeground} />
            <Text style={styles.lockBadgeText}>Locked</Text>
          </View>
          <Pressable
            onPress={callCommit}
            accessibilityRole="button"
            accessibilityLabel="Stop recording"
            accessibilityHint="Ends hands-free recording and uses what you said"
            style={({ pressed }) => [styles.stopButton, pressed && styles.stopButtonPressed]}
          >
            <Text style={styles.stopButtonText}>Stop</Text>
          </Pressable>
        </View>
      ) : null}

      <View {...panResponder.panHandlers} style={styles.touchArea}>
        <Pressable
          onPress={callToggle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ busy }}
          hitSlop={8}
          style={styles.touchArea}
        >
          <MicOrb status={status} onPress={() => {}} interactive={false} size={diameter} style={style} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  touchArea: {
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs / 2,
    marginBottom: spacing.xs,
  },
  hintText: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  lockBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  lockBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.foreground,
  },
  lockBadgeText: {
    ...typography.caption,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
  stopButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  stopButtonPressed: {
    opacity: 0.75,
  },
  stopButtonText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.destructive,
    textDecorationLine: "underline",
  },
});
