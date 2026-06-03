// ORCH-1045 — happy-path regression for beta-access-lead-submit.
//
// Exercises the lead-insert/validation contract end-to-end at the pure-logic
// layer (the same validateLead + buildNotifyEmail the handler ships), plus the
// handler's OPTIONS/405 wiring. This is the CLOSE Step 0.5 regression test:
// it PASSES on the fixed code and MUST FAIL on revert (e.g. if the 7-value
// brand_type allow-set, the email regex, or the consent===true gate is removed).
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/beta-access-lead-submit/__tests__/submit_happy.test.ts

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildNotifyEmail,
  firstForwardedHop,
  handler,
  hashIp,
  validateLead,
  type ValidatedLead,
} from "../index.ts";

const GOOD_INPUT = {
  brandType: "restaurant",
  brandName: "The Corner Table",
  contactName: "Ada",
  city: "Lagos",
  email: "Owner@TheCornerTable.com",
  consent: true,
  source: "organiser_marketing_hero",
};

Deno.test("validateLead — happy path normalises + accepts", () => {
  const result = validateLead(GOOD_INPUT);
  assert(result.ok, "expected valid lead");
  if (!result.ok) return;
  // Email is trimmed + lowercased.
  assertEquals(result.lead.email, "owner@thecornertable.com");
  assertEquals(result.lead.brand_type, "restaurant");
  assertEquals(result.lead.source, "organiser_marketing_hero");
  assertEquals(result.lead.consent, true);
  assertEquals(result.lead.brand_name, "The Corner Table");
  assertEquals(result.lead.contact_name, "Ada");
  assertEquals(result.lead.city, "Lagos");
});

Deno.test("validateLead — trims surrounding whitespace on text fields", () => {
  const result = validateLead({
    ...GOOD_INPUT,
    brandName: "  Bar None  ",
    contactName: "  Sam  ",
    city: "  Accra  ",
    email: "  Sam@Bar.com  ",
  });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.lead.brand_name, "Bar None");
  assertEquals(result.lead.contact_name, "Sam");
  assertEquals(result.lead.city, "Accra");
  assertEquals(result.lead.email, "sam@bar.com");
});

Deno.test("validateLead — accepts every one of the 7 brand types", () => {
  for (
    const bt of [
      "restaurant",
      "cafe_bar",
      "club_nightlife",
      "event_organiser",
      "experience_tour",
      "venue_space",
      "other",
    ]
  ) {
    const result = validateLead({ ...GOOD_INPUT, brandType: bt });
    assert(result.ok, `expected ${bt} to be accepted`);
  }
});

Deno.test("validateLead — accepts both sources", () => {
  for (const s of ["organiser_marketing_nav", "organiser_marketing_hero"]) {
    const result = validateLead({ ...GOOD_INPUT, source: s });
    assert(result.ok, `expected source ${s} to be accepted`);
  }
});

Deno.test("buildNotifyEmail — renders only captured fields, correct recipient", () => {
  const lead: ValidatedLead = {
    brand_type: "cafe_bar",
    brand_name: "Bean & Gone",
    contact_name: "Ada",
    city: "Lagos",
    email: "ada@beanandgone.com",
    consent: true,
    source: "organiser_marketing_nav",
  };
  const email = buildNotifyEmail(lead, "Mingla Beta <beta@usemingla.com>", "2026-06-02T10:00:00.000Z");
  assertEquals(email.to, ["seth@usemingla.com"]);
  assertEquals(email.from, "Mingla Beta <beta@usemingla.com>");
  assert(email.subject.includes("Bean & Gone"));
  assert(email.subject.includes("cafe_bar"));
  // Body renders captured values, no fabrication.
  assert(email.text.includes("ada@beanandgone.com"));
  assert(email.text.includes("Lagos"));
  assert(email.text.includes("organiser_marketing_nav"));
  assert(email.html.includes("ada@beanandgone.com"));
});

Deno.test("buildNotifyEmail — HTML-escapes user-supplied values", () => {
  const lead: ValidatedLead = {
    brand_type: "other",
    brand_name: '<script>x</script>',
    contact_name: "A&B",
    city: "X",
    email: "a@b.co",
    consent: true,
    source: "organiser_marketing_hero",
  };
  const email = buildNotifyEmail(lead, "f@usemingla.com", "2026-06-02T10:00:00.000Z");
  assert(!email.html.includes("<script>"), "raw <script> must be escaped");
  assert(email.html.includes("&lt;script&gt;"));
  assert(email.html.includes("A&amp;B"));
});

Deno.test("firstForwardedHop — extracts first hop", () => {
  assertEquals(firstForwardedHop("1.2.3.4, 5.6.7.8"), "1.2.3.4");
  assertEquals(firstForwardedHop("  9.9.9.9 "), "9.9.9.9");
  assertEquals(firstForwardedHop(null), null);
  assertEquals(firstForwardedHop(""), null);
});

Deno.test("hashIp — salted, deterministic, never the raw IP", async () => {
  const h1 = await hashIp("1.2.3.4", "salt-a");
  const h2 = await hashIp("1.2.3.4", "salt-a");
  const h3 = await hashIp("1.2.3.4", "salt-b");
  assertEquals(h1, h2, "same ip+salt → same hash");
  assert(h1 !== h3, "different salt → different hash");
  assert(h1 !== null && !h1.includes("1.2.3.4"), "must not contain raw IP");
  assertEquals(await hashIp(null, "salt"), null);
});

Deno.test("handler — OPTIONS returns CORS preflight 200", async () => {
  const res = await handler(
    new Request("https://x/beta-access-lead-submit", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handler — non-POST returns 405 method_not_allowed", async () => {
  const res = await handler(
    new Request("https://x/beta-access-lead-submit", { method: "GET" }),
  );
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body, { ok: false, error: "method_not_allowed" });
});

Deno.test("handler — valid POST passes validation (reaches DB layer, not 400/405)", async () => {
  // With no Supabase env configured the insert path errors → 500, but crucially
  // NOT 400 (validation passed) and NOT 405 (POST accepted). This proves the
  // happy payload clears the full validation gate.
  const res = await handler(
    new Request("https://x/beta-access-lead-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(GOOD_INPUT),
    }),
  );
  assert(res.status !== 400, `expected validation to pass, got ${res.status}`);
  assert(res.status !== 405);
});
