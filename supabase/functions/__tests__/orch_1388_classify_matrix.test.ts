// ORCH-1388 [checkout-session honest expiry] — implementor unit matrix over the
// PURE decision partition in reconcile-stuck-checkouts/classify.ts
// (SPEC_ORCH-1388_CHECKOUT_SESSION_HONEST_EXPIRY.md §4.2b + §7 T-1..T-11).
//
// Run locally (from repo root):
//   deno test supabase/functions/__tests__/orch_1388_classify_matrix.test.ts
//
// fails-on-revert: reverting the ORCH-1388 fix deletes classify.ts entirely —
// the import below fails → every test in this file goes red.
//
// Append-only: NEW file; no existing test modified.

import { assertEquals } from "jsr:@std/assert@1";

import {
  classify,
  classifyRef,
  NEVER_EXPIRE_PI_STATUSES,
  NO_CHARGE_PI_STATUSES,
  type RefClass,
  type StripeTruth,
  type SweepAction,
} from "../reconcile-stuck-checkouts/classify.ts";

// ── Fixed clock ───────────────────────────────────────────────────────────────
const NOW = "2026-07-17T12:00:00.000Z";
const PAST = "2026-06-27T12:00:00.000Z"; // weeks past expiry (the real 5 rows)
const FUTURE = "2026-07-17T12:10:00.000Z"; // in-window
const EPS_PAST = "2026-07-17T11:59:59.999Z"; // expires_at ε BEFORE now → past
const EPS_FUTURE = "2026-07-17T12:00:00.001Z"; // expires_at ε AFTER now → in-window

function act(
  refClass: RefClass,
  expiresAt: string | null,
  truth: StripeTruth,
): SweepAction {
  return classify({ refClass, expiresAt, truth, nowIso: NOW });
}

// ── Ref classification (SPEC §4.2b table 1) ──────────────────────────────────
Deno.test("ref: pi_-prefixed PI column → STRIPE_PI", () => {
  assertEquals(
    classifyRef({
      stripePaymentIntentId: "pi_3RxAbCdEfGh123",
      stripeCheckoutSessionId: null,
    }),
    "STRIPE_PI",
  );
});

Deno.test("ref: non-null NON-pi_ PI column (mingla_* Paystack reference) → PAYSTACK", () => {
  assertEquals(
    classifyRef({
      stripePaymentIntentId: "mingla_9bfcaaf8_k3j2h1",
      stripeCheckoutSessionId: null,
    }),
    "PAYSTACK",
  );
  // Even alongside a CS id, the non-Stripe PI-column ref wins the order —
  // it must never be treated as retrievable.
  assertEquals(
    classifyRef({
      stripePaymentIntentId: "mingla_abc_def",
      stripeCheckoutSessionId: "cs_test_123",
    }),
    "PAYSTACK",
  );
});

Deno.test("ref: PI null + CS non-null (web arm) → STRIPE_CS", () => {
  assertEquals(
    classifyRef({
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_live_a1b2c3",
    }),
    "STRIPE_CS",
  );
});

Deno.test("ref: all ref columns null (pending_free / pre-mint requires_payment) → NO_REF", () => {
  assertEquals(
    classifyRef({ stripePaymentIntentId: null, stripeCheckoutSessionId: null }),
    "NO_REF",
  );
});

// ── T-1: abandoned native session — the production bug shape ────────────────
Deno.test("T-1: past-expiry STRIPE_PI requires_payment_method → EXPIRE", () => {
  assertEquals(
    act("STRIPE_PI", PAST, { piStatus: "requires_payment_method" }),
    { action: "expire" },
  );
});

// ── T-2: webhook-lost paid session — finalize regardless of expiry ──────────
Deno.test("T-2: PI succeeded → FINALIZE at ANY expiry (past, future) — SC-3 behavior preserved", () => {
  for (const expiresAt of [PAST, FUTURE, EPS_PAST, EPS_FUTURE]) {
    assertEquals(
      act("STRIPE_PI", expiresAt, { piStatus: "succeeded" }),
      { action: "finalize" },
      `succeeded must finalize with expires_at=${expiresAt} — the pre-1388 branch must not change`,
    );
  }
});

