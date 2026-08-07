module.exports = {
  preset: "jest-expo",
  passWithNoTests: true,
  // No custom `transformIgnorePatterns` here: `jest-expo`'s own preset
  // already ships one that's pnpm-aware (it allow-lists ".pnpm" itself, so
  // packages reached through pnpm's "node_modules/.pnpm/<pkg>@<hash>/node_modules/<real-pkg>"
  // virtual-store layout still get matched and transformed). An app-level
  // override here previously shadowed that default with a pattern that
  // didn't account for the pnpm layout, which broke on every RN/Expo
  // package's ESM syntax (e.g. @react-native/jest-preset's setup.js,
  // expo-modules-core's polyfills) the moment a real test file existed.
};
