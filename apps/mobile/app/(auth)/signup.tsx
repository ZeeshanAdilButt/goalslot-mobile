import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Link } from "expo-router";

import { useAuth } from "@/providers/auth-provider";
import { apiClient } from "@/lib/api-client";

const MIN_PASSWORD_LENGTH = 8;

// sendOTP (and later verify-via-register) don't touch session state — no
// tokens, no store update — so they're called directly against apiClient
// rather than going through the auth provider. `register`, which DOES set
// tokens/user on success, is already exposed by the provider and is reused
// as-is (see src/providers/auth-provider.tsx).
function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) {
      return response.data.message;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

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

  if (step === "otp") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Verify your email</Text>
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, (submitting || !canCreateAccount) && styles.buttonDisabled]}
          onPress={handleCreateAccount}
          disabled={submitting || !canCreateAccount}
          accessibilityRole="button"
          accessibilityLabel="Create account"
        >
          <Text style={styles.buttonText}>{submitting ? "Creating account..." : "Create account"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setStep("form")}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Back to sign up details"
        >
          <Text style={styles.link}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create your GoalSlot account</Text>

      <TextInput
        style={styles.input}
        placeholder="Name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        textContentType="name"
        accessibilityLabel="Name"
      />

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

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="newPassword"
        accessibilityLabel="Password"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, (sendingCode || !canSendCode) && styles.buttonDisabled]}
        onPress={handleSendCode}
        disabled={sendingCode || !canSendCode}
        accessibilityRole="button"
        accessibilityLabel="Send code"
      >
        <Text style={styles.buttonText}>{sendingCode ? "Sending code..." : "Send code"}</Text>
      </TouchableOpacity>

      <Link href="/login" asChild>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="Already have an account? Log in">
          <Text style={styles.link}>Already have an account? Log in</Text>
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
