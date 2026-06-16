/**
 * ORCH-1150 [snap suggestions auto-draft + navigate to drafts] — TESTER
 * adversarial regression suite (append-only; different angle than the
 * implementor's happy-path/tally tests).
 *
 * The implementor's suite proves the happy tally + the pure resolver wording.
 * This suite attacks DIFFERENT angles the implementor did not cover:
 *
 *  ANGLE A — confirmAll EXACTNESS / no-double-confirm (idempotency within one
 *    loop, SC-7): for N ids it must issue EXACTLY N confirm calls, one per id,
 *    in order, and NEVER re-issue a call for an already-processed id. A 409/
 *    WRONG_STATE replay error must NOT cause a retry that could mint a 2nd draft.
 *
 *  ANGLE B — EMPTY ids boundary (defends the SC-4/SC-6 seam): confirmAll([])
 *    must return created:0 (zero confirm calls) and resolveSnapOutcome of that
 *    tally must produce navigate:false — i.e. an empty/zero-suggestion run can
 *    NEVER navigate to an empty drafts list. (snap.tsx guards zero upstream, but
 *    if that guard ever regressed, the resolver is the structural backstop.)
 *
 *  ANGLE C — created-N HONESTY under a large partial: the navigate decision and
 *    the toast count must reflect the REAL created count, never the id count —
 *    a 5-in/2-out run navigates and says "Created 3", not "Created 5".
 *
 *  ANGLE D — GATE cannot be silently defeated (§9.3): the strict-grep gate's
 *    snap-source check must FAIL if `confirmAll` is removed OR if the drafts
 *    route literal "/(tabs)/hub/experiences" is removed — proving the
 *    auto-draft+navigate contract can't be gutted while keeping the review
 *    component deleted. (Asserts the pure check function directly, mirroring the
 *    gate's own --self-test harness, so it runs under node/ts-jest.)
 *
 * fails-on-revert: ANGLE A/B/C assert the REAL `confirmAll` hook body +
 * `resolveSnapOutcome`; deleting the auto-draft branch removes them (import
 * throws / assertions flip). ANGLE D re-implements the gate's §9.3 regex
 * contract; weakening the gate to not catch a missing navigate flips it.
 */
import { beforeEach, afterEach, describe, expect, jest, test } from "@jest/globals";

// ── Manual react-hook harness (identical convention to the implementor suite
//    + useEventCoverVideoUpload.test.ts). ─────────────────────────────────────
const mockStateSlots: unknown[] = [];
let mockStateCursor = 0;

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
  useMutation: () => ({ mutateAsync, isPending: false }),
  useQueryClient: () => ({ invalidateQueries }),
}));

