// "Untangle a feeling" — mobile port of goal-slot-web's
// journal-untangle.tsx. Same framing (a feeling is a question your mind is
// trying to ask), same 10 starter prompts, same collapsed-card ->
// tap-to-expand -> "Insert" interaction. Web renders this in a Dialog; this
// app's own convention for "a form/picker layered over a screen" is a
// @gorhom/bottom-sheet BottomSheetModal (see EditGoalSheet.tsx, QuickAddSheet
// .tsx) — imperative present()/dismiss() handle, no `open` prop, so the
// caller (journal.tsx) holds a ref rather than boolean state.
//
// Each prompt shows as a collapsed row with just its title. Tapping expands
// it in place to reveal the body and an "Insert" button — same "no
// accidental inserts, read it first" shape web's dialog has. Insert calls
// back into journal.tsx (which appends the formatted prompt to the draft —
// see journal-writing-help.ts's `appendUntanglePrompt` for why this is an
// append rather than a cursor-position insert) and dismisses the sheet.

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

import { useBottomSheetBackHandler } from "@/hooks/useBottomSheetBackHandler";
import { Icon } from "@/components/ui/Icon";
import { colors, radii, spacing, typography } from "@/theme/tokens";

import { UNTANGLE_PROMPTS, type UntanglePrompt } from "./journal-writing-help";

export interface JournalUntangleSheetRef {
  present: () => void;
  dismiss: () => void;
}

export interface JournalUntangleSheetProps {
  /** Fired when the user taps Insert on a prompt. The sheet dismisses itself right after. */
  onInsertPrompt: (prompt: UntanglePrompt) => void;
}

export const JournalUntangleSheet = forwardRef<JournalUntangleSheetRef, JournalUntangleSheetProps>(
  function JournalUntangleSheet({ onInsertPrompt }, ref) {
    const sheetRef = useRef<BottomSheetModal>(null);
    const { handleSheetPositionChange } = useBottomSheetBackHandler(sheetRef);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        present: () => {
          setExpandedId(null);
          sheetRef.current?.present();
        },
        dismiss: () => sheetRef.current?.dismiss(),
      }),
      [],
    );

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
      ),
      [],
    );

    const toggleExpanded = useCallback((id: string) => {
      setExpandedId((current) => (current === id ? null : id));
    }, []);

    const handleInsert = useCallback(
      (prompt: UntanglePrompt) => {
        onInsertPrompt(prompt);
        setExpandedId(null);
        sheetRef.current?.dismiss();
      },
      [onInsertPrompt],
    );

    // Pure action/list sheet: no BottomSheetTextInput anywhere in this file
    // (the prompt body is read-only, expand/collapse and Insert are both
    // plain Pressables), so there is no keyboard for
    // android_keyboardInputMode to avoid.
    return (
      // eslint-disable-next-line no-restricted-syntax -- see comment above
      <BottomSheetModal
        ref={sheetRef}
        // Dynamic sizing, same as EditGoalSheet — this sheet has no text
        // input of its own (no keyboard to avoid), but the expand/collapse
        // interaction changes content height, and dynamic sizing re-measures
        // on every change rather than needing a fixed snap point tuned to the
        // tallest possible state.
        enableDynamicSizing
        maxDynamicContentSize={640}
        onChange={handleSheetPositionChange}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Icon name="sparkles" size={18} color={colors.primaryText} />
            <Text style={styles.title}>A feeling is a question your mind is trying to ask</Text>
          </View>
          <Text style={styles.subtitle}>
            Tap a prompt to read it. If it fits, hit Insert and it'll drop into your entry.
          </Text>

          <View style={styles.list}>
            {UNTANGLE_PROMPTS.map((prompt) => {
              const isExpanded = expandedId === prompt.id;
              return (
                <View key={prompt.id} style={[styles.card, isExpanded && styles.cardExpanded]}>
                  <Pressable
                    onPress={() => toggleExpanded(prompt.id)}
                    style={styles.cardHeader}
                    accessibilityRole="button"
                    accessibilityLabel={prompt.title}
                    accessibilityState={{ expanded: isExpanded }}
                    accessibilityHint={isExpanded ? "Collapses this prompt" : "Expands to show the full prompt"}
                  >
                    <Text style={styles.cardTitle}>{prompt.title}</Text>
                    <Icon
                      name={isExpanded ? "chevron-down" : "chevron"}
                      size={16}
                      color={isExpanded ? colors.primaryText : colors.mutedForeground}
                    />
                  </Pressable>

                  {isExpanded ? (
                    <View style={styles.cardBody}>
                      <Text style={styles.cardBodyText}>{prompt.body}</Text>
                      <Pressable
                        onPress={() => handleInsert(prompt)}
                        style={({ pressed }) => [styles.insertButton, pressed && styles.insertButtonPressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Insert "${prompt.title}" into today's entry`}
                      >
                        <Text style={styles.insertButtonText}>Insert</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          <Text style={styles.footer}>
            None of these prompts are wrong answers. Drop one in, write until it stops talking, come back
            tomorrow.
          </Text>
        </BottomSheetScrollView>
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  title: {
    ...typography.h2,
    flex: 1,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  list: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  cardExpanded: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cardTitle: {
    ...typography.bodySmall,
    flex: 1,
    fontWeight: "600",
    color: colors.foreground,
  },
  cardBody: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primaryBorder,
    paddingTop: spacing.sm,
  },
  cardBodyText: {
    ...typography.bodySmall,
    color: colors.foreground,
    lineHeight: 19,
  },
  insertButton: {
    alignSelf: "flex-end",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    backgroundColor: colors.ink,
  },
  insertButtonPressed: {
    opacity: 0.85,
  },
  insertButtonText: {
    ...typography.bodySmall,
    fontWeight: "700",
    color: colors.white,
  },
  footer: {
    ...typography.caption,
    color: colors.mutedForeground,
    lineHeight: 16,
    marginTop: spacing.md,
  },
});
