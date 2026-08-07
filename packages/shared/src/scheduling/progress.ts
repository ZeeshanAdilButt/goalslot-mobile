// New extraction: the web app computed `min(100, round(logged/target*100))`
// inline in four separate places (features/goals/components/goal-item.tsx,
// features/dashboard/components/dashboard-goals.tsx, app/share/accept/page.tsx,
// features/tasks/components/task-list-item/task-progress.tsx). One canonical
// implementation here.

/**
 * Percentage of a target that has been logged so far, clamped to [0, 100]
 * and rounded to the nearest whole percent. Returns 0 when target is 0 or
 * negative (avoids Infinity/NaN from a divide-by-zero).
 */
export function calculateProgressPercent(logged: number, target: number): number {
  if (!Number.isFinite(logged) || !Number.isFinite(target) || target <= 0) return 0
  return Math.min(100, Math.round((logged / target) * 100))
}
