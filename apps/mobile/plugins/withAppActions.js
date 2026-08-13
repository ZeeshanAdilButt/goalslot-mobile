const { withDangerousMod, withAndroidManifest, withStringsXml, AndroidConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Config plugin: registers GoalSlot's Android App Shortcuts + App Actions
// capability so "Hey Google, Start timer, in GoalSlot" (and, once other
// agents' blocks land, "Talk about my day") work after `expo prebuild`.
//
// This exists instead of hand-editing the generated android/ directory
// directly because apps/mobile/.gitignore ignores /android — any change
// made straight to the generated files silently disappears the next time
// someone runs `expo prebuild --clean` (which the team debugging the
// native build is likely to do again before shipping). A config plugin is
// the only form of this change that survives that.
//
// See plugins/android-shortcuts.xml for the actual shortcut/capability
// declarations — kept as a real, reviewable XML file (this plugin copies
// it verbatim) rather than a JS template literal.
//
// Three things need to land for this to work, none of which app.json's
// declarative `android` block can express on its own:
//   1. res/xml/shortcuts.xml — the shortcut + capability declarations
//      (written via withDangerousMod, since config-plugins has no typed
//      mod for arbitrary new resource files the way it does for
//      strings.xml/AndroidManifest.xml).
//   2. <meta-data android:name="android.app.shortcuts" .../> on
//      <application>, pointing at that resource — same category of
//      additive edit the react-native-android-widget plugin already makes
//      for the widget's <receiver>, just a single meta-data node here.
//   3. The @string/shortcut_* resources the ShortcutManager XML schema
//      requires shortcut labels to reference (inline label text is not
//      allowed).
//
// Coordination note: this file and android-shortcuts.xml are shared
// infrastructure for both the "start timer" and "talk about my day" voice
// commands. Each command's build agent should add its OWN string entries
// to NEW_STRINGS below and its OWN <shortcut>/<capability> block to the
// XML file, without editing another agent's entries.
const SHORTCUTS_XML_SOURCE = path.join(__dirname, "android-shortcuts.xml");

// Added by the Android-timer agent. Android-journal agent: add your
// shortcut_journal_short / shortcut_journal_long entries as additional
// array items below — do not edit the two entries already here.
const NEW_STRINGS = [
  ["shortcut_start_timer_short", "Start timer"],
  ["shortcut_start_timer_long", "Start timer for the current block"],
];

function withAppActionsShortcutsXml(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.copyFileSync(SHORTCUTS_XML_SOURCE, path.join(xmlDir, "shortcuts.xml"));
      return config;
    },
  ]);
}

function withAppActionsManifest(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      mainApplication,
      "android.app.shortcuts",
      "@xml/shortcuts",
      "resource"
    );
    return config;
  });
}

function withAppActionsStrings(config) {
  return withStringsXml(config, (config) => {
    const items = NEW_STRINGS.map(([name, value]) => ({
      _: value,
      $: { name, translatable: "false" },
    }));
    config.modResults = AndroidConfig.Strings.setStringItem(items, config.modResults);
    return config;
  });
}

module.exports = function withAppActions(config) {
  config = withAppActionsShortcutsXml(config);
  config = withAppActionsManifest(config);
  config = withAppActionsStrings(config);
  return config;
};
