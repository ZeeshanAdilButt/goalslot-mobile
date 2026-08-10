// Recently logged sessions, grouped by day.
//
// The flat "one row per entry" list this replaces made it impossible to
// answer the question people actually bring to a time tracker — "how much
// did I do today?" — without adding it up by eye. Grouping by day with a
// per-day total on the header answers it for free, and mirrors the day
// grouping dw-time-web's recent-entries.tsx uses for the same feed.
//
// Rows keep the goal-colour dot and `formatDuration` formatting they already
// had, so a logged entry reads the same here as everywhere else in the app.

import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";

import { formatDuration, getLocalDateString, type TimeEntry } from "@goalslot/shared";

import { colors, radii, spacing, typography } from "@/theme/tokens";

type SessionListItem =
  | { kind: "header"; key: string; label: string; minutes: number }
  | { kind: "entry"; key: string; entry: TimeEntry };

/**
 * Formats a `YYYY-MM-DD` key as a day heading. Parsed via the date parts
 * rather than `new Date(dateStr)` — the bare-date form is parsed as UTC
 * midnight, which renders as the previous day for anyone behind UTC (the
 * same trap packages/shared/src/scheduling/time.ts's getLocalDateString
 * documents).
 */
function formatDayHeading(dateKey: string, todayKey: string, yesterdayKey: string): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function buildItems(entries: TimeEntry[]): SessionListItem[] {
  const byDay = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }

  const todayKey = getLocalDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getLocalDateString(yesterday);

  const items: SessionListItem[] = [];
  // Newest day first — `YYYY-MM-DD` sorts correctly as a plain string.
  for (const dayKey of [...byDay.keys()].sort().reverse()) {
    const dayEntries = byDay.get(dayKey) ?? [];
    items.push({
      kind: "header",
      key: `header-${dayKey}`,
      label: formatDayHeading(dayKey, todayKey, yesterdayKey),
      minutes: dayEntries.reduce((sum, entry) => sum + entry.duration, 0),
    });
    for (const entry of dayEntries) {
      items.push({ kind: "entry", key: entry.id, entry });
    }
  }
  return items;
}

export interface SessionHistoryProps {
  entries: TimeEntry[];
  refreshing: boolean;
  onRefresh: () => void;
}

export function SessionHistory({ entries, refreshing, onRefresh }: SessionHistoryProps) {
  const items = useMemo(() => buildItems(entries), [entries]);

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => item.key}
      // Lets FlashList recycle headers and rows separately instead of
      // reusing one cell shape for both.
      getItemType={(item) => item.kind}
      renderItem={({ item }) =>
        item.kind === "header" ? (
          <DayHeader label={item.label} minutes={item.minutes} />
        ) : (
          <SessionRow entry={item.entry} />
        )
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={styles.listContent}
    />
  );
}

function DayHeader({ label, minutes }: { label: string; minutes: number }) {
  return (
    <View style={styles.dayHeader} accessible accessibilityLabel={`${label}, ${formatDuration(minutes)} logged`}>
      <Text style={styles.dayLabel}>{label}</Text>
      <View style={styles.dayRule} />
      <Text style={styles.dayTotal}>{formatDuration(minutes)}</Text>
    </View>
  );
}

function SessionRow({ entry }: { entry: TimeEntry }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowDot, { backgroundColor: entry.goal?.color ?? colors.primary }]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.taskTitle || entry.taskName}
        </Text>
        {entry.goal?.title ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {entry.goal.title}
          </Text>
        ) : null}
      </View>
      <View style={styles.durationPill}>
        <Text style={styles.durationText}>{formatDuration(entry.duration)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  dayLabel: {
    ...typography.label,
    color: colors.foreground,
  },
  dayRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dayTotal: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowSubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  durationPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
  },
  durationText: {
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    color: colors.foreground,
  },
});
