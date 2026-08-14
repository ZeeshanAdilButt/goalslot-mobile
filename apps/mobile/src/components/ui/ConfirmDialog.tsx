// A themed stand-in for `Alert.alert` — used anywhere this app needs a
// "are you sure?" confirmation with a Cancel/Confirm pair. The OS default
// (`Alert.alert`) renders in the platform's own system chrome — default
// Android Material teal text buttons, an iOS system sheet — which reads as
// a jarring, unstyled interruption dropped on top of an otherwise carefully
// designed screen. This renders inside a `Modal` with this app's own type
// scale, radii, and shadows instead, so a destructive confirmation looks
// like it belongs to the same product as the screen behind it.
//
// Deliberately centred rather than a bottom sheet like SettingsSheet.tsx:
// this is a short yes/no decision, not a form, and a centred card is what
// both platforms' own alert dialogs already train users to expect for that
// shape of question — only the chrome changes, not the position.
//
// `error`/`busy` let a caller keep the SAME dialog open across a failed
// confirm (see coach.tsx's and voice.tsx's "New chat" flow) instead of
// stacking a second Alert on top of the first the way the old
// `Alert.alert(...); Alert.alert("Couldn't start a new chat", ...)` pairing
// did — the error renders inline and the primary button goes back to idle
// so the user can just try again without re-opening anything.

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  description?: string;
  /** Small glyph in a tinted roundel above the title — omit for a plainer, text-only dialog. */
  icon?: IconName;
  confirmLabel: string;
  cancelLabel?: string;
  /** Tints the icon roundel and the confirm button rose/destructive instead of brand-primary. */
  destructive?: boolean;
  /** Disables both buttons and spins the confirm button's own loading state — set while the confirmed action is in flight. */
  busy?: boolean;
  /** Rendered inline, inside the same dialog, so a failed attempt can be retried without a second popup stacking on the first. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  description,
  icon,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={busy ? () => undefined : onCancel} statusBarTranslucent>
      <Pressable
        style={styles.backdrop}
        onPress={busy ? undefined : onCancel}
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${title}`}
      >
        {/* Tap-swallower, same shape as SettingsSheet's own — presses inside
            the card must not fall through to the backdrop's dismiss. */}
        <Pressable accessible={false} accessibilityViewIsModal style={styles.card}>
          {icon ? (
            <View style={[styles.iconWrap, destructive && styles.iconWrapDestructive]}>
              <Icon name={icon} size={22} color={destructive ? colors.destructive : colors.foreground} />
            </View>
          ) : null}
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}

          {error ? (
            <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              variant="outline"
              onPress={onCancel}
              disabled={busy}
              style={styles.actionButton}
            />
            <Button
              label={confirmLabel}
              variant={destructive ? "destructive" : "primary"}
              onPress={onConfirm}
              loading={busy}
              style={styles.actionButton}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
    padding: spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadows.raised,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
    marginBottom: spacing.xxs,
  },
  iconWrapDestructive: {
    backgroundColor: colors.destructiveMuted,
  },
  title: {
    ...typography.title,
    fontSize: 18,
    lineHeight: 24,
    color: colors.foreground,
  },
  description: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  errorBanner: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    padding: spacing.sm,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
