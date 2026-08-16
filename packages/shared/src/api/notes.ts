// Ported from dw-time-web/src/lib/api.ts (notesApi). The sharing endpoints
// (shared-with-me, share state, public links, invites) are deliberately not
// ported yet — mobile v1 only needs the owner CRUD + reorder surface.

import type { AxiosInstance } from 'axios'

import type { CreateNoteDto, Note, NoteDetailResponse, NoteReorderItem, UpdateNoteDto } from '../types/note'
import { idempotentConfig, type IdempotentRequestOptions } from './idempotency'

export function createNotesApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Note[]>('/notes'),
    getOne: (id: string) => api.get<NoteDetailResponse>(`/notes/${id}`),
    /**
     * `options.idempotencyKey`, same reasoning as ./time-entries.ts's
     * `create`. `CreateNoteDto.id` already carries a client-generated id that
     * makes a true duplicate ROW impossible (the second insert hits a unique
     * constraint on id) — but without a key, that second attempt surfaces as
     * an unmapped Prisma error, which the server's generic exception filter
     * turns into a 500. The sync engine treats any 5xx as "still failing,
     * retry" (see packages/shared/src/offline/sync.ts), so a create that
     * actually succeeded ends up retried for `maxRetries` drains and then
     * dropped with a false "could not be synced" toast. Forwarding the key
     * lets the server's idempotency interceptor recognise the replay BEFORE
     * it ever reaches the insert and hand back the original 201 instead.
     */
    create: (data: CreateNoteDto, options?: IdempotentRequestOptions) =>
      api.post<Note>('/notes', data, idempotentConfig(options)),
    update: (id: string, data: UpdateNoteDto) => api.put<Note>(`/notes/${id}`, data),
    delete: (id: string) => api.delete(`/notes/${id}`),
    // Body is a bare array — NOT the { ids } wrapper goals/tasks use.
    reorder: (items: NoteReorderItem[]) => api.put('/notes/reorder', items),
  }
}

export type NotesApi = ReturnType<typeof createNotesApi>
