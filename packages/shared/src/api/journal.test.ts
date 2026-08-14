// Pins the journal client to goal-slot-api's ACTUAL routes.
//
// This file exists because of a real bug, not for coverage. The update and
// delete calls used to be built by interpolating an entry's cuid — `PUT
// /coach/journal/entries/:id`, `DELETE /coach/journal/entries/:id` — against
// a controller whose only by-entry routes are `PUT /:date/content` and
// `DELETE /:date`, both constrained by `\d{4}-\d{2}-\d{2}`. A cuid matches no
// route at all, so every edit to an already-saved entry and every delete
// 404'd. Nothing failed at compile time (both parameters are strings) and no
// test looked at the URL, so it shipped.
//
// So these assertions are on the literal request line and body, which is the
// only layer where that class of mistake is visible.

import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { describe, expect, it } from 'vitest'

import { createJournalApi } from './journal'

const DATE = '2026-08-14'
// Shaped like the id a real entry carries, which is exactly what must NEVER
// reach a by-date path.
const CUID = 'clz9k2h4x0000v8pq7t3m1n2b'

function setup() {
  const api = axios.create({ baseURL: 'https://api.test/api' })
  return { api, mock: new MockAdapter(api), journal: createJournalApi(api) }
}

describe('createJournalApi', () => {
  it('lists entries with the from/to range as query params', async () => {
    const { mock, journal } = setup()
    mock.onGet('/coach/journal/entries').reply(200, [])

    await journal.list({ from: '2026-08-01', to: DATE })

    expect(mock.history.get[0]?.url).toBe('/coach/journal/entries')
    expect(mock.history.get[0]?.params).toEqual({ from: '2026-08-01', to: DATE })
  })

  it('reads one day by date', async () => {
    const { mock, journal } = setup()
    mock.onGet(`/coach/journal/entries/${DATE}`).reply(200, { id: CUID, date: DATE, content: 'hi' })

    expect((await journal.getByDate(DATE)).data?.id).toBe(CUID)
  })

  it('resolves a day with no entry to a null body, not a 404', async () => {
    // The service returns `row ?? null` and the controller passes it straight
    // through as a 200. queries/journal.ts's catch-404 branch is defensive
    // only — this is the shape that actually arrives.
    const { mock, journal } = setup()
    mock.onGet(`/coach/journal/entries/${DATE}`).reply(200, null)

    expect((await journal.getByDate(DATE)).data).toBeNull()
  })

  it('upserts through POST on the collection, sending the date in the body', async () => {
    // POST is a Prisma upsert on [userId, date], so this one call is both the
    // create and the update. The date has to travel in the body — there is no
    // by-date POST route.
    const { mock, journal } = setup()
    mock.onPost('/coach/journal/entries').reply(201, { id: CUID, date: DATE, content: 'written' })

    const response = await journal.upsert({ date: DATE, content: 'written' })

    expect(mock.history.post[0]?.url).toBe('/coach/journal/entries')
    expect(mock.history.post[0]?.data).toBe(JSON.stringify({ date: DATE, content: 'written' }))
    expect(response.data.id).toBe(CUID)
  })

  it('routes the deprecated create alias at the same upsert endpoint', async () => {
    const { mock, journal } = setup()
    mock.onPost('/coach/journal/entries').reply(201, {})

    await journal.create({ date: DATE, content: 'x' })

    expect(mock.history.post[0]?.url).toBe('/coach/journal/entries')
  })

  it('sets content on the by-DATE content route, never on a bare entry path', async () => {
    const { mock, journal } = setup()
    mock.onPut(`/coach/journal/entries/${DATE}/content`).reply(200, {})

    await journal.update(DATE, { content: 'edited' })

    expect(mock.history.put[0]?.url).toBe(`/coach/journal/entries/${DATE}/content`)
    expect(mock.history.put[0]?.data).toBe(JSON.stringify({ content: 'edited' }))
  })

  it('deletes by DATE, on a path a cuid could never occupy', async () => {
    const { mock, journal } = setup()
    mock.onDelete(`/coach/journal/entries/${DATE}`).reply(200, { success: true })

    const response = await journal.delete(DATE)

    expect(mock.history.delete[0]?.url).toBe(`/coach/journal/entries/${DATE}`)
    expect(response.data.success).toBe(true)
  })

  it('never puts an entry id into a request path', async () => {
    // The regression itself, stated directly: drive every write with a real
    // date and assert no cuid appears anywhere in the URLs produced. If some
    // future edit reintroduces an id-keyed path, this fails regardless of
    // which method it is hidden in.
    const { mock, journal } = setup()
    mock.onAny().reply(200, {})

    await journal.upsert({ date: DATE, content: 'a' })
    await journal.update(DATE, { content: 'b' })
    await journal.delete(DATE)
    await journal.getByDate(DATE)

    for (const request of mock.history.post.concat(mock.history.put, mock.history.delete, mock.history.get)) {
      expect(request.url).not.toContain(CUID)
      expect(request.url).toMatch(/^\/coach\/journal\/entries(\/\d{4}-\d{2}-\d{2}(\/content)?)?$/)
    }
  })
})
