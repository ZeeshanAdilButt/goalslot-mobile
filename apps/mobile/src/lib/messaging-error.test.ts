import { describeCreateConversationError } from "./messaging-error";

describe("describeCreateConversationError", () => {
  it("names the person for a 403 (no active sharing connection)", () => {
    const err = { response: { status: 403 } };
    expect(describeCreateConversationError(err, "Priya")).toEqual({
      kind: "forbidden",
      message: "You can't message Priya — that sharing connection isn't active any more.",
    });
  });

  it("uses the shared offline wording when there is no response at all", () => {
    const err = new Error("Network Error");
    expect(describeCreateConversationError(err, "Priya")).toEqual({
      kind: "network",
      message: "Couldn't reach messaging. Check your connection.",
    });
  });

  it("falls back to the classifier's generic wording for anything else", () => {
    const err = { response: { status: 500 } };
    expect(describeCreateConversationError(err, "Priya")).toEqual({
      kind: "server",
      message: "Messaging is having trouble right now.",
    });
  });
});
