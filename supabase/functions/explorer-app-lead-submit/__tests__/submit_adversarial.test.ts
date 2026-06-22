// ORCH-1216 — adversarial regression for explorer-app-lead-submit.
//
// Asserts the server REJECTS every malformed / hostile payload (the client is
// never trusted): missing consent (T-05), invalid email (T-08), interest not in
// the allow-set (T-06), platform not in the allow-set (T-07), unknown source,
// over-length fields, and malformed JSON. These MUST FAIL on revert if any
// server-side validation rule is dropped.
//
// Run: /Users/sethogieva/.deno/bin/deno test --allow-env --allow-net \
//   supabase/functions/explorer-app-lead-submit/__tests__/submit_adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handler, validateLead } from "../index.ts";

const GOOD = {
  name: "Ada",
  email: "ada@place.com",
  city: "Lagos",
  interest: "events",
  consent: true,
  platform: "ios",
  source: "explorer_marketing_nav",
};

function fieldsFor(input: unknown): string[] {
  const r = validateLead(input);
  return r.ok ? [] : r.fields;
}

Deno.test("T-05 missing consent — rejected (consent:false)", () => {
  assert(fieldsFor({ ...GOOD, consent: false }).includes("consent"));
});

Deno.test("T-05 missing consent — rejected (consent absent)", () => {
  const { consent: _omit, ...noConsent } = GOOD;
  assert(fieldsFor(noConsent).includes("consent"));
});

Deno.test("T-05 missing consent — truthy non-true rejected (consent:'yes')", () => {
  assert(fieldsFor({ ...GOOD, consent: "yes" }).includes("consent"));
});

Deno.test("T-08 invalid email — rejected", () => {
  for (const bad of ["not-an-email", "a@b", "@b.com", "a@.com", "a b@c.com", ""]) {
    assert(fieldsFor({ ...GOOD, email: bad }).includes("email"), `expected reject: ${bad}`);
  }
});

Deno.test("T-08 over-length email — rejected (>254)", () => {
  const longLocal = "a".repeat(250);
  assert(fieldsFor({ ...GOOD, email: `${longLocal}@b.com` }).includes("email"));
});

Deno.test("T-06 interest not in allow-set — rejected", () => {
  // Note: values are trimmed before the allow-set check, so "events " (with a
  // trailing space) IS accepted by design — not included here.
  for (const bad of ["hacker", "EVENTS", "place", "", "trip", "null"]) {
    assert(fieldsFor({ ...GOOD, interest: bad }).includes("interest"), `expected reject: ${bad}`);
  }
});

Deno.test("T-07 platform not in allow-set — rejected", () => {
  for (const bad of ["windows", "android", "IOS", "Other", "", "macos"]) {
    assert(fieldsFor({ ...GOOD, platform: bad }).includes("platform"), `expected reject: ${bad}`);
  }
});

Deno.test("unknown source — rejected", () => {
  for (const bad of ["explorer_marketing", "organiser_marketing_nav", "evil", "nav", ""]) {
    assert(fieldsFor({ ...GOOD, source: bad }).includes("source"), `expected reject: ${bad}`);
  }
});

Deno.test("over-length text fields — rejected", () => {
  assert(fieldsFor({ ...GOOD, name: "x".repeat(81) }).includes("name"));
  assert(fieldsFor({ ...GOOD, city: "x".repeat(81) }).includes("city"));
});

Deno.test("empty text fields — rejected", () => {
  assert(fieldsFor({ ...GOOD, name: "   " }).includes("name"));
  assert(fieldsFor({ ...GOOD, city: "  " }).includes("city"));
});

Deno.test("non-string field types — rejected, no throw", () => {
  const r = validateLead({
    name: { x: 1 },
    email: 42,
    city: [],
    interest: 123,
    consent: 1,
    platform: null,
    source: undefined,
  });
  assert(!r.ok);
  if (r.ok) return;
  // Every required field flagged; the validator never throws on bad types.
  for (const f of ["name", "email", "city", "interest", "platform", "consent", "source"]) {
    assert(r.fields.includes(f), `expected ${f} flagged`);
  }
});

Deno.test("handler — malformed JSON body → 400 validation", async () => {
  const res = await handler(
    new Request("https://x/explorer-app-lead-submit", {
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
    new Request("https://x/explorer-app-lead-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...GOOD, consent: false, email: "nope", platform: "windows" }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "validation");
  assert(Array.isArray(body.fields));
  assert(body.fields.includes("consent"));
  assert(body.fields.includes("email"));
  assert(body.fields.includes("platform"));
});
