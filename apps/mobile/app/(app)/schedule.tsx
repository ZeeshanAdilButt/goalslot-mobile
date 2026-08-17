// The Schedule screen — a single day rendered on a real time axis.
//
// This screen used to be a flat agenda list of cards, on the reasoning that
// the web's 7-day drag grid doesn't fit a phone (see packages/shared/src/
// scheduling/grid.ts's header and dw-time-mobile/DECISIONS.md #5). That's
// still true of the *drag grid*, but throwing out the time axis with it threw
// out the thing that makes a schedule legible: dw-time-web/src/features/
// schedule/components/schedule-grid/schedule-grid.tsx positions and sizes
// every block from `timeToMinutes(...) * PX_PER_MIN` against an hour-ruled
// canvas, so duration and empty time are visible rather than implied. This
// screen now does the same for one day at a time. The layout math lives in
// src/components/schedule/layout.ts; the drag/resize interactions do not
// come along.
//
// Still intentionally thin: all time math comes from packages/shared/src/
// scheduling, and the only local logic is wiring the query cache, the day
// selection, and the minute ticker that keeps "now" honest.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import {
  DAYS_OF_WEEK_FULL,
  formatDuration,
  genId,
  type CreateScheduleBlockInput,
  type ScheduleBlock,
  type ScheduleDeleteScope,
  type WeekSchedule,
} from "@goalslot/shared";

