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
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { genId, getLocalDateString, todayKey, type JournalEntry } from "@goalslot/shared";

import { EmptyState, ErrorState, Skeleton, SkeletonListItem } from "@/components";
import { Reveal } from "@/components/reports/Reveal";
import { PressableScale } from "@/components/today/PressableScale";
import { TypingIndicator } from "@/components/ui/TypingIndicator";
import { MicOrb } from "@/components/voice/MicOrb";
import { Icon } from "@/components/ui/Icon";
import { useReduceMotion } from "@/hooks/useReduceMotion";
import { useVoiceCapture, type VoiceCommandOutcome } from "@/hooks/useVoiceCapture";
import { apiClient, notify } from "@/lib/api-client";
import { queueOfflineEdit } from "@/lib/offline";
import { journalQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useJournalReminderSync } from "@/lib/useJournalReminders";
import { useAnalytics } from "@/providers/growth-provider";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors, controlHeight, minTouchTarget, motion, radii, shadows, spacing, typography } from "@/theme";

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
// How long a run of *silent* segments (an empty transcript — the recognizer
// heard nothing) is tolerated, in total elapsed wall-clock time, before
// giving up and surfacing a message — rather than looping the mic forever
// if, say, another app grabbed it. A silent segment and a genuine VoiceError
// both land in the hook as `{ status: 'error', transcript: '' }` (see
// handleError/settle in the hook), so the same budget and cap cover both.
//
// This is a *time* budget, not a retry count, on purpose. expo-speech-
// recognition's non-continuous sessions (the mode this hook always uses —
// see speech-recognition.ts) end themselves after a short gap in speech —
// as little as 3s on iOS per the library's own README — which is far
// shorter than a normal pause to think of what to say next mid-entry. Each
// such platform-level timeout reaches this screen as an indistinguishable
// silent segment, so counting *sessions* rather than *time* meant two
// ordinary thinking-pauses were enough to exhaust a small fixed retry count
// and silently end the whole dictation — precisely the reported bug
// ("continues to add things... but after two sentences, it stopped working
// somehow", with no crash or visible error). Budgeting elapsed silence
// instead means any number of short platform timeouts get silently retried
// through, and the mic only actually gives up once real silence has gone on
// long enough that it is unlikely to still be a mid-thought pause.
//
// Two ways in, one path: the `?voice=1` deep link (Siri / the App Shortcut)
// and the in-editor mic button both call the same `beginDictation` defined
// inside the component below, so a session started either way behaves
// identically from that point on.
const MAX_SILENCE_MS = 45_000;

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

/**
 * Weekday only ("Tuesday") — the headline for every non-today date. Split out
 * from `formatDisplayDate` so the header can show a short, big headline plus
 * the full date as a smaller subline underneath, instead of the same long
 * string twice at two sizes (what this screen used to do).
 */
function formatWeekday(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

/**
 * Small "day tile" leading marker for a recent-entries row — the day number
 * plus abbreviated month, echoing the same "the date is the anchor" idea the
 * header above is built around, so a row in the list reads as a continuation
 * of the same writing surface rather than a generic list item. Purely
 * decorative: the row's own accessibilityLabel already carries the full date.
 */
function RecentDayBadge({ dateKey, active }: { dateKey: string; active: boolean }) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const monthAbbrev = date.toLocaleDateString(undefined, { month: "short" }).toUpperCase();

  return (
    <View
      style={[styles.dayBadge, active && styles.dayBadgeActive]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.dayBadgeMonth, active && styles.dayBadgeMonthActive]}>{monthAbbrev}</Text>
      <Text style={[styles.dayBadgeNum, active && styles.dayBadgeNumActive]}>{date.getDate()}</Text>
    </View>
  );
}

