/**
 * issue #3351 [free trip intake loop] — TESTER ADVERSARIAL SUITE.
 *
 * A DIFFERENT ANGLE from the implementor's happy-path suite
 * (`issue_3351_free_trip_intake_reaches_reservation.implementor.test.ts`), which
 * restates the decision table row by row, walks ONE single-tier journey with
 * `intakeComplete` flipped by hand, and spends four of its ten blocks on source
 * regexes.
 *
 * This suite never restates the table and never reads a source file. It builds a
 * CART SPACE — every combination of one to three tiers, each carrying no schema,
 * an empty schema, a required-question schema or an optional-only schema, free
 * and paid, resolved and unresolved — and then SIMULATES the two real screens
 * over it, deriving the intake facts with the real `tripIntakeState` from a real
 * committed map at every hop, exactly as `buyer.tsx` and `intake.tsx` do. The
 * loop claim is proved as termination plus no-revisited-state over that whole
 * space, not as an example.
 *
 * It also carries the negative control the implementor's suite cannot: the
 * PRE-FIX presence predicate, reimplemented inline, is driven through the same
 * walk and must DIVERGE. That gives this file teeth against the actual defect
 * independently of whether anyone reverts a particular line of `buyer.tsx`.
 *
 * Determinism: no timers, no network, no `Date.now()`, no shared module state —
 * the required `mingla-business jest (full suite)` gate is known to be
 * nondeterministic under contention, so nothing here may add to that.
 *
 * Seth's OQ-2 decision (2026-09-21) is honoured: finishing the last form returns
 * the buyer to the DETAILS step and they tap Reserve. There is no auto-finalise
 * decision to test and none is asserted.
 */

import { describe, expect, test } from "@jest/globals";

import {
  nextTripCheckoutStep,
  tripIntakeFormDataArray,
  tripIntakeState,
  type TripStepCartLine,
  type TripStepDecision,
  type TripStepSchema,
} from "../tripCheckoutStepOrder";
import {
  tripFunnelTotalSteps,
  tripPaymentStepIndex,
} from "../tripFunnelSteps";
import {
  FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  freeCheckoutErrorMessage,
} from "../../../../src/services/checkoutErrorCopy";

// ---------------------------------------------------------------------------
// The cart space
// ---------------------------------------------------------------------------

type TierKind = "no_schema" | "empty_schema" | "required" | "optional";

const TIER_KINDS: readonly TierKind[] = [
  "no_schema",
  "empty_schema",
  "required",
  "optional",
];

const versionOf = (ticketTypeId: string): string => `ver-${ticketTypeId}-001`;

const schemaFor = (
  ticketTypeId: string,
  kind: TierKind,
): TripStepSchema | null => {
  if (kind === "no_schema") return null;
  if (kind === "empty_schema") {
    return { questions: [], schema_version_id: versionOf(ticketTypeId) };
  }
  return {
    questions: [
      {
        id: `q-${ticketTypeId}`,
        type: "short_text",
        required: kind === "required",
      },
    ],
    schema_version_id: versionOf(ticketTypeId),
  };
};

interface Cart {
  /** A human-readable name for the failure message. */
  readonly name: string;
  readonly lines: readonly TripStepCartLine[];
  readonly schemas: ReadonlyMap<string, TripStepSchema>;
  /** The tiers whose answers the intake screen would ask for. */
  readonly schemaTierIds: readonly string[];
}

const buildCart = (kinds: readonly TierKind[], duplicateFirst: boolean): Cart => {
  const ids = kinds.map((_, i) => `tt-${i}`);
  const schemas = new Map<string, TripStepSchema>();
  const schemaTierIds: string[] = [];
  kinds.forEach((kind, i) => {
    const schema = schemaFor(ids[i], kind);
    if (schema !== null) schemas.set(ids[i], schema);
    if (kind === "required" || kind === "optional") schemaTierIds.push(ids[i]);
  });
  const lines: TripStepCartLine[] = ids.map((id) => ({ ticketTypeId: id }));
  // A duplicate cart line for the first tier is a real runtime shape (two
  // lines can carry the same ticketTypeId) and must not change any answer.
  if (duplicateFirst && ids.length > 0) {
    lines.push({ ticketTypeId: ids[0] });
  }
  return {
    name: `[${kinds.join(",")}]${duplicateFirst ? "+dup" : ""}`,
    lines,
    schemas,
    schemaTierIds,
  };
};

