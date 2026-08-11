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

import { formatTime12h, timeToMinutes, type ScheduleBlock } from "@goalslot/shared";

import { blockStatus } from "@/components/schedule";
import { apiClient } from "@/lib/api-client";
import { secureTokenStorage } from "@/lib/secure-token-storage";

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
}

export type WidgetViewState =
  | { kind: "block"; status: "active" | "upcoming"; block: WidgetBlockSummary }
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
      },
    };
  }

  const done = entries.filter((entry) => blockStatus(entry, nowMinutes) === "past").length;
  return { kind: "progress", done, total: entries.length };
}
