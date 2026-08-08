import { useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Link, useLocalSearchParams } from "expo-router";

import { useAuth } from "@/providers/auth-provider";

export default function LoginScreen() {
  const { login } = useAuth();
  const { resetSuccess } = useLocalSearchParams<{ resetSuccess?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // On success `status` flips to 'authenticated' and the (auth) group
      // layout's Redirect takes over — no manual navigation needed here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log in to GoalSlot</Text>

      {resetSuccess ? (
        <Text style={styles.success}>Your password has been reset. Please log in.</Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting || !email || !password}
        accessibilityRole="button"
        accessibilityLabel="Log in"
      >
        <Text style={styles.buttonText}>{submitting ? "Logging in..." : "Log in"}</Text>
      </TouchableOpacity>

      <Link href="/forgot-password" asChild>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="Forgot password?">
          <Text style={styles.link}>Forgot password?</Text>
        </TouchableOpacity>
      </Link>

      <Link href="/signup" asChild>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="Don't have an account? Sign up">
          <Text style={styles.link}>Don&apos;t have an account? Sign up</Text>
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
  success: {
    color: "#1B7F3E",
  },
  link: {
    color: "#1F2933",
    textAlign: "center",
    fontSize: 14,
    marginTop: 4,
    textDecorationLine: "underline",
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
});
