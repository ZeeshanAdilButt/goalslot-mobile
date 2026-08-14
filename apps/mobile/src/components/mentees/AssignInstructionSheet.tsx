// "Assign an instruction" form, opened from a mentee row on the Mentees
// screen. One instruction at a time, same shape goal-slot-api's
// AssignInstructionDto expects: a required title (<=200 chars) and an
// optional note (<=200 chars) — see packages/shared/src/api/instructions.ts.
//
// A bottom sheet rather than a full screen, matching NewConversationSheet's
// choice for the same reason: this is a short, single-purpose form launched
// from a list row, not a destination anyone navigates to directly.

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

import { hasResponse } from "@goalslot/shared";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { apiClient, notify } from "@/lib/api-client";
import { hapticLight } from "@/lib/haptics";
import { instructionsQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, radii, spacing, typography } from "@/theme/tokens";

const TITLE_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 200;

function describeAssignError(err: unknown, menteeName: string): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 403) {
    return `You can't assign instructions to ${menteeName} — that sharing connection isn't active any more.`;
  }
  if (!hasResponse(err)) {
    return "You're offline. Check your connection and try again.";
  }
  return "Couldn't assign that instruction. Try again.";
}

export interface AssignInstructionSheetProps {
  /** Who the instruction is for. Fields render disabled with nothing to submit while this is null. */
  mentee: { id: string; name: string } | null;
}

export const AssignInstructionSheet = forwardRef<BottomSheetModal, AssignInstructionSheetProps>(
  function AssignInstructionSheet({ mentee }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    useImperativeHandle(ref, () => sheetRef.current as BottomSheetModal, []);
    const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);

    const [title, setTitle] = useState("");
    const [note, setNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = useCallback(() => {
      setTitle("");
      setNote("");
      setError(null);
      setSubmitting(false);
    }, []);

    const canSubmit = Boolean(mentee) && title.trim().length > 0 && !submitting;

    const handleSubmit = useCallback(async () => {
      if (!mentee || title.trim().length === 0) return;
      setSubmitting(true);
      setError(null);
      hapticLight();

      try {
        await apiClient.instructions.assign({
          assigneeId: mentee.id,
          title: title.trim(),
          ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        });
        // The assigner's own "what have I sent" list — see the mentee detail
        // screen's Instructions section.
        await queryClient.invalidateQueries({
          queryKey: instructionsQueries.instructionsQueries.assignedByMe(),
        });
        notify(`Instruction sent to ${mentee.name}`, "success");
        sheetRef.current?.dismiss();
      } catch (err) {
        setError(describeAssignError(err, mentee.name));
      } finally {
        setSubmitting(false);
      }
    }, [mentee, note, title]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    return (
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={["55%"]}
        onChange={handleSheetPositionChange}
        onDismiss={reset}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetView style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Assign an instruction
            </Text>
            <Text style={styles.subtitle}>
              {mentee ? `Sent to ${mentee.name}. They'll get a reminder to complete it.` : "Sent to your mentee."}
            </Text>
          </View>

          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}

          <TextField
            label="What should they do?"
            placeholder="Log time daily this week"
            value={title}
            onChangeText={setTitle}
            maxLength={TITLE_MAX_LENGTH}
            editable={!submitting}
            returnKeyType="next"
            accessibilityLabel="Instruction title"
          />

          <TextField
            label="Note (optional)"
            placeholder="Even a rough estimate is fine, just keep the streak going."
            value={note}
            onChangeText={setNote}
            maxLength={NOTE_MAX_LENGTH}
            editable={!submitting}
            multiline
            numberOfLines={3}
            style={styles.noteInput}
            accessibilityLabel="Instruction note"
          />

          <Button
            label="Assign instruction"
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            loading={submitting}
            fullWidth
            style={styles.submitButton}
          />
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

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
    gap: spacing.lg,
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
  noteInput: {
    minHeight: 72,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
});
