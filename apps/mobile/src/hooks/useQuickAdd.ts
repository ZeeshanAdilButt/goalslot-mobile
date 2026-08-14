// Shared submit logic behind `src/components/QuickAddSheet.tsx`. The shared
// package (packages/shared/src) ships the outbox/registry/sync primitives
// and per-domain query factories, but no ready-made "optimistic create"
// React hook — the original web app's `useOfflineMutation` was a web-only
// hook that never got ported (see the discovery audit referenced in the
// project brief). This is that hook's mobile equivalent, scoped to exactly
// what quick-add needs: three sibling "create" flows (goal/task/schedule
// slot) that all follow the same shape —
//
//   1. validate the title-only input against the shared zod schema, filling
//      in the domain's other required fields with sane defaults;
//   2. optimistically patch the relevant React Query cache entry so any
//      screen already subscribed to it (Today/Schedule/Tasks) sees the new
//      item immediately;
//   3. call apiClient.<domain>.create();
//   4. on success, invalidate that domain's whole-collection query key
//      (packages/shared's `create*Queries().{goal,task,schedule}Queries.all`)
//      so the optimistic entry gets reconciled against the server response;
//   5. on failure that looks like "no server response" (offline/timeout —
//      see `hasResponse` below, mirroring the same check in
//      packages/shared/src/offline/sync.ts), enqueue the create into the
//      offline outbox so it replays once connectivity returns
//      (src/lib/offline.ts registers the matching "<domain>-create"
//      operations), tag the still-showing optimistic entry `pendingSync:
//      true` so GoalCard/TaskMetaChips/the schedule chip can render a
//      "queued" treatment, and resolve rather than throw — a queued create
//      IS a success from the user's point of view, just not a confirmed one
//      yet. This used to unconditionally roll the optimistic entry back and
//      rethrow regardless of whether the create had actually queued, which
//      made an offline quick-add look like an outright failure (the item
//      appeared then vanished) and, because the sheet stayed open on that
//      thrown error, let a retry enqueue a second, duplicate outbox entry
//      for the same input.
//   6. on a genuine rejection (the server responded, it just said no), roll
//      the optimistic patch back and rethrow — replaying an invalid payload
//      later wouldn't succeed either, so this is not queued.
//
// A completion haptic + the domain's "created" analytics event fire only
// once the live create actually succeeds — a queued-for-later offline add
// doesn't count as confirmed yet, so it doesn't get the celebratory haptic.

import { useCallback, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";

import {
  createGoalSchema,
  createScheduleBlockSchema,
  createTaskSchema,
  genId,
  hasResponse,
  type AnalyticsCapability,
  type CreateGoalInput,
  type CreateScheduleBlockInput,
  type CreateTaskInput,
  type Goal,
  type ScheduleBlock,
  type Task,
  type WeekSchedule,
} from "@goalslot/shared";

import { apiClient, notify } from "../lib/api-client";
import { hapticCompletion } from "../lib/haptics";
import { offlineSync, outbox } from "../lib/offline";
import { categoryQueries, goalQueries, scheduleQueries, taskQueries } from "../lib/queries";
import { queryClient } from "../lib/query-client";
import { useAnalytics } from "../providers/growth-provider";

export interface QuickAddGoalInput {
  kind: "goal";
  title: string;
}

export interface QuickAddTaskInput {
  kind: "task";
  title: string;
}

export interface QuickAddSlotInput {
  kind: "slot";
  title: string;
  /** JS `Date.getDay()` convention: 0 = Sunday ... 6 = Saturday, matching `WeekSchedule`. */
  dayOfWeek: number;
}

export type QuickAddInput = QuickAddGoalInput | QuickAddTaskInput | QuickAddSlotInput;

export interface UseQuickAddResult {
  submit: (input: QuickAddInput) => Promise<void>;
  isSubmitting: boolean;
  /** Message from the most recent failed submit(); cleared at the start of the next one. */
  error: string | null;
}

const FALLBACK_CATEGORY = "general";
const DEFAULT_GOAL_TARGET_HOURS = 1;
const DEFAULT_SLOT_DURATION_MINUTES = 60;
const PLACEHOLDER_COLOR = "#94A3B8";

/** HH:mm for "the next half hour from now" — a sane default start time for a quick-added slot. */
function defaultStartTime(now: Date = new Date()): string {
  const roundUpToHalfHour = now.getMinutes() < 30 ? 30 : 60;
  const totalMinutes = now.getHours() * 60 + roundUpToHalfHour;
  return minutesToHHmm(totalMinutes % (24 * 60));
}

function addMinutes(hhmm: string, minutesToAdd: number): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return minutesToHHmm((hours * 60 + minutes + minutesToAdd) % (24 * 60));
}

