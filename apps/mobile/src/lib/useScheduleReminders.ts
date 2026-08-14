// Keeps OS-scheduled reminders in sync with the week's schedule blocks and
// the reminders store, and exposes the tier-setting actions the Schedule
// screen calls.
//
// WHY reconcile on every blocks change rather than only on explicit tier
// changes: reminders are on ("alarm") by default (schedule-reminders-store.ts),
// so a block that was just created needs its notification scheduled without
// the user ever touching a control — that's the whole point of "alerts for
// those who don't turn on the alarms". expo-notifications' scheduleNotificationAsync
// with a stable identifier (reminderIdFor) replaces any existing entry for
// that id rather than stacking a duplicate, so re-running this for blocks
// that haven't actually changed is a harmless no-op, not a bug.
//
// WHY THE RECONCILER IS SPLIT OUT of the actions hook. It used to live in the
// same hook the Schedule screen calls, which meant the app only ever armed
// reminders while that one screen was mounted. That is fine right up until
// something empties the OS queue behind the app's back — and something does:
// session-reset.ts calls `clearAllNotifications()` on sign-IN as well as
// sign-out (deliberately, so a crash between the two can't leak the previous
// account's reminders). After a normal sign-in every reminder was therefore
// cancelled, and nothing re-armed them until the user happened to open the
// Schedule tab. A user who signs in and goes to Today gets no reminders,
// ever, with no way to tell. `useScheduleReminderSync` is mounted once for
// the whole authenticated app instead (see ScheduleRemindersSync.tsx).

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ScheduleBlock } from "@goalslot/shared";

import { useCapabilities } from "@/providers/capabilities-provider";
import {
  resolveReminderTier,
  useScheduleRemindersStore,
  type ReminderTarget,
  type ReminderTier,
  type ScheduleRemindersPersistedState,
} from "./schedule-reminders-store";
import {
  cancelBlockReminders,
  pruneOrphanReminders,
  reconcileBlockReminders,
  scheduleBlockReminder,
} from "./schedule-reminders";

/**
 * Serialises notification work so a reconcile pass and a manual tier change
 * can't race and leave the OS one step behind the store. Same guard
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

/** Arms a block at its resolved tier, or cancels it if that tier is "off". */
async function armOrCancel(
  block: ScheduleBlock,
  tier: ReminderTier,
  notifications: Parameters<typeof scheduleBlockReminder>[1],
): Promise<void> {
  if (tier === "off") {
    await cancelBlockReminders([block], notifications);
    return;
  }
  await scheduleBlockReminder(block, notifications, tier);
}

/**
 * The single owner of "what the OS should currently have queued". Mount once,
 * app-wide, for the whole authenticated session.
 */
export function useScheduleReminderSync(blocks: readonly ScheduleBlock[]): void {
  const { notifications } = useCapabilities();
  const masterTier = useScheduleRemindersStore((s) => s.masterTier);
  const seriesTierOverrides = useScheduleRemindersStore((s) => s.seriesTierOverrides);
  const blockTierOverrides = useScheduleRemindersStore((s) => s.blockTierOverrides);
  const runQueued = useSerialQueue();

  // `blocks` is a fresh array on every render (query data / positionBlocks),
  // so this keys off what's actually in it rather than referential identity.
  // The times matter as much as the ids: editing a block's start time has to
  // re-arm the reminder at the new time, and an id-only key would miss that.
  const blocksKey = blocks.map((b) => `${b.id}:${b.dayOfWeek}:${b.startTime}:${b.title}`).join("|");

  useEffect(() => {
    const state: ScheduleRemindersPersistedState = { masterTier, seriesTierOverrides, blockTierOverrides };
    void runQueued(async () => {
      await reconcileBlockReminders(
        blocks,
        (block) => resolveReminderTier(state, { id: block.id, seriesId: block.seriesId }),
        notifications,
      );
      // Only meaningful once there is a real block list to diff against: with
      // `blocks` still empty (first paint, before the weekly query resolves)
      // every queued reminder looks like an orphan, and pruning then would
      // cancel the entire week on every cold start.
      if (blocks.length > 0) await pruneOrphanReminders(blocks, notifications);
    });
    // `blocks` is represented by blocksKey (see above); the three store
    // fields must stay dependencies so changing any tier cancels or arms
    // immediately, even when the block list itself hasn't changed.
  }, [blocksKey, masterTier, seriesTierOverrides, blockTierOverrides, notifications, runQueued]);
}

export interface UseScheduleRemindersResult {
  /** Master tier — drives the header bell and the "all reminders" row. */
  masterTier: ReminderTier;
  setMasterTier: (tier: ReminderTier) => Promise<void>;
  getReminderTier: (block: ScheduleBlock) => ReminderTier;
  setBlockTier: (block: ScheduleBlock, tier: ReminderTier) => Promise<void>;
  /** Drops a block's own override, falling back to inheriting its series (or master) tier. */
  clearBlockReminderOverride: (block: ScheduleBlock) => Promise<void>;
  /** The tier every block in the group shares, or "mixed" when they don't all agree. */
  getGroupTier: (members: readonly ScheduleBlock[]) => ReminderTier | "mixed";
  setGroupTier: (members: readonly ScheduleBlock[], tier: ReminderTier) => Promise<void>;
}

