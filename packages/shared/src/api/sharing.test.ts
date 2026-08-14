import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it } from 'vitest'

import { createSharingApi } from './sharing'

const api = axios.create({ baseURL: 'https://api.test/api' })
const mock = new MockAdapter(api)

afterEach(() => {
  mock.reset()
})

describe('createSharingApi', () => {
  it('reads both directory directions', async () => {
    mock.onGet('/sharing/my-shares').reply(200, [{ id: 's1', sharedWith: null }])
    mock.onGet('/sharing/shared-with-me').reply(200, [{ id: 's2', ownerId: 'u1', owner: { id: 'u1', email: 'a@b.com', name: 'A' } }])

    const sharing = createSharingApi(api)

    expect((await sharing.getMyShares()).data).toEqual([{ id: 's1', sharedWith: null }])
    expect((await sharing.getSharedWithMe()).data[0]?.ownerId).toBe('u1')
  })

  it('fetches a mentee time entries by date range', async () => {
    mock.onGet('/sharing/user/owner-1/time-entries').reply(200, [{ id: 't1' }])

    const sharing = createSharingApi(api)
    const response = await sharing.getSharedUserTimeEntries('owner-1', '2026-08-01', '2026-08-07')

    expect(response.data).toEqual([{ id: 't1' }])
    expect(mock.history.get.find((r) => r.url === '/sharing/user/owner-1/time-entries')?.params).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-07',
    })
  })

  it('fetches a mentee goals', async () => {
    mock.onGet('/sharing/user/owner-1/goals').reply(200, [{ id: 'g1' }])
    const sharing = createSharingApi(api)
    expect((await sharing.getSharedUserGoals('owner-1')).data).toEqual([{ id: 'g1' }])
  })
})
