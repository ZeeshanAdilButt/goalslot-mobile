import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { afterEach, describe, expect, it } from 'vitest'

import { createTemplatesApi } from '../api/templates'
import { createTemplateQueries } from './templates'

const api = axios.create({ baseURL: 'https://api.test/api' })
const mock = new MockAdapter(api)
const queries = createTemplateQueries(createTemplatesApi(api))

afterEach(() => {
  mock.reset()
})

describe('template query keys', () => {
  it('builds the list key under the templates root', () => {
    expect(queries.templateQueries.list()).toEqual(['templates', 'list'])
  })

  it('puts the id in the detail key, distinct per template', () => {
    expect(queries.templateQueries.detail('t1')).toEqual(['templates', 'detail', 't1'])
    expect(queries.templateQueries.detail('t1')).not.toEqual(queries.templateQueries.detail('t2'))
  })
})

describe('list', () => {
  it('keys and fetches the browse list', async () => {
    mock.onGet('/templates').reply(200, [{ id: 't1', name: 'Deep Work Week' }])

    const options = queries.list()
    expect(options.queryKey).toEqual(['templates', 'list'])

    const result = await options.queryFn?.({} as never)
    expect(result).toEqual([{ id: 't1', name: 'Deep Work Week' }])
  })
})

describe('detail', () => {
  it('keys and fetches one template by id', async () => {
    mock.onGet('/templates/t1').reply(200, { id: 't1', name: 'Deep Work Week', schedule: [] })

    const options = queries.detail('t1')
    expect(options.queryKey).toEqual(['templates', 'detail', 't1'])

    const result = await options.queryFn?.({} as never)
    expect(result).toMatchObject({ id: 't1', name: 'Deep Work Week' })
  })
})
