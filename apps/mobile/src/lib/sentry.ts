// Crash reporting via @sentry/react-native. Currently wired to a placeholder
// DSN — no real Sentry project exists yet, same "correctly-shaped-but-inert"
// pattern as `updates` in app.json (see the `_comment` there). `initSentry()`
// is a no-op whenever the DSN still equals the placeholder, so the app never
// tries to talk to a Sentry project that doesn't exist and CI never needs a
// real DSN to build. Swap PLACEHOLDER_DSN for the real one (and flip
// `organization`/`project` into the `@sentry/react-native` entry in
// app.json's `plugins`) once a human sets up the real Sentry project.
// Type-only, so it is fully erased at build time and pulls nothing in at
// runtime. The real module is loaded below, *after* the DSN guard.
import type * as SentryModule from "@sentry/react-native";

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

  // Required lazily, below the guard. `initSentry()` runs at module load in
  // app/_layout.tsx, before the first render, and with the placeholder DSN it
  // does nothing at all — but a top-level `import` still made every cold start
  // evaluate the whole @sentry/react-native module graph for zero benefit.
  // (Metro does not tree-shake, so this does not shrink the bundle; it moves
  // the module's *evaluation* off the startup path.) Once a real DSN is set
  // this loads exactly as before, just a few lines later.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/react-native") as typeof SentryModule;

  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 1.0,
  });
}
