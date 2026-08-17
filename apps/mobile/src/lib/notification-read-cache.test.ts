import {
  canMarkAllRead,
  markAllNotificationsReadInPages,
  markNotificationReadInPages,
  removeNotificationFromPages,
  type NotificationPages,
} from "./notification-read-cache";

const READ_AT = "2026-08-17T12:00:00.000Z";
const EARLIER = "2026-08-10T08:30:00.000Z";

function notification(id: string, readAt: string | null) {
  return {
    id,
    type: "SHARED_REPORT_UNVIEWED",
    title: `Notification ${id}`,
    body: null,
    data: null,
    readAt,
    createdAt: "2026-08-16T07:00:00.000Z",
  };
}

function pages(...pageItems: ReturnType<typeof notification>[][]): NotificationPages {
  return {
    pages: pageItems.map((items, index) => ({
      items,
      nextCursor: index === pageItems.length - 1 ? null : `cursor-${index}`,
      hasMore: index !== pageItems.length - 1,
      unreadCount: pageItems.flat().filter((item) => !item.readAt).length,
    })),
    pageParams: [undefined, "cursor-0"].slice(0, pageItems.length),
  };
}

describe("markAllNotificationsReadInPages", () => {
  it("marks every unread row across every loaded page", () => {
    const result = markAllNotificationsReadInPages(
      pages([notification("a", null), notification("b", null)], [notification("c", null)]),
      READ_AT,
      0,
    );

    expect(result?.pages.flatMap((page) => page.items).map((item) => item.readAt)).toEqual([
      READ_AT,
      READ_AT,
      READ_AT,
    ]);
  });

  it("leaves an already-read row's original timestamp alone", () => {
    // NotificationRow renders a relative time, so re-dating a row the user
    // read last week to "just now" is visible, not cosmetic.
    const result = markAllNotificationsReadInPages(
      pages([notification("a", EARLIER), notification("b", null)]),
      READ_AT,
      0,
    );

    expect(result?.pages[0]?.items[0]?.readAt).toBe(EARLIER);
    expect(result?.pages[0]?.items[1]?.readAt).toBe(READ_AT);
  });

  // Regression test: this is the crash-adjacent bug the "Mark all read"
  // control tap needs fixed. notifications.tsx's `canMarkAllRead` decides
  // whether to render/enable the button off `pages[0]?.unreadCount` — NOT
  // off a count of unread rows in these pages (see this file's header
  // comment) — because that mirrors the server's scope-wide total, not just
  // what happens to be loaded. Before this fix, `markAllNotificationsReadInPages`
  // only patched `readAt` and left every page's own `unreadCount` field at
  // its PRE-clear value. So after a successful "Mark all read" the button
  // kept reporting the old total (here 43) and stayed visible and tappable
  // — inviting exactly the repeated taps on an already-cleared scope that
  // produced the field-reported crash/error-toast pattern.
  it("resets every loaded page's own unreadCount to the server's post-clear total", () => {
    // Every page in a real response carries the SAME scope-wide total (see
    // this suite's `pages()` helper), not a per-page count — 3 unread here
    // (a, b, c), echoed on both loaded pages.
    const input = pages([notification("a", null), notification("b", null)], [notification("c", null)]);
    expect(input.pages[0]?.unreadCount).toBe(3);
    expect(input.pages[1]?.unreadCount).toBe(3);

    const result = markAllNotificationsReadInPages(input, READ_AT, 0);

    expect(result?.pages[0]?.unreadCount).toBe(0);
    expect(result?.pages[1]?.unreadCount).toBe(0);
    // The control-visibility check itself, end to end: this is what
    // notifications.tsx actually reads to decide whether "Mark all read" is
    // still offered after the mutation succeeds.
    expect(canMarkAllRead(result?.pages[0]?.unreadCount)).toBe(false);
  });

  it("carries pageParams through untouched", () => {
    // These are the cursors react-query replays on a refetch. Rewriting them
    // silently breaks paging on the next pull-to-refresh.
    const input = pages([notification("a", null)], [notification("b", null)]);
    expect(markAllNotificationsReadInPages(input, READ_AT, 0)?.pageParams).toEqual(input.pageParams);
  });

  it("does not mutate the cached value in place", () => {
    // react-query compares by reference to decide whether to re-render; an
    // in-place mutation both skips the render and corrupts the previous value.
    const input = pages([notification("a", null)]);
    const result = markAllNotificationsReadInPages(input, READ_AT, 0);

    expect(input.pages[0]?.items[0]?.readAt).toBeNull();
    expect(input.pages[0]?.unreadCount).toBe(1);
    expect(result).not.toBe(input);
    expect(result?.pages[0]).not.toBe(input.pages[0]);
  });

  it("is a no-op on an empty cache", () => {
    expect(markAllNotificationsReadInPages(undefined, READ_AT, 0)).toBeUndefined();
  });
});

