// Regression cover for "the Coach header's + button does nothing".
//
// The button rendered on `!isReadOnly` alone while its handler bailed on
// `isReadOnly || persistedMessages.length === 0`. Wherever those two disagreed
// the user got a fully styled, `accessibilityRole="button"`, pressable-looking
// "+" that produced no dialog, no toast and no haptic. Three of the four
// states in which they disagreed are states a user sits in and taps: the
// history-loading skeleton, the history-failed error screen, and an empty
// conversation (whose EmptyState literally invites the user to start).
//
// The predicate is now shared, and both halves of both screens are asserted
// below — the unit tests pin the behaviour, and the source assertions pin the
// wiring, because a correct predicate that only one half calls is exactly the
// bug all over again. Same approach as note-row-actions.test.ts's
// "stays a gesture-handler Pressable" block.

import { readFileSync } from "fs";
import { join } from "path";

import { canStartNewChat } from "./new-chat-availability";

const APP_DIR = join(__dirname, "..", "..", "app", "(app)");

describe("canStartNewChat", () => {
  it("is false with nothing persisted — the state the dead button was most visible in", () => {
    expect(canStartNewChat({ messageCount: 0 })).toBe(false);
  });

  it("is true once there is a conversation to archive and clear", () => {
    expect(canStartNewChat({ messageCount: 1 })).toBe(true);
    expect(canStartNewChat({ messageCount: 12 })).toBe(true);
  });

  it("is false on a read-only past week even with messages on screen", () => {
    // "New chat" always targets the CURRENT week's live conversation, never
    // whatever is being browsed, so it must not be offered here at all.
    expect(canStartNewChat({ messageCount: 12, isReadOnly: true })).toBe(false);
  });

  it("treats a missing isReadOnly as not read-only, for screens that have no week scrubber", () => {
    expect(canStartNewChat({ messageCount: 1 })).toBe(canStartNewChat({ messageCount: 1, isReadOnly: false }));
  });
});

// The actual invariant: a visible "+" must always do something. These read the
// screens themselves because that is where the two halves drifted apart.
describe("both screens gate the + button and its handler on the same predicate", () => {
  const coach = readFileSync(join(APP_DIR, "coach.tsx"), "utf8");
  const voice = readFileSync(join(APP_DIR, "voice.tsx"), "utf8");

  /** The JSX around the "Start a new chat" control, back to its enclosing conditional. */
  function newChatRenderGate(source: string): string {
    const button = source.indexOf('accessibilityLabel="Start a new chat"');
    expect(button).toBeGreaterThan(-1);
    return source.slice(source.lastIndexOf("{", source.lastIndexOf("<", button)), button);
  }

  function handleNewChatBody(source: string): string {
    const start = source.indexOf("const handleNewChat");
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf("const cancelNewChat", start));
  }

  it.each([
    ["coach.tsx", coach],
    ["voice.tsx", voice],
  ])("%s derives canStartNewChat from the shared helper", (_name, source) => {
    expect(source).toContain('from "@/lib/new-chat-availability"');
    expect(source).toMatch(/const canStartNewChat = /);
  });

  it.each([
    ["coach.tsx", coach],
    ["voice.tsx", voice],
  ])("%s renders the + only when canStartNewChat", (_name, source) => {
    // The whole bug in one assertion: this gate was `!isReadOnly` on coach.tsx
    // while the handler also required a non-empty conversation.
    expect(newChatRenderGate(source)).toContain("canStartNewChat ?");
  });

  it.each([
    ["coach.tsx", coach],
    ["voice.tsx", voice],
  ])("%s guards handleNewChat on the same value, not a hand-written copy", (_name, source) => {
    const body = handleNewChatBody(source);
    expect(body).toContain("if (!canStartNewChat) return;");
    expect(body).not.toMatch(/persistedMessages\.length|history\.length/);
  });
});
