// Integrations, ported from dw-time-web's `SettingsIntegrationsTab`
// (src/features/settings/components/settings-integrations-tab.tsx).
//
// It is one integration — the AI key the Coach runs on — so it is named for
// what it is rather than for the tab it came from. Endpoints:
// `GET/POST/DELETE /coach/byok-key`, `PATCH /coach/byok-key/model`,
// `PATCH /coach/byok-key/budget`. See packages/shared/src/api/coach-settings.ts.
//
// Why this is worth a phone screen at all, given it involves pasting a long
// secret: without a key the Coach falls back to a shared operator key capped
// at a handful of messages a day, and "the coach stopped answering" is
// something a user hits on their phone, at the moment they wanted to use it.
// Pasting is the one text-entry task a phone is genuinely good at.
//
// Two web behaviours deliberately not carried over:
//
//   1. Web's `handleSave` isn't `async` and never awaits the mutation, so it
//      shows "key saved" even when the POST fails
//      (settings-integrations-tab.tsx:65-83). Both mutations here await and
//      report the real outcome.
//   2. Web validates the key prefix inline in the component. That check now
//      lives in the shared package as `validateCoachByokKey`, where it is
//      tested and where web can eventually take it from too.
//
// There is deliberately no "Test connection" button: the API never calls the
// provider at save time (it prefix-checks, encrypts, stores), so any such
// button would either lie or need a route that does not exist.
//
// One intentional simplification: while a key is active this shows the masked
// key and a Remove button, with no in-place "Replace key" field. Web has one,
// but web also refuses to let you switch providers without removing first, so
// the field only ever replaces a key with another from the same provider —
// a rare thing to do from a phone, and Remove-then-Add already does it.

import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  COACH_BYOK_MAX_TOKEN_BUDGET,
  COACH_BYOK_MIN_TOKEN_BUDGET,
  COACH_BYOK_PROVIDERS,
  coachByokProviderMeta,
  parseCoachByokBudget,
  validateCoachByokKey,
  type CoachByokProvider,
  type CoachByokState,
} from "@goalslot/shared";