describe("markNotificationReadInPages", () => {
  it("marks only the row that was tapped, on whichever page it is on", () => {
    const result = markNotificationReadInPages(
      pages([notification("a", null)], [notification("b", null), notification("c", null)]),
      "b",
      READ_AT,
    );

    expect(result?.pages[0]?.items[0]?.readAt).toBeNull();
    expect(result?.pages[1]?.items[0]?.readAt).toBe(READ_AT);
    expect(result?.pages[1]?.items[1]?.readAt).toBeNull();
  });

  it("is a no-op for an id that isn't loaded", () => {
    const input = pages([notification("a", null)]);
    expect(markNotificationReadInPages(input, "missing", READ_AT)?.pages[0]?.items[0]?.readAt).toBeNull();
  });
});

describe("removeNotificationFromPages", () => {
  it("removes only the row that was swiped, on whichever page it is on", () => {
    const { pages: result } = removeNotificationFromPages(
      pages([notification("a", null)], [notification("b", null), notification("c", null)]),
      "b",
    );

    expect(result?.pages[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result?.pages[1]?.items.map((item) => item.id)).toEqual(["c"]);
  });

  it("reports the removed row was unread", () => {
    const { removedWasUnread } = removeNotificationFromPages(pages([notification("a", null)]), "a");
    expect(removedWasUnread).toBe(true);
  });

  it("reports the removed row was already read", () => {
    const { removedWasUnread } = removeNotificationFromPages(pages([notification("a", EARLIER)]), "a");
    expect(removedWasUnread).toBe(false);
  });

  it("is a no-op for an id that isn't loaded", () => {
    const input = pages([notification("a", null)]);
    const { pages: result, removedWasUnread } = removeNotificationFromPages(input, "missing");

    expect(result?.pages[0]?.items).toHaveLength(1);
    expect(removedWasUnread).toBe(false);
  });

  it("is a no-op on an empty cache", () => {
    const { pages: result, removedWasUnread } = removeNotificationFromPages(undefined, "a");
    expect(result).toBeUndefined();
    expect(removedWasUnread).toBe(false);
  });

  it("carries pageParams through untouched", () => {
    const input = pages([notification("a", null)], [notification("b", null)]);
    expect(removeNotificationFromPages(input, "a").pages?.pageParams).toEqual(input.pageParams);
  });

  it("does not mutate the cached value in place", () => {
    const input = pages([notification("a", null), notification("b", null)]);
    const { pages: result } = removeNotificationFromPages(input, "a");

    expect(input.pages[0]?.items).toHaveLength(2);
    expect(result).not.toBe(input);
  });
});

describe("canMarkAllRead", () => {
  it("offers the control only when the server says something is unread", () => {
    expect(canMarkAllRead(3)).toBe(true);
    expect(canMarkAllRead(0)).toBe(false);
  });

  it("does not offer it before the count has loaded", () => {
    // `undefined` is "we don't know yet", which is not the same as zero —
    // flashing a button that then disappears reads as a glitch.
    expect(canMarkAllRead(undefined)).toBe(false);
  });

  it("keys on the server total, not on how many rows happen to be loaded", () => {
    // The regression this pins: a first page that is entirely read while
    // older unread rows exist must STILL offer the control. Deriving the flag
    // from the loaded pages would hide it exactly when it is most useful.
    const loaded = pages([notification("a", EARLIER), notification("b", EARLIER)]);
    const unreadRowsLoaded = loaded.pages.flatMap((page) => page.items).filter((item) => !item.readAt).length;

    expect(unreadRowsLoaded).toBe(0);
    expect(canMarkAllRead(41)).toBe(true);
  });
});
