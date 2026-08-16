import { afterEach, describe, expect, it, vi } from 'vitest'

import { genId } from './id'

// RFC4122 v4: 8-4-4-4-12 hex, version nibble '4', variant nibble in 8-b.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('genId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates unique, non-empty ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId()))
    expect(ids.size).toBe(100)
    ids.forEach((id) => expect(id.length).toBeGreaterThan(0))
  })

  it('returns a real UUID when crypto.randomUUID is available', () => {
    expect(genId()).toMatch(UUID_V4)
  })

  // Regression test for the "id must be a UUID" bug: on a runtime without
  // crypto.randomUUID (e.g. Hermes with no crypto polyfill), the fallback
  // used to return `${Date.now()}-${random}`, which notes.tsx's createNote
  // sends straight to POST /notes as CreateNoteDto.id — rejected by the
  // API's @IsUUID() validator before the page was ever created. The fallback
  // must still be a real UUID v4 string.
  it('falls back to a valid UUID v4 when crypto.randomUUID is unavailable', () => {
    // globalThis.crypto is a getter-only accessor in this runtime, so a
    // plain assignment throws — stubGlobal replaces (and vi.restoreAllMocks
    // above / vi.unstubAllGlobals below restores) it properly.
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: undefined })

    const ids = new Set(Array.from({ length: 50 }, () => genId()))
    expect(ids.size).toBe(50)
    ids.forEach((id) => expect(id).toMatch(UUID_V4))

    vi.unstubAllGlobals()
  })
})
