// Notes tab: OneNote-style pages tree (pages + subpages, indent = depth).
// The tree math is all shared code (packages/shared/src/notes/tree.ts,
// ported from the web's dnd-kit sortable-tree implementation): vertical drag
// position picks the slot, horizontal drag offset picks the depth, and the
// dragged note's subtree tucks away for the duration of the drag so cycles
// are impossible by construction.
//
// Rendering deliberately uses a plain Reanimated Animated.ScrollView with
// fixed-height rows instead of FlashList: cell recycling reuses row views
// while a drag transform is mid-flight (the lifted row's transform would be
// recycled onto another item), and a notes list is tens-to-hundreds of rows,
// not thousands — fixed ROW_H math over a ScrollView is simpler and safe.
//
// Worklet boundary (important): the shared getProjection/buildReorderPayload
// are plain JS and MUST NOT be called from worklets per-frame. The drag loop
// keeps a minimal UI-thread mirror (an array of row depths + the same
// prev/next clamp rules) to drive the drop indicator, fires haptics only on
// slot/depth *changes* via runOnJS, and calls the real shared functions
// exactly once, on drop, from the JS thread.
//
// Mutations follow the tasks.tsx snapshot-rollback shape: optimistic cache
// patch -> live call -> invalidate on success / restore snapshot + toast on
// failure.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";

import {
  buildNoteTree,
  buildReorderPayload,
  flattenVisibleTree,
  genId,
  getProjection,
  hasResponse,
  type CreateNoteDto,
  type FlatNote,
  type Note,
  type NoteDetailResponse,
  type NoteReorderItem,
  type NoteTreeItem,
} from "@goalslot/shared";

import { QueryErrorState, SkeletonListItem } from "@/components";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { ListEmptyState, ScreenHeader } from "@/components/lists";
import { useScreenView } from "@/hooks/useScreenView";
import { colors, minTouchTarget, radii, spacing, typography } from "@/theme/tokens";
// `shadows.raised` (the lifted-row elevation) is only surfaced by the theme's
// other entry point — `@/theme/tokens` re-exports just {card, fab}. Both files
// read from the same src/theme/foundation.ts, so this is one token source, not
// two; see the header comment in foundation.ts for why the split exists.
import { shadows } from "@/theme";
import { apiClient, notify } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/get-error-message";
import {
  hapticCompletion,
  hapticDepthTick,
  hapticDragStart,
  hapticLight,
  hapticSlotTick,
} from "@/lib/haptics";
import { queueOfflineEdit } from "@/lib/offline";
import { noteQueries } from "@/lib/queries";
import { queryClient } from "@/lib/query-client";
import { useNotesUiStore } from "@/lib/notes-ui-store";
import { useAnalytics } from "@/providers/growth-provider";
import { useAuth } from "@/providers/auth-provider";

/**
 * Create/delete/reorder/favorite now queue to the offline outbox exactly
 * like every other mutating call site in the app (note/[id].tsx's
 * title/content autosave was the first one queued here, since that was the
 * highest-risk gap — typed content lost outright). `hasResponse` (the same
 * duck-type check `queueOfflineEdit` uses) still does the "was this a
 * genuine rejection or did the request never reach the server" split for the
 * toast shown on an actual rejection — the two used to read identically as a
 * generic "please try again", which told an offline user their own
 * connection might be the fixable part when it wasn't going to
 * retry-and-succeed at all.
 */
function offlineAwareNotify(err: unknown, rejectionMessage: string): void {
  console.error(err);
  if (!hasResponse(err)) {
    notify("You're offline — reconnect and try again.", "offline");
    return;
  }
  notify(getErrorMessage(err, rejectionMessage), "error");
}

/** Fixed row height — every drag/drop position is index * ROW_H. */
const ROW_H = 48;
/** On-screen indent per depth level AND the horizontal drag quantum passed
 *  to the shared getProjection — same value as the shared
 *  INDENTATION_WIDTH, kept as a local constant because it doubles as the
 *  layout indent. Wide enough that thumb jitter doesn't flicker the
 *  projected depth. */
const INDENT_W = 24;
/** Width of the chevron / spacer slot that leads every row. Also positions
 *  the depth guide hairlines so they run through the middle of that slot. */
const CHEVRON_SIZE = 24;
/** Vertical padding above/below the rows inside the scroll content. */
const LIST_PAD = 8;
/** Start autoscrolling when the lifted row is within this of an edge. */
const AUTOSCROLL_EDGE = 72;
/** Max autoscroll speed in px/second (proximity-ramped from 0). */
const AUTOSCROLL_MAX_SPEED = 520;
const SKELETON_ROW_COUNT = 8;
const DRAG_ACTIVATE_MS = 300;
const INDICATOR_TIMING_MS = 120;

const listKey = noteQueries.noteQueries.list();

