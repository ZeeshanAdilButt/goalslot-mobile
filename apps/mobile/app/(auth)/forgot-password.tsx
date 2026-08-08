import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";

import { apiClient } from "@/lib/api-client";
import { GoalSlotLogo } from "@/components/brand/GoalSlotLogo";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { getErrorMessage } from "@/lib/get-error-message";
import { colors, radii, shadows, spacing, typography, motion } from "@/theme";

const MIN_PASSWORD_LENGTH = 8;

// Neither step here touches session state (no tokens are issued by
// send-otp/reset-password), so this screen talks to apiClient directly
// rather than going through the auth provider — same reasoning as
// signup.tsx's "Send code" step.

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<"email" | "reset">("email");

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reduceMotion = useReduceMotion();

  const canSendCode = email.trim().length > 0;
  const canReset = otp.trim().length === 6 && newPassword.length >= MIN_PASSWORD_LENGTH;

  async function handleSendCode() {
    setError(null);
    setSendingCode(true);
    try {
      await apiClient.auth.sendOTP({ email: email.trim(), purpose: "FORGOT_PASSWORD" });
      setStep("reset");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to send code. Please try again."));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleResetPassword() {
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.auth.resetPassword({ email: email.trim(), otp: otp.trim(), newPassword });
      router.replace({ pathname: "/login", params: { resetSuccess: "1" } });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to reset password. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const brand = (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base)}
      style={styles.brandBlock}
    >
      <View style={styles.logoBadge}>
        <GoalSlotLogo size={44} color={colors.primary} accessibilityLabel="GoalSlot logo" />
      </View>
      <Text style={styles.brandName}>GoalSlot</Text>
    </Animated.View>
  );

  if (step === "reset") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {brand}

            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base).delay(80)}
              style={styles.formBlock}
            >
              <Text style={styles.title}>Reset your password</Text>
              <Text style={styles.subtitle}>Enter the 6-digit code we sent to {email}</Text>

              <TextField
                label="Verification code"
                placeholder="6-digit code"
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
                accessibilityLabel="Verification code"
              />

              <TextField
                label="New password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                secureToggle
                textContentType="newPassword"
                accessibilityLabel="New password"
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Button
                label={submitting ? "Resetting..." : "Reset password"}
                onPress={handleResetPassword}
                loading={submitting}
                disabled={!canReset}
                accessibilityLabel="Reset password"
                style={styles.submitButton}
              />

              <TouchableOpacity
                onPress={() => setStep("email")}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Back to email entry"
              >
                <Text style={styles.link}>Back</Text>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {brand}

          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base).delay(80)}
            style={styles.formBlock}
          >
            <Text style={styles.title}>Forgot password</Text>
            <Text style={styles.subtitle}>We&apos;ll send a code to your email to reset your password.</Text>

            <TextField
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel="Email"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label={sendingCode ? "Sending code..." : "Send reset code"}
              onPress={handleSendCode}
              loading={sendingCode}
              disabled={!canSendCode}
              accessibilityLabel="Send reset code"
              style={styles.submitButton}
            />

            <Link href="/login" asChild>
              <TouchableOpacity accessibilityRole="link" accessibilityLabel="Back to log in">
                <Text style={styles.link}>Back to log in</Text>
              </TouchableOpacity>
            </Link>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.xxl,
  },
  brandBlock: {
    alignItems: "center",
    gap: spacing.sm,
  },
  logoBadge: {
    width: 84,
    height: 84,
    borderRadius: radii.xl,
    backgroundColor: colors.foreground,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.raised,
  },
  brandName: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.foreground,
    letterSpacing: 0.2,
  },
  formBlock: {
    gap: spacing.md,
  },
  title: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    color: colors.foreground,
  },
  subtitle: {
    fontSize: typography.size.sm,
    color: colors.mutedForeground,
    marginTop: -spacing.sm,
    marginBottom: spacing.xs,
  },
  error: {
    color: colors.destructive,
    fontSize: typography.size.sm,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  link: {
    color: colors.foreground,
    textAlign: "center",
    fontSize: typography.size.sm,
    marginTop: spacing.xs,
    textDecorationLine: "underline",
  },
});
