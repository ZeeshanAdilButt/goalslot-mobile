// Pure list/copy logic for the Time Tracker's session history.
//
// Split out of SessionHistory.tsx for the same reason tracking-search.ts was
// split out of TrackingPicker.tsx: this repo unit-tests its extracted pure
// layers rather than rendering screens, and the day-grouping maths and the
// destructive-confirmation copy are both things you want a regression test
// on. The component keeps the rendering; everything below is a plain
// function of its arguments.

import { formatDuration, getLocalDateString, type TimeEntry } from "@goalslot/shared";

export type SessionListItem =
  | { kind: "header"; key: string; label: string; minutes: number }
  | { kind: "entry"; key: string; entry: TimeEntry };

/**
 * Formats a `YYYY-MM-DD` key as a day heading. Parsed via the date parts
 * rather than `new Date(dateStr)` — the bare-date form is parsed as UTC
 * midnight, which renders as the previous day for anyone behind UTC (the
 * same trap packages/shared/src/scheduling/time.ts's getLocalDateString
 * documents).
 */
export function formatDayHeading(dateKey: string, todayKey: string, yesterdayKey: string): string {
  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Groups entries into day sections with a per-day total on each header.
 *
 * `now` is injectable purely so the Today/Yesterday branches are testable
 * without freezing the system clock; every caller in the app leaves it
 * defaulted.
 */
export function buildSessionItems(entries: TimeEntry[], now: Date = new Date()): SessionListItem[] {
  const byDay = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }

  const todayKey = getLocalDateString(now);
  const yesterday = new Date(now);
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

/**
 * The name a row shows. `taskTitle` is a real task's denormalised title and
 * wins when present; `taskName` is the free-text name every entry carries
 * (and is the "Untitled session" placeholder for a session tracked against
 * nothing — see timer.tsx's UNRESOLVED_TARGET_LABEL).
 */
export function sessionEntryTitle(entry: TimeEntry): string {
  return entry.taskTitle || entry.taskName;
}

/**
 * One-line screen-reader description of a row. The goal (or its absence) is
 * part of it deliberately: "no goal" is what tells a VoiceOver user which
 * rows the row-level "Add goal" action is worth invoking on, and it is
 * exactly the state the visible hollow dot conveys to everyone else.
 */
export function describeSessionEntry(entry: TimeEntry): string {
  const goalPart = entry.goal?.title ? `, ${entry.goal.title}` : ", no goal";
  return `${sessionEntryTitle(entry)}, ${formatDuration(entry.duration)}${goalPart}`;
}

/**
 * Copy for the delete confirmation.
 *
 * Says what actually disappears — the measured time — rather than "this
 * item", because that is the part the user cannot get back by retyping it.
 * An attributed entry additionally warns that the goal's logged total moves,
 * since the API recomputes it on delete (dw-time-api's time-entries.service)
 * and that consequence is invisible from this screen.
 *
 * Deliberately free of any date formatting: the row is already sitting under
 * its own day heading when this opens, so repeating the date would add a
 * locale-dependent string for no information.
 */
export function describeSessionDelete(entry: TimeEntry): { title: string; description: string } {
  const duration = formatDuration(entry.duration);
  const name = sessionEntryTitle(entry);
  return {
    title: "Delete this session?",
    description: entry.goal?.title
      ? `${duration} logged against "${entry.goal.title}" will be removed, and that goal's logged time goes down by the same amount. This can't be undone.`
      : `${duration} logged as "${name}" will be removed. This can't be undone.`,
  };
}

/** Optimistic cache write for a delete: the list without that entry. */
export function removeSessionEntry(entries: TimeEntry[], entryId: string): TimeEntry[] {
  return entries.filter((entry) => entry.id !== entryId);
}
