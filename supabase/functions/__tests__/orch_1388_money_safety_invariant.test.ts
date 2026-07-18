// ORCH-1388 [checkout-session honest expiry] — TESTER adversarial suite.
//
// DIFFERENT ANGLE than the implementor's two suites:
//   - orch_1388_classify_matrix.test.ts asserts specific rows return specific
//     actions (enumerated point checks).
//   - orch_1388_reconciler_expiry_sweep.test.ts asserts source needles are
//     present (Deno.readTextFile contract).
// This suite instead proves the ONE load-bearing SAFETY PROPERTY as a
// UNIVERSAL invariant swept over the FULL cross-product of ref classes ×
// (complete Stripe PI status enum + adversarial fuzz) × (past / exact-boundary
// / future / NULL / unparseable expiry): a DB-only expiry can NEVER coincide
// with any Stripe success / in-flight / paid evidence — i.e. the sweep can
// never strand real money (SPEC §1 keystone; tester angles T-A1, T-A3).
// Plus the exact-millisecond boundary (`<` not `<=`, which the implementor's
// ±ε points do not pin) and adversarial classifyRef fuzzing of the Paystack
// guard (a non-lowercase-`pi_` / `mingla_*` ref must NEVER be treated as a
// retrievable Stripe PI).
//
// Real-module provenance: imports the SHIPPED classify.ts (never re-implements
// the partition). A full revert deletes classify.ts → every test reds. A
// SEMANTIC regression (widening the expire trigger, weakening the protect set,
// flipping the boundary comparator, or breaking the Paystack guard) reds the
// specific invariant below.
//
// Run (from repo root):
//   deno test supabase/functions/__tests__/orch_1388_money_safety_invariant.test.ts
//
// Append-only: NEW file; no existing test modified.

import { assert, assertEquals } from "jsr:@std/assert@1";

import {
  classify,
  classifyRef,
  type RefClass,
  type StripeTruth,
} from "../reconcile-stuck-checkouts/classify.ts";

// ── Fixed clock ──────────────────────────────────────────────────────────────
const NOW = "2026-07-17T12:00:00.000Z";
const PAST = "2026-06-27T12:00:00.000Z"; // weeks past (the real 5 rows)
const FUTURE = "2026-07-17T12:10:00.000Z"; // in-window
const BOUNDARY_EXACT = NOW; // expires_at === now, to the millisecond
const NULL_EXP: string | null = null;
const BAD_EXP = "not-a-timestamp";

const EXPIRY_POINTS: Array<[string, string | null]> = [
  ["PAST", PAST],
  ["FUTURE", FUTURE],
  ["BOUNDARY_EXACT", BOUNDARY_EXACT],
  ["NULL", NULL_EXP],
  ["BAD", BAD_EXP],
];

// The COMPLETE Stripe PaymentIntent status enum (Stripe API v1) …
const ALL_PI_STATUSES = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "requires_capture",
  "canceled",
  "succeeded",
];
// … plus adversarial fuzz: empty, future/unknown values, and case/whitespace
// variants that must NEVER be silently coerced into a known status.
const FUZZ_PI_STATUSES = [
  "",
  "abandoned",
  "refunded",
  "partially_funded",
  "SUCCEEDED", // wrong case — must NOT be read as success
  "requires_payment_method ", // trailing space — must NOT match no-charge
  "some_future_api_status",
];

// Money is (or may still be) at stake in exactly these PI statuses. Expiring a
// row whose PI is in this set could strand a real payment — the keystone
// forbids it. (Kept as the test's own independent oracle — NOT imported from
// the module under test, so a regression in the module cannot mask itself.)
const MONEY_EVIDENCE_PI = new Set([
  "succeeded",
  "processing",
  "requires_action",
  "requires_capture",
]);

// Write-guard semantics recomputed independently: the CAS write uses
// `.lt("expires_at", nowIso)`, i.e. STRICTLY-LESS-THAN, NULL/bad never matches.
function isStrictlyPast(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const e = Date.parse(expiresAt);
  const n = Date.parse(NOW);
  if (Number.isNaN(e) || Number.isNaN(n)) return false;
  return e < n;
}

function act(
  refClass: RefClass,
  expiresAt: string | null,
  truth: StripeTruth,
) {
  return classify({ refClass, expiresAt, truth, nowIso: NOW });
}

