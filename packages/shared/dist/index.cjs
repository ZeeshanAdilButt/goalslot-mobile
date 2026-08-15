"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  COACH_BUDGET_INCREMENT_PERCENTS: () => COACH_BUDGET_INCREMENT_PERCENTS,
  COACH_BYOK_MAX_TOKEN_BUDGET: () => COACH_BYOK_MAX_TOKEN_BUDGET,
  COACH_BYOK_MIN_TOKEN_BUDGET: () => COACH_BYOK_MIN_TOKEN_BUDGET,
  COACH_BYOK_PROVIDERS: () => COACH_BYOK_PROVIDERS,
  COACH_PROPOSAL_ACTION_TYPES: () => COACH_PROPOSAL_ACTION_TYPES,
  COACH_RELIGIOUS_CONTEXTS: () => COACH_RELIGIOUS_CONTEXTS,
  COACH_VOICE_INTENT_TYPES: () => COACH_VOICE_INTENT_TYPES,
  DAYS_OF_WEEK: () => DAYS_OF_WEEK,
  DAYS_OF_WEEK_FULL: () => DAYS_OF_WEEK_FULL,
  DAY_END_MIN: () => DAY_END_MIN,
  DAY_START_MIN: () => DAY_START_MIN,
  DEFAULT_KIND_WORDS: () => DEFAULT_KIND_WORDS,
  DEFAULT_PAGE_SIZE: () => DEFAULT_PAGE_SIZE,
  GOAL_STATUS_OPTIONS: () => GOAL_STATUS_OPTIONS,
  IDEMPOTENCY_KEY_HEADER: () => IDEMPOTENCY_KEY_HEADER,
  INDENTATION_WIDTH: () => INDENTATION_WIDTH,
  MAX_JOURNAL_CONTENT_LENGTH: () => MAX_JOURNAL_CONTENT_LENGTH,
  MAX_MESSAGE_LENGTH: () => MAX_MESSAGE_LENGTH,
  MessagingError: () => MessagingError,
  NO_TARGET: () => NO_TARGET,
  SHARED_PACKAGE_NAME: () => SHARED_PACKAGE_NAME,
  TARGET_KINDS: () => TARGET_KINDS,
  VOICE_INTENT_TYPES: () => VOICE_INTENT_TYPES,
  applyMessageToConversations: () => applyMessageToConversations,
  applyReadReceipt: () => applyReadReceipt,
  buildDayAnalysisBundle: () => buildDayAnalysisBundle,
  buildMessagingContacts: () => buildMessagingContacts,
  buildNoteTree: () => buildNoteTree,
  buildReorderPayload: () => buildReorderPayload,
  buildSocketUrl: () => buildSocketUrl,
  buildZonedDateFromParts: () => buildZonedDateFromParts,
  calculateProgressPercent: () => calculateProgressPercent,
  clampConfidence: () => clampConfidence,
  coachBudgetIncrements: () => coachBudgetIncrements,
  coachByokProviderMeta: () => coachByokProviderMeta,
  completeTaskSchema: () => completeTaskSchema,
  confirmPendingMessage: () => confirmPendingMessage,
  contactsByUserId: () => contactsByUserId,
  contactsWithoutConversation: () => contactsWithoutConversation,
  countUnreadConversations: () => countUnreadConversations,
  createApiClient: () => createApiClient,
  createAuthApi: () => createAuthApi,
  createCategoriesApi: () => createCategoriesApi,
  createCategoryQueries: () => createCategoryQueries,
  createCoachApi: () => createCoachApi,
  createCoachQueries: () => createCoachQueries,
  createCoachSettingsApi: () => createCoachSettingsApi,
  createCoachSettingsQueries: () => createCoachSettingsQueries,
  createConsoleAnalytics: () => createConsoleAnalytics,
  createGoalQueries: () => createGoalQueries,
  createGoalSchema: () => createGoalSchema,
  createGoalsApi: () => createGoalsApi,
  createInstructionsApi: () => createInstructionsApi,
  createInstructionsQueries: () => createInstructionsQueries,
  createJournalApi: () => createJournalApi,
  createJournalEntrySchema: () => createJournalEntrySchema,
  createJournalQueries: () => createJournalQueries,
  createLabelQueries: () => createLabelQueries,
  createLabelsApi: () => createLabelsApi,
  createMessagingApi: () => createMessagingApi,
  createMessagingQueries: () => createMessagingQueries,
  createMessagingServiceClient: () => createMessagingServiceClient,
  createMessagingSocket: () => createMessagingSocket,
  createMessagingTokenStore: () => createMessagingTokenStore,
  createNoopCapabilities: () => createNoopCapabilities,
  createNoteQueries: () => createNoteQueries,
  createNotesApi: () => createNotesApi,
  createOfflineSync: () => createOfflineSync,
  createOperationRegistry: () => createOperationRegistry,
  createOutbox: () => createOutbox,
  createPushSubscriptionsApi: () => createPushSubscriptionsApi,
  createScheduleApi: () => createScheduleApi,
  createScheduleBlockSchema: () => createScheduleBlockSchema,
  createScheduleQueries: () => createScheduleQueries,
  createSharingApi: () => createSharingApi,
  createSharingQueries: () => createSharingQueries,
  createStaticFeatureFlags: () => createStaticFeatureFlags,
  createTaskQueries: () => createTaskQueries,
  createTaskSchema: () => createTaskSchema,
  createTasksApi: () => createTasksApi,
  createTimeEntriesApi: () => createTimeEntriesApi,
  createTimeEntryQueries: () => createTimeEntryQueries,
  createTimeEntrySchema: () => createTimeEntrySchema,
  createTimerSessionApi: () => createTimerSessionApi,
  createTimerSessionQueries: () => createTimerSessionQueries,
  createUsersApi: () => createUsersApi,
  currentCoachWeekScopeKey: () => currentCoachWeekScopeKey,
  deriveConversationPreview: () => deriveConversationPreview,
  deriveConversationTitle: () => deriveConversationTitle,
  extractCoachProposals: () => extractCoachProposals,
  findCounterpart: () => findCounterpart,
  findNextScheduleBlock: () => findNextScheduleBlock,
  findParticipant: () => findParticipant,
  findSpokenDuration: () => findSpokenDuration,
  findUpcomingScheduleBlocks: () => findUpcomingScheduleBlocks,
  flattenVisibleTree: () => flattenVisibleTree,
  foldText: () => foldText,
  formatCoachTokenCount: () => formatCoachTokenCount,
  formatDayAnalysisPrompt: () => formatDayAnalysisPrompt,
  formatDuration: () => formatDuration,
  formatTime12h: () => formatTime12h,
  genId: () => genId,
  getISOWeekKey: () => getISOWeekKey,
  getLocalDateString: () => getLocalDateString,
  getLocalTimeString: () => getLocalTimeString,
  getProjection: () => getProjection,
  getReportingWeekDates: () => getReportingWeekDates,
  hasResponse: () => hasResponse,
  idempotentConfig: () => idempotentConfig,
  insertArchivedConversationEntry: () => insertArchivedConversationEntry,
  isActionableVoiceIntent: () => isActionableVoiceIntent,
  isCoachBudgetExceededError: () => isCoachBudgetExceededError,
  isConversationUnread: () => isConversationUnread,
  isNamedTarget: () => isNamedTarget,
  isPendingMessage: () => isPendingMessage,
  isReversibleVoiceIntent: () => isReversibleVoiceIntent,
  labelInputSchema: () => labelInputSchema,
  lastReadAtFor: () => lastReadAtFor,
  markPendingMessage: () => markPendingMessage,
  mergeOlderMessages: () => mergeOlderMessages,
  mergeServerMessages: () => mergeServerMessages,
  minutesToTime: () => minutesToTime,
  nameSimilarity: () => nameSimilarity,
  namedTarget: () => namedTarget,
  newestServerMessage: () => newestServerMessage,
  normalizeCoachActionType: () => normalizeCoachActionType,
  oldestMessageTimestamp: () => oldestMessageTimestamp,
  parseCoachByokBudget: () => parseCoachByokBudget,
  parseCoachSseStream: () => parseCoachSseStream,
  parseIncomingMessage: () => parseIncomingMessage,
  parseVoiceCommand: () => parseVoiceCommand,
  postCoachStream: () => postCoachStream,
  rankTargets: () => rankTargets,
  reconcileIncomingMessage: () => reconcileIncomingMessage,
  reconnectDelayMs: () => reconnectDelayMs,
  removeConversationIndexEntry: () => removeConversationIndexEntry,
  removePendingMessage: () => removePendingMessage,
  resetLiveConversationEntry: () => resetLiveConversationEntry,
  resolveActiveBlock: () => resolveActiveBlock,
  resolveSpokenTarget: () => resolveSpokenTarget,
  sortConversationsByRecency: () => sortConversationsByRecency,
  sortMessages: () => sortMessages,
  splitContentAndTarget: () => splitContentAndTarget,
  summariseTurnsForArchive: () => summariseTurnsForArchive,
  taskStatusSchema: () => taskStatusSchema,
  timeToMinutes: () => timeToMinutes,
  toActiveTimerSession: () => toActiveTimerSession,
  toMessagingError: () => toMessagingError,
  todayKey: () => todayKey,
  truncateConversationText: () => truncateConversationText,
  unknownIntent: () => unknownIntent,
  updateGoalSchema: () => updateGoalSchema,
  updateJournalEntrySchema: () => updateJournalEntrySchema,
  updateScheduleBlockSchema: () => updateScheduleBlockSchema,
  updateTaskSchema: () => updateTaskSchema,
  updateTimeEntrySchema: () => updateTimeEntrySchema,
  upsertJournalEntrySchema: () => upsertJournalEntrySchema,
  upsertLiveConversationEntry: () => upsertLiveConversationEntry,
  upsertMessage: () => upsertMessage,
  validateCoachByokKey: () => validateCoachByokKey
});
module.exports = __toCommonJS(index_exports);

// src/types/goal.ts
var GOAL_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" }
];

// src/types/messaging.ts
function isPendingMessage(message) {
  return "clientId" in message;
}

// src/validation/goal.ts
var import_zod = require("zod");
var labelInputSchema = import_zod.z.object({
  name: import_zod.z.string().min(1, "Label name is required"),
  color: import_zod.z.string().optional()
});
var createGoalSchema = import_zod.z.object({
  title: import_zod.z.string().min(1, "Title is required"),
  description: import_zod.z.string().optional(),
  category: import_zod.z.string().min(1, "Category is required (value from the user's categories)"),
  targetHours: import_zod.z.number().min(1, "Target hours must be at least 1"),
  deadline: import_zod.z.string().optional(),
  color: import_zod.z.string().optional(),
  isPrivate: import_zod.z.boolean().optional(),
  labels: import_zod.z.array(labelInputSchema).optional()
});
var updateGoalSchema = createGoalSchema.partial().extend({
  status: import_zod.z.enum(["ACTIVE", "COMPLETED", "PAUSED"]).optional(),
  loggedHours: import_zod.z.number().optional()
});

// src/validation/task.ts
var import_zod2 = require("zod");
var taskStatusSchema = import_zod2.z.enum(["BACKLOG", "TODO", "DOING", "DONE"]);
var createTaskSchema = import_zod2.z.object({
  title: import_zod2.z.string().min(1, "Title is required"),
  description: import_zod2.z.string().optional(),
  category: import_zod2.z.string().optional(),
  status: taskStatusSchema.optional(),
  estimatedMinutes: import_zod2.z.number().min(1, "Estimated minutes must be at least 1").optional(),
  goalId: import_zod2.z.string().uuid().optional(),
  scheduleBlockId: import_zod2.z.string().uuid().optional(),
  dueDate: import_zod2.z.string().optional(),
  notes: import_zod2.z.string().optional()
});
var updateTaskSchema = createTaskSchema.partial();
var completeTaskSchema = import_zod2.z.object({
  actualMinutes: import_zod2.z.number().min(1, "Actual minutes must be at least 1"),
  notes: import_zod2.z.string().optional(),
  date: import_zod2.z.string().optional()
});

// src/validation/schedule.ts
var import_zod3 = require("zod");
var HH_MM_PATTERN = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
var createScheduleBlockSchema = import_zod3.z.object({
  title: import_zod3.z.string().min(1, "Title is required"),
  startTime: import_zod3.z.string().regex(HH_MM_PATTERN, "Start time must be in HH:mm format"),
  endTime: import_zod3.z.string().regex(HH_MM_PATTERN, "End time must be in HH:mm format"),
  dayOfWeek: import_zod3.z.number().int().min(0).max(6),
  category: import_zod3.z.string().min(1, "Category is required (value from the user's categories)"),
  color: import_zod3.z.string().optional(),
  isRecurring: import_zod3.z.boolean().optional(),
  isPrivate: import_zod3.z.boolean().optional(),
  goalId: import_zod3.z.string().uuid().optional(),
  seriesId: import_zod3.z.string().uuid().optional()
});
var updateScheduleBlockSchema = createScheduleBlockSchema.partial().extend({
  updateScope: import_zod3.z.enum(["single", "series"]).optional()
});

// src/validation/time-entry.ts
var import_zod4 = require("zod");
var createTimeEntrySchema = import_zod4.z.object({
  taskName: import_zod4.z.string().min(1, "Task name is required"),
  duration: import_zod4.z.number().min(1, "Duration must be at least 1 minute"),
  date: import_zod4.z.string().min(1, "Date is required"),
  notes: import_zod4.z.string().optional(),
  startedAt: import_zod4.z.string().optional(),
  taskTitle: import_zod4.z.string().optional(),
  goalId: import_zod4.z.string().uuid().optional(),
  scheduleBlockId: import_zod4.z.string().uuid().optional(),
  taskId: import_zod4.z.string().uuid().optional()
});
var updateTimeEntrySchema = createTimeEntrySchema.partial();

// src/validation/journal.ts
var import_zod5 = require("zod");
var MAX_JOURNAL_CONTENT_LENGTH = 65535;
var YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
var upsertJournalEntrySchema = import_zod5.z.object({
  date: import_zod5.z.string().regex(YYYY_MM_DD, "Date must be YYYY-MM-DD"),
  content: import_zod5.z.string().max(MAX_JOURNAL_CONTENT_LENGTH, "Entry is too long to save")
});
var updateJournalEntrySchema = import_zod5.z.object({
  content: import_zod5.z.string().max(MAX_JOURNAL_CONTENT_LENGTH, "Entry is too long to save")
});
var createJournalEntrySchema = upsertJournalEntrySchema;

