/**
 * issue #3351 [free trip intake loop] — IMPLEMENTOR happy-path suite.
 *
 * The defect: a free trip carrying ANY intake question could never be booked.
 * `buyer.tsx` pushed to /intake whenever a schema EXISTED; `intake.tsx`
 * replaced back to /buyer whenever the cart was FREE; neither screen ever
 * recorded "the questions are answered now", so the deciding predicate was
 * byte-identical before and after the form was filled. Runtime proof in the
 * investigation: three laps of /buyer → /intake → /buyer, ZERO
 * `ticket-checkout-create` requests, no error shown. Underneath that the free
 * request never carried the answers, and the server's resulting
 * `400 intake_form_required` rendered "Your ticket may already be reserved" —
 * the duplicate-booking wording #2511/#2462 exist to prevent.
 *
 * The behavioural half of this suite (T-1…T-4, T-6, T-7) EXECUTES real code:
 * both §4 modules are pure and import-free by contract, so they run under the
 * default node/ts-jest config with no module mock, and `checkoutErrorCopy`
 * imports nothing either. The source-contract half (T-5, T-8, T-9, T-10) is
 * deliberately the weaker half and is stated as such — a source assertion can
 * be satisfied by code that does not work. Comments are stripped before every
 * source match so prose mentioning a token can never satisfy an assertion.
 *
 * Determinism: no timers, no network, no `Date.now()`, no shared module state.
 *
 * Seth's OQ-2 decision (2026-09-21) binds T-10: finishing the last form does
 * NOT submit the reservation. The traveller returns to the details step with an
 * enabled Reserve button and taps it. There is therefore no auto-finalise path
 * and no single-use finalise token, and T-10 asserts their ABSENCE.
 */

import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  nextTripCheckoutStep,
  tripIntakeFormDataArray,
  tripIntakeState,
  type TripStepDecision,
  type TripStepOrigin,
} from "../tripCheckoutStepOrder";
import {
  tripFunnelTotalSteps,
  tripPaymentStepIndex,
} from "../tripFunnelSteps";
import {
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_CONFLICT_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE,
  FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  FREE_RESERVATION_ALREADY_EXISTS_TOKEN,
  freeCheckoutErrorMessage,
} from "../../../../src/services/checkoutErrorCopy";

// ---------------------------------------------------------------------------
// Source-reading helpers (the weaker half)
// ---------------------------------------------------------------------------

const ROUTE_DIR = join(__dirname, "..");
const readRoute = (file: string): string =>
  readFileSync(join(ROUTE_DIR, file), "utf8");
const readSrc = (relative: string): string =>
  readFileSync(join(__dirname, "..", "..", "..", "..", "src", relative), "utf8");
/** Strip comments so a commented-out line can never satisfy an assertion. */
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TIER_A = "ticket-type-trip-free";
const TIER_B = "ticket-type-trip-second";
const VERSION_1 = "11111111-1111-4111-8111-111111111111";
const VERSION_2 = "22222222-2222-4222-8222-222222222222";

const line = (ticketTypeId: string): { ticketTypeId: string } => ({
  ticketTypeId,
});

/** One required short_text question — the filed bug's schema. */
const requiredSchema = {
  schema_version_id: VERSION_1,
  questions: [{ id: "q1", type: "short_text", required: true }],
};
/** One OPTIONAL question — the variant the narrow reading of the bug misses. */
const optionalOnlySchema = {
  schema_version_id: VERSION_1,
  questions: [{ id: "q1", type: "short_text", required: false }],
};
const emptySchema = { schema_version_id: VERSION_1, questions: [] };

const committedAt = (
  ticketTypeId: string,
  schemaVersionId: string,
): Record<string, unknown> => ({
  [ticketTypeId]: {
    ticket_type_id: ticketTypeId,
    schema_version_id: schemaVersionId,
    answers: { q1: "Jane Doe" },
  },
});

// ===========================================================================
// T-1 — the exhaustive decision table (EXECUTES real code)
// ===========================================================================

