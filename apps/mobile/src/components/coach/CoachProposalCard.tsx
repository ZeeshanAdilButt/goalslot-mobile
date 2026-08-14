// The card that shows what the assistant wants to change, and the only
// place in the app where a Coach proposal can be applied.
//
// It was previously inline in app/(app)/coach.tsx and read-only, with the
// footnote "open GoalSlot on the web to apply this". Voice needs the same
// card and needs it to actually work, and having two of them — one the user
// can act on and one they cannot — would be worse than either. So it moved
// here and grew an Apply button, and the Coach screen renders this exact
// component. A spoken change and a typed one are now literally the same
// confirmation.
//
// CONFIRMATION IS THE POINT. Nothing here applies on render, on mount, or on
// a swipe. A batch that contains a delete asks a second time through the
// platform's own alert, naming what will go, because a misheard word must
// never be able to remove a goal someone has been working toward for
// months.
//
// LAYOUT RULE, and the reason this file was rebuilt: the Apply/Not now pair
// must stay reachable no matter how much the model emitted. A batch like
// "link all Work blocks to the OloStep goal" is one action PER BLOCK — a
// dozen or more — and the previous version rendered every one of them at
// full height above the footer, which pushed the only two buttons that
// matter clean off the bottom of the screen. The action list is therefore
// capped (see COLLAPSED_ACTION_LIMIT) behind an expander, every piece of
// model-authored text is line-clamped, and the footer sits a predictable
// distance below the header regardless of batch size.

import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import type {
  CoachProposalAction,
  CoachProposalActionType,
  CoachProposalBlock,
  Goal,
  ScheduleBlock,
  Task,
  TimeEntry,
  WeekSchedule,
} from "@goalslot/shared";

