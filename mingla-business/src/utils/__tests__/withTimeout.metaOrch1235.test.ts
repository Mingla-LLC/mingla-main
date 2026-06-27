// META-ORCH-1235 — withTimeout settle-guarantee unit test.
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import {
  withTimeout,
  TimeoutError,
  isTimeoutError,
  DATA_FETCH_TIMEOUT_MS,
  AUTH_PROBE_TIMEOUT_MS,
} from "../withTimeout";

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("withTimeout", () => {
  test("rejects with a TimeoutError when the promise never settles", async () => {
    let caught: unknown;
    const settled = withTimeout(new Promise(() => {}), 100, "never").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: unknown) => {
        caught = e;
      },
    );
    await jest.advanceTimersByTimeAsync(150);
    await settled;
    expect(isTimeoutError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(TimeoutError);
    expect((caught as TimeoutError).isTimeout).toBe(true);
  });

  test("resolves with the original value when the promise settles in time", async () => {
    const result = withTimeout(Promise.resolve(42), 100, "fast");
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe(42);
  });

  test("propagates the original rejection (not a TimeoutError) when it rejects in time", async () => {
    const original = new Error("boom");
    let caught: unknown;
    const settled = withTimeout(Promise.reject(original), 100, "errs").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: unknown) => {
        caught = e;
      },
    );
    await jest.advanceTimersByTimeAsync(0);
    await settled;
    expect(caught).toBe(original);
    expect(isTimeoutError(caught)).toBe(false);
  });

  test("exposes the two — and only the two — named deadline constants", () => {
    expect(DATA_FETCH_TIMEOUT_MS).toBe(15000);
    expect(AUTH_PROBE_TIMEOUT_MS).toBe(5000);
  });
});
