// Mirrors <GlobalTrackingBanner/>'s own measured on-screen height into a tiny
// zustand store so <ConnectivityPill/> — mounted one layout up, in
// app/_layout.tsx, as a sibling painted *after* <Slot/> (which is where
// app/(app)/_layout.tsx, and the banner itself, actually live) — can stack
// itself below the banner instead of overlapping it. Both are absolutely
// positioned at the top of the screen; without this they'd occupy the same
// rect and, since later siblings paint over earlier ones in React Native's
// default stacking order, the pill would render on top of (hiding) the
// banner whenever both were visible at once — exactly the "tracking bar
// gets hidden behind that [offline] bar" report this store exists to fix.
//
// Not persisted: a pure reflection of the banner's current onLayout
// measurement, same reasoning as pending-sync-store.ts's header. Zero means
// "no tracking banner on screen right now" (idle timer), which is also the
// correct default before the banner has ever mounted.

import { create } from "zustand";

interface TrackingBannerHeightState {
  height: number;
  setHeight: (height: number) => void;
}

export const useTrackingBannerHeight = create<TrackingBannerHeightState>()(
  (set) => ({
    height: 0,
    setHeight: (height) => set({ height }),
  }),
);
