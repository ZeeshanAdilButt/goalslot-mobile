// Crash reporting via @sentry/react-native. Currently wired to a placeholder
// DSN — no real Sentry project exists yet, same "correctly-shaped-but-inert"
// pattern as `updates` in app.json (see the `_comment` there). `initSentry()`
// is a no-op whenever the DSN still equals the placeholder, so the app never
// tries to talk to a Sentry project that doesn't exist and CI never needs a
// real DSN to build. Swap PLACEHOLDER_DSN for the real one (and flip
// `organization`/`project` into the `@sentry/react-native` entry in
// app.json's `plugins`) once a human sets up the real Sentry project.
import * as Sentry from "@sentry/react-native";

const PLACEHOLDER_DSN = "YOUR_SENTRY_DSN_HERE";

// Real DSN goes here once a Sentry project exists. Left as the placeholder
// on purpose — see module comment above.
const SENTRY_DSN: string = PLACEHOLDER_DSN;

export function initSentry(): void {
  if (SENTRY_DSN === PLACEHOLDER_DSN) {
    console.warn(
      "[GoalSlot] Sentry DSN is still the placeholder value — skipping Sentry.init(). " +
        "Crash reporting is disabled until a real DSN is set in src/lib/sentry.ts."
    );
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}
