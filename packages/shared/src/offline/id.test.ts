import { describe, expect, it } from 'vitest'

import { genId } from './id'

describe('genId', () => {
  it('generates unique, non-empty ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => genId()))
    expect(ids.size).toBe(100)
    ids.forEach((id) => expect(id.length).toBeGreaterThan(0))
  })
})
