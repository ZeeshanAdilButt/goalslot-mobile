// New: did not exist on web. Mirrors dw-time-api/src/modules/tasks/dto/tasks.dto.ts
// (CreateTaskDto / UpdateTaskDto / CompleteTaskDto).

import { z } from 'zod'

export const taskStatusSchema = z.enum(['BACKLOG', 'TODO', 'DOING', 'DONE'])

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  category: z.string().optional(),
  status: taskStatusSchema.optional(),
  estimatedMinutes: z.number().min(1, 'Estimated minutes must be at least 1').optional(),
  goalId: z.string().uuid().optional(),
  scheduleBlockId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
})

export const updateTaskSchema = createTaskSchema.partial()

export const completeTaskSchema = z.object({
  actualMinutes: z.number().min(1, 'Actual minutes must be at least 1'),
  notes: z.string().optional(),
  date: z.string().optional(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>
