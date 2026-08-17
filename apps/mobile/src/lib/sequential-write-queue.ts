// Extracted from app/(app)/note/[id].tsx, where a note's content is saved
// through more than one independent path — dictation's read-modify-write,
// the debounced `useEditorContent` effect, and the on-blur `flushPending`
// flush. Each of those paths calls `apiClient.notes.update` on its own
// `expo/fetch` call, and nothing about a plain `fetch` guarantees that two
// independent requests resolve in the order they were sent: whichever
// response happens to land last wins, even if it was reading a stale,
// earlier snapshot of the document. That let a debounced autosave, fired by
// a natural pause between dictated phrases, occasionally resolve AFTER a
// later phrase's save and silently stamp the note back down to an earlier,
// shorter version.
//
// A `SequentialWriteQueue` fixes that generically: every write enqueued
// through it is not just *sent* in enqueue order, its underlying `run` is not
// even STARTED until the previous write has fully settled. That makes it
// impossible for two writes managed by the same queue to have their
// underlying requests in flight at the same time, so there is nothing left to
// race — the last one enqueued is, by construction, the last one sent and the
// last one to resolve.

/** A queue of async writes that always run one at a time, strictly in the
 *  order they were enqueued — the next write's `run` is not invoked until
 *  the previous one's returned promise has settled, regardless of how long
 *  any individual write takes or in what order its underlying work (e.g. a
 *  network response) would otherwise resolve. */
export interface SequentialWriteQueue<T> {
  /** Enqueue a write behind whatever this queue is currently doing. Returns
   *  a promise that resolves once THIS write (not the whole queue) has run —
   *  awaiting it also waits for every write enqueued before it, since this
   *  write does not start until those are done. A rejected `run` does not
   *  wedge the queue: later enqueues still run, they just don't observe the
   *  earlier failure (callers that care about a specific write's outcome
   *  should inspect the promise `enqueue` returns for that call). */
  enqueue(value: T): Promise<void>;
  /** The in-flight (or already-settled) tail of the queue, if anything has
   *  ever been enqueued — `null` before the first `enqueue` call. Useful for
   *  "wait for everything currently queued" call sites that don't have (and
   *  don't want to construct) a value to enqueue themselves. */
  pending(): Promise<void> | null;
}

/** Builds a `SequentialWriteQueue` that runs each enqueued value through
 *  `run`. `run` is invoked with whatever the queue's current settings are at
 *  the moment each write actually starts (not when it was enqueued), so a
 *  caller can freely pass a `run` that reads from a ref kept up to date
 *  across renders without needing to rebuild the queue itself when that
 *  changes. */
export function createSequentialWriteQueue<T>(run: (value: T) => Promise<void>): SequentialWriteQueue<T> {
  let tail: Promise<void> | null = null;

  function enqueue(value: T): Promise<void> {
    const previous = tail;
    const write = (async () => {
      if (previous) await previous.catch(() => undefined);
      await run(value);
    })();
    // Swallowed here so one write's rejection can't become an unhandled
    // promise rejection on the internal chain — `enqueue`'s own return value
    // still carries the rejection to whichever caller is actually awaiting
    // this specific write.
    write.catch(() => undefined);
    // Kept even after it settles: awaiting an already-settled promise is
    // free, and never clearing `tail` means `pending()` can't return `null`
    // while a write that already ran is still the most recent one — the
    // queue's "is anything outstanding" answer would otherwise flicker to
    // "no" the instant the last write's callback finishes running, before a
    // caller elsewhere has had a chance to enqueue the next one.
    tail = write;
    return write;
  }

  function pending(): Promise<void> | null {
    return tail;
  }

  return { enqueue, pending };
}
