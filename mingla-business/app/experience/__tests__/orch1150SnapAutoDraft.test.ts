/**
 * ORCH-1150 [snap suggestions auto-draft + navigate to drafts] — IMPLEMENTOR
 * happy-path + edge-case regression suite (SPEC §7 T1–T5, T9, T10).
 *
 * Two angles, both exercising REAL production logic (not source-grep):
 *
 *  (1) `usePendingExperiences.confirmAll` — the real hook body run under this
 *      repo's manual react-hook harness (mock `react`, mock react-query's
 *      mutation to a controllable confirm result, mock the service + auth). We
 *      assert the loop confirms every id, tallies created/failed honestly, and
 *      that an error/expired/throw confirm counts as `failed` not a duplicate
 *      success (T1/T3/T4/T5/T9 + idempotency).
 *
 *  (2) `resolveSnapOutcome` + `createdToastText` — the pure snap-route decision
 *      that maps a tally to (navigate? / toast / phase). Imported from the REAL
 *      snapOutcome.ts that snap.tsx consumes. We
 *      assert: created>0 → navigate + created-N toast (singular/plural, T10);
 *      partial → navigate + honest partial toast (T3/T5); all-failed → NO
 *      navigate, idle, error toast with firstError (T4/T6); zero never produces
 *      a navigate (T2 — guarded upstream; the resolver is only reached for N≥1
 *      but we assert created==0 ⇒ no nav as the structural guarantee).
 *
 * fails-on-revert: deleting the auto-draft branch in snap.tsx removes
 * `resolveSnapOutcome`/`createdToastText` (import throws) and removes
 * `confirmAll` from the hook (the hook test's mutateAsync loop assertions
 * flip). Verified in IMPLEMENTATION_ORCH-1150 §Regression Test.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// ── Manual react-hook harness (same convention as
//    useEventCoverVideoUpload.test.ts): useCallback passthrough, real useState
//    slots so the hook's `isConfirmingAll` toggle behaves. ────────────────────
const mockStateSlots: unknown[] = [];
let mockStateCursor = 0;
const resetRenderCursor = (): void => {
  mockStateCursor = 0;
};
const resetReactHarness = (): void => {
  mockStateSlots.length = 0;
  resetRenderCursor();
};

jest.mock("react", () => ({
  useCallback: (cb: unknown) => cb,
  useState: (initial: unknown) => {
    const index = mockStateCursor;
    mockStateCursor += 1;
    if (mockStateSlots[index] === undefined) {
      mockStateSlots[index] = initial;
    }
    const setState = (next: unknown): void => {
      mockStateSlots[index] =
        typeof next === "function"
          ? (next as (p: unknown) => unknown)(mockStateSlots[index])
          : next;
    };
    return [mockStateSlots[index], setState];
  },
}));

// confirm mutation result queue — each confirmAll iteration shifts one.
let confirmResults: ({ kind: string; message?: string } | Error)[] = [];
const mutateAsyncCalls: { id: string }[] = [];

const mutateAsync = jest.fn(async (args: { id: string }) => {
  mutateAsyncCalls.push(args);
  const next = confirmResults.shift();
  if (next instanceof Error) throw next;
  return next ?? { kind: "executed" };
});

const invalidateQueries = jest.fn(async () => undefined);

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: (opts: { mutationFn: unknown }) => ({
    // The hook calls confirmMutation.mutateAsync — route to our controllable mock.
    mutateAsync,
    isPending: false,
    _mutationFn: opts.mutationFn,
  }),
  useQueryClient: () => ({ invalidateQueries }),
}));

jest.mock("../../../src/context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

// Service is never hit (mutateAsync is mocked) but the import must resolve.
jest.mock("../../../src/services/experienceGenerationService", () => ({
  confirmExperienceProposal: jest.fn(),
  fetchPendingExperiencesForBrand: jest.fn(),
  parseRestaurantMenu: jest.fn(),
  rejectExperienceProposal: jest.fn(),
  parsePlayActivities: jest.fn(),
}));

jest.mock("../../../src/hooks/useExperiencesByBrand", () => ({
  experienceKeys: {
    all: ["experiences"],
    listByBrand: (brandId: string) => ["experiences", "list", brandId],
  },
}));

import { usePendingExperiences } from "../../../src/hooks/usePendingExperiences";

const BRAND = "11111111-1111-1111-1111-111111111111";

// Manual hook harness (mirrors useEventCoverVideoUpload.test.ts) — `react` is
// mocked above so this invokes the real hook body deterministically; the
// rules-of-hooks lint does not apply to a mocked-react test harness.
const renderHook = () => {
  resetRenderCursor();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePendingExperiences(BRAND, "menu");
};

beforeEach(() => {
  resetReactHarness();
  confirmResults = [];
  mutateAsyncCalls.length = 0;
  mutateAsync.mockClear();
  invalidateQueries.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("ORCH-1150 confirmAll — auto-draft-all loop (hook)", () => {
  test("T1 happy: 3 proposal ids → 3 confirms → tally created=3", async () => {
    confirmResults = [
      { kind: "executed" },
      { kind: "executed" },
      { kind: "executed" },
    ];
    const hook = renderHook();
    const tally = await hook.confirmAll(["a", "b", "c"]);
    expect(mutateAsyncCalls.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(tally).toEqual({ created: 3, failed: 0, firstError: null });
  });

  test("T3 partial: ok, error, ok → created=2 failed=1, firstError captured", async () => {
    confirmResults = [
      { kind: "executed" },
      { kind: "error", message: "Boom from server" },
      { kind: "executed" },
    ];
    const hook = renderHook();
    const tally = await hook.confirmAll(["a", "b", "c"]);
    expect(tally.created).toBe(2);
    expect(tally.failed).toBe(1);
    expect(tally.firstError).toBe("Boom from server");
  });

  test("T4 all-fail: both error → created=0, no duplicate success", async () => {
    confirmResults = [
      { kind: "error", message: "first fail" },
      { kind: "error", message: "second fail" },
    ];
    const hook = renderHook();
    const tally = await hook.confirmAll(["a", "b"]);
    expect(tally.created).toBe(0);
    expect(tally.failed).toBe(2);
    expect(tally.firstError).toBe("first fail");
  });

  test("T5 idempotency: a 409/WRONG_STATE error counts as failed, not a 2nd draft", async () => {
    confirmResults = [{ kind: "error", message: "Race detected — already handled" }];
    const hook = renderHook();
    const tally = await hook.confirmAll(["already-executed-id"]);
    expect(tally.created).toBe(0);
    expect(tally.failed).toBe(1);
  });

  test("T5b: a thrown confirm (network) counts as failed with its message", async () => {
    confirmResults = [new Error("network down")];
    const hook = renderHook();
    const tally = await hook.confirmAll(["x"]);
    expect(tally).toEqual({ created: 0, failed: 1, firstError: "network down" });
  });

  test("T5c: an expired_regenerate response counts as failed (no CTA in this flow)", async () => {
    confirmResults = [{ kind: "expired_regenerate" }];
    const hook = renderHook();
    const tally = await hook.confirmAll(["expired"]);
    expect(tally.created).toBe(0);
    expect(tally.failed).toBe(1);
    expect(tally.firstError).toBeTruthy();
  });

  test("T9 cache: invalidateExperienceList invalidates listByBrand for the brand", async () => {
    const hook = renderHook();
    await hook.invalidateExperienceList();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["experiences", "list", BRAND],
    });
  });
});

// ── (2) Pure snap-route decision (the REAL helpers snap.tsx imports). The
//    decision logic lives in snapOutcome.ts (a pure module, no JSX/RN) exactly
//    so it can be imported + asserted under this node/ts-jest harness. snap.tsx
//    imports `resolveSnapOutcome` from here, so a revert that removes the
//    auto-draft branch breaks this import + the snap-route compile. ───────────
import { createdToastText, resolveSnapOutcome } from "../snapOutcome";

describe("ORCH-1150 resolveSnapOutcome + createdToastText (pure route logic)", () => {
  const ALL_FAILED = "We couldn't create your experiences. Try snapping again.";

  test("T10 copy: singular vs plural", () => {
    expect(createdToastText(1)).toBe(
      "Created 1 draft experience — add stops, a date and price to publish.",
    );
    expect(createdToastText(3)).toBe(
      "Created 3 draft experiences — add stops, a date and price to publish.",
    );
  });

  test("T1 created>0 (all ok) → navigate + created-N toast", () => {
    const out = resolveSnapOutcome(
      { created: 3, failed: 0, firstError: null },
      ALL_FAILED,
    );
    expect(out.navigate).toBe(true);
    expect(out.toast).toBe(createdToastText(3));
  });

  test("T5/T3 partial → navigate + honest partial toast (no silent loss)", () => {
    const out = resolveSnapOutcome(
      { created: 2, failed: 1, firstError: "x" },
      ALL_FAILED,
    );
    expect(out.navigate).toBe(true);
    expect(out.toast).toBe("Created 2 drafts; 1 couldn't be created.");
  });

  test("partial singular wording (created==1, some failed)", () => {
    const out = resolveSnapOutcome(
      { created: 1, failed: 2, firstError: "x" },
      ALL_FAILED,
    );
    expect(out.toast).toBe("Created 1 draft; 2 couldn't be created.");
  });

  test("T4/T6 all-failed → NO navigate, idle, error toast with firstError", () => {
    const out = resolveSnapOutcome(
      { created: 0, failed: 2, firstError: "stripe boom" },
      ALL_FAILED,
    );
    expect(out.navigate).toBe(false);
    expect(out.nextPhase).toBe("idle");
    expect(out.toast).toBe(`${ALL_FAILED} stripe boom`);
  });

  test("all-failed with no firstError → bare all-failed toast", () => {
    const out = resolveSnapOutcome(
      { created: 0, failed: 1, firstError: null },
      ALL_FAILED,
    );
    expect(out.navigate).toBe(false);
    expect(out.toast).toBe(ALL_FAILED);
  });
});
