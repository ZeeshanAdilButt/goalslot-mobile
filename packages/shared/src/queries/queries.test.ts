import { describe, expect, it, vi } from 'vitest'

import type { CategoriesApi } from '../api/categories'
import type { GoalsApi } from '../api/goals'
import type { MessagingServiceClient } from '../api/messaging'
import type { SharingApi } from '../api/sharing'
import type { JournalApi } from '../api/journal'
import type { LabelsApi } from '../api/labels'
import type { ScheduleApi } from '../api/schedule'
import type { TasksApi } from '../api/tasks'
import type { TimeEntriesApi } from '../api/time-entries'
import { createGoalQueries } from './goals'
import { createTaskQueries } from './tasks'
import { createScheduleQueries } from './schedule'
import { createTimeEntryQueries } from './time-entries'
import { createCategoryQueries } from './categories'
import { createLabelQueries } from './labels'
import { createJournalQueries } from './journal'
import { createMessagingQueries } from './messaging'

describe('goal queries', () => {
  it('builds stable, filter-sensitive query keys and wires the fetcher to goalsApi.getAll', async () => {
    const getAll = vi.fn().mockResolvedValue({ data: [{ id: 'g1' }] })
    const goalsApi = { getAll, getStats: vi.fn(), getOne: vi.fn() } as unknown as GoalsApi
    const { goalQueries, list } = createGoalQueries(goalsApi)

    expect(goalQueries.list({ status: 'ACTIVE' })).toEqual(['goals', 'list', { status: 'ACTIVE' }])
    expect(goalQueries.detail('g1')).toEqual(['goals', 'detail', 'g1'])

    const options = list({ status: 'ACTIVE', categories: ['A', 'B'] })
    const data = await options.queryFn?.({} as never)
    expect(getAll).toHaveBeenCalledWith({ status: 'ACTIVE', categories: 'A,B' })
    expect(data).toEqual([{ id: 'g1' }])
  })
})

describe('task queries', () => {
  it('wires the fetcher to tasksApi.list with the given filters', async () => {
    const list = vi.fn().mockResolvedValue({ data: [] })
    const tasksApi = { list } as unknown as TasksApi
    const { taskQueries, list: listOptions } = createTaskQueries(tasksApi)

    expect(taskQueries.list({ status: 'TODO' })).toEqual(['tasks', 'list', { status: 'TODO' }])
    await listOptions({ status: 'TODO' }).queryFn?.({} as never)
    expect(list).toHaveBeenCalledWith({ status: 'TODO' })
  })
})

describe('schedule queries', () => {
  it('wires the weekly fetcher to scheduleApi.getWeekly', async () => {
    const getWeekly = vi.fn().mockResolvedValue({ data: { 0: [] } })
    const scheduleApi = { getWeekly } as unknown as ScheduleApi
    const { scheduleQueries, weekly } = createScheduleQueries(scheduleApi)

    expect(scheduleQueries.weeklyKey()).toEqual(['schedule', 'weekly'])
    const data = await weekly().queryFn?.({} as never)
    expect(getWeekly).toHaveBeenCalled()
    expect(data).toEqual({ 0: [] })
  })
})