// ── T-3: protect set at the expiry boundary — never expire mid-payment ──────
Deno.test("T-3: processing / requires_action / requires_capture NEVER expire, at expires_at ± ε and weeks past (SC-4)", () => {
  for (const piStatus of NEVER_EXPIRE_PI_STATUSES) {
    for (const expiresAt of [PAST, EPS_PAST, EPS_FUTURE, FUTURE]) {
      assertEquals(
        act("STRIPE_PI", expiresAt, { piStatus }),
        { action: "skip", reason: `pi_status_${piStatus}` },
        `${piStatus} @ ${expiresAt}: Stripe says a charge may still complete / money is authorized — expiring here could strand real money`,
      );
    }
  }
});

// ── T-4: declined-then-abandoned — declined moves no money ───────────────────
Deno.test("T-4: requires_payment_method expires past-expiry — a prior DECLINED attempt does not block (partition takes no charge input; Stripe's state machine already encodes 'no money moved')", () => {
  // classify() deliberately has NO latest_charge input: per the Stripe state
  // machine a PI holding only a failed charge stays requires_payment_method,
  // which is in the no-charge partition → expiry is correct.
  assertEquals(
    act("STRIPE_PI", PAST, { piStatus: "requires_payment_method" }),
    { action: "expire" },
  );
});

// ── T-5: in-window abandoned-looking rows are untouchable ────────────────────
Deno.test("T-5: in-window requires_payment_method → SKIP in_window (SC-6; ε-before-expiry included — tester angle T-A1)", () => {
  for (const expiresAt of [FUTURE, EPS_FUTURE]) {
    assertEquals(
      act("STRIPE_PI", expiresAt, { piStatus: "requires_payment_method" }),
      { action: "skip", reason: "in_window" },
      `in-window row @ ${expiresAt} must never be mutated by the expiry branch`,
    );
  }
});

Deno.test("no-charge partition: requires_confirmation and canceled expire past-expiry, skip in-window", () => {
  for (const piStatus of NO_CHARGE_PI_STATUSES) {
    assertEquals(
      act("STRIPE_PI", PAST, { piStatus }),
      { action: "expire" },
      `${piStatus}: Stripe guarantees no successful or in-flight charge — past-expiry expiry is safe`,
    );
    assertEquals(
      act("STRIPE_PI", FUTURE, { piStatus }),
      { action: "skip", reason: "in_window" },
    );
  }
});

// ── T-6: web abandoned — unpaid CS, no PI ────────────────────────────────────
Deno.test("T-6: past-expiry STRIPE_CS payment_status=unpaid (no PI) → EXPIRE (SC-7)", () => {
  assertEquals(
    act("STRIPE_CS", PAST, { csPaymentStatus: "unpaid" }),
    { action: "expire" },
  );
  assertEquals(
    act("STRIPE_CS", FUTURE, { csPaymentStatus: "unpaid" }),
    { action: "skip", reason: "in_window" },
  );
});

// ── T-7: web paid, webhook lost — resolved PI truth governs ─────────────────
Deno.test("T-7: STRIPE_CS with resolved PI falls through to the PI partition (SC-7)", () => {
  // succeeded → finalize (with THAT PI id — index.ts passes the resolved id).
  assertEquals(
    act("STRIPE_CS", PAST, { piStatus: "succeeded" }),
    { action: "finalize" },
  );
  // resolved-but-unpaid PI → expire past-expiry.
  assertEquals(
    act("STRIPE_CS", PAST, { piStatus: "requires_payment_method" }),
    { action: "expire" },
  );
  // resolved mid-flight PI → protect set holds through the CS route too.
  assertEquals(
    act("STRIPE_CS", PAST, { piStatus: "processing" }),
    { action: "skip", reason: "pi_status_processing" },
  );
});

