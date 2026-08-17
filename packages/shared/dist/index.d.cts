import { z } from 'zod';
import * as axios from 'axios';
import { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import * as _tanstack_react_query from '@tanstack/react-query';
import { QueryKey } from '@tanstack/react-query';
import * as _tanstack_query_core from '@tanstack/query-core';

type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'PAUSED';
interface LabelInput {
    name: string;
    color?: string;
}
interface GoalLabel {
    id: string;
    labelId: string;
    label: {
        id: string;
        name: string;
        value: string;
        color: string;
    };
}
interface Goal {
    id: string;
    title: string;
    description?: string;
    category: string;
    targetHours: number;
    loggedHours: number;
    deadline?: string;
    status: GoalStatus;
    color: string;
    labels?: GoalLabel[];
    /**
     * Client-only UI flag: this row reflects an edit that queued to the offline
     * outbox rather than one the server has confirmed. Never sent to or read
     * from the API — set locally on an optimistic cache patch (mobile's
     * goals.tsx / EditGoalSheet.tsx / useQuickAdd.ts) and cleared by the
     * post-sync invalidate once the real record comes back.
     */
    pendingSync?: boolean;
}
/**
 * Lightweight goal projection embedded on Task/TimeEntry/ScheduleBlock
 * records returned by list endpoints.
 *
 * Reconciliation note: the web app defined three near-duplicate local
 * `Goal` interfaces for this purpose — features/tasks/utils/types.ts
 * (id, title, color, status, category?, order?), features/time-tracker/utils/types.ts
 * (id, title, color, category?), and the inline `goal` field shape on
 * features/schedule/utils/types.ts's ScheduleBlock (id, title, color, category?).
 * None of them match the full `Goal` type above (no targetHours/loggedHours/labels),
 * because those endpoints only ever return this summary. Consolidated into one
 * shape here (superset of the three) instead of forking it again per domain.
 */
interface GoalSummary {
    id: string;
    title: string;
    color: string;
    status?: string;
    category?: string;
    order?: number;
}
interface GoalStats {
    active: number;
    completed: number;
    paused: number;
}
interface GoalFilters {
    status?: string;
    categories?: string[];
    labelIds?: string[];
}
declare const GOAL_STATUS_OPTIONS: {
    value: GoalStatus;
    label: string;
}[];

type TaskStatus = 'BACKLOG' | 'TODO' | 'DOING' | 'DONE';
/**
 * Lightweight schedule-block projection embedded on a Task.
 * Reconciliation note: the web app's features/tasks/utils/types.ts defined
 * its own local `ScheduleBlock` with this exact shape, which collides with
 * (and is a subset of) the canonical `ScheduleBlock` in ./schedule. Renamed
 * here to avoid the clash — task list endpoints only ever return this
 * summary, never the full block.
 */
interface TaskScheduleBlockSummary {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    goalId?: string;
}
interface Task {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    category?: string;
    estimatedMinutes?: number;
    actualMinutes?: number;
    trackedMinutes?: number;
    dueDate?: string;
    completedAt?: string;
    createdAt?: string;
    goalId?: string;
    goal?: GoalSummary;
    scheduleBlockId?: string;
    scheduleBlock?: TaskScheduleBlockSummary;
    order?: number;
    notes?: string;
    /**
     * Client-only UI flag: this row reflects an edit/complete/delete that
     * queued to the offline outbox rather than one the server has confirmed.
     * Never sent to or read from the API — see the identical note on
     * `Goal.pendingSync`.
     */
    pendingSync?: boolean;
}
/** Query params accepted by GET /tasks (list-tasks-query.dto.ts on the API). */
interface TaskListFilters {
    status?: TaskStatus;
    statuses?: TaskStatus[];
    scheduleBlockId?: string;
    goalId?: string;
    dayOfWeek?: number;
}

interface ScheduleBlockGoalSummary {
    id: string;
    title: string;
    color: string;
    category?: string;
}
interface ScheduleBlockTaskSummary {
    id: string;
    title: string;
    status: string;
}
interface ScheduleBlock {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    category: string;
    color: string;
    isRecurring: boolean;
    isPrivate: boolean;
    seriesId: string;
    goalId?: string;
    goal?: ScheduleBlockGoalSummary;
    tasks?: ScheduleBlockTaskSummary[];
    /**
     * Client-only UI flag: this row reflects a create/edit that queued to the
     * offline outbox rather than one the server has confirmed. Never sent to
     * or read from the API — see the identical note on `Goal.pendingSync`.
     */
    pendingSync?: boolean;
}
/**
 * Keyed by JS `Date.getDay()` convention: 0 = Sunday ... 6 = Saturday.
 *
 * IMPORTANT: every function in `src/scheduling` that reads or writes a
 * `WeekSchedule` uses this same Sunday=0 indexing. Monday-start week
 * indexing (`weekStartsOn: 1`) is used ONLY by the reporting/analytics
 * date-range helpers (`src/scheduling/reporting.ts`), which don't touch
 * `WeekSchedule` at all. The web app mixed the two conventions in a few
 * places; this package keeps them in separate modules so callers can't
 * accidentally cross the streams.
 */
type WeekSchedule = Record<number, ScheduleBlock[]>;
type ScheduleUpdateScope = 'single' | 'series';
/**
 * How far a delete reaches. Mirrors `ScheduleUpdateScope`, but note the
 * asymmetry in how each is honoured: the API accepts `updateScope` in the
 * PUT body and fans out server-side (`updateMany({ userId, seriesId })`),
 * whereas `DELETE /schedule/:id` takes no scope at all. There is no
 * `deleteScope` field on the wire — a 'series' delete is the CLIENT issuing
 * one DELETE per member block. This type names the user's intent so the UI
 * and the call site agree on it; it is never serialised.
 */
type ScheduleDeleteScope = 'single' | 'series';

interface TimeEntryScheduleBlockSummary {
    id: string;
    title: string;
    category?: string;
}
interface TimeEntry {
    id: string;
    taskName: string;
    notes?: string;
    duration: number;
    date: string;
    scheduleBlockId?: string;
    scheduleBlock?: TimeEntryScheduleBlockSummary;
    goalId?: string;
    goal?: GoalSummary;
    startedAt?: string;
    taskId?: string;
    taskTitle?: string;
}

type ActiveTimerSessionStatus = 'RUNNING' | 'PAUSED';
interface ActiveTimerSessionGoalSummary {
    id: string;
    title: string;
    color: string;
}
interface ActiveTimerSessionTaskSummary {
    id: string;
    title: string;
}
interface ActiveTimerSessionScheduleBlockSummary {
    id: string;
    title: string;
}
/**
 * GET/POST/PATCH `/timer/session` all return this shape (or `null` from GET
 * when nothing is running). Dates are ISO strings, same as every other
 * timestamp this package already gets back over JSON (see TimeEntry).
 */
interface ActiveTimerSession {
    id: string;
    status: ActiveTimerSessionStatus;
    /** When the session was first started. Unaffected by later pause/resume cycles. */
    startedAt: string;
    /** When the current RUNNING segment began; null while paused. */
    segmentStartedAt: string | null;
    pausedAt: string | null;
    /** Elapsed ms banked from segments before the current one. */
    accumulatedMs: number;
    /** Server-computed total elapsed ms as of `serverTime` — accumulatedMs plus any open segment. */
    elapsedMs: number;
    /** The server's clock at the moment this response was built, paired with `elapsedMs`. */
    serverTime: string;
    /** True once `elapsedMs` has passed `maxSessionMs` — the server never auto-stops, it only flags. */
    isStale: boolean;
    /** What a stop would actually write — `elapsedMs` clamped to `maxSessionMs`. */
    cappedElapsedMs: number;
    maxSessionMs: number;
    taskName: string | null;
    notes: string | null;
    goalId: string | null;
    goal: ActiveTimerSessionGoalSummary | null;
    taskId: string | null;
    task: ActiveTimerSessionTaskSummary | null;
    scheduleBlockId: string | null;
    scheduleBlock: ActiveTimerSessionScheduleBlockSummary | null;
    /** Which client last touched this session — purely informational, for a takeover prompt. */
    lastClient: string | null;
    createdAt: string;
    updatedAt: string;
}
/** Which client is calling, so a 409 takeover prompt elsewhere can name the other device. */
type ActiveTimerClient = 'web' | 'ios' | 'android' | 'unknown';
/**
 * Attribution fields shared by start/update/stop. `undefined` (an omitted
 * key) means "leave it alone"; an explicit `null` means "clear it" — see
 * dw-time-api's AttributionFieldsDto for the same rule server-side.
 */
interface ActiveTimerAttributionInput {
    taskName?: string | null;
    goalId?: string | null;
    taskId?: string | null;
    scheduleBlockId?: string | null;
    notes?: string | null;
}
interface StartTimerSessionInput extends ActiveTimerAttributionInput {
    /**
     * Replace an existing session instead of failing with 409. The replaced
     * session is DISCARDED, not stopped — callers that want to keep its
     * elapsed time must stop it first.
     */
    takeOver?: boolean;
    client?: ActiveTimerClient;
}
type UpdateTimerSessionInput = ActiveTimerAttributionInput & {
    client?: ActiveTimerClient;
};
type StopTimerSessionInput = ActiveTimerAttributionInput & {
    client?: ActiveTimerClient;
};
/** Body of the 409 a start() without `takeOver` gets back when a session already exists. */
interface ActiveTimerConflict {
    code: string;
    message: string;
    activeSession: ActiveTimerSession | null;
}
/**
 * POST /timer/session/stop's response: the TimeEntry it wrote plus the raw
 * numbers, so a caller can tell the user "12h was capped to the 12h max"
 * without re-deriving it.
 */
interface StopTimerSessionResult {
    timeEntry: TimeEntry;
    elapsedMs: number;
    durationMinutes: number;
    capped: boolean;
    maxSessionMs: number;
}

interface Note {
    id: string;
    title: string;
    /** Serialized editor content. Current clients store an HTML string; the
     *  API defaults new rows to '[]' (the legacy JSON-blocks format), so
     *  treat it as an opaque string. */
    content: string;
    icon: string | null;
    color: string | null;
    parentId: string | null;
    order: number;
    isExpanded: boolean;
    isFavorite: boolean;
    /** ISO timestamp string. The web type declared `Date`, but what the API
     *  actually returns over JSON (and what sits in the query cache) is a
     *  string — fixed here rather than re-ported. */
    createdAt: string;
    updatedAt: string;
    userId: string;
    /**
     * Client-only UI flag: this row reflects a title/content save that queued
     * to the offline outbox rather than one the server has confirmed. Never
     * sent to or read from the API — see the identical note on
     * `Goal.pendingSync`.
     */
    pendingSync?: boolean;
}
interface NoteTreeItem extends Note {
    children: NoteTreeItem[];
    depth: number;
}
/** Response shape of GET /notes/:id — resolves for the owner OR an active
 *  share recipient; `readOnly` is true for recipients so editors must
 *  disable saves. */
interface NoteDetailResponse {
    note: Note;
    readOnly: boolean;
}
/** Mirrors dw-time-api/src/modules/notes/dto/notes.dto.ts (CreateNoteDto),
 *  plus the optional client-generated `id` the web's `note.create` offline
 *  operation posts (`{ id: meta.entityId, ...data }`) so queued creates
 *  are idempotent. The server ignores unknown fields via whitelist. */
interface CreateNoteDto {
    id?: string;
    title: string;
    content?: string;
    icon?: string;
    color?: string;
    parentId?: string | null;
}
/** Mirrors dw-time-api/src/modules/notes/dto/notes.dto.ts (UpdateNoteDto). */
interface UpdateNoteDto {
    title?: string;
    content?: string;
    icon?: string;
    color?: string;
    parentId?: string | null;
    order?: number;
    isExpanded?: boolean;
    isFavorite?: boolean;
}
/** One row of the PUT /notes/reorder payload. NOTE: the request body is a
 *  BARE ARRAY of these — tree-aware, unlike the `{ ids }` wrapper the
 *  goals/tasks reorder endpoints take. (Named `ReorderPayloadItem` in the
 *  web's tree-dnd.ts; renamed here so it reads as a note type from the
 *  package root.) */
interface NoteReorderItem {
    noteId: string;
    parentId: string | null;
    order: number;
}

interface User {
    id: string;
    email: string;
    name: string;
    avatar?: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
    userType: 'INTERNAL' | 'EXTERNAL' | 'SSO';
    plan: 'FREE' | 'BASIC' | 'PRO';
    unlimitedAccess: boolean;
    subscriptionStatus?: string;
    subscriptionEndDate?: string | null;
    preferences?: {
        timezone?: string;
        [key: string]: unknown;
    };
    limits: {
        maxGoals: number;
        maxSchedules: number;
        maxTasksPerDay: number;
    };
}

interface Category {
    id: string;
    userId: string;
    name: string;
    value: string;
    color: string;
    isDefault: boolean;
    order: number;
    createdAt: string;
    updatedAt: string;
}
interface CreateCategoryForm {
    name: string;
    color: string;
    order?: number;
}
interface UpdateCategoryForm {
    name?: string;
    color?: string;
    order?: number;
    isDefault?: boolean;
}

interface Label {
    id: string;
    name: string;
    value: string;
    color: string;
    isDefault: boolean;
    order: number;
    _count?: {
        goals: number;
    };
}
interface CreateLabelForm {
    name: string;
    color?: string;
    order?: number;
}
interface UpdateLabelForm {
    name?: string;
    color?: string;
    order?: number;
}

/**
 * One journal entry, keyed to a single calendar day (YYYY-MM-DD, local
 * device time — see scheduling/time.ts's getLocalDateString/todayKey).
 *
 * One-entry-per-day is enforced by the database, not just by the UI: the row
 * carries a `[userId, date]` composite unique, and `POST /coach/journal/
 * entries` is a Prisma upsert against it. That is why `date` — not `id` — is
 * the key every write and delete in api/journal.ts addresses an entry by.
 */
interface JournalEntry {
    id: string;
    date: string;
    content: string;
    createdAt?: string;
    updatedAt?: string;
    /**
     * Client-only UI flag: this entry reflects a save that queued to the
     * offline outbox rather than one the server has confirmed. Never sent to
     * or read from the API — see the identical note on `Goal.pendingSync`.
     */
    pendingSync?: boolean;
}

/** A member of a conversation, as jiffy-messaging knows them. */
interface MessagingParticipant {
    /** GoalSlot user id. jiffy-messaging stores it as an opaque string. */
    userId: string;
    /**
     * ISO instant this participant last called POST /conversations/:id/read,
     * or null if they never have. Drives the unread indicator — see
     * ../messaging/unread.ts.
     */
    lastReadAt: string | null;
}
interface MessagingConversation {
    id: string;
    participants: MessagingParticipant[];
    createdAt?: string;
    updatedAt?: string;
    /**
     * Optional server-side convenience. jiffy-messaging's documented
     * conversation shape doesn't promise this, so every consumer must treat it
     * as absent-by-default and fall back to the thread's own last message.
     */
    lastMessage?: MessagingMessage | null;
}
interface MessagingMessage {
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    /** ISO instant. Messages sort oldest-first by this. */
    createdAt: string;
}
/**
 * A message that exists only on this device so far: rendered immediately on
 * send, then either replaced by the server's row or rolled back. `clientId`
 * is what lets the reconciler tell "the server echoed my own message back"
 * from "someone else sent something".
 */
interface PendingMessagingMessage extends MessagingMessage {
    clientId: string;
    status: 'sending' | 'failed' | 'queued';
}
type MessagingThreadMessage = MessagingMessage | PendingMessagingMessage;
declare function isPendingMessage(message: MessagingThreadMessage): message is PendingMessagingMessage;
/** POST /messaging/token on GoalSlot's API. */
interface MessagingTokenResponse {
    token: string;
    /**
     * ISO instant the token stops being accepted, when the server bothers to
     * say. Optional on purpose: the client must never *depend* on being told,
     * because a token can also be revoked early. The token store treats a 401
     * from jiffy-messaging as the real signal and refreshes on it regardless of
     * what this said — `expiresAt` only avoids the pointless round-trip of
     * sending a token already known to be dead.
     */
    expiresAt?: string;
}
/** POST /messaging/conversations on GoalSlot's API. */
interface CreateMessagingConversationInput {
    /** The GoalSlot user id of the person to talk to. */
    userId: string;
}
/**
 * Response body of POST /messaging/conversations. Deliberately NOT a
 * `MessagingConversation` — that type mirrors jiffy-messaging's own shape
 * (`id`, `participants: MessagingParticipant[]`), but this endpoint is
 * GoalSlot's own wrapper around it, keyed `conversationId` and carrying the
 * counterpart's identity (jiffy-messaging has never heard of GoalSlot users,
 * so it can't supply that). Reading `.id` off this response is a silent
 * `undefined`, not a type error, since both interfaces are structurally
 * similar-looking objects — hence calling it out here instead of reusing
 * `MessagingConversation`.
 */
interface OpenMessagingConversationResponse {
    conversationId: string;
    participantIds: string[];
    createdAt: string;
    /** false when an existing conversation was reused instead of created. */
    created: boolean;
    counterpart: {
        id: string;
        name: string;
        email: string;
        avatar: string | null;
    };
}
/**
 * One person the signed-in user is allowed to message, assembled from the
 * sharing directory. Not a server shape — see ../messaging/contacts.ts.
 */
interface MessagingContact {
    userId: string;
    name: string;
    email: string;
    avatar?: string;
    /** How the sharing relationship runs, purely for a subtitle in the picker. */
    relationship: 'shared-with-them' | 'shared-with-me' | 'mutual';
    /**
     * Whether the server would actually let a conversation be opened with this
     * person — i.e. what `canMessage` checks (an accepted share in either
     * direction). False people are still returned, deliberately: the picker
     * lists them greyed out with `blockedReason` as the explanation instead of
     * hiding them. Hiding was tried and made the list empty, which is a worse
     * outcome than a row the user can see and understand.
     */
    messageable: boolean;
    /**
     * Why `messageable` is false. Only meaningful when it is.
     *
     * 'invite-pending' — the user shared with this person, but they haven't
     * accepted yet, so the server's canMessage would refuse.
     */
    blockedReason?: 'invite-pending';
}
/** Connection state of the live-delivery socket, for the UI's offline banner. */
type MessagingSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

declare const labelInputSchema: z.ZodObject<{
    name: z.ZodString;
    color: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    color?: string | undefined;
}, {
    name: string;
    color?: string | undefined;
}>;
declare const createGoalSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    category: z.ZodString;
    targetHours: z.ZodNumber;
    deadline: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    isPrivate: z.ZodOptional<z.ZodBoolean>;
    labels: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        color: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        color?: string | undefined;
    }, {
        name: string;
        color?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    title: string;
    category: string;
    targetHours: number;
    color?: string | undefined;
    description?: string | undefined;
    deadline?: string | undefined;
    isPrivate?: boolean | undefined;
    labels?: {
        name: string;
        color?: string | undefined;
    }[] | undefined;
}, {
    title: string;
    category: string;
    targetHours: number;
    color?: string | undefined;
    description?: string | undefined;
    deadline?: string | undefined;
    isPrivate?: boolean | undefined;
    labels?: {
        name: string;
        color?: string | undefined;
    }[] | undefined;
}>;
declare const updateGoalSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    category: z.ZodOptional<z.ZodString>;
    targetHours: z.ZodOptional<z.ZodNumber>;
    deadline: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    color: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    isPrivate: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    labels: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        color: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        color?: string | undefined;
    }, {
        name: string;
        color?: string | undefined;
    }>, "many">>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["ACTIVE", "COMPLETED", "PAUSED"]>>;
    loggedHours: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    color?: string | undefined;
    status?: "ACTIVE" | "COMPLETED" | "PAUSED" | undefined;
    title?: string | undefined;
    description?: string | undefined;
    category?: string | undefined;
    targetHours?: number | undefined;
    deadline?: string | undefined;
    isPrivate?: boolean | undefined;
    labels?: {
        name: string;
        color?: string | undefined;
    }[] | undefined;
    loggedHours?: number | undefined;
}, {
    color?: string | undefined;
    status?: "ACTIVE" | "COMPLETED" | "PAUSED" | undefined;
    title?: string | undefined;
    description?: string | undefined;
    category?: string | undefined;
    targetHours?: number | undefined;
    deadline?: string | undefined;
    isPrivate?: boolean | undefined;
    labels?: {
        name: string;
        color?: string | undefined;
    }[] | undefined;
    loggedHours?: number | undefined;
}>;
type CreateGoalInput = z.infer<typeof createGoalSchema>;
type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