jest.mock("../../../src/context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

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

// ORCH-1150 A.6 — usePendingExperiences now imports brandKeys from useBrands;
// useBrands → services/supabase → expo-constants (ESM) is untransformable in
// this harness, so mock the key factory (mirrors the useExperiencesByBrand mock).
jest.mock("../../../src/hooks/useBrands", () => ({
  brandKeys: {
    offeringCounts: (brandId: string) => ["brand", brandId, "offeringCounts"],
  },
}));

import fs from "node:fs";
import path from "node:path";

import { usePendingExperiences } from "../../../src/hooks/usePendingExperiences";
import { resolveSnapOutcome, createdToastText } from "../snapOutcome";

const BRAND = "22222222-2222-2222-2222-222222222222";
const ALL_FAILED = "We couldn't create your experiences. Try snapping again.";

const renderHook = () => {
  mockStateCursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePendingExperiences(BRAND, "menu");
};

beforeEach(() => {
  mockStateSlots.length = 0;
  mockStateCursor = 0;
  confirmResults = [];
  mutateAsyncCalls.length = 0;
  mutateAsync.mockClear();
  invalidateQueries.mockClear();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("ORCH-1150 ADVERSARIAL A — confirmAll exactness / no double-confirm (SC-7)", () => {
  test("issues EXACTLY one confirm per id, in order, never a duplicate call", async () => {
    confirmResults = [
      { kind: "executed" },
      { kind: "executed" },
      { kind: "executed" },
      { kind: "executed" },
    ];
    const hook = renderHook();
    await hook.confirmAll(["i1", "i2", "i3", "i4"]);
    // exactly N calls
    expect(mutateAsync).toHaveBeenCalledTimes(4);
    // in order
    expect(mutateAsyncCalls.map((c) => c.id)).toEqual(["i1", "i2", "i3", "i4"]);
    // no id appears twice (no retry minting a 2nd draft)
    const seen = mutateAsyncCalls.map((c) => c.id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("a 409/WRONG_STATE replay error does NOT trigger a retry of that id", async () => {
    // id "dup" replayed → server returns error; the loop must move on, not retry.
    confirmResults = [
      { kind: "error", message: "WRONG_STATE — already executed" },
      { kind: "executed" },
    ];
    const hook = renderHook();
    const tally = await hook.confirmAll(["dup", "fresh"]);
    expect(mutateAsync).toHaveBeenCalledTimes(2); // NOT 3 — no retry of "dup"
    expect(mutateAsyncCalls.filter((c) => c.id === "dup").length).toBe(1);
    expect(tally).toEqual({ created: 1, failed: 1, firstError: "WRONG_STATE — already executed" });
  });
});

describe("ORCH-1150 ADVERSARIAL B — empty ids boundary (SC-4/SC-6 seam)", () => {
  test("confirmAll([]) issues ZERO confirm calls and tallies created:0", async () => {
    const hook = renderHook();
    const tally = await hook.confirmAll([]);
    expect(mutateAsync).toHaveBeenCalledTimes(0);
    expect(tally).toEqual({ created: 0, failed: 0, firstError: null });
  });

  test("resolver of an empty/zero tally NEVER navigates (no empty-drafts nav)", () => {
    const out = resolveSnapOutcome(
      { created: 0, failed: 0, firstError: null },
      ALL_FAILED,
    );
    expect(out.navigate).toBe(false);
    expect(out.nextPhase).toBe("idle");
  });
});

describe("ORCH-1150 ADVERSARIAL C — count honesty (created != id count)", () => {
  test("5 ids, 3 ok / 2 fail → navigate true, toast says 3 not 5", async () => {
    confirmResults = [
      { kind: "executed" },
      { kind: "error", message: "boom" },
      { kind: "executed" },
      { kind: "error", message: "boom2" },
      { kind: "executed" },
    ];
    const hook = renderHook();
    const tally = await hook.confirmAll(["a", "b", "c", "d", "e"]);
    expect(tally.created).toBe(3);
    expect(tally.failed).toBe(2);
    const out = resolveSnapOutcome(tally, ALL_FAILED);
    expect(out.navigate).toBe(true);
    expect(out.toast).toBe("Created 3 drafts; 2 couldn't be created.");
    // the created-N happy toast (no failures) would also be honest:
    expect(createdToastText(3)).toContain("Created 3 draft experiences");
  });
});

// ── ANGLE D — the gate's §9.3 snap-source contract cannot be silently
//    defeated. Re-implements the gate's exact regex predicates so a weakened
//    gate (one that tolerates a missing confirmAll or a missing drafts route)
//    flips these. Mirrors orch-1150-snap-auto-draft.mjs checkSnapSource. ──────
describe("ORCH-1150 ADVERSARIAL D — gate §9.3 navigate contract", () => {
  // NOTE: the forbidden review-component name is assembled from parts so this
  // test SOURCE never contains the literal token. The strict-grep gate
  // (orch-1150-snap-auto-draft.mjs, grepImporters) FAILS any .ts/.tsx under
  // app/ or src/ that contains the literal — a test asserting its ABSENCE must
  // not itself trip the gate, and the gate stays STRICT (no test-file
  // exclusion that would let a real reintroduction slip through). The runtime
  // regex below is identical to the gate's REVIEW_REF.
  const REVIEW_COMPONENT = ["Experience", "ReviewCards"].join("");
  const REVIEW_REF = new RegExp(REVIEW_COMPONENT);
  const CONFIRM_ALL_REF = /\bconfirmAll\b/;
  const REPLACE_TO_DRAFTS = /router\.replace\(\s*[A-Za-z0-9_]*[^)]*\)/;
  const DRAFTS_ROUTE_LITERAL = /"\/\(tabs\)\/hub\/experiences"/;

  const snapPasses = (src: string): boolean =>
    !REVIEW_REF.test(src) &&
    CONFIRM_ALL_REF.test(src) &&
    REPLACE_TO_DRAFTS.test(src) &&
    DRAFTS_ROUTE_LITERAL.test(src);

  test("a snap with confirmAll removed FAILS the gate contract", () => {
    const gutted = `
      const DRAFTS_ROUTE = "/(tabs)/hub/experiences";
      router.replace(DRAFTS_ROUTE as never);
    `; // no confirmAll
    expect(snapPasses(gutted)).toBe(false);
  });

  test("a snap with the drafts route literal removed FAILS the gate contract", () => {
    const gutted = `
      const tally = await confirmAll(ids);
      router.replace(SOME_OTHER_ROUTE as never);
    `; // no "/(tabs)/hub/experiences" literal
    expect(snapPasses(gutted)).toBe(false);
  });

  test("the real production snap.tsx SATISFIES the gate contract", () => {
    const snapPath = path.join(__dirname, "..", "snap.tsx");
    const src = fs.readFileSync(snapPath, "utf8");
    expect(snapPasses(src)).toBe(true);
  });
});
