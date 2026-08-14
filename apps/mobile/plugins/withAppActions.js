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
// commands; both commands' string entries and XML blocks have landed here
// as siblings, matching android-shortcuts.xml's own ownership note.
const SHORTCUTS_XML_SOURCE = path.join(__dirname, "android-shortcuts.xml");

// Apostrophes are backslash-escaped (`\'`), same as
// widgetprovider_todaywidget.xml's own `widget_todaywidget_description`
// string — Android string resources require this (an unescaped `'` isn't
// an XML-special character so @expo/config-plugins' XML writer passes it
// through untouched, but AAPT2's resource compiler then rejects it outright
// with an opaque "Can not extract resource from ParsedResource" error, not
// a message that names the apostrophe as the cause).
const NEW_STRINGS = [
  ["shortcut_start_timer_short", "Start timer"],
  ["shortcut_start_timer_long", "Start timer for the current block"],
  ["shortcut_journal_short", "Talk about my day"],
  ["shortcut_journal_long", "Start today\\'s journal entry"],
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