import { ErrorState } from "@/components";
import {
  BlockDetailSheet,
  DayStrip,
  getDayWindow,
  minuteToY,
  positionBlocks,
  ScheduleBlockSheet,
  Timeline,
  TimelineSkeleton,
  type ScheduleBlockSheetRef,
} from "@/components/schedule";
import { Icon } from "@/components/ui/Icon";
import { useScreenView } from "@/hooks/useScreenView";
import { apiClient, notify } from "@/lib/api-client";
import { parseScheduleDayParam } from "@/lib/deep-links";
import { getErrorMessage } from "@/lib/get-error-message";
import { hapticLight } from "@/lib/haptics";
import { queueOfflineEdit } from "@/lib/offline";
import { scheduleQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { cancelBlockReminders } from "@/lib/schedule-reminders";
import { findLinkedBlocks } from "@/lib/schedule-series";
import { useScheduleReminders } from "@/lib/useScheduleReminders";
import { useCapabilities } from "@/providers/capabilities-provider";
import { useAnalytics } from "@/providers/growth-provider";
// `typeScale` is the primitive half of the same token set `tokens.ts` re-exports
// (both resolve to theme/foundation.ts) — used here only where a semantic role
// needs a larger size than its default, so no number is invented locally.
import { typography as typeScale } from "@/theme";
import { colors, radii, shadows, spacing, typography } from "@/theme/tokens";

// Sunday=0 ... Saturday=6, matching Date.getDay() / WeekSchedule's keys —
// fixed at module load for the *initial* selection only; the live day index
// used for rendering is derived from the ticking clock below so a session left
// open across midnight doesn't keep calling yesterday "today".
const TODAY_INDEX = new Date().getDay();
const DAYS_IN_WEEK = 7;
/** Matches the web's 30s activeBlock ticker (schedule-page.tsx), halved cost. */
const CLOCK_TICK_MS = 60_000;
/** How far above the now line to park the scroll, so context sits above it. */
const NOW_SCROLL_HEADROOM = 140;
const BLOCK_SCROLL_HEADROOM = 24;
/** Same value index.tsx uses to keep header content clear of the floating hamburger (_layout.tsx). */
const HAMBURGER_CLEARANCE = 64;

/**
 * A deleted block reduced back to the payload that would create it again.
 *
 * There is no undelete endpoint — `DELETE /schedule/:id` is final — so undo
 * is a re-create, and this is the whole reason it's cheap enough to offer:
 * the screen already holds the complete blocks it just removed, so nothing
 * has to be re-fetched or reconstructed from a diff.
 *
 * `seriesId` is carried over deliberately rather than left for the server to
 * mint fresh. The reminders store keys a series' alarm tier by seriesId
 * (src/lib/schedule-reminders-store.ts), so restoring under the original id
 * brings the series' alarm setting back with the blocks. A tier set on one
 * individual block does NOT survive: the server assigns new row ids, and
 * nothing on the client can map the old id onto the new row.
 */
function toCreateInput(block: ScheduleBlock): CreateScheduleBlockInput {
  return {
    title: block.title,
    startTime: block.startTime,
    endTime: block.endTime,
    dayOfWeek: block.dayOfWeek,
    category: block.category,
    color: block.color,
    isRecurring: block.isRecurring,
    isPrivate: block.isPrivate,
    goalId: block.goalId,
    seriesId: block.seriesId,
  };
}

export default function ScheduleScreen() {
  const analytics = useAnalytics();
  const router = useRouter();
  const { notifications } = useCapabilities();
  // Notification-tap deep link: `/schedule?day=N` (see
  // src/lib/deep-links.ts's `scheduleDayDeepLink`/`resolveNotificationRoute`
  // — this is both the local schedule-block alarm's own tap target and
  // `scheduleDayDeepLink`'s shareable-link contract). Read once at mount to
  // seed the initial day; after that the day pills/swipe own `selectedDay`,
  // same "consume once" pattern journal.tsx's `voice` param and timer.tsx's
  // `autostart` param already use. Previously this param was silently
  // ignored — a schedule alarm tap opened the Schedule tab on TODAY_INDEX
  // regardless of which day the block it was nudging about actually fell
  // on, e.g. a Tuesday alarm tapped on a Thursday landed on Thursday.
  const { day: dayParam } = useLocalSearchParams<{ day?: string }>();
  const [selectedDay, setSelectedDay] = useState(() => parseScheduleDayParam(dayParam) ?? TODAY_INDEX);
  // Whether the bell's promise is actually being kept: `reminders.masterTier`
  // is only this app's own intent, not proof the OS will do anything with it.
  // A user who denied (or never granted) the system notification permission
  // still sees the bell as fully "on" with zero indication that nothing will
  // ever actually ring — the alarms get silently, permanently dropped by
  // notifications.ts's own permission check, and there was previously no way
  // to notice short of stumbling onto Settings > Notifications. Re-read on
  // every focus, same as notification-settings.tsx's own permission row —
  // granting happens by leaving for the OS Settings app and coming back.
  const [notificationsBlocked, setNotificationsBlocked] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [detailBlock, setDetailBlock] = useState<ScheduleBlock | null>(null);

  const blockSheetRef = useRef<ScheduleBlockSheetRef>(null);
  const detailRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Offset the incoming day should land on, consumed once by the ScrollView's
  // onContentSizeChange. `scrollTo` is clamped against whatever contentSize the
  // native view still holds at the moment it's called, and a day change swaps
  // the canvas for one of a different height inside the same commit — so the
  // effect below can only *ask* for a position; this is what lands it.
  const pendingScrollY = useRef<number | null>(null);
  // Day the viewport has already been positioned for. Null until data arrives.
  const landedDay = useRef<number | null>(null);

  useScreenView("schedule");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void notifications.getPermissionStatus().then((status) => {
        if (!cancelled) setNotificationsBlocked(status !== "granted");
      });
      return () => {
        cancelled = true;
      };
    }, [notifications]),
  );

  // Keeps the now line, the active-block emphasis and the past/upcoming split
  // truthful while the screen sits open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const weeklyQuery = useQuery(scheduleQueries.weekly());

  // Cached-first: `isPending` (data === undefined) already reflects "nothing
  // to show yet" whether that's a cold first load or an empty persisted
  // cache — unlike `isLoading`, it stays false once persisted/cached data
  // exists even while a background refetch is in flight, so a revisit never
  // flashes a blocking skeleton over data that's already on screen.
  const showSkeleton = weeklyQuery.isPending;

  const todayIndex = now.getDay();
  const nowMinutes = selectedDay === todayIndex ? now.getHours() * 60 + now.getMinutes() : null;

  // Midnight of the day `now` falls in, as a plain timestamp. The clock above
  // ticks every minute but the week only turns over at midnight, so keying the
  // week off a primitive day boundary keeps `weekDates` referentially stable
  // between ticks — otherwise all seven pills get fresh Date props, and their
  // React.memo does nothing, sixty times an hour.
  const todayStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    [now],
  );

  // Sunday-first dates for the week `now` falls in, so each day pill can show
  // its real calendar date rather than just a weekday abbreviation.
  const weekDates = useMemo(() => {
    const sunday = new Date(todayStart);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    return Array.from({ length: DAYS_IN_WEEK }, (_, index) => {
      const date = new Date(sunday);
      date.setDate(sunday.getDate() + index);
      return date;
    });
  }, [todayStart]);

  const blockCounts = useMemo(
    () => Array.from({ length: DAYS_IN_WEEK }, (_, index) => weeklyQuery.data?.[index]?.length ?? 0),
    [weeklyQuery.data],
  );

  const entries = useMemo(
    () => positionBlocks(weeklyQuery.data?.[selectedDay] ?? []),
    [weeklyQuery.data, selectedDay],
  );

  // Every block across the whole week, not just the selected day — reminders
  // cover "all schedule blocks" per the user's own words, not just whichever
  // day happens to be open right now.
  const allBlocks = useMemo(() => Object.values(weeklyQuery.data ?? {}).flat(), [weeklyQuery.data]);
  const reminders = useScheduleReminders(allBlocks);

  // The other days the open block is part of — a real series, or a lookalike
  // group the app inferred. Drives both the detail sheet's "all N days"
  // alarm switch and its delete prompt. See src/lib/schedule-series.ts.
  const detailLinked = useMemo(
    () => (detailBlock ? findLinkedBlocks(detailBlock, allBlocks).members : []),
    [detailBlock, allBlocks],
  );

  const dayWindow = useMemo(
    () => getDayWindow(weeklyQuery.data?.[selectedDay] ?? []),
    [weeklyQuery.data, selectedDay],
  );

  const scheduledMinutes = useMemo(
    () => entries.reduce((total, entry) => total + (entry.endMin - entry.startMin), 0),
    [entries],
  );

  // Land the viewport where the day's attention belongs — on the now line for
  // today, on the first block otherwise — instead of at whatever hour the
  // window happens to start.
  useEffect(() => {
    if (showSkeleton) return;
    // Landing the viewport is a once-per-day-selection courtesy, not a standing
    // behaviour. `entries` gets a fresh identity on every background refetch
    // (react-query hands back a new object, positionBlocks maps a new array),
    // and re-running this then would yank the day out from under someone
    // mid-read every time a refetch resolved.
    if (landedDay.current === selectedDay) return;
    landedDay.current = selectedDay;

    const target =
      nowMinutes !== null
        ? minuteToY(nowMinutes, dayWindow) - NOW_SCROLL_HEADROOM
        : entries.length > 0
          ? minuteToY(entries[0].startMin, dayWindow) - BLOCK_SCROLL_HEADROOM
          : 0;
    const y = Math.max(0, target);
    pendingScrollY.current = y;
    scrollRef.current?.scrollTo({ y, animated: true });
    // `nowMinutes` is read but deliberately NOT a dependency: it changes every
    // minute, and re-scrolling the viewport under someone who is reading their
    // day would be hostile. The effect only fires when the day, the data, or
    // the window actually changes, and reads the current minute at that point.
  }, [selectedDay, showSkeleton, entries, dayWindow]);

  // The "Undo" behind the delete toast. Puts the blocks back in the cache
  // immediately — the tap has to be answered on screen, not after a round
  // trip — then re-creates each one, then invalidates so the restored rows
  // pick up the ids the server actually assigned (they are new rows; only
  // their contents are the old ones).
  //
  // Reminders re-arm themselves without any help here: ScheduleRemindersSync
  // reconciles OS notifications from the block list app-wide, so the refetch
  // below is what re-queues the alarms this delete cancelled.
  //
  // Deliberately un-tracked, unlike every other create path in the app: an
  // undone delete is a correction, not a block the user set out to make, and
  // counting it as `scheduleBlockCreated` would inflate creation numbers with
  // rows that already existed a moment earlier.
  const restoreBlocks = useCallback(async (blocks: ScheduleBlock[]) => {
    const weeklyKey = scheduleQueries.scheduleQueries.weeklyKey();

    queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
      const week = { ...(existing ?? {}) };
      for (const block of blocks) {
        week[block.dayOfWeek] = [...(week[block.dayOfWeek] ?? []), block];
      }
      return week;
    });

    let queuedAny = false;
    let rejected = false;
    let lastError: unknown = null;
    // One key per block, minted before the live call and reused verbatim if
    // that attempt has to queue — never a fresh one at outbox time. This is
    // the same rule ScheduleBlockSheet.tsx's handleCreate follows and the
    // reason it mints its own per-day keys: `queueOfflineEdit` defaults to
    // `genId()` when no key is passed, so an unkeyed create that actually
    // committed server-side before the client timed out would be replayed
    // under a DIFFERENT key and be indistinguishable from a brand-new
    // request — restoring a block the undo had already restored.
    const idempotencyKeys = blocks.map(() => genId());

    for (const [index, block] of blocks.entries()) {
      const payload = toCreateInput(block);
      const idempotencyKey = idempotencyKeys[index];
      try {
        await apiClient.schedule.create(payload, { idempotencyKey });
      } catch (err) {
        // Same offline treatment the delete itself gets: connectivity can
        // drop in the seconds between deleting and undoing, and "your undo
        // silently failed" is the worst possible outcome for a control whose
        // entire job is rescuing a mistake.
        const queued = await queueOfflineEdit(
          "schedule-block-create",
          payload,
          err,
          idempotencyKey,
        );
        if (queued) {
          queuedAny = true;
        } else {
          rejected = true;
          lastError = err;
          break;
        }
      }
    }

    // Unconditional, and after the loop rather than in a success branch: a
    // partially-restored series (some created, one rejected) leaves the cache
    // holding blocks that don't all exist, and only the server knows which.
    void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });

    if (rejected) {
      console.error(lastError);
      notify(
        getErrorMessage(lastError, "Those time slots weren't restored — please add them again."),
        "error",
      );
      return;
    }
    if (queuedAny) {
      notify("Queued — will sync when online", "offline");
      return;
    }
    notify(blocks.length === 1 ? "Time slot restored" : `${blocks.length} time slots restored`, "success");
  }, []);

  // Deleting is the one series operation the API has no scope for: PUT
  // /schedule/:id honours `updateScope: 'series'` server-side, but DELETE
  // /schedule/:id deletes exactly one row and takes no scope. So a series
  // delete is fanned out here, one request per member — the same shape the
  // multi-day CREATE already uses (ScheduleBlockSheet.tsx), for the same
  // reason: no bulk endpoint exists.
  const handleDeleteBlock = useCallback(
    async (block: ScheduleBlock, scope: ScheduleDeleteScope) => {
      const weeklyKey = scheduleQueries.scheduleQueries.weeklyKey();
      const previous = queryClient.getQueryData<WeekSchedule>(weeklyKey);

      const targets = scope === "series" ? findLinkedBlocks(block, allBlocks).members : [block];
      const targetIds = new Set(targets.map((b) => b.id));

      queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
        const week = { ...(existing ?? {}) };
        for (const key of Object.keys(week)) {
          const dayIndex = Number(key);
          week[dayIndex] = (week[dayIndex] ?? []).filter((entry) => !targetIds.has(entry.id));
        }
        return week;
      });

      // Cancel the alarms before the requests, not after. These are weekly
      // and indefinite: a deleted block whose notification is still queued
      // keeps announcing itself every week with nothing left to open, and
      // once the block is gone from the cache the reconciler can't find it
      // to cancel either. (pruneOrphanReminders in useScheduleReminders.ts
      // is the safety net for the ones that got away — including blocks
      // deleted on the web — but the direct path shouldn't rely on it.)
      await cancelBlockReminders(targets, notifications);

      // Sequential, not Promise.all: a series delete is N independent
      // requests, and each one's outcome — real success, queued offline, or
      // a genuine rejection — has to be known individually. Mirrors
      // ScheduleBlockSheet.tsx's create/update loops, which route the same
      // per-target distinction through the already-registered
      // "schedule-block-delete" outbox operation rather than a second,
      // parallel offline mechanism.
      let rejected = false;
      let queuedAny = false;
      let lastError: unknown = null;
      for (const target of targets) {
        try {
          await apiClient.schedule.delete(target.id);
          analytics.track({ name: "scheduleBlockDeleted", payload: { scheduleBlockId: target.id } });
        } catch (err) {
          const queued = await queueOfflineEdit("schedule-block-delete", { id: target.id }, err);
          if (queued) {
            queuedAny = true;
          } else {
            rejected = true;
            lastError = err;
            break;
          }
        }
      }

      if (rejected) {
        queryClient.setQueryData(weeklyKey, previous);
        // A series delete is N independent requests and some may have
        // succeeded before one was rejected, so the rollback above can put
        // blocks back that no longer exist. Refetch to find out what
        // actually survived rather than leaving a cache that's confidently
        // wrong.
        void queryClient.invalidateQueries({ queryKey: scheduleQueries.scheduleQueries.root() });
        console.error(lastError);
        notify(getErrorMessage(lastError, "That time slot is still there — please try again."), "error");
        return;
      }

      // Every target either deleted live or queued — the optimistic removal
      // above already reflects that, so there's nothing left to roll back.
      // Queued deletes need no `pendingSync` tag the way a queued create/edit
      // does: the row is already gone from the list, and there is no
      // "pending" version of gone to show.
      if (queuedAny) {
        // No undo offered on this path on purpose. The delete is sitting in
        // the outbox unsent, so "undo" would mean enqueueing a create for a
        // row the server still has and a delete for it in front — two
        // opposing writes racing to replay, ending in whichever order the
        // drain happens to pick. Deleting again once online is honest;
        // an undo that might not stick is not.
        notify("Queued — will sync when online", "offline");
        return;
      }

      // The block is gone from a timeline the user is looking at, with the
      // detail sheet closing over the top of it — the least verifiable kind
      // of change this screen makes, and previously a completely silent one.
      // The toast both confirms it happened and is the only place the undo
      // can live: `targets` holds the full blocks, so the offer costs nothing
      // but the closure.
      notify(
        targets.length === 1 ? "Time slot deleted" : `${targets.length} time slots deleted`,
        "success",
        { action: { label: "Undo", onPress: () => void restoreBlocks(targets) } },
      );
    },
    [allBlocks, analytics, notifications, restoreBlocks],
  );

  // Every "+" affordance on this screen (FAB, an empty hour row, the
  // empty-state CTA) opens the full create sheet directly rather than
  // QuickAddSheet's title-only flow — QuickAddSheet has no start/end time or
  // multi-day selection (see its own header comment on why it stays that
  // way), which is exactly the gap this screen exists to close ("cant even
  // add a slot at proper time... cant select that a slot can be for multiple
  // days"). QuickAddSheet itself is untouched and still used by Today/Goals/
  // Tasks for their own kind="goal"/"task"/"slot" quick-adds.
  const presentCreateSheet = useCallback(
    (startTime?: string) => {
      hapticLight();
      blockSheetRef.current?.present({ mode: "create", dayOfWeek: selectedDay, startTime });
    },
    [selectedDay],
  );

  // The FAB has no time in mind, so the sheet keeps the web's 09:00 default.
  // Wrapped rather than passed straight to `onPress`, which would hand the
  // gesture event in as the start time.
  const openCreateSheet = useCallback(() => {
    presentCreateSheet();
  }, [presentCreateSheet]);

  // An hour row does have a time in mind — its own label already says "Add a
  // block at 3 PM", so the sheet has to actually open there.
  const handlePressEmptyHour = useCallback(
    (hour: number) => {
      presentCreateSheet(`${String(hour).padStart(2, "0")}:00`);
    },
    [presentCreateSheet],
  );

  const handleSelectBlock = useCallback((block: ScheduleBlock) => {
    setDetailBlock(block);
    detailRef.current?.present();
  }, []);

  const handleEditBlock = useCallback((block: ScheduleBlock) => {
    blockSheetRef.current?.present({ mode: "edit", block });
  }, []);

  const dayLabel = DAYS_OF_WEEK_FULL[selectedDay];
  const blockCount = entries.length;
  const summaryMeta =
    blockCount === 0
      ? "Nothing scheduled"
      : `${blockCount} ${blockCount === 1 ? "block" : "blocks"} · ${formatDuration(scheduledMinutes)}`;
  // Spoken separately from the visible string: the "·" the eye reads as a
  // separator is announced as a word (or skipped) by a screen reader.
  const summaryLabel =
    blockCount === 0
      ? `${dayLabel}, nothing scheduled`
      : `${dayLabel}, ${blockCount} ${blockCount === 1 ? "block" : "blocks"}, ${formatDuration(scheduledMinutes)} scheduled`;

  // A STICKY master switch, not a bulk edit of the blocks that happen to
  // exist right now. The previous version added every current block id to a
  // disabled set, so the next block the user created came back on and the
  // switch had silently undone itself — see schedule-reminders-store.ts.
  // A single tap only ever moves between the two ends of the tier scale —
  // fully on (loud alarms) and fully off — not through "notify" too. Cycling
  // three states off one small icon is a bad fit for a single tap target,
  // and "notify" as a global default isn't the ask anyway: it's meant to be
  // an exception a user sets per block/series from BlockDetailSheet, not
  // what the whole week defaults to.
  const handleToggleAllReminders = useCallback(() => {
    hapticLight();
    // Toggling this store's tier can't fix a blocked OS permission — the
    // switch would just flip from "on and silently doing nothing" to "off
    // and doing nothing on purpose", with the same invisible root cause
    // either way. Route to the one place that actually can (device Settings,
    // via notification-settings.tsx) instead of pretending the tap worked.
    if (notificationsBlocked) {
      router.push("/notification-settings");
      return;
    }
    void reminders.setMasterTier(reminders.masterTier === "off" ? "alarm" : "off");
  }, [notificationsBlocked, reminders, router]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          {/* Web PageHeader's eyebrow/title/description trio (schedule-page.tsx). */}
          <View style={styles.headerTitles}>
            <Text style={styles.eyebrow}>Plan your week</Text>
            <Text style={styles.headerTitle}>Schedule</Text>
          </View>

          {/* Master on/off for every schedule alarm, right from this screen —
              "ability to be able to turn on alarms for all schedule blocks
              and also ability to stop all or one, right from schedule
              screen". Series and per-block control live in BlockDetailSheet.
              Never disabled on an empty week: this is a standing preference,
              and it has to be settable before the blocks it will govern
              exist. */}
          <Pressable
            style={({ pressed }) => [styles.remindersToggle, pressed && styles.remindersTogglePressed]}
            onPress={handleToggleAllReminders}
            // The circle reads better at 36 than at 44 next to the title, so
            // the touch target is bought back with hitSlop (36 + 2×8 = 52),
            // the same trade the floating hamburger makes in _layout.tsx.
            hitSlop={spacing.sm}
            accessibilityRole={notificationsBlocked ? "button" : "switch"}
            accessibilityLabel={
              notificationsBlocked ? "Schedule alarms are blocked" : "All schedule alarms"
            }
            accessibilityHint={
              notificationsBlocked
                ? "Notifications are off for GoalSlot, so alarms won't ring. Opens notification settings to fix it."
                : reminders.masterTier !== "off"
                  ? "Turns off every schedule alarm, including slots you add later"
                  : "Turns every schedule alarm back on"
            }
            accessibilityState={notificationsBlocked ? undefined : { checked: reminders.masterTier !== "off" }}
          >
            <Icon
              name={reminders.masterTier !== "off" ? "bell" : "bell-off"}
              size={20}
              color={
                notificationsBlocked
                  ? colors.warning
                  : reminders.masterTier !== "off"
                    ? colors.foreground
                    : colors.mutedForeground
              }
            />
            {/* Only worth flagging while the switch itself is "on" — off is
                already unambiguous, and doubling up the warning there would
                just be noise. */}
            {notificationsBlocked && reminders.masterTier !== "off" ? (
              <View style={styles.remindersToggleWarningDot} />
            ) : null}
          </Pressable>
        </View>
      </View>

      <DayStrip
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        weekDates={weekDates}
        blockCounts={blockCounts}
        onSelectDay={setSelectedDay}
      />

      {/* One accessible node, not two: the day and its load are a single fact,
          and reading them as separate stops makes the reader walk the header
          twice before it reaches the timeline. */}
      <View style={styles.summaryRow} accessible accessibilityRole="header" accessibilityLabel={summaryLabel}>
        <Text style={styles.summaryDay}>{dayLabel}</Text>
        <Text style={styles.summaryMeta}>{summaryMeta}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        // Lands the offset the day-change effect asked for, once the new
        // canvas has actually been measured. See `pendingScrollY`.
        onContentSizeChange={() => {
          const y = pendingScrollY.current;
          if (y === null) return;
          pendingScrollY.current = null;
          scrollRef.current?.scrollTo({ y, animated: false });
        }}
        // Once a finger is on the timeline the day has been read on the user's
        // terms, and no pending landing gets to override that.
        onScrollBeginDrag={() => {
          pendingScrollY.current = null;
        }}
        refreshControl={
          <RefreshControl
            refreshing={weeklyQuery.isFetching && !weeklyQuery.isPending}
            onRefresh={() => {
              void weeklyQuery.refetch();
            }}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {showSkeleton ? (
          <TimelineSkeleton />
        ) : weeklyQuery.isError && !weeklyQuery.data ? (
          // `&& !weeklyQuery.data`, matching goals.tsx/tasks.tsx's own
          // read-path guard: without it, a background refetch failing
          // offline (e.g. switching days after the initial load already
          // cached a full week) replaces an already-rendered day with a
          // hard error screen instead of just continuing to show the stale
          // cached week — the same regression the offline-support pass just
          // fixed on journal.tsx and note/[id].tsx's equivalent guards.
          <ErrorState
            message="Couldn't load your schedule."
            onRetry={() => {
              void weeklyQuery.refetch();
            }}
          />
        ) : (
          // Always the real grid, even on a day with zero blocks — an
          // illustrated "wide open" card used to replace it entirely, which
          // read as a small floating card in a lot of blank space rather than
          // an actual calendar. getDayWindow([]) already falls back to a
          // sensible waking-hours window (layout.ts), and every hour row is
          // still its own tap-to-add target via onPressEmptyHour below, so an
          // empty day loses nothing — it just looks like a real, empty day.
          <Timeline
            // Remounting on day change re-runs each block's entrance stagger,
            // which is what signals "this is a different day" when the header
            // above barely changes.
            key={selectedDay}
            window={dayWindow}
            entries={entries}
            nowMinutes={nowMinutes}
            onSelectBlock={handleSelectBlock}
            onPressEmptyHour={handlePressEmptyHour}
          />
        )}
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={openCreateSheet}
        accessibilityRole="button"
        accessibilityLabel="Add time slot"
      >
        <Icon name="add" size={26} color={colors.primaryForeground} />
      </Pressable>

      <ScheduleBlockSheet ref={blockSheetRef} />
      <BlockDetailSheet
        ref={detailRef}
        block={detailBlock}
        onDelete={handleDeleteBlock}
        onEdit={handleEditBlock}
        onDismiss={() => setDetailBlock(null)}
        reminderTier={detailBlock ? reminders.getReminderTier(detailBlock) : "alarm"}
        onChangeReminderTier={(tier) => detailBlock && void reminders.setBlockTier(detailBlock, tier)}
        seriesSize={detailLinked.length}
        seriesTier={detailLinked.length > 0 ? reminders.getGroupTier(detailLinked) : "alarm"}
        onChangeSeriesTier={(tier) => void reminders.setGroupTier(detailLinked, tier)}
      />
    </SafeAreaView>
  );
}

