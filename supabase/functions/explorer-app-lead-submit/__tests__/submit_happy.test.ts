// ORCH-1216 — happy-path regression for explorer-app-lead-submit.
//
// [TEST-MOD-APPROVED ORCH-1219] — interest is now a multi-select string[] and
// platform is 3-way (ios|android|other); the GOOD_INPUT fixture + the
// interest/platform assertions below were updated for the ORCH-1219 contract.
//
// Exercises the lead-insert/validation contract end-to-end at the pure-logic
// layer (the same validateLead + buildNotifyEmail the handler ships), plus the
// handler's OPTIONS/405 wiring. This is part of the CLOSE Step 0.5 regression
// pair: it PASSES on the fixed code and MUST FAIL on revert (e.g. if the 5-value
// interest allow-set, the ios/android/other platform allow-set, the email regex,
// or the consent===true gate is removed).
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/explorer-app-lead-submit/__tests__/submit_happy.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  buildDownloadLinkEmail,
  buildNotifyEmail,
  firstForwardedHop,
  handler,
  hashIp,
  normaliseInterest,
  validateLead,
  type ValidatedLead,
} from "../index.ts";

const GOOD_INPUT = {
  name: "Ada",
  email: "Ada@Example.com",
  city: "Lagos",
  interest: ["events"], // ORCH-1219 — multi-select array
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
  assertEquals(result.lead.interest, ["events"]); // ORCH-1219 — array
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

Deno.test("validateLead — accepts every one of the 5 interest values (singly)", () => {
  for (const i of ["places", "events", "trips", "experiences", "all"]) {
    const result = validateLead({ ...GOOD_INPUT, interest: [i] });
    assert(result.ok, `expected interest [${i}] to be accepted`);
  }
});

// ORCH-1219 Fix A — multi-select: an array of several values round-trips, and a
// duplicate is de-duped.
Deno.test("validateLead — accepts a multi-value interest array", () => {
  const result = validateLead({
    ...GOOD_INPUT,
    interest: ["places", "events", "trips"],
  });
  assert(result.ok, "expected a 3-value interest array to be accepted");
  if (!result.ok) return;
  assertEquals(result.lead.interest, ["places", "events", "trips"]);
});

Deno.test("validateLead — de-dupes + trims interest elements", () => {
  const result = validateLead({
    ...GOOD_INPUT,
    interest: [" events ", "events", "trips"],
  });
  assert(result.ok, "expected de-duped array to be accepted");
  if (!result.ok) return;
  assertEquals(result.lead.interest, ["events", "trips"]);
});

Deno.test("validateLead — accepts all 3 platform values (ORCH-1219)", () => {
  for (const p of ["ios", "android", "other"]) {
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
    interest: ["trips", "events"], // ORCH-1219 — multi-select
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
  assert(email.subject.includes("trips")); // joined label renders both
  assert(email.subject.includes("events"));
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
    interest: ["all"], // ORCH-1219 — array
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

// ─── ORCH-1219 implementor HAPPY-PATH regression (Step 0.5) ──────────────────
// PASSES on the fix; MUST FAIL on revert. The tester adds the adversarial half.

Deno.test("ORCH-1219 — normaliseInterest produces a clean array; a bare string yields []", () => {
  // Multi-select arrays round-trip; a SCALAR string is NOT silently wrapped →
  // empty (rejected upstream as a contract violation).
  assertEquals(normaliseInterest(["places", "events"]), ["places", "events"]);
  assertEquals(normaliseInterest([" trips ", "trips"]), ["trips"]); // trim + dedupe
  assertEquals(normaliseInterest("events"), []); // bare string → empty
  assertEquals(normaliseInterest([]), []); // empty array → empty
  assertEquals(normaliseInterest(undefined), []);
  assertEquals(normaliseInterest([1, "all", null]), ["all"]); // drop non-strings
});

Deno.test("ORCH-1219 — empty / non-array / out-of-set interest rejects", () => {
  const f = (i: unknown) => {
    const r = validateLead({ ...GOOD_INPUT, interest: i });
    return r.ok ? [] : r.fields;
  };
  assert(f([]).includes("interest"), "empty array rejects");
  assert(f("events").includes("interest"), "bare string rejects");
  assert(f(["events", "hacker"]).includes("interest"), "unknown element rejects");
  assert(f(["EVENTS"]).includes("interest"), "wrong-case element rejects");
});

Deno.test("ORCH-1219 Fix D — buildDownloadLinkEmail (iOS) → lead, branded, with link", () => {
  const lead: ValidatedLead = {
    name: "Ada Lovelace",
    email: "ada@beanandgone.com",
    city: "Lagos",
    interest: ["events"],
    platform: "ios",
    consent: true,
    source: "explorer_marketing_nav",
  };
  const email = buildDownloadLinkEmail(lead, "Mingla <notifications@usemingla.com>");
  // Goes to the LEAD, not seth.
  assertEquals(email.to, ["ada@beanandgone.com"]);
  assertEquals(email.from, "Mingla <notifications@usemingla.com>");
  assertEquals(email.subject, "Your Mingla TestFlight invite");
  // Branded shell (renderShell) — full doctype email, not a bare div.
  assert(email.html.includes("<!doctype html>"), "must flow through renderShell");
  // The TestFlight link is present in BOTH html + text.
  assert(email.html.includes("https://testflight.apple.com/join/1gvHNqkQ"));
  assert(email.text.includes("https://testflight.apple.com/join/1gvHNqkQ"));
  // First-name greeting.
  assert(email.html.includes("Hi Ada"), "greets by first name");
});

Deno.test("ORCH-1219 Fix D — buildDownloadLinkEmail sends to non-iOS leads too (android/other)", () => {
  for (const platform of ["android", "other"]) {
    const lead: ValidatedLead = {
      name: "Sam",
      email: "sam@mail.com",
      city: "Accra",
      interest: ["all"],
      platform,
      consent: true,
      source: "explorer_marketing_nav",
    };
    const email = buildDownloadLinkEmail(lead, "Mingla <notifications@usemingla.com>");
    assertEquals(email.to, ["sam@mail.com"], `${platform} lead gets the email`);
    assert(
      email.html.includes("https://testflight.apple.com/join/1gvHNqkQ"),
      `${platform} email still carries the TestFlight link`,
    );
    // Soft note steering them to an Apple device (non-iOS branch).
    assert(
      /iPhone|iPad|Apple/.test(email.text),
      `${platform} email points to an Apple device`,
    );
  }
});