// ── INVARIANT A (keystone money-safety) ──────────────────────────────────────
// Across the ENTIRE cross-product, `expire` NEVER coincides with money
// evidence — for STRIPE_PI rows AND for STRIPE_CS rows whose cs.payment_intent
// resolved to a PI (both route through the same PI partition). `succeeded`
// additionally must FINALIZE (the webhook-lost paid case), at ANY expiry.
Deno.test("INVARIANT A — expire never coincides with PI success/in-flight evidence (SPEC §1 keystone; T-A1/T-A3), STRIPE_PI + resolved-PI STRIPE_CS, full status×expiry cross-product", () => {
  for (const refClass of ["STRIPE_PI", "STRIPE_CS"] as RefClass[]) {
    for (const piStatus of [...ALL_PI_STATUSES, ...FUZZ_PI_STATUSES]) {
      for (const [label, expiresAt] of EXPIRY_POINTS) {
        const a = act(refClass, expiresAt, { piStatus });
        if (MONEY_EVIDENCE_PI.has(piStatus)) {
          assert(
            a.action !== "expire",
            `${refClass}/${piStatus}@${label}: money may still move — expiring here could strand a real payment (keystone violated)`,
          );
          if (piStatus === "succeeded") {
            assertEquals(
              a.action,
              "finalize",
              `${refClass}/succeeded@${label}: a webhook-lost paid session must FINALIZE at any expiry, never expire (SC-3)`,
            );
          }
        }
      }
    }
  }
});

// ── INVARIANT B (expire is tightly bounded) ──────────────────────────────────
// The dual: whenever classify returns `expire`, it is provably safe — the row
// is STRICTLY past expiry, is not Paystack, and carries no success/paid
// evidence in the truth index.ts actually populated for that ref class. A
// regression that expired an in-window row, a Paystack ref, a money-bearing PI,
// or a possibly-paid Checkout Session would red here.
//
// The (refClass → truth) couplings below are EXACTLY what index.ts can emit
// (verified in code review): STRIPE_PI carries a retrieved piStatus; STRIPE_CS
// carries EITHER a resolved-PI piStatus OR a csPaymentStatus; PAYSTACK/NO_REF
// carry `{}` (they perform no Stripe retrieve). Pairing a truth field with a
// class that ignores it is an input the sweep never produces — safety for
// PAYSTACK/NO_REF is guaranteed by index.ts leaving `truth` empty, NOT by
// classify inspecting it.
Deno.test("INVARIANT B — every `expire` outcome is strictly-past-expiry, non-Paystack, and success/paid-evidence-free (realistic ref-class→truth couplings)", () => {
  const csStatuses = [
    undefined,
    "unpaid",
    "paid",
    "no_payment_required",
    "",
    "weird_new_value",
  ];

  // Realistic truths per ref class, mirroring index.ts's I/O routing.
  function truthsFor(refClass: RefClass): StripeTruth[] {
    if (refClass === "STRIPE_PI") {
      return [...ALL_PI_STATUSES, ...FUZZ_PI_STATUSES].map((piStatus) => ({
        piStatus,
      }));
    }
    if (refClass === "STRIPE_CS") {
      return [
        // cs.payment_intent resolved → a PI status governs
        ...[...ALL_PI_STATUSES, ...FUZZ_PI_STATUSES].map((piStatus) => ({
          piStatus,
        })),
        // no resolvable PI → csPaymentStatus governs
        ...csStatuses.map((
          c,
        ): StripeTruth => (c === undefined ? {} : { csPaymentStatus: c })),
      ];
    }
    return [{}]; // PAYSTACK / NO_REF — index.ts performs no retrieve
  }

  for (
    const refClass of [
      "STRIPE_PI",
      "PAYSTACK",
      "STRIPE_CS",
      "NO_REF",
    ] as RefClass[]
  ) {
    for (const [label, expiresAt] of EXPIRY_POINTS) {
      for (const truth of truthsFor(refClass)) {
        const a = act(refClass, expiresAt, truth);
        if (a.action !== "expire") continue;
        const tag = `${refClass}/${JSON.stringify(truth)}@${label}`;
        assert(
          isStrictlyPast(expiresAt),
          `${tag}: expired a row NOT strictly past expires_at — the CAS .lt guard would 0-row it, so classify must not say expire`,
        );
        assert(
          refClass !== "PAYSTACK",
          `${tag}: a Paystack ref must NEVER expire (unverifiable)`,
        );
        assert(
          !(truth.piStatus !== undefined &&
            MONEY_EVIDENCE_PI.has(truth.piStatus)),
          `${tag}: expired a money-bearing PaymentIntent (keystone violated)`,
        );
        assert(
          truth.csPaymentStatus !== "paid" &&
            truth.csPaymentStatus !== "no_payment_required",
          `${tag}: expired a possibly-PAID Checkout Session — money could be hidden (SPEC T-8)`,
        );
      }
    }
  }
});