describe('time entry queries', () => {
  it('fetches a 7-day local-date range using getLocalDateString (not toISOString)', async () => {
    const getByDateRange = vi.fn().mockResolvedValue({ data: [] })
    const timeEntriesApi = { getByDateRange } as unknown as TimeEntriesApi
    const { recent } = createTimeEntryQueries(timeEntriesApi)

    await recent().queryFn?.({} as never)

    expect(getByDateRange).toHaveBeenCalledTimes(1)
    const [start, end] = getByDateRange.mock.calls[0] as [string, string]
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('category queries', () => {
  it('wires the list fetcher to categoriesApi.getAll', async () => {
    const getAll = vi.fn().mockResolvedValue({ data: [] })
    const categoriesApi = { getAll } as unknown as CategoriesApi
    const { list } = createCategoryQueries(categoriesApi)
    await list().queryFn?.({} as never)
    expect(getAll).toHaveBeenCalled()
  })
})

describe('label queries', () => {
  it('wires the list fetcher to labelsApi.getAll', async () => {
    const getAll = vi.fn().mockResolvedValue({ data: [] })
    const labelsApi = { getAll } as unknown as LabelsApi
    const { list } = createLabelQueries(labelsApi)
    await list().queryFn?.({} as never)
    expect(getAll).toHaveBeenCalled()
  })
})

describe('journal queries', () => {
  it('builds stable, range-sensitive query keys and wires the fetcher to journalApi.list', async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ id: 'j1', date: '2026-08-08', content: 'hi' }] })
    const journalApi = { list, getByDate: vi.fn() } as unknown as JournalApi
    const { journalQueries, list: listOptions } = createJournalQueries(journalApi)

    const range = { from: '2026-08-01', to: '2026-08-08' }
    expect(journalQueries.list(range)).toEqual(['journal', 'list', range])
    expect(journalQueries.byDate('2026-08-08')).toEqual(['journal', 'date', '2026-08-08'])

    const data = await listOptions(range).queryFn?.({} as never)
    expect(list).toHaveBeenCalledWith(range)
    expect(data).toEqual([{ id: 'j1', date: '2026-08-08', content: 'hi' }])
  })

  it('resolves a 404 from getByDate to null instead of throwing', async () => {
    const notFound = { response: { status: 404 } }
    const getByDate = vi.fn().mockRejectedValue(notFound)
    const journalApi = { list: vi.fn(), getByDate } as unknown as JournalApi
    const { byDate } = createJournalQueries(journalApi)

    const data = await byDate('2026-08-08').queryFn?.({} as never)
    expect(data).toBeNull()
  })

  it('rethrows non-404 errors from getByDate', async () => {
    const serverError = { response: { status: 500 } }
    const getByDate = vi.fn().mockRejectedValue(serverError)
    const journalApi = { list: vi.fn(), getByDate } as unknown as JournalApi
    const { byDate } = createJournalQueries(journalApi)

    await expect(byDate('2026-08-08').queryFn?.({} as never)).rejects.toBe(serverError)
  })
})

describe('messaging queries', () => {
  function build() {
    const client = {
      listConversations: vi.fn().mockResolvedValue([{ id: 'c1', participants: [] }]),
      getConversation: vi.fn().mockResolvedValue({ id: 'c1', participants: [] }),
      listMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn(),
      markRead: vi.fn(),
    } as unknown as MessagingServiceClient

    const sharingApi = {
      getMyShares: vi.fn().mockResolvedValue({ data: [{ id: 's1', sharedWith: { id: 'u2', email: 'z@e.com', name: 'Zoe' } }] }),
      getSharedWithMe: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as SharingApi

    return { client, sharingApi, queries: createMessagingQueries(client, sharingApi) }
  }

  it('namespaces every key under `messaging` so the whole feature invalidates as one', () => {
    const { queries } = build()
    const { messagingQueries } = queries

    expect(messagingQueries.all).toEqual(['messaging'])
    expect(messagingQueries.conversations()).toEqual(['messaging', 'conversations'])
    expect(messagingQueries.conversation('c1')).toEqual(['messaging', 'conversation', 'c1'])
    expect(messagingQueries.messages('c1')).toEqual(['messaging', 'messages', 'c1'])
    expect(messagingQueries.contacts()).toEqual(['messaging', 'contacts'])
  })

  it('keys a thread by conversation id only, so paging never changes the key a socket push patches', () => {
    const { queries } = build()
    expect(queries.messages('c1').queryKey).toEqual(queries.messagingQueries.messages('c1'))
  })

  it('wires the fetchers to the messaging service client', async () => {
    const { client, queries } = build()

    await queries.conversations().queryFn?.({} as never)
    await queries.messages('c1').queryFn?.({} as never)

    expect(client.listConversations).toHaveBeenCalled()
    expect(client.listMessages).toHaveBeenCalledWith('c1')
  })

  it('builds the contact list from both sharing directions in one query', async () => {
    const { sharingApi, queries } = build()

    const contacts = await queries.contacts().queryFn?.({} as never)

    expect(sharingApi.getMyShares).toHaveBeenCalled()
    expect(sharingApi.getSharedWithMe).toHaveBeenCalled()
    expect(contacts).toEqual([
      { userId: 'u2', name: 'Zoe', email: 'z@e.com', relationship: 'shared-with-them' },
    ])
  })
})
