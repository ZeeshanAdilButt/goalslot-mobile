// New: did not exist on web. Mirrors dw-time-api/src/modules/goals/dto/goals.dto.ts
// (CreateGoalDto / UpdateGoalDto) so client-side validation can't drift from
// what the server actually accepts.

import { z } from 'zod'

export const labelInputSchema = z.object({
  name: z.string().min(1, 'Label name is required'),
  color: z.string().optional(),
})

export const createGoalSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  category: z.string().min(1, "Category is required (value from the user's categories)"),
  targetHours: z.number().min(1, 'Target hours must be at least 1'),
  deadline: z.string().optional(),
  color: z.string().optional(),
  isPrivate: z.boolean().optional(),
  labels: z.array(labelInputSchema).optional(),
})

export const updateGoalSchema = createGoalSchema.partial().extend({
  status: z.enum(['ACTIVE', 'COMPLETED', 'PAUSED']).optional(),
  loggedHours: z.number().optional(),
})

export type CreateGoalInput = z.infer<typeof createGoalSchema>
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>
