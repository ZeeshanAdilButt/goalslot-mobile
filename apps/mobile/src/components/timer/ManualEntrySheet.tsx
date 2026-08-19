// Bottom sheet for logging time that was never tracked live — "I forgot to
// start the timer, but I did 45 minutes of X this morning."
//
// Mobile-only port of dw-time-web's ManualEntryModal
// (goal-slot-web/src/features/time-tracker/components/manual-entry-modal.tsx):
// task/title, date, start time, a duration (six preset chips + a free-entry
// number field), and an optional goal/task link. No backend work was needed
// for this — POST /time-entries (CreateTimeEntryDto) already accepts every
// field this sheet sends; it's the same endpoint the live Stop button
// (timer.tsx's handleStop) and the tracking voice command
// (TrackerVoiceButton.tsx's logTime) already call, with no live session
// required.
//
// SHELL follows ScheduleBlockSheet.tsx / EditTaskSheet.tsx: a
// @gorhom/bottom-sheet BottomSheetModal behind a present()/dismiss()
// imperative handle, submitted inline (setError + a Cancel/Save footer row),
// with a network-looking failure queued to the offline outbox exactly like
// every other create flow in this app (ScheduleBlockSheet's handleCreate,
// timer.tsx's handleStop, TrackerVoiceButton's logTime) — never `Alert.alert`,
// this app's standing rule (see ConfirmDialog.tsx's own header).
//
// GOAL/TASK LINK reuses TrackingPicker.tsx wholesale rather than building a
// second goal/task chip list — it already does search, the goal->task
// cascade, and "just track time" clearing, and none of that is tied to a
// live session: its callbacks are plain (Goal) => void / (Task) => void, so
// this sheet just points them at its own local state instead of the timer
// store. `mode="prestart"` (its default) fits: this is "setting up" an entry
// the same way it's "setting up" the next run before Start.
//
// NO CATEGORY FIELD. Web's modal has one, but it is never actually sent —
// its own handleSubmit only sends taskName/taskId/taskTitle/startedAt/
// duration/date/notes/goalId/scheduleBlockId, and CreateTimeEntryDto
// (goal-slot-api/src/modules/time-entries/dto/time-entries.dto.ts) has no
// `category` property to receive one; on web, category only ever drives
// which Categories inline-create-task uses. This sheet has no inline
// create-task flow, so there is nothing category-shaped left for it to do —
// it is shown read-only, one line under the goal/task field once a goal is
// linked (the same "goal implies its category" line TrackingTarget.tsx
// already renders on the live hero card), never as a second editable input
// with nowhere to send its value.
//
// NO scheduleBlockId. Web's schedule auto-bind (§Schedule auto-bind in the
// web file) snaps the form to whatever block covers the chosen date/time.
// That is a genuinely new feature, not a port of existing mobile behaviour —
// out of scope here; a manually-dated entry can still be linked to a goal or
// task by hand.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createTimeEntrySchema,
  formatDuration,
  genId,
  getLocalDateString,
  getLocalTimeString,
  isRetryable,
  type CreateTimeEntryInput,
  type Goal,
  type Task,
} from "@goalslot/shared";

