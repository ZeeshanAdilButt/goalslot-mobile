// New: did not exist on web. Mirrors dw-time-api/src/modules/schedule/dto/schedule.dto.ts
// (CreateScheduleBlockDto / UpdateScheduleBlockDto).

import { z } from 'zod'

// Same pattern the API uses (class-validator @Matches on CreateScheduleBlockDto).
const HH_MM_PATTERN = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/

export const createScheduleBlockSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  startTime: z.string().regex(HH_MM_PATTERN, 'Start time must be in HH:mm format'),
  endTime: z.string().regex(HH_MM_PATTERN, 'End time must be in HH:mm format'),
  dayOfWeek: z.number().int().min(0).max(6),
  category: z.string().min(1, "Category is required (value from the user's categories)"),
  color: z.string().optional(),
  isRecurring: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
  goalId: z.string().uuid().optional(),
  seriesId: z.string().uuid().optional(),
})

export const updateScheduleBlockSchema = createScheduleBlockSchema.partial().extend({
  updateScope: z.enum(['single', 'series']).optional(),
})

export type CreateScheduleBlockInput = z.infer<typeof createScheduleBlockSchema>
export type UpdateScheduleBlockInput = z.infer<typeof updateScheduleBlockSchema>
