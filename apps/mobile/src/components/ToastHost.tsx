// Mounted once in app/_layout.tsx, above every route. Renders whatever's
// queued in src/lib/toast-store.ts — the landing spot that finally exists
// for the sync engine's `notify` callback (packages/shared/src/offline/sync.ts,
// wired through src/lib/api-client.ts's `notify()`) and the dropped-time-entry
// hook (src/lib/offline.ts), both of which previously reached only a
// `console.warn`.

import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";

import { useToastStore, type ToastEntry } from "@/lib/toast-store";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

const AUTO_DISMISS_MS = 4000;

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
    <Animated.View style={[styles.stack, { bottom: insets.bottom + spacing.xl }]} pointerEvents="box-none">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </Animated.View>
  );
}

function ToastRow({ toast }: { toast: ToastEntry }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismiss, toast.id]);

  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(160)}>
      <Pressable
        style={[styles.toast, toast.kind === "error" && styles.toastError]}
        onPress={() => dismiss(toast.id)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={toast.message}
        accessibilityHint="Tap to dismiss"
      >
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
      </Pressable>
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
    borderRadius: radii.lg,
    backgroundColor: colors.foreground,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.raised,
  },
  toastError: {
    backgroundColor: colors.destructive,
  },
  text: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.background,
  },
});