import { TrackingPicker } from "@/components/timer/TrackingPicker";
import { DatePicker } from "@/components/ui/DatePicker";
import { parseDateKey, formatDateKey } from "@/components/ui/calendar-math";
import { Icon } from "@/components/ui/Icon";
import { TimePicker } from "@/components/ui/TimePicker";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { hapticCompletion } from "@/lib/haptics";
import { offlineSync, outbox } from "@/lib/offline";
import { isPlanLimitError } from "@/lib/plan-limit";
import { goalQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

export interface ManualEntrySheetRef {
  present: () => void;
  dismiss: () => void;
}

const DURATION_PRESETS_MIN = [15, 30, 45, 60, 90, 120];
const DEFAULT_DURATION_MIN = 30;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const DATE_OPTIONS: Array<{ label: string; daysFromToday: number }> = [
  { label: "Today", daysFromToday: 0 },
  { label: "Yesterday", daysFromToday: -1 },
];

function isPresetDate(date: string): boolean {
  return DATE_OPTIONS.some((option) => date === getLocalDateString(addDays(new Date(), option.daysFromToday)));
}

/** Combines a "YYYY-MM-DD" key and an "HH:mm" clock time into a local Date — same inputs/output shape as web's `buildLocalDateFromParts`, built from this app's own calendar-math + shared time helpers instead of duplicating that logic. */
function buildLocalDate(dateKey: string, time: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  const [hStr, mStr] = time.split(":");
  const hours = Number(hStr) || 0;
  const minutes = Number(mStr) || 0;
  return new Date(year, month, day, hours, minutes);
}

export const ManualEntrySheet = forwardRef<ManualEntrySheetRef, object>(function ManualEntrySheet(_props, ref) {
  const sheetRef = useRef<BottomSheetModal>(null);
  // See the hook's own header for why this is needed at all — the library
  // doesn't wire Android's hardware back button to the sheet on its own.
  const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);

  // See ScheduleBlockSheet.tsx for the full reasoning. Short version: this
  // sheet is portalled to the app root, outside timer.tsx's own
  // `<SafeAreaView edges={["top"]}>`, and Android is edge-to-edge, so nothing
  // between this content and the physical edges of the display is accounted
  // for unless the sheet accounts for it itself.
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(getLocalDateString());
  const [customDatePickerOpen, setCustomDatePickerOpen] = useState(false);
  const [startTime, setStartTime] = useState(getLocalTimeString());
  const [durationText, setDurationText] = useState(String(DEFAULT_DURATION_MIN));
  const [goalId, setGoalId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedField, setFocusedField] = useState<"title" | "duration" | null>(null);

  // Same cache-hit reasoning as ScheduleBlockSheet's own goalsQuery: this
  // sheet only ever opens from the Timer screen, which already has both of
  // these lists live (its own TrackingPicker instance reads the identical
  // unfiltered queries), so this is a second subscriber, not a second
  // request.
  const { data: goals = [] } = useQuery(goalQueries.list());
  const { data: tasks = [] } = useQuery(taskQueries.list());

  useImperativeHandle(
    ref,
    () => ({
      present: () => {
        setTitle("");
        setDate(getLocalDateString());
        setCustomDatePickerOpen(false);
        setStartTime(getLocalTimeString());
        setDurationText(String(DEFAULT_DURATION_MIN));
        setGoalId(null);
        setTaskId(null);
        setError(null);
        sheetRef.current?.present();
      },
      dismiss: () => sheetRef.current?.dismiss(),
    }),
    [],
  );

  const selectedGoal = useMemo(() => goals.find((g) => g.id === goalId) ?? null, [goals, goalId]);
  const selectedTask = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId]);

  const trimmedTitle = title.trim();
  const trimmedDuration = durationText.trim();
  const parsedDuration = trimmedDuration.length > 0 ? Number(trimmedDuration) : NaN;
  const durationValid = Number.isFinite(parsedDuration) && parsedDuration >= 1;
  const canSubmit = !isSubmitting && trimmedTitle.length > 0 && durationValid;
  const customDateSelected = !isPresetDate(date);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  const handleCancel = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  /** Picking a task implies its goal — same rule timer.tsx's own handlePickTask follows — and fills the title in from it, matching web's handleTaskIdChange (the title stays a plain editable field afterward, so this is a starting point, not a lock). */
  const handlePickTask = useCallback((task: Task) => {
    setTaskId(task.id);
    setGoalId(task.goalId ?? null);
    setTitle(task.title);
    setPickerOpen(false);
  }, []);

  /** A task only makes sense under its own goal — same rule timer.tsx's handlePickGoal follows — so switching goals drops a task that belongs to a different one, but keeps one that's already this goal's own. */
  const handlePickGoal = useCallback(
    (goal: Goal) => {
      setGoalId(goal.id);
      setTaskId((prev) => {
        const current = prev ? tasks.find((t) => t.id === prev) : null;
        return current && current.goalId === goal.id ? prev : null;
      });
    },
    [tasks],
  );

  const handlePickNone = useCallback(() => {
    setGoalId(null);
    setTaskId(null);
    setPickerOpen(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    const startedAt = buildLocalDate(date, startTime).toISOString();

    let payload: CreateTimeEntryInput;
    try {
      payload = createTimeEntrySchema.parse({
        taskName: trimmedTitle,
        // taskTitle only travels alongside a real taskId — same convention
        // timer.tsx's handleStop and TrackerVoiceButton's logTime already
        // follow (see UNRESOLVED_TARGET_LABEL's comment in timer.tsx): it's
        // the denormalised snapshot of a REAL task's title, not a second copy
        // of whatever free text the user typed.
        ...(taskId ? { taskId, taskTitle: trimmedTitle } : {}),
        ...(goalId ? { goalId } : {}),
        duration: parsedDuration,
        date,
        startedAt,
        notes: "Manual entry",
      });
    } catch {
      setError("Please check the fields above and try again.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // One key, reused if this attempt has to queue below — same reasoning as
    // every other time-entry create in this app (timer.tsx's handleStop,
    // TrackerVoiceButton's logTime): a client-side timeout after the server
    // already committed must not turn into a second row on replay.
    const idempotencyKey = genId();

    try {
      await apiClient.timeEntries.create(payload, { idempotencyKey });
      hapticCompletion();
      void queryClient.invalidateQueries({ queryKey: timeEntryQueries.timeEntryQueries.all });
      // The goal's logged hours move with the entry — Reports, Today and the
      // Goals screen all read it. Same conditional invalidate handleStop and
      // logTime both already do.
      if (goalId) {
        void queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all });
      }
      sheetRef.current?.dismiss();
    } catch (err) {
      if (isRetryable(err)) {
        await outbox.addToOutbox({
          id: genId(),
          kind: "time-entry-create",
          payload,
          idempotencyKey,
          createdAt: Date.now(),
          retries: 0,
        });
        void offlineSync.refreshPendingCount();
        notify(`${formatDuration(parsedDuration)} saved offline — will sync the next time you're online.`, "offline");
        sheetRef.current?.dismiss();
        return;
      }
      console.error(err);
      setError(
        isPlanLimitError(err)
          ? "You've reached today's plan limit for tracked sessions. Upgrade or wait for a new day to add this."
          : getErrorMessage(err, "Couldn't save this entry. Please try again."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, date, goalId, parsedDuration, startTime, taskId, trimmedTitle]);

  return (
    <>
      <BottomSheetModal
        ref={sheetRef}
        enableDynamicSizing
        topInset={insets.top}
        onChange={handleSheetPositionChange}
        backdropComponent={renderBackdrop}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        // adjustPan, not adjustResize — see QuickAddSheet for the full
        // reasoning: this app runs edge-to-edge, where Android ignores
        // "adjustResize" entirely, so the lift has to come from the library
        // itself rather than the OS resizing the window.
        android_keyboardInputMode="adjustPan"
        enablePanDownToClose
        handleStyle={styles.handle}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Manual time entry</Text>

          <View style={styles.field}>
            <Text style={styles.label}>What did you work on?</Text>
            <BottomSheetTextInput
              style={[styles.input, focusedField === "title" && styles.inputFocused]}
              placeholder="e.g. Deep work"
              placeholderTextColor={colors.mutedForeground}
              value={title}
              onChangeText={setTitle}
              onFocus={() => setFocusedField("title")}
              onBlur={() => setFocusedField(null)}
              accessibilityLabel="What you worked on"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Link to a goal or task (optional)</Text>
            <TouchableOpacity
              style={styles.linkField}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={
                selectedTask
                  ? `Task: ${selectedTask.title}. Change it`
                  : selectedGoal
                    ? `Goal: ${selectedGoal.title}. Change it`
                    : "No goal or task linked. Choose one"
              }
            >
              <Text style={styles.linkFieldText} numberOfLines={1}>
                {selectedTask?.title ?? selectedGoal?.title ?? "None — tap to link"}
              </Text>
              <Icon name="chevron" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            {/* Informational only — see this file's header for why category
                has no field of its own to submit into. */}
            {selectedGoal?.category ? (
              <Text style={styles.hint}>Category: {selectedGoal.category}</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Date</Text>
            <View style={styles.dateRow}>
              {DATE_OPTIONS.map((option) => {
                const optionDate = getLocalDateString(addDays(new Date(), option.daysFromToday));
                const selected = date === optionDate;
                return (
                  <TouchableOpacity
                    key={option.label}
                    style={[styles.dateChip, selected && styles.dateChipSelected]}
                    onPress={() => {
                      setDate(optionDate);
                      setCustomDatePickerOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Set date to ${option.label}`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.dateChipText, selected && styles.dateChipTextSelected]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.dateChip, customDateSelected && styles.dateChipSelected]}
                onPress={() => setCustomDatePickerOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityLabel={customDateSelected ? `Custom date, ${formatDateKey(date)}` : "Pick a custom date"}
                accessibilityState={{ selected: customDateSelected, expanded: customDatePickerOpen }}
              >
                <View style={styles.dateChipContent}>
                  <Icon
                    name="schedule"
                    size={14}
                    color={customDateSelected ? colors.primaryForeground : colors.mutedForeground}
                  />
                  <Text style={[styles.dateChipText, customDateSelected && styles.dateChipTextSelected]}>
                    {customDateSelected ? formatDateKey(date) : "Custom…"}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
            {customDatePickerOpen ? (
              <View style={styles.customDatePicker}>
                <DatePicker value={date} onChange={setDate} />
              </View>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Start time</Text>
            <TimePicker value={startTime} onChange={setStartTime} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Duration</Text>
            <View style={styles.durationRow}>
              {DURATION_PRESETS_MIN.map((min) => {
                const selected = trimmedDuration === String(min);
                return (
                  <TouchableOpacity
                    key={min}
                    style={[styles.durationChip, selected && styles.durationChipSelected]}
                    onPress={() => setDurationText(String(min))}
                    accessibilityRole="button"
                    accessibilityLabel={`Set duration to ${formatDuration(min)}`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.durationChipText, selected && styles.durationChipTextSelected]}>
                      {formatDuration(min)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <BottomSheetTextInput
              style={[styles.input, styles.durationInput, focusedField === "duration" && styles.inputFocused]}
              placeholder="Minutes"
              placeholderTextColor={colors.mutedForeground}
              value={durationText}
              onChangeText={setDurationText}
              onFocus={() => setFocusedField("duration")}
              onBlur={() => setFocusedField(null)}
              keyboardType="numeric"
              accessibilityLabel="Duration in minutes"
            />
            {!durationValid ? <Text style={styles.fieldError}>Must be at least 1 minute.</Text> : null}
          </View>

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
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityLabel="Add time entry"
              accessibilityState={{ disabled: !canSubmit }}
            >
              <Text style={styles.submitText}>{isSubmitting ? "Adding…" : "Add Entry"}</Text>
            </TouchableOpacity>
          </View>
        </BottomSheetScrollView>
      </BottomSheetModal>

      {/* Its own Modal (see TrackingPicker.tsx), so it layers fine on top of
          the BottomSheetModal above without needing to be a second bottom
          sheet nested inside the first. `mode="prestart"` — its default —
          because this is "setting up" a not-yet-saved entry, the same job
          it does before a live session's own Start. */}
      <TrackingPicker
        visible={pickerOpen}
        tasks={tasks}
        goals={goals}
        selectedGoalId={goalId}
        selectedTaskId={taskId}
        onPickTask={handlePickTask}
        onPickGoal={handlePickGoal}
        onPickNone={handlePickNone}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
});

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
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
  linkField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
  },
  linkFieldText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
    marginRight: spacing.sm,
  },
  hint: {
    ...typography.caption,
    textTransform: "none",
    letterSpacing: 0,
    color: colors.mutedForeground,
  },
  dateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  dateChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md + spacing.xxs,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  dateChipSelected: {
    backgroundColor: colors.primary,
  },
  dateChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  dateChipTextSelected: {
    color: colors.primaryForeground,
  },
  dateChipContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  customDatePicker: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.sm,
  },
  durationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  durationChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  durationChipSelected: {
    backgroundColor: colors.primary,
  },
  durationChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  durationChipTextSelected: {
    color: colors.primaryForeground,
  },
  durationInput: {
    marginTop: spacing.sm,
  },
  fieldError: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
  error: {
    ...typography.bodySmall,
    color: colors.destructive,
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
