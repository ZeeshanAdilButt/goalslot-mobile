import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_NAME } from "./index";

describe("shared package scaffold", () => {
  it("exports a package name", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@goalslot/shared");
  });
});
