// Keeps OS-scheduled reminder notifications in sync with the current week's
// schedule blocks and the reminders store's disabled-ids set, and exposes
// the on/off actions the Schedule screen's UI calls.
//
// WHY reconcile on every blocks change rather than only on explicit toggles:
// reminders are on by default (schedule-reminders-store.ts), so a block that
// was just created needs its notification scheduled without the user ever
// touching a toggle — that's the whole point of "alerts for those who don't
// turn on the alarms". expo-notifications' scheduleNotificationAsync with a
// stable identifier (reminderIdFor) replaces any existing entry for that id
// rather than stacking a duplicate, so re-running this for blocks that
// haven't actually changed is a harmless no-op, not a bug.

import { useEffect, useRef } from "react";

import type { ScheduleBlock } from "@goalslot/shared";

import { useCapabilities } from "@/providers/capabilities-provider";
import { useScheduleRemindersStore } from "./schedule-reminders-store";
import { cancelBlockReminder, scheduleBlockReminder } from "./schedule-reminders";

export interface UseScheduleRemindersResult {
  isReminderEnabled: (blockId: string) => boolean;
  toggleBlockReminder: (block: ScheduleBlock) => Promise<void>;
  /** True when every block currently in view has its reminder on — drives the bulk bell's icon/label. */
  allEnabled: boolean;
  enableAllReminders: () => Promise<void>;
  disableAllReminders: () => Promise<void>;
}

export function useScheduleReminders(blocks: readonly ScheduleBlock[]): UseScheduleRemindersResult {
  const { notifications } = useCapabilities();
  const disabledBlockIds = useScheduleRemindersStore((s) => s.disabledBlockIds);
  const isReminderEnabledInStore = useScheduleRemindersStore((s) => s.isReminderEnabled);
  const setReminderEnabled = useScheduleRemindersStore((s) => s.setReminderEnabled);
  const disableAllInStore = useScheduleRemindersStore((s) => s.disableAll);
  const enableAllInStore = useScheduleRemindersStore((s) => s.enableAll);

  // Same "don't let an in-flight call finish out of order" guard
  // useTimerNotification.ts uses — a reconcile pass and a manual toggle can
  // otherwise race and leave the OS-scheduled state one step behind the
  // store.
  const pending = useRef<Promise<void>>(Promise.resolve());
  const runQueued = (fn: () => Promise<void>) => {
    pending.current = pending.current.then(fn, fn);
    return pending.current;
  };

  // Reconcile whenever the actual set of blocks or the disabled-ids set
  // changes. `blocks` is a fresh array every render (positionBlocks/query
  // data), so this keys off the ids actually present rather than referential
  // identity.
  const blockIdsKey = blocks.map((b) => b.id).join(",");
  useEffect(() => {
    runQueued(async () => {
      for (const block of blocks) {
        try {
          if (isReminderEnabledInStore(block.id)) {
            await scheduleBlockReminder(block, notifications);
          } else {
            await cancelBlockReminder(block, notifications);
          }
        } catch (error) {
          // A single block's reminder failing to (re)schedule must not break
          // the rest of the week's reminders or the schedule screen itself.
          console.warn(`[schedule-reminders] could not reconcile reminder for block ${block.id}`, error);
        }
      }
    });
    // blockIdsKey stands in for `blocks` (see above); disabledBlockIds must
    // stay a dependency so toggling a block off cancels it even if the
    // blocks array itself hasn't changed.
  }, [blockIdsKey, disabledBlockIds, notifications]);

  const toggleBlockReminder = async (block: ScheduleBlock) => {
    const nextEnabled = !isReminderEnabledInStore(block.id);
    setReminderEnabled(block.id, nextEnabled);
    await runQueued(() =>
      nextEnabled ? scheduleBlockReminder(block, notifications) : cancelBlockReminder(block, notifications),
    );
  };

  const allEnabled = blocks.length > 0 && blocks.every((b) => isReminderEnabledInStore(b.id));

  const enableAllReminders = async () => {
    const ids = blocks.map((b) => b.id);
    enableAllInStore(ids);
    await runQueued(async () => {
      for (const block of blocks) {
        try {
          await scheduleBlockReminder(block, notifications);
        } catch (error) {
          console.warn(`[schedule-reminders] could not enable reminder for block ${block.id}`, error);
        }
      }
    });
  };

  const disableAllReminders = async () => {
    const ids = blocks.map((b) => b.id);
    disableAllInStore(ids);
    await runQueued(async () => {
      for (const block of blocks) {
        try {
          await cancelBlockReminder(block, notifications);
        } catch (error) {
          console.warn(`[schedule-reminders] could not disable reminder for block ${block.id}`, error);
        }
      }
    });
  };

  return {
    isReminderEnabled: isReminderEnabledInStore,
    toggleBlockReminder,
    allEnabled,
    enableAllReminders,
    disableAllReminders,
  };
}
