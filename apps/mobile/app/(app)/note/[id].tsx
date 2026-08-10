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
// "couldn't save" banner and retries on the next edit/flush, because
// Alert-per-keystroke-batch while offline would be hostile. Caches are
// patched on success only — the editor itself is the source of truth while
// this screen is open.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  RichText,
  Toolbar,
  useBridgeState,
  useEditorBridge,
  useEditorContent,
} from "@10play/tentap-editor";

import type { Note, NoteDetailResponse } from "@goalslot/shared";

import { ErrorState, LoadingState } from "@/components";
import { colors } from "@/theme";
import { apiClient } from "@/lib/api-client";
import { noteQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";

const TITLE_DEBOUNCE_MS = 500;
const CONTENT_DEBOUNCE_MS = 1000;
/** How long to wait for the webview editor to report ready before falling
 *  back to the plain-text view. */
const EDITOR_INIT_TIMEOUT_MS = 8000;

/** The API defaults new rows to '[]' (legacy JSON-blocks format) — treat
 *  that, and whitespace-only strings, as an empty document rather than
 *  letting TipTap render the literal characters. */
function normalizeContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed === "" || trimmed === "[]") return "";
  return content;
}

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

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.headerRow}>
          <BackButton />
        </View>
        <ErrorState message="Couldn't load this page." onRetry={() => void detailQuery.refetch()} />
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
      onPress={onPress ?? (() => router.back())}
      hitSlop={12}
      style={styles.backButton}
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
  const [saveFailed, setSaveFailed] = useState(false);
  const [initTimedOut, setInitTimedOut] = useState(false);

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
  });
  const editorState = useBridgeState(editor);
  // Debounced (1000ms) HTML snapshot of the document — each emission that
  // differs from the last saved value triggers the update mutation below.
  const editedContent = useEditorContent(editor, {
    type: "html",
    debounceInterval: CONTENT_DEBOUNCE_MS,
  });

  /** Patch both caches with the saved fields — success path only (see
   *  header comment). */
  const patchCaches = useCallback(
    (patch: Partial<Note>) => {
      queryClient.setQueryData<NoteDetailResponse>(noteQueries.noteQueries.detail(note.id), (existing) =>
        existing ? { ...existing, note: { ...existing.note, ...patch } } : existing,
      );
      queryClient.setQueryData<Note[]>(noteQueries.noteQueries.list(), (existing) =>
        (existing ?? []).map((n) => (n.id === note.id ? { ...n, ...patch } : n)),
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
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);
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
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);
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
            router.back();
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

      {saveFailed ? (
        <View style={styles.saveFailedBanner}>
          <Text style={styles.saveFailedText}>Couldn't save — changes will retry on your next edit.</Text>
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
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.toolbarContainer}
            >
              <Toolbar editor={editor} />
            </KeyboardAvoidingView>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.card,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
  },
  readOnlyBadge: {
    marginRight: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.muted,
  },
  readOnlyBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  titleInput: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.foreground,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  saveFailedBanner: {
    marginHorizontal: 20,
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.destructiveMuted,
  },
  saveFailedText: {
    fontSize: 12,
    color: colors.destructive,
  },
  toolbarContainer: {
    position: "absolute",
    width: "100%",
    bottom: 0,
  },
  fallbackScroll: {
    flex: 1,
  },
  fallbackContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 16,
  },
  fallbackNotice: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: colors.warningMuted,
  },
  fallbackNoticeText: {
    fontSize: 13,
    color: colors.warningForeground,
  },
  fallbackBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.foreground,
  },
});
