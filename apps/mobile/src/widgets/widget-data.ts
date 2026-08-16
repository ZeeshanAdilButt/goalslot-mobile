// Data layer for the home-screen widget's background task.
//
// WHY this fetches via `apiClient` directly instead of going through
// `scheduleQueries`/React Query (the way every screen in this app does):
// `react-native-android-widget`'s task handler runs as a headless JS task —
// a fresh JS instance the OS spins up on a timer (`updatePeriodMillis` in
// app.json) or on ADD/UPDATE/RESIZE, with no mounted React tree and
// therefore no live `QueryClient` to read (`src/lib/query-client.ts`'s
// in-memory cache only exists inside the foregrounded app's own JS
// instance — a headless task is a different instance entirely). The two
// instances DO share persisted native storage (SecureStore for the auth
// token, AsyncStorage for this module's own cache), which is why both are
// used below instead.
//
// WHY a network call at all, and not "just read the persisted RQ cache":
// `@tanstack/query-async-storage-persister` (query-client.ts) persists the
// whole cache as one versioned blob, which is an implementation detail of
// the app's own cache warm-start, not a stable contract this module should
// depend on. A direct, narrow `apiClient.schedule.getByDay()` call is one
// stable request instead. Resilience against a slow/broken network comes
// from the timeout + last-known-good AsyncStorage cache below, per the
// widget brief's "never render blank/broken" requirement.

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  formatDuration,
  formatTime12h,
  timeToMinutes,
  toActiveTimerSession,
  type ActiveTimerSession,
  type ScheduleBlock,
} from "@goalslot/shared";

import { blockStatus } from "@/components/schedule";
import { apiClient } from "@/lib/api-client";
import { secureTokenStorage } from "@/lib/secure-token-storage";
import { resolveEffectiveTimer } from "@/lib/timer-attribution";
import { getElapsedMs } from "@/lib/timer-store";

/** Bumped (`-v2`, ...) if the cached shape ever changes, so a stale blob from an old app version can't be parsed as the new shape. */
const CACHE_KEY = "goalslot-widget-today-cache-v1";

/**
 * A widget redraw has to finish well inside Android's headless-task budget
 * (~30s, entire JS instance startup included), and nobody is staring at a
 * loading spinner for a home-screen widget — so a stuck request gets cut
 * off far sooner than the app's own screens would, in favor of falling back
 * to cached data.
 */
const FETCH_TIMEOUT_MS = 8000;

interface CachedDay {
  dayOfWeek: number;
  blocks: ScheduleBlock[];
}

export interface WidgetBlockSummary {
  title: string;
  timeRange: string;
  /** Category (or linked goal's) accent color, hex — see TodayWidget.tsx for how it's used. */
  color: string;
  /** Present only when the block is linked to a goal — lets a widget offer a "start tracking" shortcut straight into that goal (see ios-widget-sync.ts and TodayWidget.tsx's Android counterpart doesn't have this yet, only the iOS widget's Start button uses it). */
  goalId?: string;
}

/** Today's overall done/total, computed alongside `block` at no extra fetch cost — a size-aware widget (large Android resize, iOS `.systemLarge`) shows this as bonus content instead of leaving the extra space blank; a compact widget just ignores it. */
export interface WidgetDayProgress {
  done: number;
  total: number;
}

export type WidgetViewState =
  | { kind: "block"; status: "active" | "upcoming"; block: WidgetBlockSummary; dayProgress: WidgetDayProgress }
  | { kind: "progress"; done: number; total: number }
  | { kind: "empty-day" }
  | { kind: "unavailable" };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("widget fetch timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readCache(dayOfWeek: number): Promise<ScheduleBlock[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedDay;
    // A cache from yesterday (or any other day) is worse than no cache at
    // all — it would render as if it were today's real schedule.
    return cached.dayOfWeek === dayOfWeek ? cached.blocks : null;
  } catch {
    return null;
  }
}

async function writeCache(dayOfWeek: number, blocks: ScheduleBlock[]): Promise<void> {
  try {
    const entry: CachedDay = { dayOfWeek, blocks };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Best-effort. A failed cache write only means the NEXT resiliency
    // fallback has nothing to fall back to — it must never fail the
    // render that's happening right now.
  }
}

/** Network-first, falling back to the last-known-good cache for today on any failure (timeout, offline, 401 with no valid refresh, ...). */
async function fetchTodayBlocks(dayOfWeek: number): Promise<ScheduleBlock[] | null> {
  try {
    const response = await withTimeout(apiClient.schedule.getByDay(dayOfWeek), FETCH_TIMEOUT_MS);
    await writeCache(dayOfWeek, response.data);
    return response.data;
  } catch {
    return readCache(dayOfWeek);
  }
}

/**
 * Resolves today's blocks (network-first, cache-fallback per above) and
 * picks which of the widget's four states applies right now:
 *   - a block happening now, or the next one coming up today
 *   - today's "done so far" progress, once nothing is left upcoming
 *   - an explicit empty-day state, when today has no blocks at all
 *   - "unavailable", when there's no session or no data of any kind to show
 *     (network failed AND no cache) — the neutral "open the app" state the
 *     brief calls for instead of a blank/broken widget.
 *
 * Reuses `blockStatus` from `src/components/schedule/layout.ts` (the same
 * past/active/upcoming classification the Schedule screen's timeline uses)
 * rather than re-deriving "is this next" from scratch here.
 */
