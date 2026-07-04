/**
 * ORCH-1295 [chip-in-post-payment-polish] — regression guard for BUG 1.
 *
 * The ORCH-1291 web Checkout success_url/cancel_url omitted the brandSlug path
 * segment (`/e/{eventSlug}` instead of `/e/{brandSlug}/{eventSlug}`), landing a
 * paying guest on a DEAD page. This test asserts the URL builder now emits BOTH
 * brandSlug AND eventSlug in `/e/{brand}/{event}` order.
 *
 * FAILS-ON-REVERT: delete the brandSlug segment in returnUrls.ts (revert to the
 * ORCH-1291 `/e/{event}` form) → the path-segment assertion + the exact-URL
 * assertions fail. Restore → pass.
 *
 * Run: deno test supabase/functions/rsvp-contribution-create/__tests__/orch_1295_web_return_url.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildContributionWebReturnUrls } from "../returnUrls.ts";

const BASE = "https://business.usemingla.com";
const BRAND = "acme-events";
const EVENT = "july-4th-bbq-pool-party";

Deno.test("ORCH-1295 web return URLs include BOTH brandSlug AND eventSlug in /e/{brand}/{event} order", () => {
  const urls = buildContributionWebReturnUrls(BASE, BRAND, EVENT);
  if (urls === null) throw new Error("expected non-null return URLs for a valid brand+event");

  // Exact URLs (success + cancel) — the /e/{brand}/{event} contract.
  assertEquals(urls.successUrl, `${BASE}/e/${BRAND}/${EVENT}?contribution=paid`);
  assertEquals(urls.cancelUrl, `${BASE}/e/${BRAND}/${EVENT}?contribution=cancel`);

  // Structural guard: the path MUST be exactly [e, brand, event]. The ORCH-1291
  // bug produced [e, event] (brandSlug dropped) — this catches that on revert.
  const segments = new URL(urls.successUrl).pathname.split("/").filter((s) => s.length > 0);
  assertEquals(segments, ["e", BRAND, EVENT]);

  // The brandSlug is present and precedes the eventSlug.
  assertEquals(segments.indexOf(BRAND) < segments.indexOf(EVENT), true);
});

Deno.test("ORCH-1295 returns null when brandSlug is missing (fail closed — never strand)", () => {
  assertEquals(buildContributionWebReturnUrls(BASE, null, EVENT), null);
  assertEquals(buildContributionWebReturnUrls(BASE, undefined, EVENT), null);
  assertEquals(buildContributionWebReturnUrls(BASE, "", EVENT), null);
  assertEquals(buildContributionWebReturnUrls(BASE, "   ", EVENT), null);
});

Deno.test("ORCH-1295 returns null when eventSlug is missing (never emit a partial path)", () => {
  assertEquals(buildContributionWebReturnUrls(BASE, BRAND, null), null);
  assertEquals(buildContributionWebReturnUrls(BASE, BRAND, ""), null);
});
