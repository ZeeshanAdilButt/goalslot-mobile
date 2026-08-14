// The full schedule-block editor: title, one-or-many days, real start/end
// time, an optional goal link, category, and a private toggle. This is what
// QuickAddSheet (kind="slot") deliberately is NOT — that sheet is the
// title-only "3-tap add" (see its own header comment), a fast path for "get
// something on the calendar right now". This sheet is where a user who needs
// to say "gym, 6-7am, Mon/Wed/Fri" actually can — the exact complaint that
// motivated building it ("cant even add a slot at proper time... cant select
// that a slot can be for multiple days").
//
// Mirrors dw-time-web/src/features/schedule/components/schedule-block-modal.tsx
// field-for-field: title, day toggles (multi on create, single on edit),
// start/end time, category, goal link, isPrivate. Two web fields are
// deliberately absent:
//   - a standalone color picker: the web modal has none either — `color` is
//     always derived from the selected category (or the linked goal's
//     category) via a useEffect, never user-facing. Same derivation here,
//     via the `resolvedColor` useMemo below.
//   - category as a <SearchableSelect> of real Category records: this app's
//     other edit sheets (EditGoalSheet.tsx, EditTaskSheet.tsx) both use a
//     plain free-text field for category — there is no picker pattern
//     established on mobile to reuse, and the brief was explicit not to
//     invent one. Free text here matches that convention; color is still
//     resolved automatically by matching the typed text against the user's
//     real categories (categoryQueries), same intent as the web's derivation
//     without adding new UI.
//
// GOAL BEFORE CATEGORY, and the dependency only ever runs that way. Picking
// a goal fills in the category it belongs to; typing a category never
// narrows which goals are offered. That asymmetry is the whole point: on web
// these were the other way round and a pre-selected category quietly filtered
// the goal list, so typing a real goal's name returned "No matches" for a
// goal that plainly existed. Ordering the fields goal-first makes the
// supported direction the obvious one, and the goal list below is rendered
// from `goals` untouched — there is deliberately no category term anywhere in
// its render path for a future edit to start filtering on.
//
// The auto-fill is tracked (`autoFilledCategory`) rather than unconditional,
// so it can replace a value it wrote itself when the user switches goals, but
// never a category the user typed or one loaded from an existing block.
//
// MULTI-DAY CREATE is not a single API call — CreateScheduleBlockInput is
// one dayOfWeek per block. Mirrors the web's handleSubmit exactly: when more
// than one day is selected, generate ONE shared seriesId up front, then fire
// one apiClient.schedule.create() per selected day, each carrying that same
// seriesId. A single-day create omits seriesId entirely (server assigns its
// own, matching a solo block's series-of-one).
//
// SERIES EDIT: a block is part of a series when other blocks in the cached
// week share its seriesId (computed from the already-fetched weekly query,
// no extra request — mirrors web's schedule-page.tsx `seriesBlockCount`
// derivation off `allBlocks`). When it is, an "Apply to" chip pair appears
// (single | series) exactly like the web modal's `isSeriesEdit` branch, and
// the day picker disables itself while "series" is selected (changing one
// day doesn't make sense for an edit that's about to touch every day in the
// series).

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import {
  createScheduleBlockSchema,
  DAYS_OF_WEEK_FULL,
  genId,
  hasResponse,
  minutesToTime,
  timeToMinutes,
  updateScheduleBlockSchema,
  type CreateScheduleBlockInput,
  type ScheduleBlock,
  type ScheduleUpdateScope,
  type UpdateScheduleBlockInput,
  type WeekSchedule,
} from "@goalslot/shared";