export default function JournalScreen() {
  const analytics = useAnalytics();
  const { voice } = useCapabilities();
  // Single flag gating every Reanimated effect this screen drives (the save
  // checkmark's entrance, the day-switch cross-fade) — same discipline as
  // PressableScale/Reveal/PulsingDot elsewhere in the app: check once, skip
  // the `withSpring`/`withTiming` call entirely and jump straight to the
  // resting value when Reduce Motion is on.
  const reduceMotion = useReduceMotion();

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
  // Drives the editor's focus ring — the box otherwise looked identical
  // whether or not it actually had the keyboard, which made it easy to lose
  // track of where typing was going.
  const [isEditorFocused, setIsEditorFocused] = useState(false);
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
  /**
   * Wall-clock time (`Date.now()`) the current unbroken run of silent
   * segments began, or `null` while no silence streak is active. Reset to
   * `null` on every committed phrase and whenever a fresh dictation run
   * starts, so it always measures time-since-last-heard-speech rather than
   * time-since-dictation-began. Compared against `MAX_SILENCE_MS` below.
   */
  const silenceStartedAtRef = useRef<number | null>(null);
  const softStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (softStopTimer.current) clearTimeout(softStopTimer.current);
    },
    [],
  );

  const handleVoiceCommand = useCallback(async (transcript: string): Promise<VoiceCommandOutcome> => {
    // A committed phrase means the mic is hearing fine — clear the silence
    // streak so an occasional pause later doesn't inherit elapsed time
    // toward the budget from earlier in the same dictation run.
    silenceStartedAtRef.current = null;
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
        silenceStartedAtRef.current = null;
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
    silenceStartedAtRef.current = null;
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
    const now = Date.now();
    if (silenceStartedAtRef.current === null) silenceStartedAtRef.current = now;
    if (now - silenceStartedAtRef.current < MAX_SILENCE_MS) {
      resetVoice();
      return;
    }
    captureActiveRef.current = false;
    silenceStartedAtRef.current = null;
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
    silenceStartedAtRef.current = null;
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

  // A quiet cross-fade on the editor surface whenever the visible day
  // changes (arrows, "Jump to today", tapping a recent-entries row) — the
  // draft-reset effect above already blanks `draft` synchronously, so a true
  // fade-out-old/fade-in-new would need to hold onto stale text past the
  // point it's already gone; fading the container back in instead gives the
  // same "the page turned" read without that extra state. Doubles as a
  // gentle first-paint entrance, since mount fires this effect too.
  const editorTransition = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      editorTransition.value = 1;
      return;
    }
    editorTransition.value = 0;
    editorTransition.value = withTiming(1, {
      duration: motion.duration.base,
      easing: Easing.out(Easing.cubic),
    });
  }, [selectedDate, reduceMotion, editorTransition]);
  const editorTransitionStyle = useAnimatedStyle(() => ({ opacity: editorTransition.value }));

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
    ({ item }: { item: JournalEntry }) => {
      const isActive = item.date === selectedDate;
      const trimmedContent = item.content.trim();
      const hasContent = trimmedContent.length > 0;
      return (
        <PressableScale
          style={[styles.recentRow, isActive && styles.recentRowActive]}
          onPress={() => setSelectedDate(item.date)}
          accessibilityRole="button"
          accessibilityLabel={`${formatDisplayDate(item.date)}${hasContent ? `, ${trimmedContent.slice(0, 80)}` : ", no content"}`}
        >
          <RecentDayBadge dateKey={item.date} active={isActive} />
          <View style={styles.recentRowBody}>
            <Text
              style={[styles.recentRowPreview, !hasContent && styles.recentRowPreviewEmpty]}
              numberOfLines={1}
            >
              {hasContent ? trimmedContent : "No content"}
            </Text>
            <Text style={styles.recentRowDate} numberOfLines={1}>
              {formatDisplayDate(item.date)}
            </Text>
          </View>
        </PressableScale>
      );
    },
    [selectedDate],
  );

  // The "Saved"/"Queued" checkmark used to just appear — a plain conditional
  // render with no transition of its own, which made the icon feel bolted
  // on next to the haptic tick and the text swap already confirming the
  // save. A small spring pop (matching PressableScale's own spring, not a
  // bouncier one — this is a confirmation, not a celebration) is enough to
  // make the icon read as arriving rather than just materializing.
  const saveIconProgress = useSharedValue(0);
  useEffect(() => {
    if (!justSaved) {
      saveIconProgress.value = 0;
      return;
    }
    saveIconProgress.value = reduceMotion ? 1 : withSpring(1, motion.spring);
  }, [justSaved, reduceMotion, saveIconProgress]);
  const saveIconStyle = useAnimatedStyle(() => ({
    opacity: saveIconProgress.value,
    transform: [{ scale: saveIconProgress.value }],
  }));

  // Whether the currently-shown entry reflects a save that's still only
  // queued to the offline outbox — drives the Save button's "Queued" vs
  // "Saved" treatment below.
  const isPendingSync = entryQuery.data?.pendingSync === true;

  // Whether the editor is showing real, writable content right now (not the
  // loading skeleton or the hard-error branch) — gates the word count below
  // it, which has nothing meaningful to report in either of those states.
  const isEditorReady = !entryQuery.isPending && !(entryQuery.isError && entryQuery.data === undefined);
  const wordCount = useMemo(() => {
    const trimmed = draft.trim();
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  }, [draft]);
  const showWordCount = isEditorReady && wordCount > 0;

  let editorContent: React.ReactNode;
  if (entryQuery.isPending) {
    editorContent = (
      <View style={styles.editorSkeleton} accessibilityLabel="Loading journal entry">
        <Skeleton height={14} width="35%" />
        <Skeleton height={160} style={styles.editorSkeletonBody} />
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
      <View style={styles.editorErrorCard}>
        <ErrorState compact message="Couldn't load this entry." onRetry={() => void entryQuery.refetch()} />
      </View>
    );
  } else {
    editorContent = (
      <TextInput
        style={[styles.textInput, isEditorFocused && styles.textInputFocused]}
        multiline
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setIsDirty(true);
        }}
        onFocus={() => {
          setIsEditorFocused(true);
          handleEditorFocus();
        }}
        onBlur={() => setIsEditorFocused(false)}
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
      <ErrorState compact message="Couldn't load recent entries." onRetry={() => void recentQuery.refetch()} />
    );
  } else if (recentEntries.length === 0) {
    recentContent = (
      <EmptyState
        compact
        iconName="journal"
        tone="brand"
        message="No journal entries yet"
        description="Write today's entry above to start your streak."
      />
    );
  } else {
    // A single fade-and-rise for the whole card, not a per-row stagger down
    // the FlashList — Reveal's own header comment already explains why it's
    // hand-rolled rather than `entering={...}`: it must play exactly once
    // per mount. A recycled FlashList cell is not a stable mount the way a
    // Reports card is, so animating individual rows risks replaying the
    // entrance mid-scroll as cells get recycled. One Reveal around the
    // whole list sidesteps that entirely and still gives the section its
    // own quiet arrival right after the editor above it settles (`delay`
    // staggers it just past the editor's own cross-fade, not simultaneous
    // with it).
    recentContent = (
      <Reveal delay={60} style={styles.recentListCard}>
        <FlashList
          data={recentEntries}
          keyExtractor={(item) => item.id}
          renderItem={renderRecentItem}
          contentContainerStyle={styles.recentListContent}
        />
      </Reveal>
    );
  }

  return (
    // edges={["top"]} matches index.tsx/reports.tsx. Without it this screen's
    // date navigation rendered underneath the system status bar on devices
    // with a tall status bar (reported on a Samsung S22).
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.eyebrow}>Journal</Text>

      {/* The date IS this screen's headline — there's no separate title above
          it — so it gets the same visual weight index.tsx's `greeting` and
          timer.tsx's `headerTitle` carry, not a small label. Headline (big:
          "Today" or the weekday) + a muted subline (the full date) replaces
          the old layout, which showed the exact same full-date string twice
          at two sizes for every non-today day. */}
      <View style={styles.dateNav}>
        <PressableScale
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
            <Icon name="chevron" size={18} color={isDictating ? colors.border : colors.foreground} />
          </View>
        </PressableScale>

        <Pressable
          style={styles.dateLabelWrap}
          onPress={goToToday}
          disabled={isToday || isDictating}
          accessibilityRole="header"
          accessibilityLabel={`Journal date: ${formatDisplayDate(selectedDate)}${isToday ? ", today" : ""}`}
        >
          <Text style={styles.dateHeadline} numberOfLines={1}>
            {isToday ? "Today" : formatWeekday(selectedDate)}
          </Text>
          <Text style={styles.dateSubline} numberOfLines={1}>
            {formatDisplayDate(selectedDate)}
          </Text>
          {/* The whole block above is already the tap target that jumps back
              to today (onPress={goToToday}, disabled when already on today)
              — this makes that affordance visible instead of silent. Its own
              Text node, not appended inline after the full date string:
              `dateSubline` above is numberOfLines={1}, and a long locale date
              ("Thursday, August 13, 2026") plus "  ·  Jump to today" on one
              line regularly overflows a phone's width, so RN's own ellipsis
              truncation was silently eating this text before it ever
              rendered — "shows nothing" was accurate, not a bug report about
              tapping. A second, short line can't hit that same limit. */}
          {!isToday ? (
            <Text style={styles.dateSublineLink} numberOfLines={1}>
              Jump to today
            </Text>
          ) : null}
        </Pressable>

        <PressableScale
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
            size={18}
            color={canGoForward && !isDictating ? colors.foreground : colors.border}
          />
        </PressableScale>
      </View>

      {voiceMode === "priming" ? (
        <View style={styles.voicePriming} accessibilityLiveRegion="polite">
          {/* Same animated dot wave Coach/voice.tsx use for "the system is
              working on something" — a bare string here used to be the only
              feedback while the mic warmed up, which read as frozen rather
              than as a brief, alive wait. */}
          <TypingIndicator size={6} />
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
          {/* The brief gap between a phrase ending and its transcript
              settling reached the hook as `processing`, which this panel
              used to render with the exact same caption text as `listening`
              — nothing on screen distinguished "still hearing you" from
              "working on what you just said". Swapping in the same dot wave
              voice.tsx uses for its own `isThinking` moment gives that gap a
              distinct, honest signal instead of a caption that quietly goes
              stale for a beat. */}
          {voiceState.status === "processing" ? (
            <View style={styles.voiceCaptionRow}>
              <TypingIndicator size={6} />
            </View>
          ) : (
            <Text style={styles.voiceCaption} numberOfLines={3}>
              {voiceState.transcript.length > 0 ? voiceState.transcript : "Listening — talk about your day…"}
            </Text>
          )}
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
        <View style={[styles.voiceNotice, styles.voiceNoticeBlocked]} accessibilityLiveRegion="polite">
          <Icon name="alert" size={18} color={colors.destructive} />
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

      <Animated.View style={[styles.editorArea, editorTransitionStyle]}>
        {editorContent}
        {/* A small, quiet craft touch — the kind of ambient feedback a real
            writing surface gives (Notes, Day One) that a plain form field
            never bothers with. Only shown once there's something to count,
            and never during loading/error, where it has nothing to report. */}
        {showWordCount ? (
          <Text style={styles.wordCount}>{wordCount === 1 ? "1 word" : `${wordCount} words`}</Text>
        ) : null}
      </Animated.View>

      <Pressable
        style={({ pressed }) => [
          styles.saveButton,
          justSaved && (isPendingSync ? styles.saveButtonQueued : styles.saveButtonSaved),
          (!isDirty || isSaving) && !justSaved && styles.saveButtonDisabled,
          pressed && isDirty && !isSaving && !justSaved && styles.saveButtonPressed,
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
          <Animated.View style={saveIconStyle}>
            <Icon
              name={isPendingSync ? "refresh" : "check"}
              size={16}
              color={isPendingSync ? colors.warning : colors.success}
            />
          </Animated.View>
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

// Shared chrome for the small floating status panels this screen shows above
// the editor while dictation is priming/listening/paused/blocked. Previously
// each one (voicePriming, voicePanel, voiceNotice) hand-rolled its own
// slightly-different margin/padding/radius/border, so the four states didn't
// visually read as one family of "the mic wants your attention" surfaces.
// Individual entries below still override colour where a state's meaning
// calls for it (the brand-tinted idle invite, the destructive "blocked"
// tint) — only the shared geometry and elevation are centralised here.
const VOICE_SURFACE = {
  marginHorizontal: spacing.lg,
  marginTop: spacing.sm,
  padding: spacing.md,
  borderRadius: radii.lg,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.border,
  backgroundColor: colors.card,
  ...shadows.subtle,
} as const;

// The writing surface's own chrome — shared by the real TextInput, its
// loading skeleton and its error card, so all three occupy the same visual
// "sheet of paper" regardless of which is showing, and swapping between them
// doesn't reflow the screen. `shadows.card` (not `subtle`) because this is
// the screen's primary surface, not a control seated on one — see
// theme/foundation.ts's elevation ramp.
const EDITOR_SURFACE = {
  borderRadius: radii.card,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: colors.border,
  backgroundColor: colors.card,
  padding: spacing.xxl,
  ...shadows.card,
} as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Screen-identity label, matching the eyebrow+title pattern index.tsx and
  // timer.tsx both open with — this screen just has no separate title
  // beneath it because the date nav below already IS the title.
  eyebrow: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.mutedForeground,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  navArrow: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
    // "A control seated ON a surface" — foundation.ts's own rubric for
    // `shadows.subtle` — is exactly what this circle is doing against the
    // screen background; it previously carried no elevation of its own.
    ...shadows.subtle,
  },
  flipHorizontal: {
    transform: [{ scaleX: -1 }],
  },
  voicePriming: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  voicePrimingText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    color: colors.mutedForeground,
  },
  // Brand-tinted invite, echoing the "brand-accented container" convention
  // documented in theme/foundation.ts (primaryMuted/primaryBorder/primaryText)
  // rather than blending into the screen as a plain unstyled row — this is
  // the entry point into the screen's one voice feature.
  voiceIdleRow: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  voiceIdleLabel: {
    flex: 1,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.primaryText,
  },
  voicePanel: {
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  voiceCaption: {
    flex: 1,
    fontSize: typography.size.sm,
    lineHeight: 19,
    color: colors.foreground,
  },
  // Occupies the same flex:1 slot `voiceCaption` normally does, so swapping
  // to the dot wave during the `processing` beat doesn't shift the mic or
  // the Stop pill beside it.
  voiceCaptionRow: {
    flex: 1,
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
    ...VOICE_SURFACE,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  // "Blocked" (permission denied / unavailable) is a harder stop than
  // "soft-stopped" (just paused) — the destructive tint plus the alert icon
  // next to it says so at a glance, matching the muted-bg/solid-foreground
  // pairing IconBadge.tsx and Badge.tsx already use for this exact tone.
  voiceNoticeBlocked: {
    borderColor: colors.destructiveMuted,
    backgroundColor: colors.destructiveMuted,
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
  // The screen's one real focal point — big enough to read as a headline
  // from across the room, the same job index.tsx's `greeting` (30px) and
  // timer.tsx's `headerTitle` do for their own screens. "Today" or a bare
  // weekday ("Tuesday"); the full date lives in `dateSubline` below instead
  // of being repeated here at a second size.
  dateHeadline: {
    fontSize: 32,
    fontWeight: typography.weight.bold,
    letterSpacing: -0.7,
    color: colors.foreground,
  },
  dateSubline: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  // Makes the "tap this whole block to jump back to today" affordance
  // (dateLabelWrap's own onPress, already there before this pass) visible
  // instead of silent — previously a non-today date rendered no cue at all
  // that the block underneath it was interactive.
  dateSublineLink: {
    color: colors.primaryText,
    fontWeight: typography.weight.semibold,
    textDecorationLine: "underline",
  },
  editorArea: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  editorSkeleton: {
    ...EDITOR_SURFACE,
    minHeight: 240,
    gap: 10,
  },
  editorSkeletonBody: {
    marginTop: 4,
  },
  editorErrorCard: {
    ...EDITOR_SURFACE,
    padding: 0, // ErrorState brings its own internal padding via `compact`
  },
  textInput: {
    ...EDITOR_SURFACE,
    minHeight: 240,
    maxHeight: 400,
    // A step above the old size.md, and given its own explicit lineHeight —
    // long-form writing reads better with generous leading than the UI-row
    // default the shared scale assumes. This is prose, not a form field.
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.1,
    color: colors.foreground,
  },
  // The box otherwise looked identical focused or not — this is the same
  // "ring" affordance the web app's `--ring` token exists for, translated to
  // a border-color swap since RN has no outline. Elevation steps up to
  // `raised` too — the same "actively floating" cue timer.tsx's hero card
  // gets while a session is live (see foundation.ts's elevation ramp) — so
  // the page reads as visibly lifted while it has focus, not just outlined.
  textInputFocused: {
    borderColor: colors.ring,
    borderWidth: 1.5,
    ...shadows.raised,
  },
  wordCount: {
    fontSize: 11,
    color: colors.mutedForeground,
    textAlign: "right",
    marginTop: spacing.xs,
  },
  saveButton: {
    flexDirection: "row",
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    minHeight: controlHeight.md,
    paddingVertical: spacing.md,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
    ...shadows.subtle,
  },
  // Discrete press feedback — the button previously gave none at all (no
  // scale, no opacity shift) between finger-down and the save actually
  // completing. A plain style swap (not Reanimated) to match how
  // `navArrowPressed` already did this elsewhere in this file, before this
  // pass moved the arrows to PressableScale.
  saveButtonPressed: {
    opacity: 0.9,
  },
  saveButtonDisabled: {
    backgroundColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonSaved: {
    backgroundColor: colors.successMuted,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonQueued: {
    backgroundColor: colors.warningMuted,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: {
    color: colors.white,
    fontWeight: typography.weight.semibold,
    fontSize: typography.size.sm,
  },
  // `success`/`warning` (the solid, saturated colours), not
  // `successForeground`/`warningForeground` — those are text-on-SOLID-fill
  // colours (white / near-black) meant to pair with `colors.success` as a
  // background, not with the light `*Muted` tint these two buttons actually
  // use. The previous pairing put white text on a near-white mint fill,
  // which was flatly unreadable. Badge.tsx / IconBadge.tsx already use the
  // muted-bg + solid-foreground pairing this switches to.
  saveButtonTextSaved: {
    color: colors.success,
  },
  saveButtonTextQueued: {
    color: colors.warning,
  },
  recentSection: {
    flex: 1,
    marginTop: spacing.xxl,
  },
  recentHeading: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
    color: colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  recentListArea: {
    flex: 1,
  },
  // Same elevated-surface treatment as the editor above it — `radii.card`
  // (not the smaller `radii.lg` this used to carry) so the two surfaces read
  // as one family rather than the list looking like a lower-tier bolt-on
  // under the "real" writing surface. The list previously sat directly on
  // the screen background with nothing to separate it as its own surface at
  // all. Margin (not the loading/error/empty branches' own padding) is what
  // keeps this aligned with the screen's other spacing.lg gutters without
  // double-padding those branches.
  recentListCard: {
    flex: 1,
    marginHorizontal: spacing.lg,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
    ...shadows.card,
  },
  recentListContent: {
    paddingVertical: 4,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Brand-tinted rather than the flat neutral `colors.muted` this used to be
  // — the same "brand-accented container" convention `voiceIdleRow` already
  // uses above, so the one row that's "this is what you're looking at right
  // now" reads as a deliberate accent rather than a generic hover state.
  recentRowActive: {
    backgroundColor: colors.primaryMuted,
  },
  recentRowBody: {
    flex: 1,
    minWidth: 0, // lets numberOfLines={1} actually ellipsize inside a row
    gap: 2,
  },
  // Content is the primary scan target now that the day badge carries the
  // date — flipped from the old hierarchy, where the date was bold/dark and
  // the content preview was the muted secondary line.
  recentRowPreview: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.foreground,
  },
  recentRowPreviewEmpty: {
    fontWeight: typography.weight.regular,
    fontStyle: "italic",
    color: colors.mutedForeground,
  },
  recentRowDate: {
    fontSize: 11,
    color: colors.mutedForeground,
    marginTop: 1,
  },
  // The day-tile leading marker — echoes the header's own "the date is the
  // anchor" idea at list-row scale, matching TaskRow's/GoalProgressRow's
  // convention of a fixed-size leading marker column every row aligns
  // against.
  dayBadge: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  dayBadgeActive: {
    backgroundColor: colors.primaryMuted,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  dayBadgeMonth: {
    fontSize: 9,
    fontWeight: typography.weight.bold,
    letterSpacing: 0.4,
    color: colors.mutedForeground,
  },
  dayBadgeMonthActive: {
    color: colors.primaryText,
  },
  dayBadgeNum: {
    fontSize: 15,
    fontWeight: typography.weight.bold,
    lineHeight: 17,
    color: colors.foreground,
  },
  dayBadgeNumActive: {
    color: colors.primaryText,
  },
});
