// "Import to my account" bottom sheet, opened from the Import button on
// library/[id].tsx. Mobile's equivalent of goal-slot-web's
// `features/library/components/import-dialog.tsx` — same three opt-in
// sections (schedule/goals/tasks, each defaulted to whichever the template
// actually has) and the same destructive "replace my existing data" option,
// but built as a bottom sheet rather than a centered dialog, matching this
// app's own idiom for a short, single-purpose action launched from a detail
// screen (see AssignInstructionSheet.tsx).
//
// Two deliberate departures from web's dialog:
//   1. No text input, so this is built directly on `BottomSheetModal`
//      rather than `KeyboardSheet` — see that file's own header for why a
//      sheet with nothing for the keyboard to cover doesn't need the wrapper.
//   2. Web double-confirms "replace existing data" with a SECOND checkbox
//      inside the same dialog ("Yes, I understand this will delete...").
//      This app already has a purpose-built control for exactly that shape
//      of decision — ConfirmDialog, this repo's Alert.alert replacement (see
//      CLAUDE.md: never use Alert.alert here) — so the toggle opens
//      ConfirmDialog instead of growing a second inline checkbox. Same
//      protection (an explicit, separate "yes, really" beat before the
//      destructive flag can be set), native idiom.
//
// No text input also means no `reset()` needs to run on dismiss to clear a
// typed value — only the derived toggle state resets, and only because the
// PARENT (library/[id].tsx) never unmounts this between opens for the same
// template, so a prior open's choices would otherwise leak into the next.

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

import { type TemplateDefinition, type TemplateImportOptions } from "@goalslot/shared";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { hapticLight } from "@/lib/haptics";
import { goalQueries, scheduleQueries, taskQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, radii, spacing, typography } from "@/theme/tokens";

export interface ImportTemplateSheetProps {
  /** Loaded, non-null: the parent only mounts this sheet once the template detail query has data. */
  template: TemplateDefinition;
  /** Called after a successful import, with the summary the caller can toast/display. */
  onImported?: (result: { goalsCreated: number; scheduleBlocksCreated: number; tasksCreated: number }) => void;
}

function summarize(result: { goalsCreated: number; scheduleBlocksCreated: number; tasksCreated: number }): string {
  const parts: string[] = [];
  if (result.scheduleBlocksCreated > 0) parts.push(`${result.scheduleBlocksCreated} schedule blocks`);
  if (result.goalsCreated > 0) parts.push(`${result.goalsCreated} goals`);
  if (result.tasksCreated > 0) parts.push(`${result.tasksCreated} tasks`);
  return parts.length > 0 ? `Imported ${parts.join(", ")}` : "Nothing new to import";
}

