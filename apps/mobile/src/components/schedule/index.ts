// Barrel for the Schedule screen's presentation layer. Everything here is
// specific to the time-axis view — nothing else in the app imports it, so it
// stays out of `src/components/index.ts`'s app-wide surface.

export { BlockDetailSheet, type BlockDetailSheetProps } from "./BlockDetailSheet";
export { DayStrip, type DayStripProps } from "./DayStrip";
export { NowIndicator, type NowIndicatorProps } from "./NowIndicator";
export { ScheduleBlockSheet, type ScheduleBlockSheetPresentOptions, type ScheduleBlockSheetRef } from "./ScheduleBlockSheet";
export { ScheduleRemindersSync } from "./ScheduleRemindersSync";
// ScheduleEmptyState is deliberately gone: the screen now renders the real
// hour grid on an empty day (see schedule.tsx's note on why the illustrated
// card was dropped), so the component had no remaining call site.
export { Timeline, type TimelineProps } from "./Timeline";
export { TimelineBlock, type TimelineBlockProps } from "./TimelineBlock";
export { TimelineSkeleton } from "./TimelineSkeleton";
export {
  blockDensity,
  blockStatus,
  getDayWindow,
  isWithinWindow,
  minuteToY,
  positionBlocks,
  windowHeight,
  withAlpha,
  type BlockDensity,
  type BlockStatus,
  type DayWindow,
  type PositionedBlock,
} from "./layout";
