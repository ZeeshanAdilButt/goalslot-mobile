// Ported from dw-time-web/src/features/notes/utils/types.ts (types only).
// The tree helpers that lived alongside these on web (buildNoteTree etc.)
// are in ../notes/tree.ts; the NOTE_COLORS / NOTE_ICONS picker constants
// stayed on web — the color values are Tailwind class names with no
// meaning off the DOM.

export interface Note {
  id: string
  title: string
  /** Serialized editor content. Current clients store an HTML string; the
   *  API defaults new rows to '[]' (the legacy JSON-blocks format), so
   *  treat it as an opaque string. */
  content: string
  icon: string | null
  color: string | null
  parentId: string | null
  order: number
  isExpanded: boolean
  isFavorite: boolean
  /** ISO timestamp string. The web type declared `Date`, but what the API
   *  actually returns over JSON (and what sits in the query cache) is a
   *  string — fixed here rather than re-ported. */
  createdAt: string
  updatedAt: string
  userId: string
}

export interface NoteTreeItem extends Note {
  children: NoteTreeItem[]
  depth: number
}

/** Response shape of GET /notes/:id — resolves for the owner OR an active
 *  share recipient; `readOnly` is true for recipients so editors must
 *  disable saves. */
export interface NoteDetailResponse {
  note: Note
  readOnly: boolean
}

/** Mirrors dw-time-api/src/modules/notes/dto/notes.dto.ts (CreateNoteDto),
 *  plus the optional client-generated `id` the web's `note.create` offline
 *  operation posts (`{ id: meta.entityId, ...data }`) so queued creates
 *  are idempotent. The server ignores unknown fields via whitelist. */
export interface CreateNoteDto {
  id?: string
  title: string
  content?: string
  icon?: string
  color?: string
  parentId?: string | null
}

/** Mirrors dw-time-api/src/modules/notes/dto/notes.dto.ts (UpdateNoteDto). */
export interface UpdateNoteDto {
  title?: string
  content?: string
  icon?: string
  color?: string
  parentId?: string | null
  order?: number
  isExpanded?: boolean
  isFavorite?: boolean
}

/** One row of the PUT /notes/reorder payload. NOTE: the request body is a
 *  BARE ARRAY of these — tree-aware, unlike the `{ ids }` wrapper the
 *  goals/tasks reorder endpoints take. (Named `ReorderPayloadItem` in the
 *  web's tree-dnd.ts; renamed here so it reads as a note type from the
 *  package root.) */
export interface NoteReorderItem {
  noteId: string
  parentId: string | null
  order: number
}
