import type { NetInfoState } from "@react-native-community/netinfo";

// Split out from offline.ts so this pure mapping can be unit tested without
// pulling in NetInfo's native module (offline.ts calls `NetInfo.fetch()` at
// import time, which needs a real/mocked native binding; this file has no
// side effects and only needs NetInfoState's shape, imported type-only).
export function deriveOnline(state: Pick<NetInfoState, "isConnected" | "isInternetReachable">): boolean {
  return Boolean(state.isConnected) && state.isInternetReachable !== false;
}
