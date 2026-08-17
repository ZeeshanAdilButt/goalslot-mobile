// Note editor: title + rich text (TipTap HTML) over @10play/tentap-editor's
// webview bridge. Routed as a hidden tab (`href: null` in the (app) layout)
// so it shares the group's auth guard while presenting as a full-screen push
// (the tab bar is hidden while it's focused; back affordance is local).
//
// Because the screen stays MOUNTED after navigating back (it's a tab, not a
// stack entry), everything note-specific lives in <NoteEditor key={note.id}>
// so switching notes remounts the editor bridge with the right
// initialContent, and pending saves flush on blur (focus-effect cleanup)
// while the webview is still alive — that is what makes "back navigation
// saves pending edits" reliable here.
//
// Autosave error handling deliberately differs from the tasks.tsx
// alert-on-failure shape: a failed debounced autosave surfaces as a passive
// banner and retries on the next edit/flush, because Alert-per-keystroke-batch
// while offline would be hostile. Three banner states, not two: a genuine
// failure (the server responded, it just said no — "couldn't save, will
// retry on your next edit"), a queue (no server response at all — routed to
// the offline outbox's already-registered "note-update" operation, tagged
// `pendingSync: true` so the title/content the user typed isn't just sitting
// in component state with nothing durable behind it if they leave the
// screen), and neither (the last save landed). The cache is patched in both
// the success AND the queued case — not success-only — specifically so a
// queued edit isn't lost even if the user backs out before the outbox drains.
//
// This screen is also where dictation into a page happens (the Notes tree
// screen's mic just creates a page and deep-links here with `?voice=1`) —
// see the "Dictation" block below for why appending a spoken sentence means
// reading the whole document and writing it back, rather than inserting at
// the cursor.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import type { WebViewMessageEvent } from "react-native-webview";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  CoreBridge,
  CoreEditorActionType,
  RichText,
  TenTapStartKit,
  Toolbar,
  useEditorBridge,
  useEditorContent,
} from "@10play/tentap-editor";

import { type Note, type NoteDetailResponse } from "@goalslot/shared";

import { LoadingState, QueryErrorState } from "@/components";
import { DictationPanel } from "@/components/voice/DictationPanel";
import { useDictationLoop } from "@/hooks/useDictationLoop";
import { colors, radii, shadows, spacing, typography } from "@/theme";
import { apiClient } from "@/lib/api-client";
import {
  appendNoteParagraph,
  decodeNoteEntities,
  hasUnsupportedMobileMarkup,
  normalizeContent,
} from "@/lib/note-content";
import { queueOfflineEdit } from "@/lib/offline";
import { noteQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useCapabilities } from "@/providers/capabilities-provider";

const TITLE_DEBOUNCE_MS = 500;
const CONTENT_DEBOUNCE_MS = 1000;
/** How long to wait for the webview editor to report ready before falling
 *  back to the plain-text view. */
const EDITOR_INIT_TIMEOUT_MS = 8000;

/**
 * Ceiling on one `editor.getHTML()` round-trip during dictation.
 *
 * `getHTML` goes over the webview bridge as an async message whose promise is
 * RESOLVE-ONLY — the library's AsyncMessages.sendAsyncMessage returns
 * `new Promise(resolve => ...)` with no reject path and no timeout of its own.
 * If the webview never answers, that promise never settles; useVoiceCapture's
 * `settle()` awaits the command with no timeout either, so the microphone
 * would sit in `processing` forever with no way back. This is the only thing
 * standing between a wedged webview and a permanently stuck mic.
 */
const EDITOR_READ_TIMEOUT_MS = 4000;

/** HTML-to-text for the editor-failed fallback view only. Kept separate from
 *  `htmlToPlainText` because this one renders a whole document rather than a
 *  one-line preview: block tags have to survive as paragraph breaks instead of
 *  collapsing into single spaces. Entity decoding is the shared pass, so the
 *  two never drift on what `&amp;` means. */
