import { shouldShowFloatingMessagesButton } from "./floating-messages";

const ENABLED = true;

describe("shouldShowFloatingMessagesButton", () => {
  it("shows on the ordinary tab screens", () => {
    for (const pathname of ["/", "/schedule", "/tasks", "/timer", "/voice", "/goals", "/journal", "/notes"]) {
      expect(shouldShowFloatingMessagesButton(pathname, ENABLED)).toBe(true);
    }
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
