import { shouldShowFloatingMessagesButton } from "./floating-messages";

const ENABLED = true;

describe("shouldShowFloatingMessagesButton", () => {
  it("shows on the ordinary tab screens that have no competing FAB", () => {
    for (const pathname of ["/timer", "/voice", "/notes"]) {
      expect(shouldShowFloatingMessagesButton(pathname, ENABLED)).toBe(true);
    }
  });

  it("hides on every screen with its own bottom-right create FAB in the identical corner", () => {
    // Today, Goals, Tasks and Schedule each pin their own primary "create"
    // FAB at right:spacing.xl / bottom:spacing.xxl — the exact corner this
    // button docks in. Reported by the user as "the messages icon is hiding
    // the plus button."
    for (const pathname of ["/", "/goals", "/tasks", "/schedule"]) {
      expect(shouldShowFloatingMessagesButton(pathname, ENABLED)).toBe(false);
    }
  });

  it("hides on Journal, where the button's fixed footprint covers the screen's own content", () => {
    // Journal has no competing FAB in this corner — unlike the four screens
    // above, this is a content collision, not a button collision. Journal's
    // editor stack (date nav, voice invite, editor card, Save) runs to
    // ~470-500pt as the FlashList's ListHeaderComponent before "Recent
    // entries" and its rows even start, which on a typical phone viewport
    // leaves them sitting in the same ~50-65pt band above the tab bar this
    // button docks in — on first paint, no scrolling required. Reported by
    // the user as "the right icon hides under notifications": the button
    // painted over the "RECENT ENTRIES" heading and the first entry row,
    // and its hitbox ate taps meant for that row's own onPress/swipe.
    expect(shouldShowFloatingMessagesButton("/journal", ENABLED)).toBe(false);
  });

  it("shows on the notification centre — the two are separate surfaces now", () => {
    expect(shouldShowFloatingMessagesButton("/notifications", ENABLED)).toBe(true);
  });

  it("hides on Messages itself, where it would only navigate to where you already are", () => {
    expect(shouldShowFloatingMessagesButton("/messages", ENABLED)).toBe(false);
  });

  it("hides on every screen that hides the tab bar it docks above", () => {
    // note/[id], message/[id] and mentee/[id] set tabBarStyle display:none in
    // the (app) layout. Left mounted, the button would float in the middle of
    // nowhere — and over the note editor's and the thread composer's own
    // controls.
    expect(shouldShowFloatingMessagesButton("/message/conv-1", ENABLED)).toBe(false);
    expect(shouldShowFloatingMessagesButton("/note/note-1", ENABLED)).toBe(false);
    expect(shouldShowFloatingMessagesButton("/mentee/user-1", ENABLED)).toBe(false);
  });

  it("does not confuse /messages with /mentees", () => {
    // Prefix matching done carelessly ("/message" without the trailing slash)
    // would hide the button on /messages AND on nothing else it should, while
    // a bare startsWith("/mentee") would also swallow /mentees. Sharing is a
    // normal screen and keeps its button.
    expect(shouldShowFloatingMessagesButton("/mentees", ENABLED)).toBe(true);
  });

  it("stays hidden in a build with no messaging service", () => {
    // Matches the drawer, which omits its Messages row entirely rather than
    // disabling it: a floating button to a screen that can only ever say
    // "unavailable" is worse than no button.
    expect(shouldShowFloatingMessagesButton("/", false)).toBe(false);
    expect(shouldShowFloatingMessagesButton("/tasks", false)).toBe(false);
  });
});