const FAB_SIZE = 56;
/**
 * Bottom padding on the timeline's scroll content. Derived from the FAB's own
 * footprint (its bottom offset + its height + a gap) rather than picked, so
 * the last hour of the day can never end up parked under the button.
 */
const SCROLL_BOTTOM_INSET = spacing.xxl + FAB_SIZE + spacing.lg;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  // The gap this carries used to sit on `header`, which has a single child —
  // so the eyebrow and the title were flush against each other.
  headerTitles: {
    gap: spacing.xxs,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    // Keeps the bell button clear of the floating hamburger (_layout.tsx),
    // which overlays the whole screen at a fixed top-right position rather
    // than living inside this header.
    paddingRight: HAMBURGER_CLEARANCE,
  },
  remindersToggle: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // This circle previously had no press feedback at all — a static hit
  // against every other tappable surface on this screen (day pills, blocks,
  // the FAB below) that all give something back under a finger.
  remindersTogglePressed: {
    backgroundColor: colors.secondary,
  },
  // A borrowed-background ring (not a hairline) so the dot reads as cut out
  // of the circle behind it rather than sitting flush on top of the icon.
  remindersToggleWarningDot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: radii.full,
    backgroundColor: colors.warning,
    borderWidth: 2,
    borderColor: colors.card,
  },
  eyebrow: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  headerTitle: {
    ...typography.h1,
    fontSize: typeScale.size.xxl,
    color: colors.foreground,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // `headline`, not `h2` — h2 is the small uppercase group-label role
  // (see tokens.ts), which made the day name read like a caption sitting
  // under the pills rather than the heading it actually is for everything
  // below it. Headline gives it real weight in the hierarchy, one step under
  // the "Schedule" screen title and clearly above the meta line beside it.
  summaryDay: {
    ...typography.headline,
    color: colors.foreground,
  },
  summaryMeta: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCROLL_BOTTOM_INSET,
  },
  fab: {
    position: "absolute",
    right: spacing.xl,
    bottom: spacing.xxl,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.fab,
  },
  // Every other pressable on this screen (day pills, blocks) gives a spring
  // scale-down under a finger; the FAB — the screen's single most-used
  // control — had nothing. A flat opacity dip is enough to read as "pressed"
  // without pulling in Reanimated for a one-off static state.
  fabPressed: {
    opacity: 0.85,
  },
});
