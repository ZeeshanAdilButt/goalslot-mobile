// No import of `describe`/`it`/`expect`: Jest injects these as real globals
// at test-runtime, and this project has no @types/jest installed (nor is
// one being added here — foundation scope keeps to already-installed
// deps), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
import { deriveOnline } from "./derive-online";

describe("deriveOnline", () => {
  it("is online when connected and reachability is unknown", () => {
    expect(deriveOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
  });

  it("is online when connected and reachable", () => {
    expect(deriveOnline({ isConnected: true, isInternetReachable: true })).toBe(true);
  });

  it("is offline when not connected", () => {
    expect(deriveOnline({ isConnected: false, isInternetReachable: null })).toBe(false);
  });

  it("is offline when connected but explicitly unreachable", () => {
    expect(deriveOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});