// src/scheduling/time.ts
function timeToMinutes(time) {
  const [hoursStr, minutesStr] = time.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  return hours * 60 + minutes;
}
function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}
function formatTime12h(time) {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const ampm = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${ampm}`;
}
function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return "0m";
  const normalizedMinutes = Math.floor(minutes);
  const hours = Math.floor(normalizedMinutes / 60);
  const mins = normalizedMinutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
function getLocalDateString(date = /* @__PURE__ */ new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getLocalTimeString(date = /* @__PURE__ */ new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
function todayKey(date = /* @__PURE__ */ new Date()) {
  return getLocalDateString(date);
}
function getISOWeekKey(d = /* @__PURE__ */ new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
var DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var DAYS_OF_WEEK_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

// src/scheduling/reporting.ts
var import_date_fns = require("date-fns");
function getReportingWeekDates(date = /* @__PURE__ */ new Date()) {
  const start = (0, import_date_fns.startOfWeek)(date, { weekStartsOn: 1 });
  const end = (0, import_date_fns.endOfWeek)(date, { weekStartsOn: 1 });
  const days = [];
  for (let i = 0; i < 7; i++) {
    days.push((0, import_date_fns.addDays)(start, i));
  }
  return { start, end, days };
}

// src/scheduling/grid.ts
var DAY_START_MIN = 0;
var DAY_END_MIN = 24 * 60;

// src/scheduling/progress.ts
function calculateProgressPercent(logged, target) {
  if (!Number.isFinite(logged) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.min(100, Math.round(logged / target * 100));
}

// src/scheduling/fire-time.ts
var import_date_fns2 = require("date-fns");
var import_date_fns_tz = require("date-fns-tz");
function pad2(n) {
  return n.toString().padStart(2, "0");
}
function zonedCalendarParts(instant, timezone) {
  const zoned = (0, import_date_fns_tz.toZonedTime)(instant, timezone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth(),
    day: zoned.getDate(),
    weekday: zoned.getDay(),
    minutesOfDay: zoned.getHours() * 60 + zoned.getMinutes()
  };
}
function buildZonedDateFromParts(dateString, timeString, timezone) {
  const [yearStr, monthStr, dayStr] = dateString.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const [hours = 0, minutes = 0] = (timeString || "00:00").split(":").map(Number);
  const naive = new Date(year || 1970, (month || 1) - 1, day || 1, hours, minutes, 0, 0);
  return (0, import_date_fns_tz.fromZonedTime)(naive, timezone);
}
function resolveActiveBlock(weekSchedule, now, timezone) {
  if (!weekSchedule) return null;
  const { weekday, minutesOfDay } = zonedCalendarParts(now, timezone);
  const blocks = weekSchedule[weekday] || [];
  return blocks.find((block) => {
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    return minutesOfDay >= start && minutesOfDay < end;
  }) ?? null;
}
function findUpcomingScheduleBlocks(weekSchedule, now, timezone, count) {
  if (!weekSchedule || count <= 0) return [];
  const nowParts = zonedCalendarParts(now, timezone);
  const calendarAnchor = new Date(nowParts.year, nowParts.month, nowParts.day);
  const out = [];
  for (let offset = 0; offset < 7 && out.length < count; offset++) {
    const weekday = (nowParts.weekday + offset) % 7;
    const blocks = (weekSchedule[weekday] || []).slice().sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    if (blocks.length === 0) continue;
    const targetCalendarDate = (0, import_date_fns2.addDays)(calendarAnchor, offset);
    const dateString = `${targetCalendarDate.getFullYear()}-${pad2(targetCalendarDate.getMonth() + 1)}-${pad2(targetCalendarDate.getDate())}`;
    for (const block of blocks) {
      const blockStart = timeToMinutes(block.startTime);
      if (offset === 0 && blockStart <= nowParts.minutesOfDay) continue;
      const startsAtUtc = buildZonedDateFromParts(dateString, block.startTime, timezone);
      out.push({ block, startsAtUtc });
      if (out.length >= count) break;
    }
  }
  return out;
}
function findNextScheduleBlock(weekSchedule, now, timezone) {
  return findUpcomingScheduleBlocks(weekSchedule, now, timezone, 1)[0] ?? null;
}

// src/notes/tree.ts
var INDENTATION_WIDTH = 24;
function buildNoteTree(notes) {
  const noteMap = /* @__PURE__ */ new Map();
  const roots = [];
  notes.forEach((note) => {
    noteMap.set(note.id, { ...note, children: [], depth: 0 });
  });
  noteMap.forEach((treeItem) => {
    if (treeItem.parentId && treeItem.parentId !== treeItem.id && noteMap.has(treeItem.parentId)) {
      noteMap.get(treeItem.parentId).children.push(treeItem);
    } else {
      roots.push(treeItem);
    }
  });
  const visited = /* @__PURE__ */ new Set();
  const walk = (item, depth) => {
    item.depth = depth;
    item.children = item.children.filter((child) => {
      if (visited.has(child.id)) return false;
      visited.add(child.id);
      return true;
    });
    item.children.forEach((child) => walk(child, depth + 1));
  };
  roots.forEach((root) => visited.add(root.id));
  roots.forEach((root) => walk(root, 0));
  noteMap.forEach((item) => {
    if (!visited.has(item.id)) {
      visited.add(item.id);
      roots.push(item);
      walk(item, 0);
    }
  });
  const sortByOrder = (items) => {
    items.sort((a, b) => a.order - b.order);
    items.forEach((item) => sortByOrder(item.children));
  };
  sortByOrder(roots);
  return roots;
}
function countDescendants(item) {
  let n = 0;
  const stack = [...item.children];
  while (stack.length) {
    const cur = stack.pop();
    n += 1;
    for (const c of cur.children) stack.push(c);
  }
  return n;
}
function flattenVisibleTree(tree, collapsedIds, activeId) {
  const out = [];
  const walk = (items, depth) => {
    for (const item of items) {
      const { children, ...note } = item;
      out.push({
        ...note,
        depth,
        childCount: children.length,
        descendantCount: countDescendants(item)
      });
      if (children.length === 0) continue;
      if (item.id === activeId) continue;
      if (collapsedIds.has(item.id)) continue;
      walk(children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}
function getDragDepth(offset, indentationWidth) {
  return Math.round(offset / indentationWidth);
}
function getProjection(items, activeId, overId, dragOffset, indentationWidth) {
  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);
  const activeItem = items[activeItemIndex];
  if (overItemIndex === -1 || activeItemIndex === -1 || !activeItem) {
    return { depth: 0, maxDepth: 0, minDepth: 0, parentId: null, insertAfterId: null };
  }
  const without = items.filter(({ id }) => id !== activeId);
  const requestedDepth = Math.max(
    0,
    activeItem.depth + getDragDepth(dragOffset, indentationWidth)
  );
  let p = overItemIndex;
  while (p < without.length && (without[p]?.depth ?? 0) > requestedDepth) p++;
  const previousItem = without[p - 1];
  const nextItem = without[p];
  const maxDepth = previousItem ? previousItem.depth + 1 : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  let depth = requestedDepth;
  if (depth > maxDepth) depth = maxDepth;
  if (depth < minDepth) depth = minDepth;
  return {
    depth,
    maxDepth,
    minDepth,
    parentId: getParentId(),
    insertAfterId: previousItem?.id ?? null
  };
  function getParentId() {
    if (depth === 0 || !previousItem) return null;
    if (depth === previousItem.depth) return previousItem.parentId;
    if (depth > previousItem.depth) return previousItem.id;
    const newParent = without.slice(0, p).reverse().find((item) => item.depth === depth)?.parentId;
    return newParent ?? null;
  }
}
function buildReorderPayload(allNotes, activeId, projected) {
  const active = allNotes.find((n) => n.id === activeId);
  if (!active) return null;
  let anchorId = null;
  if (projected.insertAfterId && projected.insertAfterId !== projected.parentId) {
    const parentOf = new Map(allNotes.map((n) => [n.id, n.parentId ?? null]));
    const seen = /* @__PURE__ */ new Set();
    let cursor = projected.insertAfterId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const parent = parentOf.get(cursor) ?? null;
      if (parent === projected.parentId) {
        anchorId = cursor;
        break;
      }
      cursor = parent;
    }
  }
  const siblings = allNotes.filter((n) => (n.parentId ?? null) === projected.parentId && n.id !== activeId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let insertAt = 0;
  if (anchorId) {
    const anchorIndex = siblings.findIndex((n) => n.id === anchorId);
    insertAt = anchorIndex === -1 ? siblings.length : anchorIndex + 1;
  }
  const nextSiblings = [...siblings];
  nextSiblings.splice(insertAt, 0, active);
  if ((active.parentId ?? null) === projected.parentId) {
    const currentSequence = allNotes.filter((n) => (n.parentId ?? null) === projected.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((n) => n.id);
    if (currentSequence.join("\n") === nextSiblings.map((n) => n.id).join("\n")) {
      return null;
    }
  }
  return nextSiblings.map((n, i) => ({
    noteId: n.id,
    parentId: projected.parentId,
    order: (i + 1) * 1e3
  }));
}

// src/messaging/cache.ts
function byCreatedAtAscending(a, b) {
  const delta = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
}
function sortMessages(messages) {
  return [...messages].sort(byCreatedAtAscending);
}
function upsertMessage(existing, incoming) {
  const incomingClientId = isPendingMessage(incoming) ? incoming.clientId : void 0;
  const index = existing.findIndex((message) => {
    if (incomingClientId && isPendingMessage(message) && message.clientId === incomingClientId) {
      return true;
    }
    return message.id === incoming.id;
  });
  if (index === -1) {
    return sortMessages([...existing, incoming]);
  }
  const next = [...existing];
  next[index] = incoming;
  return sortMessages(next);
}
function reconcileIncomingMessage(existing, incoming, currentUserId) {
  if (incoming.senderId !== currentUserId) {
    return upsertMessage(existing, incoming);
  }
  const pendingIndex = existing.findIndex(
    (message) => isPendingMessage(message) && message.body === incoming.body
  );
  if (pendingIndex === -1) {
    return upsertMessage(existing, incoming);
  }
  const next = [...existing];
  next[pendingIndex] = incoming;
  return sortMessages(next);
}
function confirmPendingMessage(existing, clientId, confirmed) {
  const withoutPending = existing.filter(
    (message) => !(isPendingMessage(message) && message.clientId === clientId)
  );
  return upsertMessage(withoutPending, confirmed);
}
function removePendingMessage(existing, clientId) {
  return existing.filter((message) => !(isPendingMessage(message) && message.clientId === clientId));
}
function markPendingMessage(existing, clientId, status) {
  return existing.map(
    (message) => isPendingMessage(message) && message.clientId === clientId ? { ...message, status } : message
  );
}
function applyMessageToConversations(conversations, message) {
  const index = conversations.findIndex((conversation) => conversation.id === message.conversationId);
  if (index === -1) return conversations;
  const target = conversations[index];
  if (!target) return conversations;
  const updated = {
    ...target,
    lastMessage: message,
    updatedAt: message.createdAt
  };
  return [updated, ...conversations.filter((_, i) => i !== index)];
}
function applyReadReceipt(conversations, conversationId, userId, readAt) {
  return conversations.map((conversation) => {
    if (conversation.id !== conversationId) return conversation;
    return {
      ...conversation,
      participants: conversation.participants.map(
        (participant) => participant.userId === userId ? { ...participant, lastReadAt: readAt } : participant
      )
    };
  });
}
function mergeOlderMessages(existing, older) {
  const seen = new Set(existing.map((message) => message.id));
  const additions = older.filter((message) => !seen.has(message.id));
  if (additions.length === 0) return existing;
  return sortMessages([...additions, ...existing]);
}
function oldestMessageTimestamp(messages) {
  const serverMessages = messages.filter((message) => !isPendingMessage(message));
  return serverMessages[0]?.createdAt;
}
function mergeServerMessages(previous, incoming) {
  if (!previous || previous.length === 0) return sortMessages(incoming);
  const incomingIds = new Set(incoming.map((message) => message.id));
  const kept = previous.filter(
    (message) => (
      // Optimistic messages the server hasn't seen yet…
      isPendingMessage(message) || // …and older confirmed messages this page doesn't cover.
      !incomingIds.has(message.id)
    )
  );
  return sortMessages([...kept, ...incoming]);
}
function newestServerMessage(messages) {
  if (!messages) return void 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && !isPendingMessage(message)) return message;
  }
  return void 0;
}

// src/messaging/contacts.ts
function displayName(peer) {
  const trimmed = peer.name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : peer.email;
}
function toContact(peer, relationship) {
  return {
    userId: peer.id,
    name: displayName(peer),
    email: peer.email,
    ...peer.avatar ? { avatar: peer.avatar } : {},
    relationship
  };
}
function buildMessagingContacts(outgoing = [], incoming = []) {
  const byUserId = /* @__PURE__ */ new Map();
  for (const share of outgoing) {
    if (!share.sharedWith) continue;
    byUserId.set(share.sharedWith.id, toContact(share.sharedWith, "shared-with-them"));
  }
  for (const share of incoming) {
    const existing = byUserId.get(share.owner.id);
    byUserId.set(
      share.owner.id,
      existing ? { ...existing, relationship: "mutual" } : toContact(share.owner, "shared-with-me")
    );
  }
  return Array.from(byUserId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
function contactsByUserId(contacts) {
  const index = {};
  for (const contact of contacts) {
    index[contact.userId] = contact;
  }
  return index;
}
function contactsWithoutConversation(contacts, existingCounterpartIds) {
  const taken = new Set(existingCounterpartIds);
  return contacts.filter((contact) => !taken.has(contact.userId));
}

// src/messaging/socket.ts
var BASE_RECONNECT_DELAY_MS = 1e3;
var MAX_RECONNECT_DELAY_MS = 3e4;
var CLOSE_POLICY_VIOLATION = 1008;
function parseIncomingMessage(raw) {
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed;
  const { id, conversationId, senderId, body, createdAt } = candidate;
  if (typeof id !== "string" || typeof conversationId !== "string" || typeof senderId !== "string" || typeof body !== "string" || typeof createdAt !== "string") {
    return null;
  }
  return { id, conversationId, senderId, body, createdAt };
}
function buildSocketUrl(wsUrl, token) {
  const withoutTrailingSlash = wsUrl.replace(/\/+$/, "");
  const separator = withoutTrailingSlash.includes("?") ? "&" : "/?";
  return `${withoutTrailingSlash}${separator}token=${encodeURIComponent(token)}`;
}
function reconnectDelayMs(attempt, random = Math.random) {
  const ceiling = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_RECONNECT_DELAY_MS);
  return Math.round(random() * ceiling);
}
function createMessagingSocket(config) {
  const {
    getWsUrl,
    getToken,
    onMessage,
    onStatusChange,
    isOnline = () => true,
    createSocket = defaultCreateSocket,
    setTimeoutImpl = (handler, timeoutMs) => setTimeout(handler, timeoutMs),
    clearTimeoutImpl = (handle) => clearTimeout(handle),
    random = Math.random
  } = config;
  let socket = null;
  let status = "idle";
  let attempt = 0;
  let reconnectHandle = null;
  let generation = 0;
  let wantConnection = false;
  function setStatus(next) {
    if (status === next) return;
    status = next;
    onStatusChange?.(next);
  }
  function detach() {
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
    }
    socket = null;
  }
  function clearReconnect() {
    if (reconnectHandle !== null) {
      clearTimeoutImpl(reconnectHandle);
      reconnectHandle = null;
    }
  }
  function scheduleReconnect() {
    if (!wantConnection || reconnectHandle !== null) return;
    if (!isOnline()) {
      setStatus("closed");
      return;
    }
    attempt += 1;
    setStatus("reconnecting");
    reconnectHandle = setTimeoutImpl(() => {
      reconnectHandle = null;
      openSocket();
    }, reconnectDelayMs(attempt, random));
  }
  function openSocket() {
    if (!wantConnection) return;
    const wsUrl = getWsUrl();
    if (!wsUrl) {
      setStatus("idle");
      return;
    }
    if (!isOnline()) {
      setStatus("closed");
      return;
    }
    detach();
    setStatus(attempt === 0 ? "connecting" : "reconnecting");
    const thisGeneration = ++generation;
    void getToken({ forceRefresh: attempt > 0 }).then((token) => {
      if (!wantConnection || thisGeneration !== generation) return;
      const next = createSocket(buildSocketUrl(wsUrl, token));
      socket = next;
      next.onopen = () => {
        if (thisGeneration !== generation) return;
        attempt = 0;
        setStatus("open");
      };
      next.onmessage = (event) => {
        if (thisGeneration !== generation) return;
        const message = parseIncomingMessage(event.data);
        if (message) onMessage(message);
      };
      next.onerror = () => {
      };
      next.onclose = (event) => {
        if (thisGeneration !== generation) return;
        socket = null;
        const code = event?.code;
        if (code === CLOSE_POLICY_VIOLATION) {
          attempt = Math.max(attempt, 1);
        }
        scheduleReconnect();
      };
    }).catch(() => {
      if (!wantConnection || thisGeneration !== generation) return;
      scheduleReconnect();
    });
  }
  return {
    connect() {
      wantConnection = true;
      clearReconnect();
      if (socket && status === "open") return;
      attempt = 0;
      openSocket();
    },
    disconnect() {
      wantConnection = false;
      generation += 1;
      clearReconnect();
      detach();
      attempt = 0;
      setStatus("idle");
    },
    getStatus() {
      return status;
    }
  };
}
function defaultCreateSocket(url) {
  return new WebSocket(url);
}

// src/messaging/token.ts
var DEFAULT_TTL_MS = 5 * 60 * 1e3;
var DEFAULT_SKEW_MS = 30 * 1e3;
function createMessagingTokenStore(config) {
  const { fetchToken, defaultTtlMs = DEFAULT_TTL_MS, skewMs = DEFAULT_SKEW_MS, now = Date.now } = config;
  let token = null;
  let expiresAtMs = 0;
  let inFlight = null;
  function isFresh() {
    return token !== null && now() < expiresAtMs - skewMs;
  }
  function mint() {
    const pending = fetchToken().then((response) => {
      token = response.token;
      const stated = response.expiresAt ? Date.parse(response.expiresAt) : Number.NaN;
      expiresAtMs = Number.isNaN(stated) ? now() + defaultTtlMs : stated;
      return response.token;
    }).finally(() => {
      if (inFlight === pending) {
        inFlight = null;
      }
    });
    inFlight = pending;
    return pending;
  }
  return {
    async getToken(options) {
      if (options?.forceRefresh) {
        token = null;
        expiresAtMs = 0;
        inFlight = null;
        return mint();
      }
      if (isFresh() && token) return token;
      if (inFlight) return inFlight;
      return mint();
    },
    clear() {
      token = null;
      expiresAtMs = 0;
      inFlight = null;
    },
    peek() {
      return isFresh() ? token : null;
    }
  };
}

// src/messaging/unread.ts
function findParticipant(conversation, userId) {
  return conversation.participants.find((participant) => participant.userId === userId);
}
function findCounterpart(conversation, currentUserId) {
  return conversation.participants.find((participant) => participant.userId !== currentUserId);
}
function lastReadAtFor(conversation, userId) {
  const participant = findParticipant(conversation, userId);
  if (!participant?.lastReadAt) return 0;
  const parsed = Date.parse(participant.lastReadAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
function isConversationUnread(conversation, currentUserId, latestMessage) {
  if (!latestMessage) return false;
  if (latestMessage.senderId === currentUserId) return false;
  const sentAt = Date.parse(latestMessage.createdAt);
  if (Number.isNaN(sentAt)) return false;
  return sentAt > lastReadAtFor(conversation, currentUserId);
}
function countUnreadConversations(conversations, currentUserId) {
  return conversations.reduce(
    (total, conversation) => isConversationUnread(conversation, currentUserId, conversation.lastMessage) ? total + 1 : total,
    0
  );
}

// src/api/client.ts
var import_axios2 = __toESM(require("axios"), 1);

// src/api/auth.ts
function createAuthApi(api) {
  return {
    checkEmailExists: (email) => api.get("/auth/check-email", { params: { email } }),
    sendOTP: (data) => api.post("/auth/send-otp", data),
    verifyOTP: (data) => api.post("/auth/verify-otp", data),
    forgotPassword: (data) => api.post("/auth/forgot-password", data),
    resetPassword: (data) => api.post("/auth/reset-password", data),
    register: (data) => api.post("/auth/register", data),
    login: (data) => api.post("/auth/login", data),
    ssoLogin: (data) => api.post("/auth/sso", data),
    getProfile: () => api.get("/auth/me"),
    refresh: (data) => api.post("/auth/refresh", data),
    sendChangePasswordOTP: (data) => api.post("/auth/send-change-password-otp", data),
    changePassword: (data) => api.post("/auth/change-password", data)
  };
}

// src/api/categories.ts
function createCategoriesApi(api) {
  return {
    getAll: () => api.get("/categories"),
    getOne: (id) => api.get(`/categories/${id}`),
    create: (data) => api.post("/categories", data),
    update: (id, data) => api.put(`/categories/${id}`, data),
    delete: (id) => api.delete(`/categories/${id}`)
  };
}

// src/api/coach.ts
var COACH_PROPOSAL_ACTION_TYPES = [
  "RENAME_GOAL",
  "UPDATE_GOAL",
  "CREATE_GOAL",
  "DELETE_GOAL",
  "CREATE_SCHEDULE_BLOCK",
  "UPDATE_SCHEDULE_BLOCK",
  "DELETE_SCHEDULE_BLOCK",
  "CREATE_TIME_ENTRY",
  "UPDATE_TIME_ENTRY",
  "DELETE_TIME_ENTRY",
  "CREATE_TASK",
  "UPDATE_TASK",
  "DELETE_TASK",
  "CREATE_PRACTICE",
  "START_TIMER",
  "STOP_TIMER",
  "APPEND_JOURNAL_ENTRY"
];
var COACH_VOICE_INTENT_TYPES = [
  "START_TRACKING",
  "STOP_TRACKING",
  "PAUSE",
  "RESUME",
  "APPEND_NOTE",
  "APPEND_JOURNAL",
  "CREATE_TASK",
  "CREATE_GOAL",
  "DAY_QUERY",
  "CHAT",
  "UNKNOWN"
];
function createCoachApi(api) {
  return {
    // Backend always wraps this as { messages: CoachMessageDto[] } (see
    // coach-ai.service.ts#getChatHistory), but the array shape is tolerated
    // too — normalize to a plain array at the boundary either way, same as
    // web's coachApi.getChatHistory.
    getChatHistory: async (scopeKey) => {
      const res = await api.get(`/coach/chat/${scopeKey}`);
      const raw = res.data;
      const messages = Array.isArray(raw) ? raw : raw?.messages ?? [];
      return { ...res, data: messages };
    },
    clearChatHistory: (scopeKey) => api.delete(`/coach/chat/${scopeKey}`),
    // Not called from the mobile UI yet — proposal cards render read-only
    // for this first pass (see apps/mobile's coach screen). Included here
    // so the API surface matches the backend contract and a future "Apply"
    // action doesn't need a new endpoint wired up.
    applyProposals: (actions, sourceMessageId) => api.post("/coach/proposals/apply", {
      actions,
      ...sourceMessageId ? { sourceMessageId } : {}
    }),
    // Tier 2 of the voice routing pipeline — see this file's header comment
    // just above CoachVoiceIntentResponse. Plain request/response, not SSE:
    // classification is a single JSON object, not a token stream, so this
    // goes through axios like every other REST call here rather than
    // through postCoachStream's fetch-based machinery.
    voiceIntent: (transcript, context) => api.post("/coach/voice-intent", { transcript, context })
  };
}
async function* parseCoachSseStream(response, signal) {
  if (!response.body) {
    throw new Error("Response has no body to stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {
        });
        return;
      }
      let value;
      let done = false;
      try {
        ;
        ({ value, done } = await reader.read());
      } catch (err) {
        if (signal?.aborted) return;
        throw err;
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const normalized = buffer.replace(/\r\n/g, "\n");
      buffer = "";
      const frames = normalized.split("\n\n");
      const tail = frames.pop() ?? "";
      buffer = tail;
      for (const frame of frames) {
        const trimmed = frame.trim();
        if (!trimmed) continue;
        const dataLines = [];
        for (const line of trimmed.split("\n")) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) continue;
        const payload = dataLines.join("\n");
        try {
          const parsed = JSON.parse(payload);
          const inner = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
          yield inner;
        } catch {
        }
      }
    }
    const final = buffer.trim();
    if (final) {
      const lines = final.split("\n");
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) {
        try {
          const parsed = JSON.parse(dataLines.join("\n"));
          const inner = parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
          yield inner;
        } catch {
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
async function postCoachStream(config, path, body, signal) {
  const token = await config.getAccessToken();
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await config.fetchImpl(`${config.baseUrl}/api${path}`, {
    method: "POST",
    headers,
    body: body === void 0 ? void 0 : JSON.stringify(body),
    signal
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.message) message = Array.isArray(data.message) ? data.message.join(", ") : String(data.message);
    } catch {
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return parseCoachSseStream(res, signal);
}
function currentCoachWeekScopeKey(now = /* @__PURE__ */ new Date()) {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// src/api/coach-settings.ts
var COACH_BYOK_PROVIDERS = [
  {
    provider: "GEMINI",
    label: "Google Gemini",
    keyPrefix: "AIza",
    consoleUrl: "https://aistudio.google.com/apikey",
    howTo: "Free tier available. Create a key in Google AI Studio."
  },
  {
    provider: "OPENROUTER",
    label: "OpenRouter",
    keyPrefix: "sk-or-",
    consoleUrl: "https://openrouter.ai/keys",
    howTo: "One key, many models. Includes some free models."
  },
  {
    provider: "OPENAI",
    label: "OpenAI",
    keyPrefix: "sk-",
    consoleUrl: "https://platform.openai.com/api-keys",
    howTo: "Pay as you go. Create a key on the API keys page."
  },
  {
    provider: "ANTHROPIC",
    label: "Anthropic",
    keyPrefix: "sk-ant-",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    howTo: "Pay as you go. Create a key under Settings -> API keys."
  }
];
function coachByokProviderMeta(provider) {
  const meta = COACH_BYOK_PROVIDERS.find((entry) => entry.provider === provider);
  return meta ?? { provider, label: provider, keyPrefix: "", consoleUrl: "", howTo: "" };
}
var COACH_BYOK_MIN_TOKEN_BUDGET = 1e3;
var COACH_BYOK_MAX_TOKEN_BUDGET = 1e8;
function validateCoachByokKey(provider, rawKey) {
  const key = rawKey.trim();
  if (key.length < 8) {
    return "That key looks too short.";
  }
  const { keyPrefix, label } = coachByokProviderMeta(provider);
  if (keyPrefix && !key.startsWith(keyPrefix)) {
    return `${label} keys start with "${keyPrefix}".`;
  }
  return null;
}
function parseCoachByokBudget(input) {
  const digits = input.replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (value < COACH_BYOK_MIN_TOKEN_BUDGET || value > COACH_BYOK_MAX_TOKEN_BUDGET) return null;
  return value;
}
function formatCoachTokenCount(value) {
  if (!Number.isFinite(value) || value < 0) return "0";
  if (value >= 1e6) {
    const millions = value / 1e6;
    return `${millions.toFixed(value % 1e6 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`;
  return String(Math.round(value));
}
function isCoachBudgetExceededError(input) {
  for (const candidate of collectErrorMessages(input)) {
    const text = candidate.toLowerCase();
    if (!text.includes("token budget")) continue;
    if (/exceed|reached|used up|over|out of|remain/.test(text)) return true;
  }
  return false;
}
function collectErrorMessages(input) {
  if (typeof input === "string") return [input];
  if (!input || typeof input !== "object") return [];
  const out = [];
  const push = (value) => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) out.push(value.filter((v) => typeof v === "string").join(", "));
  };
  const err = input;
  push(err.message);
  push(err.error);
  push(err.response?.data?.message);
  push(err.response?.data?.error);
  return out;
}
var COACH_BUDGET_INCREMENT_PERCENTS = [50, 100, 200];
function coachBudgetIncrements(current, percents = COACH_BUDGET_INCREMENT_PERCENTS) {
  const base = typeof current === "number" && Number.isFinite(current) && current >= COACH_BYOK_MIN_TOKEN_BUDGET ? current : COACH_BYOK_MIN_TOKEN_BUDGET;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const percent of percents) {
    const raised = roundBudgetUp(base * (1 + percent / 100));
    const tokensLimit = Math.min(raised, COACH_BYOK_MAX_TOKEN_BUDGET);
    if (tokensLimit <= base) continue;
    if (seen.has(tokensLimit)) continue;
    seen.add(tokensLimit);
    out.push({ percent, tokensLimit });
  }
  return out;
}
function roundBudgetUp(value) {
  const step = value >= 1e6 ? 1e5 : value >= 1e5 ? 1e4 : value >= 1e4 ? 1e3 : 500;
  return Math.max(COACH_BYOK_MIN_TOKEN_BUDGET, Math.ceil(value / step) * step);
}
var COACH_RELIGIOUS_CONTEXTS = [
  { value: "NONE", label: "Prefer not to say" },
  { value: "ISLAM", label: "Islam" },
  { value: "CHRISTIANITY", label: "Christianity" },
  { value: "HINDUISM", label: "Hinduism" },
  { value: "BUDDHISM", label: "Buddhism" },
  { value: "JUDAISM", label: "Judaism" },
  { value: "SECULAR", label: "Secular" },
  { value: "OTHER", label: "Other" }
];
function createCoachSettingsApi(api) {
  return {
    getByokKey: () => api.get("/coach/byok-key"),
    saveByokKey: (data) => api.post("/coach/byok-key", data),
    deleteByokKey: () => api.delete("/coach/byok-key"),
    getByokUsage: () => api.get("/coach/byok-key/usage"),
    setByokModel: (model) => api.patch("/coach/byok-key/model", { model }),
    setByokBudget: (tokensLimit) => api.patch("/coach/byok-key/budget", { tokensLimit }),
    getHabitsProfile: () => api.get("/coach/habits-profile"),
    updateHabitsProfile: (data) => api.put("/coach/habits-profile", data)
  };
}

// src/api/goals.ts
function createGoalsApi(api) {
  return {
    getAll: (params) => api.get("/goals", { params }),
    getOne: (id) => api.get(`/goals/${id}`),
    create: (data) => api.post("/goals", data),
    update: (id, data) => api.put(`/goals/${id}`, data),
    delete: (id) => api.delete(`/goals/${id}`),
    reorder: (ids) => api.put("/goals/reorder", { ids }),
    getStats: () => api.get("/goals/stats")
  };
}

// src/api/instructions.ts
function createInstructionsApi(api) {
  return {
    assign: (data) => api.post("/instructions", data),
    listAssignedByMe: () => api.get("/instructions/assigned-by-me"),
    listAssignedToMe: () => api.get("/instructions/assigned-to-me"),
    complete: (id) => api.patch(`/instructions/${id}/complete`)
  };
}

// src/api/journal.ts
function createJournalApi(api) {
  return {
    list: (params) => api.get("/coach/journal/entries", { params }),
    // Resolves to `null`, not a 404, on a day with no entry: the service
    // returns `row ?? null` and the controller hands that straight back as a
    // 200. queries/journal.ts still catches a 404 defensively, but it is the
    // null body that actually does the work.
    getByDate: (date) => api.get(`/coach/journal/entries/${date}`),
    /**
     * Create-or-update a day's entry. The only write a journal client needs.
     *
     * Safe to replay, which is what makes it the right thing to sit in the
     * offline outbox: re-POSTing the same `{ date, content }` converges on the
     * same single row rather than stacking duplicates, and a queued save no
     * longer has to be ordered against whether that day's row exists yet.
     */
    upsert: (data) => api.post("/coach/journal/entries", data),
    /**
     * @deprecated Alias of `upsert` — the name is a leftover from when this
     * client believed create and update were different endpoints. It happens
     * to have always pointed at the right route, which is why a FIRST save
     * for a day was the one journal write that worked.
     *
     * Kept only because app/(app)/voice.tsx still calls it. Prefer `upsert`.
     */
    create: (data) => api.post("/coach/journal/entries", data),
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
    update: (date, data) => api.put(`/coach/journal/entries/${date}/content`, data),
    /**
     * Remove a whole day's entry, by date. Idempotent server-side (the
     * service uses `deleteMany`, which never throws on a missing row), so a
     * replayed or duplicated delete is harmless.
     */
    delete: (date) => api.delete(`/coach/journal/entries/${date}`)
  };
}

// src/api/labels.ts
function createLabelsApi(api) {
  return {
    getAll: () => api.get("/labels"),
    getOne: (id) => api.get(`/labels/${id}`),
    create: (data) => api.post("/labels", data),
    update: (id, data) => api.put(`/labels/${id}`, data),
    delete: (id) => api.delete(`/labels/${id}`),
    assignToGoal: (goalId, labelIds) => api.post(`/labels/goals/${goalId}/assign`, { labelIds }),
    getForGoal: (goalId) => api.get(`/labels/goals/${goalId}`)
  };
}

// src/api/messaging.ts
var import_axios = __toESM(require("axios"), 1);
function createMessagingApi(api) {
  return {
    /** Short-lived JWT for jiffy-messaging. */
    issueToken: () => api.post("/messaging/token"),
    /**
     * Opens (or returns the existing) conversation with another GoalSlot
     * user. The sharing-relationship check is server-side and answers 403
     * when there isn't one — never pre-empt it client-side beyond hiding the
     * button, because the client's copy of the sharing graph is a cache.
     */
    createConversation: (input) => api.post("/messaging/conversations", input)
  };
}
var MessagingError = class extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = "MessagingError";
    this.kind = kind;
    this.status = status;
  }
};
var MESSAGES = {
  "not-configured": "Messaging is not available in this build.",
  "bad-request": "That message couldn't be sent.",
  unauthorized: "Your messaging session expired.",
  forbidden: "You're not part of this conversation.",
  "not-found": "That conversation no longer exists.",
  "rate-limited": "You're sending messages too quickly. Give it a moment.",
  server: "Messaging is having trouble right now.",
  network: "Couldn't reach messaging. Check your connection.",
  unknown: "Something went wrong with messaging."
};
function kindForStatus(status) {
  if (status === void 0) return "network";
  if (status === 400) return "bad-request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "unknown";
}
function toMessagingError(error) {
  if (error instanceof MessagingError) return error;
  const status = error?.response?.status;
  const kind = kindForStatus(status);
  return new MessagingError(kind, MESSAGES[kind], status);
}
function createMessagingServiceClient(config) {
  const { getBaseUrl, getToken } = config;
  const http = import_axios.default.create({
    headers: { "Content-Type": "application/json" }
  });
  async function request(method, path, options = {}, isRetry = false) {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      throw new MessagingError("not-configured", MESSAGES["not-configured"]);
    }
    let token;
    try {
      token = await getToken({ forceRefresh: isRetry });
    } catch (error) {
      throw toMessagingError(error);
    }
    try {
      const response = await http.request({
        method,
        url: `${baseUrl.replace(/\/$/, "")}${path}`,
        params: options.params,
        data: options.data,
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data;
    } catch (error) {
      const messagingError = toMessagingError(error);
      if (messagingError.kind === "unauthorized" && !isRetry) {
        return request(method, path, options, true);
      }
      throw messagingError;
    }
  }
  return {
    listConversations: () => request("get", "/conversations"),
    getConversation: (id) => request("get", `/conversations/${id}`),
    /** Oldest-first, per the service contract. */
    listMessages: (id, options = {}) => request("get", `/conversations/${id}/messages`, {
      params: {
        limit: options.limit ?? DEFAULT_PAGE_SIZE,
        ...options.before ? { before: options.before } : {}
      }
    }),
    sendMessage: (id, body) => request("post", `/conversations/${id}/messages`, { data: { body } }),
    /** 204 on success. Swallows the empty body so callers get a clean `void`. */
    markRead: async (id) => {
      await request("post", `/conversations/${id}/read`);
    }
  };
}
var DEFAULT_PAGE_SIZE = 50;
var MAX_MESSAGE_LENGTH = 4e3;

// src/api/notes.ts
function createNotesApi(api) {
  return {
    getAll: () => api.get("/notes"),
    getOne: (id) => api.get(`/notes/${id}`),
    create: (data) => api.post("/notes", data),
    update: (id, data) => api.put(`/notes/${id}`, data),
    delete: (id) => api.delete(`/notes/${id}`),
    // Body is a bare array — NOT the { ids } wrapper goals/tasks use.
    reorder: (items) => api.put("/notes/reorder", items)
  };
}

// src/api/push-subscriptions.ts
function createPushSubscriptionsApi(api) {
  return {
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
    registerExpo: (expoToken) => api.post("/push-subscriptions", { expoToken }),
    /**
     * Removes a single subscription by id. The API scopes the delete to the
     * calling user (403 if the row belongs to somebody else) and 404s if it
     * has already gone, so callers should treat both as "already handled"
     * rather than as a failure worth surfacing.
     */
    unregister: (id) => api.delete(`/push-subscriptions/${id}`)
  };
}

// src/api/sharing.ts
function createSharingApi(api) {
  return {
    getMyShares: () => api.get("/sharing/my-shares"),
    getSharedWithMe: () => api.get("/sharing/shared-with-me"),
    /**
     * A mentee's time entries, for the accepted share `ownerId` granted the
     * caller. Same shape the caller's own `/time-entries/range` returns
     * (goal/task are the same reduced projections), so the Reports screen's
     * existing aggregation helpers work unmodified against this response —
     * see apps/mobile's mentee/[id] screen. 403s server-side if the share
     * was revoked or never accepted; nothing here re-checks that client-side.
     */
    getSharedUserTimeEntries: (ownerId, startDate, endDate) => api.get(`/sharing/user/${ownerId}/time-entries`, { params: { startDate, endDate } }),
    /** A mentee's goals, for the accepted share `ownerId` granted the caller. */
    getSharedUserGoals: (ownerId) => api.get(`/sharing/user/${ownerId}/goals`)
  };
}

// src/api/idempotency.ts
var IDEMPOTENCY_KEY_HEADER = "idempotency-key";
function idempotentConfig(options) {
  const key = options?.idempotencyKey;
  if (!key) return void 0;
  return { headers: { [IDEMPOTENCY_KEY_HEADER]: key } };
}

// src/api/schedule.ts
function createScheduleApi(api) {
  return {
    getAll: () => api.get("/schedule"),
    getWeekly: () => api.get("/schedule/week"),
    getByDay: (dayOfWeek) => api.get(`/schedule/day/${dayOfWeek}`),
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
    create: (data, options) => api.post("/schedule", data, idempotentConfig(options)),
    update: (id, data) => api.put(`/schedule/${id}`, data),
    delete: (id) => api.delete(`/schedule/${id}`),
    clearAll: () => api.delete("/schedule")
  };
}

// src/api/tasks.ts
function createTasksApi(api) {
  return {
    create: (data) => api.post("/tasks", data),
    list: (params) => api.get("/tasks", { params }),
    getOne: (id) => api.get(`/tasks/${id}`),
    update: (id, data) => api.put(`/tasks/${id}`, data),
    delete: (id) => api.delete(`/tasks/${id}`),
    complete: (id, data) => api.post(`/tasks/${id}/complete`, data),
    restore: (id) => api.post(`/tasks/${id}/restore`),
    reorder: (ids) => api.put("/tasks/reorder", { ids })
  };
}

// src/api/time-entries.ts
function createTimeEntriesApi(api) {
  return {
    getByWeek: (weekStart) => api.get("/time-entries/week", { params: { weekStart } }),
    getByDateRange: (startDate, endDate) => api.get("/time-entries/range", { params: { startDate, endDate } }),
    getToday: () => api.get("/time-entries/today"),
    getWeeklyTotal: () => api.get("/time-entries/weekly-total"),
    getRecent: (params) => api.get("/time-entries/recent", { params }),
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
    create: (data, options) => api.post("/time-entries", data, idempotentConfig(options)),
    update: (id, data) => api.put(`/time-entries/${id}`, data),
    delete: (id) => api.delete(`/time-entries/${id}`)
  };
}

// src/api/timer-session.ts
function createTimerSessionApi(api) {
  return {
    /** Returns `null` (200), not a 404, when nothing is running — callers need no error handling to poll this. */
    getActive: () => api.get("/timer/session"),
    /** 409s (with the current session in the body) unless `takeOver: true` — see ActiveTimerConflict. */
    start: (data = {}) => api.post("/timer/session", data),
    pause: () => api.post("/timer/session/pause"),
    resume: () => api.post("/timer/session/resume"),
    /** Attach/detach attribution mid-session. Omitted fields are left alone; `null` clears them. */
    update: (data) => api.patch("/timer/session", data),
    /** Converts the session into a TimeEntry, atomically, and clears it. */
    stop: (data = {}) => api.post("/timer/session/stop", data),
    /** Abandons the session with no TimeEntry written — for an accidental start. */
    discard: () => api.delete("/timer/session")
  };
}

// src/api/users.ts
function createUsersApi(api) {
  return {
    /** Same payload as `authApi.getProfile()` (`GET /auth/me`); both return `sanitizeUser(user)`. */
    getProfile: () => api.get("/users/profile"),
    updateProfile: (data) => api.put("/users/profile", data),
    /**
     * Permanent and immediate — the API runs `prisma.user.delete()`, which
     * cascades to goals, tasks, time entries, journal, notes and the stored
     * BYOK key. There is no soft-delete, no grace period, and the route
     * itself asks for no re-authentication, so every bit of the confirmation
     * friction has to live in the client.
     */
    deleteAccount: () => api.delete("/users/account")
  };
}

// src/api/client.ts
var REQUEST_TIMEOUT_MS = 2e4;
function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}
function isPublicAuthEndpoint(url) {
  return url.includes("/auth/refresh") || url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/sso");
}
function createApiClient(config) {
  const { baseUrl, storage, onSessionExpired, notify, fetchImpl = fetch } = config;
  const api = import_axios2.default.create({
    baseURL: `${baseUrl}/api`,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json"
    }
  });
  let isRefreshing = false;
  let failedQueue = [];
  const processQueue = (error, token = null) => {
    failedQueue.forEach((queued) => {
      if (error) {
        queued.reject(error);
      } else {
        queued.resolve(token);
      }
    });
    failedQueue = [];
  };
  async function handleSessionExpired() {
    await storage.clear();
    notify?.("Your session has expired. Please log in again.");
    onSessionExpired();
  }
  api.interceptors.request.use(async (requestConfig) => {
    if (isPublicAuthEndpoint(requestConfig.url || "")) {
      return requestConfig;
    }
    const token = await storage.getAccessToken();
    if (token) {
      requestConfig.headers.set("Authorization", `Bearer ${token}`);
    }
    return requestConfig;
  });
  api.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;
      if (error.response?.status !== 401 || !originalRequest || originalRequest._retry) {
        return Promise.reject(error);
      }
      if (isPublicAuthEndpoint(originalRequest.url || "")) {
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          if (token) originalRequest.headers.set("Authorization", `Bearer ${token}`);
          return api(originalRequest);
        });
      }
      originalRequest._retry = true;
      isRefreshing = true;
      const refreshToken = await storage.getRefreshToken();
      if (!refreshToken) {
        processQueue(error, null);
        isRefreshing = false;
        await handleSessionExpired();
        return Promise.reject(error);
      }
      try {
        const response = await import_axios2.default.post(
          `${baseUrl}/api/auth/refresh`,
          { refreshToken },
          {
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${refreshToken}`
            }
          }
        );
        const { accessToken, refreshToken: newRefreshToken } = response.data;
        await storage.setTokens(accessToken, newRefreshToken);
        originalRequest.headers.set("Authorization", `Bearer ${accessToken}`);
        processQueue(null, accessToken);
        isRefreshing = false;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        isRefreshing = false;
        const refreshStatus = refreshError?.response?.status;
        if (!isAuthFailureStatus(refreshStatus)) {
          return Promise.reject(refreshError);
        }
        await handleSessionExpired();
        return Promise.reject(refreshError);
      }
    }
  );
  const coachApi = createCoachApi(api);
  return {
    api,
    auth: createAuthApi(api),
    users: createUsersApi(api),
    goals: createGoalsApi(api),
    notes: createNotesApi(api),
    // Device registration for remote push. Without a row here the whole
    // server-side dispatch pipeline (reminder-dispatch -> Expo channel)
    // runs against an empty subscription set and delivers nothing —
    // see ./push-subscriptions.ts.
    pushSubscriptions: createPushSubscriptionsApi(api),
    tasks: createTasksApi(api),
    schedule: createScheduleApi(api),
    timeEntries: createTimeEntriesApi(api),
    // Cross-device active timer session (dw-time-api PR #72/#73's
    // ActiveTimerSession) — see ./timer-session.ts.
    timerSession: createTimerSessionApi(api),
    categories: createCategoriesApi(api),
    labels: createLabelsApi(api),
    journal: createJournalApi(api),
    // GoalSlot's half of messaging only: mint a service token, open a
    // conversation (which is where the sharing-relationship check lives).
    // Everything else — conversations, messages, read state, live delivery —
    // is the jiffy-messaging service, reached through
    // `createMessagingServiceClient` with the token this mints, because it's
    // a different origin with a different credential and is separately
    // configurable (and frequently not configured at all).
    messaging: createMessagingApi(api),
    sharing: createSharingApi(api),
    // Assign/track instructions a mentor gives a mentee — see ./instructions.ts.
    // Same accepted-share prerequisite as `sharing.getSharedUser*` above,
    // enforced server-side.
    instructions: createInstructionsApi(api),
    // Namespaced under /coach on the API, but account settings rather than
    // anything the chat screen calls — kept as its own key so the two don't
    // have to grow into one object. See ./coach-settings.ts.
    coachSettings: createCoachSettingsApi(api),
    coach: {
      ...coachApi,
      // Not axios-based (see api/coach.ts's header comment for why) — goes
      // through the injected fetchImpl instead, reusing the same token
      // storage the axios interceptor above reads from so both request
      // paths stay in sync on login/refresh/logout.
      streamChat: (scopeKey, content, opts) => postCoachStream(
        { baseUrl, fetchImpl, getAccessToken: () => storage.getAccessToken() },
        `/coach/chat/${scopeKey}`,
        { content },
        opts?.signal
      )
    }
  };
}

