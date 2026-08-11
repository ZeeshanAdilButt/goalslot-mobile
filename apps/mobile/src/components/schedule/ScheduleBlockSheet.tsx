// The full schedule-block editor: title, one-or-many days, real start/end
// time, category, an optional goal link, and a private toggle. This is what
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
  minutesToTime,
  timeToMinutes,
  updateScheduleBlockSchema,
  type CreateScheduleBlockInput,
  type ScheduleBlock,
  type ScheduleUpdateScope,
  type UpdateScheduleBlockInput,
  type WeekSchedule,
} from "@goalslot/shared";

import { apiClient } from "@/lib/api-client";
import { hapticCompletion } from "@/lib/haptics";
import { categoryQueries, goalQueries, scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
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
  const analytics = useAnalytics();

  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(DEFAULT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_END_TIME);
  const [category, setCategory] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([0]);
  const [goalId, setGoalId] = useState("");
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

  // A block is "in a series" when other blocks in the week share its
  // seriesId — same derivation as web's schedule-page.tsx `seriesBlockCount`
  // (`allBlocks.filter(b => b.seriesId === editingBlock.seriesId).length`).
  const seriesBlockCount = useMemo(() => {
    if (!editingBlock || !weeklyQuery.data) return 0;
    return Object.values(weeklyQuery.data)
      .flat()
      .filter((b) => b.seriesId === editingBlock.seriesId).length;
  }, [editingBlock, weeklyQuery.data]);
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
      // single dayOfWeek, there is no bulk-create endpoint.
      const created = await Promise.all(
        payloads.map((payload) => apiClient.schedule.create(payload).then((res) => res.data)),
      );
      void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
      hapticCompletion();
      for (const block of created) {
        analytics.track({ name: "scheduleBlockCreated", payload: { scheduleBlockId: block.id } });
      }
      sheetRef.current?.dismiss();
    } catch {
      queryClient.setQueryData(weeklyKey, previous);
      // Also invalidate on failure: if some of the per-day creates in the
      // Promise.all above actually succeeded before one of them rejected,
      // those blocks exist server-side even though the client-side rollback
      // just erased their optimistic entries. A refetch reconciles the
      // cache with whatever the server actually ended up with, rather than
      // silently hiding a partially-created series.
      void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
      Alert.alert("Couldn't save", "Please try again.");
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

    let payload: UpdateScheduleBlockInput;
    try {
      payload = updateScheduleBlockSchema.parse({ ...patch, updateScope: scopeToApply });
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
      await apiClient.schedule.update(editingBlock.id, payload);
      void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
      hapticCompletion();
      analytics.track({ name: "scheduleBlockUpdated", payload: { scheduleBlockId: editingBlock.id } });
      sheetRef.current?.dismiss();
    } catch {
      queryClient.setQueryData(weeklyKey, previous);
      Alert.alert("Couldn't save", "Please try again.");
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
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      enablePanDownToClose
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
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
                  { label: `All ${seriesBlockCount} linked days`, value: "series" as ScheduleUpdateScope },
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
              onChangeText={setCategory}
              onFocus={() => setFocusedField("category")}
              onBlur={() => setFocusedField(null)}
              accessibilityLabel="Time slot category"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Link to goal (optional)</Text>
          <View style={styles.goalRow}>
            <TouchableOpacity
              style={[styles.goalChip, goalId === "" && styles.goalChipSelected]}
              onPress={() => setGoalId("")}
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
                    onPress={() => setGoalId(goal.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Link to goal ${goal.title}`}
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
    paddingBottom: spacing.xxl,
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
    borderRadius: radii.md,
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
    borderRadius: radii.md,
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
    borderRadius: radii.md,
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
    borderRadius: radii.md,
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
