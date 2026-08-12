// A quiet strip under the header when live delivery isn't running.
//
// Messaging is the one place in this app where being offline changes what the
// user should believe about what they're looking at: everywhere else a stale
// list is merely stale, but a chat thread that silently stops receiving looks
// exactly like a conversation where the other person went quiet. So this
// says so, rather than leaving the user to work it out.
//
// Deliberately not an error: a dropped socket is normal (a lift, a tunnel,
// backgrounding), messages still send over HTTP, and reconnection is
// automatic. Warning tint, not destructive, and no retry button for something
// the app is already retrying.

import { StyleSheet, Text, View } from "react-native";

import type { MessagingSocketStatus } from "@goalslot/shared";

import { colors, spacing, typography } from "@/theme/tokens";

export interface OfflineBannerProps {
  status: MessagingSocketStatus;
  /** Device connectivity, so "you're offline" beats "reconnecting" as an explanation. */
  online: boolean;
  /** False when no WebSocket URL is configured — then there is nothing to reconnect and no banner. */
  liveEnabled: boolean;
}

export function OfflineBanner({ status, online, liveEnabled }: OfflineBannerProps) {
  if (!liveEnabled || status === "open") return null;

  // 'connecting' on first mount is the normal path to 'open' and resolves in
  // well under a second — flashing a banner for it would be worse than
  // showing nothing.
  if (status === "connecting" || status === "idle") return null;

  const message = online
    ? "Reconnecting — new messages may be delayed."
    : "You're offline. Messages you send will go out when you're back.";

  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  text: {
    ...typography.bodySmall,
    color: colors.foreground,
    textAlign: "center",
  },
});
