import { resolveThreadAnchor, type AnchorMessage } from "./thread-anchor";

const ME = "user-me";
const THEM = "user-them";

/** `at` is minutes past a fixed epoch, so the cases below read as a timeline. */
const T0 = Date.parse("2026-08-16T10:00:00.000Z");
function at(minutes: number): string {
  return new Date(T0 + minutes * 60_000).toISOString();
}
function readAt(minutes: number): number {
  return T0 + minutes * 60_000;
}

function from(sender: string, minutes: number, id = `m-${sender}-${minutes}`): AnchorMessage {
  return { id, senderId: sender, createdAt: at(minutes) };
}

describe("resolveThreadAnchor", () => {
  // THE REPORTED BUG. Every message is older than my lastReadAt, so there is
  // nothing to anchor to and nothing to justify a "Jump to latest" pill.
  it("reports nothing unread when I have read everything", () => {
    const anchor = resolveThreadAnchor({
      messages: [from(THEM, 0), from(ME, 1), from(THEM, 2)],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(false);
    expect(anchor.firstUnreadIndex).toBeNull();
    expect(anchor.firstUnreadId).toBeNull();
  });

  it("anchors on the first message I have not read", () => {
    const anchor = resolveThreadAnchor({
      messages: [from(THEM, 0), from(THEM, 1), from(THEM, 20, "first-new"), from(THEM, 21)],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(true);
    expect(anchor.firstUnreadIndex).toBe(2);
    expect(anchor.firstUnreadId).toBe("first-new");
  });

  // Rule 1. Sending is not reading: lastReadAt stays behind the message you
  // just wrote, so a naive comparison would park you above your own reply.
  it("never treats my own messages as unread", () => {
    const anchor = resolveThreadAnchor({
      messages: [from(THEM, 0), from(ME, 30), from(ME, 31)],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(false);
    expect(anchor.firstUnreadIndex).toBeNull();
  });

  // My own newer message must not stop the scan before a genuinely unread one.
  it("looks past my own messages to find a later unread one", () => {
    const anchor = resolveThreadAnchor({
      messages: [from(THEM, 0), from(ME, 20), from(THEM, 30, "theirs-new")],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(true);
    expect(anchor.firstUnreadId).toBe("theirs-new");
    expect(anchor.firstUnreadIndex).toBe(2);
  });

  it("treats a never-read conversation as entirely unread", () => {
    const anchor = resolveThreadAnchor({
      messages: [from(THEM, 0, "oldest"), from(THEM, 1)],
      lastReadAt: 0,
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(true);
    expect(anchor.firstUnreadIndex).toBe(0);
    expect(anchor.firstUnreadId).toBe("oldest");
  });

  // Rule 2.
  it("reports nothing unread for an empty thread", () => {
    expect(resolveThreadAnchor({ messages: [], lastReadAt: 0, currentUserId: ME })).toEqual({
      firstUnreadIndex: null,
      firstUnreadId: null,
      hasUnread: false,
    });
  });

  // A message exactly at lastReadAt was covered by that read receipt.
  it("treats a message sent exactly at lastReadAt as read", () => {
    const anchor = resolveThreadAnchor({
      messages: [from(THEM, 10)],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(false);
  });

  it("skips unparseable timestamps rather than stranding the user on them", () => {
    const anchor = resolveThreadAnchor({
      messages: [
        { id: "broken", senderId: THEM, createdAt: "not-a-date" },
        from(THEM, 30, "real-unread"),
      ],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.firstUnreadId).toBe("real-unread");
  });

  it("reports nothing unread when the only bad timestamp is unparseable", () => {
    const anchor = resolveThreadAnchor({
      messages: [{ id: "broken", senderId: THEM, createdAt: "not-a-date" }],
      lastReadAt: readAt(10),
      currentUserId: ME,
    });

    expect(anchor.hasUnread).toBe(false);
  });
});