describe("T-1 issue #3351 — nextTripCheckoutStep is total over all 32 inputs", () => {
  /**
   * Every expected value is written out by hand, NEVER recomputed from the
   * implementation, so a wrong implementation cannot agree with itself.
   */
  const TABLE: ReadonlyArray<{
    from: TripStepOrigin;
    isFree: boolean;
    settled: boolean;
    hasIntake: boolean;
    intakeComplete: boolean;
    expected: TripStepDecision;
  }> = [
    // ---- from "details", schema read NOT settled → never decide ----
    { from: "details", isFree: false, settled: false, hasIntake: false, intakeComplete: false, expected: "wait" },
    { from: "details", isFree: false, settled: false, hasIntake: false, intakeComplete: true, expected: "wait" },
    { from: "details", isFree: false, settled: false, hasIntake: true, intakeComplete: false, expected: "wait" },
    { from: "details", isFree: false, settled: false, hasIntake: true, intakeComplete: true, expected: "wait" },
    { from: "details", isFree: true, settled: false, hasIntake: false, intakeComplete: false, expected: "wait" },
    { from: "details", isFree: true, settled: false, hasIntake: false, intakeComplete: true, expected: "wait" },
    { from: "details", isFree: true, settled: false, hasIntake: true, intakeComplete: false, expected: "wait" },
    { from: "details", isFree: true, settled: false, hasIntake: true, intakeComplete: true, expected: "wait" },
    // ---- from "details", settled, PAID ----
    { from: "details", isFree: false, settled: true, hasIntake: false, intakeComplete: false, expected: "go_payment" },
    { from: "details", isFree: false, settled: true, hasIntake: false, intakeComplete: true, expected: "go_payment" },
    { from: "details", isFree: false, settled: true, hasIntake: true, intakeComplete: false, expected: "go_intake" },
    // SC-9: answers already committed at the current version → straight to pay.
    { from: "details", isFree: false, settled: true, hasIntake: true, intakeComplete: true, expected: "go_payment" },
    // ---- from "details", settled, FREE ----
    { from: "details", isFree: true, settled: true, hasIntake: false, intakeComplete: false, expected: "submit_free" },
    { from: "details", isFree: true, settled: true, hasIntake: false, intakeComplete: true, expected: "submit_free" },
    // The defect's state: questions exist and are unanswered → open the form,
    // and NO request is issued.
    { from: "details", isFree: true, settled: true, hasIntake: true, intakeComplete: false, expected: "go_intake" },
    // The state the old predicate could never reach: answered → RESERVE.
    { from: "details", isFree: true, settled: true, hasIntake: true, intakeComplete: true, expected: "submit_free" },
    // ---- from "intake", schema read NOT settled ----
    { from: "intake", isFree: false, settled: false, hasIntake: false, intakeComplete: false, expected: "wait" },
    { from: "intake", isFree: false, settled: false, hasIntake: false, intakeComplete: true, expected: "wait" },
    { from: "intake", isFree: false, settled: false, hasIntake: true, intakeComplete: false, expected: "wait" },
    { from: "intake", isFree: false, settled: false, hasIntake: true, intakeComplete: true, expected: "wait" },
    { from: "intake", isFree: true, settled: false, hasIntake: false, intakeComplete: false, expected: "wait" },
    { from: "intake", isFree: true, settled: false, hasIntake: false, intakeComplete: true, expected: "wait" },
    { from: "intake", isFree: true, settled: false, hasIntake: true, intakeComplete: false, expected: "wait" },
    { from: "intake", isFree: true, settled: false, hasIntake: true, intakeComplete: true, expected: "wait" },
    // ---- from "intake", settled. These rows IGNORE intakeComplete on
    // purpose: the commit that just happened has not landed in the intake
    // screen's closure, so a completion read there is stale by one commit. ----
    { from: "intake", isFree: false, settled: true, hasIntake: false, intakeComplete: false, expected: "go_payment" },
    { from: "intake", isFree: false, settled: true, hasIntake: false, intakeComplete: true, expected: "go_payment" },
    { from: "intake", isFree: false, settled: true, hasIntake: true, intakeComplete: false, expected: "go_payment" },
    { from: "intake", isFree: false, settled: true, hasIntake: true, intakeComplete: true, expected: "go_payment" },
    { from: "intake", isFree: true, settled: true, hasIntake: false, intakeComplete: false, expected: "go_details_finalize" },
    { from: "intake", isFree: true, settled: true, hasIntake: false, intakeComplete: true, expected: "go_details_finalize" },
    { from: "intake", isFree: true, settled: true, hasIntake: true, intakeComplete: false, expected: "go_details_finalize" },
    { from: "intake", isFree: true, settled: true, hasIntake: true, intakeComplete: true, expected: "go_details_finalize" },
  ];

  test("the table covers all 2 x 2 x 2 x 2 x 2 = 32 input combinations exactly once", () => {
    expect(TABLE).toHaveLength(32);
    const keys = new Set(
      TABLE.map(
        (row) =>
          `${row.from}|${String(row.isFree)}|${String(row.settled)}|${String(row.hasIntake)}|${String(row.intakeComplete)}`,
      ),
    );
    expect(keys.size).toBe(32);
  });

  test.each(TABLE)(
    "from=$from isFree=$isFree settled=$settled hasIntake=$hasIntake intakeComplete=$intakeComplete -> $expected",
    ({ from, isFree, settled, hasIntake, intakeComplete, expected }) => {
      expect(
        nextTripCheckoutStep(from, {
          isFree,
          settled,
          hasIntake,
          intakeComplete,
        }),
      ).toBe(expected);
    },
  );

  test("a FREE cart is never sent to the payment step, from either screen", () => {
    for (const row of TABLE) {
      if (!row.isFree) continue;
      expect(
        nextTripCheckoutStep(row.from, {
          isFree: row.isFree,
          settled: row.settled,
          hasIntake: row.hasIntake,
          intakeComplete: row.intakeComplete,
        }),
      ).not.toBe("go_payment");
    }
  });

  test("no decision is ever issued while the schema read is unsettled", () => {
    for (const from of ["details", "intake"] as const) {
      for (const isFree of [false, true]) {
        for (const hasIntake of [false, true]) {
          for (const intakeComplete of [false, true]) {
            expect(
              nextTripCheckoutStep(from, {
                isFree,
                settled: false,
                hasIntake,
                intakeComplete,
              }),
            ).toBe("wait");
          }
        }
      }
    }
  });
});

