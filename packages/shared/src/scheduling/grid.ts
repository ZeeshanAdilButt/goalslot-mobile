// Ported from dw-time-web/src/features/schedule/utils/constants.ts and
// dw-time-web/src/features/schedule/utils/utils.ts.
//
// Deliberately excludes PX_PER_MIN / COLUMN_HEIGHT / HOURS — those are web
// drag-grid layout values with no meaning off a DOM canvas (mobile v1 uses a
// day-agenda list, not a 7-day drag grid; see dw-time-mobile/DECISIONS.md #5).

export const DAY_START_MIN = 0
export const DAY_END_MIN = 24 * 60
