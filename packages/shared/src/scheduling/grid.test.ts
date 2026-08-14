import { describe, expect, it } from 'vitest'

import { DAY_END_MIN, DAY_START_MIN } from './grid'

describe('constants', () => {
  it('matches the web app values', () => {
    expect(DAY_START_MIN).toBe(0)
    expect(DAY_END_MIN).toBe(1440)
  })
})
