/**
 * #3040 T-A21 [A-21] — the web duration read is bounded at 8 s (two 3 s
 * attempts and one 1 s settle), and the "reading" step shows before the
 * first attempt — no more ~29 s of silence after the file chooser closes.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  readPickedVideoDurationMs,
  VIDEO_DURATION_ATTEMPT_TIMEOUT_MS,
  VIDEO_DURATION_READ_BUDGET_MS,
  VIDEO_DURATION_RETRY_DELAYS_MS,
} from "../pickedVideoDuration";

describe("#3040 T-A21 — bounded duration read", () => {
  const originalDocument = (global as { document?: unknown }).document;
  beforeEach(() => {
    jest.useFakeTimers();
    // A <video> that never reports a duration.
    (global as { document?: unknown }).document = {
      createElement: () => ({
        duration: Number.NaN,
        removeAttribute: () => undefined,
        load: () => undefined,
        set src(_value: string) { /* never loads */ },
      }),
    };
  });
  afterEach(() => {
    jest.useRealTimers();
    (global as { document?: unknown }).document = originalDocument;
  });

  test("the budget is at most 8000 ms", () => {
    expect(VIDEO_DURATION_ATTEMPT_TIMEOUT_MS).toBe(3000);
    expect(VIDEO_DURATION_RETRY_DELAYS_MS).toEqual([1000]);
    expect(VIDEO_DURATION_READ_BUDGET_MS).toBeLessThanOrEqual(8000);
  });

  test("an unreadable clip gives up within the budget, and reading is announced first", async () => {
    const order: string[] = [];
    let settled = false;
    const read = readPickedVideoDurationMs("blob:x", null, () => order.push("reading")).then((value) => {
      settled = true;
      order.push(`done:${String(value)}`);
    });
    expect(order[0]).toBe("reading");
    await jest.advanceTimersByTimeAsync(VIDEO_DURATION_READ_BUDGET_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(2);
    await read;
    expect(settled).toBe(true);
    expect(order).toEqual(["reading", "done:null"]);
  });
});
