import { describe, expect, it, vi } from 'vitest'

import type { MessagingMessage } from '../types/messaging'
import {
  buildSocketUrl,
  createMessagingSocket,
  parseIncomingMessage,
  reconnectDelayMs,
  type MessagingSocketLike,
} from './socket'

/** Minimal stand-in for a WebSocket; `WebSocket` is not a global in Node 20. */
class FakeSocket implements MessagingSocketLike {
  static instances: FakeSocket[] = []

  onopen: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  close(): void {
    this.closed = true
  }
}

interface Harness {
  socket: ReturnType<typeof createMessagingSocket>
  received: MessagingMessage[]
  statuses: string[]
  timers: Array<() => void>
  runTimers: () => void
}

function harness(overrides: { isOnline?: () => boolean; wsUrl?: string | undefined } = {}): Harness {
  FakeSocket.instances = []
  const received: MessagingMessage[] = []
  const statuses: string[] = []
  const timers: Array<() => void> = []

  const socket = createMessagingSocket({
    getWsUrl: () => ('wsUrl' in overrides ? overrides.wsUrl : 'wss://messaging.test'),
    getToken: () => Promise.resolve('jwt-token'),
    onMessage: (message) => received.push(message),
    onStatusChange: (status) => statuses.push(status),
    isOnline: overrides.isOnline ?? (() => true),
    createSocket: (url) => new FakeSocket(url),
    setTimeoutImpl: (handler) => {
      timers.push(handler)
      return timers.length
    },
    clearTimeoutImpl: () => {},
    random: () => 0.5,
  })

  return {
    socket,
    received,
    statuses,
    timers,
    runTimers: () => {
      const pending = timers.splice(0, timers.length)
      pending.forEach((run) => run())
    },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('parseIncomingMessage', () => {
  it('accepts a well-formed push', () => {
    const raw = JSON.stringify({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u2',
      body: 'hi',
      createdAt: '2026-08-12T10:00:00.000Z',
    })
    expect(parseIncomingMessage(raw)).toEqual({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u2',
      body: 'hi',
      createdAt: '2026-08-12T10:00:00.000Z',
    })
  })

  it('drops anything that is not a complete message rather than caching a partial bubble', () => {
    expect(parseIncomingMessage('not json')).toBeNull()
    expect(parseIncomingMessage(JSON.stringify({ id: 'm1' }))).toBeNull()
    expect(parseIncomingMessage(JSON.stringify(null))).toBeNull()
    expect(parseIncomingMessage(JSON.stringify({ id: 1, conversationId: 'c', senderId: 's', body: 'b', createdAt: 'd' }))).toBeNull()
    expect(parseIncomingMessage(new ArrayBuffer(4))).toBeNull()
  })
})

describe('buildSocketUrl', () => {
  it('produces the service handshake shape', () => {
    expect(buildSocketUrl('wss://messaging.test', 'abc')).toBe('wss://messaging.test/?token=abc')
    expect(buildSocketUrl('wss://messaging.test/', 'abc')).toBe('wss://messaging.test/?token=abc')
    expect(buildSocketUrl('wss://messaging.test/?x=1', 'a b')).toBe('wss://messaging.test/?x=1&token=a%20b')
  })
})

describe('reconnectDelayMs', () => {
  it('grows exponentially and stays capped', () => {
    expect(reconnectDelayMs(1, () => 1)).toBe(1000)
    expect(reconnectDelayMs(3, () => 1)).toBe(4000)
    expect(reconnectDelayMs(20, () => 1)).toBe(30_000)
  })

  it('jitters below the ceiling so reconnects do not synchronise', () => {
    expect(reconnectDelayMs(3, () => 0)).toBe(0)
    expect(reconnectDelayMs(3, () => 0.5)).toBe(2000)
  })
})

describe('createMessagingSocket', () => {
  it('connects with the token in the query string and reports open', async () => {
    const h = harness()
    h.socket.connect()
    await flush()

    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0]?.url).toBe('wss://messaging.test/?token=jwt-token')

    FakeSocket.instances[0]?.onopen?.({})
    expect(h.socket.getStatus()).toBe('open')
  })

  it('delivers parsed pushes and ignores malformed frames', async () => {
    const h = harness()
    h.socket.connect()
    await flush()
    const live = FakeSocket.instances[0]
    live?.onopen?.({})

    live?.onmessage?.({ data: '{"nope":true}' })
    live?.onmessage?.({
      data: JSON.stringify({
        id: 'm1',
        conversationId: 'c1',
        senderId: 'u2',
        body: 'hi',
        createdAt: '2026-08-12T10:00:00.000Z',
      }),
    })

    expect(h.received.map((m) => m.id)).toEqual(['m1'])
  })

  it('reconnects after an unexpected close', async () => {
    const h = harness()
    h.socket.connect()
    await flush()
    FakeSocket.instances[0]?.onopen?.({})

    FakeSocket.instances[0]?.onclose?.({ code: 1006 })
    expect(h.socket.getStatus()).toBe('reconnecting')

    h.runTimers()
    await flush()
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('does not schedule a retry loop while offline', async () => {
    let online = true
    const h = harness({ isOnline: () => online })
    h.socket.connect()
    await flush()
    FakeSocket.instances[0]?.onopen?.({})

    online = false
    FakeSocket.instances[0]?.onclose?.({ code: 1006 })

    expect(h.timers).toHaveLength(0)
    expect(h.socket.getStatus()).toBe('closed')
  })

  it('stays idle and never opens a socket when no URL is configured', async () => {
    const h = harness({ wsUrl: undefined })
    h.socket.connect()
    await flush()

    expect(FakeSocket.instances).toHaveLength(0)
    expect(h.socket.getStatus()).toBe('idle')
  })

  it('disconnect detaches handlers so a superseded socket cannot deliver', async () => {
    const h = harness()
    h.socket.connect()
    await flush()
    const live = FakeSocket.instances[0]
    live?.onopen?.({})

    h.socket.disconnect()

    expect(live?.closed).toBe(true)
    expect(live?.onmessage).toBeNull()
    expect(h.socket.getStatus()).toBe('idle')
  })

  it('does not tear down and rebuild an already-open socket on a repeat connect', async () => {
    const h = harness()
    h.socket.connect()
    await flush()
    FakeSocket.instances[0]?.onopen?.({})

    h.socket.connect()
    await flush()

    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('never opens a socket when the token resolves after disconnect', async () => {
    FakeSocket.instances = []
    let release: ((token: string) => void) | undefined
    const socket = createMessagingSocket({
      getWsUrl: () => 'wss://messaging.test',
      getToken: () => new Promise<string>((resolve) => { release = resolve }),
      onMessage: () => {},
      createSocket: (url) => new FakeSocket(url),
      setTimeoutImpl: () => 0,
      clearTimeoutImpl: () => {},
    })

    socket.connect()
    socket.disconnect()
    release?.('late-token')
    await flush()

    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('backs off when the token cannot be minted at all', async () => {
    FakeSocket.instances = []
    const timers: Array<() => void> = []
    const getToken = vi.fn().mockRejectedValue(new Error('no session'))
    const socket = createMessagingSocket({
      getWsUrl: () => 'wss://messaging.test',
      getToken,
      onMessage: () => {},
      createSocket: (url) => new FakeSocket(url),
      setTimeoutImpl: (handler) => timers.push(handler),
      clearTimeoutImpl: () => {},
      random: () => 0.5,
    })

    socket.connect()
    await flush()

    expect(FakeSocket.instances).toHaveLength(0)
    expect(timers).toHaveLength(1)
    expect(socket.getStatus()).toBe('reconnecting')
  })
})
