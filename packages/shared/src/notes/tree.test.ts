import { describe, expect, it } from 'vitest'

import type { Note, NoteTreeItem } from '../types/note'
import {
  buildNoteTree,
  buildReorderPayload,
  flattenVisibleTree,
  getProjection,
  INDENTATION_WIDTH,
} from './tree'

function note(id: string, parentId: string | null, order: number): Note {
  return {
    id,
    title: id,
    content: '',
    icon: null,
    color: null,
    parentId,
    order,
    isExpanded: true,
    isFavorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    userId: 'u1',
  }
}

/** a(a1, a2), b, c — the standard fixture used across suites. */
const standardNotes = (): Note[] => [
  note('a', null, 1000),
  note('a1', 'a', 1000),
  note('a2', 'a', 2000),
  note('b', null, 2000),
  note('c', null, 3000),
]

describe('buildNoteTree', () => {
  it('assigns depths independent of input order (children listed before parents)', () => {
    const tree = buildNoteTree([
      note('grandchild', 'child', 1000),
      note('child', 'root', 1000),
      note('root', null, 1000),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe('root')
    expect(tree[0]!.depth).toBe(0)
    expect(tree[0]!.children[0]!.id).toBe('child')
    expect(tree[0]!.children[0]!.depth).toBe(1)
    expect(tree[0]!.children[0]!.children[0]!.id).toBe('grandchild')
    expect(tree[0]!.children[0]!.children[0]!.depth).toBe(2)
  })

  it('handles deep chains', () => {
    const ids = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5']
    const notes = ids.map((id, i) => note(id, i === 0 ? null : ids[i - 1]!, 1000))
    const tree = buildNoteTree(notes)

    let cursor: NoteTreeItem | undefined = tree[0]
    for (let depth = 0; depth < ids.length; depth++) {
      expect(cursor!.id).toBe(ids[depth])
      expect(cursor!.depth).toBe(depth)
      cursor = cursor!.children[0]
    }
  })

  it('sorts siblings by order at every level', () => {
    const tree = buildNoteTree([
      note('r2', null, 2000),
      note('r1', null, 1000),
      note('r1b', 'r1', 5000),
      note('r1a', 'r1', 1000),
    ])

    expect(tree.map((t) => t.id)).toEqual(['r1', 'r2'])
    expect(tree[0]!.children.map((t) => t.id)).toEqual(['r1a', 'r1b'])
  })

  it('re-roots a two-node parentId cycle instead of dropping or recursing', () => {
    const tree = buildNoteTree([note('x', 'y', 1000), note('y', 'x', 1000)])

    // First map entry wins the re-root; the back-link is pruned.
    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe('x')
    expect(tree[0]!.depth).toBe(0)
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['y'])
    expect(tree[0]!.children[0]!.depth).toBe(1)
    expect(tree[0]!.children[0]!.children).toEqual([])
  })

  it('keeps legitimate children hanging off a three-node cycle', () => {
    const tree = buildNoteTree([
      note('c1', 'c3', 1000),
      note('c2', 'c1', 1000),
      note('c3', 'c2', 1000),
      note('kid', 'c1', 2000),
    ])

    const ids = new Set<string>()
    const collect = (items: typeof tree) =>
      items.forEach((i) => {
        ids.add(i.id)
        collect(i.children)
      })
    collect(tree)

    // Nothing vanished, and the cycle is broken (kid stays under c1).
    expect(ids).toEqual(new Set(['c1', 'c2', 'c3', 'kid']))
    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe('c1')
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['c2', 'kid'])
  })

  it('treats a self-parented note as a root', () => {
    const tree = buildNoteTree([note('selfie', 'selfie', 1000)])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.id).toBe('selfie')
    expect(tree[0]!.depth).toBe(0)
  })

  it('re-roots orphans whose parentId points at a missing note', () => {
    const tree = buildNoteTree([note('root', null, 1000), note('orphan', 'gone', 2000)])
    expect(tree.map((t) => t.id)).toEqual(['root', 'orphan'])
    expect(tree[1]!.depth).toBe(0)
  })
})

