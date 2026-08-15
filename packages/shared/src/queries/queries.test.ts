import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { CategoriesApi } from '../api/categories'
import type { GoalsApi } from '../api/goals'
import type { InstructionsApi } from '../api/instructions'
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
import { createSharingQueries } from './sharing'
import { createInstructionsQueries } from './instructions'

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
    const messagesOptions = queries.messages('c1')

    await queries.conversations().queryFn?.({} as never)
    // messages()'s queryFn reads the QueryClient out of its context (to
    // merge the fetched page against whatever's already cached — see its
    // doc comment), so unlike the other fetchers here it needs a real one,
    // not the empty stand-in `{} as never` works for everywhere else.
    await messagesOptions.queryFn?.({ client: new QueryClient(), queryKey: messagesOptions.queryKey } as never)

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

describe('sharing queries', () => {
  function build() {
    const sharingApi = {
      getMyShares: vi.fn(),
      getSharedWithMe: vi.fn().mockResolvedValue({ data: [{ id: 's1', ownerId: 'u1' }] }),
      getSharedUserTimeEntries: vi.fn().mockResolvedValue({ data: [{ id: 't1' }] }),
      getSharedUserGoals: vi.fn().mockResolvedValue({ data: [{ id: 'g1' }] }),
    } as unknown as SharingApi

    return { sharingApi, queries: createSharingQueries(sharingApi) }
  }

  it('namespaces every key under `sharing`, distinct from messaging`s own contact-list cache', () => {
    const { queries } = build()
    expect(queries.sharingQueries.all).toEqual(['sharing'])
    expect(queries.sharingQueries.sharedWithMe()).toEqual(['sharing', 'shared-with-me'])
    expect(queries.sharingQueries.sharedUserTimeEntries('u1', '2026-08-01', '2026-08-07')).toEqual([
      'sharing',
      'shared-user',
      'u1',
      'time-entries',
      '2026-08-01',
      '2026-08-07',
    ])
    expect(queries.sharingQueries.sharedUserGoals('u1')).toEqual(['sharing', 'shared-user', 'u1', 'goals'])
  })

  it('wires the fetchers to sharingApi and unwraps the axios response', async () => {
    const { sharingApi, queries } = build()

    expect(await queries.sharedWithMe().queryFn?.({} as never)).toEqual([{ id: 's1', ownerId: 'u1' }])
    expect(sharingApi.getSharedWithMe).toHaveBeenCalled()

    expect(await queries.sharedUserTimeEntries('u1', '2026-08-01', '2026-08-07').queryFn?.({} as never)).toEqual([
      { id: 't1' },
    ])
    expect(sharingApi.getSharedUserTimeEntries).toHaveBeenCalledWith('u1', '2026-08-01', '2026-08-07')

    expect(await queries.sharedUserGoals('u1').queryFn?.({} as never)).toEqual([{ id: 'g1' }])
    expect(sharingApi.getSharedUserGoals).toHaveBeenCalledWith('u1')
  })
})

describe('instructions queries', () => {
  function build() {
    const instructionsApi = {
      assign: vi.fn(),
      listAssignedByMe: vi.fn().mockResolvedValue({ data: [{ id: 'i1' }] }),
      listAssignedToMe: vi.fn().mockResolvedValue({ data: [{ id: 'i2' }] }),
      complete: vi.fn(),
    } as unknown as InstructionsApi

    return { instructionsApi, queries: createInstructionsQueries(instructionsApi) }
  }

  it('namespaces every key under `instructions`', () => {
    const { queries } = build()
    expect(queries.instructionsQueries.all).toEqual(['instructions'])
    expect(queries.instructionsQueries.assignedByMe()).toEqual(['instructions', 'assigned-by-me'])
    expect(queries.instructionsQueries.assignedToMe()).toEqual(['instructions', 'assigned-to-me'])
  })

  it('wires the fetchers to instructionsApi and unwraps the axios response', async () => {
    const { instructionsApi, queries } = build()

    expect(await queries.assignedByMe().queryFn?.({} as never)).toEqual([{ id: 'i1' }])
    expect(instructionsApi.listAssignedByMe).toHaveBeenCalled()

    expect(await queries.assignedToMe().queryFn?.({} as never)).toEqual([{ id: 'i2' }])
    expect(instructionsApi.listAssignedToMe).toHaveBeenCalled()
  })
})
