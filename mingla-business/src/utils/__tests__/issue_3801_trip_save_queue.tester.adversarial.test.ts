/**
 * Issue #3801 / #4134 — tester adversarial: the trip save queue under a
 * failure sequence the implementor's cases do not chain together.
 *
 *   1. An ordinary refusal, then a save that never answers in time, then the
 *      LATE answer to that timed-out save is a revision conflict. The save
 *      queued behind it must never reach the wire: the latch has to engage
 *      even though the caller of the conflicting save stopped listening at its
 *      deadline.
 *   2. Production still raises the conflict as SQLSTATE 40001 (not PT409) until
 *      #4134's migration is applied, so the shape the wizard really receives
 *      today, `{ code: "40001", message: "trip_revision_conflict" }`, must count
 *      as a conflict; a plain 40001 serialization failure and a 409 that carries
 *      its own code (a unique violation) must not.
 *
 * Fails on revert: drop the latch in `run`'s catch (case 1 red); start the next
 * task when the caller's deadline fires instead of when the work settles
 * (case 1 red); stop reading `message` for the conflict name (case 2 red).
 */

import { describe, expect, test } from "@jest/globals";

import {
  TripRevisionConflictError,
  TripSaveTimeoutError,
  createTripSaveQueue,
  isTripRevisionConflict,
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

describe("#3801 tester adversarial — refusal, then timeout, then a late conflict", () => {
  test("the save queued behind a timed-out save whose late answer is a conflict never runs", async () => {
    const queue = createTripSaveQueue(40);
    const ran: string[] = [];

    // 1. An ordinary refusal: said to its caller, does not latch.
    await expect(
      queue.run(async () => {
        ran.push("refused");
        throw Object.assign(new Error("trip_graph_invalid"), { code: "22023" });
      }),
    ).rejects.toThrow("trip_graph_invalid");
    expect(queue.isConflicted()).toBe(false);
    expect(queue.isBusy()).toBe(false);

    // 2. A save that does not answer before its deadline.
    const hung = deferred<string>();
    const hungCall = queue.run(async () => {
      ran.push("hung");
      return hung.promise;
    });
    // 3. The host presses again; this save waits behind the hung one.
    const queued = queue.run(async () => {
      ran.push("queued");
      return "should-not-run";
    }, 1_000);
    const queuedOutcome = queued.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    await expect(hungCall).rejects.toBeInstanceOf(TripSaveTimeoutError);
    // The caller stopped waiting, but the request is still on the wire.
    expect(queue.isBusy()).toBe(true);
    await tick(20);
    expect(ran).toEqual(["refused", "hung"]);

    // 4. The late answer is a revision conflict (production's 40001 shape).
    hung.reject({ code: "40001", message: "trip_revision_conflict", details: null, hint: null });
    const outcome = await queuedOutcome;

    expect(ran).toEqual(["refused", "hung"]);
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: unknown }).error).toBeInstanceOf(TripRevisionConflictError);
    expect(queue.isConflicted()).toBe(true);
    expect(queue.isBusy()).toBe(false);

    // Every later save is refused without a request.
    await expect(
      queue.run(async () => {
        ran.push("after-latch");
      }),
    ).rejects.toBeInstanceOf(TripRevisionConflictError);
    expect(ran).toEqual(["refused", "hung"]);
  });
});

describe("#3801 tester adversarial — what counts as a revision conflict", () => {
  test("production's current shape (SQLSTATE 40001 named trip_revision_conflict) is a conflict", () => {
    expect(
      isTripRevisionConflict({
        code: "40001",
        message: "trip_revision_conflict",
        details: null,
        hint: null,
      }),
    ).toBe(true);
  });

  test("a bare serialization failure and a 409 with its own code are not", () => {
    expect(
      isTripRevisionConflict({
        code: "40001",
        message: "could not serialize access due to concurrent update",
      }),
    ).toBe(false);
    expect(
      isTripRevisionConflict({
        status: 409,
        code: "23505",
        message: "duplicate key value violates unique constraint",
      }),
    ).toBe(false);
    expect(isTripRevisionConflict(null)).toBe(false);
    expect(isTripRevisionConflict("network request failed")).toBe(false);
  });
});