/** Every cart of 1, 2 or 3 tiers over the four tier kinds, with and without a duplicate line. */
const CARTS: readonly Cart[] = (() => {
  const out: Cart[] = [];
  for (const dup of [false, true]) {
    for (const a of TIER_KINDS) {
      out.push(buildCart([a], dup));
      for (const b of TIER_KINDS) {
        out.push(buildCart([a, b], dup));
        for (const c of TIER_KINDS) out.push(buildCart([a, b, c], dup));
      }
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// The simulator — the two real screens, driven by the real functions
// ---------------------------------------------------------------------------

/**
 * What `intake.tsx` commits: for the tier it is showing, `setIntakeTierData`
 * writes `{ ticket_type_id, schema_version_id, answers }` at the tier's CURRENT
 * version. The screen walks its tiers one Continue at a time and only the last
 * one asks the step owner where to go, so a full visit commits every schema'd
 * tier in the cart.
 */
const commitAllSchemaTiers = (
  cart: Cart,
  committed: Record<string, unknown>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...committed };
  for (const id of cart.schemaTierIds) {
    next[id] = {
      ticket_type_id: id,
      schema_version_id: versionOf(id),
      answers: { [`q-${id}`]: "answered" },
    };
  }
  return next;
};

interface WalkResult {
  readonly decisions: readonly TripStepDecision[];
  readonly terminal: TripStepDecision;
  readonly hops: number;
  readonly revisited: string | null;
  readonly intakeVisits: number;
}

/**
 * Walk the funnel from the details step until it reaches a decision that leaves
 * the funnel (`submit_free`, `go_payment`) or refuses to move (`wait`).
 *
 * `predicate` is the completion source under test, so the same walk can be run
 * against the shipped owner AND against the pre-fix presence predicate.
 */
const walk = (
  cart: Cart,
  isFree: boolean,
  schemasResolved: boolean,
  predicate: (
    cart: Cart,
    committed: Record<string, unknown>,
    resolved: boolean,
  ) => { settled: boolean; hasIntake: boolean; intakeComplete: boolean },
  hopCap = 12,
): WalkResult => {
  let committed: Record<string, unknown> = {};
  let where: "details" | "intake" = "details";
  const decisions: TripStepDecision[] = [];
  const seen = new Set<string>();
  let intakeVisits = 0;

  for (let hop = 0; hop < hopCap; hop += 1) {
    const facts = predicate(cart, committed, schemasResolved);
    // The state a screen can be in is (which screen, what the cart holds). If
    // the walk ever sees the same one twice it is the #3351 loop.
    const stateKey = `${where}|${JSON.stringify(Object.keys(committed).sort())}|${JSON.stringify(facts)}`;
    if (seen.has(stateKey)) {
      return {
        decisions,
        terminal: decisions[decisions.length - 1] ?? "wait",
        hops: hop,
        revisited: stateKey,
        intakeVisits,
      };
    }
    seen.add(stateKey);

    const decision = nextTripCheckoutStep(where, { isFree, ...facts });
    decisions.push(decision);

    if (decision === "submit_free" || decision === "go_payment" || decision === "wait") {
      return { decisions, terminal: decision, hops: hop + 1, revisited: null, intakeVisits };
    }
    if (decision === "go_intake") {
      intakeVisits += 1;
      committed = commitAllSchemaTiers(cart, committed);
      where = "intake";
      continue;
    }
    // "go_details_finalize"
    where = "details";
  }
  return {
    decisions,
    terminal: decisions[decisions.length - 1] ?? "wait",
    hops: hopCap,
    revisited: "HOP CAP REACHED",
    intakeVisits,
  };
};

/** The shipped owner. */
const shippedPredicate = (
  cart: Cart,
  committed: Record<string, unknown>,
  resolved: boolean,
): { settled: boolean; hasIntake: boolean; intakeComplete: boolean } =>
  tripIntakeState({
    lines: cart.lines,
    schemas: resolved ? cart.schemas : undefined,
    committed,
  });

/**
 * THE PRE-FIX PREDICATE, reimplemented from `buyer.tsx:253-260` as it stood at
 * origin/main before #3351: intake PRESENCE, with the cart's committed answers
 * never read. `intakeComplete` is reported as `!hasIntake` because the old code
 * had no notion of completion at all — the details step routed to /intake purely
 * on presence, and the intake step bounced back purely on `isFree`.
 */
const preFixPresencePredicate = (
  cart: Cart,
  _committed: Record<string, unknown>,
  resolved: boolean,
): { settled: boolean; hasIntake: boolean; intakeComplete: boolean } => {
  if (!resolved) return { settled: true, hasIntake: false, intakeComplete: true };
  let hasIntake = false;
  for (const line of cart.lines) {
    const schema = cart.schemas.get(line.ticketTypeId);
    if (schema !== undefined && schema.questions.length > 0) hasIntake = true;
  }
  return { settled: true, hasIntake, intakeComplete: !hasIntake };
};

// ---------------------------------------------------------------------------
// A-1 — termination over the whole cart space
// ---------------------------------------------------------------------------

describe("A-1 issue #3351 — every cart in the space leaves the funnel, and no state repeats", () => {
  test("the cart space is broad enough to matter", () => {
    // 2 duplicate-line variants x (4 + 16 + 64) tier shapes.
    expect(CARTS.length).toBe(168);
    expect(CARTS.some((c) => c.schemaTierIds.length === 3)).toBe(true);
    expect(CARTS.some((c) => c.schemaTierIds.length === 0)).toBe(true);
    expect(CARTS.some((c) => c.lines.length === 4)).toBe(true);
  });

  test("a resolved schema read always terminates, in at most 3 decisions, with no repeat", () => {
    const failures: string[] = [];
    for (const cart of CARTS) {
      for (const isFree of [true, false]) {
        const r = walk(cart, isFree, true, shippedPredicate);
        if (r.revisited !== null) {
          failures.push(`${cart.name} isFree=${isFree} REVISITED ${r.revisited}`);
          continue;
        }
        if (r.terminal === "wait") {
          failures.push(`${cart.name} isFree=${isFree} refused to move on a RESOLVED read`);
          continue;
        }
        if (r.decisions.length > 3) {
          failures.push(`${cart.name} isFree=${isFree} took ${r.decisions.length} decisions: ${r.decisions.join("->")}`);
        }
        if (r.intakeVisits > 1) {
          failures.push(`${cart.name} isFree=${isFree} asked for the form ${r.intakeVisits} times`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("a cart that carries questions is asked for them exactly once, then leaves", () => {
    const failures: string[] = [];
    for (const cart of CARTS) {
      const wantsForm = cart.schemaTierIds.length > 0;
      for (const isFree of [true, false]) {
        const r = walk(cart, isFree, true, shippedPredicate);
        const expectedVisits = wantsForm ? 1 : 0;
        if (r.intakeVisits !== expectedVisits) {
          failures.push(`${cart.name} isFree=${isFree} intakeVisits=${r.intakeVisits} expected=${expectedVisits}`);
        }
        const expectedTerminal = isFree ? "submit_free" : "go_payment";
        if (r.terminal !== expectedTerminal) {
          failures.push(`${cart.name} isFree=${isFree} terminal=${r.terminal} expected=${expectedTerminal}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("an UNRESOLVED schema read stops the funnel dead — it never guesses and never submits", () => {
    for (const cart of CARTS) {
      for (const isFree of [true, false]) {
        const r = walk(cart, isFree, false, shippedPredicate);
        expect(r.terminal).toBe("wait");
        expect(r.decisions).toEqual(["wait"]);
        expect(r.intakeVisits).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A-2 — the negative control: the pre-fix predicate must NOT terminate
// ---------------------------------------------------------------------------

describe("A-2 issue #3351 — the pre-fix presence predicate loops forever on the same space", () => {
  test("every FREE cart carrying any question diverges under the old predicate", () => {
    const looped: string[] = [];
    const escaped: string[] = [];
    for (const cart of CARTS) {
      if (cart.schemaTierIds.length === 0) continue;
      const r = walk(cart, true, true, preFixPresencePredicate);
      if (r.revisited === null) escaped.push(`${cart.name} terminated at ${r.terminal}`);
      else looped.push(cart.name);
    }
    // Every free cart with questions must be in the looping set. If this list
    // is ever empty the walk has stopped modelling the defect and A-1 proves
    // nothing.
    expect(escaped).toEqual([]);
    expect(looped.length).toBeGreaterThan(0);
  });

  test("the old predicate is blind to the answers — the very fact that made it loop", () => {
    const cart = buildCart(["required"], false);
    const empty = preFixPresencePredicate(cart, {}, true);
    const answered = preFixPresencePredicate(cart, commitAllSchemaTiers(cart, {}), true);
    expect(answered).toEqual(empty);

    // The shipped owner is NOT blind, which is the whole fix.
    const ownerEmpty = shippedPredicate(cart, {}, true);
    const ownerAnswered = shippedPredicate(cart, commitAllSchemaTiers(cart, {}), true);
    expect(ownerEmpty.intakeComplete).toBe(false);
    expect(ownerAnswered.intakeComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A-3 — partial completion cannot finalise
// ---------------------------------------------------------------------------

describe("A-3 issue #3351 — a partly answered multi-tier cart cannot reach the reservation", () => {
  const cart = buildCart(["required", "optional", "empty_schema"], false);

  test("the empty-question tier is not part of the ask", () => {
    expect(cart.schemaTierIds).toEqual(["tt-0", "tt-1"]);
  });

  test("committing only the first schema'd tier keeps the buyer on the form", () => {
    const partial = {
      "tt-0": {
        ticket_type_id: "tt-0",
        schema_version_id: versionOf("tt-0"),
        answers: { "q-tt-0": "x" },
      },
    };
    const facts = shippedPredicate(cart, partial, true);
    expect(facts).toEqual({ settled: true, hasIntake: true, intakeComplete: false });
    expect(nextTripCheckoutStep("details", { isFree: true, ...facts })).toBe("go_intake");
    expect(nextTripCheckoutStep("details", { isFree: false, ...facts })).toBe("go_intake");
  });

  test("committing the last one flips it, for free and for paid alike", () => {
    const full = commitAllSchemaTiers(cart, {});
    const facts = shippedPredicate(cart, full, true);
    expect(facts).toEqual({ settled: true, hasIntake: true, intakeComplete: true });
    expect(nextTripCheckoutStep("details", { isFree: true, ...facts })).toBe("submit_free");
    expect(nextTripCheckoutStep("details", { isFree: false, ...facts })).toBe("go_payment");
  });

  test("a tier that leaves the cart after being answered stops being required", () => {
    const answeredBoth = commitAllSchemaTiers(cart, {});
    // The buyer went back to the cart step and removed tt-1.
    const smaller: Cart = {
      ...cart,
      name: "dropped tt-1",
      lines: [{ ticketTypeId: "tt-0" }, { ticketTypeId: "tt-2" }],
    };
    const facts = shippedPredicate(smaller, answeredBoth, true);
    expect(facts.intakeComplete).toBe(true);
    expect(nextTripCheckoutStep("details", { isFree: true, ...facts })).toBe("submit_free");
    // And the orphaned answer set must not ride the request.
    expect(tripIntakeFormDataArray(answeredBoth, smaller.lines)).toEqual([
      answeredBoth["tt-0"],
    ]);
  });

  test("a tier that JOINS the cart after the others were answered re-opens the form", () => {
    const answeredFirstOnly = {
      "tt-0": {
        ticket_type_id: "tt-0",
        schema_version_id: versionOf("tt-0"),
        answers: { "q-tt-0": "x" },
      },
    };
    const facts = shippedPredicate(cart, answeredFirstOnly, true);
    expect(facts.intakeComplete).toBe(false);
    expect(nextTripCheckoutStep("details", { isFree: true, ...facts })).toBe("go_intake");
    // And the walk from there still terminates in one visit.
    const r = walk(cart, true, true, shippedPredicate);
    expect(r.terminal).toBe("submit_free");
    expect(r.intakeVisits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A-4 — hostile committed maps
// ---------------------------------------------------------------------------

describe("A-4 issue #3351 — nothing but a real answer set at the current version is completion", () => {
  const cart = buildCart(["required"], false);
  const goodVersion = versionOf("tt-0");

  const notCompletion: ReadonlyArray<readonly [string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 7],
    ["zero", 0],
    ["an empty string", ""],
    ["the version as a bare string", goodVersion],
    ["true", true],
    ["an empty object", {}],
    ["an array", []],
    ["an array carrying the version", [goodVersion]],
    ["a numeric version", { schema_version_id: 1 }],
    ["a null version", { schema_version_id: null }],
    ["an object version", { schema_version_id: { id: goodVersion } }],
    ["a version-shaped array", { schema_version_id: [goodVersion] }],
    ["a stale version", { schema_version_id: "ver-tt-0-000" }],
    ["a version with trailing space", { schema_version_id: `${goodVersion} ` }],
    ["a case-shifted version", { schema_version_id: goodVersion.toUpperCase() }],
    ["a version that merely contains the right one", { schema_version_id: `x${goodVersion}x` }],
  ];

  test.each(notCompletion)("%s is not completion", (_label, entry) => {
    const facts = shippedPredicate(cart, { "tt-0": entry }, true);
    expect(facts.hasIntake).toBe(true);
    expect(facts.intakeComplete).toBe(false);
    expect(nextTripCheckoutStep("details", { isFree: true, ...facts })).toBe("go_intake");
  });

  test("an answer set carrying the exact current version IS completion, even with no answers key", () => {
    const facts = shippedPredicate(cart, { "tt-0": { schema_version_id: goodVersion } }, true);
    expect(facts.intakeComplete).toBe(true);
  });

  test("a prototype key cannot be mistaken for a tier's answer set", () => {
    // `{}["__proto__"]` and `{}["constructor"]` are truthy objects on every
    // ordinary record, so a completion read that used `committed[id]` without
    // an own-property check would report a tier named `__proto__` as answered.
    const protoCart: Cart = {
      name: "proto",
      lines: [{ ticketTypeId: "__proto__" }, { ticketTypeId: "constructor" }],
      schemas: new Map<string, TripStepSchema>([
        ["__proto__", { questions: [{}], schema_version_id: "v-proto" }],
        ["constructor", { questions: [{}], schema_version_id: "v-ctor" }],
      ]),
      schemaTierIds: ["__proto__", "constructor"],
    };
    const facts = shippedPredicate(protoCart, {}, true);
    expect(facts.hasIntake).toBe(true);
    expect(facts.intakeComplete).toBe(false);
    expect(nextTripCheckoutStep("details", { isFree: true, ...facts })).toBe("go_intake");
  });

  test("an answer set for a tier that is not in the cart cannot complete the cart", () => {
    const facts = shippedPredicate(
      cart,
      {
        "tt-999": {
          ticket_type_id: "tt-999",
          schema_version_id: versionOf("tt-999"),
          answers: {},
        },
      },
      true,
    );
    expect(facts.intakeComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A-5 — the flattener cannot smuggle, drop or reorder
// ---------------------------------------------------------------------------

describe("A-5 issue #3351 — the one flattener sends exactly the cart's own answer sets", () => {
  const lines: TripStepCartLine[] = [
    { ticketTypeId: "tt-0" },
    { ticketTypeId: "tt-1" },
    { ticketTypeId: "tt-0" },
  ];

  test("a duplicate cart line does not duplicate the entry on the wire", () => {
    const committed = { "tt-0": { a: 1 }, "tt-1": { b: 2 } };
    expect(tripIntakeFormDataArray(committed, lines)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("an entry for a tier that left the cart is dropped, not sent", () => {
    const committed = { "tt-0": { a: 1 }, "tt-gone": { g: 9 }, "tt-1": { b: 2 } };
    expect(tripIntakeFormDataArray(committed, lines)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("insertion order is preserved, not cart order", () => {
    const committed = { "tt-1": { b: 2 }, "tt-0": { a: 1 } };
    expect(tripIntakeFormDataArray(committed, lines)).toEqual([{ b: 2 }, { a: 1 }]);
  });

  test("only undefined and null are dropped — a falsy-but-present entry still ships", () => {
    // The server matches entries by `ticket_type_id`, so silently swallowing a
    // falsy entry would hide a malformed commit instead of letting the server
    // refuse it. The contract drops exactly undefined and null.
    const committed: Record<string, unknown> = {
      "tt-0": 0,
      "tt-1": "",
    };
    expect(tripIntakeFormDataArray(committed, lines)).toEqual([0, ""]);
  });

  test("undefined and null entries are dropped", () => {
    const committed: Record<string, unknown> = {
      "tt-0": undefined,
      "tt-1": null,
    };
    expect(tripIntakeFormDataArray(committed, lines)).toEqual([]);
  });

  test("an empty cart flattens to nothing, so the wire key is omitted entirely", () => {
    expect(tripIntakeFormDataArray({ "tt-0": { a: 1 } }, [])).toEqual([]);
    expect(tripIntakeFormDataArray({}, lines)).toEqual([]);
  });

  test("a prototype-named key is not emitted for a cart that does not ask for it", () => {
    const committed: Record<string, unknown> = { "tt-0": { a: 1 } };
    expect(tripIntakeFormDataArray(committed, [{ ticketTypeId: "__proto__" }])).toEqual([]);
  });

  test("the entry object is passed through by reference — the server's keys are never rewritten", () => {
    const entry = {
      ticket_type_id: "tt-0",
      schema_version_id: versionOf("tt-0"),
      answers: { "q-tt-0": ["a", "b"] },
    };
    const out = tripIntakeFormDataArray({ "tt-0": entry }, lines);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(entry);
  });

  test("every cart in the space sends one entry per schema'd tier once answered", () => {
    const failures: string[] = [];
    for (const cart of CARTS) {
      const committed = commitAllSchemaTiers(cart, {});
      const out = tripIntakeFormDataArray(committed, cart.lines);
      if (out.length !== cart.schemaTierIds.length) {
        failures.push(`${cart.name} sent ${out.length} entries for ${cart.schemaTierIds.length} tiers`);
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A-6 — the decision is total, and a free cart can never be sent to payment
// ---------------------------------------------------------------------------

describe("A-6 issue #3351 — the decision is total and a free cart never reaches the payment step", () => {
  const DECISIONS: readonly TripStepDecision[] = [
    "wait",
    "go_intake",
    "submit_free",
    "go_payment",
    "go_details_finalize",
  ];

  test("no input can produce anything outside the five decisions", () => {
    for (const from of ["details", "intake"] as const) {
      for (const isFree of [true, false]) {
        for (const settled of [true, false]) {
          for (const hasIntake of [true, false]) {
            for (const intakeComplete of [true, false]) {
              const d = nextTripCheckoutStep(from, {
                isFree,
                settled,
                hasIntake,
                intakeComplete,
              });
              expect(DECISIONS).toContain(d);
            }
          }
        }
      }
    }
  });

  test("a garbage `from` is treated as the intake screen, never as a submit", () => {
    // `from` is typed, but a stray value must not become a reservation. Only the
    // details rows can answer "submit_free"; anything else falls to the intake
    // rows, which cannot create anything.
    const d = nextTripCheckoutStep("details_typo" as unknown as "intake", {
      isFree: true,
      settled: true,
      hasIntake: true,
      intakeComplete: true,
    });
    expect(d).not.toBe("submit_free");
    expect(DECISIONS).toContain(d);
  });

  test("SC-7 as a property: isFree true never yields go_payment, from either screen", () => {
    for (const from of ["details", "intake"] as const) {
      for (const settled of [true, false]) {
        for (const hasIntake of [true, false]) {
          for (const intakeComplete of [true, false]) {
            expect(
              nextTripCheckoutStep(from, {
                isFree: true,
                settled,
                hasIntake,
                intakeComplete,
              }),
            ).not.toBe("go_payment");
          }
        }
      }
    }
  });

  test("the intake screen can never be told to create a reservation", () => {
    for (const isFree of [true, false]) {
      for (const settled of [true, false]) {
        for (const hasIntake of [true, false]) {
          for (const intakeComplete of [true, false]) {
            expect(
              nextTripCheckoutStep("intake", { isFree, settled, hasIntake, intakeComplete }),
            ).not.toBe("submit_free");
          }
        }
      }
    }
  });

  test("nothing at all happens while the schema read is unsettled, on either screen", () => {
    for (const from of ["details", "intake"] as const) {
      for (const isFree of [true, false]) {
        for (const hasIntake of [true, false]) {
          for (const intakeComplete of [true, false]) {
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

// ---------------------------------------------------------------------------
// A-7 — the denominator cannot move while the buyer is inside one cart
// ---------------------------------------------------------------------------

describe("A-7 issue #3351 — the visible total is a function of the cart, not of progress", () => {
  test("answering the questions never changes the denominator", () => {
    for (const cart of CARTS) {
      for (const isFree of [true, false]) {
        const before = shippedPredicate(cart, {}, true);
        const after = shippedPredicate(cart, commitAllSchemaTiers(cart, {}), true);
        expect(after.hasIntake).toBe(before.hasIntake);
        expect(tripFunnelTotalSteps({ isFree, hasIntake: after.hasIntake })).toBe(
          tripFunnelTotalSteps({ isFree, hasIntake: before.hasIntake }),
        );
      }
    }
  });

  test("the last step index is one below the total in every variant", () => {
    for (const isFree of [true, false]) {
      for (const hasIntake of [true, false]) {
        expect(tripPaymentStepIndex({ isFree, hasIntake })).toBe(
          tripFunnelTotalSteps({ isFree, hasIntake }) - 1,
        );
      }
    }
  });

  test("a free funnel is always exactly one step shorter than the same paid funnel", () => {
    for (const hasIntake of [true, false]) {
      expect(tripFunnelTotalSteps({ isFree: true, hasIntake })).toBe(
        tripFunnelTotalSteps({ isFree: false, hasIntake }) - 1,
      );
    }
  });

  test("the intake step's literal numerator 3 is never above the total that shows it", () => {
    // The intake screen renders "3 OF {total}". A total below 3 on a cart that
    // reaches that screen would render "3 OF 2".
    for (const isFree of [true, false]) {
      expect(tripFunnelTotalSteps({ isFree, hasIntake: true })).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// A-8 — the refusal can never imply a reservation that was never made
// ---------------------------------------------------------------------------

describe("A-8 issue #3351 — the intake refusal is honest in every envelope shape", () => {
  const SHAPES: ReadonlyArray<readonly [string, unknown]> = [
    ["a bounded code with a 400", { code: "intake_form_required", status: 400 }],
    ["a bare token in .message", { message: "intake_form_required" }],
    [
      "the token inside a longer message",
      { message: 'Edge Function returned a non-2xx status: intake_form_required' },
    ],
    [
      "the real edge-function envelope",
      {
        status: 400,
        code: "intake_form_required",
        detail: "intake_form_required",
        message: "intake_form_required",
      },
    ],
  ];

  test.each(SHAPES)("%s maps to the honest sentence", (_label, error) => {
    expect(freeCheckoutErrorMessage(error)).toBe(FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE);
  });

  test("the sentence says nothing was reserved and never hints at a duplicate", () => {
    const s = FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE;
    expect(s.toLowerCase()).toContain("nothing was reserved");
    expect(s.toLowerCase()).not.toContain("may already be reserved");
    expect(s.toLowerCase()).not.toContain("check your email");
    expect(s).not.toBe(FREE_CHECKOUT_UNKNOWN_MESSAGE);
    // It must never render a raw token or a developer word to a traveller.
    expect(s).not.toContain("intake_form_required");
    expect(s).not.toMatch(/\b(400|409|error|null|undefined)\b/i);
  });

  test("it is reachable through the module's declared codomain", () => {
    expect(FREE_CHECKOUT_MESSAGES).toContain(FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE);
  });

  test("a different token is not silently answered with the #3351 sentence", () => {
    for (const other of [
      "intake_schema_stale",
      "free_reservation_already_exists",
      "ticket_capacity_exceeded",
      "event_not_found",
    ]) {
      expect(freeCheckoutErrorMessage({ code: other, status: 409 })).not.toBe(
        FREE_CHECKOUT_INTAKE_REQUIRED_MESSAGE,
      );
    }
  });

  test("no sentence the free rail can render is empty, and none leaks a token", () => {
    for (const message of FREE_CHECKOUT_MESSAGES) {
      expect(typeof message).toBe("string");
      expect(message.trim().length).toBeGreaterThan(0);
      expect(message).not.toMatch(/[a-z]+_[a-z_]+/);
    }
  });
});