function minutesToHHmm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Resolves the user's default category (`Category.isDefault`) for the goal
 * and slot quick-add flows, which both require a category the server
 * recognizes. Falls back to a placeholder value when the categories list
 * can't be loaded (offline, or a brand-new account with none yet) — the
 * live create will then fail server-side validation exactly like any other
 * offline/invalid case, which the caller already handles.
 */
async function resolveDefaultCategory(): Promise<string> {
  try {
    const categories = await queryClient.ensureQueryData(categoryQueries.list());
    const defaultCategory = categories.find((category) => category.isDefault) ?? categories[0];
    return defaultCategory?.value ?? FALLBACK_CATEGORY;
  } catch {
    return FALLBACK_CATEGORY;
  }
}

interface RunQuickAddArgs<TInput, TCreated> {
  payload: TInput;
  outboxKind: string;
  invalidateKey: QueryKey;
  create: (payload: TInput) => Promise<TCreated>;
  applyOptimistic: () => void;
  rollbackOptimistic: () => void;
  /** Tags the still-showing optimistic entry `pendingSync: true` once its create has queued. */
  markPendingSync: () => void;
  onSuccess: (created: TCreated) => void;
}

async function runQuickAdd<TInput, TCreated>({
  payload,
  outboxKind,
  invalidateKey,
  create,
  applyOptimistic,
  rollbackOptimistic,
  markPendingSync,
  onSuccess,
}: RunQuickAddArgs<TInput, TCreated>): Promise<void> {
  applyOptimistic();

  try {
    const created = await create(payload);
    void queryClient.invalidateQueries({ queryKey: invalidateKey });
    onSuccess(created);
  } catch (err) {
    if (!hasResponse(err)) {
      // No server response at all — offline/timeout. The create WAS queued
      // (about to be, below), so the optimistic entry stays exactly where it
      // is instead of being yanked back out from under the user; it just
      // gets tagged so the row can show a "queued" treatment instead of
      // looking identical to a confirmed save.
      await outbox.addToOutbox({
        id: genId(),
        kind: outboxKind,
        payload,
        idempotencyKey: genId(),
        createdAt: Date.now(),
        retries: 0,
      });
      void offlineSync.refreshPendingCount();
      markPendingSync();
      notify("Queued — will sync when online", "offline");
      return;
    }

    // The server actually answered and rejected this — nothing was queued,
    // so the optimistic entry has to come back out, and the caller's own
    // inline error (QuickAddSheet's `error` state) takes over from here.
    rollbackOptimistic();
    throw err;
  }
}

// Patches only the default (unfiltered) list query — goalQueries.list() /
// taskQueries.list() called with no filters, which is the key a screen's
// "everything" view subscribes to. A screen viewing a filtered subset
// (e.g. tasks for one goal) won't see the optimistic entry until the
// post-success invalidate refetches it; that's an acceptable gap for a
// quick-add shell and can grow into per-filter patching once a real screen
// needs it.
function addToListCache<T extends { id: string }>(queryKey: QueryKey, item: T): void {
  queryClient.setQueryData<T[]>(queryKey, (existing) => [item, ...(existing ?? [])]);
}

function removeFromListCache<T extends { id: string }>(queryKey: QueryKey, id: string): void {
  queryClient.setQueryData<T[]>(queryKey, (existing) => (existing ?? []).filter((entry) => entry.id !== id));
}

/** Tags the still-optimistic list entry `pendingSync: true` once its create has queued to the outbox. */
function markPendingInListCache<T extends { id: string }>(queryKey: QueryKey, id: string): void {
  queryClient.setQueryData<T[]>(queryKey, (existing) =>
    (existing ?? []).map((entry) => (entry.id === id ? { ...entry, pendingSync: true } : entry)),
  );
}