// ── T-8: web paid with NO resolvable PI — never expire, surface it ──────────
Deno.test("T-8: CS payment_status=paid/no_payment_required with no PI → SKIP cs_paid_no_pi even past expiry (money may have moved)", () => {
  for (const csPaymentStatus of ["paid", "no_payment_required"]) {
    for (const expiresAt of [PAST, FUTURE]) {
      assertEquals(
        act("STRIPE_CS", expiresAt, { csPaymentStatus }),
        { action: "skip", reason: "cs_paid_no_pi" },
        `${csPaymentStatus} @ ${expiresAt}: expiring a possibly-paid session could hide real money — human review instead`,
      );
    }
  }
});

// ── T-9: Paystack refs are unverifiable — never expired ─────────────────────
Deno.test("T-9: PAYSTACK → SKIP paystack_unverified at any expiry (SC-8; ref never sent to Stripe — enforced structurally by classifyRef + index I/O routing)", () => {
  for (const expiresAt of [PAST, FUTURE]) {
    assertEquals(
      act("PAYSTACK", expiresAt, {}),
      { action: "skip", reason: "paystack_unverified" },
    );
  }
});

// ── T-10: no-ref strands — no payment object, no money possible ─────────────
Deno.test("T-10: past-expiry NO_REF → EXPIRE; in-window → SKIP (SC-9)", () => {
  assertEquals(act("NO_REF", PAST, {}), { action: "expire" });
  assertEquals(act("NO_REF", EPS_PAST, {}), { action: "expire" });
  assertEquals(
    act("NO_REF", FUTURE, {}),
    { action: "skip", reason: "in_window" },
  );
});

// ── T-11: unknown / future PI statuses — fail-safe, never expire ────────────
Deno.test("T-11: unknown PI status past-expiry → SKIP pi_status_<status> (fail-safe: never expire on unrecognized truth)", () => {
  assertEquals(
    act("STRIPE_PI", PAST, { piStatus: "some_future_api_status" }),
    { action: "skip", reason: "pi_status_some_future_api_status" },
  );
  // Missing PI truth on a Stripe-PI row is equally unverifiable.
  assertEquals(
    act("STRIPE_PI", PAST, {}),
    { action: "skip", reason: "pi_status_unknown" },
  );
  // Unknown CS truth likewise.
  assertEquals(
    act("STRIPE_CS", PAST, { csPaymentStatus: "weird_new_value" }),
    { action: "skip", reason: "cs_status_weird_new_value" },
  );
  assertEquals(
    act("STRIPE_CS", PAST, {}),
    { action: "skip", reason: "cs_status_unknown" },
  );
});

// ── Fail-safe clock/expiry inputs ────────────────────────────────────────────
Deno.test("fail-safe: NULL or unparseable expires_at can never be past-expiry (mirrors the CAS .lt where NULL never matches)", () => {
  assertEquals(
    act("NO_REF", null, {}),
    { action: "skip", reason: "in_window" },
  );
  assertEquals(
    act("NO_REF", "not-a-timestamp", {}),
    { action: "skip", reason: "in_window" },
  );
  assertEquals(
    act("STRIPE_PI", null, { piStatus: "requires_payment_method" }),
    { action: "skip", reason: "in_window" },
  );
});

// ── Protect-set membership is exactly the SPEC's (guards against edits) ─────
Deno.test("protect set is exactly {processing, requires_action, requires_capture} and no-charge set exactly {requires_payment_method, requires_confirmation, canceled} (SPEC §4.2b — narrowing either set changes money-safety)", () => {
  assertEquals(
    [...NEVER_EXPIRE_PI_STATUSES].sort(),
    ["processing", "requires_action", "requires_capture"],
  );
  assertEquals(
    [...NO_CHARGE_PI_STATUSES].sort(),
    ["canceled", "requires_confirmation", "requires_payment_method"],
  );
});
