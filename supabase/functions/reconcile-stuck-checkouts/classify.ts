// ORCH-1388 [checkout-session honest expiry] — the PURE decision partition for
// the reconcile-stuck-checkouts sweep. NO I/O in this module: no Stripe import,
// no DB import, no Deno API. index.ts performs every retrieve/RPC/UPDATE and
// obeys the action returned here, which makes the partition unit-testable in
// isolation (supabase/functions/__tests__/orch_1388_classify_matrix.test.ts).
//
// BINDING contract: SPEC_ORCH-1388_CHECKOUT_SESSION_HONEST_EXPIRY.md §4.2b.
//   - 4-way ref classification: STRIPE_PI (`pi_`-prefixed) / PAYSTACK
//     (`mingla_*` reference stored in the SAME column — NOT a Stripe id,
//     NEVER sent to Stripe) / STRIPE_CS (web arm, PI null) / NO_REF.
//   - Exhaustive PI-status partition with a hard never-expire protect set
//     (processing / requires_action / requires_capture — money may still move).
//   - Fail-safe default: any unknown/unverifiable truth → skip, never expire.
// Seth rulings (2026-07-17, not relitigable): cutoff = the existing 15-min
// expires_at; terminal = `expired`; NO Stripe writes; a PI with any
// charge/success evidence is NEVER expired — it finalizes.

/** Which truth source (if any) governs a sweep row. */
export type RefClass = "STRIPE_PI" | "PAYSTACK" | "STRIPE_CS" | "NO_REF";

/** The two payment-reference columns on ticket_checkout_sessions. */
export interface RefColumns {
  /**
   * ticket_checkout_sessions.stripe_payment_intent_id. The Paystack arm stores
   * its `mingla_<sessionId>_<b36>` reference IN THIS COLUMN
   * (ticket-checkout-create/index.ts:707-717) — it is NOT a retrievable
   * Stripe PaymentIntent id.
   */
  stripePaymentIntentId: string | null;
  /** ticket_checkout_sessions.stripe_checkout_session_id (web hosted-Checkout arm). */
  stripeCheckoutSessionId: string | null;
}

/**
 * Classify the row's payment reference so index.ts knows which READ-ONLY
 * retrieve (if any) to perform. Order is BINDING (SPEC §4.2b): the PI column
 * first (`pi_` prefix ⇒ Stripe; anything else non-null ⇒ Paystack), then the
 * checkout-session column, then NO_REF.
 *
 * The `startsWith("pi_")` check IS the Paystack guard: a `mingla_*` reference
 * must NEVER reach a Stripe retrieve (tester angle T-A3).
 */
export function classifyRef(ref: RefColumns): RefClass {
  const piRef = ref.stripePaymentIntentId;
  if (piRef !== null && piRef !== "") {
    return piRef.startsWith("pi_") ? "STRIPE_PI" : "PAYSTACK";
  }
  const csRef = ref.stripeCheckoutSessionId;
  if (csRef !== null && csRef !== "") {
    return "STRIPE_CS";
  }
  return "NO_REF";
}

/**
 * PI statuses where Stripe's state machine says a charge may still complete or
 * money is already authorized — the never-expire PROTECT SET (SC-4). These are
 * SKIPPED even past expiry: `processing` (charge in flight), `requires_action`
 * (buyer mid-3DS), `requires_capture` (authorized funds held).
 */
export const NEVER_EXPIRE_PI_STATUSES: readonly string[] = [
  "processing",
  "requires_action",
  "requires_capture",
];

/**
 * PI statuses where Stripe's state machine GUARANTEES no successful or
 * in-flight charge exists: a succeeded charge forces `succeeded`, an in-flight
 * one `processing`, an authorized one `requires_capture`. This status
 * partition IS ruling 1's "charge/success evidence" check. A prior DECLINED
 * attempt (failed latest_charge under `requires_payment_method`) does not
 * block expiry — declined attempts move no money (SPEC T-4).
 */
export const NO_CHARGE_PI_STATUSES: readonly string[] = [
  "requires_payment_method",
  "requires_confirmation",
  "canceled",
];

/**
 * The already-retrieved Stripe truth for a row. index.ts fills exactly the
 * field the ref class calls for; classify() never triggers I/O.
 */
export interface StripeTruth {
  /**
   * PI status when a PaymentIntent was retrieved — STRIPE_PI rows, or
   * STRIPE_CS rows whose cs.payment_intent resolved to a PI id (those fall
   * through to the PI partition, SPEC §4.2b CS row 1).
   */
  piStatus?: string;
  /** cs.payment_status when the web arm's Checkout Session has NO resolvable PI. */
  csPaymentStatus?: string;
}

