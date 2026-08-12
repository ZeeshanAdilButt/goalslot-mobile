// Delete account, ported from dw-time-web's `DataSettings`
// (src/app/dashboard/settings/page.tsx:667-763) including its
// type-the-word-DELETE gate.
//
// The gate is not theatre. `DELETE /users/account` runs `prisma.user.delete()`
// — a hard delete that cascades through goals, tasks, time entries, journal
// entries, notes and the stored BYOK key. No soft-delete flag, no grace
// period, no undo, and the route asks for no password. Every bit of the
// friction has to be here, because there is none on the other side.
//
// A React Native `Alert` is not enough on its own for this one. `Alert.prompt`
// is iOS-only, so a typed confirmation cannot be done with the platform
// dialog on Android, and a two-button Alert is one mis-tap from irreversible.
// Hence a sheet with a real text field: the user has to read the word and
// type it.
//
// The sign-out afterwards is deliberate and unconditional. Once the row is
// gone the access token in secure storage authenticates nothing, and every
// cached query and queued outbox write belongs to an account that no longer
// exists — `logout()` is what clears all of that (see src/lib/session-reset.ts)
// and drops the user back on the login screen.

import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

import { Button, TextField } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { useAuth } from "@/providers/auth-provider";
import { colors, radii, spacing, typography } from "@/theme/tokens";

import { SettingsSheet } from "./SettingsSheet";

/** Typed verbatim, case-sensitive — same word web asks for. */
const CONFIRM_WORD = "DELETE";

export interface DeleteAccountSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function DeleteAccountSheet({ visible, onClose }: DeleteAccountSheetProps) {
  const { logout } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setConfirmText("");
      setError(null);
      setIsDeleting(false);
    }
  }, [visible]);

  const canConfirm = confirmText === CONFIRM_WORD;

  const handleDelete = useCallback(async () => {
    if (!canConfirm || isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      await apiClient.users.deleteAccount();
      AccessibilityInfo.announceForAccessibility("Account deleted. Signing out.");
      // Not awaited before closing — `logout()` tears down the query cache
      // and the outbox, and the sheet is sitting on top of a Settings screen
      // that reads from both.
      onClose();
      await logout();
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't delete your account.");
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      setIsDeleting(false);
    }
  }, [canConfirm, isDeleting, logout, onClose]);

  return (
    <SettingsSheet
      visible={visible}
      title="Delete account"
      description="This removes your account and everything in it, permanently."
      onClose={onClose}
    >
      <View style={styles.warning} accessibilityRole="alert">
        <Text style={styles.warningTitle}>There is no undo</Text>
        <Text style={styles.warningBody}>
          Your goals, tasks, schedule, time entries, journal entries and notes are all deleted along with
          your account. We cannot restore them afterwards.
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <TextField
        label={`Type ${CONFIRM_WORD} to confirm`}
        value={confirmText}
        onChangeText={setConfirmText}
        // No autocorrect/autocapitalize: both would "helpfully" rewrite the
        // typed word and leave the button disabled with no visible reason.
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        placeholder={CONFIRM_WORD}
        accessibilityLabel={`Type the word ${CONFIRM_WORD} in capitals to confirm account deletion`}
        editable={!isDeleting}
      />

      <Button
        label="Delete my account"
        variant="destructive"
        icon="trash"
        onPress={() => void handleDelete()}
        disabled={!canConfirm}
        loading={isDeleting}
        fullWidth
        accessibilityLabel="Delete my account permanently"
      />
      <Button label="Cancel" variant="ghost" onPress={onClose} disabled={isDeleting} fullWidth />
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
  warning: {
    backgroundColor: colors.destructiveMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  warningTitle: {
    ...typography.body,
    fontWeight: "700",
    color: colors.destructive,
  },
  warningBody: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  errorBanner: {
    backgroundColor: colors.destructiveMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
    padding: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
});
