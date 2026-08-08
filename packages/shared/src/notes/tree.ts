// Ported from dw-time-web/src/features/notes/utils/types.ts (buildNoteTree)
// and dw-time-web/src/features/notes/utils/tree-dnd.ts (flattenVisibleTree /
// getProjection / buildReorderPayload), minus everything DOM- or dnd-kit-
// bound: the keyboard coordinate getter and SensorContext stayed on web
// (they type against @dnd-kit sensors and React refs), and dnd-kit's
// `arrayMove` is reimplemented inline below rather than adding the
// dependency. The math is pointer-library-agnostic — any drag layer that
// can produce a hovered row id and a horizontal offset can drive it.
//
// The pattern: the tree renders as ONE flat sortable list; the vertical
// drag position picks the slot and the horizontal offset picks the depth.
// The active row's descendants are removed from the list for the duration
// of the drag, which makes "drop into your own subtree" impossible by
// construction (no cycle checks needed at drop time).

import type { Note, NoteReorderItem, NoteTreeItem } from '../types/note'

/** Horizontal pixels per depth level. Also the snap width for the indent
 *  gesture — Math.round(offset / width) — so it needs to be wide enough to
 *  beat pointer jitter but narrow enough that one comfortable wrist (or
 *  thumb) move changes a level. */
export const INDENTATION_WIDTH = 24

export interface FlatNote extends Note {
  depth: number
  /** Direct children in the FULL tree (drives the chevron), not just visible ones. */
  childCount: number
  /** Total descendants in the full tree (drag-overlay badge). */
  descendantCount: number
}

export interface NoteProjection {
  depth: number
  maxDepth: number
  minDepth: number
  parentId: string | null
  /** Id of the VISIBLE row the note lands directly below (null = very
   *  top of the tree). Single source of truth for the drop indicator
   *  and the reorder payload, including smart-outdent hops. */
  insertAfterId: string | null
}

/**
 * Build the tree from the flat GET /notes rows. Depths are assigned by
 * walking down from the roots (NOT during the linking pass, which was
 * order-dependent), and parentId cycles are broken deterministically: any
 * note unreachable from a root is re-rooted and duplicate links are
 * pruned, so bad data renders as a flat entry instead of vanishing or
 * recursing forever.
 */
export function buildNoteTree(notes: Note[]): NoteTreeItem[] {
  const noteMap = new Map<string, NoteTreeItem>()
  const roots: NoteTreeItem[] = []

  notes.forEach((note) => {
    noteMap.set(note.id, { ...note, children: [], depth: 0 })
  })

  noteMap.forEach((treeItem) => {
    if (treeItem.parentId && treeItem.parentId !== treeItem.id && noteMap.has(treeItem.parentId)) {
      noteMap.get(treeItem.parentId)!.children.push(treeItem)
    } else {
      roots.push(treeItem)
    }
  })

  // Walk down from the roots assigning depths; prune any child link
  // that would revisit a note (cycle guard).
  const visited = new Set<string>()
  const walk = (item: NoteTreeItem, depth: number) => {
    item.depth = depth
    item.children = item.children.filter((child) => {
      if (visited.has(child.id)) return false
      visited.add(child.id)
      return true
    })
    item.children.forEach((child) => walk(child, depth + 1))
  }
  roots.forEach((root) => visited.add(root.id))
  roots.forEach((root) => walk(root, 0))

  // Anything not reached from a root sits on a parentId cycle —
  // surface it at the root level rather than losing it.
  noteMap.forEach((item) => {
    if (!visited.has(item.id)) {
      visited.add(item.id)
      roots.push(item)
      walk(item, 0)
    }
  })

  // Sort children by order
  const sortByOrder = (items: NoteTreeItem[]) => {
    items.sort((a, b) => a.order - b.order)
    items.forEach((item) => sortByOrder(item.children))
  }
  sortByOrder(roots)

  return roots
}

function countDescendants(item: NoteTreeItem): number {
  let n = 0
  const stack = [...item.children]
  while (stack.length) {
    const cur = stack.pop()!
    n += 1
    for (const c of cur.children) stack.push(c)
  }
  return n
}

/**
 * Flatten the tree to the list of VISIBLE rows: children of collapsed
 * nodes are skipped, and while a drag is active the dragged note's
 * children are skipped too (the subtree "tucks in" behind the drag
 * overlay and follows the parent to wherever it lands).
 */
