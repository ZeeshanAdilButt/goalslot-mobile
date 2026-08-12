// Keeps OS-scheduled alarms in sync with the week's schedule blocks and the
// reminders store, and exposes the on/off actions the Schedule screen calls.
//
// WHY reconcile on every blocks change rather than only on explicit toggles:
// alarms are on by default (schedule-reminders-store.ts), so a block that was
// just created needs its notification scheduled without the user ever
// touching a toggle — that's the whole point of "alerts for those who don't
// turn on the alarms". expo-notifications' scheduleNotificationAsync with a
// stable identifier (reminderIdFor) replaces any existing entry for that id
// rather than stacking a duplicate, so re-running this for blocks that
// haven't actually changed is a harmless no-op, not a bug.
//
// WHY THE RECONCILER IS SPLIT OUT of the actions hook. It used to live in the
// same hook the Schedule screen calls, which meant the app only ever armed
// alarms while that one screen was mounted. That is fine right up until
// something empties the OS queue behind the app's back — and something does:
// session-reset.ts calls `clearAllNotifications()` on sign-IN as well as
// sign-out (deliberately, so a crash between the two can't leak the previous
// account's reminders). After a normal sign-in every alarm was therefore
// cancelled, and nothing re-armed them until the user happened to open the
// Schedule tab. A user who signs in and goes to Today gets no alarms, ever,
// with no way to tell. `useScheduleReminderSync` is mounted once for the
// whole authenticated app instead (see ScheduleRemindersSync.tsx).

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ScheduleBlock } from "@goalslot/shared";

import { useCapabilities } from "@/providers/capabilities-provider";
import {
  resolveReminderEnabled,
  useScheduleRemindersStore,
  type ReminderTarget,
} from "./schedule-reminders-store";
import {
  cancelBlockReminders,
  pruneOrphanReminders,
  reconcileBlockReminders,
  scheduleBlockReminder,
} from "./schedule-reminders";

/**
 * Serialises notification work so a reconcile pass and a manual toggle can't
 * race and leave the OS one step behind the store. Same guard
 * useTimerNotification.ts uses.
 */
function useSerialQueue() {
  const pending = useRef<Promise<void>>(Promise.resolve());
  return useCallback((fn: () => Promise<void>) => {
    pending.current = pending.current.then(fn, fn);
    return pending.current;
  }, []);
}

/** Blocks reduced to what the store needs to place them in the hierarchy. */
function toTargets(blocks: readonly ScheduleBlock[]): ReminderTarget[] {
  return blocks.map((b) => ({ id: b.id, seriesId: b.seriesId }));
}

/**
 * The single owner of "what the OS should currently have queued". Mount once,
 * app-wide, for the whole authenticated session.
 */
export function useScheduleReminderSync(blocks: readonly ScheduleBlock[]): void {
  const { notifications } = useCapabilities();
  const masterEnabled = useScheduleRemindersStore((s) => s.masterEnabled);
  const disabledSeriesIds = useScheduleRemindersStore((s) => s.disabledSeriesIds);
  const disabledBlockIds = useScheduleRemindersStore((s) => s.disabledBlockIds);
  const runQueued = useSerialQueue();

  // `blocks` is a fresh array on every render (query data / positionBlocks),
  // so this keys off what's actually in it rather than referential identity.
  // The times matter as much as the ids: editing a block's start time has to
  // re-arm the alarm at the new time, and an id-only key would miss that.
  const blocksKey = blocks.map((b) => `${b.id}:${b.dayOfWeek}:${b.startTime}:${b.title}`).join("|");

  useEffect(() => {
    const state = { masterEnabled, disabledSeriesIds, disabledBlockIds };
    void runQueued(async () => {
      await reconcileBlockReminders(
        blocks,
        (block) => resolveReminderEnabled(state, { id: block.id, seriesId: block.seriesId }),
        notifications,
      );
      // Only meaningful once there is a real block list to diff against: with
      // `blocks` still empty (first paint, before the weekly query resolves)
      // every queued reminder looks like an orphan, and pruning then would
      // cancel the entire week on every cold start.
      if (blocks.length > 0) await pruneOrphanReminders(blocks, notifications);
    });
    // `blocks` is represented by blocksKey (see above); the three store
    // fields must stay dependencies so flipping any switch cancels or arms
    // immediately, even when the block list itself hasn't changed.
  }, [blocksKey, masterEnabled, disabledSeriesIds, disabledBlockIds, notifications, runQueued]);
}

export interface UseScheduleRemindersResult {
  /** Master switch state — drives the header bell and the "all alarms" row. */
  masterEnabled: boolean;
  setMasterEnabled: (enabled: boolean) => Promise<void>;
  isReminderEnabled: (block: ScheduleBlock) => boolean;
  toggleBlockReminder: (block: ScheduleBlock) => Promise<void>;
  /** True when every block in the group would alarm. */
  isGroupEnabled: (members: readonly ScheduleBlock[]) => boolean;
  setGroupEnabled: (members: readonly ScheduleBlock[], enabled: boolean) => Promise<void>;
}

