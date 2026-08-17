/* eslint-disable @typescript-eslint/no-require-imports -- these tests are
   about *when* a module is loaded, so they must control the require
   themselves: a top-level ESM import would run before jest.mock/
   resetModules could observe it. */
// Cost cover for the persisted query cache.
//
// `createAsyncStoragePersister`'s own default is `throttleTime: 1000`, and
// app/_layout.tsx passes no override — so up to once a second the ENTIRE query
// cache was dehydrated, JSON.stringify'd on the JS thread and written to
// AsyncStorage as one blob. For a heavy account that snapshot is around a
// megabyte, and the note editor's 1 s debounced autosave patches the cache on
// exactly that cadence, so typing in a note paid a full-cache serialize every
// second.
//
// Left unpinned this silently regresses to the library default the moment
// someone rewrites the call, with no visible symptom in review.

// `mock`-prefixed so jest's hoisting guard allows the factory to close over it.
const mockCreatePersister = jest.fn(() => ({
  persistClient: jest.fn(),
  restoreClient: jest.fn(),
  removeClient: jest.fn(),
}));

jest.mock("@tanstack/query-async-storage-persister", () => ({
  createAsyncStoragePersister: (...args: unknown[]) =>
    mockCreatePersister(...(args as [])),
}));

describe("asyncStoragePersister configuration", () => {
  it("throttles full-cache writes well above the library's 1s default", () => {
    require("./query-client");

    expect(mockCreatePersister).toHaveBeenCalledTimes(1);
    const options = mockCreatePersister.mock.calls[0][0] as {
      throttleTime?: number;
    };

    expect(options.throttleTime).toBeDefined();
    expect(options.throttleTime).toBeGreaterThanOrEqual(5000);
  });

  it("still hands the persister a storage backend", () => {
    require("./query-client");

    const options = mockCreatePersister.mock.calls[0][0] as {
      storage?: unknown;
    };

    expect(options.storage).toBeDefined();
  });
});
