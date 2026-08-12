// One message bubble. Visual vocabulary is deliberately the same as the
// Coach screen's chat bubbles (app/(app)/coach.tsx) — brand fill and a
// tucked bottom-right corner for the user's own messages, bordered card and a
// tucked bottom-left corner for the other side — so the two conversational
// surfaces in the app read as one product rather than two chat UIs.
//
// What's added here, because Coach has no equivalent: delivery state. An
// optimistic message the server hasn't confirmed is dimmed; one that failed
// keeps its text and grows a retry, because deleting a failed bubble throws
// away what the user wrote.
//
// Accessibility: the bubble is one element with a composed label ("You said:
// … 3:14 PM. Not sent."). The retry/discard controls stay as separate
// focusable buttons, since they're actions rather than content.

import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { isPendingMessage, type MessagingThreadMessage } from "@goalslot/shared";

import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { formatMessageTime } from "./format";

export interface MessageBubbleProps {
  message: MessagingThreadMessage;
  isOwn: boolean;
  /** Name of the other participant, for the screen-reader label. */
  counterpartName: string;
  onRetry?: (clientId: string) => void;
  onDiscard?: (clientId: string) => void;
}

const STATUS_LABEL = {
  sending: "Sending…",
  queued: "Waiting for connection",
  failed: "Not sent",
} as const;

function MessageBubbleComponent({ message, isOwn, counterpartName, onRetry, onDiscard }: MessageBubbleProps) {
  const pending = isPendingMessage(message) ? message : null;
  const time = formatMessageTime(message.createdAt);
  const statusLabel = pending ? STATUS_LABEL[pending.status] : null;

  const accessibilityLabel = [
    isOwn ? "You said:" : `${counterpartName} said:`,
    message.body,
    time ? `at ${time}.` : "",
    statusLabel ? `${statusLabel}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
      <View
        style={[
          styles.bubble,
          isOwn ? styles.bubbleOwn : styles.bubbleOther,
          pending?.status === "sending" && styles.bubbleSending,
          pending?.status === "failed" && styles.bubbleFailed,
        ]}
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        <Text style={isOwn ? styles.bodyOwn : styles.bodyOther} selectable>
          {message.body}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {time ? (
          <Text style={styles.meta} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {time}
          </Text>
        ) : null}
        {statusLabel ? (
          <Text
            style={[styles.meta, pending?.status === "failed" && styles.metaFailed]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {statusLabel}
          </Text>
        ) : null}
      </View>

      {pending?.status === "failed" ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onRetry?.(pending.clientId)}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Retry sending this message"
            hitSlop={spacing.sm}
          >
            <Text style={styles.actionLabel}>Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => onDiscard?.(pending.clientId)}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            accessibilityRole="button"
            accessibilityLabel="Discard this unsent message"
            hitSlop={spacing.sm}
          >
            <Text style={[styles.actionLabel, styles.actionLabelDestructive]}>Discard</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Memoised: a thread re-renders on every keystroke in the composer (the
 * draft lives in a store the screen subscribes to) and on every socket push,
 * and neither should re-render forty existing bubbles.
 */
export const MessageBubble = memo(MessageBubbleComponent);

const styles = StyleSheet.create({
  row: {
    gap: spacing.xxs,
    marginBottom: spacing.md,
  },
  rowOwn: {
    alignItems: "flex-end",
  },
  rowOther: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "85%",
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bubbleOwn: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: radii.sm,
  },
  bubbleOther: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderBottomLeftRadius: radii.sm,
  },
  bubbleSending: {
    opacity: 0.6,
  },
  bubbleFailed: {
    borderWidth: 1,
    borderColor: colors.destructive,
  },
  bodyOwn: {
    ...typography.body,
    color: colors.primaryForeground,
  },
  bodyOther: {
    ...typography.body,
    color: colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  meta: {
    ...typography.caption,
    fontWeight: "400",
    textTransform: "none",
    color: colors.mutedForegroundLight,
  },
  metaFailed: {
    color: colors.destructive,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  action: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  actionPressed: {
    opacity: 0.6,
  },
  actionLabel: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.foreground,
  },
  actionLabelDestructive: {
    color: colors.destructive,
  },
});