// ===========================================================================
// T-2 — the termination walk (EXECUTES real code; this is the loop proof)
// ===========================================================================

describe("T-2 issue #3351 — the free-with-intake journey terminates", () => {
  /**
   * Walk the journey the way the traveller does. `committed` starts empty; when
   * the decision is "go_intake" the intake screen is simulated — it commits the
   * answers and then asks for its own exit — and the walk returns to the details
   * screen. The walk must reach "submit_free", must do so in at most 3 hops, and
   * must never revisit a state.
   *
   * Under the pre-#3351 predicate (intake PRESENCE) this walk never terminates:
   * the details screen's answer is "go_intake" forever, because committing the
   * answers changes nothing it reads.
   */
  const walk = (
    schema: { schema_version_id: string; questions: readonly unknown[] },
  ): { hops: string[]; final: TripStepDecision } => {
    const lines = [line(TIER_A)];
    const schemas = new Map([[TIER_A, schema]]);
    let committed: Record<string, unknown> = {};
    const hops: string[] = [];
    const seen = new Set<string>();

    for (let hop = 0; hop < 12; hop += 1) {
      const state = tripIntakeState({ lines, schemas, committed });
      const key = `details|${String(state.hasIntake)}|${String(state.intakeComplete)}`;
      if (seen.has(key)) {
        throw new Error(`state revisited on the details screen: ${key}`);
      }
      seen.add(key);

      const decision = nextTripCheckoutStep("details", {
        isFree: true,
        ...state,
      });
      hops.push(decision);
      if (decision === "submit_free") return { hops, final: decision };
      if (decision !== "go_intake") {
        throw new Error(`unexpected decision on the free rail: ${decision}`);
      }

      // The intake screen: commit the tier's answers, then ask for the exit.
      // The commit has NOT landed in this closure, which is why the "intake"
      // rows ignore intakeComplete.
      const staleState = tripIntakeState({ lines, schemas, committed });
      const exit = nextTripCheckoutStep("intake", {
        isFree: true,
        ...staleState,
      });
      hops.push(exit);
      expect(exit).toBe("go_details_finalize");
      committed = committedAt(TIER_A, schema.schema_version_id);
    }
    throw new Error("the walk did not terminate within 12 hops");
  };

  test("a schema with one REQUIRED question reaches submit_free in at most 3 hops", () => {
    const { hops, final } = walk(requiredSchema);
    expect(final).toBe("submit_free");
    expect(hops).toEqual(["go_intake", "go_details_finalize", "submit_free"]);
    expect(hops.length).toBeLessThanOrEqual(3);
  });

  test("a schema whose only question is OPTIONAL terminates identically (F-4)", () => {
    const { hops, final } = walk(optionalOnlySchema);
    expect(final).toBe("submit_free");
    expect(hops).toEqual(["go_intake", "go_details_finalize", "submit_free"]);
    expect(hops.length).toBeLessThanOrEqual(3);
  });

  test("the details screen asks for the form exactly ONCE per cart state", () => {
    for (const schema of [requiredSchema, optionalOnlySchema]) {
      const { hops } = walk(schema);
      expect(hops.filter((h) => h === "go_intake")).toHaveLength(1);
    }
  });
});

