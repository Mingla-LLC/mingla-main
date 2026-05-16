// ORCH-0849 [Stripe payment-method parity] — implementor happy-path
// regression test for the curated Stripe payment-method allowlist.
//
// This file is the implementor's Step 0.5 gate (ORCH-0840 [Regression-test
// enforcement + append-only CI]). The tester writes an adversarial
// counterpart at `payment_method_allowlist_adversarial.test.ts` with
// distinct attack angles per SPEC_ORCH-0849 §3.6.2.
//
// Three tests:
//   (1) Pure-function test of getPaymentMethodTypes() — assert the four
//       Phase 1 methods are returned in the documented order.
//   (2) Source-file test of ticket-checkout-create/index.ts — assert the
//       import + spread call are present at the PI-create body site.
//   (3) Anti-regression source-file tests — assert the hardcoded card-only
//       literal is ABSENT and the automatic_payment_methods enabled form
//       is ABSENT (preserves ORCH-0837 [Stripe PI card-only +
//       handleURLCallback wired] H2 root-cause guard).
//
// Run with:
//   deno test --allow-read supabase/functions/ticket-checkout-create/__tests__/payment_method_allowlist.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  MINGLA_PM_ALLOWLIST,
  getPaymentMethodTypes,
} from "../../_shared/stripePaymentMethods.ts";

Deno.test(
  "ORCH-0849 — allowlist returns exactly card + link in documented order (Apple Pay / Google Pay surface through `card`, NOT as separate types)",
  () => {
    const list = getPaymentMethodTypes();
    assertEquals(
      [...list],
      ["card", "link"],
      "Allowlist MUST contain exactly card + link in this order. Apple Pay and Google Pay are NOT payment_method_types — Stripe rejects them with a 400 payment_intent_invalid_parameter (verified via stripe CLI 2026-05-15 against connected account acct_1TUNLtB5v00XfDTX). They surface in PaymentSheet as wallets THROUGH the `card` type when the mobile SDK is initialized with merchantIdentifier (iOS) / Google Pay config (Android) and the platform's PaymentMethodConfiguration has those wallets enabled. Any drift here may include a method that doesn't actually exist in Stripe's enum or that requires Phase 2 plumbing (redirect-flow / delayed-method).",
    );
    assertEquals(MINGLA_PM_ALLOWLIST.length, 2);
  },
);

Deno.test(
  "ORCH-0849 — edge function imports getPaymentMethodTypes from _shared",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    assert(
      /import\s+\{\s*getPaymentMethodTypes\s*\}\s+from\s+["']\.\.\/_shared\/stripePaymentMethods\.ts["']/
        .test(source),
      'regression: ticket-checkout-create/index.ts MUST `import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts"`. If this fails, the allowlist is bypassed — either a hardcoded literal has replaced the spread or someone has reverted to the pre-ORCH-0849 shape.',
    );
  },
);

Deno.test(
  "ORCH-0849 — edge function uses spread call at PI-create site",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    assert(
      /payment_method_types:\s*\[\s*\.\.\.\s*getPaymentMethodTypes\(\s*\)\s*\]/
        .test(source),
      'regression: ticket-checkout-create/index.ts MUST set `payment_method_types: [...getPaymentMethodTypes()]` on the PaymentIntent create body. The spread converts the readonly literal type to the mutable string[] PostgREST expects. If this fails, either someone reverted to a hardcoded array OR called the helper without the spread (compile-time type error).',
    );
  },
);

Deno.test(
  "ORCH-0849 — anti-regression: hardcoded card-only literal is ABSENT",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    assert(
      !/payment_method_types:\s*\[\s*["']card["']\s*\]/.test(source),
      'regression to ORCH-0837 [Stripe PI card-only] shape: `payment_method_types: ["card"]` literal must NOT appear at any non-comment line. The allowlist constant in _shared/stripePaymentMethods.ts is the single source of truth.',
    );
  },
);

Deno.test(
  "ORCH-0849 — anti-regression: automatic_payment_methods: { enabled: true } is ABSENT (preserves ORCH-0837 H2 guard)",
  async () => {
    const source = await Deno.readTextFile(
      new URL("../index.ts", import.meta.url),
    );
    // Match only the active API-shape (object with `enabled: true`),
    // not bare prose mentions of the field name in comments. Permits
    // documentation that names the forbidden form.
    assert(
      !/automatic_payment_methods\s*:\s*\{\s*enabled\s*:\s*true\s*\}/
        .test(source),
      "regression to ORCH-0837 H2 root cause: `automatic_payment_methods: { enabled: true }` is forbidden. That form fans out to every dashboard-enabled method including redirect-flow / delayed methods we are not yet equipped for. Use the curated allowlist instead.",
    );
  },
);
