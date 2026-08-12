// Change password, ported from dw-time-web's `SecuritySettings`
// (src/app/dashboard/settings/page.tsx:456-664).
//
// It is a two-step flow because the API is: `POST /auth/send-change-password-otp`
// verifies the current password and mails a code, then `POST /auth/change-password`
// takes `{ currentPassword, otp, newPassword }` together. There is no
// single-shot route worth using — `PUT /users/password` exists on the API but
// has no call site anywhere in web either (see packages/shared/src/api/users.ts
// for why it isn't ported), and it skips the emailed confirmation entirely.
//
// Rules the API enforces that this form has to respect (dw-time-api's
// auth.service.ts): the code is 6 digits and expires after 5 minutes, a
// resend is refused inside 60 seconds, and five wrong codes lock the flow for
// 15 minutes. The resend button therefore counts down rather than letting the
// user collect a 400, and every server message is surfaced verbatim rather
// than replaced with "something went wrong" — "Too many attempts, try again
// in 15 minutes" is information the user needs.
//
// Web renders the code as six individual OTP slots. This uses one numeric
// field: six separate inputs on a phone means six focus jumps, fights
// iOS/Android SMS autofill, and each slot is well under a 44pt target.

import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";

import { Button, TextField } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { colors, radii, spacing, typography } from "@/theme/tokens";

import { SettingsSheet } from "./SettingsSheet";

/** Matches the API's 60-second resend cooldown, so the button re-enables exactly when the route will accept it. */
const RESEND_COOLDOWN_SECONDS = 60;
/** The API's `@MinLength(8)` on both `currentPassword` and `newPassword`. */
const MIN_PASSWORD_LENGTH = 8;

export interface ChangePasswordSheetProps {
  visible: boolean;
  onClose: () => void;
}

type Step = "current-password" | "verify";

export function ChangePasswordSheet({ visible, onClose }: ChangePasswordSheetProps) {
  const [step, setStep] = useState<Step>("current-password");
  const [currentPassword, setCurrentPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const reset = useCallback(() => {
    setStep("current-password");
    setCurrentPassword("");
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setIsBusy(false);
    setCooldown(0);
  }, []);

  // Everything in this form is a credential. Clearing on close means a
  // half-typed password isn't still sitting in memory — and still on screen —
  // the next time the sheet opens.
  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  // Counts the resend cooldown down one second at a time. A chain of
  // one-second timeouts keyed on the current value, rather than a single
  // interval held in a ref: the dependency array is then honestly `[cooldown]`
  // (no lint suppression), and the timer is torn down by the same effect
  // cleanup when the sheet closes mid-countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timeout = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timeout);
  }, [cooldown]);

  const announce = useCallback((message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      const message = getErrorMessage(err, fallback);
      setError(message);
      announce(message);
    },
    [announce],
  );

  const sendCode = useCallback(async () => {
    if (currentPassword.length < MIN_PASSWORD_LENGTH) {
      // Not a guess about their password — the API's own DTO is
      // `@MinLength(8)` on this field, so anything shorter is a guaranteed 400.
      setError(`That's too short to be your current password.`);
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      await apiClient.auth.sendChangePasswordOTP({ currentPassword });
      setStep("verify");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      announce("Verification code sent to your email.");
    } catch (err) {
      fail(err, "Couldn't send the verification code.");
    } finally {
      setIsBusy(false);
    }
  }, [announce, currentPassword, fail]);

  const submit = useCallback(async () => {
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The two new passwords don't match.");
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      await apiClient.auth.changePassword({ currentPassword, otp, newPassword });
      // Announce before closing: the sheet unmounts immediately after, and a
      // message queued against a view that is going away is dropped on
      // Android.
      announce("Password changed.");
      onClose();
    } catch (err) {
      fail(err, "Couldn't change your password.");
    } finally {
      setIsBusy(false);
    }
  }, [announce, confirmPassword, currentPassword, fail, newPassword, onClose, otp]);

  return (
    <SettingsSheet
      visible={visible}
      title="Change password"
      description={
        step === "current-password"
          ? "We'll email you a 6-digit code to confirm it's you."
          : "Enter the code we emailed you, then pick a new password."
      }
      onClose={onClose}
    >
      {error ? (
        // `alert` role so the message is read as soon as it appears rather
        // than only when focus happens to land on it.
        <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {step === "current-password" ? (
        <>
          <TextField
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureToggle
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            placeholder="Your current password"
            returnKeyType="send"
            onSubmitEditing={() => void sendCode()}
            editable={!isBusy}
          />
          <Button
            label="Send verification code"
            onPress={() => void sendCode()}
            loading={isBusy}
            disabled={!currentPassword}
            fullWidth
          />
        </>
      ) : (
        <>
          <TextField
            label="Verification code"
            value={otp}
            onChangeText={(text) => setOtp(text.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            // Lets iOS and Android offer the code straight from the email
            // notification instead of making the user switch apps.
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            accessibilityHint="Six digits, from the email we just sent you"
            editable={!isBusy}
          />
          <Button
            label={cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            variant="ghost"
            size="sm"
            onPress={() => void sendCode()}
            disabled={cooldown > 0 || isBusy}
            style={styles.resend}
          />
          <TextField
            label="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureToggle
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            editable={!isBusy}
          />
          <TextField
            label="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureToggle
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="Type it again"
            error={
              confirmPassword && newPassword !== confirmPassword ? "Doesn't match the new password" : null
            }
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            editable={!isBusy}
          />
          <Button
            label="Change password"
            onPress={() => void submit()}
            loading={isBusy}
            disabled={!otp || !newPassword || !confirmPassword}
            fullWidth
          />
        </>
      )}
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
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
  resend: {
    alignSelf: "flex-start",
    marginTop: -spacing.sm,
  },
});