async function submitGoal(input: QuickAddGoalInput, analytics: AnalyticsCapability): Promise<void> {
  const category = await resolveDefaultCategory();
  const payload: CreateGoalInput = createGoalSchema.parse({
    title: input.title,
    category,
    targetHours: DEFAULT_GOAL_TARGET_HOURS,
  });

  const optimisticId = genId();
  const listKey = goalQueries.goalQueries.list();
  const optimistic: Goal = {
    id: optimisticId,
    title: payload.title,
    category: payload.category,
    targetHours: payload.targetHours,
    loggedHours: 0,
    status: "ACTIVE",
    color: PLACEHOLDER_COLOR,
  };

  await runQuickAdd<CreateGoalInput, Goal>({
    payload,
    outboxKind: "goal-create",
    invalidateKey: goalQueries.goalQueries.all,
    create: (p) => apiClient.goals.create(p).then((res) => res.data),
    applyOptimistic: () => addToListCache(listKey, optimistic),
    rollbackOptimistic: () => removeFromListCache<Goal>(listKey, optimisticId),
    markPendingSync: () => markPendingInListCache<Goal>(listKey, optimisticId),
    onSuccess: (created) => {
      hapticCompletion();
      analytics.track({ name: "goalCreated", payload: { goalId: created.id } });
    },
  });
}

async function submitTask(input: QuickAddTaskInput, analytics: AnalyticsCapability): Promise<void> {
  const payload: CreateTaskInput = createTaskSchema.parse({ title: input.title });

  const optimisticId = genId();
  const listKey = taskQueries.taskQueries.list();
  const optimistic: Task = {
    id: optimisticId,
    title: payload.title,
    status: "TODO",
  };

  await runQuickAdd<CreateTaskInput, Task>({
    payload,
    outboxKind: "task-create",
    invalidateKey: taskQueries.taskQueries.all,
    create: (p) => apiClient.tasks.create(p).then((res) => res.data),
    applyOptimistic: () => addToListCache(listKey, optimistic),
    rollbackOptimistic: () => removeFromListCache<Task>(listKey, optimisticId),
    markPendingSync: () => markPendingInListCache<Task>(listKey, optimisticId),
    onSuccess: (created) => {
      hapticCompletion();
      analytics.track({ name: "taskCreated", payload: { taskId: created.id } });
    },
  });
}

async function submitSlot(input: QuickAddSlotInput, analytics: AnalyticsCapability): Promise<void> {
  const category = await resolveDefaultCategory();
  const startTime = defaultStartTime();
  const endTime = addMinutes(startTime, DEFAULT_SLOT_DURATION_MINUTES);

  const payload: CreateScheduleBlockInput = createScheduleBlockSchema.parse({
    title: input.title,
    dayOfWeek: input.dayOfWeek,
    startTime,
    endTime,
    category,
  });

  const optimisticId = genId();
  const weeklyKey = scheduleQueries.scheduleQueries.weeklyKey();
  const optimistic: ScheduleBlock = {
    id: optimisticId,
    title: payload.title,
    startTime: payload.startTime,
    endTime: payload.endTime,
    dayOfWeek: payload.dayOfWeek,
    category: payload.category,
    color: PLACEHOLDER_COLOR,
    isRecurring: false,
    isPrivate: false,
    seriesId: optimisticId,
  };

  const patchDay = (mutate: (blocks: ScheduleBlock[]) => ScheduleBlock[]) => {
    queryClient.setQueryData<WeekSchedule>(weeklyKey, (existing) => {
      const week = existing ?? {};
      const dayBlocks = week[payload.dayOfWeek] ?? [];
      return { ...week, [payload.dayOfWeek]: mutate(dayBlocks) };
    });
  };

  await runQuickAdd<CreateScheduleBlockInput, ScheduleBlock>({
    payload,
    outboxKind: "schedule-block-create",
    invalidateKey: scheduleQueries.scheduleQueries.root(),
    create: (p) => apiClient.schedule.create(p).then((res) => res.data),
    applyOptimistic: () => patchDay((blocks) => [optimistic, ...blocks]),
    rollbackOptimistic: () => patchDay((blocks) => blocks.filter((block) => block.id !== optimisticId)),
    markPendingSync: () =>
      patchDay((blocks) => blocks.map((block) => (block.id === optimisticId ? { ...block, pendingSync: true } : block))),
    onSuccess: (created) => {
      hapticCompletion();
      analytics.track({ name: "scheduleBlockCreated", payload: { scheduleBlockId: created.id } });
    },
  });
}

export function useQuickAdd(): UseQuickAddResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analytics = useAnalytics();

  const submit = useCallback(
    async (input: QuickAddInput) => {
      setError(null);
      setIsSubmitting(true);
      try {
        if (input.kind === "goal") {
          await submitGoal(input, analytics);
        } else if (input.kind === "task") {
          await submitTask(input, analytics);
        } else {
          await submitSlot(input, analytics);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add that. Please try again.");
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [analytics],
  );

  return { submit, isSubmitting, error };
}
