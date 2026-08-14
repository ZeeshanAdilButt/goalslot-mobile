// No import of `describe`/`it`/`expect`/`jest`: Jest injects these as real
// globals at test-runtime, and this project has no @types/jest installed, so
// this file is excluded from `tsc --noEmit` via tsconfig.json's `exclude` —
// same rationale as notifications.test.ts / derive-online.test.ts.
//
// These tests drive a FAKE PushRegistrationPort rather than mocking
// expo-notifications, axios and AsyncStorage. That's the point of the port:
// the interesting logic here is the decision table (register / skip /
// re-register / withdraw), and it should be assertable without a single
// platform module in the way. The mocks below exist only to stop the real
// api-client and notifications modules being *loaded* — the module under
// test imports them for `createPushRegistrationPort`, which these tests
// deliberately don't exercise.

import {
  getEasProjectId,
  syncPushRegistration,
  unregisterPushRegistration,
  type PushRegistrationPort,
  type StoredPushRegistration,
} from "./push-registration";

// Jest's module-factory hoisting only lets a factory close over variables
// whose names start with "mock" — hence the prefixes.
const mockExpoConfig: { extra?: Record<string, unknown> } | null = {
  extra: { eas: { projectId: "proj-abc" } },
};
let mockExpoConfigOverride: unknown;

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfigOverride === undefined ? mockExpoConfig : mockExpoConfigOverride;
    },
  },
}));

jest.mock("./api-client", () => ({
  apiClient: { pushSubscriptions: { registerExpo: jest.fn(), unregister: jest.fn() } },
}));

jest.mock("./notifications", () => ({
  createExpoNotificationCapability: jest.fn(() => ({})),
  getExpoPushToken: jest.fn(),
}));

/**
 * An in-memory port. `stored` doubles as the assertion surface for what was
 * persisted, so tests can check the local record and the calls in one place.
 */
function createFakePort(
  overrides: Partial<PushRegistrationPort> & { initialStored?: StoredPushRegistration | null } = {},
) {
  const calls = {
    register: [] as string[],
    unregister: [] as string[],
  };
  let stored: StoredPushRegistration | null = overrides.initialStored ?? null;

  const port: PushRegistrationPort = {
    hasAccessToken: overrides.hasAccessToken ?? (async () => true),
    getPermissionStatus: overrides.getPermissionStatus ?? (async () => "granted"),
    getExpoPushToken: overrides.getExpoPushToken ?? (async () => "ExponentPushToken[aaa]"),
    register:
      overrides.register ??
      (async (token: string) => {
        calls.register.push(token);
        return { id: `sub-${calls.register.length}` };
      }),
    unregister:
      overrides.unregister ??
      (async (id: string) => {
        calls.unregister.push(id);
      }),
    readStored: overrides.readStored ?? (async () => stored),
    writeStored:
      overrides.writeStored ??
      (async (value: StoredPushRegistration | null) => {
        stored = value;
      }),
  };

  return {
    port,
    calls,
    get stored() {
      return stored;
    },
  };
}

describe("getEasProjectId", () => {
  afterEach(() => {
    mockExpoConfigOverride = undefined;
  });

  it("reads extra.eas.projectId from app config", () => {
    expect(getEasProjectId()).toBe("proj-abc");
  });

  it("returns null when the manifest is absent entirely", () => {
    mockExpoConfigOverride = null;
    expect(getEasProjectId()).toBeNull();
  });

  it("treats a blank project id as missing rather than passing it on", () => {
    // A token minted against "" would be meaningless; better to no-op than
    // to register something the push service can never resolve.
    mockExpoConfigOverride = { extra: { eas: { projectId: "   " } } };
    expect(getEasProjectId()).toBeNull();
  });

  it("returns null when eas config is missing from extra", () => {
    mockExpoConfigOverride = { extra: {} };
    expect(getEasProjectId()).toBeNull();
  });
});

