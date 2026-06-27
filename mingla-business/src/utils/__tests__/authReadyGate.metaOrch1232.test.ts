// META-ORCH-1232 (C2) — await-until-ready guard for imperative brand mutations.
// [TEST-MOD-APPROVED META-ORCH-1232] — fresh-signup follow-up: cover the new
// async-isReady path and awaitSessionAttached (real attached-token write gate).
import { describe, expect, jest, test } from "@jest/globals";

import {
  awaitAuthReady,
  awaitSessionAttached,
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

  // META-ORCH-1232 follow-up (fresh-signup gap) — isReady may now be async.
  test("supports an ASYNC isReady that resolves true immediately (no delay)", async () => {
    const sleep = jest.fn(async () => undefined);
    await expect(
      awaitAuthReady({ isReady: async () => true, sleep }),
    ).resolves.toBeUndefined();
    expect(sleep).not.toHaveBeenCalled();
  });

  test("ASYNC isReady that flips true mid-flight proceeds within the cap", async () => {
    let polls = 0;
    const isReady = async (): Promise<boolean> => {
      polls += 1;
      return polls >= 3;
    };
    const sleep = jest.fn(async () => undefined);
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
});

describe("awaitSessionAttached (META-ORCH-1232 fresh-signup gap)", () => {
  const okOpts = { sleep: jest.fn(async () => undefined) };

  test("resolves when a real session with a non-empty access_token is attached", async () => {
    const getSession = jest.fn(async () => ({
      data: { session: { access_token: "jwt-abc" } },
    }));
    await expect(
      awaitSessionAttached(getSession, okOpts),
    ).resolves.toBeUndefined();
    expect(getSession).toHaveBeenCalled();
  });

  test("throws AuthNotReadyError when no session is attached within the cap (never silent anon drop)", async () => {
    const getSession = jest.fn(async () => ({ data: { session: null } }));
    let nowMs = 0;
    const now = (): number => {
      const v = nowMs;
      nowMs += 10000;
      return v;
    };
    await expect(
      awaitSessionAttached(getSession, {
        sleep: jest.fn(async () => undefined),
        now,
        capMs: 5000,
        pollMs: 100,
      }),
    ).rejects.toBeInstanceOf(AuthNotReadyError);
  });

  test("treats an empty-string access_token as NOT attached (the fresh-signup anon window)", async () => {
    const getSession = jest.fn(async () => ({
      data: { session: { access_token: "" } },
    }));
    let nowMs = 0;
    const now = (): number => {
      const v = nowMs;
      nowMs += 10000;
      return v;
    };
    await expect(
      awaitSessionAttached(getSession, {
        sleep: jest.fn(async () => undefined),
        now,
        capMs: 5000,
        pollMs: 100,
      }),
    ).rejects.toBeInstanceOf(AuthNotReadyError);
  });

  test("proceeds once the token attaches mid-flight (flag-true-before-JWT race)", async () => {
    let polls = 0;
    const getSession = jest.fn(async () => {
      polls += 1;
      return {
        data: {
          session: polls >= 3 ? { access_token: "jwt-late" } : null,
        },
      };
    });
    let nowMs = 0;
    const now = (): number => {
      nowMs += 1;
      return nowMs;
    };
    await expect(
      awaitSessionAttached(getSession, {
        sleep: jest.fn(async () => undefined),
        now,
        capMs: 100000,
        pollMs: 10,
      }),
    ).resolves.toBeUndefined();
    expect(polls).toBeGreaterThanOrEqual(3);
  });
});
