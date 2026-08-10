// Barrel for the Schedule screen's presentation layer. Everything here is
// specific to the time-axis view — nothing else in the app imports it, so it
// stays out of `src/components/index.ts`'s app-wide surface.

export { BlockDetailSheet, type BlockDetailSheetProps } from "./BlockDetailSheet";
export { DayStrip, type DayStripProps } from "./DayStrip";
export { NowIndicator, type NowIndicatorProps } from "./NowIndicator";
export { ScheduleBlockSheet, type ScheduleBlockSheetPresentOptions, type ScheduleBlockSheetRef } from "./ScheduleBlockSheet";
export { ScheduleEmptyState, type ScheduleEmptyStateProps } from "./ScheduleEmptyState";
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
