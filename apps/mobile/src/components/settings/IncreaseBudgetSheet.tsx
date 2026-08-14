// The two-second fix for "Monthly token budget exceeded".
//
// The coach stops answering when BYOK usage hits the monthly token cap the
// user set themselves. Before this, the only way out was: leave the chat,
// open Settings, open the AI provider key sheet, scroll past the key and the
// usage meter, work out what number to type, type it, submit, navigate back,
// retype the question. Eight steps to change one integer the user already
// decided to change the moment they read the error.
//
// So this sheet is deliberately NOT a smaller copy of AiKeySheet's budget
// field. It is three pre-computed buttons. The arithmetic ("what is 50% more
// than 250,000?") is the actual work, and doing it for the user is what
// turns a settings errand into one tap — each row shows the resulting
// ABSOLUTE budget, not just the percentage, so the choice needs no mental
// multiplication and no second screen to verify. The free-text field stays,
// because someone will want exactly 400k, but it sits under the presets as
// the escape hatch rather than the main road.
//
// Endpoint: `PATCH /coach/byok-key/budget { tokensLimit }` — the same one
// AiKeySheet's budget field posts to, reached through the same
// `apiClient.coachSettings.setByokBudget`. No new API surface: the write
// already existed, it just had no route from the place the failure happens.
// Bounds (1,000 / 100,000,000) are the API's own `@Min`/`@Max`, mirrored in
// the shared package so a rejected value costs a render, not a round trip.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  COACH_BYOK_MAX_TOKEN_BUDGET,
  COACH_BYOK_MIN_TOKEN_BUDGET,
  coachBudgetIncrements,
  formatCoachTokenCount,
  parseCoachByokBudget,
  type CoachByokState,
} from "@goalslot/shared";

import { Button, TextField } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { QueryErrorState } from "@/components/QueryErrorState";
import { LoadingState } from "@/components/LoadingState";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { coachSettingsQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { SettingsSheet } from "./SettingsSheet";

export interface IncreaseBudgetSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Fired after the PATCH succeeds and the sheet dismisses. The point of the
   * whole flow is that the request the user already made goes through, so the
   * caller should re-send it here rather than making them retype it.
   */
  onRaised?: () => void;
}

/** Spoken form for the screen reader — "380k" reads as gibberish out loud. */
function spokenTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10} million tokens`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} thousand tokens`;
  return `${value} tokens`;
}

