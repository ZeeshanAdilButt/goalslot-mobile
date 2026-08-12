# Architecture decisions

Rationale behind this repo's structure and technology choices, so they
don't need re-litigating later.

## 1. Repo shape

**Standalone repo (`dw-time-mobile`)**, not a monorepo merge with the
existing web and API repos.

Both of those are live and independently deployed (web on Vercel, API
self-hosted with its own CI/CD), each with its own release cadence and
ongoing work. Folding either into a monorepo would be a disruptive,
hard-to-reverse restructuring with no benefit that justifies the risk.
Instead: `dw-time-mobile` is its own repo containing `apps/mobile` and
`packages/shared`; the web app consumes `packages/shared` as a workspace
dependency, integrated through a reviewable branch rather than a direct
history rewrite. Longer-term distribution of `packages/shared` (private
npm package vs. git dependency vs. an eventual actual merge) is an open
question, not one blocking the current work.

## 2. Expo dev-build vs. bare React Native

**Expo with dev builds and config plugins** (`expo-dev-client`), not Expo
Go, not bare RN.

- Voice (on-device transcription) needs a native module. Expo dev-client
  supports arbitrary native modules and config plugins exactly like bare
  RN once Expo Go is off the table, so the managed/bare distinction that
  would normally block this doesn't apply.
- Real alarms (`SCHEDULE_EXACT_ALARM` and full-screen intents on Android,
  local-notification rebooking on iOS) need native AndroidManifest
  entries and likely a native alarm-ringing module — `expo-notifications`
  alone doesn't reach the exact-alarm + full-screen-intent pattern.

  Partly settled since. The *exact-alarm* half turned out not to need a
  module at all, only manifest permissions: `expo-notifications` already
  schedules through `AlarmManager` and already calls
  `setExactAndAllowWhileIdle` — it just gates that on
  `canScheduleExactAlarms()`, which is false on Android 12+ until the app
  declares `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM`. Those are now in
  `app.json`, and the library also handles the two things this bullet
  worried about most: weekly triggers re-arm themselves after firing
  (`ExpoSchedulingDelegate.triggerNotification` reschedules), and a
  `BOOT_COMPLETED` receiver restores the queue after a reboot.

  What still needs a native module is the *full-screen intent* — the
  alarm-clock experience that takes over a locked screen and rings until
  dismissed. Everything short of that is reachable today: a MAX-importance
  channel with sound and vibration on Android, and
  `interruptionLevel: 'timeSensitive'` on iOS, which is as far as a
  notification can go without Apple's Critical Alerts entitlement. That is
  a heads-up alert with sound, not a ringing alarm you must dismiss, and
  the gap is deliberate rather than pending — see
  `src/lib/notifications.ts`.
- What Expo buys over bare RN: `expo-updates` for OTA updates, `eas
  build`/`eas submit` for toolchain-free native builds (no local Android
  SDK or Xcode required per machine), and a maintained upgrade path
  (`expo-router`, autolinking, prebuild) instead of hand-rolled native
  project files.
- Cost: `expo prebuild` generates native `ios`/`android` folders when a
  config plugin needs them — semi-generated rather than fully hand-owned,
  a minor ongoing tax but not a blocker.

Bare RN offers no real advantage here, since native modules are equally
reachable either way once Expo Go is off the table — Expo just provides
more of that infrastructure for free.

## 3. UI sharing

**Per-platform UI, shared logic.** Cross-platform UI libraries (rendering
the same components to both DOM and native) save component-writing time
but fight every platform-native interaction pattern that actually matters
here — swipe-to-complete, native bottom sheets, platform-correct pickers —
and add a compiler/tooling dependency. Per-platform UI costs more upfront
component code, but the differentiator for a scheduling app is feel, which
comes from native-feeling interactions, not shared JSX.

## 4. State and data-fetching (offline-first)

**Mirrors the web app's stack**, since it's already offline-first and
already proven in production:

- **TanStack Query** for server state — the web app's query-key
  factories, `staleTime`/`gcTime` config, and per-feature query/mutation
  hooks are largely reusable as-is.
- **`@tanstack/query-async-storage-persister`** backed by
  **`@react-native-async-storage/async-storage`** — a swap-in replacement
  for the web app's `idb-keyval`-backed persister, same interface, same
  `PersistQueryClientProvider` wiring.
- **Offline outbox**: the web app's `outbox.ts`/`sync.ts`/`registry.ts`
  pattern (idempotency-keyed queued mutations, drain-on-reconnect, retry
  cap) ports as-is; only the storage backend changes.
- **Connectivity**: `@react-native-community/netinfo` wired into
  TanStack's `onlineManager`, the direct RN equivalent of the web app's
  `navigator.onLine` wiring.