// src/offline/id.ts
function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// src/offline/http-error.ts
function hasResponse(err) {
  return Boolean(err?.response);
}

// src/offline/outbox.ts
var DEFAULT_STORAGE_KEY = "goalslot-offline-outbox";
function createOutbox(storage, storageKey = DEFAULT_STORAGE_KEY) {
  let chain = Promise.resolve();
  async function readEntries() {
    return await storage.get(storageKey) ?? [];
  }
  function mutate(op) {
    const run = chain.then(async () => {
      const entries = await readEntries();
      const { next, result } = op(entries);
      await storage.set(storageKey, next);
      return result;
    });
    chain = run.catch(() => void 0);
    return run;
  }
  return {
    getOutbox: () => chain.then(readEntries),
    getOutboxCount: async () => (await chain.then(readEntries)).length,
    addToOutbox: (entry) => mutate((entries) => ({ next: [...entries, entry], result: entry })),
    removeFromOutbox: (id) => mutate((entries) => ({ next: entries.filter((e) => e.id !== id), result: void 0 })),
    bumpRetries: (id) => mutate((entries) => ({
      next: entries.map((e) => e.id === id ? { ...e, retries: e.retries + 1 } : e),
      result: void 0
    })),
    // Goes through `mutate` like every other writer so it joins the same
    // serialized chain — a clear issued while an enqueue is in flight can't
    // be overwritten by that enqueue landing afterwards.
    clearOutbox: () => mutate(() => ({ next: [], result: void 0 }))
  };
}

