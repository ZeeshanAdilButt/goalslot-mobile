// Regression cover for "delete a note does nothing on Android", a bug that
// shipped three times before it was actually diagnosed. Both halves of the
// diagnosis are pinned here.
//
// Half 1 (touch): ReanimatedSwipeable stacks its two action wrappers as
// absoluteFill siblings and hides the inactive one with `opacity: 0`. iOS's
// hitTest skips alpha-0 views and walks on to the next sibling; Android's
// TouchTargetHelper has no alpha condition at all, so the invisible
// rightActions overlay is returned as the touch target and the Delete button
// underneath never sees the tap. The fix is that the Delete button must be a
// gesture-handler Pressable, whose orchestrator does implement the sibling
// pass-through. That is a NATIVE hit-test behaviour — jest runs no native
// view hierarchy, so no renderer test can reproduce it. What is worth
// defending, and all that can be, is that nobody converts the button back to
// React Native's Pressable; that is the second describe below.
//
// Half 2 (accessibility): the swipe was the only route to delete, and
// TalkBack cannot perform it, so delete was unreachable with a screen reader
// or an accessibility-driven automation harness. That is ordinary logic and
// is tested properly, in the first describe.

import { readFileSync } from "fs";
import { join } from "path";

import {
  NOTE_ROW_ACTION_INTENTS,
  noteRowAccessibilityActions,
  noteRowActionIntent,
} from "./note-row-actions";

describe("noteRowAccessibilityActions", () => {
  it("offers delete, the only screen-reader route to deleting a page", () => {
    const names = noteRowAccessibilityActions({ hasChildren: false, collapsed: false }).map(
      (action) => action.name,
    );

    expect(names).toContain("delete");
  });

  it("labels delete in words a screen reader can read out on its own", () => {
    const del = noteRowAccessibilityActions({ hasChildren: false, collapsed: false }).find(
      (action) => action.name === "delete",
    );

    expect(del?.label).toBe("Delete page");
  });

  it("keeps delete last so the destructive action is not the first one heard", () => {
    const names = noteRowAccessibilityActions({ hasChildren: true, collapsed: true }).map(
      (action) => action.name,
    );

    expect(names[names.length - 1]).toBe("delete");
  });

  it("offers expand only for a collapsed page that has subpages", () => {
    expect(
      noteRowAccessibilityActions({ hasChildren: true, collapsed: true }).map((a) => a.name),
    ).toContain("expand");
    expect(
      noteRowAccessibilityActions({ hasChildren: true, collapsed: false }).map((a) => a.name),
    ).toContain("collapse");
    expect(
      noteRowAccessibilityActions({ hasChildren: false, collapsed: true }).map((a) => a.name),
    ).not.toContain("expand");
  });
});

describe("noteRowActionIntent", () => {
  it("routes delete to the delete intent", () => {
    expect(noteRowActionIntent("delete")).toBe("delete");
  });

  it("folds both halves of the toggle onto one intent", () => {
    expect(noteRowActionIntent("expand")).toBe("toggleCollapse");
    expect(noteRowActionIntent("collapse")).toBe("toggleCollapse");
  });

  // React Native delivers its own built-ins through the same callback.
  it("ignores action names the row does not own", () => {
    expect(noteRowActionIntent("activate")).toBeNull();
    expect(noteRowActionIntent("escape")).toBeNull();
    expect(noteRowActionIntent("")).toBeNull();
  });
});

// The invariant that actually caused the outage class: an action can be
// offered without being handled (a menu entry that reads out and then does
// nothing), or handled without being offered (dead code, and the feature stays
// unreachable — which is exactly what delete was).
describe("the menu and the dispatcher agree", () => {
  const everyName = [
    ...noteRowAccessibilityActions({ hasChildren: true, collapsed: true }),
    ...noteRowAccessibilityActions({ hasChildren: true, collapsed: false }),
    ...noteRowAccessibilityActions({ hasChildren: false, collapsed: false }),
  ].map((action) => action.name);

  it.each([...new Set(everyName)])("every offered action resolves: %s", (name) => {
    expect(noteRowActionIntent(name)).not.toBeNull();
  });

  it("every intent is reachable from the menu", () => {
    const reachable = new Set(everyName.map((name) => noteRowActionIntent(name)));

    for (const intent of NOTE_ROW_ACTION_INTENTS) {
      expect(reachable).toContain(intent);
    }
  });
});

describe("the Notes swipe-to-delete button stays a gesture-handler Pressable", () => {
  const source = readFileSync(join(__dirname, "..", "..", "app", "(app)", "notes.tsx"), "utf8");

  function renderLeftActionsBody(): string {
    const start = source.indexOf("const renderLeftActions");
    const end = source.indexOf("const renderRightActions", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("imports gesture-handler's Pressable under an alias", () => {
    expect(source).toMatch(/Pressable as GHPressable.*from "react-native-gesture-handler"/);
  });

  it("renders the Delete action with GHPressable", () => {
    expect(renderLeftActionsBody()).toContain("<GHPressable");
  });

  // The whole bug: a react-native Pressable here is unreachable on Android
  // because ReanimatedSwipeable's alpha-0 rightActions overlay swallows the
  // touch and RN's Android hit test has no alpha check.
  it("does not use react-native's Pressable for the Delete action", () => {
    expect(renderLeftActionsBody()).not.toMatch(/<Pressable[\s>]/);
  });

  // The right-hand actions were never broken (they are the sibling checked
  // FIRST), and the other swipe screens use the legacy Swipeable, which parks
  // the inactive wrapper at translateX -10000 rather than fading it. Nothing
  // here should be read as a reason to convert those.
  it("leaves the right-hand actions on react-native's Pressable", () => {
    const start = source.indexOf("const renderRightActions");
    const body = source.slice(start, source.indexOf("return (", start));

    expect(body).toMatch(/<Pressable[\s>]/);
  });
});