// ===========================================================================
// T-3 — the completion predicate (EXECUTES real code)
// ===========================================================================

describe("T-3 issue #3351 — tripIntakeState keys on completion, not presence", () => {
  test("an unresolved schema read settles nothing and claims nothing", () => {
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas: undefined,
        committed: committedAt(TIER_A, VERSION_1),
      }),
    ).toEqual({ settled: false, hasIntake: false, intakeComplete: false });
  });

  test("no schema'd tier -> hasIntake false, and complete vacuously", () => {
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas: new Map(),
        committed: {},
      }),
    ).toEqual({ settled: true, hasIntake: false, intakeComplete: true });
  });

  test("a schema with ZERO questions is not a schema'd tier", () => {
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas: new Map([[TIER_A, emptySchema]]),
        committed: {},
      }),
    ).toEqual({ settled: true, hasIntake: false, intakeComplete: true });
  });

  test("a schema'd tier with nothing committed is NOT complete", () => {
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas: new Map([[TIER_A, requiredSchema]]),
        committed: {},
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: false });
  });

  test("a committed entry at a DIFFERENT schema_version_id is NOT complete", () => {
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas: new Map([[TIER_A, requiredSchema]]),
        committed: committedAt(TIER_A, VERSION_2),
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: false });
  });

  test("a committed entry at the MATCHING version is complete", () => {
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas: new Map([[TIER_A, requiredSchema]]),
        committed: committedAt(TIER_A, VERSION_1),
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: true });
  });

  test("an OPTIONAL-only schema behaves exactly like a required one", () => {
    const schemas = new Map([[TIER_A, optionalOnlySchema]]);
    expect(
      tripIntakeState({ lines: [line(TIER_A)], schemas, committed: {} }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: false });
    expect(
      tripIntakeState({
        lines: [line(TIER_A)],
        schemas,
        committed: committedAt(TIER_A, VERSION_1),
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: true });
  });

  test("two schema'd tiers with only one committed are NOT complete", () => {
    const schemas = new Map([
      [TIER_A, requiredSchema],
      [TIER_B, requiredSchema],
    ]);
    expect(
      tripIntakeState({
        lines: [line(TIER_A), line(TIER_B)],
        schemas,
        committed: committedAt(TIER_A, VERSION_1),
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: false });
    expect(
      tripIntakeState({
        lines: [line(TIER_A), line(TIER_B)],
        schemas,
        committed: {
          ...committedAt(TIER_A, VERSION_1),
          ...committedAt(TIER_B, VERSION_1),
        },
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: true });
  });

  test("a committed entry that is not an object, or carries no version, is not completion", () => {
    const schemas = new Map([[TIER_A, requiredSchema]]);
    for (const bogus of [null, undefined, "yes", 7, {}, { schema_version_id: 1 }]) {
      expect(
        tripIntakeState({
          lines: [line(TIER_A)],
          schemas,
          committed: { [TIER_A]: bogus },
        }).intakeComplete,
      ).toBe(false);
    }
  });

  test("a duplicate cart line for one tier does not change the answer", () => {
    const schemas = new Map([[TIER_A, requiredSchema]]);
    expect(
      tripIntakeState({
        lines: [line(TIER_A), line(TIER_A)],
        schemas,
        committed: committedAt(TIER_A, VERSION_1),
      }),
    ).toEqual({ settled: true, hasIntake: true, intakeComplete: true });
  });
});

// ===========================================================================
// T-4 — the counter arithmetic (EXECUTES real code)
// ===========================================================================

describe("T-4 issue #3351 — the visible step total is honest in all four variants", () => {
  const VARIANTS: ReadonlyArray<{
    isFree: boolean;
    hasIntake: boolean;
    total: 2 | 3 | 4;
  }> = [
    { isFree: true, hasIntake: false, total: 2 },
    { isFree: true, hasIntake: true, total: 3 },
    { isFree: false, hasIntake: false, total: 3 },
    { isFree: false, hasIntake: true, total: 4 },
  ];

  test.each(VARIANTS)(
    "isFree=$isFree hasIntake=$hasIntake -> $total steps",
    ({ isFree, hasIntake, total }) => {
      expect(tripFunnelTotalSteps({ isFree, hasIntake })).toBe(total);
    },
  );

  test("the last-step index is total - 1 in every variant", () => {
    for (const { isFree, hasIntake } of VARIANTS) {
      expect(tripPaymentStepIndex({ isFree, hasIntake })).toBe(
        tripFunnelTotalSteps({ isFree, hasIntake }) - 1,
      );
    }
  });

  test("the total never depends on whether the questions are answered yet", () => {
    // The denominator takes no intakeComplete input at all, which is the
    // structural reason it cannot move mid-flow (R-27).
    for (const { isFree, hasIntake, total } of VARIANTS) {
      expect(tripFunnelTotalSteps({ isFree, hasIntake })).toBe(total);
      expect(tripFunnelTotalSteps({ hasIntake, isFree })).toBe(total);
    }
  });
});

// ===========================================================================
// T-6 — the one flattener (EXECUTES real code)
// ===========================================================================

describe("T-6 issue #3351 — tripIntakeFormDataArray is the one flattener", () => {
  /** An inline reimplementation of payment.tsx's pre-#3351 loop. */
  const legacyFlatten = (
    committed: Readonly<Record<string, unknown>>,
  ): unknown[] => {
    const out: unknown[] = [];
    for (const ticketTypeId of Object.keys(committed)) {
      const entry = committed[ticketTypeId];
      if (entry !== undefined && entry !== null) out.push(entry);
    }
    return out;
  };

  test("it equals the legacy loop for a cart where every entry matches a line", () => {
    const committed = {
      ...committedAt(TIER_A, VERSION_1),
      ...committedAt(TIER_B, VERSION_1),
    };
    const lines = [line(TIER_A), line(TIER_B)];
    expect(tripIntakeFormDataArray(committed, lines)).toEqual(
      legacyFlatten(committed),
    );
  });

  test("it keeps Object.keys order", () => {
    const committed = {
      ...committedAt(TIER_B, VERSION_1),
      ...committedAt(TIER_A, VERSION_1),
    };
    const out = tripIntakeFormDataArray(committed, [
      line(TIER_A),
      line(TIER_B),
    ]);
    expect(out).toHaveLength(2);
    expect((out[0] as { ticket_type_id: string }).ticket_type_id).toBe(TIER_B);
    expect((out[1] as { ticket_type_id: string }).ticket_type_id).toBe(TIER_A);
  });

  test("it drops undefined and null entries", () => {
    const out = tripIntakeFormDataArray(
      { ...committedAt(TIER_A, VERSION_1), [TIER_B]: null },
      [line(TIER_A), line(TIER_B)],
    );
    expect(out).toHaveLength(1);
  });

  test("it restricts the entries to tiers actually in the cart", () => {
    const out = tripIntakeFormDataArray(
      {
        ...committedAt(TIER_A, VERSION_1),
        ...committedAt(TIER_B, VERSION_1),
      },
      [line(TIER_A)],
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { ticket_type_id: string }).ticket_type_id).toBe(TIER_A);
  });

  test("an empty answer map flattens to an empty array (so the wire key is omitted)", () => {
    expect(tripIntakeFormDataArray({}, [line(TIER_A)])).toEqual([]);
  });

  test("the committed entries pass through untouched — the server matches on their own keys", () => {
    const entry = {
      ticket_type_id: TIER_A,
      schema_version_id: VERSION_1,
      answers: { q1: "Jane Doe" },
    };
    const out = tripIntakeFormDataArray({ [TIER_A]: entry }, [line(TIER_A)]);
    expect(out[0]).toBe(entry);
    expect(out[0]).toEqual({
      ticket_type_id: TIER_A,
      schema_version_id: VERSION_1,
      answers: { q1: "Jane Doe" },
    });
  });
});