// src/offline/registry.ts
function createOperationRegistry() {
  const registry = /* @__PURE__ */ new Map();
  return {
    registerOperation(kind, operation) {
      registry.set(kind, operation);
    },
    getOperation(kind) {
      return registry.get(kind);
    }
  };
}

// src/offline/sync.ts
var DEFAULT_MAX_RETRIES = 5;
function createOfflineSync(config) {
  const {
    outbox,
    registry,
    isOnline,
    subscribeOnline,
    invalidateQueries,
    notify,
    onPendingCountChange,
    maxRetries = DEFAULT_MAX_RETRIES
  } = config;
  let draining = false;
  async function refreshPendingCount() {
    onPendingCountChange?.(await outbox.getOutboxCount());
  }
  async function drainOutbox() {
    if (draining || !isOnline()) return;
    draining = true;
    let synced = 0;
    let dropped = 0;
    const keysToInvalidate = /* @__PURE__ */ new Set();
    try {
      const entries = await outbox.getOutbox();
      for (const entry of entries) {
        if (!isOnline()) break;
        const operation = registry.getOperation(entry.kind);
        if (!operation) {
          await outbox.removeFromOutbox(entry.id);
          continue;
        }
        try {
          await operation.execute(entry.payload, entry.idempotencyKey);
          await outbox.removeFromOutbox(entry.id);
          synced++;
          operation.invalidateKeys?.forEach((key) => keysToInvalidate.add(key));
        } catch (err) {
          if (!hasResponse(err)) break;
          const status = err.response.status;
          const isServerError = status >= 500;
          if (isServerError && entry.retries + 1 < maxRetries) {
            await outbox.bumpRetries(entry.id);
            break;
          }
          await outbox.removeFromOutbox(entry.id);
          dropped++;
          operation.invalidateKeys?.forEach((key) => keysToInvalidate.add(key));
          try {
            operation.onDropped?.(entry.payload, err);
          } catch {
          }
        }
      }
    } finally {
      draining = false;
      await refreshPendingCount();
      keysToInvalidate.forEach((key) => invalidateQueries(key));
      if (synced > 0) {
        notify?.(`Synced ${synced} offline ${synced === 1 ? "change" : "changes"}`, "success");
      }
      if (dropped > 0) {
        notify?.(`${dropped} offline ${dropped === 1 ? "change" : "changes"} could not be synced`, "error");
      }
    }
  }
  function init() {
    void refreshPendingCount();
    void drainOutbox();
    return subscribeOnline((online) => {
      if (online) void drainOutbox();
    });
  }
  return { drainOutbox, refreshPendingCount, init };
}

// src/queries/coach.ts
var import_react_query = require("@tanstack/react-query");
function createCoachQueries(coachApi) {
  const coachQueries = {
    all: ["coach"],
    chat: (scopeKey) => [...coachQueries.all, "chat", scopeKey]
  };
  const fetchChatHistory = async (scopeKey) => {
    const res = await coachApi.getChatHistory(scopeKey);
    return res.data;
  };
  return {
    coachQueries,
    fetchChatHistory,
    chat: (scopeKey) => (0, import_react_query.queryOptions)({
      queryKey: coachQueries.chat(scopeKey),
      queryFn: () => fetchChatHistory(scopeKey)
    })
  };
}

// src/queries/coach-settings.ts
var import_react_query2 = require("@tanstack/react-query");
function createCoachSettingsQueries(coachSettingsApi) {
  const coachSettingsQueries = {
    all: ["coach"],
    byokKey: () => ["coach", "byok-key"],
    habitsProfile: () => ["coach", "habits-profile"]
  };
  const fetchByokKey = async () => {
    const res = await coachSettingsApi.getByokKey();
    return res.data;
  };
  const fetchHabitsProfile = async () => {
    const res = await coachSettingsApi.getHabitsProfile();
    return res.data;
  };
  return {
    coachSettingsQueries,
    fetchByokKey,
    fetchHabitsProfile,
    byokKey: () => (0, import_react_query2.queryOptions)({
      queryKey: coachSettingsQueries.byokKey(),
      queryFn: fetchByokKey
    }),
    habitsProfile: () => (0, import_react_query2.queryOptions)({
      queryKey: coachSettingsQueries.habitsProfile(),
      queryFn: fetchHabitsProfile
    })
  };
}

