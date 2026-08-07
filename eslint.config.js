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
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.cjs", "**/*.config.js"],
    languageOptions: {
      globals: {
        module: "writable",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      // Metro/babel config files are loaded directly by Node/Metro as plain
      // CommonJS, not run through this project's TS/ESM pipeline — `require()`
      // here isn't a stylistic choice, it's the only thing that works.
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