export const ImportTemplateSheet = forwardRef<BottomSheetModal, ImportTemplateSheetProps>(
  function ImportTemplateSheet({ template, onImported }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    // Same fresh-handle-every-render reasoning as AssignInstructionSheet — no
    // dependency array on purpose, see that file's comment for the failure
    // mode a memoized forwarder produces here.
    useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal);
    const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);

    const hasSchedule = (template.schedule?.length ?? 0) > 0;
    const hasGoals = (template.goals?.length ?? 0) > 0;
    const hasTasks = (template.tasks?.length ?? 0) > 0;

    const [importSchedule, setImportSchedule] = useState(hasSchedule);
    const [importGoals, setImportGoals] = useState(hasGoals);
    const [importTasks, setImportTasks] = useState(hasTasks);
    const [replaceExisting, setReplaceExisting] = useState(false);
    const [confirmingReplace, setConfirmingReplace] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = useCallback(() => {
      setImportSchedule(hasSchedule);
      setImportGoals(hasGoals);
      setImportTasks(hasTasks);
      setReplaceExisting(false);
      setConfirmingReplace(false);
      setSubmitting(false);
      setError(null);
    }, [hasSchedule, hasGoals, hasTasks]);

    const nothingSelected = !importSchedule && !importGoals && !importTasks;
    const canSubmit = !nothingSelected && !submitting;

    const handleToggleReplace = useCallback((next: boolean) => {
      if (next) {
        setConfirmingReplace(true);
      } else {
        setReplaceExisting(false);
      }
    }, []);

    const affectedSections = useMemo(() => {
      const labels = [
        importGoals && "goals",
        importSchedule && "schedule blocks",
        importTasks && "tasks",
      ].filter(Boolean) as string[];
      return labels.length > 0 ? labels.join(", ") : "selected data";
    }, [importGoals, importSchedule, importTasks]);

    const handleSubmit = useCallback(async () => {
      if (nothingSelected) return;
      setSubmitting(true);
      setError(null);
      hapticLight();

      const options: TemplateImportOptions = {
        schedule: importSchedule,
        goals: importGoals,
        tasks: importTasks,
        replaceExisting,
      };

      try {
        const response = await apiClient.templates.import(template.id, options);
        // Every section the import could have touched is stale now,
        // regardless of which ones were actually selected — mirrors
        // goal-slot-web's useImportTemplate onSuccess (features/library/hooks.ts).
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: goalQueries.goalQueries.all }),
          queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() }),
          queryClient.invalidateQueries({ queryKey: taskQueries.taskQueries.all }),
        ]);
        notify(summarize(response.data), "success");
        onImported?.(response.data);
        sheetRef.current?.dismiss();
      } catch (err) {
        setError(getErrorMessage(err, "Import failed. Try again."));
      } finally {
        setSubmitting(false);
      }
    }, [nothingSelected, importSchedule, importGoals, importTasks, replaceExisting, template.id, onImported]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    return (
      <>
        {/* No text input in this sheet (three Switches, plus the submit
            button) — nothing here for the Android soft keyboard to cover, so
            this deliberately stays on BottomSheetModal directly instead of
            KeyboardSheet. See this file's header comment. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <BottomSheetModal
          ref={sheetRef}
          // eslint-disable-next-line no-restricted-syntax
          snapPoints={["75%"]}
          onChange={handleSheetPositionChange}
          onDismiss={reset}
          backdropComponent={renderBackdrop}
          enablePanDownToClose
          handleIndicatorStyle={styles.handleIndicator}
          backgroundStyle={styles.sheetBackground}
        >
          <BottomSheetView style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">
                Import to my account
              </Text>
              <Text style={styles.subtitle}>Choose what to bring in. You can edit everything after import.</Text>
            </View>

            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <ToggleRow
              icon="schedule"
              label="Schedule blocks"
              sublabel={
                hasSchedule
                  ? `${template.schedule?.length} recurring blocks across the week`
                  : "This template has no schedule"
              }
              value={importSchedule}
              disabled={!hasSchedule || submitting}
              onValueChange={setImportSchedule}
            />
            <ToggleRow
              icon="goals"
              label="Goals"
              sublabel={
                hasGoals
                  ? `Create ${template.goals?.length} goals the blocks and tasks point at`
                  : "This template has no goals"
              }
              value={importGoals}
              disabled={!hasGoals || submitting}
              onValueChange={setImportGoals}
            />
            <ToggleRow
              icon="tasks"
              label="Starter tasks"
              sublabel={hasTasks ? `${template.tasks?.length} initial tasks to seed the goals` : "This template has no tasks"}
              value={importTasks}
              disabled={!hasTasks || submitting}
              onValueChange={setImportTasks}
            />

            <View style={styles.divider} />

            <ToggleRow
              icon="alert"
              label="Replace my existing data"
              sublabel="Deletes your existing goals, schedule blocks, and tasks for whichever sections are selected above, then re-imports. Cannot be undone."
              value={replaceExisting}
              disabled={submitting}
              destructive
              onValueChange={handleToggleReplace}
            />

            <Button
              label={replaceExisting ? "Replace and import" : "Import to my account"}
              variant={replaceExisting ? "destructive" : "brand"}
              onPress={() => void handleSubmit()}
              disabled={!canSubmit}
              loading={submitting}
              fullWidth
              style={styles.submitButton}
            />
          </BottomSheetView>
        </BottomSheetModal>

        <ConfirmDialog
          visible={confirmingReplace}
          title="Replace existing data?"
          description={`This deletes your existing ${affectedSections} before re-importing from this template. Cannot be undone.`}
          icon="alert"
          destructive
          confirmLabel="Yes, replace"
          onConfirm={() => {
            setReplaceExisting(true);
            setConfirmingReplace(false);
          }}
          onCancel={() => setConfirmingReplace(false)}
        />
      </>
    );
  },
);

function ToggleRow({
  icon,
  label,
  sublabel,
  value,
  disabled,
  destructive,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  sublabel: string;
  value: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}>
      <View style={[styles.toggleIcon, destructive && value && styles.toggleIconDestructive]}>
        <Icon name={icon} size={16} color={destructive && value ? colors.destructive : colors.mutedForeground} />
      </View>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSublabel}>{sublabel}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
      />
    </View>
  );
}

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
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xxs,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  error: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    backgroundColor: colors.destructiveMuted,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xxs,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  toggleRowDisabled: {
    opacity: 0.5,
  },
  toggleIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleIconDestructive: {
    backgroundColor: colors.destructiveMuted,
  },
  toggleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  toggleLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  toggleSublabel: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
});