/** Exactly one action per row. index.ts obeys; classify() decides. */
export type SweepAction =
  | { action: "finalize" }
  | { action: "expire" }
  | { action: "skip"; reason: string };

export interface ClassifyInput {
  refClass: RefClass;
  /** ticket_checkout_sessions.expires_at (ISO timestamp; NOT NULL in schema). */
  expiresAt: string | null;
  truth: StripeTruth;
  /** Captured ONCE per sweep run in index.ts. */
  nowIso: string;
}

/**
 * Past-expiry test, fail-safe on bad input: a NULL or unparseable expires_at
 * (or now) can never be "past expiry" — mirrors the CAS write's
 * `.lt("expires_at", nowIso)` where NULL never matches.
 */
function isPastExpiry(expiresAt: string | null, nowIso: string): boolean {
  if (expiresAt === null) return false;
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(expiresMs) || Number.isNaN(nowMs)) return false;
  return expiresMs < nowMs;
}

/**
 * The PI-status partition — exhaustive over Stripe's PI state machine, with a
 * fail-safe default for any unrecognized/future status value (SPEC T-11).
 */
function classifyPiStatus(
  piStatus: string | undefined,
  pastExpiry: boolean,
): SweepAction {
  if (piStatus === undefined || piStatus === "") {
    // A Stripe-PI row must arrive with retrieved truth; without it we cannot
    // prove "genuinely unpaid" — never expire on missing truth.
    return { action: "skip", reason: "pi_status_unknown" };
  }
  if (piStatus === "succeeded") {
    // Webhook-lost paid session — FINALIZE regardless of expires_at
    // (ruling 1; the pre-ORCH-1388 behavior, preserved — SC-3).
    return { action: "finalize" };
  }
  if (NEVER_EXPIRE_PI_STATUSES.includes(piStatus)) {
    // Protect set: a charge may still complete / money is authorized —
    // never expire, even past expiry (SC-4).
    return { action: "skip", reason: `pi_status_${piStatus}` };
  }
  if (NO_CHARGE_PI_STATUSES.includes(piStatus)) {
    // Stripe guarantees no money moved and none is in flight — expire iff
    // past the abandonment cutoff; in-window rows are untouchable (SC-6).
    return pastExpiry
      ? { action: "expire" }
      : { action: "skip", reason: "in_window" };
  }
  // Fail-safe default: unrecognized truth never expires (SC — never expire
  // on unknown API values; surfaces in the skip counter for monitoring).
  return { action: "skip", reason: `pi_status_${piStatus}` };
}

/**
 * The sweep decision partition (BINDING — SPEC §4.2b). Pure: same inputs,
 * same action, no side effects.
 */
export function classify(input: ClassifyInput): SweepAction {
  const pastExpiry = isPastExpiry(input.expiresAt, input.nowIso);

  switch (input.refClass) {
    case "STRIPE_PI":
      return classifyPiStatus(input.truth.piStatus, pastExpiry);

    case "PAYSTACK":
      // OQ-A bound default: a `mingla_*` reference cannot be verified against
      // Stripe (and this sweep performs no Paystack reads) — never expire
      // what we cannot check; visible in the skip counter (SC-8).
      return { action: "skip", reason: "paystack_unverified" };

    case "STRIPE_CS": {
      if (input.truth.piStatus !== undefined) {
        // cs.payment_intent resolved → that PI's truth governs (SPEC §4.2b
        // CS row 1; a succeeded PI finalizes with THAT id — SC-7).
        return classifyPiStatus(input.truth.piStatus, pastExpiry);
      }
      const csStatus = input.truth.csPaymentStatus;
      if (csStatus === "unpaid") {
        // No PI ever minted and Stripe says unpaid — expire iff past cutoff.
        return pastExpiry
          ? { action: "expire" }
          : { action: "skip", reason: "in_window" };
      }
      if (csStatus === "paid" || csStatus === "no_payment_required") {
        // Money (possibly) moved but no PI is resolvable — NEVER expire;
        // error-grade skip so a human investigates (SC-7, SPEC T-8).
        return { action: "skip", reason: "cs_paid_no_pi" };
      }
      // Fail-safe: unknown CS truth never expires.
      return {
        action: "skip",
        reason: `cs_status_${
          csStatus === undefined || csStatus === "" ? "unknown" : csStatus
        }`,
      };
    }

    case "NO_REF":
      // No payment object was ever minted (pending_free / pre-mint
      // requires_payment) — no money is possible; expire iff past cutoff (SC-9).
      return pastExpiry
        ? { action: "expire" }
        : { action: "skip", reason: "in_window" };

    default: {
      // Exhaustiveness guard — unreachable while RefClass has 4 members.
      const exhaustive: never = input.refClass;
      return {
        action: "skip",
        reason: `ref_class_unknown_${String(exhaustive)}`,
      };
    }
  }
}
