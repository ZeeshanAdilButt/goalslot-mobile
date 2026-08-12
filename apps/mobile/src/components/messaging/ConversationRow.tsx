// One row in the conversations list.
//
// Built as a plain Pressable rather than a `ListCard`: the card family
// (Goals/Tasks/Categories) is an elevated, shadowed surface with a coloured
// left stripe, which is right for a list of *objects*. A conversation list is
// a list of *people*, and every messaging app the user knows renders that as
// flush, full-bleed rows with an avatar — cards here would read as the wrong
// kind of thing and waste horizontal space the preview text needs.
//
// Unread treatment is deliberately triple-encoded — a dot, a heavier name,
// and near-black rather than muted preview text — so it doesn't depend on the
// dot alone. A single small coloured dot fails at a glance, in sunlight, and
// for anyone who can't pick it out against the surrounding text weight.
//
// Accessibility: the whole row is ONE element with a composed label. Left as
// four separate nodes, a screen reader reads name, then preview, then time,
// then "unread", with no indication they belong together — the user has to
// reassemble the row themselves, four swipes at a time.

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { Avatar } from "./Avatar";
import { formatConversationTimestamp } from "./format";

export interface ConversationRowProps {
  name: string;
  preview: string;
  timestamp?: string | null;
  unread: boolean;
  onPress: () => void;
}

function ConversationRowComponent({ name, preview, timestamp, unread, onPress }: ConversationRowProps) {
  const time = formatConversationTimestamp(timestamp);

  // Reads as one sentence rather than four fragments. "Unread" leads because
  // it's the thing that decides whether the user cares about the rest.
  const accessibilityLabel = [
    unread ? "Unread conversation with" : "Conversation with",
    name + ".",
    preview + ".",
    time ? `Last message ${time}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the conversation"
      accessibilityState={{ selected: false }}
    >
      <Avatar name={name} />

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {name}
          </Text>
          {time ? <Text style={[styles.time, unread && styles.timeUnread]}>{time}</Text> : null}
        </View>

        <View style={styles.bottomLine}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Memoised because a single socket push rewrites the whole conversations
 * array (see lib/messaging-live.ts), which would otherwise re-render every
 * row in the list for a change to one of them.
 */
export const ConversationRow = memo(ConversationRowComponent);

const UNREAD_DOT_SIZE = 10;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    // Comfortably past the 44pt floor: the avatar alone is 44, and a row this
    // wide with a small target is the classic "I keep tapping the wrong
    // conversation" complaint.
    minHeight: minTouchTarget + spacing.xl,
    backgroundColor: colors.background,
  },
  rowPressed: {
    backgroundColor: colors.secondary,
  },
  body: {
    flex: 1,
    gap: spacing.xxs,
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    flex: 1,
    color: colors.foreground,
  },
  nameUnread: {
    fontWeight: "700",
  },
  time: {
    ...typography.caption,
    fontWeight: "400",
    textTransform: "none",
    color: colors.mutedForegroundLight,
  },
  timeUnread: {
    color: colors.foreground,
    fontWeight: "600",
  },
  bottomLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  preview: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.mutedForeground,
  },
  previewUnread: {
    color: colors.foreground,
    fontWeight: "600",
  },
  unreadDot: {
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: radii.pill,
    // primaryPressed (#D9B307), not raw brand yellow: a 10px #F2CC0D dot on
    // the near-white background is barely visible, same reason the drawer's
    // active icon steps down a shade.
    backgroundColor: colors.primaryPressed,
  },
});