describe("syncPushRegistration", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    // Every failure path here logs deliberately; keep the suite output clean
    // while still asserting the returned result.
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    mockExpoConfigOverride = undefined;
  });

  it("registers the token and remembers the subscription id on a first run", async () => {
    const fake = createFakePort();

    const result = await syncPushRegistration("user-1", fake.port);

    expect(result).toBe("registered");
    expect(fake.calls.register).toEqual(["ExponentPushToken[aaa]"]);
    expect(fake.stored).toEqual({
      userId: "user-1",
      expoToken: "ExponentPushToken[aaa]",
      subscriptionId: "sub-1",
    });
  });

  it("skips the network round-trip when the same user already registered the same token", async () => {
    const fake = createFakePort({
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[aaa]",
        subscriptionId: "sub-1",
      },
    });

    const result = await syncPushRegistration("user-1", fake.port);

    expect(result).toBe("unchanged");
    expect(fake.calls.register).toEqual([]);
    expect(fake.calls.unregister).toEqual([]);
  });

  it("withdraws the old subscription and registers again when the token rotates", async () => {
    // The rotated-token case: the previous row still points at this handset
    // with a token the push service no longer honours.
    const fake = createFakePort({
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[old]",
        subscriptionId: "sub-old",
      },
    });

    const result = await syncPushRegistration("user-1", fake.port);

    expect(result).toBe("registered");
    expect(fake.calls.unregister).toEqual(["sub-old"]);
    expect(fake.calls.register).toEqual(["ExponentPushToken[aaa]"]);
    expect(fake.stored?.subscriptionId).toBe("sub-1");
  });

  it("withdraws the previous account's subscription when a different user signs in on the device", async () => {
    // THE account-switch leak: without the withdraw, the previous account's
    // row survives and their messages keep arriving on a phone now signed
    // into somebody else's account.
    const fake = createFakePort({
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[aaa]",
        subscriptionId: "sub-user1",
      },
    });

    const result = await syncPushRegistration("user-2", fake.port);

    expect(result).toBe("registered");
    expect(fake.calls.unregister).toEqual(["sub-user1"]);
    expect(fake.stored).toEqual({
      userId: "user-2",
      expoToken: "ExponentPushToken[aaa]",
      subscriptionId: "sub-1",
    });
  });

  it("never asks for a token when permission has not been granted", async () => {
    let tokenRequested = false;
    const fake = createFakePort({
      getPermissionStatus: async () => "denied",
      getExpoPushToken: async () => {
        tokenRequested = true;
        return "ExponentPushToken[aaa]";
      },
    });

    const result = await syncPushRegistration("user-1", fake.port);

    expect(result).toBe("permission-not-granted");
    expect(tokenRequested).toBe(false);
    expect(fake.calls.register).toEqual([]);
  });

  it("treats 'undetermined' as not granted rather than prompting", async () => {
    // This runs on the app-start path — it must never raise a permission
    // dialog of its own.
    const fake = createFakePort({ getPermissionStatus: async () => "undetermined" });

    expect(await syncPushRegistration("user-1", fake.port)).toBe("permission-not-granted");
    expect(fake.calls.register).toEqual([]);
  });

  it("reports no-project-id and registers nothing when the EAS project id is missing", async () => {
    mockExpoConfigOverride = { extra: {} };
    const fake = createFakePort();

    expect(await syncPushRegistration("user-1", fake.port)).toBe("no-project-id");
    expect(fake.calls.register).toEqual([]);
  });

  it("reports no-token on a simulator / offline / unprovisioned build", async () => {
    const fake = createFakePort({ getExpoPushToken: async () => null });

    expect(await syncPushRegistration("user-1", fake.port)).toBe("no-token");
    expect(fake.calls.register).toEqual([]);
  });

  it("reports failure without persisting anything when the API rejects the registration", async () => {
    // A half-written local record would make the NEXT launch think it had
    // already registered and skip the retry.
    const fake = createFakePort({
      register: async () => {
        throw new Error("500");
      },
    });

    expect(await syncPushRegistration("user-1", fake.port)).toBe("failed");
    expect(fake.stored).toBeNull();
  });

  it("does not throw when the port itself fails", async () => {
    const fake = createFakePort({
      getPermissionStatus: async () => {
        throw new Error("native module unavailable");
      },
    });

    await expect(syncPushRegistration("user-1", fake.port)).resolves.toBe("failed");
  });

  it("still registers when withdrawing the stale subscription fails", async () => {
    // A 404 (already deleted) or 403 must not block the new registration —
    // otherwise one dead row permanently prevents this device re-registering.
    const fake = createFakePort({
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[old]",
        subscriptionId: "sub-old",
      },
      unregister: async () => {
        throw new Error("404");
      },
    });

    expect(await syncPushRegistration("user-1", fake.port)).toBe("registered");
    expect(fake.stored?.expoToken).toBe("ExponentPushToken[aaa]");
  });
});

describe("unregisterPushRegistration", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("deletes the server subscription and clears the local record", async () => {
    const fake = createFakePort({
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[aaa]",
        subscriptionId: "sub-1",
      },
    });

    await unregisterPushRegistration(fake.port);

    expect(fake.calls.unregister).toEqual(["sub-1"]);
    expect(fake.stored).toBeNull();
  });

  it("does nothing when this device never registered", async () => {
    const fake = createFakePort();

    await unregisterPushRegistration(fake.port);

    expect(fake.calls.unregister).toEqual([]);
  });

  it("clears the local record even when the server call fails", async () => {
    // Keeping a subscription id that can never be deleted would only make
    // every future sync retry a doomed request.
    const fake = createFakePort({
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[aaa]",
        subscriptionId: "sub-1",
      },
      unregister: async () => {
        throw new Error("offline");
      },
    });

    await unregisterPushRegistration(fake.port);

    expect(fake.stored).toBeNull();
  });

  it("issues no request when the session has already expired, but still clears the record", async () => {
    // The expired-session sign-out: api-client's 401 interceptor clears the
    // tokens and THEN calls logout(). A DELETE fired here would 401,
    // re-enter that interceptor, and trigger a second logout — a duplicate
    // "session expired" toast and a re-run of the whole session reset.
    const fake = createFakePort({
      hasAccessToken: async () => false,
      initialStored: {
        userId: "user-1",
        expoToken: "ExponentPushToken[aaa]",
        subscriptionId: "sub-1",
      },
    });

    await unregisterPushRegistration(fake.port);

    expect(fake.calls.unregister).toEqual([]);
    expect(fake.stored).toBeNull();
  });

  it("never throws, so sign-out always completes", async () => {
    const fake = createFakePort({
      readStored: async () => {
        throw new Error("storage unavailable");
      },
    });

    await expect(unregisterPushRegistration(fake.port)).resolves.toBeUndefined();
  });
});
