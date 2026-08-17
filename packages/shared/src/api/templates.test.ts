import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it } from 'vitest'

import { createTemplatesApi } from './templates'

const api = axios.create({ baseURL: 'https://api.test/api' })
const mock = new MockAdapter(api)

afterEach(() => {
  mock.reset()
})

describe('createTemplatesApi', () => {
  it('lists template summaries', async () => {
    mock.onGet('/templates').reply(200, [{ id: 't1', name: 'Deep Work Week', featured: true }])

    const templates = createTemplatesApi(api)
    const response = await templates.list()

    expect(response.data).toEqual([{ id: 't1', name: 'Deep Work Week', featured: true }])
  })

  it('fetches one template in full', async () => {
    mock.onGet('/templates/t1').reply(200, { id: 't1', name: 'Deep Work Week', schedule: [] })

    const templates = createTemplatesApi(api)
    const response = await templates.getOne('t1')

    expect(response.data.id).toBe('t1')
  })

  it('imports a template with the given section options', async () => {
    mock.onPost('/templates/t1/import').reply(200, { templateId: 't1', goalsCreated: 2, scheduleBlocksCreated: 5, tasksCreated: 3 })

    const templates = createTemplatesApi(api)
    const response = await templates.import('t1', { schedule: true, goals: true, tasks: true })

    expect(response.data).toEqual({ templateId: 't1', goalsCreated: 2, scheduleBlocksCreated: 5, tasksCreated: 3 })
    expect(JSON.parse(mock.history.post[0]?.data ?? '{}')).toEqual({ schedule: true, goals: true, tasks: true })
  })

  it('sends replaceExisting through to the import body when set', async () => {
    mock.onPost('/templates/t1/import').reply(200, { templateId: 't1', goalsCreated: 0, scheduleBlocksCreated: 0, tasksCreated: 0 })

    const templates = createTemplatesApi(api)
    await templates.import('t1', { schedule: false, goals: false, tasks: true, replaceExisting: true })

    expect(JSON.parse(mock.history.post[0]?.data ?? '{}')).toEqual({
      schedule: false,
      goals: false,
      tasks: true,
      replaceExisting: true,
    })
  })

  it('syncs tasks for an already-imported template', async () => {
    mock.onPost('/templates/t1/sync').reply(200, { templateId: 't1', tasksAdded: 2, skipped: 1, matched: true })

    const templates = createTemplatesApi(api)
    const response = await templates.sync('t1')

    expect(response.data).toEqual({ templateId: 't1', tasksAdded: 2, skipped: 1, matched: true })
  })

  it('reports matched: false when the template was never imported', async () => {
    mock.onPost('/templates/t2/sync').reply(200, { templateId: 't2', tasksAdded: 0, skipped: 0, matched: false })

    const templates = createTemplatesApi(api)
    const response = await templates.sync('t2')

    expect(response.data.matched).toBe(false)
  })
})
