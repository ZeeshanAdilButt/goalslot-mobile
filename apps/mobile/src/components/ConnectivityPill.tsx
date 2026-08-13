// App-wide "you're offline" / "N changes waiting to sync" pill.
//
// src/components/messaging/OfflineBanner.tsx already did this well, but only
// for the two messaging screens (messages.tsx, message/[id].tsx) — every
// other screen (goals, tasks, schedule, timer, journal, notes) gave zero
// ambient signal that the app was offline or that an edit had queued rather
// than saved live, so a queued item and a genuinely-synced one rendered
// identically. This is the generalized version: mounted once in
// app/_layout.tsx instead of per-screen, driven by the one shared NetInfo
// subscription (src/lib/offline.ts's `isOnline`/`subscribeOnline` — reused
// rather than opened a second time, per that module's own header note) and
// the outbox's live pending count (src/lib/pending-sync-store.ts, kept
// current by offlineSync's `onPendingCountChange`).
//
// Deliberately a separate component rather than a rewrite of OfflineBanner:
// that one's copy and props are messaging-specific (WebSocket status, not
// outbox count), and rewriting it to serve both would have coupled two
// screens this task was told not to touch (messages.tsx isn't off-limits,
// but there was no reason to risk it) to a shape built for every other
// screen's very different question ("is anything queued?", not "is the
// socket connected?").

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { isOnline, subscribeOnline } from "@/lib/offline";
import { usePendingSyncCount } from "@/lib/pending-sync-store";
import { Icon } from "@/components/ui/Icon";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

export function ConnectivityPill() {
  const [online, setOnline] = useState(isOnline());
  const pendingCount = usePendingSyncCount((state) => state.count);
  const insets = useSafeAreaInsets();

  useEffect(() => subscribeOnline(setOnline), []);

  // The common case — online with an empty outbox — says nothing, same
  // restraint OfflineBanner applies for its own "everything's fine" state.
  if (online && pendingCount === 0) return null;

  const message = !online
    ? pendingCount > 0
      ? `Offline — ${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync`
      : "You're offline"
    : `Syncing ${pendingCount} offline change${pendingCount === 1 ? "" : "s"}…`;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(160)}
      style={[styles.wrap, { top: insets.top + spacing.sm }]}
      pointerEvents="none"
    >
      <View
        style={styles.pill}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={message}
      >
        <Icon name={online ? "refresh" : "wifi-off"} size={13} color={colors.white} />
        <Text style={styles.text} numberOfLines={1}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 900,
    elevation: 900,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.foreground,
    ...shadows.card,
  },
  text: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.white,
    fontWeight: "600",
  },
});
