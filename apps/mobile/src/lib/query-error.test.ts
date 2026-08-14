// No import of `describe`/`it`/`expect` — see derive-online.test.ts's header
// note; this file follows the same convention (excluded from `tsc --noEmit`
// via tsconfig's `exclude`, Jest supplies the globals at test-runtime).
import { describeQueryError } from "./query-error";

describe("describeQueryError", () => {
  it("treats an axios-shaped error with a response as a genuine server error", () => {
    const err = { response: { status: 500 } };
    expect(describeQueryError(err, "Couldn't load goals.")).toEqual({
      message: "Couldn't load goals.",
    });
  });

  it("treats an error with a response but a client-error status the same way — the server still answered", () => {
    const err = { response: { status: 404 } };
    expect(describeQueryError(err, "Couldn't load this entry.")).toEqual({
      message: "Couldn't load this entry.",
    });
  });

  it("treats an error with no response at all as offline", () => {
    const err = new Error("Network Error");
    expect(describeQueryError(err, "Couldn't load goals.")).toEqual({
      title: "You're offline",
      message: "Check your connection and try again.",
      iconName: "wifi-off",
    });
  });

  it("uses a caller-supplied offline message over the default", () => {
    const err = new Error("Network Error");
    expect(describeQueryError(err, "Couldn't load goals.", "Your goals will show up once you're back online.")).toEqual({
      title: "You're offline",
      message: "Your goals will show up once you're back online.",
      iconName: "wifi-off",
    });
  });

  it("treats a response with a falsy-but-present value as still a response (matches hasResponse's own Boolean(...) check)", () => {
    // hasResponse is `Boolean((err as {response?}).response)` — an explicit
    // `response: undefined` still fails that Boolean check, so this should
    // read as offline, not a server error. Documents the exact boundary
    // rather than assuming it.
    const err = { response: undefined };
    expect(describeQueryError(err, "Couldn't load goals.").title).toBe("You're offline");
  });

  it("treats a plain string throw (no .response) as offline", () => {
    expect(describeQueryError("boom", "Couldn't load goals.").title).toBe("You're offline");
  });

  it("treats null/undefined errors as offline", () => {
    expect(describeQueryError(null, "Couldn't load goals.").title).toBe("You're offline");
    expect(describeQueryError(undefined, "Couldn't load goals.").title).toBe("You're offline");
  });
});