- **Secrets** (access/refresh tokens): `expo-secure-store`
  (Keychain/Keystore-backed), explicitly not AsyncStorage — long-lived
  tokens with no server-side revocation make secure storage
  non-negotiable.
- **Local app state** (timer, reminder interval, offline-queue UI): zustand
  with `AsyncStorage`-backed persistence, matching the web app's existing
  stores. Theme was originally an example here; it never became one — see
  the note under §5.
- **Optimistic writes**: `useOfflineMutation` ports as-is; only the
  toast/notifier call is swapped for an injected notifier.

## 5. V1 scope

**Ships in v1:** Today/Agenda (a new composite view assembled client-side
from schedule, tasks, and timer data), Schedule (a day-agenda redesign of
the web app's weekly drag-grid), Goals, Tasks, Time Tracker, a
cross-cutting quick-add sheet, and a trimmed Settings screen
(profile/logout/notifications/theme only).

> **Amended.** Theme never shipped: no ThemeProvider was ever built, so the
> picker saved a preference nothing read and the screen said so in its own
> helper text. It and its store field have been removed — web reached the
> same conclusion and hides its Appearance tab. Settings has since grown to
> track web's remaining tabs: profile editing, an OTP password change,
> delete account, the Coach's BYOK key and habits profile, and a read-only
> plan badge. Billing stays read-only deliberately; see the comment at the
> top of `app/(app)/settings.tsx`.

**Cut from v1** (deferred, not dropped): an AI coaching chat screen,
Journal, Notes (shipped later — see below), a Reports view, Whiteboards
(web-only permanently, no viable native canvas port), sharing management,
library/templates, and admin screens.

## 6. What doesn't port, and has to be rebuilt

- **All UI components** — the large majority of the web codebase by line
  count is React DOM UI, none of which ports. Every mobile screen is a
  from-scratch RN build against the shared logic layer; this is the bulk
  of the actual mobile build effort, not the shared-code extraction.
- **Schedule grid** — the web app's drag-and-drop weekly grid has no
  direct RN equivalent; mobile uses a day-agenda list instead, a genuinely
  different interaction model rather than a port.
- **Rich text editors** — no RN port for the web's editor library; v1
  uses plain multiline text input where a rich editor isn't essential.
- **Whiteboards** — the web canvas library has no practical native port;
  stays web-only permanently.
- **Web notification handling** — rewritten against `expo-notifications`,
  which now covers exact, audible, weekly-recurring schedule alarms (see
  §2); only a full-screen ringing alarm would still need a native module.
- **Auth token storage and the auth interceptor chain** — every storage
  touchpoint gets rewritten against `expo-secure-store`; the
  request/response interceptor logic itself is portable, just not its
  storage calls.
- **Streaming responses** — the web app's hand-rolled fetch/ReadableStream
  parser needs verification against Hermes' fetch implementation before
  the coaching chat screen is in scope; may need a polyfill.
- **Cross-tab cache invalidation** — no RN equivalent and no equivalent
  problem on mobile (a single "tab"), so this is dropped rather than
  rebuilt.

## Notes feature

An MS OneNote-style pages-and-subpages tree (rather than a Notion-style
nested-block model), backed by the shared notes domain
(`packages/shared/src/notes` — types, API client, query factory, and the
tree/projection math shared with the web app).

- **Tree list** (`apps/mobile/app/(app)/notes.tsx`): fixed-height (48dp)
  rows in a Reanimated `Animated.ScrollView`, not FlashList — cell
  recycling would fight a drag transform mid-flight, and a notes list is
  tens-to-hundreds of rows, so plain fixed-row math is simpler and safer.
  Collapse state persists per-device via a small zustand + AsyncStorage
  store, deliberately not the server's shared `isExpanded` flag.
- **Long-press drag reordering** uses a depth-projection model: vertical
  position picks the slot, horizontal offset picks the depth, and the
  dragged subtree tucks away during the drag. Existing drag libraries were
  evaluated and ruled out — none model tree/indent projection the way
  this needs — so the gesture layer is hand-rolled: a per-row
  `Gesture.Pan().activateAfterLongPress(300)`, a worklet-side mirror of
  the projection clamp rules (including a smart-outdent hop, so dragging
  a middle child left makes it a sibling of its parent instead of
  dead-clamping), a drop indicator that doesn't move other rows, haptic
  ticks on slot/depth changes, frame-callback autoscroll near the edges,
  and the shared projection/reorder-payload functions called once per
  drop on the JS thread, never per-frame from a worklet. Drag depth
  quantum is 24dp, matching the shared indentation width used by both
  platforms.
- **Accessibility**: every row exposes move-up/move-down/indent/outdent/
  expand-collapse actions that produce the same reorder payloads as the
  drag gesture, every move announces via the platform's accessibility
  announcement API, and reduced-motion swaps spring animations for
  instant placement.
- **Editor** (`apps/mobile/app/(app)/note/[id].tsx`): a WebView-hosted
  rich text editor using the same HTML document format the web app
  writes, so content round-trips. Title and content save on independent
  debounce timers; navigating away flushes pending edits first. A known
  editor-library initialization race on the New Architecture is guarded
  against by re-injecting the library's bootstrap script if it doesn't
  report ready; if it still never initializes, the screen degrades to a
  read-only rendering instead of staying blank.
- **Routing**: the editor is a hidden tab rather than a stack push, which
  keeps the tab group's auth guard without restructuring the navigator —
  worth revisiting if the app grows a root stack.

## Messaging feature

Person-to-person messaging between users who already have a sharing
relationship. Two backends, deliberately: GoalSlot's own API mints a
short-lived token and creates conversations (that endpoint is where the
"may these two people talk" rule lives, enforced server-side), and the
standalone `jiffy-messaging` service owns conversations, messages, read
state, and live delivery. The service holds no opinion about who may
message whom, so the authorization check cannot move into it.

- **Split across the packages**: everything platform-neutral is in
  `packages/shared/src/messaging` (cache reconcilers, unread derivation,
  contact assembly, the token store, the WebSocket manager) plus
  `api/messaging.ts`, `api/sharing.ts` and `queries/messaging.ts` — the
  web app can reuse all of it. Only React Native UI lives in
  `apps/mobile`.
- **Names come from the sharing graph.** jiffy-messaging identifies
  participants by bare GoalSlot user id and has never heard of a user
  record, so display names are joined client-side from
  `/sharing/my-shares` + `/sharing/shared-with-me`. That list decides who
  is *offered* in the new-conversation picker; the server decides who is
  *allowed*, and a 403 is rendered as its own specific message rather
  than a generic failure. A conversation whose counterpart has since left
  the sharing graph still renders — the history is real even when the
  relationship ended.
- **One socket per process**, owned at module scope
  (`src/lib/messaging-live.ts`) and driven by the (app) layout, so the
  conversation list stays live from anywhere in the app. It is closed on
  background and reopened on resume rather than held across the cycle: a
  suspended socket is usually already dead and reports it minutes late,
  during which the app silently receives nothing. Reconnect is
  exponential with full jitter, and is *not* scheduled while offline —
  the NetInfo edge in `src/lib/offline.ts` wakes it instead of a timer
  burning radio on a handshake that cannot complete.
- **`onlineManager` is deliberately still not wired.** This app's offline
  story is the outbox: a mutation is expected to FAIL offline so the
  `hasResponse` check can decide whether to queue it. Giving TanStack a
  real connectivity signal would make it *pause* mutations instead, which
  silently bypasses the outbox for every domain.
- **Optimistic send** follows the `useQuickAdd` shape, with two chat-
  specific changes: a failed message is never deleted (it stays marked
  failed with retry/discard, because deleting it loses what the user
  wrote), and the server's row replaces the optimistic one by `clientId`
  rather than landing beside it. A queued send's outbox `idempotencyKey`
  *is* that client id, which is what lets the drain replace the right
  bubble instead of duplicating it.
- **Refetches merge rather than replace** (`mergeServerMessages`, wired
  as the query's `structuralSharing`). A refetch returns only the newest
  page, so the default replace would drop both paged-in history and any
  message queued offline — the latter reappearing minutes later when the
  outbox drained.
- **A normal list, not an `inverted` one.** `inverted` is a scaleY(-1)
  transform on every cell, which reverses screen-reader traversal so the
  thread reads newest-to-oldest. `useThreadScroll` does the pinning
  explicitly instead, and only when the user is already at the bottom —
  yanking someone out of history because a message arrived is the worst
  thing a chat screen can do. Keyboard *hide* is handled as carefully as
  show: without it the view strands above the last bubble.
- **Config-gated**: service URLs come from `app.config.js`
  (`EXPO_PUBLIC_MESSAGING_URL` / `EXPO_PUBLIC_MESSAGING_WS_URL`) and are
  routinely unset. Unset is a normal state, not an error — the drawer
  entry disappears, queries never fire, the socket stays idle, and the
  service client rejects with a `not-configured` error kind instead of
  requesting an undefined URL. A missing ws URL alone degrades to
  refetch-on-focus rather than disabling the feature.
- **Routing** follows the Notes pattern above: `messages.tsx` plus
  `message/[id].tsx`, both hidden tabs, the thread hiding the tab bar.
  The consequence worth remembering is that the thread screen stays
  mounted between conversations, so read-marking, refetching and paging
  state all key off focus and `conversationId` rather than mount.
