/**
 * issue #2947 slice 4 — equivalence adversarial: the set-based free arm's
 * decision must match classify() for every refClass × provider-status combo.
 * A free arm that expired PAYSTACK or requires_capture would pass the 1000-row
 * happy path and fail here.
 *
 * Run with:
 *   deno test --allow-read \
 *     supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2947_slice4_free_arm.tester.adversarial.test.ts
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classify,
  classifyRef,
  NEVER_EXPIRE_PI_STATUSES,
  NO_CHARGE_PI_STATUSES,
  type RefClass,
  type StripeTruth,
} from "../classify.ts";

const PAST = new Date(Date.now() - 20 * 60_000).toISOString();
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();

/**
 * The set-based arm's predicate, restated from issue_2947_expire_no_ref_holds:
 * both Stripe ref columns null, order_id null, past expires_at, in-flight status.
 * It never inspects provider truth — so it may ONLY expire rows classify()
 * would also expire under empty truth for that ref class.
 */
function setBasedWouldExpire(input: {
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  orderId: string | null;
  expiresAt: string;
}): boolean {
  if (input.orderId != null) return false;
  if (input.stripePaymentIntentId != null) return false;
  if (input.stripeCheckoutSessionId != null) return false;
  return Date.parse(input.expiresAt) < Date.parse(NOW);
}

function classifyAction(
  refClass: RefClass,
  expiresAt: string,
  truth: StripeTruth,
) {
  return classify({ refClass, expiresAt, truth, nowIso: NOW });
}

const PI_STATUSES = [
  "succeeded",
  ...NEVER_EXPIRE_PI_STATUSES,
  ...NO_CHARGE_PI_STATUSES,
  "unknown_future_status",
  "",
];

Deno.test("#2947 slice4 TA-1 - set-based arm expires only when classify(NO_REF) would expire", () => {
  // NO_REF past → both expire
  assertEquals(
    setBasedWouldExpire({
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: null,
      orderId: null,
      expiresAt: PAST,
    }),
    true,
  );
  assertEquals(
    classifyAction("NO_REF", PAST, {}),
    { action: "expire" },
  );

  // NO_REF in-window → neither expires
  assertEquals(
    setBasedWouldExpire({
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: null,
      orderId: null,
      expiresAt: FUTURE,
    }),
    false,
  );
  assertEquals(
    classifyAction("NO_REF", FUTURE, {}),
    { action: "skip", reason: "in_window" },
  );
});

Deno.test("#2947 slice4 TA-2 - set-based arm never expires PAYSTACK rows", () => {
  const paystackRef = "mingla_session_abc123";
  assertEquals(
    classifyRef({
      stripePaymentIntentId: paystackRef,
      stripeCheckoutSessionId: null,
    }),
    "PAYSTACK",
  );
  assertEquals(
    setBasedWouldExpire({
      stripePaymentIntentId: paystackRef,
      stripeCheckoutSessionId: null,
      orderId: null,
      expiresAt: PAST,
    }),
    false,
    "PAYSTACK refs occupy the PI column — set-based arm must leave them",
  );
  // classify may expire unpaid Paystack past cutoff, but ONLY the per-row arm
  // with verify truth — never the set-based arm.
  assertEquals(
    classifyAction("PAYSTACK", PAST, { paystackStatus: "abandoned" }).action,
    "expire",
  );
});

Deno.test("#2947 slice4 TA-3 - set-based arm never expires any Stripe PI / CS row", () => {
  for (const status of PI_STATUSES) {
    const truth: StripeTruth = status === ""
      ? {}
      : { piStatus: status };
    const action = classifyAction("STRIPE_PI", PAST, truth);
    assertEquals(
      setBasedWouldExpire({
        stripePaymentIntentId: "pi_test_abc",
        stripeCheckoutSessionId: null,
        orderId: null,
        expiresAt: PAST,
      }),
      false,
      `STRIPE_PI status=${status} classify=${JSON.stringify(action)} must not be set-based`,
    );
  }

  assertEquals(
    setBasedWouldExpire({
      stripePaymentIntentId: null,
      stripeCheckoutSessionId: "cs_test_abc",
      orderId: null,
      expiresAt: PAST,
    }),
    false,
    "STRIPE_CS must not be set-based",
  );
  assertEquals(
    classifyAction("STRIPE_CS", PAST, { csPaymentStatus: "unpaid" }),
    { action: "expire" },
  );
});

Deno.test("#2947 slice4 TA-4 - requires_capture / processing never match set-based", () => {
  for (const status of NEVER_EXPIRE_PI_STATUSES) {
    assertEquals(
      classifyAction("STRIPE_PI", PAST, { piStatus: status }).action,
      "skip",
    );
    assertEquals(
      setBasedWouldExpire({
        stripePaymentIntentId: "pi_protect",
        stripeCheckoutSessionId: null,
        orderId: null,
        expiresAt: PAST,
      }),
      false,
    );
  }
});
