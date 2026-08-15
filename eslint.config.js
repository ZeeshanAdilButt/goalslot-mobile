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
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "JSXOpeningElement[name.name='BottomSheetModal']:not(:has(JSXAttribute[name.name='android_keyboardInputMode']))",
          message:
            "BottomSheetModal is missing android_keyboardInputMode. If this sheet has a text input, build it on KeyboardSheet instead. If it's a pure action/list sheet, add eslint-disable-next-line no-restricted-syntax with a comment confirming that.",
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
  }
);
