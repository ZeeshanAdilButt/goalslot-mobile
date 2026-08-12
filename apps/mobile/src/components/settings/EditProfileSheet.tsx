// Edit profile, ported from dw-time-web's `ProfileSettings`
// (src/app/dashboard/settings/page.tsx:182-300).
//
// One editable field, because the API has one: `PUT /users/profile` accepts
// `{ name?, avatar? }` and nothing else, and there is no upload endpoint
// anywhere in dw-time-api (no multer, no FileInterceptor), so `avatar` is a
// URL to an image the user would have to host themselves — not a control
// worth building on a phone.
//
// Email is shown read-only for the same reason web shows it read-only: there
// is no change-email route. The API's global ValidationPipe runs with
// `whitelist: true`, so a form that "let" you edit it would strip the field
// server-side and report success having changed nothing.

import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

import { Button, TextField } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { useAuth } from "@/providers/auth-provider";
import { colors, radii, spacing, typography } from "@/theme/tokens";

import { SettingsSheet } from "./SettingsSheet";

export interface EditProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function EditProfileSheet({ visible, onClose }: EditProfileSheetProps) {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reseed from the store each time the sheet opens, so an abandoned edit
  // doesn't reappear as if it had been saved.
  useEffect(() => {
    if (visible) {
      setName(user?.name ?? "");
      setError(null);
    }
  }, [visible, user?.name]);

  const trimmed = name.trim();
  const isDirty = trimmed !== (user?.name ?? "").trim();

  const handleSave = useCallback(async () => {
    if (!trimmed) {
      setError("Your name can't be empty.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await apiClient.users.updateProfile({ name: trimmed });
      setUser(res.data);
      AccessibilityInfo.announceForAccessibility("Profile updated.");
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't update your profile.");
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setIsSaving(false);
    }
  }, [onClose, setUser, trimmed]);

  return (
    <SettingsSheet visible={visible} title="Edit profile" onClose={onClose}>
      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <TextField
        label="Full name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        placeholder="Your name"
        returnKeyType="done"
        onSubmitEditing={() => void handleSave()}
        editable={!isSaving}
      />

      <View style={styles.readOnly}>
        <Text style={styles.readOnlyLabel}>Email</Text>
        <Text style={styles.readOnlyValue}>{user?.email ?? "—"}</Text>
        <Text style={styles.readOnlyHint}>
          {user?.userType === "SSO"
            ? "Managed by your single sign-on provider."
            : "Email addresses can't be changed here."}
        </Text>
      </View>

      <Button
        label="Save changes"
        onPress={() => void handleSave()}
        loading={isSaving}
        disabled={!isDirty || !trimmed}
        fullWidth
      />
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
  readOnly: {
    gap: spacing.xxs,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.secondary,
  },
  readOnlyLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  readOnlyValue: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  readOnlyHint: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
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