export function IncreaseBudgetSheet({ visible, onClose, onRaised }: IncreaseBudgetSheetProps) {
  const { data, isPending, isError, error: queryError, refetch } = useQuery({
    ...coachSettingsQueries.byokKey(),
    enabled: visible,
  });

  const [customInput, setCustomInput] = useState("");
  /** The budget currently being written, so only the row that was tapped spins. */
  const [applying, setApplying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setCustomInput("");
      setApplying(null);
      setError(null);
    }
  }, [visible]);

  const tokensUsed = data?.tokensUsed ?? 0;
  const tokensLimit = data?.tokensLimit ?? 0;
  const usedPercent = tokensLimit > 0 ? Math.min(100, Math.round((tokensUsed / tokensLimit) * 100)) : 100;
  const options = coachBudgetIncrements(tokensLimit);
  const atCeiling = tokensLimit >= COACH_BYOK_MAX_TOKEN_BUDGET;
  const busy = applying !== null;

  const applyBudget = useCallback(
    async (tokensLimitNext: number) => {
      setApplying(tokensLimitNext);
      setError(null);
      try {
        const res = await apiClient.coachSettings.setByokBudget(tokensLimitNext);
        // The PATCH returns the whole new state, so the cache is written from
        // the response rather than invalidated — same as AiKeySheet, and it
        // keeps the meter from flickering back to the spent number between
        // the write and a refetch. Writing it also means a retry fired from
        // `onRaised` races nothing: the new ceiling is already in the cache.
        queryClient.setQueryData<CoachByokState>(coachSettingsQueries.coachSettingsQueries.byokKey(), res.data);
        AccessibilityInfo.announceForAccessibility(
          `Monthly budget raised to ${spokenTokens(res.data.tokensLimit ?? tokensLimitNext)}.`,
        );
        // Cleared before dismissing, not in a `finally`: `onRaised` typically
        // clears the error this sheet was opened from, which unmounts the
        // notice and this sheet with it — any state written after that call
        // would land on a component that no longer exists.
        setApplying(null);
        onClose();
        onRaised?.();
      } catch (err) {
        // Stay open on failure. Dismissing would drop the user back on the
        // same dead-end error with no idea whether anything changed.
        const message = getErrorMessage(err, "Couldn't update the budget.");
        setApplying(null);
        setError(message);
        AccessibilityInfo.announceForAccessibility(message);
      }
    },
    [onClose, onRaised],
  );

  const handleCustom = useCallback(() => {
    const parsed = parseCoachByokBudget(customInput);
    if (parsed === null) {
      const message = `Enter a budget between ${formatCoachTokenCount(COACH_BYOK_MIN_TOKEN_BUDGET)} and ${formatCoachTokenCount(COACH_BYOK_MAX_TOKEN_BUDGET)} tokens.`;
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    if (parsed <= tokensUsed) {
      // Setting a cap at or below what's already spent leaves the coach just
      // as stuck, and the failure would look identical to the one they came
      // here to fix.
      const message = `That's below the ${formatCoachTokenCount(tokensUsed)} tokens already used this month — the coach would still be stopped.`;
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    void applyBudget(parsed);
  }, [applyBudget, customInput, tokensUsed]);

  let body: React.ReactNode;
  if (isPending) {
    body = <LoadingState message="Checking your budget" />;
  } else if (isError && !data) {
    // `isError && !data`: a cached budget from an earlier open must not be
    // replaced by a hard error just because this open's refetch failed.
    body = <QueryErrorState error={queryError} message="Couldn't load your current budget." onRetry={() => void refetch()} />;
  } else if (data?.status !== "active") {
    // Only a BYOK key has a monthly token budget. Someone on the shared
    // operator allowance hit a different ceiling and needs a key, not a
    // bigger number — say so instead of showing buttons that would 404.
    body = (
      <Text style={styles.note}>
        There's no monthly token budget to raise yet — the coach is running on the shared allowance. Add your own
        provider key under Settings, AI provider key, and you'll control the budget from there.
      </Text>
    );
  } else {
    body = (
      <>
        {error ? (
          <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.usage}>
          <Text style={styles.usageValue} numberOfLines={1} adjustsFontSizeToFit>
            {formatCoachTokenCount(tokensUsed)}
          </Text>
          <Text style={styles.usageCaption}>
            of {formatCoachTokenCount(tokensLimit)} tokens used this month ({usedPercent}%)
          </Text>
          <View
            style={styles.meterTrack}
            accessibilityRole="progressbar"
            accessibilityLabel="Monthly token usage"
            accessibilityValue={{ min: 0, max: 100, now: usedPercent }}
          >
            <View style={[styles.meterFill, { width: `${usedPercent}%` }]} />
          </View>
        </View>

        {atCeiling ? (
          <Text style={styles.note}>
            Your budget is already at the {formatCoachTokenCount(COACH_BYOK_MAX_TOKEN_BUDGET)}-token maximum, so
            there's nothing left to raise. Usage resets 30 days after the window started.
          </Text>
        ) : (
          <View style={styles.options}>
            {options.map((option) => {
              const isThis = applying === option.tokensLimit;
              return (
                <Pressable
                  key={option.percent}
                  onPress={() => void applyBudget(option.tokensLimit)}
                  disabled={busy}
                  style={({ pressed }) => [styles.option, pressed && !busy && styles.optionPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy, busy: isThis }}
                  accessibilityLabel={`Raise budget ${option.percent} percent, to ${spokenTokens(option.tokensLimit)} a month`}
                >
                  <Text style={styles.optionPercent}>+{option.percent}%</Text>
                  <View style={styles.optionText}>
                    <Text style={styles.optionValue} numberOfLines={1}>
                      {formatCoachTokenCount(option.tokensLimit)} tokens/mo
                    </Text>
                    <Text style={styles.optionHint} numberOfLines={1}>
                      {formatCoachTokenCount(option.tokensLimit - tokensLimit)} more than now
                    </Text>
                  </View>
                  {isThis ? (
                    <ActivityIndicator size="small" color={colors.mutedForeground} />
                  ) : (
                    <Icon name="chevron" size={iconSize.sm} color={colors.mutedForegroundLight} />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {atCeiling ? null : (
          <View style={styles.custom}>
            <TextField
              label="Or set an exact budget"
              value={customInput}
              onChangeText={setCustomInput}
              keyboardType="number-pad"
              placeholder={String(tokensLimit || COACH_BYOK_MIN_TOKEN_BUDGET)}
              accessibilityLabel="Exact monthly token budget"
              editable={!busy}
            />
            <Button
              label="Set budget"
              variant="secondary"
              size="sm"
              onPress={handleCustom}
              loading={busy && !options.some((o) => o.tokensLimit === applying)}
              disabled={!customInput.trim() || busy}
              style={styles.customButton}
            />
          </View>
        )}
      </>
    );
  }

  return (
    <SettingsSheet
      visible={visible}
      title="Increase monthly budget"
      description="Raise the cap and the coach picks up where it stopped. It only spends against your own provider key."
      onClose={onClose}
    >
      {body}
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
  note: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  usage: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
  usageValue: {
    ...typography.statValue,
    color: colors.foreground,
  },
  usageCaption: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  meterTrack: {
    height: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  meterFill: {
    height: "100%",
    borderRadius: radii.pill,
    // Spent, not healthy — the meter is at 100% by definition when this
    // sheet opens from the error, and a brand-yellow bar would read as fine.
    backgroundColor: colors.destructive,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionPressed: {
    backgroundColor: colors.secondary,
    borderColor: colors.borderStrong,
  },
  optionPercent: {
    ...typography.title,
    color: colors.primaryText,
    // Pins the three "+50% / +100% / +200%" labels to one column so the
    // resulting budgets line up and can be compared down the list.
    minWidth: 56,
  },
  optionText: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  optionValue: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  optionHint: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  custom: {
    gap: spacing.xs,
  },
  customButton: {
    alignSelf: "flex-start",
  },
  errorBanner: {
    backgroundColor: colors.destructiveMuted,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.destructive,
    padding: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
});
