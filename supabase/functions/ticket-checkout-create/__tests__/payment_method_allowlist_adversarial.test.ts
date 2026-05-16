// ORCH-0849 [Stripe payment-method parity] — tester adversarial regression test.
//
// Per SPEC_ORCH-0849 §3.6.2 + ORCH-0840 [Regression-test enforcement +
// append-only CI] Step 0.5: this file MUST attack different angles than
// the implementor's happy-path test at `payment_method_allowlist.test.ts`.
// A renamed copy is forbidden.
//
// Implementor's happy-path covered:
//   - allowlist returns exactly the four Phase 1 methods in order
//   - edge fn import + spread call presence
//   - hardcoded card-only literal absence
//   - automatic_payment_methods enabled-form absence (tight regex)
//
// Four distinct adversarial angles:
//
//   ATTACK 1 (allowlist exhaustiveness via type union):
//     The MinglaPaymentMethod type union is derived from MINGLA_PM_ALLOWLIST
//     via `(typeof MINGLA_PM_ALLOWLIST)[number]`. Any value cast into the
//     union must be one of the four literals; an invented method like
//     "ftw" cast through `as MinglaPaymentMethod` would not match a
//     runtime equality check against the actual allowlist. This test pins
//     the type-runtime correspondence at the test boundary.
//
//   ATTACK 2 (anti-regression to dashboard fan-out, broader scan):
//     The implementor's test #5 checks the tight regex
//     `automatic_payment_methods: { enabled: true }`. This adversarial
//     test broadens to any `automatic_payment_methods` field usage on a
//     non-comment line (Stripe also accepts `automatic_payment_methods:
//     { enabled: true, allow_redirects: "always" }` and other forms). The
//     guard from ORCH-0837 H2 root cause applies to ALL forms.
//
//   ATTACK 3 (empty-allowlist boundary):
//     Stripe rejects PaymentIntents with `payment_method_types: []`. If a
//     future ORCH accidentally empties the allowlist, the PI-create call
//     would fail at runtime. Lock in length > 0.
//
//   ATTACK 4 (Phase 2 method denylist):
//     Adding any of cash_app_pay / klarna / afterpay_clearpay /
//     us_bank_account / sepa_debit / ideal / bancontact / eps / p24 to
//     the allowlist requires a new ORCH proving redirect-flow / delayed-
//     method plumbing. Accidentally adding one of those to the Phase 1
//     allowlist (e.g., a future drive-by edit) would bypass the required
//     validation. Pin the denylist.
//
// Run with:
//   deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist_adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  MINGLA_PM_ALLOWLIST,
  type MinglaPaymentMethod,
  getPaymentMethodTypes,
} from "../../_shared/stripePaymentMethods.ts";

// ── ATTACK 1: allowlist exhaustiveness via type union ───────────────────

Deno.test(
  "ORCH-0849 adversarial — every MinglaPaymentMethod literal is in the runtime allowlist (type-runtime correspondence)",
  () => {
    // ORCH-0849 hotfix 2026-05-15: Phase 1 allowlist reduced from
    // ["card","link","apple_pay","google_pay"] to ["card","link"] after
    // Stripe CLI live-probe proved "apple_pay" / "google_pay" are NOT
    // valid PaymentIntent payment_method_types (Stripe returned 400
    // payment_intent_invalid_parameter). Apple Pay + Google Pay surface
    // as wallets through `card`, not as separate types.
    const expectedLiterals: ReadonlyArray<MinglaPaymentMethod> = [
      "card",
      "link",
    ];
    for (const lit of expectedLiterals) {
      assert(
        MINGLA_PM_ALLOWLIST.includes(lit),
        `MinglaPaymentMethod includes "${lit}" but MINGLA_PM_ALLOWLIST does not — type and runtime have diverged.`,
      );
    }
    assertEquals(
      MINGLA_PM_ALLOWLIST.length,
      expectedLiterals.length,
      `MINGLA_PM_ALLOWLIST length (${MINGLA_PM_ALLOWLIST.length}) diverges from the tester-pinned set (${expectedLiterals.length}). If the allowlist legitimately needs to change, this test must be amended via a new ORCH with [TEST-MOD-APPROVED ORCH-NNNN] in the commit body per ORCH-0840 append-only rules.`,
    );
  },
);

// ── ATTACK 2: broader anti-regression to dashboard fan-out ──────────────

