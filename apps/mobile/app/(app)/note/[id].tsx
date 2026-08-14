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
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  CoreBridge,
  RichText,
  TenTapStartKit,
  Toolbar,
  useBridgeState,
  useEditorBridge,
  useEditorContent,
} from "@10play/tentap-editor";

import { hasResponse, type Note, type NoteDetailResponse } from "@goalslot/shared";

import { ErrorState, LoadingState } from "@/components";
import { colors, radii, shadows, spacing, typography } from "@/theme";
import { apiClient } from "@/lib/api-client";
import { normalizeContent } from "@/lib/note-content";
import { queueOfflineEdit } from "@/lib/offline";
import { noteQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";

const TITLE_DEBOUNCE_MS = 500;
const CONTENT_DEBOUNCE_MS = 1000;
/** How long to wait for the webview editor to report ready before falling
 *  back to the plain-text view. */
const EDITOR_INIT_TIMEOUT_MS = 8000;

/** Crude HTML-to-text for the editor-failed fallback view only. */
function stripHtml(html: string): string {
  return html
    .replace(/<(p|div|br|li|h[1-6]|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
    // Same `hasResponse` split notes.tsx's list query uses: a genuine server
    // rejection (the request landed, the server said no) reads differently
    // from a request that never reached the server at all (offline/timeout)
    // — the latter told the user to "try again" when a retry couldn't
    // possibly help without connectivity back first.
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerRow}>
          <BackButton />
        </View>
        <ErrorState
          message={
            hasResponse(detailQuery.error)
              ? "Couldn't load this page."
              : "You're offline — reconnect to load this page."
          }
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

  const [title, setTitle] = useState(note.title);
  // "failed": a genuine rejection, retries on the next edit/flush.
  // "queued": no server response at all — routed to the offline outbox
  // instead, so what's typed IS durable, just not confirmed yet.
  const [saveState, setSaveState] = useState<"idle" | "failed" | "queued">("idle");
  const [initTimedOut, setInitTimedOut] = useState(false);
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
    editable: !readOnly,
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
  const editorState = useBridgeState(editor);

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
      if (readOnly || html === lastSavedContentRef.current) return;
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
    [note.id, patchCaches, readOnly],
  );

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
    if (readOnly) return;
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = null;
      void saveTitle(titleRef.current);
    }
    try {
      const html = await editor.getHTML();
      if (typeof html === "string") await saveContent(html);
    } catch {
      // Webview already torn down — the last debounced emission was saved.
    }
  }, [editor, readOnly, saveContent, saveTitle]);

  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;

  // Blur (navigating back to the tree, or to any other tab) flushes edits.
  useFocusEffect(
    useCallback(() => {
      return () => {
        void flushPendingRef.current();
      };
    }, []),
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
    if (editorState.isReady) return;
    const timer = setTimeout(() => setInitTimedOut(true), EDITOR_INIT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [editorState.isReady]);

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

  const showFallback = initTimedOut && !editorState.isReady;

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
        placeholder="Untitled page"
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="done"
        accessibilityLabel="Page title"
      />

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
          <RichText editor={editor} onLoad={handleWebViewLoad} />
          {!readOnly ? (
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