import { apiClient, notify } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { offlineSync, outbox } from "@/lib/offline";
import { categoryQueries, goalQueries, scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { findLinkedBlocks } from "@/lib/schedule-series";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { useAnalytics } from "@/providers/growth-provider";
import { Icon } from "@/components/ui/Icon";
import { TimePicker } from "@/components/ui/TimePicker";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export type ScheduleBlockSheetPresentOptions =
  | {
      mode: "create";
      dayOfWeek: number;
      /**
       * "HH:mm" to open on, for callers that pressed a specific point on the
       * time axis. Omitted by the FAB, which has no time in mind.
       */
      startTime?: string;
    }
  | { mode: "edit"; block: ScheduleBlock };

export interface ScheduleBlockSheetRef {
  present: (options: ScheduleBlockSheetPresentOptions) => void;
  dismiss: () => void;
}

// Same fallback value QuickAddSheet's useQuickAdd.ts uses for a
// category/goal whose color can't be resolved yet — the one other color
// constant in this app (see EditGoalSheet.tsx's header comment), reused
// rather than inventing a second placeholder.
const PLACEHOLDER_COLOR = "#94A3B8";

// Same defaults dw-time-web's ScheduleBlockModal starts a new block with.
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "10:00";
/** Length of the block a time-anchored create starts with, matching the defaults above. */
const DEFAULT_DURATION_MIN = 60;
/** Last representable minute of a day — a 23:00 press can't run an hour long. */
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

const DAY_SHORT_LABELS = DAYS_OF_WEEK_FULL.map((d) => d.slice(0, 3));

function dayHaptic(): void {
  void Haptics.selectionAsync();
}

export const ScheduleBlockSheet = forwardRef<ScheduleBlockSheetRef, object>(function ScheduleBlockSheet(
  _props,
  ref,
) {
  const sheetRef = useRef<BottomSheetModal>(null);
  // See the hook's own header for why this is needed at all — the library
  // doesn't wire Android's hardware back button to the sheet on its own.
  const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);
  const analytics = useAnalytics();

  // See BlockDetailSheet.tsx for the full reasoning. Short version: this sheet
  // is portalled to the app root, outside every screen's
  // `<SafeAreaView edges={["top"]}>`, and Android is edge-to-edge, so nothing
  // between this content and the physical edges of the display is accounted
  // for unless the sheet accounts for it.
  //
  // Both edges matter here, because this form is tall enough that dynamic
  // sizing clamps it to the full container height:
  //   - bottom, or Cancel/Save sit under the navigation bar,
  //   - top, or the "Edit time slot" heading and the grab handle slide under
  //     the status bar once the sheet reaches its maximum height.
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [category, setCategory] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([0]);
  const [goalId, setGoalId] = useState("");
  // The last category value this sheet auto-filled from a goal. Anything else
  // in the category field is the user's (or the saved block's) and is never
  // overwritten — see the header note.
  const [autoFilledCategory, setAutoFilledCategory] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [updateScope, setUpdateScope] = useState<ScheduleUpdateScope>("single");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"title" | "category" | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      present: (options) => {
        setError(null);
        setUpdateScope("single");
        // Neither branch below has auto-filled anything yet, so a stale value
        // from the previous open must not license overwriting this one's
        // category.
        setAutoFilledCategory(null);
        if (options.mode === "edit") {
          const block = options.block;
          setMode("edit");
          setEditingBlock(block);
          setTitle(block.title);
          setStartTime(block.startTime);
          setEndTime(block.endTime);
          setCategory(block.category);
          setSelectedDays([block.dayOfWeek]);
          setGoalId(block.goalId ?? "");
          setIsPrivate(Boolean(block.isPrivate));
        } else {
          setMode("create");
          setEditingBlock(null);
          setTitle("");
          // A press on the timeline's 3 PM row said "Add a block at 3 PM" and
          // then opened on 09:00 — the affordance and the form disagreed.
          // Without an anchor (the FAB) the web's own defaults still stand.
          if (options.startTime) {
            const startMin = Math.min(timeToMinutes(options.startTime), LAST_MINUTE_OF_DAY);
            setStartTime(minutesToTime(startMin));
            setEndTime(minutesToTime(Math.min(startMin + DEFAULT_DURATION_MIN, LAST_MINUTE_OF_DAY)));
          } else {
            setStartTime(DEFAULT_START_TIME);
            setEndTime(DEFAULT_END_TIME);
          }
          setCategory("");
          setSelectedDays([options.dayOfWeek]);
          setGoalId("");
          setIsPrivate(false);
        }
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  // Cache hit in practice — the Schedule screen already has this query live
  // whenever this sheet can be opened, so this doesn't trigger a second
  // network request, only a second subscriber to the same cached data.
  const weeklyQuery = useQuery(scheduleQueries.weekly());
  const { data: categories = [] } = useQuery(categoryQueries.list());
  const { data: goals = [], isPending: isGoalsPending } = useQuery(goalQueries.list({ status: "ACTIVE" }));

  // Which other blocks this edit can reach. A real series (shared seriesId)
  // is the web's `seriesBlockCount` derivation; the "lookalike" case is the
  // one the web has no answer for — five separately-created "Reading" blocks
  // that are visibly one routine but carry five unrelated seriesIds, and so
  // can only be fanned out client-side. See src/lib/schedule-series.ts.
  const linked = useMemo(() => {
    if (!editingBlock || !weeklyQuery.data) return null;
    return findLinkedBlocks(editingBlock, Object.values(weeklyQuery.data).flat());
  }, [editingBlock, weeklyQuery.data]);

  const seriesBlockCount = linked && linked.kind !== "solo" ? linked.members.length : 0;
  const isSeriesEdit = mode === "edit" && seriesBlockCount > 1;
  const scopeToApply: ScheduleUpdateScope = isSeriesEdit ? updateScope : "single";
  const dayPickerDisabled = isSeriesEdit && scopeToApply === "series";

  // Resolves the block's color from whatever the user typed into the
  // free-text category field, matching against the user's real categories —
  // the same "category implies color" behavior the web modal gets from its
  // category <Select>, without adding a second picker UI here.
  const resolvedColor = useMemo(() => {
    const trimmed = category.trim().toLowerCase();
    if (!trimmed) return undefined;
    const match = categories.find(
      (c) => c.value.toLowerCase() === trimmed || c.name.toLowerCase() === trimmed,
    );
    return match?.color;
  }, [category, categories]);

  const trimmedTitle = title.trim();
  const trimmedCategory = category.trim();
  const timeRangeValid = timeToMinutes(endTime) > timeToMinutes(startTime);
  const canSubmit =
    !isSubmitting &&
    trimmedTitle.length > 0 &&
    trimmedCategory.length > 0 &&
    timeRangeValid &&
    selectedDays.length > 0;

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const handleCancel = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  /**
   * Links a goal and, where it's safe to, fills the category in from it.
   *
   * "Safe" means the category box is empty or still holds the value a
   * previous goal pick put there — so switching goals re-fills correctly,
   * while a category the user typed (or one loaded from the block being
   * edited) is left alone. Note what this does NOT do: it never touches the
   * goal list. Category depends on goal here, never the reverse.
   */
  const handlePickGoal = useCallback(
    (goal: { id: string; category: string }) => {
      dayHaptic();
      setGoalId(goal.id);

      const next = goal.category.trim();
      if (!next) return;
      setCategory((current) => {
        const trimmed = current.trim();
        if (trimmed !== "" && trimmed !== autoFilledCategory) return current;
        setAutoFilledCategory(next);
        return next;
      });
    },
    [autoFilledCategory],
  );

  const handleClearGoal = useCallback(() => {
    dayHaptic();
    setGoalId("");
    // Only retract a category this sheet filled in itself.
    setCategory((current) => (current.trim() === autoFilledCategory ? "" : current));
    setAutoFilledCategory(null);
  }, [autoFilledCategory]);

  const toggleDay = useCallback((day: number) => {
    dayHaptic();
    setSelectedDays((prev) => {
      if (prev.includes(day)) {
        // Never let the last day get deselected — a slot with zero days
        // isn't a valid draft to submit, and there's no other affordance in
        // this sheet to recover from an empty selection.
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day).sort((a, b) => a - b);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  }, []);

  const setSingleDay = useCallback((day: number) => {
    dayHaptic();
    setSelectedDays([day]);
  }, []);

  const handleDayPress = useCallback(
    (day: number) => {
      if (mode === "create") {
        toggleDay(day);
      } else {
        setSingleDay(day);
      }
    },
    [mode, setSingleDay, toggleDay],
  );

  const handleCreate = useCallback(async () => {
    if (!canSubmit) return;

    const payloadBase = {
      title: trimmedTitle,
      startTime,
      endTime,
      category: trimmedCategory,
      ...(resolvedColor ? { color: resolvedColor } : {}),
      ...(goalId ? { goalId } : {}),
      isPrivate,
    };

    // ONE shared seriesId across every day the user picked — the same fan-out
    // shape as web's handleSubmit: `selectedDays.length > 1 ? generateSeriesId() : undefined`.
    const sharedSeriesId = selectedDays.length > 1 ? genId() : undefined;

    let payloads: CreateScheduleBlockInput[];
    try {
      payloads = selectedDays.map((day) =>
        createScheduleBlockSchema.parse({
          ...payloadBase,
          dayOfWeek: day,
          ...(sharedSeriesId ? { seriesId: sharedSeriesId } : {}),
        }),
      );
    } catch {
      setError("Please check the fields above and try again.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const weeklyKey = scheduleQueries.scheduleQueries.weeklyKey();
    const previous = queryClient.getQueryData<WeekSchedule>(weeklyKey);
    const optimisticEntries: ScheduleBlock[] = payloads.map((payload) => ({
      id: genId(),
      title: payload.title,
      startTime: payload.startTime,
      endTime: payload.endTime,
      dayOfWeek: payload.dayOfWeek,
      category: payload.category,
      color: payload.color ?? PLACEHOLDER_COLOR,
      isRecurring: false,
      isPrivate: payload.isPrivate ?? false,
      seriesId: payload.seriesId ?? genId(),
      goalId: payload.goalId,
    }));

    queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
      const week = { ...(existing ?? {}) };
      for (const entry of optimisticEntries) {
        week[entry.dayOfWeek] = [...(week[entry.dayOfWeek] ?? []), entry];
      }
      return week;
    });

    try {
      // ONE create call per selected day — CreateScheduleBlockInput is a
      // single dayOfWeek, there is no bulk-create endpoint. Sequential (not
      // Promise.all) so each day's outcome — real success, queued-offline,
      // or a genuine rejection — is known individually rather than only in
      // aggregate: a multi-day series can partially succeed live and
      // partially need to queue, and this needs to route each one through
      // the already-registered "schedule-block-create" outbox operation,
      // not a second parallel offline mechanism.
      const created: ScheduleBlock[] = [];
      const queuedOptimisticIds = new Set<string>();
      let rejectionErr: unknown = null;

      for (let i = 0; i < payloads.length; i++) {
        try {
          const result = await apiClient.schedule.create(payloads[i]);
          created.push(result.data);
        } catch (err) {
          if (hasResponse(err)) {
            rejectionErr = err;
            break;
          }
          await outbox.addToOutbox({
            id: genId(),
            kind: "schedule-block-create",
            payload: payloads[i],
            idempotencyKey: genId(),
            createdAt: Date.now(),
            retries: 0,
          });
          queuedOptimisticIds.add(optimisticEntries[i].id);
        }
      }

      if (rejectionErr) {
        queryClient.setQueryData(weeklyKey, previous);
        // Also invalidate on failure: if some of the per-day creates above
        // actually succeeded before one of them was rejected, those blocks
        // exist server-side even though the client-side rollback just
        // erased their optimistic entries. A refetch reconciles the cache
        // with whatever the server actually ended up with, rather than
        // silently hiding a partially-created series.
        void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
        Alert.alert("Couldn't save", "Please try again.");
        return;
      }

      if (queuedOptimisticIds.size > 0) {
        void offlineSync.refreshPendingCount();
        // Every entry that queued stays visible, tagged pending; the ones
        // that made it live already carry their real server data via the
        // invalidate below.
        queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
          const week = { ...(existing ?? {}) };
          for (const key of Object.keys(week)) {
            const dayIndex = Number(key);
            week[dayIndex] = (week[dayIndex] ?? []).map((b) =>
              queuedOptimisticIds.has(b.id) ? { ...b, pendingSync: true } : b,
            );
          }
          return week;
        });
        notify("Queued — will sync when online", "offline");
      }

      void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
      hapticCompletion();
      for (const block of created) {
        analytics.track({ name: "scheduleBlockCreated", payload: { scheduleBlockId: block.id } });
      }
      sheetRef.current?.dismiss();
    } finally {
      setIsSubmitting(false);
    }
  }, [analytics, canSubmit, category, endTime, goalId, isPrivate, resolvedColor, selectedDays, startTime, title]);

  const handleUpdate = useCallback(async () => {
    if (!canSubmit || !editingBlock) return;

    const patch: Record<string, unknown> = {
      title: trimmedTitle,
      startTime,
      endTime,
      category: trimmedCategory,
      ...(resolvedColor ? { color: resolvedColor } : {}),
      goalId: goalId || undefined,
      isPrivate,
    };
    if (scopeToApply === "single") {
      patch.dayOfWeek = selectedDays[0];
    }

    // A real series is fanned out by the SERVER (`updateMany` keyed on
    // seriesId, with dayOfWeek stripped so the days can't collapse). A
    // lookalike group has no shared seriesId for the server to key on, so the
    // fan-out happens here instead: one plain `single` update per member,
    // same shape as multi-day create. Either way `dayOfWeek` is left off, so
    // no member is moved onto another member's day.
    const fanOutClientSide = scopeToApply === "series" && linked?.kind === "lookalike";

    let payload: UpdateScheduleBlockInput;
    try {
      payload = updateScheduleBlockSchema.parse({
        ...patch,
        updateScope: fanOutClientSide ? "single" : scopeToApply,
      });
    } catch {
      setError("Please check the fields above and try again.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const weeklyKey = scheduleQueries.scheduleQueries.weeklyKey();
    const previous = queryClient.getQueryData<WeekSchedule>(weeklyKey);

    // A "series" scope touches every block sharing this seriesId, which may
    // span days this sheet never loaded into local state — same call as
    // web's use-schedule-mutations.ts, which only optimistically patches the
    // `single` case and leans on the post-success invalidate for `series`.
    if (scopeToApply === "single") {
      queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
        const week = { ...(existing ?? {}) };
        for (const key of Object.keys(week)) {
          const dayIndex = Number(key);
          week[dayIndex] = (week[dayIndex] ?? []).filter((b) => b.id !== editingBlock.id);
        }
        const targetDay = (payload.dayOfWeek ?? editingBlock.dayOfWeek) as number;
        const updated: ScheduleBlock = {
          ...editingBlock,
          ...payload,
          dayOfWeek: targetDay,
          color: payload.color ?? editingBlock.color,
        };
        week[targetDay] = [...(week[targetDay] ?? []), updated];
        return week;
      });
    }

    try {
      const targets = fanOutClientSide ? (linked?.members ?? [editingBlock]) : [editingBlock];

      // Sequential per-target, same reasoning as handleCreate: each target's
      // outcome (real success, queued-offline, genuine rejection) needs to
      // be known individually so a queued update can route through the
      // already-registered "schedule-block-update" outbox operation instead
      // of an all-or-nothing Promise.all.
      const succeededIds: string[] = [];
      const queuedIds: string[] = [];
      let rejectionErr: unknown = null;

      for (const target of targets) {
        try {
          await apiClient.schedule.update(target.id, payload);
          succeededIds.push(target.id);
        } catch (err) {
          if (hasResponse(err)) {
            rejectionErr = err;
            break;
          }
          await outbox.addToOutbox({
            id: genId(),
            kind: "schedule-block-update",
            payload: { id: target.id, data: payload },
            idempotencyKey: genId(),
            createdAt: Date.now(),
            retries: 0,
          });
          queuedIds.push(target.id);
        }
      }

      if (rejectionErr) {
        queryClient.setQueryData(weeklyKey, previous);
        // A client-side fan-out is N independent requests; some may have
        // landed before one failed, so the rollback above can restore
        // blocks to values the server no longer holds. Refetch rather than
        // leave a cache that is confidently wrong. (Same reasoning as
        // multi-day create.)
        if (fanOutClientSide) {
          void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
        }
        Alert.alert("Couldn't save", "Please try again.");
        return;
      }

      if (queuedIds.length > 0) {
        void offlineSync.refreshPendingCount();
        // Only the `single`-scope branch above patched the cache
        // optimistically — a `series` scope has nothing local to tag, so
        // the queued edit simply waits invisibly until the outbox drains
        // and the invalidate below (eventually) reconciles it.
        if (scopeToApply === "single") {
          const queuedIdSet = new Set(queuedIds);
          queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
            const week = { ...(existing ?? {}) };
            for (const key of Object.keys(week)) {
              const dayIndex = Number(key);
              week[dayIndex] = (week[dayIndex] ?? []).map((b) =>
                queuedIdSet.has(b.id) ? { ...b, pendingSync: true } : b,
              );
            }
            return week;
          });
        }
        notify("Queued — will sync when online", "offline");
      }

      void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
      hapticCompletion();
      for (const id of succeededIds) {
        analytics.track({ name: "scheduleBlockUpdated", payload: { scheduleBlockId: id } });
      }
      sheetRef.current?.dismiss();
    } finally {
      setIsSubmitting(false);
    }
  }, [
    analytics,
    canSubmit,
    category,
    editingBlock,
    endTime,
    goalId,
    isPrivate,
    linked,
    resolvedColor,
    scopeToApply,
    selectedDays,
    startTime,
    title,
  ]);

  const handleSubmit = useCallback(() => {
    void (mode === "create" ? handleCreate() : handleUpdate());
  }, [handleCreate, handleUpdate, mode]);

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      topInset={insets.top}
      onChange={handleSheetPositionChange}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enablePanDownToClose
      // Only one detent here (dynamic sizing with no `snapPoints`), and for
      // this form that's correct — it already opens at the tallest size the
      // container allows, so there is nothing to expand to and the handle's
      // job is purely drag-down-to-close. What it did need was a target big
      // enough to hit: the library's default handle is a 4pt indicator in 10pt
      // of padding, i.e. 24pt. This pads it out to 44.
      handleStyle={styles.handle}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{mode === "edit" ? "Edit time slot" : "New time slot"}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Title</Text>
          <BottomSheetTextInput
            style={[styles.input, focusedField === "title" && styles.inputFocused]}
            placeholder="e.g. Deep work"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
            onFocus={() => setFocusedField("title")}
            onBlur={() => setFocusedField(null)}
            accessibilityLabel="Time slot title"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{mode === "create" ? "Days (select multiple)" : "Day"}</Text>
          <View style={styles.dayRow}>
            {DAY_SHORT_LABELS.map((label, index) => {
              const selected = selectedDays.includes(index);
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.dayChip, selected && styles.dayChipSelected]}
                  onPress={() => handleDayPress(index)}
                  disabled={dayPickerDisabled}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? "Remove" : "Add"} ${DAYS_OF_WEEK_FULL[index]}`}
                  accessibilityState={{ selected, disabled: dayPickerDisabled }}
                >
                  <Text style={[styles.dayChipText, selected && styles.dayChipTextSelected]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {isSeriesEdit ? (
          <View style={styles.field}>
            <Text style={styles.label}>Apply changes to</Text>
            <View style={styles.scopeRow}>
              {(
                [
                  { label: "This day only", value: "single" as ScheduleUpdateScope },
                  { label: `All ${seriesBlockCount} days`, value: "series" as ScheduleUpdateScope },
                ] as const
              ).map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.scopeChip, scopeToApply === option.value && styles.scopeChipSelected]}
                  onPress={() => setUpdateScope(option.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`Apply changes to ${option.label}`}
                  accessibilityState={{ selected: scopeToApply === option.value }}
                >
                  <Text
                    style={[
                      styles.scopeChipText,
                      scopeToApply === option.value && styles.scopeChipTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Names the other days outright. "All 5 days" is not something a
                user should have to accept on trust before pressing Save on a
                change they can't undo — especially for a lookalike group,
                which the app inferred rather than being told about. */}
            <Text style={styles.scopeHint}>
              {scopeToApply === "series"
                ? `Changes ${linked?.members.map((b) => DAY_SHORT_LABELS[b.dayOfWeek]).join(", ")}. The day picker is locked while this is selected.`
                : `Leaves the other ${seriesBlockCount - 1} day${seriesBlockCount - 1 === 1 ? "" : "s"} untouched.`}
            </Text>
          </View>
        ) : null}

        {/*
          Stacked, not side-by-side: TimePicker's three wheel columns (hour +
          minute + AM/PM) hug roughly 200px of intrinsic content width (see
          its own styles.wheel/wheelNarrow), which doesn't fit two-up next to
          each other on a ~335-390pt sheet content width (iPhone SE through a
          standard 6.1" phone, after this sheet's own horizontal padding) —
          two of them side by side would overflow each column's flexed slot,
          since a plain RN View doesn't clip overflowing children by default.
          Full width, one above the other, guarantees both always render
          intact regardless of device width.
        */}
        <View style={styles.field}>
          <Text style={styles.label}>Start time</Text>
          <TimePicker value={startTime} onChange={setStartTime} />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>End time</Text>
          <TimePicker value={endTime} onChange={setEndTime} />
        </View>
        {!timeRangeValid ? <Text style={styles.fieldError}>End time must be after start time.</Text> : null}

        {/* Goal first — see the header note. `goals` is rendered as-is; the
            category field below is never consulted here. */}
        <View style={styles.field}>
          <Text style={styles.label}>Link to goal (optional)</Text>
          <View style={styles.goalRow}>
            <TouchableOpacity
              style={[styles.goalChip, goalId === "" && styles.goalChipSelected]}
              onPress={handleClearGoal}
              accessibilityRole="button"
              accessibilityLabel="No goal"
              accessibilityState={{ selected: goalId === "" }}
            >
              <Text style={[styles.goalChipText, goalId === "" && styles.goalChipTextSelected]}>No goal</Text>
            </TouchableOpacity>
            {isGoalsPending ? (
              <Text style={styles.goalLoading}>Loading goals…</Text>
            ) : (
              goals.map((goal) => {
                const selected = goalId === goal.id;
                return (
                  <TouchableOpacity
                    key={goal.id}
                    style={[styles.goalChip, selected && styles.goalChipSelected]}
                    onPress={() => handlePickGoal(goal)}
                    accessibilityRole="button"
                    accessibilityLabel={`Link to goal ${goal.title}, category ${goal.category}`}
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.goalChipSwatch, { backgroundColor: goal.color }]} />
                    <Text style={[styles.goalChipText, selected && styles.goalChipTextSelected]} numberOfLines={1}>
                      {goal.title}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
          {/* An empty goal list used to render as the lone "No goal" chip and
              nothing else, which looks like a list that failed to load. Say
              which it is. */}
          {!isGoalsPending && goals.length === 0 ? (
            <Text style={styles.goalHint}>
              No active goals to link yet. You can still save this slot and link one later.
            </Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryInputRow}>
            {resolvedColor ? <View style={[styles.categorySwatch, { backgroundColor: resolvedColor }]} /> : null}
            <BottomSheetTextInput
              style={[
                styles.input,
                styles.categoryInput,
                focusedField === "category" && styles.inputFocused,
              ]}
              placeholder="e.g. Work"
              placeholderTextColor={colors.mutedForeground}
              value={category}
              onChangeText={(next) => {
                setCategory(next);
                // Now the user's value, so a later goal pick must not
                // overwrite it.
                setAutoFilledCategory(null);
              }}
              onFocus={() => setFocusedField("category")}
              onBlur={() => setFocusedField(null)}
              accessibilityLabel="Time slot category"
            />
          </View>
          {autoFilledCategory !== null && category.trim() === autoFilledCategory ? (
            <Text style={styles.goalHint}>Filled in from the goal you linked. Edit it if you like.</Text>
          ) : null}
        </View>

        {/* Same intent as the web modal's private checkbox: hide this block
            (and time tracked against it) from anyone the user has shared
            their workspace with. Only the owner ever sees it. */}
        <TouchableOpacity
          style={styles.privateRow}
          onPress={() => setIsPrivate((prev) => !prev)}
          accessibilityRole="checkbox"
          accessibilityLabel="Private to me"
          accessibilityState={{ checked: isPrivate }}
        >
          <View style={[styles.checkbox, isPrivate && styles.checkboxChecked]}>
            {isPrivate ? <Icon name="check" size={14} color={colors.primaryForeground} /> : null}
          </View>
          <View style={styles.privateCopy}>
            <Text style={styles.privateTitle}>Private to me</Text>
            <Text style={styles.privateDescription}>
              Hide this block from anyone you've shared your workspace with.
            </Text>
          </View>
          <Icon name="eye-off" size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={mode === "edit" ? "Save changes" : "Create time slot"}
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.submitText}>
              {isSubmitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create"}
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  // 20 + 4 + 20 = the 44pt minimum touch target.
  handle: {
    paddingVertical: spacing.xl,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: 40,
    height: 4,
    borderRadius: radii.full,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    // paddingBottom is applied at the call site — it has to add the bottom
    // safe-area inset, which isn't a static value.
    gap: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    // radii.lg (control role) — matches the Cancel/Save buttons below and
    // BlockDetailSheet's Edit/Delete pair; this field previously used
    // radii.md (chip role), which read as a smaller-radius mismatch against
    // every other control-shaped surface in the two schedule sheets.
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.select({ ios: spacing.md, android: spacing.sm, default: spacing.sm + spacing.xxs }),
    fontSize: 16,
    color: colors.foreground,
  },
  inputFocused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  dayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  dayChipSelected: {
    backgroundColor: colors.foreground,
  },
  dayChipText: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  dayChipTextSelected: {
    color: colors.white,
  },
  scopeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  scopeChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
  },
  scopeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  scopeChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
    textAlign: "center",
  },
  scopeChipTextSelected: {
    color: colors.primaryForeground,
  },
  scopeHint: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  fieldError: {
    color: colors.destructive,
    fontSize: 12,
    marginTop: -spacing.sm,
  },
  categoryInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  categoryInput: {
    flex: 1,
  },
  categorySwatch: {
    width: 14,
    height: 14,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  goalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: 180,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  goalChipSelected: {
    backgroundColor: colors.primary,
  },
  goalChipSwatch: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
  },
  goalChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  goalChipTextSelected: {
    color: colors.primaryForeground,
  },
  goalLoading: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingVertical: spacing.sm,
  },
  goalHint: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  privateRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xxs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xxs,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  privateCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  privateTitle: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.foreground,
  },
  privateDescription: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  cancelButton: {
    flex: 1,
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  cancelText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  submitButton: {
    flex: 1,
    minHeight: minTouchTarget,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
});