export default function NotesScreen() {
  const analytics = useAnalytics();
  const { user } = useAuth();

  const { data: notes, isPending, isError, error, isFetching, refetch } = useQuery(noteQueries.list());

  const collapsedIds = useNotesUiStore((s) => s.collapsedIds);
  const toggleCollapsed = useNotesUiStore((s) => s.toggleCollapsed);
  const expand = useNotesUiStore((s) => s.expand);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useScreenView("notes");

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const collapsedSet = useMemo(() => new Set(collapsedIds), [collapsedIds]);
  const tree = useMemo(() => buildNoteTree(notes ?? []), [notes]);
  const visibleItems = useMemo(
    () => flattenVisibleTree(tree, collapsedSet, activeId),
    [tree, collapsedSet, activeId],
  );

  /** id -> full-tree node (children lookups for delete/indent/outdent). */
  const nodeMap = useMemo(() => {
    const map = new Map<string, NoteTreeItem>();
    const walk = (items: NoteTreeItem[]) => {
      for (const item of items) {
        map.set(item.id, item);
        walk(item.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  /** id -> "page X of Y" among its full-tree siblings, for a11y labels. */
  const siblingInfo = useMemo(() => {
    const map = new Map<string, { position: number; count: number }>();
    const walk = (items: NoteTreeItem[]) => {
      items.forEach((item, index) => {
        map.set(item.id, { position: index + 1, count: items.length });
        walk(item.children);
      });
    };
    walk(tree);
    return map;
  }, [tree]);

  // Refs so the (stable) drag callbacks always see the latest data without
  // recreating every row's gesture on each fetch.
  const visibleItemsRef = useRef(visibleItems);
  visibleItemsRef.current = visibleItems;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // ---------------------------------------------------------------------
  // Drag state (UI-thread shared values)
  // ---------------------------------------------------------------------
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useSharedValue(0);
  const showScrollTopSv = useSharedValue(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const dragActive = useSharedValue(false);
  /** Set only after the JS re-render (subtree tucked away) has synced the
   *  depth mirror below — projections before that would use stale rows. */
  const dragReady = useSharedValue(false);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragStartScroll = useSharedValue(0);
  const activeIndexSv = useSharedValue(0);
  const activeDepthSv = useSharedValue(0);
  const targetIndexSv = useSharedValue(0);
  const projectedDepthSv = useSharedValue(0);
  /** UI-thread mirror of visibleItems' depths (minimal projection input). */
  const depthsSv = useSharedValue<number[]>([]);
  const viewportHSv = useSharedValue(0);
  const indicatorY = useSharedValue(0);
  const indicatorLeft = useSharedValue(0);
  const liftScale = useSharedValue(1);
  const reduceMotionSv = useSharedValue(false);

  useEffect(() => {
    reduceMotionSv.value = reduceMotion;
  }, [reduceMotion, reduceMotionSv]);

  // Sync the UI-thread mirror once the tucked-subtree list has rendered.
  useEffect(() => {
    if (activeId === null) {
      dragReady.value = false;
      return;
    }
    const index = visibleItems.findIndex((item) => item.id === activeId);
    if (index === -1) return;
    depthsSv.value = visibleItems.map((item) => item.depth);
    activeIndexSv.value = index;
    activeDepthSv.value = visibleItems[index]?.depth ?? 0;
    targetIndexSv.value = index;
    projectedDepthSv.value = visibleItems[index]?.depth ?? 0;
    indicatorY.value = LIST_PAD + index * ROW_H - 1;
    indicatorLeft.value = 16 + (visibleItems[index]?.depth ?? 0) * INDENT_W;
    dragReady.value = true;
  }, [
    activeId,
    visibleItems,
    activeDepthSv,
    activeIndexSv,
    depthsSv,
    dragReady,
    indicatorLeft,
    indicatorY,
    projectedDepthSv,
    targetIndexSv,
  ]);

  /**
   * UI-thread mirror of the shared getProjection's clamp rules, driving the
   * drop indicator only. Runs on gesture updates and on autoscroll frames —
   * never calls back into JS except when the quantized slot/depth actually
   * changes (haptic ticks).
   */
  const updateProjection = useCallback(() => {
    "worklet";
    if (!dragActive.value || !dragReady.value) return;
    const depths = depthsSv.value;
    const count = depths.length;
    if (count === 0) return;

    const ai = activeIndexSv.value;
    const rawIndex = ai + Math.round((dragY.value + scrollOffset.value - dragStartScroll.value) / ROW_H);
    const idx = Math.max(0, Math.min(rawIndex, count - 1));

    // Mirror of the shared insertion-position model. `without` is the
    // visible list with the active row removed; withoutDepth(j) maps a
    // position in it back into `depths` (removing index ai shifts every
    // later row down one). `p` is the insertion position.
    const withoutCount = count - 1;
    const withoutDepth = (j: number) => {
      "worklet";
      return depths[j < ai ? j : j + 1] ?? 0;
    };

    // Floor at 0 before the hop scan, then hop down past any block
    // deeper than the requested depth — the smart outdent that lets a
    // middle child become a sibling of its parent (see getProjection).
    const requestedDepth = Math.max(0, activeDepthSv.value + Math.round(dragX.value / INDENT_W));
    let p = idx;
    while (p < withoutCount && withoutDepth(p) > requestedDepth) p++;

    const hasPrev = p - 1 >= 0;
    const hasNext = p < withoutCount;
    const maxDepth = hasPrev ? withoutDepth(p - 1) + 1 : 0;
    const minDepth = hasNext ? withoutDepth(p) : 0;
    let depth = requestedDepth;
    if (depth > maxDepth) depth = maxDepth;
    if (depth < minDepth) depth = minDepth;

    // The line sits under the row at `without` position p-1, mapped back
    // to its index among the rendered rows (the active row stays in the
    // list, lifted under the finger).
    const gapIndex = hasPrev ? (p - 1 < ai ? p - 1 : p) + 1 : 0;
    const y = LIST_PAD + gapIndex * ROW_H - 1;

    // targetIndexSv keeps the PRE-hop slot: it is what handleDrop feeds
    // back into the shared getProjection, which re-derives the hop
    // itself, and a finger crossing a row boundary is the right moment
    // for the slot haptic.
    if (idx !== targetIndexSv.value) {
      targetIndexSv.value = idx;
      runOnJS(hapticSlotTick)();
    }
    if (y !== indicatorY.value) {
      indicatorY.value = reduceMotionSv.value ? y : withTiming(y, { duration: INDICATOR_TIMING_MS });
    }
    if (depth !== projectedDepthSv.value) {
      projectedDepthSv.value = depth;
      const left = 16 + depth * INDENT_W;
      indicatorLeft.value = reduceMotionSv.value ? left : withTiming(left, { duration: INDICATOR_TIMING_MS });
      runOnJS(hapticDepthTick)();
    }
  }, [
    activeDepthSv,
    activeIndexSv,
    depthsSv,
    dragActive,
    dragReady,
    dragStartScroll,
    dragX,
    dragY,
    indicatorLeft,
    indicatorY,
    projectedDepthSv,
    reduceMotionSv,
    scrollOffset,
    targetIndexSv,
  ]);

  // Every field here (SharedValues, updateProjection) is already stable
  // across renders, but the object literal wrapping them at each NoteRow call
  // site below was not — a fresh `drag={{ ... }}` every render defeats
  // NoteRow's memo() just like a fresh inline callback would. Memoized once
  // so the whole tree of rows keeps one stable `drag` reference.
  const dragController = useMemo(
    () => ({
      dragActive,
      dragReady,
      dragX,
      dragY,
      dragStartScroll,
      scrollOffset,
      activeIndexSv,
      activeDepthSv,
      targetIndexSv,
      liftScale,
      reduceMotionSv,
      updateProjection,
    }),
    [
      activeDepthSv,
      activeIndexSv,
      dragActive,
      dragReady,
      dragStartScroll,
      dragX,
      dragY,
      liftScale,
      reduceMotionSv,
      scrollOffset,
      targetIndexSv,
      updateProjection,
    ],
  );

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.y;
    // Autoscroll moves the list under a stationary finger — recompute the
    // slot from the new offset even though the gesture emitted no update.
    updateProjection();
    // Threshold-crossing only (not every frame): a deep, fully-expanded tree
    // runs to hundreds of rows, and scrolling back up by hand is the exact
    // "faster option to go up" gap reported — this drives a real JS-state
    // conditional render (not just an animated opacity) so the button is
    // genuinely absent, not just invisible-but-still-tappable, while hidden.
    const past = event.contentOffset.y > ROW_H * 2;
    if (past !== showScrollTopSv.value) {
      showScrollTopSv.value = past;
      runOnJS(setShowScrollTop)(past);
    }
  });

  // Proximity-ramped autoscroll while the lifted row sits near an edge.
  useFrameCallback((frame) => {
    if (!dragActive.value || !dragReady.value) return;
    const viewportH = viewportHSv.value;
    if (viewportH <= 0) return;

    // The lifted row's on-screen center: content position minus scroll — the
    // scroll terms cancel, so this only moves when the finger does.
    const screenY = LIST_PAD + activeIndexSv.value * ROW_H + dragY.value - dragStartScroll.value + ROW_H / 2;

    let direction = 0;
    let proximity = 0;
    if (screenY < AUTOSCROLL_EDGE) {
      direction = -1;
      proximity = Math.min(1, (AUTOSCROLL_EDGE - screenY) / AUTOSCROLL_EDGE);
    } else if (screenY > viewportH - AUTOSCROLL_EDGE) {
      direction = 1;
      proximity = Math.min(1, (screenY - (viewportH - AUTOSCROLL_EDGE)) / AUTOSCROLL_EDGE);
    }
    if (direction === 0) return;

    const dtSeconds = (frame.timeSincePreviousFrame ?? 16) / 1000;
    const maxOffset = Math.max(0, LIST_PAD * 2 + depthsSv.value.length * ROW_H - viewportH);
    const next = Math.max(
      0,
      Math.min(scrollOffset.value + direction * proximity * AUTOSCROLL_MAX_SPEED * dtSeconds, maxOffset),
    );
    if (next === scrollOffset.value) return;
    scrollTo(scrollRef, 0, next, false);
    scrollOffset.value = next;
    updateProjection();
  });

  // ---------------------------------------------------------------------
  // Mutations (all snapshot-rollback, tasks.tsx pattern)
  // ---------------------------------------------------------------------

  const restoreSnapshot = useCallback((previous: Note[] | undefined) => {
    queryClient.setQueryData<Note[]>(listKey, previous);
  }, []);

  const announce = useCallback((message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  /**
   * Apply a reorder payload: optimistic parentId/order rewrite on the list
   * cache, live PUT /notes/reorder, invalidate on success, snapshot rollback
   * on failure. Shared by drag-drop, the a11y move actions, and the
   * delete-time child reparenting.
   *
   * On a network-looking failure the payload queues to the offline outbox
   * ("note-reorder") instead of rolling back — the moved/reparented rows
   * keep the optimistic parentId/order they were just given (tagged
   * `pendingSync: true`, same contract as every other queued edit in this
   * app) rather than snapping back to their pre-drag position only to move
   * again once the outbox drains.
   */
  const applyReorder = useCallback(
    async (
      payload: NoteReorderItem[],
      options: { movedId?: string; expandParentId?: string | null; announceMessage?: string } = {},
    ): Promise<boolean> => {
      const previous = queryClient.getQueryData<Note[]>(listKey);
      const patchById = new Map(payload.map((item) => [item.noteId, item]));
      queryClient.setQueryData<Note[]>(listKey, (existing) =>
        (existing ?? []).map((note) => {
          const patch = patchById.get(note.id);
          return patch ? { ...note, parentId: patch.parentId, order: patch.order } : note;
        }),
      );
      if (options.expandParentId) expand(options.expandParentId);

      try {
        await apiClient.notes.reorder(payload);
        void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.all });
        hapticCompletion();
        if (options.movedId) {
          analytics.track({ name: "noteMoved", payload: { noteId: options.movedId } });
        }
        if (options.announceMessage) announce(options.announceMessage);
        return true;
      } catch (err) {
        const queued = await queueOfflineEdit("note-reorder", payload, err);
        if (queued) {
          queryClient.setQueryData<Note[]>(listKey, (existing) =>
            (existing ?? []).map((note) => (patchById.has(note.id) ? { ...note, pendingSync: true } : note)),
          );
          if (options.announceMessage) announce(`${options.announceMessage} — queued, will sync when online`);
          notify("Queued — will sync when online", "offline");
          return true;
        }
        restoreSnapshot(previous);
        offlineAwareNotify(err, "Couldn't move page. Please try again.");
        return false;
      }
    },
    [analytics, announce, expand, restoreSnapshot],
  );

  const startDrag = useCallback((noteId: string) => {
    hapticDragStart();
    setActiveId(noteId);
  }, []);

  const endDrag = useCallback(() => {
    setActiveId(null);
  }, []);

  /**
   * Drop: called once, on the JS thread, with the final slot/offset read
   * from the shared values. This is where the real shared projection math
   * runs — getProjection for the canonical depth/parent, then
   * buildReorderPayload for the PUT body (null = no-op drop).
   */
  const handleDrop = useCallback(
    (noteId: string, targetIndex: number, dragOffsetX: number) => {
      const items = visibleItemsRef.current;
      const allNotes = notesRef.current ?? [];
      const clamped = Math.max(0, Math.min(targetIndex, items.length - 1));
      const over = items[clamped];
      const active = items.find((item) => item.id === noteId);

      if (over && active) {
        const projected = getProjection(items, noteId, over.id, dragOffsetX, INDENT_W);
        const payload = buildReorderPayload(allNotes, noteId, projected);
        if (payload) {
          const parentTitle = projected.parentId ? nodeMap.get(projected.parentId)?.title : null;
          void applyReorder(payload, {
            movedId: noteId,
            expandParentId: projected.parentId,
            announceMessage: parentTitle
              ? `Moved "${active.title}" under "${parentTitle}"`
              : `Moved "${active.title}" to the top level`,
          });
        }
      }
      endDrag();
    },
    [applyReorder, endDrag, nodeMap],
  );

  // Stable trampolines so per-row gestures don't recreate on every data
  // change (runOnJS targets must not be stale closures).
  const handleDropRef = useRef(handleDrop);
  handleDropRef.current = handleDrop;
  const stableHandleDrop = useCallback((noteId: string, targetIndex: number, dragOffsetX: number) => {
    handleDropRef.current(noteId, targetIndex, dragOffsetX);
  }, []);

  /**
   * Create carries a client-generated id (`CreateNoteDto.id`) in both the
   * live and queued path, so the optimistic row placed in the cache below
   * and the eventual server row are the SAME id — see the header note on
   * "note-create" in src/lib/offline.ts for why that matters (a queued
   * create can be followed by queued note-update entries against that same
   * id, from typing into the brand-new page while still offline).
   *
   * On a network-looking failure the create queues instead of failing
   * outright: the optimistic row stays in the list (tagged `pendingSync:
   * true`) and, since "New page" always navigates straight into the editor,
   * the detail cache is seeded too so opening that editor while still
   * offline renders the local row instead of an avoidable load error.
   */
  const createNote = useCallback(
    async (parentId: string | null, options?: { voice?: boolean }) => {
      if (isCreating) return;
      // The tree screen has no text surface of its own, so its microphone can
      // only mean "make me a page and start talking". Rather than a second
      // dictation implementation living here, it creates the page exactly as
      // "New page" does and hands off to the editor's own dictation via the
      // `?voice=1` deep link — one implementation, two entry points, the same
      // shape journal.tsx uses for `/journal?voice=1`.
      const voiceSuffix = options?.voice ? "?voice=1" : "";
      setIsCreating(true);
      const optimisticId = genId();
      const payload: CreateNoteDto = { id: optimisticId, title: "Untitled page", content: "", parentId };
      const siblingCount = (notesRef.current ?? []).filter((n) => (n.parentId ?? null) === parentId).length;
      const optimisticNote: Note = {
        id: optimisticId,
        title: payload.title,
        content: payload.content ?? "",
        icon: null,
        color: null,
        parentId,
        order: (siblingCount + 1) * 1000,
        isExpanded: true,
        isFavorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: user?.id ?? "",
      };
      queryClient.setQueryData<Note[]>(listKey, (existing) => [...(existing ?? []), optimisticNote]);
      if (parentId) expand(parentId);

      try {
        // Reuses `optimisticId` (already unique per create attempt, and
        // already the row's own id) as the idempotency key rather than
        // minting a second value — same reasoning as "goal-create"/
        // "task-create" (see lib/offline.ts's "note-create" operation): held
        // constant across this live attempt and any outbox replay of it.
        const response = await apiClient.notes.create(payload, { idempotencyKey: optimisticId });
        const created = response.data;
        queryClient.setQueryData<Note[]>(listKey, (existing) =>
          (existing ?? []).map((n) => (n.id === optimisticId ? created : n)),
        );
        // Same reasoning as the queued branch below: "New page" always
        // navigates straight into the editor, and note/[id].tsx's `useQuery`
        // has nothing else to show while its own GET is in flight. Without
        // this the freshly created row lived ONLY in the list cache, so
        // landing on the editor immediately after a successful create still
        // meant an unseeded detail query — a blank "Opening page..." spinner
        // at best, or (if that immediate follow-up GET hit any hiccup —
        // timeout, a slow/flaky connection, anything) the same "Couldn't
        // load this page" ErrorState a genuine failure would show, even
        // though the create itself had already succeeded. Seeding with the
        // real server row (not a placeholder) means the editor has
        // everything it needs the instant it mounts, same as the queued
        // path already gets via its pendingNote seed.
        queryClient.setQueryData<NoteDetailResponse>(noteQueries.noteQueries.detail(created.id), {
          note: created,
          readOnly: false,
        });
        void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.all });
        analytics.track({ name: "noteCreated", payload: { noteId: created.id, parentId } });
        router.push(`/note/${created.id}${voiceSuffix}`);
      } catch (err) {
        const queued = await queueOfflineEdit("note-create", payload, err, optimisticId);
        if (queued) {
          const pendingNote: Note = { ...optimisticNote, pendingSync: true };
          queryClient.setQueryData<Note[]>(listKey, (existing) =>
            (existing ?? []).map((n) => (n.id === optimisticId ? pendingNote : n)),
          );
          queryClient.setQueryData<NoteDetailResponse>(noteQueries.noteQueries.detail(optimisticId), {
            note: pendingNote,
            readOnly: false,
          });
          notify("Queued — will sync when online", "offline");
          router.push(`/note/${optimisticId}${voiceSuffix}`);
        } else {
          queryClient.setQueryData<Note[]>(listKey, (existing) => (existing ?? []).filter((n) => n.id !== optimisticId));
          offlineAwareNotify(err, "Couldn't create page. Please try again.");
        }
      } finally {
        setIsCreating(false);
      }
    },
    [analytics, expand, isCreating, user],
  );

  /**
   * Delete: reparent-then-delete, same as before, but a network-looking
   * failure at either live call now queues rather than rolling back. Two
   * outbox entries can be needed (reparent, then delete) — `reorderDone`
   * tracks whether the reparent PUT already succeeded live before the delete
   * itself hit a network error, so that step is never re-queued (and so
   * never double-applied) on top of one that already landed. Queued deletes
   * get no `pendingSync` tag — the row is already gone from the list, and
   * there is no "pending" version of gone to show (mirrors
   * schedule.tsx's handleDeleteBlock).
   */
  const deleteNote = useCallback(
    async (note: FlatNote) => {
      const children = nodeMap.get(note.id)?.children ?? [];
      const previous = queryClient.getQueryData<Note[]>(listKey);

      // The server cascades the delete to descendants, so surviving children
      // must be reparented to the deleted note's parent FIRST (same order the
      // web does it): grandparent's children keep their sequence, the
      // orphans append after them, everything renumbered on the *1000 scale.
      let reparent: NoteReorderItem[] | null = null;
      if (children.length > 0) {
        const targetParentId = note.parentId ?? null;
        const keptSiblings = (notesRef.current ?? [])
          .filter((n) => (n.parentId ?? null) === targetParentId && n.id !== note.id)
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        reparent = [...keptSiblings, ...children].map((n, i) => ({
          noteId: n.id,
          parentId: targetParentId,
          order: (i + 1) * 1000,
        }));
      }

      // Optimistic: reparent children and drop the note in one cache write.
      const patchById = new Map((reparent ?? []).map((item) => [item.noteId, item]));
      queryClient.setQueryData<Note[]>(listKey, (existing) =>
        (existing ?? [])
          .filter((n) => n.id !== note.id)
          .map((n) => {
            const patch = patchById.get(n.id);
            return patch ? { ...n, parentId: patch.parentId, order: patch.order } : n;
          }),
      );

      let reorderDone = !reparent;
      try {
        if (reparent) {
          await apiClient.notes.reorder(reparent);
          reorderDone = true;
        }
        await apiClient.notes.delete(note.id);
        void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.all });
        analytics.track({ name: "noteDeleted", payload: { noteId: note.id } });
        announce(`Deleted "${note.title}"`);
      } catch (err) {
        if (reparent && !reorderDone) {
          const reorderQueued = await queueOfflineEdit("note-reorder", reparent, err);
          if (!reorderQueued) {
            restoreSnapshot(previous);
            offlineAwareNotify(err, "Couldn't delete page. Please try again.");
            return;
          }
          // The reparented survivors carry an un-synced parentId/order —
          // tag them the same way applyReorder's queued branch does, so
          // they don't read as confirmed until the outbox actually drains.
          queryClient.setQueryData<Note[]>(listKey, (existing) =>
            (existing ?? []).map((n) => (patchById.has(n.id) ? { ...n, pendingSync: true } : n)),
          );
        }
        const deleteQueued = await queueOfflineEdit("note-delete", { id: note.id }, err);
        if (deleteQueued) {
          announce(`Deleted "${note.title}" — will sync when online`);
          notify("Queued — will sync when online", "offline");
        } else {
          restoreSnapshot(previous);
          offlineAwareNotify(err, "Couldn't delete page. Please try again.");
        }
      }
    },
    [analytics, announce, nodeMap, restoreSnapshot],
  );

  const [pendingDelete, setPendingDelete] = useState<FlatNote | null>(null);

  // Same close-then-fire shape as the old Alert.alert: tapping "Delete"
  // dismissed the native alert immediately and let deleteNote run (and
  // optimistically remove the row) in the background — deleteNote's own
  // catch already reports a failure via `offlineAwareNotify`, so this dialog
  // has nothing left to stay open for.
  const confirmDeleteNote = useCallback(() => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    void deleteNote(target);
  }, [deleteNote, pendingDelete]);

  const toggleFavorite = useCallback(
    async (note: FlatNote) => {
      const nextValue = !note.isFavorite;
      const previous = queryClient.getQueryData<Note[]>(listKey);
      queryClient.setQueryData<Note[]>(listKey, (existing) =>
        (existing ?? []).map((n) => (n.id === note.id ? { ...n, isFavorite: nextValue } : n)),
      );
      try {
        await apiClient.notes.update(note.id, { isFavorite: nextValue });
        void queryClient.invalidateQueries({ queryKey: noteQueries.noteQueries.all });
        hapticLight();
      } catch (err) {
        // Its own "note-favorite" kind rather than reusing "note-update" —
        // mechanically the same PUT, but a queued favorite toggle should
        // read unambiguously in the outbox rather than looking like an
        // unrelated title/content edit queued in the same offline session
        // (same reasoning as "goal-complete" vs "goal-update" in offline.ts).
        const queued = await queueOfflineEdit("note-favorite", { id: note.id, isFavorite: nextValue }, err);
        if (queued) {
          queryClient.setQueryData<Note[]>(listKey, (existing) =>
            (existing ?? []).map((n) => (n.id === note.id ? { ...n, isFavorite: nextValue, pendingSync: true } : n)),
          );
          notify("Queued — will sync when online", "offline");
          return;
        }
        restoreSnapshot(previous);
        offlineAwareNotify(err, "Couldn't update favorite. Please try again.");
      }
    },
    [restoreSnapshot],
  );

  const openNote = useCallback((noteId: string) => {
    router.push(`/note/${noteId}`);
  }, []);

  // Hoisted rather than inlined at the NoteRow call site below: NoteRow is
  // memo()'d (see its own note), and a fresh `(note) => void x(note)` closure
  // built on every NotesScreen render would hand every row a new prop
  // reference each time, defeating that memoization the same way an inline
  // object literal would.
  const handleNewSubpage = useCallback((note: FlatNote) => void createNote(note.id), [createNote]);
  const handleToggleFavorite = useCallback((note: FlatNote) => void toggleFavorite(note), [toggleFavorite]);

  const toggleCollapse = useCallback(
    (note: FlatNote) => {
      hapticLight();
      const collapsing = !collapsedSet.has(note.id);
      toggleCollapsed(note.id);
      announce(collapsing ? `Collapsed "${note.title}"` : `Expanded "${note.title}"`);
    },
    [announce, collapsedSet, toggleCollapsed],
  );

  // ---------------------------------------------------------------------
  // Accessibility move actions — same payload shapes as drag-drop, driven
  // by sibling lists instead of pointer geometry.
  // ---------------------------------------------------------------------

  const siblingsOf = useCallback((parentId: string | null, excludeId?: string): Note[] => {
    return (notesRef.current ?? [])
      .filter((n) => (n.parentId ?? null) === parentId && n.id !== excludeId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, []);

  const renumber = useCallback(
    (ordered: Note[], parentId: string | null): NoteReorderItem[] =>
      ordered.map((n, i) => ({ noteId: n.id, parentId, order: (i + 1) * 1000 })),
    [],
  );

  const moveWithinSiblings = useCallback(
    (note: FlatNote, delta: -1 | 1) => {
      const parentId = note.parentId ?? null;
      const siblings = siblingsOf(parentId);
      const index = siblings.findIndex((n) => n.id === note.id);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= siblings.length) {
        announce(delta === -1 ? "Already the first page at this level" : "Already the last page at this level");
        return;
      }
      const next = [...siblings];
      next.splice(index, 1);
      next.splice(target, 0, siblings[index] as Note);
      void applyReorder(renumber(next, parentId), {
        movedId: note.id,
        announceMessage: `Moved "${note.title}" ${delta === -1 ? "up" : "down"}, page ${target + 1} of ${siblings.length}`,
      });
    },
    [announce, applyReorder, renumber, siblingsOf],
  );

  const indentNote = useCallback(
    (note: FlatNote) => {
      const parentId = note.parentId ?? null;
      const siblings = siblingsOf(parentId);
      const index = siblings.findIndex((n) => n.id === note.id);
      const newParent = index > 0 ? siblings[index - 1] : undefined;
      if (!newParent) {
        announce("No page above to become a subpage of");
        return;
      }
      const newSiblings = [...siblingsOf(newParent.id, note.id), note];
      void applyReorder(renumber(newSiblings, newParent.id), {
        movedId: note.id,
        expandParentId: newParent.id,
        announceMessage: `Made "${note.title}" a subpage of "${newParent.title}"`,
      });
    },
    [announce, applyReorder, renumber, siblingsOf],
  );

  const outdentNote = useCallback(
    (note: FlatNote) => {
      if (!note.parentId) {
        announce("Already a top-level page");
        return;
      }
      const parent = nodeMap.get(note.parentId);
      const grandparentId = parent?.parentId ?? null;
      const targetSiblings = siblingsOf(grandparentId, note.id);
      const parentIndex = targetSiblings.findIndex((n) => n.id === note.parentId);
      const next = [...targetSiblings];
      next.splice(parentIndex === -1 ? next.length : parentIndex + 1, 0, note);
      void applyReorder(renumber(next, grandparentId), {
        movedId: note.id,
        announceMessage: `Promoted "${note.title}" up a level`,
      });
    },
    [announce, applyReorder, nodeMap, renumber, siblingsOf],
  );

  const handleAccessibilityAction = useCallback(
    (note: FlatNote, event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case "moveUp":
          moveWithinSiblings(note, -1);
          break;
        case "moveDown":
          moveWithinSiblings(note, 1);
          break;
        case "indent":
          indentNote(note);
          break;
        case "outdent":
          outdentNote(note);
          break;
        case "expand":
        case "collapse":
          toggleCollapse(note);
          break;
        default:
          break;
      }
    },
    [indentNote, moveWithinSiblings, outdentNote, toggleCollapse],
  );

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: dragActive.value && dragReady.value ? 1 : 0,
    transform: [{ translateY: indicatorY.value }],
    left: indicatorLeft.value,
  }));

  const scrollToTop = useCallback(() => {
    scrollTo(scrollRef, 0, 0, true);
  }, [scrollRef]);

  const dragInProgress = activeId !== null;
  const contentMinHeight = LIST_PAD * 2 + visibleItems.length * ROW_H;

  let body: React.ReactNode;
  if (isPending) {
    body = (
      <View>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, index) => (
          <SkeletonListItem key={index} showLeading={false} />
        ))}
      </View>
    );
  } else if (isError && !notes) {
    body = (
      <QueryErrorState
        error={error}
        message="Couldn't load your notes."
        offlineMessage="Reconnect to load your notes."
        onRetry={() => void refetch()}
      />
    );
  } else if (visibleItems.length === 0) {
    body = (
      <ListEmptyState
        variant="notes"
        title="No pages yet"
        description="Notes are a OneNote-style tree — every page can hold subpages, as deep as you like."
        actionLabel="New page"
        onAction={() => void createNote(null)}
        hint="Long-press a page to drag it; drag right to nest it under the page above."
      />
    );
  } else {
    body = (
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        scrollEnabled={!dragInProgress}
        onLayout={(event) => {
          viewportHSv.value = event.nativeEvent.layout.height;
        }}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isPending} onRefresh={() => void refetch()} />
        }
        contentContainerStyle={[styles.listContent, { minHeight: contentMinHeight }]}
      >
        {visibleItems.map((item, index) => (
          <NoteRow
            key={item.id}
            item={item}
            index={index}
            isActive={item.id === activeId}
            dragInProgress={dragInProgress}
            collapsed={collapsedSet.has(item.id)}
            siblingInfo={siblingInfo.get(item.id)}
            drag={dragController}
            onStartDrag={startDrag}
            onDrop={stableHandleDrop}
            onCancelDrag={endDrag}
            onPress={openNote}
            onToggleCollapse={toggleCollapse}
            onDelete={setPendingDelete}
            onNewSubpage={handleNewSubpage}
            onToggleFavorite={handleToggleFavorite}
            onAccessibilityAction={handleAccessibilityAction}
          />
        ))}
        <Animated.View pointerEvents="none" style={[styles.dropIndicator, indicatorStyle]}>
          <View style={styles.dropIndicatorDot} />
          <View style={styles.dropIndicatorLine} />
        </Animated.View>
      </Animated.ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScreenHeader
        eyebrow="Write"
        title="Notes"
        subtitle="Pages and subpages, nested however you think."
        action={
          <View style={styles.headerActions}>
            {/* "New page, and start talking." Secondary treatment (outlined,
                icon-only) next to the primary "New page" — it is the same
                action with dictation switched on, not a competing one. The
                dictation itself lives entirely in the editor this navigates
                to; there is deliberately no second implementation here. */}
            <Pressable
              style={({ pressed }) => [
                styles.voiceNewButton,
                isCreating && styles.newButtonDisabled,
                pressed && styles.voiceNewButtonPressed,
              ]}
              onPress={() => void createNote(null, { voice: true })}
              disabled={isCreating}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New page by voice"
              accessibilityHint="Creates a page and starts dictating into it"
              accessibilityState={{ disabled: isCreating, busy: isCreating }}
            >
              <Icon name="mic" size={16} color={colors.primaryText} />
            </Pressable>
            <Pressable
              style={[styles.newButton, isCreating && styles.newButtonDisabled]}
              onPress={() => void createNote(null)}
              disabled={isCreating}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New page"
              accessibilityState={{ disabled: isCreating, busy: isCreating }}
            >
              {/* Creating a page is a network round-trip before navigation —
                  without this the button just dimmed with no other feedback,
                  so a real (non-local) connection reads as an unresponsive tap
                  for however long the request takes. */}
              {isCreating ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Icon name="add" size={16} color={colors.primaryForeground} />
              )}
              <Text style={styles.newButtonText}>{isCreating ? "Creating…" : "New page"}</Text>
            </Pressable>
          </View>
        }
      />
      <View style={styles.listArea}>
        {body}
        {showScrollTop ? (
          <Pressable
            style={styles.scrollToTopButton}
            onPress={scrollToTop}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Scroll to top of notes"
          >
            <Icon name="chevron-up" size={20} color={colors.primaryForeground} />
          </Pressable>
        ) : null}
      </View>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete page?"
        description={pendingDelete ? deleteNoteDescription(pendingDelete) : undefined}
        icon="trash"
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDeleteNote}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

