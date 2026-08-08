# Phase 2 decisions — made autonomously (gates waived by user)

No human was available to answer these, so I picked the lowest-risk option that satisfies the stated constraints (voice/native-modules later, real alarms later, capability-boundary now) and documented the reasoning. Flag anything here that's wrong and I'll adjust.

## 1. Repo shape

**Decision: new standalone repo `dw-time-mobile`**, not a merge of `dw-time-web`/`dw-time-api` into one monorepo.

Why: both existing repos are live, deployed (web → Vercel, api → self-hosted VPS with GitHub Actions auto-deploy on push to `main`), and both currently have **uncommitted local work in progress**:
- `dw-time-web`: modified `sharing-schedule-visibility.tsx`, untracked `.claude/`
- `dw-time-api`: 9 commits behind origin, uncommitted schema/DTO changes for an in-progress sharing-scopes feature

Restructuring either repo's directory layout or git history to fold it into a monorepo is exactly the kind of hard-to-reverse, shared-system-affecting action I won't do without explicit sign-off — and it would risk clobbering that WIP. So: `dw-time-mobile` is its own repo containing `apps/mobile` + `packages/shared`. `dw-time-web` will consume `packages/shared` as a workspace dependency, verified via an **isolated git worktree** (never the live working tree), proposed as a branch/PR for review rather than pushed. Longer-term distribution of `packages/shared` to `dw-time-web` (private npm package vs git dependency vs actually merging repos someday) is a call for you to make later — not blocking foundation work now.

## 2. Expo dev-build vs bare RN

**Decision: Expo with dev builds + config plugins** (`expo-dev-client`), not Expo Go, not bare RN.

Given constraints:
- Voice (whisper.cpp-class on-device model) → needs a native module. Expo dev-client supports arbitrary native modules and config plugins exactly like bare RN once you're off Expo Go — the managed/bare distinction that would block this doesn't apply here. You write a native module (Swift/Kotlin) or wrap an existing one (e.g. `whisper.rn`), add a config plugin if it needs native project file changes, and it links into a dev build normally.
- Real alarms (`SCHEDULE_EXACT_ALARM`, full-screen intents on Android; local-notification rebooking on iOS) → same story: needs native AndroidManifest entries and possibly a native alarm-ringing module (Android's exact-alarm + full-screen-intent pattern isn't fully reachable through `expo-notifications` alone — will likely need a small native module or a community plugin, wrapped in a config plugin either way).
- What Expo buys us that bare RN doesn't: `expo-updates` (OTA channel — explicitly wanted in Phase 4), `eas build`/`eas submit` for CI-free native builds (relevant since **this machine has no Android SDK, no Xcode, can't build natively at all** — EAS cloud builds are the only path to a real binary from here without you installing toolchains), and a maintained upgrade path (`expo-router`, autolinking, prebuild) instead of hand-rolled native project files.
- Cost: `expo prebuild` generates native `ios`/`android` folders when a config plugin needs them — those are semi-generated, not fully hand-owned, which is a minor ongoing tax but not a blocker.

Bare RN gives no meaningful advantage here since native modules are equally reachable both ways once Expo Go is off the table — Expo just gives more infrastructure for free (OTA, cloud builds, autolinking). Going bare would mean re-solving those with no upside.

## 3. UI sharing

**Decision: per-platform UI, shared logic** (default from the brief). Two-line tradeoff: cross-platform UI (e.g. Tamagui/NativeBase-style shared components rendering to both DOM and native) saves component-writing time but fights every platform-native interaction pattern you actually want (swipe-to-complete, native bottom sheets, platform-correct pickers) and adds a compiler/tooling dependency; per-platform UI costs more upfront component code but the actual differentiator for a consumer scheduling app — feel — comes from native-feeling interactions, not shared JSX.

## 4. State and data-fetching (offline-first as a requirement)

