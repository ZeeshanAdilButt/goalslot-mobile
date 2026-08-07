// Reanimated 4.x moved worklet compilation into a separate
// `react-native-worklets` package (`react-native-reanimated/plugin` is now
// just a re-export shim around `react-native-worklets/plugin` — see
// node_modules/react-native-reanimated/plugin/index.js). We don't add
// either plugin by hand, though: as of SDK 50, `babel-preset-expo` itself
// auto-detects an installed `react-native-worklets` (falling back to
// `react-native-reanimated/plugin` on older Reanimated majors) and appends
// it to the plugin list — see
// node_modules/babel-preset-expo/build/configs/expo.js, the
// "Automatically add worklets or reanimated plugin when package is
// installed" block. Manually adding either plugin here would just
// duplicate what the preset already does.
//
// react-native-gesture-handler needs no babel plugin at all — its setup is
// the `GestureHandlerRootView` wrapping the app root in app/_layout.tsx.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