describe('flattenVisibleTree', () => {
  it('emits DFS rows with depth, childCount and descendantCount from the full tree', () => {
    const tree = buildNoteTree(standardNotes())
    const flat = flattenVisibleTree(tree, new Set(), null)

    expect(flat.map((f) => [f.id, f.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
      ['c', 0],
    ])
    const a = flat.find((f) => f.id === 'a')!
    expect(a.childCount).toBe(2)
    expect(a.descendantCount).toBe(2)
  })

  it('counts nested descendants but only direct children', () => {
    const tree = buildNoteTree([
      note('r', null, 1000),
      note('k1', 'r', 1000),
      note('k1a', 'k1', 1000),
      note('k1a1', 'k1a', 1000),
    ])
    const flat = flattenVisibleTree(tree, new Set(), null)
    const r = flat.find((f) => f.id === 'r')!

    expect(r.childCount).toBe(1)
    expect(r.descendantCount).toBe(3)
  })

  it('skips children of collapsed nodes but keeps their childCount', () => {
    const tree = buildNoteTree(standardNotes())
    const flat = flattenVisibleTree(tree, new Set(['a']), null)

    expect(flat.map((f) => f.id)).toEqual(['a', 'b', 'c'])
    expect(flat[0]!.childCount).toBe(2)
  })

  it("hides the active row's subtree during a drag", () => {
    const tree = buildNoteTree(standardNotes())
    const flat = flattenVisibleTree(tree, new Set(), 'a')

    expect(flat.map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('getProjection', () => {
  const visible = (activeId: string | null, notes = standardNotes()) =>
    flattenVisibleTree(buildNoteTree(notes), new Set(), activeId)

  it('indents into the row above when dragged right (parent = previous row)', () => {
    // Drop c into the slot before b; previous visible row is a2 (depth 1).
    const items = visible('c')
    const projected = getProjection(items, 'c', 'b', 2 * INDENTATION_WIDTH, INDENTATION_WIDTH)

    expect(projected).toEqual({ depth: 2, maxDepth: 2, minDepth: 0, parentId: 'a2' })
  })

  it('clamps an over-indent to maxDepth (previous row depth + 1)', () => {
    const items = visible('c')
    const projected = getProjection(items, 'c', 'b', 10 * INDENTATION_WIDTH, INDENTATION_WIDTH)

    expect(projected.depth).toBe(2)
    expect(projected.maxDepth).toBe(2)
    expect(projected.parentId).toBe('a2')
  })

  it('clamps an over-outdent to minDepth (row below) and resolves a null parent', () => {
    const items = visible('a1')
    const projected = getProjection(items, 'a1', 'a2', -10 * INDENTATION_WIDTH, INDENTATION_WIDTH)

    expect(projected.depth).toBe(0)
    expect(projected.minDepth).toBe(0)
    expect(projected.parentId).toBeNull()
  })

  it('keeps a same-depth drop as a sibling of the previous row', () => {
    // a1a sits at depth 2 under a1; nudging one level left makes it a1's sibling.
    const notes = [note('a', null, 1000), note('a1', 'a', 1000), note('a1a', 'a1', 1000)]
    const items = visible('a1a', notes)
    const projected = getProjection(items, 'a1a', 'a1a', -INDENTATION_WIDTH, INDENTATION_WIDTH)

    expect(projected).toEqual({ depth: 1, maxDepth: 2, minDepth: 0, parentId: 'a' })
  })

  it('resolves an outdent parent from the nearest shallower row above', () => {
    // Previous row (a1a, depth 2) is deeper than the projected depth 1, so
    // the parent comes from the nearest depth-1 row above: a1 → parent a.
    const notes = [
      note('a', null, 1000),
      note('a1', 'a', 1000),
      note('a1a', 'a1', 1000),
      note('z', null, 2000),
    ]
    const items = visible('z', notes)
    const projected = getProjection(items, 'z', 'z', INDENTATION_WIDTH, INDENTATION_WIDTH)

    expect(projected.depth).toBe(1)
    expect(projected.parentId).toBe('a')
  })
})

describe('buildReorderPayload', () => {
  const setup = (activeId: string, notes = standardNotes()) => {
    const items = flattenVisibleTree(buildNoteTree(notes), new Set(), activeId)
    return { items, notes }
  }

  it('renumbers the destination siblings on the sparse *1000 scale for a same-parent move', () => {
    const { items, notes } = setup('c')
    const projected = getProjection(items, 'c', 'b', 0, INDENTATION_WIDTH)
    const payload = buildReorderPayload(items, notes, 'c', 'b', projected)

    expect(payload).toEqual([
      { noteId: 'a', parentId: null, order: 1000 },
      { noteId: 'c', parentId: null, order: 2000 },
      { noteId: 'b', parentId: null, order: 3000 },
    ])
  })

  it('reparents on indent and only renumbers the new parent’s children', () => {
    const { items, notes } = setup('c')
    const projected = getProjection(items, 'c', 'b', 2 * INDENTATION_WIDTH, INDENTATION_WIDTH)
    const payload = buildReorderPayload(items, notes, 'c', 'b', projected)

    // c becomes the (only) child of a2 — no root rows in the payload.
    expect(payload).toEqual([{ noteId: 'c', parentId: 'a2', order: 1000 }])
  })

  it('places an outdented note after its former ancestor among the new siblings', () => {
    const notes = [
      note('a', null, 1000),
      note('a1', 'a', 1000),
      note('a1a', 'a1', 1000),
      note('z', null, 2000),
    ]
    const { items } = setup('z', notes)
    const projected = getProjection(items, 'z', 'z', INDENTATION_WIDTH, INDENTATION_WIDTH)
    const payload = buildReorderPayload(items, notes, 'z', 'z', projected)

    expect(payload).toEqual([
      { noteId: 'a1', parentId: 'a', order: 1000 },
      { noteId: 'z', parentId: 'a', order: 2000 },
    ])
  })

  it('moves a whole subtree by emitting only the dragged note, not its descendants', () => {
    const { items, notes } = setup('a') // a's children are tucked away
    const projected = getProjection(items, 'a', 'b', 0, INDENTATION_WIDTH)
    const payload = buildReorderPayload(items, notes, 'a', 'b', projected)

    expect(payload).toEqual([
      { noteId: 'b', parentId: null, order: 1000 },
      { noteId: 'a', parentId: null, order: 2000 },
      { noteId: 'c', parentId: null, order: 3000 },
    ])
    expect(payload!.some((p) => p.noteId === 'a1' || p.noteId === 'a2')).toBe(false)
  })

  it('returns null for a same-parent same-sequence drop (no-op)', () => {
    const { items, notes } = setup('c')
    const projected = getProjection(items, 'c', 'c', 0, INDENTATION_WIDTH)

    expect(buildReorderPayload(items, notes, 'c', 'c', projected)).toBeNull()
  })

  it('returns null when the active or over row is unknown', () => {
    const { items, notes } = setup('c')
    const projected = getProjection(items, 'c', 'b', 0, INDENTATION_WIDTH)

    expect(buildReorderPayload(items, notes, 'ghost', 'b', projected)).toBeNull()
    expect(buildReorderPayload(items, notes, 'c', 'ghost', projected)).toBeNull()
  })
})