import { Button, TextField } from "@/components/ui";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { apiClient } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import { coachSettingsQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

import { SettingsSheet } from "./SettingsSheet";

export interface AiKeySheetProps {
  visible: boolean;
  onClose: () => void;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

export function AiKeySheet({ visible, onClose }: AiKeySheetProps) {
  const { data, isPending, isError, refetch } = useQuery({
    ...coachSettingsQueries.byokKey(),
    enabled: visible,
  });

  const isActive = data?.status === "active";

  const [provider, setProvider] = useState<CoachByokProvider>("GEMINI");
  const [rawKey, setRawKey] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [busy, setBusy] = useState<null | "save" | "remove" | "budget" | "model">(null);
  const [error, setError] = useState<string | null>(null);

  // Follow the server's provider once a key is active, so the console link
  // and the prefix check below describe the key the user actually has.
  useEffect(() => {
    if (data?.provider) setProvider(data.provider);
  }, [data?.provider]);

  useEffect(() => {
    if (!visible) {
      setRawKey("");
      setBudgetInput("");
      setError(null);
      setBusy(null);
    }
  }, [visible]);

  const meta = coachByokProviderMeta(provider);

  // Every mutation returns the full new state, so the cache is written
  // straight from the response rather than invalidated and refetched — same
  // as web's hook, and it keeps the usage meter from flickering back to the
  // old number between the PATCH and the GET.
  const applyState = useCallback((next: CoachByokState) => {
    queryClient.setQueryData(coachSettingsQueries.coachSettingsQueries.byokKey(), next);
  }, []);

  const fail = useCallback((err: unknown, fallback: string) => {
    const message = getErrorMessage(err, fallback);
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const handleSaveKey = useCallback(async () => {
    const invalid = validateCoachByokKey(provider, rawKey);
    if (invalid) {
      setError(invalid);
      AccessibilityInfo.announceForAccessibility(invalid);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await apiClient.coachSettings.saveByokKey({ provider, apiKey: rawKey.trim() });
      applyState(res.data);
      setRawKey("");
      AccessibilityInfo.announceForAccessibility(`${meta.label} key saved.`);
    } catch (err) {
      fail(err, "Couldn't save that key.");
    } finally {
      setBusy(null);
    }
  }, [applyState, fail, meta.label, provider, rawKey]);

  const handleRemoveKey = useCallback(() => {
    Alert.alert(
      "Remove this key?",
      "The coach will fall back to the shared key, which is limited to a few messages a day.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy("remove");
              setError(null);
              try {
                await apiClient.coachSettings.deleteByokKey();
                // Invalidating the whole `['coach']` root, not just the key:
                // removing the key changes which model answers a chat, so the
                // cached chat history is now describing a different setup.
                await queryClient.invalidateQueries({
                  queryKey: coachSettingsQueries.coachSettingsQueries.all,
                });
                AccessibilityInfo.announceForAccessibility("Key removed.");
              } catch (err) {
                fail(err, "Couldn't remove that key.");
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }, [fail]);

  const handleSaveBudget = useCallback(async () => {
    const parsed = parseCoachByokBudget(budgetInput);
    if (parsed === null) {
      const message = `Enter a budget between ${formatTokens(COACH_BYOK_MIN_TOKEN_BUDGET)} and ${formatTokens(COACH_BYOK_MAX_TOKEN_BUDGET)} tokens.`;
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    setBusy("budget");
    setError(null);
    try {
      const res = await apiClient.coachSettings.setByokBudget(parsed);
      applyState(res.data);
      setBudgetInput("");
      AccessibilityInfo.announceForAccessibility("Monthly budget updated.");
    } catch (err) {
      fail(err, "Couldn't update the budget.");
    } finally {
      setBusy(null);
    }
  }, [applyState, budgetInput, fail]);

  const handlePickModel = useCallback(
    async (model: string) => {
      setBusy("model");
      setError(null);
      try {
        const res = await apiClient.coachSettings.setByokModel(model);
        applyState(res.data);
        AccessibilityInfo.announceForAccessibility(`Model set to ${model}.`);
      } catch (err) {
        fail(err, "Couldn't switch model.");
      } finally {
        setBusy(null);
      }
    },
    [applyState, fail],
  );

  const openConsole = useCallback(() => {
    if (meta.consoleUrl) void Linking.openURL(meta.consoleUrl);
  }, [meta.consoleUrl]);

  const tokensUsed = data?.tokensUsed ?? 0;
  const tokensLimit = data?.tokensLimit ?? 0;
  const usedPercent = tokensLimit > 0 ? Math.min(100, Math.round((tokensUsed / tokensLimit) * 100)) : 0;
  const allowedModels = data?.allowedModels ?? [];

  return (
    <SettingsSheet
      visible={visible}
      title="AI provider key"
      description="Bring your own key so the coach runs on your account, not a shared allowance."
      onClose={onClose}
    >
      {isPending ? (
        <LoadingState message="Checking your key" />
      ) : isError ? (
        <ErrorState message="Couldn't load your AI key settings." onRetry={() => void refetch()} />
      ) : (
        <>
          {error ? (
            <View style={styles.errorBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {isActive ? (
            <View style={styles.activeCard}>
              <View style={styles.activeText}>
                <Text style={styles.activeLabel}>{coachByokProviderMeta(data?.provider ?? provider).label}</Text>
                <Text style={styles.activeKey} numberOfLines={1}>
                  {data?.maskedKey ?? "Key stored"}
                </Text>
              </View>
              <Button
                label="Remove"
                variant="destructive"
                size="sm"
                onPress={handleRemoveKey}
                loading={busy === "remove"}
                disabled={busy !== null}
              />
            </View>
          ) : (
            <>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Provider</Text>
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {COACH_BYOK_PROVIDERS.map((option) => {
                    const selected = provider === option.provider;
                    return (
                      <Pressable
                        key={option.provider}
                        onPress={() => setProvider(option.provider)}
                        disabled={busy !== null}
                        style={[styles.chip, selected && styles.chipSelected]}
                        accessibilityRole="radio"
                        accessibilityLabel={option.label}
                        accessibilityState={{ selected, disabled: busy !== null }}
                      >
                        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.fieldHint}>{meta.howTo}</Text>
              </View>

              <TextField
                label={`${meta.label} API key`}
                value={rawKey}
                onChangeText={setRawKey}
                secureToggle
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                placeholder={`${meta.keyPrefix}...`}
                accessibilityHint={`Paste the key you created in the ${meta.label} console`}
                editable={busy === null}
              />

              <Button
                label="Save key"
                onPress={() => void handleSaveKey()}
                loading={busy === "save"}
                disabled={!rawKey.trim() || busy !== null}
                fullWidth
              />
              <Button
                label={`Open the ${meta.label} console`}
                variant="secondary"
                icon="arrow-right"
                iconPosition="trailing"
                onPress={openConsole}
                disabled={!meta.consoleUrl}
                fullWidth
              />
            </>
          )}

          {/* Usage, budget and model only mean anything once there is a key
              the usage is being counted against. */}
          {isActive ? (
            <>
              <View style={styles.usage}>
                <Text style={styles.usageValue}>{formatTokens(tokensUsed)}</Text>
                <Text style={styles.usageCaption}>
                  of {formatTokens(tokensLimit)} tokens this month ({usedPercent}%)
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

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Monthly token budget</Text>
                <Text style={styles.fieldHint}>
                  The coach stops once it hits this. Currently {formatTokens(tokensLimit)}.
                </Text>
                <TextField
                  value={budgetInput}
                  onChangeText={setBudgetInput}
                  keyboardType="number-pad"
                  placeholder={String(tokensLimit || COACH_BYOK_MIN_TOKEN_BUDGET)}
                  accessibilityLabel="New monthly token budget"
                  editable={busy === null}
                />
                <Button
                  label="Update budget"
                  variant="secondary"
                  size="sm"
                  onPress={() => void handleSaveBudget()}
                  loading={busy === "budget"}
                  disabled={!budgetInput.trim() || busy !== null}
                  style={styles.inlineButton}
                />
              </View>

              {allowedModels.length > 0 ? (
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Model</Text>
                  <Text style={styles.fieldHint}>
                    Server-approved models for this provider. Leave it alone to use the default.
                  </Text>
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {allowedModels.map((model) => {
                      const selected = (data?.selectedModel ?? data?.effectiveModel) === model;
                      const isDefault = !data?.selectedModel && data?.effectiveModel === model;
                      return (
                        <Pressable
                          key={model}
                          onPress={() => void handlePickModel(model)}
                          disabled={busy !== null}
                          style={[styles.chip, selected && styles.chipSelected]}
                          accessibilityRole="radio"
                          accessibilityLabel={isDefault ? `${model}, default` : model}
                          accessibilityState={{ selected, disabled: busy !== null }}
                        >
                          <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                            {isDefault ? `${model} (default)` : model}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </>
          ) : data?.shared?.available ? (
            <Text style={styles.sharedNote}>
              Until you add a key the coach runs on a shared allowance — {data.shared.used} of{" "}
              {data.shared.limit} messages used today.
            </Text>
          ) : null}
        </>
      )}
    </SettingsSheet>
  );
}

const styles = StyleSheet.create({
  activeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.successMuted,
    backgroundColor: colors.successMuted,
  },
  activeText: {
    flex: 1,
    gap: spacing.xxs,
  },
  activeLabel: {
    ...typography.body,
    fontWeight: "700",
    color: colors.foreground,
  },
  activeKey: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
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
  usage: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
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
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.border,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  meterFill: {
    height: "100%",
    borderRadius: radii.full,
    backgroundColor: colors.primaryDark,
  },
  inlineButton: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  sharedNote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  errorBanner: {
    backgroundColor: colors.destructiveMuted,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.destructive,
    padding: spacing.md,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.destructive,
  },
});
