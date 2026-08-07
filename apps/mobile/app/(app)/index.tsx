import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAuth } from "@/providers/auth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";

export default function TodayScreen() {
  const { user, logout } = useAuth();
  const capabilities = useCapabilities();
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);

  // `VoiceCapability.isAvailable()` is async even on the noop implementation
  // (it matches the real capability's shape), so this proves the seam is
  // actually wired through a provider/hook and awaited, not just present in
  // the type system.
  useEffect(() => {
    let cancelled = false;
    void capabilities.voice.isAvailable().then((available) => {
      if (!cancelled) setVoiceAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, [capabilities]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GoalSlot</Text>
      <Text>Today screen — foundation scaffold, real content lands in Phase 4.</Text>

      <View style={styles.section}>
        <Text style={styles.label}>Signed in as</Text>
        <Text style={styles.value}>{user?.name ?? user?.email ?? "Unknown user"}</Text>
        {user?.name ? <Text style={styles.muted}>{user.email}</Text> : null}
      </View>

      <Text style={styles.debug}>
        Voice available: {voiceAvailable === null ? "checking..." : String(voiceAvailable)}
      </Text>

      <TouchableOpacity style={styles.button} onPress={() => void logout()}>
        <Text style={styles.buttonText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  section: {
    marginTop: 16,
    alignItems: "center",
    gap: 2,
  },
  label: {
    fontSize: 12,
    opacity: 0.6,
    textTransform: "uppercase",
  },
  value: {
    fontSize: 16,
    fontWeight: "500",
  },
  muted: {
    fontSize: 13,
    opacity: 0.6,
  },
  debug: {
    marginTop: 16,
    fontSize: 12,
    opacity: 0.6,
  },
  button: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    backgroundColor: "#1F2933",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
