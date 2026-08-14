// New: no web equivalent exists to port from (dw-time-web has no
// instructions UI either — this is the first client of goal-slot-api's
// `instructions` module on either platform). Matches goal-slot-api's
// src/modules/instructions/{instructions.controller,dto/instructions.dto}.ts
// field-for-field.
//
// Direction mirrors sharing: an instruction can only be assigned by the
// `sharedWith` side of an accepted share on the assignee's data (the server
// enforces this — see the controller's own comment — this client makes no
// attempt to duplicate that check). A mentor assigns; a mentee completes.

import type { AxiosInstance } from 'axios'

export type InstructionStatus = 'PENDING' | 'DONE'

/** The reduced user projection the API embeds on `assigner`/`assignee`. */
export interface InstructionPerson {
  id: string
  name: string | null
  email: string
}

export interface Instruction {
  id: string
  assignerId: string
  assigneeId: string
  title: string
  note: string | null
  status: InstructionStatus
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface InstructionAssignedByMe extends Instruction {
  assignee: InstructionPerson
}

export interface InstructionAssignedToMe extends Instruction {
  assigner: InstructionPerson
}

export interface AssignInstructionInput {
  /** User id of the mentee receiving the instruction — the share's `ownerId`. */
  assigneeId: string
  title: string
  note?: string
}

export function createInstructionsApi(api: AxiosInstance) {
  return {
    assign: (data: AssignInstructionInput) => api.post<InstructionAssignedByMe>('/instructions', data),
    listAssignedByMe: () => api.get<InstructionAssignedByMe[]>('/instructions/assigned-by-me'),
    listAssignedToMe: () => api.get<InstructionAssignedToMe[]>('/instructions/assigned-to-me'),
    complete: (id: string) => api.patch<InstructionAssignedToMe>(`/instructions/${id}/complete`),
  }
}

export type InstructionsApi = ReturnType<typeof createInstructionsApi>
