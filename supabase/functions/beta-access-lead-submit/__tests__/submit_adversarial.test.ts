// ORCH-1045 — adversarial regression for beta-access-lead-submit.
//
// Asserts the server REJECTS every malformed / hostile payload (the client is
// never trusted): missing consent (T-02), invalid email (T-03), brand_type not
// in the allow-set (T-10), unknown source, over-length fields, and malformed
// JSON. These MUST FAIL on revert if any server-side validation rule is dropped.
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/beta-access-lead-submit/__tests__/submit_adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handler, validateLead } from "../index.ts";

const GOOD = {
  brandType: "restaurant",
  brandName: "Place",
  contactName: "Ada",
  city: "Lagos",
  email: "ada@place.com",
  consent: true,
  source: "organiser_marketing_hero",
};

function fieldsFor(input: unknown): string[] {
  const r = validateLead(input);
  return r.ok ? [] : r.fields;
}

Deno.test("T-02 missing consent — rejected (consent:false)", () => {
  assert(fieldsFor({ ...GOOD, consent: false }).includes("consent"));
});

Deno.test("T-02 missing consent — rejected (consent absent)", () => {
  const { consent: _omit, ...noConsent } = GOOD;
  assert(fieldsFor(noConsent).includes("consent"));
});

Deno.test("T-02 missing consent — truthy non-true rejected (consent:'yes')", () => {
  assert(fieldsFor({ ...GOOD, consent: "yes" }).includes("consent"));
});

Deno.test("T-03 invalid email — rejected", () => {
  for (const bad of ["not-an-email", "a@b", "@b.com", "a@.com", "a b@c.com", ""]) {
    assert(fieldsFor({ ...GOOD, email: bad }).includes("email"), `expected reject: ${bad}`);
  }
});

Deno.test("T-03 over-length email — rejected (>254)", () => {
  const longLocal = "a".repeat(250);
  assert(fieldsFor({ ...GOOD, email: `${longLocal}@b.com` }).includes("email"));
});

Deno.test("T-10 brand_type not in allow-set — rejected", () => {
  // Note: values are trimmed before the allow-set check, so "restaurant " (with
  // trailing space) IS accepted by design — not included here.
  for (const bad of ["hacker", "RESTAURANT", "bar", "", "rest", "null"]) {
    assert(fieldsFor({ ...GOOD, brandType: bad }).includes("brandType"), `expected reject: ${bad}`);
  }
});

Deno.test("unknown source — rejected", () => {
  for (const bad of ["organiser_marketing", "evil", "nav", ""]) {
    assert(fieldsFor({ ...GOOD, source: bad }).includes("source"), `expected reject: ${bad}`);
  }
});

Deno.test("over-length text fields — rejected", () => {
  assert(fieldsFor({ ...GOOD, brandName: "x".repeat(121) }).includes("brandName"));
  assert(fieldsFor({ ...GOOD, contactName: "x".repeat(81) }).includes("contactName"));
  assert(fieldsFor({ ...GOOD, city: "x".repeat(81) }).includes("city"));
});

Deno.test("empty text fields — rejected", () => {
  assert(fieldsFor({ ...GOOD, brandName: "   " }).includes("brandName"));
  assert(fieldsFor({ ...GOOD, contactName: "" }).includes("contactName"));
  assert(fieldsFor({ ...GOOD, city: "  " }).includes("city"));
});

Deno.test("non-string field types — rejected, no throw", () => {
  const r = validateLead({
    brandType: 123,
    brandName: { x: 1 },
    contactName: null,
    city: [],
    email: 42,
    consent: 1,
    source: undefined,
  });
  assert(!r.ok);
  if (r.ok) return;
  // Every required field flagged; the validator never throws on bad types.
  for (const f of ["brandType", "brandName", "contactName", "city", "email", "consent", "source"]) {
    assert(r.fields.includes(f), `expected ${f} flagged`);
  }
});

Deno.test("handler — malformed JSON body → 400 validation", async () => {
  const res = await handler(
    new Request("https://x/beta-access-lead-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error, "validation");
});

Deno.test("handler — invalid payload → 400 with fields list", async () => {
  const res = await handler(
    new Request("https://x/beta-access-lead-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...GOOD, consent: false, email: "nope" }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation");
  assert(Array.isArray(body.fields));
  assert(body.fields.includes("consent"));
  assert(body.fields.includes("email"));
});
