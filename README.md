# dw-time-mobile

GoalSlot mobile — React Native (Expo, dev-client) app plus the platform-neutral
`packages/shared` package it and the web app both depend on.

See [DECISIONS.md](./DECISIONS.md) for why this repo is shaped the way it is,
and for the standing gap: **this repo has been built and verified on a
machine with no Android SDK and no Xcode.** Typecheck/lint/test/bundle all
pass here; nobody has booted this on an emulator, simulator, or device yet.
Do that before trusting anything beyond "the code compiles."

## Layout

- `apps/mobile` — the Expo app (dev-client, not Expo Go — native modules are
  in scope for later voice/alarm work, which Expo Go can't host).
- `packages/shared` — types, validation, timezone-safe scheduling math, API
  client, offline queue, query-key factories, and the capability interface
  boundary (voice/alarms/notifications) that both web and mobile consume.

## Commands (from repo root)

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