declare const taskStatusSchema: z.ZodEnum<["BACKLOG", "TODO", "DOING", "DONE"]>;
declare const createTaskSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["BACKLOG", "TODO", "DOING", "DONE"]>>;
    estimatedMinutes: z.ZodOptional<z.ZodNumber>;
    goalId: z.ZodOptional<z.ZodString>;
    scheduleBlockId: z.ZodOptional<z.ZodString>;
    dueDate: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    status?: "BACKLOG" | "TODO" | "DOING" | "DONE" | undefined;
    description?: string | undefined;
    category?: string | undefined;
    estimatedMinutes?: number | undefined;
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    dueDate?: string | undefined;
    notes?: string | undefined;
}, {
    title: string;
    status?: "BACKLOG" | "TODO" | "DOING" | "DONE" | undefined;
    description?: string | undefined;
    category?: string | undefined;
    estimatedMinutes?: number | undefined;
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    dueDate?: string | undefined;
    notes?: string | undefined;
}>;
declare const updateTaskSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    category: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    status: z.ZodOptional<z.ZodOptional<z.ZodEnum<["BACKLOG", "TODO", "DOING", "DONE"]>>>;
    estimatedMinutes: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    goalId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    scheduleBlockId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    dueDate: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    status?: "BACKLOG" | "TODO" | "DOING" | "DONE" | undefined;
    title?: string | undefined;
    description?: string | undefined;
    category?: string | undefined;
    estimatedMinutes?: number | undefined;
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    dueDate?: string | undefined;
    notes?: string | undefined;
}, {
    status?: "BACKLOG" | "TODO" | "DOING" | "DONE" | undefined;
    title?: string | undefined;
    description?: string | undefined;
    category?: string | undefined;
    estimatedMinutes?: number | undefined;
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    dueDate?: string | undefined;
    notes?: string | undefined;
}>;
declare const completeTaskSchema: z.ZodObject<{
    actualMinutes: z.ZodNumber;
    notes: z.ZodOptional<z.ZodString>;
    date: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    actualMinutes: number;
    notes?: string | undefined;
    date?: string | undefined;
}, {
    actualMinutes: number;
    notes?: string | undefined;
    date?: string | undefined;
}>;
type CreateTaskInput = z.infer<typeof createTaskSchema>;
type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

declare const createScheduleBlockSchema: z.ZodObject<{
    title: z.ZodString;
    startTime: z.ZodString;
    endTime: z.ZodString;
    dayOfWeek: z.ZodNumber;
    category: z.ZodString;
    color: z.ZodOptional<z.ZodString>;
    isRecurring: z.ZodOptional<z.ZodBoolean>;
    isPrivate: z.ZodOptional<z.ZodBoolean>;
    goalId: z.ZodOptional<z.ZodString>;
    seriesId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    title: string;
    category: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    color?: string | undefined;
    isPrivate?: boolean | undefined;
    goalId?: string | undefined;
    isRecurring?: boolean | undefined;
    seriesId?: string | undefined;
}, {
    title: string;
    category: string;
    startTime: string;
    endTime: string;
    dayOfWeek: number;
    color?: string | undefined;
    isPrivate?: boolean | undefined;
    goalId?: string | undefined;
    isRecurring?: boolean | undefined;
    seriesId?: string | undefined;
}>;
declare const updateScheduleBlockSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    startTime: z.ZodOptional<z.ZodString>;
    endTime: z.ZodOptional<z.ZodString>;
    dayOfWeek: z.ZodOptional<z.ZodNumber>;
    category: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    isRecurring: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    isPrivate: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    goalId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    seriesId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
} & {
    updateScope: z.ZodOptional<z.ZodEnum<["single", "series"]>>;
}, "strip", z.ZodTypeAny, {
    color?: string | undefined;
    title?: string | undefined;
    category?: string | undefined;
    isPrivate?: boolean | undefined;
    goalId?: string | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    dayOfWeek?: number | undefined;
    isRecurring?: boolean | undefined;
    seriesId?: string | undefined;
    updateScope?: "single" | "series" | undefined;
}, {
    color?: string | undefined;
    title?: string | undefined;
    category?: string | undefined;
    isPrivate?: boolean | undefined;
    goalId?: string | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
    dayOfWeek?: number | undefined;
    isRecurring?: boolean | undefined;
    seriesId?: string | undefined;
    updateScope?: "single" | "series" | undefined;
}>;
type CreateScheduleBlockInput = z.infer<typeof createScheduleBlockSchema>;
type UpdateScheduleBlockInput = z.infer<typeof updateScheduleBlockSchema>;

declare const createTimeEntrySchema: z.ZodObject<{
    taskName: z.ZodString;
    duration: z.ZodNumber;
    date: z.ZodString;
    notes: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodString>;
    taskTitle: z.ZodOptional<z.ZodString>;
    goalId: z.ZodOptional<z.ZodString>;
    scheduleBlockId: z.ZodOptional<z.ZodString>;
    taskId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    date: string;
    taskName: string;
    duration: number;
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    notes?: string | undefined;
    startedAt?: string | undefined;
    taskTitle?: string | undefined;
    taskId?: string | undefined;
}, {
    date: string;
    taskName: string;
    duration: number;
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    notes?: string | undefined;
    startedAt?: string | undefined;
    taskTitle?: string | undefined;
    taskId?: string | undefined;
}>;
declare const updateTimeEntrySchema: z.ZodObject<{
    taskName: z.ZodOptional<z.ZodString>;
    duration: z.ZodOptional<z.ZodNumber>;
    date: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    startedAt: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    taskTitle: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    goalId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    scheduleBlockId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    taskId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    notes?: string | undefined;
    date?: string | undefined;
    taskName?: string | undefined;
    duration?: number | undefined;
    startedAt?: string | undefined;
    taskTitle?: string | undefined;
    taskId?: string | undefined;
}, {
    goalId?: string | undefined;
    scheduleBlockId?: string | undefined;
    notes?: string | undefined;
    date?: string | undefined;
    taskName?: string | undefined;
    duration?: number | undefined;
    startedAt?: string | undefined;
    taskTitle?: string | undefined;
    taskId?: string | undefined;
}>;
type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;
type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

/** `@MaxLength(65535)` on both DTOs' `content` — "TipTap HTML can be large; allow up to ~64KB". */
declare const MAX_JOURNAL_CONTENT_LENGTH = 65535;
declare const upsertJournalEntrySchema: z.ZodObject<{
    date: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    date: string;
    content: string;
}, {
    date: string;
    content: string;
}>;
declare const updateJournalEntrySchema: z.ZodObject<{
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
}, {
    content: string;
}>;
/** @deprecated Alias of `upsertJournalEntrySchema` — POST is a create-or-update, not a create. */
declare const createJournalEntrySchema: z.ZodObject<{
    date: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    date: string;
    content: string;
}, {
    date: string;
    content: string;
}>;
type UpsertJournalEntryInput = z.infer<typeof upsertJournalEntrySchema>;
/** @deprecated Alias of `UpsertJournalEntryInput`. */
type CreateJournalEntryInput = UpsertJournalEntryInput;
type UpdateJournalEntryInput = z.infer<typeof updateJournalEntrySchema>;

declare function timeToMinutes(time: string): number;
declare function minutesToTime(minutes: number): string;
/**
 * Convert "HH:mm" (24h) into "h:mm AM/PM". Used in user-facing surfaces;
 * keep storage and APIs in HH:mm.
 */
declare function formatTime12h(time: string): string;
declare function formatDuration(minutes: number): string;
/**
 * Get a date as a YYYY-MM-DD string in local (device) time.
 *
 * This intentionally never uses `date.toISOString().split('T')[0]` — that
 * reads the date in UTC, which shows the wrong calendar day for any user
 * behind UTC (e.g. 11pm local on Jan 1 is already Jan 2 in UTC). This was a
 * confirmed bug in the web app's ported call sites; do not reintroduce it.
 */
declare function getLocalDateString(date?: Date): string;
declare function getLocalTimeString(date?: Date): string;
/**
 * Canonical YYYY-MM-DD "day key" for a date, in local (device) time.
 * Dedupes what used to be five separate `todayKey()` implementations across
 * the web app (components/floating-journal-button.tsx,
 * features/dashboard/hooks/use-daily-checkin.ts,
 * features/journal/components/journal-entry-editor.tsx,
 * features/journal/components/journal-page.tsx,
 * features/journal/components/journal-sidebar.tsx,
 * features/journal/hooks/use-journal-entries.ts) — all of which were
 * hand-rolled duplicates of getLocalDateString.
 */
declare function todayKey(date?: Date): string;
/**
 * ISO-8601 week key, e.g. "2026-W32". Extracted from
 * dw-time-web/src/features/goals/hooks/use-goal-reflection.ts, which had it
 * trapped as a module-local helper.
 */
declare function getISOWeekKey(d?: Date): string;
declare const DAYS_OF_WEEK: readonly ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
declare const DAYS_OF_WEEK_FULL: readonly ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

declare function getReportingWeekDates(date?: Date): {
    start: Date;
    end: Date;
    days: Date[];
};

declare const DAY_START_MIN = 0;
declare const DAY_END_MIN: number;

/**
 * Percentage of a target that has been logged so far, clamped to [0, 100]
 * and rounded to the nearest whole percent. Returns 0 when target is 0 or
 * negative (avoids Infinity/NaN from a divide-by-zero).
 */
declare function calculateProgressPercent(logged: number, target: number): number;

/**
 * Build an absolute UTC instant from a "YYYY-MM-DD" date + "HH:mm" time,
 * interpreted as wall-clock time in `timezone`.
 *
 * Replaces buildLocalDateFromParts, which implicitly used the process's own
 * local timezone (`new Date(year, month, day, hours, minutes)`) — correct
 * only when the process happens to be running in the same zone the
 * schedule was authored in.
 */
declare function buildZonedDateFromParts(dateString: string, timeString: string | undefined, timezone: string): Date;
/**
 * Find the schedule block active at `now` (an absolute instant), given the
 * schedule was configured for wall-clock times in `timezone`.
 *
 * Replaces findScheduleBlockForDateTime.
 */
declare function resolveActiveBlock(weekSchedule: WeekSchedule | undefined, now: Date, timezone: string): ScheduleBlock | null;
interface UpcomingScheduleBlock {
    block: ScheduleBlock;
    /** Absolute UTC instant the block starts, correct across DST in `timezone`. */
    startsAtUtc: Date;
}
/**
 * Walk forward from `now` and collect the next `count` upcoming blocks
 * across up to 7 days, given the schedule was configured for wall-clock
 * times in `timezone`.
 *
 * Replaces findUpcomingScheduleBlocks. Calendar-day advancement is done on
 * plain (year, month, day) fields — not by adding 24h*offset to the UTC
 * instant — so it can't drift by an hour across a DST boundary in
 * `timezone` before the day/time fields are re-anchored via
 * buildZonedDateFromParts.
 */
declare function findUpcomingScheduleBlocks(weekSchedule: WeekSchedule | undefined, now: Date, timezone: string, count: number): UpcomingScheduleBlock[];
/** Replaces findNextScheduleBlock — thin wrapper for callers that want just one. */
declare function findNextScheduleBlock(weekSchedule: WeekSchedule | undefined, now: Date, timezone: string): UpcomingScheduleBlock | null;

/** Horizontal pixels per depth level. Also the snap width for the indent
 *  gesture — Math.round(offset / width) — so it needs to be wide enough to
 *  beat pointer jitter but narrow enough that one comfortable wrist (or
 *  thumb) move changes a level. */
declare const INDENTATION_WIDTH = 24;
interface FlatNote extends Note {
    depth: number;
    /** Direct children in the FULL tree (drives the chevron), not just visible ones. */
    childCount: number;
    /** Total descendants in the full tree (drag-overlay badge). */
    descendantCount: number;
}
interface NoteProjection {
    depth: number;
    maxDepth: number;
    minDepth: number;
    parentId: string | null;
    /** Id of the VISIBLE row the note lands directly below (null = very
     *  top of the tree). Single source of truth for the drop indicator
     *  and the reorder payload, including smart-outdent hops. */
    insertAfterId: string | null;
}
/**
 * Build the tree from the flat GET /notes rows. Depths are assigned by
 * walking down from the roots (NOT during the linking pass, which was
 * order-dependent), and parentId cycles are broken deterministically: any
 * note unreachable from a root is re-rooted and duplicate links are
 * pruned, so bad data renders as a flat entry instead of vanishing or
 * recursing forever.
 */
declare function buildNoteTree(notes: Note[]): NoteTreeItem[];
/**
 * Flatten the tree to the list of VISIBLE rows: children of collapsed
 * nodes are skipped, and while a drag is active the dragged note's
 * children are skipped too (the subtree "tucks in" behind the drag
 * overlay and follows the parent to wherever it lands).
 */
declare function flattenVisibleTree(tree: NoteTreeItem[], collapsedIds: Set<string>, activeId: string | null): FlatNote[];
/**
 * The heart of the pattern. Given the visible list, the dragged id,
 * the row currently hovered (vertical slot) and the horizontal drag
 * offset, compute where the note would land: its depth (clamped to
 * the legal range implied by the rows above and below the slot), the
 * parent that depth resolves to, and the visible row it lands below.
 *
 *   maxDepth = depth of the row above + 1  (deepest legal: its first child)
 *   minDepth = depth of the row below      (can't outdent past what's underneath)
 *
 * Smart outdent: when the requested depth is shallower than the row
 * below the slot allows (e.g. dragging a middle child left while its
 * later siblings sit underneath), the slot hops DOWN past the deeper
 * block to the first legal position — so "drag left" always reads as
 * "make me a sibling of my parent, after this subtree" instead of
 * silently clamping. This is what OneNote/Workflowy users expect.
 */
declare function getProjection(items: FlatNote[], activeId: string, overId: string, dragOffset: number, indentationWidth: number): NoteProjection;
/**
 * Turn a finished drag into the `PUT /notes/reorder` payload: the
 * destination parent's children, renumbered on the sparse *1000 scale
 * with the dragged note spliced in at the projected slot. Descendants
 * of the dragged note are NOT in the payload — they follow their
 * parent automatically via parentId.
 *
 * The anchor comes straight from the projection's insertAfterId: the
 * visible row above the insertion line. Walking up its parent chain
 * to the projected parent's direct child gives the sibling the note
 * lands after (the row above may be arbitrarily deep inside that
 * sibling's subtree).
 *
 * Returns null when the drop is a no-op (same parent, same sequence).
 */
declare function buildReorderPayload(allNotes: Note[], activeId: string, projected: NoteProjection): NoteReorderItem[] | null;

declare function sortMessages(messages: MessagingThreadMessage[]): MessagingThreadMessage[];
/**
 * Inserts or replaces one message.
 *
 * Matching order matters: `clientId` is checked first so the server's echo
 * lands *on top of* the optimistic bubble (same position, no duplicate, no
 * flicker) rather than beside it. A server row without a matching clientId
 * falls back to id matching, which is what makes a socket push idempotent.
 */
declare function upsertMessage(existing: MessagingThreadMessage[], incoming: MessagingThreadMessage): MessagingThreadMessage[];
/**
 * Reconciles a message delivered over the LIVE SOCKET specifically — the one
 * case `upsertMessage`'s own clientId matching can never catch on its own.
 *
 * `upsertMessage`'s clientId branch only fires when the INCOMING item is
 * itself pending-shaped (has a clientId). A message arriving over the socket
 * is always a plain, server-confirmed `MessagingMessage` — it was never
 * pending on THIS device, so it never carries the clientId the optimistic
 * bubble was keyed by, and jiffy-messaging's broadcast payload doesn't echo
 * one back either (there is no idempotency key on the wire at all). Matched
 * purely by `upsertMessage`'s id fallback, a socket push for the sender's
 * OWN just-sent message can't find the pending bubble (different ids) and
 * gets appended as a second, separate entry — visible for the moment between
 * the socket push and the POST response finishing, which is what turned one
 * sent message into three renders (sending, a second "sending"-looking
 * bubble alongside it, then the REST response's `confirmPendingMessage`
 * collapsing them back to one).
 *
 * The fix is a client-side heuristic, not a protocol change: when the
 * incoming message's sender is the current user, look for a still-pending
 * bubble with the identical body and treat that as the match — the same
 * "this is my own message coming back to me" case `confirmPendingMessage`
 * already handles for the REST path, just recognised by content instead of
 * an id neither side has yet. A message from anyone else has no pending
 * bubble to find and falls straight through to a plain `upsertMessage`.
 */
declare function reconcileIncomingMessage(existing: MessagingThreadMessage[], incoming: MessagingMessage, currentUserId: string | null | undefined): MessagingThreadMessage[];
/**
 * Replaces the optimistic bubble identified by `clientId` with the row the
 * server created. Separate from `upsertMessage` because the ids differ: the
 * pending copy is keyed by clientId and the confirmed one by the server's id,
 * so a plain upsert would leave both.
 */
declare function confirmPendingMessage(existing: MessagingThreadMessage[], clientId: string, confirmed: MessagingMessage): MessagingThreadMessage[];
/** Drops an optimistic bubble outright — the rollback half of a failed send. */
declare function removePendingMessage(existing: MessagingThreadMessage[], clientId: string): MessagingThreadMessage[];
/** Marks an optimistic bubble failed (or queued) in place, keeping it on screen. */
declare function markPendingMessage(existing: MessagingThreadMessage[], clientId: string, status: PendingMessagingMessage['status']): MessagingThreadMessage[];
/**
 * Folds a live message into the conversation list so the list reorders and
 * re-previews without a refetch.
 *
 * Returns the input array unchanged when the conversation isn't in the list —
 * a message for an unknown conversation means the list itself is stale (the
 * other person just opened a new thread), which is a refetch, not a patch we
 * can invent participants for.
 */
declare function applyMessageToConversations(conversations: MessagingConversation[], message: MessagingMessage): MessagingConversation[];
/**
 * Writes a local `lastReadAt` for the signed-in user so the unread dot clears
 * the instant the thread opens, rather than after the next list refetch.
 */
declare function applyReadReceipt(conversations: MessagingConversation[], conversationId: string, userId: string, readAt: string): MessagingConversation[];
/**
 * Merges a page of older history under the messages already held.
 *
 * `before`-paged history and live pushes arrive on independent paths, so the
 * page can legitimately overlap what's on screen. Deduping by id (server rows
 * only ever carry ids) and re-sorting is cheaper and far more robust than
 * trying to reason about cursor boundaries.
 */
declare function mergeOlderMessages(existing: MessagingThreadMessage[], older: MessagingMessage[]): MessagingThreadMessage[];
/** ISO timestamp of the oldest message held, i.e. the next `before` cursor. */
declare function oldestMessageTimestamp(messages: MessagingThreadMessage[]): string | undefined;
/**
 * Folds a freshly fetched page of server messages into what's already held,
 * KEEPING any optimistic messages.
 *
 * This is the one that stops a real bug: a refetch (screen focus, app resume,
 * pull-to-refresh) replaces the query's data wholesale, and a message the
 * user sent while offline lives only in that cache until the outbox drains.
 * Without this, coming back to a thread makes their queued message vanish —
 * and it will still be sent later, so it reappears minutes afterwards.
 *
 * History that has been paged in is also preserved: the fetch returns only
 * the newest page, so a plain replace would silently collapse a thread the
 * user had scrolled back through.
 */
declare function mergeServerMessages(previous: MessagingThreadMessage[] | undefined, incoming: MessagingMessage[]): MessagingThreadMessage[];
/**
 * Newest CONFIRMED message in a thread, for a conversation-list preview.
 *
 * Pending ones are excluded deliberately. A row's preview and unread state
 * are both statements about what the server holds, and an optimistic bubble
 * that later fails would otherwise leave the list showing a message that was
 * never sent.
 *
 * Exists because the conversation list can't rely on the service populating
 * `lastMessage` — where it doesn't, a thread the user has already opened is
 * still cached locally and can supply the preview.
 */
declare function newestServerMessage(messages: MessagingThreadMessage[] | undefined): MessagingMessage | undefined;

/** The user half of a SharedAccess row, as the API selects it. */
interface SharingPeer {
    id: string;
    email: string;
    name: string | null;
    avatar?: string | null;
}
/** GET /sharing/my-shares — people the signed-in user shared their data with. */
interface OutgoingShare {
    id: string;
    /**
     * Null while an emailed invite is outstanding: the row exists, but no
     * GoalSlot account is attached to it yet. Those can't be messaged, and
     * `buildMessagingContacts` drops them.
     */
    sharedWith: SharingPeer | null;
    isAccepted?: boolean;
}
/** GET /sharing/shared-with-me — people who shared their data with the signed-in user. */
interface IncomingShare {
    id: string;
    ownerId: string;
    owner: SharingPeer;
}
declare function createSharingApi(api: AxiosInstance): {
    getMyShares: () => Promise<axios.AxiosResponse<OutgoingShare[], any, {}, any>>;
    getSharedWithMe: () => Promise<axios.AxiosResponse<IncomingShare[], any, {}, any>>;
    /**
     * A mentee's time entries, for the accepted share `ownerId` granted the
     * caller. Same shape the caller's own `/time-entries/range` returns
     * (goal/task are the same reduced projections), so the Reports screen's
     * existing aggregation helpers work unmodified against this response —
     * see apps/mobile's mentee/[id] screen. 403s server-side if the share
     * was revoked or never accepted; nothing here re-checks that client-side.
     */
    getSharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
    /** A mentee's goals, for the accepted share `ownerId` granted the caller. */
    getSharedUserGoals: (ownerId: string) => Promise<axios.AxiosResponse<Goal[], any, {}, any>>;
};
type SharingApi = ReturnType<typeof createSharingApi>;

