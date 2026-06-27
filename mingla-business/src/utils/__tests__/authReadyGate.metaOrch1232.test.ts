// META-ORCH-1232 (C2) — await-until-ready guard for imperative brand mutations.
import { describe, expect, jest, test } from "@jest/globals";

import {
  awaitAuthReady,
  AuthNotReadyError,
  isAuthNotReadyError,
} from "../authReadyGate";

describe("awaitAuthReady (META-ORCH-1232 C2)", () => {
  test("resolves immediately when already ready (no delay)", async () => {
    const sleep = jest.fn(async () => undefined);
    await expect(
      awaitAuthReady({ isReady: () => true, sleep }),
    ).resolves.toBeUndefined();
    expect(sleep).not.toHaveBeenCalled();
  });

  test("proceeds once auth flips ready within the cap (mid-flight)", async () => {
    let ready = false;
    // Flip ready on the 3rd poll.
    let polls = 0;
    const isReady = (): boolean => {
      polls += 1;
      if (polls >= 3) ready = true;
      return ready;
    };
    const sleep = jest.fn(async () => undefined);
    // Use a fake clock that never elapses so the loop relies on isReady flipping.
    let nowMs = 0;
    const now = (): number => {
      nowMs += 1;
      return nowMs;
    };
    await expect(
      awaitAuthReady({ isReady, sleep, now, capMs: 100000, pollMs: 10 }),
    ).resolves.toBeUndefined();
    expect(sleep).toHaveBeenCalled();
  });

  test("throws AuthNotReadyError when the cap elapses still not-ready (never silently drops)", async () => {
    const sleep = jest.fn(async () => undefined);
    // Clock jumps past the deadline after one sleep.
    let nowMs = 0;
    const now = (): number => {
      const v = nowMs;
      nowMs += 10000;
      return v;
    };
    await expect(
      awaitAuthReady({
        isReady: () => false,
        sleep,
        now,
        capMs: 5000,
        pollMs: 100,
      }),
    ).rejects.toBeInstanceOf(AuthNotReadyError);
  });

  test("isAuthNotReadyError recognizes the typed error", () => {
    expect(isAuthNotReadyError(new AuthNotReadyError())).toBe(true);
    expect(isAuthNotReadyError(new Error("other"))).toBe(false);
  });
});
