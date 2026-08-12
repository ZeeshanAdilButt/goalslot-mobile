// The composer bar. Presentation only — the screen owns the
// KeyboardAvoidingView that keeps this above the keyboard, and
// `useThreadScroll` owns keeping the list pinned; this component's job is to
// be a correct input and a correct send button.
//
// Details that matter on a phone and are easy to lose:
//
//   * `multiline` with a min/max height. A single-line input truncates
//     anything longer than a sentence into an unreadable scroller; unbounded
//     growth eats the thread. 44pt floor (the touch target) to ~5 lines.
//   * `blurOnSubmit={false}`. Without it, a hardware/BT keyboard's Enter
//     dismisses the software keyboard after every message, and the user has
//     to tap back in to send a second one.
//   * The send button stays MOUNTED and disabled rather than being hidden
//     when the input is empty. A control that appears and disappears shifts
//     the input's width on every first and last character.
//   * Character counter appears only near the cap. A permanent "0/4000" is
//     noise on a surface where almost nobody approaches the limit.

import { forwardRef } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { MAX_MESSAGE_LENGTH } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Show the counter once the remaining budget is this small. */
const COUNTER_VISIBLE_WITHIN = 200;

export interface MessageComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Disables input entirely — used when the conversation itself failed to load. */
  disabled?: boolean;
  /** In-flight send. The input stays editable so the user can start the next message. */
  sending?: boolean;
  placeholder?: string;
  /** Extra bottom padding for the home indicator when the keyboard is down. */
  bottomInset?: number;
}

export const MessageComposer = forwardRef<TextInput, MessageComposerProps>(function MessageComposer(
  { value, onChangeText, onSend, disabled = false, sending = false, placeholder = "Message", bottomInset = 0 },
  ref,
) {
  const trimmedLength = value.trim().length;
  const overLimit = value.length > MAX_MESSAGE_LENGTH;
  const canSend = trimmedLength > 0 && !overLimit && !disabled;
  const remaining = MAX_MESSAGE_LENGTH - value.length;
  const showCounter = remaining <= COUNTER_VISIBLE_WITHIN;

  return (
    <View style={[styles.container, { paddingBottom: spacing.sm + bottomInset }]}>
      {showCounter ? (
        <Text
          style={[styles.counter, overLimit && styles.counterOver]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            overLimit ? `Message is ${-remaining} characters too long` : `${remaining} characters remaining`
          }
        >
          {remaining}
        </Text>
      ) : null}

      <View style={styles.bar}>
        <TextInput
          ref={ref}
          style={[styles.input, overLimit && styles.inputOver]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          multiline
          editable={!disabled}
          blurOnSubmit={false}
          // Hard cap one character past the limit so the over-limit state can
          // actually be reached and explained, rather than the input silently
          // refusing further input with no reason given.
          maxLength={MAX_MESSAGE_LENGTH + 1}
          textAlignVertical="top"
          // iOS only; Android's "send" action would submit and dismiss, which
          // fights `multiline`.
          returnKeyType={Platform.OS === "ios" ? "default" : undefined}
          accessibilityLabel="Message"
          accessibilityHint={`Type your message, then activate Send. Maximum ${MAX_MESSAGE_LENGTH} characters.`}
        />

        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.sendButtonDisabled,
            pressed && canSend && styles.sendButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          hitSlop={spacing.sm}
        >
          <Icon
            name="arrow-right"
            size={iconSize.md}
            color={canSend ? colors.primaryForeground : colors.mutedForegroundLight}
          />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  bar: {
    flexDirection: "row",
    // flex-end, not center: as the input grows to several lines the send
    // button should stay level with the last line, not drift to the middle.
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: minTouchTarget,
    // ~5 lines. Past that the thread has less room than the draft, which is
    // the wrong trade on a phone.
    maxHeight: 132,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    // Explicit vertical padding rather than relying on the platform default,
    // which differs enough between iOS and Android that the text sits
    // noticeably high on one of them.
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    fontSize: 15,
    color: colors.foreground,
  },
  inputOver: {
    borderColor: colors.destructive,
  },
  sendButton: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  sendButtonPressed: {
    backgroundColor: colors.primaryPressed,
  },
  sendButtonDisabled: {
    backgroundColor: colors.secondary,
  },
  counter: {
    ...typography.caption,
    fontWeight: "400",
    textTransform: "none",
    color: colors.mutedForeground,
    textAlign: "right",
    marginBottom: spacing.xxs,
  },
  counterOver: {
    color: colors.destructive,
    fontWeight: "700",
  },
});
