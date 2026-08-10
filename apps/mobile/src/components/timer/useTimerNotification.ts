// Keeps a persistent "GoalSlot is timing this session" entry in the OS
// notification shade for as long as the timer is running or paused.
//
// WHY this exists: the timer's only visible surface used to be the Time
// Tracker screen itself, so a session left running while the user was
// somewhere else in the app (or out of it entirely) was invisible — you
// couldn't tell a running timer from a stopped one without navigating back.
//
// WHY it doesn't go through `NotificationCapability` end-to-end: that port
// (packages/shared/src/capabilities/index.ts) models exactly one thing —
// "schedule a notification to fire at `fireAtUtc`, and cancel it if it
// hasn't fired yet". An ongoing notification is the opposite shape: it is
// presented immediately, must be flagged `sticky`/non-auto-dismissing, needs
// a dedicated low-importance Android channel so re-presenting it on
// pause/resume doesn't re-alert, and is removed with
// `dismissNotificationAsync` (which clears an *already delivered*
// notification) rather than `cancelScheduledNotificationAsync` (which only
// drops a *pending* one — calling it here would leave the shade entry
// stranded forever). None of that is expressible through the current port,
// and this branch doesn't own packages/shared or src/lib/notifications.ts.
// So: the permission ASK — the one part the port does model — still goes
// through `useCapabilities().notifications.requestPermission()`, and only
// the present/dismiss calls reach for expo-notifications directly. The
// clean follow-up is to add a `presentOngoing`/`dismissOngoing` pair to
// NotificationCapability and move the two calls below behind it.
//
// KNOWN LIMITATION: this is a plain notification, not an Android foreground
// service, so it does not keep the process alive. If the OS kills the app
// the notification can linger until the app is next opened (the effect
// below reconciles it on mount). Elapsed time is deliberately never baked
// into the running notification's text — it would go stale the moment the
// app is backgrounded and there's no periodic-update hook to refresh it —
// so the body shows the fixed wall-clock start time instead, which stays
// true no matter how long the shade entry sits there.

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { formatDuration } from "@goalslot/shared";

import type { TimerStatus } from "@/lib/timer-store";
import { useCapabilities } from "@/providers/capabilities-provider";
import { colors } from "@/theme/tokens";

/** Stable identifier so every present() replaces the previous entry in place rather than stacking. */
const TIMER_NOTIFICATION_ID = "goalslot-timer-session";

/**
 * Android 8+ routes notifications through channels, and IMPORTANCE_LOW is
 * what makes a re-presented notification update silently (no sound, no
 * heads-up peek) — required because pause/resume re-presents the same entry.
 */
const ANDROID_CHANNEL_ID = "goalslot-timer";

interface TimerNotificationArgs {
  status: TimerStatus;
  /** Epoch ms the current running segment began; null while paused/idle (see timer-store.ts). */
  startedAt: number | null;
  /** Elapsed ms banked across previous segments — the frozen total while paused. */
  pausedElapsedMs: number;
  /** Task or goal title being tracked, or null when nothing was selected. */
  label: string | null;
}

function describeSession(args: TimerNotificationArgs): { title: string; body: string } | null {
  const what = args.label ?? "Focus session";

  if (args.status === "running") {
    // Wall-clock start, not elapsed — see the header note on staleness.
    const startedLabel =
      args.startedAt !== null
        ? new Date(args.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : null;
    return {
      title: `Tracking · ${what}`,
      body: startedLabel ? `Started at ${startedLabel}` : "Timer running",
    };
  }

  if (args.status === "paused") {
    return {
      title: `Paused · ${what}`,
      // `formatDuration` takes whole minutes — the same summary formatting
      // the recent-entries list uses, so a paused session reads in the same
      // units as the entry it will eventually become.
      body: `${formatDuration(Math.round(args.pausedElapsedMs / 60000))} tracked so far`,
    };
  }

  return null;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Timer",
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
    showBadge: false,
  });
}

/**
 * Presents (or silently replaces) the ongoing entry. Returns false when the
 * OS refused — the caller treats that as "no notification, carry on", never
 * as a timer failure.
 */
async function presentOngoing(
  content: { title: string; body: string },
  requestPermission: () => Promise<boolean>,
): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;

  // Only prompt when the OS will actually show a prompt; a previously-denied
  // user must never get a no-op dialog every time they press Start.
  if (!granted && current.canAskAgain) {
    granted = await requestPermission();
  }
  if (!granted) return false;

  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: TIMER_NOTIFICATION_ID,
    content: {
      title: content.title,
      body: content.body,
      // Android: ongoing (un-swipeable) and not cleared by tapping it, so
      // the only things that remove it are pause->stop or this hook.
      sticky: true,
      autoDismiss: false,
      sound: false,
      color: colors.primary,
      priority: Notifications.AndroidNotificationPriority.LOW,
      // iOS equivalent of a low-importance channel: deliver quietly, no
      // sound or banner interruption on re-present.
      interruptionLevel: "passive",
      // Deliberately no `data`: src/lib/deep-links.ts's
      // DeepLinkNotificationData has no "timer" case, and mapping a timer
      // tap onto one of its existing routes (goal/task list) would land the
      // user somewhere they didn't ask for. Without it, a tap just opens
      // the app. Adding a `{ type: "timer" }` case there is the follow-up.
    },
    // A null trigger presents immediately; the channel-aware form does the
    // same on Android while pinning the entry to the quiet channel above.
    trigger: Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
  });
  return true;
}

async function dismissOngoing(): Promise<void> {
  await Notifications.dismissNotificationAsync(TIMER_NOTIFICATION_ID);
}

/**
 * Mirrors the timer store's status into the notification shade.
 *
 * Mounted by the Time Tracker screen only, which is sufficient because every
 * transition that matters (start / pause / resume / stop) can only be
 * triggered from that screen — once presented, the shade entry survives
 * navigating away or backgrounding on its own. Mounting with `status: "idle"`
 * also clears a stale entry left behind by a process kill.
 */
export function useTimerNotification(args: TimerNotificationArgs): void {
  const { notifications } = useCapabilities();
  const { status, startedAt, pausedElapsedMs, label } = args;

  // Notification calls are async and this effect can re-fire faster than
  // they settle (start -> pause in quick succession). Chaining every update
  // onto the previous one guarantees they apply in the order they were
  // requested, so a stale present() can never land after a dismiss().
  const pending = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const content = describeSession({ status, startedAt, pausedElapsedMs, label });

    const apply = async () => {
      try {
        if (content === null) {
          await dismissOngoing();
          return;
        }
        await presentOngoing(content, () => notifications.requestPermission());
      } catch (error) {
        // Never surface this: a missing notification is a degraded nicety,
        // the timer itself is unaffected and keeps its own state.
        console.warn("[timer] could not update the ongoing timer notification", error);
      }
    };

    pending.current = pending.current.then(apply, apply);
  }, [notifications, status, startedAt, pausedElapsedMs, label]);
}