// ===========================================================================
// T-7 — honest refusal copy (EXECUTES the real mapper)
// ===========================================================================

describe("T-7 issue #3351 — intake_form_required no longer implies a duplicate", () => {
  const refusalWithCode = (code: string, status: number): Error =>
    Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      { code, status },
    );

  test("the server's 400 token maps to the honest sentence", () => {
    expect(
      freeCheckoutErrorMessage(refusalWithCode("intake_form_required", 400)),
    ).toBe(FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE);
  });

  test("the bare token inside .message maps to the same sentence", () => {
    expect(freeCheckoutErrorMessage(new Error("intake_form_required"))).toBe(
      FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE,
    );
  });

  test("it never says a ticket may already be reserved, and is not the unknown arm", () => {
    const message = freeCheckoutErrorMessage(
      refusalWithCode("intake_form_required", 400),
    );
    expect(message).not.toContain("may already be reserved");
    expect(message).not.toBe(FREE_CHECKOUT_UNKNOWN_MESSAGE);
    expect(message.toLowerCase()).toContain("nothing was reserved");
  });

  test("the sentence is in the module's declared codomain", () => {
    expect(FREE_CHECKOUT_MESSAGES).toContain(
      FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE,
    );
  });

  test("it is distinct from every other sentence the module can return", () => {
    const others = FREE_CHECKOUT_MESSAGES.filter(
      (m) => m !== FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE,
    );
    expect(others).not.toContain(FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE);
    expect(new Set(FREE_CHECKOUT_MESSAGES).size).toBe(
      FREE_CHECKOUT_MESSAGES.length,
    );
  });

  test("every token already in the map still returns exactly what it returned before", () => {
    const unchanged: ReadonlyArray<[string, string]> = [
      [FREE_RESERVATION_ALREADY_EXISTS_TOKEN, FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE],
      ["checkout_unavailable", FREE_CHECKOUT_UNAVAILABLE_MESSAGE],
      ["checkout_session_failed", FREE_CHECKOUT_FAILED_MESSAGE],
      ["checkout_finalize_failed", FREE_CHECKOUT_CONFLICT_MESSAGE],
      ["intake_schema_stale", FREE_CHECKOUT_INTAKE_STALE_MESSAGE],
    ];
    for (const [token, expected] of unchanged) {
      expect(freeCheckoutErrorMessage(refusalWithCode(token, 409))).toBe(
        expected,
      );
      expect(freeCheckoutErrorMessage(new Error(token))).toBe(expected);
    }
  });

  test("an unidentified failure still gets the unknown arm, unchanged", () => {
    expect(freeCheckoutErrorMessage(new Error("socket hang up"))).toBe(
      FREE_CHECKOUT_UNKNOWN_MESSAGE,
    );
  });
});

