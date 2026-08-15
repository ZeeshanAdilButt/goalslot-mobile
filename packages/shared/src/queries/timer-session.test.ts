import { describe, expect, it } from 'vitest'

import { toActiveTimerSession } from './timer-session'

describe('toActiveTimerSession', () => {
  it('passes a real session straight through', () => {
    const session = { id: 's1', status: 'RUNNING' }
    expect(toActiveTimerSession(session)).toBe(session)
  })

  it("treats axios's empty-body '' as no session", () => {
    // The regression this exists for: NestJS answers "nothing is running"
    // with a 200 and an empty body, which axios hands back as ''. A truthy
    // '' used to render as a phantom PAUSED session nothing could stop.
    expect(toActiveTimerSession('')).toBeNull()
  })

  it('treats null, undefined and other non-objects as no session', () => {
    expect(toActiveTimerSession(null)).toBeNull()
    expect(toActiveTimerSession(undefined)).toBeNull()
    expect(toActiveTimerSession('RUNNING')).toBeNull()
    expect(toActiveTimerSession(0)).toBeNull()
  })

  it('rejects an object with no status, however session-shaped it looks', () => {
    expect(toActiveTimerSession({ id: 's1', accumulatedMs: 0 })).toBeNull()
  })
})