**Decision: mirror the web app's stack, since it's already offline-first and already proven in production:**
- **TanStack Query** (same as web) for server state — the web's query-key factories, `staleTime`/`gcTime` config, and per-feature query/mutation hooks were already cataloged as ~85% directly reusable; reuse verbatim.
- **`@tanstack/query-async-storage-persister`** backed by **`@react-native-async-storage/async-storage`** (swap-in replacement for web's `idb-keyval`-backed persister — same interface, same `PersistQueryClientProvider` wiring) for local cache persistence.
- **Offline outbox**: port the web's `outbox.ts`/`sync.ts`/`registry.ts` pattern (idempotency-keyed queued mutations, drain-on-reconnect, retry cap) verbatim — only the storage backend changes (AsyncStorage instead of idb-keyval). This is a strong, already-battle-tested pattern; no reason to pick something new.
- **Connectivity**: `@react-native-community/netinfo` wired into TanStack's `onlineManager` (direct RN equivalent of the web's `navigator.onLine` wiring).
- **Secrets** (access/refresh tokens): `expo-secure-store` (Keychain/Keystore-backed) — explicitly NOT AsyncStorage, since the API surface audit found 7-day access / 30-day refresh tokens with no server-side revocation, making secure storage non-negotiable.
- **Local app state** (theme, timer, offline-queue UI): zustand + `AsyncStorage`-backed persist, matching the web's existing zustand stores.
- **Optimistic writes**: port `useOfflineMutation` as-is (it's already DOM-free; only the toast/notifier call is swapped for an injected notifier per the capability-boundary pattern).

## 5. V1 screen list

Adopting the discovery agent's proposal as-is:

**Ships in v1:** Today/Agenda (new composite — no such endpoint/screen exists on web today, will be assembled client-side from schedule+tasks+timer, same as web currently does across 3 hooks), Schedule (day-agenda redesign of the web's weekly drag-grid), Goals, Tasks, Time Tracker, cross-cutting quick-add sheet, trimmed Settings (profile/logout/notifications/theme only).

**Explicitly cut from v1** (deferred, not rebuilt now): Coach/AI chat screen (target of the *next* task after mobile ships, per your later message — foundation work now is just the capability seam, not the UI), Journal, ~~Notes~~ (shipped 2026-08 — see "Notes feature" below), Reports (view), Whiteboards (web-only permanently — Excalidraw has no viable native port), Sharing management, Library/templates, all admin screens.

## 6. What can't be reused / must be rebuilt (real cost)

- **All UI components** — ~82% of the web codebase by line count (44,876 of 54,475 lines) is React DOM UI. None of it ports; every mobile screen is a from-scratch RN build against shared logic. This is the bulk of the actual mobile build effort, not the shared extraction.
- **Schedule grid** — the web's `@dnd-kit` 7-day drag-and-drop grid has no direct RN equivalent; mobile gets a day-agenda list instead (a UX simplification, not a port — genuinely different interaction model, not just a different renderer).
- **Rich text editors** (TipTap for goals/tasks/notes/journal) — no RN port; mobile v1 uses plain multiline text input for goal/task descriptions, and Notes/Journal are deferred anyway.
- **Whiteboards** — `@excalidraw/excalidraw` is a web canvas library with no practical native port; stays web-only permanently, not just for v1.
- **Web notification API usage** (`useTimerNotifications`) — full rewrite against `expo-notifications` (and eventually a native alarm module for the real-alarms feature).
- **Auth token storage + the entire auth interceptor chain** — every `localStorage` touchpoint in `src/lib/api.ts`/`src/lib/store.ts` gets rewritten against `expo-secure-store`; the request/response interceptor logic itself is portable, just not its storage calls.
- **SSE streaming client** — the web's hand-rolled `fetch`+`ReadableStream` parser needs verification against Hermes' fetch implementation (may need a streaming-fetch polyfill); flagged as a risk to test explicitly once the Coach UI is in scope, not now.
- **Cross-tab `BroadcastChannel` cache invalidation** — no RN equivalent, and no equivalent problem exists on mobile (single "tab"), so this is simply dropped, not rebuilt.

## Housekeeping decisions folded in here (no separate ask needed)

- **Verification reality check**: this machine has no Android SDK (no `adb`, no `$ANDROID_HOME`) and is Windows (no Xcode ever). I cannot boot an Android emulator or iOS simulator here. Phase gates below will verify via typecheck, unit tests, and Metro bundle success — NOT actual on-device boot. That gap is real and stays open until you run it on a machine with the toolchain (or I drive an EAS cloud build, which needs your go-ahead since it touches an external account/billing).
- **No pushes/PRs without asking.** I'll build and commit locally, and prepare the `dw-time-web` integration as a reviewable branch — but won't push or open PRs against either production repo without you confirming first, per standing policy on shared/external-facing actions.

## Notes feature (added 2026-08-08)

Notes is no longer cut from mobile. The `feature/notes` branch adds a sixth "Notes" tab: an MS OneNote-style pages+subpages tree (the user's explicitly preferred model over Notion), backed entirely by the shared notes domain landed earlier on this branch (`packages/shared/src/notes` — types, api group, query factory, and the dnd-kit-derived tree/projection math ported from the web).

- **Tree list (`apps/mobile/app/(app)/notes.tsx`)**: fixed-height (48dp) rows in a Reanimated `Animated.ScrollView`, NOT FlashList — cell recycling reuses row views while a drag transform is mid-flight, and a notes list is tens-to-hundreds of rows, so plain fixed-row math is both safer and simpler. Collapse state persists per-device via a small zustand+AsyncStorage store (`src/lib/notes-ui-store.ts`), deliberately not the server's shared `isExpanded` flag.
- **Hand-rolled long-press drag** (the depth-projection model: vertical position picks the slot, horizontal offset picks the depth, dragged subtree tucks away). Research on the library options before hand-rolling: `react-native-draggable-flatlist` is effectively unmaintained and broken on the New Architecture; `react-native-sortables` has no tree/indent support; `react-native-reorderable-list` cannot express the horizontal depth axis. None model dnd-kit's projection, so the gesture layer is ours: a per-row `Gesture.Pan().activateAfterLongPress(300)`, a worklet-side minimal mirror of the projection clamp rules — including the smart-outdent hop, so dragging a middle child left becomes a sibling of its parent instead of dead-clamping — driving the drop indicator (2dp line + dot at the projected indent; no other rows move — same calm model as the web), haptic ticks only on slot/depth changes, frame-callback autoscroll near the edges, and the SHARED `getProjection`/`buildReorderPayload` called exactly once per drop on the JS thread (never from worklets per-frame). Drag depth quantum is 24dp, matching both the visual indent and the shared `INDENTATION_WIDTH` (widened from 16 to 24 on both platforms after live web testing — a ±12px band beats pointer and thumb jitter alike); the shared functions still take the width as a parameter so either platform can retune independently.
- **Accessibility**: every row exposes moveUp/moveDown/indent ("Make subpage of previous page")/outdent ("Promote page")/expand-collapse accessibility actions that produce the same reorder payloads as the drag, labels announce "level N, page X of Y", every move announces via `announceForAccessibility`, and reduce-motion swaps the indicator/chevron/lift springs for instant placement.
- **Editor (`apps/mobile/app/(app)/note/[id].tsx`)**: `@10play/tentap-editor` 1.0.1 + `react-native-webview` 13.16.1 (TipTap HTML in a webview — same document format the web app writes, so content round-trips). Title saves debounce at 500ms, content at 1000ms via `useEditorContent`; blur/back flushes pending edits while the webview is still alive. The known New-Architecture init race (10play/10tap-editor#343 — `injectedJavaScriptBeforeContentLoaded` can silently not run on Fabric, leaving the editor's mount poller waiting forever) is guarded: on webview load we re-inject the library's bootstrap iff `window.contentInjected` is unset. If the editor still never reports ready within 8s, the screen degrades to a read-only plain-text rendering with a notice instead of a blank page.
- **Routing**: the editor is a hidden tab (`href: null` + `tabBarStyle: display none`) inside the `(app)` group rather than a real stack push — keeps the group's auth guard without restructuring the navigator; revisit if the app grows a root stack.
- **On-device QA is still pending** (same machine constraint as above — no emulator/simulator here). Verified via typecheck, lint, unit tests, and a full `expo export --platform android` bundle. The drag feel, swipe/drag gesture arbitration, tentap keyboard behavior, and the #343 guard specifically need a real device pass before release.
