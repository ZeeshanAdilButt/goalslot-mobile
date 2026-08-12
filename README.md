# dw-time-mobile

GoalSlot mobile — React Native (Expo, dev-client) app plus the platform-neutral
`packages/shared` package it and the web app both depend on.

## Layout

- `apps/mobile` — the Expo app (dev-client, not Expo Go — native modules are
  in scope for later voice/alarm work, which Expo Go can't host).
- `packages/shared` — types, validation, timezone-safe scheduling math, API
  client, offline queue, query-key factories, and the capability interface
  boundary (voice/alarms/notifications) that both web and mobile consume.

## Getting started

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

To run the app itself:

```bash
cd apps/mobile
pnpm expo run:android   # or: pnpm expo run:ios
```

See [DECISIONS.md](./DECISIONS.md) for the reasoning behind the stack and
architecture choices.