import { Icon } from "@/components/ui/Icon";
import { goalQueries, scheduleQueries, taskQueries, timeEntryQueries } from "@/lib/queries";
import { colors, iconSize, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";

/** Human label per action type. Kept exhaustive by the Record's key type. */
const ACTION_LABELS: Record<CoachProposalActionType, string> = {
  RENAME_GOAL: "Rename goal",
  UPDATE_GOAL: "Update goal",
  CREATE_GOAL: "Create goal",
  DELETE_GOAL: "Delete goal",
  CREATE_SCHEDULE_BLOCK: "Add schedule block",
  UPDATE_SCHEDULE_BLOCK: "Update schedule block",
  DELETE_SCHEDULE_BLOCK: "Remove schedule block",
  CREATE_TIME_ENTRY: "Log time",
  UPDATE_TIME_ENTRY: "Update time entry",
  DELETE_TIME_ENTRY: "Delete time entry",
  CREATE_TASK: "Create task",
  UPDATE_TASK: "Update task",
  DELETE_TASK: "Delete task",
  CREATE_PRACTICE: "Add active practice",
  START_TIMER: "Start live timer",
  STOP_TIMER: "Stop live timer",
};

const DESTRUCTIVE_TYPES = new Set<CoachProposalActionType>([
  "DELETE_GOAL",
  "DELETE_SCHEDULE_BLOCK",
  "DELETE_TIME_ENTRY",
  "DELETE_TASK",
]);

/**
 * How many action rows are shown before the list folds. Four is what fits
 * above the fold on the shortest phone this app supports while still leaving
 * the header, the footer and a hint of the expander visible — the point is
 * that Apply is always on screen with the card, never a scroll away.
 */
const COLLAPSED_ACTION_LIMIT = 4;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function isDestructiveProposal(block: CoachProposalBlock): boolean {
  return block.actions.some((action) => DESTRUCTIVE_TYPES.has(action.type));
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDayName(value: unknown): string | null {
  return typeof value === "number" ? DAY_NAMES[((value % 7) + 7) % 7] ?? null : null;
}

/**
 * Id -> human name/record lookups against whatever this app's own screens
 * have already pulled into the react-query cache. Every method is
 * best-effort: a cache miss (the item hasn't been fetched yet, or the id is
 * stale) returns null, and every caller MUST treat null as "say something
 * generic instead" — never fall through to printing the id itself. That
 * boundary is what makes it safe to use here at all: this is the one card
 * in the app whose whole job is telling the user what they're agreeing to,
 * so a wrong guess is worse than no guess, but a raw database id is worse
 * than either (see the "Update time entry / #9789e9e2" bug report this
 * exists to fix).
 */
interface ProposalCacheLookups {
  goalName: (id: string) => string | null;
  taskName: (id: string) => string | null;
  scheduleBlockTitle: (id: string) => string | null;
  timeEntry: (id: string) => TimeEntry | null;
}

function findInCachedLists<T>(lists: readonly (T[] | undefined)[], predicate: (item: T) => boolean): T | null {
  for (const list of lists) {
    const hit = list?.find(predicate);
    if (hit) return hit;
  }
  return null;
}

/**
 * Builds the lookups above from whatever is currently in `queryClient`'s
 * cache — a scan over already-fetched pages (goals/tasks/schedule/recent
 * time entries), never a network request of its own. Cheap enough to build
 * fresh on every render: the lists involved are a single user's data, not
 * something worth memoizing against staleness.
 */
function buildProposalCacheLookups(queryClient: QueryClient): ProposalCacheLookups {
  const goalLists = queryClient
    .getQueriesData<Goal[]>({ queryKey: [...goalQueries.goalQueries.all, "list"] })
    .map(([, data]) => data);
  const taskLists = queryClient
    .getQueriesData<Task[]>({ queryKey: [...taskQueries.taskQueries.all, "list"] })
    .map(([, data]) => data);
  const timeEntryLists = queryClient
    .getQueriesData<TimeEntry[]>({ queryKey: timeEntryQueries.timeEntryQueries.all })
    .map(([, data]) => data);
  const scheduleBlockLists = queryClient
    .getQueriesData<WeekSchedule>({ queryKey: scheduleQueries.scheduleQueries.root() })
    .map(([, week]) => (week ? Object.values(week).flat() : undefined)) as (ScheduleBlock[] | undefined)[];

  return {
    goalName: (id) => findInCachedLists(goalLists, (g) => g.id === id)?.title ?? null,
    taskName: (id) => findInCachedLists(taskLists, (t) => t.id === id)?.title ?? null,
    scheduleBlockTitle: (id) => findInCachedLists(scheduleBlockLists, (b) => b.id === id)?.title ?? null,
    timeEntry: (id) => findInCachedLists(timeEntryLists, (e) => e.id === id),
  };
}

/** A `goalId` value, resolved to a human name — handling both a real id (via the cache) and a same-batch "$ref:N" pointing at a not-yet-created CREATE_GOAL action (see collapseMultiDayBlocks / apply-proposals.dto.ts for the token format). */
function resolveGoalIdName(
  value: unknown,
  allActions: readonly CoachProposalAction[],
  lookups: ProposalCacheLookups,
): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ref = /^\$ref:(\d+)$/.exec(value);
  if (ref) {
    const target = allActions[Number(ref[1])];
    if (!target || target.type !== "CREATE_GOAL") return null;
    const targetPayload = target.payload ?? {};
    return readString(targetPayload, "title") ?? readString(targetPayload, "name");
  }
  return lookups.goalName(value);
}

/** What the cache knows about the entity THIS action's own id/type targets — the "before" snapshot the payload itself never carries, since UPDATE_* payloads are partial (only the field actually changing). */
function resolveCachedTarget(
  action: CoachProposalAction,
  lookups: ProposalCacheLookups,
): { name: string | null; duration?: number; date?: string } | null {
  const id = action.id;
  if (!id) return null;
  switch (action.type) {
    case "RENAME_GOAL":
    case "UPDATE_GOAL":
    case "DELETE_GOAL":
      return { name: lookups.goalName(id) };
    case "UPDATE_SCHEDULE_BLOCK":
    case "DELETE_SCHEDULE_BLOCK":
      // The Coach is required to send the block's current title as
      // `expectedTitle` whenever the user named it — check that (free, no
      // cache dependency) before a lookup that could miss.
      return { name: action.expectedTitle ?? lookups.scheduleBlockTitle(id) };
    case "UPDATE_TASK":
    case "DELETE_TASK":
      return { name: lookups.taskName(id) };
    case "UPDATE_TIME_ENTRY":
    case "DELETE_TIME_ENTRY": {
      const entry = lookups.timeEntry(id);
      return entry ? { name: entry.taskName, duration: entry.duration, date: entry.date } : null;
    }
    default:
      return null;
  }
}

/**
 * Summary of a proposed action's payload. Shows the fields the model
 * actually sent (title, times, date, duration) plus, when the payload alone
 * has nothing to show, whatever the cache already knows about the id being
 * targeted — an id-only edit like `{ goalId }` (the entire content of a
 * "link these to that goal" batch) otherwise describes nothing at all.
 *
 * A cache miss never falls back to printing the id itself — see
 * ProposalCacheLookups' doc comment. Worst case, a row shows only the action
 * label with no detail line, same as it always could for a genuinely empty
 * payload.
 */
function describeProposalAction(
  action: CoachProposalAction,
  lookups: ProposalCacheLookups,
  allActions: readonly CoachProposalAction[],
): string | null {
  const payload = action.payload ?? {};

  // The timer actions carry none of the fields the generic path below looks
  // for: START_TIMER is only "who is this for" (no duration — nobody knows it
  // until the user stops), and STOP_TIMER's payload is usually empty because
  // its fields exist only to override what the running session already holds.
  // Spell out what Apply does instead of leaving a bare label on a card the
  // user is about to act on.
  if (action.type === "START_TIMER" || action.type === "STOP_TIMER") {
    const target = readString(payload, "taskName") ?? readString(payload, "goalName");
    if (action.type === "START_TIMER") {
      return target
        ? `Starts the clock on "${target}" now, and runs until you stop it`
        : "Starts the clock now, and runs until you stop it";
    }
    return target
      ? `Stops the running timer and logs the time to "${target}"`
      : "Stops the running timer and saves the elapsed time as an entry";
  }

  const bits: string[] = [];
  const cached = resolveCachedTarget(action, lookups);

  // What the thing is called. Models are inconsistent about which key holds
  // it, so take the first that is actually present; failing that, fall back
  // to whatever the cache knows the target was already called.
  const name =
    readString(payload, "title") ??
    readString(payload, "name") ??
    readString(payload, "taskName") ??
    readString(payload, "goalName") ??
    cached?.name ??
    null;
  if (name !== null) bits.push(`"${name}"`);

  // The goal a block/task/entry is being attached to, when that isn't
  // already the name above — this is the whole content of a "link these to
  // that goal" batch. `goalName` (a readable string) is rare; the model
  // almost always sends `goalId` instead, which used to be dropped on the
  // floor entirely because nothing resolved it to a name.
  const goalName = readString(payload, "goalName") ?? resolveGoalIdName(payload.goalId, allActions, lookups);
  if (goalName !== null && goalName !== name) bits.push(`goal "${goalName}"`);

  const start = readString(payload, "startTime");
  const end = readString(payload, "endTime");
  if (start !== null && end !== null) bits.push(`${start}–${end}`);
  else if (start !== null) bits.push(`from ${start}`);

  const days = payload.daysOfWeek;
  if (Array.isArray(days)) {
    const named = days.map(readDayName).filter((day): day is string => day !== null);
    if (named.length > 0) bits.push(named.join(", "));
  } else {
    const day = readDayName(payload.dayOfWeek);
    if (day !== null) bits.push(day);
  }

  const date = readString(payload, "date") ?? cached?.date ?? null;
  if (date !== null) bits.push(date);

  const deadline = readString(payload, "deadline");
  if (deadline !== null) bits.push(`due ${deadline}`);

  const duration = typeof payload.duration === "number" ? payload.duration : cached?.duration;
  if (duration !== undefined) bits.push(`${duration} min`);

  const status = readString(payload, "status");
  if (status !== null) bits.push(status.toLowerCase());

  // No raw id fallback here, ever — see this function's doc comment. A row
  // with nothing to say beyond its action label is a strictly better
  // outcome than one that leaks a database primary key.
  return bits.length > 0 ? bits.join(" · ") : null;
}

/** One line naming everything a destructive batch will remove. */
function describeDeletions(block: CoachProposalBlock, lookups: ProposalCacheLookups): string {
  const deletions = block.actions.filter((action) => DESTRUCTIVE_TYPES.has(action.type));
  const named = deletions
    .map((action) => describeProposalAction(action, lookups, block.actions))
    .filter((description): description is string => description !== null);
  if (named.length === 0) return "This removes data that can't be brought back.";
  return `This permanently removes ${named.join(", ")}.`;
}

export interface CoachProposalCardProps {
  block: CoachProposalBlock;
  /**
   * Applies the batch. Resolves with a sentence to show on success, rejects
   * with a user-facing message. Omit to render the card read-only — the
   * offline case, and anywhere there is no live conversation to apply
   * against.
   */
  onApply?: (actions: CoachProposalAction[]) => Promise<string>;
  /** Dismisses without applying. Omit to hide the dismiss control. */
  onDismiss?: () => void;
}

type CardState =
  | { phase: "idle" }
  | { phase: "applying" }
  | { phase: "applied"; message: string }
  | { phase: "failed"; message: string };

interface ActionRowProps {
  action: CoachProposalAction;
  destructive: boolean;
  lookups: ProposalCacheLookups;
  allActions: readonly CoachProposalAction[];
}

function ActionRow({ action, destructive, lookups, allActions }: ActionRowProps) {
  const detail = describeProposalAction(action, lookups, allActions);
  return (
    <View style={styles.row}>
      <View style={[styles.rowMarker, destructive && styles.rowMarkerDestructive]} />
      {/* flexShrink is 0 by default in React Native, so this column has to
          say so explicitly — without it a long dictated title makes the row
          wider than the card instead of wrapping inside it. */}
      <View style={styles.rowBody}>
        <Text
          style={[styles.actionLabel, destructive && styles.actionLabelDestructive]}
          numberOfLines={1}
        >
          {ACTION_LABELS[action.type] ?? action.type}
        </Text>
        {detail !== null ? (
          <Text style={styles.actionDetail} numberOfLines={3} ellipsizeMode="tail">
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function CoachProposalCard({ block, onApply, onDismiss }: CoachProposalCardProps) {
  const [state, setState] = useState<CardState>({ phase: "idle" });
  const [expanded, setExpanded] = useState(false);
  const destructive = useMemo(() => isDestructiveProposal(block), [block]);
  // Rebuilt fresh each render (not memoized against `block`) — it's a cheap
  // scan over whatever's already in cache, and staleness here would mean
  // showing a name that's a render behind rather than one that's wrong.
  const queryClient = useQueryClient();
  const lookups = buildProposalCacheLookups(queryClient);

  const run = useCallback(async () => {
    if (onApply === undefined) return;
    setState({ phase: "applying" });
    try {
      const message = await onApply(block.actions);
      setState({ phase: "applied", message });
    } catch (err) {
      setState({
        phase: "failed",
        message: err instanceof Error ? err.message : "Couldn't apply that change.",
      });
    }
  }, [block.actions, onApply]);

  const handleApply = useCallback(() => {
    if (!destructive) {
      void run();
      return;
    }
    // Second gate, and the platform's own alert rather than an in-card
    // confirm: a delete should look like every other delete in the OS, and
    // the destructive button style is what a user reads before the words.
    Alert.alert("Apply this change?", describeDeletions(block, lookups), [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run() },
    ]);
  }, [block, destructive, lookups, run]);

  const applying = state.phase === "applying";
  const applied = state.phase === "applied";
  const actionCount = block.actions.length;
  const hidden = Math.max(0, actionCount - COLLAPSED_ACTION_LIMIT);
  const visibleActions = expanded ? block.actions : block.actions.slice(0, COLLAPSED_ACTION_LIMIT);
  const countLabel = `${actionCount} ${actionCount === 1 ? "change" : "changes"}`;
  const summaryForScreenReader = `Proposed change. ${block.summary ?? ""} ${countLabel}.${
    destructive ? " Includes a deletion." : ""
  }`;

  return (
    <View style={[styles.card, applied && styles.cardApplied]}>
      <View
        style={[styles.header, applied && styles.headerApplied]}
        accessible
        accessibilityRole="header"
        accessibilityLabel={summaryForScreenReader}
      >
        <View style={styles.headerTop}>
          <View style={[styles.eyebrow, applied && styles.eyebrowApplied]}>
            {applied ? <Icon name="check" size={iconSize.xs} color={colors.success} /> : null}
            <Text style={[styles.eyebrowText, applied && styles.eyebrowTextApplied]} numberOfLines={1}>
              {applied ? "Applied" : "Proposed change"}
            </Text>
          </View>
          {/* flexShrink:0 keeps the count from being squeezed to nothing by a
              long eyebrow at large font scales. */}
          <Text style={styles.countText} numberOfLines={1}>
            {countLabel}
          </Text>
        </View>

        {block.summary ? (
          <Text style={styles.summary} numberOfLines={4} ellipsizeMode="tail">
            {block.summary}
          </Text>
        ) : null}

        {destructive && !applied ? (
          <View style={styles.warningChip}>
            <Icon name="alert" size={iconSize.xs} color={colors.destructive} />
            <Text style={styles.warningChipText} numberOfLines={2}>
              Includes something that will be deleted
            </Text>
          </View>
        ) : null}
      </View>

      {visibleActions.map((action, index) => (
        <ActionRow
          key={`${action.type}-${index}`}
          action={action}
          destructive={DESTRUCTIVE_TYPES.has(action.type)}
          lookups={lookups}
          allActions={block.actions}
        />
      ))}

      {hidden > 0 ? (
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show fewer changes" : `Show all ${actionCount} changes`}
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.expander, pressed && styles.pressed]}
        >
          <Text style={styles.expanderText} numberOfLines={1}>
            {expanded ? "Show fewer" : `Show all ${actionCount} changes`}
          </Text>
          <View style={expanded ? styles.chevronUp : undefined}>
            <Icon name="chevron-down" size={iconSize.sm} color={colors.mutedForeground} />
          </View>
        </Pressable>
      ) : null}

      {state.phase === "applied" ? (
        <View style={styles.resultRow} accessibilityLiveRegion="polite">
          <Icon name="check" size={iconSize.sm} color={colors.success} />
          <Text style={styles.resultText}>{state.message}</Text>
        </View>
      ) : null}

      {state.phase === "failed" ? (
        <View style={styles.errorRow} accessibilityRole="alert">
          <Icon name="alert" size={iconSize.sm} color={colors.destructive} />
          <Text style={styles.errorText}>{state.message}</Text>
        </View>
      ) : null}

      {onApply === undefined ? (
        <Text style={styles.footnote}>
          {destructive ? "Includes a delete. " : ""}
          Preview only — nothing has changed.
        </Text>
      ) : applied ? (
        onDismiss ? (
          <View style={styles.footer}>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this applied change"
              style={({ pressed }) => [
                styles.button,
                styles.dismissButton,
                styles.dismissButtonSolo,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.dismissText} numberOfLines={1}>
                Done
              </Text>
            </Pressable>
          </View>
        ) : null
      ) : (
        <View style={styles.footer}>
          {onDismiss ? (
            <Pressable
              onPress={onDismiss}
              disabled={applying}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this proposed change"
              style={({ pressed }) => [styles.button, styles.dismissButton, pressed && styles.pressed]}
            >
              <Text style={styles.dismissText} numberOfLines={1}>
                Not now
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleApply}
            disabled={applying}
            accessibilityRole="button"
            accessibilityLabel={
              destructive
                ? `Apply ${actionCount === 1 ? "this change" : `these ${actionCount} changes`}, including a deletion`
                : `Apply ${actionCount === 1 ? "this change" : `these ${actionCount} changes`}`
            }
            accessibilityState={{ disabled: applying, busy: applying }}
            style={({ pressed }) => [
              styles.button,
              styles.applyButton,
              destructive && styles.applyButtonDestructive,
              applying && styles.applyButtonBusy,
              pressed && styles.pressed,
            ]}
          >
            {applying ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text
                style={[styles.applyText, destructive && styles.applyTextDestructive]}
                numberOfLines={1}
              >
                {state.phase === "failed" ? "Try again" : destructive ? "Review & apply" : "Apply"}
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.xs,
    borderRadius: radii.card,
    borderWidth: 1,
    // A neutral outline, like every other card in the app. This used to be
    // `primaryDark` — a saturated brand-yellow ring — which on the Voice
    // screen sat directly under a solid brand-yellow "You said" bubble and
    // made the whole viewport read as one undifferentiated yellow mass.
    // Brand yellow now appears once per card, on the Apply button.
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  cardApplied: {
    borderColor: colors.success,
  },
  header: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  headerApplied: {
    backgroundColor: colors.successMuted,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  // The brand-tinted chip treatment (yellow-50 fill, yellow-200 border,
  // yellow-700 text) rather than a full-bleed tinted band — see the
  // primaryMuted/primaryBorder/primaryText notes in theme/foundation.ts.
  // Raw #F2CC0D fails contrast as text on white, which is why primaryText
  // exists and is used here instead.
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.chip,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  eyebrowApplied: {
    borderColor: colors.success,
    backgroundColor: colors.successMuted,
  },
  eyebrowText: {
    ...typography.label,
    color: colors.primaryText,
    flexShrink: 1,
  },
  eyebrowTextApplied: {
    color: colors.success,
  },
  countText: {
    ...typography.label,
    color: colors.mutedForeground,
    flexShrink: 0,
  },
  // The card's headline. It was `bodySmall` (12px) — smaller than the
  // detail text under each action row, which inverted the hierarchy and
  // made the one sentence explaining what the user is agreeing to the least
  // prominent text on the card.
  summary: {
    ...typography.title,
    color: colors.foreground,
  },
  warningChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.chip,
    backgroundColor: colors.destructiveMuted,
  },
  warningChipText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    flexShrink: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowMarker: {
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.mutedForegroundLight,
    flexShrink: 0,
    // Optical alignment with the cap height of the label beside it.
    marginTop: spacing.sm,
  },
  rowMarkerDestructive: {
    backgroundColor: colors.destructive,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  actionLabel: {
    ...typography.body,
    fontWeight: "600",
    color: colors.foreground,
  },
  actionLabelDestructive: {
    color: colors.destructive,
  },
  actionDetail: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  expander: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.muted,
  },
  expanderText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.mutedForeground,
    flexShrink: 1,
  },
  chevronUp: {
    transform: [{ rotate: "180deg" }],
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  resultText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.destructiveMuted,
  },
  errorText: {
    ...typography.bodySmall,
    fontWeight: "600",
    color: colors.destructive,
    flex: 1,
  },
  footnote: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footer: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  button: {
    // `flex: 1` alone sets flexBasis to 0, so a label that needs more room
    // than half the card gets truncated rather than widening the button.
    // flexBasis "auto" lets each button start from its intrinsic width and
    // share the remainder, which is what keeps "Review & apply" on one line.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
  },
  dismissButton: {
    flexGrow: 0,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  // The applied state's "Done" is the only control in its footer, so it
  // takes the full width rather than sitting as a lone stub on the left.
  dismissButtonSolo: {
    flexGrow: 1,
  },
  dismissText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.mutedForeground,
  },
  applyButton: {
    backgroundColor: colors.primary,
  },
  applyButtonDestructive: {
    backgroundColor: colors.destructive,
  },
  applyButtonBusy: {
    backgroundColor: colors.foreground,
  },
  pressed: {
    opacity: 0.7,
  },
  applyText: {
    ...typography.body,
    fontWeight: "700",
    color: colors.primaryForeground,
  },
  applyTextDestructive: {
    color: colors.destructiveForeground,
  },
});
