// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/.expo/**", "**/node_modules/**", "**/android/**", "**/ios/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/mobile/src/**/*.tsx", "apps/mobile/app/**/*.tsx"],
    rules: {
      // A BottomSheetModal with no android_keyboardInputMode falls back to
      // the OS default (adjustResize), which this app's edge-to-edge Android
      // build ignores — the keyboard then covers the sheet's own text
      // fields. That one prop has shipped missing five separate times
      // because nothing forced it to travel alongside keyboardBehavior/
      // keyboardBlurBehavior. Sheets with a text input belong on
      // `KeyboardSheet` (src/components/ui/KeyboardSheet.tsx), which bakes
      // all three in; a pure action/list sheet with nothing for the
      // keyboard to cover can silence this with a one-line
      // eslint-disable-next-line and a comment saying so.
      // Severity is "error" rather than "warn" deliberately: both selectors
      // below cover defects that have each shipped to real devices more than
      // once, and a warning is invisible in an editor that only surfaces
      // errors. CI already runs --max-warnings 0, so this changes nothing
      // there — it only makes the failure visible earlier.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name='BottomSheetModal']:not(:has(JSXAttribute[name.name='android_keyboardInputMode']))",
          message:
            "BottomSheetModal is missing android_keyboardInputMode. If this sheet has a text input, build it on KeyboardSheet instead. If it's a pure action/list sheet, add eslint-disable-next-line no-restricted-syntax with a comment confirming that.",
        },
        {
          // Reported on the `snapPoints` attribute rather than on the opening
          // element ON PURPOSE. Pure list/action sheets legitimately silence
          // the rule above with an `eslint-disable-next-line
          // no-restricted-syntax` sitting on the `<BottomSheetModal` line,
          // and that one comment would suppress the whole rule — including
          // this selector — if this also reported there. Anchoring to the
          // offending prop keeps the two independent, and points at the
          // declaration that actually has to change.
          // KeyboardSheet is included because it forwards every prop straight
          // through to BottomSheetModal, so a sheet built on the blessed
          // wrapper inherits exactly the same contract — and the wrapper is
          // the path new sheets are told to take.
          selector:
            ":matches(JSXOpeningElement[name.name='BottomSheetModal'], JSXOpeningElement[name.name='KeyboardSheet']):not(:has(JSXAttribute[name.name='enableDynamicSizing'])) > JSXAttribute[name.name='snapPoints']",
          message:
            "BottomSheetModal/KeyboardSheet with explicit snapPoints must also set enableDynamicSizing={false}. @gorhom/bottom-sheet v5 defaults enableDynamicSizing to TRUE, and while it is on, snapPoints are ignored until a BottomSheetView or bottom-sheet scrollable reports a content height — plain RN Views never do, so present() becomes a silent no-op and the sheet (and its backdrop) never appear at all. Either add enableDynamicSizing={false}, or, if every branch of this sheet really does render a measuring BottomSheet* child, disable this line with a comment saying which one.",
        },
      ],
    },
  },
  {
    files: ["**/*.cjs", "**/*.config.js", "**/plugins/**/*.js"],
    languageOptions: {
      globals: {
        module: "writable",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      // Metro/babel config files (and Expo config plugins under any
      // `plugins/` dir, e.g. apps/mobile/plugins/withAppActions.js) are
      // loaded directly by Node/Expo CLI as plain CommonJS at prebuild
      // time, not run through this project's TS/ESM pipeline — `require()`
      // here isn't a stylistic choice, it's the only thing that works.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Repo tooling run directly by Node as ESM (e.g.
    // apps/mobile/scripts/verify-build-freshness.mjs, the release gate that
    // checks a built APK actually contains current JS and that the OTA
    // channel it points at resolves). These never enter the React Native
    // bundle, so they get Node's globals rather than the RN environment the
    // rest of the config assumes.
    files: ["**/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  }
);
