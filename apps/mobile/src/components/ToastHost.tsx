// Mounted once in app/_layout.tsx, above every route. Renders whatever's
// queued in src/lib/toast-store.ts — the landing spot that finally exists
// for the sync engine's `notify` callback (packages/shared/src/offline/sync.ts,
// wired through src/lib/api-client.ts's `notify()`) and the dropped-time-entry
// hook (src/lib/offline.ts), both of which previously reached only a
// `console.warn`.
//
// Visual language deliberately mirrors this app's card convention (glass-card:
// a light surface, hairline border, soft shadow, rounded corners) rather than
// the flat solid-color pill toasts/snackbars usually default to — a toast is
// still a card floating over the screen, and reusing the same shadows.raised +
// radii.card + colors.border vocabulary every sheet and popover already uses
// is what makes it read as *this app's* toast instead of a generic
// react-native-toast-message default. Each ToastKind gets its own icon and a
// tinted icon chip (the same "colored icon container on a neutral card" shape
// as stat-card.tsx's accent rings) so success/offline/error are legible at a
// glance from the icon alone, not just from reading the copy.
//
// A toast carrying a `ToastAction` (toast-store.ts) renders that action as a
// trailing pill — the app's only undo affordance. Two things about that row
// are deliberate and easy to "simplify" back into bugs: the card itself stops
// being tap-to-dismiss when an action is present, and the press routes
// through the store's `runAction` rather than calling the handler here. Both
// are explained at their call sites below.

import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOutDown, LinearTransition } from "react-native-reanimated";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { hapticLight } from "@/lib/haptics";
import { useToastStore, type ToastEntry, type ToastKind } from "@/lib/toast-store";
import { colors, motion, radii, shadows, spacing, typography } from "@/theme/tokens";

// One row per ToastKind: which glyph reads as "this kind" at a glance, and
// the tint pairing for its icon chip. Colors reuse the app's existing
// xMuted/x token pairs (successMuted+success, destructiveMuted+destructive,
// warningMuted+warning) — the same pairing foundation.ts documents those
// tokens for ("tint derived for chip/badge backgrounds"), not new values
// invented for this component.
const KIND_STYLE: Record<ToastKind, { icon: IconName; iconColor: string; iconBg: string }> = {
  success: { icon: "check", iconColor: colors.success, iconBg: colors.successMuted },
  // wifi-off is the same glyph ConnectivityPill uses for "you're offline" —
  // reusing it here (rather than a generic clock/queue icon) is what makes
  // "this was queued because you're offline" legible from the icon alone.
  offline: { icon: "wifi-off", iconColor: colors.warning, iconBg: colors.warningMuted },
  error: { icon: "alert", iconColor: colors.destructive, iconBg: colors.destructiveMuted },
};

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    // pointerEvents="box-none": this wrapper spans the full width above the
    // tab bar so toasts near either edge still lay out correctly, but the
    // dead space around a short message must not eat taps meant for whatever
    // sits underneath it (nothing does today — bottom sheets are their own
    // portal — but the screen's own FAB lives in roughly this area).
    <View style={[styles.stack, { bottom: insets.bottom + spacing.xl }]} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </View>
  );
}

function ToastRow({ toast }: { toast: ToastEntry }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const runAction = useToastStore((state) => state.runAction);
  const reduceMotion = useReduceMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // How long this toast lives is the store's call, not this component's —
  // an actionable toast gets a longer one (toast-store.ts's
  // TOAST_ACTION_DURATION_MS), because the user has to reach the button and
  // not merely read the text.
  useEffect(() => {
    timerRef.current = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismiss, toast.id, toast.durationMs]);

  const { icon, iconColor, iconBg } = KIND_STYLE[toast.kind];
  const { action } = toast;

  const body = (
    <>
      <View style={[styles.iconChip, { backgroundColor: iconBg }]}>
        <Icon name={icon} size={16} color={iconColor} />
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {toast.message}
      </Text>
      {action ? (
        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={() => {
            hapticLight();
            // Via the store, not `action.onPress()` directly: it retires the
            // toast before running the handler, so a double-tap on a button
            // that is already fading out can't fire a second undo.
            runAction(toast.id);
          }}
          // The pill reads best at its text size, so the 44pt target is
          // bought back with hitSlop — the same trade schedule.tsx's bell
          // and _layout.tsx's hamburger make.
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={toast.message}
        >
          <Text style={styles.actionLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
    </>
  );

  // An actionable toast is NOT tap-to-dismiss. The two gestures are a
  // millimetre apart on a card this small, and the cost of confusing them is
  // asymmetric: a mis-tap that dismisses destroys the only chance to undo a
  // delete, whereas a mis-tap that does nothing costs a second of waiting for
  // the auto-dismiss. So the whole card is inert except the button, and the
  // timer above is what clears it.
  const card = action ? (
    <View style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {body}
    </View>
  ) : (
    <Pressable
      style={styles.toast}
      onPress={() => dismiss(toast.id)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={toast.message}
      accessibilityHint="Tap to dismiss"
    >
      {body}
    </Pressable>
  );

  return (
    <Animated.View
      // Spring entrance (not a plain timing fade) to match this app's stated
      // animation philosophy — see PressableScale.tsx's SPRING constant and
      // journal.tsx's polish pass: a slight settle reads as "physical",
      // matching the same damping/stiffness/mass every other spring in this
      // app uses (theme/tokens.ts `motion.spring`), rather than inventing a
      // one-off curve just for toasts. Exit stays a plain fast fade — a
      // spring on the way OUT has nothing left to settle against once the
      // view is gone, so it just looks like a stutter.
      entering={
        reduceMotion
          ? undefined
          : FadeInDown.springify()
              .damping(motion.spring.damping)
              .stiffness(motion.spring.stiffness)
              .mass(motion.spring.mass)
      }
      exiting={reduceMotion ? undefined : FadeOutDown.duration(motion.duration.fast)}
      // Smoothly reflows the remaining toasts into the gap when one above
      // them is dismissed, instead of them silently teleporting to their new
      // position.
      layout={
        reduceMotion
          ? undefined
          : LinearTransition.damping(motion.spring.damping).stiffness(motion.spring.stiffness)
      }
    >
      {card}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: "absolute",
    left: spacing.xl,
    right: spacing.xl,
    gap: spacing.sm,
    // Above tab bar / FAB / everything else this simple absolute stack sits
    // over. Bottom sheets are their own react-native-modal portal, which
    // renders in a separate native layer above this regardless of zIndex.
    zIndex: 1000,
    elevation: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadows.raised,
  },
  iconChip: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
  },
  // The app's existing brand-accent chip vocabulary (foundation.ts's
  // primaryMuted/primaryBorder/primaryText trio, documented there as the
  // readable brand-colored TEXT pairing — raw #F2CC0D fails contrast on a
  // light surface), not a solid yellow button. A filled brand button inside
  // a toast would out-shout the message it belongs to, and this is the same
  // shape stat-card.tsx's accent rings already use elsewhere in the app.
  action: {
    paddingHorizontal: spacing.md,
    // sm, not xs: with the hitSlop above this is what clears the 44pt
    // minimum touch target (foundation.ts's `minTouchTarget`) — ~30pt of
    // pill plus 2×8 of slop.
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.primaryMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primaryBorder,
  },
  actionPressed: {
    opacity: 0.7,
  },
  actionLabel: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.primaryText,
  },
});
