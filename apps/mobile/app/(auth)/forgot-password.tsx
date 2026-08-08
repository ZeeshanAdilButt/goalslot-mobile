import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Link, router } from "expo-router";

import { apiClient } from "@/lib/api-client";

const MIN_PASSWORD_LENGTH = 8;

// Neither step here touches session state (no tokens are issued by
// send-otp/reset-password), so this screen talks to apiClient directly
// rather than going through the auth provider — same reasoning as
// signup.tsx's "Send code" step.
function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) {
      return response.data.message;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<"email" | "reset">("email");

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  if (step === "reset") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code we sent to {email}</Text>

        <TextInput
          style={styles.input}
          placeholder="6-digit code"
          value={otp}
          onChangeText={setOtp}
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
          accessibilityLabel="Verification code"
        />

        <TextInput
          style={styles.input}
          placeholder="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          textContentType="newPassword"
          accessibilityLabel="New password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, (submitting || !canReset) && styles.buttonDisabled]}
          onPress={handleResetPassword}
          disabled={submitting || !canReset}
          accessibilityRole="button"
          accessibilityLabel="Reset password"
        >
          <Text style={styles.buttonText}>{submitting ? "Resetting..." : "Reset password"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setStep("email")}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Back to email entry"
        >
          <Text style={styles.link}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forgot password</Text>
      <Text style={styles.subtitle}>We&apos;ll send a code to your email to reset your password.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Email"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (sendingCode || !canSendCode) && styles.buttonDisabled]}
        onPress={handleSendCode}
        disabled={sendingCode || !canSendCode}
        accessibilityRole="button"
        accessibilityLabel="Send reset code"
      >
        <Text style={styles.buttonText}>{sendingCode ? "Sending code..." : "Send reset code"}</Text>
      </TouchableOpacity>

      <Link href="/login" asChild>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="Back to log in">
          <Text style={styles.link}>Back to log in</Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: "#4A5568",
    marginTop: -8,
    marginBottom: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#8A94A6",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: {
    color: "#B3261E",
  },
  button: {
    marginTop: 8,
    backgroundColor: "#1F2933",
    borderRadius: 6,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  link: {
    color: "#1F2933",
    textAlign: "center",
    fontSize: 14,
    marginTop: 4,
    textDecorationLine: "underline",
  },
});
