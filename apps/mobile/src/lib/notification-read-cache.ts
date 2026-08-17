// Pure cache transforms for "this notification is now read", extracted out of
// app/(app)/notifications.tsx so they can be tested without a screen, a
// QueryClient or a network (see notification-read-cache.test.ts).
//
// WHY THE CACHE IS PATCHED RATHER THAN INVALIDATED. An invalidate on an
// infinite query re-fetches EVERY page the user has already scrolled through,
// in order. For a mark-all-read that is the exact opposite of the point: the
// whole reason the endpoint is one `updateMany` is that the user cannot
// afford per-row cost, and following it with N page refetches hands that cost
// straight back on the read side. `readAt` is the only field that changed, so
// only that changes here — no request, no scroll jitter.
//
// THE UNREAD COUNT IS NOT DERIVED FROM THESE PAGES. It is read from the
// server's own response (`unreadCount`, which mark-all-read defines as 0 by
// construction — it just cleared every unread row in that scope). Counting
// unread rows across the loaded pages would be wrong in the ordinary case: a
// user with 60 unread notifications has 20 of them in the cache, so the badge
// would drop to 40 the moment they marked the visible page read. The pages
// are a window; the count is a total.
//
// THAT SAID, `markAllNotificationsReadInPages` below DOES write the server's
// total onto every cached page's own `unreadCount` field (never computes it).
// notifications.tsx reads its "does the user have anything left to mark
// read" flag — `canMarkAllRead` — straight off `pages[0]?.unreadCount`, the
// same field this module documents as the frozen snapshot from whichever
// fetch last populated it. A patch that only touched `readAt` (the original
// shape of this function) left that snapshot exactly where it was before the
// call — e.g. 43 — so the "Mark all read" button/action never disappeared
// after successfully clearing everything, and stayed tappable indefinitely.
// Stamping the just-cleared total onto the cached pages keeps that read
// truthful without a follow-up request, the same "patch, don't invalidate"
// principle every other transform in this file already follows for `readAt`.

import type { AppNotification, NotificationListResponse } from "@goalslot/shared";

/**
 * The `InfiniteData` shape react-query stores for the notification list.
 * Written structurally rather than imported as `InfiniteData<...>` so this
 * module stays free of react-query types and testable as plain data.
 */
export interface NotificationPages {
  pages: NotificationListResponse[];
  pageParams: unknown[];
}

function withReadAt(item: AppNotification, readAtIso: string): AppNotification {
  // An already-read row keeps its ORIGINAL timestamp. Overwriting it would
  // re-date a notification the user read last week to "just now", which is
  // visible: NotificationRow renders a relative time.
  return item.readAt ? item : { ...item, readAt: readAtIso };
}

function mapItems(
  existing: NotificationPages | undefined,
  map: (item: AppNotification) => AppNotification,
): NotificationPages | undefined {
  if (!existing) return existing;
  return {
    ...existing,
    // `pageParams` is carried through untouched: it holds the cursors
    // react-query replays on a refetch, and rewriting it would break paging.
    pages: existing.pages.map((page) => ({ ...page, items: page.items.map(map) })),
  };
}

/** One row read — used by a row tap. */
export function markNotificationReadInPages(
  existing: NotificationPages | undefined,
  id: string,
  readAtIso: string,
): NotificationPages | undefined {
  return mapItems(existing, (item) => (item.id === id ? withReadAt(item, readAtIso) : item));
}

/**
 * One row removed — used by the swipe-to-delete action. Filters rather than
 * maps, unlike everything else in this file: a delete changes which rows
 * exist, not a field on an existing row.
 *
 * Deliberately returns whether the removed row was unread, alongside the new
 * pages: the caller needs that to decide whether to decrement the separate
 * `unreadCount` cache entry (see markNotificationReadInPages's onSuccess in
 * notifications.tsx for why that count lives under its own key rather than
 * being derived from these pages).
 */
export function removeNotificationFromPages(
  existing: NotificationPages | undefined,
  id: string,
): { pages: NotificationPages | undefined; removedWasUnread: boolean } {
  if (!existing) return { pages: existing, removedWasUnread: false };

  let removedWasUnread = false;
  const pages = existing.pages.map((page) => {
    const items = page.items.filter((item) => {
      if (item.id !== id) return true;
      removedWasUnread = !item.readAt;
      return false;
    });
    return items.length === page.items.length ? page : { ...page, items };
  });

  return { pages: { ...existing, pages }, removedWasUnread };
}

/**
 * Every loaded row read — used by "Mark all read".
 *
 * Only the pages currently in cache are touched, and that is correct rather
 * than a shortfall: the server cleared the whole scope in one statement, and
 * any page fetched after this comes back from the server already read.
 *
 * `unreadCount` is the server's post-clear total for the scope (mark-all-read
 * always returns 0 — see `MarkAllNotificationsReadResponse`'s docblock in
 * packages/shared/src/api/notifications.ts). It gets stamped onto EVERY
 * loaded page's `unreadCount` field, not just read and discarded: that field
 * is what `canMarkAllRead` reads (via `pages[0]?.unreadCount` in
 * notifications.tsx) to decide whether the control is still worth showing.
 * Leaving it untouched — as this function originally did — meant the button
 * kept reporting the PRE-clear total (e.g. 43) and stayed visible and
 * tappable after a call that had already succeeded, since nothing short of a
 * full refetch would otherwise refresh it.
 */
export function markAllNotificationsReadInPages(
  existing: NotificationPages | undefined,
  readAtIso: string,
  unreadCount: number,
): NotificationPages | undefined {
  if (!existing) return existing;
  const withReadRows = mapItems(existing, (item) => withReadAt(item, readAtIso));
  if (!withReadRows) return withReadRows;
  return {
    ...withReadRows,
    pages: withReadRows.pages.map((page) => ({ ...page, unreadCount })),
  };
}

/**
 * Whether "Mark all read" has anything to do — drives whether the control is
 * rendered at all.
 *
 * Deliberately keyed on the SERVER's unread total for the scope, not on
 * whatever happens to be loaded: a user whose first page is entirely read but
 * who has older unread rows still needs the button. `undefined` (the count
 * hasn't loaded yet) is not "zero" — it is "don't offer an action we can't
 * yet justify".
 */
export function canMarkAllRead(unreadCount: number | undefined): boolean {
  return typeof unreadCount === "number" && unreadCount > 0;
}
