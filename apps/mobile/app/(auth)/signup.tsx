import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/providers/auth-provider";
import { apiClient } from "@/lib/api-client";
import { GoalSlotLogo } from "@/components/brand/GoalSlotLogo";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { getErrorMessage } from "@/lib/get-error-message";
import { colors, radii, shadows, spacing, typography, motion } from "@/theme";

const MIN_PASSWORD_LENGTH = 8;

// sendOTP (and later verify-via-register) don't touch session state — no
// tokens, no store update — so they're called directly against apiClient
// rather than going through the auth provider. `register`, which DOES set
// tokens/user on success, is already exposed by the provider and is reused
// as-is (see src/providers/auth-provider.tsx).

export default function SignupScreen() {
  const { register } = useAuth();
  const [step, setStep] = useState<"form" | "otp">("form");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reduceMotion = useReduceMotion();

  const canSendCode = name.trim().length > 0 && email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH;
  const canCreateAccount = otp.trim().length === 6;

  async function handleSendCode() {
    setError(null);
    setSendingCode(true);
    try {
      await apiClient.auth.sendOTP({ email: email.trim(), purpose: "SIGNUP" });
      setStep("otp");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to send code. Please try again."));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleCreateAccount() {
    setError(null);
    setSubmitting(true);
    try {
      await register({ email: email.trim(), password, name: name.trim(), otp: otp.trim() });
      // On success `status` flips to 'authenticated' and the (auth) group
      // layout's Redirect takes over — no manual navigation needed here.
    } catch (err) {
      setError(getErrorMessage(err, "Failed to create account. Please try again."));
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

  if (step === "otp") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {brand}

            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base).delay(80)}
              style={styles.formBlock}
            >
              <Text style={styles.title}>Verify your email</Text>
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

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Button
                label={submitting ? "Creating account..." : "Create account"}
                onPress={handleCreateAccount}
                loading={submitting}
                disabled={!canCreateAccount}
                accessibilityLabel="Create account"
                style={styles.submitButton}
              />

              <TouchableOpacity
                onPress={() => setStep("form")}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Back to sign up details"
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
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>Start turning goals into logged hours.</Text>

            <TextField
              label="Name"
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              textContentType="name"
              accessibilityLabel="Name"
            />

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

            <TextField
              label="Password"
              placeholder="At least 8 characters"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              secureToggle
              textContentType="newPassword"
              accessibilityLabel="Password"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label={sendingCode ? "Sending code..." : "Send code"}
              onPress={handleSendCode}
              loading={sendingCode}
              disabled={!canSendCode}
              accessibilityLabel="Send code"
              style={styles.submitButton}
            />

            <Link href="/login" asChild>
              <TouchableOpacity accessibilityRole="link" accessibilityLabel="Already have an account? Log in">
                <Text style={styles.link}>Already have an account? Log in</Text>
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