// ── INVARIANT C (Paystack is inert to Stripe) ────────────────────────────────
// A `mingla_*` reference is never verifiable here and is never a Stripe id:
// classify always skips it (never expire), independent of every other input.
Deno.test("INVARIANT C — PAYSTACK always skips `paystack_unverified`, never expire/finalize, across all statuses × expiry", () => {
  for (const piStatus of [...ALL_PI_STATUSES, ...FUZZ_PI_STATUSES]) {
    for (const [label, expiresAt] of EXPIRY_POINTS) {
      assertEquals(
        act("PAYSTACK", expiresAt, { piStatus }),
        { action: "skip", reason: "paystack_unverified" },
        `PAYSTACK/${piStatus}@${label}: an unverifiable Paystack ref must be an inert skip (SC-8)`,
      );
    }
  }
});

// ── BOUNDARY: strictly-less-than, pinned to the exact millisecond ────────────
// The implementor's ±ε points (11:59:59.999 / 12:00:00.001) do NOT pin the
// comparator at the exact-equal instant. A row expiring at EXACTLY now must be
// treated as in-window (protected): the CAS uses `.lt` (`<`), not `.le`.
// Flipping `<`→`<=` in classify.isPastExpiry reds THIS test while leaving the
// implementor's matrix green — the gap this suite closes.
Deno.test("BOUNDARY — expires_at === now (exact ms) is NOT past: a no-charge STRIPE_PI row is protected (in_window), proving `<` not `<=`", () => {
  assertEquals(
    act("STRIPE_PI", BOUNDARY_EXACT, { piStatus: "requires_payment_method" }),
    { action: "skip", reason: "in_window" },
    "a row whose expires_at equals the sweep clock to the ms must be protected — the CAS .lt would 0-row it anyway; classify must agree",
  );
  // one millisecond earlier IS past → expire (the other side of the exact edge)
  assertEquals(
    act("STRIPE_PI", "2026-07-17T11:59:59.999Z", {
      piStatus: "requires_payment_method",
    }),
    { action: "expire" },
  );
});

// ── classifyRef adversarial fuzz — the Paystack guard must not be bypassable ──
// The `startsWith("pi_")` check is the ONLY thing keeping a non-Stripe ref out
// of a Stripe retrieve (T-A3). Prove no adversarial reference is misclassified
// as STRIPE_PI (which would send a `mingla_*`/garbage id to Stripe and error
// every run, or worse).
Deno.test("classifyRef fuzz — only a lowercase `pi_`-prefixed PI-column value is STRIPE_PI; mingla_*/case/whitespace variants route to PAYSTACK, never Stripe", () => {
  const neverStripePi: Array<[string, string]> = [
    ["mingla_9bfcaaf8_k3j2h1", "canonical Paystack reference"],
    ["mingla_pi_abc", "contains pi_ but does not START with it"],
    ["PI_3Abc", "uppercase — a real Stripe PI id is lowercase pi_"],
    [" pi_3Abc", "leading space defeats a naive contains-check"],
    ["xpi_3Abc", "pi_ not at position 0"],
    ["paystack_ref_123", "any other non-pi_ reference"],
  ];
  for (const [ref, why] of neverStripePi) {
    assertEquals(
      classifyRef({
        stripePaymentIntentId: ref,
        stripeCheckoutSessionId: null,
      }),
      "PAYSTACK",
      `"${ref}" (${why}) must be PAYSTACK — it must NEVER be sent to a Stripe retrieve`,
    );
  }
  // The non-Stripe PI-column ref wins even when a real-looking CS id is present.
  assertEquals(
    classifyRef({
      stripePaymentIntentId: "mingla_abc",
      stripeCheckoutSessionId: "cs_live_real",
    }),
    "PAYSTACK",
  );
  // Empty-string PI ref is treated as absent → falls through to the CS column.
  assertEquals(
    classifyRef({ stripePaymentIntentId: "", stripeCheckoutSessionId: "cs_x" }),
    "STRIPE_CS",
  );
  assertEquals(
    classifyRef({ stripePaymentIntentId: "", stripeCheckoutSessionId: "" }),
    "NO_REF",
  );
  // A genuine lowercase pi_ IS STRIPE_PI (positive control).
  assertEquals(
    classifyRef({
      stripePaymentIntentId: "pi_3TmqbHI4pBxuXrhh0Zw4v0Fq",
      stripeCheckoutSessionId: null,
    }),
    "STRIPE_PI",
  );
});
