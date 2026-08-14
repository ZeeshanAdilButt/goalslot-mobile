// Ported from dw-time-web/src/features/notes/hooks/use-notes.ts (the query
// halves of useNotesQuery / useNoteQuery), reshaped into the same
// factory-around-the-api-group pattern as ./goals. The web keyed the detail
// query as ['notes', id]; here it follows this package's ['notes', 'detail',
// id] convention so list and detail keys can't collide.

import { queryOptions } from '@tanstack/react-query'

import type { NotesApi } from '../api/notes'
import type { Note, NoteDetailResponse } from '../types/note'

export function createNoteQueries(notesApi: NotesApi) {
  const noteQueries = {
    all: ['notes'] as const,
    list: () => [...noteQueries.all, 'list'] as const,
    detail: (id: string) => [...noteQueries.all, 'detail', id] as const,
  }

  const fetchNotes = async (): Promise<Note[]> => {
    const res = await notesApi.getAll()
    return res.data
  }

  const fetchNote = async (id: string): Promise<NoteDetailResponse> => {
    const res = await notesApi.getOne(id)
    return res.data
  }

  return {
    noteQueries,
    fetchNotes,
    fetchNote,
    list: () =>
      queryOptions({
        queryKey: noteQueries.list(),
        queryFn: fetchNotes,
      }),
    detail: (id: string) =>
      queryOptions({
        queryKey: noteQueries.detail(id),
        queryFn: () => fetchNote(id),
      }),
  }
}