function stripHtml(html: string): string {
  return decodeNoteEntities(
    html.replace(/<(p|div|br|li|h[1-6]|blockquote)[^>]*>/gi, "\n").replace(/<[^>]*>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function NoteScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const noteId = typeof params.id === "string" ? params.id : "";

  const detailQuery = useQuery({ ...noteQueries.detail(noteId), enabled: noteId.length > 0 });

  if (!noteId || detailQuery.isPending) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LoadingState message="Opening page..." fullScreen />
      </SafeAreaView>
    );
  }

  // `isError && !data`, not the old `isError || !data` — that guard
  // replaced an already-rendered, perfectly good cached page with a hard
  // error on every failed background refetch (offline pull-to-refresh,
  // focus-refetch), even though the cached content needed to render it was
  // sitting right there. Matches the pattern goals.tsx/tasks.tsx/notes.tsx
  // already use correctly.
  if (detailQuery.isError && !detailQuery.data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerRow}>
          <BackButton />
        </View>
        <QueryErrorState
          error={detailQuery.error}
          message="Couldn't load this page."
          offlineMessage="Reconnect to load this page."
          onRetry={() => void detailQuery.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (!detailQuery.data) {
    // Every other state above is exhausted (not pending, not a fatal
    // error) with still no data to show — not expected to actually happen
    // in practice, but this keeps the `.note.id` access below a type-safe
    // narrowing rather than an unchecked assumption.
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <LoadingState message="Opening page..." fullScreen />
      </SafeAreaView>
    );
  }

  // Keyed remount per note: this screen instance is reused across different
  // /note/[id] navigations (hidden tab), but the editor bridge bakes
  // initialContent at mount.
  return <NoteEditor key={detailQuery.data.note.id} detail={detailQuery.data} />;
}

function BackButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress ?? (() => router.replace("/notes"))}
      hitSlop={12}
      style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
      accessibilityRole="button"
      accessibilityLabel="Back to notes"
    >
      <Text style={styles.backButtonText}>‹ Notes</Text>
    </Pressable>
  );
}

