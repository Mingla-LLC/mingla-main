// ORCH-1298 [chip-in-receipt-emails] — regression tests for the two NET-NEW
// renderCategoryMessage cases + the host push-app routing.
//
//   T-6 (copy — gift-framed, NO tax/invoice): buyer_contribution_receipt (guest)
//        and business.rsvp_contribution_received (host) render currency-aware,
//        gift-voiced push+email copy that contains the amount and contains NO
//        "tax"/"invoice"/"VAT"/"receipt of sale" language (Seth-locked gift
//        semantics).
//   T-7 (push app routing): the host category key is `business.`-prefixed so
//        resolveOneSignalApp routes its push to the BUSINESS OneSignal app
//        (I-PROPOSED-W); the guest category is unprefixed → consumer app.
//
// fails-on-revert: delete either case block → the switch falls through to the
// generic default (no amount / no gift copy) and the assertions FAIL. Rename the
// host category off the `business.` prefix → the T-7 routing assertion FAILS.
//
// Run: deno test supabase/functions/_shared/__tests__/orch_1298_contribution_receipt_templates.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { resolveOneSignalApp } from "../push-utils.ts";

const GUEST_KEY = "buyer_contribution_receipt";
const HOST_KEY = "business.rsvp_contribution_received";

// Language that must NEVER appear in a GIFT thank-you (case-insensitive).
const FORBIDDEN = ["tax", "invoice", "vat", "receipt of sale"];

function assertNoForbidden(text: string, where: string) {
  const lc = text.toLowerCase();
  for (const term of FORBIDDEN) {
    assert(
      !lc.includes(term),
      `${where} must not contain gift-breaking word "${term}": ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// T-6 — GUEST receipt copy: currency-aware, gift-framed, no tax/invoice.
// ---------------------------------------------------------------------------
Deno.test("T-6 guest buyer_contribution_receipt: USD gift-framed copy, no tax/invoice", () => {
  const r = renderCategoryMessage(GUEST_KEY, {
    brand_name: "Smoke & Rhythm",
    event_title: "Rooftop Sessions",
    amount_cents: 2500,
    currency: "USD",
  });

  // Amount rendered currency-aware ($25.00) across push + email.
  assertStringIncludes(r.push.body, "$25.00");
  assertStringIncludes(r.email.subject, "Rooftop Sessions");
  assertStringIncludes(r.email.body, "$25.00");
  assertStringIncludes(r.email.body, "Rooftop Sessions");

  // Gift voice — thank-you, not a bill. Distinct from the generic default
  // (which would echo payload.title/body, neither present here).
  assertStringIncludes(r.email.body.toLowerCase(), "thank you");
  assert(
    r.push.title !== "Mingla update",
    "guest case fell through to the generic default (push title)",
  );

  // NO tax/invoice language anywhere.
  assertNoForbidden(r.push.title + " " + r.push.body, "guest push");
  assertNoForbidden(r.email.subject + " " + r.email.body, "guest email");
});

Deno.test("T-6 guest buyer_contribution_receipt: NGN amount renders in the contribution currency", () => {
  const r = renderCategoryMessage(GUEST_KEY, {
    brand_name: "Lagos Nights",
    event_title: "Owambe",
    amount_cents: 500000, // ₦5,000.00
    currency: "NGN",
  });
  // Intl currency formatting for NGN uses the ₦ symbol (or NGN) and the 5,000 value.
  assert(
    r.email.body.includes("5,000") || r.email.body.includes("₦5,000") || r.email.body.includes("NGN"),
    `guest NGN email body should render the NGN amount, got: ${r.email.body}`,
  );
  assertNoForbidden(r.email.subject + " " + r.email.body, "guest NGN email");
});

// ---------------------------------------------------------------------------
// T-6 — HOST received copy: currency-aware, guest-named, no tax/invoice.
// ---------------------------------------------------------------------------
Deno.test("T-6 host business.rsvp_contribution_received: names guest + amount, no tax/invoice", () => {
  const r = renderCategoryMessage(HOST_KEY, {
    brand_name: "Smoke & Rhythm",
    event_title: "Rooftop Sessions",
    guest_name: "Ada",
    amount_cents: 5000,
    currency: "USD",
  });

  assertStringIncludes(r.push.body, "Ada");
  assertStringIncludes(r.push.body, "$50.00");
  assertStringIncludes(r.email.subject, "Ada");
  assertStringIncludes(r.email.subject, "$50.00");
  assertStringIncludes(r.email.body, "Rooftop Sessions");
  assert(
    r.push.title !== "Mingla update",
    "host case fell through to the generic default (push title)",
  );
  assertNoForbidden(r.push.title + " " + r.push.body, "host push");
  assertNoForbidden(r.email.subject + " " + r.email.body, "host email");
});

Deno.test("T-6 host copy falls back to 'Someone' when guest_name is absent", () => {
  const r = renderCategoryMessage(HOST_KEY, {
    brand_name: "Smoke & Rhythm",
    event_title: "Rooftop Sessions",
    amount_cents: 5000,
    currency: "USD",
  });
  assertStringIncludes(r.push.body, "Someone");
});

// ---------------------------------------------------------------------------
// T-7 — push app routing: host → business app, guest → consumer app.
// ---------------------------------------------------------------------------
Deno.test("T-7 host category routes push to the BUSINESS OneSignal app", () => {
  assertEquals(resolveOneSignalApp(HOST_KEY), "business");
});

Deno.test("T-7 guest category routes push to the CONSUMER OneSignal app", () => {
  assertEquals(resolveOneSignalApp(GUEST_KEY), "consumer");
});
