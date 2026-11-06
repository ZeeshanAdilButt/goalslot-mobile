jest.mock("@/lib/api-client", () => ({ apiClient: {} }));
jest.mock("@/lib/query-client", () => ({ queryClient: { invalidateQueries: jest.fn() } }));

import { summariseProposalResults } from "./useApplyCoachProposals";

describe("summariseProposalResults", () => {
  it("is a clean success only when every action landed with no caveat", () => {
    const s = summariseProposalResults([
      { index: 0, type: "DELETE_SCHEDULE_BLOCK", ok: true },
      { index: 1, type: "CREATE_SCHEDULE_BLOCK", ok: true },
    ]);
    expect(s.partial).toBe(false);
    expect(s.message).toBe("2 changes applied");
    expect(s.details).toEqual([]);
  });

  it("never reports a partial apply as clean, and names what failed and why", () => {
    // The original bug: the delete "applied", both creates conflicted, card said Done.
    const s = summariseProposalResults([
      { index: 0, type: "DELETE_SCHEDULE_BLOCK", ok: true, label: 'Delete "Reading & Labs" Tue 7:00 AM to 9:00 AM' },
      {
        index: 1,
        type: "CREATE_SCHEDULE_BLOCK",
        ok: false,
        label: 'Add "Tech Labs" Mon 9:30 AM to 10:00 AM',
        error: 'Time slot conflicts with an existing schedule block: "Book" (Monday 9:00 AM to 11:00 AM)',
      },
    ]);
    expect(s.partial).toBe(true);
    expect(s.message).toBe("1 of 2 changes applied. 1 couldn't be.");
    expect(s.details).toEqual([
      'Add "Tech Labs" Mon 9:30 AM to 10:00 AM: Time slot conflicts with an existing schedule block: "Book" (Monday 9:00 AM to 11:00 AM)',
    ]);
  });

  it("says nothing changed when the API refused the batch, with the real reason, not the filler", () => {
    const s = summariseProposalResults([
      {
        index: 0,
        type: "CREATE_SCHEDULE_BLOCK",
        ok: false,
        skipped: true,
        error: "Not applied, because another change in this proposal could not be made. Nothing was changed.",
      },
      {
        index: 1,
        type: "DELETE_SCHEDULE_BLOCK",
        ok: false,
        skipped: true,
        label: 'Delete "Reading & Labs (Core Engineering)"',
        error: "This block is not in your schedule, so nothing was deleted.",
      },
    ]);
    expect(s.applied).toBe(0);
    expect(s.message).toBe(
      'Nothing was changed. Delete "Reading & Labs (Core Engineering)": This block is not in your schedule, so nothing was deleted.',
    );
  });

  it("flags a success that carries a caveat, such as skipped days", () => {
    const s = summariseProposalResults([
      { index: 0, type: "CREATE_SCHEDULE_BLOCK", ok: true, label: 'Add "Gym"', warning: "Added on 4 of 5 days." },
    ]);
    expect(s.partial).toBe(true);
    expect(s.details).toEqual(['Add "Gym": Added on 4 of 5 days.']);
  });

  it("does not treat an already-done re-apply as a caveat", () => {
    const s = summariseProposalResults([
      { index: 0, type: "DELETE_SCHEDULE_BLOCK", ok: true, alreadyDone: true, warning: "Already deleted earlier." },
    ]);
    expect(s.partial).toBe(false);
  });
});