/**
 * The actions half. Deliberately does NOT reconcile — `useScheduleReminderSync`
 * owns that, and having two reconcilers would mean two sources of truth for
 * the OS queue.
 *
 * Every action cancels eagerly rather than waiting for the sync pass. The
 * sync would get there (its store deps change), but "eventually, once a
 * re-render lands" is the wrong guarantee for switching an alarm off: the
 * user is entitled to assume the thing is silenced the moment the switch
 * moves.
 */
export function useScheduleReminders(blocks: readonly ScheduleBlock[]): UseScheduleRemindersResult {
  const { notifications } = useCapabilities();
  const masterEnabled = useScheduleRemindersStore((s) => s.masterEnabled);
  const disabledSeriesIds = useScheduleRemindersStore((s) => s.disabledSeriesIds);
  const disabledBlockIds = useScheduleRemindersStore((s) => s.disabledBlockIds);
  const setMasterInStore = useScheduleRemindersStore((s) => s.setMasterEnabled);
  const setSeriesInStore = useScheduleRemindersStore((s) => s.setSeriesEnabled);
  const setBlockInStore = useScheduleRemindersStore((s) => s.setBlockEnabled);
  const runQueued = useSerialQueue();

  const state = useMemo(
    () => ({ masterEnabled, disabledSeriesIds, disabledBlockIds }),
    [masterEnabled, disabledSeriesIds, disabledBlockIds],
  );

  const universe = useMemo(() => toTargets(blocks), [blocks]);

  const isReminderEnabled = useCallback(
    (block: ScheduleBlock) => resolveReminderEnabled(state, { id: block.id, seriesId: block.seriesId }),
    [state],
  );

  const isGroupEnabled = useCallback(
    (members: readonly ScheduleBlock[]) => members.length > 0 && members.every(isReminderEnabled),
    [isReminderEnabled],
  );

  /**
   * Silences or unsilences a whole group in one action.
   *
   * Two representations, because the group might not be a real series. When
   * every member shares one `seriesId` the store records it at the SERIES
   * level, which is strictly better: a sixth day added to that series later
   * inherits the setting instead of arriving unsilenced. A lookalike group
   * (see schedule-series.ts — five separately-created "Reading" blocks with
   * five unrelated seriesIds) has no shared key to record against, so it
   * falls back to one block-level entry per member. Same outcome today; the
   * series form is just the one that keeps being true tomorrow.
   */
  const setGroupEnabled = useCallback(
    async (members: readonly ScheduleBlock[], enabled: boolean) => {
      if (members.length === 0) return;
      const seriesIds = new Set(members.map((b) => b.seriesId));
      const isRealSeries = seriesIds.size === 1;

      if (isRealSeries) {
        setSeriesInStore(members[0].seriesId, enabled, universe);
      } else {
        for (const member of members) {
          setBlockInStore({ id: member.id, seriesId: member.seriesId }, enabled, universe);
        }
      }

      await runQueued(async () => {
        if (!enabled) {
          await cancelBlockReminders(members, notifications);
          return;
        }
        for (const block of members) {
          try {
            await scheduleBlockReminder(block, notifications);
          } catch (error) {
            console.warn(`[schedule-reminders] could not arm reminder for block ${block.id}`, error);
          }
        }
      });
    },
    [notifications, runQueued, setBlockInStore, setSeriesInStore, universe],
  );

  const setMasterEnabled = useCallback(
    async (enabled: boolean) => {
      setMasterInStore(enabled);
      await runQueued(async () => {
        if (!enabled) {
          // Cancel everything now. Leaving already-queued alarms to fire
          // after a master OFF is the exact failure the switch exists to
          // prevent, and it is worse than having no switch at all.
          await cancelBlockReminders(blocks, notifications);
          return;
        }
        for (const block of blocks) {
          try {
            await scheduleBlockReminder(block, notifications);
          } catch (error) {
            console.warn(`[schedule-reminders] could not arm reminder for block ${block.id}`, error);
          }
        }
      });
    },
    [blocks, notifications, runQueued, setMasterInStore],
  );

  const toggleBlockReminder = useCallback(
    async (block: ScheduleBlock) => {
      const nextEnabled = !isReminderEnabled(block);
      setBlockInStore({ id: block.id, seriesId: block.seriesId }, nextEnabled, universe);
      await runQueued(async () => {
        try {
          if (nextEnabled) {
            await scheduleBlockReminder(block, notifications);
          } else {
            await cancelBlockReminders([block], notifications);
          }
        } catch (error) {
          console.warn(`[schedule-reminders] could not toggle reminder for block ${block.id}`, error);
        }
      });
    },
    [isReminderEnabled, notifications, runQueued, setBlockInStore, universe],
  );

  return {
    masterEnabled,
    setMasterEnabled,
    isReminderEnabled,
    toggleBlockReminder,
    isGroupEnabled,
    setGroupEnabled,
  };
}
