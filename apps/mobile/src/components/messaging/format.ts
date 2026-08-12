// Time and preview formatting for the messaging screens. Pure functions in
// their own module so the fiddly calendar-boundary rules are unit tested
// (format.test.ts) instead of being eyeballed in a running app at 11:59pm.
//
// The rule everywhere here is CALENDAR days, not elapsed hours. A message
// sent at 11pm is "Yesterday" at 1am, not "2 hours ago" — every messaging app
// the user has ever used behaves that way, and elapsed-hours math gets it
// wrong for exactly the timestamps people look at most.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Midnight-to-midnight difference in the device's local zone. */
export function calendarDaysAgo(timestamp: Date, now: Date): number {
  const then = new Date(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - then) / MS_PER_DAY);
}

function parse(iso: string): Date | null {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clockTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${minutes} ${period}`;
}

/**
 * Right-hand timestamp on a conversation row: time today, "Yesterday",
 * weekday within the last week, then a date. Empty string for an unparseable
 * or absent timestamp — a row must never render "Invalid Date".
 */
export function formatConversationTimestamp(iso: string | undefined | null, now: Date = new Date()): string {
  if (!iso) return "";
  const date = parse(iso);
  if (!date) return "";

  const days = calendarDaysAgo(date, now);
  if (days <= 0) return clockTime(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return SHORT_WEEKDAYS[date.getDay()] ?? "";
  if (date.getFullYear() === now.getFullYear()) return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Sticky date heading between runs of messages in a thread. */
export function formatDaySeparator(iso: string, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return "";

  const days = calendarDaysAgo(date, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return WEEKDAYS[date.getDay()] ?? "";
  if (date.getFullYear() === now.getFullYear()) {
    return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}`;
  }
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Whether a day separator belongs above this message. */
export function needsDaySeparator(iso: string, previousIso: string | undefined): boolean {
  if (!previousIso) return true;
  const current = parse(iso);
  const previous = parse(previousIso);
  if (!current || !previous) return false;
  return (
    current.getFullYear() !== previous.getFullYear() ||
    current.getMonth() !== previous.getMonth() ||
    current.getDate() !== previous.getDate()
  );
}

/** Time under a bubble, and the spoken time in its accessibility label. */
export function formatMessageTime(iso: string): string {
  const date = parse(iso);
  return date ? clockTime(date) : "";
}

/**
 * One-line preview of the newest message. Collapses newlines — a multi-line
 * message otherwise renders as a row with a blank second half, since the row
 * clamps to one line.
 */
export function formatMessagePreview(body: string | undefined | null, prefix?: string): string {
  const collapsed = (body ?? "").replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "No messages yet";
  return prefix ? `${prefix}${collapsed}` : collapsed;
}
