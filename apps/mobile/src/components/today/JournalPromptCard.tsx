// Today's journal shortcut — a one-row card that sits directly under the
// "Focus now" hero.
//
// Unlike its siblings in this directory there is no dw-time-web component to
// port: journal has no web equivalent in this checkout (see
// packages/shared/src/api/journal.ts for the full note). So the anatomy is
// borrowed from the closest thing the screen already ships —
// QuickActionCard's tinted icon square + bold title + muted one-line
// subtitle + trailing chevron — re-laid as a full-width row rather than a
// half-width tile, because this is one destination rather than a grid of
// equal options.
//
// Why it exists at all: Journal now has its own bottom tab (see
// app/(app)/_layout.tsx), but this card predates that and stays anyway —
// it's a same-screen shortcut into an existing tab, not a substitute for one,
// the same way Today/Schedule/Tasks/Timer are already both a tab AND a
// drawer row. Before Journal was on the bar this was the only fast path in;
// keeping it here still saves the reach across the bar for whoever is
// already looking at Today, which is exactly the moment a daily writing
// habit needs to be one tap, not a glance-and-decide.
//
// The card stays NEUTRAL even though it's a prompt: the hero above it is the
// one brand-tinted surface at the top of Today, and a second yellow card
// immediately below it would leave the screen with no visual hierarchy at
// all.

import { StyleSheet, Text, View } from "react-native";

import { PressableScale } from "@/components/today/PressableScale";
import { Icon } from "@/components/ui/Icon";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

/**
 * What we know about today's entry.
 *
 * `unknown` is a real, distinct state, not a synonym for `empty`: while the
 * entry is still loading — or if the fetch failed — this screen must not
 * claim the day is unwritten. Same rule every other section on Today follows
 * (see the header of app/(app)/index.tsx).
 */
export type JournalPromptState = "unknown" | "empty" | "started";

const COPY: Record<JournalPromptState, { title: string; subtitle: string }> = {
  unknown: { title: "Journal", subtitle: "Reflect on today" },
  empty: {
    title: "Write today's journal",
    subtitle: "Two minutes on how today actually went",
  },
  started: {
    title: "Continue today's entry",
    subtitle: "Pick up where you left off",
  },
};

const TILE_SIZE = 36;

export interface JournalPromptCardProps {
  state: JournalPromptState;
  onPress: () => void;
}

export function JournalPromptCard({ state, onPress }: JournalPromptCardProps) {
  const { title, subtitle } = COPY[state];

  return (
    <PressableScale
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      // One node, one sentence: the title alone ("Continue today's entry")
      // is ambiguous out of context, and a screen reader shouldn't have to
      // stop on the icon and the chevron to work out where this goes.
      accessibilityLabel={`${title}. ${subtitle}. Opens journal.`}
    >
      <View style={styles.tile}>
        <Icon name="journal" size={18} color={colors.foreground} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron" size={16} color={colors.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.secondary,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  title: {
    ...typography.title,
    fontSize: 15,
    color: colors.foreground,
  },
  subtitle: {
    ...typography.bodySmall,
    fontWeight: "400",
    color: colors.mutedForeground,
  },
});
