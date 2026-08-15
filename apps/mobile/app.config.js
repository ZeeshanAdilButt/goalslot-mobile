// Expo reads `app.json` first and then hands it to this file, which is the
// only place in the config pipeline that can see `process.env`. Everything
// static stays in app.json; only the values that legitimately differ per
// environment are layered on here.
//
// Messaging (the jiffy-messaging service — see the messaging screens in
// app/(app)/) is deployed separately from the GoalSlot API and is NOT
// available in every environment: local dev builds, forks, and anything
// pointing at an API that predates the service all run without it. So both
// URLs default to null, and `src/lib/messaging-config.ts` treats null as
// "feature off" — the drawer entry disappears and nothing in the feature is
// ever constructed against a bogus URL.
//
// `EXPO_PUBLIC_`-prefixed names are used for consistency with Expo's own
// convention for build-time public config, but these are read HERE (in Node,
// at config evaluation) rather than inlined into the bundle, so they land in
// `expoConfig.extra` alongside `apiBaseUrl` and are read the same way.

/**
 * Derives the WebSocket origin from the HTTP one, so a deployment only has to
 * set one variable in the common case where the service answers both on the
 * same host. https -> wss, http -> ws. Returns null (not a broken URL) for
 * anything that isn't a recognisable http(s) origin.
 */
function deriveWsUrl(httpUrl) {
  if (typeof httpUrl !== "string" || httpUrl.length === 0) return null;
  if (httpUrl.startsWith("https://")) return `wss://${httpUrl.slice("https://".length)}`;
  if (httpUrl.startsWith("http://")) return `ws://${httpUrl.slice("http://".length)}`;
  return null;
}

function trimTrailingSlash(value) {
  return typeof value === "string" && value.length > 0 ? value.replace(/\/+$/, "") : null;
}

module.exports = ({ config }) => {
  const messagingUrl = trimTrailingSlash(process.env.EXPO_PUBLIC_MESSAGING_URL || config.extra?.messagingUrl);
  const messagingWsUrl =
    trimTrailingSlash(process.env.EXPO_PUBLIC_MESSAGING_WS_URL || config.extra?.messagingWsUrl) ??
    deriveWsUrl(messagingUrl);

  return {
    ...config,
    extra: {
      ...config.extra,
      messagingUrl,
      messagingWsUrl,
      // EAS Build sets this to the exact commit the build was compiled
      // from; unset for a local dev build. Surfaced read-only in Settings
      // (see the "About" section in app/(app)/settings.tsx) so "which
      // build is this phone actually running" is answerable from inside
      // the app instead of by cross-referencing EAS dashboards.
      gitCommitHash: process.env.EAS_BUILD_GIT_COMMIT_HASH ?? null,
    },
  };
};