function NoteEditor({ detail }: { detail: NoteDetailResponse }) {
  const { note, readOnly } = detail;
  const initialContent = normalizeContent(note.content);

  /**
   * This page was authored on the web using formatting the mobile editor's
   * schema has no node for (a table, a divider, a code block, an alignment or
   * an indent) — see `hasUnsupportedMobileMarkup` for the verified list and why
   * the mobile schema can't be extended from here.
   *
   * Loading it into the webview produces a lossy document, and this screen's
   * autosave would then PUT that back over the good copy. So the page is shown,
   * but every content write path is switched off: the editor is not editable,
   * `saveContent` and `flushPending` refuse, and dictation (a read-modify-write
   * over the same lossy `getHTML()`) is not offered. Renaming still works — the
   * title is a separate scalar column and loses nothing.
   *
   * Computed synchronously from `initialContent`, before `useEditorBridge` is
   * constructed below, deliberately: derived from the editor's readiness
   * instead, there would be a window between mount and "ready" in which the
   * document is already lossy and the guards are not yet armed.
   */
  const formatLocked = hasUnsupportedMobileMarkup(initialContent);

  const [title, setTitle] = useState(note.title);
  // "failed": a genuine rejection, retries on the next edit/flush.
  // "queued": no server response at all — routed to the offline outbox
  // instead, so what's typed IS durable, just not confirmed yet.
  const [saveState, setSaveState] = useState<"idle" | "failed" | "queued">("idle");
  const [initTimedOut, setInitTimedOut] = useState(false);
  // Set directly off the webview's "editor-ready" message (posted once, from
  // Tiptap's onCreate) rather than off `useBridgeState(editor).isReady`.
  // That flag only rides along on a StateUpdate message, which the web
  // bundle sends from onUpdate/onSelectionUpdate/onTransaction — none of
  // which fire just from mounting. With `autofocus: false` below (deliberate,
  // so opening a note doesn't pop the keyboard), nothing ever dispatches an
  // initial ProseMirror transaction on its own, so that StateUpdate — and the
  // isReady flag riding along with it — never arrives until the user first
  // taps into the document. Gating the watchdog on it meant the 8s timeout
  // fired on every note the user didn't immediately touch, editor working or
  // not, and showed the "failed to initialize" fallback on a perfectly good
  // editor.
  const [editorReady, setEditorReady] = useState(false);
  // Android-only: `avoidIosKeyboard` (10tap-editor) is iOS-first by design —
  // it does resize the WebView's own document padding on Android too (see
  // RichText.tsx), but only assumes the *toolbar* needs clearing, on the
  // premise that windowSoftInputMode="adjustResize" has already shrunk this
  // screen's view tree so the WebView itself excludes the keyboard. That
  // premise doesn't hold here — nested inside a hidden-tab screen (see the
  // header comment), the resize doesn't reliably reach this subtree, so
  // both the always-visible Toolbar and the tail of the document can end up
  // sitting behind the keyboard. Tracking the keyboard height ourselves and
  // feeding it into layout (below) doesn't depend on that OS behavior at
  // all: the flex column always reserves the right amount of space,
  // regardless of whether adjustResize already did its job.
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const lastSavedTitleRef = useRef(note.title);
  const lastSavedContentRef = useRef(initialContent);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(note.title);
  titleRef.current = title;

  const editor = useEditorBridge({
    initialContent: initialContent || undefined,
    autofocus: false,
    avoidIosKeyboard: true,
    editable: !readOnly && !formatLocked,
    // The editor is a WebView, so it does NOT inherit this screen's React
    // Native padding — without this its text renders flush against the
    // device's left edge ("collapsed into my left border"). The gutter has
    // to be applied inside the document, and `.ProseMirror` is the
    // contenteditable root tentap mounts the document into. Matched to the
    // 20pt horizontal inset the rest of this screen uses (see the title
    // input and `fallbackContent` below) so the body text lines up with the
    // title above it instead of stepping in or out at the boundary.
    bridgeExtensions: [
      ...TenTapStartKit,
      CoreBridge.configureCSS(`
        .ProseMirror {
          padding: ${spacing.md}px ${spacing.xl}px ${spacing.xxxxl}px ${spacing.xl}px;
          font-size: 16px;
          line-height: 1.6;
          color: ${colors.foreground};
        }
        .ProseMirror p {
          margin: 0 0 12px;
        }
        .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
          font-weight: 700;
          color: ${colors.foreground};
          margin: 24px 0 8px;
          line-height: 1.3;
        }
        .ProseMirror blockquote {
          margin: 12px 0;
          padding-left: 12px;
          border-left: 3px solid ${colors.primary};
          color: ${colors.mutedForeground};
        }
        .ProseMirror a {
          color: ${colors.primaryText};
        }
        .ProseMirror code {
          background-color: ${colors.muted};
          padding: 2px 4px;
          border-radius: 4px;
          font-size: 14px;
        }
        .ProseMirror ::selection {
          background-color: ${colors.primaryBorder};
        }
      `),
    ],
  });

  const insets = useSafeAreaInsets();

  // See the androidKeyboardHeight comment above — this is the RN Keyboard
  // API tracking the task asked for, scoped to Android only since iOS
  // already gets correct behavior from `avoidIosKeyboard` + the "padding"
  // KeyboardAvoidingView below.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setAndroidKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Debounced (1000ms) HTML snapshot of the document — each emission that
  // differs from the last saved value triggers the update mutation below.
  const editedContent = useEditorContent(editor, {
    type: "html",
    debounceInterval: CONTENT_DEBOUNCE_MS,
  });

  /** Patch both caches with the saved fields. `pendingSync` defaults to
   *  false so a genuine success (or a later real sync) always clears any
   *  earlier "queued" tag left on the row. */
  const patchCaches = useCallback(
    (patch: Partial<Note>, pendingSync = false) => {
      const fullPatch = { ...patch, pendingSync };
      queryClient.setQueryData<NoteDetailResponse>(noteQueries.noteQueries.detail(note.id), (existing) =>
        existing ? { ...existing, note: { ...existing.note, ...fullPatch } } : existing,
      );
      queryClient.setQueryData<Note[]>(noteQueries.noteQueries.list(), (existing) =>
        (existing ?? []).map((n) => (n.id === note.id ? { ...n, ...fullPatch } : n)),
      );
    },
    [note.id],
  );

  const saveTitle = useCallback(
    async (nextTitle: string) => {
      if (readOnly || nextTitle === lastSavedTitleRef.current) return;
      try {
        await apiClient.notes.update(note.id, { title: nextTitle });
        lastSavedTitleRef.current = nextTitle;
        patchCaches({ title: nextTitle });
        setSaveState("idle");
      } catch (err) {
        const queued = await queueOfflineEdit("note-update", { id: note.id, data: { title: nextTitle } }, err);
        if (queued) {
          // No toast here (unlike explicit-action call sites elsewhere) —
          // autosave fires on every debounced keystroke batch, and a toast
          // per batch while typing offline would be noise. The persistent
          // "Queued" banner below is the ambient signal instead.
          lastSavedTitleRef.current = nextTitle;
          patchCaches({ title: nextTitle }, true);
          setSaveState("queued");
        } else {
          setSaveState("failed");
        }
      }
    },
    [note.id, patchCaches, readOnly],
  );

  const saveContent = useCallback(
    async (html: string) => {
      // `formatLocked` is checked HERE rather than only at the call sites
      // because this is the single choke point every content write goes
      // through — the debounced `useEditorContent` effect, `flushPending` on
      // blur/back/unmount, and dictation's read-modify-write all end up here.
      // Guarding any one of those alone would leave the others able to
      // overwrite the page with the webview's lossy re-serialization.
      if (readOnly || formatLocked || html === lastSavedContentRef.current) return;
      try {
        await apiClient.notes.update(note.id, { content: html });
        lastSavedContentRef.current = html;
        patchCaches({ content: html });
        setSaveState("idle");
      } catch (err) {
        const queued = await queueOfflineEdit("note-update", { id: note.id, data: { content: html } }, err);
        if (queued) {
          // Same reasoning as saveTitle — no toast per debounced batch.
          lastSavedContentRef.current = html;
          patchCaches({ content: html }, true);
          setSaveState("queued");
        } else {
          setSaveState("failed");
        }
      }
    },
    [formatLocked, note.id, patchCaches, readOnly],
  );

  // --- Dictation ------------------------------------------------------
  //
  // WHY READ-MODIFY-WRITE, AND NOT INSERT-AT-CURSOR: there is no
  // insert-at-cursor. @10play/tentap-editor's whole native-side editor API is
  // getHTML/getJSON/getText/setContent/setSelection/focus/blur/injectJS/
  // injectCSS/setEditable — `setContent` (a whole-document replace) is the
  // only write path it exposes, and the web bundle never puts the underlying
  // TipTap instance on `window`, so `injectJS` cannot reach
  // `editor.chain().insertContent(...)` either. So: read the document, append
  // a paragraph, write the whole thing back.
  //
  // Three consequences worth knowing before touching this:
  //  1. `setContent` does NOT focus the editor, which is exactly what makes
  //     hands-free dictation work here — no keyboard pops up.
  //  2. It replaces the whole document, so it must never land under a live
  //     cursor. Touching the editor (or the title) stops dictation first —
  //     see `stopForTyping` below.
  //  3. It emits an update, so the existing debounced autosave WOULD
  //     eventually persist this on its own. We deliberately do not rely on
  //     that: `saveContent` is called directly and awaited. The debounce is
  //     ~1s, `cancelVoice()` on blur does not abort an in-flight phrase, and
  //     a user who dictates a sentence and immediately hits back would lose
  //     it into a webview nobody reads again. (It would also make persistence
  //     depend on `emitUpdate` defaulting true in a minified transitive
  //     TipTap.) `saveContent` early-returns when nothing changed, so the
  //     debounced emission that follows is a no-op.
  const { voice } = useCapabilities();

  /** The in-flight dictation write, if any. `flushPending` waits on it so a
   *  blur-time `getHTML()` cannot capture the document from BEFORE the
   *  append and then save that stale copy over the freshly dictated text. */
  const pendingDictationRef = useRef<Promise<void> | null>(null);

  const appendSpokenPhrase = useCallback(
    (transcript: string): Promise<void> => {
      const write = (async () => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const html = await Promise.race([
          editor.getHTML(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("The editor stopped responding, so that sentence wasn't added.")),
              EDITOR_READ_TIMEOUT_MS,
            );
          }),
        ]).finally(() => {
          if (timer !== null) clearTimeout(timer);
        });

        const next = appendNoteParagraph(typeof html === "string" ? html : "", transcript);
        editor.setContent(next);
        // Awaited, not fired and forgotten — see consequence 3 above. This
        // never throws: `saveContent` routes a network failure to the offline
        // outbox and surfaces the rest as the passive banner.
        await saveContent(next);
      })();

      // Kept even after it settles: awaiting an already-settled promise is
      // free, so there is no need to clear it, and never clearing means
      // `flushPending` can't observe a half-updated ref.
      pendingDictationRef.current = write;
      return write;
    },
    [editor, saveContent],
  );

  const dictation = useDictationLoop({
    voice,
    onPhrase: appendSpokenPhrase,
    label: "Page dictation",
    // Dictating before the webview bridge reports ready is precisely the
    // `getHTML()` hang the timeout above exists for — so don't. `begin()`
    // parks in "priming" until the editor is up, which on an already-loaded
    // editor is the very next render (priming is never visibly shown).
    ready: editorReady,
    readyFailed: initTimedOut && !editorReady,
  });

  const { stopForTyping } = dictation;

  /**
   * Tapping into the document means the user wants to type — capture and
   * manual editing are mutually exclusive, or the whole-document `setContent`
   * above would land under a live cursor.
   *
   * Done from an RN capture-phase responder on the wrapper rather than from
   * the editor's own focus state: `<RichText>` is a WebView with no `onFocus`
   * prop, and `useBridgeState(editor).isFocused` only reaches React Native
   * riding on a StateUpdate message, which the web bundle emits from
   * onUpdate/onSelectionUpdate/onTransaction — none of which fire when the
   * caret is already where the tap put it (see the `editorReady` comment
   * above for the same channel failing on mount). Returning false means we
   * observe the touch without claiming it, so the WebView still receives it.
   */
  const handleEditorTouchCapture = useCallback(() => {
    stopForTyping();
    return false;
  }, [stopForTyping]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitle(text);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => {
        titleTimerRef.current = null;
        void saveTitle(text);
      }, TITLE_DEBOUNCE_MS);
    },
    [saveTitle],
  );

  // Save each debounced content emission.
  useEffect(() => {
    if (typeof editedContent === "string") {
      void saveContent(editedContent);
    }
  }, [editedContent, saveContent]);

  /** Flush anything pending right now — called on blur while the webview is
   *  still alive, so getHTML() can capture keystrokes newer than the last
   *  debounced emission. */
  const flushPending = useCallback(async () => {
    // `saveContent` would refuse a format-locked page anyway; returning early
    // also skips the `getHTML()` bridge round-trip, which on this path is
    // pure cost — its promise is resolve-only and never settles if the webview
    // has already gone away.
    if (readOnly || formatLocked) return;
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
      void saveTitle(titleRef.current);
    }
    // A dictated phrase is a read-modify-write over an async `getHTML()`.
    // Reading the document again while one is still in flight would capture
    // the version from BEFORE the append and then save that over the top of
    // it — losing the sentence the user just spoke. Wait it out first.
    // (Rejections are already handled by the dictation loop; swallowed here
    // so a failed append can't also skip the flush.)
    await pendingDictationRef.current?.catch(() => undefined);
    try {
      const html = await editor.getHTML();
      if (typeof html === "string") await saveContent(html);
    } catch {
      // Webview already torn down — the last debounced emission was saved.
    }
  }, [editor, formatLocked, readOnly, saveContent, saveTitle]);

  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;

  // Blur (navigating back to the tree, or to any other tab) flushes edits.
  // The microphone is closed on blur too, but that lives inside
  // `useDictationLoop`'s own focus effect rather than here — worth knowing
  // that this screen has TWO blur cleanups, because it is a hidden tab that
  // stays MOUNTED after back-navigation, so unmount cleanup never runs on
  // leaving and blur is the only thing that does.
  useFocusEffect(
    useCallback(() => {
      return () => {
        void flushPendingRef.current();
      };
    }, []),
  );

  // Dictation deep link: `/note/<id>?voice=1`, the shape the Notes tree
  // screen's mic uses ("new page, start talking"). Consumed once per mounted
  // editor — the `key={note.id}` remount on the wrapper above makes that
  // per-note automatically — so a later natural re-focus with the param still
  // sitting in the URL doesn't reopen the microphone on its own. Same
  // "consume once" guard journal.tsx uses for `/journal?voice=1`.
  const { voice: voiceParam } = useLocalSearchParams<{ voice?: string }>();
  const consumedVoiceParamRef = useRef(false);
  const beginDictation = dictation.begin;
  useFocusEffect(
    useCallback(() => {
      // `formatLocked` too: dictating appends by reading the whole document
      // back out of the webview and writing it again, so on a lossy page it
      // would be the very write this guard exists to prevent.
      if (voiceParam !== "1" || consumedVoiceParamRef.current || readOnly || formatLocked) return;
      consumedVoiceParamRef.current = true;
      beginDictation();
    }, [beginDictation, formatLocked, readOnly, voiceParam]),
  );

  // Android hardware/gesture back bypasses the in-header BackButton entirely
  // and goes straight to the navigator's default handling, which has the
  // same "hidden tab, not a stack entry" problem BackButton works around
  // above — it was landing on the Today dashboard instead of Notes. Only
  // registered while this screen is focused (useFocusEffect, not a bare
  // useEffect), so it doesn't swallow back presses on other screens.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        void flushPendingRef.current();
        router.replace("/notes");
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  // Unmount safety net (navigator teardown, logout).
  useEffect(() => {
    return () => {
      void flushPendingRef.current();
    };
  }, []);

  // Editor-init watchdog: if the webview never reports ready, show the
  // content as plain text instead of a blank page. The onLoad re-injection
  // below usually prevents this from ever firing.
  useEffect(() => {
    if (editorReady) return;
    const timer = setTimeout(() => setInitTimedOut(true), EDITOR_INIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [editorReady]);

  /** The web bundle posts this once, straight from Tiptap's onCreate, the
   *  moment the editor is actually usable — independent of the StateUpdate
   *  channel (see the `editorReady` comment above). `exclusivelyUseCustomOnMessage`
   *  is set to false on <RichText> below so this listener runs *alongside*
   *  the library's own message handling (autosave's getHTML, toolbar state,
   *  etc.) instead of replacing it. */
  const handleEditorMessage = useCallback((event: WebViewMessageEvent) => {
    const { data } = event.nativeEvent;
    if (typeof data !== "string") return;
    try {
      const message = JSON.parse(data) as { type?: string };
      if (message.type === CoreEditorActionType.EditorReady) setEditorReady(true);
    } catch {
      // Not a JSON message this screen cares about.
    }
  }, []);

  const handleWebViewLoad = useCallback(() => {
    // Guard for the known New-Architecture init race in 10tap-editor:
    // https://github.com/10play/10tap-editor/issues/343
    // On Fabric, `injectedJavaScriptBeforeContentLoaded` sometimes does not
    // run before the page loads, so `window.contentInjected` is never set
    // and the web editor's mount poller (see the library's simpleWebEditor
    // build, which polls that flag before rendering) waits forever on a
    // blank webview. If the flag is missing once the page has loaded,
    // re-run the same bootstrap the library builds in
    // RichText/utils.ts#getInjectedJSBeforeContentLoad (not exported from
    // the package root, so mirrored here) — the poller then mounts normally.
    if (!editor.webviewRef.current) return;
    const bridges = editor.bridgeExtensions ?? [];
    const configMap = bridges.reduce<Record<string, unknown>>((acc, bridge) => {
      acc[bridge.name] = { optionsConfig: bridge.config, extendConfig: bridge.extendConfig };
      return acc;
    }, {});
    const bootstrap = [
      `window.bridgeExtensionConfigMap = ${JSON.stringify(JSON.stringify(configMap))};`,
      `window.whiteListBridgeExtensions = ${JSON.stringify(bridges.map((bridge) => bridge.name))};`,
      editor.initialContent ? `window.initialContent = ${JSON.stringify(editor.initialContent)};` : "",
      `window.editable = ${editor.editable !== false};`,
      `window.disableColorHighlight = ${!!editor.disableColorHighlight};`,
      `window.dynamicHeight = ${!!editor.dynamicHeight};`,
      `window.platform = ${JSON.stringify(Platform.OS)};`,
      `window.contentInjected = true;`,
    ].join(" ");
    editor.webviewRef.current.injectJavaScript(`if (!window.contentInjected) { ${bootstrap} } true;`);
  }, [editor]);

  const showFallback = initTimedOut && !editorReady;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.headerRow}>
        <BackButton
          onPress={() => {
            void flushPendingRef.current();
            // `router.back()` was unreliable here: this route is a hidden
            // Tabs.Screen (see the comment on the wrapper above), not a
            // pushed stack entry, so "back" doesn't reliably resolve to
            // wherever the note was opened from — it was landing on the
            // Today dashboard instead of Notes. The label has always said
            // "Back to notes"; navigate there explicitly instead of relying
            // on ambiguous history. `replace`, not `push`, so repeatedly
            // opening notes and backing out doesn't pile up history entries
            // pointing at notes that may since have been deleted.
            router.replace("/notes");
          }}
        />
        {readOnly ? (
          <View style={styles.readOnlyBadge}>
            <Text style={styles.readOnlyBadgeText}>Read-only</Text>
          </View>
        ) : null}
      </View>

      <TextInput
        style={styles.titleInput}
        value={title}
        onChangeText={handleTitleChange}
        editable={!readOnly}
        // Same mutual exclusion as tapping into the document below: the user
        // has reached for the keyboard, so stop dictating into the page.
        onFocus={stopForTyping}
        placeholder="Untitled page"
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="done"
        accessibilityLabel="Page title"
      />

      {/* Placed above the save banners and the document, so it is the first
          thing read after the title — it explains why the page below refuses
          to take a keystroke. A banner rather than a dialog on purpose: this
          is a standing property of the page, not an event to acknowledge, and
          this app does not use native alerts. `!readOnly` because a shared
          read-only page already shows the "Read-only" badge, and two competing
          explanations for one un-editable document is worse than one. */}
      {formatLocked && !readOnly ? (
        <View style={styles.formatLockedBanner}>
          <Text style={styles.formatLockedText}>
            This page uses formatting the mobile editor can&apos;t edit yet — a table, divider, code
            block, alignment or indent. It&apos;s shown here as-is; open it on the web to make changes.
            You can still rename it.
          </Text>
        </View>
      ) : null}

      {saveState === "failed" ? (
        <View style={styles.saveFailedBanner}>
          <Text style={styles.saveFailedText}>Couldn't save — changes will retry on your next edit.</Text>
        </View>
      ) : null}

      {saveState === "queued" ? (
        <View style={styles.saveQueuedBanner}>
          <Text style={styles.saveQueuedText}>Saved offline — will sync when you're back online.</Text>
        </View>
      ) : null}

      {/* Between the title and the document deliberately: `setContent` never
          focuses the editor, so dictation never raises the keyboard, and this
          slot sidesteps the whole iOS-floating-toolbar vs Android-flex-sibling
          split the bottom of this screen has to deal with. Hidden on a
          read-only (shared) page and while the editor-failed fallback is
          showing, since there is nothing writable to dictate into — and on a
          format-locked page for the same reason, since an appended sentence
          could not be saved. */}
      {!readOnly && !formatLocked && !showFallback ? (
        <DictationPanel
          mode={dictation.mode}
          voiceState={dictation.voiceState}
          notice={dictation.notice}
          listeningPlaceholder="Listening — say what goes on this page…"
          idleLabel="Dictate — add to this page by voice"
          micAccessibilityLabel="Dictate into this page"
          micAccessibilityHint="Starts voice dictation; what you say is added as new paragraphs"
          onBegin={dictation.begin}
          onStop={dictation.stop}
          onResume={dictation.resume}
          onDismiss={dictation.dismiss}
          onOpenSettings={dictation.openSettings}
        />
      ) : null}

      {showFallback ? (
        <ScrollView style={styles.fallbackScroll} contentContainerStyle={styles.fallbackContent}>
          <View style={styles.fallbackNotice}>
            <Text style={styles.fallbackNoticeText}>
              The editor failed to initialize, so this page is shown read-only. Reopen the page to try
              again.
            </Text>
          </View>
          <Text style={styles.fallbackBody}>{stripHtml(initialContent) || "This page is empty."}</Text>
        </ScrollView>
      ) : (
        <>
          {/* Capture-phase responder, returning false: this observes the touch
              that lands on the document and stops dictation, without claiming
              the touch, so the WebView still receives it normally. See
              `handleEditorTouchCapture` for why the editor's own focus state
              can't be used for this. */}
          <View style={styles.editorWrap} onStartShouldSetResponderCapture={handleEditorTouchCapture}>
            <RichText
              editor={editor}
              onLoad={handleWebViewLoad}
              onMessage={handleEditorMessage}
              exclusivelyUseCustomOnMessage={false}
            />
          </View>
          {/* Hidden on a format-locked page as well as a read-only one.
              `editable: false` stops the *user* typing, but TipTap commands
              dispatched programmatically — which is exactly what these toolbar
              buttons do over the bridge — still mutate the document. Those
              edits could never be saved (see `saveContent`), so leaving the
              bar there would only offer buttons that appear to work and then
              silently discard what they did. */}
          {!readOnly && !formatLocked ? (
            Platform.OS === "ios" ? (
              <KeyboardAvoidingView
                behavior="padding"
                style={[styles.toolbarContainer, { paddingBottom: insets.bottom }]}
              >
                <Toolbar editor={editor} />
              </KeyboardAvoidingView>
            ) : (
              // Android: `KeyboardAvoidingView`'s `behavior` has no Android
              // equivalent of "padding" (see the file-level comment above),
              // so instead of floating this bar over the WebView at a fixed
              // `bottom: 0` (which requires the OS to have already resized
              // this screen's view tree for it to land above the keyboard),
              // it's laid out as a normal flex sibling below the WebView.
              // `marginBottom` grows with the tracked keyboard height, which
              // shrinks the WebView's own flex-allotted space by the same
              // amount — the WebView gets genuinely smaller, so its internal
              // viewport/cursor tracking has correct bounds to work with,
              // and this bar always ends up sitting right above the
              // keyboard regardless of whether adjustResize did its job for
              // this subtree. `insets.bottom` covers the home-indicator/nav
              // gesture area when the keyboard is closed.
              <View
                style={[
                  styles.toolbarContainerAndroid,
                  { marginBottom: androidKeyboardHeight || insets.bottom },
                ]}
              >
                <Toolbar editor={editor} />
              </View>
            )
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // A shade off the header/title card so the page reads as one surface
    // resting on the app's base background, rather than a single flat slab
    // of white — the same card-on-background layering the rest of the app
    // uses (see foundation.ts's `background` vs `card`).
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.card,
  },
  backButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.control,
  },
  backButtonPressed: {
    backgroundColor: colors.secondary,
  },
  backButtonText: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.foreground,
  },
  readOnlyBadge: {
    marginRight: spacing.sm,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.muted,
  },
  readOnlyBadgeText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.mutedForeground,
  },
  titleInput: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    letterSpacing: -0.4,
    color: colors.foreground,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  saveFailedBanner: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.destructiveMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.destructive,
  },
  saveFailedText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    lineHeight: 16,
    color: colors.destructive,
  },
  saveQueuedBanner: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.warningMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  saveQueuedText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    lineHeight: 16,
    color: colors.warningForeground,
  },
  // Same warning treatment as the offline-queue banner above — this is an
  // informational limitation, not a failure — but with `lineHeight` set for
  // a genuine multi-line paragraph rather than the one-liners those are.
  formatLockedBanner: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.warningMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  formatLockedText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    lineHeight: 18,
    color: colors.warningForeground,
  },
  // Exists only to carry the capture-phase touch handler that stops dictation
  // when the user taps into the document. `flex: 1` so <RichText> (itself
  // flex: 1) still fills the same space it did before it was wrapped.
  editorWrap: {
    flex: 1,
  },
  // iOS: floats over the WebView, positioned by `avoidIosKeyboard` +
  // KeyboardAvoidingView's "padding" behavior.
  toolbarContainer: {
    position: "absolute",
    width: "100%",
    bottom: 0,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadows.raised,
  },
  // Android: a normal flex sibling after the WebView instead — see the
  // render-time comment on where this is used for why. Same visual
  // treatment as the iOS bar (border + shadow) so the two platforms read
  // as the same component.
  toolbarContainerAndroid: {
    width: "100%",
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadows.raised,
  },
  fallbackScroll: {
    flex: 1,
    backgroundColor: colors.card,
  },
  fallbackContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  fallbackNotice: {
    padding: spacing.md,
    borderRadius: radii.chip,
    backgroundColor: colors.warningMuted,
  },
  fallbackNoticeText: {
    fontSize: typography.size.xs,
    lineHeight: 18,
    color: colors.warningForeground,
  },
  fallbackBody: {
    fontSize: typography.size.md,
    lineHeight: 26,
    color: colors.foreground,
  },
});