/** Same copy the old Alert.alert built — a note's subpages move up a level rather than being deleted with it. */
function deleteNoteDescription(note: FlatNote): string {
  const subpageNote =
    note.descendantCount > 0
      ? ` Its ${note.descendantCount === 1 ? "subpage" : `${note.descendantCount} subpages`} will move up a level.`
      : "";
  return `"${note.title}" will be permanently removed.${subpageNote}`;
}

// -----------------------------------------------------------------------
// Row
// -----------------------------------------------------------------------

interface DragController {
  dragActive: SharedValue<boolean>;
  dragReady: SharedValue<boolean>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  dragStartScroll: SharedValue<number>;
  scrollOffset: SharedValue<number>;
  activeIndexSv: SharedValue<number>;
  activeDepthSv: SharedValue<number>;
  targetIndexSv: SharedValue<number>;
  liftScale: SharedValue<number>;
  reduceMotionSv: SharedValue<boolean>;
  updateProjection: () => void;
}

interface NoteRowProps {
  item: FlatNote;
  index: number;
  isActive: boolean;
  dragInProgress: boolean;
  collapsed: boolean;
  siblingInfo: { position: number; count: number } | undefined;
  drag: DragController;
  onStartDrag: (noteId: string) => void;
  onDrop: (noteId: string, targetIndex: number, dragOffsetX: number) => void;
  onCancelDrag: () => void;
  onPress: (noteId: string) => void;
  onToggleCollapse: (note: FlatNote) => void;
  onDelete: (note: FlatNote) => void;
  onNewSubpage: (note: FlatNote) => void;
  onToggleFavorite: (note: FlatNote) => void;
  onAccessibilityAction: (note: FlatNote, event: AccessibilityActionEvent) => void;
}

