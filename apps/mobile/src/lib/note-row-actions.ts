// The Notes row's accessibility action menu, split out of app/(app)/notes.tsx
// so the two halves that have to agree can be checked without a renderer.
//
// Why this exists at all: the only way to delete a note used to be a right
// swipe followed by a tap on the revealed strip. TalkBack (and any
// accessibility-driven automation harness — Appium's UiAutomator2 driver,
// Maestro) cannot perform that swipe: touch exploration consumes the
// horizontal gesture, and the row exposed no delete action, so there was NO
// code path by which a screen-reader user could delete a page. Delete is now
// an accessibility action on the row itself.
//
// The invariant worth protecting is that these two functions stay in sync: an
// action offered in the menu that `noteRowActionIntent` doesn't recognise is a
// dead menu entry — it reads out loud, the user activates it, and nothing
// happens. note-row-actions.test.ts asserts the round trip in both directions.

import type { AccessibilityActionInfo } from "react-native";

/** What the row should actually do, once expand/collapse are folded into the
 *  single toggle the screen implements. */
export type NoteRowActionIntent =
  | "moveUp"
  | "moveDown"
  | "indent"
  | "outdent"
  | "toggleCollapse"
  | "delete";

/** Every intent, so a test can assert each one is reachable from the menu. */
export const NOTE_ROW_ACTION_INTENTS: readonly NoteRowActionIntent[] = [
  "moveUp",
  "moveDown",
  "indent",
  "outdent",
  "toggleCollapse",
  "delete",
];

export type NoteRowActionsOptions = {
  /** Whether the note has subpages — expand/collapse is meaningless without. */
  hasChildren: boolean;
  /** Current collapsed state, which decides which half of the toggle to offer. */
  collapsed: boolean;
};

export function noteRowAccessibilityActions({
  hasChildren,
  collapsed,
}: NoteRowActionsOptions): AccessibilityActionInfo[] {
  const actions: AccessibilityActionInfo[] = [
    { name: "moveUp", label: "Move up" },
    { name: "moveDown", label: "Move down" },
    { name: "indent", label: "Make subpage of previous page" },
    { name: "outdent", label: "Promote page" },
  ];
  if (hasChildren) {
    actions.push(
      collapsed
        ? { name: "expand", label: "Expand subpages" }
        : { name: "collapse", label: "Collapse subpages" },
    );
  }
  // Last, so it sits at the bottom of the menu TalkBack reads out: it is the
  // destructive one, and it still routes through the confirmation dialog.
  actions.push({ name: "delete", label: "Delete page" });
  return actions;
}

/** Maps a fired action name onto what the screen should do, or null for an
 *  action name the row does not own (React Native also delivers built-ins such
 *  as "activate" and "escape" through the same callback). */
export function noteRowActionIntent(actionName: string): NoteRowActionIntent | null {
  switch (actionName) {
    case "moveUp":
      return "moveUp";
    case "moveDown":
      return "moveDown";
    case "indent":
      return "indent";
    case "outdent":
      return "outdent";
    case "expand":
    case "collapse":
      return "toggleCollapse";
    case "delete":
      return "delete";
    default:
      return null;
  }
}
