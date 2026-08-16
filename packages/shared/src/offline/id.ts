// Ported as-is from dw-time-web/src/lib/offline/id.ts — already has a safe
// fallback for runtimes without crypto.randomUUID.
//
// The fallback MUST produce a real RFC4122 v4 UUID string, not just any
// unique-looking string. Every caller treats genId() as interchangeable with
// crypto.randomUUID() — most only use it for a local optimistic-cache id that
// gets replaced by the server's row, but notes.tsx's createNote sends it
// straight to the API as CreateNoteDto.id, which is validated with
// @IsUUID() and stored in a Postgres uuid column. The previous fallback
// (`${Date.now()}-${random}`) is not UUID-shaped, so on any runtime without
// crypto.randomUUID (e.g. Hermes with no crypto polyfill installed) every
// note creation was rejected by the API with "id must be a UUID" before the
// row was ever created — see the regression test below for the exact shape
// this guards against.
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (placeholder) => {
    const random = (Math.random() * 16) | 0
    const value = placeholder === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}