declare function buildMessagingContacts(outgoing?: OutgoingShare[], incoming?: IncomingShare[]): MessagingContact[];
/** Index for joining a bare participant id to a name at render time. */
declare function contactsByUserId(contacts: MessagingContact[]): Record<string, MessagingContact>;
/**
 * Everyone in the directory who doesn't already have a conversation — what
 * the "new conversation" picker should offer. Someone you're already talking
 * to belongs in the list you came from, not in the new-thread picker.
 *
 * Note that this deliberately does NOT drop `messageable: false` people.
 * They have no conversation and can't yet have one, so the picker is the
 * only surface where they exist at all; showing them greyed with a reason is
 * the entire point of that flag. Filtering here would reintroduce the empty
 * list this flag was added to prevent.
 */
declare function contactsWithoutConversation(contacts: MessagingContact[], existingCounterpartIds: Iterable<string>): MessagingContact[];

/** The subset of the WebSocket API this uses — keeps the fake in tests small. */
interface MessagingSocketLike {
    close: (code?: number, reason?: string) => void;
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
}
interface MessagingSocketConfig {
    /** Origin of the messaging service's WebSocket, e.g. "wss://messaging.goalslot.io". Undefined disables the socket. */
    getWsUrl: () => string | undefined;
    /** Mints/returns the messaging JWT. `forceRefresh` after an auth-looking close. */
    getToken: (options?: {
        forceRefresh?: boolean;
    }) => Promise<string>;
    /** Called for every well-formed push. */
    onMessage: (message: MessagingMessage) => void;
    onStatusChange?: (status: MessagingSocketStatus) => void;
    /** Connectivity gate — the app's existing NetInfo-backed check. */
    isOnline?: () => boolean;
    /** Injectable constructor, for tests. Defaults to the global WebSocket. */
    createSocket?: (url: string) => MessagingSocketLike;
    /** Injectable timers, for tests. */
    setTimeoutImpl?: (handler: () => void, timeoutMs: number) => unknown;
    clearTimeoutImpl?: (handle: unknown) => void;
    /** Injectable randomness for the reconnect jitter, for tests. */
    random?: () => number;
}
interface MessagingSocket {
    connect: () => void;
    disconnect: () => void;
    getStatus: () => MessagingSocketStatus;
}
/**
 * Narrows an arbitrary parsed payload to a message. The socket is a network
 * boundary: a malformed frame (a service-side ping, a future event type, a
 * proxy injecting something) must be dropped, not written into the cache as a
 * bubble with `undefined` for a body.
 */
declare function parseIncomingMessage(raw: unknown): MessagingMessage | null;
/**
 * `wss://host` -> `wss://host/?token=...`, matching the service's documented
 * handshake URL. Exported for the test, because getting this subtly wrong
 * (a missing slash, a `&` where a `?` belongs) fails as a 400 on the upgrade
 * with no clue as to which half is at fault.
 */
declare function buildSocketUrl(wsUrl: string, token: string): string;
/** Full jitter: a random point in [0, exponential delay]. */
declare function reconnectDelayMs(attempt: number, random?: () => number): number;
declare function createMessagingSocket(config: MessagingSocketConfig): MessagingSocket;

interface MessagingTokenStoreConfig {
    /** Calls POST /messaging/token on GoalSlot's API. */
    fetchToken: () => Promise<MessagingTokenResponse>;
    /**
     * Assumed lifetime when the server doesn't send `expiresAt`. Short enough
     * that a rotated signing key self-heals within a minute or two, long enough
     * that a chat session isn't re-minting constantly.
     */
    defaultTtlMs?: number;
    /**
     * Refresh this long before the stated expiry, so a token doesn't die
     * mid-flight on a slow connection.
     */
    skewMs?: number;
    /** Injectable for tests. */
    now?: () => number;
}
interface MessagingTokenStore {
    getToken: (options?: {
        forceRefresh?: boolean;
    }) => Promise<string>;
    /** Drops the cached token. Called on sign-out — it belongs to one account. */
    clear: () => void;
    /** The current token without minting one, for the WebSocket URL builder. */
    peek: () => string | null;
}
declare function createMessagingTokenStore(config: MessagingTokenStoreConfig): MessagingTokenStore;

declare function findParticipant(conversation: MessagingConversation, userId: string): MessagingParticipant | undefined;
/** The other side of a 1:1 conversation. Undefined for a self-thread. */
declare function findCounterpart(conversation: MessagingConversation, currentUserId: string): MessagingParticipant | undefined;
declare function lastReadAtFor(conversation: MessagingConversation, userId: string): number;
/**
 * `latestMessage` is passed in rather than read off `conversation.lastMessage`
 * because the service doesn't promise that field — the caller supplies
 * whichever it actually has (the list's `lastMessage`, or the newest message
 * held in the thread cache).
 */
declare function isConversationUnread(conversation: MessagingConversation, currentUserId: string, latestMessage: MessagingMessage | null | undefined): boolean;
/** How many conversations in the list are unread — for a nav badge. */
declare function countUnreadConversations(conversations: MessagingConversation[], currentUserId: string): number;

interface TokenStorage {
    getAccessToken(): Promise<string | null>;
    getRefreshToken(): Promise<string | null>;
    setTokens(access: string, refresh: string): Promise<void>;
    clear(): Promise<void>;
}
interface ApiClientConfig {
    /** Origin only, e.g. "https://api.goalslot.io" — the client appends "/api". */
    baseUrl: string;
    storage: TokenStorage;
    /**
     * Called when the refresh-token flow definitively fails (no refresh token,
     * or the refresh request itself comes back 401/403). The web app used to
     * hard-redirect to `/login` here; this package just reports the event and
     * lets the app layer decide how to navigate.
     */
    onSessionExpired: () => void;
    /** Optional user-facing toast/snackbar hook for non-fatal notices. */
    notify?: (message: string) => void;
    /**
     * fetch implementation used only by the Coach chat SSE stream (see
     * api/coach.ts) — everything else goes through axios. Defaults to the
     * environment's global `fetch`, which is correct for web (browser fetch
     * streams response bodies fine) but WRONG for React Native: Hermes'
     * built-in `fetch` cannot read `response.body` as a stream. The mobile
     * app must pass `expo/fetch`'s fetch explicitly (cast to this type at
     * that call site — RN's TS lib set doesn't include "DOM", so the two
     * types aren't structurally checked against each other, just trusted).
     */
    fetchImpl?: typeof fetch;
}

type CoachMessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM_NARRATIVE';
interface CoachMessageDto {
    id: string;
    scopeKey: string;
    role: CoachMessageRole;
    content: string;
    promptTokens?: number | null;
    completionTokens?: number | null;
    model?: string | null;
    createdAt: string;
}
/** One `data: {...}` SSE frame from a NestJS @Sse() coach endpoint. */
interface CoachStreamChunk {
    delta: string;
    done: boolean;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
    error?: string;
}
type CoachProposalActionType = 'RENAME_GOAL' | 'UPDATE_GOAL' | 'CREATE_GOAL' | 'DELETE_GOAL' | 'CREATE_SCHEDULE_BLOCK' | 'UPDATE_SCHEDULE_BLOCK' | 'DELETE_SCHEDULE_BLOCK' | 'CREATE_TIME_ENTRY' | 'UPDATE_TIME_ENTRY' | 'DELETE_TIME_ENTRY' | 'CREATE_TASK' | 'UPDATE_TASK' | 'DELETE_TASK' | 'CREATE_PRACTICE' | 'START_TIMER' | 'STOP_TIMER' | 'APPEND_JOURNAL_ENTRY' | 'APPEND_NOTE_CONTENT';
/**
 * Runtime source-of-truth for the action types the API accepts (mirrors
 * dw-time-api's COACH_ACTION_TYPES in
 * coach-proposals/dto/apply-proposals.dto.ts). Used to validate/normalize
 * proposals the model emits before they're ever shown or applied.
 *
 * This array and the union above are separate declarations — adding a type to
 * only one of them fails in a different way each time (type-only vs runtime
 * validation), so always change both. A type the API emits but this array
 * omits is dropped by normalizeCoachActionType before the user ever sees it.
 */
declare const COACH_PROPOSAL_ACTION_TYPES: readonly CoachProposalActionType[];
interface CoachProposalAction {
    type: CoachProposalActionType;
    id?: string;
    payload?: Record<string, unknown>;
    /**
     * For UPDATE_SCHEDULE_BLOCK/DELETE_SCHEDULE_BLOCK: the block's title as the
     * Coach currently believes it to be, BEFORE this action's changes are
     * applied — mirrors `expectedTitle` on the API's `CoachProposedAction` DTO
     * (goal-slot-api/src/modules/coach-proposals/dto/apply-proposals.dto.ts).
     * The backend requires the model to set this whenever the user identified
     * the target block by name, purely as an identity check; the UI reuses it
     * to describe an id-only action (e.g. "move it 30 minutes later") without
     * a raw id or a cache lookup that might miss.
     */
    expectedTitle?: string;
}
interface CoachProposalResult {
    index: number;
    type: CoachProposalActionType;
    ok: boolean;
    resultId?: string;
    error?: string;
}
interface CoachProposalBlock {
    summary?: string;
    actions: CoachProposalAction[];
}
/**
 * What the endpoint can classify a transcript as. Deliberately a wider set
 * than Tier 1's `VoiceIntentType` (../voice/intent.ts): this endpoint also
 * recognises journal, task/goal creation, and day-summary questions that the
 * local rule table never attempts, plus the catch-all CHAT/UNKNOWN that mean
 * "let the full Coach handle this".
 */
declare const COACH_VOICE_INTENT_TYPES: readonly ["START_TRACKING", "STOP_TRACKING", "PAUSE", "RESUME", "APPEND_NOTE", "APPEND_JOURNAL", "CREATE_TASK", "CREATE_GOAL", "DAY_QUERY", "CHAT", "UNKNOWN"];
type CoachVoiceIntentType = (typeof COACH_VOICE_INTENT_TYPES)[number];
interface CoachVoiceIntentCandidateGoal {
    id: string;
    title: string;
}
interface CoachVoiceIntentCandidateTask {
    id: string;
    title: string;
    goalId?: string;
}
/** What the caller already knows about the timer, so the model doesn't have to guess whether "stop" makes sense right now. */
type CoachVoiceIntentTimerStatus = 'idle' | 'running' | 'paused';
interface CoachVoiceIntentContext {
    candidateGoals: readonly CoachVoiceIntentCandidateGoal[];
    candidateTasks: readonly CoachVoiceIntentCandidateTask[];
    timerStatus: CoachVoiceIntentTimerStatus;
}
/**
 * The one target shape the endpoint ever resolves to. Deliberately narrower
 * than Tier 1's `TargetKind` (../voice/intent.ts, which also has 'category'
 * and 'note'): the request context above only ever supplies goal/task
 * candidates, so the model has nothing to match a note against and a 'note'
 * kind could never come back populated. A caller that gets APPEND_NOTE back
 * with a null target should treat it exactly like an unresolved local
 * match — hand off rather than guess which page was meant.
 */
interface CoachVoiceIntentTarget {
    kind: 'goal' | 'task';
    id: string;
}
interface CoachVoiceIntentResponse {
    intent: CoachVoiceIntentType;
    /** 'low' means "don't act on this without confirming" — same spirit as Tier 1's confidence score, collapsed to two buckets since this is a classification, not a fuzzy string match. */
    confidence: 'high' | 'low';
    target: CoachVoiceIntentTarget | null;
    /** The words to act on — a note/journal paragraph, a task/goal title. Null when the intent carries no text of its own (e.g. STOP_TRACKING). */
    text: string | null;
    /** Human-readable, for logs/debugging — never shown to the end user. */
    reasoning: string;
}
declare function createCoachApi(api: AxiosInstance): {
    getChatHistory: (scopeKey: string) => Promise<{
        data: CoachMessageDto[];
        status: number;
        statusText: string;
        headers: axios.AxiosResponseHeaders | Partial<axios.RawAxiosHeaders & {
            "Content-Type": axios.AxiosHeaderValue;
            Server: axios.AxiosHeaderValue;
            "Content-Length": axios.AxiosHeaderValue;
            "Cache-Control": axios.AxiosHeaderValue;
            "Content-Encoding": axios.AxiosHeaderValue;
            "content-type": axios.AxiosHeaderValue;
            server: axios.AxiosHeaderValue;
            "content-length": axios.AxiosHeaderValue;
            "cache-control": axios.AxiosHeaderValue;
            "content-encoding": axios.AxiosHeaderValue;
        } & {
            'set-cookie': string[];
        }>;
        config: axios.InternalAxiosRequestConfig<any, any>;
        request?: any;
    }>;
    clearChatHistory: (scopeKey: string) => Promise<axios.AxiosResponse<{
        success: true;
    }, any, {}, any>>;
    applyProposals: (actions: CoachProposalAction[], sourceMessageId?: string) => Promise<axios.AxiosResponse<{
        results: CoachProposalResult[];
    }, any, {}, any>>;
    voiceIntent: (transcript: string, context: CoachVoiceIntentContext) => Promise<axios.AxiosResponse<CoachVoiceIntentResponse, any, {}, any>>;
};
type CoachApi = ReturnType<typeof createCoachApi>;
/**
 * Stream NestJS @Sse() responses framed as `data: {...}\n\n`. Ported
 * verbatim (frame-buffering logic unchanged) from
 * dw-time-web/src/lib/api.ts's parseCoachSseStream. Handles partial frames
 * straddling chunk boundaries by holding an accumulating buffer and only
 * consuming up to the last `\n\n`, and tolerates `\r\n` line endings.
 *
 * Generic over the standard `Response` type rather than anything
 * axios-specific, so both web (`fetch`) and mobile (`expo/fetch`) can hand
 * in whatever their fetch implementation returns.
 */
declare function parseCoachSseStream(response: Response, signal?: AbortSignal): AsyncGenerator<CoachStreamChunk, void, void>;
interface CoachStreamRequestConfig {
    /** Origin only, e.g. "https://api.goalslot.io" — "/api" is appended. */
    baseUrl: string;
    /**
     * A fetch-like function. Must return a Response whose `.body` supports
     * `getReader()` (browser fetch and `expo/fetch` both qualify; Hermes'
     * built-in `fetch` on React Native does NOT — see apps/mobile's
     * api-client.ts for why it passes `expo/fetch` explicitly instead of the
     * RN global).
     */
    fetchImpl: typeof fetch;
    getAccessToken: () => Promise<string | null>;
}
/**
 * POST a Coach SSE endpoint (chat today; narrative would use the same
 * helper) and return the parsed delta stream. Ported from web's
 * postCoachStream, generalized to take its baseUrl/fetch/token dependencies
 * as an explicit config object instead of reading module-level
 * `API_BASE_URL`/`localStorage` — this package has no module-level app
 * config or DOM storage to read.
 */
declare function postCoachStream(config: CoachStreamRequestConfig, path: string, body: unknown, signal?: AbortSignal): Promise<AsyncGenerator<CoachStreamChunk, void, void>>;
/**
 * The scopeKey the Coach chat/narrative endpoints use for "the current
 * week" — "YYYY-Www" (ISO week). Ported from web's currentScopeKey('week')
 * in coach-page.tsx; the API's isoWeekRange() parser
 * (coach-ai.service.ts) expects exactly this shape. Only the week period is
 * ported — web also supports month/quarter/year scopes via a period picker,
 * which the mobile chat doesn't expose in this first pass (chat always
 * targets the current week, matching how a phone-sized chat screen has no
 * room for a scope switcher yet).
 *
 * Thin wrapper over `../scheduling/time`'s `getISOWeekKey` — same ISO-week
 * math, kept as its own named export here (rather than every Coach call site
 * importing `getISOWeekKey` directly) because "current scope key" is a
 * Coach-domain concept and the two previously drifted into two copies of the
 * same six-line algorithm before this was consolidated.
 */
declare function currentCoachWeekScopeKey(now?: Date): string;

/** Uppercase on the wire, matching dw-time-api's SaveByokKeyDto. */
type CoachByokProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OPENROUTER';
interface CoachByokState {
    status: 'unset' | 'active';
    provider?: CoachByokProvider | null;
    /** e.g. `sk-...4f2a`. The full key is never returned by the API once stored. */
    maskedKey?: string | null;
    tokensUsed?: number | null;
    tokensLimit?: number | null;
    selectedModel?: string | null;
    /** Server-side whitelist. Populate any model picker from this, never a hardcoded list. */
    allowedModels?: string[];
    /** What the coach will actually use — `selectedModel`, or the provider's default. */
    effectiveModel?: string | null;
    /** Operator-funded key that lets someone try the coach before bringing their own. */
    shared?: {
        available: boolean;
        used: number;
        limit: number;
    };
}
interface CoachByokUsage {
    tokensUsed: number;
    tokensLimit: number;
    windowStart: string;
}
interface CoachByokProviderMeta {
    provider: CoachByokProvider;
    label: string;
    /** Every key this provider issues starts with this. Checked before we send. */
    keyPrefix: string;
    /** Where the user goes to mint a key. */
    consoleUrl: string;
    /** One line of "how do I get one of these". */
    howTo: string;
}
/**
 * Ordered free-tier-first, matching web's provider switcher: someone with no
 * key at all is best served by the one they can get without a card.
 */
declare const COACH_BYOK_PROVIDERS: readonly CoachByokProviderMeta[];
declare function coachByokProviderMeta(provider: CoachByokProvider): CoachByokProviderMeta;
/** Server-side bounds on the monthly token budget (dw-time-api's `@Min`/`@Max`). */
declare const COACH_BYOK_MIN_TOKEN_BUDGET = 1000;
declare const COACH_BYOK_MAX_TOKEN_BUDGET = 100000000;
/**
 * The same local checks the API performs before it encrypts and stores a key
 * (`assertPrefixMatches` + a min length of 8), run client-side so a typo
 * costs a render rather than a round trip.
 *
 * Note what this is NOT: there is no "test this key" endpoint. The API never
 * calls the provider at save time, so a well-formed key for a cancelled
 * account still saves successfully and only fails later, in the chat.
 *
 * Returns `null` when the key looks acceptable, or a user-facing reason.
 */
declare function validateCoachByokKey(provider: CoachByokProvider, rawKey: string): string | null;
/**
 * Normalises the budget field's free text. Users paste `1,000,000` and
 * `1_000_000` as readily as `1000000`, and both parse to `1` under a bare
 * `Number()` on the first comma.
 *
 * Returns `null` when the input isn't a usable budget.
 */
declare function parseCoachByokBudget(input: string): number | null;
/**
 * Human-readable token count for a budget or a usage figure: `375k`, `1.2M`.
 *
 * Budgets are six- and seven-digit numbers, and `250000` vs `2500000` is a
 * factor-of-ten difference that a glance at the digits genuinely misreads.
 */
declare function formatCoachTokenCount(value: number): string;
/**
 * Whether a Coach failure is specifically "your BYOK monthly token budget is
 * spent", as opposed to any other reason the coach declined to answer.
 *
 * WHY THIS MATCHES ON THE MESSAGE, which is normally the wrong thing to do:
 * the API raises this as an `HttpException(429, { message: 'Monthly token
 * budget exceeded', tokensUsed, tokensLimit })` — but it raises it from
 * *inside* the async generator that backs the `@Sse()` chat endpoint. The
 * controller's `asSseObservable` bridge catches everything the generator
 * throws and re-emits it as a terminal SSE frame, `{ delta: '', done: true,
 * error: <message> }`, on a response whose status line was already sent as
 * 200. By the time the client sees it, the status code, the error code and
 * the `tokensUsed`/`tokensLimit` fields are all gone: a bare string is the
 * entire wire signal that survives. (See goal-slot-api
 * `coach-ai.controller.ts#asSseObservable` and
 * `coach-ai.service.ts#assertWithinBudget`.)
 *
 * So the string is matched deliberately loosely — "token budget" plus an
 * exhaustion word — rather than by equality, so a server-side reword of the
 * sentence doesn't silently turn the affordance off. Two things it must
 * never match, and there are tests for both:
 *
 *   - The shared-key ceiling ('Shared Coach daily limit reached...'), which
 *     is a different user in a different situation: they have no budget to
 *     raise, they need to add a key of their own.
 *   - A genuine HTTP 429 from the request throttler (30 messages/day), which
 *     carries no budget wording at all and is fixed by waiting, not paying.
 *
 * Accepts the raw SSE `chunk.error` string, or a thrown error/axios-style
 * object — the latter so this keeps working unchanged if the API ever moves
 * the check in front of the stream and it starts arriving as a real 429.
 */