// src/queries/goals.ts
var import_react_query3 = require("@tanstack/react-query");
function createGoalQueries(goalsApi) {
  const goalQueries = {
    all: ["goals"],
    list: (filters) => [...goalQueries.all, "list", filters],
    detail: (id) => [...goalQueries.all, "detail", id],
    stats: () => [...goalQueries.all, "stats"]
  };
  const fetchGoals = async (filters) => {
    const params = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.categories && filters.categories.length > 0) {
      params.categories = filters.categories.join(",");
    }
    if (filters?.labelIds && filters.labelIds.length > 0) {
      params.labelIds = filters.labelIds.join(",");
    }
    const res = await goalsApi.getAll(params);
    return res.data;
  };
  const fetchGoalStats = async () => {
    const res = await goalsApi.getStats();
    return res.data;
  };
  const fetchGoal = async (id) => {
    const res = await goalsApi.getOne(id);
    return res.data;
  };
  return {
    goalQueries,
    fetchGoals,
    fetchGoalStats,
    fetchGoal,
    list: (filters) => (0, import_react_query3.queryOptions)({
      queryKey: goalQueries.list(filters),
      queryFn: () => fetchGoals(filters)
    }),
    detail: (id) => (0, import_react_query3.queryOptions)({
      queryKey: goalQueries.detail(id),
      queryFn: () => fetchGoal(id)
    }),
    stats: () => (0, import_react_query3.queryOptions)({
      queryKey: goalQueries.stats(),
      queryFn: fetchGoalStats
    })
  };
}

// src/queries/notes.ts
var import_react_query4 = require("@tanstack/react-query");
function createNoteQueries(notesApi) {
  const noteQueries = {
    all: ["notes"],
    list: () => [...noteQueries.all, "list"],
    detail: (id) => [...noteQueries.all, "detail", id]
  };
  const fetchNotes = async () => {
    const res = await notesApi.getAll();
    return res.data;
  };
  const fetchNote = async (id) => {
    const res = await notesApi.getOne(id);
    return res.data;
  };
  return {
    noteQueries,
    fetchNotes,
    fetchNote,
    list: () => (0, import_react_query4.queryOptions)({
      queryKey: noteQueries.list(),
      queryFn: fetchNotes
    }),
    detail: (id) => (0, import_react_query4.queryOptions)({
      queryKey: noteQueries.detail(id),
      queryFn: () => fetchNote(id)
    })
  };
}

// src/queries/tasks.ts
var import_react_query5 = require("@tanstack/react-query");
function createTaskQueries(tasksApi) {
  const taskQueries = {
    all: ["tasks"],
    list: (filters) => [...taskQueries.all, "list", filters],
    detail: (id) => [...taskQueries.all, "detail", id]
  };
  const fetchTasks = async (filters) => {
    const res = await tasksApi.list(filters);
    return res.data;
  };
  const fetchTask = async (id) => {
    const res = await tasksApi.getOne(id);
    return res.data;
  };
  return {
    taskQueries,
    fetchTasks,
    fetchTask,
    list: (filters) => (0, import_react_query5.queryOptions)({
      queryKey: taskQueries.list(filters),
      queryFn: () => fetchTasks(filters)
    }),
    detail: (id) => (0, import_react_query5.queryOptions)({
      queryKey: taskQueries.detail(id),
      queryFn: () => fetchTask(id)
    })
  };
}

// src/queries/schedule.ts
var import_react_query6 = require("@tanstack/react-query");
function createScheduleQueries(scheduleApi) {
  const scheduleQueries = {
    root: () => ["schedule"],
    weeklyKey: () => [...scheduleQueries.root(), "weekly"]
  };
  const fetchWeeklySchedule = async () => {
    const res = await scheduleApi.getWeekly();
    return res.data;
  };
  return {
    scheduleQueries,
    fetchWeeklySchedule,
    weekly: () => (0, import_react_query6.queryOptions)({
      queryKey: scheduleQueries.weeklyKey(),
      queryFn: fetchWeeklySchedule
    })
  };
}

// src/queries/time-entries.ts
var import_react_query7 = require("@tanstack/react-query");
var RECENT_WINDOW_DAYS = 7;
function createTimeEntryQueries(timeEntriesApi) {
  const timeEntryQueries = {
    all: ["time-entries"],
    recent: () => [...timeEntryQueries.all, "recent"],
    week: (weekStart) => [...timeEntryQueries.all, "week", weekStart],
    range: (startDate, endDate) => [...timeEntryQueries.all, "range", startDate, endDate],
    today: () => [...timeEntryQueries.all, "today"]
  };
  const fetchRecentEntries = async () => {
    const end = /* @__PURE__ */ new Date();
    const start = new Date(end.getTime() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1e3);
    const res = await timeEntriesApi.getByDateRange(getLocalDateString(start), getLocalDateString(end));
    return res.data;
  };
  const fetchToday = async () => {
    const res = await timeEntriesApi.getToday();
    return res.data;
  };
  return {
    timeEntryQueries,
    fetchRecentEntries,
    fetchToday,
    recent: () => (0, import_react_query7.queryOptions)({
      queryKey: timeEntryQueries.recent(),
      queryFn: fetchRecentEntries
    }),
    today: () => (0, import_react_query7.queryOptions)({
      queryKey: timeEntryQueries.today(),
      queryFn: fetchToday
    })
  };
}

// src/queries/timer-session.ts
var import_react_query8 = require("@tanstack/react-query");
function toActiveTimerSession(data) {
  if (!data || typeof data !== "object") return null;
  if (typeof data.status !== "string") return null;
  return data;
}
function createTimerSessionQueries(timerSessionApi) {
  const timerSessionQueries = {
    all: ["timer-session"],
    active: () => [...timerSessionQueries.all, "active"]
  };
  const fetchActive = async () => {
    const res = await timerSessionApi.getActive();
    return toActiveTimerSession(res.data);
  };
  return {
    timerSessionQueries,
    fetchActive,
    active: () => (0, import_react_query8.queryOptions)({
      queryKey: timerSessionQueries.active(),
      queryFn: fetchActive
    })
  };
}

// src/queries/categories.ts
var import_react_query9 = require("@tanstack/react-query");
function createCategoryQueries(categoriesApi) {
  const baseKey = ["categories"];
  const categoryQueries = {
    all: () => baseKey,
    listKey: () => [...baseKey, "list"],
    detailKey: (id) => [...baseKey, "detail", id]
  };
  const fetchCategories = async () => {
    const res = await categoriesApi.getAll();
    return res.data;
  };
  const fetchCategory = async (id) => {
    const res = await categoriesApi.getOne(id);
    return res.data;
  };
  return {
    categoryQueries,
    fetchCategories,
    fetchCategory,
    list: () => (0, import_react_query9.queryOptions)({
      queryKey: categoryQueries.listKey(),
      queryFn: fetchCategories,
      // Refetch on every mount + window focus so newly seeded categories
      // show up without a hard reload.
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchOnMount: true
    }),
    detail: (id) => (0, import_react_query9.queryOptions)({
      queryKey: categoryQueries.detailKey(id),
      queryFn: () => fetchCategory(id)
    })
  };
}

// src/queries/labels.ts
var import_react_query10 = require("@tanstack/react-query");
function createLabelQueries(labelsApi) {
  const baseKey = ["labels"];
  const labelQueries = {
    all: () => baseKey,
    listKey: () => [...baseKey, "list"],
    detailKey: (id) => [...baseKey, "detail", id]
  };
  const fetchLabels = async () => {
    const res = await labelsApi.getAll();
    return res.data;
  };
  const fetchLabel = async (id) => {
    const res = await labelsApi.getOne(id);
    return res.data;
  };
  return {
    labelQueries,
    fetchLabels,
    fetchLabel,
    list: () => (0, import_react_query10.queryOptions)({
      queryKey: labelQueries.listKey(),
      queryFn: fetchLabels
    }),
    detail: (id) => (0, import_react_query10.queryOptions)({
      queryKey: labelQueries.detailKey(id),
      queryFn: () => fetchLabel(id)
    })
  };
}

