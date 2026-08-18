// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed
// (see notifications.test.ts and derive-online.test.ts for the same
// rationale), so this file is excluded from `tsc --noEmit` via tsconfig.json's
// `exclude` rather than typed against jest's ambient globals.
//
// The bug this file guards against: expo-secure-store's Android
// implementation can *throw* on read (most notably a Keystore
// DecryptException when the OS invalidates the key protecting the stored
// value — a security patch, a Keystore re-provisioning, a reboot). Every
// downstream caller (loadUser(), the shared api client's request
// interceptor, the widget) treats these reads as a bare `await` with no
// try/catch, so an unguarded throw here turns into an unhandled rejection
// that stalls the whole app on its loading screen forever instead of
// falling back to the login screen. This is the single choke point behind
// the shared `TokenStorage` interface, so it's the only place that needs
// the guard.
import * as SecureStore from "expo-secure-store";

import { secureTokenStorage } from "./secure-token-storage";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

describe("secureTokenStorage", () => {
  beforeEach(() => {
    mockGetItemAsync.mockReset();
    mockDeleteItemAsync.mockReset();
    mockDeleteItemAsync.mockResolvedValue(undefined);
  });

  describe("getAccessToken", () => {
    it("returns the stored token on a normal read", async () => {
      mockGetItemAsync.mockResolvedValueOnce("stored-access-token");

      await expect(secureTokenStorage.getAccessToken()).resolves.toBe("stored-access-token");
    });

    it("returns null, rather than throwing, when the native read throws", async () => {
      mockGetItemAsync.mockRejectedValueOnce(
        new Error("DecryptException: key permanently invalidated"),
      );

      await expect(secureTokenStorage.getAccessToken()).resolves.toBeNull();
    });

    it("drops the now-unreadable key so it stops throwing on every subsequent read", async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error("DecryptException"));

      await secureTokenStorage.getAccessToken();

      expect(mockDeleteItemAsync).toHaveBeenCalledWith("goalslot-access-token");
    });

    it("still resolves to null even if the cleanup delete itself fails", async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error("DecryptException"));
      mockDeleteItemAsync.mockRejectedValueOnce(new Error("delete also unavailable"));

      await expect(secureTokenStorage.getAccessToken()).resolves.toBeNull();
    });
  });

  describe("getRefreshToken", () => {
    it("returns the stored token on a normal read", async () => {
      mockGetItemAsync.mockResolvedValueOnce("stored-refresh-token");

      await expect(secureTokenStorage.getRefreshToken()).resolves.toBe("stored-refresh-token");
    });

    it("returns null, rather than throwing, when the native read throws", async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error("DecryptException"));

      await expect(secureTokenStorage.getRefreshToken()).resolves.toBeNull();
    });

    it("drops the now-unreadable key so it stops throwing on every subsequent read", async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error("DecryptException"));

      await secureTokenStorage.getRefreshToken();

      expect(mockDeleteItemAsync).toHaveBeenCalledWith("goalslot-refresh-token");
    });

    it("still resolves to null even if the cleanup delete itself fails", async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error("DecryptException"));
      mockDeleteItemAsync.mockRejectedValueOnce(new Error("delete also unavailable"));

      await expect(secureTokenStorage.getRefreshToken()).resolves.toBeNull();
    });
  });
});
