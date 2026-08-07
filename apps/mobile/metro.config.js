// No metro.config.js existed before this — Expo's default Metro config was
// implicit. `@shopify/flash-list`, `@gorhom/bottom-sheet`, and
// `react-native-gesture-handler` all work fine against the plain default
// config (no custom resolver/transformer needs). The one thing worth
// wrapping in explicitly is Reanimated's own metro helper: per Reanimated
// 4.x's docs (node_modules/react-native-reanimated/metro-config), wrapping
// the default config with `wrapWithReanimatedMetroConfig` makes the
// Metro symbolicator collapse stack frames that originate inside
// react-native-reanimated's own source, so a thrown error's stack trace
// points at app code instead of library internals. Purely a DX/debugging
// improvement — omitting it would not break the bundle — but it's what the
// library's own setup instructions call for, so we do it.
const { getDefaultConfig } = require("expo/metro-config");
const { wrapWithReanimatedMetroConfig } = require("react-native-reanimated/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = wrapWithReanimatedMetroConfig(config);
