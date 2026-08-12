import { describe, expect, it, vi } from 'vitest'

import { createNoopCapabilities } from './index'

describe('createNoopCapabilities', () => {
  it('provides all three capability groups', () => {
    const caps = createNoopCapabilities()
    expect(caps.alarms).toBeDefined()
    expect(caps.voice).toBeDefined()
    expect(caps.notifications).toBeDefined()
  })

  it('alarms: schedule/list/cancel round-trip through an in-memory map without throwing', async () => {
    const caps = createNoopCapabilities()
    await caps.alarms.scheduleAlarm({
      id: 'a1',
      scheduleBlockId: 'sb1',
      fireAtUtc: '2026-08-07T14:30:00.000Z',
      title: 'Deep work',
    })
    expect(await caps.alarms.listScheduled()).toEqual([
      { id: 'a1', scheduleBlockId: 'sb1', fireAtUtc: '2026-08-07T14:30:00.000Z', title: 'Deep work' },
    ])
    await caps.alarms.cancelAlarm('a1')
    expect(await caps.alarms.listScheduled()).toEqual([])
  })

  it('voice: is never available and never invokes the transcript callback', async () => {
    const caps = createNoopCapabilities()
    expect(await caps.voice.isAvailable()).toBe(false)
    const onTranscript = vi.fn()
    await caps.voice.startListening(onTranscript)
    await caps.voice.stopListening()
    expect(onTranscript).not.toHaveBeenCalled()
  })

  it('notifications: permission is denied and schedule/cancel resolve without error', async () => {
    const caps = createNoopCapabilities()
    expect(await caps.notifications.requestPermission()).toBe(false)
    await expect(
      caps.notifications.scheduleNotification({
        id: 'n1',
        title: 'Reminder',
        body: 'Time to focus',
        fireAtUtc: '2026-08-07T14:30:00.000Z',
      }),
    ).resolves.toBeUndefined()
    await expect(caps.notifications.cancelNotification('n1')).resolves.toBeUndefined()
  })

  it('notifications: reports a status that matches what requestPermission will do', async () => {
    // The pairing is the contract, not the literal value: a caller that shows
    // an "Allow notifications" button on 'undetermined' would be showing a
    // dead button here, since requestPermission can only ever return false.
    const caps = createNoopCapabilities()
    expect(await caps.notifications.getPermissionStatus()).toBe('denied')
    expect(await caps.notifications.requestPermission()).toBe(false)
  })

  it('notifications: the bulk sign-out sweep resolves without error', async () => {
    // Its one caller is a sign-out (apps/mobile/src/lib/session-reset.ts),
    // which must never be blocked by the notification layer — including when
    // the notification layer is this inert stand-in.
    const caps = createNoopCapabilities()
    await expect(caps.notifications.clearAllNotifications()).resolves.toBeUndefined()
  })

  it('each call to the factory returns an independent instance', async () => {
    const capsA = createNoopCapabilities()
    const capsB = createNoopCapabilities()
    await capsA.alarms.scheduleAlarm({ id: 'a1', scheduleBlockId: 'sb1', fireAtUtc: 'x', title: 't' })
    expect(await capsB.alarms.listScheduled()).toEqual([])
  })
})
