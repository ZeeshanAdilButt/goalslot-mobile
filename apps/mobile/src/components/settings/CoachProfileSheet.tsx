// Coach profile, ported from dw-time-web's `SettingsCoachProfileTab`
// (src/features/settings/components/settings-coach-profile-tab.tsx).
//
// Backed by `GET`/`PUT /coach/habits-profile`. That row has eleven fields;
// web's settings tab shows three of them (`why`, `religiousContext`,
// `spiritualNotes`) and so does this — the other eight (bedtime, wake time,
// sleep target, blockers, work environment) belong to an onboarding flow
// neither platform's settings screen owns.
//
// Two deliberate departures from web:
//
//   1. Web saves the textareas on blur ("Saves automatically when you click
//      away"). Touch has no reliable "click away" — dismissing the keyboard,
//      scrolling, and swiping the sheet down are all plausible blur events
//      and none of them read as "commit". This uses an explicit Save button.
//   2. Web PUTs all eleven fields on every save, backfilling the eight it
//      doesn't show with hardcoded defaults (`sleepTargetHours: 8`,
//      `bedtime: '23:00'`, ...). The API's UpsertHabitsProfileDto forwards
//      only the keys present in the body, so this sends just the three fields
//      it owns — a save from the phone cannot overwrite a bedtime the user
//      set elsewhere with a default.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  COACH_RELIGIOUS_CONTEXTS,
  type CoachReligiousContext,
  type UpsertCoachHabitsProfile,
} from "@goalslot/shared";

// Imported from their own modules rather than through the `@/components`
// barrel: that barrel is what the screens use, and reaching for it from
// inside src/components would be one re-export away from a cycle.
import { Button, TextField } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { coachSettingsQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { SettingsSheet } from "./SettingsSheet";

export interface CoachProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function CoachProfileSheet({ visible, onClose }: CoachProfileSheetProps) {
  // `enabled: visible` — this is the only screen that reads the habits
  // profile, so there's no reason to fetch it until the sheet is actually
  // open.
  const { data, isPending, isError, refetch } = useQuery({
    ...coachSettingsQueries.habitsProfile(),
    enabled: visible,
  });

  const [why, setWhy] = useState("");
  const [religiousContext, setReligiousContext] = useState<CoachReligiousContext>("NONE");
  const [spiritualNotes, setSpiritualNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync from the server whenever a fresh profile lands. `data` is a stable
  // reference from the query cache, so this fires on load and on refetch, not
  // on every keystroke.
  //
  // Every field defaults to empty rather than to a value: on a profile that
  // has never been saved the API returns a defaults object that omits
  // `religiousContext` and `spiritualNotes` entirely (coach-profile.service.ts's
  // PROFILE_DEFAULTS), so absence has to mean "not set".
  useEffect(() => {
    if (!data) return;
    setWhy(data.why ?? "");
    setReligiousContext(data.religiousContext ?? "NONE");
    setSpiritualNotes(data.spiritualNotes ?? "");
  }, [data]);

  useEffect(() => {
    if (!visible) setError(null);
  }, [visible]);

  const isDirty = useMemo(() => {
    if (!data) return false;
    return (
      why !== (data.why ?? "") ||
      religiousContext !== (data.religiousContext ?? "NONE") ||
      spiritualNotes !== (data.spiritualNotes ?? "")
    );
  }, [data, religiousContext, spiritualNotes, why]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    // Selecting "prefer not to say" clears the notes in the same request, so
    // the field the user just hid cannot stay on the record — same behaviour
    // as web's select handler.
    const payload: UpsertCoachHabitsProfile = {
      why: why.trim(),
      religiousContext,
      spiritualNotes: religiousContext === "NONE" ? "" : spiritualNotes.trim(),
    };
    try {
      const res = await apiClient.coachSettings.updateHabitsProfile(payload);
      queryClient.setQueryData(coachSettingsQueries.coachSettingsQueries.habitsProfile(), res.data);
      AccessibilityInfo.announceForAccessibility("Coach profile saved.");
      onClose();
    } catch (err) {
      const message = getErrorMessage(err, "Couldn't save your coach profile.");
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setIsSaving(false);
    }
  }, [onClose, religiousContext, spiritualNotes, why]);

  return (
    <SettingsSheet
      visible={visible}
      title="Coach profile"
      description="Context the coach reasons from. It reads this before every reply."
      onClose={onClose}
    >
      {isPending ? (
        <LoadingState message="Loading your coach profile" />
      ) : isError ? (
        <ErrorState message="Couldn't load your coach profile." onRetry={() => void refetch()} />
      ) : (
        <>
          {error ? (
            <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <TextField
            label="Your why"
            value={why}
            onChangeText={setWhy}
            multiline
            maxLength={4000}
            style={styles.textArea}
            placeholder="What are you actually chasing, and why does it matter to you?"
            accessibilityHint="The reason behind your goals. The coach refers back to this."
            editable={!isSaving}
          />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Spiritual or religious context</Text>
            <Text style={styles.fieldHint}>
              Optional. Shapes how the coach frames discipline, rest and motivation.
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {COACH_RELIGIOUS_CONTEXTS.map((option) => {
                const selected = religiousContext === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setReligiousContext(option.value)}
                    disabled={isSaving}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected, disabled: isSaving }}
                  >
                    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Hidden rather than disabled when there's no context to annotate —
              same as web, which drops the field from the DOM on 'NONE'. */}
          {religiousContext === "NONE" ? null : (
            <TextField
              label="Spiritual notes"
              value={spiritualNotes}
              onChangeText={setSpiritualNotes}
              multiline
              maxLength={2000}
              style={styles.textAreaShort}
              placeholder="Practices, timings or values you want the coach to respect."
              editable={!isSaving}
            />
          )}

          <Button
            label="Save"
            onPress={() => void handleSave()}
            loading={isSaving}
            disabled={!isDirty}
            fullWidth
          />
        </>
      )}
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
  textArea: {
    minHeight: 112,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },
  textAreaShort: {
    minHeight: 84,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "500",
    color: colors.foreground,
  },
  fieldHint: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    // 44pt floor on the short labels ("Islam", "Other") as much as the long
    // ones — a wrap of chips is where touch targets quietly shrink.
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  chipLabel: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
  },
  chipLabelSelected: {
    color: colors.white,
  },
  errorBanner: {
    backgroundColor: colors.destructiveMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
    padding: spacing.md,
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
});
