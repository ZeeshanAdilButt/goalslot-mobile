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
      // keyboard to cover can silence this with a one-line disable
      // directive and a comment saying so.
      //
      // (That sentence is worded to avoid writing the directive's own name
      // followed by text — ESLint parses ANY comment beginning with
      // `eslint-disable-next-line` as a real directive, including one inside
      // explanatory prose like this. This comment used to do exactly that,
      // and the trailing words were read as a rule name, so every lint run
      // failed with "Definition for rule 'and a comment saying so.' was not
      // found" — a red CI caused purely by a comment.)
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
        {
          // The two selectors above only ever look at ONE element name each,
          // `BottomSheetModal` and `KeyboardSheet` — i.e. they cover sheets
          // built on @gorhom, and nothing else. That is why neither of them
          // said a word about the global search overlay, which is a plain
          // absolutely-positioned <Animated.View> over a <ScrollView> and
          // shipped with no keyboard handling at all: the user could not
          // reach the lower search results, because on Android under
          // edge-to-edge the window never shrinks for the keyboard, so the
          // rows below the keyboard line are laid out off-screen with
          // nothing to scroll to them. The journal editor had the identical
          // defect, with its Save button under the keyboard.
          //
          // This selector generalises the two above from "a sheet is missing
          // a prop" to the actual class: A FILE THAT RENDERS A TEXT INPUT
          // AND A SCROLL CONTAINER, AND HANDLES THE KEYBOARD NOWHERE. It is
          // anchored on the scroll container rather than on Program so the
          // report points at the element that has to change, and so a
          // per-line disable here stays independent of the two selectors
          // above — the same reasoning spelled out for `snapPoints`.
          //
          // Satisfying it means the file mentions one of: KeyboardAvoidingView
          // (push a composer up — message/[id], coach, the auth screens),
          // KeyboardSheet or BottomSheetScrollView (a @gorhom sheet manages
          // its own inset), or the `useKeyboardInset` hook (pad a list's
          // reachable extent — src/hooks/useKeyboardInset.ts, which documents
          // when to prefer which).
          //
          // It is a heuristic, not a proof: mentioning KeyboardAvoidingView
          // anywhere in the file satisfies it, exactly as the selectors above
          // only check that a prop is present rather than correct. That is
          // enough to stop the next screen shipping with nothing at all,
          // which is the failure that actually reached a user. A screen whose
          // scroll container genuinely cannot be covered (no input above it
          // in any branch) can disable this line with a comment saying so,
          // the same convention NewConversationSheet.tsx already uses.
          selector:
            "Program:has(JSXOpeningElement[name.name=/^(TextInput|TextField|BottomSheetTextInput)$/])" +
            ":not(:has(JSXOpeningElement[name.name=/^(KeyboardAvoidingView|KeyboardSheet|BottomSheetScrollView|KeyboardAwareScrollView)$/]))" +
            ":not(:has(Identifier[name='useKeyboardInset']))" +
            " :matches(JSXOpeningElement[name.name=/^(ScrollView|FlatList|SectionList|FlashList)$/], JSXOpeningElement[name.property.name=/^(ScrollView|FlatList|SectionList)$/])",
          message:
            "This file renders a text input above a scroll container but handles the soft keyboard nowhere. On Android under edge-to-edge the window does NOT resize for the keyboard, so rows laid out below the keyboard line cannot be scrolled to at all — that is the 'search hides the lower options under keyboard' bug. Fix it with one of: useKeyboardInset() added to the list's contentContainerStyle paddingBottom (see src/hooks/useKeyboardInset.ts for when to prefer this), a KeyboardAvoidingView if something has to be pushed up and stay visible, or KeyboardSheet/BottomSheetScrollView inside a bottom sheet. If this scroll container genuinely can never be covered by an input, disable this line with a comment saying why.",
        },
        {
          // A chat thread screen is a hidden tab, so it NEVER UNMOUNTS —
          // opening a second conversation reuses the same component and the
          // same native scroll view. Without a reset key, useThreadScroll
          // carries the previous conversation's pin state (and the list keeps
          // its literal offset), so the new thread opens part-way up its
          // history showing a "Jump to latest" pill. That is the reported
          // "opening a new message many times takes me to an older state".
          //
          // Narrow and exact rather than heuristic: it only fires on calls to
          // this one hook, so it has no false positives, and it fails the
          // moment a second thread-like screen is written against it.
          selector:
            "CallExpression[callee.name='useThreadScroll'] > ObjectExpression:not(:has(Property[key.name='resetKey']))",
          message:
            "useThreadScroll needs a `resetKey` (the conversation id). Thread screens are hidden tabs that never unmount, so without it the pin state and the native scroll offset carry over from the previously-opened conversation — the new thread then opens mid-history with a spurious 'Jump to latest' pill.",
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