declare function isCoachBudgetExceededError(input: unknown): boolean;
interface CoachBudgetIncrement {
    /** How much bigger than the current budget, e.g. 50 for "+50%". */
    percent: number;
    /** The absolute budget to PATCH — already rounded and clamped to the API's bounds. */
    tokensLimit: number;
}
/** The one-tap steps offered when the coach stops on a spent budget. */
declare const COACH_BUDGET_INCREMENT_PERCENTS: readonly number[];
/**
 * Turn "the budget is 250k and it's gone" into the two or three absolute
 * numbers a user can pick between without doing arithmetic.
 *
 * Rounded UP to a readable step (nobody wants a 187,500-token budget) and
 * clamped to the server's `@Min`/`@Max`, so every option here is a value the
 * PATCH will actually accept. Options that collapse onto each other at the
 * ceiling are de-duplicated, and once the budget IS the ceiling the list is
 * empty — the caller should then say so rather than offer a no-op button.
 *
 * `current` tolerates null/0 (a state where the API hasn't told us the
 * budget yet) by treating the minimum as the base, so the sheet still
 * renders something tappable instead of a row of zeroes.
 */
declare function coachBudgetIncrements(current: number | null | undefined, percents?: readonly number[]): CoachBudgetIncrement[];
type CoachReligiousContext = 'NONE' | 'ISLAM' | 'CHRISTIANITY' | 'HINDUISM' | 'BUDDHISM' | 'JUDAISM' | 'SECULAR' | 'OTHER';
declare const COACH_RELIGIOUS_CONTEXTS: readonly {
    value: CoachReligiousContext;
    label: string;
}[];
/**
 * Every field is optional because the API returns a defaults object with no
 * `id` (and, on a profile that has never been saved, no `religiousContext`
 * and no `spiritualNotes` either — see coach-profile.service.ts's
 * PROFILE_DEFAULTS). Treat absence as "not set", never as a value.
 */
interface CoachHabitsProfile {
    id?: string;
    userId?: string;
    why?: string;
    phoneBlockerInstalled?: boolean;
    distractingSubsCancelled?: boolean;
    websiteBlockerUrls?: string;
    sleepTargetHours?: number;
    bedtime?: string;
    wakeTime?: string;
    workEnvironment?: string;
    additionalContext?: string;
    religiousContext?: CoachReligiousContext;
    spiritualNotes?: string;
    createdAt?: string;
    updatedAt?: string;
}
type UpsertCoachHabitsProfile = Omit<CoachHabitsProfile, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
declare function createCoachSettingsApi(api: AxiosInstance): {
    getByokKey: () => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
    saveByokKey: (data: {
        provider: CoachByokProvider;
        apiKey: string;
    }) => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
    deleteByokKey: () => Promise<axios.AxiosResponse<{
        success: boolean;
    }, any, {}, any>>;
    getByokUsage: () => Promise<axios.AxiosResponse<CoachByokUsage, any, {}, any>>;
    setByokModel: (model: string) => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
    setByokBudget: (tokensLimit: number) => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
    getHabitsProfile: () => Promise<axios.AxiosResponse<CoachHabitsProfile, any, {}, any>>;
    updateHabitsProfile: (data: UpsertCoachHabitsProfile) => Promise<axios.AxiosResponse<CoachHabitsProfile, any, {}, any>>;
};
type CoachSettingsApi = ReturnType<typeof createCoachSettingsApi>;

interface AppNotification {
    id: string;
    type: string;
    title: string;
    body: string | null;
    data: Record<string, unknown> | null;
    readAt: string | null;
    createdAt: string;
}
interface NotificationListParams {
    cursor?: string;
    limit?: number;
}
/**
 * `unreadCount` is a snapshot of the FULL unread total (not just this page)
 * as of this request — every page carries it, which is what lets a screen
 * or a bell badge read it off whichever page it last fetched without a
 * separate "just the count" endpoint.
 */
interface NotificationListResponse {
    items: AppNotification[];
    nextCursor: string | null;
    hasMore: boolean;
    unreadCount: number;
}
declare function createNotificationsApi(api: AxiosInstance): {
    list: (params?: NotificationListParams) => Promise<axios.AxiosResponse<NotificationListResponse, any, {}, any>>;
    markRead: (id: string) => Promise<axios.AxiosResponse<AppNotification, any, {}, any>>;
};
type NotificationsApi = ReturnType<typeof createNotificationsApi>;

type InstructionStatus = 'PENDING' | 'DONE';
/** The reduced user projection the API embeds on `assigner`/`assignee`. */
interface InstructionPerson {
    id: string;
    name: string | null;
    email: string;
}
interface Instruction {
    id: string;
    assignerId: string;
    assigneeId: string;
    title: string;
    note: string | null;
    status: InstructionStatus;
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
interface InstructionAssignedByMe extends Instruction {
    assignee: InstructionPerson;
}
interface InstructionAssignedToMe extends Instruction {
    assigner: InstructionPerson;
}
interface AssignInstructionInput {
    /** User id of the mentee receiving the instruction — the share's `ownerId`. */
    assigneeId: string;
    title: string;
    note?: string;
}
declare function createInstructionsApi(api: AxiosInstance): {
    assign: (data: AssignInstructionInput) => Promise<axios.AxiosResponse<InstructionAssignedByMe, any, {}, any>>;
    listAssignedByMe: () => Promise<axios.AxiosResponse<InstructionAssignedByMe[], any, {}, any>>;
    listAssignedToMe: () => Promise<axios.AxiosResponse<InstructionAssignedToMe[], any, {}, any>>;
    complete: (id: string) => Promise<axios.AxiosResponse<InstructionAssignedToMe, any, {}, any>>;
};
type InstructionsApi = ReturnType<typeof createInstructionsApi>;

/** Mirrors the API's `PushSubscriptionKind` enum. */
type PushSubscriptionKind = 'WEB' | 'EXPO';
/**
 * A registered device, as returned by the register call. The `id` is the
 * only field callers actually need: it's what `unregister` takes, and
 * holding onto it is how a client can withdraw *this device's* subscription
 * on sign-out without disturbing the same user's other devices.
 */
interface PushSubscriptionResponse {
    id: string;
    userId: string;
    kind: PushSubscriptionKind;
    /** Web push only — always null for an Expo subscription. */
    endpoint: string | null;
    /** Expo only — always null for a web push subscription. */
    expoToken: string | null;
    createdAt: string;
}
declare function createPushSubscriptionsApi(api: AxiosInstance): {
    /**
     * Registers (or re-confirms) an Expo push token for the signed-in user.
     *
     * Safe to call repeatedly: the API upserts on the `userId_expoToken`
     * compound unique, so the same device re-registering on every launch
     * updates one row rather than accumulating duplicates. That's also why
     * the client-side dedupe in the mobile app is an optimisation to avoid
     * a redundant request, not a correctness requirement.
     *
     * Note the row is keyed by (user, token), so the SAME physical device
     * signed into two accounts legitimately produces two rows — one per
     * user. That is correct, and it is exactly why sign-out should call
     * `unregister` rather than leaving the previous account's row pointing
     * at a phone somebody else is now holding.
     */
    registerExpo: (expoToken: string) => Promise<axios.AxiosResponse<PushSubscriptionResponse, any, {}, any>>;
    /**
     * Removes a single subscription by id. The API scopes the delete to the
     * calling user (403 if the row belongs to somebody else) and 404s if it
     * has already gone, so callers should treat both as "already handled"
     * rather than as a failure worth surfacing.
     */
    unregister: (id: string) => Promise<axios.AxiosResponse<PushSubscriptionResponse, any, {}, any>>;
};

/** The exact header name goal-slot-api's `IdempotencyInterceptor` reads. */
declare const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
interface IdempotentRequestOptions {
    /**
     * Stable per logical operation, NOT per attempt. The same value must be
     * sent by the first live attempt and by every subsequent replay of the same
     * payload (an outbox drain, a Retry button) — that identity is the whole
     * mechanism. Omitted entirely, the request behaves exactly as it did before
     * this option existed: no header, no server-side dedupe.
     */
    idempotencyKey?: string;
}
/**
 * Builds the per-request axios config that carries an idempotency key, or
 * `undefined` when there is no key to send — so passing the result straight
 * through to `api.post(url, body, ...)` is identical to omitting the argument
 * for callers that don't supply one.
 */
declare function idempotentConfig(options?: IdempotentRequestOptions): AxiosRequestConfig | undefined;

interface UpdateProfileForm {
    name?: string;
    /** URL of an already-hosted image. There is no upload endpoint on the API. */
    avatar?: string;
}
declare function createUsersApi(api: AxiosInstance): {
    /** Same payload as `authApi.getProfile()` (`GET /auth/me`); both return `sanitizeUser(user)`. */
    getProfile: () => Promise<axios.AxiosResponse<User, any, {}, any>>;
    updateProfile: (data: UpdateProfileForm) => Promise<axios.AxiosResponse<User, any, {}, any>>;
    /**
     * Permanent and immediate — the API runs `prisma.user.delete()`, which
     * cascades to goals, tasks, time entries, journal, notes and the stored
     * BYOK key. There is no soft-delete, no grace period, and the route
     * itself asks for no re-authentication, so every bit of the confirmation
     * friction has to live in the client.
     */
    deleteAccount: () => Promise<axios.AxiosResponse<{
        success: boolean;
    }, any, {}, any>>;
};

interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}
interface LoginResponse extends AuthTokens {
    user: User;
}
declare function createAuthApi(api: AxiosInstance): {
    checkEmailExists: (email: string) => Promise<axios.AxiosResponse<any, any, {}, {
        email: string;
    }>>;
    sendOTP: (data: {
        email: string;
        purpose: "SIGNUP" | "FORGOT_PASSWORD";
    }) => Promise<axios.AxiosResponse<any, {
        email: string;
        purpose: "SIGNUP" | "FORGOT_PASSWORD";
    }, {}, any>>;
    verifyOTP: (data: {
        email: string;
        otp: string;
        purpose: "SIGNUP" | "FORGOT_PASSWORD";
    }) => Promise<axios.AxiosResponse<any, {
        email: string;
        otp: string;
        purpose: "SIGNUP" | "FORGOT_PASSWORD";
    }, {}, any>>;
    forgotPassword: (data: {
        email: string;
    }) => Promise<axios.AxiosResponse<any, {
        email: string;
    }, {}, any>>;
    resetPassword: (data: {
        email: string;
        otp: string;
        newPassword: string;
    }) => Promise<axios.AxiosResponse<any, {
        email: string;
        otp: string;
        newPassword: string;
    }, {}, any>>;
    register: (data: {
        email: string;
        password: string;
        name: string;
        otp: string;
    }) => Promise<axios.AxiosResponse<LoginResponse, any, {}, any>>;
    login: (data: {
        email: string;
        password: string;
    }) => Promise<axios.AxiosResponse<LoginResponse, any, {}, any>>;
    ssoLogin: (data: {
        token: string;
        email: string;
        name?: string;
    }) => Promise<axios.AxiosResponse<LoginResponse, any, {}, any>>;
    getProfile: () => Promise<axios.AxiosResponse<User, any, {}, any>>;
    refresh: (data: {
        refreshToken: string;
    }) => Promise<axios.AxiosResponse<AuthTokens, any, {}, any>>;
    sendChangePasswordOTP: (data: {
        currentPassword: string;
    }) => Promise<axios.AxiosResponse<any, {
        currentPassword: string;
    }, {}, any>>;
    changePassword: (data: {
        currentPassword: string;
        otp: string;
        newPassword: string;
    }) => Promise<axios.AxiosResponse<any, {
        currentPassword: string;
        otp: string;
        newPassword: string;
    }, {}, any>>;
};

