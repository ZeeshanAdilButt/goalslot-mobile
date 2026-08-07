import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

export interface LoadingStateProps {
  message?: string;
  fullScreen?: boolean;
}

export function LoadingState({ message, fullScreen }: LoadingStateProps) {
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen]}>
      <ActivityIndicator size="large" />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  fullScreen: {
    flex: 1,
  },
  message: {
    fontSize: 14,
    opacity: 0.7,
  },
});
