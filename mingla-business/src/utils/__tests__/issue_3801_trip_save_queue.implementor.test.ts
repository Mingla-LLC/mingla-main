/**
 * Issue #3801 / #4134 — the trip save queue: one save at a time, a deadline on
 * every save, and a conflict that stops everything until Reload.
 *
 * Production evidence (#3801, 2026-10-26): two saves to one trip went out
 * together carrying the same revision; the second was refused with
 * `trip_revision_conflict` and the host saw "Saving…" until they reloaded.
 * These cases pin the queue the wizard now routes every save through.
 */

import { describe, expect, test } from "@jest/globals";

import {
  TripRevisionConflictError,
  TripSaveTimeoutError,
  createTripSaveQueue,
  isTripRevisionConflict,
  isTripSaveTimeout,
} from "../tripSaveQueue";

const deferred = <T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const tick = (ms = 0): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("#3801 — one save at a time", () => {
  test("a save queued while another runs starts only after the first settles", async () => {
    const queue = createTripSaveQueue(1_000);
    const first = deferred();
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const track = (name: string, wait: Promise<void>) => async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${name}`);
      await wait;
      order.push(`end:${name}`);
      inFlight -= 1;
    };

    const a = queue.run(track("a", first.promise));
    const b = queue.run(track("b", Promise.resolve()));
    await tick();
    expect(order).toEqual(["start:a"]);
    expect(queue.isBusy()).toBe(true);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
    expect(maxInFlight).toBe(1);
    await tick();
    expect(queue.isBusy()).toBe(false);
  });

  test("a failed save does not block the next one", async () => {
    const queue = createTripSaveQueue(1_000);
    await expect(queue.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(queue.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});

describe("#3801 — every save has a deadline", () => {
  test("the caller stops waiting at the deadline", async () => {
    const queue = createTripSaveQueue(30);
    const never = new Promise<void>(() => undefined);
    const run = queue.run(() => never);
    await expect(run).rejects.toBeInstanceOf(TripSaveTimeoutError);
    await run.catch((error: unknown) => {
      expect(isTripSaveTimeout(error)).toBe(true);
    });
  });

  test("a save that timed out still blocks the next one until it settles (no overlap)", async () => {
    const queue = createTripSaveQueue(30);
    const slow = deferred();
    let secondStarted = false;
    const first = queue.run(() => slow.promise);
    await expect(first).rejects.toBeInstanceOf(TripSaveTimeoutError);

    const second = queue.run(async () => {
      secondStarted = true;
    }, 1_000);
    await tick(10);
    expect(secondStarted).toBe(false);
    expect(queue.isBusy()).toBe(true);

    slow.resolve();
    await second;
    expect(secondStarted).toBe(true);
  });

  test("waitForIdle also ends at the deadline", async () => {
    const queue = createTripSaveQueue(30);
    void queue.run(() => new Promise<void>(() => undefined)).catch(() => undefined);
    await expect(queue.waitForIdle()).rejects.toBeInstanceOf(TripSaveTimeoutError);
  });
});

describe("#3801 — a revision conflict stops every later save, without a request", () => {
  test("after a conflict the next task never runs", async () => {
    const queue = createTripSaveQueue(1_000);
    const conflict = { code: "PT409", message: "trip_revision_conflict", details: null, hint: null };
    await expect(queue.run(() => Promise.reject(conflict))).rejects.toBe(conflict);
    expect(queue.isConflicted()).toBe(true);

    let ran = false;
    await expect(
      queue.run(async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(TripRevisionConflictError);
    expect(ran).toBe(false);
  });

  test("an ordinary failure does not latch", async () => {
    const queue = createTripSaveQueue(1_000);
    await expect(
      queue.run(() => Promise.reject({ code: "22023", message: "trip_days_invalid" })),
    ).rejects.toBeTruthy();
    expect(queue.isConflicted()).toBe(false);
  });

  test.each([
    [{ code: "PT409", message: "anything" }, true],
    [{ code: "40001", message: "trip_revision_conflict" }, true],
    [{ status: 409, message: "Conflict" }, true],
    [new Error("trip_revision_conflict"), true],
    [{ code: "trip_revision_conflict", message: "This trip was changed" }, true],
    [{ code: "internal_error", message: "x", detail: "trip_revision_conflict" }, true],
    [new TripRevisionConflictError(), true],
    [{ code: "23505", status: 409, message: "duplicate key" }, false],
    [{ code: "22023", message: "trip_days_invalid" }, false],
    [new Error("network down"), false],
    [null, false],
    ["[object Object]", false],
  ])("isTripRevisionConflict(%p) is %p", (error, expected) => {
    expect(isTripRevisionConflict(error)).toBe(expected);
  });
});