declare function createApiClient(config: ApiClientConfig): {
    api: axios.AxiosInstance;
    auth: {
        checkEmailExists: (email: string) => Promise<axios.AxiosResponse<any, any, {}, {
            email: string;
        }>>;
        sendOTP: (data: {
            email: string;
            purpose: "SIGNUP" | "FORGOT_PASSWORD";
        }) => Promise<axios.AxiosResponse<any, {
            email: string;
            purpose: "SIGNUP" | "FORGOT_PASSWORD";
        }, {}, any>>;
        verifyOTP: (data: {
            email: string;
            otp: string;
            purpose: "SIGNUP" | "FORGOT_PASSWORD";
        }) => Promise<axios.AxiosResponse<any, {
            email: string;
            otp: string;
            purpose: "SIGNUP" | "FORGOT_PASSWORD";
        }, {}, any>>;
        forgotPassword: (data: {
            email: string;
        }) => Promise<axios.AxiosResponse<any, {
            email: string;
        }, {}, any>>;
        resetPassword: (data: {
            email: string;
            otp: string;
            newPassword: string;
        }) => Promise<axios.AxiosResponse<any, {
            email: string;
            otp: string;
            newPassword: string;
        }, {}, any>>;
        register: (data: {
            email: string;
            password: string;
            name: string;
            otp: string;
        }) => Promise<axios.AxiosResponse<LoginResponse, any, {}, any>>;
        login: (data: {
            email: string;
            password: string;
        }) => Promise<axios.AxiosResponse<LoginResponse, any, {}, any>>;
        ssoLogin: (data: {
            token: string;
            email: string;
            name?: string;
        }) => Promise<axios.AxiosResponse<LoginResponse, any, {}, any>>;
        getProfile: () => Promise<axios.AxiosResponse<User, any, {}, any>>;
        refresh: (data: {
            refreshToken: string;
        }) => Promise<axios.AxiosResponse<AuthTokens, any, {}, any>>;
        sendChangePasswordOTP: (data: {
            currentPassword: string;
        }) => Promise<axios.AxiosResponse<any, {
            currentPassword: string;
        }, {}, any>>;
        changePassword: (data: {
            currentPassword: string;
            otp: string;
            newPassword: string;
        }) => Promise<axios.AxiosResponse<any, {
            currentPassword: string;
            otp: string;
            newPassword: string;
        }, {}, any>>;
    };
    users: {
        getProfile: () => Promise<axios.AxiosResponse<User, any, {}, any>>;
        updateProfile: (data: UpdateProfileForm) => Promise<axios.AxiosResponse<User, any, {}, any>>;
        deleteAccount: () => Promise<axios.AxiosResponse<{
            success: boolean;
        }, any, {}, any>>;
    };
    goals: {
        getAll: (params?: {
            status?: string;
            category?: string;
            categories?: string;
            labelIds?: string;
        }) => Promise<axios.AxiosResponse<Goal[], any, {}, any>>;
        getOne: (id: string) => Promise<axios.AxiosResponse<Goal, any, {}, any>>;
        create: (data: CreateGoalInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Goal, any, {}, any>>;
        update: (id: string, data: UpdateGoalInput) => Promise<axios.AxiosResponse<Goal, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
        reorder: (ids: string[]) => Promise<axios.AxiosResponse<any, {
            ids: string[];
        }, {}, any>>;
        getStats: () => Promise<axios.AxiosResponse<GoalStats, any, {}, any>>;
    };
    notes: {
        getAll: () => Promise<axios.AxiosResponse<Note[], any, {}, any>>;
        getOne: (id: string) => Promise<axios.AxiosResponse<NoteDetailResponse, any, {}, any>>;
        create: (data: CreateNoteDto, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Note, any, {}, any>>;
        update: (id: string, data: UpdateNoteDto) => Promise<axios.AxiosResponse<Note, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
        reorder: (items: NoteReorderItem[]) => Promise<axios.AxiosResponse<any, NoteReorderItem[], {}, any>>;
    };
    pushSubscriptions: {
        registerExpo: (expoToken: string) => Promise<axios.AxiosResponse<PushSubscriptionResponse, any, {}, any>>;
        unregister: (id: string) => Promise<axios.AxiosResponse<PushSubscriptionResponse, any, {}, any>>;
    };
    tasks: {
        create: (data: CreateTaskInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
        list: (params?: TaskListFilters) => Promise<axios.AxiosResponse<Task[], any, {}, any>>;
        getOne: (id: string) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
        update: (id: string, data: UpdateTaskInput) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
        complete: (id: string, data: CompleteTaskInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
        restore: (id: string) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
        reorder: (ids: string[]) => Promise<axios.AxiosResponse<any, {
            ids: string[];
        }, {}, any>>;
    };
    schedule: {
        getAll: () => Promise<axios.AxiosResponse<ScheduleBlock[], any, {}, any>>;
        getWeekly: () => Promise<axios.AxiosResponse<WeekSchedule, any, {}, any>>;
        getByDay: (dayOfWeek: number) => Promise<axios.AxiosResponse<ScheduleBlock[], any, {}, any>>;
        create: (data: CreateScheduleBlockInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<ScheduleBlock, any, {}, any>>;
        update: (id: string, data: UpdateScheduleBlockInput) => Promise<axios.AxiosResponse<ScheduleBlock, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
        clearAll: () => Promise<axios.AxiosResponse<{
            deleted: number;
        }, any, {}, any>>;
    };
    timeEntries: {
        getByWeek: (weekStart: string) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
        getByDateRange: (startDate: string, endDate: string) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
        getToday: () => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
        getWeeklyTotal: () => Promise<axios.AxiosResponse<{
            totalMinutes: number;
        }, any, {}, any>>;
        getRecent: (params?: {
            page?: number;
            pageSize?: number;
            startDate?: string;
            endDate?: string;
            search?: string;
            goalId?: string;
        }) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
        create: (data: CreateTimeEntryInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<TimeEntry, any, {}, any>>;
        update: (id: string, data: UpdateTimeEntryInput) => Promise<axios.AxiosResponse<TimeEntry, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    };
    timerSession: {
        getActive: () => Promise<axios.AxiosResponse<ActiveTimerSession | null, any, {}, any>>;
        start: (data?: StartTimerSessionInput) => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
        pause: () => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
        resume: () => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
        update: (data: UpdateTimerSessionInput) => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
        stop: (data?: StopTimerSessionInput) => Promise<axios.AxiosResponse<StopTimerSessionResult, any, {}, any>>;
        discard: () => Promise<axios.AxiosResponse<{
            discarded: boolean;
        }, any, {}, any>>;
    };
    categories: {
        getAll: () => Promise<axios.AxiosResponse<Category[], any, {}, any>>;
        getOne: (id: string) => Promise<axios.AxiosResponse<Category, any, {}, any>>;
        create: (data: CreateCategoryForm) => Promise<axios.AxiosResponse<Category, any, {}, any>>;
        update: (id: string, data: UpdateCategoryForm) => Promise<axios.AxiosResponse<Category, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    };
    labels: {
        getAll: () => Promise<axios.AxiosResponse<Label[], any, {}, any>>;
        getOne: (id: string) => Promise<axios.AxiosResponse<Label, any, {}, any>>;
        create: (data: CreateLabelForm) => Promise<axios.AxiosResponse<Label, any, {}, any>>;
        update: (id: string, data: UpdateLabelForm) => Promise<axios.AxiosResponse<Label, any, {}, any>>;
        delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
        assignToGoal: (goalId: string, labelIds: string[]) => Promise<axios.AxiosResponse<any, {
            labelIds: string[];
        }, {}, any>>;
        getForGoal: (goalId: string) => Promise<axios.AxiosResponse<Label[], any, {}, any>>;
    };
    journal: {
        list: (params?: {
            from?: string;
            to?: string;
        }) => Promise<axios.AxiosResponse<JournalEntry[], any, {}, any>>;
        getByDate: (date: string) => Promise<axios.AxiosResponse<JournalEntry | null, any, {}, any>>;
        upsert: (data: UpsertJournalEntryInput) => Promise<axios.AxiosResponse<JournalEntry, any, {}, any>>;
        create: (data: CreateJournalEntryInput) => Promise<axios.AxiosResponse<JournalEntry, any, {}, any>>;
        update: (date: string, data: UpdateJournalEntryInput) => Promise<axios.AxiosResponse<JournalEntry, any, {}, any>>;
        delete: (date: string) => Promise<axios.AxiosResponse<{
            success: true;
        }, any, {}, any>>;
    };
    messaging: {
        issueToken: () => Promise<axios.AxiosResponse<MessagingTokenResponse, any, {}, any>>;
        createConversation: (input: CreateMessagingConversationInput) => Promise<axios.AxiosResponse<OpenMessagingConversationResponse, any, {}, any>>;
    };
    sharing: {
        getMyShares: () => Promise<axios.AxiosResponse<OutgoingShare[], any, {}, any>>;
        getSharedWithMe: () => Promise<axios.AxiosResponse<IncomingShare[], any, {}, any>>;
        getSharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
        getSharedUserGoals: (ownerId: string) => Promise<axios.AxiosResponse<Goal[], any, {}, any>>;
    };
    instructions: {
        assign: (data: AssignInstructionInput) => Promise<axios.AxiosResponse<InstructionAssignedByMe, any, {}, any>>;
        listAssignedByMe: () => Promise<axios.AxiosResponse<InstructionAssignedByMe[], any, {}, any>>;
        listAssignedToMe: () => Promise<axios.AxiosResponse<InstructionAssignedToMe[], any, {}, any>>;
        complete: (id: string) => Promise<axios.AxiosResponse<InstructionAssignedToMe, any, {}, any>>;
    };
    notifications: {
        list: (params?: NotificationListParams) => Promise<axios.AxiosResponse<NotificationListResponse, any, {}, any>>;
        markRead: (id: string) => Promise<axios.AxiosResponse<AppNotification, any, {}, any>>;
    };
    coachSettings: {
        getByokKey: () => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
        saveByokKey: (data: {
            provider: CoachByokProvider;
            apiKey: string;
        }) => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
        deleteByokKey: () => Promise<axios.AxiosResponse<{
            success: boolean;
        }, any, {}, any>>;
        getByokUsage: () => Promise<axios.AxiosResponse<CoachByokUsage, any, {}, any>>;
        setByokModel: (model: string) => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
        setByokBudget: (tokensLimit: number) => Promise<axios.AxiosResponse<CoachByokState, any, {}, any>>;
        getHabitsProfile: () => Promise<axios.AxiosResponse<CoachHabitsProfile, any, {}, any>>;
        updateHabitsProfile: (data: UpsertCoachHabitsProfile) => Promise<axios.AxiosResponse<CoachHabitsProfile, any, {}, any>>;
    };
    coach: {
        streamChat: (scopeKey: string, content: string, opts?: {
            signal?: AbortSignal;
        }) => Promise<AsyncGenerator<CoachStreamChunk, void, void>>;
        getChatHistory: (scopeKey: string) => Promise<{
            data: CoachMessageDto[];
            status: number;
            statusText: string;
            headers: axios.AxiosResponseHeaders | Partial<axios.RawAxiosHeaders & {
                "Content-Type": axios.AxiosHeaderValue;
                Server: axios.AxiosHeaderValue;
                "Content-Length": axios.AxiosHeaderValue;
                "Cache-Control": axios.AxiosHeaderValue;
                "Content-Encoding": axios.AxiosHeaderValue;
                "content-type": axios.AxiosHeaderValue;
                server: axios.AxiosHeaderValue;
                "content-length": axios.AxiosHeaderValue;
                "cache-control": axios.AxiosHeaderValue;
                "content-encoding": axios.AxiosHeaderValue;
            } & {
                'set-cookie': string[];
            }>;
            config: InternalAxiosRequestConfig<any, any>;
            request?: any;
        }>;
        clearChatHistory: (scopeKey: string) => Promise<axios.AxiosResponse<{
            success: true;
        }, any, {}, any>>;
        applyProposals: (actions: CoachProposalAction[], sourceMessageId?: string) => Promise<axios.AxiosResponse<{
            results: CoachProposalResult[];
        }, any, {}, any>>;
        voiceIntent: (transcript: string, context: CoachVoiceIntentContext) => Promise<axios.AxiosResponse<CoachVoiceIntentResponse, any, {}, any>>;
    };
};

declare function createGoalsApi(api: AxiosInstance): {
    getAll: (params?: {
        status?: string;
        category?: string;
        categories?: string;
        labelIds?: string;
    }) => Promise<axios.AxiosResponse<Goal[], any, {}, any>>;
    getOne: (id: string) => Promise<axios.AxiosResponse<Goal, any, {}, any>>;
    /**
     * `options.idempotencyKey` guards the same failure mode documented in
     * ./time-entries.ts's `create` and ./schedule.ts's `create`: a create
     * that times out client-side after the row already committed
     * server-side, then gets queued to the offline outbox and replayed with
     * no way for the server to recognise the replay as the same request —
     * producing a real duplicate Goal row. Goal creation has no
     * time-conflict-style check to race (unlike schedule blocks), but the
     * duplicate-on-replay mechanism is identical and just as real; the key
     * must be minted once per create attempt and reused for any outbox
     * replay of that same attempt (see useQuickAdd.ts's `submitGoal` and
     * lib/offline.ts's "goal-create" operation).
     */
    create: (data: CreateGoalInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Goal, any, {}, any>>;
    update: (id: string, data: UpdateGoalInput) => Promise<axios.AxiosResponse<Goal, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    reorder: (ids: string[]) => Promise<axios.AxiosResponse<any, {
        ids: string[];
    }, {}, any>>;
    getStats: () => Promise<axios.AxiosResponse<GoalStats, any, {}, any>>;
};
type GoalsApi = ReturnType<typeof createGoalsApi>;

declare function createNotesApi(api: AxiosInstance): {
    getAll: () => Promise<axios.AxiosResponse<Note[], any, {}, any>>;
    getOne: (id: string) => Promise<axios.AxiosResponse<NoteDetailResponse, any, {}, any>>;
    /**
     * `options.idempotencyKey`, same reasoning as ./time-entries.ts's
     * `create`. `CreateNoteDto.id` already carries a client-generated id that
     * makes a true duplicate ROW impossible (the second insert hits a unique
     * constraint on id) — but without a key, that second attempt surfaces as
     * an unmapped Prisma error, which the server's generic exception filter
     * turns into a 500. The sync engine treats any 5xx as "still failing,
     * retry" (see packages/shared/src/offline/sync.ts), so a create that
     * actually succeeded ends up retried for `maxRetries` drains and then
     * dropped with a false "could not be synced" toast. Forwarding the key
     * lets the server's idempotency interceptor recognise the replay BEFORE
     * it ever reaches the insert and hand back the original 201 instead.
     */
    create: (data: CreateNoteDto, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Note, any, {}, any>>;
    update: (id: string, data: UpdateNoteDto) => Promise<axios.AxiosResponse<Note, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    reorder: (items: NoteReorderItem[]) => Promise<axios.AxiosResponse<any, NoteReorderItem[], {}, any>>;
};
type NotesApi = ReturnType<typeof createNotesApi>;

declare function createTasksApi(api: AxiosInstance): {
    /**
     * `options.idempotencyKey` guards the same failure mode documented in
     * ./time-entries.ts's `create`: a create that times out client-side
     * after the row already committed server-side, then gets queued to the
     * offline outbox and replayed with no way for the server to recognise
     * the replay as the same request — producing a real duplicate Task row.
     * Key minted once per create attempt, reused for any outbox replay of
     * that same attempt (see useQuickAdd.ts's `submitTask` and
     * lib/offline.ts's "task-create" operation).
     */
    create: (data: CreateTaskInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
    list: (params?: TaskListFilters) => Promise<axios.AxiosResponse<Task[], any, {}, any>>;
    getOne: (id: string) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
    update: (id: string, data: UpdateTaskInput) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    /**
     * `options.idempotencyKey`: unlike a plain field-replacement update,
     * completing a task is NOT idempotent server-side — `TasksService.complete`
     * unconditionally creates a new TimeEntry row (and recomputes the goal's
     * loggedHours) on every call that has remaining minutes to log. A replay
     * of a create-that-actually-committed-but-timed-out-client-side would log
     * the same completion's minutes a second time, inflating both the task's
     * logged time and its goal's loggedHours. Same key-per-attempt contract as
     * `create` above (see tasks.tsx's `handleComplete` and lib/offline.ts's
     * "task-complete" operation).
     */
    complete: (id: string, data: CompleteTaskInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
    restore: (id: string) => Promise<axios.AxiosResponse<Task, any, {}, any>>;
    reorder: (ids: string[]) => Promise<axios.AxiosResponse<any, {
        ids: string[];
    }, {}, any>>;
};
type TasksApi = ReturnType<typeof createTasksApi>;

declare function createScheduleApi(api: AxiosInstance): {
    getAll: () => Promise<axios.AxiosResponse<ScheduleBlock[], any, {}, any>>;
    getWeekly: () => Promise<axios.AxiosResponse<WeekSchedule, any, {}, any>>;
    getByDay: (dayOfWeek: number) => Promise<axios.AxiosResponse<ScheduleBlock[], any, {}, any>>;
    /**
     * `options.idempotencyKey` guards the same failure mode
     * ./time-entries.ts's `create` documents in detail: a create that times
     * out client-side after the row already committed server-side, then gets
     * queued to the offline outbox and replayed with no way for the server to
     * recognise the replay as the same request. For schedule blocks that
     * replay doesn't always land as an inert 400 — `ScheduleService.create`'s
     * time-conflict check races the check against the insert (no transaction,
     * no unique constraint), so two attempts close enough together (a live
     * retry landing while a reconnect-triggered outbox drain is replaying the
     * same create) can both pass the check and both insert, producing two
     * real overlapping ScheduleBlock rows for one logical create — which the
     * mobile Timeline then correctly, and confusingly, renders as two
     * side-by-side blocks in what should be a single time slot. Callers must
     * mint the key once per create attempt and reuse it for any outbox
     * replay of that same attempt (see ScheduleBlockSheet.tsx's handleCreate
     * and lib/offline.ts's "schedule-block-create" operation).
     */
    create: (data: CreateScheduleBlockInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<ScheduleBlock, any, {}, any>>;
    update: (id: string, data: UpdateScheduleBlockInput) => Promise<axios.AxiosResponse<ScheduleBlock, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    clearAll: () => Promise<axios.AxiosResponse<{
        deleted: number;
    }, any, {}, any>>;
};
type ScheduleApi = ReturnType<typeof createScheduleApi>;

declare function createTimeEntriesApi(api: AxiosInstance): {
    getByWeek: (weekStart: string) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
    getByDateRange: (startDate: string, endDate: string) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
    getToday: () => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
    getWeeklyTotal: () => Promise<axios.AxiosResponse<{
        totalMinutes: number;
    }, any, {}, any>>;
    getRecent: (params?: {
        page?: number;
        pageSize?: number;
        startDate?: string;
        endDate?: string;
        search?: string;
        goalId?: string;
    }) => Promise<axios.AxiosResponse<TimeEntry[], any, {}, any>>;
    /**
     * `options.idempotencyKey` is what stops a timed-out create from being
     * logged twice, and it is the one call in this file that genuinely needs
     * it — see ./idempotency for the server contract.
     *
     * This endpoint is both the slowest write the API has (the handler runs
     * several sequential Prisma round-trips: relation ownership checks, an
     * optional task-title lookup, a same-day entry count, a plan-limit user
     * fetch, the insert, then a goal-progress recompute) and the only one
     * whose payload cannot be reconstructed if it is lost — elapsed time that
     * was measured and then dropped is gone. Those two facts together are why
     * every caller wraps it in "queue the payload if no response came back",
     * and a cold-start request that exceeds the client's 20s timeout hits
     * exactly that path having ALREADY committed its row. Without a key held
     * constant across the live attempt and its replays, each replay inserts
     * another copy — bounded in practice only by whatever eventually returns
     * a real response (on the FREE plan, the daily entry cap 403, which is
     * why the duplicates arrived in threes).
     *
     * Callers must mint the key once per stopped session / spoken log, pass
     * it here, and reuse that same value as the outbox entry's
     * `idempotencyKey` so the replay carries it too. Minting a fresh key per
     * attempt reintroduces the bug in full.
     */
    create: (data: CreateTimeEntryInput, options?: IdempotentRequestOptions) => Promise<axios.AxiosResponse<TimeEntry, any, {}, any>>;
    update: (id: string, data: UpdateTimeEntryInput) => Promise<axios.AxiosResponse<TimeEntry, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
};
type TimeEntriesApi = ReturnType<typeof createTimeEntriesApi>;

declare function createTimerSessionApi(api: AxiosInstance): {
    /** Returns `null` (200), not a 404, when nothing is running — callers need no error handling to poll this. */
    getActive: () => Promise<axios.AxiosResponse<ActiveTimerSession | null, any, {}, any>>;
    /** 409s (with the current session in the body) unless `takeOver: true` — see ActiveTimerConflict. */
    start: (data?: StartTimerSessionInput) => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
    pause: () => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
    resume: () => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
    /** Attach/detach attribution mid-session. Omitted fields are left alone; `null` clears them. */
    update: (data: UpdateTimerSessionInput) => Promise<axios.AxiosResponse<ActiveTimerSession, any, {}, any>>;
    /** Converts the session into a TimeEntry, atomically, and clears it. */
    stop: (data?: StopTimerSessionInput) => Promise<axios.AxiosResponse<StopTimerSessionResult, any, {}, any>>;
    /** Abandons the session with no TimeEntry written — for an accidental start. */
    discard: () => Promise<axios.AxiosResponse<{
        discarded: boolean;
    }, any, {}, any>>;
};
type TimerSessionApi = ReturnType<typeof createTimerSessionApi>;

declare function createCategoriesApi(api: AxiosInstance): {
    getAll: () => Promise<axios.AxiosResponse<Category[], any, {}, any>>;
    getOne: (id: string) => Promise<axios.AxiosResponse<Category, any, {}, any>>;
    create: (data: CreateCategoryForm) => Promise<axios.AxiosResponse<Category, any, {}, any>>;
    update: (id: string, data: UpdateCategoryForm) => Promise<axios.AxiosResponse<Category, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
};
type CategoriesApi = ReturnType<typeof createCategoriesApi>;

declare function createLabelsApi(api: AxiosInstance): {
    getAll: () => Promise<axios.AxiosResponse<Label[], any, {}, any>>;
    getOne: (id: string) => Promise<axios.AxiosResponse<Label, any, {}, any>>;
    create: (data: CreateLabelForm) => Promise<axios.AxiosResponse<Label, any, {}, any>>;
    update: (id: string, data: UpdateLabelForm) => Promise<axios.AxiosResponse<Label, any, {}, any>>;
    delete: (id: string) => Promise<axios.AxiosResponse<any, any, {}, any>>;
    assignToGoal: (goalId: string, labelIds: string[]) => Promise<axios.AxiosResponse<any, {
        labelIds: string[];
    }, {}, any>>;
    getForGoal: (goalId: string) => Promise<axios.AxiosResponse<Label[], any, {}, any>>;
};
type LabelsApi = ReturnType<typeof createLabelsApi>;

declare function createJournalApi(api: AxiosInstance): {
    list: (params?: {
        from?: string;
        to?: string;
    }) => Promise<axios.AxiosResponse<JournalEntry[], any, {}, any>>;
    getByDate: (date: string) => Promise<axios.AxiosResponse<JournalEntry | null, any, {}, any>>;
    /**
     * Create-or-update a day's entry. The only write a journal client needs.
     *
     * Safe to replay, which is what makes it the right thing to sit in the
     * offline outbox: re-POSTing the same `{ date, content }` converges on the
     * same single row rather than stacking duplicates, and a queued save no
     * longer has to be ordered against whether that day's row exists yet.
     */
    upsert: (data: UpsertJournalEntryInput) => Promise<axios.AxiosResponse<JournalEntry, any, {}, any>>;
    /**
     * @deprecated Alias of `upsert` — the name is a leftover from when this
     * client believed create and update were different endpoints. It happens
     * to have always pointed at the right route, which is why a FIRST save
     * for a day was the one journal write that worked.
     *
     * Kept only because app/(app)/voice.tsx still calls it. Prefer `upsert`.
     */
    create: (data: CreateJournalEntryInput) => Promise<axios.AxiosResponse<JournalEntry, any, {}, any>>;
    /**
     * Set one day's content, keyed by DATE — never by id. The API has no
     * by-id write of any kind; an entry's id is a read-only artifact.
     *
     * Redundant with `upsert` for every current caller (it upserts too, and
     * takes the date in the body instead of the path), and kept only because
     * app/(app)/voice.tsx still calls it. THAT CALL SITE IS STILL WRONG: it
     * passes `existing.id`, a cuid, which the `\d{4}-\d{2}-\d{2}` route
     * constraint rejects. Fixing it is a one-argument change (pass the date
     * it already has in scope) — or better, switch it to `upsert`, which is
     * what its sibling create branch already does.
     */
    update: (date: string, data: UpdateJournalEntryInput) => Promise<axios.AxiosResponse<JournalEntry, any, {}, any>>;
    /**
     * Remove a whole day's entry, by date. Idempotent server-side (the
     * service uses `deleteMany`, which never throws on a missing row), so a
     * replayed or duplicated delete is harmless.
     */
    delete: (date: string) => Promise<axios.AxiosResponse<{
        success: true;
    }, any, {}, any>>;
};
type JournalApi = ReturnType<typeof createJournalApi>;

declare function createMessagingApi(api: AxiosInstance): {
    /** Short-lived JWT for jiffy-messaging. */
    issueToken: () => Promise<axios.AxiosResponse<MessagingTokenResponse, any, {}, any>>;
    /**
     * Opens (or returns the existing) conversation with another GoalSlot
     * user. The sharing-relationship check is server-side and answers 403
     * when there isn't one — never pre-empt it client-side beyond hiding the
     * button, because the client's copy of the sharing graph is a cache.
     */
    createConversation: (input: CreateMessagingConversationInput) => Promise<axios.AxiosResponse<OpenMessagingConversationResponse, any, {}, any>>;
};
/**
 * Every failure mode jiffy-messaging documents (400/401/403/404/429), plus
 * the two the network gives us for free. Callers switch on `kind` instead of
 * re-deriving meaning from a status code at each call site — and the UI can
 * say "you're offline" rather than "Request failed with status code
 * undefined".
 */
type MessagingErrorKind = 'not-configured' | 'bad-request' | 'unauthorized' | 'forbidden' | 'not-found' | 'rate-limited' | 'server' | 'network' | 'unknown';
declare class MessagingError extends Error {
    readonly kind: MessagingErrorKind;
    readonly status?: number;
    constructor(kind: MessagingErrorKind, message: string, status?: number);
}
/** Normalises anything thrown by axios (or by us) into a MessagingError. */
declare function toMessagingError(error: unknown): MessagingError;
interface MessagingServiceConfig {
    /**
     * Origin of the jiffy-messaging deployment, e.g. "https://messaging.goalslot.io".
     * Returning an empty string (or undefined) means "not configured" and every
     * call rejects with kind 'not-configured' instead of hitting a bogus URL.
     */
    getBaseUrl: () => string | undefined;
    /**
     * Supplies the messaging JWT. Called before every request, so the
     * implementation is expected to cache — see ../messaging/token.ts.
     * `forceRefresh` is passed after a 401 to mint a fresh one.
     */
    getToken: (options?: {
        forceRefresh?: boolean;
    }) => Promise<string>;
}
interface ListMessagesOptions {
    limit?: number;
    /** ISO instant — returns messages strictly older than this, for paging back. */
    before?: string;
}
declare function createMessagingServiceClient(config: MessagingServiceConfig): {
    listConversations: () => Promise<MessagingConversation[]>;
    getConversation: (id: string) => Promise<MessagingConversation>;
    /** Oldest-first, per the service contract. */
    listMessages: (id: string, options?: ListMessagesOptions) => Promise<MessagingMessage[]>;
    sendMessage: (id: string, body: string) => Promise<MessagingMessage>;
    /** 204 on success. Swallows the empty body so callers get a clean `void`. */
    markRead: (id: string) => Promise<void>;
};
/**
 * The service's own documented default. Kept here so the paging math in the
 * thread screen ("a short page means there is no more history") has one
 * number to compare against.
 */
declare const DEFAULT_PAGE_SIZE = 50;
/** Longest body the composer accepts before the send button disables. */
declare const MAX_MESSAGE_LENGTH = 4000;
type MessagingServiceClient = ReturnType<typeof createMessagingServiceClient>;

/**
 * Minimal async key/value storage adapter the outbox is built on. Web wires
 * this to idb-keyval, mobile wires it to AsyncStorage — this package never
 * imports either directly.
 */
interface OfflineStorage {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    del(key: string): Promise<void>;
}
interface OutboxEntry {
    id: string;
    kind: string;
    payload: unknown;
    idempotencyKey: string;
    createdAt: number;
    retries: number;
}
interface OfflineOperation<TPayload = unknown, TResult = unknown> {
    execute: (payload: TPayload, idempotencyKey: string) => Promise<TResult>;
    invalidateKeys?: QueryKey[];
    /**
     * Called when the sync engine drops this operation's outbox entry because
     * the server gave it a response rather than nothing — either an outright
     * rejection (a non-5xx status, so replaying the same payload again could
     * never succeed) or a 5xx that kept recurring until `maxRetries` was
     * exhausted. Never called for a network-style failure (no response at
     * all); that leaves the entry queued instead of dropping it — see
     * `drainOutbox` in ./sync.
     *
     * Optional, and the safe default for an operation that doesn't set one is
     * exactly today's behaviour: the entry is dropped silently apart from the
     * engine's own aggregate `notify` summary ("N offline changes could not be
     * synced"), which fires regardless of whether any operation registers
     * this hook. Set it when a drop needs its own user-facing reaction —
     * `messaging-send` already reacts to a definite rejection this way, just
     * inline inside its own `execute` rather than through this hook, because
     * it needs to patch a cache entry synchronously with the throw rather than
     * after the outbox entry is gone.
     */
    onDropped?: (payload: TPayload, error: unknown) => void;
}

declare function genId(): string;

declare function hasResponse(err: unknown): err is {
    response: {
        status: number;
    };
};

interface Outbox {
    getOutbox(): Promise<OutboxEntry[]>;
    getOutboxCount(): Promise<number>;
    addToOutbox(entry: OutboxEntry): Promise<OutboxEntry>;
    removeFromOutbox(id: string): Promise<void>;
    bumpRetries(id: string): Promise<void>;
    /**
     * Drop every queued entry.
     *
     * Exists for session teardown: entries are plain payloads with no notion of
     * who enqueued them, and the sync engine replays them against whatever
     * credentials are current. Left in place across a logout, a create queued
     * by one account would silently land in the next account that signs in on
     * the device. Anything unsent at logout is discarded rather than
     * misattributed.
     */
    clearOutbox(): Promise<void>;
}
declare function createOutbox(storage: OfflineStorage, storageKey?: string): Outbox;

interface OperationRegistry {
    registerOperation<TPayload, TResult>(kind: string, operation: OfflineOperation<TPayload, TResult>): void;
    getOperation(kind: string): OfflineOperation | undefined;
}
declare function createOperationRegistry(): OperationRegistry;

interface OfflineSyncConfig {
    outbox: Outbox;
    registry: OperationRegistry;
    isOnline: () => boolean;
    subscribeOnline: (callback: (online: boolean) => void) => () => void;
    invalidateQueries: (queryKey: QueryKey) => void;
    notify?: (message: string, kind: 'success' | 'error') => void;
    onPendingCountChange?: (count: number) => void;
    maxRetries?: number;
}
interface OfflineSync {
    drainOutbox(): Promise<void>;
    refreshPendingCount(): Promise<void>;
    /** Kicks off an initial drain + subscribes to reconnect events. Returns an unsubscribe function. */
    init(): () => void;
}
declare function createOfflineSync(config: OfflineSyncConfig): OfflineSync;

declare function createCoachQueries(coachApi: CoachApi): {
    coachQueries: {
        all: readonly ["coach"];
        chat: (scopeKey: string) => readonly ["coach", "chat", string];
    };
    fetchChatHistory: (scopeKey: string) => Promise<CoachMessageDto[]>;
    chat: (scopeKey: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<CoachMessageDto[], Error, CoachMessageDto[], readonly ["coach", "chat", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<CoachMessageDto[], readonly ["coach", "chat", string], never> | undefined;
    } & {
        queryKey: readonly ["coach", "chat", string] & {
            [dataTagSymbol]: CoachMessageDto[];
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createCoachSettingsQueries(coachSettingsApi: CoachSettingsApi): {
    coachSettingsQueries: {
        all: readonly ["coach"];
        byokKey: () => readonly ["coach", "byok-key"];
        habitsProfile: () => readonly ["coach", "habits-profile"];
    };
    fetchByokKey: () => Promise<CoachByokState>;
    fetchHabitsProfile: () => Promise<CoachHabitsProfile>;
    byokKey: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<CoachByokState, Error, CoachByokState, readonly unknown[]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<CoachByokState, readonly unknown[], never> | undefined;
    } & {
        queryKey: readonly unknown[] & {
            [dataTagSymbol]: CoachByokState;
            [dataTagErrorSymbol]: Error;
        };
    };
    habitsProfile: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<CoachHabitsProfile, Error, CoachHabitsProfile, readonly unknown[]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<CoachHabitsProfile, readonly unknown[], never> | undefined;
    } & {
        queryKey: readonly unknown[] & {
            [dataTagSymbol]: CoachHabitsProfile;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createGoalQueries(goalsApi: GoalsApi): {
    goalQueries: {
        all: readonly ["goals"];
        list: (filters?: GoalFilters) => readonly ["goals", "list", GoalFilters | undefined];
        detail: (id: string) => readonly ["goals", "detail", string];
        stats: () => readonly ["goals", "stats"];
    };
    fetchGoals: (filters?: GoalFilters) => Promise<Goal[]>;
    fetchGoalStats: () => Promise<GoalStats>;
    fetchGoal: (id: string) => Promise<Goal>;
    list: (filters?: GoalFilters) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Goal[], Error, Goal[], readonly ["goals", "list", GoalFilters | undefined]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Goal[], readonly ["goals", "list", GoalFilters | undefined], never> | undefined;
    } & {
        queryKey: readonly ["goals", "list", GoalFilters | undefined] & {
            [dataTagSymbol]: Goal[];
            [dataTagErrorSymbol]: Error;
        };
    };
    detail: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Goal, Error, Goal, readonly ["goals", "detail", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Goal, readonly ["goals", "detail", string], never> | undefined;
    } & {
        queryKey: readonly ["goals", "detail", string] & {
            [dataTagSymbol]: Goal;
            [dataTagErrorSymbol]: Error;
        };
    };
    stats: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<GoalStats, Error, GoalStats, readonly ["goals", "stats"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<GoalStats, readonly ["goals", "stats"], never> | undefined;
    } & {
        queryKey: readonly ["goals", "stats"] & {
            [dataTagSymbol]: GoalStats;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createNoteQueries(notesApi: NotesApi): {
    noteQueries: {
        all: readonly ["notes"];
        list: () => readonly ["notes", "list"];
        detail: (id: string) => readonly ["notes", "detail", string];
    };
    fetchNotes: () => Promise<Note[]>;
    fetchNote: (id: string) => Promise<NoteDetailResponse>;
    list: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Note[], Error, Note[], readonly ["notes", "list"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Note[], readonly ["notes", "list"], never> | undefined;
    } & {
        queryKey: readonly ["notes", "list"] & {
            [dataTagSymbol]: Note[];
            [dataTagErrorSymbol]: Error;
        };
    };
    detail: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<NoteDetailResponse, Error, NoteDetailResponse, readonly ["notes", "detail", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<NoteDetailResponse, readonly ["notes", "detail", string], never> | undefined;
    } & {
        queryKey: readonly ["notes", "detail", string] & {
            [dataTagSymbol]: NoteDetailResponse;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createTaskQueries(tasksApi: TasksApi): {
    taskQueries: {
        all: readonly ["tasks"];
        list: (filters?: TaskListFilters) => readonly ["tasks", "list", TaskListFilters | undefined];
        detail: (id: string) => readonly ["tasks", "detail", string];
    };
    fetchTasks: (filters?: TaskListFilters) => Promise<Task[]>;
    fetchTask: (id: string) => Promise<Task>;
    list: (filters?: TaskListFilters) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Task[], Error, Task[], readonly ["tasks", "list", TaskListFilters | undefined]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Task[], readonly ["tasks", "list", TaskListFilters | undefined], never> | undefined;
    } & {
        queryKey: readonly ["tasks", "list", TaskListFilters | undefined] & {
            [dataTagSymbol]: Task[];
            [dataTagErrorSymbol]: Error;
        };
    };
    detail: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Task, Error, Task, readonly ["tasks", "detail", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Task, readonly ["tasks", "detail", string], never> | undefined;
    } & {
        queryKey: readonly ["tasks", "detail", string] & {
            [dataTagSymbol]: Task;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createScheduleQueries(scheduleApi: ScheduleApi): {
    scheduleQueries: {
        root: () => readonly ["schedule"];
        weeklyKey: () => readonly ["schedule", "weekly"];
    };
    fetchWeeklySchedule: () => Promise<WeekSchedule>;
    weekly: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<WeekSchedule, Error, WeekSchedule, readonly ["schedule", "weekly"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<WeekSchedule, readonly ["schedule", "weekly"], never> | undefined;
    } & {
        queryKey: readonly ["schedule", "weekly"] & {
            [dataTagSymbol]: WeekSchedule;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createTimeEntryQueries(timeEntriesApi: TimeEntriesApi): {
    timeEntryQueries: {
        all: readonly ["time-entries"];
        recent: () => readonly ["time-entries", "recent"];
        week: (weekStart: string) => readonly ["time-entries", "week", string];
        range: (startDate: string, endDate: string) => readonly ["time-entries", "range", string, string];
        today: () => readonly ["time-entries", "today"];
    };
    fetchRecentEntries: () => Promise<TimeEntry[]>;
    fetchToday: () => Promise<TimeEntry[]>;
    recent: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<TimeEntry[], Error, TimeEntry[], readonly ["time-entries", "recent"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<TimeEntry[], readonly ["time-entries", "recent"], never> | undefined;
    } & {
        queryKey: readonly ["time-entries", "recent"] & {
            [dataTagSymbol]: TimeEntry[];
            [dataTagErrorSymbol]: Error;
        };
    };
    today: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<TimeEntry[], Error, TimeEntry[], readonly ["time-entries", "today"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<TimeEntry[], readonly ["time-entries", "today"], never> | undefined;
    } & {
        queryKey: readonly ["time-entries", "today"] & {
            [dataTagSymbol]: TimeEntry[];
            [dataTagErrorSymbol]: Error;
        };
    };
};

/**
 * "Is this actually a session?" — validate the shape rather than testing for
 * null, because the wire never gives us a `null` to test for.
 *
 * `GET /timer/session` answers "nothing is running" by returning `null` from
 * its controller, which Nest sends as a 200 with an EMPTY BODY (its Express
 * adapter's `reply()` calls `response.send()` with no argument for a nil
 * body — verified in dw-time-api's active-timer.controller.ts + Nest's own
 * adapter). Axios surfaces an empty body as the string `''`, not `null`: its
 * default `transformResponse` skips `JSON.parse` for a falsy payload and
 * hands the raw `''` straight through.
 *
 * So `res.data` was `''` — truthy — every time nothing was running, and
 * every caller's `?? null` sailed straight past it. Downstream that reads as
 * a session whose every field is `undefined`: `status !== 'RUNNING'` renders
 * as PAUSED, `accumulatedMs ?? 0` renders 00:00:00, and there is no session
 * behind it to pause, resume or stop — so every transport button errors. The
 * web app hit exactly this and guards it inside its own hook (see
 * goal-slot-web's use-timer.ts); this fixes it once, at the boundary, so the
 * client's "returns null when nothing is running" promise is actually true
 * for every consumer of this factory.
 */
declare function toActiveTimerSession(data: unknown): ActiveTimerSession | null;
declare function createTimerSessionQueries(timerSessionApi: TimerSessionApi): {
    timerSessionQueries: {
        all: readonly ["timer-session"];
        active: () => readonly ["timer-session", "active"];
    };
    fetchActive: () => Promise<ActiveTimerSession | null>;
    active: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<ActiveTimerSession | null, Error, ActiveTimerSession | null, readonly ["timer-session", "active"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<ActiveTimerSession | null, readonly ["timer-session", "active"], never> | undefined;
    } & {
        queryKey: readonly ["timer-session", "active"] & {
            [dataTagSymbol]: ActiveTimerSession | null;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createCategoryQueries(categoriesApi: CategoriesApi): {
    categoryQueries: {
        all: () => readonly ["categories"];
        listKey: () => readonly ["categories", "list"];
        detailKey: (id: string) => readonly ["categories", "detail", string];
    };
    fetchCategories: () => Promise<Category[]>;
    fetchCategory: (id: string) => Promise<Category>;
    list: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Category[], Error, Category[], readonly unknown[]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Category[], readonly unknown[], never> | undefined;
    } & {
        queryKey: readonly unknown[] & {
            [dataTagSymbol]: Category[];
            [dataTagErrorSymbol]: Error;
        };
    };
    detail: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Category, Error, Category, readonly unknown[]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Category, readonly unknown[], never> | undefined;
    } & {
        queryKey: readonly unknown[] & {
            [dataTagSymbol]: Category;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createLabelQueries(labelsApi: LabelsApi): {
    labelQueries: {
        all: () => readonly ["labels"];
        listKey: () => readonly ["labels", "list"];
        detailKey: (id: string) => readonly ["labels", "detail", string];
    };
    fetchLabels: () => Promise<Label[]>;
    fetchLabel: (id: string) => Promise<Label>;
    list: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Label[], Error, Label[], readonly unknown[]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Label[], readonly unknown[], never> | undefined;
    } & {
        queryKey: readonly unknown[] & {
            [dataTagSymbol]: Label[];
            [dataTagErrorSymbol]: Error;
        };
    };
    detail: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Label, Error, Label, readonly unknown[]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Label, readonly unknown[], never> | undefined;
    } & {
        queryKey: readonly unknown[] & {
            [dataTagSymbol]: Label;
            [dataTagErrorSymbol]: Error;
        };
    };
};

interface JournalDateRange {
    from?: string;
    to?: string;
}
declare function createJournalQueries(journalApi: JournalApi): {
    journalQueries: {
        all: readonly ["journal"];
        list: (range?: JournalDateRange) => readonly ["journal", "list", JournalDateRange | undefined];
        byDate: (date: string) => readonly ["journal", "date", string];
    };
    fetchEntries: (range?: JournalDateRange) => Promise<JournalEntry[]>;
    fetchEntryByDate: (date: string) => Promise<JournalEntry | null>;
    list: (range?: JournalDateRange) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<JournalEntry[], Error, JournalEntry[], readonly ["journal", "list", JournalDateRange | undefined]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<JournalEntry[], readonly ["journal", "list", JournalDateRange | undefined], never> | undefined;
    } & {
        queryKey: readonly ["journal", "list", JournalDateRange | undefined] & {
            [dataTagSymbol]: JournalEntry[];
            [dataTagErrorSymbol]: Error;
        };
    };
    byDate: (date: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<JournalEntry | null, Error, JournalEntry | null, readonly ["journal", "date", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<JournalEntry | null, readonly ["journal", "date", string], never> | undefined;
    } & {
        queryKey: readonly ["journal", "date", string] & {
            [dataTagSymbol]: JournalEntry | null;
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createMessagingQueries(client: MessagingServiceClient, sharingApi: SharingApi): {
    messagingQueries: {
        all: readonly ["messaging"];
        conversations: () => readonly ["messaging", "conversations"];
        conversation: (id: string) => readonly ["messaging", "conversation", string];
        messages: (id: string) => readonly ["messaging", "messages", string];
        contacts: () => readonly ["messaging", "contacts"];
    };
    fetchConversations: () => Promise<MessagingConversation[]>;
    fetchConversation: (id: string) => Promise<MessagingConversation>;
    fetchMessages: (id: string) => Promise<MessagingMessage[]>;
    fetchContacts: () => Promise<MessagingContact[]>;
    conversations: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<MessagingConversation[], Error, MessagingConversation[], readonly ["messaging", "conversations"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<MessagingConversation[], readonly ["messaging", "conversations"], never> | undefined;
    } & {
        queryKey: readonly ["messaging", "conversations"] & {
            [dataTagSymbol]: MessagingConversation[];
            [dataTagErrorSymbol]: Error;
        };
    };
    conversation: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<MessagingConversation, Error, MessagingConversation, readonly ["messaging", "conversation", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<MessagingConversation, readonly ["messaging", "conversation", string], never> | undefined;
    } & {
        queryKey: readonly ["messaging", "conversation", string] & {
            [dataTagSymbol]: MessagingConversation;
            [dataTagErrorSymbol]: Error;
        };
    };
    messages: (id: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<MessagingThreadMessage[], Error, MessagingThreadMessage[], readonly ["messaging", "messages", string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<MessagingThreadMessage[], readonly ["messaging", "messages", string], never> | undefined;
    } & {
        queryKey: readonly ["messaging", "messages", string] & {
            [dataTagSymbol]: MessagingThreadMessage[];
            [dataTagErrorSymbol]: Error;
        };
    };
    contacts: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<MessagingContact[], Error, MessagingContact[], readonly ["messaging", "contacts"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<MessagingContact[], readonly ["messaging", "contacts"], never> | undefined;
    } & {
        queryKey: readonly ["messaging", "contacts"] & {
            [dataTagSymbol]: MessagingContact[];
            [dataTagErrorSymbol]: Error;
        };
    };
};

declare function createSharingQueries(api: SharingApi): {
    sharingQueries: {
        all: readonly ["sharing"];
        sharedWithMe: () => readonly ["sharing", "shared-with-me"];
        sharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) => readonly ["sharing", "shared-user", string, "time-entries", string, string];
        sharedUserGoals: (ownerId: string) => readonly ["sharing", "shared-user", string, "goals"];
    };
    /** People who shared their data with the signed-in user — their mentees. */
    sharedWithMe: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<IncomingShare[], Error, IncomingShare[], readonly ["sharing", "shared-with-me"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<IncomingShare[], readonly ["sharing", "shared-with-me"], never> | undefined;
    } & {
        queryKey: readonly ["sharing", "shared-with-me"] & {
            [dataTagSymbol]: IncomingShare[];
            [dataTagErrorSymbol]: Error;
        };
    };
    sharedUserTimeEntries: (ownerId: string, startDate: string, endDate: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<TimeEntry[], Error, TimeEntry[], readonly ["sharing", "shared-user", string, "time-entries", string, string]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<TimeEntry[], readonly ["sharing", "shared-user", string, "time-entries", string, string], never> | undefined;
    } & {
        queryKey: readonly ["sharing", "shared-user", string, "time-entries", string, string] & {
            [dataTagSymbol]: TimeEntry[];
            [dataTagErrorSymbol]: Error;
        };
    };
    sharedUserGoals: (ownerId: string) => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<Goal[], Error, Goal[], readonly ["sharing", "shared-user", string, "goals"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<Goal[], readonly ["sharing", "shared-user", string, "goals"], never> | undefined;
    } & {
        queryKey: readonly ["sharing", "shared-user", string, "goals"] & {
            [dataTagSymbol]: Goal[];
            [dataTagErrorSymbol]: Error;
        };
    };
};
type SharingQueries = ReturnType<typeof createSharingQueries>;

declare function createInstructionsQueries(api: InstructionsApi): {
    instructionsQueries: {
        all: readonly ["instructions"];
        assignedByMe: () => readonly ["instructions", "assigned-by-me"];
        assignedToMe: () => readonly ["instructions", "assigned-to-me"];
    };
    /** Instructions the signed-in user (a mentor) has assigned to mentees. */
    assignedByMe: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<InstructionAssignedByMe[], Error, InstructionAssignedByMe[], readonly ["instructions", "assigned-by-me"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<InstructionAssignedByMe[], readonly ["instructions", "assigned-by-me"], never> | undefined;
    } & {
        queryKey: readonly ["instructions", "assigned-by-me"] & {
            [dataTagSymbol]: InstructionAssignedByMe[];
            [dataTagErrorSymbol]: Error;
        };
    };
    /** Instructions assigned to the signed-in user (a mentee) by a mentor. */
    assignedToMe: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<InstructionAssignedToMe[], Error, InstructionAssignedToMe[], readonly ["instructions", "assigned-to-me"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<InstructionAssignedToMe[], readonly ["instructions", "assigned-to-me"], never> | undefined;
    } & {
        queryKey: readonly ["instructions", "assigned-to-me"] & {
            [dataTagSymbol]: InstructionAssignedToMe[];
            [dataTagErrorSymbol]: Error;
        };
    };
};
type InstructionsQueries = ReturnType<typeof createInstructionsQueries>;

declare function createNotificationQueries(api: NotificationsApi): {
    notificationQueries: {
        all: readonly ["notifications"];
        list: () => readonly ["notifications", "list"];
        unreadCount: () => readonly ["notifications", "unread-count"];
    };
    /** The notification-center screen's list — paged with `fetchNextPage`. */
    infiniteList: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseInfiniteQueryOptions<NotificationListResponse, Error, _tanstack_query_core.InfiniteData<NotificationListResponse, unknown>, readonly ["notifications", "list"], string | undefined>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<NotificationListResponse, readonly ["notifications", "list"], string | undefined> | undefined;
    } & {
        queryKey: readonly ["notifications", "list"] & {
            [dataTagSymbol]: _tanstack_query_core.InfiniteData<NotificationListResponse, unknown>;
            [dataTagErrorSymbol]: Error;
        };
    };
    /** Bell-icon badge count — see `unreadCount()`'s key comment above for why this isn't read off `infiniteList()`. */
    unreadCount: () => _tanstack_query_core.OmitKeyof<_tanstack_react_query.UseQueryOptions<number, Error, number, readonly ["notifications", "unread-count"]>, "queryFn"> & {
        queryFn?: _tanstack_query_core.QueryFunction<number, readonly ["notifications", "unread-count"], never> | undefined;
    } & {
        queryKey: readonly ["notifications", "unread-count"] & {
            [dataTagSymbol]: number;
            [dataTagErrorSymbol]: Error;
        };
    };
};
type NotificationQueries = ReturnType<typeof createNotificationQueries>;

interface ScheduledAlarm {
    id: string;
    scheduleBlockId: string;
    /** ISO 8601 UTC instant — computed by src/scheduling's fire-time resolver. */
    fireAtUtc: string;
    title: string;
}
interface AlarmCapability {
    scheduleAlarm(alarm: ScheduledAlarm): Promise<void>;
    cancelAlarm(alarmId: string): Promise<void>;
    listScheduled(): Promise<ScheduledAlarm[]>;
}
/**
 * Whether the OS will let this app listen. 'undetermined' is the only state
 * in which asking is allowed — asking again after a denial does nothing on
 * either platform except train the user to ignore the app, so a caller that
 * sees 'denied' must send them to Settings instead of re-prompting.
 */
type VoicePermissionStatus = 'granted' | 'denied' | 'undetermined';
/**
 * Every way listening can end badly, reduced to the cases a UI actually
 * renders differently. The platform error vocabularies are larger than this
 * and not worth exposing: an app cannot do anything different about
 * "bad-grammar" than about "client".
 */
type VoiceErrorKind = 
/** The OS refused, or permission was never granted. Route to Settings. */
'permission-denied'
/** Heard nothing. Not a failure — offer another go. */
 | 'no-speech'
/** No recognizer on this device, or the locale isn't installed. */
 | 'unavailable'
/** Recognition needed the network and didn't have it. */
 | 'network'
/** The microphone itself could not be read (in use, hardware, interrupted). */
 | 'audio' | 'unknown';
interface VoiceError {
    readonly kind: VoiceErrorKind;
    /** Sentence shown to the user. Always written for a person, never a code. */
    readonly message: string;
}
interface VoiceListenHandlers {
    /**
     * Called repeatedly while someone talks (`isFinal: false`) and once when
     * the recognizer commits (`isFinal: true`). Interim text is for display
     * only — acting on it means acting on half a sentence.
     */
    onTranscript(text: string, isFinal: boolean): void;
    onError?(error: VoiceError): void;
    /** The session is over, however it ended. Always the last call. */
    onEnd?(): void;
}
/**
 * Speech capture. Deliberately transcript-only: this port hears words and
 * stops there. What a sentence *means* is decided by `../voice`'s parser
 * (tracking commands) or by the Coach (everything else), neither of which
 * should have to know which native module produced the string.
 */
interface VoiceCapability {
    /** A recognizer exists on this device. Independent of permission. */
    isAvailable(): Promise<boolean>;
    getPermission(): Promise<VoicePermissionStatus>;
    /** Prompts. Only call when `getPermission()` returned 'undetermined'. */
    requestPermission(): Promise<VoicePermissionStatus>;
    startListening(handlers: VoiceListenHandlers): Promise<void>;
    /** Stop and take the final transcript. */
    stopListening(): Promise<void>;
    /** Stop and throw the transcript away — the user backed out. */
    cancelListening(): Promise<void>;
}
interface NotificationInputBase {
    id: string;
    title: string;
    body: string;
    /**
     * Arbitrary payload carried on the notification and handed back when the
     * user taps it, so the app can route somewhere specific instead of just
     * opening cold. Deliberately untyped here: this package can't know an
     * individual app's route shape, and typing it would invert the dependency
     * (shared → app). The mobile app narrows it at the tap site — see
     * apps/mobile/src/lib/deep-links.ts's DeepLinkNotificationData.
     */
    data?: Record<string, unknown>;
    /**
     * Ask for this to be delivered as an ALARM rather than a quiet notice:
     * audible, heads-up, and allowed to interrupt a Focus/Do-Not-Disturb
     * profile. Defaults to false — a plain notification.
     *
     * WHY this is one semantic flag rather than the platform fields it maps
     * onto (`sound`, an Android channel id + importance, iOS
     * `interruptionLevel`): this package is the capability port, and naming
     * expo/Android/iOS concepts here would push platform detail up into every
     * caller and defeat the boundary. Callers say WHAT they need — "this must
     * wake someone up" — and the one file allowed to import expo-notifications
     * (apps/mobile/src/lib/notifications.ts) decides HOW.
     *
     * A caller that sets this is not guaranteed an alarm: on Android 12+ exact
     * delivery additionally depends on the app holding SCHEDULE_EXACT_ALARM /
     * USE_EXACT_ALARM (declared in app.json), and on either platform the user
     * can always silence the channel afterwards. It is a request, not a
     * promise — the same contract as `scheduleNotification` itself, which
     * resolves even when permission was refused.
     */
    alarm?: boolean;
    /**
     * Ask for this to be delivered as a gentler, still-audible notification —
     * a normal sound/visible banner, but deliberately NOT alarm-grade: no max
     * priority, no forced vibration pattern, and it must not bypass a Focus/
     * Do-Not-Disturb profile the way `alarm` does. Sits between "nothing" and
     * `alarm` for callers (like a schedule block's reminder tier) that need a
     * middle option, not just on/off.
     *
     * Mutually exclusive with `alarm` — a caller sets at most one of the two,
     * never both. Defaults to false, same as `alarm`.
     */
    notify?: boolean;
}
/** Fires once, at an exact absolute instant — e.g. a coach nudge or a one-off deadline. */
interface OneShotNotificationInput extends NotificationInputBase {
    fireAtUtc: string;
    repeat?: never;
}
/**
 * Fires every week when device-local wall-clock time matches `weekday`/
 * `hour`/`minute` — schedule-block reminders, which recur on the block's own
 * `dayOfWeek` (0 = Sunday, matching ScheduleBlock) every week indefinitely,
 * not just once. There is no absolute `fireAtUtc` for a recurring trigger by
 * definition, so this variant omits it rather than asking a caller to invent
 * one.
 *
 * Local wall-clock time (not a stored IANA zone) is deliberate here, same as
 * how a phone's own alarm clock behaves: a 9pm reminder should keep firing
 * at 9pm after the user's local zone or DST offset changes, not silently
 * follow whatever zone the schedule was originally authored in.
 */
interface RecurringNotificationInput extends NotificationInputBase {
    fireAtUtc?: never;
    repeat: {
        /** 0 (Sunday) - 6 (Saturday), matching ScheduleBlock.dayOfWeek. */
        weekday: number;
        hour: number;
        minute: number;
    };
}
type NotificationInput = OneShotNotificationInput | RecurringNotificationInput;
/**
 * What the OS currently thinks about this app and notifications.
 *
 * The three states are not two states with a nicety on top — they need three
 * different pieces of UI. `undetermined` means an in-app "Allow
 * notifications" button will actually raise the system prompt. `denied`
 * means it won't: iOS only ever asks once, so the only route back is the
 * device's own settings app, and a button that silently does nothing is
 * worse than no button. `granted` means neither control should be shown.
 */
type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';
interface NotificationCapability {
    /**
     * Reads the current permission without prompting.
     *
     * Exists so a settings screen can show the truth instead of a local mirror
     * of "did the last requestPermission() call succeed" — that mirror resets
     * on every app launch, and it goes stale the moment the user changes the
     * permission in the OS settings app and comes back.
     */
    getPermissionStatus(): Promise<NotificationPermissionStatus>;
    requestPermission(): Promise<boolean>;
    scheduleNotification(input: NotificationInput): Promise<void>;
    cancelNotification(id: string): Promise<void>;
    /**
     * Identifiers of everything this app currently has QUEUED (not delivered).
     *
     * WHY the port needs this: a recurring notification outlives the record
     * that created it. Delete a schedule block — here, or on the web, or from
     * another device — and its weekly alarm is still sitting in the OS queue,
     * firing every week for a block that no longer exists. Nothing derived
     * from the app's own data can find it, because the block it was named
     * after is gone; the only way to notice an orphan is to ask the OS what it
     * is actually holding and diff that against what should be there.
     *
     * Resolves to an empty array rather than rejecting when the platform can't
     * answer — callers use this to prune, and a failed prune must degrade to
     * "left the queue alone", never to a thrown error mid-reconcile.
     */
    listScheduledIds(): Promise<string[]>;
    /**
     * Drops every notification this app owns on the device — the ones still
     * queued to fire and the ones already delivered and sitting in the shade.
     *
     * WHY the port needs a bulk operation instead of callers looping over
     * `cancelNotification`: the one caller that needs this is sign-out, and by
     * then it cannot enumerate the ids. Notification ids are minted from
     * account-scoped server ids (`schedule-reminder-<blockId>`), so the only
     * record of what is pending is the very data a sign-out has just thrown
     * away. Anything the caller could reconstruct would be a guess, and a
     * missed id is a notification that fires for the next person on the device
     * carrying the previous account's wording.
     *
     * Resolves rather than rejects even when the platform refuses. Sign-out is
     * the caller, and a user must always be able to sign out.
     */
    clearAllNotifications(): Promise<void>;
}
interface Capabilities {
    alarms: AlarmCapability;
    voice: VoiceCapability;
    notifications: NotificationCapability;
}
/**
 * A fully inert implementation of `Capabilities`. Lets the rest of the app
 * (and this package's own tests) wire the capability seam end-to-end before
 * any native module exists behind it — every call resolves successfully and
 * does nothing observable.
 */
declare function createNoopCapabilities(): Capabilities;

/**
 * The v1 event surface. Deliberately scoped to what the upcoming screens
 * (Today, Schedule, Goals, Tasks, Time Tracker, and Journal — reinstated in
 * simplified form after being cut from the original v1 list, see
 * DECISIONS.md #5) actually fire — not a speculative full taxonomy. Each
 * key's payload is the argument shape `track()` requires for that event.
 */
interface AnalyticsEventMap {
    goalCreated: {
        goalId: string;
    };
    goalCompleted: {
        goalId: string;
    };
    goalDeleted: {
        goalId: string;
    };
    taskCreated: {
        taskId: string;
    };
    taskCompleted: {
        taskId: string;
    };
    taskDeleted: {
        taskId: string;
    };
    scheduleBlockCreated: {
        scheduleBlockId: string;
    };
    scheduleBlockUpdated: {
        scheduleBlockId: string;
    };
    scheduleBlockDeleted: {
        scheduleBlockId: string;
    };
    timerStarted: {
        taskId?: string;
        scheduleBlockId?: string;
    };
    timerStopped: {
        taskId?: string;
        scheduleBlockId?: string;
        durationSeconds: number;
    };
    timerPaused: {
        taskId?: string;
        scheduleBlockId?: string;
    };
    quickAddOpened: {
        kind: 'goal' | 'task' | 'slot';
    };
    noteCreated: {
        noteId: string;
        parentId: string | null;
    };
    noteDeleted: {
        noteId: string;
    };
    noteMoved: {
        noteId: string;
    };
    screenViewed: {
        screenName: string;
    };
    journalEntrySaved: {
        date: string;
    };
    coachDayAnalysisRequested: {
        date: string;
    };
}
type AnalyticsEventName = keyof AnalyticsEventMap;
/**
 * A typed union over the event map above — `track()` takes one of these, so
 * the payload shape for `name` is checked at the call site instead of being
 * validated ad hoc.
 */
type AnalyticsEvent = {
    [Name in AnalyticsEventName]: {
        name: Name;
        payload: AnalyticsEventMap[Name];
    };
}[AnalyticsEventName];
interface AnalyticsCapability {
    track(event: AnalyticsEvent): void;
    identify(userId: string): void;
    reset(): void;
}
/**
 * Logs every call to `console`. This is the "implementation can be a
 * console stub" version referenced in the project brief — it exists so the
 * analytics seam can be wired through every screen now, with a real vendor
 * SDK dropped in behind this same interface later.
 */
declare function createConsoleAnalytics(): AnalyticsCapability;
/**
 * v1 flag keys. `voiceAssistant` and `realAlarms` are the two big deferred
 * features (see `../capabilities`'s noop Voice/Alarm implementations and
 * dw-time-mobile/DECISIONS.md) — gating them behind a flag lets their entry
 * points exist in code, unreachable, without waiting on the real feature.
 */
type FeatureFlagKey = 'voiceAssistant' | 'realAlarms';
interface FeatureFlagCapability {
    isEnabled(flag: FeatureFlagKey): boolean;
}
/**
 * A static, default-off resolver: every flag is off unless explicitly
 * overridden. Safe default for unreleased features — nothing becomes
 * reachable by accident. Simple enough (one object, one lookup) to swap for
 * a real remote-config-backed implementation later without changing any
 * call site, since callers only ever see `FeatureFlagCapability`.
 */
declare function createStaticFeatureFlags(overrides?: Partial<Record<FeatureFlagKey, boolean>>): FeatureFlagCapability;

/**
 * Coerce a model-emitted action type to a canonical one, or null if it can't
 * be mapped. Dropping the unmappable ones is what keeps a single bad type
 * from 400-ing the entire apply batch on the server.
 */
declare function normalizeCoachActionType(raw: unknown): CoachProposalActionType | null;
/**
 * WHY this is a discriminated union and not a boolean.
 *
 * It used to be `unrenderable: boolean`, and all four of the ways a closed
 * ```coach-proposal block can yield nothing collapsed into it — including a
 * `catch {}` that threw the parse error away entirely. Every one of them
 * reached the user as the same sentence: "Something went wrong preparing that
 * change. Try asking again." A real user hit that twice in one session and
 * (correctly) reported it as the app refusing to say what was actually wrong.
 *
 * Keeping the reason means the UI can say something true and specific, and
 * `bad-json.raw` means the NEXT occurrence is diagnosable from a log line
 * instead of from screenshots.
 */
type CoachProposalFailure = 
/** The fence body was not JSON, even after the repair pass. `detail` is the
 *  JSON.parse message; `raw` is the (truncated) block, for diagnostics only
 *  — never render it. */
{
    reason: 'bad-json';
    detail: string;
    raw: string;
}
/** Parsed fine, but carried no `actions`/`action` field at all. */
 | {
    reason: 'no-actions';
}
/** Parsed fine and had an actions list, but it was empty. */
 | {
    reason: 'empty-actions';
}
/** Every action's `type` failed to normalize. `types` holds the raw strings
 *  the model emitted, so the message can name them. */
 | {
    reason: 'unknown-types';
    types: string[];
};
/**
 * The one place the user-facing sentence for each failure is written, so it
 * is unit-testable and cannot quietly regress to a generic "something went
 * wrong" again.
 *
 * Every string ends with "Nothing was changed." — which is always true here:
 * this whole code path runs on the model's text before any apply call exists,
 * so no write has been attempted, let alone made. That reassurance is
 * precisely what the old sentence left the user to guess at.
 */
declare function describeCoachProposalFailure(failure: CoachProposalFailure): string;
interface ExtractedCoachProposals {
    /** The assistant's message text with all ```coach-proposal blocks removed. */
    cleaned: string;
    /** Fully parsed, validated proposal blocks ready to render as cards. */
    proposals: CoachProposalBlock[];
    /** True while a coach-proposal block is still being streamed in (not yet closed by a trailing ```). */
    pending: boolean;
    /**
     * Non-null when a fully-closed ```coach-proposal block was present but
     * produced zero renderable proposals — carrying WHICH of the four ways it
     * failed (see CoachProposalFailure).
     *
     * Without this, that case is indistinguishable from "no proposal was ever
     * intended": the block is stripped from `cleaned` either way, so the
     * assistant's prose can say "Here's the proposal:" while nothing renders
     * for the user to review or apply. Callers must surface
     * `describeCoachProposalFailure(...)` as a visible inline notice — never a
     * silent no-op, and never a generic one.
     */
    unrenderable: CoachProposalFailure | null;
}
/**
 * Extracts ```coach-proposal fenced blocks from raw assistant content.
 * Returns the cleaned content (with blocks removed) plus parsed blocks.
 *
 * Handles three streaming states:
 *  - closed block (```coach-proposal ... ```)        parsed into proposals, stripped from cleaned text
 *  - open block at end (model still streaming JSON)   stripped from cleaned text, `pending` flagged so UI shows a placeholder
 *  - opening fence partially typed (e.g. "```coach")   trimmed off the tail so the user never sees raw fence/JSON
 */
declare function extractCoachProposals(raw: string): ExtractedCoachProposals;

interface DayAnalysisScheduleBlockInput {
    id: string;
    title: string;
    category: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    goalId?: string;
    goalTitle?: string;
}
interface DayAnalysisTimeEntryInput {
    id: string;
    taskName: string;
    /** Minutes. */
    duration: number;
    /** YYYY-MM-DD, local. */
    date: string;
    scheduleBlockId?: string;
    goalId?: string;
    goalTitle?: string;
}
interface BuildDayAnalysisInput {
    /** The day being analyzed, YYYY-MM-DD local. */
    dateKey: string;
    /** Defaults to `new Date()` — only overridden by tests for deterministic "today"/"yesterday" labeling. */
    now?: Date;
    /** This day's scheduled blocks (already filtered to `dayOfWeek === new Date(dateKey).getDay()`). */
    scheduleBlocksForDay: DayAnalysisScheduleBlockInput[];
    /** Time entries logged on `dateKey`. */
    timeEntriesForDay: DayAnalysisTimeEntryInput[];
    /**
     * Time entries from a trailing lookback window BEFORE `dateKey` (never
     * including it) — used only to compute "is this unusual" comparisons:
     * per-block completion history and per-goal daily averages. A wider
     * window gives sturdier patterns but costs more tokens; callers choose
     * the range (the mobile quick action uses 28 days).
     */
    trailingTimeEntries: DayAnalysisTimeEntryInput[];
    /** How many days `trailingTimeEntries` actually spans — needed to turn a trailing total into a daily average. Must be > 0 for goal-average comparisons to be produced. */
    trailingWindowDays: number;
    /** This day's journal entry text, or null/undefined if none was written. */
    journalContent?: string | null;
    /**
     * How many past same-weekday occurrences to look back across
     * `trailingTimeEntries` when judging a block's completion pattern.
     * Default 4 (roughly a month for a weekly-recurring block).
     */
    lookbackOccurrences?: number;
}
interface DayAnalysisBlockResult {
    id: string;
    title: string;
    category: string;
    startTime: string;
    endTime: string;
    goalId?: string;
    goalTitle?: string;
    trackedMinutes: number;
    completed: boolean;
    /** e.g. "completed 1 of the last 4 Wednesdays" — omitted when there's no trailing history to compare against. */
    completionHistory?: string;
}
interface DayAnalysisGoalResult {
    goalId: string;
    title: string;
    minutesToday: number;
    /** Average daily minutes logged toward this goal over the trailing window (excluding the analyzed day). */
    trailingDailyAverageMinutes: number;
    comparisonLabel: 'well above usual' | 'above usual' | 'about typical' | 'below usual' | 'well below usual' | 'no recent baseline';
}
interface DayAnalysisBundle {
    dateKey: string;
    /** "today", "yesterday", or "Wednesday, August 13" — for prompt phrasing. */
    dateLabel: string;
    dayOfWeekLabel: string;
    blocks: DayAnalysisBlockResult[];
    /** Entries logged today that aren't linked to any of today's scheduled blocks — ad hoc / unscheduled work. */
    unscheduledEntries: DayAnalysisTimeEntryInput[];
    goalBreakdown: DayAnalysisGoalResult[];
    totalTrackedMinutes: number;
    completedBlockCount: number;
    totalBlockCount: number;
    journalContent: string | null;
    /** Extra human-readable notable-pattern lines, beyond what's implied by the per-block/per-goal fields above. */
    patterns: string[];
}
/**
 * Assemble one day's schedule + tracked time + journal entry into a single
 * bundle, with lightweight pattern detection (block completion history,
 * goal-time deviation from the recent daily average) computed against the
 * supplied trailing window. Pure function — every input is data the caller
 * already fetched, nothing here talks to the network.
 */
declare function buildDayAnalysisBundle(input: BuildDayAnalysisInput): DayAnalysisBundle;
/**
 * Render a `DayAnalysisBundle` as a well-formed chat message the mobile
 * Coach screen's "Analyze my day" action posts through the existing
 * `apiClient.coach.streamChat`. Plain, readable prose+lists rather than a
 * JSON dump — this text becomes the USER turn's persisted content, so it's
 * also what renders in the chat bubble history, not a hidden side-channel.
 */
declare function formatDayAnalysisPrompt(bundle: DayAnalysisBundle): string;

type ConversationKind = 'live' | 'archived';
interface ConversationIndexEntry {
    id: string;
    kind: ConversationKind;
    scopeKey: string;
    /** Derived from the conversation's first message, truncated. */
    title: string;
    /** Derived from the conversation's most recent message, truncated. */
    preview: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
}
/** One role/content pair, independent of whichever screen produced it (Voice's transcript+reply, Coach's CoachMessageDto) — the common shape an archive snapshot is built from. */
interface ConversationTurnSnapshot {
    role: 'USER' | 'ASSISTANT';
    content: string;
}
/**
 * Collapses whitespace/newlines (a multi-line message otherwise breaks a
 * one-line list row) and truncates with an ellipsis. Ported in spirit from
 * apps/mobile's messaging/format.ts `formatMessagePreview` — that one is
 * mobile-only (imports nothing shared-unsafe) so this is a small
 * reimplementation rather than a cross-import.
 */
declare function truncateConversationText(text: string, maxLength: number): string;
/** Title for a new index entry, derived from the conversation's first message. */
declare function deriveConversationTitle(firstMessageContent: string): string;
/** Preview line for an index entry, derived from the conversation's most recent message. */
declare function deriveConversationPreview(lastMessageContent: string): string;
/** Most recently active conversation first. */
declare function sortConversationsByRecency(entries: readonly ConversationIndexEntry[]): ConversationIndexEntry[];
/**
 * Upserts the "live" entry for `scopeKey` — called after every successful
 * send. `id` is always `scopeKey` for a live entry, so this is a lookup by
 * scopeKey, not by id: a fresh entry is created with `messageCount: 1` and
 * `createdAt = now`; an existing one keeps its `createdAt` and gets its
 * `messageCount` incremented, `title` reset only if it didn't have one yet
 * (the first message stays the title for the life of the conversation),
 * and `preview`/`updatedAt` always refreshed to the latest message.
 */
declare function upsertLiveConversationEntry(entries: readonly ConversationIndexEntry[], input: {
    scopeKey: string;
    latestMessageContent: string;
    now: string;
}): ConversationIndexEntry[];
/**
 * "New chat" step 5: after the server conversation for `scopeKey` has been
 * cleared, the live entry for it goes back to looking fresh — zeroed
 * message count, no title/preview left over from the conversation that just
 * got archived. Does not remove the entry: the scopeKey is still a real,
 * still-fetchable (now-empty) server conversation, not gone the way an
 * archived one's server row is.
 */
declare function resetLiveConversationEntry(entries: readonly ConversationIndexEntry[], scopeKey: string, now: string): ConversationIndexEntry[];
/** Inserts a freshly-archived entry (see coach-history-store.ts's `archiveConversation`). */
declare function insertArchivedConversationEntry(entries: readonly ConversationIndexEntry[], entry: ConversationIndexEntry): ConversationIndexEntry[];
/** Local-only "hide from list" — never touches the server conversation a `live` entry points at. */
declare function removeConversationIndexEntry(entries: readonly ConversationIndexEntry[], id: string): ConversationIndexEntry[];
/** Builds the id -> title/preview pair an archive snapshot's index entry needs, from the turns being archived. */
declare function summariseTurnsForArchive(turns: readonly ConversationTurnSnapshot[]): {
    title: string;
    preview: string;
};

declare const VOICE_INTENT_TYPES: readonly ["START_TRACKING", "STOP_TRACKING", "PAUSE", "RESUME", "LOG_TIME", "APPEND_NOTE", "UNKNOWN"];
type VoiceIntentType = (typeof VOICE_INTENT_TYPES)[number];
declare const TARGET_KINDS: readonly ["goal", "task", "category", "note"];
/** What a spoken name refers to, in the host's broad buckets. */
type TargetKind = (typeof TARGET_KINDS)[number];
/**
 * A speaker can name something without saying what type it is ("start
 * tracking deen"). Guessing the kind there would be inventing knowledge the
 * parser does not have, so it says so and the resolver searches everything.
 */
type SpokenTargetKind = TargetKind | 'unspecified';
interface NoTarget {
    readonly kind: 'none';
}
interface NamedTarget {
    readonly kind: SpokenTargetKind;
    readonly name: string;
}
type IntentTarget = NoTarget | NamedTarget;
declare const NO_TARGET: NoTarget;
declare function namedTarget(kind: SpokenTargetKind, name: string): NamedTarget;
declare function isNamedTarget(target: IntentTarget): target is NamedTarget;
interface IntentFields {
    /** The transcript exactly as it arrived, before any normalization. */
    readonly transcript: string;
    /** How sure the parser is, from 0 to 1. */
    readonly confidence: number;
}
interface StartTrackingIntent extends IntentFields {
    readonly type: 'START_TRACKING';
    readonly target: IntentTarget;
}
interface StopTrackingIntent extends IntentFields {
    readonly type: 'STOP_TRACKING';
    readonly target: IntentTarget;
}
interface PauseIntent extends IntentFields {
    readonly type: 'PAUSE';
    readonly target: IntentTarget;
}
interface ResumeIntent extends IntentFields {
    readonly type: 'RESUME';
    readonly target: IntentTarget;
}
interface LogTimeIntent extends IntentFields {
    readonly type: 'LOG_TIME';
    readonly target: IntentTarget;
    /** May be fractional, so "log 45 seconds" survives the trip. */
    readonly durationMinutes: number;
}
/**
 * "Add this to my shopping notes" — writes a spoken sentence onto the end of
 * an existing page rather than replacing anything on it. Deliberately NOT in
 * `isReversibleVoiceIntent`'s set: like LOG_TIME, this appends unreviewed
 * spoken text to a record that outlives the session, so it confirms first
 * instead of running the instant it is heard. See
 * apps/mobile/src/components/voice/note-commands.ts.
 */
interface AppendNoteIntent extends IntentFields {
    readonly type: 'APPEND_NOTE';
    readonly target: IntentTarget;
    /**
     * The words to write into the page, exactly as heard. Unlike every other
     * field on every other intent here, this is NOT folded — it is written
     * into the note close to verbatim, so the casing and punctuation the
     * speaker actually used survive the trip.
     */
    readonly content: string;
}
/**
 * The parser understood nothing it is willing to act on. Carries no target
 * field at all (rather than a `none` target) so a caller cannot read a
 * target off an intent that has no meaning without narrowing first.
 */
interface UnknownIntent extends IntentFields {
    readonly type: 'UNKNOWN';
}
type ActionableVoiceIntent = StartTrackingIntent | StopTrackingIntent | PauseIntent | ResumeIntent | LogTimeIntent | AppendNoteIntent;
type VoiceIntent = ActionableVoiceIntent | UnknownIntent;
/**
 * Confidence is compared against thresholds by every caller, so a value
 * outside 0..1 or a NaN leaking out would silently break those comparisons
 * rather than fail. Rounding keeps scores stable enough to assert on.
 */
declare function clampConfidence(value: number): number;
declare function unknownIntent(transcript: string, confidence?: number): UnknownIntent;
declare function isActionableVoiceIntent(intent: VoiceIntent): intent is ActionableVoiceIntent;
/**
 * The four transport intents. Named as a set because the whole confirmation
 * policy hangs off it: these change nothing a user cannot undo by speaking
 * the opposite word, so they run immediately, while LOG_TIME writes a record
 * and does not. See apps/mobile/src/components/voice/TrackerVoiceButton.tsx.
 */
declare function isReversibleVoiceIntent(intent: VoiceIntent): boolean;

/**
 * The words English uses to say what type of thing was just named. The
 * parser needs them to read the kind out of "my deen goal"; the resolver
 * needs the same vocabulary so a caller passing a raw spoken phrase is not
 * punished for the word "goal" still being attached.
 */
declare const DEFAULT_KIND_WORDS: Readonly<Record<string, TargetKind>>;
/**
 * Reduces text to the lowercase alphanumeric skeleton matching works on.
 * Both sides of every comparison go through here, which is the point: a goal
 * stored as "Qur'an Study" and a transcript reading "quran study" have to
 * fold to the same thing or nothing else matters.
 *
 * Apostrophes close up rather than becoming spaces, so "deen's" folds to
 * "deens" on both sides instead of to a word only one side has.
 */
declare function foldText(input: string): string;
interface DurationMatch {
    readonly minutes: number;
    /** Index range in the token array the duration occupied, end-exclusive. */
    readonly start: number;
    readonly end: number;
    /** True when a bare number had no unit and minutes were assumed. */
    readonly assumedUnit: boolean;
}
/**
 * Finds one spoken quantity of time in a token run, reading the forms
 * people actually use: "30 minutes", "1 hour 30", "an hour and a half",
 * "half an hour", "a quarter of an hour", "90 seconds", and a bare "30"
 * (assumed minutes, and penalised for it).
 *
 * Returns the token span too, so the caller can lift the duration out and
 * leave the rest of the sentence as the target's name.
 */
declare function findSpokenDuration(tokens: readonly string[]): DurationMatch | null;
interface ParseVoiceCommandOptions {
    /**
     * Words the app is addressed by, dropped from the front of an utterance.
     * Configurable because the name of the thing being spoken to belongs to
     * the host, not to the parser.
     */
    readonly wakeWords?: readonly string[];
    /** Replaces the default spoken-kind vocabulary wholesale. */
    readonly kindWords?: Readonly<Record<string, TargetKind>>;
    /** Anything scoring below this is reported as UNKNOWN. Default 0. */
    readonly minConfidence?: number;
}
interface ContentTargetSplit {
    readonly target: NamedTarget;
    /** Index into `tail` the chosen connective sits at — everything before it is content. */
    readonly contentEnd: number;
}
/**
 * "CONTENT to my NAME notes" — the shape every other rule group does not
 * need, because every other command's tail is *only* a target. Here the tail
 * is two things at once, and nothing marks where one ends and the other
 * begins except the connective in front of an explicitly note-flavoured
 * name.
 *
 * Scans `tail` from the END rather than the front, and returns on the FIRST
 * (i.e. rightmost) connective whose remainder resolves to a `note` target.
 * That direction is what keeps a "to" inside the content from being mistaken
 * for the split: "remind him to call back to my errands notes" has two
 * "to"s, and trying the rightmost one first finds the valid split (my
 * errands notes) immediately, so the earlier "to" — sitting inside what the
 * user actually wants written down — is never considered as a candidate at
 * all.
 *
 * Requiring the remainder's kind to resolve to exactly `'note'` (not
 * `'unspecified'`) is the whole disambiguator: it is what a plain "add milk
 * to my shopping" (no kind word) fails, and what "add milk to my shopping
 * notes" (an explicit kind word) passes. Without it, the connective would
 * split on the FIRST "to" it tried and hand ordinary "add a task to X"
 * phrasing to this rule instead of leaving it for the Coach.
 */
declare function splitContentAndTarget(tail: readonly string[], kindWords?: Readonly<Record<string, TargetKind>>): ContentTargetSplit | null;
/**
 * Turns one transcript into one intent. One utterance is one command: a
 * sentence holding two of them parses as the first.
 */
declare function parseVoiceCommand(transcript: string, options?: ParseVoiceCommandOptions): VoiceIntent;

/**
 * One of the host's records, flattened to the parts matching needs. Aliases
 * cover the names people actually say for a record stored under something
 * longer or more formal.
 */
interface TargetCandidate {
    readonly id: string;
    readonly name: string;
    readonly kind: TargetKind;
    readonly aliases?: readonly string[];
}
interface ResolvedTarget {
    readonly id: string;
    readonly name: string;
    readonly kind: TargetKind;
    /** 0..1. How close the spoken name was to this record's name or an alias. */
    readonly score: number;
    /** Which string actually matched — the record's name, or one of its aliases. */
    readonly matchedOn: string;
}
type TargetResolutionStatus = 'confident' | 'needs-confirmation' | 'unresolved';
interface TargetResolution {
    readonly status: TargetResolutionStatus;
    /** The winner. Null only when `status` is 'unresolved'. */
    readonly target: ResolvedTarget | null;
    /** Everything that scored at or above the floor, best first, winner included. */
    readonly candidates: readonly ResolvedTarget[];
    /** Why confirmation is being asked for. Absent when `status` is 'confident'. */
    readonly reason?: 'ambiguous' | 'weak-match' | 'no-match';
}
/** How alike two names are, 0..1, after folding both. Pure and deterministic. */
declare function nameSimilarity(a: string, b: string): number;
interface ResolveTargetOptions {
    readonly minScore?: number;
    readonly confidentScore?: number;
    readonly ambiguityMargin?: number;
    readonly maxCandidates?: number;
    readonly kindWords?: Readonly<Record<string, TargetKind>>;
}
/** Every candidate scoring at or above the floor, best first. */
declare function rankTargets(target: NamedTarget, candidates: readonly TargetCandidate[], options?: ResolveTargetOptions): readonly ResolvedTarget[];
/**
 * Classifies a spoken name against the user's records. Never returns a
 * winner it is not prepared to defend: a soft match and a photo-finish both
 * come back as 'needs-confirmation' with the ranking attached, and nothing
 * at all comes back as 'unresolved' rather than as the least-bad guess.
 */
declare function resolveSpokenTarget(target: NamedTarget, candidates: readonly TargetCandidate[], options?: ResolveTargetOptions): TargetResolution;

declare const SHARED_PACKAGE_NAME = "@goalslot/shared";

export { type ActionableVoiceIntent, type ActiveTimerAttributionInput, type ActiveTimerClient, type ActiveTimerConflict, type ActiveTimerSession, type ActiveTimerSessionGoalSummary, type ActiveTimerSessionScheduleBlockSummary, type ActiveTimerSessionStatus, type ActiveTimerSessionTaskSummary, type AlarmCapability, type AnalyticsCapability, type AnalyticsEvent, type AnalyticsEventMap, type AnalyticsEventName, type ApiClientConfig, type AppNotification, type AppendNoteIntent, type AssignInstructionInput, type AuthTokens, type BuildDayAnalysisInput, COACH_BUDGET_INCREMENT_PERCENTS, COACH_BYOK_MAX_TOKEN_BUDGET, COACH_BYOK_MIN_TOKEN_BUDGET, COACH_BYOK_PROVIDERS, COACH_PROPOSAL_ACTION_TYPES, COACH_RELIGIOUS_CONTEXTS, COACH_VOICE_INTENT_TYPES, type Capabilities, type CategoriesApi, type Category, type CoachApi, type CoachBudgetIncrement, type CoachByokProvider, type CoachByokProviderMeta, type CoachByokState, type CoachByokUsage, type CoachHabitsProfile, type CoachMessageDto, type CoachMessageRole, type CoachProposalAction, type CoachProposalActionType, type CoachProposalBlock, type CoachProposalFailure, type CoachProposalResult, type CoachReligiousContext, type CoachSettingsApi, type CoachStreamChunk, type CoachStreamRequestConfig, type CoachVoiceIntentCandidateGoal, type CoachVoiceIntentCandidateTask, type CoachVoiceIntentContext, type CoachVoiceIntentResponse, type CoachVoiceIntentTarget, type CoachVoiceIntentTimerStatus, type CoachVoiceIntentType, type CompleteTaskInput, type ContentTargetSplit, type ConversationIndexEntry, type ConversationKind, type ConversationTurnSnapshot, type CreateCategoryForm, type CreateGoalInput, type CreateJournalEntryInput, type CreateLabelForm, type CreateMessagingConversationInput, type CreateNoteDto, type CreateScheduleBlockInput, type CreateTaskInput, type CreateTimeEntryInput, DAYS_OF_WEEK, DAYS_OF_WEEK_FULL, DAY_END_MIN, DAY_START_MIN, DEFAULT_KIND_WORDS, DEFAULT_PAGE_SIZE, type DayAnalysisBlockResult, type DayAnalysisBundle, type DayAnalysisGoalResult, type DayAnalysisScheduleBlockInput, type DayAnalysisTimeEntryInput, type ExtractedCoachProposals, type FeatureFlagCapability, type FeatureFlagKey, type FlatNote, GOAL_STATUS_OPTIONS, type Goal, type GoalFilters, type GoalLabel, type GoalStats, type GoalStatus, type GoalSummary, type GoalsApi, IDEMPOTENCY_KEY_HEADER, INDENTATION_WIDTH, type IdempotentRequestOptions, type IncomingShare, type Instruction, type InstructionAssignedByMe, type InstructionAssignedToMe, type InstructionPerson, type InstructionStatus, type InstructionsApi, type InstructionsQueries, type IntentTarget, type JournalApi, type JournalDateRange, type JournalEntry, type Label, type LabelInput, type LabelsApi, type ListMessagesOptions, type LogTimeIntent, type LoginResponse, MAX_JOURNAL_CONTENT_LENGTH, MAX_MESSAGE_LENGTH, type MessagingContact, type MessagingConversation, MessagingError, type MessagingErrorKind, type MessagingMessage, type MessagingParticipant, type MessagingServiceClient, type MessagingServiceConfig, type MessagingSocket, type MessagingSocketConfig, type MessagingSocketLike, type MessagingSocketStatus, type MessagingThreadMessage, type MessagingTokenResponse, type MessagingTokenStore, type MessagingTokenStoreConfig, NO_TARGET, type NamedTarget, type NoTarget, type Note, type NoteDetailResponse, type NoteProjection, type NoteReorderItem, type NoteTreeItem, type NotesApi, type NotificationCapability, type NotificationInput, type NotificationListParams, type NotificationListResponse, type NotificationPermissionStatus, type NotificationQueries, type NotificationsApi, type OfflineOperation, type OfflineStorage, type OfflineSync, type OfflineSyncConfig, type OpenMessagingConversationResponse, type OperationRegistry, type Outbox, type OutboxEntry, type OutgoingShare, type ParseVoiceCommandOptions, type PauseIntent, type PendingMessagingMessage, type PushSubscriptionKind, type PushSubscriptionResponse, type ResolveTargetOptions, type ResolvedTarget, type ResumeIntent, SHARED_PACKAGE_NAME, type ScheduleApi, type ScheduleBlock, type ScheduleBlockGoalSummary, type ScheduleBlockTaskSummary, type ScheduleDeleteScope, type ScheduleUpdateScope, type ScheduledAlarm, type SharingApi, type SharingPeer, type SharingQueries, type SpokenTargetKind, type StartTimerSessionInput, type StartTrackingIntent, type StopTimerSessionInput, type StopTimerSessionResult, type StopTrackingIntent, TARGET_KINDS, type TargetCandidate, type TargetKind, type TargetResolution, type TargetResolutionStatus, type Task, type TaskListFilters, type TaskScheduleBlockSummary, type TaskStatus, type TasksApi, type TimeEntriesApi, type TimeEntry, type TimeEntryScheduleBlockSummary, type TimerSessionApi, type TokenStorage, type UnknownIntent, type UpcomingScheduleBlock, type UpdateCategoryForm, type UpdateGoalInput, type UpdateJournalEntryInput, type UpdateLabelForm, type UpdateNoteDto, type UpdateProfileForm, type UpdateScheduleBlockInput, type UpdateTaskInput, type UpdateTimeEntryInput, type UpdateTimerSessionInput, type UpsertCoachHabitsProfile, type UpsertJournalEntryInput, type User, VOICE_INTENT_TYPES, type VoiceCapability, type VoiceError, type VoiceErrorKind, type VoiceIntent, type VoiceIntentType, type VoiceListenHandlers, type VoicePermissionStatus, type WeekSchedule, applyMessageToConversations, applyReadReceipt, buildDayAnalysisBundle, buildMessagingContacts, buildNoteTree, buildReorderPayload, buildSocketUrl, buildZonedDateFromParts, calculateProgressPercent, clampConfidence, coachBudgetIncrements, coachByokProviderMeta, completeTaskSchema, confirmPendingMessage, contactsByUserId, contactsWithoutConversation, countUnreadConversations, createApiClient, createAuthApi, createCategoriesApi, createCategoryQueries, createCoachApi, createCoachQueries, createCoachSettingsApi, createCoachSettingsQueries, createConsoleAnalytics, createGoalQueries, createGoalSchema, createGoalsApi, createInstructionsApi, createInstructionsQueries, createJournalApi, createJournalEntrySchema, createJournalQueries, createLabelQueries, createLabelsApi, createMessagingApi, createMessagingQueries, createMessagingServiceClient, createMessagingSocket, createMessagingTokenStore, createNoopCapabilities, createNoteQueries, createNotesApi, createNotificationQueries, createNotificationsApi, createOfflineSync, createOperationRegistry, createOutbox, createPushSubscriptionsApi, createScheduleApi, createScheduleBlockSchema, createScheduleQueries, createSharingApi, createSharingQueries, createStaticFeatureFlags, createTaskQueries, createTaskSchema, createTasksApi, createTimeEntriesApi, createTimeEntryQueries, createTimeEntrySchema, createTimerSessionApi, createTimerSessionQueries, createUsersApi, currentCoachWeekScopeKey, deriveConversationPreview, deriveConversationTitle, describeCoachProposalFailure, extractCoachProposals, findCounterpart, findNextScheduleBlock, findParticipant, findSpokenDuration, findUpcomingScheduleBlocks, flattenVisibleTree, foldText, formatCoachTokenCount, formatDayAnalysisPrompt, formatDuration, formatTime12h, genId, getISOWeekKey, getLocalDateString, getLocalTimeString, getProjection, getReportingWeekDates, hasResponse, idempotentConfig, insertArchivedConversationEntry, isActionableVoiceIntent, isCoachBudgetExceededError, isConversationUnread, isNamedTarget, isPendingMessage, isReversibleVoiceIntent, labelInputSchema, lastReadAtFor, markPendingMessage, mergeOlderMessages, mergeServerMessages, minutesToTime, nameSimilarity, namedTarget, newestServerMessage, normalizeCoachActionType, oldestMessageTimestamp, parseCoachByokBudget, parseCoachSseStream, parseIncomingMessage, parseVoiceCommand, postCoachStream, rankTargets, reconcileIncomingMessage, reconnectDelayMs, removeConversationIndexEntry, removePendingMessage, resetLiveConversationEntry, resolveActiveBlock, resolveSpokenTarget, sortConversationsByRecency, sortMessages, splitContentAndTarget, summariseTurnsForArchive, taskStatusSchema, timeToMinutes, toActiveTimerSession, toMessagingError, todayKey, truncateConversationText, unknownIntent, updateGoalSchema, updateJournalEntrySchema, updateScheduleBlockSchema, updateTaskSchema, updateTimeEntrySchema, upsertJournalEntrySchema, upsertLiveConversationEntry, upsertMessage, validateCoachByokKey };
