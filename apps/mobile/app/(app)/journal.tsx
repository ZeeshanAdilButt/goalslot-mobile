// Journal: one-entry-per-day writing habit, simplified per DECISIONS.md #5/#6
// (Journal was cut from the v1 screen list, then reinstated in a lightweight
// form — no TipTap toolbar, no decorative chrome, no calendar widget). Date
// navigation is just back/forward arrows off "today"; the editor is a plain
// multiline TextInput; saving is an explicit button (not save-on-blur — a
// manual Save is the simpler, more predictable of the two options the task
// allowed, and it matches every other screen in this app using an explicit
// action rather than an implicit one). A scrollable "recent entries" list
// below the editor lets the user jump back into any of the last two weeks
// without a calendar.
//
// Optimistic-update-then-rollback follows goals.tsx's exact shape: snapshot
// the query about to be touched, patch it locally, call the live endpoint,
// then either invalidate (success) or restore the snapshot (failure). On a
// failure that looks like "no server response" (offline/timeout), the patch
// stays applied (tagged `pendingSync: true`) and queues to the offline
// outbox instead — see the "journal-create"/"journal-update" operations
// registered in src/lib/offline.ts. Only a genuine rejection (the server
// answered and said no) restores the pre-save snapshot.
//
// Journal is "one entry per day, upsert-shaped": the first save for a date
// is a create (no id yet), every save after is an update against the id the
// first save returned. `entryQuery`'s cached entry doubles as that
// bookkeeping — its `pendingSync` flag is how a second offline save on the
// same still-unsynced day knows to queue another "journal-create" rather
// than a "journal-update" against an id the server has never actually seen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { FlashList } from "@shopify/flash-list";

