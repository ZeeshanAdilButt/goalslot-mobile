import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it } from 'vitest'

import { createInstructionsApi } from './instructions'

const api = axios.create({ baseURL: 'https://api.test/api' })
const mock = new MockAdapter(api)

afterEach(() => {
  mock.reset()
})

describe('createInstructionsApi', () => {
  it('assigns an instruction with the assignee, title and optional note', async () => {
    mock.onPost('/instructions').reply(201, { id: 'i1', assigneeId: 'u2', title: 'Log time daily' })

    const instructions = createInstructionsApi(api)
    const response = await instructions.assign({ assigneeId: 'u2', title: 'Log time daily', note: 'Keep it up' })

    expect(response.data.id).toBe('i1')
    expect(JSON.parse(mock.history.post[0]?.data)).toEqual({
      assigneeId: 'u2',
      title: 'Log time daily',
      note: 'Keep it up',
    })
  })

  it('lists instructions assigned by the caller', async () => {
    mock.onGet('/instructions/assigned-by-me').reply(200, [{ id: 'i1' }])
    const instructions = createInstructionsApi(api)
    expect((await instructions.listAssignedByMe()).data).toEqual([{ id: 'i1' }])
  })

  it('lists instructions assigned to the caller', async () => {
    mock.onGet('/instructions/assigned-to-me').reply(200, [{ id: 'i2' }])
    const instructions = createInstructionsApi(api)
    expect((await instructions.listAssignedToMe()).data).toEqual([{ id: 'i2' }])
  })

  it('marks an instruction complete', async () => {
    mock.onPatch('/instructions/i1/complete').reply(200, { id: 'i1', status: 'DONE' })
    const instructions = createInstructionsApi(api)
    expect((await instructions.complete('i1')).data.status).toBe('DONE')
  })
})