export async function loadWidgetViewState(now: Date = new Date()): Promise<WidgetViewState> {
  const accessToken = await secureTokenStorage.getAccessToken();
  if (!accessToken) {
    return { kind: "unavailable" };
  }

  const dayOfWeek = now.getDay();
  const blocks = await fetchTodayBlocks(dayOfWeek);
  if (blocks === null) {
    return { kind: "unavailable" };
  }
  if (blocks.length === 0) {
    return { kind: "empty-day" };
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const entries = blocks
    .map((block) => ({
      block,
      startMin: timeToMinutes(block.startTime),
      endMin: timeToMinutes(block.endTime),
    }))
    .sort((a, b) => a.startMin - b.startMin);

  const active = entries.find((entry) => blockStatus(entry, nowMinutes) === "active");
  const next = entries.find((entry) => blockStatus(entry, nowMinutes) === "upcoming");
  const current = active ?? next;

  const done = entries.filter((entry) => blockStatus(entry, nowMinutes) === "past").length;

  if (current) {
    // A linked goal's color wins over the block's own category color,
    // matching TimelineBlock.tsx's `block.goal?.color ?? block.color`
    // accent resolution — the same block reads with the same color on the
    // widget as it does inside the app.
    const accent = current.block.goal?.color ?? current.block.color;
    return {
      kind: "block",
      status: active ? "active" : "upcoming",
      block: {
        title: current.block.title,
        timeRange: `${formatTime12h(current.block.startTime)} – ${formatTime12h(current.block.endTime)}`,
        color: accent,
        goalId: current.block.goal?.id ?? current.block.goalId,
      },
      dayProgress: { done, total: entries.length },
    };
  }

  return { kind: "progress", done, total: entries.length };
}

// ---------------------------------------------------------------------------
// Tracking status — "what's actually being tracked right now", independent
// of today's schedule above. A block can be showing as NOW without a timer
// actually running against it (the user hasn't pressed Start yet), so this
// is deliberately a separate read, not derived from `loadWidgetViewState`.
// ---------------------------------------------------------------------------

export interface WidgetTrackingState {
  status: "running" | "paused";
  /** The task's title when tracking a task — the primary line, per "show the task itself, not the goal". */
  primaryLabel: string;
  /** The parent goal's title, shown as a secondary line only when `primaryLabel` is a task's title and that task actually has a linked goal. Absent when tracking a bare goal (nothing to show underneath it). */
  secondaryLabel?: string;
  /** Formatted total elapsed time (`formatDuration`, e.g. "1h 21m") as of this read. */
  elapsedLabel: string;
  /**
   * 0–1 "timer bar" fill — elapsed time within the current 60-minute cycle,
   * NOT a completion percentage (a tracking session has no fixed target
   * duration to measure against). Precomputed here, once, so iOS and
   * Android render the identical value instead of each doing their own
   * rounding — see this file's header re: keeping the two platforms in
   * sync. Neither platform ticks this live: WidgetKit has `Text`/
   * `ProgressView(timerInterval:)` for that, but react-native-android-
   * widget has no RemoteViews `Chronometer` equivalent, so a live-only-on-
   * iOS bar would break the "consistent on both" requirement. Both instead
   * redraw this on the same cadence (app foreground on iOS, WIDGET_UPDATE/
   * the 30-minute timer on Android).
   */
  progress: number;
  goalId?: string;
  taskId?: string;
}

/** Must match timer-store.ts's `persist({ name: ... })` — this file reads that same AsyncStorage entry directly since the headless task has no live store instance to subscribe to (see this file's header comment). */
const TIMER_STORE_KEY = "goalslot-timer-store";
const LABEL_CACHE_KEY = "goalslot-widget-label-cache-v1";
// Runs concurrently with the schedule fetch above (see widget-task-handler.tsx's
// Promise.all), so this doesn't stack on top of FETCH_TIMEOUT_MS — it's shorter
// than that anyway since resolving a task/goal title is supplementary, not the
// widget's primary content, and shouldn't be the slower of the two waits.
const TRACKING_FETCH_TIMEOUT_MS = 3000;
/** Purely the "timer bar" visual cycle length — see `WidgetTrackingState.progress`. */
const PROGRESS_CYCLE_MS = 60 * 60 * 1000;

interface PersistedTimerRecord {
  status: "idle" | "running" | "paused";
  startedAt: number | null;
  pausedElapsedMs: number;
  taskId: string | null;
  goalId: string | null;
}

async function readLabelCache(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(LABEL_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function writeLabelCacheEntry(cacheKey: string, label: string): Promise<void> {
  try {
    const cache = await readLabelCache();
    cache[cacheKey] = label;
    await AsyncStorage.setItem(LABEL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Best-effort, same reasoning as writeCache above.
  }
}

/** Resolves one task/goal title, network-first with a per-id cache fallback (never the raw id, never a hard failure) — task and goal titles are cached under separate keys so tracking a task-with-a-goal can still show a stale goal title even if only the task fetch succeeds this time, or vice versa. */
async function resolveLabel(kind: "task" | "goal", id: string): Promise<string> {
  const cacheKey = `${kind}:${id}`;
  try {
    const response =
      kind === "task"
        ? await withTimeout(apiClient.tasks.getOne(id), TRACKING_FETCH_TIMEOUT_MS)
        : await withTimeout(apiClient.goals.getOne(id), TRACKING_FETCH_TIMEOUT_MS);
    await writeLabelCacheEntry(cacheKey, response.data.title);
    return response.data.title;
  } catch {
    const cache = await readLabelCache();
    return cache[cacheKey] ?? "Untitled";
  }
}

/**
 * The cross-device session (`/timer/session`), if any — the same call
 * `timerSessionQueries.fetchActive` wraps for every other screen, reimplemented
 * narrowly here rather than imported: that factory pulls in `queryOptions`,
 * which this headless task has no `QueryClient` to hand it (see this file's
 * header). Best-effort like `resolveLabel` above, but with no cache to fall
 * back to — a failed fetch just means "trust the local record alone," which
 * is exactly this function's behaviour returning `null` ever did before this
 * existed, never worse.
 */
async function fetchServerSession(): Promise<ActiveTimerSession | null> {
  try {
    const response = await withTimeout(apiClient.timerSession.getActive(), TRACKING_FETCH_TIMEOUT_MS);
    return toActiveTimerSession(response.data);
  } catch {
    return null;
  }
}

/**
 * Reads the currently-running (or paused) timer session, if any — `null`
 * while idle/no session/no auth.
 *
 * Merges the local persisted store with the cross-device server session via
 * `resolveEffectiveTimer`, the SAME merge the Timer screen and
 * GlobalTrackingBanner use (see timer-attribution.ts's header for why: "a
 * server session is authoritative whenever one exists"). Reading the local
 * record alone — what this used to do — has two failure modes once a session
 * is server-mirrored (which happens within moments of every Start, since
 * `publishSessionStart` in timer.tsx posts every local session to the server
 * for cross-device sync): first, a session started on ANOTHER device never
 * touches this phone's local store at all, so it stayed invisible here the
 * same way it used to on GlobalTrackingBanner before that fix. Second, and
 * the one actually reported ("the widget doesn't show the bar moving" during
 * live tracking): timer.tsx's handlePause/handleResume only call the SERVER
 * pause/resume endpoints once a mirror exists, never the local store's own
 * `pause()`/`resume()` — so the local record kept claiming "running" with
 * its original `startedAt` straight through a pause, and this function's old
 * `getElapsedMs` read against that never-paused timestamp. The bar wasn't
 * frozen; it was silently counting through the pause using the wrong clock,
 * which reads as "stuck" the moment the real elapsed time it should show
 * diverges from what a frozen local record implies.
 */
export async function loadWidgetTrackingState(): Promise<WidgetTrackingState | null> {
  const accessToken = await secureTokenStorage.getAccessToken();
  if (!accessToken) return null;

  try {
    const raw = await AsyncStorage.getItem(TIMER_STORE_KEY);
    // zustand's `persist` middleware wraps the partialized state as `{ state, version }`.
    const parsed = raw ? (JSON.parse(raw) as { state?: PersistedTimerRecord }) : undefined;
    const record = parsed?.state ?? null;

    const serverSession = await fetchServerSession();
    const localSnapshot = {
      status: record?.status ?? ("idle" as const),
      startedAt: record?.startedAt ?? null,
      pausedElapsedMs: record?.pausedElapsedMs ?? 0,
      taskId: record?.taskId ?? null,
      goalId: record?.goalId ?? null,
    };
    const effective = resolveEffectiveTimer(serverSession, localSnapshot);
    if (effective.status === "idle") return null;

    // Task wins over its parent goal as the primary label (per the product
    // ask: "show the task itself, not the goal"); the goal still shows
    // underneath when there is one. Tracking a bare goal (no task) has
    // nothing to put underneath it.
    const [primaryLabel, secondaryLabel] = await Promise.all([
      effective.taskId
        ? resolveLabel("task", effective.taskId)
        : effective.goalId
          ? resolveLabel("goal", effective.goalId)
          : Promise.resolve("Untitled"),
      effective.taskId && effective.goalId ? resolveLabel("goal", effective.goalId) : Promise.resolve(undefined),
    ]);

    const elapsedMs = getElapsedMs({
      status: effective.status,
      startedAt: effective.startedAt,
      pausedElapsedMs: effective.pausedElapsedMs,
    });
    const progress = (elapsedMs % PROGRESS_CYCLE_MS) / PROGRESS_CYCLE_MS;

    return {
      status: effective.status,
      primaryLabel,
      secondaryLabel,
      elapsedLabel: formatDuration(Math.floor(elapsedMs / 60000)),
      progress,
      goalId: effective.goalId ?? undefined,
      taskId: effective.taskId ?? undefined,
    };
  } catch {
    return null;
  }
}
