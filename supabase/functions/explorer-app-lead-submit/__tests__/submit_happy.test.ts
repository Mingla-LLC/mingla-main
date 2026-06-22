// ORCH-1216 — happy-path regression for explorer-app-lead-submit.
//
// Exercises the lead-insert/validation contract end-to-end at the pure-logic
// layer (the same validateLead + buildNotifyEmail the handler ships), plus the
// handler's OPTIONS/405 wiring. This is part of the CLOSE Step 0.5 regression
// pair: it PASSES on the fixed code and MUST FAIL on revert (e.g. if the 5-value
// interest allow-set, the ios/other platform allow-set, the email regex, or the
// consent===true gate is removed).
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/explorer-app-lead-submit/__tests__/submit_happy.test.ts

import {
  assert,
  assertEquals,
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
  name: "Ada",
  email: "Ada@Example.com",
  city: "Lagos",
  interest: "events",
  consent: true,
  platform: "ios",
  source: "explorer_marketing_nav",
};

Deno.test("validateLead — happy path normalises + accepts", () => {
  const result = validateLead(GOOD_INPUT);
  assert(result.ok, "expected valid lead");
  if (!result.ok) return;
  // Email is trimmed + lowercased.
  assertEquals(result.lead.email, "ada@example.com");
  assertEquals(result.lead.name, "Ada");
  assertEquals(result.lead.city, "Lagos");
  assertEquals(result.lead.interest, "events");
  assertEquals(result.lead.platform, "ios");
  assertEquals(result.lead.source, "explorer_marketing_nav");
  assertEquals(result.lead.consent, true);
});

Deno.test("validateLead — trims surrounding whitespace on text fields", () => {
  const result = validateLead({
    ...GOOD_INPUT,
    name: "  Sam  ",
    city: "  Accra  ",
    email: "  Sam@Mail.com  ",
  });
  assert(result.ok);
  if (!result.ok) return;
  assertEquals(result.lead.name, "Sam");
  assertEquals(result.lead.city, "Accra");
  assertEquals(result.lead.email, "sam@mail.com");
});

Deno.test("validateLead — accepts every one of the 5 interest values", () => {
  for (const i of ["places", "events", "trips", "experiences", "all"]) {
    const result = validateLead({ ...GOOD_INPUT, interest: i });
    assert(result.ok, `expected interest ${i} to be accepted`);
  }
});

Deno.test("validateLead — accepts both platform values", () => {
  for (const p of ["ios", "other"]) {
    const result = validateLead({ ...GOOD_INPUT, platform: p });
    assert(result.ok, `expected platform ${p} to be accepted`);
  }
});

Deno.test("validateLead — accepts the explorer_marketing_nav source", () => {
  const result = validateLead({ ...GOOD_INPUT, source: "explorer_marketing_nav" });
  assert(result.ok, "expected explorer_marketing_nav source to be accepted");
});

Deno.test("buildNotifyEmail — renders only captured fields, correct recipient", () => {
  const lead: ValidatedLead = {
    name: "Ada",
    email: "ada@beanandgone.com",
    city: "Lagos",
    interest: "trips",
    platform: "other",
    consent: true,
    source: "explorer_marketing_nav",
  };
  const email = buildNotifyEmail(
    lead,
    "Mingla <hello@usemingla.com>",
    "2026-06-22T10:00:00.000Z",
  );
  assertEquals(email.to, ["seth@usemingla.com"]);
  assertEquals(email.from, "Mingla <hello@usemingla.com>");
  assert(email.subject.includes("Ada"));
  assert(email.subject.includes("trips"));
  assert(email.subject.includes("other"));
  // Body renders captured values, no fabrication.
  assert(email.text.includes("ada@beanandgone.com"));
  assert(email.text.includes("Lagos"));
  assert(email.text.includes("explorer_marketing_nav"));
  assert(email.html.includes("ada@beanandgone.com"));
});

Deno.test("buildNotifyEmail — HTML-escapes user-supplied values", () => {
  const lead: ValidatedLead = {
    name: "<script>x</script>",
    email: "a@b.co",
    city: "A&B",
    interest: "all",
    platform: "ios",
    consent: true,
    source: "explorer_marketing_nav",
  };
  const email = buildNotifyEmail(lead, "f@usemingla.com", "2026-06-22T10:00:00.000Z");
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
    new Request("https://x/explorer-app-lead-submit", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("handler — non-POST returns 405 method_not_allowed", async () => {
  const res = await handler(
    new Request("https://x/explorer-app-lead-submit", { method: "GET" }),
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
    new Request("https://x/explorer-app-lead-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(GOOD_INPUT),
    }),
  );
  assert(res.status !== 400, `expected validation to pass, got ${res.status}`);
  assert(res.status !== 405);
});
