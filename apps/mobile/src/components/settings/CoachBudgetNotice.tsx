// The affordance that turns a Coach dead-end into a fix.
//
// Drop this next to wherever a Coach failure is already rendered. It decides
// for itself whether the failure is the budget one and renders NOTHING for
// every other kind, so a screen wires it in unconditionally — one line, no
// new error-classifying logic on the screen, and no risk of a second surface
// classifying it differently from the first. It owns the sheet it opens too,
// so the host screen needs no extra state.
//
// It does not repeat the error text. Both hosts (the Coach chat's error
// banner, the voice dock's status line) already show the message; a notice
// that restated it would read as two errors instead of one error and its
// remedy.
//
// Detection lives in the shared package as `isCoachBudgetExceededError` —
// see the long comment there for why a string match is the only option this
// error's wire shape leaves, and what it deliberately does not match (the
// shared-key daily ceiling, and the request throttler's real 429).

import { useCallback, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { isCoachBudgetExceededError } from "@goalslot/shared";

import { Button } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { colors, iconSize, radii, spacing, typography } from "@/theme/tokens";

import { IncreaseBudgetSheet } from "./IncreaseBudgetSheet";

export interface CoachBudgetNoticeProps {
  /** The failure as shown to the user — an SSE `chunk.error`, or a caught error. */
  error: unknown;
  /**
   * Re-run whatever the user asked for, after the budget goes up. Optional:
   * without it the sheet still raises the budget, the user just sends again
   * themselves.
   */
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function CoachBudgetNotice({ error, onRetry, style }: CoachBudgetNoticeProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const applies = isCoachBudgetExceededError(error);

  const handleClose = useCallback(() => setSheetOpen(false), []);

  if (!applies) return null;

  return (
    <View style={[styles.notice, style]}>
      <View style={styles.head}>
        <Icon name="alert" size={iconSize.sm} color={colors.primaryText} />
        <Text style={styles.headText} numberOfLines={3}>
          The coach stopped at this month's token budget. Raise it and carry on.
        </Text>
      </View>
      <Button
        label="Increase monthly budget"
        variant="brand"
        size="sm"
        icon="sparkles"
        onPress={() => setSheetOpen(true)}
        fullWidth
      />
      <IncreaseBudgetSheet visible={sheetOpen} onClose={handleClose} onRaised={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Hairline card, not a filled brand panel — the app's convention. The one
  // brand-yellow element is the button, because it is the point.
  notice: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  headText: {
    ...typography.bodySmall,
    color: colors.foreground,
    // Long copy in a narrow dock has to wrap rather than push the icon out.
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
});
