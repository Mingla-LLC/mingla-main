/**
 * ORCH-1248 (Apple 2.1a) — Edit Profile hung forever behind an untimed
 * creator_accounts read on Apple's proxied/VPN review network.
 *
 * fetchCreatorAccount MUST be guaranteed to settle: a never-resolving supabase
 * read has to REJECT within the timeout (via withTimeout + AbortController) so
 * React Query surfaces isError → the screen's existing Retry UI shows instead of
 * an infinite spinner. Fake timers prove the settle-guarantee without waiting
 * the real 9s.
 *
 * fails-on-revert: drop the timeout wrapping and this test hangs → jest fails.
 */
/* eslint-disable import/first */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// A never-settling terminal promise for .maybeSingle() — models a stalled read.
const neverSettles = new Promise<never>(() => {});
const abortSignalSpy = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          abortSignal: (signal: unknown) => {
            abortSignalSpy(signal);
            return { maybeSingle: () => neverSettles };
          },
        }),
      }),
    }),
  },
}));

// AuthContext + creatorAccount service pull in react-native (untransformed ESM);
// fetchCreatorAccount needs neither. Stub them so the module loads under jest.
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-123" } }),
}));
jest.mock("../../services/creatorAccount", () => ({
  updateCreatorAccount: jest.fn(),
}));

import { isTimeoutError } from "../../utils/withTimeout";
import { fetchCreatorAccount } from "../useCreatorAccount";

beforeEach(() => {
  jest.useFakeTimers();
  abortSignalSpy.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("fetchCreatorAccount settle-guarantee (ORCH-1248 Apple 2.1a)", () => {
  test("a never-resolving read REJECTS within the timeout (no infinite pending)", async () => {
    let caught: unknown;
    let settled = false;
    const p = fetchCreatorAccount("user-123").then(
      () => {
        settled = true;
        throw new Error("should not resolve — the read never settles");
      },
      (e: unknown) => {
        settled = true;
        caught = e;
      },
    );

    // Before the deadline the query is still pending (would be the spinner).
    await jest.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    // Past the ~9s deadline it MUST settle to a timeout rejection.
    await jest.advanceTimersByTimeAsync(10000);
    await p;

    expect(settled).toBe(true);
    expect(isTimeoutError(caught)).toBe(true);
  });

  test("passes an AbortController signal to the supabase request", async () => {
    // Fire-and-forget: we only assert the signal was wired, then let it time out.
    const p = fetchCreatorAccount("user-123").catch(() => undefined);
    expect(abortSignalSpy).toHaveBeenCalledTimes(1);
    const [signal] = abortSignalSpy.mock.calls[0] as [AbortSignal];
    expect(signal).toBeInstanceOf(AbortSignal);
    await jest.advanceTimersByTimeAsync(10000);
    await p;
  });
});
