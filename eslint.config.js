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
