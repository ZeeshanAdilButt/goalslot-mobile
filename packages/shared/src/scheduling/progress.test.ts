import { describe, expect, it } from 'vitest'

import { calculateProgressPercent } from './progress'

describe('calculateProgressPercent', () => {
  it('computes the rounded percentage', () => {
    expect(calculateProgressPercent(5, 10)).toBe(50)
    expect(calculateProgressPercent(1, 3)).toBe(33)
    expect(calculateProgressPercent(0, 10)).toBe(0)
  })

  it('clamps at 100 even when logged exceeds target', () => {
    expect(calculateProgressPercent(20, 10)).toBe(100)
  })

  it('returns 0 for a zero or negative target instead of NaN/Infinity', () => {
    expect(calculateProgressPercent(5, 0)).toBe(0)
    expect(calculateProgressPercent(5, -10)).toBe(0)
  })
})
