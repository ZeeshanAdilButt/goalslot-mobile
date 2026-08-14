import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { describe, expect, it } from 'vitest'

import { createPushSubscriptionsApi } from './push-subscriptions'

describe('createPushSubscriptionsApi', () => {
  it('posts the expo token under the exact key the API DTO accepts', async () => {
    // The API's RegisterPushSubscriptionDto keys the Expo shape on
    // `expoToken`, and the service branches on `Boolean(dto.expoToken)`. A
    // differently-named field would be stripped by the global
    // ValidationPipe's `whitelist: true` and the request would 400 with
    // "Provide either a web push subscription ... or an expoToken" — so the
    // literal wire shape is the contract worth pinning, not just the URL.
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const apiMock = new MockAdapter(api)
    apiMock.onPost('/push-subscriptions').reply(201, {
      id: 'sub_1',
      userId: 'u1',
      kind: 'EXPO',
      endpoint: null,
      expoToken: 'ExponentPushToken[abc]',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const pushSubscriptions = createPushSubscriptionsApi(api)
    const response = await pushSubscriptions.registerExpo('ExponentPushToken[abc]')

    expect(apiMock.history.post[0]?.data).toBe(
      JSON.stringify({ expoToken: 'ExponentPushToken[abc]' }),
    )
    expect(response.data.id).toBe('sub_1')
    expect(response.data.kind).toBe('EXPO')
  })

  it('sends no web-push fields, which the API would reject as a mixed shape', async () => {
    // `register()` 400s on a payload carrying both shapes. An accidental
    // `endpoint: undefined` surviving JSON.stringify would be harmless, but
    // a null or empty string would not — assert the body has exactly one key.
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const apiMock = new MockAdapter(api)
    apiMock.onPost('/push-subscriptions').reply(201, {})

    await createPushSubscriptionsApi(api).registerExpo('ExponentPushToken[abc]')

    expect(Object.keys(JSON.parse(apiMock.history.post[0]?.data as string))).toEqual(['expoToken'])
  })

  it('deletes a subscription by id on the same collection route', async () => {
    const api = axios.create({ baseURL: 'https://api.test/api' })
    const apiMock = new MockAdapter(api)
    apiMock.onDelete('/push-subscriptions/sub_1').reply(200, { id: 'sub_1' })

    const response = await createPushSubscriptionsApi(api).unregister('sub_1')

    expect(apiMock.history.delete[0]?.url).toBe('/push-subscriptions/sub_1')
    expect(response.data.id).toBe('sub_1')
  })
})