const LIFT_SCALE = 1.03;

// memo()'d because the tree above renders every row with a plain `.map` —
// unlike the FlashList/FlatList screens elsewhere in this app, there is no
// virtualization here (deliberate, see the file header: fixed-height rows
// support drag reordering that recycling would fight), so EVERY row mounts
// at once. Without memo, any unrelated NotesScreen re-render (a toast, a
// sync tick, an unconnected state update) walks and re-renders the entire
// tree instead of just the row that actually changed.
const NoteRow = memo(function NoteRow({
  item,
  index,
  isActive,
  dragInProgress,
  collapsed,
  siblingInfo,
  drag,
  onStartDrag,
  onDrop,
  onCancelDrag,
  onPress,
  onToggleCollapse,
  onDelete,
  onNewSubpage,
  onToggleFavorite,
  onAccessibilityAction,
}: NoteRowProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);

  const {
    dragActive,
    dragReady,
    dragX,
    dragY,
    dragStartScroll,
    scrollOffset,
    activeIndexSv,
    activeDepthSv,
    targetIndexSv,
    liftScale,
    reduceMotionSv,
    updateProjection,
  } = drag;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(DRAG_ACTIVATE_MS)
        .shouldCancelWhenOutside(false)
        .onStart(() => {
          dragActive.value = true;
          dragReady.value = false; // JS effect flips it after the tuck re-render
          dragX.value = 0;
          dragY.value = 0;
          dragStartScroll.value = scrollOffset.value;
          activeIndexSv.value = index;
          activeDepthSv.value = item.depth;
          targetIndexSv.value = index;
          liftScale.value = reduceMotionSv.value
            ? LIFT_SCALE
            : withTiming(LIFT_SCALE, { duration: INDICATOR_TIMING_MS });
          runOnJS(onStartDrag)(item.id);
        })
        .onUpdate((event) => {
          dragX.value = event.translationX;
          dragY.value = event.translationY;
          updateProjection();
        })
        .onEnd(() => {
          runOnJS(onDrop)(item.id, targetIndexSv.value, dragX.value);
        })
        .onFinalize((_event, success) => {
          dragActive.value = false;
          dragReady.value = false;
          liftScale.value = reduceMotionSv.value ? 1 : withTiming(1, { duration: INDICATOR_TIMING_MS });
          if (!success) runOnJS(onCancelDrag)();
        }),
    [
      activeDepthSv,
      activeIndexSv,
      dragActive,
      dragReady,
      dragStartScroll,
      dragX,
      dragY,
      index,
      item.depth,
      item.id,
      liftScale,
      onCancelDrag,
      onDrop,
      onStartDrag,
      reduceMotionSv,
      scrollOffset,
      targetIndexSv,
      updateProjection,
    ],
  );

  // Lift transform — only ever non-identity on the active row. The vertical
  // term adds the autoscroll delta so the row stays under the finger while
  // the list moves beneath it.
  const liftedStyle = useAnimatedStyle(() => {
    if (!isActive) {
      return { transform: [{ translateY: 0 }, { translateX: 0 }, { scale: 1 }] };
    }
    return {
      transform: [
        { translateY: dragY.value + (scrollOffset.value - dragStartScroll.value) },
        { translateX: dragX.value },
        { scale: liftScale.value },
      ],
    };
  }, [isActive]);

  const chevronStyle = useAnimatedStyle(() => {
    const target = collapsed ? "0deg" : "90deg";
    return {
      transform: [
        { rotate: reduceMotionSv.value ? target : withTiming(target, { duration: 150 }) },
      ],
    };
  }, [collapsed]);

  const accessibilityActions = useMemo<AccessibilityActionInfo[]>(() => {
    const actions: AccessibilityActionInfo[] = [
      { name: "moveUp", label: "Move up" },
      { name: "moveDown", label: "Move down" },
      { name: "indent", label: "Make subpage of previous page" },
      { name: "outdent", label: "Promote page" },
    ];
    if (item.childCount > 0) {
      actions.push(
        collapsed
          ? { name: "expand", label: "Expand subpages" }
          : { name: "collapse", label: "Collapse subpages" },
      );
    }
    return actions;
  }, [collapsed, item.childCount]);

  // Favourite is a coloured dot now rather than a "★" baked into the title
  // string, so it has to be announced here or it becomes invisible to
  // screen readers.
  const accessibilityLabel = `"${item.title}", level ${item.depth + 1}, page ${siblingInfo?.position ?? 1} of ${siblingInfo?.count ?? 1}${item.isFavorite ? ", favorite" : ""}`;

  const renderLeftActions = useCallback(
    () => (
      <Pressable
        style={[styles.swipeAction, styles.deleteAction]}
        onPress={() => {
          // onDelete must fire regardless of what `.close()` does — it
          // opens the confirmation dialog, so a throw from `.close()`
          // (seen on Android when the swipeable is still mid-animation)
          // must never be able to swallow it silently. Ordered first, and
          // `.close()` itself guarded, rather than trusting two statements
          // in a row to both always run.
          onDelete(item);
          try {
            swipeableRef.current?.close();
          } catch {
            // Cosmetic only — the row stays visually open, but the
            // confirmation dialog above already has what it needs.
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`Delete "${item.title}"`}
      >
        <Icon name="trash" size={18} color={colors.destructiveForeground} />
        <Text style={styles.swipeActionText}>Delete</Text>
      </Pressable>
    ),
    [item, onDelete],
  );

  const renderRightActions = useCallback(
    () => (
      <View style={styles.swipeActionsRow}>
        <Pressable
          style={[styles.swipeAction, styles.subpageAction]}
          onPress={() => {
            swipeableRef.current?.close();
            onNewSubpage(item);
          }}
          accessibilityRole="button"
          accessibilityLabel={`New subpage inside "${item.title}"`}
        >
          <Icon name="add" size={18} color={colors.white} />
          <Text style={styles.swipeActionText}>Subpage</Text>
        </Pressable>
        <Pressable
          style={[styles.swipeAction, styles.favoriteAction]}
          onPress={() => {
            swipeableRef.current?.close();
            onToggleFavorite(item);
          }}
          accessibilityRole="button"
          accessibilityLabel={
            item.isFavorite ? `Remove "${item.title}" from favorites` : `Add "${item.title}" to favorites`
          }
        >
          <Icon name={item.isFavorite ? "close" : "check"} size={18} color={colors.primaryForeground} />
          <Text style={styles.swipeActionFavoriteText}>{item.isFavorite ? "Unpin" : "Pin"}</Text>
        </Pressable>
      </View>
    ),
    [item, onNewSubpage, onToggleFavorite],
  );

  return (
    <View style={isActive ? styles.rowLifted : undefined}>
      <Swipeable
        ref={swipeableRef}
        enabled={!dragInProgress}
        renderLeftActions={renderLeftActions}
        renderRightActions={renderRightActions}
        overshootLeft={false}
        overshootRight={false}
        leftThreshold={40}
        rightThreshold={40}
        // Swipeable's own internal pan (ReanimatedSwipeable.tsx) activates
        // after just `dragOffsetFromLeftEdge`/`dragOffsetFromRightEdge`
        // (10px, default, unconfigured here) of horizontal movement, with no
        // long-press requirement. It wraps `pan` below as an ANCESTOR view,
        // and with no relation declared between two independent gesture
        // recognizers, arbitration goes to whichever activates first — which
        // is always Swipeable's 10px threshold, long before `pan`'s
        // `activateAfterLongPress(300)` timer can ever fire, since any real
        // long-press hold has more than 10px of finger jitter well inside
        // that window. That's why drag-to-reorder never engaged: Swipeable
        // was winning every touch before the long press even had a chance.
        // `requireExternalGestureToFail` makes Swipeable's pan wait for
        // `pan` to settle first: a genuine swipe still feels instant (`pan`
        // fails within a few px once movement exceeds its own long-press
        // cancel distance — see PanGestureHandler's `shouldFail`), but a
        // still, held touch now lets `pan` claim the gesture and activate at
        // 300ms instead of losing it to the swipe recognizer.
        requireExternalGestureToFail={pan}
      >
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.rowSurface, isActive && styles.rowSurfaceActive, liftedStyle]}>
            <Pressable
              style={[styles.row, { paddingLeft: 16 + item.depth * INDENT_W }]}
              onPress={() => onPress(item.id)}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityHint="Opens the page. Long press then drag to move it."
              accessibilityActions={accessibilityActions}
              onAccessibilityAction={(event) => onAccessibilityAction(item, event)}
            >
              {/* Depth guides: one hairline per ancestor level, so a subpage
                  four deep still reads as "under that one". The web gets this
                  for free from the sidebar's narrow column; on a full-width
                  phone row, indentation alone stops being legible past depth
                  two. Absolutely positioned, so the fixed ROW_H the drag math
                  depends on is untouched. */}
              {Array.from({ length: item.depth }).map((_, level) => (
                <View
                  key={level}
                  pointerEvents="none"
                  style={[styles.depthGuide, { left: 16 + level * INDENT_W + CHEVRON_SIZE / 2 }]}
                />
              ))}

              {item.childCount > 0 ? (
                <Pressable
                  style={styles.chevronButton}
                  onPress={() => onToggleCollapse(item)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    collapsed ? `Expand subpages of "${item.title}"` : `Collapse subpages of "${item.title}"`
                  }
                >
                  <Animated.View style={chevronStyle}>
                    <Icon name="chevron" size={16} color={colors.mutedForeground} />
                  </Animated.View>
                </Pressable>
              ) : (
                <View style={styles.chevronSpacer} />
              )}

              {/* Page glyph: a parent shows the notebook mark, a leaf the page
                  mark — the OneNote distinction the web sidebar draws with its
                  own icon slot (notes-sidebar.tsx:191). */}
              <Icon
                name={item.childCount > 0 ? "journal" : "notes"}
                size={15}
                color={item.childCount > 0 ? colors.foreground : colors.mutedForeground}
              />

              {/* Favourite marker. The web uses a filled lucide <Star/>
                  (notes-sidebar.tsx:248); Icon.tsx has no `star` name and this
                  task may not add one, so it's a brand-yellow dot instead —
                  same "this one is pinned" read, no invented iconography.
                  The gap is flagged in the handover. */}
              {item.isFavorite ? (
                <View
                  style={styles.favoriteDot}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              ) : null}

              <Text style={[styles.rowTitle, item.depth === 0 && styles.rowTitleRoot]} numberOfLines={1}>
                {item.title || "Untitled page"}
              </Text>

              {isActive && item.descendantCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{item.descendantCount + 1}</Text>
                </View>
              ) : collapsed && item.childCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{item.childCount}</Text>
                </View>
              ) : null}

              {/* Visible "New subpage" affordance — the swipe-to-reveal
                  `renderRightActions` action below does the same
                  `onNewSubpage(item)` call, but a right-swipe has no on-row
                  hint, so users kept not finding it. This is an ADDITIONAL
                  entry point (same createNote(note.id) call, same
                  parentId), not a replacement — the swipe action stays. */}
              <Pressable
                style={styles.addSubpageButton}
                onPress={() => onNewSubpage(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Add a subpage under "${item.title || "Untitled page"}"`}
              >
                <Icon name="add" size={16} color={colors.mutedForeground} />
              </Pressable>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Swipeable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // The tree is one continuous white sheet, like the web's notes sidebar
    // panel — rows are separated by indentation and depth guides, not by
    // gaps, so a card-per-row treatment would fight the hierarchy.
    backgroundColor: colors.card,
  },
  // Two actions now share the header's single action slot, so the row (not
  // each button) is what hugs the right edge.
  headerActions: {
    flexDirection: "row",
    alignSelf: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
  },
  // Secondary to "New page": the brand-accented outlined treatment
  // (primaryMuted/primaryBorder/primaryText) foundation.ts documents, so it
  // reads as related to the primary action rather than competing with it.
  voiceNewButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget - spacing.md,
    minWidth: minTouchTarget - spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primaryMuted,
  },
  voiceNewButtonPressed: {
    opacity: 0.7,
  },
  newButton: {
    flexDirection: "row",
    // Hugs the right edge; ScreenHeader leaves that choice to the caller.
    alignSelf: "flex-end",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: minTouchTarget - spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  newButtonDisabled: {
    opacity: 0.5,
  },
  newButtonText: {
    ...typography.caption,
    // Dark ink on brand yellow, never white.
    color: colors.primaryForeground,
  },
  listArea: {
    flex: 1,
  },
  scrollToTopButton: {
    position: "absolute",
    // Neither screen edge is safe: every row's own "+" subpage button sits
    // right-aligned (paddingRight: spacing.lg — addSubpageButton below), and
    // every row's expand/collapse chevron sits left-aligned starting at the
    // SAME ~16px inset for a top-level (depth 0) row (see `paddingLeft: 16 +
    // item.depth * INDENT_W`). A corner-docked floating button at nearly
    // matching insets painted over — and stole taps from — whichever
    // control shared that corner, for whatever row scrolled into that band,
    // not just the last one. Centered horizontally clears both edge
    // controls at every depth actually used in this app's trees.
    alignSelf: "center",
    bottom: spacing.lg,
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    ...shadows.subtle,
  },
  listContent: {
    paddingTop: LIST_PAD,
    // Belt-and-suspenders alongside the left/right move above: still keep
    // the last row(s) clear of the button's footprint at the true end of
    // the list, in case a future row layout ever puts content on the left.
    paddingBottom: LIST_PAD + minTouchTarget + spacing.lg + spacing.sm,
  },
  rowLifted: {
    zIndex: 100,
  },
  rowSurface: {
    backgroundColor: colors.card,
  },
  rowSurfaceActive: {
    borderRadius: radii.lg,
    ...shadows.raised,
  },
  row: {
    height: ROW_H,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: spacing.lg,
    gap: spacing.sm,
  },
  depthGuide: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.border,
  },
  chevronButton: {
    width: CHEVRON_SIZE,
    height: CHEVRON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  chevronSpacer: {
    width: CHEVRON_SIZE,
  },
  favoriteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  rowTitle: {
    flex: 1,
    ...typography.body,
    fontWeight: "500",
    color: colors.foreground,
  },
  rowTitleRoot: {
    // Top-level pages carry more weight than their subpages — the one
    // typographic cue that survives at 48pt row height.
    fontWeight: "700",
  },
  countBadge: {
    minWidth: 22,
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 1,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  countBadgeText: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  // 28pt visual + 8pt hitSlop on every side = 44pt effective target, the
  // same minTouchTarget every other tappable control in this app clears —
  // see chevronButton (24pt + 8pt hitSlop) just above for the same idiom
  // at a slightly smaller visual size.
  addSubpageButton: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    alignItems: "center",
    justifyContent: "center",
  },
  dropIndicator: {
    position: "absolute",
    top: 0,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  },
  // Brand yellow with a dot terminal — the exact insertion-line treatment
  // the web uses (notes-sidebar.tsx:314-315: a ring-bordered dot and a line,
  // both in the literal brand yellow). It was blue here, matching nothing in
  // the product.
  dropIndicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  dropIndicatorLine: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  swipeActionsRow: {
    flexDirection: "row",
  },
  swipeAction: {
    width: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  deleteAction: {
    backgroundColor: colors.destructive,
  },
  subpageAction: {
    backgroundColor: colors.foreground,
  },
  favoriteAction: {
    backgroundColor: colors.primary,
  },
  swipeActionText: {
    ...typography.label,
    color: colors.white,
    textAlign: "center",
  },
  swipeActionFavoriteText: {
    ...typography.label,
    color: colors.primaryForeground,
    textAlign: "center",
  },
});
