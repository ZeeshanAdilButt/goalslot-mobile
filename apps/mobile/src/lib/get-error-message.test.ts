// No import of `describe`/`it`/`expect`: same convention as toast-store.test.ts
// — Jest injects these as real globals.
//
// Covers the two response shapes this API actually sends back: a plain
// `{ message: string }` (most endpoints) and NestJS's validation-array
// `{ message: string[] }` (ValidationPipe failures) — plus the fallbacks
// when neither is present.

import { getErrorMessage } from "./get-error-message";

describe("getErrorMessage", () => {
  it("returns the server message for a string `message`", () => {
    const err = { response: { data: { message: "Invalid credentials" } } };
    expect(getErrorMessage(err, "fallback")).toBe("Invalid credentials");
  });

  it("joins a NestJS validation-array `message` into one string", () => {
    const err = { response: { data: { message: ["name should not be empty", "color must be a hex color"] } } };
    expect(getErrorMessage(err, "fallback")).toBe("name should not be empty, color must be a hex color");
  });

  it("falls back when the validation array is empty", () => {
    const err = { response: { data: { message: [] } } };
    expect(getErrorMessage(err, "fallback")).toBe("fallback");
  });

  it("falls back to err.message when there is no response body", () => {
    const err = new Error("Network request failed");
    expect(getErrorMessage(err, "fallback")).toBe("Network request failed");
  });

  it("falls back to the provided fallback for a non-Error, non-response value", () => {
    expect(getErrorMessage("just a string", "fallback")).toBe("fallback");
    expect(getErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("prefers the response message over err.message when both are present", () => {
    const err = Object.assign(new Error("Request failed with status code 400"), {
      response: { data: { message: "Please pick a category name." } },
    });
    expect(getErrorMessage(err, "fallback")).toBe("Please pick a category name.");
  });
});