export function flattenVisibleTree(
  tree: NoteTreeItem[],
  collapsedIds: Set<string>,
  activeId: string | null,
): FlatNote[] {
  const out: FlatNote[] = []
  const walk = (items: NoteTreeItem[], depth: number) => {
    for (const item of items) {
      const { children, ...note } = item
      out.push({
        ...note,
        depth,
        childCount: children.length,
        descendantCount: countDescendants(item),
      })
      if (children.length === 0) continue
      if (item.id === activeId) continue
      if (collapsedIds.has(item.id)) continue
      walk(children, depth + 1)
    }
  }
  walk(tree, 0)
  return out
}

function getDragDepth(offset: number, indentationWidth: number) {
  return Math.round(offset / indentationWidth)
}

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
export function getProjection(
  items: FlatNote[],
  activeId: string,
  overId: string,
  dragOffset: number,
  indentationWidth: number,
): NoteProjection {
  const overItemIndex = items.findIndex(({ id }) => id === overId)
  const activeItemIndex = items.findIndex(({ id }) => id === activeId)
  const activeItem = items[activeItemIndex]
  if (overItemIndex === -1 || activeItemIndex === -1 || !activeItem) {
    return { depth: 0, maxDepth: 0, minDepth: 0, parentId: null, insertAfterId: null }
  }

  // Work on the list WITHOUT the active row; `p` is the insertion
  // position (count of rows above the line).
  const without = items.filter(({ id }) => id !== activeId)
  // Floor at 0 BEFORE the hop scan — an over-shot leftward drag must
  // read as "root level", not hop the slot past every row in the list.
  const requestedDepth = Math.max(
    0,
    activeItem.depth + getDragDepth(dragOffset, indentationWidth),
  )
  let p = overItemIndex
  while (p < without.length && (without[p]?.depth ?? 0) > requestedDepth) p++

  const previousItem = without[p - 1]
  const nextItem = without[p]
  const maxDepth = previousItem ? previousItem.depth + 1 : 0
  const minDepth = nextItem ? nextItem.depth : 0
  let depth = requestedDepth
  if (depth > maxDepth) depth = maxDepth
  if (depth < minDepth) depth = minDepth

  return {
    depth,
    maxDepth,
    minDepth,
    parentId: getParentId(),
    insertAfterId: previousItem?.id ?? null,
  }

  function getParentId(): string | null {
    if (depth === 0 || !previousItem) return null
    if (depth === previousItem.depth) return previousItem.parentId
    if (depth > previousItem.depth) return previousItem.id
    // Outdenting: nearest row above the slot at the projected depth
    // is a sibling-to-be; share its parent.
    const newParent = without
      .slice(0, p)
      .reverse()
      .find((item) => item.depth === depth)?.parentId
    return newParent ?? null
  }
}

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
export function buildReorderPayload(
  allNotes: Note[],
  activeId: string,
  projected: NoteProjection,
): NoteReorderItem[] | null {
  const active = allNotes.find((n) => n.id === activeId)
  if (!active) return null

  let anchorId: string | null = null
  if (projected.insertAfterId && projected.insertAfterId !== projected.parentId) {
    const parentOf = new Map(allNotes.map((n) => [n.id, n.parentId ?? null]))
    const seen = new Set<string>()
    let cursor: string | null = projected.insertAfterId
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const parent: string | null = parentOf.get(cursor) ?? null
      if (parent === projected.parentId) {
        anchorId = cursor
        break
      }
      cursor = parent
    }
  }

  const siblings = allNotes
    .filter((n) => (n.parentId ?? null) === projected.parentId && n.id !== activeId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  let insertAt = 0
  if (anchorId) {
    const anchorIndex = siblings.findIndex((n) => n.id === anchorId)
    insertAt = anchorIndex === -1 ? siblings.length : anchorIndex + 1
  }
  const nextSiblings = [...siblings]
  nextSiblings.splice(insertAt, 0, active)

  // No-op guard: same parent and same sequence → skip the mutation.
  if ((active.parentId ?? null) === projected.parentId) {
    const currentSequence = allNotes
      .filter((n) => (n.parentId ?? null) === projected.parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((n) => n.id)
    if (currentSequence.join('\n') === nextSiblings.map((n) => n.id).join('\n')) {
      return null
    }
  }

  return nextSiblings.map((n, i) => ({
    noteId: n.id,
    parentId: projected.parentId,
    order: (i + 1) * 1000,
  }))
}
