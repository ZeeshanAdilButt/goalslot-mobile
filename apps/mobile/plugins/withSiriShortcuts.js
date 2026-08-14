const { withDangerousMod, withXcodeProject, IOSConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// Config plugin: wires GoalSlot's "Hey Siri" App Intents (AppShortcuts.swift,
// StartTimerIntent.swift, StartTimerForGoalIntent.swift,
// TalkAboutMyDayIntent.swift) into the main "GoalSlot" iOS app target so
// they actually compile into the app and Siri/Shortcuts can surface them —
// the iOS sibling of withAppActions.js's Android App Actions plugin.
//
// Two separate problems, both only fixable via a config plugin because
// apps/mobile/.gitignore ignores /ios (same rule, same reasoning as
// withAppActions.js's own note about /android): any change made straight to
// the generated ios/ directory silently disappears the next time someone
// runs `expo prebuild --clean`.
//
// Problem 1 — the files themselves. The four .swift files' real source of
// truth lives here, in plugins/ios-siri-shortcuts/ (tracked, reviewable),
// not in ios/GoalSlot/ (generated, gitignored, wiped on --clean). This
// mirrors android-shortcuts.xml's own pattern exactly: a plain, real file
// that this plugin copies into the generated tree on every prebuild via
// withDangerousMod, since config-plugins has no typed mod for arbitrary new
// source files the way it does for Info.plist/AndroidManifest.xml.
//
// Problem 2 — target membership. Even once the files exist on disk in
// ios/GoalSlot/, Xcode won't compile them: the main app target's group
// (ios/GoalSlot/) is a plain, non-file-system-synchronized PBXGroup — unlike
// ios/.targets/GoalSlotWidget (see targets/widget/expo-target.config.js /
// @bacons/apple-targets), which is a PBXFileSystemSynchronizedRootGroup that
// auto-includes anything dropped in its folder. A plain PBXGroup only
// controls what shows up in Xcode's file navigator; a file additionally
// needs a PBXBuildFile entry in the target's PBXSourcesBuildPhase before it
// compiles into anything. Each of the four .swift files' own header comments
// already called this out and pointed at this exact fix (a config plugin
// using the `xcode` package's `project.addSourceFile`, applied at prebuild
// time — not a hand-edited project.pbxproj, which prebuild would discard
// anyway). `xcode` is already a transitive dependency via
// @expo/config-plugins (see node_modules/xcode) — no new direct dependency
// needed.
//
// A third, less obvious problem also needs the same target-membership fix:
// AppIntents.framework. It's already referenced in this project (the
// GoalSlotWidget extension links it), but a framework link is per-target in
// Xcode's project model — one target linking a system framework does not
// link it for another target. Without linking it into "GoalSlot" too, the
// main app target fails to link the moment the four files above start
// compiling into it, with undefined symbols for `AppIntent`,
// `AppShortcutsProvider`, etc.
//
// Not needed: no Info.plist keys, no Siri entitlement, no capability toggle
// in Signing & Capabilities. AppShortcutsProvider (iOS 16+ App Intents, not
// the older SiriKit domain intents) needs none of that — see
// AppShortcuts.swift's own header. This app's deployment target (16.4 — see
// ios/Podfile / IPHONEOS_DEPLOYMENT_TARGET in project.pbxproj) already
// clears the iOS 16 floor App Intents requires.
const SIRI_SOURCE_DIR = path.join(__dirname, "ios-siri-shortcuts");

const SIRI_SOURCE_FILES = [
  "AppShortcuts.swift",
  "StartTimerIntent.swift",
  "StartTimerForGoalIntent.swift",
  "TalkAboutMyDayIntent.swift",
];

const APP_INTENTS_FRAMEWORK_PATH = "System/Library/Frameworks/AppIntents.framework";

function withSiriShortcutsFiles(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const targetDir = path.join(config.modRequest.platformProjectRoot, "GoalSlot");
      fs.mkdirSync(targetDir, { recursive: true });
      for (const filename of SIRI_SOURCE_FILES) {
        fs.copyFileSync(path.join(SIRI_SOURCE_DIR, filename), path.join(targetDir, filename));
      }
      return config;
    },
  ]);
}

