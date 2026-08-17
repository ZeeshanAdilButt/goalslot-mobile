// One row in the notification-center list. Same "flush full-bleed row with a
// leading badge" shape as messaging's ConversationRow — a notification is a
// distinct object per row (not part of an ongoing conversation), so it gets
// an IconBadge glyph rather than an Avatar, tinted `brand` while unread and
// `neutral` once read so the whole row visibly recedes the moment it's dealt
// with, not just the dot beside it.
//
// Unread is triple-encoded here the same way ConversationRow argues for it:
// a dot, a heavier/darker title, and a brand-tinted icon — a single small
// dot fails at a glance, in sunlight, and for anyone who can't pick out a
// 10px circle from the surrounding text weight.

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { AppNotification } from "@goalslot/shared";

import { formatConversationTimestamp } from "@/components/messaging";
import type { IconName } from "@/components/ui/Icon";
import { IconBadge } from "@/components/ui/IconBadge";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

// Re-exported under a row-specific name rather than importing `AppNotification`
// at every call site — this is the API-client shape verbatim (including
// `data`, which this row never reads itself but the notifications screen
// needs untouched to hand to `resolveNotificationRoute`).
export type NotificationRowItem = AppNotification;

export interface NotificationRowProps {
  notification: NotificationRowItem;
  onPress: (notification: NotificationRowItem) => void;
}

/**
 * Maps the server's `NotificationType` to a glyph. Left as a plain-string
 * lookup with a `bell` fallback (not a switch over a closed union) so a
 * mobile build that doesn't yet know about a new server-added type still
 * renders a sensible row instead of failing to match — see
 * packages/shared/src/api/notifications.ts's header comment for why `type`
 * is typed as `string` at the API-client layer for the same reason.
 */
const TYPE_ICON: Record<string, IconName> = {
  MESSAGE_RECEIVED: "messages",
  SHARED_REPORT_UNVIEWED: "reports",
  INSTRUCTION_ASSIGNED: "instructions",
  FEEDBACK_REPLY: "coach",
  // "A new version is available" — the same glyph the Settings "Live update"
  // row uses for the manual check, so the two read as the same concept.
  APP_RELEASE: "refresh",
};

function iconForType(type: string): IconName {
  return TYPE_ICON[type] ?? "bell";
}

function NotificationRowComponent({ notification, onPress }: NotificationRowProps) {
  const unread = !notification.readAt;
  const time = formatConversationTimestamp(notification.createdAt);
  const preview = (notification.body ?? "").replace(/\s+/g, " ").trim();

  const accessibilityLabel = [
    unread ? "Unread notification." : "",
    notification.title + ".",
    preview ? preview + "." : "",
    time ? `${time}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable
      onPress={() => onPress(notification)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <IconBadge name={iconForType(notification.type)} tone={unread ? "brand" : "neutral"} size="md" />

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {notification.title}
          </Text>
          {time ? <Text style={[styles.time, unread && styles.timeUnread]}>{time}</Text> : null}
        </View>

        {preview ? (
          <View style={styles.bottomLine}>
            <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
              {preview}
            </Text>
            {unread ? <View style={styles.unreadDot} /> : null}
          </View>
        ) : unread ? (
          <View style={styles.unreadDot} />
        ) : null}
      </View>
    </Pressable>
  );
}

/** Memoised — marking one row read shouldn't re-render every other row in the list. */
export const NotificationRow = memo(NotificationRowComponent);

const UNREAD_DOT_SIZE = 10;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: minTouchTarget + spacing.xl,
    backgroundColor: colors.background,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
    paddingTop: spacing.xxs,
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    flex: 1,
    color: colors.foreground,
  },
  titleUnread: {
    fontWeight: "700",
  },
  time: {
    ...typography.caption,
    color: colors.mutedForegroundLight,
  },
  timeUnread: {
    color: colors.mutedForeground,
  },
  bottomLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  preview: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.mutedForeground,
  },
  previewUnread: {
    color: colors.foreground,
  },
  unreadDot: {
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.primaryPressed,
    marginTop: spacing.xxs,
  },
});
