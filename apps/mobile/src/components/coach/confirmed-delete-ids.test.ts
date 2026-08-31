// The all-or-nothing rule matters more than it looks. The API treats the
// presence of `confirmDeletions` as "this client confirms deletes per item",
// so a partial list fails the WHOLE batch, not just the unnamed action. A bug
// here turns a working cleanup into a hard 400.

import type { CoachProposalAction } from "@goalslot/shared";

import { confirmedDeleteIds, isDestructiveAction } from "./confirmed-delete-ids";

function action(type: string, id?: string): CoachProposalAction {
  return { type, id, payload: {} } as unknown as CoachProposalAction;
}

describe("confirmedDeleteIds", () => {
  it("returns undefined when the batch has no deletes", () => {
    expect(confirmedDeleteIds([action("CREATE_GOAL"), action("UPDATE_TASK")])).toBeUndefined();
  });

  it("lists the id of every delete type the API counts as destructive", () => {
    const actions = [
      action("DELETE_GOAL", "g1"),
      action("DELETE_TASK", "t1"),
      action("DELETE_SCHEDULE_BLOCK", "s1"),
      action("DELETE_TIME_ENTRY", "e1"),
      action("CREATE_GOAL", "ignored"),
    ];
    expect(confirmedDeleteIds(actions)).toEqual(["g1", "t1", "s1", "e1"]);
  });

  it("returns undefined when any delete is missing an id, rather than a partial list", () => {
    const actions = [action("DELETE_GOAL", "g1"), action("DELETE_TASK")];
    expect(confirmedDeleteIds(actions)).toBeUndefined();
  });

  it("treats an empty-string id as missing", () => {
    expect(confirmedDeleteIds([action("DELETE_GOAL", "")])).toBeUndefined();
  });

  it("covers the batch size that regressed in production: 15 goal deletes", () => {
    // "remove the goals not linked to the schedule" really did produce 15
    // DELETE_GOAL actions, which the unconfirmed caps refuse (10 overall, 3
    // for goals). Confirmed, the whole batch goes through.
    const actions = Array.from({ length: 15 }, (_, i) => action("DELETE_GOAL", `g${i}`));
    expect(confirmedDeleteIds(actions)).toHaveLength(15);
  });

  it("agrees with isDestructiveAction about what counts as a delete", () => {
    expect(isDestructiveAction("DELETE_TIME_ENTRY" as never)).toBe(true);
    expect(isDestructiveAction("CREATE_GOAL" as never)).toBe(false);
    expect(confirmedDeleteIds([action("DELETE_TIME_ENTRY", "e1")])).toEqual(["e1"]);
  });
});