import { genId, getLocalDateString, todayKey, type JournalEntry } from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton, SkeletonListItem } from "@/components";
import { MicOrb } from "@/components/voice/MicOrb";
import { Icon } from "@/components/ui/Icon";
import { useVoiceCapture, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import { apiClient, notify } from "@/lib/api-client";
import { queueOfflineEdit } from "@/lib/offline";
import { journalQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useJournalReminderSync } from "@/lib/useJournalReminders";
import { useAnalytics } from "@/providers/growth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme";

// How long the "Saved" confirmation stays up. Saving used to give no visible
// feedback at all: this screen is a per-day editor, so the text intentionally
// stays in the box after a save, which read as "the button did nothing" —
// "I tried to add my journal entry. It was not clearing the text box."
const SAVED_CONFIRMATION_MS = 2000;

const RECENT_WINDOW_DAYS = 14;
const RECENT_SKELETON_ROWS = 4;

// --- "Talk about my day" voice capture -------------------------------------
//
// useVoiceCapture (src/hooks/useVoiceCapture.ts) is built for a single
// utterance: mic opens, one phrase, `settle()` fires `onCommand` once, mic
// returns to idle. Dictating a whole journal entry needs continuous
// multi-sentence capture, so — exactly like voice.tsx and TrackerVoiceButton
// layer their own semantics on top of the same shared hook — this screen
// composes an auto-restart loop entirely at the call site. The hook itself
// is untouched: every time a session settles (a phrase committed, or a
// recoverable silent gap), `captureActiveRef` below decides whether to call
// `start()` again, which is what makes the mic feel continuously open
// despite the hook's one-shot, 15s-capped design.
//
// How many consecutive *silent* segments (an empty transcript — the
// recognizer heard nothing) are tolerated before giving up and surfacing a
// message, rather than looping the mic forever if, say, another app grabbed
// it. A silent segment and a genuine VoiceError both land in the hook as
// `{ status: 'error', transcript: '' }` (see handleError/settle in the
// hook), so the same counter and cap cover both.
//
// Two ways in, one path: the `?voice=1` deep link (Siri / the App Shortcut)
// and the in-editor mic button both call the same `beginDictation` defined
// inside the component below, so a session started either way behaves
// identically from that point on.
const MAX_SILENT_RETRIES = 2;

/** How long the "stopped listening" notice stays up before auto-clearing. */
const SOFT_STOP_NOTICE_MS = 4000;

/**
 * Appends a just-dictated phrase into the existing draft, with a single
 * separating space — never a parallel "voice text" concept, just more text
 * in the same box the manual editor already writes to.
 */
function appendDictatedPhrase(existing: string, phrase: string): string {
  const trimmedPhrase = phrase.trim();
  if (trimmedPhrase.length === 0) return existing;
  if (existing.length === 0) return trimmedPhrase;
  return /\s$/.test(existing) ? `${existing}${trimmedPhrase}` : `${existing} ${trimmedPhrase}`;
}

/** Journal's own state, layered above the hook's `VoiceCaptureStatus` — see the header comment above. */
type JournalVoiceMode = "inactive" | "priming" | "listening" | "blocked" | "soft-stopped";

function addDays(dateKey: string, delta: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return getLocalDateString(date);
}

function formatDisplayDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function JournalScreen() {
  const analytics = useAnalytics();
  const { voice } = useCapabilities();

  // Reconciles the "you haven't journaled today" nudge every time this
  // screen is focused — the other mount point is the Journal reminder
  // section on app/(app)/notification-settings.tsx. See
  // useJournalReminderSync's header comment for why there are two mount
  // points rather than one app-wide sync component.
  useJournalReminderSync();

  const today = useMemo(() => todayKey(), []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing the timeout on unmount stops the "Saved" flag being set on an
  // unmounted screen if the user navigates away right after saving.
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      analytics.track({ name: "screenViewed", payload: { screenName: "journal" } });
    }, [analytics]),
  );

  // --- "Talk about my day" voice capture ------------------------------
  // Deep link contract: `/journal?voice=1` (goalslot://journal?voice=1),
  // matching timer.tsx's own `?autostart=1&goalId=...` idiom. The builder
  // side (`journalVoiceCaptureDeepLink`) lives in src/lib/deep-links.ts,
  // owned by the platform build agents wiring App Intents / App Actions to
  // it — this screen only needs to agree on the param name, `voice`.
  const { voice: voiceParam } = useLocalSearchParams<{ voice?: string }>();
  const [voiceMode, setVoiceMode] = useState<JournalVoiceMode>("inactive");
  /** Guards against replaying the same `voice=1` param on a later natural re-focus — same pattern as voice.tsx's `forwardedRef`. */
  const consumedVoiceParamRef = useRef(false);
  /** True while the auto-restart chain should keep reopening the mic after each session settles. Flipped false before any stop/cancel so the chain doesn't race back open. */
  const captureActiveRef = useRef(false);
  /** Consecutive silent (empty-transcript) segments this dictation run — capped by MAX_SILENT_RETRIES. */
  const silentRetryCountRef = useRef(0);
  const softStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (softStopTimer.current) clearTimeout(softStopTimer.current);
    },
    [],
  );

  const handleVoiceCommand = useCallback(async (transcript: string): Promise<VoiceCommandOutcome> => {
    // A committed phrase means the mic is hearing fine — reset the silent
    // streak so an occasional pause later doesn't inherit progress toward
    // the cap from earlier in the same dictation run.
    silentRetryCountRef.current = 0;
    // Same setters the manual editor uses below — dictated text is just
    // text in the same box, saved the same way, never a parallel concept.
    setDraft((prev) => appendDictatedPhrase(prev, transcript));
    setIsDirty(true);
    // 'handoff', not 'done': the words already landed in the draft above,
    // so there is nothing left for the hook's own success tick to confirm —
    // and flashing one after every sentence would be exhausting over a
    // multi-minute dictation.
    return { kind: "handoff" };
  }, []);

  const {
    state: voiceState,
    start: startVoice,
    stop: stopVoice,
    cancel: cancelVoice,
    reset: resetVoice,
    openSettings: openVoiceSettings,
  } = useVoiceCapture({ voice, onCommand: handleVoiceCommand, label: "Journal dictation" });

  // Shared entry point into dictation — the deep-link effect below fires
  // this automatically, and the in-editor mic button (rendered further down,
  // for a user who never went through Siri/the App Shortcut) fires the exact
  // same thing on tap. One path in, so the two triggers can never disagree
  // about what "start voice journaling" means.
  const beginDictation = useCallback(() => {
    // The feature is defined as "today's entry" — force today regardless of
    // whatever day was showing, mirroring `goToToday`.
    setSelectedDate(today);
    setVoiceMode("priming");
  }, [today]);

  // Trigger + cleanup, mirroring voice.tsx's single useFocusEffect shape:
  // consume the deep-link param on focus, always close the mic on blur.
  useFocusEffect(
    useCallback(() => {
      if (voiceParam === "1" && !consumedVoiceParamRef.current) {
        consumedVoiceParamRef.current = true;
        beginDictation();
      }
      return () => {
        // Leaving the screen must close the microphone. Always — matching
        // the hook's own header comment. Cancel, not stop: nobody is left to
        // confirm an odd trailing fragment landing unattended in the entry.
        captureActiveRef.current = false;
        silentRetryCountRef.current = 0;
        if (softStopTimer.current) {
          clearTimeout(softStopTimer.current);
          softStopTimer.current = null;
        }
        void cancelVoice();
        setVoiceMode("inactive");
      };
    }, [beginDictation, cancelVoice, voiceParam]),
  );

  // priming -> listening: only once today's entry has actually resolved —
  // journal.tsx's own effects (below) reset `draft` on `selectedDate` change
  // and again when `entryQuery.data` resolves. Starting capture before that
  // second effect ran would let dictated text be silently wiped the instant
  // the fetch completes. Also doubles as the "fast path": if the entry was
  // already loaded/cached the moment the param was read, this condition is
  // already true on the very next render, so priming is never visibly shown.
  const entryQuery = useQuery(journalQueries.byDate(selectedDate));
  useEffect(() => {
    if (voiceMode !== "priming") return;
    if (selectedDate !== today) return;
    if (entryQuery.data === undefined) return;
    captureActiveRef.current = true;
    setVoiceMode("listening");
  }, [entryQuery.data, selectedDate, today, voiceMode]);

  // Defensive: if today's entry fails to load while priming, there is
  // nothing to safely start capture against (and no TextInput to tap into,
  // since the error branch below replaces the editor with ErrorState) — fall
  // back to plain "inactive" rather than leaving "Getting ready to listen…"
  // on screen forever.
  useEffect(() => {
    if (voiceMode !== "priming" || !entryQuery.isError) return;
    setVoiceMode("inactive");
  }, [entryQuery.isError, voiceMode]);

  // The auto-restart chain: whenever the hook drops back to idle while a
  // capture run is still meant to be active, immediately reopen the mic.
  // This single effect covers both the very first open (priming -> listening
  // sets `voiceMode` to "listening" while the hook is still virgin-idle) and
  // every subsequent restart after a phrase commits (`handoff` -> idle) or a
  // silent segment is retried (see the effect below, which routes back
  // through here via `resetVoice()` rather than calling `start()` itself —
  // one restart mechanism, not two racing ones).
  useEffect(() => {
    if (voiceMode !== "listening") return;
    if (!captureActiveRef.current) return;
    if (voiceState.status !== "idle") return;
    void startVoice();
  }, [startVoice, voiceMode, voiceState.status]);

  // A session ending with an empty transcript reaches the hook as
  // `{ status: 'error', transcript: '' }` whether it was silence (settle()'s
  // own short-circuit) or a genuine VoiceError with nothing heard yet
  // (handleError always clears transcript) — both are handled the same way
  // here: don't show the hook's generic "Didn't catch that" copy (it reads
  // as a failure mid-dictation when it's often just a pause), retry silently
  // up to the cap, then give up calmly rather than loop the mic forever.
  useEffect(() => {
    if (voiceMode !== "listening") return;
    if (voiceState.status !== "error" || voiceState.transcript !== "") return;
    if (silentRetryCountRef.current < MAX_SILENT_RETRIES) {
      silentRetryCountRef.current += 1;
      resetVoice();
      return;
    }
    captureActiveRef.current = false;
    resetVoice();
    setVoiceMode("soft-stopped");
    if (softStopTimer.current) clearTimeout(softStopTimer.current);
    softStopTimer.current = setTimeout(() => {
      setVoiceMode((current) => (current === "soft-stopped" ? "inactive" : current));
    }, SOFT_STOP_NOTICE_MS);
  }, [resetVoice, voiceMode, voiceState.status, voiceState.transcript]);

  // permission-denied / unavailable mid-flow -> blocked. Terminal for this
  // session: no auto-retry, matching the hook's own "no retry loop" comment.
  useEffect(() => {
    if (voiceMode !== "priming" && voiceMode !== "listening") return;
    if (voiceState.status !== "permission-denied" && voiceState.status !== "unavailable") return;
    captureActiveRef.current = false;
    setVoiceMode("blocked");
  }, [voiceMode, voiceState.status]);

  /** Explicit "Stop listening" pill — always visible while capturing. Commits whatever is in flight (stop, not cancel) rather than discarding it. */
  const stopDictation = useCallback(() => {
    // Flipped false BEFORE stop()'s settle resolves, so the auto-chain
    // effect above does not see idle-while-active and reopen the mic.
    captureActiveRef.current = false;
    setVoiceMode("inactive");
    void stopVoice();
  }, [stopVoice]);

  /** Tapping the mic again from the "stopped listening" notice — a fresh attempt, not a retry of the same failed one. */
  const resumeDictation = useCallback(() => {
    if (softStopTimer.current) {
      clearTimeout(softStopTimer.current);
      softStopTimer.current = null;
    }
    silentRetryCountRef.current = 0;
    resetVoice();
    captureActiveRef.current = true;
    setVoiceMode("listening");
  }, [resetVoice]);

  const dismissVoiceNotice = useCallback(() => {
    if (softStopTimer.current) {
      clearTimeout(softStopTimer.current);
      softStopTimer.current = null;
    }
    resetVoice();
    setVoiceMode("inactive");
  }, [resetVoice]);

  /**
   * Tapping directly into the editor is the second way to stop dictation —
   * it means the user wants to type. This also sidesteps concurrent
   * programmatic appends and manual typing racing over cursor position in a
   * controlled TextInput, by making capture and manual editing mutually
   * exclusive: never both live at once.
   */
  const handleEditorFocus = useCallback(() => {
    if (voiceMode === "listening" || voiceMode === "priming") {
      captureActiveRef.current = false;
      setVoiceMode("inactive");
      void stopVoice();
      return;
    }
    if (voiceMode === "blocked" || voiceMode === "soft-stopped") {
      dismissVoiceNotice();
    }
  }, [dismissVoiceNotice, stopVoice, voiceMode]);

  const isDictating = voiceMode === "priming" || voiceMode === "listening";

  const entryKey = useMemo(() => journalQueries.journalQueries.byDate(selectedDate), [selectedDate]);

  // Clear the draft immediately on date change so the previous day's text
  // doesn't flash while the new day's entry loads, then populate it once
  // that day's query has actually resolved (data stays `undefined` until
  // then; a day with no entry resolves to `null`, not undefined).
  useEffect(() => {
    setDraft("");
    setIsDirty(false);
  }, [selectedDate]);

  useEffect(() => {
    if (entryQuery.data !== undefined) {
      setDraft(entryQuery.data?.content ?? "");
      setIsDirty(false);
    }
  }, [entryQuery.data]);

  const recentRange = useMemo(
    () => ({ from: addDays(today, -(RECENT_WINDOW_DAYS - 1)), to: today }),
    [today],
  );
  const recentQuery = useQuery(journalQueries.list(recentRange));
  const recentEntries = useMemo(
    () => [...(recentQuery.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [recentQuery.data],
  );

  const handleSave = useCallback(async () => {
    const trimmedContent = draft;
    const previous = queryClient.getQueryData<JournalEntry | null>(entryKey);
    // A `pendingSync` previous entry means an earlier save this same day
    // already queued a create that hasn't synced yet — its id is only
    // local, so this save is still a create, not an update against it.
    const isCreate = !previous?.id || previous.pendingSync === true;
    const optimisticId = isCreate ? (previous?.pendingSync ? previous.id : genId()) : previous!.id;

    const optimisticEntry: JournalEntry = {
      id: optimisticId,
      date: selectedDate,
      content: trimmedContent,
    };
    queryClient.setQueryData(entryKey, optimisticEntry);
    setIsSaving(true);

    try {
      const response = isCreate
        ? await apiClient.journal.create({ date: selectedDate, content: trimmedContent })
        : await apiClient.journal.update(previous!.id, { content: trimmedContent });

      queryClient.setQueryData(entryKey, response.data);
      void queryClient.invalidateQueries({ queryKey: journalQueries.journalQueries.all });
      setIsDirty(false);
      // Confirm the save happened. Without this the screen looked inert after
      // pressing Save — the text deliberately stays put (this is a per-day
      // editor, not a "new entry" box), so a haptic tick plus a visible
      // "Saved" state is the only signal that anything occurred.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_CONFIRMATION_MS);
      analytics.track({ name: "journalEntrySaved", payload: { date: selectedDate } });
    } catch (err) {
      const kind = isCreate ? "journal-create" : "journal-update";
      const payload = isCreate
        ? { date: selectedDate, content: trimmedContent }
        : { id: previous!.id, data: { content: trimmedContent } };
      const queued = await queueOfflineEdit(kind, payload, err);
      if (queued) {
        queryClient.setQueryData<JournalEntry>(entryKey, { ...optimisticEntry, pendingSync: true });
        setIsDirty(false);
        setJustSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_CONFIRMATION_MS);
        notify("Queued — will sync when online", "success");
      } else {
        queryClient.setQueryData(entryKey, previous);
        Alert.alert("Couldn't save entry", "Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  }, [analytics, draft, entryKey, selectedDate]);

  const goToPreviousDay = useCallback(() => setSelectedDate((date) => addDays(date, -1)), []);
  const goToNextDay = useCallback(() => setSelectedDate((date) => addDays(date, 1)), []);
  const goToToday = useCallback(() => setSelectedDate(today), [today]);
  const canGoForward = selectedDate < today;
  const isToday = selectedDate === today;

  const renderRecentItem = useCallback(
    ({ item }: { item: JournalEntry }) => (
      <Pressable
        style={[styles.recentRow, item.date === selectedDate && styles.recentRowActive]}
        onPress={() => setSelectedDate(item.date)}
        accessibilityRole="button"
        accessibilityLabel={`View entry from ${formatDisplayDate(item.date)}`}
      >
        <Text style={styles.recentRowDate}>{formatDisplayDate(item.date)}</Text>
        <Text style={styles.recentRowPreview} numberOfLines={1}>
          {item.content.trim() || "No content"}
        </Text>
      </Pressable>
    ),
    [selectedDate],
  );

  // Whether the currently-shown entry reflects a save that's still only
  // queued to the offline outbox — drives the Save button's "Queued" vs
  // "Saved" treatment below.
  const isPendingSync = entryQuery.data?.pendingSync === true;

  let editorContent: React.ReactNode;
  if (entryQuery.isPending) {
    editorContent = (
      <View style={styles.editorSkeleton} accessibilityLabel="Loading journal entry">
        <Skeleton height={18} width="55%" />
        <Skeleton height={140} style={styles.editorSkeletonBody} />
      </View>
    );
  } else if (entryQuery.isError && entryQuery.data === undefined) {
    // `data === undefined` (never resolved even once), not `!data` — a day
    // with no entry legitimately resolves to `null`, which must still
    // render the empty editor below, not this error state. Gating on
    // `isError` alone used to replace an already-rendered, perfectly good
    // cached entry with a hard error on every failed background refetch
    // (offline pull-to-refresh, focus-refetch), even though the cached
    // content needed to render it was sitting right there.
    editorContent = (
      <ErrorState message="Couldn't load this entry." onRetry={() => void entryQuery.refetch()} />
    );
  } else {
    editorContent = (
      <TextInput
        style={styles.textInput}
        multiline
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setIsDirty(true);
        }}
        onFocus={handleEditorFocus}
        placeholder="Write about your day..."
        placeholderTextColor={colors.mutedForeground}
        textAlignVertical="top"
        accessibilityLabel={`Journal entry for ${formatDisplayDate(selectedDate)}`}
        accessibilityHint="Multiline text field. Use the Save button below to save your changes."
      />
    );
  }

  let recentContent: React.ReactNode;
  if (recentQuery.isPending) {
    recentContent = (
      <View>
        {Array.from({ length: RECENT_SKELETON_ROWS }).map((_, index) => (
          <SkeletonListItem key={index} showLeading={false} />
        ))}
      </View>
    );
  } else if (recentQuery.isError && !recentQuery.data) {
    recentContent = (
      <ErrorState message="Couldn't load recent entries." onRetry={() => void recentQuery.refetch()} />
    );
  } else if (recentEntries.length === 0) {
    recentContent = <EmptyState message="No journal entries yet — write today's to get started" />;
  } else {
    recentContent = (
      <FlashList
        data={recentEntries}
        keyExtractor={(item) => item.id}
        renderItem={renderRecentItem}
        contentContainerStyle={styles.recentListContent}
      />
    );
  }

  return (
    // edges={["top"]} matches index.tsx/reports.tsx. Without it this screen's
    // date navigation rendered underneath the system status bar on devices
    // with a tall status bar (reported on a Samsung S22).
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.dateNav}>
        <Pressable
          style={styles.navArrow}
          onPress={goToPreviousDay}
          // Disabled defensively while dictating: the feature always targets
          // today and there's no in-UI trigger for voice capture on a
          // non-today day, but disabling avoids the draft-reset-on-date-
          // change effect ever colliding with an in-flight dictation.
          disabled={isDictating}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          accessibilityState={{ disabled: isDictating }}
        >
          {/* The icon set only ships a right-facing chevron; rotating it keeps
              this file from having to touch Icon.tsx (owned elsewhere). */}
          <View style={styles.flipHorizontal}>
            <Icon name="chevron" size={22} color={isDictating ? colors.border : colors.foreground} />
          </View>
        </Pressable>

        <Pressable
          style={styles.dateLabelWrap}
          onPress={goToToday}
          disabled={isToday || isDictating}
          accessibilityRole="header"
          accessibilityLabel={`Journal date: ${formatDisplayDate(selectedDate)}${isToday ? ", today" : ""}`}
        >
          <Text style={styles.dateLabel} numberOfLines={1}>
            {isToday ? "Today" : formatDisplayDate(selectedDate)}
          </Text>
          {!isToday ? <Text style={styles.dateSublabel}>{formatDisplayDate(selectedDate)}</Text> : null}
        </Pressable>

        <Pressable
          style={styles.navArrow}
          onPress={goToNextDay}
          disabled={!canGoForward || isDictating}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: !canGoForward || isDictating }}
        >
          <Icon
            name="chevron"
            size={22}
            color={canGoForward && !isDictating ? colors.foreground : colors.border}
          />
        </Pressable>
      </View>

      {voiceMode === "priming" ? (
        <View style={styles.voicePriming} accessibilityLiveRegion="polite">
          <Text style={styles.voicePrimingText}>Getting ready to listen…</Text>
        </View>
      ) : null}

      {voiceMode === "listening" ? (
        <View style={styles.voicePanel} accessibilityLiveRegion="polite">
          <MicOrb
            status={voiceState.status}
            onPress={stopDictation}
            size={48}
            accessibilityLabel="Stop listening"
            accessibilityHint="Currently capturing your journal entry by voice"
          />
          <Text style={styles.voiceCaption} numberOfLines={3}>
            {voiceState.transcript.length > 0 ? voiceState.transcript : "Listening — talk about your day…"}
          </Text>
          {/* Persistent and always visible while capturing — the primary,
              obvious way to stop, not something to discover. Tapping into
              the editor below (its onFocus) does the same thing. */}
          <Pressable
            onPress={stopDictation}
            accessibilityRole="button"
            accessibilityLabel="Stop listening"
            style={({ pressed }) => [styles.stopPill, pressed && styles.stopPillPressed]}
          >
            <Text style={styles.stopPillText}>Stop listening</Text>
          </Pressable>
        </View>
      ) : null}

      {voiceMode === "blocked" ? (
        <View style={styles.voiceNotice} accessibilityLiveRegion="polite">
          <Text style={styles.voiceNoticeText}>
            {voiceState.message.length > 0 ? voiceState.message : "Couldn't start voice capture."}
          </Text>
          <View style={styles.voiceNoticeActions}>
            {voiceState.status === "permission-denied" ? (
              <Pressable
                onPress={openVoiceSettings}
                accessibilityRole="button"
                accessibilityLabel="Open Settings to allow microphone access"
                style={({ pressed }) => [styles.voiceNoticeAction, pressed && styles.voiceNoticeActionPressed]}
              >
                <Text style={styles.voiceNoticeActionText}>Open Settings</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={dismissVoiceNotice}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => [styles.voiceNoticeAction, pressed && styles.voiceNoticeActionPressed]}
            >
              <Text style={styles.voiceNoticeActionText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {voiceMode === "soft-stopped" ? (
        <View style={styles.voiceNotice} accessibilityLiveRegion="polite">
          <Text style={styles.voiceNoticeText}>
            Stopped listening — tap the mic to keep going, or just type.
          </Text>
          <View style={styles.voiceNoticeActions}>
            <MicOrb
              status="idle"
              onPress={resumeDictation}
              size={40}
              accessibilityLabel="Resume voice dictation"
            />
            <Pressable
              onPress={dismissVoiceNotice}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => [styles.voiceNoticeAction, pressed && styles.voiceNoticeActionPressed]}
            >
              <Text style={styles.voiceNoticeActionText}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* The manual entry point into dictation — everything above this only
          ever appears once capture is already under way (or blocked/paused);
          without this row the mic is reachable exclusively through the
          `?voice=1` deep link (Siri / the App Shortcut), and there is no way
          to start talking from inside the app itself. Tapping calls the
          exact same `beginDictation` the deep link calls, so both paths land
          in identical state. */}
      {voiceMode === "inactive" ? (
        <View style={styles.voiceIdleRow}>
          <MicOrb
            status="idle"
            onPress={beginDictation}
            size={40}
            accessibilityLabel="Talk about your day"
            accessibilityHint="Starts voice dictation for today's journal entry"
          />
          <Text style={styles.voiceIdleLabel}>Talk about your day — dictate today's entry</Text>
        </View>
      ) : null}

      <View style={styles.editorArea}>{editorContent}</View>

      <Pressable
        style={[
          styles.saveButton,
          justSaved && (isPendingSync ? styles.saveButtonQueued : styles.saveButtonSaved),
          (!isDirty || isSaving) && !justSaved && styles.saveButtonDisabled,
        ]}
        onPress={() => void handleSave()}
        disabled={!isDirty || isSaving}
        accessibilityRole="button"
        accessibilityLabel="Save journal entry"
        accessibilityState={{ disabled: !isDirty || isSaving }}
      >
        {/* "Queued" (offline, waiting to sync) is deliberately distinct from
            "Saved" (confirmed) — the two used to look identical, which made
            an offline save indistinguishable from a genuinely-lost one. */}
        {justSaved ? (
          <Icon
            name={isPendingSync ? "refresh" : "check"}
            size={16}
            color={isPendingSync ? colors.warningForeground : colors.successForeground}
          />
        ) : null}
        <Text
          style={[
            styles.saveButtonText,
            justSaved && (isPendingSync ? styles.saveButtonTextQueued : styles.saveButtonTextSaved),
          ]}
        >
          {isSaving ? "Saving…" : justSaved ? (isPendingSync ? "Queued" : "Saved") : "Save"}
        </Text>
      </Pressable>

      <View style={styles.recentSection}>
        <Text style={styles.recentHeading}>Recent entries</Text>
        <View style={styles.recentListArea}>{recentContent}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  navArrow: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  flipHorizontal: {
    transform: [{ scaleX: -1 }],
  },
  voicePriming: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  voicePrimingText: {
    fontSize: typography.size.xs,
    color: colors.mutedForeground,
  },
  voiceIdleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  voiceIdleLabel: {
    flex: 1,
    fontSize: typography.size.sm,
    color: colors.mutedForeground,
  },
  voicePanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  voiceCaption: {
    flex: 1,
    fontSize: typography.size.sm,
    color: colors.foreground,
  },
  stopPill: {
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.destructive,
  },
  stopPillPressed: {
    opacity: 0.8,
  },
  stopPillText: {
    color: colors.destructiveForeground,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.xs,
  },
  voiceNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  voiceNoticeText: {
    flex: 1,
    fontSize: typography.size.xs,
    color: colors.mutedForeground,
  },
  voiceNoticeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  voiceNoticeAction: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
  },
  voiceNoticeActionPressed: {
    opacity: 0.7,
  },
  voiceNoticeActionText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.foreground,
    textDecorationLine: "underline",
  },
  dateLabelWrap: {
    flex: 1,
    alignItems: "center",
  },
  dateLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.foreground,
  },
  dateSublabel: {
    fontSize: typography.size.xs,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  editorArea: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  editorSkeleton: {
    gap: 10,
  },
  editorSkeletonBody: {
    marginTop: 4,
  },
  textInput: {
    minHeight: 160,
    maxHeight: 260,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.md,
    fontSize: typography.size.md,
    color: colors.foreground,
  },
  saveButton: {
    flexDirection: "row",
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
  saveButtonDisabled: {
    backgroundColor: colors.border,
  },
  saveButtonSaved: {
    backgroundColor: colors.successMuted,
  },
  saveButtonQueued: {
    backgroundColor: colors.warningMuted,
  },
  saveButtonText: {
    color: colors.white,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.sm,
  },
  saveButtonTextSaved: {
    color: colors.successForeground,
  },
  saveButtonTextQueued: {
    color: colors.warningForeground,
  },
  recentSection: {
    flex: 1,
    marginTop: 20,
  },
  recentHeading: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  recentListArea: {
    flex: 1,
  },
  recentListContent: {
    paddingVertical: 4,
  },
  recentRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 2,
  },
  recentRowActive: {
    backgroundColor: colors.muted,
  },
  recentRowDate: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    color: colors.foreground,
  },
  recentRowPreview: {
    fontSize: typography.size.xs,
    color: colors.mutedForeground,
  },
});