// src/queries/journal.ts
var import_react_query11 = require("@tanstack/react-query");
function isNotFoundError(error) {
  return error?.response?.status === 404;
}
function createJournalQueries(journalApi) {
  const journalQueries = {
    all: ["journal"],
    list: (range) => [...journalQueries.all, "list", range],
    byDate: (date) => [...journalQueries.all, "date", date]
  };
  const fetchEntries = async (range) => {
    const res = await journalApi.list(range);
    return res.data;
  };
  const fetchEntryByDate = async (date) => {
    try {
      const res = await journalApi.getByDate(date);
      return res.data;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  };
  return {
    journalQueries,
    fetchEntries,
    fetchEntryByDate,
    list: (range) => (0, import_react_query11.queryOptions)({
      queryKey: journalQueries.list(range),
      queryFn: () => fetchEntries(range)
    }),
    byDate: (date) => (0, import_react_query11.queryOptions)({
      queryKey: journalQueries.byDate(date),
      queryFn: () => fetchEntryByDate(date)
    })
  };
}

// src/queries/messaging.ts
var import_react_query12 = require("@tanstack/react-query");
function createMessagingQueries(client, sharingApi) {
  const messagingQueries = {
    all: ["messaging"],
    conversations: () => [...messagingQueries.all, "conversations"],
    conversation: (id) => [...messagingQueries.all, "conversation", id],
    messages: (id) => [...messagingQueries.all, "messages", id],
    contacts: () => [...messagingQueries.all, "contacts"]
  };
  const fetchConversations = () => client.listConversations();
  const fetchConversation = (id) => client.getConversation(id);
  const fetchMessages = (id) => client.listMessages(id);
  const fetchContacts = async () => {
    const [outgoing, incoming] = await Promise.all([
      sharingApi.getMyShares(),
      sharingApi.getSharedWithMe()
    ]);
    return buildMessagingContacts(outgoing.data, incoming.data);
  };
  return {
    messagingQueries,
    fetchConversations,
    fetchConversation,
    fetchMessages,
    fetchContacts,
    conversations: () => (0, import_react_query12.queryOptions)({
      queryKey: messagingQueries.conversations(),
      queryFn: fetchConversations
    }),
    conversation: (id) => (0, import_react_query12.queryOptions)({
      queryKey: messagingQueries.conversation(id),
      queryFn: () => fetchConversation(id)
    }),
    messages: (id) => (0, import_react_query12.queryOptions)({
      queryKey: messagingQueries.messages(id),
      // Typed as thread messages, not plain server messages: this cache
      // entry legitimately holds optimistic sends alongside confirmed rows
      // (see ../messaging/cache.ts). Typing it as `MessagingMessage[]`
      // would make every optimistic write a cast at the call site and
      // quietly lose the `status`/`clientId` fields the UI renders.
      //
      // `mergeServerMessages` runs HERE, inside the fetch itself, rather
      // than as `structuralSharing`. That looks like the natural home for
      // it — it is, after all, exactly "merge fetched data with what's
      // cached" — but TanStack calls a custom `structuralSharing` on EVERY
      // write to this query's cache, not only on fetch results: manual
      // `queryClient.setQueryData` calls (confirmPendingMessage,
      // reconcileIncomingMessage, removePendingMessage, ... — see
      // ../../apps/mobile/src/lib/messaging-live.ts and
      // useSendMessage.ts) go through the exact same `Query#setData` ->
      // `replaceData` path. `mergeServerMessages` unconditionally keeps any
      // still-pending message found in the PREVIOUS cache value, which is
      // correct for a freshly fetched page that legitimately knows nothing
      // about a local optimistic bubble — but wired up as
      // `structuralSharing` it re-ran on every one of those other writes
      // too, resurrecting the pending bubble each of them had just
      // correctly replaced or removed. That's what turned one sent message
      // into three rendered bubbles: a zombie "Sending…" copy plus two
      // separate confirmed copies (one from the REST response, one from
      // the socket push) that never got deduplicated against each other.
      // Param renamed from TanStack's `client` to `queryClient`: this
      // closure already captures the outer `client` (the jiffy-messaging
      // `MessagingServiceClient` this factory takes), and shadowing it
      // with the QueryClient here — even though `fetchMessages` above
      // resolves its own `client` correctly regardless, since closures
      // bind at definition site — reads as if `fetchMessages(id)` might
      // suddenly mean something else.
      queryFn: async ({ client: queryClient, queryKey }) => {
        const serverMessages = await fetchMessages(id);
        const previous = queryClient.getQueryData(queryKey);
        return mergeServerMessages(previous, serverMessages);
      }
    }),
    contacts: () => (0, import_react_query12.queryOptions)({
      queryKey: messagingQueries.contacts(),
      queryFn: fetchContacts
    })
  };
}

// src/queries/sharing.ts
var import_react_query13 = require("@tanstack/react-query");
function createSharingQueries(api) {
  const sharingQueries = {
    all: ["sharing"],
    sharedWithMe: () => [...sharingQueries.all, "shared-with-me"],
    sharedUserTimeEntries: (ownerId, startDate, endDate) => [...sharingQueries.all, "shared-user", ownerId, "time-entries", startDate, endDate],
    sharedUserGoals: (ownerId) => [...sharingQueries.all, "shared-user", ownerId, "goals"]
  };
  return {
    sharingQueries,
    /** People who shared their data with the signed-in user — their mentees. */
    sharedWithMe: () => (0, import_react_query13.queryOptions)({
      queryKey: sharingQueries.sharedWithMe(),
      queryFn: async () => (await api.getSharedWithMe()).data
    }),
    sharedUserTimeEntries: (ownerId, startDate, endDate) => (0, import_react_query13.queryOptions)({
      queryKey: sharingQueries.sharedUserTimeEntries(ownerId, startDate, endDate),
      queryFn: async () => (await api.getSharedUserTimeEntries(ownerId, startDate, endDate)).data
    }),
    sharedUserGoals: (ownerId) => (0, import_react_query13.queryOptions)({
      queryKey: sharingQueries.sharedUserGoals(ownerId),
      queryFn: async () => (await api.getSharedUserGoals(ownerId)).data
    })
  };
}

// src/queries/instructions.ts
var import_react_query14 = require("@tanstack/react-query");
function createInstructionsQueries(api) {
  const instructionsQueries = {
    all: ["instructions"],
    assignedByMe: () => [...instructionsQueries.all, "assigned-by-me"],
    assignedToMe: () => [...instructionsQueries.all, "assigned-to-me"]
  };
  return {
    instructionsQueries,
    /** Instructions the signed-in user (a mentor) has assigned to mentees. */
    assignedByMe: () => (0, import_react_query14.queryOptions)({
      queryKey: instructionsQueries.assignedByMe(),
      queryFn: async () => (await api.listAssignedByMe()).data
    }),
    /** Instructions assigned to the signed-in user (a mentee) by a mentor. */
    assignedToMe: () => (0, import_react_query14.queryOptions)({
      queryKey: instructionsQueries.assignedToMe(),
      queryFn: async () => (await api.listAssignedToMe()).data
    })
  };
}

// src/capabilities/index.ts
function createNoopAlarmCapability() {
  const scheduled = /* @__PURE__ */ new Map();
  return {
    async scheduleAlarm(alarm) {
      scheduled.set(alarm.id, alarm);
    },
    async cancelAlarm(alarmId) {
      scheduled.delete(alarmId);
    },
    async listScheduled() {
      return Array.from(scheduled.values());
    }
  };
}
function createNoopVoiceCapability() {
  return {
    async isAvailable() {
      return false;
    },
    async getPermission() {
      return "undetermined";
    },
    async requestPermission() {
      return "undetermined";
    },
    async startListening() {
    },
    async stopListening() {
    },
    async cancelListening() {
    }
  };
}
function createNoopNotificationCapability() {
  return {
    async getPermissionStatus() {
      return "denied";
    },
    async requestPermission() {
      return false;
    },
    async scheduleNotification() {
    },
    async cancelNotification() {
    },
    async listScheduledIds() {
      return [];
    },
    async clearAllNotifications() {
    }
  };
}
function createNoopCapabilities() {
  return {
    alarms: createNoopAlarmCapability(),
    voice: createNoopVoiceCapability(),
    notifications: createNoopNotificationCapability()
  };
}

// src/growth/index.ts
function createConsoleAnalytics() {
  return {
    track(event) {
      console.log(`[analytics] ${event.name}`, event.payload);
    },
    identify(userId) {
      console.log(`[analytics] identify`, userId);
    },
    reset() {
      console.log("[analytics] reset");
    }
  };
}
var ALL_FLAGS_DEFAULT_OFF = {
  voiceAssistant: false,
  realAlarms: false
};
function createStaticFeatureFlags(overrides) {
  const flags = { ...ALL_FLAGS_DEFAULT_OFF, ...overrides };
  return {
    isEnabled(flag) {
      return flags[flag];
    }
  };
}

// src/coach/proposals.ts
var VALID_ACTION_TYPES = new Set(COACH_PROPOSAL_ACTION_TYPES);
var ACTION_TYPE_SYNONYMS = {
  ADD_GOAL: "CREATE_GOAL",
  NEW_GOAL: "CREATE_GOAL",
  EDIT_GOAL: "UPDATE_GOAL",
  MODIFY_GOAL: "UPDATE_GOAL",
  REMOVE_GOAL: "DELETE_GOAL",
  ADD_SCHEDULE_BLOCK: "CREATE_SCHEDULE_BLOCK",
  NEW_SCHEDULE_BLOCK: "CREATE_SCHEDULE_BLOCK",
  ADD_BLOCK: "CREATE_SCHEDULE_BLOCK",
  EDIT_SCHEDULE_BLOCK: "UPDATE_SCHEDULE_BLOCK",
  MODIFY_SCHEDULE_BLOCK: "UPDATE_SCHEDULE_BLOCK",
  MOVE_SCHEDULE_BLOCK: "UPDATE_SCHEDULE_BLOCK",
  UPDATE_BLOCK: "UPDATE_SCHEDULE_BLOCK",
  REMOVE_SCHEDULE_BLOCK: "DELETE_SCHEDULE_BLOCK",
  DELETE_BLOCK: "DELETE_SCHEDULE_BLOCK",
  REMOVE_BLOCK: "DELETE_SCHEDULE_BLOCK",
  ADD_TASK: "CREATE_TASK",
  EDIT_TASK: "UPDATE_TASK",
  REMOVE_TASK: "DELETE_TASK",
  ADD_TIME_ENTRY: "CREATE_TIME_ENTRY",
  EDIT_TIME_ENTRY: "UPDATE_TIME_ENTRY",
  REMOVE_TIME_ENTRY: "DELETE_TIME_ENTRY",
  ADD_PRACTICE: "CREATE_PRACTICE",
  NEW_PRACTICE: "CREATE_PRACTICE",
  // The live stopwatch is the one action users reach for by voice ("start
  // tracking my deen goal"), and dictated phrasing drifts further from the
  // canonical name than typed phrasing does. An unmapped type is dropped
  // silently, so the near-misses are worth spelling out.
  START_TRACKING: "START_TIMER",
  BEGIN_TIMER: "START_TIMER",
  TRACK_TIME: "START_TIMER",
  STOP_TRACKING: "STOP_TIMER",
  END_TIMER: "STOP_TIMER",
  // The journal action is append-only, so every verb the model reaches for —
  // create, add, update, write — maps onto the same canonical type. Mapping
  // UPDATE_/SET_ here is deliberate and safe in one direction only: the
  // executor appends, so a model that meant "replace today's entry" gets an
  // extra paragraph instead, and nothing the user wrote is lost. The reverse
  // (dropping the action because the model said UPDATE) is what the user
  // spent two rounds reporting as "it still cannot add entries to my
  // journal", so near-misses are spelled out generously here.
  CREATE_JOURNAL_ENTRY: "APPEND_JOURNAL_ENTRY",
  ADD_JOURNAL_ENTRY: "APPEND_JOURNAL_ENTRY",
  UPDATE_JOURNAL_ENTRY: "APPEND_JOURNAL_ENTRY",
  APPEND_JOURNAL: "APPEND_JOURNAL_ENTRY",
  ADD_JOURNAL: "APPEND_JOURNAL_ENTRY",
  WRITE_JOURNAL: "APPEND_JOURNAL_ENTRY",
  JOURNAL_ENTRY: "APPEND_JOURNAL_ENTRY"
};
function normalizeCoachActionType(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase();
  if (VALID_ACTION_TYPES.has(key)) return key;
  if (key in ACTION_TYPE_SYNONYMS) return ACTION_TYPE_SYNONYMS[key] ?? null;
  return null;
}
function parseLenientJson(text) {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && n === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out);
}
function collapseMultiDayBlocks(actions) {
  const keyOf = (p) => [p.title, p.startTime, p.endTime, p.category ?? "", p.goalId ?? ""].join("|");
  const isSingleDayBlock = (a) => {
    const p = a.payload ?? {};
    return a.type === "CREATE_SCHEDULE_BLOCK" && typeof p.dayOfWeek === "number" && !Array.isArray(p.daysOfWeek);
  };
  const daysByKey = /* @__PURE__ */ new Map();
  for (const a of actions) {
    if (!isSingleDayBlock(a)) continue;
    const p = a.payload;
    const k = keyOf(p);
    const arr = daysByKey.get(k) ?? [];
    arr.push(p.dayOfWeek);
    daysByKey.set(k, arr);
  }
  const emitted = /* @__PURE__ */ new Set();
  const out = [];
  for (const a of actions) {
    if (!isSingleDayBlock(a)) {
      out.push(a);
      continue;
    }
    const p = a.payload;
    const k = keyOf(p);
    if (emitted.has(k)) continue;
    emitted.add(k);
    const days = Array.from(new Set(daysByKey.get(k) ?? [])).sort((x, y) => x - y);
    if (days.length > 1) {
      const { dayOfWeek: _drop, ...rest } = p;
      out.push({ ...a, payload: { ...rest, daysOfWeek: days } });
    } else {
      out.push(a);
    }
  }
  return out;
}
var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function fillJournalDates(actions) {
  return actions.map((action) => {
    if (action.type !== "APPEND_JOURNAL_ENTRY") return action;
    const payload = action.payload ?? {};
    const date = payload.date;
    if (typeof date === "string" && ISO_DATE.test(date.trim())) return action;
    if (date !== void 0 && date !== null && date !== "") return action;
    return { ...action, payload: { ...payload, date: todayKey() } };
  });
}
function extractCoachProposals(raw) {
  if (!raw) return { cleaned: raw, proposals: [], pending: false, unrenderable: false };
  const proposals = [];
  let unrenderable = false;
  const closed = /```coach-proposal\s*\n([\s\S]*?)```/g;
  let cleaned = raw.replace(closed, (_m, jsonText) => {
    try {
      const parsed = parseLenientJson(jsonText.trim());
      if (parsed && Array.isArray(parsed.actions) && parsed.actions.length) {
        const normalized = parsed.actions.filter((a) => !!a && typeof a === "object").map((a) => {
          const type = normalizeCoachActionType(a.type);
          return type ? { ...a, type } : null;
        }).filter((a) => a !== null);
        const actions = fillJournalDates(collapseMultiDayBlocks(normalized));
        if (actions.length) {
          proposals.push({
            summary: typeof parsed.summary === "string" ? parsed.summary : void 0,
            actions
          });
        } else {
          unrenderable = true;
        }
      } else {
        unrenderable = true;
      }
    } catch {
      unrenderable = true;
    }
    return "";
  });
  let pending = false;
  const openIdx = cleaned.indexOf("```coach-proposal");
  if (openIdx !== -1) {
    cleaned = cleaned.slice(0, openIdx);
    pending = true;
  } else {
    const partial = cleaned.match(/```[a-z-]{0,15}$/i);
    if (partial) {
      const idx = cleaned.lastIndexOf(partial[0]);
      if (idx !== -1) {
        cleaned = cleaned.slice(0, idx);
        pending = true;
      }
    }
  }
  return { cleaned: cleaned.trim(), proposals, pending, unrenderable };
}

// src/coach/day-analysis.ts
function parseLocalDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}
function subtractDaysKey(dateKey, days) {
  const d = parseLocalDateKey(dateKey);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function formatDateLabel(dateKey, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = parseLocalDateKey(dateKey);
  const diffDays = Math.round((today.getTime() - target.getTime()) / (24 * 60 * 60 * 1e3));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return target.toLocaleDateString(void 0, { weekday: "long", month: "long", day: "numeric" });
}
function compareToAverage(minutesToday, trailingDailyAverageMinutes) {
  if (trailingDailyAverageMinutes <= 0) return "no recent baseline";
  const ratio = minutesToday / trailingDailyAverageMinutes;
  if (ratio >= 1.75) return "well above usual";
  if (ratio >= 1.2) return "above usual";
  if (ratio <= 0.25) return "well below usual";
  if (ratio <= 0.8) return "below usual";
  return "about typical";
}
function buildDayAnalysisBundle(input) {
  const now = input.now ?? /* @__PURE__ */ new Date();
  const lookbackOccurrences = input.lookbackOccurrences ?? 4;
  const entriesByBlockId = /* @__PURE__ */ new Map();
  for (const entry of input.timeEntriesForDay) {
    if (!entry.scheduleBlockId) continue;
    const list = entriesByBlockId.get(entry.scheduleBlockId) ?? [];
    list.push(entry);
    entriesByBlockId.set(entry.scheduleBlockId, list);
  }
  const trailingDatesByBlockId = /* @__PURE__ */ new Map();
  for (const entry of input.trailingTimeEntries) {
    if (!entry.scheduleBlockId) continue;
    const set = trailingDatesByBlockId.get(entry.scheduleBlockId) ?? /* @__PURE__ */ new Set();
    set.add(entry.date);
    trailingDatesByBlockId.set(entry.scheduleBlockId, set);
  }
  const blocks = input.scheduleBlocksForDay.map((block) => {
    const linkedEntries = entriesByBlockId.get(block.id) ?? [];
    const trackedMinutes = linkedEntries.reduce((sum, e) => sum + e.duration, 0);
    const completed = trackedMinutes > 0;
    let completionHistory;
    const trailingDates = trailingDatesByBlockId.get(block.id);
    if (trailingDates) {
      let occurrences = 0;
      let completedOccurrences = 0;
      for (let weeksBack = 1; weeksBack <= lookbackOccurrences; weeksBack++) {
        const pastDateKey = subtractDaysKey(input.dateKey, weeksBack * 7);
        occurrences++;
        if (trailingDates.has(pastDateKey)) completedOccurrences++;
      }
      if (occurrences > 0) {
        const dayName = DAYS_OF_WEEK_FULL[block.dayOfWeek] ?? "that day";
        completionHistory = `completed ${completedOccurrences} of the last ${occurrences} ${dayName}s`;
      }
    }
    return {
      id: block.id,
      title: block.title,
      category: block.category,
      startTime: block.startTime,
      endTime: block.endTime,
      goalId: block.goalId,
      goalTitle: block.goalTitle,
      trackedMinutes,
      completed,
      completionHistory
    };
  });
  const scheduledBlockIds = new Set(input.scheduleBlocksForDay.map((b) => b.id));
  const unscheduledEntries = input.timeEntriesForDay.filter(
    (e) => !e.scheduleBlockId || !scheduledBlockIds.has(e.scheduleBlockId)
  );
  const todayMinutesByGoal = /* @__PURE__ */ new Map();
  for (const entry of input.timeEntriesForDay) {
    if (!entry.goalId) continue;
    const existing = todayMinutesByGoal.get(entry.goalId);
    const title = entry.goalTitle ?? existing?.title ?? "Untitled goal";
    todayMinutesByGoal.set(entry.goalId, { title, minutes: (existing?.minutes ?? 0) + entry.duration });
  }
  const trailingMinutesByGoal = /* @__PURE__ */ new Map();
  for (const entry of input.trailingTimeEntries) {
    if (!entry.goalId) continue;
    trailingMinutesByGoal.set(entry.goalId, (trailingMinutesByGoal.get(entry.goalId) ?? 0) + entry.duration);
  }
  const goalBreakdown = Array.from(todayMinutesByGoal.entries()).map(
    ([goalId, { title, minutes }]) => {
      const trailingTotal = trailingMinutesByGoal.get(goalId) ?? 0;
      const trailingDailyAverageMinutes = input.trailingWindowDays > 0 ? trailingTotal / input.trailingWindowDays : 0;
      return {
        goalId,
        title,
        minutesToday: minutes,
        trailingDailyAverageMinutes,
        comparisonLabel: compareToAverage(minutes, trailingDailyAverageMinutes)
      };
    }
  );
  goalBreakdown.sort((a, b) => b.minutesToday - a.minutesToday);
  const totalTrackedMinutes = input.timeEntriesForDay.reduce((sum, e) => sum + e.duration, 0);
  const completedBlockCount = blocks.filter((b) => b.completed).length;
  const totalBlockCount = blocks.length;
  const patterns = [];
  for (const block of blocks) {
    if (!block.completionHistory) continue;
    const match = /completed (\d+) of the last (\d+)/.exec(block.completionHistory);
    if (!match) continue;
    const completedCount = Number(match[1]);
    const total = Number(match[2]);
    if (total >= 2 && completedCount / total <= 0.5) {
      patterns.push(
        `"${block.title}" is rarely completed: ${block.completionHistory}${block.completed ? " (though it was completed today)" : ""}.`
      );
    }
  }
  if (totalBlockCount > 0 && completedBlockCount === 0) {
    patterns.push(`None of today's ${totalBlockCount} scheduled block${totalBlockCount === 1 ? "" : "s"} were completed.`);
  } else if (totalBlockCount > 0 && completedBlockCount === totalBlockCount) {
    patterns.push(`Every scheduled block today was completed (${completedBlockCount}/${totalBlockCount}).`);
  }
  for (const g of goalBreakdown) {
    if (g.comparisonLabel === "well above usual" || g.comparisonLabel === "well below usual") {
      const direction = g.comparisonLabel === "well above usual" ? "well above" : "well below";
      patterns.push(
        `"${g.title}" got ${formatDuration(g.minutesToday)} today, ${direction} its recent daily average of ${formatDuration(Math.round(g.trailingDailyAverageMinutes))}.`
      );
    }
  }
  if (unscheduledEntries.length > 0) {
    const unscheduledMinutes = unscheduledEntries.reduce((sum, e) => sum + e.duration, 0);
    patterns.push(
      `${formatDuration(unscheduledMinutes)} was logged outside any scheduled block (${unscheduledEntries.length} entr${unscheduledEntries.length === 1 ? "y" : "ies"}).`
    );
  }
  return {
    dateKey: input.dateKey,
    dateLabel: formatDateLabel(input.dateKey, now),
    dayOfWeekLabel: DAYS_OF_WEEK_FULL[parseLocalDateKey(input.dateKey).getDay()] ?? "",
    blocks,
    unscheduledEntries,
    goalBreakdown,
    totalTrackedMinutes,
    completedBlockCount,
    totalBlockCount,
    journalContent: input.journalContent ?? null,
    patterns
  };
}
function formatDayAnalysisPrompt(bundle) {
  const lines = [];
  const capitalizedLabel = bundle.dateLabel === "today" || bundle.dateLabel === "yesterday" ? bundle.dateLabel.charAt(0).toUpperCase() + bundle.dateLabel.slice(1) : bundle.dateLabel;
  lines.push(`Analyze my day (${capitalizedLabel}).`);
  lines.push("");
  if (bundle.totalBlockCount === 0) {
    lines.push("Scheduled blocks: none scheduled this day.");
  } else {
    lines.push(`Scheduled blocks (${bundle.completedBlockCount}/${bundle.totalBlockCount} completed):`);
    for (const block of bundle.blocks) {
      const status = block.completed ? `completed, ${formatDuration(block.trackedMinutes)} tracked` : "not completed";
      const goalPart = block.goalTitle ? `, goal "${block.goalTitle}"` : "";
      const historyPart = block.completionHistory ? ` [history: ${block.completionHistory}]` : "";
      lines.push(
        `- ${formatTime12h(block.startTime)} to ${formatTime12h(block.endTime)} "${block.title}" (${block.category}${goalPart}) \u2014 ${status}${historyPart}`
      );
    }
  }
  lines.push("");
  if (bundle.unscheduledEntries.length > 0) {
    lines.push("Unscheduled time logged today:");
    for (const entry of bundle.unscheduledEntries) {
      const goalPart = entry.goalTitle ? `, goal "${entry.goalTitle}"` : "";
      lines.push(`- ${formatDuration(entry.duration)} "${entry.taskName}"${goalPart}`);
    }
    lines.push("");
  }
  lines.push(`Total tracked today: ${formatDuration(bundle.totalTrackedMinutes)}.`);
  lines.push("");
  if (bundle.goalBreakdown.length > 0) {
    lines.push("Time by goal today vs. recent daily average:");
    for (const g of bundle.goalBreakdown) {
      lines.push(
        `- "${g.title}": ${formatDuration(g.minutesToday)} today, avg ${formatDuration(Math.round(g.trailingDailyAverageMinutes))}/day recently (${g.comparisonLabel}).`
      );
    }
    lines.push("");
  }
  if (bundle.patterns.length > 0) {
    lines.push("Notable patterns I noticed:");
    for (const p of bundle.patterns) lines.push(`- ${p}`);
    lines.push("");
  }
  if (bundle.journalContent && bundle.journalContent.trim().length > 0) {
    lines.push("Today's journal entry:");
    lines.push(`"${bundle.journalContent.trim()}"`);
    lines.push("");
  } else {
    lines.push("No journal entry written for today.");
    lines.push("");
  }
  lines.push(
    "Please reflect on how my day went: call out what worked, what did not, and connect it to the patterns above and the journal entry if there is one. Do not just restate the numbers back to me."
  );
  return lines.join("\n");
}

// src/coach/conversation-index.ts
var DEFAULT_TITLE_MAX = 60;
var DEFAULT_PREVIEW_MAX = 100;
function truncateConversationText(text, maxLength) {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}\u2026`;
}
function deriveConversationTitle(firstMessageContent) {
  const truncated = truncateConversationText(firstMessageContent, DEFAULT_TITLE_MAX);
  return truncated.length > 0 ? truncated : "Conversation";
}
function deriveConversationPreview(lastMessageContent) {
  return truncateConversationText(lastMessageContent, DEFAULT_PREVIEW_MAX);
}
function sortConversationsByRecency(entries) {
  return [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function upsertLiveConversationEntry(entries, input) {
  const existing = entries.find((entry) => entry.kind === "live" && entry.scopeKey === input.scopeKey);
  const preview = deriveConversationPreview(input.latestMessageContent);
  if (!existing) {
    const fresh = {
      id: input.scopeKey,
      kind: "live",
      scopeKey: input.scopeKey,
      title: deriveConversationTitle(input.latestMessageContent),
      preview,
      createdAt: input.now,
      updatedAt: input.now,
      messageCount: 1
    };
    return [...entries, fresh];
  }
  return entries.map(
    (entry) => entry === existing ? { ...entry, preview, updatedAt: input.now, messageCount: entry.messageCount + 1 } : entry
  );
}
function resetLiveConversationEntry(entries, scopeKey, now) {
  return entries.map(
    (entry) => entry.kind === "live" && entry.scopeKey === scopeKey ? { ...entry, title: "", preview: "", messageCount: 0, createdAt: now, updatedAt: now } : entry
  );
}
function insertArchivedConversationEntry(entries, entry) {
  return [...entries, entry];
}
function removeConversationIndexEntry(entries, id) {
  return entries.filter((entry) => entry.id !== id);
}
function summariseTurnsForArchive(turns) {
  const first = turns.find((turn) => turn.content.trim().length > 0);
  const last = [...turns].reverse().find((turn) => turn.content.trim().length > 0);
  return {
    title: first ? deriveConversationTitle(first.content) : "Conversation",
    preview: last ? deriveConversationPreview(last.content) : ""
  };
}

// src/voice/intent.ts
var VOICE_INTENT_TYPES = [
  "START_TRACKING",
  "STOP_TRACKING",
  "PAUSE",
  "RESUME",
  "LOG_TIME",
  "APPEND_NOTE",
  "UNKNOWN"
];
var TARGET_KINDS = ["goal", "task", "category", "note"];
var NO_TARGET = Object.freeze({ kind: "none" });
function namedTarget(kind, name) {
  return Object.freeze({ kind, name: name.trim().replace(/\s+/g, " ") });
}
function isNamedTarget(target) {
  return target.kind !== "none";
}
function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0;
  const bounded = Math.min(1, Math.max(0, value));
  return Math.round(bounded * 100) / 100;
}
function unknownIntent(transcript, confidence = 0) {
  return { type: "UNKNOWN", transcript, confidence: clampConfidence(confidence) };
}
function isActionableVoiceIntent(intent) {
  return intent.type !== "UNKNOWN";
}
function isReversibleVoiceIntent(intent) {
  return intent.type === "START_TRACKING" || intent.type === "STOP_TRACKING" || intent.type === "PAUSE" || intent.type === "RESUME";
}

// src/voice/parse.ts
var DEFAULT_KIND_WORDS = {
  goal: "goal",
  goals: "goal",
  objective: "goal",
  task: "task",
  tasks: "task",
  todo: "task",
  item: "task",
  category: "category",
  categories: "category",
  project: "category",
  bucket: "category",
  area: "category",
  note: "note",
  notes: "note",
  page: "note",
  pages: "note"
};
var COMBINING_MARKS = /[̀-ͯ]/g;
var APOSTROPHES = /['‘’ʼ]/g;
var NON_FOLDABLE = /[^a-z0-9\s]/g;
function foldText(input) {
  return input.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().replace(APOSTROPHES, "").replace(NON_FOLDABLE, " ").replace(/\s+/g, " ").trim();
}
function tokenize(input) {
  const folded = foldText(input);
  return folded.length === 0 ? [] : folded.split(" ");
}
var DISFLUENCIES = /* @__PURE__ */ new Set(["um", "uh", "uhm", "erm", "er", "ah", "eh", "hmm", "mm", "mmm"]);
var LEADING_PHRASES = [
  "hey there",
  "hey",
  "hi",
  "hello",
  "yo",
  "yeah",
  "yep",
  "ok",
  "okay",
  "so",
  "well",
  "alright",
  "all right",
  "please",
  "just",
  "now",
  "can you",
  "could you",
  "would you",
  "will you",
  "i want to",
  "i would like to",
  "id like to",
  "i need to",
  "lets",
  "let us",
  "go ahead and"
];
var TRAILING_PHRASES = [
  "please",
  "thanks",
  "thank you",
  "for me",
  "will you",
  "ok",
  "okay",
  "alright"
];
var RULE_GROUPS = [
  {
    type: "START_TRACKING",
    phrases: [
      "start tracking time for",
      "start tracking time",
      "start tracking",
      "start working on",
      "start work on",
      "start the timer",
      "start a timer",
      "start timer",
      "start the clock",
      "start",
      "begin tracking time",
      "begin tracking",
      "begin working on",
      "begin",
      "clock in on",
      "clock into",
      "clock in",
      "punch in",
      "switch over to",
      "switch to",
      "new timer for",
      "new timer"
    ],
    weakPhrases: ["track time on", "track time", "track", "im working on", "i am working on", "working on", "work on"]
  },
  {
    type: "STOP_TRACKING",
    phrases: [
      "stop tracking time",
      "stop tracking",
      "stop working on",
      "stop the timer",
      "stop timer",
      "stop the clock",
      "stop the session",
      "stop",
      "end tracking",
      "end the timer",
      "end timer",
      "end the session",
      "end session",
      "finish tracking",
      "clock out of",
      "clock out",
      "punch out",
      "im finished",
      "i am finished",
      "im done",
      "i am done"
    ],
    weakPhrases: ["end", "finish up", "finish", "finished", "done", "thats it", "wrap up"]
  },
  {
    type: "PAUSE",
    phrases: ["pause tracking", "pause the timer", "pause timer", "pause", "take a break", "hold the timer"],
    weakPhrases: ["hold on"]
  },
  {
    type: "RESUME",
    phrases: [
      "resume tracking",
      "resume the timer",
      "resume timer",
      "resume",
      "unpause",
      "un pause",
      "continue tracking",
      "continue the timer",
      "continue timer",
      "start again",
      "back to work"
    ],
    weakPhrases: ["continue", "keep going", "carry on", "im back", "i am back"]
  },
  {
    type: "LOG_TIME",
    needsDuration: true,
    phrases: ["log", "record", "bill", "credit", "ive spent", "i spent", "spent", "i worked", "worked for", "worked"]
  },
  {
    // "Add this to my shopping notes." The verb is deliberately bare where
    // the spec's phrasing only illustrated it wrapped in a preposition
    // ("add this to", "add to") — those still match here (see
    // splitContentAndTarget below: a phrase like "add to" just leaves an
    // empty content span, which is rejected downstream), but a bare "add"
    // is what lets the ordinary case — "add CONTENT to my NAME notes" —
    // match at all, since the actual content sits between the verb and the
    // connective rather than being one of these fixed words.
    type: "APPEND_NOTE",
    phrases: [
      "add this to",
      "add that to",
      "add to",
      "add",
      "append this to",
      "append that to",
      "append to",
      "append",
      "jot this down in",
      "jot that down in",
      "jot down in",
      "jot this down",
      "jot down",
      "note this in",
      "note that in",
      "note in",
      "note",
      "put this in",
      "put that in",
      "put in",
      "put"
    ]
  }
];
function toRules(group) {
  const needsDuration = group.needsDuration ?? false;
  const strong = group.phrases.map((phrase) => ({
    phrase: phrase.split(" "),
    type: group.type,
    weak: false,
    needsDuration
  }));
  const weak = (group.weakPhrases ?? []).map((phrase) => ({
    phrase: phrase.split(" "),
    type: group.type,
    weak: true,
    needsDuration
  }));
  return [...strong, ...weak];
}
var COMMAND_RULES = RULE_GROUPS.flatMap(toRules).map((rule, index) => ({ rule, index })).sort(
  (a, b) => b.rule.phrase.length - a.rule.phrase.length || Number(a.rule.weak) - Number(b.rule.weak) || a.index - b.index
).map(({ rule }) => rule);
var BASE_CONFIDENCE = 0.9;
var EXACT_PHRASE_BONUS = 0.05;
var LEADING_NOISE_PENALTY = 0.1;
var WEAK_PHRASE_PENALTY = 0.15;
var ASSUMED_UNIT_PENALTY = 0.1;
var MAX_LEAD_TOKENS = 3;
var DETERMINERS = /* @__PURE__ */ new Set(["my", "our", "the", "a", "an", "this", "that", "some", "it"]);
var CONNECTIVES = /* @__PURE__ */ new Set([
  "on",
  "in",
  "at",
  "to",
  "for",
  "of",
  "from",
  "into",
  "onto",
  "against",
  "toward",
  "towards",
  "with"
]);
var CONTEXTUAL_NOISE = /* @__PURE__ */ new Set(["time"]);
var ACTIVITY_NOISE = /* @__PURE__ */ new Set(["work", "works", "working", "tracking"]);
var TRAILING_NOISE = /* @__PURE__ */ new Set(["now", "today", "tonight", "again", "already"]);
var INTERROGATIVES = /* @__PURE__ */ new Set([
  "what",
  "whats",
  "when",
  "where",
  "why",
  "how",
  "who",
  "whom",
  "whose",
  "which",
  "did",
  "do",
  "does",
  "am",
  "is",
  "are",
  "was",
  "were",
  "should"
]);
var REFUSED_OPENERS = /* @__PURE__ */ new Set(["cancel", "discard", "delete", "remove", "undo", "scrap", "abandon"]);
var VAGUE_TIME = /* @__PURE__ */ new Set([
  "moment",
  "moments",
  "sec",
  "secs",
  "second",
  "seconds",
  "minute",
  "minutes",
  "min",
  "mins",
  "bit",
  "while",
  "break",
  "breather"
]);
var NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  forty5: 45,
  fortyfive: 45,
  fifty: 50,
  sixty: 60,
  ninety: 90
};
var HOUR_UNITS = /* @__PURE__ */ new Set(["hour", "hours", "hr", "hrs", "h"]);
var MINUTE_UNITS = /* @__PURE__ */ new Set(["minute", "minutes", "min", "mins", "m"]);
var SECOND_UNITS = /* @__PURE__ */ new Set(["second", "seconds", "sec", "secs", "s"]);
function unitMinutes(token) {
  if (HOUR_UNITS.has(token)) return 60;
  if (MINUTE_UNITS.has(token)) return 1;
  if (SECOND_UNITS.has(token)) return 1 / 60;
  return null;
}
var FRACTION_WORDS = /* @__PURE__ */ new Set(["half", "quarter", "quarters"]);
function numberAt(tokens, index) {
  const token = tokens[index];
  if (token === void 0) return null;
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  if (token === "a" || token === "an") {
    const next = tokens[index + 1];
    const introducesTime = next !== void 0 && (unitMinutes(next) !== null || FRACTION_WORDS.has(next));
    return introducesTime ? 1 : null;
  }
  const word = NUMBER_WORDS[token];
  return word ?? null;
}
function findSpokenDuration(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === void 0) continue;
    const fraction = token === "half" ? 0.5 : FRACTION_WORDS.has(token) ? 0.25 : null;
    if (fraction !== null) {
      const multiplier = i > 0 ? numberAt(tokens, i - 1) ?? 1 : 1;
      const start = i > 0 && numberAt(tokens, i - 1) !== null ? i - 1 : i;
      for (let j = i + 1; j <= i + 3 && j < tokens.length; j += 1) {
        const unit = tokens[j];
        if (unit === void 0) continue;
        const perUnit2 = unitMinutes(unit);
        if (perUnit2 !== null) {
          return { minutes: fraction * multiplier * perUnit2, start, end: j + 1, assumedUnit: false };
        }
      }
      continue;
    }
    const value = numberAt(tokens, i);
    if (value === null) continue;
    const next = tokens[i + 1];
    const perUnit = next === void 0 ? null : unitMinutes(next);
    if (perUnit === null) {
      if (i === 0) return { minutes: value, start: i, end: i + 1, assumedUnit: true };
      continue;
    }
    let minutes = value * perUnit;
    let end = i + 2;
    let cursor = end;
    if (tokens[cursor] === "and") cursor += 1;
    const article = tokens[cursor];
    const afterArticle = tokens[cursor + 1];
    if ((article === "a" || article === "an") && afterArticle !== void 0 && FRACTION_WORDS.has(afterArticle)) {
      cursor += 1;
    }
    const tail = tokens[cursor];
    if (perUnit === 60 && tail !== void 0 && FRACTION_WORDS.has(tail)) {
      minutes += tail === "half" ? 30 : 15;
      end = cursor + 1;
    } else {
      const tailValue = numberAt(tokens, cursor);
      if (tailValue !== null && perUnit === 60) {
        const tailUnit = tokens[cursor + 1];
        const tailPerUnit = tailUnit === void 0 ? null : unitMinutes(tailUnit);
        minutes += tailValue * (tailPerUnit ?? 1);
        end = tailPerUnit === null ? cursor + 1 : cursor + 2;
      }
    }
    return { minutes, start: i, end, assumedUnit: false };
  }
  return null;
}
function matchesAt(tokens, index, phrase) {
  if (index < 0 || index + phrase.length > tokens.length) return false;
  for (let offset = 0; offset < phrase.length; offset += 1) {
    if (tokens[index + offset] !== phrase[offset]) return false;
  }
  return true;
}
function splitPhrases(phrases) {
  return phrases.map((phrase) => phrase.split(" "));
}
var LEADING = splitPhrases(LEADING_PHRASES);
var TRAILING = splitPhrases(TRAILING_PHRASES);
function stripLeading(tokens, phrases) {
  let result = tokens;
  let stripping = true;
  while (stripping && result.length > 0) {
    stripping = false;
    for (const phrase of phrases) {
      if (matchesAt(result, 0, phrase)) {
        result = result.slice(phrase.length);
        stripping = true;
        break;
      }
    }
  }
  return result;
}
function stripTrailing(tokens, phrases) {
  let result = tokens;
  let stripping = true;
  while (stripping && result.length > 0) {
    stripping = false;
    for (const phrase of phrases) {
      if (matchesAt(result, result.length - phrase.length, phrase)) {
        result = result.slice(0, result.length - phrase.length);
        stripping = true;
        break;
      }
    }
  }
  return result;
}
function normalizeUtterance(transcript, wakeWords) {
  const wake = splitPhrases(wakeWords.map(foldText).filter((word) => word.length > 0));
  const tokens = tokenize(transcript).filter((token) => !DISFLUENCIES.has(token));
  return stripTrailing(stripLeading(tokens, [...wake, ...LEADING]), TRAILING);
}
function hasNameAfter(tokens, from) {
  for (let i = from; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === void 0) return false;
    if (DETERMINERS.has(token) || CONNECTIVES.has(token) || TRAILING_NOISE.has(token)) continue;
    return true;
  }
  return false;
}
function stripTargetNoise(tokens) {
  let start = 0;
  let end = tokens.length;
  while (start < end) {
    const token = tokens[start];
    if (token === void 0) break;
    if (DETERMINERS.has(token) || CONNECTIVES.has(token)) {
      start += 1;
      continue;
    }
    if (CONTEXTUAL_NOISE.has(token)) {
      const next = tokens[start + 1];
      if (next === void 0 || CONNECTIVES.has(next) || DETERMINERS.has(next)) {
        start += 1;
        continue;
      }
    }
    if (ACTIVITY_NOISE.has(token)) {
      const next = tokens[start + 1];
      if (next !== void 0 && CONNECTIVES.has(next) && hasNameAfter(tokens, start + 1)) {
        start += 1;
        continue;
      }
    }
    break;
  }
  while (end > start) {
    const token = tokens[end - 1];
    if (token === void 0) break;
    if (!TRAILING_NOISE.has(token) && !CONNECTIVES.has(token) && !DETERMINERS.has(token)) break;
    end -= 1;
  }
  return tokens.slice(start, end);
}
function extractTarget(tokens, kindWords) {
  const cleaned = stripTargetNoise(tokens);
  const first = cleaned[0];
  if (first === void 0) return NO_TARGET;
  if (cleaned.length === 1) {
    return kindWords[first] === void 0 ? namedTarget("unspecified", first) : NO_TARGET;
  }
  const last = cleaned[cleaned.length - 1];
  const suffixKind = last === void 0 ? void 0 : kindWords[last];
  const prefixKind = kindWords[first];
  let kind = "unspecified";
  let name = cleaned;
  if (suffixKind !== void 0) {
    kind = suffixKind;
    name = cleaned.slice(0, -1);
  } else if (prefixKind !== void 0) {
    kind = prefixKind;
    name = cleaned.slice(1);
  }
  const trimmed = stripTargetNoise(name);
  if (trimmed.length === 0) return NO_TARGET;
  return namedTarget(kind, trimmed.join(" "));
}
var APPEND_CONNECTIVES = /* @__PURE__ */ new Set(["to", "in", "into", "under", "onto"]);
function splitContentAndTarget(tail, kindWords = DEFAULT_KIND_WORDS) {
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const token = tail[i];
    if (token === void 0 || !APPEND_CONNECTIVES.has(token)) continue;
    const targetTokens = tail.slice(i + 1);
    if (targetTokens.length === 0) continue;
    const candidate = extractTarget(targetTokens, kindWords);
    if (isNamedTarget(candidate) && candidate.kind === "note") {
      return { target: candidate, contentEnd: i };
    }
  }
  return null;
}
function matchesAtPaired(tokens, index, phrase) {
  if (index < 0 || index + phrase.length > tokens.length) return false;
  for (let offset = 0; offset < phrase.length; offset += 1) {
    if (tokens[index + offset]?.folded !== phrase[offset]) return false;
  }
  return true;
}
function stripLeadingPaired(tokens, phrases) {
  let result = tokens;
  let stripping = true;
  while (stripping && result.length > 0) {
    stripping = false;
    for (const phrase of phrases) {
      if (matchesAtPaired(result, 0, phrase)) {
        result = result.slice(phrase.length);
        stripping = true;
        break;
      }
    }
  }
  return result;
}
function stripTrailingPaired(tokens, phrases) {
  let result = tokens;
  let stripping = true;
  while (stripping && result.length > 0) {
    stripping = false;
    for (const phrase of phrases) {
      if (matchesAtPaired(result, result.length - phrase.length, phrase)) {
        result = result.slice(0, result.length - phrase.length);
        stripping = true;
        break;
      }
    }
  }
  return result;
}
function pairedTokens(transcript, wakeWords) {
  const wake = splitPhrases(wakeWords.map(foldText).filter((word) => word.length > 0));
  const trimmed = transcript.trim();
  const words = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const pairs = [];
  for (const raw of words) {
    const folded = foldText(raw);
    if (folded.length === 0 || DISFLUENCIES.has(folded)) continue;
    pairs.push({ raw, folded });
  }
  return stripTrailingPaired(stripLeadingPaired(pairs, [...wake, ...LEADING]), TRAILING);
}
function isTimeQualifierOnly(tokens) {
  const cleaned = stripTargetNoise(tokens);
  if (cleaned.length === 0) return true;
  if (cleaned.every((token) => VAGUE_TIME.has(token))) return true;
  const duration = findSpokenDuration(cleaned);
  return duration !== null && duration.start === 0 && duration.end === cleaned.length;
}
function findRule(tokens) {
  const maxLead = Math.min(MAX_LEAD_TOKENS, Math.max(tokens.length - 1, 0));
  for (let lead = 0; lead <= maxLead; lead += 1) {
    for (const rule of COMMAND_RULES) {
      if (matchesAt(tokens, lead, rule.phrase)) return { rule, lead };
    }
  }
  return null;
}
function parseVoiceCommand(transcript, options = {}) {
  const kindWords = options.kindWords ?? DEFAULT_KIND_WORDS;
  const tokens = normalizeUtterance(transcript, options.wakeWords ?? []);
  const opening = tokens[0];
  if (opening !== void 0 && (INTERROGATIVES.has(opening) || REFUSED_OPENERS.has(opening))) {
    return unknownIntent(transcript);
  }
  const match = findRule(tokens);
  if (match === null) return unknownIntent(transcript);
  const { rule, lead } = match;
  let rest = tokens.slice(lead + rule.phrase.length);
  if (rule.type === "APPEND_NOTE") {
    const split = splitContentAndTarget(rest, kindWords);
    if (split === null) return unknownIntent(transcript);
    const contentFolded = rest.slice(0, split.contentEnd);
    const paired = pairedTokens(transcript, options.wakeWords ?? []);
    const aligned = paired.length === tokens.length && paired.every((word, index) => word.folded === tokens[index]);
    const contentStart = lead + rule.phrase.length;
    const content = aligned ? paired.slice(contentStart, contentStart + split.contentEnd).map((word) => word.raw).join(" ").trim() : contentFolded.join(" ");
    if (content.length === 0) return unknownIntent(transcript);
    let score2 = BASE_CONFIDENCE;
    if (lead > 0) score2 -= LEADING_NOISE_PENALTY;
    if (rule.weak) score2 -= WEAK_PHRASE_PENALTY;
    const confidence2 = clampConfidence(score2);
    if (confidence2 < (options.minConfidence ?? 0)) return unknownIntent(transcript, confidence2);
    return { type: "APPEND_NOTE", target: split.target, content, transcript, confidence: confidence2 };
  }
  let durationMinutes = 0;
  let assumedUnit = false;
  if (rule.needsDuration) {
    const duration = findSpokenDuration(rest);
    if (duration === null) return unknownIntent(transcript);
    durationMinutes = duration.minutes;
    assumedUnit = duration.assumedUnit;
    rest = [...rest.slice(0, duration.start), ...rest.slice(duration.end)];
  } else if (isTimeQualifierOnly(rest)) {
    rest = [];
  }
  const target = extractTarget(rest, kindWords);
  let score = BASE_CONFIDENCE;
  if (lead > 0) score -= LEADING_NOISE_PENALTY;
  if (rule.weak) score -= WEAK_PHRASE_PENALTY;
  if (assumedUnit) score -= ASSUMED_UNIT_PENALTY;
  if (lead === 0 && !rule.weak && tokens.length === rule.phrase.length) score += EXACT_PHRASE_BONUS;
  const confidence = clampConfidence(score);
  if (confidence < (options.minConfidence ?? 0)) return unknownIntent(transcript, confidence);
  switch (rule.type) {
    case "START_TRACKING":
      return { type: "START_TRACKING", target, transcript, confidence };
    case "STOP_TRACKING":
      return { type: "STOP_TRACKING", target, transcript, confidence };
    case "PAUSE":
      return { type: "PAUSE", target, transcript, confidence };
    case "RESUME":
      return { type: "RESUME", target, transcript, confidence };
    case "LOG_TIME":
      return { type: "LOG_TIME", target, transcript, confidence, durationMinutes };
  }
}

// src/voice/resolve.ts
var DEFAULT_MIN_SCORE = 0.6;
var DEFAULT_CONFIDENT_SCORE = 0.82;
var DEFAULT_AMBIGUITY_MARGIN = 0.08;
var MAX_CANDIDATES = 4;
var PHONETIC_SCORE = 0.85;
function round(value) {
  return Math.round(value * 1e3) / 1e3;
}
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distance = new Array(rows * cols).fill(0);
  const get = (row, col) => distance[row * cols + col] ?? 0;
  const set = (row, col, value) => {
    distance[row * cols + col] = value;
  };
  for (let row = 0; row < rows; row += 1) set(row, 0, row);
  for (let col = 0; col < cols; col += 1) set(0, col, col);
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      let best = Math.min(get(row - 1, col) + 1, get(row, col - 1) + 1, get(row - 1, col - 1) + cost);
      if (row > 1 && col > 1 && a[row - 1] === b[col - 2] && a[row - 2] === b[col - 1]) {
        best = Math.min(best, get(row - 2, col - 2) + 1);
      }
      set(row, col, best);
    }
  }
  return get(rows - 1, cols - 1);
}
function editRatio(a, b) {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return 1 - editDistance(a, b) / longest;
}
function sortTokens(text) {
  return text.split(" ").sort().join(" ");
}
function compact(text) {
  return text.replace(/ /g, "");
}
function coverage(from, to) {
  let matched = 0;
  let total = 0;
  for (const token of from) {
    let best = 0;
    for (const other of to) best = Math.max(best, editRatio(token, other));
    matched += token.length * best;
    total += token.length;
  }
  return total === 0 ? 0 : matched / total;
}
function tokenOverlap(a, b) {
  const forward = coverage(a.split(" "), b.split(" "));
  const backward = coverage(b.split(" "), a.split(" "));
  if (forward + backward === 0) return 0;
  return 2 * forward * backward / (forward + backward);
}
function consonantSkeleton(word) {
  const collapsed = word.replace(/(.)\1+/g, "$1");
  return collapsed.slice(0, 1) + collapsed.slice(1).replace(/[aeiou]/g, "");
}
function soundsTheSame(a, b) {
  const left = a.split(" ").map(consonantSkeleton).join(" ");
  const right = b.split(" ").map(consonantSkeleton).join(" ");
  return left.length >= 2 && left === right && a.slice(0, 1) === b.slice(0, 1);
}
function nameSimilarity(a, b) {
  const left = foldText(a);
  const right = foldText(b);
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;
  return round(
    Math.max(
      editRatio(left, right),
      editRatio(sortTokens(left), sortTokens(right)),
      editRatio(compact(left), compact(right)),
      tokenOverlap(left, right),
      soundsTheSame(left, right) ? PHONETIC_SCORE : 0
    )
  );
}
function compareStrings(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
function byScoreThenName(a, b) {
  return b.score - a.score || compareStrings(a.name, b.name) || compareStrings(a.id, b.id);
}
function variantsOf(name, kindWords) {
  const folded = foldText(name);
  if (folded.length === 0) return [];
  const tokens = folded.split(" ");
  const variants = /* @__PURE__ */ new Set([folded]);
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last !== void 0 && kindWords[last] !== void 0) variants.add(tokens.slice(0, -1).join(" "));
    const first = tokens[0];
    if (first !== void 0 && kindWords[first] !== void 0) variants.add(tokens.slice(1).join(" "));
  }
  return [...variants];
}
function bestMatch(spoken, candidate) {
  let best = { score: 0, matchedOn: candidate.name };
  for (const known of [candidate.name, ...candidate.aliases ?? []]) {
    for (const said of spoken) {
      const score = nameSimilarity(said, known);
      if (score > best.score) best = { score, matchedOn: known };
    }
  }
  return best;
}
function rankTargets(target, candidates, options = {}) {
  const kindWords = options.kindWords ?? DEFAULT_KIND_WORDS;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const spoken = variantsOf(target.name, kindWords);
  if (spoken.length === 0) return [];
  const matches = [];
  for (const candidate of candidates) {
    if (target.kind !== "unspecified" && candidate.kind !== target.kind) continue;
    const match = bestMatch(spoken, candidate);
    if (match.score < minScore) continue;
    matches.push({
      id: candidate.id,
      name: candidate.name,
      kind: candidate.kind,
      score: match.score,
      matchedOn: match.matchedOn
    });
  }
  return matches.sort(byScoreThenName);
}
function resolveSpokenTarget(target, candidates, options = {}) {
  const confidentScore = options.confidentScore ?? DEFAULT_CONFIDENT_SCORE;
  const ambiguityMargin = options.ambiguityMargin ?? DEFAULT_AMBIGUITY_MARGIN;
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES;
  const ranked = rankTargets(target, candidates, options).slice(0, maxCandidates);
  const best = ranked[0];
  if (best === void 0) {
    return { status: "unresolved", target: null, candidates: [], reason: "no-match" };
  }
  const runnerUp = ranked[1];
  if (runnerUp !== void 0 && best.score - runnerUp.score < ambiguityMargin) {
    return { status: "needs-confirmation", target: best, candidates: ranked, reason: "ambiguous" };
  }
  if (best.score < confidentScore) {
    return { status: "needs-confirmation", target: best, candidates: ranked, reason: "weak-match" };
  }
  return { status: "confident", target: best, candidates: ranked };
}

// src/index.ts
var SHARED_PACKAGE_NAME = "@goalslot/shared";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COACH_BUDGET_INCREMENT_PERCENTS,
  COACH_BYOK_MAX_TOKEN_BUDGET,
  COACH_BYOK_MIN_TOKEN_BUDGET,
  COACH_BYOK_PROVIDERS,
  COACH_PROPOSAL_ACTION_TYPES,
  COACH_RELIGIOUS_CONTEXTS,
  COACH_VOICE_INTENT_TYPES,
  DAYS_OF_WEEK,
  DAYS_OF_WEEK_FULL,
  DAY_END_MIN,
  DAY_START_MIN,
  DEFAULT_KIND_WORDS,
  DEFAULT_PAGE_SIZE,
  GOAL_STATUS_OPTIONS,
  IDEMPOTENCY_KEY_HEADER,
  INDENTATION_WIDTH,
  MAX_JOURNAL_CONTENT_LENGTH,
  MAX_MESSAGE_LENGTH,
  MessagingError,
  NO_TARGET,
  SHARED_PACKAGE_NAME,
  TARGET_KINDS,
  VOICE_INTENT_TYPES,
  applyMessageToConversations,
  applyReadReceipt,
  buildDayAnalysisBundle,
  buildMessagingContacts,
  buildNoteTree,
  buildReorderPayload,
  buildSocketUrl,
  buildZonedDateFromParts,
  calculateProgressPercent,
  clampConfidence,
  coachBudgetIncrements,
  coachByokProviderMeta,
  completeTaskSchema,
  confirmPendingMessage,
  contactsByUserId,
  contactsWithoutConversation,
  countUnreadConversations,
  createApiClient,
  createAuthApi,
  createCategoriesApi,
  createCategoryQueries,
  createCoachApi,
  createCoachQueries,
  createCoachSettingsApi,
  createCoachSettingsQueries,
  createConsoleAnalytics,
  createGoalQueries,
  createGoalSchema,
  createGoalsApi,
  createInstructionsApi,
  createInstructionsQueries,
  createJournalApi,
  createJournalEntrySchema,
  createJournalQueries,
  createLabelQueries,
  createLabelsApi,
  createMessagingApi,
  createMessagingQueries,
  createMessagingServiceClient,
  createMessagingSocket,
  createMessagingTokenStore,
  createNoopCapabilities,
  createNoteQueries,
  createNotesApi,
  createOfflineSync,
  createOperationRegistry,
  createOutbox,
  createPushSubscriptionsApi,
  createScheduleApi,
  createScheduleBlockSchema,
  createScheduleQueries,
  createSharingApi,
  createSharingQueries,
  createStaticFeatureFlags,
  createTaskQueries,
  createTaskSchema,
  createTasksApi,
  createTimeEntriesApi,
  createTimeEntryQueries,
  createTimeEntrySchema,
  createTimerSessionApi,
  createTimerSessionQueries,
  createUsersApi,
  currentCoachWeekScopeKey,
  deriveConversationPreview,
  deriveConversationTitle,
  extractCoachProposals,
  findCounterpart,
  findNextScheduleBlock,
  findParticipant,
  findSpokenDuration,
  findUpcomingScheduleBlocks,
  flattenVisibleTree,
  foldText,
  formatCoachTokenCount,
  formatDayAnalysisPrompt,
  formatDuration,
  formatTime12h,
  genId,
  getISOWeekKey,
  getLocalDateString,
  getLocalTimeString,
  getProjection,
  getReportingWeekDates,
  hasResponse,
  idempotentConfig,
  insertArchivedConversationEntry,
  isActionableVoiceIntent,
  isCoachBudgetExceededError,
  isConversationUnread,
  isNamedTarget,
  isPendingMessage,
  isReversibleVoiceIntent,
  labelInputSchema,
  lastReadAtFor,
  markPendingMessage,
  mergeOlderMessages,
  mergeServerMessages,
  minutesToTime,
  nameSimilarity,
  namedTarget,
  newestServerMessage,
  normalizeCoachActionType,
  oldestMessageTimestamp,
  parseCoachByokBudget,
  parseCoachSseStream,
  parseIncomingMessage,
  parseVoiceCommand,
  postCoachStream,
  rankTargets,
  reconcileIncomingMessage,
  reconnectDelayMs,
  removeConversationIndexEntry,
  removePendingMessage,
  resetLiveConversationEntry,
  resolveActiveBlock,
  resolveSpokenTarget,
  sortConversationsByRecency,
  sortMessages,
  splitContentAndTarget,
  summariseTurnsForArchive,
  taskStatusSchema,
  timeToMinutes,
  toActiveTimerSession,
  toMessagingError,
  todayKey,
  truncateConversationText,
  unknownIntent,
  updateGoalSchema,
  updateJournalEntrySchema,
  updateScheduleBlockSchema,
  updateTaskSchema,
  updateTimeEntrySchema,
  upsertJournalEntrySchema,
  upsertLiveConversationEntry,
  upsertMessage,
  validateCoachByokKey
});
//# sourceMappingURL=index.cjs.map