Deno.test(
  "ORCH-0849 adversarial — no automatic_payment_methods field appears on any non-comment line of the edge function",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    // Strip single-line comments (so anti-regression prose in comments
    // doesn't false-positive).
    const nonCommentLines = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"));
    const nonCommentText = nonCommentLines.join("\n");

    // Broader regex than the implementor's test: any
    // `automatic_payment_methods:` field (with optional whitespace before
    // the colon) is forbidden, regardless of object body shape.
    assert(
      !/automatic_payment_methods\s*:/.test(nonCommentText),
      "regression to ORCH-0837 H2 root cause: ANY form of `automatic_payment_methods` field is forbidden in the edge function. The original incident attached six methods including four redirect-flow ones (Klarna, Affirm, Cash App, Amazon Pay) that hang PaymentSheet preflight. Use the curated MINGLA_PM_ALLOWLIST instead. If this fails, find the line and replace with [...getPaymentMethodTypes()].",
    );
  },
);

// ── ATTACK 3: empty-allowlist boundary ──────────────────────────────────

Deno.test(
  "ORCH-0849 adversarial — getPaymentMethodTypes() never returns an empty array",
  () => {
    const result = getPaymentMethodTypes();
    assert(
      result.length > 0,
      "boundary violation: getPaymentMethodTypes() returned an empty array. Stripe rejects PaymentIntents with empty payment_method_types — every PI-create call would fail at runtime. The allowlist must always contain at least one method. If this fails, MINGLA_PM_ALLOWLIST has been emptied by a regression.",
    );
  },
);

Deno.test(
  "ORCH-0849 adversarial — MINGLA_PM_ALLOWLIST is a non-empty frozen array",
  () => {
    assert(
      MINGLA_PM_ALLOWLIST.length > 0,
      "MINGLA_PM_ALLOWLIST is empty — see preceding test for impact",
    );
    // The `as const` assertion freezes the literal. Direct mutation
    // should fail at compile time, but defense-in-depth: assert
    // length is the documented size to catch dynamic mutation
    // via Reflect/Proxy if that ever happens. Reduced from 4 to 2 in
    // the 2026-05-15 hotfix — see ATTACK 1 comment for rationale.
    assertEquals(MINGLA_PM_ALLOWLIST.length, 2);
  },
);

// ── ATTACK 4: Phase 2 method denylist ───────────────────────────────────

Deno.test(
  "ORCH-0849 adversarial — Phase 2 methods are absent from the allowlist (require their own ORCH)",
  () => {
    const PHASE_2_FORBIDDEN: ReadonlyArray<string> = [
      "cash_app_pay",
      "klarna",
      "afterpay_clearpay",
      "us_bank_account",
      "sepa_debit",
      "ideal",
      "bancontact",
      "eps",
      "p24",
    ];
    const leaked: string[] = [];
    for (const method of PHASE_2_FORBIDDEN) {
      if ((MINGLA_PM_ALLOWLIST as ReadonlyArray<string>).includes(method)) {
        leaked.push(method);
      }
    }
    assertEquals(
      leaked,
      [],
      `Phase 2 methods leaked into Phase 1 allowlist without dedicated ORCH: ${leaked.join(", ")}. Each of these needs a new ORCH proving redirect-flow (Klarna / Afterpay / iDEAL / Bancontact / EPS / P24) or delayed-method plumbing (ACH / SEPA Debit) + Cash App Pay urlScheme live-fire. Adding them via an ORCH-0849 amendment is forbidden — open a fresh ORCH-NNNN for each method type.`,
    );
  },
);

Deno.test(
  "ORCH-0849 adversarial — Phase 2 method names are not referenced anywhere in the edge function source (no half-wired drift)",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    const nonCommentText = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    const HARD_FORBIDDEN_IN_EDGE_FN: ReadonlyArray<string> = [
      "cash_app_pay",
      "klarna",
      "afterpay_clearpay",
      "us_bank_account",
      "sepa_debit",
    ];
    const found: string[] = [];
    for (const method of HARD_FORBIDDEN_IN_EDGE_FN) {
      // Match the method as a quoted string literal (typical Stripe
      // payment_method_types entry) on a non-comment line.
      const pattern = new RegExp(`["']${method}["']`);
      if (pattern.test(nonCommentText)) {
        found.push(method);
      }
    }
    assertEquals(
      found,
      [],
      `Phase 2 method literals found in edge function source (half-wired drift forbidden): ${found.join(", ")}. If a method appears as a string literal but is NOT in MINGLA_PM_ALLOWLIST, it suggests partial migration that left dead branches. Either add it through a proper Phase 2 ORCH or remove the literal.`,
    );
  },
);
