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
//
// UNATTRIBUTED ENTRIES are a first-class row shape here, not an edge case:
// now that a session can be started without picking anything, "logged but not
// filed" is a normal state a lot of entries will sit in. Such a row gets a
// hollow dot rather than the brand-coloured one (a filled brand dot made it
// look identical to a goal that happens to use the brand colour) and an
// "Add goal" affordance that attaches one after the fact. Everything else
// about the row is unchanged.

import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FlashList } from "@shopify/flash-list";

import { formatDuration, getLocalDateString, type TimeEntry } from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

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
  /** Attaches a goal to an already-logged entry. Only offered on rows that have none. */
  onAttachGoal: (entry: TimeEntry) => void;
  /** Id of the entry currently being saved, so its row can show the in-flight state. */
  attachingEntryId?: string | null;
  /**
   * Rendered above the first row, inside this list's own scroll view.
   *
   * The Timer screen passes its whole hero (title, ring, target, reminder
   * picker, transport controls) through here rather than stacking it above
   * the list as a sibling. That's what makes the screen scrollable: the hero
   * is now taller than a phone viewport on its own, so as siblings it
   * squeezed this list to nothing and there was no scroll container anywhere
   * to reach either. Feeding it to the list instead gives the screen exactly
   * one scroll view — and keeps FlashList's virtualization, which nesting it
   * inside a ScrollView would have broken.
   */
  ListHeaderComponent?: React.ReactElement | null;
}

export function SessionHistory({
  entries,
  refreshing,
  onRefresh,
  onAttachGoal,
  attachingEntryId,
  ListHeaderComponent,
}: SessionHistoryProps) {
  const items = useMemo(() => buildItems(entries), [entries]);

  return (
    <FlashList
      data={items}
      ListHeaderComponent={ListHeaderComponent}
      keyExtractor={(item) => item.key}
      // Lets FlashList recycle headers and rows separately instead of
      // reusing one cell shape for both.
      getItemType={(item) => item.kind}
      renderItem={({ item }) =>
        item.kind === "header" ? (
          <DayHeader label={item.label} minutes={item.minutes} />
        ) : (
          <SessionRow
            entry={item.entry}
            onAttachGoal={onAttachGoal}
            attaching={attachingEntryId === item.entry.id}
          />
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

function SessionRow({
  entry,
  onAttachGoal,
  attaching,
}: {
  entry: TimeEntry;
  onAttachGoal: (entry: TimeEntry) => void;
  attaching: boolean;
}) {
  const goal = entry.goal;
  const title = entry.taskTitle || entry.taskName;

  return (
    <View style={styles.row}>
      {/* Hollow ring for an unattributed entry: a filled dot in the brand
          colour was indistinguishable from a goal whose colour is the brand
          colour, so "no goal" and "the yellow goal" looked the same. */}
      <View
        style={[
          styles.rowDot,
          goal ? { backgroundColor: goal.color } : styles.rowDotUnattributed,
        ]}
      />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {goal?.title ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {goal.title}
          </Text>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.attachButton, pressed && styles.attachButtonPressed]}
            onPress={() => onAttachGoal(entry)}
            disabled={attaching}
            accessibilityRole="button"
            accessibilityLabel={`Add a goal to "${title}", ${formatDuration(entry.duration)}`}
            accessibilityState={{ disabled: attaching, busy: attaching }}
            // The row is only ~64pt tall and this control sits inside it, so
            // the 44pt minimum comes from hitSlop rather than from height.
            hitSlop={spacing.sm}
          >
            <Icon name="add" size={13} color={colors.mutedForeground} />
            <Text style={styles.attachText}>{attaching ? "Saving…" : "Add goal"}</Text>
          </Pressable>
        )}
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
  rowDotUnattributed: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  attachButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xxs,
    minHeight: minTouchTarget / 2,
  },
  attachButtonPressed: {
    opacity: 0.6,
  },
  attachText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
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
