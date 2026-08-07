import { describe, expect, it, vi } from 'vitest'

import { createOperationRegistry } from './registry'

describe('createOperationRegistry', () => {
  it('registers and retrieves an operation by kind', () => {
    const registry = createOperationRegistry()
    const execute = vi.fn()
    registry.registerOperation('goal.create', { execute })

    expect(registry.getOperation('goal.create')).toEqual({ execute })
    expect(registry.getOperation('unknown')).toBeUndefined()
  })

  it('isolates separate registry instances', () => {
    const registryA = createOperationRegistry()
    const registryB = createOperationRegistry()
    registryA.registerOperation('goal.create', { execute: vi.fn() })

    expect(registryA.getOperation('goal.create')).toBeDefined()
    expect(registryB.getOperation('goal.create')).toBeUndefined()
  })
})
