// New: did not exist on web. Mirrors dw-time-api/src/modules/time-entries/dto/time-entries.dto.ts
// (CreateTimeEntryDto / UpdateTimeEntryDto).

import { z } from 'zod'

export const createTimeEntrySchema = z.object({
  taskName: z.string().min(1, 'Task name is required'),
  duration: z.number().min(1, 'Duration must be at least 1 minute'),
  date: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
  startedAt: z.string().optional(),
  taskTitle: z.string().optional(),
  goalId: z.string().uuid().optional(),
  scheduleBlockId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
})

export const updateTimeEntrySchema = createTimeEntrySchema.partial()

export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>
