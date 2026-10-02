// #3645 / #2190 — experience checkout must return to /checkout-experience.
//
// Copilot review on PR #3732: the server's Paystack callback_url and Stripe
// success/cancel URLs only branched `trip`, so an experience buyer was returned
// to /checkout/{id}/confirm|payment instead of /checkout-experience/{id}/....
//
// Run with:
//   deno test --allow-read \
//     supabase/functions/ticket-checkout-create/__tests__/issue_3645_experience_surface_path.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { buyerWebSurfacePath } from "../buyerWebSurfacePath.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

Deno.test("#3645 — helper maps trip / experience / event surfaces", () => {
  assertEquals(buyerWebSurfacePath("trip"), "checkout-trip");
  assertEquals(buyerWebSurfacePath("experience"), "checkout-experience");
  assertEquals(buyerWebSurfacePath("event"), "checkout");
});

Deno.test("#3645 — helper falls back to event surface for anything else", () => {
  for (
    const v of [null, undefined, "", "TRIP", "Experience", " experience", "draft", 0, {}]
  ) {
    assertEquals(
      buyerWebSurfacePath(v),
      "checkout",
      `event_type=${JSON.stringify(v)} must fall back to /checkout`,
    );
  }
});

Deno.test("#3645 — Paystack callback_url derives its surface from the helper", () => {
  assertStringIncludes(
    activeSource,
    "const callbackSurface = buyerWebSurfacePath(tripGateRow?.event_type);",
  );
  assertStringIncludes(
    activeSource,
    "`${PRODUCTION_BUSINESS_WEB_ORIGIN}/${callbackSurface}/${eventId}/confirm?cs=paystack",
  );
  // The old trip-only ternary must be gone (it sent experiences to /checkout).
  assert(
    !/callbackSurface\s*=\s*tripGateRow\?\.event_type === "trip"/.test(
      activeSource,
    ),
    "trip-only callbackSurface ternary must not return",
  );
});

Deno.test("#3645 — Stripe web success/cancel URLs derive their surface from the helper", () => {
  assertStringIncludes(
    activeSource,
    "const surfacePath = buyerWebSurfacePath(tripGateRow?.event_type);",
  );
  assertStringIncludes(
    activeSource,
    "`${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}",
  );
  assertStringIncludes(
    activeSource,
    "`${baseUrl}/${surfacePath}/${eventId}/payment`",
  );
  assert(
    !/surfacePath\s*=\s*isTrip\s*\?/.test(activeSource),
    "trip-only surfacePath ternary must not return",
  );
});

Deno.test("#3645 — index.ts imports the helper and the helper names checkout-experience", () => {
  assertStringIncludes(
    activeSource,
    'import { buyerWebSurfacePath } from "./buyerWebSurfacePath.ts";',
  );
  // Resolved URLs for an experience row, both providers.
  const id = "exp-1";
  const surface = buyerWebSurfacePath("experience");
  assertEquals(
    `https://host.usemingla.com/${surface}/${id}/confirm?cs=paystack`,
    "https://host.usemingla.com/checkout-experience/exp-1/confirm?cs=paystack",
  );
  assertEquals(
    `https://host.usemingla.com/${surface}/${id}/confirm?cs={CHECKOUT_SESSION_ID}`,
    "https://host.usemingla.com/checkout-experience/exp-1/confirm?cs={CHECKOUT_SESSION_ID}",
  );
  assertEquals(
    `https://host.usemingla.com/${surface}/${id}/payment`,
    "https://host.usemingla.com/checkout-experience/exp-1/payment",
  );
});
