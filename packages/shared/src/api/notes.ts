// Ported from dw-time-web/src/lib/api.ts (notesApi). The sharing endpoints
// (shared-with-me, share state, public links, invites) are deliberately not
// ported yet — mobile v1 only needs the owner CRUD + reorder surface.

import type { AxiosInstance } from 'axios'

import type { CreateNoteDto, Note, NoteDetailResponse, NoteReorderItem, UpdateNoteDto } from '../types/note'

export function createNotesApi(api: AxiosInstance) {
  return {
    getAll: () => api.get<Note[]>('/notes'),
    getOne: (id: string) => api.get<NoteDetailResponse>(`/notes/${id}`),
    create: (data: CreateNoteDto) => api.post<Note>('/notes', data),
    update: (id: string, data: UpdateNoteDto) => api.put<Note>(`/notes/${id}`, data),
    delete: (id: string) => api.delete(`/notes/${id}`),
    // Body is a bare array — NOT the { ids } wrapper goals/tasks use.
    reorder: (items: NoteReorderItem[]) => api.put('/notes/reorder', items),
  }
}

export type NotesApi = ReturnType<typeof createNotesApi>
