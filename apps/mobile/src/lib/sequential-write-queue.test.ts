// No import of describe/it/expect — Jest globals, same as note-content.test.ts
// and every other test in this directory.

import { createSequentialWriteQueue } from "./sequential-write-queue";

/** A controllable async "write": doesn't resolve until its `resolve` is
 *  called, so tests can force writes to settle out of the order they were
 *  enqueued in and assert the queue still ran them in enqueue order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSequentialWriteQueue", () => {
  it("runs a single enqueued write", async () => {
    const runs: string[] = [];
    const queue = createSequentialWriteQueue<string>(async (value) => {
      runs.push(value);
    });

    await queue.enqueue("a");

    expect(runs).toEqual(["a"]);
  });

  it("starts the next write only after the previous one's run has settled, even when the earlier run resolves later", async () => {
    // This is the exact shape of the bug: a "shadow save" (write 1, started
    // first) that's still in flight when a later write (write 2) is
    // enqueued and finishes fast. Without sequencing, write 1's `run` would
    // already be executing concurrently with write 2's and could resolve
    // after it, stamping stale data back on top of fresh data.
    const order: string[] = [];
    const first = deferred<void>();

    const queue = createSequentialWriteQueue<string>(async (value) => {
      order.push(`start:${value}`);
      if (value === "shadow") await first.promise;
      order.push(`end:${value}`);
    });

    const shadowWrite = queue.enqueue("shadow");
    // "shadow"'s run has started (it's first in the queue) but is blocked on
    // `first`. Enqueue the real, later write behind it.
    const realWrite = queue.enqueue("real");

    // Give microtasks a chance to run. "real"'s `run` must NOT have started
    // yet — it is queued behind "shadow", which hasn't resolved.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["start:shadow"]);

    // Now let the shadow (earlier-enqueued, slower) write finish.
    first.resolve();
    await shadowWrite;
    await realWrite;

    // Both writes ran, strictly in the order they were enqueued — "real"
    // never started until "shadow" fully finished, so there was never a
    // moment where an out-of-order resolution could let "shadow" clobber
    // "real".
    expect(order).toEqual(["start:shadow", "end:shadow", "start:real", "end:real"]);
  });

  it("does not let a write that resolves quickly run before an earlier-enqueued write that is still slow", async () => {
    // Same scenario stated the other way: enqueue a slow write, then a fast
    // one, and confirm the fast one's `run` genuinely waits — it doesn't
    // just report resolving after "start" order, it doesn't call `run` at
    // all until the slow one is done.
    const runOrder: string[] = [];
    const slow = deferred<void>();
    let fastRunCount = 0;

    const queue = createSequentialWriteQueue<string>(async (value) => {
      runOrder.push(value);
      if (value === "slow") {
        await slow.promise;
      } else {
        fastRunCount += 1;
      }
    });

    const slowWrite = queue.enqueue("slow");
    const fastWrite = queue.enqueue("fast");

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fastRunCount).toBe(0);
    expect(runOrder).toEqual(["slow"]);

    slow.resolve();
    await slowWrite;
    await fastWrite;

    expect(runOrder).toEqual(["slow", "fast"]);
    expect(fastRunCount).toBe(1);
  });

  it("continues running subsequent writes after an earlier write's run rejects", async () => {
    const runs: string[] = [];
    const queue = createSequentialWriteQueue<string>(async (value) => {
      runs.push(value);
      if (value === "boom") throw new Error("network failure");
    });

    await expect(queue.enqueue("boom")).rejects.toThrow("network failure");
    await queue.enqueue("after");

    expect(runs).toEqual(["boom", "after"]);
  });

  it("does not produce an unhandled rejection when a caller never awaits a failed enqueue", async () => {
    const queue = createSequentialWriteQueue<string>(async () => {
      throw new Error("ignored by caller");
    });

    // Deliberately not awaited/caught by the test, mirroring call sites like
    // `void enqueueContentSave(html)` — the internal chain must swallow this
    // itself rather than relying on the caller.
    queue.enqueue("fire-and-forget");

    await Promise.resolve();
    await Promise.resolve();
    // Reaching this line without the test process reporting an unhandled
    // rejection is the assertion.
    expect(true).toBe(true);
  });

  it("pending() reflects the queue's current tail, including after everything has settled", async () => {
    const queue = createSequentialWriteQueue<number>(async () => undefined);

    expect(queue.pending()).toBeNull();

    const write = queue.enqueue(1);
    expect(queue.pending()).toBe(write);

    await write;
    // Still the same, already-settled promise — awaiting it again is free,
    // and a caller like `flushPending` needs `pending()` to never spuriously
    // report "nothing outstanding" right after the last write finished.
    expect(queue.pending()).toBe(write);
  });

  it("run receives values in the order enqueue was called, not settlement order", async () => {
    const seen: number[] = [];
    const gate = deferred<void>();
    const queue = createSequentialWriteQueue<number>(async (value) => {
      if (value === 1) await gate.promise;
      seen.push(value);
    });

    const p1 = queue.enqueue(1);
    const p2 = queue.enqueue(2);
    const p3 = queue.enqueue(3);

    gate.resolve();
    await Promise.all([p1, p2, p3]);

    expect(seen).toEqual([1, 2, 3]);
  });
});