// There are two PBXGroups named "GoalSlot" in this project: one holds
// ExpoModulesProvider.swift (part of the generated Expo modules
// registration, unrelated to us), the other is the actual ios/GoalSlot/
// source folder that holds AppDelegate.swift and is where the four copied
// files above land on disk. Both groups only set `name` (no `path`), so a
// plain by-name lookup (`xcode`'s own `pbxGroupByName`/`findPBXGroupKey`) is
// ambiguous and can silently match the wrong one depending on object-key
// iteration order. Anchor on AppDelegate.swift instead — it's the one file
// guaranteed to be a child of the real target group.
function findAppTargetSourceGroupKey(project) {
  const groups = project.hash.project.objects.PBXGroup || {};
  for (const key of Object.keys(groups)) {
    if (key.endsWith("_comment")) continue;
    const group = groups[key];
    if (!group || group.name !== "GoalSlot") continue;
    const children = group.children || [];
    if (children.some((child) => (child.comment || "").includes("AppDelegate.swift"))) {
      return key;
    }
  }
  throw new Error(
    "withSiriShortcuts: couldn't find the 'GoalSlot' PBXGroup that contains " +
      "AppDelegate.swift in project.pbxproj. The main app target's group " +
      "structure may have changed — update the anchor file this plugin " +
      "looks for."
  );
}

// `xcode`'s own `addFramework()` is not usable here: it no-ops (returns
// false) whenever a PBXFileReference for the given path already exists
// *anywhere* in the project, regardless of which target it's linked to — see
// `hasFile()` in node_modules/xcode/lib/pbxProject.js. AppIntents.framework
// already has such a reference (added for GoalSlotWidget), so a naive
// `addFramework` call for the main target would silently do nothing. Instead:
// find the existing PBXFileReference, and add a *new* PBXBuildFile entry
// that points the *main target's* Frameworks build phase at that same file
// reference. Two targets linking the same system framework via two separate
// PBXBuildFile entries sharing one PBXFileReference is completely normal in
// an Xcode project.
function ensureFrameworkLinkedToTarget(project, frameworkPath, targetUuid) {
  const fileRefSection = project.pbxFileReferenceSection();
  let fileRefUuid = null;
  for (const key of Object.keys(fileRefSection)) {
    if (key.endsWith("_comment")) continue;
    const ref = fileRefSection[key];
    if (ref && (ref.path === frameworkPath || ref.path === `"${frameworkPath}"`)) {
      fileRefUuid = key;
      break;
    }
  }

  if (!fileRefUuid) {
    // No reference anywhere yet (not the case in this project today, since
    // GoalSlotWidget already links AppIntents.framework, but handled in case
    // that ever changes) — the library's own helper creates the
    // PBXFileReference too, so it's safe to use as-is here.
    project.addFramework(frameworkPath, { target: targetUuid });
    return;
  }

  const frameworksPhase = project.pbxFrameworksBuildPhaseObj(targetUuid);
  const buildFileSection = project.pbxBuildFileSection();
  const alreadyLinked = (frameworksPhase.files || []).some((entry) => {
    const buildFile = buildFileSection[entry.value];
    return buildFile && buildFile.fileRef === fileRefUuid;
  });
  if (alreadyLinked) return; // idempotent: already linked for this target.

  const buildFileUuid = project.generateUuid();
  const comment = "AppIntents.framework in Frameworks";
  buildFileSection[buildFileUuid] = {
    isa: "PBXBuildFile",
    fileRef: fileRefUuid,
    fileRef_comment: "AppIntents.framework",
  };
  buildFileSection[`${buildFileUuid}_comment`] = comment;
  frameworksPhase.files.push({ value: buildFileUuid, comment });
}

function withSiriShortcutsXcodeProject(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;

    const [targetUuid] = IOSConfig.Target.findFirstNativeTarget(project);
    const groupKey = findAppTargetSourceGroupKey(project);

    for (const filename of SIRI_SOURCE_FILES) {
      // `addSourceFile` is naturally idempotent for our purposes: internally
      // it calls `addFile`, which bails out (returns null, so `addSourceFile`
      // returns false) whenever a PBXFileReference with this exact `path`
      // already exists anywhere in the project — see `hasFile()` in
      // node_modules/xcode/lib/pbxProject.js. Since we pass the same path
      // string on every prebuild, a second run is a no-op instead of a
      // duplicate.
      project.addSourceFile(path.posix.join("GoalSlot", filename), { target: targetUuid }, groupKey);
    }

    ensureFrameworkLinkedToTarget(project, APP_INTENTS_FRAMEWORK_PATH, targetUuid);

    return config;
  });
}

module.exports = function withSiriShortcuts(config) {
  config = withSiriShortcutsFiles(config);
  config = withSiriShortcutsXcodeProject(config);
  return config;
};