/**
 * The actions half. Deliberately does NOT reconcile — `useScheduleReminderSync`
 * owns that, and having two reconcilers would mean two sources of truth for
 * the OS queue.
 *
 * Every action arms/cancels eagerly rather than waiting for the sync pass.
 * The sync would get there (its store deps change), but "eventually, once a
 * re-render lands" is the wrong guarantee for changing a reminder's tier: the
 * user is entitled to assume the change took effect the moment the control
 * moves.
 */
export function useScheduleReminders(blocks: readonly ScheduleBlock[]): UseScheduleRemindersResult {
  const { notifications } = useCapabilities();
  const masterTier = useScheduleRemindersStore((s) => s.masterTier);
  const seriesTierOverrides = useScheduleRemindersStore((s) => s.seriesTierOverrides);
  const blockTierOverrides = useScheduleRemindersStore((s) => s.blockTierOverrides);
  const setMasterInStore = useScheduleRemindersStore((s) => s.setMasterTier);
  const setSeriesInStore = useScheduleRemindersStore((s) => s.setSeriesTier);
  const setBlockInStore = useScheduleRemindersStore((s) => s.setBlockTier);
  const clearBlockInStore = useScheduleRemindersStore((s) => s.clearBlockOverride);
  const runQueued = useSerialQueue();

  const state = useMemo(
    (): ScheduleRemindersPersistedState => ({ masterTier, seriesTierOverrides, blockTierOverrides }),
    [masterTier, seriesTierOverrides, blockTierOverrides],
  );

  const universe = useMemo(() => toTargets(blocks), [blocks]);

  const getReminderTier = useCallback(
    (block: ScheduleBlock) => resolveReminderTier(state, { id: block.id, seriesId: block.seriesId }),
    [state],
  );

  const getGroupTier = useCallback(
    (members: readonly ScheduleBlock[]): ReminderTier | "mixed" => {
      if (members.length === 0) return "mixed";
      const [first, ...rest] = members.map(getReminderTier);
      return rest.every((tier) => tier === first) ? first : "mixed";
    },
    [getReminderTier],
  );

  /**
   * Sets a whole group's tier in one action.
   *
   * Two representations, because the group might not be a real series. When
   * every member shares one `seriesId` the store records it at the SERIES
   * level, which is strictly better: a sixth day added to that series later
   * inherits the setting instead of arriving at the master tier. A lookalike
   * group (see schedule-series.ts — five separately-created "Reading" blocks
   * with five unrelated seriesIds) has no shared key to record against, so it
   * falls back to one block-level override per member. Same outcome today;
   * the series form is just the one that keeps being true tomorrow.
   */
  const setGroupTier = useCallback(
    async (members: readonly ScheduleBlock[], tier: ReminderTier) => {
      if (members.length === 0) return;
      const seriesIds = new Set(members.map((b) => b.seriesId));
      const isRealSeries = seriesIds.size === 1;

      if (isRealSeries) {
        setSeriesInStore(members[0].seriesId, tier, universe);
      } else {
        for (const member of members) {
          setBlockInStore({ id: member.id, seriesId: member.seriesId }, tier, universe);
        }
      }

      await runQueued(async () => {
        for (const block of members) {
          try {
            await armOrCancel(block, tier, notifications);
          } catch (error) {
            console.warn(`[schedule-reminders] could not set reminder tier for block ${block.id}`, error);
          }
        }
      });
    },
    [notifications, runQueued, setBlockInStore, setSeriesInStore, universe],
  );

  const setMasterTier = useCallback(
    async (tier: ReminderTier) => {
      setMasterInStore(tier);
      await runQueued(async () => {
        for (const block of blocks) {
          try {
            // Individual overrides still win over the master change — the
            // store already accounts for that, so re-resolve per block
            // rather than assuming every block now sits at `tier`.
            const resolved = resolveReminderTier(
              { masterTier: tier, seriesTierOverrides, blockTierOverrides },
              { id: block.id, seriesId: block.seriesId },
            );
            await armOrCancel(block, resolved, notifications);
          } catch (error) {
            console.warn(`[schedule-reminders] could not arm reminder for block ${block.id}`, error);
          }
        }
      });
    },
    [blocks, blockTierOverrides, notifications, runQueued, seriesTierOverrides, setMasterInStore],
  );

  const setBlockTier = useCallback(
    async (block: ScheduleBlock, tier: ReminderTier) => {
      setBlockInStore({ id: block.id, seriesId: block.seriesId }, tier, universe);
      await runQueued(async () => {
        try {
          await armOrCancel(block, tier, notifications);
        } catch (error) {
          console.warn(`[schedule-reminders] could not set reminder tier for block ${block.id}`, error);
        }
      });
    },
    [notifications, runQueued, setBlockInStore, universe],
  );

  const clearBlockReminderOverride = useCallback(
    async (block: ScheduleBlock) => {
      clearBlockInStore({ id: block.id, seriesId: block.seriesId });
      await runQueued(async () => {
        try {
          const resolved = resolveReminderTier(
            { masterTier, seriesTierOverrides, blockTierOverrides: {} },
            { id: block.id, seriesId: block.seriesId },
          );
          await armOrCancel(block, resolved, notifications);
        } catch (error) {
          console.warn(`[schedule-reminders] could not clear reminder override for block ${block.id}`, error);
        }
      });
    },
    [clearBlockInStore, masterTier, notifications, runQueued, seriesTierOverrides],
  );

  return {
    masterTier,
    setMasterTier,
    getReminderTier,
    setBlockTier,
    clearBlockReminderOverride,
    getGroupTier,
    setGroupTier,
  };
}
