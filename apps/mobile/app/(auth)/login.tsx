import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";

import { useAuth } from "@/providers/auth-provider";
import { GoalSlotLogo } from "@/components/brand/GoalSlotLogo";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { colors, radii, shadows, spacing, typography, motion } from "@/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const { resetSuccess } = useLocalSearchParams<{ resetSuccess?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Entrance animation is opt-out under reduce-motion, per the design
  // brief — the logo/form still render instantly, just without the
  // fade + translate.
  const reduceMotion = useReduceMotion();

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
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base)}
            style={styles.brandBlock}
          >
            <View style={styles.logoBadge}>
              <GoalSlotLogo size={44} color={colors.primary} accessibilityLabel="GoalSlot logo" />
            </View>
            <Text style={styles.brandName}>GoalSlot</Text>
          </Animated.View>

          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(motion.duration.base).delay(80)}
            style={styles.formBlock}
          >
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Log in to keep your goals on track.</Text>

            {resetSuccess ? <Text style={styles.success}>Your password has been reset. Please log in.</Text> : null}

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
              placeholder="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              accessibilityLabel="Password"
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              label={submitting ? "Logging in..." : "Log in"}
              onPress={handleSubmit}
              loading={submitting}
              disabled={!email || !password}
              accessibilityLabel="Log in"
              style={styles.submitButton}
            />

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
  success: {
    color: colors.success,
    fontSize: typography.size.sm,
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