// ===========================================================================
// T-5 / T-8 / T-9 / T-10 — SOURCE CONTRACTS (the weaker half, stated as such)
// ===========================================================================

describe("T-5 issue #3351 — no literal denominator survives, and the frozen shapes hold", () => {
  const index = strip(readRoute("index.tsx"));
  const buyer = strip(readRoute("buyer.tsx"));
  const intake = strip(readRoute("intake.tsx"));
  const payment = strip(readRoute("payment.tsx"));

  test("the intake pill's literal free/paid ternary is gone", () => {
    expect(intake).not.toMatch(/totals\.isFree \? 3 : 4/);
    expect(intake).toMatch(/3 OF \{tripFunnelTotalSteps\(/);
  });

  test("no rendered step TOTAL is a literal on this route", () => {
    for (const src of [index, buyer, intake, payment]) {
      expect(src).not.toMatch(/totalSteps=\{2\}/);
      expect(src).not.toMatch(/totalSteps=\{3\}/);
      expect(src).not.toMatch(/totalSteps=\{4\}/);
    }
  });

  test("all four pill-bearing files derive their total from the owner", () => {
    for (const src of [index, buyer, intake, payment]) {
      expect(src).toMatch(/tripFunnelTotalSteps\(/);
    }
  });

  /**
   * R-2a. Three UNAUTHORISED suites assert this exact source text:
   * orch_1176_funnel_wiring.test.ts, TripPaymentChoice_orch_1130_regression.test.ts
   * and orch_0915_pay_in_full_choice{,_adversarial}. Asserting the same shapes
   * here means a future edit that breaks one of them fails in THIS file, with
   * this explanation, instead of appearing as a mystery red elsewhere.
   */
  test("R-2a the exact single-name tripFunnelSteps import survives in index.tsx and buyer.tsx", () => {
    for (const src of [index, buyer]) {
      expect(src).toContain(
        'import { tripFunnelTotalSteps } from "./tripFunnelSteps"',
      );
    }
  });

  test("R-2a payment.tsx keeps its two-name import of tripFunnelSteps", () => {
    expect(payment).toMatch(/tripFunnelTotalSteps,\s*tripPaymentStepIndex,/);
  });

  test("R-2a the const assignment shape and the literal step INDICES survive", () => {
    for (const src of [index, buyer, payment]) {
      expect(src).toMatch(/const totalSteps = tripFunnelTotalSteps\(/);
      expect(src).toContain("totalSteps={totalSteps}");
    }
    expect(index).toContain("stepIndex={0}");
    expect(buyer).toContain("stepIndex={1}");
    expect(payment).toMatch(/paymentStepIndex = tripPaymentStepIndex\(/);
    expect(payment).toContain("stepIndex={paymentStepIndex}");
  });

  test("R-2a payment.tsx keeps the local name intakeFormDataArray outside the selector region", () => {
    expect(payment).toContain("const intakeFormDataArray");
    const selector = payment.slice(
      payment.indexOf("<TripPaymentChoice"),
      payment.indexOf("<TripPaymentChoice") +
        payment.slice(payment.indexOf("<TripPaymentChoice")).indexOf("/>"),
    );
    expect(selector.length).toBeGreaterThan(0);
    expect(selector).not.toContain("intakeFormDataArray");
  });

  test("no screen holds a second hand-rolled predicate over the schema query", () => {
    for (const src of [index, buyer, intake, payment]) {
      expect(src).not.toMatch(/schema\.questions\.length > 0\) return true/);
    }
    for (const src of [index, buyer, payment]) {
      expect(src).toMatch(/tripIntakeState\(/);
    }
  });
});

describe("T-8 issue #3351 — the free rail has ONE call site and renders only mapped copy", () => {
  const buyer = strip(readRoute("buyer.tsx"));

  test("createTicketCheckout appears exactly once in buyer.tsx's body", () => {
    expect(countOf(buyer, "createTicketCheckout(")).toBe(1);
  });

  test("that call carries the traveller's answers, conditionally", () => {
    expect(buyer).toContain(
      "...(intakeArray.length > 0 ? { intakeFormData: intakeArray } : {})",
    );
    expect(buyer).toMatch(/tripIntakeFormDataArray\(intakeFormData, lines\)/);
  });

  test("the catch arm renders mapped copy only", () => {
    expect(buyer).toContain("freeCheckoutErrorMessage(");
    expect(buyer).toContain("FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE");
  });

  test("no raw error text can reach the traveller on this route", () => {
    expect(buyer).not.toContain("error.message");
    expect(buyer).not.toContain("String(error)");
    expect(buyer).not.toContain("${error");
  });

  test("the failed-schema-read refusal is a named sentence and keeps the rail closed", () => {
    expect(buyer).toContain("INTAKE_SCHEMA_UNAVAILABLE_MESSAGE");
    expect(buyer).toContain("nothing was reserved");
    expect(buyer).toMatch(/!intakeState\.settled/);
  });

  test("handleContinue switches on the owner's decision and pushes nowhere else", () => {
    expect(buyer).toMatch(/switch \(detailsDecision\)/);
    expect(buyer).not.toContain("hasAnyIntakeSchema");
    expect(countOf(buyer, "/intake` as never")).toBe(1);
  });
});

describe("T-9 issue #3351 — the intake screen cannot send a free cart to payment", () => {
  const intake = strip(readRoute("intake.tsx"));

  test("every navigation to /payment sits behind a go_payment decision", () => {
    const navigations = intake.match(/router\.(push|replace)\([^)]*payment[^)]*\)/g) ?? [];
    expect(navigations.length).toBeGreaterThan(0);
    for (const navigation of navigations) {
      const at = intake.indexOf(navigation);
      const window = intake.slice(Math.max(0, at - 260), at);
      expect(window).toContain('=== "go_payment"');
    }
  });

  test("no isFree test in the file navigates to /payment", () => {
    expect(intake).not.toMatch(/totals\.isFree\)?\s*\{\s*router\.(push|replace)\([^)]*payment/);
  });

  test("the last-tier exit and the defensive bounce both ask the owner", () => {
    expect(countOf(intake, 'nextTripCheckoutStep("intake"')).toBe(2);
    expect(intake).toContain('=== "go_details_finalize"');
  });

  test("the plan-disclosure gate's literals survive untouched", () => {
    expect(intake).toContain("InstallmentScheduleDisplay");
    expect(intake).toContain("installmentSchedule");
  });
});

describe("T-10 issue #3351 — nothing reserves without a buyer tap (Seth's OQ-2 decision)", () => {
  const buyer = strip(readRoute("buyer.tsx"));
  const cartContext = strip(readSrc(join("components", "checkout", "CartContext.tsx")));

  test("no auto-finalise token exists anywhere", () => {
    expect(buyer).not.toContain("pendingFreeFinalize");
    expect(cartContext).not.toContain("pendingFreeFinalize");
    expect(cartContext).not.toContain("SET_PENDING_FREE_FINALIZE");
  });

  test("the free reservation runner is invoked from exactly one place", () => {
    expect(countOf(buyer, "runFreeReservation(")).toBe(1);
    expect(buyer).toContain("await runFreeReservation();");
  });

  test("no effect in the file can fire the reservation", () => {
    const effects = buyer.split("useEffect(");
    expect(effects.length).toBeGreaterThan(1);
    for (const effect of effects.slice(1)) {
      // Bound the window to THIS effect's body: it ends at its dependency
      // array (`}, [`) or, for a dep-less effect, at its closing `});`.
      const ends = [effect.indexOf("}, ["), effect.indexOf("});")].filter(
        (i) => i >= 0,
      );
      const body = ends.length > 0 ? effect.slice(0, Math.min(...ends)) : effect;
      expect(body).not.toContain("runFreeReservation");
      expect(body).not.toContain("createTicketCheckout");
    }
  });

  test("the single-shot ref is cleared ONLY inside the catch", () => {
    expect(countOf(buyer, "freeReservationFiredRef.current = false")).toBe(1);
    const cleared = buyer.indexOf("freeReservationFiredRef.current = false");
    const caught = buyer.indexOf("} catch (error) {");
    const settled = buyer.indexOf("} finally {");
    expect(caught).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(caught);
    expect(cleared).toBeLessThan(settled);
  });

  test("the cart's frozen literals survive (two strict-grep gates need them)", () => {
    expect(cartContext).toContain('paymentPlanChoice: "full"');
    expect(cartContext).toContain("paymentPlanChoice: TripPaymentPlanChoice");
    expect(cartContext).toContain("marketingOptIn: false");
    expect(cartContext).toContain("SET_PAYMENT_PLAN_CHOICE");
  });
});
