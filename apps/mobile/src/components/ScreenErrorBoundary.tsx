// The one thing standing between an uncaught render/effect exception
// anywhere in the signed-in app and the whole app going dark.
//
// Before this existed, `grep -rln "ErrorBoundary\|componentDidCatch\|getDerivedStateFromError"`
// across app/ and src/ returned nothing — a bug anywhere in the tab tree (a
// null dereference, a bad prop, anything with no error boundary above it to
// catch it) propagated straight past React with no fallback UI. In a release
// build (no redbox, and Sentry is still wired to a placeholder DSN — see
// src/lib/sentry.ts — so nothing reports it either) that reads to the user as
// "the app itself closed" rather than as an error they could recover from.
//
// This is deliberately NOT a fix for any specific bug, and does not claim to
// be. It is the safety net most other screens' error handling has been
// missing: it only helps for exceptions thrown inside React's own
// render/commit/effect lifecycle, which is the one category of failure a
// plain JS try/catch can never intercept on its own (there is no call frame
// to wrap — React itself is what invokes the throwing code). It does nothing
// for a genuine native-side crash outside the JS thread entirely, and it
// does nothing for an exception thrown inside a bare native-event-emitter
// callback with no React frame anywhere above it on the stack — those are
// handled at their own call sites instead (see the try/catch hardening in
// src/hooks/useVoiceCapture.ts and src/lib/speech-recognition.ts).
//
// A class component because `getDerivedStateFromError`/`componentDidCatch`
// have no Hooks equivalent — this is the one place in this codebase a class
// component is the only option, not a stylistic choice.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ErrorState } from "@/components/ErrorState";
import { colors } from "@/theme/tokens";

interface ScreenErrorBoundaryProps {
  children: ReactNode;
}

interface ScreenErrorBoundaryState {
  error: Error | null;
}

export class ScreenErrorBoundary extends Component<ScreenErrorBoundaryProps, ScreenErrorBoundaryState> {
  state: ScreenErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // console.error, not a toast: a toast fits an action that failed, not
    // "the screen you were looking at just fell over" — ErrorState's own
    // fallback UI below is the user-visible surface for that. This is purely
    // the diagnostic trail, same as every other catch block in this app that
    // has nowhere better to report to while Sentry's DSN is still a
    // placeholder (see src/lib/sentry.ts).
    console.error("ScreenErrorBoundary caught an error:", error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
          <ErrorState
            title="Something went wrong"
            message="This screen ran into a problem. You can try again, or switch to another tab."
            onRetry={this.handleRetry}
            retryLabel="Try again"
          />
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
